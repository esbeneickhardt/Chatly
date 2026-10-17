//! End-to-end tests over the real router and database (see
//! `test_support`): the two administration levels, server-level channel
//! management, the DM rules, search, history windows and the audit log.
//! These pin behaviour that's easy to break silently and expensive to
//! re-verify by hand. One file per area; shared helpers live here.

mod admin;
mod audit;
mod dms;
mod enrichment;
mod push;
mod search;

use axum::http::StatusCode;
use serde_json::json;

use crate::test_support::{TestApp, TestClient};

pub(super) fn ids(list: &serde_json::Value) -> Vec<String> {
    list.as_array().unwrap().iter().map(|v| v["id"].as_str().unwrap().to_string()).collect()
}

pub(super) fn ids_of_channels(list: &serde_json::Value) -> Vec<String> {
    list.as_array()
        .unwrap()
        .iter()
        .map(|v| v["channel"]["id"].as_str().unwrap().to_string())
        .collect()
}

pub(super) async fn say(client: &mut TestClient, channel: &str, text: &str) -> String {
    let (status, body) =
        client.post(&format!("/api/channels/{channel}/messages"), json!({ "content": text })).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    body["id"].as_str().unwrap().to_string()
}

pub(super) fn hit_ids(body: &serde_json::Value) -> Vec<String> {
    ids(body)
}
