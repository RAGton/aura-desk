//! Autonomous 7-layer Context Engine for Aura conversations.
//!
//! Monitors context window token budget across 7 structured layers:
//! System, User, Session, Recent, Retrieved, Working, and Tool Context.
//! When active token consumption approaches the budget threshold, older turns are
//! summarized into persistent `semantic_summary` preserving key decisions and
//! original message IDs without deleting raw message history from SQLite.

#![allow(missing_docs)]

use std::collections::HashSet;

use chrono::Utc;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::application::chat::{ChatService, DEFAULT_CHAT_SESSION};
use crate::application::memories::LocalMemoryService;
use crate::application::proposals::ProposalsService;
use crate::domain::ai::{ChatMessage, ChatSession};
use crate::infrastructure::db::Db;
use crate::CoreError;

const RECENT_TAIL_KEEP: usize = 6;
const COMPRESS_USAGE_RATIO: f64 = 0.72;
const APPROACHING_USAGE_RATIO: f64 = 0.55;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextLayerSnapshot {
    pub kind: String,
    pub label: String,
    pub token_count: usize,
    pub item_count: usize,
    pub preview: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextEventRecord {
    pub id: String,
    pub session_id: String,
    pub kind: String,
    pub reason: String,
    pub tokens_before: i64,
    pub tokens_after: i64,
    pub messages_compressed: i64,
    pub preserved_message_ids: Vec<String>,
    pub retrieved_memory_ids: Vec<String>,
    pub layers: Vec<ContextLayerSnapshot>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextPackage {
    pub session: ChatSession,
    pub layers: Vec<ContextLayerSnapshot>,
    pub recent_messages: Vec<ChatMessage>,
    pub retrieved_memories: Vec<String>,
    pub compressed_now: bool,
    pub total_tokens: usize,
    pub token_budget: usize,
    pub usage_pct: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextInspection {
    pub session: ChatSession,
    pub layers: Vec<ContextLayerSnapshot>,
    pub total_tokens: usize,
    pub token_budget: usize,
    pub usage_pct: u8,
    pub total_history_messages: usize,
    pub events: Vec<ContextEventRecord>,
}

pub struct ContextEngineService<'a> {
    db: &'a Db,
}

pub fn estimate_tokens(text: &str) -> usize {
    let chars = text.trim().chars().count();
    if chars == 0 {
        0
    } else {
        chars.div_ceil(4).max(1)
    }
}

fn compact_preview(text: &str, max_chars: usize) -> String {
    let flat = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if flat.chars().count() <= max_chars {
        flat
    } else {
        let head: String = flat.chars().take(max_chars.saturating_sub(3)).collect();
        format!("{head}...")
    }
}

fn build_semantic_summary(
    previous_summary: &str,
    older_messages: &[ChatMessage],
) -> (String, Vec<String>, Vec<String>) {
    let mut lines: Vec<String> = Vec::new();
    let mut preserved_ids: Vec<String> = Vec::new();
    let mut extracted_facts: Vec<String> = Vec::new();

    if !previous_summary.trim().is_empty() {
        lines.push(previous_summary.trim().to_string());
    }

    for msg in older_messages {
        preserved_ids.push(msg.id.clone());
        let snippet = compact_preview(&msg.content, 180);
        if snippet.is_empty() {
            continue;
        }
        let lower = snippet.to_ascii_lowercase();
        let important = lower.contains("decid")
            || lower.contains("prefer")
            || lower.contains("sempre")
            || lower.contains("nunca")
            || lower.contains("must")
            || lower.contains("always")
            || lower.contains("todo")
            || lower.contains("lembr")
            || lower.contains("propost")
            || msg.role == "user";

        if important {
            lines.push(format!("[{}] {}", msg.role, snippet));
        }
        if msg.role == "user"
            && (lower.contains("prefer")
                || lower.contains("nao quero")
                || lower.contains("não quero")
                || lower.contains("sempre")
                || lower.contains("meu ")
                || lower.contains("minha "))
        {
            extracted_facts.push(snippet);
        }
    }

    let joined = lines
        .into_iter()
        .rev()
        .take(18)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<Vec<_>>()
        .join("\n");

    (
        compact_preview(&joined, 1600),
        preserved_ids,
        extracted_facts,
    )
}

impl<'a> ContextEngineService<'a> {
    pub fn new(db: &'a Db) -> Self {
        Self { db }
    }

    /// Assemble the 7-layer active context for a turn, performing autonomous compression
    /// when approaching token budget while leaving raw history intact in SQLite.
    #[allow(clippy::too_many_arguments)]
    pub fn build_context(
        &self,
        session_id: Option<&str>,
        user_prompt: &str,
        system_prompt: &str,
        workspace_context: &str,
        retrieved_memories: &[(String, String, String)],
        tool_outputs: &[String],
    ) -> Result<ContextPackage, CoreError> {
        let sid = session_id
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or(DEFAULT_CHAT_SESSION);

        let chat = ChatService::new(self.db);
        let mut session = match chat.get_session(sid)? {
            Some(s) => s,
            None => {
                // Ensure session row exists if triggered before first append.
                let now_iso = Utc::now().to_rfc3339();
                let conn = self.db.writer();
                conn.execute(
                    "INSERT OR IGNORE INTO chat_sessions (
                        id, title, status, semantic_summary, context_state, compression_state,
                        compression_count, estimated_tokens, token_budget, associated_memories_json,
                        tools_used_json, created_at, updated_at, last_activity_at
                     ) VALUES (?1, ?2, 'active', '', 'healthy', 'none', 0, 0, 8192, '[]', '[]', ?3, ?3, ?3)",
                    params![sid, if sid == DEFAULT_CHAT_SESSION { "sessions.defaultTitle" } else { "sessions.untitledSession" }, now_iso],
                )
                .map_err(|e| CoreError::internal(format!("context build ensure session: {e}")))?;
                drop(conn);
                chat.get_session(sid)?
                    .ok_or_else(|| CoreError::internal("missing created session"))?
            }
        };

        let all_messages = chat.list_all_messages(Some(sid))?;
        let token_budget = (session.token_budget.max(1024)) as usize;

        // Deduplicate retrieved memories by normalized content & id.
        let mut seen_mem_keys: HashSet<String> = HashSet::new();
        let mut dedup_memories: Vec<(String, String, String)> = Vec::new();
        for (id, bank, content) in retrieved_memories {
            let norm = content.trim().to_ascii_lowercase();
            if norm.is_empty() || !seen_mem_keys.insert(norm) {
                continue;
            }
            dedup_memories.push((id.clone(), bank.clone(), content.clone()));
        }

        let local_user_facts = LocalMemoryService::new(self.db)
            .recall(None, "", 6)
            .unwrap_or_default()
            .into_iter()
            .filter(|m| m.topic_key.as_deref() != Some("bank_registry"))
            .collect::<Vec<_>>();

        let recent_tokens_raw: usize = all_messages
            .iter()
            .map(|m| estimate_tokens(&m.content))
            .sum();
        let system_tokens = estimate_tokens(system_prompt);
        let user_tokens: usize = local_user_facts
            .iter()
            .map(|m| estimate_tokens(&m.content))
            .sum();
        let session_tokens_before = estimate_tokens(&session.semantic_summary);
        let retrieved_tokens: usize = dedup_memories
            .iter()
            .map(|(_, _, c)| estimate_tokens(c))
            .sum();
        let working_tokens = estimate_tokens(workspace_context) + estimate_tokens(user_prompt);
        let tool_tokens: usize = tool_outputs.iter().map(|t| estimate_tokens(t)).sum();

        let total_before = system_tokens
            + user_tokens
            + session_tokens_before
            + recent_tokens_raw
            + retrieved_tokens
            + working_tokens
            + tool_tokens;

        let ratio_before = (total_before as f64) / (token_budget as f64);
        let mut compressed_now = false;
        let mut recent_messages = all_messages.clone();

        if all_messages.len() > RECENT_TAIL_KEEP && ratio_before >= COMPRESS_USAGE_RATIO {
            let split_at = all_messages.len().saturating_sub(RECENT_TAIL_KEEP);
            let older = &all_messages[..split_at];
            recent_messages = all_messages[split_at..].to_vec();

            let (new_summary, preserved_ids, extracted_facts) =
                build_semantic_summary(&session.semantic_summary, older);
            for fact in extracted_facts {
                let _ = LocalMemoryService::new(self.db).retain("aura-main", &fact, None);
            }

            let compressed_recent_tokens: usize = recent_messages
                .iter()
                .map(|m| estimate_tokens(&m.content))
                .sum();
            let new_summary_tokens = estimate_tokens(&new_summary);
            let tokens_after = system_tokens
                + user_tokens
                + new_summary_tokens
                + compressed_recent_tokens
                + retrieved_tokens
                + working_tokens
                + tool_tokens;

            session.semantic_summary = new_summary;
            session.compression_state = "compressed".to_string();
            session.context_state = "compressed".to_string();
            session.compression_count += 1;
            compressed_now = true;

            let layers_after = assemble_layers(
                system_tokens,
                system_prompt,
                user_tokens,
                local_user_facts.len(),
                new_summary_tokens,
                &session.semantic_summary,
                compressed_recent_tokens,
                recent_messages.len(),
                retrieved_tokens,
                dedup_memories.len(),
                working_tokens,
                workspace_context,
                tool_tokens,
                tool_outputs.len(),
            );

            self.insert_context_event(
                sid,
                "compression",
                &format!(
                    "autonomous_budget_guard ({}% >= {}%)",
                    (ratio_before * 100.0).round(),
                    (COMPRESS_USAGE_RATIO * 100.0).round()
                ),
                total_before as i64,
                tokens_after as i64,
                older.len() as i64,
                &preserved_ids,
                &[],
                &layers_after,
            )?;
        } else if all_messages.len() > RECENT_TAIL_KEEP {
            // Keep sliding window of recent messages active if history is long even below hard cap.
            recent_messages = all_messages[all_messages.len() - RECENT_TAIL_KEEP..].to_vec();
        }

        let recent_tokens_active: usize = recent_messages
            .iter()
            .map(|m| estimate_tokens(&m.content))
            .sum();
        let session_tokens_active = estimate_tokens(&session.semantic_summary);
        let total_tokens = system_tokens
            + user_tokens
            + session_tokens_active
            + recent_tokens_active
            + retrieved_tokens
            + working_tokens
            + tool_tokens;

        let layers = assemble_layers(
            system_tokens,
            system_prompt,
            user_tokens,
            local_user_facts.len(),
            session_tokens_active,
            &session.semantic_summary,
            recent_tokens_active,
            recent_messages.len(),
            retrieved_tokens,
            dedup_memories.len(),
            working_tokens,
            workspace_context,
            tool_tokens,
            tool_outputs.len(),
        );

        let ratio_after = (total_tokens as f64) / (token_budget as f64);
        let next_context_state = if session.compression_count > 0 || compressed_now {
            "compressed"
        } else if ratio_after >= APPROACHING_USAGE_RATIO {
            "approaching_limit"
        } else {
            "healthy"
        };
        session.context_state = next_context_state.to_string();
        session.estimated_tokens = total_tokens as i64;

        let mut assoc: Vec<String> = session.associated_memories.clone();
        let retrieved_ids: Vec<String> = dedup_memories
            .iter()
            .map(|(id, bank, _)| format!("{bank}:{id}"))
            .collect();
        for rid in &retrieved_ids {
            if !assoc.contains(rid) {
                assoc.push(rid.clone());
            }
        }
        if assoc.len() > 24 {
            assoc = assoc.split_off(assoc.len() - 24);
        }
        session.associated_memories = assoc;

        let now_iso = Utc::now().to_rfc3339();
        let conn = self.db.writer();
        conn.execute(
            "UPDATE chat_sessions
             SET semantic_summary = ?1,
                 context_state = ?2,
                 compression_state = ?3,
                 compression_count = ?4,
                 estimated_tokens = ?5,
                 associated_memories_json = ?6,
                 updated_at = ?7
             WHERE id = ?8",
            params![
                session.semantic_summary,
                session.context_state,
                session.compression_state,
                session.compression_count,
                session.estimated_tokens,
                serde_json::to_string(&session.associated_memories).unwrap_or_else(|_| "[]".into()),
                now_iso,
                sid
            ],
        )
        .map_err(|e| CoreError::internal(format!("update session context: {e}")))?;
        drop(conn);

        if !dedup_memories.is_empty() {
            self.insert_context_event(
                sid,
                "memory_retrieval",
                &format!("prompt_recall: {}", compact_preview(user_prompt, 80)),
                total_tokens as i64,
                total_tokens as i64,
                0,
                &[],
                &retrieved_ids,
                &layers,
            )?;
        }

        let usage_pct = ((ratio_after * 100.0).round() as i64).clamp(0, 100) as u8;
        let retrieved_strings = dedup_memories
            .into_iter()
            .map(|(_, bank, content)| format!("[{bank}] {content}"))
            .collect();

        Ok(ContextPackage {
            session,
            layers,
            recent_messages,
            retrieved_memories: retrieved_strings,
            compressed_now,
            total_tokens,
            token_budget,
            usage_pct,
        })
    }

    /// Manually compress older session turns now and preserve all raw history rows.
    pub fn compress_session_now(
        &self,
        session_id: Option<&str>,
        reason: Option<&str>,
    ) -> Result<ContextInspection, CoreError> {
        let sid = session_id
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or(DEFAULT_CHAT_SESSION);
        let chat = ChatService::new(self.db);
        let mut session = chat
            .get_session(sid)?
            .ok_or_else(|| CoreError::not_found("chat_session", sid))?;
        let all_messages = chat.list_all_messages(Some(sid))?;

        if !all_messages.is_empty() {
            let split_at = if all_messages.len() > 2 {
                all_messages.len().saturating_sub(2)
            } else {
                all_messages.len()
            };
            let older = &all_messages[..split_at];
            let recent = &all_messages[split_at..];
            let tokens_before: usize = all_messages
                .iter()
                .map(|m| estimate_tokens(&m.content))
                .sum();
            let (new_summary, preserved_ids, _) =
                build_semantic_summary(&session.semantic_summary, older);
            let tokens_after = estimate_tokens(&new_summary)
                + recent
                    .iter()
                    .map(|m| estimate_tokens(&m.content))
                    .sum::<usize>();

            session.semantic_summary = new_summary;
            session.compression_state = "compressed".to_string();
            session.context_state = "compressed".to_string();
            session.compression_count += 1;
            session.estimated_tokens = tokens_after as i64;

            let now_iso = Utc::now().to_rfc3339();
            let conn = self.db.writer();
            conn.execute(
                "UPDATE chat_sessions
                 SET semantic_summary = ?1,
                     context_state = ?2,
                     compression_state = ?3,
                     compression_count = ?4,
                     estimated_tokens = ?5,
                     updated_at = ?6
                 WHERE id = ?7",
                params![
                    session.semantic_summary,
                    session.context_state,
                    session.compression_state,
                    session.compression_count,
                    session.estimated_tokens,
                    now_iso,
                    sid
                ],
            )
            .map_err(|e| CoreError::internal(format!("compress_session_now update: {e}")))?;
            drop(conn);

            let layers = self.build_inspection_layers(&session, &all_messages);
            self.insert_context_event(
                sid,
                "compression",
                reason.unwrap_or("manual_compression"),
                tokens_before as i64,
                tokens_after as i64,
                older.len() as i64,
                &preserved_ids,
                &[],
                &layers,
            )?;
        }

        self.inspect_session(Some(sid))
    }

    /// Return current 7-layer token snapshot and recent compression/retrieval audit events.
    pub fn inspect_session(
        &self,
        session_id: Option<&str>,
    ) -> Result<ContextInspection, CoreError> {
        let sid = session_id
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or(DEFAULT_CHAT_SESSION);
        let chat = ChatService::new(self.db);
        let session = match chat.get_session(sid)? {
            Some(s) => s,
            None => chat
                .get_session(DEFAULT_CHAT_SESSION)?
                .ok_or_else(|| CoreError::not_found("chat_session", sid))?,
        };
        let all_messages = chat.list_all_messages(Some(&session.id))?;
        let layers = self.build_inspection_layers(&session, &all_messages);
        let total_tokens: usize = layers.iter().map(|l| l.token_count).sum();
        let token_budget = (session.token_budget.max(1024)) as usize;
        let usage_pct = (((total_tokens as f64) / (token_budget as f64) * 100.0).round() as i64)
            .clamp(0, 100) as u8;
        let events = self.list_events(&session.id, 30)?;

        Ok(ContextInspection {
            session,
            layers,
            total_tokens,
            token_budget,
            usage_pct,
            total_history_messages: all_messages.len(),
            events,
        })
    }

    fn build_inspection_layers(
        &self,
        session: &ChatSession,
        all_messages: &[ChatMessage],
    ) -> Vec<ContextLayerSnapshot> {
        let recent_slice = if all_messages.len() > RECENT_TAIL_KEEP {
            &all_messages[all_messages.len() - RECENT_TAIL_KEEP..]
        } else {
            all_messages
        };
        let user_facts = LocalMemoryService::new(self.db)
            .recall(None, "", 6)
            .unwrap_or_default()
            .into_iter()
            .filter(|m| m.topic_key.as_deref() != Some("bank_registry"))
            .collect::<Vec<_>>();
        let recent_cmds = ProposalsService::new(self.db)
            .list_commands(5)
            .unwrap_or_default();

        let sys_tok = 95;
        let usr_tok: usize = user_facts.iter().map(|f| estimate_tokens(&f.content)).sum();
        let ses_tok = estimate_tokens(&session.semantic_summary);
        let rec_tok: usize = recent_slice
            .iter()
            .map(|m| estimate_tokens(&m.content))
            .sum();
        let ret_tok = session.associated_memories.len() * 24;
        let wrk_tok = 35;
        let tool_tok = recent_cmds.len() * 18;

        assemble_layers(
            sys_tok,
            "aura_persona_policy",
            usr_tok,
            user_facts.len(),
            ses_tok,
            &session.semantic_summary,
            rec_tok,
            recent_slice.len(),
            ret_tok,
            session.associated_memories.len(),
            wrk_tok,
            "workspace_tasks_pomodoro",
            tool_tok,
            recent_cmds.len(),
        )
    }

    #[allow(clippy::too_many_arguments)]
    fn insert_context_event(
        &self,
        session_id: &str,
        kind: &str,
        reason: &str,
        tokens_before: i64,
        tokens_after: i64,
        messages_compressed: i64,
        preserved_ids: &[String],
        retrieved_memory_ids: &[String],
        layers: &[ContextLayerSnapshot],
    ) -> Result<(), CoreError> {
        let id = Uuid::new_v4().to_string();
        let now_iso = Utc::now().to_rfc3339();
        let conn = self.db.writer();
        conn.execute(
            "INSERT INTO context_events (
                id, session_id, kind, reason, tokens_before, tokens_after,
                messages_compressed, preserved_message_ids_json, retrieved_memory_ids_json,
                layers_json, created_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                id,
                session_id,
                kind,
                reason,
                tokens_before,
                tokens_after,
                messages_compressed,
                serde_json::to_string(preserved_ids).unwrap_or_else(|_| "[]".into()),
                serde_json::to_string(retrieved_memory_ids).unwrap_or_else(|_| "[]".into()),
                serde_json::to_string(layers).unwrap_or_else(|_| "[]".into()),
                now_iso
            ],
        )
        .map_err(|e| CoreError::internal(format!("insert_context_event: {e}")))?;
        Ok(())
    }

    fn list_events(
        &self,
        session_id: &str,
        limit: usize,
    ) -> Result<Vec<ContextEventRecord>, CoreError> {
        let conn = self.db.reader();
        let mut stmt = conn
            .prepare(
                "SELECT id, session_id, kind, reason, tokens_before, tokens_after,
                        messages_compressed, preserved_message_ids_json,
                        retrieved_memory_ids_json, layers_json, created_at
                 FROM context_events
                 WHERE session_id = ?1
                 ORDER BY created_at DESC, rowid DESC
                 LIMIT ?2",
            )
            .map_err(|e| CoreError::internal(format!("list_events prepare: {e}")))?;

        let rows = stmt
            .query_map(params![session_id, limit as i64], |row| {
                let preserved_raw: String = row.get(7)?;
                let retrieved_raw: String = row.get(8)?;
                let layers_raw: String = row.get(9)?;
                Ok(ContextEventRecord {
                    id: row.get(0)?,
                    session_id: row.get(1)?,
                    kind: row.get(2)?,
                    reason: row.get(3)?,
                    tokens_before: row.get(4)?,
                    tokens_after: row.get(5)?,
                    messages_compressed: row.get(6)?,
                    preserved_message_ids: serde_json::from_str(&preserved_raw).unwrap_or_default(),
                    retrieved_memory_ids: serde_json::from_str(&retrieved_raw).unwrap_or_default(),
                    layers: serde_json::from_str(&layers_raw).unwrap_or_default(),
                    created_at: row.get(10)?,
                })
            })
            .map_err(|e| CoreError::internal(format!("list_events query: {e}")))?;

        let mut out = Vec::new();
        for r in rows {
            out.push(r.map_err(|e| CoreError::internal(format!("list_events row: {e}")))?);
        }
        Ok(out)
    }
}

