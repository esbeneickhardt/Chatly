//! The SFU's driver: one task that owns every connection, feeds it UDP and
//! timer input, and forwards each participant's media (and keyframe
//! requests) to the others in the same channel.

use super::client::*;
use super::*;

/// How long a non-connected ICE state is tolerated before actually
/// tearing the connection down. Covers two distinct cases with the
/// same timer (see `VoiceClient::disconnected_since`):
///
/// - **Was connected, then dropped.** Per `is::agent::IceConnectionState`'s
///   own doc comment, `Disconnected` "may trigger intermittently and
///   resolve just as spontaneously on less reliable networks... may
///   return to the connected state" — it's explicitly a transient,
///   expected blip, not a failure. Video's much higher bandwidth than
///   audio makes a real (imperfect) network far more likely to trip
///   this briefly than audio alone ever does.
/// - **Never connected at all.** Without a TURN relay, plain
///   host/server-reflexive ICE can simply fail outright for two peers
///   behind incompatible NATs — a real risk for this app's actual use
///   case (two different home/mobile networks calling each other) —
///   and without *this* timeout, a client stuck at `Checking` forever
///   used to sit in server memory indefinitely: its video track had
///   already been negotiated into the SDP at offer time (before ICE
///   even runs), so it kept getting offered to every later joiner as
///   a real video track that simply never produced any frames — a
///   permanent blank tile labeled "Someone"/"Somebody" once the
///   client's user id no longer resolved to a real member. Found via
///   a live report: a solo join attempt whose own ICE never connected
///   (confirmed stuck at `Checking` in the logs, twice) reappeared as
///   exactly that phantom tile for the next person who joined.
const ICE_DISCONNECT_GRACE: Duration = Duration::from_secs(15);

/// How long a client may have no ICE connection before we log why it looks
/// stuck (see `VoiceClient::packets_in`).
const STUCK_WARNING_AFTER: Duration = Duration::from_secs(10);

/// Most datagrams handled per wake-up before the loop goes back to
/// polling every connection's output — see the `recv_from` arm in `run`.
const MAX_DATAGRAMS_PER_TICK: usize = 256;

/// Remembers datagrams no connection wanted (a browser still using
/// credentials from a connection we already dropped, or a scan) so each
/// sender is mentioned once in a while, not once per packet.
#[derive(Default)]
struct UnmatchedLog {
    last_logged: HashMap<SocketAddr, Instant>,
}

impl UnmatchedLog {
    fn note(&mut self, source: SocketAddr) {
        const EVERY: Duration = Duration::from_secs(30);
        let now = Instant::now();
        if self.last_logged.len() > 256 {
            self.last_logged.retain(|_, at| now.duration_since(*at) < EVERY);
        }
        if self.last_logged.get(&source).is_some_and(|at| now.duration_since(*at) < EVERY) {
            return;
        }
        self.last_logged.insert(source, now);
        tracing::info!(%source, "voice: datagram matches no connection (stale credentials, or not from a browser we know)");
    }
}

pub(super) enum Propagated {
    TrackOpen(Id, Id, Weak<TrackIn>),
    MediaData(Id, Id, Box<MediaData>),
    /// A keyframe request that needs routing to `origin`'s connection:
    /// `(origin, origin_mid, kind)`.
    KeyframeRequest(Id, Mid, KeyframeRequestKind),
}

pub(super) fn propagate(clients: &mut HashMap<Id, VoiceClient>, event: Propagated) {
    match event {
        Propagated::TrackOpen(origin, channel_id, weak) => {
            for (&id, client) in clients.iter_mut() {
                if id == origin || client.channel_id != channel_id {
                    continue;
                }
                client
                    .tracks_out
                    .push(TrackOut { track_in: weak.clone(), state: TrackOutState::ToOpen });
            }
        }
        Propagated::MediaData(origin, channel_id, data) => {
            for (&id, client) in clients.iter_mut() {
                if id == origin || client.channel_id != channel_id {
                    continue;
                }
                client.handle_media_data_out(origin, &data);
            }
        }
        Propagated::KeyframeRequest(origin, mid_in, kind) => {
            if let Some(client) = clients.get_mut(&origin) {
                client.apply_keyframe_request(mid_in, kind);
            }
        }
    }
}

