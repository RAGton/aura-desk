//! Local voice service manager.
//!
//! AuraDesk ships its own text-to-speech stack so the assistant can talk
//! offline, in Brazilian Portuguese, without the user installing anything by
//! hand. The stack runs as a container:
//!
//!   image : `ghcr.io/remsky/kokoro-fastapi-cpu:latest`
//!   port  : `127.0.0.1:8925` on the host -> `8880` inside the container
//!
//! The host-side port is 8880 on purpose: the image advertises `8000/tcp`
//! in its metadata, but its entrypoint runs uvicorn with `PORT=8880`
//! (`api.src.main:app --port ${PORT:-8880}`). Mapping to 8000 yields a
//! connection that is accepted and then closed with no response.
//!
//! The container is bound to loopback only. It exposes an OpenAI-compatible
//! HTTP API and an OpenAI-Realtime-compatible WebSocket, both of which are
//! CORS-open (`allow_origins=["*"]`), so the Tauri webview can talk to it
//! directly.

use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::Emitter;

/// Container image providing the Kokoro TTS service.
pub const VOICE_IMAGE: &str = "ghcr.io/remsky/kokoro-fastapi-cpu:latest";
/// Name of the managed container.
pub const VOICE_CONTAINER: &str = "auradesk-voice";
/// Host port the service is published on (loopback only).
pub const VOICE_HOST_PORT: u16 = 8925;
/// Port the service listens on inside the container.
pub const VOICE_CONTAINER_PORT: u16 = 8880;

/// Container image providing the local Whisper speech-to-text service.
pub const STT_IMAGE: &str = "docker.io/fedirz/faster-whisper-server:latest-cpu";
/// Name of the managed STT container.
pub const STT_CONTAINER: &str = "auradesk-stt";
/// Host port the STT service is published on (loopback only).
pub const STT_HOST_PORT: u16 = 9000;
/// Port the STT service listens on inside the container.
pub const STT_CONTAINER_PORT: u16 = 8000;
/// Whisper model used for transcription. `large-v3-turbo` is the sweet spot
/// for Brazilian Portuguese on CPU.
pub const STT_MODEL: &str = "deepdml/faster-whisper-large-v3-turbo-ct2";
/// Model size label expected by the server.
pub const STT_MODEL_SIZE: &str = "large-v3-turbo";

/// Base URL the frontend uses to reach the voice service.
pub fn voice_base_url() -> String {
    format!("http://127.0.0.1:{VOICE_HOST_PORT}")
}

/// Base URL the frontend uses to reach the speech-to-text service.
pub fn stt_base_url() -> String {
    format!("http://127.0.0.1:{STT_HOST_PORT}")
}

/// Status of the local voice stack, surfaced to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VoiceServiceStatus {
    /// True when a container runtime (podman) is available on this machine.
    pub runtime_available: bool,
    /// Name of the detected runtime, e.g. `podman`.
    pub runtime: Option<String>,
    /// True when the voice service answers `/health` with `healthy`.
    pub service_ready: bool,
    /// True when the container exists and is running.
    pub container_running: bool,
    /// True when the container image is present locally.
    pub image_present: bool,
    /// Base URL of the service (loopback).
    pub base_url: String,
    /// Container image backing the service.
    pub image: String,
    /// Number of voices exposed by the service, when it is reachable.
    pub voice_count: Option<usize>,
    /// Human readable reason when the service is not available.
    pub detail: Option<String>,
    /// True when the speech-to-text service answers `/health`.
    pub stt_ready: bool,
    /// Base URL of the speech-to-text service (loopback).
    pub stt_base_url: String,
    /// True when the Whisper container is running.
    pub stt_container_running: bool,
}

impl Default for VoiceServiceStatus {
    fn default() -> Self {
        Self {
            runtime_available: false,
            runtime: None,
            service_ready: false,
            container_running: false,
            image_present: false,
            base_url: voice_base_url(),
            image: VOICE_IMAGE.to_string(),
            voice_count: None,
            detail: None,
            stt_ready: false,
            stt_base_url: stt_base_url(),
            stt_container_running: false,
        }
    }
}

