#!/bin/bash

# Deploy Move Intent Framework to Movement Mainnet
#
# This script generates a FRESH address for each deployment to avoid
# backward-incompatible module update errors. Funds are transferred from
# the deployer account in .env.mainnet to the new module address.
#
# The new module address must be updated in coordinator and solver config
# files after deployment.
#
# REQUIRES: Movement CLI (not aptos CLI)
# Install for mainnet (Move 2 support):
#   ARM64: curl -LO https://github.com/movementlabsxyz/homebrew-movement-cli/releases/download/bypass-homebrew/movement-move2-testnet-macos-arm64.tar.gz && mkdir -p temp_extract && tar -xzf movement-move2-testnet-macos-arm64.tar.gz -C temp_extract && chmod +x temp_extract/movement && sudo mv temp_extract/movement /usr/local/bin/movement && rm -rf temp_extract
#   x86_64: curl -LO https://github.com/movementlabsxyz/homebrew-movement-cli/releases/download/bypass-homebrew/movement-move2-testnet-macos-x86_64.tar.gz && mkdir -p temp_extract && tar -xzf movement-move2-testnet-macos-x86_64.tar.gz -C temp_extract && chmod +x temp_extract/movement && sudo mv temp_extract/movement /usr/local/bin/movement && rm -rf temp_extract
#
# Reference: https://docs.movementnetwork.xyz/devs/movementcli

set -e

# Get the script directory and project root
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$( cd "$SCRIPT_DIR/../../../.." && pwd )"
export PROJECT_ROOT

MOVEMENT_RPC_URL="https://mainnet.movementnetwork.xyz/v1"

echo " Deploying Move Intent Framework to Movement Mainnet"
echo "=============================================================="
echo ""

# Check for movement CLI
if ! command -v movement &> /dev/null; then
    echo "❌ ERROR: movement CLI not found"
    echo ""
    echo "   Movement mainnet requires the Movement CLI (not aptos CLI)."
    echo "   Install the Move 2 mainnet CLI:"
    echo ""
    echo "   # For Mac ARM64 (M-series):"
    echo "   curl -LO https://github.com/movementlabsxyz/homebrew-movement-cli/releases/download/bypass-homebrew/movement-move2-testnet-macos-arm64.tar.gz && mkdir -p temp_extract && tar -xzf movement-move2-testnet-macos-arm64.tar.gz -C temp_extract && chmod +x temp_extract/movement && sudo mv temp_extract/movement /usr/local/bin/movement && rm -rf temp_extract"
    echo ""
    echo "   # For Mac Intel (x86_64):"
    echo "   curl -LO https://github.com/movementlabsxyz/homebrew-movement-cli/releases/download/bypass-homebrew/movement-move2-testnet-macos-x86_64.tar.gz && mkdir -p temp_extract && tar -xzf movement-move2-testnet-macos-x86_64.tar.gz -C temp_extract && chmod +x temp_extract/movement && sudo mv temp_extract/movement /usr/local/bin/movement && rm -rf temp_extract"
    echo ""
    echo "   Reference: https://docs.movementnetwork.xyz/devs/movementcli"
    exit 1
fi

echo "✅ Movement CLI found: $(movement --version)"
echo ""

# Load .env.mainnet for the funding account
MAINNET_KEYS_FILE="$SCRIPT_DIR/../.env.mainnet"

if [ ! -f "$MAINNET_KEYS_FILE" ]; then
    echo "❌ ERROR: .env.mainnet not found at $MAINNET_KEYS_FILE"
    echo "   Create it from env.mainnet.example in this directory"
    exit 1
fi

if [ "${DEPLOY_ENV_SOURCED:-}" != "1" ]; then
    source "$MAINNET_KEYS_FILE"
fi

# Check required variables for funding account
if [ -z "$MOVEMENT_DEPLOYER_PRIVATE_KEY" ]; then
    echo "❌ ERROR: MOVEMENT_DEPLOYER_PRIVATE_KEY not set in .env.mainnet"
    exit 1
