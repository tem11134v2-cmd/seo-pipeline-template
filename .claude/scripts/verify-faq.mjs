#!/usr/bin/env node
// verify-faq.mjs
// Гейт качества SEO-блока одной страницы (/seo-faq): валидность Schema.org, объёмы,
// стоп-формулы, тире, контекстные ссылки (доля/self/пул/синхрон schema<->видимый).
//
// Работает по СВЕЖЕ-собранному faq.html (цепочка build-faq -> verify-faq).
// Сопоставление html <-> schema <-> faq_blocks - ПО ПОЗИЦИИ i (один источник faq[]).
//
// Использование: node verify-faq.mjs <page_dir>   (ожидает faq.html + faq_blocks.json)
// Exit: 0 ok | 2 нарушения | 1 фатально.

import { readFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { sameUrl, normalizeUrl, htmlDecode, resolveSelfUrl, readPool } from "./_faq-util.mjs";

const pageDir = process.argv[2] ? resolve(process.argv[2]) : null;
if (!pageDir) { console.error("[verify-faq] usage: <page_dir>"); process.exit(1); }
const htmlPath = join(pageDir, "faq.html");
const blocksPath = join(pageDir, "faq_blocks.json");
if (!existsSync(htmlPath)) { console.error(`[verify-faq] нет faq.html в ${pageDir}`); process.exit(1); }
const html = readFileSync(htmlPath, "utf8");
let b = {};
if (existsSync(blocksPath)) { try { b = JSON.parse(readFileSync(blocksPath, "utf8").replace(/^﻿/, "")); } catch {} }
const arr = (x) => (Array.isArray(x) ? x : []);
// esc - идентичен build-faq: нужен для cross-check, чтобы предиктор «сколько ссылок вставит build»
// работал в той же esc-плоскости, что и реальная вставка renderAnswerHtml (h.indexOf по esc(a)).
const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const violations = [], warnings = [];
const V = (m) => violations.push(m), W = (m) => warnings.push(m);

const faq = arr(b.faq);
const selfUrl = resolveSelfUrl(pageDir, b.slug);
const pool = readPool(pageDir);
const poolNorm = new Set((pool || []).map((p) => normalizeUrl(p.url)).filter(Boolean));

// --- Регэкспы (build-faq генерит детерминированно) ---
const ansRe = /<div class="pt-faq-a">([\s\S]*?)<\/div>/g;
const linkRe = /<a\s+href="([^"]*)">([\s\S]*?)<\/a>/g;

// Разобрать видимые ответы и ссылки внутри них (по позиции).
const ansBlocks = [];
let am;
ansRe.lastIndex = 0;
while ((am = ansRe.exec(html)) !== null) ansBlocks.push(am[1]);
const blockLinks = ansBlocks.map((blk) => {
  const out = []; let lm; linkRe.lastIndex = 0;
  while ((lm = linkRe.exec(blk)) !== null) out.push({ href: lm[1], anchor: lm[2] });
  return out;
});

// --- Schema.org FAQPage ---
const m = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
let schemaME = [];
if (faq.length) {
  if (!m) V("нет Schema.org JSON-LD (нужен FAQPage)");
  else {
    try {
      const s = JSON.parse(m[1]);
      if (s["@type"] !== "FAQPage") V(`Schema @type = ${s["@type"]}, ожидался FAQPage`);
      schemaME = arr(s.mainEntity);
      if (schemaME.length !== faq.length) W(`в Schema ${schemaME.length} вопросов, в faq_blocks ${faq.length} - рассинхрон`);
      for (const q of schemaME) {
        if (!q.name || !(q.acceptedAnswer && q.acceptedAnswer.text)) V("в Schema вопрос без name/acceptedAnswer.text");
        // E. В Schema НЕ должно быть ссылок/HTML (грепаем распарсенную СТРОКУ, не сырой блок; голый '<' легитимен).
        const at = String((q.acceptedAnswer && q.acceptedAnswer.text) || "");
        if (/<a\b|<\/a>|href=/i.test(at)) V("в Schema acceptedAnswer.text содержит ссылку/HTML (должен быть чистый текст)");
      }
    } catch (e) { V(`Schema JSON-LD не парсится: ${e.message}`); }
  }
}

// --- объёмы FAQ (пороги НЕ ужесточаем; 5-8 / 200-550 - целевые) ---
if (faq.length < 3) W(`FAQ всего ${faq.length} (целевое 5-8; >8 -> отдельная страница)`);
if (faq.length > 12) W(`FAQ ${faq.length} (>8 -> вынеси часть на отдельную страницу/faq_overflow)`);
for (const i of faq) {
  if (!/\?\s*$/.test(String(i.q || ""))) W(`вопрос без «?»: «${String(i.q).slice(0, 40)}»`);
  const al = String(i.a || "").length;
  if (al < 120) W(`короткий ответ (${al} симв): «${String(i.q).slice(0, 30)}» (целевое 200-550)`);
  if (al > 800) W(`длинный ответ (${al} симв): «${String(i.q).slice(0, 30)}»`);
}

// --- нормализация (ядро ценности) ---
if (arr(b.normalized_keywords).length === 0) W("normalized_keywords пуст - не зафиксировано, какие N-граммы/ключи добавлены (ослабляет смысл /seo-faq)");

