//! Managed and external RAGLight integration for indexing local machine files
//! and retrieving relevant context into Aura.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;

use auradesk_core::application::settings::SettingsService;
use auradesk_core::domain::settings_key::SettingsKey;
use auradesk_core::infrastructure::db::Db;
use serde::{Deserialize, Serialize};

/// Tracks an optional AuraDesk-managed local RAGLight server child process.
#[derive(Default)]
pub struct RaglightManager {
    child: Mutex<Option<Child>>,
}

impl RaglightManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn managed_pid(&self) -> Option<u32> {
        let mut guard = self.child.lock().ok()?;
        if let Some(child) = guard.as_mut() {
            if let Ok(Some(_)) = child.try_wait() {
                *guard = None;
                return None;
            }
            return Some(child.id());
        }
        None
    }

    pub fn set_child(&self, next: Child) {
        if let Ok(mut guard) = self.child.lock() {
            if let Some(mut old) = guard.take() {
                let _ = old.kill();
                let _ = old.wait();
            }
            *guard = Some(next);
        }
    }

    pub fn stop(&self) -> bool {
        if let Ok(mut guard) = self.child.lock() {
            if let Some(mut old) = guard.take() {
                let _ = old.kill();
                let _ = old.wait();
                return true;
            }
        }
        false
    }
}

