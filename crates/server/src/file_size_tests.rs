//! Keeps every hand-written source file small enough to find your way
//! around: no more than `MAX_LINES` lines, in Rust, TypeScript and CSS,
//! tests included. A file that outgrows the limit should be split by
//! responsibility, not have its limit raised.
//!
//! `KNOWN_OVERSIZE` is a ratchet, not an exemption: files listed there are
//! being split and may not grow, and the list only ever shrinks. It is
//! empty once the split is complete.

use std::fs;
use std::path::{Path, PathBuf};

const MAX_LINES: usize = 600;

/// `(path relative to the repository root, current line count)`.
const KNOWN_OVERSIZE: &[(&str, usize)] = &[];

fn collect(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if path.is_dir() {
            if name != "node_modules" && name != "dist" && name != "target" {
                collect(&path, out);
            }
        } else if matches!(path.extension().and_then(|e| e.to_str()), Some("rs" | "ts" | "css")) {
            out.push(path);
        }
    }
}

#[test]
fn no_source_file_is_too_big_to_navigate() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let mut files = Vec::new();
    for dir in ["crates", "web/src", "web/e2e"] {
        collect(&root.join(dir), &mut files);
    }

    let mut too_big = Vec::new();
    for path in files {
        let lines = fs::read_to_string(&path).map(|s| s.lines().count()).unwrap_or(0);
        let relative = path.strip_prefix(&root).unwrap().to_string_lossy().replace("../", "");
        let relative = relative.trim_start_matches("./").to_string();
        let ceiling = KNOWN_OVERSIZE
            .iter()
            .find(|(p, _)| relative.ends_with(p))
            .map(|(_, n)| *n)
            .unwrap_or(MAX_LINES);
        if lines > ceiling {
            too_big.push(format!("{relative}: {lines} lines (limit {ceiling})"));
        }
    }
    assert!(
        too_big.is_empty(),
        "split these by responsibility (limit is {MAX_LINES} lines):\n{}",
        too_big.join("\n")
    );
}
