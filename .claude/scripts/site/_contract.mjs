// _contract.mjs
// Одно определение общих правил контракта v8 на все скрипты этапа. До этого файла
// определение проверяемого факта, маркер снятия, разбор pages.yml, обход схемы и список
// смысловых решений гейта были переписаны в каждом скрипте дословно - и первое же
// расхождение между копиями стоило сборке контракта аудитории и оффера.
//
// Модуль ничего не печатает и никуда не пишет: он отдает функции, а отчет остается делом
// вызывающего скрипта.

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

// Словарь блоков живет в самом скиле анализа: /site-analiz - единственный его владелец
// и единственный читатель. Путь по умолчанию один на три скрипта.
export const PAGES_DEFAULT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "skills", "site-analiz", "pages.yml");

// ---------------------------------------------------------------- мелочи
export const arr = (x) => (Array.isArray(x) ? x : []);
export const str = (x) => (typeof x === "string" ? x.trim() : "");
export const low = (x) => str(x).toLowerCase();

// Дата всегда местная. toISOString дает UTC, и вечером по Москве дата шага расходится
// с датой контракта на сутки.
export const today = () => {
  const d = new Date(), p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

// Граница слова классом, а не \b: в JS \b опирается на ASCII и внутри кириллицы
// не срабатывает вовсе.
export const B = "(^|[^а-яa-z])";

// ---------------------------------------------------------------- проверяемый факт
// value содержит число с единицей ЛИБО artifact непуст. Город и телефон проверяемыми
// фактами не являются: на них ворота facts3 не открываются.
export const UNIT = "%|₽|руб[а-я]*|тыс[а-я.]*|млн|млрд|шт[а-я.]*|кв\\.?\\s?м|м2|м²|мм|см|км|кг|тонн[а-я]*|литр[а-я]*|год[а-я]*|лет|месяц[а-я]*|мес(?![а-я])|недел[а-я]+|дней|дня|день|дн(?![а-я])|час[а-я]*|мин[а-я]*|раз(?![а-я])|человек[а-я]*|сотрудник[а-я]*|специалист[а-я]*|объект[а-я]*|проект[а-я]*|клиент[а-я]*|позици[а-я]+|балл[а-я]*|ед(?![а-я])|м(?![а-яa-z])|т(?![а-яa-z])|л(?![а-яa-z])";
export const NUM_UNIT = new RegExp("\\d[\\d\\s.,]*\\s*(?:" + UNIT + ")", "i");
export const isCheckable = (f) => !!f && (!!str(f.artifact) || NUM_UNIT.test(str(f.value)));
export const hasNumber = (v) => /\d/.test(String(v == null ? "" : v));

// Маркер снятия: только явные служебные пометки, а не корни слов и не продающие фразы.
// Корень «снима»/«конфиденц» ловил «снимаем мерки на дому», «гарантируем конфиденциальность»,
// а слова пометки внутри фразы - «соблюдаем коммерческую тайну», «работаем под NDA», «не
// публикуем имена клиентов без согласия», «(снятие старых окон)», «(внутреннее и наружное)».
// Пометка - это:
// (1) указание неопределенной формой где угодно: «не публиковать», «не указывать», «не разглашать»,
//     «не показывать на сайте», «не для сайта», «не для печати»; но не обещание и не разрешение:
//     «обязуемся (обязаны, гарантируем, можем, может, можете, можно, вправе, будем) не раскрывать», в
//     том числе через одно-три слова («обязуемся третьим лицам данные не раскрывать»), «чтобы не
//     показывать». Слово разрешения - с начала слова: «возможно не публиковать» - пометка;
// (2) «не публикуем» («не печатаем», «не показываем», «не указываем», «не указывается», «не
//     размещаем», «не выкладываем», «не озвучиваем», «не называем», и «... на сайте»; но не «не
//     показывает», «не называй») целым полем или целым куском после «:», «;», «(», «[», «,», «.», « - »
//     до конца поля, скобки, знака или запятой: «оборот 50 млн, не публикуем», «Оборот 50 млн. Не
//     публикуем.», «50 млн (не публикуем на сайте)», «Не публикуем, только для КП», «[не публикуем]».
//     Скобка «(скрыть)», «(скрыто)», «(убрать)» - тоже. «Не раскрываем», «не разглашаем» куском -
//     обещание клиенту («данные клиентов - не раскрываем»), не пометка;
// (3) «под NDA», «коммерческая тайна» - куском после «:», «;», «(», «[», « - »;
// (4) «NDA» куском после «:», «;», « - » («выручка: NDA»), если перед ним не само соглашение
//     или защита («договор: NDA», «защита идеи: NDA»); «(NDA)» скобкой, кроме расшифровки термина
//     («соглашение о конфиденциальности (NDA)», «договор (NDA)»);
// (5) «конфиденциально» после «:», «(», «[», а после «,» и « - » - если перед ними не наречие на
//     «-о»: «выручка 120 млн - конфиденциально», «120 млн, конфиденциально» - пометка, «анонимно,
//     конфиденциально» и «лечение анонимно - строго конфиденциально» - продающие. «Строго
//     конфиденциально», «конфиденциальная информация» - только после «:» и «(»;
// (6) «внутреннее» - только скобкой «(внутреннее)», и не как пояснение прилагательного среднего рода
//     («квартирное (внутреннее)», «светодиодное (внутреннее)»); «ограничение (внутреннее)» - пометка;
//     «для внутреннего пользования» - в начале, после «только» и после «:», «;», «(», « - »;
// (7) «(снято)», «(снято заказчиком)», «(снято с публикации)» скобкой, «снято заказчиком» - целым
//     полем или куском после «:», «;», «,», « - »: «скидка 20% - снято заказчиком».
// «NDA», «под NDA», «конфиденциально», «коммерческая тайна» целым полем - в HELD_NDA_FIELD ниже:
// пометка или тема решает подпись факта. Проверяется каждое поле факта отдельно (label, value,
// artifact): «целое поле» не склеивается с соседним. Литерал один на анализ и kit: копия
// HELD_MARK_COPY в kit/scripts/import-project.mjs сверяется с ним тестом равенства. Буква е с
// точками - кодом \u0451: правило репозитория на сам файл.
export const HELD_MARK = /(^|[^а-я\u0451a-z0-9])(?<!(^|[^а-я\u0451])(обязу|обязан|гарантиру|обеща|мож|вправе|будем|стара|чтоб)[а-я\u0451]*\s+([а-я\u0451]+\s+){0,3})(не\s+(публиковать|печатать|указывать|упоминать|раскрывать|разглашать|называть|показывать|размещать|озвучивать)|не\s+для\s+(сайта|публикации|печати|размещения|распространения|показа))(?![а-я\u0451])|(^|[:;(\[,.]|\s[-\u2013\u2014])\s*не\s+(публик[а-я\u0451]*|печата[а-я\u0451]*|(показыва|указыва|размеща|выкладыва|озвучива|называ)(ем|ется|ются|ть|йте))(\s+(на|в)\s+(сайте|открытом\s+доступе|интернете|сети))?\s*($|[),.;!\]])|[(\[]\s*(скрыть|скрыто|скрыта|скрыты|скрываем|убрать|убираем)\s*[)\]]|([:;(\[]|\s[-\u2013\u2014])\s*(под\s+nda|коммерческ[а-я\u0451]*\s+тайн[а-я\u0451]*)\s*($|[).;!\]])|(?<!(nda|конфиденц|неразглаш|соглаш|договор|тайн|секрет|аноним|приватн|защит|гарант|безопасн)[^:;\n]*)([:;]|\s[-\u2013\u2014])\s*nda\s*($|[).;!])|(?<!(конфиденциальност|неразглашени|соглашени|договор)[а-я\u0451]*\s*)\(\s*nda\s*\)|([:(\[]|(?<![а-я\u0451]о)(,|\s[-\u2013\u2014]))\s*конфиденциально\s*($|[).;!\]])|[:(]\s*(строго\s+конфиденциально|конфиденциальн(ая|ые)\s+(информация|данные|сведения))\s*($|[).;!])|(?<![а-я\u0451](ое|ее)\s*)\(\s*внутреннее\s*\)|(^|[:;(]|\s[-\u2013\u2014]|только\s+)\s*для\s+внутренн[а-я\u0451]*\s+(пользования|использования)|\(\s*снят[оаы]?(\s+(заказчиком|с\s+публикации))?\s*\)|(^|[:;,]|\s[-\u2013\u2014])\s*снят[оаы]?\s+(заказчиком|с\s+публикации)\s*($|[).;!])/i;
// Слово-пометка целым полем («NDA», «под NDA», «конфиденциально», «коммерческая тайна») - пометка
// только как значение (или artifact) поля, подпись которого не о тайне и защите. Проверяется строка
// «подпись, перевод строки, значение» (и так же для artifact): «Выручка» - «NDA», «Клиенты» - «под
// NDA», «Себестоимость» - «коммерческая тайна» - слово стоит вместо содержания, факт закрыт. Подпись
// о самой тайне, соглашении, анонимности, защите или гарантиях («Договор», «Конфиденциальность»,
// «Анонимность», «Защита идеи», «Гарантии») - продающий факт «подписываем NDA», «конфиденциально».
// Подпись целым полем («NDA», «Коммерческая тайна» у факта «подписываем соглашение о
// неразглашении») - тема, а не пометка: HELD_MARK слов-пометок целым полем не ловит. Безопасно в обе
// стороны: продающий факт о тайне публикуется, а поле, где слово-пометка заменило значение,
// молчанием не публикуется. Копия в kit - HELD_NDA_FIELD_COPY, сверяется тем же тестом равенства.
export const HELD_NDA_FIELD = /^(?![^\n]*(nda|конфиденц|неразглаш|соглаш|договор|тайн|секрет|аноним|приватн|защит|гарант|безопасн))[^\n]*\n\s*(nda|под\s+nda|конфиденциально|коммерческ[а-я\u0451]*\s+тайн[а-я\u0451]*)\s*[.!]?\s*$/i;
export const heldMarked = (f) => [f && f.label, f && f.value, f && f.artifact].some((x) => HELD_MARK.test(low(x)))
  || [f && f.value, f && f.artifact].some((x) => HELD_NDA_FIELD.test(`${low(f && f.label)}\n${low(x)}`));
export const HELD_REASON = "маркер снятия";
// Маркер снятия и столкновение с запретами заказчика.
export function heldBack(f, forbidden) {
  const t = `${low(f && f.label)} ${low(f && f.value)} ${low(f && f.artifact)}`;
  if (heldMarked(f)) return HELD_REASON;
  for (const w of arr(forbidden)) {
    const q = low(w);
    if (q.length >= 3 && t.includes(q)) return `совпадение с запретом «${str(w)}»`;
  }
  return "";
}

// ---------------------------------------------------------------- вид факта
// Тот же словарь, что у фактов текстов (schemas/facts: kind). Ставит site-intake; забыл -
// сборщик выводит его мостом q -> kind, тем же, что держит импорт текстов, и печатает строку.
export const FACT_KINDS = ["number", "claim", "process", "contact", "legal", "product", "geo"];
const Q_KIND = {
  price: "number", price_factors: "number", compare: "number", numbers: "number", cat_intro: "number",
  docs: "legal", steps: "process", cta_form: "process", cta_mid: "process", geo: "geo", delivery: "geo",
  specs: "product", gallery: "product", product_desc: "product", listing: "product", subcats: "product"
};
const CONTACT_RE = /телефон|e-?mail|почт[аыу]|(^|[^а-я])адрес|whatsapp|telegram|телеграм|вотсап|youtube|ютуб|(^|[^a-z])vk([^a-z]|$)|вконтакте|instagram|инстаграм|мессенджер|часы работы|график работы/i;
const LEGAL_RE_F = /лиценз|(^|[^а-я])сро([^а-я]|$)|допуск|сертификат|свидетельств|аккредитац|(^|[^а-я])инн([^а-я]|$)|огрн/i;
export function kindOf(f) {
  const label = str(f && f.label), value = str(f && f.value);
  const ks = new Set(arr(f && f.q).map((x) => Q_KIND[x]).filter(Boolean));
  const t = `${label} ${value}`;
  const digit = /\d/.test(value);
  if (CONTACT_RE.test(t)) return "contact";
  if (ks.has("legal") || LEGAL_RE_F.test(t)) return "legal";
  if (digit && (ks.has("number") || NUM_UNIT.test(value))) return "number";
  if (ks.has("geo")) return "geo";
  if (ks.has("process")) return "process";
  if (ks.has("product")) return "product";
  return "claim";
}

// ---------------------------------------------------------------- домен в строке лидера
// Импорт текстов берет лидера в разбор по домену из строки competitors.list («домен - имя
// (пометки)»). Доменом считается латинская запись с зоной от двух букв или punycode, а
// кириллическая - только в известной зоне и с метками от двух знаков: «г.Тула» и
// «ул.Ленина» доменами не являются.
const CYR_ZONES = "рф|рус|москва|онлайн|сайт|орг|ком|дети";
export const DOMAIN_TOKEN = new RegExp(
  "(^|[^a-zа-я0-9@._-])(" +
  "(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+(?:[a-z]{2,24}|xn--[a-z0-9-]{2,59})" +
  "|(?:[a-zа-я0-9][a-zа-я0-9-]{0,61}[a-zа-я0-9]\\.)+(?:" + CYR_ZONES + ")" +
  ")(?![a-zа-я0-9-])", "i");
