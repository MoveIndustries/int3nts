#!/bin/bash

# Source common utilities
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
source "$SCRIPT_DIR/../util.sh"
source "$SCRIPT_DIR/../util_mvm.sh"
source "$SCRIPT_DIR/../util_svm.sh"

# Setup project root and logging
setup_project_root
setup_logging "submit-hub-intent-svm-inflow"
cd "$PROJECT_ROOT"

verify_verifier_running
verify_solver_running
verify_solver_registered

INTENT_ID="0x$(openssl rand -hex 32)"

CONNECTED_CHAIN_ID=4
HUB_CHAIN_ID=1

CHAIN1_ADDRESS=$(get_profile_address "intent-account-chain1")
TEST_TOKENS_CHAIN1=$(get_profile_address "test-tokens-chain1")
REQUESTER_CHAIN1_ADDRESS=$(get_profile_address "requester-chain1")
SOLVER_CHAIN1_ADDRESS=$(get_profile_address "solver-chain1")

source "$PROJECT_ROOT/.tmp/chain-info.env" 2>/dev/null || true

if [ -z "$SVM_REQUESTER_PUBKEY" ] || [ -z "$SVM_SOLVER_PUBKEY" ] || [ -z "$SVM_TOKEN_MINT" ]; then
    log_and_echo "❌ ERROR: Missing SVM chain info. Run chain-connected-svm/setup-requester-solver.sh first."
    exit 1
fi

REQUESTER_CHAIN2_ADDRESS=$(svm_pubkey_to_hex "$SVM_REQUESTER_PUBKEY")
SOLVER_CHAIN2_ADDRESS=$(svm_pubkey_to_hex "$SVM_SOLVER_PUBKEY")

log ""
log "📋 Chain Information:"
log "   Hub Chain Module Address (Chain 1):     $CHAIN1_ADDRESS"
log "   Requester Chain 1 (hub):               $REQUESTER_CHAIN1_ADDRESS"
log "   Solver Chain 1 (hub):                  $SOLVER_CHAIN1_ADDRESS"
log "   Requester Chain 2 (SVM hex):           $REQUESTER_CHAIN2_ADDRESS"
log "   Solver Chain 2 (SVM hex):              $SOLVER_CHAIN2_ADDRESS"

EXPIRY_TIME=$(date -d "+1 hour" +%s)
OFFERED_AMOUNT="1000000"
DESIRED_AMOUNT="1000000"

log ""
log "🔑 Configuration:"
log "   Intent ID: $INTENT_ID"
log "   Expiry time: $EXPIRY_TIME"
log "   Offered amount: $OFFERED_AMOUNT (1 token on connected SVM)"
log "   Desired amount: $DESIRED_AMOUNT (1 USDhub on hub chain)"

log ""
log "   - Getting USD token metadata addresses..."
USDHUB_METADATA_CHAIN1=$(get_usdxyz_metadata "0x$TEST_TOKENS_CHAIN1" "1")
if [ -z "$USDHUB_METADATA_CHAIN1" ]; then
    log_and_echo "❌ Failed to get USDhub metadata on Chain 1"
    exit 1
fi
log "     ✅ Got USDhub metadata on Chain 1: $USDHUB_METADATA_CHAIN1"

SVM_TOKEN_HEX=$(svm_pubkey_to_hex "$SVM_TOKEN_MINT")
OFFERED_METADATA_CHAIN2="$SVM_TOKEN_HEX"
DESIRED_METADATA_CHAIN1="$USDHUB_METADATA_CHAIN1"

log "     Inflow configuration:"
log "       Offered metadata (connected SVM): $OFFERED_METADATA_CHAIN2"
log "       Desired metadata (hub chain 1):   $DESIRED_METADATA_CHAIN1"

log ""
display_balances_hub "0x$TEST_TOKENS_CHAIN1"
log_and_echo ""

log ""
log "🔄 Starting verifier-based negotiation routing..."
log "   Flow: Requester → Verifier → Solver → Verifier → Requester"

log ""
log "   Step 1: Requester submits draft intent to verifier..."
DRAFT_DATA=$(build_draft_data \
    "$OFFERED_METADATA_CHAIN2" \
    "$OFFERED_AMOUNT" \
    "$CONNECTED_CHAIN_ID" \
    "$DESIRED_METADATA_CHAIN1" \
    "$DESIRED_AMOUNT" \
    "$HUB_CHAIN_ID" \
    "$EXPIRY_TIME" \
    "$INTENT_ID" \
    "$REQUESTER_CHAIN1_ADDRESS" \
    "{\"chain_addr\": \"$CHAIN1_ADDRESS\", \"flow_type\": \"inflow\", \"connected_chain_type\": \"svm\"}")

