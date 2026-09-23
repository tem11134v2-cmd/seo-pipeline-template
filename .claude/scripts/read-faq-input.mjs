#!/usr/bin/env node
// read-faq-input.mjs
// Разрешает страницы для /seo-faq: их текущий ТЕКСТ + целевые ЗАПРОСЫ (для JM-анализа пробелов).
//
// Использование:
//   node read-faq-input.mjs <faq_dir> --from-tekst <texts_dir|NNN>  (v7: текст из page.json + запросы из pages.json;
//                                                                   v9 /site-tekst: см. ниже; NNN ищется как texts/NNN-*)
//   node read-faq-input.mjs <faq_dir> --from-table <path.csv|tsv>  (url/marker/queries[/text])
//   node read-faq-input.mjs <faq_dir> --url <url> --marker "<маркер>" [--queries "a|b|c"]
//
// Выход: <faq_dir>/pages.json = { source, pages:[{ n, slug, url, marker, queries[], text }] }
//        + создаёт <faq_dir>/pages/<slug>/ под каждую страницу.
// Задача v9 (texts/NNN/meta.json -> format "v9", скил /site-tekst): страницы - work/sitemap.json (кроме status skip),
//   текст - work/pages/<slug>/page.md без служебных строк (шапка, заголовки блоков, «_факты: ..._»), только написанные;
//   url - url карты от config/project.json -> site_url; маркер и запросы - source_queries (иначе source_h1).
//   В pages.json добавляется поле tekst: путь к фактам (work/facts.json), бренд (facts.company.brand | config.company),
//   регион (config.niche.geo), запреты (terminology.use[].not + jargon[].internal -> forbidden_wordings,
//   anti_promises[].text -> anti_promises), стоп-домены (config.competitors.aggregators_stoplist).
//   Эти поля дописываются в <faq_dir>/inputs.json, если там их нет (уже заданное не перетирается).
// Exit: 0 ok | 2 нет страниц | 1 ошибка.

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join, resolve, relative } from "node:path";

const args = process.argv.slice(2);
const faqDir = args[0] ? resolve(args[0]) : null;
if (!faqDir) { console.error("[read-faq-input] usage: <faq_dir> --from-tekst|--from-table|--url <src>"); process.exit(1); }
const flag = (n) => { const i = args.indexOf(n); return i !== -1 && args[i + 1] ? args[i + 1] : null; };
const fromTekst = flag("--from-tekst");
const fromTable = flag("--from-table");
const url = flag("--url");
const readJson = (p) => JSON.parse(readFileSync(p, "utf8").replace(/^﻿/, ""));
const readJsonSafe = (p) => { try { return readJson(p); } catch { return null; } };
const relRoot = (p) => relative(process.cwd(), p).split(/[\\/]+/).join("/");

// --from-tekst: путь к папке задачи или номер NNN (texts/NNN-* от корня проекта)
function resolveTekst(ref) {
  const direct = resolve(ref);
  if (existsSync(direct) || !/^\d+$/.test(ref)) return direct;
  const base = resolve("texts");
  const hits = existsSync(base) ? readdirSync(base).filter((d) => /^\d+-/.test(d) && Number(d.match(/^(\d+)-/)[1]) === Number(ref)) : [];
  if (hits.length !== 1) { console.error(`[read-faq-input] texts/${ref}-*: ${hits.length ? "папок несколько - укажи путь" : "нет такой задачи"}`); process.exit(1); }
  return join(base, hits[0]);
}

