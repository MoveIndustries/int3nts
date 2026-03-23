//! Auth hardening tests for coordinator negotiation endpoints
//!
//! These tests verify security properties of the draft intent and signature
//! submission flow: expired draft rejection, nonexistent draft handling,
//! FCFS race conditions, and unregistered solver rejection.

use serde_json::json;
use coordinator::api::{ApiResponse, ApiServer};
use coordinator::monitor::EventMonitor;
use warp::http::StatusCode;
use warp::test::request;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

#[path = "mod.rs"]
mod test_helpers;
use test_helpers::{
    DUMMY_EXPIRY, DUMMY_REQUESTER_ADDR_HUB, DUMMY_SOLVER_ADDR_HUB,
    build_test_config_with_mock_server,
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

// 128 hex chars = 64 bytes (Ed25519 signature)
const DUMMY_SIGNATURE_128: &str =
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

// 64 hex chars = 32 bytes (Ed25519 public key)
const DUMMY_PUBKEY_64: &str =
    "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

/// Create an ApiServer with a mock MVM server where the solver IS registered.
/// Mocks the POST /v1/view endpoint used by get_solver_public_key.
async fn create_api_server_with_registered_solver() -> (ApiServer, MockServer) {
    let mock_server = MockServer::start().await;

    // Mock the view function endpoint that get_solver_public_key calls.
    // The MvmClient calls POST /v1/view with function "solver_registry::get_public_key".
    // On success, it returns a JSON array like ["0x010203..."] (hex-encoded public key bytes).
    Mock::given(method("POST"))
        .and(path("/v1/view"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(json!(["0x01020304"])),
        )
        .mount(&mock_server)
        .await;

    let config = build_test_config_with_mock_server(&mock_server.uri());
    let monitor = EventMonitor::new(&config).await.unwrap();
    let api_server = ApiServer::new(config, monitor);
    (api_server, mock_server)
}

/// Create an ApiServer with a mock MVM server where the solver is NOT registered.
/// The view function returns a Move abort (solver not found in registry).
async fn create_api_server_without_solver() -> (ApiServer, MockServer) {
    let mock_server = MockServer::start().await;

    // Mock the view function endpoint to return an error (solver not in registry).
    // Move VM returns 400 with an error body when the view function aborts.
    Mock::given(method("POST"))
        .and(path("/v1/view"))
        .respond_with(
            ResponseTemplate::new(400)
                .set_body_json(json!({
                    "message": "Move abort: SOLVER_NOT_FOUND",
                    "error_code": "vm_error"
                })),
        )
        .mount(&mock_server)
        .await;

    let config = build_test_config_with_mock_server(&mock_server.uri());
    let monitor = EventMonitor::new(&config).await.unwrap();
    let api_server = ApiServer::new(config, monitor);
    (api_server, mock_server)
}

/// Create a valid draft intent request
fn valid_draft_request() -> serde_json::Value {
    json!({
        "requester_addr": DUMMY_REQUESTER_ADDR_HUB,
        "draft_data": { "offered_metadata": "0x1::test::Token", "offered_amount": 100 },
        "expiry_time": DUMMY_EXPIRY
    })
}

/// Create a valid signature submission request
fn valid_signature_request() -> serde_json::Value {
    json!({
        "solver_hub_addr": DUMMY_SOLVER_ADDR_HUB,
        "signature": format!("0x{}", DUMMY_SIGNATURE_128),
        "public_key": format!("0x{}", DUMMY_PUBKEY_64)
    })
}

// ============================================================================
// EXPIRED DRAFT SIGNING
// ============================================================================

/// Test that creating a draft with past expiry is rejected
/// What is tested: Coordinator rejects draft creation when expiry_time is in the past
/// Why: Prevents expired intents from entering the system and wasting solver resources
#[tokio::test]
async fn test_draft_creation_rejected_for_past_expiry() {
    let (api_server, _mock) = create_api_server_with_registered_solver().await;
    let routes = api_server.test_routes();

    let expired_draft = json!({
        "requester_addr": DUMMY_REQUESTER_ADDR_HUB,
        "draft_data": { "offered_metadata": "0x1::test::Token", "offered_amount": 100 },
        "expiry_time": 1
    });

    let response = request()
        .method("POST")
        .path("/draftintent")
        .json(&expired_draft)
        .reply(&routes)
        .await;

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let body: ApiResponse<()> = serde_json::from_slice(response.body()).unwrap();
    assert!(!body.success);
    assert!(
        body.error.as_ref().unwrap().contains("expiry_time"),
        "Error must mention expiry_time, got: {}",
        body.error.unwrap()
    );
}

// ============================================================================
// NONEXISTENT DRAFT SIGNING
// ============================================================================

/// Test that submitting a signature for a nonexistent draft returns error
/// What is tested: Solver cannot sign a draft that doesn't exist
/// Why: Prevents out-of-order calls where solver submits signature before requester creates draft
#[tokio::test]
async fn test_signature_rejected_for_nonexistent_draft() {
    let (api_server, _mock) = create_api_server_with_registered_solver().await;
    let routes = api_server.test_routes();

    let response = request()
        .method("POST")
        .path("/draftintent/nonexistent-draft-id/signature")
        .json(&valid_signature_request())
        .reply(&routes)
        .await;

    let body: ApiResponse<()> = serde_json::from_slice(response.body()).unwrap();
    assert!(!body.success, "Signing nonexistent draft must fail");
    assert!(
        body.error.as_ref().unwrap().to_lowercase().contains("not found"),
        "Error must indicate draft not found, got: {}",
        body.error.unwrap()
    );
}

// ============================================================================
// CONCURRENT FCFS
// ============================================================================

/// Test that two signatures on the same draft results in exactly one success
/// What is tested: FCFS (First Come First Served) — first signature wins, second gets 409 Conflict
/// Why: Prevents double-signing which could lock solver liquidity twice
#[tokio::test]
async fn test_fcfs_second_solver_rejected_via_http() {
    let (api_server, _mock) = create_api_server_with_registered_solver().await;
    let routes = api_server.test_routes();

    // Create a draft
    let create_response = request()
        .method("POST")
        .path("/draftintent")
        .json(&valid_draft_request())
        .reply(&routes)
        .await;
    assert!(create_response.status().is_success());
    let create_body: ApiResponse<serde_json::Value> =
        serde_json::from_slice(create_response.body()).unwrap();
    let draft_id = create_body.data.as_ref().unwrap()["draft_id"]
        .as_str()
        .unwrap()
        .to_string();

    // First solver signs — should succeed
    let sig_response_1 = request()
        .method("POST")
        .path(&format!("/draftintent/{}/signature", draft_id))
        .json(&valid_signature_request())
        .reply(&routes)
        .await;
    assert_eq!(sig_response_1.status(), StatusCode::OK);
    let body1: ApiResponse<serde_json::Value> =
        serde_json::from_slice(sig_response_1.body()).unwrap();
    assert!(body1.success, "First signature must succeed");

    // Second solver tries to sign the same draft — should get 409 Conflict
    let second_sig = json!({
        "solver_hub_addr": DUMMY_SOLVER_ADDR_HUB,
        "signature": format!("0x{}", "cc".repeat(64)),
        "public_key": format!("0x{}", "dd".repeat(32))
    });
    let sig_response_2 = request()
        .method("POST")
        .path(&format!("/draftintent/{}/signature", draft_id))
        .json(&second_sig)
        .reply(&routes)
        .await;
    assert_eq!(
        sig_response_2.status(),
        StatusCode::CONFLICT,
        "Second signature must get 409 Conflict"
    );
    let body2: ApiResponse<()> = serde_json::from_slice(sig_response_2.body()).unwrap();
    assert!(!body2.success);
    assert!(
        body2.error.as_ref().unwrap().contains("already signed"),
        "Error must indicate already signed, got: {}",
        body2.error.unwrap()
    );
}

// ============================================================================
// FORGED SIGNER / UNREGISTERED SOLVER
// ============================================================================

/// Test that a signature from an unregistered solver is rejected
/// What is tested: Solver must be registered on-chain before signing
/// Why: Prevents unauthorized solvers from claiming intents
#[tokio::test]
async fn test_signature_rejected_for_unregistered_solver() {
    let (api_server, _mock) = create_api_server_without_solver().await;
    let routes = api_server.test_routes();

    // Create a draft (this doesn't require solver registration)
    let create_response = request()
        .method("POST")
        .path("/draftintent")
        .json(&valid_draft_request())
        .reply(&routes)
        .await;
    assert!(create_response.status().is_success());
    let create_body: ApiResponse<serde_json::Value> =
        serde_json::from_slice(create_response.body()).unwrap();
    let draft_id = create_body.data.as_ref().unwrap()["draft_id"]
        .as_str()
        .unwrap()
        .to_string();

    // Submit signature from unregistered solver — the mock returns 400 for view function,
    // which causes get_solver_public_key to return Err, and the handler returns 500.
    // This is the correct behavior: the solver cannot be verified, so the request fails.
    let response = request()
        .method("POST")
        .path(&format!("/draftintent/{}/signature", draft_id))
        .json(&valid_signature_request())
        .reply(&routes)
        .await;

    let body: ApiResponse<()> = serde_json::from_slice(response.body()).unwrap();
    assert!(!body.success, "Unregistered solver must be rejected");
    // The handler returns either "not registered" (if view returns Ok(None))
    // or "Failed to verify solver registration" (if view returns Err).
    // With a 400 mock response, MvmClient returns Err, so handler returns 500.
    assert!(
        body.error.is_some(),
        "Error must be present for unregistered solver"
    );
}
