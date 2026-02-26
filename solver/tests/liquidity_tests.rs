//! Unit tests for the LiquidityMonitor service
//!
//! Tests cover budget calculation, reserve/release, threshold checks,
//! timeout cleanup, and chain independence — all in-memory without RPC.

#[path = "helpers.rs"]
mod test_helpers;
use test_helpers::{
    create_default_solver_config, create_mvm_pair_liquidity_config, create_multi_chain_solver_config,
    DUMMY_SOLVER_ADDR_MVMCON, DUMMY_TOKEN_ADDR_HUB, DUMMY_TOKEN_ADDR_MVMCON, GAS_TOKEN_MVM,
};

use solver::config::{
    AcceptanceConfig, LiquidityMonitorConfig, LiquidityThresholdConfig, TokenPairConfig,
};
use solver::service::liquidity::{ChainToken, InFlightCommitment, LiquidityMonitor, TokenLiquidity};
use std::time::Instant;

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/// Set env vars required by LiquidityMonitor::new() for connected chain solver addresses.
/// Safe to call from parallel tests (all set the same deterministic value).
fn set_connected_chain_env_vars() {
    std::env::set_var("SOLVER_MVMCON_ADDR", DUMMY_SOLVER_ADDR_MVMCON);
}

/// Create a LiquidityMonitor from the default test config with acceptance pairs.
/// Sets required env vars and initializes the monitor.
fn create_test_monitor() -> LiquidityMonitor {
    set_connected_chain_env_vars();
    let config = test_solver_config_with_pairs();
    let liq_config = config.liquidity.clone();
    LiquidityMonitor::new(config, liq_config).unwrap()
}

/// Create a SolverConfig with acceptance pairs and full threshold coverage.
/// Includes pairs in both directions so both hub and connected tokens are tracked.
/// Thresholds: 500 for intent tokens, 100 for gas tokens.
fn test_solver_config_with_pairs() -> solver::config::SolverConfig {
    solver::config::SolverConfig {
        acceptance: AcceptanceConfig {
            token_pairs: vec![
                // Inflow: requester offers on connected, solver spends on hub
                TokenPairConfig {
                    source_chain_id: 2,
                    source_token: DUMMY_TOKEN_ADDR_MVMCON.to_string(),
                    target_chain_id: 1,
                    target_token: DUMMY_TOKEN_ADDR_HUB.to_string(),
                    ratio: 1.0,
                },
                // Outflow: requester offers on hub, solver spends on connected
                TokenPairConfig {
                    source_chain_id: 1,
                    source_token: DUMMY_TOKEN_ADDR_HUB.to_string(),
                    target_chain_id: 2,
                    target_token: DUMMY_TOKEN_ADDR_MVMCON.to_string(),
                    ratio: 1.0,
                },
            ],
        },
        liquidity: create_mvm_pair_liquidity_config(),
        ..create_default_solver_config()
    }
}

fn hub_chain_token() -> ChainToken {
    ChainToken {
        chain_id: 1,
        token: DUMMY_TOKEN_ADDR_HUB.to_string(),
    }
}

fn connected_chain_token() -> ChainToken {
    ChainToken {
        chain_id: 2,
        token: DUMMY_TOKEN_ADDR_MVMCON.to_string(),
    }
}

// ============================================================================
// TOKEN LIQUIDITY UNIT TESTS
// ============================================================================

/// Test: available_budget with no in-flight commitments returns full balance
/// Verifies: Budget calculation base case
/// Why: Core budget calculation must be correct when there are no reservations
#[test]
fn test_available_budget_no_in_flight() {
    let liquidity = TokenLiquidity {
        confirmed_balance: 1000,
        last_updated: Instant::now(),
        in_flight: Vec::new(),
    };
    assert_eq!(liquidity.available_budget(), 1000);
}

