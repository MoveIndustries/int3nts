//! Cross-chain state reconciliation service
//!
//! Observation-only sweep that cross-checks the solver's in-memory `IntentTracker`
//! against on-chain state on the hub chain and the connected chains (MVM/EVM/SVM).
//! For every divergence, emits an explicit `Mismatch` and logs it at error level —
//! the service does not attempt any repair. Repair is the responsibility of the
//! escrow-cleanup sweep (built in a later stage).
//!
//! Inflow-scoped: the three mismatch kinds all reference the inflow lifecycle
//! (hub lock + connected-chain escrow + GMP fulfillment proof). Outflow-only
//! reconciliation is intentionally out of scope for this stage.

use anyhow::Result;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use crate::chains::{ConnectedEvmClient, ConnectedMvmClient, ConnectedSvmClient, HubChainClient};
use crate::config::{ConnectedChainConfig, SolverConfig};
use crate::service::tracker::{IntentState, IntentTracker, TrackedIntent};

/// Reconciliation sweep interval (seconds).
///
/// Mainnet intents currently live ~120s end-to-end, so the sweep must fire
/// several times per intent lifetime to catch mismatches before expiry.
pub const RECONCILE_INTERVAL_SECS: u64 = 15;

/// A divergence between the solver's `IntentTracker` and on-chain state.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Mismatch {
    /// Solver tracker still shows the inflow intent as awaiting fulfillment
    /// (`Created`), but the connected-chain escrow has already been released.
    /// Indicates the fulfillment GMP message reached the connected-chain escrow
    /// contract but did not update the solver tracker (lost relay update or
    /// crashed solver).
    HubLockedButConnectedReleased {
        intent_id: String,
        connected_chain: String,
    },
    /// Hub has received a fulfillment proof for the intent, but the
    /// connected-chain escrow is still locked. Indicates the inflow
    /// auto-release on the connected chain failed or its GMP delivery dropped.
    HubFulfilledButConnectedNotReleased {
        intent_id: String,
        connected_chain: String,
    },
    /// Solver's in-memory tracker reports the intent as `Fulfilled`, but the
    /// hub has no corresponding fulfillment proof. Indicates the tracker cache
    /// is stale or was corrupted.
    TrackerClaimsFulfilledButHubDoesNotAgree { intent_id: String },
}

impl Mismatch {
    pub fn intent_id(&self) -> &str {
        match self {
            Mismatch::HubLockedButConnectedReleased { intent_id, .. } => intent_id,
            Mismatch::HubFulfilledButConnectedNotReleased { intent_id, .. } => intent_id,
            Mismatch::TrackerClaimsFulfilledButHubDoesNotAgree { intent_id } => intent_id,
        }
    }
}

impl std::fmt::Display for Mismatch {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Mismatch::HubLockedButConnectedReleased { intent_id, connected_chain } => write!(
                f,
                "HubLockedButConnectedReleased: hub still locked but connected escrow released (intent_id={}, connected_chain={})",
                intent_id, connected_chain
            ),
            Mismatch::HubFulfilledButConnectedNotReleased { intent_id, connected_chain } => write!(
                f,
                "HubFulfilledButConnectedNotReleased: hub has fulfillment proof but connected escrow still locked (intent_id={}, connected_chain={})",
                intent_id, connected_chain
            ),
            Mismatch::TrackerClaimsFulfilledButHubDoesNotAgree { intent_id } => write!(
                f,
                "TrackerClaimsFulfilledButHubDoesNotAgree: solver tracker reports Fulfilled but hub has no fulfillment proof (intent_id={})",
                intent_id
            ),
        }
    }
}

impl std::error::Error for Mismatch {}

/// Snapshot of tracker + on-chain state for a single intent, sufficient input
/// for [`classify_mismatch`]. Constructed by the reconciliation service from
/// live chain reads; exposed directly to tests so mismatch classification can
/// be exercised without mocking chain clients.
#[derive(Debug, Clone)]
pub struct IntentSnapshot {
    pub intent_id: String,
    /// Human-readable label for the connected chain (e.g. `"evm:31337"`).
    pub connected_chain: String,
    pub tracker_state: IntentState,
    /// Hub has received and accepted a fulfillment proof for this intent.
    pub hub_fulfillment_proof_received: bool,
    /// The connected-chain inflow escrow has been released (funds sent to solver).
    pub connected_escrow_released: bool,
}

/// Classifies a single intent snapshot into at most one mismatch.
///
/// Returns `None` when tracker and on-chain state are consistent (or when the
/// intent is in a state where no mismatch can be meaningfully detected — e.g.
/// `Signed`, `Expired`, `Failed`).
pub fn classify_mismatch(snap: &IntentSnapshot) -> Option<Mismatch> {
    match snap.tracker_state {
        IntentState::Fulfilled => {
            if !snap.hub_fulfillment_proof_received {
                return Some(Mismatch::TrackerClaimsFulfilledButHubDoesNotAgree {
                    intent_id: snap.intent_id.clone(),
                });
            }
            if !snap.connected_escrow_released {
                return Some(Mismatch::HubFulfilledButConnectedNotReleased {
                    intent_id: snap.intent_id.clone(),
                    connected_chain: snap.connected_chain.clone(),
                });
            }
            None
        }
        IntentState::Created => {
            if snap.connected_escrow_released {
                return Some(Mismatch::HubLockedButConnectedReleased {
                    intent_id: snap.intent_id.clone(),
                    connected_chain: snap.connected_chain.clone(),
                });
            }
            None
        }
        IntentState::Signed | IntentState::Expired | IntentState::Failed => None,
    }
}

