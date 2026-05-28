#!/usr/bin/env bash
# update-meta.sh — вспомогательный хук, обновляющий meta.json текущей статьи.
#
# Вызовы:
#   bash update-meta.sh <article_dir> <state> [<extra_key=value>...]
#
# Обновляет:
#   - state
#   - updated (ISO timestamp UTC)
#   - completed_steps += [state] если ещё не было
#   - произвольные ключи из extra (через jq)
#
# Если jq не установлен — fallback: перезаписываем только state и updated
# через простой sed-патч (грубо, но работает для базовых случаев).

set -u

article_dir="${1:-}"
new_state="${2:-}"
shift 2 || true

if [ -z "${article_dir}" ] || [ -z "${new_state}" ]; then
  echo "usage: update-meta.sh <article_dir> <state> [k=v ...]" >&2
  exit 1
fi

meta_file="${article_dir}/meta.json"
now=$(date -u +%Y-%m-%dT%H:%M:%SZ)

if [ ! -f "${meta_file}" ]; then
  # Создаём минимальную мету
  cat > "${meta_file}" <<EOF
{
  "state": "${new_state}",
  "completed_steps": ["${new_state}"],
  "started": "${now}",
  "updated": "${now}"
}
EOF
  exit 0
fi

if command -v jq >/dev/null 2>&1; then
  extra_jq='.'
  for kv in "$@"; do
    k="${kv%%=*}"
    v="${kv#*=}"
    extra_jq="${extra_jq} | .${k} = \"${v}\""
  done
  tmp=$(mktemp)
  jq --arg s "${new_state}" --arg u "${now}" "
    .state = \$s
    | .updated = \$u
    | (.completed_steps // []) as \$cs
    | .completed_steps = (\$cs + [\$s] | unique)
    | ${extra_jq#. | }
  " "${meta_file}" > "${tmp}" && mv "${tmp}" "${meta_file}"
else
  # Грубый sed-фоллбэк — только state и updated.
  python_or_node=""
  if command -v node >/dev/null 2>&1; then
    python_or_node="node"
  elif command -v python3 >/dev/null 2>&1; then
    python_or_node="python3"
  fi

  if [ "${python_or_node}" = "node" ]; then
    node -e "
      const fs = require('fs');
      const f = process.argv[1];
      const j = JSON.parse(fs.readFileSync(f, 'utf8'));
      j.state = process.argv[2];
      j.updated = process.argv[3];
      j.completed_steps = Array.from(new Set([...(j.completed_steps||[]), j.state]));
      fs.writeFileSync(f, JSON.stringify(j, null, 2));
    " "${meta_file}" "${new_state}" "${now}"
  elif [ "${python_or_node}" = "python3" ]; then
    python3 - "$meta_file" "$new_state" "$now" <<'PY'
import json, sys
f, st, up = sys.argv[1], sys.argv[2], sys.argv[3]
j = json.load(open(f, encoding='utf-8'))
j['state'] = st
j['updated'] = up
j['completed_steps'] = sorted(set((j.get('completed_steps') or []) + [st]))
open(f, 'w', encoding='utf-8').write(json.dumps(j, ensure_ascii=False, indent=2))
PY
  else
    # Самый грубый вариант — sed
    sed -i.bak -E "s/(\"state\"\s*:\s*\")[^\"]*(\")/\1${new_state}\2/" "${meta_file}" || true
    sed -i.bak -E "s/(\"updated\"\s*:\s*\")[^\"]*(\")/\1${now}\2/" "${meta_file}" || true
    rm -f "${meta_file}.bak" 2>/dev/null || true
  fi
fi

# Best-effort: обновить articles/_index.json (только для статей, не для стратегий)
# Определяется по тому, что parent_dir заканчивается на "articles"
parent_dir=$(dirname "${article_dir}")
if [ "$(basename "${parent_dir}")" = "articles" ]; then
  node_cmd=""
  if command -v node >/dev/null 2>&1; then
    node_cmd="node"
  elif [ -f "$(dirname "$0")/../scripts/_node.cmd" ]; then
    node_cmd="$(dirname "$0")/../scripts/_node.cmd"
  fi
  if [ -n "${node_cmd}" ]; then
    "${node_cmd}" "$(dirname "$0")/../scripts/update-index.mjs" "${article_dir}" 2>/dev/null || true
  fi
fi

exit 0
