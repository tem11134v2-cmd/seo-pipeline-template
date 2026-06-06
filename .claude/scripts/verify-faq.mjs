#!/usr/bin/env node
// verify-faq.mjs
// Проверка SEO-блока одной страницы (/seo-faq): валидность Schema.org, объёмы, стоп-формулы, тире.
//
// Использование: node verify-faq.mjs <page_dir>   (ожидает faq_blocks.json + faq.html)
// Exit: 0 ok | 2 нарушения | 1 фатально.

import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const pageDir = process.argv[2] ? resolve(process.argv[2]) : null;
if (!pageDir) { console.error("[verify-faq] usage: <page_dir>"); process.exit(1); }
const htmlPath = join(pageDir, "faq.html");
const blocksPath = join(pageDir, "faq_blocks.json");
if (!existsSync(htmlPath)) { console.error(`[verify-faq] нет faq.html в ${pageDir}`); process.exit(1); }
const html = readFileSync(htmlPath, "utf8");
let b = {};
if (existsSync(blocksPath)) { try { b = JSON.parse(readFileSync(blocksPath, "utf8").replace(/^﻿/, "")); } catch {} }
const arr = (x) => (Array.isArray(x) ? x : []);

const violations = [], warnings = [];
const V = (m) => violations.push(m), W = (m) => warnings.push(m);

// --- Schema.org FAQPage ---
const m = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
const faq = arr(b.faq);
if (faq.length) {
  if (!m) V("нет Schema.org JSON-LD (нужен FAQPage)");
  else {
    try {
      const s = JSON.parse(m[1]);
      if (s["@type"] !== "FAQPage") V(`Schema @type = ${s["@type"]}, ожидался FAQPage`);
      const me = arr(s.mainEntity);
      if (me.length !== faq.length) W(`в Schema ${me.length} вопросов, в faq_blocks ${faq.length} - рассинхрон`);
      for (const q of me) if (!q.name || !(q.acceptedAnswer && q.acceptedAnswer.text)) V("в Schema вопрос без name/acceptedAnswer.text");
    } catch (e) { V(`Schema JSON-LD не парсится: ${e.message}`); }
  }
}

// --- объёмы FAQ ---
if (faq.length < 3) W(`FAQ всего ${faq.length} (желательно 5-8; >8 -> отдельная страница)`);
if (faq.length > 12) W(`FAQ ${faq.length} (>8-12 -> вынеси часть на отдельную страницу)`);
for (const i of faq) {
  if (!/\?\s*$/.test(String(i.q || ""))) W(`вопрос без «?»: «${String(i.q).slice(0, 40)}»`);
  const al = String(i.a || "").length;
  if (al < 120) W(`короткий ответ (${al} симв): «${String(i.q).slice(0, 30)}» (желательно 200-550)`);
  if (al > 800) W(`длинный ответ (${al} симв): «${String(i.q).slice(0, 30)}»`);
}

// --- нормализация (ядро ценности) ---
if (arr(b.normalized_keywords).length === 0) W("normalized_keywords пуст - не зафиксировано, какие N-граммы/ключи добавлены (ослабляет смысл /seo-faq)");

// --- стоп-формулы + тире (на тексте блоков) ---
const STOP = ["индивидуальный подход", "широкий ассортимент", "команда профессионалов", "лидеры рынка", "высокое качество по доступным ценам", "многолетний опыт", "лучшие на рынке"];
const allText = [...faq, ...arr(b.objections)].map((i) => `${i.q} ${i.a}`).join(" ").toLowerCase();
for (const s of STOP) if (allText.includes(s)) V(`стоп-формула: «${s}»`);
const dashes = (html.match(/—|–/g) || []).length;
if (dashes > 0) V(`длинное/среднее тире (— –): ${dashes} (только дефис)`);

// --- отчёт ---
console.log(`[verify-faq] ${pageDir}  (FAQ ${faq.length}, теги ${arr(b.tag_tiles).length}, перелинковка ${arr(b.interlinks).length})`);
if (warnings.length) { console.log("  предупреждения:"); for (const w of warnings) console.log("   ~ " + w); }
if (violations.length) { console.log("  НАРУШЕНИЯ:"); for (const v of violations) console.log("   ! " + v); process.exit(2); }
console.log("  OK - критичных нарушений нет.");
process.exit(0);
