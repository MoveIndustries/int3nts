# SVM Intent Framework Scripts

Scripts for building, testing, and CI simulation of the SVM Intent Framework.

## Scripts

### `build.sh`

Builds the native Solana program with workarounds for Solana CLI 2.x compatibility.

```bash
./scripts/build.sh
```

### `test.sh`

Builds and runs the Rust test suite using `solana-program-test`.

```bash
./scripts/test.sh
```

## Requirements

- **Nix** - for `build.sh` and `test.sh`

## Troubleshooting

### Cargo.lock issues

```bash
cd svm-intent-framework
rm Cargo.lock
cargo generate-lockfile
cargo update -p constant_time_eq --precise 0.3.1
cargo update -p blake3 --precise 1.5.0
```
