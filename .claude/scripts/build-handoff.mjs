#!/usr/bin/env node
// build-handoff.mjs
// Техническая записка передачи прототипов на дизайн-этап и партнёру-разработчику.
// Кладётся рядом с prototype.html и прикладывается к ним при передаче.
//
// ВАЖНО: язык документа - дизайн-этап, а НЕ заказчик. Здесь допустимы термины
// («блок», «функция блока», «слот», «валидатор»), которых на сайте быть не может.
//
// Вход:  <texts_dir>/pages/<slug>/page.json  (обязательно, хотя бы одна страница)
//        <texts_dir>/blueprints/<slug>.json  (опц.: function, function_why, status, placeholder, limits, mode)
//        <texts_dir>/strategy.json           (опц.: materials_missing, decisions)
//        <texts_dir>/facts.json              (опц.: lexicon.locked / lexicon.canonical)
//        <texts_dir>/meta.json               (опц.: state, updated)
// Выход: <texts_dir>/HANDOFF.md
// Использование: node build-handoff.mjs <texts_dir>

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve, basename } from "node:path";

const dir = process.argv[2] ? resolve(process.argv[2]) : null;
if (!dir) { console.error("[build-handoff] usage: <texts_dir>"); process.exit(1); }
if (!existsSync(dir)) { console.error(`[build-handoff] нет папки задачи: ${dir}`); process.exit(1); }

// читалка JSON с защитой от BOM: любой сбой чтения\парсинга = «файла нет»
const readJson = (p) => {
  try { return existsSync(p) ? JSON.parse(readFileSync(p, "utf8").replace(/^﻿/, "")) : null; }
  catch { return null; }
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
for (const pd of pageDirs) {
  const page = readJson(join(pd, "page.json"));
  if (!page) continue;
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
      fill_notes: arr(b.fill_notes).map(s).filter(Boolean),
    };
  });
  blockCount += blocks.length;
  pages.push({ slug: pslug, title: s(pmeta.title) || s(page.h1) || pslug, type: s(pmeta.type), url: s(pmeta.url), blocks });
}
if (pages.length === 0) { console.error(`[build-handoff] страницы не читаются: ${pagesDir}`); process.exit(1); }

// ---------- открытые вопросы: [ЗАПОЛНИТЬ: ...] по всему тексту + fill_notes ----------
const FILL_RE = /\[ЗАПОЛНИТЬ[^\]]*\]/g;
const HAS_FILL = /\[ЗАПОЛНИТЬ[^\]]*\]/; // без флага g: .test() у глобального regex запоминает lastIndex
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
    for (const fn of b.fill_notes) found.push(HAS_FILL.test(fn) ? fn.match(FILL_RE).join("; ") : `[ЗАПОЛНИТЬ: ${fn}]`);
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
    let reason = "";
    if (b.placeholder) reason = b.status === "не решено" ? "нет материалов или чисел - ждем фактуру от заказчика" : "блок критичен для типа страницы, но фактуры под него пока нет";
    else if (b.mode === "шаблон") reason = "рамка под контент, который заполняет клиент";
    else if (b.mode === "заглушка") reason = "место занято намеренно, содержимого пока нет";
    if (reason) gaps.push({ page: p.title, slug: p.slug, block: b.type, n: b.n, mode: b.mode || (b.placeholder ? "плейсхолдер" : ""), reason, empty: b.empty_state || (b.mode === "шаблон" ? NO_EMPTY : "-") });
  }
}
const templateBlocks = [];
for (const p of pages) for (const b of p.blocks) if (b.mode === "шаблон") templateBlocks.push({ page: p, block: b });
const stubCount = gaps.filter((g) => g.mode === "заглушка").length;

// ---------- словарь ----------
const lexicon = (facts && facts.lexicon) || {};
const locked = arr(lexicon.locked).map((x) => (typeof x === "string" ? { phrase: x, source: "" } : { phrase: s(x.phrase), source: s(x.source) })).filter((x) => x.phrase);
const canonical = arr(lexicon.canonical).map((x) => (typeof x === "string" ? { wording: x, thought: "", where: "" } : { wording: s(x.wording), thought: s(x.thought), where: s(x.where) })).filter((x) => x.wording);

