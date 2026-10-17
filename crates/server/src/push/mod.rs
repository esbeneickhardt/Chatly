//! Web Push: reaching someone whose Chatly is closed. A browser that turned
//! notifications on hands the server a subscription (an endpoint at its
//! vendor's push service plus encryption keys, see `api::push`); for a call,
//! a direct message or a mention, the server encrypts a small JSON notice for
//! each of the recipient's subscriptions and posts it there. The service
//! worker (`web/public/sw.js`) wakes up, decrypts it and shows it.
//!
//! Nobody is pushed to while they are actively using Chatly on some device
//! (see `GatewayHub::is_active`): the open app already rings and pings them.

mod crypto;

use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use protocol::{Id, Permissions};
use serde::Serialize;

pub use crypto::VapidKey;

use crate::api::permissions::require_channel_permission;
use crate::models::{Channel, Message, PushSubscription};
use crate::state::{AppState, SharedState};
use crate::storage::Storage;

/// Push services a subscription may point at. Anything else is refused, so
/// an account can't make the server send requests into arbitrary networks.
const ALLOWED_HOSTS: &[&str] = &[
    "fcm.googleapis.com",
    "web.push.apple.com",
    "updates.push.services.mozilla.com",
    "push.services.mozilla.com",
    ".notify.windows.com",
    ".push.apple.com",
];

/// What the service worker gets: enough to show the notification and open
/// the right place when it's tapped.
#[derive(Debug, Clone, Serialize)]
pub struct Notice {
    /// `"call"` or `"message"`.
    pub kind: &'static str,
    pub title: String,
    pub body: String,
    /// Notices with the same tag replace each other on the device.
    pub tag: String,
    pub channel_id: Id,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub guild_id: Option<Id>,
}

impl Notice {
    /// A ring is worthless once the call has moved on; a message keeps a day.
    fn ttl_secs(&self) -> u32 {
        if self.kind == "call" {
            30
        } else {
            24 * 60 * 60
        }
    }
}

/// Checks that a subscription points at a known push service over HTTPS and
/// carries usable keys.
pub fn validate(sub: &PushSubscription) -> Result<(), &'static str> {
    if sub.endpoint.len() > 1024 {
        return Err("endpoint is too long");
    }
    let host = sub
        .endpoint
        .strip_prefix("https://")
        .and_then(|rest| rest.split('/').next())
        .ok_or("endpoint must be an https URL")?;
    // A bare host name: no user info, port, query or fragment to smuggle
    // another destination past the suffix check.
    if !host.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'.' || b == b'-')
    {
        return Err("endpoint is not a known push service");
    }
    let allowed = ALLOWED_HOSTS.iter().any(|allowed| match allowed.strip_prefix('.') {
        Some(suffix) => host.len() > suffix.len() + 1 && host.ends_with(allowed),
        None => host == *allowed,
    });
    if !allowed {
        return Err("endpoint is not a known push service");
    }
    crypto::parse_keys(&sub.p256dh, &sub.auth).map_err(|_| "invalid subscription keys")?;
    Ok(())
}

#[derive(Clone)]
pub struct PushService {
    inner: Arc<Inner>,
}

struct Inner {
    vapid: VapidKey,
    /// Who is sending, as the push services want it: the instance's URL.
    subject: String,
    client: reqwest::Client,
    storage: Arc<dyn Storage>,
}

impl PushService {
    pub fn new(vapid: VapidKey, public_url: &str, storage: Arc<dyn Storage>) -> Self {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(10))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .expect("HTTP client builds");
        PushService {
            inner: Arc::new(Inner { vapid, subject: public_url.to_string(), client, storage }),
        }
    }

    pub fn public_key(&self) -> &str {
        self.inner.vapid.public_key()
    }

    /// Sends `notice` to every device of `user_ids`, in the background.
    fn send(&self, user_ids: Vec<Id>, notice: Notice) {
        if user_ids.is_empty() {
            return;
        }
        let inner = self.inner.clone();
        tokio::spawn(async move {
            let subs = match inner.storage.push_subscriptions_for(user_ids).await {
                Ok(subs) => subs,
                Err(e) => {
                    tracing::warn!(error = %e, "could not load push subscriptions");
                    return;
                }
            };
            let payload = serde_json::to_vec(&notice).expect("notices serialize");
            for sub in subs {
                let inner = inner.clone();
                let payload = payload.clone();
                let ttl = notice.ttl_secs();
                tokio::spawn(async move { inner.deliver(&sub, &payload, ttl).await });
            }
        });
    }
}

impl Inner {
    async fn deliver(&self, sub: &PushSubscription, payload: &[u8], ttl: u32) {
        let Ok((ua_public, auth)) = crypto::parse_keys(&sub.p256dh, &sub.auth) else { return };
        let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs();
        let Some(authorization) = self.vapid.authorization(&sub.endpoint, &self.subject, now)
        else {
            return;
        };
        let body = crypto::encrypt(&ua_public, &auth, payload);
        let result = self
            .client
            .post(&sub.endpoint)
            .header("Authorization", authorization)
            .header("Content-Encoding", "aes128gcm")
            .header("Content-Type", "application/octet-stream")
            .header("TTL", ttl.to_string())
            .header("Urgency", "high")
            .body(body)
            .send()
            .await;
        match result {
            Ok(response) if response.status().is_success() => {}
            // The browser unsubscribed or the subscription expired: forget it.
            Ok(response) if matches!(response.status().as_u16(), 404 | 410) => {
                tracing::info!(status = %response.status(), "push service no longer knows a subscription; forgetting it");
                if let Err(e) = self.storage.forget_push_endpoint(&sub.endpoint).await {
                    tracing::warn!(error = %e, "could not forget a dead push subscription");
                }
            }
            Ok(response) => {
                let status = response.status();
                let text = response.text().await.unwrap_or_default();
                tracing::warn!(%status, body = %text.chars().take(200).collect::<String>(), "push service refused a notification");
            }
            Err(e) => tracing::warn!(error = %e, "could not reach a push service"),
        }
    }
}

