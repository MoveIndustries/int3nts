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
    self, AcceptanceConfig, LiquidityMonitorConfig, LiquidityThresholdConfig, TokenPairConfig,
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
            base_fee_in_move: 1_000_000,
            token_pairs: vec![
                // Inflow: requester offers on connected, solver spends on hub
                TokenPairConfig {
                    source_chain_id: 2,
                    source_token: DUMMY_TOKEN_ADDR_MVMCON.to_string(),
                    target_chain_id: 1,
                    target_token: DUMMY_TOKEN_ADDR_HUB.to_string(),
                    ratio: 1.0,
                    fee_bps: 50,
                    move_rate: 1.0,
                },
                // Outflow: requester offers on hub, solver spends on connected
                TokenPairConfig {
                    source_chain_id: 1,
                    source_token: DUMMY_TOKEN_ADDR_HUB.to_string(),
                    target_chain_id: 2,
                    target_token: DUMMY_TOKEN_ADDR_MVMCON.to_string(),
                    ratio: 1.0,
                    fee_bps: 50,
                    move_rate: 1.0,
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

// 1. Test: available_budget with no in-flight commitments returns full balance
// Verifies that available_budget returns the full confirmed_balance when the in_flight list is empty.
// Why: Core budget calculation must be correct when there are no reservations.
#[test]
fn test_available_budget_no_in_flight() {
    let liquidity = TokenLiquidity {
        confirmed_balance: 1000,
        last_updated: Instant::now(),
        in_flight: Vec::new(),
    };
    assert_eq!(liquidity.available_budget(), 1000);
}

// 2. Test: available_budget subtracts in-flight commitments
// Verifies that available_budget returns confirmed_balance minus the sum of all in_flight commitment amounts.
// Why: Must account for already-reserved funds.
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

// 3. Test: available_budget saturates at zero (no underflow)
// Verifies that available_budget uses saturating subtraction and returns zero when in-flight amounts exceed confirmed_balance.
// Why: In-flight commitments may exceed balance temporarily (e.g., balance dropped).
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

// 4. Test: available_budget with zero balance and no in-flight
// Verifies that available_budget returns zero when confirmed_balance is zero and there are no in-flight commitments.
// Why: Edge case for fresh state before first poll.
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

// 5. Test: reserve reduces available budget
// Verifies that reserve records an in-flight commitment that reduces subsequent has_sufficient_budget availability by the reserved amount.
// Why: Core reservation behavior.
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

// 6. Test: release deducts spent amount from confirmed_balance
// Verifies that release removes the in-flight commitment and debits its amount from confirmed_balance so availability reflects the spend before the next balance poll.
// Why: Prevents stale cached balance from inflating available budget between polls.
#[tokio::test]
async fn test_release_deducts_spent_from_confirmed_balance() {
    let monitor = create_test_monitor();

    let target = hub_chain_token();

    {
        let mut state = monitor.state().write().await;
        let liq = state.get_mut(&target).expect("test setup: target token must be in state");
        liq.confirmed_balance = 1000;
    }

    monitor.reserve(&target, "draft-1", 400).await.unwrap();
    // available = 1000 - 400 = 600
    assert!(!monitor.has_sufficient_budget(&target, 700).await);

    monitor.release("draft-1").await;
    // confirmed_balance deducted: 1000 - 400 = 600, in_flight = 0, available = 600
    assert!(monitor.has_sufficient_budget(&target, 600).await);
    assert!(!monitor.has_sufficient_budget(&target, 601).await);
}

// 7. Test: release prevents stale balance from accepting a second draft
// Verifies that after release debits confirmed_balance for a spent reservation, has_budget_after_spend correctly rejects a follow-up draft that would violate the threshold.
// Why: Reproduces the race condition where the solver signed a draft it couldn't cover.
#[tokio::test]
async fn test_release_prevents_stale_balance_over_commitment() {
    let monitor = create_test_monitor();

    let target = connected_chain_token(); // threshold = 500

    {
        let mut state = monitor.state().write().await;
        let liq = state.get_mut(&target).expect("test setup: target token must be in state");
        liq.confirmed_balance = 2_000_000;
    }

    // First intent: reserve 1,000,000 → available = 1,000,000
    monitor.reserve(&target, "draft-1", 1_000_000).await.unwrap();

    // Fulfillment completes, release the reservation.
    // confirmed_balance is deducted: 2,000,000 - 1,000,000 = 1,000,000
    monitor.release("draft-1").await;

    // Second intent tries 1,000,000 — must fail because threshold = 500,
    // so we need available >= 1,000,000 + 500 = 1,500,000, but only 1,000,000.
    assert!(!monitor.has_budget_after_spend(&target, 1_000_000).await.unwrap());
}

// 8. Test: release of unknown draft_id is a no-op
// Verifies that release with a draft_id that was never reserved leaves confirmed_balance and in-flight commitments unchanged.
// Why: Idempotent release prevents double-release issues.
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

// 9. Test: reserve fails when insufficient budget
// Verifies that reserve returns an "Insufficient budget" error when the requested amount exceeds available_budget.
// Why: Must prevent over-commitment.
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

// 10. Test: multiple reserves accumulate correctly
// Verifies that successive reserve calls sum their amounts against available_budget and reject a new reservation that exceeds the remaining budget.
// Why: Multiple in-flight intents must all be accounted for.
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

// 11. Test: is_above_threshold returns true when budget exceeds configured minimum
// Verifies that is_above_threshold returns Ok(true) when available_budget is greater than the configured min_balance for the token.
// Why: Solver should accept intents when above threshold.
#[tokio::test]
async fn test_above_threshold_returns_true() {
    let monitor = create_test_monitor();

    let target = hub_chain_token();

    {
        let mut state = monitor.state().write().await;
        let liq = state.get_mut(&target).expect("test setup: target token must be in state");
        liq.confirmed_balance = 1000; // well above 500 threshold
    }

    assert!(monitor.is_above_threshold(&target).await.unwrap());
}

// 12. Test: is_above_threshold returns false when budget is below minimum
// Verifies that is_above_threshold returns Ok(false) when available_budget is less than the configured min_balance for the token.
// Why: Solver should reject intents when critically low.
#[tokio::test]
async fn test_below_threshold_returns_false() {
    let monitor = create_test_monitor();

    let target = hub_chain_token();

    {
        let mut state = monitor.state().write().await;
        let liq = state.get_mut(&target).expect("test setup: target token must be in state");
        liq.confirmed_balance = 200; // below 500 threshold
    }

    assert!(!monitor.is_above_threshold(&target).await.unwrap());
}

// 13. Test: is_above_threshold returns error when no threshold is configured
// Verifies that is_above_threshold returns an error mentioning "No liquidity threshold" when the queried ChainToken has state but no matching threshold configuration.
// Why: Every token the solver operates on must have an explicit threshold.
#[tokio::test]
async fn test_no_threshold_configured_returns_error() {
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

    // Must return error — missing threshold is a startup validation bug
    let result = monitor.is_above_threshold(&unconfigured).await;
    assert!(result.is_err());
    assert!(result.unwrap_err().to_string().contains("No liquidity threshold"));
}

// 14. Test: is_above_threshold accounts for in-flight reservations
// Verifies that is_above_threshold compares min_balance against available_budget (confirmed_balance minus in-flight), so an active reserve can flip the result from true to false.
// Why: In-flight commitments reduce effective liquidity.
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
    assert!(monitor.is_above_threshold(&target).await.unwrap());

    // Reserve 300 → available = 400 (below 500 threshold)
    monitor.reserve(&target, "draft-1", 300).await.unwrap();

    assert!(!monitor.is_above_threshold(&target).await.unwrap());
}

// ============================================================================
// CHAIN INDEPENDENCE TESTS
// ============================================================================

// 15. Test: reservations on one chain don't affect another chain
// Verifies that reserve updates the budget only for the specified ChainToken and leaves the availability of other (chain_id, token) entries untouched.
// Why: Cross-chain budgets must be independent.
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

// 16. Test: has_sufficient_budget returns false for unknown chain+token
// Verifies that has_sufficient_budget returns false when the queried ChainToken is not tracked in the monitor's state.
// Why: Must not silently accept intents for tokens we don't monitor.
#[tokio::test]
async fn test_has_sufficient_budget_unknown_token() {
    let monitor = create_test_monitor();

    let unknown = ChainToken {
        chain_id: 999,
        token: "0xunknown".to_string(),
    };

    assert!(!monitor.has_sufficient_budget(&unknown, 1).await);
}

// 17. Test: has_sufficient_budget allows zero amount
// Verifies that has_sufficient_budget returns true for a zero amount on a tracked ChainToken regardless of the current balance.
// Why: Edge case.
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

// 18. Test: config validation rejects zero balance_poll_interval_ms
// Verifies that SolverConfig::validate returns an error when liquidity.balance_poll_interval_ms is zero.
// Why: Zero interval would spin CPU.
#[test]
fn test_config_rejects_zero_poll_interval() {
    let mut config = test_solver_config_with_pairs();
    config.liquidity.balance_poll_interval_ms = 0;
    assert!(config.validate().is_err());
}

// 19. Test: config validation rejects zero in_flight_timeout_secs
// Verifies that SolverConfig::validate returns an error when liquidity.in_flight_timeout_secs is zero.
// Why: Zero timeout would immediately expire all commitments.
#[test]
fn test_config_rejects_zero_timeout() {
    let mut config = test_solver_config_with_pairs();
    config.liquidity.in_flight_timeout_secs = 0;
    assert!(config.validate().is_err());
}

// 20. Test: config validation rejects threshold with unknown chain_id
// Verifies that SolverConfig::validate returns an error when a LiquidityThresholdConfig references a chain_id that is not present in the solver's chain configuration.
// Why: Threshold for non-existent chain is a config error.
#[test]
fn test_config_rejects_unknown_threshold_chain_id() {
    let mut config = test_solver_config_with_pairs();
    config.liquidity.thresholds.push(LiquidityThresholdConfig {
        chain_id: 999,
        token: DUMMY_TOKEN_ADDR_HUB.to_string(),
        label: None,
        min_balance: 100,
    });
    assert!(config.validate().is_err());
}

// 21. Test: config validation rejects threshold with zero min_balance
// Verifies that SolverConfig::validate returns an error when any LiquidityThresholdConfig has min_balance set to zero.
// Why: Zero threshold is meaningless.
#[test]
fn test_config_rejects_zero_min_balance() {
    let mut config = test_solver_config_with_pairs();
    config.liquidity.thresholds[0].min_balance = 0;
    assert!(config.validate().is_err());
}

// 22. Test: config with acceptance pairs but no thresholds fails validation
// Verifies that SolverConfig::validate returns a "no [[liquidity.threshold]]" error when acceptance token pairs reference target tokens that have no matching threshold entry.
// Why: Solver must not operate without threshold guards for tokens it spends.
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

// 23. Test: config with acceptance pairs but missing gas token threshold fails validation
// Verifies that SolverConfig::validate returns a "gas token" error when any chain the solver operates on lacks a threshold entry for its native gas token.
// Why: Solver needs gas on every chain it operates on.
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

// 24. Test: gas_token_for_chain returns MOVE sentinel for hub chain
// Verifies that gas_token_for_chain returns a ChainToken whose token field is the MOVE FA sentinel for a Movement hub chain_id.
// Why: Movement native gas token is identified by FA metadata.
#[test]
fn test_gas_token_hub_chain() {
    let config = create_multi_chain_solver_config();
    let liq_config = config.liquidity.clone();
    let monitor = LiquidityMonitor::new(config, liq_config).unwrap();

    let gas = monitor.gas_token_for_chain(1).unwrap();
    assert_eq!(gas.chain_id, 1);
    assert_eq!(gas.token, GAS_TOKEN_MVM);
}

// 25. Test: gas_token_for_chain returns MOVE sentinel for connected MVM chain
// Verifies that gas_token_for_chain returns the MOVE FA sentinel as the gas token for a connected chain whose chain type is MVM.
// Why: All Move VM chains use MOVE as gas.
#[test]
fn test_gas_token_connected_mvm() {
    let config = create_multi_chain_solver_config();
    let liq_config = config.liquidity.clone();
    let monitor = LiquidityMonitor::new(config, liq_config).unwrap();

    let gas = monitor.gas_token_for_chain(2).unwrap();
    assert_eq!(gas.chain_id, 2);
    assert_eq!(gas.token, GAS_TOKEN_MVM);
}

// 26. Test: gas_token_for_chain returns ETH zero address for EVM chain
// Verifies that gas_token_for_chain returns the EVM zero address as the gas token for a connected chain whose chain type is EVM.
// Why: Native ETH is identified by the zero address.
#[test]
fn test_gas_token_connected_evm() {
    let config = create_multi_chain_solver_config();
    let liq_config = config.liquidity.clone();
    let monitor = LiquidityMonitor::new(config, liq_config).unwrap();

    let gas = monitor.gas_token_for_chain(3).unwrap();
    assert_eq!(gas.chain_id, 3);
    assert_eq!(gas.token, "0x0000000000000000000000000000000000000000");
}

// 27. Test: gas_token_for_chain returns SOL system program for SVM chain
// Verifies that gas_token_for_chain returns the Solana system program ID as the gas token for a connected chain whose chain type is SVM.
// Why: Native SOL is identified by the system program ID.
#[test]
fn test_gas_token_connected_svm() {
    let config = create_multi_chain_solver_config();
    let liq_config = config.liquidity.clone();
    let monitor = LiquidityMonitor::new(config, liq_config).unwrap();

    let gas = monitor.gas_token_for_chain(4).unwrap();
    assert_eq!(gas.chain_id, 4);
    assert_eq!(gas.token, "11111111111111111111111111111111");
}

// 28. Test: gas_token_for_chain returns error for unknown chain
// Verifies that gas_token_for_chain returns an error mentioning "No chain config for chain_id" when called with a chain_id that has no configured chain entry.
// Why: Missing chain config at runtime means startup validation has a bug.
#[test]
fn test_gas_token_unknown_chain_returns_error() {
    let config = create_multi_chain_solver_config();
    let liq_config = config.liquidity.clone();
    let monitor = LiquidityMonitor::new(config, liq_config).unwrap();

    let result = monitor.gas_token_for_chain(999);
    assert!(result.is_err());
    assert!(result.unwrap_err().to_string().contains("No chain config for chain_id"));
}

// ============================================================================
// HAS_BUDGET_AFTER_SPEND TESTS
// ============================================================================

// 29. Test: has_budget_after_spend with threshold — must retain threshold after spend
// Verifies that has_budget_after_spend returns Ok(true) only when available_budget minus the requested spend is greater than or equal to the configured min_balance.
// Why: Spending should not bring balance below the safety threshold.
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
    assert!(monitor.has_budget_after_spend(&target, 500).await.unwrap());
    // Cannot spend 501 (would leave 499 < threshold) → false
    assert!(!monitor.has_budget_after_spend(&target, 501).await.unwrap());
}

