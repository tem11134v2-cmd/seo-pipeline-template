#!/usr/bin/env node
// build-audit-docx.mjs
// Генерирует A12 (технический SEO-аудит) в .docx из audit_data.json.
// Шаг 6 скила /seo-tehaudit. Порт Python-шаблона docx_template.py (дизайн TIMUR SEO)
// на Node/docx - по образцу build-analysis-docx.mjs (ADR-014, повтор решения ADR-007).
//
// Зависимости: docx (уже в package.json).
//
// Использование:
//   node .claude/scripts/build-audit-docx.mjs <audit_dir>
// Вход:  <audit_dir>/audit_data.json
// Выход: <audit_dir>/A12_<slug>.docx
//
// Схема audit_data.json - см. .claude/agents/audit-writer.md и ADR-014.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Footer, AlignmentType, BorderStyle, WidthType, ShadingType, PageBreak, TableLayoutType,
} from "docx";

const auditDirArg = process.argv[2];
if (!auditDirArg) {
  console.error("[build-audit-docx] usage: node build-audit-docx.mjs <audit_dir>");
  process.exit(1);
}
const auditDir = resolve(auditDirArg);
const dataPath = join(auditDir, "audit_data.json");
if (!existsSync(dataPath)) {
  console.error(`[build-audit-docx] not found: ${dataPath}`);
  process.exit(1);
}
const data = JSON.parse(readFileSync(dataPath, "utf8").replace(/^﻿/, ""));
const domain = data.domain || "site";

// Slug для имени файла: ASCII-safe. 1) basename папки audits/NNN-<slug>/ (отрезаем NNN-);
// 2) fallback - slugify(domain).
function slugify(s) {
  return String(s).toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "site";
}
function resolveSlug() {
  const base = auditDir.split(/[\\/]/).filter(Boolean).pop() || "";
  const m = base.match(/^\d+-(.+)$/);
  if (m && m[1] && /^[a-z0-9-]+$/.test(m[1])) return m[1];
  return slugify(domain);
}
const outputPath = join(auditDir, `A12_${resolveSlug()}.docx`);

// ═══ Дизайн-токены TIMUR SEO (порт COLORS/FONT/SIZES из docx_template.py) ═══
const C = {
  primary: "1F3A5F", accent: "2E75B6", red: "C0392B", yellow: "D68910",
  green: "27AE60", orange: "E67E22", gray_light: "F5F5F5", gray_medium: "E5E5E5",
  gray_dark: "595959", header_bg: "1F3A5F", header_text: "FFFFFF", text: "2C2C2C", white: "FFFFFF",
};
const F = { main: "Calibri", mono: "Consolas" };
// размеры в half-points (pt * 2)
const S = { h1: 40, h2: 28, h3: 24, body: 22, small: 18, table: 20, code: 18 };

// A4, поля как в Python (left 20mm, right 15mm, top/bottom 18mm)
const PAGE = { width: 11906, height: 16838 };
const MARGIN = { left: 1134, right: 850, top: 1020, bottom: 1020 };
const CONTENT_W = PAGE.width - MARGIN.left - MARGIN.right; // 9922 twips
const CM = (cm) => Math.round(cm * 567);

const border = { style: BorderStyle.SINGLE, size: 4, color: C.gray_medium };
const headerBorder = { style: BorderStyle.SINGLE, size: 4, color: C.header_bg };
const cellMargins = { top: 60, bottom: 60, left: 100, right: 100 };

const dash = (s) => String(s ?? "").replace(/[—–]/g, "-").replace(/ё/g, "е").replace(/Ё/g, "Е");

function makeRun(text, opts = {}) {
  return new TextRun({
    text: dash(text),
    font: opts.font || F.main,
    size: opts.size ?? S.body,
    bold: !!opts.bold,
    italics: !!opts.italics,
    color: opts.color || C.text,
  });
}

