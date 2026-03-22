#!/bin/bash
# ==============================================================================
# E2E Common Framework
#
# Shared functions for all E2E test scripts. Source this file from individual
# test scripts to avoid duplicating setup, build, service management, and
# test execution logic.
#
# Usage in test scripts:
#   SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
#   source "$SCRIPT_DIR/../e2e-common.sh"
#   e2e_init "evm" "inflow" "$@"
#   e2e_cleanup_pre
#   e2e_build
#   generate_integrated_gmp_keys
#   e2e_setup_chains
#   e2e_start_services
#   ... chain-specific test logic ...
#   e2e_wait_for_fulfillment "inflow" 20
#   ... more test logic ...
#   e2e_cleanup_post
# ==============================================================================

# Globals set by e2e_init:
#   E2E_CHAIN       - chain name (mvm, evm, svm)
#   E2E_FLOW        - flow type (inflow, outflow)
#   SKIP_BUILD      - whether to skip full builds
#   SCRIPT_DIR      - caller's script directory (must be set before sourcing)
#   PROJECT_ROOT    - project root (set by setup_project_root)

# ------------------------------------------------------------------------------
# e2e_init CHAIN FLOW "$@"
#
# Parse flags, source utilities, setup project root and logging.
# CHAIN: mvm | evm | svm
# FLOW:  inflow | outflow
# "$@":  pass through the script's CLI args (e.g. --no-build) for flag parsing
# ------------------------------------------------------------------------------
e2e_init() {
    local chain="$1"; shift
    local flow="$1"; shift

    export E2E_CHAIN="$chain"
    export E2E_FLOW="$flow"

    # Parse flags from remaining args
    SKIP_BUILD=false
    for arg in "$@"; do
        case "$arg" in
            --no-build) SKIP_BUILD=true ;;
        esac
    done
    export SKIP_BUILD

    # Source common utilities (SCRIPT_DIR must be set by caller)
    local ci_e2e_dir
    ci_e2e_dir="$( cd "$SCRIPT_DIR/.." && pwd )"
    source "$ci_e2e_dir/util.sh"
    source "$ci_e2e_dir/util_mvm.sh"

    # Source chain-specific utilities
    case "$chain" in
        evm) source "$ci_e2e_dir/util_evm.sh" ;;
        svm) source "$ci_e2e_dir/util_svm.sh" ;;
    esac

    # Setup project root and logging
    setup_project_root
    setup_logging "run-tests-${chain}-${flow}"
    cd "$PROJECT_ROOT"

    local flow_upper
    flow_upper=$(echo "$flow" | tr '[:lower:]' '[:upper:]')
    local chain_upper
    chain_upper=$(echo "$chain" | tr '[:lower:]' '[:upper:]')
    log_and_echo " E2E Test for Connected ${chain_upper} Chain - ${flow_upper}"
    log_and_echo "============================================="
    log_and_echo " All output logged to: $LOG_FILE"
    log_and_echo ""
}

# ------------------------------------------------------------------------------
# e2e_cleanup_pre
#
# Clean up any existing chains, accounts, and processes.
# ------------------------------------------------------------------------------
e2e_cleanup_pre() {
    log_and_echo " Cleaning up any existing chains, accounts and processes..."
    log_and_echo "=========================================================="
    ./testing-infra/ci-e2e/chain-connected-${E2E_CHAIN}/cleanup.sh
    # SVM needs extra hub cleanup to avoid stale state
    if [ "$E2E_CHAIN" = "svm" ]; then
        ./testing-infra/ci-e2e/chain-hub/stop-chain.sh || true
    fi
}

