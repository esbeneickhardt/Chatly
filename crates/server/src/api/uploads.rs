//! File/image attachments (`PLAN.md` 3.1). Uploads are streamed to disk
//! chunk-by-chunk — never buffered fully in memory — and the content
//! type is sniffed from the actual bytes (`infer`), not trusted from
//! the client. Downloads are streamed back the same way and served
//! with a sandboxing CSP so an uploaded HTML file can never execute in
//! our origin, even if someone navigates straight to its URL.

use axum::body::Body;
use axum::extract::{Multipart, Path, State};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use protocol::{Id, Permissions};
use sha2::{Digest, Sha256};
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};
use tokio_util::io::ReaderStream;

use super::current_user::CurrentUser;
use super::error::{AppError, AppResult};
use super::permissions::require_channel_permission;
use crate::models::{FileMeta, NewFile};
use crate::state::SharedState;

const SNIFF_BYTES: usize = 512;

pub async fn upload(
    State(state): State<SharedState>,
    current: CurrentUser,
    mut multipart: Multipart,
) -> AppResult<Json<FileMeta>> {
    let field = multipart
        .next_field()
        .await
        .map_err(|e| AppError::bad_request("invalid_upload", e.to_string()))?
        .ok_or_else(|| AppError::bad_request("missing_file", "no file field in the upload"))?;

    let filename = field.file_name().unwrap_or("file").to_string();
    let declared_mime = field.content_type().map(str::to_string);

    let file_id = state.snowflake.next_id();
    let path = state.config.data_dir.join("files").join(file_id.to_string());
    let mut out = tokio::fs::File::create(&path)
        .await
        .map_err(|e| AppError::internal(format!("failed to create upload file: {e}")))?;

    let mut hasher = Sha256::new();
    let mut size: u64 = 0;
    let mut sniff_buf: Vec<u8> = Vec::with_capacity(SNIFF_BYTES);
    let mut field = field;

    loop {
        let chunk = match field.chunk().await {
            Ok(Some(chunk)) => chunk,
            Ok(None) => break,
            Err(e) => {
                let _ = tokio::fs::remove_file(&path).await;
                return Err(AppError::bad_request("invalid_upload", e.to_string()));
            }
        };

        size += chunk.len() as u64;
        if size > state.config.max_upload_bytes {
            drop(out);
            let _ = tokio::fs::remove_file(&path).await;
            let limit_mb = state.config.max_upload_bytes / 1_000_000;
            return Err(AppError::bad_request(
                "file_too_large",
                format!("file exceeds the {limit_mb} MB limit"),
            ));
        }

        if sniff_buf.len() < SNIFF_BYTES {
            let take = chunk.len().min(SNIFF_BYTES - sniff_buf.len());
            sniff_buf.extend_from_slice(&chunk[..take]);
        }
        hasher.update(&chunk);
        if let Err(e) = out.write_all(&chunk).await {
            let _ = tokio::fs::remove_file(&path).await;
            return Err(AppError::internal(format!("failed to write upload: {e}")));
        }
    }
    out.flush().await.map_err(AppError::internal)?;

    if size == 0 {
        let _ = tokio::fs::remove_file(&path).await;
        return Err(AppError::bad_request("empty_file", "uploaded file is empty"));
    }

    let sniffed_mime = infer::get(&sniff_buf).map(|t| t.mime_type().to_string());
    let mime =
        sniffed_mime.or(declared_mime).unwrap_or_else(|| "application/octet-stream".to_string());
    let sha256 = hasher.finalize().iter().map(|b| format!("{b:02x}")).collect::<String>();

    let file = state
        .storage
        .create_file(NewFile {
            id: file_id,
            uploader_id: current.user.id,
            filename,
            mime,
            size: size as i64,
            sha256,
        })
        .await?;

    Ok(Json(file))
}

fn sanitize_filename(name: &str) -> String {
    name.replace(['"', '\r', '\n'], "_")
}

/// Parses a single-range `Range: bytes=<start>-<end>` header (including
/// the open-ended `bytes=<start>-` and suffix `bytes=-<n>` forms) into
/// an inclusive `(start, end)` byte range clamped to `file_len`. Only a
/// single range is supported — browsers requesting audio/video only
/// ever send one, and multipart/byteranges responses aren't worth the
/// complexity here.
fn parse_range(header: &str, file_len: u64) -> Option<(u64, u64)> {
    if file_len == 0 {
        return None;
    }
    let spec = header.strip_prefix("bytes=")?;
    let (start_s, end_s) = spec.split_once('-')?;
    if start_s.is_empty() {
        let suffix_len: u64 = end_s.parse().ok()?;
        if suffix_len == 0 {
            return None;
        }
        let start = file_len.saturating_sub(suffix_len);
        return Some((start, file_len - 1));
    }
    let start: u64 = start_s.parse().ok()?;
    if start >= file_len {
        return None;
    }
    let end: u64 =
        if end_s.is_empty() { file_len - 1 } else { end_s.parse::<u64>().ok()?.min(file_len - 1) };
    if start > end {
        return None;
    }
    Some((start, end))
}

