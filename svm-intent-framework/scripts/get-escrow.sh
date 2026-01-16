#!/usr/bin/env bash
# SVM Intent Framework Get Escrow Script
#
# Reads the escrow account state by intent ID.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(dirname "$PROJECT_DIR")"

# If not in nix shell, re-exec inside nix develop
if [ -z "$IN_NIX_SHELL" ]; then
    echo "[get-escrow.sh] Entering nix develop..."
    exec nix develop "$REPO_ROOT" -c bash "$0" "$@"
fi

SVM_RPC_URL="${SVM_RPC_URL:-http://localhost:8899}"

if [ -z "$SVM_INTENT_ID" ]; then
    echo "[get-escrow.sh] Missing SVM_INTENT_ID"
    exit 1
fi

ARGS=(get-escrow --intent-id "$SVM_INTENT_ID" --rpc "$SVM_RPC_URL")
if [ -n "$SVM_PROGRAM_ID" ]; then
    ARGS+=(--program-id "$SVM_PROGRAM_ID")
fi

cd "$PROJECT_DIR"
cargo run -p intent_escrow_cli -- "${ARGS[@]}"
