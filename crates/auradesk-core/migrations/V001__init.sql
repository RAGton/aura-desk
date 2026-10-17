-- V001__init.sql
-- Initial schema for AuraDesk. Verbatim from spec §7.2.
-- 13 tables, 31 indexes, 3 CHECK constraints in most tables.

-- ── Projects ──────────────────────────────────────────────────
CREATE TABLE projects (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL CHECK (length(trim(name)) > 0),
  description TEXT,
  color       TEXT CHECK (color IS NULL OR color GLOB '#[0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f]'),
  parent_id   TEXT REFERENCES projects(id) ON DELETE CASCADE,
  status      TEXT NOT NULL DEFAULT 'active'
              CHECK (status IN ('active','paused','completed','archived')),
  start_date  TEXT,
  target_date TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_projects_status ON projects(status);
CREATE INDEX idx_projects_parent ON projects(parent_id);

-- ── Tasks ─────────────────────────────────────────────────────
CREATE TABLE tasks (
  id              TEXT PRIMARY KEY,
  project_id      TEXT REFERENCES projects(id) ON DELETE SET NULL,
  parent_task_id  TEXT REFERENCES tasks(id) ON DELETE CASCADE,
  recurrence_id   TEXT REFERENCES task_recurrences(id) ON DELETE SET NULL,
  title           TEXT NOT NULL CHECK (length(trim(title)) > 0),
  description     TEXT,
  priority        TEXT NOT NULL DEFAULT 'normal'
                  CHECK (priority IN ('low','normal','high','urgent')),
  status          TEXT NOT NULL DEFAULT 'todo'
                  CHECK (status IN ('todo','doing','waiting','done','cancelled')),
  kanban_order    INTEGER NOT NULL DEFAULT 0,
  due_at          TEXT,
  started_at      TEXT,
  completed_at    TEXT,
  estimate_min    INTEGER CHECK (estimate_min IS NULL OR estimate_min > 0),
  actual_min      INTEGER CHECK (actual_min IS NULL OR actual_min >= 0),
  tags            TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (tags IS NULL OR json_valid(tags))
);
CREATE INDEX idx_tasks_status        ON tasks(status);
CREATE INDEX idx_tasks_due_open      ON tasks(due_at)
  WHERE status NOT IN ('done','cancelled');
CREATE INDEX idx_tasks_project       ON tasks(project_id);
CREATE INDEX idx_tasks_parent        ON tasks(parent_task_id);
CREATE INDEX idx_tasks_recurrence    ON tasks(recurrence_id);
CREATE INDEX idx_tasks_created       ON tasks(created_at DESC);

-- ── Task Recurrence (RRULE) ───────────────────────────────────
CREATE TABLE task_recurrences (
  id              TEXT PRIMARY KEY,
  task_id         TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  rrule           TEXT NOT NULL,
  dtstart         TEXT NOT NULL,
  dtend           TEXT,
  exdates         TEXT,
  lookahead_days  INTEGER NOT NULL DEFAULT 7
                  CHECK (lookahead_days > 0 AND lookahead_days <= 60),
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (exdates IS NULL OR json_valid(exdates))
);
CREATE INDEX idx_recurrences_task ON task_recurrences(task_id);

-- ── Reminders ─────────────────────────────────────────────────
CREATE TABLE reminders (
  id               TEXT PRIMARY KEY,
  task_id          TEXT REFERENCES tasks(id) ON DELETE CASCADE,
  proposal_id      TEXT REFERENCES ia_proposals(id) ON DELETE SET NULL,
  title            TEXT NOT NULL CHECK (length(trim(title)) > 0),
  body             TEXT,
  fire_at          TEXT NOT NULL,
  repeat_kind      TEXT
                   CHECK (repeat_kind IS NULL OR repeat_kind IN ('none','daily','weekly','monthly','cron')),
  repeat_value     TEXT,
  monitor_target   TEXT
                   CHECK (monitor_target IS NULL OR monitor_target IN ('primary','secondary','preferred')),
  sound            TEXT
                   CHECK (sound IS NULL OR sound IN ('info','normal','urgent','none')),
  status           TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','fired','resolved','dismissed','snoozed','excepted')),
  snooze_count     INTEGER NOT NULL DEFAULT 0 CHECK (snooze_count >= 0),
  last_snoozed_at  TEXT,
  resolved_at      TEXT,
  exceptions_log   TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (exceptions_log IS NULL OR json_valid(exceptions_log))
);
CREATE INDEX idx_reminders_pending  ON reminders(fire_at) WHERE status = 'pending';
CREATE INDEX idx_reminders_task     ON reminders(task_id);
CREATE INDEX idx_reminders_proposal ON reminders(proposal_id);

-- ── Routines (cron-scheduled recurring actions) ──────────────
-- cron_expr is NULL for kind='daily_planning' — that kind reads its
-- schedule from the routine.daily_planning_time setting at runtime.
CREATE TABLE routines (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL
                CHECK (kind IN ('water','break','daily_planning','custom')),
  title         TEXT NOT NULL CHECK (length(trim(title)) > 0),
  body          TEXT,
  cron_expr     TEXT,
  start_date    TEXT,
  end_date      TEXT,
  enabled       INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  metadata      TEXT,
  last_fired_at TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (metadata IS NULL OR json_valid(metadata)),
  CHECK (kind != 'daily_planning' OR cron_expr IS NULL)
);
CREATE INDEX idx_routines_enabled ON routines(enabled) WHERE enabled = 1;
CREATE INDEX idx_routines_kind    ON routines(kind);

-- ── Daily Plans (one per local date) ─────────────────────────
CREATE TABLE daily_plans (
  id              TEXT PRIMARY KEY,
  plan_date       TEXT NOT NULL,
  state           TEXT NOT NULL DEFAULT 'not_started'
                  CHECK (state IN ('not_started','in_progress','completed','skipped')),
  started_at      TEXT,
  completed_at    TEXT,
  payload         TEXT,
  rollover_from   TEXT REFERENCES daily_plans(id) ON DELETE SET NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (payload IS NULL OR json_valid(payload)),
  UNIQUE (plan_date)
);
CREATE INDEX idx_daily_plans_state ON daily_plans(state);

-- ── Pomodoro sessions ─────────────────────────────────────────
CREATE TABLE pomodoro_sessions (
  id              TEXT PRIMARY KEY,
  task_id         TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  kind            TEXT NOT NULL
                  CHECK (kind IN ('focus','short_break','long_break')),
  planned_min     INTEGER NOT NULL CHECK (planned_min > 0),
  actual_min      INTEGER CHECK (actual_min IS NULL OR actual_min > 0),
  cycle_index     INTEGER CHECK (cycle_index IS NULL OR cycle_index > 0),
  cycle_count     INTEGER CHECK (cycle_count IS NULL OR cycle_count > 0),
  started_at      TEXT NOT NULL,
  ended_at        TEXT,
  status          TEXT NOT NULL DEFAULT 'running'
                  CHECK (status IN ('running','completed','interrupted')),
  interruptions   INTEGER NOT NULL DEFAULT 0 CHECK (interruptions >= 0)
);
CREATE INDEX idx_pomo_task    ON pomodoro_sessions(task_id);
CREATE INDEX idx_pomo_started ON pomodoro_sessions(started_at DESC);

-- ── Alerts (persistent modal queue) ───────────────────────────
CREATE TABLE alerts_pending (
  id                TEXT PRIMARY KEY,
  kind              TEXT NOT NULL,
  ref_id            TEXT,
  proposal_id       TEXT REFERENCES ia_proposals(id) ON DELETE SET NULL,
  title             TEXT NOT NULL,
  body              TEXT,
  severity          TEXT NOT NULL DEFAULT 'normal'
                    CHECK (severity IN ('info','normal','urgent')),
  show_on_monitor   TEXT,
  options           TEXT,
  parent_alert_id   TEXT REFERENCES alerts_pending(id) ON DELETE SET NULL,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  shown_at          TEXT,
  resolved_at       TEXT,
  resolution        TEXT
                    CHECK (resolution IS NULL OR resolution IN ('resolved','snoozed','excepted','dismissed')),
  CHECK (options IS NULL OR json_valid(options))
);
CREATE INDEX idx_alerts_open     ON alerts_pending(created_at) WHERE resolved_at IS NULL;
CREATE INDEX idx_alerts_severity ON alerts_pending(severity) WHERE resolved_at IS NULL;
CREATE INDEX idx_alerts_parent   ON alerts_pending(parent_alert_id);

-- ── Notifications log ─────────────────────────────────────────
CREATE TABLE notifications (
  id           TEXT PRIMARY KEY,
  alert_id     TEXT REFERENCES alerts_pending(id) ON DELETE SET NULL,
  proposal_id  TEXT REFERENCES ia_proposals(id) ON DELETE SET NULL,
  kind         TEXT NOT NULL,
  ref_id       TEXT,
  title        TEXT NOT NULL,
  body         TEXT,
  delivered_at TEXT NOT NULL,
  read_at      TEXT
);
CREATE INDEX idx_notif_at       ON notifications(delivered_at DESC);
CREATE INDEX idx_notif_kind     ON notifications(kind);
CREATE INDEX idx_notif_alert    ON notifications(alert_id);
CREATE INDEX idx_notif_proposal ON notifications(proposal_id);

-- ── Daily metrics (aggregated) ────────────────────────────────
CREATE TABLE metrics_daily (
  date            TEXT PRIMARY KEY,
  focus_minutes   INTEGER NOT NULL DEFAULT 0 CHECK (focus_minutes >= 0),
  break_minutes   INTEGER NOT NULL DEFAULT 0 CHECK (break_minutes >= 0),
  water_count     INTEGER NOT NULL DEFAULT 0 CHECK (water_count >= 0),
  tasks_done      INTEGER NOT NULL DEFAULT 0 CHECK (tasks_done >= 0),
  tasks_created   INTEGER NOT NULL DEFAULT 0 CHECK (tasks_created >= 0),
  active_minutes  INTEGER NOT NULL DEFAULT 0 CHECK (active_minutes >= 0),
  notes           TEXT
);

-- ── IA command audit log ──────────────────────────────────────
CREATE TABLE ia_commands (
  id             TEXT PRIMARY KEY,
  source         TEXT NOT NULL
                 CHECK (source IN ('mcp','ui')),
  tool_name      TEXT NOT NULL,
  args_json      TEXT NOT NULL,
  result_status  TEXT NOT NULL
                 CHECK (result_status IN ('ok','rejected','error')),
  result_message TEXT,
  proposal_id    TEXT REFERENCES ia_proposals(id) ON DELETE SET NULL,
  invoked_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_ia_at        ON ia_commands(invoked_at DESC);
CREATE INDEX idx_ia_tool      ON ia_commands(tool_name);
CREATE INDEX idx_ia_status    ON ia_commands(result_status);
CREATE INDEX idx_ia_proposal  ON ia_commands(proposal_id);

-- ── IA proposals (approval workflow) ─────────────────────────
CREATE TABLE ia_proposals (
  id              TEXT PRIMARY KEY,
  source          TEXT NOT NULL
                  CHECK (source IN ('mcp','ui')),
  kind            TEXT NOT NULL
                  CHECK (kind IN ('create_task','update_task','delete_task','create_reminder','propose_subtasks','bulk_plan')),
  payload         TEXT NOT NULL,
  summary         TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','approved','rejected','modified','expired')),
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at      TEXT NOT NULL,
  decided_at      TEXT,
  decision_note   TEXT,
  result_ref_id   TEXT,
  decided_by      TEXT CHECK (decided_by IS NULL OR decided_by IN ('user','auto')),
  payload_hash    TEXT NOT NULL,
  CHECK (payload IS NULL OR json_valid(payload))
);
CREATE INDEX idx_proposals_status  ON ia_proposals(status, created_at DESC);
CREATE INDEX idx_proposals_kind    ON ia_proposals(kind);
CREATE INDEX idx_proposals_expires ON ia_proposals(expires_at) WHERE status = 'pending';

-- ── Settings (kv) ─────────────────────────────────────────────
CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Default seed: settings + routines (spec §7.3) ───────────
INSERT INTO settings (key, value) VALUES
  ('app.version',                '"0.1.0"'),
  ('app.theme',                  '"dark"'),
  ('app.locale',                 '"pt-BR"'),
  ('dashboard.refresh_sec',      '30'),
  ('monitor.preferred',          '"primary"'),
  ('monitor.fallback_strategy',  '"primary_then_hide"'),
  ('reminders.sound',            'true'),
  ('reminders.paused_until',     'null'),
  ('pomodoro.focus_min',         '25'),
  ('pomodoro.short_min',         '5'),
  ('pomodoro.long_min',          '15'),
  ('pomodoro.cycles_to_long',    '4'),
  ('routine.daily_planning_time','"07:50"'),
  ('routine.water_interval_min', '60'),
  ('routine.break_interval_min', '90'),
  ('alerts.max_queue_size',      '50'),
  ('proposals.ttl_hours',        '24');

INSERT INTO routines (id, kind, title, body, cron_expr, enabled) VALUES
  (lower(hex(randomblob(16))), 'daily_planning', 'Planejamento diário',
   'Organize as tarefas do dia.', NULL, 1),
  (lower(hex(randomblob(16))), 'water',  'Hidratação',
   'Beba um copo de água.', '0 */1 * * *', 1),
  (lower(hex(randomblob(16))), 'break',  'Pausa',
   'Levante e alongue por 5 minutos.', '0 */1 * * *', 1);
