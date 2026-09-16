// _contract.mjs
// Одно определение общих правил контракта v8 на все скрипты этапа. До этого файла
// определение проверяемого факта, маркер снятия, разбор pages.yml, обход схемы и список
// смысловых решений гейта были переписаны в каждом скрипте дословно - и первое же
// расхождение между копиями стоило сборке контракта аудитории и оффера.
//
// Модуль ничего не печатает и никуда не пишет: он отдает функции, а отчет остается делом
// вызывающего скрипта.

import { readFileSync, existsSync } from "node:fs";

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
export const BUDGET_WARN = 15000;
export const BUDGET_MAX = 26000;
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

// Агенты конвейера v8, объявленные списком. Считать их глобом по каталогу нельзя: в
// .claude/agents лежат site-reviewer и site-scanner из v7, они делят префикс и к слою
// письма отношения не имеют. Потолок 8 при списке из 7 и означает свободное место.
export const AGENTS_V8 = [
  "site-intake", "site-market",
  "leader-mapper", "site-author", "site-strengthener", "site-judge", "site-editor"
];
export const AGENTS_V8_CAP = 8;

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
