#!/usr/bin/env bash
# claude-usage-statusline installer
# Resolves the absolute node path (nvm/fnm/volta/brew/system) and writes
# the statusLine entry into ~/.claude/settings.json.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
STATUSLINE_JS="$SCRIPT_DIR/statusline.js"
SETTINGS_FILE="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/settings.json"

# --- Resolve absolute node path ---
NODE_BIN=""
if command -v node >/dev/null 2>&1; then
  NODE_BIN="$(command -v node)"
  # Resolve symlinks (nvm/fnm shims → real binary)
  if [ -L "$NODE_BIN" ]; then
    NODE_BIN="$(readlink -f "$NODE_BIN" 2>/dev/null || realpath "$NODE_BIN" 2>/dev/null || echo "$NODE_BIN")"
  fi
fi

if [ -z "$NODE_BIN" ] || [ ! -x "$NODE_BIN" ]; then
  echo "Error: node not found on PATH."
  echo ""
  echo "Install Node.js 18+ and re-run this script, or set the path manually:"
  echo ""
  echo '  "statusLine": {'
  echo '    "type": "command",'
  echo "    \"command\": \"/absolute/path/to/node $STATUSLINE_JS\""
  echo '  }'
  exit 1
fi

NODE_VERSION="$("$NODE_BIN" -e 'console.log(process.versions.node.split(".")[0])')"
if [ "$NODE_VERSION" -lt 18 ] 2>/dev/null; then
  echo "Error: Node.js 18+ required (found v$NODE_VERSION at $NODE_BIN)"
  exit 1
fi

echo "Found node: $NODE_BIN (v$("$NODE_BIN" --version))"

# --- Make scripts executable ---
chmod +x "$STATUSLINE_JS" "$SCRIPT_DIR/cc-usage-refresh.js"

# --- Write settings.json ---
COMMAND="$NODE_BIN $STATUSLINE_JS"

if [ ! -f "$SETTINGS_FILE" ]; then
  mkdir -p "$(dirname "$SETTINGS_FILE")"
  cat > "$SETTINGS_FILE" <<EOF
{
  "statusLine": {
    "type": "command",
    "command": "$COMMAND"
  }
}
EOF
  echo "Created $SETTINGS_FILE"
elif command -v node >/dev/null 2>&1; then
  # Use node to safely merge into existing JSON
  "$NODE_BIN" -e "
    const fs = require('fs');
    const f = '$SETTINGS_FILE';
    let settings = {};
    try { settings = JSON.parse(fs.readFileSync(f, 'utf8')); } catch {}
    settings.statusLine = { type: 'command', command: '$COMMAND' };
    fs.writeFileSync(f, JSON.stringify(settings, null, 2) + '\n');
  "
  echo "Updated statusLine in $SETTINGS_FILE"
else
  echo "Warning: could not update $SETTINGS_FILE automatically."
  echo "Add this manually:"
  echo ""
  echo '  "statusLine": {'
  echo '    "type": "command",'
  echo "    \"command\": \"$COMMAND\""
  echo '  }'
fi

# --- Prime the cache ---
echo "Priming usage cache..."
"$NODE_BIN" "$SCRIPT_DIR/cc-usage-refresh.js" 2>/dev/null && echo "Cache primed." || echo "Cache prime failed (run 'claude login' if token is missing)."

echo ""
echo "Done. Restart Claude Code to see the statusline."
