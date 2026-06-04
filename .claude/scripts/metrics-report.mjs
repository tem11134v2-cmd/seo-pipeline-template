#!/usr/bin/env node
// metrics-report.mjs
// Считает метрики готовой статьи и дописывает блок «Метрики» в report.md.
// Используется в /seo-statya после сборки HTML (или может вызываться вручную).
//
// Использование:
//   node .claude/scripts/metrics-report.mjs <article_dir>
//
// Вход:
//   <article_dir>/article.md      — основной текст
//   <article_dir>/faq.html        — FAQ (опционально)
//   <article_dir>/meta.json       — для main_query
//   <article_dir>/photos/urls.json
//
// Выход:
//   В <article_dir>/report.md добавляется (или обновляется) раздел `## Метрики`.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const articleDirArg = process.argv[2];
if (!articleDirArg) {
  console.error("[metrics-report] usage: node metrics-report.mjs <article_dir>");
  process.exit(1);
}
const articleDir = resolve(articleDirArg);

const articleMdPath = join(articleDir, "article.md");
const faqPath = join(articleDir, "faq.html");
const reportPath = join(articleDir, "report.md");
const metaPath = join(articleDir, "meta.json");
const photosUrlsPath = join(articleDir, "photos", "urls.json");
const photosPromptsPath = join(articleDir, "photos", "prompts.md");

if (!existsSync(articleMdPath)) {
  console.error(`[metrics-report] не найден ${articleMdPath}`);
  process.exit(1);
}

const articleMd = readFileSync(articleMdPath, "utf8").replace(/^﻿/, "");
const faqHtml = existsSync(faqPath) ? readFileSync(faqPath, "utf8").replace(/^﻿/, "") : "";
const meta = existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, "utf8").replace(/^﻿/, "")) : {};
const photosUrlsRaw = existsSync(photosUrlsPath) ? readFileSync(photosUrlsPath, "utf8").replace(/^﻿/, "") : "[]";
const photosPromptsRaw = existsSync(photosPromptsPath) ? readFileSync(photosPromptsPath, "utf8").replace(/^﻿/, "") : "";

const mainQuery = (meta.query || meta.main_query || "").toLowerCase();

// --- 1. Базовые цифры ---
function wordCount(text) {
  return (text.match(/\S+/g) || []).length;
}

