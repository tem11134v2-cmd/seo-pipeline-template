#!/usr/bin/env node
// run.mjs - набор режима магазина конвейера v8.
// Запуск: .claude\scripts\_node.cmd .claude\tests\catalog\run.mjs
//
// Наборы site и proto держат контракт данных и слой письма. Этот держит то, чем каталог
// от письма ОТЛИЧАЕТСЯ, и держит ровно те места, где ТЗ каталога превращается в фикцию:
//
//   1. ПРИЕМКА ДАННЫХ ПЕРВЫМ ШАГОМ. Фильтр - это проекция атрибутов. Если в прайсе только
//      название и цена, фильтровать не по чему, и красивое ТЗ описывает фильтры, которые
//      нельзя построить. Вердикт машинный, исходов четыре, и от вердикта зависит ВЕСЬ
//      объем режима - это проверяется на четырех фикстурах прайса.
//   2. ПОРОГ ПУБЛИКАЦИИ ОСИ. Заполнено меньше 70 процентов - ось не в фильтре, а в
//      blocked_by_data со строкой «заполнено X процентов из 70».
//   3. ДВЕ БЛОКИРОВКИ, А НЕ ОДНА. Рядом с «невозможно ПО ДАННЫМ» обязано стоять
//      «невозможно НА ВАШЕЙ ПЛАТФОРМЕ». unknown работает как no.
//   4. ТРИ ПАДЕЖНЫЕ ФОРМЫ. Без них первая строка ТЗ читается как «Цены на Насосы
//      циркуляционные», и это видит заказчик.
//   5. РЕЖИМ КАТЕГОРИИ - МАШИННЫЙ ПРИЗНАК. Четыре условия, обязательные H2 либо H4, вето
//      и отдельный исход thin_category. Мягче - треть тонкого каталога станет лендингами.
//   6. ОБЪЕМ СЧИТАЕТСЯ В ПОСАДКАХ, А НЕ В КАТЕГОРИЯХ, и это видно в pages.json и в ТЗ.
//   7. ТОВАРЫ - ДАТА-ПАЙПЛАЙН. Правило пропуска, тиринг, уникальность карточки.
//   8. СКВОЗНОЙ ПРОГОН МАГАЗИНА: прайс - вердикт - дерево - режим - гейт - товары -
//      страницы - TZ-katalog.md и products_out.csv.
//   9. БЮДЖЕТЫ и страховка, что машинерия v7 и этапы 1-2 на месте.
//
// Exit 0 - все шаги прошли. Exit 1 - есть провал.

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, rmSync } from "node:fs";
import { join, resolve, dirname, basename } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../../..");
const TMP_ROOT = join(ROOT, ".claude/tmp");
const PREFIX = "catalog-test";
const SANDBOX = join(TMP_ROOT, `${PREFIX}-${process.pid}-${Date.now().toString(36)}`);

const SITE_SCRIPTS = join(ROOT, ".claude/scripts/site");
const SKILL_DIR = join(ROOT, ".claude/skills/site-proto");
const S = (name) => join(SITE_SCRIPTS, name + ".mjs");
const CATALOG = S("catalog"), VCAT = S("verify-catalog"), PRODUCTS = S("render-products");
const PAGES = S("pages"), TZ = S("build-catalog-tz"), PLAN = S("plan"), TASKS = S("build-tasks");

// Файлы, созданные режимом магазина. Список один: по нему идут и типографика, и страховка.
const MADE = [
  ".claude/skills/site-proto/CATALOG.md",
  ".claude/skills/site-proto/catalog.schema.json",
  ".claude/agents/catalog-architect.md",
  ".claude/scripts/site/catalog.mjs",
  ".claude/scripts/site/verify-catalog.mjs",
  ".claude/scripts/site/render-products.mjs",
  ".claude/scripts/site/build-catalog-tz.mjs",
  ".claude/tests/catalog/run.mjs",
  "docs/v8/contracts-catalog.md"
];

// === Мини-фреймворк (стиль наборов proto и site) ===
let passed = 0;
let failed = 0;
const failures = [];

function step(name, fn) {
  try {
    const result = fn();
    if (result === true || result === undefined) { console.log(`  [test] ${name} ... PASS`); passed++; }
    else { console.log(`  [test] ${name} ... FAIL (${result})`); failed++; failures.push(`${name}: ${result}`); }
  } catch (err) {
    console.log(`  [test] ${name} ... FAIL (${err.message})`);
    failed++;
    failures.push(`${name}: ${err.message}`);
  }
}

