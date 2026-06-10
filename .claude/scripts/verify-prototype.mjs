#!/usr/bin/env node
// verify-prototype.mjs
// POST-FLIGHT проверка собранного прототипа одной страницы.
// Структурные инварианты - по prototype.html; контентные - по manifest.json (без legal-шума).
//
// Использование:
//   node verify-prototype.mjs <page_dir>   (ожидает manifest.json + prototype.html)
//
// Exit: 0 ok | 2 есть нарушения (печатает построчно) | 1 фатально (нет файлов).

import { readFileSync, existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const pageDir = process.argv[2] ? resolve(process.argv[2]) : null;
if (!pageDir) { console.error("[verify-prototype] usage: node verify-prototype.mjs <page_dir>"); process.exit(1); }

const manifestPath = join(pageDir, "manifest.json");
const htmlPath = join(pageDir, "prototype.html");
if (!existsSync(htmlPath)) { console.error(`[verify-prototype] нет prototype.html в ${pageDir}`); process.exit(1); }

const html = readFileSync(htmlPath, "utf8");
let manifest = {};
if (existsSync(manifestPath)) { try { manifest = JSON.parse(readFileSync(manifestPath, "utf8").replace(/^﻿/, "")); } catch {} }

const violations = [];
const warnings = [];
const V = (m) => violations.push(m);
const W = (m) => warnings.push(m);

// ---------- структурные инварианты (html) ----------
const countMatch = (re) => (html.match(re) || []).length;

if (!/<header[\s>]/i.test(html)) V("нет <header>");
if (!/<footer[\s>]/i.test(html)) V("нет <footer> (реквизиты - блокер модерации Директа/VK)");
const leadForms = countMatch(/id="leadForm"/g);
if (leadForms === 0) V("нет финальной формы (id=leadForm)");
else if (leadForms > 1) V(`форм-захвата ${leadForms} (правило: ровно 1 в финале)`);
if (!/id="f-agree"/.test(html)) V("в форме нет чекбокса согласия ПДн (#f-agree)");
if (!/id="f-submit"[^>]*disabled/.test(html)) W("submit формы не disabled по умолчанию (проверь чекбокс-гейт)");
if (!/href="tel:/.test(html)) V("нет кликабельного телефона (tel:)");
if (!/id="cookieBanner"/.test(html)) V("нет cookie-баннера (#cookieBanner)");
if (!/id="(privacyPage|personDataPage|cookiePage)"/.test(html)) W("нет юр-страниц (privacy/consent/cookie)");

// фреймворки / запрещённое
const fw = [];
if (/\b(class|className)="[^"]*\b(react|jsx)\b/i.test(html)) fw.push("react");
if (/\sv-(if|for|bind|model|on)[=:]/.test(html)) fw.push("vue");
if (/\sng-[a-z]+=/.test(html)) fw.push("angular");
if (/\bdata-tilda/i.test(html)) fw.push("tilda-runtime");
if (/cdn\.|googleapis\.com\/css|unpkg\.com|jsdelivr/i.test(html)) fw.push("external-cdn");
if (fw.length) V(`найдены фреймворк/внешние зависимости: ${fw.join(", ")} (нужен чистый HTML/CSS/JS)`);

// длинное/среднее тире в видимом тексте
const dashes = countMatch(/—|–/g);
if (dashes > 0) V(`длинное/среднее тире (— –): ${dashes} (только дефис -)`);

// ---------- контентные проверки (manifest copy) ----------
const STOP = [
  "индивидуальный подход", "широкий ассортимент", "команда профессионалов",
  "лидеры рынка", "высокое качество по доступным ценам", "многолетний опыт",
  "гарантируем результат", "опытные специалисты", "лучшие на рынке",
  "динамично развивающаяся", "гибкая система скидок", "не как у других",
];
function collectText(obj, acc = []) {
  if (obj == null) return acc;
  if (typeof obj === "string") { acc.push(obj); return acc; }
  if (Array.isArray(obj)) { for (const v of obj) collectText(v, acc); return acc; }
  if (typeof obj === "object") { for (const v of Object.values(obj)) collectText(v, acc); return acc; }
  return acc;
}
const blocks = Array.isArray(manifest.blocks) ? manifest.blocks : [];
const metaDescription = String((manifest.meta && manifest.meta.description) || "");
const copyText = blocks.map((b) => collectText(b.slots).concat(b.h2 ? [b.h2] : []).join("  ")).concat(metaDescription ? [metaDescription] : []).join("\n").toLowerCase();

for (const s of STOP) if (copyText.includes(s)) V(`стоп-формула в тексте: «${s}» (см. COPY-AUDIT.md §14в - заменить на конкретику)`);

// вложенные массивы строк: писатель мог склеить в строку - REPEAT отрендерил бы пусто
for (const b of blocks) {
  const slots = b.slots || {};
  if (b.fragment === "pricing") {
    const tariffs = Array.isArray(slots.tariffs) ? slots.tariffs : [];
    let featuredCount = 0;
    for (const t of tariffs) {
      if (!t || typeof t !== "object") continue;
      if (!Array.isArray(t.features) || t.features.length === 0 || t.features.some((f) => typeof f !== "string"))
        V(`pricing: tariffs[].features тарифа «${t.name || "?"}» должен быть непустым массивом строк`);
      if ("featured" in t && typeof t.featured !== "boolean")
        V(`pricing: featured тарифа «${t.name || "?"}» не boolean (${JSON.stringify(t.featured)}) - строго true/false`);
      if (t.featured === true) featuredCount++;
    }
    if (featuredCount > 1) V(`pricing: featured=true у ${featuredCount} тарифов (допустим максимум один)`);
  }
  if (b.fragment === "product-listing") {
    const filters = Array.isArray(slots.filters) ? slots.filters : [];
    for (const f of filters) {
      if (!f || typeof f !== "object") continue;
      if (!Array.isArray(f.options) || f.options.length === 0 || f.options.some((o) => typeof o !== "string"))
        V(`product-listing: filters[].options фильтра «${f.name || "?"}» должен быть непустым массивом строк`);
    }
  }
}

// H1 присутствует и содержит маркер
const marker = (manifest.meta && manifest.meta.marker) || "";
const hero = blocks.find((b) => (b.fragment === "hero") || (b.type || "").toLowerCase().includes("hero") || (b.type || "").includes("Первый экран"));
const h1 = hero && hero.slots ? (hero.slots.h1 || "") : "";
if (!h1) W("не нашёл H1 (Hero без слота h1?)");
else if (marker && !h1.toLowerCase().includes(marker.toLowerCase().split(" ")[0])) {
  W(`H1 не содержит маркер «${marker}» (желательно для релевантности)`);
}

// мягкие бюджеты длины (предупреждения)
if (h1 && h1.length > 60) W(`H1 длинный (${h1.length} симв) - лимит 60 (COPY-AUDIT п.9)`);
for (const b of blocks) {
  const h2 = b.h2 || (b.slots && b.slots.h2) || "";
  if (h2 && h2.length > 70) W(`H2 длинный (${h2.length} симв): «${h2.slice(0, 40)}...»`);
}

// fill-notes сводка
let fillCount = 0;
for (const b of blocks) if (Array.isArray(b.fill_notes)) fillCount += b.fill_notes.length;
fillCount += (copyText.match(/\[заполнить/g) || []).length;

// ---------- отчёт ----------
const sizeKb = (statSync(htmlPath).size / 1024).toFixed(1);
console.log(`[verify-prototype] ${pageDir}  (${sizeKb} KB, блоков ${blocks.length})`);
if (warnings.length) { console.log("  предупреждения:"); for (const w of warnings) console.log("   ~ " + w); }
if (fillCount) console.log(`  [ЗАПОЛНИТЬ]-пометок для согласования: ${fillCount}`);

if (violations.length) {
  console.log("  НАРУШЕНИЯ:");
  for (const v of violations) console.log("   ! " + v);
  process.exit(2);
}
console.log("  OK - критичных нарушений нет.");
process.exit(0);
