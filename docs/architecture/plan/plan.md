# Multi-EVM E2E Testing: Parameterized Chain Instances

## Goal

Run two independent EVM chain instances in E2E tests to validate multi-EVM support end-to-end. No directory duplication — parameterize existing `chain-connected-evm/` scripts by instance number.

## Instance layout

| Property | Instance 2 | Instance 3 |
|---|---|---|
| Port | 8545 | 8546 |
| Chain ID | 2 | 3 |
| Hardhat network | `localhost-e2e-2` | `localhost-e2e-3` |
| Env var suffix | `_EVM2` | `_EVM3` |
| PID file | `hardhat-node-2.pid` | `hardhat-node-3.pid` |

---

## Progress

**Update this table as each stage is completed before moving on.**

| Stage | Status |
|---|---|
| Stage 1 — Parameterize chain-connected-evm/ scripts | ✅ done |
| Stage 2 — Hardhat config: add localhost-e2e-2 network | ✅ done |
| Stage 3 — e2e-common.sh: setup both instances | ✅ done |
| Stage 4 — Service startup: configure for both instances | ✅ done |
| Stage 5 — Parameterize test scripts | ✅ done |
| Stage 6 — Test runners: run tests against both chains | ✅ done |
| Stage 7 — Cleanup: stop both instances | ✅ done |

---

## Stage protocol (MUST follow for every stage)

After completing each stage:

1. Run the relevant tests (commands given per stage).
2. Run `/review-me` (the Claude command) and wait for review output.
3. **Ask the user: "Ready to commit?"**
4. Only if the user says yes: run `/commit` (the Claude command).
5. Do not proceed to the next stage without user confirmation.

---

## Stage 1 — Parameterize chain-connected-evm/ scripts

**Scope:** `testing-infra/ci-e2e/chain-connected-evm/` only.

Every script in this directory accepts an instance number argument (`2` or `3`). The instance number determines all instance-specific values (instance 1 = hub).

### Mapping function

Add to `utils.sh` (or a new shared helper) a function that derives all values from the instance number:

```bash
# Usage: evm_instance_vars <instance_number>
# Sets: EVM_PORT, EVM_CHAIN_ID, EVM_NETWORK, EVM_SUFFIX, EVM_PID_FILE
evm_instance_vars() {
  local n="$1"
  case "$n" in
    2) EVM_PORT=8545; EVM_CHAIN_ID=2; EVM_NETWORK=localhost-e2e-2; EVM_SUFFIX=_EVM2 ;;
    3) EVM_PORT=8546; EVM_CHAIN_ID=3; EVM_NETWORK=localhost-e2e-3; EVM_SUFFIX=_EVM3 ;;
    *) echo "Unknown EVM instance: $n" >&2; exit 1 ;;
  esac
  EVM_RPC_URL="http://127.0.0.1:$EVM_PORT"
  EVM_PID_FILE="$PROJECT_ROOT/.tmp/hardhat-node-${n}.pid"
}
```

### Files to change

**`utils.sh`** — Add `evm_instance_vars` function. Existing helpers that reference port 8545, chain ID 2, or `hardhat-node.pid` must use the derived variables instead.

**`setup-chain.sh`** — Accept instance number as `$1`. Call `evm_instance_vars "$1"`. Start Hardhat on `$EVM_PORT` with `--chain-id $EVM_CHAIN_ID`. Write PID to `$EVM_PID_FILE`.

**`stop-chain.sh`** — Accept instance number as `$1`. Read PID from `$EVM_PID_FILE`. Kill process and release `$EVM_PORT`.

**`cleanup.sh`** — Accept instance number as `$1`. Call `stop-chain.sh "$1"`. Remove instance-specific logs, PID file, and state.

**`deploy-contracts.sh`** — Accept instance number as `$1`. Deploy to `$EVM_NETWORK` (Hardhat network name). Save contract addresses and account info to `.tmp/chain-info-evm${n}.env` (instance-specific file) using suffixed variable names:

```bash
# .tmp/chain-info-evm2.env
GMP_ENDPOINT_ADDR_EVM2=0x...
ESCROW_GMP_ADDR_EVM2=0x...
OUTFLOW_VALIDATOR_ADDR_EVM2=0x...
USD_EVM_ADDR_EVM2=0x...
RELAY_ETH_ADDRESS_EVM2=0x...
```

