#!/usr/bin/env node
// run.mjs - набор этапа 1 конвейера v8: /site analiz, контракт данных и два документа гейта.
// Запуск: .claude\scripts\_node.cmd .claude\tests\site\run.mjs
//
// Что проверяется и почему именно это:
//   1. Потолки В ЗНАКАХ на каждый файл этапа. Знаки, а не строки: диета v7 мерилась
//      строками и потому не мерилась вовсе.
//   2. БЮДЖЕТЫ КОЛИЧЕСТВА - то, чего в v7 не было ни одного. Блоков не больше 30,
//      признаков ниши ровно 9, значений NEEDS ровно 5, скриптов не больше 20,
//      агентов site-* не больше 8. Правило «новое только вместо старого»: чтобы
//      добавить блок, надо снять блок. Тест-счетчик валит сборку.
//   3. Запрет полей-обоснований в схеме, рекурсивно.
//   4. Валидатор на фикстурах: что проходит и что обязано покраснеть.
//   5. Ворота: нулевой вход закрывает, три проверяемых факта открывают.
//   6. Оба документа: ноль неподставленных маркеров, ноль плейсхолдеров в документе 1,
//      не больше 10 вопросов в документе 2 и порядок по убыванию веса.
//   7. Типографика: длинное тире и е-с-точками в созданных файлах - провал.
//   8. ИНВАРИАНТ v8: запретов в промтах и шаблонах не больше, чем образцов и приемов.
//      В v7 было 125 отдельных «не» на один образец, и это была корневая причина.
//   9. Страховка от сноса согласованной машинерии: /seo-faq и faq-builder на месте.
//  10. Гейт 0 (анализ - единственный вход): словарь pages.yml в site-analiz, Д1, профиль
//      ниши и kind, цитаты фактов против входа, состав страниц без SEO в формате
//      import-structure.mjs, решение d9 и связи дальше (/seo-struktura, /site-tekst).
//  11. Программа 27.09 (W3b): строка лидера с доменом, текст главной кнопки d3, цены d6 по
//      своим ценам заказчика, контакты и реквизиты d10 (печать, лист ответов, журнал),
//      числа в ответах на возражения, правила импорта состава (шаблон по адресу).
//
// Exit 0 - все шаги прошли. Exit 1 - есть провал.

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, rmSync, cpSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname, basename } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../../..");
const TMP_ROOT = join(ROOT, ".claude/tmp");
const PREFIX = "site-test";
const SANDBOX = join(TMP_ROOT, `${PREFIX}-${process.pid}-${Date.now().toString(36)}`);

const SITE_SCRIPTS = join(ROOT, ".claude/scripts/site");
const SKILL_DIR = join(ROOT, ".claude/skills/site-analiz");
const PAGES = join(ROOT, ".claude/skills/site-analiz/pages.yml");
const PLANNER = join(ROOT, ".claude/agents/pages-planner.md");
const VERIFY = join(SITE_SCRIPTS, "verify-data.mjs");
const BUILD_PROJECT = join(SITE_SCRIPTS, "build-project.mjs");
const BUILD_DOC = join(SITE_SCRIPTS, "build-doc.mjs");
const QUEUE = join(SITE_SCRIPTS, "queue.mjs");
const APPLY = join(SITE_SCRIPTS, "apply-answers.mjs");

// Клиентский клон (программа 28.09, раздел 1): есть .claude/.machinery-version и нет
// .claude/.is-template-root. Каталог docs/ клиентам не синкается, поэтому проверки, завязанные
// на docs/ (docs/v8/*, docs/MODEL-POLICY.md), там пропускаются с причиной, а не падают.
const CLIENT_CLONE = existsSync(join(ROOT, ".claude/.machinery-version")) && !existsSync(join(ROOT, ".claude/.is-template-root"));
const skips = [];
function skipDocs(what) {
  skips.push(what);
  console.log(`  [skip] ${what} - клиентский клон: docs/ клиентам не синкается`);
}

// Файлы, созданные на этом этапе. Список один: по нему идут и потолки, и типографика.
const MADE_ALL = [
  ".claude/skills/site-analiz/SKILL.md",
  ".claude/skills/site-analiz/project.schema.json",
  ".claude/skills/site-analiz/doc1.tmpl.html",
  ".claude/skills/site-analiz/doc2.tmpl.html",
  ".claude/skills/site-analiz/pages.yml",
  ".claude/agents/site-intake.md",
  ".claude/agents/site-market.md",
  ".claude/agents/pages-planner.md",
  ".claude/scripts/site/_contract.mjs",
  ".claude/scripts/site/verify-data.mjs",
  ".claude/scripts/site/build-project.mjs",
  ".claude/scripts/site/build-doc.mjs",
  ".claude/scripts/site/queue.mjs",
  ".claude/scripts/site/apply-answers.mjs",
  ".claude/tests/site/run.mjs",
  "docs/v8/rubric.md",
  "docs/v8/README.md",
  "docs/v8/trace.csv"
];
const MADE = CLIENT_CLONE ? MADE_ALL.filter((rel) => !rel.startsWith("docs/")) : MADE_ALL;

// === Мини-фреймворк (стиль наборов машинерии) ===
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
  const r = spawnSync(process.execPath, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const out = String(r.stdout || "");
  const err = String(r.stderr || "");
  return { code: r.status ?? 1, stdout: out, stderr: err, all: out + err };
}

const chars = (s) => Array.from(String(s)).length;
const text = (p) => readFileSync(p, "utf8").replace(/^﻿/, "");
const readJson = (p) => JSON.parse(text(p));

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

// === Разбор pages.yml тем же плоским способом, что и скрипты этапа ===
function readPages(p) {
  const raw = text(p);
  const out = { chars: chars(raw), sig: [], blocks: new Map(), skel: new Map() };
  let section = null;
  for (const line of raw.split(/\r?\n/)) {
    if (/^\s*#/.test(line) || !line.trim()) continue;
    const head = line.match(/^([a-z_]+):\s*$/);
    if (head) { section = head[1]; continue; }
    const row = line.match(/^ {2}([a-z][a-z0-9_]*):\s*"(.*)"\s*$/);
    if (!row || !section) continue;
    if (section === "sig") out.sig.push(row[1]);
    else if (section === "blocks") out.blocks.set(row[1], row[2].split("|").map((s) => s.trim()));
    else if (section === "skel") out.skel.set(row[1], row[2]);
  }
  return out;
}

// === Фикстура контракта ===
// Пятнадцать фактов - это минимум схемы, поэтому они строятся, а не переписываются руками.
const FACT_SEED = [
  ["Гарантия на монтаж", "3 года по договору", ["edge", "qa"], "doc/dogovor.pdf", "number"],
  ["Срок выезда замерщика", "2 часа по городу", ["hero", "steps"], "", "number"],
  ["Опыт работы", "9 лет на рынке", ["numbers", "about"], "", "number"],
  ["Сдано объектов", "137 объектов", ["cases", "numbers"], "", "number"],
  ["Цена монтажа", "от 4500 руб за кв м", ["price"], "", "number"],
  ["Бригад в работе", "12 бригад", ["about", "numbers"], "", "number"],
  ["Лицензия", "номер 1234 от 2019 года", ["docs"], "doc/licenziya.pdf", "legal"],
  ["Срок работ", "14 дней на объект", ["steps", "cases"], "", "number"],
  ["Зона выезда", "60 км от города", ["geo"], "", "geo"],
  ["Состав работ", "7 этапов", ["scope", "steps"], "", "process"],
  ["Оплата", "рассрочка на 6 месяцев", ["delivery"], "", "claim"],
  ["Оценка на картах", "48 отзывов", ["reviews"], "https://example.test/otzyvy", "number"],
  ["Склад", "300 позиций в наличии", ["listing"], "", "product"],
  ["Смена", "работаем 12 часов", ["geo", "delivery"], "", "number"],
  ["Договор", "фиксация цены в договоре", ["price_factors"], "doc/dogovor.pdf", "legal"]
];

function baseProject() {
  const facts = FACT_SEED.map(([label, value, q, artifact, kind], i) => {
    const f = { id: "f" + String(i + 1).padStart(2, "0"), label, value, kind, q, publish: "no", src: "бриф" };
    if (artifact) f.artifact = artifact;
    return f;
  });
  return {
    v: 2,
    slug: "nevskiy-remont",
    updated: "2026-09-16",
    source: ["бриф", "созвон"],
    tier: "seo",
    gates: { promise: true, facts3: false, proof1: true, ready: false },
    business: {
      name: "Невский Ремонт",
      what: "ремонт квартир под ключ в Санкт-Петербурге",
      region: "Санкт-Петербург",
      type: "services",
      site_kind: "multipage",
      directions: [
        { id: "remont-kvartir", name: "Ремонт квартир", marker: "ремонт квартир под ключ" },
        { id: "remont-vannoy", name: "Ремонт ванной", marker: "ремонт ванной комнаты" },
        { id: "otdelka", name: "Отделка новостроек", marker: "отделка квартир в новостройке" }
      ],
      legal: { entity: "ООО Невский Ремонт", inn: "7801234567" },
      profile: { audience: "b2c", warmth: "warm", price: "high", cycle: "weeks" }
    },
    offer: {
      positioning: "бригада со своим прорабом на объекте",
      reasons: [{ claim: "Цена фиксируется в договоре", proof: "договор с фиксацией сметы", kind: "документ" }],
      promise: { who: "владелец квартиры", result: "квартира сдана в срок и без доплат", cta: "Рассчитать смету" }
    },
    audience: {
      segments: [
        {
          id: "s1", name: "Семья с ипотекой",
          pain: ["ремонт затягивается на полгода", "смета растет по ходу работ"],
          objection: [
            { says: "все равно выйдет дороже", answer: "цена фиксируется в договоре, доплата только за новые работы" },
            { says: "пропадете после аванса", answer: "оплата по этапам, аванс после подписания договора" }
          ],
          choose: ["фиксированная смета", "свой прораб"]
        },
        {
          id: "s2", name: "Инвестор под сдачу",
          pain: ["нужен быстрый оборот квартиры", "нет времени ездить на объект"],
          objection: [
            { says: "дорого для сдачи в аренду", answer: "отделка под аренду, 14 дней на объект", facts: ["f08"] },
            { says: "без меня все сделают криво", answer: "фотоотчет каждый день и приемка по этапам" }
          ],
          choose: ["срок сдачи", "фотоотчет"]
        }
      ],
      words: [{ say: "под ключ и без сюрпризов", src: "persona" }]
    },
    competitors: { market: { must_have: ["hero", "price", "steps"], page_types: ["кейсы - 4 из 5", "отзывы - 3 из 5"] }, seen_numbers: ["гарантия 3 года"] },
    facts,
    constraints: { forbidden: ["дешево"] },
    lexicon: {},
    gaps: [
      { id: "g1", ask: "Сколько стоит квадратный метр отделки", hits: ["price", "compare", "cat_intro"] },
      { id: "g2", ask: "Есть ли фото ваших объектов", hits: ["cases"] }
    ]
  };
}

const clone = (o) => JSON.parse(JSON.stringify(o));
// Цитаты фактов живут в parts/facts-src.json и обязаны стоять дословно во входе задачи:
// фикстура кладет бриф, в котором каждая цитата есть, и сам файл цитат.
function putQuotes(dir, facts) {
  mkdirSync(join(dir, "parts"), { recursive: true });
  mkdirSync(join(dir, "input"), { recursive: true });
  const src = facts.map((f, i) => ({ id: f.id, quote: `${f.label}: ${f.value || f.artifact}`, where: `input/brief.txt:${i + 1}` }));
  writeFileSync(join(dir, "parts", "facts-src.json"), JSON.stringify(src, null, 2), "utf8");
  writeFileSync(join(dir, "input", "brief.txt"), src.map((x) => x.quote).join("\n") + "\n", "utf8");
  return src;
}
function putProject(name, obj) {
  const dir = join(SANDBOX, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "project.json"), JSON.stringify(obj, null, 2) + "\n", "utf8");
  putQuotes(dir, obj.facts || []);
  return dir;
}

// Состав страниц в том виде, в каком его пишет pages-planner: адреса без слеша на конце,
// хаб - «Категория» и role «навигация», у страниц направлений section dir:<id>.
function plannerStructure() {
  const pg = (n, url, type, name, section, extra = {}) => ({
    n, url, type, name, section, target_status: "yes", marker: `${name.toLowerCase()} санкт-петербург`,
    queries: [], role: "", client_notes: "", ...extra
  });
  return {
    source_file: "pages-planner",
    pages: [
      pg(1, "/", "Главная", "Главная", "", { marker: "ремонт квартир под ключ санкт-петербург", client_notes: "сегменты s1,s2" }),
      pg(2, "/uslugi", "Категория", "Услуги", "", { role: "навигация", client_notes: "хаб направлений" }),
      pg(3, "/uslugi/remont-kvartir", "Услуга", "Ремонт квартир", "dir:remont-kvartir", { client_notes: "сегменты s1" }),
      pg(4, "/uslugi/remont-vannoy", "Услуга", "Ремонт ванной", "dir:remont-vannoy", { client_notes: "сегменты s1,s2" }),
      pg(5, "/uslugi/otdelka", "Услуга", "Отделка новостроек", "dir:otdelka", { client_notes: "сегменты s2" }),
      pg(6, "/keisy", "Инфо", "Кейсы", ""),
      pg(7, "/otzyvy", "Инфо", "Отзывы", ""),
      pg(8, "/o-kompanii", "Инфо", "О компании", ""),
      pg(9, "/kontakty", "Инфо", "Контакты", "")
    ]
  };
}
function putStructure(dir, sd) {
  writeFileSync(join(dir, "structure_data.json"), JSON.stringify(sd, null, 2) + "\n", "utf8");
  return dir;
}
const bad2 = (r) => r.all.split("\n").filter((l) => /^\s+!/.test(l)).join(" | ");

// === Счетчики инварианта v8: запреты против образцов и приемов ===
// Запрет - это конструкция «нельзя», а не любое «не» в прозе: клиентский документ говорит
// «ничего сверх этого мы не придумываем», и это не запрет писателю.
const BAN_RE = [
  /(^|[^А-ЯA-Z])НЕ(\s|$)/g,
  /нельзя|запрещ[а-я]*|запрет[а-я]*|никогда|ни при каких|не должен|не должно|не должны|не вправе|не имеет права|не бывает|не существует/gi,
  /не\s+(пиш|использ|делай|делаешь|трогай|трогаешь|ставь|ставишь|ставит|добавляй|добавляешь|выдумыв|меняй|меняешь|ходи|ходишь|копируй|переноси|переносишь|сочиняй|сохраняй|сохраняешь|заполняй|читай|читаешь|бери|берешь|включай|печатай|пропускай|отвечай|приписывай|подгоняй|ломай|выноси|вписывай)[а-я]*/gi,
  /->\s*0(\s|$)/g
];
const SAMPLE_RE = [
  /```[\s\S]*?```/g,
  /«[^»\n]{3,}»/g,
  /`[^`\n]{3,}`/g,
  /например|образц?[аеуо]?в?\b|шаблон[а-я]*|формул[а-я]+|по форме|вот так/gi,
  /^\s*\d+\.\s+\S/gm
];
const countBy = (t, list) => list.reduce((n, re) => n + (String(t).match(re) || []).length, 0);

// === Типографика: в скриптах сами детекторы содержат запрещенные знаки ===
// Символьный класс регулярки и карта имен - это код проверки, а не текст. Их снимаем,
// остальное обязано быть чистым.
// Сам файл набора тоже попадает под проверку, поэтому запрещенные знаки в нем записаны
// escape-последовательностями: детектор описан кодами, а не символами.
const TYPO_CLASS = "[\\u2012\\u2013\\u2014\\u2015\\u2212\\u0451\\u0401]";
const YO_CLASS = "[\\u0451\\u0401]";
const stripDetectors = (t) => String(t)
  .replace(/\[[^\]\n]{0,60}\]/g, "[]")
  .replace(new RegExp('"' + TYPO_CLASS + '"', "g"), '""')
  .replace(new RegExp("/" + YO_CLASS + "/", "g"), "//");
const BAD_TYPO = new RegExp("[\\u2012\\u2013\\u2014\\u2015\\u0451\\u0401]", "g");

sweepOldSandboxes();
try { mkdirSync(SANDBOX, { recursive: true }); }
catch (err) { console.error(`[fatal] не создать песочницу ${SANDBOX}: ${err.code || err.message}`); process.exit(1); }

const pages = readPages(PAGES);

// ──────────────────────────────────────────────────────────────────────────
console.log("=== Файлы этапа и потолки в знаках ===");
// ──────────────────────────────────────────────────────────────────────────

if (CLIENT_CLONE) skipDocs("файлы docs/v8/* в списке файлов этапа (наличие и типографика)");
step("все файлы этапа лежат на диске и не пусты", () => {
  const missing = MADE.filter((rel) => {
    const p = join(ROOT, rel);
    return !existsSync(p) || chars(text(p)) < 200;
  });
  return missing.length ? `нет или пусты: ${missing.join(", ")}` : true;
});

step("SKILL.md /site analiz: потолок 12000 знаков", () => {
  const n = chars(text(join(SKILL_DIR, "SKILL.md")));
  return n <= 12000 ? true : `${n} знаков`;
});

step("pages.yml: потолок 7600 знаков", () => {
  return pages.chars <= 7600 ? true : `${pages.chars} знаков`;
});

step("агенты анализа: потолок 10000 знаков каждый", () => {
  const bad = [];
  for (const name of ["site-intake.md", "site-market.md", "pages-planner.md"]) {
    const n = chars(text(join(ROOT, ".claude/agents", name)));
    if (n > 10000) bad.push(`${name} ${n}`);
  }
  return bad.length ? bad.join(", ") : true;
});

step("шаблоны документов самодостаточны: ни внешнего ресурса, ни скрипта", () => {
  const bad = [];
  for (const name of ["doc1.tmpl.html", "doc2.tmpl.html"]) {
    const t = text(join(SKILL_DIR, name));
    if (/<script|<link\b|https?:\/\/|<img\b/i.test(t)) bad.push(name);
  }
  return bad.length ? `тянут наружу: ${bad.join(", ")}` : true;
});

step("шаблоны не умеют печатать дефолт: ветки «иначе» в них нет", () => {
  const bad = ["doc1.tmpl.html", "doc2.tmpl.html"].filter((n) => /\{\{\^/.test(text(join(SKILL_DIR, n))));
  return bad.length ? `есть ветка «иначе»: ${bad.join(", ")}` : true;
});

step("обязательные концовки обоих документов стоят в шаблонах", () => {
  const d1 = text(join(SKILL_DIR, "doc1.tmpl.html"));
  const d2 = text(join(SKILL_DIR, "doc2.tmpl.html"));
  if (!/Если вы ничего не поправите, мы работаем по этому документу/.test(d1)) return "в документе 1 нет финальной строки";
  if (!/\{\{fin_hint\}\}/.test(d2)) return "в документе 2 нет маркера финальной строки - подпись перестала подстраиваться под число вопросов";
  if (!/сайт вс[ее] равно будет, просто короче/.test(d2)) return "в документе 2 нет второй половины финальной строки";
  return true;
});

// ──────────────────────────────────────────────────────────────────────────
console.log("");
console.log("=== Бюджеты КОЛИЧЕСТВА (главное, чего не было в v7) ===");
// ──────────────────────────────────────────────────────────────────────────

step("id блоков в pages.yml: не больше 30 (новое только вместо старого)", () => {
  return pages.blocks.size <= 30 ? true : `${pages.blocks.size} блоков - чтобы добавить, надо снять`;
});

step("признаков ниши sig: ровно 9", () => {
  return pages.sig.length === 9 ? true : `${pages.sig.length} признаков: ${pages.sig.join(", ")}`;
});

step("значений NEEDS: ровно 5 и все из закрытого списка", () => {
  const allowed = ["число", "состав", "условие", "действие", "граница"];
  const seen = new Set();
  const bad = [];
  for (const [id, cols] of pages.blocks) {
    if (cols.length !== 7) { bad.push(`${id}: колонок ${cols.length}`); continue; }
    seen.add(cols[5]);
    if (!allowed.includes(cols[5])) bad.push(`${id}: NEEDS «${cols[5]}»`);
  }
  if (bad.length) return bad.join("; ");
  return seen.size === 5 ? true : `в ходу ${seen.size} значений: ${[...seen].join(", ")}`;
});

step("функция блока: только Р, Д, К, В, и блоков функции В не больше половины", () => {
  const fn = new Set(["Р", "Д", "К", "В"]);
  let v = 0;
  const bad = [];
  for (const [id, cols] of pages.blocks) {
    if (!fn.has(cols[0])) bad.push(`${id}: «${cols[0]}»`);
    if (cols[0] === "В") v++;
  }
  if (bad.length) return `функция вне набора: ${bad.join(", ")}`;
  return v * 2 <= pages.blocks.size ? true : `блоков В ${v} из ${pages.blocks.size} - страница станет оправданием`;
});

step("скриптов в .claude/scripts/site: не больше 20", () => {
  const n = readdirSync(SITE_SCRIPTS).filter((f) => f.endsWith(".mjs")).length;
  return n <= 20 ? true : `${n} скриптов`;
});

step("агентов site-*.md: не больше 8", () => {
  const n = readdirSync(join(ROOT, ".claude/agents")).filter((f) => /^site-.*\.md$/.test(f)).length;
  return n <= 8 ? true : `${n} агентов`;
});

step("типы страниц в skel: семь известных, типа article не существует", () => {
  const want = ["home", "landing", "service", "category", "facet", "product", "info"];
  const miss = want.filter((t) => !pages.skel.has(t));
  if (miss.length) return `нет типов: ${miss.join(", ")}`;
  if (pages.skel.has("article")) return "появился тип article - статьи не дело этого конвейера";
  const extra = [...pages.skel.keys()].filter((t) => !want.includes(t));
  return extra.length ? `лишние типы: ${extra.join(", ")}` : true;
});

step("составы skel и ссылки скриптов ведут только на существующие id блоков", () => {
  const ids = new Set(pages.blocks.keys());
  const bad = [];
  for (const [type, line] of pages.skel) {
    if (type === "info") continue;
    for (const tok of String(line).split(/\s+/)) {
      const id = tok.replace(/!$/, "");
      if (id && !ids.has(id)) bad.push(`skel.${type}: ${id}`);
    }
  }
  const cut = (file, from, to) => { const t = text(file); const a = t.indexOf(from); return a < 0 ? "" : t.slice(a, t.indexOf(to, a)); };
  const sec = cut(BUILD_DOC, "const SECTION_OF", "};");
  for (const m of sec.matchAll(/([a-z_][a-z0-9_]*):\s*"/g)) if (!ids.has(m[1])) bad.push(`build-doc SECTION_OF: ${m[1]}`);
  const hints = cut(BUILD_PROJECT, "const HINTS", "];");
  for (const m of hints.matchAll(/"([a-z_][a-z0-9_]*)"/g)) if (!ids.has(m[1])) bad.push(`build-project HINTS: ${m[1]}`);
  return bad.length ? `ссылки на несуществующие блоки: ${bad.join(", ")}` : true;
});

// ──────────────────────────────────────────────────────────────────────────
console.log("");
console.log("=== Контракт данных: запрет полей-обоснований ===");
// ──────────────────────────────────────────────────────────────────────────

const BANNED_FIELDS = ["rationale", "why", "note", "confidence", "evidence", "status", "function_why", "client_why"];

step("в схеме нет полей-обоснований (рекурсивно по properties и required)", () => {
  const schema = readJson(join(SKILL_DIR, "project.schema.json"));
  const hits = [];
  const bad = (k) => {
    const kl = String(k).toLowerCase();
    return BANNED_FIELDS.includes(kl) || BANNED_FIELDS.includes(kl.replace(/s$/, "")) || /_why$/.test(kl) || /^why_/.test(kl);
  };
  const walk = (node, path) => {
    if (Array.isArray(node)) { node.forEach((v, i) => walk(v, `${path}[${i}]`)); return; }
    if (!node || typeof node !== "object") return;
    if (node.properties && typeof node.properties === "object") {
      for (const k of Object.keys(node.properties)) if (bad(k)) hits.push(`${path}.properties.${k}`);
    }
    if (Array.isArray(node.required)) {
      for (const k of node.required) if (bad(k)) hits.push(`${path}.required: ${k}`);
    }
    for (const [k, v] of Object.entries(node)) walk(v, path ? `${path}.${k}` : k);
  };
  walk(schema, "");
  return hits.length ? hits.join(", ") : true;
});

step("контракт несет действующий сайт клиента, его страницы и ассортимент", () => {
  // Без business.site нельзя снять старый сайт, построить редиректы и напечатать адрес
  // в подвале. client_pages и assortment - сырье для состава страниц и для каталога.
  // Все три поля заодно закрывают часть входа /seo-struktura, когда ее будут переводить
  // на новый контракт, поэтому терять их молча нельзя.
  const schema = readJson(join(SKILL_DIR, "project.schema.json"));
  const b = ((schema.properties || {}).business || {}).properties || {};
  const miss = ["site", "client_pages", "assortment"].filter((k) => !b[k]);
  if (miss.length) return `в business нет полей: ${miss.join(", ")}`;
  if (!Array.isArray(b.site.type) || !b.site.type.includes("null")) return "business.site обязан допускать null - сайта у клиента может не быть";
  const intake = text(join(ROOT, ".claude/agents/site-intake.md"));
  const unknown = ["site", "client_pages", "assortment"].filter((k) => !new RegExp("`" + k + "[`\[]").test(intake));
  return unknown.length ? `site-intake не знает про поля: ${unknown.join(", ")} - схема их ждет, а заполнять некому` : true;
});

step("схема закрыта: у каждого узла со свойствами стоит additionalProperties false", () => {
  const schema = readJson(join(SKILL_DIR, "project.schema.json"));
  const open = [];
  const walk = (node, path) => {
    if (Array.isArray(node)) { node.forEach((v, i) => walk(v, `${path}[${i}]`)); return; }
    if (!node || typeof node !== "object") return;
    if (node.properties && typeof node.properties === "object" && node.additionalProperties !== false) open.push(path || "(корень)");
    for (const [k, v] of Object.entries(node)) walk(v, path ? `${path}.${k}` : k);
  };
  walk(schema, "");
  return open.length ? `открытые узлы: ${open.join(", ")}` : true;
});

step("имя поля-обоснования не занято под id блока или ключ данных", () => {
  // Инвариант обязан быть греппабельным: пока блок назывался why, простая проверка
  // «нет поля why» врала на pages.yml и на карте разделов документа.
  const bad = [...pages.blocks.keys()].filter((id) => BANNED_FIELDS.includes(id) || /_why$|^why_/.test(id));
  if (bad.length) return `id блоков ${bad.join(", ")} совпадают с именами полей-обоснований`;
  const hits = [];
  for (const rel of MADE) {
    if (!existsSync(join(ROOT, rel))) continue;
    if (rel === ".claude/tests/site/run.mjs" || rel.endsWith("_contract.mjs")) continue;
    for (const m of text(join(ROOT, rel)).matchAll(/^\s*"?([a-z_]+)"?\s*:/gm)) {
      if (BANNED_FIELDS.includes(m[1])) hits.push(`${rel}: ${m[1]}`);
    }
  }
  return hits.length ? `поле-обоснование ключом: ${hits.join(", ")}` : true;
});

step("шаблоны документов не печатают ни одного поля-обоснования", () => {
  const hits = [];
  for (const name of ["doc1.tmpl.html", "doc2.tmpl.html"]) {
    const t = text(join(SKILL_DIR, name));
    for (const m of t.matchAll(/\{\{[#/]?([a-z0-9_.]+)\}\}/g)) {
      const k = m[1].split(".").pop().toLowerCase();
      if (BANNED_FIELDS.includes(k) || /_why$/.test(k)) hits.push(`${name}: ${m[0]}`);
    }
  }
  return hits.length ? hits.join(", ") : true;
});

// ──────────────────────────────────────────────────────────────────────────
console.log("");
console.log("=== Валидатор на фикстурах ===");
// ──────────────────────────────────────────────────────────────────────────

step("корректный контракт проходит: exit 0, ни одного нарушения", () => {
  const dir = putProject("ok", baseProject());
  const r = run([VERIFY, dir, "--seed", "--no-write"]);
  if (r.code !== 0) return `exit ${r.code}: ${r.all.split("\n").filter((l) => /^\s+[!~]/.test(l)).join(" | ")}`;
  return true;
});

step("контракт с полем-обоснованием падает и называет поле", () => {
  const p = baseProject();
  p.offer.reasons[0].rationale = "потому что так решил агент";
  const dir = putProject("rationale", p);
  const r = run([VERIFY, dir, "--seed", "--no-write"]);
  if (r.code !== 2) return `exit ${r.code}, ждали 2`;
  if (!/rationale/.test(r.all)) return "в отчете не назван виновник";
  return true;
});

step("поле-обоснование ловится и в глубине дерева, не только на первом уровне", () => {
  const p = baseProject();
  p.audience.segments[0].objection[0].confidence = "высокая";
  const dir = putProject("deep", p);
  const r = run([VERIFY, dir, "--seed", "--no-write"]);
  return r.code === 2 && /confidence/.test(r.all) ? true : `exit ${r.code}: ${r.all.slice(0, 200)}`;
});

step("контракт с 21-значным ИНН падает (реальный баг прошлой версии)", () => {
  const p = baseProject();
  p.business.legal.inn = "123456789012345678901";
  const dir = putProject("inn", p);
  const r = run([VERIFY, dir, "--seed", "--no-write"]);
  if (r.code !== 2) return `exit ${r.code}, ждали 2 - 21 цифра доехала бы до подвала сайта`;
  if (!/inn/.test(r.all)) return "в отчете не назван inn";
  return true;
});

step("контракт с publish yes при засеве падает", () => {
  const p = baseProject();
  p.facts[0].publish = "yes";
  const dir = putProject("seed-yes", p);
  const r = run([VERIFY, dir, "--seed", "--no-write"]);
  if (r.code !== 2) return `exit ${r.code}, ждали 2 - yes ставит только гейт`;
  if (!/publish/.test(r.all)) return "в отчете не названо поле publish";
  return true;
});

step("тот же publish yes ПОСЛЕ гейта (без засева) нарушением не является", () => {
  const p = baseProject();
  p.facts[0].publish = "yes";
  const dir = putProject("gate-yes", p);
  const r = run([VERIFY, dir, "--no-write"]);
  return r.code === 2 ? `exit 2: ${r.all}` : true;
});

step("facts[].q со ссылкой на несуществующий блок падает", () => {
  const p = baseProject();
  p.facts[0].q = ["block_kotorogo_net"];
  const dir = putProject("badq", p);
  const r = run([VERIFY, dir, "--seed", "--no-write"]);
  if (r.code !== 2) return `exit ${r.code}, ждали 2`;
  if (!/block_kotorogo_net/.test(r.all)) return "в отчете не назван выдуманный блок";
  return true;
});

step("gaps[].hits и must_have на несуществующий блок тоже падают", () => {
  const p = baseProject();
  p.gaps[0].hits = ["nikogo_takogo_net"];
  p.competitors.market.must_have = ["hero", "vydumannyy"];
  const dir = putProject("badhits", p);
  const r = run([VERIFY, dir, "--seed", "--no-write"]);
  if (r.code !== 2) return `exit ${r.code}, ждали 2`;
  if (!/nikogo_takogo_net/.test(r.all) || !/vydumannyy/.test(r.all)) return "назван не весь мусор";
  return true;
});

step("чужой признак ниши вне словаря из девяти имен падает", () => {
  const p = baseProject();
  p.business.sig = ["price_open", "moy_priznak"];
  const dir = putProject("badsig", p);
  const r = run([VERIFY, dir, "--seed", "--no-write"]);
  return r.code === 2 && /moy_priznak/.test(r.all) ? true : `exit ${r.code}: ${r.all.slice(0, 200)}`;
});

step("persona в audience.words не штрафуется: ярлык, а не ворота", () => {
  const p = baseProject();
  p.audience.words = [
    { say: "под ключ и без сюрпризов", src: "persona" },
    { say: "чтобы без доплат в конце", src: "persona" },
    { say: "боюсь, что бросят на полпути", src: "persona" }
  ];
  const dir = putProject("persona", p);
  const r = run([VERIFY, dir, "--seed", "--no-write"]);
  if (r.code !== 0) return `exit ${r.code}: ${r.all}`;
  return true;
});

function fatProject() {
  const p = baseProject();
  const pad = (s, n) => (s + " " + "слово ".repeat(60)).slice(0, n).trim();
  p.constraints.forbidden = Array.from({ length: 30 }, (_, i) => pad("запрещенное слово номер " + i, 80));
  p.constraints.not_self = Array.from({ length: 10 }, (_, i) => pad("мы не такие номер " + i, 160));
  p.constraints.not_selling = Array.from({ length: 10 }, (_, i) => pad("этого мы не продаем номер " + i, 160));
  p.constraints.must_say = Array.from({ length: 10 }, (_, i) => pad("обязаны сказать номер " + i, 160));
  p.competitors.seen_numbers = Array.from({ length: 20 }, (_, i) => pad("цифра рынка номер " + i, 120));
  p.competitors.list = Array.from({ length: 15 }, (_, i) => pad("конкурент номер " + i, 120));
  p.offer.limits = Array.from({ length: 8 }, (_, i) => pad("граница работы номер " + i, 200));
  p.lexicon = {
    locked: Array.from({ length: 25 }, (_, i) => pad("слово заказчика " + i, 60)),
    canonical: Array.from({ length: 25 }, (_, i) => pad("каноническая форма " + i, 60)),
    translate: Array.from({ length: 25 }, (_, i) => ({ from: pad("внутреннее слово " + i, 60), to: pad("слово клиента " + i, 80) }))
  };
  p.audience.words = Array.from({ length: 25 }, (_, i) => ({ say: pad("так говорит клиент " + i, 120), means: pad("а значит это " + i, 160), src: "persona" }));
  p.business.geo = Array.from({ length: 30 }, (_, i) => pad("зона обслуживания номер " + i, 80));
  p.business.directions = Array.from({ length: 25 }, (_, i) => ({ id: "napravlenie-" + i, name: pad("направление " + i, 80), marker: pad("как это ищут словами клиента " + i, 120) }));
  p.competitors.market = { must_have: ["hero", "price", "steps"], gaps: Array.from({ length: 10 }, (_, i) => pad("дырка рынка " + i, 160)), offers_seen: Array.from({ length: 12 }, (_, i) => pad("обещают на рынке " + i, 160)) };
  p.gaps = Array.from({ length: 10 }, (_, i) => ({ id: "g" + (i + 1), ask: pad("вопрос заказчику номер " + i, 200), hits: ["price", "cases"] }));
  for (const f of p.facts) f.value = pad(f.value, 200);
  for (const s of p.audience.segments) {
    s.pain = s.pain.map((x) => pad(x, 160));
    s.objection = s.objection.map((o) => ({ says: pad(o.says, 200), answer: pad(o.answer, 240) }));
  }
  p.business.client_pages = Array.from({ length: 60 }, (_, i) => ({ url: `https://example.test/razdel-${i}/${"stranica-".repeat(8)}${i}`, name: pad("страница сайта " + i, 60) }));
  p.business.assortment = Array.from({ length: 80 }, (_, i) => pad("позиция ассортимента " + i, 60));
  return p;
}

