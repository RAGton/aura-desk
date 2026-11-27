//! Application service for managing private plugins, permissions, audit logging and settings.

use std::path::{Path, PathBuf};
use chrono::Utc;
use rusqlite::params;
use uuid::Uuid;

use crate::domain::plugin::{
    NormalizedPluginEvent, PluginAuditEntry, PluginManifest,
    PluginPermissionRecord, PluginRecord, SUPPORTED_CONTRACT_VERSION,
};
use crate::infrastructure::db::{Db, DbError};
use crate::infrastructure::event_bus::{EventBus, EventDispatchResult};
use crate::infrastructure::secret_store::SecretStore;
use crate::CoreError;

/// Input for executing an action through a plugin.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ExecutePluginActionInput {
    pub plugin_id: String,
    pub action: String,
    pub params: serde_json::Value,
    #[serde(default)]
    pub confirmed_by_user: bool,
}

/// Service managing plugins.
pub struct PluginManager<'a> {
    db: &'a Db,
    secret_store: &'a SecretStore,
    event_bus: &'a EventBus,
    plugins_dir: PathBuf,
}

impl<'a> PluginManager<'a> {
    /// Create a new PluginManager.
    pub fn new(
        db: &'a Db,
        secret_store: &'a SecretStore,
        event_bus: &'a EventBus,
        plugins_dir: impl Into<PathBuf>,
    ) -> Self {
        Self {
            db,
            secret_store,
            event_bus,
            plugins_dir: plugins_dir.into(),
        }
    }

