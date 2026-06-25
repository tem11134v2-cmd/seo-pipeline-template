#!/usr/bin/env node
// build-articles-xlsx.mjs
// Серийный финал /seo-statya (Block C): сводная таблица метатегов батча статей.
// Читает manifest.json (из export-articles.mjs) и собирает xlsx с подсветкой превышений
// лимитов Title/Description. Палитра согласована с build-metatags-xlsx.mjs (A7).
//
// Использование:
//   node .claude/scripts/build-articles-xlsx.mjs <out_dir>
//     <out_dir> - папка экспорта, где лежит manifest.json (туда же пишется xlsx)
//
// Выход:
//   <out_dir>/Метатеги_<spec>.xlsx  - один лист «Метатеги» + строка-итог
//
// Exit:
//   0 - ок
//   1 - нет manifest.json / битый

import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import ExcelJS from "exceljs";

const TITLE_MAX = 60;
const DESC_MAX = 160;

const dirArg = process.argv[2];
if (!dirArg) {
  console.error("[build-articles-xlsx] usage: node build-articles-xlsx.mjs <out_dir>");
  process.exit(1);
}
const outDir = resolve(dirArg);
const manifestPath = join(outDir, "manifest.json");
if (!existsSync(manifestPath)) {
  console.error(`[build-articles-xlsx] нет manifest.json в ${outDir} (сначала export-articles.mjs)`);
  process.exit(1);
}
let manifest;
try {
  manifest = JSON.parse(readFileSync(manifestPath, "utf8").replace(/^﻿/, ""));
} catch (e) {
  console.error(`[build-articles-xlsx] битый manifest.json: ${e.message}`);
  process.exit(1);
}
const articles = manifest.articles || [];
const specSafe = String(manifest.spec || "batch").replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/,/g, "_");
const outputPath = join(outDir, `Метатеги_${specSafe}.xlsx`);

// === Дизайн-токены (одна палитра с build-metatags-xlsx) ===
const COLORS = {
  header_bg: "FF2F5496",
  header_text: "FFFFFFFF",
  border: "FFD9D9D9",
  over: "FFF8CBAD",     // превышение лимита - красноватый
  near: "FFFFF2CC",     // у предела - жёлтый
  ok_len: "FFE2EFDA",   // в норме - зеленоватый
  missing: "FFF2F2F2",  // нет метатегов - серый
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
function lenFill(len, max) {
  if (len == null) return null;
  if (len > max) return COLORS.over;
  if (len >= max - 5) return COLORS.near;
  return COLORS.ok_len;
}

const workbook = new ExcelJS.Workbook();
workbook.creator = "seo-pipeline /seo-statya (серия)";
workbook.created = new Date();

const ws = workbook.addWorksheet("Метатеги");
const headers = [
  "№", "Тема", "Жанр", "H1",
  "Title", "Title, симв.", "Description", "Описание, симв.", "Анонс",
  "Файл (черновик)", "Google Doc",
];
ws.addRow(headers);
headers.forEach((_, i) => applyHeader(ws.getCell(1, i + 1)));
ws.getRow(1).height = 28;

let r = 2;
let titleOver = 0, descOver = 0, noMeta = 0;
for (const a of articles) {
  const mt = a.metatags || {};
  const h1 = mt.h1 || "";
  const title = mt.title || "";
  const desc = mt.description || "";
  const announce = mt.announce || "";
  const hasMeta = !!(title || desc || announce);
  const tLen = hasMeta ? [...String(title)].length : null;
  const dLen = hasMeta ? [...String(desc)].length : null;
  if (tLen != null && tLen > TITLE_MAX) titleOver++;
  if (dLen != null && dLen > DESC_MAX) descOver++;
  if (!hasMeta) noMeta++;

  ws.addRow([
    a.nnn || "",
    a.topic || "",
    a.genre || "",
    h1,
    title,
    tLen ?? "",
    desc,
    dLen ?? "",
    announce,
    a.exported_html || (a.state !== "completed" ? `(${a.state})` : ""),
    a.gdoc_url || "",
  ]);
  const row = ws.getRow(r);
  row.eachCell((c) => applyBody(c, hasMeta ? null : COLORS.missing));
  // Подсветка длин
  const tFill = lenFill(tLen, TITLE_MAX);
  const dFill = lenFill(dLen, DESC_MAX);
  if (tFill) ws.getCell(r, 6).fill = { type: "pattern", pattern: "solid", fgColor: { argb: tFill } };
  if (dFill) ws.getCell(r, 8).fill = { type: "pattern", pattern: "solid", fgColor: { argb: dFill } };
  if (tLen != null && tLen > TITLE_MAX) ws.getCell(r, 6).font = { name: FONT_FAMILY, size: FONT_SIZE, bold: true, color: { argb: COLORS.warn_text } };
  if (dLen != null && dLen > DESC_MAX) ws.getCell(r, 8).font = { name: FONT_FAMILY, size: FONT_SIZE, bold: true, color: { argb: COLORS.warn_text } };
  r++;
}

ws.getColumn(1).width = 5;
ws.getColumn(2).width = 34;
ws.getColumn(3).width = 16;
ws.getColumn(4).width = 38;
ws.getColumn(5).width = 40;
ws.getColumn(6).width = 11;
ws.getColumn(7).width = 50;
ws.getColumn(8).width = 13;
ws.getColumn(9).width = 50;
ws.getColumn(10).width = 30;
ws.getColumn(11).width = 44;
ws.views = [{ state: "frozen", xSplit: 2, ySplit: 1 }];
ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, r - 1), column: headers.length } };

await workbook.xlsx.writeFile(outputPath);

console.log(`[build-articles-xlsx] OK: ${outputPath}`);
console.log(`   статей: ${articles.length}, без метатегов: ${noMeta}`);
if (titleOver) console.log(`   ⚠ Title > ${TITLE_MAX}: ${titleOver} (подсвечены красным)`);
if (descOver) console.log(`   ⚠ Description > ${DESC_MAX}: ${descOver}`);
process.exit(0);
