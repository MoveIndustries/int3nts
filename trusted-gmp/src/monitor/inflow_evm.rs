//! Inflow EVM-specific monitoring functions
//!
//! This module contains EVM-specific event polling logic
//! for escrow events on connected EVM chains.

use crate::config::Config;
use crate::evm_client::EvmClient;
use crate::monitor::generic::{ChainType, EscrowEvent};
use anyhow::{Context, Result};

/// Polls the EVM connected chain for new EscrowCreated events.
///
/// This function queries the EVM chain's event logs for EscrowCreated events
/// emitted by the IntentInflowEscrow contract. It converts them to EscrowEvent format
/// for consistent processing.
///
/// # Arguments
///
/// * `config` - Service configuration
///
/// # Returns
///
/// * `Ok(Vec<EscrowEvent>)` - List of new escrow events
/// * `Err(anyhow::Error)` - Failed to poll events
pub async fn poll_evm_escrow_events(config: &Config) -> Result<Vec<EscrowEvent>> {
    let connected_chain_evm = config
        .connected_chain_evm
        .as_ref()
        .ok_or_else(|| anyhow::anyhow!("No connected EVM chain configured"))?;

    // Create EVM client for connected chain
    let client = EvmClient::new(
        &connected_chain_evm.rpc_url,
        &connected_chain_evm.escrow_contract_addr,
    )
    .context(format!(
        "Failed to create EVM client for RPC URL: {}",
        connected_chain_evm.rpc_url
    ))?;

    // Get current block number to track progress
    let current_block = client.get_block_number().await.context(format!(
        "Failed to get block number from EVM chain at {}",
        connected_chain_evm.rpc_url
    ))?;

    // Get current block number to use as "to_block"
    // For "from_block", we could track the last processed block, but for now use a recent block
    let from_block = if current_block > 200 {
        Some(current_block - 200) // Look back 200 blocks (~7 minutes on Base)
    } else {
        Some(0)
    };

    // Query EVM chain for EscrowCreated events
    let evm_events = client.get_escrow_created_events(from_block, None).await
        .with_context(|| format!("Failed to fetch EVM escrow events from chain {} (RPC: {}, contract: {}, from_block: {:?})",
            connected_chain_evm.chain_id, connected_chain_evm.rpc_url, connected_chain_evm.escrow_contract_addr, from_block))?;

    let mut escrow_events = Vec::new();
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)?
        .as_secs();

    for event in evm_events {
        escrow_events.push(EscrowEvent {
            escrow_id: event.escrow_id.clone(),
            intent_id: event.intent_id.clone(),
            offered_metadata: format!("{{\"inner\":\"{}\"}}", event.token_addr),
            offered_amount: event.amount,
            desired_metadata: "{}".to_string(),
            desired_amount: 0,
            revocable: false,
            requester_addr: event.requester_addr.clone(),
            reserved_solver_addr: Some(event.reserved_solver.clone()),
            chain_id: connected_chain_evm.chain_id,
            chain_type: ChainType::Evm,
            expiry_time: event.expiry,
            timestamp,
        });
    }

    Ok(escrow_events)
}
