# E2E Test Speedups

## Progress

| Stage | Description | Status |
|-------|-------------|--------|
| 1 | Parallel cargo builds + docker pull overlap | done |
| 2 | Parallel chain startup + flock-based parallel setup/deploys | done |
| 3 | Reduce stabilization sleeps | done |
| 4 | Parallel service startup (coordinator + integrated-gmp) | done |
| 5 | Docker image pre-pull overlap with builds | done (in Stage 1) |

## Goal

Reduce E2E test wall time (~18 min) by eliminating unnecessary sequential operations and fixed sleeps. Each stage is independently valuable and safe to land on its own.

## CI Timings

Before: `chore/e2e-speedups` plan-only commit 8a651cc (run 23354564110)
Stage 1: `chore/e2e-speedups` parallel builds commit 7bd16b0 (run 23355126386)
Stage 2: `chore/e2e-speedups` parallel chains + flock commit df0d661 (run 23412505420)
Stage 3: `chore/e2e-speedups` reduce stabilization sleeps commit d867084 (run 23413527863)
Stage 4: `chore/e2e-speedups` parallel service startup commit 9644bfc (run 23414013397)

| Job | Before | Stage 1 | Stage 2 | Stage 3 | Stage 4 |
|-----|--------|---------|---------|---------|---------|
| mvm-chain-inflow | 15m 29s | 15m 19s | 13m 41s | 13m 27s | 12m 06s |
| mvm-chain-outflow | 15m 13s | 14m 09s | 13m 56s | 13m 45s | 13m 05s |
| rust-integration | 15m 33s | 15m 27s | 15m 37s | 15m 13s | 15m 15s |
| evm-chain-outflow | 17m 10s | 15m 01s | 16m 02s | 15m 35s | 16m 10s |
| evm-chain-inflow | 18m 49s | 18m 22s | 18m 22s | 17m 49s | 17m 39s |
| svm-chain-outflow | 25m 37s | 24m 04s | 20m 55s | 19m 05s | 20m 46s |
| svm-chain-inflow | 26m 22s | 25m 05s | 22m 29s | 22m 01s | 23m 16s |

Stage 1 saved ~1-2 min on most jobs. Slowest job (svm-chain-inflow) down from 26m 22s to 25m 05s.

Stage 2 saved ~2-4 min on most jobs. MVM jobs improved ~1.5 min, SVM jobs improved ~3-4 min. Slowest job (svm-chain-inflow) down from 25m 05s to 22m 29s. Total improvement from baseline: 26m 22s → 22m 29s (~15% reduction). The flock-based parallel setup/deploys and parallel chain startup together provide meaningful gains across all chains.

Stage 3 saved ~15-110s per job. Coordinator sleep 30 replaced with adaptive /events poll (~4s), integrated-gmp sleep 10 reduced to 5s. Slowest job (svm-chain-inflow) down from 22m 29s to 22m 01s. Total improvement from baseline: 26m 22s → 22m 01s (~16.5% reduction).

Stage 4 showed mixed results due to CI variance. MVM jobs improved ~1 min (parallel startup overlap visible). SVM/EVM jobs showed slight regression likely due to runner variance. The parallel startup is structurally correct and saves ~10-15s of sequential startup time. Overall from baseline: 26m 22s → ~22-23m (~12-16% reduction across runs).

## Stage protocol (every stage)

1. Run the relevant test command (given per stage)
2. Run `/review-me` and wait for review output
3. Ask the user: "Ready to commit?"
4. Only if the user says yes: run `/commit`
5. Do not proceed to the next stage without user confirmation

---

## Stage 1 — Single `cargo build` invocation

**Why**: Today `_e2e_build_full` runs 3 sequential `cargo build` invocations (coordinator, integrated-gmp, solver). Each crate has its own `target/` directory (no shared workspace), so they can build in parallel using background processes. Same for `build_common_bins_if_missing` in `--no-build` mode.

**Scope**: `testing-infra/ci-e2e/util.sh` (`_e2e_build_full`, `build_common_bins_if_missing`), `testing-infra/ci-e2e/e2e-common.sh` (`e2e_build`)

