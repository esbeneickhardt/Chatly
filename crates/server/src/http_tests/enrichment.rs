//! A page of messages carries each message's own attachments, reactions,
//! mentions and reply preview — the read path fills them in with one query
//! per table for the whole page, so these pin that nothing leaks between
//! messages.

use protocol::Id;

use super::*;
use crate::models::NewFile;

async fn attach_file(app: &TestApp, uploader: &str, name: &str) -> String {
    let id = app.state.snowflake.next_id();
    app.state
        .storage
        .create_file(NewFile {
            id,
            uploader_id: uploader.parse::<Id>().unwrap(),
            filename: name.into(),
            mime: "text/plain".into(),
            size: 3,
            sha256: "00".into(),
        })
        .await
        .unwrap();
    id.to_string()
}

#[tokio::test]
async fn each_message_in_a_page_keeps_its_own_attachments_reactions_mentions_and_reply() {
    let app = TestApp::new().await;
    let (mut alice, _guild, channel) = app.owner("alice").await;
    let mut bob = app.member(&mut alice, &channel, "bob").await;

    let one_file = attach_file(&app, &alice.user_id, "one.txt").await;
    let two_file = attach_file(&app, &alice.user_id, "two.txt").await;
    let extra_file = attach_file(&app, &alice.user_id, "extra.txt").await;

    let post = |content: &str, files: Vec<&str>, reply_to: Option<&str>| json!({ "content": content, "attachment_ids": files, "reply_to": reply_to });
    let (_, first) = alice
        .post(&format!("/api/channels/{channel}/messages"), post("first", vec![&one_file], None))
        .await;
    let (_, second) = alice
        .post(
            &format!("/api/channels/{channel}/messages"),
            post("hi @bob", vec![&two_file, &extra_file], None),
        )
        .await;
    let plain = say(&mut alice, &channel, "plain").await;
    let first_id = first["id"].as_str().unwrap().to_string();
    let second_id = second["id"].as_str().unwrap().to_string();
    let (_, reply) = bob
        .post(
            &format!("/api/channels/{channel}/messages"),
            post("re: first", vec![], Some(&first_id)),
        )
        .await;
    let reply_id = reply["id"].as_str().unwrap().to_string();

    // Reactions: bob likes `first` and `second`; alice likes `second` too.
    for m in [&first_id, &second_id] {
        let (status, _) =
            bob.post(&format!("/api/messages/{m}/reactions/%F0%9F%91%8D"), json!({})).await;
        assert_eq!(status, StatusCode::OK);
    }
    let (status, _) =
        alice.post(&format!("/api/messages/{second_id}/reactions/%F0%9F%91%8D"), json!({})).await;
    assert_eq!(status, StatusCode::OK);

    let (status, page) = alice.get(&format!("/api/channels/{channel}/messages?limit=50")).await;
    assert_eq!(status, StatusCode::OK, "{page}");
    let by_id = |id: &str| {
        page.as_array()
            .unwrap()
            .iter()
            .find(|m| m["id"] == id)
            .unwrap_or_else(|| panic!("{id} missing"))
            .clone()
    };

    let first = by_id(&first_id);
    assert_eq!(first["attachments"].as_array().unwrap().len(), 1);
    assert_eq!(first["attachments"][0]["filename"], "one.txt");
    assert_eq!(first["reactions"][0]["count"], 1);
    assert_eq!(first["reactions"][0]["reacted_by_me"], false);
    assert!(first["mentions"].as_array().unwrap().is_empty());

    let second = by_id(&second_id);
    let names: Vec<&str> = second["attachments"]
        .as_array()
        .unwrap()
        .iter()
        .map(|f| f["filename"].as_str().unwrap())
        .collect();
    assert_eq!(names.len(), 2);
    assert!(names.contains(&"two.txt") && names.contains(&"extra.txt"));
    assert_eq!(second["reactions"][0]["count"], 2);
    assert_eq!(second["reactions"][0]["reacted_by_me"], true);
    assert_eq!(second["mentions"].as_array().unwrap().len(), 1);
    assert_eq!(second["mentions"][0], bob.user_id.as_str());

    let plain = by_id(&plain);
    assert!(plain["attachments"].as_array().unwrap().is_empty());
    assert!(plain["reactions"].as_array().unwrap().is_empty());
    assert!(plain["mentions"].as_array().unwrap().is_empty());

    // The reply shows the replied-to message's attachment, not its own.
    let reply = by_id(&reply_id);
    assert!(reply["attachments"].as_array().unwrap().is_empty());
    assert_eq!(reply["reply_preview"]["attachment_count"], 1);
    assert_eq!(reply["reply_preview"]["first_attachment"]["filename"], "one.txt");
}
