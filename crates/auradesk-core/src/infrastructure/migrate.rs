//! Minimal migration runner.
//!
//! Reads embedded SQL migrations (`V001__init.sql`,
//! `V002__github_issues.sql`, `V003__block_screen_setting.sql`) at
//! compile time via `include_str!` and executes them idempotently
//! inside SQLite transactions.

use rusqlite::Connection;

use crate::infrastructure::db::DbError;

const V001: &str = include_str!("../../migrations/V001__init.sql");
const V002: &str = include_str!("../../migrations/V002__github_issues.sql");
const V003: &str = include_str!("../../migrations/V003__block_screen_setting.sql");
const V004: &str = include_str!("../../migrations/V004__desktop_settings.sql");
const V005: &str = include_str!("../../migrations/V005__release_0_2_0.sql");
const V006: &str = include_str!("../../migrations/V006__release_0_2_1.sql");
const V007: &str = include_str!("../../migrations/V007__auto_update_settings.sql");
const V008: &str = include_str!("../../migrations/V008__release_0_2_2.sql");
const V009: &str = include_str!("../../migrations/V009__idle_detection_settings.sql");
const V010: &str = include_str!("../../migrations/V010__ai_providers_and_chat.sql");
const V011: &str = include_str!("../../migrations/V011__raglight_settings.sql");
const V012: &str = include_str!("../../migrations/V012__hindsight_settings.sql");
const V013: &str = include_str!("../../migrations/V013__sessions_context_agents.sql");
const V014: &str = include_str!("../../migrations/V014__agents_skills_mcp_bots.sql");
const V015: &str = include_str!("../../migrations/V015__hindsight_graph_settings.sql");
const V016: &str = include_str!("../../migrations/V016__private_plugins.sql");

/// Run every embedded migration on the given connection idempotently.
pub fn run_all(conn: &mut Connection) -> Result<(), crate::CoreError> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS _migrations (
            name TEXT PRIMARY KEY,
            applied_at TEXT NOT NULL DEFAULT (datetime('now'))
        );",
    )
    .map_err(DbError::from)?;

    apply_if_missing(conn, "V001__init", V001)?;
    apply_if_missing(conn, "V002__github_issues", V002)?;
    apply_if_missing(conn, "V003__block_screen_setting", V003)?;
    apply_if_missing(conn, "V004__desktop_settings", V004)?;
    apply_if_missing(conn, "V005__release_0_2_0", V005)?;
    apply_if_missing(conn, "V006__release_0_2_1", V006)?;
    apply_if_missing(conn, "V007__auto_update_settings", V007)?;
    apply_if_missing(conn, "V008__release_0_2_2", V008)?;
    apply_if_missing(conn, "V009__idle_detection_settings", V009)?;
    apply_if_missing(conn, "V010__ai_providers_and_chat", V010)?;
    apply_if_missing(conn, "V011__raglight_settings", V011)?;
    apply_if_missing(conn, "V012__hindsight_settings", V012)?;
    apply_if_missing(conn, "V013__sessions_context_agents", V013)?;
    apply_if_missing(conn, "V014__agents_skills_mcp_bots", V014)?;
    apply_if_missing(conn, "V015__hindsight_graph_settings", V015)?;
    apply_if_missing(conn, "V016__private_plugins", V016)?;
    Ok(())
}

fn apply_if_missing(conn: &mut Connection, name: &str, sql: &str) -> Result<(), crate::CoreError> {
    let applied: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM _migrations WHERE name = ?1",
            rusqlite::params![name],
            |row| row.get(0),
        )
        .map_err(DbError::from)?;
    if applied == 0 {
        let tx = conn.transaction().map_err(DbError::from)?;
        tx.execute_batch(sql).map_err(DbError::from)?;
        tx.execute(
            "INSERT INTO _migrations (name) VALUES (?1)",
            rusqlite::params![name],
        )
        .map_err(DbError::from)?;
        tx.commit().map_err(DbError::from)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn failed_migration_rolls_back_atomically() {
        let mut conn = Connection::open_in_memory().unwrap();
        run_all(&mut conn).unwrap();

        let bad_sql = "
            CREATE TABLE partial_should_not_exist (id TEXT PRIMARY KEY);
            INSERT INTO nonexistent_table (x) VALUES (1);
        ";
        let err = apply_if_missing(&mut conn, "V999__broken", bad_sql);
        assert!(err.is_err());

        let partial_exists: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'partial_should_not_exist'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(partial_exists, 0);

        let recorded: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM _migrations WHERE name = 'V999__broken'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(recorded, 0);
    }
}
