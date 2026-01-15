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

# Build first
echo "[test.sh] Building program..."
"$SCRIPT_DIR/build.sh"

# Ensure dependencies are installed
if [ ! -d "node_modules" ]; then
    echo "[test.sh] Installing npm dependencies..."
    npm install
fi

# Ensure Solana keypair exists
if [ ! -f "$HOME/.config/solana/id.json" ]; then
    echo "[test.sh] Creating Solana keypair..."
    mkdir -p "$HOME/.config/solana"
    solana-keygen new --no-bip39-passphrase -o "$HOME/.config/solana/id.json" --force
fi

# Run tests with npx (vitest or mocha based on setup)
echo "[test.sh] Running tests..."

# Start local validator in background
VALIDATOR_LOG="$PROJECT_DIR/.validator.log"
echo "[test.sh] Starting local validator..."
solana-test-validator \
    --bpf-program Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS target/deploy/intent_escrow.so \
    --reset \
    > "$VALIDATOR_LOG" 2>&1 &
VALIDATOR_PID=$!

# Wait for validator to be ready
echo "[test.sh] Waiting for validator..."
for i in {1..30}; do
    if solana cluster-version 2>/dev/null; then
        break
    fi
    sleep 1
done

# Configure CLI to use local
solana config set --url http://localhost:8899

# Run TypeScript tests
npx ts-mocha -p ./tsconfig.json -t 60000 tests/*.test.ts "$@" || {
    echo "[test.sh] Tests failed"
    kill $VALIDATOR_PID 2>/dev/null || true
    exit 1
}

# Cleanup
echo "[test.sh] Stopping validator..."
kill $VALIDATOR_PID 2>/dev/null || true

echo "[test.sh] Tests complete!"
