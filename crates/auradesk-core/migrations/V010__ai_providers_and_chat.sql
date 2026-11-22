-- V010__ai_providers_and_chat.sql
-- Multi-provider AI configuration (OpenAI/Codex, MiniMax, Ollama, OpenRouter, CLIs)
-- and persistent conversational chat history for Aura.

INSERT OR IGNORE INTO settings (key, value) VALUES
  ('ai.provider', '"auto"'),
  ('ai.base_url', '""'),
  ('ai.model', '""'),
  ('ai.api_key', '""'),
  ('ai.system_prompt', '""');

CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL DEFAULT 'default',
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  provider TEXT,
  model TEXT,
  area_id TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_session_created
  ON chat_messages (session_id, created_at);
