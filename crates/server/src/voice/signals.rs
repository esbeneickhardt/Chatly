//! Where a user's call signalling goes.
//!
//! A user can have several gateway connections at once: two tabs, a phone and
//! a computer, an installed app and a browser tab, or a page that has just
//! reconnected while the server has not yet noticed its old connection died
//! (phones do this all the time). The SFU's messages for a call (the answer
//! to an offer, or a new offer when someone else starts a stream) must reach
//! the connection that *made* the call, and only that connection's departure
//! may end it. Keying everything by user alone let the newest connection
//! steal the messages, and let any old connection closing hang up a call
//! that was running fine elsewhere.

use std::collections::HashMap;

use protocol::Id;
use tokio::sync::mpsc;

use super::VoiceSignal;

/// One gateway connection of a user.
pub type ConnId = u64;

struct Connection {
    id: ConnId,
    tx: mpsc::UnboundedSender<VoiceSignal>,
}

#[derive(Default)]
pub struct SignalRegistry {
    connections: HashMap<Id, Vec<Connection>>,
    /// The connection each user's call belongs to (set when it makes a fresh
    /// offer, cleared when it leaves).
    owners: HashMap<Id, ConnId>,
    next_id: ConnId,
}

impl SignalRegistry {
    /// A user's new gateway connection; its receiver gets whatever the SFU
    /// sends while this connection owns the call.
    pub fn register(&mut self, user: Id) -> (ConnId, mpsc::UnboundedReceiver<VoiceSignal>) {
        let (tx, rx) = mpsc::unbounded_channel();
        self.next_id += 1;
        let id = self.next_id;
        self.connections.entry(user).or_default().push(Connection { id, tx });
        (id, rx)
    }

    /// `conn` now owns `user`'s call (it made a fresh offer). A later fresh
    /// offer from another connection takes the call over.
    pub fn claim(&mut self, user: Id, conn: ConnId) {
        if self.is_registered(user, conn) {
            self.owners.insert(user, conn);
        }
    }

    pub fn owns(&self, user: Id, conn: ConnId) -> bool {
        self.owners.get(&user) == Some(&conn)
    }

    /// `conn` gave up the call (an explicit leave). False if it never owned it.
    pub fn release(&mut self, user: Id, conn: ConnId) -> bool {
        if !self.owns(user, conn) {
            return false;
        }
        self.owners.remove(&user);
        true
    }

    /// `conn` closed. True if the user's call must end with it: it owned the
    /// call, or it was the user's last connection. A connection that owned
    /// nothing closing (a stale tab) changes nothing.
    pub fn unregister(&mut self, user: Id, conn: ConnId) -> bool {
        let owned = self.owns(user, conn);
        if owned {
            self.owners.remove(&user);
        }
        let now_empty = match self.connections.get_mut(&user) {
            Some(list) => {
                list.retain(|c| c.id != conn);
                list.is_empty()
            }
            None => true,
        };
        if now_empty {
            self.connections.remove(&user);
            self.owners.remove(&user);
        }
        owned || now_empty
    }

    /// Delivers `signal` to the connection that owns `user`'s call, or, if
    /// none does, to their newest connection.
    pub fn send(&self, user: Id, signal: VoiceSignal) {
        let Some(list) = self.connections.get(&user) else { return };
        let target = self
            .owners
            .get(&user)
            .and_then(|owner| list.iter().find(|c| c.id == *owner))
            .or_else(|| list.last());
        if let Some(connection) = target {
            let _ = connection.tx.send(signal);
        }
    }

    fn is_registered(&self, user: Id, conn: ConnId) -> bool {
        self.connections.get(&user).is_some_and(|list| list.iter().any(|c| c.id == conn))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn signal(n: u64) -> VoiceSignal {
        VoiceSignal { channel_id: Id::from_raw(n), sdp: serde_json::json!({}) }
    }

    fn got(rx: &mut mpsc::UnboundedReceiver<VoiceSignal>) -> Vec<u64> {
        let mut out = Vec::new();
        while let Ok(s) = rx.try_recv() {
            out.push(s.channel_id.raw());
        }
        out
    }

    #[test]
    fn a_newer_connection_does_not_steal_the_calls_messages() {
        let user = Id::from_raw(1);
        let mut registry = SignalRegistry::default();
        let (phone, mut phone_rx) = registry.register(user);
        registry.claim(user, phone);
        // The same account opens another tab afterwards.
        let (_tab, mut tab_rx) = registry.register(user);

        registry.send(user, signal(7));
        assert_eq!(got(&mut phone_rx), vec![7], "the call's own connection gets it");
        assert!(got(&mut tab_rx).is_empty());
    }

    #[test]
    fn an_old_connection_closing_does_not_end_a_call_running_elsewhere() {
        let user = Id::from_raw(1);
        let mut registry = SignalRegistry::default();
        let (stale, _stale_rx) = registry.register(user);
        let (live, mut live_rx) = registry.register(user);
        registry.claim(user, live);

        assert!(!registry.unregister(user, stale), "a stale tab closing must not hang up");
        registry.send(user, signal(3));
        assert_eq!(got(&mut live_rx), vec![3]);
        assert!(registry.owns(user, live));
    }

    #[test]
    fn the_calls_own_connection_closing_ends_it() {
        let user = Id::from_raw(1);
        let mut registry = SignalRegistry::default();
        let (owner, _rx) = registry.register(user);
        let (_other, _other_rx) = registry.register(user);
        registry.claim(user, owner);
        assert!(registry.unregister(user, owner));
        assert!(!registry.owns(user, owner));
    }

    #[test]
    fn a_users_last_connection_closing_ends_whatever_was_going() {
        let user = Id::from_raw(1);
        let mut registry = SignalRegistry::default();
        let (only, _rx) = registry.register(user);
        assert!(registry.unregister(user, only));
    }

    #[test]
    fn a_fresh_join_from_another_device_takes_the_call_over() {
        let user = Id::from_raw(1);
        let mut registry = SignalRegistry::default();
        let (pc, mut pc_rx) = registry.register(user);
        let (phone, mut phone_rx) = registry.register(user);
        registry.claim(user, pc);
        registry.claim(user, phone);

        registry.send(user, signal(9));
        assert_eq!(got(&mut phone_rx), vec![9]);
        assert!(got(&mut pc_rx).is_empty());
        assert!(!registry.release(user, pc), "the old device has nothing left to leave");
        assert!(registry.release(user, phone));
    }

    #[test]
    fn with_no_call_going_messages_go_to_the_newest_connection() {
        let user = Id::from_raw(1);
        let mut registry = SignalRegistry::default();
        let (_a, mut a_rx) = registry.register(user);
        let (_b, mut b_rx) = registry.register(user);
        registry.send(user, signal(5));
        assert!(got(&mut a_rx).is_empty());
        assert_eq!(got(&mut b_rx), vec![5]);
    }

    #[test]
    fn people_are_kept_apart() {
        let (ann, ben) = (Id::from_raw(1), Id::from_raw(2));
        let mut registry = SignalRegistry::default();
        let (a, mut a_rx) = registry.register(ann);
        let (b, mut b_rx) = registry.register(ben);
        registry.claim(ann, a);
        registry.claim(ben, b);
        registry.send(ann, signal(1));
        assert_eq!(got(&mut a_rx), vec![1]);
        assert!(got(&mut b_rx).is_empty());
    }
}
