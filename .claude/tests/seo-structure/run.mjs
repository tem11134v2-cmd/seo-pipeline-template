#!/usr/bin/env node
// run.mjs - регрессионный smoke-тест трёх скриптов /seo-struktura.
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
import { fileURLToPath, pathToFileURL } from "node:url";
import ExcelJS from "exceljs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..", "..", "..");
const fixturesDir = join(__dirname, "fixtures");
const sandboxDir = join(projectRoot, ".claude", "tmp", "seo-structure-test");
const nodeCmd = join(projectRoot, ".claude", "scripts", "_node.cmd");
const SCRIPTS = join(projectRoot, ".claude", "scripts");
const slugModuleUrl = pathToFileURL(join(SCRIPTS, "_slug.mjs")).href;

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

console.log("=== /seo-struktura scripts smoke ===");
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

// === Блок: slug regression - баг гигантского URL (раздел 8.1 спеки Этапа 2) ===
// Фикстура-ловушка n=5 «Сепараторы (центробежные, факельные - уточнить у клиента)» с маркером
// «сепаратор центробежный» уже добавлена в master_list.json/markers.json/semantic_pack.json выше
// (прогнана через select-top10 + build-structure-xlsx вместе с остальными страницами).
console.log("");
console.log("=== slug regression (баг гигантского URL) ===");

await step("slug: URL из маркера, скобки вырезаны, <=60 симв и <=5 слов", async () => {
  const { buildPageUrl } = await import(slugModuleUrl);
  const url = buildPageUrl(
    { name: "Сепараторы (центробежные, факельные - уточнить у клиента)", type: "category", migration_decision: "new" },
    { marker: "сепаратор центробежный", usedUrls: new Map() }
  );
  if (/[()]/.test(url)) return `в URL остались скобки: ${url}`;
  if (/[а-я]/i.test(url)) return `в URL кириллица: ${url}`;
  const slugPart = url.replace(/^\/catalog\//, "").replace(/\/$/, "");
  if ([...slugPart].length > 60) return `slug длиннее 60: ${slugPart}`;
  if (slugPart.split("-").length > 5) return `slug больше 5 слов: ${slugPart}`;
  if (url !== "/catalog/separator-centrobezhnyj/") return `ожидал /catalog/separator-centrobezhnyj/, получил ${url}`;
  return true;
});

await step("build-structure-xlsx: адрес n=5 короткий, из маркера, без скобок (полный пайплайн)", async () => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(join(sandboxDir, "A6_test.xlsx"));
  const ws = wb.getWorksheet("Структура");
  let row5 = 0;
  for (let r = 3; r <= ws.rowCount; r++) {
    if (Number(ws.getRow(r).getCell(1).value) === 5) { row5 = r; break; }
  }
  if (!row5) return "не нашел строку n=5 в A6_test.xlsx (фикстура-ловушка не подхвачена?)";
  const addr = String(ws.getCell(row5, 2).value || ""); // колонка 2 = «Адрес страницы»
  if (/[()]/.test(addr)) return `в адресе остались скобки: ${addr}`;
  if (/[а-я]/i.test(addr)) return `в адресе кириллица: ${addr}`;
  if (addr.length >= 40) return `адрес слишком длинный (${addr.length} симв.): ${addr}`;
  if (!addr.startsWith("/catalog/")) return `адрес не в /catalog/: ${addr}`;
  return true;
});

await step("slug: коллизия -> осмысленная дифференциация / числовой суффикс", async () => {
  const { buildPageUrl } = await import(slugModuleUrl);
  const used = new Map();
  const u1 = buildPageUrl({ name: "Ремонт ванной", type: "service", section: "Ванная", migration_decision: "new" }, { marker: "ремонт ванной", usedUrls: used });
  const u2 = buildPageUrl({ name: "Ремонт ванной комнаты", type: "service", section: "Санузел", migration_decision: "new" }, { marker: "ремонт ванной", usedUrls: used });
  if (u1 === u2) return `коллизия не разведена: ${u1}`;
  return true;
});

