#!/usr/bin/env node
// build-handoff.mjs
// Техническая записка передачи прототипов на дизайн-этап и партнёру-разработчику.
// Кладётся рядом с prototype.html и прикладывается к ним при передаче.
//
// ВАЖНО: язык документа - дизайн-этап, а НЕ заказчик. Здесь допустимы термины
// («блок», «функция блока», «слот», «валидатор»), которых на сайте быть не может.
//
// В документ идут ТОЛЬКО строки fill_notes с маркером [ЗАПОЛНИТЬ: ...] - то, что заполняет
// заказчик. Служебные заметки редактора (в том числе поле notes_internal) не выводятся:
// они завышали счетчик открытых вопросов, по которому дизайнер решает, можно ли верстать.
//
// Вход:  <texts_dir>/pages/<slug>/page.json  (обязательно, хотя бы одна страница)
//        <texts_dir>/blueprints/<slug>.json  (опц.: function, function_why, status, placeholder, limits, mode)
//        <texts_dir>/strategy.json           (опц.: materials_missing, decisions)
//        <texts_dir>/facts.json              (опц.: lexicon.locked + source / lexicon.canonical + origin)
//        <texts_dir>/meta.json               (опц.: state, updated, selling_floor_waivers)
// Выход: <texts_dir>/HANDOFF.md
// Использование: node build-handoff.mjs <texts_dir>

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve, basename } from "node:path";

const dir = process.argv[2] ? resolve(process.argv[2]) : null;
if (!dir) { console.error("[build-handoff] usage: <texts_dir>"); process.exit(1); }
if (!existsSync(dir)) { console.error(`[build-handoff] нет папки задачи: ${dir}`); process.exit(1); }

// читалка JSON с защитой от BOM.
// Файла нет - это норма (все входы кроме page.json опциональны), молчим.
// Файл есть, но не разбирается - это поломка: тихий возврат null превращал битый файл
// в «данных не было», поэтому такой случай называем вслух и запоминаем.
const brokenFiles = [];
const readJson = (p) => {
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, "utf8").replace(/^﻿/, "")); }
  catch (e) {
    brokenFiles.push(p);
    console.error(`[build-handoff] НЕ РАЗОБРАН ${p}: ${e.message}`);
    return null;
  }
};
const arr = (x) => (Array.isArray(x) ? x : x ? [x] : []);
const s = (x) => (x == null ? "" : String(x).trim());
// экранирование для ячейки markdown-таблицы: труба ломает разметку, перевод строки - тоже
const cell = (x) => s(x).replace(/\|/g, "\\|").replace(/\r?\n+/g, " ");

const inputs = readJson(join(dir, "inputs.json")) || {};
const strategy = readJson(join(dir, "strategy.json")) || {};
const facts = readJson(join(dir, "facts.json")) || {};
const meta = readJson(join(dir, "meta.json")) || {};
const slug = inputs.slug || (basename(dir).match(/^\d+-(.+)$/) || [, "site"])[1];
const company = s(inputs.brand_name) || s(inputs.company) || s(inputs.domain) || slug;

// ---------- сбор страниц ----------
const pagesDir = join(dir, "pages");
let pageDirs = [];
if (existsSync(pagesDir)) {
  pageDirs = readdirSync(pagesDir)
    .sort()
    .map((d) => join(pagesDir, d))
    .filter((p) => { try { return statSync(p).isDirectory() && existsSync(join(p, "page.json")); } catch { return false; } });
}
if (pageDirs.length === 0) { console.error(`[build-handoff] нет ни одной страницы в ${pagesDir}`); process.exit(1); }

// порядок страниц - как в pages.json (там он осмысленный); чего там нет - в конец по алфавиту
const order = new Map();
for (const [i, p] of arr((readJson(join(dir, "pages.json")) || {}).pages).entries()) {
  const k = s(p && p.slug);
  if (k && !order.has(k)) order.set(k, Number.isFinite(p.n) ? p.n : i);
}
if (order.size) {
  const rank = (p) => (order.has(basename(p)) ? order.get(basename(p)) : Number.MAX_SAFE_INTEGER);
  pageDirs.sort((a, b) => rank(a) - rank(b) || basename(a).localeCompare(basename(b)));
}

