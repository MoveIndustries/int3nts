/// GMP message encoding/decoding per the wire format specification.
///
/// All messages use fixed-width fields, big-endian integers, and 32-byte addresses.
/// No serialization library — plain bytes readable by Move, Rust, and Solidity.

/// Message type discriminators.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum GmpMessageType {
    IntentRequirements = 0x01,
    EscrowConfirmation = 0x02,
    FulfillmentProof = 0x03,
}

impl GmpMessageType {
    pub fn from_byte(byte: u8) -> Result<Self, GmpError> {
        match byte {
            0x01 => Ok(GmpMessageType::IntentRequirements),
            0x02 => Ok(GmpMessageType::EscrowConfirmation),
            0x03 => Ok(GmpMessageType::FulfillmentProof),
            _ => Err(GmpError::UnknownMessageType(byte)),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GmpError {
    InvalidMessageType { expected: u8, got: u8 },
    InvalidLength { expected: usize, got: usize },
    UnknownMessageType(u8),
}

impl core::fmt::Display for GmpError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            GmpError::InvalidMessageType { expected, got } => {
                write!(
                    f,
                    "invalid message type: expected 0x{:02x}, got 0x{:02x}",
                    expected, got
                )
            }
            GmpError::InvalidLength { expected, got } => {
                write!(
                    f,
                    "invalid message length: expected {} bytes, got {}",
                    expected, got
                )
            }
            GmpError::UnknownMessageType(t) => {
                write!(f, "unknown message type: 0x{:02x}", t)
            }
        }
    }
}

impl std::error::Error for GmpError {}

// ---------------------------------------------------------------------------
// Message Type 0x01: IntentRequirements
// ---------------------------------------------------------------------------

pub const INTENT_REQUIREMENTS_SIZE: usize = 145;

/// Hub → Connected chain. Sent on intent creation to tell the connected chain
/// what requirements must be met.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IntentRequirements {
    pub intent_id: [u8; 32],
    pub requester_addr: [u8; 32],
    pub amount_required: u64,
    pub token_addr: [u8; 32],
    pub solver_addr: [u8; 32],
    pub expiry: u64,
}

impl IntentRequirements {
    pub fn encode(&self) -> [u8; INTENT_REQUIREMENTS_SIZE] {
        let mut buf = [0u8; INTENT_REQUIREMENTS_SIZE];
        buf[0] = GmpMessageType::IntentRequirements as u8;
        buf[1..33].copy_from_slice(&self.intent_id);
        buf[33..65].copy_from_slice(&self.requester_addr);
        buf[65..73].copy_from_slice(&self.amount_required.to_be_bytes());
        buf[73..105].copy_from_slice(&self.token_addr);
        buf[105..137].copy_from_slice(&self.solver_addr);
        buf[137..145].copy_from_slice(&self.expiry.to_be_bytes());
        buf
    }

    pub fn decode(data: &[u8]) -> Result<Self, GmpError> {
        if data.len() != INTENT_REQUIREMENTS_SIZE {
            return Err(GmpError::InvalidLength {
                expected: INTENT_REQUIREMENTS_SIZE,
                got: data.len(),
            });
        }
        let msg_type = data[0];
        if msg_type != GmpMessageType::IntentRequirements as u8 {
            return Err(GmpError::InvalidMessageType {
                expected: GmpMessageType::IntentRequirements as u8,
                got: msg_type,
            });
        }

        let mut intent_id = [0u8; 32];
        intent_id.copy_from_slice(&data[1..33]);

        let mut requester_addr = [0u8; 32];
        requester_addr.copy_from_slice(&data[33..65]);

        let amount_required = u64::from_be_bytes(data[65..73].try_into().unwrap());

        let mut token_addr = [0u8; 32];
        token_addr.copy_from_slice(&data[73..105]);

        let mut solver_addr = [0u8; 32];
        solver_addr.copy_from_slice(&data[105..137]);

        let expiry = u64::from_be_bytes(data[137..145].try_into().unwrap());

        Ok(IntentRequirements {
            intent_id,
            requester_addr,
            amount_required,
            token_addr,
            solver_addr,
            expiry,
        })
    }
}

// ---------------------------------------------------------------------------
// Message Type 0x02: EscrowConfirmation
// ---------------------------------------------------------------------------

pub const ESCROW_CONFIRMATION_SIZE: usize = 137;

/// Connected chain → Hub. Confirms an escrow was created matching the intent
/// requirements. The hub gates solver fulfillment on this confirmation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EscrowConfirmation {
    pub intent_id: [u8; 32],
    pub escrow_id: [u8; 32],
    pub amount_escrowed: u64,
    pub token_addr: [u8; 32],
    pub creator_addr: [u8; 32],
}

