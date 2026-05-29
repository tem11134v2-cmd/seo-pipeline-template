#!/usr/bin/env node
// topics-to-excel.mjs
// Конвертирует topics-batch.json в Topics_<slug>.xlsx внутри task-папки topics/NNN-<slug>/.
// Используется скилом /new-topics после сбора батча и подтверждения пользователем.
// Файл затем загружается в Google Drive (см. шаг 7 /new-topics).
//
// Использование:
//   node .claude/scripts/topics-to-excel.mjs <task_dir>
//
// Вход:  <task_dir>/topics-batch.json
// Выход: <task_dir>/Topics_<slug>.xlsx
//
// Slug берётся из meta.json (поле slug). Если meta.json нет - из имени папки
// после первого "-" (например topics/001-spring-batch/ -> slug = "spring-batch").

import { readFileSync, existsSync } from "node:fs";
import { join, resolve, basename } from "node:path";
import ExcelJS from "exceljs";

const taskDir = resolve(process.argv[2] || ".");
const batchPath = join(taskDir, "topics-batch.json");
const metaPath = join(taskDir, "meta.json");

if (!existsSync(batchPath)) {
  console.error(`[topics-to-excel] not found: ${batchPath}`);
  process.exit(1);
}

let slug = "";
if (existsSync(metaPath)) {
  try {
    const meta = JSON.parse(readFileSync(metaPath, "utf8").replace(/^﻿/, ""));
    slug = meta.slug || "";
  } catch {}
}
if (!slug) {
  const folder = basename(taskDir);
  const dash = folder.indexOf("-");
  slug = dash >= 0 ? folder.slice(dash + 1) : folder;
}
if (!slug) slug = "batch";

const outputPath = join(taskDir, `Topics_${slug}.xlsx`);

const data = JSON.parse(readFileSync(batchPath, "utf8").replace(/^﻿/, ""));
const topics = Array.isArray(data.topics) ? [...data.topics] : [];
const competitors = Array.isArray(data.competitors) ? data.competitors : [];

// Сортировка: высокий приоритет сверху, внутри - частотность убыванием.
const priorityRank = { "Высокий": 0, "Средний": 1, "Низкий": 2 };
topics.sort((a, b) => {
  const pa = priorityRank[a.priority] ?? 9;
  const pb = priorityRank[b.priority] ?? 9;
  if (pa !== pb) return pa - pb;
  return (b.ws_freq || 0) - (a.ws_freq || 0);
});

const workbook = new ExcelJS.Workbook();
workbook.creator = "seo-pipeline";
workbook.created = new Date();

// Лист 1: Темы для статей
const sheetTopics = workbook.addWorksheet("Темы для статей");
sheetTopics.columns = [
  { header: "№", key: "n", width: 6 },
  { header: "Тема статьи", key: "topic", width: 50 },
  { header: "Основной запрос", key: "main_query", width: 30 },
  { header: "Частотность WS", key: "ws_freq", width: 14 },
  { header: "Интент", key: "intent", width: 24 },
  { header: "Жанры (2-3)", key: "genres", width: 30 },
  { header: "Приоритет", key: "priority", width: 12 },
  { header: "Сезонность", key: "seasonality", width: 18 },
  { header: "Перелинковка на", key: "linking_url", width: 30 },
  { header: "Примечание", key: "note", width: 40 },
];

topics.forEach((t, i) => {
  sheetTopics.addRow({
    n: i + 1,
    topic: t.topic ?? "",
    main_query: t.main_query ?? "",
    ws_freq: t.ws_freq ?? "",
    intent: t.intent ?? "",
    genres: Array.isArray(t.genres) ? t.genres.join(", ") : (t.genres ?? ""),
    priority: t.priority ?? "",
    seasonality: t.seasonality ?? "",
    linking_url: t.linking_url ?? "",
    note: t.note ?? "",
  });
});

sheetTopics.getRow(1).font = { bold: true };
sheetTopics.getRow(1).alignment = { vertical: "middle", horizontal: "center" };
sheetTopics.views = [{ state: "frozen", ySplit: 1 }];

// Лист 2: Конкуренты
const sheetComp = workbook.addWorksheet("Конкуренты");
sheetComp.columns = [
  { header: "Домен", key: "domain", width: 30 },
  { header: "Откуда нашли", key: "source", width: 24 },
  { header: "Инфо-страниц (оценка)", key: "info_pages", width: 22 },
  { header: "Сильные стороны", key: "strengths", width: 40 },
  { header: "Примечание", key: "note", width: 40 },
];

competitors.forEach((c) => {
  sheetComp.addRow({
    domain: c.domain ?? "",
    source: c.source ?? "",
    info_pages: c.info_pages ?? "",
    strengths: c.strengths ?? "",
    note: c.note ?? "",
  });
});

sheetComp.getRow(1).font = { bold: true };
sheetComp.getRow(1).alignment = { vertical: "middle", horizontal: "center" };
sheetComp.views = [{ state: "frozen", ySplit: 1 }];

await workbook.xlsx.writeFile(outputPath);
console.log(
  `[topics-to-excel] wrote ${outputPath} (topics: ${topics.length}, competitors: ${competitors.length})`,
);
