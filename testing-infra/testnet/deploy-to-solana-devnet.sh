#!/bin/bash

# Deploy SVM GMP Contracts to Solana Devnet
# Deploys all 3 programs: intent_inflow_escrow, intent_gmp, intent_outflow_validator
# Reads keys from .env.testnet and deploys the programs

set -e

# Get the script directory and project root
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$( cd "$SCRIPT_DIR/../.." && pwd )"
export PROJECT_ROOT

# Re-exec inside nix develop if not already in a nix shell
if [ -z "${IN_NIX_SHELL:-}" ]; then
    exec nix develop "$PROJECT_ROOT/nix" --command bash "$SCRIPT_DIR/deploy-to-solana-devnet.sh" "$@"
fi

echo " Deploying GMP Contracts to Solana Devnet"
echo "=========================================="
echo ""

# Load .env.testnet
TESTNET_KEYS_FILE="$SCRIPT_DIR/.env.testnet"

if [ ! -f "$TESTNET_KEYS_FILE" ]; then
    echo "❌ ERROR: .env.testnet not found at $TESTNET_KEYS_FILE"
    echo "   Create it from env.testnet.example in this directory"
    exit 1
fi

# Source the keys file
source "$TESTNET_KEYS_FILE"

# Check required variables
if [ -z "$SOLANA_DEPLOYER_PRIVATE_KEY" ]; then
    echo "❌ ERROR: SOLANA_DEPLOYER_PRIVATE_KEY not set in .env.testnet"
    exit 1
fi

if [ -z "$SOLANA_DEPLOYER_ADDR" ]; then
    echo "❌ ERROR: SOLANA_DEPLOYER_ADDR not set in .env.testnet"
    exit 1
fi

if [ -z "$MOVEMENT_INTENT_MODULE_ADDR" ]; then
    echo "❌ ERROR: MOVEMENT_INTENT_MODULE_ADDR not set in .env.testnet"
    echo "   This should be set to the deployed MVM hub intent module address"
    exit 1
fi

# Solana devnet RPC
SOLANA_RPC_URL="${SOLANA_RPC_URL:-https://api.devnet.solana.com}"
HUB_CHAIN_ID="${HUB_CHAIN_ID:-250}"  # Movement Bardock testnet chain ID
SVM_CHAIN_ID="${SVM_CHAIN_ID:-4}"     # Solana devnet chain ID for GMP routing

echo " Configuration:"
echo "   Deployer Address: $SOLANA_DEPLOYER_ADDR"
echo "   Network: Solana Devnet"
echo "   RPC URL: $SOLANA_RPC_URL"
echo "   Hub Chain ID: $HUB_CHAIN_ID"
echo "   SVM Chain ID: $SVM_CHAIN_ID"
echo "   Movement Intent Module: $MOVEMENT_INTENT_MODULE_ADDR"
echo ""

# Change to intent-frameworks/svm directory
cd "$PROJECT_ROOT/intent-frameworks/svm"

# Create temporary keypair file from base58 private key
# Solana CLI can read base58 private keys directly if we use solana-keygen recover
TEMP_KEYPAIR_DIR=$(mktemp -d)
DEPLOYER_KEYPAIR="$TEMP_KEYPAIR_DIR/deployer.json"

echo " Converting deployer private key to keypair file..."

# Use Node.js to convert base58 private key to JSON keypair format
# Node.js is available in nix develop ./nix shell
node -e "
const bs58 = require('bs58');
const keyBytes = bs58.decode('$SOLANA_DEPLOYER_PRIVATE_KEY');
console.log(JSON.stringify(Array.from(keyBytes)));
" > "$DEPLOYER_KEYPAIR" 2>/dev/null

# If bs58 module not available, try with inline base58 decoder
if [ ! -s "$DEPLOYER_KEYPAIR" ]; then
    node -e "
