//! One connected voice participant's state inside the SFU: their WebRTC
//! connection, the tracks they send, the tracks forwarded to them, and the
//! keyframe-request bookkeeping that goes with both.

use super::*;

/// How often we'll re-request a keyframe from the same origin track —
/// without this, a burst of packet loss could trigger a flood of PLI
/// requests instead of one every so often.
const KEYFRAME_REQUEST_INTERVAL: Duration = Duration::from_secs(1);

/// One connected voice participant's WebRTC state.
pub(super) struct VoiceClient {
    pub(super) user_id: Id,
    pub(super) channel_id: Id,
    pub(super) room_id: Id,
    pub(super) rtc: Rtc,
    pub(super) pending: Option<SdpPendingOffer>,
    /// Tracks this client is *sending* to us, each with its own
    /// keyframe-request throttle state (irrelevant for audio, but
    /// harmless to carry for every track uniformly). Other clients
    /// hold a Weak reference to the inner `TrackIn` so a departed
    /// client's track is naturally cleaned up.
    pub(super) tracks_in: Vec<TrackInEntry>,
    /// Tracks we're forwarding *to* this client, one per remote track_in.
    pub(super) tracks_out: Vec<TrackOut>,
    /// When this client last had no live ICE connection — either it
    /// went `Disconnected` after having been `Connected`, or (the
    /// initial value, set at construction) it hasn't reached
    /// `Connected` yet at all. `None` only while actually connected.
    /// See `ICE_DISCONNECT_GRACE`.
    pub(super) disconnected_since: Option<Instant>,
    /// Set once this client's `ICE_DISCONNECT_GRACE` has actually
    /// elapsed and its departure has been published — guards against
    /// re-publishing the same "left" event on every remaining tick
    /// before `rtc.is_alive()` actually goes false and the client is
    /// removed from `clients` (str0m's own disconnect isn't
    /// necessarily instantaneous). See the main loop in `run`.
    pub(super) timeout_published: bool,
    /// This client's own video mids, tagged by purpose as of its most
    /// recent offer — consulted once, when `Event::MediaAdded` fires
    /// for that mid, to stamp the resulting `TrackIn::purpose`.
    pub(super) video_purposes: HashMap<Mid, VideoPurpose>,
    /// The kind of every media line the client has sent us, so a line that
    /// comes back to life (camera turned on again) can be told apart from
    /// audio without another offer.
    pub(super) media_kinds: HashMap<Mid, MediaKind>,
    /// Datagrams accepted from this client, and where the first came from.
    /// A client whose ICE never completes is either sending nothing that
    /// reaches us (its network blocks or loses UDP to this port) or sending
    /// something that never completes; these say which.
    pub(super) packets_in: u64,
    pub(super) first_packet_from: Option<SocketAddr>,
    /// Set once the "still not connected" warning has been logged.
    pub(super) stuck_logged: bool,
}

pub(super) struct TrackIn {
    pub(super) origin: Id,
    pub(super) mid: Mid,
    pub(super) kind: MediaKind,
    /// `Some` only for a video track whose offer tagged it (see
    /// `VoiceClient::video_purposes`); `None` for audio, or a video
    /// track whose client didn't tag it. Only affects the `stream_id`
    /// used when forwarding it (`negotiate_if_needed`), which is how
    /// remote peers tell a camera and screen share apart.
    pub(super) purpose: Option<VideoPurpose>,
}

pub(super) struct TrackInEntry {
    pub(super) id: Arc<TrackIn>,
    pub(super) last_keyframe_request: Option<Instant>,
}

