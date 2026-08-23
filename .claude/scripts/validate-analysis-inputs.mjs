#!/usr/bin/env node
// validate-analysis-inputs.mjs
// Жёсткая валидация входа для /seo-struktura: проверяет НАЛИЧИЕ файлов анализа И канонические поля,
// а не просто «файл существует». Ловит дрейф схемы (например target_queries_client вместо
// client_target_queries) и неполный/реконструированный анализ ДО старта дорогих шагов.
//
// Используется в /seo-struktura на шаге 1a и в /seo-analiz v2 (tier-aware гейт).
//
// Использование:
//   node .claude/scripts/validate-analysis-inputs.mjs <analysis_dir> [--tier seo|basic]
//
// Tier (v2): читается из <analysis_dir>/meta.json (поле tier); fallback - флаг --tier,
//   дефолт seo (обратная совместимость старых анализов). Новые требования v2
//   (brief.directions[] + audience.json) включаются ТОЛЬКО когда tier несет meta.json -
//   старые анализы без поля tier валидируются по старым правилам без новых требований.
//   При tier=basic: serp.json и keyso_base не требуются, Keyso-метрики direct[] опциональны.
//
// Вход:
//   <analysis_dir>/meta.json         - опционален (несет tier; без него - legacy-правила)
//   <analysis_dir>/brief.json        - канон brief-structurer
//   <analysis_dir>/competitors.json  - канон competitor-finder
//   <analysis_dir>/serp.json         - канон serp-verdict (обязателен только при tier=seo)
//   <analysis_dir>/audience.json     - канон audience-analyst (обязателен только в формате v2)
//   <analysis_dir>/leader_scan.json  - опционален (НЕ блокирует)
//   <analysis_dir>/intake.json       - опционален (НЕ блокирует; этап 3, warn-only)
//   <analysis_dir>/intake_lexicon.json - опционален (НЕ блокирует): второй слой интейка -
//                                      сырье для текстов (client_wordings, internal_terms,
//                                      client_metaphors, client_life_before_after). Отсутствие -
//                                      штатный легаси-режим однослойного интейка, не ошибка.
//   <analysis_dir>/questions.json    - опционален (НЕ блокирует; этап 3, warn-only)
//   <analysis_dir>/A2.md             - опционален; если есть - скан на brief.forbidden_self_names
//   <analysis_dir>/recommendations.json - опционален; тот же скан (машиночитаемый выход
//                                      читают /seo-struktura и /seo-tekst, там цена ошибки выше)
//
// Схему самих фактов интейка валидатор НЕ проверяет (файлы даже не парсятся), поэтому новые
// подполя факта - kind (inn|ogrn|address|entity|phone|email) и unconfirmed - его не роняют.
// Выход (stdout):
//   построчный отчёт + (если есть _import_meta) предупреждение о реконструированном входе
//
// Exit:
//   0  - всё ок (канон-схема)
//   2  - не хватает файлов/полей ИЛИ найдено запрещенное самоназвание (печатает построчно)
//   1  - ошибка запуска (нет аргумента, директории нет, битый JSON)

import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
const dirArg = args[0];
if (!dirArg || dirArg.startsWith("--")) {
  console.error("[validate-analysis-inputs] usage: node validate-analysis-inputs.mjs <analysis_dir> [--tier seo|basic]");
  process.exit(1);
}

let tierFlag = null;
const tierIdx = args.indexOf("--tier");
if (tierIdx !== -1) {
  tierFlag = args[tierIdx + 1];
  if (!["seo", "basic"].includes(tierFlag)) {
    console.error(`[validate-analysis-inputs] --tier должен быть «seo» или «basic», получено: ${tierFlag}`);
    process.exit(1);
  }
}
const analysisDir = resolve(dirArg);
if (!existsSync(analysisDir)) {
  console.error(`[validate-analysis-inputs] директории нет: ${analysisDir}`);
  process.exit(1);
}

const problems = [];

function loadJson(name) {
  const path = join(analysisDir, name);
  if (!existsSync(path)) {
    problems.push(`нет файла: ${name}`);
    return null;
  }
  try {
    return JSON.parse(readFileSync(path, "utf8").replace(/^﻿/, ""));
  } catch (err) {
    problems.push(`битый JSON в ${name}: ${err.message}`);
    return null;
  }
}

