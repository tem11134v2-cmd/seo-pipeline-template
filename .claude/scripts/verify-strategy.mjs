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

import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { computeScenarioTariff, resolveActiveMonths, TARIFF_KEYS } from "./_forecast-money.mjs";

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
  structureViolations.push("нет раздела с id=4 (варианты работы) - без него docx бессмысленен");
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
