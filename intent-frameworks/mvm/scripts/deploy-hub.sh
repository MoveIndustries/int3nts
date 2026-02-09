#!/usr/bin/env bash
# MVM Intent Framework Deploy Script - Hub Chain
#
# Deploys intent-gmp and intent-hub packages and initializes all GMP modules.
#
# Required env vars:
#   MVM_PROFILE       - Movement CLI profile name (e.g., "default")
#   MVM_MODULE_ADDR   - Deployer/module address for --named-addresses mvmt_intent=<addr>
#   MVM_CHAIN_ID      - Hub chain ID (e.g., 1)
#
# Optional env vars:
#   RELAY_ADDRESS         - Relay Move address to authorize in intent_gmp
#   CONNECTED_CHAIN_ID    - Connected chain's chain ID, for set_trusted_remote
#   CONNECTED_CHAIN_ADDR  - Connected chain's module address (hex), for set_trusted_remote

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(dirname "$(dirname "$PROJECT_DIR")")"

# If not in nix shell, re-exec inside nix develop ./nix
if [ -z "$IN_NIX_SHELL" ]; then
    echo "[deploy-hub.sh] Entering nix develop ./nix..."
    exec env NIX_CONFIG="warn-dirty = false" nix develop "$REPO_ROOT/nix" -c bash "$0" "$@"
fi

# Validate required env vars
if [ -z "$MVM_PROFILE" ]; then
    echo "[deploy-hub.sh] Missing MVM_PROFILE"
    exit 1
fi

if [ -z "$MVM_MODULE_ADDR" ]; then
    echo "[deploy-hub.sh] Missing MVM_MODULE_ADDR"
    exit 1
fi

if [ -z "$MVM_CHAIN_ID" ]; then
    echo "[deploy-hub.sh] Missing MVM_CHAIN_ID"
    exit 1
fi

cd "$PROJECT_DIR"

echo "[deploy-hub.sh] Deploying hub chain with address: $MVM_MODULE_ADDR"
echo ""

# 1. Deploy intent-gmp package (base layer)
echo "[deploy-hub.sh] Publishing intent-gmp..."
cd intent-gmp
movement move publish --dev --profile "$MVM_PROFILE" \
    --named-addresses mvmt_intent="$MVM_MODULE_ADDR" \
    --assume-yes --max-gas 500000 --gas-unit-price 100
echo "[deploy-hub.sh] intent-gmp published"

# 2. Deploy intent-hub package (depends on intent-gmp)
# Note: intent-hub exceeds 60KB limit, requires --chunked-publish
echo "[deploy-hub.sh] Publishing intent-hub (chunked)..."
cd ../intent-hub
movement move publish --dev --profile "$MVM_PROFILE" \
    --named-addresses mvmt_intent="$MVM_MODULE_ADDR" \
    --assume-yes --chunked-publish --max-gas 500000 --gas-unit-price 100
echo "[deploy-hub.sh] intent-hub published"

cd "$PROJECT_DIR"

# 3. Initialize modules
echo ""
echo "[deploy-hub.sh] Initializing modules..."

echo "[deploy-hub.sh] Initializing fa_intent (chain_id=$MVM_CHAIN_ID)..."
movement move run --profile "$MVM_PROFILE" --assume-yes \
    --function-id "${MVM_MODULE_ADDR}::fa_intent::initialize" \
    --args "u64:$MVM_CHAIN_ID"

echo "[deploy-hub.sh] Initializing solver_registry..."
movement move run --profile "$MVM_PROFILE" --assume-yes \
    --function-id "${MVM_MODULE_ADDR}::solver_registry::initialize"

echo "[deploy-hub.sh] Initializing intent_registry..."
movement move run --profile "$MVM_PROFILE" --assume-yes \
    --function-id "${MVM_MODULE_ADDR}::intent_registry::initialize"

echo "[deploy-hub.sh] Initializing intent_gmp..."
movement move run --profile "$MVM_PROFILE" --assume-yes \
    --function-id "${MVM_MODULE_ADDR}::intent_gmp::initialize"

echo "[deploy-hub.sh] Initializing intent_gmp_hub..."
movement move run --profile "$MVM_PROFILE" --assume-yes \
    --function-id "${MVM_MODULE_ADDR}::intent_gmp_hub::initialize"

echo "[deploy-hub.sh] Initializing gmp_intent_state..."
movement move run --profile "$MVM_PROFILE" --assume-yes \
    --function-id "${MVM_MODULE_ADDR}::gmp_intent_state::initialize"

echo "[deploy-hub.sh] Initializing gmp_sender..."
movement move run --profile "$MVM_PROFILE" --assume-yes \
    --function-id "${MVM_MODULE_ADDR}::gmp_sender::initialize"

# 4. Add relay (optional)
if [ -n "$RELAY_ADDRESS" ]; then
    echo ""
    echo "[deploy-hub.sh] Adding relay: $RELAY_ADDRESS"
    movement move run --profile "$MVM_PROFILE" --assume-yes \
        --function-id "${MVM_MODULE_ADDR}::intent_gmp::add_relay" \
        --args "address:${RELAY_ADDRESS}"
    echo "[deploy-hub.sh] Relay added"
fi

# 5. Set trusted remote for connected chain (optional)
if [ -n "$CONNECTED_CHAIN_ID" ] && [ -n "$CONNECTED_CHAIN_ADDR" ]; then
    # Pad address to 64 hex characters (32 bytes)
    ADDR_CLEAN=$(echo "$CONNECTED_CHAIN_ADDR" | sed 's/^0x//')
    ADDR_PADDED=$(printf "%064s" "$ADDR_CLEAN" | tr ' ' '0')

    echo ""
    echo "[deploy-hub.sh] Setting trusted remote for chain $CONNECTED_CHAIN_ID: 0x$ADDR_PADDED"
    movement move run --profile "$MVM_PROFILE" --assume-yes \
        --function-id "${MVM_MODULE_ADDR}::intent_gmp::set_trusted_remote" \
        --args "u32:$CONNECTED_CHAIN_ID" "hex:${ADDR_PADDED}"

    movement move run --profile "$MVM_PROFILE" --assume-yes \
        --function-id "${MVM_MODULE_ADDR}::intent_gmp_hub::set_trusted_remote" \
        --args "u32:$CONNECTED_CHAIN_ID" "hex:${ADDR_PADDED}"
    echo "[deploy-hub.sh] Trusted remote set"
fi

# Summary
echo ""
echo "[deploy-hub.sh] Hub deployment complete!"
echo "  Module address: $MVM_MODULE_ADDR"
echo "  Chain ID: $MVM_CHAIN_ID"
echo "  Relay: ${RELAY_ADDRESS:-<not configured>}"
echo "  Trusted remote: ${CONNECTED_CHAIN_ID:+chain $CONNECTED_CHAIN_ID}${CONNECTED_CHAIN_ID:-<not configured>}"
