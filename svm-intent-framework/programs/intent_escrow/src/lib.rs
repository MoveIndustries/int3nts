//! Intent Escrow Program
//!
//! This program provides escrow functionality for cross-chain intents on Solana.
//! Funds are held in escrow and released to solvers when verifier signature checks out.
//!
//! Based on the EVM IntentEscrow contract pattern with Ed25519 signature verification.

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

// ============================================================================
// CONSTANTS
// ============================================================================

/// Expiry duration: 2 minutes in seconds (matches EVM EXPIRY_DURATION)
pub const EXPIRY_DURATION: i64 = 120;

// ============================================================================
// PROGRAM
// ============================================================================

#[program]
pub mod intent_escrow {
    use super::*;

    /// Initialize the escrow program with verifier pubkey
    ///
    /// # Arguments
    /// - `ctx`: Context containing the state account to initialize
    /// - `verifier`: Public key of the authorized verifier
    ///
    /// # Returns
    /// - `Ok(())` on success
    pub fn initialize(ctx: Context<Initialize>, verifier: Pubkey) -> Result<()> {
        let state = &mut ctx.accounts.state;
        state.verifier = verifier;
        Ok(())
    }

    /// Create a new escrow and deposit funds atomically
    ///
    /// Expiry is automatically set to `Clock::get()?.unix_timestamp + EXPIRY_DURATION`.
    /// Matches the EVM `createEscrow` function behavior.
    ///
    /// # Arguments
    /// - `ctx`: Context containing escrow accounts
    /// - `intent_id`: Unique 32-byte intent identifier
    /// - `amount`: Amount of tokens to deposit
    ///
    /// # Returns
    /// - `Ok(())` on success
    ///
    /// # Errors
    /// - `InvalidAmount` if amount is 0
    /// - `InvalidSolver` if reserved_solver is default pubkey
    pub fn create_escrow(
        ctx: Context<CreateEscrow>,
        intent_id: [u8; 32],
        amount: u64,
    ) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;
        let clock = Clock::get()?;

        // Validate inputs
        require!(amount > 0, EscrowError::InvalidAmount);
        require!(
            ctx.accounts.reserved_solver.key() != Pubkey::default(),
            EscrowError::InvalidSolver
        );

        // Set escrow data
        escrow.requester = ctx.accounts.requester.key();
        escrow.token_mint = ctx.accounts.token_mint.key();
        escrow.amount = amount;
        escrow.is_claimed = false;
        escrow.expiry = clock.unix_timestamp + EXPIRY_DURATION;
        escrow.reserved_solver = ctx.accounts.reserved_solver.key();
        escrow.intent_id = intent_id;
        escrow.bump = ctx.bumps.escrow;

        // Transfer tokens from requester to escrow vault
        let cpi_accounts = Transfer {
            from: ctx.accounts.requester_token_account.to_account_info(),
            to: ctx.accounts.escrow_vault.to_account_info(),
            authority: ctx.accounts.requester.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        token::transfer(cpi_ctx, amount)?;

        emit!(EscrowInitialized {
            intent_id,
            escrow: escrow.key(),
            requester: escrow.requester,
            token: escrow.token_mint,
            reserved_solver: escrow.reserved_solver,
            amount,
            expiry: escrow.expiry,
        });

        Ok(())
    }

    /// Claim escrow funds with verifier signature
    ///
    /// Verifier signs the intent_id using Ed25519 - the signature itself is the approval.
    /// Uses instruction introspection to verify the Ed25519 signature was included in the transaction.
    ///
    /// # Arguments
    /// - `ctx`: Context containing escrow and verification accounts
    /// - `intent_id`: The 32-byte intent identifier
    /// - `signature`: 64-byte Ed25519 signature from verifier
    ///
    /// # Returns
    /// - `Ok(())` on success, transfers funds to reserved_solver
    ///
    /// # Errors
    /// - `EscrowDoesNotExist` if intent_id doesn't match
    /// - `EscrowAlreadyClaimed` if already claimed
    /// - `NoDeposit` if amount is 0
    /// - `EscrowExpired` if past expiry time
    /// - `InvalidSignature` if signature verification fails
    /// - `UnauthorizedVerifier` if signer is not the verifier
    pub fn claim(ctx: Context<Claim>, intent_id: [u8; 32], signature: [u8; 64]) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;
        let clock = Clock::get()?;
        let state = &ctx.accounts.state;

        // Validate escrow state
        require!(escrow.intent_id == intent_id, EscrowError::EscrowDoesNotExist);
        require!(!escrow.is_claimed, EscrowError::EscrowAlreadyClaimed);
        require!(escrow.amount > 0, EscrowError::NoDeposit);
        require!(
            clock.unix_timestamp <= escrow.expiry,
            EscrowError::EscrowExpired
        );

        // Verify Ed25519 signature using instruction introspection
        // The Ed25519 signature verification instruction must be included in the transaction
        let message = intent_id;
        let pubkey = state.verifier;

