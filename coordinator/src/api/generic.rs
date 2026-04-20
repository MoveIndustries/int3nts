//! Generic API structures and handlers
//!
//! This module contains shared structures, helper functions, and generic API handlers
//! for the coordinator service. The coordinator API is read-only for blockchain data
//! and provides negotiation routing for draft intents.

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::{debug, error, info, info_span};
use warp::{http::{Method, StatusCode}, Filter, Rejection, Reply};
use warp::hyper::body::Bytes;

use crate::config::Config;
use crate::monitor::EventMonitor;
use crate::storage::DraftintentStore;

// ============================================================================
// SHARED REQUEST/RESPONSE STRUCTURES
// ============================================================================

/// Standardized response structure for all API endpoints.
///
/// This structure provides a consistent response format for all API endpoints,
/// including success/error status and relevant data.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiResponse<T> {
    /// Whether the request was successful
    pub success: bool,
    /// Response data (if successful)
    pub data: Option<T>,
    /// Error message (if failed)
    pub error: Option<String>,
}

// ============================================================================
// GENERIC API HANDLERS
// ============================================================================

/// Handler for the events endpoint.
///
/// This function retrieves all cached events from the event monitor
/// and returns them as a JSON response.
///
/// # Arguments
///
/// * `monitor` - The event monitor instance
///
/// # Returns
///
/// * `Ok(warp::Reply)` - JSON response with cached events
/// * `Err(warp::Rejection)` - Failed to retrieve events
pub async fn get_events_handler(
    monitor: Arc<RwLock<EventMonitor>>,
) -> Result<impl warp::Reply, warp::Rejection> {
    let monitor = monitor.read().await;
    let intent_events = monitor.get_cached_events().await;
    let fulfillment_events = monitor.get_cached_fulfillment_events().await;

    #[derive(Debug, Serialize)]
    struct CombinedEvents {
        intent_events: Vec<crate::monitor::IntentEvent>,
        fulfillment_events: Vec<crate::monitor::FulfillmentEvent>,
    }

    let combined = CombinedEvents {
        intent_events,
        fulfillment_events,
    };

    Ok(warp::reply::json(&ApiResponse {
        success: true,
        data: Some(combined),
        error: None,
    }))
}

/// Response structure for exchange rate query
#[derive(Debug, Serialize, Deserialize)]
pub struct ExchangeRateResponse {
    /// Desired token metadata address
    pub desired_token: String,
    /// Desired chain ID
    pub desired_chain_id: u64,
    /// Exchange rate (how many offered tokens per 1 desired token)
    pub exchange_rate: f64,
    /// Base fee in MOVE smallest units (covers solver gas costs).
    /// The frontend converts this to the offered token using move_rate.
    pub base_fee_in_move: u64,
    /// Exchange rate for MOVE → offered token (how many offered tokens per 1 MOVE).
    /// Used by the frontend to convert base_fee_in_move to offered token units.
    pub move_rate: f64,
    /// Fee in basis points (e.g., 50 = 0.5%, covers solver opportunity cost)
    pub fee_bps: u64,
}

/// Response structure for relay health query
#[derive(Debug, Serialize, Deserialize)]
pub struct RelayHealthEntry {
    pub chain_id: u64,
    pub chain_name: String,
    pub relay_address: String,
    pub balance_wei: String,
    pub healthy: bool,
}

