#!/usr/bin/env bash
# SVM Intent Framework GMP Initialization Script
#
# Initializes GMP endpoint, outflow validator, escrow GMP config, and routing.
# Run AFTER deploy.sh and initialize.sh.
#
# Required env vars:
#   SVM_PROGRAM_ID            - Escrow program ID
#   SVM_GMP_ENDPOINT_ID       - GMP endpoint program ID
#   SVM_OUTFLOW_VALIDATOR_ID  - Outflow validator program ID
#   SVM_CHAIN_ID              - This chain's ID (e.g., 4)
#   HUB_MODULE_ADDR           - Hub module address (64-char hex, no 0x prefix)
#
# Optional env vars:
#   HUB_CHAIN_ID              - Hub chain ID (default: 1)
#   SVM_RELAY_PUBKEY          - Relay pubkey (base58) to authorize
#   SVM_RPC_URL               - RPC endpoint (default: http://localhost:8899)
#   SVM_PAYER_KEYPAIR         - Payer keypair (default: ~/.config/solana/id.json)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(dirname "$PROJECT_DIR")"

# If not in nix shell, re-exec inside nix develop ./nix
if [ -z "$IN_NIX_SHELL" ]; then
    echo "[initialize-gmp.sh] Entering nix develop ./nix..."
    exec env NIX_CONFIG="warn-dirty = false" nix develop "$REPO_ROOT/nix" -c bash "$0" "$@"
fi

SVM_RPC_URL="${SVM_RPC_URL:-http://localhost:8899}"
SVM_PAYER_KEYPAIR="${SVM_PAYER_KEYPAIR:-$HOME/.config/solana/id.json}"
HUB_CHAIN_ID="${HUB_CHAIN_ID:-1}"

# Validate required env vars
if [ -z "$SVM_PROGRAM_ID" ]; then
    echo "[initialize-gmp.sh] Missing SVM_PROGRAM_ID"
    exit 1
fi

if [ -z "$SVM_GMP_ENDPOINT_ID" ]; then
    echo "[initialize-gmp.sh] Missing SVM_GMP_ENDPOINT_ID"
    exit 1
fi

if [ -z "$SVM_OUTFLOW_VALIDATOR_ID" ]; then
    echo "[initialize-gmp.sh] Missing SVM_OUTFLOW_VALIDATOR_ID"
    exit 1
fi

if [ -z "$SVM_CHAIN_ID" ]; then
    echo "[initialize-gmp.sh] Missing SVM_CHAIN_ID"
    exit 1
fi

if [ -z "$HUB_MODULE_ADDR" ]; then
    echo "[initialize-gmp.sh] Missing HUB_MODULE_ADDR"
    exit 1
fi

cd "$PROJECT_DIR"

CLI_BIN="$PROJECT_DIR/target/debug/intent_escrow_cli"
if [ ! -x "$CLI_BIN" ]; then
    echo "[initialize-gmp.sh] intent_escrow_cli not built. Run 'cargo build -p intent_escrow_cli' first."
    exit 1
fi

# Strip 0x prefix from hub address if present
HUB_ADDR_CLEAN=$(echo "$HUB_MODULE_ADDR" | sed 's/^0x//')
# Pad to 64 hex characters (32 bytes)
HUB_ADDR_PADDED=$(printf "%064s" "$HUB_ADDR_CLEAN" | tr ' ' '0')

echo "[initialize-gmp.sh] Initializing GMP on SVM"
echo "  Chain ID: $SVM_CHAIN_ID"
echo "  Hub chain ID: $HUB_CHAIN_ID"
echo "  Hub address: 0x$HUB_ADDR_PADDED"
echo ""

# 1. Initialize GMP endpoint
echo "[initialize-gmp.sh] Initializing GMP endpoint..."
"$CLI_BIN" gmp-init \
    --gmp-program-id "$SVM_GMP_ENDPOINT_ID" \
    --payer "$SVM_PAYER_KEYPAIR" \
    --chain-id "$SVM_CHAIN_ID" \
    --rpc "$SVM_RPC_URL"

# 2. Add relay (optional)
if [ -n "$SVM_RELAY_PUBKEY" ]; then
    echo "[initialize-gmp.sh] Adding relay: $SVM_RELAY_PUBKEY"
    "$CLI_BIN" gmp-add-relay \
        --gmp-program-id "$SVM_GMP_ENDPOINT_ID" \
        --payer "$SVM_PAYER_KEYPAIR" \
        --relay "$SVM_RELAY_PUBKEY" \
        --rpc "$SVM_RPC_URL"
fi

# 3. Set hub as trusted remote
echo "[initialize-gmp.sh] Setting hub (chain_id=$HUB_CHAIN_ID) as trusted remote..."
"$CLI_BIN" gmp-set-trusted-remote \
    --gmp-program-id "$SVM_GMP_ENDPOINT_ID" \
    --payer "$SVM_PAYER_KEYPAIR" \
    --src-chain-id "$HUB_CHAIN_ID" \
    --trusted-addr "$HUB_ADDR_PADDED" \
    --rpc "$SVM_RPC_URL"

# 4. Initialize outflow validator
echo "[initialize-gmp.sh] Initializing outflow validator..."
"$CLI_BIN" outflow-init \
    --outflow-program-id "$SVM_OUTFLOW_VALIDATOR_ID" \
    --payer "$SVM_PAYER_KEYPAIR" \
    --gmp-endpoint "$SVM_GMP_ENDPOINT_ID" \
    --hub-chain-id "$HUB_CHAIN_ID" \
    --hub-address "$HUB_ADDR_PADDED" \
    --rpc "$SVM_RPC_URL"

# 5. Configure escrow GMP
echo "[initialize-gmp.sh] Configuring escrow GMP..."
"$CLI_BIN" escrow-set-gmp-config \
    --program-id "$SVM_PROGRAM_ID" \
    --payer "$SVM_PAYER_KEYPAIR" \
    --hub-chain-id "$HUB_CHAIN_ID" \
    --hub-address "$HUB_ADDR_PADDED" \
    --gmp-endpoint "$SVM_GMP_ENDPOINT_ID" \
    --rpc "$SVM_RPC_URL"

# 6. Set GMP routing
echo "[initialize-gmp.sh] Configuring GMP routing..."
"$CLI_BIN" gmp-set-routing \
    --gmp-program-id "$SVM_GMP_ENDPOINT_ID" \
    --payer "$SVM_PAYER_KEYPAIR" \
    --outflow-validator "$SVM_OUTFLOW_VALIDATOR_ID" \
    --intent-escrow "$SVM_PROGRAM_ID" \
    --rpc "$SVM_RPC_URL"

# Summary
echo ""
echo "[initialize-gmp.sh] GMP initialization complete!"
echo "  Escrow: $SVM_PROGRAM_ID"
echo "  GMP endpoint: $SVM_GMP_ENDPOINT_ID"
echo "  Outflow validator: $SVM_OUTFLOW_VALIDATOR_ID"
echo "  Relay: ${SVM_RELAY_PUBKEY:-<not configured>}"
