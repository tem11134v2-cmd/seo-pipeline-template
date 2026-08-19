#!/usr/bin/env node
// verify-copy.mjs
// Pre-flight КОПИ-валидатор: механические пункты чек-листа COPY-AUDIT.md по page.json
// ДО сборки HTML (жаргон+утечка кухни, манипуляции, H1, эмодзи, тире, лимиты слотов).
// Смысл, удар в боль ЦА, регистр и штампы добивает агент copy-auditor (анти-ИИ-детект тут НЕ делаем - ADR-022).
//
// Использование: node verify-copy.mjs <page_dir|page.json>
// Exit: 0 ok | 2 нарушения | 1 фатально (нет page.json).

import { readFileSync, existsSync, statSync } from "node:fs";
import { join, resolve, dirname, basename } from "node:path";

const arg = process.argv[2] ? resolve(process.argv[2]) : null;
if (!arg) { console.error("[verify-copy] usage: <page_dir|page.json>"); process.exit(1); }
const pjPath = existsSync(arg) && statSync(arg).isDirectory() ? join(arg, "page.json") : arg;
if (!existsSync(pjPath)) { console.error(`[verify-copy] нет page.json: ${pjPath}`); process.exit(1); }
const page = JSON.parse(readFileSync(pjPath, "utf8").replace(/^﻿/, ""));

const violations = [], warnings = [], infos = [];
const V = (m) => violations.push(m);
const W = (m) => warnings.push(m);
const I = (m) => infos.push(m); // информационная строка отчёта: не нарушение, просто цифра для оркестратора
const arr = (x) => (Array.isArray(x) ? x : []);
function collect(o, acc = []) {
  if (o == null) return acc;
  if (typeof o === "string") { acc.push(o); return acc; }
  if (Array.isArray(o)) { for (const v of o) collect(v, acc); return acc; }
  if (typeof o === "object") { for (const v of Object.values(o)) collect(v, acc); return acc; }
  return acc;
}
const blocks = arr(page.blocks);
// метатеги: title и description заказчик копирует в CMS как есть, поэтому они идут в общий текст
// наравне со слотами блоков (жаргон, тире, ё - те же жёсткие правила).
const metaTitle = String((page.page && page.page.title) || "");
const metaDesc = String((page.page && page.page.description) || "");
const allText = blocks.map((b) => collect(b.slots).concat(b.h2 ? [b.h2] : []).join("  ")).join("\n")
  + (metaTitle ? "\n" + metaTitle : "") + (metaDesc ? "\n" + metaDesc : "");
const low = allText.toLowerCase();
// единый поиск первого экрана: fragment "hero" либо тип «первый экран/hero» (блок мог прийти с другим fragment)
function findHero() { return blocks.find((b) => b.fragment === "hero" || /первый экран|hero/i.test(b.type || "")) || null; }
const hero = findHero();
const h1 = (hero && hero.slots && hero.slots.h1) || page.h1 || "";
const h2s = blocks.map((b) => b.h2 || (b.slots && b.slots.h2) || "").filter(Boolean);
const firstScreenText = hero ? collect(hero.slots).join(" ") : "";
// текстовые единицы для ПОСЛОТНЫХ проверок: каждый слот отдельно + H2 + метатеги
// (склеенный allText не годится там, где важно соседство слов внутри одного слота).
const textUnits = [];
for (let i = 0; i < blocks.length; i++) {
  const b = blocks[i] || {};
  const bn = b.n != null ? b.n : i + 1;
  if (b.slots && typeof b.slots === "object") {
    for (const [slot, val] of Object.entries(b.slots)) {
      const t = collect(val).join("  ");
      if (t.trim()) textUnits.push({ where: `блок ${bn}, слот «${slot}»`, text: t });
    }
  }
  if (b.h2) textUnits.push({ where: `блок ${bn}, H2`, text: String(b.h2) });
}
if (metaTitle.trim()) textUnits.push({ where: "мета Title", text: metaTitle });
if (metaDesc.trim()) textUnits.push({ where: "мета Description", text: metaDesc });
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/u;
const ARROWS = /[\u{2190}-\u{21FF}]/u; // типографские стрелки - не эмодзи, отдельная W-проверка

