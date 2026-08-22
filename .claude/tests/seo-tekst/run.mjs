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
import { writeFileSync, readFileSync, readdirSync, statSync, existsSync, mkdirSync, rmSync, cpSync } from "node:fs";
import { join, resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "../../..");
// Песочница уникальна на прогон. Фиксированная папка ловила залоченный файл от прошлого
// прогона и валила ВЕСЬ набор на очистке - до первой строки отчета. Уникальное имя
// (pid + время) убирает гонку, а чужие песочницы подметаются мягко, в try/catch.
const TMP_ROOT = join(PROJECT_ROOT, ".claude/tmp");
const SANDBOX_PREFIX = "seo-tekst-test";
const SANDBOX = join(TMP_ROOT, `${SANDBOX_PREFIX}-${process.pid}-${Date.now().toString(36)}`);

// Мягкое удаление: залоченный файл (антивирус, открытый проводник, чужой прогон) -
// это не повод ронять набор. Сообщаем и идем дальше.
function softRm(path) {
  try {
    rmSync(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    return true;
  } catch (err) {
    console.log(`  [note] не удалось убрать ${path}: ${err.code || err.message} - пропускаю`);
    return false;
  }
}

// Метем только ОСТЫВШИЕ песочницы: свежая может принадлежать параллельному прогону
// (CI гоняет набор в несколько заходов), и снести ее на ходу - это чужой красный набор.
const SWEEP_AGE_MS = 30 * 60 * 1000;
function sweepOldSandboxes() {
  try {
    if (!existsSync(TMP_ROOT)) return;
    for (const name of readdirSync(TMP_ROOT)) {
      if (!name.startsWith(SANDBOX_PREFIX) || name === basename(SANDBOX)) continue;
      const path = join(TMP_ROOT, name);
      try {
        if (Date.now() - statSync(path).mtimeMs < SWEEP_AGE_MS) continue;
      } catch { /* исчезла сама - и хорошо */ continue; }
      softRm(path);
    }
  } catch (err) {
    console.log(`  [note] обход старых песочниц не удался: ${err.code || err.message} - пропускаю`);
  }
}
const READ_INPUT = join(PROJECT_ROOT, ".claude/scripts/read-tekst-input.mjs");
const BUILD_DOCX = join(PROJECT_ROOT, ".claude/scripts/build-tekst-analysis-docx.mjs");
const BUILD_DOCX_TEXTS = join(PROJECT_ROOT, ".claude/scripts/build-tekst-docx.mjs");

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

// docx - это zip; читаем его средствами node (zlib), без внешних процессов и без временных копий.
// Раньше здесь была PowerShell-распаковка: Expand-Archive требует расширение .zip, поэтому рядом
// заводилась копия docx под .zip-именем - и она оставалась залоченной, роняя следующий прогон.
// Достаем ровно одну запись из центрального каталога zip; ZIP64 тут не нужен, документы мелкие.
function zipEntry(buf, name) {
  let eocd = -1;
  const floor = Math.max(0, buf.length - 22 - 65535);
  for (let i = buf.length - 22; i >= floor; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("не найден конец zip-каталога - файл повреждён или это не docx");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("битая запись центрального каталога zip");
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28);
    const elen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const lho = buf.readUInt32LE(p + 42);
    if (buf.toString("utf8", p + 46, p + 46 + nlen) === name) {
      if (buf.readUInt32LE(lho) !== 0x04034b50) throw new Error("битый локальный заголовок zip");
      const start = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
      const data = buf.subarray(start, start + csize);
      if (method === 0) return data;
      if (method === 8) return inflateRawSync(data);
      throw new Error(`неизвестный метод сжатия zip: ${method}`);
    }
    p += 46 + nlen + elen + clen;
  }
  throw new Error(`в docx нет записи ${name}`);
}

function docxText(docxPath) {
  let xml;
  try {
    xml = zipEntry(readFileSync(docxPath), "word/document.xml").toString("utf8");
  } catch (err) {
    // Внятный FAIL вместо краха набора: видно, какой файл и на чем распаковка встала.
    throw new Error(`распаковка ${basename(docxPath)} не удалась: ${err.code || err.message}`);
  }
  return {
    text: (xml.match(/<w:t[^>]*>[^<]*<\/w:t>/g) || []).map((t) => t.replace(/<[^>]+>/g, "")).join("\n"),
    bulletCount: (xml.match(/<w:numPr>/g) || []).length,
  };
}

// === Фикстуры ===
sweepOldSandboxes();
try {
  mkdirSync(SANDBOX, { recursive: true });
} catch (err) {
  console.error(`[fatal] не создать песочницу ${SANDBOX}: ${err.code || err.message}`);
  process.exit(1);
}

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
console.log("=== прототип v2 (ADR-039): render -> site_manifest -> assemble -> verify ===");
// ──────────────────────────────────────────────────────────────────────────

const BUILD_PROTO = join(PROJECT_ROOT, ".claude/scripts/build-prototype.mjs");
const ASSEMBLE_PROTO = join(PROJECT_ROOT, ".claude/scripts/assemble-prototype.mjs");
const VERIFY_PROTO = join(PROJECT_ROOT, ".claude/scripts/verify-prototype.mjs");

// Фикстура сайта из 3 страниц: главная (документ-уровень: legal, титул), услуга,
// категория с обязательным листингом товаров (opts.filter=true).
// Телефон ГЛАВНОЙ пуст - типовой случай --from-brief: ассемблер обязан подставить
// маску +7 (000) 000-00-00, а не пустой tel:. У услуги телефон нарочно ДРУГОЙ:
// если он утечет в документ, значит ассемблер взял legal не из manifest страницы
// main_slug, а из первой попавшейся.
// В subhead услуги вшиты канарейки пост-обработки: е-с-точками (в data-литерале
// фикстуры - это разрешенное место) и висячий предлог перед «одном» - их обязан
// чинить АССЕМБЛЕР по итоговому документу, а не build-prototype в render.html.
const dirSite = join(SANDBOX, "site");

