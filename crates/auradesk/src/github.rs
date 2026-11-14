//! GitHub CLI (`gh`) implementation of [`IssueFetcher`] (ADR-0013).
//!
//! This is the only module in AuraDesk that talks to GitHub. Credentials stay
//! managed inside the OS keyring via `gh`; AuraDesk never stores or reads
//! GitHub tokens directly.

use std::process::Command;

use auradesk_core::domain::github::{GithubIssue, IssueFetcher, IssueQuery, IssueState};
use auradesk_core::CoreError;

/// Fetcher backed by the local `gh` CLI binary.
#[derive(Debug, Default, Clone, Copy)]
pub struct GhCliIssueFetcher;

impl GhCliIssueFetcher {
    /// Construct a `gh`-backed fetcher.
    pub fn new() -> Self {
        Self
    }

    fn run(&self, args: &[&str]) -> Result<(i32, String, String), CoreError> {
        let output = Command::new("gh").args(args).output().map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                CoreError::validation("gh", "github.cliMissing")
            } else {
                CoreError::internal(format!("spawn gh: {e}"))
            }
        })?;

        Ok((
            output.status.code().unwrap_or(-1),
            String::from_utf8_lossy(&output.stdout).to_string(),
            String::from_utf8_lossy(&output.stderr).to_string(),
        ))
    }
}

impl IssueFetcher for GhCliIssueFetcher {
    fn fetch_issues(&self, query: &IssueQuery) -> Result<Vec<GithubIssue>, CoreError> {
        let state = if query.include_closed { "all" } else { "open" };
        let limit = query.limit.unwrap_or(100).to_string();
        let mut args: Vec<String> = vec![
            "issue".into(),
            "list".into(),
            "--repo".into(),
            query.repo.clone(),
            "--state".into(),
            state.into(),
            "--limit".into(),
            limit,
            "--json".into(),
            "number,title,body,labels,state,url,updatedAt".into(),
        ];
        if let Some(label) = &query.label {
            args.push("--label".into());
            args.push(label.clone());
        }

        let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
        let (code, stdout, stderr) = self.run(&arg_refs)?;
        if code != 0 {
            return Err(map_gh_error(&stderr, code));
        }

        let raw: serde_json::Value = serde_json::from_str(&stdout)
            .map_err(|e| CoreError::internal(format!("parse gh json: {e}")))?;
        let arr = raw
            .as_array()
            .ok_or_else(|| CoreError::internal("gh json is not an array"))?;

        let mut out = Vec::with_capacity(arr.len());
        for item in arr {
            let number = item
                .get("number")
                .and_then(|v| v.as_i64())
                .ok_or_else(|| CoreError::internal("gh issue missing number"))?;
            let title = item
                .get("title")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let body = item
                .get("body")
                .and_then(|v| v.as_str())
                .map(str::to_string);
            let url = item
                .get("url")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let state = match item
                .get("state")
                .and_then(|v| v.as_str())
                .map(|s| s.to_ascii_lowercase())
                .as_deref()
            {
                Some("closed") => IssueState::Closed,
                _ => IssueState::Open,
            };
            let updated_at = item
                .get("updatedAt")
                .and_then(|v| v.as_str())
                .map(str::to_string);
            let labels = item
                .get("labels")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|l| {
                            l.get("name")
                                .and_then(|n| n.as_str())
                                .or_else(|| l.as_str())
                                .map(str::to_string)
                        })
                        .collect()
                })
                .unwrap_or_default();

            out.push(GithubIssue {
                number,
                repo: query.repo.clone(),
                url,
                title,
                body,
                labels,
                state,
                updated_at,
            });
        }
        Ok(out)
    }

    fn auth_status(&self) -> Result<Option<String>, CoreError> {
        let (code, stdout, stderr) = self.run(&["auth", "status", "--hostname", "github.com"])?;
        if code != 0 {
            return Ok(None);
        }
        let account = stdout.lines().chain(stderr.lines()).find_map(|l| {
            l.split("account ")
                .nth(1)
                .map(|a| a.trim().trim_end_matches('(').trim().to_string())
        });
        Ok(account)
    }
}

fn map_gh_error(stderr: &str, code: i32) -> CoreError {
    let lower = stderr.to_lowercase();
    let field = if lower.contains("not logged") || lower.contains("authentication") {
        "github.auth"
    } else if lower.contains("rate limit") {
        "github.rate_limit"
    } else if lower.contains("could not resolve") || lower.contains("not found") {
        "github.repo"
    } else {
        "github.unavailable"
    };
    CoreError::validation(field, format!("gh failed (exit {code}): {stderr}"))
}
