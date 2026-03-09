# Future Work

## Testing

1. **Test Improvements**
   - Add timeout scenario tests
   - Test with multiple concurrent intents (unit tests in `coordinator/tests/monitor_tests.rs`, `integrated-gmp/tests/monitor_tests.rs`)
   - Add negative test cases (rejected intents, failed fulfillments)

## Naming Consistency

- Align entity names across VMs (MVM, EVM, SVM) and E2E test scripts
- Current inconsistencies: `approver_evm_pubkey_hash` vs `relay address`, `APPROVER_ADDR` vs `RELAY_ETH_ADDRESS`, Hardhat account indices vs Aptos profiles vs Solana key-pair files
- Define canonical role names (deployer, requester, solver, relay) and use them consistently in configs, scripts, variable names, and log messages

## Documentation

1. Finalize node bootstrapping instructions (ports, genesis, module publish) for both chains
2. Add more comprehensive API documentation
3. Add troubleshooting guide for common issues

## Move-intent-framework

- Add more intent types and use cases
- Optimize gas costs

## Chain-Clients Extraction

1. **Solver SVM sync→async migration**
   - Solver's `ConnectedSvmClient` keeps its own sync `RpcClient` methods for `is_escrow_released`, `get_token_balance`, `get_native_balance` instead of delegating to the shared async `SvmClient`
   - MVM and EVM solver clients delegate these calls to the shared client; SVM does not (asymmetry)
   - Refactor to delegate via blocking async wrapper, then mark solver tests #13-20 as X (moved to chain-clients/svm)

2. **Integrated-GMP SVM client extraction (step 7)**
   - `integrated-gmp/src/svm_client.rs` still has a full custom `SvmClient` with GMP-specific methods (`get_raw_account_data`, `get_outbound_nonce`, `get_message_data`)
   - Refactor to wrap the shared `chain_clients_svm::SvmClient` and add GMP-specific methods on top

## Coordinator & Integrated-GMP

1. **Performance Testing**
   - Load testing coordinator and integrated-gmp APIs
   - Stress testing coordinator event monitoring
   - Memory usage monitoring (both services)

2. **Validation Hardening (Integrated-GMP)**
   - Add metadata and timeout checks
   - Support multiple concurrent intents robustly
   - Improve error handling and reporting

3. **Event Discovery Improvements (Coordinator)**
   - Currently polls known accounts via `/v1/accounts/{address}/transactions`
   - Incomplete coverage (misses unlisted accounts)
   - Manual configuration (requires prelisting emitters)
   - Not scalable (unsuitable for many users)
   - Consider using event streams or indexer integration

4. **Feature Enhancements**
   - Add "ok" endpoint for a given `intent_id` to signal escrow is satisfied so solver can commit on hub (integrated-gmp)
   - Add support for more chain types (coordinator + integrated-gmp)
   - Add metrics and observability (both services)
