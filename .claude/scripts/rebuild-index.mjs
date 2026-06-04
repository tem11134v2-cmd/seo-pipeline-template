#!/usr/bin/env node
// rebuild-index.mjs <root>
// Производный кеш реестра задач. Пересобирает <root>/_index.json из <root>/*/meta.json.
//
// Зачем (ADR-013): источник истины - per-folder meta.json (конфликтовать при merge не может).
// _index.json - gitignored локальный кеш, НИКОГДА не коммитится => ноль merge-конфликтов
// при параллельной работе двух worktree. Любой читатель индекса сначала пересобирает его
// этим скриптом, затем читает (в свежей worktree файла может не быть - он не в git).
//
// Использование:
//   node .claude/scripts/rebuild-index.mjs articles
//   node .claude/scripts/rebuild-index.mjs /abs/path/to/articles

import {
  readFileSync,
  writeFileSync,
  existsSync,
  readdirSync,
  statSync,
} from "node:fs";
import { join, resolve, basename } from "node:path";

const rootArg = process.argv[2];
if (!rootArg) {
  console.error(
    "[rebuild-index] usage: node rebuild-index.mjs <root>  (напр. articles)",
  );
  process.exit(1);
}
const root = resolve(rootArg);
const indexPath = join(root, "_index.json");
const now = new Date().toISOString();

if (!existsSync(root)) {
  // Папки ещё нет - индексировать нечего, выходим без ошибки.
  console.log(`[rebuild-index] ${root} не существует - индекс не нужен`);
  process.exit(0);
}

const records = [];
for (const name of readdirSync(root)) {
  if (name.startsWith("_") || name.startsWith(".")) continue;
  const dir = join(root, name);
  let st;
  try {
    st = statSync(dir);
  } catch {
    continue;
  }
  if (!st.isDirectory()) continue;
  const metaPath = join(dir, "meta.json");
  if (!existsSync(metaPath)) continue;
  let meta;
  try {
    meta = JSON.parse(readFileSync(metaPath, "utf8").replace(/^﻿/, ""));
  } catch (e) {
    console.warn(`[rebuild-index] ${name}/meta.json не распарсился: ${e.message}`);
    continue;
  }
  const nnnMatch = name.match(/^(\d{2,4})-/);
  records.push({
    key: name, // полный basename папки - единственный уникальный ключ записи
    nnn: nnnMatch ? nnnMatch[1] : null,
    topic_id: meta.topic_id ?? null,
    slug: meta.slug || "",
    topic: meta.topic || "",
    genre: meta.genre || "",
    platform_target: meta.platform_target || "site",
    state: meta.state || "init",
    mode: meta.mode || "auto",
    started: meta.started || null,
    completed_at:
      meta.state === "completed" ? meta.updated || null : null,
    share_url: meta.share?.docx_url || null,
    updated: meta.updated || null,
  });
}

records.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
const index = { version: 2, derived: true, updated: now, articles: records };
writeFileSync(indexPath, JSON.stringify(index, null, 2) + "\n", "utf8");
console.log(
  `[rebuild-index] ${basename(root)}/_index.json: ${records.length} записей (derived из meta.json)`,
);