// инлайн **bold** + очистка тире
function parseInline(text, opts = {}) {
  const cleaned = dash(text);
  const parts = [];
  const re = /\*\*(.+?)\*\*/g;
  let last = 0, m;
  while ((m = re.exec(cleaned)) !== null) {
    if (m.index > last) parts.push(makeRun(cleaned.slice(last, m.index), opts));
    parts.push(makeRun(m[1], { ...opts, bold: true }));
    last = re.lastIndex;
  }
  if (last < cleaned.length) parts.push(makeRun(cleaned.slice(last), opts));
  if (!parts.length) parts.push(makeRun("", opts));
  return parts;
}

function para(text, opts = {}) {
  return new Paragraph({
    spacing: opts.spacing || { before: 60, after: 60 },
    alignment: opts.alignment || AlignmentType.LEFT,
    children: parseInline(text, opts),
  });
}

function heading(text, level) {
  const size = { 1: S.h1, 2: S.h2, 3: S.h3 }[level] || S.h2;
  const color = { 1: C.primary, 2: C.accent, 3: C.text }[level] || C.accent;
  const before = { 1: 240, 2: 160, 3: 120 }[level] || 160;
  const after = { 1: 120, 2: 80, 3: 80 }[level] || 80;
  return new Paragraph({
    spacing: { before, after },
    alignment: level === 0 ? AlignmentType.CENTER : AlignmentType.LEFT,
    children: [makeRun(text, { size, bold: true, color })],
  });
}

function headerCell(text, w) {
  return new TableCell({
    width: { size: w, type: WidthType.DXA },
    borders: { top: headerBorder, bottom: headerBorder, left: headerBorder, right: headerBorder },
    shading: { fill: C.header_bg, type: ShadingType.CLEAR, color: "auto" },
    margins: cellMargins,
    children: [new Paragraph({ children: [makeRun(text, { bold: true, color: C.header_text, size: S.table })] })],
  });
}

function dataCell(text, w, alt, extra = {}) {
  return new TableCell({
    width: { size: w, type: WidthType.DXA },
    borders: { top: border, bottom: border, left: border, right: border },
    shading: { fill: alt ? C.gray_light : C.white, type: ShadingType.CLEAR, color: "auto" },
    margins: cellMargins,
    children: [new Paragraph({
      children: parseInline(text, { size: S.table, color: extra.color, bold: extra.bold }),
    })],
  });
}

// Универсальная таблица. colWidthsCm - массив ширин в см (опц.); colorFirstCol - {значение: hex}
function buildTable(headers, rows, opts = {}) {
  if (!rows || !rows.length) return null;
  const n = headers.length;
  let widths;
  if (opts.colWidthsCm && opts.colWidthsCm.length === n) {
    widths = opts.colWidthsCm.map(CM);
    const sum = widths.reduce((a, b) => a + b, 0);
    if (sum > CONTENT_W) { const k = CONTENT_W / sum; widths = widths.map((w) => Math.round(w * k)); }
  } else {
    widths = new Array(n).fill(Math.floor(CONTENT_W / n));
  }
  const headerRow = new TableRow({ tableHeader: true, children: headers.map((h, i) => headerCell(h, widths[i])) });
  const dataRows = rows.map((row, ri) => {
    const alt = ri % 2 === 1;
    const cells = [];
    for (let ci = 0; ci < n; ci++) {
      const val = row[ci] != null ? row[ci] : "";
      let extra = {};
      if (opts.colorFirstCol && ci === 0 && opts.colorFirstCol[val]) {
        extra = { color: opts.colorFirstCol[val], bold: true };
      }
      cells.push(dataCell(val, widths[ci], alt, extra));
    }
    return new TableRow({ children: cells });
  });
  return new Table({
    columnWidths: widths,
    layout: TableLayoutType.FIXED,
    width: { size: widths.reduce((a, b) => a + b, 0), type: WidthType.DXA },
    rows: [headerRow, ...dataRows],
  });
}

// ═══ Сборка children ═══
const kids = [];
const add = (el) => { if (el) kids.push(el); };
const spacer = () => new Paragraph({ children: [makeRun("")] });

// Шапка
add(new Paragraph({
  spacing: { before: 120, after: 80 },
  children: [makeRun(`Техаудит - ${domain}`, { size: S.h1, bold: true, color: C.primary })],
}));
add(new Paragraph({
  spacing: { after: 160 },
  children: [makeRun(`Дата аудита: ${data.audit_date || ""}    -    Подготовил: ${data.prepared_by || "TIMUR SEO"}`,
    { size: S.small, color: C.gray_dark, italics: true })],
}));