// --- стоп-формулы (только по faq) + тире (на html) ---
const STOP = ["индивидуальный подход", "широкий ассортимент", "команда профессионалов", "лидеры рынка", "высокое качество по доступным ценам", "многолетний опыт", "лучшие на рынке"];
const allText = faq.map((i) => `${i.q} ${i.a}`).join(" ").toLowerCase();
for (const s of STOP) if (allText.includes(s)) V(`стоп-формула: «${s}»`);
const dashes = (html.match(/—|–/g) || []).length;
if (dashes > 0) V(`длинное/среднее тире (— –): ${dashes} (только дефис)`);

// --- контекстные ссылки ---
const allHrefs = [];
let linkedCount = 0;
for (let i = 0; i < ansBlocks.length; i++) {
  const links = blockLinks[i];
  if (links.length >= 1) linkedCount++;
  if (links.length > 1) V(`в одном ответе ${links.length} ссылок (допустимо <=1): блок #${i + 1}`); // B
  for (const lk of links) {
    if (!String(lk.anchor || "").trim()) V(`пустой анкор ссылки в блоке #${i + 1}`); // C
    allHrefs.push(lk.href);
  }
}

// A. Доля ссылок (W; коридор [0.3; 0.6] - тишина). Знаменатель - ТОЛЬКО faq.length (контракт §3.5).
if (faq.length > 0) {
  const ratio = linkedCount / faq.length;
  const eps = 0.001;
  if (ratio < 0.3 - eps) W(`доля ответов со ссылкой ${ratio.toFixed(2)} < 0.3 (целевое ~0.5)`);
  else if (ratio > 0.6 + eps) W(`доля ответов со ссылкой ${ratio.toFixed(2)} > 0.6 (целевое ~0.5)`);
}

// D. url не self и из пула (V при наличии данных; иначе W).
const urlCheckDegraded = (pool === null || selfUrl === "");
if (allHrefs.length) {
  if (urlCheckDegraded) {
    W("проверка url ссылок пропущена (нет inputs.json/pages.json - pool/selfUrl недоступны)");
  } else {
    for (const href of allHrefs) {
      if (sameUrl(href, selfUrl)) V(`self-ссылка (url = текущая страница): ${href}`);
      else if (!poolNorm.has(normalizeUrl(href))) V(`url вне пула interlink_pool: ${href}`);
    }
  }
}

// G. Разнообразие (W; только если в пуле >=2 уникальных url).
if (poolNorm.size >= 2 && allHrefs.length >= 3) {
  const uniqTargets = new Set(allHrefs.map(normalizeUrl));
  if (uniqTargets.size === 1) W("все ссылки (>=3) ведут на один url при наличии альтернатив в пуле (нет разнообразия)");
}

// F. Синхрон schema <-> видимый ответ (V только при содержательном расхождении).
const collapse = (s) => String(s).replace(/\s+/g, " ").trim();
const n = Math.min(ansBlocks.length, schemaME.length);
for (let i = 0; i < n; i++) {
  const visiblePlain = collapse(htmlDecode(ansBlocks[i].replace(linkRe, "$2"))); // снять обёртку <a>...</a> -> анкор
  const schemaPlain = collapse(htmlDecode(String((schemaME[i].acceptedAnswer && schemaME[i].acceptedAnswer.text) || "")));
  if (visiblePlain !== schemaPlain) V(`рассинхрон schema<->видимый ответ #${i + 1}`);
}

// H. Дубль существующего FAQ (W) - q дословно встречается в тексте страницы.
const pageText = (() => {
  try {
    const faqDir = dirname(dirname(pageDir));
    const pj = JSON.parse(readFileSync(join(faqDir, "pages.json"), "utf8").replace(/^﻿/, ""));
    const rec = (pj.pages || []).find((p) => p.slug === b.slug);
    return rec ? String(rec.text || "") : "";
  } catch { return ""; }
})();
if (pageText) {
  const normText = collapse(pageText.toLowerCase());
  for (const i of faq) {
    const nq = collapse(String(i.q || "").toLowerCase());
    if (nq && normText.includes(nq)) W(`возможный дубль существующего FAQ: «${String(i.q).slice(0, 40)}»`);
  }
}

// Cross-check (W): сколько ссылок build ДОЛЖЕН был вставить (не self, анкор есть в a) == сколько <a> в html.
const expectedInserted = faq.filter((it) => {
  const l = arr(it.links)[0];
  if (!l || !l.anchor || !l.url) return false;
  if (sameUrl(l.url, selfUrl)) return false;
  return esc(String(it.a || "")).indexOf(esc(l.anchor)) !== -1; // зеркалит build-faq (esc-плоскость)
}).length;
if (expectedInserted !== allHrefs.length) {
  W(`рассинхрон: faq_blocks ожидает ${expectedInserted} вставленных ссылок, в html ${allHrefs.length} <a> (агент дал link, build не вставил?)`);
}

// --- отчёт ---
console.log(`[verify-faq] ${pageDir}  (FAQ ${faq.length}, со ссылкой ${linkedCount}/${ansBlocks.length}, целей ${new Set(allHrefs.map(normalizeUrl)).size})`);
if (warnings.length) { console.log("  предупреждения:"); for (const w of warnings) console.log("   ~ " + w); }
if (violations.length) { console.log("  НАРУШЕНИЯ:"); for (const v of violations) console.log("   ! " + v); process.exit(2); }
console.log("  OK - критичных нарушений нет.");
process.exit(0);
