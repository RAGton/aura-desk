//! Persistent multi-session conversational chat history service for Aura.

#![allow(missing_docs)]

use chrono::Utc;
use rusqlite::params;
use uuid::Uuid;

use crate::domain::ai::{ChatMessage, ChatSession, NewChatMessage};
use crate::infrastructure::db::Db;
use crate::CoreError;

pub const DEFAULT_CHAT_SESSION: &str = "default";
const DEFAULT_TOKEN_BUDGET: i64 = 8192;

pub struct ChatService<'a> {
    db: &'a Db,
}

fn parse_string_vec(raw: &str) -> Vec<String> {
    serde_json::from_str::<Vec<String>>(raw).unwrap_or_default()
}

fn derive_title(raw: &str) -> String {
    let collapsed = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    let trimmed = collapsed.trim();
    if trimmed.is_empty() {
        return "sessions.untitledSession".to_string();
    }
    if trimmed.chars().count() <= 54 {
        trimmed.to_string()
    } else {
        let head: String = trimmed.chars().take(51).collect();
        format!("{head}...")
    }
}

fn estimate_msg_tokens(content: &str) -> i64 {
    content.chars().count().div_ceil(4).max(1) as i64
}

fn ensure_session_row(
    conn: &rusqlite::Connection,
    session_id: &str,
    now_iso: &str,
) -> Result<(), CoreError> {
    let default_title = if session_id == DEFAULT_CHAT_SESSION {
        "sessions.defaultTitle"
    } else {
        "sessions.untitledSession"
    };
    conn.execute(
        "INSERT OR IGNORE INTO chat_sessions (
            id, title, status, semantic_summary, context_state, compression_state,
            compression_count, estimated_tokens, token_budget, associated_memories_json,
            tools_used_json, created_at, updated_at, last_activity_at
         ) VALUES (?1, ?2, 'active', '', 'healthy', 'none', 0, 0, ?3, '[]', '[]', ?4, ?4, ?4)",
        params![session_id, default_title, DEFAULT_TOKEN_BUDGET, now_iso],
    )
    .map_err(|e| CoreError::internal(format!("ensure_session_row: {e}")))?;
    Ok(())
}

impl<'a> ChatService<'a> {
    pub fn new(db: &'a Db) -> Self {
        Self { db }
    }

    /// Create a dedicated conversation session initialized with its own isolated state.
    pub fn create_session(
        &self,
        title: Option<&str>,
        model: Option<&str>,
        provider: Option<&str>,
    ) -> Result<ChatSession, CoreError> {
        let id = format!("sess-{}", Uuid::new_v4());
        let now_iso = Utc::now().to_rfc3339();
        let clean_title = title
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(derive_title)
            .unwrap_or_else(|| format!("aura-{}", &now_iso[..10]));
        let clean_model = model.map(str::trim).filter(|s| !s.is_empty());
        let clean_provider = provider.map(str::trim).filter(|s| !s.is_empty());

        let conn = self.db.writer();
        conn.execute(
            "INSERT INTO chat_sessions (
                id, title, status, semantic_summary, context_state, compression_state,
                compression_count, estimated_tokens, token_budget, model, provider,
                associated_memories_json, tools_used_json, created_at, updated_at, last_activity_at
             ) VALUES (?1, ?2, 'active', '', 'healthy', 'none', 0, 0, ?3, ?4, ?5, '[]', '[]', ?6, ?6, ?6)",
            params![id, clean_title, DEFAULT_TOKEN_BUDGET, clean_model, clean_provider, now_iso],
        )
        .map_err(|e| CoreError::internal(format!("create_session: {e}")))?;
        drop(conn);