// Вердикт стратега #2: «под» убран из STOPWORDS - «под ключ» смысловая коммерческая фраза, сохраняем.
await step("slug: URL сохраняет предлог «под» (вердикт 2 - «под ключ» коммерчески значимая фраза)", async () => {
  const { buildSlug } = await import(slugModuleUrl);
  const slug = buildSlug("ремонт квартир под ключ москва");
  if (!/(^|-)pod(-|$)/.test(slug)) return `предлог «под» не сохранился в slug: ${slug}`;
  return true;
});

await step("build-structure-xlsx: адрес n=2 «Ремонт квартир под ключ» содержит «pod» (вердикт 2, полный пайплайн)", async () => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(join(sandboxDir, "A6_test.xlsx"));
  const ws = wb.getWorksheet("Структура");
  let row2 = 0;
  for (let r = 3; r <= ws.rowCount; r++) {
    if (Number(ws.getRow(r).getCell(1).value) === 2) { row2 = r; break; }
  }
  if (!row2) return "не нашел строку n=2";
  const addr = String(ws.getCell(row2, 2).value || "");
  if (!addr.includes("pod")) return `адрес n=2 не содержит «pod»: ${addr}`;
  return true;
});

// Важнейший тест-страж: slugifyBase (id страницы) должен остаться БИТ-В-БИТ старым slugifyId -
// та же карта транслита, [^a-z0-9]+ -> дефис, slice(0,60), БЕЗ вырезания скобок/стоп-слов/лимита слов.
// Эталонные строки посчитаны вручную по старой логике (см. git-историю select-top10.mjs).
await step("slug: slugifyBase сохраняет старое поведение id (скобки транслитерируются, не режутся; стоп-слова не трогаются)", async () => {
  const { slugifyBase } = await import(slugModuleUrl);
  if (slugifyBase("Сосуды под давлением") !== "sosudy-pod-davleniem") {
    return `id-поведение изменилось: slugifyBase("Сосуды под давлением") = "${slugifyBase("Сосуды под давлением")}"`;
  }
  const cases = [
    ["Ремонт квартир под ключ (недорого, быстро)", "remont-kvartir-pod-klyuch-nedorogo-bystro"],
    ["Сепараторы (центробежные, факельные - уточнить у клиента)", "separatory-centrobezhnye-fakelnye-utochnit-u-klienta"],
    ["Доставка", "dostavka"],
    ["Оборудование для очистки газа №1 (ГОСТ Р)", "oborudovanie-dlya-ochistki-gaza-1-gost-r"],
    ["Насосы центробежные (ГОСТ 12345-80)", "nasosy-centrobezhnye-gost-12345-80"],
  ];
  for (const [input, expected] of cases) {
    const got = slugifyBase(input);
    if (got !== expected) return `slugifyBase("${input}") = "${got}", ожидал "${expected}"`;
  }
  return true;
});

await step("дрейф-гард: карта транслита есть только в _slug.mjs (build-structure-xlsx/select-top10 больше не дублируют)", () => {
  const slugSrc = readFileSync(join(SCRIPTS, "_slug.mjs"), "utf8");
  const buildSrc = readFileSync(join(SCRIPTS, "build-structure-xlsx.mjs"), "utf8");
  const topSrc = readFileSync(join(SCRIPTS, "select-top10.mjs"), "utf8");
  if (!slugSrc.includes('а: "a"')) return "_slug.mjs не содержит ожидаемую карту транслита (маркер «а: \"a\"» не найден)";
  if (buildSrc.includes('а: "a"')) return "build-structure-xlsx.mjs все еще содержит свою карту транслита (дубль не устранен)";
  if (topSrc.includes('а: "a"')) return "select-top10.mjs все еще содержит свою карту транслита (дубль не устранен)";
  return true;
});

// === Блок: валидация импорта URL (раздел 8.2 спеки, правило #3) ===
console.log("");
console.log("=== import URL validation (правило #3) ===");

