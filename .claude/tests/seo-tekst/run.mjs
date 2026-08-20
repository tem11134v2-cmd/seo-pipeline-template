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

// ──────────────────────────────────────────────────────────────────────────
console.log("");
console.log("=== build-tekst-analysis-docx.mjs (регистр + «Что нужно от вас») ===");
// ──────────────────────────────────────────────────────────────────────────

const dirReg = join(SANDBOX, "register");
mkdirSync(dirReg, { recursive: true });
writeFileSync(join(dirReg, "inputs.json"), JSON.stringify({ slug: "regtest", brand_name: "ВентПро", niche: "монтаж вентиляции" }), "utf8");
writeFileSync(join(dirReg, "audience.json"), JSON.stringify({ personas: [], summary: { pains: ["душно"] } }), "utf8");
writeFileSync(join(dirReg, "strategy.json"), JSON.stringify({
  decisions: {
    register: {
      variants: [
        "Вентиляция под ключ за 30 дней · Смета за день, цена в договоре · Рассчитать стоимость",
        "Вентиляция производств в Казани · Свой монтажный штат, гарантия 3 года · Рассчитать смету",
        "Ведем три объекта одновременно, больше не берем · Полный цикл, от 900 000 руб. · Обсудить объект",
      ],
      recommended: 1,
      rationale: ["импульс", "средний чек", "лимит загрузки"],
      axes: [{ a: "продающий", b: "умеренный", c: "деловой-человеческий" }, { a: "деловой", b: "умеренный", c: "деловой-человеческий" }, { a: "отбирающий", b: "функциональный", c: "официальный" }],
      chosen: null,
    },
    positioning: { variants: ["Монтируем вентиляцию под ключ"], recommended: 0, rationale: ["прямо"], chosen: null },
  },
  selling_theses: [
    { thesis: "Собственный конструкторский отдел", label: "гордость" },
    { thesis: "Аттестованная лаборатория", label: "гордость", repacked: "Выходите на приемку с полным пакетом документов" },
    { thesis: "Свой монтажный штат", label: "выгода" },
  ],
  proof_inventory: [
    { proof: "Лицензия N 12345 в открытом реестре", level: 1, artifact: "реестр" },
    { proof: "600+ сделок", level: 3 },
  ],
  materials_have: ["фото объектов"],
  materials_missing: ["2-3 кейса с числами"],
}), "utf8");
writeFileSync(join(dirReg, "facts.json"), JSON.stringify({
  jur: { entity: "ООО ВентПро", requisites: { inn: "", ogrn: "1234567890123", address: "[ЗАПОЛНИТЬ: юридический адрес]" } },
  product_guarantee: { what: "монтаж вентиляции", guarantee: "[ЗАПОЛНИТЬ: формулировка гарантии]", deadlines: "14 дней", prices: "" },
  numbers: [
    { label: "лет на рынке", value: "", publish: "as-is" },
    { label: "маржа", value: "", publish: "no" },
  ],
}), "utf8");

step("регистр: три варианта первого экрана отрисованы построчно, служебные оси НЕ показаны", () => {
  const r = run([BUILD_DOCX, dirReg]);
  if (r.code !== 0) return `exit ${r.code}: ${r.stderr}`;
  const { text } = docxText(join(dirReg, "Analysis_regtest.docx"));
  if (!text.includes("Тон общения с клиентом")) return "секции регистра нет";
  if (!text.includes("Вентиляция под ключ за 30 дней")) return "варианты не отрисованы";
  if (!/кнопка/i.test(text)) return "строка «кнопка:» не выделена - вариант напечатан одной строкой";
  for (const axis of ["продающий", "деловой-человеческий", "отбирающий", "функциональный"]) {
    if (text.includes(axis)) return `служебная координата «${axis}» утекла заказчику`;
  }
  return true;
});

step("секция «Что нужно от вас» собрана из дыр facts.json + materials_missing", () => {
  const { text } = docxText(join(dirReg, "Analysis_regtest.docx"));
  if (!text.includes("Что нужно от вас")) return "секции нет";
  if (!/гарант/i.test(text)) return "дыра product_guarantee.guarantee не попала";
  if (!/ИНН|инн/.test(text)) return "пустой ИНН не попал";
  if (!text.includes("2-3 кейса с числами")) return "materials_missing не переехали в секцию";
  if (/маржа/i.test(text)) return "число с publish:\"no\" попало в запрос - это не дыра, а запрет на публикацию";
  return true;
});

