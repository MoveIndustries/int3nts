use borsh::{BorshDeserialize, BorshSerialize};
use intent_escrow::{
    instruction::EscrowInstruction,
    state::{seeds, Escrow, EscrowState},
};
use intent_escrow_cli::{
    parse_32_byte_hex, parse_i64, parse_intent_id, parse_options, parse_signature, parse_u32,
    parse_u64, required_option,
};
use native_gmp_endpoint::{
    instruction::NativeGmpInstruction,
    state::seeds as gmp_seeds,
};
use outflow_validator::{
    instruction::OutflowInstruction,
    state::seeds as outflow_seeds,
};
use solana_client::rpc_client::RpcClient;
use solana_sdk::{
    ed25519_instruction::new_ed25519_instruction_with_signature,
    instruction::{AccountMeta, Instruction},
    pubkey::Pubkey,
    signature::{read_keypair_file, Keypair, Signer},
    sysvar,
    transaction::Transaction,
};
use solana_program::program_pack::Pack;
use spl_token::state::Account as TokenAccount;
use std::{collections::HashMap, env, error::Error, str::FromStr};

// ============================================================================
// CLI ENTRYPOINT
// ============================================================================

fn main() {
    if let Err(error) = run() {
        eprintln!("[intent_escrow_cli] Error: {error}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), Box<dyn Error>> {
    let args: Vec<String> = env::args().skip(1).collect();
    if args.is_empty() {
        print_usage();
        return Ok(());
    }

    let command = args[0].as_str();
    let options = parse_options(&args[1..])?;

    let rpc_url = options
        .get("rpc")
        .cloned()
        .unwrap_or_else(|| "http://localhost:8899".to_string());
    let client = RpcClient::new(rpc_url);

    // Commands that don't require program-id
    if command == "get-token-balance" {
        return handle_get_token_balance(&client, &options);
    }

    // GMP commands use --gmp-program-id
    if command == "gmp-init" {
        let gmp_program_id = match options.get("gmp-program-id") {
            Some(value) => parse_pubkey(value)?,
            None => {
                eprintln!("Error: --gmp-program-id is required for '{}'", command);
                print_usage();
                std::process::exit(1);
            }
        };
        return handle_gmp_init(&client, &options, gmp_program_id);
    }

    if command == "gmp-add-relay" {
        let gmp_program_id = match options.get("gmp-program-id") {
            Some(value) => parse_pubkey(value)?,
            None => {
                eprintln!("Error: --gmp-program-id is required for '{}'", command);
                print_usage();
                std::process::exit(1);
            }
        };
        return handle_gmp_add_relay(&client, &options, gmp_program_id);
    }

    if command == "gmp-set-trusted-remote" {
        let gmp_program_id = match options.get("gmp-program-id") {
            Some(value) => parse_pubkey(value)?,
            None => {
                eprintln!("Error: --gmp-program-id is required for '{}'", command);
                print_usage();
                std::process::exit(1);
            }
        };
        return handle_gmp_set_trusted_remote(&client, &options, gmp_program_id);
    }

    // Outflow commands use --outflow-program-id
    if command == "outflow-init" {
        let outflow_program_id = match options.get("outflow-program-id") {
            Some(value) => parse_pubkey(value)?,
            None => {
                eprintln!("Error: --outflow-program-id is required for '{}'", command);
                print_usage();
                std::process::exit(1);
            }
        };
        return handle_outflow_init(&client, &options, outflow_program_id);
    }

    // All other commands require program-id
    let program_id = match options.get("program-id") {
        Some(value) => parse_pubkey(value)?,
        None => {
            eprintln!("Error: --program-id is required for '{}'", command);
            print_usage();
            std::process::exit(1);
        }
    };

    match command {
        "initialize" => handle_initialize(&client, &options, program_id),
        "create-escrow" => handle_create_escrow(&client, &options, program_id),
        "claim" => handle_claim(&client, &options, program_id),
        "cancel" => handle_cancel(&client, &options, program_id),
        "get-escrow" => handle_get_escrow(&client, &options, program_id),
        _ => {
            print_usage();
            Ok(())
        }
    }
}

// ============================================================================
// COMMAND HANDLERS
// ============================================================================

fn handle_initialize(
    client: &RpcClient,
    options: &HashMap<String, String>,
    program_id: Pubkey,
) -> Result<(), Box<dyn Error>> {
    let payer = read_keypair(options, "payer")?;
    let approver = parse_pubkey(required_option(options, "approver")?)?;

    let (state_pda, _state_bump) =
        Pubkey::find_program_address(&[seeds::STATE_SEED], &program_id);

    let ix = Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new(state_pda, false),
            AccountMeta::new(payer.pubkey(), true),
            AccountMeta::new_readonly(solana_sdk::system_program::id(), false),
        ],
        data: EscrowInstruction::Initialize { approver }.try_to_vec()?,
    };

    let signature = send_tx(client, &[ix], &payer, &[])?;
    println!("Initialize signature: {signature}");
    println!("State PDA: {state_pda}");
    Ok(())
}

