use anchor_lang::prelude::*;

declare_id!("int3ntsEscrow1111111111111111111111111");

#[program]
pub mod intent_escrow {
    use super::*;

    pub fn initialize(_ctx: Context<Initialize>) -> Result<()> {
        msg!("IntentEscrow program initialized");
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
