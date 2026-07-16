#!/usr/bin/env node
// run.mjs - регрессионный тест-набор стилевых правил проекта (буква ё / тире).
// Запуск: .claude\scripts\_node.cmd .claude\tests\style\run.mjs
//
// Проект запрещает букву ё во ВСЕХ клиентских текстах и метатегах (наравне с
// длинным/средним тире). Правило держится на двух рубежах:
//   1. verify-* скрипты и SubagentStop-хук check-section.sh - БЛОКИРУЮТ на ё;
//   2. build-*/render-*/assemble-* сборщики docx/html/md - НОРМАЛИЗУЮТ ё->е.
// Этот набор ловит регресс, если кто-то удалит проверку или нормализацию.
//
// Состав:
//   1. Функциональные: фикстура с ё -> verify-article-metatags.mjs / verify-copy.mjs
//      / check-section.sh дают блокирующее нарушение (exit 2).
//   2. Контроль обратного: та же фикстура без ё и без тире -> те же проверки
//      проходят без нарушений (exit 0), т.е. нет ложных срабатываний.
//   3. Дрейф-гарды (дёшево): паттерн [ёЁ] присутствует в verify-скриптах,
//      а нормализация ё->е (/ё/g) - в сборщиках. Ловит «тихое» удаление.
//
// Хук check-section.sh требует sh/bash. Если оболочка недоступна - шаги 5-6
// помечаются SKIP и НЕ валят набор.
//
// Exit 0 - все тесты прошли. Exit 1 - есть провал.

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "../../..");
const SCRIPTS = join(PROJECT_ROOT, ".claude/scripts");
const HOOKS = join(PROJECT_ROOT, ".claude/hooks");
const NODE_CMD = join(SCRIPTS, "_node.cmd");
const SANDBOX = join(PROJECT_ROOT, ".claude/tmp/style-test");

// === Мини-фреймворк ===
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

// Запуск .mjs-скрипта через враппер _node.cmd; возвращает {code, out}. Не бросает
// на ненулевом коде (нам нужны exit 2).
function runNode(script, ...args) {
  const r = spawnSync(NODE_CMD, [join(SCRIPTS, script), ...args], {
    cwd: PROJECT_ROOT,
    encoding: "utf8",
    shell: true,
  });
  return { code: r.status, out: (r.stdout || "") + (r.stderr || "") };
}

function writeJson(p, obj) {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(obj, null, 2));
}

function toUnix(p) {
  return p.split("\\").join("/");
}

// Поиск рабочей sh/bash (для хука check-section.sh). null - недоступна.
function findSh() {
  for (const bin of ["bash", "sh"]) {
    const r = spawnSync(bin, ["-c", "exit 0"], { encoding: "utf8" });
    if (!r.error && r.status === 0) return bin;
  }
  return null;
}

// === Песочница ===
console.log("=== style (буква ё / тире) regression ===");
console.log(`Sandbox: ${SANDBOX}`);
if (existsSync(SANDBOX)) rmSync(SANDBOX, { recursive: true, force: true });
mkdirSync(SANDBOX, { recursive: true });

// ──────────────────────────────────────────────────────────────────────────
// Фикстуры. Пары «clean»/«yo» различаются РОВНО одной буквой (надежно/надёжно),
// чтобы регресс-сигнал был чистым: exit-код флипается только из-за ё.
// ──────────────────────────────────────────────────────────────────────────

// -- метатеги статьи (verify-article-metatags.mjs ждёт <dir>/metatags.json) --
const mtClean = {
  h1: "Ремонт квартир под ключ в Москве",
  title: "Ремонт квартир под ключ - цены и сроки работ",
  description:
    "Делаем ремонт квартир под ключ в Москве. Смета за один день, гарантия три года, свои мастера без посредников. Звоните нам.",
  announce: "Ремонт квартир под ключ с гарантией. Расскажем про надежные этапы работ и стоимость услуги.",
};
const mtYo = { ...mtClean, announce: mtClean.announce.replace("надежные", "надёжные") };

const mtCleanDir = join(SANDBOX, "mt-clean");
const mtYoDir = join(SANDBOX, "mt-yo");
writeJson(join(mtCleanDir, "metatags.json"), mtClean);
writeJson(join(mtYoDir, "metatags.json"), mtYo);

// -- копи страницы (verify-copy.mjs ждёт <dir>/page.json) --
const pageClean = {
  page: {
    slug: "remont-kvartir",
    description: "Ремонт квартир под ключ в Москве. Смета за день, гарантия три года.",
  },
  h1: "Ремонт квартир под ключ",
  blocks: [
    { fragment: "hero", slots: { h1: "Ремонт квартир под ключ", sub: "Смета за день, гарантия три года" } },
    { h2: "Что входит в работы", slots: { text: "Делаем надежно и быстро, свои мастера без посредников." } },
  ],
};
const pageYo = JSON.parse(JSON.stringify(pageClean));
pageYo.blocks[1].slots.text = pageClean.blocks[1].slots.text.replace("надежно", "надёжно");

const copyCleanDir = join(SANDBOX, "copy-clean");
const copyYoDir = join(SANDBOX, "copy-yo");
writeJson(join(copyCleanDir, "page.json"), pageClean);
writeJson(join(copyYoDir, "page.json"), pageYo);

// ──────────────────────────────────────────────────────────────────────────
// 1-2. verify-article-metatags.mjs
// ──────────────────────────────────────────────────────────────────────────

