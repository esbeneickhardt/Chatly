//! Direct messages: groups from 1:1s, closed chats coming back, declining calls.

use super::*;

// --- Direct messages ------------------------------------------------------

#[tokio::test]
async fn adding_someone_to_a_one_to_one_makes_a_new_group_and_keeps_the_original() {
    let app = TestApp::new().await;
    let (mut owner, _guild, channel) = app.owner("alice").await;
    let mut bob = app.member(&mut owner, &channel, "bob").await;
    let carol = app.member(&mut owner, &channel, "carol").await;

    let (_, dm) = owner.post("/api/dms", json!({ "usernames": ["bob"] })).await;
    let pair = dm["channel"]["id"].as_str().unwrap().to_string();

    let (status, group) =
        owner.post(&format!("/api/dms/{pair}/participants"), json!({ "username": "carol" })).await;
    assert_eq!(status, StatusCode::OK, "{group}");
    let group_id = group["channel"]["id"].as_str().unwrap().to_string();
    assert_ne!(group_id, pair, "a 1:1 must not be converted in place");
    assert_eq!(group["participants"].as_array().unwrap().len(), 2);

    // Both conversations exist for the person who added…
    let (_, list) = owner.get("/api/dms").await;
    assert!(ids_of_channels(&list).contains(&pair) && ids_of_channels(&list).contains(&group_id));
    // …the existing friend still has their 1:1 and now the group…
    let (_, bobs) = bob.get("/api/dms").await;
    assert!(ids_of_channels(&bobs).contains(&pair) && ids_of_channels(&bobs).contains(&group_id));
    // …and the newcomer only sees the group, never the 1:1.
    let mut carol = carol;
    let (_, carols) = carol.get("/api/dms").await;
    assert!(ids_of_channels(&carols).contains(&group_id));
    assert!(!ids_of_channels(&carols).contains(&pair));

    // Adding to an existing *group* grows it in place.
    let dave = app.member(&mut owner, &channel, "dave").await;
    let (_, grown) = owner
        .post(&format!("/api/dms/{group_id}/participants"), json!({ "username": "dave" }))
        .await;
    assert_eq!(grown["channel"]["id"], group_id.as_str());
    assert_eq!(grown["participants"].as_array().unwrap().len(), 3);
    drop(dave);
}

#[tokio::test]
async fn a_closed_one_to_one_comes_back_when_a_friend_is_opened_again() {
    let app = TestApp::new().await;
    let (mut owner, _guild, channel) = app.owner("alice").await;
    let mut bob = app.member(&mut owner, &channel, "bob").await;

    // Become friends (which creates the 1:1).
    let (_, request) = owner.post("/api/friends/requests", json!({ "username": "bob" })).await;
    let request_id = request["id"].as_str().unwrap().to_string();
    assert_eq!(
        bob.post(&format!("/api/friends/requests/{request_id}"), json!({})).await.0,
        StatusCode::OK
    );
    let (_, dms) = owner.get("/api/dms").await;
    let pair = dms
        .as_array()
        .unwrap()
        .iter()
        .find(|d| d["participants"].as_array().unwrap().iter().any(|p| p["username"] == "bob"))
        .expect("friendship creates the 1:1")["channel"]["id"]
        .as_str()
        .unwrap()
        .to_string();

    // Close it: it leaves the conversation list, but bob is still a friend…
    assert_eq!(
        owner.post(&format!("/api/dms/{pair}/hide"), json!({})).await.0,
        StatusCode::NO_CONTENT
    );
    let (_, dms) = owner.get("/api/dms").await;
    assert!(!ids_of_channels(&dms).contains(&pair));
    let (_, friends) = owner.get("/api/friends").await;
    assert_eq!(friends.as_array().unwrap().len(), 1);

    // …and opening him again brings the *same* conversation back.
    let (_, reopened) = owner.post("/api/dms", json!({ "usernames": ["bob"] })).await;
    assert_eq!(reopened["channel"]["id"], pair.as_str());
    let (_, dms) = owner.get("/api/dms").await;
    assert!(ids_of_channels(&dms).contains(&pair));
}

#[tokio::test]
async fn only_people_in_a_conversation_can_decline_its_call() {
    let app = TestApp::new().await;
    let (mut owner, _guild, channel) = app.owner("alice").await;
    let mut bob = app.member(&mut owner, &channel, "bob").await;
    let mut carol = app.member(&mut owner, &channel, "carol").await;
    let (_, dm) = owner.post("/api/dms", json!({ "usernames": ["bob"] })).await;
    let dm = dm["channel"]["id"].as_str().unwrap().to_string();

    assert_eq!(
        bob.post(&format!("/api/dms/{dm}/call/decline"), json!({})).await.0,
        StatusCode::NO_CONTENT
    );
    // Someone outside the conversation gets "no such conversation", not a broadcast.
    assert_eq!(
        carol.post(&format!("/api/dms/{dm}/call/decline"), json!({})).await.0,
        StatusCode::NOT_FOUND
    );
}

// --- Calls moving with the conversation ----------------------------------

