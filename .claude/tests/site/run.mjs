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
//
// Exit 0 - все шаги прошли. Exit 1 - есть провал.

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, rmSync } from "node:fs";
import { join, resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

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

// Файлы, созданные на этом этапе. Список один: по нему идут и потолки, и типографика.
const MADE = [
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

// === Мини-фреймворк (стиль набора /seo-tekst) ===
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
            { says: "пропадете после аванса", answer: "оплата по этапам, аванс 10 процентов" }
          ],
          choose: ["фиксированная смета", "свой прораб"]
        },
        {
          id: "s2", name: "Инвестор под сдачу",
          pain: ["нужен быстрый оборот квартиры", "нет времени ездить на объект"],
          objection: [
            { says: "дорого для сдачи в аренду", answer: "отделка под аренду, срок 30 дней" },
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
  const gate = run([QUEUE, "gate", e2eDir, "--by", "владелец"]);
  if (gate.code !== 0) return `гейт: ${gate.all}`;
  const done = run([QUEUE, "state", e2eDir]);
  return /контракт согласован/.test(done.all) ? true : `после гейта очередь не закрылась: ${done.stdout.trim().split("\n").slice(-2).join(" / ")}`;
});

step("после гейта пересборка контракта отказывает без --force", () => {
  const again = run([BUILD_PROJECT, e2eDir]);
  if (again.code !== 2) return `exit ${again.code}: пересборка стерла бы согласованные решения молча`;
  if (!/гейт пройден/.test(again.all)) return "отказ без объяснения причины";
  const forced = run([BUILD_PROJECT, e2eDir, "--force"]);
  return forced.code === 2 ? `--force не помог: ${forced.all}` : true;
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

step("факт из ответа заказчика подписан ответом, а не брифом", () => {
  const dir = putProject("answer-src", baseProject());
  writeFileSync(join(dir, "answers.txt"), "f05: от 5200 руб за кв м << весной подняли цену\n", "utf8");
  const w = run([APPLY, dir, "--apply"]);
  if (w.code !== 0) return `запись exit ${w.code}: ${w.all}`;
  const f = readJson(join(dir, "project.json")).facts.find((x) => x.id === "f05");
  if (!f) return "факт пропал";
  if (f.src !== "ответ") return `src «${f.src}»: заказчику покажут брифом то, что он сказал вчера`;
  if (f.artifact) return "дословная фраза уехала в artifact и сделала факт проверяемым - сказанное вслух доказательством не является";
  const q = readJson(join(dir, "parts", "facts-src.json")).filter((x) => x.id === "f05");
  if (q.length !== 1) return `записей цитаты f05 ${q.length} - старая цитата брифа не заменена ответом`;
  if (q[0].where !== "answers.txt:1" || !/5200/.test(q[0].quote)) return `цитата ответа записана не так: ${JSON.stringify(q[0])}`;
  const v = run([VERIFY, dir, "--no-write"]);
  if (v.code === 2) return `валидатор не принял источник ответа: ${v.all}`;
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
    const policy = text(join(ROOT, "docs/MODEL-POLICY.md"));
    const bad = [];
    for (const a of list) {
      const p = join(ROOT, ".claude/agents", a + ".md");
      if (!existsSync(p)) { bad.push(`${a}: нет файла`); continue; }
      const fm = (text(p).match(/^---\n([\s\S]*?)\n---/) || [])[1] || "";
      if (!new RegExp(`^name: ${a}$`, "m").test(fm)) bad.push(`${a}: name во frontmatter`);
      if (!/^model: opus$/m.test(fm)) bad.push(`${a}: модель не opus`);
      if (!new RegExp(`^\\| ${a} \\| opus \\|`, "m").test(policy)) bad.push(`${a}: нет строки opus в MODEL-POLICY`);
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
  writeFileSync(join(dir, "answers.txt"), "g1: 4800 руб за кв м << так и пишите\ng2: не разворачиваем в этой версии\n", "utf8");
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

// seo-analiz и seo-tekst по гейту 0 уходят (тексты - в /site-tekst), поэтому их тут нет:
// страховка держит то, что остается и на что опирается конвейер после анализа.
step("скилы, на которые опирается конвейер после анализа, живут дальше", () => {
  const want = ["seo-statya", "seo-struktura", "seo-metategi", "seo-tehaudit", "seo-faq"];
  const missing = want.filter((s) => !existsSync(join(ROOT, ".claude/skills", s, "SKILL.md")));
  return missing.length ? `снесены: ${missing.join(", ")}` : true;
});

step("ассеты /seo-faq на месте: VOICE и BLOCKS-METRICS (в seo-faq/assets или до переноса в seo-tekst/assets)", () => {
  const bad = ["VOICE.md", "BLOCKS-METRICS.md"].filter((n) => ![".claude/skills/seo-faq/assets", ".claude/skills/seo-tekst/assets"]
    .some((d) => existsSync(join(ROOT, d, n)) && chars(text(join(ROOT, d, n))) >= 1000));
  return bad.length ? `нет или пусты: ${bad.join(", ")} - /seo-faq остался без своих правил` : true;
});

step("анализ не подменяет /seo-faq и не плодит скилов site-* сверх двух (site-analiz, site-tekst)", () => {
  const dirs = readdirSync(join(ROOT, ".claude/skills")).filter((d) => /^site-/.test(d));
  const extra = dirs.filter((d) => !["site-analiz", "site-tekst"].includes(d));
  if (extra.length) return `лишние скилы site-*: ${extra.join(", ")}`;
  return /seo-faq/.test(text(join(SKILL_DIR, "SKILL.md"))) ? true : "в SKILL.md не сказано, что FAQ остается за /seo-faq";
});

// === Итог ===
softRm(SANDBOX);
console.log("");
console.log(`=== ${passed}/${passed + failed} tests passed ===`);
if (failed > 0) {
  for (const f of failures) console.error(`  FAIL: ${f}`);
  process.exit(1);
}
process.exit(0);
