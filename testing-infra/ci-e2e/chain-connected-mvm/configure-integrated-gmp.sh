#!/bin/bash

# Configure Integrated-GMP for Connected Move VM Chain
#
# This script adds the [connected_chain_mvm] section to integrated-gmp-e2e-ci-testing.toml.
# Must be called AFTER chain-hub/configure-integrated-gmp.sh which creates the base config.

set -e

# Source common utilities
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
source "$SCRIPT_DIR/../util.sh"
source "$SCRIPT_DIR/../util_mvm.sh"

# Setup project root and logging
setup_project_root
setup_logging "configure-integrated-gmp-connected-mvm"
cd "$PROJECT_ROOT"

log_and_echo "   Configuring integrated-gmp for Connected Move VM Chain..."
log_and_echo ""

# Extract deployed address from aptos profile
CHAIN2_ADDR=$(get_profile_address "intent-account-chain2")

if [ -z "$CHAIN2_ADDR" ]; then
    log_and_echo "   ERROR: Could not extract Chain 2 deployed module address"
    exit 1
fi

log_and_echo "   Chain 2 deployer: $CHAIN2_ADDR"

# Config file path (created by chain-hub/configure-integrated-gmp.sh)
INTEGRATED_GMP_E2E_CI_TESTING_CONFIG="$PROJECT_ROOT/integrated-gmp/config/integrated-gmp-e2e-ci-testing.toml"

if [ ! -f "$INTEGRATED_GMP_E2E_CI_TESTING_CONFIG" ]; then
    log_and_echo "   ERROR: Config file not found. Run chain-hub/configure-integrated-gmp.sh first."
    exit 1
fi

# Append connected_chain_mvm section to config (insert before [integrated_gmp] section)
TEMP_FILE=$(mktemp)
cat > "$TEMP_FILE" << EOF

[connected_chain_mvm]
name = "Connected Move VM Chain"
rpc_url = "http://127.0.0.1:8082"
chain_id = 2
intent_module_addr = "0x$CHAIN2_ADDR"
escrow_module_addr = "0x$CHAIN2_ADDR"
EOF

# Insert the MVM section before [integrated_gmp] section
awk -v mvm_section="$(cat $TEMP_FILE)" '
/^\[integrated_gmp\]/ { print mvm_section; print ""; }
{ print }
' "$INTEGRATED_GMP_E2E_CI_TESTING_CONFIG" > "${INTEGRATED_GMP_E2E_CI_TESTING_CONFIG}.tmp"
mv "${INTEGRATED_GMP_E2E_CI_TESTING_CONFIG}.tmp" "$INTEGRATED_GMP_E2E_CI_TESTING_CONFIG"

rm -f "$TEMP_FILE"

export INTEGRATED_GMP_CONFIG_PATH="$INTEGRATED_GMP_E2E_CI_TESTING_CONFIG"

log_and_echo "   Added Connected Move VM Chain section to integrated-gmp config"
log_and_echo ""
