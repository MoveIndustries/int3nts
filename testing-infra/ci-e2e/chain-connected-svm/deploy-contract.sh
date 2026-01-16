#!/bin/bash

# Deploy SVM intent escrow program and initialize state

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
source "$SCRIPT_DIR/../util.sh"
source "$SCRIPT_DIR/../util_svm.sh"

setup_project_root
setup_logging "deploy-svm-program"
cd "$PROJECT_ROOT"

log "🚀 Deploying SVM intent escrow program..."
log_and_echo "📝 All output logged to: $LOG_FILE"

SVM_RPC_URL="http://127.0.0.1:8899"
CHAIN_INFO="$PROJECT_ROOT/.tmp/chain-info.env"

if [ -f "$CHAIN_INFO" ]; then
    source "$CHAIN_INFO"
fi

if [ -z "$SVM_PAYER_KEYPAIR" ]; then
    log_and_echo "❌ ERROR: SVM_PAYER_KEYPAIR not found. Run setup-requester-solver.sh first."
    exit 1
fi

PROGRAM_DIR="$PROJECT_ROOT/svm-intent-framework"
PROGRAM_KEYPAIR="$PROGRAM_DIR/target/deploy/intent_escrow-keypair.json"
PROGRAM_SO="$PROGRAM_DIR/target/deploy/intent_escrow.so"

log "   Building program..."
nix develop "$PROJECT_ROOT" -c bash -c "cd \"$PROGRAM_DIR\" && ./scripts/build.sh" >> "$LOG_FILE" 2>&1

if [ ! -f "$PROGRAM_KEYPAIR" ]; then
    log "   Generating program keypair..."
    svm_cmd "solana-keygen new --no-bip39-passphrase --silent -o \"$PROGRAM_KEYPAIR\""
fi

log "   Deploying to $SVM_RPC_URL..."
svm_cmd "solana program deploy --url \"$SVM_RPC_URL\" --keypair \"$SVM_PAYER_KEYPAIR\" \"$PROGRAM_SO\" --program-id \"$PROGRAM_KEYPAIR\"" >> "$LOG_FILE" 2>&1

PROGRAM_ID=$(svm_cmd "solana address -k \"$PROGRAM_KEYPAIR\"")
log "   ✅ Program deployed: $PROGRAM_ID"

log ""
log "🔐 Initializing program state..."
if [ -z "$E2E_VERIFIER_PUBLIC_KEY" ]; then
    load_verifier_keys
fi

SVM_VERIFIER_PUBKEY=$(svm_base64_to_base58 "$E2E_VERIFIER_PUBLIC_KEY")
SVM_PROGRAM_ID="$PROGRAM_ID"

nix develop "$PROJECT_ROOT" -c bash -c "cd \"$PROGRAM_DIR\" && SVM_VERIFIER_PUBKEY=\"$SVM_VERIFIER_PUBKEY\" SVM_PROGRAM_ID=\"$SVM_PROGRAM_ID\" SVM_RPC_URL=\"$SVM_RPC_URL\" SVM_PAYER_KEYPAIR=\"$SVM_PAYER_KEYPAIR\" ./scripts/initialize.sh" >> "$LOG_FILE" 2>&1

log ""
log "📝 Saving chain info..."
cat >> "$CHAIN_INFO" << EOF
SVM_PROGRAM_ID=$PROGRAM_ID
EOF

log ""
log "✅ SVM program deploy + init complete"
