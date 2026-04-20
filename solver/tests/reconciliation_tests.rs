//! Unit tests for the solver's cross-chain reconciliation service.
//!
//! Mismatch classification is a pure function over a constructed `IntentSnapshot`,
//! so most tests exercise `classify_mismatch` directly without any chain client
//! mocking. A small handful of tests also verify service construction and the
//! empty-tracker path of `run_once`.

use solver::{
    classify_mismatch, service::tracker::IntentTracker, IntentSnapshot, IntentState, Mismatch,
    ReconciliationService,
};
use std::sync::Arc;

#[path = "helpers.rs"]
mod test_helpers;
use test_helpers::create_default_solver_config;

const DUMMY_CONNECTED_LABEL: &str = "evm:31337";

fn base_snapshot(tracker_state: IntentState) -> IntentSnapshot {
    IntentSnapshot {
        intent_id: "intent-42".to_string(),
        connected_chain: DUMMY_CONNECTED_LABEL.to_string(),
        tracker_state,
        hub_fulfillment_proof_received: false,
        connected_escrow_released: false,
    }
}

// ============================================================================
// classify_mismatch — mismatch detection
// ============================================================================

/// What is tested: Mismatch detection when tracker shows Created but connected
/// escrow is released
/// Why: Indicates the connected escrow was unlocked without the tracker
/// transitioning to Fulfilled — fulfillment update was lost
#[test]
fn test_detects_hub_locked_but_connected_released() {
    let snap = IntentSnapshot {
        connected_escrow_released: true,
        ..base_snapshot(IntentState::Created)
    };

    let mismatch = classify_mismatch(&snap).expect("expected a mismatch");
    match mismatch {
        Mismatch::HubLockedButConnectedReleased { intent_id, connected_chain } => {
            assert_eq!(intent_id, "intent-42");
            assert_eq!(connected_chain, DUMMY_CONNECTED_LABEL);
        }
        other => panic!("expected HubLockedButConnectedReleased, got {:?}", other),
    }
}

/// What is tested: Mismatch detection when hub has fulfillment proof but
/// connected escrow is still locked
/// Why: Indicates inflow auto-release on the connected chain failed and funds
/// are stuck even though the hub side completed
#[test]
fn test_detects_hub_fulfilled_but_connected_not_released() {
    let snap = IntentSnapshot {
        hub_fulfillment_proof_received: true,
        connected_escrow_released: false,
        ..base_snapshot(IntentState::Fulfilled)
    };

    let mismatch = classify_mismatch(&snap).expect("expected a mismatch");
    match mismatch {
        Mismatch::HubFulfilledButConnectedNotReleased { intent_id, connected_chain } => {
            assert_eq!(intent_id, "intent-42");
            assert_eq!(connected_chain, DUMMY_CONNECTED_LABEL);
        }
        other => panic!("expected HubFulfilledButConnectedNotReleased, got {:?}", other),
    }
}

/// What is tested: Mismatch detection when tracker says Fulfilled but hub
/// has no fulfillment proof
/// Why: Indicates the solver's in-memory tracker is out of sync with the hub —
/// stale cache must be flagged loudly, never silently "corrected"
#[test]
fn test_detects_tracker_claims_fulfilled_but_hub_does_not_agree() {
    let snap = IntentSnapshot {
        hub_fulfillment_proof_received: false,
        connected_escrow_released: false,
        ..base_snapshot(IntentState::Fulfilled)
    };

    let mismatch = classify_mismatch(&snap).expect("expected a mismatch");
    match mismatch {
        Mismatch::TrackerClaimsFulfilledButHubDoesNotAgree { intent_id } => {
            assert_eq!(intent_id, "intent-42");
        }
        other => panic!(
            "expected TrackerClaimsFulfilledButHubDoesNotAgree, got {:?}",
            other
        ),
    }
}

/// What is tested: No mismatch when tracker and both chains agree on Fulfilled
/// Why: Happy-path case must not flag false positives, otherwise the sweep is
/// useless as a signal
#[test]
fn test_no_mismatch_on_healthy_fulfilled_intent() {
    let snap = IntentSnapshot {
        hub_fulfillment_proof_received: true,
        connected_escrow_released: true,
        ..base_snapshot(IntentState::Fulfilled)
    };

    assert!(classify_mismatch(&snap).is_none());
}

/// What is tested: No mismatch when tracker says Created and connected escrow
/// is still locked
/// Why: Intent mid-flight (awaiting fulfillment) is the normal case and must
/// not trip the sweep
#[test]
fn test_no_mismatch_on_healthy_created_intent() {
    let snap = IntentSnapshot {
        hub_fulfillment_proof_received: false,
        connected_escrow_released: false,
        ..base_snapshot(IntentState::Created)
    };

    assert!(classify_mismatch(&snap).is_none());
}

/// What is tested: Terminal/pre-on-chain states (Signed, Expired, Failed) never
/// produce a mismatch, regardless of on-chain readings
/// Why: Reconciliation only applies to live intents; terminal states are the
/// escrow-cleanup sweep's concern in a later stage and must not be duplicated
/// here
#[test]
fn test_no_mismatch_on_non_active_states() {
    for state in [IntentState::Signed, IntentState::Expired, IntentState::Failed] {
        let snap = IntentSnapshot {
            hub_fulfillment_proof_received: true,
            connected_escrow_released: true,
            ..base_snapshot(state.clone())
        };
        assert!(
            classify_mismatch(&snap).is_none(),
            "state {:?} should not produce a mismatch",
            state
        );
    }
}

/// What is tested: Display impl carries intent_id and connected_chain so the
/// error log / anyhow wrap surfaces actionable context
/// Why: The whole point of the sweep is "loud, explicit errors" — if the
/// formatted mismatch string drops the identifiers, the signal is useless
#[test]
fn test_mismatch_display_carries_actionable_context() {
    let m = Mismatch::HubLockedButConnectedReleased {
        intent_id: "intent-42".to_string(),
        connected_chain: DUMMY_CONNECTED_LABEL.to_string(),
    };
    let rendered = format!("{}", m);
    assert!(rendered.contains("intent-42"));
    assert!(rendered.contains(DUMMY_CONNECTED_LABEL));
    assert!(rendered.contains("HubLockedButConnectedReleased"));
}

// ============================================================================
// ReconciliationService — construction and empty-tracker path
// ============================================================================

/// What is tested: ReconciliationService::new() constructs successfully from a
/// default solver config
/// Why: Guards against regressions in config wiring for the hub + per-chain
/// connected clients
#[test]
fn test_reconciliation_service_new() {
    let config = create_default_solver_config();
    let tracker = Arc::new(IntentTracker::new(&config).unwrap());
    let _service = ReconciliationService::new(config, tracker).unwrap();
}

/// What is tested: run_once() returns an empty Vec when the tracker has no
/// intents
/// Why: Service must not attempt any chain queries (or panic) when there is
/// nothing to reconcile — the sweep is a no-op at empty state
#[test]
fn test_run_once_empty_tracker_returns_no_mismatches() {
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();

    let config = create_default_solver_config();
    let tracker = Arc::new(IntentTracker::new(&config).unwrap());
    let service = ReconciliationService::new(config, tracker).unwrap();

    let mismatches = rt.block_on(service.run_once());
    assert!(mismatches.is_empty());
}
