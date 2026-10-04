// md -> docx для загрузки в Google Drive с конверсией в Google Doc (публикация ТЗ каталога, 07-catalog-publisher).
// node scripts/md-to-docx.mjs <in.md> <out.docx> ["<заголовок>"]
// Вывод - одна строка JSON: { out, bytes, title, drive_name, title_added, headings, tables, paragraphs, listItems, code }.
//   drive_name - заголовок без точек (Drive принимает хвост после точки за расширение): его берет публикатор как имя
//   файла; headings и tables - для сверки загруженного документа.
// Таблицы: явные columnWidths и tblGrid на всю ширину страницы (Google Docs берет ширины из tblGrid буквально).
// Текст нормализуется по house style: буква «е с точками» -> е, длинное и среднее тире -> дефис. HTML-сущности
// (&nbsp;, &laquo;, числовые) декодируются, <br> - перенос строки (и в ячейке таблицы), прочие теги убираются;
// нумерованный список, прерванный абзацем, продолжает номер с «3.», как в md.
// Пакеты docx и marked - через deps.mjs (node_modules проекта или SITE_TEKST_NODE_MODULES).
// Коды: 0 - готово; 1 - нет пакетов (npm install в корне проекта); 2 - неверные аргументы или нет входного файла.
//
// node scripts/md-to-docx.mjs --check <tz.md> - проверка ТЗ каталога без пакетов (wf-07 и аудитор ТЗ): одна строка
// JSON { file, chars, headings, sections, missing, internal_refs, refs } - разделы «## 1.» .. «## 8.» (missing - каких
// нет) и служебные ссылки конвейера (id фактов, антиобещаний, блоков, сегментов, находок, пути файлов задачи, §),
// которых в клиентском ТЗ быть не должно. Коды: 0 - файл есть; 2 - нет файла; 3 - файл пустой.
import fs from 'node:fs';
import path from 'node:path';
import { loadDep } from './deps.mjs';

