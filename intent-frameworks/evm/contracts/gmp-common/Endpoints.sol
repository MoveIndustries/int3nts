// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title Endpoints
/// @notice LayerZero V2 Endpoint IDs (EIDs) for cross-chain communication
///
/// @dev EVM Architecture Note:
///      Unlike SVM and MVM which hardcode endpoint addresses for their respective
///      LayerZero integrations, EVM contracts receive the LayerZero endpoint address
///      at deployment time via constructor parameters. This is because:
///
///      1. LayerZero V2 is native to EVM - the protocol was built for EVM first
///      2. The LZ endpoint handles chain routing internally via ILayerZeroEndpointV2
///      3. Endpoint addresses vary by network (mainnet, testnet, local)
///
///      This file provides EID constants for reference and remote GMP endpoint configuration,
///      mirroring the structure of:
///      - SVM: gmp-common/src/endpoints.rs
///      - MVM: gmp_common/endpoints.move
library Endpoints {
    // ============================================================================
    // LAYERZERO V2 ENDPOINT IDS
    // ============================================================================

    // Solana
    uint32 constant SOLANA_MAINNET_EID = 30168;
    uint32 constant SOLANA_DEVNET_EID = 40168;

    // Movement
    uint32 constant MOVEMENT_MAINNET_EID = 30325;
    uint32 constant MOVEMENT_TESTNET_EID = 40325;

    // Ethereum
    uint32 constant ETHEREUM_MAINNET_EID = 30101;
    uint32 constant ETHEREUM_SEPOLIA_EID = 40161;

    // Base
    uint32 constant BASE_MAINNET_EID = 30184;
    uint32 constant BASE_SEPOLIA_EID = 40245;
}
