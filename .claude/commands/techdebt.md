---
description: Find and eliminate technical debt including duplicated code, TODO comments, and code smells
---

# Technical Debt Analysis

Run this command at the end of every session to identify and eliminate technical debt.

## Task 1: Find Duplicated Code

Search for code duplication across all implementation files (not tests):

### Search patterns

1. **Find duplicate functions/logic**:
   - Look for similar function names across files
   - Identify repeated code blocks (>10 lines)
   - Check for copy-pasted logic with minor variations

2. **Common duplication hotspots**:
   - Similar validation logic across frameworks (MVM/EVM/SVM)
   - Repeated error handling patterns
   - Duplicate type conversions or serialization
   - Shared constants defined in multiple places
   - Similar test helpers or setup code

3. **Framework-specific duplication**:
   - Intent frameworks: Check `intent-frameworks/{mvm,evm,svm}/sources/` or `intent-frameworks/{mvm,evm,svm}/contracts/`
   - Rust services: Check `coordinator/src/`, `trusted-gmp/src/`, `solver/src/`
   - Frontend: Check `frontend/src/`

### How to identify

Use code search to find:

- Repeated string literals (error messages, constants)
- Similar function signatures
- Matching code structure patterns
- Identical helper functions in different modules

### What to do

For each duplication found:

1. **Extract to common module**: Move shared code to appropriate common location
2. **Create helper function**: Replace repeated blocks with reusable function
3. **Define shared constants**: Move magic numbers/strings to constant files
4. **Document the refactor**: Explain why consolidation improves maintainability

**Common locations for shared code**:

- `intent-frameworks/common/` - Cross-chain shared types/logic
- Helper modules within each framework
- Utility files in Rust services (`utils.rs`, `helpers.rs`)

## Task 2: Find TODO Comments and Placeholders

Search for incomplete work:

```bash
grep -r "TODO" --include="*.rs" --include="*.move" --include="*.sol" --include="*.js" --include="*.ts" --include="*.tsx"
grep -r "FIXME" --include="*.rs" --include="*.move" --include="*.sol" --include="*.js" --include="*.ts" --include="*.tsx"
grep -r "HACK" --include="*.rs" --include="*.move" --include="*.sol" --include="*.js" --include="*.ts" --include="*.tsx"
grep -r "XXX" --include="*.rs" --include="*.move" --include="*.sol" --include="*.js" --include="*.ts" --include="*.tsx"
```

### What to do

For each TODO/FIXME/HACK found:

1. **Either complete it** - Implement the missing functionality
2. **Or remove it** - If no longer needed, delete the comment
3. **Never leave it** - Per "No Fallbacks Policy", no placeholders allowed

**Critical**: Tests with TODOs must be fixed or removed entirely.

## Task 3: Find Code Smells

### Magic numbers and strings

Find hardcoded values that should be constants:

- Hardcoded addresses (not in test helpers)
- Repeated numeric literals
- Hardcoded URLs or identifiers

### Dead code

Find unused code:

- Unused imports
- Commented-out code blocks
- Unreachable functions or modules

### Poor error handling

Find weak error handling:

- Empty catch blocks: `catch (e) {}`
- Generic error messages without context
- Ignored errors (especially in Rust with `let _ = ...`)

### Fallback patterns (CRITICAL)

**Per "No Fallbacks Policy" from CLAUDE.md, fallback patterns violate project principles.**

Search for fallback patterns in code:

```bash
# Common fallback patterns
grep -r "fallback\|default\|or_else\|unwrap_or\|unwrap_or_default\|unwrap_or_else" --include="*.rs" --include="*.move" --include="*.sol" --include="*.js" --include="*.ts" --include="*.tsx"

# Silent error swallowing
grep -r "catch.*{.*}" --include="*.js" --include="*.ts" --include="*.tsx"
grep -r "\.ok()" --include="*.rs"

# Optional chaining that might hide errors
grep -r "\?\." --include="*.ts" --include="*.tsx" --include="*.js"
```

