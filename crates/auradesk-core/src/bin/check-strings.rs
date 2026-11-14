//! bin/check-strings: scan the source tree for hard-coded user-facing
//! strings and exit non-zero on violations.
//!
//! Policy (see `docs/decisions/0007-i18n-from-day-one.md`): every string
//! that can reach the user must live in a locale file — the frontend
//! JSON files under `apps/web/locales/`, or the backend YAML files under
//! `crates/auradesk-core/locales/`.
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
const BUILTIN_ALLOWLIST: &[&str] = &[
    // JSX/HTML attributes and framework plumbing.
    "aria-",
    "data-testid",
    "data-icon",
    "key=",
    "className=",
    "throw new Error",
    "import.meta",
    "process.env",
    "localStorage",
    "URL.createObjectURL",
    "navigator.",
    "DEBUG:",
    "INFO:",
    "WARN:",
    "ERROR:",
];

/// A quoted literal that looks like human-readable copy: it starts with a
/// capital letter, contains at least one space, and is made of letters,
/// digits and the punctuation that shows up in real sentences (accents
/// included). This deliberately ignores identifiers like `IpcError` and
/// machine tokens like `pending`, which are not copy.
const USER_FACING: &str = r#"'[^']*[A-ZÀ-Þ][^']* [^']*'|"[^"]*[A-ZÀ-Þ][^"]* [^"]*""#;

/// Minimum number of characters in a quoted literal for it to be worth
/// reporting. Short literals like `"ok"` are usually codes or flags.
const MIN_LEN: usize = 6;

/// Load the allow-list file: one substring per line, `#` starts a comment.
fn load_allowlist() -> Vec<String> {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("check-strings-allowlist.txt");
    let Ok(content) = fs::read_to_string(path) else {
        return Vec::new();
    };
    content
        .lines()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty() && !l.starts_with('#'))
        .map(|l| l.to_string())
        .collect()
}

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

    let mut allowlist: Vec<String> = BUILTIN_ALLOWLIST.iter().map(|s| s.to_string()).collect();
    allowlist.extend(load_allowlist());

    let mut violations: Vec<String> = Vec::new();
    for root in &roots {
        if let Err(e) = walk(root, &user_facing, &allowlist, &mut violations) {
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

fn walk(
    root: &Path,
    re: &Regex,
    allowlist: &[String],
    violations: &mut Vec<String>,
) -> std::io::Result<()> {
    if !root.exists() {
        return Ok(());
    }
    walk_recursive(root, re, allowlist, violations)
}

fn walk_recursive(
    dir: &Path,
    re: &Regex,
    allowlist: &[String],
    violations: &mut Vec<String>,
) -> std::io::Result<()> {
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
        // Test files hold assertions and fixtures, not UI copy. A string
        // that names a test suite is a test name, so scanning them
        // produces false positives.
        let is_test = name
            .to_str()
            .map(|n| n.contains(".test.") || n.contains(".spec."))
            .unwrap_or(false);
        if path.is_dir() {
            walk_recursive(&path, re, allowlist, violations)?;
        } else if is_source && !is_test {
            check_file(&path, re, allowlist, violations)?;
        }
    }
    Ok(())
}

fn check_file(
    path: &Path,
    re: &Regex,
    allowlist: &[String],
    violations: &mut Vec<String>,
) -> std::io::Result<()> {
    let content = fs::read_to_string(path)?;
    for (i, line) in content.lines().enumerate() {
        if allowlist.iter().any(|p| line.contains(p.as_str())) {
            continue;
        }
        // A comment is not copy.
        let trimmed = line.trim_start();
        if trimmed.starts_with("//") || trimmed.starts_with("///") || trimmed.starts_with('*') {
            continue;
        }
        for m in re.find_iter(line) {
            let literal = m.as_str();
            // Strip the surrounding quotes before measuring.
            let inner = literal.trim_matches(|c| c == '"' || c == '\'');
            if inner.len() < MIN_LEN {
                continue;
            }
            // Must look like a sentence: a capital letter and at least one
            // space, and not a machine token such as `snake_case` or a
            // path-like identifier.
            let looks_like_copy = inner.chars().next().is_some_and(|c| c.is_uppercase())
                && inner.contains(' ')
                && !inner.contains("::")
                && !inner.contains('/')
                && !inner.contains('_');
            if !looks_like_copy {
                continue;
            }
            violations.push(format!("{}:{}: {}", path.display(), i + 1, line.trim()));
            break;
        }
    }
    Ok(())
}
