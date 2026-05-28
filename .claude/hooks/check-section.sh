#!/usr/bin/env bash
# check-section.sh — SubagentStop-хук для section-writer.
# Проверяет последний созданный sections/<N>-*.md:
#   1. Содержит ровно один `## ` заголовок (один H2)
#   2. Заголовок соответствует ожидаемому из ТЗ (по индексу)
#   3. Объём в пределах ТЗ ±30%
#   4. Нет длинных тире (—) и средних (–)
#
# Контракт: текущая активная статья хранится в .claude/tmp/current-task.txt
# (путь к articles/NNN-slug/). Делегирующий промт скила write-article
# обновляет этот файл перед каждым вызовом section-writer.
#
# exit 0 — ОК, exit 2 + stderr — критичное нарушение.

set -u

PROJECT_ROOT="$(pwd)"
TMP_DIR="${PROJECT_ROOT}/.claude/tmp"
CURRENT_FILE="${TMP_DIR}/current-task.txt"

if [ ! -f "${CURRENT_FILE}" ]; then
  # Не знаем, какая статья активна — пропускаем
  exit 0
fi

article_dir=$(head -n 1 "${CURRENT_FILE}" | tr -d '\r\n')
case "${article_dir}" in
  /*|[a-zA-Z]:*) ;;
  *) article_dir="${PROJECT_ROOT}/${article_dir}" ;;
esac

sections_dir="${article_dir}/sections"
if [ ! -d "${sections_dir}" ]; then
  exit 0
fi

# Последний по времени .md в sections/
last_section=$(ls -t "${sections_dir}"/*.md 2>/dev/null | head -n 1 || true)
if [ -z "${last_section}" ] || [ ! -f "${last_section}" ]; then
  echo "check-section: не найден ни один файл в ${sections_dir}" >&2
  exit 2
fi

errors=""

# 1. Один H2
h2_count=$(grep -cE '^## [^#]' "${last_section}" || true)
if [ "${h2_count}" != "1" ]; then
  errors="${errors}\n- В разделе ${last_section##*/} найдено H2-заголовков: ${h2_count} (ожидается ровно 1)"
fi

# 2. Длинные тире
if grep -qE '[—–]' "${last_section}"; then
  bad_lines=$(grep -nE '[—–]' "${last_section}" | head -n 3 | sed 's/^/    /')
  errors="${errors}\n- Найдены длинные/средние тире в ${last_section##*/}:\n${bad_lines}"
fi

# 3. Стоп-слова бренда из ЗАКАЗЧИК.md
client_md="${PROJECT_ROOT}/ЗАКАЗЧИК.md"
if [ -f "${client_md}" ]; then
  # Достаём значение строки таблицы: «| Стоп-слова (запрещённые) | a, b, c |»
  stop_raw=$(grep -i '^|.*Стоп-слова' "${client_md}" | head -n 1 | awk -F '|' '{print $3}' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' || true)
  if [ -n "${stop_raw}" ] && ! echo "${stop_raw}" | grep -qiE '^_?не заполнено_?$'; then
    # Разбираем по запятой
    IFS=',' read -ra stop_words <<< "${stop_raw}"
    hits=""
    for raw_word in "${stop_words[@]}"; do
      word=$(echo "${raw_word}" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')
      [ -z "${word}" ] && continue
      # Регистронезависимый поиск, контекст +- 2 слова через grep -i
      matches=$(grep -in -- "${word}" "${last_section}" 2>/dev/null | head -n 3 || true)
      if [ -n "${matches}" ]; then
        hits="${hits}\n  Стоп-слово «${word}»:\n$(echo "${matches}" | sed 's/^/    /')"
      fi
    done
    if [ -n "${hits}" ]; then
      errors="${errors}\n- Найдены стоп-слова бренда (из ЗАКАЗЧИК.md → Бренд → «Стоп-слова (запрещённые)»):${hits}"
    fi
  fi
fi

# 4. Объём (грубая оценка по словам)
word_count=$(tr -s '[:space:]' '\n' < "${last_section}" | grep -cE '\S' || true)
# Ищем ожидаемый минимальный объём в progress.json для текущей секции
if command -v jq >/dev/null 2>&1 && [ -f "${sections_dir}/progress.json" ]; then
  current_section=$(jq -r '.current_section // empty' "${sections_dir}/progress.json" 2>/dev/null || true)
  if [ -n "${current_section}" ]; then
    target_volume=$(jq -r --arg k "${current_section}" '.section_volumes_target[$k] // empty' "${sections_dir}/progress.json" 2>/dev/null || true)
    if [ -n "${target_volume}" ] && [ "${target_volume}" -gt 0 ] 2>/dev/null; then
      lower=$(( target_volume * 70 / 100 ))
      upper=$(( target_volume * 130 / 100 ))
      if [ "${word_count}" -lt "${lower}" ] || [ "${word_count}" -gt "${upper}" ]; then
        errors="${errors}\n- Объём раздела ${last_section##*/} = ${word_count} слов, цель ~${target_volume} (допуск ±30%: ${lower}-${upper})"
      fi
    fi
  fi
fi

if [ -n "${errors}" ]; then
  printf 'check-section: критичные нарушения:%b\n' "${errors}" >&2
  exit 2
fi

exit 0