await step("validateUrl: ловит кириллицу/скобки/двойной слэш/дефис/длину, пропускает валидный", async () => {
  const { validateUrl } = await import(slugModuleUrl);
  if (validateUrl("/uslugi/remont/").length) return "валидный URL помечен нарушением";
  if (!validateUrl("/услуги/").length) return "кириллица не поймана";
  if (!validateUrl("/a//b/").length) return "двойной слэш не пойман";
  if (!validateUrl("/a--b/").length) return "двойной дефис не пойман";
  if (!validateUrl("/a (b)/").length) return "скобки/пробел не пойманы";
  if (!validateUrl("/" + "x".repeat(80) + "/").length) return "длина > 70 не поймана";
  return true;
});

await step("import-structure: кириллический адрес в «Адрес страницы» -> exit 3 + url_issue", async () => {
  copyFileSync(join(sandboxDir, "A6_test.xlsx"), join(sandboxDir, "client_filled.xlsx"));
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(join(sandboxDir, "client_filled.xlsx"));
  const ws = wb.getWorksheet("Структура");
  let row2 = 0;
  for (let r = 3; r <= ws.rowCount; r++) {
    if (Number(ws.getRow(r).getCell(1).value) === 2) { row2 = r; break; }
  }
  if (!row2) return "не нашел строку n=2 в client_filled.xlsx";
  ws.getCell(row2, 2).value = "/услуги/ремонт/"; // колонка 2 = «Адрес страницы» - клиент вписал кириллицу
  await wb.xlsx.writeFile(join(sandboxDir, "client_filled.xlsx"));
  const r = runScript("import-structure.mjs", sandboxDir);
  if (r.code !== 3) return `expected exit 3, got ${r.code}, stderr=${r.stderr.trim()}`;
  const sd = JSON.parse(readFileSync(join(sandboxDir, "structure_data.json"), "utf8"));
  const p2 = sd.pages.find((p) => p.n === 2);
  if (!p2) return "не нашел страницу n=2 в structure_data.json";
  if (!p2.url_issue || !p2.url_issue.includes("кириллица")) return `url_issue не про кириллицу: ${JSON.stringify(p2.url_issue)}`;
  return true;
});

await step("import-structure: чистые латинские адреса -> без URL-нарушений (нет ложных срабатываний)", async () => {
  // Свежая копия A6_test.xlsx - адреса сгенерированы _slug.mjs, все латинские.
  copyFileSync(join(sandboxDir, "A6_test.xlsx"), join(sandboxDir, "client_filled.xlsx"));
  const r = runScript("import-structure.mjs", sandboxDir);
  if (r.code !== 0) return `ожидал exit 0 на чистой фикстуре, got ${r.code}, stderr=${r.stderr.trim()}`;
  const sd = JSON.parse(readFileSync(join(sandboxDir, "structure_data.json"), "utf8"));
  const withIssue = sd.pages.filter((p) => p.url_issue);
  if (withIssue.length) return `ложные URL-нарушения на чистых адресах: n=${withIssue.map((p) => p.n).join(",")}`;
  return true;
});

// === Тест 3: import-structure (3 ветки) ===
// 3a. Все «да» (exit 0)
await step("import-structure.mjs all yes -> exit 0", async () => {
  copyFileSync(join(sandboxDir, "A6_test.xlsx"), join(sandboxDir, "client_filled.xlsx"));
  const r = runScript("import-structure.mjs", sandboxDir);
  if (r.code !== 0) return `exit ${r.code}, stderr=${r.stderr.trim()}`;
  const sd = JSON.parse(readFileSync(join(sandboxDir, "structure_data.json"), "utf8"));
  if (sd.stats.yes !== 5) return `expected stats.yes==5 (4 исходные + фикстура-ловушка n=5), got ${sd.stats.yes}`;
  return true;
});