/// Test: available_budget subtracts in-flight commitments
/// Verifies: Budget reduced by sum of all in-flight amounts
/// Why: Must account for already-reserved funds
#[test]
fn test_available_budget_with_in_flight() {
    let liquidity = TokenLiquidity {
        confirmed_balance: 1000,
        last_updated: Instant::now(),
        in_flight: vec![
            InFlightCommitment {
                draft_id: "d1".to_string(),
                amount: 300,
                committed_at: Instant::now(),
            },
            InFlightCommitment {
                draft_id: "d2".to_string(),
                amount: 200,
                committed_at: Instant::now(),
            },
        ],
    };
    assert_eq!(liquidity.available_budget(), 500);
}

/// Test: available_budget saturates at zero (no underflow)
/// Verifies: saturating_sub prevents panic on overflow
/// Why: In-flight commitments may exceed balance temporarily (e.g., balance dropped)
#[test]
fn test_available_budget_saturating_sub() {
    let liquidity = TokenLiquidity {
        confirmed_balance: 100,
        last_updated: Instant::now(),
        in_flight: vec![InFlightCommitment {
            draft_id: "d1".to_string(),
            amount: 500,
            committed_at: Instant::now(),
        }],
    };
    assert_eq!(liquidity.available_budget(), 0);
}

/// Test: available_budget with zero balance and no in-flight
/// Verifies: Zero balance works correctly
/// Why: Edge case for fresh state before first poll
#[test]
fn test_available_budget_zero_balance() {
    let liquidity = TokenLiquidity {
        confirmed_balance: 0,
        last_updated: Instant::now(),
        in_flight: Vec::new(),
    };
    assert_eq!(liquidity.available_budget(), 0);
}

// ============================================================================
// LIQUIDITY MONITOR RESERVE/RELEASE TESTS
// ============================================================================

/// Test: reserve reduces available budget
/// Verifies: After reserving, budget decreases by reserved amount
/// Why: Core reservation behavior
#[tokio::test]
async fn test_reserve_reduces_budget() {
    let monitor = create_test_monitor();

    let target = hub_chain_token();

    // Manually set balance via the internal state
    {
        let mut state = monitor.state().write().await;
        let liq = state.get_mut(&target).expect("test setup: target token must be in state");
        liq.confirmed_balance = 1000;
    }

    // Reserve 400
    monitor.reserve(&target, "draft-1", 400).await.unwrap();

    assert!(monitor.has_sufficient_budget(&target, 600).await);
    assert!(!monitor.has_sufficient_budget(&target, 601).await);
}

/// Test: release restores budget
/// Verifies: Releasing a reservation makes the budget available again
/// Why: Fulfilled intents should free budget
#[tokio::test]
async fn test_release_restores_budget() {
    let monitor = create_test_monitor();

    let target = hub_chain_token();

    {
        let mut state = monitor.state().write().await;
        let liq = state.get_mut(&target).expect("test setup: target token must be in state");
        liq.confirmed_balance = 1000;
    }

    monitor.reserve(&target, "draft-1", 400).await.unwrap();
    assert!(!monitor.has_sufficient_budget(&target, 700).await);

    monitor.release("draft-1").await;
    assert!(monitor.has_sufficient_budget(&target, 1000).await);
}

/// Test: release of unknown draft_id is a no-op
/// Verifies: Releasing a non-existent draft doesn't panic or corrupt state
/// Why: Idempotent release prevents double-release issues
#[tokio::test]
async fn test_release_unknown_draft_is_noop() {
    let monitor = create_test_monitor();

    let target = hub_chain_token();

    {
        let mut state = monitor.state().write().await;
        let liq = state.get_mut(&target).expect("test setup: target token must be in state");
        liq.confirmed_balance = 1000;
    }

    // Release a draft that was never reserved
    monitor.release("nonexistent-draft").await;

    // Budget should be unchanged
    assert!(monitor.has_sufficient_budget(&target, 1000).await);
}

