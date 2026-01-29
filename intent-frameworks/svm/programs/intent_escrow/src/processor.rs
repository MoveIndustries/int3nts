//! Instruction processing

#![allow(deprecated)] // system_instruction deprecation - will migrate when solana_system_interface is stable

use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    clock::Clock,
    entrypoint::ProgramResult,
    msg,
    program::{invoke, invoke_signed},
    program_error::ProgramError,
    program_pack::Pack,
    pubkey::Pubkey,
    rent::Rent,
    system_instruction,
    sysvar::Sysvar,
};
use spl_token::state::Account as TokenAccount;

use gmp_common::messages::{FulfillmentProof, IntentRequirements};

use crate::{
    error::EscrowError,
    instruction::EscrowInstruction,
    state::{seeds, Escrow, EscrowState, StoredIntentRequirements},
    DEFAULT_EXPIRY_DURATION,
};

pub struct Processor;

impl Processor {
    pub fn process(
        program_id: &Pubkey,
        accounts: &[AccountInfo],
        instruction_data: &[u8],
    ) -> ProgramResult {
        let instruction = EscrowInstruction::try_from_slice(instruction_data)
            .map_err(|_| EscrowError::InvalidInstructionData)?;

        match instruction {
            EscrowInstruction::Initialize { approver } => {
                msg!("Instruction: Initialize");
                Self::process_initialize(program_id, accounts, approver)
            }
            EscrowInstruction::CreateEscrow {
                intent_id,
                amount,
                expiry_duration,
            } => {
                msg!("Instruction: CreateEscrow");
                Self::process_create_escrow(program_id, accounts, intent_id, amount, expiry_duration)
            }
            EscrowInstruction::Claim { intent_id } => {
                msg!("Instruction: Claim - intent_id={:?}", &intent_id[..8]);
                Self::process_claim(program_id, accounts, intent_id)
            }
            EscrowInstruction::Cancel { intent_id } => {
                msg!("Instruction: Cancel");
                Self::process_cancel(program_id, accounts, intent_id)
            }
            EscrowInstruction::LzReceiveRequirements {
                src_chain_id,
                src_addr,
                payload,
            } => {
                msg!("Instruction: LzReceiveRequirements");
                Self::process_lz_receive_requirements(
                    program_id,
                    accounts,
                    src_chain_id,
                    src_addr,
                    payload,
                )
            }
            EscrowInstruction::LzReceiveFulfillmentProof {
                src_chain_id,
                src_addr,
                payload,
            } => {
                msg!("Instruction: LzReceiveFulfillmentProof");
                Self::process_lz_receive_fulfillment_proof(
                    program_id,
                    accounts,
                    src_chain_id,
                    src_addr,
                    payload,
                )
            }
        }
    }

    fn process_initialize(
        program_id: &Pubkey,
        accounts: &[AccountInfo],
        approver: Pubkey,
    ) -> ProgramResult {
        let account_info_iter = &mut accounts.iter();
        let state_account = next_account_info(account_info_iter)?;
        let payer = next_account_info(account_info_iter)?;
        let system_program = next_account_info(account_info_iter)?;

        // Derive state PDA
        let (state_pda, state_bump) =
            Pubkey::find_program_address(&[seeds::STATE_SEED], program_id);
        if state_pda != *state_account.key {
            return Err(EscrowError::InvalidPDA.into());
        }

        // Create state account
        let rent = Rent::get()?;
        let space = EscrowState::LEN;
        let lamports = rent.minimum_balance(space);

        invoke_signed(
            &system_instruction::create_account(
                payer.key,
                state_account.key,
                lamports,
                space as u64,
                program_id,
            ),
            &[payer.clone(), state_account.clone(), system_program.clone()],
            &[&[seeds::STATE_SEED, &[state_bump]]],
        )?;

        // Initialize state
        let state = EscrowState::new(approver);
        state.serialize(&mut &mut state_account.data.borrow_mut()[..])?;

        msg!("Escrow program initialized with approver: {}", approver);
        Ok(())
    }

