#!/usr/bin/env bash
# Provision the local Aura voice stack in Podman.
#
#   aura-desk-voice : Kokoro TTS      (ghcr.io/remsky/kokoro-fastapi-cpu)
#                     127.0.0.1:8925 -> 8880 inside the container
#   aura-desk-stt   : Whisper STT     (fedirz/faster-whisper-server)
#                     127.0.0.1:9000 -> 8000 inside the container
#
# The Kokoro image advertises 8000/tcp in its metadata, but its entrypoint
# runs uvicorn with PORT=8880 — mapping to 8000 yields a socket that accepts
# the connection and closes it without a response.
#
# This script is idempotent: it can be re-run safely.
set -euo pipefail

TTS_IMAGE="ghcr.io/remsky/kokoro-fastapi-cpu:latest"
TTS_CONTAINER="auradesk-voice"
TTS_HOST_PORT="${AURADESK_VOICE_PORT:-8925}"
TTS_CONTAINER_PORT=8880

STT_IMAGE="docker.io/fedirz/faster-whisper-server:latest-cpu"
STT_CONTAINER="auradesk-stt"
STT_HOST_PORT="${AURADESK_STT_PORT:-9000}"
STT_CONTAINER_PORT=8000
STT_MODEL="${AURADESK_STT_MODEL:-deepdml/faster-whisper-large-v3-turbo-ct2}"
STT_MODEL_SIZE="${AURADESK_STT_MODEL_SIZE:-large-v3-turbo}"

log() { printf '  %s\n' "$*"; }

# ── Runtime ────────────────────────────────────────────────────────────────
if ! command -v podman >/dev/null 2>&1; then
  echo "Podman not found."
  if command -v nix >/dev/null 2>&1; then
    echo "Installing Podman through Nix…"
    nix profile install nixpkgs#podman || {
      echo "Failed to install Podman via Nix. Install it manually and re-run." >&2
      exit 1
    }
    # `nix profile install` puts the binary in ~/.local/bin.
    export PATH="$HOME/.local/bin:$PATH"
  else
    echo "Install Podman manually (e.g. `apt install podman` or `nix profile install nixpkgs#podman`) and re-run." >&2
    exit 1
  fi
fi

log "Podman: $(podman --version)"

# ── Text to speech ─────────────────────────────────────────────────────────
echo "Text to speech (Kokoro)…"
if podman image exists "$TTS_IMAGE"; then
  log "Image already present."
else
  echo "Pulling $TTS_IMAGE (several GB, one time)…"
  podman pull "$TTS_IMAGE"
fi

if podman ps --format '{{.Names}}' | grep -qx "$TTS_CONTAINER"; then
  log "Container already running."
else
  podman rm -f "$TTS_CONTAINER" >/dev/null 2>&1 || true
  podman run -d \
    --name "$TTS_CONTAINER" \
    --restart=unless-stopped \
    -p "127.0.0.1:${TTS_HOST_PORT}:${TTS_CONTAINER_PORT}" \
    "$TTS_IMAGE" >/dev/null
  log "Container started on 127.0.0.1:${TTS_HOST_PORT}."
fi

# ── Speech to text ─────────────────────────────────────────────────────────
echo "Speech to text (Whisper)…"
if podman image exists "$STT_IMAGE"; then
  log "Image already present."
else
  echo "Pulling $STT_IMAGE (several GB, one time)…"
  podman pull "$STT_IMAGE"
fi

if podman ps --format '{{.Names}}' | grep -qx "$STT_CONTAINER"; then
  log "Container already running."
else
  podman rm -f "$STT_CONTAINER" >/dev/null 2>&1 || true
  podman run -d \
    --name "$STT_CONTAINER" \
    --restart=unless-stopped \
    -p "127.0.0.1:${STT_HOST_PORT}:${STT_CONTAINER_PORT}" \
    -e "ASR_MODEL=${STT_MODEL}" \
    -e "ASR_MODEL_SIZE=${STT_MODEL_SIZE}" \
    -e "ASR_ENGINE=ct2" \
    "$STT_IMAGE" >/dev/null
  log "Container started on 127.0.0.1:${STT_HOST_PORT}."
fi

# ── Health ─────────────────────────────────────────────────────────────────
wait_for_health() {
  local name="$1" url="$2" attempts="$3"
  for _ in $(seq 1 "$attempts"); do
    if curl -fsS "$url" 2>/dev/null | grep -q healthy; then
      return 0
    fi
    sleep 2
  done
  echo "The $name service did not become healthy in time." >&2
  echo "Check: podman logs $name" >&2
  return 1
}

echo "Waiting for the voice model to warm up…"
wait_for_health "$TTS_CONTAINER" "http://127.0.0.1:${TTS_HOST_PORT}/health" 90

voices=$(curl -fsS "http://127.0.0.1:${TTS_HOST_PORT}/v1/audio/voices" 2>/dev/null \
  | grep -o '"id"' | wc -l | tr -d ' ')
echo "Aura voice service is up at http://127.0.0.1:${TTS_HOST_PORT} (${voices} voices)."

echo "Waiting for the transcription model (first boot downloads it)…"
wait_for_health "$STT_CONTAINER" "http://127.0.0.1:${STT_HOST_PORT}/health" 150
echo "Aura transcription service is up at http://127.0.0.1:${STT_HOST_PORT}."
