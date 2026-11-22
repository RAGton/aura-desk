//! Hindsight episodic/semantic memory bridge with local SQLite fallback.
//!
//! Integrates with an external Hindsight HTTP daemon (`http://127.0.0.1:8919` by default)
//! using short timeouts (2-5s) and seamlessly merges/falls back to `LocalMemoryService`
//! so recall, retain, and daily maintenance continue to work offline.

use std::collections::{BTreeSet, HashSet};
use std::time::Duration;

use auradesk_core::application::memories::LocalMemoryService;
use auradesk_core::application::settings::SettingsService;
use auradesk_core::domain::settings_key::SettingsKey;
use auradesk_core::infrastructure::db::Db;
use chrono::Utc;
use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};

const DEFAULT_BASE_URL: &str = "http://127.0.0.1:8919";
const DEFAULT_BANK: &str = "aura-main";
const BANK_REGISTRY_TOPIC: &str = "bank_registry";
const HTTP_TIMEOUT_SHORT: Duration = Duration::from_secs(2);
const HTTP_TIMEOUT_MAINTENANCE: Duration = Duration::from_secs(5);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HindsightStatus {
    pub enabled: bool,
    pub base_url: String,
    pub default_bank: String,
    pub auto_create_banks: bool,
    pub daily_maintenance: bool,
    pub last_maintenance_date: String,
    pub online: bool,
    pub banks: Vec<String>,
    pub local_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HindsightRecallItem {
    pub id: String,
    pub bank: String,
    pub content: String,
    pub source: String,
    pub created_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HindsightMaintenanceResult {
    pub ok: bool,
    pub message: String,
    pub date: String,
    pub banks_processed: usize,
}

#[derive(Debug, Clone)]
pub(crate) struct HindsightConfig {
    pub(crate) enabled: bool,
    pub(crate) base_url: String,
    pub(crate) default_bank: String,
    pub(crate) auto_create_banks: bool,
    pub(crate) daily_maintenance: bool,
    pub(crate) last_maintenance_date: String,
}

fn read_bool(settings: &SettingsService, key: SettingsKey, default: bool) -> bool {
    settings
        .get(key)
        .ok()
        .flatten()
        .and_then(|v| v.as_bool())
        .unwrap_or(default)
}

fn read_str(settings: &SettingsService, key: SettingsKey, default: &str) -> String {
    settings
        .get(key)
        .ok()
        .flatten()
        .and_then(|v| v.as_str().map(str::to_string))
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| default.to_string())
}

fn read_raw_str(settings: &SettingsService, key: SettingsKey) -> String {
    settings
        .get(key)
        .ok()
        .flatten()
        .and_then(|v| v.as_str().map(str::to_string))
        .map(|s| s.trim().to_string())
        .unwrap_or_default()
}

pub(crate) fn load_config(db: &Db) -> HindsightConfig {
    let settings = SettingsService::new(db);
    HindsightConfig {
        enabled: read_bool(&settings, SettingsKey::HindsightEnabled, true),
        base_url: read_str(&settings, SettingsKey::HindsightBaseUrl, DEFAULT_BASE_URL),
        default_bank: read_str(&settings, SettingsKey::HindsightDefaultBank, DEFAULT_BANK),
        auto_create_banks: read_bool(&settings, SettingsKey::HindsightAutoCreateBanks, true),
        daily_maintenance: read_bool(&settings, SettingsKey::HindsightDailyMaintenance, true),
        last_maintenance_date: read_raw_str(&settings, SettingsKey::HindsightLastMaintenanceDate),
    }
}

pub(crate) fn build_client(timeout: Duration) -> Option<Client> {
    Client::builder().timeout(timeout).build().ok()
}

pub(crate) fn encode_path_segment(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for byte in s.as_bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~') {
            out.push(*byte as char);
        } else {
            out.push_str(&format!("%{:02X}", byte));
        }
    }
    out
}

pub(crate) fn endpoint_url(base_url: &str, path: &str) -> String {
    format!("{}{}", base_url.trim_end_matches('/'), path)
}

fn check_health(base_url: &str) -> bool {
    let Some(client) = build_client(HTTP_TIMEOUT_SHORT) else {
        return false;
    };
    client
        .get(endpoint_url(base_url, "/health"))
        .send()
        .map(|r| r.status().is_success())
        .unwrap_or(false)
}

