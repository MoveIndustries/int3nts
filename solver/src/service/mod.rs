//! Solver service modules
//!
//! This module contains service implementations for the solver,
//! including the signing service loop, intent tracking, and fulfillment services.

pub mod inflow;
pub mod liquidity;
pub mod outflow;
pub mod reconciliation;
pub mod signing;
pub mod tracker;

// Re-export for convenience
pub use inflow::InflowService;
pub use liquidity::LiquidityMonitor;
pub use outflow::OutflowService;
pub use reconciliation::{
    classify_mismatch, IntentSnapshot, Mismatch, ReconciliationService, RECONCILE_INTERVAL_SECS,
};
pub use signing::{parse_draft_data, SigningService};
pub use tracker::{IntentState, IntentTracker, TrackedIntent};

