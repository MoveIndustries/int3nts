#!/bin/bash

# Check Testnet Balances Script
# Checks balances for all accounts in .env.testnet
# Supports:
#   - Movement Bardock Testnet (MOVE, USDC.e, USDC, USDT, WETH)
#   - Base Sepolia (ETH, USDC)
# 
# Asset addresses are read from testing-infra/networks/testnet/config/testnet-assets.toml

# Get the script directory and project root
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$( cd "$SCRIPT_DIR/../../.." && pwd )"
export PROJECT_ROOT

# Source utilities (for error handling only, not logging)
source "$PROJECT_ROOT/testing-infra/ci-e2e/util.sh" 2>/dev/null || true
source "$PROJECT_ROOT/testing-infra/networks/common/lib/balance-utils.sh"

echo " Checking Testnet Balances"
echo "============================"
echo ""

# Load .env.testnet
TESTNET_KEYS_FILE="$SCRIPT_DIR/.env.testnet"

if [ ! -f "$TESTNET_KEYS_FILE" ]; then
    echo "❌ ERROR: .env.testnet not found at $TESTNET_KEYS_FILE"
    echo "   Create it from env.testnet.example in this directory"
    exit 1
fi

# Source the keys file
source "$TESTNET_KEYS_FILE"

# Load assets configuration
ASSETS_CONFIG_FILE="$PROJECT_ROOT/testing-infra/networks/testnet/config/testnet-assets.toml"

if [ ! -f "$ASSETS_CONFIG_FILE" ]; then
    echo "❌ ERROR: testnet-assets.toml not found at $ASSETS_CONFIG_FILE"
    echo "   Asset addresses must be configured in testing-infra/networks/testnet/config/testnet-assets.toml"
    exit 1
fi

# Parse TOML config (simple grep-based parser)
# Extract Base Sepolia USDC address and decimals
BASE_USDC_ADDR=$(grep -A 20 "^\[base_sepolia\]" "$ASSETS_CONFIG_FILE" | grep "^usdc = " | sed 's/.*= "\(.*\)".*/\1/' | tr -d '"' || echo "")
BASE_USDC_DECIMALS=$(grep -A 20 "^\[base_sepolia\]" "$ASSETS_CONFIG_FILE" | grep "^usdc_decimals = " | sed 's/.*= \([0-9]*\).*/\1/' || echo "")
if [ -z "$BASE_USDC_ADDR" ]; then
    echo "️  WARNING: Base Sepolia USDC address not found in testnet-assets.toml"
    echo "   Base Sepolia USDC balance checks will be skipped"
elif [ -z "$BASE_USDC_DECIMALS" ]; then
    echo "❌ ERROR: Base Sepolia USDC decimals not found in testnet-assets.toml"
    echo "   Add usdc_decimals = 6 to [base_sepolia] section"
    exit 1
fi

# Extract Movement USDC.e address and decimals
MOVEMENT_USDC_E_ADDR=$(grep -A 20 "^\[movement_bardock_testnet\]" "$ASSETS_CONFIG_FILE" | grep "^usdc_e = " | sed 's/.*= "\(.*\)".*/\1/' | tr -d '"' || echo "")
MOVEMENT_USDC_E_DECIMALS=$(grep -A 20 "^\[movement_bardock_testnet\]" "$ASSETS_CONFIG_FILE" | grep "^usdc_e_decimals = " | sed 's/.*= \([0-9]*\).*/\1/' || echo "")
if [ -n "$MOVEMENT_USDC_E_ADDR" ] && [ -z "$MOVEMENT_USDC_E_DECIMALS" ]; then
    echo "❌ ERROR: Movement USDC.e address configured but decimals not found in testnet-assets.toml"
    echo "   Add usdc_e_decimals = 6 to [movement_bardock_testnet] section"
    exit 1
fi

