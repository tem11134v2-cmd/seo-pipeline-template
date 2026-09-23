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

// Маркер снятия и столкновение с запретами заказчика.
const HELD = /\bnda\b|под nda|конфиденц|коммерческая тайна|не публиков|не печата|снято|снят с|снимаем/;
export function heldBack(f, forbidden) {
  const t = `${low(f && f.label)} ${low(f && f.value)} ${low(f && f.artifact)}`;
  if (HELD.test(t)) return "маркер снятия";
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

// Служебная пометка вместо факта: «не разворачиваем в этой версии», «уточним позже».
// Реальный случай IBG: ответ оператора ушел в value и чуть не доехал до страницы.
export const SERVICE_NOTE = /в этой версии|не разворачива|уточн[а-я]* (у заказчика|у клиента|позже|потом)|запрос[а-я]* (ответ|позже)|ответ позже|нет данных|данных нет|(^|[^a-z])(todo|tbd|tba)([^a-z]|$)|\?\?|\[(заполнить|уточнить|нужно)|см\. выше/i;

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
// Весь текстовый вход задачи одной строкой плюс список нетекстовых файлов (скан, pdf):
// цитату из них скрипт сверить не может и честно говорит об этом.
export function inputCorpus(taskDir) {
  const out = { text: "", files: [], binary: [] };
  const add = (p, rel) => {
    try {
      if (statSync(p).size > 5 * 1024 * 1024) { out.binary.push(rel); return; }
      const raw = readFileSync(p);
      if (BINARY_EXT.test(p) || raw.subarray(0, 8192).includes(0)) { out.binary.push(rel); return; }
      out.text += "\n" + normQuote(raw.toString("utf8").replace(/^﻿/, ""));
      out.files.push(rel);
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
  for (const n of ["answers.txt", "answers.md"]) if (existsSync(join(taskDir, n))) add(join(taskDir, n), n);
  return out;
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
// .claude/agents лежат site-reviewer и site-scanner из v7, они делят префикс и к анализу
// отношения не имеют. Слой письма и прототип ушли в /site-tekst, у анализа три агента:
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
  { key: "d3", name: "главное действие на сайте", title: "Главное действие на сайте", path: "offer.promise.cta", max: 60 },
  { key: "d4", name: "границы работы, чего не обещаем", title: "Чего не обещаем", path: "offer.limits", max: 200, list: true },
  { key: "d5", name: "тон", title: "Тон текстов", path: "offer.tone", max: 160 },
  { key: "d6", name: "цены на сайте открыты", title: "Цены на сайте", path: "business.sig", flag: "price_open",
    onText: "печатаем цены прямо на страницах", offText: "цены на сайте не печатаем" },
  { key: "d7", name: "тип сайта", title: "Тип сайта", path: "business.site_kind",
    choice: { landing: "делаем одну страницу, весь смысл на ней", multipage: "делаем многостраничный сайт под поиск" },
    words: { landing: /ленд|одна страниц|однострани|одностраничн/i, multipage: /многостран|под поиск|поисков|сео|seo/i } },
  { key: "d8", name: "что продаем", title: "Что продаем", path: "business.type",
    choice: { services: "продаете услуги", shop: "продаете товары из каталога", both: "продаете и товары, и услуги" },
    words: { both: /и то и другое|оба|both|товары и услуги|услуги и товары/i, shop: /магаз|товар|каталог|номенклат|shop/i, services: /услуг|работ|сервис|services/i } }
];

const YES = /^(да|ага|yes|y|1|ок|ok|открыт|открыты|открыто|показываем|публикуем|пишем)/i;
const NO = /^(нет|no|n|0|закрыт|закрыто|скрываем|не показываем|не публикуем|не пишем)/i;

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

// Ответ листа -> поле контракта. null означает «ответ не разобран», и это идет в дифф-лист
// отдельной строкой, а не молча в поле.
export function writeDecision(data, d, answer) {
  const a = str(answer);
  if (d.flag) {
    const sig = arr(getPath(data, d.path)).slice();
    const on = YES.test(a) ? true : NO.test(a) ? false : null;
    if (on === null) return null;
    const i = sig.indexOf(d.flag);
    if (on && i === -1) sig.push(d.flag);
    if (!on && i !== -1) sig.splice(i, 1);
    setPath(data, d.path, sig);
    return on ? "да" : "нет";
  }
  if (d.choice) {
    let hit = Object.keys(d.choice).find((k) => k === a.toLowerCase());
    if (!hit) hit = Object.keys(d.words || {}).find((k) => d.words[k].test(a));
    if (!hit) return null;
    setPath(data, d.path, hit);
    return hit;
  }
  if (d.list) {
    const items = a.split(/\s*;\s*/).map((s) => str(s)).filter(Boolean).map((s) => s.slice(0, d.max)).slice(0, 8);
    if (!items.length) return null;
    setPath(data, d.path, items);
    return items.join("; ");
  }
  const v = a.slice(0, d.max);
  if (!v) return null;
  setPath(data, d.path, v);
  return v;
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
// Копия infoType и mapType из import-structure.mjs: проверяем то, что увидит импорт.
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
const TEMPLATE_RE = /шаблон|-slug\b|\{[a-z_]+\}/;
const HUB_ROLE = /навигац|обзор/;
const HUB_NAME = /\(хаб\)|(^|\s)хаб(\s|$)/i;
export const LEGAL_URL = /privacy|policy|terms|agreement|oferta|soglashenie|politika|favorites|izbrannoe|cookie/i;
export function importType(p) {
  const t = low(p.type), role = low(p.role), name = low(p.name), url = str(p.url);
  if (t.includes("главн") || url === "/" || /^\/[a-z]{2}\/?$/.test(url)) return "home";
  if (t.includes("статья") || t.includes("блог")) return null;
  if (TEMPLATE_RE.test(`${name} ${url}`)) return "product";
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
    const tmpl = TEMPLATE_RE.test(`${low(name)} ${url}`);
    if (type === "Главная" && url !== "/") V.push(`${at}: главная живет по адресу /`);
    if (url === "/" && type !== "Главная") V.push(`${at}: адрес / у страницы типа «${type}» - это главная`);
    if (tmpl && type !== "Товар") V.push(`${at}: «шаблон» или {slug} у типа «${type}» - импорт сделает из нее шаблон карточки`);
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
    if (LEGAL_URL.test(url)) W.push(`${at}: служебная страница - импорт пометит ее skip, в составе без SEO она лишняя`);
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
  return { V, W, stat };
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
