# AuraDesk SQLite Migrations (`crates/auradesk-core/migrations`)

Migrations are embedded and executed sequentially via `auradesk_core::infrastructure::migrate` using `refinery`-style `V###__description.sql` versioning on top of SQLite WAL mode.

## Applied Versions

| Version | File | Summary |
| --- | --- | --- |
| V001 | [`V001__init.sql`](V001__init.sql) | Initial AuraDesk relational schema (core entities: projects, tasks, routines, reminders, alerts_pending, notifications, pomodoro_sessions, daily_plans, settings, audit logs, and indexes). |
| V002 | [`V002__github_issues.sql`](V002__github_issues.sql) | Adds `github_issues` table and 4 supporting indexes (`idx_github_issues_task`, `idx_github_issues_repo`, `idx_github_issues_state`, `idx_github_issues_unlinked`) linking optional GitHub Issues 1:1 with `tasks` (ADR-0013). |
| V003 | [`V003__block_screen_setting.sql`](V003__block_screen_setting.sql) | Seeds default `('reminders.block_screen', 'false')` row into `settings` via `INSERT OR IGNORE`. |

## Phase 1 Stabilization Policy

No schema migrations were added or altered during Phase 1 stabilization:

- Daily Plan compatibility uses canonical JSON encoding (`{"notes": ...}`) inside the existing `daily_plans.payload` `TEXT` column.
- SQLite read-only pooling (`Db::reader()`) configures `PRAGMA query_only = ON` and `busy_timeout = 5000` at the connection layer without changing table definitions.
- Any future schema evolution (e.g., user scoping, cloud sync metadata, encrypted vault entries) must be introduced as a versioned `V004__*.sql` migration with corresponding rollback/compatibility tests in `auradesk-core`.