# Extract new Movement tokens (USDC, USDT, WETH) - FA metadata addresses
MOVEMENT_USDC=$(grep -A 30 "^\[movement_bardock_testnet\]" "$ASSETS_CONFIG_FILE" | grep "^usdc = " | sed 's/.*= "\(.*\)".*/\1/' | tr -d '"' || echo "")
MOVEMENT_USDC_DECIMALS=$(grep -A 30 "^\[movement_bardock_testnet\]" "$ASSETS_CONFIG_FILE" | grep "^usdc_decimals = " | sed 's/.*= \([0-9]*\).*/\1/' || echo "6")
MOVEMENT_USDT=$(grep -A 30 "^\[movement_bardock_testnet\]" "$ASSETS_CONFIG_FILE" | grep "^usdt = " | sed 's/.*= "\(.*\)".*/\1/' | tr -d '"' || echo "")
MOVEMENT_USDT_DECIMALS=$(grep -A 30 "^\[movement_bardock_testnet\]" "$ASSETS_CONFIG_FILE" | grep "^usdt_decimals = " | sed 's/.*= \([0-9]*\).*/\1/' || echo "6")
MOVEMENT_WETH=$(grep -A 30 "^\[movement_bardock_testnet\]" "$ASSETS_CONFIG_FILE" | grep "^weth = " | sed 's/.*= "\(.*\)".*/\1/' | tr -d '"' || echo "")
MOVEMENT_WETH_DECIMALS=$(grep -A 30 "^\[movement_bardock_testnet\]" "$ASSETS_CONFIG_FILE" | grep "^weth_decimals = " | sed 's/.*= \([0-9]*\).*/\1/' || echo "18")

# Coin types for CoinStore balance checking (tokens may be in CoinStore instead of FA)
MOVEMENT_USDC_COIN_TYPE="0xa6cc575a28e9c97d1cec569392fe6f698c593990e7029ef49fed6740a36a31b0::tokens::USDC"
MOVEMENT_USDT_COIN_TYPE="0xa6cc575a28e9c97d1cec569392fe6f698c593990e7029ef49fed6740a36a31b0::tokens::USDT"
MOVEMENT_WETH_COIN_TYPE="0xa6cc575a28e9c97d1cec569392fe6f698c593990e7029ef49fed6740a36a31b0::tokens::WETH"

# Extract native token decimals
MOVEMENT_NATIVE_DECIMALS=$(grep -A 10 "^\[movement_bardock_testnet\]" "$ASSETS_CONFIG_FILE" | grep "^native_token_decimals = " | sed 's/.*= \([0-9]*\).*/\1/' || echo "")
if [ -z "$MOVEMENT_NATIVE_DECIMALS" ]; then
    echo "❌ ERROR: Movement native token decimals not found in testnet-assets.toml"
    echo "   Add native_token_decimals = 8 to [movement_bardock_testnet] section"
    exit 1
fi

BASE_NATIVE_DECIMALS=$(grep -A 10 "^\[base_sepolia\]" "$ASSETS_CONFIG_FILE" | grep "^native_token_decimals = " | sed 's/.*= \([0-9]*\).*/\1/' || echo "")
if [ -z "$BASE_NATIVE_DECIMALS" ]; then
    echo "❌ ERROR: Base Sepolia native token decimals not found in testnet-assets.toml"
    echo "   Add native_token_decimals = 18 to [base_sepolia] section"
    exit 1
fi

# Extract RPC URLs
MOVEMENT_RPC_URL=$(grep -A 5 "^\[movement_bardock_testnet\]" "$ASSETS_CONFIG_FILE" | grep "^rpc_url = " | sed 's/.*= "\(.*\)".*/\1/' | tr -d '"' || echo "")
if [ -z "$MOVEMENT_RPC_URL" ]; then
    echo "️  WARNING: Movement RPC URL not found in testnet-assets.toml"
    echo "   Movement balance checks will fail"
fi

if [ -z "$BASE_RPC_URL" ]; then
    echo "️  WARNING: BASE_RPC_URL not set in .env.testnet"
    echo "   Base Sepolia balance checks will fail"
fi

