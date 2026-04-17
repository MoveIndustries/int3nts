#!/bin/bash

# Check Mainnet Balances Script
# Checks balances for all accounts in .env.mainnet
# Supports:
#   - Movement Mainnet (MOVE, USDC.e, USDCx)
#   - Base Mainnet (ETH, USDC)
#   - HyperEVM Mainnet (HYPE, USDC)
#
# Asset addresses are read from testing-infra/networks/mainnet/config/mainnet-assets.toml

# Get the script directory and project root
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$( cd "$SCRIPT_DIR/../../.." && pwd )"
export PROJECT_ROOT

# Source utilities (for error handling only, not logging)
source "$PROJECT_ROOT/testing-infra/ci-e2e/util.sh" 2>/dev/null || true
source "$PROJECT_ROOT/testing-infra/networks/common/lib/balance-utils.sh"

echo " Checking Mainnet Balances"
echo "============================"
echo ""

# Load .env.mainnet
MAINNET_KEYS_FILE="$SCRIPT_DIR/.env.mainnet"

if [ ! -f "$MAINNET_KEYS_FILE" ]; then
    echo "ERROR: .env.mainnet not found at $MAINNET_KEYS_FILE"
    echo "   Create it from env.mainnet.example in this directory"
    exit 1
fi

source "$MAINNET_KEYS_FILE"

# Load assets configuration
ASSETS_CONFIG_FILE="$SCRIPT_DIR/config/mainnet-assets.toml"

if [ ! -f "$ASSETS_CONFIG_FILE" ]; then
    echo "ERROR: mainnet-assets.toml not found at $ASSETS_CONFIG_FILE"
    exit 1
fi

# Extract native token decimals
MOVEMENT_NATIVE_DECIMALS=$(grep -A 10 "^\[movement_mainnet\]" "$ASSETS_CONFIG_FILE" | grep "^native_token_decimals = " | sed 's/.*= \([0-9]*\).*/\1/' || echo "")
if [ -z "$MOVEMENT_NATIVE_DECIMALS" ]; then
    echo "ERROR: Movement native token decimals not found in mainnet-assets.toml"
    exit 1
fi

BASE_NATIVE_DECIMALS=$(grep -A 10 "^\[base_mainnet\]" "$ASSETS_CONFIG_FILE" | grep "^native_token_decimals = " | sed 's/.*= \([0-9]*\).*/\1/' || echo "")
if [ -z "$BASE_NATIVE_DECIMALS" ]; then
    echo "ERROR: Base native token decimals not found in mainnet-assets.toml"
    exit 1
fi

HYPERLIQUID_NATIVE_DECIMALS=$(grep -A 10 "^\[hyperliquid_mainnet\]" "$ASSETS_CONFIG_FILE" | grep "^native_token_decimals = " | sed 's/.*= \([0-9]*\).*/\1/' || echo "")
if [ -z "$HYPERLIQUID_NATIVE_DECIMALS" ]; then
    echo "ERROR: HyperEVM native token decimals not found in mainnet-assets.toml"
    exit 1
fi

# Extract token addresses
MOVEMENT_USDC_E=$(grep -A 30 "^\[movement_mainnet\]" "$ASSETS_CONFIG_FILE" | grep "^usdc_e = " | sed 's/.*= "\(.*\)".*/\1/' | tr -d '"' || echo "")
MOVEMENT_USDC_E_DECIMALS=$(grep -A 30 "^\[movement_mainnet\]" "$ASSETS_CONFIG_FILE" | grep "^usdc_e_decimals = " | sed 's/.*= \([0-9]*\).*/\1/' || echo "6")
MOVEMENT_USDCX=$(grep -A 30 "^\[movement_mainnet\]" "$ASSETS_CONFIG_FILE" | grep "^usdcx = " | sed 's/.*= "\(.*\)".*/\1/' | tr -d '"' || echo "")
MOVEMENT_USDCX_DECIMALS=$(grep -A 30 "^\[movement_mainnet\]" "$ASSETS_CONFIG_FILE" | grep "^usdcx_decimals = " | sed 's/.*= \([0-9]*\).*/\1/' || echo "6")

BASE_USDC=$(grep -A 20 "^\[base_mainnet\]" "$ASSETS_CONFIG_FILE" | grep "^usdc = " | sed 's/.*= "\(.*\)".*/\1/' | tr -d '"' || echo "")
BASE_USDC_DECIMALS=$(grep -A 20 "^\[base_mainnet\]" "$ASSETS_CONFIG_FILE" | grep "^usdc_decimals = " | sed 's/.*= \([0-9]*\).*/\1/' || echo "6")

HYPERLIQUID_USDC=$(grep -A 20 "^\[hyperliquid_mainnet\]" "$ASSETS_CONFIG_FILE" | grep "^usdc = " | sed 's/.*= "\(.*\)".*/\1/' | tr -d '"' || echo "")
HYPERLIQUID_USDC_DECIMALS=$(grep -A 20 "^\[hyperliquid_mainnet\]" "$ASSETS_CONFIG_FILE" | grep "^usdc_decimals = " | sed 's/.*= \([0-9]*\).*/\1/' || echo "6")

# Extract RPC URLs
MOVEMENT_RPC_URL="https://mainnet.movementnetwork.xyz/v1"