DRAFT_ID=$(submit_draft_intent "$REQUESTER_CHAIN1_ADDRESS" "$DRAFT_DATA" "$EXPIRY_TIME")
log "     Draft ID: $DRAFT_ID"

log ""
log "   Step 2: Waiting for solver service to sign draft..."
SIGNATURE_DATA=$(poll_for_signature "$DRAFT_ID" 10 2)
RETRIEVED_SIGNATURE=$(echo "$SIGNATURE_DATA" | jq -r '.signature')
RETRIEVED_SOLVER=$(echo "$SIGNATURE_DATA" | jq -r '.solver_addr')

if [ -z "$RETRIEVED_SIGNATURE" ] || [ "$RETRIEVED_SIGNATURE" = "null" ]; then
    log_and_echo "❌ ERROR: Failed to retrieve signature from verifier"
    display_service_logs "SVM inflow draft signature missing"
    exit 1
fi

log "     ✅ Retrieved signature from solver: $RETRIEVED_SOLVER"
log "     Signature: ${RETRIEVED_SIGNATURE:0:20}..."

log ""
log "   Creating cross-chain intent on Chain 1..."
log "     Offered metadata (connected chain): $OFFERED_METADATA_CHAIN2"
log "     Desired metadata (hub chain): $DESIRED_METADATA_CHAIN1"
log "     Solver address: $RETRIEVED_SOLVER"

SOLVER_SIGNATURE_HEX="${RETRIEVED_SIGNATURE#0x}"
aptos move run --profile requester-chain1 --assume-yes \
    --function-id "0x${CHAIN1_ADDRESS}::fa_intent_inflow::create_inflow_intent_entry" \
    --args "address:${OFFERED_METADATA_CHAIN2}" "u64:${OFFERED_AMOUNT}" "u64:${CONNECTED_CHAIN_ID}" "address:${DESIRED_METADATA_CHAIN1}" "u64:${DESIRED_AMOUNT}" "u64:${HUB_CHAIN_ID}" "u64:${EXPIRY_TIME}" "address:${INTENT_ID}" "address:${RETRIEVED_SOLVER}" "hex:${SOLVER_SIGNATURE_HEX}" "address:${REQUESTER_CHAIN2_ADDRESS}" >> "$LOG_FILE" 2>&1

if [ $? -eq 0 ]; then
    log "     ✅ Request-intent created on Chain 1!"
    sleep 2
    HUB_INTENT_ADDRESS=$(curl -s "http://127.0.0.1:8080/v1/accounts/${REQUESTER_CHAIN1_ADDRESS}/transactions?limit=1" | \
        jq -r '.[0].events[] | select(.type | contains("LimitOrderEvent")) | .data.intent_addr' | head -n 1)
    if [ -n "$HUB_INTENT_ADDRESS" ] && [ "$HUB_INTENT_ADDRESS" != "null" ]; then
        log "     ✅ Hub intent stored at: $HUB_INTENT_ADDRESS"
        log_and_echo "✅ Request-intent created (via verifier negotiation)"
    else
        log_and_echo "❌ ERROR: Could not verify hub intent address"
        exit 1
    fi
else
    log_and_echo "❌ Request-intent creation failed on Chain 1!"
    log_and_echo "   Log file contents:"
    log_and_echo "   + + + + + + + + + + + + + + + + + + + +"
    cat "$LOG_FILE"
    log_and_echo "   + + + + + + + + + + + + + + + + + + + +"
    exit 1
fi

log ""
log "🎉 INFLOW - HUB CHAIN INTENT CREATION COMPLETE!"
log "================================================"
log ""
log "✅ Steps completed successfully (via verifier-based negotiation):"
log "   1. Solver registered on-chain"
log "   2. Requester submitted draft intent to verifier"
log "   3. Solver service signed draft automatically (FCFS)"
log "   4. Requester polled verifier and retrieved signature"
log "   5. Requester created intent on-chain with retrieved signature"
log ""
log "📋 Request-intent Details:"
log "   Intent ID: $INTENT_ID"
log "   Draft ID: $DRAFT_ID"
log "   Solver: $RETRIEVED_SOLVER"
if [ -n "$HUB_INTENT_ADDRESS" ] && [ "$HUB_INTENT_ADDRESS" != "null" ]; then
    log "   Chain 1 Hub Request-intent: $HUB_INTENT_ADDRESS"
fi

save_intent_info "$INTENT_ID" "$HUB_INTENT_ADDRESS"