impl EscrowConfirmation {
    pub fn encode(&self) -> [u8; ESCROW_CONFIRMATION_SIZE] {
        let mut buf = [0u8; ESCROW_CONFIRMATION_SIZE];
        buf[0] = GmpMessageType::EscrowConfirmation as u8;
        buf[1..33].copy_from_slice(&self.intent_id);
        buf[33..65].copy_from_slice(&self.escrow_id);
        buf[65..73].copy_from_slice(&self.amount_escrowed.to_be_bytes());
        buf[73..105].copy_from_slice(&self.token_addr);
        buf[105..137].copy_from_slice(&self.creator_addr);
        buf
    }

    pub fn decode(data: &[u8]) -> Result<Self, GmpError> {
        if data.len() != ESCROW_CONFIRMATION_SIZE {
            return Err(GmpError::InvalidLength {
                expected: ESCROW_CONFIRMATION_SIZE,
                got: data.len(),
            });
        }
        let msg_type = data[0];
        if msg_type != GmpMessageType::EscrowConfirmation as u8 {
            return Err(GmpError::InvalidMessageType {
                expected: GmpMessageType::EscrowConfirmation as u8,
                got: msg_type,
            });
        }

        let mut intent_id = [0u8; 32];
        intent_id.copy_from_slice(&data[1..33]);

        let mut escrow_id = [0u8; 32];
        escrow_id.copy_from_slice(&data[33..65]);

        let amount_escrowed = u64::from_be_bytes(data[65..73].try_into().unwrap());

        let mut token_addr = [0u8; 32];
        token_addr.copy_from_slice(&data[73..105]);

        let mut creator_addr = [0u8; 32];
        creator_addr.copy_from_slice(&data[105..137]);

        Ok(EscrowConfirmation {
            intent_id,
            escrow_id,
            amount_escrowed,
            token_addr,
            creator_addr,
        })
    }
}

// ---------------------------------------------------------------------------
// Message Type 0x03: FulfillmentProof
// ---------------------------------------------------------------------------

pub const FULFILLMENT_PROOF_SIZE: usize = 81;

/// Either direction. Proves a solver fulfilled the intent, triggering token
/// release on the other chain.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FulfillmentProof {
    pub intent_id: [u8; 32],
    pub solver_addr: [u8; 32],
    pub amount_fulfilled: u64,
    pub timestamp: u64,
}

impl FulfillmentProof {
    pub fn encode(&self) -> [u8; FULFILLMENT_PROOF_SIZE] {
        let mut buf = [0u8; FULFILLMENT_PROOF_SIZE];
        buf[0] = GmpMessageType::FulfillmentProof as u8;
        buf[1..33].copy_from_slice(&self.intent_id);
        buf[33..65].copy_from_slice(&self.solver_addr);
        buf[65..73].copy_from_slice(&self.amount_fulfilled.to_be_bytes());
        buf[73..81].copy_from_slice(&self.timestamp.to_be_bytes());
        buf
    }

    pub fn decode(data: &[u8]) -> Result<Self, GmpError> {
        if data.len() != FULFILLMENT_PROOF_SIZE {
            return Err(GmpError::InvalidLength {
                expected: FULFILLMENT_PROOF_SIZE,
                got: data.len(),
            });
        }
        let msg_type = data[0];
        if msg_type != GmpMessageType::FulfillmentProof as u8 {
            return Err(GmpError::InvalidMessageType {
                expected: GmpMessageType::FulfillmentProof as u8,
                got: msg_type,
            });
        }

        let mut intent_id = [0u8; 32];
        intent_id.copy_from_slice(&data[1..33]);

        let mut solver_addr = [0u8; 32];
        solver_addr.copy_from_slice(&data[33..65]);

        let amount_fulfilled = u64::from_be_bytes(data[65..73].try_into().unwrap());
        let timestamp = u64::from_be_bytes(data[73..81].try_into().unwrap());

        Ok(FulfillmentProof {
            intent_id,
            solver_addr,
            amount_fulfilled,
            timestamp,
        })
    }
}

/// Returns the message type of a raw GMP payload without fully decoding it.
pub fn peek_message_type(data: &[u8]) -> Result<GmpMessageType, GmpError> {
    if data.is_empty() {
        return Err(GmpError::InvalidLength {
            expected: 1,
            got: 0,
        });
    }
    GmpMessageType::from_byte(data[0])
}
