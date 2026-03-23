---
description: Review staged changes by asking critical questions before committing
---

# Review Me on These Changes

Interactive review session where Claude asks critical questions about your staged changes before you commit.

## Step 1: Analyze Staged Changes

Read what's being changed:

```bash
git status
git diff --cached --stat
git diff --cached
```

Understand:

- What files changed?
- What functionality is affected?
- Which frameworks (MVM/EVM/SVM)?
- Are tests involved?

## Step 1b: Verify Extension Checklists (AUTOMATED - DO NOT SKIP)

If any test files were added, removed, or modified:

1. Find the relevant `extension-checklist.md` for the component (e.g., `integrated-gmp/tests/extension-checklist.md`, `chain-clients/extension-checklist.md`, `solver/tests/extension-checklist.md`)
2. Read the checklist file
3. Compare it against the actual test functions in the changed test files
4. **FAIL immediately** if:
   - A new test file exists that is not listed in the checklist
   - Tests were added/removed but the checklist was not updated
   - Test numbering in the checklist doesn't match the code
   - Section headers in test files don't appear in the checklist

This is not a question to ask the user — verify it yourself by reading the files.

## Step 2: Investigate (DO NOT ASK THE USER — READ THE CODE)

For each category below, **read the relevant source files yourself** and report what you found. Only ask the user about things you genuinely cannot determine from the code (e.g., intent behind a design choice, external context).

### Completeness

- Check whether the change applies to all relevant frameworks (MVM/EVM/SVM). Read the equivalent files in sibling frameworks.
- Identify related files that should also be updated but weren't.

### Testing

- Check whether new functions or changed behavior have corresponding tests.
- Verify tests cover happy path, edge cases, and error conditions.
- Read the test files and verify they follow format rules (Rule 10-11 from codestyle-testing.md).
- Check for magic numbers — grep the test files for hardcoded values that should be constants.
- Verify tests are hard failures (no TODOs used as assertions, no fallbacks).

### Code Quality

- Read the changed code and surrounding context. Identify edge cases the code handles or misses.
- Check for code duplication by reading related files.
- Verify variable names follow conventions (_addr suffix, etc.).
- If the change adds a check or validation, read the equivalent code in related components to verify consistency.

### Documentation

- Check whether relevant README files need updates.
- Check whether public functions are documented.
- **If markdown files changed**: Read them and check that all code blocks have language specifiers (no bare ` ``` `).

### Symmetry (for framework changes)

- Read the equivalent implementations across frameworks. Report whether they are consistent.
- Verify test numbering matches across frameworks by reading the actual test files.

## Step 3: Report Findings

Present your findings organized as:

- **Issues**: Concrete problems found (with file paths and line numbers)
- **Questions**: Things you genuinely could not determine from the code alone — ask these sparingly
- **Observations**: Non-blocking notes worth mentioning

## Step 4: Pass/Fail Decision

**Pass criteria:**

- No issues found during investigation
- Tests cover the changed behavior
- Documentation is updated
- Framework symmetry maintained (if applicable)

**Fail criteria:**

- New functions/features without tests
- Missing tests for changed functionality
- Incomplete implementation
- Framework asymmetry not justified
- Code inconsistency with related components

## Output Format

Start with:

```text
🔍 REVIEWING YOUR CHANGES

I found changes to:
- [list key files/areas]

Investigating...
```

Then present findings (issues, questions, observations).

End with either:

```text
✅ PASS - These changes look good. Ready to commit.
```

or:

```text
❌ FAIL - Fix these issues before committing:
- [list issues]
```

## Important Notes

- **Do the work yourself.** If a question can be answered by reading the code, read the code. Only ask the user about intent, external context, or design rationale that isn't in the codebase.
- Be thorough but not pedantic
- Focus on high-impact issues
- Challenge but don't block unnecessarily
- Consider project-specific patterns (No Fallbacks Policy, etc.)