fi

if [ -z "$MOVEMENT_DEPLOYER_ADDR" ]; then
    echo "❌ ERROR: MOVEMENT_DEPLOYER_ADDR not set in .env.mainnet"
    exit 1
fi

FUNDER_ADDR="${MOVEMENT_DEPLOYER_ADDR#0x}"
FUNDER_ADDR_FULL="0x${FUNDER_ADDR}"

# Setup funding account profile
echo " Step 1: Setting up funding account..."
movement init --profile movement-funder \
  --network custom \
  --rest-url "$MOVEMENT_RPC_URL" \
  --private-key "$MOVEMENT_DEPLOYER_PRIVATE_KEY" \
  --skip-faucet \
  --assume-yes 2>/dev/null

echo "   Funder address: $FUNDER_ADDR_FULL"
echo ""

# Generate a fresh key pair for module deployment
echo " Step 2: Generating fresh module address..."

# Create temp directory for key generation
TEMP_DIR=$(mktemp -d)
KEY_FILE="$TEMP_DIR/deploy_key"

# Generate a new Ed25519 key pair
movement key generate --key-type ed25519 --output-file "$KEY_FILE" --assume-yes 2>/dev/null

# Read the private key from the generated file
DEPLOY_PRIVATE_KEY=$(cat "${KEY_FILE}.key" 2>/dev/null || cat "$KEY_FILE" 2>/dev/null)

# Initialize a temporary profile to get the address
TEMP_PROFILE="movement-deploy-temp-$$"
movement init --profile "$TEMP_PROFILE" \
  --network custom \
  --rest-url "$MOVEMENT_RPC_URL" \
  --private-key "$DEPLOY_PRIVATE_KEY" \
  --skip-faucet \
  --assume-yes 2>/dev/null

# Extract the address from the profile
DEPLOY_ADDR=$(movement config show-profiles --profile "$TEMP_PROFILE" 2>/dev/null | jq -r ".Result.\"$TEMP_PROFILE\".account // empty" || echo "")

if [ -z "$DEPLOY_ADDR" ]; then
    echo "❌ ERROR: Failed to extract address from generated key"
    rm -rf "$TEMP_DIR"
    exit 1
fi

DEPLOY_ADDR_FULL="0x${DEPLOY_ADDR}"
echo "   Module address: $DEPLOY_ADDR_FULL"
echo ""

# Fund the new address — transfer from deployer
echo " Step 3: Funding module address..."

FUND_AMOUNT=100000000  # 1 MOVE in octas

echo "   Transferring from deployer account..."
movement move run \
  --profile movement-funder \
  --function-id "0x1::aptos_account::transfer" \
  --args "address:$DEPLOY_ADDR_FULL" "u64:$FUND_AMOUNT" \
  --assume-yes
echo "   ✅ Transferred $FUND_AMOUNT octas (1 MOVE) from deployer"

# Wait for transaction to propagate
sleep 3

# Verify balance with retry option
while true; do
    echo "   Verifying balance..."
    BALANCE=$(curl -s "$MOVEMENT_RPC_URL/accounts/$DEPLOY_ADDR_FULL/resources" 2>/dev/null | jq -r '.[] | select(.type == "0x1::coin::CoinStore<0x1::aptos_coin::AptosCoin>") | .data.coin.value // "0"' || echo "0")
    if [ -z "$BALANCE" ]; then BALANCE="0"; fi
    echo "   Module address balance: $BALANCE octas"

    if [ "$BALANCE" != "0" ] && [ -n "$BALANCE" ]; then
        echo "   ✅ Module address funded"
        break
    fi

    echo ""
    echo "️  Balance is still 0."
    echo "   [r] Retry balance check"
    echo "   [y] Continue anyway (deployment may fail)"
    echo "   [n] Cancel deployment"
    read -p "   Choice (r/y/n): " -n 1 -r
    echo

    if [[ $REPLY =~ ^[Rr]$ ]]; then
        echo "   Waiting 3 seconds before retry..."
        sleep 3
        continue
    elif [[ $REPLY =~ ^[Yy]$ ]]; then
        echo "   Continuing with 0 balance..."
        break
    else
        echo "   ❌ Deployment cancelled"
        rm -rf "$TEMP_DIR"
        exit 1
    fi
