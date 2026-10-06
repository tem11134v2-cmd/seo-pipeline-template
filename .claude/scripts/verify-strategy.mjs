#!/usr/bin/env node
// verify-strategy.mjs
// Механическая финальная проверка контента SEO-стратегии (/seo-strategiya, шаг 6.5а)
// ПЕРЕД сборкой docx. Детерминированные вещи, которые не должен "на глаз" ловить
// opus-верификатор: цены в прозе тарифов, стоп-паттерны воды, тире/буква Е-с-точками,
// грубый перебор объема. Смысловую сверку цифр с JSON-источниками и согласованность
// тарифов делает отдельный агент strategy-verifier (Пакет B) - этот скрипт только
// механика.
//
// Использование:
//   node .claude/scripts/verify-strategy.mjs <strategy_dir>
//
// Вход:
//   <strategy_dir>/seo-strategiya_content.json - обязательный (проверяемый артефакт).
//   <strategy_dir>/seo-strategiya_data.json - опциональный, нефатальный (для блока
//     СЦЕНАРНАЯ СОГЛАСОВАННОСТЬ, этап 8: forecast_scenarios).
//   <strategy_dir>/tariffs.json - опциональный, нефатальный (нужен там же для
//     сверки cost_months/ROMI с ценами тарифов).
//
// Выход (stdout): построчный отчет по блокам:
//   ЦЕНЫ В ПРОЗЕ ТАРИФОВ, СТОП-ПАТТЕРНЫ ВОДЫ, ТИРЕ/Е-С-ТОЧКАМИ, ОБЪЕМ (warning), СТРУКТУРА,
//   СЦЕНАРНАЯ СОГЛАСОВАННОСТЬ (независимый пересчет ROMI/cost из forecast_scenarios;
//   legacy-файлы без forecast_scenarios не валятся - секция помечается как пропущенная).
//
// Exit:
//   0 - нет нарушений (предупреждения по объему допустимы, печатаются).
//   2 - есть нарушения (цены / стоп-паттерны / тире-е / нет раздела 4 / сценарная
//       рассинхронизация). Блок СЦЕНАРНАЯ СОГЛАСОВАННОСТЬ - дефект forecast_scenarios
//       (артефакт growth-strategist), а не прозы - скил пере-делегирует growth-strategist
//       для этого блока, а не strategy-writer (см. SKILL.md, шаг 6.5а).
//   1 - ошибка запуска (нет content.json, битый JSON, содержимое не объект).
//
// ── ФОРМАТ v2 (content.format === "v2", программа 06.10.2026, docs/upgrade-program-2026-10-06-strategy-v2.md §7) ──
// Стратегия без тарифов и без денег в прозе: 4 раздела по ключам, деньги рисует сборщик в маркерах из
// forecast.json. Блоки отчета (заголовки стабильные, на них опираются тесты и маршрутизация SKILL.md):
//   СТРУКТУРА        - title_page, summary.points 2-4, разделы situation/competitors/plan/forecast строго в этом
//                      порядке, маркеры money_lost (situation), plan_timeline + >= 2 plan_item (plan),
//                      forecast_chart + forecast_table (forecast), известные типы блоков, ID в plan_item.services
//                      есть в каталоге _services.mjs.                                        -> strategy-writer
//   ДЕНЬГИ В ПРОЗЕ   - любые суммы и валюта (₽, руб, рублей, тыс. руб, млн руб, $, суммы рядом со словами
//                      выручка/прибыль/чек/бюджет/стоимость...) в ЛЮБЫХ строках писателя.      -> strategy-writer
//   ТАРИФЫ В ПРОЗЕ   - слово «тариф» в любой форме, «Старт»/«Рост»/«Максимум» в кавычках, «вариант «...»»,
//                      «пакет Рост»; ID услуг (SY, KP, FQ, PF...) вне plan_item.services.       -> strategy-writer
//   СТОП-ПАТТЕРНЫ ВОДЫ, ТИРЕ/Е-С-ТОЧКАМИ - как в легаси.                                       -> strategy-writer
//   ОБЪЕМ (warning)  - проза < 2500 или > 14000 симв. (4-6 стр A4).
//   СОСТАВ ПЛАНА (warning) - ID из plan_item.services, которых нет в рекомендованном составе (growth).
//   ПРОГНОЗ          - forecast.json есть и сходится с независимым пересчетом модели (_forecast-model.mjs,
//                      computeAll по forecast_inputs + inputs.json + tariffs.json): year1.romi (допуск 1 п.п.)
//                      и year1.cost (допуск 1 руб) по каждому тарифу, состав, потери в месяц.
//                      -> ОРКЕСТРАТОР, не писатель: перезапустить build-forecast.mjs.
// Без format "v2" - легаси-путь ниже (раздел 4, СЦЕНАРНАЯ СОГЛАСОВАННОСТЬ) без изменений.

import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { computeScenarioTariff, resolveActiveMonths, TARIFF_KEYS } from "./_forecast-money.mjs";
import {
  computeAll,
  resolveEconomics,
  applyClientEconomics,
  tariffServiceIds,
  MODEL_VERSION as V2_MODEL_VERSION,
  TARIFF_KEYS as V2_TARIFF_KEYS,
  HORIZON as V2_HORIZON,
} from "./_forecast-model.mjs";
import { SERVICES, LEGACY_SERVICES, RETIRED_IDS, canonicalId } from "./_services.mjs";

const rawArgs = process.argv.slice(2);
const dirArg = rawArgs.find((a) => !a.startsWith("--"));
if (!dirArg) {
  console.error("[verify-strategy] usage: node verify-strategy.mjs <strategy_dir>");
  process.exit(1);
}
const strategyDir = resolve(dirArg);

function readJson(path, fatal = true) {
  if (!existsSync(path)) {
    if (fatal) {
      console.error(`[verify-strategy] не найден: ${path}`);
      process.exit(1);
    }
    return null;
  }
  try {
    return JSON.parse(readFileSync(path, "utf8").replace(/^﻿/, ""));
  } catch (err) {
    if (fatal) {
      console.error(`[verify-strategy] битый JSON ${path}: ${err.message}`);
      process.exit(1);
    }
    return null;
  }
}

const contentPath = join(strategyDir, "seo-strategiya_content.json");
const content = readJson(contentPath);

if (!content || typeof content !== "object" || Array.isArray(content)) {
  console.error(`[verify-strategy] содержимое не объект: ${contentPath}`);
  process.exit(1);
}

// ──────────────────────────────────────────────────────────────────────────
// Утилиты
// ──────────────────────────────────────────────────────────────────────────

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Нормализация для сравнения: lowercase, буква Е-с-точками -> е, схлопнуть пробелы.
function normalize(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ")
    .trim();
}

