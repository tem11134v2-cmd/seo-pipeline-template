#!/usr/bin/env node
// assemble-html.mjs
// Собирает финальный output.html из article.md + enhancements.html + faq.html + schema.json + photos/urls.json
// и подставляет в template.html (плейсхолдер <!-- CONTENT -->).
//
// Зависимости: marked, jsdom (npm install marked jsdom)
//
// Использование:
//   node .claude/scripts/assemble-html.mjs <article_dir>
//
// Где <article_dir> — путь к articles/NNN-slug/ (относительный или абсолютный).
// Корень проекта определяется как parent двух уровней выше (../../).

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { marked } from "marked";
import { JSDOM } from "jsdom";

const articleDirArg = process.argv[2];
if (!articleDirArg) {
  console.error("[assemble-html] usage: node assemble-html.mjs <article_dir>");
  process.exit(1);
}
const articleDir = resolve(articleDirArg);
const projectRoot = resolve(articleDir, "..", "..");

const articleMdPath = join(articleDir, "article.md");
const enhancementsPath = join(articleDir, "enhancements.html");
const faqPath = join(articleDir, "faq.html");
const schemaPath = join(articleDir, "schema.json");
const photosUrlsPath = join(articleDir, "photos", "urls.json");
const photosPromptsPath = join(articleDir, "photos", "prompts.md");
const reportPath = join(articleDir, "report.md");
const templatePath = join(projectRoot, "template.html");
const clientPath = join(projectRoot, "ЗАКАЗЧИК.md");
const outputPath = join(articleDir, "output.html");

function readIfExists(path) {
  return existsSync(path) ? readFileSync(path, "utf8").replace(/^﻿/, "") : "";
}
function readRequired(path) {
  return readFileSync(path, "utf8").replace(/^﻿/, "");
}

const articleMd = readRequired(articleMdPath);
const enhancementsHtml = readIfExists(enhancementsPath);
const faqHtml = readIfExists(faqPath);
const schemaRaw = readIfExists(schemaPath);
const photosUrlsRaw = readIfExists(photosUrlsPath);
const photosPromptsRaw = readIfExists(photosPromptsPath);
const reportMd = readIfExists(reportPath);
const templateHtml = readRequired(templatePath);
const clientMd = readRequired(clientPath);

// --- 1. Парсинг photos/urls.json и photos/prompts.md (для alt-текстов) ---
let photosUrls = [];
if (photosUrlsRaw) {
  try {
    photosUrls = JSON.parse(photosUrlsRaw);
  } catch (e) {
    console.warn("[assemble-html] photos/urls.json invalid JSON, skipping photos");
  }
}