// Удалить метки и markdown-разметку для подсчёта чистых слов
function clean(text) {
  return text
    .replace(/\[(?:ТАБЛИЦА|ФОТО|ДИАГРАММА|ЦИТАТА|ИКОНКИ|ТАБЫ)(?::[^\]]+)?\]/g, "")
    .replace(/[#*_`>\-]+/g, " ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\|/g, " ");
}

const bodyWords = wordCount(clean(articleMd));
const faqWords = wordCount(stripHtml(faqHtml));
const totalWords = bodyWords + faqWords;

// --- 2. Структура ---
const h2Count = (articleMd.match(/^##\s+/gm) || []).length;
const h3Count = (articleMd.match(/^###\s+/gm) || []).length;

// --- 3. Ссылки ---
const linkRe = /\[([^\]]+)\]\((\S+?)\)/g;
const allLinks = [];
let m;
while ((m = linkRe.exec(articleMd)) !== null) {
  allLinks.push({ anchor: m[1], url: m[2] });
}
const uniqueUrls = new Set(allLinks.map((l) => l.url));

// --- 4. Частоты главного запроса ---
let mainQueryHits = 0;
let mainQueryRoot = "";
if (mainQuery) {
  // Главное слово запроса — самое длинное слово (для грубой оценки употребления через корень)
  const queryWords = mainQuery.split(/\s+/).filter((w) => w.length >= 4);
  mainQueryRoot = queryWords.sort((a, b) => b.length - a.length)[0] || mainQuery;
  const root = mainQueryRoot.slice(0, Math.min(mainQueryRoot.length, 6));
  const re = new RegExp(escapeReg(root), "gi");
  mainQueryHits = (clean(articleMd).match(re) || []).length;
}

// --- 5. Фото ---
let photosUrls = [];
try { photosUrls = JSON.parse(photosUrlsRaw); } catch {}
const photosWithUrl = photosUrls.filter((p) => p && p.url).length;
const photosTodo = photosUrls.filter((p) => p && p.todo).length;
const photoPromtCount = (photosPromptsRaw.match(/^##\s*Фото\s*\d+/gim) || []).length;

// alt-coverage: считаем число alt-текстов в prompts.md
const altCount = (photosPromptsRaw.match(/^[-*]\s*\*\*Alt:/gim) || []).length;
const altCoverage = photoPromtCount > 0 ? Math.round((altCount / photoPromtCount) * 100) : 0;

// --- 6. Читаемость (упрощённый Flesch для русского) ---
// Используем эвристику: среднее слов в предложении + средние слоги в слове.
// Это не каноническая формула, но даёт сопоставимое число.
function readabilityScore(text) {
  const clean1 = clean(text);
  const sentences = clean1.split(/[.!?]+/).filter((s) => s.trim().length > 0);
  const words = (clean1.match(/[А-Яа-яA-Za-z]+/g) || []);
  if (sentences.length === 0 || words.length === 0) return 0;
  const avgSentenceLen = words.length / sentences.length;
  // Считаем слоги по гласным (упрощённо)
  const totalSyllables = words.reduce((sum, w) => sum + (w.match(/[аеёиоуыэюяАЕЁИОУЫЭЮЯaeiouAEIOU]/g) || []).length, 0);
  const avgSyllables = totalSyllables / words.length;
  // Адаптация формулы Flesch для русского (грубо)
  const score = 206.835 - 1.3 * avgSentenceLen - 60.1 * avgSyllables;
  return Math.round(score);
}
const fleschScore = readabilityScore(articleMd);
const fleschBand =
  fleschScore >= 70 ? "лёгкий" :
  fleschScore >= 50 ? "средний" :
  fleschScore >= 30 ? "сложный" : "очень сложный";

// --- 7. Сборка markdown-блока ---
const block = `## Метрики

| Метрика | Значение |
|---------|----------|
| Слов в body | ${bodyWords} |
| Слов в FAQ | ${faqWords} |
| Всего слов | ${totalWords} |
| H2 разделов | ${h2Count} |
| H3 подразделов | ${h3Count} |
| Inline-ссылок (всего) | ${allLinks.length} |
| Уникальных URL | ${uniqueUrls.size} |
| Главный запрос «${mainQuery}» — вхождений корня «${mainQueryRoot}» | ${mainQueryHits} |
| Фото запланировано | ${photoPromtCount} |
| Фото с URL | ${photosWithUrl} |
| Фото TODO | ${photosTodo} |
| Alt-coverage | ${altCoverage}% |
| Читаемость (Flesch-RU) | ${fleschScore} (${fleschBand}) |
`;

// --- 8. Запись в report.md ---
let report = existsSync(reportPath) ? readFileSync(reportPath, "utf8").replace(/^﻿/, "") : "# Отчёт\n";
if (/##\s*Метрики/.test(report)) {
  // Заменить существующий блок
  report = report.replace(/##\s*Метрики[\s\S]*?(?=\n##|\n#|$)/, block);
} else {
  // Добавить в конец
  if (!report.endsWith("\n")) report += "\n";
  report += "\n" + block + "\n";
}
writeFileSync(reportPath, report, "utf8");

console.log("[metrics-report] записано в report.md:");
console.log(`  body: ${bodyWords} | FAQ: ${faqWords} | total: ${totalWords}`);
console.log(`  H2: ${h2Count} | H3: ${h3Count} | links: ${allLinks.length} (uniq ${uniqueUrls.size})`);
console.log(`  Flesch-RU: ${fleschScore} (${fleschBand})`);

// helpers
function escapeReg(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripHtml(html) {
  return String(html).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