function shorten(str, max = 70) {
  const s = String(str || "").replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max)}...` : s;
}

function printCapped(header, items, cap = 10) {
  if (!items.length) return;
  console.log(`\n${header} (${items.length}):`);
  const shown = items.slice(0, cap);
  for (const it of shown) console.log(`  - ${it}`);
  if (items.length > shown.length) console.log(`  ...и еще ${items.length - shown.length}`);
}

// Слово без пробелов - границы через lookaround (JS \b не видит кириллицу как
// "словесный" символ, поэтому обычный \bслово\b для кириллицы бесполезен).
const WORD_CHAR_CLASS = "a-zа-я0-9";
function findMatches(normalizedText, pattern) {
  const isPhrase = pattern.includes(" ");
  const indices = [];
  if (isPhrase) {
    let from = 0;
    for (;;) {
      const idx = normalizedText.indexOf(pattern, from);
      if (idx === -1) break;
      indices.push(idx);
      from = idx + pattern.length;
    }
  } else {
    const re = new RegExp(`(?<![${WORD_CHAR_CLASS}])${escapeRegex(pattern)}(?![${WORD_CHAR_CLASS}])`, "g");
    let m;
    while ((m = re.exec(normalizedText))) {
      indices.push(m.index);
      if (re.lastIndex === m.index) re.lastIndex++;
    }
  }
  return indices;
}

// ──────────────────────────────────────────────────────────────────────────
// Стоп-лист воды - перенесен дословно из strategy-writer.md:51,53-64
// ──────────────────────────────────────────────────────────────────────────

const STOP_PATTERNS = [
  "является", "представляет собой",
  "в современном мире", "в современных реалиях", "на сегодняшний день",
  "крайне необходимо", "значительно улучшает", "значительный рост",
  "комплексный подход", "индивидуальный подход",
  "осуществлять", "проведение", "в рамках", "посредством",
  "важно отметить", "следует подчеркнуть", "давайте рассмотрим",
  "таким образом",
  "динамичный", "быстро развивающийся", "постоянно меняющийся",
  "важность seo в современном мире", "динамичный рынок",
];

// Длинное/среднее тире и буква Е-с-точками (как в verify-metatags.mjs:83-85)
const DASH_RE = /[—–]/;
const YO_RE = /[ёЁ]/;

// Цены в прозе тарифов (секция 4 - код-данные, регэкспы из спеки, не менять символику)
const HARD_PRICE_NUM_RE = /\d[\d\s ]*\s*(₽|руб\.?|р\.|тыс\.?\s*руб)/i;
const CURRENCY_TOKEN_RE = /₽|\bруб\b|\bрублей\b|\bрубля\b/i;
const ROUND_THOUSANDS_RE = /\b\d{1,3}[\s ]?000\b/;

// ══════════════════════════════════════════════════════════════════════════
// ФОРМАТ v2. Если content.format === "v2" - runV2() проверяет и завершает процесс
// (process.exit внутри); легаси-код ниже в этом случае не выполняется.
// ══════════════════════════════════════════════════════════════════════════

const IS_V2 = String(content.format ?? "").trim().toLowerCase() === "v2";

const V2_SECTION_KEYS = ["situation", "competitors", "plan", "forecast"];
const V2_MARKER_TYPES = ["money_lost", "plan_timeline", "forecast_chart", "forecast_table", "forecast_drivers"];
const V2_BLOCK_TYPES = new Set([
  "subheading", "paragraph", "kpi_row", "issues", "bullets", "callout", "table", "compare", "bars",
  "plan_item", "quick_wins", "conditions", ...V2_MARKER_TYPES,
]);
const V2_LEGACY_BLOCK_TYPES = new Set(["problem_block", "growth_point", "tariff", "special"]);
// Служебные ключи-перечисления (type, tone, severity...) - не проза, в скан денег/тарифов не идут.
const V2_ENUM_KEYS = new Set(["type", "key", "format", "tone", "severity", "style"]);
const V2_PROSE_MIN = 2500;
const V2_PROSE_MAX = 14000;

// ── Деньги. Скан идет по строке в нижнем регистре (ё -> е, неразрывные пробелы -> пробел; длина строки
// сохраняется, поэтому индексы совпадают с оригиналом для фрагмента).
const V2_MONEY_TOKEN_RES = [
  [/₽/g, "знак ₽"],
  [/(?<![а-я])руб(?:\.|(?![а-я]))/g, "«руб»"],
  [/(?<![а-я])рубл(?:ь|я|ей|ям|ями|ях|е|ю)(?![а-я])/g, "«рубли»"],
  [/\d\s*(?:тыс|т|млн|млрд)\.?\s*р(?:\.|(?![а-яa-z]))/g, "сумма «тыс./млн р.»"],
  [/\d\s?р(?:\.|(?=[\s,;:!?)»"]|$))/g, "сумма «р.»"],
  [/[$€£]|(?<![a-z0-9.-])(?:rub|rur|usd|eur)(?![a-z0-9.-])|(?<![а-я])доллар[а-я]*|\d\s*евро(?![а-я])/g, "валюта"],
];
// Сумма: 1 000 / 25 000 / 1 200 000 / 15000 / 1,2 млн / 300 тыс. / 50к.
const V2_SUM = "(?:\\d{1,3}(?: \\d{3})+(?:[.,]\\d+)?|\\d{4,}(?:[.,]\\d+)?|\\d+(?:[.,]\\d+)?\\s*(?:тыс\\.?|тысяч[а-я]*|млн\\.?|миллион[а-я]*|млрд\\.?|миллиард[а-я]*)(?![а-я])|\\d+(?:[.,]\\d+)?к(?![а-я]))";
// Денежные слова (с границей слева: «оценка» не «цена», «центр» не «цена», «чек-лист» не «чек»).
const V2_MONEY_WORD =
  "(?<![а-я])(?:выручк[а-я]*|прибыл[а-я]*|доход[а-я]*|оборот[а-я]*|бюджет[а-я]*|стоимост[а-я]*|" +
  "цен(?:а|ы|е|у|ой|ам|ами|ах)?|чек(?:а|е|у|ом|и|ов)?|оплат[а-я]*|платеж[а-я]*|затрат[а-я]*|вложени[а-я]*|" +
  "инвестиц[а-я]*|денег|деньг[а-я]*|денежн[а-я]*|заработ[а-я]*)(?![-а-я])";
// «выручка ... 150 000» (до 5 слов между, без конца предложения); число сразу перед единицей трафика
// («1 800 визитов», «2026 году») - не деньги.
const V2_MONEY_BACK_RE = new RegExp(`${V2_MONEY_WORD}((?:[\\s,]+[^\\s.;:!?]+){0,5}?)[\\s,]+(${V2_SUM})`, "g");
// «150 000 выручки», «1,2 млн в месяц прибыли».
const V2_MONEY_FWD_RE = new RegExp(
  `(?<![\\d,.])(${V2_SUM})(?:\\s+(?:в|за|на|около|месяц|мес\\.?|год)(?![а-я]))*\\s+${V2_MONEY_WORD}`,
  "g"
);
const V2_NON_MONEY_UNIT_RE =
  /^\s*(?:визит|переход|посетител|посещени|запрос|обращени|заяв|лид|страниц|позици|клиент|звон|показ|ключ|слов|символ|шт|человек|пользовател|сесси|раз|%|процент|месяц|мес|дн|недел|год|лет|компани|конкурент|сайт|отзыв|товар|карточ|стат|продаж|сделк|заказ|пункт|блок|ссыл)/;

// ── Тарифы и пакеты.
const V2_TARIFF_WORD_RE = /(?<![а-я])тариф[а-я]*/g; // по нижнему регистру
const V2_PACKAGE_QUOTED_RE = /[«"“„'‘‹]\s*(старт|рост|максимум)\s*[»"”“'’›]/g; // по нижнему регистру
const V2_VARIANT_QUOTED_RE = /(?<![а-я])вариант[а-я]*\s+[«"“„‹]/g; // по нижнему регистру
// по оригиналу: название пакета - с прописной, существительное - в любом регистре («Вариант Рост» в начале фразы)
const V2_PACKAGE_NAMED_RE = /(?<![А-Яа-яЁё])(?:[Пп]акет|[Вв]ариант|[Пп]лан)[а-яё]*\s+(?:Старт|Рост|Максимум)(?![А-Яа-яЁё])/g;

// ── ID услуг (регистр важен: только латиница в верхнем регистре). Неоднозначные (IT-компания, UX, ART-студия)
// считаются ID только рядом с однозначным ID в той же строке или в скобках «(IT)».
const V2_SERVICE_IDS = [
  ...new Set([...Object.keys(SERVICES), ...Object.keys(LEGACY_SERVICES), ...RETIRED_IDS, "DEV"]),
].sort((a, b) => b.length - a.length);
const V2_AMBIGUOUS_IDS = new Set(["IT", "UX", "AR", "ART", "ST", "LA", "SC", "PL", "MG", "SR", "BR"]);
const V2_ID_RE = new RegExp(
  `(?<![A-Za-zА-Яа-яЁё0-9_-])(${V2_SERVICE_IDS.join("|")})(?![A-Za-zА-Яа-яЁё0-9_-])`,
  "g"
);

function isObj(v) {
  return v != null && typeof v === "object" && !Array.isArray(v);
}
function nonEmptyStr(v) {
  return typeof v === "string" && v.trim().length > 0;
}
function lowerKeep(s) {
  return String(s).toLowerCase().replace(/ё/g, "е").replace(/[   ]/g, " ");
}
function fragmentAt(s, idx, len) {
  const from = Math.max(0, idx - 25);
  const to = Math.min(s.length, idx + len + 25);
  return `${from > 0 ? "..." : ""}${s.slice(from, to).replace(/\s+/g, " ").trim()}${to < s.length ? "..." : ""}`;
}
function allMatches(re, s) {
  re.lastIndex = 0;
  const out = [];
  let m;
  while ((m = re.exec(s))) {
    out.push(m);
    if (re.lastIndex === m.index) re.lastIndex++;
  }
  return out;
}

// Деньги в строке: [{kind, index, length}].
function v2MoneyHits(str) {
  const s = lowerKeep(str);
  const hits = [];
  for (const [re, kind] of V2_MONEY_TOKEN_RES) {
    for (const m of allMatches(re, s)) hits.push({ kind, index: m.index, length: m[0].length });
  }
  for (const m of allMatches(V2_MONEY_BACK_RE, s)) {
    const after = s.slice(m.index + m[0].length);
    if (V2_NON_MONEY_UNIT_RE.test(after)) continue;
    hits.push({ kind: "сумма рядом с денежным словом", index: m.index, length: m[0].length });
  }
  for (const m of allMatches(V2_MONEY_FWD_RE, s)) {
    hits.push({ kind: "сумма рядом с денежным словом", index: m.index, length: m[0].length });
  }
  return hits.sort((a, b) => a.index - b.index);
}

// Тарифы/пакеты/ID в строке: [{kind, index, length}]. skipIds - поле plan_item.services.
function v2TariffHits(str, skipIds) {
  const s = lowerKeep(str);
  const hits = [];
  for (const m of allMatches(V2_TARIFF_WORD_RE, s)) hits.push({ kind: `слово «${m[0]}»`, index: m.index, length: m[0].length });
  for (const m of allMatches(V2_PACKAGE_QUOTED_RE, s)) {
    hits.push({ kind: `название пакета в кавычках ${str.slice(m.index, m.index + m[0].length)}`, index: m.index, length: m[0].length });
  }
  for (const m of allMatches(V2_VARIANT_QUOTED_RE, s)) hits.push({ kind: "«вариант «...»» как название пакета", index: m.index, length: m[0].length });
  for (const m of allMatches(V2_PACKAGE_NAMED_RE, str)) hits.push({ kind: `название пакета «${m[0]}»`, index: m.index, length: m[0].length });
  if (!skipIds) {
    const ids = allMatches(V2_ID_RE, str);
    const hasStrong = ids.some((m) => !V2_AMBIGUOUS_IDS.has(m[1]));
    for (const m of ids) {
      const inBrackets = str[m.index - 1] === "(" && str[m.index + m[0].length] === ")";
      if (V2_AMBIGUOUS_IDS.has(m[1]) && !hasStrong && !inBrackets) continue;
      hits.push({ kind: `ID услуги «${m[1]}» (внутренний код сметы - писать человеческими словами)`, index: m.index, length: m[0].length });
    }
  }
  return hits.sort((a, b) => a.index - b.index);
}

// Обход строк писателя с ключом поля (массивы наследуют ключ родителя: services[0] -> "services").
function walkWriterStrings(value, path, cb, key = "") {
  if (value == null) return;
  if (typeof value === "string") {
    if (!V2_ENUM_KEYS.has(key)) cb(value, path, key);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => walkWriterStrings(v, `${path}[${i}]`, cb, key));
    return;
  }
  if (typeof value === "object") {
    for (const k of Object.keys(value)) walkWriterStrings(value[k], path ? `${path}.${k}` : k, cb, k);
  }
}

// sections[1].blocks[3].items[0].text -> "[competitors] issues #4 / items[0].text"
function v2PrettyPath(path) {
  const m = /^sections\[(\d+)\](?:\.blocks\[(\d+)\])?(.*)$/.exec(path);
  if (!m) return path;
  const sec = Array.isArray(content.sections) ? content.sections[Number(m[1])] : null;
  const skey = isObj(sec) && sec.key ? sec.key : `sections[${m[1]}]`;
  const rest = m[3] ? m[3].replace(/^\./, "") : "";
  if (m[2] == null) return `[${skey}]${rest ? ` ${rest}` : ""}`;
  const blk = isObj(sec) && Array.isArray(sec.blocks) ? sec.blocks[Number(m[2])] : null;
  const btype = isObj(blk) && blk.type ? blk.type : "?";
  return `[${skey}] ${btype} #${Number(m[2]) + 1}${rest ? ` / ${rest}` : ""}`;
}

