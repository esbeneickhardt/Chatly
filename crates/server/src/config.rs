//! Configuration from environment variables, with an optional TOML file
//! providing defaults. Environment variables always win.
//!
//! ## Keys
//!
//! | Env var         | Config file key  | Default             | Meaning                                          |
//! |-----------------|------------------|----------------------|---------------------------------------------------|
//! | `LISTEN_ADDR`   | `listen_addr`    | `0.0.0.0:8080`       | Address the HTTP server binds to                  |
//! | `DATA_DIR`      | `data_dir`       | `./data`             | Root for `chat.db` and `files/`                   |
//! | `LOG_LEVEL`     | `log_level`      | `info`               | `tracing` env-filter directive                    |
//! | `CONFIG_FILE`   | —                | `./config.toml`      | Path to the optional TOML config file             |
//! | `SECRET_KEY`    | —                | generated & persisted| Base64 32-byte key encrypting TOTP secrets at rest|
//! | `PUBLIC_URL`    | `public_url`     | `http://localhost:8080` | Used in invite links and the TOTP issuer name  |
//! | `TRUSTED_PROXY` | `trusted_proxy`  | unset                | IP of a reverse proxy to trust `X-Forwarded-For` from |
//! | `INSTANCE_NAME` | `instance_name`  | `Chatly`             | Shown as the TOTP issuer in authenticator apps    |
//! | `MAX_UPLOAD_MB` | `max_upload_mb`  | `1024`               | Largest file attachment accepted, in megabytes    |
//! | `VOICE_PORT`    | `voice_port`     | `50000`              | UDP port the voice SFU listens on                 |
//! | `VOICE_PUBLIC_IP` | `voice_public_ip` | unset            | Public IP to advertise as an ICE candidate; without it, only same-host/LAN peers can connect |
//! | `TURN_SECRET`   | `turn_secret`    | unset                | Shared secret with a coturn instance (`--static-auth-secret`); without it, no TURN relay is offered and only peers that can reach each other's networks directly can connect |
//! | `TURN_HOST`     | `turn_host`      | `voice_public_ip`    | Host/IP clients reach the TURN server at, if different from the voice SFU's own public IP |
//! | `TURN_PORT`     | `turn_port`      | `3478`               | Port the TURN server listens on                   |

use std::net::{IpAddr, SocketAddr};
use std::path::PathBuf;

use serde::Deserialize;

#[derive(Debug, Clone)]
pub struct Config {
    pub listen_addr: SocketAddr,
    pub data_dir: PathBuf,
    pub log_level: String,
    pub public_url: String,
    pub trusted_proxy: Option<IpAddr>,
    pub instance_name: String,
    pub max_upload_bytes: u64,
    pub voice_port: u16,
    pub voice_public_ip: Option<IpAddr>,
    pub turn_secret: Option<String>,
    pub turn_host: Option<String>,
    pub turn_port: u16,
}

#[derive(Debug, Default, Deserialize)]
struct ConfigFile {
    listen_addr: Option<String>,
    data_dir: Option<String>,
    log_level: Option<String>,
    public_url: Option<String>,
    trusted_proxy: Option<String>,
    instance_name: Option<String>,
    max_upload_mb: Option<u64>,
    voice_port: Option<u16>,
    voice_public_ip: Option<String>,
    turn_secret: Option<String>,
    turn_host: Option<String>,
    turn_port: Option<u16>,
}

#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    #[error("failed to read config file {path}: {source}")]
    ReadFile {
        path: String,
        #[source]
        source: std::io::Error,
    },
    #[error("failed to parse config file {path}: {source}")]
    ParseFile {
        path: String,
        #[source]
        source: toml::de::Error,
    },
    #[error("invalid LISTEN_ADDR/listen_addr value {value:?}: {source}")]
    InvalidListenAddr {
        value: String,
        #[source]
        source: std::net::AddrParseError,
    },
    #[error("invalid TRUSTED_PROXY/trusted_proxy value {value:?}: {source}")]
    InvalidTrustedProxy {
        value: String,
        #[source]
        source: std::net::AddrParseError,
    },
    #[error("invalid MAX_UPLOAD_MB/max_upload_mb value {value:?}: {source}")]
    InvalidMaxUploadMb {
        value: String,
        #[source]
        source: std::num::ParseIntError,
    },
    #[error("invalid VOICE_PORT/voice_port value {value:?}: {source}")]
    InvalidVoicePort {
        value: String,
        #[source]
        source: std::num::ParseIntError,
    },
    #[error("invalid VOICE_PUBLIC_IP/voice_public_ip value {value:?}: {source}")]
    InvalidVoicePublicIp {
        value: String,
        #[source]
        source: std::net::AddrParseError,
    },
    #[error("invalid TURN_PORT/turn_port value {value:?}: {source}")]
    InvalidTurnPort {
        value: String,
        #[source]
        source: std::num::ParseIntError,
    },
}

