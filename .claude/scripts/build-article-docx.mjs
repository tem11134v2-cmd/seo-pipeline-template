#!/usr/bin/env node
// build-article-docx.mjs
// Собирает финальный .docx статьи: шапка с метатегами + H1 + автор + breadcrumbs + body + FAQ + tags.
// Используется в /write-article (волна 3 roadmap) как итоговый deliverable для Google Drive.
//
// Вход:
//   <article_dir>/article.md             — текст статьи (Markdown)
//   <article_dir>/report.md              — метатеги (Title, Description, Анонс)
//   <article_dir>/photos/urls.json       — Cloudinary URLs
//   <article_dir>/photos/prompts.md      — alt-тексты (опционально)
//   <article_dir>/faq.html               — FAQ (опционально)
//   <article_dir>/meta.json              — slug, topic
//   <project_root>/ЗАКАЗЧИК.md           — автор, домен, URL блога
//
// Выход:
//   <article_dir>/Article_<slug>.docx
//
// Зависимости: docx, marked (уже есть в package.json).
//
// Использование:
//   node .claude/scripts/build-article-docx.mjs <article_dir>

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { marked } from "marked";
import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, BorderStyle, WidthType, ShadingType, ImageRun, ExternalHyperlink,
  HeadingLevel,
} from "docx";

const articleDirArg = process.argv[2];
if (!articleDirArg) {
  console.error("[build-article-docx] usage: node build-article-docx.mjs <article_dir>");
  process.exit(1);
}
const articleDir = resolve(articleDirArg);
const projectRoot = resolve(articleDir, "..", "..");

const articleMdPath = join(articleDir, "article.md");
const reportPath = join(articleDir, "report.md");
const metaPath = join(articleDir, "meta.json");
const photosUrlsPath = join(articleDir, "photos", "urls.json");
const photosPromptsPath = join(articleDir, "photos", "prompts.md");
const faqPath = join(articleDir, "faq.html");
const clientPath = join(projectRoot, "ЗАКАЗЧИК.md");

function readIfExists(path) {
  return existsSync(path) ? readFileSync(path, "utf8").replace(/^﻿/, "") : "";
}
function readRequired(path) {
  if (!existsSync(path)) {
    console.error(`[build-article-docx] not found: ${path}`);
    process.exit(1);
  }
  return readFileSync(path, "utf8").replace(/^﻿/, "");
}

const articleMd = readRequired(articleMdPath);
const reportMd = readIfExists(reportPath);
const metaRaw = readIfExists(metaPath);
const photosUrlsRaw = readIfExists(photosUrlsPath);
const photosPromptsRaw = readIfExists(photosPromptsPath);
const faqHtml = readIfExists(faqPath);
const clientMd = readIfExists(clientPath);

