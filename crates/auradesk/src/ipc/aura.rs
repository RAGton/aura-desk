//! Tauri IPC commands for Hindsight exploration, LightRAG/RAGLight knowledge exploration,
//! multi-session conversation center, autonomous Context Engine, and Agent orchestration.

use std::sync::Arc;

use auradesk_core::application::agents::{
    AgentBotRecord, AgentOrchestratorService, AgentRunRecord, AgentSkillRecord, AgentToolEntry,
    AgentsOverview, InstallSkillInput, McpPluginRecord, UpsertBotInput, UpsertMcpPluginInput,
};
use auradesk_core::application::chat::ChatService;
use auradesk_core::application::context_engine::{ContextEngineService, ContextInspection};
use auradesk_core::domain::ai::ChatSession;
use tauri::State;

use crate::hindsight_explore::{
    HindsightBankStats, HindsightBankSummary, HindsightDirective, HindsightDocumentDetail,
    HindsightDocumentPage, HindsightEntityDetail, HindsightEntityPage, HindsightGalaxySnapshot,
    HindsightGlobalSearchHit, HindsightGraphPayload, HindsightMemoryDetail,
    HindsightMemoryHistoryEntry, HindsightMemoryPage, HindsightMentalModel,
    HindsightMentalModelPage, HindsightOperation, HindsightTag,
};
use crate::raglight::{
    KnowledgeDocumentDetail, KnowledgeDocumentsResult, KnowledgeExplorerOverview,
    KnowledgeGraphPayload, KnowledgeSearchResult,
};
use crate::runtime::{db_from, AppState};

// ── Hindsight Full Explorer & 3D Memory Galaxy ──────────────────────────

#[tauri::command]
pub async fn hindsight_banks_list(
    state: State<'_, AppState>,
) -> Result<Vec<HindsightBankSummary>, String> {
    let db = db_from(&state);
    tauri::async_runtime::spawn_blocking(move || crate::hindsight_explore::banks_list(&db))
        .await
        .map_err(|e| format!("hindsight_banks_list join: {e}"))?
}

#[tauri::command]
pub async fn hindsight_bank_create(
    state: State<'_, AppState>,
    bank_id: String,
    name: Option<String>,
    mission: Option<String>,
    background: Option<String>,
) -> Result<HindsightBankSummary, String> {
    let db = db_from(&state);
    tauri::async_runtime::spawn_blocking(move || {
        crate::hindsight_explore::bank_create(
            &db,
            &bank_id,
            name.as_deref(),
            mission.as_deref(),
            background.as_deref(),
        )
    })
    .await
    .map_err(|e| format!("hindsight_bank_create join: {e}"))?
}

/// Renames a bank or changes its mission/background.
#[tauri::command]
pub async fn hindsight_bank_update(
    state: State<'_, AppState>,
    bank_id: String,
    name: Option<String>,
    mission: Option<String>,
    background: Option<String>,
) -> Result<HindsightBankSummary, String> {
    let db = db_from(&state);
    tauri::async_runtime::spawn_blocking(move || {
        crate::hindsight_explore::bank_update(
            &db,
            &bank_id,
            name.as_deref(),
            mission.as_deref(),
            background.as_deref(),
        )
    })
    .await
    .map_err(|e| format!("hindsight_bank_update join: {e}"))?
}

/// Deletes a bank and everything it holds.
#[tauri::command]
pub async fn hindsight_bank_delete(
    state: State<'_, AppState>,
    bank_id: String,
) -> Result<(), String> {
    let db = db_from(&state);
    tauri::async_runtime::spawn_blocking(move || {
        crate::hindsight_explore::bank_delete(&db, &bank_id)
    })
    .await
    .map_err(|e| format!("hindsight_bank_delete join: {e}"))?
}

#[tauri::command]
pub async fn hindsight_bank_stats(
    state: State<'_, AppState>,
    bank: String,
) -> Result<HindsightBankStats, String> {
    let db = db_from(&state);
    tauri::async_runtime::spawn_blocking(move || crate::hindsight_explore::bank_stats(&db, &bank))
        .await
        .map_err(|e| format!("hindsight_bank_stats join: {e}"))?
}

