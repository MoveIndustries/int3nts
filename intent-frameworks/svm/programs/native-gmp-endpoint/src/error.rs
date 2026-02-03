//! Error definitions for the native GMP endpoint program.

use solana_program::program_error::ProgramError;
use thiserror::Error;

#[derive(Error, Debug, Clone)]
pub enum GmpError {
    #[error("Invalid instruction data")]
    E_INVALID_INSTRUCTION_DATA,

    #[error("Account not initialized")]
    E_ACCOUNT_NOT_INITIALIZED,

    #[error("Account already initialized")]
    E_ACCOUNT_ALREADY_INITIALIZED,

    #[error("Invalid account discriminator")]
    E_INVALID_DISCRIMINATOR,

    #[error("Invalid PDA")]
    E_INVALID_PDA,

    #[error("Unauthorized: caller is not admin")]
    E_UNAUTHORIZED_ADMIN,

    #[error("Unauthorized: caller is not an authorized relay")]
    E_UNAUTHORIZED_RELAY,

    #[error("Untrusted remote: source chain or address not configured")]
    E_UNTRUSTED_REMOTE,

    #[error("Replay detected: nonce already processed")]
    E_REPLAY_DETECTED,

    #[error("Invalid nonce: expected sequential nonce")]
    E_INVALID_NONCE,

    #[error("Destination program not provided")]
    E_MISSING_DESTINATION_PROGRAM,

    #[error("CPI to destination program failed")]
    E_CPI_DELIVERY_FAILED,

    #[error("Invalid account owner")]
    E_INVALID_ACCOUNT_OWNER,

    #[error("Arithmetic overflow")]
    E_ARITHMETIC_OVERFLOW,
}

impl From<GmpError> for ProgramError {
    fn from(e: GmpError) -> Self {
        ProgramError::Custom(e as u32)
    }
}