// 3b. Mixed: 1=обсудить, 2=нет, 3=да, 4=да, 5=да (нетронутая, дефолт из build) -> exit 3
await step("import-structure.mjs mixed -> exit 3", async () => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(join(sandboxDir, "client_filled.xlsx"));
  const ws = wb.getWorksheet("Структура");
  ws.getCell(3, 5).value = "обсудить"; // page 1
  ws.getCell(4, 5).value = "нет";       // page 2
  ws.getCell(5, 5).value = "да";        // page 3
  ws.getCell(6, 5).value = "да";        // page 4
  // row 7 (page n=5, фикстура-ловушка) не трогаем - остается дефолтное «да» из build-structure-xlsx.
  await wb.xlsx.writeFile(join(sandboxDir, "client_filled.xlsx"));
  const r = runScript("import-structure.mjs", sandboxDir);
  if (r.code !== 3) return `expected exit 3, got ${r.code}`;
  const sd = JSON.parse(readFileSync(join(sandboxDir, "structure_data.json"), "utf8"));
  if (sd.stats.yes !== 3 || sd.stats.no !== 1 || sd.stats.discuss !== 1) {
    return `wrong stats: yes=${sd.stats.yes}, no=${sd.stats.no}, discuss=${sd.stats.discuss}`;
  }
  return true;
});

// 3c. Все пусто -> exit 4 (динамический диапазон строк - устойчиво к числу страниц в фикстуре)
await step("import-structure.mjs all empty -> exit 4", async () => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(join(sandboxDir, "client_filled.xlsx"));
  const ws = wb.getWorksheet("Структура");
  for (let r = 3; r <= ws.rowCount; r++) ws.getCell(r, 5).value = null;
  await wb.xlsx.writeFile(join(sandboxDir, "client_filled.xlsx"));
  const r = runScript("import-structure.mjs", sandboxDir);
  if (r.code !== 4) return `expected exit 4, got ${r.code}`;
  return true;
});

// === Тест 4: иерархия (use_sections + товарный category) ===
// Отдельная фикстура fixtures/hierarchy_dir: товарный сайт с use_sections=true,
// per-page section + category, top-level competitor_url_depth + url_nesting_recommendation.
// Цель - убедиться, что колонки «Раздел»/«Категория» появляются в Листе 1, значения
// section/category доезжают в ячейки, и category переживает import round-trip.
const hierarchyDir = join(projectRoot, ".claude", "tmp", "seo-structure-test-hier");
if (existsSync(hierarchyDir)) rmSync(hierarchyDir, { recursive: true, force: true });
mkdirSync(hierarchyDir, { recursive: true });
cpSync(join(fixturesDir, "hierarchy_dir"), hierarchyDir, { recursive: true });

// Хелпер: вернуть карту имя_колонки -> 1-based индекс из строки заголовков (строка 2).
function headerColMap(ws) {
  const map = {};
  ws.getRow(2).eachCell((cell, c) => {
    const v = String(cell.value || "").trim();
    if (v) map[v] = c;
  });
  return map;
}

await step("hierarchy: select-top10 + build-structure-xlsx run on hierarchy fixture", () => {
  const r1 = runScript("select-top10.mjs", hierarchyDir);
  if (r1.code !== 0) return `select-top10 exit ${r1.code}, stderr=${r1.stderr.trim()}`;
  if (!existsSync(join(hierarchyDir, "top10.json"))) return "top10.json not created";
  const r2 = runScript("build-structure-xlsx.mjs", hierarchyDir);
  if (r2.code !== 0) return `build-structure-xlsx exit ${r2.code}, stderr=${r2.stderr.trim()}`;
  if (!existsSync(join(hierarchyDir, "A6_hier.xlsx"))) return "A6_hier.xlsx not created";
  return true;
});

await step("hierarchy: top10.json carries section + category per page", () => {
  const top = JSON.parse(readFileSync(join(hierarchyDir, "top10.json"), "utf8"));
  // select-top10 должен копировать section/category из master в каждую страницу (иначе теряются).
  const p2 = top.pages.find((p) => p.n === 2);
  const p3 = top.pages.find((p) => p.n === 3);
  if (!p2 || !p3) return "не нашёл страницы n=2 / n=3 в top10.json";
  if (p2.section !== "Каталог сантехники") return `top10 n=2 section="${p2.section}" (ожидал «Каталог сантехники»)`;
  if (p2.category !== "Ванны") return `top10 n=2 category="${p2.category}" (ожидал «Ванны»)`;
  if (p3.category !== "Смесители") return `top10 n=3 category="${p3.category}" (ожидал «Смесители»)`;
  return true;
});

