//! IA proposals approval workflow service backed by SQLite (`ia_proposals`).

#![allow(missing_docs)]

use chrono::{DateTime, Utc};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::infrastructure::db::Db;
use crate::CoreError;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProposalStatus {
    Pending,
    Approved,
    Rejected,
    Modified,
    Expired,
}

impl ProposalStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Approved => "approved",
            Self::Rejected => "rejected",
            Self::Modified => "modified",
            Self::Expired => "expired",
        }
    }

    pub fn from_db(s: &str) -> Option<Self> {
        Some(match s {
            "pending" => Self::Pending,
            "approved" => Self::Approved,
            "rejected" => Self::Rejected,
            "modified" => Self::Modified,
            "expired" => Self::Expired,
            _ => return None,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Proposal {
    pub id: String,
    pub source: String,
    pub kind: String,
    pub payload: String,
    pub summary: String,
    pub status: ProposalStatus,
    pub created_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
    pub decided_at: Option<DateTime<Utc>>,
    pub decision_note: Option<String>,
    pub result_ref_id: Option<String>,
    pub decided_by: Option<String>,
    pub payload_hash: String,
}

/// Service for managing IA proposals (`ia_proposals`).
pub struct ProposalsService<'a> {
    pub db: &'a Db,
}

impl<'a> ProposalsService<'a> {
    pub fn new(db: &'a Db) -> Self {
        Self { db }
    }

    pub fn list_pending(&self) -> Result<Vec<Proposal>, CoreError> {
        let conn = self.db.writer();
        let mut stmt = conn
            .prepare(
                "SELECT id, source, kind, payload, summary, status, created_at, expires_at, \
                 decided_at, decision_note, result_ref_id, decided_by, payload_hash \
                 FROM ia_proposals WHERE status = 'pending' ORDER BY created_at DESC",
            )
            .map_err(|e| CoreError::internal(format!("proposals list_pending prepare: {e}")))?;

        let rows = stmt
            .query_map([], Self::map_row)
            .map_err(|e| CoreError::internal(format!("proposals list_pending query: {e}")))?;

        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(|e| CoreError::internal(format!("proposals row: {e}")))?);
        }
        Ok(out)
    }

    pub fn get(&self, id: &str) -> Result<Proposal, CoreError> {
        let conn = self.db.writer();
        let prop = conn
            .query_row(
                "SELECT id, source, kind, payload, summary, status, created_at, expires_at, \
                 decided_at, decision_note, result_ref_id, decided_by, payload_hash \
                 FROM ia_proposals WHERE id = ?1",
                params![id],
                Self::map_row,
            )
            .optional()
            .map_err(|e| CoreError::internal(format!("proposals get: {e}")))?;

        prop.ok_or_else(|| CoreError::not_found("proposal", id))
    }

    pub fn approve(&self, id: &str, note: Option<&str>) -> Result<Proposal, CoreError> {
        let _ = self.get(id)?;
        let now_str = Utc::now().to_rfc3339();
        let conn = self.db.writer();
        conn.execute(
            "UPDATE ia_proposals SET status = 'approved', decided_at = ?1, decision_note = ?2, decided_by = 'user' WHERE id = ?3",
            params![now_str, note, id],
        )
        .map_err(|e| CoreError::internal(format!("proposals approve: {e}")))?;
        drop(conn);

        self.get(id)
    }

    pub fn reject(&self, id: &str, note: Option<&str>) -> Result<Proposal, CoreError> {
        let _ = self.get(id)?;
        let now_str = Utc::now().to_rfc3339();
        let conn = self.db.writer();
        conn.execute(
            "UPDATE ia_proposals SET status = 'rejected', decided_at = ?1, decision_note = ?2, decided_by = 'user' WHERE id = ?3",
            params![now_str, note, id],
        )
        .map_err(|e| CoreError::internal(format!("proposals reject: {e}")))?;
        drop(conn);

        self.get(id)
    }

    fn map_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Proposal> {
        let parse_dt = |s: &str| {
            DateTime::parse_from_rfc3339(s)
                .map(|dt| dt.with_timezone(&Utc))
                .unwrap_or_else(|_| Utc::now())
        };
        let status_raw: String = row.get(5)?;
        let created_raw: String = row.get(6)?;
        let expires_raw: String = row.get(7)?;
        let decided_raw: Option<String> = row.get(8)?;

        Ok(Proposal {
            id: row.get(0)?,
            source: row.get(1)?,
            kind: row.get(2)?,
            payload: row.get(3)?,
            summary: row.get(4)?,
            status: ProposalStatus::from_db(&status_raw).unwrap_or(ProposalStatus::Pending),
            created_at: parse_dt(&created_raw),
            expires_at: parse_dt(&expires_raw),
            decided_at: decided_raw
                .as_deref()
                .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
                .map(|dt| dt.with_timezone(&Utc)),
            decision_note: row.get(9)?,
            result_ref_id: row.get(10)?,
            decided_by: row.get(11)?,
            payload_hash: row.get(12)?,
        })
    }
}