#[tauri::command]
pub async fn hindsight_memories_list(
    state: State<'_, AppState>,
    bank: String,
    query: Option<String>,
    fact_type: Option<String>,
    tags: Option<Vec<String>>,
    limit: Option<usize>,
    offset: Option<usize>,
) -> Result<HindsightMemoryPage, String> {
    let db = db_from(&state);
    tauri::async_runtime::spawn_blocking(move || {
        crate::hindsight_explore::memories_list_by_tags(
            &db,
            &bank,
            query.as_deref(),
            fact_type.as_deref(),
            tags.as_deref().unwrap_or(&[]),
            limit,
            offset,
        )
    })
    .await
    .map_err(|e| format!("hindsight_memories_list join: {e}"))?
}

#[tauri::command]
pub async fn hindsight_memory_retain(
    state: State<'_, AppState>,
    bank: String,
    content: String,
    context: Option<String>,
    tags: Option<Vec<String>>,
) -> Result<serde_json::Value, String> {
    let db = db_from(&state);
    tauri::async_runtime::spawn_blocking(move || {
        crate::hindsight_explore::memory_retain(
            &db,
            &bank,
            &content,
            context.as_deref(),
            tags.unwrap_or_default(),
        )
    })
    .await
    .map_err(|e| format!("hindsight_memory_retain join: {e}"))?
}

#[tauri::command]
pub async fn hindsight_memory_get(
    state: State<'_, AppState>,
    bank: String,
    memory_id: String,
) -> Result<HindsightMemoryDetail, String> {
    let db = db_from(&state);
    tauri::async_runtime::spawn_blocking(move || {
        crate::hindsight_explore::memory_get(&db, &bank, &memory_id)
    })
    .await
    .map_err(|e| format!("hindsight_memory_get join: {e}"))?
}

#[tauri::command]
pub async fn hindsight_memory_history(
    state: State<'_, AppState>,
    bank: String,
    memory_id: String,
) -> Result<Vec<HindsightMemoryHistoryEntry>, String> {
    let db = db_from(&state);
    tauri::async_runtime::spawn_blocking(move || {
        crate::hindsight_explore::memory_history(&db, &bank, &memory_id)
    })
    .await
    .map_err(|e| format!("hindsight_memory_history join: {e}"))?
}

#[tauri::command]
pub async fn hindsight_memory_update(
    state: State<'_, AppState>,
    bank: String,
    memory_id: String,
    text: Option<String>,
    context: Option<String>,
    fact_type: Option<String>,
) -> Result<HindsightMemoryDetail, String> {
    let db = db_from(&state);
    tauri::async_runtime::spawn_blocking(move || {
        crate::hindsight_explore::memory_update(
            &db,
            &bank,
            &memory_id,
            text.as_deref(),
            context.as_deref(),
            fact_type.as_deref(),
        )
    })
    .await
    .map_err(|e| format!("hindsight_memory_update join: {e}"))?
}

#[tauri::command]
pub async fn hindsight_memory_invalidate(
    state: State<'_, AppState>,
    bank: String,
    memory_id: String,
    reason: Option<String>,
) -> Result<HindsightMemoryDetail, String> {
    let db = db_from(&state);
    tauri::async_runtime::spawn_blocking(move || {
        crate::hindsight_explore::memory_invalidate(&db, &bank, &memory_id, reason.as_deref())
    })
    .await
    .map_err(|e| format!("hindsight_memory_invalidate join: {e}"))?
}

#[tauri::command]
pub async fn hindsight_memory_restore(
    state: State<'_, AppState>,
    bank: String,
    memory_id: String,
) -> Result<HindsightMemoryDetail, String> {
    let db = db_from(&state);
    tauri::async_runtime::spawn_blocking(move || {
        crate::hindsight_explore::memory_restore(&db, &bank, &memory_id)
    })
    .await
    .map_err(|e| format!("hindsight_memory_restore join: {e}"))?
}

#[tauri::command]
pub async fn hindsight_memories_clear(
    state: State<'_, AppState>,
    bank: String,
    fact_type: Option<String>,
) -> Result<serde_json::Value, String> {
    let db = db_from(&state);
    tauri::async_runtime::spawn_blocking(move || {
        crate::hindsight_explore::memories_clear(&db, &bank, fact_type.as_deref())
    })
    .await
    .map_err(|e| format!("hindsight_memories_clear join: {e}"))?
}

