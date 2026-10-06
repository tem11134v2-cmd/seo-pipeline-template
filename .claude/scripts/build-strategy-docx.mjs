#!/usr/bin/env node
// build-strategy-docx.mjs
// Генерирует SEO-стратегию (.docx) на основе seo-strategiya_content.json (+ forecast.json, tariffs.json, inputs.json).
// Используется в /seo-strategiya после strategy-writer и проверок.
//
// Два формата контента:
//   v2 (content.format == "v2", программа 06.10.2026, docs/upgrade-program-2026-10-06-strategy-v2.md, разделы 4.4 и 5):
//     обложка-баннер + «Главное за одну минуту» (3 KPI из forecast.json + «Коротко») + 4 раздела тезисными блоками
//     (situation / competitors / plan / forecast). Ни цен, ни тарифов. Все деньги (потери, выручка прогноза) рендерит
//     сборщик из forecast.json по блокам-маркерам; писатель денег не пишет. Дизайн-система - docs/design-strategy-docx.md.
//   легаси (без format): старый рендер 6 разделов (tariff / special / decomposition_table ...) - для пересборки
//     старых стратегий без изменений (renderLegacy ниже).
//
// Зависимости: docx (npm install docx) - есть в package.json.
//
// Использование:
//   node .claude/scripts/build-strategy-docx.mjs <strategy_dir>
//
// Вход:
//   <strategy_dir>/seo-strategiya_content.json - контент от strategy-writer
//   <strategy_dir>/inputs.json                 - домен, slug, регион, дата
//   <strategy_dir>/forecast.json               - v2: обязателен (build-forecast.mjs) - KPI, потери, график, таблица
//   <strategy_dir>/tariffs.json                - v2: состав рекомендованного варианта для плана работ по месяцам;
//                                                легаси: тариф Рост для decomposition_table
//   <strategy_dir>/seo-strategiya_data.json    - легаси: forecast_scenarios для decomposition_table
// Выход:
//   <strategy_dir>/SEO_Strategy_<slug|domain>.docx
//
// Exit: 0 - собрано (предупреждения печатаются); 1 - нет входов / битый JSON / v2 без forecast.json.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, PageNumber, AlignmentType, HeadingLevel, BorderStyle,
  WidthType, ShadingType, PageBreak, LevelFormat, TableLayoutType,
  VerticalAlignTable, HeightRule,
} from "docx";
import { TARIFF_SCALE, interpCheckpoints, computeScenarioTariff } from "./_forecast-money.mjs";
import { tariffServiceIds } from "./_forecast-model.mjs";
import { timelineFor } from "./_services.mjs";

const LOG = "[build-strategy-docx]";
const strategyDirArg = process.argv[2];
if (!strategyDirArg) {
  console.error(`${LOG} usage: node build-strategy-docx.mjs <strategy_dir>`);
  process.exit(1);
}
const strategyDir = resolve(strategyDirArg);

function readJson(name, required) {
  const p = join(strategyDir, name);
  if (!existsSync(p)) {
    if (required) {
      console.error(`${LOG} not found: ${p}`);
      process.exit(1);
    }
    return null;
  }
  try {
    return JSON.parse(readFileSync(p, "utf8").replace(/^﻿/, ""));
  } catch (e) {
    console.error(`${LOG} битый JSON ${p}: ${e.message}`);
    process.exit(1);
  }
}

const content = readJson("seo-strategiya_content.json", true);
const inputs = readJson("inputs.json", true);

// tariffs.json/seo-strategiya_data.json - опциональны. Легаси: нужны только для блока decomposition_table (этап 8),
// старые content.json с готовой таблицей (case "table") работают вообще без них. v2: tariffs.json - для плана работ.
const tariffs = readJson("tariffs.json", false) || {};
const stratData = readJson("seo-strategiya_data.json", false) || {};

const domain = inputs.domain || "site";
const date = inputs.date || new Date().toLocaleDateString("ru-RU", { year: "numeric", month: "long" });
// Имя файла: используем slug если есть (Latin, безопасно для email/FS), иначе domain без forbidden-chars (Windows).
const safeName = (inputs.slug || domain).replace(/[<>:"/\\|?*\x00-\x1f]/g, "_");
const outputPath = join(strategyDir, `SEO_Strategy_${safeName}.docx`);

const warnings = [];
const warn = (msg) => warnings.push(msg);

// Нормализация на выходе (правило проекта для клиентских текстов): тире -> дефис, буква е-с-точками -> е.
// Через нее проходит КАЖДАЯ строка документа (run() обоих рендеров, колонтитулы, метаданные).
const clean = (s) => String(s ?? "").replace(/[—–]/g, "-").replace(/ё/g, "е").replace(/Ё/g, "Е");

const TARIFF_KEY_ALIASES = { rost: "growth" };
function getTariffData(tariffsObj, key) {
  for (const rawKey of Object.keys(tariffsObj || {})) {
    const canonical = TARIFF_KEY_ALIASES[rawKey] || rawKey;
    if (canonical === key) return tariffsObj[rawKey];
  }
  return null;
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// v2: ДИЗАЙН-СИСТЕМА (рецепты проверены конверсией docx -> Google Docs, см. docs/design-strategy-docx.md)
// Правила: таблицы только DXA + columnWidths + FIXED; между двумя таблицами всегда абзац (иначе Docs склеит);
// никаких Textbox / SVG / плавающих фигур / табуляций с лидером / characterSpacing / allCaps; прописные - буквами;
// заголовки - HeadingLevel (навигация в Docs); разрывы - явным PageBreak.
// ════════════════════════════════════════════════════════════════════════════════════════════════

const C = {
  navy: "0F2A4A",      // основной: обложка, заголовки, крупные цифры
  blue: "1F6FEB",      // акцент: номера разделов, столбики прироста, маркеры списков
  blueSoft: "93C5FD",  // текущий уровень на графике, ежемесячные работы
  blueTint: "EEF4FB",  // фон KPI и инфо-выносок
  orange: "E8590C",    // внимание и деньги: потери, «вы» в сравнении
  orangeTint: "FFF4E6",
  green: "16A34A", greenTint: "ECFDF3",
  red: "DC2626", redTint: "FEF2F2",
  amber: "D97706", amberTint: "FFFBEB",
  text: "1F2937", muted: "6B7280", faint: "9CA3AF", line: "E5E7EB", surface: "F8FAFC", white: "FFFFFF",
};
// Montserrat (Google Font с кириллицей) - заголовки и крупные цифры, Arial - текст. Оба проверены в Google Docs.
// Если владелец решит «только Arial» - поменять FONT.head здесь, компоненты не меняются.
const FONT = { head: "Montserrat", body: "Arial" };
// размеры в half-points (pt * 2)
const SZ = { cover: 56, h1: 34, h2: 26, h3: 22, lead: 24, body: 21, table: 19, small: 17, kpi: 48, kpiSmall: 40 };
const PAGE = { w: 11906, h: 16838, margin: 1134 };
const W = PAGE.w - 2 * PAGE.margin; // 9638 twips - ширина полосы

const TONES = {
  info: { stripe: C.blue, fill: C.blueTint, title: C.navy },
  loss: { stripe: C.orange, fill: C.orangeTint, title: "9A3412" },
  success: { stripe: C.green, fill: C.greenTint, title: "166534" },
  danger: { stripe: C.red, fill: C.redTint, title: "991B1B" },
  neutral: { stripe: C.faint, fill: C.surface, title: C.text },
};
// тоны контента v2 -> тоны дизайн-системы
const CALLOUT_TONE = { info: "info", warning: "loss", good: "success", danger: "danger", neutral: "neutral", loss: "loss", success: "success" };

// ─── Базовые хелперы ───
const NONE = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const TBL_NONE = { top: NONE, bottom: NONE, left: NONE, right: NONE, insideHorizontal: NONE, insideVertical: NONE };
const line = (size, color) => ({ style: BorderStyle.SINGLE, size, color }); // size в 1/8 pt: 24 = 3pt

function run(text, o = {}) {
  return new TextRun({
    text: clean(text), font: o.font || FONT.body, size: o.size || SZ.body,
    bold: !!o.bold, italics: !!o.italics, color: o.color || C.text,
    shading: o.bg ? { type: ShadingType.CLEAR, fill: o.bg, color: "auto" } : undefined,
  });
}
// "**жирное** обычное" -> runs
function rich(text, o = {}) {
  const out = [], re = /\*\*(.+?)\*\*/g, s = clean(text);
  let last = 0, m;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(run(s.slice(last, m.index), o));
    out.push(run(m[1], { ...o, bold: true }));
    last = re.lastIndex;
  }
  if (last < s.length) out.push(run(s.slice(last), o));
  return out.length ? out : [run("", o)];
}
function para(content, o = {}) {
  const children = Array.isArray(content) ? content : typeof content === "string" ? rich(content, o) : [content];
  return new Paragraph({
    children, alignment: o.align,
    spacing: { before: o.before ?? 0, after: o.after ?? 120, line: o.line ?? 276 },
    keepNext: o.keepNext, numbering: o.numbering, border: o.border, shading: o.shading, indent: o.indent,
  });
}
// пустой абзац минимальной высоты (ячейки-заливки, зазоры, разделитель между таблицами)
const tiny = () => new Paragraph({ spacing: { before: 0, after: 0, line: 240 }, run: { size: 2 }, children: [] });
const spacer = (after = 120) => new Paragraph({ spacing: { before: 0, after, line: 240 }, run: { size: 2 }, children: [] });

function cell(children, o = {}) {
  return new TableCell({
    width: o.w != null ? { size: o.w, type: WidthType.DXA } : undefined,
    columnSpan: o.span, rowSpan: o.rowSpan,
    shading: o.fill ? { fill: o.fill, type: ShadingType.CLEAR, color: "auto" } : undefined,
    borders: o.borders,
    margins: o.margins ?? { top: 100, bottom: 100, left: 140, right: 140 },
    verticalAlign: o.valign,
    children: Array.isArray(children) ? children : [children],
  });
}
function grid(widths, rows, o = {}) {
  return new Table({
    width: { size: widths.reduce((a, b) => a + b, 0), type: WidthType.DXA },
    columnWidths: widths, layout: TableLayoutType.FIXED, borders: o.borders || TBL_NONE, rows,
  });
}
// ширины колонок: доли -> twips с точной суммой total
function cols(fracs, total = W) {
  const sum = fracs.reduce((a, b) => a + b, 0) || 1;
  const ws = fracs.map((f) => Math.floor((total * f) / sum));
  ws[ws.length - 1] += total - ws.reduce((a, b) => a + b, 0);
  return ws;
}
// ширины ряда «карточка + зазор + карточка ...» с точной суммой W
function tileWidths(n, gap) {
  const cw = Math.floor((W - gap * (n - 1)) / n), ws = [];
  for (let i = 0; i < n; i++) { ws.push(cw); if (i < n - 1) ws.push(gap); }
  ws[ws.length - 1] += W - ws.reduce((a, b) => a + b, 0);
  return ws;
}

// ─── Числа по-русски ───
const NBSP = String.fromCharCode(0xa0); // неразрывный пробел: «1,2 млн ₽» не рвется по строкам
function toNum(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const n = parseFloat(String(v ?? "").replace(/\s/g, "").replace(",", ".")); // \s ловит и неразрывный пробел
  return Number.isFinite(n) ? n : 0;
}
const fmtInt = (n) => Math.round(toNum(n)).toLocaleString("ru-RU");
const dec1 = (x) => (Math.round(x * 10) / 10).toLocaleString("ru-RU", { maximumFractionDigits: 1 });
// обращения/продажи: до 10 - с одним знаком (2,5), дальше целые
const fmtCount = (n) => { const x = toNum(n); return Math.abs(x) < 10 ? dec1(x) : fmtInt(x); };
// деньги: «1,2 млн ₽», «450 тыс ₽», «900 ₽»
function fmtRub(n) {
  const x = Math.max(0, toNum(n));
  if (x >= 999500) {
    const m = x / 1e6;
    return `${m >= 10 ? fmtInt(m) : dec1(m)}${NBSP}млн${NBSP}₽`;
  }
  if (x >= 1000) return `${fmtInt(x / 1000)}${NBSP}тыс${NBSP}₽`;
  return `${fmtInt(x)}${NBSP}₽`;
}
// подпись столбика: «1,2k», «12k», «850»
function fmtK(n) {
  const x = toNum(n);
  if (x >= 10000) return `${Math.round(x / 1000)}k`;
  if (x >= 1000) return `${dec1(x / 1000)}k`;
  return fmtInt(x);
}
const pct = (x) => dec1(toNum(x) * 100) + "%";
// склонение после числа: plural(21, ["обращение", "обращения", "обращений"]); дробное - форма «обращения»
function plural(n, forms) {
  const x = Math.abs(Math.round(toNum(n) * 10) / 10);
  if (x % 1 !== 0) return forms[1];
  const n10 = x % 10, n100 = x % 100;
  if (n10 === 1 && n100 !== 11) return forms[0];
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return forms[1];
  return forms[2];
}

// ─── Нумерация: маркеры-символы (переживают конверсию, цвет маркера сохраняется) ───
const bulletLevel = (text, color, size) => ({
  levels: [{ level: 0, format: LevelFormat.BULLET, text, alignment: AlignmentType.LEFT,
    style: { run: { color, bold: true, font: FONT.body, size }, paragraph: { indent: { left: 340, hanging: 260 } } } }],
});
const NUMBERING = {
  config: [
    { reference: "check", ...bulletLevel("✓", C.green) },
    { reference: "cross", ...bulletLevel("✗", C.red) },
    { reference: "dot", ...bulletLevel("■", C.blue, 14) },
    { reference: "arrow", ...bulletLevel("→", C.faint) },
    { reference: "steps", levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT,
      style: { run: { color: C.blue, bold: true, font: FONT.head }, paragraph: { indent: { left: 340, hanging: 300 } } } }] },
  ],
};
const BULLET_KINDS = new Set(["check", "cross", "dot", "arrow"]);
function bullets(items, kind = "dot", o = {}) {
  const ref = BULLET_KINDS.has(kind) ? kind : "dot";
  return items.map((t, i) => para(rich(t, { size: o.size || SZ.body, color: o.color }), {
    numbering: { reference: ref, level: 0 }, after: i === items.length - 1 ? (o.lastAfter ?? 120) : 60,
  }));
}
const strItems = (arr) => (Array.isArray(arr) ? arr : []).map((x) => (typeof x === "string" ? x : x && (x.text || x.title || x.label) ? String(x.text || x.title || x.label) : "")).filter((s) => s.trim());

