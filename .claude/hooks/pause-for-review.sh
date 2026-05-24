#!/usr/bin/env bash
# pause-for-review.sh — SubagentStop-хук для article-finalizer.
# Выводит формализованное сообщение для пользователя и фиксирует
# состояние awaiting-review в meta.json текущей статьи.
#
# Это сигнал скилу write-article остановить выполнение и ждать команду
# /continue или /edit "..." от пользователя.

set -u

PROJECT_ROOT="$(pwd)"
TMP_DIR="${PROJECT_ROOT}/.claude/tmp"
CURRENT_FILE="${TMP_DIR}/current-task.txt"
# fallback на старое имя
if [ ! -f "${CURRENT_FILE}" ] && [ -f "${TMP_DIR}/current-article.txt" ]; then
  CURRENT_FILE="${TMP_DIR}/current-article.txt"
fi

article_dir=""
if [ -f "${CURRENT_FILE}" ]; then
  article_dir=$(head -n 1 "${CURRENT_FILE}" | tr -d '\r\n')
  case "${article_dir}" in
    /*|[a-zA-Z]:*) ;;
    *) article_dir="${PROJECT_ROOT}/${article_dir}" ;;
  esac
fi

# Обновить meta.json через update-meta.sh
if [ -n "${article_dir}" ] && [ -d "${article_dir}" ]; then
  bash "${PROJECT_ROOT}/.claude/hooks/update-meta.sh" "${article_dir}" awaiting-review || true
fi

rel="${article_dir#${PROJECT_ROOT}/}"
[ -z "${rel}" ] && rel="${article_dir}"

cat <<EOF
═══ СТАТЬЯ ГОТОВА К ПРОВЕРКЕ ═══
Файл: ${rel}/article.md
Метатеги: см. ${rel}/report.md
Сводный отчёт: ${rel}/report.md, раздел «Сводный отчёт»

Прочитай article.md. Затем:
  /continue — переход к аудиту и упаковке
  /edit "описание" — точечная правка через article-fixer
══════════════════════════════════
EOF

exit 0