# ------------------------------------------------------------------------------
# e2e_build
#
# Build binaries (or build-if-missing with --no-build).
# Handles chain-specific build requirements.
# ------------------------------------------------------------------------------
e2e_build() {
    log_and_echo ""
    if [ "$SKIP_BUILD" = "true" ]; then
        log_and_echo " Build if missing (--no-build)"
        log_and_echo "========================================"
    else
        log_and_echo " Build bins and pre-pull docker images"
        log_and_echo "========================================"
    fi

    # Start docker pull in background — runs in parallel with cargo builds
    docker pull "$APTOS_DOCKER_IMAGE" > /dev/null 2>&1 &
    local docker_pull_pid=$!

    if [ "$SKIP_BUILD" = "true" ]; then
        _e2e_build_skip
    else
        _e2e_build_full
    fi

    # Wait for docker pull to finish
    log_and_echo ""
    wait "$docker_pull_pid"
    log_and_echo "   ✅ Docker image pulled: aptos-tools"
}

# Build-if-missing logic (--no-build mode)
_e2e_build_skip() {
    # SVM on-chain programs
    if [ "$E2E_CHAIN" = "svm" ]; then
        if [ ! -f "$PROJECT_ROOT/intent-frameworks/svm/target/deploy/intent_inflow_escrow.so" ] || \
           [ ! -f "$PROJECT_ROOT/intent-frameworks/svm/target/deploy/intent_gmp.so" ] || \
           [ ! -f "$PROJECT_ROOT/intent-frameworks/svm/target/deploy/intent_outflow_validator.so" ]; then
            pushd "$PROJECT_ROOT/intent-frameworks/svm" > /dev/null
            ./scripts/build-with-docker.sh 2>&1 | tail -5
            popd > /dev/null
            log_and_echo "   ✅ SVM: on-chain programs (built)"
        else
            log_and_echo "   ✅ SVM: on-chain programs (exists)"
        fi
    fi

    build_common_bins_if_missing

    case "$E2E_CHAIN" in
        mvm)
            build_if_missing "$PROJECT_ROOT/solver" "cargo build --bin sign_intent" \
                "Solver: sign_intent" \
                "$PROJECT_ROOT/solver/target/debug/sign_intent"
            ;;
        evm)
            build_if_missing "$PROJECT_ROOT/integrated-gmp" "cargo build --bin get_approver_eth_address" \
                "Integrated-GMP: get_approver_eth_address" \
                "$PROJECT_ROOT/integrated-gmp/target/debug/get_approver_eth_address"
            build_if_missing "$PROJECT_ROOT/solver" "cargo build --bin sign_intent" \
                "Solver: sign_intent" \
                "$PROJECT_ROOT/solver/target/debug/sign_intent"
            ;;
        svm)
            build_if_missing "$PROJECT_ROOT/intent-frameworks/svm" "cargo build -p intent_escrow_cli" \
                "SVM: intent_escrow_cli" \
                "$PROJECT_ROOT/intent-frameworks/svm/target/debug/intent_escrow_cli"
            ;;
    esac
}