#[tauri::command]
pub async fn hindsight_document_delete(
    state: State<'_, AppState>,
    bank: String,
    document_id: String,
) -> Result<bool, String> {
    let db = db_from(&state);
    tauri::async_runtime::spawn_blocking(move || {
        crate::hindsight_explore::document_delete(&db, &bank, &document_id)
    })
    .await
    .map_err(|e| format!("hindsight_document_delete join: {e}"))?
}

#[tauri::command]
pub async fn hindsight_operation_cancel(
    state: State<'_, AppState>,
    bank: String,
    operation_id: String,
) -> Result<bool, String> {
    let db = db_from(&state);
    tauri::async_runtime::spawn_blocking(move || {
        crate::hindsight_explore::operation_cancel(&db, &bank, &operation_id)
    })
    .await
    .map_err(|e| format!("hindsight_operation_cancel join: {e}"))?
}

#[tauri::command]
pub async fn hindsight_operation_retry(
    state: State<'_, AppState>,
    bank: String,
    operation_id: String,
) -> Result<bool, String> {
    let db = db_from(&state);
    tauri::async_runtime::spawn_blocking(move || {
        crate::hindsight_explore::operation_retry(&db, &bank, &operation_id)
    })
    .await
    .map_err(|e| format!("hindsight_operation_retry join: {e}"))?
}

#[tauri::command]
pub async fn hindsight_tags_list(
    state: State<'_, AppState>,
    bank: String,
    query: Option<String>,
    limit: Option<usize>,
) -> Result<Vec<HindsightTag>, String> {
    let db = db_from(&state);
    tauri::async_runtime::spawn_blocking(move || {
        crate::hindsight_explore::tags_list(&db, &bank, query.as_deref(), limit)
    })
    .await
    .map_err(|e| format!("hindsight_tags_list join: {e}"))?
}

#[tauri::command]
pub async fn hindsight_documents_list(    state: State<'_, AppState>,
    bank: String,
    query: Option<String>,
    limit: Option<usize>,
    offset: Option<usize>,
) -> Result<HindsightDocumentPage, String> {
    let db = db_from(&state);
    tauri::async_runtime::spawn_blocking(move || {
        crate::hindsight_explore::documents_list(&db, &bank, query.as_deref(), limit, offset)
    })
    .await
    .map_err(|e| format!("hindsight_documents_list join: {e}"))?
}

#[tauri::command]
pub async fn hindsight_document_get(
    state: State<'_, AppState>,
    bank: String,
    document_id: String,
) -> Result<HindsightDocumentDetail, String> {
    let db = db_from(&state);
    tauri::async_runtime::spawn_blocking(move || {
        crate::hindsight_explore::document_get(&db, &bank, &document_id)
    })
    .await
    .map_err(|e| format!("hindsight_document_get join: {e}"))?
}

#[tauri::command]
pub async fn hindsight_entities_list(
    state: State<'_, AppState>,
    bank: String,
    limit: Option<usize>,
    offset: Option<usize>,
) -> Result<HindsightEntityPage, String> {
    let db = db_from(&state);
    tauri::async_runtime::spawn_blocking(move || {
        crate::hindsight_explore::entities_list(&db, &bank, limit, offset)
    })
    .await
    .map_err(|e| format!("hindsight_entities_list join: {e}"))?
}

#[tauri::command]
pub async fn hindsight_entity_get(
    state: State<'_, AppState>,
    bank: String,
    entity_id: String,
) -> Result<HindsightEntityDetail, String> {
    let db = db_from(&state);
    tauri::async_runtime::spawn_blocking(move || {
        crate::hindsight_explore::entity_get(&db, &bank, &entity_id)
    })
    .await
    .map_err(|e| format!("hindsight_entity_get join: {e}"))?
}

