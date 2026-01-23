#!/bin/bash

# Start Services for EVM E2E Tests
#
# This script configures and starts both coordinator and trusted-gmp services.
# - Coordinator: Monitoring and negotiation (port 3333, NO keys)
# - Trusted-GMP: Validation and signing (port 3334, HAS keys)

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
source "$SCRIPT_DIR/../util.sh"

setup_project_root
setup_logging "services-start-evm"
cd "$PROJECT_ROOT"

log ""
log " Starting Coordinator and Trusted-GMP Services..."
log "=================================================="
log_and_echo " All output logged to: $LOG_FILE"
log ""

# ============================================================================
# SECTION 1: CONFIGURE AND START COORDINATOR
# ============================================================================
log " Configuring coordinator..."
source "$PROJECT_ROOT/testing-infra/ci-e2e/chain-hub/configure-coordinator.sh"
source "$PROJECT_ROOT/testing-infra/ci-e2e/chain-connected-evm/configure-coordinator.sh"

log ""
log "   Starting coordinator service..."
start_coordinator "$LOG_DIR/coordinator.log" "info"

# ============================================================================
# SECTION 2: CONFIGURE AND START TRUSTED-GMP
# ============================================================================
log ""
log " Configuring trusted-gmp..."
source "$PROJECT_ROOT/testing-infra/ci-e2e/chain-hub/configure-trusted-gmp.sh"
source "$PROJECT_ROOT/testing-infra/ci-e2e/chain-connected-evm/configure-trusted-gmp.sh"

log ""
log "   Starting trusted-gmp service..."
start_trusted_gmp "$LOG_DIR/trusted-gmp.log" "info"

log ""
log_and_echo " Services started successfully"
log_and_echo "   Coordinator: port 3333"
log_and_echo "   Trusted-GMP: port 3334"
