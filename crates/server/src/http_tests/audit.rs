//! The audit log at both administration levels.

use super::*;

// --- Audit log ------------------------------------------------------------

#[tokio::test]
async fn server_admin_actions_are_recorded_and_visible_only_to_admins() {
    let app = TestApp::new().await;
    let (mut root, _g, root_channel) = app.owner("root").await;
    let mut founder = app.member(&mut root, &root_channel, "founder").await;
    let (_, created) = founder.post("/api/guilds", json!({ "name": "Club" })).await;
    let guild = created["id"].as_str().unwrap().to_string();
    let (_, channels) = founder.get(&format!("/api/guilds/{guild}/channels")).await;
    let channel = channels[0]["id"].as_str().unwrap().to_string();
    let mut helper = app.member(&mut founder, &channel, "helper").await;
    let mut plain = app.member(&mut founder, &channel, "plain").await;

    founder.put(&format!("/api/guilds/{guild}/admins/{}", helper.user_id)).await;
    founder
        .post(&format!("/api/guilds/{guild}/channels"), json!({ "name": "staff", "kind": "text" }))
        .await;
    founder.delete(&format!("/api/guilds/{guild}/members/{}", plain.user_id)).await;

    let (status, log) = founder.get(&format!("/api/guilds/{guild}/audit-log")).await;
    assert_eq!(status, StatusCode::OK, "{log}");
    let actions: Vec<&str> =
        log.as_array().unwrap().iter().map(|e| e["action"].as_str().unwrap()).collect();
    // Newest first.
    assert_eq!(actions, vec!["member.kick", "channel.create", "admin.grant"], "{log}");
    assert_eq!(log[0]["actor_name"], "founder");
    assert_eq!(log[0]["target_name"], "plain");
    assert_eq!(log[1]["target_name"], "staff");

    // A server admin can read it; an ordinary member (or the removed one) can't.
    assert_eq!(helper.get(&format!("/api/guilds/{guild}/audit-log")).await.0, StatusCode::OK);
    assert_eq!(plain.get(&format!("/api/guilds/{guild}/audit-log")).await.0, StatusCode::FORBIDDEN);
    let outsider = app.member(&mut root, &root_channel, "outsider").await;
    let mut outsider = outsider;
    assert_eq!(
        outsider.get(&format!("/api/guilds/{guild}/audit-log")).await.0,
        StatusCode::FORBIDDEN
    );

    // Paging by the newest-first cursor.
    let last = log[0]["id"].as_str().unwrap();
    let (_, older) =
        founder.get(&format!("/api/guilds/{guild}/audit-log?before={last}&limit=1")).await;
    assert_eq!(older.as_array().unwrap().len(), 1);
    assert_eq!(older[0]["action"], "channel.create");
}

#[tokio::test]
async fn global_admin_actions_are_logged_at_deployment_level_and_survive_the_server() {
    let app = TestApp::new().await;
    let (mut root, _g, root_channel) = app.owner("root").await;
    let mut founder = app.member(&mut root, &root_channel, "founder").await;
    let (_, created) = founder.post("/api/guilds", json!({ "name": "Doomed Club" })).await;
    let guild = created["id"].as_str().unwrap().to_string();

    assert_eq!(root.delete(&format!("/api/admin/guilds/{guild}")).await.0, StatusCode::NO_CONTENT);

    let (status, log) = root.get("/api/admin/audit-log").await;
    assert_eq!(status, StatusCode::OK, "{log}");
    assert_eq!(log[0]["action"], "global.guild_delete");
    assert_eq!(log[0]["target_name"], "Doomed Club");
    assert!(
        log[0]["guild_id"].is_null(),
        "recorded at deployment level, not under the deleted server"
    );

    // Only the global admin may read it.
    assert_eq!(founder.get("/api/admin/audit-log").await.0, StatusCode::FORBIDDEN);
}
