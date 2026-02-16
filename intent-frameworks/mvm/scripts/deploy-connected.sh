#!/usr/bin/env bash
# MVM Intent Framework Deploy Script - Connected Chain
#
# Deploys intent-gmp and intent-connected packages and initializes all GMP modules
# including outflow validator and inflow escrow with hub chain configuration.
#
# Required env vars:
#   MVM_PROFILE       - Movement CLI profile name (e.g., "default")
#   MVM_MODULE_ADDR   - Deployer/module address for --named-addresses mvmt_intent=<addr>
#   MVM_CHAIN_ID      - This connected chain's ID (e.g., 2)
#   HUB_MODULE_ADDR   - Hub module address (hex, 0x-prefixed or plain)
#
# Optional env vars:
#   HUB_CHAIN_ID      - Hub chain ID (default: 1)
#   RELAY_ADDRESS     - Relay Move address to authorize in intent_gmp

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(dirname "$(dirname "$PROJECT_DIR")")"

# If not in nix shell, re-exec inside nix develop ./nix
if [ -z "$IN_NIX_SHELL" ]; then
    echo "[deploy-connected.sh] Entering nix develop ./nix..."
    exec env NIX_CONFIG="warn-dirty = false" nix develop "$REPO_ROOT/nix" -c bash "$0" "$@"
fi

# Validate required env vars
if [ -z "$MVM_PROFILE" ]; then
    echo "[deploy-connected.sh] Missing MVM_PROFILE"
    exit 1
fi

if [ -z "$MVM_MODULE_ADDR" ]; then
    echo "[deploy-connected.sh] Missing MVM_MODULE_ADDR"
    exit 1
fi

if [ -z "$MVM_CHAIN_ID" ]; then
    echo "[deploy-connected.sh] Missing MVM_CHAIN_ID"
    exit 1
fi

if [ -z "$HUB_MODULE_ADDR" ]; then
    echo "[deploy-connected.sh] Missing HUB_MODULE_ADDR"
    exit 1
fi

HUB_CHAIN_ID="${HUB_CHAIN_ID:-1}"

# Pad hub address to 64 hex characters (32 bytes)
HUB_ADDR_CLEAN=$(echo "$HUB_MODULE_ADDR" | sed 's/^0x//')
HUB_ADDR_PADDED=$(printf "%064s" "$HUB_ADDR_CLEAN" | tr ' ' '0')

cd "$PROJECT_DIR"

echo "[deploy-connected.sh] Deploying connected chain with address: $MVM_MODULE_ADDR"
echo "[deploy-connected.sh] Hub: chain_id=$HUB_CHAIN_ID addr=0x$HUB_ADDR_PADDED"
echo ""

# 1. Deploy intent-gmp package (base layer)
echo "[deploy-connected.sh] Publishing intent-gmp..."
cd intent-gmp
movement move publish --dev --profile "$MVM_PROFILE" \
    --named-addresses mvmt_intent="$MVM_MODULE_ADDR" \
    --assume-yes --included-artifacts none --max-gas 500000 --gas-unit-price 100
echo "[deploy-connected.sh] intent-gmp published"

# 2. Deploy intent-connected package (depends on intent-gmp)
echo "[deploy-connected.sh] Publishing intent-connected..."
cd ../intent-connected
movement move publish --dev --profile "$MVM_PROFILE" \
    --named-addresses mvmt_intent="$MVM_MODULE_ADDR" \
    --assume-yes --included-artifacts none --max-gas 500000 --gas-unit-price 100
echo "[deploy-connected.sh] intent-connected published"

cd "$PROJECT_DIR"

# 3. Initialize shared modules
echo ""
echo "[deploy-connected.sh] Initializing modules..."

echo "[deploy-connected.sh] Initializing fa_intent (chain_id=$MVM_CHAIN_ID)..."
movement move run --profile "$MVM_PROFILE" --assume-yes \
    --function-id "${MVM_MODULE_ADDR}::fa_intent::initialize" \
    --args "u64:$MVM_CHAIN_ID"

echo "[deploy-connected.sh] Initializing solver_registry..."
movement move run --profile "$MVM_PROFILE" --assume-yes \
    --function-id "${MVM_MODULE_ADDR}::solver_registry::initialize"

echo "[deploy-connected.sh] Initializing intent_registry..."
movement move run --profile "$MVM_PROFILE" --assume-yes \
    --function-id "${MVM_MODULE_ADDR}::intent_registry::initialize"

echo "[deploy-connected.sh] Initializing intent_gmp..."
movement move run --profile "$MVM_PROFILE" --assume-yes \
    --function-id "${MVM_MODULE_ADDR}::intent_gmp::initialize"

echo "[deploy-connected.sh] Initializing gmp_intent_state..."
movement move run --profile "$MVM_PROFILE" --assume-yes \
    --function-id "${MVM_MODULE_ADDR}::gmp_intent_state::initialize"

echo "[deploy-connected.sh] Initializing gmp_sender..."
movement move run --profile "$MVM_PROFILE" --assume-yes \
    --function-id "${MVM_MODULE_ADDR}::gmp_sender::initialize"

# 4. Initialize connected-chain-specific modules with hub config
echo ""
echo "[deploy-connected.sh] Initializing outflow validator (hub_chain_id=$HUB_CHAIN_ID)..."
movement move run --profile "$MVM_PROFILE" --assume-yes \
    --function-id "${MVM_MODULE_ADDR}::intent_outflow_validator_impl::initialize" \
    --args "u32:$HUB_CHAIN_ID" "hex:${HUB_ADDR_PADDED}"

echo "[deploy-connected.sh] Initializing inflow escrow (hub_chain_id=$HUB_CHAIN_ID)..."
movement move run --profile "$MVM_PROFILE" --assume-yes \
    --function-id "${MVM_MODULE_ADDR}::intent_inflow_escrow::initialize" \
    --args "u32:$HUB_CHAIN_ID" "hex:${HUB_ADDR_PADDED}"

# 5. Set remote GMP endpoint for hub chain
echo "[deploy-connected.sh] Setting remote GMP endpoint for hub (chain_id=$HUB_CHAIN_ID)..."
movement move run --profile "$MVM_PROFILE" --assume-yes \
    --function-id "${MVM_MODULE_ADDR}::intent_gmp::set_remote_gmp_endpoint_addr" \
    --args "u32:$HUB_CHAIN_ID" "hex:${HUB_ADDR_PADDED}"

# 6. Add relay (optional)
if [ -n "$RELAY_ADDRESS" ]; then
    echo ""
    echo "[deploy-connected.sh] Adding relay: $RELAY_ADDRESS"
    movement move run --profile "$MVM_PROFILE" --assume-yes \
        --function-id "${MVM_MODULE_ADDR}::intent_gmp::add_relay" \
        --args "address:${RELAY_ADDRESS}"
    echo "[deploy-connected.sh] Relay added"
fi

# Summary
echo ""
echo "[deploy-connected.sh] Connected chain deployment complete!"
echo "  Module address: $MVM_MODULE_ADDR"
echo "  Chain ID: $MVM_CHAIN_ID"
echo "  Hub chain ID: $HUB_CHAIN_ID"
echo "  Hub address: 0x$HUB_ADDR_PADDED"
echo "  Relay: ${RELAY_ADDRESS:-<not configured>}"