// 1. самозащита
if (/не как у (?:других|них)|без того,? чтобы|больше не придётся|забудьте о том/i.test(allText)) V("п.1 самозащита (паттерны: «не как у других/них», «без того, чтобы», «больше не придётся», «забудьте о том») - заменить на утверждение/цифру");
if (/защищены от/i.test(allText)) W("п.1 «защищены от» - ок как замена отрицания (VOICE.md), но проверь, что это не спор с конкурентом");
// 2. жаргон маркетолога + утечка внутренней кухни в клиентском тексте.
// Два списка: жёсткий (легальных омонимов нет - V) и мягкий (у слов есть отраслевые значения - W, решает аудитор).
const jargHard = (low.match(/(?<![а-яёa-z0-9_])(сургай|кастдев|customer dev|jtbd|cjm|usp|лид-?маг[а-яё]*)(?![а-яёa-z0-9_])/gi) || []);
if (jargHard.length) V(`п.2 утечка внутренней кухни в тексте: ${[...new Set(jargHard)].join(", ")} (Сургай/кастдев - наша методика, не для клиента)`);
const jargSoft = (low.match(/(?<![а-яёa-z0-9_])(конверси[а-яё]*|сегмент[а-яё]*|персонаж|аватар|оффер|воронк[а-яё]*|утп)(?![а-яёa-z0-9_])/gi) || []);
if (jargSoft.length) W(`п.2 похоже на жаргон маркетолога: ${[...new Set(jargSoft)].join(", ")} - проверь контекст ниши: у этих слов есть легальные отраслевые значения (конверсия метана, сегмент трубы, аватар пользователя). Если термин отраслевой - оставить`);
// 3. аббревиатуры в H1 (латиница/кириллица заглавными 2-5, кроме бренда из inputs.json)
const inputsPath = join(dirname(pjPath), "..", "..", "inputs.json");
let brand = "";
try { if (existsSync(inputsPath)) brand = String(JSON.parse(readFileSync(inputsPath, "utf8").replace(/^﻿/, "")).brand_name || "").toUpperCase(); } catch {}
const abbrH1 = (h1.match(/(?<![А-ЯЁA-Z0-9])[А-ЯЁA-Z]{2,5}(?![А-ЯЁA-Z0-9])/g) || []).filter((a) => !brand.includes(a) && !/^(ГОСТ|ТУ|РФ|СПБ)$/.test(a));
if (abbrH1.length) W(`п.3 возможные аббревиатуры в H1: ${abbrH1.join(", ")} (в Hero/H1 - 0; проверь)`);
// 4. дворовая лексика + тройные отрицания
if (/(?<![а-яёa-z0-9_])реально(?![а-яёa-z0-9_])|по-честному|нарвал|кинул(?:и)?|без условий/i.test(allText)) W("п.4 дворовая лексика («реально/по-честному/нарвались»)");
if (/(?:(?<![а-яёa-z0-9_])не(?![а-яёa-z0-9_])[^.!?]{0,30}){3,}/i.test(allText)) W("п.4 тройное отрицание подряд (максимум одно «не»)");
// 5. манипуляции. Срочность запрещена только БЕЗ опоры на факт: COPY.md/VOICE.md разрешают дедлайн
// с реальной датой или остатком из facts.json. Смотрим ПОСЛОТНО: дата/остаток должны быть в том же слоте.
const URGENCY = /только сегодня|осталось \d+ мест|успей(?:те)?|сгорит|перечёркнут/i;
const HAS_DATE = /\d{1,2}\.\d{1,2}(?:\.\d{2,4})?|\d{1,2}\s*(?:январ|феврал|март|апрел|ма[йя]|июн|июл|август|сентябр|октябр|ноябр|декабр)[а-яё]*/i;
const HAS_LEFT = /осталось\s+\d+/i;
for (const u of textUnits) {
  if (!URGENCY.test(u.text)) continue;
  if (HAS_DATE.test(u.text) || HAS_LEFT.test(u.text)) W(`п.5 срочность в «${u.where}» - сверь дедлайн/остаток с facts.json - в тексте есть дата/число`);
  else V(`п.5 манипуляция (ложная срочность/дефицит/перечёркнутая цена) в «${u.where}» - нет ни даты, ни числа остатка`);
}
// 6. сленг-плейсхолдеры
if (/ща докрутим|допил(?:им|ить)|потом доделаем/i.test(low)) V("п.6 сленг в плейсхолдере («Ща Докрутим/допилим») - только [ЗАПОЛНИТЬ]/«требует уточнения»");
// 9. лимиты H1
if (h1 && h1.length > 60) V(`п.9 H1 > 60 символов (${h1.length}): «${h1.slice(0, 50)}...»`);
if (h1 && (h1.match(/,/g) || []).length >= 2) W("п.9 H1 содержит перечисление (>=2 запятых) - убрать в подзаголовок");
// мета Description: пишет page-writer (prototype-builder не сочиняет), лимит 160
if (metaDesc.length > 160) V(`мета Description > 160 символов (${metaDesc.length})`);
if (!metaDesc.trim()) W("мета Description отсутствует/пуст (page.page.description)");
// 12. эмодзи в H1 / первом экране
if (EMOJI.test(h1) || EMOJI.test(firstScreenText)) V("п.12 эмодзи на первом экране (Hero) - убрать");
if (h2s.some((h) => EMOJI.test(h))) W("п.12 эмодзи в H2 - максимум один источник на странице");
// счётный вариант того же правила: эмодзи допустимы не более чем в одном блоке страницы
const emojiBlocks = blocks.filter((b) => EMOJI.test(collect(b.slots).concat(b.h2 ? [b.h2] : []).join(" "))).length;
if (emojiBlocks > 1) W(`п.12 эмодзи встречаются в ${emojiBlocks} блоках - максимум один блок на странице`);
if (ARROWS.test(h1) || ARROWS.test(firstScreenText)) W("типографская стрелка в Hero - в hero стрелка только SVG (BLOCKS.md), текстовые ←/→ заменить");
// типографика (П.13): длинное/среднее тире -> дефис, жёсткое правило проекта
const dashCount = (allText.match(/—|–/g) || []).length + (allText.includes(h1) ? 0 : (h1.match(/—|–/g) || []).length);
if (dashCount) V(`типографика: длинное/среднее тире (— –) ${dashCount} шт - заменить на дефис (-)`);
// буква ё - запрещена во всех клиентских текстах (как и тире)
const yoCount = (allText.match(/[ёЁ]/g) || []).length + (allText.includes(h1) ? 0 : (h1.match(/[ёЁ]/g) || []).length);
if (yoCount) V(`типографика: буква ё ${yoCount} шт - заменить на е`);
// слабые филлер-обороты и канцелярит (W - чистит copy-auditor); lookaround вместо \b (в JS \b ASCII-only)
if (/(?<![а-яё])(важно отметить|стоит отметить|следует подчеркнуть|таким образом|подводя итог|на сегодняшний день|в современном мире|не секрет, что)(?![а-яё])/i.test(low)) W("филлер/канцелярит - убрать, начать с сути");
// бюджет блоков
if (blocks.length > 14) W(`блоков ${blocks.length} (бюджет <= 12 содержательных + служебные)`);

