//! Global admin vs. server admin: who can do what, and what nobody can.

use super::*;
use crate::test_support::PASSWORD;

// --- Global admin vs. server admin ----------------------------------------

#[tokio::test]
async fn only_the_global_admin_can_use_the_admin_endpoints() {
    let app = TestApp::new().await;
    let (mut owner, _guild, channel) = app.owner("root").await;
    let mut member = app.member(&mut owner, &channel, "member").await;

    for path in ["/api/admin/users", "/api/admin/guilds"] {
        assert_eq!(member.get(path).await.0, StatusCode::FORBIDDEN, "{path} for a member");
        assert_eq!(owner.get(path).await.0, StatusCode::OK, "{path} for the global admin");
    }
}

#[tokio::test]
async fn global_admin_sees_every_server_even_ones_they_have_not_joined() {
    let app = TestApp::new().await;
    let (mut owner, first_guild, channel) = app.owner("root").await;
    let mut member = app.member(&mut owner, &channel, "member").await;

    // The member founds their own server; the global admin never joins it.
    let (status, created) = member.post("/api/guilds", json!({ "name": "Their Server" })).await;
    assert_eq!(status, StatusCode::OK, "{created}");
    let their_guild = created["id"].as_str().unwrap().to_string();

    let (_, all) = owner.get("/api/admin/guilds").await;
    let listed = ids(&all);
    assert!(listed.contains(&first_guild) && listed.contains(&their_guild), "{all}");
    let theirs = all.as_array().unwrap().iter().find(|g| g["id"] == their_guild.as_str()).unwrap();
    assert_eq!(theirs["owner_username"], "member");
    assert_eq!(theirs["member_count"], 1);

    // Global admin is not automatically a *member*: no standing inside it.
    assert_eq!(
        owner.get(&format!("/api/guilds/{their_guild}/channels")).await.0,
        StatusCode::FORBIDDEN
    );
}

#[tokio::test]
async fn global_admin_can_reassign_and_delete_servers() {
    let app = TestApp::new().await;
    let (mut owner, _guild, channel) = app.owner("root").await;
    let mut alice = app.member(&mut owner, &channel, "alice").await;
    let bob = app.member(&mut owner, &channel, "bob").await;

    let (_, created) = alice.post("/api/guilds", json!({ "name": "Alice's" })).await;
    let guild = created["id"].as_str().unwrap().to_string();

    // The new owner must already be a member.
    let (status, body) = owner
        .post(&format!("/api/admin/guilds/{guild}/owner"), json!({ "user_id": bob.user_id }))
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
    assert_eq!(body["error"]["code"], "not_a_member");

    // A non-admin can't reach it at all.
    assert_eq!(alice.delete(&format!("/api/admin/guilds/{guild}")).await.0, StatusCode::FORBIDDEN);

    assert_eq!(owner.delete(&format!("/api/admin/guilds/{guild}")).await.0, StatusCode::NO_CONTENT);
    let (_, all) = owner.get("/api/admin/guilds").await;
    assert!(!ids(&all).contains(&guild));
}

#[tokio::test]
async fn global_admin_can_reset_a_password() {
    let app = TestApp::new().await;
    let (mut owner, _guild, channel) = app.owner("root").await;
    let mut member = app.member(&mut owner, &channel, "member").await;
    let path = format!("/api/admin/users/{}/password", member.user_id);

    assert_eq!(member.post(&path, json!({})).await.0, StatusCode::FORBIDDEN);
    let (status, body) =
        owner.post(&format!("/api/admin/users/{}/password", owner.user_id), json!({})).await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");

    let (status, body) = owner.post(&path, json!({})).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let new_password = body["password"].as_str().unwrap().to_string();
    assert_eq!(new_password.len(), 19);

    // Signed out everywhere; the old password no longer works, the new one does.
    assert_eq!(member.get("/api/me").await.0, StatusCode::UNAUTHORIZED);
    let mut fresh = app.client();
    let login = |password: &str| json!({ "username": "member", "password": password });
    assert_eq!(fresh.post("/api/login", login(PASSWORD)).await.0, StatusCode::UNAUTHORIZED);
    assert_eq!(fresh.post("/api/login", login(&new_password)).await.0, StatusCode::OK);

    let (_, log) = owner.get("/api/admin/audit-log").await;
    assert_eq!(log[0]["action"], "global.user_password", "{log}");
}

