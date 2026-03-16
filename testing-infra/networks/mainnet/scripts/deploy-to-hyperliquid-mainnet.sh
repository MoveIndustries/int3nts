#!/bin/bash

# Deploy EVM Intent Contracts to HyperEVM Mainnet (Hyperliquid)
# Deploys all 3 contracts: IntentGmp, IntentInflowEscrow, IntentOutflowValidator
# Reads keys from .env.mainnet and deploys/configures all contracts

set -e

# Get the script directory and project root
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$( cd "$SCRIPT_DIR/../../../.." && pwd )"
export PROJECT_ROOT

# Source utilities from testing-infra (for CI testing infrastructure)
source "$PROJECT_ROOT/testing-infra/ci-e2e/util.sh" 2>/dev/null || true
source "$SCRIPT_DIR/../lib/env-utils.sh"

ASSETS_CONFIG_FILE="$SCRIPT_DIR/../config/mainnet-assets.toml"

echo " Deploying EVM Contracts to HyperEVM Mainnet"
echo "================================================="
echo "   IntentGmp, IntentInflowEscrow, IntentOutflowValidator"
echo ""

# Load .env.mainnet
load_env_file "$SCRIPT_DIR/../.env.mainnet"

# Check required variables
if [ -z "$HYPERLIQUID_DEPLOYER_PRIVATE_KEY" ]; then
    echo "❌ ERROR: HYPERLIQUID_DEPLOYER_PRIVATE_KEY not set in .env.mainnet"
    exit 1
fi

if [ -z "$INTEGRATED_GMP_EVM_PUBKEY_HASH" ]; then
    echo "❌ ERROR: INTEGRATED_GMP_EVM_PUBKEY_HASH not set in .env.mainnet"
    echo "   Run: nix develop ./nix -c bash -c 'cd integrated-gmp && INTEGRATED_GMP_CONFIG_PATH=config/integrated-gmp_mainnet.toml cargo run --bin get_approver_eth_address'"
    exit 1
fi

# Load assets configuration
if [ ! -f "$ASSETS_CONFIG_FILE" ]; then
    echo "❌ ERROR: mainnet-assets.toml not found at $ASSETS_CONFIG_FILE"
    exit 1
fi

if [ -z "$HYPERLIQUID_RPC_URL" ]; then
    echo "❌ ERROR: HYPERLIQUID_RPC_URL not set in .env.mainnet"
    exit 1
fi

echo " Configuration:"
echo "   Deployer Address: $HYPERLIQUID_DEPLOYER_ADDR"
echo "   Integrated-GMP EVM Pubkey Hash: $INTEGRATED_GMP_EVM_PUBKEY_HASH"
echo "   Network: HyperEVM Mainnet (chain ID 999)"
echo "   RPC URL: $HYPERLIQUID_RPC_URL"
echo ""

# Check if Hardhat config exists
if [ ! -f "$PROJECT_ROOT/intent-frameworks/evm/hardhat.config.js" ]; then
    echo "❌ ERROR: hardhat.config.js not found"
    echo "   Make sure intent-frameworks/evm directory exists"
    exit 1
fi

# Change to intent-frameworks/evm directory
cd "$PROJECT_ROOT/intent-frameworks/evm"

# Check for Movement hub module address
if [ -z "$MOVEMENT_INTENT_MODULE_ADDR" ]; then
    echo "❌ ERROR: MOVEMENT_INTENT_MODULE_ADDR not set in .env.mainnet"
    echo "   This should be set to the deployed MVM intent module address"
    echo "   Example: MOVEMENT_INTENT_MODULE_ADDR=0x1b7c806f87339383d29b94fa481a2ea2ef50ac518f66cff419453c9a1154c8da"
    exit 1
fi

# Export environment variables for Hardhat
export DEPLOYER_PRIVATE_KEY="$HYPERLIQUID_DEPLOYER_PRIVATE_KEY"
export APPROVER_ADDR="$INTEGRATED_GMP_EVM_PUBKEY_HASH"
export MOVEMENT_INTENT_MODULE_ADDR
export HUB_CHAIN_ID=$(get_chain_id "movement_mainnet" "$ASSETS_CONFIG_FILE")
export HYPERLIQUID_RPC_URL
# Relay address for integrated-gmp (derived from ECDSA key, different from deployer)
export RELAY_ADDRESS="${INTEGRATED_GMP_EVM_PUBKEY_HASH}"

echo " Environment configured for Hardhat"
echo ""

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo " Installing dependencies..."
    npm install
    echo "✅ Dependencies installed"
    echo ""
fi

