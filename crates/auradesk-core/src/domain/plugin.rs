//! Domain types for private plugins.

use serde::{Deserialize, Serialize};

/// Supported contract version.
pub const SUPPORTED_CONTRACT_VERSION: &str = "1.0";

/// Known permissions for plugins.
pub const PERM_READ_TICKETS: &str = "read_tickets";
pub const PERM_WRITE_TICKET_COMMENT: &str = "write_ticket_comment";
pub const PERM_READ_MESSAGES: &str = "read_messages";
pub const PERM_SEND_MESSAGE: &str = "send_message";
pub const PERM_READ_MAIL: &str = "read_mail";
pub const PERM_SEND_MAIL: &str = "send_mail";

/// Manifest parsed from `plugin.json`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PluginManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    #[serde(default = "default_contract_version")]
    pub contract_version: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub author: String,
    #[serde(default)]
    pub homepage: String,
    #[serde(default)]
    pub permissions: Vec<String>,
    #[serde(default)]
    pub capabilities: Vec<PluginCapabilityDesc>,
    #[serde(default)]
    pub settings_schema: Option<serde_json::Value>,
}

fn default_contract_version() -> String {
    SUPPORTED_CONTRACT_VERSION.to_string()
}

/// Description of a plugin capability/action.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PluginCapabilityDesc {
    pub name: String,
    pub description: String,
    #[serde(default)]
    pub required_permission: Option<String>,
    #[serde(default)]
    pub human_confirmation_required: bool,
}

/// Stored record of an installed plugin.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PluginRecord {
    pub id: String,
    pub name: String,
    pub version: String,
    pub contract_version: String,
    pub description: String,
    pub author: String,
    pub homepage: String,
    pub install_path: String,
    pub entrypoint: String,
    pub enabled: bool,
    pub installed_at: String,
    pub updated_at: String,
    pub permissions: Vec<PluginPermissionRecord>,
}

/// Permission state for a plugin.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PluginPermissionRecord {
    pub permission: String,
    pub granted: bool,
    pub granted_at: Option<String>,
}

/// Audit log entry for plugin actions.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PluginAuditEntry {
    pub id: String,
    pub plugin_id: String,
    pub action: String,
    pub resource: String,
    pub status: String,
    pub user_confirmed: bool,
    pub details_json: String,
    pub created_at: String,
}

/// Normalized event payload published to EventBus.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NormalizedPluginEvent {
    pub event_id: String,
    pub plugin_id: String,
    pub event_type: String,
    pub resource_id: String,
    pub title: String,
    pub summary: String,
    pub severity: String,
    pub timestamp: String,
    pub raw_data: serde_json::Value,
}