function run(args) {
  const r = spawnSync(process.execPath, args, { encoding: "utf8", cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
  const out = String(r.stdout || ""), err = String(r.stderr || "");
  return { code: r.status ?? 1, stdout: out, stderr: err, all: out + err };
}

const chars = (s) => Array.from(String(s == null ? "" : s)).length;
const text = (p) => readFileSync(p, "utf8").replace(/^\ufeff/, "");
const readJson = (p) => JSON.parse(text(p));
const has = (hay, needle) => String(hay).includes(needle);
// Разбор файла на строки одним местом: набор читает csv и markdown построчно.
const lines = (t) => String(t).split(new RegExp(String.fromCharCode(92) + "r?" + String.fromCharCode(92) + "n")).filter(Boolean);

function softRm(path) {
  try { rmSync(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); return true; }
  catch (err) { console.log(`  [note] не убрать ${path}: ${err.code || err.message}`); return false; }
}
const SWEEP_AGE_MS = 30 * 60 * 1000;
function sweepOldSandboxes() {
  try {
    if (!existsSync(TMP_ROOT)) return;
    for (const name of readdirSync(TMP_ROOT)) {
      if (!name.startsWith(PREFIX) || name === basename(SANDBOX)) continue;
      const p = join(TMP_ROOT, name);
      try { if (Date.now() - statSync(p).mtimeMs < SWEEP_AGE_MS) continue; } catch { continue; }
      softRm(p);
    }
  } catch { /* обход не удался - не повод ронять набор */ }
}

// Типографика: в скриптах сами детекторы содержат запрещенные знаки, и это код проверки,
// а не текст. Тот же прием, что в наборе proto.
const TYPO_CLASS = "[\\u2012\\u2013\\u2014\\u2015\\u2212\\u0451\\u0401]";
const YO_CLASS = "[\\u0451\\u0401]";
const stripDetectors = (t) => String(t)
  .replace(/\[[^\]\n]{0,80}\]/g, "[]")
  .replace(new RegExp('"' + TYPO_CLASS + '"', "g"), '""')
  .replace(new RegExp("/" + YO_CLASS + "/", "g"), "//");

sweepOldSandboxes();
try { mkdirSync(SANDBOX, { recursive: true }); }
catch (err) { console.error(`[fatal] не создать песочницу ${SANDBOX}: ${err.code || err.message}`); process.exit(1); }

// === Модули режима грузим напрямую: пороги и лестницы проверяются на константах ===
const imp = (name) => import(pathToFileURL(S(name)).href);
const CAT = await imp("catalog");
const PROD = await imp("render-products");
const TZM = await imp("build-catalog-tz");
const PAGESM = await imp("pages");
const PLANM = await imp("plan");
const CONTRACT = await import(pathToFileURL(join(SITE_SCRIPTS, "_contract.mjs")).href);

// Мерка запрещенной типографики ОДНА на набор и на гейт. Свой класс символов тут уже
// разошелся с _contract.mjs на минусе U+2212: файл режима с минусом проходил шаг
// «типографика чистая», а собранный из него catalog.json падал в verify-catalog
// нарушением. Набор давал зеленый свет тому, чего гейт не пропустит.
const BAD_TYPO = new RegExp(CONTRACT.BAD_TYPO.source, "g");

// ──────────────────────────────────────────────────────────────────────────
// Фикстуры
// ──────────────────────────────────────────────────────────────────────────

function baseProject(slug, type) {
  return {
    v: 2, slug, updated: "2026-09-16", source: ["бриф"], tier: "seo",
    gates: { promise: true, facts3: true, proof1: true, ready: true },
    business: {
      name: "Теплодом", what: "инженерная сантехника и отопление", region: "Тверь",
      type, site_kind: "multipage", site: "teplodom.test",
      assortment: ["насосы", "трубы"],
      directions: [
        { id: "nasosy", name: "Насосы циркуляционные", marker: "насосы циркуляционные купить" },
        { id: "truby", name: "Трубы полипропиленовые", marker: "трубы полипропиленовые" }
      ],
      client_pages: []
    },
    offer: {
      positioning: "склад в Твери",
      promise: { who: "монтажник", result: "забрать со склада сегодня", cta: "Забрать со склада" },
      reasons: [{ claim: "Склад в городе", proof: "адрес склада", kind: "документ" }]
    },
    audience: { segments: [], words: [] },
    competitors: { market: { must_have: [] }, seen_numbers: [] },
    facts: [
      { id: "f01", label: "Доставка по городу", value: "на следующий день", q: ["delivery"], publish: "yes", src: "бриф" },
      { id: "f02", label: "Гарантия", value: "2 года по договору", q: ["delivery"], publish: "yes", src: "бриф" },
      { id: "f03", label: "Оплата", value: "картой и по счету за 1 день", q: ["delivery"], publish: "yes", src: "бриф" },
      { id: "f04", label: "Самовывоз", value: "склад на Спортивной, 4", q: ["delivery"], publish: "yes", src: "бриф" }
    ],
    constraints: { forbidden: [], must_say: [] },
    lexicon: { canonical: [], locked: [] }, gaps: []
  };
}

const csv = (rows) => "\ufeff" + rows.map((r) => r.join(";")).join("\r\n") + "\r\n";

// Прайс 1: атрибуты заполнены - полный режим.
function priceFull() {
  const rows = [["Прайс Теплодом, выгрузка 1С", "", "", "", "", "", "", ""],
    ["Артикул", "Наименование", "Раздел", "Бренд", "Мощность, Вт", "Диаметр, мм", "Цена", "Наличие"]];
  const brands = ["Grundfos", "Wilo", "Unipump"];
  const series = ["UPS", "Star", "Alpha", "Yonos", "Magna"];
  for (let i = 0; i < 18; i++) {
    rows.push(["N" + (100 + i), `Насос ${brands[i % 3]} ${series[i % 5]} ${25 + i}-${40 + i}`,
      "Насосы / Циркуляционные", brands[i % 3], String(32 + (i % 4) * 13), String(25 + (i % 3) * 7),
      String(4200 + i * 310), String(2 + (i % 5))]);
  }
  for (let i = 0; i < 14; i++) {
    rows.push(["T" + (200 + i), `Труба ${["Valtec", "Pro Aqua"][i % 2]} PN20 ${20 + i * 2}`,
      "Трубы / Полипропиленовые", ["Valtec", "Pro Aqua"][i % 2], "", String(20 + i * 2),
      String(90 + i * 11), String(30 + i)]);
  }
  // Две позиции без цены: тир C считается по данным, а не назначается рукой.
  rows.push(["T900", "Труба Valtec PN20 армированная", "Трубы / Полипропиленовые", "Valtec", "", "40", "", "0"]);
  rows.push(["N900", "Насос Wilo Star под заказ", "Насосы / Циркуляционные", "Wilo", "", "", "", "0"]);
  return csv(rows);
}

// Прайс 2: только название и цена, названия без параметров - фильтровать не по чему.
function priceNamesOnly() {
  const rows = [["Артикул", "Наименование", "Цена"]];
  const what = ["Стул деревянный белый", "Стол обеденный раскладной", "Шкаф распашной светлый",
    "Комод с ящиками", "Полка навесная узкая", "Тумба прикроватная", "Кресло мягкое",
    "Диван угловой", "Пуф круглый", "Стеллаж открытый", "Вешалка напольная", "Зеркало настенное"];
  what.forEach((n, i) => rows.push(["M" + (i + 1), n, String(1200 + i * 340)]));
  return csv(rows);
}

// Прайс 3: атрибутов колонками нет, но они лежат в названиях.
function priceDerivable() {
  const rows = [["Артикул", "Наименование", "Цена"]];
  const brands = ["Grundfos", "Wilo", "Unipump"];
  for (let i = 0; i < 15; i++) {
    rows.push(["D" + (i + 1), `Насос ${brands[i % 3]} UPS 25-${40 + i} ${45 + i} Вт`, String(3900 + i * 220)]);
  }
  return csv(rows);
}

// Прайс 4: колонка характеристики есть, но заполнена у меньшинства позиций.
function priceWeak() {
  const rows = [["Артикул", "Наименование", "Раздел", "Материал", "Цена"]];
  const what = ["Стул венский", "Стол обеденный", "Шкаф распашной", "Комод широкий", "Полка навесная",
    "Тумба прикроватная", "Кресло мягкое", "Диван угловой", "Пуф круглый", "Стеллаж открытый",
    "Вешалка напольная", "Зеркало настенное", "Скамья прихожая", "Банкетка мягкая", "Витрина стеклянная"];
  // Заполнено у трети позиций: выше порога атрибута (0,2) и ниже порога оси (0,7).
  // Значения повторяются, иначе колонка читается как артикул, а не как характеристика.
  what.forEach((n, i) => rows.push(["W" + (i + 1), n, "Мебель", i % 3 === 0 ? ["дерево", "металл"][(i / 3) % 2] : "", String(2100 + i * 190)]));
  return csv(rows);
}

// Прайс 5: характеристики заполнены, но товаров в разделе МАЛО. Тонкая категория при
// каталожной выдаче - это thin_category: интро, плитка подкатегорий и noindex, а не лендинг.
function priceThinCat() {
  const rows = [["Артикул", "Наименование", "Раздел", "Бренд", "Диаметр", "Цена"]];
  const brands = ["Grundfos", "Wilo"];
  for (let i = 0; i < 6; i++) {
    rows.push(["N" + (300 + i), `Насос ${brands[i % 2]} UPS ${25 + i}`, "Насосы / Циркуляционные",
      brands[i % 2], `${25 + (i % 3) * 7} мм`, String(4100 + i * 250)]);
  }
  for (let i = 0; i < 12; i++) {
    rows.push(["T" + (300 + i), `Труба ${["Valtec", "Pro Aqua"][i % 2]} PN20`, "Трубы / Полипропиленовые",
      ["Valtec", "Pro Aqua"][i % 2], `${20 + (i % 4) * 5} мм`, String(95 + i * 9)]);
  }
  return csv(rows);
}

const PLATFORM_YES = {
  name: "Битрикс 24.2", kind: "bitrix", facet_url: "path", multi_select: "yes", range: "yes",
  meta_override: "yes", canonical: "yes", clean_param: "yes", noindex: "yes", import: "1c"
};

const RULES_FULL = [
  "names:",
  '  nasosy: "насосы | насосов | насосы"',
  '  cirkulyacionnye: "циркуляционные насосы | циркуляционных насосов | циркуляционные насосы"',
  '  truby: "трубы | труб | трубы"',
  '  polipropilenovye: "полипропиленовые трубы | полипропиленовых труб | полипропиленовые трубы"',
  "formula:",
  '  h1: "{nom} {value}"',
  '  title: "{h1} - цены в каталоге"',
  '  description: "{h1}: {sku} позиций на складе, доставка по региону."',
  "axes:",
  '  brand: "Бренд|enum|landing"',
  '  power: "Мощность, Вт|range|no"',
  '  diameter: "Диаметр, мм|range|no"',
  "specs:",
  '  cirkulyacionnye: "brand|power|diameter"',
  '  polipropilenovye: "brand|diameter"',
  "product:",
  '  h1: "{name}"',
  '  title: "{name} - цена {price}"',
  '  description: "{name}: {price}, {stock} на складе."',
  '  short: "{opener} {name}. {closer}"',
  '  desc: "{fit} {tail} Подключение {diameter} мм. Мощность {power} Вт."',
  "lex:",
  '  opener: "Есть в наличии|Лежит на складе|Привозим под ключ|Держим постоянно"',
  '  closer: "Забирайте сегодня.|Отгружаем в день заказа.|Доставим прямо на объект.|Соберем заказ за час."',
  '  fit: "Ставят в квартирах.|Берут для частных домов.|Годится для теплых полов.|Тянут стояк целиком."',
  '  tail: "Подберем аналог по напору.|Поможем с подбором фитингов.|Проверим совместимость узла.|Посчитаем нужную длину."',
  "service_words:",
  '  extra: "подбор"',
  ""
].join("\n");

function serpFull() {
  const listing = (n, chars0) => Array.from({ length: 10 }, (_, i) => ({ kind: i < n ? "listing" : "article", chars: chars0 + i * 30 }));
  return {
    ws: [
      { q: "циркуляционные насосы grundfos", n: 1400 },
      { q: "циркуляционные насосы wilo", n: 620 },
      { q: "циркуляционные насосы unipump", n: 110 },
      { q: "полипропиленовые трубы valtec", n: 480 }
    ],
    nodes: [
      { id: "nasosy", marker: "насосы циркуляционные купить", queries: ["насосы купить", "насосы цена"], top: listing(9, 900) },
      { id: "cirkulyacionnye", marker: "циркуляционные насосы", queries: ["циркуляционные насосы купить"], top: listing(9, 1100) },
      { id: "truby", marker: "трубы полипропиленовые", queries: ["трубы пп купить"], top: listing(10, 800) },
      { id: "polipropilenovye", marker: "полипропиленовые трубы", queries: ["трубы пп"], top: listing(10, 850) }
    ]
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Прайс в формате xlsx, собранный ТАК, КАК ЕГО ПИШЕТ EXCEL. Разница с csv не
// декоративная: пустую ячейку со стилем Excel печатает самозакрывающимся тегом
// `<c r="D2" s="3"/>`, а пустую строку - как `<row r="3"/>`. Разбор, знающий только
// парный тег, принимает такую ячейку за открывающую и берет телом содержимое СЛЕДУЮЩЕЙ:
// вся строка съезжает влево, цена уезжает в колонку бренда, и каталог собирается из
// испорченных данных молча. Поэтому фикстура пишется байтами, а не берется из библиотеки.
// ──────────────────────────────────────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0 ^ -1;
  for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ CRC_TABLE[(c ^ buf[i]) & 0xff];
  return (c ^ -1) >>> 0;
}
// Zip без сжатия (method 0): прайс на два десятка строк, экономить тут нечего, а inflate
// в фикстуре - лишний источник расхождений.
function zipStore(files) {
  const locals = [], central = [];
  let offset = 0;
  for (const [name, text0] of files) {
    const nameBuf = Buffer.from(name, "utf8");
    const data = Buffer.from(text0, "utf8");
    const crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6);
    lh.writeUInt16LE(0, 8); lh.writeUInt16LE(0, 10); lh.writeUInt16LE(0, 12);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26); lh.writeUInt16LE(0, 28);
    locals.push(lh, nameBuf, data);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0, 8); cd.writeUInt16LE(0, 10); cd.writeUInt16LE(0, 12); cd.writeUInt16LE(0, 14);
    cd.writeUInt32LE(crc, 16); cd.writeUInt32LE(data.length, 20); cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28); cd.writeUInt16LE(0, 30); cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34); cd.writeUInt16LE(0, 36); cd.writeUInt32LE(0, 38);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBuf);
    offset += lh.length + nameBuf.length + data.length;
  }
  const body = Buffer.concat(locals);
  const dir = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(0, 4); eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8); eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(dir.length, 12); eocd.writeUInt32LE(body.length, 16); eocd.writeUInt16LE(0, 20);
  return Buffer.concat([body, dir, eocd]);
}
const xlEsc = (v) => String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
// cell: строка - inlineStr, число - <v>, null - САМОЗАКРЫТАЯ ячейка со стилем.
const xlCell = (ref, v) => {
  if (v === null) return `<c r="${ref}" s="3"/>`;
  if (typeof v === "number") return `<c r="${ref}"><v>${v}</v></c>`;
  return `<c r="${ref}" t="inlineStr"><is><t>${xlEsc(v)}</t></is></c>`;
};
const COL = ["A", "B", "C", "D", "E", "F"];
function priceXlsx(rows) {
  const body = rows.map((cells, i) => {
    const r = i + 1;
    if (cells === null) return `<row r="${r}"/>`;                     // пустая строка Excel
    return `<row r="${r}">${cells.map((v, j) => xlCell(COL[j] + r, v)).join("")}</row>`;
  }).join("");
  return zipStore([
    ["xl/workbook.xml", '<?xml version="1.0"?><workbook><sheets><sheet name="Прайс" sheetId="1" r:id="rId1"/></sheets></workbook>'],
    ["xl/_rels/workbook.xml.rels", '<?xml version="1.0"?><Relationships><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/></Relationships>'],
    ["xl/worksheets/sheet1.xml", `<?xml version="1.0"?><worksheet><sheetData>${body}</sheetData></worksheet>`]
  ]);
}

function makeProject(name, { price, type = "shop", platform = PLATFORM_YES, rules = "", serp = null, sales = null }) {
  const dir = join(SANDBOX, name);
  mkdirSync(join(dir, "price"), { recursive: true });
  writeFileSync(join(dir, "queue.json"), JSON.stringify({ v: 1, slug: name, steps: [] }, null, 2), "utf8");
  writeFileSync(join(dir, "project.json"), JSON.stringify(baseProject(name, type), null, 2), "utf8");
  writeFileSync(join(dir, "price/price.csv"), price, "utf8");
  if (platform) writeFileSync(join(dir, "platform.json"), JSON.stringify(platform, null, 2), "utf8");
  if (rules) writeFileSync(join(dir, "catalog-rules.yml"), rules, "utf8");
  if (serp) writeFileSync(join(dir, "catalog-serp.json"), JSON.stringify(serp, null, 2), "utf8");
  if (sales) writeFileSync(join(dir, "sales.csv"), sales, "utf8");
  return dir;
}

// ──────────────────────────────────────────────────────────────────────────
console.log("=== 1. ПРИЕМКА ДАННЫХ: вердикт машинный, исходов четыре ===");
// ──────────────────────────────────────────────────────────────────────────

const salesCsv = csv([["Артикул", "Продажи"], ...Array.from({ length: 12 }, (_, i) => ["N" + (100 + i), String(90 - i * 5)])]);
const dShop = makeProject("shop", { price: priceFull(), rules: RULES_FULL, serp: serpFull(), sales: salesCsv });
const dNames = makeProject("names", { price: priceNamesOnly() });
const dDerive = makeProject("derive", { price: priceDerivable() });
const dWeak = makeProject("weak", { price: priceWeak() });
const dNoPlat = makeProject("noplat", { price: priceFull(), platform: null, rules: RULES_FULL });
const dBlocked = makeProject("blocked", { price: priceFull(), platform: { ...PLATFORM_YES, facet_url: "none" } });
const dServices = makeProject("services", { price: priceFull(), type: "services" });

const ingest = (dir) => run([CATALOG, "ingest", dir, "--root", ROOT]);
const verdictOf = (dir) => readJson(join(dir, "attr_map.json")).verdict;

const R_SHOP = ingest(dShop);
const R_NAMES = ingest(dNames);
const R_DERIVE = ingest(dDerive);
const R_WEAK = ingest(dWeak);
ingest(dNoPlat);
ingest(dBlocked);

step("прайс с заполненными характеристиками: вердикт attributes_ready", () => {
  if (R_SHOP.code !== 0) return `exit ${R_SHOP.code}: ${R_SHOP.all.slice(0, 200)}`;
  const v = verdictOf(dShop);
  if (v !== "attributes_ready") return `вердикт ${v}`;
  return has(R_SHOP.all, "ВЕРДИКТ") ? true : "вердикт не напечатан отдельной строкой отчета";
});

step("прайс из названия и цены: вердикт impossible, фасетов не будет вовсе", () => {
  const v = verdictOf(dNames);
  return v === "impossible" ? true : `вердикт ${v}, а фильтровать тут не по чему`;
});