// Опциональный файл: отсутствие - не проблема, битый JSON - проблема.
function loadJsonOptional(name) {
  const path = join(analysisDir, name);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8").replace(/^﻿/, ""));
  } catch (err) {
    problems.push(`битый JSON в ${name}: ${err.message}`);
    return null;
  }
}

const isNonEmptyStr = (v) => typeof v === "string" && v.trim().length > 0;
const isArray = (v) => Array.isArray(v);
const isNonEmptyArray = (v) => Array.isArray(v) && v.length > 0;

// Проверка поля с известным алиасом-дрейфом - сообщаем точную причину.
function checkFieldWithAlias(obj, file, canonical, aliases, validator, label) {
  if (validator(obj?.[canonical])) return;
  const presentAlias = aliases.find((a) => obj && a in obj);
  if (presentAlias) {
    problems.push(`${file}: поле «${canonical}» отсутствует, но есть «${presentAlias}» - дрейф схемы, переименуй в «${canonical}»`);
  } else {
    problems.push(`${file}: нет/пустое обязательное поле «${canonical}» (${label})`);
  }
}

// === Tier (контракты v7, 1.4а/1.7) ===
// Источник: meta.json.tier (формат v2) -> флаг --tier -> дефолт "seo" (legacy-анализы).
// tierV2 = meta.json несет валидный tier; только тогда включаются требования
// directions[] + audience.json (старые анализы идут по старым правилам).
const meta = loadJsonOptional("meta.json");
const metaTier = meta && typeof meta.tier === "string" ? meta.tier.trim() : null;
if (metaTier && !["seo", "basic"].includes(metaTier)) {
  problems.push(`meta.json: «tier» не один из seo|basic (получено: «${metaTier}»)`);
}
const tierV2 = metaTier === "seo" || metaTier === "basic";
const tier = tierV2 ? metaTier : (tierFlag || "seo");

// === brief.json ===
const brief = loadJson("brief.json");
if (brief) {
  if (!isNonEmptyStr(brief.slug)) problems.push("brief.json: нет/пустое «slug»");
  // keyso_base - Keyso-поле ступени 1: при tier=basic ключ отсутствует по контракту 1.2
  if (tier === "seo" && !isNonEmptyStr(brief.keyso_base)) problems.push("brief.json: нет/пустое «keyso_base»");
  if (!isNonEmptyStr(brief.niche)) problems.push("brief.json: нет/пустое «niche»");
  if (!isNonEmptyStr(brief.region)) problems.push("brief.json: нет/пустое «region»");
  if (!["shop", "services", "both"].includes(brief.business_type)) {
    problems.push("brief.json: «business_type» не один из shop|services|both");
  }
  if (!isNonEmptyArray(brief.assortment)) problems.push("brief.json: «assortment» пуст (нужен хотя бы 1 пункт)");
  checkFieldWithAlias(
    brief, "brief.json", "client_target_queries",
    ["target_queries_client", "target_queries", "client_queries"],
    isArray, "массив, может быть пустым"
  );
  for (const f of ["utp_technical", "utp_service", "utp_social"]) {
    if (!isArray(brief[f])) problems.push(`brief.json: нет «${f}» (массив, может быть пустым)`);
  }
  // domain может быть null, но КЛЮЧ должен присутствовать (иначе непонятно - нет домена или забыли)
  if (!("domain" in brief)) problems.push("brief.json: нет ключа «domain» (поставь null если домена нет)");
  // client_pages обязателен только если домен задан
  if (isNonEmptyStr(brief.domain) && !isArray(brief.client_pages)) {
    problems.push("brief.json: домен задан, но нет «client_pages» (массив; пустой допустим, если сайт без видимости)");
  }
  // forbidden_self_names[] (контракт N2) - слова, которыми клиента называть нельзя.
  // Поле НЕОБЯЗАТЕЛЬНО: отсутствие и пустой массив - норма (запретов на самоназвание нет).
  if ("forbidden_self_names" in brief && !isArray(brief.forbidden_self_names)) {
    problems.push("brief.json: «forbidden_self_names» должен быть массивом строк (пустой массив допустим)");
  }
  // directions[] (контракт 1.2) - только формат v2: канон направлений для ступеней 2-3 и текстов
  if (tierV2) {
    if (!isNonEmptyArray(brief.directions)) {
      problems.push("brief.json: «directions» пуст (нужно хотя бы 1 направление)");
    } else {
      const seenSlugs = new Set();
      const dupSlugs = new Set();
      const noSlug = [];
      brief.directions.forEach((d, i) => {
        const slug = d?.dir_slug;
        if (!isNonEmptyStr(slug)) noSlug.push(i);
        else if (seenSlugs.has(slug)) dupSlugs.add(slug);
        else seenSlugs.add(slug);
      });
      if (noSlug.length) problems.push(`brief.json: directions[] без «dir_slug» (строки: ${noSlug.join(", ")})`);
      if (dupSlugs.size) problems.push(`brief.json: «dir_slug» не уникальны: ${[...dupSlugs].join(", ")}`);
    }
  }
}