/// Handler for the /relay-health endpoint.
/// Returns the relay address and native balance per EVM connected chain so the
/// frontend can warn users before submission when the relay is under-funded.
pub async fn get_relay_health_handler(
    config: Arc<crate::config::Config>,
) -> Result<impl warp::Reply, warp::Rejection> {
    let mut entries: Vec<RelayHealthEntry> = Vec::new();

    // Hub (MVM)
    if let Some(relay_addr) = config.hub_chain.relay_address.as_ref() {
        let balance = query_mvm_balance(&config.hub_chain.rpc_url, relay_addr)
            .await
            .unwrap_or_else(|e| {
                tracing::warn!("relay-health: MVM hub balance query failed: {}", e);
                0
            });
        entries.push(RelayHealthEntry {
            chain_id: config.hub_chain.chain_id,
            chain_name: config.hub_chain.name.clone(),
            relay_address: relay_addr.clone(),
            balance_wei: balance.to_string(),
            healthy: balance > 0,
        });
    }

    // Connected EVM chains
    for evm in &config.connected_chain_evm {
        let Some(relay_addr) = evm.relay_address.as_ref() else {
            continue;
        };
        let balance_hex = match query_evm_balance(&evm.rpc_url, relay_addr).await {
            Ok(b) => b,
            Err(e) => {
                tracing::warn!("relay-health: EVM balance query failed for {}: {}", evm.name, e);
                continue;
            }
        };
        let balance = u128::from_str_radix(balance_hex.trim_start_matches("0x"), 16).unwrap_or(0);
        entries.push(RelayHealthEntry {
            chain_id: evm.chain_id,
            chain_name: evm.name.clone(),
            relay_address: relay_addr.clone(),
            balance_wei: balance.to_string(),
            healthy: balance > 0,
        });
    }

    // Connected SVM chains
    for svm in &config.connected_chain_svm {
        let Some(relay_addr) = svm.relay_address.as_ref() else {
            continue;
        };
        let balance = match query_svm_balance(&svm.rpc_url, relay_addr).await {
            Ok(b) => b,
            Err(e) => {
                tracing::warn!("relay-health: SVM balance query failed for {}: {}", svm.name, e);
                continue;
            }
        };
        entries.push(RelayHealthEntry {
            chain_id: svm.chain_id,
            chain_name: svm.name.clone(),
            relay_address: relay_addr.clone(),
            balance_wei: balance.to_string(),
            healthy: balance > 0,
        });
    }

    Ok(warp::reply::json(&ApiResponse::<Vec<RelayHealthEntry>> {
        success: true,
        data: Some(entries),
        error: None,
    }))
}

async fn query_svm_balance(rpc_url: &str, address: &str) -> anyhow::Result<u128> {
    let req = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "getBalance",
        "params": [address]
    });
    let resp: serde_json::Value = reqwest::Client::new()
        .post(rpc_url)
        .json(&req)
        .send()
        .await?
        .json()
        .await?;
    Ok(resp
        .get("result")
        .and_then(|r| r.get("value"))
        .and_then(|v| v.as_u64())
        .unwrap_or(0) as u128)
}

async fn query_mvm_balance(rpc_url: &str, address: &str) -> anyhow::Result<u128> {
    let view_url = format!("{}/view", rpc_url.trim_end_matches('/'));
    let body = serde_json::json!({
        "function": "0x1::coin::balance",
        "type_arguments": ["0x1::aptos_coin::AptosCoin"],
        "arguments": [address]
    });
    let resp: serde_json::Value = reqwest::Client::new()
        .post(&view_url)
        .json(&body)
        .send()
        .await?
        .json()
        .await?;
    let balance_str = resp.as_array()
        .and_then(|a| a.get(0))
        .and_then(|v| v.as_str())
        .ok_or_else(|| anyhow::anyhow!("unexpected MVM view response: {}", resp))?;
    Ok(balance_str.parse::<u128>().unwrap_or(0))
}

async fn query_evm_balance(rpc_url: &str, address: &str) -> anyhow::Result<String> {
    let req = serde_json::json!({
        "jsonrpc": "2.0",
        "method": "eth_getBalance",
        "params": [address, "latest"],
        "id": 1
    });
    let resp: serde_json::Value = reqwest::Client::new()
        .post(rpc_url)
        .json(&req)
        .send()
        .await?
        .json()
        .await?;
    resp.get("result")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| anyhow::anyhow!("no result in RPC response: {}", resp))
}

