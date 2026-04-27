// Dummy stand-in for a yield/farm module the fulfillment script
// composes with.
//
// In production a script would call into a real staking or yield
// venue. This module exists so the E2E test has an on-chain target
// to call into without pulling in any specific protocol. Both
// functions are no-op passthroughs that return the input FA unchanged.
module dummy_protocols::dummy_farm {
    use aptos_framework::fungible_asset::FungibleAsset;

    public fun stake(input: FungibleAsset): FungibleAsset {
        input
    }

    public fun unstake(input: FungibleAsset): FungibleAsset {
        input
    }
}