/// Test: reserve fails when insufficient budget
/// Verifies: Cannot reserve more than available budget
/// Why: Must prevent over-commitment
#[tokio::test]
async fn test_reserve_fails_when_insufficient() {
    let monitor = create_test_monitor();

    let target = hub_chain_token();

    {
        let mut state = monitor.state().write().await;
        let liq = state.get_mut(&target).expect("test setup: target token must be in state");
        liq.confirmed_balance = 100;
    }

    let result = monitor.reserve(&target, "draft-1", 200).await;
    assert!(result.is_err());
    assert!(result.unwrap_err().to_string().contains("Insufficient budget"));
}

/// Test: multiple reserves accumulate correctly
/// Verifies: Sequential reserves stack and reduce budget cumulatively
/// Why: Multiple in-flight intents must all be accounted for
#[tokio::test]
async fn test_multiple_reserves_accumulate() {
    let monitor = create_test_monitor();

    let target = hub_chain_token();

    {
        let mut state = monitor.state().write().await;
        let liq = state.get_mut(&target).expect("test setup: target token must be in state");
        liq.confirmed_balance = 1000;
    }

    monitor.reserve(&target, "draft-1", 300).await.unwrap();
    monitor.reserve(&target, "draft-2", 400).await.unwrap();

    // 1000 - 300 - 400 = 300 remaining
    assert!(monitor.has_sufficient_budget(&target, 300).await);
    assert!(!monitor.has_sufficient_budget(&target, 301).await);

    // Third reserve should fail if it exceeds remaining
    let result = monitor.reserve(&target, "draft-3", 301).await;
    assert!(result.is_err());
}

// ============================================================================
// THRESHOLD TESTS
// ============================================================================

/// Test: is_above_threshold returns true when budget exceeds configured minimum
/// Verifies: Threshold check passes when balance is sufficient
/// Why: Solver should accept intents when above threshold
#[tokio::test]
async fn test_above_threshold_returns_true() {
    let monitor = create_test_monitor();

    let target = hub_chain_token();

    {
        let mut state = monitor.state().write().await;
        let liq = state.get_mut(&target).expect("test setup: target token must be in state");
        liq.confirmed_balance = 1000; // well above 500 threshold
    }

    assert!(monitor.is_above_threshold(&target).await);
}

/// Test: is_above_threshold returns false when budget is below minimum
/// Verifies: Threshold check fails when balance drops below configured minimum
/// Why: Solver should reject intents when critically low
#[tokio::test]
async fn test_below_threshold_returns_false() {
    let monitor = create_test_monitor();

    let target = hub_chain_token();

    {
        let mut state = monitor.state().write().await;
        let liq = state.get_mut(&target).expect("test setup: target token must be in state");
        liq.confirmed_balance = 200; // below 500 threshold
    }

    assert!(!monitor.is_above_threshold(&target).await);
}

/// Test: is_above_threshold panics when no threshold is configured
/// Verifies: Missing threshold is a bug (startup validation should have caught it)
/// Why: Every token the solver operates on must have an explicit threshold
#[tokio::test]
#[should_panic(expected = "BUG: no liquidity threshold")]
async fn test_no_threshold_configured_panics() {
    let monitor = create_test_monitor();

    // Use a token that is tracked in state but has no threshold configured
    let unconfigured = ChainToken {
        chain_id: 1,
        token: "0x0000000000000000000000000000000000000000000000000000000000ffffff".to_string(),
    };

    // Manually add to state so the token is tracked
    {
        let mut state = monitor.state().write().await;
        state.insert(unconfigured.clone(), TokenLiquidity {
            confirmed_balance: 1000,
            last_updated: Instant::now(),
            in_flight: Vec::new(),
        });
    }

    // This must panic — missing threshold is a startup validation bug
    monitor.is_above_threshold(&unconfigured).await;
}

