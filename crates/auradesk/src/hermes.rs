//! Hermes Agent chat bridge & offline proposal parser (MVP Phase 4).
//!
//! Operates strictly through the Propose -> User Approves -> Execute pattern
//! (`ProposalsService` + `ia_proposals` + `ia_commands`), never mutating
//! `tasks` or `reminders` directly.

use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

static REQ_SEQ: AtomicU64 = AtomicU64::new(1);

use auradesk_core::application::proposals::ProposalsService;
use auradesk_core::capabilities::dispatch_capability;
use auradesk_core::infrastructure::db::Db;
use serde::Serialize;
use tauri::{AppHandle, Emitter};

/// Discovery status for a local Hermes CLI binary.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HermesStatus {
    pub available: bool,
    pub binary_path: Option<String>,
}

/// Immediate response returned when sending a message to Hermes / local assistant.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HermesChatReply {
    pub request_id: String,
    pub mode: String,
    pub reply_text: String,
    pub proposal: Option<serde_json::Value>,
    pub streaming: bool,
}

/// Payload emitted over `auradesk://hermes-stream`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HermesStreamEvent {
    pub request_id: String,
    pub chunk: String,
    pub done: bool,
    pub is_error: bool,
}

/// Metadata returned after persisting a local WAV audio capture.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceCaptureResult {
    pub file_path: String,
    pub bytes: usize,
}

/// Probe whether `hermes` CLI exists on the host without spawning it.
pub fn check_hermes_status() -> HermesStatus {
    let found = find_hermes_binary();
    HermesStatus {
        available: found.is_some(),
        binary_path: found.map(|p| p.display().to_string()),
    }
}

fn find_hermes_binary() -> Option<PathBuf> {
    if let Some(override_bin) = std::env::var_os("HERMES_BIN").filter(|s| !s.is_empty()) {
        let p = PathBuf::from(override_bin);
        if p.exists() {
            return Some(p);
        }
    }

    #[cfg(target_os = "windows")]
    let candidates = {
        let mut list = vec![PathBuf::from("hermes.exe"), PathBuf::from("hermes")];
        if let Some(local) = std::env::var_os("LOCALAPPDATA").filter(|s| !s.is_empty()) {
            list.push(
                PathBuf::from(local)
                    .join("hermes")
                    .join("bin")
                    .join("hermes.exe"),
            );
        }
        list
    };

    #[cfg(not(target_os = "windows"))]
    let candidates = {
        let mut list = vec![PathBuf::from("hermes")];
        if let Some(home) = std::env::var_os("HOME").filter(|s| !s.is_empty()) {
            list.push(
                PathBuf::from(home)
                    .join(".local")
                    .join("bin")
                    .join("hermes"),
            );
        }
        list
    };

    for cand in candidates {
        if cand.is_absolute() && cand.exists() {
            return Some(cand);
        }
        if !cand.is_absolute() {
            if let Some(path_env) = std::env::var_os("PATH") {
                for dir in std::env::split_paths(&path_env) {
                    let full = dir.join(&cand);
                    if full.is_file() {
                        return Some(full);
                    }
                }
            }
        }
    }
    None
}

/// Process an in-app chat prompt: creates a pending proposal or overview in
/// local offline mode, or streams from the local `hermes` CLI when requested.
pub fn handle_chat_prompt(
    app: &AppHandle,
    db: &Arc<Db>,
    prompt: &str,
    use_cli: bool,
) -> Result<HermesChatReply, String> {
    let trimmed = prompt.trim();
    if trimmed.is_empty() {
        return Err("prompt cannot be empty".to_string());
    }
    let request_id = format!(
        "req-{}-{}",
        chrono::Utc::now().timestamp_millis(),
        REQ_SEQ.fetch_add(1, Ordering::Relaxed)
    );

    if use_cli {
        if let Some(bin) = find_hermes_binary() {
            let app_clone = app.clone();
            let req_clone = request_id.clone();
            let prompt_owned = trimmed.to_string();
            std::thread::spawn(move || {
                stream_hermes_cli(&app_clone, &req_clone, &bin, &prompt_owned);
            });
            return Ok(HermesChatReply {
                request_id,
                mode: "cli".to_string(),
                reply_text: String::new(),
                proposal: None,
                streaming: true,
            });
        }
    }

    let outcome = execute_local_intent(db, trimmed)?;
    if outcome.proposal.is_some() {
        if let Ok(pending) = ProposalsService::new(db).list_pending() {
            let payload: Vec<serde_json::Value> =
                pending.into_iter().map(|p| p.to_schema_json()).collect();
            let _ = app.emit("auradesk://proposals-updated", payload);
        }
    }

    let _ = app.emit(
        "auradesk://hermes-stream",
        HermesStreamEvent {
            request_id: request_id.clone(),
            chunk: outcome.reply_text.clone(),
            done: true,
            is_error: false,
        },
    );

    Ok(HermesChatReply {
        request_id,
        mode: if use_cli {
            "offline_fallback".to_string()
        } else {
            "local".to_string()
        },
        reply_text: outcome.reply_text,
        proposal: outcome.proposal,
        streaming: false,
    })
}

