#!/usr/bin/env node
// build-skeletons-docx.mjs
// Генерирует Skeletons_<slug>.docx - клиентский документ гейта скелетов (/seo-tekst v7.1,
// контракты 3.3-3.3а). Собирается ПОСЛЕ такта 1 block-planner и ДО тон-гейта: заказчик
// согласует состав блоков каждого типа страницы до того, как оплачен веер писателей.
//
// Зависимости: docx (npm install docx) - уже в package.json (от build-strategy-docx.mjs).
//
// Использование:
//   node .claude/scripts/build-skeletons-docx.mjs <texts_dir>
//
// Вход:
//   <texts_dir>/type_skeletons.json - скелеты типов (block-planner, такт 1; ОБЯЗАТЕЛЕН)
//   <texts_dir>/pages.json          - состав страниц (мост; ОБЯЗАТЕЛЕН - список страниц по типу)
//   <texts_dir>/inputs.json         - slug и brand_name (опционален, есть fallback)
// Выход:
//   <texts_dir>/Skeletons_<slug>.docx
//
// Правило клиентского текста (контракт 3.3а): жаргон заказчику НЕ печатается - поля
// function (Р/Д/К/В), evidence и status в документ не попадают вовсе, а из notes
// механически вычищаются кухонные фрагменты (coverage, typical_order, имена файлов
// и внутренних инструментов). Таблица по каждому типу: «Блок / Зачем / Что внутри»
// (client_why -> «Зачем», очищенные notes -> «Что внутри», required-блок помечен
// «(обязательный)»). Типографика проекта: дефис вместо тире, е вместо е-с-точками.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Footer, AlignmentType, BorderStyle, WidthType, ShadingType, TableLayoutType,
} from "docx";

const textsDirArg = process.argv[2];
if (!textsDirArg) {
  console.error("[build-skeletons-docx] usage: node build-skeletons-docx.mjs <texts_dir>");
  process.exit(1);
}
const textsDir = resolve(textsDirArg);

const skeletonsPath = join(textsDir, "type_skeletons.json");
const pagesPath = join(textsDir, "pages.json");
const inputsPath = join(textsDir, "inputs.json");

if (!existsSync(skeletonsPath)) {
  console.error(`[build-skeletons-docx] not found: ${skeletonsPath} - сначала такт 1 block-planner`);
  process.exit(1);
}
if (!existsSync(pagesPath)) {
  console.error(`[build-skeletons-docx] not found: ${pagesPath} - без состава страниц документ гейта не собрать`);
  process.exit(1);
}

const readJson = (p) => JSON.parse(readFileSync(p, "utf8").replace(/^﻿/, ""));

let skeletonsDoc;
try {
  skeletonsDoc = readJson(skeletonsPath);
} catch (err) {
  console.error(`[build-skeletons-docx] type_skeletons.json не парсится: ${err.message}`);
  process.exit(1);
}
let pagesDoc;
try {
  pagesDoc = readJson(pagesPath);
} catch (err) {
  console.error(`[build-skeletons-docx] pages.json не парсится: ${err.message}`);
  process.exit(1);
}

const typesPresent = Array.isArray(skeletonsDoc.types_present) ? skeletonsDoc.types_present : [];
const skeletons = skeletonsDoc.skeletons && typeof skeletonsDoc.skeletons === "object" ? skeletonsDoc.skeletons : {};
if (!typesPresent.length) {
  console.error("[build-skeletons-docx] types_present пуст - документа гейта не будет");
  process.exit(1);
}
const pages = Array.isArray(pagesDoc.pages) ? pagesDoc.pages : [];

let inputs = {};
if (existsSync(inputsPath)) {
  try { inputs = readJson(inputsPath); } catch { /* fallback ниже */ }
}