// Экономика ровно как в build-forecast.mjs (общая функция модели applyClientEconomics): inputs.json клиента
// перекрывает оценку агента, проценты -> доли. Пересчет ловит и смену входов после build-forecast.
function v2ResolveForecastInputs(fiRaw, clientInputs) {
  return applyClientEconomics(fiRaw, clientInputs).fi;
}

// ПРОГНОЗ: forecast.json <-> независимый пересчет модели по текущим входам и tariffs.json.
function v2CheckForecast(tariffsRaw, tariffsBroken) {
  const violations = [];
  const notes = [];
  const fpath = join(strategyDir, "forecast.json");
  if (!existsSync(fpath)) {
    violations.push("нет forecast.json (шаг 5.5 не выполнен) - запусти build-forecast.mjs");
    return { violations, notes };
  }
  let forecast;
  try {
    forecast = JSON.parse(readFileSync(fpath, "utf8").replace(/^﻿/, ""));
  } catch (err) {
    violations.push(`битый forecast.json (${err.message}) - перезапусти build-forecast.mjs`);
    return { violations, notes };
  }
  if (!isObj(forecast) || !isObj(forecast.tariffs)) {
    violations.push("forecast.json без блока tariffs - перезапусти build-forecast.mjs");
    return { violations, notes };
  }
  if (!tariffsRaw) {
    violations.push(
      tariffsBroken
        ? "tariffs.json битый - прогноз не с чем сверить"
        : "нет tariffs.json - прогноз не с чем сверить (шаг тарифов не выполнен?)"
    );
    return { violations, notes };
  }
  if (forecast.model_version !== V2_MODEL_VERSION) {
    violations.push(
      `forecast.json построен моделью «${forecast.model_version}», текущая «${V2_MODEL_VERSION}» - прогноз устарел, перезапусти build-forecast.mjs`
    );
  }

  // Тарифы: канонические ключи (rost -> growth), как в build-forecast.
  const tariffs = {};
  for (const k of Object.keys(tariffsRaw)) {
    const ck = k === "rost" ? "growth" : k;
    if (V2_TARIFF_KEYS.includes(ck) && isObj(tariffsRaw[k])) tariffs[ck] = tariffsRaw[k];
  }

  // Входы: forecast_inputs из data (полные: tech_critical, implementation_lag_shift) + inputs.json клиента.
  // Нет forecast_inputs - запасной путь по forecast.json.inputs (экономика там уже разрешена).
  const data = readJson(join(strategyDir, "seo-strategiya_data.json"), false);
  const clientInputs = readJson(join(strategyDir, "inputs.json"), false);
  let fi;
  let source;
  let exact = true; // false - запасной путь: нет tech_critical/implementation_lag_shift, ROMI сверяется как подсказка
  if (data && isObj(data.forecast_inputs)) {
    fi = v2ResolveForecastInputs(data.forecast_inputs, clientInputs);
    source = "forecast_inputs + inputs.json";
  } else if (isObj(forecast.inputs)) {
    fi = JSON.parse(JSON.stringify(forecast.inputs));
    source = "forecast.json.inputs (в seo-strategiya_data.json нет forecast_inputs)";
    exact = false;
    notes.push(
      "в seo-strategiya_data.json нет forecast_inputs: build-forecast.mjs не пересоберет прогноз, смета уйдет в старый формат - " +
        "пересчет по forecast.json.inputs (затраты и состав строго; ROMI и потери - подсказкой, без tech_critical/implementation_lag_shift)"
    );
  } else {
    violations.push("нет входов прогноза: ни forecast_inputs в seo-strategiya_data.json, ни inputs в forecast.json");
    return { violations, notes };
  }

  // Сдвиг входов после build-forecast (диагностика: какие именно поля разъехались).
  if (source.startsWith("forecast_inputs") && isObj(forecast.inputs)) {
    const fin = forecast.inputs;
    const econNow = resolveEconomics(fi);
    const econWas = isObj(fin.economics) ? fin.economics : {};
    const n0 = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
    const pairs = [
      ["t0", n0(fin.t0), n0(fi.t0)],
      ["pages.existing_commercial", n0(fin.pages?.existing_commercial), n0(fi.pages?.existing_commercial)],
      ["pages.planned_new", n0(fin.pages?.planned_new), n0(fi.pages?.planned_new)],
      ["pages.catalog_cards", n0(fin.pages?.catalog_cards), n0(fi.pages?.catalog_cards)],
      ["demand.commercial_month", n0(fin.demand?.commercial_month), n0(fi.demand?.commercial_month)],
      ["demand.info_month", n0(fin.demand?.info_month), n0(fi.demand?.info_month)],
      ["business_type", econWas.business_type ?? fin.business_type, econNow.business_type],
      ["competition", fin.competition || "medium", fi.competition || "medium"],
      ["local", !!fin.local, !!fi.local],
      ["maps_card", fin.maps_card || "unknown", fi.maps_card || "unknown"],
      ["avg_check", n0(econWas.avg_check), n0(econNow.avg_check)],
      ["conversion_rate", n0(econWas.conversion_rate), n0(econNow.conversion_rate)],
      ["close_rate", n0(econWas.close_rate), n0(econNow.close_rate)],
      ["margin", n0(econWas.margin), n0(econNow.margin)],
    ];
    const drift = pairs
      .filter(([, was, now]) => (typeof was === "number" ? Math.abs(was - now) > 1e-9 : was !== now))
      .map(([k, was, now]) => `${k} ${was} -> ${now}`);
    if (drift.length) {
      violations.push(`входы изменились после build-forecast (${drift.join("; ")}) - прогноз устарел, перезапусти build-forecast.mjs`);
    }
  }

  let res;
  try {
    res = computeAll(fi, tariffs, V2_HORIZON);
  } catch (err) {
    violations.push(`пересчет модели упал: ${err.message}`);
    return { violations, notes };
  }

  const fKeys = Object.keys(forecast.tariffs).filter((k) => V2_TARIFF_KEYS.includes(k));
  const keys = V2_TARIFF_KEYS.filter((k) => tariffs[k] || forecast.tariffs[k]);
  let compared = 0;
  for (const k of keys) {
    const ft = forecast.tariffs[k];
    const rt = res[k];
    if (rt && !ft) {
      violations.push(`[${k}] тариф есть в tariffs.json, но нет в forecast.json - прогноз устарел, перезапусти build-forecast.mjs`);
      continue;
    }
    if (ft && !rt) {
      violations.push(`[${k}] тариф есть в forecast.json, но нет в tariffs.json - прогноз устарел, перезапусти build-forecast.mjs`);
      continue;
    }
    compared++;
    const idsWas = [...(Array.isArray(ft.ids) ? ft.ids : [])].sort().join(",");
    const idsNow = [...rt.ids].sort().join(",");
    if (idsWas !== idsNow) {
      violations.push(`[${k}] состав в forecast.json (${idsWas || "-"}) != tariffs.json (${idsNow || "-"}) - прогноз устарел, перезапусти build-forecast.mjs`);
    }
    const romiWas = Number(ft.year1?.romi);
    const costWas = Number(ft.year1?.cost);
    if (!Number.isFinite(costWas) || Math.abs(costWas - rt.year1.cost) > 1) {
      violations.push(`[${k}] затраты 12 мес в forecast.json ${ft.year1?.cost} != пересчет ${rt.year1.cost} - прогноз устарел, перезапусти build-forecast.mjs`);
    }
    if (!Number.isFinite(romiWas) || Math.abs(romiWas - rt.year1.romi) > 1) {
      (exact ? violations : notes).push(`[${k}] ROMI 12 мес в forecast.json ${ft.year1?.romi}% != пересчет ${rt.year1.romi}% - прогноз устарел, перезапусти build-forecast.mjs`);
    }
  }
  if (!fKeys.includes("growth") && !tariffs.growth) {
    violations.push("нет рекомендованного тарифа growth ни в tariffs.json, ни в forecast.json");
  }

  // «Деньги, которые вы теряете» (маркер money_lost) берутся из lost_now - сверить с пересчетом Роста.
  if (res.growth && isObj(forecast.lost_now)) {
    const lostWas = Number(forecast.lost_now.revenue_month);
    const lostNow = Math.round(res.growth.m12.revenue);
    if (!Number.isFinite(lostWas) || Math.abs(lostWas - lostNow) > 1) {
      (exact ? violations : notes).push(`lost_now.revenue_month в forecast.json ${forecast.lost_now.revenue_month} != пересчет ${lostNow} - прогноз устарел, перезапусти build-forecast.mjs`);
    }
  } else if (res.growth) {
    violations.push("в forecast.json нет lost_now - маркеру money_lost нечего показать, перезапусти build-forecast.mjs");
  }

  const hard = isObj(forecast.checks) && Array.isArray(forecast.checks.hard) ? forecast.checks.hard : [];
  if (hard.length) {
    notes.push(`в forecast.json ${hard.length} жестк. замечаний экономического гейта (build-forecast exit 3) - решение по тарифам за оркестратором: ${shorten(hard[0], 90)}`);
  }
  return { violations, notes, compared, source };
}

