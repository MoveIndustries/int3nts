//! Unit tests for the solver's tracker self-heal service.
//!
//! Drift classification is a pure function over `TrackerSnapshot`, so most
//! tests exercise `classify_drift` directly without any chain client mocking.
//! A small handful of tests also verify service construction, the empty-tracker
//! path of `run_once`, and the tracker's `heal_state_by_intent_id` method.

use solver::{
    acceptance::DraftintentData, classify_drift, service::tracker::IntentTracker, IntentState,
    ReconciliationService, TrackerDrift, TrackerSnapshot,
};
use std::sync::Arc;

#[path = "helpers.rs"]
mod test_helpers;
use test_helpers::{
    create_default_solver_config, DUMMY_DRAFT_ID, DUMMY_EXPIRY, DUMMY_INTENT_ID,
    DUMMY_REQUESTER_ADDR_EVM, DUMMY_TOKEN_ADDR_HUB, DUMMY_TOKEN_ADDR_MVMCON,
};

fn create_default_draft_data_inflow() -> DraftintentData {
    DraftintentData {
        intent_id: DUMMY_INTENT_ID.to_string(),
        offered_token: DUMMY_TOKEN_ADDR_MVMCON.to_string(),
        offered_amount: 1000,
        offered_chain_id: 2,
        desired_token: DUMMY_TOKEN_ADDR_HUB.to_string(),
        desired_amount: 2000,
        desired_chain_id: 1,
        fee_in_offered_token: 1000,
    }
}

fn snap(tracker_state: IntentState, hub_proof: bool) -> TrackerSnapshot {
    TrackerSnapshot {
        intent_id: "intent-42".to_string(),
        tracker_state,
        hub_fulfillment_proof_received: hub_proof,
    }
}

// ============================================================================
// classify_drift — pure drift detection
// ============================================================================

/// What is tested: Drift detected when tracker says Fulfilled but hub has no proof
/// Why: Solver must notice when its cache wrote Fulfilled too early so the retry
/// logic can attempt fulfillment again
#[test]
fn test_classify_drift_claims_fulfilled_but_no_proof() {
    let drift = classify_drift(&snap(IntentState::Fulfilled, false)).expect("expected drift");
    match drift {
        TrackerDrift::ClaimsFulfilledButNoProofOnHub { intent_id } => {
            assert_eq!(intent_id, "intent-42");
        }
        other => panic!("expected ClaimsFulfilledButNoProofOnHub, got {:?}", other),
    }
}

/// What is tested: Drift detected when tracker says Created but hub already has proof
/// Why: Solver must notice when it missed the fulfillment event so it stops
/// wasting cycles trying to re-fulfill an intent that's already done on-chain
#[test]
fn test_classify_drift_claims_unfulfilled_but_hub_has_proof() {
    let drift = classify_drift(&snap(IntentState::Created, true)).expect("expected drift");
    match drift {
        TrackerDrift::ClaimsUnfulfilledButHubHasProof { intent_id } => {
            assert_eq!(intent_id, "intent-42");
        }
        other => panic!("expected ClaimsUnfulfilledButHubHasProof, got {:?}", other),
    }
}

/// What is tested: No drift when tracker and hub agree on Fulfilled
/// Why: Happy-path must not produce false positives
#[test]
fn test_classify_drift_no_drift_when_both_agree_fulfilled() {
    assert!(classify_drift(&snap(IntentState::Fulfilled, true)).is_none());
}

/// What is tested: No drift when tracker says Created and hub has no proof yet
/// Why: This is the normal mid-flight state and must not trip the sweep
#[test]
fn test_classify_drift_no_drift_when_both_agree_created() {
    assert!(classify_drift(&snap(IntentState::Created, false)).is_none());
}

/// What is tested: Non-active states (Signed, Expired, Failed) never produce drift
/// Why: Drift only makes sense for intents in the fulfillment window; terminal
/// states must be left alone by the self-heal sweep
#[test]
fn test_classify_drift_non_active_states_never_drift() {
    for state in [IntentState::Signed, IntentState::Expired, IntentState::Failed] {
        for proof in [false, true] {
            assert!(
                classify_drift(&snap(state.clone(), proof)).is_none(),
                "state {:?} with hub_proof={} should not produce drift",
                state,
                proof
            );
        }
    }
}

