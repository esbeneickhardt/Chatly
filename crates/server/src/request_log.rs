//! One structured log line per API request, with a request id that's also
//! returned to the caller — so "it failed for me around 14:02" can be
//! matched to exactly one line, and a reverse proxy that sets
//! `X-Request-Id` gets the same id end to end.
//!
//! Deliberately logs the *path without its query string*: queries carry
//! things like search terms that have no business in a log. Static assets
//! and the health check are skipped (noise); the gateway upgrade is logged
//! like any other request.

use std::time::Instant;

use axum::extract::Request;
use axum::http::{HeaderName, HeaderValue};
use axum::middleware::Next;
use axum::response::Response;
use rand::Rng;

const HEADER: HeaderName = HeaderName::from_static("x-request-id");
const ALPHABET: &[u8] = b"abcdefghijklmnopqrstuvwxyz0123456789";

/// An id a caller supplied is only trusted if it's short and plain — it
/// ends up in logs and a response header.
fn acceptable(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

fn fresh_id() -> String {
    let mut rng = rand::thread_rng();
    (0..12).map(|_| ALPHABET[rng.gen_range(0..ALPHABET.len())] as char).collect()
}

pub async fn apply(req: Request, next: Next) -> Response {
    let path = req.uri().path().to_string();
    let logged = path.starts_with("/api") || path == "/gateway";
    let id = req
        .headers()
        .get(&HEADER)
        .and_then(|v| v.to_str().ok())
        .filter(|v| acceptable(v))
        .map(str::to_string)
        .unwrap_or_else(fresh_id);
    let method = req.method().clone();
    let started = Instant::now();

    let mut response = next.run(req).await;

    if let Ok(value) = HeaderValue::from_str(&id) {
        response.headers_mut().insert(HEADER, value);
    }
    if logged {
        let status = response.status().as_u16();
        let ms = started.elapsed().as_millis() as u64;
        if status >= 500 {
            tracing::error!(request_id = %id, %method, %path, status, ms, "request failed");
        } else {
            tracing::info!(request_id = %id, %method, %path, status, ms, "request");
        }
    }
    response
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::http::Request as HttpRequest;
    use axum::middleware::from_fn;
    use axum::routing::get;
    use axum::Router;
    use tower::ServiceExt;

    async fn id_of(request_id: Option<&str>) -> String {
        let app = Router::new().route("/api/x", get(|| async { "ok" })).layer(from_fn(apply));
        let mut builder = HttpRequest::builder().uri("/api/x");
        if let Some(id) = request_id {
            builder = builder.header("x-request-id", id);
        }
        let response = app.oneshot(builder.body(Body::empty()).unwrap()).await.unwrap();
        response.headers()["x-request-id"].to_str().unwrap().to_string()
    }

    #[tokio::test]
    async fn every_response_carries_a_request_id() {
        let id = id_of(None).await;
        assert_eq!(id.len(), 12);
        assert!(id.bytes().all(|b| b.is_ascii_alphanumeric()));
    }

    #[tokio::test]
    async fn a_plain_id_from_a_proxy_is_kept() {
        assert_eq!(id_of(Some("proxy-abc_123")).await, "proxy-abc_123");
    }

    #[tokio::test]
    async fn a_hostile_or_oversized_id_is_replaced() {
        for bad in ["has space", "new\\nline", &"x".repeat(200), "<script>"] {
            let id = id_of(Some(bad)).await;
            assert_ne!(id, bad);
            assert_eq!(id.len(), 12);
        }
    }
}