step("атрибуты сидят в названиях: вердикт derivable_from_name", () => {
  const v = verdictOf(dDerive);
  if (v !== "derivable_from_name") return `вердикт ${v}`;
  const m = readJson(join(dDerive, "attr_map.json"));
  return Number(m.derive) >= CAT.DERIVE_OK ? true : `разбор названий дает ${m.derive} при пороге ${CAT.DERIVE_OK}`;
});

step("колонка заполнена у меньшинства: вердикт must_request_from_client", () => {
  const v = verdictOf(dWeak);
  return v === "must_request_from_client" ? true : `вердикт ${v}: недозаполненная колонка это повод запросить характеристики, а не объявить, что их нет`;
});

step("два нижних вердикта пишут ask-attributes.csv, а не просьбу словами", () => {
  for (const [dir, name] of [[dNames, "impossible"], [dWeak, "must_request_from_client"]]) {
    const f = join(dir, "ask-attributes.csv");
    if (!existsSync(f)) return `${name}: файла запроса характеристик нет`;
    const raw = readFileSync(f, "utf8");
    if (!raw.startsWith("\ufeff")) return `${name}: нет BOM, Excel откроет русский csv одной строкой`;
    if (!raw.split(/\r?\n/)[0].includes(";")) return `${name}: разделитель не точка с запятой`;
  }
  const f = join(dShop, "ask-attributes.csv");
  return existsSync(f) ? "при attributes_ready запрос характеристик не нужен, а он записан" : true;
});

step("xlsx из Excel: пустая ячейка СО СТИЛЕМ не съедает соседнюю колонку", () => {
  const dir = join(SANDBOX, "xlsx");
  mkdirSync(join(dir, "price"), { recursive: true });
  writeFileSync(join(dir, "queue.json"), JSON.stringify({ v: 1, slug: "xlsx" }, null, 2), "utf8");
  writeFileSync(join(dir, "project.json"), JSON.stringify(baseProject("xlsx", "shop"), null, 2), "utf8");
  writeFileSync(join(dir, "price/price.xlsx"), priceXlsx([
    ["Артикул", "Наименование", "Раздел", "Бренд", "Цена"],
    ["N100", "Насос Grundfos UPS 25-40", "Насосы / Циркуляционные", null, 4200],
    null,
    ["N101", "Насос Wilo Star 25-40", "Насосы / Циркуляционные", "Wilo", 3900]
  ]));
  const t = CAT.readTable(join(dir, "price/price.xlsx"));
  if (t.sheet !== "Прайс") return `лист «${t.sheet}», а в книге он один и назван «Прайс»`;
  const r2 = t.rows[1];
  if (String(r2[3]) !== "") return `ячейка «Бренд» пустая со стилем, а в ней «${r2[3]}»: самозакрытый тег принят за открывающий`;
  if (String(r2[4]) !== "4200") return `цена уехала: в колонке «Цена» «${r2[4]}» вместо 4200`;
  if (t.rows.length !== 4) return `строк ${t.rows.length}, а в листе их четыре, включая пустую <row/>`;
  const last = t.rows[3];
  return String(last[3]) === "Wilo" && String(last[4]) === "3900" ? true : `строка после пустой разобрана как ${JSON.stringify(last)}`;
});

step("xlsx проходит весь гейт приемки: роли, вердикт, заполненность", () => {
  const r = run([CATALOG, "ingest", join(SANDBOX, "xlsx"), "--root", ROOT]);
  if (r.code !== 0) return `exit ${r.code}: ${r.all.slice(0, 200)}`;
  const m = readJson(join(SANDBOX, "xlsx", "attr_map.json"));
  if (m.price.sheet !== "Прайс") return `лист в карте «${m.price.sheet}»`;
  const price = m.cols.find((c) => c.role === "price");
  if (!price) return "колонка цены не опознана: строки съехали";
  const brand = m.cols.find((c) => c.attr === "brand");
  if (!brand) return "колонка бренда не опознана";
  return Number(brand.filled) < 1 ? true : "бренд заполнен у всех позиций, а одна ячейка была пуста - значит в нее попало чужое";
});

step("business.type services: режим магазина не включается, exit 2", () => {
  const r = ingest(dServices);
  if (r.code !== 2) return `exit ${r.code}, а переключатель режима ровно один`;
  return /business\.type/.test(r.all) ? true : "в отказе не назван переключатель business.type";
});

step("вердикт решает объем режима: таблица эффектов одна на все четыре исхода", () => {
  const miss = CAT.VERDICTS.filter((v) => !CAT.VERDICT_EFFECT[v]);
  if (miss.length) return `без описания эффекта: ${miss.join(", ")}`;
  const t = text(join(SKILL_DIR, "CATALOG.md"));
  const gone = CAT.VERDICTS.filter((v) => !has(t, v));
  return gone.length ? `в CATALOG.md нет вердиктов: ${gone.join(", ")}` : true;
});

step("attr_map.json заморожен: второй ingest без --refresh не переписывает карту", () => {
  const before = text(join(dShop, "attr_map.json"));
  const r = ingest(dShop);
  if (r.code !== 0) return `exit ${r.code}`;
  if (text(join(dShop, "attr_map.json")) !== before) return "карта колонок переписана без --refresh";
  return /refresh/.test(r.all) ? true : "в отчете не сказано, чем пересобрать";
});

// ──────────────────────────────────────────────────────────────────────────
console.log("");
console.log("=== 2. ОСИ: порог публикации и ДВЕ блокировки ===");
// ──────────────────────────────────────────────────────────────────────────

const tree = (dir) => run([CATALOG, "tree", dir, "--root", ROOT]);
const mode = (dir) => run([CATALOG, "mode", dir, "--root", ROOT]);

const T_SHOP = tree(dShop);
const M_SHOP = mode(dShop);
const T_NOPLAT = tree(dNoPlat);
const T_BLOCKED = tree(dBlocked);
const CAT_SHOP = () => readJson(join(dShop, "catalog.json"));

step("дерево собралось и прошло собственную схему", () => {
  if (T_SHOP.code !== 0) return `tree exit ${T_SHOP.code}: ${T_SHOP.all.slice(0, 300)}`;
  if (M_SHOP.code !== 0) return `mode exit ${M_SHOP.code}: ${M_SHOP.all.slice(0, 300)}`;
  const c = CAT_SHOP();
  return c.tree.length >= 3 ? true : `узлов ${c.tree.length}`;
});

step("ось ниже 70 процентов не публикуется и лежит в blocked_by_data со своим числом", () => {
  const c = CAT_SHOP();
  const low = c.blocked_by_data.filter((b) => Number(b.fill) < CAT.AXIS_FILL_MIN);
  if (!low.length) return "ни одной оси не отклонено по данным: фикстура ничего не проверяет";
  for (const n of c.tree) {
    for (const f of n.facets || []) {
      if (Number(f.fill) < CAT.AXIS_FILL_MIN) return `${n.id}/${f.attr}: опубликована с заполненностью ${f.fill}`;
    }
  }
  return /заполнено \d+ процентов из 70/.test(T_SHOP.all) ? true : "в отчете нет строки «заполнено X процентов из 70»";
});

step("опубликованная ось обязана иметь значения либо быть диапазоном", () => {
  const c = CAT_SHOP();
  for (const n of c.tree) {
    for (const f of n.facets || []) {
      if (f.kind !== "range" && !(f.values || []).length) return `${n.id}/${f.attr}: ось без значений`;
    }
  }
  return true;
});

step("фасет, невозможный НА ПЛАТФОРМЕ, не обещается: facet_url none снимает все оси", () => {
  if (T_BLOCKED.code !== 0) return `exit ${T_BLOCKED.code}: ${T_BLOCKED.all.slice(0, 200)}`;
  const c = readJson(join(dBlocked, "catalog.json"));
  const published = c.tree.reduce((s, n) => s + (n.facets || []).length, 0);
  if (published) return `опубликовано осей ${published} при facet_url none`;
  if (!c.blocked_by_platform.length) return "оси исчезли молча: списка blocked_by_platform нет";
  const need = new Set(c.blocked_by_platform.map((b) => b.need));
  if (!need.has("facet_url")) return `в блокировке названо не то, чего не хватает: ${[...need].join(", ")}`;
  return c.landings.length ? `посадок ${c.landings.length} при нуле осей` : true;
});

step("unknown работает как no: без platform.json опубликованных осей нет ни одной", () => {
  if (T_NOPLAT.code !== 0) return `exit ${T_NOPLAT.code}`;
  const c = readJson(join(dNoPlat, "catalog.json"));
  const published = c.tree.reduce((s, n) => s + (n.facets || []).length, 0);
  if (published) return `опубликовано осей ${published}, а анкеты платформы нет`;
  return /анкеты платформы нет/.test(T_NOPLAT.all) ? true : "отчет не сказал прямым текстом, что анкеты нет";
});

step("platformGate: чего именно не хватает оси, названо словом из анкеты", () => {
  const P = (o) => ({ ...PLATFORM_YES, ...o });
  const cases = [
    [P({ facet_url: "unknown" }), "enum", false, "facet_url"],
    [P({ range: "no" }), "range", false, "range"],
    [P({ multi_select: "no" }), "enum", true, "multi_select"],
    [P({ facet_url: "query", clean_param: "no", canonical: "no" }), "enum", false, "clean_param"],
    [P({}), "enum", false, ""]
  ];
  for (const [p, kind, multi, want] of cases) {
    const got = CAT.platformGate(p, kind, multi);
    if (got !== want) return `анкета ${JSON.stringify(want || "все есть")}: ожидали «${want}», пришло «${got}»`;
  }
  return true;
});

step("ложная блокировка ловится гейтом: анкета отвечает yes, а ось снята платформой", () => {
  const dir = join(SANDBOX, "fake-block");
  mkdirSync(dir, { recursive: true });
  const c = CAT_SHOP();
  c.blocked_by_platform = [{ node: c.tree[0].id, attr: "brand", need: "canonical" }];
  writeFileSync(join(dir, "catalog.json"), JSON.stringify(c, null, 2), "utf8");
  const r = run([VCAT, join(dir, "catalog.json")]);
  if (r.code !== 2) return `exit ${r.code}: выдуманной блокировки в ТЗ не бывает так же, как невыполнимой`;
  return /ложная/.test(r.all) ? true : "гейт не назвал блокировку ложной";
});

step("facet_url path при canonical no: ось уходит в blocked_by_platform, а не в мертвый контракт", () => {
  // Самый частый ответ заказчика «про canonical не знаю»: unknown работает как no.
  // Раньше гейт платформы пропускал ось по одному noindex, tree писал посадкам
  // index = canonical, и verify-catalog валил ровно то, что скрипт сам и написал:
  // режим вставал намертво, и правкой данных это не чинилось.
  const dir = makeProject("path-noindex", {
    price: priceFull(), rules: RULES_FULL, serp: serpFull(),
    platform: { ...PLATFORM_YES, facet_url: "path", canonical: "no", clean_param: "no", noindex: "yes" }
  });
  const a = run([CATALOG, "ingest", dir, "--root", ROOT]);
  if (a.code !== 0) return `ingest exit ${a.code}`;
  const b = tree(dir);
  if (b.code !== 0) return `tree exit ${b.code}: ${b.all.slice(0, 200)}`;
  const c = mode(dir);
  if (c.code !== 0) return `mode exit ${c.code}`;
  const cat = readJson(join(dir, "catalog.json"));
  const published = cat.tree.reduce((n, x) => n + (x.facets || []).length, 0);
  if (published) return `опубликовано осей ${published}: закрывать их комбинации платформе нечем`;
  if (!cat.blocked_by_platform.some((x) => x.need === "canonical")) return "ось снята, но в blocked_by_platform не сказано, чего именно не хватило";
  if (cat.landings.length) return `посадок ${cat.landings.length} при снятых осях`;
  const v = run([VCAT, dir]);
  return v.code <= 1 ? true : `гейт валит собственный выход скрипта: ${v.all.slice(0, 300)}`;
});