#[tauri::command]
pub async fn hindsight_graph(
    state: State<'_, AppState>,
    bank: String,
    limit: Option<usize>,
    query: Option<String>,
    fact_type: Option<String>,
) -> Result<HindsightGraphPayload, String> {
    let db = db_from(&state);
    tauri::async_runtime::spawn_blocking(move || {
        crate::hindsight_explore::graph_filtered(
            &db,
            &bank,
            limit,
            query.as_deref(),
            fact_type.as_deref(),
        )
    })
    .await
    .map_err(|e| format!("hindsight_graph join: {e}"))?
}

#[tauri::command]
pub async fn hindsight_mental_models(
    state: State<'_, AppState>,
    bank: String,
    limit: Option<usize>,
) -> Result<HindsightMentalModelPage, String> {
    let db = db_from(&state);
    tauri::async_runtime::spawn_blocking(move || {
        crate::hindsight_explore::mental_models(&db, &bank, limit)
    })
    .await
    .map_err(|e| format!("hindsight_mental_models join: {e}"))?
}

#[tauri::command]
pub async fn hindsight_mental_model_create(
    state: State<'_, AppState>,
    bank: String,
    name: String,
    source_query: String,
    custom_id: Option<String>,
    tags: Option<Vec<String>>,
) -> Result<HindsightMentalModel, String> {
    let db = db_from(&state);
    tauri::async_runtime::spawn_blocking(move || {
        crate::hindsight_explore::mental_model_create(
            &db,
            &bank,
            &name,
            &source_query,
            custom_id.as_deref(),
            tags.unwrap_or_default(),
        )
    })
    .await
    .map_err(|e| format!("hindsight_mental_model_create join: {e}"))?
}

#[tauri::command]
pub async fn hindsight_mental_model_refresh(
    state: State<'_, AppState>,
    bank: String,
    model_id: String,
) -> Result<serde_json::Value, String> {
    let db = db_from(&state);
    tauri::async_runtime::spawn_blocking(move || {
        crate::hindsight_explore::mental_model_refresh(&db, &bank, &model_id)
    })
    .await
    .map_err(|e| format!("hindsight_mental_model_refresh join: {e}"))?
}

#[tauri::command]
pub async fn hindsight_mental_model_delete(
    state: State<'_, AppState>,
    bank: String,
    model_id: String,
) -> Result<bool, String> {
    let db = db_from(&state);
    tauri::async_runtime::spawn_blocking(move || {
        crate::hindsight_explore::mental_model_delete(&db, &bank, &model_id)
    })
    .await
    .map_err(|e| format!("hindsight_mental_model_delete join: {e}"))?
}

#[tauri::command]
pub async fn hindsight_directives_list(
    state: State<'_, AppState>,
    bank: String,
) -> Result<Vec<HindsightDirective>, String> {
    let db = db_from(&state);
    tauri::async_runtime::spawn_blocking(move || {
        crate::hindsight_explore::directives_list(&db, &bank)
    })
    .await
    .map_err(|e| format!("hindsight_directives_list join: {e}"))?
}

#[tauri::command]
pub async fn hindsight_directive_create(
    state: State<'_, AppState>,
    bank: String,
    name: String,
    content: String,
    tags: Option<Vec<String>>,
) -> Result<HindsightDirective, String> {
    let db = db_from(&state);
    tauri::async_runtime::spawn_blocking(move || {
        crate::hindsight_explore::directive_create(
            &db,
            &bank,
            &name,
            &content,
            tags.unwrap_or_default(),
        )
    })
    .await
    .map_err(|e| format!("hindsight_directive_create join: {e}"))?
}

#[tauri::command]
pub async fn hindsight_directive_delete(
    state: State<'_, AppState>,
    bank: String,
    directive_id: String,
) -> Result<bool, String> {
    let db = db_from(&state);
    tauri::async_runtime::spawn_blocking(move || {
        crate::hindsight_explore::directive_delete(&db, &bank, &directive_id)
    })
    .await
    .map_err(|e| format!("hindsight_directive_delete join: {e}"))?
}

#[tauri::command]
pub async fn hindsight_operations_list(
    state: State<'_, AppState>,
    bank: String,
    limit: Option<usize>,
) -> Result<Vec<HindsightOperation>, String> {
    let db = db_from(&state);
    tauri::async_runtime::spawn_blocking(move || {
        crate::hindsight_explore::operations_list(&db, &bank, limit)
    })
    .await
    .map_err(|e| format!("hindsight_operations_list join: {e}"))?
}

