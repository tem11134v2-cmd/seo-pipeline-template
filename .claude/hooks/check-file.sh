#!/usr/bin/env bash
# check-file.sh — универсальный SubagentStop-хук.
# Проверяет, что выходной файл субагента создан и не пустой
# (или ожидаемая директория существует и непуста).
#
# Контракт с делегирующим промтом:
#   Делегирующий промт сохраняет путь к ожидаемому файлу в
#     .claude/tmp/expected-<agent>-<run_id>.txt
#   (одна строка - абсолютный или относительный путь к файлу ИЛИ директории;
#    директория - проверка непустоты).
#
# Хук читает stdin (JSON от Claude Code), пытается определить агента и run_id,
# затем читает соответствующий expected-файл. Если файла-маркера нет — хук
# просто пропускает проверку (exit 0), чтобы не блокировать выполнение.
#
# Если имя агента из payload непригодно (пусто, "*" из matcher в settings.json,
# другой не-именной мусор) - работает УЗКИЙ фолбэк: маркер берется только когда
# во всей .claude/tmp/ он ровно ОДИН (значит параллельных агентов нет и спутать
# не с чем). Два и больше - проверка честно пропускается. Глобального фолбэка
# «самый свежий любой маркер» нет: при веере он подхватывал чужой маркер.
#
# Дополнительно: если ожидаемый файл - .json, он прогоняется через JSON.parse
# (node, при необходимости через обертку .claude/scripts/_node.sh). Битый JSON -
# exit 2 с позицией ошибки и куском строки вокруг нее, чтобы агент сразу видел,
# где кавычка. Если node недоступен - проверка пропускается: хук не должен
# блокировать конвейер из-за отсутствия ноды.
#
# exit 0 — ОК, exit 2 + stderr — ошибка (Claude видит сообщение).
# При exit 2 маркер expected-*.txt НЕ удаляется: после починки файла проверка
# должна пройти заново.

set -u

PROJECT_ROOT="$(pwd)"
TMP_DIR="${PROJECT_ROOT}/.claude/tmp"
INPUT="$(cat -)"

# Запуск node: сначала из PATH, иначе через обертку .claude/scripts/_node.sh.
# Код 127 - node не найден (проверки, которые на нем держатся, пропускаются).
run_node() {
  if command -v node >/dev/null 2>&1; then
    node "$@"
    return $?
  fi
  if [ -f "${PROJECT_ROOT}/.claude/scripts/_node.sh" ]; then
    bash "${PROJECT_ROOT}/.claude/scripts/_node.sh" "$@"
    return $?
  fi
  return 127
}

# Имя агента пригодно, только если похоже на имя: буквы/цифры/дефис/подчеркивание/
# точка. Пусто, "*" (это matcher из settings.json, а не имя), "null"/"undefined"/
# "empty"/"none" и все, что содержит пробелы или иные символы, - не имя.
agent_name_usable() {
  case "$1" in
    "") return 1 ;;
    "*"|null|undefined|empty|none|NULL|None) return 1 ;;
    *[!A-Za-z0-9_.-]*) return 1 ;;
  esac
  return 0
}

# Пытаемся достать имя субагента из JSON-payload (если есть jq) или из ENV.
agent=""
run_id=""
payload_keys=""
if command -v jq >/dev/null 2>&1 && [ -n "${INPUT}" ]; then
  agent=$(printf '%s' "${INPUT}" | jq -r '.agent_name // .subagent_type // .matcher // empty' 2>/dev/null || true)
  run_id=$(printf '%s' "${INPUT}" | jq -r '.run_id // .session_id // empty' 2>/dev/null || true)
  payload_keys=$(printf '%s' "${INPUT}" | jq -r 'if type == "object" then (keys_unsorted | join(",")) else type end' 2>/dev/null || true)
fi