# Solana devnet config
SOLANA_RPC_URL=$(grep -A 5 "^\[solana_devnet\]" "$ASSETS_CONFIG_FILE" | grep "^rpc_url = " | sed 's/.*= "\(.*\)".*/\1/' | tr -d '"' || echo "")
SOLANA_USDC=$(grep -A 10 "^\[solana_devnet\]" "$ASSETS_CONFIG_FILE" | grep "^usdc = " | sed 's/.*= "\(.*\)".*/\1/' | tr -d '"' || echo "")
SOLANA_USDC_DECIMALS=$(grep -A 10 "^\[solana_devnet\]" "$ASSETS_CONFIG_FILE" | grep "^usdc_decimals = " | sed 's/.*= \([0-9]*\).*/\1/' || echo "6")

# Check Movement balances
echo " Movement Bardock Testnet"
echo "----------------------------"
echo "   RPC: $MOVEMENT_RPC_URL"

if [ -z "$MOVEMENT_DEPLOYER_ADDR" ]; then
    echo "️  MOVEMENT_DEPLOYER_ADDR not set in .env.testnet"
else
    echo "   Deployer  ($MOVEMENT_DEPLOYER_ADDR)"
    # MOVE (native)
    balance=$(get_movement_balance "$MOVEMENT_DEPLOYER_ADDR")
    formatted=$(format_balance "$balance" "$MOVEMENT_NATIVE_DECIMALS")
    echo "             MOVE: $formatted"
    # USDC.e (FA only)
    if [ -n "$MOVEMENT_USDC_E_ADDR" ]; then
        usdc_e_balance=$(get_movement_fa_balance "$MOVEMENT_DEPLOYER_ADDR" "$MOVEMENT_USDC_E_ADDR")
        usdc_e_formatted=$(format_balance_number "$usdc_e_balance" "$MOVEMENT_USDC_E_DECIMALS")
        echo "             USDC.e: $usdc_e_formatted"
    fi
    # USDC (FA/Coin)
    if [ -n "$MOVEMENT_USDC" ]; then
        usdc_fa=$(get_movement_fa_balance "$MOVEMENT_DEPLOYER_ADDR" "$MOVEMENT_USDC")
        usdc_coin=$(get_movement_coin_balance "$MOVEMENT_DEPLOYER_ADDR" "$MOVEMENT_USDC_COIN_TYPE")
        usdc_fa_fmt=$(format_balance_number "$usdc_fa" "$MOVEMENT_USDC_DECIMALS")
        usdc_coin_fmt=$(format_balance_number "$usdc_coin" "$MOVEMENT_USDC_DECIMALS")
        echo "             USDC: $usdc_fa_fmt FA / $usdc_coin_fmt Coin"
    fi
    # USDT (FA/Coin)
    if [ -n "$MOVEMENT_USDT" ]; then
        usdt_fa=$(get_movement_fa_balance "$MOVEMENT_DEPLOYER_ADDR" "$MOVEMENT_USDT")
        usdt_coin=$(get_movement_coin_balance "$MOVEMENT_DEPLOYER_ADDR" "$MOVEMENT_USDT_COIN_TYPE")
        usdt_fa_fmt=$(format_balance_number "$usdt_fa" "$MOVEMENT_USDT_DECIMALS")
        usdt_coin_fmt=$(format_balance_number "$usdt_coin" "$MOVEMENT_USDT_DECIMALS")
        echo "             USDT: $usdt_fa_fmt FA / $usdt_coin_fmt Coin"
    fi
    # WETH (FA/Coin)
    if [ -n "$MOVEMENT_WETH" ]; then
        weth_fa=$(get_movement_fa_balance "$MOVEMENT_DEPLOYER_ADDR" "$MOVEMENT_WETH")
        weth_coin=$(get_movement_coin_balance "$MOVEMENT_DEPLOYER_ADDR" "$MOVEMENT_WETH_COIN_TYPE")
        weth_fa_fmt=$(format_balance_number "$weth_fa" "$MOVEMENT_WETH_DECIMALS")
        weth_coin_fmt=$(format_balance_number "$weth_coin" "$MOVEMENT_WETH_DECIMALS")
        echo "             WETH: $weth_fa_fmt FA / $weth_coin_fmt Coin"
    fi
fi

