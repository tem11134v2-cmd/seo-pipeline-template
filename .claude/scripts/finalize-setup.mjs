#!/usr/bin/env node
// finalize-setup.mjs
// Завершает первичную настройку нового проекта: создаёт .env.example, делает первый коммит.
// Запускается скилом setup-project после client-profiler и template-designer.
//
// Использование:
//   node .claude/scripts/finalize-setup.mjs [project_root]
//
// Если аргумент не передан — используется текущая директория.

import { execSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const projectRoot = resolve(process.argv[2] || process.cwd());

function run(cmd, opts = {}) {
  return execSync(cmd, { cwd: projectRoot, stdio: "inherit", ...opts });
}

function runSilent(cmd) {
  return execSync(cmd, { cwd: projectRoot, stdio: "pipe" }).toString().trim();
}

console.log(`[finalize-setup] project_root = ${projectRoot}`);

// 1. .env.example — стандартный шаблон токенов
const envExamplePath = join(projectRoot, ".env.example");
if (!existsSync(envExamplePath)) {
  const tpl = [
    "# MCP-токены (значения копируются из .env, под git не попадают)",
    "JM_TOKEN=",
    "KEYSO_TOKEN=",
    "WORDSTAT_TOKEN=",
    "ARSENKIN_TOKEN=",
    "WK_TOKEN=",
    "WEBMASTER_TOKEN=",
    "YANDEX_TOKEN=",
    "SHEETS_TOKEN=",
    "",
  ].join("\n");
  writeFileSync(envExamplePath, tpl, "utf8");
  console.log("[finalize-setup] created .env.example");
}

// 2. git init если ещё не инициализирован
if (!existsSync(join(projectRoot, ".git"))) {
  run("git init -q");
  console.log("[finalize-setup] git init done");
}

// 3. Первый коммит (если нет ни одного)
let hasCommits = false;
try {
  runSilent("git rev-parse HEAD");
  hasCommits = true;
} catch {
  hasCommits = false;
}

if (!hasCommits) {
  run("git add .");
  run('git commit -q -m "Initial project setup"');
  console.log("[finalize-setup] initial commit created");
} else {
  // Проект уже с историей — добавить и закоммитить новые файлы
  try {
    const status = runSilent("git status --porcelain");
    if (status.length > 0) {
      run("git add .");
      run('git commit -q -m "Project setup updates"');
      console.log("[finalize-setup] commit with setup updates");
    } else {
      console.log("[finalize-setup] no changes to commit");
    }
  } catch (e) {
    console.warn("[finalize-setup] commit step skipped:", e.message);
  }
}

console.log("[finalize-setup] done");
