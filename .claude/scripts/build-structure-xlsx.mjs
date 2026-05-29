#!/usr/bin/env node
// build-structure-xlsx.mjs
// Генерирует A6.xlsx со структурой сайта (4 листа) для отправки клиенту.
// Порт TEMPLATE-A6.py (openpyxl) на ExcelJS.
//
// Использование:
//   node .claude/scripts/build-structure-xlsx.mjs <structure_dir>
//
// Вход:
//   <structure_dir>/inputs.json           - slug, domain, регион
//   <structure_dir>/master_list.json      - мастер-список + миграция
//   <structure_dir>/markers.json          - маркеры (для случаев без top10)
//   <structure_dir>/top10.json            - топ-10 на страницу
//   <structure_dir>/cannibalization.json  - рекомендации по расширению
//   <analysis_dir>/competitors.json       - для листа «Конкуренты»
// Выход:
//   <structure_dir>/A6_<slug>.xlsx        - 4 листа: Структура, Рекомендации, Конкуренты, Миграция

import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import ExcelJS from "exceljs";

const MAX_QUERIES = 9; // Запросов помимо маркера (всего 10 = маркер + 9)

const structureDirArg = process.argv[2];
if (!structureDirArg) {
  console.error("[build-structure-xlsx] usage: node build-structure-xlsx.mjs <structure_dir>");
  process.exit(1);
}
const structureDir = resolve(structureDirArg);

function readJson(path) {
  if (!existsSync(path)) {
    console.error(`[build-structure-xlsx] not found: ${path}`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(path, "utf8").replace(/^﻿/, ""));
}

function readJsonOptional(path) {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8").replace(/^﻿/, ""));
}

const inputs = readJson(join(structureDir, "inputs.json"));
const masterList = readJson(join(structureDir, "master_list.json"));
const top10 = readJson(join(structureDir, "top10.json"));
const cannibalization = readJsonOptional(join(structureDir, "cannibalization.json")) || { recommendations: [] };

// inputs.analysis_dir хранится как путь от project root. Скрипт запускается из project root.
const analysisDir = inputs.analysis_dir ? resolve(inputs.analysis_dir) : null;
const competitors = analysisDir
  ? readJsonOptional(join(analysisDir, "competitors.json")) || { direct: [], leaders_top3: [] }
  : { direct: [], leaders_top3: [] };

const slug = (inputs.slug || "structure").replace(/[<>:"/\\|?*\x00-\x1f]/g, "_");
const outputPath = join(structureDir, `A6_${slug}.xlsx`);

// === Дизайн-токены (одинаковая палитра с build-smeta-xlsx) ===
const COLORS = {
  header_bg: "FF2F5496",
  header_text: "FFFFFFFF",
  border: "FFD9D9D9",
  warning: "FFFF0000",
  prio_high: "FFE2EFDA",
  prio_medium: "FFFFF2CC",
  prio_low: "FFFCE4EC",
  text: "FF000000",
};
const FONT_FAMILY = "Arial";
const FONT_SIZE = 10;

const thinBorder = {
  top: { style: "thin", color: { argb: COLORS.border } },
  left: { style: "thin", color: { argb: COLORS.border } },
  bottom: { style: "thin", color: { argb: COLORS.border } },
  right: { style: "thin", color: { argb: COLORS.border } },
};

function applyHeader(cell) {
  cell.font = { name: FONT_FAMILY, size: FONT_SIZE + 1, bold: true, color: { argb: COLORS.header_text } };
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.header_bg } };
  cell.border = thinBorder;
  cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
}

function applyBody(cell, priority, isWarning) {
  cell.font = { name: FONT_FAMILY, size: FONT_SIZE, color: { argb: isWarning ? COLORS.warning : COLORS.text } };
  if (priority && COLORS[`prio_${priority}`]) {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS[`prio_${priority}`] } };
  }
  cell.border = thinBorder;
  cell.alignment = { vertical: "top", wrapText: true };
}

// === Эвристика приоритета ===

function calcPriority(page, master) {
  const cov = master?.coverage_pct ?? 0;
  const freq = page.ws_exact || 0;
  if (cov >= 50 || freq >= 500) return "high";
  if (cov >= 25 || freq >= 100) return "medium";
  return "low";
}

const PRIO_RU = { high: "высокий", medium: "средний", low: "низкий" };

// === ЧПУ-генератор ===
function transliterate(str) {
  const map = {
    а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh",
    з: "z", и: "i", й: "j", к: "k", л: "l", м: "m", н: "n", о: "o",
    п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "c",
    ч: "ch", ш: "sh", щ: "shch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
  };
  return str
    .toLowerCase()
    .split("")
    .map((c) => map[c] ?? c)
    .join("");
}

function makeUrl(page) {
  if (page.client_current_url) return page.client_current_url;
  if (page.migration_target_url) return page.migration_target_url;
  const slug = transliterate(page.name)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  const prefixByType = {
    home: "/",
    category: "/catalog/",
    service: "/uslugi/",
    product: "/catalog/",
    article: "/blog/",
    info: "/",
    other: "/",
  };
  if (page.type === "home") return "/";
  const prefix = prefixByType[page.type] || "/";
  return `${prefix}${slug}/`;
}