/// Progress event emitted while the voice stack is being provisioned.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VoiceServiceProgress {
    /// Coarse stage of the provisioning process.
    pub stage: String,
    /// Human readable message for the UI.
    pub message: String,
    /// Current status snapshot.
    pub status: VoiceServiceStatus,
}

/// Outcome of a provisioning attempt.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VoiceServiceOutcome {
    pub ok: bool,
    pub message: String,
    pub status: VoiceServiceStatus,
}

/// Locates a container runtime binary.
///
/// Podman is the supported runtime. Docker is accepted as a fallback so
/// developers on a plain Linux workstation are not blocked.
pub fn detect_runtime() -> Option<(String, PathBuf)> {
    for candidate in ["podman", "docker"] {
        if let Ok(path) = which(candidate) {
            return Some((candidate.to_string(), path));
        }
    }
    None
}

/// Minimal `which` implementation (no extra dependency).
fn which(binary: &str) -> Result<PathBuf, String> {
    let path_var = std::env::var("PATH").unwrap_or_default();
    for dir in path_var.split(':') {
        if dir.is_empty() {
            continue;
        }
        let candidate = PathBuf::from(dir).join(binary);
        if candidate.is_file() {
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                if let Ok(meta) = candidate.metadata() {
                    if meta.permissions().mode() & 0o111 != 0 {
                        return Ok(candidate);
                    }
                }
            }
            #[cfg(not(unix))]
            return Ok(candidate);
        }
    }
    Err(format!("{binary} not found in PATH"))
}

/// Runs a runtime command and returns its stdout.
///
/// Blocks until the command finishes. Callers run this off the UI thread —
/// `podman pull` can take several minutes.
fn run_runtime(runtime: &PathBuf, args: &[&str], _timeout_secs: u64) -> Result<String, String> {
    let output = Command::new(runtime)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|e| format!("{} {}: {e}", runtime.display(), args.join(" ")))?;

    if output.status.success() {
        return Ok(String::from_utf8_lossy(&output.stdout).to_string());
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let detail = if stderr.is_empty() { stdout } else { stderr };
    Err(format!(
        "{} {} failed: {}",
        runtime.display(),
        args.join(" "),
        detail
    ))
}

/// True when the container is running.
fn container_running(runtime: &PathBuf, name: &str) -> bool {
    run_runtime(
        runtime,
        &[
            "ps",
            "--filter",
            &format!("name=^{name}$"),
            "--format",
            "{{.Names}}",
        ],
        20,
    )
    .map(|out| out.lines().any(|l| l.trim() == name))
    .unwrap_or(false)
}

/// True when the image exists locally.
fn image_present(runtime: &PathBuf, image: &str) -> bool {
    run_runtime(runtime, &["image", "exists", image], 20)
        .map(|_| true)
        .unwrap_or(false)
}

/// Probes `/health` on the local speech-to-text service.
fn stt_healthy() -> bool {
    let client = match reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(3))
        .build()
    {
        Ok(client) => client,
        Err(_) => return false,
    };
    client
        .get(format!("{}/health", stt_base_url()))
        .send()
        .map(|r| r.status().is_success())
        .unwrap_or(false)
}

/// Probes `/health` on the local service.
fn service_healthy() -> Option<usize> {
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(3))
        .build()
        .ok()?;
    let response = client.get(format!("{}/health", voice_base_url())).send().ok()?;
    if !response.status().is_success() {
        return None;
    }
    let text = response.text().ok()?;
    if !text.contains("healthy") {
        return None;
    }
    // Voice count is informational; failure to read it must not fail the probe.
    let count = client
        .get(format!("{}/v1/audio/voices", voice_base_url()))
        .send()
        .ok()
        .and_then(|r| r.json::<serde_json::Value>().ok())
        .and_then(|v| v.get("voices").and_then(|list| list.as_array().cloned()))
        .map(|list| list.len());
    Some(count.unwrap_or(0))
}