pub async fn download(
    State(state): State<SharedState>,
    current: CurrentUser,
    Path(file_id): Path<String>,
    headers: HeaderMap,
) -> AppResult<Response> {
    let file_id: Id =
        file_id.parse().map_err(|_| AppError::bad_request("invalid_id", "invalid file id"))?;

    let file = state
        .storage
        .get_file(file_id)
        .await?
        .ok_or_else(|| AppError::not_found("not_found", "file not found"))?;

    // The uploader can always see their own file, even before it's
    // attached anywhere — needed for the guild-icon/avatar cropper
    // preview, which uploads first and only attaches the id on submit
    // (create the guild / save the avatar). This doesn't weaken
    // anyone else's access: it only ever grants the person who
    // provided the bytes in the first place a way to see them again.
    let is_uploader =
        state.storage.file_uploader(file_id).await?.is_some_and(|u| u == current.user.id);

    if !is_uploader {
        if let Some(channel_id) = state.storage.channel_for_file(file_id).await? {
            require_channel_permission(
                &state,
                current.user.id,
                channel_id,
                Permissions::VIEW_CHANNEL,
            )
            .await?;
        } else if let Some(guild_id) = state.storage.guild_for_icon_file(file_id).await? {
            if !state.storage.is_guild_member(guild_id, current.user.id).await? {
                return Err(AppError::not_found("not_found", "file not found"));
            }
        } else if !state.storage.file_is_avatar(file_id).await? {
            return Err(AppError::not_found("not_found", "file not found"));
        }
    }

    let path = state.config.data_dir.join("files").join(file_id.to_string());
    let mut tokio_file = tokio::fs::File::open(&path)
        .await
        .map_err(|e| AppError::internal(format!("failed to open stored file: {e}")))?;
    let file_len = tokio_file
        .metadata()
        .await
        .map_err(|e| AppError::internal(format!("failed to stat stored file: {e}")))?
        .len();

    let range = headers
        .get(header::RANGE)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| parse_range(v, file_len));

    let mut response = if let Some((start, end)) = range {
        tokio_file
            .seek(std::io::SeekFrom::Start(start))
            .await
            .map_err(|e| AppError::internal(format!("failed to seek stored file: {e}")))?;
        let len = end - start + 1;
        let body = Body::from_stream(ReaderStream::new(tokio_file.take(len)));
        let mut resp = body.into_response();
        *resp.status_mut() = StatusCode::PARTIAL_CONTENT;
        let h = resp.headers_mut();
        h.insert(
            header::CONTENT_RANGE,
            // Digits and punctuation only, so this is always a valid value.
            HeaderValue::try_from(format!("bytes {start}-{end}/{file_len}"))
                .map_err(|e| AppError::internal(format!("bad content-range: {e}")))?,
        );
        h.insert(header::CONTENT_LENGTH, HeaderValue::from(len));
        resp
    } else {
        let body = Body::from_stream(ReaderStream::new(tokio_file));
        let mut resp = body.into_response();
        resp.headers_mut().insert(header::CONTENT_LENGTH, HeaderValue::from(file_len));
        resp
    };

    let response_headers = response.headers_mut();
    response_headers.insert(header::ACCEPT_RANGES, HeaderValue::from_static("bytes"));
    response_headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_str(&file.mime)
            .unwrap_or(HeaderValue::from_static("application/octet-stream")),
    );
    response_headers.insert(
        header::CONTENT_DISPOSITION,
        HeaderValue::from_str(&format!(
            "inline; filename=\"{}\"",
            sanitize_filename(&file.filename)
        ))
        .unwrap_or(HeaderValue::from_static("inline")),
    );
    // An uploaded HTML/SVG file must never execute as our origin, even
    // if someone navigates straight to this URL — see PLAN.md 3.1.
    response_headers.insert(
        header::CONTENT_SECURITY_POLICY,
        HeaderValue::from_static("default-src 'none'; sandbox"),
    );
    response_headers.insert(header::X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff"));

    Ok(response)
}
