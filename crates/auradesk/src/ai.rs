//! Multi-provider AI orchestrator for Aura.
//!
//! Supports OpenAI / Codex API, MiniMax, Ollama (local), OpenRouter, Custom
//! OpenAI-compatible endpoints, local CLIs (`hermes`, `codex`), and deterministic
//! offline intent proposals. All conversation turns are persisted in `chat_messages`.

use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use auradesk_core::application::agents::AgentOrchestratorService;
use auradesk_core::application::chat::{ChatService, DEFAULT_CHAT_SESSION};
use auradesk_core::application::context_engine::ContextEngineService;
use auradesk_core::application::pomodoros::PomodorosService;
use auradesk_core::application::reminders::RemindersService;
use auradesk_core::application::settings::SettingsService;
use auradesk_core::application::tasks::TasksService;
use auradesk_core::domain::ai::{build_aura_system_prompt, AiProviderKind, NewChatMessage};
use auradesk_core::domain::settings_key::SettingsKey;
use auradesk_core::domain::task::{TaskFilter, TaskStatus};
use auradesk_core::infrastructure::clock::SystemClock;
use auradesk_core::infrastructure::db::Db;
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::hermes::{HermesChatReply, HermesStreamEvent};

static AI_REQ_SEQ: AtomicU64 = AtomicU64::new(1);

/// Snapshot of the resolved AI provider configuration and local CLI availability.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiProviderStatus {
    pub configured_provider: String,
    pub active_provider: String,
    pub model: String,
    pub base_url: Option<String>,
    pub has_api_key: bool,
    pub hermes_cli_available: bool,
    pub codex_cli_available: bool,
    pub ready: bool,
}

#[derive(Debug, Clone)]
struct ResolvedProvider {
    configured: AiProviderKind,
    active: AiProviderKind,
    base_url: Option<String>,
    model: String,
    api_key: Option<String>,
    system_prompt: Option<String>,
    locale: String,
    hermes_cli: bool,
    codex_cli: Option<PathBuf>,
}

fn read_str_setting(settings: &SettingsService, key: SettingsKey) -> Option<String> {
    settings
        .get(key)
        .ok()
        .flatten()
        .and_then(|v| v.as_str().map(str::to_string))
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn find_cli_binary(name: &str, env_override: &str) -> Option<PathBuf> {
    if let Some(ov) = std::env::var_os(env_override).filter(|s| !s.is_empty()) {
        let p = PathBuf::from(ov);
        if p.exists() {
            return Some(p);
        }
    }
    #[cfg(target_os = "windows")]
    let candidates = [
        format!("{name}.exe"),
        format!("{name}.cmd"),
        name.to_string(),
    ];
    #[cfg(not(target_os = "windows"))]
    let candidates = [name.to_string()];

    if let Some(path_env) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&path_env) {
            for cand in &candidates {
                let full = dir.join(cand);
                if full.is_file() {
                    return Some(full);
                }
            }
        }
    }
    None
}

