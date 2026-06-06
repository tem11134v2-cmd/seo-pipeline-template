#!/usr/bin/env node
// build-tekst-analysis-docx.mjs
// Клиентский документ согласования: анализ ЦА + стратегия оффера, ДО написания текстов.
// Заказчик читает -> OK или правки -> revising-цикл (паттерн /seo-analiz).
//
// Вход:  <texts_dir>/inputs.json, audience.json, strategy.json
// Выход: <texts_dir>/Analysis_<slug>.docx
// Использование: node build-tekst-analysis-docx.mjs <texts_dir>

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve, basename } from "node:path";
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } from "docx";

const dir = process.argv[2] ? resolve(process.argv[2]) : null;
if (!dir) { console.error("[build-tekst-analysis-docx] usage: <texts_dir>"); process.exit(1); }
const readJson = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8").replace(/^﻿/, "")) : {});

const inputs = readJson(join(dir, "inputs.json"));
const audience = readJson(join(dir, "audience.json"));
const strategy = readJson(join(dir, "strategy.json"));

const slug = inputs.slug || (basename(dir).match(/^\d+-(.+)$/) || [, "site"])[1];
const company = inputs.brand_name || inputs.company || inputs.domain || slug;
const NAVY = "1F4E79";
const out = [];

const H1 = (t) => out.push(new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 240, after: 120 }, children: [new TextRun({ text: t, bold: true, color: NAVY, font: "Arial", size: 30 })] }));
const H2 = (t) => out.push(new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 200, after: 80 }, children: [new TextRun({ text: t, bold: true, color: NAVY, font: "Arial", size: 26 })] }));
const H3 = (t) => out.push(new Paragraph({ spacing: { before: 120, after: 40 }, children: [new TextRun({ text: t, bold: true, font: "Arial", size: 23 })] }));
const P = (t, opts = {}) => out.push(new Paragraph({ spacing: { after: 80 }, children: [new TextRun({ text: String(t), font: "Arial", size: 22, ...opts })] }));
const LI = (t) => out.push(new Paragraph({ bullet: { level: 0 }, spacing: { after: 30 }, children: [new TextRun({ text: String(t), font: "Arial", size: 22 })] }));
const SPACER = () => out.push(new Paragraph({ children: [new TextRun({ text: "" })] }));
const arr = (x) => (Array.isArray(x) ? x : x ? [x] : []);

// ---------- шапка ----------
out.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 60 }, children: [new TextRun({ text: "Анализ ЦА и стратегия текстов", bold: true, color: NAVY, font: "Arial", size: 36 })] }));
out.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 }, children: [new TextRun({ text: company + (inputs.niche ? "  -  " + inputs.niche : ""), italics: true, font: "Arial", size: 24, color: "666666" })] }));
P("Документ на согласование ПЕРЕД написанием текстов. Проверьте: верно ли пойман портрет клиента, боли, позиционирование и оффер. После вашего OK (или правок) пишем тексты страниц.", { italics: true, color: "888888" });
SPACER();

// ---------- стратегия / оффер ----------
H1("1. Позиционирование и стратегия");
if (strategy.positioning) { H3("Позиционирование (одной строкой)"); P(strategy.positioning, { bold: true }); }
if (strategy.warmth_stage != null) { H3("Стадия прогретости аудитории"); P(`Стадия ${strategy.warmth_stage} - ${strategy.warmth_rationale || ""}`); }
if (strategy.idea) { H3("Идея / красная нить"); P(strategy.idea, { bold: true }); }
if (strategy.offer_formula) { H3("Формула оффера"); P(`№${strategy.offer_formula}${strategy.offer_formula_name ? " - " + strategy.offer_formula_name : ""}`); }
if (strategy.design_theme) P(`Дизайн-направление (палитра): ${strategy.design_theme}`, { color: "888888" });

if (arr(strategy.selling_theses).length) { H2("Продающие тезисы (факт -> выгода)"); for (const t of arr(strategy.selling_theses)) LI(t); }
if (arr(strategy.proof_inventory).length) { H2("Подтверждённые цифры/доказательства"); for (const t of arr(strategy.proof_inventory)) LI(t); }
if (arr(strategy.materials_have).length || arr(strategy.materials_missing).length) {
  H2("Материалы проекта");
  if (arr(strategy.materials_have).length) { H3("Есть в наличии"); for (const t of arr(strategy.materials_have)) LI(t); }
  if (arr(strategy.materials_missing).length) { H3("Нужно собрать (иначе блок не закладываем)"); for (const t of arr(strategy.materials_missing)) LI(t); }
}
SPACER();

// ---------- аудитория ----------
H1("2. Анализ целевой аудитории");
const personas = arr(audience.personas);
personas.forEach((p, i) => {
  H2(`Портрет ${i + 1}: ${p.name || "Сегмент"}`);
  const facts = [p.age && `возраст ${p.age}`, p.income && `доход ${p.income}`, p.family, p.lifestyle].filter(Boolean).join("; ");
  if (facts) P(facts);
  if (p.values) P("Ценности: " + p.values);
  if (arr(p.page_links).length) P("Страницы сайта: " + arr(p.page_links).join(", "), { color: "888888" });
  if (arr(p.pains).length) { H3("Боли"); for (const pain of arr(p.pains)) LI(typeof pain === "string" ? pain : (pain.problem || JSON.stringify(pain))); }
  if (arr(p.fears).length) { H3("Страхи"); for (const f of arr(p.fears)) LI(f); }
  if (arr(p.objections).length) { H3("Возражения"); for (const o of arr(p.objections)) LI(typeof o === "string" ? o : `${o.says || ""}${o.behind ? " -> " + o.behind : ""}`); }
  if (p.transformation) { const t = p.transformation; H3("Трансформация (результат)"); P([t.changed, t.feels, t.others_say].filter(Boolean).join(" / ")); }
});

const sum = audience.summary || {};
if (Object.keys(sum).length) {
  H2("Компактная сводка");
  const blocks = [["Боли", sum.pains], ["Страхи", sum.fears], ["Возражения", sum.objections], ["Триггеры конверсии", sum.triggers], ["Цитаты клиентов", sum.quotes]];
  for (const [label, items] of blocks) if (arr(items).length) { H3(label); for (const it of arr(items)) LI(it); }
}

SPACER();
P("- - - конец документа на согласование - - -", { color: "AAAAAA", italics: true });

// ---------- запись ----------
const doc = new Document({ sections: [{ properties: { page: { margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } }, children: out }] });
const outPath = join(dir, `Analysis_${slug}.docx`);
const buffer = await Packer.toBuffer(doc);
writeFileSync(outPath, buffer);
console.log(`[build-tekst-analysis-docx] wrote ${outPath}`);
console.log(`  персонажей: ${personas.length}, тезисов: ${arr(strategy.selling_theses).length}`);
