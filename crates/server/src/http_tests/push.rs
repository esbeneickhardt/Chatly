//! Web Push subscriptions.

use super::*;
use serde_json::Value;

fn subscription(endpoint: &str) -> Value {
    json!({
        "endpoint": endpoint,
        "keys": {
            "p256dh": "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
            "auth": "BTBZMqHH6r4Tts7J_aSIgg",
        },
    })
}

async fn subscription_count(app: &TestApp) -> usize {
    let users = app.state.storage.list_all_users_for_admin().await.unwrap();
    app.state
        .storage
        .push_subscriptions_for(users.into_iter().map(|u| u.id).collect())
        .await
        .unwrap()
        .len()
}

#[tokio::test]
async fn a_browser_subscribes_and_unsubscribes() {
    let app = TestApp::new().await;
    let (mut root, _, _) = app.owner("root").await;

    let (status, key) = root.get("/api/push/key").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(key["public_key"].as_str().unwrap().len(), 87, "65 bytes, base64url");

    let endpoint = "https://fcm.googleapis.com/fcm/send/abc";
    let (status, body) = root.post("/api/push/subscriptions", subscription(endpoint)).await;
    assert_eq!(status, StatusCode::NO_CONTENT, "{body}");
    // Subscribing again is harmless.
    root.post("/api/push/subscriptions", subscription(endpoint)).await;
    assert_eq!(subscription_count(&app).await, 1);

    root.post("/api/push/subscriptions/remove", json!({ "endpoint": endpoint })).await;
    assert_eq!(subscription_count(&app).await, 0);
}

#[tokio::test]
async fn only_push_services_are_accepted() {
    let app = TestApp::new().await;
    let (mut root, _, _) = app.owner("root").await;
    for endpoint in
        ["https://192.168.0.1/x", "http://fcm.googleapis.com/x", "https://example.com/x"]
    {
        let (status, _) = root.post("/api/push/subscriptions", subscription(endpoint)).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{endpoint}");
    }
    assert_eq!(subscription_count(&app).await, 0);
}

#[tokio::test]
async fn logging_out_ends_the_devices_notifications() {
    let app = TestApp::new().await;
    let (mut root, _, _) = app.owner("root").await;
    root.post("/api/push/subscriptions", subscription("https://web.push.apple.com/abc")).await;
    assert_eq!(subscription_count(&app).await, 1);
    root.post("/api/logout", json!({})).await;
    assert_eq!(subscription_count(&app).await, 0);
}

#[tokio::test]
async fn someone_elses_subscription_cannot_be_removed() {
    let app = TestApp::new().await;
    let (mut root, _, channel) = app.owner("root").await;
    let mut other = app.member(&mut root, &channel, "other").await;
    let endpoint = "https://fcm.googleapis.com/fcm/send/mine";
    root.post("/api/push/subscriptions", subscription(endpoint)).await;
    other.post("/api/push/subscriptions/remove", json!({ "endpoint": endpoint })).await;
    assert_eq!(subscription_count(&app).await, 1);
}
