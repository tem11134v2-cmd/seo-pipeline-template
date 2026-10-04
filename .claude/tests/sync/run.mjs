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
// Р8 (раздел 7): CLAUDE.md клиента на прежней версии шаблона обновляется и входит в коммит синка, клиентская правка
// (и незакоммиченная) и незакоммиченный CLAUDE.md шаблона - нет, предупреждение проходит фильтр /sync-all.
// Р9 (раздел 8): синк, который удаляет скил с незавершенной задачей (main и живые worktree), - отказ целиком.
//
// Exit 0 - всё ок. Exit 1 - хоть один тест упал.

import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, mkdtempSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
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

// Кириллица в путях (первый синк на клиента, 2026-09-23): без core.quotepath=false git отдавал пути
// восьмеричными escape-последовательностями, `git add` падал и коммит синка молча пропускался.
await step("apply: кириллические пути - файл машинерии в коммите, грязные файлы клиента не тронуты", () => {
  const tpl3 = join(sandbox, "template3"), client3 = join(sandbox, "client3");
  w(tpl3, ".claude/scripts/keep.mjs", "// keep v1\n");
  w(tpl3, ".claude/skills/s/SKILL.md", "skill s\n");
  w(tpl3, ".claude/skills/s/ЗАМЕТКА.md", "заметка шаблона\n");
  w(tpl3, ".gitignore", "node_modules/\n");
  gitInit(tpl3);
  w(client3, ".claude/scripts/keep.mjs", "// keep v1\n");
  w(client3, ".claude/skills/s/SKILL.md", "skill s\n"); // папка уже есть: новый файл идет в status отдельной строкой
  w(client3, ".gitignore", "node_modules/\n");
  w(client3, "analyses/001-x/ВВОДНЫЕ.md", "вводные v1\n");
  gitInit(client3);
  w(client3, "analyses/001-x/ВВОДНЫЕ.md", "вводные v2 - правка клиента до синка\n"); // грязный tracked
  w(client3, "analyses/001-x/ОТВЕТЫ.md", "ответы\n");                             // untracked
  const r = runEngine(["--template", tpl3, "--target", client3, "--apply", "--json"]);
  if (!r.json || r.json.status !== "applied") return `status ${r.json && r.json.status}: ${r.stdout}${r.stderr}`;
  if (!r.json.committed) return `коммит не сделан: ${JSON.stringify(r.json.warnings)}`;
  const files = sh("git", ["-c", "core.quotepath=false", "show", "--name-only", "--format=", "HEAD"], client3).out;
  if (!files.includes(".claude/skills/s/ЗАМЕТКА.md")) return `ЗАМЕТКА.md не в коммите: ${files}`;
  if (/ВВОДНЫЕ|ОТВЕТЫ/.test(files)) return `в коммит синка попали файлы клиента: ${files}`;
  const st = sh("git", ["-c", "core.quotepath=false", "status", "--porcelain"], client3).out;
  if (!/ВВОДНЫЕ\.md/.test(st) || !/ОТВЕТЫ\.md/.test(st)) return `грязные файлы клиента пропали из status: ${st}`;
  return true;
});

// === 6. признак worktree: настоящие пути, а не строки ===
// Клиент во временной папке ОС (на Windows путь с коротким именем вида ADMINI~1): git отдает длинный путь, а
// resolve(dir, ".git") - короткий; движок ложно отказывал «target - это worktree» (раздел 7 набора site-tekst).
const tmpClient = mkdtempSync(join(tmpdir(), "sync-tmp-client-"));
await step("клиент во временной папке ОС (короткий путь): синк проходит, не «worktree»", () => {
  buildClient(tmpClient);
  const r = runEngine(["--template", tpl, "--target", tmpClient, "--apply", "--no-migrations", "--json"]);
  if (!r.json) return `нет JSON: ${r.stdout.slice(0, 200)} | ${r.stderr.slice(0, 200)}`;
  if (r.json.status !== "applied") return `status=${r.json.status}: ${r.json.error || ""}`;
  return existsSync(join(tmpClient, ".claude/scripts/new.mjs")) || "new.mjs не скопирован";
});
rmSync(tmpClient, { recursive: true, force: true });

