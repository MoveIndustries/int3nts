//! Intent Escrow Program (Native Solana)
//!
//! This program provides escrow functionality for cross-chain intents on Solana.
//! Funds are held in escrow and released to solvers when verifier signature checks out.

pub mod error;
pub mod instruction;
pub mod processor;
pub mod state;

#[cfg(not(feature = "no-entrypoint"))]
mod entrypoint;

pub use solana_program;

// Re-export for tests
pub use error::EscrowError;
pub use instruction::EscrowInstruction;
pub use state::{Escrow, EscrowState};

// Program ID - same as before for compatibility
solana_program::declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

/// Default expiry duration: 2 minutes in seconds
pub const DEFAULT_EXPIRY_DURATION: i64 = 120;
