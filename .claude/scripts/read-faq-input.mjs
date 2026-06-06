#!/usr/bin/env node
// read-faq-input.mjs
// Разрешает страницы для /seo-faq: их текущий ТЕКСТ + целевые ЗАПРОСЫ (для JM-анализа пробелов).
//
// Использование:
//   node read-faq-input.mjs <faq_dir> --from-tekst <texts_dir>     (текст из page.json + запросы из pages.json)
//   node read-faq-input.mjs <faq_dir> --from-table <path.csv|tsv>  (url/marker/queries[/text])
//   node read-faq-input.mjs <faq_dir> --url <url> --marker "<маркер>" [--queries "a|b|c"]
//
// Выход: <faq_dir>/pages.json = { source, pages:[{ n, slug, url, marker, queries[], text }] }
//        + создаёт <faq_dir>/pages/<slug>/ под каждую страницу.
// Exit: 0 ok | 2 нет страниц | 1 ошибка.

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
const faqDir = args[0] ? resolve(args[0]) : null;
if (!faqDir) { console.error("[read-faq-input] usage: <faq_dir> --from-tekst|--from-table|--url <src>"); process.exit(1); }
const flag = (n) => { const i = args.indexOf(n); return i !== -1 && args[i + 1] ? args[i + 1] : null; };
const fromTekst = flag("--from-tekst");
const fromTable = flag("--from-table");
const url = flag("--url");
const readJson = (p) => JSON.parse(readFileSync(p, "utf8").replace(/^﻿/, ""));
const slugify = (s) => String(s || "").toLowerCase().replace(/https?:\/\//, "").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "page";

// собрать читаемый текст из блоков page.json
function collectText(obj, acc = []) {
  if (obj == null) return acc;
  if (typeof obj === "string") { if (obj.trim()) acc.push(obj.trim()); return acc; }
  if (Array.isArray(obj)) { for (const v of obj) collectText(v, acc); return acc; }
  if (typeof obj === "object") { for (const v of Object.values(obj)) collectText(v, acc); return acc; }
  return acc;
}

let source = "", pages = [];
try {
  if (fromTekst) {
    source = `tekst:${fromTekst}`;
    const tdir = resolve(fromTekst);
    const pj = join(tdir, "pages.json");
    const queriesBySlug = {};
    if (existsSync(pj)) for (const p of (readJson(pj).pages || [])) queriesBySlug[p.slug] = { marker: p.marker, queries: p.queries || [], url: p.url };
    const pagesDir = join(tdir, "pages");
    if (!existsSync(pagesDir)) { console.error(`[read-faq-input] нет pages/ в ${tdir} (сначала прогони /seo-tekst)`); process.exit(1); }
    for (const d of readdirSync(pagesDir)) {
      const pdir = join(pagesDir, d);
      const pfile = join(pdir, "page.json");
      if (!existsSync(pfile)) continue;
      const page = readJson(pfile);
      const meta = page.page || {};
      const slug = meta.slug || d;
      const text = [page.h1, ...collectText(page.blocks)].filter(Boolean).join("\n");
      const q = queriesBySlug[slug] || {};
      pages.push({ slug, url: meta.url || q.url || "", marker: meta.marker || q.marker || "", queries: q.queries || [], text });
    }
  } else if (fromTable) {
    source = `table:${fromTable}`;
    const raw = readFileSync(resolve(fromTable), "utf8").replace(/^﻿/, "").trim();
    const sep = raw.includes("\t") ? "\t" : raw.includes(";") ? ";" : ",";
    const lines = raw.split(/\r?\n/).filter((l) => l.trim());
    const hasHeader = /url|адрес|маркер|marker|запрос|quer/i.test(lines[0].toLowerCase());
    for (const line of (hasHeader ? lines.slice(1) : lines)) {
      const c = line.split(sep).map((s) => s.trim());
      pages.push({ slug: slugify(c[0] || c[1]), url: c[0] || "", marker: c[1] || "", queries: c[2] ? c[2].split(/[|,]/).map((s) => s.trim()).filter(Boolean) : [], text: c[3] || "" });
    }
  } else if (url) {
    source = `url:${url}`;
    pages.push({ slug: slugify(url), url, marker: flag("--marker") || "", queries: flag("--queries") ? flag("--queries").split(/[|,]/).map((s) => s.trim()).filter(Boolean) : [], text: "" });
  } else {
    console.error("[read-faq-input] не задан источник (--from-tekst | --from-table | --url)");
    process.exit(1);
  }
} catch (e) {
  console.error(`[read-faq-input] ошибка: ${e.message}`); process.exit(1);
}

// нормализация + дедуп + создание папок
const seen = new Set(); const out = []; let n = 0;
for (const p of pages) {
  const key = p.slug + "|" + (p.url || "");
  if (seen.has(key)) continue; seen.add(key);
  n++;
  mkdirSync(join(faqDir, "pages", p.slug), { recursive: true });
  out.push({ n, slug: p.slug, url: p.url || "", marker: p.marker || "", queries: Array.isArray(p.queries) ? p.queries : [], text: p.text || "" });
}
if (out.length === 0) { console.error("[read-faq-input] нет страниц"); process.exit(2); }

writeFileSync(join(faqDir, "pages.json"), JSON.stringify({ source, count: out.length, pages: out }, null, 2), "utf8");
const noText = out.filter((p) => !p.text && !p.url).length;
console.log(`[read-faq-input] pages.json: ${out.length} страниц (источник ${source})`);
if (noText) console.log(`  ! ${noText} без текста и без url - faq-builder не сможет анализировать (дай url или текст)`);
const noQ = out.filter((p) => p.queries.length === 0 && !p.marker).length;
if (noQ) console.log(`  ! ${noQ} без запросов/маркера - JM-анализ будет слабым (дай маркер/запросы)`);
