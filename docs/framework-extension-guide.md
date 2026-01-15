# Framework Extension Guide

This guide explains how to add a new blockchain framework (e.g., SVM, EVM, Move) to the Intent Framework while maintaining consistency and test coverage across all platforms.

## Overview

When adding a new framework, you must:

1. **Replicate the core escrow functionality** from existing frameworks
2. **Maintain test alignment** - each test should have a corresponding test in the same position across all frameworks
3. **Use generic test descriptions** - avoid platform-specific terminology
4. **Document platform differences** - use N/A comments for tests that don't apply to your platform
5. **Follow consistent structure** - use the same test file organization and section headers

## Test Structure Requirements

### Test File Organization

Each framework should have the following test files, matching the order and structure of existing frameworks:

1. **initialization** - Basic setup and escrow creation
2. **deposit** - Escrow creation and deposit functionality
3. **claim** - Claiming escrow funds with verifier signatures
4. **cancel** - Cancellation and refund functionality
5. **expiry** - Expiry timestamp handling and expired escrow behavior
6. **cross-chain** - Intent ID conversion and cross-chain compatibility
7. **edge-cases** - Boundary values, concurrent operations, gas/compute limits
8. **error-conditions** - Error handling and validation
9. **integration** - Full lifecycle workflows
10. **scripts** - Utility script testing (if applicable)

### Section Headers

Use section headers for test files that group multiple related tests:

```rust
// ============================================================================
// EDGE CASE TESTS
// ============================================================================
```

**When to use section headers:**
- `edge-cases` / `edge_cases` - "EDGE CASE TESTS"
- `integration` - "INTEGRATION TESTS"
- `cross-chain` / `cross_chain` - "CROSS-CHAIN INTENT ID CONVERSION TESTS"

**When NOT to use section headers:**
- `error-conditions` / `error_conditions` - Do not create "SVM-SPECIFIC TESTS" or "EVM-SPECIFIC TESTS" sections. Platform-specific tests should be placed at the end with numbered positions, and N/A comments should be inline at the same positions in other frameworks.

**When NOT to use section headers:**
- `initialization`, `deposit`, `claim`, `cancel`, `expiry` - These files are straightforward and don't need section headers
- `error-conditions` / `error_conditions` - Platform-specific tests should be numbered and placed at the end without section headers

### Test Descriptions

**Use generic, platform-appropriate terminology:**

✅ **Good:**
- "Verifies that escrows cannot be created with zero amount"
- "Verifies that the program handles boundary intent ID values correctly"
- "Verifies that escrow creation fails if requester has insufficient tokens"

❌ **Bad:**
- "Verifies that createEscrow reverts when ERC20 allowance is insufficient" (too EVM-specific)
- "Verifies that intent IDs from Aptos hex format can be converted to EVM uint256" (mentions other platforms)
- "Verifies that the contract handles boundary values" (use "program" for SVM, "contract" for EVM)

**Test description format:**
```rust
/// Test: [Test Name]
/// Verifies that [what the test does].
/// Why: [rationale for why this test is important].
```

### Test Order and Numbering

**Maintain the exact same test order and numbering across all frameworks.** This ensures:
- Easy comparison between frameworks
- Consistent test numbering
- Clear alignment of functionality

**Numbering format:**
- Each test should be numbered: `1. Test:`, `2. Test:`, etc.
- Numbers must match across all frameworks at the same position
- If a test is N/A for a framework, it still gets the same number with an N/A comment

## Test Alignment Reference

### Complete Test List

Each test file uses independent numbering starting from 1. At the end of the implementation, check that all tests are numbered correctly and match the below list.

#### initialization.test.js / initialization.rs

1. Should initialize escrow with verifier address
2. Should allow requester to create an escrow
3. Should revert if escrow already exists
4. Should revert if amount is zero

#### deposit.test.js / deposit.rs

1. Should allow requester to create escrow with tokens
2. Should revert if escrow is already claimed
3. Should support multiple escrows with different intent IDs
4. Should set correct expiry timestamp

#### claim.test.js / claim.rs

1. Should allow solver to claim with valid verifier signature
2. Should revert with invalid signature
3. Should prevent signature replay across different intent_ids
4. Should revert if escrow already claimed
5. Should revert if escrow does not exist

#### cancel.test.js / cancel.rs

1. Should revert if escrow has not expired yet
2. Should allow requester to cancel and reclaim funds after expiry
3. Should revert if not requester
4. Should revert if already claimed
5. Should revert if escrow does not exist

#### expiry.test.js / expiry.rs

1. Should allow requester to cancel expired escrow
2. Should verify expiry timestamp is stored correctly
3. Should prevent claim on expired escrow

#### cross-chain.test.js / cross_chain.rs

1. Should handle hex intent ID conversion to uint256/bytes32
2. Should handle intent ID boundary values
3. Should handle intent ID zero padding correctly
4. Should handle multiple intent IDs from different formats

#### edge-cases.test.js / edge_cases.rs

1. Should handle maximum values for amounts (and intent IDs if applicable)
2. Should handle minimum deposit amount
3. Should allow requester to create multiple escrows
4. Should handle gas/compute consumption for large operations
5. Should handle concurrent escrow operations

#### error-conditions.test.js / error_conditions.rs

1. Should revert with zero amount in createEscrow
2. Should revert with insufficient token allowance (if applicable)
3. Should handle maximum value in createEscrow (if applicable)
4. Should allow native currency escrow creation (if applicable)
5. Should revert with native currency amount mismatch (if applicable)
6. Should revert when native currency sent with token address (if applicable)
7. Should revert with invalid signature length (if applicable)
8. Should revert cancel on non-existent escrow

