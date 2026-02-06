# Move Intent Framework

Movement Move contracts for intents and escrows.

 **Full documentation: [docs/intent-frameworks/mvm](../docs/intent-frameworks/mvm/README.md)**

## Quick Start

```bash
# Run tests (all 3 packages)
nix develop ./nix -c bash -c "cd intent-frameworks/mvm/intent-gmp && movement move test --dev --named-addresses mvmt_intent=0x123"
nix develop ./nix -c bash -c "cd intent-frameworks/mvm/intent-hub && movement move test --dev --named-addresses mvmt_intent=0x123"
nix develop ./nix -c bash -c "cd intent-frameworks/mvm/intent-connected && movement move test --dev --named-addresses mvmt_intent=0x123"

# Enter development environment
nix develop ./nix
```