**Files to change**:

- `testing-infra/ci-e2e/util.sh`
  - `_e2e_build_full()`: Run the 3 crate builds (coordinator, integrated-gmp, solver) in parallel using `&` + `wait`. Each still uses `pushd/cargo build/popd` but runs in a subshell in background. Chain-specific extra bins (sign_intent, get_approver_eth_address) are part of the integrated-gmp or solver build so they stay together. SVM intent_escrow_cli is a separate workspace — runs as a 4th parallel job.
  - `build_common_bins_if_missing()`: Same pattern — check which bins are missing, then run needed builds in parallel.

- `testing-infra/ci-e2e/e2e-common.sh`
  - `e2e_build()`: Move `docker pull` to run in background (`&`) before the cargo build, then `wait` for it after cargo completes. This overlaps docker pull with compilation.

**Test command**:
```bash
nix develop ./nix -c bash -c "./testing-infra/ci-e2e/e2e-tests-evm/run-tests-inflow.sh --no-build"
```
(Use `--no-build` for quick validation that the script still works; full build tested manually once.)

**End of stage**: Run tests → /review-me → ask user → if yes, /commit.

---

## Stage 2 — Parallel chain startup + flock-based parallel setup/deploys

**Why**: `e2e_setup_chains` starts hub chain, then connected instance 2, then instance 3 sequentially. Each waits independently for its chain to become ready (up to 150s for MVM, 180s for EVM). These chains have zero startup dependencies on each other. Account setup and contract deployments also run sequentially but can overlap if config file access is serialized.

**Scope**: `testing-infra/ci-e2e/e2e-common.sh`, `testing-infra/ci-e2e/util_mvm.sh`, deploy scripts

**Problem**: All Aptos CLI commands share `~/.aptos/config.yaml`. Parallel writes corrupt the file (confirmed by CI run 23357830574: `jq: parse error`, `Could not extract address for profile`).

**Solution**: `flock` on a shared lock file (`$PROJECT_ROOT/.tmp/aptos-config.lock`). Exclusive locks for writes (`aptos init`, `aptos config delete-profile`), shared locks for reads (`aptos move run/publish`, `aptos config show-profiles`). Multiple readers proceed in parallel; writers block everything.

**Files changed**:

- `testing-infra/ci-e2e/util_mvm.sh`
  - `APTOS_CONFIG_LOCK` variable for lock file path
  - `aptos_read_locked` helper: wraps any aptos CLI call with a shared read lock
  - `init_aptos_profile`: exclusive flock around `aptos init`
  - `get_profile_address`: shared flock around `aptos config show-profiles`
  - `cleanup_aptos_profile`: exclusive flock around `aptos config delete-profile`
  - All `aptos move run` calls in utility functions replaced with `aptos_read_locked`
- `testing-infra/ci-e2e/e2e-common.sh`
  - `e2e_setup_chains()`: The sequencing becomes:
    1. **Parallel**: Start hub chain, connected instance 2, connected instance 3 (`setup-chain.sh` x3 via `&` + `wait`)
    2. **Parallel**: Generate shared solver keys, then account setup for hub, chain 2, chain 3 in parallel (flock serializes config writes)
    3. **Sequential**: Hub contract deployment (`deploy-contracts.sh` — produces `HUB_MODULE_ADDR`)
    4. **Parallel**: Connected contract deployments for chain 2 and 3 (flock serializes config access)
- `testing-infra/ci-e2e/chain-hub/deploy-contracts.sh` — bare `aptos move` calls replaced with `aptos_read_locked`
- `testing-infra/ci-e2e/chain-connected-mvm/deploy-contracts.sh` — same
- `testing-infra/ci-e2e/chain-connected-evm/deploy-contracts.sh` — same
- `testing-infra/ci-e2e/chain-connected-svm/deploy-contracts.sh` — same

**Test command**:
```bash
nix develop ./nix -c bash -c "./testing-infra/ci-e2e/e2e-tests-evm/run-tests-inflow.sh --no-build"
```

**End of stage**: Run tests → /review-me → ask user → if yes, /commit.

---

## Stage 3 — Reduce stabilization sleeps

