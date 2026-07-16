#!/usr/bin/env node
// run.mjs - регрессионный smoke-тест новой машинерии /seo-tehaudit (Этап 4: пороги
// on-page проверок в коде, факт-чек audit_data.json против источников).
//
// Использование:
//   .claude\scripts\_node.cmd .claude\tests\seo-tehaudit\run.mjs
//
// Что делает:
//   Блок A. merge-onpage.mjs (Пакет 1) - пересчет per-page вердиктов по TH из сырых
//     полей sample[] (Title/H1/Description), обратная совместимость onpage.json,
//     дедупликация extra_findings агента против пересчитанных проблем.
//   Блок B. verify-audit.mjs (Пакет 2) - карточка (состав/порядок 22 строки) +
//     meta_table.rows[].schema как строка. Дописывается Пакетом 2 в конец этого
//     файла (после маркера "БЛОК B" ниже) - Пакет 1 владеет файлом и создает скелет.
//
// Устойчивость к параллельной разработке: merge-onpage.mjs и verify-audit.mjs УЖЕ
// существуют на момент старта Этапа 4 (Пакеты 1-2 их только правят, это не новые
// файлы) - поэтому тесты выполняются всегда, без SKIP-веток по существованию файла
// (в отличие от /seo-analiz, где часть модулей была новой). Тесты Блока A рассчитаны
// на НОВОЕ поведение merge (пересчет порогов из TH) - при прогоне ДО имплементации
// Пакета 1 они закономерно FAIL: тесты - контракт Пакета 1, а не диагностика.
//
// Exit 0 - все выполненные тесты (не SKIP) прошли. Exit 1 - хоть один тест упал.

import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, cpSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..", "..", "..");
const fixturesDir = join(__dirname, "fixtures");
const SCRIPTS = join(projectRoot, ".claude", "scripts");
const nodeCmd = join(SCRIPTS, "_node.cmd");
const sandboxRoot = join(projectRoot, ".claude", "tmp", "seo-tehaudit-test");

let failed = 0;
let skipped = 0;
const results = [];

const SKIP = (reason) => ({ __skip: true, reason });

async function step(name, fn) {
  process.stdout.write(`  [test] ${name} ... `);
  try {
    const r = await fn();
    if (r && typeof r === "object" && r.__skip) {
      console.log("SKIP");
      console.log("    " + r.reason);
      results.push({ name, ok: true, skipped: true });
      skipped++;
      return;
    }
    if (r === true || r === undefined) {
      console.log("PASS");
      results.push({ name, ok: true });
    } else {
      console.log("FAIL");
      console.log("    " + r);
      results.push({ name, ok: false, err: r });
      failed++;
    }
  } catch (e) {
    console.log("ERROR");
    console.log("    " + (e.stack || e.message));
    results.push({ name, ok: false, err: e.message });
    failed++;
  }
}

