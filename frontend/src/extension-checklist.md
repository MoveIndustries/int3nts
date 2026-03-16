# Frontend Test Completeness

> Conventions, legend, and full index: [Checklist Guide](../../docs/checklist-guide.md)

## components/wallet/*vmWalletConnector.test.tsx

| # | Test | MVM | EVM | SVM |
| --- | ------ | ----- | ----- | ----- |
| 1 | should show connect button when disconnected | [ ] | [x] | [x] |
| 2 | should disable when no wallet is detected | [x] | [ ] | [ ] |
| 3 | should disable when no MetaMask connector is available | [ ] | [x] | [ ] |
| 4 | should disable when Phantom adapter is not detected | [ ] | [ ] | [x] |
| 5 | should call connect when clicking the connect button | [ ] | [x] | [ ] |
| 6 | should call select and connect on click | [ ] | [ ] | [x] |
| 7 | should show disconnect button when connected | [ ] | [x] | [x] |
| 8 | should show disconnect when connected | [x] | [ ] | [ ] |

## lib/*vm-transactions.test.ts

| # | Test | MVM | EVM | SVM |
| --- | ------ | ----- | ----- | ----- |
| 1 | should be a valid Move address | [x] | N/A | N/A |
| 2 | should convert hex string to Uint8Array | [x] | N/A | N/A |
| 3 | should handle 64-byte Ed25519 signature | [x] | N/A | N/A |
| 4 | should strip 0x prefix automatically | [x] | N/A | N/A |
| 5 | should return empty array for empty string | [x] | N/A | N/A |
| 6 | should pad 20-byte EVM address to 32 bytes | [x] | N/A | N/A |
| 7 | should handle address without 0x prefix | [x] | N/A | N/A |
| 8 | should normalize to lowercase | [x] | N/A | N/A |
| 9 | should remove 0x prefix | [x] | N/A | N/A |
| 10 | should return unchanged if no prefix | [x] | N/A | N/A |
| 11 | should use the configured SVM RPC URL | N/A | N/A | [x] |
| 12 | should decode base64 to bytes | N/A | N/A | [x] |
| 13 | should trim whitespace around base64 input | N/A | N/A | [x] |
| 14 | should return an instruction targeting the Ed25519 program | N/A | N/A | [x] |
| 15 | should return null when the request fails | N/A | N/A | [x] |
| 16 | should return null when the registry vec is empty | N/A | N/A | [x] |
| 17 | should return normalized hex when vec is a string | N/A | N/A | [x] |
| 18 | should convert vec byte array to hex | N/A | N/A | [x] |

## lib/*vm-escrow.test.ts

| # | Test | MVM | EVM | SVM |
| --- | ------ | ----- | ----- | ----- |
| 1 | should convert 0x-prefixed intent IDs to uint256 bigint | N/A | [x] | N/A |
| 2 | should convert non-prefixed intent IDs to uint256 bigint | N/A | [x] | N/A |
| 3 | should return a checksummed EVM address | N/A | [x] | N/A |
| 4 | should throw for missing chain config | N/A | [x] | N/A |
| 5 | should pad intent IDs to 32 bytes | N/A | N/A | [x] |
| 6 | should round-trip pubkey hex conversion | N/A | N/A | [x] |
| 7 | should derive deterministic state/escrow/vault PDAs | N/A | N/A | [x] |
| 8 | should parse escrow account data into a structured object | N/A | N/A | [x] |
| 9 | should build create escrow instruction with expected layout | N/A | N/A | [x] |
| 10 | should build claim instruction with sysvar and token program keys | N/A | N/A | [x] |
| 11 | should build cancel instruction with expected layout | N/A | N/A | [x] |
