-- V003__block_screen_setting.sql
-- Seed the optional full-screen desktop blocking alert mode setting.

INSERT OR IGNORE INTO settings (key, value) VALUES
  ('reminders.block_screen', 'false');
