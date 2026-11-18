//! IA proposals approval workflow service backed by SQLite (`ia_proposals` & `ia_commands`).

#![allow(missing_docs)]

use chrono::{DateTime, Duration, Utc};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::application::settings::SettingsService;
use crate::domain::settings_key::SettingsKey;
use crate::infrastructure::db::Db;
use crate::CoreError;

/// Compute lowercase hex SHA-256 of a payload string.
pub fn sha256_hex(input: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(input.as_bytes());
    let digest = hasher.finalize();
    let mut out = String::with_capacity(64);
    for b in digest {
        use std::fmt::Write;
        let _ = write!(&mut out, "{b:02x}");
    }
    out
}

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

impl Proposal {
    /// Convert to JSON matching the `Proposal` schema in spec §8.2.2 (where `payload` is an object).
    pub fn to_schema_json(&self) -> serde_json::Value {
        let payload_val: serde_json::Value =
            serde_json::from_str(&self.payload).unwrap_or_else(|_| serde_json::json!({}));
        serde_json::json!({
            "id": self.id,
            "source": self.source,
            "kind": self.kind,
            "payload": payload_val,
            "summary": self.summary,
            "status": self.status.as_str(),
            "created_at": self.created_at.to_rfc3339(),
            "expires_at": self.expires_at.to_rfc3339(),
            "decided_at": self.decided_at.map(|d| d.to_rfc3339()),
            "decision_note": self.decision_note,
            "result_ref_id": self.result_ref_id,
            "decided_by": self.decided_by,
        })
    }
}

/// Service for managing IA proposals (`ia_proposals`) and audit log (`ia_commands`).
pub struct ProposalsService<'a> {
    pub db: &'a Db,
}

impl<'a> ProposalsService<'a> {
    pub fn new(db: &'a Db) -> Self {
        Self { db }
    }

    pub fn create_proposal(
        &self,
        source: &str,
        kind: &str,
        payload_obj: &serde_json::Value,
        summary: &str,
    ) -> Result<Proposal, CoreError> {
        let ttl_hours = SettingsService::new(self.db)
            .get(SettingsKey::ProposalsTtlHours)
            .ok()
            .flatten()
            .and_then(|v| v.as_i64())
            .unwrap_or(24)
            .max(1);

        let id = uuid::Uuid::new_v4().to_string();
        let now = Utc::now();
        let expires = now + Duration::hours(ttl_hours);
        let payload_str = serde_json::to_string(payload_obj)
            .map_err(|e| CoreError::internal(format!("serialize proposal payload: {e}")))?;
        let payload_hash = sha256_hex(&payload_str);

        let conn = self.db.writer();
        conn.execute(
            "INSERT INTO ia_proposals \
             (id, source, kind, payload, summary, status, created_at, expires_at, payload_hash) \
             VALUES (?1, ?2, ?3, ?4, ?5, 'pending', ?6, ?7, ?8)",
            params![
                id,
                source,
                kind,
                payload_str,
                summary,
                now.to_rfc3339(),
                expires.to_rfc3339(),
                payload_hash,
            ],
        )
        .map_err(|e| CoreError::internal(format!("proposals create: {e}")))?;
        drop(conn);

        self.get(&id)
    }

    pub fn list_pending(&self) -> Result<Vec<Proposal>, CoreError> {
        self.list_pending_limit(50)
    }