#[tauri::command]
pub async fn hindsight_bank_consolidate(
    state: State<'_, AppState>,
    bank: String,
) -> Result<serde_json::Value, String> {
    let db = db_from(&state);
    tauri::async_runtime::spawn_blocking(move || {
        crate::hindsight_explore::bank_consolidate(&db, &bank)
    })
    .await
    .map_err(|e| format!("hindsight_bank_consolidate join: {e}"))?
}

#[tauri::command]
pub async fn hindsight_global_search(
    state: State<'_, AppState>,
    query: String,
    bank: Option<String>,
    fact_type: Option<String>,
    limit: Option<usize>,
) -> Result<Vec<HindsightGlobalSearchHit>, String> {
    let db = db_from(&state);
    tauri::async_runtime::spawn_blocking(move || {
        crate::hindsight_explore::global_search(
            &db,
            &query,
            bank.as_deref(),
            fact_type.as_deref(),
            limit,
        )
    })
    .await
    .map_err(|e| format!("hindsight_global_search join: {e}"))?
}

#[tauri::command]
pub async fn hindsight_galaxy_snapshot(
    state: State<'_, AppState>,
    bank_filter: Option<String>,
    limit_per_bank: Option<usize>,
) -> Result<HindsightGalaxySnapshot, String> {
    let db = db_from(&state);
    tauri::async_runtime::spawn_blocking(move || {
        crate::hindsight_explore::galaxy_snapshot(&db, bank_filter.as_deref(), limit_per_bank)
    })
    .await
    .map_err(|e| format!("hindsight_galaxy_snapshot join: {e}"))?
}

// ── LightRAG / RAGLight Knowledge Explorer ───────────────────────────────

#[tauri::command]
pub async fn knowledge_overview(
    state: State<'_, AppState>,
) -> Result<KnowledgeExplorerOverview, String> {
    let db = db_from(&state);
    let data_dir = state.data_dir.clone();
    let mgr = Arc::clone(&state.raglight);
    tauri::async_runtime::spawn_blocking(move || {
        crate::raglight::knowledge_overview(&db, &data_dir, &mgr)
    })
    .await
    .map_err(|e| format!("knowledge_overview join: {e}"))
}

#[tauri::command]
pub async fn knowledge_documents_list(
    state: State<'_, AppState>,
    query: Option<String>,
    limit: Option<usize>,
) -> Result<KnowledgeDocumentsResult, String> {
    let db = db_from(&state);
    tauri::async_runtime::spawn_blocking(move || {
        crate::raglight::knowledge_documents_list(&db, query.as_deref(), limit)
    })
    .await
    .map_err(|e| format!("knowledge_documents_list join: {e}"))
}

#[tauri::command]
pub async fn knowledge_document_get(
    state: State<'_, AppState>,
    doc_id: String,
) -> Result<KnowledgeDocumentDetail, String> {
    let db = db_from(&state);
    tauri::async_runtime::spawn_blocking(move || {
        crate::raglight::knowledge_document_get(&db, &doc_id)
    })
    .await
    .map_err(|e| format!("knowledge_document_get join: {e}"))?
}

#[tauri::command]
pub async fn knowledge_graph(
    state: State<'_, AppState>,
    label: Option<String>,
    query: Option<String>,
    limit: Option<usize>,
) -> Result<KnowledgeGraphPayload, String> {
    let db = db_from(&state);
    tauri::async_runtime::spawn_blocking(move || {
        crate::raglight::knowledge_graph(&db, label.as_deref(), query.as_deref(), limit)
    })
    .await
    .map_err(|e| format!("knowledge_graph join: {e}"))
}

#[tauri::command]
pub async fn knowledge_search(
    state: State<'_, AppState>,
    query: String,
    top_k: Option<usize>,
) -> Result<KnowledgeSearchResult, String> {
    let db = db_from(&state);
    tauri::async_runtime::spawn_blocking(move || {
        crate::raglight::knowledge_search(&db, &query, top_k.unwrap_or(10))
    })
    .await
    .map_err(|e| format!("knowledge_search join: {e}"))
}

// ── Multi-Session Conversations & Context Engine ─────────────────────────