// ---------------------------------------------------------------------------
// Слой стилевых проверок. ВСЁ здесь - только предупреждения (W): у каждой
// конструкции ниже есть законные употребления, поэтому скрипт лишь показывает
// место (блок + слот) и найденный фрагмент, а решение принимает copy-auditor.
// Ни одна проверка этого слоя не поднимает exit 2.
// ---------------------------------------------------------------------------
// вырезка вокруг найденного фрагмента (чтобы предупреждение было проверяемым)
function cut(text, idx, len, pad = 20) {
  const from = Math.max(0, idx - pad), to = Math.min(text.length, idx + len + pad);
  return (from > 0 ? "..." : "") + text.slice(from, to).replace(/\s+/g, " ").trim() + (to < text.length ? "..." : "");
}
// послотный поиск: список {where, frag} по всем текстовым единицам
function findAll(re, units = textUnits) {
  const rx = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  const out = [];
  for (const u of units) for (const m of u.text.matchAll(rx)) out.push({ where: u.where, frag: cut(u.text, m.index, m[0].length) });
  return out;
}
// одно предупреждение на правило: первые 3 вхождения + общее количество
function warnHits(hits, rule) {
  if (!hits.length) return;
  const list = hits.slice(0, 3).map((h) => `${h.where}: «${h.frag}»`).join("; ");
  W(`${rule}${hits.length > 3 ? ` (найдено ${hits.length}, показаны 3)` : ""} - ${list}`);
}

// A. Противопоставления: контраст почти всегда тащит за собой хвост-досказывание
const CONTRAST = [
  /(?<![а-яёa-z])а не(?![а-яёa-z])/gi,
  /(?<![а-яёa-z])не просто(?![а-яёa-z])/gi,
  /(?<![а-яёa-z])не только[^.!?]{0,120}?(?<![а-яёa-z])но и(?![а-яёa-z])/gi,
  /в отличие от/gi,
  /(?<![а-яёa-z])зато(?![а-яёa-z])/gi,
  /(?<![а-яёa-z])тогда как(?![а-яёa-z])/gi,
  /(?<![а-яёa-z])вместо того,?\s+чтобы(?![а-яёa-z])/gi,
  /(?<![а-яёa-z])не столько[^.!?]{0,120}?(?<![а-яёa-z])сколько(?![а-яёa-z])/gi,
];
warnHits(CONTRAST.flatMap((re) => findAll(re)), "контраст: срезать хвост, а не заменять нейтральной добивкой. Легальных исключений два - колонка сравнения и сброс ложной категории (не больше одного на страницу)");

// B. Подача от отрицания: клиенту продаём утверждением, а не отсутствием минуса
const NEG_PITCH = [
  /вы не плат/gi,
  /вы не получ/gi,
  /(?<![а-яёa-z])не нужно(?![а-яёa-z])/gi,
  /(?<![а-яёa-z])не прид[её]тся(?![а-яёa-z])/gi,
  /(?<![а-яёa-z])никак(?:ого|ой|их)(?![а-яёa-z])/gi,
];
warnHits(NEG_PITCH.flatMap((re) => findAll(re)), "подача от отрицания - переписать в прямое утверждение (что заказчик получает, а не чего с ним не случится)");

// C. Придаточное цели с отрицанием - самый частый вид хвоста-досказывания
warnHits(findAll(/(?<![а-яёa-z])чтобы(?:\s+[а-яё]+)?\s+не(?![а-яёa-z])/gi), "придаточное цели с отрицанием («чтобы не ...») - срезать целиком вместе с запятой или тире");

// D. Третье лицо: говорим от «мы» (или от «я» в профиле личного эксперта)
const THIRD_PERSON = [
  /наша компания/gi,
  /наше агентство/gi,
  /специалисты компании/gi,
  /(?<![а-яёa-z])осуществля[а-яё]*/gi,
];
warnHits(THIRD_PERSON.flatMap((re) => findAll(re)), "третье лицо/отглагольная безличность - говорим от «мы» (или от «я» в профиле личного эксперта), третье лицо запрещено");