// служебные ссылки конвейера в тексте для разработчика
const REF_RES = [
  /\b[FA]\d{2,3}\b/g, /\bB\d{2}-[a-z][a-z0-9-]*/g, /\bCT-\d{2,3}\b/g, /\b[SO]\d{1,2}\b/g, /\b[gd]\d{1,2}\b/g,
  /\b(?:work|inputs|rules|config|scripts|schemas|prompts)\/[\w./-]*/g, /§\s*\d+/g, /\b[\w-]+\.(?:json|mjs|md)\b/g,
];
if (process.argv[2] === '--check') {
  const f = process.argv[3];
  if (!f || !fs.existsSync(f)) { console.error(`нет файла: ${f || '(путь не задан)'}`); process.exit(2); }
  const text = fs.readFileSync(f, 'utf8').replace(/^﻿/, '');
  const found = [...text.matchAll(/^##\s+(\d+)[.)]?\s/gm)].map(m => Number(m[1]));
  const sections = [...new Set(found)].sort((a, b) => a - b);
  const all = REF_RES.flatMap(re => text.match(re) || []);
  const out = {
    file: f, chars: text.replace(/\s/g, '').length, headings: (text.match(/^#{1,6}\s/gm) || []).length, sections,
    missing: [1, 2, 3, 4, 5, 6, 7, 8].filter(n => !sections.includes(n)), internal_refs: all.length, refs: [...new Set(all)].slice(0, 40),
  };
  console.log(JSON.stringify(out));
  if (!out.chars) { console.error(`пустой файл: ${f}`); process.exit(3); }
  process.exit(0);
}

const [, , inPath, outPath, titleArg] = process.argv;
if (!inPath || !outPath || !/\.docx$/i.test(outPath)) {
  console.error('usage: node scripts/md-to-docx.mjs <in.md> <out.docx> ["<заголовок>"] | --check <in.md>');
  process.exit(2);
}
if (!fs.existsSync(inPath)) { console.error(`нет файла: ${inPath}`); process.exit(2); }

const docx = await loadDep('docx');
const markedMod = await loadDep('marked');
if (!docx || !docx.Document || !markedMod) {
  console.error(`нет ${!docx || !docx.Document ? 'docx' : 'marked'}: npm install в корне проекта (или SITE_TEKST_NODE_MODULES)`);
  process.exit(1);
}
const lexer = (markedMod.marked && markedMod.marked.lexer) || markedMod.lexer;
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell,
  WidthType, TableLayoutType, BorderStyle, ShadingType, AlignmentType, LevelFormat,
  ExternalHyperlink,
} = docx;

// house style: коды символов, чтобы в исходнике не было самих запрещенных знаков
const house = s => String(s ?? '').replace(/\u0451/g, 'е').replace(/\u0401/g, 'Е').replace(/[\u2014\u2013]/g, '-');
const md = house(fs.readFileSync(inPath, 'utf8').replace(/^﻿/, ''));
const title = house(titleArg || path.basename(inPath, path.extname(inPath))).trim();
const driveName = title.replace(/\./g, ' ').replace(/\s+/g, ' ').trim() || 'document';
if (path.basename(outPath, path.extname(outPath)).includes('.')) console.error(`предупреждение: в имени файла ${path.basename(outPath)} есть точки`);

// A4, поля 2 см
const PAGE_W = 11906, PAGE_H = 16838, MARGIN = 1134;
const CONTENT_W = PAGE_W - 2 * MARGIN; // 9638 twip
const MIN_COL = 1200;
const FONT = 'Arial';
const MONO = 'Consolas';

// HTML-сущности: частые именованные и все числовые; после декодирования - снова house style (&mdash; -> дефис)
const ENT = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', laquo: '«', raquo: '»', bdquo: '„',
  ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', mdash: '-', ndash: '-', minus: '−', hellip: '…',
  times: '×', deg: '°', plusmn: '±', le: '≤', ge: '≥', larr: '←', rarr: '→', harr: '↔',
  copy: '©', reg: '®', trade: '™', euro: '€', numero: '№', bull: '•', middot: '·',
  thinsp: ' ', ensp: ' ', emsp: ' ', shy: '',
};
const decode = s => house(String(s ?? '').replace(/&(#\d{1,7}|#x[0-9a-f]{1,6}|[a-z]{2,8});/gi, (m, e) => {
  if (e[0] === '#') {
    const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return n > 0 && n <= 0x10FFFF && !(n >= 0xD800 && n <= 0xDFFF) ? String.fromCodePoint(n) : m;
  }
  return Object.prototype.hasOwnProperty.call(ENT, e) ? ENT[e] : m;
}));
const isBr = s => /^<br\s*\/?>$/i.test(String(s || '').trim());
// блок HTML: <br> - перенос, комментарии и теги убираются, сущности декодируются; пустой результат - ничего
const htmlLines = s => String(s || '').replace(/<!--[\s\S]*?-->/g, '').split(/<br\s*\/?>|\r?\n/i)
  .map(l => decode(l.replace(/<\/?[a-z][^>]*>/gi, '')).replace(/[ \t]+/g, ' ').trim()).filter(Boolean);

// ---------- строчные элементы ----------
function inlineRuns(tokens, fmt = {}) {
  const out = [];
  for (const t of tokens || []) {
    switch (t.type) {
      case 'strong': out.push(...inlineRuns(t.tokens, { ...fmt, bold: true })); break;
      case 'em': out.push(...inlineRuns(t.tokens, { ...fmt, italics: true })); break;
      case 'del': out.push(...inlineRuns(t.tokens, { ...fmt, strike: true })); break;
      case 'codespan':
        out.push(new TextRun({ ...fmt, text: decode(t.text), font: MONO, shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'F1F3F4' } }));
        break;
      case 'br': out.push(new TextRun({ ...fmt, text: '', break: 1 })); break;
      case 'link': {
        const children = inlineRuns(t.tokens, { ...fmt, style: 'Hyperlink' });
        out.push(new ExternalHyperlink({ link: t.href, children: children.length ? children : [new TextRun({ text: t.href, style: 'Hyperlink' })] }));
        break;
      }
      case 'image': out.push(new TextRun({ ...fmt, text: `[${decode(t.text || t.title || 'image')}]` })); break;
      // строчный HTML: <br> - перенос строки (многострочная ячейка таблицы), прочие теги и комментарии - без следа
      case 'html': if (isBr(t.raw ?? t.text)) out.push(new TextRun({ ...fmt, text: '', break: 1 })); break;
      case 'text':
        if (t.tokens && t.tokens.length) out.push(...inlineRuns(t.tokens, fmt));
        else out.push(new TextRun({ ...fmt, text: decode(t.text) }));
        break;
      default: out.push(new TextRun({ ...fmt, text: decode(t.text ?? t.raw ?? '') }));
    }
  }
  return out;
}
const plain = tokens => (tokens || []).map(t => (t.tokens ? plain(t.tokens) : decode(t.text ?? t.raw ?? ''))).join('');

// ---------- блоки ----------
const HEADINGS = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6];
let numberedInstance = 0;
const numStarts = new Set(); // номера начала нумерованных списков, кроме 1: своя ссылка нумерации num-s<N>
const stats = { headings: 0, tables: 0, paragraphs: 0, listItems: 0, code: 0 };

