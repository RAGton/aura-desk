-- V005__release_0_2_0.sql
-- Bump persisted app.version setting to 0.2.0 for MVP release.

INSERT OR REPLACE INTO settings (key, value) VALUES
  ('app.version', '"0.2.0"');
