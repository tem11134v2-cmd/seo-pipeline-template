#!/usr/bin/env node
// verify-progress.mjs
// Сверяет sections/progress.json с реальностью sections/*.md.
//
// Используется в скиле seo-statya перед финализацией и перед аудитом —
// чтобы поймать ситуацию, когда счётчики в progress.json расходятся с фактом
// (например, после ручной записи разделов в обход section-writer).
//
// Проверяет:
//   1. Число H2 в sections/*.md vs total_sections
//   2. completed_sections vs реальные file-id из sections/*.md
//   3. section_volumes vs фактическое число слов в каждом файле
//   4. Топ-5 N-грамм по target — реальное число вхождений vs `used`
//
// Exit codes:
//   0 — расхождений ≤10% или нет
//   1 — расхождения 10-30% (warning, не блокирует)
//   2 — расхождения >30% (блокирующий)
//
// Использование:
//   node .claude/scripts/verify-progress.mjs <article_dir> [--strict]
//
// --strict: даже warning'и (exit 1) считать ошибкой (exit 2). Для CI.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const args = process.argv.slice(2);
const articleDirArg = args.find((a) => !a.startsWith("--"));
const strict = args.includes("--strict");

if (!articleDirArg) {
  console.error("[verify-progress] usage: node verify-progress.mjs <article_dir> [--strict]");
  process.exit(1);
}

const articleDir = resolve(articleDirArg);
const sectionsDir = join(articleDir, "sections");
const progressPath = join(sectionsDir, "progress.json");

if (!existsSync(sectionsDir)) {
  console.error(`[verify-progress] sections/ не найден: ${sectionsDir}`);
  process.exit(2);
}
if (!existsSync(progressPath)) {
  console.error(`[verify-progress] sections/progress.json не найден: ${progressPath}`);
  process.exit(2);
}

let progress;
try {
  progress = JSON.parse(readFileSync(progressPath, "utf8").replace(/^﻿/, ""));
} catch (e) {
  console.error(`[verify-progress] progress.json не парсится: ${e.message}`);
  process.exit(2);
}

const sectionFiles = readdirSync(sectionsDir)
  .filter((f) => /\.md$/i.test(f))
  .filter((f) => f !== "progress.json")
  .sort();

const issues = []; // { severity: "warn"|"error", msg: string }
const warn = (msg) => issues.push({ severity: "warn", msg });
const err = (msg) => issues.push({ severity: "error", msg });

// ─── 1. Число H2 ────────────────────────────────────────────────────────────
let realH2Count = 0;
const realVolumes = {}; // {section_id (1-based): word_count}
const realText = [];
const seenNN = {}; // {NN: filename} - для отлова дублей секций (баг #4)

