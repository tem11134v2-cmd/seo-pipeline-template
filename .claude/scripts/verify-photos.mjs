#!/usr/bin/env node
// verify-photos.mjs
// Кросс-чек согласованности фото между тремя источниками (баг #5):
//   1. число меток [ФОТО: ...] в article.md   (источник истины по местам в тексте)
//   2. число блоков "## Фото N" в photos/prompts.md (что сгенерировал photo-promter)
//   3. число записей в photos/urls.json        (что реально опубликовано в Cloudinary)
//
// article.md — источник истины. prompts.md и urls.json обязаны иметь ровно столько же
// слотов, сколько меток в article.md. Рассинхрон ломает сборку (assemble-html /
// build-article-docx сопоставляют по номеру) — лучше поймать здесь.
//
// Использование:
//   node .claude/scripts/verify-photos.mjs <article_dir>
//
// Exit codes:
//   0 — согласовано (или urls.json ещё нет — проверяем только article.md vs prompts.md)
//   2 — рассинхрон
//   1 — ошибка ввода (нет article.md или prompts.md)

import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const articleDirArg = process.argv[2];
if (!articleDirArg) {
  console.error("[verify-photos] usage: node verify-photos.mjs <article_dir>");
  process.exit(1);
}
const articleDir = resolve(articleDirArg);
const articleMdPath = join(articleDir, "article.md");
const promptsPath = join(articleDir, "photos", "prompts.md");
const urlsPath = join(articleDir, "photos", "urls.json");

function readClean(path) {
  return readFileSync(path, "utf8").replace(/^﻿/, "");
}

if (!existsSync(articleMdPath)) {
  console.error(`[verify-photos] нет файла: ${articleMdPath}`);
  process.exit(1);
}
if (!existsSync(promptsPath)) {
  console.error(`[verify-photos] нет файла: ${promptsPath} (сначала отработает photo-promter)`);
  process.exit(1);
}

const articleMd = readClean(articleMdPath);
const promptsMd = readClean(promptsPath);

const markerCount = (articleMd.match(/\[ФОТО:\s*[^\]]+\]/g) || []).length;
const promptCount = (promptsMd.match(/^##\s*Фото\s*\d+/gim) || []).length;

const problems = [];
if (markerCount !== promptCount) {
  problems.push(`меток [ФОТО:] в article.md = ${markerCount}, блоков «## Фото N» в prompts.md = ${promptCount}`);
}

let urlCount = null;
if (existsSync(urlsPath)) {
  try {
    const arr = JSON.parse(readClean(urlsPath));
    if (Array.isArray(arr)) {
      urlCount = arr.length;
      if (urlCount !== markerCount) {
        problems.push(`меток [ФОТО:] в article.md = ${markerCount}, записей в urls.json = ${urlCount}`);
      }
      const noUrl = arr.filter((p) => p && !p.url).length;
      if (noUrl > 0) {
        // Не блокируем (это пометка о неудачной генерации), но предупреждаем.
        console.error(`[verify-photos] ℹ ${noUrl} из ${urlCount} записей urls.json без url (todo/неудачная генерация).`);
      }
    } else {
      problems.push("urls.json не является массивом");
    }
  } catch (e) {
    problems.push(`urls.json не парсится: ${e.message}`);
  }
}

if (problems.length) {
  console.error("[verify-photos] рассинхрон фото:");
  for (const p of problems) console.error(`  - ${p}`);
  console.error("");
  console.error("Источник истины — метки [ФОТО:] в article.md. Перегенерируй photo-promter");
  console.error("(он читает article.md) и/или пересобери urls.json под актуальные метки.");
  process.exit(2);
}

const tail = urlCount === null ? " (urls.json ещё нет — проверены только article.md и prompts.md)" : `, urls.json=${urlCount}`;
console.log(`[verify-photos] OK: ${markerCount} меток [ФОТО:], prompts.md=${promptCount}${tail}`);
process.exit(0);
