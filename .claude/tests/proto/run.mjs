#!/usr/bin/env node
// run.mjs - набор этапа 2 конвейера v8: слой письма, скил /site proto.
// Запуск: .claude\scripts\_node.cmd .claude\tests\proto\run.mjs
//
// Набор этапа 1 (.claude/tests/site/run.mjs) проверяет КОНТРАКТ ДАННЫХ. Этот проверяет то,
// что из контракта рождается ТЕКСТ, и держит ровно те места, где v7.1 ломался:
//
//   1. ПОТОЛКИ В ЗНАКАХ на каждый файл слоя письма. Знаки, а не строки.
//   2. ИНВАРИАНТ ПРОПОРЦИИ - главный тест этапа. Автору приходит ДВА раздельных бюджета:
//      ИНСТРУКЦИИ не больше 12000 знаков, из них запретов 2500, и МАТЕРИАЛ не больше
//      16000. Машинное условие одно: МАТЕРИАЛА БОЛЬШЕ, ЧЕМ ИНСТРУКЦИЙ. В v7.1 пропорция
//      была обратной (32982 знака обязательного входа, 125 отдельных «не» на один
//      образец), и это давало «каждый момент соблюден плохо».
//   3. ИНВАРИАНТ ОБРАЗЦОВ: в AUTHOR.md приемов и образцов больше, чем запретов, и полных
//      образцов блока не меньше трех. Запрет добавляется только вместе с образцом.
//   4. БЮДЖЕТЫ КОЛИЧЕСТВА: правил плана ровно 6 (седьмое валит сборку на импорте),
//      блокирующих правил не больше 12 и предупреждающих не больше 12, скриптов не
//      больше 20, агентов site-* не больше 8. Реестр rules.yml и то, что реально
//      проверяет verify-page.mjs, - ОДИН список, и разойтись им негде.
//   5. ДЕТЕРМИНИЗМ: один замер лидеров дает байт-в-байт тот же план.
//   6. ШЕСТЬ ПРАВИЛ СОСТАВА на фикстурах: R1 поднимает, R2 демотирует, R3 не дает снять
//      ядро, R4 считает объем в БЛОКАХ, R6 понижает тип ответа.
//   7. ЗАМЕР: живость страницы, покрытие от ЖИВЫХ, measured false при живых меньше трех.
//   8. ПРОВЕРКА СТРАНИЦЫ: чужое число и смягчитель - отказ, недобор нормы и забытая
//      метка - предупреждение. Резать за недобор в v8 нечем и незачем.
//   9. УСИЛЕНИЕ: пустой список - шаг не вызывается; операции «резать» у роли нет.
//  10. ПУСТАЯ ФАКТУРА: страница становится КОРОЧЕ, а не оборонительнее.
//  11. СКВОЗНОЙ ПРОГОН ЛЕНДИНГА: контракт - адреса - план - задания - страница - проверка
//      - усиление - сборка - проверка сборки, до готового site.html.
//  12. СТРАХОВКА: файлы v7 и этапа 1 на месте, типа article конвейер не порождает.
//
// Exit 0 - все шаги прошли. Exit 1 - есть провал.

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, rmSync, cpSync, utimesSync } from "node:fs";
import { join, resolve, dirname, basename } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../../..");
const TMP_ROOT = join(ROOT, ".claude/tmp");
const PREFIX = "proto-test";
const SANDBOX = join(TMP_ROOT, `${PREFIX}-${process.pid}-${Date.now().toString(36)}`);

const SITE_SCRIPTS = join(ROOT, ".claude/scripts/site");
const SKILL_DIR = join(ROOT, ".claude/skills/site-proto");
const AGENTS = join(ROOT, ".claude/agents");
const PAGES_YML = join(SKILL_DIR, "pages.yml");
const RULES_YML = join(SKILL_DIR, "rules.yml");

const S = (name) => join(SITE_SCRIPTS, name + ".mjs");
const PAGES = S("pages"), PLAN = S("plan"), TASKS = S("build-tasks");
const VPAGE = S("verify-page"), LIFT = S("lift"), ASM = S("assemble"), VBUILD = S("verify-build");

// Файлы, созданные на этом этапе. Список один: по нему идут и потолки, и типографика.
const MADE = [
  ".claude/skills/site-proto/SKILL.md",
  ".claude/skills/site-proto/AUTHOR.md",
  ".claude/skills/site-proto/rules.yml",
  ".claude/agents/leader-mapper.md",
  ".claude/agents/site-author.md",
  ".claude/agents/site-strengthener.md",
  ".claude/agents/site-judge.md",
  ".claude/agents/site-editor.md",
  ".claude/scripts/site/map-blocks.mjs",
  ".claude/scripts/site/recon.mjs",
  ".claude/scripts/site/pages.mjs",
  ".claude/scripts/site/plan.mjs",
  ".claude/scripts/site/build-tasks.mjs",
  ".claude/scripts/site/verify-page.mjs",
  ".claude/scripts/site/lift.mjs",
  ".claude/scripts/site/assemble.mjs",
  ".claude/scripts/site/verify-build.mjs",
  ".claude/tests/proto/run.mjs",
  "docs/v8/contracts-proto.md"
];

// Промты слоя письма: на них идут потолок 10000 и счет запретов против образцов.
const PROMPTS = [
  ".claude/agents/leader-mapper.md",
  ".claude/agents/site-author.md",
  ".claude/agents/site-strengthener.md",
  ".claude/agents/site-judge.md",
  ".claude/agents/site-editor.md"
];

// === Мини-фреймворк (стиль наборов /seo-tekst и site) ===
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

