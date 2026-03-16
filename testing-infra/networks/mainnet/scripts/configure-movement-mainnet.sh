#!/bin/bash

# Configure Movement Mainnet - Set remote GMP endpoints for connected chains
#
# This script sets up cross-chain remote GMP endpoints on the Movement hub.
# Must be run AFTER all chain deployments are complete, because it needs
# the GMP endpoint addresses from connected chains.
#
# Requires:
#   - Movement CLI
#   - .env.mainnet with:
#     - MOVEMENT_INTENT_MODULE_ADDR (from deploy-to-movement-mainnet.sh)
#     - MOVEMENT_MODULE_PRIVATE_KEY (from deploy-to-movement-mainnet.sh)
#     - BASE_GMP_ENDPOINT_ADDR + BASE_CHAIN_ID (from deploy-to-base-mainnet.sh)
#     - HYPERLIQUID_GMP_ENDPOINT_ADDR + HYPERLIQUID_CHAIN_ID (from deploy-to-hyperliquid-mainnet.sh)
#     - INTEGRATED_GMP_MVM_ADDR (from get_relay_addresses) [optional, for relay auth]

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$( cd "$SCRIPT_DIR/../../../.." && pwd )"

source "$SCRIPT_DIR/../lib/env-utils.sh"

ASSETS_CONFIG="$SCRIPT_DIR/../config/mainnet-assets.toml"
MOVEMENT_RPC_URL="https://mainnet.movementnetwork.xyz/v1"

echo " Configuring Movement Mainnet (Remote GMP Endpoints)"
echo "============================================================"
echo ""

# Check for movement CLI
if ! command -v movement &> /dev/null; then
    echo "ERROR: movement CLI not found"
    exit 1
fi

# Load .env.mainnet
MAINNET_KEYS_FILE="$SCRIPT_DIR/../.env.mainnet"
if [ ! -f "$MAINNET_KEYS_FILE" ]; then
    echo "ERROR: .env.mainnet not found at $MAINNET_KEYS_FILE"
    exit 1
fi
if [ "${DEPLOY_ENV_SOURCED:-}" != "1" ]; then
    source "$MAINNET_KEYS_FILE"
fi

require_var "MOVEMENT_INTENT_MODULE_ADDR" "$MOVEMENT_INTENT_MODULE_ADDR" "Run deploy-to-movement-mainnet.sh first"
require_var "MOVEMENT_MODULE_PRIVATE_KEY" "$MOVEMENT_MODULE_PRIVATE_KEY" "Should have been saved by deploy-to-movement-mainnet.sh"

MODULE_ADDR="$MOVEMENT_INTENT_MODULE_ADDR"

# Create temporary Movement CLI profile with module admin key
TEMP_PROFILE="movement-configure-$$"
echo " Setting up admin profile..."
movement init --profile "$TEMP_PROFILE" \
  --network custom \
  --rest-url "$MOVEMENT_RPC_URL" \
  --faucet-url https://faucet.movementnetwork.xyz/ \
  --private-key "$MOVEMENT_MODULE_PRIVATE_KEY" \
  --skip-faucet \
  --assume-yes 2>/dev/null

echo "   Module address: $MODULE_ADDR"
echo ""

# --- Base Mainnet (EVM) ---
if [ -n "$BASE_GMP_ENDPOINT_ADDR" ]; then
    BASE_CHAIN_ID=$(get_chain_id "base_mainnet" "$ASSETS_CONFIG")
    echo " Setting remote GMP endpoint: Base Mainnet (chain $BASE_CHAIN_ID)..."

    ADDR_PADDED=$(pad_address_32 "$BASE_GMP_ENDPOINT_ADDR")
    echo "   Remote address: 0x$ADDR_PADDED"

    movement move run \
      --profile "$TEMP_PROFILE" \
      --function-id "${MODULE_ADDR}::intent_gmp::set_remote_gmp_endpoint_addr" \
      --args "u32:$BASE_CHAIN_ID" "hex:${ADDR_PADDED}" \
      --assume-yes

    verify_movement_view "$MOVEMENT_RPC_URL" \
        "${MODULE_ADDR}::intent_gmp::get_remote_gmp_endpoint_addrs" \
        "[$BASE_CHAIN_ID]" \
        "intent_gmp remote GMP endpoint for Base (chain $BASE_CHAIN_ID)"

    movement move run \
      --profile "$TEMP_PROFILE" \
      --function-id "${MODULE_ADDR}::intent_gmp_hub::set_remote_gmp_endpoint_addr" \
      --args "u32:$BASE_CHAIN_ID" "hex:${ADDR_PADDED}" \
      --assume-yes

    verify_movement_view "$MOVEMENT_RPC_URL" \
        "${MODULE_ADDR}::intent_gmp_hub::get_remote_gmp_endpoint_addr" \
        "[$BASE_CHAIN_ID]" \
        "intent_gmp_hub remote GMP endpoint for Base (chain $BASE_CHAIN_ID)"

    echo ""
