#!/bin/bash

# Configure HyperEVM Mainnet - Set remote GMP endpoint and update hub config
#
# Steps:
#   1. Verify all 3 contracts are deployed on-chain
#   2. Set remote GMP endpoint on IntentGmp for hub chain (Movement)
#   3. Update hub config on IntentInflowEscrow and IntentOutflowValidator
#
# Requires:
#   - .env.mainnet with:
#     - HYPERLIQUID_DEPLOYER_PRIVATE_KEY
#     - HYPERLIQUID_GMP_ENDPOINT_ADDR, HYPERLIQUID_INFLOW_ESCROW_ADDR, HYPERLIQUID_OUTFLOW_VALIDATOR_ADDR
#     - MOVEMENT_INTENT_MODULE_ADDR
#   - Node.js + Hardhat (for contract interaction)

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$( cd "$SCRIPT_DIR/../../../.." && pwd )"

source "$SCRIPT_DIR/../lib/env-utils.sh"

ASSETS_CONFIG_FILE="$SCRIPT_DIR/../config/mainnet-assets.toml"

echo " Configuring HyperEVM Mainnet"
echo "=================================="
echo ""

# Load .env.mainnet
load_env_file "$SCRIPT_DIR/../.env.mainnet"

require_var "HYPERLIQUID_DEPLOYER_PRIVATE_KEY" "$HYPERLIQUID_DEPLOYER_PRIVATE_KEY"
require_var "HYPERLIQUID_GMP_ENDPOINT_ADDR" "$HYPERLIQUID_GMP_ENDPOINT_ADDR" "Run deploy-to-hyperliquid-mainnet.sh first"
require_var "MOVEMENT_INTENT_MODULE_ADDR" "$MOVEMENT_INTENT_MODULE_ADDR" "Run deploy-to-movement-mainnet.sh first"
require_var "HYPERLIQUID_RPC_URL" "$HYPERLIQUID_RPC_URL"

HUB_CHAIN_ID=$(get_chain_id "movement_mainnet" "$ASSETS_CONFIG_FILE")

echo " Configuration:"
echo "   GMP Endpoint:  $HYPERLIQUID_GMP_ENDPOINT_ADDR"
echo "   Hub Chain ID:  $HUB_CHAIN_ID"
echo "   Hub Module:    $MOVEMENT_INTENT_MODULE_ADDR"
echo ""

# 1. Verify contracts are deployed
echo " 1. Verifying deployed contracts..."

verify_evm_contract "$HYPERLIQUID_RPC_URL" "$HYPERLIQUID_GMP_ENDPOINT_ADDR" "IntentGmp"

require_var "HYPERLIQUID_INFLOW_ESCROW_ADDR" "$HYPERLIQUID_INFLOW_ESCROW_ADDR" "Run deploy-to-hyperliquid-mainnet.sh first"
verify_evm_contract "$HYPERLIQUID_RPC_URL" "$HYPERLIQUID_INFLOW_ESCROW_ADDR" "IntentInflowEscrow"

require_var "HYPERLIQUID_OUTFLOW_VALIDATOR_ADDR" "$HYPERLIQUID_OUTFLOW_VALIDATOR_ADDR" "Run deploy-to-hyperliquid-mainnet.sh first"
verify_evm_contract "$HYPERLIQUID_RPC_URL" "$HYPERLIQUID_OUTFLOW_VALIDATOR_ADDR" "IntentOutflowValidator"
echo ""

# 2. Set remote GMP endpoint on GMP endpoint
echo " 2. Setting remote GMP endpoint for hub chain $HUB_CHAIN_ID..."

cd "$PROJECT_ROOT/intent-frameworks/evm"

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "   Installing dependencies..."
    npm install
fi

export DEPLOYER_PRIVATE_KEY="$HYPERLIQUID_DEPLOYER_PRIVATE_KEY"
export HYPERLIQUID_RPC_URL
export GMP_ENDPOINT_ADDR="$HYPERLIQUID_GMP_ENDPOINT_ADDR"
export HUB_CHAIN_ID
export MOVEMENT_INTENT_MODULE_ADDR

set +e
CONFIGURE_OUTPUT=$(npx hardhat run scripts/configure-gmp.js --network hyperliquidMainnet 2>&1)
CONFIGURE_EXIT=$?
set -e

echo "$CONFIGURE_OUTPUT"

if [ $CONFIGURE_EXIT -ne 0 ]; then
    echo "FATAL: Failed to set remote GMP endpoint on IntentGmp"
    exit 1
fi

# 3. Update hub config on escrow and outflow validator
echo " 3. Updating hub config on IntentInflowEscrow and IntentOutflowValidator..."

export INFLOW_ESCROW_ADDR="$HYPERLIQUID_INFLOW_ESCROW_ADDR"
export OUTFLOW_VALIDATOR_ADDR="$HYPERLIQUID_OUTFLOW_VALIDATOR_ADDR"

set +e
HUB_CONFIG_OUTPUT=$(npx hardhat run scripts/configure-hub-config.js --network hyperliquidMainnet 2>&1)
HUB_CONFIG_EXIT=$?
set -e

echo "$HUB_CONFIG_OUTPUT"

if [ $HUB_CONFIG_EXIT -ne 0 ]; then
    echo "FATAL: Failed to update hub config on escrow/outflow contracts"
    exit 1
fi

echo ""
echo " HyperEVM Mainnet configuration verified."