const meta = metaRaw ? JSON.parse(metaRaw) : {};
const slug = (meta.slug || "article").replace(/[<>:"/\\|?*\x00-\x1f]/g, "_");
const outputPath = join(articleDir, `Article_${slug}.docx`);

// ═══ Дизайн-токены ═══
const C = {
  meta_bg: "F2F2F2",
  meta_label_bg: "E0E0E0",
  accent: "1F4E79",
  text: "000000",
  muted: "666666",
  link: "0066CC",
};
const F = {
  family: "Arial",
  size_title: 32,    // 16pt
  size_h2: 26,       // 13pt
  size_h3: 22,       // 11pt
  size_body: 22,     // 11pt
  size_meta: 18,     // 9pt
  size_footer: 16,   // 8pt
};

// ═══ ЗАКАЗЧИК.md helpers ═══
function pickClientField(md, label) {
  const tableRe = new RegExp("\\|\\s*" + label + "\\s*\\|\\s*([^|\\n]+?)\\s*\\|", "i");
  const tm = md.match(tableRe);
  if (tm) {
    const v = tm[1].trim();
    if (v && !/_не заполнено_/i.test(v)) return v;
  }
  return "";
}
const clientDomain = pickClientField(clientMd, "Домен") || "site";
const clientBlogUrl = pickClientField(clientMd, "URL блога") || "/blog/";
const clientAuthor =
  pickClientField(clientMd, "Имя автора") ||
  pickClientField(clientMd, "Имя") ||
  pickClientField(clientMd, "Автор") ||
  "Редакция";
const clientCompany = pickClientField(clientMd, "Название компании") || clientDomain;

// ═══ Метатеги из report.md ═══
function extractMeta(md, label) {
  const re = new RegExp("\\*\\*" + label + ":\\*\\*\\s*([^\\n]+)", "i");
  const m = md.match(re);
  return m ? m[1].trim() : "";
}
const metaTitle = extractMeta(reportMd, "Title");
const metaDescription = extractMeta(reportMd, "Description");
const metaAnnounce = extractMeta(reportMd, "Анонс");

// ═══ Фото ═══
let photosUrls = [];
if (photosUrlsRaw) {
  try {
    photosUrls = JSON.parse(photosUrlsRaw);
  } catch (e) {
    console.warn("[build-article-docx] photos/urls.json invalid JSON, skipping");
  }
}
const photoAltByNumber = {};
if (photosPromptsRaw) {
  const lines = photosPromptsRaw.split(/\r?\n/);
  let cur = null;
  for (const line of lines) {
    const m = line.match(/^##\s*Фото\s*(\d+)/i);
    if (m) {
      cur = Number(m[1]);
      continue;
    }
    if (cur) {
      const a = line.match(/^[-*]\s*\*\*Alt:\*\*\s*(.+)$/i) || line.match(/^[-*]\s*Alt:\s*(.+)$/i);
      if (a) photoAltByNumber[cur] = a[1].trim();
    }
  }
}

// ═══ Скачивание изображений с Cloudinary ═══
async function downloadImage(url) {
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`[build-article-docx] download failed (${res.status}): ${url}`);
      return null;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    return buf;
  } catch (e) {
    console.warn(`[build-article-docx] download error: ${e.message}`);
    return null;
  }
}

const photoBuffers = {};
for (const p of photosUrls) {
  if (!p || !p.url) continue;
  photoBuffers[Number(p.photo)] = await downloadImage(p.url);
}

// ═══ Хелперы docx ═══
const cellMargin = { top: 80, bottom: 80, left: 120, right: 120 };
const border = { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" };
const borders = { top: border, bottom: border, left: border, right: border };

function run(text, opts = {}) {
  return new TextRun({
    text: String(text ?? ""),
    font: F.family,
    size: opts.size ?? F.size_body,
    bold: opts.bold || false,
    italics: opts.italics || false,
    color: opts.color || C.text,
    break: opts.break || 0,
  });
}

function para(children, opts = {}) {
  return new Paragraph({
    spacing: opts.spacing || { before: 80, after: 80 },
    alignment: opts.alignment || AlignmentType.LEFT,
    children: Array.isArray(children) ? children : [children],
  });
}

function heading(text, level) {
  const sizeMap = { 1: F.size_title, 2: F.size_h2, 3: F.size_h3 };
  const headingMap = { 1: HeadingLevel.HEADING_1, 2: HeadingLevel.HEADING_2, 3: HeadingLevel.HEADING_3 };
  return new Paragraph({
    heading: headingMap[level] || HeadingLevel.HEADING_2,
    spacing: { before: 240, after: 120 },
    children: [run(text, { size: sizeMap[level] || F.size_h2, bold: true, color: C.accent })],
  });
}

function metaTableRow(label, value, valueIsBig = false) {
  return new TableRow({
    children: [
      new TableCell({
        borders, margins: cellMargin,
        width: { size: 1800, type: WidthType.DXA },
        shading: { fill: C.meta_label_bg, type: ShadingType.CLEAR },
        children: [new Paragraph({
          children: [run(label, { bold: true, size: F.size_meta })],
        })],
      }),
      new TableCell({
        borders, margins: cellMargin,
        width: { size: 7838, type: WidthType.DXA },
        shading: { fill: C.meta_bg, type: ShadingType.CLEAR },
        children: [new Paragraph({
          children: [run(value || "—", { size: valueIsBig ? F.size_body : F.size_meta })],
        })],
      }),
    ],
  });
}

// ═══ Markdown → docx-paragraphs (через marked.lexer) ═══

// Inline tokens (text, strong, em, link, image) → массив TextRun-ов / ExternalHyperlink-ов
function renderInline(tokens) {
  const out = [];
  for (const t of tokens || []) {
    switch (t.type) {
      case "text":
        out.push(run(t.text || ""));
        break;
      case "strong":
        out.push(...renderInlineWithStyle(t.tokens, { bold: true }));
        break;
      case "em":
        out.push(...renderInlineWithStyle(t.tokens, { italics: true }));
        break;
      case "codespan":
        out.push(run(t.text, { italics: true, color: C.muted }));
        break;
      case "link":
        out.push(new ExternalHyperlink({
          link: t.href,
          children: [new TextRun({
            text: tokenPlain(t.tokens),
            font: F.family,
            size: F.size_body,
            color: C.link,
            underline: { type: "single", color: C.link },
          })],
        }));
        break;
      case "br":
        out.push(run("", { break: 1 }));
        break;
      default:
        if (t.text) out.push(run(t.text));
        else if (t.tokens) out.push(...renderInline(t.tokens));
    }
  }
  return out;
}

function renderInlineWithStyle(tokens, style) {
  const out = [];
  for (const t of tokens || []) {
    if (t.type === "text") out.push(run(t.text, style));
    else if (t.tokens) out.push(...renderInlineWithStyle(t.tokens, style));
    else if (t.text) out.push(run(t.text, style));
  }
  return out;
}

function tokenPlain(tokens) {
  let s = "";
  for (const t of tokens || []) {
    if (t.text) s += t.text;
    else if (t.tokens) s += tokenPlain(t.tokens);
  }
  return s;
}

// Метки [ФОТО: ...] → ImageRun
function photoImageRun(n) {
  const buf = photoBuffers[n];
  const alt = photoAltByNumber[n] || `Фото ${n}`;
  if (!buf) {
    return para([run(`[Фото ${n}: ${alt} — не загрузилось]`, { italics: true, color: C.muted })]);
  }
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 200, after: 200 },
    children: [new ImageRun({
      data: buf,
      transformation: { width: 600, height: 338 },
      altText: { title: alt, description: alt, name: `photo_${n}` },
    })],
  });
}