    pub fn list_pending_limit(&self, limit: i64) -> Result<Vec<Proposal>, CoreError> {
        let lim = limit.clamp(1, 200);
        let conn = self.db.reader();
        let mut stmt = conn
            .prepare(
                "SELECT id, source, kind, payload, summary, status, created_at, expires_at, \
                 decided_at, decision_note, result_ref_id, decided_by, payload_hash \
                 FROM ia_proposals WHERE status = 'pending' ORDER BY created_at DESC LIMIT ?1",
            )
            .map_err(|e| CoreError::internal(format!("proposals list_pending prepare: {e}")))?;

        let rows = stmt
            .query_map(params![lim], Self::map_row)
            .map_err(|e| CoreError::internal(format!("proposals list_pending query: {e}")))?;

        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(|e| CoreError::internal(format!("proposals row: {e}")))?);
        }
        Ok(out)
    }

    pub fn get(&self, id: &str) -> Result<Proposal, CoreError> {
        let conn = self.db.reader();
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

    pub fn mark_expired(&self, id: &str, note: &str) -> Result<Proposal, CoreError> {
        let now_str = Utc::now().to_rfc3339();
        let conn = self.db.writer();
        conn.execute(
            "UPDATE ia_proposals SET status = 'expired', decided_at = ?1, decision_note = ?2, decided_by = 'auto' WHERE id = ?3",
            params![now_str, note, id],
        )
        .map_err(|e| CoreError::internal(format!("proposals mark_expired: {e}")))?;
        drop(conn);
        self.get(id)
    }

    pub fn approve(&self, id: &str, note: Option<&str>) -> Result<Proposal, CoreError> {
        self.finalize_approved(id, note, None, None)
    }

    pub fn finalize_approved(
        &self,
        id: &str,
        note: Option<&str>,
        result_ref_id: Option<&str>,
        updated_payload: Option<(&str, &str)>,
    ) -> Result<Proposal, CoreError> {
        let _ = self.get(id)?;
        let now_str = Utc::now().to_rfc3339();
        let conn = self.db.writer();
        if let Some((new_payload, new_hash)) = updated_payload {
            conn.execute(
                "UPDATE ia_proposals SET status = 'approved', payload = ?1, payload_hash = ?2, \
                 decided_at = ?3, decision_note = ?4, result_ref_id = ?5, decided_by = 'user' WHERE id = ?6",
                params![new_payload, new_hash, now_str, note, result_ref_id, id],
            )
            .map_err(|e| CoreError::internal(format!("proposals finalize_approved modified: {e}")))?;
        } else {
            conn.execute(
                "UPDATE ia_proposals SET status = 'approved', decided_at = ?1, decision_note = ?2, \
                 result_ref_id = ?3, decided_by = 'user' WHERE id = ?4",
                params![now_str, note, result_ref_id, id],
            )
            .map_err(|e| CoreError::internal(format!("proposals finalize_approved: {e}")))?;
        }
        drop(conn);

        self.get(id)
    }

    pub fn reject(&self, id: &str, note: Option<&str>) -> Result<Proposal, CoreError> {
        let prop = self.get(id)?;
        if prop.status != ProposalStatus::Pending {
            return Err(CoreError::conflict("proposal", "proposal is not pending"));
        }
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

    pub fn log_command(
        &self,
        source: &str,
        tool_name: &str,
        args_json: &str,
        result_status: &str,
        result_message: Option<&str>,
        proposal_id: Option<&str>,
    ) -> Result<(), CoreError> {
        let id = uuid::Uuid::new_v4().to_string();
        let now_str = Utc::now().to_rfc3339();
        let conn = self.db.writer();
        conn.execute(
            "INSERT INTO ia_commands (id, source, tool_name, args_json, result_status, result_message, proposal_id, invoked_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                id,
                source,
                tool_name,
                args_json,
                result_status,
                result_message,
                proposal_id,
                now_str,
            ],
        )
        .map_err(|e| CoreError::internal(format!("ia_commands insert: {e}")))?;
        Ok(())
    }

    fn map_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Proposal> {
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
            created_at: crate::infrastructure::clock::parse_rfc3339_or_now(&created_raw),
            expires_at: crate::infrastructure::clock::parse_rfc3339_or_now(&expires_raw),
            decided_at: decided_raw
                .as_deref()
                .and_then(crate::infrastructure::clock::parse_rfc3339),
            decision_note: row.get(9)?,
            result_ref_id: row.get(10)?,
            decided_by: row.get(11)?,
            payload_hash: row.get(12)?,
        })
    }
}