/// Everything published to `user`'s personal room so far, as event names.
fn drain(
    rx: &mut tokio::sync::broadcast::Receiver<crate::gateway::DispatchEvent>,
) -> Vec<crate::gateway::DispatchEvent> {
    let mut out = Vec::new();
    while let Ok(event) = rx.try_recv() {
        out.push(event);
    }
    out
}

#[tokio::test]
async fn adding_someone_during_a_call_tells_both_people_the_call_moved() {
    use crate::gateway::DispatchEvent;
    use protocol::Id;

    let app = TestApp::new().await;
    let (mut alice, _guild, channel) = app.owner("alice").await;
    let bob = app.member(&mut alice, &channel, "bob").await;
    let _carol = app.member(&mut alice, &channel, "carol").await;

    let (_, dm) = alice.post("/api/dms", json!({ "usernames": ["bob"] })).await;
    let pair: Id = dm["channel"]["id"].as_str().unwrap().parse().unwrap();
    let alice_id: Id = alice.user_id.parse().unwrap();
    let bob_id: Id = bob.user_id.parse().unwrap();

    // Both are on the 1:1's call (a DM's voice room is the channel itself).
    app.state.gateway.set_voice_state(alice_id, Some((pair, pair)));
    app.state.gateway.set_voice_state(bob_id, Some((pair, pair)));
    let mut alice_events = app.state.gateway.subscribe(alice_id);
    let mut bob_events = app.state.gateway.subscribe(bob_id);

    let (status, group) =
        alice.post(&format!("/api/dms/{pair}/participants"), json!({ "username": "carol" })).await;
    assert_eq!(status, StatusCode::OK, "{group}");
    let group_id: Id = group["channel"]["id"].as_str().unwrap().parse().unwrap();

    for (who, events) in [("alice", drain(&mut alice_events)), ("bob", drain(&mut bob_events))] {
        let moved: Vec<_> = events
            .iter()
            .filter_map(|e| match e {
                DispatchEvent::DmCallMoved { from_channel_id, to_channel_id, by } => {
                    Some((*from_channel_id, *to_channel_id, *by))
                }
                _ => None,
            })
            .collect();
        assert_eq!(moved, vec![(pair, group_id, alice_id)], "{who} is told the call moved");
        // …and hears about the group before the move, so it can follow.
        let created = events.iter().position(|e| matches!(e, DispatchEvent::DmChannelCreate(_)));
        let moved_at = events.iter().position(|e| matches!(e, DispatchEvent::DmCallMoved { .. }));
        assert!(created < moved_at, "{who}: group announced before the move");
    }
}

#[tokio::test]
async fn adding_someone_when_nobody_is_on_a_call_moves_no_call() {
    use crate::gateway::DispatchEvent;
    use protocol::Id;

    let app = TestApp::new().await;
    let (mut alice, _guild, channel) = app.owner("alice").await;
    let bob = app.member(&mut alice, &channel, "bob").await;
    let _carol = app.member(&mut alice, &channel, "carol").await;
    let (_, dm) = alice.post("/api/dms", json!({ "usernames": ["bob"] })).await;
    let pair = dm["channel"]["id"].as_str().unwrap().to_string();
    let bob_id: Id = bob.user_id.parse().unwrap();
    let mut bob_events = app.state.gateway.subscribe(bob_id);

    let (status, _) =
        alice.post(&format!("/api/dms/{pair}/participants"), json!({ "username": "carol" })).await;
    assert_eq!(status, StatusCode::OK);
    assert!(!drain(&mut bob_events).iter().any(|e| matches!(e, DispatchEvent::DmCallMoved { .. })));
}

#[tokio::test]
async fn a_client_can_ask_who_is_on_a_call_in_its_conversations() {
    use protocol::Id;

    let app = TestApp::new().await;
    let (mut alice, _guild, channel) = app.owner("alice").await;
    let bob = app.member(&mut alice, &channel, "bob").await;
    let mut carol = app.member(&mut alice, &channel, "carol").await;
    let (_, dm) = alice.post("/api/dms", json!({ "usernames": ["bob"] })).await;
    let pair: Id = dm["channel"]["id"].as_str().unwrap().parse().unwrap();
    let bob_id: Id = bob.user_id.parse().unwrap();

    // Nobody on a call yet.
    let (status, none) = alice.get("/api/dms/voice-state").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(none, json!([]));

    // Bob is on the call (a DM's voice room is the channel itself).
    app.state.gateway.set_voice_state(bob_id, Some((pair, pair)));
    let (_, seen) = alice.get("/api/dms/voice-state").await;
    assert_eq!(
        seen,
        json!([{ "channel_id": pair.to_string(), "user_id": bob_id.to_string() }]),
        "alice, who is in the conversation, sees who is on its call"
    );

    // Someone not in that conversation learns nothing about its call.
    let (_, hidden) = carol.get("/api/dms/voice-state").await;
    assert_eq!(hidden, json!([]));

    // And it is gone once he leaves.
    app.state.gateway.set_voice_state(bob_id, None);
    assert_eq!(alice.get("/api/dms/voice-state").await.1, json!([]));
}