fn fetch_remote_banks(base_url: &str) -> Vec<String> {
    let Some(client) = build_client(HTTP_TIMEOUT_SHORT) else {
        return Vec::new();
    };
    let Ok(resp) = client
        .get(endpoint_url(base_url, "/v1/default/banks"))
        .send()
    else {
        return Vec::new();
    };
    if !resp.status().is_success() {
        return Vec::new();
    }
    let Ok(val) = resp.json::<serde_json::Value>() else {
        return Vec::new();
    };
    let arr = val
        .get("banks")
        .and_then(|v| v.as_array())
        .or_else(|| val.as_array());
    let Some(items) = arr else {
        return Vec::new();
    };
    items
        .iter()
        .filter_map(|item| {
            item.as_str()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_string)
                .or_else(|| {
                    item.get("bank_id")
                        .or_else(|| item.get("id"))
                        .or_else(|| item.get("name"))
                        .and_then(|v| v.as_str())
                        .map(str::trim)
                        .filter(|s| !s.is_empty())
                        .map(str::to_string)
                })
        })
        .collect()
}

fn collect_banks(db: &Db, cfg: &HindsightConfig, online: bool) -> Vec<String> {
    let mut set = BTreeSet::new();
    set.insert(cfg.default_bank.clone());
    if let Ok(local_banks) = LocalMemoryService::new(db).list_banks() {
        for b in local_banks {
            let trimmed = b.trim();
            if !trimmed.is_empty() {
                set.insert(trimmed.to_string());
            }
        }
    }
    if online {
        for b in fetch_remote_banks(&cfg.base_url) {
            set.insert(b);
        }
    }
    set.into_iter().collect()
}

fn count_local_memories(db: &Db) -> usize {
    let conn = db.reader();
    conn.query_row(
        "SELECT COUNT(*) FROM local_memories WHERE status = 'active' AND COALESCE(topic_key, '') != ?1",
        [BANK_REGISTRY_TOPIC],
        |r| r.get::<_, usize>(0),
    )
    .unwrap_or(0)
}

fn compact_snippet(text: &str, max_chars: usize) -> String {
    let collapsed = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if collapsed.chars().count() <= max_chars {
        return collapsed;
    }
    let mut out: String = collapsed
        .chars()
        .take(max_chars.saturating_sub(3))
        .collect();
    out.push_str("...");
    out
}

fn post_memories_async(cfg: &HindsightConfig, content: &str, context: &str) {
    let Some(client) = build_client(HTTP_TIMEOUT_SHORT) else {
        return;
    };
    let path = format!(
        "/v1/default/banks/{}/memories",
        encode_path_segment(&cfg.default_bank)
    );
    let _ = client
        .post(endpoint_url(&cfg.base_url, &path))
        .json(&serde_json::json!({
            "items": [{
                "content": content,
                "context": context,
            }],
            "async": true,
        }))
        .send();
}

fn fetch_remote_recall(
    cfg: &HindsightConfig,
    target_bank: &str,
    query: &str,
) -> Vec<HindsightRecallItem> {
    let Some(client) = build_client(HTTP_TIMEOUT_SHORT) else {
        return Vec::new();
    };
    let path = format!(
        "/v1/default/banks/{}/memories/recall",
        encode_path_segment(target_bank)
    );
    let Ok(resp) = client
        .post(endpoint_url(&cfg.base_url, &path))
        .json(&serde_json::json!({
            "query": query,
            "prefer_observations": true,
        }))
        .send()
    else {
        return Vec::new();
    };
    if !resp.status().is_success() {
        return Vec::new();
    }
    let Ok(val) = resp.json::<serde_json::Value>() else {
        return Vec::new();
    };
    let arr = val
        .get("results")
        .or_else(|| val.get("memories"))
        .or_else(|| val.get("items"))
        .or_else(|| val.get("observations"))
        .and_then(|v| v.as_array())
        .or_else(|| val.as_array());
    let Some(items) = arr else {
        return Vec::new();
    };

    items
        .iter()
        .enumerate()
        .filter_map(|(idx, item)| {
            let content = item
                .as_str()
                .or_else(|| {
                    item.get("text")
                        .or_else(|| item.get("content"))
                        .or_else(|| item.get("fact"))
                        .or_else(|| item.get("observation"))
                        .and_then(|v| v.as_str())
                })
                .map(str::trim)
                .filter(|s| !s.is_empty())?
                .to_string();

            let id = item
                .get("id")
                .or_else(|| item.get("memory_id"))
                .and_then(|v| v.as_str())
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_string)
                .unwrap_or_else(|| format!("hindsight-{idx}"));

            let bank = item
                .get("bank_id")
                .or_else(|| item.get("bank"))
                .and_then(|v| v.as_str())
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_string)
                .unwrap_or_else(|| target_bank.to_string());

            let source = item
                .get("type")
                .or_else(|| item.get("fact_type"))
                .or_else(|| item.get("source"))
                .and_then(|v| v.as_str())
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_string)
                .unwrap_or_else(|| "hindsight".to_string());

            let created_at = item
                .get("created_at")
                .or_else(|| item.get("occurred_start"))
                .or_else(|| item.get("mentioned_at"))
                .and_then(|v| v.as_str())
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_string);

            Some(HindsightRecallItem {
                id,
                bank,
                content,
                source,
                created_at,
            })
        })
        .collect()
}

