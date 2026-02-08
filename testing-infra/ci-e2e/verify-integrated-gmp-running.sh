#!/bin/bash

# Verify integrated-gmp is running script
# Checks if integrated-gmp process is running and initialized, panics if not
# PID (Process ID) is stored in integrated-gmp.pid file when integrated-gmp starts

# Source common utilities
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
source "$SCRIPT_DIR/util.sh"

# Setup project root
setup_project_root

INTEGRATED_GMP_LOG_FILE="$PROJECT_ROOT/.tmp/e2e-tests/integrated-gmp.log"
INTEGRATED_GMP_PID_FILE="$PROJECT_ROOT/.tmp/e2e-tests/integrated-gmp.pid"

# Check if PID file exists
if [ ! -f "$INTEGRATED_GMP_PID_FILE" ]; then
    log_and_echo "❌ PANIC: Integrated-GMP PID file not found: $INTEGRATED_GMP_PID_FILE"
    log_and_echo "   Integrated-GMP may not have started successfully"
    display_service_logs "Integrated-GMP PID file missing"
    exit 1
fi

# Read PID from file
INTEGRATED_GMP_PID=$(cat "$INTEGRATED_GMP_PID_FILE" 2>/dev/null)

if [ -z "$INTEGRATED_GMP_PID" ]; then
    log_and_echo "❌ PANIC: Integrated-GMP PID file is empty: $INTEGRATED_GMP_PID_FILE"
    display_service_logs "Integrated-GMP PID file empty"
    exit 1
fi

# Check if process is running
if ! ps -p "$INTEGRATED_GMP_PID" > /dev/null 2>&1; then
    log_and_echo "❌ PANIC: Integrated-GMP process died (PID: $INTEGRATED_GMP_PID)"
    log_and_echo "   Process ID $INTEGRATED_GMP_PID is not running"
    display_service_logs "Integrated-GMP process died"
    exit 1
fi

# Check if log file exists and has initialization message
if [ ! -f "$INTEGRATED_GMP_LOG_FILE" ]; then
    log_and_echo "❌ PANIC: Integrated-GMP log file not found: $INTEGRATED_GMP_LOG_FILE"
    display_service_logs "Integrated-GMP log file missing"
    exit 1
fi

if ! grep -q "Integrated GMP relay initialized successfully" "$INTEGRATED_GMP_LOG_FILE" 2>/dev/null; then
    log_and_echo "❌ PANIC: Integrated-GMP did not initialize successfully"
    log_and_echo "   Log file exists but initialization message not found"
    log_and_echo "   Log contents:"
    cat "$INTEGRATED_GMP_LOG_FILE" | head -50 | sed 's/^/   /'
    display_service_logs "Integrated-GMP initialization failed"
    exit 1
fi

# Integrated-GMP is running and initialized - show confirmation
log_and_echo "✅ Integrated-GMP is running (PID: $INTEGRATED_GMP_PID)"
if [ -f "$INTEGRATED_GMP_LOG_FILE" ]; then
    log_and_echo "   Integrated-GMP log (first 10 lines):"
    head -10 "$INTEGRATED_GMP_LOG_FILE" | sed 's/^/   /'
fi
