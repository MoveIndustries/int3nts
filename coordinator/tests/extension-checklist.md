# Coordinator Test Completeness

> Conventions, legend, and full index: [Checklist Guide](../../docs/checklist-guide.md)

The coordinator is a read-only service that monitors hub chain events and provides negotiation routing. It does NOT perform validation or cryptographic signing — those functions are in the **Integrated GMP** service.

The coordinator has no VM-specific tests. It monitors only the hub chain (Move VM) and provides chain-agnostic negotiation routing. VM-specific chain client tests are in `chain-clients/` — see [chain-clients extension checklist](../../chain-clients/extension-checklist.md).