if [ -z "$BASE_RPC_URL" ]; then
    BASE_RPC_URL=$(grep -A 5 "^\[base_mainnet\]" "$ASSETS_CONFIG_FILE" | grep "^rpc_url = " | sed 's/.*= "\(.*\)".*/\1/' | tr -d '"' || echo "")
fi
if [ -z "$BASE_RPC_URL" ]; then
    echo "WARNING: BASE_RPC_URL not set and not in mainnet-assets.toml"
    echo "   Base balance checks will fail"
fi

if [ -z "$HYPERLIQUID_RPC_URL" ]; then
    HYPERLIQUID_RPC_URL=$(grep -A 5 "^\[hyperliquid_mainnet\]" "$ASSETS_CONFIG_FILE" | grep "^rpc_url = " | sed 's/.*= "\(.*\)".*/\1/' | tr -d '"' || echo "")
fi
if [ -z "$HYPERLIQUID_RPC_URL" ]; then
    echo "WARNING: HYPERLIQUID_RPC_URL not set and not in mainnet-assets.toml"
    echo "   HyperEVM balance checks will fail"
fi

# ============================================================================
# Movement Mainnet
# ============================================================================
echo " Movement Mainnet"
echo "----------------------------"
echo "   RPC: $MOVEMENT_RPC_URL"

for role_var in MOVEMENT_DEPLOYER_ADDR MOVEMENT_REQUESTER_ADDR MOVEMENT_SOLVER_ADDR; do
    addr="${!role_var}"
    label="${role_var#MOVEMENT_}"
    label="${label%_ADDR}"
    label=$(echo "$label" | awk '{print toupper(substr($0,1,1)) tolower(substr($0,2))}')

    if [ -z "$addr" ]; then
        echo "   ${role_var} not set in .env.mainnet"
    else
        printf "   %-10s (%s)\n" "$label" "$addr"
        balance=$(get_movement_balance "$addr")
        echo "             $(format_balance "$balance" "$MOVEMENT_NATIVE_DECIMALS" "MOVE")"
        if [ -n "$MOVEMENT_USDC_E" ]; then
            usdc_e_bal=$(get_movement_fa_balance "$addr" "$MOVEMENT_USDC_E")
            echo "             $(format_balance "$usdc_e_bal" "$MOVEMENT_USDC_E_DECIMALS" "USDC.e")"
        fi
        if [ -n "$MOVEMENT_USDCX" ]; then
            usdcx_bal=$(get_movement_fa_balance "$addr" "$MOVEMENT_USDCX")
            echo "             $(format_balance "$usdcx_bal" "$MOVEMENT_USDCX_DECIMALS" "USDCx")"
        fi
    fi
done

echo ""

# ============================================================================
# Base Mainnet
# ============================================================================
echo " Base Mainnet"
echo "---------------"
echo "   RPC: $BASE_RPC_URL"

for role_var in BASE_DEPLOYER_ADDR BASE_REQUESTER_ADDR BASE_SOLVER_ADDR; do
    addr="${!role_var}"
    label="${role_var#BASE_}"
    label="${label%_ADDR}"
    label=$(echo "$label" | awk '{print toupper(substr($0,1,1)) tolower(substr($0,2))}')

    if [ -z "$addr" ]; then
        echo "   ${role_var} not set in .env.mainnet"
    else
        printf "   %-10s (%s)\n" "$label" "$addr"
        eth_balance=$(get_evm_eth_balance "$addr" "$BASE_RPC_URL")
        echo "             $(format_balance "$eth_balance" "$BASE_NATIVE_DECIMALS" "ETH")"
        if [ -n "$BASE_USDC" ]; then
            usdc_bal=$(get_evm_token_balance "$addr" "$BASE_USDC" "$BASE_RPC_URL")
            echo "             $(format_balance "$usdc_bal" "$BASE_USDC_DECIMALS" "USDC")"
        fi
    fi
done

echo ""

# ============================================================================
# HyperEVM Mainnet
# ============================================================================
echo " HyperEVM Mainnet"
echo "-------------------"
echo "   RPC: $HYPERLIQUID_RPC_URL"

for role_var in HYPERLIQUID_DEPLOYER_ADDR HYPERLIQUID_REQUESTER_ADDR HYPERLIQUID_SOLVER_ADDR; do
    addr="${!role_var}"
    label="${role_var#HYPERLIQUID_}"
    label="${label%_ADDR}"
    label=$(echo "$label" | awk '{print toupper(substr($0,1,1)) tolower(substr($0,2))}')

    if [ -z "$addr" ]; then
        echo "   ${role_var} not set in .env.mainnet"
    else
        printf "   %-10s (%s)\n" "$label" "$addr"
        eth_balance=$(get_evm_eth_balance "$addr" "$HYPERLIQUID_RPC_URL")
        echo "             $(format_balance "$eth_balance" "$HYPERLIQUID_NATIVE_DECIMALS" "HYPE")"
        if [ -n "$HYPERLIQUID_USDC" ]; then
            usdc_bal=$(get_evm_token_balance "$addr" "$HYPERLIQUID_USDC" "$HYPERLIQUID_RPC_URL")
            echo "             $(format_balance "$usdc_bal" "$HYPERLIQUID_USDC_DECIMALS" "USDC")"
        fi
    fi
done

echo ""
echo "   Config file: $ASSETS_CONFIG_FILE"
echo ""
echo "Balance check complete!"