/// Ensure an area or project bank exists in Hindsight and local fallback when auto-creation is on.
pub fn ensure_area_bank(db: &Db, bank_id: &str) {
    let clean_bank = bank_id.trim();
    if clean_bank.is_empty() {
        return;
    }
    let cfg = load_config(db);
    if !cfg.enabled || !cfg.auto_create_banks {
        return;
    }

    let local = LocalMemoryService::new(db);
    let known_locally = local
        .list_banks()
        .map(|banks| banks.iter().any(|b| b == clean_bank))
        .unwrap_or(false);
    if !known_locally {
        let _ = local.supersede_topic(
            clean_bank,
            BANK_REGISTRY_TOPIC,
            &format!("bank_scope:{clean_bank}"),
            None,
        );
    }

    if let Some(client) = build_client(HTTP_TIMEOUT_SHORT) {
        let path = format!("/v1/default/banks/{}", encode_path_segment(clean_bank));
        let _ = client
            .put(endpoint_url(&cfg.base_url, &path))
            .json(&serde_json::json!({
                "name": clean_bank,
                "retain_mission": "personal_facts_preferences_projects_tasks",
                "observations_mission": "resolve_contradictions_and_update_user_preferences",
            }))
            .send();
    }
}

/// Inspect current Hindsight configuration, server reachability, active banks, and local memory count.
pub fn status(db: &Db) -> HindsightStatus {
    let cfg = load_config(db);
    let online = check_health(&cfg.base_url);
    let banks = collect_banks(db, &cfg, online);
    let local_count = count_local_memories(db);

    HindsightStatus {
        enabled: cfg.enabled,
        base_url: cfg.base_url,
        default_bank: cfg.default_bank,
        auto_create_banks: cfg.auto_create_banks,
        daily_maintenance: cfg.daily_maintenance,
        last_maintenance_date: cfg.last_maintenance_date,
        online,
        banks,
        local_count,
    }
}

fn fetch_remote_recent(
    cfg: &HindsightConfig,
    target_bank: &str,
    limit: usize,
) -> Vec<HindsightRecallItem> {
    let Some(client) = build_client(HTTP_TIMEOUT_SHORT) else {
        return Vec::new();
    };
    let path = format!(
        "/v1/default/banks/{}/memories/list?limit={}&offset=0",
        encode_path_segment(target_bank),
        limit.clamp(1, 50)
    );
    let Ok(resp) = client.get(endpoint_url(&cfg.base_url, &path)).send() else {
        return Vec::new();
    };
    if !resp.status().is_success() {
        return Vec::new();
    }
    let Ok(val) = resp.json::<serde_json::Value>() else {
        return Vec::new();
    };
    let Some(items) = val.get("items").and_then(|v| v.as_array()) else {
        return Vec::new();
    };
    items
        .iter()
        .enumerate()
        .filter_map(|(idx, item)| {
            let content = item
                .get("text")
                .or_else(|| item.get("content"))
                .and_then(|v| v.as_str())
                .map(str::trim)
                .filter(|s| !s.is_empty())?
                .to_string();
            let id = item
                .get("id")
                .and_then(|v| v.as_str())
                .map(str::to_string)
                .unwrap_or_else(|| format!("hs-{target_bank}-{idx}"));
            let source = item
                .get("fact_type")
                .or_else(|| item.get("type"))
                .and_then(|v| v.as_str())
                .unwrap_or("world")
                .to_string();
            let created_at = item
                .get("date")
                .or_else(|| item.get("mentioned_at"))
                .and_then(|v| v.as_str())
                .map(str::to_string);
            Some(HindsightRecallItem {
                id,
                bank: target_bank.to_string(),
                content,
                source,
                created_at,
            })
        })
        .collect()
}

