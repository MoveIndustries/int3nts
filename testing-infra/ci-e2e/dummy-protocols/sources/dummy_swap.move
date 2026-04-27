// Dummy stand-in for a swap module the fulfillment script composes with.
//
// In production a script would call into a real DEX (e.g. a CLMM on
// M1). This module exists so the E2E test has an on-chain target to
// call into without pulling in any specific protocol. Implementation
// is a no-op passthrough: returns the input FA unchanged.
module dummy_protocols::dummy_swap {
    use aptos_framework::fungible_asset::FungibleAsset;

    public fun swap(input: FungibleAsset): FungibleAsset {
        input
    }
}
