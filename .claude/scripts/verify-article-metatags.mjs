#!/usr/bin/env node
// verify-article-metatags.mjs
// Механическая проверка метатегов ОДНОЙ статьи (после article-finalizer в /seo-statya).
// Источник истины - <article_dir>/metatags.json {h1, title, description, announce}.
// Backward-compat: если metatags.json нет (старые статьи), парсит раздел «## Метатеги»
// из report.md (список «- **Title:** ...»).
//
// Контракт-аналог verify-markers.mjs: exit 2 => скил пере-делегирует финализатору.
//
// Использование:
//   node .claude/scripts/verify-article-metatags.mjs <article_dir>
//
// Exit codes:
//   0 — метатеги валидны (могут быть мягкие предупреждения)
//   2 — критичные нарушения (детали в stderr) => ретрай финализатора
//   1 — ошибка ввода (нет источника метатегов)

import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const TITLE_MAX = 60;
const DESC_MAX = 160;
const TITLE_MIN = 50; // мягкая граница (warning, не блокирует)
const DESC_MIN = 140; // мягкая граница (warning, не блокирует)

const articleDirArg = process.argv[2];
if (!articleDirArg) {
  console.error("[verify-article-metatags] usage: node verify-article-metatags.mjs <article_dir>");
  process.exit(1);
}
const articleDir = resolve(articleDirArg);
const metatagsPath = join(articleDir, "metatags.json");
const reportPath = join(articleDir, "report.md");
const articleMdPath = join(articleDir, "article.md");

const DASH_RE = /[—–]/;
const YO_RE = /[ёЁ]/;

function norm(s) {
  return String(s || "").toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();
}

// Источник 1: metatags.json
function loadFromJson() {
  if (!existsSync(metatagsPath)) return null;
  try {
    const mt = JSON.parse(readFileSync(metatagsPath, "utf8").replace(/^﻿/, ""));
    return {
      h1: String(mt.h1 || ""),
      title: String(mt.title || ""),
      description: String(mt.description || ""),
      announce: String(mt.announce || ""),
      source: "metatags.json",
    };
  } catch (e) {
    console.error(`[verify-article-metatags] битый JSON ${metatagsPath}: ${e.message}`);
    process.exit(1);
  }
}

// Источник 2 (fallback): раздел «## Метатеги» из report.md
function loadFromReport() {
  if (!existsSync(reportPath)) return null;
  const md = readFileSync(reportPath, "utf8").replace(/^﻿/, "");
  const pick = (label) => {
    const re = new RegExp("\\*\\*" + label + ":\\*\\*\\s*([^\\n]+)", "i");
    const m = md.match(re);
    return m ? m[1].trim() : "";
  };
  const title = pick("Title");
  const description = pick("Description");
  const announce = pick("Анонс");
  if (!title && !description && !announce) return null;
  return {
    h1: pick("H1"),
    title,
    description,
    announce,
    source: "report.md (fallback)",
  };
}

const mt = loadFromJson() || loadFromReport();
if (!mt) {
  console.error(
    `[verify-article-metatags] нет источника метатегов: ни ${metatagsPath}, ни раздела «## Метатеги» в report.md.`
  );
  console.error("Финализатор обязан записать metatags.json (шаг 2b) - перепиши.");
  process.exit(1);
}

const violations = [];
const warnings = [];

const tLen = [...mt.title].length;
const dLen = [...mt.description].length;
const aLen = [...mt.announce].length;

// 1. Непустые поля
if (!mt.title.trim()) violations.push("пустой Title");
if (!mt.description.trim()) violations.push("пустой Description");
if (!mt.announce.trim()) violations.push("пустой Анонс");
// H1 может быть пуст в fallback-источнике (старый report.md без строки H1) - не блокируем,
// но при наличии metatags.json H1 обязателен.
if (!mt.h1.trim() && mt.source === "metatags.json") violations.push("пустой H1 в metatags.json");

// 2. Жёсткие лимиты длины
if (tLen > TITLE_MAX) violations.push(`Title ${tLen} симв. > ${TITLE_MAX} («${mt.title}»)`);
if (dLen > DESC_MAX) violations.push(`Description ${dLen} симв. > ${DESC_MAX}`);

// 3. Длинное/среднее тире
if (DASH_RE.test(mt.h1)) violations.push("длинное/среднее тире в H1");
if (DASH_RE.test(mt.title)) violations.push("длинное/среднее тире в Title");
if (DASH_RE.test(mt.description)) violations.push("длинное/среднее тире в Description");
if (DASH_RE.test(mt.announce)) violations.push("длинное/среднее тире в Анонсе");

// 3б. Буква ё
if (YO_RE.test(mt.h1)) violations.push("буква ё в H1");
if (YO_RE.test(mt.title)) violations.push("буква ё в Title");
if (YO_RE.test(mt.description)) violations.push("буква ё в Description");
if (YO_RE.test(mt.announce)) violations.push("буква ё в Анонсе");

// 4. H1 != Title (не дубль)
if (mt.h1.trim() && mt.title.trim() && norm(mt.h1) === norm(mt.title)) {
  violations.push("H1 дублирует Title (должны различаться)");
}

// 5. Title / Description / Анонс уникальны между собой
if (mt.title.trim() && mt.description.trim() && norm(mt.title) === norm(mt.description)) {
  violations.push("Title дублирует Description");
}
if (mt.title.trim() && mt.announce.trim() && norm(mt.title) === norm(mt.announce)) {
  violations.push("Title дублирует Анонс");
}
if (mt.description.trim() && mt.announce.trim() && norm(mt.description) === norm(mt.announce)) {
  violations.push("Description дублирует Анонс");
}

// 6. H1 совпадает с первой строкой «# » в article.md (только если есть оба)
if (mt.h1.trim() && existsSync(articleMdPath)) {
  const articleMd = readFileSync(articleMdPath, "utf8").replace(/^﻿/, "");
  const m = articleMd.match(/^#\s+(.+)$/m);
  const articleH1 = m ? m[1].trim() : "";
  if (articleH1 && norm(articleH1) !== norm(mt.h1)) {
    violations.push(`H1 в metatags.json («${mt.h1}») не совпадает с H1 в article.md («${articleH1}»)`);
  }
}

// Мягкие предупреждения (не блокируют)
if (mt.title.trim() && tLen < TITLE_MIN) warnings.push(`Title коротковат: ${tLen} симв. (цель ${TITLE_MIN}-${TITLE_MAX})`);
if (mt.description.trim() && dLen < DESC_MIN) warnings.push(`Description коротковат: ${dLen} симв. (цель ${DESC_MIN}-${DESC_MAX})`);
if (aLen > DESC_MAX) warnings.push(`Анонс длинноват: ${aLen} симв.`);

// === Отчёт ===
console.log(`[verify-article-metatags] источник: ${mt.source}`);
console.log(`  Title: ${tLen} симв. | Description: ${dLen} симв. | Анонс: ${aLen} симв.`);

if (warnings.length) {
  console.log(`\nПРЕДУПРЕЖДЕНИЯ (${warnings.length}, не блокируют):`);
  for (const w of warnings) console.log(`  - ${w}`);
}

if (violations.length) {
  console.error(`\n[verify-article-metatags] НАРУШЕНИЯ (${violations.length}):`);
  for (const v of violations) console.error(`  - ${v}`);
  console.error("\nПерепиши метатеги (metatags.json + раздел «## Метатеги» в report.md), сохранив лимиты и уникальность.");
  process.exit(2);
}

console.log(`\n[verify-article-metatags] OK: метатеги валидны.`);
process.exit(0);