function runV2() {
  const structure = [];
  const money = [];
  const tariffsProse = [];
  const stops = [];
  const dashYo = [];
  const planWarnings = [];

  // ── 1. СТРУКТУРА ──
  const tp = content.title_page;
  if (!isObj(tp)) structure.push("нет title_page (или он не объект)");
  else if (!nonEmptyStr(tp.domain)) structure.push("title_page.domain пуст - обложке нечего показать");

  const summary = content.summary;
  if (!isObj(summary)) {
    structure.push("нет summary {headline, points[]} - сборщику нечего ставить в «Коротко»");
  } else if (!Array.isArray(summary.points)) {
    structure.push("summary.points не массив (нужно 2-4 тезиса)");
  } else {
    const empty = summary.points.filter((p) => !nonEmptyStr(p)).length;
    if (summary.points.length < 2 || summary.points.length > 4) {
      structure.push(`summary.points: ${summary.points.length} тезисов (нужно 2-4)`);
    }
    if (empty) structure.push(`summary.points: ${empty} пустых тезисов`);
  }

  const sectionsV2 = Array.isArray(content.sections) ? content.sections : null;
  if (!sectionsV2) structure.push("sections[] отсутствует или не массив");
  const secs = sectionsV2 || [];
  const keys = secs.map((s) => (isObj(s) && s.key != null ? String(s.key) : ""));
  const inOrder = keys.length === V2_SECTION_KEYS.length && V2_SECTION_KEYS.every((k, i) => keys[i] === k);
  if (sectionsV2 && !inOrder) {
    const missing = V2_SECTION_KEYS.filter((k) => !keys.includes(k));
    const extra = keys.filter((k) => !V2_SECTION_KEYS.includes(k));
    const dup = V2_SECTION_KEYS.filter((k) => keys.filter((x) => x === k).length > 1);
    if (missing.length) structure.push(`нет разделов: ${missing.join(", ")}`);
    if (extra.length) {
      structure.push(`лишние разделы: ${extra.map((k) => k || "(без key)").join(", ")} (нужны ровно situation, competitors, plan, forecast)`);
    }
    if (dup.length) structure.push(`раздел повторяется: ${dup.join(", ")}`);
    if (!missing.length && !extra.length && !dup.length) {
      structure.push(`порядок разделов ${keys.join(" -> ")} (нужно situation -> competitors -> plan -> forecast)`);
    }
  }

  const byKey = {};
  const planItems = []; // {title, ids[]}
  secs.forEach((sec, i) => {
    if (!isObj(sec)) {
      structure.push(`sections[${i}] не объект`);
      return;
    }
    const sk = sec.key || `sections[${i}]`;
    if (sec.key && !byKey[sec.key]) byKey[sec.key] = sec;
    if (!Array.isArray(sec.blocks) || sec.blocks.length === 0) {
      structure.push(`[${sk}] blocks[] пуст или отсутствует`);
      return;
    }
    sec.blocks.forEach((b, j) => {
      if (!isObj(b)) {
        structure.push(`[${sk}] blocks[${j}] не объект`);
        return;
      }
      if (!V2_BLOCK_TYPES.has(b.type)) {
        structure.push(
          `[${sk}] блок #${j + 1}: неизвестный тип «${b.type}» - сборщик v2 его не отрисует` +
            (V2_LEGACY_BLOCK_TYPES.has(b.type) ? " (тип старого формата)" : "")
        );
        return;
      }
      if (b.type === "table") {
        // Сборщик рисует ячейки строками: объект в строке/ячейке даст в docx «[object Object]».
        const cellOk = (v) => v == null || typeof v === "string" || typeof v === "number";
        if (!Array.isArray(b.columns) || !b.columns.length || !b.columns.every(cellOk)) {
          structure.push(`[${sk}] table #${j + 1}: columns - нужен непустой массив строк`);
        }
        if (!Array.isArray(b.rows)) {
          structure.push(`[${sk}] table #${j + 1}: rows - нужен массив строк таблицы [[...], [...]]`);
        } else {
          b.rows.forEach((r, ri) => {
            if (!Array.isArray(r)) structure.push(`[${sk}] table #${j + 1}: rows[${ri}] не массив (нужно [ячейка, ячейка, ...], не объект)`);
            else if (!r.every(cellOk)) structure.push(`[${sk}] table #${j + 1}: rows[${ri}] - ячейки только строки или числа`);
          });
        }
      }
      if (b.type === "plan_item") {
        const title = nonEmptyStr(b.title) ? b.title : `#${j + 1}`;
        for (const f of ["title", "problem", "solution", "effect"]) {
          if (!nonEmptyStr(b[f])) structure.push(`[${sk}] plan_item «${shorten(title, 40)}»: пустое поле ${f}`);
        }
        if (!Array.isArray(b.services) || b.services.length === 0) {
          structure.push(`[${sk}] plan_item «${shorten(title, 40)}»: нет services[] (ID услуг рекомендованного состава)`);
        } else {
          const ids = [];
          for (const raw of b.services) {
            const cid = canonicalId(String(raw ?? "").trim().toUpperCase());
            if (SERVICES[cid] || cid === "DEV") ids.push(cid);
            else {
              structure.push(
                `[${sk}] plan_item «${shorten(title, 40)}»: ID «${raw}» ${LEGACY_SERVICES[cid] || RETIRED_IDS.includes(cid) ? "выведен из линейки" : "нет в каталоге _services.mjs"}`
              );
            }
          }
          planItems.push({ title, ids });
        }
      }
    });
  });
  const countType = (key, type) =>
    ((byKey[key] && Array.isArray(byKey[key].blocks) && byKey[key].blocks) || []).filter((b) => isObj(b) && b.type === type).length;
  if (byKey.situation && !countType("situation", "money_lost")) {
    structure.push('[situation] нет маркера {"type": "money_lost"} (деньги, которые клиент теряет, рисует сборщик)');
  }
  if (byKey.plan) {
    const n = countType("plan", "plan_item");
    if (n < 2) structure.push(`[plan] plan_item: ${n} (нужно минимум 2)`);
    if (!countType("plan", "plan_timeline")) structure.push('[plan] нет маркера {"type": "plan_timeline"}');
  }
  if (byKey.forecast) {
    if (!countType("forecast", "forecast_chart")) structure.push('[forecast] нет маркера {"type": "forecast_chart"}');
    if (!countType("forecast", "forecast_table")) structure.push('[forecast] нет маркера {"type": "forecast_table"}');
  }

  // ── 2. Корпус прозы писателя (стоп-паттерны и объем) ──
  const prose = []; // {text, where}
  const add = (text, where) => {
    if (typeof text === "number") text = String(text);
    if (typeof text !== "string" || !text.trim()) return;
    prose.push({ text, where });
  };
  const addList = (list, where) => {
    if (!Array.isArray(list)) return;
    list.forEach((it, i) => add(isObj(it) ? it.text : it, `${where}[${i}]`));
  };
  if (isObj(summary)) {
    add(summary.headline, "summary / headline");
    addList(summary.points, "summary / points");
  }
  add(content.next_step, "next_step");
  secs.forEach((sec) => {
    if (!isObj(sec) || !Array.isArray(sec.blocks)) return;
    const sk = sec.key || "?";
    sec.blocks.forEach((b, j) => {
      if (!isObj(b)) return;
      const w = `[${sk}] ${b.type} #${j + 1}`;
      switch (b.type) {
        case "subheading":
        case "paragraph":
          add(b.text, `${w} / text`);
          break;
        case "kpi_row":
          (Array.isArray(b.items) ? b.items : []).forEach((it, i) => {
            if (!isObj(it)) return;
            add(it.value, `${w} / items[${i}].value`);
            add(it.label, `${w} / items[${i}].label`);
          });
          break;
        case "issues":
          add(b.title, `${w} / title`);
          (Array.isArray(b.items) ? b.items : []).forEach((it, i) => {
            if (!isObj(it)) return;
            add(it.title, `${w} / items[${i}].title`);
            add(it.text, `${w} / items[${i}].text`);
          });
          break;
        case "bullets":
          add(b.title, `${w} / title`);
          addList(b.items, `${w} / items`);
          break;
        case "callout":
          add(b.title, `${w} / title`);
          add(b.text, `${w} / text`);
          break;
        case "table":
          addList(b.columns, `${w} / columns`);
          (Array.isArray(b.rows) ? b.rows : []).forEach((row, r) => addList(row, `${w} / rows[${r}]`));
          break;
        case "compare":
          (Array.isArray(b.rows) ? b.rows : []).forEach((row, r) => {
            if (isObj(row)) add(row.label, `${w} / rows[${r}].label`);
          });
          break;
        case "bars":
          add(b.title, `${w} / title`);
          (Array.isArray(b.items) ? b.items : []).forEach((it, i) => {
            if (isObj(it)) add(it.label, `${w} / items[${i}].label`);
          });
          break;
        case "plan_item":
          for (const f of ["title", "problem", "solution", "effect"]) add(b[f], `${w} / ${f}`);
          break;
        case "quick_wins":
        case "conditions":
          addList(b.items, `${w} / items`);
          break;
        default:
          break; // маркеры сборщика и неизвестные типы - не проза писателя
      }
    });
  });

  // ── 3. ДЕНЬГИ В ПРОЗЕ и ТАРИФЫ В ПРОЗЕ - все строки писателя (кроме служебных перечислений) ──
  walkWriterStrings(content, "", (str, path, key) => {
    const where = v2PrettyPath(path);
    const mh = v2MoneyHits(str);
    if (mh.length) {
      const kinds = [...new Set(mh.map((h) => h.kind))].join(", ");
      money.push(`${where}: ${kinds} - "${fragmentAt(str, mh[0].index, mh[0].length)}"`);
    }
    const th = v2TariffHits(str, key === "services");
    if (th.length) {
      const kinds = [...new Set(th.map((h) => h.kind))].join(", ");
      tariffsProse.push(`${where}: ${kinds} - "${fragmentAt(str, th[0].index, th[0].length)}"`);
    }
  });

  // ── 3а. ДЕНЬГИ, разнесенные по полям: kpi {value: "~1,3 млн", label: "выручки в месяц"} и table (заголовок
  // «Средний чек» + ячейка «45 000») - каждое поле по отдельности чистое, вместе - сумма. Склейки:
  // value + label, label + value (если label не начинается с единицы трафика/штук: «визитов в месяц ... бюджета»
  // - не деньги) и заголовок колонки + ячейка. Поля, пойманные по отдельности, не дублируются.
  const asText = (v) => (typeof v === "number" ? String(v) : typeof v === "string" ? v : "");
  // reverse: еще и «second first» (kpi: «средний чек 45 000»), кроме second с единицы трафика/штук.
  const splitMoney = (first, second, where, reverse) => {
    const a = asText(first), b = asText(second);
    if (!a.trim() || !b.trim() || v2MoneyHits(a).length || v2MoneyHits(b).length) return;
    const variants = [`${a} ${b}`];
    if (reverse && !V2_NON_MONEY_UNIT_RE.test(lowerKeep(b))) variants.push(`${b} ${a}`);
    for (const s of variants) {
      const mh = v2MoneyHits(s);
      if (mh.length) {
        money.push(`${where}: сумма разнесена по полям (${[...new Set(mh.map((h) => h.kind))].join(", ")}) - "${fragmentAt(s, mh[0].index, mh[0].length)}"`);
        return;
      }
    }
  };
  secs.forEach((sec, si) => {
    if (!isObj(sec) || !Array.isArray(sec.blocks)) return;
    sec.blocks.forEach((b, j) => {
      if (!isObj(b)) return;
      const base = `sections[${si}].blocks[${j}]`;
      if (b.type === "kpi_row" && Array.isArray(b.items)) {
        b.items.forEach((it, i) => {
          if (isObj(it)) splitMoney(it.value, it.label, v2PrettyPath(`${base}.items[${i}]`), true);
        });
      }
      if (b.type === "table" && Array.isArray(b.columns) && Array.isArray(b.rows)) {
        b.columns.forEach((col, ci) => {
          if (V2_NON_MONEY_UNIT_RE.test(lowerKeep(asText(col)))) return; // «Визитов в месяц» + «1 800» - не деньги
          b.rows.forEach((r, ri) => {
            if (Array.isArray(r)) splitMoney(col, r[ci], v2PrettyPath(`${base}.rows[${ri}][${ci}]`), false);
          });
        });
      }
    });
  });

  // ── 4. СТОП-ПАТТЕРНЫ ВОДЫ (тот же список, что в легаси) ──
  for (const entry of prose) {
    const normalized = normalize(entry.text);
    for (const pattern of STOP_PATTERNS) {
      for (const idx of findMatches(normalized, pattern)) {
        const fragment = normalized.slice(Math.max(0, idx - 20), idx + pattern.length + 20).trim();
        stops.push(`${entry.where}: стоп-паттерн "${pattern}" - "...${fragment}..."`);
      }
    }
  }

  // ── 5. ТИРЕ/Е-С-ТОЧКАМИ - рекурсивно все строки content.json ──
  walkStrings(content, "", (str, path) => {
    if (DASH_RE.test(str)) dashYo.push(`${v2PrettyPath(path)}: длинное/среднее тире - "${shorten(str)}"`);
    if (YO_RE.test(str)) dashYo.push(`${v2PrettyPath(path)}: буква Е-с-точками - "${shorten(str)}"`);
  });

  // ── 6. ОБЪЕМ (warning) ──
  const chars = prose.reduce((a, e) => a + e.text.length, 0);
  let volumeWarn = null;
  if (chars < V2_PROSE_MIN) {
    volumeWarn = `проза подозрительно тонкая: ${chars} симв. (< ${V2_PROSE_MIN}) - меньше 4 стр, вероятно урезан контент`;
  } else if (chars > V2_PROSE_MAX) {
    volumeWarn = `проза раздута: ${chars} симв. (> ${V2_PROSE_MAX}), вероятно больше 6 стр - сжать тезисы`;
  }

  // ── 7. СОСТАВ ПЛАНА (warning) + ПРОГНОЗ ──
  const tariffsPath = join(strategyDir, "tariffs.json");
  const tariffsRaw = readJson(tariffsPath, false);
  const tariffsBroken = !tariffsRaw && existsSync(tariffsPath);
  if (tariffsRaw && planItems.length) {
    const growth = isObj(tariffsRaw.growth) ? tariffsRaw.growth : isObj(tariffsRaw.rost) ? tariffsRaw.rost : null;
    if (growth) {
      const growthIds = new Set([...tariffServiceIds(growth)].map((id) => canonicalId(id)));
      for (const it of planItems) {
        for (const id of it.ids) {
          if (id === "DEV") {
            // site_dev tariff-architect пишет всегда (вкладка сметы справочная) - в план разработка идет только
            // при recommended: true.
            if (!isObj(tariffsRaw.site_dev)) {
              planWarnings.push(`plan_item «${shorten(it.title, 40)}»: DEV (разработка), но в tariffs.json нет site_dev`);
            } else if (tariffsRaw.site_dev.recommended !== true) {
              planWarnings.push(`plan_item «${shorten(it.title, 40)}»: DEV (разработка), но site_dev.recommended не true - разработку не рекомендуем, в план она не идет`);
            }
          } else if (!growthIds.has(id)) {
            planWarnings.push(`plan_item «${shorten(it.title, 40)}»: ${id} нет в рекомендованном составе (growth: ${[...growthIds].join(", ")})`);
          }
        }
      }
    }
  }
  const fc = v2CheckForecast(tariffsRaw, tariffsBroken);

  // ── Отчет ──
  console.log(`[verify-strategy] формат v2, разделов: ${secs.length}, прозы: ${chars} симв.`);
  printCapped("СТРУКТУРА", structure);
  printCapped("ДЕНЬГИ В ПРОЗЕ", money);
  printCapped("ТАРИФЫ В ПРОЗЕ", tariffsProse);
  printCapped("СТОП-ПАТТЕРНЫ ВОДЫ", stops);
  printCapped("ТИРЕ/Е-С-ТОЧКАМИ", dashYo);

  console.log(`\nОБЪЕМ (warning):`);
  console.log(
    volumeWarn
      ? `  - ${volumeWarn}`
      : `  - в норме: ${chars} симв. (ориентир ${V2_PROSE_MIN}-${V2_PROSE_MAX}, 4-6 стр; точную оценку дает strategy-verifier)`
  );
  printCapped("СОСТАВ ПЛАНА (warning)", planWarnings);

  if (fc.violations.length) {
    printCapped("ПРОГНОЗ", fc.violations);
    console.log("  -> чинит ОРКЕСТРАТОР, не strategy-writer: перезапусти build-forecast.mjs <strategy_dir> (exit 3 - круг tariff-architect), затем verify-strategy.mjs заново.");
  } else {
    console.log(
      `\nПРОГНОЗ: OK (forecast.json сходится с пересчетом модели ${V2_MODEL_VERSION}: ROMI и затраты 12 мес по ${fc.compared} тарифам, потери в месяц; входы - ${fc.source}).`
    );
  }
  for (const n of fc.notes) console.log(`  (i) ${n}`);

  const writerBlocks = [
    ["СТРУКТУРА", structure],
    ["ДЕНЬГИ В ПРОЗЕ", money],
    ["ТАРИФЫ В ПРОЗЕ", tariffsProse],
    ["СТОП-ПАТТЕРНЫ ВОДЫ", stops],
    ["ТИРЕ/Е-С-ТОЧКАМИ", dashYo],
  ].filter(([, list]) => list.length);
  const total = writerBlocks.reduce((a, [, list]) => a + list.length, 0) + fc.violations.length;

  if (total > 0) {
    console.log("\nКОМУ ЧИНИТЬ:");
    if (writerBlocks.length) console.log(`  - strategy-writer: ${writerBlocks.map(([h]) => h).join(", ")}`);
    if (fc.violations.length) console.log("  - оркестратор: ПРОГНОЗ - перезапусти build-forecast.mjs (не писатель)");
    console.log(
      `\n[verify-strategy] НЕ ПРОЙДЕНО (структура ${structure.length}, деньги ${money.length}, тарифы ${tariffsProse.length}, стоп-паттерны ${stops.length}, тире/Е-с-точками ${dashYo.length}, прогноз ${fc.violations.length}).`
    );
    process.exit(2);
  }
  const warns = [volumeWarn ? "объем" : null, planWarnings.length ? "состав плана" : null].filter(Boolean);
  console.log(`\n[verify-strategy] OK: нарушений нет${warns.length ? ` (см. предупреждения: ${warns.join(", ")})` : ""}.`);
  process.exit(0);
}

