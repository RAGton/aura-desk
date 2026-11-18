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
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use rusqlite::{Connection, OpenFlags};
use thiserror::Error;

use crate::CoreError;

const READER_POOL_SIZE: usize = 4;

/// Bundles an exclusive-writer connection with a pool of read-only
/// SQLite connections in WAL mode so concurrent reads do not contend with writes.
pub struct Db {
    writer: Arc<Mutex<Connection>>,
    readers: Vec<Arc<Mutex<Connection>>>,
    reader_cursor: AtomicUsize,
}

impl Db {
    /// Open or create the database at `path/auradesk.db`, set PRAGMAs,
    /// run all embedded migrations, and initialize the read-only pool.
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
        conn.pragma_update(None, "busy_timeout", 5000)
            .map_err(|e| CoreError::internal(format!("PRAGMA busy_timeout: {e}")))?;

        // Migrations.
        Self::run_migrations(&mut conn)?;

        let mut readers = Vec::with_capacity(READER_POOL_SIZE);
        for _ in 0..READER_POOL_SIZE {
            let rconn = Connection::open_with_flags(&db_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
                .map_err(|e| CoreError::internal(format!("Connection::open read_only: {e}")))?;
            rconn
                .pragma_update(None, "query_only", "ON")
                .map_err(|e| CoreError::internal(format!("PRAGMA query_only: {e}")))?;
            rconn
                .pragma_update(None, "busy_timeout", 5000)
                .map_err(|e| CoreError::internal(format!("PRAGMA busy_timeout: {e}")))?;
            readers.push(Arc::new(Mutex::new(rconn)));
        }

        Ok(Self {
            writer: Arc::new(Mutex::new(conn)),
            readers,
            reader_cursor: AtomicUsize::new(0),
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
        conn.pragma_update(None, "busy_timeout", 5000)
            .map_err(|e| CoreError::internal(format!("PRAGMA busy_timeout: {e}")))?;
        Self::run_migrations(&mut conn)?;
        Ok(Self {
            writer: Arc::new(Mutex::new(conn)),
            readers: Vec::new(),
            reader_cursor: AtomicUsize::new(0),
        })
    }

    /// Acquire the writer connection. Callers must release the lock
    /// promptly; this serializes all writes.
    pub fn writer(&self) -> std::sync::MutexGuard<'_, Connection> {
        self.writer.lock().expect("Db writer mutex poisoned")
    }

    /// Acquire a pooled read-only connection on file-backed DBs (WAL),
    /// falling back to the writer connection on in-memory DBs.
    pub fn reader(&self) -> std::sync::MutexGuard<'_, Connection> {
        if self.readers.is_empty() {
            return self.writer();
        }
        let idx = self.reader_cursor.fetch_add(1, Ordering::Relaxed) % self.readers.len();
        self.readers[idx].lock().expect("Db reader mutex poisoned")
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
