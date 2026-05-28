#!/usr/bin/env bash
# mark-finalized.sh — SubagentStop-хук для article-finalizer.
# Фиксирует состояние `finalized` в meta.json текущей статьи.
#
# В отличие от старого pause-for-review.sh: НЕ делает паузу и НЕ выводит
# инструкций пользователю. Управление паузой целиком на стороне скила
# `write-article` (он сам решает, стоит ли спрашивать /continue, в зависимости
# от флага `meta.mode == "review"`).
#
# Этот хук — узкая утилита: state = finalized, обновить updated. Всё.

set -u

PROJECT_ROOT="$(pwd)"
TMP_DIR="${PROJECT_ROOT}/.claude/tmp"
CURRENT_FILE="${TMP_DIR}/current-task.txt"

article_dir=""
if [ -f "${CURRENT_FILE}" ]; then
  article_dir=$(head -n 1 "${CURRENT_FILE}" | tr -d '\r\n')
  case "${article_dir}" in
    /*|[a-zA-Z]:*) ;;
    *) article_dir="${PROJECT_ROOT}/${article_dir}" ;;
  esac
fi

if [ -n "${article_dir}" ] && [ -d "${article_dir}" ]; then
  bash "${PROJECT_ROOT}/.claude/hooks/update-meta.sh" "${article_dir}" finalized || true
fi

exit 0
