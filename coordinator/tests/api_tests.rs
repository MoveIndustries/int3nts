//! Unit tests for API error handling and request logging
//!
//! Tests negotiation endpoints and error handling for the coordinator service.

use serde_json::json;
use coordinator::api::{ApiResponse, ApiServer};
use coordinator::monitor::EventMonitor;
use warp::http::StatusCode;
use warp::test::request;

#[path = "mod.rs"]
mod test_helpers;
use test_helpers::{
    DUMMY_EXPIRY, DUMMY_REQUESTER_ADDR_HUB, DUMMY_SOLVER_ADDR_HUB,
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/// Create a test API server with minimal configuration
async fn create_test_api_server() -> ApiServer {
    let config = test_helpers::build_test_config_with_mvm();
    let monitor = EventMonitor::new(&config).await.unwrap();

    ApiServer::new(config, monitor)
}

/// Create a valid draft intent request for testing
fn valid_draft_request() -> serde_json::Value {
    json!({
        "requester_addr": DUMMY_REQUESTER_ADDR_HUB,
        "draft_data": { "offered_metadata": "0x1::test::Token", "offered_amount": 100 },
        "expiry_time": DUMMY_EXPIRY
    })
}

// ============================================================================
// HEALTH ENDPOINT TESTS
// ============================================================================

/// Test that health endpoint returns success
/// What is tested: Basic health check endpoint
/// Why: Ensures service is running and responsive
#[tokio::test]
async fn test_health_endpoint() {
    let api_server = create_test_api_server().await;
    let routes = api_server.test_routes();

    let response = request()
        .method("GET")
        .path("/health")
        .reply(&routes)
        .await;

    assert_eq!(response.status(), StatusCode::OK);
    let body: ApiResponse<String> = serde_json::from_slice(response.body()).unwrap();
    assert!(body.success);
    assert!(body.data.is_some());
}

// ============================================================================
// EVENTS ENDPOINT TESTS
// ============================================================================

/// Test that events endpoint returns success
/// What is tested: Events retrieval endpoint
/// Why: Ensures monitored events can be retrieved
#[tokio::test]
async fn test_events_endpoint() {
    let api_server = create_test_api_server().await;
    let routes = api_server.test_routes();

    let response = request()
        .method("GET")
        .path("/events")
        .reply(&routes)
        .await;

    assert_eq!(response.status(), StatusCode::OK);
    let body: ApiResponse<serde_json::Value> = serde_json::from_slice(response.body()).unwrap();
    assert!(body.success);
}

// ============================================================================
// DRAFT INTENT ENDPOINT TESTS
// ============================================================================

/// Test that invalid JSON in POST /draftintent returns proper error
/// What is tested: Error handling for malformed JSON in draft intent submission
/// Why: Ensures clients get clear error messages when sending invalid JSON
#[tokio::test]
async fn test_draftintent_invalid_json() {
    let api_server = create_test_api_server().await;
    let routes = api_server.test_routes();

    let response = request()
        .method("POST")
        .path("/draftintent")
        .body("invalid{")
        .reply(&routes)
        .await;

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let body: ApiResponse<()> = serde_json::from_slice(response.body()).unwrap();
    assert!(!body.success);
    assert!(body.error.unwrap().contains("Invalid JSON"));
}

/// Test that missing required fields return proper error
/// What is tested: Error handling for missing fields in draft intent request
/// Why: Ensures clients get clear error messages about required fields
#[tokio::test]
async fn test_draftintent_missing_fields() {
    let api_server = create_test_api_server().await;
    let routes = api_server.test_routes();

    let invalid_request = json!({
        "requester_addr": DUMMY_REQUESTER_ADDR_HUB
        // Missing draft_data and expiry_time
    });

    let response = request()
        .method("POST")
        .path("/draftintent")
        .json(&invalid_request)
        .reply(&routes)
        .await;

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let body: ApiResponse<()> = serde_json::from_slice(response.body()).unwrap();
    assert!(!body.success);
}

/// Test that valid draft intent request succeeds
/// What is tested: Valid requests still work after adding error handling
/// Why: Ensures error handling doesn't break normal functionality
#[tokio::test]
async fn test_draftintent_valid_request() {
    let api_server = create_test_api_server().await;
    let routes = api_server.test_routes();

    let response = request()
        .method("POST")
        .path("/draftintent")
        .json(&valid_draft_request())
        .reply(&routes)
        .await;

    assert!(response.status().is_success());
    let body: ApiResponse<serde_json::Value> = serde_json::from_slice(response.body()).unwrap();
    assert!(body.success);
    assert!(body.data.is_some());
}

/// Test that submitting the same draft twice returns the same draft_id
/// What is tested: Deterministic draft ID from (requester_addr, draft_data, expiry_time)
/// Why: Prevents duplicate drafts on retried requests, avoids solver locking liquidity twice
#[tokio::test]
async fn test_draftintent_idempotent_submission() {
    let api_server = create_test_api_server().await;
    let routes = api_server.test_routes();

    let draft_request = valid_draft_request();

    let response1 = request()
        .method("POST")
        .path("/draftintent")
        .json(&draft_request)
        .reply(&routes)
        .await;

    let response2 = request()
        .method("POST")
        .path("/draftintent")
        .json(&draft_request)
        .reply(&routes)
        .await;

    assert!(response1.status().is_success());
    assert!(response2.status().is_success());

    let body1: ApiResponse<serde_json::Value> = serde_json::from_slice(response1.body()).unwrap();
    let body2: ApiResponse<serde_json::Value> = serde_json::from_slice(response2.body()).unwrap();

    let id1 = body1.data.as_ref().unwrap()["draft_id"].as_str().unwrap();
    let id2 = body2.data.as_ref().unwrap()["draft_id"].as_str().unwrap();

    assert_eq!(id1, id2, "Same request must produce the same draft_id");
}

/// Test that different requests produce different draft_ids
/// What is tested: Deterministic draft ID varies when inputs differ
/// Why: Ensures distinct intents are not accidentally deduplicated
#[tokio::test]
async fn test_draftintent_different_inputs_different_ids() {
    let api_server = create_test_api_server().await;
    let routes = api_server.test_routes();

    let request1 = valid_draft_request();
    let request2 = json!({
        "requester_addr": DUMMY_REQUESTER_ADDR_HUB,
        "draft_data": { "offered_metadata": "0x1::test::Token", "offered_amount": 100 },
        "expiry_time": DUMMY_EXPIRY + 1
    });

    let response1 = request()
        .method("POST")
        .path("/draftintent")
        .json(&request1)
        .reply(&routes)
        .await;

    let response2 = request()
        .method("POST")
        .path("/draftintent")
        .json(&request2)
        .reply(&routes)
        .await;

    let body1: ApiResponse<serde_json::Value> = serde_json::from_slice(response1.body()).unwrap();
    let body2: ApiResponse<serde_json::Value> = serde_json::from_slice(response2.body()).unwrap();

    let id1 = body1.data.as_ref().unwrap()["draft_id"].as_str().unwrap();
    let id2 = body2.data.as_ref().unwrap()["draft_id"].as_str().unwrap();

    assert_ne!(id1, id2, "Different requests must produce different draft_ids");
}

/// Test that invalid requester_addr is rejected
/// What is tested: requester_addr must be 0x-prefixed hex
/// Why: Prevents garbage data from entering the draft store
#[tokio::test]
async fn test_draftintent_invalid_requester_addr() {
    let api_server = create_test_api_server().await;
    let routes = api_server.test_routes();

    let bad_request = json!({
        "requester_addr": "not-hex",
        "draft_data": { "offered_metadata": "0x1::test::Token", "offered_amount": 100 },
        "expiry_time": DUMMY_EXPIRY
    });

    let response = request()
        .method("POST")
        .path("/draftintent")
        .json(&bad_request)
        .reply(&routes)
        .await;

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let body: ApiResponse<()> = serde_json::from_slice(response.body()).unwrap();
    assert!(body.error.unwrap().contains("requester_addr"));
}

/// Test that past expiry_time is rejected
/// What is tested: expiry_time must be in the future
/// Why: Expired drafts waste solver resources
#[tokio::test]
async fn test_draftintent_past_expiry() {
    let api_server = create_test_api_server().await;
    let routes = api_server.test_routes();

    let bad_request = json!({
        "requester_addr": DUMMY_REQUESTER_ADDR_HUB,
        "draft_data": { "offered_metadata": "0x1::test::Token", "offered_amount": 100 },
        "expiry_time": 1000000000
    });

    let response = request()
        .method("POST")
        .path("/draftintent")
        .json(&bad_request)
        .reply(&routes)
        .await;

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let body: ApiResponse<()> = serde_json::from_slice(response.body()).unwrap();
    assert!(body.error.unwrap().contains("expiry_time"));
}

/// Test that empty body returns proper error
/// What is tested: Error handling for empty request body
/// Why: Ensures clients get clear error messages for empty requests
#[tokio::test]
async fn test_draftintent_empty_body() {
    let api_server = create_test_api_server().await;
    let routes = api_server.test_routes();

    let response = request()
        .method("POST")
        .path("/draftintent")
        .body("")
        .reply(&routes)
        .await;

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let body: ApiResponse<()> = serde_json::from_slice(response.body()).unwrap();
    assert!(!body.success);
}

// ============================================================================
// SIGNATURE SUBMISSION ENDPOINT TESTS
// ============================================================================

/// Test that invalid JSON in POST /draftintent/:id/signature returns proper error
/// What is tested: Error handling for malformed JSON in signature submission
/// Why: Ensures clients get clear error messages when sending invalid JSON
#[tokio::test]
async fn test_signature_submission_invalid_json() {
    let api_server = create_test_api_server().await;
    let routes = api_server.test_routes();

    // Create draft first
    let create_response = request()
        .method("POST")
        .path("/draftintent")
        .json(&valid_draft_request())
        .reply(&routes)
        .await;

    let create_body: ApiResponse<serde_json::Value> =
        serde_json::from_slice(create_response.body()).unwrap();
    let draft_id = create_body.data.as_ref().unwrap()["draft_id"]
        .as_str()
        .unwrap();

    // Test invalid JSON
    let response = request()
        .method("POST")
        .path(&format!("/draftintent/{}/signature", draft_id))
        .body("invalid{")
        .reply(&routes)
        .await;

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let body: ApiResponse<()> = serde_json::from_slice(response.body()).unwrap();
    assert!(body.error.unwrap().contains("Invalid JSON"));
}

/// Test that missing required fields in signature submission return proper error
/// What is tested: Error handling for missing fields in signature submission
/// Why: Ensures clients get clear error messages about required fields
#[tokio::test]
async fn test_signature_submission_missing_fields() {
    let api_server = create_test_api_server().await;
    let routes = api_server.test_routes();

    // Create draft first
    let create_response = request()
        .method("POST")
        .path("/draftintent")
        .json(&valid_draft_request())
        .reply(&routes)
        .await;

    let create_body: ApiResponse<serde_json::Value> =
        serde_json::from_slice(create_response.body()).unwrap();
    let draft_id = create_body.data.as_ref().unwrap()["draft_id"]
        .as_str()
        .unwrap();

    // Test missing fields
    let invalid_request = json!({
        "solver_hub_addr": DUMMY_SOLVER_ADDR_HUB
        // Missing signature and public_key
    });

    let response = request()
        .method("POST")
        .path(&format!("/draftintent/{}/signature", draft_id))
        .json(&invalid_request)
        .reply(&routes)
        .await;

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let body: ApiResponse<()> = serde_json::from_slice(response.body()).unwrap();
    assert!(!body.success);
}

/// Test that signature submission route doesn't match draft intent route
/// What is tested: Route matching - /draftintent/:id/signature vs /draftintent
/// Why: Prevents regression where sub-paths incorrectly match parent route
#[tokio::test]
async fn test_signature_route_not_confused_with_draft_route() {
    let api_server = create_test_api_server().await;
    let routes = api_server.test_routes();

    // Create draft first
    let create_response = request()
        .method("POST")
        .path("/draftintent")
        .json(&valid_draft_request())
        .reply(&routes)
        .await;

    let create_body: ApiResponse<serde_json::Value> =
        serde_json::from_slice(create_response.body()).unwrap();
    let draft_id = create_body.data.as_ref().unwrap()["draft_id"]
        .as_str()
        .unwrap();

    // Submit a valid signature request structure to the signature endpoint
    // This should NOT return "missing requester_addr" error
    let signature_request = json!({
        "solver_hub_addr": DUMMY_SOLVER_ADDR_HUB,
        "signature": format!("0x{}", "a".repeat(128)), // 128 hex chars = 64 bytes (Ed25519 signature)
        "public_key": format!("0x{}", "b".repeat(64)) // 64 hex chars = 32 bytes (Ed25519 public key)
    });

    let response = request()
        .method("POST")
        .path(&format!("/draftintent/{}/signature", draft_id))
        .json(&signature_request)
        .reply(&routes)
        .await;

    // Should NOT be BAD_REQUEST with "missing requester_addr"
    // (that would mean it hit the wrong route)
    let body: ApiResponse<serde_json::Value> = serde_json::from_slice(response.body()).unwrap();
    if let Some(error) = &body.error {
        assert!(
            !error.contains("requester_addr"),
            "Route matching bug: signature endpoint matched draftintent route. Error: {}",
            error
        );
    }
}
