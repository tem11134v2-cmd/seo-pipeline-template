#!/usr/bin/env node
// verify-fast-style.mjs
// Механическая (без LLM) проверка ТЕЛА статьи режима --fast на два самых
// жёстких запрета проекта: буква ё и длинное/среднее тире.
//
// Зачем отдельно от verify-article-metatags.mjs: тот скрипт проверяет только
// поля metatags.json (h1/title/description/announce). normYoFinal() в
// assemble-html.mjs чинит ё->е в ФИНАЛЬНОМ HTML, но не трогает сам article.md -
// а в fast-режиме article.md является самостоятельным deliverable (docx не
// собирается), поэтому его нужно проверять до сборки, не полагаясь на
// safety-net сборщика.
//
// Использование:
//   node .claude/scripts/verify-fast-style.mjs <article_dir>
//
// Exit codes:
//   0 - нарушений нет
//   2 - найдена ё/Ё или тире —/– (детали в stderr, до ~30 строк)
//   1 - ошибка ввода (нет article.md)

import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const MAX_PRINTED = 30;

const articleDirArg = process.argv[2];
if (!articleDirArg) {
  console.error("[verify-fast-style] usage: node verify-fast-style.mjs <article_dir>");
  process.exit(1);
}
const articleDir = resolve(articleDirArg);
const articleMdPath = join(articleDir, "article.md");

if (!existsSync(articleMdPath)) {
  console.error(`[verify-fast-style] article.md не найден: ${articleMdPath}`);
  process.exit(1);
}

const text = readFileSync(articleMdPath, "utf8").replace(/^﻿/, "");
const lines = text.split(/\r?\n/);

const YO_RE = /[ёЁ]/;
const DASH_RE = /[—–]/;

const offenders = [];
lines.forEach((line, i) => {
  const hasYo = YO_RE.test(line);
  const hasDash = DASH_RE.test(line);
  if (hasYo || hasDash) {
    const marks = [hasYo ? "ё" : null, hasDash ? "тире" : null].filter(Boolean).join("+");
    offenders.push(`  строка ${i + 1} [${marks}]: ${line.trim().slice(0, 120)}`);
  }
});

if (offenders.length) {
  console.error(`[verify-fast-style] НАРУШЕНИЯ (${offenders.length} строк с ё и/или тире):`);
  for (const o of offenders.slice(0, MAX_PRINTED)) console.error(o);
  if (offenders.length > MAX_PRINTED) {
    console.error(`  ... и ещё ${offenders.length - MAX_PRINTED} строк`);
  }
  console.error("\nЗамени: ё -> е (везде), — и – -> - (дефис). Перепиши article.md.");
  process.exit(2);
}

console.log("[verify-fast-style] OK: ё и длинное/среднее тире не найдены в article.md.");
process.exit(0);
