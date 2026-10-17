//! bin/check-strings: scan the source tree for hard-coded user-facing
//! strings and exit non-zero on violations.
//!
//! Phase 0 T8: minimal implementation. The full version (with multi-
//! language detection, allow-list file, etc.) is iterated on in T11.
//!
//! Usage:
//!     cargo run --bin check-strings -- [paths]
//!
//! Exit codes:
//!     0  no violations
//!     1  violations found
//!     2  internal error

use std::fs;
use std::path::{Path, PathBuf};
use std::process::ExitCode;

use regex::Regex;

/// Substrings that mark a line as "definitely fine" (not a UI string).
const ALLOWLIST_PATTERNS: &[&str] = &[
    "aria-", "data-testid", "data-icon", "key=", "className=",
    "throw new Error", "import.meta", "process.env",
    "localStorage", "URL.createObjectURL", "navigator.",
    "DEBUG:", "INFO:", "WARN:", "ERROR:",
];

/// Regex that detects a "looks like English text" string in JSX/TSX.
const USER_FACING: &str = r#"(?:>[A-Z][a-zA-Z' ]{3,}[a-z])|(?:['"][A-Z][a-zA-Z' ]{3,}[a-z]['"])"#;

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let roots: Vec<PathBuf> = if args.is_empty() {
        vec![
            PathBuf::from("apps/web/src"),
            PathBuf::from("crates/auradesk-core/src"),
            PathBuf::from("crates/auradesk/src"),
            PathBuf::from("crates/auradesk-mcp/src"),
        ]
    } else {
        args.into_iter().map(PathBuf::from).collect()
    };

    let user_facing = match Regex::new(USER_FACING) {
        Ok(r) => r,
        Err(e) => {
            eprintln!("check-strings: invalid regex: {e}");
            return ExitCode::from(2);
        }
    };

    let mut violations: Vec<String> = Vec::new();
    for root in &roots {
        if let Err(e) = walk(root, &user_facing, &mut violations) {
            eprintln!("check-strings: {e}");
            return ExitCode::from(2);
        }
    }

    if violations.is_empty() {
        eprintln!("check-strings: 0 violations.");
        ExitCode::from(0)
    } else {
        eprintln!("check-strings: {} violation(s):", violations.len());
        for v in &violations {
            eprintln!("  {v}");
        }
        ExitCode::from(1)
    }
}

fn walk(root: &Path, re: &Regex, violations: &mut Vec<String>) -> std::io::Result<()> {
    if !root.exists() {
        return Ok(());
    }
    walk_recursive(root, re, violations)
}

fn walk_recursive(dir: &Path, re: &Regex, violations: &mut Vec<String>) -> std::io::Result<()> {
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        let name = entry.file_name();
        let skip_names = ["node_modules", "target", "dist", ".git", ".direnv"];
        if skip_names.iter().any(|n| name == *n) {
            continue;
        }
        let ext = path.extension().and_then(|s| s.to_str()).unwrap_or("");
        let is_source = matches!(ext, "ts" | "tsx" | "js" | "jsx" | "rs" | "sql" | "sh");
        if path.is_dir() {
            walk_recursive(&path, re, violations)?;
        } else if is_source {
            check_file(&path, re, violations)?;
        }
    }
    Ok(())
}

fn check_file(path: &Path, re: &Regex, violations: &mut Vec<String>) -> std::io::Result<()> {
    let content = fs::read_to_string(path)?;
    for (i, line) in content.lines().enumerate() {
        if ALLOWLIST_PATTERNS.iter().any(|p| line.contains(p)) {
            continue;
        }
        if re.is_match(line) {
            violations.push(format!("{}:{}: {}", path.display(), i + 1, line.trim()));
        }
    }
    Ok(())
}
