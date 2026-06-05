#!/usr/bin/env node
// select-audit-pages.mjs
// Детерминированный отбор страниц для on-page аудита + шардинг на батчи.
// Часть шага 4 скила /seo-tehaudit. Заменяет ручной отбор внутри audit-onpage:
// теперь выборка делается ОДИН раз скриптом, затем раздаётся параллельным
// шардам audit-onpage (каждый фетчит свой батч со свежим контекстом).
//
// Использование:
//   node .claude/scripts/select-audit-pages.mjs <audit_dir> [--pages N] [--batch B]
// Вход:  <audit_dir>/indexing.json (sitemap.all_urls), <audit_dir>/recon.json (domain/main_mirror)
// Выход: <audit_dir>/page_plan.json
//
// page_plan.json: { domain, target, batch_size, total_available, sample_source,
//                   pages:[{url,type}], batches:[[{url,type}...]], url_structure:{...}, note }

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
const auditDirArg = args.find((a) => !a.startsWith("--"));
if (!auditDirArg) {
  console.error("[select-audit-pages] usage: node select-audit-pages.mjs <audit_dir> [--pages N] [--batch B]");
  process.exit(1);
}
function flag(name, def) {
  const i = args.indexOf(name);
  if (i >= 0 && args[i + 1]) return parseInt(args[i + 1], 10);
  return def;
}
const auditDir = resolve(auditDirArg);
const TARGET = Math.max(1, Math.min(flag("--pages", 24), 80)); // дефолт 24, потолок 80
const BATCH = Math.max(1, Math.min(flag("--batch", 8), 20));

const idxPath = join(auditDir, "indexing.json");
const reconPath = join(auditDir, "recon.json");
if (!existsSync(idxPath)) {
  console.error(`[select-audit-pages] not found: ${idxPath}`);
  process.exit(1);
}
const readJson = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8").replace(/^﻿/, "")) : {});
const indexing = readJson(idxPath);
const recon = readJson(reconPath);

const domain = (recon.domain || "").trim() || "site";
// origin для абсолютных URL
let origin = `https://${domain}`;
if (recon.main_mirror) {
  try { origin = new URL(recon.main_mirror).origin; } catch { /* keep */ }
}

const allUrls = Array.isArray(indexing.sitemap && indexing.sitemap.all_urls) ? indexing.sitemap.all_urls : [];

// Нормализация: вернуть {abs, path}
function norm(u) {
  let abs, path;
  const s = String(u || "").trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) {
    try { const url = new URL(s); abs = url.href; path = url.pathname; } catch { return null; }
  } else {
    path = s.startsWith("/") ? s : `/${s}`;
    abs = origin + path;
  }
  return { abs, path };
}

function typeOf(path) {
  const p = path.toLowerCase();
  if (p === "/" || p === "") return "Главная";
  if (/\/(catalog|category|collection|shop|katalog)\//.test(p)) return "Категория";
  if (/\/(product|tovar|item|p)\//.test(p)) return "Товар";
  if (/\/(uslugi|services|service|usluga)\//.test(p)) return "Услуга";
  if (/\/(blog|article|stati|news|post)\//.test(p)) return "Статья";
  if (/\/(about|contacts|kontakty|o-kompanii|dostavka|oplata|payment|delivery|garantiya)\//.test(p)) return "Информационная";
  return "Прочее";
}

// Уникальные нормализованные URL
const seen = new Set();
const items = [];
for (const u of allUrls) {
  const n = norm(u);
  if (!n) continue;
  const key = n.path.replace(/\/+$/, "") || "/";
  if (seen.has(key)) continue;
  seen.add(key);
  items.push({ url: n.abs, path: n.path, type: typeOf(n.path) });
}

// ── url_structure (по всем URL, без HTML) ──
const cap = (arr, n = 20) => arr.slice(0, n);
const slashDepth = (path) => path.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean).length;
// ЧПУ: только строчная латиница, цифры, дефис, подчёркивание, точка, слеш. Иной символ (КАПС,
// кириллица, %xx, @#?&, пробел) = нарушение.
const notCpu = /[^a-z0-9\-_/.]/;
const url_structure = {
  cpu_problems: cap(items.filter((it) => notCpu.test(it.path)).map((it) => it.url)),
  deep_urls: cap(items.filter((it) => slashDepth(it.path) > 3).map((it) => it.url)),
  long_urls: cap(items.filter((it) => it.url.length > 115).map((it) => it.url)),
  multi_slash: cap(items.filter((it) => /\/\/+/.test(it.path)).map((it) => it.url)),
};

// ── Отбор страниц: главная + round-robin по типам до TARGET ──
const homepage = items.find((it) => it.type === "Главная") || { url: origin + "/", path: "/", type: "Главная" };
const order = ["Категория", "Услуга", "Товар", "Статья", "Информационная", "Прочее"];
const groups = Object.fromEntries(order.map((t) => [t, []]));
for (const it of items) {
  if (it.type === "Главная") continue;
  (groups[it.type] || groups["Прочее"]).push(it);
}
const selected = [{ url: homepage.url, type: "Главная" }];
const selKeys = new Set([homepage.path.replace(/\/+$/, "") || "/"]);
let added = true;
while (selected.length < TARGET && added) {
  added = false;
  for (const t of order) {
    if (selected.length >= TARGET) break;
    const g = groups[t];
    if (g && g.length) {
      const it = g.shift();
      const k = it.path.replace(/\/+$/, "") || "/";
      if (!selKeys.has(k)) { selKeys.add(k); selected.push({ url: it.url, type: it.type }); added = true; }
    }
  }
}

// ── Шардинг ──
const batches = [];
for (let i = 0; i < selected.length; i += BATCH) batches.push(selected.slice(i, i + BATCH));

const plan = {
  domain,
  origin,
  target: TARGET,
  batch_size: BATCH,
  total_available: items.length,
  sample_source: "sitemap",
  selected_count: selected.length,
  batch_count: batches.length,
  pages: selected,
  batches,
  url_structure,
  note: items.length === 0
    ? "В sitemap.all_urls нет URL - аудит только главной страницы"
    : `Отобрано ${selected.length} из ${items.length} страниц (цель ${TARGET}), ${batches.length} батч(ей) по ${BATCH}`,
};

const outPath = join(auditDir, "page_plan.json");
writeFileSync(outPath, JSON.stringify(plan, null, 2), "utf8");
console.log(`[select-audit-pages] ${plan.note}; url_structure: ` +
  `ЧПУ-${url_structure.cpu_problems.length} глубоких-${url_structure.deep_urls.length} ` +
  `длинных-${url_structure.long_urls.length} мультислеш-${url_structure.multi_slash.length}`);
console.log(`[select-audit-pages] wrote ${outPath}`);