pub(super) async fn run(
    socket: UdpSocket,
    host_ip: IpAddr,
    public_ip: Option<IpAddr>,
    voice_port: u16,
    mut commands: mpsc::UnboundedReceiver<VoiceCommand>,
    signal_registry: Arc<StdMutex<SignalRegistry>>,
    gateway: Arc<GatewayHub>,
) {
    // The address every incoming packet's `destination` must be
    // reported as — str0m's ICE agent silently discards any STUN
    // request whose destination doesn't exactly match one of *our own
    // registered local candidates* (see `apply_command`'s `Offer`
    // handling: we register a host candidate at exactly this address).
    // `socket.local_addr()` would instead return the raw wildcard bind
    // address (`0.0.0.0:port`, since the socket binds every interface)
    // — which can never equal that registered candidate, so str0m
    // rejected every single connectivity check as "on an unknown
    // interface" before ever generating a reply. That silent discard
    // (logged only at `debug`, below this app's own default level) is
    // the actual root cause behind every "stuck at ICE Checking
    // forever" symptom investigated this session, on every network
    // topology tried, TURN relay included — the destination was wrong
    // no matter how the packet actually arrived.
    let local_addr = SocketAddr::new(host_ip, voice_port);
    let mut clients: HashMap<Id, VoiceClient> = HashMap::new();
    let mut buf = vec![0u8; 2000];
    let mut unmatched = UnmatchedLog::default();

    loop {
        clients.retain(|_, c| c.rtc.is_alive());

        while let Ok(cmd) = commands.try_recv() {
            apply_command(&mut clients, cmd, host_ip, public_ip, voice_port, &signal_registry);
        }

        let mut earliest = Instant::now() + Duration::from_secs(5);
        let mut to_propagate: Vec<Propagated> = Vec::new();

        for (&id, client) in clients.iter_mut() {
            client.negotiate_if_needed(&signal_registry);

            if let Some(since) = client.disconnected_since {
                if !client.stuck_logged && since.elapsed() >= STUCK_WARNING_AFTER {
                    client.stuck_logged = true;
                    if client.packets_in == 0 {
                        tracing::warn!(
                            user_id = %id,
                            "voice: no ICE connection after {}s and not one packet from this client has reached the server: its network is blocking or losing UDP to this port",
                            STUCK_WARNING_AFTER.as_secs()
                        );
                    } else {
                        tracing::warn!(
                            user_id = %id,
                            packets = client.packets_in,
                            first_from = ?client.first_packet_from,
                            "voice: no ICE connection after {}s although packets arrive from this client",
                            STUCK_WARNING_AFTER.as_secs()
                        );
                    }
                }
                let deadline = since + ICE_DISCONNECT_GRACE;
                if Instant::now() >= deadline {
                    if !client.timeout_published {
                        client.timeout_published = true;
                        // The client-sent "I left" path (an explicit
                        // leave, or the gateway connection itself
                        // closing) already publishes this on its own —
                        // this is specifically for the case neither of
                        // those catches: the WebRTC media died but the
                        // gateway *WebSocket* is still nominally open
                        // (its own heartbeat timeout is far coarser —
                        // up to a minute — than this SFU's 15s grace),
                        // so nothing else would ever tell the rest of
                        // the room this person is actually gone.
                        gateway.set_voice_state(id, None);
                        gateway.publish(
                            client.room_id,
                            DispatchEvent::VoiceStateUpdate {
                                channel_id: client.channel_id,
                                user_id: id,
                                connected: false,
                            },
                        );
                    }
                    client.rtc.disconnect();
                } else {
                    earliest = earliest.min(deadline);
                }
            }

            loop {
                if !client.rtc.is_alive() {
                    break;
                }
                match client.rtc.poll_output() {
                    Ok(Output::Timeout(t)) => {
                        earliest = earliest.min(t);
                        break;
                    }
                    Ok(Output::Transmit(t)) => {
                        let _ = socket.send_to(&t.contents, t.destination).await;
                    }
                    Ok(Output::Event(e)) => match e {
                        Event::IceConnectionStateChange(state) => {
                            tracing::info!(user_id = %id, ?state, "voice: ICE state change");
                            if state.is_connected() {
                                client.disconnected_since = None;
                            } else if state == IceConnectionState::Disconnected {
                                client.disconnected_since.get_or_insert_with(Instant::now);
                            }
                        }
                        Event::MediaAdded(added) => {
                            client.media_kinds.insert(added.mid, added.kind);
                            if let Some(weak) = client.sync_incoming(added.mid, added.direction) {
                                to_propagate.push(Propagated::TrackOpen(
                                    id,
                                    client.channel_id,
                                    weak,
                                ));
                            }
                        }
                        Event::MediaChanged(changed) => {
                            if let Some(weak) = client.sync_incoming(changed.mid, changed.direction)
                            {
                                to_propagate.push(Propagated::TrackOpen(
                                    id,
                                    client.channel_id,
                                    weak,
                                ));
                            }
                        }
                        Event::MediaData(data) => {
                            if !data.contiguous {
                                client.request_keyframe_throttled(data.mid);
                            }
                            to_propagate.push(Propagated::MediaData(
                                id,
                                client.channel_id,
                                Box::new(data),
                            ));
                        }
                        Event::KeyframeRequest(req) => {
                            if let Some((origin, mid_in)) = client.resolve_keyframe_request(req) {
                                to_propagate
                                    .push(Propagated::KeyframeRequest(origin, mid_in, req.kind));
                            }
                        }
                        _ => {}
                    },
                    Err(e) => {
                        tracing::warn!(error = ?e, "voice client error, disconnecting");
                        client.rtc.disconnect();
                        break;
                    }
                }
            }
        }

        for event in to_propagate {
            propagate(&mut clients, event);
        }

        let sleep = tokio::time::sleep(
            earliest.saturating_duration_since(Instant::now()).max(Duration::from_millis(1)),
        );
        tokio::select! {
            _ = sleep => {
                let now = Instant::now();
                for client in clients.values_mut() {
                    let _ = client.rtc.handle_input(Input::Timeout(now));
                }
            }
            received = socket.recv_from(&mut buf) => {
                let mut next = received.ok();
                let mut handled = 0;
                // Drain whatever else is already queued on the socket
                // before the next full pass over every connection —
                // that pass (`poll_output` on each client, plus fan-out)
                // is the expensive part, and running it once per
                // *datagram* means a busy screen share spends its time
                // re-polling instead of reading, letting the socket
                // buffer back up into the very loss this is meant to
                // avoid.
                while let Some((n, source)) = next {
                    if let Ok(contents) = buf[..n].try_into() {
                        let input = Input::Receive(
                            Instant::now(),
                            Receive { proto: NetProtocol::Udp, source, destination: local_addr, contents },
                        );
                        if let Some(client) = clients.values_mut().find(|c| c.rtc.accepts(&input)) {
                            client.packets_in += 1;
                            if client.first_packet_from.is_none() {
                                client.first_packet_from = Some(source);
                                tracing::info!(user_id = %client.user_id, %source, "voice: first packet from client");
                            }
                            let _ = client.rtc.handle_input(input);
                        } else {
                            unmatched.note(source);
                        }
                    }
                    handled += 1;
                    next = if handled < MAX_DATAGRAMS_PER_TICK {
                        socket.try_recv_from(&mut buf).ok()
                    } else {
                        None
                    };
                }
            }
            Some(cmd) = commands.recv() => {
                apply_command(&mut clients, cmd, host_ip, public_ip, voice_port, &signal_registry);
            }
        }
    }
}