fn handle_create_escrow(
    client: &RpcClient,
    options: &HashMap<String, String>,
    program_id: Pubkey,
) -> Result<(), Box<dyn Error>> {
    let payer = read_keypair(options, "payer")?;
    let requester = read_keypair(options, "requester")?;

    let token_mint = parse_pubkey(required_option(options, "token-mint")?)?;
    let requester_token = parse_pubkey(required_option(options, "requester-token")?)?;
    let solver = parse_pubkey(required_option(options, "solver")?)?;
    let intent_id = parse_intent_id(required_option(options, "intent-id")?)?;
    let amount = parse_u64(required_option(options, "amount")?)?;
    let expiry = options
        .get("expiry")
        .map(|value| parse_i64(value))
        .transpose()?;

    let create_ix = build_create_escrow_ix(
        program_id,
        intent_id,
        amount,
        requester.pubkey(),
        token_mint,
        requester_token,
        solver,
        expiry,
    )?;

    let signature = send_tx(client, &[create_ix], &payer, &[&requester])?;
    let (escrow_pda, _) = Pubkey::find_program_address(&[seeds::ESCROW_SEED, &intent_id], &program_id);
    let (vault_pda, _) = Pubkey::find_program_address(&[seeds::VAULT_SEED, &intent_id], &program_id);

    println!("Create escrow signature: {signature}");
    println!("Escrow PDA: {escrow_pda}");
    println!("Vault PDA: {vault_pda}");
    Ok(())
}

fn handle_claim(
    client: &RpcClient,
    options: &HashMap<String, String>,
    program_id: Pubkey,
) -> Result<(), Box<dyn Error>> {
    let payer = read_keypair(options, "payer")?;
    let intent_id = parse_intent_id(required_option(options, "intent-id")?)?;
    let signature = parse_signature(required_option(options, "signature")?)?;
    let solver_token = parse_pubkey(required_option(options, "solver-token")?)?;

    let (state_pda, _state_bump) =
        Pubkey::find_program_address(&[seeds::STATE_SEED], &program_id);
    let (escrow_pda, _) = Pubkey::find_program_address(&[seeds::ESCROW_SEED, &intent_id], &program_id);
    let (vault_pda, _) = Pubkey::find_program_address(&[seeds::VAULT_SEED, &intent_id], &program_id);

    let state_account = client.get_account(&state_pda)?;
    let state = EscrowState::try_from_slice(&state_account.data)?;

    let ed25519_ix = new_ed25519_instruction_with_signature(
        &intent_id,
        &signature,
        &state.approver.to_bytes(),
    );

    let claim_ix = build_claim_ix(
        program_id,
        intent_id,
        signature,
        escrow_pda,
        state_pda,
        vault_pda,
        solver_token,
    )?;

    let signature = send_tx(client, &[ed25519_ix, claim_ix], &payer, &[])?;
    println!("Claim signature: {signature}");
    Ok(())
}

fn handle_cancel(
    client: &RpcClient,
    options: &HashMap<String, String>,
    program_id: Pubkey,
) -> Result<(), Box<dyn Error>> {
    let payer = read_keypair(options, "payer")?;
    let requester = read_keypair(options, "requester")?;
    let requester_token = parse_pubkey(required_option(options, "requester-token")?)?;
    let intent_id = parse_intent_id(required_option(options, "intent-id")?)?;

    let cancel_ix = build_cancel_ix(
        program_id,
        intent_id,
        requester.pubkey(),
        requester_token,
    )?;

    let signature = send_tx(client, &[cancel_ix], &payer, &[&requester])?;
    println!("Cancel signature: {signature}");
    Ok(())
}

