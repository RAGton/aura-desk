//! Minimal migration runner.
//!
//! Reads `migrations/V001__init.sql` and `migrations/V002__github_issues.sql`
//! at compile time via `include_str!` and executes them idempotently.

use rusqlite::Connection;

use crate::infrastructure::db::DbError;

const V001: &str = include_str!("../../migrations/V001__init.sql");
const V002: &str = include_str!("../../migrations/V002__github_issues.sql");

/// Run every embedded migration on the given connection idempotently.
pub fn run_all(conn: &Connection) -> Result<(), crate::CoreError> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS _migrations (
            name TEXT PRIMARY KEY,
            applied_at TEXT NOT NULL DEFAULT (datetime('now'))
        );",
    )
    .map_err(DbError::from)?;

    apply_if_missing(conn, "V001__init", V001)?;
    apply_if_missing(conn, "V002__github_issues", V002)?;
    Ok(())
}

fn apply_if_missing(conn: &Connection, name: &str, sql: &str) -> Result<(), crate::CoreError> {
    let applied: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM _migrations WHERE name = ?1",
            rusqlite::params![name],
            |row| row.get(0),
        )
        .map_err(DbError::from)?;
    if applied == 0 {
        conn.execute_batch(sql).map_err(DbError::from)?;
        conn.execute(
            "INSERT INTO _migrations (name) VALUES (?1)",
            rusqlite::params![name],
        )
        .map_err(DbError::from)?;
    }
    Ok(())
}