    fn process_create_escrow(
        program_id: &Pubkey,
        accounts: &[AccountInfo],
        intent_id: [u8; 32],
        amount: u64,
        expiry_duration: Option<i64>,
    ) -> ProgramResult {
        let account_info_iter = &mut accounts.iter();
        let escrow_account = next_account_info(account_info_iter)?;
        let requester = next_account_info(account_info_iter)?;
        let token_mint = next_account_info(account_info_iter)?;
        let requester_token_account = next_account_info(account_info_iter)?;
        let escrow_vault = next_account_info(account_info_iter)?;
        let reserved_solver = next_account_info(account_info_iter)?;
        let token_program = next_account_info(account_info_iter)?;
        let system_program = next_account_info(account_info_iter)?;
        let _rent_sysvar = next_account_info(account_info_iter)?;
        // Optional: requirements account for GMP validation
        let requirements_account = next_account_info(account_info_iter).ok();

        // Validate inputs
        if amount == 0 {
            return Err(EscrowError::InvalidAmount.into());
        }
        if *reserved_solver.key == Pubkey::default() {
            return Err(EscrowError::InvalidSolver.into());
        }
        if !requester.is_signer {
            return Err(ProgramError::MissingRequiredSignature);
        }

        // If requirements account is provided, validate against stored GMP requirements
        let mut stored_requirements: Option<StoredIntentRequirements> = None;
        if let Some(req_account) = requirements_account {
            // Verify it's the correct PDA
            let (req_pda, _) = Pubkey::find_program_address(
                &[seeds::REQUIREMENTS_SEED, &intent_id],
                program_id,
            );
            if req_pda == *req_account.key && req_account.data_len() > 0 {
                let requirements = StoredIntentRequirements::try_from_slice(&req_account.data.borrow())
                    .map_err(|_| EscrowError::RequirementsNotFound)?;

                // Validate escrow matches requirements
                if requirements.escrow_created {
                    return Err(EscrowError::EscrowAlreadyCreated.into());
                }
                if amount < requirements.amount_required {
                    return Err(EscrowError::AmountMismatch.into());
                }
                // Validate token - convert Pubkey to 32-byte array for comparison
                let token_bytes = token_mint.key.to_bytes();
                if token_bytes != requirements.token_addr {
                    return Err(EscrowError::TokenMismatch.into());
                }

                stored_requirements = Some(requirements);
            }
        }

        // Derive escrow PDA
        let (escrow_pda, escrow_bump) =
            Pubkey::find_program_address(&[seeds::ESCROW_SEED, &intent_id], program_id);
        if escrow_pda != *escrow_account.key {
            return Err(EscrowError::InvalidPDA.into());
        }

        // Derive vault PDA
        let (vault_pda, vault_bump) =
            Pubkey::find_program_address(&[seeds::VAULT_SEED, &intent_id], program_id);
        if vault_pda != *escrow_vault.key {
            return Err(EscrowError::InvalidPDA.into());
        }

        // Check if escrow already exists
        if escrow_account.data_len() > 0 {
            // Account exists, try to deserialize it
            if let Ok(existing_escrow) = Escrow::try_from_slice(&escrow_account.data.borrow()) {
                // Check if it's a valid escrow (has correct discriminator)
                if existing_escrow.discriminator == Escrow::DISCRIMINATOR {
                    return Err(EscrowError::EscrowAlreadyExists.into());
                }
            }
        }

        // Calculate expiry
        let clock = Clock::get()?;
        let duration = expiry_duration.unwrap_or(DEFAULT_EXPIRY_DURATION);
        let duration = if duration <= 0 { DEFAULT_EXPIRY_DURATION } else { duration };
        let expiry = clock.unix_timestamp + duration;

        // Create escrow account
        let rent = Rent::get()?;
        let escrow_space = Escrow::LEN;
        let escrow_lamports = rent.minimum_balance(escrow_space);

        invoke_signed(
            &system_instruction::create_account(
                requester.key,
                escrow_account.key,
                escrow_lamports,
                escrow_space as u64,
                program_id,
            ),
            &[requester.clone(), escrow_account.clone(), system_program.clone()],
            &[&[seeds::ESCROW_SEED, &intent_id, &[escrow_bump]]],
        )?;

        // Create vault token account
        let vault_space = TokenAccount::LEN;
        let vault_lamports = rent.minimum_balance(vault_space);

        invoke_signed(
            &system_instruction::create_account(
                requester.key,
                escrow_vault.key,
                vault_lamports,
                vault_space as u64,
                &spl_token::id(),
            ),
            &[requester.clone(), escrow_vault.clone(), system_program.clone()],
            &[&[seeds::VAULT_SEED, &intent_id, &[vault_bump]]],
        )?;

        // Initialize vault token account
        invoke_signed(
            &spl_token::instruction::initialize_account3(
                &spl_token::id(),
                escrow_vault.key,
                token_mint.key,
                escrow_account.key, // escrow PDA is the authority
            )?,
            &[escrow_vault.clone(), token_mint.clone()],
            &[&[seeds::VAULT_SEED, &intent_id, &[vault_bump]]],
        )?;

        // Transfer tokens to vault
        invoke(
            &spl_token::instruction::transfer(
                &spl_token::id(),
                requester_token_account.key,
                escrow_vault.key,
                requester.key,
                &[],
                amount,
            )?,
            &[
                requester_token_account.clone(),
                escrow_vault.clone(),
                requester.clone(),
                token_program.clone(),
            ],
        )?;

        // Initialize escrow state
        let escrow = Escrow::new(
            *requester.key,
            *token_mint.key,
            amount,
            expiry,
            *reserved_solver.key,
            intent_id,
            escrow_bump,
        );
        escrow.serialize(&mut &mut escrow_account.data.borrow_mut()[..])?;

        // If requirements exist, mark escrow as created
        if let (Some(mut requirements), Some(req_account)) = (stored_requirements, requirements_account) {
            requirements.escrow_created = true;
            requirements.serialize(&mut &mut req_account.data.borrow_mut()[..])?;
        }

        msg!(
            "Escrow created: intent_id={:?}, amount={}, expiry={}",
            &intent_id[..8],
            amount,
            expiry
        );
        Ok(())
    }

