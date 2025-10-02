# Core Components

This directory contains the core Move modules that implement the Intent Framework.

## Modules

### 1. Base Intent Module

[`intent.move`](sources/intent.move) - The core generic framework that defines the fundamental intent system. This module provides the abstract structures and functions for creating, managing, and executing any type of conditional trade intent.

- **TradeIntent<Source, Args>**: Stores the offered resource, trade conditions, expiry time, and witness type requirements. Acts as the immutable record of what someone wants to trade.
- **TradeSession<Args>**: Created when someone starts an intent session. Contains the trade conditions and witness requirements, allowing the session opener to fulfill the trade.
- **Witness System**: Enforces unlock conditions through Move's type system. The witness is an empty struct that can only be created by functions that first verify the trading conditions. For example, `FungibleAssetRecipientWitness` can only be created after confirming the received asset matches the wanted type and amount.

  *Note: The witness is empty (not a flag like `verified: true`) because anyone could forge a flag, but only the verification function can create the specific witness type. Having the witness proves you went through the proper verification process.*

### 2. Implementation for Fungible Asset

[`fungible_asset_intent.move`](sources/fungible_asset_intent.move) - A concrete implementation of the intent framework specifically designed for fungible asset trading. This module handles the creation and execution of limit orders between different fungible assets.

- **FungibleAssetLimitOrder**: Defines the specific trade parameters (wanted token type, amount, issuer) for fungible asset limit orders.
- **LimitOrderEvent**: Emits events when intents are created, providing transparency and allowing external systems to discover available trades.
- **Primary Fungible Store Integration**: Handles the actual transfer of fungible assets using Aptos's primary fungible store system for seamless asset management.

## Configuration

- [`Move.toml`](Move.toml) - Move package configuration with dependencies and addresses
- [`shell.nix`](shell.nix) - Development environment setup with convenient aliases

## Development

See the main [README](../README.md) for development setup and usage instructions.
