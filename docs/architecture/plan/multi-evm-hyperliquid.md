# Multi-EVM Support + HyperEVM Mainnet Integration

## Progress

**Update this table as each stage is completed before moving on.**

| Stage | Status |
|---|---|
| Stage 1 — Coordinator: multi-chain config | ✅ done |
| Stage 2 — Integrated-GMP: multi-chain relay config | — |
| Stage 3 — Solver: multi-chain client dispatch | — |
| Stage 4 — Directory restructure + HyperEVM mainnet deploy scripts | — |
| Stage 5 — Frontend + SDK: add Hyperliquid chain and tokens | — |
| Stage 6 — Mainnet config: wire up HyperEVM (post-deployment) | blocked on Stage 4 |

## Goal

Extend the system to support multiple simultaneous connected chains of each type (EVM, MVM, SVM), then add HyperEVM mainnet (chain ID 999) alongside the existing Base Sepolia testnet.

The target chains for the mainnet testing environment in `testing-infra/` are: Base mainnet, HyperEVM mainnet, and Movement mainnet. HyperEVM is mainnet-only — testnet tokens (HYPE) are not easily obtainable, so it cannot be tested against the Hyperliquid testnet.

## Background

### Current state

| Component | MVM | EVM | SVM | Issue |
|---|---|---|---|---|
| Coordinator | `Option` — single | `Option` — single | `Option` — single | All three must become `Vec` |
| Integrated-GMP | `Option` — single | `Option` — single | `Option` — single | All three must become `Vec`; relay routing must iterate per chain |
| Solver | `Vec<ConnectedChainConfig>` — already multi (all types) | same | same | Single `evm_client` field; dispatch logic must be fixed |
| Frontend / SDK | `Record<string, ChainConfig>` — already multi | same | same | Just add new entries |

### HyperEVM mainnet

- Chain type: HyperEVM (EVM-compatible)
- Chain ID: `999`
- RPC: `https://api.hyperliquid.xyz/evm`
- Native token: HYPE (18 decimals)
- Explorer: `https://explorer.hyperliquid.xyz`
- Reuses existing `IntentInflowEscrow`, `IntentOutflowValidator`, `IntentGmp` contracts — no new Solidity needed.

---

## Stage protocol (MUST follow for every stage)

After completing each stage:

1. Run the relevant tests (commands given per stage).
2. Run `/review-me` (the Claude command) and wait for review output.
3. **Ask the user: "Ready to commit?"**
4. Only if the user says yes: run `/commit` (the Claude command).
5. Do not proceed to the next stage without user confirmation.

---

## Stage 1 — Coordinator: multi-chain config

**Scope:** `coordinator/` only.

### Files to change

**`coordinator/src/config/mod.rs`**

All three connected-chain fields become `Vec`:
- `connected_chain_mvm: Option<ChainConfig>` → `Vec<ChainConfig>`
- `connected_chain_evm: Option<EvmChainConfig>` → `Vec<EvmChainConfig>`
- `connected_chain_svm: Option<SvmChainConfig>` → `Vec<SvmChainConfig>`

For each field:
- `validate()`: replace single-option checks with loops; check every chain against hub and every other chain for duplicate IDs.
- `chain_type_for_id()`: iterate the Vec instead of checking a single Option.
- `default()`: `None` → `vec![]`.

**`coordinator/config/coordinator_testnet.toml`** and **`coordinator/config/coordinator.template.toml`**

TOML syntax: `[connected_chain_*]` (single table) → `[[connected_chain_*]]` (array of tables) for all three chain types.

### Test command

```bash
RUST_LOG=off nix develop ./nix -c bash -c "cd coordinator && cargo test --quiet"
```

### End of stage

Run tests → `/review-me` → ask user → if yes, `/commit`.

---

## Stage 2 — Integrated-GMP: multi-chain relay config

**Scope:** `integrated-gmp/` only.

### Files to change

**`integrated-gmp/src/config/mod.rs`**

Same symmetric treatment as Stage 1 — all three connected-chain fields become `Vec`:
- `connected_chain_mvm: Option<_>` → `Vec<_>`
- `connected_chain_evm: Option<EvmChainConfig>` → `Vec<EvmChainConfig>`
- `connected_chain_svm: Option<_>` → `Vec<_>`

For each: `validate()` loops, `default()` uses `vec![]`, TOML migrates to `[[...]]`.

