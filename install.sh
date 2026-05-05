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

# Pass values via env vars and a quoted heredoc so paths containing
# quote characters can't break out of the JS string and run code.
mkdir -p "$(dirname "$SETTINGS_FILE")"
if [ -f "$SETTINGS_FILE" ]; then
  verb="Updated"
else
  verb="Created"
fi
CC_SL_FILE="$SETTINGS_FILE" CC_SL_COMMAND="$COMMAND" "$NODE_BIN" <<'NODE_EOF'
const fs = require('fs');
const f = process.env.CC_SL_FILE;
let settings = {};
try { settings = JSON.parse(fs.readFileSync(f, 'utf8')); } catch {}
settings.statusLine = { type: 'command', command: process.env.CC_SL_COMMAND };
fs.writeFileSync(f, JSON.stringify(settings, null, 2) + '\n');
NODE_EOF
echo "$verb statusLine in $SETTINGS_FILE"

# --- Prime the cache ---
echo "Priming usage cache..."
"$NODE_BIN" "$SCRIPT_DIR/cc-usage-refresh.js" 2>/dev/null && echo "Cache primed." || echo "Cache prime failed (run 'claude login' if token is missing)."

echo ""
echo "Done. Restart Claude Code to see the statusline."
