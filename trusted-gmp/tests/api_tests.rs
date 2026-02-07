//! Unit tests for API error handling and request validation
//!
//! These tests verify the trusted GMP service API endpoints work correctly.

use trusted_gmp::api::{ApiResponse, ApiServer};
use trusted_gmp::crypto::CryptoService;
use trusted_gmp::monitor::EventMonitor;
use trusted_gmp::validator::CrossChainValidator;
use warp::http::StatusCode;
use warp::test::request;

#[path = "mod.rs"]
mod test_helpers;

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/// Create a test API server with minimal configuration
async fn create_test_api_server() -> ApiServer {
    let config = test_helpers::build_test_config_with_mvm();
    let monitor = EventMonitor::new(&config).await.unwrap();
    let validator = CrossChainValidator::new(&config).await.unwrap();
    let crypto_service = CryptoService::new(&config).unwrap();

    ApiServer::new(config, monitor, validator, crypto_service)
}

// ============================================================================
// HEALTH ENDPOINT TESTS
// ============================================================================

/// 1. Test: Health Endpoint Returns Success
/// Verifies that the health check endpoint returns OK with success response.
/// Why: Ensures the service is running and responsive to basic health probes.
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

/// 2. Test: Events Endpoint Returns Success
/// Verifies that the events endpoint returns OK with success response.
/// Why: Ensures monitored cross-chain events can be retrieved via the API.
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
// APPROVALS ENDPOINT TESTS
// ============================================================================

/// 3. Test: Approvals Endpoint Returns Success
/// Verifies that the approvals endpoint returns OK with success response.
/// Why: Ensures cached cross-chain approval signatures can be retrieved via the API.
#[tokio::test]
async fn test_approvals_endpoint() {
    let api_server = create_test_api_server().await;
    let routes = api_server.test_routes();

    let response = request()
        .method("GET")
        .path("/approvals")
        .reply(&routes)
        .await;

    assert_eq!(response.status(), StatusCode::OK);
    let body: ApiResponse<serde_json::Value> = serde_json::from_slice(response.body()).unwrap();
    assert!(body.success);
}

// ============================================================================
// PUBLIC KEY ENDPOINT TESTS
// ============================================================================

/// 4. Test: Public Key Endpoint Returns Success
/// Verifies that the public-key endpoint returns OK with the signing key.
/// Why: Ensures the trusted-gmp public key can be retrieved for signature verification.
#[tokio::test]
async fn test_public_key_endpoint() {
    let api_server = create_test_api_server().await;
    let routes = api_server.test_routes();

    let response = request()
        .method("GET")
        .path("/public-key")
        .reply(&routes)
        .await;

    assert_eq!(response.status(), StatusCode::OK);
    let body: ApiResponse<String> = serde_json::from_slice(response.body()).unwrap();
    assert!(body.success);
    assert!(body.data.is_some());
}
