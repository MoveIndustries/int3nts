#!/bin/bash

# E2E Integration Test Runner - PROGRAMMABLE ROUND-TRIP (MVM)
#
# Phase 4a (scaffold): runs a CLASSIC inflow leg (chain 2 → hub) followed by a
# CLASSIC outflow leg (hub → chain 3) in one test, using the existing
# fulfillment helpers and the existing solver flow. Lands the orchestration
# shell so later phases (4b dummy-protocols Move package, 4c solver strategy
# registry, 4d programmable wiring) can layer in programmable behavior without
# first having to debug the test scaffold.
#
# The two legs run against different connected MVM instances (2 for inflow, 3
# for outflow) so each leg starts with its own fresh balances on the connected
# side. Both instances are already started during e2e_setup_chains, so this
# uses already-paid setup cost. Hub balances carry across the legs.
#
# Usage: ./run-tests-programmable-roundtrip.sh [--no-build]
#   --no-build  Skip full rebuild; only build binaries that are missing

# -e: exit on error; -o pipefail: fail pipeline if ANY command fails (not just the last).
# Without pipefail, `grep ... | sed ...` silently succeeds even when grep finds no match.
set -eo pipefail

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
source "$SCRIPT_DIR/../e2e-common.sh"
source "$SCRIPT_DIR/../chain-connected-mvm/utils.sh"
# "$@" forwards this script's CLI args (e.g. --no-build) into e2e_init for flag parsing
e2e_init "mvm" "programmable-roundtrip" "$@"

e2e_cleanup_pre

e2e_build

generate_integrated_gmp_keys

e2e_setup_chains

e2e_start_services

# --- Inflow leg (chain 2 → hub) ---
export MVM_INSTANCE=2
mvm_instance_vars 2

log_and_echo ""
log_and_echo " INFLOW leg: chain 2 → hub (chain ID $MVM_CHAIN_ID)"
log_and_echo "========================================================================="

log_and_echo ""
log_and_echo " Submitting cross-chain inflow intent via coordinator negotiation routing..."
log_and_echo "========================================================================="
./testing-infra/ci-e2e/e2e-tests-mvm/inflow-submit-hub-intent.sh
log_balance_header "Pre-Escrow Balance Validation (inflow, instance 2)"
# Pre: solver_hub=2000000, requester_hub=2000000, solver_mvm2=2000000, requester_mvm2=2000000
./testing-infra/ci-e2e/e2e-tests-mvm/balance-check.sh 2000000 2000000 2000000 2000000

./testing-infra/ci-e2e/e2e-tests-mvm/inflow-submit-escrow.sh
e2e_wait_for_fulfillment "inflow" 20

./testing-infra/ci-e2e/e2e-tests-mvm/wait-for-escrow-release.sh

log_balance_header "Final Balance Validation (inflow, instance 2)"
# Post: solver_hub=1015000, requester_hub=2985000, solver_mvm2=3000000, requester_mvm2=1000000
./testing-infra/ci-e2e/e2e-tests-mvm/balance-check.sh 1015000 2985000 3000000 1000000

log_and_echo "✅ INFLOW leg passed (instance 2)"

# --- Outflow leg (hub → chain 3) ---
export MVM_INSTANCE=3
mvm_instance_vars 3

log_and_echo ""
log_and_echo " OUTFLOW leg: hub → chain 3 (chain ID $MVM_CHAIN_ID)"
log_and_echo "========================================================================="

log_balance_header "Pre-Intent Balance Validation (outflow, instance 3)"
# Pre: hub balances carried from the inflow leg above; mvm3 is fresh.
# solver_hub=1015000, requester_hub=2985000, solver_mvm3=2000000, requester_mvm3=2000000
./testing-infra/ci-e2e/e2e-tests-mvm/balance-check.sh 1015000 2985000 2000000 2000000

./testing-infra/ci-e2e/e2e-tests-mvm/outflow-submit-hub-intent.sh

e2e_wait_for_fulfillment "outflow" 40

log_balance_header "Final Balance View (outflow, instance 3)"
# Post: solver_hub=2015000, requester_hub=1985000, solver_mvm3=1015000, requester_mvm3=2985000
./testing-infra/ci-e2e/e2e-tests-mvm/balance-check.sh 2015000 1985000 1015000 2985000

log_and_echo "✅ OUTFLOW leg passed (instance 3)"

e2e_cleanup_post
