#!/usr/bin/env node
// run.mjs - регрессионный smoke-тест трёх скриптов /seo-structure.
//
// Использование:
//   .claude\scripts\_node.cmd .claude\tests\seo-structure\run.mjs
//
// Что делает:
//   1. Копирует fixtures/structure_dir/* в tmp-папку (sandbox).
//   2. Прогоняет select-top10.mjs - ожидает exit 0 + top10.json + cannibalization.json.
//   3. Прогоняет build-structure-xlsx.mjs - ожидает A6_test.xlsx + валидный (заголовки + data validation на колонку 5).
//   4. Создаёт client_filled.xlsx (копия A6) с 3 значениями: да / нет / обсудить.
//   5. Прогоняет import-structure.mjs - ожидает exit 3 + structure_data.json с правильным разбиением.
//   6. Прогоняет import-structure.mjs ещё раз с очищенной колонкой - ожидает exit 4.
//
// Exit 0 - всё ок. Exit 1 - хоть один тест упал.

import { existsSync, readFileSync, copyFileSync, mkdirSync, rmSync, cpSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..", "..", "..");
const fixturesDir = join(__dirname, "fixtures");
const sandboxDir = join(projectRoot, ".claude", "tmp", "seo-structure-test");
const nodeCmd = join(projectRoot, ".claude", "scripts", "_node.cmd");

let failed = 0;
const results = [];

async function step(name, fn) {
  process.stdout.write(`  [test] ${name} ... `);
  try {
    const r = await fn();
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
  const r = spawnSync(nodeCmd, [join(projectRoot, ".claude", "scripts", script), ...args], {
    cwd: projectRoot,
    encoding: "utf8",
    shell: true,
  });
  return { code: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
}

// === Reset sandbox ===
if (existsSync(sandboxDir)) {
  rmSync(sandboxDir, { recursive: true, force: true });
}
mkdirSync(sandboxDir, { recursive: true });

// Копируем все fixture-файлы в sandbox (структурно):
// - fixtures/structure_dir/* -> sandbox/
// - fixtures/analyses/999-test/* -> .claude/tests/seo-structure/fixtures/analyses/999-test/ (как есть)
//   (inputs.json указывает на fixtures-путь относительно project root)
cpSync(join(fixturesDir, "structure_dir"), sandboxDir, { recursive: true });

console.log("=== /seo-structure scripts smoke ===");
console.log("Sandbox: " + sandboxDir);
console.log("");

// === Тест 1: select-top10 ===
await step("select-top10.mjs runs and writes outputs", () => {
  const r = runScript("select-top10.mjs", sandboxDir);
  if (r.code !== 0) return `exit ${r.code}, stderr=${r.stderr.trim()}`;
  if (!existsSync(join(sandboxDir, "top10.json"))) return "top10.json not created";
  if (!existsSync(join(sandboxDir, "cannibalization.json"))) return "cannibalization.json not created";
  return true;
});

await step("select-top10 detected expected cannibalization", () => {
  const cann = JSON.parse(readFileSync(join(sandboxDir, "cannibalization.json"), "utf8"));
  // Ожидаем что "ремонт квартир под ключ цена" попало в страницы 1 и 2.
  const conflictQueries = cann.conflicts.map((c) => c.query);
  const hasOverlap = conflictQueries.some((q) => q.includes("под ключ"));
  if (!hasOverlap) return `no expected conflict on "под ключ", got conflicts: ${conflictQueries.join(", ")}`;
  return true;
});

await step("select-top10 filtered competitor brand", () => {
  const top = JSON.parse(readFileSync(join(sandboxDir, "top10.json"), "utf8"));
  // "evil-competitor.ru ремонт" не должен пройти фильтр - бренд из A3.md
  const allQueries = top.pages.flatMap((p) => p.queries.map((q) => q.query));
  if (allQueries.some((q) => q.includes("evil-competitor"))) {
    return "evil-competitor query survived filter, queries: " + allQueries.join("; ");
  }
  return true;
});

await step("select-top10 filters navigational query (5.1)", () => {
  const top = JSON.parse(readFileSync(join(sandboxDir, "top10.json"), "utf8"));
  const allQueries = top.pages.flatMap((p) => p.queries.map((q) => q.query.toLowerCase()));
  // "... ооо рога официальный сайт" - навигация к конкретной орг., должна быть вырезана 5.1
  const survived = allQueries.filter((q) => q.includes("официальный сайт") || /\bооо\b/.test(q));
  if (survived.length) return "navigational query survived 5.1 filter: " + survived.join("; ");
  return true;
});

await step("select-top10 keeps base-only query exact=0,base>=10 (5.2)", () => {
  const top = JSON.parse(readFileSync(join(sandboxDir, "top10.json"), "utf8"));
  const allQueries = top.pages.flatMap((p) => p.queries.map((q) => q.query));
  // "ремонт квартир шум базовый" - exact=0, base=50: 5.2 должна СОХРАНИТЬ (старый фильтр exact>0 резал).
  if (!allQueries.includes("ремонт квартир шум базовый")) {
    return "base-only query (base=50, exact=0) был выброшен - 5.2 не работает";
  }
  return true;
});

// === Тест 2: build-structure-xlsx ===
// Скрипт читает cannibalization.json - для теста xlsx используем уже разрешённую версию
// (имитируем выход cannibalization-resolver).
await step("seed cannibalization.recommendations for xlsx test", () => {
  const cann = JSON.parse(readFileSync(join(sandboxDir, "cannibalization.json"), "utf8"));
  cann.recommendations = [
    {
      query: "ремонт балкона под ключ",
      freq_exact: 450,
      current_attachment: "Ремонт квартир под ключ (страница №2)",
      recommendation: "Создать отдельную страницу /uslugi/remont-balkona/",
      competitors_with_separate_page: 3,
      rationale: "Высокая частотность, у 3 из 8 конкурентов отдельная посадка",
    },
  ];
  writeFileSync(join(sandboxDir, "cannibalization.json"), JSON.stringify(cann, null, 2));
  return true;
});

await step("build-structure-xlsx.mjs runs and creates A6_test.xlsx", () => {
  const r = runScript("build-structure-xlsx.mjs", sandboxDir);
  if (r.code !== 0) return `exit ${r.code}, stderr=${r.stderr.trim()}`;
  if (!existsSync(join(sandboxDir, "A6_test.xlsx"))) return "A6_test.xlsx not created";
  return true;
});

await step("A6.xlsx has 4 sheets in correct order", async () => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(join(sandboxDir, "A6_test.xlsx"));
  const expected = ["Структура", "Рекомендации", "Конкуренты", "Миграция"];
  const actual = wb.worksheets.map((s) => s.name);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    return `sheets: ${actual.join(", ")} (expected: ${expected.join(", ")})`;
  }
  return true;
});

await step("A6.xlsx pipes commerce note to «Примечания» (neutral, no red) + has «Роль» col", async () => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(join(sandboxDir, "A6_test.xlsx"));
  const ws = wb.getWorksheet("Структура");
  // Колонки ищем по имени (Фаза 4 добавила «Роль» перед «Примечаниями»).
  const headerRow = ws.getRow(2);
  let notesCol = 0;
  let roleCol = 0;
  headerRow.eachCell((cell, c) => {
    const v = String(cell.value || "").trim();
    if (v === "Примечания") notesCol = c;
    if (v === "Роль") roleCol = c;
  });
  if (!notesCol) return "не нашёл колонку «Примечания»";
  if (!roleCol) return "не нашёл колонку «Роль» (Фаза 4)";
  // Страница n=3 (Ремонт ванной) с commerce_note=info_dominant.
  let rowFound = 0;
  for (let r = 3; r <= ws.rowCount; r++) {
    if (Number(ws.getRow(r).getCell(1).value) === 3) {
      rowFound = r;
      break;
    }
  }
  if (!rowFound) return "не нашёл строку с n=3";
  const notesCell = ws.getCell(rowFound, notesCol);
  const txt = String(notesCell.value || "");
  // info_dominant теперь даёт человеческую формулировку с термином «информационный интент».
  if (!txt.toLowerCase().includes("информационный интент")) return `ожидал «Информационный интент» в примечании, получил: «${txt.slice(0, 80)}...»`;
  if (notesCell.font && notesCell.font.color?.argb === "FFFF0000") {
    return `Примечания не должны быть красными (сигнал недостоверен для B2B), row=${rowFound}`;
  }
  return true;
});

