//! Error types for the outflow validator program.

use solana_program::program_error::ProgramError;
use thiserror::Error;

#[derive(Error, Debug, Clone, Copy, PartialEq, Eq)]
pub enum OutflowError {
    #[error("Invalid GMP message")]
    E_INVALID_GMP_MESSAGE,

    #[error("Intent requirements not found")]
    E_REQUIREMENTS_NOT_FOUND,

    #[error("Intent requirements already exist")]
    E_REQUIREMENTS_ALREADY_EXIST,

    #[error("Unauthorized solver")]
    E_UNAUTHORIZED_SOLVER,

    #[error("Amount mismatch")]
    E_AMOUNT_MISMATCH,

    #[error("Token mismatch")]
    E_TOKEN_MISMATCH,

    #[error("Recipient mismatch")]
    E_RECIPIENT_MISMATCH,

    #[error("Intent already fulfilled")]
    E_ALREADY_FULFILLED,

    #[error("Intent expired")]
    E_INTENT_EXPIRED,

    #[error("Invalid account owner")]
    E_INVALID_ACCOUNT_OWNER,

    #[error("Invalid PDA")]
    E_INVALID_PDA,
}

impl From<OutflowError> for ProgramError {
    fn from(e: OutflowError) -> Self {
        ProgramError::Custom(e as u32)
    }
}
