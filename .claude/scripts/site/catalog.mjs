#!/usr/bin/env node
// catalog.mjs
// Режим магазина: один скрипт с подкомандами на весь каталожный тракт. Скрипт САМ В СЕТЬ
// НЕ ХОДИТ и process.env не читает: прайс лежит на диске, топ-10 снимают MCP-инструменты
// агента, сюда приезжает уже снятое.
//
//   node catalog.mjs ingest <слаг|каталог> [--price <файл>] [--sheet <N>] [--attrs a,b,c] [--refresh]
//   node catalog.mjs tree   <слаг|каталог> [--refresh]
//   node catalog.mjs mode   <слаг|каталог>
//
// Порядок жесткий: ingest выносит вердикт данным, tree собирает дерево, оси и посадки,
// mode ставит режим категории по снятому топ-10. Между tree и mode работает агент: маркеры
// узлов появляются только после дерева, а без маркера мерить нечего.
//
// ПЕРВЫЙ ШАГ РЕЖИМА - ingest, и он же самый дешевый способ не написать фикцию. ТЗ каталога
// без товарных данных описывает фильтры, которые нельзя построить: фильтр - это проекция
// атрибутов, и если в прайсе только название и цена, фильтровать не по чему. Поэтому
// ingest выносит машинный ВЕРДИКТ готовности данных, и весь объем режима считается от
// него, а не от щедрости оператора:
//   attributes_ready         - атрибутов хватает на оси фильтра;
//   derivable_from_name      - атрибуты вытаскиваются из названий разбором;
//   must_request_from_client - нужен запрос характеристик, режим сокращается;
//   impossible               - только название и цена, фасетов не будет вовсе.
// При двух последних на диск ложится ask-attributes.csv - шаблон, который заполняет
// заказчик. Это единственная честная реакция: притворяться, что фасет возможен, нельзя.
//
// Файл устроен разделами, и швы названы: подкоманды tree и mode дописываются В ЭТОТ ЖЕ
// ФАЙЛ следующими шагами режима. Второго каталожного скрипта не заводится - бюджет
// скриптов 20, и он считается.
//
// Exit: 0 сделано | 2 отказ (нет проекта, не тот business.type, нечего читать).

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve, extname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";
import { today, arr, str, low, validate, B } from "./_contract.mjs";
import { repoRoot, findDir, plain } from "./queue.mjs";

const die = (msg) => { console.error("[catalog] " + msg); process.exit(2); };

// ───────────────────────────────────────────────── 0. Константы режима
// Все пороги режима лежат ЗДЕСЬ и печатаются в отчете: решение о фасетах должно
// проверяться глазом, а не приниматься на глаз.

// Порог публикации оси: атрибут заполнен не меньше чем у 70 процентов SKU категории.
// Ниже порога ось уходит в blocked_by_data со строкой «заполнено X процентов из 70».
export const AXIS_FILL_MIN = 0.7;
// Для ВЕРДИКТА атрибутивной считается колонка, заполненная не реже чем у каждой пятой
// позиции. Ниже этого - заметка менеджера, а не характеристика. Порог намеренно низкий и
// не равен порогу оси: недозаполненная колонка «Материал» это повод запросить
// характеристики, а не повод объявить, что их не существует.
export const ATTR_FILL_MIN = 0.2;
// Доля уникальных значений, выше которой колонка перестает быть осью: если значение
// у каждой позиции свое, это название, артикул или описание, а не фильтр.
export const ATTR_UNIQ_MAX = 0.6;
// Средняя длина значения, выше которой колонка считается описанием, а не атрибутом.
export const ATTR_LEN_MAX = 80;
// Разбор названий: с какой доли позиций он считается рабочим и с какой - хоть каким-то.
export const DERIVE_OK = 0.6;
export const DERIVE_SOME = 0.2;
// attributes_ready требует и числа годных осей, и охвата категорий: две оси на одной
// категории из сорока это не готовый каталог, а одна готовая категория.
export const AXES_READY_MIN = 2;
export const CATS_READY_SHARE = 0.5;
// Потолок строк в запросе характеристик: заказчику отдают заполняемый файл, а не выгрузку.
export const ASK_ROWS_MAX = 5000;
// Сколько первых строк смотрит поиск шапки и определение разделителя.
export const HEAD_SCAN = 10;

export const VERDICTS = ["attributes_ready", "derivable_from_name", "must_request_from_client", "impossible"];
export const ROLES = ["sku", "name", "price", "category", "brand", "attr", "photo", "stock", "unit", "skip"];

// Словарь шапки прайса. Порядок проверки важен: «код товара» это артикул, а не атрибут.
const ROLE_WORDS = [
  ["sku", /артикул|арт\.|код\s*товар|код\s*ном|^код$|sku|vendor\s*code|парт/i],
  ["name", /наимен|назван|товар(?!н)|позици|product|name|модель\s*товара/i],
  ["price", /цена|стоим|price|прайс|руб(?![а-я]*\s*м)/i],
  ["category", /раздел|категор|групп|подгруп|тип\s*товара|category|коллекц/i],
  ["brand", /бренд|производ|марка|торгов[а-я]*\s*марк|brand|vendor|изготовит/i],
  ["photo", /фото|изображ|картинк|image|photo|ссылк[а-я]*\s*на\s*изобр/i],
  ["stock", /остат|наличи|склад|кол-?во|количеств|запас|stock|qty|quantity/i],
  ["unit", /ед\.?\s*изм|единиц[а-я]*\s*измер|^ед\.?$|unit/i],
  ["skip", /описан|коммент|примечан|заметк|description|url|ссылк|штрих|ean|nds|ндс/i]
];

// Канонические имена атрибутов: одно имя на весь конвейер, иначе «Цвет», «цвет корпуса»
// и «Color» станут тремя разными осями и ни одна не наберет порога.
const ATTR_CANON = [
  ["brand", /бренд|производ|марка|brand|vendor/i], ["model", /модель|model/i],
  ["color", /цвет|окрас|color/i], ["material", /материал|сырье|material/i],
  ["power", /мощност|power|вт(?![а-я])/i], ["voltage", /напряж|вольт|voltage/i],
  ["diameter", /диаметр|днуc|ду(?![а-я])|dn(?![a-z])|diameter/i],
  ["length", /длина|длинна|length/i], ["width", /ширин|width/i], ["height", /высот|height/i],
  ["depth", /глубин|depth/i], ["weight", /вес|масса|weight/i], ["volume", /объем|литраж|volume/i],
  ["size", /размер|габарит|size/i], ["country", /стран|производств[а-я]*\s*стран|country/i],
  ["warranty", /гарант|warranty/i], ["type", /^тип|вид(?!ео)|type/i],
  ["purpose", /назначен|применен|purpose/i], ["series", /сери|линейк|series/i]
];

const TRANSLIT = { а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "c", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya" };
const attrId = (s) => {
  const t = plain(s).toLowerCase().split("").map((c) => (TRANSLIT[c] !== undefined ? TRANSLIT[c] : c)).join("");
  const id = t.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 32);
  return /^[a-z]/.test(id) ? id : ("a_" + id).slice(0, 32);
};

// ───────────────────────────────────────────────── 1. Таблица на входе
// Форматы прайса: csv, tsv и xlsx. xlsx разбирается встроенным zip плюс xml - тем же
// приемом, что в наборах тестов репозитория. Внешних зависимостей у режима нет: прайс
// приходит от заказчика раз в проект, а npm-пакет живет в репозитории вечно.

const decodeXml = (s) => String(s)
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#([0-9]+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
  .replace(/&amp;/g, "&");

// Одна запись из центрального каталога zip. ZIP64 тут не нужен: прайс на 500 позиций
// весит сотни килобайт, а не гигабайты.
export function zipEntry(buf, name) {
  let eocd = -1;
  const floor = Math.max(0, buf.length - 22 - 65535);
  for (let i = buf.length - 22; i >= floor; i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("не найден конец zip-каталога: это не xlsx");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("битая запись каталога zip");
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28), elen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const lho = buf.readUInt32LE(p + 42);
    if (buf.toString("utf8", p + 46, p + 46 + nlen) === name) {
      if (buf.readUInt32LE(lho) !== 0x04034b50) throw new Error("битый локальный заголовок zip");
      const start = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
      const data = buf.subarray(start, start + csize);
      if (method === 0) return data;
      if (method === 8) return inflateRawSync(data);
      throw new Error(`неизвестный метод сжатия zip: ${method}`);
    }
    p += 46 + nlen + elen + clen;
  }
  throw new Error(`в xlsx нет записи ${name}`);
}