    /// Process Claim instruction (GMP mode - no signature required).
    /// Requires that the fulfillment proof has been received via GMP.
    fn process_claim(
        program_id: &Pubkey,
        accounts: &[AccountInfo],
        intent_id: [u8; 32],
    ) -> ProgramResult {
        let account_info_iter = &mut accounts.iter();
        let escrow_account = next_account_info(account_info_iter)?;
        let requirements_account = next_account_info(account_info_iter)?;
        let escrow_vault = next_account_info(account_info_iter)?;
        let solver_token_account = next_account_info(account_info_iter)?;
        let token_program = next_account_info(account_info_iter)?;

        // Validate requirements PDA
        let (req_pda, _) = Pubkey::find_program_address(
            &[seeds::REQUIREMENTS_SEED, &intent_id],
            program_id,
        );
        if req_pda != *requirements_account.key {
            return Err(EscrowError::InvalidPDA.into());
        }

        // Load and validate requirements
        let requirements =
            StoredIntentRequirements::try_from_slice(&requirements_account.data.borrow())
                .map_err(|_| EscrowError::RequirementsNotFound)?;

        // GMP mode: require fulfillment proof to have been received
        if !requirements.fulfilled {
            return Err(EscrowError::AlreadyFulfilled.into()); // Not fulfilled yet
        }

        // Deserialize escrow
        let mut escrow = Escrow::try_from_slice(&escrow_account.data.borrow())?;

        // Validate escrow
        if escrow.intent_id != intent_id {
            return Err(EscrowError::EscrowDoesNotExist.into());
        }
        if escrow.is_claimed {
            return Err(EscrowError::EscrowAlreadyClaimed.into());
        }
        if escrow.amount == 0 {
            return Err(EscrowError::NoDeposit.into());
        }

        let clock = Clock::get()?;
        if clock.unix_timestamp > escrow.expiry {
            return Err(EscrowError::EscrowExpired.into());
        }

        // Transfer tokens from vault to solver
        let amount = escrow.amount;
        let escrow_seeds = &[seeds::ESCROW_SEED, &intent_id[..], &[escrow.bump]];

        invoke_signed(
            &spl_token::instruction::transfer(
                &spl_token::id(),
                escrow_vault.key,
                solver_token_account.key,
                escrow_account.key,
                &[],
                amount,
            )?,
            &[
                escrow_vault.clone(),
                solver_token_account.clone(),
                escrow_account.clone(),
                token_program.clone(),
            ],
            &[escrow_seeds],
        )?;

        // Update escrow state
        escrow.is_claimed = true;
        escrow.amount = 0;
        escrow.serialize(&mut &mut escrow_account.data.borrow_mut()[..])?;

        msg!("Escrow claimed: intent_id={:?}, amount={}", &intent_id[..8], amount);
        Ok(())
    }

