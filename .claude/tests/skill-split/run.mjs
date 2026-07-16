#!/usr/bin/env node
// run.mjs - smoke-тест разреза скила seo-statya (пункт 3 спеки Этапа 1):
// SKILL.md (ядро) <-> REFERENCE.md (редкие ветки).
// Запуск: .claude\scripts\_node.cmd .claude\tests\skill-split\run.mjs
//
// Проверяет:
//   1. Прямой дрейф (FAIL): каждая ссылка `REFERENCE.md#<якорь>` в SKILL.md
//      указывает на существующий заголовок-якорь в REFERENCE.md. Висящая
//      ссылка = кто-то вынес блок и забыл/сломал якорь.
//   2. Обратный дрейф (WARN, не FAIL): раздел REFERENCE.md, на который никто
//      не ссылается из SKILL.md - осиротевший, но это не провал набора.
//   3. Дрейф-гард (FAIL): обязательный минимум якорей (rebuild-docx, retries,
//      photo-offline, tilda, serial-final, api-errors, collision-genre,
//      serial-mode-details - таблица пункта 3 спеки) присутствует в REFERENCE.md.
//
// Пакет P1 пишет SKILL.md/REFERENCE.md параллельно с этим набором. Если
// REFERENCE.md ещё нет - тест SKIP (не FAIL), с сообщением. Если в SKILL.md
// пока нет ни одной ссылки REFERENCE.md#<якорь> (разрез ещё не перенесён в
// ядро) - проверка 1 тривиально пуста (нет ссылок - нет висящих), это не
// провал; дрейф-гард (3) при этом всё равно проверяется по факту REFERENCE.md.
//
// Exit 0 - все тесты прошли (или SKIP/WARN). Exit 1 - есть провал (FAIL).

import { readFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "../../..");
const SKILL_DIR = join(PROJECT_ROOT, ".claude/skills/seo-statya");
const SKILL_MD = join(SKILL_DIR, "SKILL.md");
const REFERENCE_MD = join(SKILL_DIR, "REFERENCE.md");

// Минимальный обязательный набор якорей (таблица "Уходит в REFERENCE.md",
// пункт 3 спеки Этапа 1).
const REQUIRED_ANCHORS = [
  "rebuild-docx",
  "collision-genre",
  "api-errors",
  "retries",
  "photo-offline",
  "tilda",
  "serial-final",
  "serial-mode-details",
];

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

// Заголовок REFERENCE.md уже пишется как готовый identifier ("## rebuild-docx"),
// но подстраховываемся базовой GitHub-подобной слагификацией на случай, если
// заголовок когда-нибудь станет многословным.
function slugify(text) {
  return text
    .trim()
    .toLowerCase()
    .replace(/`/g, "")
    .replace(/[^a-z0-9\s_-]/g, "")
    .replace(/\s+/g, "-");
}

console.log("=== skill-split (SKILL.md <-> REFERENCE.md anchors) smoke ===");

if (!existsSync(SKILL_MD)) {
  step("SKILL.md", () => "SKIP: .claude/skills/seo-statya/SKILL.md отсутствует");
} else if (!existsSync(REFERENCE_MD)) {
  step("REFERENCE.md", () => "SKIP: .claude/skills/seo-statya/REFERENCE.md ещё не создан (пакет P1 в процессе)");
} else {
  const skillSrc = readFileSync(SKILL_MD, "utf8");
  const refSrc = readFileSync(REFERENCE_MD, "utf8");

  // 1. Ссылки REFERENCE.md#<якорь> из SKILL.md.
  const linkRe = /REFERENCE\.md#([a-zA-Z0-9_-]+)/g;
  const linkedAnchors = new Set();
  {
    let m;
    while ((m = linkRe.exec(skillSrc))) linkedAnchors.add(m[1]);
  }

  // 2. Заголовки-якоря из REFERENCE.md (## .. #### - не уровень-1 заголовок файла).
  const headingRe = /^#{2,4}\s+(.+)$/gm;
  const definedAnchors = new Set();
  {
    let m;
    while ((m = headingRe.exec(refSrc))) definedAnchors.add(slugify(m[1]));
  }

  step("SKILL.md ссылается хотя бы на один якорь REFERENCE.md", () => {
    if (linkedAnchors.size === 0) {
      return "SKIP: в SKILL.md пока нет ссылок REFERENCE.md#<якорь> (разрез ещё не перенесён в ядро)";
    }
    return true;
  });

  step("нет висящих якорей: каждая ссылка SKILL.md есть в REFERENCE.md", () => {
    const dangling = [...linkedAnchors].filter((a) => !definedAnchors.has(a));
    if (dangling.length > 0) {
      return `указатель(и) в SKILL.md ведут в никуда: ${dangling.join(", ")}`;
    }
    return true;
  });

  step("обратный дрейф: разделы REFERENCE.md без ссылки из SKILL.md (WARN, не FAIL)", () => {
    const orphans = [...definedAnchors].filter((a) => !linkedAnchors.has(a));
    if (orphans.length > 0) {
      console.log(`    WARN: осиротевшие раздел(ы) REFERENCE.md (никто не ссылается): ${orphans.join(", ")}`);
    }
    return true; // предупреждение, не провал
  });

  step("дрейф-гард: обязательный набор якорей присутствует в REFERENCE.md", () => {
    const missing = REQUIRED_ANCHORS.filter((a) => !definedAnchors.has(a));
    if (missing.length > 0) {
      return `отсутствуют обязательные якоря: ${missing.join(", ")}`;
    }
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
process.exit(0);
