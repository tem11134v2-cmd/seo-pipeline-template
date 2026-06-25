#!/usr/bin/env node
// update-index.mjs
// Обновляет articles/_index.json — реестр всех статей проекта.
// Вызывается из update-meta.sh после каждого обновления meta.json (best-effort).
//
// Использование:
//   node .claude/scripts/update-index.mjs <article_dir>
//
// Поведение:
//   - Читает <article_dir>/meta.json
//   - Находит / создаёт запись в articles/_index.json
//   - Обновляет state, updated, completed_at (если state == "completed")
//   - При первом upsert ставит started
//
// Структура _index.json:
// {
//   "version": 1,
//   "updated": "<ISO UTC>",
//   "articles": [
//     {
//       "nnn": "001",
//       "topic_id": 1,
//       "slug": "...",
//       "topic": "...",
//       "genre": "Гайд",
//       "platform_target": "site",
//       "state": "completed",
//       "mode": "auto",
//       "started": "...",
//       "completed_at": "...",
//       "share_url": null
//     }
//   ]
// }

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve, basename, dirname } from "node:path";

const articleDirArg = process.argv[2];
if (!articleDirArg) {
  console.error("[update-index] usage: node update-index.mjs <article_dir>");
  process.exit(1);
}
const articleDir = resolve(articleDirArg);
const articlesRoot = dirname(articleDir);
const indexPath = join(articlesRoot, "_index.json");

const metaPath = join(articleDir, "meta.json");
if (!existsSync(metaPath)) {
  // Нет meta — нечего индексировать
  process.exit(0);
}

const meta = JSON.parse(readFileSync(metaPath, "utf8").replace(/^﻿/, ""));

// Block A: машиночитаемые метатеги (если финализатор записал metatags.json).
// Тянем в индекс, чтобы батч-сводка серии собиралась из одного места без парсинга прозы.
let metatags = null;
const mtPath = join(articleDir, "metatags.json");
if (existsSync(mtPath)) {
  try {
    metatags = JSON.parse(readFileSync(mtPath, "utf8").replace(/^﻿/, ""));
  } catch (e) {
    console.warn(`[update-index] metatags.json повреждён: ${e.message}`);
  }
}

// nnn выводим из имени папки (001-foo → "001")
const dirName = basename(articleDir);
const nnnMatch = dirName.match(/^(\d{2,4})-/);
if (!nnnMatch) {
  console.error(`[update-index] не удалось извлечь NNN из ${dirName}`);
  process.exit(0);
}
const nnn = nnnMatch[1];

const now = new Date().toISOString();

let index = { version: 2, derived: true, updated: now, articles: [] };
if (existsSync(indexPath)) {
  try {
    index = JSON.parse(readFileSync(indexPath, "utf8").replace(/^﻿/, ""));
  } catch (e) {
    console.warn(`[update-index] _index.json повреждён, пересоздаю: ${e.message}`);
    index = { version: 2, derived: true, updated: now, articles: [] };
  }
}

// Запись по полному basename папки (key) - уникальный идентификатор.
// NNN (= topic_id) после точки 2 НЕ уникален: у одной темы может быть
// несколько статей (разные жанры/площадки), все с префиксом <TTT>-.
let rec = index.articles.find((a) => a.key === dirName);
if (!rec) {
  rec = {
    key: dirName,
    nnn,
    topic_id: meta.topic_id ?? null,
    slug: meta.slug || dirName.slice(nnn.length + 1),
    topic: meta.topic || "",
    genre: meta.genre || "",
    platform_target: meta.platform_target || "site",
    state: meta.state || "init",
    mode: meta.mode || "auto",
    started: meta.started || now,
    completed_at: null,
    share_url: null,
    metatags: metatags,
    updated: meta.updated || now,
  };
  index.articles.push(rec);
} else {
  // Обновляем только полезные поля
  rec.state = meta.state || rec.state;
  rec.mode = meta.mode || rec.mode;
  rec.topic = meta.topic || rec.topic;
  rec.genre = meta.genre || rec.genre;
  rec.platform_target = meta.platform_target || rec.platform_target;
  rec.topic_id = meta.topic_id ?? rec.topic_id;
  if (metatags) rec.metatags = metatags;
  rec.updated = meta.updated || now;
}

if (meta.state === "completed" && !rec.completed_at) {
  rec.completed_at = meta.updated || now;
}
if (meta.share?.docx_url) {
  rec.share_url = meta.share.docx_url;
}

index.updated = now;

// Сортируем по key (полный basename) для предсказуемости
index.articles.sort((a, b) => a.key.localeCompare(b.key));

mkdirSync(dirname(indexPath), { recursive: true });
writeFileSync(indexPath, JSON.stringify(index, null, 2) + "\n", "utf8");

console.log(`[update-index] ${nnn} → state=${rec.state} (всего записей: ${index.articles.length})`);