fn resolve_provider(db: &Db) -> ResolvedProvider {
    let settings = SettingsService::new(db);
    let configured = read_str_setting(&settings, SettingsKey::AiProvider)
        .map(|s| AiProviderKind::from_str(&s))
        .unwrap_or(AiProviderKind::Auto);
    let custom_base = read_str_setting(&settings, SettingsKey::AiBaseUrl);
    let custom_model = read_str_setting(&settings, SettingsKey::AiModel);
    let setting_key = read_str_setting(&settings, SettingsKey::AiApiKey);
    let system_prompt = read_str_setting(&settings, SettingsKey::AiSystemPrompt);
    let locale =
        read_str_setting(&settings, SettingsKey::AppLocale).unwrap_or_else(|| "pt-BR".to_string());

    let hermes_cli = crate::hermes::check_hermes_status().available;
    let codex_cli = find_cli_binary("codex", "CODEX_BIN");

    let active = match configured {
        AiProviderKind::Auto => {
            if setting_key.is_some() && custom_base.is_some() {
                AiProviderKind::Custom
            } else if std::env::var("MINIMAX_API_KEY")
                .ok()
                .filter(|s| !s.trim().is_empty())
                .is_some()
            {
                AiProviderKind::MiniMax
            } else if setting_key.is_some()
                || std::env::var("OPENAI_API_KEY")
                    .ok()
                    .filter(|s| !s.trim().is_empty())
                    .is_some()
            {
                AiProviderKind::OpenAi
            } else if std::env::var("OPENROUTER_API_KEY")
                .ok()
                .filter(|s| !s.trim().is_empty())
                .is_some()
            {
                AiProviderKind::OpenRouter
            } else if hermes_cli {
                AiProviderKind::HermesCli
            } else if codex_cli.is_some() {
                AiProviderKind::CodexCli
            } else {
                AiProviderKind::Offline
            }
        }
        other => other,
    };

    let base_url = custom_base.or_else(|| active.default_base_url().map(str::to_string));

    let model = custom_model
        .or_else(|| active.default_model().map(str::to_string))
        .unwrap_or_else(|| active.as_str().to_string());

    let api_key = setting_key.or_else(|| {
        active
            .env_api_key_name()
            .and_then(|env_name| std::env::var(env_name).ok())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
    });

    ResolvedProvider {
        configured,
        active,
        base_url,
        model,
        api_key,
        system_prompt,
        locale,
        hermes_cli,
        codex_cli,
    }
}

/// Inspect active AI provider readiness without making any network requests.
pub fn provider_status(db: &Db) -> AiProviderStatus {
    let r = resolve_provider(db);
    let ready = match r.active {
        AiProviderKind::Ollama => r.base_url.is_some(),
        AiProviderKind::OpenAi
        | AiProviderKind::MiniMax
        | AiProviderKind::OpenRouter
        | AiProviderKind::Custom => r.base_url.is_some() && r.api_key.is_some(),
        AiProviderKind::HermesCli => r.hermes_cli,
        AiProviderKind::CodexCli => r.codex_cli.is_some(),
        AiProviderKind::Offline | AiProviderKind::Auto => true,
    };

    AiProviderStatus {
        configured_provider: r.configured.as_str().to_string(),
        active_provider: r.active.as_str().to_string(),
        model: r.model,
        base_url: r.base_url,
        has_api_key: r.api_key.is_some(),
        hermes_cli_available: r.hermes_cli,
        codex_cli_available: r.codex_cli.is_some(),
        ready,
    }
}

fn build_live_workspace_context(db: &Db) -> String {
    let tasks_svc = TasksService::new(db);
    let all_tasks = tasks_svc.list(&TaskFilter::default()).unwrap_or_default();
    let doing: Vec<&str> = all_tasks
        .iter()
        .filter(|t| t.status == TaskStatus::Doing)
        .take(5)
        .map(|t| t.title.as_str())
        .collect();
    let todo_count = all_tasks
        .iter()
        .filter(|t| t.status == TaskStatus::Todo)
        .count();
    let done_count = all_tasks
        .iter()
        .filter(|t| t.status == TaskStatus::Done)
        .count();

    let clock = SystemClock;
    let running_pomo = PomodorosService::with_clock(db, &clock)
        .running_session()
        .ok()
        .flatten();
    let active_reminders = RemindersService::new(db)
        .list(false)
        .map(|v| v.len())
        .unwrap_or(0);

    let mut lines = vec![
        "workspace_snapshot:".to_string(),
        format!(
            "tasks_todo={todo_count} tasks_doing={} tasks_done={done_count}",
            doing.len()
        ),
        format!("active_reminders={active_reminders}"),
    ];
    if !doing.is_empty() {
        lines.push(format!("- Currently in progress: {}.", doing.join("; ")));
    }
    if let Some(pomo) = running_pomo {
        lines.push(format!(
            "- Active Pomodoro: {:?} ({} min planned).",
            pomo.kind, pomo.planned_min
        ));
    }
    lines.join("\n")
}

