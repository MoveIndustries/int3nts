#!/usr/bin/env bash
# SVM Intent Framework Test Script
#
# Builds the program and runs anchor tests.
# Handles all setup: build, dependencies, keypair.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(dirname "$PROJECT_DIR")"

# If not in nix shell, re-exec inside nix develop
if [ -z "$IN_NIX_SHELL" ]; then
    echo "[test.sh] Entering nix develop..."
    exec nix develop "$REPO_ROOT" -c bash "$0" "$@"
fi

cd "$PROJECT_DIR"

# Build first
echo "[test.sh] Building program..."
"$SCRIPT_DIR/build.sh"

# Ensure dependencies are installed
if [ ! -d "node_modules" ]; then
    echo "[test.sh] Installing npm dependencies..."
    npm install
fi

# Ensure Solana keypair exists (required for anchor test)
if [ ! -f "$HOME/.config/solana/id.json" ]; then
    echo "[test.sh] Creating Solana keypair..."
    mkdir -p "$HOME/.config/solana"
    solana-keygen new --no-bip39-passphrase -o "$HOME/.config/solana/id.json" --force
fi

# Run tests
echo "[test.sh] Running anchor test..."
anchor test --skip-build "$@"