// Markdown текст с метками → массив docx-элементов
function renderMarkdownToDocx(md) {
  const tokens = marked.lexer(md);
  const out = [];

  for (const t of tokens) {
    switch (t.type) {
      case "heading":
        out.push(heading(t.text, t.depth === 1 ? 1 : t.depth === 2 ? 2 : 3));
        break;

      case "paragraph": {
        // Ищем в тексте метки [ФОТО:N], [ТАБЛИЦА:...], [ЦИТАТА], [ИКОНКИ:...], [ТАБЫ:...]
        // и разрезаем абзац на куски.
        const text = t.text || "";
        const photoMatch = text.match(/^\[ФОТО:\s*([^\]]+)\]\s*$/);
        if (photoMatch) {
          // Идём дальше — нужен номер по очерёдности появления.
          // Считаем фото-метки в исходном md до этой позиции (грубо).
          const upto = md.indexOf(text) === -1 ? "" : md.slice(0, md.indexOf(text));
          const n = (upto.match(/\[ФОТО:/g) || []).length + 1;
          out.push(photoImageRun(n));
          break;
        }
        // Если в тексте есть inline метка фото — пока выводим в текст с пометкой
        const inlineRuns = renderInline(t.tokens);
        out.push(para(inlineRuns));
        break;
      }

      case "blockquote":
        for (const sub of t.tokens) {
          if (sub.type === "paragraph") {
            out.push(new Paragraph({
              spacing: { before: 120, after: 120 },
              indent: { left: 400 },
              children: renderInline(sub.tokens).map((r) =>
                r instanceof TextRun
                  ? new TextRun({ ...r, italics: true, color: C.muted })
                  : r
              ),
            }));
          }
        }
        break;

      case "list":
        for (const item of t.items) {
          out.push(new Paragraph({
            bullet: { level: 0 },
            spacing: { before: 40, after: 40 },
            children: renderInline(item.tokens?.find((x) => x.type === "text")?.tokens || item.tokens || [{ type: "text", text: item.text }]),
          }));
        }
        break;

      case "table": {
        const colCount = t.header?.length || 1;
        const colWidth = Math.floor(9638 / colCount);
        const headerRow = new TableRow({
          tableHeader: true,
          children: t.header.map((cell) => new TableCell({
            borders, margins: cellMargin,
            width: { size: colWidth, type: WidthType.DXA },
            shading: { fill: C.meta_label_bg, type: ShadingType.CLEAR },
            children: [para(run(cell.text || "", { bold: true, size: F.size_meta }))],
          })),
        });
        const dataRows = (t.rows || []).map((row, i) =>
          new TableRow({
            children: row.map((cell) => new TableCell({
              borders, margins: cellMargin,
              width: { size: colWidth, type: WidthType.DXA },
              shading: { fill: i % 2 ? C.meta_bg : "FFFFFF", type: ShadingType.CLEAR },
              children: [para(run(cell.text || "", { size: F.size_meta }))],
            })),
          })
        );
        out.push(new Table({
          rows: [headerRow, ...dataRows],
          width: { size: 9638, type: WidthType.DXA },
        }));
        out.push(para(run("")));
        break;
      }

      case "space":
        // ignore
        break;

      case "hr":
        out.push(new Paragraph({
          children: [run("───")],
          alignment: AlignmentType.CENTER,
          spacing: { before: 120, after: 120 },
        }));
        break;

      default:
        if (t.text) out.push(para(run(t.text)));
    }
  }

  return out;
}

