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
let page;
try { page = JSON.parse(readFileSync(pjPath, "utf8").replace(/^﻿/, "")); }
catch (e) { console.error(`[verify-copy] page.json не разобран (${pjPath}): ${e.message}`); process.exit(1); }

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
// `product-gallery` - тоже первый экран: по BLOCKS.md это «своя секция (id=hero), несёт H1»,
// у карточки товара штатного фрагмента `hero` не бывает.
function findHero() { return blocks.find((b) => b.fragment === "hero" || b.fragment === "product-gallery" || /первый экран|hero/i.test(b.type || "")) || null; }
const hero = findHero();
// String() обязателен: слот мог приехать числом/null, а дальше по коду .match/.length
const h1 = String((hero && hero.slots && hero.slots.h1) || page.h1 || "");
const h2s = blocks.map((b) => String(b.h2 || (b.slots && b.slots.h2) || "")).filter(Boolean);
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
// ё в паттернах пишем классом [её]: клиентский текст нормализован по ADR-023 («придется»)
if (/не как у (?:других|них)|без того,? чтобы|больше не прид[её]тся|забудьте о том/i.test(allText)) V("п.1 самозащита (паттерны: «не как у других/них», «без того, чтобы», «больше не придётся», «забудьте о том») - заменить на утверждение/цифру");
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
// 5. манипуляции. Срочность запрещена только БЕЗ опоры на ФАКТ. Факт бывает двух видов и они
// не равнозначны: календарный дедлайн проверяем по дате в том же слоте, а ОСТАТОК цифрой в тексте
// не доказывается вовсе - «Осталось 3 места» это канонический пример ложного дефицита (COPY-AUDIT П.8)
// и прямой риск по тесту ФАС. Настоящий остаток подтверждается только записью в facts.json.
const URGENCY = /только сегодня|осталось \d+ мест|успей(?:те)?|сгорит|переч[её]ркнут/i;
const HAS_DATE = /\d{1,2}\.\d{1,2}(?:\.\d{2,4})?|\d{1,2}\s*(?:январ|феврал|март|апрел|ма[йя]|июн|июл|август|сентябр|октябр|ноябр|декабр)[а-яё]*/i;
// заявка о дефиците: «осталось 3 места», «остались 2 комплекта», «осталось всего 5 позиций»
const SCARCITY = /остал(?:ось|о|ись|ся)\s+(?:всего\s+|лишь\s+|последн[а-яё]+\s+)?(\d+)\s*(?:мест|шт|штук|позиц|слот|комплект|пакет)/i;
const factsPath = join(dirname(pjPath), "..", "..", "facts.json");
let facts = null;
try { if (existsSync(factsPath)) facts = JSON.parse(readFileSync(factsPath, "utf8").replace(/^﻿/, "")); } catch { facts = null; }
// остаток настоящий, только если ЭТО ЖЕ число лежит в facts.json под меткой про остаток/места/квоту
// (либо записано там же строкой). Нет facts.json - подтвердить нечем, значит не подтверждено.
function leftConfirmed(n) {
  if (!facts) return false;
  const same = new RegExp(`(?<!\\d)${n}(?!\\d)`);
  for (const it of arr(facts.numbers)) {
    const label = String((it && it.label) || ""), value = String((it && it.value) || "");
    if (/остат|остал|мест|квот|свободн|поток|групп|набор/i.test(label) && same.test(value)) return true;
  }
  return new RegExp(`(?:остал[а-яё]*|остат[а-яё]*|свободн[а-яё]*)\\s+(?:всего\\s+)?${n}(?!\\d)`, "i").test(collect(facts).join("\n"));
}
for (const u of textUnits) {
  const sc = SCARCITY.exec(u.text);
  if (!URGENCY.test(u.text) && !sc) continue;
  if (sc && !leftConfirmed(sc[1])) {
    V(`п.5 ложный дефицит в «${u.where}»: «осталось ${sc[1]}» ничем не подтверждено - цифра в тексте остатка НЕ доказывает (тест ФАС). Подтверждение только из facts.json (numbers с меткой про места/квоту/набор); нечем подтвердить - снять заявку о дефиците`);
    continue;
  }
  if (sc) { W(`п.5 дефицит в «${u.where}» - остаток совпал с числом из facts.json, перед выдачей сверь актуальность`); continue; }
  if (HAS_DATE.test(u.text)) { W(`п.5 срочность в «${u.where}» - дедлайн с датой, сверь дату с facts.json`); continue; }
  V(`п.5 манипуляция (ложная срочность/дефицит/перечёркнутая цена) в «${u.where}» - нет ни даты, ни подтверждённого факта`);
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
// Правил осталось два: числа цифрами и кавычки-ёлочки. Проверка «точка в конце
// короткого элемента» СНЯТА сознательно: на живой странице она давала полтора
// десятка срабатываний при нуле реальных дефектов (порог «короткого элемента»
// накрывал карточку из двух предложений, где финальная точка обязательна), и
// правила этого нет ни в VOICE.md, ни в COPY-AUDIT.md - писатель его не знает,
// то есть шум воспроизводился бы на каждой странице каждого прогона.
// ---------------------------------------------------------------------------

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
  // единица счёта: количество элементов берём ТОЛЬКО из явных формулировок с ней
  // (или из «ровно N» / «N-M по K-L» / объектного {count:...}). Без единицы «N-M» - это длина.
  const CNT_UNIT = "(?:шт|элемент|сегмент|позици|пункт|карточ|плашк|строк|тариф|итем|фото|ссыл|видео|слайд|отзыв|вопрос|шаг|логотип|сертификат)";
  let m;
  if ((m = /ровно\s+(\d+)/i.exec(s))) out.count = { lo: +m[1], hi: +m[1] };
  else if ((m = new RegExp(`от\\s+(\\d+)\\s+до\\s+(\\d+)\\s*${CNT_UNIT}`, "i").exec(s))) out.count = { lo: +m[1], hi: +m[2] };
  // между числом и единицей допускается одно определение («4-10 текстовых ссылок»), но НЕ «символов»:
  // «20-60 символов на строку» - это длина, а не количество строк.
  else if ((m = new RegExp(`(\\d+)\\s*-\\s*(\\d+)\\s*(?:(?!симв|знак)[а-яё]+\\s+)?${CNT_UNIT}`, "i").exec(s))) out.count = { lo: +m[1], hi: +m[2] };
  // «3-5 по 100-210» - число элементов и длина каждого, единицы счёта нет (формат из BLOCKS.md)
  else if ((m = /^\s*(\d+)\s*-\s*(\d+)\s+по\s+(\d+)\s*-\s*(\d+)/i.exec(s))) { out.count = { lo: +m[1], hi: +m[2] }; out.itemLen = { lo: +m[3], hi: +m[4] }; }
  // голый диапазон («170-420», «от 170 до 420») означает ДЛИНУ ЭЛЕМЕНТА, а не их
  // число: у скаляров этот же формат уже читается как длина (page-writer, п.3).
  else if ((m = /^\s*(?:от\s+)?(\d+)\s*(?:-|до)\s*(\d+)\s*$/i.exec(s))) out.itemLen = { lo: +m[1], hi: +m[2] };
  else if ((m = /^\s*(\d+)\s*$/.exec(s))) out.count = { lo: +m[1], hi: +m[1] };
  // пары «имя_поля A-B» (имя поля всегда латиницей: title, text, features). Имя обязано стоять
  // после разделителя (начало строки, «:», «+», «,», «;»): без этого условия из «подзаголовки H3
  // 2-3 шт.» вычитывалось несуществующее поле h3 с «длиной 2-3 символа» и сыпались ложные W.
  for (const f of s.matchAll(/(?:^|[+,;:]\s*)([a-z_][a-z0-9_]*)\s*:?\s*(\d+)\s*-\s*(\d+)\s*([^\s,;+]*)/gi)) {
    if (new RegExp(`^${CNT_UNIT}`, "i").test(f[4] || "")) continue; // «... + фото 3-5 шт.» - это счёт, не длина
    out.fields[f[1].toLowerCase()] = { lo: +f[2], hi: +f[3] };
  }
  // хвост «по K-L симв.» / «по K-L» в конце строки - длина одного элемента
  if ((m = /по\s+(\d+)\s*-\s*(\d+)\s*(?:симв[а-яё]*|знак[а-яё]*)?\s*\.?\s*$/i.exec(s))) out.itemLen = { lo: +m[1], hi: +m[2] };
  return out;
}