if [ -z "$MOVEMENT_REQUESTER_ADDR" ]; then
    echo "️  MOVEMENT_REQUESTER_ADDR not set in .env.testnet"
else
    echo "   Requester ($MOVEMENT_REQUESTER_ADDR)"
    # MOVE (native)
    balance=$(get_movement_balance "$MOVEMENT_REQUESTER_ADDR")
    formatted=$(format_balance "$balance" "$MOVEMENT_NATIVE_DECIMALS")
    echo "             MOVE: $formatted"
    # USDC.e (FA only)
    if [ -n "$MOVEMENT_USDC_E_ADDR" ]; then
        usdc_e_balance=$(get_movement_fa_balance "$MOVEMENT_REQUESTER_ADDR" "$MOVEMENT_USDC_E_ADDR")
        usdc_e_formatted=$(format_balance_number "$usdc_e_balance" "$MOVEMENT_USDC_E_DECIMALS")
        echo "             USDC.e: $usdc_e_formatted"
    fi
    # USDC (FA/Coin)
    if [ -n "$MOVEMENT_USDC" ]; then
        usdc_fa=$(get_movement_fa_balance "$MOVEMENT_REQUESTER_ADDR" "$MOVEMENT_USDC")
        usdc_coin=$(get_movement_coin_balance "$MOVEMENT_REQUESTER_ADDR" "$MOVEMENT_USDC_COIN_TYPE")
        usdc_fa_fmt=$(format_balance_number "$usdc_fa" "$MOVEMENT_USDC_DECIMALS")
        usdc_coin_fmt=$(format_balance_number "$usdc_coin" "$MOVEMENT_USDC_DECIMALS")
        echo "             USDC: $usdc_fa_fmt FA / $usdc_coin_fmt Coin"
    fi
    # USDT (FA/Coin)
    if [ -n "$MOVEMENT_USDT" ]; then
        usdt_fa=$(get_movement_fa_balance "$MOVEMENT_REQUESTER_ADDR" "$MOVEMENT_USDT")
        usdt_coin=$(get_movement_coin_balance "$MOVEMENT_REQUESTER_ADDR" "$MOVEMENT_USDT_COIN_TYPE")
        usdt_fa_fmt=$(format_balance_number "$usdt_fa" "$MOVEMENT_USDT_DECIMALS")
        usdt_coin_fmt=$(format_balance_number "$usdt_coin" "$MOVEMENT_USDT_DECIMALS")
        echo "             USDT: $usdt_fa_fmt FA / $usdt_coin_fmt Coin"
    fi
    # WETH (FA/Coin)
    if [ -n "$MOVEMENT_WETH" ]; then
        weth_fa=$(get_movement_fa_balance "$MOVEMENT_REQUESTER_ADDR" "$MOVEMENT_WETH")
        weth_coin=$(get_movement_coin_balance "$MOVEMENT_REQUESTER_ADDR" "$MOVEMENT_WETH_COIN_TYPE")
        weth_fa_fmt=$(format_balance_number "$weth_fa" "$MOVEMENT_WETH_DECIMALS")
        weth_coin_fmt=$(format_balance_number "$weth_coin" "$MOVEMENT_WETH_DECIMALS")
        echo "             WETH: $weth_fa_fmt FA / $weth_coin_fmt Coin"
    fi
fi

if [ -z "$MOVEMENT_SOLVER_ADDR" ]; then
    echo "️  MOVEMENT_SOLVER_ADDR not set in .env.testnet"
