-- V013__sessions_context_agents.sql
-- Multi-session conversations, autonomous 7-layer Context Engine telemetry/events,
-- and specialized autonomous agent tool policies & run logs.

CREATE TABLE IF NOT EXISTS chat_sessions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  semantic_summary TEXT NOT NULL DEFAULT '',
  context_state TEXT NOT NULL DEFAULT 'healthy' CHECK (context_state IN ('healthy', 'approaching_limit', 'compressed')),
  compression_state TEXT NOT NULL DEFAULT 'none' CHECK (compression_state IN ('none', 'compressed')),
  compression_count INTEGER NOT NULL DEFAULT 0,
  estimated_tokens INTEGER NOT NULL DEFAULT 0,
  token_budget INTEGER NOT NULL DEFAULT 8192,
  model TEXT,
  provider TEXT,
  associated_memories_json TEXT NOT NULL DEFAULT '[]',
  tools_used_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_activity_at TEXT NOT NULL
);

INSERT OR IGNORE INTO chat_sessions (
  id,
  title,
  status,
  semantic_summary,
  context_state,
  compression_state,
  compression_count,
  estimated_tokens,
  token_budget,
  associated_memories_json,
  tools_used_json,
  created_at,
  updated_at,
  last_activity_at
) VALUES (
  'default',
  'Aura Main Session',
  'active',
  '',
  'healthy',
  'none',
  0,
  0,
  8192,
  '[]',
  '[]',
  datetime('now'),
  datetime('now'),
  datetime('now')
);

CREATE INDEX IF NOT EXISTS idx_chat_sessions_status_activity
  ON chat_sessions (status, last_activity_at DESC);

CREATE TABLE IF NOT EXISTS context_events (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('compression', 'memory_retrieval', 'context_snapshot')),
  reason TEXT NOT NULL,
  tokens_before INTEGER NOT NULL DEFAULT 0,
  tokens_after INTEGER NOT NULL DEFAULT 0,
  messages_compressed INTEGER NOT NULL DEFAULT 0,
  preserved_message_ids_json TEXT NOT NULL DEFAULT '[]',
  retrieved_memory_ids_json TEXT NOT NULL DEFAULT '[]',
  layers_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_context_events_session_created
  ON context_events (session_id, created_at DESC);

CREATE TABLE IF NOT EXISTS agent_tool_policies (
  tool_name TEXT PRIMARY KEY,
  agent_role TEXT NOT NULL,
  permission TEXT NOT NULL CHECK (permission IN ('allow', 'require_approval', 'deny')),
  risk_level TEXT NOT NULL CHECK (risk_level IN ('read', 'write', 'privileged', 'destructive')),
  enabled INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  agent_role TEXT NOT NULL,
  goal TEXT NOT NULL,
  plan_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL CHECK (status IN ('planned', 'awaiting_approval', 'running', 'completed', 'blocked', 'failed')),
  result_summary TEXT,
  tool_calls_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_runs_created
  ON agent_runs (created_at DESC);
