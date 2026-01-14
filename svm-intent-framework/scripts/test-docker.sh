#!/usr/bin/env bash
# Test SVM build in Docker to simulate CI environment (x86_64, like GitHub Actions)
# Usage: ./scripts/test-docker.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$(dirname "$SCRIPT_DIR")")"

echo "[test-docker.sh] Running SVM tests in Docker (simulating CI with x86_64)..."
echo "[test-docker.sh] Note: Using --platform linux/amd64 to match GitHub Actions"

docker run --rm --privileged \
  --platform linux/amd64 \
  -v "$REPO_ROOT":/workspace \
  -w /workspace \
  nixos/nix \
  bash -c "nix develop --option sandbox false --option filter-syscalls false --extra-experimental-features 'nix-command flakes' -c bash -c 'cd svm-intent-framework && ./scripts/test.sh'"

echo "[test-docker.sh] Done!"
