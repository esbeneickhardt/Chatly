//! Shared wire types for the chat server: entity IDs, the REST error
//! shape, and (from Phase 2 onward) gateway events and permissions.
//!
//! This crate has no I/O — it exists so the web client's tooling, the
//! server, and any future bots can all depend on the exact same types.

pub mod error;
pub mod id;
pub mod permissions;

pub use error::{ApiError, ApiErrorBody};
pub use id::Id;
pub use permissions::Permissions;
