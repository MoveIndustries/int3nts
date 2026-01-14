#!/bin/bash
# SVM Intent Framework Build Script
#
# This script works around Anchor 0.29.x / Solana CLI compatibility issues:
# - Anchor 0.29.x calls `cargo build-bpf` (deprecated)
# - Solana CLI ≥2.x only has `cargo build-sbf`
#
# We create a temporary shim to bridge this gap.
#
# See: https://github.com/solana-foundation/anchor/issues/3392

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(dirname "$PROJECT_DIR")"
ANCHOR_VERSION="0.29.0"

# If not in nix shell, re-exec inside nix develop
if [ -z "$IN_NIX_SHELL" ]; then
    echo "[build.sh] Entering nix develop..."
    exec nix develop "$REPO_ROOT" -c bash "$0" "$@"
fi

# Ensure a pinned Anchor version is installed and selected.
# Prefer the Anchor binary provided by the nix shell to avoid avm prompts in CI.
CURRENT_ANCHOR_VERSION=""
if command -v anchor >/dev/null 2>&1; then
    CURRENT_ANCHOR_VERSION="$(anchor --version | awk '{print $2}')"
fi

if [ "$CURRENT_ANCHOR_VERSION" != "$ANCHOR_VERSION" ]; then
    # avm can prompt for confirmation, so use 'yes' for continuous 'y' answers
    # Use rustup's cargo (supports +toolchain syntax required by avm) - subshell ensures PATH applies to avm
    echo "[build.sh] Ensuring Anchor $ANCHOR_VERSION is installed via avm..."
    (export PATH="$HOME/.cargo/bin:$PATH"; yes | avm install "$ANCHOR_VERSION" 2>&1) || true
    echo "[build.sh] Using Anchor $ANCHOR_VERSION via avm..."
    (export PATH="$HOME/.cargo/bin:$PATH"; yes | avm use "$ANCHOR_VERSION" 2>&1) || true
fi

echo "[build.sh] Anchor version: $(anchor --version)"

# Create local bin directory for shims
mkdir -p "$PROJECT_DIR/.bin"

# Create build-bpf shim that calls build-sbf
# Note: cargo passes the subcommand name as first arg, so we strip "build-bpf" if present
cat > "$PROJECT_DIR/.bin/cargo-build-bpf" << 'SHIM'
#!/bin/bash
# Strip "build-bpf" if it's the first argument (cargo passes it)
if [ "$1" = "build-bpf" ]; then
    shift
fi
exec cargo-build-sbf "$@"
SHIM
chmod +x "$PROJECT_DIR/.bin/cargo-build-bpf"

# Add shim to PATH
export PATH="$PROJECT_DIR/.bin:$PATH"

# Debug: Show current state
echo "[build.sh] DEBUG: PROJECT_DIR=$PROJECT_DIR"
echo "[build.sh] DEBUG: Cargo.lock exists? $([ -f "$PROJECT_DIR/Cargo.lock" ] && echo 'yes' || echo 'no')"

# Check if Cargo.lock has problematic deps (version is on separate line from name)
NEED_REGEN=false
if [ ! -f "$PROJECT_DIR/Cargo.lock" ]; then
    echo "[build.sh] No Cargo.lock found, will generate"
    NEED_REGEN=true
else
    # Check for constant_time_eq 0.4.x (version line comes after name line)
    CTE_VERSION=$(grep -A1 'name = "constant_time_eq"' "$PROJECT_DIR/Cargo.lock" | grep 'version' | head -1 || echo "")
    echo "[build.sh] DEBUG: constant_time_eq version line: $CTE_VERSION"
    if echo "$CTE_VERSION" | grep -q '0\.4\.'; then
        echo "[build.sh] Cargo.lock has constant_time_eq v0.4.x (edition2024), regenerating..."
        NEED_REGEN=true
    fi
fi

if [ "$NEED_REGEN" = true ]; then
    echo "[build.sh] Generating fresh Cargo.lock..."
    rm -f "$PROJECT_DIR/Cargo.lock"
    cd "$PROJECT_DIR"
    
    # Generate lockfile first
    cargo generate-lockfile
    
    # Force downgrade problematic crates to versions without edition2024
    echo "[build.sh] Downgrading edition2024 crates..."
    cargo update -p constant_time_eq --precise 0.3.1 2>/dev/null || true
    cargo update -p blake3 --precise 1.5.0 2>/dev/null || true
    
    # Re-check after generation
    CTE_VERSION=$(grep -A1 'name = "constant_time_eq"' "$PROJECT_DIR/Cargo.lock" | grep 'version' | head -1 || echo "")
    echo "[build.sh] DEBUG: After regen, constant_time_eq version: $CTE_VERSION"
fi

# Ensure Cargo.lock is version 3 (Solana's Rust 1.84 can't read v4)
LOCK_VERSION=$(head -5 "$PROJECT_DIR/Cargo.lock" | grep "^version" || echo "")
echo "[build.sh] DEBUG: Cargo.lock version line: $LOCK_VERSION"
if echo "$LOCK_VERSION" | grep -q "version = 4"; then
    echo "[build.sh] Downgrading Cargo.lock from v4 to v3..."
    sed -i.bak 's/^version = 4$/version = 3/' "$PROJECT_DIR/Cargo.lock"
    rm -f "$PROJECT_DIR/Cargo.lock.bak"
fi

# Final verification
CTE_VERSION=$(grep -A1 'name = "constant_time_eq"' "$PROJECT_DIR/Cargo.lock" | grep 'version' | head -1 || echo "")
if echo "$CTE_VERSION" | grep -q '0\.4\.'; then
    echo "[build.sh] ERROR: Cargo.lock still contains constant_time_eq v0.4.x"
    echo "[build.sh] This requires edition2024 which Solana's Rust 1.84 doesn't support."
    echo "[build.sh] Anchor 0.29.0 should use solana-program 1.17.x which doesn't need this."
    echo "[build.sh] Check your Cargo.toml dependencies."
    exit 1
fi
echo "[build.sh] DEBUG: Cargo.lock verified OK"

# Run anchor build with rustup's cargo (required for +toolchain syntax used by cargo-build-sbf)
cd "$PROJECT_DIR"
echo "[build.sh] Running anchor build..."
# Prepend rustup's cargo to PATH so cargo +toolchain works
# But keep our shim FIRST so it catches cargo build-bpf calls
export PATH="$PROJECT_DIR/.bin:$HOME/.cargo/bin:$PATH"
anchor build "$@"

echo "[build.sh] Build complete!"