done
echo ""

echo " Configuration:"
echo "   Funder Address: $FUNDER_ADDR_FULL"
echo "   Module Address: $DEPLOY_ADDR_FULL"
echo "   Network: Movement Mainnet"
echo "   RPC URL: $MOVEMENT_RPC_URL"
echo ""

# Deploy Move modules (intent-gmp first, then intent-hub)
echo " Step 4: Deploying intent-gmp package..."
cd "$PROJECT_ROOT/intent-frameworks/mvm/intent-gmp"

movement move publish \
  --profile "$TEMP_PROFILE" \
  --named-addresses mvmt_intent="$DEPLOY_ADDR_FULL" \
  --assume-yes \
  --included-artifacts none \
  --max-gas 500000 \
  --gas-unit-price 100

echo "✅ intent-gmp deployed"
echo ""

# Wait for intent-gmp to be fully indexed before deploying intent-hub
echo " Waiting for intent-gmp to be indexed..."
sleep 10

echo " Step 5: Deploying intent-hub package..."
cd "$PROJECT_ROOT/intent-frameworks/mvm/intent-hub"

# Try with minimal artifacts first to avoid chunked publish LINKER_ERROR
# If this fails due to size, fall back to chunked publish
movement move publish \
  --profile "$TEMP_PROFILE" \
  --named-addresses mvmt_intent="$DEPLOY_ADDR_FULL" \
  --assume-yes \
  --included-artifacts none \
  --override-size-check \
  --max-gas 500000 \
  --gas-unit-price 100

echo "✅ intent-hub deployed"
echo ""

# Verify deployment by calling a view function
echo " Step 6: Verifying deployment..."

movement move view \
  --profile "$TEMP_PROFILE" \
  --function-id "${DEPLOY_ADDR_FULL}::solver_registry::is_registered" \
  --args "address:$DEPLOY_ADDR_FULL" && {
    echo "   ✅ View function works - module deployed correctly with #[view] attribute"
  } || {
    echo "   ️  Warning: View function verification failed"
    echo "   This may indicate the module wasn't deployed correctly"
  }

echo ""

# Initialize modules
echo " Step 7: Initializing fa_intent (chain_id=250)..."

movement move run \
  --profile "$TEMP_PROFILE" \
  --function-id "${DEPLOY_ADDR_FULL}::fa_intent::initialize" \
  --args u64:250 \
  --assume-yes 2>/dev/null && {
    echo "   ✅ fa_intent chain info initialized"
  } || {
    echo "   ️  fa_intent may already be initialized (this is OK)"
  }

echo ""

echo " Step 8: Initializing solver_registry..."

movement move run \
  --profile "$TEMP_PROFILE" \
  --function-id "${DEPLOY_ADDR_FULL}::solver_registry::initialize" \
  --assume-yes 2>/dev/null && {
    echo "   ✅ Solver registry initialized"
  } || {
    echo "   ️  Solver registry may already be initialized (this is OK)"
  }

echo ""

echo " Step 9: Initializing intent_registry..."

movement move run \
  --profile "$TEMP_PROFILE" \
  --function-id "${DEPLOY_ADDR_FULL}::intent_registry::initialize" \
  --assume-yes 2>/dev/null && {
    echo "   ✅ Intent registry initialized"
  } || {
    echo "   ️  Intent registry may already be initialized (this is OK)"
  }

echo ""

echo " Step 10: Initializing intent_gmp..."

movement move run \
  --profile "$TEMP_PROFILE" \
  --function-id "${DEPLOY_ADDR_FULL}::intent_gmp::initialize" \
  --assume-yes 2>/dev/null && {
    echo "   ✅ intent_gmp initialized"
  } || {
    echo "   ️  intent_gmp may already be initialized (this is OK)"
  }

