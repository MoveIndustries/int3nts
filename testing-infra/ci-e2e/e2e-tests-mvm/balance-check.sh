#!/bin/bash

# Balance Check Script for MVM E2E Tests
# Displays and validates final balances for Hub (USDhub) and Connected MVM (Chain 2, USDcon)
# Usage: balance-check.sh <solver_chain_hub> <requester_chain_hub> <solver_chain_connected> <requester_chain_connected>
#   - Pass -1 for any parameter to skip that check
#   - Values are in 10e-6 units (e.g., 2000000 = 2 tokens: USDhub on Hub, USDcon on Chain 2)

# Source common utilities
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
source "$SCRIPT_DIR/../util.sh"
source "$SCRIPT_DIR/../util_mvm.sh"

# Setup project root
setup_project_root

# Parse expected balance parameters
SOLVER_CHAIN_HUB_EXPECTED="${1:-}"
REQUESTER_CHAIN_HUB_EXPECTED="${2:-}"
SOLVER_CHAIN_CONNECTED_EXPECTED="${3:-}"
REQUESTER_CHAIN_CONNECTED_EXPECTED="${4:-}"

# Get test tokens addresses
TEST_TOKENS_HUB=$(get_profile_address "test-tokens-chain1" 2>/dev/null) || true
TEST_TOKENS_MVM_CON=$(get_profile_address "test-tokens-chain2" 2>/dev/null) || true

# Display balances
if [ -z "$TEST_TOKENS_HUB" ]; then
    echo "️  Warning: test-tokens-chain1 profile not found, skipping USDhub balances"
    display_balances_hub
else
    display_balances_hub "0x$TEST_TOKENS_HUB"
fi

if [ -z "$TEST_TOKENS_MVM_CON" ]; then
    echo "️  Warning: test-tokens-chain2 profile not found, skipping USDcon balances"
    display_balances_connected_mvm
else
    display_balances_connected_mvm "0x$TEST_TOKENS_MVM_CON"
fi

# Validate solver balance on Hub
if [ -n "$SOLVER_CHAIN_HUB_EXPECTED" ] && [ "$SOLVER_CHAIN_HUB_EXPECTED" != "-1" ] && [ -n "$TEST_TOKENS_HUB" ]; then
    SOLVER_CHAIN_HUB_ADDRESS=$(get_profile_address "solver-chain1" 2>/dev/null || echo "")
    if [ -n "$SOLVER_CHAIN_HUB_ADDRESS" ]; then
        SOLVER_CHAIN_HUB_ACTUAL=$(get_usdxyz_balance "solver-chain1" "1" "0x$TEST_TOKENS_HUB" 2>/dev/null || echo "0")
        
        if [ "$SOLVER_CHAIN_HUB_ACTUAL" != "$SOLVER_CHAIN_HUB_EXPECTED" ]; then
            log_and_echo "❌ ERROR: Solver balance mismatch on Hub!"
            log_and_echo "   Actual:   $SOLVER_CHAIN_HUB_ACTUAL 10e-6.USDhub"
            log_and_echo "   Expected: $SOLVER_CHAIN_HUB_EXPECTED 10e-6.USDhub"
            display_service_logs "Solver balance mismatch on Hub"
            exit 1
        fi
        log_and_echo "✅ Solver balance validated on Hub: $SOLVER_CHAIN_HUB_ACTUAL 10e-6.USDhub"
    fi
fi

