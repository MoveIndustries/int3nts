# Phase 0: Verifier Separation (3-4 days)

**Status:** Not Started
**Depends On:** None
**Blocks:** Phase 1
**Purpose:** Separate the current verifier into two independent components: Coordinator (UX functions) and Trusted GMP (message relay), enabling incremental migration and cleaner architecture.

---

## Overview

Before migrating to real GMP protocols, we first separate the verifier into:
1. **Coordinator Service** - Handles UX functions (event monitoring, caching, API, negotiation) - no keys, no validation
2. **Trusted GMP Service** - Handles message relay (watches mock GMP endpoints, delivers messages) - no keys, no validation

This separation:
- ✅ Reduces security surface (removes keys from coordinator)
- ✅ Enables independent testing of each component
- ✅ Provides migration path (can use trusted GMP during transition)
- ✅ Makes architecture cleaner (clear separation of concerns)
- ✅ Allows gradual migration (coordinator can work with both old and new flows)

---

## Commits

### Commit 1: Extract Coordinator Service

**Files:**

- `coordinator/src/main.rs`
- `coordinator/src/monitor/` (moved from `verifier/src/monitor/`)
- `coordinator/src/api/` (moved from `verifier/src/api/`)
- `coordinator/src/storage/` (moved from `verifier/src/storage/`)
- `coordinator/Cargo.toml`

**Tasks:**

- [ ] Create new `coordinator/` crate
- [ ] Move event monitoring logic from verifier (no validation, just monitoring)
- [ ] Move REST API from verifier (no signature endpoints, just read-only)
- [ ] Move event caching/storage from verifier
- [ ] Remove all cryptographic operations (no keys, no signing)
- [ ] Remove all validation logic (contracts will handle this)
- [ ] Keep negotiation API (application logic, not security-critical)
- [ ] Update configuration to remove key-related settings
- [ ] Test coordinator can monitor events and serve API without keys

**Test:**

```bash
# Build coordinator
nix develop ./nix -c bash -c "cd coordinator && cargo build"

# Test coordinator API (should work without keys)
nix develop ./nix -c bash -c "cd coordinator && cargo test"
```

---

### Commit 2: Extract Trusted GMP Service

**Files:**

- `trusted-gmp/src/main.rs`
- `trusted-gmp/src/monitor/gmp_events.rs`
- `trusted-gmp/src/delivery/` (message delivery logic)
- `trusted-gmp/Cargo.toml`

**Tasks:**

- [ ] Create new `trusted-gmp/` crate
- [ ] Implement mock GMP endpoint event monitoring (watches `MessageSent` events)
- [ ] Implement message delivery logic (calls `lzReceive()` on destination contracts)
- [ ] Support configurable chain connections (MVM, EVM, SVM)
- [ ] Support message routing (source chain → destination chain)
- [ ] No validation logic (contracts validate)
- [ ] No private keys (just message relay)
- [ ] Add configuration for trusted mode (which chains to connect)
- [ ] Test message delivery works end-to-end

**Test:**

```bash
# Build trusted-gmp
nix develop ./nix -c bash -c "cd trusted-gmp && cargo build"

# Test message delivery
nix develop ./nix -c bash -c "cd trusted-gmp && cargo test"
```

---

### Commit 3: Update Verifier to Use Coordinator + Trusted GMP

**Files:**

- `verifier/src/main.rs` (updated to use coordinator + trusted-gmp)
- `verifier/src/config.rs` (updated configuration)
- `verifier/Cargo.toml` (add coordinator and trusted-gmp as dependencies)

**Tasks:**

- [ ] Update verifier to use coordinator for event monitoring
- [ ] Update verifier to use coordinator for API endpoints
- [ ] Keep validation logic in verifier (for now, will move to contracts later)
- [ ] Keep signature generation in verifier (for now, will be replaced by GMP)
- [ ] Add configuration to switch between:
  - **Legacy mode**: Current verifier behavior (validation + signatures)
  - **Trusted GMP mode**: Use trusted-gmp for message relay (no signatures)
- [ ] Test both modes work correctly
- [ ] Ensure backward compatibility (existing flows still work)

**Test:**

```bash
# Test legacy mode (current behavior)
nix develop ./nix -c bash -c "cd verifier && cargo test --features legacy-mode"

# Test trusted GMP mode
nix develop ./nix -c bash -c "cd verifier && cargo test --features trusted-gmp-mode"
```

---

### Commit 4: Integration Tests for Separated Components

**Files:**

- `testing-infra/ci-e2e/phase0-tests/coordinator_tests.rs`
- `testing-infra/ci-e2e/phase0-tests/trusted_gmp_tests.rs`
- `testing-infra/ci-e2e/phase0-tests/integration_tests.rs`

**Tasks:**

- [ ] Test coordinator can monitor events independently
- [ ] Test coordinator API works without keys
- [ ] Test trusted GMP can relay messages end-to-end
- [ ] Test verifier can use both coordinator and trusted-gmp
- [ ] Test backward compatibility (existing flows still work)
- [ ] Test mode switching works correctly

**Test:**

```bash
# Run all Phase 0 integration tests
nix develop ./nix -c bash -c "cd testing-infra/ci-e2e/phase0-tests && cargo test"
```

---

## Success Criteria

✅ **Coordinator Service:**
- Monitors events across chains (no keys needed)
- Serves REST API (read-only, no signature endpoints)
- Handles negotiation routing (application logic)
- No security-critical functions

✅ **Trusted GMP Service:**
- Watches mock GMP endpoint events
- Delivers messages to destination contracts
- No validation logic
- No private keys

✅ **Verifier:**
- Can use coordinator for event monitoring
- Can use trusted GMP for message relay
- Maintains backward compatibility
- Supports mode switching

✅ **System:**
- Existing flows continue to work
- Clear separation of concerns
- Reduced security surface
- Ready for Phase 1 (on-chain validation migration)

---

## Benefits of Phase 0

1. **Incremental Migration** - Can test coordinator and trusted GMP independently
2. **Reduced Risk** - Separating components reduces blast radius of changes
3. **Clear Architecture** - Coordinator and trusted GMP have distinct roles
4. **Testing** - Can test each component in isolation
5. **Migration Path** - Trusted GMP can be used during transition to real GMP
6. **Backward Compatibility** - Existing flows continue to work during migration

---

## Next Steps

After Phase 0 completes:
- **Phase 1**: Research & Design (can now focus on on-chain validation, knowing coordinator/trusted-gmp are separated)
- **Phase 2+**: Implement GMP contracts (can use trusted GMP for testing)
