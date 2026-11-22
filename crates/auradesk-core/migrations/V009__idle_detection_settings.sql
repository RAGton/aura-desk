-- V009__idle_detection_settings.sql
-- Desktop OS inactivity detection settings for Pomodoro auto-pause and routine suppression.

INSERT OR IGNORE INTO settings (key, value) VALUES
  ('desktop.idle_threshold_min', '5'),
  ('desktop.idle_auto_pause_pomodoro', 'true'),
  ('desktop.idle_suppress_routines', 'true');
