#!/bin/bash

# Wait for escrow claim script for MVM E2E tests
# Polls the inflow_escrow_gmp::is_released view function on connected MVM chain
# to verify the solver has claimed the escrow after fulfillment.

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
source "$SCRIPT_DIR/../util.sh"
source "$SCRIPT_DIR/../util_mvm.sh"

setup_project_root

# Load intent info
if ! load_intent_info "INTENT_ID"; then
    exit 1
fi

MVMCON_MODULE_ADDR=$(get_profile_address "intent-account-chain2")

# Format intent_id for view function call: strip 0x prefix, zero-pad to 64 hex chars
INTENT_ID_HEX=$(echo "$INTENT_ID" | sed 's/^0x//')
INTENT_ID_HEX=$(printf "%064s" "$INTENT_ID_HEX" | tr ' ' '0')

log_and_echo "⏳ Waiting for solver to claim escrow..."
log "   Intent ID: $INTENT_ID"
log "   Module: 0x${MVMCON_MODULE_ADDR}::inflow_escrow_gmp::is_released"

# Poll for escrow release (max 30 seconds, every 2 seconds)
MAX_ATTEMPTS=15
ATTEMPT=1
ESCROW_CLAIMED=false

while [ $ATTEMPT -le $MAX_ATTEMPTS ]; do
    IS_RELEASED=$(curl -s "http://127.0.0.1:8082/v1/view" \
        -H 'Content-Type: application/json' \
        -d "{
            \"function\": \"0x${MVMCON_MODULE_ADDR}::inflow_escrow_gmp::is_released\",
            \"type_arguments\": [],
            \"arguments\": [\"0x${INTENT_ID_HEX}\"]
        }" 2>/dev/null | jq -r '.[0]' 2>/dev/null)

    if [ "$IS_RELEASED" = "true" ]; then
        log_and_echo "   ✅ Escrow claimed! (is_released=true)"
        ESCROW_CLAIMED=true
        break
    fi

    log "   Attempt $ATTEMPT/$MAX_ATTEMPTS: Escrow not yet released, waiting..."
    if [ $ATTEMPT -lt $MAX_ATTEMPTS ]; then
        sleep 2
    fi
    ATTEMPT=$((ATTEMPT + 1))
done

if [ "$ESCROW_CLAIMED" = "false" ]; then
    log_and_echo "❌ PANIC: Escrow not claimed after ${MAX_ATTEMPTS} attempts ($((MAX_ATTEMPTS * 2))s)"
    log_and_echo "   Intent ID: $INTENT_ID"
    display_service_logs "Escrow claim timeout"
    exit 1
fi

log_and_echo "✅ Escrow claim verified!"