/// Handler for the acceptance/exchange rate endpoint.
///
/// Query parameters:
/// - offered_chain_id: Chain ID of the offered token
/// - offered_token: Metadata address of the offered token
/// - desired_chain_id: Chain ID of the desired token (optional - if not provided, returns first match)
/// - desired_token: Metadata address of the desired token (optional - if not provided, returns first match)
///
/// Returns the desired token, desired chain ID, and exchange rate.
///
/// Exchange rates are fetched live from the solver to avoid stale ratios.
pub async fn get_exchange_rate_handler(
    config: Arc<crate::config::Config>,
    query: String,
) -> Result<impl warp::Reply, warp::Rejection> {
    use std::collections::HashMap;
    use url::Url;

    // Parse query parameters
    let parsed = Url::parse(&format!("http://dummy?{}", query))
        .map_err(|e| warp::reject::custom(JsonDeserializeError(format!("Invalid query string: {}", e))))?;

    let params: HashMap<String, String> = parsed
        .query_pairs()
        .into_owned()
        .collect();

    let offered_chain_id = params.get("offered_chain_id")
        .ok_or_else(|| warp::reject::custom(JsonDeserializeError("Missing offered_chain_id parameter".to_string())))?;
    let offered_token = params.get("offered_token")
        .ok_or_else(|| warp::reject::custom(JsonDeserializeError("Missing offered_token parameter".to_string())))?;

    let desired_chain_id = params.get("desired_chain_id");
    let desired_token = params.get("desired_token");

    // Get acceptance config
    let acceptance = config.acceptance.as_ref()
        .ok_or_else(|| warp::reject::custom(JsonDeserializeError("Acceptance criteria not configured".to_string())))?;

    // Find matching pair in coordinator's configured list
    let offered_chain_id_u64 = offered_chain_id
        .parse::<u64>()
        .map_err(|e| warp::reject::custom(JsonDeserializeError(format!("Invalid offered_chain_id: {}", e))))?;

    let matched_pair = if let (Some(d_chain_id), Some(d_token)) = (desired_chain_id, desired_token) {
        let desired_chain_id_u64 = d_chain_id
            .parse::<u64>()
            .map_err(|e| warp::reject::custom(JsonDeserializeError(format!("Invalid desired_chain_id: {}", e))))?;
        acceptance.pairs.iter().find(|pair| {
            pair.source_chain_id == offered_chain_id_u64
                && pair.source_token == *offered_token
                && pair.target_chain_id == desired_chain_id_u64
                && pair.target_token == *d_token
        })
    } else {
        acceptance.pairs.iter().find(|pair| {
            pair.source_chain_id == offered_chain_id_u64
                && pair.source_token == *offered_token
        })
    }.ok_or_else(|| {
        warp::reject::custom(JsonDeserializeError(format!(
            "No exchange rate found for offered token {} on chain {}",
            offered_token, offered_chain_id
        )))
    })?;

    // Fetch live ratio from solver
    let solver_url = acceptance.solver_url.trim_end_matches('/');
    let solver_request = format!(
        "{}/acceptance?offered_chain_id={}&offered_token={}&desired_chain_id={}&desired_token={}",
        solver_url,
        matched_pair.source_chain_id,
        matched_pair.source_token,
        matched_pair.target_chain_id,
        matched_pair.target_token,
    );

    let response = reqwest::get(&solver_request).await
        .map_err(|e| warp::reject::custom(JsonDeserializeError(format!("Solver request failed: {}", e))))?;
    let status = response.status();
    if !status.is_success() {
        return Err(warp::reject::custom(JsonDeserializeError(format!(
            "Solver returned error status {}",
            status
        ))));
    }

    let solver_response: ApiResponse<ExchangeRateResponse> = response.json().await
        .map_err(|e| warp::reject::custom(JsonDeserializeError(format!("Invalid solver response: {}", e))))?;
    let exchange_rate = solver_response.data.ok_or_else(|| {
        warp::reject::custom(JsonDeserializeError("Solver response missing data".to_string()))
    })?;

    Ok(warp::reply::json(&ApiResponse::<ExchangeRateResponse> {
        success: true,
        data: Some(exchange_rate),
        error: None,
    }))
}

