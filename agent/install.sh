#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
AGENT_DIR="$(dirname "$SCRIPT_DIR")"

echo "Claude Code Monitor Agent Installer"
echo "===================================="

# Detect OS
if [[ "$OSTYPE" == "darwin"* ]]; then
    OS="macos"
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    OS="linux"
else
    echo "Unsupported OS: $OSTYPE"
    exit 1
fi

# Check for config
CONFIG_PATH="${HOME}/.claude-monitor/agent-config.json"
if [[ ! -f "$CONFIG_PATH" ]]; then
    echo ""
    echo "No config found at $CONFIG_PATH"
    echo "Creating template config..."
    mkdir -p "$(dirname "$CONFIG_PATH")"
    cat > "$CONFIG_PATH" << 'TMPL'
{
  "serverUrl": "http://your-server:19876",
  "apiKey": "",
  "machineName": "CHANGE_ME",
  "environment": "local",
  "pollIntervalSeconds": 5,
  "heartbeatIntervalSeconds": 30
}
TMPL
    echo "Please edit $CONFIG_PATH with your settings, then re-run this script."
    exit 0
fi

# Build agent (only install agent + shared workspace dependencies, skip server/ui)
echo "Building agent..."
cd "$AGENT_DIR"
npm install --workspace=shared --workspace=agent
npx --workspace=shared tsc
npx --workspace=agent tsc

AGENT_BIN="${AGENT_DIR}/agent/dist/index.js"
HOOKS_BIN="${AGENT_DIR}/agent/dist/setup-hooks.js"

if [[ "$OS" == "linux" ]]; then
    echo "Installing systemd user service..."
    mkdir -p "${HOME}/.config/systemd/user"
    cat > "${HOME}/.config/systemd/user/claude-monitor-agent.service" << EOF
[Unit]
Description=Claude Code Monitor Agent
After=network.target

[Service]
Type=simple
ExecStart=$(which node) ${AGENT_BIN}
Restart=always
RestartSec=10
Environment=CLAUDE_MONITOR_AGENT_CONFIG=${CONFIG_PATH}

[Install]
WantedBy=default.target
EOF

    systemctl --user daemon-reload
    systemctl --user enable claude-monitor-agent
    systemctl --user start claude-monitor-agent
    echo "Service installed and started."
    echo "  Status: systemctl --user status claude-monitor-agent"
    echo "  Logs:   journalctl --user -u claude-monitor-agent -f"

elif [[ "$OS" == "macos" ]]; then
    echo "Installing launchd agent..."
    PLIST_PATH="${HOME}/Library/LaunchAgents/com.claude-monitor.agent.plist"
    cat > "$PLIST_PATH" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.claude-monitor.agent</string>
    <key>ProgramArguments</key>
    <array>
        <string>$(which node)</string>
        <string>${AGENT_BIN}</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>EnvironmentVariables</key>
    <dict>
        <key>CLAUDE_MONITOR_AGENT_CONFIG</key>
        <string>${CONFIG_PATH}</string>
    </dict>
    <key>StandardOutPath</key>
    <string>${HOME}/.claude-monitor/agent.log</string>
    <key>StandardErrorPath</key>
    <string>${HOME}/.claude-monitor/agent.err</string>
</dict>
</plist>
EOF

    launchctl load "$PLIST_PATH"
    echo "Service installed and started."
    echo "  Logs: tail -f ~/.claude-monitor/agent.log"
    echo "  Stop: launchctl unload $PLIST_PATH"
fi

# Set up Claude Code hooks for real-time status
echo ""
echo "Setting up Claude Code hooks..."
if node "$HOOKS_BIN" 2>/dev/null; then
    echo "Hooks installed successfully."
else
    echo "Warning: Could not set up hooks. You can run manually later:"
    echo "  node ${HOOKS_BIN}"
fi

echo ""
echo "Done!"