// ═══ FAQ из faq.html (грубый парсинг <details><summary>?</summary><...>!</...>) ═══
function parseFaq(html) {
  if (!html) return [];
  const items = [];
  const re = /<details[^>]*>\s*<summary[^>]*>([\s\S]*?)<\/summary>\s*([\s\S]*?)<\/details>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const q = stripTags(m[1]).trim();
    const a = stripTags(m[2]).trim();
    if (q && a) items.push({ q, a });
  }
  return items;
}
function stripTags(s) {
  return String(s).replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

// ═══ Сборка документа ═══
const docChildren = [];

// 1. Шапка с метатегами
docChildren.push(new Paragraph({
  alignment: AlignmentType.LEFT,
  spacing: { before: 0, after: 120 },
  children: [run("Метатеги для публикации", { bold: true, color: C.muted, size: F.size_meta })],
}));
docChildren.push(new Table({
  width: { size: 9638, type: WidthType.DXA },
  rows: [
    metaTableRow("Title", metaTitle),
    metaTableRow("Description", metaDescription),
    metaTableRow("Анонс", metaAnnounce),
    metaTableRow("URL", `https://${clientDomain}${clientBlogUrl.startsWith("/") ? "" : "/"}${clientBlogUrl}${slug}/`),
    metaTableRow("H1", extractH1(articleMd) || meta.topic || ""),
    metaTableRow("Хлебные крошки", `Главная / Блог / ${meta.topic || ""}`),
  ],
}));
docChildren.push(para(run(""), { spacing: { before: 240, after: 240 } }));

// 2. Body: H1 + всё остальное из article.md
docChildren.push(...renderMarkdownToDocx(articleMd));

// 3. FAQ
const faqItems = parseFaq(faqHtml);
if (faqItems.length) {
  docChildren.push(heading("Частые вопросы", 2));
  for (const item of faqItems) {
    docChildren.push(para(run(item.q, { bold: true })));
    docChildren.push(para(run(item.a)));
  }
}

// 4. Автор
docChildren.push(para(run("")));
docChildren.push(para([
  run("Автор: ", { bold: true, color: C.muted }),
  run(clientAuthor, { color: C.muted }),
]));

// ═══ Документ ═══
const doc = new Document({
  creator: clientCompany,
  title: metaTitle || meta.topic || "Article",
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
        margin: { top: 1135, bottom: 1135, left: 1135, right: 1135 },
      },
    },
    children: docChildren,
  }],
});

const buffer = await Packer.toBuffer(doc);
writeFileSync(outputPath, buffer);
console.log(`[build-article-docx] wrote ${outputPath}`);
console.log(`  Photos embedded: ${Object.values(photoBuffers).filter(Boolean).length}/${photosUrls.length}`);
console.log(`  FAQ items: ${faqItems.length}`);

// ═══ helpers ═══
function extractH1(md) {
  const m = md.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : "";
}