// 30. Test: has_budget_after_spend returns error when no state exists
// Verifies that has_budget_after_spend returns an error mentioning "No liquidity state" when the queried ChainToken is not tracked in the monitor's state map.
// Why: Every token the solver spends must have an explicit threshold.
#[tokio::test]
async fn test_has_budget_after_spend_returns_error_without_state() {
    let monitor = create_test_monitor();

    // Use a token that has no threshold and no state — a completely unknown token
    let unconfigured = ChainToken {
        chain_id: 1,
        token: "0x0000000000000000000000000000000000000000000000000000000000ffffff".to_string(),
    };

    // Must return error — missing state/threshold is a startup validation bug
    let result = monitor.has_budget_after_spend(&unconfigured, 100).await;
    assert!(result.is_err());
    assert!(result.unwrap_err().to_string().contains("No liquidity state"));
}

// 31. Test: has_budget_after_spend accounts for in-flight commitments
// Verifies that has_budget_after_spend compares the spend against available_budget (confirmed_balance minus in-flight reservations) rather than confirmed_balance alone.
// Why: Must consider already-reserved funds.
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
    assert!(monitor.has_budget_after_spend(&target, 400).await.unwrap());
    // Cannot spend 401 (would leave 499 < threshold) → false
    assert!(!monitor.has_budget_after_spend(&target, 401).await.unwrap());
}