// ─── 1. Обложка: баннер 1x1 + строка «Регион | Дата | Подготовил» ───
function cover({ kicker, title, subtitle, meta }) {
  const kids = [para(run(kicker, { size: SZ.small, bold: true, color: C.blueSoft }), { after: 160 }),
    para(run(title, { font: FONT.head, size: SZ.cover, bold: true, color: C.white }), { after: subtitle ? 160 : 0, line: 240 })];
  if (subtitle) kids.push(para(run(subtitle, { size: SZ.lead, color: "DBEAFE" }), { after: 0 }));
  const banner = grid([W], [new TableRow({
    height: { value: 3200, rule: HeightRule.ATLEAST },
    children: [cell(kids, { w: W, fill: C.navy, valign: VerticalAlignTable.CENTER, margins: { top: 600, bottom: 600, left: 640, right: 640 } })],
  })]);
  const ws = cols(meta.map(() => 1));
  const metaRow = grid(ws, [new TableRow({ children: meta.map(([k, v], i) => cell([
    para(run(k, { size: SZ.small, color: C.muted }), { after: 20 }),
    para(run(v, { size: SZ.body, bold: true }), { after: 0 }),
  ], { w: ws[i], margins: { top: 160, bottom: 160, left: i ? 140 : 0, right: 140 }, borders: { top: NONE, left: NONE, right: NONE, bottom: line(4, C.line) } })) })]);
  // ВАЖНО: без абзаца между таблицами Docs склеит баннер со строкой meta (проверено).
  return [banner, spacer(0), metaRow];
}

// ─── 2. Заголовки ───
// Раздел всегда с новой страницы: pageBreakBefore у самого заголовка, а не отдельный абзац с PageBreak -
// иначе раздел, заполнивший страницу ровно, дает пустую страницу (абзац-разрыв переезжает и рвет еще раз).
// Предыдущий элемент никогда не несет keepNext (таблица, заметка, список) - связка, ломающая Docs, не возникает.
function sectionTitle(num, title) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1, keepNext: true, pageBreakBefore: true,
    spacing: { before: 120, after: 200 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: C.line, space: 6 } },
    children: [run(String(num).padStart(2, "0") + "  ", { font: FONT.head, size: SZ.h1, bold: true, color: C.blue }),
      run(title, { font: FONT.head, size: SZ.h1, bold: true, color: C.navy })],
  });
}
const h2 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_2, keepNext: true, spacing: { before: 280, after: 100 }, children: [run(t, { font: FONT.head, size: SZ.h2, bold: true, color: C.navy })] });
const h3 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_3, keepNext: true, spacing: { before: 200, after: 80 }, children: [run(t, { size: SZ.h3, bold: true, color: C.text })] });
const lead = (t) => para(rich(t, { size: SZ.lead, color: "374151" }), { after: 200, line: 288 });
const note = (t) => para(run(t, { size: SZ.small, color: C.muted, italics: true }), { before: 60, after: 160 });

// ─── 3. KPI-плитки: крупная цифра + подпись; зазоры - пустые колонки; цветная полоса сверху ───
// tone: info (по умолчанию) | accent | success | danger | loss | neutral
function kpiRow(items) {
  const n = items.length;
  const ws = tileWidths(n, 200);
  const maxLen = Math.max(...items.map((it) => clean(it.value).length));
  // размер цифры по ряду (одинаковый у всех плиток): 3 плитки - 24pt, 4 плитки или длинные значения - мельче
  let size = n >= 4 ? SZ.kpiSmall : SZ.kpi;
  if (maxLen > (n >= 4 ? 6 : 7)) size = n >= 4 ? 32 : SZ.kpiSmall;
  if (maxLen > (n >= 4 ? 8 : 10)) size = n >= 4 ? 28 : 34;
  const cells = [];
  items.forEach((it, i) => {
    const toneKey = it.tone === "accent" ? "info" : (TONES[it.tone] ? it.tone : "info");
    const tone = TONES[toneKey];
    const valueColor = it.tone === "accent" ? C.blue : toneKey === "info" || toneKey === "neutral" ? C.navy : tone.stripe;
    cells.push(cell([
      para(run(it.value, { font: FONT.head, size, bold: true, color: valueColor }), { after: 60, line: 240 }),
      para(rich(it.label, { size: SZ.small, color: "4B5563" }), { after: 0, line: 252 }),
    ], { w: ws[i * 2], fill: tone.fill, margins: { top: 220, bottom: 220, left: 220, right: 160 },
      borders: { top: line(24, tone.stripe), bottom: NONE, left: NONE, right: NONE } }));
    if (i < n - 1) cells.push(cell(tiny(), { w: ws[i * 2 + 1], margins: { top: 0, bottom: 0, left: 0, right: 0 } }));
  });
  return grid(ws, [new TableRow({ cantSplit: true, children: cells })]);
}

