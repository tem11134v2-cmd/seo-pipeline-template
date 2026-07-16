#!/usr/bin/env node
// read-topics-xlsx.mjs
// Читает корневой topics.xlsx (если есть) и возвращает JSON с темами в формате,
// совместимом с topic-generator. Используется скилом /seo-temi для дедупликации:
// передаёт existing_main_queries в промт топик-генератора, чтобы тот не предлагал
// темы, которые уже есть в общем темнике клиента.
//
// Использование:
//   node .claude/scripts/read-topics-xlsx.mjs [project_root]
//
// Вход:  <project_root>/topics.xlsx (опционально - если нет, вернёт пустой массив)
// Выход (stdout, JSON, полный режим - без флагов):
//   {
//     "exists": true|false,
//     "topics_count": N,
//     "topics": [
//       { "n": 1, "topic": "...", "main_query": "...", "ws_freq": 100, ... },
//       ...
//     ]
//   }

import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import ExcelJS from "exceljs";

// CLI: read-topics-xlsx.mjs [project_root] [--by-number N] [--main-only]
//   Без флагов     - вернет все темы (полный дамп; handoff-process - дедуп-merge).
//   --by-number N  - вернёт ОДНУ тему по колонке № (n === N), для /seo-statya.
//   --main-only    - компактный дамп только main_query (для /seo-temi - дедуп
//                    без раздувания контекста полным JSON тем). Если передан вместе
//                    с --by-number, --by-number приоритетнее (он адресный).
const rawArgs = process.argv.slice(2);
let byNumber = null;
let mainOnly = false;
const positional = [];
for (let i = 0; i < rawArgs.length; i++) {
  if (rawArgs[i] === "--by-number") {
    byNumber = Number(rawArgs[i + 1]);
    i++;
  } else if (rawArgs[i] === "--main-only") {
    mainOnly = true;
  } else {
    positional.push(rawArgs[i]);
  }
}
const projectRoot = resolve(positional[0] || process.cwd());
const inputPath = join(projectRoot, "topics.xlsx");

// Унифицированный вывод.
// - --by-number (приоритет над --main-only): находит тему по колонке № (поле n),
//   а не по физической строке xlsx, и возвращает available_numbers для внятной ошибки.
// - --main-only: компактный { exists, count, main_queries } - только непустые main_query.
// - иначе: полный режим как раньше (payload как есть).
function emit(payload) {
  if (byNumber != null) {
    const list = payload.topics || [];
    const topic = list.find((t) => Number(t.n) === byNumber) || null;
    console.log(
      JSON.stringify({
        exists: payload.exists,
        found: !!topic,
        requested: byNumber,
        topic,
        available_numbers: list.map((t) => t.n),
      }),
    );
    return;
  }
  if (mainOnly) {
    const list = payload.topics || [];
    const main_queries = list.map((t) => String(t.main_query || "").trim()).filter(Boolean);
    console.log(
      JSON.stringify({
        exists: payload.exists,
        count: main_queries.length,
        main_queries,
      }),
    );
    return;
  }
  console.log(JSON.stringify(payload));
}

if (!existsSync(inputPath)) {
  emit({ exists: false, topics_count: 0, topics: [] });
  process.exit(0);
}

const workbook = new ExcelJS.Workbook();
await workbook.xlsx.readFile(inputPath);

// Лист 1 - "Темы для статей"
const sheet = workbook.worksheets[0];
if (!sheet) {
  emit({ exists: true, topics_count: 0, topics: [] });
  process.exit(0);
}

// Заголовки в строке 1; данные с строки 2
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

const topics = [];
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
  topics.push({
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

emit({ exists: true, topics_count: topics.length, topics });
