#!/usr/bin/env node
// sync-from-template.mjs - детерминированный движок синка машинерии шаблона
// на клиентский проект. Раньше синк делался руками по инструкции в SKILL.md
// (git diff + copy + commit на глаз) - теперь это один скрипт с точным отчётом,
// проверками и откатом. Скил /sync-from-template - тонкая обёртка над ним;
// родительский /sync-all зовёт его копию из шаблона с --target по каждому клиенту.
//
// Использование:
//   node sync-from-template.mjs [--template <src>] [--target <dst>] [флаги]
//
//   --template <путь>   источник машинерии (дефолт ~/seo-projects/template-project)
//   --target <путь>     проект, который обновляем (дефолт cwd)
//   --apply             применить (без флага - dry-run, ничего не пишем)
//   --json              машинный вывод (для оркестратора); exit 0 даже при отказе,
//                       статус - внутри JSON (поле "status")
//   --no-delete         не удалять файлы, которых нет в шаблоне (только add+modify)
//   --no-commit         применить файлы, но не коммитить (дефолт - коммитить сам)
//   --no-migrations     не прогонять миграции данных
//   --force             применить даже если дерево машинерии target грязное (опасно)
//
// Что синхронизируется (точное зеркало, идентичное у всех клиентов):
//   .claude/{scripts,agents,skills,hooks,git-hooks,migrations,tests} + package.json + .gitignore + .claude/settings.json
// .claude/CLAUDE.md (Р8): обновляется, только если файл клиента байт в байт равен одной из версий шаблона (git hash-object
//   рабочего файла против блобов `git log --raw` шаблона по этому пути) - значит, клиент его не правил. Копируется версия
//   HEAD шаблона и только когда CLAUDE.md шаблона закоммичен. Иначе не трогается: клиентская правка (в том числе
//   незакоммиченная) - предупреждение «кастомные правки клиента, вручную». В JSON - поле claudemd:
//   same | updated | customized | stale (есть что обновить, но CLAUDE.md шаблона не закоммичен). README.md не синкается.
// Отказ целиком (Р9): синк удаляет SKILL.md скила, у которого в проекте (main и живые worktree) есть незавершенная задача -
//   status error с перечнем «незавершенная задача <путь> скила <имя>», в dry-run и в --apply, до копирования и миграций.
//   --force его не снимает (выход - закрыть задачу решением владельца); с --no-delete удалений нет - и отказа нет.
// Что НЕ трогается: ЗАКАЗЧИК.md, template.html, topics.xlsx, рабочие папки, README.md,
//   .claude/tmp, .claude/handoff-requests, .claude/worktrees.
//
// Exit (без --json): 0 - успех / нечего делать; 1 - ошибка/отказ.

import {
  existsSync, readFileSync, writeFileSync, readdirSync, mkdirSync, rmSync, copyFileSync, statSync, realpathSync,
} from "node:fs";
import { join, resolve, dirname, relative, sep } from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { homedir } from "node:os";

// ──────────────────────────────────────────────────────────────────────────
// Константы
// ──────────────────────────────────────────────────────────────────────────

// Папки-машинерии (относительно .claude/). Точное зеркало шаблона. tests - тоже
// машинерия: движок советует прогнать их после синка для верификации.
const SYNC_DIRS = ["scripts", "agents", "skills", "hooks", "git-hooks", "migrations", "tests"];
// Отдельные файлы машинерии вне папок (единые у всех клиентов):
//  - package.json - зависимости скриптов;
//  - .gitignore   - без актуальных правил (_index.json) миграции данных бессмысленны;
//  - settings.json (в .claude/) - конфигурация хуков Claude Code.
// settings.local.json НЕ синкаем (локальные permissions на машину).
const SYNC_FILES = ["package.json", ".gitignore", ".claude/settings.json"];
// Метаданные (пишем сами, не из шаблона).
const VERSION_FILE = join(".claude", ".machinery-version");
const MIGRATIONS_LOG = join(".claude", ".migrations-applied.json");
// CLAUDE.md проекта (Р8): обновляется, только если клиент его не правил.
const CLAUDE_MD = ".claude/CLAUDE.md";
// Р9: скилы выведенных конвейеров и папки их задач. Синк, который удаляет SKILL.md такого скила при незавершенной задаче,
// отказывает целиком. done - завершенные state (cancelled* - любые варианты отмены); прочие, в том числе meta без state, -
// незавершенные. У seo-tekst v7 approved - промежуточное состояние (перед blueprints-ready), у analyses - финал.
const RETIRED = [
  { skills: ["seo-tekst", "seo-tekst-fix", "share-tekst"], dir: "texts", pick: (m) => m.format !== "v9", done: ["completed", "finalized"] },
  { skills: ["seo-analiz", "share-analysis"], dir: "analyses", pick: () => true, done: ["completed", "finalized", "approved"] },
];

