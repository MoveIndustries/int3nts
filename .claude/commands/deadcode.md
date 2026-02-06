---
description: Find and eliminate dead code including unused functions, stale references, and abandoned implementations
---

# Dead Code Analysis

Systematically scan the codebase for dead code across all languages and components. For each finding, assess whether it's still needed.

## Strategy

Launch parallel agents to scan each language/component concurrently for maximum speed.

## Task 1: Rust Dead Code (coordinator, trusted-gmp, solver, intent-frameworks/svm)

Search for:

1. **`#[allow(dead_code)]` annotations** - Read each one and determine if the code is actually used anywhere (cross-crate calls, tests, re-exports)
2. **Unused public functions** - Functions defined as `pub` but never called outside their module
3. **Unused struct fields** - Fields that are never read after construction
4. **Unused imports** - `use` statements and `#[allow(unused_imports)]`
5. **Commented-out code blocks** - Blocks of code commented out with `//` or `/* */`
6. **TODO/FIXME markers indicating abandoned work** - Incomplete implementations that were never finished
7. **Duplicate code between coordinator and trusted-gmp** - These crates share similar MVM/EVM/SVM client code; check for identical functions that could be consolidated
8. **Test helpers marked `#[allow(dead_code)]`** - Verify each is actually called from at least one test

### How to check if a function is truly dead

- Search for the function name across the entire repo (not just the defining crate)
- Check if it's re-exported via `pub use` in a `mod.rs`
- Check if it's called from tests in a separate `tests/` directory
- Check if it's part of a trait implementation (required even if not directly called)

## Task 2: Move Dead Code (intent-frameworks/mvm)

Search for:

1. **Functions never called** - `public fun` or `fun` definitions not referenced from other modules or tests
2. **Unused structs** - Struct definitions not used in any function signature or storage
3. **Unused constants** - Constants defined but never referenced
4. **Unused friend declarations** - `friend` declarations where the friend module never calls privileged functions
5. **Stub functions** - Functions with empty bodies, just `abort`, or TODO comments
6. **Unused `use` imports** - Module imports not referenced

### How to check

- Search for the function/struct/constant name across all `.move` files
- Check test files in `tests/` directories
- Verify friend modules actually use their friend access

## Task 3: Solidity/EVM Dead Code (intent-frameworks/evm)

Search for:

1. **Unused error definitions** - `error` declarations never used in `revert`
2. **Unused events** - `event` declarations never `emit`ted
3. **Unused state variables** - Variables never read after being set
4. **Unused internal/private functions** - Functions not called within the contract
5. **Unused modifiers** - Modifiers defined but never applied
6. **Unused imports** - OpenZeppelin or other imports not used

Also check JavaScript/TypeScript test and script files:

- Unused helper functions
- Commented-out test cases
- Unused imports

## Task 4: Frontend Dead Code (frontend)

Search for:

1. **Unused components** - React components never imported/rendered
2. **Unused hooks** - Custom hooks never called
3. **Unused utility functions** - Helper functions never imported
4. **Unused types/interfaces** - TypeScript types never referenced
5. **Unused CSS classes** - Styles not applied to any element
6. **Dead routes** - Routes defined but not navigable

## Task 5: Scripts and Infrastructure

Search for:

1. **Unused scripts** - Shell scripts in `scripts/`, `testing-infra/` not called from CI, other scripts, or docs
2. **Stale documentation references** - Docs referencing old file paths, renamed directories, or removed features
3. **Unused configuration** - Config files or config keys not referenced

## Output Format

Provide a structured report with three priority levels:

### RED - Remove (confirmed dead code)

| # | Location | What | Why it's dead | Action |
|---|----------|------|---------------|--------|
| 1 | `file:line` | description | evidence | Remove |

### YELLOW - Review (possibly dead, needs decision)

| # | Location | What | Context | Recommendation |
|---|----------|------|---------|----------------|
| 1 | `file:line` | description | why it might still be needed | Keep/Remove/Track |

### GREEN - Intentional (marked dead but actually needed)

| Category | Details |
|----------|---------|
| Deserialization structs | ... |
| Test helpers | ... |

### Stale Documentation

| File | Issue | Fix |
|------|-------|-----|
| `path` | what's wrong | what to update |

### Incomplete TODOs

| Location | TODO text | Status |
|----------|-----------|--------|
| `file:line` | what it says | whether it's still relevant |

## Important Notes

- **Cross-crate/cross-module references**: Always search the ENTIRE repo before declaring something dead
- **Trait implementations**: Required methods are not dead even if never directly called
- **Deserialization fields**: Struct fields used for JSON/borsh deserialization are needed even if never read in code
- **Re-exports for tests**: `pub use` in `mod.rs` files may exist solely for test access
- **Entry points**: `main()`, `#[program]`, `entry fun`, contract constructors are not dead
- **Don't count underscore-prefixed params as dead** - These are intentionally unused per language conventions
- **Don't count `let _ = expr;` as dead** - These are intentional value suppressions
