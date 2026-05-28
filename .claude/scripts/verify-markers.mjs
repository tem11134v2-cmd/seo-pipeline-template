#!/usr/bin/env node
// verify-markers.mjs
// Сверяет число и порядок меток [ТАБЛИЦА:], [ФОТО:], [ДИАГРАММА], [ЦИТАТА],
// [ИКОНКИ:], [ТАБЫ:] между sections/*.md и article.md.
//
// Использование:
//   node .claude/scripts/verify-markers.mjs <article_dir>
//
// Exit codes:
//   0 — метки сохранены
//   2 — потери / расхождения (детали в stderr)
//   1 — ошибка ввода

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const articleDirArg = process.argv[2];
if (!articleDirArg) {
  console.error("[verify-markers] usage: node verify-markers.mjs <article_dir>");
  process.exit(1);
}
const articleDir = resolve(articleDirArg);

const sectionsDir = join(articleDir, "sections");
const articleMdPath = join(articleDir, "article.md");

if (!existsSync(sectionsDir)) {
  console.error(`[verify-markers] нет директории: ${sectionsDir}`);
  process.exit(1);
}
if (!existsSync(articleMdPath)) {
  console.error(`[verify-markers] нет файла: ${articleMdPath}`);
  process.exit(1);
}

const MARKER_RE = /\[(ТАБЛИЦА|ФОТО|ДИАГРАММА|ЦИТАТА|ИКОНКИ|ТАБЫ)(?::\s*([^\]]+))?\]/g;

function collectMarkers(text) {
  const list = [];
  let m;
  MARKER_RE.lastIndex = 0;
  while ((m = MARKER_RE.exec(text)) !== null) {
    list.push({ kind: m[1], body: (m[2] || "").trim() });
  }
  return list;
}

function summarize(list) {
  const by = {};
  for (const it of list) by[it.kind] = (by[it.kind] || 0) + 1;
  return by;
}

// 1. Собрать метки из sections/*.md (в порядке файлов)
const sectionFiles = readdirSync(sectionsDir)
  .filter((f) => /^\d+-.*\.md$/i.test(f))
  .sort();

const sectionMarkers = [];
for (const f of sectionFiles) {
  const text = readFileSync(join(sectionsDir, f), "utf8").replace(/^﻿/, "");
  for (const m of collectMarkers(text)) {
    sectionMarkers.push({ ...m, source: f });
  }
}

// 2. Собрать метки из article.md
const articleText = readFileSync(articleMdPath, "utf8").replace(/^﻿/, "");
const articleMarkers = collectMarkers(articleText);

const before = summarize(sectionMarkers);
const after = summarize(articleMarkers);

// 3. Сравнение
const errors = [];
const allKinds = new Set([...Object.keys(before), ...Object.keys(after)]);
for (const kind of allKinds) {
  const b = before[kind] || 0;
  const a = after[kind] || 0;
  if (b !== a) {
    errors.push(`  ${kind}: в sections/ = ${b}, в article.md = ${a} (расхождение ${a - b})`);
  }
}

// 4. Проверка идентичности тел меток (по порядку)
if (errors.length === 0 && sectionMarkers.length === articleMarkers.length) {
  for (let i = 0; i < sectionMarkers.length; i++) {
    const s = sectionMarkers[i];
    const a = articleMarkers[i];
    if (s.kind !== a.kind || s.body !== a.body) {
      errors.push(
        `  Позиция ${i + 1}: в sections ${s.source} → [${s.kind}${s.body ? ": " + s.body : ""}], ` +
        `в article.md → [${a.kind}${a.body ? ": " + a.body : ""}]`
      );
    }
  }
}

if (errors.length) {
  console.error("[verify-markers] метки в article.md не совпадают с sections/*.md:");
  for (const e of errors) console.error(e);
  console.error("");
  console.error(`Всего в sections/: ${sectionMarkers.length}, в article.md: ${articleMarkers.length}`);
  console.error("Это блокирующий баг финализатора. Перепиши article.md, сохранив все метки 1-в-1.");
  process.exit(2);
}

console.log(`[verify-markers] OK: ${sectionMarkers.length} меток, состав:`, before);
process.exit(0);