// Зона-расширение файла («прайс.pdf», «index.html») доменом не считается - как в import-project.mjs kit.
const FILE_EXT = /^(html?|php|aspx?|jsp|pdf|jpe?g|png|gif|svg|webp|js|css|xml|txt|docx?|xlsx?|zip|rar)$/i;
export const hasDomain = (s) => {
  for (const m of str(s).matchAll(new RegExp(DOMAIN_TOKEN.source, "gi"))) if (!FILE_EXT.test(m[2].split(".").pop())) return true;
  return false;
};

// Служебная пометка вместо факта: «не разворачиваем в этой версии», «уточним позже».
// Реальный случай IBG: ответ оператора ушел в value и чуть не доехал до страницы.
export const SERVICE_NOTE = /в этой версии|не разворачива|уточн[а-я]* (у заказчика|у клиента|позже|потом)|запрос[а-я]* (ответ|позже)|ответ позже|нет данных|данных нет|(^|[^a-z])(todo|tbd|tba)([^a-z]|$)|\?\?|\[(заполнить|уточнить|нужно)|см\. выше/i;

// ---------------------------------------------------------------- рекомендация по факту
// Одна функция на документ 1 (колонка «Публиковать») и на лист ответов: молчание заказчика
// по факту в первом круге значит ровно то, что напечатано (решение Р1). Поэтому печать и
// прием молчания не могут разойтись. Факт без значения и подтверждения документ не печатает
// вовсе - молчанием он не публикуется.
export const REC_YES = "да, публикуем";
export function factRec(f, forbidden) {
  if (!str(f && f.value) && !str(f && f.artifact)) return { publish: false, why: "нет значения", text: "" };
  if (SERVICE_NOTE.test(str(f.value))) return { publish: false, why: "служебная пометка вместо значения", text: "нет, это служебная пометка" };
  const h = heldBack(f, forbidden);
  if (h === HELD_REASON) return { publish: false, why: "помечено как закрытое", text: "нет, помечено как закрытое" };
  if (h) return { publish: false, why: `в запретах (${h})`, text: "нет, у вас это в запретах" };
  return { publish: true, why: "", text: REC_YES };
}

// ---------------------------------------------------------------- цитаты фактов
// parts/facts-src.json живет весь срок задачи: из него импорт текстов берет source_quote.
// Цитата сверяется дословно с входом (input/** и лист ответов) после нормализации букв е,
// тире, кавычек и пробелов; регистр не различается, как и в импорте текстов.
export const normQuote = (s) => String(s == null ? "" : s)
  .replace(/\r/g, "")
  .replace(/^[ \t]*>[ \t]?/gm, "")
  .replace(/ё/g, "е").replace(/Ё/g, "Е")
  .replace(/[‐-―−]/g, "-")
  .replace(/[«»“”„‟"″‘’‚‛`']/g, "\"")
  .replace(/…/g, "...")
  .replace(/[  -​  　]/g, " ")
  .replace(/\s+/g, " ")
  .trim()
  .toLowerCase();
const BINARY_EXT = /\.(pdf|docx?|xlsx?|pptx?|odt|ods|png|jpe?g|gif|webp|bmp|tiff?|heic|zip|rar|7z|gz|mp3|wav|ogg|m4a|mp4|mov|avi|webm)$/i;

// Листы ответов задачи: круг - отдельный файл рядом с контрактом. answers.txt - первый круг,
// answers-2.txt, answers-3.txt - следующие (так совмещаются «лист накопительный» и «новый
// круг - новым файлом»). Порядок - по номеру круга, .txt раньше .md.
export const ANSWER_SHEET = /^answers(?:-(\d+))?\.(txt|md)$/i;
export function answerSheets(taskDir) {
  let names = [];
  try { names = readdirSync(taskDir); } catch { return []; }
  return names.map((n) => {
    const m = n.match(ANSWER_SHEET);
    if (!m) return null;
    const p = join(taskDir, n);
    try { if (!statSync(p).isFile()) return null; } catch { return null; }
    return { file: n, path: p, round: m[1] ? Number(m[1]) : 1, ext: m[2].toLowerCase() };
  }).filter(Boolean).sort((a, b) => a.round - b.round || (a.ext === b.ext ? a.file.localeCompare(b.file) : a.ext === "txt" ? -1 : 1));
}
// Контрольная сумма листа: отметка «лист применен» в queue.json и в gate.checks. Дата журнала
// для этого не годится - она без времени.
export const sheetSha = (p) => createHash("sha1").update(readFileSync(p)).digest("hex").slice(0, 16);

// Текстовые файлы входа input/** : {path, rel, raw} либо в binary, если сверить нельзя.
function walkInput(taskDir, onText, onBinary) {
  const add = (p, rel) => {
    try {
      if (statSync(p).size > 5 * 1024 * 1024) { onBinary(rel); return; }
      const raw = readFileSync(p);
      if (BINARY_EXT.test(p) || raw.subarray(0, 8192).includes(0)) { onBinary(rel); return; }
      onText(p, rel, raw.toString("utf8").replace(/^﻿/, ""));
    } catch { /* нечитаемый файл - не источник */ }
  };
  const walk = (dir, rel) => {
    let names = [];
    try { names = readdirSync(dir); } catch { return; }
    for (const n of names) {
      const p = join(dir, n), r = `${rel}/${n}`;
      let st;
      try { st = statSync(p); } catch { continue; }
      if (st.isDirectory()) walk(p, r); else add(p, r);
    }
  };
  walk(join(taskDir, "input"), "input");
  return add;
}
// Весь текстовый вход задачи одной строкой плюс список нетекстовых файлов (скан, pdf):
// цитату из них скрипт сверить не может и честно говорит об этом. Листы ответов - все круги:
// второй круг не роняет цитаты первого.
export function inputCorpus(taskDir) {
  const out = { text: "", files: [], binary: [] };
  const onText = (p, rel, raw) => { out.text += "\n" + normQuote(raw); out.files.push(rel); };
  const add = walkInput(taskDir, onText, (rel) => out.binary.push(rel));
  for (const s of answerSheets(taskDir)) add(s.path, s.file);
  return out;
}
// Фраза заказчика после << ищется ТОЛЬКО во входе input/ (решение Р2): в листе ответов она
// нашлась бы в самой строке листа и проверяла бы сама себя. Находка -> {quote, where} с
// номером строки начала фразы; нет - null.
export function findInInput(taskDir, phrase) {
  const want = normQuote(phrase);
  if (Array.from(want).length < 4) return null;
  let hit = null;
  walkInput(taskDir, (p, rel, raw) => {
    if (hit) return;
    let joined = "";
    const starts = [];
    raw.split(/\r?\n/).forEach((line, i) => {
      const n = normQuote(line);
      if (!n) return;
      if (joined) joined += " ";
      starts.push([joined.length, i + 1]);
      joined += n;
    });
    const at = joined.indexOf(want);
    if (at === -1) return;
    let line = 1;
    for (const [off, ln] of starts) { if (off <= at) line = ln; else break; }
    hit = { quote: String(phrase).replace(/\s+/g, " ").trim(), where: `${rel}:${line}` };
  }, () => {});
  return hit;
}
// Файл из поля where: первый токен до двоеточия или пробела («input/call.txt:214»).
export const whereFile = (w) => str(w).split(/[:\s]/)[0].replace(/\\/g, "/");

// ---------------------------------------------------------------- источники факта
// Пятое значение «ответ» появилось вместе с гейтом: фразу, сказанную заказчиком в листе
// ответов, нельзя подписывать брифом, которого могло не быть вовсе.
export const FACT_SRC = ["бриф", "созвон", "документ", "сайт", "ответ"];
export const SOURCE_KINDS = ["бриф", "созвон", "документ", "сайт", "operator_guess"];
export const SRC_HUMAN = {
  "бриф": "бриф", "созвон": "созвон", "документ": "ваш документ",
  "сайт": "ваш сайт", "ответ": "ваш ответ на наши вопросы"
};

// ---------------------------------------------------------------- поля-обоснования
export const BANNED_FIELDS = ["rationale", "why", "note", "confidence", "evidence", "status", "function_why", "client_why"];
export const isBannedKey = (k) => {
  const kl = String(k).toLowerCase();
  return BANNED_FIELDS.includes(kl) || BANNED_FIELDS.includes(kl.replace(/s$/, "")) || /_why$/.test(kl) || /^why_/.test(kl);
};
export function walkBanned(node, hit, path = "") {
  if (Array.isArray(node)) { node.forEach((v, i) => walkBanned(v, hit, `${path}[${i}]`)); return; }
  if (!node || typeof node !== "object") return;
  for (const [k, v] of Object.entries(node)) {
    const p = path ? `${path}.${k}` : k;
    if (isBannedKey(k)) hit(p, k);
    walkBanned(v, hit, p);
  }
}

// ---------------------------------------------------------------- типографика
export const BAD_TYPO = /[‒–—―−ёЁ]/g;
export const TYPO_NAME = { "‒": "цифровое тире", "–": "среднее тире", "—": "длинное тире", "―": "горизонтальная черта", "−": "минус", "ё": "е с точками", "Ё": "Е с точками" };
// Технические поля: в них латиница, id и ссылки, клиент их не читает.
const TECH_KEYS = new Set(["v", "slug", "updated", "source", "tier", "id", "parent", "url", "artifact", "proof_id", "src", "kind", "publish", "type", "site_kind", "sig", "dirs", "q", "hits", "serves", "inn", "ogrn", "email", "phone", "must_have", "list"]);
export function walkTypo(node, hit, path = "", tech = false) {
  if (typeof node === "string") {
    if (tech) return;
    const found = node.match(BAD_TYPO);
    if (found) hit(path, [...new Set(found)].map((c) => TYPO_NAME[c]).join(", "));
    return;
  }
  if (Array.isArray(node)) { node.forEach((v, i) => walkTypo(v, hit, `${path}[${i}]`, tech)); return; }
  if (!node || typeof node !== "object") return;
  for (const [k, v] of Object.entries(node)) walkTypo(v, hit, path ? `${path}.${k}` : k, tech || TECH_KEYS.has(k));
}

// ---------------------------------------------------------------- бюджет знаков
// Пороги подняты осознанно. IBG (15 направлений, 4 сегмента, 23 факта) весил 23900 знаков
// еще без business.site, client_pages и assortment, которые сборка раньше молча выбрасывала.
// Вернув их и добавив kind фактов, профиль ниши, pages_hint, page_types и ссылки ответов на
// факты, тот же проект встает около 25500. Старый потолок 26000 отказывал бы первому же
// каталожному клиенту. 32000 знаков - около 11 тысяч токенов: файл целиком читают
// планировщик страниц и импорт текстов, это все еще один дешевый вход вместо брифа, ЦА
// и разведки v7 (150 тысяч токенов). Предупреждение 22000 - середина между средним
// услуговым проектом (12-16 тысяч) и каталожным IBG.
export const BUDGET_WARN = 22000;
export const BUDGET_MAX = 32000;
// Потолки фактов (решение Р3). Засев site-intake и build-project - до 40; ответам заказчика
// из листа (любой круг, включая первый) - резерв до 50 и около 1500 знаков бюджета: ответ
// сначала занимает место снятого факта засева, и только потом растет число фактов.
export const FACTS_SEED_MAX = 40;
export const FACTS_MAX = 50;
export const ANSWER_RESERVE = 1500;
// Метка из текста вопроса обрезается по границе слова, а не посреди него («палладий, се»).
export function cutLabel(s, max = 80) {
  const t = str(s).replace(/\s+/g, " ");
  if (Array.from(t).length <= max) return t;
  const head = Array.from(t).slice(0, max + 1).join("");
  const sp = head.lastIndexOf(" ");
  return (sp > 10 ? head.slice(0, sp) : Array.from(t).slice(0, max).join("")).replace(/[\s,.;:(-]+$/, "");
}
export function budget(data) {
  const size = Array.from(JSON.stringify(data)).length;
  let fat = { path: "-", size: 0, n: 0 };
  const walk = (node, path) => {
    if (Array.isArray(node)) {
      const s = Array.from(JSON.stringify(node)).length;
      if (s > fat.size) fat = { path: path || "(корень)", size: s, n: node.length };
      node.forEach((v, i) => walk(v, `${path}[${i}]`));
      return;
    }
    if (!node || typeof node !== "object") return;
    for (const [k, v] of Object.entries(node)) walk(v, path ? `${path}.${k}` : k);
  };
  walk(data, "");
  return { size, fat };
}

// ---------------------------------------------------------------- pages.yml
// Плоский разбор без внешних зависимостей: нужны имена признаков ниши, id блоков,
// семь колонок строки блока и стартовые составы по типам страниц.
export function readPages(p) {
  if (!existsSync(p)) return null;
  const raw = readFileSync(p, "utf8").replace(/^﻿/, "");
  const out = { chars: Array.from(raw).length, sig: [], sigBody: new Map(), blocks: new Map(), skel: new Map() };
  let section = null;
  for (const line of raw.split(/\r?\n/)) {
    if (/^\s*#/.test(line) || !line.trim()) continue;
    const head = line.match(/^([a-z_]+):\s*$/);
    if (head) { section = head[1]; continue; }
    const row = line.match(/^ {2}([a-z][a-z0-9_]*):\s*"(.*)"\s*$/);
    if (!row || !section) continue;
    const [, id, body] = row;
    if (section === "sig") { out.sig.push(id); out.sigBody.set(id, body); }
    else if (section === "blocks") out.blocks.set(id, body.split("|").map((s) => s.trim()));
    else if (section === "skel") out.skel.set(id, body);
  }
  return out;
}
export const PAGES_CHARS_MAX = 7600;
export const PAGE_TYPES = ["home", "landing", "service", "category", "facet", "product", "info"];
export const NEEDS_KINDS = ["число", "состав", "условие", "действие", "граница"];
export const BLOCK_FN = ["Р", "Д", "К", "В"];

// Имя страницы одним правилом на весь конвейер. У главной и у лендинга слаг пустой, а
// файл называется index: сводить страницу с планом по голому слагу значит не свести ее
// никогда. Правило жило копиями в пяти скриптах, теперь оно тут одно.
export const pageName = (page, taken) => {
  const p = page || {};
  let n = str(p.slug) || (str(p.url) === "/" ? "index" : str(p.url).split("/").filter(Boolean).pop()) || "index";
  if (taken) { let k = 2; while (taken.has(n)) n = `${n}-${k++}`; taken.add(n); }
  return n;
};

// Агенты анализа, объявленные списком. Считать их глобом по каталогу нельзя: в
// .claude/agents лежит site-scanner (/seo-metategi), он делит префикс и к анализу
// отношения не имеет. Слой письма и прототип ушли в /site-tekst, у анализа три агента:
// фактура, смыслы и состав страниц без SEO. Список закрыт: новый агент приходит только
// вместо старого.
export const AGENTS_V8 = ["site-intake", "site-market", "pages-planner"];
export const AGENTS_V8_CAP = 3;

// ---------------------------------------------------------------- обход схемы
// Тот же обход на два скрипта: собранный контракт обязан проходить ровно ту проверку,
// которой его встретит валидатор, иначе сборка пишет на диск заведомый брак.
function deref(s, root, seen = 0) {
  while (s && typeof s === "object" && s.$ref && seen < 10) {
    const parts = String(s.$ref).replace(/^#\//, "").split("/");
    let cur = root;
    for (const k of parts) cur = cur && cur[k];
    s = cur; seen++;
  }
  return s;
}
const jsType = (v) => (v === null ? "null" : Array.isArray(v) ? "array" : Number.isInteger(v) ? "integer" : typeof v);
function typeOk(v, t) {
  if (t === "integer") return Number.isInteger(v);
  if (t === "number") return typeof v === "number";
  if (t === "array") return Array.isArray(v);
  if (t === "object") return v !== null && typeof v === "object" && !Array.isArray(v);
  if (t === "null") return v === null;
  return typeof v === t;
}
export function validate(value, sch, path, root, V) {
  sch = deref(sch, root);
  if (!sch || typeof sch !== "object") return;
  if (Object.prototype.hasOwnProperty.call(sch, "const") && value !== sch.const) {
    V(path, `ожидалось ${JSON.stringify(sch.const)}, пришло ${JSON.stringify(value)}`); return;
  }
  if (sch.enum && !sch.enum.includes(value)) {
    V(path, `значение ${JSON.stringify(value)} вне закрытого списка: ${sch.enum.join(" | ")}`); return;
  }
  if (sch.type) {
    const types = Array.isArray(sch.type) ? sch.type : [sch.type];
    if (!types.some((t) => typeOk(value, t))) { V(path, `тип ${jsType(value)}, ожидался ${types.join(" либо ")}`); return; }
  }
  if (typeof value === "string") {
    const len = Array.from(value).length;
    if (sch.minLength != null && len < sch.minLength) V(path, `длина ${len}, минимум ${sch.minLength}`);
    if (sch.maxLength != null && len > sch.maxLength) V(path, `длина ${len}, потолок ${sch.maxLength}`);
    if (sch.pattern && !new RegExp(sch.pattern).test(value)) V(path, `не проходит формат ${sch.pattern} (значение ${JSON.stringify(value.slice(0, 60))})`);
  }
  if (typeof value === "number") {
    if (sch.minimum != null && value < sch.minimum) V(path, `${value} меньше минимума ${sch.minimum}`);
    if (sch.maximum != null && value > sch.maximum) V(path, `${value} больше максимума ${sch.maximum}`);
  }
  if (Array.isArray(value)) {
    if (sch.minItems != null && value.length < sch.minItems) V(path, `элементов ${value.length}, минимум ${sch.minItems}`);
    if (sch.maxItems != null && value.length > sch.maxItems) V(path, `элементов ${value.length}, потолок ${sch.maxItems}`);
    if (sch.uniqueItems) {
      const seen = new Set(), dup = new Set();
      for (const it of value) { const k = JSON.stringify(it); if (seen.has(k)) dup.add(k); seen.add(k); }
      if (dup.size) V(path, `повторы: ${[...dup].join(", ")}`);
    }
    if (sch.items) value.forEach((it, i) => validate(it, sch.items, `${path}[${i}]`, root, V));
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    for (const r of sch.required || []) {
      if (!Object.prototype.hasOwnProperty.call(value, r)) V(path ? `${path}.${r}` : r, "обязательное поле отсутствует");
    }
    const props = sch.properties || {};
    for (const [k, v] of Object.entries(value)) {
      const sub = props[k];
      if (sub) validate(v, sub, path ? `${path}.${k}` : k, root, V);
      else if (sch.additionalProperties === false) V(path ? `${path}.${k}` : k, "поле не описано контрактом (additionalProperties false)");
    }
  }
}

// ---------------------------------------------------------------- пороги-предупреждения
// Не минимумы схемы, а пороги отчета. Минимум в схеме означал бы «допиши до числа», то есть
// выдумай: тонкая честная фактура законна, она просто дает более короткий сайт.
export const THIN = { facts: 15, directions: 3 };

// ---------------------------------------------------------------- смысловые решения гейта
// Один список на печать в документе 1 и на прием ответа. Раньше их было два: в документе
// стояли строки, принять ответ по которым было нечем.
const getPath = (o, p) => p.split(".").reduce((a, k) => (a == null ? undefined : a[k]), o);
export function setPath(o, p, v) {
  const ks = p.split(".");
  let n = o;
  for (const k of ks.slice(0, -1)) { if (!n[k] || typeof n[k] !== "object") n[k] = {}; n = n[k]; }
  n[ks[ks.length - 1]] = v;
}

export const DECISIONS = [
  { key: "d1", name: "позиционирование", title: "Как вы себя называете", path: "offer.positioning", max: 300 },
  { key: "d2", name: "обещание: что получит клиент", title: "Главное обещание", path: "offer.promise.result", max: 200 },
  { key: "d3", name: "текст главной кнопки: что получит клиент", title: "Текст главной кнопки: что получит клиент", path: "offer.promise.cta", max: 60 },
  { key: "d4", name: "границы работы, чего не обещаем", title: "Чего не обещаем", path: "offer.limits", max: 200, list: true },
  { key: "d5", name: "тон", title: "Тон текстов", path: "offer.tone", max: 160 },
  { key: "d6", name: "цены на сайте открыты", title: "Цены на сайте", path: "business.sig", flag: "price_open",
    onText: "печатаем цены прямо на страницах", offText: "цены на сайте не печатаем" },
  { key: "d7", name: "тип сайта", title: "Тип сайта", path: "business.site_kind",
    choice: { landing: "делаем одну страницу, весь смысл на ней", multipage: "делаем многостраничный сайт под поиск" },
    words: { landing: /ленд|одн(а|у|ой|ою)\s+страниц|однострани/i, multipage: /многостран|под поиск|поисков|(^|[^а-я])сео|seo/i } },
  { key: "d8", name: "что продаем", title: "Что продаем", path: "business.type",
    choice: { services: "продаете услуги", shop: "продаете товары из каталога", both: "продаете и товары, и услуги" },
    words: { both: /и то и другое|(^|[^а-я])(оба|обе|обоих)(?![а-я])|both|товары и услуги|услуги и товары/i, shop: /магаз|товар|каталог|номенклат|shop/i, services: /услуг|сервис|services|(^|[^а-я])работы(?![а-я])/i } }
];

// Что стоит в контракте сейчас, словами листа ответов.
export function readDecision(data, d) {
  if (d.flag) return arr(getPath(data, d.path)).includes(d.flag) ? "да" : "нет";
  const v = getPath(data, d.path);
  return d.list ? arr(v).join("; ") : str(v);
}

// Как это же решение читается в клиентском документе: {title, value, alt} либо null,
// если решения в контракте пока нет вовсе.
export function decisionRow(data, d) {
  if (d.flag) {
    const on = arr(getPath(data, d.path)).includes(d.flag);
    return { key: d.key, title: d.title, value: on ? d.onText : d.offText, alt: on ? d.offText : d.onText };
  }
  if (d.choice) {
    const cur = str(getPath(data, d.path));
    if (!d.choice[cur]) return null;
    const alt = Object.entries(d.choice).filter(([k]) => k !== cur).map(([, t]) => t).join("; либо ");
    return { key: d.key, title: d.title, value: d.choice[cur], alt };
  }
  const v = d.list ? arr(getPath(data, d.path)).join("; ") : str(getPath(data, d.path));
  return v ? { key: d.key, title: d.title, value: v, alt: "" } : null;
}

// ---------------------------------------------------------------- разбор ответа на решение
// Одно правило подтверждения на весь лист - то же, что у d9 и d10: «верно», «да, все верно»,
// «согласны» поле не меняют. Голое «да» или «нет» у d1-d5 - не разобрано: это не формулировка
// позиционирования, обещания или тона. Выбор d7-d8 разбирается по частям фразы (между знаками
// препинания): вариант в части с отрицанием («лендинг нам точно не нужен», «мы против
// лендинга») отвергнут, отрицание без варианта («лендинг? нет», «не согласен») и «не только»
// делают ответ не разобранным. Сомнение уходит в «не разобрано», а не в выбор.
// Отрицание - и «никаких», «ничего», и оценка «мало», «недостаточно», «лишний», и отрицание,
// слитое со словом: «неактуален», «нецелесообразен», «устарел», «ненужен», «неуместен». «Одной
// страницы мало» и «лендинг устарел, делаем каталог» - не выбор лендинга.
const LETTER = "[а-я\u0451a-z0-9]";
const flat = (s) => low(s).replace(/\u0451/g, "е").replace(/[«»"'`]/g, "").replace(/[\s,.;:!?()-]+/g, " ").trim();
const BARE_YN = /^(да|нет|ок|ok|ага|угу|yes|no)[.!]*$/i;
const NEG_WORD = /^(не|ни|без|нет|никак[а-я]*|ничего|ничем)$/;
const NEG_TOKEN = /^(не|ни|без|нет|против|нельзя|незачем|отказ[а-я]*|никак[а-я]*|ничего|ничем|мало|маловато|недостаточно|лишн[а-я]*|излишн[а-я]*|неактуал[а-я]*|нецелесообраз[а-я]*|устарел[а-я]*|устарев[а-я]*|ненуж[а-я]*|неумест[а-я]*|неинтерес[а-я]*|неподход[а-я]*|необязател[а-я]*|отпада[а-я]*|отпал[а-я]*)$/;
// Вариант, который продает не заказчик: в части «а товары продают партнеры», «товары у партнеров»,
// «товары через партнеров», «услуги, товары партнеров» вариант отвергнут, как с «не». «Услуги, а
// товары продают партнеры» - услуги; «товары продаем через партнеров» без другого варианта - вариант
// только отвергнут, ответ уходит в «не разобрано». Продает сам заказчик, если в части его глагол
// продажи, а партнер не подлежащее и не «через (у) партнеров»: «продаем товары партнеров» - товары.
const THIRD_PARTY = /^(партнеры|посредники|сторонние)$/;
const THIRD_PARTY_ANY = /^(партнер[а-я]*|посредник[а-я]*|сторонн[а-я]*)$/;
const OUR_SELL = /^(продаем|продаю|реализуем|торгуем|поставляем|предлагаем|возим|привозим)$/;
const thirdParty = (w) => w.some((x, i) => THIRD_PARTY.test(x)
  || (THIRD_PARTY_ANY.test(x) && (/^(через|у)$/.test(w[i - 1] || "") || !w.some((y) => OUR_SELL.test(y)))));
// «Лишний» - отрицание только сказуемым («многостраничный - лишнее», «товары лишние»), а «без
// лишних страниц», «лишних страниц не надо» - уточнение к своему слову, не отказ от варианта.
const NEG_PRED = /^(лишн[а-я]*|излишн[а-я]*)$/;
// Слова, из которых состоит голое отрицание-оценка («уже неактуально», «это не наш вариант», «нам не
// нужен», «пока не решили», «устаревшее название»). Часть с отрицанием и своим словом сверх этих
// («без лишних страниц», «не дороже 50 тысяч») относится к своему слову, а не к варианту рядом.
const BARE = /^(название|слово|термин|формат|история|тема|уже|совсем|вообще|точно|нам|нас|мне|меня|мы|я|это|этот|эта|он|она|оно|они|его|ее|их|пока|сейчас|давно|тоже|так|такой|такое|такая|вариант|вариантом|наш|наша|наше|нужен|нужна|нужно|нужны|надо|рассматриваем|рассматривается|интересно|интересует|интересен|подходит|подходят|актуально|актуален|актуальна|катит|годится|хотим|хочу|будем|будет|было|был|была|делаем|делать|планируем|конечно|идея|идеи|по|карману|к|чему|и|а|но|как|для|увы|еще|уверен[а-я]*|знаем|знаю|решили|решено|определились|согласен|согласны|согласна|потянем|осилим|вам|вас|сразу|правда|вот|уж|же|ли|бы|то|да)$/;
const isBare = (x) => NEG_TOKEN.test(x) || BARE.test(x);
// Ответ d1-d5 только из слов согласия, вежливости и «правок нет» («хорошо», «спасибо», «не надо
// менять»): формулировки в нем нет, новым значением он не становится.
const FILLER = /^(да|нет|не|ни|ок|ok|окей|ага|угу|все|верно|так|и|как|есть|остав[а-я]*|хорошо|отлично|спасибо|благодар[а-я]*|согла[сш][а-я]*|со|всем|во|полностью|правок|правки|замечаний|возражений|изменений|вопросов|без|устраивает|нравится|подходит|пойдет|годится|ладно|норм|нормально|супер|класс|согласовано|одобр[а-я]*|принято|принимаем|подтвержда[а-я]*|актуально|правильно|остальное|пока|нам|мне|нас|меня|это|надо|нужно|менять|меняем|трогать|трогаем)$/;
const fillerOnly = (s) => { const w = flat(s).split(" ").filter(Boolean); return w.length > 0 && w.every((x) => FILLER.test(x)); };
const CLAUSE = /[,.;:!?()]+|\s[-\u2012-\u2015\u2212]+\s/;
// Варианты выбора по частям ответа: pos - вариант назван без отрицания, neg - в части с
// отрицанием, loose - отрицание, к которому варианта нет, или «не только». «Без» отвергает только
// вариант, названный сразу за ним («многостраничный, без лендинга», «каталог товаров без услуг»).
function choiceHits(d, text) {
  const pos = new Set(), neg = new Set();
  const t = low(text).replace(/\u0451/g, "е");
  let loose = /(^|[^а-яa-z0-9])не\s+только(?![а-яa-z0-9])/.test(t);
  const keys = Object.keys(d.words || {});
  const hitIn = (s) => keys.filter((k) => d.words[k].test(s));
  const parts = [];
  for (const part of t.split(CLAUSE)) {
    const words = part.split(/\s+/).map((w) => w.replace(/[^а-яa-z0-9]/g, "")).filter(Boolean);
    if (!words.length) continue;
    const hits = hitIn(part);
    const bez = new Set();
    words.forEach((w, i) => { if (w === "без") for (const k of hitIn(words.slice(i + 1, i + 3).join(" "))) bez.add(k); });
    const isNeg = (hits.length > 0 && thirdParty(words))
      || words.some((w, i) => w !== "без" && NEG_TOKEN.test(w) && !(NEG_PRED.test(w) && !words.slice(i + 1).every(isBare)));
    parts.push({ words, hits, bez, isNeg, bare: words.every(isBare), negated: false });
  }
  parts.forEach((p, i) => {
    if (!p.isNeg || p.hits.length || !p.bare) return;
    // «Лендинг - уже неактуально», «лендинг? нет»: голое отрицание без варианта относится к короткой
    // части прямо перед ним, если это одно название варианта. Иначе - сомнение.
    const prev = parts[i - 1];
    if (prev && prev.hits.length && !prev.isNeg && prev.words.length <= 2) prev.negated = true;
    else loose = true;
  });
  for (const p of parts) for (const k of p.hits) (p.isNeg || p.negated || p.bez.has(k) ? neg : pos).add(k);
  return { pos: [...pos], neg: [...neg], loose };
}
// Слово по регулярке найдено в ответе и не отрицается: в пределах своей части фразы (до знака
// препинания) два слова перед ним и два после не содержат «не», «без», «нет».
function hitWord(text, re) {
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  for (const part of low(text).split(/[,.;:!?()]+/)) {
    for (const m of part.matchAll(g)) {
      const at = m.index + (m[1] && /^[^а-яa-z0-9]$/.test(m[1]) ? 1 : 0);
      const before = part.slice(0, at).trim().split(/\s+/).filter(Boolean).slice(-2);
      const tail = part.slice(m.index + m[0].length).replace(new RegExp(`^${LETTER}*`), "");
      const after = tail.trim().split(/\s+/).filter(Boolean).slice(0, 2);
      if (![...before, ...after].some((w) => NEG_WORD.test(w))) return true;
    }
  }
  return false;
}
// Цены (d6): глаголы публикации и сокрытия разбираются по частям фразы, каждый со своим
// отрицанием рядом (три слова до и два после): «цены не публикуем», «не надо их печатать»,
// «показывать цены не будем», «нет смысла публиковать цены» - отказ; «не скрываем цены», «цены
// открыты», «прайс публикуем» - да. «Без цен» и «по запросу» - отказ. Двойное отрицание - цены нужны:
// «без цен никак», «нельзя без цен», «не можем без цен», «сайт без цен нам не нужен», «без цен
// клиенты не звонят», «без цен - не наш вариант». Второе отрицание считается, только если стоит в
// том же куске, что «без цен»: кусок кончается на знаке, «потому что», «так как», «пока не», «и», «а»,
// «но». «Без цен, потому что не можем гарантировать стоимость», «без цен и не указываем стоимость»,
// «без цен и никаких прайсов» - отказ, а не цены. «Не» при глаголе цен («без цен не показываем») - тот
// же отказ без запятой; перед «без цен» второе отрицание - только при слове возможности или нужды
// («не можем без цен», но «пока не определимся без цен» - отказ). Сомнение («печатать ли», «пока не решили», «не знаем») - не разобрано; часть про
// потом («потом откроем») не голосует. «Цены да» и «цены нет» - голос своей части: «цены да, но без
// прайса» - и «да», и отказ. И «да», и отказ в одном ответе - не разобрано. d6 в листе - вопрос
// «цены на сайте открыты»: «да» - открыты, «нет» - закрыты. «Ок», «ага», «верно» - то же правило
// подтверждения, что у всего листа: как напечатано сейчас.
const PRICE_VERB = /^(печата|напечата|публику|публико|опублику|показыва|показать|покажем|пиш|напиш|выкладыва|выложи|указыва|указать|укажем|размеща|разместить|разместим|открыва|открыт|откроем)/;
const PRICE_HIDE = /^(скрыва|скрыт|скроем|закрыва|закрыт|закроем)/;
const PRICE_NEG = /^(не|ни|нет|никак[а-я]*|нельзя|незачем)$/;
const PRICE_NOUN = /(^|[^а-я])(цен|прайс|стоимост)/;
const PRICE_DOUBT = /(^|[^а-я])(ли|не\s+(решили|решено|знаем|знаю|уверен[а-я]*)|подумаем|думаем|посмотрим|возможно|может\s+быть|наверное)(?![а-я])/;
const PRICE_LATER = /(^|[^а-я])(потом|позже|позднее|в\s+будущем|со\s+временем)(?![а-я])/;
// Второе отрицание перед «без цен»: «не» или «ни» и через одно-два слова - слово возможности или нужды.
// «Не надо (нужно)» перед «без цен» - цены нужны («не надо без цен»), а после - читается двояко: «без
// цен не надо» без запятой - и «без цен нельзя», и «без цен, (печатать) не надо». Это не разобрано.
const PRICE_MODAL = /^(обой[а-я]*|обходимся|можем|могу|может|можно|сможем|получится|выйдет|нужен|нужна|нужны|хотим|хочу|будем|годится|подходит|пойдет|катит|устраивает|вариант|работаем|работать|продадим|продать|продаем|продавать|справимся)$/;
const PRICE_NEED = /^(надо|нужно)$/;
// Отдельная часть-оценка после «без цен» («без цен - не наш вариант», «без цен? так не пойдет»):
// без «надо» и «нужно» - «без цен, не надо» - согласие с отказом.
const PRICE_EVAL = /^(обой[а-я]*|обходимся|можем|могу|сможем|получится|выйдет|годится|подходит|пойдет|катит|устраивает|вариант)$/;
const negModal = (w, from, to, modal) => w.some((x, i) => i >= from && i < to && /^(не|ни)$/.test(x) && w.slice(i + 1, Math.min(i + 3, to)).some((y) => modal.test(y)));
// Конец куска «без цен»: «потому что», «так как», «т к», «пока не», «и», «а», «но», «чтобы» и т.п.
const priceCut = (w, i) => /^(потому|поскольку|ибо|и|а|но|чтобы|если|когда|ведь|хотя)$/.test(w[i])
  || (w[i] === "так" && w[i + 1] === "как") || (w[i] === "т" && w[i + 1] === "к") || (w[i] === "пока" && w[i + 1] === "не");
function priceVotes(text) {
  let yes = false, no = false;
  const t = low(text).replace(/\u0451/g, "е").replace(/(^|[^а-я])(цены|цена|прайс)(\s+на\s+сайте)?\s*[-:\u2012-\u2015\u2212]+\s*(да|нет)(?![а-яa-z0-9])/g, "$1$2$3 $4");
  if (PRICE_DOUBT.test(t)) return { yes, no, doubt: true };
  const parts = t.split(CLAUSE).map((part) => ({ part, w: part.split(/\s+/).map((x) => x.replace(/[^а-яa-z0-9]/g, "")).filter(Boolean) }));
  for (let k = 0; k < parts.length; k++) {
    const { part, w } = parts[k];
    if (!w.length || PRICE_LATER.test(part)) continue;
    if (/^(цены|цена|прайс)( на сайте)? (да|нет)$/.test(w.join(" "))) { if (w[w.length - 1] === "да") yes = true; else no = true; continue; }
    const b = w.findIndex((x, i) => x === "без" && /^(цен|прайс)/.test(w[i + 1] || ""));
    if (b !== -1) {
      let end = b + 2;
      while (end < w.length && !priceCut(w, end)) end++;
      const before = w.slice(Math.max(0, b - 2), b).some((x) => /^(никак|нельзя)$/.test(x)) || negModal(w, Math.max(0, b - 3), b, PRICE_MODAL) || negModal(w, Math.max(0, b - 3), b, PRICE_NEED);
      let after = false, amb = false;
      for (let i = b + 2; i < end; i++) {
        const x = w[i], y = w[i + 1] || "";
        if (/^(никак|нельзя)$/.test(x) || (x === "нет" && /^смысл/.test(y))) after = true;
        else if (/^(не|ни)$/.test(x) && !PRICE_VERB.test(y) && !PRICE_HIDE.test(y)) { if (PRICE_NEED.test(y)) amb = true; else after = true; }
      }
      if (!before && !after && amb) return { yes: false, no: false, doubt: true, amb: true };
      // Кусок кончился на «без цен», следом - часть-оценка: «без цен - не наш вариант», «без цен? никак».
      const nx = end === w.length && parts[k + 1] ? parts[k + 1].w : [];
      const evalNext = nx.length > 0 && nx.length <= 5 && (/^(никак|нельзя)$/.test(nx[0])
        || (nx.slice(0, 2).some((x) => /^(не|ни)$/.test(x)) && negModal(nx, 0, Math.min(nx.length, 4), PRICE_EVAL)));
      if (before || after || evalNext) yes = true; else no = true;
      if (evalNext) k++;
      continue;
    }
    // «Показываем цены по запросу», «цены - только по запросу»: цены на сайте закрыты.
    if (/(^|[^а-я])по\s+запросу/.test(part)) { no = true; continue; }
    let verb = false;
    w.forEach((x, i) => {
      const show = PRICE_VERB.test(x), hide = !show && PRICE_HIDE.test(x);
      if (!show && !hide) return;
      verb = true;
      const neg = [...w.slice(Math.max(0, i - 3), i), ...w.slice(i + 1, i + 3)].some((y) => PRICE_NEG.test(y));
      if (show !== neg) yes = true; else no = true;
    });
    // «Цены на сайте не нужны», «цены ни к чему»: отказ без глагола.
    if (!verb && PRICE_NOUN.test(part) && /(^|[^а-я])(не\s+нуж(ен|н)|не\s+надо|не\s+стоит|не\s+будем|ни\s+к\s+чему|незачем)/.test(part)) no = true;
  }
  return { yes, no };
}
const PRICE_YES_HEAD = /^(да|yes)(?![а-я\u0451a-z0-9])/;
// «Цены - да», «цены нет», «прайс: да»: подлежащее вопроса и следом голое «да» или «нет».
const PRICE_SUBJ = /^(цены|цена|прайс)(\s+на\s+сайте)?[\s,.:;!-]*/;
// «Нет» - отказ только отдельным словом: «нет пафоса» или «нет предоплаты» - это значение.
const REFUSE_HEAD = /^(нет|no|не надо|не нужно)\s*([,.!:;-]|$)/;
// Несогласие с напечатанным без нового значения: что вместо - не сказано.
const DISAGREE = /^(не\s+так|не\s+то|неверно|не\s+верно|неправильно|не\s+правильно|не\s+совсем|не\s+согла[сш][а-я]*|не\s+подходит|не\s+устраивает|против)(?![а-я\u0451a-z0-9])/;
const NO_HEAD = { test: (l) => REFUSE_HEAD.test(l) || DISAGREE.test(l) };
// Согласие с оговоркой: слова согласия того же правила, что у isOk (D10_AGREE, вежливость рядом
// с ним), затем знак препинания или связка («но», «только», «кроме») - и еще текст: «все так,
// добавьте ...», «все так кроме пункта 3», «согласны, кроме ...». Одна вежливость со связкой -
// тоже оговорка: «хорошо, но уберите ...». Без знака и связки это само значение: «правильно
// подобранная бригада», «принимаем заказы от юрлиц», «да Винчи ремонта». Подтверждение своими
// словами с подлежащим впереди (confirmWords) до первого знака, « - » или связки - тоже согласие:
// «все пункты верны, кроме 8», «тон подходит, но чуть теплее», «нас все устраивает, но уберите ...»,
// «со всеми пунктами согласны, кроме последнего». Оценка «в целом верно, но ...» - так же. Одно наречие
// впереди («точно, по делу, без воды», «вполне, ...») - начало значения, а не согласие.
const HEAD_CUT = /^(.+?)(?:\s*[,.;:!?]+\s*|\s+[-\u2012-\u2015\u2212]+\s+|\s+(?=(?:но|только|кроме|однако)(?![а-яa-z0-9])))(\S[\s\S]*)$/;
function agreeBut(text) {
  const a = str(text), h = okHead(a);
  if (str(h.rest) && h.rest.length !== a.length) {
    if (D10_BUT.test(low(h.rest).replace(/\u0451/g, "е"))) return true;
    if (h.agree && /[,.:;!?-]/.test(a.slice(0, a.length - h.rest.length))) return true;
  }
  const m = low(a).replace(/\u0451/g, "е").match(HEAD_CUT);
  return !!m && !/^(точно|вполне|абсолютно|совершенно|именно)$/.test(flat(m[1])) && confirmWords(m[1]) !== "";
}
// Правка вместо формулировки: «добавьте год», «уберите слово бригада» - не позиционирование и не
// тон. Только повелительное наклонение: кнопка «Добавить в корзину» или «Заменить окна» - значение.
const EDIT_HEAD = /^(добавьте|уберите|удалите|замените|исправьте|поправьте|измените|поменяйте|перепишите|сократите|дополните|исключите|допишите|вычеркните)(?![а-яa-z0-9])/;
// Правка списка (d4) вместо нового списка: ответ заменяет все пункты, поэтому «пункт 8 убрать»,
// «добавить: не работаем за КАД», «плюс не работаем за КАД», «согласны с пунктом 3» не становятся
// списком из одной строки.
const LIST_EDIT = /^(добавить|добавим|добавляем|убрать|уберем|убираем|удалить|удалим|удаляем|исключить|исключаем|заменить|дополнить|плюс|минус|\+)(?![а-яa-z0-9])|(^|[^а-яa-z0-9])пункт[а-я]*\s*(№\s*)?\d|(^|[^а-яa-z0-9])\d+(\s*-\s*\d+)?\s*(-?й\s+)?(пункт|убрать|уберите|удалить|удалите|исключить|исключите|заменить|замените)(?![а-яa-z0-9])/;
// Подтверждение своими словами: «абсолютно верно», «именно так», «подтверждаю формулировку»,
// «тон подходит», «нас все устраивает», «согласны со всеми пунктами». Все слова ответа - основы
// подтверждения («верн», «подтвержд», «соглас», «устраива», «подходит», «именно», «конечно»),
// усилители, слова «правок нет» и названия самого решения, а основа подтверждения есть -> "ok".
// Оценка «в целом», «почти» -> "hedge" (согласие с оговоркой); отрицание («тон нас не
// устраивает», «верно не все»), кроме «менять не надо» и «правок нет», -> "neg". Ответ со своим
// словом («правильно подобранная бригада», «верный выбор для вторички», «точно в срок») - значение, "".
const CONFIRM_STEM = /^(верн[а-я]*|подтвержд[а-я]*|соглас[а-я]*|устраива[а-я]*|подход(ит|ят)|правильн[а-я]*|конечно|разумеется|безусловно|именно|абсолютно|совершенно|точно|вполне)$/;
const CONFIRM_EXTRA = /^(полностью|целиком|в|с|со|по|у|мы|вы|вас|ваш[а-я]*|наш[а-я]*|эт[а-я]*|данн[а-я]*|текущ[а-я]*|предложенн[а-я]*|предложени[а-я]*|указан[а-я]*|написан[а-я]*|сформулирован[а-я]*|изложен[а-я]*|описан[а-я]*|формулировк[а-я]*|текст[а-я]*|вариант[а-я]*|тон|тоном|позиционировани[а-я]*|обещани[а-я]*|кнопк[а-я]*|надпис[а-я]*|границ[а-я]*|пункт[а-я]*|всеми|всех|весь|вся|всю|целом|основном|почти|примерно|скорее|частично|приблизительно)$/;
const CONFIRM_HEDGE = /^(целом|основном|почти|примерно|скорее|частично|приблизительно)$/;
// После отрицания - слово про правки: «менять не надо», «нет правок» - не против напечатанного.
const CONFIRM_NO_CHANGE = /^(надо|нужно|менять|меняем|трогать|трогаем|правок|правки|замечаний|возражений|изменений|вопросов)$/;
function confirmWords(text) {
  const w = flat(text).split(" ").filter(Boolean);
  if (!w.length || !w.every((x) => FILLER.test(x) || CONFIRM_STEM.test(x) || CONFIRM_EXTRA.test(x))) return "";
  if (w.some((x) => CONFIRM_HEDGE.test(x))) return "hedge";
  if (!w.some((x) => CONFIRM_STEM.test(x))) return "";
  if (w.some((x, i) => /^(не|ни|нет)$/.test(x) && !CONFIRM_NO_CHANGE.test(w[i + 1] || ""))) return "neg";
  return "ok";
}

// Ответ -> {op: "accept"|"set"|"drop", value, as, ground}. accept - поле не меняется
// (подтверждение), set - новое значение, drop - ответ не разобран и идет в «не разобрано».
export function parseDecision(data, d, answer) {
  const a = str(answer), l = low(a);
  const drop = (ground) => ({ op: "drop", ground, as: `не разобрано: ${ground}` });
  const accept = () => ({ op: "accept", as: `подтверждение: остается «${readDecision(data, d) || "не задано"}»` });
  if (d.flag) {
    const fa = flat(a);
    const on = { op: "set", value: true, as: `да - ${d.onText}` }, off = { op: "set", value: false, as: `нет - ${d.offText}` };
    if (fa && fa === flat(d.onText)) return on;
    if (fa && fa === flat(d.offText)) return off;
    // Глаголы публикации и сокрытия со своими отрицаниями - раньше согласия: «давайте без цен»
    // не «да», «ок, печатаем» и «нет, публикуем» - выбор.
    const v = priceVotes(l);
    if (v.amb) return drop("«без цен не надо» читается двояко - ответь «да» (цены печатаем) либо «нет»");
    if (v.doubt) return drop("сомнение («печатать ли», «пока не решили», «подумаем») - ответь «да» либо «нет»");
    if (v.yes && v.no) return drop("в ответе и «печатаем», и «не печатаем» - ответь «да» либо «нет»");
    if (v.no) return off;
    if (v.yes) return on;
    const sj = l.match(PRICE_SUBJ), r2 = sj ? str(l.slice(sj[0].length)) : "";
    if (/^(да|yes)[.!]*$/.test(r2)) return on;
    if (/^(нет|no)[.!]*$/.test(r2)) return off;
    const yh = l.match(PRICE_YES_HEAD);
    if (yh) {
      const rest = str(l.slice(yh[0].length).replace(/^[\s,.!:;-]+/, ""));
      if (!rest) return on;
      if (isOk(rest)) return accept();
      return drop("согласие с оговоркой - ответь «да», «нет» либо текстом варианта");
    }
    if (isOk(l) || confirmWords(a) === "ok") return accept();
    // «Не согласен», «неверно»: против напечатанного, но что вместо - не сказано.
    if (DISAGREE.test(l)) return drop("несогласие без варианта - ответь «печатаем» либо «не печатаем»");
    const nh = l.match(REFUSE_HEAD);
    if (nh && !str(l.slice(nh[0].length).replace(/^[\s,.!:;-]+/, ""))) return off;
    return drop("ни «да», ни «нет», ни текста варианта");
  }
  if (d.choice) {
    const keys = Object.keys(d.choice);
    const exact = keys.find((k) => k === l);
    if (exact) return { op: "set", value: exact, as: `${exact} - ${d.choice[exact]}` };
    // Ответ целиком - текст варианта из документа 1.
    const fa = flat(a);
    const byText = keys.find((k) => fa === flat(d.choice[k]));
    if (byText) return { op: "set", value: byText, as: `${byText} - ${d.choice[byText]}` };
    if (isOk(l) || confirmWords(a) === "ok") return accept();
    const { pos, neg, loose } = choiceHits(d, a);
    if (loose) return drop("в ответе отрицание, к которому нет варианта («нет», «не согласен», «не только») - назови вариант словами документа 1");
    const both = pos.filter((k) => neg.includes(k));
    if (both.length) return drop(`вариант и назван, и отвергнут: ${both.join(", ")}`);
    let hit = null;
    if (pos.includes("both")) hit = neg.length ? null : "both";
    else if (pos.includes("shop") && pos.includes("services")) hit = "both";
    else if (pos.length === 1) hit = pos[0];
    if (!hit) {
      if (pos.length) return drop(`подходит несколько вариантов: ${pos.join(", ")}`);
      return drop(neg.length ? `вариант только отвергнут (${neg.join(", ")}) - назови, какой нужен` : "нет варианта: назови его словами документа 1");
    }
    return { op: "set", value: hit, as: `${hit} - ${d.choice[hit]}` };
  }
  // d1-d5: текст решения
  if (BARE_YN.test(l)) return drop("голое «да» или «нет» - нужна формулировка: «верно» либо новый текст целиком");
  if (isOk(l)) return accept();
  const cw = confirmWords(a);
  if (cw === "ok") return accept();
  if (cw === "hedge") return drop("подтверждение с оговоркой («в целом», «почти») - «верно» либо новый текст целиком");
  if (cw === "neg") return drop("несогласие без новой формулировки - напиши новое значение целиком");
  if (fillerOnly(a)) return drop("ни подтверждения «верно», ни формулировки - «верно» либо новый текст целиком");
  if (agreeBut(a)) return drop("согласие с оговоркой - напиши новое значение целиком");
  if (DISAGREE.test(l)) return drop("несогласие без новой формулировки - напиши новое значение целиком");
  if (REFUSE_HEAD.test(l)) return drop("отказ без новой формулировки - напиши новое значение целиком, без «нет»");
  if (EDIT_HEAD.test(l)) return drop("правка вместо формулировки («добавьте», «уберите») - напиши новое значение целиком");
  if (d.list) {
    const items = a.split(/\s*;\s*/).map((s) => str(s)).filter(Boolean).map((s) => s.slice(0, d.max)).slice(0, 8);
    if (!items.length) return drop("пустой ответ");
    const ed = items.find((x) => LIST_EDIT.test(low(x)) || EDIT_HEAD.test(low(x)));
    if (ed) return drop(`правка списка вместо нового списка («${ed}») - напиши все пункты целиком через «;»`);
    return { op: "set", value: items, as: `новое значение: ${items.join("; ")}` };
  }
  const v = a.slice(0, d.max);
  return v ? { op: "set", value: v, as: `новое значение «${v}»` } : drop("пустой ответ");
}

// Ответ листа -> поле контракта. Возвращает разбор parseDecision; set записывается в data.
export function writeDecision(data, d, answer) {
  const r = parseDecision(data, d, answer);
  if (r.op !== "set") return r;
  if (d.flag) {
    const sig = arr(getPath(data, d.path)).slice();
    const i = sig.indexOf(d.flag);
    if (r.value && i === -1) sig.push(d.flag);
    if (!r.value && i !== -1) sig.splice(i, 1);
    setPath(data, d.path, sig);
  } else setPath(data, d.path, r.value);
  return r;
}

// ---------------------------------------------------------------- разбор ответа по факту
// Три состояния строки факта (решение Р1): принятие («да», «верно», «+», «можно показывать»,
// «разрешаем») - публикуем, значение и цитата прежние; отказ («нет», «не публикуем», «публиковать не
// надо») - снимаем; другой текст - новое значение. Прочерк и пустая строка - молчание. Ответ с
// оговоркой («нет, это устарело», «да, но ...», «можно, но без цифры», «без цифры»), «не знаю» и
// служебная пометка - не разобрано: факт не публикуется, пока строку не поправят.
const FACT_VERB = "(публиковать|опубликовать|печатать|напечатать|указывать|указать|писать|оставить|оставлять|показывать|показать|размещать|разместить)";
const FACT_ACCEPT = new RegExp(`^(\\+|публикуем|публикуйте|публиковать|опубликуем|опубликуйте|опубликовать|печатаем|печатайте|печатать|оставить|оставляем|оставьте|оставим|пишем|пишите|показываем|показывайте|размещаем|размещайте|указываем|указывайте|разрешаем|разрешаю|разрешено|можно|(можно|нужно|надо|разрешаем|разрешаю) ${FACT_VERB}|да,? (публикуем|печатаем|оставляем|оставить|пишем|можно))[.!]*$`);
const FACT_REFUSE = /^(нет|не публикуем|не публиковать|не публикуйте|не (надо|нужно|стоит) (публиковать|печатать|указывать|писать|показывать|размещать)|(публиковать|печатать|указывать|писать|показывать|размещать) (не надо|не нужно|не стоит|нельзя)|не стоит|не печатаем|не печатать|не пишем|не пишите|не надо|не нужно|не указывать|не указываем|не указывайте|не показывать|не показываем|убрать|уберите|уберем|убираем|удалить|удалите|удалим|удаляем|снять|снимите|снимем|снимаем)[.!]*$/;
// Вводное слово перед принятием или отказом: «лучше не публиковать», «давайте уберем».
const FACT_LEAD = /^(лучше|давайте|пожалуйста)[\s,]+/;
// Принятие и следом еще текст. Хвост - подтверждение («публикуйте как есть», «можно, все верно»,
// «публикуйте смело») - принятие. Хвост через знак препинания или связку («можно, но без цифры»,
// «печатаем, только 24 месяца») - оговорка, не разобрано. После принятия, которое говорит о самом
// факте, любой хвост - оговорка: «публикуем», «разрешаем», повелительное «печатайте», «оставьте» и
// «можно (разрешаем) публиковать (показывать, указывать)» - «публикуем без цифры», «можно публиковать
// с 2012 года». После «можно», «печатаем», «оставляем», «пишем» значение может начаться: «можно в
// рассрочку», «печатаем визитки за день», «печатаем без предоплаты» - значения; но «печатаем без
// цифры» - оговорка: «без» и слово о самом тексте факта (цифра, сумма, имя, название, подробности).
const FACT_ACCEPT_HEAD = new RegExp(`^((можно|нужно|надо|разрешаем|разрешаю) ${FACT_VERB}|публикуем|публикуйте|публиковать|опубликуем|опубликуйте|опубликовать|печатаем|печатайте|печатать|оставить|оставляем|оставьте|оставим|пишем|пишите|показывайте|размещайте|указывайте|разрешаем|разрешаю|можно)(?![а-яa-z0-9])`);
const FACT_ACCEPT_TAIL = /^(смело|спокойно|обязательно|пожалуйста|конечно)[.!]*$/;
const FACT_META = /(^|[^а-я])(цифр|числ|сумм|фамили|имен[иа]?(?![а-я])|имя(?![а-я])|названи|указани|конкретик|подробност|детал|точн[а-я]*\s+(цифр|числ|сумм|дат|срок)|номер|процент)/;
const FACT_QUALIFY = /^(только\s+|но\s+)?(без|кроме|за\s+исключением)\s/;
// Значение устарело («устарело», «уже неактуально, сейчас 24 месяца»): публиковать ли старое и что
// вместо - не сказано, это не новое значение «Устарело».
const FACT_STALE = /^((это|уже|давно|сейчас|все)\s+)*(устарел|устарев|неактуал|не\s+актуал)/;
// Ответ без цифр, который начинается с отрицания или глагола снятия и не совпал с отказом
// целиком («не согласен», «уберите это», «убрать совсем», «нельзя»): отказ это или новое
// значение - не сказано. С цифрой это значение («не более 3 дней»); «нет предоплаты» и «без
// выезда» - тоже значения.
const FACT_NEG_HEAD = /^(не|ни)\s|^(неверн|неправильн|убер|убир|убр|удал|сним|снят|скры|скро|нельзя|против)/;
const UNSURE = /^(не знаю|не помню|затрудняюсь|уточню|подумаем|дайте подумать|\?+)(?![а-я\u0451a-z0-9])/;
export function parseFactAnswer(answer) {
  const a = str(answer), l = low(a);
  if (!a || a === "-") return { op: "silence" };
  const ACC = { op: "accept", as: "да - печатаем как есть" }, REF = { op: "refuse", as: "нет - не публикуем" };
  const core = l.replace(FACT_LEAD, "");
  if (FACT_ACCEPT.test(l) || FACT_ACCEPT.test(core) || isOk(l)) return ACC;
  if (FACT_REFUSE.test(core)) return REF;
  // «Ок, публикуем», «да, можно показывать»: согласие и следом явное принятие.
  const oh = okHead(a);
  if (oh.agree && FACT_ACCEPT.test(low(oh.rest))) return ACC;
  const caveat = { op: "drop", ground: "ответ с оговоркой - нужно «да», «нет» либо новое значение целиком", as: "не разобрано: ответ с оговоркой" };
  const ah = core.match(FACT_ACCEPT_HEAD);
  if (ah) {
    const tail = core.slice(ah[0].length), rest = str(tail.replace(/^[\s,.:;!-]+/, ""));
    if (rest && (isOk(rest) || FACT_ACCEPT.test(rest) || FACT_ACCEPT_TAIL.test(rest))) return ACC;
    const strong = /\s/.test(ah[1]) || /^(публик|опублик|разреш)/.test(ah[1]) || /(йте|ите|ьте)$/.test(ah[1]);
    if (rest && (strong || /^\s*[,.:;!-]/.test(tail) || D10_BUT.test(flat(rest)) || (FACT_QUALIFY.test(rest) && FACT_META.test(rest)))) return caveat;
  }
  // «Без цифры», «только без фамилии»: оговорка к напечатанному значению, а не новое значение.
  if (FACT_QUALIFY.test(core) && FACT_META.test(core) && !hasNumber(a)) return caveat;
  const nh = l.match(/^нет\s*[,.:;-]\s*/);
  if (nh && FACT_REFUSE.test(l.slice(nh[0].length).replace(FACT_LEAD, ""))) return REF;
  if (UNSURE.test(l)) return { op: "drop", ground: "ответ «не знаю» - значения нет", as: "не разобрано: значения нет" };
  if (SERVICE_NOTE.test(a)) return { op: "drop", ground: "служебная пометка, а не факт", as: "не разобрано: служебная пометка" };
  if (FACT_STALE.test(flat(core))) return { op: "drop", ground: "значение устарело - нужно «нет» либо новое значение целиком", as: "не разобрано: значение устарело" };
  // «Абсолютно верно», «конечно» - подтверждение тем же правилом, что у d1-d5; «в целом верно»
  // и «не совсем верно» - не разобрано, а не новое значение факта.
  const cw = confirmWords(a);
  if (cw === "ok") return ACC;
  if (cw) return { op: "drop", ground: "подтверждение с оговоркой - нужно «да», «нет» либо новое значение целиком", as: "не разобрано: подтверждение с оговоркой" };
  // «Хорошо», «спасибо», «не надо менять»: ни «да», ни значения - то же правило, что у d1-d5.
  if (fillerOnly(a)) return { op: "drop", ground: "ни «да», ни «нет», ни значения", as: "не разобрано: ни «да», ни значения" };
  if (agreeBut(a) || nh || NO_HEAD.test(l)) return caveat;
  if (!hasNumber(a) && (FACT_NEG_HEAD.test(l) || FACT_NEG_HEAD.test(core))) {
    return { op: "drop", ground: "ответ начинается с отрицания - нужно «нет» (не публикуем) либо новое значение целиком", as: "не разобрано: отрицание вместо значения" };
  }
  return { op: "set", value: a, as: `новое значение «${a}»` };
}

// ---------------------------------------------------------------- состав страниц без SEO
// sites/NNN/structure_data.json пишет pages-planner (basic, multipage) либо build-project
// (basic, landing - одна главная). Формат ровно тот, что пишет /seo-struktura и принимает
// import-structure.mjs текстов без правок. Правила ниже списаны с кода импорта: он ищет
// родителя без хвостового слеша, тип - по подстроке, инфо-страницу - по словам адреса и имени.
export const STRUCT_TYPES = ["Главная", "Услуга", "Категория", "Товар", "Инфо", "Прочее"];
export const STRUCT_MAX = 40;
export const STRUCT_FIELDS = ["n", "url", "type", "name", "section", "target_status", "marker", "queries", "role", "client_notes"];
export const INFO_CANON = {
  info_about: "О компании", info_contacts: "Контакты", info_team: "Команда",
  info_reviews: "Отзывы", info_cases: "Кейсы", info_faq: "Вопросы"
};
// Копия infoType из import-structure.mjs.
export function importInfoType(url, name) {
  const u = `${url} ${name}`.toLowerCase();
  if (/about|o-kompanii|о компании|о нас/.test(u)) return "info_about";
  if (/contact|kontakt|контакт/.test(u)) return "info_contacts";
  if (/team|komanda|команда/.test(u)) return "info_team";
  if (/review|otzyv|отзыв/.test(u)) return "info_reviews";
  if (/case|kejs|кейс/.test(u)) return "info_cases";
  if (/faq|vopros|вопрос/.test(u)) return "info_faq";
  return "info_other";
}
// Правила импорта текстов - копия import-structure.mjs (kit site-tekst): проверяем то, что
// увидит импорт. Тип из колонки type важнее шаблонного адреса. Шаблон - адрес ({slug}, [id],
// -slug, /slug) или слово «шаблон» в name: импорт помечает страницу template: true и не
// ставит ее в меню, а product дает только при пустом типе или «Товар». Совпадение копии
// с оригиналом держит шаг tests/site/run.mjs.
export const TEMPLATE_URL = /\{[^}]*\}|\[[^\]]*\]|-slug(?![a-z0-9])|(^|\/)slug$/i;
const TEMPLATE_NAME = /шаблон/i;
const HUB_ROLE = /навигац|обзор/;
const HUB_NAME = /\(хаб\)|(^|\s)хаб(\s|$)/i;
// Юридические (адрес или название) импорт пропускает с ui_role legal - ссылка в подвале;
// служебные (избранное, сравнение) - пропускает без ui_role.
export const LEGAL_URL = /privacy|policy|politika|konfidenc|terms|agreement|soglashenie|soglasie-na|oferta|cookie|personal-?data|personalnyh-dannyh|obrabotk[a-z-]*-dannyh/i;
export const LEGAL_NAME = /политик[а-я]* конфиденц|персональн[а-я]* данн|согласи[еяю] на обработ|пользовательск[а-я]* соглашени|публичн[а-я]* оферт|(^|[^а-я])оферт|cookie|куки/i;
export const SERVICE_URL = /favorites|izbrannoe|compare|sravnenie/i;
// Адрес к пути, как на входе импорта: без схемы и хоста, без ?#, без слеша на конце.
export function importPath(u) {
  let s = str(u).replace(/^https?:\/\/[^/?#]+/i, "").replace(/[?#].*$/, "");
  if (!s.startsWith("/")) s = "/" + s;
  return s.length > 1 ? (s.replace(/\/+$/, "") || "/") : "/";
}
export const isTemplatePage = (p) => TEMPLATE_URL.test(importPath(p && p.url)) || TEMPLATE_NAME.test(str(p && p.name));
export const isLegalPage = (p) => LEGAL_URL.test(importPath(p && p.url)) || LEGAL_NAME.test(str(p && p.name));
export const isServicePage = (p) => !isLegalPage(p) && SERVICE_URL.test(importPath(p && p.url));
export function importType(p) {
  const t = low(p.type), role = low(p.role), name = low(p.name), url = importPath(p.url);
  if (t.includes("главн") || url === "/" || /^\/[a-z]{2}$/.test(url)) return "home";
  if (t.includes("статья") || t.includes("блог")) return null;
  if (isTemplatePage(p) && (!t || t.includes("товар"))) return "product";
  if (HUB_NAME.test(name)) return "hub";
  if (t.includes("услуг")) return "service";
  if (t.includes("товар")) return "product";
  if (t.includes("инфо")) return importInfoType(url, str(p.name));
  if (t.includes("прочее")) return "info_other";
  if (t.includes("категор")) return HUB_ROLE.test(role) ? "hub" : "category";
  return "category";
}
const WANT_TYPE = { "Главная": "home", "Услуга": "service", "Товар": "product", "Прочее": "info_other" };
const URL_HINT = [
  ["info_about", /o-kompanii|o-nas|about/], ["info_contacts", /kontakt|contact/], ["info_team", /komand|team/],
  ["info_reviews", /otzyv|review/], ["info_cases", /keis|kejs|keys|case|portfolio/], ["info_faq", /faq|vopros/]
];

// Нарушения (V) и предупреждения (W) состава против контракта импорта и правил планировщика.
export function checkStructure(sd, project) {
  const V = [], W = [];
  const stat = { pages: 0, yes: 0, no: 0, byType: {} };
  if (!sd || typeof sd !== "object" || !Array.isArray(sd.pages)) { V.push("нет pages[] - формат не structure_data.json"); return { V, W, stat }; }
  if (!str(sd.source_file)) W.push("source_file пуст - непонятно, кто писал состав");
  const pages = sd.pages;
  stat.pages = pages.length;
  if (!pages.length) V.push("pages[] пуст: главная обязательна");
  if (pages.length > STRUCT_MAX) V.push(`страниц ${pages.length}, потолок ${STRUCT_MAX} - режь до разумного минимума`);
  const b = (project && project.business) || {};
  const dirs = arr(b.directions);
  const dirIds = new Set(dirs.map((d) => d && d.id).filter(Boolean));
  const seenN = new Set(), seenUrl = new Set(), used = new Set();
  pages.forEach((p, i) => {
    if (!p || typeof p !== "object" || Array.isArray(p)) { V.push(`pages[${i}]: не объект`); return; }
    const url = typeof p.url === "string" ? p.url : "";
    const at = `pages[${i}]${url ? " " + url : ""}`;
    const miss = STRUCT_FIELDS.filter((k) => !(k in p));
    if (miss.length) V.push(`${at}: нет полей ${miss.join(", ")}`);
    if (!Number.isInteger(p.n) || p.n < 1) V.push(`${at}: n - целое от 1`);
    else if (seenN.has(p.n)) V.push(`${at}: n ${p.n} повторяется`);
    seenN.add(p.n);
    if (url.length > 1 && url.endsWith("/")) V.push(`${at}: слеш на конце - import-structure не найдет родителя, пиши без него`);
    else if (!/^\/([a-z0-9{}_-]+(\/[a-z0-9{}_-]+)*)?$/.test(url)) V.push(`${at}: адрес «${url}» - ведущий слеш, латиница в нижнем регистре, цифры и дефис`);
    if (seenUrl.has(url)) V.push(`${at}: адрес повторяется`);
    seenUrl.add(url);
    const type = str(p.type);
    stat.byType[type || "-"] = (stat.byType[type || "-"] || 0) + 1;
    if (!STRUCT_TYPES.includes(type)) V.push(`${at}: тип «${type}» вне словаря ${STRUCT_TYPES.join(", ")} - статьи и блог в состав не входят`);
    const name = typeof p.name === "string" ? p.name.trim() : "";
    if (Array.from(name).length < 2 || !/[а-яА-Я]/.test(name)) V.push(`${at}: name по-русски, от 2 знаков - импорт берет его в H1 и предмет страницы`);
    if (!["yes", "no"].includes(p.target_status)) V.push(`${at}: target_status «${p.target_status}» - только yes или no`);
    else stat[p.target_status]++;
    if (!Array.isArray(p.queries)) V.push(`${at}: queries - массив`);
    else if (p.queries.length) V.push(`${at}: queries только [] - семантики у состава без SEO нет, запросы были бы выдумкой`);
    for (const k of ["role", "client_notes", "section", "marker"]) if (k in p && typeof p[k] !== "string") V.push(`${at}: ${k} - строка`);
    const section = str(p.section);
    const dm = section.match(/^dir:([a-z0-9][a-z0-9-]*)$/);
    if (section && !dm) V.push(`${at}: section «${section}» - пусто либо dir:<id направления>`);
    if (dm) { if (!dirIds.has(dm[1])) V.push(`${at}: направления «${dm[1]}» нет в business.directions`); else used.add(dm[1]); }
    const role = low(p.role);
    const seen = importType(p);
    const tmpl = isTemplatePage(p);
    if (type === "Главная" && url !== "/") V.push(`${at}: главная живет по адресу /`);
    if (url === "/" && type !== "Главная") V.push(`${at}: адрес / у страницы типа «${type}» - это главная`);
    if (tmpl && type !== "Товар") V.push(`${at}: «шаблон» в name или {slug} в адресе у типа «${type}» - шаблон карточки бывает только у «Товар»: по шаблонному адресу или слову «шаблон» импорт пометит страницу шаблоном и уберет из меню, а слово «шаблон» уедет в H1`);
    if (type === "Товар" && !tmpl) V.push(`${at}: карточка без слова «шаблон» в name и без {slug} в url - каждый товар станет отдельной страницей`);
    if (type === "Услуга" && HUB_ROLE.test(role)) V.push(`${at}: хаб с типом «Услуга» импорт прочтет как услугу - хаб это «Категория» и role «навигация»`);
    if (HUB_NAME.test(name)) V.push(`${at}: слово «хаб» в name уедет в H1 - хаб задается типом «Категория» и role «навигация»`);
    if (type === "Инфо") {
      // Импорт узнает инфо-страницу по словам адреса и имени. Транслит «/keisy» он не узнает,
      // поэтому каноничное слово обязано стоять в name.
      const byName = importInfoType("", name), byImport = importInfoType(url, name);
      const hint = (URL_HINT.find(([, re]) => re.test(url)) || [])[0];
      if (byName !== "info_other" && byImport !== byName) V.push(`${at}: импорт прочтет страницу как «${INFO_CANON[byImport] || "прочее"}» - адрес перебивает имя «${name}»`);
      else if (hint && byImport !== hint) V.push(`${at}: адрес похож на «${INFO_CANON[hint]}», а в name нет этого слова - импорт прочтет «${INFO_CANON[byImport] || "прочее"}»`);
    }
    if ((type === "Услуга" || (type === "Категория" && !HUB_ROLE.test(role))) && !dm) {
      V.push(`${at}: страница направления без section «dir:<id>» - текстам не с чем связать сегмент и факты`);
    }
    if (type !== "Главная" && seen === "home") V.push(`${at}: двухбуквенный адрес импорт примет за языковую главную - удлини слаг`);
    else if (WANT_TYPE[type] && seen && seen !== WANT_TYPE[type]) V.push(`${at}: тип «${type}», а импорт прочтет «${seen}»`);
    if (isLegalPage(p)) W.push(`${at}: юридическая страница - импорт пометит ее skip (ссылка в подвале), в составе без SEO она лишняя`);
    else if (isServicePage(p)) W.push(`${at}: служебная страница (избранное, сравнение) - импорт пометит ее skip, в составе без SEO она лишняя`);
    if (p.target_status === "yes" && !str(p.marker) && !tmpl) W.push(`${at}: marker пуст - писателю нечем держать H1`);
  });
  const homes = pages.filter((p) => p && p.type === "Главная");
  if (homes.length !== 1) V.push(`главных ${homes.length} - нужна ровно одна`);
  else if (pages[0] !== homes[0] || homes[0].n !== 1) V.push("главная идет первой, n 1");
  // хаб оправдан группой от трех страниц
  for (const h of pages.filter((p) => p && p.type === "Категория" && HUB_ROLE.test(low(p.role)))) {
    const kids = pages.filter((p) => p && p !== h && typeof p.url === "string" && p.url.startsWith(`${h.url}/`)).length;
    if (kids < 3) W.push(`хаб ${h.url}: внутри ${kids} страниц - хаб ставится на группу от трех`);
  }
  const lost = dirs.filter((d) => d && d.id && !used.has(d.id)).map((d) => d.id);
  if (lost.length && pages.length > 1) W.push(`направления без страницы: ${lost.join(", ")}`);
  if (b.site_kind === "landing" && pages.length > 1) W.push(`сайт - лендинг, а страниц в составе ${pages.length}`);
  if (b.site_kind === "multipage" && pages.length === 1) W.push("сайт многостраничный, а в составе одна главная - нужен pages-planner");
  const flip = structureFlip(sd, b.type);
  if (flip) W.push(flip);
  return { V, W, stat };
}

// Состав написан под другой тип сайта (ответ d8 поменял его после планировщика): у магазина
// одни услуги без категорий и карточек, у услуг - карточки товара без единой услуги. Для «и то
// и другое» состав не судим: у смешанного сайта законны обе формы.
export function structureFlip(sd, type) {
  const pages = arr(sd && sd.pages).filter((p) => p && p.target_status !== "no");
  const has = (fn) => pages.some(fn);
  const svc = has((p) => p.type === "Услуга");
  const goods = has((p) => p.type === "Товар" || (p.type === "Категория" && !HUB_ROLE.test(low(p.role))));
  if (type === "shop" && svc && !goods) return "состав писан под услуги, а сайт - магазин (d8): категорий и карточек нет - нужен новый проход pages-planner";
  if (type === "services" && has((p) => p.type === "Товар") && !svc) return "состав писан под магазин, а сайт продает услуги (d8): страниц услуг нет - нужен новый проход pages-planner";
  return "";
}

// Лендинг: состав - одна главная, планировщик не нужен. Пишет build-project.
export function landingStructure(project) {
  const b = (project && project.business) || {};
  const roots = arr(b.directions).filter((d) => d && !str(d.parent));
  const region = str(b.region);
  let marker = str(roots[0] && roots[0].marker) || str(b.name);
  if (marker && region && region.length <= 30 && !/[()]/.test(region) && !low(marker).includes(low(region).slice(0, 5))) marker = `${marker} ${low(region)}`;
  const segs = arr(project && project.audience && project.audience.segments).map((s) => s && s.id).filter(Boolean);
  return {
    source_file: "site-analiz",
    pages: [{
      n: 1, url: "/", type: "Главная", name: "Главная",
      section: roots.length === 1 ? `dir:${roots[0].id}` : "",
      target_status: "yes", marker: marker.slice(0, 120), queries: [], role: "",
      client_notes: segs.length ? `сегменты ${segs.join(",")}` : ""
    }]
  };
}

// ---------------------------------------------------------------- решение d9: состав сайта
// Состав печатается в документе 1 как принятое решение с дефолтом. Ответ заказчика меняет
// только target_status: снять страницу или вернуть снятую. Новой страницы ответ не рождает -
// это новый проход планировщика, иначе адрес и тип придумал бы разбор ответа.
export const STRUCT_DECISION = { key: "d9", name: "состав страниц", title: "Состав сайта" };
const D9_OFF = /^(убрать|уберите|убираем|снять|снимите|снимаем|удалить|удалите|без|минус|не нужн[аоы]?|не делаем|не надо)(?=[\s:]|$)\s*:?\s*/i;
const D9_ON = /^(вернуть|верните|возвращаем|оставить|оставьте|добавить|добавьте|плюс|нужн[аоы]?|делаем)(?=[\s:]|$)\s*:?\s*/i;
const D9_OK = /^(да|ок|ok|принимаем|согласны|согласен|верно|все верно|так и делаем)[.!]?$/i;
// Ответ -> {ops:[{page, status, token}], dropped:[{token, ground}], accept}
export function parseStructureAnswer(sd, answer) {
  const res = { ops: [], dropped: [], accept: false };
  const a = str(answer);
  if (!a || a === "-" || D9_OK.test(a)) { res.accept = true; return res; }
  const pages = arr(sd && sd.pages);
  const find = (tok) => {
    const t = str(tok).replace(/^№/, "");
    if (/^\/\S*$/.test(t)) { const u = t.length > 1 ? t.replace(/\/+$/, "") : t; return pages.filter((p) => p.url === u); }
    if (/^\d+$/.test(t)) return pages.filter((p) => p.n === Number(t));
    const q = low(t);
    const exact = pages.filter((p) => low(p.name) === q);
    if (exact.length) return exact;
    // «без отзывов» против страницы «Отзывы»: сравниваем основы слов, а не строки целиком
    const stem = (w) => (w.length > 5 ? w.slice(0, 5) : w.slice(0, Math.max(3, w.length - 1)));
    const want = q.split(/[^а-яa-z0-9]+/).filter((w) => w.length >= 3).map(stem);
    if (!want.length) return [];
    return pages.filter((p) => {
      const words = low(p.name).split(/[^а-яa-z0-9]+/).filter(Boolean);
      return want.every((s) => words.some((w) => w.startsWith(s)));
    });
  };
  for (const clause of a.split(/\s*;\s*/).filter(Boolean)) {
    let status = null, rest = clause;
    const off = clause.match(D9_OFF), on = clause.match(D9_ON);
    if (off) { status = "no"; rest = clause.slice(off[0].length); }
    else if (on) { status = "yes"; rest = clause.slice(on[0].length); }
    if (!status) { res.dropped.push({ token: clause, ground: "нет глагола: убрать либо вернуть" }); continue; }
    const toks = [];
    for (const part of rest.split(/\s*,\s*|\s+и\s+/).map((x) => str(x)).filter(Boolean)) {
      if (/^(\/\S*|№?\d+)(\s+(\/\S*|№?\d+))+$/.test(part)) toks.push(...part.split(/\s+/)); else toks.push(part);
    }
    if (!toks.length) res.dropped.push({ token: clause, ground: "не названо, какие страницы" });
    for (const tok of toks) {
      const hit = find(tok);
      if (hit.length !== 1) { res.dropped.push({ token: tok, ground: hit.length ? "под это подходит несколько страниц - назови адрес" : "такой страницы в составе нет; новая страница - новый проход pages-planner" }); continue; }
      if (hit[0].url === "/" && status === "no") { res.dropped.push({ token: tok, ground: "главная обязательна" }); continue; }
      res.ops.push({ page: hit[0], status, token: tok });
    }
  }
  return res;
}

// ---------------------------------------------------------------- решение d10: контакты и реквизиты
// Контакты и реквизиты печатаются в документе 1 решением с дефолтом «верно»: то, что стоит
// в business.legal, уйдет в шапку, подвал и контакты сайта. Решение живет отдельно от
// DECISIONS, как d9: оно правит до семи полей, а не одно. Ответ - «верно» либо правка
// строкой «метка: значение» через «; ». Журнал получает ровно одну запись со словами
// «решению d10»: молчание или подтверждение (waiver) либо правка (gap). По ней импорт
// текстов решает, сверены ли контакты заказчиком (waiver - да, правка - нет, строка в gaps).
export const LEGAL_DECISION = { key: "d10", name: "контакты и реквизиты", title: "Контакты и реквизиты для сайта" };
export const LEGAL_FIELDS = [
  { key: "phone", label: "телефон", max: 40 },
  { key: "email", label: "почта", max: 80 },
  { key: "schedule", label: "часы", max: 120 },
  { key: "address", label: "адрес", max: 200 },
  { key: "entity", label: "юрлицо", max: 160 },
  { key: "inn", label: "ИНН", digits: [10, 12] },
  { key: "ogrn", label: "ОГРН", digits: [13, 15] }
];
// Метки ответа по приоритету: «адрес почты» - почта, «почтовый адрес» - адрес, «тел.» - телефон,
// «телеграм» меткой не считается.
const LEGAL_LABELS = [
  ["email", /^адрес[а-я]*\s+(электронн[а-я]*\s+почт[а-я]*|эл\.?\s*почт[а-я]*|почт[а-я]*|e-?mail)/],
  ["address", /^((почтов|юридическ|фактическ)[а-я]*\s+адрес[а-я]*|адрес[а-я]*(\s+(офиса|компании|организации))?)/],
  ["phone", /^((контактн|основн)[а-я]*\s+телефон[а-я]*|номер\s+телефона|телефон[а-я]*|тел\.?)/],
  ["email", /^(e-?mail|емейл|имейл|эл\.?\s*почт[а-я]*|электронн[а-я]*\s+почт[а-я]*|почт[а-я]*)/],
  ["schedule", /^(часы|график|режим)(\s+работы)?/],
  ["entity", /^(юрлицо|юр\.?\s*лицо|юридическое лицо|организация|название компании|наименование)/],
  ["inn", /^инн/],
  ["ogrn", /^огрн(ип)?/]
];
// Значение без разделителя после метки берется, только если похоже на значение поля.
// Иначе после метки стоит уточнение («телефон для WhatsApp:»), и поле не угадываем.
const LEGAL_KIND = {
  phone: /^[+\d(]/, email: /^[^\s@]+@/, inn: /^\d/, ogrn: /^\d/,
  schedule: /^(пн|вт|ср|чт|пт|сб|вс|ежедневно|круглосуточно|без выходных|с\s*\d|\d)/,
  address: /^(\d|г\.|город|ул\.|улица|пр\.|проспект|пер\.|переулок|шоссе)/,
  entity: /^(ооо|оао|зао|пао|ао|ип|ано|«)(?![а-яa-z])/
};
// Печать без знаков, на которых откажет build-doc: номер с сайта бывает с цифровым тире.
export const legalPrint = (s) => String(s == null ? "" : s)
  .replace(/[\u2012\u2013\u2014\u2015\u2212]/g, "-").replace(/\u0451/g, "е").replace(/\u0401/g, "Е").replace(/\s+/g, " ").trim();
export const NO_PHONE = "без телефона";
// Поле, которое заказчик велел убрать ответом по d10, не пропадает молча: его ключ ложится в
// business.legal.absent_fields (обобщение старой отметки phone_absent, она читается как раньше).
// Импорт текстов по этому списку не зовет ради поля снимок старого сайта.
export const NOT_SHOWN = "не указываем";
export const isAbsent = (lg, key) => !!lg && (arr(lg.absent_fields).includes(key) || (key === "phone" && lg.phone_absent === true));
const absentText = (key) => (key === "phone" ? NO_PHONE : NOT_SHOWN);
// Заполненные и снятые поля строкой «метка: значение» в порядке LEGAL_FIELDS.
export function legalParts(legal) {
  const lg = legal && typeof legal === "object" && !Array.isArray(legal) ? legal : {};
  const out = [];
  for (const f of LEGAL_FIELDS) {
    const v = legalPrint(lg[f.key]);
    if (v) out.push(`${f.label}: ${v}`);
    else if (isAbsent(lg, f.key)) out.push(`${f.label}: ${absentText(f.key)}`);
  }
  return out;
}
// Строка решения документа 1 либо null, если печатать нечего.
export function legalRow(data) {
  const parts = legalParts(data && data.business && data.business.legal);
  if (!parts.length) return null;
  return { key: LEGAL_DECISION.key, title: LEGAL_DECISION.title, value: parts.join("; "),
    alt: `поправьте строкой «${LEGAL_DECISION.key}: метка: новое значение»` };
}
// Подтверждение живыми словами: «Да, все верно», «Все верно, спасибо», «остальное верно»,
// «правок нет», «согласны со всем», «так и оставим», «оставьте как было», «конечно», «абсолютно
// верно». Нужно слово согласия: одна вежливость («спасибо», «хорошо») подтверждением не считается.
// Длинные варианты - раньше коротких: «все так и оставим» не должно остановиться на «все так».
const D10_AGREE = /^(да|ок|ok|окей|ага|угу|(абсолютно|совершенно) (верно|правильно)|именно так|конечно|разумеется|безусловно|пусть (будет|остается|останется)( так| как есть)?|пусть так|это (так|верно|правильно)|не (возражаем|возражаю|против)|верно|правильно|(все )?так и (есть|остав(им|ляем|ить|ьте))|(оставляем|оставим|оставить|оставьте)( все)? (так|как (есть|было))|(оставляем|оставим)( все)?|как (есть|было)|все верно|все так|все ок|все ok|все правильно|все хорошо|все отлично|все актуально|актуально|подтверждаю|подтверждаем|принимаем|принято|согласовано|одобряем|одобрено|(полностью |со всем |во всем )?(согласны|согласен|согласна)( со всем| во всем| полностью)?|(все )?(подходит|устраивает|нравится)|(все )?остальное( все)? (верно|так|правильно|без изменений|ок)|без (изменений|правок|замечаний|возражений)|(правок|замечаний|возражений|изменений) нет|нет (правок|замечаний|возражений)|возражений не имеем)(?![а-яa-z0-9])/;
const D10_POLITE = /^(спасибо|благодарю|отлично|хорошо)(?![а-яa-z0-9])/;
const D10_SEP = /^[\s,.!;:)(-]+/;
const D10_BUT = /^(нет|но|только|кроме того|кроме|исправьте|поправьте|поправка|правка|уточнение|измените|замените|поменяйте)(?![а-яa-z0-9])[\s,.:;-]*/;
// Срез слов согласия и вежливости с начала строки -> { rest, agree }.
function okHead(text) {
  let rest = text, agree = false;
  for (;;) {
    const t = rest.toLowerCase().replace(/\u0451/g, "е");
    const m = t.match(D10_AGREE) || t.match(D10_POLITE);
    if (!m) break;
    if (D10_AGREE.test(t)) agree = true;
    rest = rest.slice(m[0].length);
    rest = rest.slice((rest.match(D10_SEP) || [""])[0].length);
  }
  return { rest, agree };
}
// Одно правило подтверждения на весь лист: d1-d8, d10 и факты (d9 держит свое D9_OK).
export const isOk = (text) => { const h = okHead(str(text)); return h.agree && !str(h.rest); };
// Хвост после правки: «телефон: +7 ...; остальное верно, спасибо».
const D10_TAIL = /[\s,.;!]+(((все )?остальное( все)? (верно|так|правильно|без изменений|ок)|спасибо|благодарю)[\s,.;!]*)+$/i;
const D10_REMOVE = /^(-|нет|убрать|уберите|удалить|удалите|не указыва[а-я]*|не публику[а-я]*|не печата[а-я]*|без (телефона|номера|адреса|почты|часов|реквизитов))$/i;
// Ответ -> {ops:[{key,label,was,now,remove}], dropped:[{token,ground}], same:[label], accept, silent}
export function parseLegalAnswer(legal, answer) {
  const res = { ops: [], dropped: [], same: [], accept: false, silent: false };
  const lg = legal && typeof legal === "object" && !Array.isArray(legal) ? legal : {};
  let a = legalPrint(answer);
  if (!a || a === "-") { res.silent = true; res.accept = true; return res; }
  if (isOk(a)) { res.accept = true; return res; }
  // «Да, все верно, но телефон: ...», «Нет, телефон: ...»: согласие и связку срезаем, дальше - правка.
  const head = okHead(a);
  a = head.rest;
  const but = a.toLowerCase().match(D10_BUT);
  if (but) a = a.slice(but[0].length);
  a = str(a.replace(D10_TAIL, ""));
  if (!a) {
    res.dropped.push({ token: legalPrint(answer), ground: but ? `после «${but[1]}» правка не названа` : "ни подтверждения, ни правки" });
    return res;
  }
  const cur = (f) => (!str(lg[f.key]) && isAbsent(lg, f.key) ? absentText(f.key) : legalPrint(lg[f.key]));
  const seen = new Set();
  for (const clause of a.split(/\s*;\s*/).map((x) => str(x)).filter(Boolean)) {
    if (isOk(clause)) continue;
    const lc = clause.toLowerCase();
    let f = null, label = "";
    for (const [key, re] of LEGAL_LABELS) {
      const m = lc.match(re);
      if (m && !/[а-яa-z0-9]/.test(lc.charAt(m[0].length))) { f = LEGAL_FIELDS.find((x) => x.key === key); label = clause.slice(0, m[0].length); break; }
    }
    if (!f) { res.dropped.push({ token: clause, ground: `нет метки поля: ${LEGAL_FIELDS.map((x) => x.label).join(", ")}` }); continue; }
    const rest = clause.slice(label.length);
    const sep = rest.match(/^\s*(:|=|-(?=\s))\s*/);
    let v = "";
    if (sep) v = str(rest.slice(sep[0].length));
    else if (str(rest) && /^\s/.test(rest) && LEGAL_KIND[f.key].test(str(rest).toLowerCase())) v = str(rest);
    else if (str(rest)) {
      const what = str(rest).split(/\s*[:=]/)[0].slice(0, 40);
      res.dropped.push({ token: clause, ground: `за меткой «${label}» идет «${what}», а не значение - поле не угадываем, пиши «${f.label}: значение»` });
      continue;
    }
    if (!v) { res.dropped.push({ token: clause, ground: "нет значения после метки" }); continue; }
    if (seen.has(f.key)) { res.dropped.push({ token: clause, ground: `поле «${f.label}» названо дважды - взято первое` }); continue; }
    seen.add(f.key);
    const was = cur(f);
    if (D10_REMOVE.test(v.replace(/[.!]+$/, ""))) {
      const now = absentText(f.key);
      if (was === now) { res.same.push(f.label); continue; }
      res.ops.push({ key: f.key, label: f.label, was, now, remove: true });
      continue;
    }
    // Точка в конце - конец фразы, а не часть номера, почты или ИНН.
    if (f.key === "phone" || f.key === "email" || f.digits) v = v.replace(/[.,!]+$/, "");
    let now = v;
    if (f.digits) {
      const d = v.replace(/[\s-]/g, "");
      if (!/^\d+$/.test(d) || !f.digits.includes(d.length)) { res.dropped.push({ token: clause, ground: `${f.label} - ровно ${f.digits.join(" или ")} цифр` }); continue; }
      now = d;
    } else {
      if (f.key === "phone" && v.replace(/\D/g, "").length < 5) { res.dropped.push({ token: clause, ground: "в телефоне меньше пяти цифр" }); continue; }
      if (f.key === "email" && !/\S@\S/.test(v)) { res.dropped.push({ token: clause, ground: "в почте нет @" }); continue; }
      now = Array.from(v).slice(0, f.max).join("");
    }
    if (now === was) { res.same.push(f.label); continue; }
    res.ops.push({ key: f.key, label: f.label, was, now, remove: false });
  }
  if (!res.ops.length && !res.dropped.length) res.accept = true;
  return res;
}
// Правка -> business.legal. «Убрать» пишет ключ в absent_fields (телефону еще и phone_absent -
// его читает старый kit), новое значение ключ оттуда снимает. Пустой legal снимается целиком:
// схема не ждет пустого объекта.
export function applyLegalOps(data, ops) {
  if (!ops.length) return;
  if (!data.business || typeof data.business !== "object") data.business = {};
  const lg = data.business.legal && typeof data.business.legal === "object" ? data.business.legal : {};
  const absent = new Set(arr(lg.absent_fields));
  for (const op of ops) {
    if (op.remove) { delete lg[op.key]; absent.add(op.key); if (op.key === "phone") lg.phone_absent = true; }
    else { lg[op.key] = op.now; absent.delete(op.key); if (op.key === "phone") delete lg.phone_absent; }
  }
  const keys = LEGAL_FIELDS.map((f) => f.key).filter((k) => absent.has(k));
  if (keys.length) lg.absent_fields = keys; else delete lg.absent_fields;
  if (Object.keys(lg).length) data.business.legal = lg; else delete data.business.legal;
}