// нормализованная модель: страница + блоки, к каждому блоку подтянут его blueprint-двойник
const FUNC_NAMES = { "Р": "результат", "Д": "доказательство", "К": "квалификация", "В": "возражение" };
// В клиентские и передаточные документы идет ТОЛЬКО то, что заказчик должен заполнить, -
// то есть строка с маркером [ЗАПОЛНИТЬ. Остальные строки fill_notes - служебные заметки
// редактора («слот короче лимита: срезан хвост», «[требует согласия]»), их печать
// превращала внутреннюю кухню в список задач заказчику и завышала счетчик открытых
// вопросов, по которому дизайнер решает, можно ли верстать. Поле notes_internal
// не читается здесь принципиально: оно служебное по определению.
const FILL_RE = /\[ЗАПОЛНИТЬ[^\]]*\]/g;
const HAS_FILL = /\[ЗАПОЛНИТЬ[^\]]*\]/; // без флага g: .test() у глобального regex запоминает lastIndex
let internalNotes = 0;
// режимы блока, которые означают «содержимого нет намеренно» (mode - опциональное поле blueprint)
const MODE_TEMPLATE = ["шаблон", "template", "образец"];
const MODE_STUB = ["заглушка", "stub", "placeholder", "пустышка"];
const modeKind = (m) => {
  const v = s(m).toLowerCase();
  if (!v) return "";
  if (MODE_TEMPLATE.some((k) => v.includes(k))) return "шаблон";
  if (MODE_STUB.some((k) => v.includes(k))) return "заглушка";
  return "";
};

const pages = [];
let blockCount = 0;
const brokenPages = [];
for (const pd of pageDirs) {
  const page = readJson(join(pd, "page.json"));
  if (!page || typeof page !== "object") {
    brokenPages.push(basename(pd));
    console.error(`[build-handoff] страница пропущена (page.json не читается): ${basename(pd)}`);
    continue;
  }
  const pmeta = page.page || {};
  const pslug = s(pmeta.slug) || basename(pd);
  const bp = readJson(join(dir, "blueprints", `${pslug}.json`)) || {};
  const bpBlocks = arr(bp.blocks);
  const blocks = arr(page.blocks).map((b, i) => {
    // сопоставление с blueprint: сначала по n, затем по fragment+type, затем по позиции
    const byN = bpBlocks.find((x) => x && x.n != null && b.n != null && x.n === b.n);
    const byType = bpBlocks.find((x) => x && s(x.fragment) && s(x.fragment) === s(b.fragment) && s(x.type) === s(b.type));
    const bb = byN || byType || bpBlocks[i] || {};
    return {
      n: b.n != null ? b.n : i + 1,
      type: s(b.type) || s(bb.type) || s(b.fragment) || "Блок",
      fragment: s(b.fragment) || s(bb.fragment),
      func: s(bb.function),
      why: s(bb.function_why),
      status: s(bb.status),
      placeholder: bb.placeholder === true,
      mode: modeKind(bb.mode),
      empty_state: s(bb.empty_state),
      limits: bb.limits && typeof bb.limits === "object" ? bb.limits : null,
      slots: b.slots && typeof b.slots === "object" ? b.slots : {},
      fill_notes: (() => {
        const all = arr(b.fill_notes).map(s).filter(Boolean);
        // Обратная совместимость: у блоков старого формата поля notes_internal нет, а в
        // fill_notes лежали голые строки-дыры, которые сборщик сам оборачивал в маркер.
        // Строгий фильтр молча съел бы их - дизайнер получил бы записку без открытых вопросов.
        const legacyBlock = b.notes_internal === undefined;
        const forClient = all.filter((x) => HAS_FILL.test(x) || legacyBlock);
        internalNotes += all.length - forClient.length + arr(b.notes_internal).length;
        return forClient.map((x) => (HAS_FILL.test(x) ? x : `[ЗАПОЛНИТЬ: ${x}]`));
      })(),
    };
  });
  blockCount += blocks.length;
  pages.push({ slug: pslug, title: s(pmeta.title) || s(page.h1) || pslug, type: s(pmeta.type), url: s(pmeta.url), blocks });
}
if (pages.length === 0) { console.error(`[build-handoff] страницы не читаются: ${pagesDir}`); process.exit(1); }

// страницы, заявленные в pages.json, но не доехавшие сюда: скрипт уже читает этот файл
// ради порядка, так что знает ожидаемый состав - и обязан сказать о недоборе, а не
// напечатать «собрано страниц - N» как факт
const collectedSlugs = new Set(pages.map((p) => p.slug));
for (const d of pageDirs) collectedSlugs.add(basename(d));
const missingPages = [...order.keys()].filter((k) => !collectedSlugs.has(k));
for (const m of missingPages) console.error(`[build-handoff] страницы нет в pages/: ${m} (заявлена в pages.json)`);

