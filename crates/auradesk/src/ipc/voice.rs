//! Voice service IPC commands.
//!
//! Exposes the local Kokoro stack to the frontend: status inspection and
//! on-demand provisioning. Provisioning runs on a background thread because
//! pulling the container image is a multi-gigabyte download; progress is
//! reported through the `auradesk://voice-progress` event.

use tauri::{AppHandle, Emitter};

use crate::voice::{
    detect_runtime, ensure_container, ensure_image, ensure_stt_container, ensure_stt_image,
    stop_container, stop_stt_container, voice_status, VoiceServiceOutcome, VoiceServiceProgress,
};

/// Event name used to report provisioning progress to the frontend.
pub const VOICE_PROGRESS_EVENT: &str = "auradesk://voice-progress";

/// Current status of the local voice stack. Cheap: never pulls or starts
/// anything.
#[tauri::command]
pub fn voice_service_status() -> crate::voice::VoiceServiceStatus {
    voice_status()
}

/// Starts (or repairs) the local voice service.
///
/// Returns immediately; the real work happens on a background thread and
/// progress arrives via the `auradesk://voice-progress` event.
#[tauri::command]
pub fn voice_service_start(app: AppHandle) -> VoiceServiceOutcome {
    let Some((_, runtime_path)) = detect_runtime() else {
        let status = voice_status();
        return VoiceServiceOutcome {
            ok: false,
            message: status
                .detail
                .clone()
                .unwrap_or_else(|| "Runtime de contêiner indisponível.".to_string()),
            status,
        };
    };

    let emit_app = app.clone();
    let runtime = runtime_path.clone();
    std::thread::spawn(move || {
        let emit = |stage: &str, message: &str| {
            let _ = emit_app.emit(
                VOICE_PROGRESS_EVENT,
                VoiceServiceProgress {
                    stage: stage.to_string(),
                    message: message.to_string(),
                    status: voice_status(),
                },
            );
        };

        let result = ensure_image(&runtime, &emit)
            .and_then(|_| ensure_container(&runtime, &emit))
            .and_then(|_| ensure_stt_image(&runtime, &emit))
            .and_then(|_| ensure_stt_container(&runtime, &emit));

        let status = voice_status();
        let _ = emit_app.emit(
            VOICE_PROGRESS_EVENT,
            VoiceServiceProgress {
                stage: if result.is_ok() { "ready" } else { "error" }.to_string(),
                message: result
                    .clone()
                    .err()
                    .unwrap_or_else(|| "Serviço de voz pronto.".to_string()),
                status: status.clone(),
            },
        );
    });

    VoiceServiceOutcome {
        ok: true,
        message: "Provisionamento do serviço de voz iniciado.".to_string(),
        status: voice_status(),
    }
}

/// Stops the managed voice container.
#[tauri::command]
pub fn voice_service_stop() -> VoiceServiceOutcome {
    let Some((_, runtime_path)) = detect_runtime() else {
        return VoiceServiceOutcome {
            ok: false,
            message: "Runtime de contêiner indisponível.".to_string(),
            status: voice_status(),
        };
    };

    let result = stop_container(&runtime_path);
    let stt_result = stop_stt_container(&runtime_path);
    VoiceServiceOutcome {
        ok: result.is_ok() && stt_result.is_ok(),
        message: result
            .err()
            .unwrap_or_else(|| "Serviço de voz parado.".to_string()),
        status: voice_status(),
    }
}