await step("настоящая worktree (git worktree add) как target - отказ «target - это worktree»", () => {
  const wt = join(sandbox, "client-wt");
  const add = sh("git", ["worktree", "add", "-q", "-b", "sync-wt-test", wt], client);
  if (add.code !== 0) return `git worktree add: ${add.out}`;
  try {
    const r = runEngine(["--template", tpl, "--target", wt, "--json"]);
    if (!r.json) return `нет JSON: ${r.stdout.slice(0, 200)}`;
    if (r.json.status !== "error" || !/worktree/.test(r.json.error || "")) return `status=${r.json.status}: ${r.json.error || ""}`;
    return true;
  } finally {
    sh("git", ["worktree", "remove", "--force", wt], client);
    sh("git", ["branch", "-D", "sync-wt-test"], client);
  }
});

// === 7. CLAUDE.md клиента (Р8): обновляется, только если он равен одной из версий шаблона ===
// Шаблон с двумя закоммиченными версиями CLAUDE.md; клиенты: старая версия, своя правка, незакоммиченная правка.
// Фильтр предупреждений родительского /sync-all (его не трогаем): строка видна, только если проходит эту регулярку.
const SYNC_ALL_WARN = /origin|не закоммичена|кастом/i;
const tplC = join(sandbox, "template-cm");
const CM1 = "# CLAUDE v1 шаблона\n/seo-tekst - тексты\n", CM2 = "# CLAUDE v2 шаблона\n/site-tekst - тексты\n";
function buildTemplateCm() {
  w(tplC, ".claude/scripts/keep.mjs", "// keep v1\n");
  w(tplC, ".claude/skills/s/SKILL.md", "skill s\n");
  w(tplC, ".claude/CLAUDE.md", CM1);
  w(tplC, ".gitignore", "node_modules/\n");
  gitInit(tplC);
  w(tplC, ".claude/CLAUDE.md", CM2);
  sh("git", ["commit", "-q", "-am", "CLAUDE v2"], tplC);
}
function buildClientCm(dir, claudeMd) {
  w(dir, ".claude/scripts/keep.mjs", "// keep v1\n");
  w(dir, ".claude/skills/s/SKILL.md", "skill s\n");
  if (claudeMd !== null) w(dir, ".claude/CLAUDE.md", claudeMd);
  w(dir, ".gitignore", "node_modules/\n");
  gitInit(dir);
}
const readCm = (dir) => readFileSync(join(dir, ".claude/CLAUDE.md"), "utf8");
buildTemplateCm();

await step("Р8 dry-run: клиент на прежней версии шаблона - claudemd updated, в summary.modified и files, файл не тронут", () => {
  const c = join(sandbox, "cm-old");
  buildClientCm(c, CM1);
  const r = runEngine(["--template", tplC, "--target", c, "--json"]);
  if (!r.json) return `нет JSON: ${r.stdout.slice(0, 200)} ${r.stderr.slice(0, 200)}`;
  if (r.json.claudemd !== "updated") return `claudemd=${r.json.claudemd}`;
  if (!r.json.files[".claude/CLAUDE.md"] || !r.json.files[".claude/CLAUDE.md"].changed) return `files: ${JSON.stringify(r.json.files)}`;
  if (r.json.summary.modified < 1) return `summary: ${JSON.stringify(r.json.summary)}`;
  return readCm(c) === CM1 || "dry-run изменил CLAUDE.md";
});

await step("Р8 apply: CLAUDE.md = HEAD шаблона и вошел в коммит синка, дерево чистое; повтор - up-to-date, same", () => {
  const c = join(sandbox, "cm-old");
  const r = runEngine(["--template", tplC, "--target", c, "--apply", "--no-migrations", "--json"]);
  if (!r.json || r.json.status !== "applied" || !r.json.committed) return `status ${r.json && r.json.status}: ${r.stdout.slice(0, 300)}`;
  if (readCm(c) !== CM2) return `CLAUDE.md не обновлен: ${JSON.stringify(readCm(c))}`;
  const files = sh("git", ["show", "--name-only", "--format=", "HEAD"], c).out;
  if (!files.includes(".claude/CLAUDE.md")) return `CLAUDE.md не в коммите синка: ${files}`;
  const st = sh("git", ["status", "--porcelain"], c).out.trim();
  if (st) return `дерево не чистое: ${st}`;
  const again = runEngine(["--template", tplC, "--target", c, "--apply", "--json"]);
  return (again.json && again.json.status === "up-to-date" && again.json.claudemd === "same") || `повтор: ${again.json && again.json.status}/${again.json && again.json.claudemd}`;
});

await step("Р8: машинерия актуальна, CLAUDE.md старый - синку есть что делать (не up-to-date)", () => {
  const c = join(sandbox, "cm-old");
  w(c, ".claude/CLAUDE.md", CM1);
  sh("git", ["commit", "-q", "-am", "вернули старую версию"], c);
  const r = runEngine(["--template", tplC, "--target", c, "--json"]);
  return (r.json && r.json.status === "pending" && r.json.claudemd === "updated" && r.json.summary.added === 0) || `status ${r.json && r.json.status}/${r.json && r.json.claudemd}`;
});

