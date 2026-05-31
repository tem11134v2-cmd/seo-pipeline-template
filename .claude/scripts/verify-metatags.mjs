#!/usr/bin/env node
// verify-metatags.mjs
// Механическая проверка сгенерированных метатегов (Фаза 4 /seo-metatags).
// Заменяет hook: на параллельном веере writer'ов hook с маркером одного файла
// давал бы ложные отказы (см. ADR-011 п.3). Скрипт проверяет всю пачку РАЗОМ
// после завершения writer'ов и говорит скилу, какие страницы недоделаны.
//
// Использование:
//   node .claude/scripts/verify-metatags.mjs <metatags_dir>
//
// Вход:
//   <metatags_dir>/pages.json        - канонический список целевых страниц
//   <metatags_dir>/pages/<n>.json    - результат writer'а на страницу
//   <metatags_dir>/inputs.json       - forbidden_phrasings[] (опц.)
// Выход (stdout):
//   построчный отчёт: missing pages + violations
//
// Exit:
//   0 - все страницы есть и без критичных нарушений
//   2 - есть отсутствующие страницы ИЛИ критичные нарушения (скил пере-делегирует/поправит)
//   1 - ошибка запуска (нет pages.json, битый JSON)

import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const TITLE_MAX = 60;
const DESC_MAX = 160;

const dirArg = process.argv[2];
if (!dirArg) {
  console.error("[verify-metatags] usage: node verify-metatags.mjs <metatags_dir>");
  process.exit(1);
}
const metatagsDir = resolve(dirArg);

function readJson(path, fatal = true) {
  if (!existsSync(path)) {
    if (fatal) {
      console.error(`[verify-metatags] не найден: ${path}`);
      process.exit(1);
    }
    return null;
  }
  try {
    return JSON.parse(readFileSync(path, "utf8").replace(/^﻿/, ""));
  } catch (err) {
    if (fatal) {
      console.error(`[verify-metatags] битый JSON ${path}: ${err.message}`);
      process.exit(1);
    }
    return null;
  }
}

const pagesDoc = readJson(join(metatagsDir, "pages.json"));
const inputs = readJson(join(metatagsDir, "inputs.json"), false) || {};
const forbidden = Array.isArray(inputs.forbidden_phrasings) ? inputs.forbidden_phrasings.filter(Boolean) : [];

const pages = pagesDoc.pages || [];
if (pages.length === 0) {
  console.error("[verify-metatags] в pages.json нет страниц.");
  process.exit(1);
}

// Нормализация для проверки точного вхождения: lowercase, ё->е, схлопнуть пробелы.
function norm(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ")
    .trim();
}
// Длинное/среднее тире
const DASH_RE = /[—–]/;

const INFO_TYPES = new Set(["info", "article"]);

const missing = [];
const violations = [];
const warnings = [];

for (const page of pages) {
  const n = page.n;
  const pPath = join(metatagsDir, "pages", `${n}.json`);
  if (!existsSync(pPath)) {
    missing.push(`n${n} «${page.name || page.url}» - нет pages/${n}.json`);
    continue;
  }
  const mt = readJson(pPath, false);
  if (!mt) {
    violations.push(`n${n}: pages/${n}.json не читается (битый JSON)`);
    continue;
  }

  const label = `n${n} «${mt.name || page.name || page.url}»`;
  const h1 = String(mt.h1 || "");
  const title = String(mt.title || "");
  const desc = String(mt.description || "");
  const type = mt.type || page.type || "other";
  const form = mt.chosen_form || mt.marker || page.marker || "";

  // 1. Непустые поля
  if (!h1.trim()) violations.push(`${label}: пустой H1`);
  if (!title.trim()) violations.push(`${label}: пустой Title`);
  if (!desc.trim()) violations.push(`${label}: пустой Description`);

  // 2. Длины (считаем сами, не доверяем title_len/desc_len агента)
  const tLen = [...title].length;
  const dLen = [...desc].length;
  if (tLen > TITLE_MAX) violations.push(`${label}: Title ${tLen} симв. > ${TITLE_MAX} («${title}»)`);
  if (dLen > DESC_MAX) violations.push(`${label}: Description ${dLen} симв. > ${DESC_MAX}`);
  // Рассогласование заявленной длины (мягко)
  if (mt.title_len != null && mt.title_len !== tLen) warnings.push(`${label}: title_len=${mt.title_len}, факт ${tLen}`);
  if (mt.desc_len != null && mt.desc_len !== dLen) warnings.push(`${label}: desc_len=${mt.desc_len}, факт ${dLen}`);

  // 3. Тире
  if (DASH_RE.test(h1)) violations.push(`${label}: длинное/среднее тире в H1`);
  if (DASH_RE.test(title)) violations.push(`${label}: длинное/среднее тире в Title`);
  if (DASH_RE.test(desc)) violations.push(`${label}: длинное/среднее тире в Description`);

  // 4. Точное вхождение формы в H1 и Title (кроме info-страниц без маркера)
  if (!INFO_TYPES.has(type) && norm(form)) {
    const nf = norm(form);
    if (h1.trim() && !norm(h1).includes(nf)) {
      violations.push(`${label}: форма «${form}» не входит точно в H1 («${h1}»)`);
    }
    if (title.trim() && !norm(title).includes(nf)) {
      violations.push(`${label}: форма «${form}» не входит точно в Title («${title}»)`);
    }
    // 5. Маркер в первых ~3 словах Description (мягко: первое слово формы)
    if (desc.trim()) {
      const firstWord = nf.split(" ")[0];
      const first3 = norm(desc).split(" ").slice(0, 4).join(" ");
      if (firstWord && !first3.includes(firstWord)) {
        warnings.push(`${label}: маркер не в начале Description (первые слова: «${desc.split(/\s+/).slice(0, 4).join(" ")}»)`);
      }
    }
  }

  // 6. Запрещённые формулировки из A2/брифа
  for (const phrase of forbidden) {
    const np = norm(phrase);
    if (!np) continue;
    if (norm(h1).includes(np)) violations.push(`${label}: запрещённая формулировка «${phrase}» в H1`);
    if (norm(title).includes(np)) violations.push(`${label}: запрещённая формулировка «${phrase}» в Title`);
    if (norm(desc).includes(np)) violations.push(`${label}: запрещённая формулировка «${phrase}» в Description`);
  }
}

// === Отчёт ===
console.log(`[verify-metatags] страниц в плане: ${pages.length}, проверено файлов: ${pages.length - missing.length}`);

if (missing.length) {
  console.log(`\nОТСУТСТВУЮТ (${missing.length}) - скил пере-делегирует writer'у:`);
  for (const m of missing) console.log(`  - ${m}`);
}
if (violations.length) {
  console.log(`\nНАРУШЕНИЯ (${violations.length}):`);
  for (const v of violations) console.log(`  - ${v}`);
}
if (warnings.length) {
  console.log(`\nПРЕДУПРЕЖДЕНИЯ (${warnings.length}, не блокируют):`);
  for (const w of warnings) console.log(`  - ${w}`);
}

if (missing.length || violations.length) {
  console.log(`\n[verify-metatags] НЕ ПРОЙДЕНО (отсутствует ${missing.length}, нарушений ${violations.length}).`);
  process.exit(2);
}

console.log(`\n[verify-metatags] OK: все ${pages.length} страниц на месте, критичных нарушений нет.`);
process.exit(0);