**`configure-coordinator.sh`** — Accept instance number as `$1`. Append a `[[connected_chain_evm]]` block to the coordinator config using `$EVM_CHAIN_ID`, `$EVM_RPC_URL`, and the suffixed contract addresses.

**`configure-integrated-gmp.sh`** — Accept instance number as `$1`. Append a `[[connected_chain_evm]]` block to the integrated-gmp config using instance-specific values.

### Test command

```bash
# Smoke test: start instance 2, deploy, stop
nix develop ./nix -c bash -c "cd testing-infra/ci-e2e && source chain-connected-evm/utils.sh && chain-connected-evm/setup-chain.sh 2 && chain-connected-evm/deploy-contracts.sh 2 && chain-connected-evm/stop-chain.sh 2"
```

### End of stage

Run tests → `/review-me` → ask user → if yes, `/commit`.

---

## Stage 2 — Hardhat config: add localhost-e2e-2 network

**Scope:** `intent-frameworks/evm/hardhat.config.js` only.

### Files to change

**`intent-frameworks/evm/hardhat.config.js`**

Add `localhost-e2e-3` network. Support configurable chain ID via env var so the same config works for both instances:

```javascript
"localhost-e2e-2": {
  url: "http://127.0.0.1:8545",
  chainId: 2,
  accounts: { mnemonic: "test test test test test test test test test test test junk" },
},
"localhost-e2e-3": {
  url: "http://127.0.0.1:8546",
  chainId: 3,
  accounts: { mnemonic: "test test test test test test test test test test test junk" },
},
```

### Test command

```bash
nix develop ./nix -c bash -c "cd intent-frameworks/evm && npm install && npm test"
```

### End of stage

Run tests → `/review-me` → ask user → if yes, `/commit`.

---

## Stage 3 — e2e-common.sh: setup both instances

**Scope:** `testing-infra/ci-e2e/e2e-common.sh` and `testing-infra/ci-e2e/e2e-tests-evm/`.

### Files to change

**`e2e-common.sh`**

`e2e_setup_chains` for EVM currently calls chain-connected-evm scripts once. Change to call them twice:

```bash
# In e2e_setup_chains (EVM path):
chain-connected-evm/setup-chain.sh 2
chain-connected-evm/deploy-contracts.sh 2
chain-connected-evm/setup-chain.sh 3
chain-connected-evm/deploy-contracts.sh 3
```

### End of stage

Run tests → `/review-me` → ask user → if yes, `/commit`.

---

## Stage 4 — Service startup: configure for both instances

**Scope:** `testing-infra/ci-e2e/e2e-tests-evm/` service startup scripts.

### Files to change

**`start-coordinator.sh`**

Call `configure-coordinator.sh` twice (with `2` and `3`) so the coordinator config has two `[[connected_chain_evm]]` blocks.

**`start-integrated-gmp.sh`**

Call `configure-integrated-gmp.sh` twice (with `2` and `3`) so the integrated-gmp config has two `[[connected_chain_evm]]` blocks.

**`start-solver.sh`**

Generate solver config with two `[[connected_chain]]` entries (type = "evm"), one per instance. Each entry uses the instance-specific RPC URL, chain ID, contract addresses, and a distinct `private_key_env` (`SOLVER_EVM_PRIVATE_KEY_2`, `SOLVER_EVM_PRIVATE_KEY_3`). Token pairs must reference both chain IDs.

### Test command

```bash
nix develop ./nix -c bash -c "./testing-infra/ci-e2e/e2e-tests-evm/run-tests-inflow.sh"
```

### End of stage

Run tests → `/review-me` → ask user → if yes, `/commit`.

---

## Stage 5 — Parameterize test scripts

**Scope:** `testing-infra/ci-e2e/e2e-tests-evm/` test scripts.

Test scripts (`inflow-submit-escrow.sh`, `outflow-submit-hub-intent.sh`, `balance-check.sh`, `wait-for-escrow-release.sh`, etc.) currently assume a single EVM chain. Parameterize them to accept the target chain via env vars.

