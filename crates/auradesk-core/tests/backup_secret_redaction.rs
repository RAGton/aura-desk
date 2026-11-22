//! Backup export/import must never leak API credentials in cleartext,
//! and importing a redacted backup must keep working.
//!
//! These tests cover the three guarantees of the secret-filter feature:
//!
//! 1. the export (bundle JSON, `settings.json` and the embedded
//!    `auradesk.db`) contains no plaintext credential;
//! 2. importing a bundle whose credentials are masked succeeds and does
//!    not erase the local credential;
//! 3. the regular (non-secret) backup round-trip still works.

use std::io::Read;

use auradesk_core::application::data_io::{DataBundle, DataIoService, REDACTED_SETTING_VALUE};
use auradesk_core::application::settings::SettingsService;
use auradesk_core::application::tasks::TasksService;
use auradesk_core::domain::settings_key::SettingsKey;
use auradesk_core::domain::task::{NewTask, TaskPriority, TaskStatus};
use auradesk_core::infrastructure::db::Db;
use base64::Engine;

const AI_KEY: &str = "sk-super-secret-ai-key-0123456789";
const RAGLIGHT_KEY: &str = "rl-super-secret-raglight-key-9876543210";

/// Seed a database with both credentials plus one ordinary setting.
fn seeded_db() -> Db {
    let db = Db::open_in_memory().unwrap();
    let settings = SettingsService::new(&db);
    settings
        .set(
            SettingsKey::AiApiKey,
            serde_json::Value::String(AI_KEY.into()),
        )
        .unwrap();
    settings
        .set(
            SettingsKey::RaglightApiKey,
            serde_json::Value::String(RAGLIGHT_KEY.into()),
        )
        .unwrap();
    settings
        .set(
            SettingsKey::AppTheme,
            serde_json::Value::String("dark".into()),
        )
        .unwrap();
    db
}

/// Read one entry of a ZIP archive into a `String`.
fn zip_entry_text(zip_bytes: &[u8], name: &str) -> String {
    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(zip_bytes)).unwrap();
    let mut raw = String::new();
    archive
        .by_name(name)
        .unwrap_or_else(|e| panic!("missing zip entry {name}: {e}"))
        .read_to_string(&mut raw)
        .unwrap();
    raw
}

/// Read one entry of a ZIP archive into raw bytes.
fn zip_entry_bytes(zip_bytes: &[u8], name: &str) -> Vec<u8> {
    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(zip_bytes)).unwrap();
    let mut raw = Vec::new();
    archive
        .by_name(name)
        .unwrap_or_else(|e| panic!("missing zip entry {name}: {e}"))
        .read_to_end(&mut raw)
        .unwrap();
    raw
}