const protoBlocks = {
  hero: (h1, subhead) => ({ n: 1, type: "Первый экран (Hero)", fragment: "hero", h2: null,
    slots: { h1, subhead, cta_label: "Рассчитать стоимость" }, opts: {}, fill_notes: [] }),
  form: () => ({ n: 8, type: "Форма захвата", fragment: "form", h2: "Оставьте заявку на расчет",
    slots: { subhead: "Перезваниваем в течение рабочего дня", form_title: "Расчет стоимости", cta_label: "Отправить заявку" },
    opts: {}, fill_notes: [] }),
  listing: () => ({ n: 2, type: "Листинг товаров", fragment: "product-listing", h2: "Приточные установки",
    slots: {
      subhead: "Подберем модель под площадь объекта",
      filters: [{ name: "Производительность", options: ["до 500 куб. м/ч", "до 1500 куб. м/ч"] }],
      products: [
        { title: "Приточная установка Комфорт 350", spec: "350 куб. м/ч, до 60 кв. м", url: "#", cta: "Узнать цену", media_alt: "фото установки" },
        { title: "Приточная установка Комфорт 800", spec: "800 куб. м/ч, до 140 кв. м", url: "#", cta: "Узнать цену", media_alt: "фото установки" },
      ],
    }, opts: { filter: true }, fill_notes: [] }),
};

function seedSite(baseDir) {
  const legal = (phone) => ({ company: "ООО ВентПро", inn: "", ogrn: "", address: "", domain: "ventpro.ru", email: "info@ventpro.ru", phone });
  const mk = (slug, pageType, title, marker, blocks, phone) => {
    const d = join(baseDir, "pages", slug);
    mkdirSync(d, { recursive: true });
    writeFileSync(join(d, "manifest.json"), JSON.stringify({
      meta: { project: "ventpro", slug, page_type: pageType, title, description: "Проектируем и монтируем вентиляцию под ключ, гарантия 3 года.", marker },
      theme: "wireframe",
      legal: legal(phone),
      blocks,
    }, null, 2), "utf8");
  };
  mk("main", "Главная", "Монтаж вентиляции в Казани - под ключ за 14 дней", "монтаж вентиляции",
    [protoBlocks.hero("Монтаж вентиляции в Казани", "Проект и монтаж в одном договоре, сдаем за 14 дней"), protoBlocks.form()], "");
  mk("uslugi", "Услуга", "Монтаж вентиляции в квартире - смета за 1 день", "монтаж вентиляции",
    [protoBlocks.hero("Монтаж вентиляции в квартире", "Проверённая схема: смета и монтаж в одном договоре"), protoBlocks.form()], "+7 (999) 111-22-33");
  mk("catalog", "Категория", "Приточные установки - каталог с ценами", "приточные установки",
    [protoBlocks.hero("Приточные установки с монтажом в Казани", "Подбор по площади за 14 дней, монтаж своим штатом"), protoBlocks.listing(), protoBlocks.form()], "");
  writeFileSync(join(baseDir, "site_manifest.json"), JSON.stringify({
    pages: [
      { slug: "main", title: "Главная", type: "Главная", order: 1 },
      { slug: "uslugi", title: "Монтаж вентиляции", type: "Услуга", order: 2 },
      { slug: "catalog", title: "Каталог оборудования", type: "Категория", order: 3 },
    ],
    start: "__index",
    main_slug: "main",
  }, null, 2), "utf8");
}
seedSite(dirSite);

// Клон фикстуры под негативный кейс: каждый ломает свое, эталон не трогает
function cloneSite(name, mutate) {
  const dst = join(SANDBOX, name);
  cpSync(dirSite, dst, { recursive: true });
  if (mutate) mutate(dst);
  return dst;
}

step("build v2: pages/<slug>/render.html без shell (пер-страничного prototype.html больше нет)", () => {
  for (const slug of ["main", "uslugi", "catalog"]) {
    const d = join(dirSite, "pages", slug);
    const r = run([BUILD_PROTO, d]);
    if (r.code !== 0) return `${slug}: exit ${r.code}: ${r.stderr}`;
    if (!existsSync(join(d, "render.html"))) return `${slug}: render.html не создан`;
    if (existsSync(join(d, "prototype.html"))) return `${slug}: создан пер-страничный prototype.html - этого режима больше нет (ADR-039)`;
  }
  const render = readFileSync(join(dirSite, "pages", "main", "render.html"), "utf8");
  if (!render.includes("pt-hero")) return "в render.html нет блоков страницы";
  for (const [what, re] of [
    ["shell (<header)", /<header/i],
    ["контракт-плашка", /pt-contract/],
    ["футер", /<footer/i],
    ["cookie-баннер", /cookie/i],
    ["попап", /popup/i],
  ]) {
    if (re.test(render)) return `в render.html протек ${what} - это уровень документа, его вставляет ассемблер`;
  }
  return true;
});

step("build v2: render НЕ пост-обработан - е-с-точками доживает до ассемблера (канарейка ADR-039)", () => {
  const render = readFileSync(join(dirSite, "pages", "uslugi", "render.html"), "utf8");
  if (!render.includes("ё")) return "е-с-точками уже вычищена в render - normYoFinal переехал из ассемблера в build-prototype";
  return true;
});

step("assemble: один документ - стартовая секция-список + секции страниц по order", () => {
  const r = run([ASSEMBLE_PROTO, dirSite]);
  if (r.code !== 0) return `exit ${r.code}: ${r.stderr} ${r.stdout}`;
  const out = join(dirSite, "prototype.html");
  if (!existsSync(out)) return "prototype.html не создан";
  const html = readFileSync(out, "utf8");
  const tag = (slug) => (html.match(new RegExp(`<section[^>]*data-page="${slug}"[^>]*>`)) || [null])[0];
  const idx = tag("__index");
  if (!idx) return "нет стартовой секции data-page=\"__index\"";
  if (!/pt-index/.test(idx)) return "стартовая секция без класса pt-index";
  if (/\bhidden\b/.test(idx)) return "стартовая секция скрыта - а открываться должен именно список страниц";
  let prev = html.indexOf(idx);
  for (const slug of ["main", "uslugi", "catalog"]) {
    const t = tag(slug);
    if (!t) return `нет секции страницы ${slug}`;
    if (!/\bhidden\b/.test(t)) return `секция ${slug} не скрыта на старте`;
    const pos = html.indexOf(t);
    if (pos < prev) return `секция ${slug} стоит раньше положенного по order`;
    prev = pos;
    if (!html.includes(`href="#p/${slug}"`)) return `в стартовом списке нет ссылки #p/${slug}`;
  }
  return true;
});