/// Recall relevant memories from Hindsight, merging and falling back cleanly to SQLite.
pub fn recall(db: &Db, query: &str, bank: Option<&str>, limit: usize) -> Vec<HindsightRecallItem> {
    let cfg = load_config(db);
    let lim = limit.clamp(1, 50);
    let clean_query = query.trim();
    let explicit_bank = bank.map(str::trim).filter(|s| !s.is_empty());
    let target_bank = explicit_bank.unwrap_or(&cfg.default_bank);

    let mut merged = Vec::new();
    let mut seen_contents = HashSet::new();

    if cfg.enabled {
        if !clean_query.is_empty() {
            for item in fetch_remote_recall(&cfg, target_bank, clean_query) {
                let key = item.content.to_ascii_lowercase();
                if seen_contents.insert(key) {
                    merged.push(item);
                }
            }
        } else if check_health(&cfg.base_url) {
            let banks_to_pull: Vec<String> = match explicit_bank {
                Some(b) => vec![b.to_string()],
                None => fetch_remote_banks(&cfg.base_url)
                    .into_iter()
                    .take(8)
                    .collect(),
            };
            let per_bank = (lim / banks_to_pull.len().max(1)).clamp(2, 12);
            for b in banks_to_pull {
                for item in fetch_remote_recent(&cfg, &b, per_bank) {
                    let key = item.content.to_ascii_lowercase();
                    if seen_contents.insert(key) {
                        merged.push(item);
                    }
                }
            }
        }
    }

    let local_limit = lim.saturating_add(4).min(50);
    if let Ok(local_items) =
        LocalMemoryService::new(db).recall(explicit_bank, clean_query, local_limit)
    {
        for mem in local_items {
            if mem.topic_key.as_deref() == Some(BANK_REGISTRY_TOPIC) {
                continue;
            }
            let key = mem.content.trim().to_ascii_lowercase();
            if seen_contents.insert(key) {
                merged.push(HindsightRecallItem {
                    id: mem.id,
                    bank: mem.bank,
                    content: mem.content,
                    source: "local_sqlite".to_string(),
                    created_at: Some(mem.created_at),
                });
            }
        }
    }

    merged.truncate(lim);
    merged
}

/// Retrieve up to 6 active memories formatted as machine context for Aura's system prompt.
pub fn recall_context_for_prompt(db: &Db, prompt: &str) -> Option<String> {
    let cfg = load_config(db);
    if !cfg.enabled {
        return None;
    }
    let clean_prompt = prompt.trim();
    if clean_prompt.is_empty() {
        return None;
    }
    let items = recall(db, clean_prompt, None, 6);
    if items.is_empty() {
        return None;
    }

    let mut out = String::from("hindsight_memories:\n");
    for item in items.into_iter().take(6) {
        let snippet = compact_snippet(&item.content, 240);
        if !snippet.is_empty() {
            out.push_str("- [");
            out.push_str(&item.bank);
            out.push_str("] ");
            out.push_str(&snippet);
            out.push('\n');
        }
    }
    let trimmed = out.trim_end().to_string();
    if trimmed == "hindsight_memories:" {
        None
    } else {
        Some(trimmed)
    }
}

/// Store a concise episodic conversation note in `LocalMemoryService` and Hindsight.
pub fn retain_conversation_turn(db: &Db, user_prompt: &str, assistant_reply: &str) {
    let cfg = load_config(db);
    if !cfg.enabled {
        return;
    }
    let u = compact_snippet(user_prompt, 200);
    let a = compact_snippet(assistant_reply, 280);
    if u.is_empty() && a.is_empty() {
        return;
    }
    let note = if a.is_empty() {
        format!("user_prompt: {u}")
    } else if u.is_empty() {
        format!("aura_reply: {a}")
    } else {
        format!("user_prompt: {u} | aura_reply: {a}")
    };

    let _ = LocalMemoryService::new(db).retain(&cfg.default_bank, &note, None);
    post_memories_async(&cfg, &note, "aura_chat");
}

/// Record a concise task completion milestone in `LocalMemoryService` and Hindsight.
pub fn retain_task_completed(db: &Db, task_title: &str) {
    let cfg = load_config(db);
    if !cfg.enabled {
        return;
    }
    let clean_title = compact_snippet(task_title, 220);
    if clean_title.is_empty() {
        return;
    }
    let note = format!("completed_task: {clean_title}");
    let _ = LocalMemoryService::new(db).retain(&cfg.default_bank, &note, None);
    post_memories_async(&cfg, &note, "task_completed");
}

