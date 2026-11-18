-- V004__desktop_settings.sql
-- Seed desktop autostart and compact-mode settings (Phase 3).

INSERT OR IGNORE INTO settings (key, value) VALUES
  ('app.autostart', 'false'),
  ('desktop.compact_mode', 'false');