// E. Смешение обращения: считаем глагольные формы 2-го лица по всему клиентскому
// тексту страницы (включая метатеги). Морфологию не строим - у форм на -ете/-ите
// вычитаем типовые существительные в предложном падеже (это W, не блокировка).
const NOUNS_ETE = new Set([
  "документе", "интернете", "сайте", "комплекте", "проекте", "объекте", "кабинете", "макете",
  "пакете", "свете", "ответе", "отчёте", "отчете", "совете", "предмете", "билете", "буклете",
  "кредите", "аудите", "депозите", "визите", "лимите", "приоритете", "комитете", "смете",
]);
const TY_PRON = new Set(["ты", "тебя", "тебе", "твой", "твоя", "твои"]);
const VY_PRON = new Set(["вы", "вас", "вам", "ваш", "ваша", "ваши"]);
let tyCount = 0, vyCount = 0;
for (const w of low.match(/[а-яё]+/g) || []) {
  if (TY_PRON.has(w) || (w.length >= 3 && /(?:ешь|ишь)$/.test(w))) tyCount++;
  else if (VY_PRON.has(w) || (w.length >= 3 && /(?:ете|ите)$/.test(w) && !NOUNS_ETE.has(w))) vyCount++;
}
if (tyCount && vyCount) {
  const tyHits = findAll(/(?<![а-яёa-z])(?:ты|тебя|тебе|твой|твоя|твои|[а-яё]{2,}(?:ешь|ишь))(?![а-яёa-z])/gi);
  const vyHits = findAll(/(?<![а-яёa-z])(?:вы|вас|вам|ваш|ваша|ваши|[а-яё]{2,}(?:ете|ите))(?![а-яёa-z])/gi)
    .filter((h) => !NOUNS_ETE.has(h.frag.toLowerCase()));
  const ex = [...tyHits.slice(0, 2), ...vyHits.slice(0, 2)].map((h) => `${h.where}: «${h.frag}»`).join("; ");
  W(`обращение плывёт: ${tyCount} форм на «ты» и ${vyCount} на «вы»; сбой почти всегда на шве с типовым блоком (плашки, шаги, финальный CTA, футер) - проверь по глаголам, не по местоимениям${ex ? " - " + ex : ""}`);
}

// F. Длина предложения: правило читаемости с телефона (не анти-ИИ).
// Двойной пробел - шов между элементами массива слота, режем и по нему.
const longSent = [];
for (const u of textUnits) {
  for (const chunk of u.text.split(/\s{2,}/)) {
    for (const s of chunk.split(/[.!?]+/)) {
      const t = s.trim();
      if (!t) continue;
      const n = t.split(/\s+/).filter(Boolean).length;
      if (n > 20) longSent.push({ where: u.where, n, frag: t.length > 60 ? t.slice(0, 60) + "..." : t });
    }
  }
}
if (longSent.length) {
  const list = longSent.slice(0, 3).map((s) => `${s.where} (${s.n} слов): «${s.frag}»`).join("; ");
  W(`предложения длиннее 20 слов${longSent.length > 3 ? ` (найдено ${longSent.length}, показаны 3)` : ""} - длинную мысль режь на две, второй кусок получает своё сказуемое - ${list}`);
}

// ---------------------------------------------------------------------------
// Слой ТИПОГРАФИКИ. Всё здесь - предупреждения (W): у каждого правила есть
// законные исключения, решение принимает copy-auditor.
// Разбор слотов на две сетки: скаляры (строка в слоте) и элементы repeatables
// (объект/строка внутри массива) - у них разные пороги «короткого элемента».
// ---------------------------------------------------------------------------
const scalarUnits = [], elementUnits = [];
for (let i = 0; i < blocks.length; i++) {
  const b = blocks[i] || {};
  const bn = b.n != null ? b.n : i + 1;
  if (!b.slots || typeof b.slots !== "object") continue;
  for (const [slot, val] of Object.entries(b.slots)) {
    if (typeof val === "string") { if (val.trim()) scalarUnits.push({ where: `блок ${bn}, слот «${slot}»`, text: val }); continue; }
    if (!Array.isArray(val)) continue;
    val.forEach((el, k) => {
      if (typeof el === "string") { if (el.trim()) elementUnits.push({ where: `блок ${bn}, «${slot}»[${k + 1}]`, text: el }); return; }
      if (el && typeof el === "object" && !Array.isArray(el)) {
        for (const [f, fv] of Object.entries(el)) if (typeof fv === "string" && fv.trim()) elementUnits.push({ where: `блок ${bn}, «${slot}»[${k + 1}].${f}`, text: fv });
      }
    });
  }
}

