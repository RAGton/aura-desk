//! Local SQLite memory store with topic-key superseding and multi-bank support.
//!
//! Acts both as an offline fallback when the Hindsight daemon is unavailable
//! and as a deterministic versioned store where newer facts supersede older
//! conflicting facts on the same `topic_key`.

#![allow(missing_docs)]

use chrono::Utc;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::infrastructure::db::Db;
use crate::CoreError;

/// A versioned personal/episodic memory record stored in `local_memories`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalMemory {
    pub id: String,
    pub bank: String,
    pub topic_key: Option<String>,
    pub content: String,
    pub status: String,
    pub superseded_by: Option<String>,
    pub change_reason: Option<String>,
    pub created_at: String,
}

/// Service managing versioned personal memories and SQLite index hygiene.
pub struct LocalMemoryService<'a> {
    db: &'a Db,
}

impl<'a> LocalMemoryService<'a> {
    pub fn new(db: &'a Db) -> Self {
        Self { db }
    }

    /// Store a new active memory entry inside `bank`.
    pub fn retain(
        &self,
        bank: &str,
        content: &str,
        topic_key: Option<&str>,
    ) -> Result<LocalMemory, CoreError> {
        self.retain_with_reason(bank, content, topic_key, None, false)
    }

    /// Store a new active memory on `topic_key`, marking any previously active memory
    /// on the same `(bank, topic_key)` as `superseded` with an optional reason.
    pub fn supersede_topic(
        &self,
        bank: &str,
        topic_key: &str,
        new_content: &str,
        change_reason: Option<&str>,
    ) -> Result<LocalMemory, CoreError> {
        let tk = topic_key.trim();
        if tk.is_empty() {
            return Err(CoreError::validation(
                "topic_key",
                "topic_key cannot be empty",
            ));
        }
        self.retain_with_reason(bank, new_content, Some(tk), change_reason, true)
    }

    fn retain_with_reason(
        &self,
        bank: &str,
        content: &str,
        topic_key: Option<&str>,
        change_reason: Option<&str>,
        supersede_existing: bool,
    ) -> Result<LocalMemory, CoreError> {
        let text = content.trim();
        if text.is_empty() {
            return Err(CoreError::validation(
                "content",
                "memory content cannot be empty",
            ));
        }
        let bank_id = if bank.trim().is_empty() {
            "aura-main"
        } else {
            bank.trim()
        };
        let tk = topic_key.map(str::trim).filter(|s| !s.is_empty());
        let reason = change_reason.map(str::trim).filter(|s| !s.is_empty());
        let id = Uuid::new_v4().to_string();
        let created_at = Utc::now().to_rfc3339();

        let mut conn = self.db.writer();
        let tx = conn
            .transaction()
            .map_err(|e| CoreError::internal(format!("local_memories tx: {e}")))?;

        if supersede_existing {
            if let Some(topic) = tk {
                tx.execute(
                    "UPDATE local_memories
                     SET status = 'superseded', superseded_by = ?1, change_reason = COALESCE(?2, change_reason)
                     WHERE bank = ?3 AND topic_key = ?4 AND status = 'active'",
                    params![id, reason, bank_id, topic],
                )
                .map_err(|e| CoreError::internal(format!("local_memories supersede: {e}")))?;
            }
        }

        tx.execute(
            "INSERT INTO local_memories (id, bank, topic_key, content, status, superseded_by, change_reason, created_at)
             VALUES (?1, ?2, ?3, ?4, 'active', NULL, ?5, ?6)",
            params![id, bank_id, tk, text, reason, created_at],
        )
        .map_err(|e| CoreError::internal(format!("local_memories insert: {e}")))?;

        tx.commit()
            .map_err(|e| CoreError::internal(format!("local_memories commit: {e}")))?;

        Ok(LocalMemory {
            id,
            bank: bank_id.to_string(),
            topic_key: tk.map(str::to_string),
            content: text.to_string(),
            status: "active".to_string(),
            superseded_by: None,
            change_reason: reason.map(str::to_string),
            created_at,
        })
    }

