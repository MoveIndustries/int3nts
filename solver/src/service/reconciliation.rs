//! Tracker self-heal service
//!
//! Periodically compares the solver's in-memory `IntentTracker` against hub
//! chain state and, when the two disagree, corrects the tracker in-place.
//!
//! This service exists purely to keep the solver's own cache honest — it does
//! not observe connected-chain state and does not surface protocol-wide
//! problems (orphaned escrows, GMP delivery issues, auto-release failures).
//! Those concerns belong in operator-run tooling, not in the solver, which is
//! an independent third-party participant.
//!
//! # IMPORTANT: outflow-only scope
//!
//! This sweep applies to **outflow intents only**. The signal it relies on,
//! [`HubChainClient::is_fulfillment_proof_received`], asks the hub "did the
//! connected chain send you a FulfillmentProof GMP message for this intent?"
//! That message exists on exactly one path:
//!
//! - Outflow: solver fulfills on the connected chain → connected chain emits
//!   `FulfillmentProof` → hub receives it → this view returns `true`.
//! - Inflow: solver fulfills on the hub directly. **No FulfillmentProof GMP
//!   message ever flows toward the hub for inflow intents.** This view returns
//!   `false` forever for inflow, regardless of completion status.
//!
//! Applying this signal to inflow intents would classify every successful
//! inflow as drift and revert the tracker to `Created`, triggering repeated
//! double-fulfillment attempts. The sweep therefore filters inflow out.
//! Inflow tracker drift is a separate design problem — it needs a different
//! hub-side signal — and is intentionally out of scope for this service.
//!
//! Two drifts are detected and healed (for outflow intents):
//!
//! - `ClaimsFulfilledButNoProofOnHub` — solver tracker says `Fulfilled`, but
//!   the hub has no fulfillment proof. Tracker likely wrote the state too
//!   early (or was mutated by a bug). Reverted to `Created` so retry logic
//!   can attempt fulfillment again.
//! - `ClaimsUnfulfilledButHubHasProof` — solver tracker still says `Created`,
//!   but the hub already has a fulfillment proof. Tracker missed the event.
//!   Advanced to `Fulfilled` so the solver stops trying to fulfill.

use anyhow::Result;
use std::sync::Arc;
use std::time::Duration;

use crate::chains::HubChainClient;
use crate::config::SolverConfig;
use crate::service::tracker::{IntentState, IntentTracker};

/// Reconciliation sweep interval (seconds).
///
/// Mainnet intents currently live ~120s end-to-end, so the sweep must fire
/// several times per intent lifetime to catch drift before expiry.
pub const RECONCILE_INTERVAL_SECS: u64 = 30;

/// Drift between the solver's `IntentTracker` and the hub's view of the intent.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TrackerDrift {
    /// Tracker says `Fulfilled`, hub has no fulfillment proof. Self-heal:
    /// revert tracker to `Created` so fulfillment retry can run.
    ClaimsFulfilledButNoProofOnHub { intent_id: String },
    /// Tracker says `Created`, hub has a fulfillment proof already. Self-heal:
    /// advance tracker to `Fulfilled` so the solver stops attempting to fulfill.
    ClaimsUnfulfilledButHubHasProof { intent_id: String },
}

impl TrackerDrift {
    pub fn intent_id(&self) -> &str {
        match self {
            TrackerDrift::ClaimsFulfilledButNoProofOnHub { intent_id } => intent_id,
            TrackerDrift::ClaimsUnfulfilledButHubHasProof { intent_id } => intent_id,
        }
    }

    /// The state the tracker should be corrected to after healing.
    fn healed_state(&self) -> IntentState {
        match self {
            TrackerDrift::ClaimsFulfilledButNoProofOnHub { .. } => IntentState::Created,
            TrackerDrift::ClaimsUnfulfilledButHubHasProof { .. } => IntentState::Fulfilled,
        }
    }
}

impl std::fmt::Display for TrackerDrift {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TrackerDrift::ClaimsFulfilledButNoProofOnHub { intent_id } => write!(
                f,
                "ClaimsFulfilledButNoProofOnHub: tracker says Fulfilled but hub has no proof (intent_id={})",
                intent_id
            ),
            TrackerDrift::ClaimsUnfulfilledButHubHasProof { intent_id } => write!(
                f,
                "ClaimsUnfulfilledButHubHasProof: tracker says Created but hub already has fulfillment proof (intent_id={})",
                intent_id
            ),
        }
    }
}

impl std::error::Error for TrackerDrift {}

/// Snapshot of the tracker state + hub fulfillment proof for a single intent.
/// Input to [`classify_drift`].
#[derive(Debug, Clone)]
pub struct TrackerSnapshot {
    pub intent_id: String,
    pub tracker_state: IntentState,
    pub hub_fulfillment_proof_received: bool,
}

