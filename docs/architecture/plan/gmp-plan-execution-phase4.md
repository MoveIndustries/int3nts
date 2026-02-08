# Phase 4: Integration & Documentation

**Status:** In Progress
**Depends On:** Phase 3
**Blocks:** None (Final Phase)

**What Phase 3 completed:** Readiness tracking for outflow intents (commit `f46eb3d`) - monitors IntentRequirementsReceived events and sets `ready_on_connected_chain` flag.

**Architecture principle:** The coordinator is the single API surface for frontends and solvers. Clients never poll trusted-gmp directly. Trusted-gmp is purely infrastructure (relay) — invisible to clients.

---

## Commits

> 📋 **Commit Conventions:** Before each commit, review `.claude/CLAUDE.md` and `.cursor/rules` for commit message format, test requirements, and coding standards.

### Commit 1: Strip trusted-gmp client-facing API down to relay-only

**Files:**

- `trusted-gmp/src/api/generic.rs` (existing - route definitions)
- `trusted-gmp/src/api/outflow_generic.rs` (remove)
- `trusted-gmp/src/api/outflow_mvm.rs` (remove)
- `trusted-gmp/src/api/outflow_evm.rs` (remove)
- `trusted-gmp/src/api/outflow_svm.rs` (remove)
- `trusted-gmp/src/api/inflow_generic.rs` (remove)

**Tasks:**

- [x] Remove all client-facing API endpoints:
  - `POST /validate-outflow-fulfillment` (solver validated tx hash — now done on-chain by validation contract)
  - `POST /validate-inflow-escrow` (escrow validation — now auto-releases via GMP FulfillmentProof)
  - `POST /approval` (signature generation — GMP message is the proof)
  - `GET /public-key` (frontend needed for intent creation — no signatures in GMP)
  - `GET /approved/:intent_id` (frontend polled approval status — coordinator provides this)
  - `GET /approvals` (listed all signatures — no signatures exist)
  - `GET /approvals/:escrow_id` (specific escrow signature — no signatures exist)
  - `GET /events` (coordinator has its own `/events`)
- [x] Keep only:
  - `GET /health` (ops monitoring of relay process)
- [x] Remove dead code: outflow validation logic, inflow validation logic, signature generation, transaction parsing
- [x] Update trusted-gmp tests to remove tests for deleted endpoints
- [x] Verify relay functionality still works (MessageSent watching + deliverMessage calls)

**Test:**

```bash
# Run all unit tests
./testing-infra/run-all-unit-tests.sh
```

> ⚠️ **All unit tests must pass before proceeding to Commit 2.** Run `/review-tests-new` then `/review-commit-tasks` then `/commit` to finalize.

---

### Commit 2: Remove trusted-gmp polling from frontend, use coordinator only

**Files:**

- `frontend/src/lib/coordinator.ts` (existing)
- `frontend/src/lib/types.ts` (existing)

**Tasks:**

- [x] Remove all direct trusted-gmp API calls from frontend:
  - Remove `/approved/:intentId` polling (outflow approval check)
  - Remove `/public-key` call (no longer needed — GMP replaces signatures)
  - Remove `/approvals/:escrowId` call (inflow approval check)
- [x] Replace outflow completion tracking: poll coordinator `GET /events` for intent fulfillment/completion status instead of trusted-gmp `/approved/:intentId`
- [x] Replace inflow escrow release tracking: poll coordinator `GET /events` for `EscrowReleased` event instead of trusted-gmp `/approvals/:escrowId`
- [x] Remove `trusted_gmp_public_key` parameter from outflow intent creation flow
- [x] Use `ready_on_connected_chain` flag from coordinator events to show GMP delivery status
- [x] Remove trusted-gmp base URL configuration from frontend

**Test:**

```bash
# Run all unit tests
./testing-infra/run-all-unit-tests.sh
```

> ⚠️ **All unit tests must pass before proceeding to Commit 2.** Run `/review-tests-new` then `/review-commit-tasks` then `/commit` to finalize.

---

### Commit 3: Remove trusted-gmp polling from solver, use coordinator only

**Files:**

- `solver/src/coordinator_gmp_client.rs` (existing)
- `solver/src/service/outflow.rs` (existing)
- `solver/src/service/inflow.rs` (existing)

**Tasks:**

- [x] Remove direct trusted-gmp API calls from solver:
  - Remove `POST /validate-outflow-fulfillment` call (no longer needed — validation contract sends GMP message directly)
  - Remove any `/approvals` polling
- [x] Replace outflow completion tracking: use coordinator `GET /events` to check hub intent release status
- [x] Replace inflow escrow release tracking: use coordinator `GET /events` to check `EscrowReleased` event
- [x] Use `ready_on_connected_chain` flag from coordinator events before calling validation contracts
- [x] Remove trusted-gmp base URL configuration from solver

**Test:**

```bash
# Run all unit tests
./testing-infra/run-all-unit-tests.sh
```

> ⚠️ **All unit tests must pass before proceeding to Commit 4.** Run `/review-tests-new` then `/review-commit-tasks` then `/commit` to finalize.

---

