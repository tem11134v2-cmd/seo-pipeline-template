#!/usr/bin/env node
// run.mjs - регрессионный тест-набор batch-queue.mjs (движок серийной очереди
// /seo-statya, пункт 4 спеки Этапа 1).
// Запуск: .claude\scripts\_node.cmd .claude\tests\batch-queue\run.mjs
//
// Проверяет:
//   1. Схема: init создаёт batch-queue.json с корректными topics/counters.
//   2. next выбирает первую actionable тему (in-progress приоритетнее pending,
//      failed пропускается), идемпотентен без промежуточных set.
//   3. set + next двигают очередь; all-done -> stdout {"done":true}, exit 3.
//   4. resume-идемпотентность: повторный init поверх активной серии сохраняет
//      состояния (done/failed не сбрасываются).
//   5. init другого spec поверх НЕзавершённой серии -> exit 1.
//   6. Парсинг spec (N-M / N,K / дубликаты+сортировка).
//   7. Устойчивость к битому batch-queue.json (next не падает необработанным
//      исключением, а завершается с ошибкой).
//
// Пакет P4 пишет .claude/scripts/batch-queue.mjs параллельно с этим набором.
// Если файла ещё нет - все тесты помечаются SKIP (набор всё равно зелёный,
// exit 0), а не FAIL.
//
// Копия движка запускается из изолированного fake-project в песочнице (своя
// .claude/tmp/), чтобы не задеть batch-queue.json реальной рабочей сессии -
// герметичность, как в style/run.mjs и sync/run.mjs.
//
// Exit 0 - все тесты прошли (или SKIP). Exit 1 - есть провал.

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "../../..");
const REAL_ENGINE = join(PROJECT_ROOT, ".claude/scripts/batch-queue.mjs");
const NODE_CMD = join(PROJECT_ROOT, ".claude/scripts/_node.cmd");
const SANDBOX = join(PROJECT_ROOT, ".claude/tmp/batch-queue-test");

// === Мини-фреймворк (по образцу style/run.mjs) ===
let passed = 0;
let failed = 0;
let skipped = 0;
const failures = [];