// ============================================================================
// WARP FILTER HELPERS
// ============================================================================

/// Creates a warp filter that provides access to the event monitor.
///
/// This helper function creates a filter that injects the event monitor
/// into request handlers.
///
/// # Arguments
///
/// * `monitor` - The event monitor instance
///
/// # Returns
///
/// A warp filter that provides the monitor to handlers
pub fn with_monitor(
    monitor: Arc<RwLock<EventMonitor>>,
) -> impl Filter<Extract = (Arc<RwLock<EventMonitor>>,), Error = std::convert::Infallible> + Clone {
    warp::any().map(move || monitor.clone())
}

// ============================================================================
// CUSTOM REJECTION TYPES
// ============================================================================

/// Custom rejection for JSON deserialization errors
#[derive(Debug)]
pub struct JsonDeserializeError(pub String);

impl warp::reject::Reject for JsonDeserializeError {}

// ============================================================================
// CORS CONFIGURATION
// ============================================================================

/// Creates a CORS filter based on the configured allowed origins.
fn create_cors_filter(allowed_origins: &[String]) -> warp::cors::Builder {
    let methods = vec![
        Method::GET,
        Method::POST,
        Method::PUT,
        Method::DELETE,
        Method::OPTIONS,
    ];

    if allowed_origins.contains(&"*".to_string()) {
        warp::cors()
            .allow_any_origin()
            .allow_methods(methods.clone())
            .allow_headers(vec!["content-type"])
    } else {
        let origins: Vec<&str> = allowed_origins.iter().map(|s| s.as_str()).collect();
        warp::cors()
            .allow_origins(origins)
            .allow_methods(methods)
            .allow_headers(vec!["content-type"])
    }
}

// ============================================================================
// REJECTION HANDLER
// ============================================================================

/// Global rejection handler for all API routes.
///
/// This function handles all warp rejections and converts them into
/// standardized API responses with appropriate HTTP status codes.
///
/// # Arguments
///
/// * `rej` - The warp rejection to handle
///
/// # Returns
///
/// A warp reply with an error response
pub async fn handle_rejection(rej: Rejection) -> Result<impl Reply, std::convert::Infallible> {
    let (status, message) = if let Some(err) = rej.find::<JsonDeserializeError>() {
        (StatusCode::BAD_REQUEST, err.0.clone())
    } else if let Some(err) = rej.find::<warp::filters::body::BodyDeserializeError>() {
        (StatusCode::BAD_REQUEST, format!("Invalid JSON: {}", err))
    } else if rej.is_not_found() {
        (StatusCode::NOT_FOUND, "Endpoint not found".to_string())
    } else if rej.find::<warp::reject::MethodNotAllowed>().is_some() {
        (StatusCode::METHOD_NOT_ALLOWED, "Method not allowed".to_string())
    } else {
        error!(action = "unhandled_rejection", "Unhandled rejection: {:?}", rej);
        (StatusCode::INTERNAL_SERVER_ERROR, "Internal server error".to_string())
    };

    Ok(warp::reply::with_status(
        warp::reply::json(&ApiResponse::<()> {
            success: false,
            data: None,
            error: Some(message),
        }),
        status,
    ))
}

// ============================================================================
// API SERVER IMPLEMENTATION
// ============================================================================

/// REST API server for the coordinator service.
///
/// This server exposes HTTP endpoints for external systems to interact with
/// the coordinator service, including event monitoring (read-only) and
/// negotiation routing for draft intents.
///
/// ## Security Model
///
/// The coordinator has NO private keys and CANNOT generate signatures.
/// Cross-chain message relay is handled by the separate Integrated GMP service.
pub struct ApiServer {
    /// Service configuration
    config: Arc<Config>,
    /// Event monitor for blockchain event processing
    monitor: Arc<RwLock<EventMonitor>>,
    /// Draft intent store for negotiation routing
    draft_store: Arc<RwLock<DraftintentStore>>,
}

