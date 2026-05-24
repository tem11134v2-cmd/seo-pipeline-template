#!/usr/bin/env bash
# check-jm-balance.sh — PreToolUse-хук для mcp__jm__jm_text_analyze.
# Проверяет баланс JM перед запуском дорогого text_analyze.
#
# Стратегия:
#   1. Если в .env есть JM_BALANCE_URL и JM_TOKEN — делаем curl на эндпоинт jm_account.
#   2. Если переменных нет — пропускаем (exit 0), не блокируя выполнение.
#   3. Если баланс < 5 — exit 2 с сообщением.
#
# Это «дешёвый» хук — он не должен сам по себе ронять пайплайн при отсутствии настроек.

set -u

MIN_BALANCE="${JM_MIN_BALANCE:-5}"
ENV_FILE="$(pwd)/.env"

if [ -f "${ENV_FILE}" ]; then
  # shellcheck disable=SC1090
  set -a; . "${ENV_FILE}"; set +a
fi

# Если нет ни одного признака настройки — мягко пропускаем.
if [ -z "${JM_BALANCE_URL:-}" ] || [ -z "${JM_TOKEN:-}" ]; then
  exit 0
fi

if ! command -v curl >/dev/null 2>&1; then
  # Нет curl — пропускаем.
  exit 0
fi

response=$(curl -fsS --max-time 10 \
  -H "Authorization: Bearer ${JM_TOKEN}" \
  "${JM_BALANCE_URL}" 2>/dev/null || true)

if [ -z "${response}" ]; then
  # Эндпоинт недоступен — пропускаем, не блокируем.
  exit 0
fi

# Пытаемся вытащить баланс через jq, fallback — grep
balance=""
if command -v jq >/dev/null 2>&1; then
  balance=$(printf '%s' "${response}" | jq -r '.balance // .limits // .info.balance // empty' 2>/dev/null || true)
fi
if [ -z "${balance}" ]; then
  balance=$(printf '%s' "${response}" | grep -oE '"balance"\s*:\s*[0-9]+' | head -n 1 | grep -oE '[0-9]+' || true)
fi

if [ -z "${balance}" ]; then
  # Не смогли распарсить — пропускаем.
  exit 0
fi

if [ "${balance}" -lt "${MIN_BALANCE}" ] 2>/dev/null; then
  echo "check-jm-balance: недостаточно лимитов JM (${balance}), нужно ≥${MIN_BALANCE}. Прерываю text_analyze." >&2
  exit 2
fi

exit 0