**Analyze each fallback:**

For every fallback found, ask:

1. **Is this hiding a failure?** If yes, make it fail explicitly
2. **Should this use a default?** If no, error instead
3. **Is this in a test?** Tests MUST fail hard, never fallback
4. **Does this swallow errors?** Replace with explicit error propagation

**Acceptable fallback cases (rare):**

- User-facing defaults with explicit documentation (e.g., UI preferences)
- Well-documented configuration with safe defaults
- Feature flags where disabled is a valid state

**Unacceptable fallback cases:**

- Tests using default values instead of failing
- Silent error swallowing with `catch (e) {}` or `.ok()`
- `unwrap_or_default()` hiding missing data
- Optional chaining (`?.`) masking null/undefined errors in critical paths
- Default values hiding validation failures

**What to do:**

1. **Remove fallback** - Make the code fail explicitly
2. **Add validation** - Check preconditions and error if not met
3. **Propagate errors** - Use `Result`/`Option` properly, don't hide failures
4. **Fix tests** - Tests must use explicit assertions, no fallbacks

## Task 4: Framework Symmetry Violations

Check if implementations are out of sync:

### Compare framework implementations

For shared functionality that should exist across MVM/EVM/SVM:

1. Check if all three have equivalent implementations
2. Verify they use the same logic/algorithms
3. Ensure test coverage is symmetric (check extension-checklist.md files)

### What to do

- Add missing implementations to achieve symmetry
- Align logic across frameworks where appropriate
- Update extension-checklist.md to reflect current state

## Task 5: Documentation Debt

Find missing or outdated docs:

### Check for

- Functions without doc comments
- Modules without README files
- Outdated architecture diagrams
- Missing API documentation

### What to do

- Add doc comments to public functions
- Update outdated documentation
- Add examples where helpful

## Output Format

Provide a structured report:

### Section 1: Code Duplication

- **Location**: File paths where duplication exists
- **Pattern**: What is duplicated (function, logic, constants)
- **Recommendation**: Where to extract/consolidate
- **Estimated savings**: Lines of code that can be eliminated

### Section 2: TODO/FIXME Items

- **Location**: File path and line number
- **Context**: What needs to be done
- **Action**: Complete, remove, or create issue

### Section 3: Code Smells

- **Issue**: What the problem is
- **Location**: Where it occurs
- **Fix**: Suggested remediation

### Section 3a: Fallback Patterns (CRITICAL)

- **Location**: File path and line number
- **Pattern**: What fallback is used (unwrap_or, catch, optional chaining, etc.)
- **Context**: What it's hiding (error, validation failure, missing data)
- **Analysis**: Is this acceptable? (almost always NO)
- **Action**: How to remove the fallback and fail explicitly
- **Priority**: HIGH for tests, HIGH for critical paths, MEDIUM for edge cases

### Section 4: Framework Symmetry

- **Missing**: Features implemented in some frameworks but not others
- **Inconsistent**: Logic that differs unnecessarily
- **Recommendation**: How to achieve symmetry

### Section 5: Documentation Gaps

- **Missing**: What documentation is absent
- **Outdated**: What needs updating
- **Priority**: High/Medium/Low

## Important Notes

- Focus on **high-impact** duplication (code repeated 3+ times or >20 lines)
- Prioritize **active code paths** over rarely-used utilities
- Consider **framework differences** - not all "duplication" needs elimination if platforms differ
- **Don't over-abstract** - some duplication is acceptable if abstraction adds complexity
- Follow the "No Fallbacks Policy" - eliminate all TODOs and placeholders

## When to Run

- **End of every session** - Before wrapping up work
- **Before creating PRs** - Clean up tech debt before review
- **After major features** - Prevent accumulation of duplication
- **During refactoring** - Proactively identify improvement opportunities

Run this command regularly to keep the codebase clean and maintainable!
