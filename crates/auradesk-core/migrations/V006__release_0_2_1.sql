-- V006__release_0_2_1.sql
-- Bump persisted app.version setting to 0.2.1.

INSERT OR REPLACE INTO settings (key, value) VALUES
  ('app.version', '"0.2.1"');
