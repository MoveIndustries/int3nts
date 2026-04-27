// Dummy stand-in for an LP/AMM module the fulfillment script composes
// with.
//
// In production a script would call into a real DEX. This module
// exists so the E2E test has an on-chain target to call into without
// pulling in any specific protocol. `add_liquidity` requires its
// inputs to share metadata (it merges via the FA framework rather
// than minting an LP token); `remove_liquidity` returns two equal
// halves of the same FA. The flow through the FA framework is faithful
// without token-issuer plumbing.
module dummy_protocols::dummy_lp {
    use aptos_framework::fungible_asset::{Self as fungible_asset, FungibleAsset};

    public fun add_liquidity(a: FungibleAsset, b: FungibleAsset): FungibleAsset {
        fungible_asset::merge(&mut a, b);
        a
    }

    public fun remove_liquidity(lp: FungibleAsset): (FungibleAsset, FungibleAsset) {
        let total = fungible_asset::amount(&lp);
        let half = fungible_asset::extract(&mut lp, total / 2);
        (half, lp)
    }
}
