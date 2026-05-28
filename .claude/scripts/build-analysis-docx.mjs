#!/usr/bin/env node
// build-analysis-docx.mjs
// Генерирует A2 (предпроектный анализ) в формате .docx из A2.md.
// Опциональный шаг 7 скила /seo-analysis. Эквивалент шага 7 исходного claude.ai-скила.
//
// Зависимости: docx (npm install docx) — уже в package.json (от build-strategy-docx.mjs).
//
// Использование:
//   node .claude/scripts/build-analysis-docx.mjs <analysis_dir>
//
// Вход:
//   <analysis_dir>/A2.md          — финальный отчёт (5 разделов в markdown)
//   <analysis_dir>/brief.json     — для имени файла (slug или domain) и заголовка
//   <analysis_dir>/serp.json      — для определения цвета вердикта
// Выход:
//   <analysis_dir>/A2_<safe_name>.docx
//
// Логика:
// - Парсит A2.md в плоский поток блоков (h1/h2/h3, paragraph, bullet, table, blockquote).
// - Заголовок ИДЁМ/КОРРЕКТИРУЕМ/МЕНЯЕМ/С ОГОВОРКАМИ окрашивает в зелёный/жёлтый/красный/оранжевый.
// - Шрифт Arial, заголовки тёмно-синие (#1F4E79), таблицы с серым шапочным фоном (#D5E8F0).
// - A4, поля 2 см (как в исходном Python-шаблоне).

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Footer, AlignmentType, BorderStyle, WidthType, ShadingType, PageBreak,
} from "docx";

const analysisDirArg = process.argv[2];
if (!analysisDirArg) {
  console.error("[build-analysis-docx] usage: node build-analysis-docx.mjs <analysis_dir>");
  process.exit(1);
}
const analysisDir = resolve(analysisDirArg);

const a2Path = join(analysisDir, "A2.md");
const briefPath = join(analysisDir, "brief.json");
const serpPath = join(analysisDir, "serp.json");

if (!existsSync(a2Path)) {
  console.error(`[build-analysis-docx] not found: ${a2Path}`);
  process.exit(1);
}

const a2 = readFileSync(a2Path, "utf8").replace(/^﻿/, "");

// brief.json — для slug и заголовка
let brief = {};
if (existsSync(briefPath)) {
  brief = JSON.parse(readFileSync(briefPath, "utf8").replace(/^﻿/, ""));
}
const domain = brief.domain || "site";
const companyName = brief.company_name || domain;
// safe name for file system (Windows: <>:"/\|?*)
const slug = (brief.domain || domain).replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/\./g, "-");
const outputPath = join(analysisDir, `A2_${slug}.docx`);

// serp.json — для цвета вердикта
let verdictType = "";
if (existsSync(serpPath)) {
  try {
    const serp = JSON.parse(readFileSync(serpPath, "utf8").replace(/^﻿/, ""));
    verdictType = (serp.verdict && serp.verdict.type) || "";
  } catch { /* ignore */ }
}

// ═══ Дизайн-токены ═══
const C = {
  header_bg: "1F4E79",
  header_text: "FFFFFF",
  table_head_bg: "D5E8F0",
  row_alt: "F2F2F2",
  row_white: "FFFFFF",
  accent: "1F4E79",
  text: "000000",
  muted: "666666",
  verdict_green: "2E7D32",  // ИДЁМ
  verdict_orange: "EF6C00", // С ОГОВОРКАМИ
  verdict_yellow: "F9A825", // КОРРЕКТИРУЕМ
  verdict_red: "C62828",    // МЕНЯЕМ
};
const F = {
  family: "Arial",
  size_title: 28,    // 14pt
  size_h1: 32,       // 16pt (раздел)
  size_h2: 26,       // 13pt
  size_h3: 22,       // 11pt
  size_body: 20,     // 10pt
  size_table: 18,    // 9pt
  size_footer: 16,   // 8pt
};

function verdictColor(text) {
  const t = (text || "").toUpperCase();
  if (t.includes("ИДЁМ С ОГОВОРКАМИ")) return C.verdict_orange;
  if (t.includes("ИДЁМ")) return C.verdict_green;
  if (t.includes("КОРРЕКТИРУЕМ")) return C.verdict_yellow;
  if (t.includes("МЕНЯЕМ")) return C.verdict_red;
  return C.accent;
}

