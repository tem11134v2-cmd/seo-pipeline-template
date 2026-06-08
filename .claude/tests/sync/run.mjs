#!/usr/bin/env node
// run.mjs - smoke-тест движка sync-from-template.mjs.
//
// Использование:
//   .claude\scripts\_node.cmd .claude\tests\sync\run.mjs
//
// Делает в sandbox два git-репо (template + client) с заранее известными расхождениями
// и проверяет: dry-run ничего не пишет и верно считает +/~/-; apply зеркалит файлы,
// пишет .machinery-version, применяет миграцию и журналирует её, коммитит; повторный
// apply = up-to-date (идемпотентность); --no-delete не удаляет лишнее.
//
// Exit 0 - всё ок. Exit 1 - хоть один тест упал.

import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..", "..", "..");
const enginePath = join(projectRoot, ".claude", "scripts", "sync-from-template.mjs");
const sandbox = join(projectRoot, ".claude", "tmp", "sync-test");
const tpl = join(sandbox, "template");
const client = join(sandbox, "client");
const client2 = join(sandbox, "client2");

let failed = 0;
const results = [];

async function step(name, fn) {
  process.stdout.write(`  [test] ${name} ... `);
  try {
    const r = await fn();
    if (r === true || r === undefined) { console.log("PASS"); results.push({ name, ok: true }); }
    else { console.log("FAIL"); console.log("    " + r); results.push({ name, ok: false, err: r }); failed++; }
  } catch (e) {
    console.log("ERROR"); console.log("    " + (e.stack || e.message));
    results.push({ name, ok: false, err: e.message }); failed++;
  }
}

function w(root, rel, content) {
  const p = join(root, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content, "utf8");
}

function sh(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8" });
  return { code: r.status, out: (r.stdout || "") + (r.stderr || "") };
}

function gitInit(dir) {
  sh("git", ["init", "-q"], dir);
  sh("git", ["config", "user.email", "t@example.com"], dir);
  sh("git", ["config", "user.name", "test"], dir);
  sh("git", ["config", "commit.gpgsign", "false"], dir);
  sh("git", ["add", "-A"], dir);
  sh("git", ["commit", "-q", "-m", "init"], dir);
}

function runEngine(args) {
  const r = spawnSync(join(projectRoot, ".claude", "scripts", "_node.cmd"),
    [enginePath, ...args], { cwd: projectRoot, encoding: "utf8", shell: true });
  let json = null;
  try { json = JSON.parse(r.stdout.trim()); } catch { /* not json */ }
  return { code: r.status, stdout: r.stdout || "", stderr: r.stderr || "", json };
}

// Тестовая миграция: (1) идемпотентно создаёт файл-маркер migrated.txt;
// (2) выводит из индекса data/_index.json (репро бага: после rm --cached файл не должен
// вернуться в индекс, т.к. новый .gitignore его игнорирует).
const TEST_MIGRATION = `export const id = "001-test";
export const description = "тестовая миграция";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
export default async function (ctx) {
  const f = join(ctx.targetRoot, "migrated.txt");
  if (!existsSync(f)) writeFileSync(f, "ok", "utf8");   // идемпотентно
  const tracked = ctx.git(["ls-files", "--error-unmatch", "--", "data/_index.json"]);
  if (tracked !== null) ctx.git(["rm", "--cached", "-q", "--", "data/_index.json"]);
}
`;

// === Сборка фикстур ===
function buildTemplate() {
  w(tpl, ".claude/scripts/keep.mjs", "// keep v1\n");
  w(tpl, ".claude/scripts/changed.mjs", "// CHANGED in template\n");
  w(tpl, ".claude/scripts/new.mjs", "// brand new\n");
  w(tpl, ".claude/agents/a.md", "agent a\n");
  w(tpl, ".claude/skills/s/SKILL.md", "skill s\n");
  w(tpl, ".claude/hooks/h.sh", "echo hook\n");
  w(tpl, ".claude/git-hooks/pre-commit", "echo pre\n");
  w(tpl, ".claude/migrations/001-test.mjs", TEST_MIGRATION);
  w(tpl, ".claude/CLAUDE.md", "TEMPLATE claude md\n");
  w(tpl, "package.json", JSON.stringify({ name: "tpl", dependencies: { foo: "^2.0.0" } }, null, 2) + "\n");
  w(tpl, ".gitignore", "node_modules/\ndata/_index.json\n"); // правило, которого нет у клиента
  gitInit(tpl);
}