await step("hierarchy: Лист 1 имеет колонки «Раздел» и «Категория» в правильном порядке", async () => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(join(hierarchyDir, "A6_hier.xlsx"));
  const ws = wb.getWorksheet("Структура");
  const cols = headerColMap(ws);
  if (!cols["Раздел"]) return "нет колонки «Раздел» при use_sections=true";
  if (!cols["Категория"]) return "нет колонки «Категория» при наличии товарных category";
  // Порядок: «Раздел» и «Категория» идут после «Название» и перед «Нужна?» (как в fixedLeft).
  if (!(cols["Название"] < cols["Раздел"])) return `позиция: «Раздел» (${cols["Раздел"]}) должна быть после «Название» (${cols["Название"]})`;
  if (!(cols["Раздел"] < cols["Категория"])) return `позиция: «Категория» (${cols["Категория"]}) должна быть после «Раздел» (${cols["Раздел"]})`;
  if (!(cols["Категория"] < cols["Нужна?"])) return `позиция: «Категория» (${cols["Категория"]}) должна быть перед «Нужна?» (${cols["Нужна?"]})`;
  return true;
});

await step("hierarchy: значения section/category попадают в ячейки Листа 1", async () => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(join(hierarchyDir, "A6_hier.xlsx"));
  const ws = wb.getWorksheet("Структура");
  const cols = headerColMap(ws);
  // Находим строку с n=2 (Акриловые ванны: section=«Каталог сантехники», category=«Ванны»).
  let row2 = 0;
  for (let r = 3; r <= ws.rowCount; r++) {
    if (Number(ws.getRow(r).getCell(1).value) === 2) { row2 = r; break; }
  }
  if (!row2) return "не нашёл строку n=2";
  const section = String(ws.getCell(row2, cols["Раздел"]).value || "").trim();
  const category = String(ws.getCell(row2, cols["Категория"]).value || "").trim();
  if (section !== "Каталог сантехники") return `ячейка «Раздел» n=2 = "${section}" (ожидал «Каталог сантехники»)`;
  if (category !== "Ванны") return `ячейка «Категория» n=2 = "${category}" (ожидал «Ванны»)`;
  return true;
});

await step("hierarchy: section + category переживают import round-trip", async () => {
  // Round-trip: A6_hier.xlsx (как «вернул клиент») -> import-structure -> structure_data.json.
  // Все «да» по умолчанию (build проставил «да» обычным страницам) -> exit 0.
  copyFileSync(join(hierarchyDir, "A6_hier.xlsx"), join(hierarchyDir, "client_filled.xlsx"));
  const r = runScript("import-structure.mjs", hierarchyDir);
  if (r.code !== 0) return `import exit ${r.code}, stderr=${r.stderr.trim()}`;
  const sd = JSON.parse(readFileSync(join(hierarchyDir, "structure_data.json"), "utf8"));
  const p2 = sd.pages.find((p) => p.n === 2);
  const p3 = sd.pages.find((p) => p.n === 3);
  if (!p2 || !p3) return "не нашёл страницы n=2 / n=3 в structure_data.json";
  if (p2.section !== "Каталог сантехники") return `import n=2 section="${p2.section}" не пережил round-trip`;
  if (p2.category !== "Ванны") return `import n=2 category="${p2.category}" не пережил round-trip`;
  if (p3.category !== "Смесители") return `import n=3 category="${p3.category}" не пережил round-trip`;
  return true;
});

// === Блок: verify-structure.mjs - механический финальный гейт (раздел 8.3 спеки, правило #4) ===
// Отдельная фикстура fixtures/verify_dir/ (статичная - вердикт стратега #4): structure_data.json +
// A6.md + master_list.json, консистентные друг с другом. n=1 Главная, n=2 Ремонт квартир (status
// «новая»), n=3 Ремонт ванной (status «существующая» - имитирует реальный адрес клиента), n=4 Доставка
// (отложена). Каждый тест сбрасывает sandbox из фикстуры перед своей мутацией - герметично,
// не зависит от порядка выполнения.
console.log("");
console.log("=== verify-structure (правило #4) ===");