    fn process_cancel(
        _program_id: &Pubkey,
        accounts: &[AccountInfo],
        intent_id: [u8; 32],
    ) -> ProgramResult {
        let account_info_iter = &mut accounts.iter();
        let escrow_account = next_account_info(account_info_iter)?;
        let requester = next_account_info(account_info_iter)?;
        let escrow_vault = next_account_info(account_info_iter)?;
        let requester_token_account = next_account_info(account_info_iter)?;
        let token_program = next_account_info(account_info_iter)?;

        // Deserialize escrow
        let mut escrow = Escrow::try_from_slice(&escrow_account.data.borrow())?;

        // Validate
        if escrow.intent_id != intent_id {
            return Err(EscrowError::EscrowDoesNotExist.into());
        }
        if escrow.is_claimed {
            return Err(EscrowError::EscrowAlreadyClaimed.into());
        }
        if escrow.amount == 0 {
            return Err(EscrowError::NoDeposit.into());
        }
        if escrow.requester != *requester.key {
            return Err(EscrowError::UnauthorizedRequester.into());
        }
        if !requester.is_signer {
            return Err(ProgramError::MissingRequiredSignature);
        }

        let clock = Clock::get()?;
        if clock.unix_timestamp <= escrow.expiry {
            return Err(EscrowError::EscrowNotExpiredYet.into());
        }

        // Transfer tokens back to requester
        let amount = escrow.amount;
        let escrow_seeds = &[seeds::ESCROW_SEED, &intent_id[..], &[escrow.bump]];

        invoke_signed(
            &spl_token::instruction::transfer(
                &spl_token::id(),
                escrow_vault.key,
                requester_token_account.key,
                escrow_account.key,
                &[],
                amount,
            )?,
            &[
                escrow_vault.clone(),
                requester_token_account.clone(),
                escrow_account.clone(),
                token_program.clone(),
            ],
            &[escrow_seeds],
        )?;

        // Update escrow state
        escrow.is_claimed = true;
        escrow.amount = 0;
        escrow.serialize(&mut &mut escrow_account.data.borrow_mut()[..])?;

        msg!("Escrow cancelled: intent_id={:?}, amount={}", &intent_id[..8], amount);
        Ok(())
    }

    /// Process LzReceiveRequirements instruction.
    /// Stores intent requirements received via GMP from the hub.
    fn process_lz_receive_requirements(
        program_id: &Pubkey,
        accounts: &[AccountInfo],
        _src_chain_id: u32,
        _src_addr: [u8; 32],
        payload: Vec<u8>,
    ) -> ProgramResult {
        let account_info_iter = &mut accounts.iter();
        let requirements_account = next_account_info(account_info_iter)?;
        let gmp_caller = next_account_info(account_info_iter)?;
        let payer = next_account_info(account_info_iter)?;
        let system_program = next_account_info(account_info_iter)?;

        // GMP caller must be a signer (trusted relay or endpoint)
        if !gmp_caller.is_signer {
            return Err(EscrowError::UnauthorizedGmpSource.into());
        }

        // Decode the GMP message
        let requirements = IntentRequirements::decode(&payload)
            .map_err(|_| EscrowError::InvalidGmpMessage)?;

        // Derive requirements PDA
        let (req_pda, req_bump) = Pubkey::find_program_address(
            &[seeds::REQUIREMENTS_SEED, &requirements.intent_id],
            program_id,
        );
        if req_pda != *requirements_account.key {
            return Err(EscrowError::InvalidPDA.into());
        }

        // Check if requirements already exist
        if requirements_account.data_len() > 0 {
            return Err(EscrowError::RequirementsAlreadyExist.into());
        }

        // Create requirements account
        let rent = Rent::get()?;
        let space = StoredIntentRequirements::LEN;
        let lamports = rent.minimum_balance(space);

        invoke_signed(
            &system_instruction::create_account(
                payer.key,
                requirements_account.key,
                lamports,
                space as u64,
                program_id,
            ),
            &[
                payer.clone(),
                requirements_account.clone(),
                system_program.clone(),
            ],
            &[&[seeds::REQUIREMENTS_SEED, &requirements.intent_id, &[req_bump]]],
        )?;

        // Store requirements
        let stored = StoredIntentRequirements::new(
            requirements.intent_id,
            requirements.requester_addr,
            requirements.amount_required,
            requirements.token_addr,
            requirements.solver_addr,
            requirements.expiry,
            req_bump,
        );
        stored.serialize(&mut &mut requirements_account.data.borrow_mut()[..])?;

        msg!(
            "Intent requirements stored: intent_id={:?}, amount={}",
            &requirements.intent_id[..8],
            requirements.amount_required
        );
        Ok(())
    }