// page.md задачи v9 (render-md.mjs kit /site-tekst) -> чистый текст: без шапки страницы, заголовков блоков и служебных строк
function mdToText(md) {
  const lines = md.replace(/\r/g, "").split("\n");
  const first = lines.indexOf("---");
  const out = [];
  for (let l of (first >= 0 ? lines.slice(first) : lines)) {
    if (l === "---" || /^## B\d+\S* · .* · роль /.test(l) || /^_(факты: .*|блок еще не написан)_$/.test(l) || /^\[(картинка|поле формы): .*\]$/.test(l)) continue;
    l = l.replace(/^#{1,6}\s+/, "").replace(/^>\s?(- )?/, "").replace(/^\s*- /, "")
      .replace(/\*\*\[ (.*?) \]\*\*/g, "$1").replace(/\*\*(.*?)\*\*/g, "$1").replace(/^\*(.*)\*$/, "$1")
      .replace(/`([^`]*)`/g, "$1").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/^\|\s*|\s*\|$/g, "").replace(/^Шаг: /, "").trim();
    if (l) out.push(l);
  }
  return out.join("\n");
}

// Задача v9: страницы из sitemap + page.md, данные для inputs.json из config/project.json и work/facts.json
function readTekstV9(tdir) {
  const sm = readJsonSafe(join(tdir, "work", "sitemap.json"));
  if (!sm) { console.error(`[read-faq-input] нет work/sitemap.json в ${tdir} (сначала /site-tekst)`); process.exit(1); }
  const cfg = readJsonSafe(join(tdir, "config", "project.json")) || {};
  const facts = readJsonSafe(join(tdir, "work", "facts.json")) || {};
  let origin = "", domain = "";
  try { const u = new URL(cfg.site_url); origin = u.origin; domain = u.hostname; } catch { /* site_url пуст - url остаются путями */ }
  const out = []; let unwritten = 0;
  for (const p of sm.pages || []) {
    if (p.status === "skip") continue;
    const md = join(tdir, "work", "pages", p.slug, "page.md");
    if (!existsSync(md)) { unwritten++; continue; }
    const u = String(p.url || "");
    const url = /^https?:\/\//.test(u) ? u : origin && u ? origin + (u.startsWith("/") ? u : "/" + u) : u;
    const queries = Array.isArray(p.source_queries) ? p.source_queries.filter(Boolean) : [];
    out.push({ slug: p.slug, url, marker: queries[0] || p.source_h1 || p.subject || "", queries, text: mdToText(readFileSync(md, "utf8")) });
  }
  const term = facts.terminology || {};
  const uniq = (a) => [...new Set(a.map((x) => String(x || "").trim()).filter(Boolean))];
  const tekst = {
    format: "v9", dir: relRoot(tdir),
    facts_path: existsSync(join(tdir, "work", "facts.json")) ? relRoot(join(tdir, "work", "facts.json")) : "",
    slug: cfg.slug || "", company: cfg.company || "", domain,
    brand_name: (facts.company && facts.company.brand) || cfg.company || "",
    region_name: (cfg.niche && cfg.niche.geo) || "",
    forbidden_wordings: uniq([...(term.use || []).map((t) => t.not), ...(term.jargon || []).map((t) => t.internal)]),
    anti_promises: uniq((facts.anti_promises || []).map((x) => x.text)),
    stop_domains: uniq((cfg.competitors && cfg.competitors.aggregators_stoplist) || []),
  };
  return { pages: out, tekst, unwritten };
}
let tekstInfo = null, unwrittenV9 = 0;
const TRANSLIT = { а:"a",б:"b",в:"v",г:"g",д:"d",е:"e",ё:"e",ж:"zh",з:"z",и:"i",й:"y",к:"k",л:"l",м:"m",н:"n",о:"o",п:"p",р:"r",с:"s",т:"t",у:"u",ф:"f",х:"h",ц:"c",ч:"ch",ш:"sh",щ:"sch",ъ:"",ы:"y",ь:"",э:"e",ю:"yu",я:"ya" };
const translit = (s) => String(s || "").toLowerCase().replace(/[а-яё]/g, (c) => (c in TRANSLIT ? TRANSLIT[c] : c));
// slug -> ТОЛЬКО латиница (см. CLAUDE.md: кириллица в путях ломает git/скрипты)
const slugify = (s) => translit(String(s || "")).replace(/https?:\/\//, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "page";

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
    const tdir = resolveTekst(fromTekst);
    const tmeta = readJsonSafe(join(tdir, "meta.json")) || {};
    if (tmeta.format === "v9") {
      const v9 = readTekstV9(tdir);
      pages = v9.pages; tekstInfo = v9.tekst; unwrittenV9 = v9.unwritten;
    } else {
    const pj = join(tdir, "pages.json");
    const queriesBySlug = {};
    if (existsSync(pj)) for (const p of (readJson(pj).pages || [])) queriesBySlug[p.slug] = { marker: p.marker, queries: p.queries || [], url: p.url };
    const pagesDir = join(tdir, "pages");
    if (!existsSync(pagesDir)) { console.error(`[read-faq-input] нет pages/ в ${tdir}: задача v7 без написанных страниц, FAQ собирать не из чего`); process.exit(1); }
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

writeFileSync(join(faqDir, "pages.json"), JSON.stringify({ source, count: out.length, ...(tekstInfo ? { tekst: tekstInfo } : {}), pages: out }, null, 2), "utf8");
// v9: бренд, регион, запреты, путь к фактам - в inputs.json, только если там их нет (заданное оркестратором не перетираем)
if (tekstInfo) {
  const ip = join(faqDir, "inputs.json");
  const inputs = readJsonSafe(ip) || {};
  const empty = (v) => v == null || v === "" || (Array.isArray(v) && v.length === 0);
  const add = [];
  const fields = { slug: tekstInfo.slug, company: tekstInfo.company, domain: tekstInfo.domain, brand_name: tekstInfo.brand_name, region_name: tekstInfo.region_name, forbidden_wordings: tekstInfo.forbidden_wordings, anti_promises: tekstInfo.anti_promises, stop_domains: tekstInfo.stop_domains, facts_path: tekstInfo.facts_path, tekst_dir: tekstInfo.dir, tekst_format: "v9" };
  for (const [k, v] of Object.entries(fields)) if (empty(inputs[k]) && !empty(v)) { inputs[k] = v; add.push(k); }
  writeFileSync(ip, JSON.stringify(inputs, null, 2), "utf8");
  console.log(`[read-faq-input] тексты v9: ${tekstInfo.dir}; inputs.json дополнен: ${add.join(", ") || "нечем"}`);
  if (unwrittenV9) console.log(`  ! ${unwrittenV9} страниц карты без page.md (не написаны) - пропущены`);
}
const noText = out.filter((p) => !p.text && !p.url).length;
console.log(`[read-faq-input] pages.json: ${out.length} страниц (источник ${source})`);
if (noText) console.log(`  ! ${noText} без текста и без url - faq-builder не сможет анализировать (дай url или текст)`);
const noQ = out.filter((p) => p.queries.length === 0 && !p.marker).length;
if (noQ) console.log(`  ! ${noQ} без запросов/маркера - JM-анализ будет слабым (дай маркер/запросы)`);
