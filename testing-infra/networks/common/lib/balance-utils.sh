#!/bin/bash

# Shared balance query functions for Movement and EVM chains.
# Source this file from network-specific check-balances.sh scripts.
#
# Requires caller to set:
#   - MOVEMENT_RPC_URL (for Movement balance queries)
# EVM functions take rpc_url as an argument.

# Get Movement native (MOVE/APT) balance via coin::balance view function.
get_movement_balance() {
    local address="$1"
    if [[ ! "$address" =~ ^0x ]]; then
        address="0x${address}"
    fi

    local balance
    balance=$(curl -s --max-time 10 -X POST "${MOVEMENT_RPC_URL}/view" \
        -H "Content-Type: application/json" \
        -d "{\"function\":\"0x1::coin::balance\",\"type_arguments\":[\"0x1::aptos_coin::AptosCoin\"],\"arguments\":[\"$address\"]}" \
        | jq -r '.[0] // "0"' 2>/dev/null)

    if [ -z "$balance" ] || [ "$balance" = "null" ]; then
        echo "0"
    else
        echo "$balance"
    fi
}

# Get Movement Fungible Asset balance by metadata address (USDC.e, USDCx, etc.).
get_movement_fa_balance() {
    local address="$1"
    local metadata_addr="$2"
    if [[ ! "$address" =~ ^0x ]]; then
        address="0x${address}"
    fi

    if [ -z "$metadata_addr" ]; then
        echo "0"
        return
    fi

    local balance
    balance=$(curl -s --max-time 10 -X POST "${MOVEMENT_RPC_URL}/view" \
        -H "Content-Type: application/json" \
        -d "{\"function\":\"0x1::primary_fungible_store::balance\",\"type_arguments\":[\"0x1::fungible_asset::Metadata\"],\"arguments\":[\"$address\",\"${metadata_addr}\"]}" \
        | jq -r '.[0] // "0"' 2>/dev/null)

    if [ -z "$balance" ] || [ "$balance" = "null" ]; then
        echo "0"
    else
        echo "$balance"
    fi
}

# Get Movement Coin balance by coin type (e.g., "0xa6cc...::tokens::USDC").
# Queries the CoinStore resource directly (won't fall back to FA after migration).
get_movement_coin_balance() {
    local address="$1"
    local coin_type="$2"
    if [[ ! "$address" =~ ^0x ]]; then
        address="0x${address}"
    fi

    if [ -z "$coin_type" ]; then
        echo "0"
        return
    fi

    local coin_store_type="0x1::coin::CoinStore%3C${coin_type}%3E"
    local resource
    resource=$(curl -s --max-time 10 "${MOVEMENT_RPC_URL}/accounts/${address}/resource/${coin_store_type}" 2>/dev/null)
    local balance
    balance=$(echo "$resource" | jq -r '.data.coin.value // "0"' 2>/dev/null)

    if [ -z "$balance" ] || [ "$balance" = "null" ]; then
        echo "0"
    else
        echo "$balance"
    fi
}

# Get native ETH balance on any EVM chain.
get_evm_eth_balance() {
    local address="$1"
    local rpc_url="$2"
    if [[ ! "$address" =~ ^0x ]]; then
        address="0x${address}"
    fi

    local balance_hex
    balance_hex=$(curl -s --max-time 10 -X POST "$rpc_url" \
        -H "Content-Type: application/json" \
        -d "{\"jsonrpc\":\"2.0\",\"method\":\"eth_getBalance\",\"params\":[\"$address\",\"latest\"],\"id\":1}" \
        | jq -r '.result // "0x0"' 2>/dev/null)

    if [ -z "$balance_hex" ] || [ "$balance_hex" = "null" ] || [ "$balance_hex" = "0x0" ]; then
        echo "0"
    else
        local hex_no_prefix="${balance_hex#0x}"
        local hex_upper
        hex_upper=$(echo "$hex_no_prefix" | tr '[:lower:]' '[:upper:]')
        echo "obase=10; ibase=16; $hex_upper" | bc 2>/dev/null || echo "0"
    fi
}