pub(super) fn apply_command(
    clients: &mut HashMap<Id, VoiceClient>,
    cmd: VoiceCommand,
    host_ip: IpAddr,
    public_ip: Option<IpAddr>,
    voice_port: u16,
    signal_registry: &StdMutex<SignalRegistry>,
) {
    match cmd {
        VoiceCommand::Offer {
            user_id,
            channel_id,
            room_id,
            offer,
            video_purposes,
            renegotiate,
        } => {
            let video_purposes: HashMap<Mid, VideoPurpose> = video_purposes
                .into_iter()
                .filter_map(|(mid, purpose)| {
                    let purpose = match purpose.as_str() {
                        "camera" => VideoPurpose::Camera,
                        "screen" => VideoPurpose::Screen,
                        _ => return None,
                    };
                    Some((Mid::from(mid.as_str()), purpose))
                })
                .collect();

            // A change to a call that is already up (camera or screen share
            // on or off) is applied to the live connection: the microphone
            // and everyone else's audio carry on untouched.
            if renegotiate {
                if let Some(client) = clients
                    .get_mut(&user_id)
                    .filter(|c| c.channel_id == channel_id && c.rtc.is_alive())
                {
                    client.renegotiate(offer, video_purposes, signal_registry);
                    return;
                }
            }

            // Otherwise a fresh join (or a switch of channel) starts a new
            // Rtc.
            clients.remove(&user_id);

            let mut rtc = Rtc::builder().build(Instant::now());
            let local_socket_addr = SocketAddr::new(host_ip, voice_port);
            if let Ok(host_candidate) = Candidate::host(local_socket_addr, "udp") {
                let _ = rtc.add_local_candidate(host_candidate);
            }
            if let Some(ip) = public_ip {
                let public_addr = SocketAddr::new(ip, voice_port);
                if let Ok(reflexive) =
                    Candidate::server_reflexive(public_addr, local_socket_addr, "udp")
                {
                    let _ = rtc.add_local_candidate(reflexive);
                }
            }

            let answer = match rtc.sdp_api().accept_offer(offer) {
                Ok(a) => a,
                Err(e) => {
                    tracing::warn!(error = ?e, %user_id, "voice: offer rejected");
                    return;
                }
            };

            let mut client = VoiceClient {
                user_id,
                channel_id,
                room_id,
                rtc,
                pending: None,
                tracks_in: Vec::new(),
                tracks_out: Vec::new(),
                // Starts as "disconnected since now," not `None` — see
                // the field's doc comment. If ICE never reaches
                // `Connected` at all, this is what makes the same
                // `ICE_DISCONNECT_GRACE` timeout eventually clean it
                // up instead of the client living forever.
                disconnected_since: Some(Instant::now()),
                timeout_published: false,
                video_purposes,
                media_kinds: HashMap::new(),
                packets_in: 0,
                first_packet_from: None,
                stuck_logged: false,
            };

            for other in clients.values() {
                if other.channel_id != channel_id {
                    continue;
                }
                for entry in &other.tracks_in {
                    client.tracks_out.push(TrackOut {
                        track_in: Arc::downgrade(&entry.id),
                        state: TrackOutState::ToOpen,
                    });
                }
            }

            send_signal(signal_registry, user_id, channel_id, &answer);
            clients.insert(user_id, client);
        }
        VoiceCommand::Answer { user_id, answer } => {
            if let Some(client) = clients.get_mut(&user_id) {
                if let Some(pending) = client.pending.take() {
                    match client.rtc.sdp_api().accept_answer(pending, answer) {
                        Ok(()) => {
                            for track in &mut client.tracks_out {
                                if let TrackOutState::Negotiating(m) = track.state {
                                    track.state = TrackOutState::Open(m);
                                }
                            }
                            client
                                .tracks_out
                                .retain(|t| !matches!(t.state, TrackOutState::NegotiatingStop(_)));
                        }
                        Err(e) => tracing::warn!(error = ?e, %user_id, "voice: answer rejected"),
                    }
                }
            }
        }
        VoiceCommand::Leave { user_id } => {
            if let Some(client) = clients.get_mut(&user_id) {
                client.rtc.disconnect();
            }
        }
    }
}