await step("A6.xlsx Примечания без внутреннего жаргона (клиентская чистота)", async () => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(join(sandboxDir, "A6_test.xlsx"));
  const ws = wb.getWorksheet("Структура");
  const headerRow = ws.getRow(2);
  let notesCol = 0;
  headerRow.eachCell((cell, c) => { if (String(cell.value || "").trim() === "Примечания") notesCol = c; });
  // Запрещённый в клиентском листе жаргон: имена файлов/инструментов/полей/англ. термины.
  const banned = ["decisions.json", "umbrella", "commercial_pct", "arsenkin", "semantic_pack", "info_dominant", "marker", "->", "top-10", "borderline", "mixed-intent"];
  for (let r = 3; r <= ws.rowCount; r++) {
    const v = String(ws.getCell(r, notesCol).value || "").toLowerCase();
    const hit = banned.find((b) => v.includes(b.toLowerCase()));
    if (hit) return `в Примечаниях строки ${r} протёк внутренний жаргон «${hit}»: «${v.slice(0, 80)}»`;
  }
  return true;
});

await step("A6.xlsx instruction row + headers at row 2 + data validation", async () => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(join(sandboxDir, "A6_test.xlsx"));
  const ws = wb.getWorksheet("Структура");
  const row1 = String(ws.getCell(1, 1).value || "");
  if (!row1.includes("Как заполнить")) return `row 1 not instruction: ${row1.slice(0, 40)}`;
  if (String(ws.getCell(2, 1).value) !== "№") return `row 2 col 1 is not «№»: ${ws.getCell(2, 1).value}`;
  if (String(ws.getCell(2, 5).value) !== "Нужна?") return `row 2 col 5 is not «Нужна?»: ${ws.getCell(2, 5).value}`;
  // Data validation на data row (3)
  const dv = ws.getCell(3, 5).dataValidation;
  if (!dv || !dv.formulae || !dv.formulae[0].includes("да")) {
    return `no data validation on row 3 col 5: ${JSON.stringify(dv)}`;
  }
  return true;
});

