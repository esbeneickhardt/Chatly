//! Tiny shared helper for rendering a QR code as inline SVG — used by
//! both TOTP enrollment and friend invites, so it's one place instead
//! of two copies drifting apart.

use qrcode::render::svg;
use qrcode::QrCode;

use crate::api::error::{AppError, AppResult};

pub fn render_qr_svg(data: &str) -> AppResult<String> {
    let code = QrCode::new(data.as_bytes()).map_err(AppError::internal)?;
    Ok(code.render::<svg::Color>().min_dimensions(220, 220).build())
}