// Карточка
if (Array.isArray(data.card) && data.card.length) {
  add(heading("Карточка сайта", 2));
  add(buildTable(["Параметр", "Значение"], data.card.map((r) => [r.label, r.value]),
    { colWidthsCm: [5.5, 11.0] }));
  add(spacer());
}

// Итого проблем
const c = data.counts || {};
add(heading("Итого проблем", 2));
const summaryRows = [
  ["🔴 Критично", String(c.critical ?? 0)],
  ["🟡 Важно", String(c.important ?? 0)],
  ["🟢 Желательно", String(c.nice_to_have ?? 0)],
  ["✅ Всё ок", `${c.ok ?? 0} проверенных пунктов`],
];
if (c.not_checked) summaryRows.push(["⚠️ Не удалось проверить", String(c.not_checked)]);
add(buildTable(["Приоритет", "Количество"], summaryRows, {
  colWidthsCm: [7.0, 9.5],
  colorFirstCol: {
    "🔴 Критично": C.red, "🟡 Важно": C.yellow, "🟢 Желательно": C.green,
    "✅ Всё ок": C.green, "⚠️ Не удалось проверить": C.orange,
  },
}));
add(spacer());

// Проблемы
function problems(heading2, list) {
  if (!Array.isArray(list) || !list.length) return;
  add(heading(heading2, 2));
  const rows = list.map((p, i) => [String(i + 1), p.title || "", p.block || "", p.details || "", p.rec || ""]);
  add(buildTable(["№", "Проблема", "Блок", "Детали", "Рекомендация"], rows,
    { colWidthsCm: [0.9, 4.0, 2.2, 4.4, 4.0] }));
  add(spacer());
}
problems("🔴 Критичные проблемы", data.critical_problems);
problems("🟡 Важные проблемы", data.important_problems);
problems("🟢 Желательные улучшения", data.nice_problems);

// Проверено - всё ок
if (Array.isArray(data.ok_items) && data.ok_items.length) {
  add(heading("✅ Проверено - всё ок", 2));
  add(buildTable(["№", "Пункт", "Статус"], data.ok_items.map((it, i) => [String(i + 1), it, "✅"]),
    { colWidthsCm: [0.9, 13.5, 2.0] }));
  add(spacer());
}

// Не удалось проверить
if (Array.isArray(data.not_checked) && data.not_checked.length) {
  add(heading("⚠️ Не удалось проверить", 2));
  add(para("Эти проверки рекомендуется выполнить вручную.", { color: C.gray_dark, italics: true, size: S.small }));
  add(buildTable(["№", "Пункт", "Причина"], data.not_checked.map((it, i) => [String(i + 1), it.item || "", it.reason || ""]),
    { colWidthsCm: [0.9, 7.5, 8.0] }));
  add(spacer());
}

// Мета-теги (выборка)
const mt = data.meta_table || {};
if (Array.isArray(mt.rows) && mt.rows.length) {
  add(heading(mt.title || "Мета-теги (выборка)", 2));
  const rows = mt.rows.map((r) => [
    r.url || "", r.type || "",
    `${r.title_text || ""} (${r.title_len ?? 0})`,
    `${r.h1_text || ""} (${r.h1_count ?? 0})`,
    String(r.desc_len ?? 0), r.schema || "", r.issues || "",
  ]);
  add(buildTable(["URL", "Тип", "Title (длина)", "H1 (кол-во)", "Desc (дл.)", "Schema.org", "Проблемы"], rows));
  add(spacer());
}