else
    echo " SKIP: BASE_GMP_ENDPOINT_ADDR not set, skipping Base Mainnet"
    echo ""
fi

# --- HyperEVM Mainnet ---
if [ -n "$HYPERLIQUID_GMP_ENDPOINT_ADDR" ]; then
    HYPERLIQUID_CHAIN_ID=$(get_chain_id "hyperliquid_mainnet" "$ASSETS_CONFIG")
    echo " Setting remote GMP endpoint: HyperEVM Mainnet (chain $HYPERLIQUID_CHAIN_ID)..."

    ADDR_PADDED=$(pad_address_32 "$HYPERLIQUID_GMP_ENDPOINT_ADDR")
    echo "   Remote address: 0x$ADDR_PADDED"

    movement move run \
      --profile "$TEMP_PROFILE" \
      --function-id "${MODULE_ADDR}::intent_gmp::set_remote_gmp_endpoint_addr" \
      --args "u32:$HYPERLIQUID_CHAIN_ID" "hex:${ADDR_PADDED}" \
      --assume-yes

    verify_movement_view "$MOVEMENT_RPC_URL" \
        "${MODULE_ADDR}::intent_gmp::get_remote_gmp_endpoint_addrs" \
        "[$HYPERLIQUID_CHAIN_ID]" \
        "intent_gmp remote GMP endpoint for HyperEVM (chain $HYPERLIQUID_CHAIN_ID)"

    movement move run \
      --profile "$TEMP_PROFILE" \
      --function-id "${MODULE_ADDR}::intent_gmp_hub::set_remote_gmp_endpoint_addr" \
      --args "u32:$HYPERLIQUID_CHAIN_ID" "hex:${ADDR_PADDED}" \
      --assume-yes

    verify_movement_view "$MOVEMENT_RPC_URL" \
        "${MODULE_ADDR}::intent_gmp_hub::get_remote_gmp_endpoint_addr" \
        "[$HYPERLIQUID_CHAIN_ID]" \
        "intent_gmp_hub remote GMP endpoint for HyperEVM (chain $HYPERLIQUID_CHAIN_ID)"

    echo ""
else
    echo " SKIP: HYPERLIQUID_GMP_ENDPOINT_ADDR not set, skipping HyperEVM Mainnet"
    echo ""
fi

# --- Add GMP relay as authorized relay ---
if [ -n "$INTEGRATED_GMP_MVM_ADDR" ]; then
    echo " Adding GMP relay as authorized relay: $INTEGRATED_GMP_MVM_ADDR"
    movement move run \
      --profile "$TEMP_PROFILE" \
      --function-id "${MODULE_ADDR}::intent_gmp::add_relay" \
      --args "address:${INTEGRATED_GMP_MVM_ADDR}" \
      --assume-yes || echo "   (may already be added)"

    verify_movement_view "$MOVEMENT_RPC_URL" \
        "${MODULE_ADDR}::intent_gmp::is_relay_authorized" \
        "[\"${INTEGRATED_GMP_MVM_ADDR}\"]" \
        "intent_gmp relay authorization for GMP relay"
else
    echo " WARN: INTEGRATED_GMP_MVM_ADDR not set, skipping relay authorization"
    echo "   Set it in .env.mainnet (derive with: cd integrated-gmp && cargo run --bin get_relay_addresses)"
fi

echo ""
echo " Movement mainnet configuration verified."
