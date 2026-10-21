//! In-process HTTP test harness: builds the real router over a real
//! (temp-dir) SQLite database and drives it with `tower::ServiceExt::
//! oneshot`, so a test exercises exactly what a browser would — routing,
//! the CSRF header, cookie sessions, extractors, permission checks,
//! storage — without opening a socket. Each `TestApp` is fully isolated.

use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::Arc;

use axum::body::Body;
use axum::extract::ConnectInfo;
use axum::http::{Method, Request, StatusCode};
use axum::middleware::from_fn;
use axum::Router;
use serde_json::{json, Value};
use tower::ServiceExt;

use crate::config::Config;
use crate::gateway::GatewayHub;
use crate::secret_key::SecretKey;
use crate::snowflake::SnowflakeGenerator;
use crate::state::{AppState, RateLimiters, SharedState};
use crate::storage::SqliteStorage;
use crate::{api, auth, csrf, sysstats, voice};

pub const PASSWORD: &str = "correct-horse-battery";

pub struct TestApp {
    /// For tests that need to seed or inspect storage directly.
    #[allow(dead_code)]
    pub state: SharedState,
    router: Router,
    next_octet: AtomicU8,
    _dir: tempfile::TempDir,
}

impl TestApp {
    pub async fn new() -> Self {
        let dir = tempfile::tempdir().expect("temp dir");
        let config = Config {
            listen_addr: "127.0.0.1:0".parse().unwrap(),
            data_dir: dir.path().to_path_buf(),
            log_level: "warn".into(),
            public_url: "http://localhost".into(),
            trusted_proxy: None,
            instance_name: "Test".into(),
            max_upload_bytes: 1024 * 1024,
            voice_port: 0,
            voice_public_ip: None,
            turn_secret: None,
            turn_host: None,
            turn_port: 3478,
        };
        let storage = SqliteStorage::open(dir.path()).expect("open storage");
        let secret_key = SecretKey::load_or_create(dir.path()).expect("secret key");
        let gateway = Arc::new(GatewayHub::new());
        let voice = voice::spawn(0, None, gateway.clone()).expect("voice");
        let storage: Arc<dyn crate::storage::Storage> = Arc::new(storage);
        let push = crate::push::PushService::new(
            crate::push::VapidKey::load_or_create(dir.path()).expect("vapid key"),
            &config.public_url,
            storage.clone(),
        );
        let state: SharedState = Arc::new(AppState {
            storage,
            snowflake: SnowflakeGenerator::new(0),
            secret_key,
            preauth: auth::preauth::PreAuthStore::new(),
            rate_limits: RateLimiters::default(),
            config: config.clone(),
            gateway,
            voice,
            stats: sysstats::spawn(),
            push,
            app_icon: Arc::new(crate::app_icon::AppIcon::load(dir.path())),
        });
        let router = Router::new()
            .nest("/api", api::router(config.max_upload_bytes).layer(from_fn(csrf::require_header)))
            .with_state(state.clone());
        Self { state, router, next_octet: AtomicU8::new(1), _dir: dir }
    }

    /// A fresh, logged-out client with its own peer IP (registration is
    /// rate-limited per IP, so tests must not share one).
    pub fn client(&self) -> TestClient {
        let octet = self.next_octet.fetch_add(1, Ordering::Relaxed);
        TestClient {
            router: self.router.clone(),
            peer: SocketAddr::new(IpAddr::V4(Ipv4Addr::new(10, 0, 0, octet)), 40000),
            cookie: None,
            user_id: String::new(),
        }
    }

    /// The instance owner's client — the first account registered — plus
    /// the id of the server (guild) and general channel it starts with.
    pub async fn owner(&self, username: &str) -> (TestClient, String, String) {
        let mut client = self.client();
        client.register(username, None).await;
        let guilds = client.get("/api/guilds").await.1;
        let guild_id = guilds[0]["id"].as_str().unwrap().to_string();
        let channels = client.get(&format!("/api/guilds/{guild_id}/channels")).await.1;
        let channel_id = channels[0]["id"].as_str().unwrap().to_string();
        (client, guild_id, channel_id)
    }

    /// A new account that joined `guild_id` through an invite `inviter`
    /// created — the only way anyone but the first user gets in.
    pub async fn member(
        &self,
        inviter: &mut TestClient,
        channel_id: &str,
        username: &str,
    ) -> TestClient {
        let (status, invite) =
            inviter.post("/api/invites", json!({ "channel_id": channel_id })).await;
        assert_eq!(status, StatusCode::OK, "create invite: {invite}");
        let mut client = self.client();
        client.register(username, invite["code"].as_str()).await;
        client
    }
}

pub struct TestClient {
    router: Router,
    peer: SocketAddr,
    cookie: Option<String>,
    pub user_id: String,
}

impl TestClient {
    pub async fn request(
        &mut self,
        method: Method,
        path: &str,
        body: Option<Value>,
    ) -> (StatusCode, Value) {
        let mut builder = Request::builder()
            .method(method)
            .uri(path)
            .header("x-requested-with", "XMLHttpRequest");
        if let Some(cookie) = &self.cookie {
            builder = builder.header("cookie", cookie);
        }
        let request = match body {
            Some(json) => builder
                .header("content-type", "application/json")
                .body(Body::from(json.to_string())),
            None => builder.body(Body::empty()),
        }
        .unwrap();
        let mut request = request;
        request.extensions_mut().insert(ConnectInfo(self.peer));

        let response = self.router.clone().oneshot(request).await.expect("router is infallible");
        let status = response.status();
        if let Some(set_cookie) = response.headers().get("set-cookie").and_then(|v| v.to_str().ok())
        {
            if let Some(pair) = set_cookie.split(';').next().filter(|p| p.starts_with("session=")) {
                self.cookie = Some(pair.to_string());
            }
        }
        let bytes = axum::body::to_bytes(response.into_body(), 1024 * 1024).await.unwrap();
        let value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
        (status, value)
    }

    pub async fn get(&mut self, path: &str) -> (StatusCode, Value) {
        self.request(Method::GET, path, None).await
    }
    pub async fn post(&mut self, path: &str, body: Value) -> (StatusCode, Value) {
        self.request(Method::POST, path, Some(body)).await
    }
    pub async fn put(&mut self, path: &str) -> (StatusCode, Value) {
        self.request(Method::PUT, path, Some(json!({}))).await
    }
    pub async fn delete(&mut self, path: &str) -> (StatusCode, Value) {
        self.request(Method::DELETE, path, None).await
    }

    /// Registers this client's account (logging it in via the session
    /// cookie the response sets) and remembers its user id.
    pub async fn register(&mut self, username: &str, invite_code: Option<&str>) {
        let mut body = json!({
            "username": username,
            "display_name": username,
            "password": PASSWORD,
        });
        if let Some(code) = invite_code {
            body["invite_code"] = json!(code);
        }
        let (status, value) = self.post("/api/register", body).await;
        assert_eq!(status, StatusCode::OK, "register {username}: {value}");
        self.user_id = value["user"]["id"].as_str().unwrap().to_string();
    }
}
