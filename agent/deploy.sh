#!/bin/bash
set -e

# Quick stop / start for an already-installed claude-monitor deployment.
# Usage:
#   ./deploy.sh stop      # stop agent service + remove hooks
#   ./deploy.sh start     # start agent service + install hooks
#   ./deploy.sh restart   # stop then start

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HOOKS_BIN="${SCRIPT_DIR}/dist/setup-hooks.js"
NODE="$(which node 2>/dev/null || echo node)"

# ── Detect OS ──
if [[ "$OSTYPE" == "darwin"* ]]; then
    OS="macos"
    PLIST="${HOME}/Library/LaunchAgents/com.claude-monitor.agent.plist"
elif [[ "$OSTYPE" == "linux-gnu"* ]] || [[ "$OSTYPE" == "linux" ]]; then
    OS="linux"
else
    echo "Unsupported OS: $OSTYPE" >&2
    exit 1
fi

# ── Helpers ──

stop_service() {
    echo "Stopping agent service..."
    if [[ "$OS" == "macos" ]]; then
        if launchctl list com.claude-monitor.agent &>/dev/null; then
            launchctl unload "$PLIST" 2>/dev/null && echo "  launchd agent unloaded." || echo "  launchd agent already stopped."
        else
            echo "  launchd agent not loaded."
        fi
    else
        if systemctl --user is-active --quiet claude-monitor-agent 2>/dev/null; then
            systemctl --user stop claude-monitor-agent && echo "  systemd service stopped."
        else
            echo "  systemd service already stopped."
        fi
    fi
}

start_service() {
    echo "Starting agent service..."
    if [[ "$OS" == "macos" ]]; then
        if [[ ! -f "$PLIST" ]]; then
            echo "  Error: plist not found at $PLIST — run install.sh first." >&2
            return 1
        fi
        launchctl load "$PLIST" && echo "  launchd agent loaded."
    else
        systemctl --user start claude-monitor-agent && echo "  systemd service started."
    fi
}

remove_hooks() {
    echo "Removing Claude Code hooks..."
    if [[ -f "$HOOKS_BIN" ]]; then
        "$NODE" "$HOOKS_BIN" --remove && echo "  Hooks removed."
    else
        echo "  Warning: $HOOKS_BIN not found — skipping."
    fi
}

install_hooks() {
    echo "Installing Claude Code hooks..."
    if [[ -f "$HOOKS_BIN" ]]; then
        "$NODE" "$HOOKS_BIN" && echo "  Hooks installed."
    else
        echo "  Warning: $HOOKS_BIN not found — skipping."
    fi
}

# ── Main ──

ACTION="${1:-}"

case "$ACTION" in
    stop)
        stop_service
        remove_hooks
        echo "Done. Agent stopped, hooks removed."
        ;;
    start)
        start_service
        install_hooks
        echo "Done. Agent started, hooks installed."
        ;;
    restart)
        stop_service
        remove_hooks
        echo ""
        start_service
        install_hooks
        echo "Done. Agent restarted, hooks reinstalled."
        ;;
    *)
        echo "Usage: $0 {stop|start|restart}"
        exit 1
        ;;
esac
