//! GitHub sync, ZIP backup/restore, routines, Hermes chat, proposals, and voice capture IPC commands.

use auradesk_core::application::{
    data_io::{DataIoService, ImportSummary},
    github::GithubSyncService,
    proposals::ProposalsService,
    routines::RoutinesService,
};
use auradesk_core::domain::github::{
    GithubAuthStatus, GithubIssueLink, GithubSyncSummary, IssueFetcher,
};
use auradesk_core::domain::routine::Routine;
use tauri::{AppHandle, State};

use crate::github::GhCliIssueFetcher;
use crate::runtime::{db_from, AppState};

// ── GitHub Issues → Kanban (ADR-0013) ─────────────────────────────────

#[tauri::command]
pub fn github_sync_issues(
    state: State<'_, AppState>,
    project_id: Option<String>,
    label_filter: Option<String>,
) -> Result<GithubSyncSummary, String> {
    let db = db_from(&state);
    let svc = GithubSyncService::new(&db, state.github_fetcher.as_ref());
    svc.sync(project_id.as_deref(), label_filter.as_deref())
        .map_err(|e| format!("github_sync_issues: {e}"))
}

#[tauri::command]
pub fn github_issues_list(
    state: State<'_, AppState>,
    project_id: Option<String>,
) -> Result<Vec<GithubIssueLink>, String> {
    let db = db_from(&state);
    let svc = GithubSyncService::new(&db, state.github_fetcher.as_ref());
    svc.list_links(project_id.as_deref())
        .map_err(|e| format!("github_issues_list: {e}"))
}

#[tauri::command]
pub fn github_link_task(
    state: State<'_, AppState>,
    task_id: String,
    repo: String,
    number: i64,
) -> Result<GithubIssueLink, String> {
    let db = db_from(&state);
    let svc = GithubSyncService::new(&db, state.github_fetcher.as_ref());
    svc.link_task(&task_id, &repo, number)
        .map_err(|e| format!("github_link_task: {e}"))
}

#[tauri::command]
pub fn github_unlink_task(state: State<'_, AppState>, task_id: String) -> Result<(), String> {
    let db = db_from(&state);
    let svc = GithubSyncService::new(&db, state.github_fetcher.as_ref());
    svc.unlink_task(&task_id)
        .map_err(|e| format!("github_unlink_task: {e}"))
}

#[tauri::command]
pub fn github_check_auth() -> GithubAuthStatus {
    let fetcher = GhCliIssueFetcher::new();
    match fetcher.auth_status() {
        Ok(Some(account)) => GithubAuthStatus {
            available: true,
            authenticated: true,
            account: Some(account),
            message: None,
        },
        Ok(None) => GithubAuthStatus {
            available: true,
            authenticated: false,
            account: None,
            message: Some("github.authRequired".to_string()),
        },
        Err(_) => GithubAuthStatus {
            available: false,
            authenticated: false,
            account: None,
            message: Some("github.cliMissing".to_string()),
        },
    }
}

// ── Backup .zip Export / Import (Issue #10) ───────────────────────────

#[tauri::command]
pub fn data_export_zip(state: State<'_, AppState>) -> Result<String, String> {
    let db = db_from(&state);
    DataIoService::new(&db)
        .export_zip_base64()
        .map_err(|e| format!("data_export_zip: {e}"))
}

#[tauri::command]
pub fn data_import_zip(
    state: State<'_, AppState>,
    zip_base64: String,
) -> Result<ImportSummary, String> {
    let db = db_from(&state);
    DataIoService::new(&db)
        .import_zip_base64(&zip_base64)
        .map_err(|e| format!("data_import_zip: {e}"))
}

// ── Routines & IA Proposals (ADR-0011) ────────────────────────────────

#[tauri::command]
pub fn routines_list(state: State<'_, AppState>) -> Result<Vec<Routine>, String> {
    let db = db_from(&state);
    RoutinesService::new(&db)
        .list(false)
        .map_err(|e| format!("routines_list: {e}"))
}

#[tauri::command]
pub fn routines_set_enabled(
    state: State<'_, AppState>,
    id: String,
    enabled: bool,
) -> Result<Routine, String> {
    let db = db_from(&state);
    RoutinesService::new(&db)
        .set_enabled(&id, enabled)
        .map_err(|e| format!("routines_set_enabled: {e}"))
}