// ---------- материалы ----------
const materialsMissing = arr(strategy.materials_missing).map(s).filter(Boolean);

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
push(`Собрано: страниц - ${pages.length}, блоков - ${blockCount}. Тексты прошли копи-валидатор (стоп-слова, лимиты слотов, запреты стиля) и согласованы с заказчиком.`, "");
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
push("Тексты переносятся **дословно**. Они согласованы с заказчиком и прошли валидатор - переформулировка ломает и то, и другое:");
push("согласование придется проходить заново, а проверка лимитов и стоп-слов на переписанном тексте уже не выполнялась.");
push("Сокращение «чтобы влезло в макет» - это не правка текста, а правка смысла: если текст не помещается, меняем композицию блока, а не формулировку.", "");
push("### 2.3. Цифры и факты", "");
push("Единственный источник истины по цифрам, реквизитам, срокам и гарантиям - `facts.json` в папке задачи.");
push("Ни одна цифра не меняется, не округляется и не пересчитывается по месту (год в месяцы, доли в проценты). Нужна другая цифра - правка в `facts.json`, затем пересборка.", "");
if (locked.length || canonical.length) {
  push("### 2.4. Формулировки, которые нельзя менять", "");
  push("Это либо дословные слова заказчика, либо сквозные формулировки, которые намеренно повторяются на всех страницах одинаково.");
  push("Синонимизация здесь читается как разные обещания и рушит доверие.", "");
  if (locked.length) {
    push("Дословные формулировки заказчика:", "");
    for (const l of locked) push(`- «${l.phrase}»${l.source ? ` (источник: ${l.source})` : ""}`);
    push("");
  }
  if (canonical.length) {
    push("Сквозные формулировки (одна мысль - одна формулировка):", "");
    for (const c of canonical) push(`- «${c.wording}»${c.thought ? ` - мысль: ${c.thought}` : ""}${c.where ? `; где: ${c.where}` : ""}`);
    push("");
  }
}
push(`### 2.${locked.length || canonical.length ? 5 : 4}. Один главный CTA на блок`, "");
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
push("- **Финальные изображения.** Стоят серые плейсхолдеры с осмысленным alt: alt описывает, что должно быть на месте картинки, - по нему подбирается или снимается реальный кадр.");
if (gaps.length) {
  push("", "**Блоки, оставленные незаполненными намеренно:**", "");
  push("| Страница | # | Блок | Режим | Почему пусто | Пустое состояние |", "|---|---|---|---|---|---|");
  for (const g of gaps) push(`| ${cell(g.page)} | ${g.n} | ${cell(g.block)} | ${cell(g.mode || "плейсхолдер")} | ${cell(g.reason)} | ${cell(g.empty)} |`);
  push("");
} else {
  push("", "Блоков-плейсхолдеров и блоков в режиме шаблона\\заглушки в прототипе нет.", "");
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
      // диапазон символов берем только явный («20-60», «до 60 символов»); счет элементов («ровно 6 карточек») в эту колонку не тащим
      const m = raw.match(/\d+\s*-\s*\d+/) || raw.match(/(?:до|не более)\s*(\d+)/i) || (isList ? null : raw.match(/^\s*(\d+)\s*$/));
      const range = m ? (m[1] ? `до ${m[1]}` : m[0].replace(/\s+/g, "")) : "-";
      const fmt = isList ? raw : (k === "total" ? "весь блок целиком" : "одна строка текста");
      const empty = isList
        ? "блок останется без карточек, и его придется снять со страницы"
        : k === "total"
          ? "блок будет выглядеть недоделанным"
          : "поле исчезнет из блока, соседние элементы съедут";
      push(`| ${cell(k)} | ${cell(fmt)} | ${cell(range)} | ${cell(empty)} |`);
    }
    push("");
  }
  push("Текст длиннее верхней границы обрежется или разъедет верстку; короче нижней - блок будет выглядеть пустым. Если нужного объема нет - лучше сказать нам, чем добивать текст водой.", "");
}

// ---------- запись ----------
const outPath = join(dir, "HANDOFF.md");
// подстраховка от длинного\среднего тире: в записке они запрещены так же, как в клиентских текстах
const text = md.join("\n").replace(/[—–]/g, "-").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
writeFileSync(outPath, text, "utf8");

console.log(`[build-handoff] wrote ${outPath}`);
console.log(`  страниц: ${pages.length}, блоков: ${blockCount}`);
console.log(`  открытых плейсхолдеров [ЗАПОЛНИТЬ]: ${openCount}`);
console.log(`  блоков в режиме шаблон: ${templateBlocks.length}, заглушка: ${stubCount}, placeholder:true: ${gaps.filter((g) => !g.mode || g.mode === "плейсхолдер").length}`);
