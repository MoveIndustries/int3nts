//! Update hub config on IntentInflowEscrow and IntentOutflowValidator
//!
//! Sets hubChainId and hubGmpEndpointAddr on both contracts via updateHubConfig().
//! Idempotent: skips if values already match.
//!
//! Required env vars:
//!   INFLOW_ESCROW_ADDR          - IntentInflowEscrow contract address
//!   OUTFLOW_VALIDATOR_ADDR      - IntentOutflowValidator contract address
//!   HUB_CHAIN_ID                - Hub chain ID (e.g., 250)
//!   MOVEMENT_INTENT_MODULE_ADDR - Movement module address (hex, 0x-prefixed)

const hre = require("hardhat");

async function main() {
  const inflowEscrowAddr = process.env.INFLOW_ESCROW_ADDR;
  const outflowValidatorAddr = process.env.OUTFLOW_VALIDATOR_ADDR;
  const hubChainId = parseInt(process.env.HUB_CHAIN_ID || "0");
  const movementModuleAddrHex = process.env.MOVEMENT_INTENT_MODULE_ADDR;

  if (!inflowEscrowAddr || !outflowValidatorAddr || !hubChainId || !movementModuleAddrHex) {
    throw new Error(
      "Missing required env vars: INFLOW_ESCROW_ADDR, OUTFLOW_VALIDATOR_ADDR, HUB_CHAIN_ID, MOVEMENT_INTENT_MODULE_ADDR"
    );
  }

  // Pad to 32 bytes
  let hubAddr = movementModuleAddrHex;
  if (!hubAddr.startsWith("0x")) {
    hubAddr = "0x" + hubAddr;
  }
  hubAddr = "0x" + hubAddr.slice(2).padStart(64, "0");

  const [deployer] = await hre.ethers.getSigners();
  console.log("Signer:", deployer.address);

  // Update IntentInflowEscrow
  const IntentInflowEscrow = await hre.ethers.getContractFactory("IntentInflowEscrow");
  const escrow = IntentInflowEscrow.attach(inflowEscrowAddr).connect(deployer);

  const currentEscrowHub = await escrow.hubGmpEndpointAddr();
  if (currentEscrowHub.toLowerCase() === hubAddr.toLowerCase()) {
    console.log("IntentInflowEscrow: hubGmpEndpointAddr already correct, skipping.");
  } else {
    console.log("IntentInflowEscrow: updating hubGmpEndpointAddr to", hubAddr);
    const tx1 = await escrow.updateHubConfig(hubChainId, hubAddr);
    await tx1.wait();
    console.log("IntentInflowEscrow: updated (tx:", tx1.hash + ")");
  }

  // Update IntentOutflowValidator
  const IntentOutflowValidator = await hre.ethers.getContractFactory("IntentOutflowValidator");
  const outflow = IntentOutflowValidator.attach(outflowValidatorAddr).connect(deployer);

  const currentOutflowHub = await outflow.hubGmpEndpointAddr();
  if (currentOutflowHub.toLowerCase() === hubAddr.toLowerCase()) {
    console.log("IntentOutflowValidator: hubGmpEndpointAddr already correct, skipping.");
  } else {
    console.log("IntentOutflowValidator: updating hubGmpEndpointAddr to", hubAddr);
    const tx2 = await outflow.updateHubConfig(hubChainId, hubAddr);
    await tx2.wait();
    console.log("IntentOutflowValidator: updated (tx:", tx2.hash + ")");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("FATAL:", error.message);
    process.exit(1);
  });