### Commit 4: Update deployment scripts for GMP (moved from Phase 2)

**Files:**

- `intent-frameworks/svm/scripts/` (update existing deployment scripts)
- `intent-frameworks/mvm/scripts/` (update existing deployment scripts)

**Tasks:**

- [ ] Update SVM deployment scripts to include GMP programs (intent-outflow-validator, intent-escrow with GMP config)
- [ ] Update MVM deployment scripts to include GMP modules
- [ ] Add trusted remote configuration to deployment scripts
- [ ] Deploy updated contracts/modules to testnets
- [ ] Verify cross-chain flow works on testnets (with native GMP relay)

**Test:**

```bash
./testing-infra/run-all-unit-tests.sh

# Verify deployments
solana program show <INTENT_OUTFLOW_VALIDATOR_PROGRAM_ID> --url devnet
```

> ⚠️ **CI e2e tests must pass before proceeding to Commit 5.** Run `/review-tests-new` then `/review-commit-tasks` then `/commit` to finalize.

---

### Commit 5: Add fee estimation and endpoint configuration

**Files:**

- `docs/architecture/plan/gmp-endpoints.md`
- `docs/architecture/plan/gmp-fee-analysis.md`

**Tasks:**

- [ ] Document all GMP endpoint addresses (LZ for Solana and Movement, local for testing)
- [ ] Document environment configuration (local/CI uses native GMP endpoints, testnet/mainnet use LZ)
- [ ] Estimate LZ message fees for each route
- [ ] Estimate on-chain validation gas costs
- [ ] Compare costs to current Trusted GMP system

**Test:**

```bash
# Documentation review - manual
```

> ⚠️ **Documentation review before proceeding to Commit 7.** Run `/review-tests-new` then `/review-commit-tasks` then `/commit` to finalize.

---

### Commit 6: Add GMP integration documentation

**Files:**

- `docs/gmp/architecture.md`
- `docs/gmp/solver-guide.md`
- `docs/gmp/troubleshooting.md`

**Tasks:**

- [ ] Document GMP architecture and message flows
- [ ] Document solver integration guide
- [ ] Document common issues and troubleshooting steps
- [ ] Document testnet contract addresses

**Test:**

```bash
# Run all unit tests
./testing-infra/run-all-unit-tests.sh

# Documentation review - manual
```

> ⚠️ **CI e2e tests must pass before proceeding to Commit 7.** Run `/review-tests-new` then `/review-commit-tasks` then `/commit` to finalize.

---

### Commit 7: Final cleanup and verification

**Files:**

- `CHANGELOG.md`
- `README.md` (update architecture section)

**Tasks:**

- [ ] Confirm architecture: coordinator + trusted-gmp only (no monolithic signer code or directory)
- [ ] Update CHANGELOG with GMP integration notes
- [ ] Update README with new architecture diagram
- [ ] Verify coordinator has no private keys (trusted-gmp requires operator wallet privkeys per chain)
- [ ] Final security review of coordinator + trusted-gmp

**Test:**

```bash
# Run all unit tests
./testing-infra/run-all-unit-tests.sh

# Architecture check: coordinator + trusted-gmp only (no monolithic signer directory)
test ! -d verifier && echo "OK: coordinator + trusted-gmp only"

# Coordinator must not reference private keys
grep -r "private_key\|secret_key\|signing_key" coordinator/ && exit 1 || echo "OK: coordinator has no keys"
```

> ⚠️ **CI e2e tests must pass before Phase 4 is complete (7 commits total).** Run `/review-tests-new` then `/review-commit-tasks` then `/commit` to finalize.

---

## Run All Tests

```bash
# Run all unit tests (includes coordinator, trusted-gmp, solver, MVM, EVM, SVM, frontend)
./testing-infra/run-all-unit-tests.sh
```

> ⚠️ **CI runs e2e tests automatically. All e2e tests (MVM, EVM, SVM - inflow + outflow, plus GMP cross-chain tests) must pass before merging.**

---

## Documentation Update

At the end of Phase 4, update:

- [ ] `docs/gmp/architecture.md` - Complete GMP architecture documentation
- [ ] `docs/gmp/solver-guide.md` - Complete solver integration guide
- [ ] `docs/gmp/troubleshooting.md` - Common issues and solutions
- [ ] `README.md` - Update with new architecture diagram
- [ ] `CHANGELOG.md` - Document GMP integration milestone
- [ ] Review ALL conception documents for accuracy after full GMP migration
- [ ] Final audit: No references to monolithic signer; architecture is coordinator + trusted-gmp only

---

## Exit Criteria

- [ ] All 7 commits merged to feature branch
- [ ] Trusted-gmp stripped to relay-only (no client-facing API besides /health)
- [ ] Frontend uses coordinator as single API (no direct trusted-gmp calls)
- [ ] Solver uses coordinator as single API (no direct trusted-gmp calls)
- [ ] Programs/modules deployed to testnets (Commit 4)
- [ ] Documentation complete
- [ ] Fee analysis complete (deferred from Phase 1)
- [ ] Architecture confirmed: coordinator + trusted-gmp only (no monolithic signer)
- [ ] All conception documents reviewed and updated