#[tauri::command]
pub fn proposals_list_pending(
    state: State<'_, AppState>,
) -> Result<Vec<serde_json::Value>, String> {
    let db = db_from(&state);
    let list = ProposalsService::new(&db)
        .list_pending()
        .map_err(|e| format!("proposals_list_pending: {e}"))?;
    Ok(list.into_iter().map(|p| p.to_schema_json()).collect())
}

#[tauri::command]
pub fn proposals_list_recent(
    state: State<'_, AppState>,
    limit: Option<i64>,
) -> Result<Vec<serde_json::Value>, String> {
    let db = db_from(&state);
    let list = ProposalsService::new(&db)
        .list_recent(limit.unwrap_or(50))
        .map_err(|e| format!("proposals_list_recent: {e}"))?;
    Ok(list.into_iter().map(|p| p.to_schema_json()).collect())
}

#[tauri::command]
pub fn proposals_approve(
    state: State<'_, AppState>,
    id: String,
    note: Option<String>,
    modifications: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    let db = db_from(&state);
    let mut payload = serde_json::json!({ "id": id });
    if let Some(obj) = payload.as_object_mut() {
        if let Some(n) = note {
            obj.insert("note".to_string(), serde_json::Value::String(n));
        }
        if let Some(mods) = modifications {
            if mods.is_object() {
                obj.insert("modifications".to_string(), mods);
            }
        }
    }
    auradesk_core::capabilities::dispatch_capability(&db, "approve_proposal", payload)
        .map_err(|e| format!("proposals_approve: {e}"))
}

#[tauri::command]
pub fn proposals_reject(
    state: State<'_, AppState>,
    id: String,
    note: Option<String>,
) -> Result<serde_json::Value, String> {
    let db = db_from(&state);
    ProposalsService::new(&db)
        .reject(&id, note.as_deref())
        .map(|p| p.to_schema_json())
        .map_err(|e| format!("proposals_reject: {e}"))
}

#[tauri::command]
pub fn ia_commands_list(
    state: State<'_, AppState>,
    limit: Option<i64>,
) -> Result<Vec<auradesk_core::application::proposals::IaCommandEntry>, String> {
    let db = db_from(&state);
    ProposalsService::new(&db)
        .list_commands(limit.unwrap_or(50))
        .map_err(|e| format!("ia_commands_list: {e}"))
}

#[tauri::command]
pub fn hermes_status() -> crate::hermes::HermesStatus {
    crate::hermes::check_hermes_status()
}

/// Stops a running assistant reply.
///
/// The CLI child is killed, its stdout closes and the stream emits its
/// final `done` event, so the frontend settles exactly like a normal end.
#[tauri::command]
pub fn hermes_chat_cancel(request_id: String) -> bool {
    crate::hermes::cancel_stream(&request_id)
}

#[tauri::command]
pub fn ai_provider_status(state: State<'_, AppState>) -> crate::ai::AiProviderStatus {
    let db = db_from(&state);
    crate::ai::provider_status(&db)
}

#[tauri::command]
pub fn ai_chat_history(
    state: State<'_, AppState>,
    session_id: Option<String>,
    limit: Option<usize>,
) -> Result<Vec<auradesk_core::domain::ai::ChatMessage>, String> {
    let db = db_from(&state);
    auradesk_core::application::chat::ChatService::new(&db)
        .list_recent(session_id.as_deref(), limit.unwrap_or(50))
        .map_err(|e| format!("ai_chat_history: {e}"))
}

#[tauri::command]
pub fn ai_chat_clear(
    state: State<'_, AppState>,
    session_id: Option<String>,
) -> Result<usize, String> {
    let db = db_from(&state);
    auradesk_core::application::chat::ChatService::new(&db)
        .clear_session(session_id.as_deref())
        .map_err(|e| format!("ai_chat_clear: {e}"))
}

#[tauri::command]
pub fn hermes_chat_send(
    app: AppHandle,
    state: State<'_, AppState>,
    prompt: String,
    use_cli: Option<bool>,
    session_id: Option<String>,
) -> Result<crate::hermes::HermesChatReply, String> {
    let db = db_from(&state);
    crate::ai::send_chat_prompt(
        &app,
        &db,
        &prompt,
        use_cli.unwrap_or(false),
        session_id.as_deref(),
    )
}

