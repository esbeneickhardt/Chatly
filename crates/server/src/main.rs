mod api;
mod app_icon;
mod auth;
mod cli;
mod client_ip;
mod config;
mod csrf;
mod gateway;
mod healthz;
mod models;
mod push;
mod qr;
mod ratelimit;
mod request_log;
mod secret_key;
mod security_headers;
mod shutdown;
mod snowflake;
mod state;
mod static_files;
mod storage;
mod sync;
mod sysstats;
mod time;
mod voice;

#[cfg(test)]
mod file_size_tests;
#[cfg(test)]
mod http_tests;
#[cfg(test)]
mod load_tests;
#[cfg(test)]
mod test_support;

use std::net::SocketAddr;
use std::sync::Arc;

use axum::middleware::from_fn;
use axum::routing::get;
use axum::Router;
use tracing_subscriber::EnvFilter;

use config::Config;
use gateway::GatewayHub;
use secret_key::SecretKey;
use snowflake::SnowflakeGenerator;
use state::AppState;
use storage::{SqliteStorage, Storage};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let command = match cli::parse(&args) {
        Ok(command) => command,
        Err(message) => {
            eprintln!("{message}\n\n{}", cli::USAGE);
            std::process::exit(2);
        }
    };
    if command != cli::Command::Serve {
        // Operator commands need only the data directory, not a running
        // server or a valid listen address.
        let data_dir = Config::load().map(|c| c.data_dir).unwrap_or_else(|_| "./data".into());
        return cli::run(command, &data_dir).await;
    }

    let config = Config::load()?;

    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_new(&config.log_level).unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    let storage = SqliteStorage::open(&config.data_dir)?;
    storage.health_check().await?;
    tracing::info!(data_dir = %config.data_dir.display(), "storage ready");

    let secret_key = SecretKey::load_or_create(&config.data_dir)?;
    // Built before the SFU (and handed to it) rather than after, so a
    // connection the SFU itself times out (see `ICE_DISCONNECT_GRACE`)
    // can publish that departure immediately instead of only ever being
    // noticed later by the gateway's own, much slower heartbeat timeout.
    let gateway = Arc::new(GatewayHub::new());
    let voice = voice::spawn(config.voice_port, config.voice_public_ip, gateway.clone())?;
    tracing::info!(port = config.voice_port, "voice SFU listening (UDP)");

    let storage: Arc<dyn Storage> = Arc::new(storage);
    let push = push::PushService::new(
        push::VapidKey::load_or_create(&config.data_dir)?,
        &config.public_url,
        storage.clone(),
    );

    let app_icon = Arc::new(app_icon::AppIcon::load(&config.data_dir));

    let shared_state = Arc::new(AppState {
        storage,
        snowflake: SnowflakeGenerator::new(0),
        secret_key,
        preauth: auth::preauth::PreAuthStore::new(),
        rate_limits: state::RateLimiters::default(),
        config: config.clone(),
        gateway,
        voice,
        stats: sysstats::spawn(),
        push,
        app_icon: app_icon.clone(),
    });

    let stateful = Router::new()
        .nest("/api", api::router(config.max_upload_bytes).layer(from_fn(csrf::require_header)))
        .route("/gateway", get(gateway::handler))
        .with_state(shared_state);

    let app = Router::new()
        .merge(healthz::router())
        .merge(stateful)
        .fallback_service(static_files::router(app_icon))
        .layer(from_fn(security_headers::apply))
        .layer(from_fn(request_log::apply));

    let listener = tokio::net::TcpListener::bind(config.listen_addr).await?;
    tracing::info!(addr = %config.listen_addr, "listening on {}", config.listen_addr);

    axum::serve(listener, app.into_make_service_with_connect_info::<SocketAddr>())
        .with_graceful_shutdown(shutdown::signal())
        .await?;

    Ok(())
}
