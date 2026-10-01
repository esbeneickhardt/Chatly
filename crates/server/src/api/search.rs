//! Message search. The index is SQLite FTS5 (`migrations/0024`); this
//! module is the part that has to be careful: turning free text into a
//! *safe* FTS5 expression, and making sure nobody finds a message in a
//! place they couldn't have read it.
//!
//! Access control has two layers. SQL narrows to the requested scope
//! (one channel, one server, or the caller's own DMs — a DM search can
//! never reach a conversation the caller isn't in). Then every channel a
//! hit lives in is re-checked with the real permission engine
//! (`require_channel_permission`), because per-channel role overwrites and
//! private-channel membership can't be expressed in a WHERE clause.

use std::collections::HashMap;

use axum::extract::{Query, State};
use axum::Json;
use serde::Deserialize;

use protocol::{Id, Permissions};

use super::current_user::CurrentUser;
use super::error::{AppError, AppResult};
use super::permissions::require_channel_permission;
use crate::models::{Message, SearchScope};
use crate::state::SharedState;

const DEFAULT_LIMIT: i64 = 25;
const MAX_LIMIT: i64 = 50;
const MAX_QUERY_CHARS: usize = 100;
/// How many raw candidate pages to inspect while filtering out hits the
/// viewer can't see, before giving up on filling a page. Bounds the work
/// a query for a common word in a huge server can cause.
const MAX_CANDIDATE_PAGES: usize = 6;

#[derive(Deserialize)]
pub struct SearchQuery {
    #[serde(default)]
    pub q: String,
    /// Search one channel (guild channel or DM)…
    pub channel_id: Option<String>,
    /// …or every channel you can read in one server…
    pub guild_id: Option<String>,
    /// …or, with `scope=dms`, all your direct messages.
    pub scope: Option<String>,
    /// Pagination cursor: only messages older than this id.
    pub before: Option<String>,
    pub limit: Option<i64>,
}

/// Turns what a person typed into an FTS5 expression that can't be
/// anything but a list of words. Raw user text must never reach `MATCH`:
/// FTS5 has its own query language (`AND`/`OR`/`NOT`, `NEAR`, `col:`,
/// `*`, quotes), and a stray `"` or `-` is a syntax *error* that would
/// otherwise surface as a 500. Every run of letters/digits becomes one
/// quoted term (all must match, in any order); the last also matches as a
/// prefix, so results appear while the word is still being typed.
/// Returns `None` if there is nothing searchable.
pub fn build_match_query(input: &str) -> Option<String> {
    let terms: Vec<String> = input
        .chars()
        .take(MAX_QUERY_CHARS)
        .collect::<String>()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|t| !t.is_empty())
        .map(str::to_lowercase)
        .collect();
    let (last, rest) = terms.split_last()?;
    let mut parts: Vec<String> = rest.iter().map(|t| format!("\"{t}\"")).collect();
    parts.push(format!("\"{last}\"*"));
    Some(parts.join(" "))
}

fn parse_id(raw: &str, what: &str) -> AppResult<Id> {
    raw.parse().map_err(|_| AppError::bad_request("invalid_id", format!("invalid {what} id")))
}

pub async fn search(
    State(state): State<SharedState>,
    current: CurrentUser,
    Query(params): Query<SearchQuery>,
) -> AppResult<Json<Vec<Message>>> {
    let match_query = build_match_query(&params.q)
        .ok_or_else(|| AppError::bad_request("empty_query", "type a word to search for"))?;
    let limit = params.limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT);
    let before = params.before.as_deref().map(|b| parse_id(b, "before")).transpose()?;

    let scope = match (&params.channel_id, &params.guild_id, params.scope.as_deref()) {
        (Some(channel), None, None) => {
            let channel_id = parse_id(channel, "channel")?;
            require_channel_permission(
                &state,
                current.user.id,
                channel_id,
                Permissions::VIEW_CHANNEL,
            )
            .await?;
            SearchScope::Channel(channel_id)
        }
        (None, Some(guild), None) => {
            let guild_id = parse_id(guild, "guild")?;
            if !state.storage.is_guild_member(guild_id, current.user.id).await? {
                return Err(AppError::forbidden("forbidden", "not a member of this guild"));
            }
            SearchScope::Guild(guild_id)
        }
        (None, None, Some("dms")) => SearchScope::Dms(current.user.id),
        _ => {
            return Err(AppError::bad_request(
                "invalid_scope",
                "give exactly one of channel_id, guild_id, or scope=dms",
            ))
        }
    };

    let mut hits: Vec<Message> = Vec::new();
    let mut cursor = before;
    // Per-channel verdicts, so a channel is permission-checked once per
    // search, not once per hit.
    let mut may_read: HashMap<Id, bool> = HashMap::new();

    for _ in 0..MAX_CANDIDATE_PAGES {
        let page = state
            .storage
            .search_messages(match_query.clone(), scope, cursor, limit * 3, current.user.id)
            .await?;
        let exhausted = (page.len() as i64) < limit * 3;
        cursor = page.last().map(|m| m.id);

        for message in page {
            let allowed = match may_read.get(&message.channel_id) {
                Some(&allowed) => allowed,
                None => {
                    let allowed = require_channel_permission(
                        &state,
                        current.user.id,
                        message.channel_id,
                        Permissions::VIEW_CHANNEL,
                    )
                    .await
                    .is_ok();
                    may_read.insert(message.channel_id, allowed);
                    allowed
                }
            };
            if allowed {
                hits.push(message);
                if hits.len() as i64 >= limit {
                    return Ok(Json(hits));
                }
            }
        }
        if exhausted || cursor.is_none() {
            break;
        }
    }
    Ok(Json(hits))
}

#[cfg(test)]
mod tests {
    use super::build_match_query;

    #[test]
    fn plain_words_become_quoted_terms_with_a_prefix_on_the_last() {
        assert_eq!(build_match_query("hello world").as_deref(), Some(r#""hello" "world"*"#));
        assert_eq!(build_match_query("  Hel ").as_deref(), Some(r#""hel"*"#));
    }

    #[test]
    fn fts_syntax_cannot_get_through() {
        for hostile in [
            r#"" OR 1=1 --"#,
            "NEAR(a b)",
            "content:secret",
            "a AND NOT b",
            "*",
            r#"""#,
            "(((",
            "-x",
        ] {
            let query = build_match_query(hostile);
            if let Some(q) = query {
                // Only quoted terms, spaces, and one trailing `*`.
                assert!(
                    q.chars().all(|c| c.is_alphanumeric() || matches!(c, '"' | ' ' | '*')),
                    "{hostile:?} produced {q:?}"
                );
                assert!(!q.contains("\"\""), "{hostile:?} produced an empty term: {q:?}");
            }
        }
        assert_eq!(build_match_query("***"), None);
        assert_eq!(build_match_query(r#""""#), None);
    }

    #[test]
    fn unicode_is_kept_and_case_folded() {
        assert_eq!(build_match_query("Café ÆØÅ").as_deref(), Some(r#""café" "æøå"*"#));
    }

    #[test]
    fn overlong_input_is_truncated_not_rejected() {
        let long = "a ".repeat(500);
        let q = build_match_query(&long).unwrap();
        assert!(q.len() < 400);
    }
}
