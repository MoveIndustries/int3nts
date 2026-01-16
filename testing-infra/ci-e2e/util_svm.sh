#!/bin/bash

# SVM-specific utilities for testing infrastructure scripts
# This file MUST be sourced AFTER util.sh
# Usage:
#   source "$(dirname "$0")/../util.sh"
#   source "$(dirname "$0")/../util_svm.sh"

set -e

# Run a Solana CLI command inside nix develop
# Usage: svm_cmd "<command>"
svm_cmd() {
    local cmd="$1"
    if [ -z "$cmd" ]; then
        log_and_echo "❌ ERROR: svm_cmd requires a command"
        exit 1
    fi
    if [ -z "$PROJECT_ROOT" ]; then
        setup_project_root
    fi
    nix develop "$PROJECT_ROOT" -c bash -c "$cmd"
}

# Check if SVM chain is running
# Usage: check_svm_chain_running [rpc_url]
check_svm_chain_running() {
    local rpc_url="${1:-http://127.0.0.1:8899}"
    if curl -s -X POST "$rpc_url" \
        -H "Content-Type: application/json" \
        -d '{"jsonrpc":"2.0","method":"getHealth","params":[],"id":1}' \
        | grep -q '"result":"ok"'; then
        return 0
    fi
    return 1
}

# Ensure a keypair exists at the given path
# Usage: ensure_svm_keypair <path>
ensure_svm_keypair() {
    local keypair_path="$1"
    if [ -z "$keypair_path" ]; then
        log_and_echo "❌ ERROR: ensure_svm_keypair requires a keypair path"
        exit 1
    fi

    if [ ! -f "$keypair_path" ]; then
        log "   Generating keypair: $keypair_path"
        svm_cmd "solana-keygen new --no-bip39-passphrase --silent -o \"$keypair_path\""
    else
        log "   ✅ Keypair already exists: $keypair_path"
    fi
}

# Get base58 pubkey for a keypair file
# Usage: get_svm_pubkey <keypair_path>
get_svm_pubkey() {
    local keypair_path="$1"
    svm_cmd "solana-keygen pubkey \"$keypair_path\""
}

# Convert base58 pubkey to 0x-hex string
# Usage: svm_pubkey_to_hex <base58_pubkey>
svm_pubkey_to_hex() {
    python - "$1" <<'PY'
import sys
alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
def b58decode(s):
    num = 0
    for c in s:
        num *= 58
        num += alphabet.index(c)
    combined = num.to_bytes((num.bit_length() + 7) // 8, "big")
    # handle leading zeros
    n_pad = len(s) - len(s.lstrip("1"))
    return b"\x00" * n_pad + combined

pubkey = sys.argv[1]
raw = b58decode(pubkey)
print("0x" + raw.hex())
PY
}

# Convert base64-encoded public key bytes to base58
# Usage: svm_base64_to_base58 <base64_pubkey>
svm_base64_to_base58() {
    python - "$1" <<'PY'
import base64
import sys

alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
def b58encode(data: bytes) -> str:
    num = int.from_bytes(data, "big")
    enc = ""
    while num > 0:
        num, rem = divmod(num, 58)
        enc = alphabet[rem] + enc
    # handle leading zeros
    n_pad = len(data) - len(data.lstrip(b"\x00"))
    return "1" * n_pad + enc

raw = base64.b64decode(sys.argv[1])
print(b58encode(raw))
PY
}

# Airdrop SOL to a pubkey
# Usage: airdrop_svm <pubkey> <amount> [rpc_url]
airdrop_svm() {
    local pubkey="$1"
    local amount="${2:-10}"
    local rpc_url="${3:-http://127.0.0.1:8899}"
    svm_cmd "solana airdrop \"$amount\" \"$pubkey\" --url \"$rpc_url\" >/dev/null"
}

# Create an SPL token mint
# Usage: create_svm_mint <payer_keypair> [rpc_url]
create_svm_mint() {
    local payer_keypair="$1"
    local rpc_url="${2:-http://127.0.0.1:8899}"
    svm_cmd "spl-token create-token --decimals 6 --url \"$rpc_url\" --fee-payer \"$payer_keypair\" \
        | awk '/Creating token/ {print \$3}'"
}

# Create an SPL token account
# Usage: create_svm_token_account <mint> <owner_pubkey> <payer_keypair> [rpc_url]
create_svm_token_account() {
    local mint="$1"
    local owner="$2"
    local payer_keypair="$3"
    local rpc_url="${4:-http://127.0.0.1:8899}"
    svm_cmd "spl-token create-account \"$mint\" --owner \"$owner\" --url \"$rpc_url\" --fee-payer \"$payer_keypair\" \
        | awk '/Creating account/ {print \$3}'"
}

# Mint tokens to an account
# Usage: mint_svm_tokens <mint> <amount> <account> <payer_keypair> [rpc_url]
mint_svm_tokens() {
    local mint="$1"
    local amount="$2"
    local account="$3"
    local payer_keypair="$4"
    local rpc_url="${5:-http://127.0.0.1:8899}"
    svm_cmd "spl-token mint \"$mint\" \"$amount\" \"$account\" --url \"$rpc_url\" --fee-payer \"$payer_keypair\""
}
