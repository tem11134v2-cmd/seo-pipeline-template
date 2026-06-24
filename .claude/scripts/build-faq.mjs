#!/usr/bin/env node
// build-faq.mjs
// Рендер SEO-блока одной страницы: ТОЛЬКО FAQ (аккордеон + Schema.org FAQPage) с
// контекстными ссылками ВНУТРИ ответов. Вставляется в конец готовой страницы (фаза У6-Ф2).
// Классы pt- совпадают с китом /seo-tekst.
//
// ВНИМАНИЕ: faq.html - СЛУЖЕБНЫЙ артефакт (гейт для verify-faq), НЕ клиентский.
// Клиенту уходит FAQ_<slug>.docx (build-faq-docx.mjs). См. ТЗ /seo-faq.
//
// Вход:  <page_dir>/faq_blocks.json
// Выход: <page_dir>/faq.html (служебный гейт) + <page_dir>/faq.md (читабельно)
// Использование: node build-faq.mjs <page_dir>

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { sameUrl, resolveSelfUrl } from "./_faq-util.mjs";

const pageDir = process.argv[2] ? resolve(process.argv[2]) : null;
if (!pageDir) { console.error("[build-faq] usage: node build-faq.mjs <page_dir>"); process.exit(1); }
const blocksPath = join(pageDir, "faq_blocks.json");
if (!existsSync(blocksPath)) { console.error(`[build-faq] нет faq_blocks.json в ${pageDir}`); process.exit(1); }
const b = JSON.parse(readFileSync(blocksPath, "utf8").replace(/^﻿/, ""));

const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escAttr = (s) => esc(s).replace(/"/g, "&quot;");
const arr = (x) => (Array.isArray(x) ? x : []);

const faq = arr(b.faq);
const selfUrl = resolveSelfUrl(pageDir, b.slug);

// --resume на старой папке: предупредить про устаревшие поля (не падаем, авто-миграцию не делаем).
if (arr(b.objections).length || arr(b.tag_tiles).length || arr(b.interlinks).length) {
  console.warn("[build-faq] ! обнаружены устаревшие поля (objections/tag_tiles/interlinks) - они НЕ рендерятся. Перегенерируй faq-builder для контекстных ссылок.");
}

// Рендер ответа с возможной inline-ссылкой - ЕДИНСТВЕННЫЙ источник <a> в pt-faq-a.
// ИНВАРИАНТ (синхрон с build-faq-docx): точка разреза = ПЕРВОЕ вхождение анкора.
// build-faq режет по esc(a), docx - по сырому a; точки идентичны, т.к. esc порядко-сохраняющая
// (esc(before) === esc(a).slice(0,idx)). Менять indexOf на lastIndexOf/regex ЗАПРЕЩЕНО.
function renderAnswerHtml(a, link, self) {
  let h = esc(a); // эскейпим ВЕСЬ ответ
  if (link && link.anchor && link.url && !sameUrl(link.url, self)) {
    const aEsc = esc(link.anchor);
    const idx = h.indexOf(aEsc); // ПЕРВОЕ вхождение, по esc-строке
    if (idx !== -1) {
      // В href пишется ИСХОДНЫЙ link.url (нормализация - только для sameUrl-сравнения).
      h = h.slice(0, idx) + `<a href="${escAttr(link.url)}">${aEsc}</a>` + h.slice(idx + aEsc.length);
    } else {
      console.warn(`[build-faq] анкор не найден в ответе, ссылка пропущена: "${link.anchor}"`);
    }
  }
  return h;
}

// ---------- HTML ----------
const parts = [];
parts.push(`<!-- SEO-блок (/seo-faq): только FAQ + Schema.org. Вставить в конец готовой страницы. -->`);
parts.push(`<section class="pt-section pt-faq-seo">`);
parts.push(`  <div class="container">`);

let linked = 0;
const targets = new Set();
if (faq.length) {
  parts.push(`    <div class="pt-section__head"><h2 class="pt-h2">${esc(b.faq_h2 || "Частые вопросы")}</h2></div>`);
  parts.push(`    <div class="pt-faq">`);
  for (const item of faq) {
    const link = arr(item.links)[0];
    const aHtml = renderAnswerHtml(item.a, link, selfUrl);
    if (link && link.anchor && link.url && !sameUrl(link.url, selfUrl) && esc(item.a).indexOf(esc(link.anchor)) !== -1) {
      linked++; targets.add(link.url);
    }
    parts.push(`      <details class="pt-faq__item"><summary>${esc(item.q)}</summary><div class="pt-faq-a">${aHtml}</div></details>`);
  }
  parts.push(`    </div>`);
}
parts.push(`  </div>`);
parts.push(`</section>`);

// Schema.org FAQPage - acceptedAnswer.text ВСЕГДА чистый faq[].a (без <a>).
if (faq.length) {
  const schema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faq.map((i) => ({ "@type": "Question", name: String(i.q || ""), acceptedAnswer: { "@type": "Answer", text: String(i.a == null ? "" : i.a) } })),
  };
  // Компактно (как было) + защита от обрыва </script>.
  parts.push(`<script type="application/ld+json">${JSON.stringify(schema).replace(/<\//g, "<\\/")}</script>`);
}

writeFileSync(join(pageDir, "faq.html"), parts.join("\n") + "\n", "utf8");

// ---------- Markdown (читабельный дамп) ----------
const md = [];
md.push(`## FAQ: ${b.slug || ""}`.trim());
if (b.marker) md.push(`Маркер: ${b.marker}`);
if (arr(b.normalized_keywords).length) md.push(`\n**Нормализованные ключи/N-граммы:** ${arr(b.normalized_keywords).join(", ")}`);
if (faq.length) {
  md.push(`\n### ${b.faq_h2 || "Частые вопросы"}`);
  for (const i of faq) {
    md.push(`\n**${i.q}**\n\n${i.a}`);
    const link = arr(i.links)[0];
    if (link && link.anchor && link.url) md.push(`(ссылка: ${link.anchor} -> ${link.url})`);
  }
}
writeFileSync(join(pageDir, "faq.md"), md.join("\n") + "\n", "utf8");

const ratio = faq.length ? (linked / faq.length).toFixed(2) : "0.00";
console.log(`[build-faq] ${pageDir}`);
console.log(`  FAQ: ${faq.length}, со ссылкой: ${linked}/${faq.length} (доля ${ratio}), уникальных целей: ${targets.size}`);
console.log(`  нормализовано ключей: ${arr(b.normalized_keywords).length}, Schema FAQPage: ${faq.length ? "да" : "нет"}`);