step("тезисы и доказательства: объекты не утекают как [object Object], «гордость» без переупаковки скрыта", () => {
  const { text } = docxText(join(dirReg, "Analysis_regtest.docx"));
  if (text.includes("[object Object]")) return "объект уехал в документ как [object Object]";
  if (text.includes("Собственный конструкторский отдел")) return "непереупакованная «гордость продавца» показана заказчику";
  if (!text.includes("Выходите на приемку с полным пакетом документов")) return "переупакованный тезис потерян";
  if (!/проверяемо третьей стороной/i.test(text)) return "уровень доказательства не отрисован";
  return true;
});

// ──────────────────────────────────────────────────────────────────────────
console.log("");
console.log("=== verify-copy.mjs (греп-слой правил текста: только предупреждения) ===");
// ──────────────────────────────────────────────────────────────────────────

// Все проверки этого слоя - W: у конструкций есть законные употребления,
// решение принимает copy-auditor. Ни одна не имеет права дать exit 2.
function copyWarn(slotText, extra = {}) {
  return run([VERIFY_COPY, copyPage({
    ...extra,
    blocks: [HERO_OK, { n: 2, type: "Преимущества", fragment: "cards", h2: "Что вы получаете", slots: { text: slotText } }],
  })]);
}

step("противопоставление «а не» -> W, сборку не блокирует", () => {
  const r = copyWarn("Считаем смету по объекту, а не по среднему прайсу.");
  if (r.code !== 0) return `exit ${r.code}, ожидался 0`;
  if (!/контраст|противопоставл/i.test(r.stdout)) return "предупреждения про контраст нет";
  return true;
});

step("придаточное цели с отрицанием («чтобы не») -> W", () => {
  const r = copyWarn("Отсекаем нецелевые заявки, чтобы бюджет не уходил впустую.");
  if (r.code !== 0) return `exit ${r.code}, ожидался 0`;
  if (!/чтобы не|хвост|досказ/i.test(r.stdout)) return "предупреждения про хвост нет";
  return true;
});

step("третье лицо («наша компания») -> W", () => {
  const r = copyWarn("Наша компания работает с 2005 года и ведет объекты под ключ.");
  if (r.code !== 0) return `exit ${r.code}, ожидался 0`;
  if (!/треть|лиц/i.test(r.stdout)) return "предупреждения про третье лицо нет";
  return true;
});

step("смешение обращения ты/вы -> W (проверка по глаголам, а не по местоимениям)", () => {
  const r = copyWarn("Оставляете заявку и получаете смету. Дальше выбираешь удобную дату и подтверждаешь выезд.");
  if (r.code !== 0) return `exit ${r.code}, ожидался 0`;
  if (!/обращени/i.test(r.stdout)) return "предупреждения про обращение нет";
  return true;
});

step("ложное срабатывание обращения: существительное в предложном не считается «вы»-формой", () => {
  const r = copyWarn("Работаем по договору, в личном кабинете видите статус заявки.");
  if (r.code !== 0) return `exit ${r.code}, ожидался 0`;
  if (/обращени[ея] плыв/i.test(r.stdout)) return "ложное срабатывание: обращение объявлено плывущим";
  return true;
});

step("предложение длиннее 20 слов -> W (читаемость с телефона, не анти-ИИ)", () => {
  const r = copyWarn("Мы проектируем и монтируем системы вентиляции для производственных помещений любой сложности с учетом требований пожарной безопасности и санитарных норм вашего региона.");
  if (r.code !== 0) return `exit ${r.code}, ожидался 0`;
  if (!/20 слов|длин/i.test(r.stdout)) return "предупреждения про длину предложения нет";
  return true;
});

step("регистр отбирающий: перебор мест с CTA -> W, сборку не блокирует", () => {
  const dir = join(SANDBOX, "copy", "reg-cta");
  const pageDir = join(dir, "pages", "test");
  mkdirSync(pageDir, { recursive: true });
  writeFileSync(join(dir, "inputs.json"), JSON.stringify({ brand_name: "ВентПро" }), "utf8");
  writeFileSync(join(dir, "strategy.json"), JSON.stringify({
    decisions: { register: { variants: ["a", "b", "c"], recommended: 1, axes: [{ a: "продающий" }, { a: "деловой" }, { a: "отбирающий" }], chosen: 2 } },
  }), "utf8");
  writeFileSync(join(pageDir, "page.json"), JSON.stringify({
    page: { slug: "test", title: "Монтаж вентиляции в Казани", description: "Монтируем вентиляцию под ключ, гарантия 3 года." },
    h1: "Монтаж вентиляции в Казани",
    blocks: [
      { n: 1, type: "Первый экран (Hero)", fragment: "hero", slots: { h1: "Монтаж вентиляции в Казани", subhead: "Ведем три объекта одновременно", cta_label: "Получить расчет" } },
      { n: 2, type: "CTA", fragment: "cta-mid", slots: { cta_label: "Получить смету" } },
      { n: 3, type: "CTA", fragment: "cta-mid", slots: { cta_label: "Забрать прайс" } },
      { n: 4, type: "Форма", fragment: "form", slots: { cta_label: "Оставить заявку" } },
    ],
  }), "utf8");
  const r = run([VERIFY_COPY, pageDir]);
  if (r.code !== 0) return `exit ${r.code}, ожидался 0 (регистр только предупреждает)`;
  if (!/CTA/i.test(r.stdout)) return "предупреждения про число мест с CTA нет";
  if (!/отбирающ/i.test(r.stdout)) return "регистр не назван в предупреждениях";
  return true;
});

