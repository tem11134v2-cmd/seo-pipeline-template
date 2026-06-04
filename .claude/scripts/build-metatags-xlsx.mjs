#!/usr/bin/env node
// build-metatags-xlsx.mjs
// Собирает A7_<slug>.xlsx (3 листа) из результатов writer'ов для /seo-metategi (Фаза 4).
// Палитра и хелперы согласованы с build-structure-xlsx.mjs (A6) - A7 зеркалит A6.
//
// Использование:
//   node .claude/scripts/build-metatags-xlsx.mjs <metatags_dir>
//
// Вход:
//   <metatags_dir>/inputs.json     - slug, domain, region_name, source
//   <metatags_dir>/pages.json      - канонический порядок/url/тип/маркер целевых страниц
//   <metatags_dir>/pages/<n>.json  - метатеги по странице (от metatag-writer)
// Выход:
//   <metatags_dir>/A7_<slug>.xlsx  - 3 листа: Метатеги, Аналитика, Сводка
//
// Exit:
//   0 - ок (даже если часть страниц без файла - пометит «не сгенерирована»)
//   1 - критическая ошибка (нет pages.json/inputs.json)

import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import ExcelJS from "exceljs";

const TITLE_MAX = 60;
const DESC_MAX = 160;

const dirArg = process.argv[2];
if (!dirArg) {
  console.error("[build-metatags-xlsx] usage: node build-metatags-xlsx.mjs <metatags_dir>");
  process.exit(1);
}
const metatagsDir = resolve(dirArg);

function readJson(path) {
  if (!existsSync(path)) {
    console.error(`[build-metatags-xlsx] не найден: ${path}`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(path, "utf8").replace(/^﻿/, ""));
}
function readJsonOptional(path) {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8").replace(/^﻿/, ""));
}

const inputs = readJson(join(metatagsDir, "inputs.json"));
const pagesDoc = readJson(join(metatagsDir, "pages.json"));
const pages = pagesDoc.pages || [];

const slug = (inputs.slug || "metatags").replace(/[<>:"/\\|?*\x00-\x1f]/g, "_");
const outputPath = join(metatagsDir, `A7_${slug}.xlsx`);

// === Дизайн-токены (одна палитра с build-structure-xlsx / A6) ===
const COLORS = {
  header_bg: "FF2F5496",
  header_text: "FFFFFFFF",
  border: "FFD9D9D9",
  over: "FFF8CBAD",     // превышение лимита - красноватый
  near: "FFFFF2CC",     // у предела - жёлтый
  ok_len: "FFE2EFDA",   // в норме - зеленоватый (мягко)
  missing: "FFF2F2F2",  // не сгенерирована - серый
  text: "FF000000",
  warn_text: "FFC00000",
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
function applyBody(cell, fillArgb) {
  cell.font = { name: FONT_FAMILY, size: FONT_SIZE, color: { argb: COLORS.text } };
  if (fillArgb) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fillArgb } };
  cell.border = thinBorder;
  cell.alignment = { vertical: "top", wrapText: true };
}

// Заливка ячейки длины по близости к лимиту.
function lenFill(len, max) {
  if (len == null) return null;
  if (len > max) return COLORS.over;
  if (len >= max - 5) return COLORS.near;
  return COLORS.ok_len;
}

function typeRu(type) {
  return {
    home: "Главная", category: "Категория", subcategory: "Подкатегория",
    service: "Услуга", subservice: "Подуслуга", product: "Товар",
    article: "Статья", info: "Инфо", other: "Прочее",
  }[type] || "Прочее";
}

// Загрузка метатегов по страницам.
function loadPageMeta(n) {
  return readJsonOptional(join(metatagsDir, "pages", `${n}.json`));
}

const workbook = new ExcelJS.Workbook();
workbook.creator = "seo-pipeline /seo-metategi";
workbook.created = new Date();

// ──────────────────────────────────────────────────────────────────────────
// Лист 1: МЕТАТЕГИ (для разработчика/клиента)
// ──────────────────────────────────────────────────────────────────────────
const ws1 = workbook.addWorksheet("Метатеги");
const headers1 = ["№", "Адрес страницы", "Тип", "H1", "Title", "Title, симв.", "Description", "Описание, симв."];
ws1.addRow(headers1);
headers1.forEach((_, i) => applyHeader(ws1.getCell(1, i + 1)));
ws1.getRow(1).height = 28;

let r1 = 2;
let generated = 0;
let titleOver = 0;
let descOver = 0;
const analyticsRows = [];

for (const page of pages) {
  const mt = loadPageMeta(page.n);
  const url = page.url || (mt && mt.url) || "";
  const type = (mt && mt.type) || page.type || "other";

  if (!mt) {
    // Страница не сгенерирована - строка-заглушка серым (видно, что пропущена).
    ws1.addRow([page.n, url, typeRu(type), "(не сгенерирована)", "", "", "", ""]);
    const row = ws1.getRow(r1);
    row.eachCell((c) => applyBody(c, COLORS.missing));
    analyticsRows.push({ page, mt: null });
    r1++;
    continue;
  }
  generated++;

  const h1 = mt.h1 || "";
  const title = mt.title || "";
  const desc = mt.description || "";
  const tLen = [...String(title)].length;
  const dLen = [...String(desc)].length;
  if (tLen > TITLE_MAX) titleOver++;
  if (dLen > DESC_MAX) descOver++;

  ws1.addRow([page.n, url, typeRu(type), h1, title, tLen, desc, dLen]);
  const row = ws1.getRow(r1);
  row.eachCell((c) => applyBody(c));
  // Подсветка ячеек длины
  const tFill = lenFill(tLen, TITLE_MAX);
  const dFill = lenFill(dLen, DESC_MAX);
  if (tFill) ws1.getCell(r1, 6).fill = { type: "pattern", pattern: "solid", fgColor: { argb: tFill } };
  if (dFill) ws1.getCell(r1, 8).fill = { type: "pattern", pattern: "solid", fgColor: { argb: dFill } };
  if (tLen > TITLE_MAX) ws1.getCell(r1, 6).font = { name: FONT_FAMILY, size: FONT_SIZE, bold: true, color: { argb: COLORS.warn_text } };
  if (dLen > DESC_MAX) ws1.getCell(r1, 8).font = { name: FONT_FAMILY, size: FONT_SIZE, bold: true, color: { argb: COLORS.warn_text } };

  analyticsRows.push({ page, mt });
  r1++;
}

ws1.getColumn(1).width = 5;
ws1.getColumn(2).width = 30;
ws1.getColumn(3).width = 13;
ws1.getColumn(4).width = 38;
ws1.getColumn(5).width = 44;
ws1.getColumn(6).width = 11;
ws1.getColumn(7).width = 50;
ws1.getColumn(8).width = 13;
ws1.views = [{ state: "frozen", xSplit: 2, ySplit: 1 }];
ws1.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, r1 - 1), column: headers1.length } };