else
    echo "   Solver    ($MOVEMENT_SOLVER_ADDR)"
    # MOVE (native)
    balance=$(get_movement_balance "$MOVEMENT_SOLVER_ADDR")
    formatted=$(format_balance "$balance" "$MOVEMENT_NATIVE_DECIMALS")
    echo "             MOVE: $formatted"
    # USDC.e (FA only)
    if [ -n "$MOVEMENT_USDC_E_ADDR" ]; then
        usdc_e_balance=$(get_movement_fa_balance "$MOVEMENT_SOLVER_ADDR" "$MOVEMENT_USDC_E_ADDR")
        usdc_e_formatted=$(format_balance_number "$usdc_e_balance" "$MOVEMENT_USDC_E_DECIMALS")
        echo "             USDC.e: $usdc_e_formatted"
    fi
    # USDC (FA/Coin)
    if [ -n "$MOVEMENT_USDC" ]; then
        usdc_fa=$(get_movement_fa_balance "$MOVEMENT_SOLVER_ADDR" "$MOVEMENT_USDC")
        usdc_coin=$(get_movement_coin_balance "$MOVEMENT_SOLVER_ADDR" "$MOVEMENT_USDC_COIN_TYPE")
        usdc_fa_fmt=$(format_balance_number "$usdc_fa" "$MOVEMENT_USDC_DECIMALS")
        usdc_coin_fmt=$(format_balance_number "$usdc_coin" "$MOVEMENT_USDC_DECIMALS")
        echo "             USDC: $usdc_fa_fmt FA / $usdc_coin_fmt Coin"
    fi
    # USDT (FA/Coin)
    if [ -n "$MOVEMENT_USDT" ]; then
        usdt_fa=$(get_movement_fa_balance "$MOVEMENT_SOLVER_ADDR" "$MOVEMENT_USDT")
        usdt_coin=$(get_movement_coin_balance "$MOVEMENT_SOLVER_ADDR" "$MOVEMENT_USDT_COIN_TYPE")
        usdt_fa_fmt=$(format_balance_number "$usdt_fa" "$MOVEMENT_USDT_DECIMALS")
        usdt_coin_fmt=$(format_balance_number "$usdt_coin" "$MOVEMENT_USDT_DECIMALS")
        echo "             USDT: $usdt_fa_fmt FA / $usdt_coin_fmt Coin"
    fi
    # WETH (FA/Coin)
    if [ -n "$MOVEMENT_WETH" ]; then
        weth_fa=$(get_movement_fa_balance "$MOVEMENT_SOLVER_ADDR" "$MOVEMENT_WETH")
        weth_coin=$(get_movement_coin_balance "$MOVEMENT_SOLVER_ADDR" "$MOVEMENT_WETH_COIN_TYPE")
        weth_fa_fmt=$(format_balance_number "$weth_fa" "$MOVEMENT_WETH_DECIMALS")
        weth_coin_fmt=$(format_balance_number "$weth_coin" "$MOVEMENT_WETH_DECIMALS")
        echo "             WETH: $weth_fa_fmt FA / $weth_coin_fmt Coin"
    fi
fi

if [ -z "$INTEGRATED_GMP_MVM_ADDR" ]; then
    echo "️  INTEGRATED_GMP_MVM_ADDR not set in .env.testnet"
else
    echo "   Relay     ($INTEGRATED_GMP_MVM_ADDR)"
    balance=$(get_movement_balance "$INTEGRATED_GMP_MVM_ADDR")
    formatted=$(format_balance "$balance" "$MOVEMENT_NATIVE_DECIMALS")
    echo "             MOVE: $formatted"
fi

echo ""

# Check Base Sepolia balances
echo " Base Sepolia"
echo "---------------"
echo "   RPC: $BASE_RPC_URL"

if [ -z "$BASE_DEPLOYER_ADDR" ]; then
    echo "️  BASE_DEPLOYER_ADDR not set in .env.testnet"
else
    eth_balance=$(get_evm_eth_balance "$BASE_DEPLOYER_ADDR" "$BASE_RPC_URL")
    eth_formatted=$(format_balance "$eth_balance" "$BASE_NATIVE_DECIMALS")
    echo "   Deployer  ($BASE_DEPLOYER_ADDR)"
    if [ -n "$BASE_USDC_ADDR" ]; then
        usdc_balance=$(get_evm_token_balance "$BASE_DEPLOYER_ADDR" "$BASE_USDC_ADDR" "$BASE_RPC_URL")
        usdc_formatted=$(format_balance "$usdc_balance" "$BASE_USDC_DECIMALS" "USDC")
        echo "             $eth_formatted, $usdc_formatted"
    else
        echo "             $eth_formatted (USDC n/a)"
    fi
fi