// ---------- открытые вопросы: [ЗАПОЛНИТЬ: ...] по всему тексту + fill_notes ----------
function collectFill(v, sink) {
  if (typeof v === "string") { const m = v.match(FILL_RE); if (m) sink.push(...m); return; }
  if (Array.isArray(v)) { for (const x of v) collectFill(x, sink); return; }
  if (v && typeof v === "object") { for (const x of Object.values(v)) collectFill(x, sink); }
}
let openCount = 0;
for (const p of pages) {
  p.open = [];
  for (const b of p.blocks) {
    const found = [];
    collectFill(b.slots, found);
    // fill_notes уже отфильтрованы до строк с маркером - печатаем как есть, без второй обертки
    for (const fn of b.fill_notes) found.push(fn);
    const uniq = [...new Set(found.map(s).filter(Boolean))];
    if (uniq.length) p.open.push({ block: b.type, n: b.n, items: uniq });
    openCount += uniq.length;
  }
}

// ---------- намеренные пропуски: placeholder + режимы блока ----------
// пустое состояние - решение планировщика (что человек видит, когда единиц ноль или
// фильтр ничего не нашел); для режима «шаблон» оно обязательно и должно доехать до разработчика
const NO_EMPTY = "[пустое состояние не задано - уточнить у автора структуры]";
const gaps = [];
for (const p of pages) {
  for (const b of p.blocks) {
    // mode проверяется ПЕРВЫМ: по контракту block-planner режим «шаблон»\«заглушка» всегда
    // идет вместе с placeholder:true, и проверка placeholder первой делала обе mode-ветки
    // недостижимыми - заглушка получала объяснение «ждем фактуру», хотя ждать нечего.
    // placeholder остается фолбэком для старых blueprint без поля mode.
    let reason = "";
    if (b.mode === "шаблон") reason = "рамка под контент, который заполняет клиент";
    else if (b.mode === "заглушка") reason = "место занято намеренно, содержимого пока нет";
    else if (b.placeholder) reason = b.status === "не решено" ? "нет материалов или чисел - ждем фактуру от заказчика" : "блок критичен для типа страницы, но фактуры под него пока нет";
    if (reason) gaps.push({ page: p.title, slug: p.slug, block: b.type, n: b.n, mode: b.mode || (b.placeholder ? "плейсхолдер" : ""), reason, empty: b.empty_state || (b.mode === "шаблон" ? NO_EMPTY : "-") });
  }
}
const templateBlocks = [];
for (const p of pages) for (const b of p.blocks) if (b.mode === "шаблон") templateBlocks.push({ page: p, block: b });
const stubCount = gaps.filter((g) => g.mode === "заглушка").length;

// подписи к медиа есть не у всех фрагментов кита (media_alt несут единицы), поэтому
// обещание «у каждого плейсхолдера осмысленный alt» давалось разработчику вслепую.
// Считаем по факту собранных страниц.
const ALT_KEYS = /^(media_alt|image_alt|alt|photo_alt)$/i;
function hasAlt(v) {
  if (Array.isArray(v)) return v.some(hasAlt);
  if (!v || typeof v !== "object") return false;
  for (const [k, x] of Object.entries(v)) {
    if (ALT_KEYS.test(k) && s(x)) return true;
    if (x && typeof x === "object" && hasAlt(x)) return true;
  }
  return false;
}
const altBlocks = pages.reduce((n, p) => n + p.blocks.filter((b) => hasAlt(b.slots)).length, 0);

