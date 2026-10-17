use std::sync::Arc;
use std::time::Duration;

use crate::auth::preauth::PreAuthStore;
use crate::config::Config;
use crate::gateway::GatewayHub;
use crate::push::PushService;
use crate::ratelimit::RateLimiter;
use crate::secret_key::SecretKey;
use crate::snowflake::SnowflakeGenerator;
use crate::storage::Storage;
use crate::sysstats::StatsMonitor;
use crate::voice::VoiceHub;

pub struct RateLimiters {
    pub login_ip: RateLimiter,
    pub login_username: RateLimiter,
    pub register_ip: RateLimiter,
    pub mfa_ip: RateLimiter,
}

impl Default for RateLimiters {
    fn default() -> Self {
        RateLimiters {
            login_ip: RateLimiter::new(10, Duration::from_secs(60)),
            login_username: RateLimiter::new(5, Duration::from_secs(60)),
            register_ip: RateLimiter::new(5, Duration::from_secs(3600)),
            mfa_ip: RateLimiter::new(10, Duration::from_secs(60)),
        }
    }
}

/// 30 days, in seconds — the sliding session expiry from `PLAN.md` 1.2.
pub const SESSION_TTL_SECS: i64 = 30 * 24 * 60 * 60;

pub struct AppState {
    pub storage: Arc<dyn Storage>,
    pub snowflake: SnowflakeGenerator,
    pub secret_key: SecretKey,
    pub preauth: PreAuthStore,
    pub rate_limits: RateLimiters,
    pub config: Config,
    /// `Arc` (not owned directly) because the voice SFU task also holds
    /// a clone — it needs to publish `VOICE_STATE_UPDATE`/clear presence
    /// itself when it times out a dead connection server-side, rather
    /// than only the gateway's own (much slower) heartbeat-timeout path
    /// ever noticing that departure. See `voice::spawn`.
    pub gateway: Arc<GatewayHub>,
    pub voice: VoiceHub,
    pub stats: Arc<StatsMonitor>,
    pub push: PushService,
}

pub type SharedState = Arc<AppState>;
