#!/usr/bin/env bash
# SVM Intent Framework Deploy Script
#
# Builds and deploys all 3 Solana programs: intent_inflow_escrow, intent_gmp,
# intent_outflow_validator.
#
# Optional env vars:
#   SOLANA_URL        - Validator endpoint (default: http://localhost:8899)
#   PROGRAM_KEYPAIR   - Escrow keypair (default: target/deploy/intent_inflow_escrow-keypair.json)
#   PROGRAM_SO        - Escrow binary (default: target/deploy/intent_inflow_escrow.so)
#   GMP_KEYPAIR       - GMP endpoint keypair (default: target/deploy/intent_gmp-keypair.json)
#   GMP_SO            - GMP endpoint binary (default: target/deploy/intent_gmp.so)
#   OUTFLOW_KEYPAIR   - Outflow validator keypair (default: target/deploy/intent_outflow_validator-keypair.json)
#   OUTFLOW_SO        - Outflow validator binary (default: target/deploy/intent_outflow_validator.so)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(dirname "$PROJECT_DIR")"

# If not in nix shell, re-exec inside nix develop ./nix
if [ -z "$IN_NIX_SHELL" ]; then
    echo "[deploy.sh] Entering nix develop ./nix..."
    exec nix develop "$REPO_ROOT/nix" -c bash "$0" "$@"
fi

cd "$PROJECT_DIR"

SOLANA_URL="${SOLANA_URL:-http://localhost:8899}"

# Program paths
PROGRAM_KEYPAIR="${PROGRAM_KEYPAIR:-$PROJECT_DIR/target/deploy/intent_inflow_escrow-keypair.json}"
PROGRAM_SO="${PROGRAM_SO:-$PROJECT_DIR/target/deploy/intent_inflow_escrow.so}"
GMP_KEYPAIR="${GMP_KEYPAIR:-$PROJECT_DIR/target/deploy/intent_gmp-keypair.json}"
GMP_SO="${GMP_SO:-$PROJECT_DIR/target/deploy/intent_gmp.so}"
OUTFLOW_KEYPAIR="${OUTFLOW_KEYPAIR:-$PROJECT_DIR/target/deploy/intent_outflow_validator-keypair.json}"
OUTFLOW_SO="${OUTFLOW_SO:-$PROJECT_DIR/target/deploy/intent_outflow_validator.so}"

echo "[deploy.sh] Building all programs..."
./scripts/build.sh

# Helper: deploy a single program
deploy_program() {
    local name="$1"
    local keypair="$2"
    local so="$3"

    if [ ! -f "$keypair" ]; then
        echo "[deploy.sh] Missing $name keypair: $keypair"
        echo "[deploy.sh] Create one with: solana-keygen new --no-bip39-passphrase -o \"$keypair\""
        exit 1
    fi

    if [ ! -f "$so" ]; then
        echo "[deploy.sh] Missing $name binary: $so"
        exit 1
    fi

    echo "[deploy.sh] Deploying $name to $SOLANA_URL..."
    solana program deploy --url "$SOLANA_URL" "$so" --program-id "$keypair"
}

# Deploy all 3 programs
deploy_program "intent_inflow_escrow" "$PROGRAM_KEYPAIR" "$PROGRAM_SO"
deploy_program "intent_gmp" "$GMP_KEYPAIR" "$GMP_SO"
deploy_program "intent_outflow_validator" "$OUTFLOW_KEYPAIR" "$OUTFLOW_SO"

# Print all program IDs
ESCROW_ID="$(solana address -k "$PROGRAM_KEYPAIR")"
GMP_ID="$(solana address -k "$GMP_KEYPAIR")"
OUTFLOW_ID="$(solana address -k "$OUTFLOW_KEYPAIR")"

echo ""
echo "[deploy.sh] All programs deployed:"
echo "  SVM_PROGRAM_ID=$ESCROW_ID"
echo "  SVM_GMP_ENDPOINT_ID=$GMP_ID"
echo "  SVM_OUTFLOW_VALIDATOR_ID=$OUTFLOW_ID"