await step("Р8: клиентская правка CLAUDE.md не тронута, предупреждение проходит фильтр /sync-all", () => {
  const c = join(sandbox, "cm-custom");
  buildClientCm(c, CM1 + "\n## Пометка клиента\n");
  const r = runEngine(["--template", tplC, "--target", c, "--apply", "--no-migrations", "--json"]);
  if (!r.json || r.json.status !== "applied") return `status ${r.json && r.json.status}: ${(r.json && r.json.error) || r.stdout.slice(0, 200)}`;
  if (r.json.claudemd !== "customized") return `claudemd=${r.json.claudemd}`;
  if (readCm(c) !== CM1 + "\n## Пометка клиента\n") return "CLAUDE.md с правкой клиента перезаписан";
  const wline = (r.json.warnings || []).find((x) => /CLAUDE\.md/.test(x));
  return (!!wline && SYNC_ALL_WARN.test(wline) && /вручную/.test(wline)) || `warnings: ${JSON.stringify(r.json.warnings)}`;
});

await step("Р8: незакоммиченная правка клиента на старой версии - кастомная, файл не тронут", () => {
  const c = join(sandbox, "cm-dirty");
  buildClientCm(c, CM1);
  w(c, ".claude/CLAUDE.md", CM1 + "правка в работе\n");
  const r = runEngine(["--template", tplC, "--target", c, "--apply", "--no-migrations", "--json"]);
  if (!r.json || r.json.claudemd !== "customized") return `claudemd=${r.json && r.json.claudemd}`;
  return readCm(c) === CM1 + "правка в работе\n" || "незакоммиченная правка затерта";
});

await step("Р8: CLAUDE.md шаблона не закоммичен - клиентский не обновляется, предупреждение «не закоммичена»", () => {
  const c = join(sandbox, "cm-stale");
  buildClientCm(c, CM1);
  w(tplC, ".claude/CLAUDE.md", CM2 + "черновик шаблона\n");
  try {
    const r = runEngine(["--template", tplC, "--target", c, "--apply", "--no-migrations", "--json"]);
    if (!r.json || r.json.claudemd !== "stale") return `claudemd=${r.json && r.json.claudemd}`;
    if (readCm(c) !== CM1) return "раскатана незакоммиченная версия шаблона";
    const wline = (r.json.warnings || []).find((x) => /CLAUDE\.md/.test(x));
    return (!!wline && SYNC_ALL_WARN.test(wline)) || `warnings: ${JSON.stringify(r.json.warnings)}`;
  } finally {
    w(tplC, ".claude/CLAUDE.md", CM2);
  }
});

// === 8. Р9: синк не удаляет скил, у которого есть незавершенная задача ===
// Шаблон без выведенных скилов seo-tekst и seo-analiz; у клиента они есть вместе с задачами v7.
const tplR = join(sandbox, "template-r9");
w(tplR, ".claude/scripts/keep.mjs", "// keep v1\n");
w(tplR, ".claude/skills/site-tekst/SKILL.md", "site-tekst\n");
w(tplR, ".gitignore", "node_modules/\n");
gitInit(tplR);
function buildClientR9(dir, tasks) {
  w(dir, ".claude/scripts/keep.mjs", "// keep v1\n");
  w(dir, ".claude/skills/site-tekst/SKILL.md", "site-tekst\n");
  w(dir, ".claude/skills/seo-tekst/SKILL.md", "seo-tekst v7\n");
  w(dir, ".claude/skills/seo-analiz/SKILL.md", "seo-analiz v7\n");
  w(dir, ".gitignore", "node_modules/\n");
  for (const [rel, meta] of Object.entries(tasks)) w(dir, `${rel}/meta.json`, JSON.stringify(meta) + "\n");
  gitInit(dir);
}

