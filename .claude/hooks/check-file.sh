#!/usr/bin/env bash
# check-file.sh — универсальный SubagentStop-хук.
# Проверяет, что выходной файл субагента создан и не пустой.
#
# Контракт с делегирующим промтом:
#   Делегирующий промт сохраняет путь к ожидаемому файлу в
#     .claude/tmp/expected-<agent>-<run_id>.txt
#   (одна строка — абсолютный или относительный путь к файлу).
#
# Хук читает stdin (JSON от Claude Code), пытается определить агента и run_id,
# затем читает соответствующий expected-файл. Если файла-маркера нет — хук
# просто пропускает проверку (exit 0), чтобы не блокировать выполнение.
#
# exit 0 — ОК, exit 2 + stderr — ошибка (Claude видит сообщение).

set -u

PROJECT_ROOT="$(pwd)"
TMP_DIR="${PROJECT_ROOT}/.claude/tmp"
INPUT="$(cat -)"

# Пытаемся достать имя субагента из JSON-payload (если есть jq) или из ENV.
agent=""
run_id=""
if command -v jq >/dev/null 2>&1 && [ -n "${INPUT}" ]; then
  agent=$(printf '%s' "${INPUT}" | jq -r '.agent_name // .subagent_type // .matcher // empty' 2>/dev/null || true)
  run_id=$(printf '%s' "${INPUT}" | jq -r '.run_id // .session_id // empty' 2>/dev/null || true)
fi

# Если структуру не удалось распарсить — пробуем самый свежий expected-файл.
expected_file=""
if [ -n "${agent}" ] && [ -n "${run_id}" ] && [ -f "${TMP_DIR}/expected-${agent}-${run_id}.txt" ]; then
  expected_file="${TMP_DIR}/expected-${agent}-${run_id}.txt"
elif [ -n "${agent}" ]; then
  candidate=$(ls -t "${TMP_DIR}"/expected-"${agent}"-*.txt 2>/dev/null | head -n 1 || true)
  [ -n "${candidate}" ] && expected_file="${candidate}"
fi
if [ -z "${expected_file}" ]; then
  candidate=$(ls -t "${TMP_DIR}"/expected-*.txt 2>/dev/null | head -n 1 || true)
  [ -n "${candidate}" ] && expected_file="${candidate}"
fi

if [ -z "${expected_file}" ] || [ ! -f "${expected_file}" ]; then
  # Маркера нет — пропускаем проверку.
  exit 0
fi

target=$(head -n 1 "${expected_file}" | tr -d '\r\n')
if [ -z "${target}" ]; then
  exit 0
fi

# Абсолютный путь?
case "${target}" in
  /*|[a-zA-Z]:*) abs_target="${target}" ;;
  *) abs_target="${PROJECT_ROOT}/${target}" ;;
esac

if [ ! -f "${abs_target}" ]; then
  echo "check-file: ожидаемый файл не создан: ${abs_target}" >&2
  exit 2
fi

size=$(wc -c < "${abs_target}" | tr -d ' ')
if [ "${size:-0}" -le 0 ]; then
  echo "check-file: файл пустой: ${abs_target}" >&2
  exit 2
fi

# Если markdown — должен быть хотя бы один заголовок
case "${abs_target}" in
  *.md|*.MD)
    if ! grep -qE '^#{1,6} ' "${abs_target}"; then
      echo "check-file: в markdown-файле нет ни одного заголовка: ${abs_target}" >&2
      exit 2
    fi
    ;;
esac

# Удаляем маркер — задача проверена
rm -f "${expected_file}" 2>/dev/null || true

exit 0
