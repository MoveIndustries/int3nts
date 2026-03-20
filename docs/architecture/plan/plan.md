# E2E Test Speedups

## Progress

| Stage | Description | Status |
|-------|-------------|--------|
| 1 | Parallel cargo builds + docker pull overlap | done |
| 2 | Parallel chain startup | in progress |
| 3 | Reduce stabilization sleeps | todo |
| 4 | Parallel service startup (coordinator + integrated-gmp) | todo |
| 5 | Docker image pre-pull overlap with builds | todo |

## Goal

Reduce E2E test wall time (~18 min) by eliminating unnecessary sequential operations and fixed sleeps. Each stage is independently valuable and safe to land on its own.

## CI Timings

Before: `chore/e2e-speedups` plan-only commit 8a651cc (run 23354564110)
Stage 1: `chore/e2e-speedups` parallel builds commit 7bd16b0 (run 23355126386)

| Job | Before | Stage 1 |
|-----|--------|---------|
| mvm-chain-inflow | 15m 29s | 15m 19s |
| mvm-chain-outflow | 15m 13s | 14m 09s |
| rust-integration | 15m 33s | 15m 27s |
| evm-chain-outflow | 17m 10s | 15m 01s |
| evm-chain-inflow | 18m 49s | 18m 22s |
| svm-chain-outflow | 25m 37s | 24m 04s |
| svm-chain-inflow | 26m 22s | 25m 05s |

Stage 1 saved ~1-2 min on most jobs. Slowest job (svm-chain-inflow) down from 26m 22s to 25m 05s.

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

## Stage 2 — Parallel chain startup

**Why**: `e2e_setup_chains` starts hub chain, then connected instance 2, then instance 3 sequentially. Each waits independently for its chain to become ready (up to 150s for MVM, 180s for EVM). These chains have zero startup dependencies on each other.

**Scope**: `testing-infra/ci-e2e/e2e-common.sh` (`e2e_setup_chains`)

**Constraint**: Account setup (`setup-requester-solver.sh`) must remain **sequential** because all instances write profiles to the same `~/.aptos/config.yaml` via the Aptos CLI. Parallel writes corrupt the file (confirmed by CI run 23357830574: `jq: parse error`, `Could not extract address for profile`).

**Files to change**:

- `testing-infra/ci-e2e/e2e-common.sh`
  - `e2e_setup_chains()`: The sequencing becomes:
    1. **Parallel**: Start hub chain, connected instance 2, connected instance 3 (`setup-chain.sh` x3 via `&` + `wait`)
    2. **Sequential**: Generate shared solver keys, then account setup for hub, chain 2, chain 3 (`setup-requester-solver.sh` — must be sequential, shared Aptos CLI config)
    3. **Sequential**: Hub contract deployment (`deploy-contracts.sh` — produces `HUB_MODULE_ADDR`)
    4. **Sequential**: Connected contract deployments for chain 2 and 3 (also write to shared `~/.aptos/config.yaml`)

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