#### integration.test.js / integration.rs

1. Should complete full deposit to claim workflow
2. Should handle multiple different token types (if applicable)
3. Should emit all events/logs with correct parameters (if applicable)
4. Should complete full cancellation workflow

## Handling Platform Differences

### N/A Comments for Platform-Specific Tests

When a test from another framework doesn't apply to your platform, add a comment-only entry in the same position:

**In SVM (for EVM-specific tests):**
```rust
/// Test: Insufficient Allowance Rejection
/// Verifies that createEscrow reverts when token allowance is insufficient.
/// Why: Token transfers require explicit approval. Insufficient allowance must be rejected to prevent failed transfers.
///
/// NOTE: N/A for SVM - SPL tokens don't use approve/allowance pattern
// EVM: evm-intent-framework/test/error-conditions.test.js - "Should revert with insufficient ERC20 allowance"
```

**In EVM (for SVM-specific tests):**
```javascript
/// Test: Zero Solver Address Rejection
/// Verifies that escrows cannot be created with zero/default solver address.
/// Why: A valid solver must be specified for claims.
///
/// NOTE: N/A for EVM - Solidity address type cannot be zero by default, and require() checks prevent zero addresses
// SVM: svm-intent-framework/programs/intent_escrow/tests/error_conditions.rs - "test_reject_zero_solver_address"
```

### Platform-Specific Tests

If your platform has tests that don't exist in other frameworks, add them at the end of the appropriate test file (maintaining the numbered sequence):

**Example (SVM-specific tests in error_conditions.rs):**
```rust
/// 9. Test: Zero Solver Address Rejection
/// Verifies that escrows cannot be created with zero/default solver address.
/// Why: A valid solver must be specified for claims.
#[tokio::test]
async fn test_reject_zero_solver_address() {
    // ... test implementation
}
```

**Critical Rule:** When adding a new test to one framework, you **must** add a corresponding N/A comment description at the **same index/position** in all other frameworks, explaining why that test is not implemented.

### Adding New Tests to Existing Frameworks

**If you add a new test to a framework (with a new number):**

1. **Add the test** at the appropriate position in your framework's test file
2. **Number it** according to its position in the sequence
3. **Add N/A descriptions** in all other frameworks at the **exact same index/position**

**Example:** If you add a new test as "12. Test: New Feature Validation" in the EVM framework:

**In EVM (error-conditions.test.js):**
```javascript
/// 12. Test: New Feature Validation
/// Verifies that new feature works correctly.
/// Why: Ensures the new feature behaves as expected.
it("Should validate new feature", async function () {
  // ... test implementation
});
```

**In SVM (error_conditions.rs) - at the same position:**
```rust
/// 12. Test: New Feature Validation
/// Verifies that new feature works correctly.
/// Why: Ensures the new feature behaves as expected.
///
/// NOTE: N/A for SVM - [Clear explanation of why this test doesn't apply to SVM]
// EVM: evm-intent-framework/test/error-conditions.test.js - "Should validate new feature"
```

**Key points:**
- The test number must match across all frameworks
- N/A comments must be at the same index/position as the actual test
- The N/A comment must clearly explain why the test doesn't apply to that framework
- Include a reference to where the actual test is implemented

## Code Comments

### Avoid Historical Change Comments

❌ **Bad:**
```rust
let amount = 100_000u64; // Reduced to allow 6 escrows with initial 1M tokens
```

✅ **Good:**
```rust
let amount = 100_000u64; // Amount chosen to allow 6 escrows within test token budget
```

**Rule:** Comments should describe the current state and purpose, not what was changed from a previous version.

## Verification Checklist

When adding a new framework, verify:

- [ ] All core tests are implemented or have N/A comments
- [ ] Test order matches existing frameworks exactly
- [ ] Test numbers match across all frameworks at the same positions
- [ ] Test descriptions use generic, platform-appropriate terminology
- [ ] Section headers are used consistently (only where appropriate)
- [ ] Platform-specific tests are documented with N/A comments in other frameworks at the same index
- [ ] Code comments describe current state, not historical changes
- [ ] Test file names match the pattern: `[category].test.js` (EVM) or `[category].rs` (SVM)

When adding a new test to an existing framework:

- [ ] Test is numbered according to its position
- [ ] N/A descriptions are added in all other frameworks at the exact same index/position
- [ ] N/A comments clearly explain why the test doesn't apply to that framework
- [ ] Reference to the actual test implementation is included in N/A comments

## Example: Adding a New Framework

1. **Create test files** matching the structure above
2. **Implement tests** in the same order as EVM/SVM
3. **Add N/A comments** for tests that don't apply to your platform
4. **Add platform-specific tests** in dedicated sections
5. **Update other frameworks** with N/A comments for your platform-specific tests
6. **Verify alignment** using the test list above

## Current Framework Status

### EVM (Solidity)

- **Location:** `evm-intent-framework/test/`
- **Test Framework:** Mocha/Chai
- **Total Tests:** 42 core escrow tests
- **Status:** ✅ Complete

### SVM (Solana)

- **Location:** `svm-intent-framework/programs/intent_escrow/tests/`
- **Test Framework:** Rust `solana-program-test` with `tokio::test`
- **Total Tests:** 39 implemented + 9 N/A comments + 3 SVM-specific
- **Status:** ✅ Complete

### Alignment

- ✅ All position-matched tests exist in both frameworks
- ✅ Platform differences documented with N/A comments
- ✅ Test order and structure aligned
- ✅ Generic terminology used throughout
