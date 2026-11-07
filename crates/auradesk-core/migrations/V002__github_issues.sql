-- V002__github_issues.sql
-- GitHub Issues -> Kanban cards (ADR-0013).
-- Tabela separada (nao colunas em `tasks`): o vinculo e 1:1 opcional,
-- many-to-one no futuro, e carrega metadados do GitHub que nao pertencem
-- ao dominio de Task.

CREATE TABLE github_issues (
  id                TEXT PRIMARY KEY,
  source            TEXT NOT NULL CHECK (source IN ('github')),
  external_id       TEXT NOT NULL,
  repo              TEXT NOT NULL CHECK (length(trim(repo)) > 0),
  issue_number      INTEGER NOT NULL CHECK (issue_number > 0),
  issue_url         TEXT NOT NULL CHECK (length(trim(issue_url)) > 0),
  title             TEXT NOT NULL CHECK (length(trim(title)) > 0),
  body              TEXT,
  labels            TEXT,
  source_status     TEXT NOT NULL DEFAULT 'open'
                    CHECK (source_status IN ('open','closed')),
  source_updated_at TEXT,
  task_id           TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  title_locked      INTEGER NOT NULL DEFAULT 0 CHECK (title_locked IN (0,1)),
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (source, external_id),
  CHECK (labels IS NULL OR json_valid(labels))
);

CREATE INDEX idx_github_issues_task ON github_issues(task_id);
CREATE INDEX idx_github_issues_repo ON github_issues(repo);
CREATE INDEX idx_github_issues_state ON github_issues(source_status);
CREATE INDEX idx_github_issues_unlinked ON github_issues(task_id) WHERE task_id IS NULL;