### Env var interface

Each test script reads these env vars to determine which EVM instance to target:

- `EVM_CHAIN_ID` — chain ID (2 or 3)
- `EVM_NETWORK` — Hardhat network name (`localhost-e2e-2` or `localhost-e2e-3`)
- `EVM_SUFFIX` — env var suffix (`_EVM2` or `_EVM3`)

The suffix is used to look up instance-specific contract addresses and account info (e.g., `ESCROW_GMP_ADDR${EVM_SUFFIX}`).

### Files to change

Every test script in `e2e-tests-evm/` that references EVM chain ID, RPC URL, contract addresses, or Hardhat network name. Replace hardcoded values with the env var interface above.

### End of stage

Run tests → `/review-me` → ask user → if yes, `/commit`.

---

## Stage 6 — Test runners: run tests against both chains

**Scope:** `testing-infra/ci-e2e/e2e-tests-evm/run-tests-inflow.sh` and `run-tests-outflow.sh`.

### Files to change

**`run-tests-inflow.sh`** and **`run-tests-outflow.sh`**

After setup (chains + services), run the test sequence twice — once per EVM instance:

```bash
for n in 2 3; do
  evm_instance_vars "$n"
  export EVM_CHAIN_ID EVM_NETWORK EVM_SUFFIX
  # run inflow/outflow test steps...
done
```

### Test command

```bash
nix develop ./nix -c bash -c "./testing-infra/ci-e2e/e2e-tests-evm/run-tests-inflow.sh"
nix develop ./nix -c bash -c "./testing-infra/ci-e2e/e2e-tests-evm/run-tests-outflow.sh"
```

### End of stage

Run tests → `/review-me` → ask user → if yes, `/commit`.

---

## Stage 7 — Cleanup: stop both instances

**Scope:** `testing-infra/ci-e2e/chain-connected-evm/cleanup.sh` and `e2e-common.sh`.

### Files to change

**`e2e-common.sh`** (cleanup function)

Call cleanup for both instances:

```bash
chain-connected-evm/stop-chain.sh 2
chain-connected-evm/stop-chain.sh 3
```

**`chain-connected-evm/cleanup.sh`**

When called without an argument, clean up both instances. When called with an instance number, clean up only that instance.

### Test command

Full E2E run (validates setup + tests + cleanup):

```bash
nix develop ./nix -c bash -c "./testing-infra/ci-e2e/e2e-tests-evm/run-tests-inflow.sh"
```

### End of stage

Run tests → `/review-me` → ask user → if yes, `/commit`.

---

## Current state reference

### Existing chain-connected-evm/ scripts

| Script | Current behavior |
|---|---|
| `utils.sh` | EVM utilities (hardhat commands, account extraction) |
| `setup-chain.sh` | Starts Hardhat on port 8545, chain ID 2, PID → `.tmp/hardhat-node.pid` |
| `stop-chain.sh` | Stops Hardhat, cleans port 8545 |
| `cleanup.sh` | Calls stop-chain, deletes logs/state |
| `deploy-contracts.sh` | Deploys IntentGmp, IntentInflowEscrow, IntentOutflowValidator, USDcon; saves to `.tmp/chain-info.env` |
| `configure-coordinator.sh` | Appends `[[connected_chain_evm]]` to coordinator config |
| `configure-integrated-gmp.sh` | Appends `[[connected_chain_evm]]` to integrated-gmp config |

### Hardcoded values to parameterize

- Port: `8545`
- Chain ID: `2`
- Hardhat network: `localhost-e2e-2`
- PID file: `.tmp/hardhat-node.pid`
- Chain info file: `.tmp/chain-info.env` (EVM-specific vars)
- Env var names: `GMP_ENDPOINT_ADDR`, `ESCROW_GMP_ADDR`, `OUTFLOW_VALIDATOR_ADDR`, `USD_EVM_ADDR`, `SOLVER_EVM_PRIVATE_KEY`, `SOLVER_EVM_ADDR`

### Service ports (unchanged)

| Service | Port |
|---|---|
| Coordinator | 3333 |
| Integrated-GMP | (no HTTP port) |
| Hardhat instance 2 | 8545 |
| Hardhat instance 3 | 8546 |
