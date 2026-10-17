{
  description = "AuraDesk — desktop productivity (Linux + Windows), Hermes Agent integration. Linux-only dev shell; Windows builds via CI and local Tauri CLI.";

  inputs = {
    # Track nixos-unstable: matches rolling-release distros (Omarchy etc.).
    # Pin to a specific commit via flake.lock; roll forward deliberately.
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

    # rust-overlay provides version-pinned Rust toolchains.
    # Tauri 2.12.4 (stable 2026-10-14) raises MSRV to 1.90. We pin
    # exactly 1.90.0 — Tauri MSRV, not bleeding edge, not pre-Tauri-2.12.
    # Compatibility of the full dep set is verified when Cargo.toml is
    # created in T2.
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
      in
      {
        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            # --- Rust toolchain (Tauri 2.12 MSRV) ---
            rust

            # --- Node + package manager ---
            nodejs_22      # LTS "Jod"; matches Tauri 2 ecosystem
            pnpm           # workspace package manager (Phase 0 plan)

            # --- C toolchain ---
            pkg-config
            openssl

            # --- Tauri 2.12 Linux runtime deps (official Tauri docs,
            #     mapped to Nixpkgs attribute names verified via
            #     nix-instantiate --eval against nixos-unstable) ---
            webkitgtk_4_1             # webkit2gtk-4.1 (Nix attr name omits the "2")
            gtk3                       # transitive but explicit
            libsoup_3                  # webkit2gtk-4.1 in Tauri 2.12 uses libsoup-3.0
            libayatana-appindicator    # system tray (libayatana-appindicator3.pc)
            librsvg                    # SVG icon rendering
            # libxdo is not in nixpkgs; needed only for tauri-driver
            # E2E tests (Phase 5). Documented as Phase 5 prep, not
            # required for Phase 0/1/2/3/4.

            # --- Utilities ---
            curl
            wget
            file
            xdg-utils
            binaryen                   # wasm bundling (not used Phase 0; ready for later)

            # --- Phase 3 prep (Hyprland monitor hot-plug, R-L4) ---
            wayland
            wlr-protocols
          ];

          # Hardening: prevent toolchain leakage from /etc/profile.d etc.
          # Tauri's build scripts use pkg-config correctly; strictDeps is
          # safe for our intended toolchain. If a future crate needs an
          # extra header, fall back by removing this flag with a comment.
          strictDeps = true;

          shellHook = ''
            # Toolchain hints for the Tauri build process. PKG_CONFIG_PATH
            # is the union of all Tauri 2.12 .pc file directories; built
            # by `pkgs.lib.makeSearchPath` so we don't hand-maintain it.
            export PKG_CONFIG_PATH="${pkgConfigPath}"
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
          '';
        };
      });
}
