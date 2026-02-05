#!/bin/bash

# Verify trusted-gmp is running script
# Checks if trusted-gmp process is running and initialized, panics if not
# PID (Process ID) is stored in trusted-gmp.pid file when trusted-gmp starts

# Source common utilities
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
source "$SCRIPT_DIR/util.sh"

# Setup project root
setup_project_root

TRUSTED_GMP_LOG_FILE="$PROJECT_ROOT/.tmp/e2e-tests/trusted-gmp.log"
TRUSTED_GMP_PID_FILE="$PROJECT_ROOT/.tmp/e2e-tests/trusted-gmp.pid"

# Check if PID file exists
if [ ! -f "$TRUSTED_GMP_PID_FILE" ]; then
    log_and_echo "❌ PANIC: Trusted-GMP PID file not found: $TRUSTED_GMP_PID_FILE"
    log_and_echo "   Trusted-GMP may not have started successfully"
    display_service_logs "Trusted-GMP PID file missing"
    exit 1
fi

# Read PID from file
TRUSTED_GMP_PID=$(cat "$TRUSTED_GMP_PID_FILE" 2>/dev/null)

if [ -z "$TRUSTED_GMP_PID" ]; then
    log_and_echo "❌ PANIC: Trusted-GMP PID file is empty: $TRUSTED_GMP_PID_FILE"
    display_service_logs "Trusted-GMP PID file empty"
    exit 1
fi

# Check if process is running
if ! ps -p "$TRUSTED_GMP_PID" > /dev/null 2>&1; then
    log_and_echo "❌ PANIC: Trusted-GMP process died (PID: $TRUSTED_GMP_PID)"
    log_and_echo "   Process ID $TRUSTED_GMP_PID is not running"
    display_service_logs "Trusted-GMP process died"
    exit 1
fi

# Check if log file exists and has initialization message
if [ ! -f "$TRUSTED_GMP_LOG_FILE" ]; then
    log_and_echo "❌ PANIC: Trusted-GMP log file not found: $TRUSTED_GMP_LOG_FILE"
    display_service_logs "Trusted-GMP log file missing"
    exit 1
fi

if ! grep -q "Native GMP relay initialized successfully" "$TRUSTED_GMP_LOG_FILE" 2>/dev/null; then
    log_and_echo "❌ PANIC: Trusted-GMP did not initialize successfully"
    log_and_echo "   Log file exists but initialization message not found"
    log_and_echo "   Log contents:"
    cat "$TRUSTED_GMP_LOG_FILE" | head -50 | sed 's/^/   /'
    display_service_logs "Trusted-GMP initialization failed"
    exit 1
fi

# Trusted-GMP is running and initialized - show confirmation
log_and_echo "✅ Trusted-GMP is running (PID: $TRUSTED_GMP_PID)"
if [ -f "$TRUSTED_GMP_LOG_FILE" ]; then
    log_and_echo "   Trusted-GMP log (first 10 lines):"
    head -10 "$TRUSTED_GMP_LOG_FILE" | sed 's/^/   /'
fi