/// What is tested: healed_state() returns the correct target state per drift variant
/// Why: Wrong healed state would strand the intent — `ClaimsFulfilledButNoProofOnHub`
/// must revert to Created (so retry runs), `ClaimsUnfulfilledButHubHasProof` must
/// advance to Fulfilled (so the solver stops)
#[test]
fn test_drift_display_carries_intent_id() {
    let a = TrackerDrift::ClaimsFulfilledButNoProofOnHub {
        intent_id: "abc".to_string(),
    };
    let b = TrackerDrift::ClaimsUnfulfilledButHubHasProof {
        intent_id: "xyz".to_string(),
    };
    assert!(format!("{}", a).contains("abc"));
    assert!(format!("{}", a).contains("ClaimsFulfilledButNoProofOnHub"));
    assert!(format!("{}", b).contains("xyz"));
    assert!(format!("{}", b).contains("ClaimsUnfulfilledButHubHasProof"));
}

// ============================================================================
// IntentTracker::heal_state_by_intent_id — state correction
// ============================================================================

/// What is tested: heal_state_by_intent_id updates the state of the tracked intent
/// Why: This is the mutation primitive the reconciliation sweep uses; it must
/// overwrite state by on-chain intent_id, not by draft_id
#[tokio::test]
async fn test_heal_state_by_intent_id_updates_state() {
    let config = create_default_solver_config();
    let tracker = IntentTracker::new(&config).unwrap();
    let draft_data = create_default_draft_data_inflow();
    tracker
        .add_signed_intent(
            DUMMY_DRAFT_ID.to_string(),
            draft_data,
            DUMMY_REQUESTER_ADDR_EVM.to_string(),
            DUMMY_EXPIRY,
        )
        .await
        .unwrap();
    tracker
        .set_intent_state(DUMMY_DRAFT_ID, IntentState::Fulfilled)
        .await
        .unwrap();

    tracker
        .heal_state_by_intent_id(DUMMY_INTENT_ID, IntentState::Created)
        .await
        .unwrap();

    let tracked = tracker.get_intent(DUMMY_DRAFT_ID).await.unwrap();
    assert_eq!(tracked.state, IntentState::Created);
}

/// What is tested: heal_state_by_intent_id returns an error when the intent_id is unknown
/// Why: Silent no-op on a missing intent would mask a logic bug in the sweep
#[tokio::test]
async fn test_heal_state_by_intent_id_errors_on_unknown() {
    let config = create_default_solver_config();
    let tracker = IntentTracker::new(&config).unwrap();
    let result = tracker
        .heal_state_by_intent_id("not-a-real-intent", IntentState::Created)
        .await;
    assert!(result.is_err());
    assert!(result.unwrap_err().to_string().contains("not found"));
}

// ============================================================================
// ReconciliationService — construction and empty-tracker path
// ============================================================================

/// What is tested: ReconciliationService::new() constructs successfully from a default config
/// Why: Guards against regressions in hub-client wiring for the self-heal sweep
#[test]
fn test_reconciliation_service_new() {
    let config = create_default_solver_config();
    let tracker = Arc::new(IntentTracker::new(&config).unwrap());
    let _service = ReconciliationService::new(config, tracker).unwrap();
}

/// What is tested: run_once() returns an empty Vec when the tracker has no intents
/// Why: No tracker entries means no hub queries and no drifts — the sweep must
/// be a cheap no-op at empty state
#[test]
fn test_run_once_empty_tracker_returns_no_drifts() {
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();

    let config = create_default_solver_config();
    let tracker = Arc::new(IntentTracker::new(&config).unwrap());
    let service = ReconciliationService::new(config, tracker).unwrap();

    let drifts = rt.block_on(service.run_once());
    assert!(drifts.is_empty());
}

/// What is tested: run_once() skips inflow intents entirely — no hub query, no drift
/// Why: The hub's `is_fulfillment_proof_received` signal is outflow-only.
/// Applying it to inflow would misclassify every completed inflow as drift and
/// trigger double-fulfillment. The filter must run BEFORE any hub query, so
/// this test passes even without a reachable hub.
#[test]
fn test_run_once_skips_inflow_intents() {
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();

    let config = create_default_solver_config();
    let tracker = Arc::new(IntentTracker::new(&config).unwrap());

    rt.block_on(async {
        tracker
            .add_signed_intent(
                DUMMY_DRAFT_ID.to_string(),
                create_default_draft_data_inflow(),
                DUMMY_REQUESTER_ADDR_EVM.to_string(),
                DUMMY_EXPIRY,
            )
            .await
            .unwrap();
        tracker
            .set_intent_state(DUMMY_DRAFT_ID, IntentState::Fulfilled)
            .await
            .unwrap();
    });

    let service = ReconciliationService::new(config, tracker.clone()).unwrap();

    let drifts = rt.block_on(service.run_once());
    assert!(drifts.is_empty());

    // Tracker state should be unchanged — inflow was skipped, no heal applied.
    let tracked = rt.block_on(tracker.get_intent(DUMMY_DRAFT_ID)).unwrap();
    assert_eq!(tracked.state, IntentState::Fulfilled);
}