/// Send a user message through the configured AI provider (HTTP OpenAI-compatible,
/// Codex CLI, Hermes CLI, or Offline fallback), persisting turns into `chat_messages`
/// for the active session and orchestrating Context Engine compression.
pub fn send_chat_prompt(
    app: &AppHandle,
    db: &Arc<Db>,
    prompt: &str,
    use_cli_hint: bool,
    session_id: Option<&str>,
) -> Result<HermesChatReply, String> {
    let trimmed = prompt.trim();
    if trimmed.is_empty() {
        return Err("prompt cannot be empty".to_string());
    }
    let sid = session_id
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(DEFAULT_CHAT_SESSION)
        .to_string();

    let resolved = resolve_provider(db);
    let chat_svc = ChatService::new(db);
    let _ = chat_svc.append(NewChatMessage {
        session_id: sid.clone(),
        role: "user".to_string(),
        content: trimmed.to_string(),
        provider: None,
        model: None,
        area_id: None,
    });
    let _ = AgentOrchestratorService::new(db).plan_goal(Some(&sid), trimmed);

    // HTTP OpenAI-compatible providers (OpenAI / Codex API, MiniMax, Ollama, OpenRouter, Custom)
    if resolved.active.is_http_openai_compatible() {
        let can_call = match resolved.active {
            AiProviderKind::Ollama => resolved.base_url.is_some(),
            _ => resolved.base_url.is_some() && resolved.api_key.is_some(),
        };
        if can_call {
            return spawn_openai_compatible_chat(app, db, trimmed, resolved, sid);
        }
    }

    // Codex CLI adapter
    if resolved.active == AiProviderKind::CodexCli {
        if let Some(bin) = resolved.codex_cli.clone() {
            return spawn_codex_cli_chat(app, db, trimmed, bin, resolved, sid);
        }
    }

    // Retrieve & record context layers even in Hermes/Offline mode so Context Engine tracks session growth.
    let recalled: Vec<(String, String, String)> = crate::hindsight::recall(db, trimmed, None, 6)
        .into_iter()
        .map(|m| (m.id, m.bank, m.content))
        .collect();
    let ws_ctx = build_live_workspace_context(db);
    let base_sys =
        build_aura_system_prompt(&resolved.locale, "", resolved.system_prompt.as_deref());
    let _ = ContextEngineService::new(db).build_context(
        Some(&sid),
        trimmed,
        &base_sys,
        &ws_ctx,
        &recalled,
        &[],
    );

    // Hermes CLI or deterministic offline fallback (preserves full existing proposal workflow)
    let prefer_hermes_cli =
        resolved.active == AiProviderKind::HermesCli || (use_cli_hint && resolved.hermes_cli);
    let reply = crate::hermes::handle_chat_prompt(app, db, trimmed, prefer_hermes_cli)?;
    if !reply.streaming && !reply.reply_text.trim().is_empty() {
        let _ = ChatService::new(db).append(NewChatMessage {
            session_id: sid,
            role: "assistant".to_string(),
            content: reply.reply_text.clone(),
            provider: Some(reply.mode.clone()),
            model: Some(resolved.model),
            area_id: None,
        });
    }
    Ok(reply)
}

