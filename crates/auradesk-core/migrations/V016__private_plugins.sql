-- V016__private_plugins.sql
-- Private plugins foundation: registry, permissions, settings, and audit log.
-- Note: Secrets/tokens MUST NOT be stored in SQLite. They reside in OS SecretStore.

CREATE TABLE IF NOT EXISTS plugins (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  contract_version TEXT NOT NULL DEFAULT '1.0',
  description TEXT NOT NULL DEFAULT '',
  author TEXT NOT NULL DEFAULT '',
  homepage TEXT NOT NULL DEFAULT '',
  install_path TEXT NOT NULL,
  entrypoint TEXT NOT NULL DEFAULT 'plugin.json',
  enabled INTEGER NOT NULL DEFAULT 0,
  installed_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS plugin_permissions (
  plugin_id TEXT NOT NULL REFERENCES plugins(id) ON DELETE CASCADE,
  permission TEXT NOT NULL,
  granted INTEGER NOT NULL DEFAULT 0,
  granted_at TEXT,
  PRIMARY KEY (plugin_id, permission)
);

CREATE TABLE IF NOT EXISTS plugin_settings (
  plugin_id TEXT NOT NULL REFERENCES plugins(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (plugin_id, key)
);

CREATE TABLE IF NOT EXISTS plugin_audit_log (
  id TEXT PRIMARY KEY,
  plugin_id TEXT NOT NULL,
  action TEXT NOT NULL,
  resource TEXT NOT NULL,
  status TEXT NOT NULL,
  user_confirmed INTEGER NOT NULL DEFAULT 0,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_plugin_audit_log_plugin_id ON plugin_audit_log(plugin_id);
CREATE INDEX IF NOT EXISTS idx_plugin_audit_log_created_at ON plugin_audit_log(created_at);
