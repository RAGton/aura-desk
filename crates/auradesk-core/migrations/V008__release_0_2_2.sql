-- V008__release_0_2_2.sql
-- Bump persisted app.version setting to 0.2.2.

INSERT OR REPLACE INTO settings (key, value) VALUES
  ('app.version', '"0.2.2"');
