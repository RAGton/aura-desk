#!/usr/bin/env bash
# Provision the voice models used by AuraDesk.
#
# Reality check: AuraDesk does NOT download voice models separately. The
# Kokoro weights (kokoro_v1, ~82M params, plus every voice pack) are baked
# into the container image `ghcr.io/remsky/kokoro-fastapi-cpu:latest`, and
# the container warms the model on boot. There is therefore nothing to
# fetch at runtime — the only thing to do is make sure the image is present.
#
# The earlier version of this script pointed at Piper voice packs
# (`rhasspy/piper-pt-br/.../onxx/...onnx`) and at a `/download_models.sh`
# path inside the container. Both were wrong: those URLs return 401/404 and
# the image ships no such script. Keeping the Piper tier out of the default
# install also avoids pulling a second, unused model family.
#
# This script therefore just ensures the image and reports the catalogue.
set -euo pipefail

IMAGE="ghcr.io/remsky/kokoro-fastapi-cpu:latest"
HOST_PORT="${AURADESK_VOICE_PORT:-8925}"

if ! command -v podman >/dev/null 2>&1; then
  echo "Podman is required. Run scripts/setup_voice_podman.sh first." >&2
  exit 1
fi

if podman image exists "$IMAGE"; then
  echo "Voice models are bundled in $IMAGE (already present)."
else
  echo "Pulling $IMAGE — this is where the voice models come from."
  podman pull "$IMAGE"
fi

if ! curl -fsS "http://127.0.0.1:${HOST_PORT}/health" 2>/dev/null | grep -q healthy; then
  echo "The voice service is not running yet. Run scripts/setup_voice_podman.sh."
  exit 1
fi

echo "Available voices:"
curl -fsS "http://127.0.0.1:${HOST_PORT}/v1/audio/voices" \
  | grep -o '"id":"[^"]*"' \
  | sed 's/"id":"//; s/"//' \
  | sed 's/^/  - /'