step("бюджет файла: контракт на 32000 знаков не принимается", () => {
  const dir = putProject("fat", fatProject());
  const size = chars(JSON.stringify(readJson(join(dir, "project.json"))));
  if (size < 32000) return `фикстура вышла на ${size} знаков - тест не проверил потолок`;
  const r = run([VERIFY, dir, "--seed", "--no-write"]);
  return r.code === 2 && /32000/.test(r.all) ? true : `exit ${r.code} при ${size} знаках`;
});

step("бюджет файла: каталожный проект размера IBG (26-31 тысяча знаков) - предупреждение, а не отказ", () => {
  // Старый потолок 26000 отказывал бы IBG, как только сборка перестала выбрасывать сайт,
  // страницы сайта и ассортимент. Порог предупреждения при этом обязан сработать.
  const p = fatProject();
  const cuts = [
    () => { p.business.client_pages = p.business.client_pages.slice(0, 2); p.business.assortment = p.business.assortment.slice(0, 14); },
    () => { p.audience.words = p.audience.words.slice(0, 10); },
    () => { for (const k of ["locked", "canonical", "translate"]) p.lexicon[k] = p.lexicon[k].slice(0, 5); },
    () => { for (const k of ["not_self", "not_selling", "must_say"]) p.constraints[k] = p.constraints[k].slice(0, 3); },
    () => { p.business.directions = p.business.directions.slice(0, 15); },
    () => { p.competitors.list = p.competitors.list.slice(0, 5); p.competitors.seen_numbers = p.competitors.seen_numbers.slice(0, 8); },
    () => { p.business.geo = p.business.geo.slice(0, 10); p.constraints.forbidden = p.constraints.forbidden.slice(0, 10); }
  ];
  for (const cut of cuts) { if (chars(JSON.stringify(p)) < 30500) break; cut(); }
  const dir = putProject("ibg-size", p);
  const size = chars(JSON.stringify(readJson(join(dir, "project.json"))));
  if (size < 26000 || size >= 32000) return `фикстура вышла на ${size} знаков - нужна вилка 26000-31999`;
  const r = run([VERIFY, dir, "--seed", "--no-write"]);
  if (r.code === 2) return `отказ при ${size} знаках: ${bad2(r)}`;
  return /порог 22000/.test(r.all) ? true : `предупреждение не напечатано при ${size} знаках`;
});

// ──────────────────────────────────────────────────────────────────────────
console.log("");
console.log("=== Ворота: считает скрипт, а не агент ===");
// ──────────────────────────────────────────────────────────────────────────

step("нулевой вход закрывает ворота: promise, facts3, proof1 и ready - false", () => {
  const p = baseProject();
  p.offer.promise.result = "";
  p.offer.reasons = [{ claim: "Работаем аккуратно", kind: "процесс" }];
  p.gates = { promise: false, facts3: false, proof1: false, ready: false };
  const dir = putProject("gates-closed", p);
  const r = run([VERIFY, dir, "--seed"]);
  if (r.code === 2) return `exit 2: ${r.all}`;
  const g = readJson(join(dir, "project.json")).gates;
  if (g.promise || g.facts3 || g.proof1 || g.ready) return `ворота открылись на пустом входе: ${JSON.stringify(g)}`;
  if (!/ready false/.test(r.all)) return "скрипт не объяснил, что ready false - не брак";
  return true;
});

step("три проверяемых факта плюс обещание и доказательство открывают ворота", () => {
  const p = baseProject();
  p.facts[0].publish = "yes";   // артефакт
  p.facts[1].publish = "yes";   // 2 часа
  p.facts[2].publish = "yes";   // 9 лет
  p.gates = { promise: false, facts3: false, proof1: false, ready: false };
  const dir = putProject("gates-open", p);
  const r = run([VERIFY, dir]);
  if (r.code === 2) return `exit 2: ${r.all}`;
  const g = readJson(join(dir, "project.json")).gates;
  if (!g.ready) return `ready ${g.ready} при ${JSON.stringify(g)}`;
  return true;
});

step("цифра без единицы измерения проверяемым фактом не считается", () => {
  const p = baseProject();
  for (let i = 0; i < 3; i++) {
    p.facts[i].publish = "yes";
    p.facts[i].value = String(100 + i);
    delete p.facts[i].artifact;
  }
  p.gates = { promise: false, facts3: false, proof1: false, ready: false };
  const dir = putProject("gates-blind", p);
  const r = run([VERIFY, dir]);
  if (r.code === 2) return `exit 2: ${r.all}`;
  const g = readJson(join(dir, "project.json")).gates;
  if (g.facts3) return "голые числа открыли ворота facts3";
  if (!/единиц/.test(r.all)) return "скрипт не сказал, почему факт не считается проверяемым";
  return true;
});

step("ворота derived: значения агента перебиваются пересчетом и об этом печатается строка", () => {
  const p = baseProject();
  p.gates = { promise: true, facts3: true, proof1: true, ready: true };
  const dir = putProject("gates-lie", p);
  const r = run([VERIFY, dir, "--seed"]);
  const g = readJson(join(dir, "project.json")).gates;
  if (g.ready) return "выдуманные ворота уцелели";
  if (!/пересчитан/.test(r.all)) return "пересчет прошел молча";
  return true;
});

// ──────────────────────────────────────────────────────────────────────────
console.log("");
console.log("=== Два документа гейта ===");
// ──────────────────────────────────────────────────────────────────────────

// Имена документов задает не набор, а queue.mjs: он считает шаг закрытым по этим путям.
const DOC1 = "understood.html";
const DOC2 = "ask.html";
const doc = (dir, name) => join(dir, "docs", name);

const docDir = putProject("docs", baseProject());
const docRun = run([BUILD_DOC, docDir]);

step("оба документа собираются: нарушений нет, файлы записаны", () => {
  if (docRun.code === 2) return `exit 2: ${docRun.all}`;
  for (const f of [DOC1, DOC2]) if (!existsSync(doc(docDir, f))) return `нет docs/${f}`;
  return true;
});

step("в собранных документах нет неподставленных маркеров", () => {
  for (const f of [DOC1, DOC2]) {
    const t = text(doc(docDir, f));
    if (/\{\{|\}\}/.test(t)) return `${f}: остались фигурные маркеры`;
  }
  return true;
});

step("в документе 1 нет ни одного плейсхолдера и ни одного открытого вопроса", () => {
  const t = text(doc(docDir, DOC1));
  const ph = t.match(/\[(?:[А-Я][А-Я _-]{2,40}|TODO|TBD|XXX|\.\.\.)\]/);
  if (ph) return `плейсхолдер ${ph[0]}`;
  // «пока нечем» и прочерк в ячейке значения - тот же открытый вопрос, только словами.
  const open = t.match(/пока нечем|уточнить у заказчика|нужно уточнить|дайте доказательство|\?\?\?|<td>\s*-\s*<\/td>/i);
  if (open) return `в документе 1 остался открытый вопрос: «${open[0].trim()}»`;
  return true;
});

step("документ 1 кончается объявленным дефолтом, документ 2 - своей строкой", () => {
  const d1 = text(doc(docDir, DOC1));
  const d2 = text(doc(docDir, DOC2));
  if (!/Если вы ничего не поправите, мы работаем по этому документу/.test(d1)) return "нет финальной строки документа 1";
  if (!/Ответите на (первые три|оба|этот вопрос) - тексты станут заметно сильнее/.test(d2)) return "нет финальной строки документа 2 (подпись обязана называть фактическое число вопросов)";
  return true;
});

step("в документе 2 не больше 10 вопросов", () => {
  const n = (text(doc(docDir, DOC2)).match(/class="ask"/g) || []).length;
  return n <= 10 ? true : `${n} вопросов`;
});

step("вопросы документа 2 отсортированы по весу убывающе", () => {
  const p = baseProject();
  p.gaps = [
    { id: "g1", ask: "Есть ли фото ваших объектов", hits: ["cases"] },
    { id: "g2", ask: "Сколько стоит квадратный метр отделки", hits: ["price", "compare", "cat_intro"] },
    { id: "g3", ask: "Какой срок работ по типовой квартире", hits: ["steps", "hero"] }
  ];
  const dir = putProject("order", p);
  const v = run([VERIFY, dir, "--seed"]);
  if (v.code === 2) return `валидатор: ${v.all}`;
  const after = readJson(join(dir, "project.json")).gaps;
  const w = after.map((g) => g.weight);
  for (let i = 1; i < w.length; i++) if (w[i] > w[i - 1]) return `веса в контракте не по убыванию: ${w.join(", ")}`;
  const b = run([BUILD_DOC, dir]);
  if (b.code === 2) return `сборка документов: ${b.all}`;
  const html = text(doc(dir, DOC2));
  const rows = [...html.matchAll(/<tr class="ask">[\s\S]*?<\/tr>/g)].map((m) => m[0]);
  if (rows.length !== after.length) return `строк в документе ${rows.length}, вопросов в контракте ${after.length}`;
  const seen = rows.map((row) => {
    const g = after.find((x) => row.includes(x.ask.slice(0, 25)));
    return g ? g.weight : -1;
  });
  if (seen.includes(-1)) return `вопрос из документа не найден в контракте: ${seen.join(", ")}`;
  for (let i = 1; i < seen.length; i++) if (seen[i] > seen[i - 1]) return `в документе порядок не по ценности: ${seen.join(", ")}`;
  return true;
});

