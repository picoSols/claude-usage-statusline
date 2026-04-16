#!/usr/bin/env bash
# Pull latest changes and re-run install to pick up any new settings.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"
git pull --ff-only
exec "$SCRIPT_DIR/install.sh"