if (IS_V2) runV2();

// ──────────────────────────────────────────────────────────────────────────
// 1. Санити-структура
// ──────────────────────────────────────────────────────────────────────────

const structureViolations = [];
const titlePage = content.title_page;
if (!titlePage || typeof titlePage !== "object" || Array.isArray(titlePage)) {
  structureViolations.push("нет title_page (или он не объект)");
}
const sections = Array.isArray(content.sections) ? content.sections : [];
if (sections.length === 0) {
  structureViolations.push("sections[] пуст или отсутствует");
}
const section4 = sections.find((s) => s && String(s.id) === "4");
if (!section4) {
  // Подсказка: разделы с ключами v2 без format "v2" - писатель забыл пометить формат.
  const looksV2 = sections.some((s) => s && ["situation", "competitors", "plan", "forecast"].includes(s.key));
  structureViolations.push(
    "нет раздела с id=4 (варианты работы) - без него docx бессмысленен" +
      (looksV2 ? ' (разделы с ключами situation/plan/... - похоже на v2 без поля format: "v2")' : "")
  );
}

// ──────────────────────────────────────────────────────────────────────────
// 2. Сбор прозы для стоп-паттернов + объема, и цен для секции 4
// ──────────────────────────────────────────────────────────────────────────

const proseEntries = []; // { text, sectionId, blockLabel, field }
const priceEntries = []; // { text, blockLabel, field } - только секция 4

