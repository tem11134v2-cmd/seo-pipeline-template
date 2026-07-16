#!/usr/bin/env node
// run.mjs - smoke-тесты для read-topics-xlsx.mjs (флаг --main-only, /seo-temi).
// Запуск: .claude\scripts\_node.cmd .claude\tests\seo-temi\run.mjs
//
// Проверяет:
//   - --main-only на xlsx с темами -> компактный {exists,count,main_queries}
//   - --main-only без файла -> {exists:false,count:0,main_queries:[]}, exit 0
//   - полный режим (без флага) не сломан -> topics[] присутствует
//   - --by-number + --main-only -> приоритет --by-number
//
// Exit 0 - все тесты прошли. Exit 1 - есть провал.

import { execFileSync } from "node:child_process";
import { writeFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "../../..");
const SANDBOX = join(PROJECT_ROOT, ".claude/tmp/seo-temi-test");

// === Мини-фреймворк (по образцу tests/metatags/run.mjs) ===
let passed = 0;
let failed = 0;
const failures = [];

function step(name, fn) {
  try {
    const result = fn();
    if (result === true || result === undefined) {
      console.log(`  [test] ${name} ... PASS`);
      passed++;
    } else {
      console.log(`  [test] ${name} ... FAIL (${result})`);
      failed++;
      failures.push(`${name}: ${result}`);
    }
  } catch (err) {
    console.log(`  [test] ${name} ... FAIL (${err.message})`);
    failed++;
    failures.push(`${name}: ${err.message}`);
  }
}

// Запуск read-topics-xlsx.mjs; возвращает {code, stdout, json}.
function runScript(args) {
  const scriptPath = join(PROJECT_ROOT, ".claude/scripts/read-topics-xlsx.mjs");
  try {
    const stdout = execFileSync("node", [scriptPath, ...args], { encoding: "utf8" });
    let json = null;
    try {
      json = JSON.parse(stdout.replace(/^﻿/, "").trim());
    } catch {
      json = null;
    }
    return { code: 0, stdout, json };
  } catch (err) {
    return { code: err.status ?? 1, stdout: (err.stdout || "") + (err.stderr || ""), json: null };
  }
}

// === Песочница ===
console.log("=== /seo-temi read-topics-xlsx.mjs --main-only smoke ===");
console.log(`Sandbox: ${SANDBOX}`);
if (existsSync(SANDBOX)) rmSync(SANDBOX, { recursive: true, force: true });
mkdirSync(SANDBOX, { recursive: true });

// ──────────────────────────────────────────────────────────────────────────
// Фикстуры
// ──────────────────────────────────────────────────────────────────────────

// project root с topics.xlsx (3 темы, у третьей пустой main_query)
const withTopicsDir = join(SANDBOX, "with-topics");
mkdirSync(withTopicsDir, { recursive: true });

async function buildFixtureXlsx() {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet("Темы для статей");
  sheet.addRow([
    "№",
    "Тема статьи",
    "Основной запрос",
    "Частотность",
    "Интент",
    "Жанры",
    "Приоритет",
    "Сезонность",
    "Перелинковка",
    "Примечание",
  ]);
  sheet.addRow([1, "Как выбрать кухню на заказ", "как выбрать кухню на заказ", 320, "инфо", "Гайд, Сравнение", "Высокий", "нет", "/catalog/", ""]);
  sheet.addRow([2, "Уход за кухонными фасадами", "уход за кухонными фасадами", 90, "инфо", "Гайд", "Средний", "нет", "", ""]);
  sheet.addRow([3, "Тема без основного запроса", "", 0, "инфо", "Личный опыт", "Низкий", "нет", "", "черновик"]);
  await wb.xlsx.writeFile(join(withTopicsDir, "topics.xlsx"));
}
await buildFixtureXlsx();

// project root БЕЗ topics.xlsx
const noTopicsDir = join(SANDBOX, "no-topics");
mkdirSync(noTopicsDir, { recursive: true });

// ──────────────────────────────────────────────────────────────────────────
// 1. --main-only на xlsx с темами -> компактный JSON
// ──────────────────────────────────────────────────────────────────────────

