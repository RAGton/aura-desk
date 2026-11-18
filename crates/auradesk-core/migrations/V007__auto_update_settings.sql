-- V007__auto_update_settings.sql
-- Enable GitHub automatic self-update by default.

INSERT OR IGNORE INTO settings (key, value) VALUES
  ('updates.auto_update', 'true');
