//! Ed25519 Key Generation Utility
//!
//! This binary generates a new Ed25519 key pair for the trusted-gmp service.
//!
//! ## Usage
//!
//! ```bash
//! # Generate new keys
//! cargo run --bin generate_keys
//!
//! # Copy the output to your config/trusted-gmp.toml file
//! ```
//!
//! ## Output
//!
//! The script outputs:
//! - Private key (base64 encoded) - for signing operations
//! - Public key (base64 encoded) - for signature verification
//! - Move address (hex) - for on-chain relay authorization
//!
//! Copy these values to the `[trusted_gmp]` section of your `config/trusted-gmp.toml` file.

use base64::{engine::general_purpose, Engine as _};
use ed25519_dalek::SigningKey;
use rand::Rng;
use sha3::{Digest, Sha3_256};

fn main() {
    // Generate a new Ed25519 key pair
    let mut rng = rand::rngs::OsRng;
    let mut secret_key_bytes = [0u8; 32];
    rng.fill(&mut secret_key_bytes);
    let signing_key = SigningKey::from_bytes(&secret_key_bytes);
    let verifying_key = signing_key.verifying_key();

    // Encode keys as base64
    let private_key_b64 = general_purpose::STANDARD.encode(signing_key.as_bytes());
    let public_key_b64 = general_purpose::STANDARD.encode(verifying_key.as_bytes());

    // Derive Move address: sha3_256(public_key || 0x00)
    let mut hasher = Sha3_256::new();
    hasher.update(verifying_key.as_bytes());
    hasher.update(&[0x00u8]); // Ed25519 single-key scheme identifier
    let hash = hasher.finalize();
    let move_address = format!("0x{}", hex::encode(hash));

    println!("Generated Ed25519 Key Pair:");
    println!("Private Key (base64): {}", private_key_b64);
    println!("Public Key (base64): {}", public_key_b64);
    println!("Move Address (hex): {}", move_address);
    println!();
    println!("Copy these keys to your config/trusted-gmp.toml file.");
    println!("Add the Move Address as an authorized relay for native GMP.");
}