step("facet_url query: строка запроса и есть адрес посадки, слаги не схлопываются", () => {
  const dir = makeProject("query", {
    price: priceFull(), rules: RULES_FULL, serp: serpFull(),
    platform: { ...PLATFORM_YES, kind: "opencart", facet_url: "query" }
  });
  const a = run([CATALOG, "ingest", dir, "--root", ROOT]);
  if (a.code !== 0) return `ingest exit ${a.code}`;
  if (tree(dir).code !== 0) return "tree упал";
  if (mode(dir).code !== 0) return "mode упал";
  const cat = readJson(join(dir, "catalog.json"));
  if (!cat.landings.length) return "посадок нет, мерить нечего";
  if (!cat.landings.every((L) => L.url.includes("?"))) return "при facet_url query адрес посадки обязан нести строку запроса";
  const r = run([PAGES, dir, "--root", ROOT]);
  if (r.code !== 0) return `pages exit ${r.code}: ${r.all.slice(0, 200)}`;
  const pg = readJson(join(dir, "pages.json"));
  const fac = pg.pages.filter((x) => x.type === "facet");
  if (!fac.length) return "ни одной посадки не стало страницей";
  const urls = new Set(fac.map((x) => x.url));
  if (urls.size !== fac.length) return `страниц ${fac.length}, а различных адресов ${urls.size}: строку запроса срезали, и все посадки сели на адрес категории`;
  const slugs = new Set(fac.map((x) => x.slug));
  if (slugs.size !== fac.length) return `слагов ${slugs.size} на ${fac.length} посадок: слаг взят из последнего сегмента пути, а он у всех один`;
  return fac.every((x) => x.url.includes("?")) ? true : "адрес страницы потерял строку запроса";
});

step("порог оси, порог атрибута и квота тира A вынесены константами", () => {
  const want = { AXIS_FILL_MIN: 0.7, ATTR_FILL_MIN: 0.2, DERIVE_OK: 0.6, TIER_A_MAX: 30, LANDING_INDEX_SKU: 4, LANDING_INDEX_DEMAND: 30 };
  const bad = Object.entries(want).filter(([k, v]) => CAT[k] !== v).map(([k, v]) => `${k} ${CAT[k]} вместо ${v}`);
  return bad.length ? bad.join("; ") : true;
});

// ──────────────────────────────────────────────────────────────────────────
console.log("");
console.log("=== 3. ПАДЕЖНЫЕ ФОРМЫ: три формы у каждого узла ===");
// ──────────────────────────────────────────────────────────────────────────

step("у каждого узла дерева три непустые падежные формы", () => {
  const c = CAT_SHOP();
  const bad = c.tree.filter((n) => !n.name || !n.name.nom || !n.name.gen || !n.name.acc).map((n) => n.id);
  return bad.length ? `без трех форм: ${bad.join(", ")}` : true;
});

step("родительный падеж НЕ выводится правилом: формы приходят из catalog-rules.yml", () => {
  // «насосы - насосов», но «трубы - труб»: окончание одно и то же, а формы разные.
  const fromRules = CAT.caseForms("трубы", "трубы | труб | трубы");
  if (fromRules.gen !== "труб" || fromRules.guessed) return `правила не применились: ${JSON.stringify(fromRules)}`;
  const guessed = CAT.caseForms("трубы", "");
  if (!guessed.guessed) return "форма без подтверждения не помечена как догадка";
  if (guessed.gen !== "трубы") return "скрипт все-таки склоняет сам, а это невыводимо правилом";
  const latin = CAT.caseForms("Grundfos", "");
  return latin.guessed ? "латиница не склоняется, помечать ее догадкой незачем" : true;
});

step("неподтвержденные формы печатаются списком и видны оператору", () => {
  const c = readJson(join(dBlocked, "catalog.json"));
  const bad = c.tree.filter((n) => !n.name.gen).map((n) => n.id);
  if (bad.length) return `формы пусты: ${bad.join(", ")}`;
  return /падежные формы НЕ ПОДТВЕРЖДЕНЫ/.test(T_BLOCKED.all) ? true : "проект без catalog-rules.yml не получил строки о неподтвержденных формах";
});

step("имя узла из 1С чинится машинно только там, где это не падеж", () => {
  if (CAT.normalName("Насосы циркуляционные") !== "циркуляционные насосы") return "порядок слов и регистр не приведены";
  return CAT.normalName("  Трубы  ") === "трубы" ? true : "лишние знаки по краям имени остались";
});

// ──────────────────────────────────────────────────────────────────────────
console.log("");
console.log("=== 4. РЕЖИМ КАТЕГОРИИ: четыре условия, вето и thin_category ===");
// ──────────────────────────────────────────────────────────────────────────

const re = CAT.serviceRe([]);
const sig = (products, non_listing, text_median, service_hits) => ({ products, non_listing, text_median, service_hits });

step("H1 плюс каталожная выдача: исход thin_category, а НЕ лендинг", () => {
  const r = CAT.modeOf(sig(5, 0.1, 800, 0), "насосы", re);
  return r.mode === "thin_category" ? true : `режим ${r.mode}: мало товаров при каталожной выдаче лечится наполнением, а не лендингом`;
});

step("service_like требует обязательного H2 либо H4 плюс второго условия", () => {
  const ok = CAT.modeOf(sig(5, 0.6, 3000, 0), "насосы", re);
  if (ok.mode !== "service_like") return `H2 и H3 вместе дали ${ok.mode}`;
  const byH4 = CAT.modeOf(sig(5, 0.1, 800, 4), "насосы под заказ", re);
  return byH4.mode === "service_like" ? true : `H4 и H1 вместе дали ${byH4.mode}`;
});

step("два условия без H2 и без H4 в service_like НЕ превращаются", () => {
  // Мягкое правило «два любых из четырех» превратило бы треть тонкого каталога в лендинги.
  const r = CAT.modeOf(sig(5, 0.1, 3000, 0), "насосы", re);
  return r.mode !== "service_like" ? true : "сработало мягкое правило: H1 и H3 без H2 и H4 дали лендинг";
});

step("вето: не-листингов до 0,2 при 20 товарах - service_like не назначается никогда", () => {
  const r = CAT.modeOf(sig(40, 0.2, 3000, 5), "насосы под заказ монтаж", re);
  if (r.mode === "service_like") return "вето не сработало";
  return r.veto ? true : "вето не отмечено в разборе";
});

step("сервисная лексика ловится и в маркере, и в запросах узла", () => {
  const byMarker = CAT.modeOf(sig(5, 0.1, 800, 0), "насосы на заказ", re);
  if (byMarker.mode !== "service_like") return `сервисный маркер дал ${byMarker.mode}`;
  const s = CAT.signalsOf(30, { queries: ["монтаж насоса", "установка насоса", "проектирование узла"], top: [] }, re);
  return s.service_hits >= 3 ? true : `сервисных запросов посчитано ${s.service_hits} из трех`;
});

step("четыре числа лежат в signals у каждого узла и печатаются колонкой", () => {
  const c = CAT_SHOP();
  const bad = c.tree.filter((n) => !n.signals || ["products", "non_listing", "text_median", "service_hits"].some((k) => typeof n.signals[k] !== "number")).map((n) => n.id);
  if (bad.length) return `без четырех чисел: ${bad.join(", ")}`;
  return /H1 товаров/.test(M_SHOP.all) && /H2 не-лист/.test(M_SHOP.all) ? true : "колонки четырех чисел в отчете нет";
});

step("узлу без листинга посадки не остаются: mode чистит их и пересчитывает объем", () => {
  const dir = makeProject("thin-land", {
    price: priceThinCat(), rules: RULES_FULL,
    serp: {
      ws: [],
      // Каталожная выдача: не-листингов ноль, текста мало. При шести товарах это
      // thin_category - интро, плитка подкатегорий и noindex, а НЕ лендинг.
      nodes: ["nasosy", "cirkulyacionnye"].map((id) => ({
        id, marker: id, queries: [], top: Array.from({ length: 10 }, () => ({ kind: "listing", chars: 600 }))
      }))
    }
  });
  if (run([CATALOG, "ingest", dir, "--root", ROOT]).code !== 0) return "ingest упал";
  const t = tree(dir);
  if (t.code !== 0) return `tree exit ${t.code}: ${t.all.slice(0, 200)}`;
  const before = readJson(join(dir, "catalog.json"));
  if (!before.landings.some((L) => L.node === "cirkulyacionnye")) return "в фикстуре нет посадок на тонком узле";
  const m = mode(dir);
  if (m.code !== 0) return `mode exit ${m.code}: ${m.all.slice(0, 200)}`;
  const after = readJson(join(dir, "catalog.json"));
  const node = after.tree.find((n) => n.id === "cirkulyacionnye");
  if (!node || node.mode !== "thin_category") return `режим узла ${node ? node.mode : "узла нет"}, фикстура целилась в thin_category`;
  if (after.landings.some((L) => L.node === "cirkulyacionnye")) return "посадки остались на узле, закрытом noindex: canonical вел бы на страницу, закрытую от индексации";
  if (after.counts.landings !== after.landings.length) return `counts.landings ${after.counts.landings} против ${after.landings.length}: объем работ и цена посчитаны по страницам, которых не будет`;
  if (!/ПОСАДОК СНЯТО/.test(m.all)) return "снятие посадок не названо строкой отчета";
  const v = run([VCAT, dir]);
  return v.code <= 1 ? true : `гейт валит собранное: ${v.all.slice(0, 300)}`;
});

step("посадка на узле без листинга - НАРУШЕНИЕ гейта, а не предупреждение", () => {
  const dir = join(SANDBOX, "land-on-thin");
  mkdirSync(dir, { recursive: true });
  const c = JSON.parse(JSON.stringify(CAT_SHOP()));
  const host = c.landings[0] && c.landings[0].node;
  if (!host) return "в фикстуре нет посадок";
  for (const n of c.tree) if (n.id === host) n.mode = "thin_category";
  writeFileSync(join(dir, "catalog.json"), JSON.stringify(c, null, 2), "utf8");
  const r = run([VCAT, join(dir, "catalog.json")]);
  if (r.code !== 2) return `exit ${r.code}: посадка на закрытом noindex узле прошла гейт`;
  return /thin_category/.test(r.all) ? true : "гейт не назвал режим узла причиной";
});

step("пороги режима объявлены числами, а не спрятаны в условии", () => {
  const h = CAT.H_LIMIT, v = CAT.VETO;
  if (h.products !== 8 || h.non_listing !== 0.5 || h.text_median !== 2500 || h.service_hits !== 3) return `H_LIMIT ${JSON.stringify(h)}`;
  return v.non_listing === 0.2 && v.products === 20 ? true : `VETO ${JSON.stringify(v)}`;
});

// ──────────────────────────────────────────────────────────────────────────
console.log("");
console.log("=== 5. ТИПИЗАЦИЯ СТРАНИЦ: объем считается в ПОСАДКАХ ===");
// ──────────────────────────────────────────────────────────────────────────

const P_SHOP = run([PAGES, dShop, "--root", ROOT]);
const PAGES_SHOP = () => readJson(join(dShop, "pages.json"));

step("узел дерева дает category, ИНДЕКСИРУЕМАЯ посадка - facet", () => {
  if (P_SHOP.code !== 0) return `exit ${P_SHOP.code}: ${P_SHOP.all.slice(0, 200)}`;
  const c = CAT_SHOP(), p = PAGES_SHOP();
  const cats = p.pages.filter((x) => x.type === "category").length;
  const facets = p.pages.filter((x) => x.type === "facet").length;
  const idx = c.landings.filter((L) => L.index === "index").length;
  if (!idx || idx === c.landings.length) return "в фикстуре нет закрытой посадки: шаг ничего не проверяет";
  if (facets !== idx) return `индексируемых посадок ${idx}, а страниц facet ${facets}`;
  const catalogNodes = c.tree.filter((n) => n.mode !== "service_like").length;
  return cats === catalogNodes ? true : `узлов ${catalogNodes}, а страниц category ${cats}`;
});

