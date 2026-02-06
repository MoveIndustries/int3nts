//! GMP requirements query utility
//!
//! This script checks if IntentRequirements have been delivered via GMP.

const hre = require("hardhat");

/// Checks if requirements exist for an intent
///
/// # Environment Variables
/// - `ESCROW_GMP_ADDR`: IntentInflowEscrow contract address
/// - `INTENT_ID_EVM`: Intent ID in EVM format (bytes32, hex with 0x prefix)
///
/// # Returns
/// Outputs "hasRequirements: true" or "hasRequirements: false" on success.
async function main() {
  const escrowGmpAddress = process.env.ESCROW_GMP_ADDR;
  const intentIdHex = process.env.INTENT_ID_EVM;

  if (!escrowGmpAddress || !intentIdHex) {
    const error = new Error("Missing required environment variables: ESCROW_GMP_ADDR, INTENT_ID_EVM");
    console.error("Error:", error.message);
    if (require.main === module) {
      process.exit(1);
    }
    throw error;
  }

  const IntentInflowEscrow = await hre.ethers.getContractFactory("IntentInflowEscrow");
  const escrowGmp = IntentInflowEscrow.attach(escrowGmpAddress);

  // Ensure intentIdHex is properly formatted as bytes32
  let intentId = intentIdHex;
  if (!intentId.startsWith("0x")) {
    intentId = "0x" + intentId;
  }
  // Pad to 64 hex characters (32 bytes)
  intentId = "0x" + intentId.slice(2).padStart(64, '0');

  const hasReq = await escrowGmp.hasRequirements(intentId);
  console.log(`hasRequirements: ${hasReq}`);
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error("Error:", error.message);
      process.exit(1);
    });
}

module.exports = { main };