// === Создание книги ===

const workbook = new ExcelJS.Workbook();
workbook.creator = "seo-pipeline /seo-structure";
workbook.created = new Date();

// === Лист 1: СТРУКТУРА ===

const ws1 = workbook.addWorksheet("Структура");

const fixedLeft = ["№", "URL (ЧПУ)", "Тип", "Название", "Целевая?", "Маркер", "WS"];
const queryHeaders = [];
// MAX_QUERIES=9 дополнительных запросов (2..10), всего 10 запросов с маркером.
for (let i = 2; i <= MAX_QUERIES + 1; i++) {
  queryHeaders.push(`Запрос ${i}`, `Ч${i}`);
}
const fixedRight = ["У конкурентов", "Приоритет", "Статус", "Примечания"];
const headers1 = [...fixedLeft, ...queryHeaders, ...fixedRight];

ws1.addRow(headers1);
headers1.forEach((_, i) => applyHeader(ws1.getCell(1, i + 1)));
ws1.getRow(1).height = 30;

const masterByNum = new Map(masterList.pages.map((p) => [p.n, p]));

let row1 = 2;
for (const page of top10.pages) {
  const master = masterByNum.get(page.n);
  const priority = calcPriority(page, master);
  const url = makeUrl(master || page);
  const queries = page.queries || [];
  // queries[0] всегда маркер, потом 9 дополнительных
  const marker = queries[0]?.query || page.marker || "-";
  const ws_freq = queries[0]?.freq_exact ?? page.ws_exact ?? "-";
  const extras = queries.slice(1, 1 + MAX_QUERIES);

  const rowData = [
    page.n,
    url,
    typeRu(page.type),
    page.name,
    "да", // по умолчанию все «да», клиент исправит
    marker,
    ws_freq,
  ];

  for (let i = 0; i < MAX_QUERIES; i++) {
    const q = extras[i];
    rowData.push(q?.query ?? "-", q?.freq_exact ?? "-");
  }

  rowData.push(
    master?.coverage ?? "-",
    PRIO_RU[priority],
    page.type === "info" ? "info" : statusRu(master?.migration_decision),
    page.notes || ""
  );

  ws1.addRow(rowData);
  const r = ws1.getRow(row1);
  r.eachCell((cell) => applyBody(cell, priority));
  r.alignment = { vertical: "top", wrapText: true };
  row1++;
}

// Ширины
ws1.getColumn(1).width = 5;
ws1.getColumn(2).width = 32;
ws1.getColumn(3).width = 14;
ws1.getColumn(4).width = 28;
ws1.getColumn(5).width = 12;
ws1.getColumn(6).width = 28;
ws1.getColumn(7).width = 10;
for (let i = 8; i < 8 + queryHeaders.length; i++) {
  ws1.getColumn(i).width = (i - 8) % 2 === 0 ? 22 : 10;
}
ws1.getColumn(8 + queryHeaders.length).width = 14;
ws1.getColumn(9 + queryHeaders.length).width = 12;
ws1.getColumn(10 + queryHeaders.length).width = 16;
ws1.getColumn(11 + queryHeaders.length).width = 28;

ws1.views = [{ state: "frozen", xSplit: 5, ySplit: 1 }];
ws1.autoFilter = { from: { row: 1, column: 1 }, to: { row: row1 - 1, column: headers1.length } };

// === Лист 2: РЕКОМЕНДАЦИИ ===

const ws2 = workbook.addWorksheet("Рекомендации");
const headers2 = [
  "Запрос",
  "Частотность",
  "Текущая привязка",
  "Рекомендация",
  "У скольких конкурентов отд. страница",
  "Обоснование",
];
ws2.addRow(headers2);
headers2.forEach((_, i) => applyHeader(ws2.getCell(1, i + 1)));

if (!cannibalization.recommendations || cannibalization.recommendations.length === 0) {
  ws2.mergeCells(2, 1, 2, headers2.length);
  ws2.getCell(2, 1).value = "Расширение не требуется - текущая структура покрывает основную семантику.";
  ws2.getCell(2, 1).font = { name: FONT_FAMILY, size: FONT_SIZE, italic: true };
} else {
  let r2 = 2;
  for (const rec of cannibalization.recommendations) {
    ws2.addRow([
      rec.query,
      rec.freq_exact,
      rec.current_attachment,
      rec.recommendation,
      rec.competitors_with_separate_page,
      rec.rationale,
    ]);
    ws2.getRow(r2).eachCell((c) => applyBody(c));
    r2++;
  }
}
ws2.getColumn(1).width = 30;
ws2.getColumn(2).width = 14;
ws2.getColumn(3).width = 30;
ws2.getColumn(4).width = 32;
ws2.getColumn(5).width = 18;
ws2.getColumn(6).width = 40;
ws2.views = [{ state: "frozen", ySplit: 1 }];

// === Лист 3: КОНКУРЕНТЫ ===