# Full build logic — runs independent crate builds in parallel
_e2e_build_full() {
    # Delete existing binaries to ensure fresh build
    rm -f "$PROJECT_ROOT/coordinator/target/debug/coordinator"
    rm -f "$PROJECT_ROOT/integrated-gmp/target/debug/integrated-gmp" "$PROJECT_ROOT/integrated-gmp/target/debug/generate_keys" "$PROJECT_ROOT/integrated-gmp/target/debug/get_approver_eth_address"
    rm -f "$PROJECT_ROOT/solver/target/debug/solver" "$PROJECT_ROOT/solver/target/debug/sign_intent"

    # Determine per-crate --bin flags based on chain type
    local igmp_bins="--bin integrated-gmp --bin generate_keys"
    local solver_bins="--bin solver"

    case "$E2E_CHAIN" in
        mvm)
            solver_bins="--bin solver --bin sign_intent"
            ;;
        evm)
            igmp_bins="--bin integrated-gmp --bin generate_keys --bin get_approver_eth_address"
            solver_bins="--bin solver --bin sign_intent"
            ;;
    esac

    # SVM on-chain programs (Docker-based Anchor build — independent of cargo builds)
    local svm_programs_pid=""
    if [ "$E2E_CHAIN" = "svm" ]; then
        (
            pushd "$PROJECT_ROOT/intent-frameworks/svm" > /dev/null
            ./scripts/build-with-docker.sh 2>&1 | tail -5
            popd > /dev/null
        ) &
        svm_programs_pid=$!
    fi

    # Launch all three crate builds in parallel (each has its own target/ dir)
    (
        pushd "$PROJECT_ROOT/coordinator" > /dev/null
        cargo build --bin coordinator 2>&1 | tail -5
        popd > /dev/null
    ) &
    local coordinator_pid=$!

    (
        pushd "$PROJECT_ROOT/integrated-gmp" > /dev/null
        cargo build $igmp_bins 2>&1 | tail -5
        popd > /dev/null
    ) &
    local igmp_pid=$!

    (
        pushd "$PROJECT_ROOT/solver" > /dev/null
        cargo build $solver_bins 2>&1 | tail -5
        popd > /dev/null
    ) &
    local solver_pid=$!

    # SVM intent_escrow_cli (separate workspace, can also run in parallel)
    local svm_cli_pid=""
    if [ "$E2E_CHAIN" = "svm" ]; then
        (
            pushd "$PROJECT_ROOT/intent-frameworks/svm" > /dev/null
            cargo build -p intent_escrow_cli 2>&1 | tail -5
            popd > /dev/null
        ) &
        svm_cli_pid=$!
    fi

    # Wait for all builds — fail if any fails
    wait "$coordinator_pid"
    log_and_echo "   ✅ Coordinator: coordinator"

    wait "$igmp_pid"
    log_and_echo "   ✅ Integrated-GMP: ${igmp_bins//--bin /}"

    wait "$solver_pid"
    log_and_echo "   ✅ Solver: ${solver_bins//--bin /}"

    if [ -n "$svm_programs_pid" ]; then
        wait "$svm_programs_pid"
        log_and_echo "   ✅ SVM: on-chain programs (intent_inflow_escrow, intent_gmp, intent_outflow_validator)"
    fi

    if [ -n "$svm_cli_pid" ]; then
        wait "$svm_cli_pid"
        log_and_echo "   ✅ SVM: intent_escrow_cli"
    fi
}

# ------------------------------------------------------------------------------
# e2e_setup_chains
#
# Setup chains, deploy contracts, fund accounts.
# Uses chain-specific script paths.
# ------------------------------------------------------------------------------
e2e_setup_chains() {
    log_and_echo " Setting up chains and deploying contracts..."
    log_and_echo "======================================================"

    # Phase 1: Start all chains in parallel (no dependencies between them)
    ./testing-infra/ci-e2e/chain-hub/setup-chain.sh &
    local hub_chain_pid=$!

    ./testing-infra/ci-e2e/chain-connected-${E2E_CHAIN}/setup-chain.sh 2 &
    local connected2_chain_pid=$!

    ./testing-infra/ci-e2e/chain-connected-${E2E_CHAIN}/setup-chain.sh 3 &
    local connected3_chain_pid=$!

    wait "$hub_chain_pid"
    wait "$connected2_chain_pid"
    wait "$connected3_chain_pid"

    # Phase 2: Account setup
    # Hub runs in parallel with connected chains. Connected chains run sequentially
    # for EVM (Hardhat races over compilation cache in the shared project directory)
    # and in parallel for MVM/SVM (flock serializes Aptos CLI config access).
    mkdir -p "$PROJECT_ROOT/.tmp"
    case "$E2E_CHAIN" in
        mvm) openssl rand -hex 32 | sed 's/^/0x/' > "$PROJECT_ROOT/.tmp/solver-mvm-shared-key.hex" ;;
        svm) ensure_svm_keypair "$PROJECT_ROOT/.tmp/solver-svm-shared-key.json" ;;
    esac

    ./testing-infra/ci-e2e/chain-hub/setup-requester-solver.sh &
    local hub_accounts_pid=$!

    if [ "$E2E_CHAIN" = "evm" ]; then
        # EVM: sequential — two npx hardhat processes in the same directory conflict
        ./testing-infra/ci-e2e/chain-connected-${E2E_CHAIN}/setup-requester-solver.sh 2
        ./testing-infra/ci-e2e/chain-connected-${E2E_CHAIN}/setup-requester-solver.sh 3
    else
        ./testing-infra/ci-e2e/chain-connected-${E2E_CHAIN}/setup-requester-solver.sh 2 &
        local connected2_accounts_pid=$!

        ./testing-infra/ci-e2e/chain-connected-${E2E_CHAIN}/setup-requester-solver.sh 3 &
        local connected3_accounts_pid=$!

        wait "$connected2_accounts_pid"
        wait "$connected3_accounts_pid"
    fi

    wait "$hub_accounts_pid"

    # Phase 3: Hub contract deployment (connected deploys depend on HUB_MODULE_ADDR)
    ./testing-infra/ci-e2e/chain-hub/deploy-contracts.sh

    # Phase 4: Connected contract deployments
    # EVM: sequential (same Hardhat cache race as Phase 2)
    # MVM/SVM: parallel (flock serializes Aptos CLI config access)
    if [ "$E2E_CHAIN" = "evm" ]; then
        ./testing-infra/ci-e2e/chain-connected-${E2E_CHAIN}/deploy-contracts.sh 2
        ./testing-infra/ci-e2e/chain-connected-${E2E_CHAIN}/deploy-contracts.sh 3
    else
        ./testing-infra/ci-e2e/chain-connected-${E2E_CHAIN}/deploy-contracts.sh 2 &
        local connected2_deploy_pid=$!

        ./testing-infra/ci-e2e/chain-connected-${E2E_CHAIN}/deploy-contracts.sh 3 &
        local connected3_deploy_pid=$!

        wait "$connected2_deploy_pid"
        wait "$connected3_deploy_pid"
    fi
}