echo ""

echo " Step 11: Initializing intent_gmp_hub..."

movement move run \
  --profile "$TEMP_PROFILE" \
  --function-id "${DEPLOY_ADDR_FULL}::intent_gmp_hub::initialize" \
  --assume-yes 2>/dev/null && {
    echo "   ✅ intent_gmp_hub initialized"
  } || {
    echo "   ️  intent_gmp_hub may already be initialized (this is OK)"
  }

echo ""

echo " Step 12: Initializing gmp_intent_state..."

movement move run \
  --profile "$TEMP_PROFILE" \
  --function-id "${DEPLOY_ADDR_FULL}::gmp_intent_state::initialize" \
  --assume-yes 2>/dev/null && {
    echo "   ✅ gmp_intent_state initialized"
  } || {
    echo "   ️  gmp_intent_state may already be initialized (this is OK)"
  }

echo ""

echo " Step 13: Initializing gmp_sender..."

movement move run \
  --profile "$TEMP_PROFILE" \
  --function-id "${DEPLOY_ADDR_FULL}::gmp_sender::initialize" \
  --assume-yes 2>/dev/null && {
    echo "   ✅ gmp_sender initialized"
  } || {
    echo "   ️  gmp_sender may already be initialized (this is OK)"
  }

echo ""

# ============================================================================
# Step 14: Output module private key and address for .env.mainnet
# ============================================================================
# The configure step needs admin access to the module (admin = module address).

echo " Step 14: Add these to .env.mainnet:"
echo ""
echo "   MOVEMENT_MODULE_PRIVATE_KEY=$DEPLOY_PRIVATE_KEY"
echo "   MOVEMENT_INTENT_MODULE_ADDR=$DEPLOY_ADDR_FULL"

echo ""

# Save deployment log
LOG_DIR="$SCRIPT_DIR/../logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/deploy-movement-mainnet-$(date +%Y%m%d-%H%M%S).log"
{
    echo "Movement Mainnet Deployment — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo ""
    echo "Funder:                    $FUNDER_ADDR_FULL"
    echo "Module address:            $DEPLOY_ADDR_FULL"
    echo "Module private key:        $DEPLOY_PRIVATE_KEY"
    echo "Network:                   Movement Mainnet"
    echo "RPC URL:                   $MOVEMENT_RPC_URL"
} > "$LOG_FILE"
echo " Deployment log saved to: $LOG_FILE"

# Cleanup temp profile (but keep the key info for reference)
echo " Cleaning up..."
rm -rf "$TEMP_DIR"

echo ""
echo " Deployment Complete!"
echo "======================"
echo ""
echo " NEW Module Address:     $DEPLOY_ADDR_FULL"
echo " NEW Module Private Key: $DEPLOY_PRIVATE_KEY"
echo ""
echo "️  IMPORTANT: Update these files with the new module address and private key:"
echo ""
echo "   1. coordinator/config/coordinator_mainnet.toml:"
echo "      intent_module_addr = \"$DEPLOY_ADDR_FULL\""
echo "      (in the [hub_chain] section)"
echo ""
echo "   2. integrated-gmp/config/integrated-gmp_mainnet.toml:"
echo "      intent_module_addr = \"$DEPLOY_ADDR_FULL\""
echo "      (in the [hub_chain] section)"
echo ""
echo "   3. solver/config/solver_mainnet.toml:"
echo "      module_addr = \"$DEPLOY_ADDR_FULL\""
echo "      (in the [hub_chain] section)"
echo ""
echo "   4. frontend/.env.local:"
echo "      NEXT_PUBLIC_INTENT_CONTRACT_ADDRESS=$DEPLOY_ADDR_FULL"
echo ""
echo " Next steps:"
echo "   1. Update the config files above with the new module address"
echo "   2. Deploy Base and HyperEVM contracts"
echo "   3. Run configure-movement-mainnet.sh to set remote GMP endpoints"
echo "   (Or use deploy.sh to run the full pipeline)"
echo ""