const border = { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" };
const borders = { top: border, bottom: border, left: border, right: border };
const cellMargins = { top: 80, bottom: 80, left: 120, right: 120 };

// ═══ Парсер инлайн-markdown (поддерживает только **bold**) ═══
function parseInline(text, opts = {}) {
  // Защищаем длинные тире на всякий случай: заменим на дефис (по требованию проекта).
  const cleaned = String(text || "").replace(/[—–]/g, "-");
  const parts = [];
  const re = /\*\*(.+?)\*\*/g;
  let last = 0;
  let m;
  while ((m = re.exec(cleaned)) !== null) {
    if (m.index > last) {
      parts.push(makeRun(cleaned.slice(last, m.index), opts));
    }
    parts.push(makeRun(m[1], { ...opts, bold: true }));
    last = re.lastIndex;
  }
  if (last < cleaned.length) {
    parts.push(makeRun(cleaned.slice(last), opts));
  }
  if (parts.length === 0) {
    parts.push(makeRun("", opts));
  }
  return parts;
}

function makeRun(text, opts = {}) {
  return new TextRun({
    text: String(text ?? ""),
    font: F.family,
    size: opts.size ?? F.size_body,
    bold: opts.bold || false,
    italics: opts.italics || false,
    color: opts.color || C.text,
  });
}

function paragraphRuns(runs, opts = {}) {
  return new Paragraph({
    spacing: opts.spacing || { before: 80, after: 80 },
    alignment: opts.alignment || AlignmentType.LEFT,
    children: runs,
  });
}

function plainParagraph(text, opts = {}) {
  return paragraphRuns(parseInline(text, opts), opts);
}

function heading(text, level) {
  const sizeMap = { 1: F.size_h1, 2: F.size_h2, 3: F.size_h3 };
  const beforeMap = { 1: 320, 2: 240, 3: 160 };
  return new Paragraph({
    spacing: { before: beforeMap[level] || 240, after: 120 },
    children: [makeRun(text.replace(/[—–]/g, "-"), {
      size: sizeMap[level] || F.size_h2,
      bold: true,
      color: C.accent,
    })],
  });
}

function headerCell(text, widthDxa) {
  return new TableCell({
    borders,
    width: { size: widthDxa, type: WidthType.DXA },
    shading: { fill: C.table_head_bg, type: ShadingType.CLEAR },
    margins: cellMargins,
    children: [new Paragraph({
      children: [new TextRun({
        text: String(text).replace(/[—–]/g, "-"),
        font: F.family, size: F.size_table, bold: true, color: C.text,
      })],
    })],
  });
}

function dataCell(text, widthDxa, isAlt) {
  return new TableCell({
    borders,
    width: { size: widthDxa, type: WidthType.DXA },
    shading: { fill: isAlt ? C.row_alt : C.row_white, type: ShadingType.CLEAR },
    margins: cellMargins,
    children: [new Paragraph({
      children: parseInline(text, { size: F.size_table }),
    })],
  });
}

function tableBlock(columns, rows) {
  const contentWidth = 9638;
  const colCount = Math.max(columns.length, 1);
  const colWidth = Math.floor(contentWidth / colCount);
  const columnWidths = new Array(colCount).fill(colWidth);

  const headerRow = new TableRow({
    tableHeader: true,
    children: columns.map((c) => headerCell(c, colWidth)),
  });
  const dataRows = rows.map((r, i) => {
    // Если ячеек меньше чем колонок — добиваем пустыми
    const cells = [];
    for (let k = 0; k < colCount; k++) {
      cells.push(dataCell(r[k] ?? "", colWidth, i % 2 === 1));
    }
    return new TableRow({ children: cells });
  });
  return new Table({
    columnWidths,
    rows: [headerRow, ...dataRows],
    width: { size: contentWidth, type: WidthType.DXA },
  });
}

function bulletParagraph(text) {
  return new Paragraph({
    bullet: { level: 0 },
    spacing: { before: 40, after: 40 },
    children: parseInline(text),
  });
}

// ═══ Парсер markdown -> блоки ═══
// Поддерживаемые элементы:
//  - # / ## / ### заголовки
//  - --- горизонтальная линия (мы её используем как разделитель -> PageBreak в верхнеуровневых разделах)
//  - | таблицы (с разделителем ниже строки заголовков)
//  - - маркеры списков
//  - параграфы (всё остальное)
//  - **bold** инлайн
function parseMarkdownToBlocks(md) {
  const lines = md.split(/\r?\n/);
  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    let line = lines[i];
    const trimmed = line.trim();

    // Пустая строка
    if (trimmed === "") { i++; continue; }

    // Горизонтальная линия
    if (/^[-=]{3,}\s*$/.test(trimmed)) {
      blocks.push({ type: "hr" });
      i++;
      continue;
    }

    // Заголовки
    const h = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (h) {
      const level = Math.min(h[1].length, 3);
      blocks.push({ type: "heading", level, text: h[2] });
      i++;
      continue;
    }

    // Таблица: строка начинается с | и следующая строка — разделитель |---|---|
    if (trimmed.startsWith("|")) {
      const headerLine = trimmed;
      const nextLine = (lines[i + 1] || "").trim();
      const isSep = /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/.test(nextLine);
      if (isSep) {
        const columns = headerLine.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
        const rows = [];
        i += 2;
        while (i < lines.length && lines[i].trim().startsWith("|")) {
          const rowLine = lines[i].trim();
          const cells = rowLine.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
          rows.push(cells);
          i++;
        }
        blocks.push({ type: "table", columns, rows });
        continue;
      }
    }

    // Маркер списка
    if (/^[-*]\s+/.test(trimmed)) {
      const items = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*]\s+/, ""));
        i++;
      }
      blocks.push({ type: "bullet_list", items });
      continue;
    }

    // Параграф (одна или несколько подряд непустых строк, не таблица, не заголовок, не список)
    {
      const paraLines = [];
      while (
        i < lines.length &&
        lines[i].trim() !== "" &&
        !/^#{1,6}\s+/.test(lines[i].trim()) &&
        !/^[-*]\s+/.test(lines[i].trim()) &&
        !lines[i].trim().startsWith("|") &&
        !/^[-=]{3,}\s*$/.test(lines[i].trim())
      ) {
        paraLines.push(lines[i].trim());
        i++;
      }
      const text = paraLines.join(" ");
      // Проверка на «Вердикт: **...**» — выделим отдельным типом для покраски
      const verdictMatch = text.match(/^\*\*Вердикт[:\s]*\*\*\s*\*\*(.+?)\*\*\s*$/);
      if (verdictMatch) {
        blocks.push({ type: "verdict", text: verdictMatch[1] });
      } else {
        blocks.push({ type: "paragraph", text });
      }
    }
  }

  return blocks;
}