impl Drop for RaglightManager {
    fn drop(&mut self) {
        self.stop();
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RaglightConfig {
    pub enabled: bool,
    pub mode: String,
    pub base_url: String,
    pub api_key: String,
    pub provider: String,
    pub embedding_model: String,
    pub llm_model: String,
    pub vector_store: String,
    pub folders: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RaglightStatus {
    pub enabled: bool,
    pub mode: String,
    pub base_url: String,
    pub provider: String,
    pub embedding_model: String,
    pub llm_model: String,
    pub vector_store: String,
    pub folders: Vec<String>,
    pub has_api_key: bool,
    pub installed: bool,
    pub running: bool,
    pub managed_pid: Option<u32>,
    pub venv_path: String,
    pub db_path: String,
    pub python_tool: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RaglightActionResult {
    pub ok: bool,
    pub message: String,
    pub output_tail: String,
    pub status: RaglightStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RaglightQueryResult {
    pub answer: String,
    #[serde(default)]
    pub sources: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeDocumentEntry {
    pub id: String,
    pub title: String,
    pub source_path: Option<String>,
    pub status: String,
    pub content_preview: String,
    pub content_length: usize,
    pub chunks_count: u64,
    pub entities: Vec<String>,
    pub updated_at: Option<String>,
    pub origin: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeDocumentDetail {
    pub id: String,
    pub title: String,
    pub source_path: Option<String>,
    pub content: String,
    pub status: String,
    pub entities: Vec<String>,
    pub relations: Vec<KnowledgeRelationEntry>,
    pub origin: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeEntityEntry {
    pub id: String,
    pub name: String,
    pub entity_type: String,
    pub description: String,
    pub source_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeRelationEntry {
    pub id: String,
    pub source: String,
    pub target: String,
    pub description: String,
    pub keywords: Vec<String>,
    pub weight: f64,
    pub source_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeExplorerOverview {
    pub service_kind: String,
    pub online: bool,
    pub base_url: String,
    pub documents_count: usize,
    pub entities_count: usize,
    pub relations_count: usize,
    pub configured_folders: Vec<String>,
    pub local_file_count: usize,
    pub status_counts: std::collections::BTreeMap<String, u64>,
    pub diagnostic_message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeDocumentsResult {
    pub service_kind: String,
    pub online: bool,
    pub documents: Vec<KnowledgeDocumentEntry>,
    pub diagnostic_message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeGraphPayload {
    pub service_kind: String,
    pub online: bool,
    pub entities: Vec<KnowledgeEntityEntry>,
    pub relations: Vec<KnowledgeRelationEntry>,
    pub diagnostic_message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeSearchResult {
    pub service_kind: String,
    pub online: bool,
    pub answer: String,
    pub sources: Vec<String>,
    pub matching_documents: Vec<KnowledgeDocumentEntry>,
    pub matching_entities: Vec<KnowledgeEntityEntry>,
    pub matching_relations: Vec<KnowledgeRelationEntry>,
    pub diagnostic_message: Option<String>,
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

fn read_bool(settings: &SettingsService, key: SettingsKey, default: bool) -> bool {
    settings
        .get(key)
        .ok()
        .flatten()
        .and_then(|v| v.as_bool())
        .unwrap_or(default)
}

/// Parse semicolon- or newline-separated folder list into trimmed non-empty paths.
pub fn parse_folder_list(raw: &str) -> Vec<String> {
    raw.split([';', '\n'])
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .collect()
}

pub fn load_config(db: &Db) -> RaglightConfig {
    let settings = SettingsService::new(db);
    let folders_raw = read_str(&settings, SettingsKey::RaglightFolders, "");
    let mut config = RaglightConfig {
        enabled: read_bool(&settings, SettingsKey::RaglightEnabled, false),
        mode: read_str(&settings, SettingsKey::RaglightMode, "managed_local"),
        base_url: read_str(
            &settings,
            SettingsKey::RaglightBaseUrl,
            "http://127.0.0.1:8000",
        ),
        api_key: read_str(&settings, SettingsKey::RaglightApiKey, ""),
        provider: read_str(&settings, SettingsKey::RaglightProvider, "ollama"),
        embedding_model: read_str(
            &settings,
            SettingsKey::RaglightEmbeddingModel,
            "nomic-embed-text",
        ),
        llm_model: read_str(&settings, SettingsKey::RaglightLlmModel, "qwen3:0.6b"),
        vector_store: read_str(&settings, SettingsKey::RaglightVectorStore, "chroma"),
        folders: parse_folder_list(&folders_raw),
    };
    apply_env_overrides(&mut config, &settings);
    config
}

/// Reads a value from the environment, ignoring an empty one.
fn env_str(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

/// Reads a boolean from the environment.
fn env_bool(name: &str) -> Option<bool> {
    env_str(name).map(|v| {
        matches!(
            v.to_ascii_lowercase().as_str(),
            "1" | "true" | "yes" | "on"
        )
    })
}

/// The stored value of a setting, or `None` when it was never written.
fn stored_str(settings: &SettingsService, key: SettingsKey) -> Option<String> {
    settings
        .get(key)
        .ok()
        .flatten()
        .and_then(|v| v.as_str().map(|s| s.trim().to_string()))
        .filter(|s| !s.is_empty())
}

/// The stored value of a boolean setting, or `None` when it was never written.
fn stored_bool(settings: &SettingsService, key: SettingsKey) -> Option<bool> {
    settings.get(key).ok().flatten().and_then(|v| v.as_bool())
}

/// Replaces a string setting with the environment value, but only while the
/// stored value still is the built-in default.
///
/// The migration seeds every setting with its default, so "was it changed?"
/// can only be answered by comparing with that default — and that is the
/// right question anyway: the installation declares the service until the
/// reader overrides it by hand.
fn override_str(
    target: &mut String,
    settings: &SettingsService,
    key: SettingsKey,
    default: &str,
    env_name: &str,
) {
    let stored = stored_str(settings, key).unwrap_or_else(|| default.to_string());
    if stored != default {
        return;
    }
    if let Some(value) = env_str(env_name) {
        *target = value;
    }
}

/// The boolean counterpart of [`override_str`].
fn override_bool(
    target: &mut bool,
    settings: &SettingsService,
    key: SettingsKey,
    default: bool,
    env_name: &str,
) {
    let stored = stored_bool(settings, key).unwrap_or(default);
    if stored != default {
        return;
    }
    if let Some(value) = env_bool(env_name) {
        *target = value;
    }
}

/// Applies the environment overrides on top of the stored settings.
///
/// This is how a NixOS installation declares the knowledge service: the
/// flake writes `AURADESK_RAGLIGHT_*` into the session and the app picks
/// them up.
///
/// The machine's declaration wins only while the reader has not said
/// otherwise: a setting that still holds its built-in default is replaced
/// by the environment, and one that was changed by hand is left alone.
pub fn apply_env_overrides(config: &mut RaglightConfig, settings: &SettingsService) {
    override_bool(
        &mut config.enabled,
        settings,
        SettingsKey::RaglightEnabled,
        false,
        "AURADESK_RAGLIGHT_ENABLED",
    );
    override_str(
        &mut config.base_url,
        settings,
        SettingsKey::RaglightBaseUrl,
        "http://127.0.0.1:8000",
        "AURADESK_RAGLIGHT_BASE_URL",
    );
    override_str(
        &mut config.provider,
        settings,
        SettingsKey::RaglightProvider,
        "ollama",
        "AURADESK_RAGLIGHT_PROVIDER",
    );
    override_str(
        &mut config.vector_store,
        settings,
        SettingsKey::RaglightVectorStore,
        "chroma",
        "AURADESK_RAGLIGHT_VECTOR_STORE",
    );
    override_str(
        &mut config.embedding_model,
        settings,
        SettingsKey::RaglightEmbeddingModel,
        "nomic-embed-text",
        "AURADESK_RAGLIGHT_EMBEDDING_MODEL",
    );
    override_str(
        &mut config.llm_model,
        settings,
        SettingsKey::RaglightLlmModel,
        "qwen3:0.6b",
        "AURADESK_RAGLIGHT_LLM_MODEL",
    );
    override_str(
        &mut config.api_key,
        settings,
        SettingsKey::RaglightApiKey,
        "",
        "AURADESK_RAGLIGHT_API_KEY",
    );
    if !config.folders.is_empty() {
        return;
    }
    if let Some(value) = env_str("AURADESK_RAGLIGHT_FOLDERS") {
        let folders = parse_folder_list(&value);
        if !folders.is_empty() {
            config.folders = folders;
        }
    }
}

pub fn raglight_root(data_dir: &Path) -> PathBuf {
    data_dir.join("raglight")
}

pub fn venv_python_path(data_dir: &Path) -> PathBuf {
    let venv = raglight_root(data_dir).join(".venv");
    #[cfg(target_os = "windows")]
    {
        venv.join("Scripts").join("python.exe")
    }
    #[cfg(not(target_os = "windows"))]
    {
        venv.join("bin").join("python")
    }
}

fn venv_pip_path(data_dir: &Path) -> PathBuf {
    let venv = raglight_root(data_dir).join(".venv");
    #[cfg(target_os = "windows")]
    {
        venv.join("Scripts").join("pip.exe")
    }
    #[cfg(not(target_os = "windows"))]
    {
        venv.join("bin").join("pip")
    }
}

fn find_in_path(names: &[&str]) -> Option<String> {
    let path_env = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path_env) {
        for name in names {
            let full = dir.join(name);
            if full.is_file() {
                return Some((*name).to_string());
            }
        }
    }
    None
}

fn detect_python_tool() -> Option<String> {
    #[cfg(target_os = "windows")]
    let candidates = ["uv.exe", "uv", "python.exe", "python3.exe", "py.exe"];
    #[cfg(not(target_os = "windows"))]
    let candidates = ["uv", "python3", "python"];

    find_in_path(&candidates)
}

fn check_health(base_url: &str, api_key: &str) -> bool {
    let client = match reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
    {
        Ok(c) => c,
        Err(_) => return false,
    };
    let trimmed = base_url.trim_end_matches('/');
    for path in ["/health", "/docs"] {
        let mut req = client.get(format!("{trimmed}{path}"));
        if !api_key.is_empty() {
            req = req.bearer_auth(api_key);
        }
        if let Ok(resp) = req.send() {
            if resp.status().is_success() {
                return true;
            }
        }
    }
    false
}

/// Inspect current RAGLight installation, configuration, and server reachability.
pub fn status(db: &Db, data_dir: &Path, manager: &RaglightManager) -> RaglightStatus {
    let cfg = load_config(db);
    let root = raglight_root(data_dir);
    let venv = root.join(".venv");
    let db_path = root.join("db");
    let installed = venv_python_path(data_dir).is_file() && root.join("server.py").is_file();
    let managed_pid = manager.managed_pid();
    let running = check_health(&cfg.base_url, &cfg.api_key);

    RaglightStatus {
        enabled: cfg.enabled,
        mode: cfg.mode,
        base_url: cfg.base_url,
        provider: cfg.provider,
        embedding_model: cfg.embedding_model,
        llm_model: cfg.llm_model,
        vector_store: cfg.vector_store,
        folders: cfg.folders,
        has_api_key: !cfg.api_key.is_empty(),
        installed,
        running,
        managed_pid,
        venv_path: venv.display().to_string(),
        db_path: db_path.display().to_string(),
        python_tool: detect_python_tool(),
    }
}

/// Write `raglight_config.json` and the managed FastAPI + RAGLight `server.py` bridge.
pub fn write_managed_files(cfg: &RaglightConfig, data_dir: &Path) -> Result<PathBuf, String> {
    let root = raglight_root(data_dir);
    let db_dir = root.join("db");
    fs::create_dir_all(&db_dir).map_err(|e| format!("raglight_mkdir: {e}"))?;

    let config_json = serde_json::json!({
        "provider": cfg.provider,
        "embedding_model": cfg.embedding_model,
        "llm_model": cfg.llm_model,
        "vector_store": cfg.vector_store,
        "persist_directory": db_dir.display().to_string(),
        "folders": cfg.folders,
        "base_url": cfg.base_url,
    });
    let cfg_path = root.join("raglight_config.json");
    fs::write(
        &cfg_path,
        serde_json::to_string_pretty(&config_json).unwrap_or_default(),
    )
    .map_err(|e| format!("raglight_write_config: {e}"))?;

    let server_path = root.join("server.py");
    fs::write(&server_path, MANAGED_SERVER_PY)
        .map_err(|e| format!("raglight_write_server: {e}"))?;

    Ok(root)
}

/// Provision the isolated Python virtual environment, install `raglight` + FastAPI/Uvicorn,
/// and write the managed server files under `<data_dir>/raglight/`.
pub fn provision_and_install(
    db: &Db,
    data_dir: &Path,
    manager: &RaglightManager,
) -> Result<RaglightActionResult, String> {
    let cfg = load_config(db);
    let root = write_managed_files(&cfg, data_dir)?;
    let venv_dir = root.join(".venv");

    let mut logs = Vec::new();
    let uv_bin = find_in_path(&["uv", "uv.exe"]);

    let extras = match cfg.vector_store.as_str() {
        "qdrant" => "raglight[qdrant,ollama,documents]",
        _ => "raglight[chroma,ollama,documents]",
    };

    if let Some(uv) = uv_bin {
        let out_venv = Command::new(&uv)
            .args(["venv", &venv_dir.display().to_string()])
            .output()
            .map_err(|e| format!("uv_venv_spawn: {e}"))?;
        logs.push(String::from_utf8_lossy(&out_venv.stdout).to_string());
        logs.push(String::from_utf8_lossy(&out_venv.stderr).to_string());
        if !out_venv.status.success() {
            return Ok(RaglightActionResult {
                ok: false,
                message: "uv_venv_failed".to_string(),
                output_tail: tail_text(&logs.join("\n"), 1200),
                status: status(db, data_dir, manager),
            });
        }

        let py = venv_python_path(data_dir);
        let out_pip = Command::new(&uv)
            .args([
                "pip",
                "install",
                "--python",
                &py.display().to_string(),
                extras,
                "fastapi",
                "uvicorn",
            ])
            .output()
            .map_err(|e| format!("uv_pip_spawn: {e}"))?;
        logs.push(String::from_utf8_lossy(&out_pip.stdout).to_string());
        logs.push(String::from_utf8_lossy(&out_pip.stderr).to_string());
        let ok = out_pip.status.success();
        return Ok(RaglightActionResult {
            ok,
            message: if ok {
                "raglight_provisioned".to_string()
            } else {
                "uv_pip_install_failed".to_string()
            },
            output_tail: tail_text(&logs.join("\n"), 1200),
            status: status(db, data_dir, manager),
        });
    }

    let py_sys = find_in_path(&["python3", "python", "python.exe", "py.exe"])
        .ok_or_else(|| "python_or_uv_not_found".to_string())?;

    let out_venv = Command::new(&py_sys)
        .args(["-m", "venv", &venv_dir.display().to_string()])
        .output()
        .map_err(|e| format!("python_venv_spawn: {e}"))?;
    logs.push(String::from_utf8_lossy(&out_venv.stdout).to_string());
    logs.push(String::from_utf8_lossy(&out_venv.stderr).to_string());
    if !out_venv.status.success() {
        return Ok(RaglightActionResult {
            ok: false,
            message: "python_venv_failed".to_string(),
            output_tail: tail_text(&logs.join("\n"), 1200),
            status: status(db, data_dir, manager),
        });
    }

    let pip = venv_pip_path(data_dir);
    let out_pip = Command::new(&pip)
        .args(["install", "--upgrade", extras, "fastapi", "uvicorn"])
        .output()
        .map_err(|e| format!("pip_install_spawn: {e}"))?;
    logs.push(String::from_utf8_lossy(&out_pip.stdout).to_string());
    logs.push(String::from_utf8_lossy(&out_pip.stderr).to_string());
    let ok = out_pip.status.success();

    Ok(RaglightActionResult {
        ok,
        message: if ok {
            "raglight_provisioned".to_string()
        } else {
            "pip_install_failed".to_string()
        },
        output_tail: tail_text(&logs.join("\n"), 1200),
        status: status(db, data_dir, manager),
    })
}

/// Start the AuraDesk-managed local RAGLight FastAPI server.
pub fn start_server(
    db: &Db,
    data_dir: &Path,
    manager: &RaglightManager,
) -> Result<RaglightActionResult, String> {
    let cfg = load_config(db);
    let root = write_managed_files(&cfg, data_dir)?;
    let py = venv_python_path(data_dir);
    if !py.is_file() {
        return Err("raglight_not_installed".to_string());
    }

    let port = extract_port(&cfg.base_url).unwrap_or(8000);
    let mut cmd = Command::new(&py);
    cmd.arg(root.join("server.py"))
        .env("RAGLIGHT_CONFIG", root.join("raglight_config.json"))
        .env("RAGLIGHT_PORT", port.to_string())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    if !cfg.api_key.is_empty() {
        cmd.env("RAGLIGHT_API_KEY", &cfg.api_key);
        match cfg.provider.as_str() {
            "openai" => {
                cmd.env("OPENAI_API_KEY", &cfg.api_key);
            }
            "gemini" => {
                cmd.env("GEMINI_API_KEY", &cfg.api_key);
                cmd.env("GOOGLE_API_KEY", &cfg.api_key);
            }
            "mistral" => {
                cmd.env("MISTRAL_API_KEY", &cfg.api_key);
            }
            _ => {}
        }
    }

    let child = cmd
        .spawn()
        .map_err(|e| format!("raglight_spawn_failed: {e}"))?;
    manager.set_child(child);

    // Brief health probe loop (up to 6s) so UI sees `running: true` immediately when ready.
    let mut ready = false;
    for _ in 0..12 {
        std::thread::sleep(Duration::from_millis(500));
        if check_health(&cfg.base_url, &cfg.api_key) {
            ready = true;
            break;
        }
    }

    Ok(RaglightActionResult {
        ok: true,
        message: if ready {
            "raglight_started".to_string()
        } else {
            "raglight_starting".to_string()
        },
        output_tail: String::new(),
        status: status(db, data_dir, manager),
    })
}

/// Stop the AuraDesk-managed local RAGLight server if running.
pub fn stop_server(db: &Db, data_dir: &Path, manager: &RaglightManager) -> RaglightActionResult {
    let stopped = manager.stop();
    RaglightActionResult {
        ok: true,
        message: if stopped {
            "raglight_stopped".to_string()
        } else {
            "raglight_not_running".to_string()
        },
        output_tail: String::new(),
        status: status(db, data_dir, manager),
    }
}

/// Trigger folder ingestion against the active RAGLight server (`POST /ingest`).
pub fn ingest_folders(
    db: &Db,
    data_dir: &Path,
    manager: &RaglightManager,
) -> Result<RaglightActionResult, String> {
    let cfg = load_config(db);
    if cfg.folders.is_empty() {
        return Err("raglight_no_folders_configured".to_string());
    }
    let _ = write_managed_files(&cfg, data_dir);

    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(300))
        .build()
        .map_err(|e| format!("raglight_http_client: {e}"))?;

    let url = format!("{}/ingest", cfg.base_url.trim_end_matches('/'));
    let mut req = client.post(&url).json(&serde_json::json!({
        "folders": cfg.folders,
    }));
    if !cfg.api_key.is_empty() {
        req = req.bearer_auth(&cfg.api_key);
    }

    let resp = req
        .send()
        .map_err(|e| format!("raglight_ingest_request: {e}"))?;
    let ok = resp.status().is_success();
    let body = resp.text().unwrap_or_default();

    Ok(RaglightActionResult {
        ok,
        message: if ok {
            "raglight_ingested".to_string()
        } else {
            "raglight_ingest_failed".to_string()
        },
        output_tail: tail_text(&body, 1200),
        status: status(db, data_dir, manager),
    })
}

/// Query the configured RAGLight server (`POST /query`).
pub fn query(db: &Db, prompt: &str, top_k: usize) -> Result<RaglightQueryResult, String> {
    let cfg = load_config(db);
    let trimmed = prompt.trim();
    if trimmed.is_empty() {
        return Err("raglight_empty_query".to_string());
    }

    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| format!("raglight_http_client: {e}"))?;

    let url = format!("{}/query", cfg.base_url.trim_end_matches('/'));
    let mut req = client.post(&url).json(&serde_json::json!({
        "question": trimmed,
        "query": trimmed,
        "top_k": top_k.clamp(1, 20),
    }));
    if !cfg.api_key.is_empty() {
        req = req.bearer_auth(&cfg.api_key);
    }

    let resp = req
        .send()
        .map_err(|e| format!("raglight_query_request: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("raglight_http_{}", resp.status().as_u16()));
    }
    let val: serde_json::Value = resp
        .json()
        .map_err(|e| format!("raglight_query_json: {e}"))?;

    let answer = val
        .get("answer")
        .or_else(|| val.get("response"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();

    let sources = val
        .get("sources")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|item| {
                    item.as_str().map(str::to_string).or_else(|| {
                        item.get("source")
                            .or_else(|| item.get("path"))
                            .and_then(|s| s.as_str())
                            .map(str::to_string)
                    })
                })
                .collect()
        })
        .unwrap_or_default();

    Ok(RaglightQueryResult { answer, sources })
}

/// Optional fast retrieval helper used by Aura's AI orchestrator when `raglight.enabled == true`.
pub fn query_context_for_prompt(db: &Db, prompt: &str) -> Option<String> {
    let cfg = load_config(db);
    if !cfg.enabled {
        return None;
    }
    let res = query(db, prompt, 5).ok()?;
    if res.answer.is_empty() && res.sources.is_empty() {
        return None;
    }
    let mut out = String::from("raglight_context:\n");
    if !res.answer.is_empty() {
        out.push_str(&res.answer);
        out.push('\n');
    }
    if !res.sources.is_empty() {
        out.push_str("sources: ");
        out.push_str(&res.sources.join(", "));
    }
    Some(out)
}

const MAX_LISTED_LOCAL_FILES: usize = 120;
const MAX_DOC_READ_BYTES: usize = 64 * 1024;
const SKIP_DIRS: [&str; 6] = [
    ".git",
    "node_modules",
    "target",
    ".venv",
    "__pycache__",
    "dist",
];

fn knowledge_http_client(timeout_secs: u64) -> Option<reqwest::blocking::Client> {
    reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(timeout_secs))
        .build()
        .ok()
}

fn authed_get(
    client: &reqwest::blocking::Client,
    url: &str,
    api_key: &str,
) -> Result<serde_json::Value, String> {
    let mut req = client.get(url);
    if !api_key.is_empty() {
        req = req.bearer_auth(api_key);
    }
    let resp = req.send().map_err(|e| format!("connection_error: {e}"))?;
    let status = resp.status();
    if !status.is_success() {
        return Err(format!("http_{}", status.as_u16()));
    }
    resp.json::<serde_json::Value>()
        .map_err(|e| format!("invalid_json: {e}"))
}

fn detect_knowledge_service(cfg: &RaglightConfig) -> (&'static str, bool, Option<String>) {
    let Some(client) = knowledge_http_client(2) else {
        return (
            "offline",
            false,
            Some("http_client_unavailable".to_string()),
        );
    };
    let trimmed = cfg.base_url.trim_end_matches('/');

    // Try LightRAG /health or /documents/status_counts vs AuraDesk managed /health
    if let Ok(val) = authed_get(&client, &format!("{trimmed}/health"), &cfg.api_key) {
        if val.get("core_version").is_some()
            || val.get("configuration").is_some()
            || val.get("pipeline_busy").is_some()
        {
            return ("lightrag", true, None);
        }
        return ("raglight_managed", true, None);
    }

    // Fallback check against official LightRAG status endpoint directly.
    if authed_get(
        &client,
        &format!("{trimmed}/documents/status_counts"),
        &cfg.api_key,
    )
    .is_ok()
    {
        return ("lightrag", true, None);
    }

    let reason = if cfg.folders.is_empty() {
        format!("service_offline ({})", cfg.base_url)
    } else {
        format!(
            "service_offline ({}; showing authorized local folders)",
            cfg.base_url
        )
    };
    ("offline", false, Some(reason))
}

fn is_text_or_doc_extension(path: &Path) -> bool {
    let Some(ext) = path.extension().and_then(|e| e.to_str()) else {
        return false;
    };
    matches!(
        ext.to_ascii_lowercase().as_str(),
        "md" | "txt"
            | "rs"
            | "ts"
            | "tsx"
            | "js"
            | "jsx"
            | "py"
            | "json"
            | "toml"
            | "yaml"
            | "yml"
            | "sql"
            | "csv"
            | "log"
            | "html"
            | "css"
            | "pdf"
            | "docx"
    )
}

fn walk_authorized_dir(dir: &Path, out: &mut Vec<PathBuf>, max_items: usize, depth: usize) {
    if out.len() >= max_items || depth > 5 {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        if out.len() >= max_items {
            break;
        }
        let path = entry.path();
        if path.is_dir() {
            if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                if SKIP_DIRS.contains(&name) || name.starts_with('.') {
                    continue;
                }
            }
            walk_authorized_dir(&path, out, max_items, depth + 1);
        } else if path.is_file() && is_text_or_doc_extension(&path) {
            out.push(path);
        }
    }
}

fn enumerate_authorized_files(folders: &[String]) -> Vec<KnowledgeDocumentEntry> {
    let mut paths = Vec::new();
    for folder in folders {
        let p = PathBuf::from(folder);
        if p.is_dir() {
            walk_authorized_dir(&p, &mut paths, MAX_LISTED_LOCAL_FILES, 0);
        }
    }
    paths
        .into_iter()
        .map(|p| {
            let full_str = p.display().to_string();
            let title = p
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or(&full_str)
                .to_string();
            let meta = fs::metadata(&p).ok();
            let len = meta.as_ref().map(|m| m.len() as usize).unwrap_or(0);
            let updated_at = meta
                .and_then(|m| m.modified().ok())
                .map(|st| chrono::DateTime::<chrono::Utc>::from(st).to_rfc3339());
            let preview = read_bounded_preview(&p, 200);
            KnowledgeDocumentEntry {
                id: format!("local:{full_str}"),
                title,
                source_path: Some(full_str),
                status: "authorized_folder".to_string(),
                content_preview: preview,
                content_length: len,
                chunks_count: 0,
                entities: Vec::new(),
                updated_at,
                origin: "local_folder".to_string(),
            }
        })
        .collect()
}

fn read_bounded_preview(path: &Path, max_chars: usize) -> String {
    let Ok(bytes) = fs::read(path) else {
        return String::new();
    };
    let slice = if bytes.len() > 2048 {
        &bytes[..2048]
    } else {
        &bytes[..]
    };
    let lossy = String::from_utf8_lossy(slice);
    let collapsed = lossy.split_whitespace().collect::<Vec<_>>().join(" ");
    collapsed.chars().take(max_chars).collect()
}

/// Read an authorized file strictly constrained within `folders` (prevents path traversal).
pub fn read_authorized_file(folders: &[String], requested_path: &str) -> Result<String, String> {
    let target =
        fs::canonicalize(Path::new(requested_path)).map_err(|e| format!("file_not_found: {e}"))?;
    let mut allowed = false;
    for root_raw in folders {
        if let Ok(root_canon) = fs::canonicalize(Path::new(root_raw)) {
            if target.starts_with(&root_canon) {
                allowed = true;
                break;
            }
        }
    }
    if !allowed {
        return Err("access_denied: path outside authorized raglight folders".to_string());
    }
    let bytes = fs::read(&target).map_err(|e| format!("read_error: {e}"))?;
    let capped = if bytes.len() > MAX_DOC_READ_BYTES {
        &bytes[..MAX_DOC_READ_BYTES]
    } else {
        &bytes[..]
    };
    Ok(String::from_utf8_lossy(capped).to_string())
}

fn parse_lightrag_documents(val: &serde_json::Value) -> Vec<KnowledgeDocumentEntry> {
    let mut out = Vec::new();
    // LightRAG /documents can return { statuses: { processed: [...], ... } } or { documents: [...] } or an array.
    if let Some(statuses) = val.get("statuses").and_then(|v| v.as_object()) {
        for (status_name, arr_val) in statuses {
            if let Some(items) = arr_val.as_array() {
                for item in items {
                    if let Some(doc) = normalize_remote_doc(item, status_name, "lightrag") {
                        out.push(doc);
                    }
                }
            }
        }
        return out;
    }

    let arr = val
        .get("documents")
        .or_else(|| val.get("items"))
        .and_then(|v| v.as_array())
        .or_else(|| val.as_array());
    if let Some(items) = arr {
        for item in items {
            if let Some(doc) = normalize_remote_doc(item, "indexed", "remote") {
                out.push(doc);
            }
        }
    }
    out
}

fn normalize_remote_doc(
    item: &serde_json::Value,
    default_status: &str,
    default_origin: &str,
) -> Option<KnowledgeDocumentEntry> {
    let id = item
        .get("id")
        .or_else(|| item.get("doc_id"))
        .or_else(|| item.get("file_path"))
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())?
        .to_string();
    let source_path = item
        .get("file_path")
        .or_else(|| item.get("source"))
        .and_then(|v| v.as_str())
        .map(str::to_string);
    let title = item
        .get("title")
        .or_else(|| item.get("file_path"))
        .and_then(|v| v.as_str())
        .map(|s| {
            Path::new(s)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or(s)
                .to_string()
        })
        .unwrap_or_else(|| id.clone());
    let summary = item
        .get("content_summary")
        .or_else(|| item.get("content_preview"))
        .or_else(|| item.get("content"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let content_length = item
        .get("content_length")
        .and_then(|v| v.as_u64())
        .unwrap_or(summary.len() as u64) as usize;
    let chunks_count = item
        .get("chunks_count")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    let status = item
        .get("status")
        .and_then(|v| v.as_str())
        .unwrap_or(default_status)
        .to_string();
    let updated_at = item
        .get("updated_at")
        .or_else(|| item.get("created_at"))
        .and_then(|v| v.as_str())
        .map(str::to_string);
    let entities = item
        .get("entities")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|e| e.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default();

    Some(KnowledgeDocumentEntry {
        id,
        title,
        source_path,
        status,
        content_preview: summary.chars().take(220).collect(),
        content_length,
        chunks_count,
        entities,
        updated_at,
        origin: default_origin.to_string(),
    })
}

fn parse_remote_graph(
    val: &serde_json::Value,
) -> (Vec<KnowledgeEntityEntry>, Vec<KnowledgeRelationEntry>) {
    let mut entities = Vec::new();
    let mut relations = Vec::new();

    if let Some(nodes) = val.get("nodes").and_then(|v| v.as_array()) {
        for node in nodes {
            let props = node.get("properties").unwrap_or(node);
            let id = node
                .get("id")
                .or_else(|| props.get("entity_id"))
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();
            if id.is_empty() {
                continue;
            }
            let name = node
                .get("labels")
                .and_then(|l| l.as_array())
                .and_then(|a| a.first())
                .and_then(|s| s.as_str())
                .or_else(|| node.get("label").and_then(|v| v.as_str()))
                .or_else(|| props.get("entity_id").and_then(|v| v.as_str()))
                .unwrap_or(&id)
                .to_string();
            let entity_type = props
                .get("entity_type")
                .or_else(|| node.get("entity_type"))
                .and_then(|v| v.as_str())
                .unwrap_or("concept")
                .to_string();
            let description = props
                .get("description")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let source_id = props
                .get("source_id")
                .and_then(|v| v.as_str())
                .map(str::to_string);
            entities.push(KnowledgeEntityEntry {
                id,
                name,
                entity_type,
                description,
                source_id,
            });
        }
    }

    if let Some(edges) = val.get("edges").and_then(|v| v.as_array()) {
        for (idx, edge) in edges.iter().enumerate() {
            let props = edge.get("properties").unwrap_or(edge);
            let source = edge
                .get("source")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();
            let target = edge
                .get("target")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();
            if source.is_empty() || target.is_empty() {
                continue;
            }
            let id = edge
                .get("id")
                .and_then(|v| v.as_str())
                .map(str::to_string)
                .unwrap_or_else(|| format!("rel-{idx}"));
            let description = props
                .get("description")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let keywords = props
                .get("keywords")
                .and_then(|v| v.as_str())
                .map(|s| {
                    s.split(',')
                        .map(str::trim)
                        .filter(|k| !k.is_empty())
                        .map(str::to_string)
                        .collect()
                })
                .or_else(|| {
                    props.get("keywords").and_then(|v| v.as_array()).map(|arr| {
                        arr.iter()
                            .filter_map(|x| x.as_str().map(str::to_string))
                            .collect()
                    })
                })
                .unwrap_or_default();
            let weight = props.get("weight").and_then(|v| v.as_f64()).unwrap_or(1.0);
            let source_id = props
                .get("source_id")
                .and_then(|v| v.as_str())
                .map(str::to_string);

            relations.push(KnowledgeRelationEntry {
                id,
                source,
                target,
                description,
                keywords,
                weight,
                source_id,
            });
        }
    }

    (entities, relations)
}

/// Real status & statistics overview for LightRAG / RAGLight (no fake rows when offline).
pub fn knowledge_overview(
    db: &Db,
    _data_dir: &Path,
    _manager: &RaglightManager,
) -> KnowledgeExplorerOverview {
    let cfg = load_config(db);
    let (service_kind, online, diagnostic_message) = detect_knowledge_service(&cfg);
    let local_files = enumerate_authorized_files(&cfg.folders);

    let mut status_counts = std::collections::BTreeMap::new();
    let mut documents_count = local_files.len();
    let mut entities_count = 0usize;
    let mut relations_count = 0usize;

    if online {
        if let Some(client) = knowledge_http_client(4) {
            let trimmed = cfg.base_url.trim_end_matches('/');
            if service_kind == "lightrag" {
                if let Ok(sc) = authed_get(
                    &client,
                    &format!("{trimmed}/documents/status_counts"),
                    &cfg.api_key,
                ) {
                    if let Some(obj) = sc.get("status_counts").and_then(|v| v.as_object()) {
                        let mut remote_total = 0u64;
                        for (k, v) in obj {
                            let c = v.as_u64().unwrap_or(0);
                            status_counts.insert(k.clone(), c);
                            if k != "all" {
                                remote_total += c;
                            }
                        }
                        documents_count =
                            sc.pointer("/status_counts/all")
                                .and_then(|v| v.as_u64())
                                .unwrap_or(remote_total) as usize;
                    }
                }
                if let Ok(gr) = authed_get(
                    &client,
                    &format!("{trimmed}/graphs?label=*&max_depth=2"),
                    &cfg.api_key,
                ) {
                    let (ents, rels) = parse_remote_graph(&gr);
                    entities_count = ents.len();
                    relations_count = rels.len();
                }
            } else {
                if let Ok(docs_val) =
                    authed_get(&client, &format!("{trimmed}/documents"), &cfg.api_key)
                {
                    let docs = parse_lightrag_documents(&docs_val);
                    if !docs.is_empty() {
                        documents_count = docs.len();
                    }
                }
                if let Ok(gr) = authed_get(&client, &format!("{trimmed}/graph"), &cfg.api_key) {
                    let (ents, rels) = parse_remote_graph(&gr);
                    entities_count = ents.len();
                    relations_count = rels.len();
                }
            }
        }
    }

    KnowledgeExplorerOverview {
        service_kind: service_kind.to_string(),
        online,
        base_url: cfg.base_url,
        documents_count,
        entities_count,
        relations_count,
        configured_folders: cfg.folders,
        local_file_count: local_files.len(),
        status_counts,
        diagnostic_message,
    }
}

/// List real documents indexed by LightRAG/RAGLight plus files inside configured local folders.
pub fn knowledge_documents_list(
    db: &Db,
    query: Option<&str>,
    limit: Option<usize>,
) -> KnowledgeDocumentsResult {
    let cfg = load_config(db);
    let (service_kind, online, diagnostic_message) = detect_knowledge_service(&cfg);
    let max_items = limit.unwrap_or(80).clamp(1, 200);
    let q = query
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_ascii_lowercase());

    let mut documents = Vec::new();
    if online {
        if let Some(client) = knowledge_http_client(5) {
            let trimmed = cfg.base_url.trim_end_matches('/');
            if let Ok(val) = authed_get(&client, &format!("{trimmed}/documents"), &cfg.api_key) {
                documents.extend(parse_lightrag_documents(&val));
            }
        }
    }

    let mut seen_paths: std::collections::HashSet<String> = documents
        .iter()
        .filter_map(|d| d.source_path.clone())
        .collect();
    for local_doc in enumerate_authorized_files(&cfg.folders) {
        if let Some(ref sp) = local_doc.source_path {
            if seen_paths.contains(sp) {
                continue;
            }
            seen_paths.insert(sp.clone());
        }
        documents.push(local_doc);
    }

    if let Some(ref needle) = q {
        documents.retain(|d| {
            d.title.to_ascii_lowercase().contains(needle)
                || d.id.to_ascii_lowercase().contains(needle)
                || d.content_preview.to_ascii_lowercase().contains(needle)
                || d.source_path
                    .as_deref()
                    .unwrap_or("")
                    .to_ascii_lowercase()
                    .contains(needle)
        });
    }
    documents.truncate(max_items);

    KnowledgeDocumentsResult {
        service_kind: service_kind.to_string(),
        online,
        documents,
        diagnostic_message,
    }
}

/// Inspect one real LightRAG/RAGLight document or authorized file content safely.
pub fn knowledge_document_get(db: &Db, doc_id: &str) -> Result<KnowledgeDocumentDetail, String> {
    let cfg = load_config(db);
    let clean_id = doc_id.trim();
    if clean_id.is_empty() {
        return Err("doc_id cannot be empty".to_string());
    }

    if let Some(raw_path) = clean_id.strip_prefix("local:") {
        let content = read_authorized_file(&cfg.folders, raw_path)?;
        let title = Path::new(raw_path)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or(raw_path)
            .to_string();
        return Ok(KnowledgeDocumentDetail {
            id: clean_id.to_string(),
            title,
            source_path: Some(raw_path.to_string()),
            content,
            status: "authorized_folder".to_string(),
            entities: Vec::new(),
            relations: Vec::new(),
            origin: "local_folder".to_string(),
        });
    }

    let (service_kind, online, diag) = detect_knowledge_service(&cfg);
    if online {
        if let Some(client) = knowledge_http_client(6) {
            let trimmed = cfg.base_url.trim_end_matches('/');
            let docs = authed_get(&client, &format!("{trimmed}/documents"), &cfg.api_key)
                .map(|v| parse_lightrag_documents(&v))
                .unwrap_or_default();
            let graph = knowledge_graph(db, None, None, Some(150));
            if let Some(found) = docs.iter().find(|d| d.id == clean_id) {
                let mut content = found.content_preview.clone();
                if service_kind == "raglight_managed" {
                    if let Ok(detail_val) = authed_get(
                        &client,
                        &format!("{trimmed}/documents/{}", clean_id),
                        &cfg.api_key,
                    ) {
                        if let Some(full) = detail_val.get("content").and_then(|v| v.as_str()) {
                            content = full.to_string();
                        }
                    }
                } else if let Some(ref sp) = found.source_path {
                    if let Ok(local_text) = read_authorized_file(&cfg.folders, sp) {
                        content = local_text;
                    }
                }
                let matched_entities: Vec<String> = graph
                    .entities
                    .iter()
                    .filter(|e| {
                        e.source_id.as_deref() == Some(clean_id) || content.contains(&e.name)
                    })
                    .map(|e| e.name.clone())
                    .take(30)
                    .collect();
                let matched_relations: Vec<KnowledgeRelationEntry> = graph
                    .relations
                    .into_iter()
                    .filter(|r| {
                        r.source_id.as_deref() == Some(clean_id)
                            || matched_entities.contains(&r.source)
                            || matched_entities.contains(&r.target)
                    })
                    .take(30)
                    .collect();

                return Ok(KnowledgeDocumentDetail {
                    id: found.id.clone(),
                    title: found.title.clone(),
                    source_path: found.source_path.clone(),
                    content,
                    status: found.status.clone(),
                    entities: matched_entities,
                    relations: matched_relations,
                    origin: found.origin.clone(),
                });
            }
        }
    }

    Err(diag.unwrap_or_else(|| format!("document_not_found: {clean_id}")))
}

/// Fetch real knowledge entities and relations from LightRAG `/graphs` or RAGLight `/graph`.
pub fn knowledge_graph(
    db: &Db,
    label: Option<&str>,
    query: Option<&str>,
    limit: Option<usize>,
) -> KnowledgeGraphPayload {
    let cfg = load_config(db);
    let (service_kind, online, diagnostic_message) = detect_knowledge_service(&cfg);
    let max_items = limit.unwrap_or(120).clamp(1, 300);
    let needle = query
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_ascii_lowercase());

    if !online {
        return KnowledgeGraphPayload {
            service_kind: service_kind.to_string(),
            online: false,
            entities: Vec::new(),
            relations: Vec::new(),
            diagnostic_message,
        };
    }

    let Some(client) = knowledge_http_client(6) else {
        return KnowledgeGraphPayload {
            service_kind: service_kind.to_string(),
            online: false,
            entities: Vec::new(),
            relations: Vec::new(),
            diagnostic_message: Some("http_client_unavailable".to_string()),
        };
    };

    let trimmed = cfg.base_url.trim_end_matches('/');
    let url = if service_kind == "lightrag" {
        let lbl = label
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or("*");
        format!("{trimmed}/graphs?label={lbl}&max_depth=2")
    } else {
        format!("{trimmed}/graph")
    };

    let (mut entities, mut relations) = match authed_get(&client, &url, &cfg.api_key) {
        Ok(val) => parse_remote_graph(&val),
        Err(err) => {
            return KnowledgeGraphPayload {
                service_kind: service_kind.to_string(),
                online: false,
                entities: Vec::new(),
                relations: Vec::new(),
                diagnostic_message: Some(err),
            };
        }
    };

    if let Some(ref q) = needle {
        entities.retain(|e| {
            e.name.to_ascii_lowercase().contains(q)
                || e.description.to_ascii_lowercase().contains(q)
                || e.entity_type.to_ascii_lowercase().contains(q)
        });
        relations.retain(|r| {
            r.source.to_ascii_lowercase().contains(q)
                || r.target.to_ascii_lowercase().contains(q)
                || r.description.to_ascii_lowercase().contains(q)
                || r.keywords
                    .iter()
                    .any(|k| k.to_ascii_lowercase().contains(q))
        });
    }

    entities.truncate(max_items);
    relations.truncate(max_items);

    KnowledgeGraphPayload {
        service_kind: service_kind.to_string(),
        online: true,
        entities,
        relations,
        diagnostic_message: None,
    }
}

/// Global search across documents, entities, relations, and semantic query response.
pub fn knowledge_search(db: &Db, query_text: &str, top_k: usize) -> KnowledgeSearchResult {
    let cfg = load_config(db);
    let (service_kind, online, diagnostic_message) = detect_knowledge_service(&cfg);
    let docs_res = knowledge_documents_list(db, Some(query_text), Some(top_k.max(10)));
    let graph_res = knowledge_graph(db, None, Some(query_text), Some(40));

    let mut answer = String::new();
    let mut sources = Vec::new();
    if online && !query_text.trim().is_empty() {
        if let Ok(qres) = query(db, query_text, top_k) {
            answer = qres.answer;
            sources = qres.sources;
        }
    }

    KnowledgeSearchResult {
        service_kind: service_kind.to_string(),
        online,
        answer,
        sources,
        matching_documents: docs_res.documents,
        matching_entities: graph_res.entities,
        matching_relations: graph_res.relations,
        diagnostic_message,
    }
}

fn extract_port(url: &str) -> Option<u16> {
    let without_scheme = url.split_once("://").map(|(_, rest)| rest).unwrap_or(url);
    let host_port = without_scheme.split('/').next()?;
    let (_, port_str) = host_port.rsplit_once(':')?;
    port_str.parse::<u16>().ok()
}

fn tail_text(s: &str, max_chars: usize) -> String {
    let trimmed = s.trim();
    if trimmed.chars().count() <= max_chars {
        return trimmed.to_string();
    }
    trimmed
        .chars()
        .rev()
        .take(max_chars)
        .collect::<String>()
        .chars()
        .rev()
        .collect()
}

const MANAGED_SERVER_PY: &str = r#"import json
import os
from pathlib import Path
from typing import List, Optional

from fastapi import FastAPI
from pydantic import BaseModel
import uvicorn

CONFIG_PATH = Path(os.environ.get("RAGLIGHT_CONFIG", "raglight_config.json"))
PORT = int(os.environ.get("RAGLIGHT_PORT", "8000"))

app = FastAPI(title="auradesk_raglight")
_pipeline = None


def load_cfg() -> dict:
    if CONFIG_PATH.exists():
        return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    return {}


def get_pipeline():
    global _pipeline
    if _pipeline is not None:
        return _pipeline

    cfg = load_cfg()
    provider = cfg.get("provider", "ollama")
    emb_model = cfg.get("embedding_model", "nomic-embed-text")
    llm_model = cfg.get("llm_model", "qwen3:0.6b")
    vector_store_kind = cfg.get("vector_store", "chroma")
    persist_dir = cfg.get("persist_directory", "./db")

    from raglight import RAGPipeline
    from raglight.integrations import default_registries

    if provider == "openai":
        from raglight.integrations.openai import OpenAIEmbeddings, OpenAILLM
        embeddings = OpenAIEmbeddings(model_name=emb_model)
        llm = OpenAILLM(model_name=llm_model)
    elif provider == "gemini":
        from raglight.integrations.google import GoogleEmbeddings, GoogleLLM
        embeddings = GoogleEmbeddings(model_name=emb_model)
        llm = GoogleLLM(model_name=llm_model)
    elif provider == "mistral":
        from raglight.integrations.mistral import MistralEmbeddings, MistralLLM
        embeddings = MistralEmbeddings(model_name=emb_model)
        llm = MistralLLM(model_name=llm_model)
    else:
        from raglight.integrations.ollama import OllamaEmbeddings, OllamaLLM
        embeddings = OllamaEmbeddings(model_name=emb_model)
        llm = OllamaLLM(model_name=llm_model)

    if vector_store_kind == "qdrant":
        from raglight.integrations.qdrant import QdrantVectorStore
        vector_store = QdrantVectorStore(
            collection_name="auradesk_files",
            embeddings_model=embeddings,
            persist_directory=persist_dir,
        )
    else:
        from raglight.integrations.chroma import ChromaVectorStore
        vector_store = ChromaVectorStore(
            collection_name="auradesk_files",
            embeddings_model=embeddings,
            persist_directory=persist_dir,
        )

    _pipeline = RAGPipeline(
        llm=llm,
        embeddings=embeddings,
        vector_store=vector_store,
        document_processors=default_registries.document_processors,
    )
    return _pipeline


class IngestRequest(BaseModel):
    folders: Optional[List[str]] = None


class QueryRequest(BaseModel):
    question: Optional[str] = None
    query: Optional[str] = None
    top_k: int = 5


@app.get("/health")
def health():
    return {"status": "ok", "config": load_cfg()}


@app.get("/documents")
def list_documents():
    cfg = load_cfg()
    docs = []
    for folder in cfg.get("folders") or []:
        p = Path(folder)
        if not p.is_dir():
            continue
        for file_path in p.rglob("*"):
            if file_path.is_file() and file_path.suffix.lower() in {".md", ".txt", ".py", ".rs", ".ts", ".tsx", ".json", ".pdf"}:
                docs.append({
                    "id": str(file_path),
                    "title": file_path.name,
                    "file_path": str(file_path),
                    "status": "indexed",
                    "content_length": file_path.stat().st_size,
                })
                if len(docs) >= 120:
                    break
    return {"documents": docs}


@app.get("/graph")
def graph():
    return {"nodes": [], "edges": []}


@app.post("/ingest")
def ingest(req: IngestRequest):
    from raglight.models import FolderSource

    cfg = load_cfg()
    folders = req.folders or cfg.get("folders") or []
    existing = [f for f in folders if Path(f).exists()]
    if not existing:
        return {"ok": False, "indexed": 0, "error": "no_existing_folders"}
    pipe = get_pipeline()
    sources = [FolderSource(f) for f in existing]
    result = pipe.ingest(sources)
    return {"ok": True, "folders": existing, "result": str(result)}


@app.post("/query")
def query_rag(req: QueryRequest):
    q = (req.question or req.query or "").strip()
    if not q:
        return {"answer": "", "sources": []}
    pipe = get_pipeline()
    resp = pipe.generate(q)
    sources = []
    for s in getattr(resp, "sources", []) or []:
        meta = getattr(s, "metadata", None)
        if isinstance(meta, dict) and meta.get("source"):
            sources.append(str(meta["source"]))
        else:
            sources.append(str(s))
    return {"answer": getattr(resp, "answer", str(resp)), "sources": sources[: req.top_k]}


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=PORT, log_level="warning")
"#;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_folders_and_extracts_port() {
        assert_eq!(
            parse_folder_list("/home/u/docs; /home/u/estudos\n/tmp/code"),
            vec!["/home/u/docs", "/home/u/estudos", "/tmp/code"]
        );
        assert_eq!(extract_port("http://127.0.0.1:8123"), Some(8123));
        assert_eq!(extract_port("https://rag.example.com/api"), None);
    }

    #[test]
    fn the_machine_declaration_fills_the_defaults_and_the_reader_wins_over_it() {
        let prev_provider = std::env::var_os("AURADESK_RAGLIGHT_PROVIDER");
        let prev_vector = std::env::var_os("AURADESK_RAGLIGHT_VECTOR_STORE");
        let prev_folders = std::env::var_os("AURADESK_RAGLIGHT_FOLDERS");

        std::env::remove_var("AURADESK_RAGLIGHT_PROVIDER");
        std::env::remove_var("AURADESK_RAGLIGHT_VECTOR_STORE");
        std::env::remove_var("AURADESK_RAGLIGHT_FOLDERS");

        let db = Db::open_in_memory().unwrap();
        let settings = SettingsService::new(&db);

        // The migration seeds every setting with its default, so the
        // environment may take over — until the reader changes it.
        let cfg = load_config(&db);
        assert_eq!(cfg.provider, "ollama");
        assert_eq!(cfg.vector_store, "chroma");
        assert!(cfg.folders.is_empty());

        std::env::set_var("AURADESK_RAGLIGHT_PROVIDER", "openai");
        std::env::set_var("AURADESK_RAGLIGHT_VECTOR_STORE", "qdrant");
        std::env::set_var("AURADESK_RAGLIGHT_FOLDERS", "/home/u/docs;/home/u/notes");

        let declared = load_config(&db);
        assert_eq!(declared.provider, "openai");
        assert_eq!(declared.vector_store, "qdrant");
        assert_eq!(
            declared.folders,
            vec!["/home/u/docs".to_string(), "/home/u/notes".to_string()]
        );

        // A value the reader chose by hand is left alone.
        settings
            .set(SettingsKey::RaglightProvider, serde_json::json!("local"))
            .expect("provider setting");
        let overridden = load_config(&db);
        assert_eq!(overridden.provider, "local");
        assert_eq!(overridden.vector_store, "qdrant");

        std::env::remove_var("AURADESK_RAGLIGHT_PROVIDER");
        std::env::remove_var("AURADESK_RAGLIGHT_VECTOR_STORE");
        std::env::remove_var("AURADESK_RAGLIGHT_FOLDERS");

        if let Some(v) = prev_provider {
            std::env::set_var("AURADESK_RAGLIGHT_PROVIDER", v);
        }
        if let Some(v) = prev_vector {
            std::env::set_var("AURADESK_RAGLIGHT_VECTOR_STORE", v);
        }
        if let Some(v) = prev_folders {
            std::env::set_var("AURADESK_RAGLIGHT_FOLDERS", v);
        }
    }

    #[test]
    fn writes_managed_raglight_config_and_server_script() {        let db = Db::open_in_memory().unwrap();
        let cfg = load_config(&db);
        let tmp =
            std::env::temp_dir().join(format!("auradesk_raglight_test_{}", std::process::id()));
        let root = write_managed_files(&cfg, &tmp).unwrap();
        assert!(root.join("raglight_config.json").is_file());
        assert!(root.join("server.py").is_file());
        let _ = fs::remove_dir_all(&tmp);
    }

    #[test]
    fn normalizes_lightrag_documents_and_graph_payloads() {
        let docs_val = serde_json::json!({
            "statuses": {
                "processed": [{
                    "id": "doc-1",
                    "file_path": "/estudos/fortinet.md",
                    "content_summary": "fortinet_nse1_ztna_notes",
                    "content_length": 420,
                    "chunks_count": 3,
                    "status": "processed"
                }]
            }
        });
        let docs = parse_lightrag_documents(&docs_val);
        assert_eq!(docs.len(), 1);
        assert_eq!(docs[0].title, "fortinet.md");
        assert_eq!(docs[0].chunks_count, 3);

        let graph_val = serde_json::json!({
            "nodes": [{ "id": "ent-1", "labels": ["ZTNA"], "properties": { "entity_type": "security", "description": "zero_trust_network_access", "source_id": "doc-1" } }],
            "edges": [{ "id": "rel-1", "source": "ZTNA", "target": "FortiGate", "properties": { "description": "enforces", "keywords": "policy, firewall", "weight": 0.9 } }]
        });
        let (entities, relations) = parse_remote_graph(&graph_val);
        assert_eq!(entities.len(), 1);
        assert_eq!(entities[0].name, "ZTNA");
        assert_eq!(relations.len(), 1);
        assert_eq!(relations[0].keywords, vec!["policy", "firewall"]);
    }

    #[test]
    fn enumerates_authorized_folders_and_blocks_path_traversal() {
        let base = std::env::temp_dir().join(format!("auradesk_rag_fs_{}", std::process::id()));
        let allowed_dir = base.join("allowed");
        let outside_file = base.join("secret.txt");
        fs::create_dir_all(&allowed_dir).unwrap();
        fs::write(allowed_dir.join("notes.md"), "aura_desktop_knowledge").unwrap();
        fs::write(&outside_file, "forbidden").unwrap();

        let folders = vec![allowed_dir.display().to_string()];
        let docs = enumerate_authorized_files(&folders);
        assert_eq!(docs.len(), 1);
        assert_eq!(docs[0].title, "notes.md");

        let ok_content = read_authorized_file(
            &folders,
            &allowed_dir.join("notes.md").display().to_string(),
        )
        .unwrap();
        assert_eq!(ok_content, "aura_desktop_knowledge");

        let denied = read_authorized_file(&folders, &outside_file.display().to_string());
        assert!(denied.is_err());

        let _ = fs::remove_dir_all(&base);
    }
}