#[tauri::command]
pub fn audio_capture_save(
    state: State<'_, AppState>,
    wav_base64: String,
    filename: Option<String>,
) -> Result<crate::hermes::VoiceCaptureResult, String> {
    let dir = state.data_dir.join("voice-captures");
    let (file_path, bytes) = auradesk_core::application::data_io::save_voice_capture_base64(
        &dir,
        &wav_base64,
        filename.as_deref(),
    )
    .map_err(|e| format!("audio_capture_save: {e}"))?;
    Ok(crate::hermes::VoiceCaptureResult { file_path, bytes })
}

#[tauri::command]
pub async fn raglight_status(
    state: State<'_, AppState>,
) -> Result<crate::raglight::RaglightStatus, String> {
    let db = db_from(&state);
    let data_dir = state.data_dir.clone();
    let mgr = std::sync::Arc::clone(&state.raglight);
    tauri::async_runtime::spawn_blocking(move || crate::raglight::status(&db, &data_dir, &mgr))
        .await
        .map_err(|e| format!("raglight_status join: {e}"))
}

#[tauri::command]
pub async fn raglight_provision(
    state: State<'_, AppState>,
) -> Result<crate::raglight::RaglightActionResult, String> {
    let db = db_from(&state);
    let data_dir = state.data_dir.clone();
    let mgr = std::sync::Arc::clone(&state.raglight);
    tauri::async_runtime::spawn_blocking(move || {
        crate::raglight::provision_and_install(&db, &data_dir, &mgr)
    })
    .await
    .map_err(|e| format!("raglight_provision join: {e}"))?
}

#[tauri::command]
pub async fn raglight_start(
    state: State<'_, AppState>,
) -> Result<crate::raglight::RaglightActionResult, String> {
    let db = db_from(&state);
    let data_dir = state.data_dir.clone();
    let mgr = std::sync::Arc::clone(&state.raglight);
    tauri::async_runtime::spawn_blocking(move || {
        crate::raglight::start_server(&db, &data_dir, &mgr)
    })
    .await
    .map_err(|e| format!("raglight_start join: {e}"))?
}

#[tauri::command]
pub fn raglight_stop(state: State<'_, AppState>) -> crate::raglight::RaglightActionResult {
    let db = db_from(&state);
    crate::raglight::stop_server(&db, &state.data_dir, &state.raglight)
}

#[tauri::command]
pub async fn raglight_ingest(
    state: State<'_, AppState>,
) -> Result<crate::raglight::RaglightActionResult, String> {
    let db = db_from(&state);
    let data_dir = state.data_dir.clone();
    let mgr = std::sync::Arc::clone(&state.raglight);
    tauri::async_runtime::spawn_blocking(move || {
        crate::raglight::ingest_folders(&db, &data_dir, &mgr)
    })
    .await
    .map_err(|e| format!("raglight_ingest join: {e}"))?
}

#[tauri::command]
pub async fn raglight_query(
    state: State<'_, AppState>,
    query: String,
    top_k: Option<usize>,
) -> Result<crate::raglight::RaglightQueryResult, String> {
    let db = db_from(&state);
    tauri::async_runtime::spawn_blocking(move || {
        crate::raglight::query(&db, &query, top_k.unwrap_or(5))
    })
    .await
    .map_err(|e| format!("raglight_query join: {e}"))?
}

#[tauri::command]
pub async fn hindsight_status(
    state: State<'_, AppState>,
) -> Result<crate::hindsight::HindsightStatus, String> {
    let db = db_from(&state);
    tauri::async_runtime::spawn_blocking(move || crate::hindsight::status(&db))
        .await
        .map_err(|e| format!("hindsight_status join: {e}"))
}

#[tauri::command]
pub async fn hindsight_run_maintenance(
    state: State<'_, AppState>,
) -> Result<crate::hindsight::HindsightMaintenanceResult, String> {
    let db = db_from(&state);
    tauri::async_runtime::spawn_blocking(move || crate::hindsight::run_maintenance_now(&db))
        .await
        .map_err(|e| format!("hindsight_run_maintenance join: {e}"))
}

#[tauri::command]
pub async fn hindsight_recall(
    state: State<'_, AppState>,
    query: String,
    bank: Option<String>,
    limit: Option<usize>,
) -> Result<Vec<crate::hindsight::HindsightRecallItem>, String> {
    let db = db_from(&state);
    tauri::async_runtime::spawn_blocking(move || {
        crate::hindsight::recall(&db, &query, bank.as_deref(), limit.unwrap_or(8))
    })
    .await
    .map_err(|e| format!("hindsight_recall join: {e}"))
}