#[tokio::test]
async fn owner_can_promote_a_server_admin_who_then_runs_the_server() {
    let app = TestApp::new().await;
    let (mut root, _g, root_channel) = app.owner("root").await;
    let mut founder = app.member(&mut root, &root_channel, "founder").await;
    let (_, created) = founder.post("/api/guilds", json!({ "name": "Club" })).await;
    let guild = created["id"].as_str().unwrap().to_string();
    let (_, channels) = founder.get(&format!("/api/guilds/{guild}/channels")).await;
    let club_channel = channels[0]["id"].as_str().unwrap().to_string();

    let mut helper = app.member(&mut founder, &club_channel, "helper").await;

    // A plain member can't manage channels or promote anyone.
    let (status, _) = helper
        .post(&format!("/api/guilds/{guild}/channels"), json!({ "name": "nope", "kind": "text" }))
        .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(
        helper.put(&format!("/api/guilds/{guild}/admins/{}", helper.user_id)).await.0,
        StatusCode::FORBIDDEN
    );

    // The owner promotes them; now they can.
    let helper_id = helper.user_id.clone();
    assert_eq!(
        founder.put(&format!("/api/guilds/{guild}/admins/{helper_id}")).await.0,
        StatusCode::NO_CONTENT
    );
    let (status, made) = helper
        .post(&format!("/api/guilds/{guild}/channels"), json!({ "name": "staff", "kind": "text" }))
        .await;
    assert_eq!(status, StatusCode::OK, "{made}");
    assert_eq!(made["can_manage"], true);
    let staff = made["id"].as_str().unwrap().to_string();

    // …including seeing every private channel, not only ones they're on.
    let (_, secret) = founder
        .post(&format!("/api/guilds/{guild}/channels"), json!({ "name": "secret", "kind": "text" }))
        .await;
    let secret_id = secret["id"].as_str().unwrap().to_string();
    let (_, seen) = helper.get(&format!("/api/guilds/{guild}/channels")).await;
    assert!(ids(&seen).contains(&secret_id), "admin should see restricted channels: {seen}");
    assert_eq!(helper.get(&format!("/api/channels/{secret_id}/roster")).await.0, StatusCode::OK);

    // But an admin isn't the owner: no deleting the server, no handing it over.
    assert_eq!(helper.delete(&format!("/api/guilds/{guild}")).await.0, StatusCode::FORBIDDEN);
    assert_eq!(
        helper
            .post(
                &format!("/api/guilds/{guild}/transfer-ownership"),
                json!({ "user_id": helper_id })
            )
            .await
            .0,
        StatusCode::FORBIDDEN
    );
    // …and can delete a channel (that's a server-level power).
    assert_eq!(
        helper.delete(&format!("/api/guilds/{guild}/channels/{staff}")).await.0,
        StatusCode::NO_CONTENT
    );
}

#[tokio::test]
async fn only_the_owner_can_demote_another_admin_but_anyone_can_step_down() {
    let app = TestApp::new().await;
    let (mut root, _g, root_channel) = app.owner("root").await;
    let mut founder = app.member(&mut root, &root_channel, "founder").await;
    let (_, created) = founder.post("/api/guilds", json!({ "name": "Club" })).await;
    let guild = created["id"].as_str().unwrap().to_string();
    let (_, channels) = founder.get(&format!("/api/guilds/{guild}/channels")).await;
    let channel = channels[0]["id"].as_str().unwrap().to_string();

    let mut a = app.member(&mut founder, &channel, "admin_a").await;
    let mut b = app.member(&mut founder, &channel, "admin_b").await;
    for id in [a.user_id.clone(), b.user_id.clone()] {
        assert_eq!(
            founder.put(&format!("/api/guilds/{guild}/admins/{id}")).await.0,
            StatusCode::NO_CONTENT
        );
    }

    // Admin A can promote but cannot remove admin B, and can't touch the owner.
    assert_eq!(
        a.delete(&format!("/api/guilds/{guild}/admins/{}", b.user_id)).await.0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        a.delete(&format!("/api/guilds/{guild}/admins/{}", founder.user_id)).await.0,
        StatusCode::BAD_REQUEST
    );

    // The owner can; and B can step down on their own.
    assert_eq!(
        founder.delete(&format!("/api/guilds/{guild}/admins/{}", a.user_id)).await.0,
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        b.delete(&format!("/api/guilds/{guild}/admins/{}", b.user_id)).await.0,
        StatusCode::NO_CONTENT
    );
    // Demoted: back to a plain member.
    let (status, _) = a
        .post(&format!("/api/guilds/{guild}/channels"), json!({ "name": "x", "kind": "text" }))
        .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn a_member_with_only_kick_permission_cannot_remove_a_server_admin() {
    let app = TestApp::new().await;
    let (mut root, _g, root_channel) = app.owner("root").await;
    let mut founder = app.member(&mut root, &root_channel, "founder").await;
    let (_, created) = founder.post("/api/guilds", json!({ "name": "Club" })).await;
    let guild = created["id"].as_str().unwrap().to_string();
    let (_, channels) = founder.get(&format!("/api/guilds/{guild}/channels")).await;
    let channel = channels[0]["id"].as_str().unwrap().to_string();

    let mut mod_ = app.member(&mut founder, &channel, "mod").await;
    let admin = app.member(&mut founder, &channel, "admin").await;
    founder.put(&format!("/api/guilds/{guild}/admins/{}", admin.user_id)).await;

    // A "Moderator" role that can only kick.
    let (status, role) = founder
        .post(
            &format!("/api/guilds/{guild}/roles"),
            json!({ "name": "Moderator", "permissions": "KICK_MEMBERS" }),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{role}");
    let role_id = role["id"].as_str().unwrap();
    founder
        .post(&format!("/api/guilds/{guild}/members/{}/roles/{role_id}", mod_.user_id), json!({}))
        .await;

    assert_eq!(
        mod_.delete(&format!("/api/guilds/{guild}/members/{}", admin.user_id)).await.0,
        StatusCode::FORBIDDEN
    );
    // The owner still can.
    assert_eq!(
        founder.delete(&format!("/api/guilds/{guild}/members/{}", admin.user_id)).await.0,
        StatusCode::NO_CONTENT
    );
}

#[tokio::test]
async fn channels_have_no_per_channel_admins_any_more() {
    let app = TestApp::new().await;
    let (mut owner, _guild, channel) = app.owner("root").await;
    let helper = app.member(&mut owner, &channel, "helper").await;

    let (_, roster) = owner.get(&format!("/api/channels/{channel}/roster")).await;
    assert!(roster.get("admins").is_none(), "roster must only list members: {roster}");
    let (status, _) = owner
        .post(&format!("/api/channels/{channel}/admins"), json!({ "user_id": helper.user_id }))
        .await;
    assert!(
        status == StatusCode::NOT_FOUND || status == StatusCode::METHOD_NOT_ALLOWED,
        "the per-channel admin route should be gone, got {status}"
    );
}