**`integrated-gmp/src/integrated_gmp_relay.rs`**

`NativeGmpRelayConfig` currently has single EVM fields:
```rust
pub evm_rpc_url: Option<String>,
pub evm_gmp_endpoint_addr: Option<String>,
pub evm_chain_id: Option<u32>,
pub evm_relay_address: Option<String>,
```

Replace with a struct and Vec:
```rust
pub struct EvmRelayChainConfig {
    pub rpc_url: String,
    pub gmp_endpoint_addr: Option<String>,
    pub chain_id: u32,
    pub relay_address: String,
}

// in NativeGmpRelayConfig:
pub evm_chains: Vec<EvmRelayChainConfig>,
```

`from_config()`: iterate `config.connected_chain_evm` to build the Vec.

`RelayState`: `evm_last_block: u64` → `evm_last_blocks: HashMap<u32, u64>` (keyed by chain ID).

Relay delivery logic: when routing a message by `dst_chain_id`, iterate `evm_chains` to find the matching entry instead of checking a single optional chain ID.

EVM polling loop: iterate all entries in `evm_chains` and poll each independently.

**`integrated-gmp/config/integrated-gmp_testnet.toml`**

Same TOML syntax migration as coordinator:
```toml
# Before
[connected_chain_evm]
...

# After
[[connected_chain_evm]]
...
```

**`integrated-gmp/config/integrated-gmp.template.toml`** (if it exists) — same migration.

### Test command

```bash
RUST_LOG=off nix develop ./nix -c bash -c "cd integrated-gmp && cargo test --quiet"
```

### End of stage

Run tests → `/review-me` → ask user → if yes, `/commit`.

---

## Stage 3 — Solver: multi-chain client dispatch

**Scope:** `solver/` only.

The solver config already supports `Vec<ConnectedChainConfig>` for all chain types, so no config struct change is needed. The problem is `OutflowService` holds single-chain client fields (e.g. `evm_client: Option<ConnectedEvmClient>`). The same fix applies to any equivalent MVM or SVM single-client fields.

### Files to change

**`solver/src/service/outflow.rs`**

Replace single client with a map keyed by chain ID:

```rust
// Before
evm_client: Option<ConnectedEvmClient>,

// After
evm_clients: HashMap<u64, ConnectedEvmClient>,
```

`OutflowService::new()`:
- Iterate all EVM configs from `config.connected_chain.iter()`.
- Instantiate `ConnectedEvmClient` for each and insert into the map.

`get_chain_id("evm")`: this method assumed a single EVM chain — it is used by `get_target_chain_for_intent()`. Replace it: iterate `config.connected_chain` and check all EVM entries for a chain ID match directly in `get_target_chain_for_intent`.

`execute_evm_gmp_fulfillment()`: currently uses `self.evm_client.as_ref()`. Change to look up the client by `intent.draft_data.desired_chain_id` in `evm_clients`.

**`solver/src/config.rs`**

`get_evm_config()` returns the first EVM config and is used only for the single-client initialization above. After the above refactor it is no longer needed — remove it, or rename to `get_evm_configs()` returning an iterator if anything else needs it.

**`solver/config/solver_testnet.toml`**

No syntax change needed (already `[[connected_chain]]` array). Just note that a second EVM entry will be added in Stage 6 once Hyperliquid contract addresses are known.

### Test command

```bash
RUST_LOG=off nix develop ./nix -c bash -c "cd solver && cargo test --quiet"
```

### End of stage

Run tests → `/review-me` → ask user → if yes, `/commit`.

---

## Stage 4 — Directory restructure + HyperEVM mainnet deploy scripts

**Scope:** `intent-frameworks/evm/` and `testing-infra/`.

This stage does two things: restructures `testing-infra/` to separate testnet and mainnet environments under a shared `networks/` parent, then adds HyperEVM mainnet as the first mainnet chain.

### Cross-stage note

After Stages 1–2, the coordinator and integrated-gmp configs use `[[connected_chain_*]]` (array of tables) for all chain types. The summary output in `deploy.sh` still references the old `[connected_chain_evm]` key. Those references must be updated in this stage.

### Part A — Directory restructure

**Rename `testing-infra/testnet/` → `testing-infra/networks/testnet/`** (git mv)

No content changes — this is a pure rename. All existing scripts, config, and logs move with it.

**Move shared run scripts to `testing-infra/networks/`**

