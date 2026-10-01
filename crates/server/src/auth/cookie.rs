use axum::http::{HeaderMap, HeaderValue};

pub const SESSION_COOKIE: &str = "session";

/// Builds a `Set-Cookie` header value for the session cookie.
/// `max_age_secs` of `0` expires it immediately (used on logout).
pub fn set_cookie(token: &str, max_age_secs: i64) -> String {
    format!(
        "{SESSION_COOKIE}={token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age={max_age_secs}"
    )
}

/// The same as [`set_cookie`], as a header value ready to insert. A token
/// is base64url and the attributes are fixed ASCII, so this always
/// succeeds; the fallback (an expired, empty cookie) exists so a
/// malformed token can never panic a request.
pub fn set_cookie_header(token: &str, max_age_secs: i64) -> HeaderValue {
    HeaderValue::try_from(set_cookie(token, max_age_secs))
        .unwrap_or_else(|_| HeaderValue::from_static("session=; Path=/; Max-Age=0"))
}

pub fn clear_cookie_header() -> HeaderValue {
    set_cookie_header("", 0)
}

/// Reads the session token out of the request's `Cookie` header, if present.
pub fn read_session_token(headers: &HeaderMap) -> Option<String> {
    let raw = headers.get(axum::http::header::COOKIE)?.to_str().ok()?;
    for part in raw.split(';') {
        let part = part.trim();
        if let Some(value) = part.strip_prefix(&format!("{SESSION_COOKIE}=")) {
            return Some(value.to_string());
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderValue;

    #[test]
    fn reads_the_session_cookie_among_others() {
        let mut headers = HeaderMap::new();
        headers.insert(
            axum::http::header::COOKIE,
            HeaderValue::from_static("foo=bar; session=abc123; other=1"),
        );
        assert_eq!(read_session_token(&headers).as_deref(), Some("abc123"));
    }

    #[test]
    fn missing_cookie_header_yields_none() {
        assert_eq!(read_session_token(&HeaderMap::new()), None);
    }
}