// ─── 4. Выноска: одноячеечная таблица, заливка + левая полоса 4.5pt ───
function callout({ tone = "info", kicker, title, body, items, itemKind, big, kickerColor }) {
  const t = TONES[tone] || TONES.info;
  const kids = [];
  if (kicker) kids.push(para(run(kicker, { size: SZ.small, bold: true, color: kickerColor || t.stripe }), { after: 60 }));
  if (title) kids.push(para(big ? run(title, { font: FONT.head, size: 40, bold: true, color: t.title }) : rich(title, { size: SZ.h3, bold: true, color: t.title }), { after: body || (items && items.length) ? 80 : 0, line: big ? 240 : 276 }));
  if (body) kids.push(para(rich(body), { after: items && items.length ? 80 : 0 }));
  if (items && items.length) kids.push(...bullets(items, itemKind || (tone === "success" ? "check" : tone === "danger" ? "cross" : "arrow"), { lastAfter: 0 }));
  if (!kids.length) kids.push(tiny());
  return grid([W], [new TableRow({ cantSplit: true, children: [cell(kids, {
    w: W, fill: t.fill, margins: { top: 200, bottom: 200, left: 280, right: 280 },
    borders: { top: NONE, bottom: NONE, right: NONE, left: line(36, t.stripe) },
  })] })]);
}

// Карточка проблемы (блок issues): выноска поплотнее - метка важности в строке заголовка, полоса цветом важности.
function issueCard({ tone, label, title, text }) {
  const t = TONES[tone] || TONES.danger;
  const kids = [para([run(label + "  ", { size: SZ.small, bold: true, color: t.stripe }), ...rich(title, { size: SZ.h3, bold: true, color: t.title })], { after: text ? 40 : 0 })];
  if (text) kids.push(para(rich(text), { after: 0 }));
  return grid([W], [new TableRow({ cantSplit: true, children: [cell(kids, {
    w: W, fill: t.fill, margins: { top: 140, bottom: 140, left: 280, right: 280 },
    borders: { top: NONE, bottom: NONE, right: NONE, left: line(36, t.stripe) },
  })] })]);
}

// ─── 5. Таблица: только горизонтальные линейки, «ваша» строка подсвечена, числа вправо ───
const NUMERIC_RE = /^[~≈+\-−]?\s*[\d\s.,]+\s*(%|k|к|тыс\.?|млн|₽|руб\.?)?$/i;
function dataTable({ columns, rows, fracs, highlight, align }) {
  const ws = cols(fracs || columns.map(() => 1));
  const hb = { top: NONE, left: NONE, right: NONE, bottom: line(12, C.navy) };
  const rb = { top: NONE, left: NONE, right: NONE, bottom: line(4, C.line) };
  const al = (i) => (align && align[i] === "r" ? AlignmentType.RIGHT : align && align[i] === "c" ? AlignmentType.CENTER : AlignmentType.LEFT);
  const head = new TableRow({ tableHeader: true, children: columns.map((h, i) => cell(para(run(h, { size: SZ.small, bold: true, color: C.muted }), { after: 0, align: al(i) }), { w: ws[i], borders: hb, margins: { top: 80, bottom: 80, left: 120, right: 120 } })) });
  const body = rows.map((r, ri) => {
    const hi = highlight && highlight(r, ri);
    const cells = columns.map((_, i) => cell(
      para(rich(String(r[i] ?? ""), { size: SZ.table, bold: hi && i === 0 }), { after: 0, align: al(i) }),
      { w: ws[i], borders: rb, fill: hi ? C.orangeTint : undefined, valign: VerticalAlignTable.CENTER, margins: { top: 90, bottom: 90, left: 120, right: 120 } }));
    return new TableRow({ cantSplit: true, children: cells });
  });
  return grid(ws, [head, ...body]);
}

// ─── 6. Матрица «есть / нет»: ✓ / ✗ / ~ цветом, колонка «Вы» с подложкой ───
function statusValue(v) {
  if (v === true || v === 1) return "yes";
  if (v === false || v === 0 || v == null) return "no";
  const s = clean(v).trim().toLowerCase();
  if (["да", "есть", "yes", "true", "+", "✓"].includes(s)) return "yes";
  if (["нет", "no", "false", "-", "✗", ""].includes(s)) return "no";
  return "part"; // «частично» и любые оговорки
}
function statusMatrix({ firstHeader, sites, rows, you }) {
  const n = sites.length;
  const siteW = Math.min(1500, Math.floor((W - 2600) / Math.max(n, 1)));
  const ws = [W - siteW * n, ...Array(n).fill(siteW)];
  const hb = { top: NONE, left: NONE, right: NONE, bottom: line(12, C.navy) };
  const rb = { top: NONE, left: NONE, right: NONE, bottom: line(4, C.line) };
  const head = new TableRow({ tableHeader: true, children: [
    cell(para(run(firstHeader, { size: SZ.small, bold: true, color: C.muted }), { after: 0 }), { w: ws[0], borders: hb }),
    ...sites.map((s, i) => cell(para(run(s, { size: SZ.small, bold: true, color: i === you ? C.orange : C.muted }), { after: 0, align: AlignmentType.CENTER }),
      { w: ws[i + 1], borders: hb, margins: { top: 100, bottom: 100, left: 60, right: 60 }, valign: VerticalAlignTable.BOTTOM })),
  ] });
  const MARK = { yes: ["✓", C.green, C.greenTint], no: ["✗", C.red, C.redTint], part: ["~", C.amber, C.amberTint] };
  const body = rows.map((r) => new TableRow({ cantSplit: true, children: [
    cell(para(rich(r.label, { size: SZ.table }), { after: 0 }), { w: ws[0], borders: rb, valign: VerticalAlignTable.CENTER }),
    ...sites.map((_, si) => {
      const mark = MARK[statusValue((r.values || [])[si])];
      return cell(para(run(mark[0], { size: SZ.h3, bold: true, color: mark[1] }), { after: 0, align: AlignmentType.CENTER }),
        { w: ws[si + 1], borders: rb, fill: si === you ? mark[2] : undefined, valign: VerticalAlignTable.CENTER, margins: { top: 60, bottom: 60, left: 60, right: 60 } });
    }),
  ] }));
  return grid(ws, [head, ...body]);
}

// ─── 7. Деньги, которые вы теряете: крупная сумма + цепочка шагов со стрелками ───
function moneyBlock({ amount, caption, steps, disclaimer }) {
  const out = [callout({ tone: "loss", kicker: "ДЕНЬГИ, КОТОРЫЕ ВЫ ТЕРЯЕТЕ", title: amount, body: caption, big: true }), spacer(120)];
  const arrowW = 420, n = steps.length, cw = Math.floor((W - arrowW * (n - 1)) / n);
  const ws = [];
  steps.forEach((_, i) => { ws.push(cw); if (i < n - 1) ws.push(arrowW); });
  ws[ws.length - 1] += W - ws.reduce((a, b) => a + b, 0);
  const cells = [];
  steps.forEach((s, i) => {
    const last = i === n - 1;
    cells.push(cell([
      para(run(s.value, { font: FONT.head, size: 32, bold: true, color: last ? C.white : C.navy }), { after: 40, align: AlignmentType.CENTER, line: 240 }),
      para(run(s.label, { size: SZ.small, color: last ? "FFE8D9" : C.muted }), { after: 0, align: AlignmentType.CENTER, line: 252 }),
    ], { w: ws[i * 2], fill: last ? C.orange : C.surface, valign: VerticalAlignTable.CENTER, margins: { top: 180, bottom: 180, left: 100, right: 100 } }));
    if (!last) cells.push(cell(para(run("→", { size: 32, bold: true, color: C.faint }), { after: 0, align: AlignmentType.CENTER }), { w: arrowW, valign: VerticalAlignTable.CENTER, margins: { top: 0, bottom: 0, left: 0, right: 0 } }));
  });
  out.push(grid(ws, [new TableRow({ cantSplit: true, children: cells })]));
  if (disclaimer) out.push(note(disclaimer));
  return out;
}

// ─── 8. Горизонтальные столбики: сетка 20 колонок, столбик = объединенные ячейки ───
// items: [{label, value, valueText?, color?, you?, bold?}]
function hbarChart(items, { labelCols = 6 } = {}) {
  const N = 20, BAR = N - labelCols;
  const ws = cols(Array(N).fill(1));
  const top = Math.max(1, ...items.map((i) => toNum(i.value)));
  const z = { top: 0, bottom: 0, left: 0, right: 0 };
  const rows = items.map((it) => {
    const v = Math.max(0, toNum(it.value));
    const k = Math.max(1, Math.min(BAR, Math.round((v / top) * BAR)));
    const color = it.you ? C.orange : it.color || C.blueSoft;
    const darkBar = it.you || color === C.blue || color === C.navy || color === C.orange;
    const label = run(it.label, { size: SZ.small, bold: !!(it.you || it.bold), color: it.you ? C.orange : it.bold ? C.navy : C.text });
    const txt = it.valueText != null ? it.valueText : fmtInt(v);
    const cells = [cell(para(label, { after: 0, line: 252 }), { span: labelCols, valign: VerticalAlignTable.CENTER, margins: { top: 40, bottom: 40, left: 0, right: 100 } })];
    if (BAR - k < 3) {
      // хвоста не хватает под подпись - число внутри столбика
      cells.push(cell(para(run(txt, { size: SZ.small, bold: true, color: darkBar ? C.white : C.navy }), { after: 0, align: AlignmentType.RIGHT }),
        { span: k, fill: color, valign: VerticalAlignTable.CENTER, margins: { top: 40, bottom: 40, left: 80, right: 100 } }));
      if (BAR - k > 0) cells.push(cell(tiny(), { span: BAR - k, margins: z }));
    } else {
      cells.push(cell(tiny(), { span: k, fill: color, margins: z }));
      cells.push(cell(para(run(txt, { size: SZ.small, bold: true }), { after: 0 }), { span: BAR - k, valign: VerticalAlignTable.CENTER, margins: { top: 40, bottom: 40, left: 100, right: 0 } }));
    }
    return new TableRow({ cantSplit: true, height: { value: 400, rule: HeightRule.ATLEAST }, children: cells });
  });
  return grid(ws, rows, { borders: { ...TBL_NONE, insideHorizontal: line(36, C.white) } });
}