// T1. Числа - цифрами, не словами. Взгляд идёт по странице скачками: цифра его
// останавливает, слово растворяется в строке. На плашках и в блоках цифр число
// и есть всё сообщение, поэтому «три дня» -> «3 дня».
const NUM_WORD = /(?<![а-яёa-z])(дв(?:а|е|ух|ум|умя)|тр(?:и|ех|ем|емя)|четыр(?:е|ех|ем|ьмя)|пят(?:ь|и|ью)|шест(?:ь|и|ью)|сем(?:ь|и|ью)|восем(?:ь|и)|восьм(?:и|ью)|девят(?:ь|и|ью)|десят(?:ь|и|ью)|одиннадцат(?:ь|и|ью)|двенадцат(?:ь|и|ью)|ст(?:о|а)|тысяч(?:а|и|у|ей|ам|ами))\s+([а-яёa-z][а-яёa-z-]+)(?![а-яёa-z])/gi;
// ЗАКРЫТЫЙ список исключений (не эвристика): устойчивые обороты, где цифра выглядит дико.
// «один/одна/одно» в регулярку не входит вовсе - это и значение «единственный», и половина оборотов.
const NUM_WORD_OK = [
  /в\s+один\s+клик/gi,
  /на\s+все\s+сто/gi,
  /(?:в\s+)?одн[оа]\s+окн[оае]/gi,
  /едино(?:е|го|м)\s+окн[оае]/gi,
  /перв(?:ый|ого|ом|ые|ых)\s+экран[а-яё]*/gi,
  /в\s+два\s+счета/gi,
  /на\s+все\s+четыре\s+сторон[а-яё]*/gi,
  /тысяч[а-яё]*\s+и\s+одн[а-яё]*/gi,
  /сто\s+лет\s+в\s+обед/gi,
];
const numHits = [];
for (const u of textUnits) {
  const skip = [];
  for (const re of NUM_WORD_OK) for (const m of u.text.matchAll(re)) skip.push([m.index, m.index + m[0].length]);
  for (const m of u.text.matchAll(/«[^»]*»/g)) skip.push([m.index, m.index + m[0].length]); // внутри ёлочек - вероятное название
  for (const m of u.text.matchAll(NUM_WORD)) {
    if (skip.some(([a, z]) => m.index >= a && m.index < z)) continue;
    if (/^[А-ЯЁA-Z]/.test(m[1])) continue; // «Три Медведя» - часть названия
    numHits.push({ where: u.where, frag: cut(u.text, m.index, m[0].length) });
  }
}
warnHits(numHits, "число словом - записать цифрой («три дня» -> «3 дня»): взгляд по странице идёт скачками, цифра его останавливает, а слово растворяется; на плашках и в блоках цифр число и есть всё сообщение");

// T2. Точка в конце коротких элементов: заголовок, пункт списка, текст карточки
// или плашки, подпись, подзаголовок, alt, meta-description точкой не закрываются.
const ABBR_TAIL = /(?:\.\.\.|т\.\s*д\.|т\.\s*п\.|др\.|пр\.|руб\.|шт\.|кв\.\s*м\.|мм\.|см\.|г\.)$/i;
const dotHits = [], semiHits = [];
function tailCheck(where, raw, limit, allowMulti) {
  const t = String(raw == null ? "" : raw).trim();
  if (!t || t.length > limit) return;
  const tail = t.length > 46 ? "..." + t.slice(-46) : t;
  if (/;$/.test(t)) { semiHits.push({ where, frag: tail }); return; }
  if (!/\.$/.test(t) || ABBR_TAIL.test(t)) return;
  const multi = /[.!?]\s+\S/.test(t.slice(0, -1));
  if (multi && !allowMulti) return; // скаляр с внутренними точками-разделителями - это уже не «короткий элемент»
  dotHits.push({ where: where + (multi ? " (несколько предложений: точки между ними остаются, снимается только последняя)" : ""), frag: tail });
}
for (const u of scalarUnits) tailCheck(u.where, u.text, 120, false);
for (const u of elementUnits) tailCheck(u.where, u.text, 160, true);
for (let i = 0; i < blocks.length; i++) { const b = blocks[i] || {}; if (b.h2) tailCheck(`блок ${b.n != null ? b.n : i + 1}, H2`, b.h2, 120, false); }
if (metaDesc.trim()) tailCheck("мета Description", metaDesc, 300, false);
warnHits(dotHits, "точка в конце короткого элемента - снять (заголовок, пункт списка, текст карточки/плашки, подпись, подзаголовок, alt, meta-description точкой не закрываются)");
warnHits(semiHits, "точка с запятой в конце пункта - убрать: пункты списка не сшиваются пунктуацией");

