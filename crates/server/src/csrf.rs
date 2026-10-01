//! CSRF defense: the session cookie is `SameSite=Lax`, which stops
//! cross-site form submissions but not simple cross-site GETs that
//! browsers still attach cookies to in some cases. Requiring a custom
//! header on every mutating request closes that gap for free — browsers
//! refuse to let cross-origin requests set arbitrary headers without a
//! preflight, and a plain `<form>` or `<img>` can't set one at all.

use axum::extract::Request;
use axum::http::Method;
use axum::middleware::Next;
use axum::response::Response;

use crate::api::error::AppError;

pub async fn require_header(req: Request, next: Next) -> Result<Response, AppError> {
    let needs_check = !matches!(*req.method(), Method::GET | Method::HEAD | Method::OPTIONS);
    if needs_check && !req.headers().contains_key("x-requested-with") {
        return Err(AppError::forbidden("csrf", "missing X-Requested-With header"));
    }
    Ok(next.run(req).await)
}