// ---------- словарь ----------
const lexicon = (facts && facts.lexicon) || {};
const lockedAll = arr(lexicon.locked).map((x) => (typeof x === "string" ? { phrase: x, source: "" } : { phrase: s(x.phrase), source: s(x.source) })).filter((x) => x.phrase);
// Вход в locked - только по названному основанию, и source обязан его называть (ADR-037 п.8:
// юридическая\реквизитная формулировка, слоган\самоназвание, явное требование заказчика).
// Но отсутствие source - это старая задача (ADR-031), а не отмена дословности: строки без
// этого ключа копились до ADR-037 и печатались дословно. Тихо понизить их значит задним
// числом сменить обязательство во всех уже сданных задачах. Поэтому строка остается в
// дословном списке, а несоблюдение критерия входа называется вслух пометкой рядом с ней -
// дизайнер видит и слово заказчика, и то, что причину за ним никто не назвал.
const NO_SOURCE = "основание не указано";
const lockedNoSource = lockedAll.filter((x) => !x.source);
const canonical = arr(lexicon.canonical).map((x) => (typeof x === "string" ? { wording: x, thought: "", where: "", origin: "" } : { wording: s(x.wording), thought: s(x.thought), where: s(x.where), origin: s(x.origin).toLowerCase() })).filter((x) => x.wording);
// Обязательство у строки разное по происхождению (ADR-037 п.7), но ключа нет - работать как
// раньше (ADR-031). До ADR-037 весь канон печатался дизайнеру как дословный, и ни одна живая
// задача origin не несет: снятие дословности по умолчанию молча переписало бы весь
// существующий канон. Смысловой строка становится только тогда, когда стратег ЯВНО назвал
// origin: "формула", - то есть сам сказал, что буквы тут не обязательство.
const MEANING_ORIGIN = new Set(["формула"]);
const canonMeaning = canonical.filter((c) => MEANING_ORIGIN.has(c.origin));
const canonVerbatim = canonical.filter((c) => !MEANING_ORIGIN.has(c.origin));
const hasLexicon = lockedAll.length > 0 || canonical.length > 0;

// ---------- материалы ----------
const materialsMissing = arr(strategy.materials_missing).map(s).filter(Boolean);

// ---------- снятые правила продающего пола (ADR-037 п.3) ----------
// Waiver без непустого source невалиден: verify-copy.mjs его игнорирует и оставляет нарушение,
// значит и записка не имеет права объявлять такое место «намеренно пустым».
const FLOOR_RULES = { F1: "первый экран", F2: "оффер в первом экране", F3: "целевое действие", F4: "обещание подкреплено" };
const waiversAll = arr(meta.selling_floor_waivers).filter((w) => w && typeof w === "object");
// Валидность waiver определяется ОДИНАКОВО здесь и в verify-copy.mjs (ADR-037 п.3):
// непустой source ПЛЮС точное совпадение rule с закрытым списком. Иначе шаблон «F1|F2|F3|F4»,
// который скрипт-валидатор игнорирует, печатался бы дизайнеру как снятое правило.
const waiverRule = (w) => String(w.rule == null ? "" : w.rule).trim().toUpperCase();
const waivers = waiversAll.filter((w) => s(w.source) && Object.prototype.hasOwnProperty.call(FLOOR_RULES, waiverRule(w)));

// Вариант решения может прийти строкой (канон) или объектом - объект не должен уехать
// в записку как [object Object] (та же логика, что в build-tekst-analysis-docx.mjs).
const variantText = (v) => {
  if (v == null) return "";
  if (typeof v !== "object") return s(v);
  const screen = [v.h1, v.subhead ?? v.sub, v.cta_label ?? v.cta].map(s).filter(Boolean);
  if (screen.length) return screen.join(" · ");
  const fallback = [v.text, v.variant, v.value, v.wording, v.label].find((x) => typeof x === "string" && x.trim());
  return s(fallback);
};

// выбранный регистр из strategy.decisions.register (опц.): chosen - индекс или своя строка
function registerLine() {
  const d = (strategy.decisions || {}).register;
  if (!d) return "";
  const ch = d.chosen;
  if (typeof ch === "string" && ch.trim()) return ch.trim();
  const idx = Number.isInteger(ch) ? ch : (Number.isInteger(d.recommended) ? d.recommended : -1);
  const v = arr(d.variants)[idx];
  const ax = arr(d.axes)[idx];
  const label = ax ? [ax.a, ax.b, ax.c || ax.v].map(s).filter(Boolean).join(" / ") : "";
  const pick = variantText(v);
  if (!pick && !label) return "";
  const suffix = Number.isInteger(ch) || typeof ch === "string" ? "" : " (рекомендация стратега, заказчик оставил на наше усмотрение)";
  return (label ? `${label} - ` : "") + (pick ? `«${pick}»` : "") + suffix;
}

// ---------- сборка markdown ----------
const md = [];
const push = (...lines) => md.push(...lines);

push(`# Передача прототипов: ${company}`, "");
const stamp = [s(meta.state) ? `состояние: ${s(meta.state)}` : "", s(meta.updated) ? `обновлено: ${s(meta.updated).slice(0, 10)}` : ""].filter(Boolean).join(", ");
if (stamp) push(`_${stamp}_`, "");