    /// Recall active memories matching `query` tokens (or newest active memories when `query` is empty).
    pub fn recall(
        &self,
        bank: Option<&str>,
        query: &str,
        limit: usize,
    ) -> Result<Vec<LocalMemory>, CoreError> {
        let lim = limit.clamp(1, 50) as i64;
        let conn = self.db.reader();
        let terms: Vec<String> = query
            .split_whitespace()
            .map(|w| {
                w.trim_matches(|c: char| !c.is_alphanumeric())
                    .to_ascii_lowercase()
            })
            .filter(|w| w.len() >= 2)
            .collect();

        let mut stmt = if let Some(b) = bank.map(str::trim).filter(|s| !s.is_empty()) {
            let mut s = conn
                .prepare(
                    "SELECT id, bank, topic_key, content, status, superseded_by, change_reason, created_at
                     FROM local_memories
                     WHERE bank = ?1 AND status = 'active'
                     ORDER BY created_at DESC, rowid DESC
                     LIMIT 200",
                )
                .map_err(|e| CoreError::internal(format!("local_memories recall prepare: {e}")))?;
            let rows = s
                .query_map(params![b], map_memory_row)
                .map_err(|e| CoreError::internal(format!("local_memories recall query: {e}")))?;
            return filter_and_limit_memories(rows, &terms, lim as usize);
        } else {
            conn.prepare(
                "SELECT id, bank, topic_key, content, status, superseded_by, change_reason, created_at
                 FROM local_memories
                 WHERE status = 'active'
                 ORDER BY created_at DESC, rowid DESC
                 LIMIT 200",
            )
            .map_err(|e| CoreError::internal(format!("local_memories recall prepare: {e}")))?
        };

        let rows = stmt
            .query_map([], map_memory_row)
            .map_err(|e| CoreError::internal(format!("local_memories recall query: {e}")))?;
        filter_and_limit_memories(rows, &terms, lim as usize)
    }

    /// Return distinct active bank names stored locally.
    pub fn list_banks(&self) -> Result<Vec<String>, CoreError> {
        let conn = self.db.reader();
        let mut stmt = conn
            .prepare("SELECT DISTINCT bank FROM local_memories WHERE status = 'active' ORDER BY bank ASC")
            .map_err(|e| CoreError::internal(format!("local_memories list_banks: {e}")))?;
        let rows = stmt
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(|e| CoreError::internal(format!("local_memories list_banks query: {e}")))?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(|e| CoreError::internal(format!("local_memories bank row: {e}")))?);
        }
        Ok(out)
    }

    /// Run SQLite query planner/index optimization (`PRAGMA optimize`).
    pub fn run_sqlite_maintenance(&self) -> Result<(), CoreError> {
        let conn = self.db.writer();
        conn.execute_batch("PRAGMA optimize;")
            .map_err(|e| CoreError::internal(format!("sqlite pragma optimize: {e}")))
    }
}

fn map_memory_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<LocalMemory> {
    Ok(LocalMemory {
        id: row.get(0)?,
        bank: row.get(1)?,
        topic_key: row.get(2)?,
        content: row.get(3)?,
        status: row.get(4)?,
        superseded_by: row.get(5)?,
        change_reason: row.get(6)?,
        created_at: row.get(7)?,
    })
}

fn filter_and_limit_memories<I>(
    rows: I,
    terms: &[String],
    limit: usize,
) -> Result<Vec<LocalMemory>, CoreError>
where
    I: Iterator<Item = rusqlite::Result<LocalMemory>>,
{
    let mut all = Vec::new();
    for r in rows {
        all.push(r.map_err(|e| CoreError::internal(format!("local_memories row: {e}")))?);
    }
    if terms.is_empty() {
        all.truncate(limit);
        return Ok(all);
    }

    let mut scored: Vec<(usize, LocalMemory)> = all
        .into_iter()
        .filter_map(|m| {
            let hay = format!("{} {}", m.topic_key.as_deref().unwrap_or(""), m.content)
                .to_ascii_lowercase();
            let hits = terms.iter().filter(|t| hay.contains(t.as_str())).count();
            if hits > 0 {
                Some((hits, m))
            } else {
                None
            }
        })
        .collect();

    scored.sort_by(|a, b| b.0.cmp(&a.0));
    Ok(scored.into_iter().take(limit).map(|(_, m)| m).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn superseding_topic_replaces_old_fact_and_preserves_reason() {
        let db = Db::open_in_memory().unwrap();
        let svc = LocalMemoryService::new(&db);

        let first = svc
            .supersede_topic("aura-main", "food_pepper", "pref_likes_pepper", None)
            .unwrap();
        let second = svc
            .supersede_topic(
                "aura-main",
                "food_pepper",
                "pref_dislikes_pepper",
                Some("changed_preference"),
            )
            .unwrap();

        let active = svc.recall(Some("aura-main"), "pepper", 10).unwrap();
        assert_eq!(active.len(), 1);
        assert_eq!(active[0].id, second.id);
        assert_eq!(active[0].content, "pref_dislikes_pepper");
        assert_eq!(
            active[0].change_reason.as_deref(),
            Some("changed_preference")
        );

        let conn = db.reader();
        let (old_status, old_superseded_by): (String, Option<String>) = conn
            .query_row(
                "SELECT status, superseded_by FROM local_memories WHERE id = ?1",
                params![first.id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(old_status, "superseded");
        assert_eq!(old_superseded_by.as_deref(), Some(second.id.as_str()));
    }
}
