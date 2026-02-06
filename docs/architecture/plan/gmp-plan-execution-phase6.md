# Phase 6: Intent Unification Review (1-2 days)

**Status:** In Progress
**Depends On:** Phase 5
**Blocks:** None (Review Phase)

**Goal:** Assess architectural improvements to simplify the intent framework by (A) separating and minimizing MVM connected chain contracts, and (B) investigating whether hub intents can be unified into a single base type.

---

## Background

### Current State

The hub chain (MVM) uses two different intent types:

| Flow | Intent Type | Module | Security Gate |
|------|-------------|--------|---------------|
| **Inflow** | `FungibleAssetLimitOrder` | `fa_intent` | Escrow confirmation check in wrapper |
| **Outflow** | `OracleGuardedLimitOrder` | `fa_intent_with_oracle` | Oracle witness at type level |

### Why Two Types Exist

1. **Inflow**: Tokens locked on connected chain, desired on hub. Solver provides tokens on hub. No oracle needed - escrow confirmation via GMP is sufficient.

2. **Outflow**: Tokens locked on hub, desired on connected chain. Solver delivers on connected chain. Requires proof of delivery before releasing hub tokens.

### Security Consideration

`OracleGuardedLimitOrder` provides **defense-in-depth**: even if someone bypasses the wrapper function and calls lower-level `fa_intent_with_oracle` functions directly, they still need an oracle witness (or must use the `_for_gmp` variant which is only called after GMP proof check).

`FungibleAssetLimitOrder` does NOT have this protection - the security gate is only in the wrapper function.

---

## Part A: Separate MVM Connected Chain Contracts

### Objective

Minimize and isolate the MVM connected chain contracts (used when MVM acts as a connected chain, not the hub).

### Current MVM Connected Chain Modules

| Module | Purpose | Used By |
|--------|---------|---------|
| `intent_inflow_escrow` | Receives requirements from hub, creates escrow on connected chain, sends confirmation to hub | MVM as connected chain (inflow) |
| `intent_outflow_validator` | Receives requirements from hub, validates solver fulfillment on connected chain, sends proof to hub | MVM as connected chain (outflow) |

### Tasks

- [x] **Commit 1: Audit MVM connected chain modules** ✅
  - Review `intent_inflow_escrow.move` dependencies
  - Review `intent_outflow_validator.move` dependencies
  - Identify shared code with hub modules
  - Document minimal required dependencies
  - See: `gmp-phase6-audit-mvm-connected-chain.md`

- [x] **Commit 2: Split MVM package into three separate packages (REQUIRED)** ✅
  - Created three packages:
    - **`intent-gmp`** (8KB bytecode, 16KB deploy) - gmp_common, gmp_sender, gmp_intent_state, gmp_endpoints
    - **`intent-hub`** (35KB bytecode, 75KB deploy) - All core intent modules + hub-specific intent_gmp
    - **`intent-connected`** (14KB bytecode, 14KB deploy) - intent_outflow_validator, intent_inflow_escrow + connected-specific intent_gmp
  - Removed `is_initialized()` conditional routing - missing init is now a hard failure
  - Updated deployment scripts (hub deploys intent-gmp then intent-hub with `--chunked-publish`)
  - **Note:** intent-hub still exceeds 60KB (75KB) and requires `--chunked-publish`
  - All 164 MVM tests passing across 3 packages

- [x] **Commit 3: Rename SVM programs for consistency** ✅
  - **SVM renames completed:**
    - Renamed `native-gmp-endpoint` → `intent-gmp`
    - Renamed `outflow-validator` → `intent-outflow-validator`
    - Final SVM structure (2 logical groups, 3 programs):
      - **`intent-gmp`** - GMP infrastructure
      - **`intent-connected`** = `intent-escrow` + `intent-outflow-validator` (2 programs, logically grouped)
    - Note: Unlike Move, Solana cannot bundle programs into packages - each is deployed separately
  - **EVM:** NativeGmpEndpoint.sol and OutflowValidator.sol do not exist yet (skipped)
  - Updated Cargo.toml, Rust imports, build.sh, test.sh