// Лимит скалярного слота. Кроме голого «N-M» принимаем диапазон с пояснением - именно так
// block-planner пишет limits в роли ПРАВИЛ ЗАПОЛНЕНИЯ (ADR-035): «15-60, обязательно»,
// «5-20; пусто -> карточка показывает 'цена по запросу'». Раньше такие лимиты молча не
// проверялись вовсе - проверка выглядела работающей и не работала.
const SCAL_NOT_LEN = /^(?:шт|элемент|сегмент|позици|пункт|карточ|плашк|строк|слов|предложен|тариф|итем|фото|ссыл|видео|слайд|отзыв|абзац|секунд|минут|дн[еяй]|мес)/i;
function parseScalarLimit(lim) {
  const s = String(lim == null ? "" : lim).trim();
  if (!s) return null;
  let m = /по\s+(\d+)\s*-\s*(\d+)\s*(?:симв[а-яё]*|знак[а-яё]*)/i.exec(s);
  if (m) return { lo: +m[1], hi: +m[2] };
  m = /^\s*(?:от\s+)?(\d+)\s*(?:-|до)\s*(\d+)\s*(.*)$/i.exec(s);
  if (!m) return null;
  if (SCAL_NOT_LEN.test(String(m[3] || "").trim())) return null; // «1-2 предложения» - это не длина в символах
  const lo = +m[1], hi = +m[2];
  if (hi < lo || hi < 5) return null; // диапазон вида «1-2» длиной в символах быть не может
  return { lo, hi };
}