step("закрытая canonical посадка страницей ПИСЬМА не становится, но из контракта не исчезает", () => {
  const c = CAT_SHOP(), p = PAGES_SHOP();
  const closed = c.landings.filter((L) => L.index !== "index");
  if (!closed.length) return "в фикстуре нет закрытых посадок";
  const urls = new Set(p.pages.map((x) => x.url));
  for (const L of closed) if (urls.has(L.url)) return `${L.id}: склеенная canonical посадка получила страницу письма - платим за текст там, где сами склеили`;
  const meta = TZM.metaRows(c, new Map(), "Тверь", []).map((r) => String(r[0]));
  for (const L of closed) if (!meta.includes(L.url)) return `${L.id}: посадки нет в meta.csv, а верстать ее разработчику все равно надо`;
  return /два разных числа/.test(P_SHOP.all) ? true : "отчет не развел два числа: посадок в контракте и страниц письма";
});

step("объем работ печатается в посадках, а не в категориях", () => {
  const p = PAGES_SHOP();
  if (!p.pages.filter((x) => x.type === "facet").length) return "посадок нет, мерить нечего";
  return /ПОСАДКАХ, А НЕ В КАТЕГОРИЯХ/.test(P_SHOP.all) ? true : "строки об единице объема в отчете нет";
});

step("service_like маршрутизируется в обычный тракт: тип service, а не новый движок", () => {
  const c = CAT_SHOP();
  const fake = JSON.parse(JSON.stringify(c));
  fake.tree[0].mode = "service_like";
  const out = PAGESM.buildPages(readJson(join(dShop, "project.json")), fake, null);
  const p = out.pages.find((x) => x.name === (fake.tree[0].name || {}).nom);
  if (!p) return "узел потерялся при типизации";
  if (p.type !== "service") return `тип ${p.type}, а service_like это маршрутизация к site-author`;
  return PAGESM.TYPE_OF_MODE.service_like === "service" ? true : "таблица режимов говорит другое";
});

step("thin_category остается категорией: интро и плитка, а не лендинг", () => {
  const fake = JSON.parse(JSON.stringify(CAT_SHOP()));
  fake.tree[0].mode = "thin_category";
  const out = PAGESM.buildPages(readJson(join(dShop, "project.json")), fake, null);
  const p = out.pages.find((x) => x.url === fake.tree[0].url);
  return p && p.type === "category" ? true : `тип ${p ? p.type : "страницы нет"}`;
});

step("направление, уже ставшее узлом дерева, второй страницы не получает", () => {
  const p = PAGES_SHOP();
  const urls = p.pages.map((x) => x.url);
  if (new Set(urls).size !== urls.length) return "в списке страниц есть повтор адреса";
  const named = p.pages.filter((x) => /насос/i.test(x.name) && (x.type === "category" || x.type === "service"));
  const roots = named.filter((x) => !x.parent);
  return roots.length <= 1 ? true : `корневых страниц про насосы ${roots.length}: направление и узел развелись в две страницы`;
});

step("без catalog.json каталожных страниц нет, и это сказано строкой", () => {
  const project = readJson(join(dShop, "project.json"));
  const out = PAGESM.buildPages(project, null, null);
  const cat = out.pages.filter((x) => PAGESM.CATALOG_TYPES.includes(x.type) && x.type !== "category");
  if (cat.length) return `заглушки вместо каталога: ${cat.length} страниц`;
  return out.warnings.some((w) => /catalog\.json/.test(w)) ? true : "конвейер промолчал о том, что дерева нет";
});

step("карточка тира A становится страницей письма, тиры B и C - нет", () => {
  const project = readJson(join(dShop, "project.json"));
  const tierA = { v: 1, cards: [{ sku: "N100", name: "Насос UPS 25-40", node: CAT_SHOP().tree[0].id, url: "/nasosy/ups-25-40/", h1: "Насос UPS 25-40" }] };
  const out = PAGESM.buildPages(project, CAT_SHOP(), tierA);
  const prod = out.pages.filter((x) => x.type === "product");
  if (prod.length !== 1) return `страниц product ${prod.length}, а карточка тира A одна`;
  const none = PAGESM.buildPages(project, CAT_SHOP(), null);
  return none.pages.some((x) => x.type === "product") ? "страницы товаров появились без заданий тира A" : true;
});

step("каталожные страницы ПОПАДАЮТ В ПЛАН: ни category, ни facet, ни product не уходят в later", () => {
  // Пока типы каталога не стояли в TYPES_NOW, pages.mjs заводил 22 страницы, а plan.mjs
  // брал одну: 21 страница из 22 не получала ни плана, ни задания, ни текста, и обещание
  // «товары тира A уходят к site-author» было ложным.
  const r = run([PLAN, dShop, "--root", ROOT]);
  if (r.code !== 0) return `plan exit ${r.code}: ${r.all.slice(0, 250)}`;
  const plan = readJson(join(dShop, "plan.json"));
  const pg = readJson(join(dShop, "pages.json"));
  const later = plan.later.map((x) => x.type);
  if (later.length) return `за границей среза остались типы: ${[...new Set(later)].join(", ")}`;
  if (plan.pages.length !== pg.pages.length) return `страниц ${pg.pages.length}, а в плане ${plan.pages.length}`;
  for (const t of ["category", "facet"]) {
    if (!plan.pages.some((x) => x.page.type === t)) return `в плане нет ни одной страницы типа ${t}`;
  }
  return true;
});

step("вилка каталожной страницы КОРОТКАЯ: полотна под листингом план не заказывает", () => {
  const plan = readJson(join(dShop, "plan.json"));
  const bad = [];
  for (const pg of plan.pages) {
    const v = PLANM.VOL[pg.page.type];
    if (!v) continue;
    if (pg.bud < v[0] || pg.bud > v[1]) bad.push(`${pg.page.url} тип ${pg.page.type}: бюджет ${pg.bud} вне вилки ${v[0]}-${v[1]}`);
  }
  if (bad.length) return bad.join("; ");
  if (PLANM.VOL.category[1] > 6 || PLANM.VOL.facet[1] > 5) return "вилка категории и посадки шире страницы услуги: это заказ простыни под листингом";
  return PLANM.CLUSTER_OF.category === "" ? true : "каталожный тип меряется recon вторым замером: рынок узла уже замерен catalog.mjs mode";
});

step("каталожные блоки ставятся ТОЛЬКО каталожным страницам", () => {
  const plan = readJson(join(dShop, "plan.json"));
  const only = PLANM.CATALOG_ONLY;
  for (const pg of plan.pages) {
    const ids = pg.blocks.filter((b) => b.ord).map((b) => b.id);
    if (PLANM.CATALOG_PAGE_TYPES.includes(pg.page.type)) {
      if (!ids.some((id) => only.includes(id))) return `${pg.page.url}: каталожная страница без единого каталожного блока - скелет вычеркнул сам себя`;
    } else if (ids.some((id) => only.includes(id))) {
      return `${pg.page.url} тип ${pg.page.type}: на странице не из каталога стоит ${ids.filter((id) => only.includes(id)).join(", ")}`;
    }
  }
  return PLANM.catalogOnlyFor("category").length === 0 && PLANM.catalogOnlyFor("service").length > 0
    ? true : "список каталожных блоков не зависит от типа страницы";
});

step("порядок каталожной страницы: интро над листингом, форма в конце", () => {
  // Очередность блоков описана ОДНИМ списком blocks в pages.yml, и в нем каталожные
  // строки стояли ПОСЛЕ cta_form: форма вставала первой, выше интро и листинга. Заказчик
  // видит это в первой же строке прототипа.
  const plan = readJson(join(dShop, "plan.json"));
  const want = {
    category: ["cat_intro", "listing", "cat_text", "cta_form"],
    facet: ["cat_intro", "listing", "cat_text", "cta_form"],
    product: ["gallery", "specs", "product_desc", "cta_form"]
  };
  for (const pg of plan.pages) {
    const need = want[pg.page.type];
    if (!need) continue;
    const got = pg.blocks.filter((b) => b.ord).sort((a, b) => a.ord - b.ord).map((b) => b.id);
    const seq = got.filter((id) => need.includes(id));
    const ok = need.filter((id) => got.includes(id));
    if (seq.join(">") !== ok.join(">")) return `${pg.page.url}: порядок ${got.join(", ")}, а ожидался ${ok.join(" > ")}`;
  }
  return true;
});

step("service_like держит ПОТОЛОК 6 БЛОКОВ, а не вилку страницы услуги", () => {
  // Правило было написано в пяти файлах и не исполнялось нигде: тонкая категория,
  // поймавшая H2 и H3, выходила лендингом до 11 блоков - ровно тот исход, ради запрета
  // которого признак режима сделали строгим.
  const project = readJson(join(dShop, "project.json"));
  const yml = CONTRACT.readPages(join(SKILL_DIR, "pages.yml"));
  const page = { slug: "nasosy", type: "service", url: "/nasosy/", name: "насосы", marker: "насосы под заказ", dir: null, parent: null, fixed: true, from_catalog: true, kids: 2, sku: 6 };
  const fromCat = PLANM.planPage(project, page, null, yml, "multipage", PLANM.catalogOnlyFor("service"));
  const plain0 = PLANM.planPage(project, { ...page, from_catalog: false }, null, yml, "multipage", PLANM.catalogOnlyFor("service"));
  if (fromCat.out.bud > PLANM.VOL_SERVICE_LIKE[1]) return `узел service_like получил ${fromCat.out.bud} блоков при потолке ${PLANM.VOL_SERVICE_LIKE[1]}`;
  if (plain0.out.bud <= PLANM.VOL_SERVICE_LIKE[1]) return "обычная страница услуги получила тот же потолок: признак from_catalog ничего не меняет, и шаг ничего не проверяет";
  return fromCat.out.blocks.filter((b) => b.ord).length <= PLANM.VOL_SERVICE_LIKE[1]
    ? true : `блоков на странице ${fromCat.out.blocks.filter((b) => b.ord).length}`;
});

step("каталожная страница получает НОРМЫ КАТАЛОГА в задании, и потолок инструкций держится", () => {
  // Целиком CATALOG.md писателю не подкладывается: справочник на 8500 знаков не влезает
  // в потолок инструкций 12000 вместе с промтом и методичкой. Писателю едут три числа и
  // одна форма, и едут они только каталожным страницам.
  const r = run([TASKS, dShop, "--root", ROOT]);
  if (r.code !== 0) return `build-tasks exit ${r.code}: ${r.all.slice(-400)}`;
  if (/ПОТОЛОК/.test(r.all)) return `потолок инструкций пробит: ${r.all.split("\n").filter((l) => /ПОТОЛОК/.test(l)).join(" | ")}`;
  const pg = readJson(join(dShop, "pages.json"));
  const cat = pg.pages.find((x) => x.type === "category");
  const home = pg.pages.find((x) => x.type === "home");
  if (!cat || !home) return "в списке страниц нет пары каталог плюс главная";
  const nameOf = (x) => CONTRACT.pageName(x);
  const catTask = text(join(dShop, "tasks", nameOf(cat) + ".md"));
  const homeTask = text(join(dShop, "tasks", nameOf(home) + ".md"));
  if (!has(catTask, "КАТАЛОЖНЫЕ НОРМЫ")) return "каталожная страница получила задание без норм каталога";
  if (has(homeTask, "КАТАЛОЖНЫЕ НОРМЫ")) return "главная платит местом за нормы каталога, которые ей не нужны";
  for (const w of ["500", "H2 и 3-4 подраздела", "ОТ ВЫГОДЫ", "ЦЕЛИКОМ"]) {
    if (!has(catTask, w)) return `в блоке норм нет «${w}»`;
  }
  return has(text(join(ROOT, ".claude/agents/site-author.md")), "КАТАЛОЖНЫЕ НОРМЫ")
    ? true : "автор не знает, что в задании есть блок норм каталога";
});