// === Запрет на самоназвание (контракт N2): brief.forbidden_self_names в A2.md и recommendations.json ===
// Почему проверка здесь, а не суждением агента: в бою слово-запрет («школа») проскочило не в
// клиентской формулировке, а в служебной прозе («комиссия за счет школы»), где звучит
// нейтрально, - агент такого не ловит, потому что ищет нарушения позиционирования. Запрет на
// САМОНАЗВАНИЕ - не суждение, а грепабельный список, значит и проверка детерминированная.
// Место вызова выбрано так, чтобы проверка реально отработала: скрипт зовут на гейте 7b
// /seo-analiz (state report-done - A2.md и recommendations.json уже собраны шагом 7) и на
// шаге 1a /seo-struktura (там они тем более есть). Отсутствие файла - не ошибка (легаси-вход
// и вызовы до сборки отчета), просто проверять нечего.
// Матчинг: регистронезависимо, е-с-точками приравнивается к е, по границам слова,
// «основа + типичные окончания»
// (школа/школы/школе/школой/школу/школам/школами/школах ловятся все). Ложные срабатывания
// внутри других слов исключены границами: «школьник», «курсант», «университетский» не ловятся.
const SELF_NAME_ENDINGS = [
  "", "а", "я", "у", "ю", "ы", "и", "е", "о",
  "ой", "ей", "ою", "ею", "ом", "ем", "ам", "ям", "ах", "ях", "ов", "ев",
  "ии", "ию", "ией", "ья", "ье", "ью",
  "ая", "ую", "ые", "ых", "ым", "ами", "ями", "ыми",
];
// Строки, где запрет ДЕКЛАРИРУЕТСЯ (раздел запрещенных формулировок того же отчета),
// нарушением не считаются - иначе гейт падал бы всегда: писатель обязан перечислить запрет.
const SELF_NAME_DECLARATION_MARKERS = [/запрещ/, /не называ/, /нельзя называ/, /стоп-слов/, /самоназван/, /forbidden/];

const normSelfName = (s) => String(s).toLowerCase().replace(/ё/g, "е");
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function selfNameMatcher(word) {
  const w = normSelfName(word).trim();
  if (!w) return null;
  // Основа: снимаем одну конечную гласную начальной формы (школа -> школ, курсы -> курс);
  // слово на согласный остается как есть (университет).
  const stem = w.length > 3 && /[аяуюыиео]$/.test(w) ? w.slice(0, -1) : w;
  const endings = [...SELF_NAME_ENDINGS].sort((a, b) => b.length - a.length).map(escapeRe).join("|");
  const LETTER = "[а-яa-z0-9_]";
  return { word: w, re: new RegExp(`(?<!${LETTER})${escapeRe(stem)}(?:${endings})(?!${LETTER})`, "gu") };
}

function isSelfNameDeclarationLine(line) {
  const l = normSelfName(line);
  return SELF_NAME_DECLARATION_MARKERS.some((re) => re.test(l));
}

// Строковые литералы JSON - единица маркерного пропуска в машиночитаемых файлах (см. ниже).
const JSON_STRING_RE = /"(?:[^"\\]|\\.)*"/g;