        // Use instruction introspection to verify Ed25519 signature was included
        // The Ed25519 instruction should be at index 0 (before our program instruction)
        let instruction_sysvar_account = &ctx.accounts.instruction_sysvar;
        let instruction_sysvar = anchor_lang::solana_program::sysvar::instructions::load_instruction_at_checked(
            0,
            instruction_sysvar_account,
        )?;

        // Check that the instruction is an Ed25519 verification instruction
        let ed25519_program_id = anchor_lang::solana_program::ed25519_program::ID;
        require!(
            instruction_sysvar.program_id == ed25519_program_id,
            EscrowError::InvalidSignature
        );

        // Verify the signature matches the expected verifier and message
        // Ed25519 instruction data format: [pubkey (32 bytes)][signature (64 bytes)][message (variable)]
        let instruction_data = &instruction_sysvar.data;
        require!(instruction_data.len() >= 96, EscrowError::InvalidSignature);

        let instruction_pubkey = &instruction_data[0..32];
        let instruction_signature = &instruction_data[32..96];
        let instruction_message = &instruction_data[96..];

        require!(
            instruction_pubkey == pubkey.to_bytes().as_slice(),
            EscrowError::UnauthorizedVerifier
        );
        require!(
            instruction_signature == signature.as_slice(),
            EscrowError::InvalidSignature
        );
        require!(
            instruction_message == message.as_slice(),
            EscrowError::InvalidSignature
        );

        // Capture values before modifying escrow
        let amount = escrow.amount;
        let intent_id_ref = escrow.intent_id;
        let bump_ref = [escrow.bump];
        let recipient = escrow.reserved_solver;
        
        // Mark as claimed
        escrow.is_claimed = true;
        escrow.amount = 0;

        // Transfer tokens from escrow vault to reserved solver
        let seeds: &[&[u8]] = &[
            b"escrow",
            &intent_id_ref,
            &bump_ref,
        ];
        let signer = &[seeds];

        let cpi_accounts = Transfer {
            from: ctx.accounts.escrow_vault.to_account_info(),
            to: ctx.accounts.solver_token_account.to_account_info(),
            authority: ctx.accounts.escrow.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
        token::transfer(cpi_ctx, amount)?;

        emit!(EscrowClaimed {
            intent_id,
            recipient,
            amount,
        });

        Ok(())
    }

    /// Cancel escrow and return funds to requester (only after expiry)
    ///
    /// Requester must wait until expiry before canceling to prevent premature withdrawal.
    /// Matches the EVM `cancel` function behavior.
    ///
    /// # Arguments
    /// - `ctx`: Context containing escrow accounts
    /// - `intent_id`: The 32-byte intent identifier
    ///
    /// # Returns
    /// - `Ok(())` on success, transfers funds back to requester
    ///
    /// # Errors
    /// - `EscrowDoesNotExist` if intent_id doesn't match
    /// - `EscrowAlreadyClaimed` if already claimed
    /// - `NoDeposit` if amount is 0
    /// - `UnauthorizedRequester` if caller is not the requester
    /// - `EscrowNotExpiredYet` if escrow hasn't expired
    pub fn cancel(ctx: Context<Cancel>, intent_id: [u8; 32]) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;
        let clock = Clock::get()?;

        // Validate escrow state
        require!(escrow.intent_id == intent_id, EscrowError::EscrowDoesNotExist);
        require!(!escrow.is_claimed, EscrowError::EscrowAlreadyClaimed);
        require!(escrow.amount > 0, EscrowError::NoDeposit);
        require!(
            escrow.requester == ctx.accounts.requester.key(),
            EscrowError::UnauthorizedRequester
        );
        require!(
            clock.unix_timestamp > escrow.expiry,
            EscrowError::EscrowNotExpiredYet
        );

        // Capture values before modifying escrow
        let amount = escrow.amount;
        let intent_id_ref = escrow.intent_id;
        let bump_ref = [escrow.bump];
        let requester_pubkey = escrow.requester;
        
        // Mark as claimed
        escrow.amount = 0;
        escrow.is_claimed = true;

        // Transfer tokens from escrow vault back to requester
        let seeds: &[&[u8]] = &[
            b"escrow",
            &intent_id_ref,
            &bump_ref,
        ];
        let signer = &[seeds];

        let cpi_accounts = Transfer {
            from: ctx.accounts.escrow_vault.to_account_info(),
            to: ctx.accounts.requester_token_account.to_account_info(),
            authority: ctx.accounts.escrow.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer);
        token::transfer(cpi_ctx, amount)?;

        emit!(EscrowCancelled {
            intent_id,
            requester: requester_pubkey,
            amount,
        });

        Ok(())
    }
}

// ============================================================================
// DATA TYPES
// ============================================================================

/// Global escrow state containing the authorized verifier
#[account]
pub struct EscrowState {
    /// Authorized verifier public key that can approve releases
    pub verifier: Pubkey,
}