fn handle_get_escrow(
    client: &RpcClient,
    options: &HashMap<String, String>,
    program_id: Pubkey,
) -> Result<(), Box<dyn Error>> {
    let intent_id = parse_intent_id(required_option(options, "intent-id")?)?;
    let (escrow_pda, _) = Pubkey::find_program_address(&[seeds::ESCROW_SEED, &intent_id], &program_id);
    let account = client.get_account(&escrow_pda)?;
    let escrow = Escrow::try_from_slice(&account.data)?;

    println!("Escrow PDA: {escrow_pda}");
    println!("Requester: {}", escrow.requester);
    println!("Token mint: {}", escrow.token_mint);
    println!("Amount: {}", escrow.amount);
    println!("Expiry: {}", escrow.expiry);
    println!("Reserved solver: {}", escrow.reserved_solver);
    println!("Claimed: {}", escrow.is_claimed);
    Ok(())
}

fn handle_get_token_balance(
    client: &RpcClient,
    options: &HashMap<String, String>,
) -> Result<(), Box<dyn Error>> {
    let token_account = parse_pubkey(required_option(options, "token-account")?)?;
    let account = client.get_account(&token_account)?;
    let token_state = TokenAccount::unpack(&account.data)?;
    println!("Token account: {token_account}");
    println!("Balance: {}", token_state.amount);
    Ok(())
}

// ============================================================================
// GMP ENDPOINT COMMAND HANDLERS
// ============================================================================

fn handle_gmp_init(
    client: &RpcClient,
    options: &HashMap<String, String>,
    gmp_program_id: Pubkey,
) -> Result<(), Box<dyn Error>> {
    let payer = read_keypair(options, "payer")?;
    let chain_id = parse_u32(required_option(options, "chain-id")?)?;

    let (config_pda, _config_bump) =
        Pubkey::find_program_address(&[gmp_seeds::CONFIG_SEED], &gmp_program_id);

    let ix = Instruction {
        program_id: gmp_program_id,
        accounts: vec![
            AccountMeta::new(config_pda, false),
            AccountMeta::new_readonly(payer.pubkey(), true), // admin
            AccountMeta::new(payer.pubkey(), true),          // payer
            AccountMeta::new_readonly(solana_sdk::system_program::id(), false),
        ],
        data: NativeGmpInstruction::Initialize { chain_id }.try_to_vec()?,
    };

    let signature = send_tx(client, &[ix], &payer, &[])?;
    println!("GMP Initialize signature: {signature}");
    println!("Config PDA: {config_pda}");
    Ok(())
}

fn handle_gmp_add_relay(
    client: &RpcClient,
    options: &HashMap<String, String>,
    gmp_program_id: Pubkey,
) -> Result<(), Box<dyn Error>> {
    let payer = read_keypair(options, "payer")?;
    let relay_pubkey = parse_pubkey(required_option(options, "relay")?)?;

    let (config_pda, _) =
        Pubkey::find_program_address(&[gmp_seeds::CONFIG_SEED], &gmp_program_id);
    let (relay_pda, _) =
        Pubkey::find_program_address(&[gmp_seeds::RELAY_SEED, relay_pubkey.as_ref()], &gmp_program_id);

    let ix = Instruction {
        program_id: gmp_program_id,
        accounts: vec![
            AccountMeta::new_readonly(config_pda, false),
            AccountMeta::new(relay_pda, false),
            AccountMeta::new_readonly(payer.pubkey(), true), // admin
            AccountMeta::new(payer.pubkey(), true),          // payer
            AccountMeta::new_readonly(solana_sdk::system_program::id(), false),
        ],
        data: NativeGmpInstruction::AddRelay { relay: relay_pubkey }.try_to_vec()?,
    };

    let signature = send_tx(client, &[ix], &payer, &[])?;
    println!("GMP AddRelay signature: {signature}");
    println!("Relay PDA: {relay_pda}");
    Ok(())
}