/// Test: is_above_threshold accounts for in-flight reservations
/// Verifies: Threshold check uses available_budget (balance - in_flight), not just balance
/// Why: In-flight commitments reduce effective liquidity
#[tokio::test]
async fn test_threshold_accounts_for_in_flight() {
    let monitor = create_test_monitor();

    let target = hub_chain_token();

    {
        let mut state = monitor.state().write().await;
        let liq = state.get_mut(&target).expect("test setup: target token must be in state");
        liq.confirmed_balance = 700; // above 500 threshold
    }

    // Above threshold before reservation
    assert!(monitor.is_above_threshold(&target).await);

    // Reserve 300 → available = 400 (below 500 threshold)
    monitor.reserve(&target, "draft-1", 300).await.unwrap();

    assert!(!monitor.is_above_threshold(&target).await);
}

// ============================================================================
// CHAIN INDEPENDENCE TESTS
// ============================================================================

/// Test: reservations on one chain don't affect another chain
/// Verifies: Budget tracking is per (chain_id, token)
/// Why: Cross-chain budgets must be independent
#[tokio::test]
async fn test_chain_independence() {
    let monitor = create_test_monitor();

    let hub_token = hub_chain_token();
    let connected_token = connected_chain_token();

    {
        let mut state = monitor.state().write().await;
        let liq = state.get_mut(&hub_token).expect("test setup: hub token must be in state");
        liq.confirmed_balance = 1000;
        let liq = state.get_mut(&connected_token).expect("test setup: connected token must be in state");
        liq.confirmed_balance = 500;
    }

    // Reserve on hub chain
    monitor.reserve(&hub_token, "draft-hub", 800).await.unwrap();

    // Connected chain budget should be unaffected
    assert!(monitor.has_sufficient_budget(&connected_token, 500).await);

    // Hub chain should have 200 remaining
    assert!(monitor.has_sufficient_budget(&hub_token, 200).await);
    assert!(!monitor.has_sufficient_budget(&hub_token, 201).await);
}

// ============================================================================
// HAS_SUFFICIENT_BUDGET TESTS
// ============================================================================

/// Test: has_sufficient_budget returns false for unknown chain+token
/// Verifies: Conservative denial for untracked tokens
/// Why: Must not silently accept intents for tokens we don't monitor
#[tokio::test]
async fn test_has_sufficient_budget_unknown_token() {
    let monitor = create_test_monitor();

    let unknown = ChainToken {
        chain_id: 999,
        token: "0xunknown".to_string(),
    };

    assert!(!monitor.has_sufficient_budget(&unknown, 1).await);
}

/// Test: has_sufficient_budget allows zero amount
/// Verifies: Zero-amount check passes with zero balance
/// Why: Edge case
#[tokio::test]
async fn test_has_sufficient_budget_zero_amount() {
    let monitor = create_test_monitor();

    let target = hub_chain_token();
    // Balance is 0 (initial), checking for 0 amount
    assert!(monitor.has_sufficient_budget(&target, 0).await);
}

// ============================================================================
// CONFIG VALIDATION TESTS
// ============================================================================

/// Test: config validation rejects zero balance_poll_interval_ms
/// Verifies: Must have positive poll interval
/// Why: Zero interval would spin CPU
#[test]
fn test_config_rejects_zero_poll_interval() {
    let mut config = test_solver_config_with_pairs();
    config.liquidity.balance_poll_interval_ms = 0;
    assert!(config.validate().is_err());
}

/// Test: config validation rejects zero in_flight_timeout_secs
/// Verifies: Must have positive timeout
/// Why: Zero timeout would immediately expire all commitments
#[test]
fn test_config_rejects_zero_timeout() {
    let mut config = test_solver_config_with_pairs();
    config.liquidity.in_flight_timeout_secs = 0;
    assert!(config.validate().is_err());
}

/// Test: config validation rejects threshold with unknown chain_id
/// Verifies: Thresholds must reference configured chains
/// Why: Threshold for non-existent chain is a config error
#[test]
fn test_config_rejects_unknown_threshold_chain_id() {
    let mut config = test_solver_config_with_pairs();
    config.liquidity.thresholds.push(LiquidityThresholdConfig {
        chain_id: 999,
        token: DUMMY_TOKEN_ADDR_HUB.to_string(),
        min_balance: 100,
    });
    assert!(config.validate().is_err());
}