step("assemble: PT_ROUTES валиден (pages+title+start) и определен до кода prototype.js", () => {
  const html = readFileSync(join(dirSite, "prototype.html"), "utf8");
  const m = html.match(/window\.PT_ROUTES\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/);
  if (!m) return "нет <script>window.PT_ROUTES = {...}</script>";
  let routes;
  try { routes = JSON.parse(m[1]); } catch (err) { return `PT_ROUTES не парсится как JSON: ${err.message}`; }
  if (routes.start !== "__index") return `start = ${routes.start}, ожидался __index`;
  const slugs = (routes.pages || []).map((p) => p.slug).join(",");
  if (slugs !== "main,uslugi,catalog") return `pages = ${slugs}`;
  if (!(routes.pages || []).every((p) => p.title)) return "у маршрута нет title - плашке возврата нечего показывать";
  // прокси порядка: роутер читает карту при инициализации, значит определение обязано
  // стоять раньше кода prototype.js (первый addEventListener в документе - из него)
  const jsAt = html.indexOf("addEventListener");
  if (jsAt >= 0 && html.indexOf("window.PT_ROUTES") > jsAt) return "PT_ROUTES определен ПОСЛЕ подключения prototype.js";
  return true;
});

step("assemble: неймспейс id <slug>__ + переписанные href и label for; сервисные якоря глобальны", () => {
  const html = readFileSync(join(dirSite, "prototype.html"), "utf8");
  for (const slug of ["main", "uslugi", "catalog"]) {
    if (!html.includes(`id="${slug}__lead"`)) return `нет id="${slug}__lead" - id формы секции не префиксован`;
  }
  if (!html.includes('href="#main__lead"')) return "CTA hero главной не переписан на #main__lead";
  if (!html.includes('id="main__f-agree"') || !html.includes('for="main__f-agree"')) return "label for чекбокса согласия не переписан вместе с id";
  if (/id="lead"/.test(html)) return "голый id=\"lead\" остался - дубль id между секциями";
  if (!html.includes('href="#privacy"')) return "сервисный якорь #privacy пропал или получил префикс";
  if (/#(?:main|uslugi|catalog)__(?:privacy|person-data-consent|cookie|thanks)\b/.test(html)) return "сервисный якорь из закрытого списка получил префикс страницы";
  if (/href="#mainContent"/.test(html)) return "юр-страницы все еще возвращают на #mainContent - должно быть #__back";
  if (!html.includes('href="#__back"')) return "нет возврата #__back из юр-страниц";
  return true;
});

step("assemble: документ-уровень из manifest главной - пустой phone дает маску, чужой legal не течет", () => {
  const html = readFileSync(join(dirSite, "prototype.html"), "utf8");
  const tels = [...new Set(html.match(/href="tel:[^"]*"/g) || [])];
  if (!tels.length) return "tel-ссылок нет вовсе";
  if (tels.some((t) => t === 'href="tel:"')) return `пустая tel-ссылка: ${tels.join(" | ")}`;
  if (tels.length > 1) return `шапка и футер разошлись: ${tels.join(" | ")}`;
  if (/9991112233|111-22-33/.test(html)) return "в документ утек телефон НЕ главной страницы - legal обязан браться из main_slug";
  return true;
});

step("assemble: контракт один на документ, попапов нет, CTA shell переведены на pt-shell-cta", () => {
  const html = readFileSync(join(dirSite, "prototype.html"), "utf8");
  if ((html.match(/name="prototype-contract"/g) || []).length !== 1) return "машинный маркер контракта не ровно один на документ";
  if ((html.match(/class="pt-contract"/g) || []).length !== 1) return "видимая плашка контракта не ровно одна на документ";
  if (/popupTime|popupExit|pt-popup/.test(html)) return "попапы дожили до v2 - по ADR-039 они удалены полностью";
  if (/href="#lead"/.test(html)) return "CTA shell все еще ведет на #lead - должен быть pt-shell-cta с href=\"#\"";
  if (!/pt-shell-cta/.test(html)) return "класса pt-shell-cta нет - роутеру не за что зацепить скролл к форме активной секции";
  return true;
});

step("assemble: normYoFinal + bindHanging применены к итоговому документу", () => {
  const html = readFileSync(join(dirSite, "prototype.html"), "utf8");
  if (/[ёЁ]/.test(html)) return "е-с-точками осталась в итоговом документе";
  if (!html.includes("Проверенная схема")) return "слот с е-с-точками не нормализован (или фикстура услуги потерялась)";
  // NBSP кодом, а не символом - невидимый знак в исходнике теста легко потерять при правке
  const NBSP = String.fromCharCode(160);
  if (!html.includes(`в${NBSP}одном`)) return "висячий предлог «в» не привязан неразрывным пробелом";
  return true;
});

step("verify v2: собранный сайт целиком проходит (exit 0)", () => {
  const r = run([VERIFY_PROTO, dirSite]);
  if (r.code !== 0) return `exit ${r.code}: ${r.stdout} ${r.stderr}`;
  return true;
});

step("assemble: страница без render.html -> падение, битый документ не пишется", () => {
  const dst = cloneSite("site-norender", (d) => {
    rmSync(join(d, "pages", "uslugi", "render.html"), { force: true });
    rmSync(join(d, "prototype.html"), { force: true });
  });
  const r = run([ASSEMBLE_PROTO, dst]);
  if (r.code === 0) return "exit 0 при отсутствующем render.html";
  if (existsSync(join(dst, "prototype.html"))) return "при ошибке записан битый prototype.html";
  return true;
});

step("verify v2: вторая форма в секции -> exit 2 («ровно 1 форма НА СЕКЦИЮ»)", () => {
  const dst = cloneSite("site-2forms", (d) => {
    const mPath = join(d, "pages", "uslugi", "manifest.json");
    const m = readJson(mPath);
    m.blocks.push({ ...m.blocks.find((b) => b.fragment === "form"), n: 99 });
    writeFileSync(mPath, JSON.stringify(m, null, 2), "utf8");
  });
  let r = run([BUILD_PROTO, join(dst, "pages", "uslugi")]);
  if (r.code !== 0) return `пересборка render: exit ${r.code}: ${r.stderr}`;
  r = run([ASSEMBLE_PROTO, dst]);
  if (r.code !== 0) return `assemble: exit ${r.code}: ${r.stderr}`;
  r = run([VERIFY_PROTO, dst]);
  if (r.code !== 2) return `exit ${r.code}, ожидался 2`;
  if (!/форм/i.test(r.stdout + r.stderr)) return "в выводе нет причины про форму";
  return true;
});

step("verify v2: секция типа Категория без листинга товаров -> exit 2 (обязательный блок)", () => {
  const dst = cloneSite("site-nolisting", (d) => {
    const mPath = join(d, "pages", "catalog", "manifest.json");
    const m = readJson(mPath);
    m.blocks = m.blocks.filter((b) => b.fragment !== "product-listing");
    writeFileSync(mPath, JSON.stringify(m, null, 2), "utf8");
  });
  let r = run([BUILD_PROTO, join(dst, "pages", "catalog")]);
  if (r.code !== 0) return `пересборка render: exit ${r.code}: ${r.stderr}`;
  r = run([ASSEMBLE_PROTO, dst]);
  if (r.code !== 0) return `assemble: exit ${r.code}: ${r.stderr}`;
  r = run([VERIFY_PROTO, dst]);
  if (r.code !== 2) return `exit ${r.code}, ожидался 2`;
  if (!/листинг|product-listing/i.test(r.stdout + r.stderr)) return "в выводе не назван листинг товаров";
  return true;
});

step("verify v2: пустой href=\"tel:\" блокирует (exit 2, а не молчаливый пропуск)", () => {
  const dst = cloneSite("site-badtel", (d) => {
    const p = join(d, "prototype.html");
    writeFileSync(p, readFileSync(p, "utf8").replace(/href="tel:[^"]*"/g, 'href="tel:"'), "utf8");
  });
  const r = run([VERIFY_PROTO, dst]);
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
// Фикстура обязана проходить продающий пол (ADR-037): первый экран с цифрой в обещании
// и целевое действие с предметной надписью. Иначе каждый тест ловит ещё и пол, а не своё правило.
const HERO_OK = { n: 1, type: "Первый экран (Hero)", fragment: "hero", h2: null, slots: { h1: "Монтаж вентиляции в Казани", subhead: "Проектируем, монтируем и сдаем под пусконаладку за 14 дней", cta_label: "Рассчитать стоимость" } };

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
    blocks: [{ n: 1, type: "Первый экран (Hero)", fragment: "hero", slots: { h1: "Монтаж вентиляции в Казани", subhead: "Сдаем под пусконаладку за 14 дней", cta_label: "Рассчитать стоимость" } }],
    bpBlocks: [BP_HERO, { n: 2, type: "Цены", fragment: "pricing", function: "К", limits: { h2: "20-70" } }],
  })]);
  if (r.code !== 2) return `exit ${r.code}, ожидался 2`;
  if (!/blueprint|не написан|недоста/i.test(r.stdout)) return "не сказано, что блок blueprint остался без текста";
  return true;
});