/// Escrow data structure (matches EVM Escrow struct)
#[account]
pub struct Escrow {
    /// Requester who deposited funds
    pub requester: Pubkey,
    /// SPL token mint address
    pub token_mint: Pubkey,
    /// Amount deposited
    pub amount: u64,
    /// Whether funds have been claimed
    pub is_claimed: bool,
    /// Expiry timestamp (contract-defined)
    pub expiry: i64,
    /// Solver address that receives funds when escrow is claimed
    pub reserved_solver: Pubkey,
    /// Unique intent identifier (32 bytes)
    pub intent_id: [u8; 32],
    /// PDA bump seed
    pub bump: u8,
}

// ============================================================================
// ACCOUNT CONTEXTS
// ============================================================================

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + 32,
        seeds = [b"state"],
        bump
    )]
    pub state: Account<'info, EscrowState>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(intent_id: [u8; 32])]
pub struct CreateEscrow<'info> {
    #[account(
        init,
        payer = requester,
        space = 8 + 32 + 32 + 8 + 1 + 8 + 32 + 32 + 1,
        seeds = [b"escrow", intent_id.as_ref()],
        bump
    )]
    pub escrow: Account<'info, Escrow>,
    #[account(mut)]
    pub requester: Signer<'info>,
    pub token_mint: Account<'info, Mint>,
    #[account(
        mut,
        constraint = requester_token_account.owner == requester.key(),
        constraint = requester_token_account.mint == token_mint.key()
    )]
    pub requester_token_account: Account<'info, TokenAccount>,
    #[account(
        init,
        payer = requester,
        token::mint = token_mint,
        token::authority = escrow,
        seeds = [b"vault", intent_id.as_ref()],
        bump
    )]
    pub escrow_vault: Account<'info, TokenAccount>,
    /// CHECK: Reserved solver address (validated in instruction)
    pub reserved_solver: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
#[instruction(intent_id: [u8; 32], signature: [u8; 64])]
pub struct Claim<'info> {
    #[account(
        mut,
        seeds = [b"escrow", intent_id.as_ref()],
        bump = escrow.bump
    )]
    pub escrow: Account<'info, Escrow>,
    #[account(
        seeds = [b"state"],
        bump
    )]
    pub state: Account<'info, EscrowState>,
    #[account(
        mut,
        seeds = [b"vault", intent_id.as_ref()],
        bump
    )]
    pub escrow_vault: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = solver_token_account.owner == escrow.reserved_solver,
        constraint = solver_token_account.mint == escrow.token_mint
    )]
    pub solver_token_account: Account<'info, TokenAccount>,
    /// CHECK: Instructions sysvar for Ed25519 signature verification
    #[account(address = anchor_lang::solana_program::sysvar::instructions::ID)]
    pub instruction_sysvar: AccountInfo<'info>,
    pub token_program: Program<'info, Token>,
    pub clock: Sysvar<'info, Clock>,
}

#[derive(Accounts)]
#[instruction(intent_id: [u8; 32])]
pub struct Cancel<'info> {
    #[account(
        mut,
        seeds = [b"escrow", intent_id.as_ref()],
        bump = escrow.bump,
        constraint = escrow.requester == requester.key()
    )]
    pub escrow: Account<'info, Escrow>,
    #[account(mut)]
    pub requester: Signer<'info>,
    #[account(
        mut,
        seeds = [b"vault", intent_id.as_ref()],
        bump
    )]
    pub escrow_vault: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = requester_token_account.owner == requester.key(),
        constraint = requester_token_account.mint == escrow.token_mint
    )]
    pub requester_token_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub clock: Sysvar<'info, Clock>,
}

// ============================================================================
// EVENTS
// ============================================================================

#[event]
pub struct EscrowInitialized {
    pub intent_id: [u8; 32],
    pub escrow: Pubkey,
    pub requester: Pubkey,
    pub token: Pubkey,
    pub reserved_solver: Pubkey,
    pub amount: u64,
    pub expiry: i64,
}

#[event]
pub struct EscrowClaimed {
    pub intent_id: [u8; 32],
    pub recipient: Pubkey,
    pub amount: u64,
}

#[event]
pub struct EscrowCancelled {
    pub intent_id: [u8; 32],
    pub requester: Pubkey,
    pub amount: u64,
}

// ============================================================================
// ERRORS
// ============================================================================

#[error_code]
pub enum EscrowError {
    #[msg("Escrow already claimed")]
    EscrowAlreadyClaimed,
    #[msg("Escrow does not exist")]
    EscrowDoesNotExist,
    #[msg("No deposit")]
    NoDeposit,
    #[msg("Unauthorized requester")]
    UnauthorizedRequester,
    #[msg("Invalid signature")]
    InvalidSignature,
    #[msg("Unauthorized verifier")]
    UnauthorizedVerifier,
    #[msg("Escrow expired")]
    EscrowExpired,
    #[msg("Escrow not expired yet")]
    EscrowNotExpiredYet,
    #[msg("Invalid amount")]
    InvalidAmount,
    #[msg("Invalid solver")]
    InvalidSolver,
}