These three scripts currently live in `testing-infra/testnet/` but are not testnet-specific — they just load config files. Move them one level up and require a `--network testnet|mainnet` argument so the same script works for both environments:

- `testing-infra/networks/run-coordinator-local.sh`
- `testing-infra/networks/run-integrated-gmp-local.sh`
- `testing-infra/networks/run-solver-local.sh`

Each script requires `--network` to be explicitly provided — no default:
```bash
if [ -z "$NETWORK" ]; then
  echo "Usage: $0 --network testnet|mainnet" >&2
  exit 1
fi
CONFIG_DIR="$(dirname "$0")/$NETWORK"
```

**Create `testing-infra/networks/mainnet/`** with the same skeleton as `testnet/`:

```text
networks/mainnet/
  deploy.sh
  configure.sh
  scripts/
  config/
    mainnet-assets.toml
  logs/        (gitignored)
  env.mainnet.example
```

---

### Part B — HyperEVM mainnet scripts

**`intent-frameworks/evm/hardhat.config.ts`**

Add `hyperliquidMainnet` network entry:

```typescript
hyperliquidMainnet: {
  url: process.env.HYPERLIQUID_RPC_URL ?? "https://api.hyperliquid.xyz/evm",
  chainId: 999,
  accounts: process.env.DEPLOYER_PRIVATE_KEY ? [process.env.DEPLOYER_PRIVATE_KEY] : [],
},
```

No new contracts needed — existing `IntentInflowEscrow`, `IntentOutflowValidator`, `IntentGmp` deploy unchanged.

---

**`testing-infra/networks/mainnet/config/mainnet-assets.toml`**

```toml
[base]
chain_id = 8453
rpc_url = "https://mainnet.base.org"
native_token = "ETH"
native_token_decimals = 18

[hyperliquid]
chain_id = 999
rpc_url = "https://api.hyperliquid.xyz/evm"
native_token = "HYPE"
native_token_decimals = 18

[movement]
chain_id = 250
# rpc_url set via env
native_token = "MOVE"
native_token_decimals = 8
```

---

**`testing-infra/networks/mainnet/env.mainnet.example`**

Mirrors `env.testnet.example` for mainnet chains (Base mainnet, Movement mainnet, HyperEVM):
```bash
# =============================================================================
# BASE MAINNET (Connected EVM Chain)
# =============================================================================
BASE_DEPLOYER_PRIVATE_KEY=
BASE_DEPLOYER_ADDR=
SOLVER_EVM_PRIVATE_KEY_BASE=
BASE_GMP_ENDPOINT_ADDR=
BASE_INFLOW_ESCROW_ADDR=
BASE_OUTFLOW_VALIDATOR_ADDR=
BASE_CHAIN_ID=8453

# =============================================================================
# HYPERLIQUID MAINNET (Connected EVM Chain)
# =============================================================================
HYPERLIQUID_DEPLOYER_PRIVATE_KEY=
HYPERLIQUID_DEPLOYER_ADDR=
SOLVER_EVM_PRIVATE_KEY_HYPERLIQUID=
HYPERLIQUID_GMP_ENDPOINT_ADDR=
HYPERLIQUID_INFLOW_ESCROW_ADDR=
HYPERLIQUID_OUTFLOW_VALIDATOR_ADDR=
HYPERLIQUID_CHAIN_ID=999

# =============================================================================
# MOVEMENT MAINNET (Hub Chain)
# =============================================================================
MOVEMENT_PRIVATE_KEY=
MOVEMENT_MODULE_ADDR=
```

---

**`testing-infra/networks/mainnet/scripts/deploy-to-hyperliquid-mainnet.sh`** (new file)

Mirrors `networks/testnet/scripts/deploy-to-base-testnet.sh` with:

- `HYPERLIQUID_DEPLOYER_PRIVATE_KEY` instead of `BASE_DEPLOYER_PRIVATE_KEY`
- RPC URL: `https://api.hyperliquid.xyz/evm` (no API key needed)
- Hardhat network: `hyperliquidMainnet`
- Output env vars: `HYPERLIQUID_GMP_ENDPOINT_ADDR`, `HYPERLIQUID_INFLOW_ESCROW_ADDR`, `HYPERLIQUID_OUTFLOW_VALIDATOR_ADDR`
- Deployment log saved to `logs/deploy-hyperliquid-mainnet-<timestamp>.log`