step("--main-only: exists true, count 2 (пустой main_query отфильтрован)", () => {
  const r = runScript([withTopicsDir, "--main-only"]);
  if (r.code !== 0) return `exit ${r.code}`;
  if (!r.json) return `stdout не JSON: ${r.stdout}`;
  if (r.json.exists !== true) return `exists=${r.json.exists}`;
  if (r.json.count !== 2) return `count=${r.json.count} (expect 2)`;
  if (!Array.isArray(r.json.main_queries) || r.json.main_queries.length !== 2) {
    return `main_queries=${JSON.stringify(r.json.main_queries)}`;
  }
  if (!r.json.main_queries.includes("как выбрать кухню на заказ")) return "main_query 1 отсутствует";
  if (!r.json.main_queries.includes("уход за кухонными фасадами")) return "main_query 2 отсутствует";
  return true;
});

step("--main-only: нет полей topics[]/intent/genres (не полный дамп)", () => {
  const r = runScript([withTopicsDir, "--main-only"]);
  if (!r.json) return `stdout не JSON: ${r.stdout}`;
  if ("topics" in r.json) return "поле topics[] утекло в компактный режим";
  if ("intent" in r.json) return "поле intent утекло";
  if ("genres" in r.json) return "поле genres утекло";
  if ("topics_count" in r.json) return "поле topics_count утекло (ожидается count)";
  return true;
});

// ──────────────────────────────────────────────────────────────────────────
// 2. --main-only без файла -> exists:false, count:0, main_queries:[]
// ──────────────────────────────────────────────────────────────────────────

step("--main-only без topics.xlsx -> {exists:false,count:0,main_queries:[]}, exit 0", () => {
  const r = runScript([noTopicsDir, "--main-only"]);
  if (r.code !== 0) return `exit ${r.code} (expect 0)`;
  if (!r.json) return `stdout не JSON: ${r.stdout}`;
  if (r.json.exists !== false) return `exists=${r.json.exists}`;
  if (r.json.count !== 0) return `count=${r.json.count}`;
  if (!Array.isArray(r.json.main_queries) || r.json.main_queries.length !== 0) {
    return `main_queries=${JSON.stringify(r.json.main_queries)}`;
  }
  return true;
});

// ──────────────────────────────────────────────────────────────────────────
// 3. Полный режим (без флага) не сломан - регресс-гард обратной совместимости
//    (handoff-process/SKILL.md делает полный дедуп-merge на этом выводе).
// ──────────────────────────────────────────────────────────────────────────

step("без флага: полный дамп -> topics[] присутствует, все 3 темы, topics_count=3", () => {
  const r = runScript([withTopicsDir]);
  if (r.code !== 0) return `exit ${r.code}`;
  if (!r.json) return `stdout не JSON: ${r.stdout}`;
  if (r.json.exists !== true) return `exists=${r.json.exists}`;
  if (r.json.topics_count !== 3) return `topics_count=${r.json.topics_count} (expect 3)`;
  if (!Array.isArray(r.json.topics) || r.json.topics.length !== 3) return "topics[] отсутствует или неполный";
  if ("main_queries" in r.json) return "поле main_queries утекло в полный режим";
  const t1 = r.json.topics.find((t) => t.n === 1);
  if (!t1 || t1.main_query !== "как выбрать кухню на заказ") return "тема 1 не распознана в полном режиме";
  return true;
});

// ──────────────────────────────────────────────────────────────────────────
// 4. --by-number N + --main-only -> приоритет --by-number
// ──────────────────────────────────────────────────────────────────────────

step("--by-number 1 --main-only: приоритет --by-number (found/topic, не main_queries)", () => {
  const r = runScript([withTopicsDir, "--by-number", "1", "--main-only"]);
  if (r.code !== 0) return `exit ${r.code}`;
  if (!r.json) return `stdout не JSON: ${r.stdout}`;
  if (!("found" in r.json) || !("topic" in r.json)) return `не режим --by-number: ${r.stdout}`;
  if ("main_queries" in r.json) return "main_queries утекло, --main-only не должен победить --by-number";
  if (r.json.found !== true) return `found=${r.json.found}`;
  if (!r.json.topic || r.json.topic.main_query !== "как выбрать кухню на заказ") return "topic не тот";
  return true;
});

// === Итог ===
console.log("");
console.log(`=== ${passed}/${passed + failed} tests passed ===`);
if (failed > 0) {
  for (const f of failures) console.error(`  FAIL: ${f}`);
  process.exit(1);
}
process.exit(0);
