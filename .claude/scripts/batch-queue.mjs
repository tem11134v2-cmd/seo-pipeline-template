#!/usr/bin/env node
// batch-queue.mjs
// Детерминированный движок очереди серийного режима /seo-statya (диапазон/список тем
// в одной worktree-сессии). Источник истины серии - .claude/tmp/batch-queue.json.
// Позволяет оркестратору вести batch по exit-кодам/компактному JSON, не вычитывая
// всю очередь в контекст, и переживает авто-компакт (перечитать файл вместо
// восстановления состояния из чата).
//
// Использование (из корня проекта - cwd определяет проект, root не передается):
//   .claude\scripts\_node.cmd .claude\scripts\batch-queue.mjs init "<spec>" [--mode auto|review]
//   .claude\scripts\_node.cmd .claude\scripts\batch-queue.mjs next
//   .claude\scripts\_node.cmd .claude\scripts\batch-queue.mjs set <topic_id> <state> [--dir <path>] [--genre <g>] [--reason <text>]
//   .claude\scripts\_node.cmd .claude\scripts\batch-queue.mjs status [--json]
//
// spec: "11-20" (диапазон), "11,12,15" (список, можно комбинировать с диапазонами:
// "1-3,7"), "all" (все темы с уже completed-папкой в articles/*).
//
// Состояния темы: pending -> in-progress -> (done | failed).
//
// Exit codes:
//   init   - 0 ок; 1 ошибка (битый spec, битый файл, активна другая незавершенная серия)
//   next   - 0 есть actionable-тема; 3 очередь пуста (все done/failed - к серийному финалу);
//            1 очередь не найдена/битая
//   set    - 0 ок; 1 неизвестный topic_id/state, очередь не найдена
//   status - 0 ок; 1 очередь не найдена
//
// Запись atomic: пишем во временный файл рядом и переименовываем (fs rename атомарен
// на одной файловой системе) - чтобы оборванный процесс (авто-компакт, краш) не оставил
// batch-queue.json в половинчатом виде.

import {
  readFileSync,
  writeFileSync,
  renameSync,
  existsSync,
  readdirSync,
  statSync,
  mkdirSync,
} from "node:fs";
import { join, dirname } from "node:path";

const ROOT = process.cwd();
const QUEUE_PATH = join(ROOT, ".claude", "tmp", "batch-queue.json");
const ARTICLES_DIR = join(ROOT, "articles");

const STATES = ["pending", "in-progress", "done", "failed"];
const VALUE_FLAGS = new Set(["--mode", "--dir", "--genre", "--reason"]);
const BOOL_FLAGS = new Set(["--json"]);

function readClean(path) {
  return readFileSync(path, "utf8").replace(/^﻿/, "");
}

function nowIso() {
  return new Date().toISOString();
}

function parseArgs(argv) {
  const out = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (VALUE_FLAGS.has(tok)) {
      out.flags[tok] = argv[++i];
    } else if (BOOL_FLAGS.has(tok)) {
      out.flags[tok] = true;
    } else if (tok.startsWith("--")) {
      // Неизвестный флаг - не мешаем позиционным, но и не молчим полностью.
      out.flags[tok] = true;
    } else {
      out._.push(tok);
    }
  }
  return out;
}

function getFlag(args, name) {
  return args.flags[name];
}

// ─── Разбор spec ──────────────────────────────────────────────────────────
// "11-20" -> [11..20]; "11,12,15" -> [11,12,15]; можно комбинировать: "1-3,7".
// "all" -> topic_id всех папок articles/* с meta.state === "completed".
function listCompletedTopicIds() {
  if (!existsSync(ARTICLES_DIR)) return [];
  const ids = new Set();
  for (const name of readdirSync(ARTICLES_DIR)) {
    if (name.startsWith("_") || name.startsWith(".")) continue;
    const dir = join(ARTICLES_DIR, name);
    let st;
    try {
      st = statSync(dir);
    } catch {
      continue;
    }
    if (!st.isDirectory()) continue;
    const metaPath = join(dir, "meta.json");
    if (!existsSync(metaPath)) continue;
    let meta;
    try {
      meta = JSON.parse(readClean(metaPath));
    } catch {
      continue;
    }
    if (meta.state === "completed" && meta.topic_id != null) {
      ids.add(Number(meta.topic_id));
    }
  }
  return Array.from(ids).sort((a, b) => a - b);
}