// ──────────────────────────────────────────────────────────────────────────
// Разбор аргументов
// ──────────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const o = {
    template: null, target: null,
    apply: false, json: false, noDelete: false, noCommit: false,
    noMigrations: false, force: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--template") o.template = argv[++i];
    else if (a === "--target") o.target = argv[++i];
    else if (a === "--apply") o.apply = true;
    else if (a === "--json") o.json = true;
    else if (a === "--no-delete") o.noDelete = true;
    else if (a === "--no-commit") o.noCommit = true;
    else if (a === "--no-migrations") o.noMigrations = true;
    else if (a === "--force") o.force = true;
    else if (!a.startsWith("--") && !o.target) o.target = a; // позиционный = target
  }
  return o;
}

// ──────────────────────────────────────────────────────────────────────────
// Git-хелперы (по образцу project-status.mjs)
// ──────────────────────────────────────────────────────────────────────────

// core.quotepath=false: иначе git отдает кириллические пути восьмеричными escape-последовательностями
// («\320\222...»), движок не узнает свои файлы, `git add` падает и коммит синка молча пропускается
// (первый синк на клиента с ВВОДНЫЕ.md, 2026-09-23). Та же правка, что в pre-commit (ADR-003).
function git(cwd, args, { allowFail = true, raw = false } = {}) {
  try {
    const o = execFileSync("git", ["-c", "core.quotepath=false", ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return raw ? o : o.trim();
  } catch (e) {
    if (allowFail) return null;
    throw e;
  }
}

// Записи `git status --porcelain` (raw, без trim): {x,y,path}. X - индекс, Y - рабочее
// дерево. Учитывает переименования (orig -> new).
function parsePorcelain(out) {
  if (!out) return [];
  return out.split("\n").filter(Boolean).map((l) => {
    const x = l[0], y = l[1];
    let s = l.slice(3);
    if (s.includes(" -> ")) s = s.split(" -> ")[1];
    return { x, y, path: s.replace(/^"|"$/g, "") };
  });
}

// Путь для сравнения: настоящий путь ФС (realpath.native раскрывает короткие имена Windows вида ADMINI~1 и
// символические ссылки), разделители - «/», на Windows без учета регистра. Без этого клиент во временной папке
// (os.tmpdir() с коротким именем) ложно считался worktree: git отдает длинный путь, а resolve(dir, ".git") - короткий.
function canonPath(p) {
  let r = resolve(p);
  try { r = realpathSync.native(r); } catch { /* пути нет - сравниваем как есть */ }
  r = r.split(sep).join("/").replace(/\/+$/, "");
  return process.platform === "win32" ? r.toLowerCase() : r;
}

function isMainWorktree(dir) {
  const gd = git(dir, ["rev-parse", "--absolute-git-dir"]);
  // --path-format=absolute (git 2.31+) отдает common-dir абсолютным; старый git - относительный, резолвим от dir.
  let cd = git(dir, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  if (!cd || cd.startsWith("--")) cd = git(dir, ["rev-parse", "--git-common-dir"]);
  if (!gd || !cd) return true; // не git или git недоступен - не блокируем по этому признаку
  return canonPath(gd) === canonPath(resolve(dir, cd));
}

// ──────────────────────────────────────────────────────────────────────────
// Файловые хелперы
// ──────────────────────────────────────────────────────────────────────────

function readJsonSafe(p, fallback) {
  // BOM снимается: PowerShell пишет UTF-8 с BOM (так записаны .machinery-version части клонов и meta.json задач)
  try { return JSON.parse(readFileSync(p, "utf8").replace(/^﻿/, "")); } catch { return fallback; }
}

// Рекурсивный список относительных путей файлов внутри dir (posix-разделители).
function walk(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    for (const ent of readdirSync(cur, { withFileTypes: true })) {
      const full = join(cur, ent.name);
      if (ent.isDirectory()) stack.push(full);
      else if (ent.isFile()) out.push(relative(dir, full).split(sep).join("/"));
    }
  }
  return out;
}

function sameContent(a, b) {
  try {
    const ba = readFileSync(a), bb = readFileSync(b);
    return ba.length === bb.length && ba.equals(bb);
  } catch {
    return false;
  }
}

// Сравнить одну папку шаблон vs target. Возвращает {added,modified,deleted,unchanged}.
function diffDir(srcDir, dstDir) {
  const src = new Set(walk(srcDir));
  const dst = new Set(walk(dstDir));
  const added = [], modified = [], deleted = [], unchanged = [];
  for (const rel of src) {
    if (!dst.has(rel)) added.push(rel);
    else if (sameContent(join(srcDir, rel), join(dstDir, rel))) unchanged.push(rel);
    else modified.push(rel);
  }
  for (const rel of dst) if (!src.has(rel)) deleted.push(rel);
  added.sort(); modified.sort(); deleted.sort();
  return { added, modified, deleted, unchanged };
}

function copyInto(srcDir, dstDir, rel) {
  const dstFile = join(dstDir, rel);
  mkdirSync(dirname(dstFile), { recursive: true });
  copyFileSync(join(srcDir, rel), dstFile);
}

// ──────────────────────────────────────────────────────────────────────────
// Р8: CLAUDE.md клиента против истории шаблона
// ──────────────────────────────────────────────────────────────────────────

// Блобы всех версий файла в истории шаблона - одной командой (`git log --raw`: «:mode mode <old> <new> M\tpath»).
function templateBlobs(template, rel) {
  const out = git(template, ["log", "--no-abbrev", "--raw", "--format=", "--", rel], { raw: true }) || "";
  const set = new Set();
  for (const line of out.split("\n")) {
    const m = line.match(/^:\d+ \d+ ([0-9a-f]{40}) ([0-9a-f]{40}) /);
    if (!m) continue;
    for (const b of [m[1], m[2]]) if (!/^0+$/.test(b)) set.add(b);
  }
  return set;
}

// same - как в HEAD шаблона; updated - клиент на одной из прежних версий шаблона (обновляется); customized - клиентская
// правка (нет среди версий шаблона, или правка не закоммичена) - не трогаем; stale - обновить есть что, но CLAUDE.md
// шаблона не закоммичен (раскатилась бы версия, которой нет в истории, и клиент навсегда стал бы «кастомным»).
function claudeMdState(template, target, tplDirty) {
  const tplHeadBlob = git(template, ["rev-parse", `HEAD:${CLAUDE_MD}`]);
  if (!tplHeadBlob || !/^[0-9a-f]{40}$/.test(tplHeadBlob)) return { state: "same", why: "в шаблоне нет закоммиченного CLAUDE.md" };
  const dst = join(target, CLAUDE_MD);
  const blob = existsSync(dst) ? git(target, ["hash-object", "--", CLAUDE_MD]) : "";
  if (blob === tplHeadBlob) return { state: "same", tplHeadBlob };
  const clientDirty = existsSync(dst) && !!(git(target, ["status", "--porcelain", "--", CLAUDE_MD]) || "").trim();
  const known = !existsSync(dst) || (!clientDirty && blob && templateBlobs(template, CLAUDE_MD).has(blob));
  if (!known) return { state: "customized", tplHeadBlob, why: clientDirty ? "незакоммиченная правка клиента" : "нет среди версий шаблона" };
  if (tplDirty) return { state: "stale", tplHeadBlob };
  return { state: "updated", tplHeadBlob, missing: !existsSync(dst) };
}

// ──────────────────────────────────────────────────────────────────────────
// Р9: незавершенные задачи скилов, которые синк удалит
// ──────────────────────────────────────────────────────────────────────────

// Корни проекта: main и живые worktree (`git worktree list --porcelain`), только существующие папки.
function projectRoots(target) {
  const roots = [resolve(target)];
  const out = git(target, ["worktree", "list", "--porcelain"]) || "";
  for (const line of out.split("\n")) {
    const m = line.match(/^worktree (.+)$/);
    if (!m) continue;
    const p = resolve(m[1].trim());
    if (existsSync(p) && !roots.some((r) => canonPath(r) === canonPath(p))) roots.push(p);
  }
  return roots;
}

function unfinishedTasks(target, deletedSkills) {
  const hits = [];
  const doomed = RETIRED.filter((r) => r.skills.some((s) => deletedSkills.has(s)));
  if (!doomed.length) return hits;
  const seen = new Set();
  for (const root of projectRoots(target)) {
    for (const r of doomed) {
      const base = join(root, r.dir);
      if (!existsSync(base)) continue;
      let names = [];
      try { names = readdirSync(base, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort(); } catch { continue; }
      for (const n of names) {
        const metaFile = join(base, n, "meta.json");
        if (!existsSync(metaFile)) continue;
        const meta = readJsonSafe(metaFile, {}) || {};
        if (!r.pick(meta)) continue;
        const st = String(meta.state || "").trim();
        if (r.done.includes(st) || /^cancel/i.test(st)) continue;
        const where = relative(target, join(base, n)).split(sep).join("/");
        const shown = where.startsWith("..") ? join(base, n).split(sep).join("/") : where;
        const skill = r.skills.find((s) => deletedSkills.has(s));
        const key = `${canonPath(join(base, n))}|${skill}`;
        if (seen.has(key)) continue;
        seen.add(key);
        hits.push({ path: shown, skill, state: st || "без state" });
      }
    }
  }
  return hits;
}

// ──────────────────────────────────────────────────────────────────────────
// Основная логика
// ──────────────────────────────────────────────────────────────────────────

function resolveTemplate(arg) {
  if (arg) return resolve(arg);
  return resolve(homedir(), "seo-projects", "template-project");
}

function fail(json, msg, extra = {}) {
  if (json) {
    console.log(JSON.stringify({ status: "error", error: msg, ...extra }, null, 2));
    process.exit(0); // оркестратору важен exit 0 + статус в JSON
  }
  console.error("ОШИБКА: " + msg);
  process.exit(1);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const template = resolveTemplate(opts.template);
  const target = resolve(opts.target || process.cwd());
  const J = opts.json;

  // --- Проверки путей ---
  if (!existsSync(join(template, ".claude", "scripts"))) {
    fail(J, `шаблон не найден или без машинерии: ${template}`, { template });
  }
  if (!existsSync(join(target, ".claude"))) {
    fail(J, `target не похож на проект (нет .claude): ${target}`, { target });
  }
  if (canonPath(template) === canonPath(target)) {
    fail(J, "template == target: это и есть шаблон, синкать нечего", { template, target });
  }

  // --- target должен быть main, не worktree ---
  if (!isMainWorktree(target)) {
    fail(J, "target - это worktree, а не main. Синк меняет общие файлы; открой основную папку проекта.", { target });
  }

  const warnings = [];

  // --- Чистота дерева машинерии target ---
  const machineryPaths = [...SYNC_DIRS.map((d) => `.claude/${d}`), ...SYNC_FILES];
  const dirty = git(target, ["status", "--porcelain", "--", ...machineryPaths]) || "";
  const isDirty = dirty.trim().length > 0;
  if (isDirty) {
    const note = "в машинерии target есть несохранённые правки (синк их затрёт): " +
      dirty.split("\n").slice(0, 8).map((l) => l.trim()).join("; ");
    if (opts.apply && !opts.force) {
      fail(J, note + " - закоммить/откати или используй --force", { target, dirty: dirty.split("\n") });
    }
    warnings.push(note);
  }

  // --- Сверка источника истины: template vs его origin (мягко) ---
  const tplHead = git(template, ["rev-parse", "HEAD"]);
  const tplShort = git(template, ["rev-parse", "--short", "HEAD"]) || (tplHead ? tplHead.slice(0, 7) : "unknown");
  const tplDirty = (git(template, ["status", "--porcelain", "--", ...machineryPaths]) || "").trim();
  if (tplDirty) warnings.push("template: машинерия в источнике НЕ закоммичена - метка версии будет неточной (закоммить шаблон)");
  // CLAUDE.md шаблона - в той же проверке грязного источника: копируется только закоммиченная версия (Р8)
  const tplClaudeDirty = !!(git(template, ["status", "--porcelain", "--", CLAUDE_MD]) || "").trim();
  const upstream = git(template, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]);
  if (upstream) {
    const lr = git(template, ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"]);
    if (lr) {
      const [ahead, behind] = lr.split(/\s+/).map(Number);
      if (ahead > 0) warnings.push(`template опережает origin на ${ahead} коммит(ов) - не запушено (новые клоны получат старьё)`);
      if (behind > 0) warnings.push(`template отстаёт от origin на ${behind} коммит(ов) - сделай git pull, иначе раскатаешь устаревшее`);
    }
  }

  // --- Diff по папкам ---
  const dirs = {};
  let nAdded = 0, nModified = 0, nDeleted = 0;
  for (const d of SYNC_DIRS) {
    const res = diffDir(join(template, ".claude", d), join(target, ".claude", d));
    dirs[d] = { added: res.added, modified: res.modified, deleted: res.deleted };
    nAdded += res.added.length; nModified += res.modified.length; nDeleted += res.deleted.length;
  }

  // --- Отдельные файлы машинерии (package.json, .gitignore) ---
  const fileReports = {};
  let anyFileChanged = false;
  for (const f of SYNC_FILES) {
    const sp = join(template, f), dp = join(target, f);
    const changed = existsSync(sp) && (!existsSync(dp) || !sameContent(sp, dp));
    const entry = { changed };
    if (f === "package.json" && changed) {
      const sj = readJsonSafe(sp, {}), dj = readJsonSafe(dp, {});
      const depKey = (j) => JSON.stringify({ d: j.dependencies || {}, dd: j.devDependencies || {} });
      entry.needsNpmInstall = depKey(sj) !== depKey(dj);
    }
    fileReports[f] = entry;
    if (changed) anyFileChanged = true;
  }
  const pkgChanged = !!fileReports["package.json"]?.changed;
  const needsNpmInstall = !!fileReports["package.json"]?.needsNpmInstall;

  // --- Р9: синк не удаляет скил, у которого в проекте есть незавершенная задача (до копирования и миграций) ---
  if (!opts.noDelete) {
    const deletedSkills = new Set(dirs.skills.deleted.filter((f) => /^[^/]+\/SKILL\.md$/.test(f)).map((f) => f.split("/")[0]));
    const open = unfinishedTasks(target, deletedSkills);
    if (open.length) {
      fail(J, "синк удалит скилы с незавершенными задачами - отказ целиком (--force его не снимает; закрой задачи решением " +
        "владельца: state completed или cancelled в meta.json): " +
        open.map((t) => `незавершенная задача ${t.path} скила ${t.skill} (state ${t.state})`).join("; "),
        { target, unfinished: open });
    }
  }

  // --- CLAUDE.md (Р8): обновляется, только если клиент его не правил ---
  const cm = claudeMdState(template, target, tplClaudeDirty);
  const claudemd = cm.state;
  const claudemdDiffers = claudemd !== "same";
  if (claudemd === "customized") warnings.push(`CLAUDE.md: кастомные правки клиента (${cm.why}), не обновлен - вручную (дифф с ${CLAUDE_MD} шаблона)`);
  if (claudemd === "stale") warnings.push(`CLAUDE.md: версия шаблона не закоммичена - CLAUDE.md клиента не обновлен (закоммить шаблон и повтори синк)`);
  if (claudemd === "updated") { nModified++; fileReports[CLAUDE_MD] = { changed: true, ...(cm.missing ? { added: true } : {}) }; }
  else fileReports[CLAUDE_MD] = { changed: false };

  // --- Версия target сейчас ---
  const curVersion = readJsonSafe(join(target, VERSION_FILE), null);
  const curCommit = curVersion?.template_commit || null;

  const filesChanged = nAdded + nModified + (opts.noDelete ? 0 : nDeleted) > 0;
  const versionStale = curCommit !== tplHead;

  // --- Миграции: какие ещё не применены ---
  // Источник миграций: при apply они уже скопированы в target (migrations в SYNC_DIRS);
  // в dry-run читаем из шаблона, чтобы показать, что прилетит.
  const migLog = readJsonSafe(join(target, MIGRATIONS_LOG), { applied: [] });
  const appliedIds = new Set((migLog.applied || []).map((m) => (typeof m === "string" ? m : m.id)));
  const migSrcDir = join(template, ".claude", "migrations"); // одинаков по содержимому после синка
  const allMigrations = walk(migSrcDir).filter((f) => /^\d.*\.mjs$/.test(f)).sort();
  const pendingMigrations = allMigrations
    .map((f) => f.replace(/\.mjs$/, ""))
    .filter((id) => !appliedIds.has(id));

  // Обновление CLAUDE.md (Р8) - тоже дело синка; customized и stale - только предупреждения, в «нечего делать» не входят.
  const nothingToDo = !filesChanged && !anyFileChanged && !versionStale &&
    pendingMigrations.length === 0 && claudemd !== "updated";

  // --- Сборка отчёта ---
  const report = {
    status: nothingToDo ? "up-to-date" : (opts.apply ? "applied" : "pending"),
    mode: opts.apply ? "apply" : "dry-run",
    template, template_commit: tplHead, template_commit_short: tplShort,
    target,
    summary: { added: nAdded, modified: nModified, deleted: nDeleted },
    dirs,
    package: { changed: pkgChanged, needsNpmInstall },
    files: fileReports,
    claudemd,
    claudemd_differs: claudemdDiffers,
    version: { from: curCommit, to: tplHead, stale: versionStale },
    migrations: { pending: pendingMigrations, applied: [] },
    target_dirty: isDirty,
    warnings,
    prev_head: null,
    committed: false,
  };

  // --- Применение ---
  if (opts.apply && !nothingToDo) {
    report.prev_head = git(target, ["rev-parse", "HEAD"]);
    // Снимок «что было грязным ДО синка» - чтобы при коммите забрать ТОЛЬКО наши
    // изменения (файлы машинерии + артефакты миграций), не трогая незакоммиченную
    // клиентскую работу. Машинерия на старте чистая (иначе отказ выше).
    const dirtyBefore = new Set(parsePorcelain(git(target, ["status", "--porcelain"], { raw: true })).map((e) => e.path));

    // 1. Mirror папок
    for (const d of SYNC_DIRS) {
      const srcDir = join(template, ".claude", d), dstDir = join(target, ".claude", d);
      for (const rel of [...dirs[d].added, ...dirs[d].modified]) copyInto(srcDir, dstDir, rel);
      if (!opts.noDelete) {
        for (const rel of dirs[d].deleted) {
          try { rmSync(join(dstDir, rel), { force: true }); } catch { /* ignore */ }
        }
      }
    }

    // 2. Отдельные файлы (package.json, .gitignore) - копируем ДО миграций, чтобы
    //    свежий .gitignore уже действовал (иначе rm --cached не-игнорируемого файла
    //    вернётся обратно при стейджинге артефактов миграций).
    for (const f of SYNC_FILES) {
      if (fileReports[f]?.changed) copyFileSync(join(template, f), join(target, f));
    }
    // CLAUDE.md (Р8): версия HEAD шаблона (блоб, а не рабочий файл - он закоммичен, проверено выше)
    if (claudemd === "updated") {
      const body = git(template, ["cat-file", "blob", cm.tplHeadBlob], { raw: true });
      if (body === null) warnings.push("CLAUDE.md: блоб шаблона не прочитан - не обновлен (не закоммичена - повтори синк)");
      else { mkdirSync(join(target, ".claude"), { recursive: true }); writeFileSync(join(target, CLAUDE_MD), body, "utf8"); }
    }

    // 3. Метка версии
    const versionPayload = {
      template_commit: tplHead,
      template_commit_short: tplShort,
      synced_at: new Date().toISOString(),
      synced_by: "sync-from-template.mjs",
      summary: report.summary,
    };
    mkdirSync(join(target, ".claude"), { recursive: true });
    writeFileSync(join(target, VERSION_FILE), JSON.stringify(versionPayload, null, 2) + "\n", "utf8");

    // 4. Миграции (после копирования файлов, до коммита - чтобы попали в тот же commit)
    if (!opts.noMigrations && pendingMigrations.length) {
      const applied = migLog.applied ? [...migLog.applied] : [];
      for (const id of pendingMigrations) {
        const file = join(target, ".claude", "migrations", id + ".mjs");
        if (!existsSync(file)) continue; // после синка должен существовать
        try {
          const mod = await import(pathToFileURL(file).href);
          const fn = mod.default || mod.up;
          const ctx = {
            targetRoot: target,
            git: (args) => git(target, args),
            log: (m) => { if (!J) console.error(`    [migration ${id}] ${m}`); },
          };
          if (typeof fn === "function") await fn(ctx);
          applied.push({ id, at: new Date().toISOString() });
          report.migrations.applied.push(id);
        } catch (e) {
          warnings.push(`миграция ${id} упала: ${e.message}`);
          break; // не идём дальше по миграциям, чтобы не нарушить порядок
        }
      }
      writeFileSync(join(target, MIGRATIONS_LOG), JSON.stringify({ applied }, null, 2) + "\n", "utf8");
    }

    // 5. Коммит (если не --no-commit и есть что коммитить)
    if (!opts.noCommit) {
      // Берём всё, что появилось/изменилось В РЕЗУЛЬТАТЕ синка (файлы машинерии,
      // .machinery-version, журнал, артефакты миграций), исключая то, что клиент
      // имел незакоммиченным ДО синка. Миграции через `git rm --cached` уже стейджат
      // удаления сами - они тоже попадут как изменения индекса.
      // Стейджим только изменения РАБОЧЕГО ДЕРЕВА (новые/скопированные файлы: Y!=' '
      // или untracked '?'), появившиеся после старта синка. Staged-only изменения от
      // миграций (напр. `git rm --cached` -> "D ") НЕ трогаем, иначе git add вернул бы
      // файл в индекс и отменил миграцию.
      const afterPaths = parsePorcelain(git(target, ["status", "--porcelain"], { raw: true }));
      const ourPaths = afterPaths
        .filter((e) => !dirtyBefore.has(e.path) && (e.x === "?" || e.y !== " "))
        .map((e) => e.path);
      if (ourPaths.length && git(target, ["add", "--", ...ourPaths]) === null) {
        warnings.push(`git add не прошел для ${ourPaths.length} путей (см. git status в target) - коммит синка неполный`);
      }
      const staged = git(target, ["diff", "--cached", "--name-only"]);
      if (staged) {
        const msg = `sync-from-template: машинерия @ ${tplShort} ` +
          `(+${nAdded} ~${nModified} -${opts.noDelete ? 0 : nDeleted}` +
          `${report.migrations.applied.length ? `, миграции: ${report.migrations.applied.join(",")}` : ""})`;
        const res = git(target, ["commit", "-m", msg], { allowFail: true });
        report.committed = res !== null;
        if (report.committed) report.commit = git(target, ["rev-parse", "--short", "HEAD"]);
        else warnings.push("git commit не прошёл (см. git status в target)");
      }
    }
    report.status = "applied";
  }

  report.warnings = warnings;

  // --- Вывод ---
  if (J) {
    console.log(JSON.stringify(report, null, 2));
    process.exit(0);
  }
  printHuman(report, opts);
  process.exit(0);
}

// ──────────────────────────────────────────────────────────────────────────
// Человекочитаемый отчёт
// ──────────────────────────────────────────────────────────────────────────

function dirLine(name, d, noDelete) {
  const a = d.added.length, m = d.modified.length, del = d.deleted.length;
  if (!a && !m && !del) return `  ${name.padEnd(11)} без изменений`;
  const parts = [];
  if (a) parts.push(`+${a} новых`);
  if (m) parts.push(`~${m} изменятся`);
  if (del) parts.push(noDelete ? `(-${del} лишних, не удаляю)` : `-${del} удалятся`);
  return `  ${name.padEnd(11)} ${parts.join(", ")}`;
}

function printHuman(r, opts) {
  const L = [];
  const head = r.mode === "apply" ? "SYNC-FROM-TEMPLATE (applied)" : "SYNC-FROM-TEMPLATE (dry-run)";
  L.push(`=== ${head} ===`);
  L.push(`Шаблон: ${r.template} @ ${r.template_commit_short}`);
  L.push(`Проект: ${r.target}`);
  L.push("");

  if (r.status === "up-to-date") {
    L.push("Машинерия уже актуальна относительно шаблона. Делать нечего.");
    for (const w of r.warnings) L.push(`  ! ${w}`);
    console.log(L.join("\n"));
    return;
  }

  for (const d of SYNC_DIRS) L.push(dirLine(d, r.dirs[d], opts.noDelete));
  if (r.package.changed) L.push(`  package.json изменится${r.package.needsNpmInstall ? " (нужен npm install - изменились зависимости)" : ""}`);
  if (r.files?.[".gitignore"]?.changed) L.push(`  .gitignore изменится`);
  if (r.files?.[".claude/settings.json"]?.changed) L.push(`  .claude/settings.json (хуки) изменится`);
  if (r.claudemd === "updated") L.push(`  CLAUDE.md обновится (у клиента прежняя версия шаблона, правок нет)`);
  else if (r.claudemd === "customized") L.push(`  CLAUDE.md с кастомными правками клиента - не обновляется, дифф вручную`);
  else if (r.claudemd === "stale") L.push(`  CLAUDE.md устарел, но версия шаблона не закоммичена - не обновляется`);
  if (r.version.stale) L.push(`  версия: ${r.version.from ? r.version.from.slice(0, 7) : "нет метки"} -> ${r.template_commit_short}`);
  if (r.migrations.pending.length) L.push(`  миграции к применению: ${r.migrations.pending.join(", ")}`);

  // Детализация удаляемых (важно - это разрушительно)
  const allDeleted = SYNC_DIRS.flatMap((d) => r.dirs[d].deleted.map((f) => `${d}/${f}`));
  if (allDeleted.length && !opts.noDelete) {
    L.push("");
    L.push("Будут УДАЛЕНЫ (есть у проекта, нет в шаблоне):");
    for (const f of allDeleted.slice(0, 20)) L.push(`  - .claude/${f}`);
    if (allDeleted.length > 20) L.push(`  ... и ещё ${allDeleted.length - 20}`);
  }

  if (r.warnings.length) {
    L.push("");
    L.push("Предупреждения:");
    for (const w of r.warnings) L.push(`  ! ${w}`);
  }

  L.push("");
  if (r.mode === "apply") {
    if (r.committed) {
      L.push(`Готово. Коммит: ${r.commit}.  Откат: git reset --hard ${r.prev_head?.slice(0, 7)}`);
      if (r.migrations.applied.length) L.push(`Применены миграции: ${r.migrations.applied.join(", ")}`);
      if (r.package.needsNpmInstall) L.push("Не забудь: npm install (изменились зависимости).");
    } else {
      L.push("Файлы обновлены, но коммит не создан (--no-commit или нечего коммитить).");
    }
  } else {
    L.push("Это dry-run. Запусти с --apply, чтобы применить.");
  }
  console.log(L.join("\n"));
}

main().catch((e) => {
  console.error("FATAL: " + (e.stack || e.message));
  process.exit(1);
});
