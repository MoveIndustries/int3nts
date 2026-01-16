#!/bin/bash

# Setup SVM requester/solver accounts and test mint

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
source "$SCRIPT_DIR/../util.sh"
source "$SCRIPT_DIR/../util_svm.sh"

setup_project_root
setup_logging "setup-svm-requester-solver"
cd "$PROJECT_ROOT"

log "🧪 Requester and Solver Account Setup - SVM CHAIN"
log "================================================="
log_and_echo "📝 All output logged to: $LOG_FILE"

SVM_RPC_URL="http://127.0.0.1:8899"
E2E_DIR="$PROJECT_ROOT/.tmp/svm-e2e"
mkdir -p "$E2E_DIR"

PAYER_KEYPAIR="$E2E_DIR/payer.json"
REQUESTER_KEYPAIR="$E2E_DIR/requester.json"
SOLVER_KEYPAIR="$E2E_DIR/solver.json"

log ""
log "🔑 Creating keypairs..."
ensure_svm_keypair "$PAYER_KEYPAIR"
ensure_svm_keypair "$REQUESTER_KEYPAIR"
ensure_svm_keypair "$SOLVER_KEYPAIR"

PAYER_PUBKEY=$(get_svm_pubkey "$PAYER_KEYPAIR")
REQUESTER_PUBKEY=$(get_svm_pubkey "$REQUESTER_KEYPAIR")
SOLVER_PUBKEY=$(get_svm_pubkey "$SOLVER_KEYPAIR")

log "   ✅ Payer:     $PAYER_PUBKEY"
log "   ✅ Requester: $REQUESTER_PUBKEY"
log "   ✅ Solver:    $SOLVER_PUBKEY"

log ""
log "💰 Airdropping SOL..."
airdrop_svm "$PAYER_PUBKEY" 10 "$SVM_RPC_URL"
airdrop_svm "$REQUESTER_PUBKEY" 10 "$SVM_RPC_URL"
airdrop_svm "$SOLVER_PUBKEY" 10 "$SVM_RPC_URL"

log ""
log "🪙 Creating test SPL token mint..."
MINT_ADDR=$(create_svm_mint "$PAYER_KEYPAIR" "$SVM_RPC_URL")
if [ -z "$MINT_ADDR" ]; then
    log_and_echo "❌ ERROR: Failed to create SPL token mint"
    exit 1
fi
log "   ✅ Mint: $MINT_ADDR"

log ""
log "📦 Creating token accounts..."
REQUESTER_TOKEN=$(create_svm_token_account "$MINT_ADDR" "$REQUESTER_PUBKEY" "$PAYER_KEYPAIR" "$SVM_RPC_URL")
SOLVER_TOKEN=$(create_svm_token_account "$MINT_ADDR" "$SOLVER_PUBKEY" "$PAYER_KEYPAIR" "$SVM_RPC_URL")

log "   ✅ Requester token account: $REQUESTER_TOKEN"
log "   ✅ Solver token account:    $SOLVER_TOKEN"

log ""
log "🪙 Minting tokens..."
# mint_svm_tokens takes UI amount (tokens). 1 token = 1_000_000 base units.
mint_svm_tokens "$MINT_ADDR" 1 "$REQUESTER_TOKEN" "$PAYER_KEYPAIR" "$SVM_RPC_URL"
mint_svm_tokens "$MINT_ADDR" 1 "$SOLVER_TOKEN" "$PAYER_KEYPAIR" "$SVM_RPC_URL"

log ""
log "📝 Saving chain info..."
CHAIN_INFO="$PROJECT_ROOT/.tmp/chain-info.env"
cat >> "$CHAIN_INFO" << EOF
SVM_RPC_URL=$SVM_RPC_URL
SVM_PAYER_KEYPAIR=$PAYER_KEYPAIR
SVM_REQUESTER_KEYPAIR=$REQUESTER_KEYPAIR
SVM_SOLVER_KEYPAIR=$SOLVER_KEYPAIR
SVM_REQUESTER_PUBKEY=$REQUESTER_PUBKEY
SVM_SOLVER_PUBKEY=$SOLVER_PUBKEY
SVM_TOKEN_MINT=$MINT_ADDR
SVM_REQUESTER_TOKEN=$REQUESTER_TOKEN
SVM_SOLVER_TOKEN=$SOLVER_TOKEN
SVM_CHAIN_ID=4
EOF

log ""
log "✅ SVM requester/solver setup complete"