// ──────────────────────────────────────────────────────────────────────────
// Лист 2: АНАЛИТИКА (для SEO)
// ──────────────────────────────────────────────────────────────────────────
const ws2 = workbook.addWorksheet("Аналитика");
const headers2 = [
  "№", "Адрес страницы", "Маркер исходный", "Форма выбранная",
  "Exact", "Comm", "Geo", "Акварель H1", "Акварель Title", "Медиана", "Паттерн Title", "Глубина", "Заметки",
];
ws2.addRow(headers2);
headers2.forEach((_, i) => applyHeader(ws2.getCell(1, i + 1)));
ws2.getRow(1).height = 28;

let r2 = 2;
for (const { page, mt } of analyticsRows) {
  const a = (mt && mt.analytics) || {};
  const flags = (mt && Array.isArray(mt.flags) ? mt.flags : []);
  const noteParts = [];
  if (mt && mt.notes) noteParts.push(mt.notes);
  if (flags.length) noteParts.push(`[${flags.join(", ")}]`);
  ws2.addRow([
    page.n,
    page.url || (mt && mt.url) || "",
    (mt && mt.marker) || page.marker || "",
    (mt && mt.chosen_form) || "",
    a.exact ?? "-",
    a.comm ?? "-",
    a.geo ?? "-",
    a.aqua_h1 ?? "-",
    a.aqua_title ?? "-",
    a.median ?? "-",
    a.pattern ?? (mt ? "-" : "(не сгенерирована)"),
    a.depth ?? "-",
    noteParts.join(" ") || "",
  ]);
  const row = ws2.getRow(r2);
  row.eachCell((c) => applyBody(c, mt ? null : COLORS.missing));
  r2++;
}
ws2.getColumn(1).width = 5;
ws2.getColumn(2).width = 28;
ws2.getColumn(3).width = 24;
ws2.getColumn(4).width = 26;
ws2.getColumn(5).width = 9;
ws2.getColumn(6).width = 7;
ws2.getColumn(7).width = 6;
ws2.getColumn(8).width = 11;
ws2.getColumn(9).width = 12;
ws2.getColumn(10).width = 9;
ws2.getColumn(11).width = 26;
ws2.getColumn(12).width = 9;
ws2.getColumn(13).width = 36;
ws2.views = [{ state: "frozen", xSplit: 2, ySplit: 1 }];

// ──────────────────────────────────────────────────────────────────────────
// Лист 3: СВОДКА
// ──────────────────────────────────────────────────────────────────────────
const ws3 = workbook.addWorksheet("Сводка");
const depthCounts = {};
for (const { mt } of analyticsRows) {
  if (!mt) continue;
  const d = (mt.analytics && mt.analytics.depth) || "?";
  depthCounts[d] = (depthCounts[d] || 0) + 1;
}
const summaryRows = [
  ["Проект", inputs.slug || "-"],
  ["Домен", inputs.domain || "-"],
  ["Регион", inputs.region_name || "-"],
  ["Источник страниц", pagesDoc.source || inputs.source || "-"],
  ["Страниц в плане", pages.length],
  ["Метатегов сгенерировано", generated],
  ["Не сгенерировано", pages.length - generated],
  ["Глубина", Object.entries(depthCounts).map(([d, c]) => `${d}: ${c}`).join(", ") || "-"],
  ["Title > 60 симв.", titleOver],
  ["Description > 160 симв.", descOver],
  ["Собрано", new Date().toISOString()],
];
let r3 = 1;
for (const [k, v] of summaryRows) {
  ws3.addRow([k, v]);
  ws3.getCell(r3, 1).font = { name: FONT_FAMILY, size: FONT_SIZE, bold: true };
  ws3.getCell(r3, 1).border = thinBorder;
  ws3.getCell(r3, 2).border = thinBorder;
  ws3.getCell(r3, 2).alignment = { wrapText: true };
  r3++;
}
ws3.getColumn(1).width = 28;
ws3.getColumn(2).width = 50;

await workbook.xlsx.writeFile(outputPath);

console.log(`[build-metatags-xlsx] OK: ${outputPath}`);
console.log(`   Страниц в плане: ${pages.length}, метатегов сгенерировано: ${generated}, пропущено: ${pages.length - generated}`);
if (titleOver) console.log(`   ⚠ Title > 60: ${titleOver} (подсвечены красным на листе «Метатеги»)`);
if (descOver) console.log(`   ⚠ Description > 160: ${descOver}`);
process.exit(0);
