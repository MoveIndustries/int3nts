# Relay Deauthorization

Procedures for removing a relay from the GMP endpoint registries on all three chain types. All deauthorization calls are admin-only.

## MVM (Hub and Connected Chains)

Each MVM chain (hub + each connected MVM chain) has its own `intent_gmp` module with an independent `authorized_relays` vector.

### Remove a relay

```bash
# Hub chain
movement move run \
  --function-id '<hub_addr>::intent_gmp::remove_relay' \
  --args 'address:<relay_mvm_addr>' \
  --profile <admin_profile>

# Each connected MVM chain (repeat per chain)
movement move run \
  --function-id '<connected_addr>::intent_gmp::remove_relay' \
  --args 'address:<relay_mvm_addr>' \
  --profile <admin_profile>
```

### Verify

```bash
movement move view \
  --function-id '<addr>::intent_gmp::is_relay_authorized' \
  --args 'address:<relay_mvm_addr>'
```

Returns `false` after removal.

## EVM

Each EVM chain has an `IntentGmp` contract with a `mapping(address => bool) authorizedRelays`.

### Remove a relay

```bash
cast send <IntentGmp_address> \
  'removeRelay(address)' \
  <relay_evm_addr> \
  --private-key <owner_private_key> \
  --rpc-url <rpc_url>
```

Emits a `RelayRemoved(address)` event. Reverts with `E_NOT_FOUND()` if the relay is not currently authorized.

### Verify

```bash
cast call <IntentGmp_address> \
  'isRelayAuthorized(address)(bool)' \
  <relay_evm_addr> \
  --rpc-url <rpc_url>
```

Returns `false` after removal.

## SVM

Each SVM chain has an `intent-gmp` program with a PDA-based `RelayAccount` per relay.

### Remove a relay

```bash
intent_escrow_cli gmp-remove-relay \
  --relay <relay_svm_pubkey> \
  --admin <admin_keypair_path>
```

Sets `relay_data.is_authorized = false` on the relay's PDA. The PDA account remains but the relay cannot deliver messages.

### Verify

Check the relay PDA's `is_authorized` field. The `process_deliver_message` instruction rejects deliveries from deauthorized relays.

## All-chain deauthorization checklist

When deauthorizing a relay across all chains:

- [ ] MVM hub: `remove_relay` called, `is_relay_authorized` returns `false`
- [ ] Each connected MVM chain: same
- [ ] Each EVM chain: `removeRelay` called, `isRelayAuthorized` returns `false`
- [ ] Each SVM chain: `gmp-remove-relay` called, relay PDA shows `is_authorized = false`
- [ ] Integrated-GMP service stopped or restarted with new relay keys (see [key-rotation.md](key-rotation.md))
- [ ] Remaining authorized relays confirmed operational (test a GMP delivery end-to-end)