fn spawn_openai_compatible_chat(
    app: &AppHandle,
    db: &Arc<Db>,
    prompt: &str,
    resolved: ResolvedProvider,
    session_id: String,
) -> Result<HermesChatReply, String> {
    let req_id = format!("aura-{}", AI_REQ_SEQ.fetch_add(1, Ordering::Relaxed));
    let app_clone = app.clone();
    let db_clone = Arc::clone(db);
    let prompt_owned = prompt.to_string();
    let req_id_clone = req_id.clone();
    let provider_name = resolved.active.as_str().to_string();
    let model_name = resolved.model.clone();

    std::thread::spawn(move || {
        let mut live_ctx = build_live_workspace_context(&db_clone);
        let mut tool_outputs = Vec::new();
        if let Some(rag_ctx) = crate::raglight::query_context_for_prompt(&db_clone, &prompt_owned) {
            live_ctx.push_str("\n\n");
            live_ctx.push_str(&rag_ctx);
            tool_outputs.push(rag_ctx);
        }
        let recalled_items = crate::hindsight::recall(&db_clone, &prompt_owned, None, 8);
        let recalled_tuples: Vec<(String, String, String)> = recalled_items
            .iter()
            .map(|m| (m.id.clone(), m.bank.clone(), m.content.clone()))
            .collect();
        if let Some(mem_ctx) = crate::hindsight::recall_context_for_prompt(&db_clone, &prompt_owned)
        {
            live_ctx.push_str("\n\n");
            live_ctx.push_str(&mem_ctx);
        }

        let base_sys = build_aura_system_prompt(
            &resolved.locale,
            &live_ctx,
            resolved.system_prompt.as_deref(),
        );
        let ctx_pkg = ContextEngineService::new(&db_clone)
            .build_context(
                Some(&session_id),
                &prompt_owned,
                &base_sys,
                &live_ctx,
                &recalled_tuples,
                &tool_outputs,
            )
            .ok();

        let mut system_prompt = base_sys;
        if let Some(ref pkg) = ctx_pkg {
            if !pkg.session.semantic_summary.trim().is_empty() {
                system_prompt.push_str("\n\nsession_compressed_summary:\n");
                system_prompt.push_str(pkg.session.semantic_summary.trim());
            }
        }

        let history = ctx_pkg.map(|p| p.recent_messages).unwrap_or_else(|| {
            ChatService::new(&db_clone)
                .list_recent(Some(&session_id), 14)
                .unwrap_or_default()
        });

        let mut messages = vec![serde_json::json!({
            "role": "system",
            "content": system_prompt,
        })];

        for msg in history {
            if msg.role == "user" || msg.role == "assistant" {
                messages.push(serde_json::json!({
                    "role": msg.role,
                    "content": msg.content,
                }));
            }
        }
        // Ensure latest prompt is present if history lookup missed it.
        if messages
            .last()
            .and_then(|m| m.get("content"))
            .and_then(|c| c.as_str())
            != Some(prompt_owned.as_str())
        {
            messages.push(serde_json::json!({
                "role": "user",
                "content": prompt_owned,
            }));
        }

        let base = resolved
            .base_url
            .as_deref()
            .unwrap_or("https://api.openai.com/v1")
            .trim_end_matches('/');
        let url = format!("{base}/chat/completions");

        let client = match reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(90))
            .build()
        {
            Ok(c) => c,
            Err(e) => {
                emit_stream(
                    &app_clone,
                    &req_id_clone,
                    format!("http_client_error: {e}"),
                    true,
                    true,
                );
                return;
            }
        };

        let mut req = client.post(&url).json(&serde_json::json!({
            "model": resolved.model,
            "messages": messages,
            "temperature": 0.6,
        }));
        if let Some(key) = resolved.api_key.as_deref() {
            req = req.bearer_auth(key);
        }

        match req.send() {
            Ok(resp) => {
                let status = resp.status();
                let body_text = resp.text().unwrap_or_default();
                if !status.is_success() {
                    let preview: String = body_text.chars().take(280).collect();
                    emit_stream(
                        &app_clone,
                        &req_id_clone,
                        format!("Provider {provider_name} returned HTTP {status}: {preview}"),
                        true,
                        true,
                    );
                    return;
                }

                let parsed: serde_json::Value = match serde_json::from_str(&body_text) {
                    Ok(v) => v,
                    Err(e) => {
                        emit_stream(
                            &app_clone,
                            &req_id_clone,
                            format!("Invalid JSON from {provider_name}: {e}"),
                            true,
                            true,
                        );
                        return;
                    }
                };

                let content = parsed
                    .pointer("/choices/0/message/content")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .trim()
                    .to_string();

                if content.is_empty() {
                    emit_stream(
                        &app_clone,
                        &req_id_clone,
                        format!("Empty response from {provider_name} ({model_name})."),
                        true,
                        true,
                    );
                    return;
                }

                let _ = ChatService::new(&db_clone).append(NewChatMessage {
                    session_id: session_id.clone(),
                    role: "assistant".to_string(),
                    content: content.clone(),
                    provider: Some(provider_name),
                    model: Some(model_name),
                    area_id: None,
                });

                let reply_for_memory = content.clone();
                emit_stream(&app_clone, &req_id_clone, content, true, false);
                crate::hindsight::retain_conversation_turn(
                    &db_clone,
                    &prompt_owned,
                    &reply_for_memory,
                );
            }
            Err(err) => {
                emit_stream(
                    &app_clone,
                    &req_id_clone,
                    format!("Request to {provider_name} failed: {err}"),
                    true,
                    true,
                );
            }
        }
    });

    Ok(HermesChatReply {
        request_id: req_id,
        mode: resolved.active.as_str().to_string(),
        reply_text: String::new(),
        proposal: None,
        streaming: true,
    })
}