# Get ERC20 token balance on any EVM chain via eth_call to balanceOf(address).
get_evm_token_balance() {
    local address="$1"
    local token_addr="$2"
    local rpc_url="$3"

    if [[ ! "$address" =~ ^0x ]]; then
        address="0x${address}"
    fi
    if [[ ! "$token_addr" =~ ^0x ]]; then
        token_addr="0x${token_addr}"
    fi

    # balanceOf(address) — selector 0x70a08231 + 32-byte padded address
    local addr_no_prefix="${address#0x}"
    local addr_padded
    addr_padded=$(printf "%064s" "$addr_no_prefix" | sed 's/ /0/g')
    local data="0x70a08231$addr_padded"

    local balance_hex
    balance_hex=$(curl -s --max-time 10 -X POST "$rpc_url" \
        -H "Content-Type: application/json" \
        -d "{\"jsonrpc\":\"2.0\",\"method\":\"eth_call\",\"params\":[{\"to\":\"$token_addr\",\"data\":\"$data\"},\"latest\"],\"id\":1}" \
        | jq -r '.result // "0x0"' 2>/dev/null)

    if [ -z "$balance_hex" ] || [ "$balance_hex" = "null" ] || [ "$balance_hex" = "0x0" ]; then
        echo "0"
    else
        local hex_no_prefix="${balance_hex#0x}"
        local hex_upper
        hex_upper=$(echo "$hex_no_prefix" | tr '[:lower:]' '[:upper:]')
        echo "obase=10; ibase=16; $hex_upper" | bc 2>/dev/null || echo "0"
    fi
}

# Get Solana native SOL balance (in lamports).
get_solana_sol_balance() {
    local address="$1"
    local rpc_url="$2"

    local balance
    balance=$(curl -s --max-time 10 -X POST "$rpc_url" \
        -H "Content-Type: application/json" \
        -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"getBalance\",\"params\":[\"$address\"]}" \
        | jq -r '.result.value // "0"' 2>/dev/null)

    if [ -z "$balance" ] || [ "$balance" = "null" ]; then
        echo "0"
    else
        echo "$balance"
    fi
}

# Get Solana SPL token balance by mint address (returns raw amount, decimals handled by caller).
get_solana_token_balance() {
    local address="$1"
    local mint="$2"
    local rpc_url="$3"

    # Query all token accounts for this owner + mint, sum up balances
    local balance
    balance=$(curl -s --max-time 10 -X POST "$rpc_url" \
        -H "Content-Type: application/json" \
        -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"getTokenAccountsByOwner\",\"params\":[\"$address\",{\"mint\":\"$mint\"},{\"encoding\":\"jsonParsed\"}]}" \
        | jq -r '[.result.value[].account.data.parsed.info.tokenAmount.amount | tonumber] | add // 0' 2>/dev/null)

    if [ -z "$balance" ] || [ "$balance" = "null" ]; then
        echo "0"
    else
        echo "$balance"
    fi
}

# Format balance with optional symbol suffix.
# Args: balance (raw), decimals, symbol (optional)
format_balance() {
    local balance="$1"
    local decimals="$2"
    local symbol="${3:-}"

    local divisor
    case "$decimals" in
        18) divisor="1000000000000000000" ;;
        9)  divisor="1000000000" ;;
        8)  divisor="100000000" ;;
        6)  divisor="1000000" ;;
        *)  divisor="1" ;;
    esac

    local formatted
    formatted=$(echo "scale=6; $balance / $divisor" | bc 2>/dev/null || echo "0")

    if [ -n "$symbol" ]; then
        printf "%.6f %s" "$formatted" "$symbol"
    else
        printf "%.6f" "$formatted"
    fi
}

# Format balance as number only (no symbol).
format_balance_number() {
    format_balance "$1" "$2" ""
}