impl ApiServer {
    /// Creates a new API server with the given components.
    ///
    /// This function initializes the API server with all necessary components
    /// for handling HTTP requests and providing coordinator functionality.
    ///
    /// # Arguments
    ///
    /// * `config` - Service configuration
    /// * `monitor` - Event monitor instance
    ///
    /// # Returns
    ///
    /// A new API server instance
    pub fn new(
        config: Config,
        monitor: EventMonitor,
    ) -> Self {
        Self {
            config: Arc::new(config),
            monitor: Arc::new(RwLock::new(monitor)),
            draft_store: Arc::new(RwLock::new(DraftintentStore::new())),
        }
    }

    /// Starts the API server and begins handling HTTP requests.
    ///
    /// This function configures all API routes and starts the HTTP server
    /// on the configured host and port.
    ///
    /// # Returns
    ///
    /// * `Ok(())` - Server started successfully
    /// * `Err(anyhow::Error)` - Failed to start server
    pub async fn run(&self) -> Result<()> {
        info!(
            "Starting API server on {}:{}",
            self.config.api.host, self.config.api.port
        );

        // Start background draft expiry cleanup (runs every 10 seconds)
        let cleanup_store = self.draft_store.clone();
        tokio::spawn(async move {
            loop {
                tokio::time::sleep(tokio::time::Duration::from_secs(10)).await;
                let store = cleanup_store.read().await;
                store.cleanup_expired().await;
            }
        });

        // Create and configure all API routes
        let routes = self.create_routes();

        // Parse host address from config
        let addr: std::net::SocketAddr = format!("{}:{}", self.config.api.host, self.config.api.port)
            .parse()
            .context("Failed to parse API server address")?;

        // Start the HTTP server
        warp::serve(routes)
            .run(addr)
            .await;

        Ok(())
    }

