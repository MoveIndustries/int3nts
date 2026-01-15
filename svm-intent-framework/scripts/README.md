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

### `test-docker.sh`

Simulates the GitHub Actions CI environment locally using Docker.

```bash
./scripts/test-docker.sh           # Run tests (builds image on first run)
./scripts/test-docker.sh --rebuild # Force rebuild of Docker image
```

## Requirements

- **Nix** - for `build.sh` and `test.sh`
- **Docker** - for `test-docker.sh`

## Troubleshooting

### Docker build fails

```bash
./scripts/test-docker.sh --rebuild
```

### Cargo.lock issues

```bash
cd svm-intent-framework
rm Cargo.lock
cargo generate-lockfile
cargo update -p constant_time_eq --precise 0.3.1
cargo update -p blake3 --precise 1.5.0
```