function listParagraphs(list, level) {
  const out = [];
  const inst = list.ordered ? ++numberedInstance : 0;
  const start = list.ordered && Number.isInteger(Number(list.start)) && Number(list.start) > 1 ? Number(list.start) : 1;
  if (start > 1) numStarts.add(start);
  const ref = start > 1 ? `num-s${start}` : 'num';
  for (const item of list.items) {
    let first = true;
    for (const bt of item.tokens || []) {
      if (bt.type === 'list') out.push(...listParagraphs(bt, Math.min(level + 1, 3)));
      else if (bt.type === 'text' || bt.type === 'paragraph') {
        const runs = bt.tokens ? inlineRuns(bt.tokens) : [new TextRun(decode(bt.text))];
        if (first) {
          out.push(new Paragraph({ children: runs, numbering: list.ordered ? { reference: ref, level, instance: inst } : { reference: 'bullet', level }, spacing: { after: 60 } }));
          stats.listItems++;
          first = false;
        } else out.push(new Paragraph({ children: runs, indent: { left: 720 * (level + 1) }, spacing: { after: 60 } }));
      } else if (bt.type !== 'space') out.push(...blocks([bt]));
    }
  }
  return out;
}

// ширины колонок: пропорционально средней длине содержимого, не уже минимума, сумма - ровно ширина текста
function columnWidths(lens, rowsCount, width = CONTENT_W) {
  const n = lens.length;
  const weights = lens.map(l => Math.max(1, l / Math.max(1, rowsCount)));
  const minCol = Math.min(MIN_COL, Math.floor(width / n));
  const widths = new Array(n).fill(0);
  const fixed = new Array(n).fill(false);
  for (let iter = 0; iter < n + 1; iter++) {
    const freeW = width - fixed.reduce((s, f) => s + (f ? minCol : 0), 0);
    const freeWeight = weights.reduce((s, w, i) => s + (fixed[i] ? 0 : w), 0);
    let changed = false;
    for (let i = 0; i < n; i++) {
      if (fixed[i]) { widths[i] = minCol; continue; }
      widths[i] = (weights[i] / freeWeight) * freeW;
      if (widths[i] < minCol) { fixed[i] = true; changed = true; }
    }
    if (!changed) break;
  }
  const ints = widths.map(w => Math.floor(w));
  ints[n - 1] += width - ints.reduce((s, w) => s + w, 0);
  return ints;
}

const border = { style: BorderStyle.SINGLE, size: 4, color: 'BFBFBF' };
const BORDERS = { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border };

function cellParagraph(cell, bold) {
  const runs = inlineRuns(cell?.tokens || [], bold ? { bold: true } : {});
  return new Paragraph({ children: runs.length ? runs : [new TextRun('')], spacing: { before: 40, after: 40 } });
}

function tableBlock(t) {
  const n = t.header.length;
  const all = [t.header, ...t.rows];
  const lens = Array.from({ length: n }, (_, i) => all.reduce((s, r) => s + (plain(r[i]?.tokens) || r[i]?.text || '').length, 0));
  const widths = columnWidths(lens, all.length);
  const mkRow = (cells, isHeader) => new TableRow({
    tableHeader: isHeader,
    cantSplit: false,
    children: Array.from({ length: n }, (_, i) => new TableCell({
      width: { size: widths[i], type: WidthType.DXA },
      margins: { top: 60, bottom: 60, left: 100, right: 100 },
      shading: isHeader ? { type: ShadingType.CLEAR, color: 'auto', fill: 'E8EAED' } : undefined,
      children: [cellParagraph(cells[i], isHeader)],
    })),
  });
  stats.tables++;
  return new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: widths,
    layout: TableLayoutType.FIXED,
    borders: BORDERS,
    rows: [mkRow(t.header, true), ...t.rows.map(r => mkRow(r, false))],
  });
}