const verifyFixturesDir = join(fixturesDir, "verify_dir");
const verifyDir = join(projectRoot, ".claude", "tmp", "seo-structure-test-verify");

function resetVerifyDir() {
  if (existsSync(verifyDir)) rmSync(verifyDir, { recursive: true, force: true });
  mkdirSync(verifyDir, { recursive: true });
  cpSync(verifyFixturesDir, verifyDir, { recursive: true });
}

await step("verify-structure: полный консистентный A6 -> exit 0", () => {
  resetVerifyDir();
  const r = runScript("verify-structure.mjs", verifyDir);
  if (r.code !== 0) return `expected exit 0, got ${r.code}, stdout=${r.stdout.trim()}`;
  return true;
});

await step("verify-structure: пропала целевая страница в A6 -> exit 2", () => {
  resetVerifyDir();
  const a6Path = join(verifyDir, "A6.md");
  const text = readFileSync(a6Path, "utf8")
    .split("\n")
    .filter((l) => !l.includes("Ремонт ванной")) // убираем и строку таблицы, и пункт меню
    .join("\n");
  writeFileSync(a6Path, text);
  const r = runScript("verify-structure.mjs", verifyDir);
  if (r.code !== 2) return `expected exit 2, got ${r.code}, stdout=${r.stdout.trim()}`;
  if (!r.stdout.includes("Ремонт ванной")) return `в выводе нет имени пропавшей страницы: ${r.stdout.trim()}`;
  return true;
});

await step("verify-structure: дубль маркера на 2 целевых страницах -> exit 2", () => {
  resetVerifyDir();
  const sdPath = join(verifyDir, "structure_data.json");
  const sd = JSON.parse(readFileSync(sdPath, "utf8"));
  const p2 = sd.pages.find((p) => p.n === 2);
  const p3 = sd.pages.find((p) => p.n === 3);
  p3.marker = p2.marker; // дублируем маркер между n=2 и n=3
  writeFileSync(sdPath, JSON.stringify(sd, null, 2));
  const r = runScript("verify-structure.mjs", verifyDir);
  if (r.code !== 2) return `expected exit 2, got ${r.code}, stdout=${r.stdout.trim()}`;
  return true;
});

await step("verify-structure: кириллица в НОВОМ URL (status «новая») -> exit 2 (блок)", () => {
  resetVerifyDir();
  const sdPath = join(verifyDir, "structure_data.json");
  const sd = JSON.parse(readFileSync(sdPath, "utf8"));
  const p2 = sd.pages.find((p) => p.n === 2); // status "новая" - наша генерация
  p2.url = "/услуги/ремонт/";
  writeFileSync(sdPath, JSON.stringify(sd, null, 2));
  const r = runScript("verify-structure.mjs", verifyDir);
  if (r.code !== 2) return `expected exit 2, got ${r.code}, stdout=${r.stdout.trim()}`;
  return true;
});

await step("verify-structure: кириллица в СУЩЕСТВУЮЩЕМ клиентском URL -> exit 1 (warn, не блок)", () => {
  resetVerifyDir();
  const sdPath = join(verifyDir, "structure_data.json");
  const sd = JSON.parse(readFileSync(sdPath, "utf8"));
  const p3 = sd.pages.find((p) => p.n === 3); // status "существующая" - реальный сайт клиента
  p3.url = "/услуги/ванная/";
  writeFileSync(sdPath, JSON.stringify(sd, null, 2));
  const r = runScript("verify-structure.mjs", verifyDir);
  if (r.code !== 1) return `expected exit 1 (warn), got ${r.code}, stdout=${r.stdout.trim()}`;
  return true;
});

await step("verify-structure: битый вход (нет A6.md) -> exit 3", () => {
  resetVerifyDir();
  rmSync(join(verifyDir, "A6.md"));
  const r = runScript("verify-structure.mjs", verifyDir);
  if (r.code !== 3) return `expected exit 3, got ${r.code}, stderr=${r.stderr.trim()}`;
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
rmSync(hierarchyDir, { recursive: true, force: true });
rmSync(verifyDir, { recursive: true, force: true });
process.exit(0);