const colOf = (ref) => {
  let n = 0;
  for (const ch of String(ref).replace(/[^A-Z]/g, "")) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

export function readXlsx(file, sheetIdx = 0, sheetName = "") {
  const buf = readFileSync(file);
  const wb = zipEntry(buf, "xl/workbook.xml").toString("utf8");
  const sheets = [...wb.matchAll(/<sheet[^>]*name="([^"]*)"[^>]*r:id="([^"]*)"[^>]*\/>/g)]
    .map((m) => ({ name: decodeXml(m[1]), rid: m[2] }));
  if (!sheets.length) throw new Error("в книге нет ни одного листа");
  const rels = zipEntry(buf, "xl/_rels/workbook.xml.rels").toString("utf8");
  const relMap = new Map([...rels.matchAll(/<Relationship[^>]*Id="([^"]*)"[^>]*Target="([^"]*)"/g)]
    .map((m) => [m[1], m[2].replace(/^\/?xl\//, "").replace(/^\//, "")]));
  // Имя листа сильнее номера: tree перечитывает тот же прайс по attr_map, а там
  // записано ИМЯ листа. Номер остается запасным путем для ingest.
  const byName = sheetName ? sheets.findIndex((x) => x.name === sheetName) : -1;
  const pick = sheets[byName >= 0 ? byName : Math.min(Math.max(0, sheetIdx), sheets.length - 1)];
  const target = relMap.get(pick.rid) || `worksheets/sheet${sheets.indexOf(pick) + 1}.xml`;

  let shared = [];
  try {
    const ss = zipEntry(buf, "xl/sharedStrings.xml").toString("utf8");
    shared = [...ss.matchAll(/<si>([\s\S]*?)<\/si>/g)]
      .map((m) => decodeXml((m[1].match(/<t[^>]*>([\s\S]*?)<\/t>/g) || []).map((t) => t.replace(/<[^>]+>/g, "")).join("")));
  } catch { shared = []; }

  const xml = zipEntry(buf, "xl/" + target).toString("utf8");
  const rows = [];
  // Excel печатает ПУСТУЮ ячейку со стилем самозакрывающимся тегом `<c r="D2" s="3"/>`, а
  // пустую строку - как `<row r="5"/>`. Регулярка, знающая только парный тег, принимает
  // такой `<c .../>` за ОТКРЫВАЮЩИЙ и берет телом содержимое следующей ячейки: вся строка
  // съезжает влево, и цена уезжает в колонку бренда - молча, без единой строки отказа.
  // Поэтому обе формы разбираются альтернативой, и самозакрытая ячейка дает пустое
  // значение, а не чужое.
  for (const rm of xml.matchAll(/<row\b([^>]*?)\/>|<row\b([^>]*?)>([\s\S]*?)<\/row>/g)) {
    const cells = [];
    for (const cm of (rm[3] === undefined ? "" : rm[3]).matchAll(/<c\b([^>]*?)\/>|<c\b([^>]*?)>([\s\S]*?)<\/c>/g)) {
      const at = cm[1] === undefined ? (cm[2] || "") : cm[1];
      const body = cm[3] === undefined ? "" : cm[3];
      const i = colOf((at.match(/r="([A-Z]+)/) || [, "A"])[1]);
      const t = (at.match(/t="([^"]+)"/) || [, ""])[1];
      let v = "";
      if (t === "s") v = shared[Number((body.match(/<v>([\s\S]*?)<\/v>/) || [, "-1"])[1])] || "";
      else if (t === "inlineStr") v = decodeXml((body.match(/<t[^>]*>([\s\S]*?)<\/t>/) || [, ""])[1]);
      else v = decodeXml((body.match(/<v>([\s\S]*?)<\/v>/) || [, ""])[1]);
      cells[i] = plain(v);
    }
    for (let i = 0; i < cells.length; i++) if (cells[i] === undefined) cells[i] = "";
    rows.push(cells);
  }
  return { rows, sheet: pick.name, delim: "" };
}

// Разделитель не спрашивается у оператора: он считается по первым строкам. Точка с
// запятой в русской выгрузке из 1С встречается чаще запятой, но угадывать не надо -
// побеждает тот, кто дает одинаковое число колонок на всех строках разведки.
export function sniffDelim(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, HEAD_SCAN);
  let best = ";", bestScore = -1;
  for (const d of [";", "\t", ",", "|"]) {
    const counts = lines.map((l) => l.split(d).length);
    const max = Math.max(...counts, 1);
    if (max < 2) continue;
    const same = counts.filter((c) => c === max).length;
    const score = max * 10 + same;
    if (score > bestScore) { bestScore = score; best = d; }
  }
  return best;
}

export function parseCsv(text, delim) {
  const rows = [];
  let row = [], cell = "", q = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
      continue;
    }
    if (c === '"') { q = true; continue; }
    if (c === delim) { row.push(plain(cell)); cell = ""; continue; }
    if (c === "\n") { row.push(plain(cell)); rows.push(row); row = []; cell = ""; continue; }
    if (c === "\r") continue;
    cell += c;
  }
  if (cell || row.length) { row.push(plain(cell)); rows.push(row); }
  return rows.filter((r) => r.some((x) => x !== ""));
}

export function readTable(file, sheetIdx = 0, sheetName = "") {
  const ext = extname(file).toLowerCase();
  if (ext === ".xlsx" || ext === ".xlsm") return readXlsx(file, sheetIdx, sheetName);
  const text = readFileSync(file, "utf8");
  const delim = ext === ".tsv" ? "\t" : sniffDelim(text);
  return { rows: parseCsv(text, delim), sheet: "", delim };
}

// Шапка ищется, а не назначается первой строкой: в половине присланных прайсов сверху
// стоит название фирмы и дата, а колонки начинаются со второй или третьей строки.
export function findHeader(rows) {
  const filled = (r) => arr(r).filter((c) => str(c) !== "").length;
  let best = 0, bestN = -1;
  for (let i = 0; i < Math.min(rows.length, HEAD_SCAN); i++) {
    const n = filled(rows[i]);
    if (n < 2) continue;
    const next = filled(rows[i + 1] || []);
    if (next < 2) continue;
    if (n > bestN) { bestN = n; best = i; }
  }
  return bestN < 0 ? 0 : best;
}

// ───────────────────────────────────────────────── 2. Роли колонок
// Роль колонки определяется словарем шапки, а спорное решается содержимым: колонка без
// имени, но с ценами в каждой строке, это цена.

const isNum = (v) => /^-?\d[\d\s.,]*$/.test(str(v)) && /\d/.test(str(v));
const BOOL_WORDS = /^(да|нет|есть|yes|no|true|false|\+|-)$/i;

export function sniffRoles(header, body) {
  const cols = [];
  for (let i = 0; i < header.length; i++) {
    const title = plain(header[i]);
    const vals = body.map((r) => str(r[i])).filter((v) => v !== "");
    const filled = body.length ? vals.length / body.length : 0;
    const uniq = vals.length ? new Set(vals.map(low)).size / vals.length : 0;
    const avgLen = vals.length ? vals.reduce((s, v) => s + Array.from(v).length, 0) / vals.length : 0;
    const numShare = vals.length ? vals.filter(isNum).length / vals.length : 0;

    let role = "";
    for (const [r, re] of ROLE_WORDS) if (re.test(title)) { role = r; break; }
    if (!role && !title && numShare > 0.8 && filled > 0.8) role = "price";
    if (!role) {
      // Числовая колонка остается атрибутом при любой уникальности: у мощности и
      // диаметра значение почти у каждой позиции свое, и порог уникальности выбросил бы
      // ровно те оси, ради которых фасет и делают. Уникальность сторожит текст.
      const textLike = avgLen > ATTR_LEN_MAX;
      const idLike = uniq > ATTR_UNIQ_MAX && numShare <= 0.8;
      role = textLike || idLike ? "skip" : "attr";
    }
    let attr = "";
    if (role === "attr" || role === "brand") {
      attr = role === "brand" ? "brand" : (ATTR_CANON.find(([, re]) => re.test(title)) || [""])[0] || attrId(title || ("col" + (i + 1)));
    }
    const kind = numShare > 0.8 ? "range" : (vals.every((v) => BOOL_WORDS.test(v)) && vals.length ? "bool" : "enum");
    cols.push({ i, col: title, role, attr, kind: role === "attr" || role === "brand" ? kind : "", filled: round2(filled), uniq: round2(uniq) });
  }
  // Имя атрибута уникально: две колонки «Цвет» и «Цвет корпуса» не сливаются в одну ось.
  const taken = new Set();
  for (const c of cols) {
    if (!c.attr) continue;
    let a = c.attr, k = 2;
    while (taken.has(a)) a = `${c.attr}_${k++}`.slice(0, 32);
    taken.add(a); c.attr = a;
  }
  return cols;
}

const round2 = (x) => Math.round(x * 100) / 100;
const pickCol = (cols, role) => cols.find((c) => c.role === role) || null;

// ───────────────────────────────────────────────── 3. Заполненность по категориям
// Порог оси считается ПО КАТЕГОРИИ, а не по прайсу целиком: атрибут «диаметр» заполнен
// у всех труб и ни у одного насоса, и среднее по больнице спрячет и то, и другое.

export function fillByCat(body, cols) {
  const cat = pickCol(cols, "category");
  const attrs = cols.filter((c) => c.role === "attr" || c.role === "brand");
  const buckets = new Map();
  for (const r of body) {
    const key = cat ? (str(r[cat.i]) || "без раздела") : "весь прайс";
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(r);
  }
  const out = [];
  for (const [key, rows] of buckets) {
    for (const a of attrs) {
      const n = rows.filter((r) => str(r[a.i]) !== "").length;
      out.push({ cat: key, attr: a.attr, label: a.col, kind: a.kind, sku: rows.length, filled: round2(rows.length ? n / rows.length : 0) });
    }
  }
  out.sort((x, y) => x.cat.localeCompare(y.cat) || x.attr.localeCompare(y.attr));
  return out;
}

// ───────────────────────────────────────────────── 4. Вердикт готовности
// Вердикт машинный. Разбор названий - не обещание, а замер: доля позиций, из названия
// которых вытаскивается хотя бы один атрибут.

const DERIVE_PATTERNS = [
  /\d+([.,]\d+)?\s?(мм|см|дюйм|кг|гр?|мл|л|вт|квт|вольт|в|а|бар|об\/мин|шт)(?![а-я])/i,
  /\d+\s?[xх*]\s?\d+/i,
  /\b(dn|ду|ру|pn|м)\s?\d+/i,
  /\b[a-z]{2,}[- ]?\d+[a-z0-9-]*\b/i
];

export function deriveShare(names) {
  if (!names.length) return 0;
  const brands = new Map();
  for (const n of names) {
    const m = str(n).match(/\b[A-Za-z][A-Za-z&-]{2,}\b/);
    if (m) brands.set(low(m[0]), (brands.get(low(m[0])) || 0) + 1);
  }
  const brandOk = new Set([...brands.entries()].filter(([, c]) => c >= 3).map(([b]) => b));
  let hit = 0;
  for (const n of names) {
    const s = str(n);
    const m = s.match(/\b[A-Za-z][A-Za-z&-]{2,}\b/);
    if ((m && brandOk.has(low(m[0]))) || DERIVE_PATTERNS.some((re) => re.test(s))) hit++;
  }
  return round2(hit / names.length);
}

// Лестница вердикта. Порядок проверок и есть определение: первое сработавшее условие
// и дает вердикт, четвертого исхода нет.
export function verdictOf({ attrCols, fill, cats, derive }) {
  const axes = new Set(fill.filter((f) => f.filled >= AXIS_FILL_MIN).map((f) => f.attr));
  const catsWithAxis = new Set(fill.filter((f) => f.filled >= AXIS_FILL_MIN).map((f) => f.cat));
  const share = cats ? catsWithAxis.size / cats : 0;
  if (axes.size >= AXES_READY_MIN && share >= CATS_READY_SHARE) return { verdict: "attributes_ready", axes: [...axes], share: round2(share) };
  if (derive >= DERIVE_OK) return { verdict: "derivable_from_name", axes: [...axes], share: round2(share) };
  if (attrCols >= 1 || derive >= DERIVE_SOME) return { verdict: "must_request_from_client", axes: [...axes], share: round2(share) };
  return { verdict: "impossible", axes: [...axes], share: round2(share) };
}

// Что меняется от вердикта. Одна таблица на весь режим: ее печатает отчет ingest, ее же
// читает ТЗ, и разойтись им негде.
export const VERDICT_EFFECT = {
  attributes_ready: "полный режим: оси по порогу 70 процентов, посадки, ТЗ целиком",
  derivable_from_name: "оси и посадки только по колонкам прайса, прошедшим порог; атрибуты из названий разбирает товарный конвейер и кладет в КАРТОЧКУ, осью фильтра они не становятся; уходит ask-attributes.csv, значения подтверждает заказчик",
  must_request_from_client: "фасетов и посадок в ТЗ нет, уходит ask-attributes.csv, товары идут тирами B и C",
  impossible: "фасетов не будет вовсе: дерево, листинг, сортировка и карточка без характеристик, плюс ask-attributes.csv"
};

// ───────────────────────────────────────────────── 5. Запрос характеристик заказчику
// Отдается заполняемый файл, а не просьба «пришлите характеристики». Разделитель точка с
// запятой и BOM: так Excel открывает русский csv колонками, а не одной строкой.

export function askRows(body, cols, max = ASK_ROWS_MAX) {
  const cat = pickCol(cols, "category");
  if (body.length <= max) return body;
  const buckets = new Map();
  for (const r of body) {
    const k = cat ? (str(r[cat.i]) || "без раздела") : "весь прайс";
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(r);
  }
  // Круговой отбор по разделам: срез из первых 5000 строк выгрузки дал бы заказчику
  // три раздела из сорока и вердикт, который ничего не меняет.
  const keys = [...buckets.keys()].sort(), out = [];
  for (let i = 0; out.length < max; i++) {
    let moved = false;
    for (const k of keys) {
      const b = buckets.get(k);
      if (i < b.length) { out.push(b[i]); moved = true; if (out.length >= max) break; }
    }
    if (!moved) break;
  }
  return out;
}

export function askTemplate(body, cols, extra) {
  const sku = pickCol(cols, "sku"), name = pickCol(cols, "name"), cat = pickCol(cols, "category");
  // Колонки под характеристики: слабо заполненные атрибутивные колонки прайса плюс те,
  // что назвал агент флагом --attrs. Своих ниша-атрибутов скрипт не выдумывает.
  const weak = cols.filter((c) => (c.role === "attr" || c.role === "brand") && c.filled < AXIS_FILL_MIN).map((c) => c.col || c.attr);
  const head = ["Артикул", "Наименование", "Раздел", ...uniq([...weak, ...arr(extra).map(plain)]).filter(Boolean)];
  const rows = askRows(body, cols).map((r) => {
    const line = [sku ? str(r[sku.i]) : "", name ? str(r[name.i]) : "", cat ? str(r[cat.i]) : ""];
    while (line.length < head.length) line.push("");
    return line;
  });
  const esc = (v) => (/[";\n]/.test(v) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v));
  return "﻿" + [head, ...rows].map((r) => r.map(esc).join(";")).join("\r\n") + "\r\n";
}

const uniq = (a) => [...new Set(arr(a))];
// Путь внутри проекта пишется одним видом на обеих системах: контракт читают и люди.
const rel = (dir, file) => resolve(file).slice(resolve(dir).length).replace(/^[\\/]+/, "").replace(/\\/g, "/") || basename(file);

// ───────────────────────────────────────────────── 6. Подкоманда ingest

function loadProject(dir) {
  const f = join(dir, "project.json");
  if (!existsSync(f)) die(`в ${dir} нет project.json: режим магазина включается после гейта /site analiz`);
  try { return JSON.parse(readFileSync(f, "utf8")); } catch (e) { die(`project.json не читается: ${e.message}`); }
}

const PRICE_EXT = [".csv", ".tsv", ".xlsx", ".xlsm", ".txt"];
function findPrice(dir, flag) {
  if (flag && flag !== true) {
    const p = resolve(String(flag));
    return existsSync(p) ? p : die(`прайса нет по адресу ${p}`);
  }
  for (const sub of ["price", "prices", "."]) {
    const d = join(dir, sub);
    if (!existsSync(d)) continue;
    const hit = readdirSync(d)
      .filter((n) => PRICE_EXT.includes(extname(n).toLowerCase()) && statSync(join(d, n)).isFile() && !/^ask-attributes/.test(n))
      .sort();
    if (hit.length) return join(d, hit[0]);
  }
  return die(`прайса не найдено: положите csv, tsv либо xlsx в ${join(dir, "price")} или укажите --price <файл>`);
}

function cmdIngest(pos, flags, root) {
  const dir = findDir(pos[0], root);
  if (!dir) die("проект не найден: укажите слаг либо каталог sites/NNN-slug");
  const project = loadProject(dir);
  const type = str(project.business && project.business.type);
  if (type !== "shop" && type !== "both") {
    die(`business.type = ${type || "не задан"}: режим магазина включают только shop и both, и переключатель ровно один`);
  }
  const out = join(dir, "attr_map.json");
  if (existsSync(out) && !flags.refresh) {
    console.log(`[catalog] attr_map.json уже записан и заморожен, пропуск (--refresh перепишет): ${out}`);
    return 0;
  }

  const file = findPrice(dir, flags.price);
  const sheetIdx = flags.sheet && flags.sheet !== true ? Math.max(0, parseInt(flags.sheet, 10) - 1) : 0;
  let table;
  try { table = readTable(file, sheetIdx); } catch (e) { die(`прайс ${basename(file)} не разобран: ${e.message}`); }
  if (table.rows.length < 2) die(`в прайсе ${basename(file)} нет данных: строк ${table.rows.length}`);

  const h = findHeader(table.rows);
  const header = table.rows[h];
  const body = table.rows.slice(h + 1).filter((r) => r.some((c) => str(c) !== ""));
  if (!body.length) die("под шапкой прайса нет ни одной строки");

  const cols = sniffRoles(header, body);
  const nameCol = pickCol(cols, "name");
  const catCol = pickCol(cols, "category");
  const attrAll = cols.filter((c) => c.role === "attr" || c.role === "brand");
  const attrCols = attrAll.filter((c) => c.filled >= ATTR_FILL_MIN);
  const fill = fillByCat(body, cols);
  const cats = new Set(fill.map((f) => f.cat)).size || 1;
  const derive = deriveShare(nameCol ? body.map((r) => str(r[nameCol.i])) : []);
  const v = verdictOf({ attrCols: attrCols.length, fill, cats, derive });

  // Запрос характеристик уходит и при derivable_from_name: осью разбор названия не
  // становится (фильтр строится по колонке прайса, а не по догадке из строки), значит
  // разговор с заказчиком нужен ровно так же, как при двух нижних вердиктах. Без этого
  // проект с атрибутами в названиях получал молча худший исход - ни осей, ни письма
  // заказчику.
  const needAsk = v.verdict !== "attributes_ready";
  const askFile = needAsk ? "ask-attributes.csv" : "";
  if (needAsk) {
    const extra = flags.attrs && flags.attrs !== true ? String(flags.attrs).split(",").map((s) => s.trim()).filter(Boolean) : [];
    writeFileSync(join(dir, askFile), askTemplate(body, cols, extra), "utf8");
  }

  const map = {
    v: 1,
    slug: str(project.slug),
    at: today(),
    price: { file: rel(dir, file), sheet: table.sheet, delim: table.delim, rows: body.length, header_row: h + 1 },
    cols: cols.map((c) => ({ col: c.col, i: c.i, role: c.role, attr: c.attr, kind: c.kind, filled: c.filled, uniq: c.uniq })),
    fill,
    derive,
    verdict: v.verdict,
    ask: askFile
  };
  writeFileSync(out, JSON.stringify(map, null, 2) + "\n", "utf8");

  // Отчет. Числа те же, что в файле: вердикт должен проверяться глазом за минуту.
  console.log(`[catalog] прайс ${basename(file)}${table.sheet ? ` лист «${table.sheet}»` : ""}: строк ${body.length}, шапка в строке ${h + 1}, колонок ${cols.length}`);
  console.log(`  роли: ${["sku", "name", "price", "category"].map((r) => `${r} ${pickCol(cols, r) ? "есть" : "НЕТ"}`).join(", ")}, атрибутивных колонок ${attrCols.length} из ${attrAll.length} найденных`);
  console.log(`  разделов ${cats}, осей выше порога ${Math.round(AXIS_FILL_MIN * 100)} процентов: ${v.axes.length ? v.axes.join(", ") : "ни одной"}; разделов с осью ${Math.round(v.share * 100)} процентов`);
  console.log(`  разбор названий дает атрибут у ${Math.round(derive * 100)} процентов позиций`);
  console.log(`  ВЕРДИКТ: ${v.verdict} - ${VERDICT_EFFECT[v.verdict]}`);
  const low70 = fill.filter((f) => f.filled < AXIS_FILL_MIN).sort((a, b) => b.filled - a.filled).slice(0, 6);
  for (const f of low70) console.log(`  ось не публикуется: ${f.cat} / ${f.attr} - заполнено ${Math.round(f.filled * 100)} процентов из ${Math.round(AXIS_FILL_MIN * 100)}`);
  if (askFile) console.log(`  запрос характеристик заказчику: ${join(dir, askFile)} - без него фасетов в ТЗ не будет`);
  if (!catCol) console.log("  ВНИМАНИЕ: колонки раздела в прайсе нет - заполненность считалась по всему прайсу, дерево придет из брифа и от конкурентов");
  console.log(`[catalog] записано: ${out}`);
  return 0;
}

// ───────────────────────────────────────────────── 7. Подкоманда tree
// Дерево, оси, посадки. Единица объема тут НЕ категория: трафик магазина приходит на
// посадки («насосы Grundfos», «мойки нержавеющая сталь»), и каждой нужны свои H1, Title,
// Description и интро, иначе это дубль категории и он не ранжируется. Сорок категорий по
// пять посадок дают двести единиц письма - больше, чем у сайта услуг на 26 страниц, просто
// каждая мельче. Поэтому объем и цена считаются по counts.landings, и скрипт печатает это
// отдельной строкой.
//
// Что читает:
//   project.json        - business.assortment, business.directions, business.region;
//   attr_map.json       - колонки прайса, роли, kind, вердикт (порог оси тот же, 0.7);
//   прайс               - перечитывается по attr_map.price: значения осей и счет позиций;
//   platform.json       - анкета платформы из девяти ответов, unknown работает как no;
//   catalog-rules.yml   - ПРАВИЛА агента catalog-architect: падежные формы, формулы
//                         Title и H1, наборы полей карточки, узлы от конкурентов;
//   catalog-serp.json   - снимок агента: частоты (ws) и топ-10 по узлам (его же читает mode).
// Пишет catalog.json по catalog.schema.json и ничего больше.

export const TREE_DEPTH_MAX = 3;
export const NODES_MAX = 400;
export const LANDINGS_MAX = 600;
export const LANDINGS_PER_NODE = 12;
export const VALUES_MAX = 40;
export const VALUE_LEN_MAX = 60;
export const FACETS_MAX = 8;
export const SPECS_MAX = 25;
export const SPECS_MIN = 8;
// Посадка на одну позицию - не страница, а ошибка выгрузки: два SKU это пол.
export const LANDING_SKU_MIN = 2;
// Индексируемая комбинация требует И спроса, И позиций. Оба числа проверяемые: спрос
// приходит замером агента, позиции считаются по прайсу. Неизвестный спрос - это ноль,
// и посадка закрывается, а не индексируется «на всякий случай».
export const LANDING_INDEX_SKU = 4;
export const LANDING_INDEX_DEMAND = 30;
// Доля непустых ячеек оси, в которых стоит несколько значений через разделитель. Выше
// порога ось мультизначная, и без multi_select платформы фильтр по ней не собирается.
export const MULTI_SHARE = 0.2;
// Тир A - топ по спросу или списку клиента, и это ТРИДЦАТЬ позиций на весь каталог, а не
// на каждый узел: писателя на пятьсот карточек не бывает.
export const TIER_A_MAX = 30;
export const BLOCKED_MAX = 200;

const SRC_RANK = { price: 0, brief: 1, competitors: 2 };
const CAN = (x) => str(x) === "yes";

// Разделители пути в ячейке раздела: «Насосы / Циркуляционные» и «Насосы > Цирк.» это одно
// дерево из двух уровней, а не два разных раздела.
const PATH_SPLIT = /\s*(?:[\\/>|]|=>|->)+\s*/;
export const catPath = (cell) =>
  plain(cell).split(PATH_SPLIT).map((s) => plain(s)).filter(Boolean).slice(0, TREE_DEPTH_MAX);

// Несколько значений в одной ячейке. Запятая режет только с пробелом после нее: «1,5 кВт»
// это одно значение, «красный, синий» - два.
const splitVals = (v) => plain(v).split(/\s*[;/]\s*|,\s+/).map((x) => plain(x).replace(/[.,;]+$/, "")).filter(Boolean);
const isMultiCell = (v) => /[;/]|,\s/.test(plain(v));

export const slugOf = (s, max = 40) => {
  const t = plain(s).toLowerCase().split("").map((c) => (TRANSLIT[c] !== undefined ? TRANSLIT[c] : c)).join("");
  let id = t.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, max).replace(/-+$/, "");
  if (!/^[a-z0-9]/.test(id)) id = ("n-" + id).slice(0, max).replace(/-+$/, "");
  return id || "n";
};

// ---------------------------------------------------------------- имя узла и падежи
// Прайс из 1С пишет раздел так, как его завели в учете: «Насосы циркуляционные», с большой
// буквы и обратным порядком слов. В первой же строке ТЗ это дает «Цены на Насосы
// циркуляционные». Порядок слов и регистр чинятся машинно, падежи - нет.
const ADJ_TAIL = /(ые|ие|ый|ий|ой|ая|яя|ое|ее)$/;
// Одно и то же в прайсе и в брифе написано по-разному: «Насосы/Циркуляционные» против
// «Насосы циркуляционные». Сопоставляются не строки, а множества слов, обрезанных до пяти
// знаков: русское окончание в пять знаков не укладывается, а корень укладывается.
export const wordKey = (s) => plain(s).toLowerCase().split(/[^а-яa-z0-9]+/i)
  .filter((w) => w.length > 2).map((w) => w.slice(0, 5)).sort().join("|");

export function normalName(raw) {
  let s = plain(raw).replace(/^[\s"'«»,.;:-]+/, "").replace(/[\s"'«»,.;:]+$/, "");
  // Строчная буква ставится ДО перестановки слов: иначе «Насосы циркуляционные» дает
  // «циркуляционные Насосы» - заглавная переезжает в середину строки и остается там.
  const c = s.slice(0, 1);
  if (/[А-Я]/.test(c) && /[а-я]/.test(s.slice(1, 12))) s = c.toLowerCase() + s.slice(1);
  const w = s.split(" ").filter(Boolean);
  if (w.length === 2 && ADJ_TAIL.test(low(w[1])) && !ADJ_TAIL.test(low(w[0]))) s = `${w[1]} ${w[0]}`;
  return s.slice(0, 80);
}

// Три формы имени. Родительный падеж множественного числа в русском не выводится из
// именительного правилом: «насосы - насосов», но «трубы - труб», а окончание одно и то же.
// Поэтому формы БЕРУТСЯ у агента, а не угадываются; не подтвержденное помечается guessed
// и печатается списком. Латиница и аббревиатура не склоняются - это факт языка, не догадка.
export function caseForms(nom, line) {
  const p = str(line).split("|").map((x) => plain(x)).filter(Boolean);
  if (p.length >= 3) return { nom: p[0].slice(0, 80), gen: p[1].slice(0, 80), acc: p[2].slice(0, 80), guessed: false };
  if (p.length === 2) return { nom: p[0].slice(0, 80), gen: p[1].slice(0, 80), acc: p[0].slice(0, 80), guessed: false };
  const invariable = !/[а-я]/i.test(nom);
  return { nom, gen: nom, acc: nom, guessed: !invariable };
}

// ---------------------------------------------------------------- правила агента
// Диалект тот же, что у pages.yml: раздел, потом строки «ключ: "значение"». Своего
// формата у режима не заводится, и парсер тут плоский - вложенности в правилах нет.
export function readRulesYml(p) {
  const out = new Map();
  if (!existsSync(p)) return out;
  const raw = readFileSync(p, "utf8").replace(/^﻿/, "");
  let section = null;
  for (const line of raw.split(/\r?\n/)) {
    if (/^\s*#/.test(line) || !line.trim()) continue;
    const head = line.match(/^([a-z][a-z0-9_]*):\s*$/);
    if (head) { section = head[1]; if (!out.has(section)) out.set(section, new Map()); continue; }
    const row = line.match(/^ {2}([a-z0-9][a-z0-9_-]*):\s*"(.*)"\s*$/);
    if (!row || !section) continue;
    out.get(section).set(row[1], row[2]);
  }
  return out;
}
const rule = (rules, section, key) => {
  const s = rules.get(section);
  return s && key ? str(s.get(key)) : "";
};

// ---------------------------------------------------------------- снимок агента
// catalog-serp.json пишет catalog-architect своими MCP-инструментами. Скрипт в сеть не
// ходит: тут только разбор снятого. ws - частоты, nodes[].top - топ-10 по маркеру узла.
export function readSerp(dir) {
  const f = join(dir, "catalog-serp.json");
  const out = { ws: new Map(), nodes: new Map(), file: f, found: false };
  if (!existsSync(f)) return out;
  let j;
  try { j = JSON.parse(readFileSync(f, "utf8").replace(/^﻿/, "")); } catch (e) { die(`catalog-serp.json не разобран: ${e.message}`); }
  out.found = true;
  for (const w of arr(j.ws)) {
    const q = wsKey(w && w.q);
    const n = Number(w && w.n);
    if (q && Number.isFinite(n) && n >= 0) out.ws.set(q, Math.min(10000000, Math.round(n)));
  }
  for (const n of arr(j.nodes)) {
    const id = str(n && n.id);
    if (id) out.nodes.set(id, n);
  }
  return out;
}
const wsKey = (q) => low(plain(q)).replace(/[^а-яa-z0-9 ]+/gi, " ").replace(/\s+/g, " ").trim();

// ---------------------------------------------------------------- анкета платформы
const PLATFORM_EMPTY = {
  kind: "unknown", facet_url: "unknown", multi_select: "unknown", range: "unknown",
  meta_override: "unknown", canonical: "unknown", clean_param: "unknown", noindex: "unknown", import: "unknown"
};
const CAN_VALS = ["yes", "no", "unknown"];
export function readPlatform(dir) {
  const f = join(dir, "platform.json");
  if (!existsSync(f)) return { p: { ...PLATFORM_EMPTY }, found: false };
  let j;
  try { j = JSON.parse(readFileSync(f, "utf8").replace(/^﻿/, "")); } catch (e) { die(`platform.json не разобран: ${e.message}`); }
  const p = { ...PLATFORM_EMPTY };
  const pick = (k, list) => { const v = low(j[k]); if (list.includes(v)) p[k] = v; };
  pick("kind", ["bitrix", "opencart", "insales", "woo", "tilda", "1c", "custom", "unknown"]);
  pick("facet_url", ["path", "query", "none", "unknown"]);
  pick("import", ["csv", "xlsx", "yml", "1c", "manual", "unknown"]);
  for (const k of ["multi_select", "range", "meta_override", "canonical", "clean_param", "noindex"]) pick(k, CAN_VALS);
  if (str(j.name)) p.name = plain(j.name).slice(0, 80);
  return { p, found: true };
}

// Чего не хватило платформе для ОСИ. Пустая строка - ось платформа держит.
// meta_override сюда не входит намеренно: без него фильтр работает, но отфильтрованная
// страница не получает своих метатегов, а это вопрос статуса ПОСАДКИ, не оси.
export function platformGate(p, kind, multi) {
  const fu = str(p.facet_url);
  if (fu !== "path" && fu !== "query") return "facet_url";
  if (kind === "range" && !CAN(p.range)) return "range";
  if (multi && !CAN(p.multi_select)) return "multi_select";
  // Закрывать неиндексируемую комбинацию платформе есть чем ровно в двух случаях:
  // canonical либо Clean-param. noindex осью НЕ считается: им закрывается тонкая
  // КАТЕГОРИЯ целиком, а indexOf умеет вернуть только index, canonical и clean_param -
  // и verify-catalog валит посадку, закрытую тем, чего у платформы нет. Считать noindex
  // достаточным значило бы писать в контракт значение, запрещенное собственным гейтом:
  // режим вставал намертво, и правкой данных это не чинилось.
  if (!CAN(p.canonical) && !CAN(p.clean_param)) return fu === "query" ? "clean_param" : "canonical";
  return "";
}

// Статус индексации комбинации. Спрос ноль - это «спроса не мерили», и такая комбинация
// закрывается: обещанной, но незаслуженной индексации в ТЗ не бывает.
// Последняя ветка недостижима у опубликованной оси: platformGate уже снял ось, у которой
// нет ни canonical, ни Clean-param. Она стоит для случая, когда статус считают по чужому,
// правленному руками contract - и тогда verify-catalog назовет расхождение вслух.
export function indexOf(p, sku, demand) {
  if (sku >= LANDING_INDEX_SKU && demand >= LANDING_INDEX_DEMAND && CAN(p.meta_override)) return "index";
  if (CAN(p.canonical)) return "canonical";
  if (CAN(p.clean_param)) return "clean_param";
  return "canonical";
}

// ---------------------------------------------------------------- формулы метатегов
// Формула одна на весь каталог, и это главный текст проекта: на каталоге из 200 категорий
// это 200 Title. Двести ручных заголовков не пишутся - пишется формула плюс исключения.
// Своей маркетинговой формулировки скрипт не выдумывает: содержательные формулы живут в
// catalog-rules.yml, тут только структурный запас, чтобы поле не осталось пустым.
export const FORMULA = { h1: "{nom} {value}", title: "{h1} - цены в каталоге", description: "" };
const cap1 = (s) => (s ? s.slice(0, 1).toUpperCase() + s.slice(1) : s);
export function render(tpl, vars) {
  return plain(String(tpl).replace(/\{([a-z0-9_]+)\}/gi, (_, k) => {
    const v = vars[k];
    return v === undefined || v === null ? "" : String(v);
  }));
}
// Потолок метатега режется по слову: обрубок посреди слова заказчик видит сразу.
const cutTo = (s, max) => {
  const a = Array.from(plain(s));
  if (a.length <= max) return a.join("");
  const t = a.slice(0, max).join("");
  const sp = t.lastIndexOf(" ");
  return (sp > max * 0.6 ? t.slice(0, sp) : t).replace(/[\s,;:-]+$/, "");
};

// ---------------------------------------------------------------- дерево
function nodeFactory() {
  const byKey = new Map(), taken = new Set(), list = [];
  const make = (path, src, extra) => {
    const key = path.map((s) => low(s)).join("|");
    const had = byKey.get(key);
    if (had) {
      if (SRC_RANK[src] < SRC_RANK[had.src]) had.src = src;
      if (extra && str(extra.marker) && !had.marker) had.marker = plain(extra.marker).slice(0, 120);
      if (extra && str(extra.url) && !had.urlFixed) { had.url = plain(extra.url).slice(0, 300); had.urlFixed = true; }
      return had;
    }
    const parent = path.length > 1 ? make(path.slice(0, -1), src) : null;
    const own = slugOf(path[path.length - 1]);
    let id = str(extra && extra.id) && /^[a-z0-9][a-z0-9-]{0,39}$/.test(str(extra.id)) ? str(extra.id) : own;
    // Занятый id из брифа уступает собственному имени узла: «nasosy-nasosy» не адрес.
    if (taken.has(id) && id !== own) id = own;
    if (taken.has(id) && parent) id = slugOf(`${parent.id}-${id}`, 40);
    const base = id;
    let k = 2;
    while (taken.has(id)) id = `${base}-${k++}`.slice(0, 40);
    taken.add(id);
    const nom = normalName(path[path.length - 1]);
    const n = {
      id, parent: parent ? parent.id : null, path, nom, src, kids: [], own: [], rows: [],
      marker: plain((extra && extra.marker) || "").slice(0, 120),
      url: "", urlFixed: false
    };
    if (extra && str(extra.url)) { n.url = plain(extra.url).slice(0, 300); n.urlFixed = true; }
    else n.url = `${parent ? parent.url : "/"}${slugOf(path[path.length - 1])}/`;
    if (parent) parent.kids.push(n);
    byKey.set(key, n); list.push(n);
    return n;
  };
  return { make, list, byKey };
}

// Прайс перечитывается по attr_map: номера колонок, строка шапки и лист уже разобраны
// ingest, и второй раз их определять нельзя - разошлись бы два разбора одного файла.
function replayPrice(dir, map) {
  const p = map.price || {};
  const file = resolve(dir, str(p.file));
  if (!existsSync(file)) die(`прайса нет на месте: attr_map.json ссылается на ${str(p.file)}, а файла в проекте нет`);
  let table;
  try { table = readTable(file, 0, str(p.sheet)); } catch (e) { die(`прайс ${basename(file)} не разобран: ${e.message}`); }
  const h = Math.max(1, Number(p.header_row) || 1) - 1;
  const body = table.rows.slice(h + 1).filter((r) => r.some((c) => str(c) !== ""));
  if (!body.length) die(`под шапкой прайса ${basename(file)} нет ни одной строки: перезапустите ingest --refresh`);
  const cols = arr(map.cols);
  if (!cols.length) die("в attr_map.json нет колонок: перезапустите ingest --refresh");
  return { body, cols, file };
}

function cmdTree(pos, flags, root) {
  const dir = findDir(pos[0], root);
  if (!dir) die("проект не найден: укажите слаг либо каталог sites/NNN-slug");
  const mapFile = join(dir, "attr_map.json");
  if (!existsSync(mapFile)) die("сначала ingest: без вердикта готовности данных дерево строить не из чего");
  const project = loadProject(dir);
  const type = str(project.business && project.business.type);
  if (type !== "shop" && type !== "both") {
    die(`business.type = ${type || "не задан"}: режим магазина включают только shop и both, и переключатель ровно один`);
  }
  let map;
  try { map = JSON.parse(readFileSync(mapFile, "utf8")); } catch (e) { die(`attr_map.json не читается: ${e.message}`); }
  const verdict = str(map.verdict);
  if (!VERDICTS.includes(verdict)) die(`в attr_map.json вердикт «${verdict || "пусто"}» вне списка: ${VERDICTS.join(", ")}`);
  const out = join(dir, "catalog.json");
  if (existsSync(out) && !flags.refresh) {
    console.log(`[catalog] catalog.json уже собран и заморожен, пропуск (--refresh пересоберет): ${out}`);
    return 0;
  }

  const notes = [];
  const { p: platform, found: platFound } = readPlatform(dir);
  if (!platFound) notes.push("анкеты платформы нет (platform.json): все девять ответов считаны как unknown, а unknown работает как no - опубликованных осей не будет ни одной");
  const rules = readRulesYml(join(dir, "catalog-rules.yml"));
  if (!rules.size) notes.push("catalog-rules.yml не найден: падежные формы, формулы Title и H1 и наборы полей карточки взяты запасные - это работа агента catalog-architect");
  const serp = readSerp(dir);
  const { body, cols, file } = replayPrice(dir, map);

  const catCol = cols.find((c) => c.role === "category") || null;
  const nameCol = cols.find((c) => c.role === "name") || null;
  const priceCol = cols.find((c) => c.role === "price") || null;
  const attrCols = cols.filter((c) => c.role === "attr" || c.role === "brand");
  const business = project.business || {};

  // --- узлы из прайса
  const F = nodeFactory();
  const rootFallback = normalName(arr(business.assortment)[0] || str(business.what) || str(project.slug) || "каталог");
  if (!catCol) notes.push(`колонки раздела в прайсе нет: все ${body.length} позиций легли в один узел «${rootFallback}», дерево пришло из брифа и от конкурентов`);
  for (const r of body) {
    const path = catCol ? catPath(r[catCol.i]) : [];
    const node = F.make(path.length ? path : [rootFallback], "price");
    node.own.push(r);
  }

  // Лист прайса часто назван одним прилагательным: «Насосы / Циркуляционные». В ТЗ это
  // дает «Цены на циркуляционные». Имя листа достраивается родителем сверху вниз.
  const compose = (n) => {
    const parent = n.parent ? F.list.find((x) => x.id === n.parent) : null;
    if (parent && /^[а-яa-z-]+$/i.test(n.nom) && ADJ_TAIL.test(low(n.nom))) n.nom = `${n.nom} ${parent.nom}`.slice(0, 80);
    for (const k of n.kids) compose(k);
  };
  for (const n of F.list) if (!n.parent) compose(n);

  // --- узлы из брифа: направления знают свой id, родителя, маркер и адрес
  // Сопоставление идет и по имени, и по всему пути узла, и по множеству слов: иначе бриф
  // заведет второй узел рядом с прайсовым, и объем работ удвоится на пустом месте.
  const byName = () => {
    const m = new Map();
    for (const n of F.list) for (const k of [low(n.nom), wordKey(n.nom), wordKey(n.path.join(" "))]) if (k && !m.has(k)) m.set(k, n);
    return m;
  };
  const lookup = (m, nm) => m.get(low(nm)) || m.get(wordKey(nm)) || null;
  // «Насосы» из прайса и «насосы циркуляционные» из брифа - не дубль и не два корня:
  // второе уточняет первое. Узел из брифа вешается под самый глубокий узел, чьи слова
  // целиком входят в его имя, и дерево остается деревом.
  const parentFor = (nm) => {
    const ws = new Set(wordKey(nm).split("|").filter(Boolean));
    if (!ws.size) return null;
    let best = null;
    for (const n of F.list) {
      const pw = wordKey(n.path.join(" ")).split("|").filter(Boolean);
      if (!pw.length || pw.length >= ws.size) continue;
      if (pw.every((w) => ws.has(w)) && (!best || n.path.length > best.path.length)) best = n;
    }
    return best && best.path.length < TREE_DEPTH_MAX ? best : null;
  };
  for (const d of arr(business.directions)) {
    const nm = plain(d && d.name);
    if (!nm) continue;
    const hit = lookup(byName(), normalName(nm));
    if (hit) {
      if (!hit.marker && str(d.marker)) hit.marker = plain(d.marker).slice(0, 120);
      if (!hit.urlFixed && str(d.url)) { hit.url = plain(d.url).slice(0, 300); hit.urlFixed = true; }
      continue;
    }
    const named = normalName(nm);
    const parent = arr(business.directions).find((x) => x && x.id === str(d.parent));
    const under = parentFor(named);
    const path = parent && plain(parent.name) ? [normalName(parent.name), named] : under ? under.path.concat([named]) : [named];
    F.make(path, "brief", { id: str(d.id), marker: str(d.marker), url: str(d.url) });
  }
  for (const a of arr(business.assortment)) {
    const nm = normalName(a);
    if (!nm || lookup(byName(), nm)) continue;
    const under = parentFor(nm);
    F.make(under ? under.path.concat([nm]) : [nm], "brief");
  }
  // --- узлы от конкурентов: их приносит агент разделом competitors в catalog-rules.yml
  for (const [id, line] of (rules.get("competitors") || new Map())) {
    const nm = normalName(str(line).split("|")[0] || id);
    if (!nm || lookup(byName(), nm)) continue;
    const under = parentFor(nm);
    F.make(under ? under.path.concat([nm]) : [nm], "competitors", { id });
  }

  // --- позиции узла: свои плюс все, что лежит ниже по дереву
  const collect = (n) => { n.rows = n.own.concat(...n.kids.map(collect)); return n.rows; };
  for (const n of F.list) if (!n.parent) collect(n);

  let tree = F.list.slice();
  if (tree.length > NODES_MAX) {
    const keep = new Set(tree.slice().sort((a, b) => b.rows.length - a.rows.length || SRC_RANK[a.src] - SRC_RANK[b.src]).slice(0, NODES_MAX).map((n) => n.id));
    // Родитель оставленного узла остается всегда: дерево без родителя - не дерево.
    for (const n of tree) if (keep.has(n.id)) { let p = n; while (p.parent) { keep.add(p.parent); p = F.list.find((x) => x.id === p.parent); if (!p) break; } }
    notes.push(`узлов ${tree.length} при потолке ${NODES_MAX}: в контракт вошли ${keep.size} крупнейших, остальные названы в отчете`);
    tree = tree.filter((n) => keep.has(n.id));
  }

  // --- оси, блокировки, посадки
  const kept = new Set(tree.map((n) => n.id));
  const noFacets = verdict === "must_request_from_client" || verdict === "impossible";
  const blockedData = [], blockedPlatform = [], landings = [], overThreshold = [], trimmedFacets = [];
  const nodesOut = [];
  let guessedNames = 0;
  const guessedList = [];

  let transit = 0;
  const kindClash = [];
  for (const n of tree) {
    const rows = n.rows;
    // Узел-транзит: своих позиций нет, потомок ровно один, весь ассортимент лежит в нем.
    // Свои оси и посадки такому узлу не назначаются - это был бы второй экземпляр той же
    // страницы, а посадками считается ОБЪЕМ РАБОТ, и удваивать его нельзя.
    const isTransit = n.own.length === 0 && n.kids.length === 1;
    if (isTransit) transit++;
    const snap = serp.nodes.get(n.id) || null;
    if (!n.marker && snap && str(snap.marker)) n.marker = plain(snap.marker).slice(0, 120);
    const forms = caseForms(n.nom, rule(rules, "names", n.id) || rule(rules, "names", slugOf(n.nom)) || rule(rules, "competitors", n.id));
    if (forms.guessed) { guessedNames++; if (guessedList.length < 8) guessedList.push(n.id); }

    // Ось считается ПО СТРОКАМ УЗЛА, а не по ячейке раздела из прайса: узел дерева и
    // значение колонки «Раздел» - разные вещи, у родителя строк больше, чем у любого
    // потомка. Порог тот же, AXIS_FILL_MIN.
    const axes = [];
    for (const c of attrCols) {
      const vals = rows.map((r) => str(r[c.i]));
      const filledVals = vals.filter((v) => v !== "");
      const fill = round2(rows.length ? filledVals.length / rows.length : 0);
      const multi = filledVals.length ? filledVals.filter(isMultiCell).length / filledVals.length >= MULTI_SHARE : false;
      const counts = new Map();
      if (c.kind !== "range") {
        for (const v of filledVals) for (const one of splitVals(v)) {
          if (Array.from(one).length > VALUE_LEN_MAX) continue;
          counts.set(one, (counts.get(one) || 0) + 1);
        }
      }
      const values = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, VALUES_MAX).map(([value, sku]) => ({ value, sku }));
      // Раздел axes правил: имя оси клиентским языком и решение «дает посадки или нет».
      // kind сюда НЕ приходит: как выглядит фильтр, решает агент, а числовая колонка это
      // диапазон по факту данных, и спорить с фактом нечем - расхождение печатается.
      const r = rule(rules, "axes", c.attr).split("|").map((x) => plain(x));
      if (r[1] && low(r[1]) !== (c.kind || "enum")) kindClash.push(`${c.attr}: по данным ${c.kind || "enum"}, в правилах ${low(r[1])}`);
      axes.push({
        c, fill, multi, values,
        label: (r[0] || plain(c.col || c.attr)).slice(0, 60) || c.attr,
        kind: c.kind || "enum",
        noLanding: low(r[2]) === "no"
      });
    }

    const published = [];
    for (const a of isTransit ? [] : axes) {
      if (a.fill < AXIS_FILL_MIN) {
        blockedData.push({ node: n.id, attr: a.c.attr, label: a.label, fill: a.fill, sku: rows.length });
        continue;
      }
      if (noFacets) { overThreshold.push(`${n.id} / ${a.c.attr}`); continue; }
      if (a.kind !== "range" && !a.values.length) {
        blockedData.push({ node: n.id, attr: a.c.attr, label: a.label, fill: a.fill, sku: rows.length });
        continue;
      }
      const need = platformGate(platform, a.kind, a.multi);
      if (need) { blockedPlatform.push({ node: n.id, attr: a.c.attr, label: a.label, need }); continue; }
      published.push(a);
    }
    published.sort((a, b) => b.fill - a.fill || b.values.length - a.values.length || a.c.attr.localeCompare(b.c.attr));
    if (published.length > FACETS_MAX) {
      trimmedFacets.push(`${n.id}: осей ${published.length}, опубликованы ${FACETS_MAX} с наибольшей заполненностью`);
      published.length = FACETS_MAX;
    }

    // Набор полей карточки: только то, что в прайсе реально есть у этой категории.
    // Выдуманное поле в ТЗ означает прочерк в выдаче, а прочерков в товарной выдаче нет.
    const specsRule = rule(rules, "specs", n.id);
    const specs = specsRule
      ? specsRule.split("|").map((s) => low(s).replace(/[^a-z0-9_]/g, "")).filter((s) => /^[a-z][a-z0-9_]{1,31}$/.test(s))
      : axes.filter((a) => a.fill >= ATTR_FILL_MIN).sort((a, b) => b.fill - a.fill).map((a) => a.c.attr).filter((s) => /^[a-z][a-z0-9_]{1,31}$/.test(s));
    const specsOut = [...new Set(specs)].slice(0, SPECS_MAX);

    // Тиры считаются по СВОИМ строкам узла: позиция лежит ровно в одном узле, и считать
    // ее еще раз у родителя значило бы продать одну карточку дважды.
    const isC = (r) => {
      if (!nameCol || str(r[nameCol.i]) === "") return true;
      if (priceCol && str(r[priceCol.i]) === "") return true;
      if (noFacets) return false;
      return published.length ? published.every((a) => str(r[a.c.i]) === "") : false;
    };
    const cCount = n.own.filter(isC).length;

    const node = {
      id: n.id,
      parent: n.parent,
      name: { nom: forms.nom, gen: forms.gen, acc: forms.acc },
      url: n.url,
      src: n.src,
      sku: Math.min(1000000, rows.length),
      tier: { a: 0, b: Math.max(0, n.own.length - cCount), c: cCount }
    };
    // mode и signals тут НЕ проставляются. Предзаполнение «catalog плюс четыре нуля»
    // делало страховку «сначала mode» в сборке ТЗ мертвой: пересчет по нулям давал тот же
    // catalog, гейт молчал, и заказчик получал ТЗ, где колонка «решение можно проверить
    // глазом» состояла из нулей. Узел без режима - это узел, которому режим еще не
    // ставили, и так его и видят и verify-catalog, и build-catalog-tz.
    // Транзитный узел (своих позиций нет, потомок один) склеивается с этим потомком:
    // два адреса под один ассортимент и один запрос - каннибализация, которую иначе
    // создает сам конвейер и увозит заказчику готовой строкой meta.csv.
    if (isTransit && n.kids.length === 1 && kept.has(n.kids[0].id)) node.canonical = n.kids[0].url;
    // Маркер по умолчанию - само имя узла. «Купить» и прочее к нему не дописывается:
    // маркер это то, чем узел меряют, и выдумывать запрос за агентом скрипт не будет.
    node.marker = (n.marker || forms.nom).slice(0, 120);
    if (published.length) {
      node.facets = published.map((a) => {
        const f = { attr: a.c.attr, label: a.label, kind: a.kind, fill: Math.min(1, a.fill) };
        // Мультизначность оси - ФАКТ ДАННЫХ (несколько значений в одной ячейке), и он
        // кладется в контракт. Без него гейт перепроверял ось с multi = false, то есть
        // не тем условием, которым ее решал строитель.
        if (a.multi) f.multi = true;
        if (a.kind !== "range" && a.values.length) f.values = a.values;
        return f;
      });
    }
    if (specsOut.length) node.specs = specsOut;
    nodesOut.push(node);

    // --- посадки узла
    if (!published.length) continue;
    const region = plain(business.region).slice(0, 60);
    const fH1 = rule(rules, "formula", "h1") || FORMULA.h1;
    const fTitle = rule(rules, "formula", "title") || FORMULA.title;
    const fDesc = rule(rules, "formula", "description") || FORMULA.description;
    const mk = (attrs, sku) => {
      const vals = attrs.map((x) => x.value);
      const marker = plain(`${forms.nom} ${vals.join(" ")}`).slice(0, 120);
      const demand = serp.ws.get(wsKey(marker)) || serp.ws.get(wsKey(`${vals.join(" ")} ${forms.nom}`)) || serp.ws.get(wsKey(`купить ${marker}`)) || 0;
      const vars = {
        nom: forms.nom, gen: forms.gen, acc: forms.acc, value: vals[0] || "", value2: vals[1] || "",
        values: vals.join(" "), attr: attrs[0] ? attrs[0].attr : "", sku, region, node: forms.nom
      };
      const exc = rule(rules, "h1_exceptions", `${n.id}-${vals.map((v) => slugOf(v, 24)).join("-")}`.slice(0, 80));
      const h1 = cutTo(cap1(exc || render(fH1, vars)), 120);
      const title = cutTo(render(fTitle, { ...vars, h1 }), 70) || h1;
      const description = cutTo(render(fDesc, { ...vars, h1, title }), 160);
      const idRaw = `${n.id}-${vals.map((v) => slugOf(v, 24)).join("-")}`;
      const url = str(platform.facet_url) === "query"
        ? `${n.url}?${attrs.map((x) => `${x.attr}=${slugOf(x.value, 24)}`).join("&")}`
        : `${n.url}${vals.map((v) => slugOf(v, 24)).join("-")}/`;
      const L = {
        id: slugOf(idRaw, 80), node: n.id, url: url.slice(0, 300),
        attrs: attrs.map((x) => ({ attr: x.attr, value: x.value.slice(0, VALUE_LEN_MAX) })),
        h1, title, sku, index: indexOf(platform, sku, demand)
      };
      if (marker) L.marker = marker;
      if (description) L.description = description;
      if (demand) L.demand = demand;
      return L;
    };

    // Значение, которое уже стоит в имени узла, посадки не делает: «полипропиленовые
    // трубы полипропилен» это не запрос, а склейка шаблона с самим собой.
    const inName = new Set(wordKey(forms.nom).split("|").filter(Boolean));
    const echo = (v) => wordKey(v).split("|").filter(Boolean).every((w) => inName.has(w));
    const mine = [];
    for (const a of published) {
      if (a.kind === "range" || a.noLanding) continue;
      for (const v of a.values) {
        if (v.sku < LANDING_SKU_MIN || echo(v.value)) continue;
        mine.push(mk([{ attr: a.c.attr, value: v.value }], v.sku));
      }
    }
    // Комбинация из двух осей создается ТОЛЬКО под замеренный спрос: без него это
    // бесконечная сетка фильтров, которую поиск читает как дубли.
    // Пары осей называет агент разделом pairs: какая связка вообще спрашивается словами,
    // из данных не выводится. Без раздела берутся две сильнейшие оси узла.
    const canLand = published.filter((a) => a.kind !== "range" && !a.noLanding);
    const named = [...(rules.get("pairs") || new Map()).values()]
      .map((v) => String(v).split("|").map((x) => plain(x)))
      .map(([x, y]) => [canLand.find((a) => a.c.attr === x), canLand.find((a) => a.c.attr === y)])
      .filter(([x, y]) => x && y && x !== y);
    const pairs = named.length ? named : (canLand.length >= 2 ? [[canLand[0], canLand[1]]] : []);
    for (const [p1, p2] of pairs) {
      for (const v1 of p1.values.slice(0, 5)) for (const v2 of p2.values.slice(0, 5)) {
        const sku = rows.filter((r) => splitVals(r[p1.c.i]).includes(v1.value) && splitVals(r[p2.c.i]).includes(v2.value)).length;
        if (sku < LANDING_INDEX_SKU) continue;
        const L = mk([{ attr: p1.c.attr, value: v1.value }, { attr: p2.c.attr, value: v2.value }], sku);
        if (L.index === "index") mine.push(L);
      }
    }
    mine.sort((a, b) => (b.demand || 0) - (a.demand || 0) || b.sku - a.sku || a.id.localeCompare(b.id));
    for (const L of mine.slice(0, LANDINGS_PER_NODE)) landings.push(L);
  }

  // --- метатеги уникальны по массиву: одинаковый Title у двух посадок - это дубль,
  // а дубль не ранжируется. Столкновение чинится удлинением, неисправимое - отбрасывается.
  const dropped = [];
  {
    const seenT = new Set(), seenH = new Set(), seenU = new Set(), seenI = new Set();
    const nodeUrls = new Set(nodesOut.map((n) => n.url));
    const keep = [];
    for (const L of landings) {
      const long = (s, add) => cutTo(`${s} - ${add}`, s === L.title ? 70 : 120);
      const nom = (nodesOut.find((n) => n.id === L.node) || { name: {} }).name.nom || "";
      if (seenH.has(low(L.h1))) L.h1 = long(L.h1, nom);
      if (seenT.has(low(L.title))) L.title = long(L.title, L.attrs.map((a) => a.value).join(" "));
      if (seenT.has(low(L.title)) || seenH.has(low(L.h1)) || seenU.has(L.url) || nodeUrls.has(L.url) || seenI.has(L.id)) {
        dropped.push(`${L.id} (${L.title})`);
        continue;
      }
      seenT.add(low(L.title)); seenH.add(low(L.h1)); seenU.add(L.url); seenI.add(L.id);
      keep.push(L);
    }
    landings.length = 0;
    for (const L of keep) landings.push(L);
  }
  landings.sort((a, b) => (a.index === "index" ? 0 : 1) - (b.index === "index" ? 0 : 1) || (b.demand || 0) - (a.demand || 0) || b.sku - a.sku || a.id.localeCompare(b.id));
  if (landings.length > LANDINGS_MAX) {
    notes.push(`посадок ${landings.length} при потолке ${LANDINGS_MAX}: в контракт вошли ${LANDINGS_MAX} с наибольшим спросом и числом позиций`);
    landings.length = LANDINGS_MAX;
  }

  // --- тир A: тридцать карточек на весь каталог, большими узлами вперед
  if (!noFacets) {
    let left = TIER_A_MAX;
    const order = nodesOut.slice().sort((a, b) => b.tier.b - a.tier.b || a.id.localeCompare(b.id));
    const total = order.reduce((s, n) => s + n.tier.b, 0);
    for (const n of order) {
      if (left <= 0) break;
      const share = total ? Math.round((n.tier.b / total) * TIER_A_MAX) : 0;
      const a = Math.max(0, Math.min(left, Math.min(n.tier.b, share)));
      n.tier.a = a; n.tier.b -= a; left -= a;
    }
  }

  const data = {
    v: 1,
    slug: str(project.slug) || str(map.slug),
    at: today(),
    verdict,
    platform,
    tree: nodesOut,
    landings,
    blocked_by_data: blockedData.sort((a, b) => b.fill - a.fill || a.node.localeCompare(b.node)).slice(0, BLOCKED_MAX),
    blocked_by_platform: blockedPlatform.slice(0, BLOCKED_MAX),
    counts: {
      nodes: nodesOut.length,
      landings: landings.length,
      sku: body.length,
      tier_a: nodesOut.reduce((s, n) => s + n.tier.a, 0),
      tier_b: nodesOut.reduce((s, n) => s + n.tier.b, 0),
      tier_c: nodesOut.reduce((s, n) => s + n.tier.c, 0)
    }
  };

  writeCatalog(dir, out, data, "tree");

  // --- отчет
  const idx = landings.filter((L) => L.index === "index").length;
  console.log(`[catalog] дерево ${basename(file)}: узлов ${nodesOut.length} (прайс ${nodesOut.filter((n) => n.src === "price").length}, бриф ${nodesOut.filter((n) => n.src === "brief").length}, конкуренты ${nodesOut.filter((n) => n.src === "competitors").length}), позиций ${body.length}`);
  console.log(`  ОБЪЕМ РЕЖИМА СЧИТАЕТСЯ В ПОСАДКАХ, А НЕ В КАТЕГОРИЯХ: посадок ${landings.length}, из них индексируемых ${idx}. Единица работы и цены - посадка.`);
  console.log(`  вердикт ${verdict} - ${VERDICT_EFFECT[verdict]}`);
  if (transit) console.log(`  узлов-транзитов ${transit}: весь ассортимент лежит в единственном потомке, своих осей и посадок им не назначено`);
  console.log(`  платформа ${platform.kind}, адрес фильтра ${platform.facet_url}: опубликованных осей ${nodesOut.reduce((s, n) => s + arr(n.facets).length, 0)}, тиры A ${data.counts.tier_a} / B ${data.counts.tier_b} / C ${data.counts.tier_c}`);
  for (const b of data.blocked_by_data.slice(0, 6)) {
    console.log(`  ось не публикуется ПО ДАННЫМ: ${b.node} / ${b.attr} - заполнено ${Math.round(b.fill * 100)} процентов из ${Math.round(AXIS_FILL_MIN * 100)}`);
  }
  if (data.blocked_by_data.length > 6) console.log(`  ... и еще ${data.blocked_by_data.length - 6} осей по данным`);
  for (const b of data.blocked_by_platform.slice(0, 6)) {
    console.log(`  ось не публикуется НА ПЛАТФОРМЕ: ${b.node} / ${b.attr} - нет возможности ${b.need}`);
  }
  if (data.blocked_by_platform.length > 6) console.log(`  ... и еще ${data.blocked_by_platform.length - 6} осей по платформе`);
  if (overThreshold.length) console.log(`  порог прошли, но не опубликованы (вердикт ${verdict}): ${overThreshold.slice(0, 6).join(", ")}`);
  if (guessedNames) console.log(`  падежные формы НЕ ПОДТВЕРЖДЕНЫ у ${guessedNames} узлов из ${nodesOut.length} (${guessedList.join(", ")}): родительный падеж машинно не выводится, формы дает catalog-rules.yml, раздел names`);
  if (!serp.ws.size) console.log("  спрос не замерен ни по одной посадке: без раздела ws в catalog-serp.json индексируемых комбинаций не назначается, все закрываются canonical либо Clean-param");
  for (const t of trimmedFacets.slice(0, 4)) console.log(`  ${t}`);
  if (kindClash.length) console.log(`  kind оси разошелся с правилами, взят по данным: ${[...new Set(kindClash)].slice(0, 4).join("; ")}`);
  if (dropped.length) console.log(`  отброшено посадок с неустранимым дублем метатега: ${dropped.length} (${dropped.slice(0, 3).join("; ")})`);
  const thinSpecs = nodesOut.filter((n) => arr(n.specs).length && arr(n.specs).length < SPECS_MIN).length;
  if (thinSpecs) console.log(`  набор полей карточки короче ${SPECS_MIN} строк у ${thinSpecs} узлов: единообразие набора ВНУТРИ категории важнее формулировок, недостающее запрашивается у заказчика`);
  for (const m of notes) console.log(`  ВНИМАНИЕ: ${m}`);
  console.log(`[catalog] записано: ${out}`);
  console.log("  дальше: агент снимает топ-10 по маркерам узлов в catalog-serp.json, затем node catalog.mjs mode");
  return 0;
}

// Ни один каталог не ложится на диск непроверенным: собранное обязано проходить ровно ту
// схему, которой его встретит verify-catalog.
function writeCatalog(dir, out, data, who) {
  const schemaPath = resolve(fileURLToPath(import.meta.url), "..", "..", "..", "skills", "site-proto", "catalog.schema.json");
  if (existsSync(schemaPath)) {
    let schema;
    try { schema = JSON.parse(readFileSync(schemaPath, "utf8")); } catch (e) { die(`catalog.schema.json не читается: ${e.message}`); }
    const bad = [];
    validate(data, schema, "", schema, (p, m) => bad.push(`${p || "(корень)"}: ${m}`));
    if (bad.length) {
      console.error(`[catalog] ${who}: собранный catalog.json не проходит собственную схему, на диск не пишем:`);
      for (const b of bad.slice(0, 12)) console.error("   ! " + b);
      if (bad.length > 12) console.error(`   ... и еще ${bad.length - 12}`);
      process.exit(2);
    }
  }
  writeFileSync(out, JSON.stringify(data, null, 2) + "\n", "utf8");
}

// ───────────────────────────────────────────────── 8. Подкоманда mode
// Режим категории - машинный признак. Решений на глаз нет: четыре числа считаются из
// снимка выдачи и из прайса, печатаются колонкой и кладутся в узел, чтобы решение
// проверялось глазом за минуту.
//   H1 товаров в категории меньше 8;
//   H2 доля НЕ-листингов в топ-10 по маркеру от 0.5;
//   H3 медиана видимого текста у топ-10 от 2500 знаков;
//   H4 сервисная лексика в маркере либо в трех и более запросах узла.
// service_like требует ОБЯЗАТЕЛЬНОГО H2 либо H4 плюс любого второго условия. Мягче (два
// любых из четырех) - треть тонкого каталога превратится в лендинги. Вето: не-листингов
// до 0.2 при двадцати товарах и больше - service_like не назначается никогда. Третий
// исход - thin_category: мало товаров при каталожной выдаче, значит интро, плитка
// подкатегорий и noindex до наполнения, а НЕ лендинг.
// Сам service_like - МАРШРУТИЗАЦИЯ узла в обычный тракт письма к site-author с потолком
// 6 блоков, где вопросы «как выбрать» берутся прямо из осей фасетов. Третьего движка
// письма в режиме не появляется.

export const H_LIMIT = { products: 8, non_listing: 0.5, text_median: 2500, service_hits: 3 };
export const VETO = { non_listing: 0.2, products: 20 };
export const SERVICE_WORDS = ["под\\s+заказ", "на\\s+заказ", "изготовлен", "изготовит", "монтаж", "установк", "проектирован"];
export const serviceRe = (extra) => new RegExp(B + "(" + SERVICE_WORDS.concat(arr(extra).map((s) => low(s).replace(/[^а-яa-z0-9\s]/g, ""))).filter(Boolean).join("|") + ")", "i");

export function signalsOf(sku, snap, re) {
  const top = arr(snap && snap.top).slice(0, 10);
  const nonList = top.length ? round2(top.filter((t) => low(t && t.kind) !== "listing").length / top.length) : 0;
  const chars = top.map((t) => Math.round(Number(t && t.chars) || 0)).filter((n) => n > 0).sort((a, b) => a - b);
  const med = chars.length ? Math.round(chars.length % 2 ? chars[(chars.length - 1) / 2] : (chars[chars.length / 2 - 1] + chars[chars.length / 2]) / 2) : 0;
  const qs = arr(snap && snap.queries).map((q) => str(q)).filter(Boolean);
  const hits = qs.filter((q) => re.test(" " + low(q))).length;
  return {
    products: Math.min(1000, Math.max(0, Math.round(sku))),
    non_listing: nonList,
    text_median: Math.min(100000, med),
    service_hits: Math.min(10, hits)
  };
}

export function modeOf(sig, marker, re) {
  const h = [
    sig.products < H_LIMIT.products,
    sig.non_listing >= H_LIMIT.non_listing,
    sig.text_median >= H_LIMIT.text_median,
    sig.service_hits >= H_LIMIT.service_hits || re.test(" " + low(marker))
  ];
  const veto = sig.non_listing <= VETO.non_listing && sig.products >= VETO.products;
  const n = h.filter(Boolean).length;
  if (!veto && (h[1] || h[3]) && n >= 2) return { mode: "service_like", h, veto, n };
  if (h[0] && sig.non_listing < H_LIMIT.non_listing) return { mode: "thin_category", h, veto, n };
  return { mode: "catalog", h, veto, n };
}

function cmdMode(pos, flags, root) {
  const dir = findDir(pos[0], root);
  if (!dir) die("проект не найден: укажите слаг либо каталог sites/NNN-slug");
  const out = join(dir, "catalog.json");
  if (!existsSync(out)) die("сначала tree: режим категории ставится узлу дерева, а дерева нет");
  let data;
  try { data = JSON.parse(readFileSync(out, "utf8")); } catch (e) { die(`catalog.json не читается: ${e.message}`); }
  if (!arr(data.tree).length) die("в catalog.json нет ни одного узла: пересоберите tree --refresh");

  const serp = readSerp(dir);
  const rules = readRulesYml(join(dir, "catalog-rules.yml"));
  const re = serviceRe([...(rules.get("service_words") || new Map()).values()].flatMap((v) => String(v).split("|")));

  const rows = [], counters = { catalog: 0, service_like: 0, thin_category: 0, measured: 0, veto: 0 };
  for (const n of data.tree) {
    const snap = serp.nodes.get(str(n.id)) || null;
    if (snap && str(snap.marker) && !str(n.marker)) n.marker = plain(snap.marker).slice(0, 120);
    const sig = signalsOf(Number(n.sku) || 0, snap, re);
    const r = modeOf(sig, str(n.marker), re);
    n.signals = sig;
    n.mode = r.mode;
    counters[r.mode]++;
    if (snap && arr(snap.top).length) counters.measured++;
    if (r.veto) counters.veto++;
    rows.push({ id: str(n.id), sig, mode: r.mode, h: r.h, veto: r.veto, seen: !!(snap && arr(snap.top).length) });
  }

  // Посадки узлов, которым режим отменил листинг. Их собрал tree, когда режима еще не
  // было: у thin_category страница закрыта noindex, и canonical посадки указывал бы на
  // закрытую от индексации страницу; у service_like листинга нет вовсе, а фильтр без
  // листинга не существует. Оставить их значило бы посчитать объем работ и цену по
  // страницам, которых не будет.
  const dropModes = new Set(data.tree.filter((n) => ["thin_category", "service_like"].includes(str(n.mode))).map((n) => str(n.id)));
  let droppedLandings = 0;
  if (dropModes.size && arr(data.landings).length) {
    const keep = arr(data.landings).filter((L) => !dropModes.has(str(L.node)));
    droppedLandings = arr(data.landings).length - keep.length;
    data.landings = keep;
    if (data.counts) data.counts.landings = keep.length;
  }
  data.at = today();
  writeCatalog(dir, out, data, "mode");

  // Четыре числа печатаются КОЛОНКОЙ: ровно то, что уедет в ТЗ.
  const pad = (s, n) => { const a = Array.from(String(s)); return a.length >= n ? a.slice(0, n).join("") : a.join("") + " ".repeat(n - a.length); };
  console.log(`[catalog] режим категорий: узлов ${data.tree.length}, из них с замером выдачи ${counters.measured}`);
  console.log(`  ${pad("узел", 26)}${pad("H1 товаров", 12)}${pad("H2 не-лист", 12)}${pad("H3 медиана", 12)}${pad("H4 сервис", 11)}режим`);
  for (const r of rows.slice(0, 40)) {
    console.log(`  ${pad(r.id, 26)}${pad(r.sig.products, 12)}${pad(r.sig.non_listing, 12)}${pad(r.sig.text_median, 12)}${pad(r.sig.service_hits, 11)}${r.mode}${r.seen ? "" : " (без замера)"}`);
  }
  if (rows.length > 40) console.log(`  ... и еще ${rows.length - 40} узлов, все числа лежат в catalog.json`);
  console.log(`  итог: catalog ${counters.catalog}, service_like ${counters.service_like}, thin_category ${counters.thin_category}; вето сработало у ${counters.veto} узлов`);
  if (counters.service_like) console.log(`  service_like - это МАРШРУТИЗАЦИЯ ${counters.service_like} узлов в обычный тракт письма к site-author с потолком 6 блоков, вопросы «как выбрать» берутся из осей фасетов`);
  if (counters.thin_category) console.log(`  thin_category у ${counters.thin_category} узлов: интро, плитка подкатегорий и noindex до наполнения, а не лендинг`);
  if (droppedLandings) console.log(`  ПОСАДОК СНЯТО ${droppedLandings}: висели на узлах thin_category и service_like, у которых листинга нет либо он закрыт. Объем работ теперь ${arr(data.landings).length} посадок, по нему и считается цена.`);
  if (!serp.found) console.log(`  замера выдачи нет (${basename(serp.file)}): H2, H3 и H4 посчитаны по нулю, решение опирается только на число товаров - это видно в колонке «без замера»`);
  console.log(`[catalog] записано: ${out}`);
  console.log("  дальше: node .claude/scripts/site/verify-catalog.mjs <каталог>");
  return 0;
}

// ───────────────────────────────────────────────── 9. CLI

function parseArgs(argv) {
  const flags = {}, pos = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const nx = argv[i + 1];
      if (nx === undefined || nx.startsWith("--")) flags[a.slice(2)] = true;
      else { flags[a.slice(2)] = nx; i++; }
    } else pos.push(a);
  }
  return { flags, pos };
}

function main() {
  const { flags, pos } = parseArgs(process.argv.slice(2));
  const cmd = (pos.shift() || "ingest").toLowerCase();
  const root = flags.root && flags.root !== true ? resolve(String(flags.root)) : repoRoot();
  switch (cmd) {
    case "ingest": return cmdIngest(pos, flags, root);
    case "tree": return cmdTree(pos, flags, root);
    case "mode": return cmdMode(pos, flags, root);
    default: return die(`команда «${cmd}» неизвестна: ingest, tree, mode`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) main();
