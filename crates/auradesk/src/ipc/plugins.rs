//! Tauri IPC endpoints for private plugins, permissions, audit log, and events.

use std::path::PathBuf;
use std::sync::Arc;
use auradesk_core::application::plugins::{ExecutePluginActionInput, PluginManager};
use auradesk_core::domain::plugin::{
    NormalizedPluginEvent, PluginAuditEntry, PluginManifest, PluginRecord,
};
use auradesk_core::infrastructure::event_bus::{EventBus, EventDispatchResult};
use auradesk_core::infrastructure::secret_store::SecretStore;
use tauri::{AppHandle, Emitter, State};

use crate::runtime::AppState;

/// In-memory singleton stores for plugins runtime in Tauri app.
pub struct PluginRuntimeState {
    pub secret_store: Arc<SecretStore>,
    pub event_bus: Arc<EventBus>,
}

impl Default for PluginRuntimeState {
    fn default() -> Self {
        Self {
            secret_store: Arc::new(SecretStore::default()),
            event_bus: Arc::new(EventBus::default()),
        }
    }
}

fn get_manager<'a>(
    app_state: &'a AppState,
    runtime: &'a PluginRuntimeState,
) -> PluginManager<'a> {
    let plugins_dir = app_state.data_dir.join("plugins");
    PluginManager::new(
        &app_state.db,
        &runtime.secret_store,
        &runtime.event_bus,
        plugins_dir,
    )
}

/// List all installed private plugins.
#[tauri::command]
pub fn plugins_list(
    state: State<'_, AppState>,
    runtime: State<'_, PluginRuntimeState>,
) -> Result<Vec<PluginRecord>, String> {
    let mgr = get_manager(&state, &runtime);
    mgr.list_plugins().map_err(|e| format!("plugins_list: {e}"))
}

/// Discover local plugins available in the plugins directory.
#[tauri::command]
pub fn plugins_discover(
    state: State<'_, AppState>,
    runtime: State<'_, PluginRuntimeState>,
) -> Result<Vec<PluginManifest>, String> {
    let mgr = get_manager(&state, &runtime);
    mgr.discover_local_plugins().map_err(|e| format!("plugins_discover: {e}"))
}

/// Install a plugin from a local directory path.
#[tauri::command]
pub fn plugins_install(
    path: String,
    state: State<'_, AppState>,
    runtime: State<'_, PluginRuntimeState>,
    app: AppHandle,
) -> Result<PluginRecord, String> {
    let mgr = get_manager(&state, &runtime);
    let record = mgr.install_plugin(&PathBuf::from(path)).map_err(|e| format!("plugins_install: {e}"))?;
    let _ = app.emit("auradesk://plugins-updated", ());
    Ok(record)
}

/// Enable or disable a plugin.
#[tauri::command]
pub fn plugins_set_enabled(
    plugin_id: String,
    enabled: bool,
    state: State<'_, AppState>,
    runtime: State<'_, PluginRuntimeState>,
    app: AppHandle,
) -> Result<(), String> {
    let mgr = get_manager(&state, &runtime);
    mgr.set_enabled(&plugin_id, enabled).map_err(|e| format!("plugins_set_enabled: {e}"))?;
    let _ = app.emit("auradesk://plugins-updated", ());
    Ok(())
}

/// Grant or revoke a permission.
#[tauri::command]
pub fn plugins_set_permission(
    plugin_id: String,
    permission: String,
    granted: bool,
    state: State<'_, AppState>,
    runtime: State<'_, PluginRuntimeState>,
    app: AppHandle,
) -> Result<(), String> {
    let mgr = get_manager(&state, &runtime);
    mgr.set_permission(&plugin_id, &permission, granted).map_err(|e| format!("plugins_set_permission: {e}"))?;
    let _ = app.emit("auradesk://plugins-updated", ());
    Ok(())
}

/// Store a secret credential in the OS SecretStore (never SQLite).
#[tauri::command]
pub fn plugins_set_secret(
    plugin_id: String,
    secret_key: String,
    secret_value: String,
    state: State<'_, AppState>,
    runtime: State<'_, PluginRuntimeState>,
) -> Result<(), String> {
    let mgr = get_manager(&state, &runtime);
    mgr.set_plugin_secret(&plugin_id, &secret_key, &secret_value)
        .map_err(|e| format!("plugins_set_secret: {e}"))
}

/// Check if a secret exists without returning it.
#[tauri::command]
pub fn plugins_has_secret(
    plugin_id: String,
    secret_key: String,
    state: State<'_, AppState>,
    runtime: State<'_, PluginRuntimeState>,
) -> Result<bool, String> {
    let mgr = get_manager(&state, &runtime);
    mgr.has_plugin_secret(&plugin_id, &secret_key)
        .map_err(|e| format!("plugins_has_secret: {e}"))
}

/// Execute an action exposed by a plugin.
#[tauri::command]
pub fn plugins_execute_action(
    input: ExecutePluginActionInput,
    state: State<'_, AppState>,
    runtime: State<'_, PluginRuntimeState>,
) -> Result<serde_json::Value, String> {
    let mgr = get_manager(&state, &runtime);
    mgr.execute_action(input).map_err(|e| format!("plugins_execute_action: {e}"))
}

/// Ingest an event from a plugin, deduplicate it, and broadcast to Tauri frontend.
#[tauri::command]
pub fn plugins_ingest_event(
    event: NormalizedPluginEvent,
    state: State<'_, AppState>,
    runtime: State<'_, PluginRuntimeState>,
    app: AppHandle,
) -> Result<EventDispatchResult, String> {
    let mgr = get_manager(&state, &runtime);
    let res = mgr.ingest_event(event).map_err(|e| format!("plugins_ingest_event: {e}"))?;
    if let EventDispatchResult::Accepted(ref ev) = res {
        let _ = app.emit("auradesk://plugin-event", ev);
    }
    Ok(res)
}

/// List recent audit log entries.
#[tauri::command]
pub fn plugins_audit_log(
    plugin_id: Option<String>,
    limit: Option<usize>,
    state: State<'_, AppState>,
    runtime: State<'_, PluginRuntimeState>,
) -> Result<Vec<PluginAuditEntry>, String> {
    let mgr = get_manager(&state, &runtime);
    mgr.list_audit_log(plugin_id.as_deref(), limit.unwrap_or(50))
        .map_err(|e| format!("plugins_audit_log: {e}"))
}

/// List recent events from EventBus.
#[tauri::command]
pub fn plugins_recent_events(
    limit: Option<usize>,
    runtime: State<'_, PluginRuntimeState>,
) -> Result<Vec<NormalizedPluginEvent>, String> {
    Ok(runtime.event_bus.list_recent(limit.unwrap_or(50)))
}

/// Uninstall a plugin.
#[tauri::command]
pub fn plugins_uninstall(
    plugin_id: String,
    state: State<'_, AppState>,
    runtime: State<'_, PluginRuntimeState>,
    app: AppHandle,
) -> Result<(), String> {
    let mgr = get_manager(&state, &runtime);
    mgr.uninstall_plugin(&plugin_id).map_err(|e| format!("plugins_uninstall: {e}"))?;
    let _ = app.emit("auradesk://plugins-updated", ());
    Ok(())
}