for (const file of sectionFiles) {
  const content = readFileSync(join(sectionsDir, file), "utf8").replace(/^﻿/, "");
  const h2Matches = content.match(/^##\s+[^#\n]/gm) || [];
  realH2Count += h2Matches.length;

  // Извлекаем NN из имени файла (NN-slug.md)
  const m = file.match(/^(\d+)-/);
  if (m) {
    const idx = Number(m[1]);
    if (seenNN[idx]) {
      err(`Дубликат секции NN=${m[1]}: «${seenNN[idx]}» и «${file}» - на одну секцию записаны два файла (section-writer переименовал slug при повторе). Удали лишний.`);
    } else {
      seenNN[idx] = file;
    }
    const words = content.split(/\s+/).filter((w) => /\S/.test(w)).length;
    realVolumes[idx] = words;
    realText.push(content);
  }
}

const declaredTotal = Number(progress.total_sections) || 0;
if (declaredTotal && realH2Count !== declaredTotal) {
  if (Math.abs(realH2Count - declaredTotal) >= 2) {
    err(`Число H2 не совпадает: total_sections=${declaredTotal}, в файлах=${realH2Count}`);
  } else {
    warn(`Число H2 расходится на 1: total_sections=${declaredTotal}, в файлах=${realH2Count}`);
  }
}

// ─── 2. completed_sections ──────────────────────────────────────────────────
const completed = Array.isArray(progress.completed_sections) ? progress.completed_sections : [];
const realCompleted = Object.keys(realVolumes).map(Number).sort((a, b) => a - b);

const missingInCompleted = realCompleted.filter((i) => !completed.includes(i));
const extraInCompleted = completed.filter((i) => !realCompleted.includes(i));
if (missingInCompleted.length) {
  warn(`Секции записаны на диск, но не в completed_sections: ${missingInCompleted.join(", ")}`);
}
if (extraInCompleted.length) {
  err(`completed_sections содержит секции, которых нет на диске: ${extraInCompleted.join(", ")}`);
}

// ─── 3. section_volumes ─────────────────────────────────────────────────────
const declaredVolumes = progress.section_volumes || {};
for (const [idxStr, realWords] of Object.entries(realVolumes)) {
  const idx = Number(idxStr);
  const declared = Number(declaredVolumes[idxStr] ?? declaredVolumes[idx]) || 0;
  if (!declared) continue;
  const diffPct = Math.abs(realWords - declared) / Math.max(declared, 1);
  if (diffPct > 0.3) {
    err(`Объём секции ${idx}: progress.json=${declared}, факт=${realWords} (отклонение ${Math.round(diffPct * 100)}%)`);
  } else if (diffPct > 0.1) {
    warn(`Объём секции ${idx}: progress.json=${declared}, факт=${realWords} (отклонение ${Math.round(diffPct * 100)}%)`);
  }
}

// ─── 4. Топ-5 N-грамм по target ─────────────────────────────────────────────
// ВАЖНО: расхождение по N-граммам НИКОГДА не эскалируется в error (exit 2). Скрипт
// считает точные (нормализованные) вхождения, а progress.json накапливает леммы и
// словоформы через анализатор JM - структурное расхождение неизбежно и не должно
// блокировать пайплайн. Только warning + пояснение в выводе.
function normalizeForCount(s) {
  return String(s)
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[-–—]/g, " ") // дефис и тире -> пробел (костюма-тройки == костюма тройки)
    .replace(/\s+/g, " ")
    .trim();
}

const ngrams = progress.ngrams || {};
const normalizedText = normalizeForCount(realText.join("\n"));
const topNgrams = Object.entries(ngrams)
  .filter(([, v]) => Number(v?.target) > 0)
  .sort((a, b) => Number(b[1].target) - Number(a[1].target))
  .slice(0, 5);

let hadNgramWarn = false;
for (const [phrase, data] of topNgrams) {
  const target = Number(data.target) || 0;
  const declaredUsed = Number(data.used) || 0;
  const needle = normalizeForCount(phrase);
  if (!needle) continue;
  let realUsed = 0;
  let pos = 0;
  while ((pos = normalizedText.indexOf(needle, pos)) !== -1) {
    realUsed++;
    pos += needle.length;
  }
  // Допускаем расхождение в 1, если target ≤ 5; иначе 20% от target.
  const tol = target <= 5 ? 1 : Math.ceil(target * 0.2);
  if (Math.abs(realUsed - declaredUsed) > tol) {
    warn(`N-грамма «${phrase}»: progress.json used=${declaredUsed}, факт=${realUsed} (target=${target})`);
    hadNgramWarn = true;
  }
}

// ─── Вывод ──────────────────────────────────────────────────────────────────
const errors = issues.filter((i) => i.severity === "error");
const warnings = issues.filter((i) => i.severity === "warn");

if (issues.length === 0) {
  console.log(`[verify-progress] ✓ progress.json соответствует факту (${sectionFiles.length} секций, ${realH2Count} H2)`);
  process.exit(0);
}

console.error(`[verify-progress] расхождения в ${articleDirArg}:`);
if (errors.length) {
  console.error(`  ❌ Ошибки (${errors.length}):`);
  for (const i of errors) console.error(`    - ${i.msg}`);
}
if (warnings.length) {
  console.error(`  ⚠ Предупреждения (${warnings.length}):`);
  for (const i of warnings) console.error(`    - ${i.msg}`);
}
if (hadNgramWarn) {
  console.error("  ℹ По N-граммам: скрипт считает точные (нормализованные) вхождения, а progress.json");
  console.error("    учитывает леммы и словоформы. Небольшое расхождение нормально и не блокирует прогон.");
}

if (errors.length) process.exit(2);
if (warnings.length && strict) process.exit(2);
if (warnings.length) process.exit(1);
process.exit(0);
