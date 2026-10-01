//! Serves the compiled web client. Release builds embed `web/dist` into
//! the binary; debug builds read it from disk so `npm run build` +
//! `cargo run` iterate without a rebuild of the server.

use axum::body::Body;
use axum::extract::Path as AxPath;
use axum::http::{header, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::Router;

#[cfg(not(debug_assertions))]
mod embedded {
    #[derive(rust_embed::RustEmbed)]
    #[folder = "../../web/dist"]
    pub struct Assets;
}

/// A `Content-Type` header for `mime`. A MIME type is plain ASCII so this
/// always succeeds; the fallback exists so it can never panic.
fn content_type(mime: &mime_guess::Mime) -> HeaderValue {
    HeaderValue::from_str(mime.as_ref())
        .unwrap_or_else(|_| HeaderValue::from_static("application/octet-stream"))
}

/// How long a browser may keep a file without asking again. Files under
/// `assets/` have a hash of their content in the name, so they never change
/// and can be kept for good; everything else (the page itself, the service
/// worker, the manifest) must be re-checked every time, or a deploy would not
/// reach anyone who already has it.
fn cache_control(path: &str) -> HeaderValue {
    if path.starts_with("assets/") {
        HeaderValue::from_static("public, max-age=31536000, immutable")
    } else {
        HeaderValue::from_static("no-cache")
    }
}

pub fn router() -> Router {
    Router::new().route("/", get(index)).route("/*path", get(asset))
}

async fn index() -> Response {
    serve("index.html")
}

async fn asset(AxPath(path): AxPath<String>) -> Response {
    serve(&path)
}

#[cfg(not(debug_assertions))]
fn serve(path: &str) -> Response {
    use embedded::Assets;

    match Assets::get(path) {
        Some(file) => {
            let mime = mime_guess::from_path(path).first_or_octet_stream();
            let mut response = Body::from(file.data.into_owned()).into_response();
            response.headers_mut().insert(header::CONTENT_TYPE, content_type(&mime));
            response.headers_mut().insert(header::CACHE_CONTROL, cache_control(path));
            response
        }
        // SPA fallback: unknown paths (client-side routes) get index.html.
        None => match Assets::get("index.html") {
            Some(file) => {
                let mut response = Body::from(file.data.into_owned()).into_response();
                response.headers_mut().insert(
                    header::CONTENT_TYPE,
                    HeaderValue::from_static("text/html; charset=utf-8"),
                );
                response.headers_mut().insert(header::CACHE_CONTROL, cache_control("index.html"));
                response
            }
            None => (StatusCode::NOT_FOUND, "web client not built").into_response(),
        },
    }
}

#[cfg(debug_assertions)]
fn serve(path: &str) -> Response {
    let dist = std::path::Path::new("web/dist");
    let requested = dist.join(path);
    let target = if requested.is_file() { requested } else { dist.join("index.html") };

    match std::fs::read(&target) {
        Ok(bytes) => {
            let mime = mime_guess::from_path(&target).first_or_octet_stream();
            let mut response = Body::from(bytes).into_response();
            response.headers_mut().insert(header::CONTENT_TYPE, content_type(&mime));
            response.headers_mut().insert(header::CACHE_CONTROL, cache_control(path));
            response
        }
        Err(_) => (StatusCode::NOT_FOUND, "web client not built — run `npm run build` in web/")
            .into_response(),
    }
}

#[cfg(test)]
mod tests {
    use super::cache_control;

    #[test]
    fn hashed_assets_are_kept_for_good_and_everything_else_is_rechecked() {
        assert_eq!(
            cache_control("assets/index-oCiZO85d.js"),
            "public, max-age=31536000, immutable"
        );
        for path in ["index.html", "sw.js", "manifest.webmanifest", "channels/123"] {
            assert_eq!(cache_control(path), "no-cache", "{path}");
        }
    }
}
