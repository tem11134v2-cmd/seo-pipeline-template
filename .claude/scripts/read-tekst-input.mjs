#!/usr/bin/env node
// read-tekst-input.mjs
// Разрешает целевые страницы для /seo-tekst из одного из источников и пишет pages.json.
//
// Использование:
//   node read-tekst-input.mjs <texts_dir> --from-structure <structure_dir>
//   node read-tekst-input.mjs <texts_dir> --from-table <path.csv|tsv>
//   node read-tekst-input.mjs <texts_dir> --from-analysis <analysis_dir>   (берёт направления из брифа)
//
// Выход: <texts_dir>/pages.json = { source, pages: [{ n, slug, url, type, marker, queries[] }] }; queries[] - всегда массив строк (объектные формы источников нормализуются)
// Exit: 0 ok | 2 нет целевых страниц | 1 ошибка.

import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
const textsDir = args[0] ? resolve(args[0]) : null;
if (!textsDir) {
  console.error("[read-tekst-input] usage: node read-tekst-input.mjs <texts_dir> --from-structure|--from-table|--from-analysis <src>");
  process.exit(1);
}
function flag(name) {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] ? args[i + 1] : null;
}
const fromStructure = flag("--from-structure");
const fromTable = flag("--from-table");
const fromAnalysis = flag("--from-analysis");

