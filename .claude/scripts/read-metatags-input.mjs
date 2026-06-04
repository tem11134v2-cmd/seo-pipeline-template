#!/usr/bin/env node
// read-metatags-input.mjs
// Собирает канонический pages.json для /seo-metategi из одного из трёх источников:
//   --from-structure <structure_dir>  - страницы «да» из утверждённой структуры (A6)
//   --from-audit                       - выбранные страницы из site-scanner (audit.json)
//   --from-table <csv_or_tsv_path>     - готовая таблица URL/Тип/Маркер[/запросы]
//
// Используется в /seo-metategi (Фаза 1, до metatag-researcher) и в хвосте /seo-struktura.
//
// Использование:
//   node .claude/scripts/read-metatags-input.mjs <metatags_dir> --from-structure <structure_dir>
//   node .claude/scripts/read-metatags-input.mjs <metatags_dir> --from-audit
//   node .claude/scripts/read-metatags-input.mjs <metatags_dir> --from-table <path>
//
// Выход:
//   <metatags_dir>/pages.json
//
// Exit:
//   0 - ок, есть хотя бы одна страница
//   2 - источник прочитан, но ни одной целевой страницы (структура - все «нет»; аудит - ничего не выбрано)
//   1 - критическая ошибка (нет файла/папки, битый JSON, неизвестный источник)

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

function fail(msg) {
  console.error(`[read-metatags-input] ${msg}`);
  process.exit(1);
}

function readJson(path) {
  if (!existsSync(path)) fail(`не найден: ${path}`);
  try {
    return JSON.parse(readFileSync(path, "utf8").replace(/^﻿/, ""));
  } catch (err) {
    fail(`битый JSON ${path}: ${err.message}`);
  }
}

function readJsonOptional(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8").replace(/^﻿/, ""));
  } catch (err) {
    fail(`битый JSON ${path}: ${err.message}`);
  }
}

const argv = process.argv.slice(2);
const metatagsDirArg = argv[0];
if (!metatagsDirArg || metatagsDirArg.startsWith("--")) {
  fail("usage: read-metatags-input.mjs <metatags_dir> --from-structure <dir> | --from-audit | --from-table <path>");
}
const metatagsDir = resolve(metatagsDirArg);
if (!existsSync(metatagsDir)) mkdirSync(metatagsDir, { recursive: true });

const fromStructureIdx = argv.indexOf("--from-structure");
const fromAuditIdx = argv.indexOf("--from-audit");
const fromTableIdx = argv.indexOf("--from-table");

// Нормализация типа страницы к канону метатегов.
const TYPE_MAP = {
  home: "home", главная: "home", "главная страница": "home",
  category: "category", категория: "category", каталог: "category", раздел: "category",
  subcategory: "subcategory", подкатегория: "subcategory",
  service: "service", услуга: "service",
  subservice: "subservice", подуслуга: "subservice",
  product: "product", товар: "product", "карточка товара": "product",
  article: "article", статья: "article", блог: "article", инфо: "info",
  info: "info", информационная: "info",
  other: "other", прочее: "other",
};
function normType(t) {
  const k = String(t || "").trim().toLowerCase();
  return TYPE_MAP[k] || (k ? "other" : "other");
}

let pages = [];
let source = "";

