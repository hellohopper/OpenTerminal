#!/bin/sh
# Finder opens .command files in Terminal. Use the configured Node even with its minimal PATH.
set -eu
task_root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
task_configured_node=""
if [ -f "$task_root/config/server.json" ]; then
  task_configured_node=$(/usr/bin/plutil -extract node raw -o - "$task_root/config/server.json" 2>/dev/null || true)
fi
task_path_node=$(command -v node 2>/dev/null || true)
for task_node in "${OPENTERMINAL_NODE:-}" "$task_configured_node" "$task_path_node" /opt/homebrew/bin/node /usr/local/bin/node; do
  if [ -n "$task_node" ] && [ -x "$task_node" ]; then
    exec "$task_node" "$task_root/scripts/mac-service.mjs" menu
  fi
done
printf '%s\n' 'OpenTerminal needs Node.js 22.12 or newer. Install Node or set OPENTERMINAL_NODE to its executable path.'
printf '%s' 'Press Return to close: '
read -r task_reply || true
exit 1
