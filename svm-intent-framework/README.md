# SVM Intent Framework

Solana Anchor program for SVM escrows.

📚 **Full documentation: [docs/svm-intent-framework/](../docs/svm-intent-framework/README.md)**

## Quick Start

```bash
# Enter dev shell (includes Solana/Anchor)
nix develop

# Build (uses wrapper script for compatibility)
cd svm-intent-framework
./scripts/build.sh

# Or for testing
npm install && anchor test
```

## Build Script

**Always use `./scripts/build.sh`** instead of `anchor build` directly. The script handles all toolchain workarounds automatically:

| What it does | Why |
|--------------|-----|
| Auto-enters `nix develop` | Ensures correct environment |
| Creates `cargo-build-bpf` shim | Anchor 0.29.x calls deprecated command |
| Downgrades `Cargo.lock` to v3 | Solana's Rust 1.84 can't read v4 |
| Pins `constant_time_eq` to v0.3.x | Avoids `edition2024` crates |

You can pass arguments through: `./scripts/build.sh --verifiable`

## ⚠️ Toolchain Constraints

> **Design Decision**: This project intentionally constrains its dependency graph to remain compatible with Solana's pinned Rust toolchain (1.84.x). Newer Anchor versions currently violate this constraint via transitive `edition2024` dependencies. This is not accidental tech debt—remove these workarounds when Solana bumps to Rust 1.85+.

**As of Jan 2026**, Solana's bundled Rust (1.84.0) has compatibility issues:

| Issue | Cause | Workaround |
|-------|-------|------------|
| `lock file version 4 requires -Znext-lockfile-bump` | System cargo 1.86+ creates v4 lockfiles | Keep `Cargo.lock` at version 3 |
| `feature edition2024 is required` | Some crates use `edition = "2024"` | Use Anchor 0.29.0 (older dep tree) |
| `no such command: build-bpf` | Anchor 0.29.x calls deprecated `cargo build-bpf` | `build.sh` creates a shim → `cargo build-sbf` |

### Why Anchor 0.29.0?

Newer Anchor versions (0.30+) pull in `blake3` → `constant_time_eq v0.4.x` which requires `edition = "2024"`. Solana's Rust 1.84 doesn't support this. Anchor 0.29.0 has an older dependency tree that avoids this.

**Trade-off**: Anchor 0.29.0 calls `cargo build-bpf` (deprecated in Solana CLI 2.x). The `scripts/build.sh` creates a local shim to forward `build-bpf` → `build-sbf`.

### Manual Lockfile Regeneration

**Do NOT regenerate `Cargo.lock` blindly.** If you must:

```bash
cargo generate-lockfile
sed -i 's/version = 4/version = 3/' Cargo.lock  # GNU sed
# or: sed -i '' 's/version = 4/version = 3/' Cargo.lock  # macOS sed
```

Then verify no edition2024 crates snuck in:

```bash
grep -A1 'name = "constant_time_eq"' Cargo.lock  # Should show v0.3.x, not v0.4.x
```

See: [anchor#3392](https://github.com/solana-foundation/anchor/issues/3392)

### When to Remove These Workarounds

Check periodically and remove when **all** conditions are met:

- [ ] `solana --version` shows Rust ≥1.85 bundled
- [ ] Anchor ≥0.30.x builds cleanly with `anchor build` (no shim needed)
- [ ] Cargo.lock v4 is accepted by Solana's cargo

Then:

1. Upgrade `anchor-lang`/`anchor-spl` in `programs/intent_escrow/Cargo.toml`
2. Remove `scripts/build.sh` shim logic (or simplify to just `anchor build`)
3. Remove the `[patch.crates-io]` comment from workspace `Cargo.toml`
4. Update this README