if [ -z "$BASE_REQUESTER_ADDR" ]; then
    echo "️  BASE_REQUESTER_ADDR not set in .env.testnet"
else
    eth_balance=$(get_evm_eth_balance "$BASE_REQUESTER_ADDR" "$BASE_RPC_URL")
    eth_formatted=$(format_balance "$eth_balance" "$BASE_NATIVE_DECIMALS")
    echo "   Requester ($BASE_REQUESTER_ADDR)"
    if [ -n "$BASE_USDC_ADDR" ]; then
        usdc_balance=$(get_evm_token_balance "$BASE_REQUESTER_ADDR" "$BASE_USDC_ADDR" "$BASE_RPC_URL")
        usdc_formatted=$(format_balance "$usdc_balance" "$BASE_USDC_DECIMALS" "USDC")
        echo "             $eth_formatted, $usdc_formatted"
    else
        echo "             $eth_formatted (USDC n/a)"
    fi
fi

if [ -z "$BASE_SOLVER_ADDR" ]; then
    echo "️  BASE_SOLVER_ADDR not set in .env.testnet"
else
    eth_balance=$(get_evm_eth_balance "$BASE_SOLVER_ADDR" "$BASE_RPC_URL")
    eth_formatted=$(format_balance "$eth_balance" "$BASE_NATIVE_DECIMALS")
    echo "   Solver    ($BASE_SOLVER_ADDR)"
    if [ -n "$BASE_USDC_ADDR" ]; then
        usdc_balance=$(get_evm_token_balance "$BASE_SOLVER_ADDR" "$BASE_USDC_ADDR" "$BASE_RPC_URL")
        usdc_formatted=$(format_balance "$usdc_balance" "$BASE_USDC_DECIMALS" "USDC")
        echo "             $eth_formatted, $usdc_formatted"
    else
        echo "             $eth_formatted (USDC n/a)"
    fi
fi

if [ -z "$INTEGRATED_GMP_EVM_PUBKEY_HASH" ]; then
    echo "️  INTEGRATED_GMP_EVM_PUBKEY_HASH not set in .env.testnet"
else
    eth_balance=$(get_evm_eth_balance "$INTEGRATED_GMP_EVM_PUBKEY_HASH" "$BASE_RPC_URL")
    eth_formatted=$(format_balance "$eth_balance" "$BASE_NATIVE_DECIMALS")
    echo "   Relay     ($INTEGRATED_GMP_EVM_PUBKEY_HASH)"
    echo "             $eth_formatted"
fi

echo ""

# Solana Devnet
echo " Solana Devnet"
echo "----------------"
echo "   RPC: $SOLANA_RPC_URL"

for entry in "SOLANA_DEPLOYER_ADDR:Deployer" "SOLANA_REQUESTER_ADDR:Requester" "SOLANA_SOLVER_ADDR:Solver" "INTEGRATED_GMP_SVM_ADDR:Relay"; do
    role_var="${entry%%:*}"
    label="${entry##*:}"
    addr="${!role_var}"

    if [ -z "$addr" ]; then
        echo "   ${role_var} not set in .env.testnet"
    else
        printf "   %-10s (%s)\n" "$label" "$addr"
        sol_balance=$(get_solana_sol_balance "$addr" "$SOLANA_RPC_URL")
        echo "             $(format_balance "$sol_balance" "9" "SOL")"
        if [ -n "$SOLANA_USDC" ]; then
            usdc_balance=$(get_solana_token_balance "$addr" "$SOLANA_USDC" "$SOLANA_RPC_URL")
            echo "             $(format_balance "$usdc_balance" "$SOLANA_USDC_DECIMALS" "USDC")"
        fi
    fi
done

echo ""

if [ -z "$MOVEMENT_USDC_E_ADDR" ] || [ "$MOVEMENT_USDC_E_ADDR" = "" ]; then
    echo " Note: Movement USDC.e address not configured in testnet-assets.toml"
    echo "   Add usdc_e deployment address to check Movement USDC.e balances"
fi
echo "   Config file: $ASSETS_CONFIG_FILE"
echo ""
echo "✅ Balance check complete!"