        self.get_session(&id)?
            .ok_or_else(|| CoreError::internal("created session not found"))
    }

    /// Return a single session with current message stats.
    pub fn get_session(&self, session_id: &str) -> Result<Option<ChatSession>, CoreError> {
        let sid = session_id.trim();
        if sid.is_empty() {
            return Ok(None);
        }
        let all = self.list_sessions(None, None, None, None)?;
        Ok(all.into_iter().find(|s| s.id == sid))
    }

    /// List sessions with optional text search (title, summary, or message content), status (`active` / `archived`), and YYYY-MM-DD date filters.
    pub fn list_sessions(
        &self,
        query: Option<&str>,
        status: Option<&str>,
        date_from: Option<&str>,
        date_to: Option<&str>,
    ) -> Result<Vec<ChatSession>, CoreError> {
        let q = query
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(|s| s.to_ascii_lowercase());
        let status_filter = status
            .map(str::trim)
            .filter(|s| !s.is_empty() && *s != "all");
        let df = date_from.map(str::trim).filter(|s| !s.is_empty());
        let dt = date_to.map(str::trim).filter(|s| !s.is_empty());

        let conn = self.db.reader();
        let mut stmt = conn
            .prepare(
                "SELECT
                    s.id,
                    s.title,
                    s.status,
                    s.semantic_summary,
                    s.context_state,
                    s.compression_state,
                    s.compression_count,
                    s.estimated_tokens,
                    s.token_budget,
                    s.model,
                    s.provider,
                    s.associated_memories_json,
                    s.tools_used_json,
                    s.created_at,
                    s.updated_at,
                    s.last_activity_at,
                    (SELECT COUNT(*) FROM chat_messages m WHERE m.session_id = s.id) AS msg_count,
                    (SELECT m.content FROM chat_messages m WHERE m.session_id = s.id ORDER BY m.created_at DESC, m.rowid DESC LIMIT 1) AS last_preview
                 FROM chat_sessions s
                 ORDER BY CASE WHEN s.status = 'active' THEN 0 ELSE 1 END, s.last_activity_at DESC",
            )
            .map_err(|e| CoreError::internal(format!("list_sessions prepare: {e}")))?;

        let rows = stmt
            .query_map([], |row| {
                let assoc_raw: String = row.get(11)?;
                let tools_raw: String = row.get(12)?;
                Ok(ChatSession {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    status: row.get(2)?,
                    semantic_summary: row.get(3)?,
                    context_state: row.get(4)?,
                    compression_state: row.get(5)?,
                    compression_count: row.get(6)?,
                    estimated_tokens: row.get(7)?,
                    token_budget: row.get(8)?,
                    model: row.get(9)?,
                    provider: row.get(10)?,
                    associated_memories: parse_string_vec(&assoc_raw),
                    tools_used: parse_string_vec(&tools_raw),
                    created_at: row.get(13)?,
                    updated_at: row.get(14)?,
                    last_activity_at: row.get(15)?,
                    message_count: row.get(16)?,
                    last_message_preview: row.get(17)?,
                })
            })
            .map_err(|e| CoreError::internal(format!("list_sessions query: {e}")))?;

        let mut sessions = Vec::new();
        for r in rows {
            let sess = r.map_err(|e| CoreError::internal(format!("list_sessions row: {e}")))?;
            if let Some(st) = status_filter {
                if sess.status != st {
                    continue;
                }
            }
            if let Some(from_day) = df {
                let act_day = sess.last_activity_at.get(..10).unwrap_or("");
                if !act_day.is_empty() && act_day < from_day {
                    continue;
                }
            }
            if let Some(to_day) = dt {
                let act_day = sess.last_activity_at.get(..10).unwrap_or("");
                if !act_day.is_empty() && act_day > to_day {
                    continue;
                }
            }
            if let Some(ref needle) = q {
                let in_meta = sess.title.to_ascii_lowercase().contains(needle)
                    || sess.semantic_summary.to_ascii_lowercase().contains(needle)
                    || sess.id.to_ascii_lowercase().contains(needle);
                let in_messages = if in_meta {
                    true
                } else {
                    conn.query_row(
                        "SELECT EXISTS(SELECT 1 FROM chat_messages WHERE session_id = ?1 AND lower(content) LIKE ?2)",
                        params![sess.id, format!("%{needle}%")],
                        |row| row.get::<_, bool>(0),
                    )
                    .unwrap_or(false)
                };
                if !in_meta && !in_messages {
                    continue;
                }
            }
            sessions.push(sess);
        }
        Ok(sessions)
    }

    /// Rename an existing session.
    pub fn rename_session(&self, session_id: &str, title: &str) -> Result<ChatSession, CoreError> {
        let sid = session_id.trim();
        let clean_title = title.trim();
        if sid.is_empty() || clean_title.is_empty() {
            return Err(CoreError::validation(
                "title",
                "session_id and title cannot be empty",
            ));
        }
        let now_iso = Utc::now().to_rfc3339();
        let conn = self.db.writer();
        ensure_session_row(&conn, sid, &now_iso)?;
        conn.execute(
            "UPDATE chat_sessions SET title = ?1, updated_at = ?2 WHERE id = ?3",
            params![clean_title, now_iso, sid],
        )
        .map_err(|e| CoreError::internal(format!("rename_session: {e}")))?;
        drop(conn);
        self.get_session(sid)?
            .ok_or_else(|| CoreError::not_found("chat_session", sid))
    }

    /// Archive or reactivate a session (`active` or `archived`).
    pub fn set_session_status(
        &self,
        session_id: &str,
        status: &str,
    ) -> Result<ChatSession, CoreError> {
        let sid = session_id.trim();
        if status != "active" && status != "archived" {
            return Err(CoreError::validation(
                "status",
                format!("unsupported session status: {status}"),
            ));
        }
        let now_iso = Utc::now().to_rfc3339();
        let conn = self.db.writer();
        ensure_session_row(&conn, sid, &now_iso)?;
        conn.execute(
            "UPDATE chat_sessions SET status = ?1, updated_at = ?2 WHERE id = ?3",
            params![status, now_iso, sid],
        )
        .map_err(|e| CoreError::internal(format!("set_session_status: {e}")))?;
        drop(conn);
        self.get_session(sid)?
            .ok_or_else(|| CoreError::not_found("chat_session", sid))
    }

    /// Delete a session and its persisted messages + context events cleanly.
    pub fn delete_session(&self, session_id: &str) -> Result<(), CoreError> {
        let sid = session_id.trim();
        if sid.is_empty() {
            return Err(CoreError::validation(
                "session_id",
                "session_id cannot be empty",
            ));
        }
        let mut conn = self.db.writer();
        let tx = conn
            .transaction()
            .map_err(|e| CoreError::internal(format!("delete_session tx: {e}")))?;
        tx.execute(
            "DELETE FROM chat_messages WHERE session_id = ?1",
            params![sid],
        )
        .map_err(|e| CoreError::internal(format!("delete_session messages: {e}")))?;
        tx.execute(
            "DELETE FROM context_events WHERE session_id = ?1",
            params![sid],
        )
        .map_err(|e| CoreError::internal(format!("delete_session context_events: {e}")))?;
        if sid == DEFAULT_CHAT_SESSION {
            let now_iso = Utc::now().to_rfc3339();
            tx.execute(
                "UPDATE chat_sessions
                 SET semantic_summary = '', context_state = 'healthy', compression_state = 'none',
                     compression_count = 0, estimated_tokens = 0, updated_at = ?1, last_activity_at = ?1
                 WHERE id = ?2",
                params![now_iso, sid],
            )
            .map_err(|e| CoreError::internal(format!("reset default session: {e}")))?;
        } else {
            tx.execute("DELETE FROM chat_sessions WHERE id = ?1", params![sid])
                .map_err(|e| CoreError::internal(format!("delete_session row: {e}")))?;
        }
        tx.commit()
            .map_err(|e| CoreError::internal(format!("delete_session commit: {e}")))?;
        Ok(())
    }

    /// Persist a single chat message (user or assistant) into `chat_messages` and update session metadata.
    pub fn append(&self, input: NewChatMessage) -> Result<ChatMessage, CoreError> {
        let content = input.content.trim().to_string();
        if content.is_empty() {
            return Err(CoreError::validation(
                "content",
                "chat message cannot be empty",
            ));
        }
        let role = match input.role.as_str() {
            "user" | "assistant" | "system" => input.role,
            other => {
                return Err(CoreError::validation(
                    "role",
                    format!("unsupported chat role: {other}"),
                ));
            }
        };
        let session_id = if input.session_id.trim().is_empty() {
            DEFAULT_CHAT_SESSION.to_string()
        } else {
            input.session_id.trim().to_string()
        };
        let id = Uuid::new_v4().to_string();
        let created_at = Utc::now().to_rfc3339();
        let delta_tokens = estimate_msg_tokens(&content);

        let conn = self.db.writer();
        ensure_session_row(&conn, &session_id, &created_at)?;
        conn.execute(
            "INSERT INTO chat_messages (id, session_id, role, content, provider, model, area_id, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                id,
                session_id,
                role,
                content,
                input.provider,
                input.model,
                input.area_id,
                created_at
            ],
        )
        .map_err(|e| CoreError::internal(format!("chat append: {e}")))?;

        let existing_title: String = conn
            .query_row(
                "SELECT title FROM chat_sessions WHERE id = ?1",
                params![session_id],
                |r| r.get(0),
            )
            .unwrap_or_default();
        let next_title = if role == "user"
            && (existing_title == "sessions.untitledSession" || existing_title.starts_with("aura-"))
        {
            derive_title(&content)
        } else {
            existing_title
        };

        conn.execute(
            "UPDATE chat_sessions
             SET title = ?1,
                 estimated_tokens = estimated_tokens + ?2,
                 provider = COALESCE(?3, provider),
                 model = COALESCE(?4, model),
                 updated_at = ?5,
                 last_activity_at = ?5
             WHERE id = ?6",
            params![
                next_title,
                delta_tokens,
                input.provider,
                input.model,
                created_at,
                session_id
            ],
        )
        .map_err(|e| CoreError::internal(format!("chat append update session: {e}")))?;

        Ok(ChatMessage {
            id,
            session_id,
            role,
            content,
            provider: input.provider,
            model: input.model,
            area_id: input.area_id,
            created_at,
        })
    }

    /// List the most recent `limit` messages for `session_id` in chronological order (oldest first).
    pub fn list_recent(
        &self,
        session_id: Option<&str>,
        limit: usize,
    ) -> Result<Vec<ChatMessage>, CoreError> {
        let sid = session_id
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or(DEFAULT_CHAT_SESSION);
        let lim = limit.clamp(1, 500) as i64;
        let conn = self.db.reader();
        let mut stmt = conn
            .prepare(
                "SELECT id, session_id, role, content, provider, model, area_id, created_at
                 FROM chat_messages
                 WHERE session_id = ?1
                 ORDER BY created_at DESC, rowid DESC
                 LIMIT ?2",
            )
            .map_err(|e| CoreError::internal(format!("chat list_recent prepare: {e}")))?;

        let rows = stmt
            .query_map(params![sid, lim], |row| {
                Ok(ChatMessage {
                    id: row.get(0)?,
                    session_id: row.get(1)?,
                    role: row.get(2)?,
                    content: row.get(3)?,
                    provider: row.get(4)?,
                    model: row.get(5)?,
                    area_id: row.get(6)?,
                    created_at: row.get(7)?,
                })
            })
            .map_err(|e| CoreError::internal(format!("chat list_recent query: {e}")))?;

        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(|e| CoreError::internal(format!("chat list_recent row: {e}")))?);
        }
        out.reverse();
        Ok(out)
    }

    /// List ALL persisted messages for `session_id` chronologically without discarding originals.
    pub fn list_all_messages(
        &self,
        session_id: Option<&str>,
    ) -> Result<Vec<ChatMessage>, CoreError> {
        self.list_recent(session_id, 500)
    }

    /// Delete all persisted messages for a session.
    pub fn clear_session(&self, session_id: Option<&str>) -> Result<usize, CoreError> {
        let sid = session_id
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or(DEFAULT_CHAT_SESSION);
        let conn = self.db.writer();
        let deleted = conn
            .execute(
                "DELETE FROM chat_messages WHERE session_id = ?1",
                params![sid],
            )
            .map_err(|e| CoreError::internal(format!("chat clear_session: {e}")))?;
        let now_iso = Utc::now().to_rfc3339();
        let _ = conn.execute(
            "UPDATE chat_sessions SET estimated_tokens = 0, semantic_summary = '', context_state = 'healthy', compression_state = 'none', updated_at = ?1 WHERE id = ?2",
            params![now_iso, sid],
        );
        Ok(deleted)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn appends_lists_chronologically_and_clears_chat_history() {
        let db = Db::open_in_memory().unwrap();
        let svc = ChatService::new(&db);

        svc.append(NewChatMessage {
            session_id: "default".into(),
            role: "user".into(),
            content: "msg_user_1".into(),
            provider: None,
            model: None,
            area_id: None,
        })
        .unwrap();
        svc.append(NewChatMessage {
            session_id: "default".into(),
            role: "assistant".into(),
            content: "msg_assistant_1".into(),
            provider: Some("minimax".into()),
            model: Some("MiniMax-M1".into()),
            area_id: None,
        })
        .unwrap();

        let history = svc.list_recent(None, 20).unwrap();
        assert_eq!(history.len(), 2);
        assert_eq!(history[0].role, "user");
        assert_eq!(history[1].role, "assistant");
        assert_eq!(history[1].provider.as_deref(), Some("minimax"));

        let cleared = svc.clear_session(None).unwrap();
        assert_eq!(cleared, 2);
        assert!(svc.list_recent(None, 20).unwrap().is_empty());
    }

    #[test]
    fn creates_searches_renames_archives_and_deletes_sessions() {
        let db = Db::open_in_memory().unwrap();
        let svc = ChatService::new(&db);

        let s1 = svc
            .create_session(
                Some("planejamento_kvm"),
                Some("MiniMax-M1"),
                Some("minimax"),
            )
            .unwrap();
        svc.append(NewChatMessage {
            session_id: s1.id.clone(),
            role: "user".into(),
            content: "configurar interface bridge no libvirt e fortinet".into(),
            provider: None,
            model: None,
            area_id: None,
        })
        .unwrap();

        let hits = svc
            .list_sessions(Some("fortinet"), None, None, None)
            .unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].id, s1.id);
        assert_eq!(hits[0].message_count, 1);

        let renamed = svc.rename_session(&s1.id, "lab_fortinet_kvm").unwrap();
        assert_eq!(renamed.title, "lab_fortinet_kvm");

        let archived = svc.set_session_status(&s1.id, "archived").unwrap();
        assert_eq!(archived.status, "archived");
        assert!(svc
            .list_sessions(None, Some("active"), None, None)
            .unwrap()
            .iter()
            .all(|s| s.id != s1.id));

        svc.delete_session(&s1.id).unwrap();
        assert!(svc.get_session(&s1.id).unwrap().is_none());
    }
}