/// Trigger Hindsight bank consolidation and SQLite index maintenance immediately.
pub fn run_maintenance_now(db: &Db) -> HindsightMaintenanceResult {
    let cfg = load_config(db);
    let today = Utc::now().format("%Y-%m-%d").to_string();
    let online = cfg.enabled && check_health(&cfg.base_url);
    let banks = collect_banks(db, &cfg, online);

    if online {
        if let Some(client) = build_client(HTTP_TIMEOUT_MAINTENANCE) {
            for bank in &banks {
                let path = format!(
                    "/v1/default/banks/{}/consolidate",
                    encode_path_segment(bank)
                );
                let _ = client
                    .post(endpoint_url(&cfg.base_url, &path))
                    .json(&serde_json::json!({}))
                    .send();
            }
        }
    }

    let sqlite_res = LocalMemoryService::new(db).run_sqlite_maintenance();
    let (ok, message) = match sqlite_res {
        Ok(()) => {
            let _ = SettingsService::new(db).set(
                SettingsKey::HindsightLastMaintenanceDate,
                serde_json::Value::String(today.clone()),
            );
            (true, "maintenance_completed".to_string())
        }
        Err(err) => (false, format!("sqlite_maintenance_failed: {err}")),
    };

    HindsightMaintenanceResult {
        ok,
        message,
        date: today,
        banks_processed: banks.len(),
    }
}

/// Run daily Hindsight + SQLite maintenance once per UTC day when enabled and due.
pub fn run_daily_maintenance_if_due(db: &Db) -> Option<HindsightMaintenanceResult> {
    let cfg = load_config(db);
    if !cfg.enabled || !cfg.daily_maintenance {
        return None;
    }
    let today = Utc::now().format("%Y-%m-%d").to_string();
    if cfg.last_maintenance_date == today {
        return None;
    }
    Some(run_maintenance_now(db))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;

    fn closed_local_url() -> String {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind ephemeral port");
        let port = listener.local_addr().expect("local_addr").port();
        drop(listener);
        format!("http://127.0.0.1:{port}")
    }

    fn offline_test_db() -> Db {
        let db = Db::open_in_memory().expect("in-memory db");
        SettingsService::new(&db)
            .set(
                SettingsKey::HindsightBaseUrl,
                serde_json::Value::String(closed_local_url()),
            )
            .expect("set offline test url");
        db
    }

    #[test]
    fn status_reflects_defaults_local_count_and_area_banks_offline() {
        let db = offline_test_db();
        let initial = status(&db);
        assert!(initial.enabled);
        assert_eq!(initial.default_bank, "aura-main");
        assert!(initial.auto_create_banks);
        assert!(initial.daily_maintenance);
        assert!(!initial.online);
        assert_eq!(initial.local_count, 0);
        assert!(initial.banks.contains(&"aura-main".to_string()));

        ensure_area_bank(&db, "area-work");
        retain_task_completed(&db, "finish fase b rust backend");

        let updated = status(&db);
        assert!(!updated.online);
        assert_eq!(updated.local_count, 1);
        assert!(updated.banks.contains(&"aura-main".to_string()));
        assert!(updated.banks.contains(&"area-work".to_string()));
    }

    #[test]
    fn run_daily_maintenance_if_due_runs_once_per_day_and_skips_second_call() {
        let db = offline_test_db();
        let today = Utc::now().format("%Y-%m-%d").to_string();

        let first = run_daily_maintenance_if_due(&db).expect("maintenance should be due");
        assert!(first.ok);
        assert_eq!(first.message, "maintenance_completed");
        assert_eq!(first.date, today);
        assert!(first.banks_processed >= 1);

        let st = status(&db);
        assert_eq!(st.last_maintenance_date, today);

        // Second call on the same UTC day must be skipped.
        assert!(run_daily_maintenance_if_due(&db).is_none());

        // Clearing date while daily_maintenance is disabled must also skip.
        let settings = SettingsService::new(&db);
        settings
            .set(
                SettingsKey::HindsightLastMaintenanceDate,
                serde_json::json!(""),
            )
            .unwrap();
        settings
            .set(
                SettingsKey::HindsightDailyMaintenance,
                serde_json::json!(false),
            )
            .unwrap();
        assert!(run_daily_maintenance_if_due(&db).is_none());
    }

    #[test]
    fn recall_context_for_prompt_uses_local_memories_and_respects_enabled() {
        let db = offline_test_db();
        LocalMemoryService::new(&db)
            .retain("aura-main", "user prefers dark mode in rust editor", None)
            .unwrap();
        retain_conversation_turn(&db, "remind_me rust workspace", "use cargo clippy");

        let ctx = recall_context_for_prompt(&db, "check rust setup")
            .expect("should return matching hindsight memories");
        assert!(ctx.starts_with("hindsight_memories:\n"));
        assert!(ctx.contains("rust"));

        assert!(recall_context_for_prompt(&db, "unrelated_zxq_token").is_none());

        SettingsService::new(&db)
            .set(SettingsKey::HindsightEnabled, serde_json::json!(false))
            .unwrap();
        assert!(recall_context_for_prompt(&db, "rust").is_none());
    }
}