/// Test: config validation rejects threshold with zero min_balance
/// Verifies: min_balance must be positive
/// Why: Zero threshold is meaningless
#[test]
fn test_config_rejects_zero_min_balance() {
    let mut config = test_solver_config_with_pairs();
    config.liquidity.thresholds[0].min_balance = 0;
    assert!(config.validate().is_err());
}

/// Test: config with acceptance pairs but no thresholds fails validation
/// Verifies: Every acceptance target token must have a threshold
/// Why: Solver must not operate without threshold guards for tokens it spends
#[test]
fn test_config_rejects_missing_target_token_threshold() {
    let mut config = test_solver_config_with_pairs();
    config.liquidity = LiquidityMonitorConfig {
        balance_poll_interval_ms: 10_000,
        in_flight_timeout_secs: 300,
        thresholds: Vec::new(),
    };
    let result = config.validate();
    assert!(result.is_err());
    assert!(result.unwrap_err().to_string().contains("no [[liquidity.threshold]]"));
}

/// Test: config with acceptance pairs but missing gas token threshold fails validation
/// Verifies: Every chain referenced in acceptance pairs must have a gas token threshold
/// Why: Solver needs gas on every chain it operates on
#[test]
fn test_config_rejects_missing_gas_token_threshold() {
    let mut config = test_solver_config_with_pairs();
    // Keep only intent token thresholds, remove gas token thresholds
    config.liquidity.thresholds.retain(|t| t.token != GAS_TOKEN_MVM);
    let result = config.validate();
    assert!(result.is_err());
    assert!(result.unwrap_err().to_string().contains("gas token"));
}

// ============================================================================
// GAS TOKEN FOR CHAIN TESTS
// ============================================================================

/// Test: gas_token_for_chain returns MOVE sentinel for hub chain
/// Verifies: Hub chain (MVM) maps to full 32-byte FA metadata address
/// Why: Movement native gas token is identified by FA metadata
#[test]
fn test_gas_token_hub_chain() {
    let config = create_multi_chain_solver_config();
    let liq_config = config.liquidity.clone();
    let monitor = LiquidityMonitor::new(config, liq_config).unwrap();

    let gas = monitor.gas_token_for_chain(1);
    assert_eq!(gas.chain_id, 1);
    assert_eq!(gas.token, GAS_TOKEN_MVM);
}

/// Test: gas_token_for_chain returns MOVE sentinel for connected MVM chain
/// Verifies: Connected MVM chain also maps to full 32-byte FA metadata
/// Why: All Move VM chains use MOVE as gas
#[test]
fn test_gas_token_connected_mvm() {
    let config = create_multi_chain_solver_config();
    let liq_config = config.liquidity.clone();
    let monitor = LiquidityMonitor::new(config, liq_config).unwrap();

    let gas = monitor.gas_token_for_chain(2);
    assert_eq!(gas.chain_id, 2);
    assert_eq!(gas.token, GAS_TOKEN_MVM);
}

/// Test: gas_token_for_chain returns ETH zero address for EVM chain
/// Verifies: EVM chains map to the zero address sentinel
/// Why: Native ETH is identified by the zero address
#[test]
fn test_gas_token_connected_evm() {
    let config = create_multi_chain_solver_config();
    let liq_config = config.liquidity.clone();
    let monitor = LiquidityMonitor::new(config, liq_config).unwrap();

    let gas = monitor.gas_token_for_chain(3);
    assert_eq!(gas.chain_id, 3);
    assert_eq!(gas.token, "0x0000000000000000000000000000000000000000");
}

/// Test: gas_token_for_chain returns SOL system program for SVM chain
/// Verifies: SVM chains map to the system program sentinel
/// Why: Native SOL is identified by the system program ID
#[test]
fn test_gas_token_connected_svm() {
    let config = create_multi_chain_solver_config();
    let liq_config = config.liquidity.clone();
    let monitor = LiquidityMonitor::new(config, liq_config).unwrap();

    let gas = monitor.gas_token_for_chain(4);
    assert_eq!(gas.chain_id, 4);
    assert_eq!(gas.token, "11111111111111111111111111111111");
}