fn spawn_codex_cli_chat(
    app: &AppHandle,
    db: &Arc<Db>,
    prompt: &str,
    bin: PathBuf,
    resolved: ResolvedProvider,
    session_id: String,
) -> Result<HermesChatReply, String> {
    let req_id = format!("codex-{}", AI_REQ_SEQ.fetch_add(1, Ordering::Relaxed));
    let app_clone = app.clone();
    let db_clone = Arc::clone(db);
    let prompt_owned = prompt.to_string();
    let req_id_clone = req_id.clone();

    std::thread::spawn(move || {
        let child = Command::new(&bin)
            .args(["exec", &prompt_owned])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn();

        match child {
            Ok(mut proc) => {
                let mut acc = String::new();
                if let Some(stdout) = proc.stdout.take() {
                    for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                        if !acc.is_empty() {
                            acc.push('\n');
                        }
                        acc.push_str(&line);
                        emit_stream(&app_clone, &req_id_clone, format!("{line}\n"), false, false);
                    }
                }
                let _ = proc.wait();
                if !acc.trim().is_empty() {
                    let _ = ChatService::new(&db_clone).append(NewChatMessage {
                        session_id,
                        role: "assistant".to_string(),
                        content: acc,
                        provider: Some("codex_cli".to_string()),
                        model: Some(resolved.model),
                        area_id: None,
                    });
                }
                emit_stream(&app_clone, &req_id_clone, String::new(), true, false);
            }
            Err(e) => {
                emit_stream(
                    &app_clone,
                    &req_id_clone,
                    format!("codex_cli_spawn_error: {e}"),
                    true,
                    true,
                );
            }
        }
    });

    Ok(HermesChatReply {
        request_id: req_id,
        mode: "codex_cli".to_string(),
        reply_text: String::new(),
        proposal: None,
        streaming: true,
    })
}

fn emit_stream(app: &AppHandle, req_id: &str, chunk: String, done: bool, is_error: bool) {
    let _ = app.emit(
        "auradesk://hermes-stream",
        HermesStreamEvent {
            request_id: req_id.to_string(),
            chunk,
            done,
            is_error,
        },
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_configured_minimax_provider_and_readiness() {
        let db = Db::open_in_memory().unwrap();
        let settings = SettingsService::new(&db);
        settings
            .set(SettingsKey::AiProvider, serde_json::json!("minimax"))
            .unwrap();
        settings
            .set(SettingsKey::AiApiKey, serde_json::json!("test-secret"))
            .unwrap();

        let status = provider_status(&db);
        assert_eq!(status.active_provider, "minimax");
        assert_eq!(status.model, "MiniMax-M1");
        assert_eq!(
            status.base_url.as_deref(),
            Some("https://api.minimax.io/v1")
        );
        assert!(status.has_api_key);
        assert!(status.ready);
    }

    #[test]
    fn resolves_ollama_without_api_key() {
        let db = Db::open_in_memory().unwrap();
        let settings = SettingsService::new(&db);
        settings
            .set(SettingsKey::AiProvider, serde_json::json!("ollama"))
            .unwrap();

        let status = provider_status(&db);
        assert_eq!(status.active_provider, "ollama");
        assert_eq!(status.model, "llama3.2");
        assert!(status.ready);
    }
}
