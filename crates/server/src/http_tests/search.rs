//! Message search, and paging through history.

use super::*;

// --- Search ---------------------------------------------------------------

#[tokio::test]
async fn search_finds_messages_and_follows_edits_and_deletes() {
    let app = TestApp::new().await;
    let (mut owner, _guild, channel) = app.owner("root").await;

    let first = say(&mut owner, &channel, "the quick brown fox").await;
    say(&mut owner, &channel, "an unrelated line").await;

    let (status, hits) = owner.get(&format!("/api/search?channel_id={channel}&q=quick+fox")).await;
    assert_eq!(status, StatusCode::OK, "{hits}");
    assert_eq!(hit_ids(&hits), vec![first.clone()]);

    // Prefix matching on the last word, accent/case-insensitive.
    let (_, hits) = owner.get(&format!("/api/search?channel_id={channel}&q=BRO")).await;
    assert_eq!(hit_ids(&hits), vec![first.clone()]);

    // Editing re-indexes: the old word stops matching, the new one matches.
    let (status, _) = owner
        .request(
            axum::http::Method::PATCH,
            &format!("/api/messages/{first}"),
            Some(json!({ "content": "a lazy dog now" })),
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    let (_, old) = owner.get(&format!("/api/search?channel_id={channel}&q=fox")).await;
    assert!(hit_ids(&old).is_empty(), "the old text must no longer match: {old}");
    let (_, new) = owner.get(&format!("/api/search?channel_id={channel}&q=lazy")).await;
    assert_eq!(hit_ids(&new), vec![first.clone()]);

    // Deleting removes it from the index.
    assert_eq!(owner.delete(&format!("/api/messages/{first}")).await.0, StatusCode::NO_CONTENT);
    let (_, gone) = owner.get(&format!("/api/search?channel_id={channel}&q=lazy")).await;
    assert!(hit_ids(&gone).is_empty());
}

#[tokio::test]
async fn search_never_returns_messages_from_places_you_cannot_read() {
    let app = TestApp::new().await;
    let (mut root, _g, root_channel) = app.owner("root").await;
    let mut founder = app.member(&mut root, &root_channel, "founder").await;
    let (_, created) = founder.post("/api/guilds", json!({ "name": "Club" })).await;
    let guild = created["id"].as_str().unwrap().to_string();
    let (_, channels) = founder.get(&format!("/api/guilds/{guild}/channels")).await;
    let open_channel = channels[0]["id"].as_str().unwrap().to_string();
    let mut member = app.member(&mut founder, &open_channel, "member").await;

    // A private channel the member isn't on.
    let (_, secret) = founder
        .post(&format!("/api/guilds/{guild}/channels"), json!({ "name": "secret", "kind": "text" }))
        .await;
    let secret_id = secret["id"].as_str().unwrap().to_string();
    let public_hit = say(&mut founder, &open_channel, "launch codes are public knowledge").await;
    let secret_hit = say(&mut founder, &secret_id, "launch codes are in the vault").await;

    // The founder (owner) sees both when searching the server…
    let (_, both) = founder.get(&format!("/api/search?guild_id={guild}&q=launch+codes")).await;
    assert_eq!(hit_ids(&both).len(), 2, "{both}");

    // …the member sees only the one they can read, and can't target the private channel.
    let (_, only) = member.get(&format!("/api/search?guild_id={guild}&q=launch+codes")).await;
    assert_eq!(hit_ids(&only), vec![public_hit]);
    assert!(!hit_ids(&only).contains(&secret_hit));
    let (status, _) = member.get(&format!("/api/search?channel_id={secret_id}&q=launch")).await;
    assert_eq!(status, StatusCode::NOT_FOUND, "a private channel must not even acknowledge itself");

    // Someone outside the server can't search it at all.
    let mut outsider = app.member(&mut root, &root_channel, "outsider").await;
    assert_eq!(
        outsider.get(&format!("/api/search?guild_id={guild}&q=launch")).await.0,
        StatusCode::FORBIDDEN
    );
}

#[tokio::test]
async fn dm_search_is_limited_to_your_own_conversations() {
    let app = TestApp::new().await;
    let (mut owner, _guild, channel) = app.owner("alice").await;
    let mut bob = app.member(&mut owner, &channel, "bob").await;
    let mut carol = app.member(&mut owner, &channel, "carol").await;

    let (_, ab) = owner.post("/api/dms", json!({ "usernames": ["bob"] })).await;
    let ab = ab["channel"]["id"].as_str().unwrap().to_string();
    let (_, bc) = bob.post("/api/dms", json!({ "usernames": ["carol"] })).await;
    let bc = bc["channel"]["id"].as_str().unwrap().to_string();
    let mine = say(&mut owner, &ab, "our private plan involves zeppelins").await;
    say(&mut bob, &bc, "bob and carol discuss zeppelins too").await;

    let (_, alices) = owner.get("/api/search?scope=dms&q=zeppelins").await;
    assert_eq!(hit_ids(&alices), vec![mine], "alice must not see bob and carol's chat");

    let (_, carols) = carol.get("/api/search?scope=dms&q=zeppelins").await;
    assert_eq!(hit_ids(&carols).len(), 1);
    // Aiming a channel search at someone else's DM is refused.
    assert_eq!(
        carol.get(&format!("/api/search?channel_id={ab}&q=zeppelins")).await.0,
        StatusCode::FORBIDDEN
    );
}

#[tokio::test]
async fn hostile_or_empty_search_text_is_handled_not_crashed() {
    let app = TestApp::new().await;
    let (mut owner, _guild, channel) = app.owner("root").await;
    say(&mut owner, &channel, "ordinary words").await;

    for q in ["%22", "NEAR%28a+b%29", "content%3Asecret", "%22+OR+1%3D1", "*", "%28%28%28", "-x"] {
        let (status, body) = owner.get(&format!("/api/search?channel_id={channel}&q={q}")).await;
        assert!(
            status == StatusCode::OK || status == StatusCode::BAD_REQUEST,
            "q={q} gave {status}: {body}"
        );
    }
    assert_eq!(
        owner.get(&format!("/api/search?channel_id={channel}&q=")).await.0,
        StatusCode::BAD_REQUEST
    );
    // Scope is mandatory and exclusive.
    assert_eq!(owner.get("/api/search?q=words").await.0, StatusCode::BAD_REQUEST);
    assert_eq!(
        owner.get(&format!("/api/search?channel_id={channel}&scope=dms&q=words")).await.0,
        StatusCode::BAD_REQUEST
    );
}

// --- History windows ------------------------------------------------------

#[tokio::test]
async fn history_can_be_paged_up_down_and_around_a_message() {
    let app = TestApp::new().await;
    let (mut owner, _guild, channel) = app.owner("root").await;
    let mut sent = Vec::new();
    for n in 0..30 {
        sent.push(say(&mut owner, &channel, &format!("message number {n}")).await);
    }
    let path = |query: &str| format!("/api/channels/{channel}/messages?{query}");

    // Latest: the newest `limit`, oldest first.
    let (_, latest) = owner.get(&path("limit=10")).await;
    assert_eq!(ids(&latest), sent[20..30].to_vec());

    // Scrolling up: the page before the oldest one we hold.
    let (_, older) = owner.get(&path(&format!("before={}&limit=10", sent[20]))).await;
    assert_eq!(ids(&older), sent[10..20].to_vec());

    // Scrolling down after a jump.
    let (_, newer) = owner.get(&path(&format!("after={}&limit=10", sent[10]))).await;
    assert_eq!(ids(&newer), sent[11..21].to_vec());

    // Around: the target sits in the middle, with context on both sides.
    let (_, around) = owner.get(&path(&format!("around={}&limit=10", sent[15]))).await;
    let got = ids(&around);
    assert!(got.contains(&sent[15]));
    assert_eq!(got.first(), Some(&sent[10]), "{got:?}");
    assert_eq!(got.last(), Some(&sent[20]), "{got:?}");
    assert!(got.windows(2).all(|w| w[0] < w[1]), "oldest first");

    // At the very edges nothing is invented.
    let (_, before_first) = owner.get(&path(&format!("before={}", sent[0]))).await;
    assert!(ids(&before_first).is_empty());
    let (_, after_last) = owner.get(&path(&format!("after={}", sent[29]))).await;
    assert!(ids(&after_last).is_empty());

    // The windows are mutually exclusive.
    let (status, _) = owner.get(&path(&format!("before={}&after={}", sent[5], sent[2]))).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}