impl Config {
    /// Loads config from `CONFIG_FILE` (if it exists) and environment
    /// variables. Environment variables override the file; both are
    /// optional and defaults apply where neither is set.
    pub fn load() -> Result<Config, ConfigError> {
        let config_path = std::env::var("CONFIG_FILE").unwrap_or_else(|_| "./config.toml".into());
        let file = if std::path::Path::new(&config_path).exists() {
            let contents = std::fs::read_to_string(&config_path)
                .map_err(|source| ConfigError::ReadFile { path: config_path.clone(), source })?;
            toml::from_str(&contents)
                .map_err(|source| ConfigError::ParseFile { path: config_path.clone(), source })?
        } else {
            ConfigFile::default()
        };

        let listen_addr_str = std::env::var("LISTEN_ADDR")
            .ok()
            .or(file.listen_addr)
            .unwrap_or_else(|| "0.0.0.0:8080".to_string());
        let listen_addr = listen_addr_str.parse().map_err(|source| {
            ConfigError::InvalidListenAddr { value: listen_addr_str.clone(), source }
        })?;

        let data_dir = std::env::var("DATA_DIR")
            .ok()
            .or(file.data_dir)
            .unwrap_or_else(|| "./data".to_string())
            .into();

        let log_level = std::env::var("LOG_LEVEL")
            .ok()
            .or(file.log_level)
            .unwrap_or_else(|| "info".to_string());

        let public_url = std::env::var("PUBLIC_URL")
            .ok()
            .or(file.public_url)
            .unwrap_or_else(|| "http://localhost:8080".to_string())
            .trim_end_matches('/')
            .to_string();

        let trusted_proxy = match std::env::var("TRUSTED_PROXY").ok().or(file.trusted_proxy) {
            Some(value) if !value.is_empty() => Some(
                value
                    .parse()
                    .map_err(|source| ConfigError::InvalidTrustedProxy { value, source })?,
            ),
            _ => None,
        };

        let instance_name = std::env::var("INSTANCE_NAME")
            .ok()
            .or(file.instance_name)
            .unwrap_or_else(|| "Chatly".to_string());

        let max_upload_mb = match std::env::var("MAX_UPLOAD_MB").ok() {
            Some(value) => {
                value.parse().map_err(|source| ConfigError::InvalidMaxUploadMb { value, source })?
            }
            None => file.max_upload_mb.unwrap_or(1024),
        };

        let voice_port = match std::env::var("VOICE_PORT").ok() {
            Some(value) => {
                value.parse().map_err(|source| ConfigError::InvalidVoicePort { value, source })?
            }
            None => file.voice_port.unwrap_or(50000),
        };

        let voice_public_ip = match std::env::var("VOICE_PUBLIC_IP").ok().or(file.voice_public_ip) {
            Some(value) if !value.is_empty() => Some(
                value
                    .parse()
                    .map_err(|source| ConfigError::InvalidVoicePublicIp { value, source })?,
            ),
            _ => None,
        };

        let turn_secret =
            std::env::var("TURN_SECRET").ok().or(file.turn_secret).filter(|v| !v.is_empty());
        let turn_host =
            std::env::var("TURN_HOST").ok().or(file.turn_host).filter(|v| !v.is_empty());
        let turn_port = match std::env::var("TURN_PORT").ok() {
            Some(value) => {
                value.parse().map_err(|source| ConfigError::InvalidTurnPort { value, source })?
            }
            None => file.turn_port.unwrap_or(3478),
        };

        Ok(Config {
            listen_addr,
            data_dir,
            log_level,
            public_url,
            trusted_proxy,
            instance_name,
            max_upload_bytes: max_upload_mb * 1_000_000,
            voice_port,
            voice_public_ip,
            turn_secret,
            turn_host,
            turn_port,
        })
    }
}