function parseSpecToTopicIds(spec) {
  const s = String(spec || "").trim();
  if (!s) throw new Error("пустой spec");
  if (s.toLowerCase() === "all") return listCompletedTopicIds();

  const ids = new Set();
  for (const rawToken of s.split(",")) {
    const token = rawToken.trim();
    if (!token) continue;
    const rangeMatch = token.match(/^(\d+)-(\d+)$/);
    if (rangeMatch) {
      let a = parseInt(rangeMatch[1], 10);
      let b = parseInt(rangeMatch[2], 10);
      if (a > b) [a, b] = [b, a];
      for (let n = a; n <= b; n++) ids.add(n);
      continue;
    }
    if (/^\d+$/.test(token)) {
      ids.add(parseInt(token, 10));
      continue;
    }
    throw new Error(`не удалось распарсить фрагмент spec: "${token}"`);
  }
  if (ids.size === 0) throw new Error(`spec "${s}" не дал ни одной темы`);
  return Array.from(ids).sort((a, b) => a - b);
}

// ─── Чтение/запись очереди ────────────────────────────────────────────────
function readQueue() {
  if (!existsSync(QUEUE_PATH)) return null;
  let raw;
  try {
    raw = readClean(QUEUE_PATH);
  } catch (e) {
    console.error(`[batch-queue] не удалось прочитать ${QUEUE_PATH}: ${e.message}`);
    process.exit(1);
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    console.error(`[batch-queue] ${QUEUE_PATH} не парсится: ${e.message}`);
    process.exit(1);
  }
}

function writeQueue(queue) {
  const dir = dirname(QUEUE_PATH);
  mkdirSync(dir, { recursive: true });
  const tmpPath = join(dir, `.batch-queue.json.tmp-${process.pid}-${Date.now()}`);
  writeFileSync(tmpPath, JSON.stringify(queue, null, 2) + "\n", "utf8");
  renameSync(tmpPath, QUEUE_PATH); // атомарная замена
}

function computeCounters(topics) {
  const c = { total: topics.length, done: 0, in_progress: 0, pending: 0, failed: 0 };
  for (const t of topics) {
    if (t.state === "done") c.done++;
    else if (t.state === "in-progress") c.in_progress++;
    else if (t.state === "pending") c.pending++;
    else if (t.state === "failed") c.failed++;
  }
  return c;
}

function newTopic(id, now) {
  return { topic_id: id, state: "pending", article_dir: null, genre: null, reason: null, updated: now };
}

// ─── Субкоманды ───────────────────────────────────────────────────────────
function cmdInit(args) {
  const specArg = args._[0];
  if (!specArg) {
    console.error('[batch-queue] usage: batch-queue.mjs init "<spec>" [--mode auto|review]');
    process.exit(1);
  }
  const modeArg = getFlag(args, "--mode");
  if (modeArg !== undefined && modeArg !== "auto" && modeArg !== "review") {
    console.error(`[batch-queue] init: --mode должен быть auto|review, получено "${modeArg}"`);
    process.exit(1);
  }

  let topicIds;
  try {
    topicIds = parseSpecToTopicIds(specArg);
  } catch (e) {
    console.error(`[batch-queue] init: ${e.message}`);
    process.exit(1);
  }

  const now = nowIso();
  const existing = readQueue();
  let queue;

  if (!existing) {
    queue = {
      spec: specArg,
      mode: modeArg || "auto",
      created: now,
      updated: now,
      topics: topicIds.map((id) => newTopic(id, now)),
    };
  } else if (existing.spec === specArg) {
    // Идемпотентно: существующие состояния (done/failed/in-progress) сохраняются,
    // новые topic_id (если spec расширился) добавляются как pending.
    queue = existing;
    const existingIds = new Set((queue.topics || []).map((t) => t.topic_id));
    for (const id of topicIds) {
      if (!existingIds.has(id)) queue.topics.push(newTopic(id, now));
    }
    queue.topics.sort((a, b) => a.topic_id - b.topic_id);
    if (modeArg !== undefined) queue.mode = modeArg;
    queue.updated = now;
  } else {
    // Другой spec. Разрешаем перезапись ТОЛЬКО если предыдущая серия целиком done -
    // иначе рискуем молча потерять незавершенную/проблемную серию.
    const allDone = (existing.topics || []).length > 0 && existing.topics.every((t) => t.state === "done");
    if (!allDone) {
      console.error(
        `[batch-queue] init: активна другая серия "${existing.spec}" (не все done) - заверши ее или удали ${QUEUE_PATH}`,
      );
      process.exit(1);
    }
    queue = {
      spec: specArg,
      mode: modeArg || "auto",
      created: now,
      updated: now,
      topics: topicIds.map((id) => newTopic(id, now)),
    };
  }

  queue.counters = computeCounters(queue.topics);
  writeQueue(queue);
  console.log(JSON.stringify(queue.counters));
  process.exit(0);
}

