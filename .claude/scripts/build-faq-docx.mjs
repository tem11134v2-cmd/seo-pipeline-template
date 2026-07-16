#!/usr/bin/env node
// build-faq-docx.mjs
// КАНОНИЧЕСКИЙ клиентский документ /seo-faq: единый Google Doc из 2 разделов.
//   Раздел 1 - Текстовый FAQ (человекочитаемо, с настоящими гиперссылками-в-словах + адрес в скобках).
//   Раздел 2 - Schema.org (FAQPage) - моноширинный JSON-LD для разработчика.
// Вход:  <faq_dir>/inputs.json, pages.json, pages/<slug>/faq_blocks.json
// Выход: <faq_dir>/FAQ_<slug>.docx
// Использование: node build-faq-docx.mjs <faq_dir>

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve, basename } from "node:path";
import { Document, Packer, Paragraph, TextRun, ExternalHyperlink, HeadingLevel, AlignmentType, PageBreak } from "docx";
import { sameUrl, resolveSelfUrl } from "./_faq-util.mjs";

const dir = process.argv[2] ? resolve(process.argv[2]) : null;
if (!dir) { console.error("[build-faq-docx] usage: <faq_dir>"); process.exit(1); }
const readJson = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8").replace(/^﻿/, "")) : {});
const arr = (x) => (Array.isArray(x) ? x : []);
// буква ё запрещена в клиентских текстах (как и тире) - но, в отличие от тире (см. sweep
// ниже, там сборка ПАДАЕТ), для ё сборка не падает: нормализуем ё->е/Ё->Е сразу после
// чтения источников, ДО того как из них соберутся параграфы/схема - так и финальный sweep
// по тире ниже её уже не увидит, и в самом docx ё не окажется.
function normYo(v) {
  if (typeof v === "string") return v.replace(/ё/g, "е").replace(/Ё/g, "Е");
  if (Array.isArray(v)) return v.map(normYo);
  if (v && typeof v === "object") {
    const o = {};
    for (const k of Object.keys(v)) o[k] = normYo(v[k]);
    return o;
  }
  return v;
}

const inputs = normYo(readJson(join(dir, "inputs.json")));
const slug = inputs.slug || (basename(dir).match(/^\d+-(.+)$/) || [, "site"])[1];
const company = inputs.brand_name || inputs.company || inputs.domain || slug;
const NAVY = "1F4E79";
const out = [];
const sweep = []; // весь пользовательский текст для финальной проверки на тире
const track = (t) => { sweep.push(String(t == null ? "" : t)); return t; };

const H1 = (t) => { track(t); out.push(new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 240, after: 120 }, children: [new TextRun({ text: t, bold: true, color: NAVY, font: "Arial", size: 30 })] })); };
const H2 = (t) => { track(t); out.push(new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 160, after: 60 }, children: [new TextRun({ text: t, bold: true, color: NAVY, font: "Arial", size: 24 })] })); };
const BOLDP = (t) => { track(t); out.push(new Paragraph({ spacing: { before: 100, after: 40 }, children: [new TextRun({ text: t, bold: true, font: "Arial", size: 22 })] })); };
const Q = (t) => { track(t); out.push(new Paragraph({ spacing: { before: 80, after: 20 }, children: [new TextRun({ text: t, bold: true, font: "Arial", size: 22 })] })); };
const APARA = (runs) => out.push(new Paragraph({ spacing: { after: 60 }, children: runs }));
const NOTE = (t) => { track(t); out.push(new Paragraph({ spacing: { after: 80 }, children: [new TextRun({ text: t, italics: true, font: "Arial", size: 20, color: "888888" })] })); };
const CODE = (line) => { track(line); out.push(new Paragraph({ children: [new TextRun({ text: line, font: "Courier New", size: 18 })], spacing: { after: 0 } })); };

// Ответ -> массив run-ов с возможной inline-гиперссылкой.
// ИНВАРИАНТ (синхрон с build-faq): точка разреза = ПЕРВОЕ вхождение анкора по СЫРОМУ a.
function buildAnswerRuns(a, link, self) {
  a = String(a == null ? "" : a);
  if (link && link.anchor && link.url && !sameUrl(link.url, self)) {
    const idx = a.indexOf(link.anchor); // ПЕРВОЕ вхождение по сырому a
    if (idx !== -1) {
      track(a); track(link.url);
      // docx@9: ExternalHyperlink - run-level; стиль Hyperlink может отсутствовать -> цвет/underline вручную.
      return [
        new TextRun({ text: a.slice(0, idx), font: "Arial", size: 22 }),
        new ExternalHyperlink({ link: link.url, children: [new TextRun({ text: link.anchor, color: "0563C1", underline: {}, font: "Arial", size: 22 })] }),
        new TextRun({ text: a.slice(idx + link.anchor.length), font: "Arial", size: 22 }),
        new TextRun({ text: " (ссылка: " + link.url + ")", font: "Arial", size: 22 }),
      ];
    }
  }
  track(a);
  return [new TextRun({ text: a, font: "Arial", size: 22 })];
}

