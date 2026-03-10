#!/bin/bash

# E2E Integration Test Runner - INFLOW (MVM)
#
# Usage: ./run-tests-inflow.sh [--no-build]
#   --no-build  Skip full rebuild; only build binaries that are missing

# -e: exit on error; -o pipefail: fail pipeline if ANY command fails (not just the last).
# Without pipefail, `grep ... | sed ...` silently succeeds even when grep finds no match.
set -eo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
source "$SCRIPT_DIR/../e2e-common.sh"
# "$@" forwards this script's CLI args (e.g. --no-build) into e2e_init for flag parsing
e2e_init "mvm" "inflow" "$@"

e2e_cleanup_pre

e2e_build

generate_integrated_gmp_keys

e2e_setup_chains

e2e_start_services

log_and_echo ""
log_and_echo " Step 5: Testing INFLOW intents (connected chain → hub chain)..."
log_and_echo "==================================================================="
log_and_echo "   Submitting inflow cross-chain intents via coordinator negotiation routing..."
./testing-infra/ci-e2e/e2e-tests-mvm/inflow-submit-hub-intent.sh
log_and_echo ""
log_and_echo " Pre-Escrow Balance Validation"
log_and_echo "=========================================="
# Nobody should have done anything yet: all four actors start with 2 USDhub/USDcon on each chain
./testing-infra/ci-e2e/e2e-tests-mvm/balance-check.sh 2000000 2000000 2000000 2000000

./testing-infra/ci-e2e/e2e-tests-mvm/inflow-submit-escrow.sh

log_and_echo ""
log_and_echo " Step 6: Waiting for solver to automatically fulfill..."
log_and_echo "=========================================================="

# Load intent ID for solver fulfillment wait
if ! load_intent_info "INTENT_ID"; then
    log_and_echo "❌ ERROR: Failed to load intent info"
    exit 1
fi

log_and_echo "   The solver service is running and will:"
log_and_echo "   1. Detect the escrow on connected MVM chain"
log_and_echo "   2. Fulfill the intent on hub chain"
log_and_echo "   3. Integrated-GMP will detect fulfillment and generate approval"
log_and_echo ""

if ! wait_for_solver_fulfillment "$INTENT_ID" "inflow" 20; then
    log_and_echo "❌ ERROR: Solver did not fulfill the intent automatically"
    display_service_logs "Solver fulfillment timeout"
    exit 1
fi

log_and_echo "✅ Solver fulfilled the intent automatically!"
log_and_echo ""

# Wait for escrow auto-release (verifies FulfillmentProof triggered release)
./testing-infra/ci-e2e/e2e-tests-mvm/wait-for-escrow-release.sh

log_and_echo ""
log_and_echo " Final Balance Validation"
log_and_echo "=========================================="
# Inflow: Solver sends 985,000 (desired) to requester on hub, receives 1,000,000 (offered) from escrow
#         Fee = 15,000 embedded in exchange rate (solver keeps the spread)
./testing-infra/ci-e2e/e2e-tests-mvm/balance-check.sh 1015000 2985000 3000000 1000000

log_and_echo ""
log_and_echo " Step 7: Verify solver rejects intent when liquidity is insufficient..."
log_and_echo "=========================================================================="
log_and_echo "   Solver started with 2,000,000 USDhub on hub, spent 985,000 fulfilling intent 1."
log_and_echo "   Remaining: 1,015,000. Second intent requests 1,015,000 desired."
log_and_echo "   Liquidity check: available >= requested + min_balance => 1,015,000 >= 1,015,000 + 1 => false."
log_and_echo "   Solver must reject: not enough to cover the request AND retain the min_balance threshold."

# Resolve chain addresses for the second draft
CONNECTED_CHAIN_ID=2
HUB_CHAIN_ID=1
HUB_MODULE_ADDR=$(get_profile_address "intent-account-chain1")
TEST_TOKENS_HUB=$(get_profile_address "test-tokens-chain1")
USD_MVMCON_MODULE_ADDR=$(get_profile_address "test-tokens-chain2")
REQUESTER_HUB_ADDR=$(get_profile_address "requester-chain1")
USDHUB_METADATA_HUB=$(get_usdxyz_metadata_addr "0x$TEST_TOKENS_HUB" "1")
USD_MVMCON_ADDR=$(get_usdxyz_metadata_addr "0x$USD_MVMCON_MODULE_ADDR" "2")
EXPIRY_TIME=$(date -d "+1 hour" +%s)

SECOND_INTENT_ID="0x$(openssl rand -hex 32)"
DRAFT_DATA=$(build_draft_data \
    "$USD_MVMCON_ADDR" \
    "1030000" \
    "$CONNECTED_CHAIN_ID" \
    "$USDHUB_METADATA_HUB" \
    "1015000" \
    "$HUB_CHAIN_ID" \
    "$EXPIRY_TIME" \
    "$SECOND_INTENT_ID" \
    "$REQUESTER_HUB_ADDR" \
    "15150" \
    "{\"chain_addr\": \"$HUB_MODULE_ADDR\", \"flow_type\": \"inflow\"}")

assert_solver_rejects_draft "$REQUESTER_HUB_ADDR" "$DRAFT_DATA" "$EXPIRY_TIME"
log_and_echo "✅ Solver correctly rejected second intent due to insufficient liquidity!"

e2e_cleanup_post

