# SDK Test Completeness

> Conventions, legend, and full index: [Checklist Guide](../../../docs/checklist-guide.md)

For the Rust chain-clients equivalent, see [`chain-clients/extension-checklist.md`](../../../chain-clients/extension-checklist.md).

## tests/chains/{evm,svm,mvm}.test.ts

| # | Test | MVM | EVM | SVM |
| --- | ------ | ----- | ----- | ----- |
| | **Intent ID Conversion (EVM)** | | | |
| 1 | Intent ID conversion with 0x prefix | N/A | [x] | N/A |
| 2 | Intent ID conversion without prefix | N/A | [x] | N/A |
| 3 | Short intent IDs zero-padded | N/A | [x] | N/A |
| | **Escrow Address (EVM)** | | | |
| 4 | Escrow address checksum normalization | N/A | [x] | N/A |
| | **Address Helpers (SVM)** | | | |
| 5 | Intent ID padding to 32 bytes | N/A | N/A | [x] |
| 6 | Public key hex round-trip | N/A | N/A | [x] |
| | **PDA Helpers (SVM)** | | | |
| 7 | PDA determinism (state/escrow/vault) | N/A | N/A | [x] |
| | **Account Parsing (SVM)** | | | |
| 8 | Escrow account parsing | N/A | N/A | [x] |
| | **Instruction Builders (SVM)** | | | |
| 9 | CreateEscrow instruction layout | N/A | N/A | [x] |
| 10 | Claim instruction layout | N/A | N/A | [x] |
| 11 | Cancel instruction layout | N/A | N/A | [x] |
| | **Query Helpers** | | | |
| 12 | checkHasRequirements success | [ ] | [ ] | [ ] |
| 13 | checkHasRequirements false | [ ] | [ ] | [ ] |
| 14 | checkHasRequirements error | [ ] | [ ] | [ ] |
| 15 | checkIsFulfilled success | N/A | [ ] | [ ] |
| 16 | checkIsFulfilled false | N/A | [ ] | [ ] |
| 17 | checkIsFulfilled error | N/A | [ ] | [ ] |

## tests/chains/svm-transactions.test.ts

| # | Test | MVM | EVM | SVM |
| --- | ------ | ----- | ----- | ----- |
| | **Connection** | | | |
| 1 | RPC selection | N/A | N/A | [x] |
| | **Helpers** | | | |
| 2 | Base64 decoding | N/A | N/A | [x] |
| 3 | Whitespace handling in base64 | N/A | N/A | [x] |
| 4 | Ed25519 instruction builder | N/A | N/A | [x] |
| | **Registry Query** | | | |
| 5 | Failed RPC request returns null | N/A | N/A | [x] |
| 6 | Empty registry entry returns null | N/A | N/A | [x] |
| 7 | String address normalization | N/A | N/A | [x] |
| 8 | Byte array address conversion | N/A | N/A | [x] |

## tests/chains/intent-{evm,svm,mvm}.test.ts

| # | Test | MVM | EVM | SVM |
| --- | ------ | ----- | ----- | ----- |
| | **buildIntentArguments** | | | |
| 1 | Builds inflow arguments | [ ] | [x] | [ ] |
| 2 | Builds outflow arguments | [ ] | [x] | [ ] |
| 3 | Throws when solver lacks chain address | [ ] | [x] | [ ] |
