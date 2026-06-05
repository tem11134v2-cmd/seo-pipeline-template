#!/usr/bin/env node
// merge-onpage.mjs
// Сливает шарды onpage_<k>.json (от параллельных audit-onpage) в единый onpage.json
// + считает межстраничные вещи, которых не видит ни один отдельный шард:
// Title-заглушка (>=50% одинаковых Title), кросс-батчевые дубли Title/H1, schema_summary,
// url_structure (из page_plan.json). Часть шага 4 скила /seo-tehaudit.
//
// Использование:
//   node .claude/scripts/merge-onpage.mjs <audit_dir>
// Вход:  <audit_dir>/onpage_*.json (шарды), <audit_dir>/page_plan.json (url_structure, sample_source)
// Выход: <audit_dir>/onpage.json (схема, которую читает audit-writer)

import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const auditDirArg = process.argv[2];
if (!auditDirArg) {
  console.error("[merge-onpage] usage: node merge-onpage.mjs <audit_dir>");
  process.exit(1);
}
const auditDir = resolve(auditDirArg);
const readJson = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8").replace(/^﻿/, "")) : null);

const shardFiles = readdirSync(auditDir)
  .filter((f) => /^onpage_\d+\.json$/.test(f))
  .sort((a, b) => (parseInt(a.match(/\d+/)[0], 10) - parseInt(b.match(/\d+/)[0], 10)));

if (!shardFiles.length) {
  console.error(`[merge-onpage] нет шардов onpage_*.json в ${auditDir}`);
  process.exit(1);
}

const plan = readJson(join(auditDir, "page_plan.json")) || {};
const url_structure = plan.url_structure || { cpu_problems: [], deep_urls: [], long_urls: [], multi_slash: [] };
const sample_source = plan.sample_source || "sitemap";

// ── Собрать шарды ──
const sample = [];
const sampleKeys = new Set();
let problems = [];
let ok_items = [];
let mcp_errors = [];
let favicon = null;

for (const f of shardFiles) {
  const sh = readJson(join(auditDir, f)) || {};
  for (const row of sh.sample || []) {
    const key = String(row.url || "").replace(/\/+$/, "") || "/";
    if (sampleKeys.has(key)) continue;
    sampleKeys.add(key);
    sample.push(row);
  }
  problems = problems.concat(Array.isArray(sh.problems) ? sh.problems : []);
  ok_items = ok_items.concat(Array.isArray(sh.ok_items) ? sh.ok_items : []);
  mcp_errors = mcp_errors.concat(Array.isArray(sh.mcp_errors) ? sh.mcp_errors : []);
  if (favicon === null && (sh.favicon === true || sh.favicon === false)) favicon = sh.favicon;
}

const total = sample.length;
const P = (priority, title, block, details) => ({ priority, title, block, details });

// ── Title-заглушка (>=50% одинаковых непустых Title, при total>=4) ──
const titleCounts = {};
for (const r of sample) {
  const t = (r.title_text || "").trim();
  if (t) titleCounts[t] = (titleCounts[t] || 0) + 1;
}
let title_placeholder = { detected: false, value: "", count: 0, of: total };
let topTitle = "", topCount = 0;
for (const [t, c] of Object.entries(titleCounts)) if (c > topCount) { topTitle = t; topCount = c; }
if (total >= 4 && topCount >= Math.ceil(total * 0.5) && topCount >= 2) {
  title_placeholder = { detected: true, value: topTitle, count: topCount, of: total };
}

// ── schema_summary (по всей выборке) ──
const allSchema = new Set();
for (const r of sample) for (const s of (Array.isArray(r.schema) ? r.schema : [])) allSchema.add(String(s));
let schema_summary = "none";
if ([...allSchema].some((s) => /Product|FAQPage|Review|Service/i.test(s))) schema_summary = "extended";
else if ([...allSchema].some((s) => /Organization|LocalBusiness|Breadcrumb/i.test(s))) schema_summary = "basic";
else schema_summary = allSchema.size ? "basic" : "none";

