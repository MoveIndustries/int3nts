{
  description = "Intent Framework dev shell";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };
        aptosCli = pkgs.callPackage ./aptos.nix {};
        movementCli = pkgs.callPackage ./movement.nix {};
      in
      {
        devShells.default = pkgs.mkShell {
          packages = [
            pkgs.rustc
            pkgs.cargo
            pkgs.rustfmt
            pkgs.clippy
            pkgs.jq
            pkgs.curl
            pkgs.bash
            pkgs.coreutils
            pkgs.openssl
            pkgs.pkg-config
            pkgs.nodejs
            pkgs.nodePackages.npm
            pkgs.git
            pkgs.libiconv  # Required for Rust on macOS
            aptosCli      # For E2E tests (always included - Nix package, cached in store)
            movementCli   # For Move tests (always included - Nix package, cached in store)
            # Note: Movement/Aptos are Nix packages evaluated at build time, so they can't be
            # conditionally excluded based on runtime env vars. They're cached in the Nix store
            # so disk space impact per CI job is minimal.
          ];

          shellHook = ''
            # Determine what tools are needed based on INTENT_FRAMEWORK_NEEDS env var
            # If not set (local dev), install everything for convenience
            NEEDS="${INTENT_FRAMEWORK_NEEDS:-move,evm,svm,solver,verifier,frontend}"
            
            # Solana/rustup tools path (added AFTER Nix tools, so Nix Rust takes precedence)
            # SVM build script explicitly uses rustup's cargo when needed
            export PATH="$PATH:$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin"
            
            # Install rustup if needed for SVM (Solana's +toolchain syntax)
            if echo "$NEEDS" | grep -q "svm"; then
              if ! command -v rustup > /dev/null 2>&1; then
                echo "[nix] Installing rustup (needed for Solana builds)..."
                curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable 2>/dev/null || true
              fi
              
              # Install Solana CLI if not already installed (official installer, writable location)
              # Required for SVM tests (cargo build-sbf)
              if ! command -v solana > /dev/null 2>&1; then
                echo "[nix] Installing Solana CLI..."
                sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)" 2>/dev/null || true
              fi
            fi
            
            echo "[nix] Dev shell ready: rustc $(rustc --version 2>/dev/null | awk '{print $2}' || echo 'not installed') | cargo $(cargo --version 2>/dev/null | awk '{print $2}' || echo 'not installed') | aptos $(aptos --version 2>/dev/null || echo 'unknown') | movement $(movement --version 2>/dev/null || echo 'unknown') | solana $(solana --version 2>/dev/null | head -1 | awk '{print $2}' || echo 'not installed') | node $(node --version 2>/dev/null || echo 'unknown')"
            
            export OPENSSL_DIR=${pkgs.openssl.dev}
            export OPENSSL_LIB_DIR=${pkgs.openssl.out}/lib
            export OPENSSL_INCLUDE_DIR=${pkgs.openssl.dev}/include
          '';
        };
      }
    );
}