function pushProse(text, section, blockLabel, field) {
  if (text == null) return;
  const s = String(text);
  if (!s.trim()) return;
  proseEntries.push({ text: s, sectionId: section.id, blockLabel, field });
}

function pushPrice(text, blockLabel, field) {
  if (text == null) return;
  const s = String(text);
  if (!s.trim()) return;
  priceEntries.push({ text: s, blockLabel, field });
}

for (const section of sections) {
  if (!section || typeof section !== "object") continue;
  const isSection4 = String(section.id) === "4";
  const blocks = Array.isArray(section.blocks) ? section.blocks : [];
  for (const block of blocks) {
    if (!block || typeof block !== "object") continue;
    const type = block.type;
    if (type === "paragraph") {
      pushProse(block.text, section, "paragraph", "text");
    } else if (type === "problem_block") {
      const label = `problem_block "${block.title || ""}"`;
      pushProse(block.why, section, label, "why");
      pushProse(block.impact, section, label, "impact");
    } else if (type === "growth_point") {
      const label = `growth_point "${block.name || ""}"`;
      pushProse(block.problem, section, label, "problem");
      pushProse(block.consequences, section, label, "consequences");
      pushProse(block.solution, section, label, "solution");
      pushProse(block.summary, section, label, "summary");
    } else if (type === "tariff") {
      const label = `тариф "${block.name || ""}"`;
      pushProse(block.preamble, section, label, "preamble");
      pushProse(block.hint, section, label, "hint");
      pushProse(block.expected_result, section, label, "expected_result");
      const services = Array.isArray(block.services) ? block.services : [];
      for (const svc of services) {
        const svcLabel = `${label} / услуга "${svc && svc.name ? svc.name : ""}"`;
        pushProse(svc ? svc.description : null, section, svcLabel, "services[].description");
      }
      if (isSection4) {
        pushPrice(block.preamble, label, "preamble");
        pushPrice(block.hint, label, "hint");
        pushPrice(block.expected_result, label, "expected_result");
        for (const svc of services) {
          const svcLabel = `${label} / услуга "${svc && svc.name ? svc.name : ""}"`;
          pushPrice(svc ? svc.name : null, svcLabel, "services[].name");
          pushPrice(svc ? svc.description : null, svcLabel, "services[].description");
        }
      }
    } else if (type === "special") {
      const items = Array.isArray(block.items) ? block.items : [];
      if (isSection4) {
        for (const it of items) {
          const itLabel = `special / "${it && it.name ? it.name : ""}"`;
          pushPrice(it ? it.description : null, itLabel, "items[].description");
        }
      }
    }
    // subheading/table/quick_wins/conditions - вне корпуса прозы для цен/стоп-паттернов/объема
    // (таблицы явно исключены из объема; quick_wins/conditions - вне списка полей спеки).
  }
}