// ── Агрегатные проблемы ──
const agg = [];
if (title_placeholder.detected) {
  agg.push(P("critical", "Title-заглушка - фатальная ошибка CMS",
    "Мета-теги",
    `Title не генерируется динамически - на ${title_placeholder.count} из ${total} страниц одинаковый Title: "${title_placeholder.value}". Яндекс не определяет релевантность. Приоритет исправления - №1.`));
} else {
  // кросс-батчевые дубли Title (не заглушка)
  for (const [t, c] of Object.entries(titleCounts)) {
    if (c >= 2) {
      const urls = sample.filter((r) => (r.title_text || "").trim() === t).map((r) => r.url);
      agg.push(P("critical", "Дубль Title", "Мета-теги",
        `Одинаковый Title "${t}" на ${c} страницах: ${urls.slice(0, 6).join(", ")}`));
    }
  }
}
// дубли H1
const h1Counts = {};
for (const r of sample) { const h = (r.h1_text || "").trim(); if (h) h1Counts[h] = (h1Counts[h] || 0) + 1; }
for (const [h, c] of Object.entries(h1Counts)) {
  if (c >= 2) {
    const urls = sample.filter((r) => (r.h1_text || "").trim() === h).map((r) => r.url);
    agg.push(P("critical", "Дубль H1", "Мета-теги", `Одинаковый H1 "${h}" на ${c} страницах: ${urls.slice(0, 6).join(", ")}`));
  }
}
// schema
if (schema_summary === "none") agg.push(P("important", "Микроразметка Schema.org отсутствует", "Мета-теги", "На выборке не найдено JSON-LD (Organization, Product, BreadcrumbList)."));
else if (schema_summary === "basic") agg.push(P("nice", "Базовая Schema.org - расширить", "Мета-теги", "Есть базовая разметка; рекомендуется добавить Product/Service/FAQPage."));
// url_structure
const us = url_structure;
if ((us.cpu_problems || []).length) agg.push(P("critical", "Не-ЧПУ URL", "Мета-теги", `${us.cpu_problems.length} URL с не-ЧПУ (спецсимволы/кириллица/КАПС): ${us.cpu_problems.slice(0, 8).join(", ")}`));
if ((us.multi_slash || []).length) agg.push(P("critical", "Множественные слеши в URL", "Мета-теги", `${us.multi_slash.length} URL: ${us.multi_slash.slice(0, 8).join(", ")}`));
if ((us.deep_urls || []).length) agg.push(P("important", "Глубокая вложенность URL (> 3)", "Мета-теги", `${us.deep_urls.length} URL: ${us.deep_urls.slice(0, 8).join(", ")}`));
if ((us.long_urls || []).length) agg.push(P("important", "Длинные URL (> 115 символов)", "Мета-теги", `${us.long_urls.length} URL: ${us.long_urls.slice(0, 8).join(", ")}`));
// favicon
if (favicon === false) agg.push(P("nice", "Favicon не задан", "Мета-теги", "На главной нет <link rel=icon>."));

problems = problems.concat(agg);

// ── Агрегатные ok_items ──
if (!(us.cpu_problems || []).length && !(us.multi_slash || []).length) ok_items.push("ЧПУ корректны, без множественных слешей");
if (!title_placeholder.detected && Object.values(titleCounts).every((c) => c < 2)) ok_items.push("Title уникальны на выборке");
if (schema_summary === "extended") ok_items.push("Schema.org расширенная (Product/Service/FAQ)");
ok_items = [...new Set(ok_items)];

const onpage = {
  sample_source,
  sample,
  title_placeholder,
  url_structure,
  favicon,
  schema_summary,
  problems,
  ok_items,
  mcp_errors,
};

const outPath = join(auditDir, "onpage.json");
writeFileSync(outPath, JSON.stringify(onpage, null, 2), "utf8");
console.log(`[merge-onpage] слито ${shardFiles.length} шард(ов), ${total} страниц; ` +
  `заглушка-${title_placeholder.detected ? "да" : "нет"} schema-${schema_summary} ` +
  `проблем-${problems.length}`);
console.log(`[merge-onpage] wrote ${outPath}`);
