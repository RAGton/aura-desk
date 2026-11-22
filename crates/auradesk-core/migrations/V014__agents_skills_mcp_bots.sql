-- V014__agents_skills_mcp_bots.sql
-- Custom bots, installable SKILL.md skills, bot-skill bindings, and MCP server plugins.

CREATE TABLE IF NOT EXISTS agent_bots (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role_kind TEXT NOT NULL DEFAULT 'custom_bot',
  icon TEXT NOT NULL DEFAULT 'bot',
  description TEXT NOT NULL DEFAULT '',
  system_prompt TEXT NOT NULL DEFAULT '',
  preferred_provider TEXT,
  preferred_model TEXT,
  hindsight_bank TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  pinned_in_chat INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_skills (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  version TEXT NOT NULL DEFAULT '1.0.0',
  source_kind TEXT NOT NULL CHECK (source_kind IN ('builtin', 'local_dir', 'git_repo', 'catalog', 'antigravity_import', 'hermes_import')),
  source_uri TEXT NOT NULL,
  install_path TEXT NOT NULL,
  skill_markdown TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  installed_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_bot_skills (
  bot_id TEXT NOT NULL REFERENCES agent_bots(id) ON DELETE CASCADE,
  skill_id TEXT NOT NULL REFERENCES agent_skills(id) ON DELETE CASCADE,
  PRIMARY KEY (bot_id, skill_id)
);

CREATE TABLE IF NOT EXISTS mcp_plugins (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  transport TEXT NOT NULL CHECK (transport IN ('stdio', 'http_sse')),
  command_or_url TEXT NOT NULL,
  args_json TEXT NOT NULL DEFAULT '[]',
  env_vars_json TEXT NOT NULL DEFAULT '[]',
  enabled INTEGER NOT NULL DEFAULT 1,
  last_health_status TEXT NOT NULL DEFAULT 'unknown',
  last_health_checked_at TEXT,
  discovered_tools_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO agent_bots (
  id, slug, name, role_kind, icon, description, system_prompt,
  preferred_provider, preferred_model, hindsight_bank, enabled, pinned_in_chat, created_at, updated_at
) VALUES
  (
    'bot-aura-professora',
    'aura-professora',
    'Aura Professora & Lab Coach',
    'study_coach',
    'brain',
    'Especialista em estudos Fortinet NSE, laboratórios KVM/NixOS, Windows Server e repetição espaçada.',
    'Use terminologia oficial exata, explique distratores e proponha revisões espaçadas baseadas no banco estudos.',
    'auto',
    'gemini-2.5-pro',
    'estudos',
    1,
    1,
    datetime('now'),
    datetime('now')
  ),
  (
    'bot-rust-architect',
    'rust-clean-architect',
    'Arquiteto Rust & Clean Code',
    'code_reviewer',
    'cpu',
    'Revisor sênior focado em Rust, Tauri 2, SQLite WAL, segurança e arquitetura limpa.',
    'Analise código Rust/TypeScript cruzando ADRs, padrões de Clean Code e o banco engenharia.',
    'auto',
    'gpt-4.1',
    'engenharia',
    1,
    1,
    datetime('now'),
    datetime('now')
  );

INSERT OR IGNORE INTO agent_skills (
  id, slug, name, description, version, source_kind, source_uri, install_path, skill_markdown, enabled, installed_at, updated_at
) VALUES
  (
    'skill-hindsight-curator',
    'hindsight-memory-curator',
    'Hindsight Memory Curator',
    'Curadoria semântica, retenção estruturada e resolução de contradições em bancos Hindsight.',
    '1.2.0',
    'builtin',
    'builtin://skills/hindsight-memory-curator',
    '~/.auradesk/skills/hindsight-memory-curator/SKILL.md',
    '# Hindsight Memory Curator\n\nUse `memory.hindsight_recall` before answering and retain validated facts with topic keys.',
    1,
    datetime('now'),
    datetime('now')
  ),
  (
    'skill-nixos-flake-ops',
    'nixos-flake-ops',
    'NixOS & Flakes Operations',
    'Diagnóstico reprodutível de ambientes Nix Flakes, devShells, Podman rootless e builds Tauri.',
    '1.0.0',
    'catalog',
    'https://github.com/ragton/aura-skills/tree/main/nixos-flake-ops',
    '~/.auradesk/skills/nixos-flake-ops/SKILL.md',
    '# NixOS & Flakes Operations\n\nValidate `flake.nix`, `PKG_CONFIG_PATH`, and `nix develop` builds without polluting global state.',
    1,
    datetime('now'),
    datetime('now')
  );

INSERT OR IGNORE INTO agent_bot_skills (bot_id, skill_id) VALUES
  ('bot-aura-professora', 'skill-hindsight-curator'),
  ('bot-rust-architect', 'skill-hindsight-curator'),
  ('bot-rust-architect', 'skill-nixos-flake-ops');

INSERT OR IGNORE INTO mcp_plugins (
  id, slug, name, transport, command_or_url, args_json, env_vars_json,
  enabled, last_health_status, last_health_checked_at, discovered_tools_json, created_at, updated_at
) VALUES
  (
    'mcp-auradesk-builtin',
    'auradesk-core-mcp',
    'AuraDesk Core MCP (Stdio)',
    'stdio',
    'auradesk-mcp',
    '["--stdio"]',
    '[]',
    1,
    'healthy',
    datetime('now'),
    '["today_overview","list_tasks","propose_create_task","propose_create_reminder"]',
    datetime('now'),
    datetime('now')
  ),
  (
    'mcp-hindsight-local',
    'hindsight-memory-mcp',
    'Hindsight Memory Server',
    'http_sse',
    'http://127.0.0.1:8919/mcp',
    '[]',
    '[]',
    1,
    'healthy',
    datetime('now'),
    '["mcp.hindsight-memory-mcp.recall","mcp.hindsight-memory-mcp.retain","mcp.hindsight-memory-mcp.list_banks"]',
    datetime('now'),
    datetime('now')
  );
