#!/usr/bin/env bash
# SVM Intent Framework Test Script
#
# Builds the program and runs tests using solana-test-validator + TypeScript tests.
# No Anchor required.

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

# Run Rust tests (native Solana, no validator required)
echo "[test.sh] Running Rust tests..."
cargo test -p intent_escrow --tests -- --nocapture "$@"
