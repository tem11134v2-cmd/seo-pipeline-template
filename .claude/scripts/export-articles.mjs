#!/usr/bin/env node
// export-articles.mjs
// Серийный финал /seo-statya (Block C): собирает папку-экспорт батча статей -
// по файлу «NNN - Тема.html» на статью (имена санитайзены под Windows) + manifest.json
// для сводной таблицы метатегов (build-articles-xlsx.mjs).
//
// Источник истины - per-folder meta.json + metatags.json (НЕ _index.json: читаем папки
// напрямую, чтобы не зависеть от свежести кеша).
//
// Использование:
//   node .claude/scripts/export-articles.mjs <articles_root> <out_dir> <spec>
//     <articles_root> - папка articles/ проекта
//     <out_dir>       - куда сложить экспорт (создаётся; обычно на Рабочем столе)
//     <spec>          - "11-20" (диапазон тем) | "11,12,15" (список) | "all" (все completed)
//
// Что копирует: output-NNN.html (Block F) с fallback на output.html / любой output-*.html.
//
// Exit:
//   0 - ок (даже если часть статей не completed - попадут в manifest со state, но без HTML)
//   1 - ошибка ввода (нет articles_root / пустой spec / нет ни одной статьи в диапазоне)

import {
  readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, copyFileSync, statSync,
} from "node:fs";
import { join, resolve, basename } from "node:path";

const [rootArg, outArg, specArg] = process.argv.slice(2);
if (!rootArg || !outArg || !specArg) {
  console.error("[export-articles] usage: node export-articles.mjs <articles_root> <out_dir> <spec>");
  process.exit(1);
}
const articlesRoot = resolve(rootArg);
const outDir = resolve(outArg);

if (!existsSync(articlesRoot)) {
  console.error(`[export-articles] нет папки articles: ${articlesRoot}`);
  process.exit(1);
}

// --- Разбор spec в множество topic_id ---
function parseSpec(spec) {
  const s = String(spec).trim().toLowerCase();
  if (s === "all") return "all";
  const set = new Set();
  for (const part of s.split(",")) {
    const p = part.trim();
    if (!p) continue;
    const range = p.match(/^(\d+)\s*-\s*(\d+)$/);
    if (range) {
      const a = Number(range[1]), b = Number(range[2]);
      const lo = Math.min(a, b), hi = Math.max(a, b);
      for (let n = lo; n <= hi; n++) set.add(n);
    } else if (/^\d+$/.test(p)) {
      set.add(Number(p));
    }
  }
  return set;
}
const want = parseSpec(specArg);
if (want !== "all" && want.size === 0) {
  console.error(`[export-articles] не разобрал spec: «${specArg}» (ожидал «11-20» / «11,12» / «all»)`);
  process.exit(1);
}