#[allow(clippy::too_many_arguments)]
fn assemble_layers(
    system_tokens: usize,
    system_preview: &str,
    user_tokens: usize,
    user_items: usize,
    session_tokens: usize,
    session_preview: &str,
    recent_tokens: usize,
    recent_items: usize,
    retrieved_tokens: usize,
    retrieved_items: usize,
    working_tokens: usize,
    working_preview: &str,
    tool_tokens: usize,
    tool_items: usize,
) -> Vec<ContextLayerSnapshot> {
    vec![
        ContextLayerSnapshot {
            kind: "system".to_string(),
            label: "system".to_string(),
            token_count: system_tokens,
            item_count: 1,
            preview: compact_preview(system_preview, 110),
        },
        ContextLayerSnapshot {
            kind: "user".to_string(),
            label: "user".to_string(),
            token_count: user_tokens,
            item_count: user_items,
            preview: if user_items > 0 {
                format!("{user_items} persistent_user_memories")
            } else {
                "user_facts_empty".to_string()
            },
        },
        ContextLayerSnapshot {
            kind: "session".to_string(),
            label: "session".to_string(),
            token_count: session_tokens,
            item_count: usize::from(!session_preview.trim().is_empty()),
            preview: if session_preview.trim().is_empty() {
                "semantic_summary_empty".to_string()
            } else {
                compact_preview(session_preview, 110)
            },
        },
        ContextLayerSnapshot {
            kind: "recent".to_string(),
            label: "recent".to_string(),
            token_count: recent_tokens,
            item_count: recent_items,
            preview: format!("{recent_items} active_recent_turns"),
        },
        ContextLayerSnapshot {
            kind: "retrieved".to_string(),
            label: "retrieved".to_string(),
            token_count: retrieved_tokens,
            item_count: retrieved_items,
            preview: format!("{retrieved_items} retrieved_memory_items"),
        },
        ContextLayerSnapshot {
            kind: "working".to_string(),
            label: "working".to_string(),
            token_count: working_tokens,
            item_count: 1,
            preview: compact_preview(working_preview, 110),
        },
        ContextLayerSnapshot {
            kind: "tool".to_string(),
            label: "tool".to_string(),
            token_count: tool_tokens,
            item_count: tool_items,
            preview: format!("{tool_items} recent_tool_observations"),
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::ai::NewChatMessage;

    #[test]
    fn compresses_autonomously_when_budget_nears_limit_while_preserving_original_history() {
        let db = Db::open_in_memory().unwrap();
        let chat = ChatService::new(&db);
        let sess = chat
            .create_session(Some("long_engineering_session"), None, None)
            .unwrap();

        // Lower budget on this session to deterministically trigger autonomous compression.
        {
            let conn = db.writer();
            conn.execute(
                "UPDATE chat_sessions SET token_budget = 1024 WHERE id = ?1",
                params![sess.id],
            )
            .unwrap();
        }

        let long_chunk =
            "decisao critica: usar arquitetura hexagonal com sqlite_wal no projeto ".repeat(12);
        for idx in 0..10 {
            chat.append(NewChatMessage {
                session_id: sess.id.clone(),
                role: if idx % 2 == 0 { "user" } else { "assistant" }.into(),
                content: format!("turno_{idx}: {long_chunk}"),
                provider: Some("minimax".into()),
                model: Some("MiniMax-M1".into()),
                area_id: None,
            })
            .unwrap();
        }

        let engine = ContextEngineService::new(&db);
        let pkg = engine
            .build_context(
                Some(&sess.id),
                "resuma os pontos principais",
                "system_prompt_aura",
                "workspace_snapshot",
                &[
                    ("m1".into(), "engenharia".into(), "fato_a_sobre_rust".into()),
                    ("m2".into(), "engenharia".into(), "fato_a_sobre_rust".into()),
                ],
                &["tool output".into()],
            )
            .unwrap();

        assert!(pkg.compressed_now);
        assert_eq!(pkg.session.compression_state, "compressed");
        assert!(pkg.session.compression_count >= 1);
        assert!(pkg.session.semantic_summary.contains("hexagonal"));
        assert_eq!(pkg.recent_messages.len(), RECENT_TAIL_KEEP);
        assert_eq!(pkg.retrieved_memories.len(), 1); // deduplicated

        let inspected = engine.inspect_session(Some(&sess.id)).unwrap();
        assert_eq!(inspected.total_history_messages, 10); // raw history untouched
        assert_eq!(inspected.layers.len(), 7);
        assert!(inspected.events.iter().any(|e| e.kind == "compression"));
        assert!(inspected
            .events
            .iter()
            .any(|e| e.kind == "memory_retrieval"));
    }
}