function runScript(script, ...args) {
  const r = spawnSync(nodeCmd, [join(SCRIPTS, script), ...args], {
    cwd: projectRoot,
    encoding: "utf8",
    shell: true,
  });
  return { code: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8").replace(/^﻿/, ""));
}
function writeJson(path, obj) {
  writeFileSync(path, JSON.stringify(obj, null, 2));
}

function freshDir(dir, fixtureSubdir) {
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  cpSync(join(fixturesDir, fixtureSubdir), dir, { recursive: true });
  return dir;
}

// Найти проблему в problems[] по заголовку (точное совпадение) и подстроке в details
// (обычно url страницы). Возвращает объект проблемы или undefined.
function findProblem(problems, title, detailsIncludes) {
  return (problems || []).find(
    (p) => p && p.title === title && (!detailsIncludes || String(p.details || "").includes(detailsIncludes))
  );
}
// Посчитать сколько раз проблема с данным заголовком встречается для данного url
// (для дедуп-теста - дубль от агента не должен задвоить запись).
function countProblem(problems, title, detailsIncludes) {
  return (problems || []).filter(
    (p) => p && p.title === title && (!detailsIncludes || String(p.details || "").includes(detailsIncludes))
  ).length;
}
function rowByUrl(sample, url) {
  return (sample || []).find((r) => r.url === url);
}

// === Reset sandbox root ===
if (existsSync(sandboxRoot)) rmSync(sandboxRoot, { recursive: true, force: true });
mkdirSync(sandboxRoot, { recursive: true });

console.log("=== /seo-tehaudit (Этап 4) scripts smoke ===");
console.log("Sandbox: " + sandboxRoot);
console.log("");

// ═══════════════════════════════════════════════════════════════════════════
// Блок A: merge-onpage.mjs - пересчет порогов TH из сырых полей sample[] (Пакет 1)
// ═══════════════════════════════════════════════════════════════════════════
console.log("=== merge-onpage.mjs (Пакет 1) ===");

const mergeDir = join(sandboxRoot, "merge_dir");
let onpage = null; // кэш результата happy-path прогона для последующих тестов

await step("happy-path: merge-onpage.mjs merge_dir -> exit 0, onpage.json создан", () => {
  freshDir(mergeDir, "merge_dir");
  const r = runScript("merge-onpage.mjs", mergeDir);
  if (r.code !== 0) return `exit ${r.code}, stdout=${r.stdout.trim()}, stderr=${r.stderr.trim()}`;
  const outPath = join(mergeDir, "onpage.json");
  if (!existsSync(outPath)) return `${outPath} не создан`;
  onpage = readJson(outPath);
  return true;
});

await step("Title: 81 символ -> флаг 'Title слишком длинный' (важная)", () => {
  if (!onpage) return SKIP("happy-path не прошел, пропускаю");
  const p = findProblem(onpage.problems, "Title слишком длинный", "https://example.ru/title-81");
  if (!p) return "проблема не найдена для title-81 (81 символ)";
  if (p.priority !== "important") return `priority="${p.priority}", ожидал "important"`;
  return true;
});

await step("Title: 80 символов -> НЕТ флага (граница TH.TITLE_MAX)", () => {
  if (!onpage) return SKIP("happy-path не прошел, пропускаю");
  const p = findProblem(onpage.problems, "Title слишком длинный", "https://example.ru/title-80");
  if (p) return `не ожидал флаг для title-80 (80 символов - граница, не превышение): ${JSON.stringify(p)}`;
  return true;
});

await step("Title: 79 символов -> НЕТ флага", () => {
  if (!onpage) return SKIP("happy-path не прошел, пропускаю");
  const p = findProblem(onpage.problems, "Title слишком длинный", "https://example.ru/title-79");
  if (p) return `не ожидал флаг для title-79: ${JSON.stringify(p)}`;
  return true;
});

await step("Title: пустой (0) -> критичный флаг 'Title не заполнен'", () => {
  if (!onpage) return SKIP("happy-path не прошел, пропускаю");
  const p = findProblem(onpage.problems, "Title не заполнен", "https://example.ru/title-0");
  if (!p) return "проблема 'Title не заполнен' не найдена для title-0";
  if (p.priority !== "critical") return `priority="${p.priority}", ожидал "critical"`;
  return true;
});

await step("Description: 201 символ -> флаг 'Description слишком длинный' (важная)", () => {
  if (!onpage) return SKIP("happy-path не прошел, пропускаю");
  const p = findProblem(onpage.problems, "Description слишком длинный", "https://example.ru/desc-201");
  if (!p) return "проблема не найдена для desc-201 (201 символ)";
  if (p.priority !== "important") return `priority="${p.priority}", ожидал "important"`;
  return true;
});

await step("Description: 200 символов -> НЕТ флага (граница TH.DESC_MAX)", () => {
  if (!onpage) return SKIP("happy-path не прошел, пропускаю");
  const p = findProblem(onpage.problems, "Description слишком длинный", "https://example.ru/desc-200");
  if (p) return `не ожидал флаг для desc-200 (200 - граница, не превышение): ${JSON.stringify(p)}`;
  return true;
});

await step("Description: 199 символов -> НЕТ флага", () => {
  if (!onpage) return SKIP("happy-path не прошел, пропускаю");
  const p = findProblem(onpage.problems, "Description слишком длинный", "https://example.ru/desc-199");
  if (p) return `не ожидал флаг для desc-199: ${JSON.stringify(p)}`;
  return true;
});

await step("Description: пустой (0) -> критичный флаг 'Description не заполнен'", () => {
  if (!onpage) return SKIP("happy-path не прошел, пропускаю");
  const p = findProblem(onpage.problems, "Description не заполнен", "https://example.ru/desc-0");
  if (!p) return "проблема 'Description не заполнен' не найдена для desc-0";
  if (p.priority !== "critical") return `priority="${p.priority}", ожидал "critical"`;
  return true;
});

await step("H1: 2 штуки -> критичный флаг 'Несколько H1 на странице'", () => {
  if (!onpage) return SKIP("happy-path не прошел, пропускаю");
  const p = findProblem(onpage.problems, "Несколько H1 на странице", "https://example.ru/h1-2");
  if (!p) return "проблема не найдена для h1-2 (h1_count=2)";
  if (p.priority !== "critical") return `priority="${p.priority}", ожидал "critical"`;
  return true;
});

await step("H1: 0 штук -> критичный флаг 'Нет H1'", () => {
  if (!onpage) return SKIP("happy-path не прошел, пропускаю");
  const p = findProblem(onpage.problems, "Нет H1", "https://example.ru/h1-0");
  if (!p) return "проблема не найдена для h1-0 (h1_count=0)";
  if (p.priority !== "critical") return `priority="${p.priority}", ожидал "critical"`;
  return true;
});

await step("H1: 1 штука -> НЕТ флага (норма)", () => {
  if (!onpage) return SKIP("happy-path не прошел, пропускаю");
  const pNone = findProblem(onpage.problems, "Нет H1", "https://example.ru/h1-1");
  const pMulti = findProblem(onpage.problems, "Несколько H1 на странице", "https://example.ru/h1-1");
  if (pNone || pMulti) return `не ожидал H1-флаг для h1-1: ${JSON.stringify(pNone || pMulti)}`;
  return true;
});

await step("issues: заполнен на каждой строке sample[] (backward-compat для audit-writer)", () => {
  if (!onpage) return SKIP("happy-path не прошел, пропускаю");
  const missing = (onpage.sample || []).filter((r) => typeof r.issues !== "string" || r.issues.length === 0);
  if (missing.length) return `строки без issues: ${JSON.stringify(missing.map((r) => r.url))}`;
  return true;
});

await step("issues: чистая строка -> '-'", () => {
  if (!onpage) return SKIP("happy-path не прошел, пропускаю");
  const r = rowByUrl(onpage.sample, "https://example.ru/clean");
  if (!r) return "строка https://example.ru/clean не найдена в sample";
  if (r.issues !== "-") return `issues="${r.issues}", ожидал "-" (полностью чистая страница)`;
  return true;
});

await step("issues: проблемная строка -> непустой тег (не '-')", () => {
  if (!onpage) return SKIP("happy-path не прошел, пропускаю");
  const r = rowByUrl(onpage.sample, "https://example.ru/title-0");
  if (!r) return "строка https://example.ru/title-0 не найдена в sample";
  if (r.issues === "-" || !r.issues) return `issues="${r.issues}", ожидал непустой тег проблемы`;
  return true;
});

await step("extra_findings: дубликат агента (тот же url+смысл заголовка) НЕ задвоен", () => {
  if (!onpage) return SKIP("happy-path не прошел, пропускаю");
  // Фикстура: extra_findings содержит "Title Слишком Длинный" для url title-81/ (с
  // хвостовым слешем, другим регистром) - должен схлопнуться с пересчитанной merge
  // проблемой "Title слишком длинный" для той же страницы, а не создать вторую запись.
  const n = countProblem(onpage.problems, "Title слишком длинный", "https://example.ru/title-81");
  if (n !== 1) return `ожидал ровно 1 запись 'Title слишком длинный' для title-81 (дедуп extra_findings), нашел ${n}`;
  return true;
});

await step("extra_findings: нештатная находка агента (не покрыта TH) - ПРИСУТСТВУЕТ в problems", () => {
  if (!onpage) return SKIP("happy-path не прошел, пропускаю");
  const p = findProblem(onpage.problems, "Обнаружен цикл редиректов на карточке товара", "https://example.ru/redirect-loop");
  if (!p) return "нештатная находка extra_findings не перенесена в problems (агент теряет право на нештатные находки)";
  return true;
});

await step("onpage.json: схема не изменилась (audit-writer читает без правок)", () => {
  if (!onpage) return SKIP("happy-path не прошел, пропускаю");
  const requiredKeys = [
    "sample_source", "sample", "title_placeholder", "url_structure",
    "favicon", "schema_summary", "problems", "ok_items", "mcp_errors",
  ];
  const missing = requiredKeys.filter((k) => !(k in onpage));
  if (missing.length) return `отсутствуют поля верхнего уровня: ${missing.join(", ")}`;
  if (!Array.isArray(onpage.sample)) return "onpage.sample не массив";
  if (!Array.isArray(onpage.problems)) return "onpage.problems не массив";
  return true;
});

// ═══════════════════════════════════════════════════════════════════════════
// БЛОК B: verify-audit.mjs - карточка (состав/порядок 22) + schema-строка (Пакет 2)
// ═══════════════════════════════════════════════════════════════════════════
// Пакет 2 дописывает свои await step(...) СРАЗУ ПОСЛЕ этого маркера, используя те
// же хелперы (step/runScript/readJson/writeJson/freshDir) и свою фикстуру
// fixtures/verify_dir/ (не пересекается с merge_dir). Финальный блок (подсчет
// PASS/FAIL и очистка sandbox) должен остаться ПОСЛЕДНИМ в файле - Пакет 2
// вставляет свой код перед ним, не после.
console.log("=== verify-audit.mjs (Пакет 2) ===");

const verifyDir = join(sandboxRoot, "verify_dir");

await step("happy-path: verify-audit.mjs verify_dir -> exit 0 (карточка/schema валидны)", () => {
  freshDir(verifyDir, "verify_dir");
  const r = runScript("verify-audit.mjs", verifyDir);
  if (r.code !== 0) return `exit ${r.code}, stdout=${r.stdout.trim()}, stderr=${r.stderr.trim()}`;
  return true;
});

await step("карточка: сломанный порядок (переставлены CMS и Тематика) -> exit 2", () => {
  freshDir(verifyDir, "verify_dir");
  const dataPath = join(verifyDir, "audit_data.json");
  const data = readJson(dataPath);
  // §5.5: индекс 1 = "Тематика", индекс 2 = "CMS" - меняем местами (0-based).
  [data.card[1], data.card[2]] = [data.card[2], data.card[1]];
  writeJson(dataPath, data);
  const r = runScript("verify-audit.mjs", verifyDir);
  if (r.code !== 2) return `exit ${r.code}, ожидал 2 (сломанный порядок карточки); stderr=${r.stderr.trim()}`;
  if (!/карточка/.test(r.stderr)) return `stderr не упоминает карточку: ${r.stderr.trim()}`;
  return true;
});

await step("карточка: пропавшая строка (21 вместо 22) -> exit 2", () => {
  freshDir(verifyDir, "verify_dir");
  const dataPath = join(verifyDir, "audit_data.json");
  const data = readJson(dataPath);
  data.card.splice(3, 1); // удаляем "Шаблон" - остаётся 21 строка, дальше все сдвинуты
  writeJson(dataPath, data);
  const r = runScript("verify-audit.mjs", verifyDir);
  if (r.code !== 2) return `exit ${r.code}, ожидал 2 (21 строка вместо 22); stderr=${r.stderr.trim()}`;
  if (!/22/.test(r.stderr)) return `stderr не упоминает ожидаемое число строк (22): ${r.stderr.trim()}`;
  return true;
});

await step("meta_table.rows[0].schema - массив вместо строки -> exit 2", () => {
  freshDir(verifyDir, "verify_dir");
  const dataPath = join(verifyDir, "audit_data.json");
  const data = readJson(dataPath);
  data.meta_table.rows[0].schema = ["Organization", "BreadcrumbList"];
  writeJson(dataPath, data);
  const r = runScript("verify-audit.mjs", verifyDir);
  if (r.code !== 2) return `exit ${r.code}, ожидал 2 (schema - массив); stderr=${r.stderr.trim()}`;
  if (!/schema/.test(r.stderr)) return `stderr не упоминает schema: ${r.stderr.trim()}`;
  return true;
});

await step("регрессия: counts.critical != длине critical_problems -> exit 2", () => {
  freshDir(verifyDir, "verify_dir");
  const dataPath = join(verifyDir, "audit_data.json");
  const data = readJson(dataPath);
  data.counts.critical = 99;
  writeJson(dataPath, data);
  const r = runScript("verify-audit.mjs", verifyDir);
  if (r.code !== 2) return `exit ${r.code}, ожидал 2 (counts.critical рассинхронизирован); stderr=${r.stderr.trim()}`;
  if (!/counts\.critical/.test(r.stderr)) return `stderr не упоминает counts.critical: ${r.stderr.trim()}`;
  return true;
});

// ═══════════════════════════════════════════════════════════════════════════
// Финал
// ═══════════════════════════════════════════════════════════════════════════
console.log("");
const passed = results.filter((r) => r.ok && !r.skipped).length;
const total = results.length;
console.log(`=== ${passed}/${total} tests passed (${skipped} skipped) ===`);

if (failed > 0) {
  console.log("");
  console.log("Failed:");
  for (const r of results.filter((r) => !r.ok)) {
    console.log(`  - ${r.name}: ${r.err}`);
  }
  process.exit(1);
}

// Чистим sandbox если все ок
rmSync(sandboxRoot, { recursive: true, force: true });
process.exit(0);