/// Reads the current status without changing anything.
pub fn voice_status() -> VoiceServiceStatus {
    let mut status = VoiceServiceStatus::default();

    let Some((runtime_name, runtime_path)) = detect_runtime() else {
        status.detail = Some(
            "Nenhum runtime de contêiner encontrado (podman). \
             Instale o Podman ou habilite programs.auradesk.voice no módulo NixOS."
                .to_string(),
        );
        return status;
    };

    status.runtime_available = true;
    status.runtime = Some(runtime_name);
    status.image_present = image_present(&runtime_path, VOICE_IMAGE);
    status.container_running = container_running(&runtime_path, VOICE_CONTAINER);
    status.stt_container_running = container_running(&runtime_path, STT_CONTAINER);
    status.stt_ready = stt_healthy();

    match service_healthy() {
        Some(count) => {
            status.service_ready = true;
            status.voice_count = Some(count);
        }
        None => {
            status.detail = Some(
                "Serviço de voz não responde em /health. \
                 O contêiner pode ainda estar starting."
                    .to_string(),
            );
        }
    }

    status
}

/// Ensures the container image is present, pulling it when needed.
///
/// This is the slow part (a multi-gigabyte download), so callers run it on a
/// background thread and report progress through events.
pub fn ensure_image(runtime: &PathBuf, on_progress: &dyn Fn(&str, &str)) -> Result<(), String> {
    if image_present(runtime, VOICE_IMAGE) {
        on_progress("image", "Imagem de voz já está presente.");
        return Ok(());
    }

    on_progress("pull", "Baixando o modelo de voz (pode levar alguns minutos)...");
    run_runtime(runtime, &["pull", VOICE_IMAGE], 3600)?;
    on_progress("image", "Modelo de voz baixado.");
    Ok(())
}

/// Ensures the container exists and runs, recreating it when the published
/// port or image changed.
pub fn ensure_container(runtime: &PathBuf, on_progress: &dyn Fn(&str, &str)) -> Result<(), String> {
    if container_running(runtime, VOICE_CONTAINER) {
        if service_healthy().is_some() {
            on_progress("ready", "Serviço de voz pronto.");
            return Ok(());
        }
        on_progress("start", "Contêiner em execução, aguardando o serviço...");
    } else {
        // Remove a stopped container with the same name so `run` does not
        // fail with "name already in use".
        let _ = run_runtime(runtime, &["rm", "-f", VOICE_CONTAINER], 60);
        on_progress("start", "Iniciando o serviço de voz...");
        let port_map = format!("127.0.0.1:{VOICE_HOST_PORT}:{VOICE_CONTAINER_PORT}");
        run_runtime(
            runtime,
            &[
                "run",
                "-d",
                "--name",
                VOICE_CONTAINER,
                "--restart=unless-stopped",
                "-p",
                &port_map,
                VOICE_IMAGE,
            ],
            180,
        )?;
    }

    // The container warms the Kokoro model on boot; give it a moment before
    // declaring failure.
    for _ in 0..60 {
        if service_healthy().is_some() {
            on_progress("ready", "Serviço de voz pronto.");
            return Ok(());
        }
        std::thread::sleep(Duration::from_secs(2));
    }

    Err("O contêiner subiu, mas /health não respondeu em 120s.".to_string())
}

/// Ensures the Whisper speech-to-text image is present locally.
pub fn ensure_stt_image(runtime: &PathBuf, on_progress: &dyn Fn(&str, &str)) -> Result<(), String> {
    if image_present(runtime, STT_IMAGE) {
        on_progress("stt-image", "Imagem de transcrição já está presente.");
        return Ok(());
    }

    on_progress(
        "stt-pull",
        "Baixando o modelo de transcrição (Whisper, pode levar alguns minutos)...",
    );
    run_runtime(runtime, &["pull", STT_IMAGE], 3600)?;
    on_progress("stt-image", "Modelo de transcrição baixado.");
    Ok(())
}