# jq на машине обычно нет - тот же разбор payload через node (те же ключи).
# Без этого имя агента не определяется вообще и хук вырождается в no-op.
# Третьей строкой node отдает список ключей верхнего уровня: без него на живом
# прогоне не понять, какой формат payload реально приходит.
if ! agent_name_usable "${agent}" && [ -n "${INPUT}" ]; then
  parsed=$(printf '%s' "${INPUT}" | run_node -e '
let s = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => { s += d; });
process.stdin.on("end", () => {
  let j = {};
  try { j = JSON.parse(s); } catch (e) { j = {}; }
  const a = j.agent_name || j.subagent_type || j.matcher || "";
  const r = j.run_id || j.session_id || "";
  const k = (j && typeof j === "object" && !Array.isArray(j)) ? Object.keys(j).join(",") : "";
  process.stdout.write(String(a) + "\n" + String(r) + "\n" + String(k) + "\n");
});
' 2>/dev/null || true)
  parsed_agent=$(printf '%s\n' "${parsed}" | sed -n 1p | tr -d '\r')
  parsed_run=$(printf '%s\n' "${parsed}" | sed -n 2p | tr -d '\r')
  parsed_keys=$(printf '%s\n' "${parsed}" | sed -n 3p | tr -d '\r')
  # Не затираем то, что уже удалось достать через jq.
  [ -n "${parsed_agent}" ] && agent="${parsed_agent}"
  [ -n "${parsed_run}" ] && run_id="${parsed_run}"
  [ -n "${parsed_keys}" ] && payload_keys="${parsed_keys}"
fi
[ -n "${payload_keys}" ] || payload_keys="не определены (нет jq и/или node)"

# Протухшие маркеры (старше 60 минут) - удаляем перед fallback-выбором «самого свежего
# маркера ЭТОГО агента»: маркер упавшего шага не должен отравлять SubagentStop
# последующих запусков того же агента.
prune_stale_markers() {
  now=$(date +%s)
  for f in "${TMP_DIR}"/expected-*.txt; do
    [ -f "$f" ] || continue
    mt=$(stat -c %Y "$f" 2>/dev/null || echo "$now")
    if [ $((now - mt)) -gt 3600 ]; then
      rm -f "$f" 2>/dev/null || true
    fi
  done
}

# Сколько маркеров лежит в .claude/tmp/ и какой из них последний (нужно и для
# узкого фолбэка, и для диагностики при пропуске).
markers_count=0
markers_last=""
count_markers() {
  markers_count=0
  markers_last=""
  for f in "${TMP_DIR}"/expected-*.txt; do
    [ -f "$f" ] || continue
    markers_count=$((markers_count + 1))
    markers_last="$f"
  done
}

# Маркер ищем ТОЛЬКО по имени агента. Глобального фолбэка «самый свежий любой
# маркер» больше нет: при параллельном веере (одиночный агент рядом с шестью
# однотипными) он подхватывал маркер ЧУЖОГО агента и проверял не тот файл.
expected_file=""
if agent_name_usable "${agent}"; then
  if [ -n "${run_id}" ] && [ -f "${TMP_DIR}/expected-${agent}-${run_id}.txt" ]; then
    expected_file="${TMP_DIR}/expected-${agent}-${run_id}.txt"
  else
    prune_stale_markers
    candidate=$(ls -t "${TMP_DIR}"/expected-"${agent}"-*.txt 2>/dev/null | head -n 1 || true)
    [ -n "${candidate}" ] && expected_file="${candidate}"
  fi

  if [ -z "${expected_file}" ] || [ ! -f "${expected_file}" ]; then
    count_markers
    echo "check-file: агент «${agent}» известен, но его маркер (expected-${agent}-*.txt) не найден; маркеров в .claude/tmp/: ${markers_count} - пропускаю проверку (не проверяю файл чужого агента)." >&2
    exit 0
  fi