step("тонкая фактура: шаблон не выдумывает график работы и телефон", () => {
  const p = baseProject();
  delete p.business.legal;
  p.business.what = "онлайн-сервис подбора подрядчика без офиса";
  const dir = putProject("thin", p);
  const r = run([BUILD_DOC, dir]);
  if (r.code === 2) return `exit 2: ${r.all}`;
  const t = text(doc(dir, DOC1));
  if (/график работы|пн-пт|ежедневно с/i.test(t)) return "в документе появился выдуманный график";
  if (/\+7|телефон:/i.test(t)) return "в документе появился выдуманный телефон";
  if (/\{\{/.test(t)) return "остались маркеры";
  return true;
});

step("кавычки только для реальной цитаты: реконструкция идет отдельным списком", () => {
  const p = baseProject();
  p.audience.words = [
    { say: "бросили на полпути", means: "страх незавершенного ремонта", src: "forum" },
    { say: "чтобы без доплат в конце", means: "ждет фиксированной сметы", src: "persona" }
  ];
  const dir = putProject("quotes", p);
  const r = run([BUILD_DOC, dir]);
  if (r.code === 2) return `exit 2: ${r.all}`;
  const t = text(doc(dir, DOC1));
  if (!/«бросили на полпути»/.test(t)) return "реальная цитата не поставлена в кавычки";
  if (/«чтобы без доплат в конце»/.test(t)) return "реконструкция подана прямой речью";
  return true;
});

step("причина без доказательства в документ 1 не попадает вовсе", () => {
  const p = baseProject();
  p.offer.reasons = [
    { claim: "Цена фиксируется в договоре", proof: "договор с фиксацией сметы", kind: "документ" },
    { claim: "Работаем без предоплаты", kind: "процесс" }
  ];
  const dir = putProject("noproof", p);
  const r = run([BUILD_DOC, dir]);
  if (r.code === 2) return `exit 2: ${r.all}`;
  const t = text(doc(dir, DOC1));
  if (/пока нечем/.test(t)) return "в документе стоит текст-заглушка вместо доказательства";
  if (/Работаем без предоплаты/.test(t)) return "причина без доказательства напечатана заказчику";
  return /Цена фиксируется в договоре/.test(t) ? true : "причина с доказательством пропала вместе с пустой";
});

step("факт без значения печатается подтверждением, а не прочерком", () => {
  const p = baseProject();
  p.facts[3].value = "";
  p.facts[3].artifact = "doc/akt-sdachi.pdf";
  const dir = putProject("novalue", p);
  const r = run([BUILD_DOC, dir]);
  if (r.code === 2) return `exit 2: ${r.all}`;
  const t = text(doc(dir, DOC1));
  if (/<td>\s*-\s*<\/td>/.test(t)) return "прочерк в ячейке значения - тот же открытый вопрос";
  return /akt-sdachi/.test(t) ? true : "подтверждение не напечатано вовсе";
});

step("вопросов нет - документ 1 все равно записан", () => {
  const p = baseProject();
  p.gaps = [];
  const dir = putProject("nogaps", p);
  const r = run([BUILD_DOC, dir]);
  if (r.code === 2) return `exit 2: ${r.all}`;
  if (!existsSync(doc(dir, DOC1))) return "документ 1 погиб вместе с несобранным документом 2";
  return existsSync(doc(dir, DOC2)) ? "документ 2 собрался без единого вопроса" : true;
});

step("объем документа 1 - предупреждение с именем раздела, а не отказ", () => {
  const p = baseProject();
  const pad = (s, n) => (s + " " + "слово ".repeat(60)).slice(0, n).trim();
  for (const f of p.facts) f.value = pad(f.value, 200);
  p.competitors.seen_numbers = Array.from({ length: 20 }, (_, i) => pad("цифра рынка номер " + i, 120));
  p.constraints.forbidden = Array.from({ length: 30 }, (_, i) => pad("запрещенное слово номер " + i, 80));
  p.offer.limits = Array.from({ length: 8 }, (_, i) => pad("граница работы номер " + i, 200));
  for (const seg of p.audience.segments) {
    seg.pain = seg.pain.map((x) => pad(x, 160));
    seg.choose = seg.choose.map((x) => pad(x, 120));
    seg.objection = seg.objection.map((o) => ({ says: pad(o.says, 200), answer: pad(o.answer, 240) }));
  }
  const dir = putProject("bigdoc", p);
  const r = run([BUILD_DOC, dir]);
  if (r.code === 2) return `exit 2 на одном объеме: ${r.all}`;
  if (!existsSync(doc(dir, DOC1))) return "документ не записан";
  const size = chars(text(doc(dir, DOC1)).replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " "));
  if (size < 9000) return `фикстура вышла на ${size} знаков - тест не проверил порог`;
  return /порог 9000/.test(r.all) ? true : `порог не назван в отчете: ${r.all.slice(0, 200)}`;
});

step("тонкая честная фактура проходит: минимумов на количество в схеме нет", () => {
  const p = baseProject();
  p.facts = p.facts.slice(0, 9);
  p.business.directions = [p.business.directions[0]];
  p.business.site_kind = "landing";
  p.gaps = [{ id: "g1", ask: "Сколько стоит выезд замерщика", hits: ["price", "geo"] }];
  const dir = putProject("thin-honest", p);
  const v = run([VERIFY, dir, "--seed", "--no-write"]);
  if (v.code === 2) return `валидатор требует добить фактуру до числа: ${v.all.split("\n").filter((l) => /^\s+!/.test(l)).join(" | ")}`;
  const b = run([BUILD_DOC, dir]);
  if (b.code === 2) return `документы не собрались на тонкой фактуре: ${b.all}`;
  return existsSync(doc(dir, DOC1)) && existsSync(doc(dir, DOC2)) ? true : "документы не записаны";
});

step("источник «ответ» законен: фраза заказчика не подписывается брифом", () => {
  const p = baseProject();
  p.facts[0].src = "ответ";
  const dir = putProject("src-otvet", p);
  const r = run([VERIFY, dir, "--seed", "--no-write"]);
  return r.code === 2 ? `exit 2: ${r.all.split("\n").filter((l) => /^\s+!/.test(l)).join(" | ")}` : true;
});

// ──────────────────────────────────────────────────────────────────────────
console.log("");
console.log("=== Сквозной прогон: очередь, сборка, гейт ===");
// ──────────────────────────────────────────────────────────────────────────

const qRoot = join(SANDBOX, "qroot");
const qDir = join(qRoot, "sites", "001-test-fx");

step("queue.mjs init и state: следующий шаг выводится из содержимого", () => {
  const r = run([QUEUE, "init", "test-fx", "--tier", "seo", "--type", "services", "--kind", "multipage", "--root", qRoot]);
  if (r.code !== 0) return `init exit ${r.code}: ${r.all}`;
  if (!existsSync(join(qDir, "queue.json"))) return "queue.json не создан";
  const s = run([QUEUE, "state", qDir]);
  if (s.code !== 0) return `state exit ${s.code}`;
  if (!/ШАГ 1/.test(s.all)) return `шаг определен неверно: ${s.stdout.trim().split("\n").pop()}`;
  const again = run([QUEUE, "init", "test-fx", "--root", qRoot]);
  return again.code === 0 ? true : `повторный init упал: ${again.all}`;
});

step("queue.mjs log: запись журнала без основания не принимается", () => {
  const bad = run([QUEUE, "log", "waiver", "цены не публикуем", qDir]);
  if (bad.code === 0) return "отступление записано без основания";
  const good = run([QUEUE, "log", "waiver", "цены не публикуем", "--ground", "запрет заказчика на созвоне", qDir]);
  if (good.code !== 0) return `запись с основанием упала: ${good.all}`;
  const j = run([QUEUE, "journal", qDir]);
  return /цены не публикуем/.test(j.all) ? true : "запись не видна в журнале";
});

step("queue.mjs gate: без контракта согласовывать нечего", () => {
  const r = run([QUEUE, "gate", qDir, "--by", "владелец"]);
  return r.code === 2 && /project\.json/.test(r.all) ? true : `exit ${r.code}: ${r.all}`;
});

// Разделение по файлам ровно то, что описано в промтах: business, facts, constraints и
// вопросы кладет site-intake, смыслы и разведку - site-market.
function seedParts(dir, tweak) {
  const src = baseProject();
  if (tweak) tweak(src);
  mkdirSync(join(dir, "parts"), { recursive: true });
  const facts = {
    source: src.source, tier: src.tier, business: clone(src.business),
    facts: src.facts.map((f) => ({ ...f, publish: "no" })),
    constraints: src.constraints,
    gaps: src.gaps.map((g) => ({ id: g.id, ask: g.ask, hits: g.hits }))
  };
  // Профиль ниши пишет site-market, а не site-intake: в parts/facts.json его нет.
  const profile = facts.business.profile;
  delete facts.business.profile;
  const market = {
    audience: src.audience, offer: src.offer, competitors: src.competitors, profile,
    lexicon: { locked: ["монтаж под ключ"] }, scan: { pages_seen: 12, pages_total: 15 }
  };
  if (!profile) delete market.profile;
  writeFileSync(join(dir, "parts", "facts.json"), JSON.stringify(facts, null, 2), "utf8");
  writeFileSync(join(dir, "parts", "market.json"), JSON.stringify(market, null, 2), "utf8");
  putQuotes(dir, facts.facts);
  return { facts, market };
}

const bpDir = join(SANDBOX, "bp");
step("build-project.mjs: смыслы из parts/market.json доезжают до контракта", () => {
  seedParts(bpDir);
  const r = run([BUILD_PROJECT, bpDir]);
  if (r.code === 2) return `сборка упала: ${r.all}`;
  const outs = [join(bpDir, "project.json"), join(bpDir, "analysis", "project.json")].filter(existsSync);
  if (!outs.length) return "контракт не записан вовсе";
  const p = readJson(outs[0]);
  const segs = (p.audience && p.audience.segments) || [];
  if (segs.length < 2) return `сегментов ${segs.length}: audience и offer из parts/market.json в контракт не попали, а сборка вышла с exit ${r.code}`;
  if (!(p.offer && p.offer.positioning)) return "offer.positioning потерян при склейке";
  if (!(p.lexicon && (p.lexicon.locked || []).length)) return "lexicon из parts/market.json в контракт не попал";
  if (!(p.gaps || []).length) return "вопросы gaps из parts/facts.json в контракт не попали";
  return true;
});

step("собранный контракт проходит свой же валидатор", () => {
  const outs = [join(bpDir, "project.json"), join(bpDir, "analysis", "project.json")].filter(existsSync);
  if (!outs.length) return "нечего проверять: контракт не собран";
  const r = run([VERIFY, outs[0], "--seed", "--no-write"]);
  return r.code === 2 ? `валидатор отверг собственную сборку: ${r.all.split("\n").filter((l) => /^\s+!/.test(l)).join(" | ")}` : true;
});

step("контракт складывается там, где его ищут очередь и гейт", () => {
  if (existsSync(join(bpDir, "project.json"))) return true;
  if (existsSync(join(bpDir, "analysis", "project.json"))) {
    return "сборка пишет analysis/project.json, а queue.mjs, apply-answers.mjs и SKILL.md ждут project.json в корне задачи";
  }
  return "контракт не найден ни в корне, ни в analysis";
});

step("имена документов: build-doc кладет ровно то, что ждет queue.mjs", () => {
  // Имена вычитываются из самого queue.mjs, а не переписываются тут: разойтись им негде.
  const q = text(QUEUE);
  const want = [...new Set([...q.matchAll(/has\("docs",\s*"([^"]+)"\)/g)].map((m) => m[1]))];
  if (want.length !== 2) return `queue.mjs ждет не два документа, а ${want.length}: ${want.join(", ")}`;
  const missing = want.filter((f) => !existsSync(join(docDir, "docs", f)));
  if (missing.length) return `build-doc не положил ${missing.join(", ")}; в каталоге docs: ${existsSync(join(docDir, "docs")) ? readdirSync(join(docDir, "docs")).join(", ") : "каталога нет"}`;
  return true;
});

step("apply-answers.mjs: без листа ответов печатает готовый лист и не трогает контракт", () => {
  const dir = putProject("answers", baseProject());
  const before = text(join(dir, "project.json"));
  const r = run([APPLY, dir]);
  if (r.code !== 0) return `exit ${r.code}: ${r.all}`;
  if (!/d1:|d2:/.test(r.all)) return "лист решений не напечатан";
  return text(join(dir, "project.json")) === before ? true : "контракт изменен без явной записи";
});

step("apply-answers.mjs: дифф-лист печатается до записи, запись меняет ровно одно поле", () => {
  const dir = putProject("answers-apply", baseProject());
  writeFileSync(join(dir, "answers.txt"), "d2: ремонт сдан за 45 дней без доплат << нам важно уложиться в срок\n", "utf8");
  const dry = run([APPLY, dir]);
  if (dry.code !== 0) return `просмотр exit ${dry.code}: ${dry.all}`;
  if (!/ДИФФ-ЛИСТ/.test(dry.all)) return "дифф-листа нет";
  if (!/нам важно уложиться в срок/.test(dry.all)) return "в дифф-листе нет дословной фразы заказчика";
  if (readJson(join(dir, "project.json")).offer.promise.result !== "квартира сдана в срок и без доплат") return "просмотр изменил файл";
  const w = run([APPLY, dir, "--apply"]);
  if (w.code !== 0) return `запись exit ${w.code}: ${w.all}`;
  const after = readJson(join(dir, "project.json"));
  if (after.offer.promise.result !== "ремонт сдан за 45 дней без доплат") return `поле не обновлено: ${after.offer.promise.result}`;
  if (after.offer.positioning !== "бригада со своим прорабом на объекте") return "задето соседнее поле";
  return true;
});

step("три ответа оператора из queue.json старше догадки агента", () => {
  const opRoot = join(SANDBOX, "op");
  const dir = join(opRoot, "sites", "001-op-fx");
  const init = run([QUEUE, "init", "op-fx", "--tier", "seo", "--type", "shop", "--kind", "multipage", "--root", opRoot]);
  if (init.code !== 0) return `init exit ${init.code}: ${init.all}`;
  seedParts(dir, (src) => { src.tier = "basic"; src.business.type = "services"; });
  const r = run([BUILD_PROJECT, dir]);
  if (r.code === 2) return `сборка: ${r.all}`;
  const p = readJson(join(dir, "project.json"));
  if (p.tier !== "seo") return `tier «${p.tier}»: купленное SEO потерялось между queue.json и контрактом`;
  if (p.business.type !== "shop") return `type «${p.business.type}»: ответ оператора перебит догадкой агента, каталожный режим не включится`;
  return /оператор ответил/.test(r.all) ? true : "расхождение прошло молча";
});

step("сборщик не пишет контракт, который отвергнет схема", () => {
  const dir = join(SANDBOX, "badschema");
  seedParts(dir, (src) => { src.audience.segments[0].pain = ["ремонт затягивается на полгода"]; });
  const r = run([BUILD_PROJECT, dir]);
  if (r.code !== 2) return `exit ${r.code}: на диск лег бы файл, который валидатор отвергнет`;
  if (existsSync(join(dir, "project.json"))) return "файл записан несмотря на нарушение схемы";
  return /минимум 2/.test(r.all) ? true : `схема не названа виновником: ${r.all.slice(0, 200)}`;
});

step("directions[].serves проставляет сборщик обратной сверкой с segments[].dirs", () => {
  const dir = join(SANDBOX, "serves");
  seedParts(dir, (src) => {
    src.audience.segments[0].dirs = ["remont-kvartir"];
    src.audience.segments[1].dirs = ["otdelka"];
  });
  const r = run([BUILD_PROJECT, dir]);
  if (r.code === 2) return `сборка: ${r.all}`;
  const dirs = readJson(join(dir, "project.json")).business.directions;
  const first = dirs.find((d) => d.id === "remont-kvartir") || {};
  if (!(first.serves || []).includes("s1")) return "serves пуст: у поля не было бы владельца вовсе";
  const b = run([BUILD_DOC, dir]);
  if (b.code === 2) return `документы: ${b.all}`;
  return /Кому это нужно/.test(text(doc(dir, DOC1))) ? true : "строка про сегменты не дошла до документа 1";
});

step("у лендинга свой состав блоков: факт про цену ждет price, а не hero", () => {
  const dir = join(SANDBOX, "landing");
  seedParts(dir, (src) => {
    src.business.site_kind = "landing";
    for (const f of src.facts) delete f.q;
  });
  const r = run([BUILD_PROJECT, dir]);
  if (r.code === 2) return `сборка: ${r.all}`;
  const p = readJson(join(dir, "project.json"));
  const price = p.facts.find((f) => /Цена монтажа/.test(f.label)) || {};
  if (!(price.q || []).includes("price")) return `факт про цену ждут блоки ${(price.q || []).join(", ") || "никто"} - у лендинга нет своего состава`;
  const gap = (p.gaps || []).find((g) => /квадратный метр/.test(g.ask)) || {};
  return gap.weight > 0 ? true : "вопрос про цену на лендинге получил вес 0";
});

const e2eRoot = join(SANDBOX, "e2e");
const e2eDir = join(e2eRoot, "sites", "001-e2e-fx");

step("сквозной прогон: от init до отметки гейта документированными командами", () => {
  const init = run([QUEUE, "init", "e2e-fx", "--tier", "seo", "--type", "services", "--kind", "multipage", "--root", e2eRoot]);
  if (init.code !== 0) return `init exit ${init.code}: ${init.all}`;
  seedParts(e2eDir);
  const bp = run([BUILD_PROJECT, e2eDir]);
  if (bp.code === 2) return `сборка контракта: ${bp.all}`;
  const vd = run([VERIFY, e2eDir, "--seed"]);
  if (vd.code === 2) return `валидатор: ${vd.all}`;
  const bd = run([BUILD_DOC, e2eDir]);
  if (bd.code === 2) return `документы: ${bd.all}`;
  const links = run([QUEUE, "docs", e2eDir, "--understood", "https://drive.test/1", "--ask", "https://drive.test/2"]);
  if (links.code !== 0) return `ссылки: ${links.all}`;
  const st = run([QUEUE, "state", e2eDir]);
  if (!/ШАГ 5/.test(st.all)) return `очередь не дошла до гейта: ${st.stdout.trim().split("\n").slice(-2).join(" / ")}`;
  // Гейт K10 проверяет, что лист ответов применен: молчание заказчика - пустой answers.txt.
  const early = run([QUEUE, "gate", e2eDir, "--by", "владелец"]);
  if (early.code !== 2 || !/листа ответов нет/.test(early.all)) return `гейт без примененного листа: exit ${early.code}`;
  writeFileSync(join(e2eDir, "answers.txt"), "", "utf8");
  const ap = run([APPLY, e2eDir, "--apply"]);
  if (ap.code !== 0) return `ответы: ${ap.all}`;
  const vd2 = run([VERIFY, e2eDir]);
  if (vd2.code === 2) return `валидатор после ответов: ${bad2(vd2)}`;
  const gate = run([QUEUE, "gate", e2eDir, "--by", "владелец"]);
  if (gate.code !== 0) return `гейт: ${gate.all}`;
  const ck = readJson(join(e2eDir, "queue.json")).gate.checks || {};
  if (ck.step !== "5" || ck.verify === 2 || !(ck.sheets || []).some((s) => s.file === "answers.txt" && s.sha)) return `gate.checks: ${JSON.stringify(ck)}`;
  const done = run([QUEUE, "state", e2eDir]);
  return /контракт согласован/.test(done.all) ? true : `после гейта очередь не закрылась: ${done.stdout.trim().split("\n").slice(-2).join(" / ")}`;
});

// Пересборка после гейта раньше оставляла гейт пройденным и молча стирала ответы. Теперь
// (п.4 программы 28.09) --force сбрасывает гейт и отметки листов и печатает команду повтора:
// очередь возвращается на шаг 5, повтор листа и гейт закрывают ее снова.
step("после гейта пересборка контракта отказывает без --force; с --force сбрасывает гейт и велит повторить лист", () => {
  const again = run([BUILD_PROJECT, e2eDir]);
  if (again.code !== 2) return `exit ${again.code}: пересборка стерла бы согласованные решения молча`;
  if (!/гейт пройден/.test(again.all)) return "отказ без объяснения причины";
  const forced = run([BUILD_PROJECT, e2eDir, "--force"]);
  if (forced.code === 2) return `--force не помог: ${forced.all}`;
  if (!/ответы заказчика стерты пересборкой, гейт сброшен/.test(forced.all) || !/apply-answers\.mjs/.test(forced.all)) return "сброс гейта прошел молча";
  const q = readJson(join(e2eDir, "queue.json"));
  if (q.gate.approved !== false || (q.answers || []).length) return `гейт или отметки листов не сброшены: ${JSON.stringify({ gate: q.gate, answers: q.answers })}`;
  if (!/ШАГ 5/.test(run([QUEUE, "state", e2eDir]).all)) return "после пересборки очередь не на шаге 5";
  const ap = run([APPLY, e2eDir, "--apply"]);
  if (ap.code !== 0) return `повтор листа: ${ap.all}`;
  const gate = run([QUEUE, "gate", e2eDir, "--by", "владелец"]);
  return gate.code === 0 ? true : `повторный гейт: ${gate.all}`;
});

step("решения документа 1 и ключи листа ответов - один список (вместе с d9 состава)", () => {
  const p = baseProject();
  p.tier = "basic";
  const dir = putStructure(putProject("decisions", p), plannerStructure());
  const b = run([BUILD_DOC, dir]);
  if (b.code === 2) return `документы: ${b.all}`;
  const html = text(doc(dir, DOC1));
  const printed = [...new Set([...html.matchAll(/<td>(d[0-9]+)<\/td>/g)].map((m) => m[1]))];
  if (printed.length < 4) return `в таблице решений кодов ${printed.length} - решение печатается без ключа возврата`;
  if (!printed.includes("d9")) return "состав сайта не напечатан решением d9";
  const sheet = run([APPLY, dir]);
  if (sheet.code !== 0) return `лист ответов: ${sheet.all}`;
  const orphan = printed.filter((k) => !new RegExp("^" + k + ":", "m").test(sheet.all));
  return orphan.length ? `в документе есть решения, принять которые нечем: ${orphan.join(", ")}` : true;
});

step("выбор заказчика по типу сайта принимается листом ответов", () => {
  const dir = putProject("d7", baseProject());
  writeFileSync(join(dir, "answers.txt"), "d7: лендинг << нам хватит одной страницы\n", "utf8");
  const w = run([APPLY, dir, "--apply"]);
  if (w.code !== 0) return `запись exit ${w.code}: ${w.all}`;
  const p = readJson(join(dir, "project.json"));
  if (p.business.site_kind !== "landing") return `site_kind «${p.business.site_kind}»: ответ по типу сайта некуда записать`;
  return /нам хватит одной страницы/.test(w.all) ? true : "в дифф-листе нет дословной фразы заказчика";
});

// Решение Р2 (программа 28.09): без << (заказчик сам заполнил лист) цитата - строка листа, как
// было; с << фраза ищется во входе input/ и становится цитатой. Раньше цитатой всегда
// становилась строка листа, и сверка чисел сравнивала значение само с собой.
step("факт из ответа заказчика подписан ответом, а не брифом; цитата - строка листа без << и фраза из входа с <<", () => {
  const dir = putProject("answer-src", baseProject());
  writeFileSync(join(dir, "input", "call.txt"), "Заказчик: весной подняли цену, теперь от 5200 руб за метр\n", "utf8");
  writeFileSync(join(dir, "answers.txt"), "f05: от 5200 руб за кв м\nf08: 12 дней на объект << Весной подняли цену, теперь от 5200\n", "utf8");
  const w = run([APPLY, dir, "--apply"]);
  if (w.code !== 0) return `запись exit ${w.code}: ${w.all}`;
  const f = readJson(join(dir, "project.json")).facts.find((x) => x.id === "f05");
  if (!f) return "факт пропал";
  if (f.src !== "ответ") return `src «${f.src}»: заказчику покажут брифом то, что он сказал вчера`;
  if (f.artifact) return "дословная фраза уехала в artifact и сделала факт проверяемым - сказанное вслух доказательством не является";
  const src = readJson(join(dir, "parts", "facts-src.json"));
  const q = src.filter((x) => x.id === "f05");
  if (q.length !== 1) return `записей цитаты f05 ${q.length} - старая цитата брифа не заменена ответом`;
  if (q[0].where !== "answers.txt:1" || !/5200/.test(q[0].quote)) return `цитата ответа записана не так: ${JSON.stringify(q[0])}`;
  const q8 = src.find((x) => x.id === "f08") || {};
  if (q8.where !== "input/call.txt:1" || !/весной подняли цену/i.test(q8.quote)) return `цитата с << не из входа: ${JSON.stringify(q8)}`;
  const v = run([VERIFY, dir, "--no-write"]);
  if (v.code === 2) return `валидатор не принял источник ответа: ${bad2(v)}`;
  // число значения (12), которого нет во фразе заказчика, - предупреждение сверки чисел
  if (!/f08[^\n]*числа 12/.test(v.all)) return "число не из фразы заказчика прошло без предупреждения";
  const b = run([BUILD_DOC, dir]);
  if (b.code === 2) return `документы: ${b.all}`;
  return /ваш ответ/.test(text(doc(dir, DOC1))) ? true : "источник ответа не переведен на язык заказчика";
});

// ──────────────────────────────────────────────────────────────────────────
console.log("");
console.log("=== Словарь блоков, агенты и связи анализа (гейт 0) ===");
// ──────────────────────────────────────────────────────────────────────────

const ANALYSIS_FILES = [
  ".claude/skills/site-analiz/SKILL.md", ".claude/agents/site-intake.md", ".claude/agents/site-market.md",
  ".claude/agents/pages-planner.md", ".claude/scripts/site/_contract.mjs", ".claude/scripts/site/queue.mjs",
  ".claude/scripts/site/build-project.mjs", ".claude/scripts/site/verify-data.mjs", ".claude/scripts/site/build-doc.mjs",
  ".claude/scripts/site/apply-answers.mjs"
];

step("pages.yml живет в site-analiz: ни скрипт, ни агент анализа не читает site-proto", () => {
  if (!existsSync(PAGES)) return "нет .claude/skills/site-analiz/pages.yml";
  const bad = ANALYSIS_FILES.filter((rel) => /site-proto/.test(text(join(ROOT, rel))));
  return bad.length ? `ссылаются на site-proto: ${bad.join(", ")} - удаление прототипа уронит анализ` : true;
});

step("связи дальше: seo -> /seo-struktura, basic -> /site-tekst; /site proto следующим шагом не назван", () => {
  const skill = text(join(SKILL_DIR, "SKILL.md"));
  const miss = ["/seo-struktura", "/site-tekst --site", "pages-planner", "3b", "d9", "facts-src"].filter((w) => !skill.includes(w));
  if (miss.length) return `в SKILL.md нет: ${miss.join(", ")}`;
  const stale = ANALYSIS_FILES.filter((rel) => /\/site proto/.test(text(join(ROOT, rel))));
  return stale.length ? `/site proto еще назван в ${stale.join(", ")}` : true;
});

{
  // Список читается из самого модуля: разойтись ему со счетом негде.
  const src = text(join(SITE_SCRIPTS, "_contract.mjs"));
  const m = src.match(/export const AGENTS_V8 = \[([^\]]*)\]/);
  const cap = (src.match(/export const AGENTS_V8_CAP = (\d+)/) || [])[1];
  step("AGENTS_V8: три агента анализа, у каждого файл, opus и строка MODEL-POLICY", () => {
    if (!m) return "в _contract.mjs нет AGENTS_V8";
    const list = [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
    const want = ["site-intake", "site-market", "pages-planner"];
    if (want.some((w) => !list.includes(w)) || list.length !== want.length) return `список ${list.join(", ")}, ждали ${want.join(", ")}`;
    if (Number(cap) !== list.length) return `потолок ${cap} при ${list.length} агентах - список закрыт`;
    const policy = CLIENT_CLONE ? "" : text(join(ROOT, "docs/MODEL-POLICY.md"));
    if (CLIENT_CLONE) skipDocs("строки агентов анализа в docs/MODEL-POLICY.md");
    const bad = [];
    for (const a of list) {
      const p = join(ROOT, ".claude/agents", a + ".md");
      if (!existsSync(p)) { bad.push(`${a}: нет файла`); continue; }
      const fm = (text(p).match(/^---\n([\s\S]*?)\n---/) || [])[1] || "";
      if (!new RegExp(`^name: ${a}$`, "m").test(fm)) bad.push(`${a}: name во frontmatter`);
      if (!/^model: opus$/m.test(fm)) bad.push(`${a}: модель не opus`);
      if (!CLIENT_CLONE && !new RegExp(`^\\| ${a} \\| opus \\|`, "m").test(policy)) bad.push(`${a}: нет строки opus в MODEL-POLICY`);
    }
    return bad.length ? bad.join("; ") : true;
  });
}

step("pages-planner: вход project.json, выход structure_data.json, Read и Write, без MCP", () => {
  const t = text(PLANNER);
  const fm = (t.match(/^---\n([\s\S]*?)\n---/) || [])[1] || "";
  if (!/^tools: Read, Write$/m.test(fm)) return "инструменты не ровно Read и Write";
  if (/mcp__|WebFetch|WebSearch/.test(t)) return "в промте планировщика есть сетевые инструменты";
  const need = ["project.json", "structure_data.json", "pages_hint", "page_types", "Главная", "Услуга", "Категория", "Товар", "Инфо", "Прочее",
    "навигация", "dir:", "{slug}", "шаблон", "О компании", "Контакты", "Команда", "Отзывы", "Кейсы", "Вопросы", "queries", "target_status", "client_notes", "40"];
  const miss = need.filter((w) => !t.includes(w));
  if (miss.length) return `промт не называет: ${miss.join(", ")}`;
  if (/pages_draft|brief\.json|intake\.json|analyses\//.test(t)) return "промт еще читает вход v7 (brief.json, intake.json, pages_draft)";
  return true;
});

step("site-market: глубина лендинга для всех, полного замера многостраничника нет; профиль и page_types на месте", () => {
  const t = text(join(ROOT, ".claude/agents/site-market.md"));
  if (/5-8 лидеров|multipage` - по типам|по типам страниц\. Открываешь/.test(t)) return "ветка полного замера многостраничника осталась";
  const miss = ["3-5", "page_types", "profile", "warmth", "cycle", "objection", "facts"].filter((w) => !t.includes(w));
  return miss.length ? `промт не называет: ${miss.join(", ")}` : true;
});

step("site-intake: kind, pages_hint и цитаты, которые живут весь срок задачи", () => {
  const t = text(join(ROOT, ".claude/agents/site-intake.md"));
  const miss = ["`kind`", "pages_hint", "facts-src.json"].filter((w) => !t.includes(w));
  if (miss.length) return `промт не называет: ${miss.join(", ")}`;
  return /умирает после гейта/.test(t) ? "промт по-прежнему говорит, что цитаты умирают после гейта" : true;
});

step("схема: kind фактов, профиль ниши, pages_hint, page_types и ссылки ответов на факты", () => {
  const s = readJson(join(SKILL_DIR, "project.schema.json"));
  const b = s.properties.business.properties;
  const bad = [];
  const kind = s.definitions.fact.properties.kind;
  if (!kind || ["number", "claim", "process", "contact", "legal", "product", "geo"].join() !== (kind.enum || []).join()) bad.push("facts[].kind");
  if (!(s.definitions.fact.required || []).includes("kind")) bad.push("kind не обязателен");
  const pr = b.profile && b.profile.properties;
  if (!pr || pr.audience.enum.join() !== "b2c,b2b,mixed" || pr.warmth.enum.join() !== "hot,warm,cold" ||
      pr.price.enum.join() !== "low,mid,high,premium" || pr.cycle.enum.join() !== "impulse,days,weeks,months") bad.push("business.profile");
  if (!b.pages_hint || b.pages_hint.maxItems !== 40) bad.push("business.pages_hint до 40");
  if (!s.properties.competitors.properties.market.properties.page_types) bad.push("competitors.market.page_types");
  const of = s.definitions.objection.properties.facts;
  if (!of || of.items.pattern !== "^f[0-9]{2,3}$") bad.push("objection[].facts");
  return bad.length ? `нет или не так: ${bad.join(", ")}` : true;
});

// ──────────────────────────────────────────────────────────────────────────
console.log("");
console.log("=== Сборка: Д1, профиль, kind, сегменты направлений ===");
// ──────────────────────────────────────────────────────────────────────────

step("Д1: build-project сохраняет business.site, client_pages и assortment (и null у site)", () => {
  const dir = join(SANDBOX, "d1");
  seedParts(dir, (src) => {
    src.business.site = "https://nevskiy-remont.test";
    src.business.client_pages = [{ url: "https://nevskiy-remont.test/remont", name: "Ремонт" }];
    src.business.assortment = ["ремонт квартир", "ремонт ванной", "отделка"];
    src.business.pages_hint = ["Главная", "Ремонт квартир", "Контакты"];
  });
  const r = run([BUILD_PROJECT, dir]);
  if (r.code === 2) return `сборка: ${bad2(r)}`;
  const b = readJson(join(dir, "project.json")).business;
  if (b.site !== "https://nevskiy-remont.test") return `site «${b.site}» потерян`;
  if (!(b.client_pages || []).length) return "client_pages потерян";
  if ((b.assortment || []).length !== 3) return "assortment потерян";
  if ((b.pages_hint || []).length !== 3) return "pages_hint потерян";
  const dir2 = join(SANDBOX, "d1-null");
  seedParts(dir2, (src) => { src.business.site = null; });
  const r2 = run([BUILD_PROJECT, dir2]);
  if (r2.code === 2) return `сборка с site null: ${bad2(r2)}`;
  return readJson(join(dir2, "project.json")).business.site === null ? true : "site null («сайта нет») потерян";
});

step("профиль ниши едет из parts/market.json в business.profile; чужое значение - отказ", () => {
  const dir = join(SANDBOX, "profile");
  seedParts(dir);
  const r = run([BUILD_PROJECT, dir]);
  if (r.code === 2) return `сборка: ${bad2(r)}`;
  const pr = readJson(join(dir, "project.json")).business.profile || {};
  if (pr.price !== "high" || pr.cycle !== "weeks") return `профиль ${JSON.stringify(pr)}`;
  const dir2 = join(SANDBOX, "profile-bad");
  seedParts(dir2, (src) => { src.business.profile = { audience: "b2c", warmth: "warm", price: "дорого", cycle: "weeks" }; });
  const r2 = run([BUILD_PROJECT, dir2]);
  return r2.code === 2 && /profile\.price/.test(r2.all) ? true : `exit ${r2.code}: чек словами прошел схему`;
});

step("kind: без него сборка выводит мостом q -> kind и говорит об этом; чужое значение - отказ", () => {
  const dir = join(SANDBOX, "kind");
  seedParts(dir, (src) => { for (const f of src.facts) delete f.kind; });
  const r = run([BUILD_PROJECT, dir]);
  if (r.code === 2) return `сборка: ${bad2(r)}`;
  const fs = readJson(join(dir, "project.json")).facts;
  if (fs.some((f) => !f.kind)) return "у фактов нет kind после сборки";
  if (fs.find((f) => f.id === "f07").kind !== "legal") return `лицензия получила kind ${fs.find((f) => f.id === "f07").kind}`;
  if (!/kind не проставлен агентом/.test(r.all)) return "вывод kind прошел молча";
  const dir2 = join(SANDBOX, "kind-bad");
  seedParts(dir2, (src) => { src.facts[0].kind = "цифра"; });
  const r2 = run([BUILD_PROJECT, dir2]);
  return r2.code === 2 && /kind/.test(r2.all) ? true : `exit ${r2.code}: чужой kind прошел`;
});

step("направления без сегментов: сборка называет их (villa-pattaya и villa-bali у IBG)", () => {
  const dir = join(SANDBOX, "lonely");
  seedParts(dir, (src) => {
    src.audience.segments[0].dirs = ["remont-kvartir"];
    src.audience.segments[1].dirs = ["remont-kvartir"];
  });
  const r = run([BUILD_PROJECT, dir]);
  if (r.code === 2) return `сборка: ${bad2(r)}`;
  return /направления без сегментов[^\n]*remont-vannoy[^\n]*otdelka/.test(r.all) ? true : "направления без покупателя прошли молча";
});

step("page_types и ссылки ответов на факты доезжают; ссылка на несуществующий факт снимается с предупреждением", () => {
  const dir = join(SANDBOX, "objfacts");
  seedParts(dir, (src) => {
    src.audience.segments[0].objection[0].facts = ["f15", "f77"];
  });
  const r = run([BUILD_PROJECT, dir]);
  if (r.code === 2) return `сборка: ${bad2(r)}`;
  const p = readJson(join(dir, "project.json"));
  if (!(p.competitors.market.page_types || []).length) return "page_types потерян";
  const of = p.audience.segments[0].objection[0].facts || [];
  if (of.join() !== "f15") return `ссылки ответа ${JSON.stringify(of)}`;
  return /f77/.test(r.all) ? true : "снятая ссылка не названа";
});

// ──────────────────────────────────────────────────────────────────────────
console.log("");
console.log("=== Цитаты фактов: parts/facts-src.json против входа ===");
// ──────────────────────────────────────────────────────────────────────────

step("нет parts/facts-src.json - отказ: у фактов нет оснований", () => {
  const dir = putProject("q-nofile", baseProject());
  rmSync(join(dir, "parts", "facts-src.json"));
  const r = run([VERIFY, dir, "--seed", "--no-write"]);
  return r.code === 2 && /facts-src/.test(r.all) ? true : `exit ${r.code}`;
});

step("факт без цитаты - отказ с id факта", () => {
  const dir = putProject("q-noid", baseProject());
  const src = readJson(join(dir, "parts", "facts-src.json")).filter((x) => x.id !== "f03");
  writeFileSync(join(dir, "parts", "facts-src.json"), JSON.stringify(src), "utf8");
  const r = run([VERIFY, dir, "--seed", "--no-write"]);
  return r.code === 2 && /f03[^\n]*нет цитаты/.test(r.all) ? true : `exit ${r.code}: ${bad2(r)}`;
});

step("цитата, которой нет во входе, - отказ: выдумка ловится там, где факт рождается", () => {
  const dir = putProject("q-fake", baseProject());
  const src = readJson(join(dir, "parts", "facts-src.json"));
  src[4].quote = "монтаж от 3900 руб за квадратный метр";
  writeFileSync(join(dir, "parts", "facts-src.json"), JSON.stringify(src), "utf8");
  const r = run([VERIFY, dir, "--seed", "--no-write"]);
  return r.code === 2 && /f05[^\n]*не найдена дословно/.test(r.all) ? true : `exit ${r.code}: ${bad2(r)}`;
});

step("нормализация: буква е, тире, кавычки и пробелы цитату не ломают; лист ответов - тоже вход", () => {
  const dir = putProject("q-norm", baseProject());
  const src = readJson(join(dir, "parts", "facts-src.json"));
  // во входе: е, дефис, прямые кавычки; в цитате: е с точками, длинное тире, елочки, двойной пробел
  writeFileSync(join(dir, "input", "call.txt"), "Прораб: \"все\" сделаем за 14 дней - по договору\n", "utf8");
  src[7].quote = "\u00ab\u0432\u0441\u0451\u00bb \u0441\u0434\u0435\u043b\u0430\u0435\u043c  \u0437\u0430 14 \u0434\u043d\u0435\u0439 \u2014 \u043f\u043e \u0434\u043e\u0433\u043e\u0432\u043e\u0440\u0443";
  src[8].quote = "выезжаем за 60 км без доплаты";
  writeFileSync(join(dir, "answers.txt"), "f09: 60 км от города << выезжаем за 60 км без доплаты\n", "utf8");
  writeFileSync(join(dir, "parts", "facts-src.json"), JSON.stringify(src), "utf8");
  const r = run([VERIFY, dir, "--seed", "--no-write"]);
  return r.code === 2 ? `нормализация не сработала: ${bad2(r)}` : true;
});

step("цитата из скана или pdf - предупреждение «сверь глазами», а не отказ", () => {
  const dir = putProject("q-scan", baseProject());
  writeFileSync(join(dir, "input", "licenziya.pdf"), Buffer.from([37, 80, 68, 70, 0, 1, 2, 0]));
  const src = readJson(join(dir, "parts", "facts-src.json"));
  src[6].quote = "лицензия номер 1234 выдана в 2019 году";
  src[6].where = "input/licenziya.pdf";
  writeFileSync(join(dir, "parts", "facts-src.json"), JSON.stringify(src), "utf8");
  const r = run([VERIFY, dir, "--seed", "--no-write"]);
  if (r.code === 2) return `отказ: ${bad2(r)}`;
  return /сверь глазами/.test(r.all) ? true : "нетекстовый источник прошел молча";
});

step("служебная пометка в значении факта - отказ («не разворачиваем в этой версии» из IBG)", () => {
  const p = baseProject();
  p.facts[10].value = "не разворачиваем в этой версии сайта";
  const dir = putProject("q-note", p);
  const r = run([VERIFY, dir, "--no-write"]);
  return r.code === 2 && /служебная пометка/.test(r.all) && /facts\[10\]/.test(r.all) ? true : `exit ${r.code}: ${bad2(r)}`;
});

step("ответ на возражение ссылается на несуществующий факт - отказ", () => {
  const p = baseProject();
  p.audience.segments[1].objection[0].facts = ["f02", "f99"];
  const dir = putProject("q-objfacts", p);
  const r = run([VERIFY, dir, "--seed", "--no-write"]);
  return r.code === 2 && /f99/.test(r.all) && !/f02»/.test(r.all) ? true : `exit ${r.code}: ${bad2(r)}`;
});

step("apply-answers: новый факт из вопроса - с kind и цитатой; пометка вместо ответа фактом не становится", () => {
  const dir = putProject("q-gap", baseProject());
  // Без << (заказчик сам написал значение) цитата - строка листа; фраза после << искалась бы во входе (Р2).
  writeFileSync(join(dir, "answers.txt"), "g1: 4800 руб за кв м\ng2: не разворачиваем в этой версии\n", "utf8");
  const w = run([APPLY, dir, "--apply"]);
  if (w.code !== 0) return `запись exit ${w.code}: ${w.all}`;
  const p = readJson(join(dir, "project.json"));
  const f = p.facts.find((x) => x.value === "4800 руб за кв м");
  if (!f) return "факт из ответа на вопрос не создан";
  if (!f.kind) return "у нового факта нет kind - схема его отвергнет";
  if (p.facts.some((x) => /в этой версии/.test(x.value))) return "служебная пометка стала фактом";
  const q = readJson(join(dir, "parts", "facts-src.json")).find((x) => x.id === f.id);
  if (!q || q.where !== "answers.txt:1") return `цитата нового факта: ${JSON.stringify(q)}`;
  const v = run([VERIFY, dir, "--no-write"]);
  return v.code === 2 ? `валидатор отверг факты из ответов: ${bad2(v)}` : true;
});

// ──────────────────────────────────────────────────────────────────────────
console.log("");
console.log("=== Состав страниц без SEO: structure_data.json ===");
// ──────────────────────────────────────────────────────────────────────────

step("лендинг при basic: сборка пишет состав из одной главной, и он проходит проверку формата", () => {
  const dir = join(SANDBOX, "st-landing");
  seedParts(dir, (src) => { src.tier = "basic"; src.business.site_kind = "landing"; src.business.directions = [src.business.directions[0]]; });
  const r = run([BUILD_PROJECT, dir]);
  if (r.code === 2) return `сборка: ${bad2(r)}`;
  const sp = join(dir, "structure_data.json");
  if (!existsSync(sp)) return "structure_data.json не записан";
  const sd = readJson(sp);
  if (sd.pages.length !== 1 || sd.pages[0].url !== "/" || sd.pages[0].type !== "Главная") return `состав лендинга: ${JSON.stringify(sd.pages)}`;
  if (sd.pages[0].section !== "dir:remont-kvartir") return `section главной лендинга «${sd.pages[0].section}» - одно направление обязано быть названо`;
  const v = run([VERIFY, dir, "--seed", "--no-write"]);
  return v.code === 2 ? `проверка формата отвергла состав сборки: ${bad2(v)}` : true;
});

step("tier seo и многостраничник при basic: сборка состав не пишет", () => {
  const a = join(SANDBOX, "st-seo");
  seedParts(a);
  const ra = run([BUILD_PROJECT, a]);
  if (ra.code === 2) return `сборка seo: ${bad2(ra)}`;
  if (existsSync(join(a, "structure_data.json"))) return "при tier seo анализ написал состав - это работа /seo-struktura";
  const b = join(SANDBOX, "st-multi");
  seedParts(b, (src) => { src.tier = "basic"; });
  const rb = run([BUILD_PROJECT, b]);
  if (rb.code === 2) return `сборка basic: ${bad2(rb)}`;
  if (existsSync(join(b, "structure_data.json"))) return "многостраничный состав написала сборка вместо pages-planner";
  return /3b/.test(rb.all) ? true : "сборка не назвала следующий шаг 3b";
});

step("формат планировщика: образцовый состав проходит без нарушений", () => {
  const p = baseProject();
  p.tier = "basic";
  const dir = putStructure(putProject("st-ok", p), plannerStructure());
  const r = run([VERIFY, dir, "--seed", "--no-write"]);
  if (r.code === 2) return bad2(r);
  return /состав страниц: 9/.test(r.all) ? true : "состав не посчитан";
});

step("формат планировщика: каждое правило import-structure ловится и называется", () => {
  const p = baseProject();
  p.tier = "basic";
  const cases = [
    ["слеш на конце", (sd) => { sd.pages[2].url = "/uslugi/remont-kvartir/"; }, /слеш на конце/],
    ["тип вне словаря", (sd) => { sd.pages[5].type = "Статья"; }, /вне словаря/],
    ["хаб типом Услуга", (sd) => { sd.pages[1].type = "Услуга"; sd.pages[1].section = "dir:remont-kvartir"; }, /хаб с типом/],
    ["слово хаб в name", (sd) => { sd.pages[1].name = "Услуги (хаб)"; }, /слово «хаб»/],
    ["адрес кейсов без слова Кейсы", (sd) => { sd.pages[5].name = "Наши работы"; }, /нет этого слова/],
    ["адрес перебивает имя", (sd) => { sd.pages.push({ ...sd.pages[8], n: 10, url: "/o-kompanii/komanda", name: "Команда" }); }, /адрес перебивает имя/],
    ["карточка без шаблона", (sd) => { sd.pages.push({ ...sd.pages[2], n: 10, url: "/katalog/plitka", type: "Товар", name: "Плитка", section: "" }); }, /каждый товар станет/],
    ["шаблон у услуги", (sd) => { sd.pages[3].name = "Ремонт ванной (шаблон)"; }, /шаблон карточки/],
    ["услуга без dir", (sd) => { sd.pages[4].section = ""; }, /без section/],
    ["чужое направление", (sd) => { sd.pages[4].section = "dir:net-takogo"; }, /net-takogo/],
    ["запросы у состава без SEO", (sd) => { sd.pages[2].queries = ["ремонт квартир спб"]; }, /queries только/],
    ["name латиницей", (sd) => { sd.pages[6].name = "Otzyvy"; }, /по-русски/],
    ["нет главной", (sd) => { sd.pages.shift(); }, /главных 0/],
    ["двухбуквенный адрес", (sd) => { sd.pages[4].url = "/tv"; }, /языковую главную/],
    ["больше 40 страниц", (sd) => { for (let i = 0; i < 32; i++) sd.pages.push({ ...sd.pages[4], n: 10 + i, url: `/uslugi/otdelka-${i}` }); }, /потолок 40/]
  ];
  const miss = [];
  cases.forEach(([name, spoil, re], i) => {
    const sd = plannerStructure();
    spoil(sd);
    const dir = putStructure(putProject(`st-bad-${i}`, clone(p)), sd);
    const r = run([VERIFY, dir, "--seed", "--no-write"]);
    if (r.code !== 2 || !re.test(r.all)) miss.push(`${name} (exit ${r.code})`);
  });
  return miss.length ? `не пойманы: ${miss.join("; ")}` : true;
});

step("очередь: basic и многостраничник - шаг 3b до документов; после гейта - /site-tekst --site", () => {
  const root = join(SANDBOX, "q3b");
  const dir = join(root, "sites", "001-q3b-fx");
  const init = run([QUEUE, "init", "q3b-fx", "--tier", "basic", "--type", "services", "--kind", "multipage", "--root", root]);
  if (init.code !== 0) return `init: ${init.all}`;
  seedParts(dir, (src) => { src.tier = "basic"; });
  const bp = run([BUILD_PROJECT, dir]);
  if (bp.code === 2) return `сборка: ${bad2(bp)}`;
  const s1 = run([QUEUE, "state", dir]);
  if (!/ШАГ 3b/.test(s1.all) || !/pages-planner/.test(s1.all)) return `после сборки не шаг 3b: ${s1.stdout.trim().split("\n").pop()}`;
  putStructure(dir, plannerStructure());
  const vd = run([VERIFY, dir, "--seed"]);
  if (vd.code === 2) return `проверка состава: ${bad2(vd)}`;
  const s2 = run([QUEUE, "state", dir]);
  if (!/ШАГ 4/.test(s2.all)) return `с составом не шаг 4: ${s2.stdout.trim().split("\n").pop()}`;
  const bd = run([BUILD_DOC, dir]);
  if (bd.code === 2) return `документы: ${bd.all}`;
  const html = text(join(dir, "docs", "understood.html"));
  if (!/<td>d9<\/td>/.test(html) || !/\/uslugi\/remont-kvartir/.test(html)) return "состав не напечатан в документе 1 решением d9";
  run([QUEUE, "docs", dir, "--understood", "https://drive.test/1", "--ask", "https://drive.test/2"]);
  writeFileSync(join(dir, "answers.txt"), "", "utf8");
  const ap = run([APPLY, dir, "--apply"]);
  if (ap.code !== 0) return `ответы: ${ap.all}`;
  const g = run([QUEUE, "gate", dir, "--by", "владелец"]);
  if (g.code !== 0) return `гейт: ${g.all}`;
  const done = run([QUEUE, "state", dir]);
  return /\/site-tekst --site 001/.test(done.all) ? true : `после гейта не названы тексты: ${done.stdout.trim().split("\n").pop()}`;
});

step("очередь: после гейта при tier seo следующий шаг - /seo-struktura", () => {
  const done = run([QUEUE, "state", e2eDir]);
  return /\/seo-struktura 001/.test(done.all) ? true : `после гейта при seo: ${done.stdout.trim().split("\n").pop()}`;
});

step("d9: дифф-лист до записи, запись меняет только target_status; главную снять нельзя, новой страницы ответ не рождает", () => {
  const p = baseProject();
  p.tier = "basic";
  const dir = putStructure(putProject("d9", p), plannerStructure());
  writeFileSync(join(dir, "answers.txt"), "d9: убрать 8, /keisy; без отзывов; убрать /; добавить /blog << команды и блога у нас нет\n", "utf8");
  const dry = run([APPLY, dir]);
  if (dry.code !== 0) return `просмотр: ${dry.all}`;
  if (!/structure_data\.json \/keisy/.test(dry.all)) return "в дифф-листе нет строки по странице";
  if (readJson(join(dir, "structure_data.json")).pages.some((x) => x.target_status === "no")) return "просмотр изменил состав";
  const w = run([APPLY, dir, "--apply"]);
  if (w.code !== 0) return `запись: ${w.all}`;
  const sd = readJson(join(dir, "structure_data.json"));
  const off = sd.pages.filter((x) => x.target_status === "no").map((x) => x.url).sort();
  if (off.join() !== ["/keisy", "/o-kompanii", "/otzyvy"].sort().join()) return `сняты ${off.join(", ")}`;
  if (sd.pages.length !== 9) return "ответ добавил или удалил страницу";
  if (!/главная обязательна/.test(w.all) || !/новый проход pages-planner/.test(w.all)) return "отказы по главной и по новой странице не названы";
  const v = run([VERIFY, dir, "--no-write"]);
  if (v.code === 2) return `состав после ответа не проходит проверку: ${bad2(v)}`;
  const b = run([BUILD_DOC, dir]);
  if (b.code === 2) return `документы: ${b.all}`;
  return /Сняли из состава/.test(text(doc(dir, DOC1))) ? true : "снятые страницы не видны в документе 1";
});

// ──────────────────────────────────────────────────────────────────────────
console.log("");
console.log("=== Программа 27.09 (W3b): d3, d6, d10, лидеры, ответы, импорт состава ===");
// ──────────────────────────────────────────────────────────────────────────

const C = await import(pathToFileURL(join(SITE_SCRIPTS, "_contract.mjs")).href);
// Каталог с queue.json: без него apply-answers журнал не пишет.
function putQueue(dir) {
  writeFileSync(join(dir, "queue.json"), JSON.stringify({ slug: "w3b-fx", journal: [] }, null, 2) + "\n", "utf8");
  return dir;
}
const journalOf = (dir) => readJson(join(dir, "queue.json")).journal || [];
const D10_RE = /решени[а-я]*\s+d10(?![0-9])/;
const sigOf = (dir) => (readJson(join(dir, "project.json")).business.sig || []);
// Дефис вместо тире записан кодом: сам файл набора проходит проверку типографики.
const FIG_DASH = "\u2012", EN_DASH = "\u2013";

step("site-market: строка лидера «домен - имя (пометки)», cta - что получит клиент до 60 знаков, подробности ответа - из его фактов", () => {
  const t = text(join(ROOT, ".claude/agents/site-market.md"));
  const miss = ["«домен - имя (пометки)»", "домен первым словом", "до 60 знаков", "процедурных глаголов", "«Оставить заявку»", "только из фактов", "`offer.limits`"]
    .filter((w) => !t.includes(w));
  if (miss.length) return `в промте нет: ${miss.join(", ")}`;
  // Промт владельца по ЦА не ужимается ради места: ограничитель по достатку цел.
  const owner = ["Ограничитель по достатку - главная часть работы", "есть пенсионер, который", "НАХОДИШЬ ТЕМНЫЕ СТРАХИ"].filter((w) => !t.includes(w));
  return owner.length ? `промт владельца по ЦА поврежден: ${owner.join(", ")}` : true;
});

step("d3: «Текст главной кнопки: что получит клиент» в документе 1, листе ответов и журнале", () => {
  const d = C.DECISIONS.find((x) => x.key === "d3");
  if (!d || d.title !== "Текст главной кнопки: что получит клиент" || d.name !== "текст главной кнопки: что получит клиент") return `d3 в _contract.mjs: ${JSON.stringify(d)}`;
  const dir = putQueue(putProject("w3b-d3", baseProject()));
  const b = run([BUILD_DOC, dir]);
  if (b.code === 2) return `документы: ${bad2(b)}`;
  if (!/<td>d3<\/td><td>Текст главной кнопки: что получит клиент<\/td>/.test(text(doc(dir, DOC1)))) return "в документе 1 у d3 старый заголовок";
  const sheet = run([APPLY, dir]);
  if (!/^d3: -\s+# текст главной кнопки: что получит клиент/m.test(sheet.all)) return "в листе ответов у d3 старое имя";
  writeFileSync(join(dir, "answers.txt"), "d1: -\n", "utf8");
  const w = run([APPLY, dir, "--apply"]);
  if (w.code !== 0) return `запись: ${w.all}`;
  return journalOf(dir).some((j) => j.subject === "молчание по решению d3 - текст главной кнопки: что получит клиент") ? true : "в журнале нет молчания по d3 с новым именем";
});

step("d6 price_open: свои цены с цифрой (бриф, созвон) - да; только цены лидеров, «по запросу», снятый факт - нет", () => {
  const bad = [];
  const cases = [
    ["цена из брифа", null, true],
    ["цена из созвона", (s) => { s.facts[4].src = "созвон"; }, true],
    ["только цены лидеров", (s) => { s.facts.splice(4, 1); s.competitors.seen_numbers = ["от 4500 руб за кв м", "цена от 3000 руб", "стоимость 2500 руб"]; }, false],
    ["«по запросу» без цифры", (s) => { s.facts[4].label = "Стоимость"; s.facts[4].value = "по запросу"; }, false],
    ["факт с маркером снятия", (s) => { s.facts[4].value = "от 4500 руб за кв м, не публиковать"; }, false],
    ["цена без q от агента", (s) => { delete s.facts[4].q; }, true],
    ["opsec не про цены не мешает", (s) => { s.constraints = { ...s.constraints, opsec: "номера лицензий" }; }, true],
    ["opsec «ценности» - не про цены", (s) => { s.constraints = { ...s.constraints, opsec: "не раскрываем ценности и имена клиентов" }; }, true]
  ];
  cases.forEach(([name, tweak, want], i) => {
    const dir = join(SANDBOX, `w3b-d6-${i}`);
    seedParts(dir, tweak || undefined);
    const r = run([BUILD_PROJECT, dir]);
    if (r.code === 2) { bad.push(`${name}: сборка ${bad2(r)}`); return; }
    const has = sigOf(dir).includes("price_open");
    if (has !== want) bad.push(`${name}: price_open ${has}, ждали ${want}`);
  });
  return bad.length ? bad.join("; ") : true;
});

step("d6 price_open: магазин - да и без ценового факта (блок price растет); opsec про цены снимает у любого типа; догадка агента снимается", () => {
  const shop = join(SANDBOX, "w3b-d6-shop");
  seedParts(shop, (s) => { s.business.type = "shop"; s.facts.splice(4, 1); s.competitors.market.must_have = ["hero"]; });
  const r1 = run([BUILD_PROJECT, shop]);
  if (r1.code === 2) return `магазин: ${bad2(r1)}`;
  if (!sigOf(shop).includes("price_open")) return "магазину без ценового факта не поставлен price_open - d6 ушел бы «не печатаем»";
  if (!/price \(по признаку price_open\)/.test(r1.all)) return "блок price не добавлен признаком price_open";
  const closed = join(SANDBOX, "w3b-d6-opsec");
  seedParts(closed, (s) => { s.business.type = "shop"; s.constraints = { ...s.constraints, opsec: "цены под договором" }; });
  const r2 = run([BUILD_PROJECT, closed]);
  if (r2.code === 2) return `opsec: ${bad2(r2)}`;
  if (sigOf(closed).includes("price_open")) return "цены под opsec, а price_open стоит - документ 1 напечатал бы «печатаем цены» рядом с «не выносим наружу»";
  if (!/opsec/.test(r2.all)) return "снятие по opsec прошло молча";
  const agent = join(SANDBOX, "w3b-d6-agent");
  seedParts(agent, (s) => { s.facts.splice(4, 1); s.business.sig = ["price_open"]; });
  const r3 = run([BUILD_PROJECT, agent]);
  if (r3.code === 2) return `догадка агента: ${bad2(r3)}`;
  if (sigOf(agent).includes("price_open")) return "price_open со слов агента без своих цен остался";
  if (!/со слов агента, а своих цен/.test(r3.all)) return "снятие догадки агента не названо";
  // Своя цена есть, но закрыта opsec: предупреждение называет настоящую причину.
  const agentClosed = join(SANDBOX, "w3b-d6-agent-opsec");
  seedParts(agentClosed, (s) => { s.business.sig = ["price_open"]; s.constraints = { ...s.constraints, opsec: "цены под договором" }; });
  const r4 = run([BUILD_PROJECT, agentClosed]);
  if (r4.code === 2) return `догадка агента под opsec: ${bad2(r4)}`;
  if (sigOf(agentClosed).includes("price_open")) return "price_open со слов агента под opsec остался";
  return /со слов агента, а цены закрыты opsec/.test(r4.all) && !/со слов агента, а своих цен/.test(r4.all) ? true : "при opsec предупреждение не называет opsec";
});

step("d10: контакты и реквизиты печатаются решением с дефолтом; тире в телефоне не роняет документ", () => {
  const p = baseProject();
  p.business.legal = { entity: "ООО Невский Ремонт", inn: "7801234567", phone: `8 (812) 642${FIG_DASH}07${FIG_DASH}30`, email: "info@nevskiy.test", schedule: "пн-пт 9-18" };
  const dir = putProject("w3b-d10-doc", p);
  const b = run([BUILD_DOC, dir]);
  if (b.code === 2) return `документ не собран: ${bad2(b)}`;
  const html = text(doc(dir, DOC1));
  const row = (html.match(/<tr><td>d10<\/td>[^\n]*<\/tr>/) || [])[0] || "";
  if (!row) return "строки d10 в таблице решений нет";
  const want = ["Контакты и реквизиты для сайта", "телефон: 8 (812) 642-07-30", "почта: info@nevskiy.test", "часы: пн-пт 9-18", "юрлицо: ООО Невский Ремонт", "ИНН: 7801234567", "d10: метка: новое значение"];
  const miss = want.filter((w) => !row.includes(w));
  if (miss.length) return `в строке d10 нет: ${miss.join(", ")}`;
  if (/\?/.test(row)) return "строка d10 - вопрос, а не решение с дефолтом";
  // Без реквизитов строки нет, «без телефона» печатается словами.
  const none = baseProject(); delete none.business.legal;
  const d2 = putProject("w3b-d10-none", none);
  run([BUILD_DOC, d2]);
  if (/<td>d10<\/td>/.test(text(doc(d2, DOC1)))) return "d10 напечатан без реквизитов";
  const absent = baseProject(); absent.business.legal = { phone_absent: true };
  const d3 = putProject("w3b-d10-absent", absent);
  run([BUILD_DOC, d3]);
  return /телефон: без телефона/.test(text(doc(d3, DOC1))) ? true : "отказ от телефона не напечатан";
});

step("d10: сборка контракта чистит тире в телефоне у источника", () => {
  const dir = join(SANDBOX, "w3b-d10-bp");
  seedParts(dir, (s) => { s.business.legal = { entity: "ООО Невский Ремонт", phone: `+7 812 555${EN_DASH}01${EN_DASH}02` }; });
  const r = run([BUILD_PROJECT, dir]);
  if (r.code === 2) return `сборка: ${bad2(r)}`;
  const ph = readJson(join(dir, "project.json")).business.legal.phone;
  return ph === "+7 812 555-01-02" ? true : `телефон в контракте «${ph}»`;
});

step("d10: правка листом меняет только поля business.legal; ИНН не по маске и чужая метка - не разобрано; одна запись «правка» в журнале", () => {
  const p = baseProject();
  p.business.legal = { entity: "ООО Невский Ремонт", inn: "7801234567", phone: "+7 (812) 642-07-30" };
  const dir = putQueue(putProject("w3b-d10-edit", p));
  const sheet = run([APPLY, dir]);
  if (!/^d10: -\s+# контакты и реквизиты\. Сейчас: телефон: \+7 \(812\) 642-07-30; юрлицо: ООО Невский Ремонт; ИНН: 7801234567/m.test(sheet.all)) return "в листе ответов нет строки d10 с текущими значениями";
  writeFileSync(join(dir, "answers.txt"), "d10: телефон: +7 (812) 555-01-02; ИНН 123; часы: пн-сб 10-19; телеграм @nevskiy << номер поменяли весной\n", "utf8");
  const dry = run([APPLY, dir]);
  if (dry.code !== 0) return `просмотр: ${dry.all}`;
  if (readJson(join(dir, "project.json")).business.legal.phone !== "+7 (812) 642-07-30") return "просмотр изменил контракт";
  if (!/business\.legal\.phone \(d10 телефон\)/.test(dry.all) || !/номер поменяли весной/.test(dry.all)) return "в дифф-листе нет строки по телефону с фразой заказчика";
  const w = run([APPLY, dir, "--apply"]);
  if (w.code !== 0) return `запись: ${w.all}`;
  const after = readJson(join(dir, "project.json"));
  const lg = after.business.legal;
  if (lg.phone !== "+7 (812) 555-01-02" || lg.schedule !== "пн-сб 10-19") return `поля не записаны: ${JSON.stringify(lg)}`;
  if (lg.inn !== "7801234567" || lg.entity !== "ООО Невский Ремонт") return `тронуты поля, которых ответ не менял или не прошли маску: ${JSON.stringify(lg)}`;
  const was = baseProject(); was.business.legal = lg; was.updated = after.updated;
  // Первое применение листа публикует молчанием факты, напечатанные «да, публикуем» (Р1,
  // программа 28.09): publish фактов сравнивается отдельно, остальное - как раньше.
  const noPub = (p) => ({ ...p, gates: 0, facts: p.facts.map((f) => ({ ...f, publish: "" })) });
  if (JSON.stringify(noPub(after)) !== JSON.stringify(noPub(was))) return "ответ по d10 изменил что-то кроме business.legal";
  if (after.facts.some((f) => f.publish !== "yes")) return "молчание первого круга не опубликовало факты документа 1";
  if (!/НЕ РАЗОБРАНО[\s\S]*d10: ИНН 123[\s\S]*10 или 12 цифр/.test(w.all) || !/телеграм/.test(w.all)) return "отказы по ИНН и чужой метке не названы";
  const j = journalOf(dir);
  const d10 = j.filter((x) => D10_RE.test(x.subject));
  // Правка - gap: новые значения заказчик еще не видел, импорт текстов не сочтет их сверенными.
  if (d10.length !== 1 || !/^правка по решению d10 - контакты и реквизиты$/.test(d10[0].subject) || d10[0].kind !== "gap") return `записей по решению d10: ${JSON.stringify(d10)}`;
  if (j.filter((x) => x.kind === "dropped" && /d10/.test(x.subject)).length !== 2) return "отброшенные куски ответа не записаны в журнал отдельно";
  return j.some((x) => /решени[а-я]*\s+d1(?![0-9])/.test(x.subject) && /d10/.test(x.subject)) ? "запись d10 читается как решение d1" : true;
});

step("d10: молчание и «верно» - записи, по которым контакты сверены; «телефон: нет» - отказ от телефона", () => {
  const mk = (name, answer) => {
    const p = baseProject();
    p.business.legal = { entity: "ООО Невский Ремонт", phone: "+7 (812) 642-07-30" };
    const dir = putQueue(putProject(name, p));
    writeFileSync(join(dir, "answers.txt"), answer, "utf8");
    const w = run([APPLY, dir, "--apply"]);
    return { dir, w, d10: journalOf(dir).filter((x) => D10_RE.test(x.subject)) };
  };
  const s = mk("w3b-d10-silent", "d1: -\n");
  if (s.w.code !== 0) return `молчание: ${s.w.all}`;
  if (s.d10.length !== 1 || s.d10[0].subject !== "молчание по решению d10 - контакты и реквизиты" || s.d10[0].kind !== "waiver" || !/телефон: \+7/.test(s.d10[0].ground)) return `молчание: ${JSON.stringify(s.d10)}`;
  const ok = mk("w3b-d10-ok", "d10: верно\n");
  if (ok.d10.length !== 1 || ok.d10[0].subject !== "подтверждение по решению d10 - контакты и реквизиты" || ok.d10[0].kind !== "waiver") return `«верно»: ${JSON.stringify(ok.d10)}`;
  // Живые формы подтверждения: одна запись waiver, без правки и без отброшенных кусков.
  const live = ["Да, все верно", "Да. Все верно.", "Все верно, спасибо", "да, верно"].map((ans, i) => {
    const r = mk(`w3b-d10-live-${i}`, `d10: ${ans}\n`);
    const extra = journalOf(r.dir).filter((x) => x.kind === "dropped" || x.kind === "gap");
    return r.d10.length === 1 && r.d10[0].subject === "подтверждение по решению d10 - контакты и реквизиты" && r.d10[0].kind === "waiver" && !extra.length ? "" : `«${ans}»: ${JSON.stringify([...r.d10, ...extra])}`;
  }).filter(Boolean);
  if (live.length) return `подтверждение живыми словами: ${live.join(" | ")}`;
  const same = mk("w3b-d10-same", "d10: телефон: +7 (812) 642-07-30\n");
  if (same.d10.length !== 1 || !/^подтверждение/.test(same.d10[0].subject) || same.d10[0].kind !== "waiver") return `ответ, совпавший с дефолтом: ${JSON.stringify(same.d10)}`;
  const no = mk("w3b-d10-nophone", "d10: телефон: нет\n");
  const lg = readJson(join(no.dir, "project.json")).business.legal;
  if (lg.phone !== undefined || lg.phone_absent !== true) return `«телефон: нет»: ${JSON.stringify(lg)}`;
  const v = run([VERIFY, no.dir, "--no-write"]);
  return v.code === 2 ? `контракт после d10 не проходит валидатор: ${bad2(v)}` : true;
});

step("d10: разбор ответа - метки, «верно, но ...», уточнение после метки, телеграм не телефон, «без выходных» не снятие", () => {
  const lg = { phone: "+7 999 111-22-33", email: "a@b.test" };
  const r1 = C.parseLegalAnswer(lg, "верно, но часы: без выходных; тел. 8 800 000-00-00; e-mail: нет");
  const got = Object.fromEntries(r1.ops.map((o) => [o.key, o.remove ? "-" : o.now]));
  if (got.schedule !== "без выходных" || got.phone !== "8 800 000-00-00" || got.email !== "-" || r1.dropped.length) return `разбор: ${JSON.stringify(r1)}`;
  const r2 = C.parseLegalAnswer(lg, "телеграм @x; ОГРН 1027700132195; инн 7707083893");
  if (!r2.dropped.some((d) => /телеграм/.test(d.token)) || r2.ops.length !== 2) return `метки: ${JSON.stringify(r2)}`;
  const r3 = C.parseLegalAnswer(lg, "почта: без собаки");
  if (r3.dropped.length !== 1 || r3.ops.length) return `почта без @: ${JSON.stringify(r3)}`;
  // Метка с уточнением: «адрес почты» - почта, «почтовый адрес» - адрес, уточнение после метки - не разобрано.
  const one = (ans) => { const r = C.parseLegalAnswer(lg, ans); return r.ops.length === 1 && !r.dropped.length ? `${r.ops[0].key}=${r.ops[0].now}` : `drop:${r.dropped.length}/ops:${r.ops.length}`; };
  const want = [
    ["адрес почты: x@y.test", "email=x@y.test"],
    ["адрес электронной почты: x@y.test", "email=x@y.test"],
    ["почтовый адрес: 190000, СПб, Невский 1", "address=190000, СПб, Невский 1"],
    ["Телефон для WhatsApp: +7 999 000-00-00", "drop:1/ops:0"],
    ["E-mail для заявок: x@y.test", "drop:1/ops:0"],
    ["адрес сайта: nevskiy.test", "drop:1/ops:0"],
    ["Да, все верно, но телефон: +7 900 000-00-00", "phone=+7 900 000-00-00"],
    ["телефон: +7 900 000-00-00, остальное верно, спасибо", "phone=+7 900 000-00-00"],
    ["ИНН: 7707083893.", "inn=7707083893"]
  ].filter(([ans, w]) => one(ans) !== w).map(([ans, w]) => `«${ans}»: ${one(ans)}, ждали ${w}`);
  if (want.length) return want.join(" | ");
  const polite = C.parseLegalAnswer(lg, "Спасибо");
  return !polite.accept && polite.dropped.length === 1 ? true : `одна вежливость засчитана подтверждением: ${JSON.stringify(polite)}`;
});

step("строки лидеров: без домена - предупреждение; домен, .рф, punycode и «Имя - домен» проходят; «г.Тула» доменом не считается", () => {
  const yes = ["ringstudio.ru - Ring Studio (не мерили)", "Ромашка - пример.рф", "xn--e1afmkfd.xn--p1ai - Пример", "https://www.nota-gold.ru/katalog", "Студия - studio-1.moscow"];
  const no = ["Студия Ромашка г.Тула", "Мастерская на ул.Ленина", "Nota Gold (не мерили)", "info@studio.ru"];
  const wrong = [...yes.filter((s) => !C.hasDomain(s)), ...no.filter((s) => C.hasDomain(s))];
  if (wrong.length) return `домен распознан неверно: ${wrong.join(" | ")}`;
  const p = baseProject();
  p.competitors.list = [yes[0], yes[1], no[0]];
  const dir = putProject("w3b-rivals", p);
  const r = run([VERIFY, dir, "--seed", "--no-write"]);
  if (r.code !== 1) return `exit ${r.code}, ждали 1 (предупреждение)`;
  const warn = r.all.split("\n").filter((l) => /competitors\.list/.test(l));
  return warn.length === 1 && /list\[2\][^\n]*нет домена/.test(warn[0]) ? true : `предупреждения: ${warn.join(" | ")}`;
});

step("документ 1 печатает лидеров без служебных пометок в скобках", () => {
  const p = baseProject();
  p.competitors.list = ["ringstudio.ru - Ring Studio (не мерили)", "nota-gold.ru - Nota Gold"];
  const dir = putProject("w3b-rivals-doc", p);
  const b = run([BUILD_DOC, dir]);
  if (b.code === 2) return bad2(b);
  const html = text(doc(dir, DOC1));
  if (/не мерили/.test(html)) return "служебная пометка разведки ушла заказчику";
  return /Смотрели: ringstudio\.ru - Ring Studio, nota-gold\.ru - Nota Gold/.test(html) ? true : "строка «Смотрели» не напечатана";
});

step("ответ на возражение: число без опоры в его фактах - предупреждение; число из факта или offer.limits - чисто", () => {
  const p = baseProject();
  p.audience.segments[0].objection[0].answer = "цена фиксируется в договоре, доплата не больше 15 процентов";
  const r = run([VERIFY, putProject("w3b-ans-bad", p), "--seed", "--no-write"]);
  if (r.code !== 1 || !/objection\[0\]\.answer[^\n]*15/.test(r.all)) return `число без опоры прошло: exit ${r.code}`;
  const q = baseProject();
  q.offer.limits = ["не выезжаем дальше 60 км от города"];
  q.audience.segments[0].objection[0].answer = "выезжаем в пределах 60 км, дальше не берем";
  q.audience.segments[1].objection[1].answer = "фотоотчет и 4 500 руб за кв м без доплат";
  q.audience.segments[1].objection[1].facts = ["f05"];
  const r2 = run([VERIFY, putProject("w3b-ans-ok", q), "--seed", "--no-write"]);
  return r2.code === 0 ? true : `опора из факта или границы не засчитана: ${r2.all.split("\n").filter((l) => /^\s+[!~]/.test(l)).join(" | ")}`;
});

step("состав: тип из колонки важнее шаблонного адреса; шаблон узнается по адресу и слову «шаблон»; сравнение - служебная, политика и согласие - юридические", () => {
  const t = [
    [{ type: "Услуга", url: "/uslugi/{slug}", name: "Услуга" }, "service"],
    [{ type: "Товар", url: "/katalog/{slug}", name: "Карточка (шаблон)" }, "product"],
    [{ type: "", url: "/x/[slug]", name: "x" }, "product"],
    [{ type: "Категория", url: "/katalog-slug", name: "Каталог" }, "category"]
  ].filter(([p, want]) => C.importType(p) !== want).map(([p, want]) => `${p.url}: ${C.importType(p)}, ждали ${want}`);
  if (t.length) return t.join("; ");
  const p = baseProject();
  p.tier = "basic";
  const sd = plannerStructure();
  sd.pages[3].url = "/uslugi/{slug}";
  sd.pages.push({ ...sd.pages[8], n: 10, url: "/sravnenie", type: "Прочее", name: "Сравнение" });
  sd.pages.push({ ...sd.pages[8], n: 11, url: "/politika", type: "Прочее", name: "Политика" });
  sd.pages.push({ ...sd.pages[2], n: 12, url: "/katalog/plitka", type: "Товар", name: "Карточка плитки (шаблон)", section: "dir:remont-kvartir" });
  sd.pages.push({ ...sd.pages[8], n: 13, url: "/dokument", type: "Прочее", name: "Согласие на обработку данных" });
  const chk = C.checkStructure(sd, p);
  const V = chk.V.join(" | "), W = chk.W.join(" | ");
  if (!/\/uslugi\/\{slug\}[^|]*шаблон карточки бывает только у «Товар»/.test(V)) return `шаблонный адрес у услуги не пойман: ${V}`;
  if (/импорт прочтет «product»/.test(V)) return "проверка держит старое правило: шаблон перебивает тип";
  if (!/\/sravnenie[^|]*служебная/.test(W) || !/\/politika[^|]*юридическая/.test(W)) return `служебные и юридические: ${W}`;
  if (!/\/dokument[^|]*юридическая/.test(W)) return `юридическая по названию не узнана: ${W}`;
  // Шаблон карточки по слову «шаблон» импорт узнает и без {slug}: ни нарушения, ни совета дописать адрес.
  if (/\/katalog\/plitka/.test(V) || /\/katalog\/plitka/.test(W)) return `шаблон карточки без {slug}: V ${V} | W ${W}`;
  return true;
});

step("копия правил импорта в _contract.mjs совпадает с import-structure.mjs kit (тип, шаблон, legal, служебные)", () => {
  const kit = join(ROOT, ".claude/skills/site-tekst/kit");
  const dir = join(SANDBOX, "w3b-import-sync");
  for (const d of ["scripts", "schemas"]) cpSync(join(kit, d), join(dir, d), { recursive: true });
  const pages = [
    ["/", "Главная", "Главная"], ["/uslugi", "Категория", "Услуги", "навигация"], ["/uslugi/remont", "Услуга", "Ремонт"],
    ["/katalog", "Категория", "Каталог"], ["/katalog/{slug}", "Товар", "Карточка (шаблон)"], ["/uslugi/[id]", "Услуга", "Услуга"],
    ["/tovary/{slug}", "", "Товар"], ["/katalog/plitka", "Товар", "Карточка плитки (шаблон)"], ["/katalog-slug", "Категория", "Каталог плитки"],
    ["/politika", "Прочее", "Политика"], ["/soglasie-na-obrabotku", "Прочее", "Согласие"], ["/dokument", "Прочее", "Публичная оферта"],
    ["/personal", "Прочее", "Личный кабинет"], ["/sravnenie", "Прочее", "Сравнение"], ["/izbrannoe", "Прочее", "Избранное"],
    ["/o-kompanii", "Инфо", "О компании"], ["/keisy", "Инфо", "Кейсы"], ["/en", "Прочее", "English"], ["/uslugi/otdelka", "Услуга", "Отделка (хаб)"]
  ].map(([url, type, name, role], i) => ({ n: i + 1, url, type, name, role: role || "", target_status: "yes", queries: [] }));
  mkdirSync(join(dir, "config"), { recursive: true });
  mkdirSync(join(dir, "inputs"), { recursive: true });
  writeFileSync(join(dir, "config", "project.json"), JSON.stringify({ site_url: "https://test.example", niche: { business_type: "services" } }), "utf8");
  writeFileSync(join(dir, "inputs", "structure_data.json"), JSON.stringify({ pages }), "utf8");
  const r = spawnSync(process.execPath, ["scripts/import-structure.mjs"], { cwd: dir, encoding: "utf8" });
  if (r.status !== 0) return `import-structure: ${(r.stdout || "") + (r.stderr || "")}`.slice(0, 400);
  const sm = readJson(join(dir, "work", "sitemap.json"));
  const bad = [];
  for (const p of pages) {
    const got = sm.pages.find((x) => x.url === p.url);
    const mine = { type: C.importType(p), template: C.isTemplatePage(p), legal: C.isLegalPage(p), service: C.isServicePage(p) };
    const kitv = got ? { type: got.type, template: got.template === true, legal: got.ui_role === "legal", service: got.status === "skip" && !got.ui_role } : { type: null, template: false, legal: false, service: false };
    if (JSON.stringify(mine) !== JSON.stringify(kitv)) bad.push(`${p.url}: копия ${JSON.stringify(mine)}, импорт ${JSON.stringify(kitv)}`);
  }
  return bad.length ? `копия разошлась с import-structure.mjs: ${bad.join(" | ")}` : true;
});

step("имена решений d1-d8 в import-project.mjs kit совпадают с DECISIONS _contract.mjs; зона-расширение файла - не домен", () => {
  const src = text(join(ROOT, ".claude/skills/site-tekst/kit/scripts/import-project.mjs"));
  const kit = Object.fromEntries([...src.matchAll(/\{\s*key:\s*'(d\d+)',\s*name:\s*'([^']*)'/g)].map((m) => [m[1], m[2]]));
  const bad = C.DECISIONS.filter((d) => kit[d.key] !== d.name).map((d) => `${d.key}: анализ «${d.name}», kit «${kit[d.key] ?? "нет"}»`);
  if (bad.length) return bad.join(" | ");
  const ext = ["прайс в файле price.pdf", "страница index.html"].filter((s) => C.hasDomain(s));
  return ext.length ? `расширение файла принято за домен: ${ext.join(" | ")}` : true;
});

// ──────────────────────────────────────────────────────────────────────────
console.log("");
console.log("=== Программа 28.09 (P1): лист ответов, гейт, пересборка, контракт ===");
// ──────────────────────────────────────────────────────────────────────────

// Проект на шаге 5 документированными командами: init -> parts -> сборка -> состав -> документы -> ссылки.
function readyProject(name, { tier = "seo", kind = "multipage", type = "services", tweak } = {}) {
  const root = join(SANDBOX, name);
  const dir = join(root, "sites", `001-${name}`);
  const init = run([QUEUE, "init", name, "--tier", tier, "--type", type, "--kind", kind, "--root", root]);
  if (init.code !== 0) throw new Error(`init: ${init.all}`);
  seedParts(dir, (src) => { src.tier = tier; src.business.type = type; src.business.site_kind = kind; if (tweak) tweak(src); });
  const bp = run([BUILD_PROJECT, dir]);
  if (bp.code === 2) throw new Error(`сборка: ${bad2(bp)}`);
  if (tier === "basic" && kind === "multipage") putStructure(dir, plannerStructure());
  const bd = run([BUILD_DOC, dir]);
  if (bd.code === 2) throw new Error(`документы: ${bd.all}`);
  run([QUEUE, "docs", dir, "--understood", "https://drive.test/1", "--ask", "https://drive.test/2"]);
  return dir;
}
const proj = (dir) => readJson(join(dir, "project.json"));
const factOf = (dir, id) => proj(dir).facts.find((f) => f.id === id) || null;
const srcOf = (dir, id) => readJson(join(dir, "parts", "facts-src.json")).filter((x) => x.id === id);
const sheet = (dir, name, body) => writeFileSync(join(dir, name), body, "utf8");
const applyAll = (dir) => run([APPLY, dir, "--apply"]);
const gateOf = (dir, ...extra) => run([QUEUE, "gate", dir, "--by", "владелец", ...extra]);

step("Р1: образец листа печатает все факты строкой «fNN: -», шапка без «молчание = уходит в вопросы»; в документе 1 колонка кода", () => {
  const dir = readyProject("r1-sheet");
  const t = run([APPLY, dir]).all;
  const lines = t.match(/^f\d\d: -/gm) || [];
  if (lines.length !== 15) return `фактов в образце ${lines.length}, ждали все 15`;
  if (/молчание = уходит в вопросы/.test(t)) return "шапка образца по-прежнему обещает, что молчание уходит в вопросы";
  if (!/«нет» = не публикуем/.test(t) || !/\+: что = значение/.test(t) || !/F8NN: что = значение/.test(t)) return "образец не объясняет «нет», «+» и F8NN";
  const html = text(doc(dir, DOC1));
  if (!/<th>Код<\/th><th>Что<\/th>/.test(html) || !/<td>f07<\/td><td>Лицензия<\/td>/.test(html)) return "в таблице «Ваши цифры» нет кода fNN";
  return true;
});

step("Р1: пустой лист публикует ровно напечатанное «да, публикуем»; помеченное и запретное - нет; прочерк = молчание", () => {
  const dir = readyProject("r1-empty", { tweak: (s) => { s.facts[2].value = "9 лет на рынке (конфиденциально)"; s.facts[3].value = "137 объектов дешево"; } });
  const html = text(doc(dir, DOC1));
  if (!/<td>f03<\/td>[^\n]*нет, помечено как закрытое/.test(html)) return "документ 1 не отличает «помечено как закрытое»";
  if (!/<td>f04<\/td>[^\n]*нет, у вас это в запретах/.test(html)) return "документ 1 не отличает «в запретах»";
  sheet(dir, "answers.txt", "f05: -\n");
  const w = applyAll(dir);
  if (w.code !== 0) return `запись: ${w.all}`;
  const p = proj(dir);
  const pub = p.facts.filter((f) => f.publish === "yes").map((f) => f.id);
  if (pub.length !== 13 || pub.includes("f03") || pub.includes("f04") || !pub.includes("f05")) return `опубликованы ${pub.join(", ")}`;
  const j = readJson(join(dir, "queue.json")).journal;
  if (!j.some((e) => e.key === "f01" && e.kind === "waiver" && /^молчание по факту f01/.test(e.subject))) return "молчание по факту не записано в журнал с ключом";
  if (p.gaps.some((g) => /Уточните/.test(g.ask))) return "молчание завело вопрос в документ 2";
  return gateOf(dir).code === 0 ? true : "гейт после пустого листа не пройден";
});

step("Р1: «да» не меняет значение и цитату, «нет» снимает; оговорка и фраза не из входа - не разобрано, гейт ждет правки", () => {
  const dir = readyProject("r1-yesno");
  const before = srcOf(dir, "f01")[0];
  sheet(dir, "answers.txt", "f01: да\nf02: нет\nf06: нет, это устарело\nf08: 20 дней на объект << этой фразы во входе нет\n");
  const w = applyAll(dir);
  if (w.code !== 0) return `запись: ${w.all}`;
  const f1 = factOf(dir, "f01"), f2 = factOf(dir, "f02"), f6 = factOf(dir, "f06"), f8 = factOf(dir, "f08");
  if (f1.value !== "3 года по договору" || f1.publish !== "yes" || f1.src !== "бриф") return `«f01: да»: ${JSON.stringify(f1)}`;
  if (JSON.stringify(srcOf(dir, "f01")[0]) !== JSON.stringify(before)) return "«да» переписало цитату факта";
  if (f2.publish !== "no" || f2.value !== "2 часа по городу") return `«f02: нет»: ${JSON.stringify(f2)}`;
  if (f6.publish !== "no" || f6.value !== "12 бригад") return `ответ с оговоркой опубликован: ${JSON.stringify(f6)}`;
  if (f8.publish !== "no" || f8.value !== "14 дней на объект") return `фраза не из входа: старое значение осталось в публикации: ${JSON.stringify(f8)}`;
  if (!/не найдена во входе/.test(w.all)) return "причина «фраза не найдена во входе» не названа";
  if (!proj(dir).gaps.some((g) => /Бригад в работе/.test(g.ask))) return "вопрос по неразобранному факту не ушел в документ 2";
  const g1 = gateOf(dir);
  if (g1.code !== 2 || !/не разобраны ответы по[^\n]*f06/.test(g1.all) || !/f08/.test(g1.all)) return `гейт при незакрытом «не разобрано»: exit ${g1.code}`;
  sheet(dir, "answers.txt", "f01: да\nf02: нет\nf06: 14 бригад\nf08: да\n");
  const w2 = applyAll(dir);
  if (w2.code !== 0) return `повтор: ${w2.all}`;
  if (factOf(dir, "f06").value !== "14 бригад" || factOf(dir, "f08").publish !== "yes") return "правка строк не применилась";
  if (factOf(dir, "f03").publish !== "yes") return "повторное применение листа сняло факт, опубликованный молчанием первого применения";
  const g2 = gateOf(dir);
  return g2.code === 0 ? true : `гейт после правки: ${g2.all}`;
});

step("круги: второй лист не возвращает снятое в первом и не роняет его цитаты; примененный лист не разбирается заново", () => {
  const dir = readyProject("r1-round2");
  sheet(dir, "answers.txt", "f07: нет\nf03: 10 лет на рынке\n");
  if (applyAll(dir).code !== 0) return "первый круг не применился";
  sheet(dir, "answers-2.txt", "g2: есть, 40 фото объектов\n");
  const w = applyAll(dir);
  if (w.code !== 0) return `второй круг: ${w.all}`;
  if (!/листы: answers-2\.txt/.test(w.all)) return `применены не только новые листы: ${(w.all.match(/листы: [^\n]*/) || [""])[0]}`;
  if (factOf(dir, "f07").publish !== "no") return "второй лист вернул в публикацию факт, снятый в первом";
  if (srcOf(dir, "f03")[0].where !== "answers.txt:2") return "цитата первого круга потеряна";
  const nf = proj(dir).facts.find((f) => f.value === "есть, 40 фото объектов");
  if (!nf || (srcOf(dir, nf.id)[0] || {}).where !== "answers-2.txt:1") return "факт второго круга без цитаты своего листа";
  const v = run([VERIFY, dir, "--no-write"]);
  if (v.code === 2) return `второй круг уронил сверку цитат: ${bad2(v)}`;
  const q = readJson(join(dir, "queue.json"));
  if ((q.answers || []).map((m) => m.file).join() !== "answers.txt,answers-2.txt") return `отметки листов: ${JSON.stringify(q.answers)}`;
  const again = applyAll(dir);
  return /листы: все уже применены/.test(again.all) ? true : "примененные листы разобраны заново";
});

step("решения: подтверждение не меняет поле, голое «да» у d1-d5 - не разобрано, отрицания в d6-d8, каждый напечатанный вариант - в свой ключ", () => {
  const p = baseProject();
  const bad = [];
  const got = (key, ans) => {
    const d = C.DECISIONS.find((x) => x.key === key);
    const r = C.parseDecision(clone(p), d, ans);
    return r.op === "set" ? `set:${Array.isArray(r.value) ? "list" : r.value}` : r.op;
  };
  const table = [
    ["d1", "да, все верно", "accept"], ["d1", "Верно", "accept"], ["d1", "да", "drop"], ["d1", "нет", "drop"], ["d1", "нет, мы мастерская", "drop"],
    ["d1", "мастерская ремонта с прорабом", "set:мастерская ремонта с прорабом"], ["d3", "да", "drop"], ["d4", "согласны", "accept"],
    ["d5", "ок", "drop"], ["d5", "нет пафоса, на вы", "set:нет пафоса, на вы"],
    ["d6", "давайте без цен", "set:false"], ["d6", "дайте подумать", "drop"], ["d6", "да", "set:true"], ["d6", "нет", "set:false"],
    ["d6", "да, все верно", "accept"], ["d6", "по запросу", "set:false"], ["d6", "да, но только от цены", "drop"],
    ["d7", "нам не нужен лендинг, делаем многостраничный", "set:multipage"], ["d7", "многостраничный, не лендинг", "set:multipage"],
    ["d7", "лендинг", "set:landing"], ["d7", "хватит одной страницы", "set:landing"], ["d7", "верно", "accept"],
    ["d8", "не магазин, только услуги", "set:services"], ["d8", "услуги, товаров не продаем", "set:services"],
    ["d8", "услуги и готовые изделия из каталога", "set:both"], ["d8", "магазин", "set:shop"], ["d8", "работаем", "drop"],
    // доделка №2: «никаких», оценки «мало», «лишний», «правок нет» и вежливость у d1-d5, «ок» у d6
    ["d7", "никаких лендингов, нужен полноценный сайт", "drop"], ["d7", "никакого лендинга", "drop"], ["d7", "лендинг лишний", "drop"],
    ["d7", "одной страницы мало", "drop"], ["d7", "одной страницы недостаточно", "drop"], ["d7", "никаких лендингов, делаем многостраничный", "set:multipage"],
    ["d8", "никаких товаров, только услуги", "set:services"], ["d8", "ничего из товаров не продаем, только услуги", "set:services"],
    ["d4", "Согласны со всем", "accept"], ["d4", "все устраивает", "accept"], ["d4", "правок нет", "accept"], ["d4", "замечаний нет", "accept"],
    ["d4", "нет возражений", "accept"], ["d4", "так и оставим", "accept"], ["d4", "согласовано", "accept"],
    ["d1", "правок нет", "accept"], ["d1", "оставляем как есть", "accept"], ["d1", "как есть", "accept"], ["d1", "вс\u0451 верно", "accept"],
    ["d1", "хорошо", "drop"], ["d1", "спасибо", "drop"], ["d1", "не надо менять", "drop"], ["d5", "хорошо", "drop"], ["d5", "нормально", "drop"],
    ["d1", "принимаем заказы от юрлиц", "set:принимаем заказы от юрлиц"],
    ["d6", "ок", "accept"], ["d6", "ok", "accept"], ["d6", "ага", "accept"], ["d6", "ок, печатаем", "set:true"], ["d8", "все так и оставим", "accept"]
  ];
  for (const [k, a, want] of table) { const g = got(k, a); if (g !== want) bad.push(`${k} «${a}»: ${g}, ждали ${want}`); }
  for (const [a, op] of [["хорошо", "drop"], ["спасибо", "drop"], ["правок нет", "accept"], ["ага", "accept"]]) {
    const g = C.parseFactAnswer(a).op; if (g !== op) bad.push(`факт «${a}»: ${g}, ждали ${op}`);
  }
  // Круг «печать -> ответ -> поле»: каждый вариант, который печатает документ 1, разбирается в свой ключ.
  for (const d of C.DECISIONS.filter((x) => x.choice)) for (const [k, t] of Object.entries(d.choice)) {
    const g = got(d.key, t); if (g !== `set:${k}`) bad.push(`${d.key} вариант «${t}»: ${g}`);
  }
  const d6 = C.DECISIONS.find((x) => x.key === "d6");
  if (got("d6", d6.onText) !== "set:true" || got("d6", d6.offText) !== "set:false") bad.push("d6: печатные варианты не разбираются в свой ключ");
  if (bad.length) return bad.join(" | ");
  const dir = putProject("dec-heard", baseProject());
  sheet(dir, "answers.txt", "d1: да, все верно\nd6: давайте без цен\nd7: нам не нужен лендинг, делаем многостраничный\n");
  const w = applyAll(dir);
  if (!/КАК ПОНЯТЫ ОТВЕТЫ/.test(w.all) || !/d1: «да, все верно» -> подтверждение/.test(w.all) || !/d7: «[^»]*» -> multipage/.test(w.all)) return "дифф-лист не печатает «понят как» для каждого ответа";
  const after = proj(dir);
  if (after.offer.positioning !== "бригада со своим прорабом на объекте") return `подтверждение переписало позиционирование: ${after.offer.positioning}`;
  if (after.business.site_kind !== "multipage") return `«лендинг не нужен» дал ${after.business.site_kind}`;
  // d6 в образце листа - вопрос «да или нет»: образец говорит, что «да» - выбор, а «ок» и «верно» - подтверждение.
  const tpl = run([APPLY, putQueue(putProject("dec-d6-hint", baseProject()))]);
  if (!/^d6: -\s+# [^\n]*«да» - печатаем цены[^\n]*«нет» - цены на сайте не печатаем, «верно» или «ок» - как сейчас/m.test(tpl.all)) return "образец листа не объясняет «да» и «ок» у d6";
  // Сквозной прогон соседних формулировок: тип сайта и границы не меняются.
  const d2 = putProject("dec-heard-2", baseProject());
  const limits0 = JSON.stringify(proj(d2).offer.limits);
  sheet(d2, "answers.txt", "d4: Согласны со всем\nd5: хорошо\nd7: никаких лендингов, нужен полноценный сайт\nd8: никаких товаров, только услуги\n");
  const w2 = applyAll(d2);
  const a2 = proj(d2);
  if (JSON.stringify(a2.offer.limits) !== limits0) return `«согласны со всем» переписало границы: ${JSON.stringify(a2.offer.limits)}`;
  if (a2.offer.tone === "хорошо") return "«хорошо» стало тоном";
  if (a2.business.site_kind !== "multipage") return `«никаких лендингов» дал ${a2.business.site_kind}`;
  if (a2.business.type !== "services") return `«никаких товаров, только услуги» дал ${a2.business.type}`;
  return /d7: «[^»]*» -> не разобрано/.test(w2.all) ? true : "d7 «никаких лендингов» не ушел в «не разобрано»";
});

step("факт: три состояния строки и не разобранное («не знаю», оговорка, пометка)", () => {
  const want = [["да", "accept"], ["+", "accept"], ["верно", "accept"], ["да, публикуем", "accept"], ["нет", "refuse"], ["не публикуем", "refuse"],
    ["убрать", "refuse"], ["нет, не публикуем", "refuse"], ["-", "silence"], ["", "silence"], ["24 месяца", "set"], ["нет предоплаты", "set"],
    ["нет, это устарело", "drop"], ["да, но уточню", "drop"], ["не знаю", "drop"], ["уточним позже", "drop"]];
  const bad = want.filter(([a, op]) => C.parseFactAnswer(a).op !== op).map(([a, op]) => `«${a}»: ${C.parseFactAnswer(a).op}, ждали ${op}`);
  return bad.length ? bad.join(" | ") : true;
});

step("гейт K10: отказ на шаге 3b, при нарушениях verify-data и при листе, измененном после применения; обход --ground пишется в журнал", () => {
  const b = readyProject("k10-3b", { tier: "basic", kind: "multipage" });
  rmSync(join(b, "structure_data.json"));
  const g1 = gateOf(b);
  if (g1.code !== 2 || !/шаге 3b/.test(g1.all)) return `гейт на шаге 3b: exit ${g1.code}`;
  const v = readyProject("k10-verify");
  sheet(v, "answers.txt", "");
  applyAll(v);
  writeFileSync(join(v, "parts", "facts-src.json"), JSON.stringify(readJson(join(v, "parts", "facts-src.json")).filter((x) => x.id !== "f03")), "utf8");
  const g2 = gateOf(v);
  if (g2.code !== 2 || !/verify-data: нарушений/.test(g2.all)) return `гейт при нарушениях verify-data: exit ${g2.code}`;
  const s = readyProject("k10-sheet");
  sheet(s, "answers.txt", "");
  applyAll(s);
  sheet(s, "answers.txt", "f01: нет\n");
  const g3 = gateOf(s);
  if (g3.code !== 2 || !/изменен после применения/.test(g3.all)) return `гейт при измененном листе: exit ${g3.code}`;
  const g4 = gateOf(s, "--ground", "заказчик подтвердил голосом, лист перепишем");
  if (g4.code !== 0) return `обход --ground: ${g4.all}`;
  const q = readJson(join(s, "queue.json"));
  if (!(q.gate.checks && (q.gate.checks.bypass || []).length)) return "обход не виден в gate.checks";
  return q.journal.some((e) => e.subject === "обход проверок гейта" && /изменен после применения/.test(e.ground)) ? true : "обход не записан в журнал с перечнем";
});

step("d7 «лендинг» и d8: значение пишется и в queue.json; лендингу состав из одной главной пишется сам, смена d8 возвращает на 3b", () => {
  const dir = readyProject("d7-landing", { tier: "basic", kind: "multipage" });
  sheet(dir, "answers.txt", "d7: лендинг\n");
  const w = applyAll(dir);
  if (w.code !== 0) return `запись: ${w.all}`;
  const q = readJson(join(dir, "queue.json"));
  if (q.site_kind !== "landing") return `queue.site_kind «${q.site_kind}» - пересборка откатила бы лендинг`;
  const sd = readJson(join(dir, "structure_data.json"));
  if (sd.pages.length !== 1 || sd.source_file !== "site-analiz") return `состав лендинга: ${sd.pages.length} страниц от ${sd.source_file}`;
  if (!/ШАГ 5/.test(run([QUEUE, "state", dir]).all)) return "очередь не дошла до шага 5 - гейт стал бы тупиком";
  const again = run([BUILD_PROJECT, dir]);
  if (again.code === 2) return `пересборка: ${bad2(again)}`;
  if (proj(dir).business.site_kind !== "landing") return "пересборка откатила лендинг в многостраничник";
  const s = readyProject("d8-flip", { tier: "basic", kind: "multipage" });
  sheet(s, "answers.txt", "d8: продаете товары из каталога\n");
  applyAll(s);
  if (readJson(join(s, "queue.json")).type !== "shop") return "d8 не записан в queue.json";
  const st = run([QUEUE, "state", s]).all;
  return /ШАГ 3b/.test(st) && /под тип сайта/.test(st) ? true : `состав услуг при магазине прошел: ${st.trim().split("\n").slice(-2).join(" / ")}`;
});

step("пересборка после ответов: гейт и отметки сброшены, «yes» со старым значением не выжил; повтор всех кругов дает тот же итог", () => {
  const dir = readyProject("r4-rebuild", { tier: "basic", kind: "multipage" });
  sheet(dir, "answers.txt", "d1: мастерская ремонта с прорабом на каждом объекте\nf01: 5 лет по договору\ng1: 3900 руб за кв м\nd10: телефон: +7 (812) 555-01-02\nf07: нет\nd9: убрать /otzyvy\n");
  sheet(dir, "answers-2.txt", "f07: да\n+: Мастеров в штате = 11 человек\n");
  if (applyAll(dir).code !== 0) return "ответы не применились";
  if (gateOf(dir).code !== 0) return "гейт после ответов не пройден";
  const snap = () => {
    const p = proj(dir);
    const sd = readJson(join(dir, "structure_data.json"));
    return JSON.stringify({ f: p.facts.map((f) => `${f.id}|${f.value}|${f.publish}|${f.src}`).sort(), pos: p.offer.positioning, lg: p.business.legal,
      g: p.gaps.map((g) => g.id).sort(), off: sd.pages.filter((x) => x.target_status === "no").map((x) => x.url) });
  };
  const before = snap();
  const r = run([BUILD_PROJECT, dir, "--force"]);
  if (r.code === 2) return `пересборка: ${bad2(r)}`;
  const f1 = factOf(dir, "f01");
  if (f1.publish === "yes" && f1.value === "3 года по договору") return "после пересборки в публикацию ушло значение, которое заказчик исправил";
  if (!/значение из ответа заказчика перебито входом[^\n]*f01/.test(r.all)) return "перебитое значение не названо";
  if (readJson(join(dir, "queue.json")).gate.approved !== false) return "гейт остался пройденным после пересборки";
  if (applyAll(dir).code !== 0) return "повтор листов не применился";
  const after = snap();
  if (after !== before) return `повтор всех кругов дал другой итог:\n  было  ${before}\n  стало ${after}`;
  return gateOf(dir).code === 0 ? true : "повторный гейт не пройден";
});

step("Р3 и K11: при 40 фактах ответ занимает место снятого факта засева, затем до 50; «+» и F8NN; номера не переиспользуются; метка по границе слова", () => {
  const long = "Какие металлы и пробы используете в работе: золото, серебро, платина, палладий и сплавы на заказ";
  const dir = readyProject("r3-cap", { tweak: (s) => {
    for (let i = 16; i <= 40; i++) s.facts.push({ id: `f${i}`, label: `Показатель ${i}`, value: `${i} позиций в наличии`, kind: "number", q: ["listing"], publish: "no", src: "бриф" });
    s.gaps.push({ id: "g3", ask: long, hits: ["specs"] });
  } });
  if (proj(dir).facts.length !== 40) return `засев ${proj(dir).facts.length} фактов`;
  sheet(dir, "answers.txt", `f02: нет\nf09: нет\ng1: 3900 руб за кв м\ng2: есть, 40 фото объектов\ng3: золото 585 и 750, серебро 925\n+: Мастеров в штате = 11 человек\nF801: Гарантия на пайку = 6 месяцев\n`);
  const w = applyAll(dir);
  if (w.code !== 0) return `запись: ${w.all}`;
  if (/НЕ РАЗОБРАНО/.test(w.all)) return `ответы отброшены: ${(w.all.split("НЕ РАЗОБРАНО")[1] || "").split("\n").slice(1, 4).join(" | ")}`;
  const p = proj(dir);
  const ids = p.facts.map((f) => f.id);
  if (ids.includes("f02") || ids.includes("f09")) return "снятые факты засева не уступили место ответам";
  if (p.facts.length !== 43) return `фактов ${p.facts.length}, ждали 43 (40 - 2 снятых + 5 новых)`;
  const fresh = p.facts.filter((f) => f.src === "ответ").map((f) => f.id).sort();
  if (fresh.join() !== "f41,f42,f43,f44,f45") return `номера новых фактов ${fresh.join(", ")} - номер снятого факта не выдается заново`;
  const op = p.facts.find((f) => f.moved_from === "F801");
  if (!op || op.label !== "Гарантия на пайку" || op.value !== "6 месяцев") return `F801: ${JSON.stringify(op)}`;
  const g3 = p.facts.find((f) => /золото/.test(f.value));
  if (!g3 || Array.from(g3.label).length > 80 || !long.startsWith(g3.label) || !/[ ,]/.test(long.charAt(g3.label.length))) return `метка обрезана посреди слова: «${g3 && g3.label}»`;
  if (srcOf(dir, "f02").length || srcOf(dir, "f09").length) return "цитата снятого факта осталась в facts-src.json";
  const v = run([VERIFY, dir, "--no-write"]);
  if (v.code === 2) return `проверка данных после ответов: ${bad2(v)}`;
  // потолок 50: все 40 опубликованы - места снятых нет, растем до 50, одиннадцатый новый факт - «не разобрано»
  const d2 = readyProject("r3-cap50", { tweak: (s) => { for (let i = 16; i <= 40; i++) s.facts.push({ id: `f${i}`, label: `Показатель ${i}`, value: `${i} позиций в наличии`, kind: "number", q: ["listing"], publish: "no", src: "бриф" }); } });
  sheet(d2, "answers.txt", Array.from({ length: 11 }, (_, i) => `+: Новый показатель ${i + 1} = ${i + 100} позиций`).join("\n") + "\n");
  const w2 = applyAll(d2);
  if (proj(d2).facts.length !== 50 || !/потолок 50/.test(w2.all)) return `потолок 50: фактов ${proj(d2).facts.length}`;
  const v2 = run([VERIFY, d2, "--no-write"]);
  if (v2.code === 2) return `50 фактов не прошли проверку данных: ${bad2(v2)}`;
  const seed = baseProject();
  for (let i = 16; i <= 41; i++) seed.facts.push({ id: `f${i}`, label: `Показатель ${i}`, value: `${i} позиций`, kind: "number", publish: "no", src: "бриф" });
  const r3 = run([VERIFY, putProject("r3-seed41", seed), "--seed", "--no-write"]);
  return r3.code === 2 && /потолок 40/.test(r3.all) ? true : `засев 41 факта прошел: exit ${r3.code}`;
});

step("K1: «адрес: убрать» в d10 - поле в absent_fields, документ печатает «не указываем»; сборка поле сохраняет", () => {
  const dir = readyProject("k1-absent", { tweak: (s) => { s.business.legal = { entity: "ООО Невский Ремонт", phone: "+7 (812) 642-07-30", address: "СПб, Невский 1", schedule: "пн-пт 9-18" }; } });
  sheet(dir, "answers.txt", "d10: адрес: убрать; часы: убрать\n");
  const w = applyAll(dir);
  if (w.code !== 0) return `запись: ${w.all}`;
  const lg = proj(dir).business.legal;
  if (lg.address !== undefined || lg.schedule !== undefined || JSON.stringify(lg.absent_fields) !== JSON.stringify(["schedule", "address"])) return `legal: ${JSON.stringify(lg)}`;
  if (C.legalParts(lg).join("; ") !== "телефон: +7 (812) 642-07-30; часы: не указываем; адрес: не указываем; юрлицо: ООО Невский Ремонт") return `печать d10: ${C.legalParts(lg).join("; ")}`;
  const again = C.parseLegalAnswer(lg, "адрес: не указываем");
  if (again.ops.length || !again.same.includes("адрес")) return "повторное «убрать» считается правкой";
  const back = C.parseLegalAnswer(lg, "адрес: СПб, Литейный 2");
  const copy = { business: { legal: clone(lg) } };
  C.applyLegalOps(copy, back.ops);
  if (JSON.stringify(copy.business.legal.absent_fields) !== JSON.stringify(["schedule"])) return "новое значение не сняло поле из absent_fields";
  const v = run([VERIFY, dir, "--no-write"]);
  if (v.code === 2) return `схема не приняла absent_fields: ${bad2(v)}`;
  const bp = join(SANDBOX, "k1-build");
  seedParts(bp, (s) => { s.business.legal = { entity: "ООО Невский Ремонт", absent_fields: ["address", "fax"] }; });
  const r = run([BUILD_PROJECT, bp]);
  if (r.code === 2) return `сборка: ${bad2(r)}`;
  return JSON.stringify(proj(bp).business.legal.absent_fields) === JSON.stringify(["address"]) ? true : `сборка: ${JSON.stringify(proj(bp).business.legal)}`;
});

// Литерал K2 (суженный доделкой №13, уточненный повторной и второй повторной проверкой №13) - кодами букв, как в
// _contract.mjs, в копии kit и в спецификации.
const HELD_SPEC = "(^|[^а-я\\u0451a-z0-9])(?<!(^|[^а-я\\u0451])(обязу|обязан|гарантиру|обеща|мож|вправе|будем|стара|чтоб)[а-я\\u0451]*\\s+([а-я\\u0451]+\\s+){0,3})(не\\s+(публиковать|печатать|указывать|упоминать|раскрывать|разглашать|называть|показывать|размещать|озвучивать)|не\\s+для\\s+(сайта|публикации|печати|размещения|распространения|показа))(?![а-я\\u0451])|(^|[:;(\\[,.]|\\s[-\\u2013\\u2014])\\s*не\\s+(публик[а-я\\u0451]*|печата[а-я\\u0451]*|(показыва|указыва|размеща|выкладыва|озвучива|называ)(ем|ется|ются|ть|йте))(\\s+(на|в)\\s+(сайте|открытом\\s+доступе|интернете|сети))?\\s*($|[),.;!\\]])|[(\\[]\\s*(скрыть|скрыто|скрыта|скрыты|скрываем|убрать|убираем)\\s*[)\\]]|([:;(\\[]|\\s[-\\u2013\\u2014])\\s*(под\\s+nda|коммерческ[а-я\\u0451]*\\s+тайн[а-я\\u0451]*)\\s*($|[).;!\\]])|(?<!(nda|конфиденц|неразглаш|соглаш|договор|тайн|секрет|аноним|приватн|защит|гарант|безопасн)[^:;\\n]*)([:;]|\\s[-\\u2013\\u2014])\\s*nda\\s*($|[).;!])|(?<!(конфиденциальност|неразглашени|соглашени|договор)[а-я\\u0451]*\\s*)\\(\\s*nda\\s*\\)|([:(\\[]|(?<![а-я\\u0451]о)(,|\\s[-\\u2013\\u2014]))\\s*конфиденциально\\s*($|[).;!\\]])|[:(]\\s*(строго\\s+конфиденциально|конфиденциальн(ая|ые)\\s+(информация|данные|сведения))\\s*($|[).;!])|(?<![а-я\\u0451](ое|ее)\\s*)\\(\\s*внутреннее\\s*\\)|(^|[:;(]|\\s[-\\u2013\\u2014]|только\\s+)\\s*для\\s+внутренн[а-я\\u0451]*\\s+(пользования|использования)|\\(\\s*снят[оаы]?(\\s+(заказчиком|с\\s+публикации))?\\s*\\)|(^|[:;,]|\\s[-\\u2013\\u2014])\\s*снят[оаы]?\\s+(заказчиком|с\\s+публикации)\\s*($|[).;!])";
step("K2: маркер снятия ловит только явные пометки; литерал совпадает со спецификацией", () => {
  if (C.HELD_MARK.source !== HELD_SPEC || C.HELD_MARK.flags !== "i") return `HELD_MARK разошелся со спецификацией K2: ${C.HELD_MARK}`;
  const yes = ["не публиковать", "не публикуем", "адрес: не указывать", "не упоминать на сайте", "не для сайта", "клиенты: под NDA", "себестоимость - коммерческая тайна", "(снято заказчиком)", "(конфиденциально)", "(внутреннее)"];
  const no = ["снимаем мерки на дому", "гарантируем конфиденциальность", "снято нашей студией", "заснято 120 свадеб", "снят с учета", "работаем по NDA", "не раскрываем данные клиентов", "мы не называем цену до замера",
    // доделка №13: слова пометки внутри продающей фразы и скобки-пояснения
    "соблюдаем коммерческую тайну", "храним коммерческую тайну клиента", "работаем под NDA", "сопровождение сделки под NDA", "не публикуем имена клиентов без согласия",
    "не публикуем отзывы без согласия", "демонтаж (снятие старых окон)", "(сняты с производства) со скидкой", "утепление (внутреннее и наружное)", "не печатаем дешевые визитки",
    "видео снято заказчиком на телефон", "данные клиентов не публикуются в открытом доступе"];
  const yes2 = ["выручка: конфиденциально", "клиенты - под NDA", "(снято)", "(снято с публикации)", "не для публикации", "отзывы: не публикуем", "(NDA)"];
  for (const s2 of yes2) if (!C.HELD_MARK.test(s2)) return `не пойман «${s2}»`;
  const bad = [...yes.filter((s) => !C.HELD_MARK.test(s)).map((s) => `не пойман «${s}»`), ...no.filter((s) => C.HELD_MARK.test(s)).map((s) => `ложно пойман «${s}»`)];
  if (bad.length) return bad.join(" | ");
  const f = (value) => ({ id: "f01", label: "Замер", value });
  if (C.heldBack(f("снимаем мерки на дому бесплатно"), []) || C.factRec(f("снимаем мерки на дому бесплатно"), []).text !== "да, публикуем") return "продающий факт помечен снятым";
  if (C.factRec(f("Соблюдаем коммерческую тайну клиента"), []).text !== "да, публикуем") return "«соблюдаем коммерческую тайну» помечено закрытым";
  // Поле проверяется отдельно: «целое поле» не склеивается с подписью факта.
  if (C.factRec({ id: "f02", label: "Адрес склада", value: "не публикуем" }, []).text !== "нет, помечено как закрытое") return "«не публикуем» целым значением не пойман";
  // Слово-пометка целым полем («под NDA», «коммерческая тайна») - пометка как значение поля не о тайне (HELD_NDA_FIELD).
  for (const [label, value] of [["Клиенты", "под NDA"], ["Себестоимость", "коммерческая тайна"]]) if (C.factRec({ id: "f03", label, value }, []).text !== "нет, помечено как закрытое") return `«${label}» - «${value}» не закрыт`;
  return C.factRec(f("выезд 2 часа (снято заказчиком)"), []).text === "нет, помечено как закрытое" ? true : "явная пометка не дала «помечено как закрытое»";
});

// Повторная проверка №13 (этап D): все фразы пробника проверяющего (54) и реального корпуса (плашка «Строго
// конфиденциально» PR-агентства, ответ с гейта «NDA, договор, все конфиденциально», подпись юрлица) - «ловит / не
// ловит». «NDA» (а со второй повторной проверки и «под NDA», «конфиденциально», «коммерческая тайна») целым полем -
// пометка только как значение (или artifact) поля не о тайне: HELD_NDA_FIELD на строке «подпись\nзначение»;
// «Договор» - «NDA», «Анонимность» - «Конфиденциально» и подпись «NDA» - продающий факт.
const HELD_NDA_SPEC = "^(?![^\\n]*(nda|конфиденц|неразглаш|соглаш|договор|тайн|секрет|аноним|приватн|защит|гарант|безопасн))[^\\n]*\\n\\s*(nda|под\\s+nda|конфиденциально|коммерческ[а-я\\u0451]*\\s+тайн[а-я\\u0451]*)\\s*[.!]?\\s*$";
step("K2, повторная проверка №13: фразы пробника и корпуса; обязательства, «строго конфиденциально» и «(NDA)»-расшифровка не ловятся; NDA - только значение секретного поля", () => {
  if (!(C.HELD_NDA_FIELD instanceof RegExp) || C.HELD_NDA_FIELD.source !== HELD_NDA_SPEC || C.HELD_NDA_FIELD.flags !== "i") return `HELD_NDA_FIELD разошелся со спецификацией K2: ${C.HELD_NDA_FIELD}`;
  const t = (s) => C.HELD_MARK.test(String(s).trim().toLowerCase());
  // ловит: явные пометки заказчика или оператора
  const yes = [
    "не публиковать",
    "Не публиковать!",
    "НЕ ДЛЯ САЙТА",
    "цена закупки: не для публикации",
    "Оборот 50 млн (не публикуем)",
    "Оборот 50 млн - не публикуем",
    "Оборот 50 млн, не публикуем",
    "Оборот 50 млн. Не публикуем.",
    "Не публикуем!",
    "выручка: конфиденциально",
    "Себестоимость: коммерческая тайна.",
    "(коммерческая тайна)",
    "Оборот 50 млн (конфиденциальная информация)",
    "(внутреннее)",
    "(снято)",
    "Скидка 20% (снято заказчиком)",
    "Скидка 20% - снято заказчиком",
    "адрес склада не указывать",
    "Скидка для своих, не для сайта",
    "цена закупки - не публикуется",
    "цена закупки, не публикуется",
    "не показывать на сайте",
    "только для внутреннего пользования",
    "(строго конфиденциально)",
    "(под NDA)",
    "клиенты (NDA)",
    "выручка: NDA",
    "клиенты - NDA",
    "Оборот: конфиденциальная информация",
    "Документы - для внутреннего пользования",
    "снято заказчиком",
    "Скидка 20%, снято заказчиком",
    "просим не указывать адрес",
    "лучше не публиковать",
    "выручка: строго конфиденциально"
  ];
  // не ловит: продающие фразы ниш из отчета (окна, потолки, юристы, клиники, банкротство, фото, IT) и корпус клиентов
  const no = [
    "Снимаем мерки на дому бесплатно",
    "Замер и снятие размеров - бесплатно",
    "Демонтаж (снятие старых окон) входит в стоимость",
    "Снимаем старый натяжной потолок за 1 час без мусора",
    "Снятие мерок бесплатно, выезд в день обращения",
    "Гарантируем конфиденциальность",
    "Соблюдаем адвокатскую тайну и коммерческую тайну клиента",
    "Работаем под NDA",
    "Подписываем соглашение о конфиденциальности (NDA)",
    "Обязуемся не раскрывать сведения о клиенте третьим лицам",
    "Обязуемся не публиковать фото пациентов без согласия",
    "Лечение анонимно - строго конфиденциально",
    "Прием анонимно и конфиденциально",
    "Консультация: анонимно, конфиденциально, бесплатно",
    "Анонимно; конфиденциально.",
    "Снятие арестов со счетов и запретов на выезд",
    "Снимаем ограничения ФССП за 2 месяца",
    "Снят с учета в налоговой после процедуры",
    "Ваши данные не публикуем, кроме обязательного ЕФРСБ",
    "Видео снято на дроне",
    "Фото с объекта (снято на iPhone 15)",
    "Заснято более 120 свадеб",
    "внутреннее",
    "Утепление - внутреннее",
    "Утепление внутреннее и наружное",
    "Можно не печатать договор - подпишем по ЭДО",
    "Не печатаем дешевые визитки",
    "Снятие и установка колес - 1500 руб",
    "Конфиденциальность",
    "Внутреннее утепление",
    "Строго конфиденциально",
    "Строго конфиденциально.",
    "Строго конфиденциально. Не разглашаем не только детали работы - даже сам факт вашего обращения остается между нами",
    "Строго конфиденциально: не разглашаем даже факт обращения",
    "Не разглашаем даже сам факт вашего обращения - строго конфиденциально",
    "Работаем строго конфиденциально",
    "NDA, договор, все конфиденциально",
    "Мы строго следим за конфиденциальностью между нами, поэтому рассказываем без имен, отраслей и узнаваемых деталей",
    "ООО «КОММУНИКАЦИОННОЕ АГЕНТСТВО «ПРОГРЕСС» (из политики конфиденциальности старого сайта progresspr.ru)",
    "Опыт (не печатаем счетчиком)",
    "Мы используем файлы cookie. Просматривая сайт, вы подтверждаете сво\u0451 согласие с условиями Политики конфиденциальности",
    "договор о неразглашении (NDA)",
    "Работаем по договору (NDA)",
    "Договор: NDA",
    "Соглашение о неразглашении - NDA",
    "NDA",
    "Гарантируем не называть имена клиентов",
    "Обязуемся никогда не раскрывать данные",
    "Можем не указывать ваше имя в отзыве",
    "Вправе не указывать персональные данные",
    "Будем не раскрывать детали сделки",
    "Не будем публиковать фото без согласия",
    "Шторы, чтобы не показывать комнату с улицы",
    "Регламенты для внутреннего пользования разрабатываем",
    "Видео: снято заказчиком на телефон",
    "Ограничения - сняты",
    "Конфиденциальная информация защищена"
  ];
  const bad = [...yes.filter((s) => !t(s)).map((s) => `не пойман «${s}»`), ...no.filter(t).map((s) => `ложно пойман «${s}»`)];
  // документ 1 (factRec): поле целиком; [подпись, значение, ждем, artifact]
  const fr = (label, value, artifact) => C.factRec({ id: "f01", label, value, ...(artifact ? { artifact } : {}), src: "бриф" }, []).text;
  const want = { "закрыт": "нет, помечено как закрытое", "да": "да, публикуем" };
  const pairs = [
    ["Выручка", "NDA", "закрыт"],
    ["Клиенты", "NDA.", "закрыт"],
    ["", "NDA", "закрыт"],
    ["Клиенты", "Газпром, Сбер", "закрыт", "NDA"],
    ["Договор", "NDA", "да"],
    ["Конфиденциальность", "NDA", "да"],
    ["Соглашение о неразглашении", "NDA", "да"],
    ["NDA", "подписываем до старта работ", "да"],
    ["Конфиденциальность", "подписываем соглашение до старта", "да", "NDA"],
    ["Тип утепления", "внутреннее", "да"],
    ["Анонимность", "Лечение анонимно - строго конфиденциально", "да"],
    ["Плашка", "Строго конфиденциально", "да"],
    ["Гарантия", "NDA, договор, все конфиденциально", "да"],
    ["Оборот", "50 млн (не публикуем)", "закрыт"],
    ["Оборот", "50 млн, не публикуем", "закрыт"],
    ["Скидка", "20% - снято заказчиком", "закрыт"],
    // вторая повторная проверка: слово-пометка целым полем - пометка у подписи не о тайне, тема у подписи о ней
    ["Клиенты", "Под NDA", "закрыт"],
    ["Выручка", "Конфиденциально.", "закрыт"],
    ["Себестоимость", "Коммерческая тайна", "закрыт"],
    ["Анонимность", "Конфиденциально", "да"],
    ["Гарантии", "NDA", "да"],
    ["Коммерческая тайна", "Подписываем соглашение о неразглашении", "да"]
  ];
  for (const [l, v, w, art] of pairs) { const g = fr(l, v, art); if (g !== want[w]) bad.push(`factRec «${l}» = «${v}»${art ? ` [${art}]` : ""}: ${g}`); }
  return bad.length ? bad.join(" | ") : true;
});

// Сценарий «Чем грозит» проблемы 13 сквозь стык: документ 1 -> пустой лист -> гейт -> импорт текстов. Продающие факты
// о конфиденциальности (плашка «Строго конфиденциально», «Договор» - «NDA», «обязуемся не раскрывать») публикуются
// молчанием и не дают «конфликт:» в текстах; «Выручка» - «NDA» и «..., не публикуем» закрыты на обеих сторонах стыка.
step("сквозной путь K2 (повторная проверка №13): продающие факты о конфиденциальности публикуются молчанием и без конфликта в текстах, NDA вместо значения закрыт", () => {
  const set = { 7: ["Оборот", "50 млн в год, не публикуем"], 9: ["Плашка", "Строго конфиденциально"], 10: ["Договор", "NDA"],
    12: ["Юристы", "Обязуемся не раскрывать сведения о клиенте третьим лицам"], 13: ["Выручка", "NDA"] };
  const dir = readyProject("e2e-k2", { tweak: (s) => { for (const [i, [label, value]] of Object.entries(set)) { s.facts[i].label = label; s.facts[i].value = value; delete s.facts[i].artifact; } } });
  const html = text(doc(dir, DOC1));
  const rec = (id) => { const r = (html.match(new RegExp(`<td>${id}</td>[^\\n]*`)) || [""])[0]; return /да, публикуем/.test(r) ? "да" : /помечено как закрытое/.test(r) ? "закрыт" : `?${r.slice(0, 80)}`; };
  const want = { f08: "закрыт", f10: "да", f11: "да", f13: "да", f14: "закрыт" };
  const got = Object.fromEntries(Object.keys(want).map((id) => [id, rec(id)]));
  if (JSON.stringify(got) !== JSON.stringify(want)) return `документ 1: ${JSON.stringify(got)}`;
  sheet(dir, "answers.txt", "");
  if (applyAll(dir).code !== 0) return "лист не применился";
  const pub = Object.fromEntries(Object.keys(want).map((id) => [id, factOf(dir, id).publish]));
  if (JSON.stringify(pub) !== JSON.stringify({ f08: "no", f10: "yes", f11: "yes", f13: "yes", f14: "no" })) return `молчание: ${JSON.stringify(pub)}`;
  if (gateOf(dir).code !== 0) return "гейт не пройден";
  const kit = join(ROOT, ".claude/skills/site-tekst/kit");
  // Копия kit - в короткой временной папке: в глубокой worktree путь задачи текстов упирается в предел Windows.
  const tmp = mkdtempSync(join(tmpdir(), "k2-imp-"));
  try {
    const dest = join(tmp, "t");
    const init = spawnSync(process.execPath, ["scripts/init-project.mjs", "e2e-k2", dest, "--project", join(dir, "project.json")], { cwd: kit, encoding: "utf8" });
    if (init.status !== 0) return `init-project kit (чужой код, P2/P8): ${(init.stdout || "") + (init.stderr || "")}`.slice(0, 300);
    const imp = spawnSync(process.execPath, ["scripts/import-project.mjs"], { cwd: dest, encoding: "utf8" });
    if (imp.status !== 0) return `import-project kit (чужой код, P2): ${(imp.stdout || "") + (imp.stderr || "")}`.slice(0, 300);
    const fx = readJson(join(dest, "work", "facts.json"));
    const kp = Object.fromEntries(["F08", "F10", "F11", "F13", "F14"].map((id) => [id, (fx.facts.find((f) => f.id === id) || {}).publish]));
    if (JSON.stringify(kp) !== JSON.stringify({ F08: "no", F10: "yes", F11: "yes", F13: "yes", F14: "no" })) return `kit publish: ${JSON.stringify(kp)}`;
    const conf = (fx.gaps || []).filter((g) => /^конфликт:/.test(g));
    return conf.length ? `конфликты в текстах: ${conf.join(" | ")}` : true;
  } finally { softRm(tmp); }
});
// Вторая повторная проверка №13 (этап D): фразы проверяющего (пробник mine.mjs и остатки 4-5) по полям факта -
// документ 1 (factRec), анализ (heldMarked) и копия kit (HELD_MARK_COPY + HELD_NDA_FIELD_COPY) дают одно и то же.
// Ловит явные пометки, которые раньше уходили в публикацию: «(не публикуем на сайте)», «- не указываем», «[не
// публикуем]», «(не для печати)», «(скрыть)», «не разглашать», «120 млн - конфиденциально» (вернулось). Не ловит
// разрешение и обязанность любой формы («может не называть», «обязаны не раскрывать», через одно-три слова),
// пояснение слова среднего рода «(внутреннее)», слово-пометку целым полем у подписи о тайне, защите, гарантиях
// («Анонимность» - «Конфиденциально», «Гарантии» - «NDA») и подпись целым полем («Коммерческая тайна» у факта о
// соглашении). Спорные куски «Консультация: конфиденциально», «Фото пациентов - не публикуем», «Тиражи меньше 100
// штук - не печатаем» ловит намеренно: та же форма, что у пометки «Оборот 50 млн - не публикуем»; ошибка в
// безопасную сторону, документ 1 печатает «нет, помечено как закрытое», заказчик отвечает «да».
step("K2, вторая повторная проверка №13: явные пометки проверяющего ловятся, разрешения и пояснения - нет; анализ = kit", () => {
  const ip = text(join(ROOT, ".claude/skills/site-tekst/kit/scripts/import-project.mjs"));
  const litOf = (name) => { const m = ip.match(new RegExp(`^const ${name} = (\\/.+\\/[a-z]*);$`, "m")); return m ? new Function(`return ${m[1]}`)() : null; };
  const KH = litOf("HELD_MARK_COPY"), KN = litOf("HELD_NDA_FIELD_COPY");
  if (!(KH instanceof RegExp) || !(KN instanceof RegExp)) return "нет литералов HELD_MARK_COPY / HELD_NDA_FIELD_COPY в import-project.mjs";
  const kit = (label, value, art) => [label, value, art].some((x) => KH.test(String(x || "").trim().toLowerCase()))
    || [value, art].some((x) => KN.test(`${String(label || "").trim()}\n${String(x || "").trim()}`.toLowerCase()));
  // [подпись, значение, ждем: true - закрыт, false - публикуется]
  const rows = [
    ["Оборот", "50 млн (не публикуем на сайте)", true],
    ["Оборот", "50 млн - не публикуем на сайте", true],
    ["Оборот", "Не публикуем на сайте", true],
    ["Оборот", "Не публикуем, только для КП", true],
    ["Оборот", "50 млн [не публикуем]", true],
    ["Оборот", "50 млн (не для печати)", true],
    ["Себестоимость", "1200 руб (не показываем)", true],
    ["Адрес склада", "ул. Ленина 5 - не указываем", true],
    ["Выручка", "120 млн - конфиденциально", true],
    ["Выручка", "120 млн, конфиденциально", true],
    ["Выручка", "не разглашать", true],
    ["Оборот", "50 млн (скрыть)", true],
    ["Оборот", "50 млн (НЕ ПУБЛИКОВАТЬ)", true],
    ["Клиенты", "Сбер, ВТБ (под NDA)", true],
    ["Клиенты", "Сбер, ВТБ - под NDA", true],
    ["Клиенты", "Под NDA", true],
    ["Себестоимость", "Коммерческая тайна", true],
    ["Выручка", "Конфиденциально.", true],
    ["", "Конфиденциально", true],
    ["Цена закупки", "Возможно не публиковать", true],
    ["Клиенты", "Сбер, ВТБ (не называем)", true],
    ["Прием", "Консультация: конфиденциально", true],
    ["Фото пациентов", "Фото пациентов - не публикуем", true],
    ["Тиражи", "Тиражи меньше 100 штук - не печатаем", true],
    // строки реальных входов клиентов: пометка заказчика или оператора
    ["Роль", "- (не указывается)", true],
    ["Ограничение", "Ограничение (внутреннее): Татьяна делает работу сама", true],
    ["Утепление", "Утепление (внутреннее)", true],
    ["Анонимность", "Пациент может не называть свое имя", false],
    ["Анонимность", "Вы можете не указывать имя в отзыве", false],
    ["Тайна", "По закону обязаны не раскрывать данные клиентов", false],
    ["Тайна", "Обязуемся третьим лицам данные не раскрывать", false],
    ["Коммерческая тайна", "Подписываем соглашение о неразглашении", false],
    ["Анонимность", "Конфиденциально", false],
    ["Гарантии", "NDA", false],
    ["Защита идеи", "NDA", false],
    ["Безопасность данных", "Защита идеи: NDA", false],
    ["Виды утепления", "Фасадное (наружное), квартирное (внутреннее)", false],
    ["Освещение", "Светодиодное (внутреннее)", false],
    ["Отзывы", "Без согласия клиента не публикуем.", false],
    ["Отзывы", "Имена клиентов не указываем", false],
    ["Видео", "Снято заказчиком на телефон", false],
    ["Видео", "Ролик снят заказчиком", false],
    ["Партнерство", "Работаем с агентствами под NDA", false],
    ["Договор", "Договор и NDA", false],
    ["Анонимность", "Анонимно, конфиденциально.", false],
    ["Анонимность", "Лечение анонимно - конфиденциально", false],
    ["Данные", "Данные клиентов - не раскрываем", false],
    ["Обязательства", "Обязуемся никому и никогда не раскрывать данные", false],
    ["Итог", "Что делать - не показывает.", false],
    ["Правило", "Чего нет ниже - не называй.", false]
  ];
  const bad = [];
  for (const [label, value, want] of rows) {
    const f = { id: "f01", label, value, src: "бриф" };
    const a = C.heldMarked(f), k = kit(label, value, ""), rec = C.factRec(f, []).text;
    const wantRec = want ? "нет, помечено как закрытое" : "да, публикуем";
    if (a !== want || k !== want || rec !== wantRec) bad.push(`«${label}» = «${value}»: анализ ${a}, kit ${k}, документ 1 «${rec}», ждали ${want}`);
  }
  return bad.length ? bad.join(" | ") : true;
});

step("причины «чем отличаемся»: facts по схеме возражений - чужой id снимает сборка, несуществующий ловит проверка", () => {
  const dir = join(SANDBOX, "reasons-facts");
  seedParts(dir, (s) => { s.offer.reasons[0].facts = ["f15", "f77"]; });
  const r = run([BUILD_PROJECT, dir]);
  if (r.code === 2) return `сборка: ${bad2(r)}`;
  if (JSON.stringify(proj(dir).offer.reasons[0].facts) !== JSON.stringify(["f15"]) || !/f77/.test(r.all)) return `facts причины: ${JSON.stringify(proj(dir).offer.reasons[0])}`;
  const p = baseProject();
  p.offer.reasons[0].facts = ["f99"];
  const v = run([VERIFY, putProject("reasons-bad", p), "--seed", "--no-write"]);
  return v.code === 2 && /offer\.reasons\[0\]\.facts[^\n]*f99/.test(v.all) ? true : `exit ${v.code}: ссылка причины на несуществующий факт прошла`;
});

step("лист, примененный до программы 28.09: первый круг заново не разбирается, прочерк старого листа не публикует факт", () => {
  const dir = readyProject("legacy-sheet");
  const p = proj(dir);
  p.facts.forEach((f) => { f.publish = f.id === "f05" ? "no" : "yes"; });
  writeFileSync(join(dir, "project.json"), JSON.stringify(p, null, 2), "utf8");
  const q = readJson(join(dir, "queue.json"));
  delete q.answers;
  writeFileSync(join(dir, "queue.json"), JSON.stringify(q, null, 2), "utf8");
  sheet(dir, "answers.txt", "f05: -\n");
  sheet(dir, "answers-2.txt", "g1: 3900 руб за кв м\n");
  const w = applyAll(dir);
  if (w.code !== 0) return `запись: ${w.all}`;
  if (!/до программы 28\.09/.test(w.all)) return "старый лист не опознан";
  if (factOf(dir, "f05").publish !== "no") return "прочерк старого листа (тогда - «не публикуем») опубликовал факт";
  const marks = readJson(join(dir, "queue.json")).answers || [];
  if (!(marks.some((m) => m.file === "answers.txt" && m.legacy) && marks.some((m) => m.file === "answers-2.txt"))) return `отметки: ${JSON.stringify(marks)}`;
  // Пересборка возвращает старый лист в очередь с пометкой legacy: повтор разбирает его по прежним
  // правилам (прочерк - «не публикуем»), а не как первое применение нового листа.
  const r = run([BUILD_PROJECT, dir]);
  if (r.code === 2) return `пересборка: ${bad2(r)}`;
  const m2 = readJson(join(dir, "queue.json")).answers || [];
  if (!m2.some((m) => m.file === "answers.txt" && m.legacy && !m.sha)) return `после пересборки отметки: ${JSON.stringify(m2)}`;
  const w2 = applyAll(dir);
  if (!/answers\.txt \(лист до программы 28\.09/.test(w2.all)) return "старый лист после пересборки разобран как новый";
  return factOf(dir, "f05").publish === "no" ? true : "после пересборки прочерк старого листа опубликовал факт";
});

step("сквозной путь: пустой лист -> гейт -> импорт текстов дает опубликованные факты анализа, помеченный факт закрыт", () => {
  const dir = readyProject("e2e-import", { tweak: (s) => { s.facts[2].value = "9 лет на рынке (конфиденциально)"; } });
  sheet(dir, "answers.txt", "");
  if (applyAll(dir).code !== 0) return "лист не применился";
  if (gateOf(dir).code !== 0) return "гейт не пройден";
  const kit = join(ROOT, ".claude/skills/site-tekst/kit");
  // Копия kit - в короткой временной папке: в глубокой worktree путь задачи текстов упирается в предел Windows.
  const tmp = mkdtempSync(join(tmpdir(), "p1-imp-"));
  try {
    const dest = join(tmp, "t");
    const init = spawnSync(process.execPath, ["scripts/init-project.mjs", "e2e-import", dest, "--project", join(dir, "project.json")], { cwd: kit, encoding: "utf8" });
    if (init.status !== 0) return `init-project kit (чужой код, P2/P8): ${(init.stdout || "") + (init.stderr || "")}`.slice(0, 300);
    const imp = spawnSync(process.execPath, ["scripts/import-project.mjs"], { cwd: dest, encoding: "utf8" });
    if (imp.status !== 0) return `import-project kit (чужой код, P2): ${(imp.stdout || "") + (imp.stderr || "")}`.slice(0, 300);
    const kf = readJson(join(dest, "work", "facts.json")).facts;
    const yes = kf.filter((f) => /^F\d\d$/.test(f.id) && !/^F[89]/.test(f.id) && f.publish === "yes");
    if (yes.length < 10) return `опубликовано фактов анализа ${yes.length} - молчание обнулило фактуру`;
    const held = kf.find((f) => f.id === "F03");
    return held && held.publish !== "yes" ? true : `помеченный «(конфиденциально)» факт ушел в тексты опубликованным: ${JSON.stringify(held)}`;
  } finally { softRm(tmp); }
});

// Стык K11 (интеграция, этап B): строки «Факты оператора: перенести в анализ» печатает report.mjs kit (P4), разбирает
// apply-answers анализа (P1), F8NN с moved_from снимает импорт текстов (P2). Строки берутся из настоящего отчета, а не литералом.
step("стык K11: строки отчета текстов -> новый круг листа -> гейт -> --facts-only снимает F8NN оператора, факты анализа на их месте", () => {
  const dir = readyProject("k11-seam");
  sheet(dir, "answers.txt", "");
  if (applyAll(dir).code !== 0) return "первый лист не применился";
  if (gateOf(dir).code !== 0) return "первый гейт не пройден";
  const kit = join(ROOT, ".claude/skills/site-tekst/kit");
  const tmp = mkdtempSync(join(tmpdir(), "k11-"));
  const node = (cwd, args) => { const r = spawnSync(process.execPath, args, { cwd, encoding: "utf8" }); return { code: r.status, all: (r.stdout || "") + (r.stderr || "") }; };
  try {
    const dest = join(tmp, "t");
    const init = node(kit, ["scripts/init-project.mjs", "k11-seam", dest, "--project", join(dir, "project.json")]);
    if (init.code !== 0) return `init-project kit: ${init.all.slice(0, 300)}`;
    const imp = node(dest, ["scripts/import-project.mjs"]);
    if (imp.code !== 0) return `import-project kit: ${imp.all.slice(0, 300)}`;
    // факты оператора: метка с «=» и «:», значение с «:», у второго фразы нет (строка без « << »)
    const ffPath = join(dest, "work", "facts.json");
    const ff = readJson(ffPath);
    ff.facts.push({ id: "F801", label: "Скидка = постоянным", value: "10%", wording: "скидка постоянным 10%", publish: "yes", kind: "number", source_quote: "постоянным даем скидку 10 процентов", source: "оператор: письмо заказчика" });
    ff.facts.push({ id: "F802", label: "Время работы: будни", value: "пн-пт: 9-18", wording: "по будням с 9 до 18", publish: "yes", kind: "claim", source_quote: "", source: "оператор: звонок" });
    writeFileSync(ffPath, JSON.stringify(ff, null, 2) + "\n", "utf8");
    // карта задачи (ее кладет import-structure; отчету нужна хотя бы одна страница)
    writeFileSync(join(dest, "work", "sitemap.json"), JSON.stringify({ pages: [{ slug: "home", url: "/", type: "home", subject: "Главная", parent: "", level: 0, segment: "s1", status: "briefed" }] }), "utf8");
    const rep = node(dest, ["scripts/report.mjs"]);
    if (rep.code !== 0) return `report.mjs: ${rep.all.slice(-400)}`;
    const md = text(join(dest, "work", "output", "report.md"));
    const block = (md.match(/### Факты оператора: перенести в анализ[\s\S]*?```text\n([\s\S]*?)\n```/) || [])[1] || "";
    if (block.split("\n").length !== 2) return `в отчете нет двух строк K11: ${block || md.slice(0, 200)}`;
    // по подсказке отчета: письмо заказчика с фразой - во вход анализа, строки - новым кругом answers-2.txt
    writeFileSync(join(dir, "input", "letter.txt"), "Письмо заказчика: постоянным даем скидку 10 процентов от прайса.\n", "utf8");
    sheet(dir, "answers-2.txt", block + "\n");
    const w = applyAll(dir);
    if (w.code !== 0 || /НЕ РАЗОБРАНО/.test(w.all)) return `круг 2: ${w.all.slice(0, 400)}`;
    const p = proj(dir);
    const f1 = p.facts.find((f) => f.moved_from === "F801"), f2 = p.facts.find((f) => f.moved_from === "F802");
    if (!f1 || f1.label !== "Скидка - постоянным" || f1.value !== "10%" || f1.publish !== "yes") return `F801 в анализе: ${JSON.stringify(f1)}`;
    if (!f2 || f2.label !== "Время работы: будни" || f2.value !== "пн-пт: 9-18") return `F802 в анализе: ${JSON.stringify(f2)}`;
    const q1 = srcOf(dir, f1.id)[0];
    if (!q1 || !/постоянным даем скидку 10 процентов/.test(q1.quote) || !/input\/letter\.txt/.test(String(q1.where || ""))) return `цитата F801 не из входа: ${JSON.stringify(q1)}`;
    if (gateOf(dir).code !== 0) return "гейт после круга 2 не пройден";
    const fo = node(dest, ["scripts/import-project.mjs", "--facts-only"]);
    if (fo.code !== 0) return `--facts-only: ${fo.all.slice(0, 300)}`;
    const kf = readJson(ffPath).facts;
    const up = (id) => "F" + id.slice(1);
    if (kf.some((f) => /^F80[12]$/.test(f.id))) return `F8NN оператора остались рядом с фактами анализа: ${kf.filter((f) => /^F8/.test(f.id)).map((f) => f.id).join(", ")}`;
    const k1 = kf.find((f) => f.id === up(f1.id)), k2 = kf.find((f) => f.id === up(f2.id));
    return k1 && k2 && k1.publish === "yes" && k2.publish === "yes" ? true : `факты анализа ${up(f1.id)}, ${up(f2.id)} в тексты не пришли опубликованными: ${JSON.stringify([k1, k2])}`;
  } finally { softRm(tmp); }
});

// ── доработка P1 по рецензии: отрицания и несогласие, круг после гейта, сверка чисел ──
const Q = await import(pathToFileURL(QUEUE).href);

step("отрицания d7-d8 по частям фразы, несогласие у d1-d6: сомнение - «не разобрано», а не выбор или значение", () => {
  const p = baseProject();
  const got = (key, ans) => {
    const d = C.DECISIONS.find((x) => x.key === key);
    const r = C.parseDecision(clone(p), d, ans);
    return r.op === "set" ? `set:${Array.isArray(r.value) ? "list" : r.value}` : r.op;
  };
  const table = [
    ["d7", "лендинг нам точно не нужен", "drop"], ["d7", "одностраничный сайт нам не нужен", "drop"], ["d7", "мы против лендинга", "drop"],
    ["d7", "лендинг? нет", "drop"], ["d7", "лендинг - нет", "drop"], ["d7", "лендинг нам совсем не нужен", "drop"], ["d7", "нет, делаем многостраничный", "drop"],
    ["d7", "не лендинг, а многостраничный", "set:multipage"], ["d7", "многостраничный - не лендинг", "set:multipage"],
    ["d8", "магазин нам пока не нужен", "drop"], ["d8", "товары нам совсем не нужны", "drop"], ["d8", "мы против магазина", "drop"],
    ["d8", "каталог товаров пока не делаем, только услуги", "set:services"], ["d8", "не продаете товары из каталога, продаете услуги", "set:services"],
    ["d8", "услуги, но не только", "drop"], ["d8", "не только услуги, но и товары", "drop"], ["d8", "продаете и товары, и услуги", "set:both"],
    ["d1", "не согласен", "drop"], ["d1", "неправильно", "drop"], ["d1", "не совсем", "drop"], ["d1", "не так", "drop"],
    ["d1", "согласен, но уберите слово мастерская", "drop"], ["d1", "подходит", "accept"], ["d1", "согласен", "accept"],
    ["d1", "не только ремонт, но и дизайн", "set:не только ремонт, но и дизайн"], ["d4", "не выезжаем за КАД; не работаем с юрлицами", "set:list"],
    ["d6", "не согласен", "drop"], ["d6", "неверно", "drop"], ["d6", "против", "drop"], ["d6", "нет", "set:false"]
  ];
  const bad = table.filter(([k, a, want]) => got(k, a) !== want).map(([k, a, want]) => `${k} «${a}»: ${got(k, a)}, ждали ${want}`);
  const facts = [["не согласен", "drop"], ["уберите это", "drop"], ["нельзя", "drop"], ["неправильно", "drop"], ["не дороже рынка", "drop"],
    ["согласен, но 24 месяца", "drop"], ["не надо публиковать", "refuse"], ["не указывать", "refuse"], ["не показывать", "refuse"],
    ["не публикуйте", "refuse"], ["удалить", "refuse"], ["подходит", "accept"], ["согласен", "accept"],
    ["не более 12 месяцев", "set"], ["нет предоплаты", "set"], ["без выезда", "set"]];
  for (const [a, op] of facts) { const g = C.parseFactAnswer(a).op; if (g !== op) bad.push(`факт «${a}»: ${g}, ждали ${op}`); }
  return bad.length ? bad.join(" | ") : true;
});

// Доделка №2 (этап D): соседние живые формулировки. Согласие с оговоркой - то же слово согласия, что
// у isOk; подтверждение своими словами без своей формулировки - подтверждение; отрицание, слитое со
// словом; двойное отрицание «без цен никак»; глаголы цен с отрицанием рядом; строки фактов.
step("доделка №2: «все так, добавьте ...» и «хорошо, но ...» - оговорка; «абсолютно верно» - подтверждение; «лендинг неактуален» - не лендинг; «без цен никак» - цены", () => {
  const p = baseProject();
  p.offer.limits = ["не работаем с нежилым фондом", "не делаем перепланировку", "не выезжаем за КАД", "не даем скидок",
    "не работаем без договора", "не берем предоплату 100%", "не работаем в выходные", "не гарантируем сроки при изменении проекта"];
  p.offer.tone = "спокойно, на вы, без пафоса";
  const got = (key, ans) => {
    const d = C.DECISIONS.find((x) => x.key === key);
    const r = C.parseDecision(clone(p), d, ans);
    return r.op === "set" ? `set:${Array.isArray(r.value) ? "list" : r.value}` : r.op;
  };
  // want: точное значение либо "!set" - любое, кроме нового значения
  const table = [
    // согласие с оговоркой (то же слово согласия, что у isOk)
    ["d4", "Вс\u0451 так, добавьте: не работаем за КАД", "drop"], ["d4", "Все так кроме пункта 3", "drop"], ["d4", "Согласны, кроме пункта про предоплату", "drop"],
    ["d1", "Вс\u0451 так, но добавьте «с 2012 года»", "drop"], ["d1", "Все правильно, только без слова бригада", "drop"], ["d1", "Вс\u0451 ок, но лучше «мастерская»", "drop"],
    ["d1", "Хорошо, но уберите слово «бригада»", "drop"], ["d3", "Да, «Рассчитать смету»", "drop"],
    // подтверждение своими словами
    ["d1", "Совершенно верно", "accept"], ["d1", "Абсолютно верно", "accept"], ["d1", "Подтверждаю формулировку", "accept"], ["d1", "Согласен с формулировкой", "accept"],
    ["d1", "Именно так", "accept"], ["d1", "Да, именно так", "accept"], ["d1", "Конечно", "accept"], ["d1", "Верно указано", "accept"], ["d1", "Нас вс\u0451 устраивает", "accept"],
    ["d5", "Тон подходит", "accept"], ["d5", "Тон нас устраивает", "accept"],
    ["d1", "В целом верно", "drop"], ["d1", "В целом да", "drop"], ["d5", "Тон нас не устраивает", "drop"],
    // настоящие формулировки остаются значениями
    ["d1", "Правильно подобранная бригада под ваш объект", "set:Правильно подобранная бригада под ваш объект"], ["d1", "Да Винчи ремонта", "set:Да Винчи ремонта"],
    ["d1", "Не просто бригада, а подрядчик полного цикла", "set:Не просто бригада, а подрядчик полного цикла"], ["d1", "Верный выбор для вторички", "set:Верный выбор для вторички"],
    ["d1", "Точно в срок и по смете", "set:Точно в срок и по смете"], ["d3", "Оставить заявку", "set:Оставить заявку"], ["d5", "Дружелюбно, на ты", "set:Дружелюбно, на ты"],
    // отрицание, слитое со словом, и чужой продавец
    ["d7", "Лендинг неактуален", "drop"], ["d7", "Лендинг нецелесообразен", "drop"], ["d7", "Лендинг устарел, делаем каталог", "drop"],
    ["d7", "Лендинг - уже неактуально, делаем сайт под поиск", "set:multipage"], ["d7", "Лендинг? Нет, многостраничный", "set:multipage"], ["d7", "Сео не нужно, делаем лендинг", "set:landing"],
    ["d8", "Магазин неактуален, только услуги", "set:services"], ["d8", "Услуги, а товары продают партнеры", "set:services"], ["d8", "Обе вещи", "set:both"],
    // цены: глаголы с отрицанием рядом, двойное отрицание, подлежащее с «да» или «нет»
    ["d6", "Печатаем цены", "set:true"], ["d6", "Показываем цены", "set:true"], ["d6", "Публикуем цены", "set:true"], ["d6", "Цены публикуем", "set:true"],
    ["d6", "Открываем цены", "set:true"], ["d6", "Прайс публикуем", "set:true"], ["d6", "Цены не скрываем", "set:true"], ["d6", "Хотим показывать цены", "set:true"],
    ["d6", "Цены - да", "set:true"], ["d6", "Цены нет", "set:false"],
    ["d6", "Без цен никак, клиенты спрашивают", "set:true"], ["d6", "Без цен не обойтись", "set:true"], ["d6", "Не можем без цен", "set:true"], ["d6", "Сайт без цен нам не нужен", "set:true"],
    ["d6", "Без цен", "set:false"], ["d6", "Нет без цен", "set:false"], ["d6", "Не публиковать", "set:false"], ["d6", "Нет смысла публиковать цены", "set:false"],
    ["d6", "Показывать цены не будем", "set:false"], ["d6", "Цены на сайте не нужны", "set:false"], ["d6", "Цены лучше не показывать", "set:false"], ["d6", "Цены скрываем", "set:false"],
    ["d6", "Показываем цены без НДС", "set:true"], ["d6", "Цены не скрываем, но и не печатаем", "drop"]
  ];
  const bad = table.filter(([k, a, want]) => got(k, a) !== want).map(([k, a, want]) => `${k} «${a}»: ${got(k, a)}, ждали ${want}`);
  // Строки фактов: то же правило согласия и подтверждения; вводное «лучше» перед отказом.
  const facts = [["Можно публиковать", "accept"], ["Публикуйте", "accept"], ["Печатайте", "accept"], ["Да, можно", "accept"], ["Ок, публикуем", "accept"],
    ["Абсолютно верно", "accept"], ["Конечно", "accept"], ["Оставьте", "accept"], ["Лучше не публиковать", "refuse"], ["Не стоит", "refuse"],
    ["Не стоит публиковать", "refuse"], ["Давайте уберем", "refuse"], ["Вс\u0451 так, но 140 объектов", "drop"], ["Хорошо, но 24 месяца", "drop"],
    ["В целом верно", "drop"], ["Не совсем верно", "drop"], ["Лучше не указывать точную цифру", "drop"], ["140 объектов", "set"], ["Точно в срок", "set"]];
  for (const [a, op] of facts) { const g = C.parseFactAnswer(a).op; if (g !== op) bad.push(`факт «${a}»: ${g}, ждали ${op}`); }
  if (bad.length) return bad.join(" | ");
  // Сквозной прогон: поле не меняется, тип сайта не переворачивается, гейт ждет правки по d4 и d7.
  const dir = readyProject("dofix-2", { tweak: (s) => { s.offer.limits = p.offer.limits.slice(); s.offer.tone = p.offer.tone; } });
  const before = proj(dir);
  sheet(dir, "answers.txt", "d1: Абсолютно верно\nd4: Вс\u0451 так, добавьте: не работаем за КАД\nd5: Тон подходит\nd6: Без цен никак, клиенты спрашивают\nd7: Лендинг неактуален\nd8: Магазин неактуален, только услуги\nf01: Можно публиковать\nf02: Лучше не публиковать\n");
  const w = applyAll(dir);
  if (w.code !== 0) return `запись: ${w.all.slice(0, 300)}`;
  const after = proj(dir);
  if (after.offer.positioning !== before.offer.positioning) return `«абсолютно верно» стало позиционированием: ${after.offer.positioning}`;
  if (JSON.stringify(after.offer.limits) !== JSON.stringify(before.offer.limits)) return `«все так, добавьте» переписало границы: ${JSON.stringify(after.offer.limits)}`;
  if (after.offer.tone !== before.offer.tone) return `«тон подходит» стал тоном: ${after.offer.tone}`;
  if (!(after.business.sig || []).includes("price_open")) return "«без цен никак» не открыло цены";
  if (after.business.site_kind !== "multipage" || after.business.type !== "services") return `тип сайта ${after.business.site_kind}, продаем ${after.business.type}`;
  const f1 = after.facts.find((f) => f.id === "f01"), f2 = after.facts.find((f) => f.id === "f02");
  if (f1.publish !== "yes" || f1.value !== before.facts.find((f) => f.id === "f01").value) return `«можно публиковать» по факту: ${JSON.stringify(f1)}`;
  if (f2.publish !== "no" || /лучше/i.test(f2.value)) return `«лучше не публиковать» по факту: ${JSON.stringify(f2)}`;
  if (!/d1: «Абсолютно верно» -> подтверждение/.test(w.all)) return "дифф-лист не печатает «понят как» для «абсолютно верно»";
  const g = gateOf(dir);
  return g.code === 2 && /не разобраны ответы по[^\n]*d4/.test(g.all) && /d7/.test(g.all) ? true : `гейт при «не разобрано» по d4 и d7: exit ${g.code}`;
});

// Повторная проверка №2 (этап D): все фразы проверяющего (t.mjs - 122 фразы d1-d8, t2.mjs - строки фактов и d6) с
// ожидаемым ключом, плюс соседние формулировки исполнителя: сомнение и отрицание через слово у цен, «потом» и «по
// запросу», чужой продавец, слитое отрицание, «со всеми пунктами», «менять не надо», хвост после «можно» и «публикуйте».
step("повторная проверка №2: каждая фраза проверяющего и соседние формулировки разбираются в свой ключ", () => {
  const p = baseProject();
  const fmt = (r) => (r.op === "set" ? `set:${Array.isArray(r.value) ? "[" + r.value.join(" | ") + "]" : r.value}` : r.op);
  const got = (key, ans) => fmt(C.parseDecision(clone(p), C.DECISIONS.find((x) => x.key === key), ans));
  const table = [
    ["d1", "Да, вс\u0451 верно", "accept"],
    ["d1", "Вс\u0451 верно, спасибо", "accept"],
    ["d1", "Да все верно", "accept"],
    ["d1", "Абсолютно верно", "accept"],
    ["d1", "Совершенно верно", "accept"],
    ["d1", "Согласен с формулировкой", "accept"],
    ["d1", "Подтверждаю формулировку", "accept"],
    ["d1", "Подтверждаем", "accept"],
    ["d1", "В целом да", "drop"],
    ["d1", "В целом верно", "drop"],
    ["d1", "Конечно", "accept"],
    ["d1", "Именно так", "accept"],
    ["d1", "Да, именно так", "accept"],
    ["d1", "Верно указано", "accept"],
    ["d1", "Вс\u0451 так", "accept"],
    ["d1", "Нас вс\u0451 устраивает", "accept"],
    ["d1", "Устраивает", "accept"],
    ["d1", "Хорошо, но уберите слово «бригада»", "drop"],
    ["d1", "Вс\u0451 так, но добавьте «с 2012 года»", "drop"],
    ["d1", "Все правильно, только без слова бригада", "drop"],
    ["d1", "Вс\u0451 ок, но лучше «мастерская»", "drop"],
    ["d1", "ОК", "drop"],
    ["d1", "Да.", "drop"],
    ["d1", "Семейная мастерская ремонта с 2012 года", "set:Семейная мастерская ремонта с 2012 года"],
    ["d1", "Правильно подобранная бригада под ваш объект", "set:Правильно подобранная бригада под ваш объект"],
    ["d1", "Не просто бригада, а подрядчик полного цикла", "set:Не просто бригада, а подрядчик полного цикла"],
    ["d1", "Да Винчи ремонта", "set:Да Винчи ремонта"],
    ["d1", "Нет пафоса - просто хорошие мастера", "set:Нет пафоса - просто хорошие мастера"],
    ["d1", "Верный выбор для вторички", "set:Верный выбор для вторички"],
    ["d1", "Все работы под ключ одной бригадой", "set:Все работы под ключ одной бригадой"],
    ["d1", "Так строим мы: прораб, смета, график", "set:Так строим мы: прораб, смета, график"],
    ["d3", "Да", "drop"],
    ["d3", "Оставить заявку", "set:Оставить заявку"],
    ["d3", "Записаться на замер", "set:Записаться на замер"],
    ["d3", "Получить смету", "set:Получить смету"],
    ["d3", "Как есть", "accept"],
    ["d3", "Верно", "accept"],
    ["d3", "Согласовано", "accept"],
    ["d3", "Нет, лучше «Вызвать замерщика»", "drop"],
    ["d3", "Да, «Рассчитать смету»", "drop"],
    ["d3", "Подходит", "accept"],
    ["d4", "Согласны", "accept"],
    ["d4", "Со всем согласны", "accept"],
    ["d4", "Вс\u0451 так, добавьте: не работаем за КАД", "drop"],
    ["d4", "Все верно, но добавьте пункт про выходные", "drop"],
    ["d4", "Не работаем с нежилым фондом; не делаем перепланировку", "set:[Не работаем с нежилым фондом | не делаем перепланировку]"],
    ["d4", "Согласны, кроме пункта про предоплату", "drop"],
    ["d4", "Все так кроме пункта 3", "drop"],
    ["d5", "Нормально", "drop"],
    ["d5", "Дружелюбно, на ты", "set:Дружелюбно, на ты"],
    ["d5", "Вс\u0451 отлично", "accept"],
    ["d5", "Тон подходит", "accept"],
    ["d5", "Тон нас устраивает", "accept"],
    ["d6", "Давайте без цен", "set:false"],
    ["d6", "Цены не публикуем", "set:false"],
    ["d6", "Цены только по запросу", "set:false"],
    ["d6", "Нет, цены закрыты", "set:false"],
    ["d6", "Цены скрываем", "set:false"],
    ["d6", "Цены лучше не показывать", "set:false"],
    ["d6", "Да, цены показываем", "set:true"],
    ["d6", "Печатаем цены", "set:true"],
    ["d6", "Показываем цены", "set:true"],
    ["d6", "Да, публикуем прайс", "set:true"],
    ["d6", "Цены открыты", "set:true"],
    ["d6", "Не скрываем цены", "set:true"],
    ["d6", "Без цен никак, клиенты спрашивают", "set:true"],
    ["d6", "Сайт без цен нам не нужен", "set:true"],
    ["d6", "Цены на сайте не нужны", "set:false"],
    ["d6", "Нет смысла публиковать цены", "set:false"],
    ["d6", "Верно", "accept"],
    ["d6", "ок", "accept"],
    ["d6", "Да, но только цены «от»", "drop"],
    ["d6", "Публикуем только цены «от»", "set:true"],
    ["d7", "Нам не нужен лендинг", "drop"],
    ["d7", "Лендинг не нужен, нужен многостраничный сайт", "set:multipage"],
    ["d7", "Делаем многостраничник", "set:multipage"],
    ["d7", "Одностраничник", "set:landing"],
    ["d7", "Пока одну страницу, потом расширим", "set:landing"],
    ["d7", "Одна страница - это не наш вариант", "drop"],
    ["d7", "Лендинг неактуален", "drop"],
    ["d7", "Лендинг - уже неактуально, делаем сайт под поиск", "set:multipage"],
    ["d7", "Лендинг нецелесообразен", "drop"],
    ["d7", "Отказываемся от лендинга", "drop"],
    ["d7", "Лендинг нам ни к чему", "drop"],
    ["d7", "Вместо лендинга делаем многостраничный", "drop"],
    ["d7", "Хотим лендинг, без многостраничника", "set:landing"],
    ["d7", "Сео не нужно, делаем лендинг", "set:landing"],
    ["d7", "Многостраничный не потянем, пока лендинг", "set:landing"],
    ["d7", "Лендинг? Нет, многостраничный", "set:multipage"],
    ["d7", "Да", "accept"],
    ["d7", "Нет", "drop"],
    ["d7", "Нужен полноценный сайт", "drop"],
    ["d7", "Многостраничный \u2014 да", "set:multipage"],
    ["d7", "Хватит и одностраничного", "set:landing"],
    ["d7", "Лендинг устарел, делаем каталог", "drop"],
    ["d7", "Лендинга нам будет недостаточно", "drop"],
    ["d7", "Лендинга мало", "drop"],
    ["d7", "Одностраничный сайт не рассматриваем", "drop"],
    ["d8", "Не магазин, только услуги", "set:services"],
    ["d8", "Продаете и товары, и услуги", "set:both"],
    ["d8", "И товары, и услуги", "set:both"],
    ["d8", "Оба варианта", "set:both"],
    ["d8", "Только услуги", "set:services"],
    ["d8", "Услуги (товаров нет)", "set:services"],
    ["d8", "Не магазин, а сервис", "set:services"],
    ["d8", "Не услуги, а магазин", "set:shop"],
    ["d8", "Интернет-магазин", "set:shop"],
    ["d8", "Товаров у нас нет", "drop"],
    ["d8", "Магазин не нужен", "drop"],
    ["d8", "Магазин неактуален, только услуги", "set:services"],
    ["d8", "Товары не прода\u0451м", "drop"],
    ["d8", "Нет, магазин", "drop"],
    ["d8", "Работы и материалы", "set:services"],
    ["d8", "Продаем окна и монтируем их", "drop"],
    ["d8", "Магазина нет и не будет, только ремонт", "drop"],
    ["d8", "Услуги, а товары продают партнеры", "set:services"],
    ["d8", "Мы прода\u0451м услуги", "set:services"],
    ["d8", "Прода\u0451м товары из каталога", "set:shop"],
    ["d8", "Оба", "set:both"],
    ["d8", "Обе вещи", "set:both"],
    ["d8", "Все верно", "accept"],
    ["d8", "Работаем с оборудованием", "drop"],
    ["d6", "Печатаем", "set:true"],
    ["d6", "Показываем", "set:true"],
    ["d6", "Публикуем цены", "set:true"],
    ["d6", "Печатаем цены на всех страницах", "set:true"],
    ["d6", "Да, печатаем цены", "set:true"],
    ["d6", "Открываем цены", "set:true"],
    ["d6", "Цены публикуем", "set:true"],
    ["d6", "Цены печатаем", "set:true"],
    ["d6", "Цены показываем", "set:true"],
    ["d6", "Цены да", "set:true"],
    ["d6", "Цены - да", "set:true"],
    ["d6", "Цены - нет", "set:false"],
    ["d6", "Цены нет", "set:false"],
    ["d6", "Без цен", "set:false"],
    ["d6", "Нет", "set:false"],
    ["d6", "Без цен не обойтись", "set:true"],
    ["d6", "Не можем без цен", "set:true"],
    ["d6", "Цены не нужны", "set:false"],
    ["d6", "Не публиковать", "set:false"],
    ["d6", "не печатаем", "set:false"],
    ["d6", "да, все верно", "accept"],
    ["d6", "Показывать цены не будем", "set:false"],
    ["d6", "Цены показывать не будем", "set:false"],
    ["d6", "Прайс не публикуем", "set:false"],
    ["d6", "Прайс публикуем", "set:true"],
    ["d6", "Цены не скрываем", "set:true"],
    ["d6", "Хотим показывать цены", "set:true"],
    ["d6", "Пока не решили, печатать ли цены", "drop"],
    ["d6", "Не знаем, печатать ли цены", "drop"],
    ["d6", "Возможно, позже", "drop"],
    ["d6", "Может быть", "drop"],
    ["d6", "Не надо их печатать", "set:false"],
    ["d6", "Не надо цены печатать", "set:false"],
    ["d6", "Цены печатать не надо", "set:false"],
    ["d6", "Не хотим показывать цены", "set:false"],
    ["d6", "Показываем цены по запросу", "set:false"],
    ["d6", "Не печатаем, а показываем по запросу", "set:false"],
    ["d6", "Цены пока не публикуем, потом откроем", "set:false"],
    ["d6", "Сначала без цен, потом добавим", "set:false"],
    ["d6", "Прайс выкладывать не будем", "set:false"],
    ["d6", "Скрыть цены", "set:false"],
    ["d6", "Закрыто", "set:false"],
    ["d6", "Пишем цены", "set:true"],
    ["d6", "Укажем цены «от»", "set:true"],
    ["d6", "Нет, печатаем цены", "set:true"],
    ["d6", "Цены показываем, но только «от»", "set:true"],
    ["d7", "Лендинг уже неактуален, нужен многостраничный", "set:multipage"],
    ["d7", "Многостраничный неактуален, делаем лендинг", "set:landing"],
    ["d7", "Лендинг ненужен", "drop"],
    ["d7", "Лендинг неуместен", "drop"],
    ["d7", "Многостраничный, без лендинга", "set:multipage"],
    ["d8", "Услуги, товары у партнеров", "set:services"],
    ["d8", "Только услуги, товары через партнеров", "set:services"],
    ["d8", "Товары продаем через партнеров", "drop"],
    ["d8", "Мы оказываем услуги а товары продают партнеры", "drop"],
    ["d8", "Магазин устарел", "drop"],
    ["d8", "Каталог устарел, только услуги", "set:services"],
    ["d4", "Согласны со всеми пунктами", "accept"],
    ["d4", "Со всеми пунктами согласны", "accept"],
    ["d1", "Согласны с предложением", "accept"],
    ["d1", "Подтверждаю все пункты", "accept"],
    ["d1", "Все пункты верны", "accept"],
    ["d1", "Да, конечно", "accept"],
    ["d1", "Абсолютно", "accept"],
    ["d1", "Пусть будет так", "accept"],
    ["d1", "Оставьте как было", "accept"],
    ["d1", "Все верно, менять не надо", "accept"],
    ["d1", "Не надо менять, все верно", "accept"],
    ["d5", "Вполне", "accept"],
    ["d1", "Верно не все", "drop"],
    ["d1", "Точно не так", "drop"],
    ["d1", "Почти так", "drop"],
    ["d1", "Скорее верно", "drop"],
    ["d1", "Частично верно", "drop"],
    ["d1", "Правильно, когда прораб на объекте каждый день", "drop"],
    ["d1", "Верный подход к ремонту", "set:Верный подход к ремонту"],
    ["d1", "Конечный результат важнее", "set:Конечный результат важнее"],
    ["d1", "Подтвержденный опыт 12 лет", "set:Подтвержденный опыт 12 лет"],
    ["d5", "Вполне дружелюбно", "set:Вполне дружелюбно"],
    ["d1", "Точно в срок и по смете", "set:Точно в срок и по смете"],
    ["d1", "Конечно нет", "drop"],
    ["d6", "Конечно нет", "drop"],
    ["d7", "Конечно нет", "drop"],
    ["d7", "Конечно, лендинг", "set:landing"],
    ["d1", "Конечно, мастерская с 2012 года", "drop"]
  ];
  const bad = table.filter(([k, a, want]) => got(k, a) !== want).map(([k, a, want]) => `${k} «${a}»: ${got(k, a)}, ждали ${want}`);
  const facts = [
    ["да", "accept"],
    ["Да, вс\u0451 так", "accept"],
    ["Вс\u0451 верно", "accept"],
    ["Верно", "accept"],
    ["Подтверждаю", "accept"],
    ["Абсолютно верно", "accept"],
    ["Можно публиковать", "accept"],
    ["Публикуйте", "accept"],
    ["Да, можно", "accept"],
    ["Ок, публикуем", "accept"],
    ["Конечно", "accept"],
    ["Согласны", "accept"],
    ["Да, публикуем", "accept"],
    ["Публикуем", "accept"],
    ["Печатайте", "accept"],
    ["Оставляем", "accept"],
    ["Оставьте", "accept"],
    ["нет", "refuse"],
    ["Не публикуем", "refuse"],
    ["Не надо", "refuse"],
    ["Лучше не публиковать", "refuse"],
    ["Не стоит", "refuse"],
    ["Уберите", "refuse"],
    ["Нет, не надо", "refuse"],
    ["24 месяца", "set:24 месяца"],
    ["с 2011 года", "set:с 2011 года"],
    ["нет предоплаты", "set:нет предоплаты"],
    ["Вс\u0451 так, но гарантия 24 месяца", "drop"],
    ["Хорошо, но 24 месяца", "drop"],
    ["не знаю", "drop"],
    ["-", "silence"],
    ["Можно, но без цифры", "drop"],
    ["Можно, только без фамилии", "drop"],
    ["Публикуем без цифры", "drop"],
    ["Публикуйте как есть", "accept"],
    ["Печатайте как есть", "accept"],
    ["Оставьте как было", "accept"],
    ["Конечно, публикуйте", "accept"],
    ["Абсолютно верно, публикуйте", "accept"],
    ["Публикуем, все верно", "accept"],
    ["Согласны со всеми пунктами", "accept"],
    ["Можно в рассрочку", "set:Можно в рассрочку"],
    ["Печатаем визитки за 1 день", "set:Печатаем визитки за 1 день"],
    ["Устарело", "drop"],
    ["Уже неактуально, сейчас 24 месяца", "drop"],
    ["Убрать совсем", "drop"],
    ["Нет, лучше не публиковать", "refuse"],
    ["Опубликуйте", "accept"],
    ["Опубликуйте как есть", "accept"],
    ["Опубликуйте без цифры", "drop"],
    ["Конечно нет", "drop"],
    ["Вс\u0451 так, но 140 объектов", "drop"]
  ];
  for (const [a, want] of facts) { const g = fmt(C.parseFactAnswer(a)); if (g !== want) bad.push(`факт «${a}»: ${g}, ждали ${want}`); }
  // d10 (реквизиты) держит то же правило подтверждения: «конечно», «оставьте как было» - не правка
  for (const a of ["Конечно", "Оставьте как было", "Пусть будет так", "Абсолютно верно"]) if (!C.parseLegalAnswer({ phone: "+7 900 000-00-00" }, a).accept) bad.push(`d10 «${a}»: не подтверждение`);
  return bad.length ? bad.join(" | ") : true;
});
// Вторая повторная проверка №2 (этап D): фразы проверяющего (mine.mjs, more.mjs, остатки 1-3 и регрессии) с ожидаемым
// ключом, плюс соседние формулировки. Регрессии: второе отрицание у «без цен» - только в своем куске («без цен так как
// цены не фиксированные» - отказ, а не цены), «без лишних страниц» - уточнение, а не отказ от лендинга, «продаем товары
// партнеров» - товары. Остатки: подтверждение с подлежащим впереди и оговоркой следом («все пункты верны, кроме 8») и
// правка списка («пункт 8 убрать», «плюс ...») - не разобрано, а не список из одной строки; принятие факта своими словами
// («можно показывать», «разрешаем») - принятие, с оговоркой («можно публиковать без цифры», «без цифры») - не разобрано.
step("вторая повторная проверка №2: подтверждение с оговоркой, правка списка, «без цен» в своем куске, уточнение «без лишних», чужой продавец, принятие факта своими словами", () => {
  const p = baseProject();
  p.offer.limits = ["не работаем с нежилым фондом", "не делаем перепланировку", "не выезжаем за КАД", "не даем скидок",
    "не работаем без договора", "не берем предоплату 100%", "не работаем в выходные", "не гарантируем сроки при изменении проекта"];
  const fmt = (r) => (r.op === "set" ? `set:${Array.isArray(r.value) ? "[" + r.value.join(" | ") + "]" : r.value}` : r.op);
  const got = (key, ans) => fmt(C.parseDecision(clone(p), C.DECISIONS.find((x) => x.key === key), ans));
  const table = [
    // d6: второе отрицание - в своем куске и при своем слове
    ["d6", "Без цен так как цены не фиксированные", "set:false"],
    ["d6", "Без цен т.к. цены не фиксированные", "set:false"],
    ["d6", "Без цен и не указываем стоимость", "set:false"],
    ["d6", "Без цен и никаких прайсов", "set:false"],
    ["d6", "Без цен и без прайса", "set:false"],
    ["d6", "Без цен потому что не можем гарантировать стоимость", "set:false"],
    ["d6", "Без цен, потому что не можем гарантировать стоимость", "set:false"],
    ["d6", "Без цен пока не определимся с прайсом", "set:false"],
    ["d6", "Без цен, пока не определимся", "set:false"],
    ["d6", "Пока не определимся без цен", "set:false"],
    ["d6", "Без цен - цены не постоянные", "set:false"],
    ["d6", "Без цен не показываем", "set:false"],
    ["d6", "Без цен, не надо", "set:false"],
    ["d6", "Лучше без цен, конкуренты смотрят", "set:false"],
    ["d6", "Без цен у нас все индивидуально", "set:false"],
    ["d6", "Нам без цен никак", "set:true"],
    ["d6", "Нельзя без цен", "set:true"],
    ["d6", "Не надо без цен", "set:true"],
    ["d6", "Без цен работать не можем", "set:true"],
    ["d6", "Без цен не обойдемся", "set:true"],
    ["d6", "Без цен клиенты не звонят", "set:true"],
    ["d6", "Без цен нет смысла", "set:true"],
    ["d6", "Без цен - не наш вариант", "set:true"],
    ["d6", "Без цен? Так не пойдет", "set:true"],
    ["d6", "Без цен не надо", "drop"],
    ["d6", "Без цен не нужно", "drop"],
    ["d6", "Цены да, но без прайса", "drop"],
    ["d6", "Цены - да, прайс-лист не нужен", "drop"],
    ["d6", "Прайс не нужен", "set:false"],
    ["d6", "Нет, показываем", "set:true"],
    ["d6", "Да, без цен", "set:false"],
    ["d6", "Цены не нужно скрывать", "set:true"],
    ["d6", "Цены не публикуем, только по запросу", "set:false"],
    // d1-d5: подлежащее впереди и оговорка следом, правка вместо формулировки
    ["d1", "Позиционирование верное, но добавьте год", "drop"],
    ["d1", "Формулировка верная, но добавьте «с 2012 года»", "drop"],
    ["d1", "Нас все устраивает, но уберите слово бригада", "drop"],
    ["d1", "Все верно но добавьте год", "drop"],
    ["d1", "Верно, добавьте год", "drop"],
    ["d1", "Подтверждаю, но короче", "drop"],
    ["d1", "Формулировка подходит, но короче", "drop"],
    ["d1", "Добавьте год", "drop"],
    ["d1", "Уберите слово бригада", "drop"],
    ["d1", "В основном верно", "drop"],
    ["d1", "Пусть будет", "accept"],
    ["d1", "Оставляем", "accept"],
    ["d1", "Оставьте так", "accept"],
    ["d1", "Да, это так", "accept"],
    ["d1", "Не возражаем", "accept"],
    ["d1", "Верно подобранная команда", "set:Верно подобранная команда"],
    ["d1", "Именно так строим мы", "set:Именно так строим мы"],
    ["d1", "Точно в срок и без доплат", "set:Точно в срок и без доплат"],
    ["d1", "Мастерская ремонта, работаем с 2012 года", "set:Мастерская ремонта, работаем с 2012 года"],
    ["d2", "Совершенно верно, только уберите «без доплат»", "drop"],
    ["d3", "Подтвердить запись", "set:Подтвердить запись"],
    ["d3", "Добавить в корзину", "set:Добавить в корзину"],
    ["d3", "Заменить окна", "set:Заменить окна"],
    ["d5", "Тон устраивает, только без «вы»", "drop"],
    ["d5", "Тон подходит, но чуть теплее", "drop"],
    ["d5", "Вполне официально", "set:Вполне официально"],
    ["d5", "Отлично, на ты и без пафоса", "set:Отлично, на ты и без пафоса"],
    ["d5", "Точно, по делу, без воды", "set:Точно, по делу, без воды"],
    ["d2", "Точно, в срок и без доплат", "set:Точно, в срок и без доплат"],
    ["d1", "В основном, ремонт квартир", "drop"],
    // d4: правка списка - не новый список из одной строки
    ["d4", "Все пункты верны, кроме 8", "drop"],
    ["d4", "Со всеми пунктами согласны, кроме последнего", "drop"],
    ["d4", "Пункты верные, но 8 убрать", "drop"],
    ["d4", "Все пункты верны; добавьте: не работаем за КАД", "drop"],
    ["d4", "Пункт 8 убрать", "drop"],
    ["d4", "Пункты 1-7 верно, 8 убрать", "drop"],
    ["d4", "Добавьте: не работаем за КАД", "drop"],
    ["d4", "Добавить: не работаем за КАД", "drop"],
    ["d4", "Плюс не работаем за КАД", "drop"],
    ["d4", "Согласны с пунктом 3", "drop"],
    ["d4", "Убрать пункт про выходные", "drop"],
    ["d4", "Не работаем с нежилым фондом; плюс не выезжаем за КАД", "drop"],
    ["d4", "Не работаем с юрлицами; не делаем фасады", "set:[Не работаем с юрлицами | не делаем фасады]"],
    ["d4", "Все пункты верны", "accept"],
    // d7-d8: уточнение «без лишних», «без» только при варианте, чужой продавец
    ["d7", "Лендинг, без лишних страниц", "set:landing"],
    ["d7", "Лендинг без лишних страниц", "set:landing"],
    ["d7", "Многостраничный, лишних страниц не надо", "set:multipage"],
    ["d7", "Многостраничный сайт, без лишних страниц", "set:multipage"],
    ["d7", "Лендинг, без формы обратной связи", "set:landing"],
    ["d7", "Многостраничный без лендинга", "set:multipage"],
    ["d7", "Лендинг, больше не нужно", "set:landing"],
    ["d7", "Многостраничный - лишнее, делаем лендинг", "set:landing"],
    ["d7", "Лендинг. Многостраничный неактуален", "set:landing"],
    ["d7", "Лендинг, но пока не решили", "drop"],
    ["d7", "Лендинг лишний", "drop"],
    ["d8", "Продаем товары партнеров", "set:shop"],
    ["d8", "Продаем товары партнеров и свои услуги", "set:both"],
    ["d8", "Услуги без товаров", "set:services"],
    ["d8", "Каталог товаров без услуг", "set:shop"],
    ["d8", "Услуги, товары партнеров", "set:services"],
    ["d8", "Только услуги, товары у партнеров", "set:services"],
    ["d8", "Услуги, товары - лишнее", "set:services"],
    ["d8", "Магазин - устаревшее название, мы сервис", "set:services"],
    ["d8", "Товары партнеров", "drop"],
    ["d8", "Мы дилер, продаем оборудование партнеров", "drop"]
  ];
  const bad = table.filter(([k, a, want]) => got(k, a) !== want).map(([k, a, want]) => `${k} «${a}»: ${got(k, a)}, ждали ${want}`);
  const facts = [
    ["Можно показывать", "accept"], ["Можно размещать", "accept"], ["Можно показать", "accept"], ["Разрешаем", "accept"], ["Разрешаем публиковать", "accept"],
    ["Разрешено", "accept"], ["Пусть будет", "accept"], ["Да, это так", "accept"], ["Не возражаем", "accept"], ["Публикуйте смело", "accept"],
    ["Публикуйте, пожалуйста", "accept"], ["Да, можно показывать", "accept"], ["Публиковать можно", "accept"], ["Можно публиковать как есть", "accept"],
    ["Можно публиковать без цифры", "drop"], ["Можно публиковать, но без цифры", "drop"], ["Можно показывать без цифры", "drop"], ["Печатаем без цифры", "drop"],
    ["Печатайте без цифры", "drop"], ["Оставьте без цифры", "drop"], ["Разрешаем, но без цифры", "drop"], ["Можно публиковать с 2012 года", "drop"],
    ["Без цифры", "drop"], ["Только без цифры", "drop"], ["Без указания суммы", "drop"], ["Без фамилий", "drop"], ["Можно, но позже", "drop"],
    ["Публиковать не надо", "refuse"], ["Публиковать не стоит", "refuse"], ["Показывать не надо", "refuse"], ["Публиковать нельзя", "refuse"],
    ["Печатаем без предоплаты", "set:Печатаем без предоплаты"], ["Без выходных", "set:Без выходных"], ["Уже 12 лет", "set:Уже 12 лет"],
    ["Можно в рассрочку", "set:Можно в рассрочку"], ["Печатаем визитки за 1 день", "set:Печатаем визитки за 1 день"]
  ];
  for (const [a, want] of facts) { const g = fmt(C.parseFactAnswer(a)); if (g !== want) bad.push(`факт «${a}»: ${g}, ждали ${want}`); }
  for (const a of ["Пусть будет", "Не возражаем", "Оставляем"]) if (!C.parseLegalAnswer({ phone: "+7 900 000-00-00" }, a).accept) bad.push(`d10 «${a}»: не подтверждение`);
  return bad.length ? bad.join(" | ") : true;
});

// Сквозной прогон проверяющего (e2e-v.mjs): лист с оговорками, «без цен так как ...», «лишних страниц не надо», принятием
// факта своими словами и пометками в фактах -> документ 1 -> --apply -> гейт. Поля d1, d4, d5 не меняются, цены не
// открываются, тип сайта на месте, «можно показывать» и «разрешаем» публикуют, оговорки по f02 и f03 держат гейт;
// «120 млн - конфиденциально» и «(не публикуем на сайте)» закрыты, «может не называть», «обязаны не раскрывать»,
// «квартирное (внутреннее)» публикуются молчанием.
step("сквозной прогон второй повторной проверки №2 и №13: оговорки не меняют поля, «без цен ...» не открывает цены, гейт ждет d1, d4, d5, f02, f03", () => {
  const set = { 4: ["Выручка", "120 млн - конфиденциально"], 5: ["Анонимность", "Пациент может не называть свое имя"], 6: ["Тайна", "По закону обязаны не раскрывать данные клиентов"],
    7: ["Виды утепления", "Фасадное (наружное), квартирное (внутреннее)"], 8: ["Оборот", "50 млн (не публикуем на сайте)"] };
  const limits = ["не работаем с нежилым фондом", "не делаем перепланировку", "не выезжаем за КАД", "не даем скидок",
    "не работаем без договора", "не берем предоплату 100%", "не работаем в выходные", "не гарантируем сроки при изменении проекта"];
  const dir = readyProject("rever2-213", { tweak: (s) => {
    s.offer.limits = limits.slice();
    s.offer.tone = "спокойно, на вы";
    for (const [i, [label, value]] of Object.entries(set)) { s.facts[i].label = label; s.facts[i].value = value; delete s.facts[i].artifact; }
  } });
  const html = text(doc(dir, DOC1));
  const rec = (id) => { const r = (html.match(new RegExp(`<td>${id}</td>[^\\n]*`)) || [""])[0]; return /да, публикуем/.test(r) ? "да" : /помечено как закрытое/.test(r) ? "закрыт" : `?${r.slice(0, 80)}`; };
  const want = { f05: "закрыт", f06: "да", f07: "да", f08: "да", f09: "закрыт" };
  const got = Object.fromEntries(Object.keys(want).map((id) => [id, rec(id)]));
  if (JSON.stringify(got) !== JSON.stringify(want)) return `документ 1: ${JSON.stringify(got)}`;
  const before = proj(dir);
  sheet(dir, "answers.txt", "d1: Формулировка верная, но добавьте «с 2012 года»\nd4: Все пункты верны, кроме 8\nd5: Тон подходит, но чуть теплее\n"
    + "d6: Без цен так как цены не фиксированные\nd7: Многостраничный, лишних страниц не надо\nd8: Только услуги\n"
    + "f01: Можно показывать\nf02: Можно публиковать, но без цифры\nf03: Печатаем без цифры\nf04: Разрешаем\n");
  const w = applyAll(dir);
  if (w.code !== 0) return `запись: ${w.all.slice(0, 300)}`;
  const after = proj(dir);
  if (after.offer.positioning !== before.offer.positioning) return `позиционирование: ${after.offer.positioning}`;
  if (JSON.stringify(after.offer.limits) !== JSON.stringify(limits)) return `границы: ${JSON.stringify(after.offer.limits)}`;
  if (after.offer.tone !== "спокойно, на вы") return `тон: ${after.offer.tone}`;
  if ((after.business.sig || []).includes("price_open")) return "«без цен так как ...» открыло цены";
  if (after.business.site_kind !== "multipage" || after.business.type !== "services") return `тип сайта ${after.business.site_kind}, продаем ${after.business.type}`;
  const pub = Object.fromEntries(["f01", "f02", "f03", "f04", "f05", "f06", "f07", "f08", "f09"].map((id) => [id, factOf(dir, id).publish]));
  const wantPub = { f01: "yes", f02: "no", f03: "no", f04: "yes", f05: "no", f06: "yes", f07: "yes", f08: "yes", f09: "no" };
  if (JSON.stringify(pub) !== JSON.stringify(wantPub)) return `publish: ${JSON.stringify(pub)}`;
  for (const id of ["f01", "f04"]) if (factOf(dir, id).value !== before.facts.find((f) => f.id === id).value) return `${id}: значение заменено ответом «${factOf(dir, id).value}»`;
  if (!/d6: «Без цен так как цены не фиксированные» -> нет/.test(w.all)) return "дифф-лист не печатает «понят как» для d6";
  const g = gateOf(dir);
  const held = (key) => new RegExp(`не разобраны ответы по[^\\n]*${key}(?![0-9])`).test(g.all);
  return g.code === 2 && ["d1", "d4", "d5", "f02", "f03"].every(held) && !held("d6") && !held("d7") && !held("f01") ? true : `гейт: exit ${g.code} ${g.all.slice(0, 300)}`;
});

step("круг после гейта: nextStep не «-» до применения; применение сбрасывает гейт; отрицания d7/d8 не меняют тип и состав; исправленный круг - новый гейт", () => {
  const dir = readyProject("after-gate", { tier: "basic", kind: "multipage" });
  const sdBefore = text(join(dir, "structure_data.json"));
  sheet(dir, "answers.txt", "");
  if (applyAll(dir).code !== 0 || gateOf(dir).code !== 0) return "первый гейт не пройден";
  if (Q.nextStep(dir).n !== "-") return `после гейта nextStep ${Q.nextStep(dir).n}`;
  sheet(dir, "answers-2.txt", "d7: лендинг нам точно не нужен\nd8: магазин нам пока не нужен\nf05: не согласен\nf06: уберите это\n");
  const st0 = Q.nextStep(dir);
  if (st0.n !== "5" || !/answers-2\.txt появился после гейта/.test(st0.need)) return `круг после гейта не применен, а nextStep ${st0.n} (${st0.need})`;
  const w = applyAll(dir);
  if (w.code !== 0) return `запись: ${w.all}`;
  const q = readJson(join(dir, "queue.json"));
  if (q.gate.approved !== false || !(q.gate.prev && q.gate.prev.approved === true)) return `гейт после круга: ${JSON.stringify(q.gate)}`;
  if (!q.journal.some((e) => /гейт сброшен/.test(e.subject))) return "сброс гейта не записан в журнал";
  if (q.site_kind !== "multipage" || q.type !== "services") return `queue.json: сайт ${q.site_kind}, тип ${q.type}`;
  const p = proj(dir);
  if (p.business.site_kind !== "multipage" || p.business.type !== "services") return `контракт: ${p.business.site_kind}/${p.business.type}`;
  if (text(join(dir, "structure_data.json")) !== sdBefore) return "состав планировщика переписан ответом «лендинг не нужен»";
  if (existsSync(join(dir, "structure_data.prev.json"))) return "резервная копия состава без смены состава";
  const f5 = factOf(dir, "f05"), f6 = factOf(dir, "f06");
  if (f5.publish !== "no" || f5.value !== "от 4500 руб за кв м" || f6.publish !== "no" || f6.value !== "12 бригад") return `несогласие опубликовано значением: ${JSON.stringify([f5, f6])}`;
  if (Q.nextStep(dir).n !== "5") return `после круга с «не разобрано» nextStep ${Q.nextStep(dir).n}`;
  const g1 = gateOf(dir);
  const openLine = g1.all.split("\n").find((l) => /не разобраны ответы по/.test(l)) || "";
  if (g1.code !== 2 || !["d7", "d8", "f05", "f06"].every((k) => openLine.includes(k))) return `гейт при «не разобрано» d7, d8, f05, f06: exit ${g1.code} ${openLine}`;
  sheet(dir, "answers-2.txt", "d7: верно\nd8: верно\nf05: нет\nf06: да\n");
  if (applyAll(dir).code !== 0) return "исправленный круг не применился";
  if (gateOf(dir).code !== 0) return "гейт после исправленного круга не пройден";
  if (Q.nextStep(dir).n !== "-") return "после нового гейта nextStep не «-»";
  // смена состава по ответу d7: прежний состав планировщика - в structure_data.prev.json
  sheet(dir, "answers-3.txt", "d7: лендинг\n");
  if (applyAll(dir).code !== 0) return "круг d7 «лендинг» не применился";
  const sd = readJson(join(dir, "structure_data.json"));
  if (sd.pages.length !== 1) return `состав лендинга: ${sd.pages.length} страниц`;
  if (!existsSync(join(dir, "structure_data.prev.json")) || text(join(dir, "structure_data.prev.json")) !== sdBefore) return "прежний состав не сохранен в structure_data.prev.json";
  return readJson(join(dir, "queue.json")).gate.approved === false ? true : "смена состава после гейта оставила гейт пройденным";
});

step("гейт: строка по несуществующему факту (опечатка f77) не держит гейт; openDropped не видит фактов вне контракта", () => {
  const dir = readyProject("typo-f77");
  sheet(dir, "answers.txt", "f77: да\n");
  const w = applyAll(dir);
  if (w.code !== 0 || !/f77[^\n]*такого факта в контракте нет/.test(w.all)) return `строка с опечаткой не названа: ${w.all.slice(-300)}`;
  const g = gateOf(dir);
  if (g.code !== 0) return `гейт держит опечатка: ${g.all}`;
  const q = { journal: [{ key: "f77", kind: "dropped" }, { key: "f01", kind: "dropped" }, { key: "d7", kind: "dropped" }] };
  const open = Q.openDropped(q, new Set(["f01"])).map((e) => e.key).join();
  return open === "f01,d7" ? true : `openDropped: ${open}`;
});

step("сверка чисел: любое число значения, которого нет во фразе заказчика («25 ювелиров» при «11 человек»), - предупреждение", () => {
  const dir = putProject("num-any", baseProject());
  writeFileSync(join(dir, "input", "call.txt"), "Заказчик: у нас 11 человек работает ювелиров\n", "utf8");
  writeFileSync(join(dir, "answers.txt"), "f06: 25 ювелиров в штате << у нас 11 человек работает ювелиров\n", "utf8");
  const w = run([APPLY, dir, "--apply"]);
  if (w.code !== 0) return `запись: ${w.all}`;
  const v = run([VERIFY, dir, "--no-write"]);
  if (v.code === 2) return `проверка: ${bad2(v)}`;
  return /f06[^\n]*числа 25/.test(v.all) ? true : "«25 ювелиров» при фразе «11 человек» прошло без предупреждения";
});

step("сборка: «сохранено yes» и «засеяно no у всех» не печатаются вместе", () => {
  const dir = readyProject("bp-lines");
  sheet(dir, "answers.txt", "");
  if (applyAll(dir).code !== 0) return "лист не применился";
  const r = run([BUILD_PROJECT, dir]);
  if (r.code === 2) return `пересборка: ${bad2(r)}`;
  if (!/сохранено "yes"/.test(r.all)) return "сохраненные yes не названы";
  return /засеяно "no" у всех/.test(r.all) ? "две противоречащие строки: сохранено yes и засеяно no у всех" : true;
});

step("старый лист: просмотр говорит, что отметку запишет --apply, гейт называет причину; nextStep старого гейта не держит первый круг", () => {
  const dir = readyProject("legacy-view");
  const p = proj(dir);
  p.facts.forEach((f) => { f.publish = "yes"; });
  writeFileSync(join(dir, "project.json"), JSON.stringify(p, null, 2), "utf8");
  const q = readJson(join(dir, "queue.json"));
  delete q.answers;
  q.gate = { approved: true, by: "до программы", at: "2026-09-20" };
  writeFileSync(join(dir, "queue.json"), JSON.stringify(q, null, 2), "utf8");
  sheet(dir, "answers.txt", "f05: -\n");
  if (Q.nextStep(dir).n !== "-") return `старый гейт с первым кругом: nextStep ${Q.nextStep(dir).n}`;
  const view = run([APPLY, dir]);
  if (!/будет записана при --apply/.test(view.all) || !/новый круг answers-2\.txt/.test(view.all)) return "просмотр не говорит про отметку старого листа";
  const g = gateOf(dir);
  if (g.code !== 2 || !/применен до программы 28\.09 без отметки/.test(g.all)) return `гейт по старому листу: ${g.all.slice(0, 300)}`;
  sheet(dir, "answers-2.txt", "g1: 3900 руб за кв м\n");
  return Q.nextStep(dir).n === "5" ? true : "второй круг после старого гейта не вернул на шаг 5";
});

step("SKILL.md и промты: шаг 5 по Р1-Р3, повторный проход планировщика, facts у причин", () => {
  const s = text(join(SKILL_DIR, "SKILL.md"));
  const miss = ["answers-2.txt", "«нет»", "не разобрано", "<<", "input/", "+: что = значение", "F8NN", "--ground", "absent_fields", "50"].filter((w) => !s.includes(w));
  if (miss.length) return `SKILL.md не называет: ${miss.join(", ")}`;
  if (/Молчание по факту - `publish="no"`/.test(s)) return "SKILL.md по-прежнему: молчание по факту - publish no";
  const planner = text(PLANNER);
  if (!/Повторный проход/.test(planner) || !/target_status/.test(planner)) return "pages-planner не знает повторного прохода с прежним составом";
  const market = text(join(ROOT, ".claude/agents/site-market.md"));
  return /`reasons\[\]`[^\n]*`facts`/.test(market) ? true : "site-market не велит ставить facts у причин";
});

// ──────────────────────────────────────────────────────────────────────────
console.log("");
console.log("=== Типографика и инвариант v8 ===");
// ──────────────────────────────────────────────────────────────────────────

step("длинное тире и е-с-точками в созданных файлах - провал", () => {
  const bad = [];
  for (const rel of MADE) {
    const p = join(ROOT, rel);
    if (!existsSync(p)) continue;
    const raw = text(p);
    const body = rel.endsWith(".mjs") ? stripDetectors(raw) : raw;
    const hits = body.match(BAD_TYPO);
    if (hits) {
      const at = body.search(BAD_TYPO);
      bad.push(`${rel}: ${[...new Set(hits)].join("")} рядом с «${body.slice(Math.max(0, at - 30), at + 30).replace(/\s+/g, " ")}»`);
    }
  }
  return bad.length ? bad.join(" | ") : true;
});

step("ИНВАРИАНТ v8: в промтах агентов запретов не больше, чем образцов и приемов", () => {
  const bad = [];
  for (const rel of [".claude/agents/site-intake.md", ".claude/agents/site-market.md", ".claude/agents/pages-planner.md", ".claude/skills/site-analiz/SKILL.md"]) {
    const t = text(join(ROOT, rel));
    const ban = countBy(t, BAN_RE);
    const sample = countBy(t, SAMPLE_RE);
    if (ban > sample) bad.push(`${rel}: запретов ${ban}, образцов ${sample}`);
  }
  return bad.length ? bad.join("; ") : true;
});

step("ИНВАРИАНТ v8: в шаблонах документов запретов не больше, чем образцов", () => {
  const bad = [];
  for (const name of ["doc1.tmpl.html", "doc2.tmpl.html"]) {
    const t = text(join(SKILL_DIR, name));
    const ban = countBy(t, BAN_RE);
    const sample = countBy(t, SAMPLE_RE);
    if (ban > sample) bad.push(`${name}: запретов ${ban}, образцов ${sample}`);
  }
  return bad.length ? bad.join("; ") : true;
});

step("потолок запретов на файл: 25 (файлам писателя v7 приходило вдвое больше)", () => {
  const bad = [];
  for (const rel of [".claude/agents/site-intake.md", ".claude/agents/site-market.md", ".claude/agents/pages-planner.md", ".claude/skills/site-analiz/SKILL.md",
    ".claude/skills/site-analiz/doc1.tmpl.html", ".claude/skills/site-analiz/doc2.tmpl.html"]) {
    const n = countBy(text(join(ROOT, rel)), BAN_RE);
    if (n > 25) bad.push(`${rel}: ${n}`);
  }
  return bad.length ? bad.join("; ") : true;
});

step("пустая фактура законна: страница из плейсхолдеров невозможна", () => {
  // Упоминание маркера в обратных кавычках - это запрет, а не его применение:
  // «`[ЗАПОЛНИТЬ]` не существует» обязано остаться, а вот живой маркер в шаблоне
  // или в схеме - возврат к v7, где страница из скобок считалась валидной.
  const marker = "[" + "ЗАПОЛНИТЬ";
  const bad = MADE.filter((rel) => {
    if (!existsSync(join(ROOT, rel)) || rel === ".claude/tests/site/run.mjs") return false;
    return text(join(ROOT, rel)).replace(/`[^`\n]*`/g, "``").includes(marker);
  });
  return bad.length ? `плейсхолдер вернулся: ${bad.join(", ")}` : true;
});

// ──────────────────────────────────────────────────────────────────────────
console.log("");
console.log("=== Страховка: старую машинерию не трогаем ===");
// ──────────────────────────────────────────────────────────────────────────

step("/seo-faq и faq-builder на месте и не пусты", () => {
  const faqSkill = join(ROOT, ".claude/skills/seo-faq/SKILL.md");
  const faqAgent = join(ROOT, ".claude/agents/faq-builder.md");
  if (!existsSync(faqSkill)) return "нет .claude/skills/seo-faq/SKILL.md";
  if (!existsSync(faqAgent)) return "нет .claude/agents/faq-builder.md";
  if (chars(text(faqSkill)) < 1000) return "SKILL.md скила seo-faq подозрительно пуст";
  if (chars(text(faqAgent)) < 1000) return "промт faq-builder подозрительно пуст";
  if (!/jm_text_analyze|jm_text_check|jm_stop_domains/.test(text(faqAgent))) return "из промта faq-builder пропала связка с SEO-сервисами";
  return true;
});

// seo-analiz и seo-tekst по гейту 0 выведены (тексты - в /site-tekst), поэтому их тут нет:
// страховка держит то, что остается и на что опирается конвейер после анализа.
step("скилы, на которые опирается конвейер после анализа, живут дальше", () => {
  const want = ["seo-statya", "seo-struktura", "seo-metategi", "seo-tehaudit", "seo-faq"];
  const missing = want.filter((s) => !existsSync(join(ROOT, ".claude/skills", s, "SKILL.md")));
  return missing.length ? `снесены: ${missing.join(", ")}` : true;
});

step("ассеты /seo-faq на месте: VOICE и BLOCKS-METRICS в seo-faq/assets, faq-builder читает их оттуда", () => {
  const dir = ".claude/skills/seo-faq/assets";
  const bad = ["VOICE.md", "BLOCKS-METRICS.md"].filter((n) => !(existsSync(join(ROOT, dir, n)) && chars(text(join(ROOT, dir, n))) >= 1000));
  if (bad.length) return `нет или пусты: ${bad.join(", ")} - /seo-faq остался без своих правил`;
  const agent = text(join(ROOT, ".claude/agents/faq-builder.md"));
  const miss = ["VOICE.md", "BLOCKS-METRICS.md"].filter((n) => !agent.includes(`${dir}/${n}`));
  return miss.length ? `faq-builder не читает ${miss.join(", ")} из ${dir}` : true;
});

step("анализ не подменяет /seo-faq и не плодит скилов site-* сверх двух (site-analiz, site-tekst)", () => {
  // Скил - папка с SKILL.md. Пустой остаток каталога (снятый скил, копия kit) скилом не считается.
  const dirs = readdirSync(join(ROOT, ".claude/skills")).filter((d) => /^site-/.test(d) && existsSync(join(ROOT, ".claude/skills", d, "SKILL.md")));
  const extra = dirs.filter((d) => !["site-analiz", "site-tekst"].includes(d));
  if (extra.length) return `лишние скилы site-*: ${extra.join(", ")}`;
  return /seo-faq/.test(text(join(SKILL_DIR, "SKILL.md"))) ? true : "в SKILL.md не сказано, что FAQ остается за /seo-faq";
});

// === Итог ===
softRm(SANDBOX);
console.log("");
console.log(`=== ${passed}/${passed + failed} tests passed${skips.length ? `, SKIP ${skips.length}: ${skips.join("; ")}` : ""} ===`);
if (failed > 0) {
  for (const f of failures) console.error(`  FAIL: ${f}`);
  process.exit(1);
}
process.exit(0);