// Slug для имени файла: ASCII-safe Latin kebab-case (по образцу build-analysis-docx).
// 1) Приоритет - inputs.slug (его кладет мост read-tekst-input с шага 1).
// 2) Fallback - basename папки texts/NNN-<slug>/ (отрезаем "NNN-").
// 3) Последний fallback - "site".
function resolveSlug() {
  if (inputs.slug && /^[a-z0-9-]+$/.test(inputs.slug)) return inputs.slug;
  const base = textsDir.split(/[\\/]/).filter(Boolean).pop() || "";
  const m = base.match(/^\d+-(.+)$/);
  if (m && m[1]) return m[1];
  return "site";
}
const slug = resolveSlug();
const brand = inputs.brand_name || slug;
const outputPath = join(textsDir, `Skeletons_${slug}.docx`);

// ═══ Дизайн-токены (единые с build-analysis-docx) ═══
const C = {
  table_head_bg: "D5E8F0",
  row_alt: "F2F2F2",
  row_white: "FFFFFF",
  accent: "1F4E79",
  text: "000000",
  muted: "666666",
};
const F = {
  family: "Arial",
  size_title: 28,    // 14pt
  size_h1: 32,       // 16pt (раздел)
  size_h3: 22,       // 11pt
  size_body: 20,     // 10pt
  size_table: 18,    // 9pt
  size_footer: 16,   // 8pt
};