**Why**: After coordinator becomes healthy, there's a hard `sleep 30` ("wait for coordinator to poll and collect events"). After integrated-gmp initializes, there's a hard `sleep 10`. These 40s total are not polling for anything — just sleeping.

**Scope**: `testing-infra/ci-e2e/util.sh` (`start_coordinator`, `start_integrated_gmp`)

**Files to change**:

- `testing-infra/ci-e2e/util.sh`
  - `start_coordinator()`: Replace `sleep 30` with an adaptive poll loop that checks `/events` endpoint for the coordinator having collected at least one polling cycle. Poll every 2s, timeout at 30s. Specifically: check that `/events` returns a response with a non-null `data` field (coordinator has completed at least one poll).
  - `start_integrated_gmp()`: Replace `sleep 10` with an adaptive poll loop that checks for a second log message indicating the first polling cycle completed (e.g., "Polling for messages" or "Poll cycle complete" — need to verify actual log output). Poll every 2s, timeout at 10s. If no such log message exists, reduce sleep to 5s as a conservative improvement.

**Test command**:
```bash
nix develop ./nix -c bash -c "./testing-infra/ci-e2e/e2e-tests-evm/run-tests-inflow.sh --no-build"
```

**End of stage**: Run tests → /review-me → ask user → if yes, /commit.

---

## Stage 4 — Parallel service startup (coordinator + integrated-gmp)

**Why**: `e2e_start_services` starts coordinator, waits for it to be fully ready, then starts integrated-gmp, waits for it to be fully ready, then starts solver. Coordinator and integrated-gmp have no startup dependency on each other — they both read chain state independently. Solver depends on coordinator being up (it queries coordinator), but can start in parallel with integrated-gmp's stabilization phase.

**Scope**: `testing-infra/ci-e2e/e2e-common.sh` (`e2e_start_services`), possibly `testing-infra/ci-e2e/e2e-tests-evm/start-coordinator.sh`, `start-integrated-gmp.sh`

**Files to change**:

- `testing-infra/ci-e2e/e2e-common.sh`
  - `e2e_start_services()`: Restructure to:
    1. Start coordinator in background (via a wrapper that calls `start-coordinator.sh` and blocks until ready)
    2. Start integrated-gmp in background (same pattern)
    3. `wait` for both
    4. Start solver (depends on coordinator being up)
    5. Verify all services

  This requires the start scripts to be safe to run concurrently (they already are — they use separate log files, PIDs, and ports).

**Test command**:
```bash
nix develop ./nix -c bash -c "./testing-infra/ci-e2e/e2e-tests-evm/run-tests-inflow.sh --no-build"
```

**End of stage**: Run tests → /review-me → ask user → if yes, /commit.

---

## Stage 5 — Docker image pre-pull overlap with builds

**Why**: `e2e_build()` calls `docker pull $APTOS_DOCKER_IMAGE` after cargo builds complete. This can run in parallel with the cargo build since they're independent.

**Scope**: `testing-infra/ci-e2e/e2e-common.sh` (`e2e_build`)

**Files to change**:

- `testing-infra/ci-e2e/e2e-common.sh`
  - `e2e_build()`: Start `docker pull` in background before calling `_e2e_build_full`/`_e2e_build_skip`, then `wait` after cargo builds finish. Already addressed in Stage 1 — if Stage 1 was accepted, this is a no-op. If Stage 1 was modified to not include this, do it here.

**Test command**:
```bash
nix develop ./nix -c bash -c "./testing-infra/ci-e2e/e2e-tests-evm/run-tests-inflow.sh --no-build"
```

**End of stage**: Run tests → /review-me → ask user → if yes, /commit.

---

## What's NOT included (and why)

- **Parallel multi-instance test execution**: Instance 2 and 3 inflow tests share hub balances (instance 3's expected pre-balance depends on instance 2's post-balance). These are intentionally sequential.
- **Shorter polling intervals**: Most poll loops already use 1-3s intervals. Sub-second polling risks races and adds complexity for marginal gain.
- **CI build caching**: Requires CI pipeline changes (GitHub Actions cache), not E2E script changes.
