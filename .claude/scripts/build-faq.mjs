#!/usr/bin/env node
// build-faq.mjs
// Рендер SEO-блока одной страницы: FAQ (аккордеон + Schema.org FAQPage) + возражения +
// плитка тегов + перелинковка. Вставляется в конец готовой страницы (фаза У6-Ф2).
// Классы pt- совпадают с китом /seo-tekst - блок ложится и в прототип, и в любую страницу.
//
// Вход:  <page_dir>/faq_blocks.json
// Выход: <page_dir>/faq.html  (вставляемый сниппет)  +  <page_dir>/faq.md (читабельно)
// Использование: node build-faq.mjs <page_dir>

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const pageDir = process.argv[2] ? resolve(process.argv[2]) : null;
if (!pageDir) { console.error("[build-faq] usage: node build-faq.mjs <page_dir>"); process.exit(1); }
const blocksPath = join(pageDir, "faq_blocks.json");
if (!existsSync(blocksPath)) { console.error(`[build-faq] нет faq_blocks.json в ${pageDir}`); process.exit(1); }
const b = JSON.parse(readFileSync(blocksPath, "utf8").replace(/^﻿/, ""));

const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escAttr = (s) => esc(s).replace(/"/g, "&quot;");
const arr = (x) => (Array.isArray(x) ? x : []);

const faq = arr(b.faq);
const objections = arr(b.objections);
const tagTiles = arr(b.tag_tiles);
const interlinks = arr(b.interlinks);

// ---------- HTML ----------
const parts = [];
parts.push(`<!-- SEO-блок (/seo-faq): FAQ + плитка тегов + перелинковка. Вставить в конец страницы. -->`);
parts.push(`<section class="pt-section pt-faq-seo">`);
parts.push(`  <div class="container">`);

if (faq.length) {
  parts.push(`    <div class="pt-section__head"><h2 class="pt-h2">${esc(b.faq_h2 || "Частые вопросы")}</h2></div>`);
  parts.push(`    <div class="pt-faq">`);
  for (const item of faq) {
    parts.push(`      <details class="pt-faq__item"><summary>${esc(item.q)}</summary><div class="pt-faq-a">${esc(item.a)}</div></details>`);
  }
  parts.push(`    </div>`);
}
// возражения (если есть) - тем же аккордеоном, отдельной группой
if (objections.length) {
  parts.push(`    <div class="pt-section__head" style="margin-top:32px;"><h2 class="pt-h2">${esc(b.objections_h2 || "Сомнения и возражения")}</h2></div>`);
  parts.push(`    <div class="pt-faq">`);
  for (const item of objections) {
    parts.push(`      <details class="pt-faq__item"><summary>${esc(item.q)}</summary><div class="pt-faq-a">${esc(item.a)}</div></details>`);
  }
  parts.push(`    </div>`);
}
// плитка тегов
if (tagTiles.length) {
  parts.push(`    <div class="pt-tag-tiles" style="margin-top:32px;">`);
  for (const t of tagTiles) {
    const url = t.url || "#lead";
    parts.push(`      <a href="${escAttr(url)}" class="pt-tag-tile">${esc(t.label)}</a>`);
  }
  parts.push(`    </div>`);
}
// перелинковка
if (interlinks.length) {
  parts.push(`    <div class="pt-interlinks" style="margin-top:24px;"><span class="pt-interlinks__label">Смежные услуги:</span>`);
  parts.push(`      ` + interlinks.map((l) => `<a href="${escAttr(l.url || "#")}">${esc(l.anchor)}</a>`).join(" · "));
  parts.push(`    </div>`);
}
parts.push(`  </div>`);
parts.push(`</section>`);

// Schema.org FAQPage (только по faq, не по возражениям - чтобы разметка соответствовала видимым Q/A)
if (faq.length) {
  const schema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faq.map((i) => ({ "@type": "Question", name: String(i.q || ""), acceptedAnswer: { "@type": "Answer", text: String(i.a || "") } })),
  };
  parts.push(`<script type="application/ld+json">${JSON.stringify(schema)}</script>`);
}

writeFileSync(join(pageDir, "faq.html"), parts.join("\n") + "\n", "utf8");

// ---------- Markdown (для клиента/Google Doc) ----------
const md = [];
md.push(`## SEO-блок: ${b.slug || ""}`.trim());
if (b.marker) md.push(`Маркер: ${b.marker}`);
if (arr(b.normalized_keywords).length) md.push(`\n**Нормализованные ключи/N-граммы:** ${arr(b.normalized_keywords).join(", ")}`);
if (faq.length) {
  md.push(`\n### ${b.faq_h2 || "Частые вопросы"}`);
  for (const i of faq) md.push(`\n**${i.q}**\n\n${i.a}`);
}
if (objections.length) {
  md.push(`\n### ${b.objections_h2 || "Сомнения и возражения"}`);
  for (const i of objections) md.push(`\n**${i.q}**\n\n${i.a}`);
}
if (tagTiles.length) md.push(`\n### Плитка тегов\n` + tagTiles.map((t) => `- ${t.label}${t.url ? ` (${t.url})` : ""}`).join("\n"));
if (interlinks.length) md.push(`\n### Перелинковка\n` + interlinks.map((l) => `- ${l.anchor} -> ${l.url || ""}`).join("\n"));
writeFileSync(join(pageDir, "faq.md"), md.join("\n") + "\n", "utf8");

console.log(`[build-faq] ${pageDir}`);
console.log(`  FAQ: ${faq.length}, возражения: ${objections.length}, теги: ${tagTiles.length}, перелинковка: ${interlinks.length}`);
console.log(`  нормализовано ключей: ${arr(b.normalized_keywords).length}, Schema FAQPage: ${faq.length ? "да" : "нет"}`);
