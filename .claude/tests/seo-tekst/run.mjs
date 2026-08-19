#!/usr/bin/env node
// run.mjs - smoke-тесты автономного источника /seo-tekst --from-brief (ADR-031)
// и секции «0. Состав страниц» в клиентском документе согласования.
// Запуск: .claude\scripts\_node.cmd .claude\tests\seo-tekst\run.mjs
//
// Проверяет:
//   read-tekst-input.mjs --from-brief
//     - собирает pages.json из pages_draft.json, source начинается с "brief:"
//     - страница с include:"нет" (снята на гейте) в pages.json НЕ попадает
//     - slug стабилен для одинакового url между прогонами (от него зависят recon/ и blueprints/)
//     - дубли url|marker схлопываются
//     - все страницы сняты -> exit 2 (контракт «нет целевых»)
//     - битый/отсутствующий черновик -> exit 1, pages.json не перезаписан
//     - регресс: --from-table по-прежнему работает, source = "table:..."
//   build-tekst-analysis-docx.mjs
//     - source brief: -> секция «0. Состав страниц» есть, страницы перечислены
//     - source structure: -> секции НЕТ (состав согласован раньше, в A6)
//     - строки состава без маркера списка (иначе в Word выходит «• 1. ...»)
//
// Exit 0 - все тесты прошли. Exit 1 - есть провал.

import { execFileSync } from "node:child_process";
import { writeFileSync, readFileSync, copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "../../..");
const SANDBOX = join(PROJECT_ROOT, ".claude/tmp/seo-tekst-test");
const READ_INPUT = join(PROJECT_ROOT, ".claude/scripts/read-tekst-input.mjs");
const BUILD_DOCX = join(PROJECT_ROOT, ".claude/scripts/build-tekst-analysis-docx.mjs");

// === Мини-фреймворк (по образцу tests/seo-temi/run.mjs) ===
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