    /// Process LzReceiveFulfillmentProof instruction.
    /// Auto-releases escrow when fulfillment proof is received from hub.
    fn process_lz_receive_fulfillment_proof(
        program_id: &Pubkey,
        accounts: &[AccountInfo],
        _src_chain_id: u32,
        _src_addr: [u8; 32],
        payload: Vec<u8>,
    ) -> ProgramResult {
        let account_info_iter = &mut accounts.iter();
        let requirements_account = next_account_info(account_info_iter)?;
        let escrow_account = next_account_info(account_info_iter)?;
        let escrow_vault = next_account_info(account_info_iter)?;
        let solver_token_account = next_account_info(account_info_iter)?;
        let gmp_caller = next_account_info(account_info_iter)?;
        let token_program = next_account_info(account_info_iter)?;

        // GMP caller must be a signer (trusted relay or endpoint)
        if !gmp_caller.is_signer {
            return Err(EscrowError::UnauthorizedGmpSource.into());
        }

        // Decode the GMP message
        let proof = FulfillmentProof::decode(&payload)
            .map_err(|_| EscrowError::InvalidGmpMessage)?;

        // Validate requirements account
        let (req_pda, _) = Pubkey::find_program_address(
            &[seeds::REQUIREMENTS_SEED, &proof.intent_id],
            program_id,
        );
        if req_pda != *requirements_account.key {
            return Err(EscrowError::InvalidPDA.into());
        }

        let mut requirements =
            StoredIntentRequirements::try_from_slice(&requirements_account.data.borrow())
                .map_err(|_| EscrowError::RequirementsNotFound)?;

        if requirements.fulfilled {
            return Err(EscrowError::AlreadyFulfilled.into());
        }

        // Load escrow
        let mut escrow = Escrow::try_from_slice(&escrow_account.data.borrow())?;

        if escrow.intent_id != proof.intent_id {
            return Err(EscrowError::EscrowDoesNotExist.into());
        }
        if escrow.is_claimed {
            return Err(EscrowError::EscrowAlreadyClaimed.into());
        }
        if escrow.amount == 0 {
            return Err(EscrowError::NoDeposit.into());
        }

        // Transfer tokens from vault to solver
        let amount = escrow.amount;
        let escrow_seeds = &[seeds::ESCROW_SEED, &proof.intent_id[..], &[escrow.bump]];

        invoke_signed(
            &spl_token::instruction::transfer(
                &spl_token::id(),
                escrow_vault.key,
                solver_token_account.key,
                escrow_account.key,
                &[],
                amount,
            )?,
            &[
                escrow_vault.clone(),
                solver_token_account.clone(),
                escrow_account.clone(),
                token_program.clone(),
            ],
            &[escrow_seeds],
        )?;

        // Update states
        escrow.is_claimed = true;
        escrow.amount = 0;
        escrow.serialize(&mut &mut escrow_account.data.borrow_mut()[..])?;

        requirements.fulfilled = true;
        requirements.serialize(&mut &mut requirements_account.data.borrow_mut()[..])?;

        msg!(
            "Escrow auto-released via fulfillment proof: intent_id={:?}, amount={}",
            &proof.intent_id[..8],
            amount
        );
        Ok(())
    }
}