    /// Creates all API routes for the server.
    ///
    /// This function defines all HTTP endpoints and their handlers,
    /// including health checks, event monitoring (read-only), and
    /// negotiation routing.
    ///
    /// # Returns
    ///
    /// A warp filter containing all API routes
    pub(crate) fn create_routes(
        &self,
    ) -> impl Filter<Extract = impl warp::Reply, Error = std::convert::Infallible> + Clone {
        use super::negotiation;

        let monitor = self.monitor.clone();
        let draft_store = self.draft_store.clone();

        // Health check endpoint - returns service status
        let health = warp::path("health").and(warp::get()).map(|| {
            warp::reply::json(&ApiResponse::<String> {
                success: true,
                data: Some("Coordinator Service is running".to_string()),
                error: None,
            })
        });

        // Get cached events endpoint - returns all monitored events (read-only)
        let events = warp::path("events")
            .and(warp::get())
            .and(with_monitor(monitor.clone()))
            .and_then(get_events_handler);

        // Get exchange rate endpoint - returns desired token and exchange rate for offered token
        let exchange_rate_config = self.config.clone();
        let exchange_rate = warp::path("acceptance")
            .and(warp::get())
            .and(warp::query::raw())
            .and_then(move |query: String| {
                let config = exchange_rate_config.clone();
                async move {
                    get_exchange_rate_handler(config, query).await
                }
            });

        // Relay health endpoint - native balance per EVM relay (pre-flight warning)
        let relay_health_config = self.config.clone();
        let relay_health = warp::path("relay-health")
            .and(warp::get())
            .and_then(move || {
                let config = relay_health_config.clone();
                async move { get_relay_health_handler(config).await }
            });

        // Negotiation routing endpoints
        // POST /draftintent - Submit draft intent (open to any solver)
        let create_draft_store = draft_store.clone();
        let create_draft = warp::path("draftintent")
            .and(warp::path::end()) // Exact match - don't match /draftintent/:id/...
            .and(warp::post())
            .and(warp::body::bytes())
            .and_then(move |body: Bytes| {
                let store = create_draft_store.clone();
                async move {
                    // Log raw request body for debugging
                    let body_str = String::from_utf8_lossy(&body);
                    debug!("POST /draftintent - Received body: {}", body_str);

                    // Deserialize and handle
                    match serde_json::from_slice::<negotiation::DraftintentRequest>(&body) {
                        Ok(request) => negotiation::create_draftintent_handler(request, store).await,
                        Err(e) => {
                            error!("Draft intent deserialization failed: {}. Body: {}", e, body_str);
                            Err(warp::reject::custom(JsonDeserializeError(format!("Invalid JSON: {}", e))))
                        }
                    }
                }
            });

        // GET /draftintent/:id - Get draft intent status
        let get_draft_store = draft_store.clone();
        let get_draft = warp::path("draftintent")
            .and(warp::path::param())
            .and(warp::path::end()) // Exact match - don't match /draftintent/:id/signature
            .and(warp::get())
            .and(negotiation::with_draft_store(get_draft_store))
            .and_then(negotiation::get_draftintent_handler);

        // GET /draftintents/pending - Get all pending drafts (all solvers see all drafts)
        let get_pending_store = draft_store.clone();
        let get_pending = warp::path("draftintents")
            .and(warp::path("pending"))
            .and(warp::get())
            .and(negotiation::with_draft_store(get_pending_store))
            .and_then(negotiation::get_pending_drafts_handler);

        // POST /draftintent/:id/signature - Solver submits signature (FCFS)
        let submit_sig_store = draft_store.clone();
        let submit_sig_config = self.config.clone();
        let submit_signature = warp::path("draftintent")
            .and(warp::path::param())
            .and(warp::path("signature"))
            .and(warp::post())
            .and(warp::body::bytes())
            .and_then(move |draft_id: String, body: Bytes| {
                let store = submit_sig_store.clone();
                let config = submit_sig_config.clone();
                async move {
                    // Log raw request body for debugging
                    let body_str = String::from_utf8_lossy(&body);
                    debug!("POST /draftintent/{}/signature - Received body: {}", draft_id, body_str);

                    // Deserialize and handle
                    match serde_json::from_slice::<negotiation::SignatureSubmissionRequest>(&body) {
                        Ok(request) => negotiation::submit_signature_handler(draft_id, request, store, config).await,
                        Err(e) => {
                            error!("Signature submission deserialization failed: {}. Body: {}", e, body_str);
                            Err(warp::reject::custom(JsonDeserializeError(format!("Invalid JSON: {}", e))))
                        }
                    }
                }
            });

        // GET /draftintent/:id/signature - Requester polls for signature
        let get_sig_store = draft_store.clone();
        let get_sig_config = self.config.clone();
        let get_signature = warp::path("draftintent")
            .and(warp::path::param())
            .and(warp::path("signature"))
            .and(warp::get())
            .and(negotiation::with_draft_store(get_sig_store))
            .and_then(move |draft_id: String, store: Arc<RwLock<DraftintentStore>>| {
                let config = get_sig_config.clone();
                async move {
                    negotiation::get_signature_handler(draft_id, store, config).await
                }
            });

        // Per-request correlation ID: wraps every request in a tracing span
        // containing a unique request_id (UUID v4). All log lines within the
        // request automatically inherit this field, enabling cross-log correlation.
        let correlation = warp::trace(|req: warp::trace::Info| {
            let request_id = uuid::Uuid::new_v4().to_string();
            info_span!(
                "request",
                request_id = %request_id,
                method = %req.method(),
                path = %req.path(),
            )
        });

        // Combine all routes and apply rejection handler
        health
            .or(events)
            .or(create_draft)
            .or(get_draft)
            .or(get_pending)
            .or(submit_signature)
            .or(get_signature)
            .or(exchange_rate)
            .or(relay_health)
            .with(correlation)
            .with(create_cors_filter(&self.config.api.cors_origins))
            .recover(handle_rejection)
    }

    /// Public method for testing - exposes routes for integration tests
    #[allow(dead_code)] // Used by tests
    pub fn test_routes(&self) -> impl Filter<Extract = impl warp::Reply, Error = std::convert::Infallible> + Clone {
        self.create_routes()
    }
}