// 1 --------------------------------------------------------------------------
push("## 1. Что это", "");
push("Это **прототип информационного наполнения**: карта содержания и приоритетов, а не макет.");
push("Он отвечает на вопросы «что говорим, в каком порядке и чем доказываем», и не отвечает на вопрос «как это выглядит».");
push("Черно-белый вид - намеренный: пока обсуждается содержание, цвет только мешает.", "");
// «согласованы с заказчиком» - утверждение, а не украшение: в `--auto` паузы на текстах нет
// вовсе, и дизайнер отказывался править очевидную ошибку, ссылаясь на несуществующее одобрение.
// Пишем по факту меты: пауза бывает только в режиме review и только после шага «тексты клиенту».
const steps = arr(meta.completed_steps).map(s);
const reviewMode = /review/i.test(s(meta.mode)) || meta.review === true;
const textsShown = steps.includes("texts-shared") || ["texts-shared", "prototypes-built", "completed"].includes(s(meta.state));
const APPROVED = reviewMode && textsShown;
const CHECKED = "Тексты прошли копи-валидатор (стоп-слова, лимиты слотов, запреты стиля)";
push(`Собрано: страниц - ${pages.length}, блоков - ${blockCount}. ${CHECKED}` + (APPROVED
  ? " и согласованы с заказчиком."
  : " и независимую вычитку. Согласование текстов заказчиком на момент передачи не зафиксировано."), "");
if (brokenPages.length || missingPages.length) {
  const lost = [...new Set([...brokenPages, ...missingPages])].join(", ");
  push(`**Внимание: собраны не все страницы.** В передачу не попали: ${lost}. Причина - отсутствующий или нечитаемый \`page.json\`. Эти страницы нужно пересобрать и обновить записку: пока их в передаче нет, число выше - неполное.`, "");
}
const accepted = arr(meta.accepted_violations);
if (accepted.length) {
  push(`Принятые отступления от валидатора (${accepted.length}) - решение человека, а не пропущенный брак:`, "");
  for (const v of accepted) {
    const line = v && typeof v === "object"
      ? [s(v.page), s(v.rule), s(v.why)].filter(Boolean).join(" - ")
      : s(v);
    if (line) push(`- ${line}`);
  }
  push("");
}
const reg = registerLine();
if (reg) push(`Выбранный регистр текста: ${reg}`, "");
push("Состав файлов на страницу: `prototype.html` - сам прототип, `page.json` - те же тексты в структурированном виде (машиночитаемый источник для верстки).", "");