// --- Санитайз имени файла под Windows ---
function sanitize(name) {
  return String(name || "")
    .replace(/:/g, " -")          // двоеточие → « -»
    .replace(/[\\/*?"<>|]/g, "")   // запрещённые символы Windows
    .replace(/[\x00-\x1f]/g, "")   // управляющие
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120)                 // не раздувать длину пути
    .replace(/[ .]+$/, "");        // Windows не любит хвостовые точки/пробелы
}

function readJsonSafe(p) {
  try { return JSON.parse(readFileSync(p, "utf8").replace(/^﻿/, "")); } catch { return null; }
}

// --- Найти основной HTML статьи (Block F: output-NNN.html, fallback output.html) ---
function resolveOutputHtml(dir, nnn) {
  const numbered = join(dir, `output-${nnn}.html`);
  if (existsSync(numbered)) return numbered;
  const legacy = join(dir, "output.html");
  if (existsSync(legacy)) return legacy;
  const any = readdirSync(dir).find((f) => /^output-\d+\.html$/i.test(f));
  return any ? join(dir, any) : null;
}

// --- Сбор статей ---
const records = [];
for (const name of readdirSync(articlesRoot)) {
  if (name.startsWith("_") || name.startsWith(".")) continue;
  const dir = join(articlesRoot, name);
  let st;
  try { st = statSync(dir); } catch { continue; }
  if (!st.isDirectory()) continue;
  const meta = readJsonSafe(join(dir, "meta.json"));
  if (!meta) continue;
  const topicId = meta.topic_id ?? null;
  if (want !== "all") {
    if (topicId == null || !want.has(Number(topicId))) continue;
  } else if (meta.state !== "completed") {
    continue; // в режиме "all" берём только готовые
  }
  const nnnMatch = name.match(/^(\d{2,4})-/);
  const nnn = nnnMatch ? nnnMatch[1] : "000";
  records.push({
    key: name,
    nnn,
    topic_id: topicId,
    topic: meta.topic || "",
    slug: meta.slug || "",
    genre: meta.genre || "",
    platform_target: meta.platform_target || "site",
    state: meta.state || "init",
    metatags: readJsonSafe(join(dir, "metatags.json")),
    gdoc_url: meta.share?.docx_url || null,
    _dir: dir,
    _nnn: nnn,
  });
}

if (records.length === 0) {
  console.error(`[export-articles] не нашёл статей под spec «${specArg}» в ${articlesRoot}`);
  process.exit(1);
}

// Сортировка по номеру темы, затем по ключу (стабильно для нескольких статей одной темы)
records.sort((a, b) => {
  const na = Number(a.nnn), nb = Number(b.nnn);
  if (na !== nb) return na - nb;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
});

mkdirSync(outDir, { recursive: true });

// --- Копирование HTML + достройка manifest ---
const manifest = [];
const skipped = [];
const seenNames = new Map(); // защита от коллизии имени (две статьи одной темы)
for (const rec of records) {
  const completed = rec.state === "completed";
  let exportedFile = null;

  if (completed) {
    const htmlPath = resolveOutputHtml(rec._dir, rec._nnn);
    if (htmlPath) {
      const topicForName = sanitize(rec.topic || rec.slug || rec.key);
      let base = `${rec.nnn} - ${topicForName}`;
      // Коллизия (та же тема, другой жанр) - добавить жанр/площадку
      if (seenNames.has(base)) {
        const suffix = sanitize(rec.genre || rec.platform_target || rec.key.slice(-3));
        base = `${base} (${suffix})`;
      }
      seenNames.set(base, true);
      const fileName = `${base}.html`;
      copyFileSync(htmlPath, join(outDir, fileName));
      exportedFile = fileName;
    } else {
      skipped.push(`${rec.nnn} «${rec.topic}» - нет собранного HTML (output-${rec.nnn}.html)`);
    }
  } else {
    skipped.push(`${rec.nnn} «${rec.topic}» - state=${rec.state} (не completed), пропущена`);
  }

  manifest.push({
    nnn: rec.nnn,
    key: rec.key,
    topic_id: rec.topic_id,
    topic: rec.topic,
    genre: rec.genre,
    platform_target: rec.platform_target,
    state: rec.state,
    metatags: rec.metatags,
    gdoc_url: rec.gdoc_url,
    exported_html: exportedFile,
  });
}

writeFileSync(join(outDir, "manifest.json"), JSON.stringify({
  generated_at: new Date().toISOString(),
  spec: specArg,
  out_dir: outDir,
  count: manifest.length,
  exported: manifest.filter((m) => m.exported_html).length,
  articles: manifest,
}, null, 2) + "\n", "utf8");

console.log(`[export-articles] папка: ${outDir}`);
console.log(`  статей в батче: ${manifest.length}, HTML скопировано: ${manifest.filter((m) => m.exported_html).length}`);
if (skipped.length) {
  console.log(`  пропущено (${skipped.length}):`);
  for (const s of skipped) console.log(`    - ${s}`);
}
process.exit(0);
