{
  description = "AuraDesk — desktop productivity (Linux + Windows), Hermes Agent integration. Linux-only dev shell; Windows builds via CI and local Tauri CLI.";

  inputs = {
    # Track nixos-unstable: matches rolling-release distros (Omarchy etc.).
    # Pin to a specific commit via flake.lock; roll forward deliberately.
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

    # rust-overlay provides version-pinned Rust toolchains.
    # Tauri 2.12.4 (stable 2026-10-14) raises MSRV to 1.90. We pin
    # exactly 1.90.0 — Tauri MSRV, not bleeding edge, not pre-Tauri-2.12.
    rust-overlay.url = "github:oxalica/rust-overlay";

    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, rust-overlay, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        overlays = [ (import rust-overlay) ];
        pkgs = import nixpkgs { inherit system overlays; };

        rust = pkgs.rust-bin.stable."1.90.0".default.override {
          extensions = [ "rust-src" "rust-analyzer" "clippy" "rustfmt" ];
        };

        # The Tauri 2.12 build needs pkg-config to find headers for
        # WebKitGTK 4.1, GTK3, libsoup-3.0, libayatana-appindicator3,
        # librsvg2, and OpenSSL. All of them expose a `.dev` output
        # with lib/pkgconfig/*.pc files. The Nix attribute name is
        # `webkitgtk_4_1` (not `webkit2gtk_4_1`); verified via
        # `nix-instantiate --eval` against nixos-unstable.
        pkgConfigPath = pkgs.lib.makeSearchPath "lib/pkgconfig" [
          pkgs.openssl.dev
          pkgs.webkitgtk_4_1.dev
          pkgs.gtk3.dev
          pkgs.libsoup_3.dev
          pkgs.libayatana-appindicator.dev
          pkgs.librsvg.dev
        ];

        # The Tauri CLI binary. nixpkgs attribute is `cargo-tauri`
        # (NOT `tauri-cli`, which is the GUI companion). Version
        # 2.12.x matches our Tauri runtime.
        cargoTauri = pkgs.cargo-tauri;

        # Explicit bin/ path list for shellHook. Reason: rust-overlay
        # replaces pkgs.rust, and that overlay interaction can prevent
        # `with pkgs; [...]` buildInputs from auto-propagating to PATH
        # on the host. We prepend these paths explicitly so the user
        # gets Nix rust/node/pnpm/cargo-tauri before any system rustup
        # or Hermes-injected PATH entries.
        toolchainBin = pkgs.lib.makeBinPath [
          rust
          pkgs.nodejs_22
          pkgs.pnpm
          cargoTauri
          pkgs.pkg-config
          pkgs.openssl
        ];

        # Use the pinned overlay toolchain for both Rust packages. The
        # default nixpkgs rustPlatform is otherwise independent of the
        # rust-overlay selection above.
        rustPlatform = pkgs.makeRustPlatform {
          rustc = rust;
          cargo = rust;
        };

        src = ./.;
        version = "0.2.2";
        pnpm = pkgs.pnpm;

        pnpmDeps = pkgs.fetchPnpmDeps {
          pname = "auradesk";
          inherit version src pnpm;
          fetcherVersion = 4;
          hash = "sha256-tGON20kaUiFAAhLSCeRi98R5ga5+pC1MTQTUAXzicnY=";
        };

        auradeskMcp = rustPlatform.buildRustPackage {
          pname = "auradesk-mcp";
          inherit version src;
          cargoRoot = ".";
          cargoHash = "sha256-Uz93PtZyJGTeofs2yV2SjwsqD3wQY/gQ2LkZZL5Sj5Y=";
          cargoBuildFlags = [ "--package" "auradesk-mcp" ];
          cargoInstallFlags = [ "--path" "crates/auradesk-mcp" ];
          nativeBuildInputs = [ pkgs.pkg-config ];
          buildInputs = [ pkgs.sqlite.dev ];
          doCheck = false;

          meta = {
            description = "AuraDesk Model Context Protocol server";
            homepage = "https://github.com/RAGton/aura-desk";
            license = pkgs.lib.licenses.mit;
            mainProgram = "auradesk-mcp";
            platforms = pkgs.lib.platforms.linux;
          };
        };

        auradesk = rustPlatform.buildRustPackage {
          pname = "auradesk";
          inherit version src;
          cargoRoot = ".";
          buildAndTestSubdir = "crates/auradesk";
          cargoHash = "sha256-Uz93PtZyJGTeofs2yV2SjwsqD3wQY/gQ2LkZZL5Sj5Y=";

          pnpmDeps = pnpmDeps;
          pnpmWorkspaces = [ "@auradesk/web" ];

          # libappindicator-sys dlopens this library by soname at runtime;
          # point it at the immutable Nix store path instead of the host filesystem.
          postPatch = ''
            substituteInPlace $cargoDepsCopy/*/libappindicator-sys-*/src/lib.rs --replace-fail "libayatana-appindicator3.so.1" "${pkgs.libayatana-appindicator}/lib/libayatana-appindicator3.so.1"
          '';

          nativeBuildInputs = [
            pkgs.cargo-tauri.hook
            pkgs.nodejs_22
            pkgs.pnpmConfigHook
            pnpm
            pkgs.pkg-config
            pkgs.wrapGAppsHook4
          ];

          buildInputs = [
            pkgs.openssl
            pkgs.aws-lc.dev
            pkgs.webkitgtk_4_1
            pkgs.gtk3
            pkgs.glib
            pkgs.cairo
            pkgs.pango
            pkgs.gdk-pixbuf
            pkgs.atk
            pkgs.libsoup_3
            pkgs.libayatana-appindicator
            pkgs.librsvg
          ];

          doCheck = false;

          # Podman is a runtime prerequisite: the voice service (Kokoro TTS)
          # runs as a container. Bundling it here means the user never has
          # to install a container runtime by hand.
          runtimeDependencies = [ pkgs.podman ];

          meta = {
            description = "AuraDesk desktop productivity application";
            homepage = "https://github.com/RAGton/aura-desk";
            license = pkgs.lib.licenses.mit;
            mainProgram = "auradesk";
            platforms = pkgs.lib.platforms.linux;
          };
        };
      in
      {
        packages = {
          inherit auradesk auradeskMcp;
          "auradesk-mcp" = auradeskMcp;
          default = auradesk;
        };

        devShells.default = pkgs.mkShell {
          nativeBuildInputs = [
            rust
            pkgs.pkg-config
            pkgs.nodejs_22
            pkgs.pnpm
            cargoTauri
          ];

          buildInputs = [
            pkgs.openssl
            pkgs.webkitgtk_4_1
            pkgs.gtk3
            pkgs.glib
            pkgs.cairo
            pkgs.pango
            pkgs.gdk-pixbuf
            pkgs.atk
            pkgs.libsoup_3
            pkgs.libayatana-appindicator
            pkgs.librsvg
            pkgs.curl
            pkgs.wget
            pkgs.file
            pkgs.xdg-utils
            pkgs.binaryen
            pkgs.wayland
            pkgs.wlr-protocols
          ];

          # Hardening: prevent toolchain leakage from /etc/profile.d etc.
          # Tauri's build scripts use pkg-config correctly; strictDeps is
          # safe for our intended toolchain. If a future crate needs an
          # extra header, fall back by removing this flag with a comment.
          strictDeps = true;

          shellHook = ''
            # Prepend the Nix toolchain bin paths so they win over any
            # system rustup (`~/.cargo/bin`), Hermes-attached
            # `~/.hermes/tools/node-*` or `~/.local/bin` entries that
            # may have been inherited from the parent shell.
            export PATH="${toolchainBin}:$PATH"

            # Toolchain hints for the Tauri build process. Preserve the
            # PKG_CONFIG_PATH populated by Nix's pkg-config setup hook
            # (which includes transitive .dev deps like glib-2.0, cairo,
            # pango, atk, gdk-pixbuf) while prioritizing explicit Tauri deps.
            export PKG_CONFIG_PATH="${pkgConfigPath}''${PKG_CONFIG_PATH:+:$PKG_CONFIG_PATH}"
            export RUST_SRC_PATH="${rust}/lib/rustlib/src/rust/src"
            export WEBKIT_DISABLE_COMPOSITING_MODE=1

            # Friendly warning if flakes are not enabled on the host
            if ! nix show-config 2>/dev/null | grep -q "experimental-features.*flakes"; then
              echo ""
              echo "WARNING: Nix flakes are not enabled on this system."
              echo "Use one of:"
              echo "  nix develop --experimental-features 'nix-command flakes'"
              echo "  (persist in ~/.config/nix/nix.conf:)"
              echo "    experimental-features = nix-command flakes"
              echo ""
            fi

            echo "AuraDesk dev shell ready (Linux-only)"
            echo "  rust: ${rust.version}, node: ${pkgs.nodejs_22.version}, pnpm: ${pkgs.pnpm.version}"
            echo "  cargo-tauri: ${cargoTauri.version}"
            echo "  pnpm: $(which pnpm 2>/dev/null || echo 'NOT IN PATH')"
            echo "  cargo-tauri bin: $(which cargo-tauri 2>/dev/null || echo 'NOT IN PATH')"
          '';
        };

        nixosModules.default = { config, lib, pkgs, ... }:
          let
            cfg = config.programs.auradesk;
            packages = self.packages.${pkgs.stdenv.hostPlatform.system};

            # Container image providing the local Kokoro TTS service.
            voiceImage = "ghcr.io/remsky/kokoro-fastapi-cpu:latest";
            # The container listens on 8880 internally; the image metadata
            # advertises 8000/tcp, which is wrong (the entrypoint runs
            # uvicorn with PORT=8880).
            voiceHostPort = 8925;
            voiceContainerPort = 8880;
            # Speech-to-text (Whisper) service.
            sttImage = "docker.io/fedirz/faster-whisper-server:latest-cpu";
            sttHostPort = 9000;
            sttContainerPort = 8000;
            sttModel = "deepdml/faster-whisper-large-v3-turbo-ct2";
            sttModelSize = "large-v3-turbo";
          in
          {
            options.programs.auradesk = {
              enable = lib.mkEnableOption "AuraDesk desktop application";
              package = lib.mkOption {
                type = lib.types.package;
                default = packages.auradesk;
                description = "AuraDesk package to install.";
              };
              mcp = {
                enable = lib.mkEnableOption "AuraDesk MCP server";
                package = lib.mkOption {
                  type = lib.types.package;
                  default = packages."auradesk-mcp";
                  description = "AuraDesk MCP package to install.";
                };
              };
              voice = {
                enable = lib.mkEnableOption "AuraDesk local voice service (Kokoro TTS)";
                image = lib.mkOption {
                  type = lib.types.str;
                  default = voiceImage;
                  description = "Container image providing the local voice service.";
                };
                port = lib.mkOption {
                  type = lib.types.port;
                  default = voiceHostPort;
                  description = "Host port the voice service is published on (loopback only).";
                };
                stt = {
                  enable = lib.mkEnableOption "AuraDesk local speech-to-text service (Whisper)";
                  image = lib.mkOption {
                    type = lib.types.str;
                    default = sttImage;
                    description = "Container image providing the local speech-to-text service.";
                  };
                  port = lib.mkOption {
                    type = lib.types.port;
                    default = sttHostPort;
                    description = "Host port the speech-to-text service is published on (loopback only).";
                  };
                  model = lib.mkOption {
                    type = lib.types.str;
                    default = sttModel;
                    description = "Whisper model used for transcription.";
                  };
                  modelSize = lib.mkOption {
                    type = lib.types.str;
                    default = sttModelSize;
                    description = "Model size label expected by the speech-to-text server.";
                  };
                };
              };
            };

            config = lib.mkIf cfg.enable {
              environment.systemPackages = [ cfg.package ]
                ++ lib.optional cfg.mcp.enable cfg.mcp.package;

              # The voice stack needs a container runtime. Enabling it here
              # removes the "install Podman first" step from the user's
              # checklist.
              virtualisation.podman.enable = lib.mkIf cfg.voice.enable true;

              systemd.services = lib.mkIf cfg.voice.enable {
                auradesk-voice = {
                  description = "AuraDesk local voice service (Kokoro TTS)";
                  wantedBy = [ "multi-user.target" ];
                  after = [ "network-online.target" ];
                  wants = [ "network-online.target" ];

                  serviceConfig = {
                    Type = "simple";
                    Restart = "always";
                    RestartSec = 5;
                    # Pull once; ExecStart then reuses the cached image.
                    ExecStartPre = "${pkgs.podman}/bin/podman pull ${cfg.voice.image}";
                    ExecStart = lib.concatStringsSep " " [
                      "${pkgs.podman}/bin/podman"
                      "run"
                      "--rm"
                      "--name"
                      "auradesk-voice"
                      "-p"
                      "127.0.0.1:${toString cfg.voice.port}:${toString voiceContainerPort}"
                      cfg.voice.image
                    ];
                    # The image is several GB; a restart must not re-pull it.
                    ExecStop = "${pkgs.podman}/bin/podman stop --ignore auradesk-voice";
                  };
                };

                auradesk-stt = {
                  description = "AuraDesk local speech-to-text service (Whisper)";
                  wantedBy = [ "multi-user.target" ];
                  after = [ "network-online.target" ];
                  wants = [ "network-online.target" ];

                  serviceConfig = {
                    Type = "simple";
                    Restart = "always";
                    RestartSec = 5;
                    ExecStartPre = "${pkgs.podman}/bin/podman pull ${cfg.voice.stt.image}";
                    ExecStart = lib.concatStringsSep " " [
                      "${pkgs.podman}/bin/podman"
                      "run"
                      "--rm"
                      "--name"
                      "auradesk-stt"
                      "-p"
                      "127.0.0.1:${toString cfg.voice.stt.port}:${toString sttContainerPort}"
                      "-e"
                      "ASR_MODEL=${cfg.voice.stt.model}"
                      "-e"
                      "ASR_MODEL_SIZE=${cfg.voice.stt.modelSize}"
                      "-e"
                      "ASR_ENGINE=ct2"
                      cfg.voice.stt.image
                    ];
                    ExecStop = "${pkgs.podman}/bin/podman stop --ignore auradesk-stt";
                  };
                };
              };
            };
          };
      });
}