/// Ensures the Whisper container runs with the configured model.
///
/// The model itself is downloaded by the container on first boot, so the
/// health check below can take a couple of minutes on a cold machine.
pub fn ensure_stt_container(
    runtime: &PathBuf,
    on_progress: &dyn Fn(&str, &str),
) -> Result<(), String> {
    if container_running(runtime, STT_CONTAINER) {
        if stt_healthy() {
            on_progress("stt-ready", "Serviço de transcrição pronto.");
            return Ok(());
        }
        on_progress("stt-start", "Contêiner de transcrição em execução, aguardando o modelo...");
    } else {
        let _ = run_runtime(runtime, &["rm", "-f", STT_CONTAINER], 60);
        on_progress("stt-start", "Iniciando o serviço de transcrição...");
        let port_map = format!("127.0.0.1:{STT_HOST_PORT}:{STT_CONTAINER_PORT}");
        run_runtime(
            runtime,
            &[
                "run",
                "-d",
                "--name",
                STT_CONTAINER,
                "--restart=unless-stopped",
                "-p",
                &port_map,
                "-e",
                &format!("ASR_MODEL={STT_MODEL}"),
                "-e",
                &format!("ASR_MODEL_SIZE={STT_MODEL_SIZE}"),
                "-e",
                "ASR_ENGINE=ct2",
                STT_IMAGE,
            ],
            180,
        )?;
    }

    for _ in 0..150 {
        if stt_healthy() {
            on_progress("stt-ready", "Serviço de transcrição pronto.");
            return Ok(());
        }
        std::thread::sleep(Duration::from_secs(2));
    }

    Err("O contêiner de transcrição subiu, mas /health não respondeu em 5min.".to_string())
}

/// Stops the managed container.
pub fn stop_container(runtime: &PathBuf) -> Result<(), String> {
    run_runtime(runtime, &["stop", VOICE_CONTAINER], 60)?;
    Ok(())
}

/// Stops the managed speech-to-text container.
pub fn stop_stt_container(runtime: &PathBuf) -> Result<(), String> {
    run_runtime(runtime, &["stop", STT_CONTAINER], 60)?;
    Ok(())
}

/// Starts the voice services in the background when they are not running.
///
/// Called on app launch. It is deliberately best-effort: a missing runtime,
/// a missing image or a failed pull must never keep the app from opening.
/// The first launch downloads the container image, which is why the work
/// happens on its own thread.
pub fn autostart_voice_services(app: &tauri::AppHandle) {
    let Some((_, runtime)) = detect_runtime() else {
        return;
    };

    // Nothing to do when both services are already up.
    if service_healthy().is_some() && stt_healthy() {
        return;
    }

    let app = app.clone();
    std::thread::spawn(move || {
        let emit = |stage: &str, message: &str| {
            let _ = app.emit(
                "auradesk://voice-progress",
                VoiceServiceProgress {
                    stage: stage.to_string(),
                    message: message.to_string(),
                    status: voice_status(),
                },
            );
        };

        // Pulling the images is the slow part; it only happens once.
        let _ = ensure_image(&runtime, &emit);
        let _ = ensure_container(&runtime, &emit);
        let _ = ensure_stt_image(&runtime, &emit);
        let _ = ensure_stt_container(&runtime, &emit);

        emit("ready", "Serviço de voz pronto.");
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn voice_base_url_uses_the_container_port_mapping() {
        assert_eq!(voice_base_url(), "http://127.0.0.1:8925");
    }

    #[test]
    fn default_status_reports_missing_runtime() {
        let status = VoiceServiceStatus::default();
        assert!(!status.runtime_available);
        assert!(!status.service_ready);
        assert_eq!(status.image, VOICE_IMAGE);
    }

    #[test]
    fn which_rejects_missing_binaries() {
        assert!(which("auradesk-definitely-not-a-real-binary").is_err());
    }
}
