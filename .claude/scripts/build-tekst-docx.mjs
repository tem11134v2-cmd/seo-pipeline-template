#!/usr/bin/env node
// build-tekst-docx.mjs
// Финальный клиентский документ с текстами всех страниц (читабельная проза из page.json).
// Идёт рядом с HTML-прототипами - заказчик смотрит, где удобнее.
//
// Вход:  <texts_dir>/inputs.json, pages/<slug>/page.json (по странице)
//        (+ pages.json - опц., задает порядок страниц)
// Выход: <texts_dir>/Texts_<slug>.docx
// Использование: node build-tekst-docx.mjs <texts_dir>
//
// Нет ни одной страницы - exit 1 без документа: пустой docx уезжал заказчику как готовый.
// Из fill_notes печатаются только строки с маркером [ЗАПОЛНИТЬ (и печатаются как есть);
// служебные заметки редактора и поле notes_internal в клиентский документ не идут.

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve, basename } from "node:path";
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, PageBreak } from "docx";

const dir = process.argv[2] ? resolve(process.argv[2]) : null;
if (!dir) { console.error("[build-tekst-docx] usage: <texts_dir>"); process.exit(1); }
// Битый JSON раньше выходил наружу голым стеком SyntaxError; читателю нужен диагноз -
// какой файл сломан. Файла нет - это норма ({}), файл есть и не разбирается - имя вслух.
const brokenFiles = [];
const readJson = (p) => {
  if (!existsSync(p)) return {};
  try { return JSON.parse(readFileSync(p, "utf8").replace(/^﻿/, "")); }
  catch (e) {
    brokenFiles.push(p);
    console.error(`[build-tekst-docx] НЕ РАЗОБРАН ${p}: ${e.message}`);
    return null;
  }
};

const inputs = readJson(join(dir, "inputs.json")) || {};
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

// служебные поля верстки: адрес ссылки, подпись к картинке, иконка, идентификатор.
// В клиентском документе им не место - заказчик читал «/catalog/demo-1/ - Подробнее -
// Приточная установка в венткамере» как часть текста страницы.
const SERVICE_KEYS = new Set(["url", "href", "link", "media_alt", "image_alt", "photo_alt", "alt", "icon", "image", "img", "src", "id", "slug", "anchor", "target", "cta_url"]);

// читабельный рендер одного объекта-элемента: склейка строковых полей через " - "
function elText(el) {
  if (typeof el === "string") return el;
  if (el == null) return "";
  const order = ["title", "name", "q", "a", "value", "label", "tagline", "price", "text", "result", "param", "us", "them"];
  const parts = [];
  for (const k of order) if (el[k] != null && String(el[k]).trim()) parts.push(String(el[k]));
  for (const k of Object.keys(el)) {
    if (order.includes(k) || SERVICE_KEYS.has(k)) continue;
    if (typeof el[k] === "string" && el[k].trim()) parts.push(el[k]);
  }
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
  pageDirs = readdirSync(pagesDir).sort().map((d) => join(pagesDir, d)).filter((p) => { try { return statSync(p).isDirectory() && existsSync(join(p, "page.json")); } catch { return false; } });
}
// Нет страниц - это сбой, а не пустой документ: раньше скрипт писал docx из одной шапки,
// выходил с кодом 0, и шаг 7 грузил заказчику пустой файл как готовый результат.
if (pageDirs.length === 0) {
  console.error(`[build-tekst-docx] нет ни одной страницы в ${pagesDir} - документ не собран`);
  process.exit(1);
}

// порядок страниц - как в pages.json (там он осмысленный: главная первой);
// чего там нет - в конец по алфавиту. Тот же код, что в build-handoff.mjs.
const order = new Map();
for (const [i, p] of arr((readJson(join(dir, "pages.json")) || {}).pages).entries()) {
  const k = p && p.slug ? String(p.slug).trim() : "";
  if (k && !order.has(k)) order.set(k, Number.isFinite(p.n) ? p.n : i);
}
if (order.size) {
  const rank = (p) => (order.has(basename(p)) ? order.get(basename(p)) : Number.MAX_SAFE_INTEGER);
  pageDirs.sort((a, b) => rank(a) - rank(b) || basename(a).localeCompare(basename(b)));
}