# Validate requester balance on Hub
if [ -n "$REQUESTER_CHAIN_HUB_EXPECTED" ] && [ "$REQUESTER_CHAIN_HUB_EXPECTED" != "-1" ] && [ -n "$TEST_TOKENS_HUB" ]; then
    REQUESTER_CHAIN_HUB_ADDRESS=$(get_profile_address "requester-chain1" 2>/dev/null || echo "")
    if [ -n "$REQUESTER_CHAIN_HUB_ADDRESS" ]; then
        REQUESTER_CHAIN_HUB_ACTUAL=$(get_usdxyz_balance "requester-chain1" "1" "0x$TEST_TOKENS_HUB" 2>/dev/null || echo "0")
        
        if [ "$REQUESTER_CHAIN_HUB_ACTUAL" != "$REQUESTER_CHAIN_HUB_EXPECTED" ]; then
            log_and_echo "❌ ERROR: Requester balance mismatch on Hub!"
            log_and_echo "   Actual:   $REQUESTER_CHAIN_HUB_ACTUAL 10e-6.USDhub"
            log_and_echo "   Expected: $REQUESTER_CHAIN_HUB_EXPECTED 10e-6.USDhub"
            display_service_logs "Requester balance mismatch on Hub"
            exit 1
        fi
        log_and_echo "✅ Requester balance validated on Hub: $REQUESTER_CHAIN_HUB_ACTUAL 10e-6.USDhub"
    fi
fi

# Validate solver balance on Chain 2 (Connected MVM)
if [ -n "$SOLVER_CHAIN_CONNECTED_EXPECTED" ] && [ "$SOLVER_CHAIN_CONNECTED_EXPECTED" != "-1" ] && [ -n "$TEST_TOKENS_MVM_CON" ]; then
    SOLVER_MVM_CON_ADDRESS=$(get_profile_address "solver-chain2" 2>/dev/null || echo "")
    if [ -n "$SOLVER_MVM_CON_ADDRESS" ]; then
        SOLVER_CHAIN_CONNECTED_ACTUAL=$(get_usdxyz_balance "solver-chain2" "2" "0x$TEST_TOKENS_MVM_CON" 2>/dev/null || echo "0")
        
        if [ "$SOLVER_CHAIN_CONNECTED_ACTUAL" != "$SOLVER_CHAIN_CONNECTED_EXPECTED" ]; then
            log_and_echo "❌ ERROR: Solver balance mismatch on Chain 2 (Connected MVM)!"
            log_and_echo "   Actual:   $SOLVER_CHAIN_CONNECTED_ACTUAL 10e-6.USDcon"
            log_and_echo "   Expected: $SOLVER_CHAIN_CONNECTED_EXPECTED 10e-6.USDcon"
            display_service_logs "Solver balance mismatch on Chain 2 (Connected MVM)"
            exit 1
        fi
        log_and_echo "✅ Solver balance validated on Chain 2 (Connected MVM): $SOLVER_CHAIN_CONNECTED_ACTUAL 10e-6.USDcon"
    fi
fi

# Validate requester balance on Chain 2 (Connected MVM)
if [ -n "$REQUESTER_CHAIN_CONNECTED_EXPECTED" ] && [ "$REQUESTER_CHAIN_CONNECTED_EXPECTED" != "-1" ] && [ -n "$TEST_TOKENS_MVM_CON" ]; then
    REQUESTER_MVM_CON_ADDRESS=$(get_profile_address "requester-chain2" 2>/dev/null || echo "")
    if [ -n "$REQUESTER_MVM_CON_ADDRESS" ]; then
        REQUESTER_CHAIN_CONNECTED_ACTUAL=$(get_usdxyz_balance "requester-chain2" "2" "0x$TEST_TOKENS_MVM_CON" 2>/dev/null || echo "0")
        
        if [ "$REQUESTER_CHAIN_CONNECTED_ACTUAL" != "$REQUESTER_CHAIN_CONNECTED_EXPECTED" ]; then
            log_and_echo "❌ ERROR: Requester balance mismatch on Chain 2 (Connected MVM)!"
            log_and_echo "   Actual:   $REQUESTER_CHAIN_CONNECTED_ACTUAL 10e-6.USDcon"
            log_and_echo "   Expected: $REQUESTER_CHAIN_CONNECTED_EXPECTED 10e-6.USDcon"
            display_service_logs "Requester balance mismatch on Chain 2 (Connected MVM)"
            exit 1
        fi
        log_and_echo "✅ Requester balance validated on Chain 2 (Connected MVM): $REQUESTER_CHAIN_CONNECTED_ACTUAL 10e-6.USDcon"
    fi
fi

# Explicit success exit (prevents set -e issues from log_and_echo return code)
exit 0
