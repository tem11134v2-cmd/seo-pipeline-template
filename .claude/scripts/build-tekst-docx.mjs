#!/usr/bin/env node
// build-tekst-docx.mjs
// Финальный клиентский документ с текстами всех страниц (читабельная проза из page.json).
// Идёт рядом с HTML-прототипами - заказчик смотрит, где удобнее.
//
// Вход:  <texts_dir>/inputs.json, pages/<slug>/page.json (по странице)
// Выход: <texts_dir>/Texts_<slug>.docx
// Использование: node build-tekst-docx.mjs <texts_dir>

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve, basename } from "node:path";
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, PageBreak } from "docx";

const dir = process.argv[2] ? resolve(process.argv[2]) : null;
if (!dir) { console.error("[build-tekst-docx] usage: <texts_dir>"); process.exit(1); }
const readJson = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8").replace(/^﻿/, "")) : {});

const inputs = readJson(join(dir, "inputs.json"));
const slug = inputs.slug || (basename(dir).match(/^\d+-(.+)$/) || [, "site"])[1];
const company = inputs.brand_name || inputs.company || inputs.domain || slug;
const NAVY = "1F4E79";
const out = [];

const arr = (x) => (Array.isArray(x) ? x : x ? [x] : []);
const H1 = (t) => out.push(new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 200, after: 100 }, children: [new TextRun({ text: t, bold: true, color: NAVY, font: "Arial", size: 30 })] }));
const H2 = (t) => out.push(new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 180, after: 70 }, children: [new TextRun({ text: t, bold: true, color: NAVY, font: "Arial", size: 25 })] }));
const LABEL = (t) => out.push(new Paragraph({ spacing: { before: 60, after: 20 }, children: [new TextRun({ text: t, bold: true, italics: true, font: "Arial", size: 20, color: "888888" })] }));
const P = (t, opts = {}) => out.push(new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: String(t), font: "Arial", size: 22, ...opts })] }));
const LI = (t) => out.push(new Paragraph({ bullet: { level: 0 }, spacing: { after: 25 }, children: [new TextRun({ text: String(t), font: "Arial", size: 22 })] }));

// читабельный рендер одного объекта-элемента: склейка строковых полей через " - "
function elText(el) {
  if (typeof el === "string") return el;
  if (el == null) return "";
  const order = ["title", "name", "q", "a", "value", "label", "tagline", "price", "text", "result", "param", "us", "them"];
  const parts = [];
  for (const k of order) if (el[k] != null && String(el[k]).trim()) parts.push(String(el[k]));
  for (const k of Object.keys(el)) if (!order.includes(k) && typeof el[k] === "string" && el[k].trim()) parts.push(el[k]);
  return parts.join(" - ");
}

// рендер слотов блока в читабельную прозу
function renderSlots(slots) {
  if (!slots || typeof slots !== "object") return;
  // 1. скаляры в логичном порядке
  const scalarOrder = ["h1", "subhead", "lead", "form_title", "text", "note", "form_note", "map_alt"];
  for (const k of scalarOrder) if (typeof slots[k] === "string" && slots[k].trim()) P(slots[k], k === "h1" ? { bold: true, size: 26 } : {});
  if (typeof slots.cta_label === "string" && slots.cta_label.trim()) P("Кнопка: " + slots.cta_label, { italics: true, color: "555555" });
  if (typeof slots.bonus === "string" && slots.bonus.trim()) P(slots.bonus, { italics: true });
  // 2. массивы
  for (const [k, v] of Object.entries(slots)) {
    if (!Array.isArray(v) || v.length === 0) continue;
    // вложенные features (массив строк) выведутся внутри tariffs ниже; пропустим верхнеуровневые известные служебные
    if (k === "tariffs") {
      for (const t of v) {
        LABEL((t.name || "Тариф") + (t.badge ? " [" + t.badge + "]" : t.featured ? " (рекомендуем)" : "") + (t.price ? " - " + t.price : ""));
        if (t.tagline) P(t.tagline, { italics: true });
        if (t.price_note) P(t.price_note, { italics: true, color: "888888" });
        for (const f of arr(t.features)) LI(typeof f === "string" ? f : elText(f));
        if (t.cta) P("Кнопка: " + t.cta, { italics: true, color: "555555" });
      }
      continue;
    }
    if (k === "rows") {
      // compare-table: заголовки колонок + строки в порядке «параметр - у нас - у них»
      const hdr = [slots.col_param, slots.col_us, slots.col_them].filter(Boolean).join(" / ");
      if (hdr) LABEL(hdr);
      for (const r of v) LI([r.param, r.us, r.them].filter(Boolean).join(" - "));
      continue;
    }
    if (k === "key_specs") { for (const el of v) LI([el.label, el.value].filter(Boolean).join(": ")); continue; }
    if (k === "select_options" || k === "areas") { P([k === "areas" ? "География: " : "Варианты: ", v.map(elText).join(", ")].join("")); continue; }
    for (const el of v) LI(elText(el));
  }
}

// ---------- сбор страниц ----------
const pagesDir = join(dir, "pages");
let pageDirs = [];
if (existsSync(pagesDir)) {
  pageDirs = readdirSync(pagesDir).map((d) => join(pagesDir, d)).filter((p) => { try { return statSync(p).isDirectory() && existsSync(join(p, "page.json")); } catch { return false; } });
}

// ---------- шапка ----------
out.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 60 }, children: [new TextRun({ text: "Тексты страниц сайта", bold: true, color: NAVY, font: "Arial", size: 36 })] }));
out.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 160 }, children: [new TextRun({ text: company, italics: true, font: "Arial", size: 24, color: "666666" })] }));
P(`Страниц: ${pageDirs.length}. Пометки [ЗАПОЛНИТЬ: ...] - данные, которые нужно подставить (реальные цифры, отзывы, фото).`, { italics: true, color: "888888" });

let pageCount = 0;
let blockCount = 0;
for (let i = 0; i < pageDirs.length; i++) {
  const page = readJson(join(pageDirs[i], "page.json"));
  const meta = page.page || {};
  if (i > 0) out.push(new Paragraph({ children: [new PageBreak()] }));
  H1(`${meta.type || "Страница"}: ${meta.title || meta.slug || basename(pageDirs[i])}`);
  if (meta.url) P(meta.url, { color: "888888", italics: true });
  if (page.h1) P(page.h1, { bold: true, size: 28 });
  pageCount++;
  for (const b of arr(page.blocks)) {
    const h2 = b.h2 || (b.slots && b.slots.h2) || "";
    if (h2) H2(h2);
    // дедуп H1: page.h1 уже напечатан на уровне страницы - не повторять из слотов (hero, product-gallery)
    const slots = { ...(b.slots || {}) };
    if (typeof slots.h1 === "string" && typeof page.h1 === "string" && slots.h1.trim() === page.h1.trim()) delete slots.h1;
    renderSlots(slots);
    for (const fn of arr(b.fill_notes)) P(`[ЗАПОЛНИТЬ: ${fn}]`, { color: "C00000", italics: true });
    blockCount++;
  }
}

const doc = new Document({ sections: [{ properties: { page: { margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } }, children: out }] });
const outPath = join(dir, `Texts_${slug}.docx`);
const buffer = await Packer.toBuffer(doc);
writeFileSync(outPath, buffer);
console.log(`[build-tekst-docx] wrote ${outPath}`);
console.log(`  страниц: ${pageCount}, блоков: ${blockCount}`);