// ─── 9. Вертикальные столбики по месяцам: светлая часть - текущий уровень, темная - прирост ───
const CHART_LEVELS = 9; // уровней по высоте (верхний - под подпись значения)
// сколько уровней занимает текущий уровень трафика (0 - на графике не виден, подпись про светлую часть не нужна)
const chartBaseLevel = (values, base, levels = CHART_LEVELS) => (base > 0 ? Math.round((base / Math.max(1, ...values)) * (levels - 1)) : 0);
function columnChart(values, labels, { base = 0, levels = CHART_LEVELS, rowH = 180, valueFmt = fmtK } = {}) {
  const n = values.length, ws = cols(Array(n).fill(1));
  const max = Math.max(1, ...values);
  const lev = values.map((v) => Math.max(1, Math.round((v / max) * (levels - 1))));
  const baseLev = chartBaseLevel(values, base, levels);
  const z = { top: 0, bottom: 0, left: 0, right: 0 };
  const rows = [];
  for (let r = levels; r >= 1; r--) {
    rows.push(new TableRow({ height: { value: rowH, rule: HeightRule.EXACT }, children: values.map((v, i) => {
      if (lev[i] + 1 === r) return cell(para(run(valueFmt(v), { size: 14, bold: true, color: C.navy }), { after: 0, align: AlignmentType.CENTER, line: 240 }), { w: ws[i], margins: z, valign: VerticalAlignTable.BOTTOM });
      const fill = lev[i] >= r ? (r <= Math.min(baseLev, lev[i]) ? C.blueSoft : C.blue) : undefined;
      return cell(tiny(), { w: ws[i], margins: z, fill });
    }) }));
  }
  rows.push(new TableRow({ children: labels.map((l, i) => cell(para(run(l, { size: 14, color: C.muted }), { after: 0, align: AlignmentType.CENTER, line: 240 }), { w: ws[i], margins: { top: 50, bottom: 0, left: 0, right: 0 }, borders: { top: line(6, C.faint), bottom: NONE, left: NONE, right: NONE } })) }));
  return grid(ws, rows, { borders: { ...TBL_NONE, insideVertical: line(48, C.white) } });
}

// ─── 10. Карточка пункта плана: номер слева, справа заголовок и ПРОБЛЕМА / РЕШЕНИЕ / ЭФФЕКТ ───
function growthCard({ n, title, problem, solution, effect }) {
  const ws = [1000, W - 1000];
  const row = (label, text, color) => para([run(label + "  ", { size: SZ.small, bold: true, color }), ...rich(text, { size: SZ.body })], { after: 60 });
  const kids = [para(rich(title, { size: SZ.h3, bold: true, color: C.navy }), { after: 80 })];
  if (problem) kids.push(row("ПРОБЛЕМА", problem, C.red));
  if (solution) kids.push(row("РЕШЕНИЕ", solution, C.blue));
  if (effect) kids.push(row("ЭФФЕКТ", effect, C.green));
  return grid(ws, [new TableRow({ cantSplit: true, children: [
    cell(para(run(String(n).padStart(2, "0"), { font: FONT.head, size: 40, bold: true, color: C.blue }), { after: 0, line: 240 }), { w: ws[0], margins: { top: 160, bottom: 160, left: 0, right: 120 }, borders: { top: NONE, left: NONE, right: NONE, bottom: line(4, C.line) } }),
    cell(kids, { w: ws[1], margins: { top: 160, bottom: 100, left: 0, right: 0 }, borders: { top: NONE, left: NONE, right: NONE, bottom: line(4, C.line) } }),
  ] })]);
}

// ─── 11. План работ по месяцам (Гант таблицей): разовые - короткая полоса + «нед. N-M», ежемесячные - полосой ───
// phases: [{name, from, to, tag, inside?: bool, color, textColor}]
function timeline(phases, months = 12) {
  const labelW = 2600, ws = [labelW, ...cols(Array(months).fill(1), W - labelW)];
  const z = { top: 60, bottom: 60, left: 60, right: 60 };
  const headB = { top: NONE, left: NONE, right: NONE, bottom: line(8, C.navy) };
  const head = new TableRow({ tableHeader: true, children: [
    cell(para(run("Работы", { size: SZ.small, bold: true, color: C.muted }), { after: 0 }), { w: labelW, margins: { ...z, left: 0 }, borders: headB }),
    ...Array.from({ length: months }, (_, i) => cell(para(run(`${i + 1}`, { size: SZ.small, bold: true, color: C.muted }), { after: 0, align: AlignmentType.CENTER }), { w: ws[i + 1], margins: z, borders: headB })),
  ] });
  const rows = phases.map((p) => {
    const cells = [cell(para(run(p.name, { size: SZ.table }), { after: 0, line: 252 }), { w: labelW, margins: { ...z, left: 0 }, valign: VerticalAlignTable.CENTER })];
    for (let m = 1; m < p.from; m++) cells.push(cell(tiny(), { w: ws[m], margins: z }));
    const span = p.to - p.from + 1;
    const tagRun = run(p.tag || "", { size: 14, bold: true, color: p.textColor || C.white });
    cells.push(cell(p.inside ? para(tagRun, { after: 0, align: AlignmentType.CENTER, line: 240 }) : tiny(),
      { span, fill: p.color || C.blue, margins: z, valign: VerticalAlignTable.CENTER }));
    if (p.to < months) {
      if (!p.inside && p.tag) {
        cells.push(cell(para(run(p.tag, { size: 14, bold: true, color: C.muted }), { after: 0, line: 240 }),
          { span: months - p.to, margins: { ...z, left: 100 }, valign: VerticalAlignTable.CENTER }));
      } else {
        for (let m = p.to + 1; m <= months; m++) cells.push(cell(tiny(), { w: ws[m], margins: z }));
      }
    }
    return new TableRow({ cantSplit: true, height: { value: 380, rule: HeightRule.ATLEAST }, children: cells });
  });
  return grid(ws, [head, ...rows], { borders: { ...TBL_NONE, insideHorizontal: line(24, C.white), insideVertical: line(2, C.line) } });
}

// ─── 12. Колонтитулы: шапка справа с линейкой, подвал «TIMUR SEO | дата | стр. X из Y»; на обложке - пусто ───
function headerFooter(dom, dt, author) {
  return {
    headers: {
      first: new Header({ children: [para("", { after: 0 })] }),
      default: new Header({ children: [para([run(`SEO-стратегия  |  ${dom}`, { size: 16, color: C.faint })], { align: AlignmentType.RIGHT, after: 0, border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: C.line, space: 4 } } })] }),
    },
    footers: {
      first: new Footer({ children: [para("", { after: 0 })] }),
      default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [
        new TextRun({ font: FONT.body, size: 16, color: C.faint, children: [clean(`${author}  |  ${dt}  |  стр. `), PageNumber.CURRENT, " из ", PageNumber.TOTAL_PAGES] }),
      ] })] }),
    },
  };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// v2: СБОРКА ДОКУМЕНТА
// ════════════════════════════════════════════════════════════════════════════════════════════════

const DEFAULT_TITLES = {
  situation: "Где вы сейчас",
  competitors: "Кто в топе и почему",
  plan: "Что нужно, чтобы обогнать конкурентов",
  forecast: "Прогноз",
};