/// Extract the `settings` table of an embedded SQLite snapshot.
fn settings_rows_from_db(db_bytes: &[u8]) -> Vec<(String, String)> {
    let dir = std::env::temp_dir().join(format!("auradesk-secret-test-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("snap.db");
    std::fs::write(&path, db_bytes).unwrap();

    let conn = rusqlite::Connection::open(&path).unwrap();
    let mut stmt = conn
        .prepare("SELECT key, value FROM settings ORDER BY key")
        .unwrap();
    let rows = stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
        .unwrap()
        .map(|r| r.unwrap())
        .collect::<Vec<_>>();
    drop(stmt);
    drop(conn);
    let _ = std::fs::remove_dir_all(&dir);
    rows
}

// ── (a) The export never contains the credential in cleartext ──────────────

#[test]
fn export_bundle_json_masks_api_keys() {
    let db = seeded_db();

    let bundle_json = DataIoService::new(&db).export_json().unwrap();

    assert!(
        !bundle_json.contains(AI_KEY),
        "AI API key leaked into the exported bundle JSON"
    );
    assert!(
        !bundle_json.contains(RAGLIGHT_KEY),
        "RAGLight API key leaked into the exported bundle JSON"
    );
    assert!(
        bundle_json.contains(REDACTED_SETTING_VALUE),
        "the redacted placeholder should be present in the export"
    );

    // Non-sensitive settings are still exported verbatim.
    assert!(bundle_json.contains("dark"));
}

#[test]
fn export_bundle_masks_only_the_sensitive_keys() {
    let db = seeded_db();

    let bundle = DataIoService::new(&db).export().unwrap();

    let ai = bundle
        .settings
        .iter()
        .find(|s| s.key == SettingsKey::AiApiKey.as_str())
        .expect("ai.api_key present in the bundle");
    let rl = bundle
        .settings
        .iter()
        .find(|s| s.key == SettingsKey::RaglightApiKey.as_str())
        .expect("raglight.api_key present in the bundle");
    let theme = bundle
        .settings
        .iter()
        .find(|s| s.key == SettingsKey::AppTheme.as_str())
        .expect("app.theme present in the bundle");

    assert!(ai.value.contains(REDACTED_SETTING_VALUE));
    assert!(rl.value.contains(REDACTED_SETTING_VALUE));
    assert_eq!(theme.value, "\"dark\"");
}

#[test]
fn export_zip_settings_json_masks_api_keys() {
    let db = seeded_db();

    let zip_bytes = DataIoService::new(&db).export_zip_bytes().unwrap();
    let settings_json = zip_entry_text(&zip_bytes, "settings.json");

    assert!(
        !settings_json.contains(AI_KEY),
        "AI API key leaked into settings.json"
    );
    assert!(
        !settings_json.contains(RAGLIGHT_KEY),
        "RAGLight API key leaked into settings.json"
    );
    assert!(settings_json.contains(REDACTED_SETTING_VALUE));
}

#[test]
fn export_zip_embedded_database_masks_api_keys() {
    let db = seeded_db();

    let zip_bytes = DataIoService::new(&db).export_zip_bytes().unwrap();
    let db_bytes = zip_entry_bytes(&zip_bytes, "auradesk.db");

    // The raw archive payload must not contain the secret either — this
    // covers a stray copy of the credential anywhere in the db file.
    let haystack = String::from_utf8_lossy(&db_bytes);
    assert!(
        !haystack.contains(AI_KEY),
        "AI API key leaked into the embedded auradesk.db"
    );
    assert!(
        !haystack.contains(RAGLIGHT_KEY),
        "RAGLight API key leaked into the embedded auradesk.db"
    );

    // And the settings table inside the snapshot carries the placeholder.
    let rows = settings_rows_from_db(&db_bytes);
    let ai = rows
        .iter()
        .find(|(k, _)| k == SettingsKey::AiApiKey.as_str())
        .expect("ai.api_key row present in the embedded db");
    let rl = rows
        .iter()
        .find(|(k, _)| k == SettingsKey::RaglightApiKey.as_str())
        .expect("raglight.api_key row present in the embedded db");
    let theme = rows
        .iter()
        .find(|(k, _)| k == SettingsKey::AppTheme.as_str())
        .expect("app.theme row present in the embedded db");

    assert!(ai.1.contains(REDACTED_SETTING_VALUE));
    assert!(rl.1.contains(REDACTED_SETTING_VALUE));
    assert_eq!(theme.1, "\"dark\"");
}

#[test]
fn export_zip_bundle_json_masks_api_keys() {
    let db = seeded_db();

    let zip_bytes = DataIoService::new(&db).export_zip_bytes().unwrap();
    let bundle_json = zip_entry_text(&zip_bytes, "bundle.json");

    assert!(
        !bundle_json.contains(AI_KEY),
        "AI API key leaked into bundle.json"
    );
    assert!(
        !bundle_json.contains(RAGLIGHT_KEY),
        "RAGLight API key leaked into bundle.json"
    );
}

#[test]
fn export_zip_base64_payload_masks_api_keys() {
    let db = seeded_db();

    let b64 = DataIoService::new(&db).export_zip_base64().unwrap();
    let raw = base64::engine::general_purpose::STANDARD
        .decode(b64.trim())
        .unwrap();
    let haystack = String::from_utf8_lossy(&raw);
    assert!(
        !haystack.contains(AI_KEY),
        "AI API key leaked into the base64 backup payload"
    );
}

// ── (b) Importing a redacted backup works and keeps the local key ──────────

#[test]
fn import_of_masked_bundle_succeeds_and_preserves_local_key() {
    let src = seeded_db();
    let bundle = DataIoService::new(&src).export().unwrap();

    // The destination already holds a credential of its own.
    let dst = Db::open_in_memory().unwrap();
    SettingsService::new(&dst)
        .set(
            SettingsKey::AiApiKey,
            serde_json::Value::String("sk-local-key-must-survive".into()),
        )
        .unwrap();
    SettingsService::new(&dst)
        .set(
            SettingsKey::RaglightApiKey,
            serde_json::Value::String("rl-local-key-must-survive".into()),
        )
        .unwrap();

    let summary = DataIoService::new(&dst).import(bundle).unwrap();
    assert!(summary.settings > 0);

    let settings = SettingsService::new(&dst);
    assert_eq!(
        settings.get(SettingsKey::AiApiKey).unwrap(),
        Some(serde_json::Value::String(
            "sk-local-key-must-survive".into()
        )),
        "the masked key must not overwrite the locally configured one"
    );
    assert_eq!(
        settings.get(SettingsKey::RaglightApiKey).unwrap(),
        Some(serde_json::Value::String(
            "rl-local-key-must-survive".into()
        )),
        "the masked key must not overwrite the locally configured one"
    );
    // Non-sensitive settings are still restored.
    assert_eq!(
        settings.get(SettingsKey::AppTheme).unwrap(),
        Some(serde_json::Value::String("dark".into()))
    );
}

#[test]
fn import_of_masked_bundle_succeeds_on_a_fresh_database() {
    let src = seeded_db();
    let bundle = DataIoService::new(&src).export().unwrap();

    // A brand-new machine has no credential at all: the import must still
    // succeed (the key simply stays unset until the user re-enters it).
    let dst = Db::open_in_memory().unwrap();
    let summary = DataIoService::new(&dst).import(bundle).unwrap();
    assert!(summary.settings > 0);

    let settings = SettingsService::new(&dst);
    // The seeded default row for `ai.api_key` is the empty string (V010
    // inserts it), so the row exists but must NOT hold the redaction
    // placeholder: the masked value is skipped on import.
    let stored = settings.get(SettingsKey::AiApiKey).unwrap();
    assert!(
        !matches!(&stored, Some(serde_json::Value::String(v)) if v == REDACTED_SETTING_VALUE),
        "no placeholder should be stored as a credential, got {stored:?}"
    );
    assert_eq!(
        settings.get(SettingsKey::AppTheme).unwrap(),
        Some(serde_json::Value::String("dark".into()))
    );
}

#[test]
fn import_of_masked_zip_succeeds_and_preserves_local_key() {
    let src = seeded_db();
    let zip_bytes = DataIoService::new(&src).export_zip_bytes().unwrap();

    let dst = Db::open_in_memory().unwrap();
    SettingsService::new(&dst)
        .set(
            SettingsKey::AiApiKey,
            serde_json::Value::String("sk-local-key-must-survive".into()),
        )
        .unwrap();

    let summary = DataIoService::new(&dst)
        .import_zip_bytes(&zip_bytes)
        .unwrap();
    assert!(summary.settings > 0);

    assert_eq!(
        SettingsService::new(&dst)
            .get(SettingsKey::AiApiKey)
            .unwrap(),
        Some(serde_json::Value::String(
            "sk-local-key-must-survive".into()
        )),
        "the masked key must not overwrite the locally configured one"
    );
}

#[test]
fn import_of_a_bundle_carrying_a_real_key_still_applies_it() {
    // Backwards compatibility: a bundle produced by an older build (or
    // hand-written) that carries a real credential is imported verbatim.
    let dst = Db::open_in_memory().unwrap();
    let bundle = DataBundle {
        version: 2,
        exported_at: "2026-01-01T00:00:00Z".into(),
        projects: vec![],
        tasks: vec![],
        pomodoros: vec![],
        reminders: vec![],
        daily_plans: vec![],
        settings: vec![auradesk_core::application::data_io::SettingItem {
            key: SettingsKey::AiApiKey.as_str().to_string(),
            value: "\"sk-a-real-key\"".to_string(),
            updated_at: "2026-01-01 00:00:00".to_string(),
        }],
        github_issues: vec![],
    };

    DataIoService::new(&dst).import(bundle).unwrap();

    assert_eq!(
        SettingsService::new(&dst)
            .get(SettingsKey::AiApiKey)
            .unwrap(),
        Some(serde_json::Value::String("sk-a-real-key".into()))
    );
}

// ── (c) The regular round-trip keeps working ───────────────────────────────

#[test]
fn zip_roundtrip_preserves_normal_data() {
    let src = Db::open_in_memory().unwrap();
    let tasks = TasksService::new(&src);
    let created = tasks
        .create(NewTask {
            title: "Round-trip Task".into(),
            description: Some("Survives the redacted backup".into()),
            project_id: None,
            parent_task_id: None,
            priority: TaskPriority::Urgent,
            status: TaskStatus::Doing,
            due_at: None,
            estimate_min: Some(45),
            tags: Some(vec!["backup".into()]),
        })
        .unwrap();
    SettingsService::new(&src)
        .set(
            SettingsKey::RemindersBlockScreen,
            serde_json::Value::Bool(true),
        )
        .unwrap();

    let zip_bytes = DataIoService::new(&src).export_zip_bytes().unwrap();

    let dst = Db::open_in_memory().unwrap();
    let summary = DataIoService::new(&dst)
        .import_zip_bytes(&zip_bytes)
        .unwrap();
    assert_eq!(summary.tasks, 1);

    let restored = TasksService::new(&dst).get(&created.id).unwrap();
    assert_eq!(restored.title, "Round-trip Task");
    assert_eq!(restored.priority, TaskPriority::Urgent);
    assert_eq!(
        SettingsService::new(&dst)
            .get(SettingsKey::RemindersBlockScreen)
            .unwrap(),
        Some(serde_json::Value::Bool(true))
    );
}

#[test]
fn bundle_json_roundtrip_preserves_normal_data() {
    let src = Db::open_in_memory().unwrap();
    TasksService::new(&src)
        .create(NewTask {
            title: "JSON Round-trip Task".into(),
            description: None,
            project_id: None,
            parent_task_id: None,
            priority: TaskPriority::Normal,
            status: TaskStatus::Todo,
            due_at: None,
            estimate_min: None,
            tags: None,
        })
        .unwrap();

    let json = DataIoService::new(&src).export_json().unwrap();

    let dst = Db::open_in_memory().unwrap();
    let summary = DataIoService::new(&dst).import_json(&json).unwrap();
    assert_eq!(summary.tasks, 1);
}