---

**`testing-infra/networks/mainnet/scripts/configure-hyperliquid-mainnet.sh`** (new file)

Mirrors `networks/testnet/scripts/configure-base-testnet.sh` with:

- Reads `HYPERLIQUID_GMP_ENDPOINT_ADDR`, `HYPERLIQUID_INFLOW_ESCROW_ADDR`, `HYPERLIQUID_OUTFLOW_VALIDATOR_ADDR`
- Runs `configure-gmp.js --network hyperliquidMainnet` and `configure-hub-config.js --network hyperliquidMainnet`

---

**`testing-infra/networks/mainnet/scripts/configure-movement-mainnet.sh`** (new file)

Mirrors `networks/testnet/scripts/configure-movement-testnet.sh` for mainnet, including a HyperEVM block:
```bash
# --- HyperEVM Mainnet ---
HYPERLIQUID_CHAIN_ID=$(get_chain_id "hyperliquid")
require_var "HYPERLIQUID_GMP_ENDPOINT_ADDR"

ADDR_PADDED=$(pad_address_32 "$HYPERLIQUID_GMP_ENDPOINT_ADDR")
movement move run \
  --profile "$TEMP_PROFILE" \
  --function-id "${MODULE_ADDR}::intent_gmp::set_remote_gmp_endpoint_addr" \
  --args "u32:$HYPERLIQUID_CHAIN_ID" "hex:${ADDR_PADDED}" \
  --assume-yes

movement move run \
  --profile "$TEMP_PROFILE" \
  --function-id "${MODULE_ADDR}::intent_gmp_hub::set_remote_gmp_endpoint_addr" \
  --args "u32:$HYPERLIQUID_CHAIN_ID" "hex:${ADDR_PADDED}" \
  --assume-yes
```

---

**`testing-infra/networks/mainnet/deploy.sh`**

Same structure as `testnet/deploy.sh` but for mainnet chains (Base mainnet, Movement mainnet, HyperEVM mainnet). Also fix `[connected_chain_evm]` → `[[connected_chain_evm]]` in summary output.

---

**`testing-infra/networks/mainnet/configure.sh`**

Same structure as `testnet/configure.sh` but calls mainnet configure scripts.

### Test command

```bash
nix develop ./nix -c bash -c "cd intent-frameworks/evm && npm install && npm test"
```

### End of stage

Run tests → `/review-me` → ask user → if yes, `/commit`.

---

## Stage 5 — Frontend + SDK: add Hyperliquid testnet chain and tokens

**Scope:** `packages/sdk/` and `frontend/` only.

### Files to change

**`packages/sdk/src/config.ts`**

Add to `CHAIN_CONFIGS`:
```typescript
'hyperliquid': {
  id: 'hyperliquid',
  chainId: 999,
  rpcUrl: 'https://api.hyperliquid.xyz/evm',
  name: 'HyperEVM',
  chainType: 'evm',
  escrowContractAddress: undefined,          // fill after Stage 6 deployment
  outflowValidatorAddress: undefined,        // fill after Stage 6 deployment
},
```

**`frontend/src/config/chains.ts`**

Add `'hyperliquid'` entry matching the SDK pattern. Use env vars for contract addresses:
```typescript
'hyperliquid': {
  ...
  escrowContractAddress: process.env.NEXT_PUBLIC_HYPERLIQUID_ESCROW_ADDR,
  outflowValidatorAddress: process.env.NEXT_PUBLIC_HYPERLIQUID_OUTFLOW_ADDR,
},
```

**`frontend/src/config/tokens.ts`**

Add tokens for HyperEVM mainnet (HYPE native + USDC if available):
```typescript
// HyperEVM Mainnet
{ chainId: 'hyperliquid', symbol: 'HYPE', decimals: 18, address: '0x0000...' },
```

**`frontend/src/lib/wagmi-config.ts`**

Add HyperEVM mainnet as a viem custom chain and register it:
```typescript
import { defineChain } from 'viem'

const hyperEvm = defineChain({
  id: 999,
  name: 'HyperEVM',
  nativeCurrency: { name: 'HYPE', symbol: 'HYPE', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://api.hyperliquid.xyz/evm'] },
  },
})
```
Add to `chains` array and `transports` map in `createConfig`.

### Test commands

