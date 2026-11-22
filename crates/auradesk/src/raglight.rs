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
    RaglightConfig {
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
    fn writes_managed_raglight_config_and_server_script() {
        let db = Db::open_in_memory().unwrap();
        let cfg = load_config(&db);
        let tmp =
            std::env::temp_dir().join(format!("auradesk_raglight_test_{}", std::process::id()));
        let root = write_managed_files(&cfg, &tmp).unwrap();
        assert!(root.join("raglight_config.json").is_file());
        assert!(root.join("server.py").is_file());
        let _ = fs::remove_dir_all(&tmp);
    }
}