// ──────────────────────────────────────────────────────────────────────────
// 3. ЦЕНЫ В ПРОЗЕ ТАРИФОВ (секция 4 ТОЛЬКО - секция 6 с декомпозицией исключена)
// ──────────────────────────────────────────────────────────────────────────

const priceViolations = [];
for (const entry of priceEntries) {
  const hits = [];
  if (HARD_PRICE_NUM_RE.test(entry.text)) hits.push("число рядом с валютой");
  if (CURRENCY_TOKEN_RE.test(entry.text)) hits.push("токен валюты");
  if (ROUND_THOUSANDS_RE.test(entry.text)) hits.push("круглая тысяча (вероятная цена)");
  if (hits.length) {
    priceViolations.push(`${entry.blockLabel} / ${entry.field}: ${hits.join(", ")} - "${shorten(entry.text)}"`);
  }
}

// ──────────────────────────────────────────────────────────────────────────
// 4. СТОП-ПАТТЕРНЫ ВОДЫ
// ──────────────────────────────────────────────────────────────────────────

const stopViolations = [];
for (const entry of proseEntries) {
  const normalized = normalize(entry.text);
  for (const pattern of STOP_PATTERNS) {
    const indices = findMatches(normalized, pattern);
    for (const idx of indices) {
      const fragment = normalized.slice(Math.max(0, idx - 20), idx + pattern.length + 20).trim();
      stopViolations.push(
        `[раздел ${entry.sectionId}] ${entry.blockLabel} / ${entry.field}: стоп-паттерн "${pattern}" - "...${fragment}..."`
      );
    }
  }
}

// ──────────────────────────────────────────────────────────────────────────
// 5. ТИРЕ/Е-С-ТОЧКАМИ - любой прозаический текст документа, включая служебные
//    поля (title_page.author и т.п.) - рекурсивный обход всех строк content.json.
// ──────────────────────────────────────────────────────────────────────────

const dashYoViolations = [];
function walkStrings(value, path, cb) {
  if (value == null) return;
  if (typeof value === "string") {
    cb(value, path);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => walkStrings(v, `${path}[${i}]`, cb));
    return;
  }
  if (typeof value === "object") {
    for (const key of Object.keys(value)) {
      walkStrings(value[key], path ? `${path}.${key}` : key, cb);
    }
  }
}

walkStrings(content, "", (str, path) => {
  if (DASH_RE.test(str)) {
    dashYoViolations.push(`${path}: длинное/среднее тире - "${shorten(str)}"`);
  }
  if (YO_RE.test(str)) {
    dashYoViolations.push(`${path}: буква Е-с-точками - "${shorten(str)}"`);
  }
});

// ──────────────────────────────────────────────────────────────────────────
// 6. ОБЪЕМ (warning, не блок)
// ──────────────────────────────────────────────────────────────────────────

let proseChars = 0;
for (const entry of proseEntries) proseChars += entry.text.length;

let volumeWarning = null;
if (proseChars < 3500) {
  volumeWarning = `проза подозрительно тонкая: ${proseChars} симв. (< 3500) - вероятно урезан контент`;
} else if (proseChars > 24000) {
  volumeWarning = `проза раздута: ${proseChars} симв. (> 24000), вероятно > 10 стр - сжать`;
}

