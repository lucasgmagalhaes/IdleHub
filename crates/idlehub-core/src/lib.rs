//! Platform-independent domain logic for IdleHub.
//!
//! Nothing in this crate depends on Tauri or a webview, so every rule that
//! decides how accounts are laid out, isolated and throttled is unit tested here.
pub mod account;
pub mod layout;
pub mod profile;