function buildClient(dir) {
  w(dir, ".claude/scripts/keep.mjs", "// keep v1\n");          // unchanged
  w(dir, ".claude/scripts/changed.mjs", "// OLD in client\n"); // modified
  w(dir, ".claude/scripts/stale.mjs", "// will be deleted\n"); // deleted (нет в шаблоне)
  w(dir, ".claude/agents/a.md", "agent a\n");                  // unchanged
  w(dir, ".claude/CLAUDE.md", "CLIENT claude md\n");           // differs
  w(dir, "package.json", JSON.stringify({ name: "cli", dependencies: { foo: "^1.0.0" } }, null, 2) + "\n");
  w(dir, ".gitignore", "node_modules/\n");                    // старый gitignore без data/_index.json
  w(dir, "data/_index.json", "{}\n");                          // закоммичен (как у старых клиентов до ADR-013)
  // имитируем рабочую папку клиента, которую синк не должен трогать
  w(dir, "articles/001-x/meta.json", JSON.stringify({ state: "completed" }) + "\n");
  gitInit(dir);
}

// === Reset sandbox ===
if (existsSync(sandbox)) rmSync(sandbox, { recursive: true, force: true });
mkdirSync(sandbox, { recursive: true });

console.log("=== sync-from-template.mjs smoke ===");
console.log("Sandbox: " + sandbox);
console.log("");

buildTemplate();
buildClient(client);

// === 1. dry-run ===
await step("dry-run: верно считает added/modified/deleted", () => {
  const r = runEngine(["--template", tpl, "--target", client, "--json"]);
  if (!r.json) return `нет JSON: ${r.stdout.slice(0, 200)} | ${r.stderr.slice(0, 200)}`;
  if (r.json.status !== "pending") return `status=${r.json.status} (ожидал pending)`;
  const s = r.json.dirs.scripts;
  if (!s.added.includes("new.mjs")) return `added не содержит new.mjs: ${JSON.stringify(s.added)}`;
  if (!s.modified.includes("changed.mjs")) return `modified не содержит changed.mjs: ${JSON.stringify(s.modified)}`;
  if (!s.deleted.includes("stale.mjs")) return `deleted не содержит stale.mjs: ${JSON.stringify(s.deleted)}`;
  return true;
});

await step("dry-run: видит package/CLAUDE.md/миграции", () => {
  const r = runEngine(["--template", tpl, "--target", client, "--json"]);
  if (!r.json.package.changed) return "package.changed=false";
  if (!r.json.package.needsNpmInstall) return "needsNpmInstall=false (deps отличаются)";
  if (!r.json.claudemd_differs) return "claudemd_differs=false";
  if (!r.json.migrations.pending.includes("001-test")) return `pending миграции: ${JSON.stringify(r.json.migrations.pending)}`;
  return true;
});

await step("dry-run: НИЧЕГО не пишет в target", () => {
  if (existsSync(join(client, ".claude/scripts/new.mjs"))) return "new.mjs появился в dry-run";
  if (!existsSync(join(client, ".claude/scripts/stale.mjs"))) return "stale.mjs удалён в dry-run";
  if (existsSync(join(client, ".claude/.machinery-version"))) return ".machinery-version создан в dry-run";
  if (existsSync(join(client, "migrated.txt"))) return "миграция выполнилась в dry-run";
  return true;
});

// === 2. apply ===
await step("apply: статус applied + коммит", () => {
  const r = runEngine(["--template", tpl, "--target", client, "--apply", "--json"]);
  if (!r.json) return `нет JSON: ${r.stdout.slice(0, 200)}`;
  if (r.json.status !== "applied") return `status=${r.json.status}`;
  if (!r.json.committed) return "committed=false";
  return true;
});

await step("apply: зеркалит файлы (add/modify/delete)", () => {
  if (!existsSync(join(client, ".claude/scripts/new.mjs"))) return "new.mjs не скопирован";
  if (existsSync(join(client, ".claude/scripts/stale.mjs"))) return "stale.mjs не удалён";
  const changed = readFileSync(join(client, ".claude/scripts/changed.mjs"), "utf8");
  if (!changed.includes("CHANGED in template")) return "changed.mjs не обновлён";
  return true;
});