// 2 --------------------------------------------------------------------------
push("## 2. Что сохранить дословно", "");
push("### 2.1. Порядок блоков", "");
push("Порядок блоков - это воронка: каждый блок стоит на своем месте, потому что закрывает конкретную задачу перед следующим шагом читателя.");
push("Перестановка блоков местами меняет логику убеждения, даже если весь текст остался прежним. Функция обозначена буквой:");
push("**Р** - результат (что человек получит и с какими цифрами), **Д** - доказательство (артефакт вместо утверждения), **К** - квалификация (его ли это случай), **В** - возражение (снимает конкретный страх).", "");
const NO_WHY = "[обоснование не задано - уточнить у автора структуры]";
for (const p of pages) {
  if (!p.blocks.length) continue;
  push(`**${p.title}**${p.url ? ` (\`${p.url}\`)` : ""}`, "");
  push("| # | Блок | Функция | Зачем он здесь |", "|---|---|---|---|");
  for (const b of p.blocks) {
    const f = b.func && FUNC_NAMES[b.func] ? `${b.func} - ${FUNC_NAMES[b.func]}` : (b.func || "-");
    push(`| ${b.n} | ${cell(b.type)} | ${cell(f)} | ${cell(b.why) || NO_WHY} |`);
  }
  push("");
}
push("### 2.2. Тексты", "");
push("Тексты переносятся **дословно**." + (APPROVED
  ? " Они согласованы с заказчиком и прошли валидатор - переформулировка ломает и то, и другое: согласование придется проходить заново, а проверка лимитов и стоп-слов на переписанном тексте уже не выполнялась."
  : " Они прошли валидатор и независимую вычитку - переформулировка ломает проверку: лимиты, стоп-слова и запреты стиля на переписанном тексте уже не проверялись."));
push("Сокращение «чтобы влезло в макет» - это не правка текста, а правка смысла: если текст не помещается, меняем композицию блока, а не формулировку.", "");
push("### 2.3. Цифры и факты", "");
push("Единственный источник истины по цифрам, реквизитам, срокам и гарантиям - `facts.json` в папке задачи.");
push("Ни одна цифра не меняется, не округляется и не пересчитывается по месту (год в месяцы, доли в проценты). Нужна другая цифра - правка в `facts.json`, затем пересборка.", "");
if (hasLexicon) {
  push("### 2.4. Формулировки из свода проекта", "");
  push("Это сквозные строки, которые намеренно повторяются на всех страницах одинаково. Обязательство у них разное - смотрите, в каком из двух списков стоит строка.", "");
  if (lockedAll.length || canonVerbatim.length) {
    push("**Сохранить ДОСЛОВНО** - слова заказчика и точные формулировки (юридические, условие оплаты, гарантия). Синонимизация здесь читается как другое обещание и рушит доверие:", "");
    for (const l of lockedAll) push(`- «${l.phrase}» (${l.source ? `источник: ${l.source}` : NO_SOURCE})`);
    for (const c of canonVerbatim) push(`- «${c.wording}»${c.thought ? ` - мысль: ${c.thought}` : ""}${c.where ? `; где: ${c.where}` : ""}`);
    if (lockedNoSource.length) push("", `Пометка «${NO_SOURCE}» значит, что в своде проекта не названо, почему строка неприкосновенна. Переносите ее дословно, но если она мешает верстке - это вопрос к нам, а не повод переписать по месту.`);
    push("");
  }
  if (canonMeaning.length) {
    push("**Сохранить СМЫСЛ и обязательные элементы** - формулировка собрана по формуле оффера, и под носитель (кнопка, карточка, метатег, узкая колонка) ее можно переписать. Мысль, адресат и цифры остаются те же, цифра берется из `facts.json`, а не подбирается по месту:", "");
    for (const c of canonMeaning) push(`- «${c.wording}»${c.thought ? ` - мысль: ${c.thought}` : ""}${c.where ? `; где: ${c.where}` : ""}`);
    push("");
  }
}
push(`### 2.${hasLexicon ? 5 : 4}. Один главный CTA на блок`, "");
push("В блоке ровно одно главное целевое действие. Вторая равнозначная кнопка рядом снижает конверсию обеих: человек выбирает между кнопками вместо того, чтобы совершить действие.");
push("Дополнительное действие допустимо только визуально подчиненным (текстовая ссылка, а не вторая кнопка того же веса).", "");

// 3 --------------------------------------------------------------------------
push("## 3. Что переопределяется дизайном", "");
push("Все перечисленное ниже в прототипе выглядит так, как оказалось удобно собрать, и не несет решения. Решает дизайн-этап:", "");
push("- **композиция и сетка внутри блока** - расположение элементов, число колонок, размеры и пропорции карточек, порядок элементов внутри одного блока;");
push("- **палитра, шрифты, типографика** - размеры и начертания, межстрочные интервалы, акценты;");
push("- **иконки, иллюстрации, фотографии** - в прототипе их нет или стоят серые плейсхолдеры;");
push("- **визуальные элементы, которых в прототипе нет** - фоновые формы, разделители, анимация появления, состояния наведения;");
push("- **объединение соседних блоков в один экран или разбиение одного блока на несколько** - если это не меняет порядок смыслов.", "");
push("**Композицию файла копировать не нужно** - она служебная. Прототип собран одноколоночным, чтобы читался как документ; это не заявка на верстку.", "");
push("**Горизонтальное листание** (слайдер отзывов, кейсов, тарифов, галерея) - способ подачи того же контента, решение принимает дизайн.");
push("В прототипе таких блоков нет: карточки развернуты в одну колонку, чтобы весь контент был виден при чтении. Это не запрет на слайдер, а незанятое место.", "");

// 4 --------------------------------------------------------------------------
push("## 4. Чего в прототипе намеренно нет", "");
push("Этот раздел закрывает вопрос «а где отзывы» на приемке: перечисленное не забыто, а сознательно не сделано на этом этапе.", "");
push("- **Цвет и брендовая палитра.** Прототип черно-белый намеренно: цвет - решение дизайн-этапа, и на этапе согласования содержания он уводит обсуждение в визуал.");
push("- **Финальные изображения.** Стоят серые плейсхолдеры." + (altBlocks
  ? ` Блоков с подписью к картинке (что должно быть на ее месте): ${altBlocks} - по такой подписи кадр подбирается или снимается. У остальных блоков подписи нет: кит не несет под нее поля, кадр подбирает дизайн-этап по смыслу блока.`
  : " Подписей к картинкам тексты не несут: поля под них есть не у всех блоков кита, поэтому кадр подбирает дизайн-этап по смыслу блока."));
if (gaps.length) {
  push("", "**Блоки, оставленные незаполненными намеренно:**", "");
  push("| Страница | # | Блок | Режим | Почему пусто | Пустое состояние |", "|---|---|---|---|---|---|");
  for (const g of gaps) push(`| ${cell(g.page)} | ${g.n} | ${cell(g.block)} | ${cell(g.mode || "плейсхолдер")} | ${cell(g.reason)} | ${cell(g.empty)} |`);
  push("");
} else {
  push("", "Блоков-плейсхолдеров и блоков в режиме шаблона\\заглушки в прототипе нет.", "");
}
if (waivers.length) {
  push("", "**Продающий минимум снят намеренно** - решение человека с названным основанием, а не забытый блок:", "");
  for (const w of waivers) {
    const rule = s(w.rule).toUpperCase();
    const named = FLOOR_RULES[rule] ? `${rule} (${FLOOR_RULES[rule]})` : (rule || "правило не названо");
    push(`- ${cell(s(w.page) || "страница не названа")}: ${named}${s(w.why) ? ` - ${cell(w.why)}` : ""} (основание: ${cell(w.source)})`);
  }
  push("", "Восстанавливать снятое на дизайн-этапе не нужно: страница сдается без этого правила осознанно. Вернуть его - отдельное решение заказчика, а не работа верстки.", "");
}
if (materialsMissing.length) {
  push("**Чего ждем от заказчика** (без этого перечисленные выше места остаются пустыми):", "");
  for (const m of materialsMissing) push(`- ${m}`);
  push("");
} else if (existsSync(join(dir, "strategy.json"))) {
  push("Запрос материалов заказчику закрыт: незакрытых пунктов в стратегии нет.", "");
} else {
  push("_Список недостающих материалов не собран: `strategy.json` в задаче нет._", "");
}

// 5 --------------------------------------------------------------------------
push(`## 5. Открытые вопросы к заказчику (${openCount})`, "");
if (openCount === 0) {
  push("Незакрытых пометок `[ЗАПОЛНИТЬ: ...]` в текстах нет - все места заполнены фактурой.", "");
} else {
  push("Пометки `[ЗАПОЛНИТЬ: ...]` в текстах - места, где нужна фактура заказчика. В верстку они идти не должны: сначала подставляем данные, затем собираем.", "");
  for (const p of pages) {
    if (!p.open.length) continue;
    push(`**${p.title}**`, "");
    for (const o of p.open) for (const it of o.items) push(`- блок ${o.n} (${o.block}): ${it}`);
    push("");
  }
}

// 6 --------------------------------------------------------------------------
if (templateBlocks.length) {
  push("## 6. Правила заполнения для клиента", "");
  push("Ниже - блоки, которые вы будете наполнять сами. Формат придуман не для красоты: если выйти за рамки, блок сломает верстку или потеряет смысл.", "");
  for (const { page, block } of templateBlocks) {
    push(`**${page.title} - ${block.type}**`, "");
    push(`Пустое состояние (что человек видит, когда единиц ноль или фильтр ничего не нашел): ${block.empty_state ? `«${block.empty_state}»` : NO_EMPTY}`, "");
    const lim = block.limits || {};
    const rows = Object.entries(lim).filter(([, v]) => s(v));
    if (!rows.length) { push("_Формат полей не задан - уточните у нас перед заполнением._", ""); continue; }
    push("| Поле | Формат | Сколько символов | Что будет, если пусто |", "|---|---|---|---|");
    for (const [k, v] of rows) {
      const raw = s(v);
      // тип «список» - только по явным маркерам количества («ровно 6», «3-5 шт», «4-6 элементов», «массив»).
      // Слово «карточка» в ПОЯСНЕНИИ к скалярному полю («до 60 символов, заголовок карточки») списком его не делает.
      const isList = /массив|ровно\s*\d+|\d+\s*(?:-\s*\d+\s*)?(?:шт\.?|штук|элемент|карточ|пункт|позици)/i.test(raw);
      // Диапазон символов. У СПИСКА первым числом почти всегда стоит КОЛИЧЕСТВО элементов
      // («3-7 шт. по 20-60 симв.», «5-8 позиций»), и тащить его в колонку «сколько символов»
      // нельзя: заказчик прочитает «название района - 5-8 символов». Для списка берем только
      // явную поэлементную форму «по N-M симв», иначе честный прочерк.
      const m = isList
        ? raw.match(/по\s*(\d+)\s*-\s*(\d+)\s*(?:симв|знак)/i)
        : (raw.match(/\d+\s*-\s*\d+/) || raw.match(/(?:до|не более)\s*(\d+)/i) || raw.match(/^\s*(\d+)\s*$/));
      const range = !m ? "-"
        : (isList ? `${m[1]}-${m[2]} на элемент`
          : (m[1] ? `до ${m[1]}` : m[0].replace(/\s+/g, "")));
      // Пояснение планировщика - самая полезная часть лимита («пусто -> карточка показывает
      // «цена по запросу»», «обязательно»), и раньше оно выбрасывалось ради шаблонной фразы,
      // которая утверждала прямо обратное. Печатаем то, что написал автор блок-плана;
      // шаблонная фраза остается только там, где пояснения нет.
      const parts = raw.split(/\s*;\s*/).map(s).filter(Boolean);
      const emptyPart = parts.find((x) => /пуст/i.test(x)) || "";
      const emptyRule = emptyPart ? s(emptyPart.replace(/^.*?пуст\S*\s*(?:->|:|-)?\s*/i, "")) : "";
      // из спецификации убираем чисто числовую часть - остается авторское пояснение
      const explain = parts
        .filter((x) => x !== emptyPart)
        // \w в JS не покрывает кириллицу, поэтому окончания перечисляем явным классом
        .map((x) => s(x.replace(/^\s*(?:до|не более|от|около)?\s*\d+\s*(?:-\s*\d+)?\s*(?:символ[а-яё]*|знак[а-яё]*|симв\.?|зн\.?)?\s*[,:;-]?\s*/i, "")))
        .filter(Boolean)
        .join("; ");
      const fmt = isList ? raw : (explain || (k === "total" ? "весь блок целиком" : "одна строка текста"));
      const empty = emptyRule || (/обязательн/i.test(explain) ? "поле обязательное - без него блок не собирается" : isList
        ? "блок останется без карточек, и его придется снять со страницы"
        : k === "total"
          ? "блок будет выглядеть недоделанным"
          : "поле исчезнет из блока, соседние элементы съедут");
      push(`| ${cell(k)} | ${cell(fmt)} | ${cell(range)} | ${cell(empty)} |`);
    }
    push("");
  }
  push("Текст длиннее верхней границы обрежется или разъедет верстку; короче нижней - блок будет выглядеть пустым. Если нужного объема нет - лучше сказать нам, чем добивать текст водой.", "");
}

// ---------- запись ----------
const outPath = join(dir, "HANDOFF.md");
// подстраховка от типографики: тире и е-с-точками запрещены в записке так же, как в
// клиентских текстах (ADR-023). Строки словаря исключений не получают: тексты страниц
// уже нормализованы тем же правилом, и «дословная» цитата с ё разошлась бы с сайтом.
const text = md.join("\n")
  .replace(/[—–]/g, "-")
  .replace(/ё/g, "е").replace(/Ё/g, "Е")
  .replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
writeFileSync(outPath, text, "utf8");

console.log(`[build-handoff] wrote ${outPath}`);
console.log(`  страниц: ${pages.length}, блоков: ${blockCount}`);
console.log(`  открытых плейсхолдеров [ЗАПОЛНИТЬ]: ${openCount}`);
console.log(`  блоков в режиме шаблон: ${templateBlocks.length}, заглушка: ${stubCount}, placeholder:true: ${gaps.filter((g) => g.mode === "плейсхолдер").length}`);
if (internalNotes) console.log(`  служебных пометок не выведено (нет маркера [ЗАПОЛНИТЬ): ${internalNotes}`);
if (waivers.length) console.log(`  снятых правил продающего пола: ${waivers.length}`);
if (waiversAll.length > waivers.length) {
  const bad = waiversAll.filter((w) => !waivers.includes(w))
    .map((w) => `${s(w.page) || "?"}/${s(w.rule) || "?"}${s(w.source) ? "" : " (нет source)"}`);
  console.error(`  waiver невалидны и не выведены: ${bad.join(", ")} - нужен непустой source и rule ровно из ${Object.keys(FLOOR_RULES).join("/")} (одна строка = одно правило)`);
}
if (lockedNoSource.length) console.error(`  locked без основания входа (ADR-037 п.8, выведены дословно с пометкой «${NO_SOURCE}»): ${lockedNoSource.length}`);
if (brokenPages.length) console.error(`  НЕ СОБРАНЫ (битый page.json): ${brokenPages.join(", ")}`);
if (missingPages.length) console.error(`  НЕТ В pages/ (заявлены в pages.json): ${missingPages.join(", ")}`);
if (brokenFiles.length) console.error(`  не разобрано файлов: ${brokenFiles.length}`);