// ──────────────────────────────────────────────────────────────────────────
// 7. СЦЕНАРНАЯ СОГЛАСОВАННОСТЬ (этап 8) - forecast_scenarios <-> tariffs.json.
// Независимый пересчет cost/ROMI (не только через модуль - инлайн-формула тут
// же, чтобы ловить регресс самого _forecast-money.mjs). Читает
// seo-strategiya_data.json и tariffs.json НЕФАТАЛЬНО: на этом шаге они уже
// должны существовать (шаги 4 и 5), но их отсутствие не должно валить
// проверку прозы content.json - секция просто помечается как пропущенная.
// Legacy-файлы (без forecast_scenarios) тоже не валятся - это старый формат
// (см. build-smeta-xlsx.mjs, writeLegacyDecompositionSheet).
// ──────────────────────────────────────────────────────────────────────────

const scenarioViolations = [];
let scenarioSkipped = false;
let scenarioSkipReason = "";

const scenarioData = readJson(join(strategyDir, "seo-strategiya_data.json"), false);
const scenarioTariffs = readJson(join(strategyDir, "tariffs.json"), false);
const forecastScenarios = scenarioData && scenarioData.forecast_scenarios;

if (
  !forecastScenarios ||
  !Array.isArray(forecastScenarios.scenarios) ||
  !forecastScenarios.scenarios.length
) {
  scenarioSkipped = true;
  scenarioSkipReason = "нет forecast_scenarios (legacy)";
} else if (!scenarioTariffs) {
  scenarioSkipped = true;
  scenarioSkipReason = "данные сценариев есть, но tariffs.json отсутствует - цены недоступны";
} else {
  const KEY_ALIASES = { rost: "growth" };
  const byKey = {};
  for (const k of Object.keys(scenarioTariffs)) {
    const ck = KEY_ALIASES[k] || k;
    if (TARIFF_KEYS.includes(ck)) byKey[ck] = scenarioTariffs[k];
  }

  const recos = forecastScenarios.scenarios.filter((s) => s && s.recommended);
  if (forecastScenarios.scenarios.length !== 2) {
    scenarioViolations.push(`ожидалось 2 сценария, найдено ${forecastScenarios.scenarios.length}`);
  }
  if (recos.length !== 1) {
    scenarioViolations.push(`ровно один сценарий должен быть recommended, найдено ${recos.length}`);
  }

  const assumptions = forecastScenarios.assumptions || {};
  if (!(assumptions.conversion_rate > 0 && assumptions.conversion_rate <= 1)) {
    scenarioViolations.push(`conversion_rate вне (0,1]: ${assumptions.conversion_rate}`);
  }
  if (!(assumptions.close_rate > 0 && assumptions.close_rate <= 1)) {
    scenarioViolations.push(`close_rate вне (0,1]: ${assumptions.close_rate}`);
  }
  if (!(assumptions.avg_check > 0)) {
    scenarioViolations.push(`avg_check должен быть > 0: ${assumptions.avg_check}`);
  }
  if (!(assumptions.margin > 0 && assumptions.margin <= 1)) {
    scenarioViolations.push(`margin вне (0,1]: ${assumptions.margin}`);
  }

  const resById = {}; // {scenId: {tariffKey: res}}
  for (const sc of forecastScenarios.scenarios) {
    if (!sc || typeof sc !== "object") continue;

    // (г) монотонность checkpoints внутри сценария
    const cp = sc.traffic_checkpoints || {};
    const order = ["m0", "m3", "m6", "m9", "m12"].map((k) => Number(cp[k]));
    for (let i = 1; i < order.length; i++) {
      if (Number.isFinite(order[i]) && Number.isFinite(order[i - 1]) && order[i] < order[i - 1]) {
        scenarioViolations.push(`[${sc.id}] checkpoints убывают: ${order.join(" -> ")}`);
        break;
      }
    }

    resById[sc.id] = {};
    for (const tk of TARIFF_KEYS) {
      const t = byKey[tk];
      if (!t) continue;
      const am = resolveActiveMonths(sc.active_months, tk);
      if (am < 1 || am > 12) {
        scenarioViolations.push(`[${sc.id}/${tk}] active_months вне 1..12: ${am}`);
      }
      if (sc.recommended && am !== 12) {
        scenarioViolations.push(`[${sc.id}/${tk}] recommended сценарий должен иметь active_months=12, а не ${am}`);
      }
      if (!sc.recommended && am >= 12) {
        scenarioViolations.push(`[${sc.id}/${tk}] сценарий "вход" должен иметь active_months<12, а не ${am}`);
      }

      const onetime = Number(t.total_onetime) || 0;
      const monthly = Number(t.total_monthly) || 0;
      const res = computeScenarioTariff({
        assumptions,
        checkpoints: cp,
        activeMonths: sc.active_months,
        tariffKey: tk,
        onetime,
        monthly,
      });
      resById[sc.id][tk] = res;

      // (а) cost_months === active_months сценария - независимая формула (не через модуль).
      const yearCostExpected = onetime + monthly * am;
      if (res.yearCost !== Math.round(yearCostExpected)) {
        scenarioViolations.push(
          `[${sc.id}/${tk}] cost_months рассинхрон: yearCost ${res.yearCost} != ожид ${Math.round(yearCostExpected)} (active_months=${am})`
        );
      }

      // (б) ROMI пересчитывается независимо от прибыли и совпадает (допуск +/-1 п.п. - округления).
      const romiExpected =
        yearCostExpected > 0 ? Math.round(((res.yearProfit - yearCostExpected) / yearCostExpected) * 100) : 0;
      if (Math.abs(res.romi - romiExpected) > 1) {
        scenarioViolations.push(`[${sc.id}/${tk}] ROMI рассинхрон: ${res.romi}% != пересчет ${romiExpected}%`);
      }
    }
  }

  // (в) санити: выручка "год" >= "вход" на m12, по каждому тарифу.
  const reco = recos[0];
  const other = forecastScenarios.scenarios.find((s) => s && !s.recommended);
  if (reco && other) {
    for (const tk of TARIFF_KEYS) {
      const ry = resById[reco.id]?.[tk];
      const re = resById[other.id]?.[tk];
      if (ry && re && ry.revMonth12 < re.revMonth12) {
        scenarioViolations.push(`[${tk}] revenue года (${ry.revMonth12}) < входа (${re.revMonth12}) на m12`);
      }
    }
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Отчет
// ──────────────────────────────────────────────────────────────────────────

console.log(`[verify-strategy] разделов: ${sections.length}, прозы: ${proseChars} симв.`);

printCapped("ЦЕНЫ В ПРОЗЕ ТАРИФОВ", priceViolations);
printCapped("СТОП-ПАТТЕРНЫ ВОДЫ", stopViolations);
printCapped("ТИРЕ/Е-С-ТОЧКАМИ", dashYoViolations);
printCapped("СТРУКТУРА", structureViolations);

console.log(`\nОБЪЕМ (warning):`);
if (volumeWarning) {
  console.log(`  - ${volumeWarning}`);
} else {
  console.log(`  - в норме: ${proseChars} симв. (ориентир 3500-24000, точную оценку дает strategy-verifier)`);
}

if (scenarioSkipped) {
  console.log(`\nСЦЕНАРНАЯ СОГЛАСОВАННОСТЬ: пропущена - ${scenarioSkipReason}.`);
} else {
  printCapped("СЦЕНАРНАЯ СОГЛАСОВАННОСТЬ", scenarioViolations);
  if (scenarioViolations.length === 0) {
    console.log(
      `\nСЦЕНАРНАЯ СОГЛАСОВАННОСТЬ: OK (2 сценария, cost/ROMI сходятся с независимым пересчетом, монотонность соблюдена).`
    );
  }
}

const totalViolations =
  priceViolations.length +
  stopViolations.length +
  dashYoViolations.length +
  structureViolations.length +
  scenarioViolations.length;

if (totalViolations > 0) {
  console.log(
    `\n[verify-strategy] НЕ ПРОЙДЕНО (цены ${priceViolations.length}, стоп-паттерны ${stopViolations.length}, тире/Е-с-точками ${dashYoViolations.length}, структура ${structureViolations.length}, сценарии ${scenarioViolations.length}).`
  );
  process.exit(2);
}

console.log(`\n[verify-strategy] OK: нарушений нет${volumeWarning ? " (см. предупреждение по объему выше)" : ""}.`);
process.exit(0);
