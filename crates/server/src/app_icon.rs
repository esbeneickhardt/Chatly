//! The app icon the global admin picked (Global admin → App icon): the
//! home-screen, browser-tab and notification icon for everyone on this
//! deployment. Each choice is a folder of ready-made sizes under
//! `web/public/app-icons/<id>/`; the fixed icon addresses the client and
//! service worker use (`/icon-192.png` and friends) are served from the
//! chosen folder, so nothing else needs to know which one it is.
//!
//! Kept in `$DATA_DIR/app_icon` (just the id), next to `secret_key` and
//! `vapid_key`, so backups and restores carry it along.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// Every choice, in the order the admin sees them. The first is the
/// default (Chatly's own icon), so nothing changes until someone picks.
pub const CHOICES: [&str; 4] = ["classic", "handheld", "screen", "keypad"];

pub struct AppIcon {
    current: Mutex<&'static str>,
    file: PathBuf,
}

impl AppIcon {
    /// Reads the saved choice; a missing or unknown one means the default.
    pub fn load(data_dir: &Path) -> Self {
        let file = data_dir.join("app_icon");
        let saved = std::fs::read_to_string(&file).unwrap_or_default();
        AppIcon { current: Mutex::new(choice(saved.trim()).unwrap_or(CHOICES[0])), file }
    }

    pub fn current(&self) -> &'static str {
        *crate::sync::lock(&self.current)
    }

    /// Saves and switches to `id`. `None` for an id that isn't a choice.
    pub fn set(&self, id: &str) -> Option<std::io::Result<&'static str>> {
        let id = choice(id)?;
        if let Err(e) = std::fs::write(&self.file, id) {
            return Some(Err(e));
        }
        *crate::sync::lock(&self.current) = id;
        Some(Ok(id))
    }

    /// The file inside the web client that answers `path`, when `path` is
    /// one of the app-icon addresses; `None` for everything else.
    pub fn file_for(&self, path: &str) -> Option<String> {
        let name = match path {
            "icon-192.png" => "icon-192.png",
            "icon-512.png" => "icon-512.png",
            // iOS fills a transparent home-screen icon with black, so it
            // gets the version on the app's own background.
            "icon-maskable-192.png" | "apple-touch-icon.png" => "maskable-192.png",
            "icon-maskable-512.png" => "maskable-512.png",
            "favicon.png" => "favicon-64.png",
            _ => return None,
        };
        Some(format!("app-icons/{}/{name}", self.current()))
    }

    /// The manifest with every icon address tagged with the current
    /// choice, so an installed app sees the icon change and refreshes it
    /// (browsers compare a manifest's icon URLs, not the images behind them).
    pub fn tag_manifest(&self, manifest: &str) -> String {
        manifest.replace(".png\"", &format!(".png?icon={}\"", self.current()))
    }
}

fn choice(id: &str) -> Option<&'static str> {
    CHOICES.iter().copied().find(|&c| c == id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_to_the_first_choice_and_remembers_a_pick() {
        let dir = tempfile::tempdir().unwrap();
        let icon = AppIcon::load(dir.path());
        assert_eq!(icon.current(), "classic");
        assert_eq!(icon.set("screen").unwrap().unwrap(), "screen");
        assert_eq!(AppIcon::load(dir.path()).current(), "screen");
    }

    #[test]
    fn unknown_choices_are_refused_and_ignored() {
        let dir = tempfile::tempdir().unwrap();
        let icon = AppIcon::load(dir.path());
        assert!(icon.set("../../secret_key").is_none());
        std::fs::write(dir.path().join("app_icon"), "nope").unwrap();
        assert_eq!(AppIcon::load(dir.path()).current(), "classic");
    }

    #[test]
    fn icon_addresses_follow_the_choice() {
        let dir = tempfile::tempdir().unwrap();
        let icon = AppIcon::load(dir.path());
        icon.set("keypad").unwrap().unwrap();
        assert_eq!(icon.file_for("icon-192.png").unwrap(), "app-icons/keypad/icon-192.png");
        assert_eq!(
            icon.file_for("icon-maskable-512.png").unwrap(),
            "app-icons/keypad/maskable-512.png"
        );
        assert_eq!(icon.file_for("index.html"), None);
        assert_eq!(
            icon.tag_manifest(r#"{"src": "/icon-192.png", "x": "/icon.svg"}"#),
            r#"{"src": "/icon-192.png?icon=keypad", "x": "/icon.svg"}"#
        );
    }
}