// сверка длин scalar-слотов с limits из blueprint (диапазон, в том числе с пояснением; несущее ограничение вёрстки).
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
    // ДОСТАВКА ФОРМУЛЫ ОФФЕРА (ADR-037 п.5). Поля page_offer и sell пишет block-planner,
    // и до сих пор их не читал НИ ОДИН скрипт - несущий гейт держался на ручной вычитке.
    // Жёстко судим только новый контракт: рецепт стратега пришёл ОБЪЕКТОМ (значит задача
    // заведена после ADR-037), а page_offer в blueprint нет. Старые задачи со строковым
    // рецептом деградируют предупреждением (ADR-031).
    // -----------------------------------------------------------------------
    let recipe = null;
    try {
      const sPath = join(dirname(pjPath), "..", "..", "strategy.json");
      if (existsSync(sPath)) recipe = JSON.parse(readFileSync(sPath, "utf8").replace(/^﻿/, "")).offer_formula_recipe;
    } catch { recipe = null; }
    const poFilled = bp.page_offer && typeof bp.page_offer === "object" && !Array.isArray(bp.page_offer)
      && Object.values(bp.page_offer).some((v) => String(v == null ? "" : v).trim());
    if (!poFilled) {
      const isNewContract = recipe && typeof recipe === "object" && !Array.isArray(recipe);
      const msg = `в blueprint нет заполненного page_offer - формула оффера до писателя не доехала (ADR-037 п.5), первый экран пишется вслепую. Чинит block-planner (6a1)`;
      if (isNewContract) V(msg);
      else W(`${msg}. Рецепт стратега старого формата - задача идёт по прежнему контракту (ADR-031), но первый экран проверь отдельно`);
    }
    // sell: у содержательных блоков. Закрытый список служебных фрагментов - ADR-037 п.5.
    const SERVICE_FRAG = /^(?:breadcrumbs|anchor-nav|nav|legal|footer|cookie)$/i;
    const noSell = [], longSell = [];
    for (let i = 0; i < bpBlocks.length; i++) {
      const b = bpBlocks[i] || {};
      const bn = b.n != null ? b.n : i + 1;
      if (SERVICE_FRAG.test(String(b.fragment || ""))) continue;
      const onlyEmptyState = b.empty_state && !b.slots && !b.limits;
      if (onlyEmptyState) continue;
      const sell = String(b.sell == null ? "" : b.sell).trim();
      if (!sell) noSell.push(bn);
      else if (sell.length > 160) longSell.push(`${bn} (${sell.length})`);
    }
    if (noSell.length && poFilled) W(`blueprint: блоки без sell - ${noSell.slice(0, 8).join(", ")}${noSell.length > 8 ? ` и ещё ${noSell.length - 8}` : ""}. Блок без sell - блок без работы (ADR-037 п.5): либо задание, либо блок снимается`);
    if (longSell.length) W(`blueprint: sell длиннее 160 знаков в блоках ${longSell.join(", ")} - это задание, а не текст блока; длинный sell превращается во второй notes`);

    // -----------------------------------------------------------------------
    // PRE-FLIGHT: blueprint - канон структуры страницы. Состав блоков писатель
    // менять не должен (см. запреты page-writer). Но ПОЛНОТА состава - вопрос
    // финального шлюза, а не каждого прогона по одной странице: пока идёт веер
    // писателей, неполная страница - штатное промежуточное состояние, и exit 2
    // на ней отправляет круг правок не тому агенту (copy-auditor блок дописать
    // не может). Поэтому жёстко (V) отмечаем только то, что писатель ОБЯЗАН был
    // написать: блоки, не помеченные в blueprint как ненаписанные, и только при
    // сошедшейся нумерации. Всё остальное - предупреждение.
    // -----------------------------------------------------------------------
    const bpIds = bpBlocks.map((x, i) => (x && x.n != null ? x.n : i + 1));
    const pgIds = blocks.map((b, i) => (b && b.n != null ? b.n : i + 1));
    const bpSet = new Set(bpIds), pgSet = new Set(pgIds);
    const label = (id, t) => `${id}${t ? ` (${t})` : ""}`;
    const short = (l) => `${l.slice(0, 3).join(", ")}${l.length > 3 ? ` и ещё ${l.length - 3}` : ""}`;
    // блок, который писателю писать не поручали: режим «заглушка» (раздел объявлен, содержания
    // нет) или явная пометка в blueprint. Его отсутствие в page.json - не брак сдачи.
    const notWritten = (x) => !!x && (x.written === false || x.optional === true || x.by_client === true
      || /заглушк|stub|не пишется/i.test(String(x.mode || "")));
    const missIdx = bpIds.map((_, i) => i).filter((i) => !pgSet.has(bpIds[i]));
    const missHard = missIdx.filter((i) => !notWritten(bpBlocks[i])).map((i) => label(bpIds[i], (bpBlocks[i] && bpBlocks[i].type) || ""));
    const missSoft = missIdx.filter((i) => notWritten(bpBlocks[i])).map((i) => label(bpIds[i], (bpBlocks[i] && bpBlocks[i].type) || ""));
    // нумерация разъехалась целиком: блоков в тексте не меньше, чем в плане, но ни один номер не
    // совпал. Это расхождение НОМЕРОВ, а не пропущенный текст - сверять состав по номерам нельзя.
    const renumbered = bpIds.length > 0 && pgIds.length >= bpIds.length && !pgIds.some((id) => bpSet.has(id));
    const extra = pgIds.map((id, i) => label(id, (blocks[i] && blocks[i].type) || "")).filter((_, i) => !bpSet.has(pgIds[i]));
    if (renumbered) {
      W(`pre-flight: нумерация блоков не сошлась с blueprint (page.json ${pgIds.slice(0, 6).join(", ")}; blueprint ${bpIds.slice(0, 6).join(", ")}) - блоков в тексте не меньше, чем в плане, так что это расхождение номеров, а не пропущенный текст; состав по номерам не сверяем`);
    } else {
      if (missHard.length) V(`pre-flight: в page.json нет блоков из blueprint - ${short(missHard)} (не написано ${missHard.length} из ${bpIds.length}) - дописать должен page-writer (copy-auditor блок не дописывает), HTML не собираем`);
      if (missSoft.length) W(`pre-flight: нет блоков, помеченных в blueprint как ненаписанные (${short(missSoft)}) - штатно, текстом не чинится`);
      if (extra.length) W(`pre-flight: в page.json блоки вне blueprint - ${short(extra)}: состав блоков писатель менять не должен, замеченную проблему пишут в сводку`);
      const commonPg = pgIds.filter((id) => bpSet.has(id)), commonBp = bpIds.filter((id) => pgSet.has(id));
      if (commonPg.join(",") !== commonBp.join(",")) W(`pre-flight: порядок блоков разошёлся с blueprint (page.json ${commonPg.join(", ")}; blueprint ${commonBp.join(", ")})`);
    }
    // Баланс функций считаем ПО BLUEPRINT: page.json функцию не несёт, и это нормально.
    const fns = bpBlocks.map((x) => String((x && x.function) || "").trim()).filter(Boolean);
    const vFns = fns.filter((f) => /^[ВB]/i.test(f)).length;
    if (fns.length && vFns * 2 > fns.length) W(`страница-оправдание: блоков функции «В» ${vFns} из ${fns.length} содержательных (больше половины) - человек пришёл покупать, а ему всю дорогу объясняют, почему бояться не нужно; проверь состав по ADR-032`);

    // -----------------------------------------------------------------------
    // Лимиты слотов: скаляры (простое "N-M") + repeatables (плашки, карточки,
    // тарифы - «ровно 3: title 10-30 + text 30-90»). Длины элементов копим и
    // печатаем одной строкой, чтобы не раздувать вывод.
    // -----------------------------------------------------------------------
    const repHard = [], lenSoft = [], cntHard = [], cntSoft = [], scalHard = [], totalSoft = [];
    const fold = (list, n = 3) => `${list.slice(0, n).join("; ")}${list.length > n ? ` и ещё ${list.length - n}` : ""}`;
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      const bb = (b.n != null ? bpBlocks.find((x) => x.n === b.n) : bpBlocks[i]) || null;
      if (!bb || !bb.limits) continue;
      const bn = b.n != null ? b.n : i + 1;
      const slots = (b.slots && typeof b.slots === "object") ? b.slots : {};
      for (const [slot, lim] of Object.entries(bb.limits)) {
        // h2 по контракту (KIT-SPEC, page.json) лежит на уровне БЛОКА рядом со slots,
        // а не внутри slots: без этой подстраховки лимит h2 не проверялся бы никогда.
        let val = slots[slot];
        if ((val == null || val === "") && slot === "h2" && b.h2) val = String(b.h2);
        // limits.total - бюджет объёма ВСЕГО блока (BLOCKS.md: несущее ограничение вёрстки,
        // build-handoff показывает его заказчику). Слота с таким именем в page.json нет,
        // поэтому меряем сумму всех строк блока. Только W: сумма - оценка, не жёсткий контракт.
        if (/^(?:total|всего|объ[её]м)$/i.test(slot) && typeof val !== "string") {
          const r = parseScalarLimit(lim);
          const sum = collect(b.slots).reduce((a, s) => a + s.length, 0) + (b.h2 ? String(b.h2).length : 0);
          if (r && sum) {
            if (sum > Math.round(r.hi * 1.15)) totalSoft.push(`блок ${bn} целиком ${sum} симв (бюджет ${r.lo}-${r.hi})`);
            else if (sum < Math.round(r.lo * 0.85)) totalSoft.push(`блок ${bn} целиком ${sum} симв - ниже бюджета ${r.lo}-${r.hi}`);
          }
          continue;
        }
        if (Array.isArray(val)) {
          const rl = parseRepeatLimit(lim);
          // Блок в режиме «шаблон»/«заглушка» (ADR-035): limits описывают ОБЪЁМ К ЗАПУСКУ, который
          // наполняет заказчик, а в тексте лежат 1-2 демо-единицы. Мерить их лимитом запуска нельзя:
          // получится блокирующее нарушение на корректной по замыслу странице, и починить его текстом
          // невозможно. Сверяем с demo_units, а сам лимит запуска в этом режиме не применяем.
          const mode = String(bb.mode || (bb.placeholder ? "шаблон" : "рабочий")).toLowerCase();
          const isDraftMode = /шаблон|заглушк|template|stub/.test(mode);
          if (rl.count && !isDraftMode) {
            const { lo, hi } = rl.count, n = val.length;
            if (n < lo || n > hi) {
              const dev = n < lo ? lo - n : n - hi;
              const norm = lo === hi ? `ровно ${lo}` : `${lo}-${hi}`;
              if (dev > 1) cntHard.push(`блок ${bn} «${slot}» ${n} элем (лимит ${norm}, отклонение на ${dev})`);
              else cntSoft.push(`блок ${bn} «${slot}» ${n} элем (лимит ${norm})`);
            }
          } else if (rl.count && isDraftMode) {
            const want = Number(bb.demo_units) || 0;
            if (want && val.length !== want) cntSoft.push(`блок ${bn} «${slot}»: режим «${mode}», демо-единиц ${val.length}, а в blueprint заявлено ${want}`);
          }
          val.forEach((el, k) => {
            const at = `блок ${bn} «${slot}»[${k + 1}]`;
            const one = (name, s, r) => {
              const len = s.length;
              if (len > Math.round(r.hi * 1.15)) repHard.push(`${at}${name ? "." + name : ""} ${len} симв (лимит ${r.lo}-${r.hi})`);
              else if (len > r.hi) lenSoft.push(`${at}${name ? "." + name : ""} ${len} симв - выше лимита ${r.lo}-${r.hi} (в пределах 15%)`);
              else if (len < r.lo) lenSoft.push(`${at}${name ? "." + name : ""} ${len} симв - ниже лимита ${r.lo}-${r.hi}`);
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
        const r = parseScalarLimit(lim);
        if (!r) continue; // диапазона в лимите нет вовсе - мерить нечем, пропускаем
        if (typeof val !== "string" || !val.trim()) continue;
        const len = val.length, lo = r.lo, hi = r.hi;
        if (len > Math.round(hi * 1.15)) scalHard.push(`блок ${bn} слот «${slot}» ${len} симв (лимит ${lo}-${hi})`);
        else if (len > hi) lenSoft.push(`блок ${bn} слот «${slot}» ${len} симв - выше лимита ${lo}-${hi} (в пределах 15%)`);
        else if (len < lo) lenSoft.push(`блок ${bn} слот «${slot}» ${len} симв - ниже лимита ${lo}-${hi}`);
      }
    }
    // Вывод свёрнут по правилам, а не по местам: на живой странице отклонений
    // бывают десятки, и построчный список делает отчёт нечитаемым.
    if (cntHard.length) V(`число элементов вне лимита (ломает сетку вёрстки): ${fold(cntHard)}`);
    if (scalHard.length) V(`слоты выше лимита более чем на 15% (ломает вёрстку): ${fold(scalHard)}`);
    if (cntSoft.length) W(`число элементов вне лимита на 1: ${fold(cntSoft)}`);
    // длина элемента - такое же предупреждение, как длина скалярного слота (не V)
    if (repHard.length) W(`длины элементов repeatables выше лимита более чем на 15%: ${fold(repHard)}`);
    if (lenSoft.length) W(`длины слотов и элементов вне лимита: ${fold(lenSoft)}`);
    if (totalSoft.length) W(`объём блока целиком вне бюджета limits.total: ${fold(totalSoft)}`);
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

// места с CTA: блок считается одним местом, даже если в нём и CTA-слот, и форма.
// Считаются ВСЕГДА (не только при известном регистре): их читает и продающий пол (ADR-037 F3),
// и проверки регистра ниже.
const CTA_SLOT = /cta|btn|button|кнопк/i;
const CTA_FRAGMENT = /^(?:form|cta-mid)$/i;
const ctaUnits = [], ctaPlaces = [];
for (let i = 0; i < blocks.length; i++) {
  const b = blocks[i] || {};
  const bn = b.n != null ? b.n : i + 1;
  const frag = String(b.fragment || "");
  let isCta = CTA_FRAGMENT.test(frag);
  if (b.slots && typeof b.slots === "object") {
    for (const [slot, val] of Object.entries(b.slots)) {
      if (CTA_SLOT.test(slot)) {
        isCta = true;
        const t = collect(val).join("  ");
        if (t.trim()) ctaUnits.push({ where: `блок ${bn}, слот «${slot}»`, text: t, frag });
        continue;
      }
      // кнопка внутри повторяемого элемента: у блока цен она лежит в slots.tariffs[].cta,
      // и по имени слота («tariffs») место с CTA не опознаётся - блок недосчитывался.
      if (!Array.isArray(val)) continue;
      const inner = [];
      for (const el of val) {
        if (!el || typeof el !== "object" || Array.isArray(el)) continue;
        for (const [f, fv] of Object.entries(el)) if (CTA_SLOT.test(f) && typeof fv === "string" && fv.trim()) inner.push(fv);
      }
      // кнопки внутри повторяемых элементов (карточка товара, тариф, кейс) - НАВИГАЦИЯ,
      // а не главный призыв страницы: «Подробнее» на карточке листинга это норма каталога.
      if (inner.length) { isCta = true; ctaUnits.push({ where: `блок ${bn}, кнопки в «${slot}»`, text: inner.join("  "), frag, nav: true }); }
    }
  }
  if (isCta) ctaPlaces.push(`блок ${bn}`);
}

// ---------------------------------------------------------------------------
// ПРОДАЮЩИЙ ПОЛ (ADR-037): минимум, ниже которого коммерческая страница не сдаётся.
// Регистр меняет ФОРМУ пола (проверки ниже), но не отменяет его ни в одном варианте:
// заказчик, попросивший «не продавать», просит убрать напор и штампы, а не обещание.
// Машине отдано только грепаемое - наличие первого экрана, наличие места с целевым
// действием, стоп-лист надписей, цифра в первом экране. Суждение «продаёт ли» - у tekst-verifier.
// ---------------------------------------------------------------------------
const metaPath = join(dirname(pjPath), "..", "..", "meta.json");
let waivers = [];
try {
  if (existsSync(metaPath)) waivers = arr(JSON.parse(readFileSync(metaPath, "utf8").replace(/^﻿/, "")).selling_floor_waivers);
} catch { waivers = []; }
// waiver действителен ТОЛЬКО с непустым source (решение гейта либо строка materials_missing).
// Waiver без основания игнорируется - иначе пол обходится одной пустой строкой в meta.json.
const FLOOR_RULES = ["F1", "F2", "F3", "F4"];
const normSlug = (s) => String(s || "").trim().replace(/^\/+|\/+$/g, "").toLowerCase();
// Точное совпадение по закрытому списку. Префиксное сопоставление молча снимало не то правило:
// шаблон из ADR «F1|F2|F3|F4», скопированный дословно, гасил ровно F1 и никого об этом не извещал.
function waiverFor(rule) {
  for (const w of waivers) {
    if (!w) continue;
    const r = String(w.rule || "").trim().toUpperCase();
    const p = normSlug(w.page), src = String(w.source || "").trim();
    if (p !== normSlug(pageSlug)) continue;
    if (r !== rule) continue;
    if (!src) continue;
    return w;
  }
  return null;
}
// неразобранные waiver: молчащий waiver хуже отсутствующего - оркестратор считает пол снятым
const pagesJsonPath = join(dirname(pjPath), "..", "..", "pages.json");
let knownSlugs = null;
try {
  if (existsSync(pagesJsonPath)) {
    const pj = JSON.parse(readFileSync(pagesJsonPath, "utf8").replace(/^﻿/, ""));
    const list = Array.isArray(pj) ? pj : arr(pj.pages);
    knownSlugs = new Set(list.map((x) => normSlug(x && (x.slug || x.page_slug))).filter(Boolean));
  }
} catch { knownSlugs = null; }
for (const w of waivers) {
  if (!w) continue;
  const r = String(w.rule || "").trim().toUpperCase();
  // waiver с чужим или опечатанным slug исчезал бесследно: правило оставалось, а оркестратор
  // считал его снятым. Сообщаем, если страницы с таким slug в проекте нет вовсе.
  if (knownSlugs && knownSlugs.size && !knownSlugs.has(normSlug(w.page))) {
    W(`waiver не применён: страницы «${String(w.page || "")}» нет в pages.json - проверь slug`);
    continue;
  }
  if (normSlug(w.page) !== normSlug(pageSlug)) continue;
  if (!FLOOR_RULES.includes(r)) {
    W(`waiver не применён: правило «${String(w.rule || "")}» не из списка F1-F4 (одна строка waiver = одно правило)`);
    continue;
  }
  if (!String(w.source || "").trim()) {
    W(`waiver не применён: у правила ${r} пустой source - нужно основание (решение гейта, строка materials_missing либо ложное срабатывание с пояснением)`);
  }
}
function floorV(rule, msg) {
  const w = waiverFor(rule);
  if (w) W(`пол ${rule} снят waiver'ом: ${msg} - причина: ${String(w.why || "не названа")} (основание: ${w.source})`);
  else V(`пол ${rule}: ${msg}`);
}

const pageType = String((page.page && page.page.type) || "");
// Продающий пол жёсткий на КОММЕРЧЕСКИХ типах. Инфо, контакты, документы, доставка, блог -
// там обещание с цифрой не обязано быть, требование к ним свелось бы к шуму.
const COMMERCIAL = /услуг|товар|главн|продукт|категор|цен|прайс|стоимост|каталог|тариф/i.test(pageType);
// F1. Первый экран. Жёстко - для страниц, которые продают напрямую. Для категорий и хабов
// Hero опционален по рецептам BLOCKS.md (крошки -> intro -> листинг), там только напоминание.
// Каталожный рецепт BLOCKS.md (крошки -> intro -> листинг) - законная страница без Hero,
// даже если в `type` стоит слово «Товар»: это листинг-зонтик, а не карточка.
const CATALOG_SHAPE = /^breadcrumbs$/i.test(String((blocks[0] || {}).fragment || ""))
  && blocks.some((b) => /^(?:product-listing|category-grid|subcategory-tiles)$/i.test(String(b.fragment || "")));
if (!hero) {
  if (/услуг|товар|главн|продукт/i.test(pageType) && !CATALOG_SHAPE && !/листинг|каталог|зонтик/i.test(pageType)) {
    floorV("F1", `у страницы типа «${pageType}» нет первого экрана (нет блока fragment "hero" и блока с типом «первый экран»)`);
  } else {
    W(`пол F1: первого экрана нет (тип «${pageType || "не указан"}») - для категорий и хабов это штатно по BLOCKS.md, но сверь с blueprint, что так задумано`);
  }
}

// F2. Обещание в первом экране. Грепом ловится только самый явный провал - обещание не на что
// приземлить; адресат и обещанный результат проверяет tekst-verifier по закрытому списку.
if (hero) {
  // Считаем ЧИСЛА, а не символы-цифры: «Bitrix24», «1С», «152-ФЗ», «3ds Max» - это имена,
  // а не обещание. Токен с буквой внутри числом не считается.
  const numTokens = (s) => (String(s).match(/\S+/g) || [])
    .map((t) => t.replace(/^[«"'(\[]+|[»"'),.;:!?\]]+$/g, ""))
    .filter((t) => /\d/.test(t) && !/[A-Za-zА-Яа-яЁё]/.test(t))
    .map((t) => t.replace(/\D/g, ""))
    .filter(Boolean);
  // Ценовой ноль - тоже приземление: у бесплатного первого шага обещание в цифре не нуждается.
  const FREE = /(?<![а-яёa-z])(?:бесплатн\w*|без\s+оплаты|0\s*(?:₽|руб))/i;

  // Несущий слот оффера - подзаголовок (VOICE.md п.5). Цифра в плашке или бонусе обещание
  // в подзаголовке не заменяет, поэтому меряем их отдельно.
  const hs = (hero.slots && typeof hero.slots === "object") ? hero.slots : {};
  const subText = String(hs.subhead || hs.sub || hs.lead || "");
  const subLanded = numTokens(subText).length > 0 || FREE.test(subText);
  const heroLanded = numTokens(firstScreenText).length > 0 || FREE.test(firstScreenText);

  const factNums = [], factLabels = [];
  for (const n of arr(facts && facts.numbers)) {
    if (!n || String(n.publish == null ? "as-is" : n.publish) === "no") continue;
    const val = String(n.value == null ? "" : n.value);
    if (/\[ЗАПОЛНИТЬ|требует уточнения/i.test(val)) continue;
    const ds = numTokens(val);
    if (!ds.length) continue;
    factNums.push(...ds);
    factLabels.push(`${String(n.label || "").trim()} = ${val.trim()}`.slice(0, 60));
  }
  const heroNums = numTokens(firstScreenText);
  const subNums = numTokens(subText);
  const confirmed = factNums.filter((d) => heroNums.includes(d));
  I(`первый экран: чисел ${heroNums.length}, из них подтверждено facts.json ${confirmed.length}; публикуемых чисел в facts.json ${factNums.length}; мест с целевым действием на странице ${ctaPlaces.length}`);

  // ГРАНИЦА МАШИНЫ. По ADR-037 обещание приземляется ТРЕМЯ равноправными способами: число из facts.json,
  // названный адресат, обещанный результат. Грепом различим ровно один - значит скрипт не имеет права
  // судить, есть обещание или нет. Жёстко валим только то, что видно наверняка: несущего слота НЕТ вовсе.
  // Всё остальное - предупреждение, а решение выносит tekst-verifier (проверка 7): у него все три критерия.
  if (!subText.trim()) {
    const msg = "у первого экрана нет подзаголовка - несущий слот оффера пуст (VOICE.md п.5). Обещание ставить некуда";
    if (COMMERCIAL) floorV("F2", msg);
    else W(`пол F2 (тип «${pageType || "не указан"}», не коммерческий - мягко): ${msg}`);
  } else {
    const subConfirmed = factNums.filter((d) => subNums.includes(d));
    if (subNums.length && !subConfirmed.length) {
      W(`пол F2: число в подзаголовке первого экрана НЕ подтверждено facts.json (${subNums.slice(0, 3).join(", ")}) - проверь, что это не сочинённая и не приблизительная цифра (ADR-037 п.6: приблизительных нет)`);
    } else if (!subNums.length && !FREE.test(subText)) {
      const tail = factNums.length
        ? `публикуемых чисел в facts.json - ${factNums.length}`
        : "публикуемых чисел в facts.json нет вовсе - обещание придётся держать на адресате или результате, а недостающая цифра уходит запросом заказчику";
      const inPlate = heroLanded ? " При этом число на первом экране ЕСТЬ, но стоит в плашке или бонусе, а не в несущем слоте." : "";
      W(`пол F2: в подзаголовке первого экрана нет числа. Это законно, если обещание держится на названном адресате или обещанном результате (ADR-037 F2, судит tekst-verifier);${inPlate} ${tail}`);
    }
  }

  // Первый экран с дырой фактуры. Холодный читатель («это новое или старое?» - канон копирайтинга)
  // видит незакрытую скобку раньше, чем текст: страница читается как недоделанная. Ни один слой
  // это место отдельно не смотрел - пометки считались по всей странице скопом.
  if (/\[ЗАПОЛНИТЬ|\[требует /i.test(firstScreenText)) {
    const msg = "в первом экране осталась пометка [ЗАПОЛНИТЬ] - самое видное место страницы читается как недоделанное. Пометкам место ниже по странице, не в Hero";
    if (COMMERCIAL) floorV("F2", msg);
    else W(`пол F2 (тип «${pageType || "не указан"}», не коммерческий - мягко): ${msg}`);
  }
}

// Где на странице появляется первое целевое действие. Канон: «что делать дальше?» - один из шести
// вопросов, на которые первый экран обязан ответить. Кнопка в предпоследнем блоке = ответа нет,
// пока человек не долистает всю страницу. Ни F3, ни лимиты этого не видели: там считается ЧИСЛО мест.
if (ctaPlaces.length && blocks.length >= 4) {
  const firstIdx = blocks.findIndex((b, i) => ctaPlaces.includes(`блок ${b && b.n != null ? b.n : i + 1}`));
  if (firstIdx >= 0) {
    const pos = firstIdx + 1;
    I(`первое целевое действие - блок ${pos} из ${blocks.length}`);
    if (pos > Math.max(3, Math.ceil(blocks.length / 2))) {
      W(`пол F3: первое целевое действие появляется только в блоке ${pos} из ${blocks.length} - до этого места читателю некуда пойти. Проверь, что в первом экране есть кнопка или якорь на форму`);
    }
  }
}

// F3. Целевое действие: оно есть, и надпись называет предмет.
if (!ctaPlaces.length) {
  const msg = "на странице нет ни одного места с целевым действием (ни CTA-слота, ни формы) - читателю некуда пойти";
  if (COMMERCIAL) floorV("F3", msg);
  else W(`пол F3 (тип «${pageType || "не указан"}», не коммерческий - мягко): ${msg}`);
}
const CTA_STOP = /^\s*(?:отправить(?:\s+(?:заявку|сообщение|вопрос|форму))?|подробнее|узнать\s+больше|читать\s+далее|далее|перейти|submit|оставить\s+заявку)\s*[.!]?\s*$/i;
const ctaSeen = new Set();
for (const u of ctaUnits) {
  for (const part of String(u.text).split(/\s{2,}/)) {
    const t = part.trim();
    if (!t) continue;
    if (CTA_STOP.test(t)) {
      // Жёстко - только ГЛАВНЫЙ призыв страницы. Сабмит формы: надпись обязана отвечать ЗАГОЛОВКУ
      // формы, а его греп не видит (раздел «Идеальный CTA» в COPY.md) - разбирает copy-auditor.
      // Кнопка внутри карточки листинга - навигация, стоп-лист к ней не применяется жёстко.
      const key = `${u.nav ? "nav" : u.frag}|${t.toLowerCase()}`;
      if (ctaSeen.has(key)) continue;
      ctaSeen.add(key);
      if (u.nav) W(`пол F3: «${t}» (${u.where}) - навигация внутри карточек; для листинга это норма, но на карточке с ценой уместнее предметная надпись`);
      else if (/^form$/i.test(u.frag)) W(`пол F3: сабмит «${t}» (${u.where}) - проверь по заголовку формы: надпись обязана называть, что произойдёт, и отвечать заголовку`);
      else floorV("F3", `надпись главной кнопки «${t}» (${u.where}) из стоп-листа - кнопка обязана называть, что человек получит или что произойдёт («Рассчитать стоимость», «Забрать подборку», «Обсудить задачу»)`);
    }
    // Длину надписи пол НЕ проверяет: у неё один владелец - лимит слота из BLOCKS.md,
    // он приезжает в blueprint и сверяется общей проверкой лимитов выше. Второй диапазон
    // здесь дал бы третью норму на одну надпись (ровно класс «разъехавшихся контрактов»).
  }
}

// Абзацы длиннее 140 знаков. Ориентир из канона копирайтинга, НЕ гейт: `limits` из blueprint -
// несущее ограничение вёрстки, оно главнее. Здесь только счёт и сигнал при массовом перекосе.
{
  const frags = [];
  for (const b of blocks) for (const s of collect(b.slots)) { const t = String(s).trim(); if (t.length > 1) frags.push(t); }
  const longs = frags.filter((t) => t.length > 140);
  if (longs.length) {
    I(`фрагментов длиннее 140 знаков: ${longs.length} из ${frags.length} (максимум ${longs.reduce((m, t) => Math.max(m, t.length), 0)})`);
    if (frags.length && longs.length / frags.length > 0.5) {
      W(`больше половины фрагментов длиннее 140 знаков (${longs.length} из ${frags.length}) - перечитай длинные: обычно внутри второй абзац или хвост-досказывание`);
    }
  }
}

if (axisA || axisB) {
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