/// Observation-only reconciliation service.
pub struct ReconciliationService {
    config: SolverConfig,
    tracker: Arc<IntentTracker>,
    hub_client: HubChainClient,
    mvm_clients: HashMap<u64, ConnectedMvmClient>,
    evm_clients: HashMap<u64, ConnectedEvmClient>,
    svm_clients: HashMap<u64, ConnectedSvmClient>,
}

impl ReconciliationService {
    pub fn new(config: SolverConfig, tracker: Arc<IntentTracker>) -> Result<Self> {
        let hub_client = HubChainClient::new(&config.hub_chain)?;

        let mut mvm_clients = HashMap::new();
        let mut evm_clients = HashMap::new();
        let mut svm_clients = HashMap::new();
        for chain in &config.connected_chain {
            match chain {
                ConnectedChainConfig::Mvm(cfg) => {
                    mvm_clients.insert(cfg.chain_id, ConnectedMvmClient::new(cfg)?);
                }
                ConnectedChainConfig::Evm(cfg) => {
                    evm_clients.insert(cfg.chain_id, ConnectedEvmClient::new(cfg)?);
                }
                ConnectedChainConfig::Svm(cfg) => {
                    svm_clients.insert(cfg.chain_id, ConnectedSvmClient::new(cfg)?);
                }
            }
        }

        Ok(Self {
            config,
            tracker,
            hub_client,
            mvm_clients,
            evm_clients,
            svm_clients,
        })
    }

    /// Returns the connected-chain id for a tracked intent, or `None` if both
    /// sides are the hub (which would be malformed).
    fn connected_chain_id(&self, intent: &TrackedIntent) -> Option<u64> {
        let hub_id = self.config.hub_chain.chain_id;
        let offered = intent.draft_data.offered_chain_id;
        let desired = intent.draft_data.desired_chain_id;
        if offered == hub_id && desired != hub_id {
            Some(desired)
        } else if desired == hub_id && offered != hub_id {
            Some(offered)
        } else {
            None
        }
    }

    async fn is_connected_escrow_released(&self, chain_id: u64, intent_id: &str) -> Result<bool> {
        if let Some(c) = self.mvm_clients.get(&chain_id) {
            return c.is_escrow_released(intent_id).await;
        }
        if let Some(c) = self.evm_clients.get(&chain_id) {
            return c.is_escrow_released(intent_id).await;
        }
        if let Some(c) = self.svm_clients.get(&chain_id) {
            return c.is_escrow_released(intent_id);
        }
        anyhow::bail!("No connected chain client configured for chain_id {}", chain_id)
    }

    async fn snapshot_intent(&self, intent: &TrackedIntent) -> Result<IntentSnapshot> {
        let connected_id = self.connected_chain_id(intent);
        let connected_label = match connected_id.and_then(|id| self.config.get_connected_chain_by_id(id))
        {
            Some(c) => format!("{}:{}", c.chain_type(), c.chain_id()),
            None => "unknown".to_string(),
        };

        let hub_fulfillment_proof_received = self
            .hub_client
            .is_fulfillment_proof_received(&intent.intent_id)
            .await?;

        let connected_escrow_released = match connected_id {
            Some(id) => self.is_connected_escrow_released(id, &intent.intent_id).await?,
            None => false,
        };

        Ok(IntentSnapshot {
            intent_id: intent.intent_id.clone(),
            connected_chain: connected_label,
            tracker_state: intent.state.clone(),
            hub_fulfillment_proof_received,
            connected_escrow_released,
        })
    }

    /// Runs one reconciliation pass across every tracked intent.
    ///
    /// Returns a list of every mismatch observed. Each mismatch is also logged
    /// at error level with structured fields (intent_id, connected_chain, kind).
    /// Intents whose snapshot fails (e.g. transient RPC error) are skipped
    /// with an error log — they will be re-checked on the next sweep.
    pub async fn run_once(&self) -> Vec<Mismatch> {
        let intents = self.tracker.get_all_tracked_intents().await;
        let mut mismatches = Vec::new();

        for intent in intents {
            let snap = match self.snapshot_intent(&intent).await {
                Ok(s) => s,
                Err(e) => {
                    tracing::error!(
                        intent_id = %intent.intent_id,
                        error = %format!("{:#}", e),
                        "Reconciliation snapshot failed; skipping intent this sweep"
                    );
                    continue;
                }
            };

            if let Some(m) = classify_mismatch(&snap) {
                tracing::error!(
                    intent_id = %m.intent_id(),
                    mismatch = ?m,
                    "Reconciliation mismatch detected"
                );
                mismatches.push(m);
            }
        }

        mismatches
    }

    /// Runs reconciliation in a loop at the given interval until cancelled.
    pub async fn run(&self, interval: Duration) {
        let mut ticker = tokio::time::interval(interval);
        // Skip the immediate first tick; give other services a chance to warm up.
        ticker.tick().await;
        loop {
            ticker.tick().await;
            let mismatches = self.run_once().await;
            if mismatches.is_empty() {
                tracing::trace!("Reconciliation sweep: no mismatches");
            } else {
                tracing::warn!(
                    count = mismatches.len(),
                    "Reconciliation sweep found mismatches"
                );
            }
        }
    }
}