#[tauri::command]
pub fn chat_sessions_list(
    state: State<'_, AppState>,
    query: Option<String>,
    status: Option<String>,
    date_from: Option<String>,
    date_to: Option<String>,
) -> Result<Vec<ChatSession>, String> {
    let db = db_from(&state);
    ChatService::new(&db)
        .list_sessions(
            query.as_deref(),
            status.as_deref(),
            date_from.as_deref(),
            date_to.as_deref(),
        )
        .map_err(|e| format!("chat_sessions_list: {e}"))
}

#[tauri::command]
pub fn chat_sessions_create(
    state: State<'_, AppState>,
    title: Option<String>,
) -> Result<ChatSession, String> {
    let db = db_from(&state);
    let ai_status = crate::ai::provider_status(&db);
    ChatService::new(&db)
        .create_session(
            title.as_deref(),
            Some(&ai_status.model),
            Some(&ai_status.active_provider),
        )
        .map_err(|e| format!("chat_sessions_create: {e}"))
}

#[tauri::command]
pub fn chat_sessions_get(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<Option<ChatSession>, String> {
    let db = db_from(&state);
    ChatService::new(&db)
        .get_session(&session_id)
        .map_err(|e| format!("chat_sessions_get: {e}"))
}

#[tauri::command]
pub fn chat_sessions_rename(
    state: State<'_, AppState>,
    session_id: String,
    title: String,
) -> Result<ChatSession, String> {
    let db = db_from(&state);
    ChatService::new(&db)
        .rename_session(&session_id, &title)
        .map_err(|e| format!("chat_sessions_rename: {e}"))
}

#[tauri::command]
pub fn chat_sessions_set_status(
    state: State<'_, AppState>,
    session_id: String,
    status: String,
) -> Result<ChatSession, String> {
    let db = db_from(&state);
    ChatService::new(&db)
        .set_session_status(&session_id, &status)
        .map_err(|e| format!("chat_sessions_set_status: {e}"))
}

#[tauri::command]
pub fn chat_sessions_delete(state: State<'_, AppState>, session_id: String) -> Result<(), String> {
    let db = db_from(&state);
    ChatService::new(&db)
        .delete_session(&session_id)
        .map_err(|e| format!("chat_sessions_delete: {e}"))
}

#[tauri::command]
pub fn context_engine_inspect(
    state: State<'_, AppState>,
    session_id: Option<String>,
) -> Result<ContextInspection, String> {
    let db = db_from(&state);
    ContextEngineService::new(&db)
        .inspect_session(session_id.as_deref())
        .map_err(|e| format!("context_engine_inspect: {e}"))
}

#[tauri::command]
pub fn context_engine_compress(
    state: State<'_, AppState>,
    session_id: Option<String>,
    reason: Option<String>,
) -> Result<ContextInspection, String> {
    let db = db_from(&state);
    ContextEngineService::new(&db)
        .compress_session_now(session_id.as_deref(), reason.as_deref())
        .map_err(|e| format!("context_engine_compress: {e}"))
}

// ── Autonomous Agent Architecture & Tool Policies ────────────────────────

#[tauri::command]
pub fn agents_overview(state: State<'_, AppState>) -> Result<AgentsOverview, String> {
    let db = db_from(&state);
    AgentOrchestratorService::new(&db)
        .overview()
        .map_err(|e| format!("agents_overview: {e}"))
}

#[tauri::command]
pub fn agents_set_tool_policy(
    state: State<'_, AppState>,
    tool_name: String,
    permission: String,
    enabled: bool,
) -> Result<AgentToolEntry, String> {
    let db = db_from(&state);
    AgentOrchestratorService::new(&db)
        .set_tool_policy(&tool_name, &permission, enabled)
        .map_err(|e| format!("agents_set_tool_policy: {e}"))
}

#[tauri::command]
pub fn agents_plan_preview(
    state: State<'_, AppState>,
    session_id: Option<String>,
    goal: String,
) -> Result<AgentRunRecord, String> {
    let db = db_from(&state);
    AgentOrchestratorService::new(&db)
        .plan_goal(session_id.as_deref(), &goal)
        .map_err(|e| format!("agents_plan_preview: {e}"))
}

#[tauri::command]
pub fn agents_bots_list(state: State<'_, AppState>) -> Result<Vec<AgentBotRecord>, String> {
    let db = db_from(&state);
    AgentOrchestratorService::new(&db)
        .list_bots()
        .map_err(|e| format!("agents_bots_list: {e}"))
}

#[tauri::command]
pub fn agents_bots_upsert(
    state: State<'_, AppState>,
    input: UpsertBotInput,
) -> Result<AgentBotRecord, String> {
    let db = db_from(&state);
    AgentOrchestratorService::new(&db)
        .upsert_bot(input)
        .map_err(|e| format!("agents_bots_upsert: {e}"))
}

#[tauri::command]
pub fn agents_bots_delete(state: State<'_, AppState>, bot_id: String) -> Result<(), String> {
    let db = db_from(&state);
    AgentOrchestratorService::new(&db)
        .delete_bot(&bot_id)
        .map_err(|e| format!("agents_bots_delete: {e}"))
}

#[tauri::command]
pub fn agents_skills_list(state: State<'_, AppState>) -> Result<Vec<AgentSkillRecord>, String> {
    let db = db_from(&state);
    AgentOrchestratorService::new(&db)
        .list_skills()
        .map_err(|e| format!("agents_skills_list: {e}"))
}

#[tauri::command]
pub fn agents_skills_install(
    state: State<'_, AppState>,
    input: InstallSkillInput,
) -> Result<AgentSkillRecord, String> {
    let db = db_from(&state);
    AgentOrchestratorService::new(&db)
        .install_skill(input)
        .map_err(|e| format!("agents_skills_install: {e}"))
}

#[tauri::command]
pub fn agents_skills_import_local(
    state: State<'_, AppState>,
) -> Result<Vec<AgentSkillRecord>, String> {
    let db = db_from(&state);
    AgentOrchestratorService::new(&db)
        .import_local_skills()
        .map_err(|e| format!("agents_skills_import_local: {e}"))
}

#[tauri::command]
pub fn agents_skills_toggle(
    state: State<'_, AppState>,
    skill_id: String,
    enabled: bool,
) -> Result<AgentSkillRecord, String> {
    let db = db_from(&state);
    AgentOrchestratorService::new(&db)
        .toggle_skill(&skill_id, enabled)
        .map_err(|e| format!("agents_skills_toggle: {e}"))
}

#[tauri::command]
pub fn agents_skills_delete(state: State<'_, AppState>, skill_id: String) -> Result<(), String> {
    let db = db_from(&state);
    AgentOrchestratorService::new(&db)
        .delete_skill(&skill_id)
        .map_err(|e| format!("agents_skills_delete: {e}"))
}

#[tauri::command]
pub fn agents_mcp_plugins_list(state: State<'_, AppState>) -> Result<Vec<McpPluginRecord>, String> {
    let db = db_from(&state);
    AgentOrchestratorService::new(&db)
        .list_mcp_plugins()
        .map_err(|e| format!("agents_mcp_plugins_list: {e}"))
}

#[tauri::command]
pub fn agents_mcp_plugins_upsert(
    state: State<'_, AppState>,
    input: UpsertMcpPluginInput,
) -> Result<McpPluginRecord, String> {
    let db = db_from(&state);
    AgentOrchestratorService::new(&db)
        .upsert_mcp_plugin(input)
        .map_err(|e| format!("agents_mcp_plugins_upsert: {e}"))
}

#[tauri::command]
pub fn agents_mcp_plugins_test(
    state: State<'_, AppState>,
    plugin_id: String,
) -> Result<McpPluginRecord, String> {
    let db = db_from(&state);
    AgentOrchestratorService::new(&db)
        .test_mcp_plugin(&plugin_id)
        .map_err(|e| format!("agents_mcp_plugins_test: {e}"))
}

#[tauri::command]
pub fn agents_mcp_plugins_delete(
    state: State<'_, AppState>,
    plugin_id: String,
) -> Result<(), String> {
    let db = db_from(&state);
    AgentOrchestratorService::new(&db)
        .delete_mcp_plugin(&plugin_id)
        .map_err(|e| format!("agents_mcp_plugins_delete: {e}"))
}