// === Тест 3: import-structure (3 ветки) ===
// 3a. Все «да» (exit 0)
await step("import-structure.mjs all yes -> exit 0", async () => {
  copyFileSync(join(sandboxDir, "A6_test.xlsx"), join(sandboxDir, "client_filled.xlsx"));
  const r = runScript("import-structure.mjs", sandboxDir);
  if (r.code !== 0) return `exit ${r.code}, stderr=${r.stderr.trim()}`;
  const sd = JSON.parse(readFileSync(join(sandboxDir, "structure_data.json"), "utf8"));
  if (sd.stats.yes !== 4) return `expected stats.yes==4, got ${sd.stats.yes}`;
  return true;
});

// 3b. Mixed: 1=обсудить, 2=нет, 3=да, 4=да -> exit 3
await step("import-structure.mjs mixed -> exit 3", async () => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(join(sandboxDir, "client_filled.xlsx"));
  const ws = wb.getWorksheet("Структура");
  ws.getCell(3, 5).value = "обсудить"; // page 1
  ws.getCell(4, 5).value = "нет";       // page 2
  ws.getCell(5, 5).value = "да";        // page 3
  ws.getCell(6, 5).value = "да";        // page 4
  await wb.xlsx.writeFile(join(sandboxDir, "client_filled.xlsx"));
  const r = runScript("import-structure.mjs", sandboxDir);
  if (r.code !== 3) return `expected exit 3, got ${r.code}`;
  const sd = JSON.parse(readFileSync(join(sandboxDir, "structure_data.json"), "utf8"));
  if (sd.stats.yes !== 2 || sd.stats.no !== 1 || sd.stats.discuss !== 1) {
    return `wrong stats: yes=${sd.stats.yes}, no=${sd.stats.no}, discuss=${sd.stats.discuss}`;
  }
  return true;
});

// 3c. Все пусто -> exit 4
await step("import-structure.mjs all empty -> exit 4", async () => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(join(sandboxDir, "client_filled.xlsx"));
  const ws = wb.getWorksheet("Структура");
  for (let r = 3; r <= 6; r++) ws.getCell(r, 5).value = null;
  await wb.xlsx.writeFile(join(sandboxDir, "client_filled.xlsx"));
  const r = runScript("import-structure.mjs", sandboxDir);
  if (r.code !== 4) return `expected exit 4, got ${r.code}`;
  return true;
});

// === Финал ===
console.log("");
const passed = results.filter((r) => r.ok).length;
const total = results.length;
console.log(`=== ${passed}/${total} tests passed ===`);

if (failed > 0) {
  console.log("");
  console.log("Failed:");
  for (const r of results.filter((r) => !r.ok)) {
    console.log(`  - ${r.name}: ${r.err}`);
  }
  process.exit(1);
}

// Чистим sandbox если всё ок
rmSync(sandboxDir, { recursive: true, force: true });
process.exit(0);