// Inline base58 decoder (no external dependencies)
const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function b58decode(str) {
    const bytes = [];
    for (let i = 0; i < str.length; i++) {
        const idx = ALPHABET.indexOf(str[i]);
        if (idx < 0) throw new Error('Invalid base58 character');
        let carry = idx;
        for (let j = 0; j < bytes.length; j++) {
            carry += bytes[j] * 58;
            bytes[j] = carry & 0xff;
            carry >>= 8;
        }
        while (carry > 0) {
            bytes.push(carry & 0xff);
            carry >>= 8;
        }
    }
    // Add leading zeros
    for (let i = 0; i < str.length && str[i] === '1'; i++) {
        bytes.push(0);
    }
    return bytes.reverse();
}
console.log(JSON.stringify(b58decode('$SOLANA_DEPLOYER_PRIVATE_KEY')));
" > "$DEPLOYER_KEYPAIR"
fi

if [ ! -s "$DEPLOYER_KEYPAIR" ]; then
    echo "❌ ERROR: Failed to convert private key"
    echo "   Node.js is required (available in nix develop ./nix shell)"
    rm -rf "$TEMP_KEYPAIR_DIR"
    exit 1
fi

echo "✅ Deployer keypair created"

# Verify the keypair address matches
DERIVED_ADDR=$(solana-keygen pubkey "$DEPLOYER_KEYPAIR" 2>&1) || {
    echo "❌ ERROR: solana-keygen pubkey failed:"
    echo "   $DERIVED_ADDR"
    echo ""
    echo "   Make sure you are running inside nix develop ./nix"
    rm -rf "$TEMP_KEYPAIR_DIR"
    exit 1
}
if [ "$DERIVED_ADDR" != "$SOLANA_DEPLOYER_ADDR" ]; then
    echo "❌ ERROR: Derived address does not match SOLANA_DEPLOYER_ADDR"
    echo "   Derived:  $DERIVED_ADDR"
    echo "   Expected: $SOLANA_DEPLOYER_ADDR"
    rm -rf "$TEMP_KEYPAIR_DIR"
    exit 1
fi
echo "✅ Address verified: $DERIVED_ADDR"
echo ""

# Check deployer balance
echo " Checking deployer balance..."
BALANCE=$(solana balance "$SOLANA_DEPLOYER_ADDR" --url "$SOLANA_RPC_URL" 2>/dev/null | awk '{print $1}' || echo "0")
echo "   Balance: $BALANCE SOL"

# Abort if balance is too low (need ~2-3 SOL for deployment)
if (( $(echo "$BALANCE < 2" | bc -l) )); then
    echo "❌ ERROR: Insufficient balance for deployment"
    echo "   Current balance: $BALANCE SOL"
    echo "   Required: at least 2 SOL (recommended 3+ SOL)"
    echo ""
    echo "   Fund this wallet: $SOLANA_DEPLOYER_ADDR"
    echo "   Get devnet SOL from: https://faucet.solana.com/"
    rm -rf "$TEMP_KEYPAIR_DIR"
    exit 1
fi
echo ""

# Build all programs
echo " Building all programs..."
./scripts/build.sh

# Program paths
ESCROW_SO="$PROJECT_ROOT/intent-frameworks/svm/target/deploy/intent_inflow_escrow.so"
ESCROW_KEYPAIR="$PROJECT_ROOT/intent-frameworks/svm/target/deploy/intent_inflow_escrow-keypair.json"
GMP_SO="$PROJECT_ROOT/intent-frameworks/svm/target/deploy/intent_gmp.so"
GMP_KEYPAIR="$PROJECT_ROOT/intent-frameworks/svm/target/deploy/intent_gmp-keypair.json"
OUTFLOW_SO="$PROJECT_ROOT/intent-frameworks/svm/target/deploy/intent_outflow_validator.so"
OUTFLOW_KEYPAIR="$PROJECT_ROOT/intent-frameworks/svm/target/deploy/intent_outflow_validator-keypair.json"

# Verify all binaries exist
for SO_FILE in "$ESCROW_SO" "$GMP_SO" "$OUTFLOW_SO"; do
    if [ ! -f "$SO_FILE" ]; then
        echo "❌ ERROR: Program binary not found at $SO_FILE"
        rm -rf "$TEMP_KEYPAIR_DIR"
        exit 1
    fi
done

# Helper: deploy a single program
deploy_program() {
    local name="$1"
    local keypair="$2"
    local so="$3"

    echo " Deploying $name..."
    solana program deploy \
        --url "$SOLANA_RPC_URL" \
        --keypair "$DEPLOYER_KEYPAIR" \
        "$so" \
        --program-id "$keypair"

    local exit_code=$?
    if [ $exit_code -ne 0 ]; then
        echo "❌ ERROR: Failed to deploy $name (exit code: $exit_code)"
        rm -rf "$TEMP_KEYPAIR_DIR"
        exit 1
    fi
    echo "✅ $name deployed"
}

