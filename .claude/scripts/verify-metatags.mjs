#!/usr/bin/env node
// verify-metatags.mjs
// Механическая проверка сгенерированных метатегов (Фаза 4 /seo-metategi).
// Заменяет hook: на веере writer'ов hook с маркером одного файла давал бы ложные
// отказы (см. ADR-012 п.3). Скрипт проверяет всю пачку файлов РАЗОМ после writer'ов
// и говорит скилу, какие страницы недоделаны/деградировали. (deep идёт последовательно,
// bulk - параллельно, но проверка одинаково пакетная по pages/<n>.json.)
//
// Использование:
//   node .claude/scripts/verify-metatags.mjs <metatags_dir> [--accept-degraded]
//
// Вход:
//   <metatags_dir>/pages.json        - канонический список целевых страниц
//   <metatags_dir>/pages/<n>.json    - результат writer'а на страницу
//   <metatags_dir>/inputs.json       - forbidden_phrasings[] (опц.)
// Выход (stdout):
//   построчный отчёт: missing pages + violations + degraded
//
// Флаги:
//   --accept-degraded - страницы с флагом mcp_degraded (arsenkin/Акварель не
//     поднялись под нагрузкой, собрано по PLAYBOOK) НЕ блокируют (уходят в
//     предупреждение). Скил ставит этот флаг ПОСЛЕ 1 спокойного повтора, чтобы
//     не зациклиться, если сервер так и не отвечает.
//
// Exit:
//   0 - все страницы есть, без критичных нарушений и (без --accept-degraded) без деградации
//   2 - есть отсутствующие / критичные нарушения / деградировавшие страницы (скил пере-делегирует)
//   1 - ошибка запуска (нет pages.json, битый JSON)

import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const TITLE_MAX = 60;
const DESC_MAX = 160;

const rawArgs = process.argv.slice(2);
const acceptDegraded = rawArgs.includes("--accept-degraded");
const dirArg = rawArgs.find((a) => !a.startsWith("--"));
if (!dirArg) {
  console.error("[verify-metatags] usage: node verify-metatags.mjs <metatags_dir> [--accept-degraded]");
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
const degraded = [];

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

  // 0. Деградация: выдача arsenkin не поднялась под нагрузкой - страница собрана
  // вслепую по PLAYBOOK. Это transient-сбой, а не брак контента. Два состояния:
  //   mcp_degraded       - свежая деградация: скил даёт 1 спокойный повтор (блокирует
  //                        exit 2, если не передан --accept-degraded).
  //   mcp_degraded_final - терминальная: writer выставил её на спокойном повторе, когда
  //                        выдача ТАК И не поднялась. Машинный стоп зацикливания - НИКОГДА
  //                        не блокирует, даже без --accept-degraded.
  // Само наличие флага не мешает остальным проверкам ниже (длина/тире/вхождение).
  const flags = Array.isArray(mt.flags) ? mt.flags : [];
  const isFinalDeg = flags.includes("mcp_degraded_final");
  if (flags.includes("mcp_degraded") || isFinalDeg) {
    const note = String(mt.notes || "").trim();
    const text = `${label}${note ? ` - ${note}` : " - выдача/Акварель arsenkin не пришла, собрано по PLAYBOOK"}`;
    degraded.push({ text, isFinal: isFinalDeg });
  }

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
// Деградация. Свежая (mcp_degraded) блокирует, пока не передан --accept-degraded
// (скил даёт 1 спокойный повтор). Терминальная (mcp_degraded_final) - машинный стоп
// зацикливания: writer ставит её, когда повтор тоже не дозвался до arsenkin; не
// блокирует НИКОГДА, даже без флага - так цикл сходится кодом, а не дисциплиной LLM.
const freshDeg = degraded.filter((d) => !d.isFinal);
const finalDeg = degraded.filter((d) => d.isFinal);
const degradeBlocks = freshDeg.length > 0 && !acceptDegraded;
if (freshDeg.length) {
  if (acceptDegraded) {
    console.log(`\nДЕГРАДАЦИЯ свежая (${freshDeg.length}, принято с --accept-degraded, не блокирует) - собрано по PLAYBOOK, отметить в финальной сводке:`);
  } else {
    console.log(`\nДЕГРАДАЦИЯ свежая (${freshDeg.length}) - mcp_degraded, скил даёт 1 спокойный повтор (deep, по одной), затем verify с --accept-degraded:`);
  }
  for (const d of freshDeg) console.log(`  - ${d.text}`);
}
if (finalDeg.length) {
  console.log(`\nДЕГРАДАЦИЯ терминальная (${finalDeg.length}, mcp_degraded_final - выдача так и не поднялась после повтора, не блокирует) - отметить в финальной сводке:`);
  for (const d of finalDeg) console.log(`  - ${d.text}`);
}
if (warnings.length) {
  console.log(`\nПРЕДУПРЕЖДЕНИЯ (${warnings.length}, не блокируют):`);
  for (const w of warnings) console.log(`  - ${w}`);
}

if (missing.length || violations.length || degradeBlocks) {
  console.log(
    `\n[verify-metatags] НЕ ПРОЙДЕНО (отсутствует ${missing.length}, нарушений ${violations.length}, деградировало свежих ${degradeBlocks ? freshDeg.length : 0}).`
  );
  process.exit(2);
}

const tail = degraded.length ? ` (деградировало ${degraded.length}: терминальных ${finalDeg.length} - принято, по PLAYBOOK)` : "";
console.log(`\n[verify-metatags] OK: все ${pages.length} страниц на месте, критичных нарушений нет${tail}.`);
process.exit(0);