await step("apply: пишет .machinery-version с commit шаблона", () => {
  const v = JSON.parse(readFileSync(join(client, ".claude/.machinery-version"), "utf8"));
  const tplHead = sh("git", ["rev-parse", "HEAD"], tpl).out.trim();
  if (v.template_commit !== tplHead) return `version.template_commit=${v.template_commit} != tplHead=${tplHead}`;
  return true;
});

await step("apply: миграция выполнена и журналирована", () => {
  if (!existsSync(join(client, "migrated.txt"))) return "migrated.txt не создан (миграция не отработала)";
  const log = JSON.parse(readFileSync(join(client, ".claude/.migrations-applied.json"), "utf8"));
  const ids = (log.applied || []).map((m) => (typeof m === "string" ? m : m.id));
  if (!ids.includes("001-test")) return `журнал не содержит 001-test: ${JSON.stringify(ids)}`;
  return true;
});

await step("apply: .gitignore синкается из шаблона", () => {
  const gi = readFileSync(join(client, ".gitignore"), "utf8");
  if (!gi.includes("data/_index.json")) return ".gitignore не обновлён правилом из шаблона";
  return true;
});

await step("apply: rm --cached игнорируемого файла НЕ откатывается (регресс mansband)", () => {
  // data/_index.json был tracked; новый .gitignore его игнорирует; миграция вывела из индекса.
  // Баг был: staging возвращал untracked файл обратно. Должен остаться вне индекса.
  const tracked = sh("git", ["ls-files", "--", "data/_index.json"], client).out.trim();
  if (tracked) return `data/_index.json всё ещё в индексе: "${tracked}" (баг вернулся)`;
  if (!existsSync(join(client, "data/_index.json"))) return "файл-кеш data/_index.json пропал с диска";
  return true;
});

await step("apply: клиентская рабочая папка не тронута", () => {
  if (!existsSync(join(client, "articles/001-x/meta.json"))) return "articles/001-x/meta.json пропал";
  return true;
});

await step("apply: дерево после синка чистое (всё закоммичено)", () => {
  const st = sh("git", ["status", "--porcelain"], client).out.trim();
  if (st) return `остались незакоммиченные изменения:\n${st}`;
  return true;
});

// === 3. идемпотентность ===
await step("повторный apply: up-to-date (нет лишних коммитов)", () => {
  const before = sh("git", ["rev-list", "--count", "HEAD"], client).out.trim();
  const r = runEngine(["--template", tpl, "--target", client, "--apply", "--json"]);
  if (r.json.status !== "up-to-date") return `status=${r.json.status} (ожидал up-to-date)`;
  const after = sh("git", ["rev-list", "--count", "HEAD"], client).out.trim();
  if (before !== after) return `создан лишний коммит: ${before} -> ${after}`;
  return true;
});

// === 4. --no-delete ===
await step("--no-delete: лишние файлы не удаляются", () => {
  buildClient(client2);
  const r = runEngine(["--template", tpl, "--target", client2, "--apply", "--no-delete", "--json"]);
  if (r.json.status !== "applied") return `status=${r.json.status}`;
  if (!existsSync(join(client2, ".claude/scripts/stale.mjs"))) return "stale.mjs удалён, хотя --no-delete";
  if (!existsSync(join(client2, ".claude/scripts/new.mjs"))) return "new.mjs не добавлен";
  return true;
});

// === 5. защита: самосинк и worktree-таргет ===
await step("отказ при template == target", () => {
  const r = runEngine(["--template", tpl, "--target", tpl, "--json"]);
  if (r.json.status !== "error") return `status=${r.json.status} (ожидал error)`;
  return true;
});

// === Финал ===
console.log("");
const passed = results.filter((r) => r.ok).length;
console.log(`=== ${passed}/${results.length} tests passed ===`);
if (failed > 0) {
  console.log("\nFailed:");
  for (const r of results.filter((r) => !r.ok)) console.log(`  - ${r.name}: ${r.err}`);
  process.exit(1);
}
rmSync(sandbox, { recursive: true, force: true });
process.exit(0);