else
  # Имя агента непригодно (пусто или не-именной мусор вроде «*»). Узкий фолбэк:
  # берем маркер, только если он в папке РОВНО ОДИН - тогда параллельных агентов
  # нет и спутать не с чем.
  prune_stale_markers
  count_markers
  if [ "${markers_count}" -eq 1 ]; then
    expected_file="${markers_last}"
    echo "check-file: имя субагента в payload не опознано (значение «${agent}»; ключи payload: ${payload_keys}); маркер в .claude/tmp/ ровно один - проверяю по нему: $(basename "${expected_file}")." >&2
  else
    echo "check-file: имя субагента распарсить не удалось (значение «${agent}»; ключи payload: ${payload_keys}); маркеров в .claude/tmp/: ${markers_count} (узкий фолбэк работает только когда маркер ровно один) - проверка пропущена." >&2
    exit 0
  fi
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

# Цель - директория: валидируем «существует и непуста» (контракт для шагов с веером файлов).
if [ -d "${abs_target}" ]; then
  if [ -z "$(ls -A "${abs_target}" 2>/dev/null)" ]; then
    echo "check-file: ожидаемая папка пуста: ${abs_target}" >&2
    exit 2
  fi
  rm -f "${expected_file}" 2>/dev/null || true
  exit 0
fi

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

# Если JSON - должен парситься. Битый JSON (чаще всего прямая кавычка внутри
# строкового значения) роняет ВСЕ шаги ниже по конвейеру, поэтому ловим его здесь,
# а не через шесть ступеней работы.
JSON_LINT_JS='
const fs = require("fs");
const f = process.argv[process.argv.length - 1];
let raw = "";
try {
  raw = fs.readFileSync(f, "utf8");
} catch (e) {
  process.stderr.write("check-file: JSON-проверка пропущена, файл не читается: " + e.message + "\n");
  process.exit(1);
}
try {
  JSON.parse(raw);
} catch (e) {
  const esc = (s) => s.replace(/\r/g, "\\r").replace(/\n/g, "\\n").replace(/\t/g, "\\t");
  const out = [];
  out.push("check-file: JSON не парсится: " + f);
  out.push("check-file: " + e.message);
  if (raw.charCodeAt(0) === 65279) {
    out.push("check-file: в начале файла BOM (U+FEFF) - JSON.parse его не переваривает, сохрани файл без BOM.");
  }
  const m = String(e.message).match(/position (\d+)/);
  if (m) {
    const pos = Math.min(Number(m[1]), raw.length);
    const before = raw.slice(0, pos);
    const line = before.split("\n").length;
    const col = pos - before.lastIndexOf("\n");
    out.push("check-file: строка " + line + ", колонка " + col + ", смещение " + pos);
    const head = esc(raw.slice(Math.max(0, pos - 40), pos));
    const tail = esc(raw.slice(pos, Math.min(raw.length, pos + 40)));
    out.push("check-file:   | " + head + tail);
    out.push("check-file:   | " + " ".repeat(head.length) + "^");
  }
  out.push("check-file: чаще всего это прямая кавычка внутри строкового значения - экранируй ее (\\\") или замени на елочки («»).");
  process.stderr.write(out.join("\n") + "\n");
  process.exit(3);
}
process.exit(0);
'

# 0 - валидный JSON, 3 - битый, любой другой код - проверку выполнить не удалось.
run_json_lint() {
  run_node -e "${JSON_LINT_JS}" "$1"
  return $?
}

case "${abs_target}" in
  *.json|*.JSON)
    lint_out=$(run_json_lint "${abs_target}" 2>&1)
    lint_rc=$?
    if [ "${lint_rc}" -eq 3 ]; then
      printf '%s\n' "${lint_out}" >&2
      # Маркер НЕ удаляем: после починки файла проверка должна пройти заново.
      exit 2
    elif [ "${lint_rc}" -ne 0 ]; then
      echo "check-file: JSON-проверка пропущена (node недоступен или не отработал, код ${lint_rc}): ${abs_target}" >&2
    fi
    ;;
esac

# Удаляем маркер — задача проверена
rm -f "${expected_file}" 2>/dev/null || true

exit 0