// ═══ Рендер блоков в docx-элементы ═══
function renderBlocks(blocks) {
  const out = [];
  let firstH1Seen = false;
  let lastWasHr = false;

  for (const b of blocks) {
    switch (b.type) {
      case "heading": {
        // h1 → крупный, h2 → раздел, h3 → подраздел
        if (b.level === 1) {
          if (!firstH1Seen) {
            // Это титульный заголовок документа — центрирован, крупно
            out.push(new Paragraph({
              spacing: { before: 240, after: 200 },
              alignment: AlignmentType.CENTER,
              children: [makeRun(b.text.replace(/[—–]/g, "-"), {
                size: F.size_title + 8, bold: true, color: C.accent,
              })],
            }));
            firstH1Seen = true;
          } else {
            out.push(heading(b.text, 1));
          }
        } else {
          out.push(heading(b.text, b.level));
        }
        lastWasHr = false;
        break;
      }

      case "hr": {
        // Используем как мягкий разделитель — добавляем пустую строку
        out.push(plainParagraph(""));
        lastWasHr = true;
        break;
      }

      case "table": {
        out.push(tableBlock(b.columns, b.rows));
        out.push(plainParagraph("")); // отступ
        lastWasHr = false;
        break;
      }

      case "bullet_list": {
        for (const item of b.items) {
          out.push(bulletParagraph(item));
        }
        lastWasHr = false;
        break;
      }

      case "verdict": {
        const color = verdictColor(b.text);
        out.push(new Paragraph({
          spacing: { before: 240, after: 240 },
          children: [
            makeRun("Вердикт: ", { bold: true, size: F.size_h2 }),
            makeRun(b.text.replace(/[—–]/g, "-"), { bold: true, size: F.size_h2, color }),
          ],
        }));
        lastWasHr = false;
        break;
      }

      case "paragraph":
      default: {
        out.push(plainParagraph(b.text));
        lastWasHr = false;
      }
    }
  }

  return out;
}

// ═══ Сборка документа ═══
const blocks = parseMarkdownToBlocks(a2);
const docChildren = renderBlocks(blocks);

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
  title: `A2 - Предпроектный анализ ${companyName}`,
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
    children: docChildren,
  }],
});

const buf = await Packer.toBuffer(doc);
writeFileSync(outputPath, buf);
console.log(`[build-analysis-docx] wrote ${outputPath} (${buf.length} bytes)`);