// Страницы читаем ДО шапки: в шапке стоит их число, и оно должно быть правдой,
// а не числом папок (битый page.json раньше молча выпадал уже после подсчета).
const loaded = [];
const brokenPages = [];
for (const pd of pageDirs) {
  const page = readJson(join(pd, "page.json"));
  if (!page || typeof page !== "object") {
    brokenPages.push(basename(pd));
    console.error(`[build-tekst-docx] страница пропущена (page.json не читается): ${basename(pd)}`);
    continue;
  }
  loaded.push({ pd, page });
}
if (loaded.length === 0) {
  console.error(`[build-tekst-docx] ни одна страница не читается в ${pagesDir} - документ не собран`);
  process.exit(1);
}

// ---------- шапка ----------
out.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 60 }, children: [new TextRun({ text: "Тексты страниц сайта", bold: true, color: NAVY, font: "Arial", size: 36 })] }));
out.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 160 }, children: [new TextRun({ text: company, italics: true, font: "Arial", size: 24, color: "666666" })] }));
P(`Страниц: ${loaded.length}. Пометки [ЗАПОЛНИТЬ: ...] - данные, которые нужно подставить (реальные цифры, отзывы, фото).`, { italics: true, color: "888888" });

let pageCount = 0;
let blockCount = 0;
let internalNotes = 0;
for (const { pd, page } of loaded) {
  const meta = page.page || {};
  if (pageCount > 0) out.push(new Paragraph({ children: [new PageBreak()] }));
  H1(`${meta.type || "Страница"}: ${meta.title || meta.slug || basename(pd)}`);
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
    // В клиентский документ идет ТОЛЬКО то, что заполняет заказчик, - строка с маркером
    // [ЗАПОЛНИТЬ, и печатается она как есть. Раньше обертывалась КАЖДАЯ строка fill_notes:
    // служебные заметки редактора («слот короче лимита: срезан хвост») уезжали заказчику
    // как список задач, а готовый маркер оборачивался второй раз - «[ЗАПОЛНИТЬ: [ЗАПОЛНИТЬ: фото]]».
    // Поле notes_internal не читается принципиально: оно служебное по определению.
    //
    // ОБРАТНАЯ СОВМЕСТИМОСТЬ. В задачах, начатых до разделения лент, поля notes_internal нет,
    // а в fill_notes лежали ГОЛЫЕ строки-дыры («реальное число объектов»), которые сборщик сам
    // оборачивал в маркер. Строгий фильтр молча съел бы их и отдал заказчику документ без
    // единого вопроса. Признак старого формата - у блока нет notes_internal: тогда голую строку
    // печатаем, как печатали раньше. Новый формат (поле есть) фильтруется строго.
    const legacyBlock = b.notes_internal === undefined;
    for (const fn of arr(b.fill_notes)) {
      const t = String(fn == null ? "" : fn).trim();
      if (!t) continue;
      if (/\[ЗАПОЛНИТЬ[^\]]*\]/.test(t)) P(t, { color: "C00000", italics: true });
      else if (legacyBlock) P(`[ЗАПОЛНИТЬ: ${t}]`, { color: "C00000", italics: true });
      else internalNotes++;
    }
    internalNotes += arr(b.notes_internal).length;
    blockCount++;
  }
}

const doc = new Document({ sections: [{ properties: { page: { margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } }, children: out }] });
const outPath = join(dir, `Texts_${slug}.docx`);
const buffer = await Packer.toBuffer(doc);
writeFileSync(outPath, buffer);
console.log(`[build-tekst-docx] wrote ${outPath}`);
console.log(`  страниц: ${pageCount}, блоков: ${blockCount}`);
if (internalNotes) console.log(`  служебных пометок не выведено (нет маркера [ЗАПОЛНИТЬ): ${internalNotes}`);
if (brokenPages.length) console.error(`  НЕ СОБРАНЫ (битый page.json): ${brokenPages.join(", ")} - документ отдан заказчику НЕПОЛНЫМ`);
if (brokenFiles.length) console.error(`  не разобрано файлов: ${brokenFiles.length}`);