function cmdNext() {
  const queue = readQueue();
  if (!queue) {
    console.error(`[batch-queue] next: очередь не найдена (${QUEUE_PATH}) - сначала init`);
    process.exit(1);
  }
  const topics = Array.isArray(queue.topics) ? queue.topics : [];
  const sorted = [...topics].sort((a, b) => a.topic_id - b.topic_id);

  // Прерванная (in-progress) тема - приоритет над еще не начатыми (pending).
  let target = sorted.find((t) => t.state === "in-progress");
  if (!target) target = sorted.find((t) => t.state === "pending");

  if (!target) {
    console.log(JSON.stringify({ done: true }));
    process.exit(3);
  }
  console.log(JSON.stringify({ topic_id: target.topic_id, state: target.state, article_dir: target.article_dir }));
  process.exit(0);
}

function cmdSet(args) {
  const [topicIdArg, stateArg] = args._;
  if (!topicIdArg || !stateArg) {
    console.error("[batch-queue] usage: batch-queue.mjs set <topic_id> <state> [--dir <path>] [--genre <g>] [--reason <text>]");
    process.exit(1);
  }
  if (!STATES.includes(stateArg)) {
    console.error(`[batch-queue] set: неизвестное состояние "${stateArg}" (ожидается: ${STATES.join("|")})`);
    process.exit(1);
  }
  if (!/^\d+$/.test(String(topicIdArg).trim())) {
    console.error(`[batch-queue] set: topic_id должен быть числом, получено "${topicIdArg}"`);
    process.exit(1);
  }
  const topicId = parseInt(topicIdArg, 10); // ведущие нули ("011") приводятся к 11

  const queue = readQueue();
  if (!queue) {
    console.error(`[batch-queue] set: очередь не найдена (${QUEUE_PATH}) - сначала init`);
    process.exit(1);
  }
  const topic = (queue.topics || []).find((t) => t.topic_id === topicId);
  if (!topic) {
    console.error(`[batch-queue] set: topic_id=${topicId} не найден в очереди`);
    process.exit(1);
  }

  const now = nowIso();
  topic.state = stateArg;
  const dir = getFlag(args, "--dir");
  const genre = getFlag(args, "--genre");
  const reason = getFlag(args, "--reason");
  if (dir !== undefined) topic.article_dir = dir;
  if (genre !== undefined) topic.genre = genre;
  if (reason !== undefined) topic.reason = reason;
  topic.updated = now;

  queue.updated = now;
  queue.counters = computeCounters(queue.topics);
  writeQueue(queue);
  console.log(JSON.stringify(queue.counters));
  process.exit(0);
}

function cmdStatus(args) {
  const asJson = getFlag(args, "--json") === true;
  const queue = readQueue();
  if (!queue) {
    console.error(`[batch-queue] status: очередь не найдена (${QUEUE_PATH})`);
    process.exit(1);
  }
  if (asJson) {
    console.log(JSON.stringify(queue));
    process.exit(0);
  }
  console.log(`[batch-queue] spec=${queue.spec} mode=${queue.mode} updated=${queue.updated}`);
  const c = queue.counters || computeCounters(queue.topics || []);
  console.log(`  total=${c.total} done=${c.done} in-progress=${c.in_progress} pending=${c.pending} failed=${c.failed}`);
  for (const t of (queue.topics || []).slice().sort((a, b) => a.topic_id - b.topic_id)) {
    const dir = t.article_dir ? ` dir=${t.article_dir}` : "";
    const genre = t.genre ? ` genre=${t.genre}` : "";
    const reason = t.reason ? ` reason="${t.reason}"` : "";
    console.log(`  [${t.state}] topic_id=${t.topic_id}${dir}${genre}${reason}`);
  }
  process.exit(0);
}

// ─── Диспетчер ────────────────────────────────────────────────────────────
const [, , subcommand, ...rest] = process.argv;
const args = parseArgs(rest);

switch (subcommand) {
  case "init":
    cmdInit(args);
    break;
  case "next":
    cmdNext(args);
    break;
  case "set":
    cmdSet(args);
    break;
  case "status":
    cmdStatus(args);
    break;
  default:
    console.error("[batch-queue] usage: batch-queue.mjs <init|next|set|status> ...");
    process.exit(1);
}
