# Phase 5: Integration & Documentation (2-3 days)

**Status:** Not Started
**Depends On:** Phase 4
**Blocks:** None (Final Phase)

---

## Commits

### Commit 1: Add dual-mode support for testing both flows

**Files:**

- `verifier/src/dual_mode.rs`
- `verifier/src/config.rs`
- `verifier/src/tests/dual_mode_tests.rs`

**Tasks:**

- [ ] Add config flag `--legacy-mode` to enable old verifier logic
- [ ] Add config flag `--gmp-simulator` to enable GMP simulator mode
- [ ] Support running both modes simultaneously
- [ ] Log which mode handles each intent
- [ ] Test mode switching and concurrent operation

**Test:**

```bash
nix develop ./nix -c bash -c "cd verifier && cargo test -- --test dual_mode_tests"
```

---

### Commit 2: Update frontend for GMP integration

**Files:**

- `frontend/src/config/gmp.ts`
- `frontend/src/components/IntentStatus.tsx`
- `frontend/src/tests/gmp.test.ts`

**Tasks:**

- [ ] Add feature flag for GMP vs legacy mode
- [ ] Show GMP message status in intent details
- [ ] Update status tracking for GMP-based intents
- [ ] Test UI renders correctly for both modes

**Test:**

```bash
nix develop ./nix -c bash -c "cd frontend && npm test -- --grep 'gmp'"
```

---

### Commit 3: Update solver SDK for GMP integration

**Files:**

- `solver/src/gmp.rs`
- `solver/src/tests/gmp_tests.rs`

**Tasks:**

- [ ] Detect intent mode (GMP vs legacy)
- [ ] Use validation contract for GMP-based outflow intents
- [ ] Handle escrow creation for GMP-based inflow intents
- [ ] Test both fulfillment flows work correctly

**Test:**

```bash
nix develop ./nix -c bash -c "cd solver && cargo test -- --test gmp_tests"
```

---

### Commit 4: Add full cross-chain testnet integration test

**Files:**

- `testing-infra/ci-e2e/e2e-tests-gmp/full-flow-testnet.sh`

**Tasks:**

- [ ] Test complete outflow: MVM testnet → SVM devnet
- [ ] Test complete inflow: MVM testnet ← SVM devnet
- [ ] Test complete outflow: MVM testnet → Base Sepolia
- [ ] Test complete inflow: MVM testnet ← Base Sepolia
- [ ] Verify all GMP messages delivered correctly

**Test:**

```bash
nix develop ./nix -c bash -c "./testing-infra/ci-e2e/e2e-tests-gmp/full-flow-testnet.sh"
```

---

### Commit 5: Add GMP integration documentation

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
# Documentation review - no automated test
# Manual: Review documentation for completeness
```

---

### Commit 6: Deprecate legacy verifier code

**Files:**

- `verifier/src/legacy/mod.rs` (move old code)
- `verifier/DEPRECATION.md`
- `CHANGELOG.md`

**Tasks:**

- [ ] Move legacy validation code to `legacy/` module
- [ ] Add deprecation warnings to legacy functions
- [ ] Update CHANGELOG with GMP integration notes
- [ ] Document rollback procedures if needed

**Test:**

```bash
# Verify deprecation warnings appear
nix develop ./nix -c bash -c "cd verifier && cargo build 2>&1 | grep -i deprecat"

# Verify all tests still pass
nix develop ./nix -c bash -c "cd verifier && cargo test"
```

---

## Run All Tests

```bash
# Verifier tests (including dual-mode)
nix develop ./nix -c bash -c "cd verifier && cargo test"

# Frontend GMP tests
nix develop ./nix -c bash -c "cd frontend && npm test -- --grep 'gmp'"

# Solver GMP tests
nix develop ./nix -c bash -c "cd solver && cargo test -- --test gmp_tests"

# Full testnet integration (requires deployed contracts)
nix develop ./nix -c bash -c "./testing-infra/ci-e2e/e2e-tests-gmp/full-flow-testnet.sh"
```

---

## Exit Criteria

- [ ] All 6 commits merged to feature branch
- [ ] Dual-mode verifier works correctly
- [ ] Frontend shows GMP status correctly
- [ ] Solver handles both GMP and legacy flows
- [ ] Full cross-chain testnet integration passes
- [ ] Documentation complete
- [ ] Legacy verifier code deprecated