const ws3 = workbook.addWorksheet("Конкуренты");
const headers3 = ["Домен", "Тип", "DR", "ТОП-10", "ТОП-50", "Стр. в базе", "Трафик/мес", "Использован для", "Примечания"];
ws3.addRow(headers3);
headers3.forEach((_, i) => applyHeader(ws3.getCell(1, i + 1)));

const leaders = new Set(competitors.leaders_top3 || []);
const directList = competitors.direct || [];
let r3 = 2;
for (const c of directList) {
  const isLeader = leaders.has(c.domain);
  ws3.addRow([
    c.domain,
    c.type || "-",
    c.dr ?? "-",
    c.top10 ?? "-",
    c.top50 ?? "-",
    c.pages_in_base ?? "-",
    c.traffic_month ?? "-",
    "мастер-список + маркеры",
    isLeader ? "⭐ лидер" : (c.notes || ""),
  ]);
  ws3.getRow(r3).eachCell((cell) => applyBody(cell));
  r3++;
}

ws3.getColumn(1).width = 24;
ws3.getColumn(2).width = 14;
ws3.getColumn(3).width = 6;
ws3.getColumn(4).width = 8;
ws3.getColumn(5).width = 8;
ws3.getColumn(6).width = 12;
ws3.getColumn(7).width = 12;
ws3.getColumn(8).width = 24;
ws3.getColumn(9).width = 24;
ws3.views = [{ state: "frozen", ySplit: 1 }];

// === Лист 4: МИГРАЦИЯ ===

const ws4 = workbook.addWorksheet("Миграция");
const headers4 = ["Текущий URL", "ТОП-10", "ТОП-50", "Спарена с (№ из структуры)", "Решение", "Новый URL", "Примечания"];
ws4.addRow(headers4);
headers4.forEach((_, i) => applyHeader(ws4.getCell(1, i + 1)));

if (!masterList.pairing_performed) {
  ws4.mergeCells(2, 1, 2, headers4.length);
  ws4.getCell(2, 1).value = "Миграция не требуется - нет текущего сайта с видимостью.";
  ws4.getCell(2, 1).font = { name: FONT_FAMILY, size: FONT_SIZE, italic: true };
} else {
  let r4 = 2;
  for (const page of masterList.pages) {
    if (!page.client_current_url) continue;
    ws4.addRow([
      page.client_current_url,
      page.client_top10_count ?? "-",
      page.client_top50_count ?? "-",
      page.n,
      decisionRu(page.migration_decision),
      page.migration_target_url ?? "-",
      page.notes || "",
    ]);
    const r = ws4.getRow(r4);
    r.eachCell((cell) => applyBody(cell));
    // Подсветка решения
    const dec = (page.migration_decision || "").toLowerCase();
    if (dec.includes("delete") || dec.includes("удал")) {
      ws4.getCell(r4, 5).font = { name: FONT_FAMILY, size: FONT_SIZE, color: { argb: "FFFF0000" }, bold: true };
    } else if (dec.includes("redirect") || dec === "301") {
      ws4.getCell(r4, 5).font = { name: FONT_FAMILY, size: FONT_SIZE, color: { argb: "FFFF8C00" }, bold: true };
    } else if (dec.includes("discuss") || dec.includes("обсуд")) {
      ws4.getCell(r4, 5).font = { name: FONT_FAMILY, size: FONT_SIZE, color: { argb: "FF9C27B0" }, bold: true };
    }
    r4++;
  }
}
ws4.getColumn(1).width = 30;
ws4.getColumn(2).width = 8;
ws4.getColumn(3).width = 8;
ws4.getColumn(4).width = 20;
ws4.getColumn(5).width = 18;
ws4.getColumn(6).width = 30;
ws4.getColumn(7).width = 28;
ws4.views = [{ state: "frozen", ySplit: 1 }];

// === Сохранение ===

await workbook.xlsx.writeFile(outputPath);

console.log(`[build-structure-xlsx] OK: ${outputPath}`);
console.log(`   Pages on Structure sheet: ${top10.pages.length}`);
console.log(`   Recommendations: ${cannibalization.recommendations?.length || 0}`);
console.log(`   Competitors: ${directList.length}`);
console.log(`   Migration: ${masterList.pairing_performed ? "yes" : "n/a"}`);

// === Локали ===
function typeRu(type) {
  return {
    home: "Главная",
    category: "Категория",
    service: "Услуга",
    product: "Товар",
    article: "Статья",
    info: "Инфо",
    other: "Прочее",
  }[type] || type;
}

function statusRu(migration) {
  if (!migration) return "новая";
  return {
    existing: "существующая",
    redirect_301: "301-редирект",
    delete_410: "к удалению",
    discuss: "обсудить",
    new: "новая",
  }[migration] || migration;
}

function decisionRu(d) {
  return {
    existing: "оставить",
    redirect_301: "301 на новый URL",
    delete_410: "удалить (410)",
    discuss: "обсудить с клиентом",
    new: "новая страница",
  }[d] || d || "-";
}
