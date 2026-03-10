#!/bin/bash

# E2E Integration Test Runner - INFLOW (EVM)
#
# Usage: ./run-tests-inflow.sh [--no-build]
#   --no-build  Skip full rebuild; only build binaries that are missing

# -e: exit on error; -o pipefail: fail pipeline if ANY command fails (not just the last).
# Without pipefail, `grep ... | sed ...` silently succeeds even when grep finds no match.
set -eo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
source "$SCRIPT_DIR/../e2e-common.sh"
# "$@" forwards this script's CLI args (e.g. --no-build) into e2e_init for flag parsing
e2e_init "evm" "inflow" "$@"

e2e_cleanup_pre

e2e_build

generate_integrated_gmp_keys

e2e_setup_chains

e2e_start_services

log_and_echo ""
log_and_echo " Step 5: Submitting cross-chain intents via coordinator negotiation routing..."
log_and_echo "============================================================================="
./testing-infra/ci-e2e/e2e-tests-evm/inflow-submit-hub-intent.sh
log_and_echo ""
log_and_echo " Pre-Escrow Balance Validation"
log_and_echo "=========================================="
log_and_echo "   Nobody should have moved funds yet; all four actors start with 2 USDhub/USDcon tokens on each chain"
./testing-infra/ci-e2e/e2e-tests-evm/balance-check.sh 2000000 2000000 2000000 2000000

./testing-infra/ci-e2e/e2e-tests-evm/inflow-submit-escrow.sh
e2e_wait_for_fulfillment "inflow" 20

# Wait for escrow release (happens automatically when fulfillment proof arrives)
./testing-infra/ci-e2e/e2e-tests-evm/wait-for-escrow-release.sh

log_and_echo ""
log_and_echo " Final Balance Validation"
log_and_echo "=========================================="
# Inflow: Solver sends 985,000 (desired) to requester on hub, receives 1,000,000 (offered) from escrow
#         Fee = 15,000 embedded in exchange rate (solver keeps the spread)
./testing-infra/ci-e2e/e2e-tests-evm/balance-check.sh 1015000 2985000 3000000 1000000

CONNECTED_CHAIN_ID=31337
HUB_CHAIN_ID=1
HUB_MODULE_ADDR=$(get_profile_address "intent-account-chain1")
TEST_TOKENS_HUB=$(get_profile_address "test-tokens-chain1")
REQUESTER_HUB_ADDR=$(get_profile_address "requester-chain1")
USDHUB_METADATA_HUB=$(get_usdxyz_metadata_addr "0x$TEST_TOKENS_HUB" "1")

source "$PROJECT_ROOT/.tmp/chain-info.env" 2>/dev/null || true
EVM_TOKEN_ADDR_NO_PREFIX="${USD_EVM_ADDR#0x}"
EVM_TOKEN_ADDR_LOWER=$(echo "$EVM_TOKEN_ADDR_NO_PREFIX" | tr '[:upper:]' '[:lower:]')
OFFERED_METADATA_EVM="0x000000000000000000000000${EVM_TOKEN_ADDR_LOWER}"

EXPIRY_TIME=$(date -d "+1 hour" +%s)
SECOND_INTENT_ID="0x$(openssl rand -hex 32)"
DRAFT_DATA=$(build_draft_data \
    "$OFFERED_METADATA_EVM" \
    "1030000" \
    "$CONNECTED_CHAIN_ID" \
    "$USDHUB_METADATA_HUB" \
    "1015000" \
    "$HUB_CHAIN_ID" \
    "$EXPIRY_TIME" \
    "$SECOND_INTENT_ID" \
    "$REQUESTER_HUB_ADDR" \
    "15150" \
    "{\"chain_addr\": \"$HUB_MODULE_ADDR\", \"flow_type\": \"inflow\", \"connected_chain_type\": \"evm\"}")

assert_solver_rejects_draft "$REQUESTER_HUB_ADDR" "$DRAFT_DATA" "$EXPIRY_TIME"
log_and_echo "✅ Solver correctly rejected second intent due to insufficient liquidity!"

e2e_cleanup_post