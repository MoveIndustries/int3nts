# Solver Test Completeness

> Conventions, legend, and full index: [Checklist Guide](../../docs/checklist-guide.md)

## module-entrypoints

MVM: `solver/tests/mvm_tests.rs`
EVM: `solver/tests/evm_tests.rs`
SVM: `solver/tests/svm_tests.rs`

| # | Test | MVM | EVM | SVM |
| --- | ------ | ----- | ----- | ----- |
| 1 | Module entrypoints only (no direct tests) | [x] | [x] | [x] |

## chain-client (solver-specific)

These tests cover solver-specific functionality: CLI fulfillment operations, command building, and Hardhat script mechanics. Query tests (balance, escrow state, address normalization) moved to [chain-clients](../../chain-clients/extension-checklist.md).

MVM: `solver/tests/mvm/chain_client_tests.rs`
EVM: `solver/tests/evm/chain_client_tests.rs`
SVM: `solver/tests/svm/chain_client_tests.rs`

| # | Test | MVM | EVM | SVM |
| --- | ------ | ----- | ----- | ----- |
| | **Client Initialization** | | | |
| 1 | test_client_new | [x] | [x] | [x] |
| 2 | test_client_new_rejects_invalid | N/A | N/A | [x] |
| | **Fulfillment Operations** | | | |
| 3 | test_get_escrow_events_success | N/A | X | X |
| 4 | test_get_escrow_events_empty | N/A | X | X |
| 5 | test_get_escrow_events_error | N/A | X | X |
| 6 | test_escrow_event_deserialization | N/A | N/A | N/A |
| 7 | test_fulfillment_id_formatting | [x] | [ ] | [ ] |
| 8 | test_fulfillment_signature_encoding | N/A | [ ] | N/A |
| 9 | test_fulfillment_command_building | [x] | [ ] | [ ] |
| 10 | test_fulfillment_error_handling | [ ] | [ ] | [x] |
| | **GMP Escrow State Querying** | | | |
| 11 | test_pubkey_from_hex_with_leading_zeros | N/A | N/A | X |
| 12 | test_pubkey_from_hex_no_leading_zeros | N/A | N/A | X |
| 13 | test_is_escrow_released_success | X | X | [x] |
| 14 | test_is_escrow_released_false | X | X | [x] |
| 15 | test_is_escrow_released_error | X | X | [x] |
| 25 | test_has_outflow_requirements_success | [x] | N/A | N/A |
| 26 | test_has_outflow_requirements_false | [x] | N/A | N/A |
| 27 | test_has_outflow_requirements_error | [x] | N/A | N/A |
| 28 | test_is_escrow_released_id_formatting | N/A | [x] | N/A |
| 29 | test_is_escrow_released_output_parsing | N/A | [x] | N/A |
| 30 | test_is_escrow_released_command_building | N/A | [x] | N/A |
| 31 | test_is_escrow_released_error_handling | N/A | [x] | N/A |
| | **Balance Queries** | | | |
| 16 | test_get_token_balance_success | X | X | [x] |
| 17 | test_get_token_balance_error | X | X | [x] |
| 18 | test_get_token_balance_zero | X | X | N/A |
| 19 | test_get_native_balance_success | N/A | X | [x] |
| 20 | test_get_native_balance_error | N/A | X | [x] |
| 32 | test_get_native_balance_exceeds_u64 | N/A | X | N/A |
| 33 | test_get_token_balance_with_padded_address | N/A | X | N/A |
| 34 | test_get_native_balance_with_padded_address | N/A | X | N/A |
| | **Address Normalization** | | | |
| 21 | test_normalize_hex_to_address_full_length | X | N/A | N/A |
| 22 | test_normalize_hex_to_address_short_address | X | N/A | N/A |
| 23 | test_normalize_hex_to_address_odd_length | X | N/A | N/A |
| 24 | test_normalize_hex_to_address_no_prefix | X | N/A | N/A |
| 35 | test_normalize_evm_address_padded | N/A | X | N/A |
| 36 | test_normalize_evm_address_passthrough | N/A | X | N/A |
| 37 | test_normalize_evm_address_rejects_non_zero_high_bytes | N/A | X | N/A |