step("раздел syn правил: его читает товарный конвейер, и агенту про него сказано", () => {
  // render-products строит по нему сведение написаний. Пока раздела не было в промте,
  // synMap был пуст всегда: «Вт», «вт» и «Вт.» расходились по трем значениям оси, каждое
  // недобирало минимума позиций, и посадок по ним не рождалось.
  const src = text(join(SITE_SCRIPTS, "render-products.mjs"));
  if (!/sec\("syn"\)/.test(src)) return "товарный конвейер больше не читает syn: шаг сторожит не то";
  const agent = text(join(ROOT, ".claude/agents/catalog-architect.md"));
  if (!/^syn:$/m.test(agent)) return "раздела syn нет в примере yaml агента: написать раздел, о котором не сказано, агент не может";
  if (!/канон\|вариант/.test(agent)) return "формат строки syn агенту не назван";
  if (!/написания ОДНОГО значения/.test(agent)) return "агенту не сказано, что варианты - это написания одного значения, а не разные значения";
  const doc = text(join(ROOT, "docs/v8/contracts-catalog.md"));
  if (/словари единиц/.test(doc)) return "справочник форматов все еще приписывает правилам словарь единиц: семьи единиц зашиты в render-products.mjs";
  return /`syn`/.test(doc) ? true : "в справочнике форматов раздел syn не назван";
});

step("derivable_from_name: заказчику уходит запрос характеристик, а не молчание", () => {
  const f = join(dDerive, "ask-attributes.csv");
  if (!existsSync(f)) return "вердикт derivable, а файла запроса характеристик нет: разговора с заказчиком не возникает вовсе";
  if (!/ask-attributes/.test(CAT.VERDICT_EFFECT.derivable_from_name)) return "таблица эффектов вердикта не обещает запрос характеристик";
  if (/оси публикуются после пересчета/.test(CAT.VERDICT_EFFECT.derivable_from_name)) return "таблица эффектов обещает пересчет заполненности по названиям, которого в tree нет";
  const agent = text(join(ROOT, ".claude/agents/catalog-architect.md"));
  return /Третье поле `axes` под пометку о разборе НЕ занимай/.test(agent)
    ? true : "агенту все еще велено писать пометку в третье поле axes, где скрипт понимает только landing и no";
});

// ──────────────────────────────────────────────────────────────────────────
console.log("");
console.log("=== 6. ТОВАРЫ: правило пропуска, тиринг, уникальность ===");
// ──────────────────────────────────────────────────────────────────────────

const R_PROD = run([PRODUCTS, dShop, "--root", ROOT, "--seed", "Вика Петрова"]);
// Читаем СЫРЫМ: BOM это часть проверки, а text() его снимает.
const outRaw = () => readFileSync(join(dShop, "products_out.csv"), "utf8");
const outCsv = () => outRaw().replace(/^\ufeff/, "");

step("правило пропуска: нет значения - предложение выбрасывается ЦЕЛИКОМ", () => {
  const r = PROD.renderSkip("Мощность {power} Вт. Диаметр {diameter} мм.", { power: "45" });
  if (/diameter/.test(r.text)) return "неподставленный слот уехал в выдачу";
  if (/Диаметр/.test(r.text)) return "предложение выброшено не целиком, остался обрубок";
  if (!/Мощность 45 Вт/.test(r.text)) return `предложение с данными пропало: «${r.text}»`;
  return r.dropped.includes("diameter") ? true : "пропуск не посчитан";
});

step("«не указано», прочерк и квадратный плейсхолдер не печатаются никогда", () => {
  const marker = "[" + "ЗАПОЛНИТЬ" + "]";
  for (const bad of ["не указано", "по запросу", "уточняйте", marker]) {
    const r = PROD.renderSkip("Материал {material}.", { material: bad });
    if (r.text) return `в выдачу ушло «${r.text}»`;
  }
  const t = outCsv();
  return /не указан|по запросу|уточняйте/i.test(t) ? "сторож пропустил заглушку в products_out.csv" : true;
});

step("товарный конвейер прошел и записал csv из пятнадцати колонок", () => {
  if (R_PROD.code > 1) return `exit ${R_PROD.code}: ${R_PROD.all.slice(0, 300)}`;
  const raw = outRaw();
  if (!raw.startsWith("\ufeff")) return "нет BOM: Excel откроет русский csv одной строкой";
  const head = lines(outCsv())[0].split(";");
  if (head.length !== 15) return `колонок ${head.length}`;
  for (const k of ["sku", "tier", "robots", "h1", "title", "specs", "var"]) if (!head.includes(k)) return `нет колонки ${k}`;
  return true;
});

step("тиринг: C по данным и с noindex, A по спросу, остальное B", () => {
  const rows = outCsv().split(/\r?\n/).filter(Boolean).slice(1).map((l) => l.split(";"));
  const col = (r, i) => String(r[i] || "").replace(/^"|"$/g, "");
  const tiers = new Set(rows.map((r) => col(r, 4)));
  if (!tiers.has("C")) return "тира C нет: позиции без цены обязаны падать в минимальную карточку";
  if (!tiers.has("A")) return "тира A нет, хотя продажи в фикстуре есть";
  if (!tiers.has("B")) return "тира B нет: рендер по шаблону это основной объем";
  const badC = rows.filter((r) => col(r, 4) === "C" && col(r, 5) !== PROD.NOINDEX);
  return badC.length ? `карточек тира C без ${PROD.NOINDEX}: ${badC.length}` : true;
});

step("тир A - тридцать карточек на ВЕСЬ каталог, а не на каждый узел", () => {
  const c = CAT_SHOP();
  const a = c.tree.reduce((s, n) => s + ((n.tier || {}).a || 0), 0);
  if (a > PROD.TIER_A_MAX && a > CAT.TIER_A_MAX) return `тира A назначено ${a} при квоте ${CAT.TIER_A_MAX}`;
  return c.counts.tier_a === a ? true : `counts.tier_a ${c.counts.tier_a} против суммы по узлам ${a}`;
});

step("уникальность: доля варьируемого ниже 0,5 - блокирующий критерий", () => {
  const same = PROD.varShares(["насос циркуляционный в наличии", "насос циркуляционный в наличии", "насос циркуляционный в наличии"]);
  if (same.some((x) => x >= PROD.VAR_SHARE_MIN)) return `одинаковые карточки дали долю ${same.join(", ")}`;
  const vary = PROD.varShares([
    "насос grundfos ups 25 40 тихий подходит для квартиры",
    "труба valtec pn20 армированная стекловолокном для отопления",
    "кран шаровой бугатти латунный полдюйма для стояка"
  ]);
  return vary.every((x) => x >= PROD.VAR_SHARE_MIN) ? true : `разные карточки дали долю ${vary.join(", ")}`;
});

step("шингловое перекрытие выше 85 процентов ПРЕДУПРЕЖДАЕТ, а не блокирует", () => {
  if (PROD.SHINGLE_WARN !== 0.85) return `порог ${PROD.SHINGLE_WARN}`;
  const a = PROD.shingles("насос циркуляционный для отопления частного дома");
  const b = PROD.shingles("насос циркуляционный для отопления частного дома и квартиры");
  const o = PROD.overlap(a, b);
  if (o < PROD.SHINGLE_WARN) return `перекрытие ${o}, фикстура не про то`;
  // На серии однотипных SKU рамка одинакова по конструкции, и блокировка дала бы поток
  // принятых нарушений вместо разбора: прогон обязан остаться проходимым.
  return R_PROD.code <= 1 ? true : `прогон упал кодом ${R_PROD.code} на предупреждении`;
});

step("одинаковая проза во всех карточках блокирует сдачу кодом 2", () => {
  const f = join(dShop, "catalog-rules.yml");
  const keep = text(f);
  writeFileSync(f, keep.replace(/^  desc: ".*"$/m, '  desc: "Хороший товар со склада в наличии всегда."')
    .replace(/^  short: ".*"$/m, '  short: "Хороший товар со склада в наличии."'), "utf8");
  const r = run([PRODUCTS, dShop, "--root", ROOT, "--seed", "Вика Петрова", "--dry"]);
  writeFileSync(f, keep, "utf8");
  if (r.code !== 2) return `exit ${r.code}: серия одинаковых абзацев утянет вниз весь домен, ее нельзя сдавать`;
  return /уникальн/i.test(r.all) ? true : "в отказе не названа уникальность";
});

step("тир A уходит в выдачу НЕ ПУСТЫМ: данные рендерятся, проза ждет автора под noindex", () => {
  // Раньше верх карточки тиру A гасили намеренно, а robots ему не ставили: тридцать
  // самых спросовых карточек уезжали в индекс без описания, без решающих параметров, без
  // цены и без кнопки. Цена, наличие и параметры - это ДАННЫЕ, а не проза.
  // Разбор ровно тот же, каким читает выдачу сборка ТЗ: своего парсера набор не заводит.
  const table = CAT.parseCsv(outCsv(), ";");
  const head = table[0].map((x) => String(x).toLowerCase());
  const at = (r, name) => String(r[head.indexOf(name)] || "");
  const a = table.slice(1).filter((r) => at(r, "tier") === "A")
    .map((r) => ({ tier: "A", card_top: at(r, "card_top"), desc: at(r, "card_desc"), robots: at(r, "robots") }));
  if (!a.length) return "тира A в выдаче нет, мерить нечего";
  const emptyTop = a.filter((r) => !r.card_top.trim());
  if (emptyTop.length) return `карточек тира A с пустым верхом: ${emptyTop.length} из ${a.length}`;
  const noKey = a.filter((r) => !/руб\./.test(r.card_top));
  if (noKey.length) return `в верхе тира A нет цены у ${noKey.length} карточек`;
  const open = a.filter((r) => !r.desc && !r.robots.includes("noindex"));
  if (open.length) return `карточек тира A без прозы и без noindex: ${open.length} - в индекс уезжает недописанная страница`;
  const tasks = readJson(join(dShop, "products-tasks.json"));
  return tasks.cards.length === a.length ? true : `заданий ${tasks.cards.length}, карточек тира A ${a.length}`;
});

step("популярные товары: цепочка фолбэков и имя исполнителя ручного seed", () => {
  const check = text(join(dShop, "products-checklist.md"));
  if (!/[Пп]опулярные товары/.test(check)) return "в чек-листе сдачи нет строки о популярных товарах";
  // Продаж и просмотров нет - цепочка доходит до ручного seed, и тогда имя обязательно.
  const r = run([PRODUCTS, dShop, "--root", ROOT, "--sales", join(SANDBOX, "net-prodazh.csv"), "--dry"]);
  if (!/ИСПОЛНИТЕЛЬ НЕ НАЗВАН/.test(r.all)) return "без продаж и без --seed конвейер не потребовал имени исполнителя";
  if (r.code !== 1) return `exit ${r.code} без имени исполнителя seed`;
  const ok = run([PRODUCTS, dShop, "--root", ROOT, "--sales", join(SANDBOX, "net-prodazh.csv"), "--seed", "Вика Петрова", "--dry"]);
  return /ручной seed, исполнитель Вика Петрова/.test(ok.all) ? true : "имя исполнителя seed не доехало до отчета";
});

step("доставка, оплата и гарантия - ОДИН инклуд на сайт, а не текст в каждой карточке", () => {
  const f = join(dShop, "include-delivery.md");
  if (!existsSync(f)) return "инклуда нет";
  const rows = outCsv().split(/\r?\n/).filter(Boolean).slice(1);
  const withText = rows.filter((l) => /гарант|доставк/i.test(l.split(";")[11] || ""));
  return withText.length ? `текст доставки попал в расширенное описание ${withText.length} карточек` : true;
});

// ──────────────────────────────────────────────────────────────────────────
console.log("");
console.log("=== 7. МЕТАТЕГИ: самый дорогой текст проекта ===");
// ──────────────────────────────────────────────────────────────────────────

const R_TZ = run([TZ, dShop, "--root", ROOT]);
const tzText = () => text(join(dShop, "TZ-katalog.md"));
const metaRows = () => text(join(dShop, "meta.csv")).split(/\r?\n/).filter(Boolean).slice(1).map((l) => l.split(";"));