/// Test: gas_token_for_chain panics for unknown chain
/// Verifies: Unknown chain_id is a bug (startup validation guarantees all chains are known)
/// Why: Missing chain config at runtime means startup validation has a bug
#[test]
#[should_panic(expected = "BUG: no chain config for chain_id")]
fn test_gas_token_unknown_chain_panics() {
    let config = create_multi_chain_solver_config();
    let liq_config = config.liquidity.clone();
    let monitor = LiquidityMonitor::new(config, liq_config).unwrap();

    monitor.gas_token_for_chain(999);
}

// ============================================================================
// HAS_BUDGET_AFTER_SPEND TESTS
// ============================================================================

/// Test: has_budget_after_spend with threshold — must retain threshold after spend
/// Verifies: available >= amount + threshold
/// Why: Spending should not bring balance below the safety threshold
#[tokio::test]
async fn test_has_budget_after_spend_with_threshold() {
    let monitor = create_test_monitor();

    let target = hub_chain_token(); // threshold = 500

    {
        let mut state = monitor.state().write().await;
        let liq = state.get_mut(&target).expect("test setup: target token must be in state");
        liq.confirmed_balance = 1000;
    }

    // Can spend 500 (leaves 500 = threshold) → true
    assert!(monitor.has_budget_after_spend(&target, 500).await);
    // Cannot spend 501 (would leave 499 < threshold) → false
    assert!(!monitor.has_budget_after_spend(&target, 501).await);
}

/// Test: has_budget_after_spend panics when no threshold is configured
/// Verifies: Missing threshold is a bug (startup validation should have caught it)
/// Why: Every token the solver spends must have an explicit threshold
#[tokio::test]
#[should_panic(expected = "BUG: no liquidity state")]
async fn test_has_budget_after_spend_panics_without_threshold() {
    let monitor = create_test_monitor();

    // Use a token that has no threshold and no state — a completely unknown token
    let unconfigured = ChainToken {
        chain_id: 1,
        token: "0x0000000000000000000000000000000000000000000000000000000000ffffff".to_string(),
    };

    // This must panic — missing state/threshold is a startup validation bug
    monitor.has_budget_after_spend(&unconfigured, 100).await;
}

/// Test: has_budget_after_spend accounts for in-flight commitments
/// Verifies: In-flight amounts reduce available budget for threshold check
/// Why: Must consider already-reserved funds
#[tokio::test]
async fn test_has_budget_after_spend_with_in_flight() {
    let monitor = create_test_monitor();

    let target = hub_chain_token(); // threshold = 500

    {
        let mut state = monitor.state().write().await;
        let liq = state.get_mut(&target).expect("test setup: target token must be in state");
        liq.confirmed_balance = 1200;
    }

    // Reserve 300 → available = 900
    monitor.reserve(&target, "draft-1", 300).await.unwrap();

    // Can spend 400 (leaves 500 = threshold) → true
    assert!(monitor.has_budget_after_spend(&target, 400).await);
    // Cannot spend 401 (would leave 499 < threshold) → false
    assert!(!monitor.has_budget_after_spend(&target, 401).await);
}

/// Test: has_budget_after_spend panics for unknown chain+token
/// Verifies: Unknown tokens are a bug, not a runtime condition
/// Why: Untracked tokens indicate startup validation missed something
#[tokio::test]
#[should_panic(expected = "BUG: no liquidity state")]
async fn test_has_budget_after_spend_unknown_token_panics() {
    let monitor = create_test_monitor();

    let unknown = ChainToken {
        chain_id: 999,
        token: "0xunknown".to_string(),
    };

    // This must panic — unknown token is a startup validation bug
    monitor.has_budget_after_spend(&unknown, 1).await;
}