fn handle_gmp_set_trusted_remote(
    client: &RpcClient,
    options: &HashMap<String, String>,
    gmp_program_id: Pubkey,
) -> Result<(), Box<dyn Error>> {
    let payer = read_keypair(options, "payer")?;
    let src_chain_id = parse_u32(required_option(options, "src-chain-id")?)?;
    let trusted_addr = parse_32_byte_hex(required_option(options, "trusted-addr")?)?;

    let (config_pda, _) =
        Pubkey::find_program_address(&[gmp_seeds::CONFIG_SEED], &gmp_program_id);
    let (trusted_remote_pda, _) =
        Pubkey::find_program_address(&[gmp_seeds::TRUSTED_REMOTE_SEED, &src_chain_id.to_le_bytes()], &gmp_program_id);

    let ix = Instruction {
        program_id: gmp_program_id,
        accounts: vec![
            AccountMeta::new_readonly(config_pda, false),
            AccountMeta::new(trusted_remote_pda, false),
            AccountMeta::new_readonly(payer.pubkey(), true), // admin
            AccountMeta::new(payer.pubkey(), true),          // payer
            AccountMeta::new_readonly(solana_sdk::system_program::id(), false),
        ],
        data: NativeGmpInstruction::SetTrustedRemote { src_chain_id, trusted_addr }.try_to_vec()?,
    };

    let signature = send_tx(client, &[ix], &payer, &[])?;
    println!("GMP SetTrustedRemote signature: {signature}");
    println!("Trusted remote PDA: {trusted_remote_pda}");
    Ok(())
}

// ============================================================================
// OUTFLOW VALIDATOR COMMAND HANDLERS
// ============================================================================

fn handle_outflow_init(
    client: &RpcClient,
    options: &HashMap<String, String>,
    outflow_program_id: Pubkey,
) -> Result<(), Box<dyn Error>> {
    let payer = read_keypair(options, "payer")?;
    let gmp_endpoint = parse_pubkey(required_option(options, "gmp-endpoint")?)?;
    let hub_chain_id = parse_u32(required_option(options, "hub-chain-id")?)?;
    let trusted_hub_addr = parse_32_byte_hex(required_option(options, "hub-address")?)?;

    let (config_pda, _config_bump) =
        Pubkey::find_program_address(&[outflow_seeds::CONFIG_SEED], &outflow_program_id);

    let ix = Instruction {
        program_id: outflow_program_id,
        accounts: vec![
            AccountMeta::new(config_pda, false),
            AccountMeta::new(payer.pubkey(), true), // admin/payer
            AccountMeta::new_readonly(solana_sdk::system_program::id(), false),
        ],
        data: OutflowInstruction::Initialize {
            gmp_endpoint,
            hub_chain_id,
            trusted_hub_addr,
        }
        .try_to_vec()?,
    };

    let signature = send_tx(client, &[ix], &payer, &[])?;
    println!("Outflow Initialize signature: {signature}");
    println!("Config PDA: {config_pda}");
    Ok(())
}

// ============================================================================
// INSTRUCTION BUILDERS
// ============================================================================

fn build_create_escrow_ix(
    program_id: Pubkey,
    intent_id: [u8; 32],
    amount: u64,
    requester: Pubkey,
    token_mint: Pubkey,
    requester_token: Pubkey,
    reserved_solver: Pubkey,
    expiry_duration: Option<i64>,
) -> Result<Instruction, Box<dyn Error>> {
    let (escrow_pda, _escrow_bump) =
        Pubkey::find_program_address(&[seeds::ESCROW_SEED, &intent_id], &program_id);
    let (vault_pda, _vault_bump) =
        Pubkey::find_program_address(&[seeds::VAULT_SEED, &intent_id], &program_id);

    Ok(Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new(escrow_pda, false),
            AccountMeta::new(requester, true),
            AccountMeta::new_readonly(token_mint, false),
            AccountMeta::new(requester_token, false),
            AccountMeta::new(vault_pda, false),
            AccountMeta::new_readonly(reserved_solver, false),
            AccountMeta::new_readonly(spl_token::id(), false),
            AccountMeta::new_readonly(solana_sdk::system_program::id(), false),
            AccountMeta::new_readonly(sysvar::rent::id(), false),
        ],
        data: EscrowInstruction::CreateEscrow {
            intent_id,
            amount,
            expiry_duration,
        }
        .try_to_vec()?,
    })
}

fn build_claim_ix(
    program_id: Pubkey,
    intent_id: [u8; 32],
    _signature: [u8; 64],
    escrow_pda: Pubkey,
    state_pda: Pubkey,
    vault_pda: Pubkey,
    solver_token: Pubkey,
) -> Result<Instruction, Box<dyn Error>> {
    Ok(Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new(escrow_pda, false),
            AccountMeta::new_readonly(state_pda, false),
            AccountMeta::new(vault_pda, false),
            AccountMeta::new(solver_token, false),
            AccountMeta::new_readonly(sysvar::instructions::id(), false),
            AccountMeta::new_readonly(spl_token::id(), false),
        ],
        data: EscrowInstruction::Claim {
            intent_id,
        }
        .try_to_vec()?,
    })
}