step("verify-article-metatags: ё в Анонсе -> exit 2 + сообщает про ё", () => {
  const r = runNode("verify-article-metatags.mjs", mtYoDir);
  if (r.code !== 2) return `exit ${r.code} (expect 2)`;
  if (!/буква ё/.test(r.out)) return "ё не назван в нарушениях";
  return true;
});

step("verify-article-metatags: та же фикстура без ё -> exit 0 (нет ложных)", () => {
  const r = runNode("verify-article-metatags.mjs", mtCleanDir);
  if (r.code !== 0) return `exit ${r.code} (expect 0): ${r.out.slice(-200)}`;
  return true;
});

// ──────────────────────────────────────────────────────────────────────────
// 3-4. verify-copy.mjs
// ──────────────────────────────────────────────────────────────────────────

step("verify-copy: ё в тексте блока -> exit 2 + сообщает про ё", () => {
  const r = runNode("verify-copy.mjs", copyYoDir);
  if (r.code !== 2) return `exit ${r.code} (expect 2)`;
  if (!/буква ё/.test(r.out)) return "ё не назван в нарушениях";
  return true;
});

step("verify-copy: та же фикстура без ё -> exit 0 (нет ложных)", () => {
  const r = runNode("verify-copy.mjs", copyCleanDir);
  if (r.code !== 0) return `exit ${r.code} (expect 0): ${r.out.slice(-200)}`;
  return true;
});

// ──────────────────────────────────────────────────────────────────────────
// 5-6. hooks/check-section.sh (нужна sh/bash; иначе SKIP)
// Хук берёт PROJECT_ROOT = cwd, читает <root>/.claude/tmp/current-task.txt
// (путь к статье) и последний <article>/sections/*.md. Готовим изолированный
// «root» внутри песочницы, чтобы не задеть реальный .claude/tmp проекта.
// ──────────────────────────────────────────────────────────────────────────

const sh = findSh();
const hookScript = join(HOOKS, "check-section.sh");

function runHook(sectionBody) {
  const hookRoot = join(SANDBOX, "hook-root");
  const articleDir = join(hookRoot, "article");
  const sectionsDir = join(articleDir, "sections");
  const tmpDir = join(hookRoot, ".claude/tmp");
  mkdirSync(sectionsDir, { recursive: true });
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(join(tmpDir, "current-task.txt"), toUnix(articleDir) + "\n");
  writeFileSync(join(sectionsDir, "01-test.md"), sectionBody);
  const r = spawnSync(sh, [hookScript], { cwd: hookRoot, encoding: "utf8" });
  return { code: r.status, out: (r.stdout || "") + (r.stderr || ""), error: r.error };
}

// Ровно один H2, тело различается только буквой надежно/надёжно.
const secClean = "## Раздел про надежность\n\nТекст раздела - делаем надежно и качественно, без тире.\n";
const secYo = secClean.replace("надежно и", "надёжно и");

step("check-section.sh: ё в разделе -> exit 2 + сообщает про ё", () => {
  if (!sh) return "SKIP: sh/bash недоступна";
  const r = runHook(secYo);
  if (r.error) return `sh запуск не удался: ${r.error.code}`;
  if (r.code !== 2) return `exit ${r.code} (expect 2): ${r.out.slice(-200)}`;
  if (!/ё/.test(r.out)) return "ё не назван в нарушениях";
  return true;
});

step("check-section.sh: тот же раздел без ё -> exit 0 (нет ложных)", () => {
  if (!sh) return "SKIP: sh/bash недоступна";
  const r = runHook(secClean);
  if (r.error) return `sh запуск не удался: ${r.error.code}`;
  if (r.code !== 0) return `exit ${r.code} (expect 0): ${r.out.slice(-200)}`;
  return true;
});

// ──────────────────────────────────────────────────────────────────────────
// 7. Дрейф-гарды: проверка ё в verify-скриптах не должна «тихо» исчезнуть.
// ──────────────────────────────────────────────────────────────────────────

const VERIFY_YO = [
  "verify-article-metatags.mjs",
  "verify-copy.mjs",
  "verify-prototype.mjs",
  "verify-faq.mjs",
  "verify-metatags.mjs",
];

function srcOf(script) {
  const p = join(SCRIPTS, script);
  if (!existsSync(p)) return null;
  return readFileSync(p, "utf8");
}

for (const script of VERIFY_YO) {
  step(`drift: ${script} содержит проверку [ёЁ]`, () => {
    const src = srcOf(script);
    if (src == null) return "файл не найден";
    if (!src.includes("[ёЁ]")) return "паттерн [ёЁ] отсутствует - проверка ё удалена?";
    return true;
  });
}

// ──────────────────────────────────────────────────────────────────────────
// 8. Дрейф-гарды: нормализация ё->е в сборщиках docx/html/md.
// ──────────────────────────────────────────────────────────────────────────

const NORMALIZE_YO = [
  "render-audit-md.mjs",
  "build-audit-docx.mjs",
  "build-analysis-docx.mjs",
  "build-faq-docx.mjs",
  "assemble-html.mjs",
  "build-article-docx.mjs",
];

for (const script of NORMALIZE_YO) {
  step(`drift: ${script} нормализует ё (/ё/g)`, () => {
    const src = srcOf(script);
    if (src == null) return "файл не найден";
    if (!src.includes("/ё/g")) return "нормализация /ё/g отсутствует - замена ё->е удалена?";
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