step("метатеги посадок уникальны ПО МАССИВУ: ни одного повтора Title, H1 и адреса", () => {
  const c = CAT_SHOP();
  const seen = { title: new Set(), h1: new Set(), url: new Set() };
  for (const L of c.landings) {
    for (const k of ["title", "h1", "url"]) {
      const v = String(L[k] || "").toLowerCase();
      if (seen[k].has(v)) return `повтор ${k}: «${L[k]}» у посадки ${L.id}`;
      seen[k].add(v);
    }
  }
  return true;
});

step("метатеги посадки не повторяют адрес своей категории", () => {
  const c = CAT_SHOP();
  const urls = new Set(c.tree.map((n) => n.url));
  const clash = c.landings.filter((L) => urls.has(L.url)).map((L) => L.id);
  return clash.length ? `посадка встала на адрес категории: ${clash.join(", ")}` : true;
});

step("meta.csv: ЗНАЧЕНИЯ, а не шаблоны, и потолки 70 и 160 соблюдены", () => {
  if (R_TZ.code > 1) return `сборка ТЗ упала: exit ${R_TZ.code}: ${R_TZ.all.slice(0, 300)}`;
  const rows = metaRows();
  if (!rows.length) return "meta.csv пуст";
  for (const r of rows) {
    const [url, , , h1, title, descr] = r.map((x) => String(x || "").replace(/^"|"$/g, ""));
    if (/\{[a-z0-9_]+\}/i.test(h1 + title + descr)) return `в строке ${url} остался неподставленный слот`;
    if (!h1) return `в строке ${url} пустой H1`;
    if (chars(title) > 70) return `Title ${chars(title)} знаков у ${url}`;
    if (chars(descr) > 160) return `Description ${chars(descr)} знаков у ${url}`;
  }
  return true;
});

step("meta.csv покрывает ВСЕ страницы каталога: категории, посадки и карточки", () => {
  const c = CAT_SHOP();
  const rows = metaRows();
  const byType = (t) => rows.filter((r) => String(r[1]).replace(/^"|"$/g, "") === t).length;
  if (byType("category") !== c.tree.length) return `категорий в meta.csv ${byType("category")}, в дереве ${c.tree.length}`;
  if (byType("facet") !== c.landings.length) return `посадок в meta.csv ${byType("facet")}, в контракте ${c.landings.length}`;
  return byType("product") > 0 ? true : "карточек товаров в meta.csv нет, хотя products_out.csv собран";
});

step("метатег категории делает ОДНА формула, а не двести ручных заголовков", () => {
  const rules = CAT.readRulesYml(join(dShop, "catalog-rules.yml"));
  const c = CAT_SHOP();
  const m = TZM.metaOfNode(c.tree[0], rules, "Тверь");
  if (!m.h1 || !m.title) return "формула не дала метатегов узлу";
  const noRules = TZM.metaOfNode(c.tree[0], new Map(), "Тверь");
  return noRules.h1 ? true : "без правил агента поле осталось пустым, а запасная формула на то и запасная";
});

step("исключение из формулы работает адресно, по id узла", () => {
  const c = CAT_SHOP();
  const rules = new Map([["h1_exceptions", new Map([[c.tree[0].id, "Насосное оборудование в Твери"]])]]);
  const m = TZM.metaOfNode(c.tree[0], rules, "Тверь");
  return /Насосное оборудование/.test(m.h1) ? true : `исключение не подставилось: «${m.h1}»`;
});

// ──────────────────────────────────────────────────────────────────────────
console.log("");
console.log("=== 8. ПАКЕТ РАЗРАБОТЧИКУ: форма важнее объема ===");
// ──────────────────────────────────────────────────────────────────────────

step("ТЗ собрано четырьмя файлами и ни один не пуст", () => {
  for (const f of [TZM.TZ_FILE, TZM.META_FILE, TZM.LANDINGS_FILE, TZM.ROBOTS_FILE]) {
    const p = join(dShop, f);
    if (!existsSync(p)) return `нет ${f}`;
    if (chars(text(p)) < 100) return `${f} пуст`;
  }
  return true;
});

step("ТЗ на 80 процентов таблицы: разработчик читает таблицу, а не прозу", () => {
  const t = TZM.tableShare(tzText());
  return t.share >= TZM.TABLE_SHARE_MIN ? true : `таблицами ${Math.round(t.share * 100)} процентов строк при норме ${Math.round(TZM.TABLE_SHARE_MIN * 100)}`;
});

step("в ТЗ есть все разделы задания: дерево, таблица категорий, фасеты, посадки, переключения, пустая выдача, крошки, перелинковка, эксплуатация", () => {
  const t = tzText();
  const want = ["Дерево каталога", "Категории плоской таблицей", "Фасеты: оси фильтра",
    "Посадки и правила индексации", "Логика переключений", "Поведение пустой выдачи",
    "Хлебные крошки", "Перелинковка", "Эксплуатация каталога"];
  const miss = want.filter((w) => !has(t, w));
  return miss.length ? `нет разделов: ${miss.join("; ")}` : true;
});

step("обе блокировки стоят ОТДЕЛЬНЫМИ разделами: по данным и по платформе", () => {
  const t = tzText();
  if (!has(t, "невозможные ПО ДАННЫМ")) return "нет раздела блокировок по данным";
  if (!has(t, "невозможные НА ВАШЕЙ ПЛАТФОРМЕ")) return "нет раздела блокировок по платформе";
  return /заполнено \d+ процентов из 70/.test(t) ? true : "в блокировке по данным нет строки «заполнено X процентов из 70»";
});

step("плоская таблица категорий несет все колонки задания, включая четыре числа режима", () => {
  const t = tzText();
  const line = t.split("\n").find((l) => l.startsWith("| ID | Уровень |"));
  if (!line) return "заголовка плоской таблицы нет";
  const cols = line.split("|").map((x) => x.trim()).filter(Boolean);
  for (const c of ["ID", "Уровень", "Название", "URL", "Родитель", "H1 страницы", "Маркер", "Товаров", "Режим"]) {
    if (!cols.includes(c)) return `нет колонки ${c}`;
  }
  // Имя колонки метатега и имена колонок признаков режима обязаны РАЗЛИЧАТЬСЯ: раньше
  // «H1» стояло в шапке дважды, и в одной строке ТЗ под ним стояли «Насосы» и «18».
  if (cols.filter((c) => c === "H1").length) return "колонка названа просто H1: она сталкивается с признаком режима";
  const sig = cols.filter((c) => /^Пр\.[1-4] /.test(c));
  if (sig.length !== 4) return `четырех чисел режима в колонках нет: ${cols.join(", ")}`;
  return new Set(cols).size === cols.length ? true : `шапка таблицы повторяет имя колонки: ${cols.join(", ")}`;
});

step("раздел эксплуатации: обязательные поля, валидация импорта и падение заполненности", () => {
  const t = tzText();
  for (const w of ["Обязательные атрибуты по категориям", "Валидация на импорте", "ниже порога"]) {
    if (!has(t, w)) return `нет подраздела «${w}»`;
  }
  return /от 20 до 70 процентов|от 70 процентов/.test(t) ? true : "лестница заполненности не названа числами";
});

step("facet-landings.csv - рабочий список посадок, строка в строку с контрактом", () => {
  const rows = text(join(dShop, TZM.LANDINGS_FILE)).split(/\r?\n/).filter(Boolean);
  const c = CAT_SHOP();
  if (rows.length - 1 !== c.landings.length) return `строк ${rows.length - 1}, посадок ${c.landings.length}`;
  const head = rows[0].split(";");
  for (const k of ["id", "node", "url", "filter", "sku", "demand", "index", "h1", "title"]) {
    if (!head.includes(k)) return `нет колонки ${k}`;
  }
  return true;
});

step("robots.snippet.txt: Clean-param и Disallow готовы к вставке, фасеты при path не режутся Disallow", () => {
  const t = text(join(dShop, TZM.ROBOTS_FILE));
  if (!/^User-agent: \*/m.test(t)) return "нет строки User-agent";
  if (!/^Disallow: \/cart/m.test(t)) return "служебные разделы не закрыты";
  if (!/^Clean-param: sort/m.test(t)) return "переключатели вида и сортировки не склеены";
  const c = CAT_SHOP();
  if (String(c.platform.facet_url) === "path") {
    const bad = t.split("\n").filter((l) => /^Disallow:/.test(l) && c.tree.some((n) => l.includes(n.url)));
    if (bad.length) return `при facet_url path закрытие делает canonical, а тут Disallow по ветке: ${bad.join(" | ")}`;
  }
  return /Sitemap:/.test(t) ? true : "нет строки Sitemap";
});

step("вердикт impossible: в ТЗ НОЛЬ фасетов и это сказано прямым текстом", () => {
  const r1 = tree(dNames);
  if (r1.code !== 0) return `tree exit ${r1.code}: ${r1.all.slice(0, 200)}`;
  const r2 = mode(dNames);
  if (r2.code !== 0) return `mode exit ${r2.code}`;
  const c = readJson(join(dNames, "catalog.json"));
  const facets = c.tree.reduce((s, n) => s + (n.facets || []).length, 0);
  if (facets || c.landings.length) return `осей ${facets}, посадок ${c.landings.length} при вердикте impossible`;
  const r3 = run([TZ, dNames, "--root", ROOT]);
  if (r3.code > 1) return `сборка ТЗ упала: ${r3.all.slice(0, 200)}`;
  const t = text(join(dNames, "TZ-katalog.md"));
  if (/^\| .*\| enum \|/m.test(t)) return "в таблице фасетов есть строки";
  if (!/Опубликованных осей НОЛЬ/.test(t)) return "ТЗ не сказало прямым текстом, что фасетов не будет";
  return /impossible/.test(t) ? true : "вердикт в ТЗ не назван";
});

step("сборка ТЗ ОТКАЗЫВАЕТСЯ без шага mode: колонка режима из нулей заказчику не уезжает", () => {
  const dir = makeProject("no-mode", { price: priceFull(), rules: RULES_FULL, serp: serpFull() });
  if (run([CATALOG, "ingest", dir, "--root", ROOT]).code !== 0) return "ingest упал";
  if (tree(dir).code !== 0) return "tree упал";
  const c = readJson(join(dir, "catalog.json"));
  if (c.tree.some((n) => n.mode || n.signals)) return "tree предзаполнил режим: страховка «сначала mode» тогда мертва";
  const r = run([TZ, dir, "--root", ROOT]);
  if (r.code !== 2) return `exit ${r.code}: ТЗ собралось без замера режима`;
  if (!/catalog\.mjs mode/.test(r.all)) return "отказ не назвал недостающую команду";
  const v = run([VCAT, dir]);
  return v.code === 2 ? true : `гейт пропустил узлы без режима, exit ${v.code}`;
});