step("блок в режиме «шаблон»: демо-единицы не меряются лимитом запуска (иначе сборка встанет намертво)", () => {
  const r = run([VERIFY_COPY, copyPageBp({
    blocks: [
      { n: 1, type: "Первый экран (Hero)", fragment: "hero", slots: { h1: "Монтаж вентиляции в Казани", subhead: "Сдаем под пусконаладку за 14 дней", cta_label: "Рассчитать стоимость" } },
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
    blocks: [{ n: 1, type: "Первый экран (Hero)", fragment: "hero", slots: { h1: "Монтаж вентиляции в Казани", subhead: "Сдаем под пусконаладку за 14 дней", cta_label: "Рассчитать стоимость" } }],
    bpBlocks: [BP_HERO],
  })]);
  if (r.code !== 0) return `exit ${r.code}: ${r.stdout}`;
  return true;
});

// ──────────────────────────────────────────────────────────────────────────
console.log("");
console.log("=== диета контекста писателя (ADR-020) + чистота образцов ===");
// ──────────────────────────────────────────────────────────────────────────

// Замер, предписанный ADR-020 разделом 5 и не сделанный две программы подряд.
// Потолки пересмотрены 2026-08-21 (ADR-037): прежние 22 000 / 14 000 были откалиброваны
// на состоянии, где у писателя не хватало техники продажи - именно это и оказалось диагнозом.
// Числа ниже - фактическое состояние после программы плюс небольшой запас; расти дальше нельзя.
const DIET_TOTAL = 33000;   // page-writer.md + VOICE.md
const DIET_VOICE = 20500;   // VOICE.md отдельно

step("ADR-020: обязательный вход писателя в знаках не растет", () => {
  const voice = readFileSync(join(PROJECT_ROOT, ".claude/skills/seo-tekst/assets/VOICE.md"), "utf8").length;
  const writer = readFileSync(join(PROJECT_ROOT, ".claude/agents/page-writer.md"), "utf8").length;
  const total = voice + writer;
  const line = `VOICE.md ${voice} + page-writer.md ${writer} = ${total} знаков (потолки ${DIET_VOICE} / ${DIET_TOTAL})`;
  if (voice > DIET_VOICE) return `VOICE.md пробил свой потолок: ${line}`;
  if (total > DIET_TOTAL) return `фиксированный вход писателя пробил потолок: ${line}`;
  console.log(`      ${line}`);
  return true;
});

step("образцы в методичках не нарушают собственный свод (е-с-точками, тире)", () => {
  const files = [
    ".claude/skills/seo-tekst/assets/VOICE.md",
    ".claude/skills/seo-tekst/assets/COPY-AUDIT.md",
    ".claude/agents/page-writer.md",
  ];
  const bad = [];
  for (const rel of files) {
    const text = readFileSync(join(PROJECT_ROOT, rel), "utf8");
    for (const m of text.match(/«[^»]*»/g) || []) {
      if (/[ёЁ]/.test(m)) bad.push(`${rel}: ${m.slice(0, 60)} (е-с-точками)`);
      if (/[—–]/.test(m)) bad.push(`${rel}: ${m.slice(0, 60)} (длинное тире)`);
    }
  }
  if (bad.length) return `образец копируется в клиентский текст как есть: ${bad.slice(0, 3).join(" | ")}${bad.length > 3 ? ` и ещё ${bad.length - 3}` : ""}`;
  return true;
});

// ──────────────────────────────────────────────────────────────────────────
console.log("");
console.log("=== verify-copy.mjs: продающий пол (ADR-037) ===");
// ──────────────────────────────────────────────────────────────────────────

// Фикстура пола: свой тип страницы и свой meta.json (там живут selling_floor_waivers).
function floorPage({ type = "Услуга", blocks, waivers = null, facts = true }) {
  const dir = join(SANDBOX, "copy", `floor${++copyCase}`);
  const pageDir = join(dir, "pages", "test");
  mkdirSync(pageDir, { recursive: true });
  writeFileSync(join(dir, "inputs.json"), JSON.stringify({ brand_name: "ВентПро" }), "utf8");
  // F2 жёсткая только когда приземлять ЕСТЬ на что: пустой по публикуемым числам facts.json -
  // это дыра фактуры, а не брак текста, и пол штатно деградирует до предупреждения.
  if (facts) writeFileSync(join(dir, "facts.json"), JSON.stringify({ numbers: [{ label: "лет на рынке", value: "9", publish: "as-is" }, { label: "объектов сдано", value: "137", publish: "as-is" }] }), "utf8");
  if (waivers) writeFileSync(join(dir, "meta.json"), JSON.stringify({ state: "texts-written", selling_floor_waivers: waivers }), "utf8");
  writeFileSync(join(pageDir, "page.json"), JSON.stringify({
    page: { slug: "test", title: "Монтаж вентиляции в Казани", description: "Монтируем вентиляцию под ключ, гарантия 3 года.", type },
    h1: "Монтаж вентиляции в Казани",
    blocks,
  }), "utf8");
  return pageDir;
}
const HERO_NO_NUM = { n: 1, type: "Первый экран (Hero)", fragment: "hero", slots: { h1: "Монтаж вентиляции в Казани", subhead: "Проектируем, монтируем и сдаем под пусконаладку", cta_label: "Рассчитать стоимость" } };

// ГРАНИЦА МАШИНЫ (ADR-037 F2). Обещание приземляется тремя равноправными способами - числом из
// facts.json, названным адресатом, обещанным результатом. Грепом различим только первый, поэтому
// скрипт жёстко валит ТОЛЬКО отсутствие несущего слота, а суждение выносит tekst-verifier.
const HERO_NO_SUB = { n: 1, type: "Первый экран (Hero)", fragment: "hero", slots: { h1: "Монтаж вентиляции в Казани", cta_label: "Рассчитать стоимость" } };

step("F2: коммерческая страница без подзаголовка Hero -> exit 2 (несущий слот пуст)", () => {
  const r = run([VERIFY_COPY, floorPage({ blocks: [HERO_NO_SUB] })]);
  if (r.code !== 2) return `exit ${r.code}, ожидался 2 (нет несущего слота оффера)`;
  if (!/пол F2/.test(r.stdout)) return "нарушение не названо полом F2";
  return true;
});

step("F2: подзаголовок без числа сборку НЕ блокирует - обещание может держаться на адресате", () => {
  const r = run([VERIFY_COPY, floorPage({
    blocks: [{ n: 1, type: "Первый экран (Hero)", fragment: "hero", slots: { h1: "Монтаж вентиляции в Казани", subhead: "Сетям стоматологий: собираем приточку так, что кабинеты не простаивают", cta_label: "Рассчитать стоимость" } }],
  })]);
  if (r.code !== 0) return `exit ${r.code}, ожидался 0: скрипт судит о том, что грепом не различимо`;
  if (!/пол F2/.test(r.stdout)) return "нет предупреждения с отсылкой к tekst-verifier";
  return true;
});

step("F2: число в подзаголовке, которого нет в facts.json -> предупреждение о сочинённой цифре", () => {
  const r = run([VERIFY_COPY, floorPage({
    blocks: [{ n: 1, type: "Первый экран (Hero)", fragment: "hero", slots: { h1: "Монтаж вентиляции в Казани", subhead: "Сдаем под пусконаладку за 21 день, гарантия 12 лет", cta_label: "Рассчитать стоимость" } }],
  })]);
  if (r.code !== 0) return `exit ${r.code}, ожидался 0 (это предупреждение, а не блокировка)`;
  if (!/НЕ подтверждено facts\.json/.test(r.stdout)) return "не сказано, что число не подтверждено фактурой";
  return true;
});

step("F2: тот же случай на некоммерческом типе -> предупреждение, сборку не блокирует", () => {
  const r = run([VERIFY_COPY, floorPage({ type: "Контакты", blocks: [HERO_NO_SUB] })]);
  if (r.code !== 0) return `exit ${r.code}, ожидался 0: пол применён к странице контактов`;
  if (!/пол F2/.test(r.stdout)) return "нет мягкого напоминания про пол";
  return true;
});

step("F2: валидный waiver понижает нарушение до предупреждения", () => {
  const r = run([VERIFY_COPY, floorPage({
    blocks: [HERO_NO_SUB],
    waivers: [{ page: "test", rule: "F2", why: "заказчик снял все цифры", source: "strategy.materials_missing[цифры результата]" }],
  })]);
  if (r.code !== 0) return `exit ${r.code}, ожидался 0: waiver не сработал`;
  if (!/waiver/.test(r.stdout)) return "в отчёте не видно, что пол снят waiver'ом";
  return true;
});

step("F2: waiver без source игнорируется и об этом СООБЩАЕТСЯ", () => {
  const r = run([VERIFY_COPY, floorPage({
    blocks: [HERO_NO_SUB],
    waivers: [{ page: "test", rule: "F2", why: "не хочется", source: "" }],
  })]);
  if (r.code !== 2) return `exit ${r.code}, ожидался 2: waiver без основания принят`;
  if (!/waiver не применён/.test(r.stdout)) return "молчащий waiver: оркестратор решит, что пол снят";
  return true;
});

step("waiver со списком правил в одном поле («F1|F2|F3|F4») не применяется молча", () => {
  const r = run([VERIFY_COPY, floorPage({
    blocks: [HERO_NO_SUB],
    waivers: [{ page: "test", rule: "F1|F2|F3|F4", why: "шаблон скопирован дословно", source: "decisions.register.chosen" }],
  })]);
  if (r.code !== 2) return `exit ${r.code}, ожидался 2: список правил в одном поле снял нарушение`;
  if (!/waiver не применён/.test(r.stdout)) return "не сказано, что waiver не разобран - это молчащий обход пола";
  return true;
});

step("F3: страница без единого целевого действия -> exit 2", () => {
  const r = run([VERIFY_COPY, floorPage({
    blocks: [{ n: 1, type: "Первый экран (Hero)", fragment: "hero", slots: { h1: "Монтаж вентиляции в Казани", subhead: "Сдаем под пусконаладку за 14 дней" } }],
  })]);
  if (r.code !== 2) return `exit ${r.code}, ожидался 2`;
  if (!/пол F3/.test(r.stdout)) return "не названо полом F3";
  return true;
});

step("F3: «Отправить» на главной кнопке -> exit 2, «Подробнее» в карточке листинга -> нет", () => {
  const bad = run([VERIFY_COPY, floorPage({
    blocks: [{ n: 1, type: "Первый экран (Hero)", fragment: "hero", slots: { h1: "Монтаж вентиляции в Казани", subhead: "Сдаем под пусконаладку за 14 дней", cta_label: "Отправить" } }],
  })]);
  if (bad.code !== 2) return `главная кнопка «Отправить» прошла: exit ${bad.code}`;
  const ok = run([VERIFY_COPY, floorPage({
    blocks: [
      { n: 1, type: "Первый экран (Hero)", fragment: "hero", slots: { h1: "Монтаж вентиляции в Казани", subhead: "Сдаем под пусконаладку за 14 дней", cta_label: "Рассчитать стоимость" } },
      { n: 2, type: "Листинг", fragment: "product-listing", slots: { products: [{ title: "Приточная установка", cta: "Подробнее" }, { title: "Вытяжной вентилятор", cta: "Подробнее" }] } },
    ],
  })]);
  if (ok.code !== 0) return `«Подробнее» в карточке листинга заблокировало сборку: exit ${ok.code}: ${ok.stdout}`;
  return true;
});

step("F2: цифра внутри имени («Bitrix24», «152-ФЗ») числом не считается", () => {
  const r = run([VERIFY_COPY, floorPage({
    blocks: [{ n: 1, type: "Первый экран (Hero)", fragment: "hero", slots: { h1: "Настройка Bitrix24 в Казани", subhead: "Внедряем Bitrix24 по 152-ФЗ и сопровождаем портал", cta_label: "Рассчитать стоимость" } }],
  })]);
  if (r.code !== 0) return `exit ${r.code}, ожидался 0: это предупреждение, а не блокировка`;
  if (/НЕ подтверждено facts\.json/.test(r.stdout)) return "«Bitrix24»/«152-ФЗ» разобраны как число - имя продукта принято за цифру обещания";
  if (!/нет числа/.test(r.stdout)) return "нет предупреждения о том, что числа в подзаголовке нет";
  return true;
});

step("F2: число в плашке не заменяет обещание в подзаголовке -> W, а не V", () => {
  const r = run([VERIFY_COPY, floorPage({
    blocks: [{ n: 1, type: "Первый экран (Hero)", fragment: "hero", slots: { h1: "Монтаж вентиляции в Казани", subhead: "Проектируем, монтируем и сдаем под пусконаладку", cta_label: "Рассчитать стоимость", plates: [{ title: "9 лет на рынке", text: "137 объектов сдано" }] } }],
  })]);
  if (r.code !== 0) return `exit ${r.code}, ожидался 0: цифра в плашке должна давать предупреждение, а не блокировать`;
  if (!/не несущем слоте|не в несущем слоте/.test(r.stdout)) return "нет предупреждения про несущий слот";
  return true;
});

step("F2: в facts.json нет публикуемых чисел -> деградация до W (дыра фактуры, не брак текста)", () => {
  const r = run([VERIFY_COPY, floorPage({ blocks: [HERO_NO_NUM], facts: false })]);
  if (r.code !== 0) return `exit ${r.code}, ожидался 0: пол требует цифру, которой в проекте нет`;
  if (!/публикуемых чисел в facts\.json нет вовсе/.test(r.stdout)) return "не сказано, что публикуемых чисел в проекте нет";
  return true;
});

step("F2: бесплатный первый шаг засчитывается за приземление обещания", () => {
  const r = run([VERIFY_COPY, floorPage({
    blocks: [{ n: 1, type: "Первый экран (Hero)", fragment: "hero", slots: { h1: "Консультация юриста по банкротству", subhead: "Разберем вашу ситуацию и честно скажем, спишутся ли долги. Бесплатно и ни к чему не обязывает", cta_label: "Записаться на разбор" } }],
  })]);
  if (r.code !== 0) return `exit ${r.code}: бесплатный шаг не зачтен за приземление`;
  return true;
});

// Тип страницы взят такой, что F1 идет в ЖЁСТКУЮ ветку: «Товар» без слов «листинг/каталог/зонтик».
// Прежняя фикстура («Товар (листинг-зонтик моделей)») отсекалась словом в типе ещё до формы
// страницы - тест проходил и с вырезанной константой CATALOG_SHAPE, то есть не проверял ничего.
// Тест парный: одна и та же страница без каталожной формы обязана валиться, с ней - проходить.
const CATALOG_BLOCKS = [
  { n: 1, type: "Хлебные крошки", fragment: "breadcrumbs", slots: {} },
  { n: 2, type: "Описание направления", fragment: "cards", h2: "Караваны разных производителей", slots: { subhead: "В наличии 12 моделей, доставка по России", items: [{ title: "Выбор", text: "Подберем модель под ваш автомобиль и бюджет" }] } },
  { n: 3, type: "Листинг", fragment: "product-listing", slots: { products: [{ title: "Караван Белка", cta: "Узнать цену и наличие" }] } },
];

step("F1: каталожный рецепт (крошки -> intro -> листинг) без Hero не блокируется", () => {
  const r = run([VERIFY_COPY, floorPage({ type: "Товар", blocks: CATALOG_BLOCKS })]);
  if (r.code !== 0) return `exit ${r.code}: каталожный рецепт заблокирован полом F1: ${r.stdout}`;
  if (!/пол F1: первого экрана нет/.test(r.stdout)) return "нет мягкого напоминания про F1 - похоже, ветка отсутствия Hero вообще не задействована";
  return true;
});

step("F1: тот же тип «Товар» БЕЗ каталожной формы -> exit 2 (жёсткая ветка достижима)", () => {
  const r = run([VERIFY_COPY, floorPage({ type: "Товар", blocks: CATALOG_BLOCKS.slice(1) })]);
  if (r.code !== 2) return `exit ${r.code}, ожидался 2: карточка товара без первого экрана прошла`;
  if (!/пол F1/.test(r.stdout)) return "не названо полом F1";
  return true;
});

step("F2: пометка [ЗАПОЛНИТЬ] в первом экране -> exit 2 (самое видное место читается недоделанным)", () => {
  const r = run([VERIFY_COPY, floorPage({
    blocks: [{ n: 1, type: "Первый экран (Hero)", fragment: "hero", slots: { h1: "Монтаж вентиляции в Казани", subhead: "Сдаем под пусконаладку за 9 лет опыта", cta_label: "Рассчитать стоимость", bonus: "[ЗАПОЛНИТЬ: бонус первого экрана]" } }],
  })]);
  if (r.code !== 2) return `exit ${r.code}, ожидался 2: дыра фактуры в Hero прошла молча`;
  if (!/ЗАПОЛНИТЬ/.test(r.stdout)) return "нарушение не названо пометкой в первом экране";
  return true;
});

step("доставка формулы: объектный рецепт без page_offer в blueprint -> exit 2", () => {
  const dir = join(SANDBOX, "copy", `po${++copyCase}`);
  const pageDir = join(dir, "pages", "test");
  mkdirSync(pageDir, { recursive: true });
  mkdirSync(join(dir, "blueprints"), { recursive: true });
  writeFileSync(join(dir, "inputs.json"), JSON.stringify({ brand_name: "ВентПро" }), "utf8");
  writeFileSync(join(dir, "strategy.json"), JSON.stringify({ offer_formula_recipe: { formula: 1, name: "РКС + выгода", h1: "маркер + регион" } }), "utf8");
  writeFileSync(join(dir, "blueprints", "test.json"), JSON.stringify({ page: { slug: "test" }, blocks: [{ n: 1, type: "Первый экран (Hero)", fragment: "hero", sell: "выгода по срокам, меряется днями, ведет к расчету", limits: { h1: "20-60" } }] }), "utf8");
  writeFileSync(join(pageDir, "page.json"), JSON.stringify({
    page: { slug: "test", title: "Монтаж вентиляции в Казани", description: "Монтируем вентиляцию под ключ, гарантия 3 года.", type: "Услуга" },
    h1: "Монтаж вентиляции в Казани",
    blocks: [HERO_OK],
  }), "utf8");
  const r = run([VERIFY_COPY, pageDir]);
  if (r.code !== 2) return `exit ${r.code}, ожидался 2: формула оффера до ТЗ не доехала, а гейт промолчал`;
  if (!/page_offer/.test(r.stdout)) return "в выводе не назван page_offer";
  return true;
});

step("доставка формулы: рецепт СТРОКОЙ (старая задача) без page_offer -> предупреждение, exit 0", () => {
  const dir = join(SANDBOX, "copy", `po${++copyCase}`);
  const pageDir = join(dir, "pages", "test");
  mkdirSync(pageDir, { recursive: true });
  mkdirSync(join(dir, "blueprints"), { recursive: true });
  writeFileSync(join(dir, "inputs.json"), JSON.stringify({ brand_name: "ВентПро" }), "utf8");
  writeFileSync(join(dir, "strategy.json"), JSON.stringify({ offer_formula_recipe: "Первая строка отвечает на вопрос что это, дальше две выгоды, замыкает кнопка." }), "utf8");
  writeFileSync(join(dir, "blueprints", "test.json"), JSON.stringify({ page: { slug: "test" }, blocks: [{ n: 1, type: "Первый экран (Hero)", fragment: "hero", sell: "выгода по срокам", limits: { h1: "20-60" } }] }), "utf8");
  writeFileSync(join(pageDir, "page.json"), JSON.stringify({
    page: { slug: "test", title: "Монтаж вентиляции в Казани", description: "Монтируем вентиляцию под ключ, гарантия 3 года.", type: "Услуга" },
    h1: "Монтаж вентиляции в Казани",
    blocks: [HERO_OK],
  }), "utf8");
  const r = run([VERIFY_COPY, pageDir]);
  if (r.code !== 0) return `exit ${r.code}, ожидался 0: старая задача обязана деградировать, а не вставать (ADR-031)`;
  if (!/page_offer/.test(r.stdout)) return "нет предупреждения про page_offer";
  return true;
});

step("F1: product-gallery считается первым экраном (у карточки товара своего hero нет)", () => {
  const r = run([VERIFY_COPY, floorPage({
    type: "Товар",
    blocks: [
      { n: 1, type: "Хлебные крошки", fragment: "breadcrumbs", slots: {} },
      { n: 2, type: "Карточка товара (галерея)", fragment: "product-gallery", slots: { h1: "Прицеп-дача Белка", subhead: "Спальных мест 4, снаряженная масса 750 кг", cta_label: "Узнать цену и наличие" } },
    ],
  })]);
  if (r.code !== 0) return `exit ${r.code}: product-gallery не зачтён как первый экран: ${r.stdout}`;
  if (/пол F1/.test(r.stdout)) return "F1 сработал на карточке товара";
  return true;
});

// ──────────────────────────────────────────────────────────────────────────
console.log("");
console.log("=== контракт передачи + build-handoff.mjs (ADR-035) ===");
// ──────────────────────────────────────────────────────────────────────────

const BUILD_HANDOFF = join(PROJECT_ROOT, ".claude/scripts/build-handoff.mjs");

step("собранный документ несет контракт: машинный маркер + видимая плашка (вставляет ассемблер)", () => {
  const html = readFileSync(join(dirSite, "prototype.html"), "utf8");
  if (!/name="prototype-contract"/.test(html)) return "нет машинного маркера prototype-contract";
  if (!/ЭТО ПРОТОТИП, А НЕ МАКЕТ/i.test(html)) return "нет комментария-контракта в head";
  if (!/pt-contract/.test(html)) return "нет видимой плашки в body";
  const head = html.slice(0, html.indexOf("</head>"));
  if (head.indexOf("charset") > 1024) return "meta charset уехал за окно предсканирования кодировки (1024 байта)";
  return true;
});

step("verify v2 ловит выпиленный контракт", () => {
  const dst = cloneSite("site-nocontract", (d) => {
    const p = join(d, "prototype.html");
    const html = readFileSync(p, "utf8")
      .replace(/<meta name="prototype-contract"[^>]*>/g, "")
      .replace(/<div class="pt-contract"[\s\S]*?<\/div>\s*<\/div>/, "");
    writeFileSync(p, html, "utf8");
  });
  const r = run([VERIFY_PROTO, dst]);
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

step("служебные пометки не текут заказчику, а старый формат fill_notes не теряется", () => {
  const dirN = join(SANDBOX, "notes-split");
  mkdirSync(join(dirN, "pages", "new"), { recursive: true });
  mkdirSync(join(dirN, "pages", "old"), { recursive: true });
  writeFileSync(join(dirN, "inputs.json"), JSON.stringify({ slug: "vent", brand_name: "ВентПро" }), "utf8");
  // новый формат: поле notes_internal есть -> fill_notes фильтруется строго
  writeFileSync(join(dirN, "pages", "new", "page.json"), JSON.stringify({
    page: { slug: "new", title: "Монтаж", type: "Услуга", url: "/m/" }, h1: "Монтаж вентиляции",
    blocks: [{ n: 1, type: "Hero", fragment: "hero", slots: { h1: "Монтаж вентиляции" },
      fill_notes: ["слот короче лимита: срезан хвост", "[ЗАПОЛНИТЬ: фото объекта]"],
      notes_internal: ["внутренняя заметка редактора"] }],
  }), "utf8");
  // старый формат: notes_internal нет -> голая строка это дыра фактуры, ее нельзя терять
  writeFileSync(join(dirN, "pages", "old", "page.json"), JSON.stringify({
    page: { slug: "old", title: "Цены", type: "Услуга", url: "/c/" }, h1: "Цены",
    blocks: [{ n: 1, type: "Цены", fragment: "pricing", slots: { h2: "Сколько стоит" },
      fill_notes: ["реальное число объектов"] }],
  }), "utf8");
  const rd = run([BUILD_DOCX_TEXTS, dirN]);
  if (rd.code !== 0) return `build-tekst-docx exit ${rd.code}: ${rd.stderr}`;
  const { text } = docxText(join(dirN, "Texts_vent.docx"));
  if (/срезан хвост|внутренняя заметка/.test(text)) return "служебная пометка уехала заказчику в Texts.docx";
  if (!/фото объекта/.test(text)) return "настоящая дыра фактуры потеряна";
  if (/\[ЗАПОЛНИТЬ: \[ЗАПОЛНИТЬ/.test(text)) return "двойная обертка маркера";
  if (!/реальное число объектов/.test(text)) return "старый формат fill_notes потерян (регресс обратной совместимости)";
  const rh = run([BUILD_HANDOFF, dirN]);
  if (rh.code !== 0) return `build-handoff exit ${rh.code}: ${rh.stderr}`;
  const md = readFileSync(join(dirN, "HANDOFF.md"), "utf8");
  if (/срезан хвост|внутренняя заметка/.test(md)) return "служебная пометка уехала в HANDOFF.md";
  if (!/фото объекта/.test(md) || !/реальное число объектов/.test(md)) return "открытые вопросы в HANDOFF собраны неполно";
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
// Уборка мягкая: не убралось - следующий прогон подметет, набор из-за этого не падает.
softRm(SANDBOX);
console.log("");
console.log(`=== ${passed}/${passed + failed} tests passed ===`);
if (failed > 0) {
  for (const f of failures) console.error(`  FAIL: ${f}`);
  process.exit(1);
}
process.exit(0);
