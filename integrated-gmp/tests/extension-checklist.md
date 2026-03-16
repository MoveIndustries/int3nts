# Integrated GMP Test Completeness

> Conventions, legend, and full index: [Checklist Guide](../../docs/checklist-guide.md)

## *vm_tests.rs (module entrypoints)

| # | Test | MVM | EVM | SVM |
| --- | ------ | ----- | ----- | ----- |
| 1 | Module entrypoints only (no direct tests) | N/A | [x] | N/A |

## tests/*vm/config_tests.rs

| # | Test | MVM | EVM | SVM |
| --- | ------ | ----- | ----- | ----- |
| 1 | test_evm_chain_config_structure | N/A | [x] | N/A |
| 2 | test_connected_chain_evm_with_values | N/A | [x] | N/A |
| 3 | test_evm_config_serialization | N/A | [x] | N/A |
| 4 | test_evm_chain_config_with_all_fields | N/A | [x] | N/A |
| 5 | test_evm_config_loading | N/A | [x] | N/A |

## tests/*vm/escrow_parsing_tests.rs and tests/*vm_client_tests.rs

MVM client tests moved to `chain-clients/mvm/tests/mvm_client_hub_tests.rs`.
SVM escrow tests moved to `chain-clients/svm/tests/svm_client_tests.rs`.
See [chain-clients extension checklist](../../chain-clients/extension-checklist.md).