step("вердикт impossible: в ТЗ есть раздел «Что нужно от вас», и он не спорит с разделом 3", () => {
  const t = text(join(dNames, "TZ-katalog.md"));
  if (!/## 9\. Что нужно от вас/.test(t)) return "раздела «Что нужно от вас» в ТЗ нет ни под каким номером";
  if (/все оси, найденные в прайсе, порог заполненности прошли/.test(t)) return "раздел 9 говорит, что все оси порог прошли, а раздел 3 отсылает сюда за списком нужного: два утверждения спорят в одном документе";
  if (!/ask-attributes\.csv/.test(t)) return "файл запроса характеристик в ТЗ не назван";
  const ask = TZM.readAsk(dNames);
  if (!ask.found) return "ask-attributes.csv не собран при вердикте impossible";
  for (const h of ask.head.slice(0, 3)) if (!has(t, h)) return `колонки «${h}» из файла запроса в ТЗ нет: заказчик не знает, что вписывать`;
  return true;
});

step("тир A в ТЗ печатается ДВУМЯ числами: квота и назначенное по спросу", () => {
  const t = tzText();
  const c = CAT_SHOP();
  const tasks = readJson(join(dShop, "products-tasks.json"));
  if (!/квота/.test(t)) return "в шапке ТЗ стоит одно число тира A: квота выдается за назначение";
  if (!has(t, `НАЗНАЧЕНО ПО СПРОСУ ${tasks.cards.length}`)) return `в ТЗ нет фактического числа карточек тира A (${tasks.cards.length}) при квоте ${c.counts.tier_a}`;
  const v = run([VCAT, dShop]);
  return c.counts.tier_a === tasks.cards.length || /квота тира A/.test(v.all)
    ? true : "гейт молчит о расхождении квоты и назначения";
});

step("пакет сдается ЦЕЛИКОМ: инклуд доставки и чек-лист названы в таблице файлов", () => {
  const t = tzText();
  for (const f of ["include-delivery.md", "products-checklist.md", "products_out.csv"]) {
    if (!has(t, f)) return `файла ${f} нет в таблице пакета: разработчик о нем не узнает`;
  }
  if (!existsSync(join(dShop, "include-delivery.md"))) return "инклуда доставки нет на диске";
  return /ОДИН инклуд/.test(t) ? true : "в таблице не сказано, что инклуд один на весь сайт";
});

step("гейт не дает собрать ТЗ с обещанным и невыполнимым фасетом", () => {
  const dir = join(SANDBOX, "fake-tz");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "queue.json"), JSON.stringify({ v: 1, slug: "fake-tz" }, null, 2), "utf8");
  writeFileSync(join(dir, "project.json"), JSON.stringify(baseProject("fake-tz", "shop"), null, 2), "utf8");
  const c = JSON.parse(JSON.stringify(CAT_SHOP()));
  c.verdict = "impossible";
  writeFileSync(join(dir, "catalog.json"), JSON.stringify(c, null, 2), "utf8");
  const r = run([TZ, dir, "--root", ROOT]);
  if (r.code !== 2) return `exit ${r.code}: ТЗ с фасетом при вердикте impossible это ровно та фикция, ради которой режим начинается с приемки данных`;
  return /verify-catalog/.test(r.all) ? true : "отказ не отправил к гейту контракта";
});

// ──────────────────────────────────────────────────────────────────────────
console.log("");
console.log("=== 9. СКВОЗНОЙ ПРОГОН МАГАЗИНА И ДЕТЕРМИНИЗМ ===");
// ──────────────────────────────────────────────────────────────────────────

step("сквозной прогон: прайс - вердикт - дерево - режим - гейт - товары - страницы - ТЗ", () => {
  const dir = makeProject("e2e", { price: priceFull(), rules: RULES_FULL, serp: serpFull(), sales: salesCsv });
  const chain = [
    ["ingest", run([CATALOG, "ingest", dir, "--root", ROOT])],
    ["tree", run([CATALOG, "tree", dir, "--root", ROOT])],
    ["mode", run([CATALOG, "mode", dir, "--root", ROOT])],
    ["verify-catalog", run([VCAT, dir])],
    ["render-products", run([PRODUCTS, dir, "--root", ROOT, "--seed", "Вика Петрова"])],
    ["pages", run([PAGES, dir, "--root", ROOT])],
    ["build-catalog-tz", run([TZ, dir, "--root", ROOT])]
  ];
  for (const [name, r] of chain) if (r.code > 1) return `${name} упал кодом ${r.code}: ${r.all.slice(0, 250)}`;
  const want = ["attr_map.json", "catalog.json", "products_out.csv", "products-checklist.md",
    "pages.json", "TZ-katalog.md", "meta.csv", "facet-landings.csv", "robots.snippet.txt"];
  const miss = want.filter((f) => !existsSync(join(dir, f)));
  if (miss.length) return `после прогона нет файлов: ${miss.join(", ")}`;
  const p = readJson(join(dir, "pages.json"));
  return p.pages.some((x) => x.type === "facet") ? true : "сквозной прогон не дал ни одной посадки";
});

step("детерминизм: второй прогон дерева дает байт-в-байт тот же contract", () => {
  const r = tree(dShop);
  if (r.code !== 0) return `exit ${r.code}`;
  if (!/заморожен/.test(r.all)) return "собранный каталог не заморожен: план перестает быть воспроизводимым";
  // Сверяются два ОДИНАКОВЫХ прогона tree, а не прогон до mode и после: mode чистит
  // посадки узлов без листинга, и сравнивать его выход с выходом tree значит сравнивать
  // два разных шага.
  const r1 = run([CATALOG, "tree", dShop, "--root", ROOT, "--refresh"]);
  if (r1.code !== 0) return `refresh exit ${r1.code}`;
  const first = text(join(dShop, "catalog.json"));
  const r2 = run([CATALOG, "tree", dShop, "--root", ROOT, "--refresh"]);
  if (r2.code !== 0) return `второй refresh exit ${r2.code}`;
  if (text(join(dShop, "catalog.json")) !== first) return "два одинаковых прогона дали разное дерево";
  const m = mode(dShop);
  return m.code === 0 ? true : `mode exit ${m.code}`;
});

step("гейт контракта проходит на собранном каталоге", () => {
  const r = run([VCAT, dShop]);
  if (r.code === 2) return `нарушения: ${r.all.slice(0, 400)}`;
  return /ОБЪЕМ РАБОТ И ЦЕНА СЧИТАЮТСЯ ПО ПОСАДКАМ/.test(r.all) ? true : "гейт не назвал единицу объема";
});

// ──────────────────────────────────────────────────────────────────────────
console.log("");
console.log("=== 10. БЮДЖЕТЫ И СТРАХОВКА ===");
// ──────────────────────────────────────────────────────────────────────────

step("скриптов в .claude/scripts/site: не больше 20", () => {
  const list = readdirSync(SITE_SCRIPTS).filter((f) => f.endsWith(".mjs")).sort();
  return list.length <= 20 ? true : `${list.length} скриптов: ${list.join(", ")}`;
});

step("агентов конвейера v8: не больше 8 по объявленному списку", () => {
  const list = CONTRACT.AGENTS_V8, cap = CONTRACT.AGENTS_V8_CAP;
  if (!Array.isArray(list) || !list.length) return "список агентов пуст";
  if (list.length > cap) return `${list.length} агентов при потолке ${cap}`;
  if (!list.includes("catalog-architect")) return "каталожный агент не в списке бюджета";
  const miss = list.filter((a) => !existsSync(join(ROOT, ".claude/agents", a + ".md")));
  return miss.length ? `объявлены, но файлов нет: ${miss.join(", ")}` : true;
});

step("CATALOG.md не больше 9000 знаков, SKILL.md не больше 12000", () => {
  const c = chars(text(join(SKILL_DIR, "CATALOG.md")));
  if (c > 9000) return `CATALOG.md ${c} знаков`;
  const s = chars(text(join(SKILL_DIR, "SKILL.md")));
  return s <= 12000 ? true : `SKILL.md ${s} знаков`;
});

step("SKILL.md маршрутизирует режим по business.type и называет подкоманды", () => {
  const t = text(join(SKILL_DIR, "SKILL.md"));
  if (!/CATALOG\.md/.test(t)) return "нет строки маршрутизации на CATALOG.md";
  if (!/business\.type/.test(t)) return "маршрутизация не названа переключателем business.type";
  for (const cmd of ["catalog.mjs ingest", "catalog.mjs tree", "catalog.mjs mode", "verify-catalog.mjs", "render-products.mjs", "build-catalog-tz.mjs"]) {
    if (!has(t, cmd)) return `в SKILL.md нет команды ${cmd}`;
  }
  return /ГЕЙТ ДАННЫХ/.test(t) ? true : "в SKILL.md не сказано, где стоит гейт данных";
});

step("типографика файлов режима: длинного и среднего тире и буквы е-с-точками нет", () => {
  const bad = [];
  for (const rel of MADE) {
    const p = join(ROOT, rel);
    if (!existsSync(p)) { bad.push(`${rel}: файла нет`); continue; }
    const raw = text(p);
    const body = (rel.endsWith(".mjs") ? stripDetectors(raw) : raw).replace(/`[^`\n]*`/g, "``");
    const hits = body.match(BAD_TYPO);
    if (hits) {
      const at = body.search(BAD_TYPO);
      bad.push(`${rel}: ${[...new Set(hits)].join("")} рядом с «${body.slice(Math.max(0, at - 30), at + 30).replace(/\s+/g, " ")}»`);
    }
  }
  return bad.length ? bad.join(" | ") : true;
});

step("полей-обоснований нет ни в схеме каталога, ни в собранном контракте", () => {
  const schema = text(join(SKILL_DIR, "catalog.schema.json"));
  const hit = [];
  CONTRACT.walkBanned(JSON.parse(schema).definitions || {}, (p, k) => hit.push(`${p}: ${k}`));
  if (hit.length) return `в схеме: ${hit.join(", ")}`;
  const out = [];
  CONTRACT.walkBanned(CAT_SHOP(), (p, k) => out.push(`${p}: ${k}`));
  return out.length ? `в catalog.json: ${out.join(", ")}` : true;
});

step("файлы режима магазина на месте и не пусты", () => {
  const bad = MADE.filter((rel) => !existsSync(join(ROOT, rel)) || chars(text(join(ROOT, rel))) < 500);
  return bad.length ? `нет или пусты: ${bad.join(", ")}` : true;
});

step("страховка: /seo-faq и машинерия v7 не тронуты, этапы 1 и 2 на месте", () => {
  const faqSkill = join(ROOT, ".claude/skills/seo-faq/SKILL.md");
  const faqAgent = join(ROOT, ".claude/agents/faq-builder.md");
  if (!existsSync(faqSkill) || !existsSync(faqAgent)) return "снесен /seo-faq или faq-builder";
  if (!/jm_text_analyze|jm_text_check|jm_stop_domains/.test(text(faqAgent))) return "из промта faq-builder пропала связка с SEO-сервисами";
  const want = [
    ".claude/skills/site-analiz/project.schema.json",
    ".claude/skills/site-proto/pages.yml",
    ".claude/skills/site-proto/AUTHOR.md",
    ".claude/scripts/site/_contract.mjs",
    ".claude/scripts/site/plan.mjs",
    ".claude/scripts/site/build-tasks.mjs",
    ".claude/tests/site/run.mjs",
    ".claude/tests/proto/run.mjs",
    "docs/v8/contracts-proto.md"
  ];
  const bad = want.filter((rel) => !existsSync(join(ROOT, rel)) || chars(text(join(ROOT, rel))) < 500);
  if (bad.length) return `нет или пусты: ${bad.join(", ")}`;
  const yml = text(join(SKILL_DIR, "pages.yml"));
  for (const t of ["category:", "facet:", "product:"]) if (!has(yml, t)) return `в pages.yml нет скелета ${t}`;
  return true;
});

step("структура сайта на новый контракт НЕ переведена, и это названо границей", () => {
  // Отдельная работа по решению владельца: /seo-struktura живет машинерией v7, и режим
  // магазина берет дерево из прайса, брифа и конкурентов, а не из master_list.
  if (!existsSync(join(ROOT, ".claude/skills/seo-struktura/SKILL.md"))) return "снесен /seo-struktura";
  const t = text(join(SKILL_DIR, "SKILL.md"));
  if (!/за границей среза/.test(t)) return "граница среза в SKILL.md не названа";
  const doc = text(join(ROOT, "docs/v8/contracts-catalog.md"));
  return /seo-struktura/.test(doc) ? true : "в контрактах каталога не сказано, откуда берется дерево";
});

// === Итог ===
// CATALOG_TEST_KEEP=1 оставляет песочницу на диске: разбирать упавший сквозной прогон
// по одному лишь обрезанному stdout нечем.
if (!process.env.CATALOG_TEST_KEEP) softRm(SANDBOX);
else console.log(`  [note] песочница оставлена: ${SANDBOX}`);
console.log("");
console.log(`=== ${passed}/${passed + failed} tests passed ===`);
if (failed > 0) {
  for (const f of failures) console.error(`  FAIL: ${f}`);
  process.exit(1);
}
process.exit(0);
