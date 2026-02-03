//! Error types

use solana_program::program_error::ProgramError;
use thiserror::Error;

#[derive(Error, Debug, Copy, Clone)]
pub enum EscrowError {
    #[error("Escrow already claimed")]
    E_ESCROW_ALREADY_CLAIMED,

    #[error("Escrow does not exist")]
    E_ESCROW_DOES_NOT_EXIST,

    #[error("No deposit")]
    E_NO_DEPOSIT,

    #[error("Unauthorized requester")]
    E_UNAUTHORIZED_REQUESTER,

    #[error("Invalid signature")]
    E_INVALID_SIGNATURE,

    #[error("Unauthorized approver")]
    E_UNAUTHORIZED_APPROVER,

    #[error("Escrow expired")]
    E_ESCROW_EXPIRED,

    #[error("Escrow not expired yet")]
    E_ESCROW_NOT_EXPIRED_YET,

    #[error("Invalid amount")]
    E_INVALID_AMOUNT,

    #[error("Invalid solver")]
    E_INVALID_SOLVER,

    #[error("Invalid instruction data")]
    E_INVALID_INSTRUCTION_DATA,

    #[error("Account not initialized")]
    E_ACCOUNT_NOT_INITIALIZED,

    #[error("Invalid PDA")]
    E_INVALID_PDA,

    #[error("Invalid account owner")]
    E_INVALID_ACCOUNT_OWNER,

    #[error("Escrow already exists")]
    E_ESCROW_ALREADY_EXISTS,

    // GMP-related errors
    #[error("Invalid GMP message")]
    E_INVALID_GMP_MESSAGE,

    #[error("Intent requirements not found")]
    E_REQUIREMENTS_NOT_FOUND,

    #[error("Intent requirements already exist")]
    E_REQUIREMENTS_ALREADY_EXIST,

    #[error("Amount mismatch with requirements")]
    E_AMOUNT_MISMATCH,

    #[error("Token mismatch with requirements")]
    E_TOKEN_MISMATCH,

    #[error("Escrow already created for this intent")]
    E_ESCROW_ALREADY_CREATED,

    #[error("Already fulfilled")]
    E_ALREADY_FULFILLED,

    #[error("Unauthorized GMP source")]
    E_UNAUTHORIZED_GMP_SOURCE,
}

impl From<EscrowError> for ProgramError {
    fn from(e: EscrowError) -> Self {
        ProgramError::Custom(e as u32)
    }
}