// T3. Плейсхолдеры. На этапе текста они законны (facts-gate), нарушением НЕ считаются,
// но цифру оркестратор должен видеть: до выдачи они доехать не имеют права.
const slotOnlyText = blocks.map((b) => collect(b.slots).join("  ")).join("\n");
const phCount = (slotOnlyText.match(/\[ЗАПОЛНИТЬ/gi) || []).length + (slotOnlyText.match(/\[требует/gi) || []).length;
if (phCount) I(`пометок для заказчика в тексте слотов: ${phCount} ([ЗАПОЛНИТЬ / [требует) - на этапе текста законны, до выдачи доехать не должны`);
if (phCount > 15) W(`пометок [ЗАПОЛНИТЬ/[требует ${phCount} на страницу - страница слабая по фактуре, проверь facts.json (нечем набрать - блок снимают, а не заполняют скобками)`);

// T4. Кавычки: в клиентском тексте только ёлочки («»).
const quoteHits = findAll(/["“”„]/g)
  .concat(findAll(/(?<![а-яёa-z0-9])['’](?=[а-яёa-z0-9])|(?<=[а-яёa-z0-9])['’](?![а-яёa-z0-9])/gi));
warnHits(quoteHits, "кавычки: в клиентском тексте только ёлочки («»), программистские (\"\") и одинарные - заменить");

// диапазон «N-M» / «N» / «от N до M» -> {lo,hi}; иначе null
function parseRange(x) {
  const s = String(x == null ? "" : x).trim();
  let m = /^(\d+)\s*-\s*(\d+)$/.exec(s);
  if (m) return { lo: +m[1], hi: +m[2] };
  m = /^от\s+(\d+)\s+до\s+(\d+)$/i.exec(s);
  if (m) return { lo: +m[1], hi: +m[2] };
  m = /^(\d+)$/.exec(s);
  if (m) return { lo: +m[1], hi: +m[1] };
  return null;
}
// лимит массива в двух форматах:
//   объектный (если block-planner отдаст его в будущем): {"count":"3","title":"10-30","text":"30-90"}
//   строковый (то, что есть сейчас): «ровно 3: title 10-30 + text 30-90», «3-7 шт. по 20-60 симв.»
// Возврат {count, fields, itemLen}; что не распозналось - null/пусто (свободный формат молча пропускаем).
function parseRepeatLimit(lim) {
  const out = { count: null, fields: {}, itemLen: null };
  if (lim && typeof lim === "object" && !Array.isArray(lim)) {
    for (const [k, v] of Object.entries(lim)) {
      if (/^(?:count|кол-во|количество|шт)$/i.test(k)) out.count = parseRange(v);
      else { const r = parseRange(v); if (r) out.fields[k.toLowerCase()] = r; }
    }
    return out;
  }
  const s = String(lim == null ? "" : lim);
  let m;
  if ((m = /ровно\s+(\d+)/i.exec(s))) out.count = { lo: +m[1], hi: +m[1] };
  else if ((m = /от\s+(\d+)\s+до\s+(\d+)/i.exec(s))) out.count = { lo: +m[1], hi: +m[2] };
  else if ((m = /(\d+)\s*-\s*(\d+)\s*(?:шт|элемент|сегмент|позици|пункт|карточ|плашк|строк|тариф|итем)/i.exec(s))) out.count = { lo: +m[1], hi: +m[2] };
  else if ((m = /^\s*(\d+)\s*-\s*(\d+)\s*$/.exec(s))) out.count = { lo: +m[1], hi: +m[2] };
  else if ((m = /^\s*(\d+)\s*$/.exec(s))) out.count = { lo: +m[1], hi: +m[1] };
  // пары «имя_поля A-B» (имя поля всегда латиницей: title, text, features)
  for (const f of s.matchAll(/([a-z_][a-z0-9_]*)\s*:?\s*(\d+)\s*-\s*(\d+)/gi)) out.fields[f[1].toLowerCase()] = { lo: +f[2], hi: +f[3] };
  if ((m = /по\s+(\d+)\s*-\s*(\d+)\s*симв/i.exec(s))) out.itemLen = { lo: +m[1], hi: +m[2] };
  return out;
}

// сверка длин scalar-слотов с limits из blueprint (только простые "N-M"; несущее ограничение вёрстки).
// V лишь при превышении верхней границы более чем на 15% (ломает вёрстку); недобор/превышение до 15% - W.
const pageSlug = String((page.page && page.page.slug) || basename(dirname(pjPath)));
const bpPath = join(dirname(pjPath), "..", "..", "blueprints", `${pageSlug}.json`);
if (!existsSync(bpPath)) {
  W(`blueprint не найден (blueprints/${pageSlug}.json) - длины слотов не сверены`);
} else {
  try {
    const bp = JSON.parse(readFileSync(bpPath, "utf8").replace(/^﻿/, ""));
    const bpBlocks = arr(bp.blocks);

    // -----------------------------------------------------------------------
    // PRE-FLIGHT: blueprint - канон структуры страницы. Состав блоков писатель
    // менять не должен (см. запреты page-writer), поэтому расхождение - не вкус,
    // а брак сдачи. Недостающий блок = текст не написан, собирать HTML нечем.
    // -----------------------------------------------------------------------
    const bpIds = bpBlocks.map((x, i) => (x && x.n != null ? x.n : i + 1));
    const pgIds = blocks.map((b, i) => (b && b.n != null ? b.n : i + 1));
    const bpSet = new Set(bpIds), pgSet = new Set(pgIds);
    const label = (id, t) => `${id}${t ? ` (${t})` : ""}`;
    const missing = bpIds.map((id, i) => label(id, (bpBlocks[i] && bpBlocks[i].type) || "")).filter((_, i) => !pgSet.has(bpIds[i]));
    const extra = pgIds.map((id, i) => label(id, (blocks[i] && blocks[i].type) || "")).filter((_, i) => !bpSet.has(pgIds[i]));
    if (missing.length) V(`pre-flight: в page.json нет блоков из blueprint - ${missing.slice(0, 3).join(", ")}${missing.length > 3 ? ` и ещё ${missing.length - 3}` : ""} (не написано ${missing.length} из ${bpIds.length}) - текст не готов, HTML не собираем`);
    if (extra.length) W(`pre-flight: в page.json блоки вне blueprint - ${extra.slice(0, 3).join(", ")}${extra.length > 3 ? ` и ещё ${extra.length - 3}` : ""}: состав блоков писатель менять не должен, замеченную проблему пишут в сводку`);
    const commonPg = pgIds.filter((id) => bpSet.has(id)), commonBp = bpIds.filter((id) => pgSet.has(id));
    if (commonPg.join(",") !== commonBp.join(",")) W(`pre-flight: порядок блоков разошёлся с blueprint (page.json ${commonPg.join(", ")}; blueprint ${commonBp.join(", ")})`);
    // Баланс функций считаем ПО BLUEPRINT: page.json функцию не несёт, и это нормально.
    const fns = bpBlocks.map((x) => String((x && x.function) || "").trim()).filter(Boolean);
    const vFns = fns.filter((f) => /^[ВB]/i.test(f)).length;
    if (fns.length && vFns * 2 > fns.length) W(`страница-оправдание: блоков функции «В» ${vFns} из ${fns.length} содержательных (больше половины) - человек пришёл покупать, а ему всю дорогу объясняют, почему бояться не нужно; проверь состав по ADR-032`);

    // -----------------------------------------------------------------------
    // Лимиты слотов: скаляры (простое "N-M") + repeatables (плашки, карточки,
    // тарифы - «ровно 3: title 10-30 + text 30-90»). Длины элементов копим и
    // печатаем одной строкой, чтобы не раздувать вывод.
    // -----------------------------------------------------------------------
    const repHard = [], repSoft = [];
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      const bb = (b.n != null ? bpBlocks.find((x) => x.n === b.n) : bpBlocks[i]) || null;
      if (!bb || !bb.limits || !b.slots) continue;
      const bn = b.n != null ? b.n : i + 1;
      for (const [slot, lim] of Object.entries(bb.limits)) {
        const val = b.slots[slot];
        if (Array.isArray(val)) {
          const rl = parseRepeatLimit(lim);
          if (rl.count) {
            const { lo, hi } = rl.count, n = val.length;
            if (n < lo || n > hi) {
              const dev = n < lo ? lo - n : n - hi;
              const norm = lo === hi ? `ровно ${lo}` : `${lo}-${hi}`;
              if (dev > 1) V(`блок ${bn}: «${slot}» ${n} элем - лимит ${norm}, отклонение на ${dev} ломает сетку вёрстки`);
              else W(`блок ${bn}: «${slot}» ${n} элем - лимит ${norm} (отклонение на 1)`);
            }
          }
          val.forEach((el, k) => {
            const at = `блок ${bn} «${slot}»[${k + 1}]`;
            const one = (name, s, r) => {
              const len = s.length;
              if (len > Math.round(r.hi * 1.15)) repHard.push(`${at}${name ? "." + name : ""} ${len} симв (лимит ${r.lo}-${r.hi})`);
              else if (len > r.hi) repSoft.push(`${at}${name ? "." + name : ""} ${len} симв - выше лимита ${r.lo}-${r.hi} (в пределах 15%)`);
              else if (len < r.lo) repSoft.push(`${at}${name ? "." + name : ""} ${len} симв - ниже лимита ${r.lo}-${r.hi}`);
            };
            if (typeof el === "string") { if (el.trim() && rl.itemLen) one("", el, rl.itemLen); return; }
            if (!el || typeof el !== "object" || Array.isArray(el)) return;
            for (const [f, fv] of Object.entries(el)) {
              const r = rl.fields[String(f).toLowerCase()];
              if (r && typeof fv === "string" && fv.trim()) one(f, fv, r);
            }
          });
          continue;
        }
        const m = /^\s*(\d+)\s*-\s*(\d+)\s*$/.exec(String(lim));
        if (!m) continue; // свободный формат у скаляра - не парсим, пропускаем
        if (typeof val !== "string" || !val.trim()) continue;
        const len = val.length, lo = Number(m[1]), hi = Number(m[2]);
        if (len > Math.round(hi * 1.15)) V(`блок ${bn}: слот «${slot}» ${len} симв - выше лимита ${lo}-${hi} более чем на 15% (ломает вёрстку)`);
        else if (len > hi) W(`блок ${bn}: слот «${slot}» ${len} симв - выше лимита ${lo}-${hi} (в пределах 15%)`);
        else if (len < lo) W(`блок ${bn}: слот «${slot}» ${len} симв - ниже лимита ${lo}-${hi}`);
      }
    }
    if (repHard.length) V(`элементы repeatables выше лимита более чем на 15% (ломает вёрстку): ${repHard.slice(0, 3).join("; ")}${repHard.length > 3 ? ` и ещё ${repHard.length - 3}` : ""}`);
    if (repSoft.length) W(`длины элементов repeatables вне лимита: ${repSoft.slice(0, 3).join("; ")}${repSoft.length > 3 ? ` и ещё ${repSoft.length - 3}` : ""}`);
  } catch { W("blueprint не разобран - длины слотов не сверены"); }
}

// ---------------------------------------------------------------------------
// Слой РЕГИСТРА (пятое смысловое решение заказчика). Источник - strategy.json на
// два уровня выше page.json (там же, где inputs.json).
// Читаем МЯГКО: нет файла / нет ключа / регистр не разложен в координаты - слой
// молча не выполняется, без предупреждений об этом (штатная ситуация: старые
// задачи и задачи без регистра).
// Регистр РАСШИРЯЕТ разрешённое, но НЕ сужает запрещённое, поэтому весь слой -
// только предупреждения (W): exit 2 отсюда невозможен. Жёсткие V-проверки выше
// (утечка кухни, тире, ё, манипуляции без даты, лимиты H1) от регистра не зависят.
// ---------------------------------------------------------------------------
const A_VOCAB = ["продающий", "деловой", "отбирающий"];       // ось А: кто кого выбирает
const B_VOCAB = ["функциональный", "умеренный", "образный"];  // ось Б: образность
const strategyPath = join(dirname(pjPath), "..", "..", "strategy.json");
let axisA = "", axisB = "";
try {
  if (existsSync(strategyPath)) {
    const strategy = JSON.parse(readFileSync(strategyPath, "utf8").replace(/^﻿/, ""));
    const reg = (strategy && strategy.decisions && strategy.decisions.register) || null;
    const int = (x) => (typeof x === "number" && Number.isInteger(x) ? x : null);
    // индекс варианта: выбор заказчика (число) -> свой текст заказчика (строка; координаты
    // известны только через axes_from) -> не выбрано (null) -> recommended.
    let idx = null;
    if (reg) {
      if (int(reg.chosen) != null) idx = int(reg.chosen);
      else if (typeof reg.chosen === "string") idx = int(reg.axes_from);
      else if (reg.chosen == null) idx = int(reg.recommended);
    }
    const ax = idx != null ? arr(reg.axes)[idx] : null;
    if (ax && typeof ax === "object" && !Array.isArray(ax)) {
      // ключ оси может называться иначе - подстрахуемся распознаванием по словарю значений
      const pick = (key, vocab) => {
        const direct = String(ax[key] == null ? "" : ax[key]).trim().toLowerCase();
        if (vocab.includes(direct)) return direct;
        for (const v of Object.values(ax)) {
          const s = String(v == null ? "" : v).trim().toLowerCase();
          if (vocab.includes(s)) return s;
        }
        return "";
      };
      axisA = pick("a", A_VOCAB);
      axisB = pick("b", B_VOCAB);
    }
  }
} catch { /* мягко: битый strategy.json не мешает проверке текста */ }

if (axisA || axisB) {
  // места с CTA: блок считается одним местом, даже если в нём и CTA-слот, и форма
  const CTA_SLOT = /cta|btn|button|кнопк/i;
  const CTA_FRAGMENT = /^(?:form|cta-mid)$/i;
  const ctaUnits = [], ctaPlaces = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i] || {};
    const bn = b.n != null ? b.n : i + 1;
    let isCta = CTA_FRAGMENT.test(String(b.fragment || ""));
    if (b.slots && typeof b.slots === "object") {
      for (const [slot, val] of Object.entries(b.slots)) {
        if (!CTA_SLOT.test(slot)) continue;
        isCta = true;
        const t = collect(val).join("  ");
        if (t.trim()) ctaUnits.push({ where: `блок ${bn}, слот «${slot}»`, text: t });
      }
    }
    if (isCta) ctaPlaces.push(`блок ${bn}`);
  }

  // 1. Ось А деловой/отбирающий: срочность и давление запрещены ДАЖЕ с датой.
  // Пометка к п.5 (само место там уже названо) - не повтор, а поправка на регистр.
  if (axisA === "деловой" || axisA === "отбирающий") {
    for (const u of textUnits) {
      if (!URGENCY.test(u.text)) continue;
      W(`регистр «${axisA}» (ось А) к п.5, «${u.where}»: срочность и давление недопустимы даже с датой или остатком - в этом регистре условия сделки подаются как факт («приём документов до 15.09»), а не как подгон читателя`);
    }
  }

  // 2. Число мест с CTA: продающий до 5, деловой 3-4, отбирающий 1-2.
  const CTA_MAX = { "продающий": 5, "деловой": 4, "отбирающий": 2 };
  const CTA_NORM = { "продающий": "до 5", "деловой": "3-4", "отбирающий": "1-2" };
  if (axisA && ctaPlaces.length > CTA_MAX[axisA]) {
    W(`регистр «${axisA}» (ось А): мест с CTA на странице ${ctaPlaces.length} (${ctaPlaces.join(", ")}), допустимо ${CTA_NORM[axisA]} - лишние призывы в этом регистре читаются как нужда, а не как приглашение`);
  }

  // 3. Ось А отбирающий: кнопка про ЗАПРОС, а не про получение.
  if (axisA === "отбирающий") {
    const GET_VERBS = /(?<![а-яёa-z])(?:получ(?:ить|ите|и)|забра(?:ть)|забери(?:те)?|скачать\s+бесплатно|оставить\s+заявку|оставьте\s+заявку|заказать\s+звонок|закажите\s+звонок)(?![а-яёa-z])/gi;
    warnHits(findAll(GET_VERBS, ctaUnits), "регистр «отбирающий» (ось А): глагол про получение на кнопке - здесь кнопка про ЗАПРОС («Обсудить задачу», «Оставить запрос»), а не про раздачу");
  }

  // 4. Ось А отбирающий: несущая конструкция грепом не ловится - напоминание один раз.
  if (axisA === "отбирающий") {
    W("регистр отбирающий: проверь по первому экрану, названы ли ограничение и тот, кому не подходим - без них это просто тихий продающий");
  }

  // 5. Ось Б функциональный: метафора грепом не ловится - напоминание один раз.
  if (axisB === "функциональный") {
    W("ось образности функциональная: каждый H1/H2 должен читаться буквально, заголовок, требующий догадки, - брак");
  }
}

// отчёт
console.log(`[verify-copy] ${pjPath}  (блоков ${blocks.length}, H1 ${h1.length} симв)`);
if (infos.length) { for (const m of infos) console.log("   i " + m); }
if (warnings.length) { console.log("  предупреждения (семантику добьёт copy-auditor):"); for (const w of warnings) console.log("   ~ " + w); }
if (violations.length) { console.log("  НАРУШЕНИЯ (правим текст, HTML не собираем):"); for (const v of violations) console.log("   ! " + v); process.exit(2); }
console.log("  OK - механические пункты чисто.");
process.exit(0);