function run(args) {
  try {
    const stdout = execFileSync(process.execPath, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { code: 0, stdout };
  } catch (err) {
    return { code: err.status ?? 1, stdout: String(err.stdout || ""), stderr: String(err.stderr || "") };
  }
}

const readJson = (p) => JSON.parse(readFileSync(p, "utf8").replace(/^﻿/, ""));

// docx - это zip; текст достаём без сторонних зависимостей, через PowerShell-распаковку.
// Expand-Archive работает только с расширением .zip - поэтому сначала копия под .zip-именем.
function docxText(docxPath) {
  const outDir = docxPath + "-unzipped";
  const zipPath = docxPath + ".zip";
  rmSync(outDir, { recursive: true, force: true });
  rmSync(zipPath, { force: true });
  copyFileSync(docxPath, zipPath);
  execSync(
    `powershell -NoProfile -Command "Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${outDir}' -Force"`,
    { stdio: "ignore" }
  );
  const xml = readFileSync(join(outDir, "word/document.xml"), "utf8");
  return {
    text: (xml.match(/<w:t[^>]*>[^<]*<\/w:t>/g) || []).map((t) => t.replace(/<[^>]+>/g, "")).join("\n"),
    bulletCount: (xml.match(/<w:numPr>/g) || []).length,
  };
}

// === Фикстуры ===
rmSync(SANDBOX, { recursive: true, force: true });
mkdirSync(SANDBOX, { recursive: true });

const draft = (pages) => ({ origin: "mixed", site_kind: "услуги", pages, questions: [], missing_facts: [], notes: "фикстура" });
const PAGES_OK = [
  { n: 1, url: "/", type: "Главная", marker: "монтаж вентиляции казань", queries: [], source: "designed", confidence: "high" },
  { n: 2, url: "/montazh/", type: "Услуга", marker: "монтаж вентиляции в квартире", queries: ["вентиляция под ключ"], source: "brief", confidence: "high" },
  { n: 3, url: "/montazh/", type: "Услуга", marker: "монтаж вентиляции в квартире", queries: [], source: "brief", confidence: "low" }, // дубль
  { n: 4, url: "/otzyvy/", type: "Отзывы", marker: "отзывы", queries: [], source: "designed", include: "нет" },                        // снята на гейте
  { n: 5, url: "/kontakty/", type: "Контакты", marker: "контакты вентпро казань", queries: [], source: "designed", confidence: "high" },
];

const dirBrief = join(SANDBOX, "brief");
mkdirSync(dirBrief, { recursive: true });
const draftPath = join(dirBrief, "pages_draft.json");
writeFileSync(draftPath, JSON.stringify(draft(PAGES_OK), null, 2), "utf8");

// ──────────────────────────────────────────────────────────────────────────
console.log("=== read-tekst-input.mjs --from-brief ===");
// ──────────────────────────────────────────────────────────────────────────

step("--from-brief: pages.json собран, source начинается с brief:", () => {
  const r = run([READ_INPUT, dirBrief, "--from-brief", draftPath]);
  if (r.code !== 0) return `exit ${r.code}: ${r.stderr}`;
  const pages = readJson(join(dirBrief, "pages.json"));
  if (!/^brief:/.test(pages.source)) return `source = ${pages.source}`;
  return true;
});

step("--from-brief: include:\"нет\" не попадает в pages.json (снято на гейте)", () => {
  const pages = readJson(join(dirBrief, "pages.json"));
  if (pages.pages.some((p) => p.type === "Отзывы")) return "снятая страница просочилась";
  return true;
});

step("--from-brief: дубль url|marker схлопнут (5 строк черновика -> 3 страницы)", () => {
  const pages = readJson(join(dirBrief, "pages.json"));
  if (pages.count !== 3) return `count = ${pages.count}, ожидалось 3`;
  return true;
});

step("--from-brief: типы и маркеры перенесены без потерь", () => {
  const pages = readJson(join(dirBrief, "pages.json"));
  const byType = pages.pages.map((p) => p.type).sort().join(",");
  if (byType !== "Главная,Контакты,Услуга") return `типы: ${byType}`;
  const svc = pages.pages.find((p) => p.type === "Услуга");
  if (svc.marker !== "монтаж вентиляции в квартире") return `маркер услуги: ${svc.marker}`;
  if (svc.queries[0] !== "вентиляция под ключ") return `queries потеряны: ${JSON.stringify(svc.queries)}`;
  return true;
});

step("--from-brief: slug стабилен между прогонами (на нём висят recon/ и blueprints/)", () => {
  const before = readJson(join(dirBrief, "pages.json")).pages.map((p) => p.slug).join(",");
  const r = run([READ_INPUT, dirBrief, "--from-brief", draftPath]);
  if (r.code !== 0) return `повторный прогон: exit ${r.code}`;
  const after = readJson(join(dirBrief, "pages.json")).pages.map((p) => p.slug).join(",");
  if (before !== after) return `slug поехали: ${before} -> ${after}`;
  return true;
});

step("--from-brief: все страницы сняты -> exit 2 (контракт «нет целевых»)", () => {
  const dirEmpty = join(SANDBOX, "empty");
  mkdirSync(dirEmpty, { recursive: true });
  const p = join(dirEmpty, "pages_draft.json");
  writeFileSync(p, JSON.stringify(draft(PAGES_OK.map((x) => ({ ...x, include: "нет" })))), "utf8");
  const r = run([READ_INPUT, dirEmpty, "--from-brief", p]);
  if (r.code !== 2) return `exit ${r.code}, ожидался 2`;
  if (existsSync(join(dirEmpty, "pages.json"))) return "pages.json создан при пустом составе";
  return true;
});

step("--from-brief: черновика нет -> exit 1, существующий pages.json не тронут", () => {
  const snapshot = readFileSync(join(dirBrief, "pages.json"), "utf8");
  const r = run([READ_INPUT, dirBrief, "--from-brief", join(dirBrief, "no-such-file.json")]);
  if (r.code !== 1) return `exit ${r.code}, ожидался 1`;
  if (readFileSync(join(dirBrief, "pages.json"), "utf8") !== snapshot) return "pages.json перезаписан при ошибке";
  return true;
});

step("регресс: --from-table не сломан, source = table:", () => {
  const dirTable = join(SANDBOX, "table");
  mkdirSync(dirTable, { recursive: true });
  const csv = join(dirTable, "t.csv");
  writeFileSync(csv, "URL,Тип,Маркер\n/uslugi/,Услуга,монтаж вентиляции\n", "utf8");
  const r = run([READ_INPUT, dirTable, "--from-table", csv]);
  if (r.code !== 0) return `exit ${r.code}: ${r.stderr}`;
  const pages = readJson(join(dirTable, "pages.json"));
  if (!/^table:/.test(pages.source)) return `source = ${pages.source}`;
  if (pages.count !== 1) return `count = ${pages.count}`;
  return true;
});

step("источник не задан -> exit 1 и подсказка перечисляет все 4 источника", () => {
  const r = run([READ_INPUT, join(SANDBOX, "brief")]);
  if (r.code !== 1) return `exit ${r.code}, ожидался 1`;
  for (const flag of ["--from-structure", "--from-table", "--from-analysis", "--from-brief"]) {
    if (!r.stderr.includes(flag)) return `в подсказке нет ${flag}`;
  }
  return true;
});

// ──────────────────────────────────────────────────────────────────────────
console.log("");
console.log("=== build-tekst-analysis-docx.mjs (секция «0. Состав страниц») ===");
// ──────────────────────────────────────────────────────────────────────────

function seedDocxInputs(dir) {
  writeFileSync(join(dir, "inputs.json"), JSON.stringify({ slug: "ventkazan", brand_name: "ВентПро", niche: "монтаж вентиляции" }), "utf8");
  writeFileSync(join(dir, "strategy.json"), JSON.stringify({
    decisions: { positioning: { variants: ["Монтируем вентиляцию под ключ", "Инженеры вентиляции"], recommended: 0, rationale: ["прямо", "экспертно"], chosen: null } },
    warmth_stage: 3, offer_formula: 1, selling_theses: ["Свой монтажный участок"],
  }), "utf8");
  writeFileSync(join(dir, "audience.json"), JSON.stringify({
    personas: [{ name: "Владелец квартиры", age: "35-45", pains: [{ problem: "духота" }] }],
    summary: { pains: ["душно ночью"] },
  }), "utf8");
}

seedDocxInputs(dirBrief);

step("source brief: -> секция «0. Состав страниц» есть и перечисляет страницы", () => {
  const r = run([BUILD_DOCX, dirBrief]);
  if (r.code !== 0) return `exit ${r.code}: ${r.stderr}`;
  const { text } = docxText(join(dirBrief, "Analysis_ventkazan.docx"));
  if (!text.includes("0. Состав страниц")) return "секции нет";
  if (!text.includes("монтаж вентиляции в квартире")) return "страницы не перечислены";
  if (!text.includes("Всего страниц: 3")) return "нет итоговой строки с количеством";
  return true;
});

step("строки состава без маркера списка (иначе в Word «• 1. ...»)", () => {
  const { text, bulletCount } = docxText(join(dirBrief, "Analysis_ventkazan.docx"));
  // законные списки в документе - тезисы и боли ЦА; строк состава там быть не должно
  const pagesLines = text.split("\n").filter((l) => /^\d+\. (Главная|Услуга|Контакты)/.test(l)).length;
  if (pagesLines !== 3) return `строк состава ${pagesLines}, ожидалось 3`;
  if (bulletCount > 4) return `маркеров списка ${bulletCount} - похоже, состав отрисован как bullet`;
  return true;
});

step("source structure: -> секции НЕТ (состав согласован раньше, в A6)", () => {
  const dirStruct = join(SANDBOX, "struct");
  mkdirSync(dirStruct, { recursive: true });
  seedDocxInputs(dirStruct);
  const pages = readJson(join(dirBrief, "pages.json"));
  writeFileSync(join(dirStruct, "pages.json"), JSON.stringify({ ...pages, source: "structure:structures/001-x" }), "utf8");
  const r = run([BUILD_DOCX, dirStruct]);
  if (r.code !== 0) return `exit ${r.code}: ${r.stderr}`;
  const { text } = docxText(join(dirStruct, "Analysis_ventkazan.docx"));
  if (text.includes("0. Состав страниц")) return "секция протекла в источник structure";
  if (!text.includes("Решения на ВАШ выбор")) return "документ собрался неполным";
  return true;
});

step("pages.json отсутствует -> docx собирается без падения (graceful)", () => {
  const dirNoPages = join(SANDBOX, "nopages");
  mkdirSync(dirNoPages, { recursive: true });
  seedDocxInputs(dirNoPages);
  const r = run([BUILD_DOCX, dirNoPages]);
  if (r.code !== 0) return `exit ${r.code}: ${r.stderr}`;
  const { text } = docxText(join(dirNoPages, "Analysis_ventkazan.docx"));
  if (text.includes("0. Состав страниц")) return "секция отрисована без pages.json";
  return true;
});

// ──────────────────────────────────────────────────────────────────────────
console.log("");
console.log("=== прототип с пустыми реквизитами (типовой случай --from-brief) ===");
// ──────────────────────────────────────────────────────────────────────────

const BUILD_PROTO = join(PROJECT_ROOT, ".claude/scripts/build-prototype.mjs");
const VERIFY_PROTO = join(PROJECT_ROOT, ".claude/scripts/verify-prototype.mjs");
const dirProto = join(SANDBOX, "proto");
mkdirSync(dirProto, { recursive: true });
writeFileSync(join(dirProto, "manifest.json"), JSON.stringify({
  meta: { slug: "test", title: "Монтаж вентиляции", description: "Тест", project: "ВентПро" },
  theme: "wireframe",
  legal: { company: "", inn: "", ogrn: "", address: "", email: "", phone: "" },
  blocks: [
    { fragment: "hero", data: { h1: "Монтаж вентиляции в квартире", subhead: "Проектируем и монтируем под ключ", cta_label: "Рассчитать стоимость" } },
    { fragment: "form", data: { h2: "Оставьте заявку", cta_label: "Отправить" } },
  ],
}, null, 2), "utf8");

step("build-prototype: пустой legal.phone -> tel-ссылки НЕ пустые и одинаковы в шапке и футере", () => {
  const r = run([BUILD_PROTO, dirProto]);
  if (r.code !== 0) return `exit ${r.code}: ${r.stderr}`;
  const html = readFileSync(join(dirProto, "prototype.html"), "utf8");
  const tels = [...new Set((html.match(/href="tel:[^"]*"/g) || []))];
  if (!tels.length) return "tel-ссылок нет вовсе";
  if (tels.some((t) => t === 'href="tel:"')) return `пустая tel-ссылка: ${tels.join(" | ")}`;
  if (tels.length > 1) return `шапка и футер разошлись: ${tels.join(" | ")}`;
  return true;
});

step("verify-prototype: исправленная страница проходит (exit 0)", () => {
  const r = run([VERIFY_PROTO, dirProto]);
  if (r.code !== 0) return `exit ${r.code}: ${r.stdout} ${r.stderr}`;
  return true;
});

step("verify-prototype: пустой href=\"tel:\" блокирует сборку (exit 2, а не молчаливый пропуск)", () => {
  const dirBad = join(SANDBOX, "proto-bad");
  mkdirSync(dirBad, { recursive: true });
  const html = readFileSync(join(dirProto, "prototype.html"), "utf8").replace(/href="tel:[^"]*"/g, 'href="tel:"');
  writeFileSync(join(dirBad, "prototype.html"), html, "utf8");
  writeFileSync(join(dirBad, "manifest.json"), readFileSync(join(dirProto, "manifest.json"), "utf8"), "utf8");
  const r = run([VERIFY_PROTO, dirBad]);
  if (r.code !== 2) return `exit ${r.code}, ожидался 2`;
  if (!/tel/i.test(r.stdout + r.stderr)) return "в выводе нет причины про tel";
  return true;
});

// ──────────────────────────────────────────────────────────────────────────
console.log("");
console.log("=== verify-copy.mjs (ремонт ложных срабатываний + метатеги) ===");
// ──────────────────────────────────────────────────────────────────────────

const VERIFY_COPY = join(PROJECT_ROOT, ".claude/scripts/verify-copy.mjs");

// verify-copy ищет inputs.json и blueprints/ на два уровня выше page.json,
// поэтому страница обязана лежать по канону: <texts_dir>/pages/<slug>/page.json
let copyCase = 0;
function copyPage({ title = "Монтаж вентиляции в Казани", description = "Монтируем вентиляцию под ключ за 14 дней, гарантия 3 года.", h1 = "Монтаж вентиляции в Казани", blocks }) {
  const dir = join(SANDBOX, "copy", `case${++copyCase}`);
  const pageDir = join(dir, "pages", "test");
  mkdirSync(pageDir, { recursive: true });
  writeFileSync(join(dir, "inputs.json"), JSON.stringify({ brand_name: "ВентПро" }), "utf8");
  writeFileSync(join(pageDir, "page.json"), JSON.stringify({
    page: { slug: "test", title, description, type: "Услуга", url: "/montazh/", marker: "монтаж вентиляции" },
    h1,
    blocks,
  }, null, 2), "utf8");
  return pageDir;
}
const HERO_OK = { n: 1, type: "Первый экран (Hero)", fragment: "hero", h2: null, slots: { h1: "Монтаж вентиляции в Казани", subhead: "Проектируем, монтируем и сдаем под пусконаладку", cta_label: "Рассчитать стоимость" } };

step("чистая страница -> exit 0 (фикстура не ловит сама себя)", () => {
  const r = run([VERIFY_COPY, copyPage({ blocks: [HERO_OK] })]);
  if (r.code !== 0) return `exit ${r.code}: ${r.stdout}`;
  return true;
});

step("метатеги проверяются: длинное тире в title и е-с-точками в description -> exit 2", () => {
  const r = run([VERIFY_COPY, copyPage({
    title: "Монтаж — под ключ",
    description: "Ещё один вариант подачи, всё под ключ.",
    blocks: [HERO_OK],
  })]);
  if (r.code !== 2) return `exit ${r.code}, ожидался 2 (метатеги мимо проверки)`;
  if (!/тире/.test(r.stdout)) return "тире в title не поймано";
  if (!/ё/.test(r.stdout)) return "ё в description не поймано";
  return true;
});

step("жаргон с легальным омонимом (конверсия/сегмент в химии) -> W, не блокирует", () => {
  const r = run([VERIFY_COPY, copyPage({
    blocks: [HERO_OK, { n: 2, type: "Преимущества", fragment: "cards", h2: "Что вы получаете на выходе", slots: { items: [{ title: "Стабильный выход", text: "Конверсия метана 92 процента, сегмент трубы 400 мм по проекту." }] } }],
  })]);
  if (r.code !== 0) return `exit ${r.code}, ожидался 0: отраслевой термин заблокировал сборку`;
  if (!/контекст ниши/.test(r.stdout)) return "нет предупреждения с оговоркой про контекст ниши";
  return true;
});

step("утечка кухни без омонимов (кастдев) -> exit 2", () => {
  const r = run([VERIFY_COPY, copyPage({
    blocks: [HERO_OK, { n: 2, type: "Этапы", fragment: "steps", h2: "Как мы работаем", slots: { items: [{ title: "Шаг 1", text: "Проводим кастдев по вашей базе клиентов." }] } }],
  })]);
  if (r.code !== 2) return `exit ${r.code}, ожидался 2`;
  return true;
});

step("срочность с реальной датой в том же слоте -> W, не блокирует", () => {
  const r = run([VERIFY_COPY, copyPage({
    blocks: [HERO_OK, { n: 2, type: "Акция", fragment: "cta-mid", h2: "Субсидия на монтаж", slots: { text: "Успейте подать заявку до 15.09.2026 - прием документов закрывается." } }],
  })]);
  if (r.code !== 0) return `exit ${r.code}, ожидался 0: честный дедлайн вычищается как манипуляция`;
  return true;
});

step("срочность без даты и остатка -> exit 2", () => {
  const r = run([VERIFY_COPY, copyPage({
    blocks: [HERO_OK, { n: 2, type: "Акция", fragment: "cta-mid", h2: "Скидка", slots: { text: "Успейте оставить заявку, предложение сгорит." } }],
  })]);
  if (r.code !== 2) return `exit ${r.code}, ожидался 2`;
  return true;
});

step("hero опознается по type, а не только по fragment (проверка первого экрана не отваливается)", () => {
  const r = run([VERIFY_COPY, copyPage({
    blocks: [{ n: 1, type: "Первый экран (Hero)", fragment: "hero-alt", h2: null, slots: { h1: "Монтаж вентиляции в Казани", subhead: "Сдаем под пусконаладку 🚀" } }],
  })]);
  if (r.code !== 2) return `exit ${r.code}, ожидался 2: эмодзи на первом экране пропущено`;
  if (!/перв/i.test(r.stdout)) return "в выводе нет причины про первый экран";
  return true;
});

step("эмодзи больше чем в одном блоке -> W (счетное правило вместо «одного источника»)", () => {
  const r = run([VERIFY_COPY, copyPage({
    blocks: [
      HERO_OK,
      { n: 2, type: "Преимущества", fragment: "cards", h2: "Почему это выгодно", slots: { items: [{ title: "Сроки", text: "Сдаем за 14 дней ✅" }] } },
      { n: 3, type: "Гарантии", fragment: "cards", h2: "Что вы получаете по договору", slots: { items: [{ title: "Гарантия", text: "3 года на монтаж 🔧" }] } },
    ],
  })]);
  if (r.code !== 0) return `exit ${r.code}, ожидался 0 (эмодзи вне Hero - предупреждение)`;
  if (!/эмодзи/i.test(r.stdout)) return "предупреждения про эмодзи нет";
  return true;
});

// === Итог ===
rmSync(SANDBOX, { recursive: true, force: true });
console.log("");
console.log(`=== ${passed}/${passed + failed} tests passed ===`);
if (failed > 0) {
  for (const f of failures) console.error(`  FAIL: ${f}`);
  process.exit(1);
}
process.exit(0);