// ──────────────────────────────────────────────────────────────────────────
// Источник 1: структура (structure_data.json + top10.json)
// ──────────────────────────────────────────────────────────────────────────
if (fromStructureIdx >= 0) {
  const structureDir = resolve(argv[fromStructureIdx + 1] || "");
  if (!argv[fromStructureIdx + 1]) fail("--from-structure требует путь к structures/NNN/");
  source = `structure:${structureDir}`;

  const sd = readJson(join(structureDir, "structure_data.json"));
  // top10.json - опционально (богаче запросами: freq_base + is_marker)
  const top10 = readJsonOptional(join(structureDir, "top10.json"));
  const top10ByN = new Map((top10?.pages || []).map((p) => [p.n, p]));

  const sdPages = sd.pages || [];
  for (const p of sdPages) {
    // Берём только утверждённые клиентом как целевые.
    if (p.target_status !== "yes") continue;

    // Запросы: предпочитаем top10 (богаче), иначе из structure_data.
    const t10 = top10ByN.get(p.n);
    let queries = [];
    if (t10 && Array.isArray(t10.queries) && t10.queries.length) {
      queries = t10.queries.map((q) => ({
        query: q.query,
        freq_exact: q.freq_exact ?? null,
        freq_base: q.freq_base ?? null,
        is_marker: !!q.is_marker,
      }));
    } else if (Array.isArray(p.queries) && p.queries.length) {
      queries = p.queries.map((q) => ({
        query: q.query,
        freq_exact: q.freq_exact ?? null,
        freq_base: null,
        is_marker: false,
      }));
    }
    pages.push({
      n: p.n,
      url: p.url || "",
      type: normType(p.type),
      name: p.name || "",
      marker: p.marker || (queries.find((q) => q.is_marker)?.query) || (queries[0]?.query) || "",
      queries,
      client_notes: p.client_notes || "",
    });
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Источник 2: аудит сайта (audit.json, отобранные страницы)
// ──────────────────────────────────────────────────────────────────────────
else if (fromAuditIdx >= 0) {
  source = "audit";
  const audit = readJson(join(metatagsDir, "audit.json"));
  const auditPages = audit.pages || [];
  // selected: страницы, которые пользователь выбрал на (пере)генерацию.
  // Если поле selected нигде не выставлено - берём все с verdict "needs_new" != false.
  const anySelected = auditPages.some((p) => p.selected === true);
  let n = 1;
  for (const p of auditPages) {
    const take = anySelected ? p.selected === true : p.needs_new !== false;
    if (!take) continue;
    pages.push({
      n: n++,
      url: p.url || "",
      type: normType(p.type),
      name: p.name || "",
      marker: p.marker || "",
      queries: Array.isArray(p.queries) ? p.queries : [],
      current_h1: p.current_h1 || "",
      current_title: p.current_title || "",
      current_description: p.current_description || "",
      client_notes: p.reason || "",
    });
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Источник 3: таблица (CSV/TSV: URL, Тип, Маркер, [Запрос2, Запрос3, ...])
// ──────────────────────────────────────────────────────────────────────────
else if (fromTableIdx >= 0) {
  const tablePath = resolve(argv[fromTableIdx + 1] || "");
  if (!argv[fromTableIdx + 1]) fail("--from-table требует путь к csv/tsv");
  if (!existsSync(tablePath)) fail(`таблица не найдена: ${tablePath}`);
  source = `table:${tablePath}`;

  const raw = readFileSync(tablePath, "utf8").replace(/^﻿/, "");
  const lines = raw.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) fail("таблица пуста");

  // Делитель: таб приоритетнее (меньше конфликтов с запятой в названиях), иначе ; иначе ,
  const sniff = lines[0];
  const delim = sniff.includes("\t") ? "\t" : sniff.includes(";") ? ";" : ",";
  const split = (l) => l.split(delim).map((c) => c.trim().replace(/^"|"$/g, ""));

  // Распознать заголовок (если первая строка содержит «url»/«адрес» - это шапка)
  let startIdx = 0;
  const header = split(lines[0]).map((c) => c.toLowerCase());
  const looksLikeHeader = header.some((c) => /url|адрес|тип|type|маркер|marker|назв/.test(c));
  let colUrl = 0, colType = 1, colName = -1, colMarker = 2, queryStart = 3;
  if (looksLikeHeader) {
    startIdx = 1;
    const find = (re) => header.findIndex((c) => re.test(c));
    colUrl = Math.max(0, find(/url|адрес/));
    colType = find(/тип|type/);
    colName = find(/назв|name|заголов/);
    colMarker = find(/маркер|marker|запрос/);
    if (colType < 0) colType = 1;
    if (colMarker < 0) colMarker = 2;
    queryStart = Math.max(colMarker, colType, colUrl) + 1;
  }

  let n = 1;
  for (let i = startIdx; i < lines.length; i++) {
    const cells = split(lines[i]);
    if (!cells.length || !cells[colUrl]) continue;
    const marker = (colMarker >= 0 && cells[colMarker]) ? cells[colMarker] : "";
    const queries = [];
    if (marker) queries.push({ query: marker, freq_exact: null, freq_base: null, is_marker: true });
    for (let c = queryStart; c < cells.length; c++) {
      if (cells[c]) queries.push({ query: cells[c], freq_exact: null, freq_base: null, is_marker: false });
    }
    pages.push({
      n: n++,
      url: cells[colUrl],
      type: normType(cells[colType]),
      name: colName >= 0 ? (cells[colName] || "") : "",
      marker,
      queries,
      client_notes: "",
    });
  }
} else {
  fail("укажи источник: --from-structure <dir> | --from-audit | --from-table <path>");
}

// Перенумеровать n подряд (на случай дыр из структуры)
pages.forEach((p, i) => { p.n = i + 1; });

const out = {
  generated_at: new Date().toISOString(),
  source,
  total: pages.length,
  pages,
};
writeFileSync(join(metatagsDir, "pages.json"), JSON.stringify(out, null, 2));

console.log(`[read-metatags-input] OK: ${pages.length} страниц -> ${join(metatagsDir, "pages.json")}`);
console.log(`   источник: ${source}`);
const byType = {};
for (const p of pages) byType[p.type] = (byType[p.type] || 0) + 1;
console.log(`   по типам: ${Object.entries(byType).map(([t, c]) => `${t}:${c}`).join(", ") || "-"}`);
const noMarker = pages.filter((p) => !p.marker && p.type !== "info").length;
if (noMarker > 0) console.log(`   i без маркера (кроме info): ${noMarker} - researcher попробует вывести из названия`);

if (pages.length === 0) {
  console.error("[read-metatags-input] ни одной целевой страницы (структура: все «нет»? аудит: ничего не выбрано?).");
  process.exit(2);
}

process.exit(0);