/// Pushes `notice` to those of `user_ids` who aren't using Chatly right now.
pub fn notify(state: &AppState, mut user_ids: Vec<Id>, mut notice: Notice) {
    user_ids.retain(|&id| !state.gateway.is_active(id));
    if user_ids.is_empty() {
        return;
    }
    notice.title = truncate(&notice.title, 100);
    notice.body = truncate(&notice.body, 140);
    debug_assert!(serde_json::to_vec(&notice).unwrap().len() < crypto::MAX_PAYLOAD);
    state.push.send(user_ids, notice);
}

/// A new message: everyone else in a direct conversation hears about it, and
/// in a server channel whoever it mentions (if they can see the channel).
pub fn message_created(state: &SharedState, channel: &Channel, message: &Message) {
    if channel.guild_id.is_some() && message.mentions.is_empty() {
        return;
    }
    let (state, channel, message) = (state.clone(), channel.clone(), message.clone());
    tokio::spawn(async move {
        let recipients = match channel.guild_id {
            None => match state.storage.list_dm_participant_users(channel.id).await {
                Ok(users) => users.into_iter().map(|u| u.id).collect(),
                Err(_) => return,
            },
            Some(_) => {
                let mut allowed = Vec::new();
                for &user_id in &message.mentions {
                    if require_channel_permission(
                        &state,
                        user_id,
                        channel.id,
                        Permissions::VIEW_CHANNEL,
                    )
                    .await
                    .is_ok()
                    {
                        allowed.push(user_id);
                    }
                }
                allowed
            }
        };
        let recipients: Vec<Id> =
            recipients.into_iter().filter(|&id| id != message.author_id).collect();
        let title = match channel.guild_id {
            None => message.author_display_name.clone(),
            Some(_) => format!("{} in #{}", message.author_display_name, channel.name),
        };
        let body = if message.content.trim().is_empty() {
            "Sent an attachment".to_string()
        } else {
            message.content.clone()
        };
        notify(
            &state,
            recipients,
            Notice {
                kind: "message",
                title,
                body,
                tag: channel.id.to_string(),
                channel_id: channel.id,
                guild_id: channel.guild_id,
            },
        );
    });
}

/// `caller` started a call in a direct conversation (nobody else was on
/// it): ring everyone else in it.
pub fn call_started(state: &SharedState, caller: Id, channel_id: Id) {
    let state = state.clone();
    tokio::spawn(async move {
        let Ok(users) = state.storage.list_dm_participant_users(channel_id).await else { return };
        let Some(caller_name) =
            users.iter().find(|u| u.id == caller).map(|u| u.display_name.clone())
        else {
            return;
        };
        let body = if users.len() > 2 { "Group call" } else { "Incoming call" };
        let recipients = users.iter().map(|u| u.id).filter(|&id| id != caller).collect();
        notify(
            &state,
            recipients,
            Notice {
                kind: "call",
                title: format!("{caller_name} is calling"),
                body: body.to_string(),
                tag: format!("call-{channel_id}"),
                channel_id,
                guild_id: None,
            },
        );
    });
}

/// Whitespace collapsed and cut to `max` characters.
fn truncate(text: &str, max: usize) -> String {
    let flat = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if flat.chars().count() <= max {
        return flat;
    }
    let mut cut: String = flat.chars().take(max - 1).collect();
    cut.push('…');
    cut
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sub(endpoint: &str) -> PushSubscription {
        PushSubscription {
            endpoint: endpoint.into(),
            p256dh: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4".into(),
            auth: "BTBZMqHH6r4Tts7J_aSIgg".into(),
        }
    }

    #[test]
    fn only_known_push_services_are_accepted() {
        assert!(validate(&sub("https://fcm.googleapis.com/fcm/send/abc")).is_ok());
        assert!(validate(&sub("https://web.push.apple.com/QH0x")).is_ok());
        assert!(validate(&sub("https://wns2-db5p.notify.windows.com/w/?token=x")).is_ok());
        assert!(validate(&sub("http://fcm.googleapis.com/fcm/send/abc")).is_err());
        assert!(validate(&sub("https://192.168.0.1/fcm/send")).is_err());
        assert!(validate(&sub("https://evilfcm.googleapis.com.example/x")).is_err());
        assert!(validate(&sub("https://notify.windows.com/x")).is_err());
        assert!(validate(&sub("https://fcm.googleapis.com@10.0.0.1/x")).is_err());
        assert!(validate(&sub("https://10.0.0.1#.notify.windows.com/x")).is_err());
        assert!(validate(&sub("https://10.0.0.1?.notify.windows.com/x")).is_err());
    }

    #[test]
    fn truncates_on_characters_not_bytes() {
        assert_eq!(truncate("hej  med\ndig", 140), "hej med dig");
        assert_eq!(truncate("æøåæøå", 4), "æøå…");
    }
}
