#!/bin/bash

# Configure Base Sepolia Testnet - Set remote GMP endpoint and update hub config
#
# Requires:
#   - .env.testnet with:
#     - BASE_DEPLOYER_PRIVATE_KEY
#     - BASE_GMP_ENDPOINT_ADDR, BASE_INFLOW_ESCROW_ADDR, BASE_OUTFLOW_VALIDATOR_ADDR
#     - MOVEMENT_INTENT_MODULE_ADDR
#   - Node.js + Hardhat (for contract interaction)

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$( cd "$SCRIPT_DIR/../../../.." && pwd )"

source "$SCRIPT_DIR/../lib/env-utils.sh"

# Load .env.testnet
load_env_file "$SCRIPT_DIR/../.env.testnet"

require_var "BASE_RPC_URL" "$BASE_RPC_URL"

EVM_CHAIN_PREFIX="BASE"
EVM_RPC_URL="$BASE_RPC_URL"
export BASE_SEPOLIA_RPC_URL="$EVM_RPC_URL"
EVM_HARDHAT_NETWORK="baseSepolia"
EVM_DISPLAY_NAME="Base Sepolia Testnet"
EVM_HUB_CHAIN_ID=$(get_chain_id "movement_bardock_testnet" "$TESTNET_ASSETS_CONFIG")
EVM_DEPLOY_SCRIPT="deploy-to-base.sh"

source "$SCRIPT_DIR/../../common/scripts/configure-evm.sh"