step("нет strategy.json -> слой регистра молчит (штатная деградация)", () => {
  const r = copyWarn("Считаем смету по объекту.");
  if (r.code !== 0) return `exit ${r.code}`;
  if (/регистр/i.test(r.stdout)) return "слой регистра сработал без strategy.json";
  return true;
});

// ──────────────────────────────────────────────────────────────────────────
console.log("");
console.log("=== verify-copy.mjs (типографика, repeatables, сверка с blueprint) ===");
// ──────────────────────────────────────────────────────────────────────────

// Страница + blueprint рядом: verify-copy ищет blueprints/<slug>.json на два уровня выше page.json
function copyPageBp({ blocks, bpBlocks }) {
  const dir = join(SANDBOX, "copy", `bp${++copyCase}`);
  const pageDir = join(dir, "pages", "test");
  mkdirSync(pageDir, { recursive: true });
  mkdirSync(join(dir, "blueprints"), { recursive: true });
  writeFileSync(join(dir, "inputs.json"), JSON.stringify({ brand_name: "ВентПро" }), "utf8");
  writeFileSync(join(dir, "blueprints", "test.json"), JSON.stringify({ page: { slug: "test" }, blocks: bpBlocks }), "utf8");
  writeFileSync(join(pageDir, "page.json"), JSON.stringify({
    page: { slug: "test", title: "Монтаж вентиляции в Казани", description: "Монтируем вентиляцию под ключ, гарантия 3 года." },
    h1: "Монтаж вентиляции в Казани",
    blocks,
  }), "utf8");
  return pageDir;
}
const BP_HERO = { n: 1, type: "Первый экран (Hero)", fragment: "hero", limits: { h1: "20-60" } };

step("число словом («три дня») -> W", () => {
  const r = copyWarn("Отгружаем партию за три дня после оплаты.");
  if (r.code !== 0) return `exit ${r.code}, ожидался 0`;
  if (!/цифр/i.test(r.stdout)) return "предупреждения про числа цифрами нет";
  return true;
});

step("прямые кавычки в клиентском тексте -> W (в тексте только елочки)", () => {
  const r = copyWarn('Работаем по договору "под ключ" с фиксированной сметой.');
  if (r.code !== 0) return `exit ${r.code}, ожидался 0`;
  if (!/кавыч/i.test(r.stdout)) return "предупреждения про кавычки нет";
  return true;
});

step("repeatable: 1 плашка при лимите «ровно 3» -> V (ломает сетку)", () => {
  const r = run([VERIFY_COPY, copyPageBp({
    blocks: [{ n: 1, type: "Первый экран (Hero)", fragment: "hero", slots: { h1: "Монтаж вентиляции в Казани", plates: [{ title: "Сроки", text: "Сдаем за 14 дней по договору" }] } }],
    bpBlocks: [{ n: 1, type: "Первый экран (Hero)", fragment: "hero", limits: { h1: "20-60", plates: "ровно 3: title 10-30 + text 30-90" } }],
  })]);
  if (r.code !== 2) return `exit ${r.code}, ожидался 2`;
  if (!/plates|плашк/i.test(r.stdout)) return "в выводе не назван слот plates";
  return true;
});

step("блок есть в blueprint, но текста нет -> V (собирать HTML нельзя)", () => {
  const r = run([VERIFY_COPY, copyPageBp({
    blocks: [{ n: 1, type: "Первый экран (Hero)", fragment: "hero", slots: { h1: "Монтаж вентиляции в Казани", subhead: "Сдаем под пусконаладку" } }],
    bpBlocks: [BP_HERO, { n: 2, type: "Цены", fragment: "pricing", function: "К", limits: { h2: "20-70" } }],
  })]);
  if (r.code !== 2) return `exit ${r.code}, ожидался 2`;
  if (!/blueprint|не написан|недоста/i.test(r.stdout)) return "не сказано, что блок blueprint остался без текста";
  return true;
});