# Deploy all 3 programs
echo ""
echo " Deploying programs to Solana Devnet..."
echo "======================================="
deploy_program "intent_inflow_escrow" "$ESCROW_KEYPAIR" "$ESCROW_SO"
deploy_program "intent_gmp" "$GMP_KEYPAIR" "$GMP_SO"
deploy_program "intent_outflow_validator" "$OUTFLOW_KEYPAIR" "$OUTFLOW_SO"

# Get program IDs
ESCROW_ID=$(solana-keygen pubkey "$ESCROW_KEYPAIR")
GMP_ID=$(solana-keygen pubkey "$GMP_KEYPAIR")
OUTFLOW_ID=$(solana-keygen pubkey "$OUTFLOW_KEYPAIR")

echo ""
echo " All Programs Deployed!"
echo "========================"
echo "  Escrow (SVM_PROGRAM_ID):          $ESCROW_ID"
echo "  GMP Endpoint (SVM_GMP_ID):        $GMP_ID"
echo "  Outflow Validator (SVM_OUTFLOW_ID): $OUTFLOW_ID"
echo ""

# =============================================================================
# Initialize GMP components
# =============================================================================

echo ""
echo " Initializing GMP components..."
echo "================================"
echo ""

# Check for integrated-gmp public key (used as on-chain approver)
if [ -z "$INTEGRATED_GMP_PUBLIC_KEY" ]; then
    echo "⚠️  WARNING: INTEGRATED_GMP_PUBLIC_KEY not set in .env.testnet"
    echo "   Skipping initialization - you'll need to run it manually later"
    echo ""
