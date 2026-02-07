---
description: Find and fix documentation debt including markdown linting errors, missing docs, and outdated content
---

# Documentation Debt Analysis and Fix

This command finds and fixes documentation debt including markdown linting errors, missing documentation, and outdated content.

## Common Linting Rules to Fix

### MD031: Fenced code blocks should be surrounded by blank lines

**Bad:** Code block immediately after text without blank line.

**Good:** Add blank line before and after code blocks.

### MD032: Lists should be surrounded by blank lines

**Bad:** List immediately after text without blank line.

**Good:** Add blank line before and after lists.

### MD024: Multiple headings with the same content

Each heading should be unique within a document. If you have duplicate headings, make them more specific.

### MD009: Trailing spaces

Remove trailing whitespace from lines.

### MD010: Hard tabs

Use spaces instead of tabs.

### MD012: Multiple consecutive blank lines

Use only single blank lines.

### MD022: Headings should be surrounded by blank lines

**Bad:** Heading immediately after text without blank line.

**Good:** Add blank line before and after headings.

### MD023: Headings must start at the beginning of the line

Don't indent headings.

### MD040: Fenced code blocks should have a language specified

**Bad:** Using just triple backticks without a language.

**Good:** Always specify a language after the opening backticks:

- `bash` for shell commands
- `text` for plain text output
- `markdown` for markdown examples
- `json` for JSON
- `typescript` or `ts` for TypeScript
- `javascript` or `js` for JavaScript
- `rust` for Rust
- `move` for Move
- `solidity` for Solidity

### MD047: Files should end with a single newline character

Ensure file ends with exactly one newline.

## Steps

**CRITICAL: You MUST find and check ALL markdown files. Do not check "several" or "representative" files.**

1. **Find ALL markdown files in the repo:**

   ```bash
   find . -name "*.md" -type f | grep -v node_modules | grep -v build | grep -v target
   ```

   Count the total number of files found and report this number.

2. **Scan ALL files for violations before fixing:**

   Use the markdown linting checker script:

   ```bash
   # Check for all violations with detailed output
   python3 .claude/scripts/check-md-lint.py

   # Check only for MD040 (missing language specifiers)
   python3 .claude/scripts/check-md-lint.py --check md040

   # List files with violations (no line numbers)
   python3 .claude/scripts/check-md-lint.py --list-files
   ```

   The script accurately detects:
   - MD040: Code blocks without language specifiers (opening ``` without language)
   - MD012: Multiple consecutive blank lines (3+ blank lines in a row)

   Count how many files have each type of violation from the summary output.

3. **For each file with violations:**

   - Read the file
   - Identify all linting issues (look for patterns that violate the rules above)
   - Fix ALL issues in the file
   - Move to the next file

4. **Focus on these patterns:**

   - Code blocks not surrounded by blank lines → add blank lines
   - Code blocks without language specifier (bare ``` on a line) → add appropriate language
   - Lists not surrounded by blank lines → add blank lines
   - Headings not surrounded by blank lines → add blank lines
   - Multiple consecutive blank lines → reduce to single
   - Trailing whitespace → remove
   - Missing final newline → add

5. **Process files systematically:**

   - Work through files in a logical order (e.g., alphabetically)
   - Track progress: "Fixed X of Y files"
   - Report all changes made to each file

6. **Final verification:**

   After fixing all files, re-run the grep searches to verify no violations remain.

## Important Notes

- Skip `node_modules/`, `build/`, `target/`, and other generated directories
- Don't change the semantic meaning of content
- Only fix formatting issues
- Report which files were fixed and what changes were made
