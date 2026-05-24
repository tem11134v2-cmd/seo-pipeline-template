#!/usr/bin/env node
// tilda-split.mjs
// Разделяет output.html на два блока для Тильды:
//   tilda/head.html — стили + Schema.org + Тильда-фиксы
//   tilda/t123.html — содержимое <body> без обёрток
//
// Зависимость: jsdom
//
// Использование:
//   node .claude/scripts/tilda-split.mjs <article_dir>

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { JSDOM } from "jsdom";

const articleDirArg = process.argv[2];
if (!articleDirArg) {
  console.error("[tilda-split] usage: node tilda-split.mjs <article_dir>");
  process.exit(1);
}
const articleDir = resolve(articleDirArg);
const inputPath = join(articleDir, "output.html");
const tildaDir = join(articleDir, "tilda");
const headPath = join(tildaDir, "head.html");
const t123Path = join(tildaDir, "t123.html");

if (!existsSync(inputPath)) {
  console.error(`[tilda-split] not found: ${inputPath}`);
  process.exit(1);
}
if (!existsSync(tildaDir)) mkdirSync(tildaDir, { recursive: true });

const html = readFileSync(inputPath, "utf8");
const dom = new JSDOM(html);
const { document } = dom.window;

// --- HEAD ---
// Собираем все <style> и <script type="application/ld+json"> из <head>
const headParts = [];

const styles = document.head.querySelectorAll("style");
for (const styleEl of styles) {
  headParts.push(styleEl.outerHTML);
}

const ldScripts = document.head.querySelectorAll('script[type="application/ld+json"]');
for (const s of ldScripts) {
  headParts.push(s.outerHTML);
}

// Тильда-фиксы — отдельный <style> в конце, чтобы перебить тильдовские стили
const tildaFixes = `
<style>
/* Тильда-фиксы (важность для перебивания дефолтных стилей Тильды) */
#allrecords {
  background: var(--nx-bg) !important;
}
#allrecords .nx-article {
  max-width: 780px;
  margin: 0 auto;
}
.nx-article a {
  color: var(--nx-accent) !important;
  text-decoration: underline !important;
  border-bottom: none !important;
}
.nx-article h1,
.nx-article h2,
.nx-article h3 {
  color: var(--nx-text) !important;
  font-family: var(--nx-font) !important;
}
.nx-article h1 { font-size: 2.2rem !important; margin: 0 0 1rem !important; font-weight: 700 !important; line-height: 1.15 !important; }
.nx-article h2 { font-size: 1.6rem !important; margin: 2rem 0 1rem !important; font-weight: 700 !important; line-height: 1.2 !important; }
.nx-article h3 { font-size: 1.2rem !important; margin: 1.5rem 0 0.75rem !important; font-weight: 600 !important; line-height: 1.3 !important; }
.nx-toc {
  overflow: hidden;
  position: relative;
}
.nx-toc-toggle {
  width: 100% !important;
  max-width: 100% !important;
  box-sizing: border-box !important;
}
</style>
`.trim();
headParts.push(tildaFixes);

writeFileSync(headPath, headParts.join("\n\n"), "utf8");
console.log(`[tilda-split] wrote ${headPath} (${headParts.length} blocks)`);

// --- T123 ---
// Содержимое <body>, без обёрток
const bodyInner = document.body.innerHTML.trim();
writeFileSync(t123Path, bodyInner, "utf8");
console.log(`[tilda-split] wrote ${t123Path} (${bodyInner.length} chars)`);
