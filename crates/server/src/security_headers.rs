//! Baseline security headers applied to every response. The app itself
//! is a same-origin SPA (no third-party scripts/styles/fonts — even
//! KaTeX's fonts are bundled into the build, not loaded from a CDN),
//! so a fairly strict default policy costs nothing functionally.
//!
//! `uploads::download` sets its own, deliberately *different* (fully
//! locked-down, `sandbox`ed) CSP for arbitrary uploaded content — see
//! that module for why. This only fills in a header where a handler
//! hasn't already set one of its own, so it never overrides that.

use axum::extract::Request;
use axum::http::{header, HeaderName, HeaderValue};
use axum::middleware::Next;
use axum::response::Response;

/// `style-src` needs `'unsafe-inline'`: the app sets a great deal of
/// dynamic positioning/sizing through the `element.style.*` DOM API
/// (video-tile drag/resize, the resizable panel dividers, etc.), which
/// CSP treats the same as an inline `style=""` attribute — there's no
/// practical way to nonce/hash every one of those. `script-src` has no
/// such exception: the codebase has no inline `<script>`/`on*=`
/// handlers or `eval`/`new Function` anywhere (everything goes through
/// `addEventListener`), so it stays as strict as the directive allows.
/// `font-src` needs `data:` too — KaTeX's own stylesheet embeds its
/// fonts as base64 `data:` URIs rather than separate font files
/// (confirmed live: without this, math rendering silently lost its
/// glyphs under a `'self'`-only policy).
const CSP: &str = "default-src 'self'; \
    script-src 'self'; \
    style-src 'self' 'unsafe-inline'; \
    img-src 'self' data: blob:; \
    media-src 'self' blob:; \
    font-src 'self' data:; \
    connect-src 'self'; \
    object-src 'none'; \
    base-uri 'self'; \
    form-action 'self'; \
    frame-ancestors 'none'";

pub async fn apply(req: Request, next: Next) -> Response {
    let mut response = next.run(req).await;
    let headers = response.headers_mut();

    if !headers.contains_key(header::CONTENT_SECURITY_POLICY) {
        headers.insert(header::CONTENT_SECURITY_POLICY, HeaderValue::from_static(CSP));
    }
    if !headers.contains_key(header::X_CONTENT_TYPE_OPTIONS) {
        headers.insert(header::X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff"));
    }
    // Belt-and-suspenders alongside the CSP's own `frame-ancestors`
    // above — older browsers that predate `frame-ancestors` still
    // honor this against clickjacking.
    headers.insert(header::X_FRAME_OPTIONS, HeaderValue::from_static("DENY"));
    headers.insert(header::REFERRER_POLICY, HeaderValue::from_static("same-origin"));
    // Safe to send unconditionally even for a plain-HTTP dev/LAN setup
    // (see docs/admin.md) — a browser simply ignores HSTS over a
    // non-HTTPS connection rather than doing anything harmful with it.
    // Every real deployment sits behind a TLS-terminating reverse
    // proxy, which is what this actually protects.
    headers.insert(
        header::STRICT_TRANSPORT_SECURITY,
        HeaderValue::from_static("max-age=63072000; includeSubDomains"),
    );
    // Explicitly grants (rather than the default-deny every browser
    // would otherwise apply to a cross-origin `iframe`) exactly the
    // device APIs this app's own voice/video calling genuinely needs,
    // scoped to same-origin use only — everything else stays denied.
    headers.insert(
        HeaderName::from_static("permissions-policy"),
        HeaderValue::from_static(
            "camera=(self), microphone=(self), display-capture=(self), geolocation=()",
        ),
    );

    response
}