// 32. Test: has_budget_after_spend returns error for unknown chain+token
// Verifies that has_budget_after_spend returns an error mentioning "No liquidity state" when the queried ChainToken references a chain_id or token the monitor does not track.
// Why: Untracked tokens indicate startup validation missed something.
#[tokio::test]
async fn test_has_budget_after_spend_unknown_token_returns_error() {
    let monitor = create_test_monitor();

    let unknown = ChainToken {
        chain_id: 999,
        token: "0xunknown".to_string(),
    };

    // Must return error — unknown token is a startup validation bug
    let result = monitor.has_budget_after_spend(&unknown, 1).await;
    assert!(result.is_err());
    assert!(result.unwrap_err().to_string().contains("No liquidity state"));
}

// ============================================================================
// ERROR PROPAGATION TESTS (replacing former panics)
// ============================================================================

// 33. Test: gas_token_for_chain_type returns error for unknown chain type
// Verifies that config::gas_token_for_chain_type returns an error mentioning "Unknown chain type" when given a chain type string that is not recognized.
// Why: Unknown chain types must propagate errors, not kill the runtime.
#[test]
fn test_gas_token_for_chain_type_returns_error_for_unknown() {
    let result = config::gas_token_for_chain_type("unknown");
    assert!(result.is_err());
    assert!(result.unwrap_err().to_string().contains("Unknown chain type"));
}