// Скан построчно. Для markdown дополнительно пропускается ЦЕЛИКОМ раздел, заголовок которого
// объявляет запрет (там слова перечислены списком, без маркера в самой строке).
//
// Для .json маркерный пропуск применяется НЕ к строке файла, а к каждому строковому литералу
// отдельно. Причина: в машиночитаемом выходе раздела деклараций нет, зато слово-маркер
// («запрещ» из процитированного forbidden_wordings) регулярно лежит в соседнем поле той же
// строки, а минифицированный JSON целиком помещается в ОДНУ строку - построчный пропуск
// выключал бы проверку по всему файлу. Разбор по литералам делает пропуск точечным и
// не зависящим от форматирования.
function scanForSelfNames(fileName, text, matchers) {
  const isJson = /\.json$/i.test(fileName);
  const hits = [];
  const lines = text.split(/\r?\n/);
  let skipLevel = 0;

  // segment - кусок, который реально сканируем; offset - его сдвиг внутри line (для form).
  const collect = (segment, offset, line, i) => {
    const hay = normSelfName(segment);
    for (const m of matchers) {
      m.re.lastIndex = 0;
      const found = m.re.exec(hay);
      if (found) {
        hits.push({
          file: fileName,
          line: i + 1,
          word: m.word,
          form: line.slice(offset + found.index, offset + found.index + found[0].length),
          context: (isJson ? segment : line).trim().slice(0, 120),
        });
      }
    }
  };

  lines.forEach((line, i) => {
    if (isJson) {
      JSON_STRING_RE.lastIndex = 0;
      let lit;
      while ((lit = JSON_STRING_RE.exec(line))) {
        if (isSelfNameDeclarationLine(lit[0])) continue;
        collect(lit[0], lit.index, line, i);
      }
      return;
    }
    const heading = /^(#{1,6})\s/.exec(line);
    if (heading) {
      const level = heading[1].length;
      if (skipLevel && level <= skipLevel) skipLevel = 0;
      if (isSelfNameDeclarationLine(line)) {
        skipLevel = level;
        return;
      }
    }
    if (skipLevel) return;
    if (isSelfNameDeclarationLine(line)) return;
    collect(line, 0, line, i);
  });
  return hits;
}

const forbiddenSelfNames = isArray(brief?.forbidden_self_names)
  ? brief.forbidden_self_names.filter(isNonEmptyStr)
  : [];
const selfNameMatchers = forbiddenSelfNames.map(selfNameMatcher).filter(Boolean);
const selfNameScannedFiles = [];
if (selfNameMatchers.length) {
  const hits = [];
  for (const name of ["A2.md", "recommendations.json"]) {
    const path = join(analysisDir, name);
    if (!existsSync(path)) continue;
    selfNameScannedFiles.push(name);
    hits.push(...scanForSelfNames(name, readFileSync(path, "utf8").replace(/^﻿/, ""), selfNameMatchers));
  }
  const MAX_SHOWN = 20;
  hits.slice(0, MAX_SHOWN).forEach((h) => {
    problems.push(
      `${h.file}:${h.line}: запрещенное самоназвание «${h.form}» (запрет brief.forbidden_self_names: «${h.word}») - «${h.context}»`
    );
  });
  if (hits.length > MAX_SHOWN) {
    problems.push(`запрещенное самоназвание: еще ${hits.length - MAX_SHOWN} вхождений (показаны первые ${MAX_SHOWN})`);
  }
}

// === competitors.json ===
const competitors = loadJson("competitors.json");
if (competitors) {
  if (!isNonEmptyArray(competitors.direct)) {
    problems.push("competitors.json: «direct[]» пуст (нужен хотя бы 1 конкурент)");
  } else {
    // domain - жёстко обязателен (master-list/marker-finder работают по нему).
    // Метрики (pages_keyso/top10/top50/dr/traffic_month) - блокируем только если КЛЮЧ ОТСУТСТВУЕТ
    // (дрейф схемы / не тот агент). Значение null терпимо - это просто несобранная метрика,
    // в xlsx покажется «-». Иначе валидатор даёт ложный блок на рабочем (например реконструированном) анализе.
    // При tier=basic Keyso-метрики опциональны целиком (контракт 1.4а: деградация отсутствием).
    const metricKeys = tier === "seo" ? ["pages_keyso", "top10", "top50", "dr", "traffic_month"] : [];
    const noDomain = [];
    const keyAbsent = {};
    competitors.direct.forEach((c, i) => {
      if (!isNonEmptyStr(c.domain)) noDomain.push(i);
      for (const f of metricKeys) {
        if (!(f in c)) (keyAbsent[f] ||= []).push(i);
      }
    });
    if (noDomain.length) {
      problems.push(`competitors.json: direct[] без «domain» (строки: ${noDomain.join(", ")})`);
    }
    for (const [f, idxs] of Object.entries(keyAbsent)) {
      if (f === "pages_keyso" && competitors.direct.every((c) => "pages_in_base" in c)) {
        problems.push(`competitors.json: direct[] использует «pages_in_base» вместо канон «pages_keyso» - дрейф схемы`);
      } else {
        problems.push(`competitors.json: direct[] без ключа «${f}» (дрейф схемы; строки: ${idxs.join(", ")})`);
      }
    }
  }
  if (!isNonEmptyArray(competitors.leaders_top3)) {
    problems.push("competitors.json: «leaders_top3[]» пуст");
  }
}

// === serp.json - при tier=basic не требуется (ступень 4 не покупалась), но если есть - проверяем ===
const serp = tier === "basic" ? loadJsonOptional("serp.json") : loadJson("serp.json");
if (serp) {
  if (!isArray(serp.stop_list)) problems.push("serp.json: нет «stop_list[]» (массив)");
  if (!isNonEmptyStr(serp?.verdict?.type)) problems.push("serp.json: нет «verdict.type»");
}

// === audience.json (ступень 2) - обязателен только в формате v2 (meta.json несет tier) ===
if (tierV2) {
  const audience = loadJson("audience.json");
  if (audience) {
    if (!isNonEmptyStr(audience.summary)) problems.push("audience.json: нет/пустое «summary»");
    if (!isNonEmptyArray(audience.segments)) problems.push("audience.json: «segments» пуст (нужен хотя бы 1 сегмент)");
  }
}

// === leader_scan.json - опционален, только предупреждение ===
const leaderScanMissing = !existsSync(join(analysisDir, "leader_scan.json"));

// === intake.json / questions.json (этап 3) - опциональны, только предупреждение ===
// НЕ блокируют: legacy-анализы (собранные до этапа 3) должны проходить гейт как раньше.
const intakeMissing = !existsSync(join(analysisDir, "intake.json"));
const questionsMissing = !existsSync(join(analysisDir, "questions.json"));

// === intake_lexicon.json (двухслойный интейк) - опционален, только предупреждение ===
// Наличие НЕ обязательно, отсутствие - НЕ ошибка: это легаси-режим однослойного интейка,
// где лексиконные факты лежат прямо в intake.json.facts[].
const lexiconPresent = existsSync(join(analysisDir, "intake_lexicon.json"));

// === Реконструированный вход (не блокирует, но surface) ===
const reconstructed = brief && brief._import_meta ? brief._import_meta : null;

// === Отчёт ===
if (problems.length > 0) {
  console.error(`[validate-analysis-inputs] НЕ ПРОЙДЕНО: ${analysisDir}`);
  console.error("Проблемы (канон-схема нарушена):");
  for (const p of problems) console.error(`  - ${p}`);
  console.error("");
  console.error("Варианты: (1) перепрогнать /seo-analiz --resume <NNN>;");
  console.error("          (2) если только legacy A2.md - дособрать канон-JSON вручную по образцу structures/001-*/.");
  process.exit(2);
}

console.log(`[validate-analysis-inputs] OK: ${analysisDir} - канон-схема цела`);
console.log(`  i tier=${tier}${tierV2 ? " (meta.json)" : tierFlag ? " (--tier)" : " (дефолт: legacy-анализ без meta.tier)"}`);
if (leaderScanMissing) {
  console.log("  i leader_scan.json отсутствует (опционален - рекомендации по расширению будут беднее)");
}
if (intakeMissing) {
  console.log("  i intake.json отсутствует (легаси-анализ без интейк-этапа - провенанс фактов недоступен)");
} else if (lexiconPresent) {
  console.log("  i intake_lexicon.json есть - двухслойный интейк: лексиконные факты берутся из него");
} else {
  console.log("  i intake_lexicon.json нет - легаси однослойный интейк: лексиконные факты ищутся в intake.json.facts[]");
}
if (questionsMissing) {
  console.log("  i questions.json отсутствует (легаси-анализ без раздела «Вопросы к вам»)");
}
if (selfNameMatchers.length) {
  console.log(
    selfNameScannedFiles.length
      ? `  i самоназвание: ${selfNameMatchers.length} запрет(ов) проверено в ${selfNameScannedFiles.join(", ")} - нарушений нет`
      : `  i самоназвание: ${selfNameMatchers.length} запрет(ов) в brief, но ни A2.md, ни recommendations.json нет - проверять нечего`
  );
}
if (reconstructed) {
  console.log("  ⚠ ВНИМАНИЕ: анализ реконструирован (brief._import_meta присутствует).");
  console.log(`     imported_from: ${reconstructed.imported_from || "?"}`);
  console.log("     Структура будет построена на реконструированных данных - отрази это в стартовой сводке и A6.md.");
}
process.exit(0);