function schemaFor(faq) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faq.map((i) => ({ "@type": "Question", name: String(i.q || ""), acceptedAnswer: { "@type": "Answer", text: String(i.a == null ? "" : i.a) } })),
  };
}

// Список папок страниц.
const pagesDir = join(dir, "pages");
let pageDirs = [];
if (existsSync(pagesDir)) pageDirs = readdirSync(pagesDir).map((d) => join(pagesDir, d)).filter((p) => { try { return statSync(p).isDirectory() && existsSync(join(p, "faq_blocks.json")); } catch { return false; } });
const blocks = pageDirs.map((pd) => ({ pd, b: normYo(readJson(join(pd, "faq_blocks.json"))) }));

// ---------- Титул ----------
out.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 60 }, children: [new TextRun({ text: track("FAQ для страниц сайта"), bold: true, color: NAVY, font: "Arial", size: 34 })] }));
out.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 160 }, children: [new TextRun({ text: track(company), italics: true, font: "Arial", size: 24, color: "666666" })] }));
NOTE("Документ состоит из двух разделов. Раздел 1 - текстовый FAQ: вопросы и ответы, которые добавляются в конец готовой страницы. Раздел 2 - код Schema.org: микроразметка, которую разработчик добавляет на сайт отдельно. Тире в текстах не используются - только дефис.");

// ---------- РАЗДЕЛ 1: Текстовый FAQ ----------
H1("Раздел 1. Текстовый FAQ (добавить на страницы)");
NOTE("Это вопросы и ответы, которые мы добавляем в конец готовой страницы (они не заменяют существующий контент). Подсвеченные слова в ответах - это реальные ссылки на смежные страницы сайта; адрес каждой ссылки продублирован рядом в скобках, чтобы верстальщик понимал, куда она ведёт. Текст ответов менять не нужно.");

let pageCount = 0, faqTotal = 0;
for (let i = 0; i < blocks.length; i++) {
  const { pd, b } = blocks[i];
  const selfUrl = resolveSelfUrl(pd, b.slug);
  if (i > 0) out.push(new Paragraph({ children: [new PageBreak()] }));
  H2(`${b.slug || basename(pd)}${b.marker ? "  (" + b.marker + ")" : ""}`);
  if (arr(b.normalized_keywords).length) NOTE("Нормализованные ключи/N-граммы: " + arr(b.normalized_keywords).join(", "));
  const faq = arr(b.faq);
  if (faq.length) {
    if (b.faq_h2) BOLDP(b.faq_h2);
    for (const it of faq) { Q(it.q); APARA(buildAnswerRuns(it.a, arr(it.links)[0], selfUrl)); faqTotal++; }
  } else {
    NOTE("FAQ для страницы не сгенерирован.");
  }
  if (arr(b.faq_overflow).length) NOTE("Кандидаты на отдельную FAQ-страницу: " + arr(b.faq_overflow).map((o) => track(o.q)).join("; "));
  pageCount++;
}

// ---------- РАЗДЕЛ 2: Schema.org ----------
out.push(new Paragraph({ children: [new PageBreak()] }));
H1("Раздел 2. Schema.org (FAQPage) - код для сайта");
NOTE("Этот код добавляется на сайт отдельно - в раздел <head> страницы или прямо перед закрывающим тегом </body>. На странице он визуально не виден: он нужен только поисковым системам (Яндекс, Google), чтобы они распознали блок вопросов-ответов. Текст внутри кода должен совпадать с видимым FAQ из Раздела 1. Ссылки в этот код НЕ входят - они есть только в видимой части. Добавляет этот код разработчик.");
for (const { pd, b } of blocks) {
  H2(`${b.slug || basename(pd)}`);
  const faq = arr(b.faq);
  if (!faq.length) { NOTE("Schema не сгенерирована (нет FAQ)."); continue; }
  const json = JSON.stringify(schemaFor(faq), null, 2); // pretty - намеренно (в отличие от компактного html)
  for (const line of json.split("\n")) CODE(line);
}

// ---------- финальный sweep на тире ----------
const dashHit = sweep.join("\n").match(/—|–/);
if (dashHit) {
  console.error("[build-faq-docx] НАЙДЕНО тире (— или –) - запрещено везде (NOTE/Q/A/url/JSON-LD). Исправь faq_blocks.json и пересобери.");
  process.exit(1);
}

const doc = new Document({ sections: [{ properties: { page: { margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } }, children: out }] });
const outPath = join(dir, `FAQ_${slug}.docx`);
writeFileSync(outPath, await Packer.toBuffer(doc));
console.log(`[build-faq-docx] wrote ${outPath}`);
console.log(`  страниц: ${pageCount}, FAQ-вопросов: ${faqTotal}`);