pub(super) struct TrackOut {
    pub(super) track_in: Weak<TrackIn>,
    pub(super) state: TrackOutState,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum TrackOutState {
    ToOpen,
    Negotiating(Mid),
    Open(Mid),
    ToStop(Mid),
    NegotiatingStop(Mid),
}

impl TrackOut {
    pub(super) fn mid(&self) -> Option<Mid> {
        match self.state {
            TrackOutState::ToOpen => None,
            TrackOutState::Negotiating(m)
            | TrackOutState::Open(m)
            | TrackOutState::ToStop(m)
            | TrackOutState::NegotiatingStop(m) => Some(m),
        }
    }
}

impl VoiceClient {
    /// A media line of the client's started or stopped sending (its
    /// direction, as seen from here, is `direction`). Returns the new
    /// incoming track when one started, for the caller to fan out to
    /// everyone else in the room. When one stops, the track is dropped;
    /// the others' outgoing copies notice and close on their next pass.
    pub(super) fn sync_incoming(
        &mut self,
        mid: Mid,
        direction: Direction,
    ) -> Option<Weak<TrackIn>> {
        if !matches!(direction, Direction::RecvOnly | Direction::SendRecv) {
            self.tracks_in.retain(|t| t.id.mid != mid);
            return None;
        }
        if self.tracks_in.iter().any(|t| t.id.mid == mid) {
            return None;
        }
        let kind = *self.media_kinds.get(&mid)?;
        let track_in = Arc::new(TrackIn {
            origin: self.user_id,
            mid,
            kind,
            purpose: self.video_purposes.get(&mid).copied(),
        });
        let weak = Arc::downgrade(&track_in);
        self.tracks_in.push(TrackInEntry { id: track_in, last_keyframe_request: None });
        Some(weak)
    }

    /// Applies a client-initiated offer to the live connection (a camera
    /// or screen share turned on or off) and answers it. If we have an
    /// offer of our own waiting for its answer, this one is dropped: the
    /// client will answer ours first and then offer again.
    pub(super) fn renegotiate(
        &mut self,
        offer: SdpOffer,
        video_purposes: HashMap<Mid, VideoPurpose>,
        registry: &StdMutex<SignalRegistry>,
    ) {
        if self.pending.is_some() {
            tracing::debug!(user_id = %self.user_id, "voice: offer crossed ours, waiting for the client to offer again");
            return;
        }
        match self.rtc.sdp_api().accept_offer(offer) {
            Ok(answer) => {
                self.video_purposes = video_purposes;
                send_signal(registry, self.user_id, self.channel_id, &answer);
            }
            Err(e) => {
                tracing::warn!(error = ?e, user_id = %self.user_id, "voice: renegotiation offer rejected")
            }
        }
    }

    pub(super) fn handle_media_data_out(&mut self, origin: Id, data: &MediaData) {
        let Some(mid) = self
            .tracks_out
            .iter()
            .find(|o| o.track_in.upgrade().is_some_and(|i| i.origin == origin && i.mid == data.mid))
            .and_then(|o| o.mid())
        else {
            return;
        };
        let Some(writer) = self.rtc.writer(mid) else { return };
        let Some(pt) = writer.match_params(data.params) else { return };
        let _ = writer.write(pt, data.network_time, data.time, data.data.clone());
    }

    /// Called when *this* client's incoming media has a gap (packet
    /// loss) — matters for video (an audio decoder shrugs off a lost
    /// frame; a video decoder can be stuck showing a broken/frozen
    /// picture until its next keyframe). Throttled per-track so a
    /// burst of loss sends one request, not a flood of them.
    ///
    /// Audio packet loss is ordinary and frequent on any real network
    /// (far more often than video loss) and must be skipped here — a
    /// FIR/PLI request is a video-decoder concept, and firing one at
    /// an audio `mid` once a second for the entire life of a call was
    /// observed to eventually destabilize that peer's connection
    /// (video would drop out after roughly ten seconds of otherwise
    /// unremarkable audio jitter).
    pub(super) fn request_keyframe_throttled(&mut self, mid: Mid) {
        let Some(entry) = self.tracks_in.iter_mut().find(|t| t.id.mid == mid) else { return };
        if entry.id.kind != MediaKind::Video {
            return;
        }
        if entry.last_keyframe_request.is_some_and(|t| t.elapsed() < KEYFRAME_REQUEST_INTERVAL) {
            return;
        }
        let Some(mut writer) = self.rtc.writer(mid) else { return };
        let _ = writer.request_keyframe(None, KeyframeRequestKind::Fir);
        entry.last_keyframe_request = Some(Instant::now());
    }

