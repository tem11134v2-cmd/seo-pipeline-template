#!/usr/bin/env node
// validate-analysis-inputs.mjs
// Жёсткая валидация входа для /seo-structure: проверяет НАЛИЧИЕ файлов анализа И канонические поля,
// а не просто «файл существует». Ловит дрейф схемы (например target_queries_client вместо
// client_target_queries) и неполный/реконструированный анализ ДО старта дорогих шагов.
//
// Используется в /seo-structure на шаге 1a.
//
// Использование:
//   node .claude/scripts/validate-analysis-inputs.mjs <analysis_dir>
//
// Вход:
//   <analysis_dir>/brief.json        - канон brief-structurer
//   <analysis_dir>/competitors.json  - канон competitor-finder
//   <analysis_dir>/serp.json         - канон serp-verdict
//   <analysis_dir>/leader_scan.json  - опционален (НЕ блокирует)
// Выход (stdout):
//   построчный отчёт + (если есть _import_meta) предупреждение о реконструированном входе
//
// Exit:
//   0  - всё ок (канон-схема)
//   2  - не хватает файлов/полей (печатает построчно чего нет)
//   1  - ошибка запуска (нет аргумента, директории нет, битый JSON)

import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const dirArg = process.argv[2];
if (!dirArg) {
  console.error("[validate-analysis-inputs] usage: node validate-analysis-inputs.mjs <analysis_dir>");
  process.exit(1);
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

// === brief.json ===
const brief = loadJson("brief.json");
if (brief) {
  if (!isNonEmptyStr(brief.slug)) problems.push("brief.json: нет/пустое «slug»");
  if (!isNonEmptyStr(brief.keyso_base)) problems.push("brief.json: нет/пустое «keyso_base»");
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
    const metricKeys = ["pages_keyso", "top10", "top50", "dr", "traffic_month"];
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

// === serp.json ===
const serp = loadJson("serp.json");
if (serp) {
  if (!isArray(serp.stop_list)) problems.push("serp.json: нет «stop_list[]» (массив)");
  if (!isNonEmptyStr(serp?.verdict?.type)) problems.push("serp.json: нет «verdict.type»");
}

// === leader_scan.json - опционален, только предупреждение ===
const leaderScanMissing = !existsSync(join(analysisDir, "leader_scan.json"));

// === Реконструированный вход (не блокирует, но surface) ===
const reconstructed = brief && brief._import_meta ? brief._import_meta : null;

// === Отчёт ===
if (problems.length > 0) {
  console.error(`[validate-analysis-inputs] НЕ ПРОЙДЕНО: ${analysisDir}`);
  console.error("Проблемы (канон-схема нарушена):");
  for (const p of problems) console.error(`  - ${p}`);
  console.error("");
  console.error("Варианты: (1) перепрогнать /seo-analysis --resume <NNN>;");
  console.error("          (2) если только legacy A2.md - дособрать канон-JSON вручную по образцу structures/001-*/.");
  process.exit(2);
}

console.log(`[validate-analysis-inputs] OK: ${analysisDir} - канон-схема цела`);
if (leaderScanMissing) {
  console.log("  i leader_scan.json отсутствует (опционален - рекомендации по расширению будут беднее)");
}
if (reconstructed) {
  console.log("  ⚠ ВНИМАНИЕ: анализ реконструирован (brief._import_meta присутствует).");
  console.log(`     imported_from: ${reconstructed.imported_from || "?"}`);
  console.log("     Структура будет построена на реконструированных данных - отрази это в стартовой сводке и A6.md.");
}
process.exit(0);