- [ ] **Commit 4: Align EVM architecture with MVM/SVM patterns**
  - Create EVM contracts following the same structure as MVM and SVM:
    - `IntentGmp.sol` - GMP infrastructure (like MVM intent-gmp, SVM intent-gmp)
    - `IntentEscrow.sol` - Escrow for inflow (like SVM intent-escrow)
    - `IntentOutflowValidator.sol` - Outflow validation (like MVM/SVM intent-outflow-validator)
  - Ensure consistent naming conventions across all three VMs
  - Update EVM tests and deployment scripts
  - Run `/review-tests-new` then `/review-commit-tasks` then `/commit` to finalize

- [x] **Commit 5: Auto-release escrow on FulfillmentProof receipt (GMP flow)** ✅
  - Collapsed two-step release into single step matching SVM behavior
  - Changes made:
    - `intent_inflow_escrow.move`: `receive_fulfillment_proof` now transfers tokens to solver and marks both fulfilled+released
    - `intent_inflow_escrow.move`: `release_escrow` kept as manual fallback
    - `solver/src/service/inflow.rs`: `release_mvm_gmp_escrow` now polls `is_escrow_released` (no manual release call)
    - `solver/src/chains/connected_mvm.rs`: replaced `is_escrow_fulfilled` with `is_escrow_released`, marked `release_gmp_escrow` as dead code
    - Updated 5 Move tests to reflect auto-release behavior
    - E2E tests already poll `is_released` - no changes needed (release happens faster now)

**Files to analyze:**

- `intent-frameworks/mvm/intent-connected/sources/gmp/intent_inflow_escrow.move`
- `intent-frameworks/mvm/intent-connected/sources/gmp/intent_outflow_validator.move`
- `intent-frameworks/mvm/sources/gmp/gmp_common.move`
- `intent-frameworks/mvm/sources/gmp/intent_gmp.move`
- `intent-frameworks/svm/programs/intent-gmp/` (renamed from native-gmp-endpoint)
- `intent-frameworks/svm/programs/intent_escrow/`
- `intent-frameworks/svm/programs/intent-outflow-validator/` (renamed from outflow-validator)

---

## Part B: Investigate Intent Unification

### Objective

Determine if hub intents can use a single base type while maintaining security guarantees.

### Research Questions

1. **Can `OracleGuardedLimitOrder` be the basis for both flows?**
   - Inflow: Oracle witness not required (escrow confirmation is sufficient)
   - Outflow: Oracle witness required (GMP proof of delivery)
   - Is there a way to make the oracle requirement conditional?

2. **What modifications would be needed to `fa_intent_with_oracle`?**
   - Add a "skip oracle" flag checked at type level?
   - Add different finish functions for different flows?
   - Security implications of each approach?

3. **What are the trade-offs?**
   - Code simplification vs security guarantees
   - Type-level safety vs runtime checks
   - Developer experience vs attack surface

### Potential Approaches

#### Approach 1: Conditional Oracle Requirement

Add a field to `OracleGuardedLimitOrder` that indicates whether oracle verification is required:

```move
struct OracleGuardedLimitOrder has store, drop {
    // ... existing fields ...
    oracle_required: bool,  // false for inflow, true for outflow
}
```

**Pros:**
- Single intent type for both flows
- Simpler mental model

**Cons:**
- Runtime check instead of type-level enforcement
- Must audit all code paths to ensure flag is respected
- Potential for misconfiguration

#### Approach 2: Separate Finish Functions (Current)

Keep separate types but investigate if they can share more code:

```move
// For inflow (no oracle)
finish_fa_receiving_session_with_event()

// For outflow (oracle required)
finish_fa_receiving_session_with_oracle()
finish_fa_receiving_session_for_gmp()
```

**Pros:**
- Type-level enforcement
- Clear separation of concerns
- Defense-in-depth

**Cons:**
- Two intent types to maintain
- More code duplication

#### Approach 3: Generic Intent with Pluggable Validation

Create a generic intent type with pluggable validation:

```move
struct GenericLimitOrder<V: store + drop> has store, drop {
    // ... common fields ...
    validator: V,  // NoValidator, OracleValidator, GmpValidator, etc.
}
```

