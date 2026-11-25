# AuraDesk on NixOS

Installing AuraDesk on NixOS should not leave a checklist behind. The
knowledge service and the local voice stack are declared in the NixOS
configuration, so the machine knows about them before the app is ever
opened.

```nix
{
  inputs.auradesk.url = "github:RAGton/aura-desk";

  # ...

  nixosConfigurations.glacier = nixpkgs.lib.nixosSystem {
    modules = [
      auradesk.nixosModules.${system}.default
      {
        programs.auradesk = {
          enable = true;
          mcp.enable = true;

          # The local voice stack: Kokoro (TTS) and Whisper (STT).
          voice.enable = true;

          # The knowledge service (RAGLight).
          raglight = {
            enable = true;
            folders = [ "/home/ragton/Documentos" ];
          };
        };
      }
    ];
  };
}
```

---

## What each declaration brings

### `voice.enable`

| What | Why |
|---|---|
| `virtualisation.podman.enable` | Removes the "install Podman first" step from the checklist. |
| The two container images, pulled into the user's rootless podman store | The first launch of the app does not wait for a download of about a gigabyte. |
| The host ports (`8925` for TTS, `9000` for STT), published on loopback only | Nothing is exposed to the network. |

The **containers themselves are owned by the application**: it starts them
as the desktop user, with a rootless podman, on launch. There is
deliberately no systemd unit for them — a system unit would run a second,
rootful podman on the same host port, and the two would fight over it.

The image pull runs as a *user* unit (`auradesk-voice-images`) because the
app uses the user's rootless store. A system-level pull would fill the
rootful store instead, and the app would still download everything.

Turn the pull off with `voice.pullImages = false;` if the images are
managed elsewhere.

### `raglight.enable`

| What | Why |
|---|---|
| `uv` and `python3` | The toolchain the app uses to install the service: `uv` is its fast path, `python3` its fallback. |
| The native libraries the Python wheels load | Without them the app installs everything and then fails on the first import. |
| `AURADESK_RAGLIGHT_*` in the session | What the machine declares about the service: the address it listens on, the provider, the vector store and the folders it indexes. |

#### The precedence rule

The environment fills the values the reader has not touched. A setting that
still holds its built-in default is replaced by the machine's declaration;
a setting that was changed by hand in Settings is left alone.

So the installation declares the service, and the interface can override it
without the change being silently lost on the next start.

| Variable | Meaning |
|---|---|
| `AURADESK_RAGLIGHT_ENABLED` | Turns the knowledge service on. |
| `AURADESK_RAGLIGHT_BASE_URL` | Address the service listens on (default `http://127.0.0.1:8000`). |
| `AURADESK_RAGLIGHT_PROVIDER` | Embedding and LLM provider (default `ollama`). |
| `AURADESK_RAGLIGHT_VECTOR_STORE` | Vector store: `chroma` or `qdrant`. |
| `AURADESK_RAGLIGHT_FOLDERS` | Folders to index, separated by `;`. |
| `AURADESK_RAGLIGHT_EMBEDDING_MODEL` | Embedding model (default `nomic-embed-text`). |
| `AURADESK_RAGLIGHT_LLM_MODEL` | LLM model (default `qwen3:0.6b`). |
| `AURADESK_RAGLIGHT_API_KEY` | API key for a cloud provider. |

---

## What the app still does on its own

The installation declares the machine; the application manages the
day-to-day.

- The knowledge service is installed into its own virtual environment under
  the app's data directory, and started and stopped from the explorer page
  or from Settings.
- The voice containers are started on launch and reused when they are
  already running.
- The Hindsight daemon is a separate service (`hindsight-start`,
  `hindsight-stop`, `hindsight-status` are provided by the NixOS
  configuration).

## Checking that it took

```console
$ podman images | grep -E "kokoro|whisper"
$ systemctl --user status auradesk-voice-images
$ env | grep AURADESK_RAGLIGHT
```

Inside the app, the **LightRAG** tab of the sidebar shows which service it
is talking about and offers the next step — install it, start it, stop it or
re-index the folders — without leaving the page.