// Аналитика
const a = data.analytics || {};
if (a.traffic || a.sources || a.bounce_rate || a.backlinks || a.disclaimer ||
  (Array.isArray(a.high_bounce_pages) && a.high_bounce_pages.length)) {
  add(heading("Аналитика", 2));
  if (a.disclaimer) {
    add(new Paragraph({ children: [makeRun(`🟡 ${a.disclaimer}`, { bold: true, color: C.yellow })] }));
  }
  if (a.traffic) add(para(`Трафик: ${a.traffic}${a.trend ? `, тренд: ${a.trend}` : ""}`));
  if (a.sources) add(para(`Источники: ${a.sources}`));
  if (a.bounce_rate) add(para(`Отказы: ${a.bounce_rate}`));
  if (a.backlinks) add(para(`Ссылочный профиль: ${a.backlinks}`));
  if (Array.isArray(a.high_bounce_pages) && a.high_bounce_pages.length) {
    add(heading("Страницы с высокими отказами (> 60%)", 3));
    add(buildTable(["URL", "Отказы", "Визиты"],
      a.high_bounce_pages.map((r) => [r.url || "", r.bounce || "", r.visits || ""]),
      { colWidthsCm: [10.0, 3.0, 3.5] }));
  }
  add(spacer());
}

// Чеклист
const cl = data.checklist || {};
if (["critical", "important", "nice"].some((k) => Array.isArray(cl[k]) && cl[k].length)) {
  add(heading("Чеклист для разработчика", 2));
  const sub = [
    ["🔴 Критично (сделать в первую очередь)", cl.critical],
    ["🟡 Важно (сделать во вторую очередь)", cl.important],
    ["🟢 Желательно (по возможности)", cl.nice],
  ];
  for (const [h, tasks] of sub) {
    if (!Array.isArray(tasks) || !tasks.length) continue;
    add(heading(h, 3));
    const rows = tasks.map((t, i) => [
      String(i + 1), t.task || "", t.url || "", t.where || "",
      t.appendix ? `Приложение ${t.appendix}` : "-",
    ]);
    add(buildTable(["№", "Задача", "URL/файл", "Где исправлять", "Приложение"], rows,
      { colWidthsCm: [0.9, 5.8, 3.4, 3.4, 2.5] }));
    add(spacer());
  }
}

// Приложения
if (Array.isArray(data.appendices) && data.appendices.length) {
  add(new Paragraph({ children: [new PageBreak()] }));
  add(heading("Приложения", 1));
  data.appendices.forEach((app, idx) => {
    add(heading(`Приложение ${idx + 1}. ${app.title || ""}`, 2));
    if (app.intro) add(para(app.intro, { color: C.gray_dark, italics: true }));
    const ct = app.content_type || "text";
    const content = app.content;
    if (ct === "table" && content && Array.isArray(content.headers)) {
      add(buildTable(content.headers, content.rows || []));
      add(spacer());
    } else if (ct === "list") {
      for (const item of content || []) {
        add(new Paragraph({ bullet: { level: 0 }, spacing: { before: 20, after: 20 }, children: parseInline(item) }));
      }
      add(spacer());
    } else if (ct === "code") {
      for (const line of dash(String(content || "")).split(/\r?\n/)) {
        add(new Paragraph({
          spacing: { before: 0, after: 0 },
          children: [makeRun(line || " ", { font: F.mono, size: S.code })],
        }));
      }
      add(spacer());
    } else if (ct === "diff") {
      for (const ln of content || []) {
        const col = ln.sign === "-" ? C.red : ln.sign === "+" ? C.green : C.text;
        add(new Paragraph({
          spacing: { before: 0, after: 0 },
          children: [makeRun(`${ln.sign} ${ln.line}`, { font: F.mono, size: S.code, color: col })],
        }));
      }
      add(spacer());
    } else {
      add(para(String(content || "")));
    }
  });
}

// Подвал
const date = new Date().toISOString().slice(0, 10);
const footer = new Footer({
  children: [new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [makeRun(`TIMUR SEO | ${date}`, { size: S.small, color: C.gray_dark })],
  })],
});

const doc = new Document({
  creator: "TIMUR SEO",
  title: `A12 - Техаудит ${domain}`,
  styles: { default: { document: { run: { font: F.main, size: S.body, color: C.text } } } },
  sections: [{
    properties: { page: { size: { width: PAGE.width, height: PAGE.height }, margin: MARGIN } },
    footers: { default: footer },
    children: kids,
  }],
});

const buf = await Packer.toBuffer(doc);
writeFileSync(outputPath, buf);
console.log(`[build-audit-docx] wrote ${outputPath} (${buf.length} bytes)`);