function readJson(p) { return JSON.parse(readFileSync(p, "utf8").replace(/^﻿/, "")); }
const TRANSLIT = { а:"a",б:"b",в:"v",г:"g",д:"d",е:"e",ё:"e",ж:"zh",з:"z",и:"i",й:"y",к:"k",л:"l",м:"m",н:"n",о:"o",п:"p",р:"r",с:"s",т:"t",у:"u",ф:"f",х:"h",ц:"c",ч:"ch",ш:"sh",щ:"sch",ъ:"",ы:"y",ь:"",э:"e",ю:"yu",я:"ya" };
function translit(s) { return String(s || "").toLowerCase().replace(/[а-яё]/g, (c) => (c in TRANSLIT ? TRANSLIT[c] : c)); }
// slug -> ТОЛЬКО латиница (кириллицу транслитерируем; git/скрипты не любят кириллицу в путях - см. CLAUDE.md)
function slugify(s) {
  return translit(String(s || "")).replace(/https?:\/\//, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "page";
}
function pick(obj, keys) {
  for (const k of Object.keys(obj || {})) {
    const norm = k.toLowerCase().trim();
    for (const want of keys) if (norm === want || norm.includes(want)) return obj[k];
  }
  return undefined;
}
// найти первый массив объектов в произвольном JSON
function findArray(obj, depth = 0) {
  if (depth > 4 || obj == null || typeof obj !== "object") return null;
  if (Array.isArray(obj) && obj.length && typeof obj[0] === "object") return obj;
  for (const v of Object.values(obj)) {
    const found = findArray(v, depth + 1);
    if (found) return found;
  }
  return null;
}

let source = "";
let rawPages = [];

try {
  if (fromStructure) {
    source = `structure:${fromStructure}`;
    const sdir = resolve(fromStructure);
    const candidates = ["structure_data.json", "master_list.json", "top10.json"];
    let data = null, used = null;
    for (const c of candidates) {
      const p = join(sdir, c);
      if (existsSync(p)) { data = readJson(p); used = c; break; }
    }
    if (!data) { console.error(`[read-tekst-input] нет structure_data.json/master_list.json в ${sdir}`); process.exit(1); }
    const arr = findArray(data) || [];
    rawPages = arr.map((row) => {
      const status = String(pick(row, ["target_status", "статус", "status", "решение"]) ?? "").toLowerCase();
      const keep = status === "" || /да|yes|true|оставля|целев/.test(status);
      if (!keep) return null;
      return {
        url: pick(row, ["url", "адрес", "путь", "path", "страница"]) || "",
        type: pick(row, ["type", "тип", "тип страницы"]) || "Страница",
        marker: pick(row, ["marker", "маркер", "маркерный", "главный запрос", "запрос"]) || "",
        queries: pick(row, ["queries", "запросы", "семантика"]) || [],
      };
    }).filter(Boolean);
    console.error(`[read-tekst-input] structure: ${used}, найдено строк ${arr.length}, целевых ${rawPages.length}`);
  } else if (fromTable) {
    source = `table:${fromTable}`;
    const raw = readFileSync(resolve(fromTable), "utf8").replace(/^﻿/, "").trim();
    const sep = raw.includes("\t") ? "\t" : raw.includes(";") ? ";" : ",";
    const lines = raw.split(/\r?\n/).filter((l) => l.trim());
    const header = lines[0].toLowerCase();
    const hasHeader = /url|адрес|тип|type|маркер|marker/.test(header);
    const rows = hasHeader ? lines.slice(1) : lines;
    rawPages = rows.map((line) => {
      const c = line.split(sep).map((s) => s.trim());
      return { url: c[0] || "", type: c[1] || "Страница", marker: c[2] || "", queries: c[3] ? c[3].split(/[|,]/).map((s) => s.trim()).filter(Boolean) : [] };
    }).filter((p) => p.url || p.marker);
  } else if (fromAnalysis) {
    // ЧЕРНОВОЙ путь: точную структуру лучше строить через /seo-struktura.
    // Источники посадок (по убыванию приоритета): recommendations.site_architecture (явные /url/),
    // brief.client_target_queries, фолбэк brief.assortment.
    source = `analysis:${fromAnalysis}`;
    const adir = resolve(fromAnalysis);
    const briefP = join(adir, "brief.json");
    if (!existsSync(briefP)) { console.error(`[read-tekst-input] нет brief.json в ${adir}`); process.exit(1); }
    const brief = readJson(briefP);
    const recP = join(adir, "recommendations.json");
    const rec = existsSync(recP) ? readJson(recP) : {};
    const biz = String(brief.business_type || "").toLowerCase();
    const defType = /shop|ecom|store|catalog|катал|товар/.test(biz) ? "Категория" : "Услуга";
    // Посадки = целевые запросы клиента (русские маркеры), фолбэк - ассортимент.
    const qList = Array.isArray(brief.client_target_queries) ? brief.client_target_queries : [];
    const usedAssort = qList.length === 0;
    const srcList = usedAssort ? (Array.isArray(brief.assortment) ? brief.assortment.slice(0, 15) : []) : qList;
    rawPages = srcList.map((q) => ({ url: "/" + slugify(q) + "/", type: defType, marker: String(q), queries: [] })).filter((p) => p.marker);
    // Подсказка: рекомендованные URL-посадки из анализа (привязать вручную/через /seo-struktura).
    const archUrls = [];
    for (const a of (Array.isArray(rec.site_architecture) ? rec.site_architecture : [])) {
      const t = typeof a === "string" ? a : (a.item || "");
      for (const u of (String(t).match(/\/[a-z0-9][a-z0-9-]*\//g) || [])) archUrls.push(u);
    }
    console.error(`[read-tekst-input] analysis: ${rawPages.length} посадок из ${usedAssort ? "assortment" : "client_target_queries"}. ЧЕРНОВИК - для точной структуры прогони /seo-struktura, затем --from-structure.`);
    if (archUrls.length) console.error(`  рекомендованные URL из анализа (привяжи к посадкам): ${[...new Set(archUrls)].join(" ")}`);
  } else {
    console.error("[read-tekst-input] не задан источник (--from-structure | --from-table | --from-analysis)");
    process.exit(1);
  }
} catch (e) {
  console.error(`[read-tekst-input] ошибка чтения источника: ${e.message}`);
  process.exit(1);
}

// нормализация + дедуп по url/marker
const seen = new Set();
const pages = [];
let n = 0;
for (const p of rawPages) {
  const key = (p.url || "") + "|" + (p.marker || "");
  if (seen.has(key)) continue;
  seen.add(key);
  n++;
  const slug = slugify(p.url && p.url !== "/" ? p.url : p.marker);
  pages.push({
    n,
    slug: slug + (pages.find((x) => x.slug === slug) ? "-" + n : ""),
    url: p.url || "",
    type: p.type || "Страница",
    marker: p.marker || "",
    queries: (Array.isArray(p.queries) ? p.queries : []).map((q) => (typeof q === "string" ? q : String((q && q.query) || "")).trim()).filter(Boolean),
  });
}

if (pages.length === 0) {
  console.error("[read-tekst-input] не найдено ни одной целевой страницы (структура: все «нет»? таблица пуста?)");
  process.exit(2);
}

writeFileSync(join(textsDir, "pages.json"), JSON.stringify({ source, count: pages.length, pages }, null, 2), "utf8");
console.log(`[read-tekst-input] pages.json: ${pages.length} страниц (источник ${source})`);
const byType = {};
for (const p of pages) byType[p.type] = (byType[p.type] || 0) + 1;
console.log("  по типам: " + Object.entries(byType).map(([t, c]) => `${t}=${c}`).join(", "));
