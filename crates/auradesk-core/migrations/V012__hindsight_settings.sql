-- V012__hindsight_settings.sql
-- Hindsight memory engine settings and local SQLite episodic/semantic memory store
-- with explicit topic-key versioning/superseding for offline fallback and auditability.

INSERT OR IGNORE INTO settings (key, value) VALUES
  ('hindsight.enabled', 'true'),
  ('hindsight.base_url', '"http://127.0.0.1:8919"'),
  ('hindsight.default_bank', '"aura-main"'),
  ('hindsight.auto_create_banks', 'true'),
  ('hindsight.daily_maintenance', 'true'),
  ('hindsight.last_maintenance_date', '""');

CREATE TABLE IF NOT EXISTS local_memories (
  id TEXT PRIMARY KEY,
  bank TEXT NOT NULL DEFAULT 'aura-main',
  topic_key TEXT,
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'superseded', 'archived')),
  superseded_by TEXT,
  change_reason TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_local_memories_bank_status_topic
  ON local_memories (bank, status, topic_key);
