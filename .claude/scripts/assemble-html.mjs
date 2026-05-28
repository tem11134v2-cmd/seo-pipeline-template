#!/usr/bin/env node
// assemble-html.mjs
// Собирает финальный output.html: article.md + enhancements.html + faq.html + schema.json + photos/urls.json,
// и подставляет в template.html.
//
// Стратегия (v2 после roadmap 2026-05-28):
//   1. Markdown → HTML через marked. Метки [ТАБЛИЦА:], [ФОТО:] и т.п. заменяются на
//      HTML-комментарии ВИДА <!--NX:photo:1-->. Это инлайн-маркеры, которые marked
//      не трактует как ничего особого, они проходят насквозь.
//   2. После marked-парсинга — повторно идём по комментариям-маркерам и подставляем
//      HTML-блоки (enhancement / <img>).
//   3. Template.html парсим через jsdom. Находим существующий контейнер <div class="nx-article">
//      (с любым числом дочерних узлов — это demo-контент из TEMPLATE-MASTER.html).
//      Подменяем его innerHTML на:
//        - наши breadcrumbs
//        - h1
//        - toc (по нашим h2)
//        - article-body
//        - tags (плитка из report.md)
//        - faq.html
//        - author-block
//      Так обёрточные классы (.nx-article и т.п.) сохраняются, а demo-заглушка из шаблона
//      полностью замещается.
//   4. Schema.org JSON-LD вставляется в <head>.
//
// Зависимости: marked, jsdom.
//
// Использование:
//   node .claude/scripts/assemble-html.mjs <article_dir>

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
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

// --- 1. photos/urls.json + alt из prompts.md ---
let photosUrls = [];
if (photosUrlsRaw) {
  try {
    photosUrls = JSON.parse(photosUrlsRaw);
  } catch (e) {
    console.warn("[assemble-html] photos/urls.json invalid JSON, skipping photos");
  }
}
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

// --- 2. enhancements.html: блоки между маркерами «Элемент N» ---
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

// --- 3. ЗАКАЗЧИК.md: домен, URL блога, имя автора ---
function pickClientField(md, label) {
  const tableRe = new RegExp("\\|\\s*" + label + "\\s*\\|\\s*([^|\\n]+?)\\s*\\|", "i");
  const tm = md.match(tableRe);
  if (tm) {
    const v = tm[1].trim();
    if (v && !/_не заполнено_/i.test(v)) return v;
  }
  const bulletRe = new RegExp("(?:^|\\n)[\\-\\*]\\s*\\*\\*?" + label + "\\*\\*?\\s*:?\\s*([^\\n]+)", "i");
  const bm = md.match(bulletRe);
  return bm ? bm[1].trim() : "";
}
const clientBlogUrl = pickClientField(clientMd, "URL блога") || "/blog/";
const clientAuthor =
  pickClientField(clientMd, "Имя автора") ||
  pickClientField(clientMd, "Имя") ||
  pickClientField(clientMd, "Автор") ||
  "Редакция";

// --- 4. Markdown → HTML: метки → HTML-комментарии-маркеры ---
// HTML-комменты marked не интерпретирует как markdown, они проходят насквозь.
const tagCounter = { table: 0, photo: 0, diagram: 0, quote: 0, icons: 0, tabs: 0 };
const markerInfo = new Map(); // key → { kind, raw, n }

function makeMarker(kind, raw, n) {
  const key = `<!--NX:${kind}:${n}-->`;
  markerInfo.set(key, { kind, raw, n });
  return key;
}

let mdProcessed = articleMd
  .replace(/\[ТАБЛИЦА:\s*([^\]]+)\]/g, (_m, desc) => makeMarker("table", desc.trim(), ++tagCounter.table))
  .replace(/\[ДИАГРАММА(?::\s*([^\]]+))?\]/g, (_m, desc = "") => makeMarker("diagram", desc.trim(), ++tagCounter.diagram))
  .replace(/\[ЦИТАТА(?::\s*([^\]]+))?\]/g, (_m, desc = "") => makeMarker("quote", desc.trim(), ++tagCounter.quote))
  .replace(/\[ИКОНКИ:\s*([^\]]+)\]/g, (_m, desc) => makeMarker("icons", desc.trim(), ++tagCounter.icons))
  .replace(/\[ТАБЫ:\s*([^\]]+)\]/g, (_m, desc) => makeMarker("tabs", desc.trim(), ++tagCounter.tabs))
  .replace(/\[ФОТО:\s*([^\]]+)\]/g, (_m, desc) => makeMarker("photo", desc.trim(), ++tagCounter.photo));

const articleHtmlRaw = marked.parse(mdProcessed);

// --- 5. Подстановка элементов вместо маркеров ---
let enhancementCursor = 0;
function nextEnhancement() {
  return enhancementCursor < enhancementBlocks.length ? enhancementBlocks[enhancementCursor++] : null;
}

let articleHtml = articleHtmlRaw;
// Замены идут по ВСЕМ маркерам, но порядок гарантирован порядком appearance в исходнике
// (marked сохраняет порядок токенов).
for (const [key, info] of markerInfo) {
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
  // marked мог обернуть наш HTML-коммент в <p>...</p> (если он на отдельной строке).
  // Заменяем и сам коммент, и его обёртку.
  const wrappedRe = new RegExp(`<p>\\s*${escapeReg(key)}\\s*</p>`, "g");
  articleHtml = articleHtml.replace(wrappedRe, replacement);
  articleHtml = articleHtml.replace(key, replacement);
}