else
    # Convert integrated-gmp public key from base64 to base58 (Solana format)
    INTEGRATED_GMP_PUBKEY_BASE58=$(node -e "
// Inline base58 encoder
const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function b58encode(bytes) {
    const digits = [0];
    for (let i = 0; i < bytes.length; i++) {
        let carry = bytes[i];
        for (let j = 0; j < digits.length; j++) {
            carry += digits[j] << 8;
            digits[j] = carry % 58;
            carry = (carry / 58) | 0;
        }
        while (carry > 0) {
            digits.push(carry % 58);
            carry = (carry / 58) | 0;
        }
    }
    // Add leading zeros
    for (let i = 0; i < bytes.length && bytes[i] === 0; i++) {
        digits.push(0);
    }
    return digits.reverse().map(d => ALPHABET[d]).join('');
}
const base64Key = '$INTEGRATED_GMP_PUBLIC_KEY';
const keyBytes = Buffer.from(base64Key, 'base64');
console.log(b58encode(Array.from(keyBytes)));
")

    if [ -z "$INTEGRATED_GMP_PUBKEY_BASE58" ]; then
        echo "❌ ERROR: Failed to convert integrated-gmp public key to base58"
        echo "   Skipping initialization - you'll need to run it manually"
    else
        echo " Integrated-GMP public key (base58): $INTEGRATED_GMP_PUBKEY_BASE58"

        # Build CLI if needed
        CLI_BIN="$PROJECT_ROOT/intent-frameworks/svm/target/debug/intent_escrow_cli"
        if [ ! -x "$CLI_BIN" ]; then
            echo " Building CLI tool..."
            cd "$PROJECT_ROOT/intent-frameworks/svm"
            cargo build --bin intent_escrow_cli 2>/dev/null
            cd "$PROJECT_ROOT/intent-frameworks/svm"
        fi

        if [ ! -x "$CLI_BIN" ]; then
            echo "⚠️  CLI not built - skipping initialization"
            echo "   Run manually: ./intent-frameworks/svm/scripts/initialize-gmp.sh"
        else
            # Pad hub address to 64 hex characters (32 bytes)
            HUB_ADDR_CLEAN=$(echo "$MOVEMENT_INTENT_MODULE_ADDR" | sed 's/^0x//')
            HUB_ADDR_PADDED=$(printf "%064s" "$HUB_ADDR_CLEAN" | tr ' ' '0')

            echo " 1. Initializing escrow with approver..."
            "$CLI_BIN" initialize \
                --program-id "$ESCROW_ID" \
                --payer "$DEPLOYER_KEYPAIR" \
                --approver "$INTEGRATED_GMP_PUBKEY_BASE58" \
                --rpc "$SOLANA_RPC_URL" && echo "✅ Escrow initialized" || echo "⚠️  Escrow init may have failed (OK if already initialized)"

            echo " 2. Initializing GMP endpoint..."
            "$CLI_BIN" gmp-init \
                --gmp-program-id "$GMP_ID" \
                --payer "$DEPLOYER_KEYPAIR" \
                --chain-id "$SVM_CHAIN_ID" \
                --rpc "$SOLANA_RPC_URL" && echo "✅ GMP endpoint initialized" || echo "⚠️  GMP endpoint init may have failed (OK if already initialized)"

            echo " 3. Setting hub as trusted remote..."
            "$CLI_BIN" gmp-set-trusted-remote \
                --gmp-program-id "$GMP_ID" \
                --payer "$DEPLOYER_KEYPAIR" \
                --src-chain-id "$HUB_CHAIN_ID" \
                --trusted-addr "$HUB_ADDR_PADDED" \
                --rpc "$SOLANA_RPC_URL" && echo "✅ Trusted remote set" || echo "⚠️  Trusted remote may have failed"

            echo " 4. Initializing outflow validator..."
            "$CLI_BIN" outflow-init \
                --outflow-program-id "$OUTFLOW_ID" \
                --payer "$DEPLOYER_KEYPAIR" \
                --gmp-endpoint "$GMP_ID" \
                --hub-chain-id "$HUB_CHAIN_ID" \
                --hub-address "$HUB_ADDR_PADDED" \
                --rpc "$SOLANA_RPC_URL" && echo "✅ Outflow validator initialized" || echo "⚠️  Outflow validator init may have failed"

            echo " 5. Configuring escrow GMP..."
            "$CLI_BIN" escrow-set-gmp-config \
                --program-id "$ESCROW_ID" \
                --payer "$DEPLOYER_KEYPAIR" \
                --hub-chain-id "$HUB_CHAIN_ID" \
                --hub-address "$HUB_ADDR_PADDED" \
                --gmp-endpoint "$GMP_ID" \
                --rpc "$SOLANA_RPC_URL" && echo "✅ Escrow GMP config set" || echo "⚠️  Escrow GMP config may have failed"

            echo " 6. Setting GMP routing..."
            "$CLI_BIN" gmp-set-routing \
                --gmp-program-id "$GMP_ID" \
                --payer "$DEPLOYER_KEYPAIR" \
                --outflow-validator "$OUTFLOW_ID" \
                --intent-escrow "$ESCROW_ID" \
                --rpc "$SOLANA_RPC_URL" && echo "✅ GMP routing configured" || echo "⚠️  GMP routing may have failed"
        fi
    fi
fi

# Clean up temporary keypair
rm -rf "$TEMP_KEYPAIR_DIR"

echo ""
echo "========================================="
echo " Deployment Complete!"
echo "========================================="
echo ""
echo " Deployed Program IDs:"
echo "   SOLANA_PROGRAM_ID=$ESCROW_ID"
echo "   SOLANA_GMP_ID=$GMP_ID"
echo "   SOLANA_OUTFLOW_ID=$OUTFLOW_ID"
echo ""
echo " Update the following files:"
echo ""
echo "   1. .env.testnet"
echo "      SOLANA_PROGRAM_ID=$ESCROW_ID"
echo ""
echo "   2. coordinator/config/coordinator_testnet.toml"
echo "      escrow_program_id = \"$ESCROW_ID\""
echo "      (in the [connected_chain_svm] section)"
echo ""
echo "   3. integrated-gmp/config/integrated-gmp_testnet.toml"
echo "      escrow_program_id = \"$ESCROW_ID\""
echo "      (in the [connected_chain_svm] section)"
echo ""
echo "   4. solver/config/solver_testnet.toml"
echo "      escrow_program_id = \"$ESCROW_ID\""
echo "      (in the [[connected_chain]] SVM section)"
echo ""
echo "   5. Run ./testing-infra/testnet/check-testnet-preparedness.sh to verify"
echo ""
