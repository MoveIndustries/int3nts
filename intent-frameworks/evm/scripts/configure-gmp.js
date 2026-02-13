//! GMP endpoint post-deployment configuration
//!
//! Sets remote GMP endpoint address on IntentGmp contract. Use when the remote GMP endpoint
//! was not set during deployment or needs to be updated.
//!
//! Required env vars:
//!   GMP_ENDPOINT_ADDR     - IntentGmp contract address
//!   HUB_CHAIN_ID          - Hub chain ID (e.g., 250)
//!   MOVEMENT_INTENT_MODULE_ADDR - Movement module address (hex, 0x-prefixed)

const hre = require("hardhat");

async function main() {
  const gmpEndpointAddr = process.env.GMP_ENDPOINT_ADDR;
  const hubChainId = parseInt(process.env.HUB_CHAIN_ID || "0");
  const movementModuleAddrHex = process.env.MOVEMENT_INTENT_MODULE_ADDR;

  if (!gmpEndpointAddr || !hubChainId || !movementModuleAddrHex) {
    throw new Error(
      "Missing required env vars: GMP_ENDPOINT_ADDR, HUB_CHAIN_ID, MOVEMENT_INTENT_MODULE_ADDR"
    );
  }

  // Pad to 32 bytes
  let movementModuleAddr = movementModuleAddrHex;
  if (!movementModuleAddr.startsWith("0x")) {
    movementModuleAddr = "0x" + movementModuleAddr;
  }
  movementModuleAddr = "0x" + movementModuleAddr.slice(2).padStart(64, "0");

  const [deployer] = await hre.ethers.getSigners();
  console.log("Signer:", deployer.address);

  const IntentGmp = await hre.ethers.getContractFactory("IntentGmp");
  const gmpEndpoint = IntentGmp.attach(gmpEndpointAddr).connect(deployer);

  // Check current state — getRemoteGmpEndpointAddrs returns bytes32[]
  const currentRemotes = await gmpEndpoint.getRemoteGmpEndpointAddrs(hubChainId);
  console.log("Current remote GMP endpoint addresses for chain", hubChainId + ":", currentRemotes);

  if (
    currentRemotes.length === 1 &&
    currentRemotes[0].toLowerCase() === movementModuleAddr.toLowerCase()
  ) {
    console.log("Remote GMP endpoint address already set correctly, skipping.");
    return;
  }

  console.log("Setting remote GMP endpoint address for chain", hubChainId, "to", movementModuleAddr);
  const tx = await gmpEndpoint.setRemoteGmpEndpointAddr(hubChainId, movementModuleAddr);
  const receipt = await tx.wait();
  console.log("Transaction hash:", tx.hash);
  console.log("Block number:", receipt.blockNumber);

  // Wait for RPC node to index the new state
  await new Promise((resolve) => setTimeout(resolve, 5000));

  // Verify
  const newRemotes = await gmpEndpoint.getRemoteGmpEndpointAddrs(hubChainId);
  if (newRemotes.length !== 1 || newRemotes[0].toLowerCase() !== movementModuleAddr.toLowerCase()) {
    throw new Error(
      "Verification failed: remote GMP endpoint addresses are " + JSON.stringify(newRemotes) + ", expected [" + movementModuleAddr + "]"
    );
  }
  console.log("Verified: remote GMP endpoint address set to", newRemotes[0]);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("FATAL:", error.message);
    process.exit(1);
  });