    /// This client is *receiving* a relayed track and its decoder just
    /// asked (via RTCP PLI/FIR) for a keyframe. Resolves which other
    /// client actually originates that track, so the caller can route
    /// the request there — this client's own `Rtc` has no say over
    /// what the origin encodes, only the origin's `Rtc` does.
    pub(super) fn resolve_keyframe_request(&self, req: KeyframeRequest) -> Option<(Id, Mid)> {
        let track_out = self.tracks_out.iter().find(|t| t.mid() == Some(req.mid))?;
        let track_in = track_out.track_in.upgrade()?;
        Some((track_in.origin, track_in.mid))
    }

    /// This client *is* the origin a keyframe request was routed to —
    /// forward it over this client's own connection so their encoder
    /// actually produces one. A no-op if `mid_in` isn't (or is no
    /// longer) one of this client's incoming tracks.
    pub(super) fn apply_keyframe_request(&mut self, mid_in: Mid, kind: KeyframeRequestKind) {
        if !self.tracks_in.iter().any(|t| t.id.mid == mid_in) {
            return;
        }
        let Some(mut writer) = self.rtc.writer(mid_in) else { return };
        let _ = writer.request_keyframe(None, kind);
    }

    /// Opens/stops outgoing tracks that changed state since the last
    /// pass, and — if anything changed — sends a fresh SDP offer to
    /// this client. Skipped while a previous offer is still pending an
    /// answer (`pending.is_some()`), matching str0m's own one-at-a-time
    /// renegotiation requirement.
    pub(super) fn negotiate_if_needed(&mut self, registry: &StdMutex<SignalRegistry>) {
        if self.pending.is_some() {
            return;
        }

        for track in &mut self.tracks_out {
            if let TrackOutState::Open(m) = track.state {
                if track.track_in.upgrade().is_none() {
                    track.state = TrackOutState::ToStop(m);
                }
            }
        }

        let mut change = self.rtc.sdp_api();
        for track in &mut self.tracks_out {
            match track.state {
                TrackOutState::ToOpen => {
                    if let Some(track_in) = track.track_in.upgrade() {
                        // Suffixing camera/screen lets a remote peer's
                        // client group a user's camera and screen
                        // share (both being forwarded as ordinary,
                        // separate video tracks here) back into one
                        // combined tile instead of two unrelated ones —
                        // matched on `MediaStream.id` client-side.
                        // `-`, not `:` — str0m's `add_media` filters
                        // the stream id through RFC 8830's msid
                        // token-char set, which excludes `:` (and
                        // silently *strips* it, not rejects it — a
                        // disallowed separator here doesn't error, it
                        // just glues origin and purpose together with
                        // nothing between them, confirmed the hard
                        // way). `-` is in that allowed set.
                        let stream_id = match track_in.purpose {
                            Some(purpose) => format!("{}-{}", track_in.origin, purpose.as_str()),
                            None => track_in.origin.to_string(),
                        };
                        let mid = change.add_media(
                            track_in.kind,
                            Direction::SendOnly,
                            Some(stream_id),
                            None,
                            None,
                        );
                        track.state = TrackOutState::Negotiating(mid);
                    }
                }
                TrackOutState::ToStop(mid) => {
                    change.stop_media(mid);
                    track.state = TrackOutState::NegotiatingStop(mid);
                }
                _ => {}
            }
        }

        if !change.has_changes() {
            return;
        }
        let Some((offer, pending)) = change.apply() else { return };

        send_signal(registry, self.user_id, self.channel_id, &offer);
        self.pending = Some(pending);
    }
}