function step(name, fn) {
  try {
    const result = fn();
    if (result === true || result === undefined) {
      console.log(`  [test] ${name} ... PASS`);
      passed++;
    } else if (typeof result === "string" && result.startsWith("SKIP")) {
      console.log(`  [test] ${name} ... SKIP (${result.slice(4).replace(/^:\s*/, "")})`);
      skipped++;
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

// Каждый сценарий - свой fake-project (.claude/scripts/batch-queue.mjs -
// копия реального движка - + своя .claude/tmp/), чтобы next/init считали
// PROJECT_ROOT относительно СВОЕЙ копии, а не реального репозитория.
function makeScene(name) {
  const root = join(SANDBOX, name);
  mkdirSync(join(root, ".claude/scripts"), { recursive: true });
  mkdirSync(join(root, ".claude/tmp"), { recursive: true });
  writeFileSync(join(root, ".claude/scripts/batch-queue.mjs"), readFileSync(REAL_ENGINE));
  return {
    root,
    enginePath: join(root, ".claude/scripts/batch-queue.mjs"),
    queueFile: join(root, ".claude/tmp/batch-queue.json"),
  };
}

// shell:true (нужен для .cmd-обёртки) сам не квотирует аргументы с пробелами -
// подстраховываем сами, иначе многословный --reason обрежется по первому пробелу.
function q(arg) {
  return /\s/.test(arg) ? `"${arg}"` : arg;
}

// Запуск движка. Не бросает на ненулевом коде (нужны exit 1/3).
function runQueue(scene, ...args) {
  const r = spawnSync(NODE_CMD, [scene.enginePath, ...args.map(q)], {
    cwd: scene.root,
    encoding: "utf8",
    shell: true,
  });
  const out = (r.stdout || "") + (r.stderr || "");
  let json = null;
  const trimmed = (r.stdout || "").trim();
  if (trimmed) {
    try { json = JSON.parse(trimmed); } catch { /* не json - ок, часть команд печатает текст */ }
  }
  return { code: r.status, out, json };
}

function readQueue(scene) {
  return JSON.parse(readFileSync(scene.queueFile, "utf8"));
}

function topicOf(queue, topicId) {
  return (queue.topics || []).find((t) => t.topic_id === topicId);
}

// === Песочница ===
console.log("=== batch-queue.mjs regression ===");
console.log(`Sandbox: ${SANDBOX}`);
if (existsSync(SANDBOX)) rmSync(SANDBOX, { recursive: true, force: true });
mkdirSync(SANDBOX, { recursive: true });

const ENGINE_EXISTS = existsSync(REAL_ENGINE);

if (!ENGINE_EXISTS) {
  step("batch-queue.mjs", () => "SKIP: .claude/scripts/batch-queue.mjs отсутствует (пакет P4 ещё не готов)");
} else {
  // ──────────────────────────────────────────────────────────────────────
  // Сценарий A: схема + next-приоритеты + all-done -> exit 3
  // ──────────────────────────────────────────────────────────────────────
  const A = makeScene("scene-a");

  step("A1. init 11-13: файл создан, 3 topics в pending, counters корректны", () => {
    const r = runQueue(A, "init", "11-13");
    if (r.code !== 0) return `exit ${r.code} (expect 0): ${r.out.slice(-300)}`;
    if (!existsSync(A.queueFile)) return "batch-queue.json не создан";
    const q = readQueue(A);
    const ids = (q.topics || []).map((t) => t.topic_id);
    if (JSON.stringify(ids) !== JSON.stringify([11, 12, 13])) return `topic_id: ${JSON.stringify(ids)} (expect [11,12,13])`;
    if (!(q.topics || []).every((t) => t.state === "pending")) return "не все topics в pending";
    const c = q.counters || {};
    if (c.total !== 3 || c.pending !== 3 || c.done !== 0 || c.in_progress !== 0 || c.failed !== 0) {
      return `counters некорректны: ${JSON.stringify(c)}`;
    }
    return true;
  });

  step("A2. next выбирает первую pending (11), exit 0", () => {
    const r = runQueue(A, "next");
    if (r.code !== 0) return `exit ${r.code} (expect 0): ${r.out.slice(-300)}`;
    if (!r.json || r.json.topic_id !== 11) return `stdout: ${JSON.stringify(r.json)} (expect topic_id=11)`;
    return true;
  });

  step("A3. идемпотентность: повторный next без изменений -> тот же topic_id", () => {
    const r1 = runQueue(A, "next");
    const r2 = runQueue(A, "next");
    if (!r1.json || !r2.json) return `нет JSON: ${r1.out.slice(-200)} | ${r2.out.slice(-200)}`;
    if (r1.json.topic_id !== r2.json.topic_id) return `${r1.json.topic_id} != ${r2.json.topic_id}`;
    return true;
  });

  step("A4. set 11 done -> next возвращает 12", () => {
    const s = runQueue(A, "set", "11", "done", "--dir", "articles/011-slug-abc", "--genre", "Гайд");
    if (s.code !== 0) return `set exit ${s.code}: ${s.out.slice(-300)}`;
    const r = runQueue(A, "next");
    if (!r.json || r.json.topic_id !== 12) return `stdout: ${JSON.stringify(r.json)} (expect topic_id=12)`;
    return true;
  });

  step("A5. in-progress приоритетнее pending: 12=in-progress, 13=pending -> next=12", () => {
    let s = runQueue(A, "set", "12", "in-progress", "--dir", "articles/012-slug-def");
    if (s.code !== 0) return `set 12 in-progress exit ${s.code}: ${s.out.slice(-300)}`;
    s = runQueue(A, "set", "13", "pending");
    if (s.code !== 0) return `set 13 pending exit ${s.code}: ${s.out.slice(-300)}`;
    const r = runQueue(A, "next");
    if (!r.json || r.json.topic_id !== 12) return `stdout: ${JSON.stringify(r.json)} (ожидал прерванную 12, не 13)`;
    return true;
  });

  step("A6. failed пропускается: 12=failed (11=done,13=pending) -> next=13", () => {
    const s = runQueue(A, "set", "12", "failed", "--reason", "verify: 2 цикла не сошлись");
    if (s.code !== 0) return `set 12 failed exit ${s.code}: ${s.out.slice(-300)}`;
    const q = readQueue(A);
    const t12 = topicOf(q, 12);
    if (!t12 || t12.state !== "failed" || t12.reason !== "verify: 2 цикла не сошлись") {
      return `topic 12 не отражает failed+reason: ${JSON.stringify(t12)}`;
    }
    const r = runQueue(A, "next");
    if (!r.json || r.json.topic_id !== 13) return `stdout: ${JSON.stringify(r.json)} (expect topic_id=13)`;
    return true;
  });

  step("A7. all done/failed -> next печатает {done:true}, exit 3", () => {
    const s = runQueue(A, "set", "13", "done", "--dir", "articles/013-slug-ghi");
    if (s.code !== 0) return `set 13 done exit ${s.code}: ${s.out.slice(-300)}`;
    const r = runQueue(A, "next");
    if (r.code !== 3) return `exit ${r.code} (expect 3): ${r.out.slice(-300)}`;
    if (!r.json || r.json.done !== true) return `stdout: ${JSON.stringify(r.json)} (expect {done:true})`;
    return true;
  });

  // ──────────────────────────────────────────────────────────────────────
  // Сценарий B: resume-идемпотентность + другой spec поверх незавершённой серии
  // ──────────────────────────────────────────────────────────────────────
  const B = makeScene("scene-b");

  step("B1. init 11-13, set 11 done, set 12 failed (13 остаётся pending)", () => {
    let r = runQueue(B, "init", "11-13");
    if (r.code !== 0) return `init exit ${r.code}: ${r.out.slice(-300)}`;
    r = runQueue(B, "set", "11", "done", "--dir", "articles/011-x");
    if (r.code !== 0) return `set 11 done exit ${r.code}: ${r.out.slice(-300)}`;
    r = runQueue(B, "set", "12", "failed", "--reason", "test-fail");
    if (r.code !== 0) return `set 12 failed exit ${r.code}: ${r.out.slice(-300)}`;
    return true;
  });

  step("B2. повторный init того же spec НЕ сбрасывает done/failed (resume)", () => {
    const r = runQueue(B, "init", "11-13");
    if (r.code !== 0) return `exit ${r.code} (expect 0): ${r.out.slice(-300)}`;
    const after = readQueue(B);
    const t11 = topicOf(after, 11);
    const t12 = topicOf(after, 12);
    const t13 = topicOf(after, 13);
    if (!t11 || t11.state !== "done") return `topic 11 состояние потеряно: ${JSON.stringify(t11)}`;
    if (!t12 || t12.state !== "failed") return `topic 12 состояние потеряно: ${JSON.stringify(t12)}`;
    if (!t13 || t13.state !== "pending") return `topic 13 состояние изменилось: ${JSON.stringify(t13)}`;
    const c = after.counters || {};
    if (c.done !== 1 || c.failed !== 1 || c.pending !== 1) return `counters не совпадают: ${JSON.stringify(c)}`;
    return true;
  });

  step("B3. init ДРУГОГО spec поверх незавершённой серии -> exit 1", () => {
    const r = runQueue(B, "init", "20-22");
    if (r.code !== 1) return `exit ${r.code} (expect 1): ${r.out.slice(-300)}`;
    // Серия B не должна пострадать - 13 всё ещё pending той же серии 11-13.
    const q = readQueue(B);
    const t13 = topicOf(q, 13);
    if (!t13 || t13.state !== "pending") return `серия 11-13 повреждена после отказа: ${JSON.stringify(t13)}`;
    return true;
  });

  // ──────────────────────────────────────────────────────────────────────
  // Сценарий C: парсинг spec (каждый подслучай - свежая песочница)
  // ──────────────────────────────────────────────────────────────────────

  step("C1. init \"11,13,15\" -> topics [11,13,15]", () => {
    const C1 = makeScene("scene-c1");
    const r = runQueue(C1, "init", "11,13,15");
    if (r.code !== 0) return `exit ${r.code}: ${r.out.slice(-300)}`;
    const ids = (readQueue(C1).topics || []).map((t) => t.topic_id);
    if (JSON.stringify(ids) !== JSON.stringify([11, 13, 15])) return `ids: ${JSON.stringify(ids)}`;
    return true;
  });

  step("C2. init \"11-13\" -> topics [11,12,13]", () => {
    const C2 = makeScene("scene-c2");
    const r = runQueue(C2, "init", "11-13");
    if (r.code !== 0) return `exit ${r.code}: ${r.out.slice(-300)}`;
    const ids = (readQueue(C2).topics || []).map((t) => t.topic_id);
    if (JSON.stringify(ids) !== JSON.stringify([11, 12, 13])) return `ids: ${JSON.stringify(ids)}`;
    return true;
  });

  step("C3. дубликаты убраны, отсортировано: \"13,11,11,12\" -> [11,12,13]", () => {
    const C3 = makeScene("scene-c3");
    const r = runQueue(C3, "init", "13,11,11,12");
    if (r.code !== 0) return `exit ${r.code}: ${r.out.slice(-300)}`;
    const ids = (readQueue(C3).topics || []).map((t) => t.topic_id);
    if (JSON.stringify(ids) !== JSON.stringify([11, 12, 13])) return `ids: ${JSON.stringify(ids)} (дубликаты/сортировка)`;
    return true;
  });

  // ──────────────────────────────────────────────────────────────────────
  // Сценарий D: устойчивость к битому batch-queue.json
  // ──────────────────────────────────────────────────────────────────────

  step("D1. битый batch-queue.json: next не падает необработанным исключением", () => {
    const D = makeScene("scene-d");
    writeFileSync(D.queueFile, "{ не json вовсе,,, ");
    const r = runQueue(D, "next");
    if (r.code === 0 || r.code === 3) return `exit ${r.code} - движок не заметил битый json (ожидал ошибку, напр. 1)`;
    return true;
  });
}

// === Итог ===
console.log("");
console.log(`=== ${passed}/${passed + failed} tests passed, ${skipped} skipped ===`);
if (failed > 0) {
  for (const f of failures) console.error(`  FAIL: ${f}`);
  process.exit(1);
}

// Всё зелёное - убираем песочницу за собой (герметичность).
rmSync(SANDBOX, { recursive: true, force: true });
process.exit(0);