step("блок в режиме «шаблон»: демо-единицы не меряются лимитом запуска (иначе сборка встанет намертво)", () => {
  const r = run([VERIFY_COPY, copyPageBp({
    blocks: [
      { n: 1, type: "Первый экран (Hero)", fragment: "hero", slots: { h1: "Монтаж вентиляции в Казани", subhead: "Сдаем под пусконаладку" } },
      { n: 2, type: "Листинг", fragment: "product-listing", slots: { products: [{ title: "Приточная установка [ЗАПОЛНИТЬ: модель]" }, { title: "Вытяжной вентилятор [ЗАПОЛНИТЬ: модель]" }] } },
    ],
    bpBlocks: [
      BP_HERO,
      { n: 2, type: "Листинг", fragment: "product-listing", mode: "шаблон", demo_units: 2, limits: { products: "6-24 карточки к запуску; в прототипе 2 демо" } },
    ],
  })]);
  if (r.code !== 0) return `exit ${r.code}, ожидался 0: лимит запуска применен к демо-единицам, а текстом это не чинится`;
  return true;
});

step("состав блоков совпадает с blueprint -> сверка молчит", () => {
  const r = run([VERIFY_COPY, copyPageBp({
    blocks: [{ n: 1, type: "Первый экран (Hero)", fragment: "hero", slots: { h1: "Монтаж вентиляции в Казани", subhead: "Сдаем под пусконаладку" } }],
    bpBlocks: [BP_HERO],
  })]);
  if (r.code !== 0) return `exit ${r.code}: ${r.stdout}`;
  return true;
});

// ──────────────────────────────────────────────────────────────────────────
console.log("");
console.log("=== контракт передачи + build-handoff.mjs (ADR-035) ===");
// ──────────────────────────────────────────────────────────────────────────

const BUILD_HANDOFF = join(PROJECT_ROOT, ".claude/scripts/build-handoff.mjs");

step("собранный прототип несет контракт: машинный маркер + видимая плашка", () => {
  const html = readFileSync(join(dirProto, "prototype.html"), "utf8");
  if (!/name="prototype-contract"/.test(html)) return "нет машинного маркера prototype-contract";
  if (!/ЭТО ПРОТОТИП, А НЕ МАКЕТ/i.test(html)) return "нет комментария-контракта в head";
  if (!/pt-contract/.test(html)) return "нет видимой плашки в body";
  const head = html.slice(0, html.indexOf("</head>"));
  if (head.indexOf("charset") > 1024) return "meta charset уехал за окно предсканирования кодировки (1024 байта)";
  return true;
});

step("verify-prototype ловит выпиленный контракт", () => {
  const dirNoContract = join(SANDBOX, "proto-nocontract");
  mkdirSync(dirNoContract, { recursive: true });
  const html = readFileSync(join(dirProto, "prototype.html"), "utf8")
    .replace(/<meta name="prototype-contract"[^>]*>/g, "")
    .replace(/<div class="pt-contract"[\s\S]*?<\/div>\s*<\/div>/, "");
  writeFileSync(join(dirNoContract, "prototype.html"), html, "utf8");
  writeFileSync(join(dirNoContract, "manifest.json"), readFileSync(join(dirProto, "manifest.json"), "utf8"), "utf8");
  const r = run([VERIFY_PROTO, dirNoContract]);
  if (r.code !== 2) return `exit ${r.code}, ожидался 2`;
  if (!/контракт|prototype-contract/i.test(r.stdout)) return "в выводе нет причины про контракт";
  return true;
});

