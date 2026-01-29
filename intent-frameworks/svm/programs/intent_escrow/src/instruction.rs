//! Instruction definitions

use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::pubkey::Pubkey;

#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub enum EscrowInstruction {
    /// Initialize the escrow program with approver pubkey
    ///
    /// Accounts expected:
    /// 0. `[writable]` State account (PDA)
    /// 1. `[signer]` Payer
    /// 2. `[]` System program
    Initialize { approver: Pubkey },

    /// Create a new escrow and deposit funds atomically
    ///
    /// Accounts expected:
    /// 0. `[writable]` Escrow account (PDA)
    /// 1. `[writable, signer]` Requester
    /// 2. `[]` Token mint
    /// 3. `[writable]` Requester token account
    /// 4. `[writable]` Escrow vault (PDA)
    /// 5. `[]` Reserved solver
    /// 6. `[]` Token program
    /// 7. `[]` System program
    /// 8. `[]` Rent sysvar
    /// 9. `[writable, optional]` Requirements account (PDA) - if present, validates against GMP requirements
    CreateEscrow {
        intent_id: [u8; 32],
        amount: u64,
        expiry_duration: Option<i64>,
    },

    /// Claim escrow funds (GMP mode - no signature required)
    ///
    /// In GMP mode, the fulfillment proof from the hub authorizes the release.
    /// This instruction is called after LzReceiveFulfillmentProof marks the
    /// requirements as fulfilled.
    ///
    /// Accounts expected:
    /// 0. `[writable]` Escrow account (PDA)
    /// 1. `[]` Requirements account (PDA)
    /// 2. `[writable]` Escrow vault (PDA)
    /// 3. `[writable]` Solver token account
    /// 4. `[]` Token program
    Claim { intent_id: [u8; 32] },

    /// Cancel escrow and return funds to requester (only after expiry)
    ///
    /// Accounts expected:
    /// 0. `[writable]` Escrow account (PDA)
    /// 1. `[writable, signer]` Requester
    /// 2. `[writable]` Escrow vault (PDA)
    /// 3. `[writable]` Requester token account
    /// 4. `[]` Token program
    Cancel { intent_id: [u8; 32] },

    /// Receive intent requirements from hub via GMP
    ///
    /// Accounts expected:
    /// 0. `[writable]` Requirements account (PDA)
    /// 1. `[signer]` GMP endpoint or relay (trusted caller)
    /// 2. `[signer]` Payer
    /// 3. `[]` System program
    LzReceiveRequirements {
        /// Source chain ID
        src_chain_id: u32,
        /// Source address (trusted hub address)
        src_addr: [u8; 32],
        /// GMP payload (IntentRequirements message)
        payload: Vec<u8>,
    },

    /// Receive fulfillment proof from hub via GMP (auto-releases escrow)
    ///
    /// Accounts expected:
    /// 0. `[writable]` Requirements account (PDA)
    /// 1. `[writable]` Escrow account (PDA)
    /// 2. `[writable]` Escrow vault (PDA)
    /// 3. `[writable]` Solver token account
    /// 4. `[signer]` GMP endpoint or relay (trusted caller)
    /// 5. `[]` Token program
    LzReceiveFulfillmentProof {
        /// Source chain ID
        src_chain_id: u32,
        /// Source address (trusted hub address)
        src_addr: [u8; 32],
        /// GMP payload (FulfillmentProof message)
        payload: Vec<u8>,
    },
}
