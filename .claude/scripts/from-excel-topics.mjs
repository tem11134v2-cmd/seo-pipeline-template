#!/usr/bin/env node
// from-excel-topics.mjs
// Обратное чтение: Topics_<slug>.xlsx -> topics-batch.json.
// Используется скилом /seo-temi --resume, когда пользователь скачал xlsx
// из Drive, внёс правки руками (или клиент внёс в Sheets), положил обратно
// в task-папку и хочет применить эти правки к batch.json.
//
// Использование:
//   node .claude/scripts/from-excel-topics.mjs <task_dir>
//
// Вход:  <task_dir>/Topics_<slug>.xlsx
// Выход: <task_dir>/topics-batch.json (перезапись с merge'ем конкурентов
//        из старого batch.json - они не меняются клиентом)
//
// Логика merge:
//   - topics: полностью берутся из xlsx (это то, что клиент мог отредактировать)
//   - competitors: берутся из xlsx если есть лист "Конкуренты", иначе из старого batch.json
//   - notes/metadata из старого batch.json - сохраняются если xlsx их не перекрывает

import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import ExcelJS from "exceljs";

const taskDir = resolve(process.argv[2] || ".");
const batchPath = join(taskDir, "topics-batch.json");

// Найти Topics_<slug>.xlsx в папке (slug заранее не знаем)
const files = readdirSync(taskDir);
const xlsxFile = files.find((f) => /^Topics_.+\.xlsx$/i.test(f));
if (!xlsxFile) {
  console.error(`[from-excel-topics] не найден Topics_*.xlsx в ${taskDir}`);
  process.exit(1);
}
const xlsxPath = join(taskDir, xlsxFile);

let oldBatch = { topics: [], competitors: [] };
if (existsSync(batchPath)) {
  try {
    oldBatch = JSON.parse(readFileSync(batchPath, "utf8").replace(/^﻿/, ""));
  } catch {}
}

const workbook = new ExcelJS.Workbook();
await workbook.xlsx.readFile(xlsxPath);

function readSheetTopics(sheet) {
  if (!sheet) return [];
  const headerRow = sheet.getRow(1).values;
  const colIndex = {};
  headerRow.forEach((h, i) => {
    if (typeof h !== "string") return;
    const t = h.trim().toLowerCase();
    if (t.includes("№")) colIndex.n = i;
    else if (t.includes("тема статьи")) colIndex.topic = i;
    else if (t.includes("основной запрос")) colIndex.main_query = i;
    else if (t.includes("частотность")) colIndex.ws_freq = i;
    else if (t.includes("интент")) colIndex.intent = i;
    else if (t.includes("жанры")) colIndex.genres = i;
    else if (t.includes("приоритет")) colIndex.priority = i;
    else if (t.includes("сезонность")) colIndex.seasonality = i;
    else if (t.includes("перелинковка")) colIndex.linking_url = i;
    else if (t.includes("примечание")) colIndex.note = i;
  });

  const out = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const get = (key) => {
      const idx = colIndex[key];
      if (!idx) return "";
      const v = row.getCell(idx).value;
      if (v == null) return "";
      if (typeof v === "object" && v.text) return v.text;
      if (typeof v === "object" && v.result != null) return v.result;
      return v;
    };
    const topic = String(get("topic") || "").trim();
    if (!topic) return;
    out.push({
      n: Number(get("n")) || rowNumber - 1,
      topic,
      main_query: String(get("main_query") || "").trim(),
      ws_freq: Number(get("ws_freq")) || 0,
      intent: String(get("intent") || "").trim(),
      genres: String(get("genres") || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      priority: String(get("priority") || "").trim(),
      seasonality: String(get("seasonality") || "").trim(),
      linking_url: String(get("linking_url") || "").trim(),
      note: String(get("note") || "").trim(),
    });
  });
  return out;
}

function readSheetCompetitors(sheet) {
  if (!sheet) return [];
  const headerRow = sheet.getRow(1).values;
  const colIndex = {};
  headerRow.forEach((h, i) => {
    if (typeof h !== "string") return;
    const t = h.trim().toLowerCase();
    if (t.includes("домен")) colIndex.domain = i;
    else if (t.includes("откуда")) colIndex.source = i;
    else if (t.includes("инфо")) colIndex.info_pages = i;
    else if (t.includes("сильные")) colIndex.strengths = i;
    else if (t.includes("примечание")) colIndex.note = i;
  });

  const out = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const get = (key) => {
      const idx = colIndex[key];
      if (!idx) return "";
      const v = row.getCell(idx).value;
      if (v == null) return "";
      if (typeof v === "object" && v.text) return v.text;
      if (typeof v === "object" && v.result != null) return v.result;
      return v;
    };
    const domain = String(get("domain") || "").trim();
    if (!domain) return;
    out.push({
      domain,
      source: String(get("source") || "").trim(),
      info_pages: Number(get("info_pages")) || 0,
      strengths: String(get("strengths") || "").trim(),
      note: String(get("note") || "").trim(),
    });
  });
  return out;
}

const topicsSheet =
  workbook.getWorksheet("Темы для статей") || workbook.worksheets[0];
const compSheet = workbook.getWorksheet("Конкуренты");

const topics = readSheetTopics(topicsSheet);
const competitorsFromXlsx = readSheetCompetitors(compSheet);
const competitors =
  competitorsFromXlsx.length > 0
    ? competitorsFromXlsx
    : oldBatch.competitors || [];

const newBatch = {
  topics,
  competitors,
};

writeFileSync(batchPath, JSON.stringify(newBatch, null, 2), "utf8");
console.log(
  `[from-excel-topics] updated ${batchPath} (topics: ${topics.length}, competitors: ${competitors.length}) from ${xlsxFile}`,
);