const border = { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" };
const borders = { top: border, bottom: border, left: border, right: border };
const cellMargins = { top: 80, bottom: 80, left: 120, right: 120 };

// Нормализация текста под требования проекта: длинное/среднее тире -> дефис, е-с-точками -> е.
function normDashYo(text) {
  return String(text ?? "").replace(/[—–]/g, "-").replace(/ё/g, "е").replace(/Ё/g, "Е");
}

// ═══ Фильтр кухни для колонки «Что внутри» ═══
// notes такта 1 несут и клиентское содержание, и служебные фрагменты для такта 2 /
// slot-mapper. Режем notes по «;» и выбрасываем фрагменты с кухонными маркерами -
// заказчику уходит только то, что читается человеческим языком.
const KITCHEN_RE = /coverage|typical_order|leader_blocks|blocks_by_type|own_page|block_to_fragment|slot-mapper|\bslot|fragment|blueprint|verify|wireframe|BLOCKS\.md|page_rules|facts\.json|Р\/Д\/К\/В/i;
function clientNotes(notes) {
  const parts = String(notes ?? "").split(";").map((s) => s.trim()).filter(Boolean);
  return parts.filter((p) => !KITCHEN_RE.test(p)).join("; ");
}

function makeRun(text, opts = {}) {
  return new TextRun({
    text: normDashYo(text),
    font: F.family,
    size: opts.size ?? F.size_body,
    bold: opts.bold || false,
    italics: opts.italics || false,
    color: opts.color || C.text,
  });
}

function plainParagraph(text, opts = {}) {
  return new Paragraph({
    spacing: opts.spacing || { before: 80, after: 80 },
    alignment: opts.alignment || AlignmentType.LEFT,
    children: [makeRun(text, opts)],
  });
}

function bulletParagraph(text) {
  return new Paragraph({
    bullet: { level: 0 },
    spacing: { before: 40, after: 40 },
    children: [makeRun(text)],
  });
}

function headerCell(text, widthDxa) {
  return new TableCell({
    borders,
    width: { size: widthDxa, type: WidthType.DXA },
    shading: { fill: C.table_head_bg, type: ShadingType.CLEAR },
    margins: cellMargins,
    children: [new Paragraph({
      children: [makeRun(text, { size: F.size_table, bold: true })],
    })],
  });
}

function dataCell(text, widthDxa, isAlt, bold = false) {
  return new TableCell({
    borders,
    width: { size: widthDxa, type: WidthType.DXA },
    shading: { fill: isAlt ? C.row_alt : C.row_white, type: ShadingType.CLEAR },
    margins: cellMargins,
    children: [new Paragraph({
      children: [makeRun(text, { size: F.size_table, bold })],
    })],
  });
}

// Таблица «Блок / Зачем / Что внутри» одного типа
const CONTENT_WIDTH = 9638;
const COL_WIDTHS = [2600, 3500, 3538];
function skeletonTable(blocks) {
  const headerRow = new TableRow({
    tableHeader: true,
    children: [
      headerCell("Блок", COL_WIDTHS[0]),
      headerCell("Зачем", COL_WIDTHS[1]),
      headerCell("Что внутри", COL_WIDTHS[2]),
    ],
  });
  const dataRows = blocks.map((b, i) => {
    const isAlt = i % 2 === 1;
    const name = blockName(b);
    const why = String(b.client_why ?? "").trim() || "-";
    const inside = clientNotes(b.notes) || "-";
    return new TableRow({
      children: [
        dataCell(name, COL_WIDTHS[0], isAlt, Boolean(b.required)),
        dataCell(why, COL_WIDTHS[1], isAlt),
        dataCell(inside, COL_WIDTHS[2], isAlt),
      ],
    });
  });
  return new Table({
    columnWidths: COL_WIDTHS,
    layout: TableLayoutType.FIXED,
    rows: [headerRow, ...dataRows],
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
  });
}

// ═══ Порядок строк таблицы ═══
// Кто исполняет: сборщик. Зачем: прежняя сортировка брала hint.indexOf(имя блока), и ВСЕ
// одноименные блоки получали один ключ - второй «Каталог» перепрыгивал соседей и порядок
// разъезжался. Планировщику приходилось обходить это, выдавая трем разным блокам главной
// разные каталожные имена («Популярные товары» = витрина обучений, «Похожие товары» =
// библиотека): порядок сохранялся, но имена начинали врать о содержании, и расшифровку
// приходилось передавать руками каждому следующему агенту. Чинится здесь, а не именами.
const normBlockName = (s) => String(s ?? "").toLowerCase().replace(/ё/g, "е")
  .replace(/\(обязательн\w*\)/g, "").replace(/[«»"']/g, "").replace(/\s+/g, " ").trim();

function orderBlocks(sk) {
  const blocks = [...sk.blocks];
  // Явная нумерация планировщика сильнее подсказки: если n/order проставлены, это и есть порядок.
  const numbered = blocks.length > 0 && blocks.every((b) => Number.isFinite(b && (b.n ?? b.order)));
  if (numbered) return blocks.sort((a, b) => (a.n ?? a.order) - (b.n ?? b.order));

  const hint = Array.isArray(sk.order_hint) ? sk.order_hint : [];
  if (!hint.length) return blocks;

  // Позиционное потребление: каждая позиция подсказки забирает ПЕРВЫЙ еще не занятый блок
  // с таким именем. Одноименные блоки перестают конкурировать за одно место.
  const queue = new Map();
  blocks.forEach((b, i) => {
    const k = normBlockName(b.block);
    if (!queue.has(k)) queue.set(k, []);
    queue.get(k).push(i);
  });
  const used = new Set();
  const out = [];
  for (const h of hint) {
    const q = queue.get(normBlockName(h));
    if (q && q.length) {
      const idx = q.shift();
      used.add(idx);
      out.push(blocks[idx]);
    }
  }
  // Незнакомые подсказке блоки - в конце, в исходном порядке (как было).
  blocks.forEach((b, i) => { if (!used.has(i)) out.push(b); });
  return out;
}

// ═══ Клиентское имя блока ═══
// title_client - человеческое название для заказчика; нет его - каталожное имя блока.
// Техническое имя в клиентском документе - брак: на боевом прогоне планировщик, не имея
// права поставить FAQ, воткнул блок с именем «SEO-текст-низ», и оно уехало бы в таблицу.
const TECH_NAME = /(?:^|[^а-яё])(?:seo|lsi|h[1-3]|meta|slug|url|json|blueprint|fragment|фрагмент|n-грамм|ключевик|анкор|перелинковк)(?:[^а-яё]|$)|-(?:низ|верх)(?:$|\s)/i;
const techNames = [];
function blockName(b) {
  const client = String(b.title_client ?? "").trim();
  const raw = String(b.block ?? "");
  const name = client || raw;
  if (!client && TECH_NAME.test(raw)) techNames.push(raw);
  return b.required ? `${name} (обязательный)` : name;
}

function pageLabel(p) {
  const name = p.marker || p.slug || p.url || "страница";
  return p.url ? `${name} (${p.url})` : String(name);
}

// ═══ Сборка документа ═══
const children = [];

// Титул
children.push(new Paragraph({
  spacing: { before: 240, after: 200 },
  alignment: AlignmentType.CENTER,
  children: [makeRun(`Состав блоков страниц - ${brand}`, { size: F.size_title + 8, bold: true, color: C.accent })],
}));

// Преамбула для заказчика
children.push(new Paragraph({
  spacing: { before: 120, after: 240 },
  children: [makeRun(
    "Это скелет каждой страницы будущего сайта: какие смысловые блоки на ней стоят и зачем каждый нужен. Текстов здесь еще нет - мы напишем их после того, как вы согласуете состав. Посмотрите таблицы ниже и отметьте, чего не хватает или что кажется лишним: правки внесем до написания текстов.",
    { italics: true },
  )],
}));

let blocksTotal = 0;
let noWhy = 0;

for (const type of typesPresent) {
  const sk = skeletons[type];
  children.push(new Paragraph({
    spacing: { before: 320, after: 120 },
    children: [makeRun(`Тип страницы: ${type}`, { size: F.size_h1, bold: true, color: C.accent })],
  }));

  // Список страниц этого типа (из pages.json)
  const typePages = pages.filter((p) => p.type === type);
  if (typePages.length) {
    children.push(plainParagraph("Страницы этого типа на сайте:", { bold: true, size: F.size_h3, spacing: { before: 80, after: 40 } }));
    for (const p of typePages) children.push(bulletParagraph(pageLabel(p)));
  } else {
    children.push(plainParagraph("Страниц этого типа в согласованном составе пока нет.", { italics: true, color: C.muted }));
  }

  if (!sk || !Array.isArray(sk.blocks) || !sk.blocks.length) {
    console.error(`[build-skeletons-docx] предупреждение: у типа «${type}» нет скелета в type_skeletons.json - таблица пропущена`);
    children.push(plainParagraph("Состав блоков этого типа еще в работе.", { italics: true, color: C.muted }));
    continue;
  }

  const ordered = orderBlocks(sk);

  blocksTotal += ordered.length;
  noWhy += ordered.filter((b) => !String(b.client_why ?? "").trim()).length;

  children.push(skeletonTable(ordered));
  children.push(plainParagraph("")); // отступ после таблицы
}

if (noWhy > 0) {
  console.error(`[build-skeletons-docx] предупреждение: у ${noWhy} блок(ов) нет client_why - в колонке «Зачем» прочерк`);
}

// Подвал
const date = new Date().toISOString().slice(0, 10);
const footerPara = new Paragraph({
  alignment: AlignmentType.CENTER,
  children: [new TextRun({
    text: `TIMUR SEO | ${date}`,
    font: F.family, size: F.size_footer, color: C.muted,
  })],
});

const doc = new Document({
  creator: "TIMUR SEO",
  title: `Состав блоков страниц - ${brand}`,
  styles: {
    default: {
      document: {
        run: { font: F.family, size: F.size_body, color: C.text },
      },
    },
  },
  sections: [{
    properties: {
      page: {
        size: { width: 11906, height: 16838 },          // A4 (twips)
        margin: { top: 1134, right: 1134, bottom: 1134, left: 1134 }, // 2 cm
      },
    },
    headers: {},
    footers: {
      default: new Footer({ children: [footerPara] }),
    },
    children,
  }],
});

const buf = await Packer.toBuffer(doc);
writeFileSync(outputPath, buf);
console.log(`[build-skeletons-docx] wrote ${outputPath} (${buf.length} bytes; типов ${typesPresent.length}, блоков ${blocksTotal})`);

// Технические имена в клиентском документе - брак сдачи, а не косметика: заказчик читает
// таблицу состава и не обязан знать кухню. Файл написан (правка дешевая - перегенерировать),
// но выход ненулевой, чтобы гейт не ушел заказчику молча.
if (techNames.length) {
  console.error(`[build-skeletons-docx] ТЕХНИЧЕСКИЕ ИМЕНА БЛОКОВ в клиентском документе: ${[...new Set(techNames)].join("; ")}`);
  console.error("  Заказчику такое имя отправлять нельзя. Дай блоку человеческое имя в type_skeletons.json (поле title_client) и пересобери документ.");
  process.exit(3);
}
