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
            aptosCli      # For local Docker e2e testing
            movementCli   # For testnet deployment
            # Solana CLI installed via official script in shellHook (needs writable dir for platform-tools)
            # SVM builds use scripts/build.sh which handles Solana's toolchain requirements
          ];

          shellHook = ''
            # Solana/Anchor/rustup tools path (added AFTER Nix tools, so Nix Rust takes precedence)
            # SVM build script explicitly uses rustup's cargo when needed
            export PATH="$PATH:$HOME/.cargo/bin:$HOME/.local/share/solana/install/active_release/bin:$HOME/.avm/bin"
            
            # Install rustup if not already installed (needed for Solana's +toolchain syntax)
            if ! command -v rustup > /dev/null 2>&1; then
              echo "[nix] Installing rustup (needed for Solana builds)..."
              curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable 2>/dev/null || true
            fi
            
            # Install Solana CLI if not already installed (official installer, writable location)
            if ! command -v solana > /dev/null 2>&1; then
              echo "[nix] Installing Solana CLI..."
              sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)" 2>/dev/null || true
            fi
            
            # Install Anchor via avm if not already installed
            if ! command -v anchor > /dev/null 2>&1; then
              echo "[nix] Installing Anchor CLI via avm..."
              $HOME/.cargo/bin/cargo install --git https://github.com/coral-xyz/anchor avm --force --locked 2>/dev/null || true
              # Uninstall any anchor-cli that cargo installed (avm manages anchor separately)
              $HOME/.cargo/bin/cargo uninstall anchor-cli 2>/dev/null || true
              rm -f $HOME/.cargo/bin/anchor 2>/dev/null || true
              # Install and use non-interactively (yes provides continuous 'y' for any prompts)
              # Use rustup's cargo (supports +toolchain syntax required by avm) - subshell ensures PATH applies to avm
              echo "[nix] Installing Anchor 0.29.0..."
              (export PATH="$HOME/.cargo/bin:$PATH"; yes | avm install 0.29.0 2>&1) || true
              echo "[nix] Selecting Anchor 0.29.0..."
              (export PATH="$HOME/.cargo/bin:$PATH"; yes | avm use 0.29.0 2>&1) || true
            fi
            
            echo "[nix] Dev shell ready: rustc $(rustc --version 2>/dev/null | awk '{print $2}' || echo 'not installed') | cargo $(cargo --version 2>/dev/null | awk '{print $2}' || echo 'not installed') | aptos $(aptos --version 2>/dev/null || echo 'unknown') | movement $(movement --version 2>/dev/null || echo 'unknown') | solana $(solana --version 2>/dev/null | head -1 | awk '{print $2}' || echo 'not installed') | anchor $(anchor --version 2>/dev/null | awk '{print $2}' || echo 'not installed') | node $(node --version 2>/dev/null || echo 'unknown')"
            export OPENSSL_DIR=${pkgs.openssl.dev}
            export OPENSSL_LIB_DIR=${pkgs.openssl.out}/lib
            export OPENSSL_INCLUDE_DIR=${pkgs.openssl.dev}/include
          '';
        };
      }
    );
}