/// Classifies a single snapshot into at most one drift.
///
/// Returns `None` when tracker and hub agree, or when the intent is in a
/// state where drift can't be meaningfully judged (`Signed`, `Expired`,
/// `Failed`).
pub fn classify_drift(snap: &TrackerSnapshot) -> Option<TrackerDrift> {
    match snap.tracker_state {
        IntentState::Fulfilled if !snap.hub_fulfillment_proof_received => {
            Some(TrackerDrift::ClaimsFulfilledButNoProofOnHub {
                intent_id: snap.intent_id.clone(),
            })
        }
        IntentState::Created if snap.hub_fulfillment_proof_received => {
            Some(TrackerDrift::ClaimsUnfulfilledButHubHasProof {
                intent_id: snap.intent_id.clone(),
            })
        }
        _ => None,
    }
}

/// Solver-internal tracker self-heal service.
///
/// Scope is outflow-only. See module-level docs for why inflow is excluded.
pub struct ReconciliationService {
    tracker: Arc<IntentTracker>,
    hub_client: HubChainClient,
    /// Hub chain id. Used to classify each tracked intent as inflow vs outflow
    /// so the sweep can skip inflow (see module docs for why).
    hub_chain_id: u64,
}

impl ReconciliationService {
    pub fn new(config: SolverConfig, tracker: Arc<IntentTracker>) -> Result<Self> {
        let hub_client = HubChainClient::new(&config.hub_chain)?;
        let hub_chain_id = config.hub_chain.chain_id;
        Ok(Self {
            tracker,
            hub_client,
            hub_chain_id,
        })
    }

    /// Returns true if the tracked intent is an outflow intent.
    ///
    /// Outflow: tokens offered on the hub, fulfilled on the connected chain.
    /// The `FulfillmentProof` GMP message flows connected → hub, which is the
    /// signal this sweep relies on. Inflow produces no such message; see the
    /// module-level docs for the full rationale.
    fn is_outflow(&self, intent: &crate::service::tracker::TrackedIntent) -> bool {
        intent.draft_data.offered_chain_id == self.hub_chain_id
    }

    /// Runs one sweep: for every tracked **outflow** intent in `Created` or
    /// `Fulfilled`, checks the hub for the fulfillment proof and, on drift,
    /// corrects the tracker state in place. Inflow intents are skipped (see
    /// module docs).
    ///
    /// Returns the drifts that were detected and healed this pass. Intents
    /// whose hub query fails are skipped with a warning and retried on the
    /// next sweep.
    pub async fn run_once(&self) -> Vec<TrackerDrift> {
        let intents = self.tracker.get_all_tracked_intents().await;
        let mut drifts = Vec::new();

        for intent in intents {
            if !matches!(intent.state, IntentState::Created | IntentState::Fulfilled) {
                continue;
            }
            // Outflow-only: the hub's `is_fulfillment_proof_received` signal
            // is meaningless for inflow. See module docs.
            if !self.is_outflow(&intent) {
                continue;
            }

            let hub_proof = match self
                .hub_client
                .is_fulfillment_proof_received(&intent.intent_id)
                .await
            {
                Ok(p) => p,
                Err(e) => {
                    tracing::warn!(
                        intent_id = %intent.intent_id,
                        error = %format!("{:#}", e),
                        "Hub query failed during reconciliation; retrying next sweep"
                    );
                    continue;
                }
            };

            let snap = TrackerSnapshot {
                intent_id: intent.intent_id.clone(),
                tracker_state: intent.state.clone(),
                hub_fulfillment_proof_received: hub_proof,
            };

            if let Some(drift) = classify_drift(&snap) {
                let target = drift.healed_state();
                match self
                    .tracker
                    .heal_state_by_intent_id(&intent.intent_id, target.clone())
                    .await
                {
                    Ok(_) => {
                        tracing::warn!(
                            intent_id = %drift.intent_id(),
                            healed_to = ?target,
                            drift = ?drift,
                            "Reconciliation healed tracker drift"
                        );
                        drifts.push(drift);
                    }
                    Err(e) => {
                        tracing::warn!(
                            intent_id = %drift.intent_id(),
                            error = %format!("{:#}", e),
                            "Failed to apply healed state; will retry next sweep"
                        );
                    }
                }
            }
        }

        drifts
    }

    /// Runs reconciliation in a loop at the given interval until cancelled.
    pub async fn run(&self, interval: Duration) {
        let mut ticker = tokio::time::interval(interval);
        // Skip the immediate first tick; let other services warm up.
        ticker.tick().await;
        loop {
            ticker.tick().await;
            let drifts = self.run_once().await;
            if !drifts.is_empty() {
                tracing::info!(
                    count = drifts.len(),
                    "Reconciliation sweep healed tracker drift(s)"
                );
            }
        }
    }
}
