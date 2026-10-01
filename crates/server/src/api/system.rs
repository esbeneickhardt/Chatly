use axum::extract::State;
use axum::Json;

use super::current_user::CurrentUser;
use crate::state::SharedState;
use crate::sysstats::SystemStats;

/// Chatly's own network throughput (see `sysstats`) — not scoped to
/// any guild, any authenticated user can see it. No whole-host
/// CPU/memory here (used to be included; dropped as real information
/// about the underlying host that a signed-in user has no need to see
/// — see `sysstats`'s module doc).
pub async fn stats(State(state): State<SharedState>, _current: CurrentUser) -> Json<SystemStats> {
    Json(state.stats.snapshot())
}
