//! Native GMP Endpoint Program (Native Solana)
//!
//! A native GMP endpoint that can be used for local testing, CI, or production
//! with a trusted relay or DKG-based message verification.
//!
//! ## Purpose
//!
//! This endpoint provides a standardized interface for cross-chain messaging.
//! In production, this can be replaced by LayerZero's endpoint or used directly
//! with your own relay infrastructure.
//!
//! ## Instructions
//!
//! - `Send`: Emit a MessageSent event for the relay to pick up
//! - `DeliverMessage`: Called by relay to deliver messages to destination

use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::{
    account_info::AccountInfo, entrypoint::ProgramResult, msg, pubkey::Pubkey,
};

/// Instructions for the native GMP endpoint.
#[derive(BorshSerialize, BorshDeserialize, Debug, Clone)]
pub enum NativeGmpInstruction {
    /// Send a cross-chain message.
    ///
    /// Emits a `MessageSent` event that the GMP relay monitors.
    /// The relay picks up the event and calls `DeliverMessage` on the
    /// destination chain.
    ///
    /// Accounts expected:
    /// 0. `[signer]` Sender (the program sending the message)
    /// 1. `[signer]` Payer (pays for transaction fees)
    Send {
        /// Destination chain endpoint ID (e.g., Movement = 30325)
        dst_chain_id: u32,
        /// Destination address (32 bytes, the receiving program/module)
        dst_addr: [u8; 32],
        /// Message payload (encoded GMP message)
        payload: Vec<u8>,
    },

    /// Deliver a cross-chain message to a destination program.
    ///
    /// Called by the GMP relay after observing a `MessageSent` event
    /// on the source chain. The relay decodes the event, constructs this
    /// instruction, and submits it to the destination chain.
    ///
    /// Accounts expected:
    /// 0. `[signer]` Relay (authorized relay address)
    /// 1. `[]` Destination program
    /// 2+. Additional accounts required by destination program
    DeliverMessage {
        /// Source chain endpoint ID
        src_chain_id: u32,
        /// Source address (32 bytes, the sending program/module)
        src_addr: [u8; 32],
        /// Message payload (encoded GMP message)
        payload: Vec<u8>,
        /// Nonce for replay protection
        nonce: u64,
    },
}

/// Process instruction entrypoint.
pub fn process_instruction(
    _program_id: &Pubkey,
    _accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    let instruction = NativeGmpInstruction::try_from_slice(instruction_data)
        .map_err(|_| solana_program::program_error::ProgramError::InvalidInstructionData)?;

    match instruction {
        NativeGmpInstruction::Send {
            dst_chain_id,
            dst_addr,
            payload,
        } => {
            process_send(dst_chain_id, dst_addr, payload)
        }
        NativeGmpInstruction::DeliverMessage {
            src_chain_id,
            src_addr,
            payload,
            nonce,
        } => {
            process_deliver_message(src_chain_id, src_addr, payload, nonce)
        }
    }
}

/// Process Send instruction - emit event for relay to pick up.
fn process_send(dst_chain_id: u32, dst_addr: [u8; 32], payload: Vec<u8>) -> ProgramResult {
    // Emit MessageSent event for GMP relay
    // Format: JSON-like for easy parsing by the relay
    msg!(
        "MessageSent: dst_chain_id={}, dst_addr={}, payload_len={}, payload_hex={}",
        dst_chain_id,
        hex_encode(&dst_addr),
        payload.len(),
        hex_encode(&payload)
    );

    Ok(())
}

/// Process DeliverMessage instruction - stub for now.
///
/// In a full implementation, this would:
/// 1. Verify the relay is authorized
/// 2. Check nonce for replay protection
/// 3. CPI into the destination program's lz_receive handler
fn process_deliver_message(
    src_chain_id: u32,
    src_addr: [u8; 32],
    payload: Vec<u8>,
    nonce: u64,
) -> ProgramResult {
    // Log the delivery for debugging
    msg!(
        "MessageDelivered: src_chain_id={}, src_addr={}, nonce={}, payload_len={}",
        src_chain_id,
        hex_encode(&src_addr),
        nonce,
        payload.len()
    );

    // TODO: Verify relay is authorized (check against stored config)
    // TODO: Check nonce for replay protection
    // TODO: CPI into destination program's lz_receive instruction

    Ok(())
}

/// Simple hex encoding for logging (no dependencies).
fn hex_encode(bytes: &[u8]) -> String {
    const HEX_CHARS: &[u8; 16] = b"0123456789abcdef";
    let mut result = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        result.push(HEX_CHARS[(byte >> 4) as usize] as char);
        result.push(HEX_CHARS[(byte & 0x0f) as usize] as char);
    }
    result
}

#[cfg(not(feature = "no-entrypoint"))]
mod entrypoint {
    use solana_program::{
        account_info::AccountInfo, entrypoint, entrypoint::ProgramResult, pubkey::Pubkey,
    };

    entrypoint!(process_instruction);

    pub fn process_instruction(
        program_id: &Pubkey,
        accounts: &[AccountInfo],
        instruction_data: &[u8],
    ) -> ProgramResult {
        super::process_instruction(program_id, accounts, instruction_data)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_send_instruction_serialization() {
        let instruction = NativeGmpInstruction::Send {
            dst_chain_id: 30325,
            dst_addr: [1u8; 32],
            payload: vec![0x01, 0x02, 0x03],
        };

        let encoded = borsh::to_vec(&instruction).unwrap();
        let decoded = NativeGmpInstruction::try_from_slice(&encoded).unwrap();

        match decoded {
            NativeGmpInstruction::Send {
                dst_chain_id,
                dst_addr,
                payload,
            } => {
                assert_eq!(dst_chain_id, 30325);
                assert_eq!(dst_addr, [1u8; 32]);
                assert_eq!(payload, vec![0x01, 0x02, 0x03]);
            }
            _ => panic!("Wrong instruction variant"),
        }
    }

    #[test]
    fn test_deliver_message_instruction_serialization() {
        let instruction = NativeGmpInstruction::DeliverMessage {
            src_chain_id: 30168,
            src_addr: [2u8; 32],
            payload: vec![0x04, 0x05, 0x06],
            nonce: 42,
        };

        let encoded = borsh::to_vec(&instruction).unwrap();
        let decoded = NativeGmpInstruction::try_from_slice(&encoded).unwrap();

        match decoded {
            NativeGmpInstruction::DeliverMessage {
                src_chain_id,
                src_addr,
                payload,
                nonce,
            } => {
                assert_eq!(src_chain_id, 30168);
                assert_eq!(src_addr, [2u8; 32]);
                assert_eq!(payload, vec![0x04, 0x05, 0x06]);
                assert_eq!(nonce, 42);
            }
            _ => panic!("Wrong instruction variant"),
        }
    }
}