# ------------------------------------------------------------------------------
# e2e_start_services
#
# Start coordinator, integrated-gmp, and solver.
# Verify they are running.
# ------------------------------------------------------------------------------
e2e_start_services() {
    log_and_echo ""
    log_and_echo " Starting coordinator and integrated-gmp..."
    log_and_echo "=========================================================================="
    ./testing-infra/ci-e2e/e2e-tests-${E2E_CHAIN}/start-coordinator.sh
    ./testing-infra/ci-e2e/e2e-tests-${E2E_CHAIN}/start-integrated-gmp.sh

    log_and_echo ""
    log_and_echo " Starting solver service..."
    log_and_echo "======================================="
    ./testing-infra/ci-e2e/e2e-tests-${E2E_CHAIN}/start-solver.sh

    # Verify services started successfully
    ./testing-infra/ci-e2e/verify-solver-running.sh
    ./testing-infra/ci-e2e/verify-integrated-gmp-running.sh
}

# ------------------------------------------------------------------------------
# e2e_wait_for_fulfillment FLOW_TYPE TIMEOUT
#
# Load intent info and wait for solver to fulfill.
# FLOW_TYPE: inflow | outflow
# TIMEOUT: seconds to wait
# ------------------------------------------------------------------------------
e2e_wait_for_fulfillment() {
    local flow_type="$1"
    local timeout="$2"

    if ! load_intent_info "INTENT_ID"; then
        log_and_echo "❌ ERROR: Failed to load intent info"
        exit 1
    fi

    log_and_echo ""
    log_and_echo " Waiting for solver to automatically fulfill..."
    log_and_echo "==========================================================="

    if ! wait_for_solver_fulfillment "$INTENT_ID" "$flow_type" "$timeout"; then
        log_and_echo "❌ ERROR: Solver did not fulfill the intent automatically"
        display_service_logs "Solver fulfillment timeout"
        exit 1
    fi

    log_and_echo "✅ Solver fulfilled the intent automatically!"
    log_and_echo ""
}

# ------------------------------------------------------------------------------
# e2e_cleanup_post
#
# Final cleanup step.
# ------------------------------------------------------------------------------
e2e_cleanup_post() {
    log_and_echo ""
    log_and_echo "✅ E2E ${E2E_FLOW} test completed!"
    log_and_echo ""
    log_and_echo " Cleaning up chains, accounts and processes..."
    log_and_echo "========================================================"
    ./testing-infra/ci-e2e/chain-connected-${E2E_CHAIN}/cleanup.sh
}