step("build-handoff: таблица блоков с функцией, режим шаблон и открытые плейсхолдеры", () => {
  const dirH = join(SANDBOX, "handoff");
  mkdirSync(join(dirH, "pages", "main"), { recursive: true });
  mkdirSync(join(dirH, "blueprints"), { recursive: true });
  writeFileSync(join(dirH, "inputs.json"), JSON.stringify({ slug: "vent", brand_name: "ВентПро" }), "utf8");
  writeFileSync(join(dirH, "pages", "main", "page.json"), JSON.stringify({
    page: { slug: "main", title: "Монтаж вентиляции", type: "Главная", url: "/" },
    h1: "Монтаж вентиляции в Казани",
    blocks: [
      { n: 1, type: "Первый экран (Hero)", fragment: "hero", slots: { h1: "Монтаж вентиляции в Казани" }, fill_notes: ["реальное число объектов"] },
      { n: 2, type: "Цены", fragment: "pricing", slots: { h2: "Сколько стоит" }, fill_notes: [] },
    ],
  }), "utf8");
  writeFileSync(join(dirH, "blueprints", "main.json"), JSON.stringify({
    page: { slug: "main" },
    blocks: [
      { n: 1, type: "Первый экран (Hero)", fragment: "hero", function: "Р", function_why: "показывает результат и срок", mode: "рабочий" },
      { n: 2, type: "Цены", fragment: "pricing", function: "К", function_why: "человек находит свою группу", mode: "шаблон", empty_state: "Пока нет тарифов", limits: { h2: "20-70" } },
    ],
  }), "utf8");
  writeFileSync(join(dirH, "strategy.json"), JSON.stringify({ materials_missing: ["2-3 кейса с числами"] }), "utf8");
  writeFileSync(join(dirH, "facts.json"), JSON.stringify({ lexicon: { locked: [{ phrase: "под ключ и без субподряда", source: "созвон" }], canonical: [{ thought: "гарантия", wording: "Гарантия 3 года на монтаж", where: "все страницы" }] } }), "utf8");
  const r = run([BUILD_HANDOFF, dirH]);
  if (r.code !== 0) return `exit ${r.code}: ${r.stderr}`;
  const md = readFileSync(join(dirH, "HANDOFF.md"), "utf8");
  if (!/Р - результат|Р \| /.test(md)) return "функция блока не отрисована";
  if (!/показывает результат и срок/.test(md)) return "обоснование блока потеряно";
  if (!/шаблон/.test(md)) return "блок в режиме шаблон не попал в «чего намеренно нет»";
  if (!/реальное число объектов/.test(md)) return "открытые плейсхолдеры не собраны";
  if (!/под ключ и без субподряда/.test(md)) return "дословные слова заказчика не перечислены";
  if (!/Гарантия 3 года на монтаж/.test(md)) return "сквозные формулировки не перечислены";
  if (/[—–]/.test(md)) return "в документе передачи длинное/среднее тире";
  return true;
});

step("build-handoff: в правилах заполнения количество элементов не выдается за число символов", () => {
  const dirH2 = join(SANDBOX, "handoff-limits");
  mkdirSync(join(dirH2, "pages", "main"), { recursive: true });
  mkdirSync(join(dirH2, "blueprints"), { recursive: true });
  writeFileSync(join(dirH2, "inputs.json"), JSON.stringify({ slug: "vent" }), "utf8");
  writeFileSync(join(dirH2, "pages", "main", "page.json"), JSON.stringify({
    page: { slug: "main", title: "Каталог", type: "Категория", url: "/katalog/" },
    h1: "Каталог оборудования",
    blocks: [{ n: 1, type: "Листинг", fragment: "product-listing", slots: { products: [] }, fill_notes: [] }],
  }), "utf8");
  writeFileSync(join(dirH2, "blueprints", "main.json"), JSON.stringify({
    page: { slug: "main" },
    blocks: [{ n: 1, type: "Листинг", fragment: "product-listing", function: "К", function_why: "человек находит свой тип оборудования", mode: "шаблон", demo_units: 2, empty_state: "Пока ничего не нашлось - сбросьте фильтр или оставьте заявку", limits: { areas: "5-8 позиций", features: "3-7 шт. по 20-60 симв." } }],
  }), "utf8");
  const r = run([BUILD_HANDOFF, dirH2]);
  if (r.code !== 0) return `exit ${r.code}: ${r.stderr}`;
  const md = readFileSync(join(dirH2, "HANDOFF.md"), "utf8");
  const row = md.split("\n").find((l) => /^\|\s*areas\s*\|/.test(l)) || "";
  if (!row) return "строки про areas в правилах заполнения нет";
  if (/\|\s*5-8\s*\|/.test(row)) return `количество позиций напечатано как число символов: ${row.trim()}`;
  const rowF = md.split("\n").find((l) => /^\|\s*features\s*\|/.test(l)) || "";
  if (rowF && !/20-60/.test(rowF)) return `поэлементный диапазон символов потерян: ${rowF.trim()}`;
  if (!/Пока ничего не нашлось/.test(md)) return "текст пустого состояния не доехал до разработчика";
  return true;
});

step("build-handoff: нет страниц -> exit 1, файл не создан", () => {
  const dirEmpty = join(SANDBOX, "handoff-empty");
  mkdirSync(dirEmpty, { recursive: true });
  const r = run([BUILD_HANDOFF, dirEmpty]);
  if (r.code !== 1) return `exit ${r.code}, ожидался 1`;
  if (existsSync(join(dirEmpty, "HANDOFF.md"))) return "HANDOFF.md создан при пустой задаче";
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