fn stream_hermes_cli(app: &AppHandle, request_id: &str, bin: &std::path::Path, prompt: &str) {
    let mut cmd = Command::new(bin);
    cmd.args(["chat", "-q", prompt])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }

    match cmd.spawn() {
        Ok(mut child) => {
            if let Some(stdout) = child.stdout.take() {
                let reader = BufReader::new(stdout);
                for line in reader.lines().map_while(Result::ok) {
                    let _ = app.emit(
                        "auradesk://hermes-stream",
                        HermesStreamEvent {
                            request_id: request_id.to_string(),
                            chunk: format!("{line}\n"),
                            done: false,
                            is_error: false,
                        },
                    );
                }
            }
            match child.wait() {
                Ok(status) if status.success() => {
                    let _ = app.emit(
                        "auradesk://hermes-stream",
                        HermesStreamEvent {
                            request_id: request_id.to_string(),
                            chunk: String::new(),
                            done: true,
                            is_error: false,
                        },
                    );
                }
                Ok(status) => {
                    let code = status.code().unwrap_or(-1).to_string();
                    let msg = auradesk_core::i18n::t_with("hermes.cli_failed", &[("code", &code)]);
                    let _ = app.emit(
                        "auradesk://hermes-stream",
                        HermesStreamEvent {
                            request_id: request_id.to_string(),
                            chunk: msg,
                            done: true,
                            is_error: true,
                        },
                    );
                }
                Err(e) => {
                    let _ = app.emit(
                        "auradesk://hermes-stream",
                        HermesStreamEvent {
                            request_id: request_id.to_string(),
                            chunk: format!("hermes wait error: {e}"),
                            done: true,
                            is_error: true,
                        },
                    );
                }
            }
        }
        Err(_) => {
            let msg = auradesk_core::i18n::t("hermes.cli_unavailable");
            let _ = app.emit(
                "auradesk://hermes-stream",
                HermesStreamEvent {
                    request_id: request_id.to_string(),
                    chunk: msg,
                    done: true,
                    is_error: true,
                },
            );
        }
    }
}

pub struct LocalIntentOutcome {
    pub reply_text: String,
    pub proposal: Option<serde_json::Value>,
}

