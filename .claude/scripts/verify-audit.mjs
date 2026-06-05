#!/usr/bin/env node
// verify-audit.mjs
// Механическая проверка контракта audit_data.json (§5.6 исходного скила -
// "финальная самопроверка отчёта", переведённая из промта в детерминированный скрипт).
//
// Использование:
//   node .claude/scripts/verify-audit.mjs <audit_dir>
// Вход: <audit_dir>/audit_data.json
//
// Проверяет:
//   [error] counts.{critical,important,nice_to_have,ok,not_checked} == длинам массивов
//   [error] каждая ссылка checklist[*].appendix указывает на существующее приложение
//   [error] нет открытых плейсхолдеров {...} в теле отчёта (карточка/проблемы/чеклист/
//           мета-таблица/аналитика). Приложения исключены - там {Название} легитимны как
//           dev-шаблоны.
//   [error] значения карточки не пустые
//   [warn]  критичная/важная проблема есть, а чеклист для этого приоритета пуст
//   [warn]  приложение не упомянуто ни в одной задаче чеклиста (сирота)
//
// Коды выхода: 0 - ок (возможны warn); 2 - есть error.

import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const auditDirArg = process.argv[2];
if (!auditDirArg) {
  console.error("[verify-audit] usage: node verify-audit.mjs <audit_dir>");
  process.exit(1);
}
const dataPath = join(resolve(auditDirArg), "audit_data.json");
if (!existsSync(dataPath)) {
  console.error(`[verify-audit] not found: ${dataPath}`);
  process.exit(1);
}

let data;
try {
  data = JSON.parse(readFileSync(dataPath, "utf8").replace(/^﻿/, ""));
} catch (e) {
  console.error(`[verify-audit] невалидный JSON: ${e.message}`);
  process.exit(2);
}

const errors = [];
const warns = [];
const len = (x) => (Array.isArray(x) ? x.length : 0);

// 1. counts == длины массивов
const c = data.counts || {};
const checks = [
  ["critical", len(data.critical_problems)],
  ["important", len(data.important_problems)],
  ["nice_to_have", len(data.nice_problems)],
  ["ok", len(data.ok_items)],
  ["not_checked", len(data.not_checked)],
];
for (const [key, actual] of checks) {
  if ((c[key] ?? 0) !== actual) {
    errors.push(`counts.${key} = ${c[key] ?? 0}, а в массиве ${actual} элементов`);
  }
}

// 2. ссылки на приложения
const nApp = len(data.appendices);
const referenced = new Set();
const cl = data.checklist || {};
for (const lvl of ["critical", "important", "nice"]) {
  for (const t of cl[lvl] || []) {
    if (t.appendix === null || t.appendix === undefined) continue;
    const n = Number(t.appendix);
    if (!Number.isInteger(n) || n < 1 || n > nApp) {
      errors.push(`checklist.${lvl}: ссылка appendix=${t.appendix} ("${t.task || "?"}") не указывает на существующее приложение (всего ${nApp})`);
    } else {
      referenced.add(n);
    }
  }
}
// сироты-приложения
for (let i = 1; i <= nApp; i++) {
  if (!referenced.has(i)) {
    const title = (data.appendices[i - 1] || {}).title || "?";
    warns.push(`Приложение ${i} ("${title}") не упомянуто ни в одной задаче чеклиста`);
  }
}

// 3. плейсхолдеры {...} в теле отчёта (без приложений)
const PLACEHOLDER = /\{[^}\n]{0,60}\}/;
function scan(node, path) {
  if (node == null) return;
  if (typeof node === "string") {
    if (PLACEHOLDER.test(node)) {
      errors.push(`открытый плейсхолдер в ${path}: "${node.slice(0, 70)}"`);
    }
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((v, i) => scan(v, `${path}[${i}]`));
    return;
  }
  if (typeof node === "object") {
    for (const [k, v] of Object.entries(node)) scan(v, path ? `${path}.${k}` : k);
  }
}
for (const key of ["card", "critical_problems", "important_problems", "nice_problems",
  "ok_items", "not_checked", "meta_table", "analytics", "checklist"]) {
  scan(data[key], key);
}

// 4. значения карточки не пустые
for (const row of data.card || []) {
  const v = (row && row.value != null) ? String(row.value).trim() : "";
  if (v === "") errors.push(`карточка: пустое значение у "${(row && row.label) || "?"}"`);
}

// 5. покрытие чеклистом
if (len(data.critical_problems) > 0 && len(cl.critical) === 0) {
  warns.push("есть критичные проблемы, но чеклист.critical пуст");
}
if (len(data.important_problems) > 0 && len(cl.important) === 0) {
  warns.push("есть важные проблемы, но чеклист.important пуст");
}

// ── вывод ──
for (const w of warns) console.log(`[verify-audit] WARN: ${w}`);
for (const e of errors) console.error(`[verify-audit] ERROR: ${e}`);

if (errors.length) {
  console.error(`[verify-audit] провалено: ${errors.length} ошибок, ${warns.length} предупреждений`);
  process.exit(2);
}
console.log(`[verify-audit] OK: ошибок нет${warns.length ? `, ${warns.length} предупреждений` : ""}`);
process.exit(0);