```bash
nix develop ./nix -c bash -c "cd packages/sdk && npm install && npm test"
nix develop ./nix -c bash -c "cd frontend && npm install --legacy-peer-deps && npm test"
```

### End of stage

Run tests → `/review-me` → ask user → if yes, `/commit`.

---

## Stage 6 — Mainnet config: wire up HyperEVM (post-deployment)

**Blocked on:** operational contract deployment from Stage 4.

Once `IntentGmp`, `IntentInflowEscrow`, and `IntentOutflowValidator` are deployed to HyperEVM mainnet and addresses are known:

### Files to change

**`coordinator/config/coordinator_testnet.toml`**

Add second `[[connected_chain_evm]]` block for HyperEVM:
```toml
[[connected_chain_evm]]
name = "HyperEVM"
chain_id = 999
rpc_url = "https://api.hyperliquid.xyz/evm"
escrow_contract_addr = "<deployed-address>"
outflow_validator_contract_addr = "<deployed-address>"
event_block_range = 1000
```

**`integrated-gmp/config/integrated-gmp_testnet.toml`**

Add second `[[connected_chain_evm]]` block:
```toml
[[connected_chain_evm]]
name = "HyperEVM"
chain_id = 999
rpc_url = "https://api.hyperliquid.xyz/evm"
escrow_contract_addr = "<deployed-address>"
gmp_endpoint_addr = "<deployed-address>"
approver_evm_pubkey_hash = "<same-as-base-sepolia-or-new-key>"
outflow_validator_addr = "<deployed-address>"
```

**`solver/config/solver_testnet.toml`**

Add second EVM connected chain block + token pairs:
```toml
[[connected_chain]]
type = "evm"
name = "HyperEVM"
chain_id = 999
rpc_url = "https://api.hyperliquid.xyz/evm"
escrow_contract_addr = "<deployed-address>"
private_key_env = "SOLVER_EVM_PRIVATE_KEY_HYPERLIQUID"
network_name = "hyperliquidMainnet"
outflow_validator_addr = "<deployed-address>"
gmp_endpoint_addr = "<deployed-address>"

# Token pairs (fill in actual token addresses once known)
[[acceptance.tokenpair]]
source_chain_id = 250
source_token = "..."
target_chain_id = 999
target_token = "..."
ratio = 1.0
fee_bps = 50
move_rate = 0.01
```

**`packages/sdk/src/config.ts`** and **`frontend/src/config/chains.ts`**

Fill in the `escrowContractAddress` and `outflowValidatorAddress` values added as `undefined` in Stage 5.

### End of stage

Run all tests → `/review-me` → ask user → if yes, `/commit`.

---

## On-chain registration (operational, Stage 6 prerequisite)

The hub contract is chain-agnostic — `desired_chain_id` is free-form at intent creation time — but routing is **permissioned by registration**. When the hub sends `IntentRequirements` it calls `get_remote_gmp_endpoint_addr(chain_id)` and aborts if the chain is not registered.

Two admin transactions are required after contracts are deployed (Stage 4):

### 1. Register HyperEVM on the MVM hub

The admin who owns the MVM hub contract must call:
```move
intent_gmp_hub::set_remote_gmp_endpoint_addr(
    admin_signer,
    999,                          // HyperEVM mainnet chain ID
    <hyperliquid-IntentGmp-addr>  // deployed IntentGmp.sol address (bytes32)
)
```

### 2. Register MVM on the new EVM IntentGmp

On the newly deployed `IntentGmp.sol` on HyperEVM mainnet, the contract owner must call:
```solidity
setRemoteGmpEndpointAddr(
    250,                        // Movement mainnet chain ID
    <mvm-gmp-hub-addr-bytes32>  // MVM hub GMP endpoint address
)
```

Until both transactions are confirmed, any intent targeting chain ID 999 will abort at the hub.

---

## Open questions (resolve before Stage 6)

1. **Which tokens are available on HyperEVM mainnet?** HYPE is native. Is USDC deployed? Need contract address.
2. **Approver key for integrated-gmp:** Use the same ECDSA key as Base Sepolia or generate a new one per chain?
3. **Solver private key:** Separate `SOLVER_EVM_PRIVATE_KEY_HYPERLIQUID` env var, or reuse the Base Sepolia key?
4. **HyperEVM mainnet RPC rate limits:** Does `https://api.hyperliquid.xyz/evm` require an API key? What block range is safe for `event_block_range`?
