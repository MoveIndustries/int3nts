# Extension Checklist Guide

Extension checklists track test alignment status across VM frameworks (EVM/SVM/MVM). Each component has its own checklist in its test directory.

For the full framework extension process, see the [Framework Extension Guide](intent-frameworks/framework-extension-guide.md).

## Conventions

- **All tests are VM-specific.** Generic tests are intentionally excluded because they are not relevant when integrating a new VM.
- **Each test file uses independent numbering starting from 1.** At the end of the implementation, check that all tests are numbered correctly and match the checklist.
- **When adding a new framework, ensure maximal completeness** by implementing all tests listed in the relevant checklist.
- **Section headers from test files must appear in the checklist.** Test files use `// ====` section headers to group test functions. These headers must be listed as inline header rows in the checklist table (bold text, empty status cells). This keeps the checklist in sync with the code structure.
- **When adding a test to one VM, update all VMs.** There are two cases:
  - **A) Test belongs in an existing category.** (1) Add the test at the correct position within the category. (2) Renumber all subsequent tests in that VM's test file. (3) Update the extension checklist row numbers to match. (4) Renumber the corresponding test files for all other VMs so numbering stays in sync. (5) Add a numbered TODO or N/A comment placeholder at the correct position in every other VM's test file.
  - **B) Test creates a new category.** (1) Add the test at the end of the file with a new `// ====` section header. (2) Add a row to the extension checklist with a bold section header row and the test row with status for all VMs. (3) Add the `// ====` section header and a numbered TODO or N/A comment placeholder in every other VM's test file.
  - In both cases, use `N/A` only when the test is structurally impossible on a platform (e.g., EVM allowance pattern doesn't exist in SVM), not when implementation is simply deferred — use `[ ]` for that.
  - Placeholder formats:

    ```rust
    /// 2. Test: Insufficient Allowance Rejection
    /// NOTE: N/A for SVM - SPL tokens don't use approve/allowance pattern
    ```

    ```javascript
    // #3: TODO test_handle_maximum_u64_value_in_create_escrow — not yet implemented for EVM
    ```

- **Test file naming must be symmetrical across VMs.** Checklist headers use `*vm` wildcards (e.g., `tests/*vm_client_tests.rs`). Each VM that has applicable tests must have a corresponding file (e.g., `mvm_client_tests.rs`, `evm_client_tests.rs`). VMs where all tests are N/A still need a file with comment placeholders explaining why.

## Legend

| Symbol | Meaning |
| --- | --- |
| [x] | Implemented |
| [ ] | Not yet implemented |
| N/A | Not applicable to platform |
| X | Moved to another component (see link in checklist) |

## Checklist Index

| Component | Checklist |
| --- | --- |
| VM Intent Frameworks | [`intent-frameworks/extension-checklist.md`](../intent-frameworks/extension-checklist.md) |
| Chain Clients | [`chain-clients/extension-checklist.md`](../chain-clients/extension-checklist.md) |
| Coordinator | [`coordinator/tests/extension-checklist.md`](../coordinator/tests/extension-checklist.md) |
| Integrated GMP | [`integrated-gmp/tests/extension-checklist.md`](../integrated-gmp/tests/extension-checklist.md) |
| Solver | [`solver/tests/extension-checklist.md`](../solver/tests/extension-checklist.md) |
| SDK | [`packages/sdk/tests/extension-checklist.md`](../packages/sdk/tests/extension-checklist.md) |
| Frontend | [`frontend/src/extension-checklist.md`](../frontend/src/extension-checklist.md) |
