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

// ── Пороги on-page проверок (ЕДИНЫЙ ИСТОЧНИК ИСТИНЫ) ─────────────────────────
// Раньше эти числа жили ТОЛЬКО в промпте audit-onpage.md - агент-шард (sonnet) мог
// сместить/забыть порог, и машинного энфорса не было. Теперь пороги - здесь, а
// merge-onpage ПЕРЕСЧИТЫВАЕТ per-page вердикты сам из сырых title_len/desc_len/
// h1_count/булевых полей (не доверяя вердикту агента).
//
// ПОЧЕМУ 80/200, а НЕ 60/160 (лимиты генерации своих метатегов в /seo-metategi):
//   Техаудит оценивает ЧУЖОЙ, уже существующий сайт - порог сознательно МЯГЧЕ.
//   Title 80 / Description 200 - это «длинновато, подрежется в сниппете», а не
//   ошибка. При ГЕНЕРАЦИИ своих метатегов (/seo-metategi) мы пишем с нуля и обязаны
//   попасть в сниппет, поэтому лимиты жёстче (Title 60, Description 160). Дрейф
//   80/200 vs 60/160 - НЕ баг, это две разные задачи (аудит чужого мягче генерации
//   своего). Решение стратега Этапа 4.
const TH = {
  TITLE_MAX: 80,   // title_len > 80 -> 🟡 Title слишком длинный
  DESC_MAX: 200,   // desc_len  > 200 -> 🟡 Description слишком длинный
  H1_MAX: 1,       // h1_count  > 1  -> 🔴 Несколько H1 (h1_count == 0 -> 🔴 Нет H1)
  // URL-пороги (вложенность > 3, длина > 115, ЧПУ, мультислеш) считает
  // select-audit-pages.mjs -> page_plan.url_structure. Здесь НЕ дублируются.
};

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
// ПРИМЕЧАНИЕ: shard.problems (per-page вердикты по числовым порогам) больше НЕ
// конкатенируется - merge-onpage теперь единственный владелец Мета-теги-проблем,
// он их пересчитывает сам из сырых полей sample[] (см. perPageProblems ниже).
// Агенту оставлено право на нештатные находки вне числовых порогов - в отдельном
// поле extra_findings (НЕ problems); merge переносит их с дедупликацией против
// пересчитанных (см. ниже, после perPageProblems).
const sample = [];
const sampleKeys = new Set();
let problems = [];
let ok_items = [];
let mcp_errors = [];
let extra_findings = [];
let favicon = null;

