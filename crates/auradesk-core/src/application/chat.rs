//! Persistent conversational chat history service for Aura.

#![allow(missing_docs)]

use chrono::Utc;
use rusqlite::params;
use uuid::Uuid;

use crate::domain::ai::{ChatMessage, NewChatMessage};
use crate::infrastructure::db::Db;
use crate::CoreError;

pub const DEFAULT_CHAT_SESSION: &str = "default";

pub struct ChatService<'a> {
    db: &'a Db,
}

impl<'a> ChatService<'a> {
    pub fn new(db: &'a Db) -> Self {
        Self { db }
    }

    /// Persist a single chat message (user or assistant) into `chat_messages`.
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

        let conn = self.db.writer();
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
        let lim = limit.clamp(1, 200) as i64;
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

    /// Delete all persisted messages for a session.
    pub fn clear_session(&self, session_id: Option<&str>) -> Result<usize, CoreError> {
        let sid = session_id
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or(DEFAULT_CHAT_SESSION);
        let conn = self.db.writer();
        conn.execute(
            "DELETE FROM chat_messages WHERE session_id = ?1",
            params![sid],
        )
        .map_err(|e| CoreError::internal(format!("chat clear_session: {e}")))
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
}