    /// Default plugins directory path: `~/.local/share/com.ragton.auradesk/plugins`
    pub fn default_plugins_dir() -> PathBuf {
        let base = std::env::var("XDG_DATA_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|_| {
                let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
                PathBuf::from(home).join(".local/share")
            });
        base.join("com.ragton.auradesk").join("plugins")
    }

    /// Read and validate a `plugin.json` manifest from a directory.
    pub fn read_manifest(dir: &Path) -> Result<PluginManifest, CoreError> {
        let manifest_path = dir.join("plugin.json");
        if !manifest_path.exists() {
            return Err(CoreError::validation(
                "plugin.json",
                format!("manifest not found at {}", manifest_path.display()),
            ));
        }

        let content = std::fs::read_to_string(&manifest_path).map_err(|e| {
            CoreError::internal(format!("failed to read plugin.json: {e}"))
        })?;

        let manifest: PluginManifest = serde_json::from_str(&content).map_err(|e| {
            CoreError::validation("plugin.json", format!("invalid plugin.json: {e}"))
        })?;

        if manifest.contract_version != SUPPORTED_CONTRACT_VERSION {
            return Err(CoreError::validation(
                "contract_version",
                format!(
                    "unsupported contract version '{}', expected '{}'",
                    manifest.contract_version, SUPPORTED_CONTRACT_VERSION
                ),
            ));
        }

        Ok(manifest)
    }

    /// Scan `plugins_dir` and discover available plugins.
    pub fn discover_local_plugins(&self) -> Result<Vec<PluginManifest>, CoreError> {
        let mut list = Vec::new();
        if !self.plugins_dir.exists() {
            return Ok(list);
        }

        let entries = std::fs::read_dir(&self.plugins_dir).map_err(|e| {
            CoreError::internal(format!("failed to read plugins dir: {e}"))
        })?;

        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                if let Ok(manifest) = Self::read_manifest(&path) {
                    list.push(manifest);
                }
            }
        }

        Ok(list)
    }

    /// Install or register a plugin from a local directory path.
    pub fn install_plugin(&self, plugin_dir: &Path) -> Result<PluginRecord, CoreError> {
        let manifest = Self::read_manifest(plugin_dir)?;
        let now = Utc::now().to_rfc3339();

        let mut conn = self.db.writer();
        let tx = conn.transaction().map_err(DbError::from)?;

        let install_path_str = plugin_dir.to_string_lossy().to_string();

        tx.execute(
            "INSERT INTO plugins (id, name, version, contract_version, description, author, homepage, install_path, entrypoint, enabled, installed_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'plugin.json', 0, ?9, ?9)
             ON CONFLICT(id) DO UPDATE SET
               name = excluded.name,
               version = excluded.version,
               contract_version = excluded.contract_version,
               description = excluded.description,
               author = excluded.author,
               homepage = excluded.homepage,
               install_path = excluded.install_path,
               updated_at = excluded.updated_at",
            params![
                manifest.id,
                manifest.name,
                manifest.version,
                manifest.contract_version,
                manifest.description,
                manifest.author,
                manifest.homepage,
                install_path_str,
                now,
            ],
        )
        .map_err(DbError::from)?;

        // Seed declared permissions as ungranted by default
        for perm in &manifest.permissions {
            tx.execute(
                "INSERT OR IGNORE INTO plugin_permissions (plugin_id, permission, granted, granted_at)
                 VALUES (?1, ?2, 0, NULL)",
                params![manifest.id, perm],
            )
            .map_err(DbError::from)?;
        }

        tx.commit().map_err(DbError::from)?;
        drop(conn);

        self.record_audit_log(
            &manifest.id,
            "install",
            &install_path_str,
            "success",
            true,
            serde_json::json!({ "version": manifest.version }),
        )?;

        self.get_plugin(&manifest.id)
    }

    /// List all installed plugins.
    pub fn list_plugins(&self) -> Result<Vec<PluginRecord>, CoreError> {
        let conn = self.db.reader();

        let mut stmt = conn
            .prepare(
                "SELECT id, name, version, contract_version, description, author, homepage, install_path, entrypoint, enabled, installed_at, updated_at
                 FROM plugins ORDER BY name ASC",
            )
            .map_err(DbError::from)?;

        let rows = stmt
            .query_map([], |row| {
                Ok(PluginRecord {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    version: row.get(2)?,
                    contract_version: row.get(3)?,
                    description: row.get(4)?,
                    author: row.get(5)?,
                    homepage: row.get(6)?,
                    install_path: row.get(7)?,
                    entrypoint: row.get(8)?,
                    enabled: row.get::<_, i64>(9)? != 0,
                    installed_at: row.get(10)?,
                    updated_at: row.get(11)?,
                    permissions: Vec::new(),
                })
            })
            .map_err(DbError::from)?;

        let mut plugins = Vec::new();
        for r in rows {
            let mut p = r.map_err(DbError::from)?;
            p.permissions = self.get_permissions_for(&conn, &p.id)?;
            plugins.push(p);
        }

        Ok(plugins)
    }

    /// Get a single plugin by id.
    pub fn get_plugin(&self, plugin_id: &str) -> Result<PluginRecord, CoreError> {
        let conn = self.db.reader();

        let mut p = conn
            .query_row(
                "SELECT id, name, version, contract_version, description, author, homepage, install_path, entrypoint, enabled, installed_at, updated_at
                 FROM plugins WHERE id = ?1",
                params![plugin_id],
                |row| {
                    Ok(PluginRecord {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        version: row.get(2)?,
                        contract_version: row.get(3)?,
                        description: row.get(4)?,
                        author: row.get(5)?,
                        homepage: row.get(6)?,
                        install_path: row.get(7)?,
                        entrypoint: row.get(8)?,
                        enabled: row.get::<_, i64>(9)? != 0,
                        installed_at: row.get(10)?,
                        updated_at: row.get(11)?,
                        permissions: Vec::new(),
                    })
                },
            )
            .map_err(DbError::from)?;

        p.permissions = self.get_permissions_for(&conn, plugin_id)?;
        Ok(p)
    }

    fn get_permissions_for(
        &self,
        conn: &rusqlite::Connection,
        plugin_id: &str,
    ) -> Result<Vec<PluginPermissionRecord>, CoreError> {
        let mut stmt = conn
            .prepare(
                "SELECT permission, granted, granted_at FROM plugin_permissions WHERE plugin_id = ?1 ORDER BY permission ASC",
            )
            .map_err(DbError::from)?;

        let rows = stmt
            .query_map(params![plugin_id], |row| {
                Ok(PluginPermissionRecord {
                    permission: row.get(0)?,
                    granted: row.get::<_, i64>(1)? != 0,
                    granted_at: row.get(2)?,
                })
            })
            .map_err(DbError::from)?;

        let mut perms = Vec::new();
        for r in rows {
            perms.push(r.map_err(DbError::from)?);
        }
        Ok(perms)
    }

    /// Enable or disable a plugin.
    /// Disabling revokes credentials from the SecretStore immediately for privacy.
    pub fn set_enabled(&self, plugin_id: &str, enabled: bool) -> Result<(), CoreError> {
        let conn = self.db.writer();

        let now = Utc::now().to_rfc3339();
        let rows = conn
            .execute(
                "UPDATE plugins SET enabled = ?1, updated_at = ?2 WHERE id = ?3",
                params![if enabled { 1 } else { 0 }, now, plugin_id],
            )
            .map_err(DbError::from)?;

        if rows == 0 {
            return Err(CoreError::not_found("plugin", plugin_id));
        }

        if !enabled {
            // Disabling revokes local credentials immediately
            let _ = self.secret_store.delete_secret(&format!("{plugin_id}:token"));
            let _ = self.secret_store.delete_secret(&format!("{plugin_id}:credentials"));
        }

        drop(conn);

        self.record_audit_log(
            plugin_id,
            if enabled { "enable" } else { "disable" },
            plugin_id,
            "success",
            true,
            serde_json::json!({ "enabled": enabled }),
        )?;

        Ok(())
    }

    /// Grant or revoke a permission for a plugin.
    pub fn set_permission(
        &self,
        plugin_id: &str,
        permission: &str,
        granted: bool,
    ) -> Result<(), CoreError> {
        let conn = self.db.writer();

        let now = Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO plugin_permissions (plugin_id, permission, granted, granted_at)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(plugin_id, permission) DO UPDATE SET
               granted = excluded.granted,
               granted_at = excluded.granted_at",
            params![
                plugin_id,
                permission,
                if granted { 1 } else { 0 },
                if granted { Some(now) } else { None }
            ],
        )
        .map_err(DbError::from)?;

        drop(conn);

        self.record_audit_log(
            plugin_id,
            if granted { "grant_permission" } else { "revoke_permission" },
            permission,
            "success",
            true,
            serde_json::json!({ "permission": permission, "granted": granted }),
        )?;

        Ok(())
    }

    /// Check if a plugin is enabled and has the granted permission.
    pub fn check_permission(&self, plugin_id: &str, permission: &str) -> Result<bool, CoreError> {
        let plugin = self.get_plugin(plugin_id)?;
        if !plugin.enabled {
            return Ok(false);
        }
        let conn = self.db.reader();

        let mut stmt = conn
            .prepare("SELECT granted FROM plugin_permissions WHERE plugin_id = ?1 AND permission = ?2")
            .map_err(DbError::from)?;

        let mut rows = stmt
            .query(params![plugin_id, permission])
            .map_err(DbError::from)?;

        if let Some(row) = rows.next().map_err(DbError::from)? {
            let granted: i64 = row.get(0).map_err(DbError::from)?;
            Ok(granted != 0)
        } else {
            Ok(false)
        }
    }

    /// Execute an action exposed by a plugin, ensuring permission and human confirmation if needed.
    pub fn execute_action(
        &self,
        input: ExecutePluginActionInput,
    ) -> Result<serde_json::Value, CoreError> {
        let plugin = self.get_plugin(&input.plugin_id)?;
        if !plugin.enabled {
            self.record_audit_log(
                &input.plugin_id,
                &input.action,
                &input.action,
                "denied_plugin_disabled",
                input.confirmed_by_user,
                serde_json::json!({ "error": "Plugin is disabled" }),
            )?;
            return Err(CoreError::validation(
                "plugin",
                format!("plugin '{}' is disabled", input.plugin_id),
            ));
        }

        let manifest = Self::read_manifest(Path::new(&plugin.install_path))?;
        let cap = manifest
            .capabilities
            .iter()
            .find(|c| c.name == input.action)
            .ok_or_else(|| {
                CoreError::validation(
                    "action",
                    format!(
                        "action '{}' not declared by plugin '{}'",
                        input.action, input.plugin_id
                    ),
                )
            })?;

        // Verify permission if required
        if let Some(req_perm) = &cap.required_permission {
            if !self.check_permission(&input.plugin_id, req_perm)? {
                self.record_audit_log(
                    &input.plugin_id,
                    &input.action,
                    req_perm,
                    "denied_missing_permission",
                    input.confirmed_by_user,
                    serde_json::json!({ "missing_permission": req_perm }),
                )?;
                return Err(CoreError::validation(
                    "permission",
                    format!(
                        "permission '{}' not granted to plugin '{}'",
                        req_perm, input.plugin_id
                    ),
                ));
            }
        }

        // Verify human confirmation for writing actions if required
        if cap.human_confirmation_required && !input.confirmed_by_user {
            self.record_audit_log(
                &input.plugin_id,
                &input.action,
                &input.action,
                "denied_human_confirmation_required",
                false,
                serde_json::json!({ "required": true }),
            )?;
            return Err(CoreError::validation(
                "confirmation",
                format!(
                    "action '{}' requires explicit human confirmation",
                    input.action
                ),
            ));
        }

        // For demo-ops or standard mock handlers, return simulated success
        let result = serde_json::json!({
            "status": "success",
            "plugin_id": input.plugin_id,
            "action": input.action,
            "executed_at": Utc::now().to_rfc3339(),
            "echo_params": input.params,
        });

        self.record_audit_log(
            &input.plugin_id,
            &input.action,
            &input.action,
            "success",
            input.confirmed_by_user,
            serde_json::json!({ "result": result }),
        )?;

        Ok(result)
    }

    /// Ingest a normalized event from a plugin, verifying the plugin is enabled and publishing to EventBus.
    pub fn ingest_event(&self, event: NormalizedPluginEvent) -> Result<EventDispatchResult, CoreError> {
        let plugin = self.get_plugin(&event.plugin_id)?;
        if !plugin.enabled {
            return Err(CoreError::validation(
                "plugin",
                format!("cannot ingest event: plugin '{}' is disabled", event.plugin_id),
            ));
        }

        let res = self.event_bus.publish(event);
        Ok(res)
    }

    /// Record an entry in `plugin_audit_log`.
    pub fn record_audit_log(
        &self,
        plugin_id: &str,
        action: &str,
        resource: &str,
        status: &str,
        user_confirmed: bool,
        details: serde_json::Value,
    ) -> Result<(), CoreError> {
        let conn = self.db.writer();

        let id = Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();
        let details_str = serde_json::to_string(&details).unwrap_or_else(|_| "{}".into());

        conn.execute(
            "INSERT INTO plugin_audit_log (id, plugin_id, action, resource, status, user_confirmed, details_json, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                id,
                plugin_id,
                action,
                resource,
                status,
                if user_confirmed { 1 } else { 0 },
                details_str,
                now,
            ],
        )
        .map_err(DbError::from)?;

        Ok(())
    }

    /// List audit log entries with an optional plugin filter.
    pub fn list_audit_log(
        &self,
        plugin_id: Option<&str>,
        limit: usize,
    ) -> Result<Vec<PluginAuditEntry>, CoreError> {
        let conn = self.db.reader();

        let (sql, params_vec): (String, Vec<rusqlite::types::Value>) = match plugin_id {
            Some(pid) => (
                "SELECT id, plugin_id, action, resource, status, user_confirmed, details_json, created_at
                 FROM plugin_audit_log WHERE plugin_id = ?1 ORDER BY created_at DESC LIMIT ?2".to_string(),
                vec![pid.to_string().into(), (limit as i64).into()],
            ),
            None => (
                "SELECT id, plugin_id, action, resource, status, user_confirmed, details_json, created_at
                 FROM plugin_audit_log ORDER BY created_at DESC LIMIT ?1".to_string(),
                vec![(limit as i64).into()],
            ),
        };

        let mut stmt = conn.prepare(&sql).map_err(DbError::from)?;
        let rows = stmt
            .query_map(rusqlite::params_from_iter(params_vec), |row| {
                Ok(PluginAuditEntry {
                    id: row.get(0)?,
                    plugin_id: row.get(1)?,
                    action: row.get(2)?,
                    resource: row.get(3)?,
                    status: row.get(4)?,
                    user_confirmed: row.get::<_, i64>(5)? != 0,
                    details_json: row.get(6)?,
                    created_at: row.get(7)?,
                })
            })
            .map_err(DbError::from)?;

        let mut entries = Vec::new();
        for r in rows {
            entries.push(r.map_err(DbError::from)?);
        }
        Ok(entries)
    }

    /// Set a secret token/credential for a plugin in the SecretStore (never SQLite).
    pub fn set_plugin_secret(&self, plugin_id: &str, secret_key: &str, secret_value: &str) -> Result<(), CoreError> {
        self.secret_store.set_secret(&format!("{plugin_id}:{secret_key}"), secret_value)
    }

    /// Check if a secret exists for a plugin without revealing it.
    pub fn has_plugin_secret(&self, plugin_id: &str, secret_key: &str) -> Result<bool, CoreError> {
        let sec = self.secret_store.get_secret(&format!("{plugin_id}:{secret_key}"))?;
        Ok(sec.is_some())
    }

    /// Uninstall a plugin, revoking credentials and removing records.
    pub fn uninstall_plugin(&self, plugin_id: &str) -> Result<(), CoreError> {
        // 1. Revoke secrets immediately
        let _ = self.secret_store.delete_secret(&format!("{plugin_id}:token"));
        let _ = self.secret_store.delete_secret(&format!("{plugin_id}:credentials"));

        // 2. Remove DB records (CASCADE handles permissions and settings)
        let conn = self.db.writer();

        conn.execute("DELETE FROM plugins WHERE id = ?1", params![plugin_id])
            .map_err(DbError::from)?;
        drop(conn);

        self.record_audit_log(
            plugin_id,
            "uninstall",
            plugin_id,
            "success",
            true,
            serde_json::json!({ "uninstalled": true }),
        )?;

        Ok(())
    }
}