// Парсим alt из prompts.md (грубо, по заголовкам «## Фото N» и строке «- **Alt:** ...»)
const photoAltByNumber = {};
if (photosPromptsRaw) {
  const lines = photosPromptsRaw.split(/\r?\n/);
  let currentPhotoN = null;
  for (const line of lines) {
    const m = line.match(/^##\s*Фото\s*(\d+)/i);
    if (m) {
      currentPhotoN = Number(m[1]);
      continue;
    }
    if (currentPhotoN) {
      const a = line.match(/^[-*]\s*\*\*Alt:\*\*\s*(.+)$/i) || line.match(/^[-*]\s*Alt:\s*(.+)$/i);
      if (a) photoAltByNumber[currentPhotoN] = a[1].trim();
    }
  }
}

// --- 2. Парсинг enhancements.html: блоки между «═══ Элемент N ═══» и «═══════════════════════»
const enhancementBlocks = [];
{
  const re = /<!--\s*═+\s*Элемент\s*(\d+)\s*═+\s*([\s\S]*?)-->\s*([\s\S]*?)<!--\s*═+\s*-->/g;
  let m;
  while ((m = re.exec(enhancementsHtml)) !== null) {
    enhancementBlocks.push({
      n: Number(m[1]),
      meta: m[2].trim(),
      html: m[3].trim(),
    });
  }
}

// --- 3. ЗАКАЗЧИК.md: извлекаем минимум — домен, URL блога, имя автора ---
function pickClientField(md, label) {
  const re = new RegExp("(?:^|\\n)[\\-\\*]\\s*\\*\\*?" + label + "\\*\\*?\\s*:?\\s*([^\\n]+)", "i");
  const m = md.match(re);
  return m ? m[1].trim() : "";
}
const clientDomain = pickClientField(clientMd, "Домен");
const clientBlogUrl = pickClientField(clientMd, "URL блога") || "/blog/";
const clientAuthor = pickClientField(clientMd, "Имя") || pickClientField(clientMd, "Автор") || "Редакция";

// --- 4. Markdown → HTML ---
// Сначала превращаем метки [ТАБЛИЦА: ...], [ФОТО: ...] и т.п. в placeholders,
// чтобы marked не пытался их трактовать.
const tagCounter = { table: 0, photo: 0, diagram: 0, quote: 0, icons: 0, tabs: 0 };
const placeholderMap = new Map();

function makePlaceholder(kind, raw, n) {
  const key = `___NX_PLACEHOLDER_${kind.toUpperCase()}_${n}___`;
  placeholderMap.set(key, { kind, raw, n });
  return key;
}

let mdProcessed = articleMd
  .replace(/\[ТАБЛИЦА:\s*([^\]]+)\]/g, (_m, desc) => makePlaceholder("table", desc, ++tagCounter.table))
  .replace(/\[ДИАГРАММА(?::\s*[^\]]+)?\]/g, (m) => makePlaceholder("diagram", m, ++tagCounter.diagram))
  .replace(/\[ЦИТАТА(?::\s*[^\]]+)?\]/g, (m) => makePlaceholder("quote", m, ++tagCounter.quote))
  .replace(/\[ИКОНКИ:\s*([^\]]+)\]/g, (_m, desc) => makePlaceholder("icons", desc, ++tagCounter.icons))
  .replace(/\[ТАБЫ:\s*([^\]]+)\]/g, (_m, desc) => makePlaceholder("tabs", desc, ++tagCounter.tabs))
  .replace(/\[ФОТО:\s*([^\]]+)\]/g, (_m, desc) => makePlaceholder("photo", desc, ++tagCounter.photo));

const articleHtmlRaw = marked.parse(mdProcessed);

// --- 5. Подстановка элементов ---
// Стратегия: проходим placeholders по порядку.
// Для table/diagram/quote/icons/tabs — берём по очереди из enhancementBlocks (n = сквозной счётчик)
// Для photo — берём из photosUrls по номеру (1-based, по порядку появления).
let enhancementCursor = 0;
function nextEnhancement() {
  if (enhancementCursor < enhancementBlocks.length) {
    return enhancementBlocks[enhancementCursor++];
  }
  return null;
}

let articleHtml = articleHtmlRaw;
for (const [key, info] of placeholderMap) {
  let replacement;
  if (info.kind === "photo") {
    const photo = photosUrls.find((p) => Number(p.photo) === info.n);
    const alt = photoAltByNumber[info.n] || info.raw;
    if (photo && photo.url) {
      replacement = `<figure class="nx-photo"><img src="${photo.url}" alt="${escapeAttr(alt)}" loading="lazy" /></figure>`;
    } else {
      replacement = `<!-- TODO: photo ${info.n} (${escapeAttr(info.raw)}) — нет URL в photos/urls.json -->`;
    }
  } else {
    const enh = nextEnhancement();
    if (enh) {
      replacement = enh.html;
    } else {
      replacement = `<!-- TODO: ${info.kind} «${escapeAttr(info.raw)}» — нет элемента в enhancements.html -->`;
    }
  }
  articleHtml = articleHtml.replace(key, replacement);
}

// --- 6. Извлечь H1 и сгенерировать оглавление + хлебные крошки ---
const articleDom = new JSDOM(`<!DOCTYPE html><html><body><div id="root">${articleHtml}</div></body></html>`);
const articleDocFrag = articleDom.window.document.getElementById("root");
const h1El = articleDocFrag.querySelector("h1");
const h1Text = h1El ? h1El.textContent.trim() : "";
if (h1El) h1El.remove(); // H1 будет в шапке шаблона, не в контенте

const h2List = Array.from(articleDocFrag.querySelectorAll("h2"));
h2List.forEach((h, i) => {
  if (!h.id) h.id = slugify(h.textContent, `section-${i + 1}`);
});

const tocItems = h2List
  .map((h) => `<li><a href="#${h.id}">${escapeHtml(h.textContent.trim())}</a></li>`)
  .join("\n");
const tocHtml = h2List.length
  ? `<nav class="nx-toc"><button class="nx-toc-toggle" type="button" onclick="this.parentElement.classList.toggle('is-collapsed')">Оглавление</button><ol>${tocItems}</ol></nav>`
  : "";