**Pros:**
- Maximum flexibility
- Type-safe validation
- Extensible

**Cons:**
- More complex implementation
- Higher learning curve
- May be over-engineered for current needs

### Tasks

- [ ] **Commit 6: Document current intent type differences**
  - List all fields in `FungibleAssetLimitOrder`
  - List all fields in `OracleGuardedLimitOrder`
  - Identify overlap and differences
  - Document security implications of each field
  - Run `/review-tests-new` then `/review-commit-tasks` then `/commit` to finalize

- [ ] **Commit 7: Prototype conditional oracle approach**
  - Create test branch with `oracle_required` flag
  - Implement conditional check in finish functions
  - Write security tests (attempt bypass without flag)
  - Document findings
  - Run `/review-tests-new` then `/review-commit-tasks` then `/commit` to finalize

- [ ] **Commit 8: Write recommendation document**
  - Compare approaches with concrete code examples
  - Security analysis of each approach
  - Recommendation with rationale
  - Migration path if unification is recommended
  - Run `/review-tests-new` then `/review-commit-tasks` then `/commit` to finalize

**Files to analyze:**

- `intent-frameworks/mvm/sources/fa_intent.move`
- `intent-frameworks/mvm/sources/fa_intent_with_oracle.move`
- `intent-frameworks/mvm/sources/fa_intent_inflow.move`
- `intent-frameworks/mvm/sources/fa_intent_outflow.move`

---

## Part C: SVM Build Performance

### Objective

The SVM Docker build is slow. Research bottlenecks and identify optimization opportunities.

### Current Bottlenecks (Suspected)

1. **Solana CLI downloaded fresh every Docker run** (~200MB+)
2. **Platform-tools downloaded for each cargo build-sbf call**
3. **Toolchain re-registration happening 3 times** due to cargo-build-sbf bug workaround
4. **No cargo cache between Docker runs**

### Tasks

- [ ] **Commit 9: Profile SVM Docker build and document bottlenecks**
  - Time each phase (Solana install, platform-tools download, compilation)
  - Measure download sizes
  - Identify what's re-downloaded vs cached
  - Document findings
  - Run `/review-tests-new` then `/review-commit-tasks` then `/commit` to finalize

- [ ] **Commit 10: Implement SVM build optimizations**
  - Based on profiling results, implement improvements:
    - Pre-built Docker image with Solana CLI?
    - Volume mounts for caches (~/.cache/solana, cargo registry)?
    - Single cargo build for all programs?
    - Fix root cause of toolchain bug instead of workaround?
  - Run `/review-tests-new` then `/review-commit-tasks` then `/commit` to finalize

**Files to analyze:**

- `intent-frameworks/svm/scripts/build-with-docker.sh`
- `intent-frameworks/svm/scripts/build.sh`

---

## Run All Tests

```bash
# Run all unit tests (includes coordinator, trusted-gmp, solver, MVM, EVM, SVM, frontend)
./testing-infra/run-all-unit-tests.sh
```

> **Note:** This phase is primarily research/review. Code changes are exploratory and may not be merged.

---

## Deliverables

1. **Part A Deliverable:** Assessment of MVM and SVM connected chain module isolation
   - Dependency audit report
   - Recommendation on package structure (MVM + SVM)
   - Refactored modules/programs (if beneficial)

2. **Part B Deliverable:** Intent unification recommendation document
   - Current state analysis
   - Approach comparison (with code examples)
   - Security analysis
   - Final recommendation with rationale

---

## Exit Criteria

- [x] Part A: MVM and SVM connected chain modules audited and documented
- [x] Part A: MVM package split into 3 packages (intent-gmp, intent-hub, intent-connected)
- [x] Part A: SVM program structure documented (intent-gmp + intent-outflow-validator renamed)
- [ ] Part A: Recommendation on package structure documented
- [ ] Part B: All three approaches analyzed with security implications
- [ ] Part B: Prototype of conditional oracle approach (test branch)
- [ ] Part B: Final recommendation document written
- [x] All existing tests still pass (no regressions)