for (const f of shardFiles) {
  const sh = readJson(join(auditDir, f)) || {};
  for (const row of sh.sample || []) {
    const key = String(row.url || "").replace(/\/+$/, "") || "/";
    if (sampleKeys.has(key)) continue;
    sampleKeys.add(key);
    sample.push(row);
  }
  ok_items = ok_items.concat(Array.isArray(sh.ok_items) ? sh.ok_items : []);
  mcp_errors = mcp_errors.concat(Array.isArray(sh.mcp_errors) ? sh.mcp_errors : []);
  extra_findings = extra_findings.concat(Array.isArray(sh.extra_findings) ? sh.extra_findings : []);
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

// Нормализация URL для сравнения canonical (снять хвостовой слеш)
const normUrl = (u) => String(u || "").replace(/#.*$/, "").replace(/\/+$/, "") || "/";
// Нормализация заголовка находки для дедупа extra_findings против пересчитанных problems
// (агент и merge могут по-разному оформить регистр/тире/пробелы - сравниваем по смыслу, не байт-в-байт).
const normFindingTitle = (s) => String(s ?? "")
  .replace(/[—–]/g, "-").replace(/ё/g, "е").replace(/Ё/g, "Е")
  .replace(/\s+/g, " ").trim().toLowerCase();

// ── Пер-страничные вердикты (пересчёт по TH из сырых полей sample[]) ──
// Возвращает { problems, keys } - keys нужен для дедупа extra_findings агента (ниже):
// если агент независимо нашел ту же проблему (тот же url + тот же смысл заголовка),
// которую merge и так пересчитал по числовым порогам - не задваивать эту находку в отчете.
// Как side-effect проставляет row.issues на каждой строке sample[] (backward-compat
// для audit-writer - раньше issues заполнял агент, теперь merge).
function perPageProblems(rows) {
  const out = [];
  const keys = new Set();
  const PP = (priority, title, url, extra = "") => {
    keys.add(`${normUrl(url)}::${normFindingTitle(title)}`);
    return { priority, title, block: "Мета-теги", details: url + (extra ? ` - ${extra}` : "") };
  };
  for (const r of rows) {
    const tags = [];
    const url = r.url || "/";
    const titleLen = Number.isFinite(r.title_len) ? r.title_len : (r.title_text || "").length;
    const descLen  = Number.isFinite(r.desc_len)  ? r.desc_len  : (r.desc_text  || "").length;
    const h1c      = Number.isFinite(r.h1_count)  ? r.h1_count  : null;

    if (titleLen === 0)        { out.push(PP("critical", "Title не заполнен", url)); tags.push("нет Title"); }
    else if (titleLen > TH.TITLE_MAX) { out.push(PP("important", "Title слишком длинный", url, `${titleLen} символов`)); tags.push("Title длинный"); }

    if (h1c === 0)             { out.push(PP("critical", "Нет H1", url)); tags.push("нет H1"); }
    else if (h1c !== null && h1c > TH.H1_MAX) { out.push(PP("critical", "Несколько H1 на странице", url, `${h1c} шт.`)); tags.push("несколько H1"); }

    if (descLen === 0)         { out.push(PP("critical", "Description не заполнен", url)); tags.push("нет Description"); }
    else if (descLen > TH.DESC_MAX) { out.push(PP("important", "Description слишком длинный", url, `${descLen} символов`)); tags.push("Description длинный"); }

    if (r.noindex === true)    { out.push(PP("critical", "Страница закрыта от индексации через noindex", url)); tags.push("noindex"); }

    if (r.canonical && normUrl(r.canonical) !== normUrl(url)) {
      out.push(PP("important", "Canonical ведёт на другой URL - убедиться что намеренно", url, `canonical=${r.canonical}`));
      tags.push("canonical на другой URL");
    }

    const isHome = (r.type === "Главная") || normUrl(url) === "/";
    if (r.has_breadcrumbs === false && !isHome) { out.push(PP("important", "Хлебные крошки отсутствуют", url)); tags.push("нет крошек"); }

    if (r.content_on_js === true || r.has_content === false) {
      out.push(PP("critical", "Контент вероятно подгружается через JavaScript - Яндекс может не видеть содержимое", url, "проверить сохранённую копию, рассмотреть SSR/пререндеринг"));
      tags.push("контент на JS");
    }

    r.issues = tags.length ? tags.join(", ") : "-";
  }
  return { problems: out, keys };
}

const { problems: perPage, keys: perPageKeys } = perPageProblems(sample);

// ── Агрегатные проблемы (кросс-страничные - Title-заглушка/дубли/schema/url_structure/favicon) ──
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

// ── extra_findings агента: нештатные находки вне числовых порогов (см. TH) ──
// Агент НЕ ставит числовые вердикты (Title/H1/Description/noindex/canonical/крошки/JS -
// это perPage выше), но имеет право зафиксировать нештатную находку в extra_findings.
// Дедуп против perPage: если агент независимо нашел то же самое (тот же url + тот же
// смысл заголовка), которое merge и так пересчитал - не задваивать в отчете.
const extraDeduped = extra_findings
  .filter((f) => f && f.title)
  .filter((f) => !f.url || !perPageKeys.has(`${normUrl(f.url)}::${normFindingTitle(f.title)}`))
  .map((f) => ({
    priority: f.priority || "important",
    title: f.title,
    block: f.block || "Мета-теги",
    // Формат details как у пересчитанных perPage-проблем - url первым, чтобы находку
    // можно было привязать к конкретной странице (греп по url в отчете).
    details: f.url ? (f.details ? `${f.url} - ${f.details}` : f.url) : (f.details || ""),
  }));

// merge - единственный владелец Мета-теги-проблем: пересчитанные per-page (perPage) +
// кросс-страничные (agg) + нештатные находки агента, прошедшие дедуп (extraDeduped).
problems = perPage.concat(agg).concat(extraDeduped);

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
