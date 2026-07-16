#!/usr/bin/env node
// run.mjs - smoke-тесты для скриптов /seo-metategi.
// Запуск: .claude\scripts\_node.cmd .claude\tests\metatags\run.mjs
//
// Проверяет четыре скрипта на синтетических фикстурах:
//   - read-metatags-input.mjs  (3 источника + edge: все «нет» -> exit 2)
//   - select-variations.mjs    (отсев Comm, all-low фолбэк, info passthrough, топоним)
//   - build-metatags-xlsx.mjs  (3 листа, подсветка длины, заглушка для missing)
//   - verify-metatags.mjs      (нарушения -> exit 2, чисто -> exit 0, финальный прогон после xlsx с --accept-degraded)
//
// Exit 0 - все тесты прошли. Exit 1 - есть провал.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "../../..");
const SANDBOX = join(PROJECT_ROOT, ".claude/tmp/metatags-test");

// === Мини-фреймворк ===
let passed = 0;
let failed = 0;
const failures = [];

function step(name, fn) {
  try {
    const result = fn();
    if (result === true || result === undefined) {
      console.log(`  [test] ${name} ... PASS`);
      passed++;
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

// Запуск скрипта; возвращает {code, stdout}. Не бросает на ненулевом коде
// (нам нужно проверять exit-коды 2/3/4).
function runScript(script, args) {
  const scriptPath = join(PROJECT_ROOT, ".claude/scripts", script);
  try {
    const stdout = execFileSync("node", [scriptPath, ...args], { encoding: "utf8" });
    return { code: 0, stdout };
  } catch (err) {
    return { code: err.status ?? 1, stdout: (err.stdout || "") + (err.stderr || "") };
  }
}

function readJson(p) {
  return JSON.parse(readFileSync(p, "utf8").replace(/^﻿/, ""));
}

function writeJson(p, obj) {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(obj, null, 2));
}

// === Песочница ===
console.log("=== /seo-metategi scripts smoke ===");
console.log(`Sandbox: ${SANDBOX}`);
if (existsSync(SANDBOX)) rmSync(SANDBOX, { recursive: true, force: true });
mkdirSync(SANDBOX, { recursive: true });

// ──────────────────────────────────────────────────────────────────────────
// Фикстуры
// ──────────────────────────────────────────────────────────────────────────

// structure source
const structSrc = join(SANDBOX, "structure-src");
writeJson(join(structSrc, "structure_data.json"), {
  stats: { yes: 2, no: 1, total: 3 },
  pages: [
    { n: 1, url: "/", type: "Главная", name: "Главная", target_status: "yes", marker: "кухни на заказ москва", queries: [] },
    { n: 2, url: "/catalog/uglovye/", type: "Категория", name: "Угловые кухни", target_status: "yes", marker: "угловые кухни", queries: [] },
    { n: 3, url: "/blog/", type: "Инфо", name: "Блог", target_status: "no", marker: "", queries: [] },
  ],
});
writeJson(join(structSrc, "top10.json"), {
  pages: [
    { n: 1, marker: "кухни на заказ москва", queries: [
      { query: "кухни на заказ москва", freq_exact: 4000, freq_base: 12000, is_marker: true },
      { query: "купить кухню на заказ", freq_exact: 1200, freq_base: 5000, is_marker: false },
    ] },
    { n: 2, marker: "угловые кухни", queries: [
      { query: "угловые кухни на заказ", freq_exact: 900, freq_base: 3000, is_marker: true },
    ] },
  ],
});

// table source
const tablePath = join(SANDBOX, "table.csv");
writeFileSync(tablePath, "URL;Тип;Название;Маркер;Запрос2\n/;Главная;Главная;окна пвх москва;купить окна пвх\n/uslugi/montazh/;Услуга;Монтаж;монтаж окон\n");

// audit source
const auditDir = join(SANDBOX, "audit-dir");
writeJson(join(auditDir, "audit.json"), {
  domain: "example.ru",
  pages: [
    { url: "/", type: "home", name: "Главная", marker: "двери межкомнатные", current_h1: "Привет", current_title: "Главная", current_description: "", needs_new: true, selected: true, priority: "высокий", reason: "Title неинформативный" },
    { url: "/catalog/", type: "category", name: "Каталог", marker: "двери купить", current_title: "Каталог дверей купить в Москве", needs_new: false, selected: false, priority: "низкий", reason: "В норме" },
  ],
});

// empty structure (all "no")
const emptyStruct = join(SANDBOX, "empty-struct-src");
writeJson(join(emptyStruct, "structure_data.json"), {
  stats: { yes: 0, no: 1, total: 1 },
  pages: [{ n: 1, url: "/", type: "home", name: "Главная", target_status: "no", marker: "", queries: [] }],
});

// ──────────────────────────────────────────────────────────────────────────
// 1. read-metatags-input.mjs
// ──────────────────────────────────────────────────────────────────────────

step("read-input --from-structure -> exit 0, 2 pages (skips «no»)", () => {
  const out = join(SANDBOX, "mt-structure");
  const r = runScript("read-metatags-input.mjs", [out, "--from-structure", structSrc]);
  if (r.code !== 0) return `exit ${r.code}`;
  const j = readJson(join(out, "pages.json"));
  if (j.total !== 2) return `total=${j.total} (expect 2)`;
  if (j.pages[0].queries.length !== 2) return "page1 queries from top10 not picked up";
  return true;
});

step("read-input --from-table -> exit 0, 2 pages, marker is_marker", () => {
  const out = join(SANDBOX, "mt-table");
  const r = runScript("read-metatags-input.mjs", [out, "--from-table", tablePath]);
  if (r.code !== 0) return `exit ${r.code}`;
  const j = readJson(join(out, "pages.json"));
  if (j.total !== 2) return `total=${j.total}`;
  const p1 = j.pages[0];
  if (p1.marker !== "окна пвх москва") return `marker=${p1.marker}`;
  if (!p1.queries.find((q) => q.is_marker && q.query === "окна пвх москва")) return "marker not flagged is_marker";
  return true;
});

step("read-input --from-audit -> exit 0, only selected page", () => {
  // copy audit.json into the metatags dir (read-input reads <dir>/audit.json)
  const out = join(SANDBOX, "mt-audit");
  mkdirSync(out, { recursive: true });
  writeJson(join(out, "audit.json"), readJson(join(auditDir, "audit.json")));
  const r = runScript("read-metatags-input.mjs", [out, "--from-audit"]);
  if (r.code !== 0) return `exit ${r.code}`;
  const j = readJson(join(out, "pages.json"));
  if (j.total !== 1) return `total=${j.total} (expect 1 selected)`;
  if (j.pages[0].client_notes !== "Title неинформативный") return "reason not mapped to client_notes";
  return true;
});

step("read-input empty structure (all «no») -> exit 2", () => {
  const out = join(SANDBOX, "mt-empty");
  const r = runScript("read-metatags-input.mjs", [out, "--from-structure", emptyStruct]);
  if (r.code !== 2) return `exit ${r.code} (expect 2)`;
  return true;
});

// ──────────────────────────────────────────────────────────────────────────
// 2. select-variations.mjs
// ──────────────────────────────────────────────────────────────────────────

const svDir = join(SANDBOX, "sv");
writeJson(join(svDir, "research.json"), {
  depth: "deep", region_yandex: 213, total_pages: 3,
  pages: [
    { n: 1, url: "/", type: "home", name: "Главная", marker: "кухни москва", variants: [
      { form: "кухни москва", freq_base: 9000, freq_phrase: 4000, freq_exact: 3000, comm: 0.7, geo: 1, is_original_marker: true },
      { form: "что такое кухня", freq_base: 200, freq_phrase: 50, freq_exact: 30, comm: 0.05, geo: 0, is_original_marker: false },
    ], suggests: [] },
    { n: 2, url: "/uslugi/zamer/", type: "service", name: "Замер", marker: "замер кухни", variants: [
      { form: "замер кухни", freq_base: 300, freq_phrase: 80, freq_exact: 40, comm: 0.2, geo: 0, is_original_marker: true },
      { form: "замер кухни бесплатно", freq_base: 150, freq_phrase: 50, freq_exact: 25, comm: 0.25, geo: 0, is_original_marker: false },
    ], suggests: [] },
    { n: 3, url: "/dostavka/", type: "info", name: "Доставка", marker: "", variants: [], suggests: [] },
  ],
});

step("select-variations runs -> shortlist.json", () => {
  const r = runScript("select-variations.mjs", [svDir]);
  if (r.code !== 0) return `exit ${r.code}`;
  if (!existsSync(join(svDir, "shortlist.json"))) return "shortlist.json не создан";
  return true;
});

step("select-variations: low-Comm form dropped on n1", () => {
  const j = readJson(join(svDir, "shortlist.json"));
  if (j.summary.dropped_forms_total < 1) return `dropped=${j.summary.dropped_forms_total}`;
  const p1 = j.pages.find((p) => p.n === 1);
  if (p1.chosen_form !== "кухни москва") return `n1 chosen=${p1.chosen_form}`;
  if (p1.shortlist.find((f) => f.form === "что такое кухня")) return "low-comm form leaked into shortlist";
  return true;
});

step("select-variations: n2 all-low fallback keeps best", () => {
  const j = readJson(join(svDir, "shortlist.json"));
  const p2 = j.pages.find((p) => p.n === 2);
  if (!p2.all_low_commerce) return "all_low_commerce not set";
  if (p2.chosen_form !== "замер кухни") return `n2 chosen=${p2.chosen_form}`;
  return true;
});

step("select-variations: n3 info passthrough", () => {
  const j = readJson(join(svDir, "shortlist.json"));
  const p3 = j.pages.find((p) => p.n === 3);
  if (!p3.is_non_commercial) return "info not flagged non_commercial";
  if (p3.toponym_signal !== false) return "info toponym_signal should be false";
  return true;
});

// ──────────────────────────────────────────────────────────────────────────
// 3. build-metatags-xlsx.mjs
// ──────────────────────────────────────────────────────────────────────────

const buildDir = join(SANDBOX, "build");
writeJson(join(buildDir, "inputs.json"), { slug: "test", domain: "test.ru", region_name: "Москва", source: "table", forbidden_phrasings: ["лидер рынка"] });
writeJson(join(buildDir, "pages.json"), {
  source: "table", total: 3,
  pages: [
    { n: 1, url: "/", type: "home", name: "Главная", marker: "двери москва", queries: [] },
    { n: 2, url: "/catalog/", type: "category", name: "Каталог", marker: "двери купить", queries: [] },
    { n: 3, url: "/info/", type: "info", name: "Инфо", marker: "", queries: [] },
  ],
});
// page 1: ok; page 2: title over 60; page 3: missing (no file) -> stub
writeJson(join(buildDir, "pages", "1.json"), {
  n: 1, url: "/", type: "home", name: "Главная", marker: "двери москва", chosen_form: "двери москва",
  h1: "Двери москва межкомнатные и входные", title: "Двери москва купить недорого | Салон Порта", description: "Двери москва в наличии. Доставка, установка, гарантия 3 года. Звоните.",
  title_len: 42, desc_len: 70, analytics: { exact: 3000, comm: 0.7, geo: 1, depth: "deep", pattern: "маркер | бренд" }, flags: [], notes: "",
});
writeJson(join(buildDir, "pages", "2.json"), {
  n: 2, url: "/catalog/", type: "category", name: "Каталог", marker: "двери купить", chosen_form: "двери купить",
  h1: "Двери купить в каталоге", title: "Двери купить в Москве с доставкой установкой и гарантией по самой выгодной цене", description: "Двери купить.",
  title_len: 30, desc_len: 13, analytics: { exact: 1000, comm: 0.8, geo: 1, depth: "deep", pattern: "маркер" }, flags: ["title_over_60"], notes: "длинный",
});

step("build-metatags-xlsx runs -> A7_test.xlsx", () => {
  const r = runScript("build-metatags-xlsx.mjs", [buildDir]);
  if (r.code !== 0) return `exit ${r.code}: ${r.stdout}`;
  if (!existsSync(join(buildDir, "A7_test.xlsx"))) return "A7_test.xlsx не создан";
  return true;
});

step("A7 has 3 sheets + n2 Title over-limit highlight", () => {
  return checkXlsx(join(buildDir, "A7_test.xlsx"));
});

// ──────────────────────────────────────────────────────────────────────────
// 4. verify-metatags.mjs
// ──────────────────────────────────────────────────────────────────────────

step("verify-metatags: violations + missing -> exit 2", () => {
  // buildDir has page 3 missing + page 2 title>60 + forbidden? (no). Add forbidden to a page.
  const r = runScript("verify-metatags.mjs", [buildDir]);
  if (r.code !== 2) return `exit ${r.code} (expect 2)`;
  if (!/нет pages\/3\.json/.test(r.stdout)) return "missing page 3 not reported";
  if (!/Title \d+ симв\. > 60/.test(r.stdout)) return "title>60 not reported";
  return true;
});

step("verify-metatags: clean single page -> exit 0", () => {
  const cl = join(SANDBOX, "verify-clean");
  writeJson(join(cl, "inputs.json"), { slug: "clean", forbidden_phrasings: ["лидер рынка"] });
  writeJson(join(cl, "pages.json"), { total: 1, pages: [{ n: 1, url: "/", type: "home", name: "Главная", marker: "ремонт спб", queries: [] }] });
  writeJson(join(cl, "pages", "1.json"), {
    n: 1, url: "/", type: "home", name: "Главная", marker: "ремонт спб", chosen_form: "ремонт спб",
    h1: "Ремонт спб под ключ от студии", title: "Ремонт спб под ключ | Цена от 3000", description: "Ремонт спб под ключ. Смета за день, гарантия. Звоните.",
    title_len: 34, desc_len: 53, analytics: { depth: "bulk" }, flags: [], notes: "",
  });
  const r = runScript("verify-metatags.mjs", [cl]);
  if (r.code !== 0) return `exit ${r.code}: ${r.stdout}`;
  return true;
});

step("verify-metatags: forbidden phrasing caught -> exit 2", () => {
  const fb = join(SANDBOX, "verify-forbidden");
  writeJson(join(fb, "inputs.json"), { slug: "fb", forbidden_phrasings: ["лидер рынка"] });
  writeJson(join(fb, "pages.json"), { total: 1, pages: [{ n: 1, url: "/", type: "home", name: "Главная", marker: "окна", queries: [] }] });
  writeJson(join(fb, "pages", "1.json"), {
    n: 1, url: "/", type: "home", name: "Главная", marker: "окна", chosen_form: "окна",
    h1: "Окна пластиковые", title: "Окна купить недорого", description: "Окна от компании. Мы лидер рынка пластиковых окон.",
    title_len: 20, desc_len: 50, analytics: {}, flags: [], notes: "",
  });
  const r = runScript("verify-metatags.mjs", [fb]);
  if (r.code !== 2) return `exit ${r.code} (expect 2)`;
  if (!/лидер рынка/.test(r.stdout)) return "forbidden phrasing not reported";
  return true;
});

// ──────────────────────────────────────────────────────────────────────────
// 5. Финальный verify после сборки xlsx (шаг 7.5а /seo-metategi)
// ──────────────────────────────────────────────────────────────────────────

// Полная чистая пачка: все pages/<n>.json на месте, без нарушений. Собираем xlsx,
// затем прогоняем финальный verify с --accept-degraded (контракт шага 7.5а:
// финальный прогон на готовом артефакте проходит).
const finalDir = join(SANDBOX, "verify-final");
writeJson(join(finalDir, "inputs.json"), { slug: "final", domain: "final.ru", region_name: "Москва", source: "table", forbidden_phrasings: ["лидер рынка"] });
writeJson(join(finalDir, "pages.json"), {
  source: "table", total: 2,
  pages: [
    { n: 1, url: "/", type: "home", name: "Главная", marker: "окна пвх спб", queries: [] },
    { n: 2, url: "/catalog/", type: "category", name: "Каталог", marker: "окна купить", queries: [] },
  ],
});
writeJson(join(finalDir, "pages", "1.json"), {
  n: 1, url: "/", type: "home", name: "Главная", marker: "окна пвх спб", chosen_form: "окна пвх спб",
  h1: "Окна пвх спб под ключ", title: "Окна пвх спб под ключ | Цена от 9000", description: "Окна пвх спб с монтажом. Замер бесплатно, гарантия 5 лет. Звоните.",
  title_len: 36, desc_len: 65, analytics: { depth: "deep" }, flags: [], notes: "",
});
writeJson(join(finalDir, "pages", "2.json"), {
  n: 2, url: "/catalog/", type: "category", name: "Каталог", marker: "окна купить", chosen_form: "окна купить",
  h1: "Окна купить в каталоге", title: "Окна купить в спб недорого | Салон", description: "Окна купить с установкой. Рассрочка, скидки, гарантия. Оставьте заявку.",
  title_len: 34, desc_len: 71, analytics: { depth: "bulk" }, flags: [], notes: "",
});

step("build-metatags-xlsx на чистой полной пачке -> A7_final.xlsx", () => {
  const r = runScript("build-metatags-xlsx.mjs", [finalDir]);
  if (r.code !== 0) return `exit ${r.code}: ${r.stdout}`;
  if (!existsSync(join(finalDir, "A7_final.xlsx"))) return "A7_final.xlsx не создан";
  return true;
});

step("verify-metatags финальный прогон после xlsx (--accept-degraded) -> exit 0", () => {
  const r = runScript("verify-metatags.mjs", [finalDir, "--accept-degraded"]);
  if (r.code !== 0) return `exit ${r.code}: ${r.stdout}`;
  return true;
});

step("verify-metatags --accept-degraded не блокирует свежую деградацию -> exit 0", () => {
  const dg = join(SANDBOX, "verify-degraded");
  writeJson(join(dg, "inputs.json"), { slug: "dg", forbidden_phrasings: [] });
  writeJson(join(dg, "pages.json"), { total: 1, pages: [{ n: 1, url: "/", type: "home", name: "Главная", marker: "двери спб", queries: [] }] });
  writeJson(join(dg, "pages", "1.json"), {
    n: 1, url: "/", type: "home", name: "Главная", marker: "двери спб", chosen_form: "двери спб",
    h1: "Двери спб на заказ", title: "Двери спб на заказ | Салон дверей", description: "Двери спб на заказ. Замер, доставка, установка под ключ. Звоните.",
    title_len: 33, desc_len: 64, analytics: { depth: "deep" }, flags: ["mcp_degraded"], notes: "выдача arsenkin не пришла",
  });
  const r = runScript("verify-metatags.mjs", [dg, "--accept-degraded"]);
  if (r.code !== 0) return `exit ${r.code}: ${r.stdout}`;
  return true;
});

// === xlsx checker (sync wrapper over async exceljs read via a temp marker) ===
function checkXlsx(path) {
  // exceljs is async; run a tiny synchronous spawn of node to read it.
  const code = `
import ExcelJS from "exceljs";
const wb=new ExcelJS.Workbook(); await wb.xlsx.readFile(${JSON.stringify(path)});
const names=wb.worksheets.map(w=>w.name).join("|");
const ws1=wb.getWorksheet("Метатеги");
let n2fill="-";
for(let r=2;r<=ws1.rowCount;r++){ if(ws1.getCell(r,1).value===2){ const f=ws1.getCell(r,6).fill; n2fill=(f&&f.fgColor&&f.fgColor.argb)||"-"; } }
process.stdout.write(JSON.stringify({names, rows: ws1.rowCount-1, n2fill}));
`;
  const tmp = join(SANDBOX, "_xlsxcheck.mjs");
  writeFileSync(tmp, code);
  let res;
  try {
    const out = execFileSync("node", [tmp], { encoding: "utf8" });
    res = JSON.parse(out);
  } catch (err) {
    return `xlsx read failed: ${err.message}`;
  }
  if (res.names !== "Метатеги|Аналитика|Сводка") return `sheets=${res.names}`;
  if (res.rows !== 3) return `Метатеги rows=${res.rows} (expect 3)`;
  // page 2 title=78 chars > 60 -> "over" fill FFF8CBAD
  if (res.n2fill !== "FFF8CBAD") return `n2 Title fill=${res.n2fill} (expect FFF8CBAD over-limit)`;
  return true;
}

// === Итог ===
console.log("");
console.log(`=== ${passed}/${passed + failed} tests passed ===`);
if (failed > 0) {
  for (const f of failures) console.error(`  FAIL: ${f}`);
  process.exit(1);
}
process.exit(0);