const breadcrumbsHtml = `<nav class="nx-breadcrumbs"><a href="/">Главная</a> / <a href="${escapeAttr(clientBlogUrl)}">Блог</a> / <span>${escapeHtml(h1Text)}</span></nav>`;

// --- 7. Плитка тегов из report.md (раздел «Плитка тегов») ---
const tagsHtml = buildTagsBlock(reportMd, clientMd);

// --- 8. Блок автора из ЗАКАЗЧИК.md ---
const authorBlock = `<aside class="nx-author"><strong>${escapeHtml(clientAuthor)}</strong></aside>`;

// --- 9. Schema.org из schema.json ---
let schemaScripts = "";
if (schemaRaw) {
  try {
    const schemaObj = JSON.parse(schemaRaw);
    for (const key of ["article", "faqPage", "breadcrumbList"]) {
      if (schemaObj[key]) {
        schemaScripts += `<script type="application/ld+json">${JSON.stringify(schemaObj[key])}</script>\n`;
      }
    }
  } catch (e) {
    console.warn("[assemble-html] schema.json invalid:", e.message);
  }
}

// --- 10. Сборка контента и вставка в template.html ---
const contentHtml = [
  breadcrumbsHtml,
  h1Text ? `<h1>${escapeHtml(h1Text)}</h1>` : "",
  tocHtml,
  `<article class="nx-article">${articleDocFrag.innerHTML}</article>`,
  tagsHtml,
  faqHtml,
  authorBlock,
].filter(Boolean).join("\n");

let finalHtml = templateHtml;
if (finalHtml.includes("<!-- CONTENT -->")) {
  finalHtml = finalHtml.replace("<!-- CONTENT -->", contentHtml);
} else {
  console.warn("[assemble-html] template.html не содержит <!-- CONTENT -->, добавлю в конец <body>");
  finalHtml = finalHtml.replace(/<\/body>/i, `${contentHtml}\n</body>`);
}

// Вставка Schema.org в head
if (schemaScripts) {
  finalHtml = finalHtml.replace(/<\/head>/i, `${schemaScripts}</head>`);
}

writeFileSync(outputPath, finalHtml, "utf8");
console.log(`[assemble-html] wrote ${outputPath}`);
console.log(`  H2 sections: ${h2List.length}`);
console.log(`  Enhancements used: ${enhancementCursor}/${enhancementBlocks.length}`);
console.log(`  Photos used: ${photosUrls.length}`);

// --- helpers ---

function slugify(s, fallback = "section") {
  const out = String(s)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return out || fallback;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, "&quot;");
}

function buildTagsBlock(reportMd, clientMd) {
  if (!reportMd) return "";
  // Ищем секцию «Плитка тегов» — пункты вида «- «фраза» — недобор N → анкор, URL ...»
  const re = /Плитка\s*тегов[^]*?(?=\n##|\n#|$)/i;
  const m = reportMd.match(re);
  if (!m) return "";
  const block = m[0];
  const itemRe = /[«"]([^»"\n]+)[»"]/g;
  const phrases = [];
  let mm;
  while ((mm = itemRe.exec(block)) !== null) phrases.push(mm[1].trim());

  if (phrases.length === 0) return "";

  // Простейший подбор URL из ЗАКАЗЧИК.md секции «Перелинковка»:
  // ищем строки таблицы «| /url | анкор | ...» — соответствие тематически.
  const linkRows = [];
  const linkSection = clientMd.match(/##\s*Перелинковка[^]*?(?=\n##|\n#|$)/i);
  if (linkSection) {
    const rows = linkSection[0].split(/\r?\n/);
    for (const row of rows) {
      const cells = row.split("|").map((s) => s.trim()).filter(Boolean);
      if (cells.length >= 2 && /^\/?[\w\-\/]+$/.test(cells[0])) {
        linkRows.push({ url: cells[0], anchor: cells[1] });
      }
    }
  }

  const tags = phrases.slice(0, 15).map((phrase) => {
    const match = linkRows.find((r) => r.anchor && phrase.toLowerCase().includes(r.anchor.toLowerCase()));
    const url = match ? match.url : (linkRows[0]?.url || "/");
    return `<a href="${escapeAttr(url)}" class="nx-tag">${escapeHtml(phrase)}</a>`;
  }).join("\n");

  return `<section class="nx-tags"><h3>Похожие темы</h3>${tags}</section>`;
}