/// Deterministic offline natural-language intent parser that creates `ia_proposals`
/// without requiring network or external LLM connectivity.
pub fn execute_local_intent(db: &Db, prompt: &str) -> Result<LocalIntentOutcome, String> {
    let trimmed = prompt.trim();
    let lower = trimmed.to_lowercase();

    if let Some(title) = strip_any_prefix(
        trimmed,
        &lower,
        &[
            "criar tarefa:",
            "criar tarefa ",
            "cria tarefa:",
            "cria tarefa ",
            "nova tarefa:",
            "nova tarefa ",
            "create task:",
            "create task ",
            "add task:",
            "add task ",
            "task:",
        ],
    ) {
        let priority = if lower.contains("urgente") || lower.contains("urgent") {
            "urgent"
        } else if lower.contains("alta") || lower.contains("high") {
            "high"
        } else {
            "normal"
        };
        let payload = serde_json::json!({
            "title": title,
            "priority": priority,
        });
        let summary =
            auradesk_core::i18n::t_with("hermes.proposal_task_summary", &[("title", &title)]);
        let svc = ProposalsService::new(db);
        let prop = svc
            .create_proposal("ui", "create_task", &payload, &summary)
            .map_err(|e| e.to_string())?;
        let args_str = serde_json::to_string(&payload).unwrap_or_else(|_| "{}".into());
        let _ = svc.log_command(
            "ui",
            "propose_create_task",
            &args_str,
            "ok",
            None,
            Some(&prop.id),
        );
        let reply =
            auradesk_core::i18n::t_with("hermes.proposal_created_reply", &[("summary", &summary)]);
        return Ok(LocalIntentOutcome {
            reply_text: reply,
            proposal: Some(prop.to_schema_json()),
        });
    }

    if let Some(title) = strip_any_prefix(
        trimmed,
        &lower,
        &[
            "criar lembrete:",
            "criar lembrete ",
            "lembrete:",
            "lembrete ",
            "lembrar de ",
            "create reminder:",
            "create reminder ",
            "remind me to ",
            "remind me:",
            "remind me ",
            "reminder:",
        ],
    ) {
        let fire_at = (chrono::Utc::now() + chrono::Duration::minutes(15)).to_rfc3339();
        let payload = serde_json::json!({
            "title": title,
            "fire_at": fire_at,
            "sound": "normal",
        });
        let summary =
            auradesk_core::i18n::t_with("hermes.proposal_reminder_summary", &[("title", &title)]);
        let svc = ProposalsService::new(db);
        let prop = svc
            .create_proposal("ui", "create_reminder", &payload, &summary)
            .map_err(|e| e.to_string())?;
        let args_str = serde_json::to_string(&payload).unwrap_or_else(|_| "{}".into());
        let _ = svc.log_command(
            "ui",
            "propose_create_reminder",
            &args_str,
            "ok",
            None,
            Some(&prop.id),
        );
        let reply =
            auradesk_core::i18n::t_with("hermes.proposal_created_reply", &[("summary", &summary)]);
        return Ok(LocalIntentOutcome {
            reply_text: reply,
            proposal: Some(prop.to_schema_json()),
        });
    }

    if lower.contains("resumo")
        || lower.contains("overview")
        || lower.contains("today")
        || lower.contains("hoje")
        || lower.contains("status")
    {
        let overview = dispatch_capability(db, "today_overview", serde_json::json!({}))
            .map_err(|e| e.to_string())?;
        let svc = ProposalsService::new(db);
        let _ = svc.log_command("ui", "today_overview", "{}", "ok", None, None);
        let overdue = overview
            .get("overdue_tasks")
            .and_then(|v| v.as_array())
            .map(|a| a.len())
            .unwrap_or(0)
            .to_string();
        let due_today = overview
            .get("due_today")
            .and_then(|v| v.as_array())
            .map(|a| a.len())
            .unwrap_or(0)
            .to_string();
        let in_progress = overview
            .get("in_progress")
            .and_then(|v| v.as_array())
            .map(|a| a.len())
            .unwrap_or(0)
            .to_string();
        let focus_min = overview
            .get("metrics_today")
            .and_then(|m| m.get("focus_minutes"))
            .and_then(|v| v.as_i64())
            .unwrap_or(0)
            .to_string();

        let reply = auradesk_core::i18n::t_with(
            "hermes.overview_reply",
            &[
                ("overdue", &overdue),
                ("due_today", &due_today),
                ("in_progress", &in_progress),
                ("focus_min", &focus_min),
            ],
        );
        return Ok(LocalIntentOutcome {
            reply_text: reply,
            proposal: None,
        });
    }

    Ok(LocalIntentOutcome {
        reply_text: auradesk_core::i18n::t("hermes.help_reply"),
        proposal: None,
    })
}

fn strip_any_prefix(original: &str, lower: &str, prefixes: &[&str]) -> Option<String> {
    for p in prefixes {
        if lower.starts_with(p) {
            let rest = original[p.len()..].trim();
            if !rest.is_empty() {
                return Some(rest.to_string());
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn offline_intent_creates_pending_proposal_and_audit_log_without_direct_task_mutation() {
        let db = Db::open_in_memory().unwrap();
        let out = execute_local_intent(&db, "cria tarefa Revisar arquitetura").unwrap();
        assert!(out.proposal.is_some());

        let svc = ProposalsService::new(&db);
        assert_eq!(svc.list_pending().unwrap().len(), 1);
        let cmds = svc.list_commands(10).unwrap();
        assert_eq!(cmds.len(), 1);
        assert_eq!(cmds[0].tool_name, "propose_create_task");
        assert_eq!(cmds[0].source, "ui");

        let tasks = auradesk_core::application::tasks::TasksService::new(&db)
            .list(&Default::default())
            .unwrap();
        assert!(tasks.is_empty());
    }

    #[test]
    fn offline_intent_creates_reminder_proposal_and_handles_summary() {
        let db = Db::open_in_memory().unwrap();
        let rem = execute_local_intent(&db, "remind me Stretch legs").unwrap();
        assert!(rem.proposal.is_some());

        let summary = execute_local_intent(&db, "today overview").unwrap();
        assert!(summary.proposal.is_none());
        assert!(!summary.reply_text.is_empty());

        let cmds = ProposalsService::new(&db).list_commands(10).unwrap();
        assert_eq!(cmds.len(), 2);
    }
}