fn build_cancel_ix(
    program_id: Pubkey,
    intent_id: [u8; 32],
    requester: Pubkey,
    requester_token: Pubkey,
) -> Result<Instruction, Box<dyn Error>> {
    let (escrow_pda, _escrow_bump) =
        Pubkey::find_program_address(&[seeds::ESCROW_SEED, &intent_id], &program_id);
    let (vault_pda, _vault_bump) =
        Pubkey::find_program_address(&[seeds::VAULT_SEED, &intent_id], &program_id);

    Ok(Instruction {
        program_id,
        accounts: vec![
            AccountMeta::new(escrow_pda, false),
            AccountMeta::new(requester, true),
            AccountMeta::new(vault_pda, false),
            AccountMeta::new(requester_token, false),
            AccountMeta::new_readonly(spl_token::id(), false),
        ],
        data: EscrowInstruction::Cancel { intent_id }.try_to_vec()?,
    })
}

// ============================================================================
// TRANSACTION HELPERS
// ============================================================================

fn send_tx(
    client: &RpcClient,
    instructions: &[Instruction],
    payer: &Keypair,
    signers: &[&Keypair],
) -> Result<solana_sdk::signature::Signature, Box<dyn Error>> {
    let blockhash = client.get_latest_blockhash()?;
    let mut all_signers = Vec::with_capacity(signers.len() + 1);
    all_signers.push(payer);
    for signer in signers {
        if signer.pubkey() != payer.pubkey() {
            all_signers.push(*signer);
        }
    }

    let tx = Transaction::new_signed_with_payer(
        instructions,
        Some(&payer.pubkey()),
        &all_signers,
        blockhash,
    );
    let signature = client.send_and_confirm_transaction(&tx)?;
    Ok(signature)
}

// ============================================================================
// LOCAL HELPERS
// ============================================================================

fn read_keypair(
    options: &HashMap<String, String>,
    key: &str,
) -> Result<Keypair, Box<dyn Error>> {
    let path = required_option(options, key)?;
    Ok(read_keypair_file(path)?)
}

fn parse_pubkey(value: &str) -> Result<Pubkey, Box<dyn Error>> {
    Ok(Pubkey::from_str(value)?)
}

// ============================================================================
// USAGE
// ============================================================================

fn print_usage() {
    eprintln!(
        r#"SVM Intent Escrow CLI

Usage:
  intent_escrow_cli <command> [--option value]...

Escrow Commands:
  initialize         --program-id <pubkey> --payer <keypair> --approver <pubkey> [--rpc <url>]
  create-escrow      --program-id <pubkey> --payer <keypair> --requester <keypair> --token-mint <pubkey>
                     --requester-token <pubkey> --solver <pubkey> --intent-id <hex> --amount <u64>
                     [--expiry <i64>] [--rpc <url>]
  claim              --program-id <pubkey> --payer <keypair> --solver-token <pubkey> --intent-id <hex>
                     --signature <hex> [--rpc <url>]
  cancel             --program-id <pubkey> --payer <keypair> --requester <keypair> --requester-token <pubkey>
                     --intent-id <hex> [--rpc <url>]
  get-escrow         --program-id <pubkey> --intent-id <hex> [--rpc <url>]
  get-token-balance  --token-account <pubkey> [--rpc <url>]

GMP Endpoint Commands:
  gmp-init           --gmp-program-id <pubkey> --payer <keypair> --chain-id <u32> [--rpc <url>]
  gmp-add-relay      --gmp-program-id <pubkey> --payer <keypair> --relay <pubkey> [--rpc <url>]
  gmp-set-trusted-remote  --gmp-program-id <pubkey> --payer <keypair> --src-chain-id <u32>
                          --trusted-addr <hex> [--rpc <url>]

Outflow Validator Commands:
  outflow-init       --outflow-program-id <pubkey> --payer <keypair> --gmp-endpoint <pubkey>
                     --hub-chain-id <u32> --hub-address <hex> [--rpc <url>]
        "#
    );
}
