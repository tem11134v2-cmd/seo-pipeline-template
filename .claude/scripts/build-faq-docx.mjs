#!/usr/bin/env node
// build-faq-docx.mjs
// Клиентский документ с SEO-блоками (FAQ + возражения + теги + перелинковка) по всем страницам.
// Вход:  <faq_dir>/inputs.json, pages/<slug>/faq_blocks.json
// Выход: <faq_dir>/FAQ_<slug>.docx
// Использование: node build-faq-docx.mjs <faq_dir>

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve, basename } from "node:path";
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, PageBreak } from "docx";

const dir = process.argv[2] ? resolve(process.argv[2]) : null;
if (!dir) { console.error("[build-faq-docx] usage: <faq_dir>"); process.exit(1); }
const readJson = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8").replace(/^﻿/, "")) : {});
const arr = (x) => (Array.isArray(x) ? x : []);

const inputs = readJson(join(dir, "inputs.json"));
const slug = inputs.slug || (basename(dir).match(/^\d+-(.+)$/) || [, "site"])[1];
const company = inputs.brand_name || inputs.company || inputs.domain || slug;
const NAVY = "1F4E79";
const out = [];
const H1 = (t) => out.push(new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 200, after: 100 }, children: [new TextRun({ text: t, bold: true, color: NAVY, font: "Arial", size: 30 })] }));
const H2 = (t) => out.push(new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 160, after: 60 }, children: [new TextRun({ text: t, bold: true, color: NAVY, font: "Arial", size: 24 })] }));
const Q = (t) => out.push(new Paragraph({ spacing: { before: 80, after: 20 }, children: [new TextRun({ text: t, bold: true, font: "Arial", size: 22 })] }));
const A = (t) => out.push(new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: String(t), font: "Arial", size: 22 })] }));
const NOTE = (t) => out.push(new Paragraph({ spacing: { after: 80 }, children: [new TextRun({ text: t, italics: true, font: "Arial", size: 20, color: "888888" })] }));

const pagesDir = join(dir, "pages");
let pageDirs = [];
if (existsSync(pagesDir)) pageDirs = readdirSync(pagesDir).map((d) => join(pagesDir, d)).filter((p) => { try { return statSync(p).isDirectory() && existsSync(join(p, "faq_blocks.json")); } catch { return false; } });

out.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 60 }, children: [new TextRun({ text: "SEO-блоки страниц (FAQ + теги + перелинковка)", bold: true, color: NAVY, font: "Arial", size: 34 })] }));
out.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 160 }, children: [new TextRun({ text: company, italics: true, font: "Arial", size: 24, color: "666666" })] }));
NOTE("Блоки добавляются в конец готовых страниц. FAQ размечается Schema.org FAQPage (микроразметка для Яндекса). Цель - нормализация текстовой релевантности: добавить недостающие ключи/N-граммы естественным языком.");

let pageCount = 0, faqTotal = 0;
for (let i = 0; i < pageDirs.length; i++) {
  const b = readJson(join(pageDirs[i], "faq_blocks.json"));
  if (i > 0) out.push(new Paragraph({ children: [new PageBreak()] }));
  H1(`${b.slug || basename(pageDirs[i])}${b.marker ? "  (" + b.marker + ")" : ""}`);
  if (arr(b.normalized_keywords).length) NOTE("Нормализованные ключи/N-граммы: " + arr(b.normalized_keywords).join(", "));
  if (arr(b.faq).length) { H2(b.faq_h2 || "Частые вопросы"); for (const it of b.faq) { Q(it.q); A(it.a); faqTotal++; } }
  if (arr(b.objections).length) { H2(b.objections_h2 || "Сомнения и возражения"); for (const it of b.objections) { Q(it.q); A(it.a); } }
  if (arr(b.tag_tiles).length) { H2("Плитка тегов"); A(b.tag_tiles.map((t) => t.label).join("  -  ")); }
  if (arr(b.interlinks).length) { H2("Перелинковка"); for (const l of b.interlinks) A(`${l.anchor} -> ${l.url || ""}`); }
  pageCount++;
}

const doc = new Document({ sections: [{ properties: { page: { margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } }, children: out }] });
const outPath = join(dir, `FAQ_${slug}.docx`);
writeFileSync(outPath, await Packer.toBuffer(doc));
console.log(`[build-faq-docx] wrote ${outPath}`);
console.log(`  страниц: ${pageCount}, FAQ-вопросов: ${faqTotal}`);