// --- 6. Извлекаем H1 и проставляем id у H2 (для якорей) ---
const fragDom = new JSDOM(`<!DOCTYPE html><html><body><div id="root">${articleHtml}</div></body></html>`);
const fragRoot = fragDom.window.document.getElementById("root");
const h1El = fragRoot.querySelector("h1");
const h1Text = h1El ? h1El.textContent.trim() : "";
if (h1El) h1El.remove();

const h2List = Array.from(fragRoot.querySelectorAll("h2"));
h2List.forEach((h, i) => {
  if (!h.id) h.id = slugify(h.textContent, `section-${i + 1}`);
});

const tocItems = h2List
  .map((h) => `<li><a href="#${h.id}">${escapeHtml(h.textContent.trim())}</a></li>`)
  .join("\n");
const tocHtml = h2List.length
  ? `<div class="nx-toc open" id="nx-toc"><button class="nx-toc-toggle" type="button" onclick="document.getElementById('nx-toc').classList.toggle('open')">Содержание статьи <span class="nx-toc-arrow">▼</span></button><div class="nx-toc-list"><ol>${tocItems}</ol></div></div>`
  : "";

const breadcrumbsHtml = `<nav class="nx-breadcrumbs"><a href="/">Главная</a> <span>›</span> <a href="${escapeAttr(clientBlogUrl)}">Блог</a> <span>›</span> ${escapeHtml(h1Text)}</nav>`;

// --- 7. Плитка тегов из report.md ---
const tagsHtml = buildTagsBlock(reportMd, clientMd);

// --- 8. Автор ---
const authorBlock = `<div class="nx-author"><div class="nx-author-info"><div class="nx-author-name">${escapeHtml(clientAuthor)}</div></div></div>`;

// --- 9. Schema.org JSON-LD ---
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

// --- 10. Сборка innerHTML для .nx-article + подмена в template ---
const articleBodyHtml = fragRoot.innerHTML;
const innerParts = [
  breadcrumbsHtml,
  h1Text ? `<h1>${escapeHtml(h1Text)}</h1>` : "",
  tocHtml,
  articleBodyHtml,
  tagsHtml,
  faqHtml,
  authorBlock,
].filter(Boolean);

// Парсим template.html и заменяем содержимое первого .nx-article
const tDom = new JSDOM(templateHtml);
const tDoc = tDom.window.document;
const nxArticle = tDoc.querySelector(".nx-article");
if (nxArticle) {
  nxArticle.innerHTML = "\n" + innerParts.join("\n") + "\n";
} else {
  // Fallback: ищем маркер <!-- CONTENT ... --> любого вида и вставляем после него
  const html = tDom.serialize();
  const contentMarkerRe = /<!--\s*CONTENT[\s\S]*?-->/i;
  if (contentMarkerRe.test(html)) {
    const replaced = html.replace(contentMarkerRe, (match) => match + "\n" + innerParts.join("\n"));
    writeFileSync(outputPath, injectSchema(replaced, schemaScripts), "utf8");
    reportSummary();
    process.exit(0);
  } else {
    console.warn("[assemble-html] в template.html нет .nx-article и нет маркера CONTENT, добавлю в конец <body>");
    tDoc.body.insertAdjacentHTML("beforeend", innerParts.join("\n"));
  }
}

// Inject Schema.org в <head>
let finalHtml = tDom.serialize();
finalHtml = injectSchema(finalHtml, schemaScripts);

writeFileSync(outputPath, finalHtml, "utf8");
reportSummary();

// --- helpers ---

function injectSchema(html, scripts) {
  if (!scripts) return html;
  return html.replace(/<\/head>/i, `${scripts}</head>`);
}

function reportSummary() {
  console.log(`[assemble-html] wrote ${outputPath}`);
  console.log(`  H2 sections: ${h2List.length}`);
  console.log(`  Enhancements used: ${enhancementCursor}/${enhancementBlocks.length}`);
  console.log(`  Photos used: ${photosUrls.length}`);
  console.log(`  Markers replaced: ${markerInfo.size}`);
}

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

function escapeReg(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildTagsBlock(reportMd, clientMd) {
  if (!reportMd) return "";
  const re = /Плитка\s*тегов[^]*?(?=\n##|\n#|$)/i;
  const m = reportMd.match(re);
  if (!m) return "";
  const block = m[0];
  const itemRe = /[«"]([^»"\n]+)[»"]/g;
  const phrases = [];
  let mm;
  while ((mm = itemRe.exec(block)) !== null) phrases.push(mm[1].trim());

  if (phrases.length === 0) return "";

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

  const tags = phrases
    .slice(0, 15)
    .map((phrase) => {
      const match = linkRows.find((r) => r.anchor && phrase.toLowerCase().includes(r.anchor.toLowerCase()));
      const url = match ? match.url : linkRows[0]?.url || "/";
      return `<a href="${escapeAttr(url)}" class="nx-tag">${escapeHtml(phrase)}</a>`;
    })
    .join("\n");

  return `<div class="nx-tags"><h3>Похожие темы</h3>${tags}</div>`;
}