# Verify RPC is responsive before deploying
echo " Checking RPC endpoint: $HYPERLIQUID_RPC_URL"
RPC_RESPONSE=$(curl -s -m 10 -X POST "$HYPERLIQUID_RPC_URL" \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","method":"eth_getBalance","params":["'"$HYPERLIQUID_DEPLOYER_ADDR"'","latest"],"id":1}' 2>&1)

if ! echo "$RPC_RESPONSE" | grep -q '"result"'; then
    echo "   RPC endpoint not responding or returned error:"
    echo "   $RPC_RESPONSE"
    exit 1
fi
echo "   RPC OK"
echo ""

# Deploy contracts (run from within nix develop ./nix shell)
echo " Deploying all 3 contracts..."
echo "   (Run this script from within 'nix develop ./nix' shell)"
echo ""
set +e
DEPLOY_OUTPUT=$(npx hardhat run scripts/deploy.js --network hyperliquidMainnet 2>&1)
DEPLOY_EXIT_CODE=$?
set -e

# Show deployment output
echo "$DEPLOY_OUTPUT"

if [ $DEPLOY_EXIT_CODE -ne 0 ]; then
    echo "❌ Deployment failed with exit code $DEPLOY_EXIT_CODE"
    exit 1
fi

echo ""
echo " Deployment Complete!"
echo "======================"
echo ""

# Extract contract addresses from deployment output
GMP_ENDPOINT_ADDR=$(echo "$DEPLOY_OUTPUT" | grep "IntentGmp:" | tail -1 | awk '{print $NF}' | tr -d '\n' || echo "")
ESCROW_ADDR=$(echo "$DEPLOY_OUTPUT" | grep "IntentInflowEscrow:" | tail -1 | awk '{print $NF}' | tr -d '\n' || echo "")
OUTFLOW_ADDR=$(echo "$DEPLOY_OUTPUT" | grep "IntentOutflowValidator:" | tail -1 | awk '{print $NF}' | tr -d '\n' || echo "")

if [ -n "$GMP_ENDPOINT_ADDR" ] && [ -n "$ESCROW_ADDR" ]; then
    echo " Add these to .env.mainnet:"
    echo ""
    echo "   HYPERLIQUID_GMP_ENDPOINT_ADDR=$GMP_ENDPOINT_ADDR"
    echo "   HYPERLIQUID_INFLOW_ESCROW_ADDR=$ESCROW_ADDR"
    if [ -n "$OUTFLOW_ADDR" ]; then
        echo "   HYPERLIQUID_OUTFLOW_VALIDATOR_ADDR=$OUTFLOW_ADDR"
    fi
    echo ""

    echo " Deployed contract addresses:"
    echo "   IntentGmp (GMP Endpoint):       $GMP_ENDPOINT_ADDR"
    echo "   IntentInflowEscrow:             $ESCROW_ADDR"
    echo "   IntentOutflowValidator:         $OUTFLOW_ADDR"
    echo ""
    echo " Update the following files:"
    echo ""
    echo "   1. coordinator/config/coordinator_mainnet.toml"
    echo "      escrow_contract_addr = \"$ESCROW_ADDR\""
    echo "      (in the [[connected_chain_evm]] HyperEVM section)"
    echo ""
    echo "   2. integrated-gmp/config/integrated-gmp_mainnet.toml"
    echo "      escrow_contract_addr = \"$ESCROW_ADDR\""
    echo "      gmp_endpoint_addr = \"$GMP_ENDPOINT_ADDR\""
    echo "      (in the [[connected_chain_evm]] HyperEVM section)"
    echo ""
    echo "   3. solver/config/solver_mainnet.toml"
    echo "      escrow_contract_addr = \"$ESCROW_ADDR\""
    echo "      (in the [[connected_chain]] EVM HyperEVM section)"
    echo ""
    echo "   4. frontend/.env.local"
    echo "      NEXT_PUBLIC_HYPEREVM_ESCROW_CONTRACT_ADDRESS=$ESCROW_ADDR"
    echo ""
    echo "   5. Run ./testing-infra/networks/mainnet/check-mainnet-preparedness.sh to verify"

    # Save deployment log
    LOG_DIR="$SCRIPT_DIR/../logs"
    mkdir -p "$LOG_DIR"
    LOG_FILE="$LOG_DIR/deploy-hyperliquid-mainnet-$(date +%Y%m%d-%H%M%S).log"
    {
        echo "HyperEVM Mainnet Deployment — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
        echo ""
        echo "Deployer:                  $HYPERLIQUID_DEPLOYER_ADDR"
        echo "Relay:                     $INTEGRATED_GMP_EVM_PUBKEY_HASH"
        echo "Hub chain ID:              $HUB_CHAIN_ID"
        echo "Hub module addr:           $MOVEMENT_INTENT_MODULE_ADDR"
        echo ""
        echo "IntentGmp:                 $GMP_ENDPOINT_ADDR"
        echo "IntentInflowEscrow:        $ESCROW_ADDR"
        echo "IntentOutflowValidator:    $OUTFLOW_ADDR"
    } > "$LOG_FILE"
    echo ""
    echo " Deployment log saved to: $LOG_FILE"
else
    echo "️  Could not extract contract addresses from output"
    echo "   Please copy them manually from the deployment output above"
    echo ""
    echo " Update the following files:"
    echo "   - coordinator/config/coordinator_mainnet.toml (escrow_contract_addr in [[connected_chain_evm]] HyperEVM section)"
    echo "   - integrated-gmp/config/integrated-gmp_mainnet.toml (escrow_contract_addr + gmp_endpoint_addr in [[connected_chain_evm]] HyperEVM section)"
    echo "   - solver/config/solver_mainnet.toml (escrow_contract_addr in [[connected_chain]] EVM HyperEVM section)"
    echo "   - frontend/.env.local (NEXT_PUBLIC_HYPEREVM_ESCROW_CONTRACT_ADDRESS)"
fi
echo ""
