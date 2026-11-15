//! Database layer: rusqlite connection (WAL mode) + refinery migrations.
//!
//! `Db::open(path)` creates or opens the SQLite database at `path`, sets
//! PRAGMAs (WAL, foreign_keys, synchronous=NORMAL), and runs the embedded
//! refinery migrations. `Db::conn()` returns the serializing mutex for
//! write access; reads can use a separate `Db::reader()` connection.
//!
//! Phase 0 ships only the connection skeleton. Repositories are added
//! in T1+ of the foundation plan as the application services grow.

use std::path::Path;
use std::sync::{Arc, Mutex};

use rusqlite::{Connection, OpenFlags};
use thiserror::Error;

use crate::CoreError;

/// Bundles an exclusive-writer connection with an optional read-only connection.
/// (Phase 0 ships only the writer; readers go in T1+.)
pub struct Db {
    writer: Arc<Mutex<Connection>>,
}

impl Db {
    /// Open or create the database at `path/auradesk.db`, set PRAGMAs,
    /// and run all embedded migrations.
    pub fn open(path: &Path) -> Result<Self, CoreError> {
        let db_path = path.join("auradesk.db");
        let mut conn = Connection::open_with_flags(
            &db_path,
            OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_CREATE,
        )
        .map_err(|e| CoreError::internal(format!("Connection::open: {e}")))?;

        // WAL mode: concurrent readers, single writer, durable.
        conn.pragma_update(None, "journal_mode", "WAL")
            .map_err(|e| CoreError::internal(format!("PRAGMA journal_mode: {e}")))?;
        conn.pragma_update(None, "foreign_keys", "ON")
            .map_err(|e| CoreError::internal(format!("PRAGMA foreign_keys: {e}")))?;
        conn.pragma_update(None, "synchronous", "NORMAL")
            .map_err(|e| CoreError::internal(format!("PRAGMA synchronous: {e}")))?;

        // Migrations.
        Self::run_migrations(&mut conn)?;

        Ok(Self {
            writer: Arc::new(Mutex::new(conn)),
        })
    }

    /// In-memory database (for tests). Same PRAGMAs + migrations.
    pub fn open_in_memory() -> Result<Self, CoreError> {
        let mut conn = Connection::open_in_memory()
            .map_err(|e| CoreError::internal(format!("Connection::open_in_memory: {e}")))?;
        conn.pragma_update(None, "journal_mode", "WAL")
            .map_err(|e| CoreError::internal(format!("PRAGMA journal_mode: {e}")))?;
        conn.pragma_update(None, "foreign_keys", "ON")
            .map_err(|e| CoreError::internal(format!("PRAGMA foreign_keys: {e}")))?;
        conn.pragma_update(None, "synchronous", "NORMAL")
            .map_err(|e| CoreError::internal(format!("PRAGMA synchronous: {e}")))?;
        Self::run_migrations(&mut conn)?;
        Ok(Self {
            writer: Arc::new(Mutex::new(conn)),
        })
    }

    /// Acquire the writer connection. Callers must release the lock
    /// promptly; this serializes all writes.
    pub fn writer(&self) -> std::sync::MutexGuard<'_, Connection> {
        self.writer.lock().expect("Db writer mutex poisoned")
    }

    /// Snapshot the active SQLite database into raw `.db` file bytes using
    /// SQLite's online backup API.
    pub fn backup_to_bytes(&self) -> Result<Vec<u8>, CoreError> {
        let tmp_name = format!("auradesk-backup-{}.db", uuid::Uuid::new_v4());
        let tmp_path = std::env::temp_dir().join(tmp_name);
        {
            let src = self.writer();
            let mut dst = Connection::open(&tmp_path)
                .map_err(|e| CoreError::internal(format!("open backup target: {e}")))?;
            let backup = rusqlite::backup::Backup::new(&src, &mut dst)
                .map_err(|e| CoreError::internal(format!("init sqlite backup: {e}")))?;
            backup
                .run_to_completion(100, std::time::Duration::from_millis(5), None)
                .map_err(|e| CoreError::internal(format!("run sqlite backup: {e}")))?;
        }
        let bytes = std::fs::read(&tmp_path)
            .map_err(|e| CoreError::internal(format!("read backup bytes: {e}")));
        let _ = std::fs::remove_file(&tmp_path);
        bytes
    }

    /// Run all embedded migrations idempotently.
    fn run_migrations(conn: &mut Connection) -> Result<(), CoreError> {
        crate::infrastructure::migrate::run_all(conn)
    }
}

/// Database-layer error. Wrapped into `CoreError::Internal` by the
/// `From<DbError> for CoreError` impl below; surfaced to callers as
/// `CoreError`. Kept separate so low-level rusqlite/migration details
/// can be matched on without leaking through the public API.
#[derive(Debug, Error)]
pub enum DbError {
    /// Wraps any `rusqlite::Error` raised by the underlying connection.
    #[error("sqlite: {0}")]
    Sqlite(#[from] rusqlite::Error),
    /// A refinery migration step failed; the message describes the step.
    #[error("migration: {0}")]
    Migrate(String),
}

impl From<DbError> for CoreError {
    fn from(e: DbError) -> Self {
        CoreError::internal(format!("{e}"))
    }
}
