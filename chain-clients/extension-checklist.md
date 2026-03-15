# Chain Clients Test Completeness

> Conventions, legend, and full index: [Checklist Guide](../docs/checklist-guide.md)

Hub-only tests are NOT tracked in this checklist. The hub is always MVM — there is no VM symmetry to enforce. Hub tests live in `mvm/tests/mvm_client_hub_tests.rs` with their own independent numbering.

## {mvm,evm,svm}/tests/*_client_tests.rs

| # | Test | MVM | EVM | SVM |
| --- | ------ | ----- | ----- | ----- |
| | **Client Initialization** | | | |
| 1 | test_client_new | [x] | [x] | [x] |
| 2 | test_client_new_rejects_invalid | N/A | N/A | [x] |
| | **Escrow Release Check** | | | |
| 3 | test_is_escrow_released_success | [x] | [x] | [x] |
| 4 | test_is_escrow_released_false | [x] | [x] | [x] |
| 5 | test_is_escrow_released_error | [x] | [x] | [x] |
| | **Balance Queries** | | | |
| 6 | test_get_token_balance_success | [x] | [x] | [x] |
| 7 | test_get_token_balance_error | [x] | [x] | [x] |
| 8 | test_get_token_balance_zero | [x] | [x] | N/A |
| 9 | test_get_native_balance_success | N/A | [x] | [x] |
| 10 | test_get_native_balance_error | N/A | [x] | [x] |
| 11 | test_get_native_balance_exceeds_u64 | N/A | [x] | N/A |
| 12 | test_get_token_balance_with_padded_address | N/A | [x] | N/A |
| 13 | test_get_native_balance_with_padded_address | N/A | [x] | N/A |
| | **Escrow Event Parsing** | | | |
| 14 | test_get_escrow_events_success | N/A | [x] | [x] |
| 15 | test_get_escrow_events_empty | N/A | [x] | [x] |
| 16 | test_get_escrow_events_error | N/A | [x] | [x] |
| 17 | test_get_all_escrows_parses_program_accounts | N/A | N/A | [x] |
| | **Address Normalization** | | | |
| 18 | test_normalize_hex_to_address_full_length | [x] | N/A | N/A |
| 19 | test_normalize_hex_to_address_short_address | [x] | N/A | N/A |
| 20 | test_normalize_hex_to_address_odd_length | [x] | N/A | N/A |
| 21 | test_normalize_hex_to_address_no_prefix | [x] | N/A | N/A |
| 22 | test_normalize_evm_address_padded | N/A | [x] | N/A |
| 23 | test_normalize_evm_address_passthrough | N/A | [x] | N/A |
| 24 | test_normalize_evm_address_rejects_non_zero_high_bytes | N/A | [x] | N/A |
| 25 | test_pubkey_from_hex_with_leading_zeros | N/A | N/A | [x] |
| 26 | test_pubkey_from_hex_no_leading_zeros | N/A | N/A | [x] |
| | **Escrow Account Parsing (SVM-specific)** | | | |
| 27 | test_escrow_account_borsh_roundtrip | N/A | N/A | [x] |
| 28 | test_escrow_account_invalid_base64 | N/A | N/A | [x] |
