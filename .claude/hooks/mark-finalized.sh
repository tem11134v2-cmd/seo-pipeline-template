#!/usr/bin/env bash
# mark-finalized.sh — SubagentStop-хук для article-finalizer.
# Фиксирует состояние `finalized` в meta.json текущей статьи.
#
# В отличие от старого pause-for-review.sh: НЕ делает паузу и НЕ выводит
# инструкций пользователю. Управление паузой целиком на стороне скила
# `seo-statya` (он сам решает, стоит ли спрашивать /continue, в зависимости
# от флага `meta.mode == "review"`).
#
# Активная статья: ТОЛЬКО .claude/tmp/current-article.txt (однострочный указатель,
# обновляется скилом перед каждым делегированием - актуален и в серийном режиме,
# где current-task.txt содержит несколько строк, по одной на статью батча).
#
# Область действия жестко ограничена статьями - две страховки:
#   1. Нет current-article.txt - выходим. Fallback на первую строку
#      current-task.txt убран: он срабатывал в ЛЮБОЙ не-статейной задаче
#      (/seo-struktura, /seo-analiz, /seo-tehaudit, /seo-tekst, /seo-metategi,
#      /seo-faq, /custom-question) - останавливался любой их субагент, и в
#      meta.json задачи прилетал state `finalized`, которого нет в их state
#      machine. Это ломало --resume, родительский /status и оставляло грязное
#      дерево сразу после финального коммита.
#   2. Путь не ведет в articles/ - выходим. Страховка от протухшего
#      current-article.txt в переиспользованной сессии.
# Матчер `article-finalizer` на SubagentStop в settings.json оказался
# ненадежным (хук отрабатывал и после structure-writer / structure-verifier),
# поэтому обе проверки продублированы внутри скрипта.
#
# Этот хук — узкая утилита: state = finalized, обновить updated. Всё.

set -u

PROJECT_ROOT="$(pwd)"
TMP_DIR="${PROJECT_ROOT}/.claude/tmp"
ACTIVE_FILE="${TMP_DIR}/current-article.txt"

# Страховка 1: без указателя активной статьи хук не делает ничего.
[ -f "${ACTIVE_FILE}" ] || exit 0

article_dir=$(head -n 1 "${ACTIVE_FILE}" | tr -d '\r\n')
[ -n "${article_dir}" ] || exit 0

# Страховка 2: только статьи. Сверяем ДО абсолютизации пути, нормализовав
# разделители (в current-article.txt встречается и Windows-стиль).
norm_dir=$(printf '%s' "${article_dir}" | tr '\\' '/')
case "${norm_dir}" in
  articles/*|*/articles/*) ;;
  *) exit 0 ;;
esac

case "${article_dir}" in
  /*|[a-zA-Z]:*) ;;
  *) article_dir="${PROJECT_ROOT}/${article_dir}" ;;
esac

if [ -d "${article_dir}" ]; then
  bash "${PROJECT_ROOT}/.claude/hooks/update-meta.sh" "${article_dir}" finalized || true
fi

exit 0
