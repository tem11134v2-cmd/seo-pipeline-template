#!/usr/bin/env bash
# _node.sh — POSIX-обёртка для запуска node (Git Bash на Windows, или Linux/Mac).
# Использование: .claude/scripts/_node.sh script.mjs args
#
# Ищет node по приоритету:
#   1. node в PATH
#   2. scoop: ~/scoop/apps/nodejs-lts/current/node.exe
#   3. system: /c/Program Files/nodejs/node.exe (Windows через Git Bash)
#   4. /usr/local/bin/node, /usr/bin/node (Linux/Mac)

set -u

if command -v node >/dev/null 2>&1; then
  exec node "$@"
fi

CANDIDATES=(
  "$HOME/scoop/apps/nodejs-lts/current/node.exe"
  "$HOME/scoop/apps/nodejs/current/node.exe"
  "/c/Program Files/nodejs/node.exe"
  "/usr/local/bin/node"
  "/usr/bin/node"
)

for p in "${CANDIDATES[@]}"; do
  if [ -x "$p" ]; then
    exec "$p" "$@"
  fi
done

echo "[_node.sh] Node.js не найден. Установи: scoop install nodejs-lts (Windows) или brew install node (Mac)." >&2
echo "[_node.sh] После установки перезапусти Claude Code Desktop." >&2
exit 127