// Скрипты зовем из корня репозитория: repoRoot() у них выводится из cwd, и песочница
// лежит внутри .claude, где .claude нашелся бы не тот.
function run(args) {
  const r = spawnSync(process.execPath, args, { encoding: "utf8", cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
  const out = String(r.stdout || "");
  const err = String(r.stderr || "");
  return { code: r.status ?? 1, stdout: out, stderr: err, all: out + err };
}
const runJson = (args) => {
  const r = run(args.concat(["--json"]));
  try { return Object.assign(r, { json: JSON.parse(r.stdout) }); }
  catch { return Object.assign(r, { json: null }); }
};

const chars = (s) => Array.from(String(s == null ? "" : s)).length;
const text = (p) => readFileSync(p, "utf8").replace(/^﻿/, "");
const readJson = (p) => JSON.parse(text(p));
const clone = (o) => JSON.parse(JSON.stringify(o));

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

// === Счетчики инварианта v8: запреты против образцов и приемов ===
// Запреты считает та же функция, что и потолок запретов в build-tasks (banCount): счет по
// прозе давал ноль там, где стоит шесть запретов подряд, и завышал там, где просто есть
// кавычки. Образец считается по ЯВНОМУ маркеру: блок в тройных кавычках, строка таблицы
// замен, пронумерованный прием, замена стрелкой. Иначе инвариант «приемов больше, чем
// запретов» подтверждался бы случайно, а его смысл - отмена пропорции «125 не на 1 образец».
const SAMPLE_RE = [
  /```[\s\S]*?```/g,
  /^[ \t]*\|[^|\n]+\|[^|\n]+\|[ \t]*$/gm,
  /^[ \t]*\d+\.[ \t]+\S/gm,
  /«[^»\n]{2,}»\s*->\s*«[^»\n]{2,}»/g
];

const countBy = (t, list) => list.reduce((n, re) => n + (String(t).match(re) || []).length, 0);

// === Типографика: в скриптах сами детекторы содержат запрещенные знаки ===
// Символьный класс регулярки и карта имен - это код проверки, а не текст.
const TYPO_CLASS = "[\\u2012\\u2013\\u2014\\u2015\\u2212\\u0451\\u0401]";
const YO_CLASS = "[\\u0451\\u0401]";
const stripDetectors = (t) => String(t)
  .replace(/\[[^\]\n]{0,80}\]/g, "[]")
  .replace(new RegExp('"' + TYPO_CLASS + '"', "g"), '""')
  .replace(new RegExp("/" + YO_CLASS + "/", "g"), "//")
  .replace(/mdash[\s\S]{0,200}?rarr:\s*"[^"]*"/g, "ENT");
const BAD_TYPO = new RegExp("[\\u2012\\u2013\\u2014\\u2015\\u0451\\u0401]", "g");

// === Разбор pages.yml тем же плоским способом, что и скрипты этапа ===
function readYml(p) {
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

sweepOldSandboxes();
try { mkdirSync(SANDBOX, { recursive: true }); }
catch (err) { console.error(`[fatal] не создать песочницу ${SANDBOX}: ${err.code || err.message}`); process.exit(1); }

// === Модули этапа грузим напрямую: правила состава и реестр проверяются на константах ===
const imp = (name) => import(pathToFileURL(S(name)).href);
const PLANM = await imp("plan");
const VPM = await imp("verify-page");
const LIFTM = await imp("lift");
const TASKM = await imp("build-tasks");
const MAPM = await imp("map-blocks");
const RECONM = await imp("recon");
const CONTRACT = await import(pathToFileURL(join(SITE_SCRIPTS, "_contract.mjs")).href);

const yml = readYml(PAGES_YML);
const ymlReal = CONTRACT.readPages(PAGES_YML);

// ──────────────────────────────────────────────────────────────────────────
// Фикстуры
// ──────────────────────────────────────────────────────────────────────────

// Пятнадцать фактов - минимум контракта, поэтому они строятся, а не переписываются руками.
const FACT_SEED = [
  ["Гарантия на монтаж", "3 года по договору", ["edge", "qa"], "doc/dogovor.pdf"],
  ["Срок выезда замерщика", "2 часа по городу", ["hero", "steps"], ""],
  ["Опыт работы", "9 лет на рынке", ["numbers", "about"], ""],
  ["Сдано объектов", "137 объектов", ["cases", "numbers"], ""],
  ["Цена монтажа", "от 4500 руб за кв м", ["price"], ""],
  ["Бригад в работе", "12 бригад", ["about", "numbers"], ""],
  ["Лицензия", "номер 1234 от 2019 года", ["docs"], "doc/licenziya.pdf"],
  ["Срок работ", "14 дней на объект", ["steps", "cases"], ""],
  ["Зона выезда", "60 км от города", ["geo"], ""],
  ["Состав работ", "7 этапов", ["scope", "steps"], ""],
  ["Оплата", "рассрочка на 6 месяцев", ["delivery"], ""],
  ["Оценка на картах", "48 отзывов", ["reviews"], "https://example.test/otzyvy"],
  ["Склад", "300 позиций в наличии", ["listing"], ""],
  ["Смена", "работаем 12 часов", ["geo", "delivery"], ""],
  ["Договор", "фиксация цены в договоре", ["price_factors"], "doc/dogovor.pdf"]
];

function baseProject(kind) {
  const facts = FACT_SEED.map(([label, value, q, artifact], i) => {
    const f = { id: "f" + String(i + 1).padStart(2, "0"), label, value, q, publish: "yes", src: "бриф" };
    if (artifact) f.artifact = artifact;
    return f;
  });
  return {
    v: 2,
    slug: "nevskiy-remont",
    updated: "2026-09-16",
    source: ["бриф", "созвон"],
    tier: "seo",
    gates: { promise: true, facts3: true, proof1: true, ready: true },
    business: {
      name: "Невский Ремонт",
      what: "ремонт квартир под ключ в Санкт-Петербурге",
      region: "Санкт-Петербург",
      type: "services",
      site_kind: kind,
      since: 2016,
      geo: ["Санкт-Петербург", "Ленинградская область"],
      directions: kind === "landing"
        ? [{ id: "remont-kvartir", name: "Ремонт квартир", marker: "ремонт квартир под ключ" }]
        : [
          { id: "remont-kvartir", name: "Ремонт квартир под ключ", marker: "ремонт квартир под ключ" },
          { id: "remont-vannoy", name: "Ремонт ванной комнаты", marker: "ремонт ванной комнаты под ключ" },
          { id: "otdelka-novostroek", name: "Отделка новостроек", marker: "отделка квартир в новостройке" }
        ],
      legal: { entity: "ООО Невский Ремонт", inn: "7801234567" }
    },
    offer: {
      positioning: "бригада со своим прорабом на объекте",
      reasons: [
        { claim: "Цена фиксируется в договоре", proof: "договор с фиксацией сметы", kind: "документ" },
        { claim: "Свой прораб ведет объект", proof: "штатное расписание", kind: "документ" },
        { claim: "Фотоотчет каждый день", proof: "архив отчетов", kind: "документ" }
      ],
      promise: { who: "владелец квартиры", result: "квартира сдана в срок и без доплат", cta: "Рассчитать смету" }
    },
    audience: {
      segments: [
        {
          id: "s1", name: "Семья с ипотекой",
          pain: ["ремонт затягивается на полгода", "смета растет по ходу работ"],
          objection: [
            { says: "выйдет дороже", answer: "цена фиксируется в договоре, доплата только за новые работы" },
            { says: "пропадете после аванса", answer: "оплата по этапам, аванс десятая часть" }
          ],
          choose: ["фиксированная смета", "свой прораб"]
        },
        {
          id: "s2", name: "Инвестор под сдачу",
          pain: ["нужен быстрый оборот квартиры", "нет времени ездить на объект"],
          objection: [
            { says: "дорого для сдачи в аренду", answer: "отделка под аренду отдельной сметой" },
            { says: "без меня сделают криво", answer: "фотоотчет каждый день и приемка по этапам" }
          ],
          choose: ["срок сдачи", "фотоотчет"]
        }
      ],
      words: [
        { say: "под ключ и без сюрпризов", src: "persona" },
        { say: "лишь бы смета не поехала", src: "forum" },
        { say: "нужен прораб на объекте", src: "forum" },
        { say: "хочу видеть отчет каждый день", src: "client" }
      ]
    },
    competitors: { market: { must_have: ["hero", "price", "steps"] }, seen_numbers: [] },
    facts,
    constraints: { forbidden: ["дешево"], must_say: ["работаем по договору"] },
    lexicon: { canonical: ["ремонт под ключ"], locked: ["прораб"] },
    gaps: [
      { id: "g1", ask: "Сколько стоит квадратный метр отделки", hits: ["price"] },
      { id: "g2", ask: "Есть ли фотографии сданных объектов", hits: ["cases"] }
    ]
  };
}

// Контракт хорошо заполненного проекта: мерка владельца - около 15000 знаков. Та же
// форма, что у baseProject, но фактуры столько, сколько дает живой проект после интейка
// и разведки. На нем и проверяется пропорция вместе с методичкой.
function richProject() {
  const p = baseProject("multipage");
  const q = ["hero", "price", "steps", "docs", "cases", "geo", "scope", "qa", "reviews", "numbers", "edge", "delivery"];
  const extra = [];
  for (let i = 0; i < 26; i++) {
    extra.push({
      id: "x" + String(i + 1).padStart(2, "0"),
      label: "Показатель работ номер " + (i + 1),
      value: (120 + i * 7) + " объектов сдано по этому направлению за прошлый сезон",
      q: [q[i % q.length]], publish: "yes", src: "документ",
      artifact: "doc/otchet-" + (i + 1) + ".pdf"
    });
  }
  p.facts = p.facts.concat(extra);
  for (let i = 0; i < 3; i++) {
    p.audience.segments.push({
      id: "s" + (i + 3),
      name: "Сегмент номер " + (i + 3) + ": собственник помещения под сдачу",
      pain: ["работы затягиваются и срывают заезд арендатора", "смета растет после демонтажа"],
      objection: [
        { says: "выйдет дороже, чем в смете", answer: "цена фиксируется в договоре, доплата только за новые работы по допсоглашению" },
        { says: "бригада уйдет на другой объект", answer: "бригада закреплена за адресом до подписи акта, это записано в договоре" }
      ],
      choose: ["фиксированная смета", "свой прораб на объекте", "фотоотчет каждый день"]
    });
  }
  for (let i = 0; i < 10; i++) {
    p.audience.words.push({ say: "фраза заказчика из разбора созвонов номер " + (i + 1) + ", про смету и сроки", src: "forum" });
    p.gaps.push({ id: "g" + (i + 3), ask: "Открытый вопрос заказчику номер " + (i + 1) + " про состав работ и подтверждение", hits: [q[i % q.length]] });
  }
  for (let i = 0; i < 5; i++) {
    p.offer.reasons.push({
      claim: "Причина выбрать нас номер " + (i + 1) + ": работа закрыта документом",
      proof: "скан документа с номером и сроком действия в архиве проекта",
      kind: "документ"
    });
  }
  return p;
}

function putProject(name, project) {
  const dir = join(SANDBOX, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "queue.json"), JSON.stringify({
    v: 2, slug: project.slug, dir: "sites/001-" + project.slug, created: "2026-09-16",
    tier: "seo", type: "services", site_kind: project.business.site_kind,
    docs: { understood: "https://drive.test/u", ask: "https://drive.test/a" },
    gate: { approved: true, by: "оператор", at: "2026-09-16" }, journal: []
  }, null, 2) + "\n", "utf8");
  writeFileSync(join(dir, "project.json"), JSON.stringify(project, null, 2) + "\n", "utf8");
  return dir;
}

function putPage(dir, name, body) {
  mkdirSync(join(dir, "pages"), { recursive: true });
  writeFileSync(join(dir, "pages", name + ".md"), body, "utf8");
}

// Замер лидеров: одна форма на все фикстуры правил состава.
function lead(cluster, cov, over = {}) {
  const pages = (over.pages || []).map((blocks, i) => ({
    url: "https://l" + (i + 1) + ".test/", pos: i + 1, chars: 1300, blocks
  }));
  return Object.assign({
    v: 1, cluster, at: "2026-09-16", attempted: 10, alive: 10, measured: true,
    cov, cov_evidence: {}, blocks_median: 9, chars_median: 1300,
    order: Object.keys(cov), form: {}, extra: [], tainted: [], pages
  }, over, { pages });
}

// Эталонная написанная страница лендинга. Все числа тут - из facts[] с publish yes.
const PAGE_OK = `---
title: Невский Ремонт: ремонт квартир под ключ в Санкт-Петербурге
description: Ремонт квартир под ключ в Санкт-Петербурге. Смета по пунктам до начала работ, цена держится до подписи акта.
---

# Ремонт квартир под ключ в Санкт-Петербурге: смета до начала работ

<!-- q:hero closes:f02 -->
Замерщик выезжает через 2 часа по городу, смета по пунктам приходит до начала работ.
Цену фиксируем в договоре, и до подписи акта она держится.

[Рассчитать смету по вашей квартире](/zayavka/)

<!-- q:numbers closes:f03,f04,f06 -->
## 9 лет на рынке, 137 объектов, 12 бригад в работе

Работаем 9 лет на рынке и держим 12 бригад: объект не стоит в очереди за свободными
руками. Сдано 137 объектов, и каждый принят по акту.

<!-- q:scope closes:f10 -->
## В работу входит 7 этапов: от демонтажа до сдачи по акту

Демонтаж, разводка воды и электрики, выравнивание стен, стяжка пола, укладка плитки,
чистовая отделка, сборка сантехники. Состав написан в смете по пунктам, и каждый пункт
принимается отдельно.

<!-- q:edge closes:f01,f07 -->
## Свой прораб ведет объект и отвечает за сроки

Прораб на объекте каждый день, и вопросы решаются на месте, а не письмами.
Гарантия 3 года по договору закрывает и скрытые работы, лицензия номер 1234 от 2019 года
лежит в папке документов и открывается по ссылке.

<!-- q:price closes:f05 -->
## Цена считается от площади: от 4500 руб за кв м под ключ

Считаем по площади и составу работ. Смета по пунктам приходит до начала работ, и сумма
в ней держится до подписи акта. Материалы выбираете сами и платите по чекам.

<!-- q:price_factors closes:f15,o1.1 -->
## Почему выходит дороже объявления: три условия

Цену двигают состояние стен, число точек электрики и класс отделки. Условия названы в
смете отдельными строками, и фиксация цены в договоре закрывает доплату за то, что уже
посчитано и подписано обеими сторонами.

<!-- q:steps closes:f02,f08 -->
## После заявки: замер через 2 часа, работы 14 дней на объект

1. Заявка и звонок прораба в тот же день.
2. Замер через 2 часа по городу, бесплатно.
3. Смета по пунктам и договор с фиксацией цены.
4. Работы 14 дней на объект, фотоотчет каждый день.
5. Приемка по акту и передача ключей.

<!-- q:cases closes:f04,f08 -->
## Сдано 137 объектов, каждый за 14 дней на объект

Квартира в новостройке: черновая и чистовая отделка, срок 14 дней на объект, приемка
без замечаний. Вторичное жилье: демонтаж, разводка и отделка, тот же срок и та же
смета по пунктам.

<!-- q:reviews closes:f12 -->
## Что говорят те, кто платил

Клиенты приходят за предсказуемой сметой и за прорабом, который берет трубку.
Оценки собраны на картах, там же лежат фотографии сданных квартир.

<!-- q:cta_form closes:f02 -->
## Оставьте заявку, прораб позвонит и назначит замер

[Получить смету по вашей квартире](/zayavka/)

---
мысль: бригада видна по смете и срокам, а не по обещаниям
недостает: номер записи в реестре, срок гарантии на скрытые работы
канон: ремонт под ключ
`;

// Страницы лидера: живая и мертвая. Живость - это 3 заголовка И 800 знаков из main.
const filler = (n, w) => new Array(n).fill(w).join(" ");
const leaderHtml = (withPrice) => `<html><body><header><nav><a href="/">Главная</a></nav></header><main>
<h1>Ремонт ванной комнаты под ключ</h1>
<p>Делаем ремонт ванной под ключ в городе и области. ${filler(20, "Замер бесплатный и смета до начала работ.")}</p>
<button>Записаться на замер</button>
<h2>Что входит в работу</h2>
<ul><li>демонтаж</li><li>разводка воды</li><li>стяжка пола</li><li>укладка плитки</li><li>сборка сантехники</li><li>вывоз мусора</li></ul>
${withPrice ? '<h2>Цены на ремонт ванной</h2><table><tr><td>Ремонт под ключ</td><td>2400 руб</td></tr><tr><td>Косметический ремонт</td><td>1200 руб</td></tr><tr><td>Санузел целиком</td><td>3100 руб</td></tr></table>' : ""}
<h2>Как мы работаем</h2>
<ol><li>заявка</li><li>замер за 1 день</li><li>смета</li><li>работы 14 дней</li><li>приемка</li></ol>
<h2>Оставьте заявку на замер</h2>
<form><input name="name"><input name="phone"><textarea name="msg"></textarea></form>
</main><footer><p>Контакты</p></footer></body></html>`;
const deadHtml = '<html><body><main><h1>Ремонт</h1><p>Коротко.</p><h2>Цены</h2><p>По запросу.</p></main></body></html>';

// ──────────────────────────────────────────────────────────────────────────
console.log("=== Файлы слоя письма и потолки в знаках ===");
// ──────────────────────────────────────────────────────────────────────────

step("все файлы слоя письма лежат на диске и не пусты", () => {
  const bad = MADE.filter((rel) => {
    const p = join(ROOT, rel);
    return !existsSync(p) || chars(text(p)) < 200;
  });
  return bad.length ? `нет или пусты: ${bad.join(", ")}` : true;
});

step("SKILL.md /site proto: потолок 12000 знаков", () => {
  const n = chars(text(join(SKILL_DIR, "SKILL.md")));
  return n <= 12000 ? true : `${n} знаков`;
});

step("AUTHOR.md: потолок 8000 знаков", () => {
  const n = chars(text(join(SKILL_DIR, "AUTHOR.md")));
  return n <= 8000 ? true : `${n} знаков`;
});

step("AUTHOR.md: запретов не больше 2500 знаков", () => {
  const n = TASKM.banChars(text(join(SKILL_DIR, "AUTHOR.md")));
  return n <= TASKM.CAP_BAN ? true : `${n} знаков запретов при потолке ${TASKM.CAP_BAN}`;
});

step("промты слоя письма: потолок 10000 знаков каждый", () => {
  const bad = PROMPTS.map((rel) => ({ rel, n: chars(text(join(ROOT, rel))) })).filter((x) => x.n > 10000);
  return bad.length ? bad.map((x) => `${x.rel}: ${x.n}`).join("; ") : true;
});

step("rules.yml: потолок 6000 знаков", () => {
  const n = chars(text(RULES_YML));
  return n <= 6000 ? true : `${n} знаков`;
});

// ──────────────────────────────────────────────────────────────────────────
console.log("");
console.log("=== ИНВАРИАНТ ПРОПОРЦИИ: материала больше, чем инструкций ===");
// ──────────────────────────────────────────────────────────────────────────

const multiDir = putProject("multi", baseProject("multipage"));
const landDir = putProject("land", baseProject("landing"));

const capsOf = (dir) => {
  const p = runJson([PAGES, dir, "--root", ROOT]);
  if (p.code === 2) throw new Error("pages.mjs: " + p.all.slice(0, 200));
  run([PAGES, dir, "--root", ROOT]);
  run([PLAN, dir, "--root", ROOT]);
  const t = runJson([TASKS, dir, "--root", ROOT]);
  if (!t.json) throw new Error("build-tasks не дал json: " + t.all.slice(0, 300));
  return t.json.tasks;
};
let CAPS = [];
try { CAPS = capsOf(multiDir); } catch (err) { console.log(`  [note] задания не собрались: ${err.message}`); }

// Пропорция печатается числами: «зеленый» без цифр в этом разделе значит ровно столько же,
// сколько значил в v7 валидатор с 33 предупреждениями, которые перестали читать.
if (CAPS.length) {
  const c = CAPS[0].caps;
  const outer = c.instr - c.task;
  console.log(`  [замер] ${CAPS[0].name}: инструкции ${c.instr}/${TASKM.CAP_INSTR} (вне задания ${outer} + задание ${c.task}), ` +
    `запреты ${c.ban}/${TASKM.CAP_BAN}, материал ${c.mat}/${TASKM.CAP_MAT}; ` +
    `больше задания ${c.ok_task ? "да" : "НЕТ"}, больше всех инструкций ${c.ok_more ? "да" : "нет"}`);
}

step("типовое задание: ИНСТРУКЦИИ автора не больше 12000 знаков", () => {
  if (!CAPS.length) return "заданий нет, считать нечего";
  // Список инструктивных файлов один и объявлен в скрипте: считать потолок по другому
  // списку значило бы мерить не то, что придет автору.
  if (!TASKM.INSTR_FILES.length) return "список инструкций автора пуст: считать потолок не по чему";
  const miss = TASKM.INSTR_FILES.filter((rel) => !existsSync(join(ROOT, rel)));
  if (miss.length) return `объявлены, но не написаны: ${miss.join(", ")}`;
  const want = [".claude/agents/site-author.md", ".claude/skills/site-proto/AUTHOR.md"];
  const out = want.filter((w) => !TASKM.INSTR_FILES.includes(w));
  if (out.length) return `в счет потолка не входит: ${out.join(", ")}`;
  const bad = CAPS.filter((t) => !t.caps.ok_instr);
  if (!bad.length) return true;
  const w = bad[0];
  return `${bad.length} из ${CAPS.length} страниц пробивают потолок; ${w.name}: ${w.caps.instr} из ${TASKM.CAP_INSTR}`;
});

step("типовое задание: МАТЕРИАЛ не больше 16000 знаков", () => {
  if (!CAPS.length) return "заданий нет, считать нечего";
  const bad = CAPS.filter((t) => !t.caps.ok_mat);
  return bad.length ? `${bad[0].name}: материал ${bad[0].caps.mat} из ${TASKM.CAP_MAT}` : true;
});

step("ГЛАВНЫЙ ИНВАРИАНТ ЭТАПА: материала больше, чем ЗАДАНИЯ", () => {
  // Задание - это то, что конвейер пишет сам. В v7 писателю приезжало 32982 знака
  // собранного задания при материале в остатке; за раздувание задания отвечает конвейер,
  // и потому тут жесткий отказ, а не предупреждение.
  if (!CAPS.length) return "заданий нет, считать нечего";
  const bad = CAPS.filter((t) => !t.caps.ok_task);
  if (!bad.length) return true;
  const w = bad[0];
  return `пропорция обратная, как в v7: ${w.name} - материала ${w.caps.mat} против ${w.caps.task} знаков задания (страниц с обратной пропорцией ${bad.length} из ${CAPS.length})`;
});

step("на хорошо заполненном контракте материала больше, чем ВСЕХ инструкций", () => {
  // Мерка владельца названа прямо: контракт хорошо заполненного проекта - около 15000
  // знаков. На нем пропорция обязана сойтись целиком, вместе с методичкой. Если не
  // сходится - раздуты инструкции, и резать надо их.
  const rich = richProject();
  const size = chars(JSON.stringify(rich, null, 2));
  if (size < 13000) return `фикстура не дотягивает до мерки владельца: контракт ${size} знаков вместо ~15000`;
  let caps, richDir;
  try { richDir = putProject("rich", rich); caps = capsOf(richDir); run([TASKS, richDir, "--root", ROOT]); }
  catch (err) { return `задания не собрались: ${err.message}`; }
  const over = caps.filter((t) => !t.caps.ok_mat);
  if (over.length) return `лестница усушки не держит потолок: материал ${over[0].caps.mat} из ${TASKM.CAP_MAT}`;
  const bad = caps.filter((t) => !t.caps.ok_more);
  if (!bad.length) {
    const c = caps[0].caps;
    console.log(`  [замер] контракт ${size} знаков: материал ${c.mat} против ${c.instr} инструкций`);
    const task = text(join(richDir, "tasks", caps[0].name + ".md"));
    if (!/Из материала снято по потолку/.test(task)) return "материал усох молча: что именно срезано, автору не сказано";
    return true;
  }
  const w = bad[0];
  return `контракт ${size} знаков, а материала ${w.caps.mat} против ${w.caps.instr} инструкций (${w.name}): методичка перевешивает фактуру`;
});

step("тонкий контракт не валит сборку, а называет причину", () => {
  // Обратная пропорция при потолке инструкций 12000 и потолке материала 16000 означает
  // ровно одно: контракт тоньше методички. Это факт о проекте. Ронять им сборку значит
  // требовать фактуру ценой несобираемого сайта - в v7 так и рождались [] на странице.
  const thin = CAPS.filter((t) => !t.caps.ok_more);
  if (!thin.length) return true;
  const r = run([TASKS, multiDir, "--root", ROOT]);
  if (r.code !== 0) return `тонкий контракт уронил шаг 5, код ${r.code}: ${r.all.slice(0, 200)}`;
  if (!/контракт тоньше/.test(r.all)) return "причина не названа: в отчете нет строки про тонкий контракт";
  return true;
});

step("build-tasks честно валит прогон, когда потолок пробит", () => {
  if (!CAPS.length) return "заданий нет, считать нечего";
  const overBan = CAPS.filter((t) => !t.caps.ok_ban);
  if (overBan.length) return `${overBan[0].name}: запретов ${overBan[0].caps.ban} из ${TASKM.CAP_BAN}`;
  const r = run([TASKS, multiDir, "--root", ROOT]);
  const bad = CAPS.filter((t) => !(t.caps.ok_instr && t.caps.ok_ban && t.caps.ok_mat && t.caps.ok_task)).length;
  if (bad && r.code === 0) return "потолки пробиты, а код выхода нулевой: сборка молча пропускает раздутый вход";
  if (!bad && r.code !== 0) return `потолки в норме, а код выхода ${r.code}`;
  if (bad && !/потолки нарушены/.test(r.all)) return "код выхода ненулевой, но разбора по страницам в отчете нет";
  return true;
});

// ──────────────────────────────────────────────────────────────────────────
console.log("");
console.log("=== ИНВАРИАНТ ОБРАЗЦОВ: приемов больше, чем запретов ===");
// ──────────────────────────────────────────────────────────────────────────

step("в AUTHOR.md и в промтах приемов и образцов больше, чем запретов", () => {
  if (typeof TASKM.banCount !== "function") return "запреты считать нечем: build-tasks не отдает banCount";
  const t = text(join(SKILL_DIR, "AUTHOR.md"));
  const ban = TASKM.banCount(t), sample = countBy(t, SAMPLE_RE);
  if (!sample) return "в AUTHOR.md ни одного образца по явному маркеру: счетчик меряет не то";
  if (sample <= ban) return `AUTHOR.md: запретов ${ban}, приемов и образцов ${sample}: запрет добавляется только вместе с образцом`;
  const bad = [];
  for (const rel of PROMPTS.concat([".claude/skills/site-proto/SKILL.md"])) {
    const x = text(join(ROOT, rel));
    const b = TASKM.banCount(x), n = countBy(x, SAMPLE_RE);
    if (b > n) bad.push(`${rel}: запретов ${b}, образцов ${n}`);
  }
  return bad.length ? bad.join("; ") : true;
});

step("счетчик запретов видит прозаический запрет, а не только заглавное НЕ", () => {
  // Проверка самой проверки. В v7 счетчик ловил «НЕ» заглавными и несколько глаголов, а
  // шесть запретов подряд обычной прозой давали ноль: инвариант подтверждался случайно.
  const sample = [
    "## Чего в тексте не появляется",
    "- Число вне facts с publish yes.",
    "- Свой счет на лету: годовое поделить на 12.",
    "- Кавычки на речи из words с src persona."
  ].join("\n");
  const n = TASKM.banCount(sample);
  if (n < 3) return `шесть строк запрета посчитаны как ${n}: счетчик декоративен`;
  const clean = "Заголовок раздела - ответ на вопрос читателя, а не ярлык секции.";
  return TASKM.banCount(clean) === 0 ? true : "обычная строка посчитана запретом";
});

step("в AUTHOR.md полных образцов блока не меньше трех", () => {
  const t = text(join(SKILL_DIR, "AUTHOR.md"));
  const full = (t.match(/```[\s\S]*?```/g) || []).filter((b) => /<!--\s*q:[a-z0-9_]+/i.test(b) && b.split(/\r?\n/).filter((l) => l.trim()).length >= 4);
  return full.length >= 3 ? true : `полных образцов ${full.length}: образец без метки и без тела не показывает, как пишется раздел`;
});

step("в задании автору цифр лидеров нет: tainted ему не показывают", () => {
  const f = join(multiDir, "tasks");
  if (!existsSync(f)) return "заданий на диске нет";
  const bad = readdirSync(f).filter((n) => n.endsWith(".md")).filter((n) => /tainted|ядовит/i.test(text(join(f, n))));
  if (bad.length) return `цифры лидеров уехали в задание: ${bad.join(", ")}`;
  const src = text(TASKS);
  return /tainted/.test(src.replace(/^\s*\/\/.*$/gm, "")) ? "build-tasks читает tainted вне комментария" : true;
});

// ──────────────────────────────────────────────────────────────────────────
console.log("");
console.log("=== Бюджеты количества ===");
// ──────────────────────────────────────────────────────────────────────────

step("правил состава ровно 6, и их id совпадают с объявленными", () => {
  if (PLANM.RULE_IDS.length !== 6) return `объявлено ${PLANM.RULE_IDS.length} id правил`;
  if (PLANM.RULES.length !== 6) return `в коде ${PLANM.RULES.length} правил`;
  const bad = PLANM.RULES.map((r, i) => (r.id === PLANM.RULE_IDS[i] ? "" : `${i + 1}: ${r.id} против ${PLANM.RULE_IDS[i]}`)).filter(Boolean);
  return bad.length ? bad.join(", ") : true;
});

step("седьмое правило состава валит сборку на импорте, а не на ревью", () => {
  const src = text(PLAN).replace(/from "\.\/([a-z_-]+\.mjs)"/g, (m, f) => `from ${JSON.stringify(pathToFileURL(join(SITE_SCRIPTS, f)).href)}`);
  const anchor = "\n];\n\nconst bottom";
  if (!src.includes(anchor)) return "не найден конец списка правил: тест не может внести седьмое";
  const patched = src.replace(anchor, ',\n  { id: "R7", name: "седьмое правило", apply() {} }\n];\n\nconst bottom');
  const f = join(SANDBOX, "plan-r7.mjs");
  writeFileSync(f, patched, "utf8");
  const r = run([f]);
  if (r.code === 0) return "седьмое правило принято молча: счетчик правил состава не сторожит";
  return /правил состава/.test(r.all) ? true : `упало, но не по счету правил: ${r.all.slice(0, 160)}`;
});

step("rules.yml и проверки verify-page - ОДИН список, и в нем не больше 12 правил на раздел", () => {
  const rules = VPM.readRules(RULES_YML);
  if (!rules) return "реестр не читается";
  const over = VPM.SECTIONS.filter((s) => rules[s].size > VPM.RULES_MAX)
    .map((s) => `${s}: ${rules[s].size} при потолке ${VPM.RULES_MAX}`);
  if (over.length) return over.join("; ");
  const bad = VPM.crosscheck(rules);
  return bad ? bad : true;
});

// Подложный корень: реестр меняем, скрипты берем настоящие.
function fakeRoot(name, rulesText) {
  const root = join(SANDBOX, name);
  mkdirSync(join(root, ".claude/skills/site-proto"), { recursive: true });
  writeFileSync(join(root, ".claude/skills/site-proto/rules.yml"), rulesText, "utf8");
  cpSync(PAGES_YML, join(root, ".claude/skills/site-proto/pages.yml"));
  return root;
}

step("реестр сторожит с обеих сторон: чужое правило, пропавшее правило и тринадцатое", () => {
  const raw = text(RULES_YML);
  const renamed = raw.replace(/^ {2}jargon:/m, "  zhargon_kuhni:");
  if (renamed === raw) return "в реестре нет правила jargon: тест переименовывать нечего";
  const r1 = run([VPAGE, landDir, "--root", fakeRoot("root-renamed", renamed), "--json"]);
  if (r1.code !== 2) return `переименованное правило прошло, код ${r1.code}`;
  if (!/правило, а проверки нет|проверка есть, а правила/.test(r1.all)) return `упало не по сверке реестра: ${r1.all.slice(0, 160)}`;
  const dropped = raw.replace(/^ {2}jargon:.*$\n/m, "");
  const r2 = run([VPAGE, landDir, "--root", fakeRoot("root-dropped", dropped), "--json"]);
  if (r2.code !== 2) return `снятое из реестра правило прошло, код ${r2.code}`;
  if (!/проверка есть, а правила в реестре нет/.test(r2.all)) return `упало не по сверке: ${r2.all.slice(0, 160)}`;
  const bloated = raw.replace(/^block:$/m, 'block:\n  lishnee:       "тринадцатое правило сверх потолка"');
  if (bloated === raw) return "в реестре нет раздела block";
  const r3 = run([VPAGE, landDir, "--root", fakeRoot("root-13", bloated), "--json"]);
  if (r3.code !== 2) return `тринадцатое правило принято, код ${r3.code}`;
  return /потолок 12/.test(r3.all) ? true : `упало не по потолку: ${r3.all.slice(0, 160)}`;
});

step("таблица правок site-editor и раздел block реестра - один список", () => {
  // site-editor.md - второй реестр тех же id, и его не сверяет никто. Перенос правила из
  // block в warn одной строкой rules.yml оставил бы правщику инструкцию к правилу, которого
  // он больше не увидит, а новое блокирующее приехало бы без инструкции, что с ним делать.
  const rules = VPM.readRules(RULES_YML);
  const block = [...rules.block.keys()];
  if (!block.length) return "в реестре нет раздела block";
  const t = text(join(AGENTS, "site-editor.md"));
  const head = t.indexOf("## Двенадцать блокирующих правил");
  if (head < 0) return "в site-editor.md нет таблицы правок: правщику не по чему работать";
  const tail = t.indexOf("## ", head + 4);
  const table = t.slice(head, tail < 0 ? t.length : tail);
  const listed = [...table.matchAll(/^\|\s*`([a-z0-9_]+)`\s*\|/gm)].map((m) => m[1]);
  const miss = block.filter((id) => !listed.includes(id));
  const extra = listed.filter((id) => id !== "id" && !block.includes(id));
  if (miss.length) return `блокирующее правило без инструкции правщику: ${miss.join(", ")}`;
  if (extra.length) return `в таблице правок правило, которого нет в block: ${extra.join(", ")}`;
  return true;
});

step("скриптов в .claude/scripts/site: не больше 20", () => {
  const list = readdirSync(SITE_SCRIPTS).filter((f) => f.endsWith(".mjs"));
  return list.length <= 20 ? true : `${list.length} скриптов: ${list.join(", ")}`;
});

step("агентов конвейера v8: не больше 8 и восьмое место свободно", () => {
  // Счет идет по ОБЪЯВЛЕННОМУ списку, а не по глобу site-*.md: в .claude/agents лежат
  // site-reviewer и site-scanner из v7, они делят префикс и к слою письма отношения не
  // имеют. Глоб мерил бы чужое и не видел leader-mapper, названного без префикса.
  const list = CONTRACT.AGENTS_V8, cap = CONTRACT.AGENTS_V8_CAP;
  if (!Array.isArray(list) || !list.length) return "список агентов конвейера пуст: считать бюджет не по чему";
  if (cap !== 8) return `потолок агентов ${cap} против 8`;
  const dup = list.filter((x, i) => list.indexOf(x) !== i);
  if (dup.length) return `в списке повтор: ${dup.join(", ")}`;
  const miss = list.filter((n) => !existsSync(join(AGENTS, n + ".md")));
  if (miss.length) return `объявлены, но не написаны: ${miss.join(", ")}`;
  const want = ["site-intake", "site-market", "leader-mapper", "site-author", "site-strengthener", "site-judge", "site-editor"];
  const out = want.filter((w) => !list.includes(w));
  if (out.length) return `в счет бюджета не входит: ${out.join(", ")}`;
  if (list.length > cap) return `${list.length} агентов при потолке ${cap}: ${list.join(", ")}`;
  if (list.length > cap - 1) return `место занято целиком: ${list.length} из ${cap} (${list.join(", ")}); слоту про запас взяться неоткуда`;
  return true;
});

step("усиление: маркеров ровно 6, действий ровно 4, и все четыре на добавление", () => {
  if (LIFTM.MARKER_IDS.length !== 6 || LIFTM.MARKERS.length !== 6) return `маркеров ${LIFTM.MARKERS.length} против 6`;
  const acts = Object.keys(LIFTM.ACTS);
  if (acts.length !== 4 || LIFTM.ACT_ORDER.length !== 4) return `действий ${acts.length} против 4`;
  const cut = acts.filter((a) => /(^|[^а-я])(рез|сокра|убра|удал|снят|урез)/i.test(a + " " + LIFTM.ACTS[a]));
  return cut.length ? `действие умеет резать: ${cut.join(", ")}` : true;
});

// ──────────────────────────────────────────────────────────────────────────
console.log("");
console.log("=== Детерминизм плана ===");
// ──────────────────────────────────────────────────────────────────────────

step("один и тот же замер дает байт-в-байт тот же план", () => {
  const dir = putProject("det", baseProject("multipage"));
  run([PAGES, dir, "--root", ROOT]);
  mkdirSync(join(dir, "leaders"), { recursive: true });
  const L = lead("service", { hero: 1, scope: 1, price: 1, steps: 0.8, cases: 0.7, qa: 0.7, cta_form: 1, docs: 0.7 },
    { pages: [["hero", "scope", "price"], ["hero", "price", "steps"], ["hero", "scope", "qa"]] });
  writeFileSync(join(dir, "leaders", "service.json"), JSON.stringify(L, null, 2) + "\n", "utf8");
  const a = run([PLAN, dir, "--root", ROOT, "--json"]);
  const b = run([PLAN, dir, "--root", ROOT, "--json"]);
  if (a.code === 2 || b.code === 2) return `план не собрался: ${a.all.slice(0, 160)}`;
  if (a.stdout !== b.stdout) return "два прогона одного замера дали разный план";
  // Порядок ключей замера на план влиять не может: иначе воспроизводимости нет.
  const shuffled = JSON.parse(JSON.stringify(L));
  shuffled.cov = Object.fromEntries(Object.entries(L.cov).reverse());
  writeFileSync(join(dir, "leaders", "service.json"), JSON.stringify(shuffled, null, 2) + "\n", "utf8");
  const c = run([PLAN, dir, "--root", ROOT, "--json"]);
  return c.stdout === a.stdout ? true : "порядок ключей в замере поменял план";
});

// ──────────────────────────────────────────────────────────────────────────
console.log("");
console.log("=== Шесть правил состава на фикстурах ===");
// ──────────────────────────────────────────────────────────────────────────

const HOME = { slug: "", type: "home", marker: "ремонт квартир", url: "/", dir: null, name: "Главная" };
const SERVICE = { slug: "remont-vannoy", type: "service", marker: "ремонт ванной комнаты", url: "/remont-vannoy/", dir: "remont-vannoy", name: "Ремонт ванной" };
const HOME_COV = { hero: 1, numbers: 0.9, nav: 0.8, edge: 0.8, cases: 0.7, about: 0.7, cta_mid: 0.6, cta_form: 1 };
const planOf = (project, page, L, kind = "multipage") => PLANM.planPage(project, page, L, ymlReal, kind, PLANM.CATALOG_ONLY).out;
const act = (out) => out.blocks.filter((b) => b.ord).map((b) => b.id);
const modeOf = (out, id) => (out.blocks.find((b) => b.id === id) || {}).mode || "нет в плане";
const cutOf = (out, id) => (out.blocks.find((b) => b.id === id) || {}).cut || "";

step("R1: покрытие 0.7 поднимает опциональный блок в состав", () => {
  const p = baseProject("multipage");
  const off = planOf(p, HOME, lead("home", Object.assign({}, HOME_COV, { docs: 0.1 })));
  if (act(off).includes("docs")) return "блок с покрытием 0.1 попал в состав";
  const on = planOf(p, HOME, lead("home", Object.assign({}, HOME_COV, { docs: 0.7 })));
  if (!act(on).includes("docs")) return `покрытие 0.7 блок не подняло: состав ${act(on).join(", ")}`;
  return modeOf(on, "docs") === "work" ? true : `блок поднят, но в режиме ${modeOf(on, "docs")}`;
});

step("R2: блок, найденный у двух живых лидеров, демотируется, а не снимается", () => {
  const p = baseProject("multipage");
  p.competitors.market.must_have = ["hero", "not_fit"];
  const L = lead("home", Object.assign({}, HOME_COV, { reviews: 0.2 }), {
    blocks_median: 9,
    pages: [["hero", "reviews"], ["hero", "reviews"], ["hero", "numbers"]]
  });
  const out = planOf(p, HOME, L);
  if (!act(out).includes("reviews")) return "блок с признаком у двух живых лидеров снят вовсе";
  if (modeOf(out, "reviews") !== "tmpl") return `демотации не случилось, режим ${modeOf(out, "reviews")}`;
  // Контроль: блок без рынка, без фактуры и без второго упоминания снимается.
  if (act(out).includes("not_fit")) return "блок без рынка и без фактуры остался на странице";
  return modeOf(out, "not_fit") === "stub" ? true : `снятый блок не помечен stub: ${modeOf(out, "not_fit")}`;
});

step("R4 не отменяет R2: узкий бюджет режет сперва незащищенное", () => {
  // Бюджет 6 блоков и спасенный R2 блок в одной фикстуре. Если фильтр бюджета не видит
  // демотированных, спасенный уходит первым: у него покрытие по определению низкое.
  const p = baseProject("multipage");
  const cov = { hero: 1, price: 1, qa: 0.1 };
  for (const id of ["scope", "fit", "edge", "steps", "cases", "reviews", "price_factors", "cta_mid", "cta_form"]) cov[id] = 0.3;
  const L = lead("service", cov, {
    blocks_median: 6,
    pages: [["hero", "price", "qa"], ["hero", "scope", "qa"], ["hero", "price", "steps"]]
  });
  const out = planOf(p, SERVICE, L);
  if (out.bud > 8) return `бюджет ${out.bud} не жмет: фикстура ничего не проверяет`;
  const cheap = act(out).filter((id) => (cov[id] || 0) === 0.3).length;
  if (!cheap) return "бюджет снял вообще все незащищенное: сравнивать не с чем";
  if (!act(out).includes("qa")) return `блок, спасенный R2, снят бюджетом: ${cutOf(out, "qa")}`;
  return modeOf(out, "qa") === "tmpl" ? true : `режим спасенного блока ${modeOf(out, "qa")} вместо tmpl`;
});

step("R3: ядро не снимается ни рынком, ни бюджетом", () => {
  const p = baseProject("multipage");
  const L = lead("home", {}, { blocks_median: 6, pages: [[], [], []] });
  const out = planOf(p, HOME, L);
  const core = ["hero", "nav", "cta_form"];
  const lost = core.filter((id) => !act(out).includes(id));
  if (lost.length) return `ядро снято: ${lost.join(", ")} при составе ${act(out).join(", ")}`;
  const stubbed = core.filter((id) => modeOf(out, id) === "stub");
  return stubbed.length ? `ядро ушло в stub: ${stubbed.join(", ")}` : true;
});

step("R4: объем считается в БЛОКАХ, медиана зажата в вилку типа страницы", () => {
  const p = baseProject("multipage");
  // Замер с маленьким ядром: иначе бюджет держит не медиана, а число неснимаемых блоков.
  const COV = { hero: 1, nav: 0.9, cta_form: 1 };
  const low = planOf(p, HOME, lead("home", COV, { blocks_median: 6, chars_median: 900 }));
  const high = planOf(p, HOME, lead("home", COV, { blocks_median: 20, chars_median: 9000 }));
  const [lo, hi] = PLANM.VOL.home;
  if (low.bud !== 6) return `медиана 6 дала бюджет ${low.bud}`;
  if (high.bud !== hi) return `медиана 20 не зажата в вилку: бюджет ${high.bud} при потолке типа ${hi}`;
  if (high.bud > PLANM.BLOCK_CAP) return `бюджет ${high.bud} выше потолка ${PLANM.BLOCK_CAP}`;
  if (act(high).length > high.bud) return `блоков ${act(high).length} при бюджете ${high.bud}`;
  // Знаки лидеров - справка. Тот же состав при вдесятеро больших знаках обязан совпасть.
  const same = planOf(p, HOME, lead("home", COV, { blocks_median: 6, chars_median: 9000 }));
  if (same.bud !== low.bud) return "знаки лидеров поменяли бюджет: объем считается не в блоках";
  if (lo > low.bud) return `бюджет ${low.bud} ниже нижней границы вилки ${lo}`;
  // Вторая половина того же правила: страница не добивается возражениями.
  const objs = act(planOf(p, SERVICE, lead("service", { hero: 1, price: 1, price_factors: 0.9, qa: 0.9, scope: 0.7, cta_form: 1 }, { blocks_median: 8 })));
  const fnB = objs.filter((id) => String((ymlReal.blocks.get(id) || [])[0]) === "В");
  return fnB.length * 2 <= objs.length ? true : `В-блоков ${fnB.length} из ${objs.length}: ${fnB.join(", ")}`;
});

step("R6: без числа тип ответа понижается, а блок остается на странице", () => {
  const p = baseProject("multipage");
  const f = p.facts.find((x) => x.id === "f05");
  f.value = "цена считается от площади и состояния объекта";
  const out = planOf(p, SERVICE, lead("service", { hero: 1, price: 1, scope: 1, steps: 1, cta_form: 1 }, { blocks_median: 8 }));
  const price = out.blocks.find((b) => b.id === "price");
  if (!price || !price.ord) return "блок price исчез вместо понижения типа ответа";
  if (price.needs === "число") return "тип ответа остался числом при факте без числа";
  if (!PLANM.LADDER.hasOwnProperty(price.needs) && price.needs !== "условие") return `тип ответа «${price.needs}» вне лестницы`;
  if (price.mode !== "work") return `блок ушел в ${price.mode} вместо понижения типа`;
  return price.answers_with.length ? true : "режим work без единого маркера ответа";
});

step("R6: отвечать нечем - блок в stub, и его вопрос уходит заказчику", () => {
  const p = baseProject("multipage");
  p.facts = p.facts.filter((x) => !x.q.includes("price"));
  const out = planOf(p, SERVICE, lead("service", { hero: 1, scope: 1, steps: 1, cta_form: 1, docs: 0 }, { blocks_median: 7 }));
  const docs = out.blocks.find((b) => b.id === "docs");
  if (docs && docs.ord) return "блок без фактуры остался на странице";
  const stub = out.blocks.filter((b) => !b.ord);
  if (!stub.length) return "снятых блоков нет вовсе: строке в вопросы заказчику взяться неоткуда";
  const bad = stub.filter((b) => b.mode !== "stub" || b.answers_with.length);
  return bad.length ? `снятый блок несет режим или маркеры: ${bad.map((b) => b.id).join(", ")}` : true;
});

step("типа article конвейер не порождает нигде", () => {
  if (CONTRACT.PAGE_TYPES.includes("article")) return "article есть в списке типов страниц контракта";
  if (PLANM.TYPES_NOW.includes("article") || Object.keys(PLANM.CLUSTER_OF).includes("article")) return "article есть в plan.mjs";
  if (RECONM.CLUSTERS.includes("article")) return "article есть в кластерах замера";
  if (yml.skel.has("article")) return "article есть в skel pages.yml";
  const plan = readJson(join(multiDir, "plan.json"));
  const bad = plan.pages.filter((p) => p.page.type === "article").map((p) => p.page.url);
  return bad.length ? `план породил article: ${bad.join(", ")}` : true;
});

// ──────────────────────────────────────────────────────────────────────────
console.log("");
console.log("=== Замер лидеров ===");
// ──────────────────────────────────────────────────────────────────────────

function putRaw(name, cluster, files) {
  const dir = putProject(name, baseProject("multipage"));
  const raw = join(dir, "leaders_raw", cluster);
  mkdirSync(raw, { recursive: true });
  files.forEach((html, i) => writeFileSync(join(raw, "p" + (i + 1) + ".html"), html, "utf8"));
  return dir;
}
const known = new Set(ymlReal.blocks.keys());

step("признак живости: страница с двумя заголовками живой не считается", () => {
  const alive = MAPM.markAlive(MAPM.readPage(leaderHtml(true), { url: "https://a.test/", pos: 1 }));
  const dead = MAPM.markAlive(MAPM.readPage(deadHtml, { url: "https://d.test/", pos: 4 }));
  if (!alive.alive) return `живая страница не опознана: заголовков ${alive.headings}, знаков ${alive.chars}`;
  if (dead.alive) return `страница на ${dead.headings} заголовка и ${dead.chars} знаков засчитана живой`;
  if (dead.headings >= MAPM.ALIVE_HEADINGS) return "мертвая фикстура набрала порог заголовков: тест ничего не меряет";
  return true;
});

step("покрытие считается от ЖИВЫХ страниц, а не от попыток, и числа лидеров идут в tainted", () => {
  const dir = putRaw("recon3", "service", [leaderHtml(true), leaderHtml(true), leaderHtml(false), deadHtml]);
  const r = RECONM.parseCluster(dir, "service", known);
  if (!r.data) return `замер не разобран: ${JSON.stringify(r).slice(0, 160)}`;
  const d = r.data;
  if (d.alive !== 3 || d.attempted !== 4) return `живых ${d.alive} из ${d.attempted}, ожидалось 3 из 4`;
  if (!d.measured) return "три живые страницы не дали measured true";
  if (d.cov.price !== 0.67) return `покрытие price ${d.cov.price}: от попыток вышло бы 0.5, от живых 0.67`;
  if (!d.tainted.length) return "чужих чисел не собрано вовсе";
  const own = d.tainted.filter((t) => /2400|1200|3100/.test(t));
  return own.length ? true : `в tainted нет цен лидера: ${d.tainted.join(", ")}`;
});

step("живых меньше трех - measured false, R1 и R2 не применяются", () => {
  const dir = putRaw("recon2", "service", [leaderHtml(true), leaderHtml(true), deadHtml]);
  const r = RECONM.parseCluster(dir, "service", known);
  if (!r.data) return `замер не разобран: ${JSON.stringify(r).slice(0, 160)}`;
  if (r.data.measured) return `живых ${r.data.alive}, а measured true`;
  if (Object.keys(r.data.cov).length) return "при measured false покрытие все равно посчитано";
  // Правила рынка на таком замере молчат: состав обязан совпасть с составом без замера.
  const p = baseProject("multipage");
  const withLead = planOf(p, SERVICE, Object.assign({}, r.data, { cluster: "service" }));
  const noLead = planOf(p, SERVICE, null);
  return act(withLead).join(",") === act(noLead).join(",") ? true : "непомеренный замер все равно поменял состав";
});

// ──────────────────────────────────────────────────────────────────────────
console.log("");
console.log("=== Проверка написанной страницы ===");
// ──────────────────────────────────────────────────────────────────────────

const vpDir = putProject("vp", baseProject("landing"));
run([PAGES, vpDir, "--root", ROOT]);
run([PLAN, vpDir, "--root", ROOT]);
mkdirSync(join(vpDir, "leaders"), { recursive: true });
writeFileSync(join(vpDir, "leaders", "landing.json"), JSON.stringify({
  v: 1, cluster: "landing", at: "2026-09-16", attempted: 3, alive: 3, measured: false,
  cov: {}, cov_evidence: {}, blocks_median: 0, chars_median: 0, order: [], form: [], extra: [],
  tainted: ["2400 руб", "1200 руб"], pages: []
}, null, 2) + "\n", "utf8");

// Один прогон на случай: страница пишется, verify-page зовется, находки разбираются.
function vp(body) {
  putPage(vpDir, "index", body);
  const r = runJson([VPAGE, vpDir, "--root", ROOT]);
  const page = r.json && r.json.pages && r.json.pages[0];
  return {
    code: r.code, all: r.all,
    found: page ? page.found : [],
    block: page ? page.found.filter((f) => f.level === "block") : [],
    warn: page ? page.found.filter((f) => f.level === "warn") : []
  };
}

step("чистая страница проходит: блокирующих ноль", () => {
  const r = vp(PAGE_OK);
  if (r.code === 2) return `проверка не состоялась: ${r.all.slice(0, 200)}`;
  return r.block.length ? r.block.map((f) => `${f.id} ${f.block}:${f.line} ${f.msg}`).join(" | ") : true;
});

step("число не из фактов - блокирующее нарушение", () => {
  // 23 не выводится из фактов ни одним шагом лестницы: находка обязана быть именно
  // «числа нет в фактах», а не более точное «посчитано на лету».
  const r = vp(PAGE_OK.replace("Работаем 9 лет на рынке", "Работаем 23 года на рынке"));
  const hit = r.block.filter((f) => f.id === "num_off_facts");
  if (!hit.length) return `23 года прошло молча, найдено: ${r.found.map((f) => f.id).join(", ") || "ничего"}`;
  if (r.code !== 1) return `нарушение найдено, а код выхода ${r.code}`;
  // Число, посчитанное на лету из чужого, ловится отдельным правилом и тоже блокирует.
  const a = vp(PAGE_OK.replace("Работаем 9 лет на рынке", "Работаем 25 лет на рынке"));
  return a.block.some((f) => f.id === "arith") ? true : "арифметика на лету прошла мимо своего правила";
});

step("«около 30 минут» - блокирующее нарушение, а не мягкая формулировка", () => {
  const r = vp(PAGE_OK.replace("смета по пунктам приходит до начала работ.", "смета готова около 30 минут."));
  const hit = r.block.filter((f) => f.id === "hedge");
  return hit.length ? true : `смягчитель прошел, найдено: ${r.found.map((f) => f.id).join(", ") || "ничего"}`;
});

step("ядовитое число лидера - блокирующее нарушение", () => {
  const r = vp(PAGE_OK.replace("от 4500 руб за кв м под ключ", "2400 руб за кв м под ключ"));
  const hit = r.block.filter((f) => f.id === "tainted");
  if (!hit.length) return `цифра конкурента прошла, найдено: ${r.found.map((f) => f.id).join(", ") || "ничего"}`;
  return /лидер/.test(hit[0].msg) ? true : `находка есть, но откуда взялось число, не сказано: ${hit[0].msg}`;
});

step("адрес, написанный руками, - ПРЕДУПРЕЖДЕНИЕ машины, а не строка в промте автора", () => {
  // Запрет «адрес страницы делает слаг-движок» жил в промте и не проверялся ничем: автор,
  // написавший адрес, проходил verify-page без единой находки, а место в промте тратилось.
  const r = vp(PAGE_OK.replace("Замер бесплатный", "Подробности на /remont-vannoy-pod-klyuch/ и в смете"));
  if (r.code === 2) return `проверка не состоялась: ${r.all.slice(0, 200)}`;
  if (r.block.length) return `адрес в тексте свалил прогон: ${r.block.map((f) => f.id).join(", ")}`;
  return r.warn.some((f) => f.id === "bad_link") ? true : `предупреждения нет: ${r.warn.map((f) => f.id).join(", ") || "находок нет вовсе"}`;
});

step("недобор нормы знаков - ПРЕДУПРЕЖДЕНИЕ, а не ошибка", () => {
  const short = PAGE_OK.replace(/Демонтаж, разводка воды[\s\S]*?принимается отдельно\./, "Демонтаж и отделка.");
  const r = vp(short);
  const hit = r.found.filter((f) => f.id === "chars_norm");
  if (!hit.length) return "недобор не замечен вовсе";
  const asBlock = hit.filter((f) => f.level === "block");
  if (asBlock.length) return "недобор знаков блокирует прогон: верстка снова собирается не под текст";
  return r.block.length === 0 ? true : `из-за короткого раздела покраснело другое: ${r.block.map((f) => f.id).join(", ")}`;
});

step("метки вопроса нет - ПРЕДУПРЕЖДЕНИЕ с позиционным фолбэком, а не ошибка", () => {
  const r = vp(PAGE_OK.replace("<!-- q:price closes:f05 -->\n", ""));
  const hit = r.found.filter((f) => f.id === "q_mark");
  if (!hit.length) return "забытая метка прошла молча";
  if (hit.some((f) => f.level === "block")) return "опечатка в разметке валит хороший текст";
  const typo = vp(PAGE_OK.replace("<!-- q:price closes:f05 -->", "<!-- q:pricee closes:f05 -->"));
  const th = typo.found.filter((f) => f.id === "q_mark");
  if (!th.length) return "неизвестный id метки прошел молча";
  return th.every((f) => f.level === "warn") ? true : "неизвестный id метки валит прогон";
});

step("служебный хвост не парсится: число в строке снят: страницу не валит", () => {
  const withTail = PAGE_OK.replace("недостает: номер записи", "снят: docs - нет номера 1234567 и срока действия 25 лет\nнедостает: номер записи");
  const r = vp(withTail);
  const fromTail = r.block.filter((f) => f.block === "хвост" || /1234567|25/.test(f.msg));
  if (fromTail.length) return `валидатор вычитал число из пояснения: ${fromTail.map((f) => f.id + " " + f.msg).join(" | ")}`;
  // Стоп-лист надписей кнопок при этом работает.
  const cta = vp(PAGE_OK.replace("[Получить смету по вашей квартире](/zayavka/)", "[Отправить заявку](/zayavka/)"));
  return cta.block.some((f) => f.id === "cta_stop") ? true : "надпись кнопки из стоп-листа прошла";
});

// ──────────────────────────────────────────────────────────────────────────
console.log("");
console.log("=== Усиление: роль без операции «резать» ===");
// ──────────────────────────────────────────────────────────────────────────

putPage(vpDir, "index", PAGE_OK);

step("список усиления непуст - exit 1, и каждая строка адресная", () => {
  const r = runJson([LIFT, vpDir, "--root", ROOT]);
  if (!r.json) return `усиление не посчиталось: ${r.all.slice(0, 200)}`;
  const page = r.json.pages[0];
  if (page.empty) return "на странице с незакрытыми возражениями усиливать якобы нечего";
  if (r.code !== 1) return `список непуст, а код выхода ${r.code}`;
  const bad = page.items.filter((x) => !x.block || !x.line || !x.mark || !LIFTM.ACT_ORDER.includes(x.act));
  if (bad.length) return `строка без адреса или с чужим действием: ${JSON.stringify(bad[0]).slice(0, 160)}`;
  if (page.cap !== Math.round(page.chars * LIFTM.CAP_SHARE)) return `потолок прибавки ${page.cap} не равен 10 процентам от ${page.chars}`;
  return true;
});

step("список усиления пуст - шаг не вызывается, 0 токенов и exit 0", () => {
  const dir = putProject("liftempty", baseProject("landing"));
  run([PAGES, dir, "--root", ROOT]);
  run([PLAN, dir, "--root", ROOT]);
  const full = PAGE_OK
    .replace("<!-- q:price_factors closes:f15,o1.1 -->", "<!-- q:price_factors closes:f15,o1.1,o1.2,o2.1,o2.2 -->")
    .replace("<!-- q:edge closes:f01,f07 -->", "<!-- q:edge closes:f01,f07,f09,f11,f13,f14 -->")
    .replace("Прораб на объекте каждый день, и вопросы решаются на месте, а не письмами.",
      "Прораб на объекте каждый день, и вопросы решаются на месте, а не письмами.\nЦена фиксируется в договоре, свой прораб ведет объект, фотоотчет каждый день приходит в чат.\nОплата по этапам, отделка под аренду идет отдельной сметой.");
  putPage(dir, "index", full);
  const r = runJson([LIFT, dir, "--root", ROOT]);
  if (!r.json) return `усиление не посчиталось: ${r.all.slice(0, 200)}`;
  const page = r.json.pages[0];
  if (!page.empty) return `список не опустел: ${page.items.map((x) => x.id + " " + x.mark).join(", ")}`;
  if (r.code !== 0) return `пустой список дал код ${r.code}: нормальный исход не должен выглядеть провалом`;
  const plain = run([LIFT, dir, "--root", ROOT]);
  return /не вызывается/.test(plain.all) ? true : "в отчете не сказано, что агент не вызывается";
});

// ──────────────────────────────────────────────────────────────────────────
console.log("");
console.log("=== Пустая фактура: короче, а не оборонительнее ===");
// ──────────────────────────────────────────────────────────────────────────

step("страница без фактов собирается КОРОЧЕ, а не из плейсхолдеров", () => {
  const rich = baseProject("multipage");
  const bare = clone(rich);
  for (const f of bare.facts) f.publish = "no";
  // Замера нет намеренно: рынок тут ни при чем, мерим реакцию состава на пустую фактуру.
  const bad = [];
  for (const [name, page] of [["home", HOME], ["service", SERVICE]]) {
    const a = planOf(rich, page, null), b = planOf(bare, page, null);
    if (act(b).length >= act(a).length) {
      bad.push(`${name}: с фактурой ${act(a).length} блоков, без фактуры ${act(b).length} (${act(b).join(", ")})`);
    }
  }
  if (bad.length) return `страница не стала короче - ${bad.join("; ")}`;
  const b = planOf(bare, SERVICE, null);
  const marked = b.blocks.filter((x) => x.ord && x.answers_with.some((m) => /^f/.test(m)));
  return marked.length ? `блок без фактуры несет маркеры фактов: ${marked.map((x) => x.id).join(", ")}` : true;
});

step("при пустой фактуре доля блоков функции В не превышает половины", () => {
  const bare = baseProject("multipage");
  for (const f of bare.facts) f.publish = "no";
  const cases = [
    ["service", SERVICE, lead("service", { hero: 1, qa: 0.9, price_factors: 0.9, price: 0.8, cta_form: 1 }, { blocks_median: 9 })],
    ["home", HOME, lead("home", HOME_COV, { blocks_median: 9 })]
  ];
  for (const [name, page, L] of cases) {
    const ids = act(planOf(bare, page, L));
    const fnB = ids.filter((id) => String((ymlReal.blocks.get(id) || [])[0]) === "В");
    if (fnB.length * 2 > ids.length) return `${name}: В-блоков ${fnB.length} из ${ids.length} (${fnB.join(", ")})`;
  }
  return true;
});

// ──────────────────────────────────────────────────────────────────────────
console.log("");
console.log("=== Сквозной прогон лендинга ===");
// ──────────────────────────────────────────────────────────────────────────

step("шаги 1 и 4: лендинг - ОДНА страница по адресу /, объем плана в вилке типа", () => {
  run([PAGES, landDir, "--root", ROOT]);
  if (!existsSync(join(landDir, "pages.json"))) return "pages.json не записан";
  const a = runJson([PAGES, landDir, "--root", ROOT]);
  if (!a.json) return `адреса не собрались: ${a.all.slice(0, 200)}`;
  if (a.json.pages.length !== 1) return `страниц ${a.json.pages.length}: направления обязаны стать блоками одной страницы`;
  const first = a.json.pages[0];
  if (first.url !== "/" || first.type !== "landing") return `страница ${first.url} типа ${first.type}`;
  const r = runJson([PLAN, landDir, "--root", ROOT]);
  if (!r.json) return `план не собрался: ${r.all.slice(0, 200)}`;
  run([PLAN, landDir, "--root", ROOT]);
  const p = r.json.pages[0];
  const [lo, hi] = PLANM.VOL.landing;
  if (p.bud < lo || p.bud > hi) return `бюджет ${p.bud} вне вилки ${lo}-${hi}`;
  const ids = p.blocks.filter((b) => b.ord).map((b) => b.id);
  const lost = ["hero", "price", "cta_form"].filter((id) => !ids.includes(id));
  return lost.length ? `ядро лендинга снято: ${lost.join(", ")}` : true;
});

step("шаг 5: задания и theses.md записаны, тезисы одинаковы для всех авторов", () => {
  run([TASKS, landDir, "--root", ROOT]);
  const th = join(landDir, "theses.md");
  if (!existsSync(th)) return "theses.md не записан: авторы снова пойдут веером вслепую";
  const t = text(th);
  if (!/Канон/.test(t)) return "в тезисах нет раздела канона";
  if (!/ремонт под ключ/.test(t)) return "канон контракта в тезисы не доехал";
  const tasks = join(landDir, "tasks");
  if (!existsSync(join(tasks, "index.md"))) return "задания лендинга нет";
  if (!existsSync(join(tasks, "meta.json"))) return "метатегов нет";
  // Ориентир знаков автору ОБЕЩАН в site-author.md, и по этой же норме потом предупреждает
  // chars_norm. Судить по линейке, которой автор не видел, значит вернуть текст в ячейку.
  const task = text(join(tasks, "index.md"));
  if (!/ориентир знаков/.test(task)) return "в строке колонок нет ориентира знаков";
  const norm = (ymlReal.blocks.get("hero") || [])[4];
  if (!norm) return "в pages.yml у hero нет колонки ЗНАКИ";
  const row = task.split(/\r?\n/).find((l) => /^\s*\d+ \| hero \|/.test(l));
  if (!row) return "строки блока hero в таблице состава нет";
  return row.includes(norm) ? true : `норма знаков ${norm} до автора не доехала: ${row.slice(0, 120)}`;
});

step("шаг 9: написанная страница проходит verify-page без блокирующих", () => {
  putPage(landDir, "index", PAGE_OK);
  const r = runJson([VPAGE, landDir, "--root", ROOT]);
  if (!r.json) return `проверка не состоялась: ${r.all.slice(0, 200)}`;
  const b = r.json.pages[0].found.filter((f) => f.level === "block");
  return b.length ? b.map((f) => `${f.id} ${f.block}:${f.line}`).join(", ") : true;
});

step("страница лендинга находит свой план: состав сверяется, а не молчит", () => {
  const r = runJson([VPAGE, landDir, "--root", ROOT]);
  if (!r.json) return "проверка не состоялась";
  const p = r.json.pages[0];
  if (p.planned) return true;
  const plan = readJson(join(landDir, "plan.json")).pages[0];
  return `страница ${p.slug}.md не нашла свой план (в плане слаг «${plan.page.slug}», адрес ${plan.page.url}): правила состава plan_gap и off_plan молчат, позиционного фолбэка нет`;
});

step("шаги 9 и 10: проверка и усиление оставляют отметку, по которой видно лестницу", () => {
  // Круг усиления - единственная роль без операции «резать», и единственный шаг, который
  // пишет новый текст ПОСЛЕ проверки. Отметок на диске нет - и то и другое существует
  // только в описании, а прогон идет 9 -> 12, как в v7.
  run([VPAGE, landDir, "--root", ROOT]);
  if (!existsSync(join(landDir, "verify.json"))) return "verify-page не оставил verify.json: по чему тогда видно, что страницу проверяли";
  run([LIFT, landDir, "--root", ROOT]);
  if (!existsSync(join(landDir, "lift.json"))) return "lift.mjs не оставил lift.json: шаг 10 из лестницы выпадает";
  run([ASM, landDir, "--root", ROOT]);
  const v = runJson([VBUILD, landDir, "--root", ROOT]);
  if (!v.json) return `проверка сборки не состоялась: ${v.all.slice(0, 200)}`;
  const ids = new Set(v.json.found.map((f) => f.id));
  return ids.has("lift") || ids.has("checked") ? "свежие отметки, а сборка все равно ругается на лестницу" : true;
});

step("страница, тронутая после проверки, не проходит сборку молча", () => {
  // Усилитель дописывает текст на шаге 10. Если отметка проверки старше страницы, значит
  // дописанное не встретило ни одного из 12 блокирующих правил.
  const file = join(landDir, "pages", "index.md");
  const was = text(file);
  writeFileSync(file, was + "\nдописано усилителем после проверки\n", "utf8");
  const future = Date.now() + 5000;
  try { utimesSync(file, future / 1000, future / 1000); } catch { return "отметку времени страницы не подвинуть: проверить нечем"; }
  const v = runJson([VBUILD, landDir, "--root", ROOT]);
  writeFileSync(file, was, "utf8");
  if (!v.json) return `проверка сборки не состоялась: ${v.all.slice(0, 200)}`;
  const ids = new Set(v.json.found.map((f) => f.id));
  if (!ids.has("checked")) return "текст дописан после проверки, а сборка молчит";
  run([VPAGE, landDir, "--root", ROOT]);
  run([LIFT, landDir, "--root", ROOT]);
  return true;
});

step("--page сужает шаг до одной страницы, а сдача собирает вопросы одним списком", () => {
  // Аргумент объявлен в описании скила. Объявленный и нереализованный аргумент хуже, чем
  // его отсутствие: оператор получит прогон по всему сайту и ни слова о том, что фильтр
  // не сработал.
  const t = run([TASKS, multiDir, "--root", ROOT, "--page", "index"]);
  if (t.code === 2) return `--page не принят build-tasks: ${t.all.slice(0, 200)}`;
  if (!/index /.test(t.all)) return "в отчете нет выбранной страницы";
  if (/remont-vannoy/.test(t.all)) return "--page не сузил прогон: в отчете чужие страницы";
  const bad = run([TASKS, multiDir, "--root", ROOT, "--page", "net-takoy"]);
  if (bad.code !== 2) return `несуществующая страница принята, код ${bad.code}`;
  const v = run([VPAGE, landDir, "--root", ROOT, "--page", "index"]);
  if (v.code === 2) return `--page не принят verify-page: ${v.all.slice(0, 200)}`;
  const l = run([LIFT, landDir, "--root", ROOT, "--page", "index"]);
  if (l.code === 2) return `--page не принят lift: ${l.all.slice(0, 200)}`;
  const a = run([ASM, landDir, "--root", ROOT, "--ask"]);
  if (a.code === 2) return `--ask не принят assemble: ${a.all.slice(0, 200)}`;
  return /\[ask\]/.test(a.all) ? true : "список вопросов не собрался";
});

step("метатеги считает формула: без врезки они доезжают до сборки, и жесткий лимит их меряет", () => {
  // tasks/meta.json писался и не читался никем, а во врезку страницы метатеги не кладет ни
  // автор, ни методичка. Значит hard_len - одно из ровно двух жестких ограничений этапа -
  // не срабатывал никогда, а посчитанные метатеги умирали в файле.
  const dir = putProject("meta", baseProject("landing"));
  run([PAGES, dir, "--root", ROOT]);
  run([PLAN, dir, "--root", ROOT]);
  run([TASKS, dir, "--root", ROOT]);
  const m = readJson(join(dir, "tasks", "meta.json")).pages.find((x) => x.url === "/");
  if (!m || !m.title || !m.description) return "метатеги лендинга не посчитаны";
  if (chars(m.title) > TASKM.TITLE_MAX || chars(m.description) > TASKM.DESC_MAX) return "жесткий лимит пробит самой формулой";
  // Страница БЕЗ врезки: ровно то, что пишет автор по образцу site-author.md.
  const body = PAGE_OK.slice(PAGE_OK.indexOf("# ", PAGE_OK.indexOf("---", 3)));
  if (/^---/.test(body)) return "врезку из фикстуры срезать не удалось";
  putPage(dir, "index", body);
  run([ASM, dir, "--root", ROOT]);
  const html = text(join(dir, "site.html"));
  if (!html.includes(m.title)) return `title из tasks/meta.json в сборку не доехал: «${m.title}»`;
  if (!html.includes(m.description)) return "description из tasks/meta.json в сборку не доехал";
  // И машина меряет ровно то, что уйдет в верстку: раздутый метатег обязан валить прогон.
  const mj = readJson(join(dir, "tasks", "meta.json"));
  mj.pages[0].title = "Т".repeat(TASKM.TITLE_MAX + 20);
  writeFileSync(join(dir, "tasks", "meta.json"), JSON.stringify(mj, null, 2), "utf8");
  const r = runJson([VPAGE, dir, "--root", ROOT]);
  const hit = r.json && r.json.pages[0].found.some((f) => f.id === "hard_len" && f.level === "block");
  return hit ? true : "раздутый title прошел: жесткий лимит метатегов не срабатывает никогда";
});

step("шаг 12: сборка дает один site.html, и verify-build его пропускает", () => {
  const a = run([ASM, landDir, "--root", ROOT]);
  if (a.code !== 0) return `сборка упала: ${a.all.slice(0, 200)}`;
  const file = join(landDir, "site.html");
  if (!existsSync(file)) return "site.html не записан";
  const html = text(file);
  if (!/<html/i.test(html) || chars(html) < 2000) return `собранный файл подозрительно мал: ${chars(html)} знаков`;
  if (/мысль:|снят:|слито:|недостает:/.test(html)) return "служебный хвост страницы попал в верстку";
  if (!/<p class="meta">[\s\S]*?title:/.test(html)) return "метатегов в сборке нет вовсе";
  const v = runJson([VBUILD, landDir, "--root", ROOT]);
  if (v.code === 2) return `проверка сборки не состоялась: ${v.all.slice(0, 200)}`;
  return v.code === 0 ? true : (v.json ? v.json.found.map((f) => f.id + " " + f.msg).join(" | ") : v.all.slice(0, 200));
});

// ──────────────────────────────────────────────────────────────────────────
console.log("");
console.log("=== Типографика и страховка ===");
// ──────────────────────────────────────────────────────────────────────────

step("типографика чистая и плейсхолдера в слое письма нет", () => {
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
  if (bad.length) return bad.join(" | ");
  return placeholders();
});

// Плейсхолдер живет в том же шаге: оба провала - про один и тот же файл и один и тот же
// проход по списку созданного.
function placeholders() {
  const marker = "[" + "ЗАПОЛНИТЬ";
  const bad = MADE.filter((rel) => {
    if (!existsSync(join(ROOT, rel)) || rel === ".claude/tests/proto/run.mjs") return false;
    // Упоминание маркера в кавычках или внутри детектора - это запрет, а не его применение:
    // «от [] руб.» в SKILL.md обязано остаться, живой маркер в шаблоне - возврат к v7.
    const raw = text(join(ROOT, rel));
    const body = (rel.endsWith(".mjs") ? stripDetectors(raw) : raw)
      .replace(/`[^`\n]*`/g, "``")
      .replace(/«[^»\n]*»/g, "«»");
    return body.includes(marker);
  });
  return bad.length ? `плейсхолдер вернулся: ${bad.join(", ")}` : true;
}

step("файлы этапа 1 на месте и не пусты", () => {
  const want = [
    ".claude/skills/site-analiz/SKILL.md",
    ".claude/skills/site-analiz/project.schema.json",
    ".claude/skills/site-proto/pages.yml",
    ".claude/agents/site-intake.md",
    ".claude/agents/site-market.md",
    ".claude/scripts/site/_contract.mjs",
    ".claude/scripts/site/queue.mjs",
    ".claude/scripts/site/verify-data.mjs",
    ".claude/scripts/site/build-project.mjs",
    ".claude/scripts/site/build-doc.mjs",
    ".claude/scripts/site/apply-answers.mjs",
    ".claude/tests/site/run.mjs",
    "docs/v8/rubric.md"
  ];
  const bad = want.filter((rel) => !existsSync(join(ROOT, rel)) || chars(text(join(ROOT, rel))) < 500);
  return bad.length ? `нет или пусты: ${bad.join(", ")}` : true;
});

step("страховка: /seo-faq и машинерия v7 на месте, скилов site-* два, граница среза названа", () => {
  const faqSkill = join(ROOT, ".claude/skills/seo-faq/SKILL.md");
  const faqAgent = join(ROOT, ".claude/agents/faq-builder.md");
  if (!existsSync(faqSkill) || !existsSync(faqAgent)) return "снесен /seo-faq или faq-builder";
  if (!/jm_text_analyze|jm_text_check|jm_stop_domains/.test(text(faqAgent))) return "из промта faq-builder пропала связка с SEO-сервисами";
  const want = [
    ".claude/scripts/verify-copy.mjs",
    ".claude/skills/seo-tekst/assets/COPY-AUDIT.md",
    ".claude/skills/seo-tekst/assets/VOICE.md",
    ".claude/agents/page-writer.md"
  ];
  const bad = want.filter((rel) => !existsSync(join(ROOT, rel)) || chars(text(join(ROOT, rel))) < 1000);
  if (bad.length) return `нет или пусты: ${bad.join(", ")}`;
  const dirs = readdirSync(join(ROOT, ".claude/skills")).filter((d) => /^site-/.test(d)).sort();
  if (dirs.join(",") !== "site-analiz,site-proto") return `скилы v8: ${dirs.join(", ")}`;
  const t = text(join(SKILL_DIR, "SKILL.md"));
  if (!/seo-faq/.test(t)) return "в SKILL.md не сказано, что FAQ остается за /seo-faq";
  if (!/следующий срез|за границей среза/.test(t)) return "граница среза (каталог и товары) в SKILL.md не названа";
  return /article/.test(t) ? true : "в SKILL.md не сказано, что статьи этот скил не пишет";
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