function buildV2() {
  const forecast = readJson("forecast.json", false);
  if (!forecast) {
    console.error(`${LOG} content v2 требует forecast.json в ${strategyDir} - сначала build-forecast.mjs (шаг forecast-done)`);
    process.exit(1);
  }
  const recKey = forecast.recommended || "growth";
  const rec = (forecast.tariffs || {})[recKey];
  if (!rec) {
    console.error(`${LOG} в forecast.json нет tariffs.${recKey} - пересобери build-forecast.mjs`);
    process.exit(1);
  }
  const fin = forecast.inputs || {};
  const econ = fin.economics || {};
  const oneStep = econ.model === "one_step";
  const t0 = toNum(fin.t0 ?? (forecast.baseline || {}).traffic_month);
  const lost = forecast.lost_now || {};
  const base = forecast.baseline || {};
  const series = Array.isArray(forecast.plan_series) ? forecast.plan_series : [];
  const leadWord = oneStep ? "заказов" : "обращений";

  const tp = content.title_page || {};
  const dom = tp.domain || domain;
  const dt = tp.date || date;
  const author = tp.author || "TIMUR SEO";
  const markersDone = [];

  // Строка допущений (из forecast.json inputs.economics) - мелким шрифтом под деньгами.
  const econNote = () => {
    const parts = [`конверсия из перехода в ${oneStep ? "заказ" : "обращение"} ${pct(econ.conversion_rate)}`];
    if (!oneStep) parts.push(`из обращения в продажу ${pct(econ.close_rate)}`);
    parts.push(`средний чек ${fmtInt(econ.avg_check)}${NBSP}₽${econ.avg_check_source === "client" ? "" : " (оценка)"}`);
    return `Допущения: ${parts.join(", ")}.`;
  };

  // ── маркеры, которые заполняет сборщик ──
  const MARKERS = {
    money_lost() {
      const rev = toNum(lost.revenue_month);
      if (!(rev > 0)) warn("money_lost: lost_now.revenue_month <= 0 - прирост по плану нулевой, проверь forecast.json");
      // Обращения = с сайта (переходы x конверсия, с ростом конверсии от прототипа и слабее у статей) + из Карт
      // напрямую. Чтобы воронка сходилась с подписью конверсии, Карты - отдельной строкой, а фактическая
      // конверсия дополнительных переходов - в допущениях, если она отличается от базовой.
      const m12 = (Array.isArray(rec.months) ? rec.months : []).find((x) => toNum(x.m) === 12) || {};
      const leads = toNum(lost.leads_month);
      const maps = Math.min(leads, toNum(lost.leads_maps_month ?? m12.leads_maps ?? (rec.drivers_m12 || {}).maps_leads));
      const siteLeads = Math.max(0, leads - maps);
      const gain = toNum(lost.traffic_month);
      const steps = [
        { value: fmtInt(gain), label: "переходов в месяц уходят к конкурентам" },
        {
          value: fmtCount(leads),
          label: maps >= 0.5 ? `${leadWord} в месяц: ${fmtCount(siteLeads)} с сайта и ${fmtCount(maps)} из Яндекс Карт` : `${leadWord} в месяц`,
        },
      ];
      if (!oneStep) steps.push({ value: fmtCount(lost.sales_month), label: "продаж в месяц" });
      steps.push({ value: fmtRub(rev), label: "выручки в месяц" });
      const drv = rec.drivers_m12 || {};
      let convNote = "";
      const effConv = gain > 0 ? siteLeads / gain : 0;
      if (gain > 0 && Math.abs(effConv - toNum(econ.conversion_rate)) >= 0.002) {
        const why = [];
        if (toNum(drv.conv_mult) > 1.01) why.push("сайт с прототипом по образцу лидеров конвертирует лучше, в том числе текущих посетителей");
        if (toNum(drv.articles) > 0) why.push("читатели статей обращаются реже");
        convNote = ` С сайта к 12-му месяцу выходит около ${pct(effConv)} от дополнительных переходов${why.length ? ` (${why.join("; ")})` : ""}.`;
      }
      const mapsNote = maps >= 0.5 ? " Обращения из Яндекс Карт идут из карточки напрямую, без перехода на сайт." : "";
      const disclaimer = `${econNote()}${convNote}${mapsNote} Это прирост к 12-му месяцу по плану работ сверх текущего уровня. Оценка, не гарантия; расчет по месяцам - в смете.`;
      return moneyBlock({
        amount: `около ${fmtRub(rev)} в месяц`,
        caption: "Столько выручки в месяц сейчас уходит к конкурентам: эти клиенты ищут ваши услуги, но находят не вас.",
        steps,
        disclaimer,
      });
    },

    plan_timeline() {
      const growthT = getTariffData(tariffs, recKey);
      const ids = growthT ? [...tariffServiceIds(growthT)] : (rec.ids || []);
      if (!growthT) warn(`plan_timeline: нет tariffs.json (${recKey}) - состав взят из forecast.json`);
      const items = timelineFor(ids);
      if (!items.length) { warn("plan_timeline: в рекомендованном составе нет работ для плана"); return []; }
      const WPM = 52 / 12;
      const monthOf = (w) => Math.min(12, Math.max(1, Math.floor(w / WPM) + 1));
      const CHAIN = new Set(["PA", "SY", "KP", "FQ"]);
      const phases = items.map((it) => {
        if (it.monthly) {
          return { name: it.label, from: monthOf(it.start_week), to: 12, tag: "каждый месяц", inside: true, color: C.blueSoft, textColor: C.navy };
        }
        const s = it.start_week + 1, e = it.start_week + it.weeks;
        return {
          name: it.label, from: monthOf(it.start_week), to: monthOf(it.start_week + it.weeks - 1),
          tag: s === e ? `нед. ${s}` : `нед. ${s}-${e}`, inside: false, color: CHAIN.has(it.id) ? C.blue : C.navy,
        };
      });
      return [h3("План работ по месяцам"), timeline(phases),
        note("Разовые работы идут по очереди: следующий этап стартует после вашего согласования предыдущего. Недели - ориентир при быстрых ответах. Ежемесячные работы идут весь год.")];
    },

    forecast_chart() {
      const pts = series.filter((p) => toNum(p.m) >= 1 && toNum(p.m) <= 12);
      if (pts.length < 12) warn(`forecast_chart: в plan_series ${pts.length} точек из 12`);
      if (!pts.length) return [];
      const values = pts.map((p) => toNum(p.traffic));
      return [h3("Переходы из поиска по месяцам"),
        columnChart(values, pts.map((p) => `М${p.m}`), { base: t0 }),
        note(chartBaseLevel(values, t0) >= 1 ? "Светлая часть столбика - текущий уровень, темная - прирост по плану работ. Оценка, не гарантия." : "Переходы из поиска в месяц по плану работ. Оценка, не гарантия.")];
    },

    forecast_table() {
      const months = Array.isArray(rec.months) ? rec.months : [];
      const at = (m) => months.find((x) => toNum(x.m) === m) || {};
      const bLeads = toNum(base.leads_month), bRev = toNum(base.revenue_month);
      const P = [3, 6, 12];
      const metrics = [
        { name: "Переходы из поиска в месяц", plan: [t0, ...P.map((m) => toNum(at(m).traffic))], none: Array(4).fill(t0), f: fmtInt },
        { name: `${oneStep ? "Заказы" : "Обращения"} в месяц`, plan: [bLeads, ...P.map((m) => bLeads + toNum(at(m).leads))], none: Array(4).fill(bLeads), f: fmtCount },
        { name: "Выручка в месяц", plan: [bRev, ...P.map((m) => bRev + toNum(at(m).revenue))], none: Array(4).fill(bRev), f: fmtRub },
      ];
      if (!months.length) warn("forecast_table: нет tariffs.<рекомендованный>.months в forecast.json");
      const ws = cols([2.3, 1.25, 1, 1, 1, 1.05]);
      const z = { top: 90, bottom: 90, left: 120, right: 120 };
      const hb = { top: NONE, left: NONE, right: NONE, bottom: line(12, C.navy) };
      const soft = { top: NONE, left: NONE, right: NONE, bottom: NONE };
      const rb = { top: NONE, left: NONE, right: NONE, bottom: line(4, C.line) };
      const hcell = (t, i) => cell(para(run(t, { size: SZ.small, bold: true, color: C.muted }), { after: 0, align: i >= 2 ? AlignmentType.RIGHT : AlignmentType.LEFT }), { w: ws[i], borders: hb, margins: { ...z, top: 80, bottom: 80 } });
      const rows = [new TableRow({ tableHeader: true, children: ["Показатель", "", "Сейчас", "Через 3 мес", "Через 6 мес", "Через 12 мес"].map(hcell) })];
      for (const mt of metrics) {
        rows.push(new TableRow({ cantSplit: true, children: [
          cell(para(run(mt.name, { size: SZ.table, bold: true }), { after: 0, line: 252 }), { w: ws[0], rowSpan: 2, borders: rb, margins: z, valign: VerticalAlignTable.CENTER }),
          cell(para(run("С планом", { size: SZ.small, bold: true, color: C.blue }), { after: 0 }), { w: ws[1], borders: soft, fill: C.blueTint, margins: z, valign: VerticalAlignTable.CENTER }),
          ...mt.plan.map((v, i) => cell(para(run(mt.f(v), { size: SZ.table, bold: true, color: C.navy }), { after: 0, align: AlignmentType.RIGHT }), { w: ws[i + 2], borders: soft, fill: C.blueTint, margins: z, valign: VerticalAlignTable.CENTER })),
        ] }));
        rows.push(new TableRow({ cantSplit: true, children: [
          cell(para(run("Без работ", { size: SZ.small, color: C.muted }), { after: 0 }), { w: ws[1], borders: rb, margins: z, valign: VerticalAlignTable.CENTER }),
          ...mt.none.map((v, i) => cell(para(run(mt.f(v), { size: SZ.table, color: C.muted }), { after: 0, align: AlignmentType.RIGHT }), { w: ws[i + 2], borders: rb, margins: z, valign: VerticalAlignTable.CENTER })),
        ] }));
      }
      return [h3("Сейчас и через 3, 6 и 12 месяцев"), grid(ws, rows),
        note(`«Без работ» - текущий уровень без изменений; разница между строками - то, что дает план работ. ${econNote()} Оценка, не гарантия.`)];
    },

    forecast_drivers() {
      const d = rec.drivers_m12 || {};
      const items = [];
      if (toNum(d.base) > 0) items.push({ label: "Текущий трафик", value: toNum(d.base), color: C.blueSoft });
      if (toNum(d.existing_gain) > 0) items.push({ label: "Рост существующих страниц", value: toNum(d.existing_gain), valueText: "+" + fmtInt(d.existing_gain), color: C.blue });
      if (toNum(d.new_pages) > 0) items.push({ label: "Новые страницы под спрос", value: toNum(d.new_pages), valueText: "+" + fmtInt(d.new_pages), color: C.blue });
      if (toNum(d.articles) > 0) items.push({ label: "Статьи", value: toNum(d.articles), valueText: "+" + fmtInt(d.articles), color: C.blue });
      const extra = [];
      const ml = toNum(d.maps_leads);
      const leadForms = oneStep ? ["заказ", "заказа", "заказов"] : ["обращение", "обращения", "обращений"];
      if (ml > 0) extra.push(`**+${fmtCount(ml)} ${plural(Math.abs(ml) < 10 ? Math.round(ml * 10) / 10 : Math.round(ml), leadForms)} в месяц** напрямую из Яндекс Карт, мимо сайта.`);
      if (toNum(d.conv_mult) > 1.005) extra.push(`**+${Math.round((toNum(d.conv_mult) - 1) * 100)}% к конверсии сайта**: страницы по образцу лидеров ниши.`);
      if (!items.length && !extra.length) { warn("forecast_drivers: в drivers_m12 нет ненулевых составляющих"); return []; }
      const out = [h3("За счет чего растем к 12 месяцу")];
      if (items.length) {
        // последняя строка - итог (переходов в месяц на 12-м месяце), от него масштаб остальных столбиков
        const total = toNum((rec.checkpoints || {}).m12);
        if (total > 0) items.push({ label: "Всего к 12 месяцу", value: Math.max(total, ...items.map((i) => i.value)), valueText: fmtInt(total), color: C.navy, bold: true });
        out.push(hbarChart(items));
        out.push(spacer(extra.length ? 120 : 0));
      }
      if (extra.length) out.push(...bullets(extra, "dot", { lastAfter: 160 }));
      return out;
    },
  };

  // ── обычные блоки писателя ──
  let planItemN = 0;
  function renderBlock(block, ctx) {
    const type = block && block.type;
    if (type && MARKERS[type]) {
      markersDone.push(type);
      return MARKERS[type]();
    }
    switch (type) {
      case "subheading":
        return [h2(block.text)];

      case "paragraph":
        if (!ctx.leadDone) { ctx.leadDone = true; return [lead(block.text)]; }
        return [para(rich(block.text), { after: 140 })];

      case "kpi_row": {
        const items = (block.items || []).filter((it) => it && it.value != null).slice(0, 4);
        if (!items.length) { warn("kpi_row без items - пропущен"); return []; }
        const TONE = { neutral: "info", good: "success", bad: "danger", accent: "accent" };
        return [kpiRow(items.map((it) => ({ value: String(it.value), label: it.label || "", tone: TONE[it.tone] || "info" })))];
      }

      case "issues": {
        const SEV = {
          high: { tone: "danger", kicker: "КРИТИЧНО" },
          medium: { tone: "loss", kicker: "ВАЖНО" },
          low: { tone: "neutral", kicker: "ЖЕЛАТЕЛЬНО" },
        };
        const out = [];
        if (block.title) out.push(h3(block.title));
        const items = (block.items || []).filter(Boolean);
        items.forEach((it, i) => {
          const s = SEV[it.severity] || SEV.medium;
          out.push(issueCard({ tone: s.tone, label: s.kicker, title: it.title, text: it.text }));
          if (i < items.length - 1) out.push(spacer(80));
        });
        return out;
      }

      case "bullets": {
        const items = strItems(block.items);
        const out = [];
        if (block.title) out.push(h3(block.title));
        out.push(...bullets(items, block.style || "dot", { lastAfter: 160 }));
        return out;
      }

      case "callout":
        return [callout({ tone: CALLOUT_TONE[block.tone] || "info", title: block.title, body: block.text, items: strItems(block.items) })];

      case "table": {
        const columns = (block.columns || []).map((c) => String(c ?? ""));
        // Строка - массив ячеек (строки/числа). Объект вместо строки или ячейки дал бы «[object Object]»:
        // предупреждение, строка-объект - по значениям полей, ячейка-объект - пустая.
        const cellOf = (v, ri) => {
          if (v == null || typeof v === "string" || typeof v === "number") return v;
          warn(`table: строка ${ri + 1} - ячейка не строка (${typeof v}), выведена пустой - verify-strategy должен был остановить`);
          return "";
        };
        const rows = (block.rows || []).map((r, ri) => {
          if (Array.isArray(r)) return r.map((v) => cellOf(v, ri));
          if (r && typeof r === "object") {
            warn(`table: строка ${ri + 1} - объект, а не массив ячеек; выведена по значениям полей`);
            return Object.values(r).map((v) => cellOf(v, ri));
          }
          return [cellOf(r, ri)];
        });
        if (!columns.length) { warn("table без columns - пропущен"); return []; }
        // ширины по средней длине текста в колонке; числовые колонки - вправо
        const fr = columns.map((c, i) => {
          const lens = [c, ...rows.map((r) => r[i])].map((v) => clean(v).length);
          return Math.min(30, Math.max(5, lens.reduce((a, b) => a + b, 0) / lens.length));
        });
        const align = columns.map((_, i) => (i > 0 && rows.length && rows.every((r) => r[i] == null || r[i] === "" || NUMERIC_RE.test(clean(r[i]).trim())) ? "r" : null));
        const domLow = clean(dom).toLowerCase();
        const out = [];
        if (block.title) out.push(h3(block.title));
        out.push(dataTable({
          columns, rows, fracs: fr, align,
          highlight: (r) => {
            const first = clean(r[0]).toLowerCase();
            return first.includes("(вы)") || first === "вы" || (domLow && first.includes(domLow));
          },
        }));
        return out;
      }

      case "compare": {
        const columns = (block.columns || []).map((c) => String(c ?? ""));
        if (columns.length < 2) { warn("compare: нужны columns [Элемент, ..., Вы] - пропущен"); return []; }
        const sites = columns.slice(1);
        let you = sites.findIndex((s) => /^вы$|\(вы\)/i.test(clean(s).trim()));
        if (you < 0) you = sites.length - 1;
        const out = [];
        if (block.title) out.push(h3(block.title));
        out.push(statusMatrix({ firstHeader: columns[0], sites, you, rows: (block.rows || []).filter((r) => r && r.label) }));
        out.push(note("✓ есть, ~ частично, ✗ нет."));
        return out;
      }

      case "bars": {
        const items = (block.items || []).filter((it) => it && it.label != null);
        if (!items.length) { warn("bars без items - пропущен"); return []; }
        const out = [];
        if (block.title) out.push(h3(block.title));
        out.push(hbarChart(items.map((it) => ({ label: String(it.label), value: toNum(it.value), you: !!it.highlight }))));
        if (block.unit) out.push(note(clean(block.unit).replace(/^./, (c) => c.toUpperCase()) + "."));
        return out;
      }

      case "plan_item":
        planItemN += 1;
        return [growthCard({ n: planItemN, title: block.title || "", problem: block.problem, solution: block.solution, effect: block.effect })];

      case "quick_wins":
        return [callout({ tone: "success", kicker: "МОЖНО СДЕЛАТЬ УЖЕ СЕЙЧАС", title: block.title, items: strItems(block.items), itemKind: "check" })];

      case "conditions":
        return [callout({ tone: "neutral", kicker: "УСЛОВИЯ ПРОГНОЗА", title: block.title, items: strItems(block.items), itemKind: "arrow", kickerColor: C.muted })];

      case "next_step":
        return [callout({ tone: "info", kicker: "СЛЕДУЮЩИЙ ШАГ", body: block.text })];

      default: {
        // Неизвестный тип: не теряем молча - text абзацем, items списком, иначе предупреждение.
        if (block && block.text) { warn(`неизвестный тип блока "${type}" - выведен абзацем`); return [para(rich(block.text), { after: 140 })]; }
        const items = strItems(block && block.items);
        if (items.length) { warn(`неизвестный тип блока "${type}" - выведен списком`); return bullets(items, "dot", { lastAfter: 160 }); }
        warn(`неизвестный тип блока "${type}" без text/items - пропущен`);
        return [];
      }
    }
  }

  const kids = [];
  const add = (...x) => kids.push(...x.flat().filter(Boolean));
  // Блок закончился таблицей -> отбивка перед следующим блоком; между карточками плана подряд - тонкий разделитель.
  // У последнего блока раздела отбивки нет: дальше заголовок раздела с новой страницы (лишний абзац в конце
  // заполненной страницы дал бы пустую страницу).
  const addBlock = (els, nextType, curType) => {
    if (!els.length) return;
    add(els);
    if (nextType && kids[kids.length - 1] instanceof Table) {
      add(spacer(curType === "plan_item" && nextType === "plan_item" ? 0 : 200));
    }
  };

  // ── Обложка + «Главное за одну минуту» ──
  add(cover({
    kicker: clean(tp.title || "SEO-стратегия").toUpperCase(),
    title: dom,
    subtitle: tp.niche_oneliner || inputs.niche_oneliner || "",
    meta: [["Регион", tp.region || inputs.region || "-"], ["Дата", dt], ["Подготовил", author]],
  }));
  add(spacer(320));
  add(h2("Главное за одну минуту"));

  const m12 = toNum((rec.checkpoints || {}).m12);
  let growthTile;
  if (t0 < 30) {
    growthTile = { value: `до ${fmtInt(m12)}`, label: "переходов из поиска в месяц к 12-му месяцу: сайт растет с нуля по плану работ", tone: "success" };
  } else {
    const ratio = m12 / Math.max(t0, 1);
    const value = ratio >= 2 ? `×${dec1(ratio)}` : `+${Math.max(0, Math.round((ratio - 1) * 100))}%`;
    growthTile = { value, label: `рост переходов из поиска за 12 месяцев по плану работ (с ${fmtInt(t0)} до ${fmtInt(m12)} в месяц)`, tone: "success" };
  }
  add(kpiRow([
    growthTile,
    { value: `~${fmtCount(lost.leads_month)}`, label: `${leadWord} в месяц сейчас уходят к конкурентам`, tone: "danger" },
    { value: `~${fmtRub(lost.revenue_month)}`, label: "выручки в месяц вы недополучаете", tone: "loss" },
  ]));
  add(spacer(200));
  const sm = content.summary || {};
  const points = strItems(sm.points);
  if (points.length || sm.headline) {
    add(callout({ tone: "info", kicker: "КОРОТКО", title: sm.headline, items: points, itemKind: "dot" }));
  } else {
    warn("нет summary.headline / summary.points - выноска «Коротко» пропущена");
  }
  add(note("Цифры - оценка по данным анализа сайта, конкурентов и спроса в вашем регионе, не гарантия. Как считали - в разделе «Прогноз»."));

  // ── Разделы ──
  const sections = Array.isArray(content.sections) ? content.sections : [];
  sections.forEach((section, idx) => {
    add(sectionTitle(idx + 1, section.title || DEFAULT_TITLES[section.key] || ""));
    const ctx = { leadDone: false };
    const blocks = (Array.isArray(section.blocks) ? section.blocks : []).filter(Boolean);
    blocks.forEach((block, bi) => {
      const next = blocks[bi + 1];
      addBlock(renderBlock(block, ctx), next && (next.type || "?"), block.type);
    });
  });

  if (content.next_step) {
    add(spacer(200));
    add(callout({ tone: "info", kicker: "СЛЕДУЮЩИЙ ШАГ", body: String(content.next_step) }));
  }
  add(spacer(0)); // документ не заканчивается таблицей

  // Страховка: две таблицы подряд Docs склеит - вставляем абзац (компоненты так не делают, но блоки могут).
  for (let i = kids.length - 1; i > 0; i--) {
    if (kids[i] instanceof Table && kids[i - 1] instanceof Table) kids.splice(i, 0, spacer(0));
  }

  // Контроль обязательных маркеров (жесткий гейт - verify-strategy.mjs; здесь - подсказка в лог).
  const REQUIRED = { situation: ["money_lost"], plan: ["plan_timeline"], forecast: ["forecast_chart", "forecast_table"] };
  for (const [key, need] of Object.entries(REQUIRED)) {
    const sec = sections.find((s) => s && s.key === key);
    const types = new Set(((sec && sec.blocks) || []).map((b) => b && b.type));
    for (const t of need) if (!types.has(t)) warn(`в разделе ${key} нет маркера ${t}`);
  }

  console.log(`${LOG} v2: разделов ${sections.length}, маркеры: ${markersDone.join(", ") || "-"}`);

  return new Document({
    creator: clean(author),
    title: clean(`SEO-стратегия ${dom}`),
    styles: {
      default: {
        document: { run: { font: FONT.body, size: SZ.body, color: C.text }, paragraph: { spacing: { line: 276 } } },
        heading1: { run: { font: FONT.head, size: SZ.h1, bold: true, color: C.navy }, paragraph: { keepNext: true } },
        heading2: { run: { font: FONT.head, size: SZ.h2, bold: true, color: C.navy }, paragraph: { keepNext: true } },
        heading3: { run: { font: FONT.body, size: SZ.h3, bold: true, color: C.text }, paragraph: { keepNext: true } },
      },
    },
    numbering: NUMBERING,
    sections: [{
      properties: { titlePage: true, page: { size: { width: PAGE.w, height: PAGE.h }, margin: { top: PAGE.margin, right: PAGE.margin, bottom: PAGE.margin, left: PAGE.margin, header: 567, footer: 567 } } },
      ...headerFooter(dom, dt, author),
      children: kids,
    }],
  });
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// ЛЕГАСИ: старый рендер (content без format "v2") - 6 разделов, tariff / special / decomposition_table.
// Код сохранен как был; добавлены только нормализация строк (тире, е-с-точками) и предупреждение
// о неизвестных блоках (items выводятся списком, а не теряются молча).
// ════════════════════════════════════════════════════════════════════════════════════════════════

function renderLegacy() {
  // ═══ Дизайн-токены ═══
  const C = {
    header_bg: "1F4E79",
    header_text: "FFFFFF",
    total_bg: "D5E8F0",
    row_alt: "F2F2F2",
    row_white: "FFFFFF",
    accent: "1F4E79",
    text: "000000",
    muted: "666666",
    verdict_green: "2E7D32",
  };
  const F = {
    family: "Arial",
    size_title: 28,    // 14pt (half-points)
    size_subtitle: 24, // 12pt
    size_body: 20,     // 10pt
    size_table: 18,    // 9pt
    size_footer: 16,   // 8pt
  };

  // ═══ Хелперы ═══
  const border = { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" };
  const borders = { top: border, bottom: border, left: border, right: border };
  const cellMargins = { top: 80, bottom: 80, left: 120, right: 120 };

  function run(text, opts = {}) {
    return new TextRun({
      text: clean(text),
      font: F.family,
      size: opts.size ?? F.size_body,
      bold: opts.bold || false,
      italics: opts.italics || false,
      color: opts.color || C.text,
    });
  }

  function paragraph(text, opts = {}) {
    return new Paragraph({
      spacing: opts.spacing || { before: 80, after: 80 },
      alignment: opts.alignment || AlignmentType.LEFT,
      children: Array.isArray(text) ? text : [run(text, opts)],
    });
  }

  function heading(text, level) {
    // level 1 = section title, level 2 = subheading, level 3 = block title
    const sizeMap = { 1: F.size_title, 2: F.size_subtitle, 3: F.size_body + 2 };
    return new Paragraph({
      spacing: { before: 240, after: 120 },
      children: [run(text, { size: sizeMap[level] || F.size_subtitle, bold: true, color: C.accent })],
    });
  }

  function headerCell(text, widthDxa) {
    return new TableCell({
      borders,
      width: { size: widthDxa, type: WidthType.DXA },
      shading: { fill: C.header_bg, type: ShadingType.CLEAR },
      margins: cellMargins,
      children: [new Paragraph({
        children: [new TextRun({
          text: clean(text), font: F.family, size: F.size_table, bold: true, color: C.header_text,
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
        children: [new TextRun({
          text: clean(text), font: F.family, size: F.size_table,
        })],
      })],
    });
  }

  function tableBlock(columns, rows) {
    const contentWidth = 9638; // A4 -2cm margins each
    const colCount = columns.length || 1;
    const colWidth = Math.floor(contentWidth / colCount);
    const columnWidths = new Array(colCount).fill(colWidth);

    const headerRow = new TableRow({
      tableHeader: true,
      children: columns.map((c) => headerCell(c, colWidth)),
    });
    const dataRows = rows.map((r, i) =>
      new TableRow({
        children: r.map((cellV) => dataCell(cellV, colWidth, i % 2 === 1)),
      })
    );
    return new Table({
      columnWidths,
      layout: TableLayoutType.FIXED,
      rows: [headerRow, ...dataRows],
      width: { size: contentWidth, type: WidthType.DXA },
    });
  }

  function bulletList(items) {
    return items.map((it) =>
      new Paragraph({
        bullet: { level: 0 },
        spacing: { before: 40, after: 40 },
        children: [run(it)],
      })
    );
  }

  function fmtNum(n) {
    return Number(n || 0).toLocaleString("ru-RU");
  }

  // ═══ Декомпозиция в деньги (этап 8) ═══
  // Числа больше не пишет strategy-writer - он кладет блок-маркер {"type":"decomposition_table"}.
  // Здесь считаем таблицу «потенциал выручки» из forecast_scenarios (рекомендованный сценарий,
  // тариф Рост) через общий модуль _forecast-money.mjs. ROMI/окупаемость сюда НЕ попадают -
  // они только в смете (сноска "см. смету").
  function computeDecompositionRows(forecastScenarios, growthTariffData) {
    if (!forecastScenarios || !Array.isArray(forecastScenarios.scenarios) || !forecastScenarios.scenarios.length) return null;
    if (!growthTariffData) return null;

    const scenario = forecastScenarios.scenarios.find((s) => s && s.recommended) || forecastScenarios.scenarios[0];
    if (!scenario) return null;
    const assumptions = forecastScenarios.assumptions || {};
    const cr = Number(assumptions.conversion_rate) || 0.02;
    const close = Number(assumptions.close_rate) || (assumptions.model === "one_step" ? 1 : 0.3);
    const avg = Number(assumptions.avg_check) || 0;
    const scale = TARIFF_SCALE.growth ?? 1;
    const onetime = Number(growthTariffData.total_onetime) || 0;
    const monthly = Number(growthTariffData.total_monthly) || 0;

    const res = computeScenarioTariff({
      assumptions, checkpoints: scenario.traffic_checkpoints, activeMonths: scenario.active_months,
      tariffKey: "growth", onetime, monthly,
    });

    // Снимок трафик->лиды->продажи->выручка на конкретный месяц (та же методика, что модуль
    // использует для traffic12/leads12/sales12/revMonth12 - округление на выходе каждого шага).
    function snapshot(traffic) {
      const leads = Math.round(traffic * cr);
      const sales = Math.round(leads * close);
      return { t: Math.round(traffic), leads, sales, revenue: Math.round(sales * avg) };
    }

    const traffic0 = interpCheckpoints(scenario.traffic_checkpoints, 0) * scale;
    const traffic6 = res.series[5] ? res.series[5].traffic : interpCheckpoints(scenario.traffic_checkpoints, 6) * scale;

    return {
      scenarioLabel: scenario.label || "",
      avgCheckSource: assumptions.avg_check_source,
      crPct: Math.round(cr * 1000) / 10,
      closePct: Math.round(close * 100),
      avg,
      now: snapshot(traffic0),
      at6: snapshot(traffic6),
      at12: { t: res.traffic12, leads: res.leads12, sales: res.sales12, revenue: res.revMonth12 },
    };
  }

  const decompRows = computeDecompositionRows(stratData.forecast_scenarios, getTariffData(tariffs, "growth"));

  // ═══ Рендер блока ═══
  function renderBlock(block) {
    const out = [];
    switch (block.type) {
      case "subheading":
        out.push(heading(block.text, 2));
        break;

      case "paragraph":
        out.push(paragraph(block.text));
        break;

      case "table":
        out.push(tableBlock(block.columns || [], block.rows || []));
        out.push(paragraph("")); // отступ
        break;

      case "decomposition_table":
        // Плейсхолдер от strategy-writer - числа считает сборщик из forecast_scenarios
        // (см. computeDecompositionRows выше). Писатель числа выручки НЕ пишет (этап 8).
        if (decompRows) {
          out.push(paragraph(
            `Перевели прогноз трафика в бизнес-результат через средний чек (сценарий "${decompRows.scenarioLabel}", тариф Рост).`
          ));
          out.push(tableBlock(
            ["Показатель", "Сейчас", "Через 6 мес", "Через 12 мес"],
            [
              ["Трафик (переходов/мес)", fmtNum(decompRows.now.t), fmtNum(decompRows.at6.t), fmtNum(decompRows.at12.t)],
              ["Обращения/лиды", fmtNum(decompRows.now.leads), fmtNum(decompRows.at6.leads), fmtNum(decompRows.at12.leads)],
              ["Продажи", fmtNum(decompRows.now.sales), fmtNum(decompRows.at6.sales), fmtNum(decompRows.at12.sales)],
              ["Выручка (руб)", fmtNum(decompRows.now.revenue), fmtNum(decompRows.at6.revenue), fmtNum(decompRows.at12.revenue)],
            ]
          ));
          out.push(paragraph(
            `Допущения: конверсия в заявку ${decompRows.crPct}%, заявка в продажу ${decompRows.closePct}%, средний чек ${fmtNum(decompRows.avg)} руб${decompRows.avgCheckSource === "estimated" ? " (оценочный)" : ""}. Оценка, не гарантия.`
          ));
          out.push(paragraph("Расчет окупаемости - см. смету, вкладка Декомпозиция.", { italics: true, color: C.muted }));
          out.push(paragraph(""));
        } else {
          console.warn(`${LOG} decomposition_table: нет forecast_scenarios или tariffs.json (тариф Рост) - блок пропущен`);
        }
        break;

      case "problem_block":
        out.push(heading(block.title || "Проблема", 3));
        if (block.why) out.push(paragraph([run("Почему важно: ", { bold: true }), run(block.why)]));
        if (block.impact) out.push(paragraph([run("Влияние: ", { bold: true }), run(block.impact)]));
        break;

      case "growth_point":
        out.push(heading(block.name, 3));
        if (block.problem)
          out.push(paragraph([run("Проблема: ", { bold: true }), run(block.problem)]));
        if (block.consequences)
          out.push(paragraph([run("Последствия: ", { bold: true }), run(block.consequences)]));
        if (block.solution)
          out.push(paragraph([run("Решение: ", { bold: true }), run(block.solution)]));
        if (block.evidence_table) {
          out.push(paragraph([run("Доказательства:", { bold: true })]));
          out.push(tableBlock(block.evidence_table.columns || [], block.evidence_table.rows || []));
        }
        if (Array.isArray(block.competitor_facts) && block.competitor_facts.length) {
          out.push(...bulletList(block.competitor_facts));
        }
        if (block.summary)
          out.push(paragraph([run("Итог: ", { bold: true }), run(block.summary)]));
        out.push(paragraph(""));
        break;

      case "quick_wins":
        out.push(heading("Quick Wins", 3));
        out.push(...bulletList(block.items || []));
        break;

      case "tariff": {
        const titleParts = [run(`Вариант «${block.name}»`, { bold: true, size: F.size_subtitle, color: C.accent })];
        if (block.recommended) {
          titleParts.push(run("  ← рекомендованный", { italics: true, color: C.verdict_green }));
        }
        out.push(new Paragraph({
          spacing: { before: 200, after: 80 },
          children: titleParts,
        }));

        if (block.preamble) out.push(paragraph(block.preamble));
        if (Array.isArray(block.services) && block.services.length) {
          out.push(paragraph([run("Что входит:", { bold: true })]));
          block.services.forEach((s) => {
            const lineText = s.description ? `${s.name} - ${s.description}` : s.name;
            out.push(new Paragraph({
              bullet: { level: 0 },
              spacing: { before: 40, after: 40 },
              children: [run(lineText)],
            }));
          });
        }
        if (block.expected_result) {
          out.push(paragraph([run("Ожидаемый результат: ", { bold: true }), run(block.expected_result)]));
        }
        if (block.hint) {
          out.push(new Paragraph({
            spacing: { before: 80, after: 160 },
            children: [run(block.hint, { italics: true, color: C.muted })],
          }));
        }
        break;
      }

      case "special":
        if (Array.isArray(block.items) && block.items.length) {
          out.push(heading("Дополнительно", 3));
          block.items.forEach((it) => {
            out.push(paragraph([run(it.name, { bold: true }), run(" - "), run(it.description)]));
          });
        }
        break;

      case "conditions":
        if (Array.isArray(block.items) && block.items.length) {
          out.push(paragraph([run("Ключевые условия достижения прогноза:", { bold: true })]));
          out.push(...bulletList(block.items));
        }
        break;

      default:
        // Неизвестный тип - выводим как параграф, если есть text; список, если есть items; иначе - в лог.
        if (block.text) out.push(paragraph(block.text));
        else if (Array.isArray(block.items) && block.items.length) {
          console.warn(`${LOG} легаси: неизвестный тип блока "${block.type}" - выведен списком`);
          out.push(...bulletList(strItems(block.items)));
        } else {
          console.warn(`${LOG} легаси: неизвестный тип блока "${block.type}" без text/items - пропущен`);
        }
    }
    return out;
  }

  // ═══ Сборка документа ═══
  const docChildren = [];

  // Титульная страница
  const tp = content.title_page || {};
  docChildren.push(new Paragraph({
    spacing: { before: 2400, after: 240 },
    alignment: AlignmentType.CENTER,
    children: [run(tp.title || "SEO-СТРАТЕГИЯ ПРОДВИЖЕНИЯ", { size: F.size_title + 8, bold: true, color: C.accent })],
  }));
  docChildren.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 120, after: 120 },
    children: [run(tp.domain || domain, { size: F.size_title + 4, bold: true })],
  }));
  if (tp.niche_oneliner) {
    docChildren.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 80, after: 240 },
      children: [run(tp.niche_oneliner, { italics: true })],
    }));
  }
  docChildren.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 800, after: 80 },
    children: [run(`Регион: ${tp.region || ""}`)],
  }));
  docChildren.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 80, after: 80 },
    children: [run(`Дата: ${tp.date || date}`)],
  }));
  docChildren.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 800, after: 80 },
    children: [run(`Подготовлено: ${tp.author || "TIMUR SEO"}`, { bold: true, color: C.muted })],
  }));
  docChildren.push(new Paragraph({ children: [new PageBreak()] }));

  // Секции
  const sections = Array.isArray(content.sections) ? content.sections : [];
  sections.forEach((section, idx) => {
    // Заголовок раздела
    docChildren.push(new Paragraph({
      spacing: { before: 200, after: 200 },
      children: [run(`${section.id || idx + 1}. ${section.title || ""}`, { size: F.size_title + 4, bold: true, color: C.accent })],
    }));

    (section.blocks || []).forEach((block) => {
      const rendered = renderBlock(block);
      rendered.forEach((el) => docChildren.push(el));
    });

    // PageBreak между разделами (кроме последнего)
    if (idx < sections.length - 1) {
      docChildren.push(new Paragraph({ children: [new PageBreak()] }));
    }
  });

  // Подвал
  const footerPara = new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({
      text: clean(`TIMUR SEO | ${date}`),
      font: F.family, size: F.size_footer, color: C.muted,
    })],
  });

  return new Document({
    creator: "TIMUR SEO",
    title: clean(`SEO-стратегия ${domain}`),
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
          size: { width: 11906, height: 16838 },
          margin: { top: 1134, right: 1134, bottom: 1134, left: 1134 },
        },
      },
      headers: {},
      footers: {
        default: new Footer({ children: [footerPara] }),
      },
      children: docChildren,
    }],
  });
}

// ═══ Запуск ═══
// Формат - как в verify-strategy.mjs (trim + нижний регистр): «V2» проверка приняла бы как v2, а сборщик
// молча ушел бы в легаси-рендер без денег, графика и плана.
const isV2 = String(content.format ?? "").trim().toLowerCase() === "v2";
const doc = isV2 ? buildV2() : renderLegacy();
const buf = await Packer.toBuffer(doc);
writeFileSync(outputPath, buf);
for (const w of warnings) console.warn(`${LOG} ВНИМАНИЕ: ${w}`);
console.log(`${LOG} wrote ${outputPath} (${buf.length} bytes, ${isV2 ? "v2" : "легаси"})`);