// 34. Test: has_budget_after_spend returns error when token is in state but has no threshold
// Verifies that has_budget_after_spend returns an error mentioning "No liquidity threshold" when the ChainToken has a state entry but no matching threshold configuration.
// Why: Exercises the second lookup failure (threshold missing, not state missing).
#[tokio::test]
async fn test_has_budget_after_spend_missing_threshold_returns_error() {
    let monitor = create_test_monitor();

    // Insert a token into state that is NOT in the threshold config
    let unthresholded = ChainToken {
        chain_id: 1,
        token: "0x0000000000000000000000000000000000000000000000000000000000aaaaaa".to_string(),
    };
    {
        let mut state = monitor.state().write().await;
        state.insert(unthresholded.clone(), TokenLiquidity {
            confirmed_balance: 5000,
            last_updated: Instant::now(),
            in_flight: Vec::new(),
        });
    }

    // State exists but threshold doesn't — must return error
    let result = monitor.has_budget_after_spend(&unthresholded, 100).await;
    assert!(result.is_err());
    assert!(result.unwrap_err().to_string().contains("No liquidity threshold"));
}

// 35. Test: config validation catches unknown chain type before runtime
// Verifies that SolverConfig::validate rejects configurations whose acceptance token pairs reference a target_chain_id with no configured connected chain entry.
// Why: Proves that startup validation prevents the runtime errors we fixed.
#[test]
fn test_config_validation_catches_unknown_chain_before_runtime() {
    // Build a config where acceptance references a chain the solver doesn't have
    let mut config = test_solver_config_with_pairs();
    // Add a token pair that targets a chain_id with no connected chain config
    config.acceptance.token_pairs.push(TokenPairConfig {
        source_chain_id: 1,
        source_token: DUMMY_TOKEN_ADDR_HUB.to_string(),
        target_chain_id: 999, // no connected chain for this
        target_token: "0xdeadbeef".to_string(),
        ratio: 1.0,
        fee_bps: 50,
        move_rate: 1.0,
    });
    let result = config.validate();
    assert!(result.is_err(), "validate() must reject acceptance pairs targeting unconfigured chains");
}