function blocks(tokens) {
  const out = [];
  for (const t of tokens) {
    switch (t.type) {
      case 'heading':
        stats.headings++;
        out.push(new Paragraph({ heading: HEADINGS[Math.min(t.depth, 6) - 1], children: inlineRuns(t.tokens), spacing: { before: t.depth <= 2 ? 360 : 240, after: 120 }, keepNext: true }));
        break;
      case 'paragraph':
        stats.paragraphs++;
        out.push(new Paragraph({ children: inlineRuns(t.tokens), spacing: { after: 120 } }));
        break;
      case 'list':
        out.push(...listParagraphs(t, 0));
        out.push(new Paragraph({ children: [], spacing: { after: 60 } }));
        break;
      case 'table':
        out.push(tableBlock(t));
        out.push(new Paragraph({ children: [], spacing: { after: 120 } }));
        break;
      case 'code': {
        stats.code++;
        const runs = String(t.text).split('\n').map((l, i) => new TextRun({ text: l, font: MONO, size: 18, break: i ? 1 : 0 }));
        out.push(new Paragraph({ children: runs, shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'F1F3F4' }, spacing: { before: 60, after: 120 } }));
        break;
      }
      case 'blockquote': out.push(...blocks(t.tokens)); break;
      case 'hr': out.push(new Paragraph({ children: [], border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'BFBFBF', space: 1 } } })); break;
      case 'html': {
        const lines = htmlLines(t.text);
        if (lines.length) out.push(new Paragraph({ children: lines.map((l, i) => new TextRun({ text: l, break: i ? 1 : 0 })), spacing: { after: 120 } }));
        break;
      }
      case 'text': out.push(new Paragraph({ children: t.tokens ? inlineRuns(t.tokens) : [new TextRun(decode(t.text))] })); break;
      default: break;
    }
  }
  return out;
}

const tokens = lexer(md, { gfm: true });
const children = [];
const firstBlock = tokens.find(t => t.type !== 'space');
const titleAdded = !(firstBlock && firstBlock.type === 'heading' && firstBlock.depth === 1);
if (titleAdded) children.push(new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun(title)] }));
children.push(...blocks(tokens));

const indent = level => ({ paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } });
const bulletLevels = ['•', '◦', '▪', '-'].map((text, level) => ({ level, format: LevelFormat.BULLET, text, alignment: AlignmentType.LEFT, style: indent(level) }));
const numLevels = ['%1.', '%2.', '%3.', '%4.'].map((text, level) => ({ level, format: level === 1 ? LevelFormat.LOWER_LETTER : LevelFormat.DECIMAL, text, alignment: AlignmentType.LEFT, style: indent(level) }));
const heading = (id, name, size, outlineLevel) => ({ id, name, basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: FONT, size, bold: true }, paragraph: { outlineLevel } });

const doc = new Document({
  title,
  creator: 'SEO pipeline',
  styles: {
    default: { document: { run: { font: FONT, size: 22 } } },
    paragraphStyles: [
      { id: 'Title', name: 'Title', basedOn: 'Normal', next: 'Normal', run: { font: FONT, size: 40, bold: true }, paragraph: { spacing: { after: 240 } } },
      heading('Heading1', 'Heading 1', 36, 0), heading('Heading2', 'Heading 2', 30, 1),
      heading('Heading3', 'Heading 3', 26, 2), heading('Heading4', 'Heading 4', 23, 3),
    ],
  },
  numbering: { config: [{ reference: 'bullet', levels: bulletLevels }, { reference: 'num', levels: numLevels },
    ...[...numStarts].map(s => ({ reference: `num-s${s}`, levels: numLevels.map(l => ({ ...l, start: s })) }))] },
  sections: [{
    properties: { page: { size: { width: PAGE_W, height: PAGE_H }, margin: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN } } },
    children,
  }],
});

const buf = await Packer.toBuffer(doc);
fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
fs.writeFileSync(outPath, buf);
console.log(JSON.stringify({ out: outPath, bytes: buf.length, title, drive_name: driveName, title_added: titleAdded, ...stats }));
