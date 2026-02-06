#!/usr/bin/env bash
# SVM Intent Framework Build Script
#
# Native Solana build with edition2024 compatibility workarounds.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

echo "[build.sh] Building native Solana program..."

# Add Solana CLI and rustup to PATH
export PATH="$HOME/.local/share/solana/install/active_release/bin:$HOME/.cargo/bin:$PATH"

# Step 1: Generate lockfile with pinned dependencies
if [ ! -f "Cargo.lock" ]; then
    echo "[build.sh] Generating Cargo.lock..."
    cargo generate-lockfile
    
    # Pin blake3 and constant_time_eq to avoid edition2024
    # blake3 1.8.3+ uses edition2024, which Cargo <1.85 can't parse
    echo "[build.sh] Pinning dependencies to avoid edition2024..."
    cargo update -p blake3 --precise 1.8.2
    cargo update -p constant_time_eq --precise 0.3.1
fi

# Step 2: Downgrade Cargo.lock to version 3 (older platform-tools can't read v4)
LOCK_VERSION=$(head -5 "$PROJECT_DIR/Cargo.lock" | grep "^version" || echo "")
if echo "$LOCK_VERSION" | grep -q "version = 4"; then
    echo "[build.sh] Downgrading Cargo.lock from v4 to v3..."
    sed -i 's/^version = 4$/version = 3/' "$PROJECT_DIR/Cargo.lock"
fi

# Step 3: Build with Solana toolchain
echo "[build.sh] Environment:"
echo "  cargo-build-sbf: $(which cargo-build-sbf 2>/dev/null || echo 'not found')"
echo "  solana: $(solana --version 2>/dev/null || echo 'not found')"

# Helper function to clear stale toolchain before each build.
# cargo build-sbf registers a platform-tools toolchain that can become stale
# on subsequent invocations, causing registration conflicts. The Solana SDK
# has a bug parsing linked toolchain paths from `rustup toolchain list`.
clear_stale_toolchain() {
    # Uninstall all solana-related toolchains via rustup (handles linked toolchains properly)
    # Extract just the toolchain name (first field) to avoid the tab+path issue
    rustup toolchain list | grep -E 'sbpf|solana' | cut -f1 | while read -r tc; do
        rustup toolchain uninstall "$tc" 2>/dev/null || true
    done
    # Remove marker files so install.sh re-links the toolchain cleanly
    local deps_dir="$HOME/.local/share/solana/install/active_release/bin/platform-tools-sdk/sbf/dependencies"
    rm -f "$deps_dir"/platform-tools-*.md 2>/dev/null || true
}

echo "[build.sh] Running cargo build-sbf for intent_inflow_escrow..."
clear_stale_toolchain
cargo build-sbf --manifest-path programs/intent_inflow_escrow/Cargo.toml -- --locked

echo "[build.sh] Running cargo build-sbf for intent-gmp..."
clear_stale_toolchain
cargo build-sbf --manifest-path programs/intent-gmp/Cargo.toml -- --locked

echo "[build.sh] Running cargo build-sbf for intent-outflow-validator..."
clear_stale_toolchain
cargo build-sbf --manifest-path programs/intent-outflow-validator/Cargo.toml -- --locked

echo "[build.sh] Build complete!"
echo "[build.sh] Output:"
echo "  - target/deploy/intent_inflow_escrow.so"
echo "  - target/deploy/intent_gmp.so"
echo "  - target/deploy/intent_outflow_validator.so"
