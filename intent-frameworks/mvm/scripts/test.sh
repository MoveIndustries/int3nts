#!/usr/bin/env bash
# MVM Intent Framework Test Script
#
# Runs Move tests for all 3 MVM packages: intent-gmp, intent-hub, intent-connected.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(dirname "$(dirname "$PROJECT_DIR")")"

# If not in nix shell, re-exec inside nix develop ./nix
if [ -z "$IN_NIX_SHELL" ]; then
    echo "[test.sh] Entering nix develop ./nix..."
    exec env NIX_CONFIG="warn-dirty = false" nix develop "$REPO_ROOT/nix" -c bash "$0" "$@"
fi

cd "$PROJECT_DIR"

echo "[test.sh] Running intent-gmp tests..."
cd intent-gmp
movement move test --dev --named-addresses mvmt_intent=0x123 "$@"

echo ""
echo "[test.sh] Running intent-hub tests..."
cd ../intent-hub
movement move test --dev --named-addresses mvmt_intent=0x123 "$@"

echo ""
echo "[test.sh] Running intent-connected tests..."
cd ../intent-connected
movement move test --dev --named-addresses mvmt_intent=0x123 "$@"

echo ""
echo "[test.sh] All MVM tests passed!"
