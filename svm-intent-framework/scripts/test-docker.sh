#!/usr/bin/env bash
# Test SVM build in Docker to simulate CI environment (x86_64, like GitHub Actions)
# Usage: ./scripts/test-docker.sh [--rebuild]
#
# Options:
#   --rebuild    Force rebuild of the Docker image
#
# This uses a pre-built Docker image with all tools installed for fast iteration.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(dirname "$PROJECT_DIR")"
IMAGE_NAME="svm-intent-test"

# Check for rebuild flag
REBUILD=false
if [[ "$1" == "--rebuild" ]]; then
    REBUILD=true
fi

echo "[test-docker.sh] Running SVM tests in Docker (simulating CI with x86_64)..."
echo "[test-docker.sh] Note: Using --platform linux/amd64 to match GitHub Actions"

# Build image if it doesn't exist or rebuild requested
if [[ "$REBUILD" == "true" ]] || ! docker image inspect "$IMAGE_NAME" >/dev/null 2>&1; then
    echo "[test-docker.sh] Building Docker image '$IMAGE_NAME'..."
    echo "[test-docker.sh] (This may take a few minutes on first run, but subsequent runs will be fast)"
    
    # Use --no-cache when rebuilding to ensure clean state
    CACHE_FLAG=""
    if [[ "$REBUILD" == "true" ]]; then
        CACHE_FLAG="--no-cache"
    fi
    
    docker build \
        --platform linux/amd64 \
        $CACHE_FLAG \
        -f "$PROJECT_DIR/Dockerfile.test" \
        -t "$IMAGE_NAME" \
        "$PROJECT_DIR"
    echo "[test-docker.sh] Docker image built successfully!"
else
    echo "[test-docker.sh] Using existing Docker image '$IMAGE_NAME' (use --rebuild to force rebuild)"
fi

# Run tests
echo "[test-docker.sh] Running tests..."
docker run --rm \
    --platform linux/amd64 \
    --privileged \
    -v "$REPO_ROOT":/workspace \
    -w /workspace \
    "$IMAGE_NAME"

echo "[test-docker.sh] Done!"
