//! GMP contract deployment utility
//!
//! This script deploys all GMP-related contracts: IntentGmp, IntentInflowEscrow, IntentOutflowValidator.
//! Configures trusted remotes and message routing for cross-chain communication.

const hre = require("hardhat");

/// Deploys all GMP contracts and configures routing
///
/// # Environment Variables
/// - `HUB_CHAIN_ID`: Hub chain endpoint ID (default: 1)
/// - `TRUSTED_HUB_ADDR`: Trusted hub address in 32-byte hex format (required)
/// - `RELAY_ADDRESS`: Optional relay address to authorize (defaults to deployer)
///
/// # Returns
/// Outputs deployed contract addresses and configuration status.
async function main() {
  console.log("Deploying GMP Contracts...");
  console.log("==========================");

  // Get signers
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying with account:", deployer.address);

  // Configuration
  const hubChainId = parseInt(process.env.HUB_CHAIN_ID || "1");
  const trustedHubAddrHex = process.env.TRUSTED_HUB_ADDR;
  const relayAddress = process.env.RELAY_ADDRESS || deployer.address;

  if (!trustedHubAddrHex) {
    throw new Error("TRUSTED_HUB_ADDR environment variable required (32-byte hex, 0x-prefixed)");
  }

  // Convert trusted hub address to bytes32
  let trustedHubAddr = trustedHubAddrHex;
  if (!trustedHubAddr.startsWith("0x")) {
    trustedHubAddr = "0x" + trustedHubAddr;
  }
  // Pad to 64 hex characters (32 bytes)
  trustedHubAddr = "0x" + trustedHubAddr.slice(2).padStart(64, '0');

  console.log("\nConfiguration:");
  console.log("  Hub Chain ID:", hubChainId);
  console.log("  Trusted Hub Address:", trustedHubAddr);
  console.log("  Relay Address:", relayAddress);

  // Deploy IntentGmp
  console.log("\n1. Deploying IntentGmp...");
  const IntentGmp = await hre.ethers.getContractFactory("IntentGmp");
  const gmpEndpoint = await IntentGmp.deploy(deployer.address);
  await gmpEndpoint.waitForDeployment();
  const gmpEndpointAddress = await gmpEndpoint.getAddress();
  console.log("   IntentGmp deployed to:", gmpEndpointAddress);

  // Deploy IntentInflowEscrow
  console.log("\n2. Deploying IntentInflowEscrow...");
  const IntentInflowEscrow = await hre.ethers.getContractFactory("IntentInflowEscrow");
  const escrowGmp = await IntentInflowEscrow.deploy(
    deployer.address,
    gmpEndpointAddress,
    hubChainId,
    trustedHubAddr
  );
  await escrowGmp.waitForDeployment();
  const escrowGmpAddress = await escrowGmp.getAddress();
  console.log("   IntentInflowEscrow deployed to:", escrowGmpAddress);

  // Deploy IntentOutflowValidator
  console.log("\n3. Deploying IntentOutflowValidator...");
  const IntentOutflowValidator = await hre.ethers.getContractFactory("IntentOutflowValidator");
  const outflowValidator = await IntentOutflowValidator.deploy(
    deployer.address,
    gmpEndpointAddress,
    hubChainId,
    trustedHubAddr
  );
  await outflowValidator.waitForDeployment();
  const outflowValidatorAddress = await outflowValidator.getAddress();
  console.log("   IntentOutflowValidator deployed to:", outflowValidatorAddress);

  // Configure GMP endpoint
  console.log("\n4. Configuring GMP endpoint...");

  // Set escrow handler
  console.log("   Setting escrow handler...");
  await gmpEndpoint.setEscrowHandler(escrowGmpAddress);
  console.log("   Escrow handler set to:", escrowGmpAddress);

  // Set outflow handler
  console.log("   Setting outflow handler...");
  await gmpEndpoint.setOutflowHandler(outflowValidatorAddress);
  console.log("   Outflow handler set to:", outflowValidatorAddress);

  // Set trusted remote for hub chain
  console.log("   Setting trusted remote for hub chain...");
  await gmpEndpoint.setTrustedRemote(hubChainId, trustedHubAddr);
  console.log("   Trusted remote set for chain", hubChainId);

  // Add relay if different from deployer
  if (relayAddress.toLowerCase() !== deployer.address.toLowerCase()) {
    console.log("   Adding authorized relay...");
    await gmpEndpoint.addRelay(relayAddress);
    console.log("   Relay added:", relayAddress);
  } else {
    console.log("   Deployer is already authorized as relay");
  }

  // Wait for RPC indexing
  console.log("\nWaiting for RPC indexing...");
  await new Promise(r => setTimeout(r, 3000));

  // Verify configuration
  console.log("\n5. Verifying configuration...");
  const escrowHandler = await gmpEndpoint.escrowHandler();
  const outflowHandler = await gmpEndpoint.outflowHandler();
  const isRelayAuthorized = await gmpEndpoint.isRelayAuthorized(relayAddress);
  const hasTrustedRemote = await gmpEndpoint.hasTrustedRemote(hubChainId);

  console.log("   Escrow handler:", escrowHandler);
  console.log("   Outflow handler:", outflowHandler);
  console.log("   Relay authorized:", isRelayAuthorized);
  console.log("   Has trusted remote for hub:", hasTrustedRemote);

  if (escrowHandler.toLowerCase() !== escrowGmpAddress.toLowerCase()) {
    throw new Error("Escrow handler mismatch!");
  }
  if (outflowHandler.toLowerCase() !== outflowValidatorAddress.toLowerCase()) {
    throw new Error("Outflow handler mismatch!");
  }

  // Summary
  console.log("\n========================================");
  console.log("GMP DEPLOYMENT SUCCESSFUL!");
  console.log("========================================");
  console.log("\nDeployed Contracts:");
  console.log("  IntentGmp:", gmpEndpointAddress);
  console.log("  IntentInflowEscrow:", escrowGmpAddress);
  console.log("  IntentOutflowValidator:", outflowValidatorAddress);
  console.log("\nConfiguration:");
  console.log("  Hub Chain ID:", hubChainId);
  console.log("  Trusted Hub Address:", trustedHubAddr);
  console.log("  Relay Address:", relayAddress);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
