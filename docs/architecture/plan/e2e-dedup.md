# E2E Test Script Deduplication Plan

## Problem

6 E2E test scripts (~197 lines each, ~1,180 total) share ~95% identical structure:

- `e2e-tests-mvm/run-tests-inflow.sh`
- `e2e-tests-mvm/run-tests-outflow.sh`
- `e2e-tests-evm/run-tests-inflow.sh`
- `e2e-tests-evm/run-tests-outflow.sh`
- `e2e-tests-svm/run-tests-inflow.sh`
- `e2e-tests-svm/run-tests-outflow.sh`

## Approach

> **CRITICAL: ONE function per commit. Replace ONE function's inline code across all 6 scripts, then STOP and commit. Do NOT proceed to the next function until the commit is done. Never batch multiple function replacements.**

`e2e-common.sh` already exists with all shared functions.

## Known Differences

| Area | MVM | EVM | SVM |
|------|-----|-----|-----|
| Logging | `echo` (no `setup_logging`) | `log_and_echo` | `log_and_echo` |
| Cleanup pre | chain cleanup only | chain cleanup only | chain cleanup + `stop-chain.sh` |
| Deploy script | `deploy-contracts.sh` (plural) | `deploy-contract.sh` (singular) | `deploy-contract.sh` (singular) |
| Build skip | common + `sign_intent` | common + `get_approver_eth_address` + `sign_intent` | common + SVM programs + `intent_escrow_cli` |
| Build full | coordinator + igmp + solver/sign_intent | coordinator + igmp/get_approver_eth_address + solver/sign_intent | SVM programs + coordinator + igmp + solver + intent_escrow_cli |
| Util sources | `util.sh`, `util_mvm.sh` | `util.sh`, `util_mvm.sh`, `util_evm.sh` | `util.sh`, `util_mvm.sh`, `util_svm.sh` |
| MVM-specific | `balance-check.sh` pre-solver-start assertion | none | none |

## Swapout Order

Each step = edit all 6 scripts, verify no syntax errors, commit.

### Step 1: `e2e_init` (LOW risk)

Replace: flag parsing + util sourcing + `setup_project_root` + `setup_logging` + `cd` + banner.

Lines replaced per script: ~21. Normalizes MVM to use `log_and_echo` (improvement: MVM gets file logging).

After this step, all scripts start with:
```bash
#!/bin/bash
set -eo pipefail
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
source "$SCRIPT_DIR/../e2e-common.sh"
e2e_init "evm" "outflow" "$@"
```

### Step 2: `e2e_cleanup_pre` (LOW risk)

Replace: cleanup block (~3 lines). SVM's extra `stop-chain.sh || true` handled inside function.

### Step 3: `e2e_generate_keys` (TRIVIAL)

Replace: key generation block (~4 lines). Identical across all 6.

### Step 4: `e2e_setup_chains` (LOW risk)

Replace: chain setup + deploy block (~7 lines). MVM plural vs singular deploy handled inside function.

### Step 5: `e2e_start_services` (LOW risk)

Replace: coordinator + igmp + solver start + verification (~10 lines). Same structure, different chain dirs.

### Step 6: `e2e_cleanup_post` (TRIVIAL)

Replace: final cleanup + success message (~5 lines).

### Step 7: `e2e_build` (MEDIUM risk)

Replace: build block (~30 lines). Most chain-specific variation. Left later because it's the most complex and benefits from all other swaps being validated first.

### Step 8: `e2e_wait_for_fulfillment` (MEDIUM risk)

Replace: intent loading + wait + error handling (~12 lines). Test-critical path, swap last for safety.

### Step 9: `e2e_liquidity_rejection_start` (LOW risk, partial)

Replace: only the log preamble (~6 lines). The draft-building logic stays chain-specific in each script.

## Post-Swap

After all 9 steps, each script should be ~40-60 lines: init + chain-specific test logic (balance checks, intent submission, escrow, draft building for rejection test).

## Not Extracted

These remain in individual scripts (too chain-specific):

- Balance check calls with specific expected values
- Intent submission scripts (`inflow-submit-hub-intent.sh`, `outflow-submit-hub-intent.sh`, etc.)
- Escrow submission and wait (`inflow-submit-escrow.sh`, `wait-for-escrow-release.sh`)
- MVM's pre-solver-start balance assertion (`assert_usdxyz_balance`)
- Liquidity rejection draft building (different address resolution per chain)
- `assert_solver_rejects_draft` calls (same API but different draft data)