await step("Р9 dry-run: незавершенная задача v7 - status error с перечнем, ничего не записано", () => {
  const c = join(sandbox, "r9-open");
  buildClientR9(c, { "texts/001-a": { state: "tone-shared", format: "v7" }, "texts/002-b": { state: "completed" }, "texts/003-v9": { format: "v9", state: "init" },
    "analyses/001-x": { state: "approved" }, "analyses/002-y": { state: "client-review" }, "analyses/003-z": { state: "cancelled - заменен /site-analiz" } });
  const r = runEngine(["--template", tplR, "--target", c, "--json"]);
  if (!r.json || r.json.status !== "error") return `status ${r.json && r.json.status}`;
  const e = r.json.error || "";
  if (!/незавершенная задача texts\/001-a скила seo-tekst/.test(e) || !/незавершенная задача analyses\/002-y скила seo-analiz/.test(e)) return `error: ${e}`;
  if (/texts\/002-b|texts\/003-v9|analyses\/001-x|analyses\/003-z/.test(e)) return `в перечне завершенные или v9: ${e}`;
  if (!existsSync(join(c, ".claude/skills/seo-tekst/SKILL.md")) || existsSync(join(c, ".claude/.machinery-version"))) return "dry-run что-то записал";
  return true;
});

await step("Р9 --apply и --apply --force: тот же отказ до копирования; --no-delete - синк без удалений и без отказа", () => {
  const c = join(sandbox, "r9-open");
  for (const extra of [[], ["--force"]]) {
    const r = runEngine(["--template", tplR, "--target", c, "--apply", ...extra, "--json"]);
    if (!r.json || r.json.status !== "error" || !/незавершенная задача/.test(r.json.error || "")) return `${extra.join(" ") || "--apply"}: ${r.json && r.json.status}`;
    if (!existsSync(join(c, ".claude/skills/seo-tekst/SKILL.md")) || existsSync(join(c, ".claude/.machinery-version"))) return `${extra.join(" ") || "--apply"}: синк успел что-то сделать`;
  }
  const nd = runEngine(["--template", tplR, "--target", c, "--apply", "--no-delete", "--no-migrations", "--json"]);
  if (!nd.json || nd.json.status !== "applied") return `--no-delete: ${nd.json && nd.json.status} ${nd.json && nd.json.error}`;
  return existsSync(join(c, ".claude/skills/seo-tekst/SKILL.md")) || "--no-delete удалил seo-tekst";
});

await step("Р9: все задачи завершены (completed, cancelled*, analyses approved) - синк удаляет скилы v7", () => {
  const c = join(sandbox, "r9-done");
  buildClientR9(c, { "texts/001-a": { state: "completed" }, "texts/002-b": { state: "cancelled" }, "analyses/001-x": { state: "approved" }, "analyses/002-y": { state: "finalized" } });
  const r = runEngine(["--template", tplR, "--target", c, "--apply", "--no-migrations", "--json"]);
  if (!r.json || r.json.status !== "applied") return `status ${r.json && r.json.status}: ${r.json && r.json.error}`;
  return (!existsSync(join(c, ".claude/skills/seo-tekst/SKILL.md")) && !existsSync(join(c, ".claude/skills/seo-analiz/SKILL.md"))) || "скилы v7 не удалены";
});

await step("Р9: meta без state и texts v7 approved - незавершенные; задача в живой worktree - в перечне", () => {
  const c = join(sandbox, "r9-wt");
  buildClientR9(c, { "texts/001-a": { format: "v7" }, "texts/002-b": { state: "approved" } });
  const e1 = (runEngine(["--template", tplR, "--target", c, "--json"]).json || {}).error || "";
  if (!/texts\/001-a скила seo-tekst \(state без state\)/.test(e1) || !/texts\/002-b скила seo-tekst/.test(e1)) return `без state / approved v7: ${e1}`;
  // main чистый: задачи закрыты; незавершенная задача живет только в ветке живой worktree
  w(c, "texts/001-a/meta.json", JSON.stringify({ state: "completed" }) + "\n");
  w(c, "texts/002-b/meta.json", JSON.stringify({ state: "completed" }) + "\n");
  sh("git", ["commit", "-q", "-am", "закрыты"], c);
  const wt = join(sandbox, "r9-wt-branch");
  const add = sh("git", ["worktree", "add", "-q", "-b", "r9-task", wt], c);
  if (add.code !== 0) return `git worktree add: ${add.out}`;
  try {
    w(wt, "texts/004-d/meta.json", JSON.stringify({ state: "init", format: "v7" }) + "\n");
    const r = runEngine(["--template", tplR, "--target", c, "--json"]);
    const e = (r.json && r.json.error) || "";
    return (r.json && r.json.status === "error" && /texts\/004-d скила seo-tekst/.test(e) && !/texts\/001-a/.test(e)) || `status ${r.json && r.json.status}: ${e}`;
  } finally {
    sh("git", ["worktree", "remove", "--force", wt], c);
    sh("git", ["branch", "-D", "r9-task"], c);
  }
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
