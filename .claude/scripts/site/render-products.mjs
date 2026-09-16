#!/usr/bin/env node
// render-products.mjs
// Товарный конвейер режима магазина: csv на входе, csv на выходе, ноль токенов на карточку
// тира B. Пятьсот SKU - самый большой объем во всем конвейере, и это ДАТА-ПАЙПЛАЙН, а не
// пятьсот страниц: маппинг колонок и единиц, разбор атрибутов из названий, выравнивание
// набора полей внутри категории, рендер по шаблонам агента, тиринг и контроль уникальности.
// Писателя на пятьсот карточек не бывает: либо разорение по токенам, либо пятьсот
// одинаковых абзацев, которые поиск пометит малополезным контентом и утянет вниз весь домен.
//
//   node render-products.mjs <слаг|каталог> [--sales <файл>] [--tier-a <файл>]
//                            [--seed "<имя исполнителя>"] [--out <файл>] [--dry]
//
// Читает: project.json (регион, кнопка, факты доставки), attr_map.json (колонки и вердикт),
// catalog.json (узлы, наборы полей, тиры), catalog-rules.yml (шаблоны и варианты фраз агента),
// прайс по attr_map.price, опционально sales.csv (продажи и просмотры).
// Пишет: products_out.csv, products-tasks.json (задания тира A), include-delivery.md
// (ОДИН инклуд на сайт), products-checklist.md (строки сдачи, в том числе имя исполнителя seed).
//
// Порядок внутри карточки ОБРАТНЫЙ привычному, описание идет последним: метатеги и
// характеристики делает формула и данные, а расширенное описание - шаблон агента. Скрипт
// своего маркетингового текста не выдумывает: нет шаблона - нет абзаца.
//
// Exit: 0 чисто | 1 предупреждения | 2 нарушения и отказы.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { today, arr, str, low } from "./_contract.mjs";
import { repoRoot, findDir, plain } from "./queue.mjs";
import {
  readTable, readRulesYml, slugOf, catPath, wordKey, normalName,
  SPECS_MIN, SPECS_MAX, TIER_A_MAX, AXIS_FILL_MIN, VERDICTS
} from "./catalog.mjs";

const die = (msg) => { console.error("[products] " + msg); process.exit(2); };

// ───────────────────────────────────────────────── 0. Пороги и нормы
// Все числа лежат ЗДЕСЬ и печатаются в отчете: карточка, которую отклонили, обязана
// показывать, каким числом ее отклонили.

// Доля варьируемого текста на карточку. Ниже порога карточка не сдается: серия
// однотипных SKU с одинаковой прозой - это малополезный контент на весь раздел.
export const VAR_SHARE_MIN = 0.5;
// Слово считается рамкой серии, если оно есть почти у всех карточек узла. Рамка в
// варьируемое не идет - иначе шаблон сам себе выдал бы уникальность.
export const FRAME_SHARE = 0.9;
// Шингловое перекрытие соседних карточек. Это ПРЕДУПРЕЖДЕНИЕ, а не блокировка: на серии
// однотипных SKU синтаксическая рамка одинакова по конструкции, и блокировка дала бы
// поток принятых нарушений вместо разбора.
export const SHINGLE_WARN = 0.85;
export const SHINGLE_PAIRS = 30;
export const SHINGLE_N = 3;
// Меньше трех вариантов фразы - и чередовать нечего.
export const LEX_MIN = 3;
// Потолок разных значений оси, до которого ищется сокращение-приставка.
export const SYN_SCAN_MAX = 500;

// Нормы блоков карточки из CATALOG.md. Нарушение нормы - строка отчета, не отказ:
// короткая честная карточка законна, длинная - риск.
export const SHORT_MIN = 150, SHORT_MAX = 350;
export const TOP_MIN = 350, TOP_MAX = 900;
export const DESC_MIN = 700, DESC_MAX = 1500;
export const KEY_MAX = 7;
export const H1_MAX = 120, TITLE_MAX = 70, DESCR_MAX = 160;
export const INCLUDE_MIN = 200, INCLUDE_MAX = 550;
export const POPULAR_MIN = 150, POPULAR_MAX = 500;
export const ROWS_MAX = 20000;
export const NOINDEX = "noindex,follow";

// Что в товарную выдачу не печатается НИКОГДА. Правило пропуска звучит не «подставь
// прочерк», а «выброси предложение целиком», поэтому это не таблица замен, а сторож на
// выходе: если такое все-таки собралось, поле гасится и попадает в счет отброшенного.
export const NEVER = /не\s*указан|не\s*задан[оы]?|нет\s*данных|уточняйте|по\s*запросу|\[[^\]]{0,40}\]|\{[a-z0-9_]+\}/i;
const EMPTY_CELL = /^[\s.,;:_-]*$/;

// Семьи единиц: приведение идет ВНУТРИ семьи и только к той единице, которой в категории
// написано большинство значений. Своей «правильной» единицы у скрипта нет - сравнимость
// внутри категории важнее красоты.
export const UNIT_FAM = [
  { id: "len", of: { мм: 1, см: 10, дм: 100, м: 1000 } },
  { id: "mass", of: { г: 1, гр: 1, кг: 1000, т: 1000000 } },
  { id: "pow", of: { вт: 1, квт: 1000 } },
  { id: "vol", of: { мл: 1, л: 1000 } },
  { id: "press", of: { кпа: 1, бар: 100, мпа: 1000 } }
];
// Написание единицы: «ВТ», «Вт.» и «вт» это одна единица, и в таблице характеристик они
// обязаны выглядеть одинаково.
export const UNIT_FORM = {
  мм: "мм", см: "см", дм: "дм", м: "м", г: "г", гр: "г", кг: "кг", т: "т",
  вт: "Вт", квт: "кВт", в: "В", а: "А", гц: "Гц", л: "л", мл: "мл",
  кпа: "кПа", бар: "бар", мпа: "МПа", дб: "дБ", "об/мин": "об/мин", шт: "шт",
  "м2": "м2", "м3": "м3", "°c": "°C", c: "°C"
};
// Имя поля на языке покупателя. Первым идет имя из правил агента (раздел axes) и имя
// колонки прайса, это словарь на самый частый случай: атрибут, разобранный из названия,
// колонки в прайсе не имеет, а «power 45 Вт» в таблице характеристик читается как отладка.
export const ATTR_LABEL = {
  brand: "Бренд", model: "Модель", series: "Серия", type: "Тип", purpose: "Назначение",
  color: "Цвет", material: "Материал", country: "Страна", warranty: "Гарантия",
  power: "Мощность", voltage: "Напряжение", current: "Ток", frequency: "Частота",
  diameter: "Диаметр", length: "Длина", width: "Ширина", height: "Высота", depth: "Глубина",
  weight: "Вес", volume: "Объем", size: "Размер", pressure: "Давление", noise: "Уровень шума",
  head: "Напор", mount: "Монтаж"
};

// Единица в названии - подсказка об атрибуте. Разбор идет ТОЛЬКО когда кандидат в наборе
// полей категории ровно один: «180 мм» у насоса это длина, у трубы - диаметр, и угадывать
// между ними нечем.
export const DERIVE_UNIT_ATTR = {
  вт: ["power"], квт: ["power"], в: ["voltage"], а: ["current"], гц: ["frequency"],
  кг: ["weight"], г: ["weight"], т: ["weight"], л: ["volume"], мл: ["volume"],
  мм: ["diameter", "length", "width", "height", "depth", "size"],
  см: ["length", "width", "height", "depth", "size"],
  м: ["length", "height", "depth", "head"],
  бар: ["pressure"], мпа: ["pressure"], дб: ["noise"]
};

// ───────────────────────────────────────────────── 1. Мелочи
const round2 = (x) => Math.round(x * 100) / 100;
const chars = (s) => Array.from(String(s == null ? "" : s)).length;
const uniq = (a) => [...new Set(arr(a))];
const pct = (x) => Math.round(x * 100);

// Обрезка по слову: обрубок посреди слова заказчик видит сразу.
export function cut(s, max) {
  const a = Array.from(plain(s));
  if (a.length <= max) return a.join("");
  const t = a.slice(0, max).join("");
  const sp = t.lastIndexOf(" ");
  return (sp > max * 0.6 ? t.slice(0, sp) : t).replace(/[\s,;:-]+$/, "");
}

// Устойчивый выбор варианта фразы: индекс считается от артикула, а не от номера строки.
// Позиционное чередование переставляло бы тексты при любой пересортировке прайса.
export function hash32(s) {
  let h = 5381;
  const t = String(s == null ? "" : s);
  for (let i = 0; i < t.length; i++) h = ((h * 33) ^ t.charCodeAt(i)) >>> 0;
  return h >>> 0;
}

// Число в русском виде: запятая, без хвостовых нулей.
const numOut = (n) => {
  const r = Math.abs(n) >= 100 ? Math.round(n) : Math.round(n * 1000) / 1000;
  return String(r).replace(".", ",");
};

// ───────────────────────────────────────────────── 2. Единицы и синонимы
// Значение ячейки разбирается на число и единицу только целиком: «1,5 кВт» разбирается,
// «кабель 1,5 кВт в комплекте» - нет, это текст, и трогать его нельзя.
export function parseVal(v) {
  const s = plain(v);
  const m = s.match(/^(-?\d[\d\s]*(?:[.,]\d+)?)\s*([а-яa-z°][а-яa-z0-9°/.]{0,6})?\.?$/i);
  if (!m) return null;
  const num = Number(m[1].replace(/\s+/g, "").replace(",", "."));
  if (!Number.isFinite(num)) return null;
  const unit = low(m[2] || "").replace(/\.$/, "");
  return { num, unit };
}

const famOf = (unit) => UNIT_FAM.find((f) => Object.prototype.hasOwnProperty.call(f.of, unit)) || null;
export const unitForm = (u) => (u ? (UNIT_FORM[low(u)] || plain(u)) : "");

// Приведение единиц внутри одной колонки одной категории. Возвращает карту
// «исходное значение -> приведенное» и счет приведенного: число уходит в отчет, потому
// что молча переписанный прайс - это спор с заказчиком, о котором он не знает.
export function unifyUnits(values) {
  const parsed = values.map((v) => ({ v, p: parseVal(v) })).filter((x) => x.p && x.p.unit);
  const fams = new Map();
  for (const x of parsed) {
    const f = famOf(x.p.unit);
    if (!f) continue;
    if (!fams.has(f.id)) fams.set(f.id, new Map());
    const c = fams.get(f.id);
    c.set(x.p.unit, (c.get(x.p.unit) || 0) + 1);
  }
  const map = new Map();
  let moved = 0;
  for (const [famId, counts] of fams) {
    const fam = UNIT_FAM.find((f) => f.id === famId);
    const dom = [...counts.entries()].sort((a, b) => b[1] - a[1] || fam.of[a[0]] - fam.of[b[0]])[0][0];
    for (const x of parsed) {
      if (!x.p.unit || famOf(x.p.unit) !== fam || x.p.unit === dom) continue;
      const n = (x.p.num * fam.of[x.p.unit]) / fam.of[dom];
      // Слишком мелкое или слишком крупное после приведения не приводим: «0,0004 кг»
      // в таблице характеристик хуже исходных «0,4 г».
      if (!Number.isFinite(n) || Math.abs(n) < 0.001 || Math.abs(n) > 1e9) continue;
      map.set(x.v, `${numOut(n)} ${unitForm(dom)}`);
      moved++;
    }
  }
  // Написание единицы приводится всегда, даже когда пересчета не было.
  for (const x of parsed) {
    if (map.has(x.v)) continue;
    const want = `${numOut(x.p.num)} ${unitForm(x.p.unit)}`;
    if (want !== plain(x.v)) map.set(x.v, want);
  }
  return { map, moved };
}

// Ключ сравнения значений: регистр, кавычки, хвостовая точка и пробелы вокруг дефиса
// на выбор покупателя не влияют, а тремя написаниями одного значения ось разваливается.
export const synKey = (v) => plain(v).toLowerCase()
  .replace(/[«»"'()]/g, "").replace(/\s*-\s*/g, "-").replace(/[.,;:]+$/, "").replace(/\s+/g, " ").trim();

// Сведение синонимов внутри колонки. Машинных правил два, и оба проверяемые: одинаковый
// ключ и сокращение, которое является началом ровно одного полного значения этой же
// колонки («нерж.» при наличии «нержавеющая сталь»). Все остальное - работа агента
// разделом syn правил, своих синонимов скрипт не придумывает.
export function unifySyn(values, syn) {
  const groups = new Map();
  for (const v of values) {
    const k = synKey(v);
    if (!k) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(v);
  }
  const keys = [...groups.keys()];
  const into = new Map();
  // Поиск сокращения квадратичен по числу РАЗНЫХ значений оси. У оси их десятки, но если
  // в колонку попало что-то похожее на название, счет идет на тысячи - тогда этот проход
  // пропускается, а сведение по правилам агента работает дальше.
  if (keys.length <= SYN_SCAN_MAX) {
    for (const k of keys) {
      if (chars(k) > 8) continue;
      const hits = keys.filter((o) => o !== k && o.startsWith(k) && chars(o) > chars(k));
      if (hits.length === 1) into.set(k, hits[0]);
    }
  }
  const canon = new Map();
  for (const k of keys) {
    let target = k, guard = 0;
    while (into.has(target) && guard++ < 5) target = into.get(target);
    const named = syn.get(target) || syn.get(k) || "";
    const forms = groups.get(target) || groups.get(k) || [];
    // Счет написаний считается один раз: сравнение внутри сортировки давало бы квадрат
    // на серии из тысячи одинаковых значений.
    const freq = new Map();
    for (const f of forms) freq.set(f, (freq.get(f) || 0) + 1);
    const best = named || [...freq.keys()].sort((a, b) => freq.get(b) - freq.get(a) || chars(b) - chars(a) || a.localeCompare(b))[0];
    canon.set(k, plain(best));
  }
  const map = new Map();
  let merged = 0;
  for (const v of uniq(values)) {
    const to = canon.get(synKey(v));
    if (to && to !== plain(v)) { map.set(v, to); merged++; }
  }
  return { map, merged };
}

// ───────────────────────────────────────────────── 3. Разбор атрибутов из названия
// Работает только при вердикте derivable_from_name: если в прайсе есть колонки, название
// вторично, а если вердикт ниже - разбирать нечего, и режим честно просит характеристики.
export function deriveFromName(name, set, brands) {
  const out = new Map();
  const s = plain(name);
  if (!s) return out;
  const put = (attr, value) => { if (set.includes(attr) && !out.has(attr)) out.set(attr, value); };

  // Диаметр и давление в трубной записи. Это не догадка по единице, а прямая запись.
  const dn = s.match(new RegExp("(?:^|[^а-яa-z0-9])(?:ду|dn)\\s?(\\d{1,4})", "i"));
  if (dn) put("diameter", `${dn[1]} мм`);
  const pn = s.match(new RegExp("(?:^|[^а-яa-z0-9])(?:ру|pn)\\s?(\\d{1,3})", "i"));
  if (pn) put("pressure", `${pn[1]} бар`);

  // Пробел внутри числа тут запрещен намеренно: в «Ду25 45 Вт» он склеил бы «25 45» в
  // две с половиной тысячи ватт. Разделитель разрядов в названии товара не встречается,
  // а склейка двух чисел в одно - встречается в каждом втором прайсе.
  for (const m of s.matchAll(/(\d+(?:[.,]\d+)?)\s*(мм|см|м|кг|гр|г|т|л|мл|квт|вт|в|а|гц|бар|мпа|дб)(?![а-яa-z])/gi)) {
    const unit = low(m[2]);
    const cand = arr(DERIVE_UNIT_ATTR[unit]).filter((a) => set.includes(a));
    // Кандидатов больше одного - пропуск. Выдуманное соответствие единицы и поля дороже
    // пустой ячейки: пустую видно в отчете, выдуманную не видно нигде.
    if (cand.length !== 1) continue;
    const num = Number(m[1].replace(/\s+/g, "").replace(",", "."));
    if (!Number.isFinite(num)) continue;
    put(cand[0], `${numOut(num)} ${unitForm(unit)}`);
  }
  if (set.includes("brand")) {
    const b = s.match(/\b[A-Za-z][A-Za-z&-]{2,}\b/);
    if (b && brands.has(low(b[0]))) put("brand", brands.get(low(b[0])));
  }
  if (set.includes("model")) {
    const mm = s.match(/\b[A-Za-z][A-Za-z0-9-]*\d[A-Za-z0-9-]*\b/);
    if (mm) put("model", plain(mm[0]));
  }
  return out;
}

// Бренды прайса: латинское слово, встреченное не меньше трех раз. Однократная латиница в
// названии - это чаще всего модель, а не марка. Двусловная марка склеивается обратно:
// «Pro Aqua» одним словом дает «Pro», и в характеристиках стоит половина бренда.
export function brandsOf(names) {
  const one = new Map(), two = new Map();
  for (const n of names) {
    const m = str(n).match(/\b([A-Za-z][A-Za-z&-]{2,})(\s+[A-Z][A-Za-z&-]{2,})?\b/);
    if (!m) continue;
    const k = low(m[1]);
    if (!one.has(k)) one.set(k, { n: 0, form: plain(m[1]) });
    one.get(k).n++;
    if (m[2]) {
      const full = plain(m[1] + m[2]);
      if (!two.has(k)) two.set(k, new Map());
      two.get(k).set(full, (two.get(k).get(full) || 0) + 1);
    }
  }
  const out = new Map();
  for (const [k, v] of one) {
    if (v.n < 3) continue;
    const pair = [...(two.get(k) || new Map()).entries()].sort((a, b) => b[1] - a[1])[0];
    out.set(k, pair && pair[1] >= 3 ? pair[0] : v.form);
  }
  return out;
}

// ───────────────────────────────────────────────── 4. Рендер с правилом пропуска
// Нет значения - предложение выбрасывается ЦЕЛИКОМ. «Не указано», прочерк и квадратный
// плейсхолдер в товарную выдачу не печатаются никогда, и это не смягчается ничем: пустая
// строка честна, прочерк в карточке читается как «у них бардак в остатках».
export function renderSkip(tpl, vars) {
  const raw = plain(tpl);
  if (!raw) return { text: "", dropped: [] };
  const parts = String(raw).split(/(?<=[.!?])\s+/).filter((s) => s.trim());
  const keep = [], dropped = [];
  for (const s of parts) {
    const slots = [...s.matchAll(/\{([a-z0-9_]+)\}/gi)].map((m) => m[1]);
    const miss = slots.filter((k) => !str(vars[k]));
    if (miss.length) { dropped.push(...miss); continue; }
    keep.push(s.replace(/\{([a-z0-9_]+)\}/gi, (_, k) => str(vars[k])));
  }
  // Значение слота часто уже кончается точкой («8400 руб.»), а шаблон ставит свою.
  // Двойная точка в карточке - это не мелочь: ее видно в выдаче, в сниппете и в письме.
  let text = plain(keep.join(" "))
    .replace(/\s+([.,;:!?])/g, "$1")
    .replace(/([.!?])[.!?]+/g, "$1")
    .replace(/,\s*([.!?])/g, "$1")
    .replace(/^[\s,;:-]+/, "");
  if (NEVER.test(text)) { dropped.push("сторож выдачи"); text = ""; }
  return { text, dropped };
}

// Пара «поле - значение» для таблицы характеристик. Единица, уже названная в имени поля,
// из значения убирается: «Мощность, Вт | 45 Вт» читается как опечатка.
export function pairOut(label, value) {
  const l = plain(label), v = plain(value);
  const tail = l.match(/[,(]\s*([а-яa-z°/.0-9]+)\s*\)?$/i);
  if (tail) {
    const u = low(tail[1]).replace(/[).]+$/, "");
    const cutRe = new RegExp("\\s*" + u.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\.?$", "i");
    // full - значение с единицей: в таблице единица стоит в имени поля, а в строке
    // решающих параметров имени поля нет, и «диаметр 25» без «мм» там читается как обрубок.
    if (cutRe.test(v)) return { label: l, value: plain(v.replace(cutRe, "")), full: v };
  }
  return { label: l, value: v, full: v };
}

// Имя поля в строку решающих параметров: без единицы в скобках и со строчной буквы,
// потому что это середина фразы, а не заголовок колонки.
const keyLabel = (label) => {
  const s = plain(label).replace(/[,(]\s*[а-яa-z°/.0-9]+\s*\)?$/i, "").trim();
  return s ? s.slice(0, 1).toLowerCase() + s.slice(1) : s;
};

// ───────────────────────────────────────────────── 5. Уникальность
const words = (t) => plain(t).toLowerCase().split(/[^а-яa-z0-9]+/i).filter(Boolean);

// Доля варьируемого текста: знаки слов, которых НЕТ почти у всех соседей по узлу. Рамка
// серии (слово у 90 процентов карточек) в варьируемое не идет - иначе шаблон выдал бы
// сам себе уникальность на повторяющемся слове.
export function varShares(texts) {
  const toks = texts.map(words);
  const n = toks.length;
  const df = new Map();
  for (const t of toks) for (const w of new Set(t)) df.set(w, (df.get(w) || 0) + 1);
  const frame = new Set(n >= 2 ? [...df.entries()].filter(([, c]) => c / n >= FRAME_SHARE).map(([w]) => w) : []);
  return toks.map((t) => {
    const all = t.reduce((s, w) => s + w.length, 0);
    if (!all) return 0;
    const varied = t.filter((w) => !frame.has(w)).reduce((s, w) => s + w.length, 0);
    return round2(varied / all);
  });
}

export function shingles(text, n = SHINGLE_N) {
  const w = words(text), out = new Set();
  for (let i = 0; i + n <= w.length; i++) out.add(w.slice(i, i + n).join(" "));
  return out;
}
export function overlap(a, b) {
  if (!a.size || !b.size) return 0;
  let hit = 0;
  for (const s of a) if (b.has(s)) hit++;
  return round2(hit / Math.min(a.size, b.size));
}

// ───────────────────────────────────────────────── 6. Вход
function loadJson(p, what) {
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, "utf8").replace(/^﻿/, "")); }
  catch (e) { return die(`${what} не читается: ${e.message}`); }
}

// Прайс перечитывается ПО attr_map.json: строка шапки, лист и номера колонок определены
// шагом ingest, и второй разбор того же файла с ними бы разошелся. Восемь строк копии
// дешевле, чем править чужой файл ради одного экспорта.
function replay(dir, map) {
  const p = map.price || {};
  const file = resolve(dir, str(p.file));
  if (!existsSync(file)) die(`прайса нет на месте: attr_map.json ссылается на ${str(p.file)}`);
  let table;
  try { table = readTable(file, 0, str(p.sheet)); } catch (e) { die(`прайс ${basename(file)} не разобран: ${e.message}`); }
  const h = Math.max(1, Number(p.header_row) || 1) - 1;
  let body = table.rows.slice(h + 1).filter((r) => r.some((c) => str(c) !== ""));
  if (!body.length) die(`под шапкой прайса ${basename(file)} нет ни одной строки: перезапустите catalog.mjs ingest --refresh`);
  const cut = body.length > ROWS_MAX;
  if (cut) body = body.slice(0, ROWS_MAX);
  const cols = arr(map.cols);
  if (!cols.length) die("в attr_map.json нет колонок: перезапустите catalog.mjs ingest --refresh");
  return { body, cols, file, cut };
}

// Продажи и просмотры. Отдельный файл, а не колонка прайса: выгрузка продаж живет в
// учетной системе и приезжает позже прайса, если приезжает вообще.
function readSales(dir, flag) {
  const file = flag && flag !== true ? resolve(String(flag)) : join(dir, "sales.csv");
  const out = { sales: new Map(), views: new Map(), file, found: false };
  if (!existsSync(file)) return out;
  let table;
  try { table = readTable(file); } catch (e) { return die(`sales.csv не разобран: ${e.message}`); }
  const rows = table.rows.filter((r) => r.some((c) => str(c) !== ""));
  if (rows.length < 2) return out;
  const head = rows[0].map((c) => low(c));
  const find = (re) => head.findIndex((h) => re.test(h));
  const iS = find(/артикул|код|sku/), iSale = find(/продаж|заказ|sales|orders/), iView = find(/просмотр|views|показ/);
  if (iS < 0) return out;
  for (const r of rows.slice(1)) {
    const k = low(r[iS]);
    if (!k) continue;
    const num = (i) => { const v = Number(String(str(r[i])).replace(/\s+/g, "").replace(",", ".")); return Number.isFinite(v) ? v : 0; };
    if (iSale >= 0) out.sales.set(k, num(iSale));
    if (iView >= 0) out.views.set(k, num(iView));
  }
  out.found = true;
  return out;
}

function readList(flag) {
  if (!flag || flag === true) return new Set();
  const p = resolve(String(flag));
  if (!existsSync(p)) die(`списка клиента нет по адресу ${p}`);
  return new Set(readFileSync(p, "utf8").replace(/^﻿/, "").split(/[\r\n;,]+/).map((s) => low(s)).filter(Boolean));
}

// Узел строки. Первичный ключ - адрес, собранный из пути раздела ровно так же, как его
// собирал catalog.mjs: узел дерева и ячейка «Раздел» иначе разъедутся, и половина прайса
// повиснет вне дерева.
function nodeIndex(tree) {
  const byId = new Map(), byUrl = new Map(), byWord = new Map();
  for (const n of arr(tree)) {
    byId.set(str(n.id), n);
    byUrl.set(str(n.url), n);
    for (const k of [wordKey(str(n.name && n.name.nom)), wordKey(str(n.id).replace(/-/g, " "))]) {
      if (k && !byWord.has(k)) byWord.set(k, n);
    }
  }
  return { byId, byUrl, byWord };
}
function nodeOf(idx, path) {
  if (!path.length) return null;
  const url = "/" + path.map((p) => slugOf(p)).join("/") + "/";
  const last = path[path.length - 1];
  return idx.byUrl.get(url) || idx.byId.get(slugOf(last))
    || idx.byWord.get(wordKey(normalName(last))) || idx.byWord.get(wordKey(last)) || null;
}

// ───────────────────────────────────────────────── 7. Инклуд доставки, оплаты и гарантии
// ОДИН инклуд на сайт, а не текст в каждой карточке. Пятьсот копий одного абзаца - это
// пятьсот страниц с одинаковым хвостом, и уникальность каждой падает на ровном месте.
const INCLUDE_RE = /доставк|самовывоз|оплат|гарант|возврат|обмен|склад/i;
export function includeText(project) {
  const lines = [];
  for (const f of arr(project.facts)) {
    if (str(f.publish) !== "yes") continue;
    const label = plain(f.label), value = plain(f.value);
    if (!value || EMPTY_CELL.test(value)) continue;            // правило пропуска
    if (!INCLUDE_RE.test(`${label} ${value}`)) continue;
    const line = /[.!?]$/.test(value) ? `${label}: ${value}` : `${label}: ${value}.`;
    if (NEVER.test(line)) continue;
    lines.push(line);
  }
  const out = [];
  for (const l of lines) {
    if (chars(out.concat(l).join("\n")) > INCLUDE_MAX) break;
    out.push(l);
  }
  return out;
}

// ───────────────────────────────────────────────── 8. Основной проход
function cmdRender(pos, flags, root) {
  const dir = findDir(pos[0], root);
  if (!dir) die("проект не найден: укажите слаг либо каталог sites/NNN-slug");

  const project = loadJson(join(dir, "project.json"), "project.json");
  if (!project) die(`в ${dir} нет project.json: товарный конвейер идет после гейта /site analiz`);
  const type = str(project.business && project.business.type);
  if (type !== "shop" && type !== "both") {
    die(`business.type = ${type || "не задан"}: товарный конвейер включают только shop и both, и переключатель ровно один`);
  }
  const map = loadJson(join(dir, "attr_map.json"), "attr_map.json");
  if (!map) die("сначала catalog.mjs ingest: без вердикта готовности данных рендерить нечего");
  const verdict = str(map.verdict);
  if (!VERDICTS.includes(verdict)) die(`в attr_map.json вердикт «${verdict || "пусто"}» вне списка: ${VERDICTS.join(", ")}`);
  const cat = loadJson(join(dir, "catalog.json"), "catalog.json");
  if (!cat || !arr(cat.tree).length) die("сначала catalog.mjs tree и mode: набор полей и тиры узла приходят из catalog.json");

  const rules = readRulesYml(join(dir, "catalog-rules.yml"));
  const sec = (name) => rules.get(name) || new Map();
  const ruleOf = (name, key) => str(sec(name).get(key));
  const { body, cols, file, cut: cutRows } = replay(dir, map);
  const sales = readSales(dir, flags.sales);
  const clientList = readList(flags["tier-a"]);
  const notes = [], bad = [];

  const colBy = (role) => cols.find((c) => str(c.role) === role) || null;
  const nameCol = colBy("name"), skuCol = colBy("sku"), priceCol = colBy("price");
  const catCol = colBy("category"), stockCol = colBy("stock");
  const attrCols = cols.filter((c) => str(c.role) === "attr" || str(c.role) === "brand");
  const colLabel = new Map(attrCols.map((c) => [str(c.attr), plain(c.col) || str(c.attr)]));
  const colOfAttr = new Map(attrCols.map((c) => [str(c.attr), Number(c.i)]));
  // Имя поля на языке покупателя: правила агента, потом шапка прайса, потом словарь
  // канонических имен. Голый идентификатор - последнее средство, и он виден в отчете.
  const axisLabel = new Map();
  for (const [k, line] of (rules.get("axes") || new Map())) {
    const v = plain(String(line).split("|")[0]);
    if (v) axisLabel.set(str(k), v);
  }
  const labelOf = (a) => axisLabel.get(a) || colLabel.get(a) || ATTR_LABEL[a] || a;
  if (!nameCol) notes.push("колонки наименования в прайсе нет: H1 карточки собирать не из чего, весь прайс уйдет тиром C");

  // --- раскладка строк по узлам
  const business = project.business || {};
  const rootFallback = normalName(arr(business.assortment)[0] || str(business.what) || str(project.slug) || "каталог");
  const idx = nodeIndex(cat.tree);
  const byNode = new Map();
  let orphan = 0;
  for (const r of body) {
    const path = catCol ? catPath(r[catCol.i]) : [];
    const n = nodeOf(idx, path.length ? path : [rootFallback]);
    if (!n) { orphan++; continue; }
    const id = str(n.id);
    if (!byNode.has(id)) byNode.set(id, { node: n, rows: [] });
    byNode.get(id).rows.push(r);
  }
  if (orphan) {
    bad.push(`позиций вне дерева ${orphan} из ${body.length}: раздел прайса не сошелся ни с одним узлом catalog.json, карточки по ним не рендерились - пересоберите catalog.mjs tree --refresh`);
  }

  // --- синонимы агента: канон|вариант|вариант
  const synMap = new Map();
  for (const [, line] of sec("syn")) {
    const p = String(line).split("|").map((x) => plain(x)).filter(Boolean);
    if (p.length < 2) continue;
    for (const v of p.slice(1)) synMap.set(synKey(v), p[0]);
    synMap.set(synKey(p[0]), p[0]);
  }

  // --- варианты фраз агента
  const lex = new Map();
  for (const [k, line] of sec("lex")) {
    const v = String(line).split("|").map((x) => plain(x)).filter(Boolean);
    if (v.length) lex.set(k, v);
  }
  const thinLex = [...lex.entries()].filter(([, v]) => v.length < LEX_MIN).map(([k]) => k);

  // --- шаблоны карточки: своего маркетингового текста скрипт не выдумывает
  const T = {
    h1: ruleOf("product", "h1") || "{name}",
    title: ruleOf("product", "title") || "{h1} - цена и наличие",
    description: ruleOf("product", "description") || "",
    short: ruleOf("product", "short") || "",
    desc: ruleOf("product", "desc") || ""
  };
  const ownFormula = !!ruleOf("product", "h1") || !!ruleOf("product", "title");
  const cta = plain((project.offer && project.offer.promise && project.offer.promise.cta) || "");
  const region = plain(business.region).slice(0, 60);
  const brands = brandsOf(nameCol ? body.map((r) => str(r[nameCol.i])) : []);
  const noFacets = verdict === "must_request_from_client" || verdict === "impossible";

  // Спрос для тира A: список клиента, дальше продажи, дальше просмотры. Ничего из этого
  // нет - тира A не будет вовсе: «топ-30» без числа, по которому он топ, это не топ, а
  // тридцать карточек, выбранных порядком строк в выгрузке.
  const sumOf = (m) => [...m.values()].reduce((s, x) => s + x, 0);
  const demandSrc = clientList.size ? "список клиента"
    : (sales.sales.size && sumOf(sales.sales) > 0) ? `${basename(sales.file)}, продажи`
      : (sales.views.size && sumOf(sales.views) > 0) ? `${basename(sales.file)}, просмотры` : "";
  const demandOf = (code, name) => {
    const k = low(code);
    if (clientList.size) return clientList.has(k) || clientList.has(low(name)) ? 1 : 0;
    if (sales.sales.size && sumOf(sales.sales) > 0) return sales.sales.get(k) || 0;
    if (sales.views.size && sumOf(sales.views) > 0) return sales.views.get(k) || 0;
    return 0;
  };

  // --- счетчики отчета
  const stat = {
    unitsMoved: 0, synMerged: 0, derived: new Map(), dropSlot: new Map(),
    outOfSet: 0, outOfSetCards: 0, setThin: 0, noSet: 0, noFields: 0, guard: 0
  };
  const setLines = [], cards = [];

  for (const [, g] of byNode) {
    const n = g.node, rows = g.rows;
    const nodeSpecs = arr(n.specs).map((s) => str(s)).filter(Boolean);
    let set = nodeSpecs;
    if (!set.length) {
      // Набора нет - берем поля, которые у этой категории реально заполнены. Выдуманное
      // поле в наборе означает прочерк в выдаче, а прочерков в выдаче не бывает.
      set = attrCols
        .map((c) => ({ a: str(c.attr), f: rows.filter((r) => str(r[c.i]) !== "").length / (rows.length || 1) }))
        .filter((x) => x.f > 0).sort((a, b) => b.f - a.f).map((x) => x.a);
      if (set.length) stat.noSet++;
    }
    set = uniq(set).slice(0, SPECS_MAX);
    if (set.length && set.length < SPECS_MIN) stat.setThin++;
    if (!set.length) stat.noFields++;
    // Имя поля у опубликованной оси узла уже названо клиентским языком - оно старше
    // общего словаря.
    const flab = new Map(arr(n.facets).map((f) => [str(f.attr), plain(f.label)]).filter(([, v]) => v));
    const lab = (a) => flab.get(a) || labelOf(a);

    // --- нормализация значений по колонке ЭТОЙ категории
    const norm = new Map();   // attr -> Map(исходное -> приведенное)
    for (const a of set) {
      const i = colOfAttr.get(a);
      if (i === undefined) continue;
      const vals = rows.map((r) => str(r[i])).filter((v) => v !== "" && !EMPTY_CELL.test(v));
      const u = unifyUnits(vals);
      const afterUnits = vals.map((v) => u.map.get(v) || v);
      const s = unifySyn(afterUnits, synMap);
      const both = new Map();
      for (const v of uniq(vals)) {
        const step1 = u.map.get(v) || v;
        both.set(v, s.map.get(step1) || step1);
      }
      norm.set(a, both);
      stat.unitsMoved += u.moved;
      stat.synMerged += s.merged;
    }

    // --- значения карточки: прайс, потом разбор названия, потом правило пропуска
    const filledBy = new Map(set.map((a) => [a, 0]));
    const built = [];
    for (const r of rows) {
      const name = nameCol ? plain(r[nameCol.i]) : "";
      const code = skuCol ? plain(r[skuCol.i]) : "";
      const vals = new Map();
      for (const a of set) {
        const i = colOfAttr.get(a);
        if (i === undefined) continue;
        const raw = plain(r[i]);
        if (!raw || EMPTY_CELL.test(raw) || NEVER.test(raw)) continue;
        const v = (norm.get(a) && norm.get(a).get(str(r[i]))) || raw;
        vals.set(a, v);
      }
      if (verdict === "derivable_from_name" && name) {
        for (const [a, v] of deriveFromName(name, set, brands)) {
          if (vals.has(a)) continue;
          vals.set(a, v);
          stat.derived.set(a, (stat.derived.get(a) || 0) + 1);
        }
      }
      // Значение вне набора категории в выдачу не идет: разные наборы полей у соседних
      // моделей означают, что сравнить нельзя, а человек уходит туда, где можно.
      let extra = 0;
      for (const c of attrCols) {
        const a = str(c.attr);
        if (set.includes(a)) continue;
        if (plain(r[c.i]) && !EMPTY_CELL.test(plain(r[c.i]))) extra++;
      }
      if (extra) { stat.outOfSet += extra; stat.outOfSetCards++; }
      for (const a of vals.keys()) filledBy.set(a, (filledBy.get(a) || 0) + 1);
      built.push({ r, name, code, vals });
    }

    // --- расхождение набора печатается строкой, а не чинится молча. Поля, которого в
    // прайсе нет вовсе, и поля, заполненного у части позиций, - разные разговоры с
    // заказчиком: первое запрашивают, второе дозаполняют.
    for (const a of set) {
      const has = colOfAttr.has(a);
      const n0 = filledBy.get(a) || 0;
      const f = rows.length ? n0 / rows.length : 0;
      if (!has && !n0) setLines.push(`${n.id} / ${a}: поля нет в прайсе ни одной колонкой - запрашивается у заказчика, в карточке строки не будет`);
      else if (f < AXIS_FILL_MIN) setLines.push(`${n.id} / ${a}: заполнено ${n0} из ${rows.length} карточек (${pct(f)} процентов) - у остальных строка не печатается`);
    }

    // --- тиры. C считается по данным той же лестницей, что в catalog.mjs: без имени,
    // без цены либо без единого поля набора карточка минимальная и закрыта noindex.
    const isC = (c) => !c.name || (priceCol && !plain(c.r[priceCol.i])) || (!noFacets && set.length ? c.vals.size === 0 : false);
    const quota = noFacets ? 0 : Math.max(0, Math.min(Number((n.tier || {}).a) || 0, TIER_A_MAX));
    const dem = (c) => demandOf(c.code, c.name);
    const good = built.filter((c) => !isC(c)).sort((a, b) => dem(b) - dem(a) || a.name.localeCompare(b.name));
    const aSet = new Set();
    if (quota && demandSrc) for (const c of good.slice(0, quota)) if (dem(c) > 0) aSet.add(c);

    for (const c of built) {
      const tier = isC(c) ? "C" : aSet.has(c) ? "A" : "B";
      const price = priceCol ? plain(c.r[priceCol.i]) : "";
      const stock = stockCol ? plain(c.r[stockCol.i]) : "";
      const specs = [];
      for (const a of set) {
        if (!c.vals.has(a)) continue;                       // правило пропуска
        const p = pairOut(lab(a), c.vals.get(a));
        if (p.value && !NEVER.test(p.value)) specs.push(p);
      }
      const key = specs.slice(0, KEY_MAX);
      const vars = {
        name: c.name, code: c.code, cat: plain(n.name && n.name.nom), region,
        nom: plain(n.name && n.name.nom), gen: plain(n.name && n.name.gen), acc: plain(n.name && n.name.acc),
        price: price ? `${price} руб.` : "", stock, cta,
        key: key.length ? `${keyLabel(key[0].label)} ${key[0].full}` : ""
      };
      for (const [a, v] of c.vals) vars[a] = v;
      for (const [k, v] of lex) vars[k] = v[hash32(c.code || c.name) % v.length];

      const rh = renderSkip(T.h1, vars);
      const h1 = cut(rh.text || c.name, H1_MAX);
      const rt = renderSkip(T.title, { ...vars, h1 });
      const rd = renderSkip(T.description, { ...vars, h1, title: rt.text });
      const short = tier === "B" ? renderSkip(T.short, vars) : { text: "", dropped: [] };
      const long = tier === "B" ? renderSkip(T.desc, vars) : { text: "", dropped: [] };
      for (const s of [...rh.dropped, ...rt.dropped, ...rd.dropped, ...short.dropped, ...long.dropped]) {
        stat.dropSlot.set(s, (stat.dropSlot.get(s) || 0) + 1);
      }

      cards.push({
        node: n, tier, code: c.code, name: c.name, price, stock, specs,
        h1, title: cut(rt.text, TITLE_MAX) || h1, description: cut(rd.text, DESCR_MAX),
        short: cut(short.text, SHORT_MAX), desc: cut(long.text, DESC_MAX),
        key, vals: c.vals
      });
    }
  }

  if (!cards.length) die("ни одной карточки не собрано: проверьте, что раздел прайса сходится с деревом catalog.json");

  // --- адреса карточек: уникальны по каталогу, иначе вторая карточка перезапишет первую
  {
    const taken = new Set();
    for (const c of cards) {
      const base = slugOf(c.code || c.name, 60) || "tovar";
      let s = base, k = 2;
      while (taken.has(s)) s = `${base}-${k++}`;
      taken.add(s);
      c.url = `${plain(c.node.url) || "/"}${s}/`.slice(0, 300);
    }
  }

  // --- дубль метатега: два артикула с одинаковым Title - это два адреса, которые
  // конкурируют за один запрос, и выигрывает ни один. Чинится формулой в правилах либо
  // названием в прайсе, поэтому тут предупреждение с именами, а не молчаливое склеивание.
  const dupTitle = [];
  {
    const seen = new Map();
    for (const c of cards) {
      const k = low(c.title);
      if (!k) continue;
      if (seen.has(k)) dupTitle.push(`${c.code || c.name} и ${seen.get(k)}`);
      else seen.set(k, c.code || c.name);
    }
  }

  // --- уникальность: доля варьируемого блокирует, шингл предупреждает
  const blocked = [];
  const proseBy = new Map();
  for (const c of cards) {
    if (c.tier !== "B" || !(c.short || c.desc)) continue;
    const k = str(c.node.id);
    if (!proseBy.has(k)) proseBy.set(k, []);
    proseBy.get(k).push(c);
  }
  for (const [, mine] of proseBy) {
    if (!mine.length) continue;
    const shares = varShares(mine.map((c) => `${c.short} ${c.desc}`));
    mine.forEach((c, i) => {
      c.varShare = shares[i];
      if (shares[i] < VAR_SHARE_MIN) {
        // Проза заблокирована, данные остаются: метатеги, характеристики, цена и наличие
        // это те самые 90 процентов ранжирования, и терять их из-за абзаца незачем.
        c.short = ""; c.desc = ""; c.blocked = true;
        blocked.push(c);
      }
    });
  }
  const shingleHits = [];
  {
    const prose = cards.filter((c) => c.short || c.desc);
    const step = Math.max(1, Math.floor((prose.length - 1) / SHINGLE_PAIRS));
    let seen = 0;
    for (let i = 0; i + 1 < prose.length && seen < SHINGLE_PAIRS; i += step, seen++) {
      const a = prose[i], b = prose[i + 1];
      if (a.node.id !== b.node.id) continue;
      const o = overlap(shingles(`${a.short} ${a.desc}`), shingles(`${b.short} ${b.desc}`));
      if (o > SHINGLE_WARN) shingleHits.push({ a: a.code || a.name, b: b.code || b.name, o });
    }
  }

  // --- популярные товары: продажи, дальше просмотры, дальше ручной seed
  const seedName = flags.seed && flags.seed !== true ? plain(flags.seed) : "";
  let popSrc = "seed", popLabel = "";
  if (sales.sales.size && sumOf(sales.sales) > 0) { popSrc = "sales"; popLabel = "продажи"; }
  else if (sales.views.size && sumOf(sales.views) > 0) { popSrc = "views"; popLabel = "просмотры за 30 дней"; }
  else popLabel = seedName ? `ручной seed, исполнитель ${seedName}` : "ручной seed, ИСПОЛНИТЕЛЬ НЕ НАЗВАН";
  const popCell = popSrc === "seed" ? (seedName ? `seed:${seedName}` : "seed") : popSrc;

  // --- инклуд доставки, оплаты и гарантии
  const inc = includeText(project);
  const incText = inc.join("\n");
  const incOk = inc.length > 0;

  // ───────────────────────────────────────────── 9. Выход
  const H = ["sku", "name", "node", "url", "tier", "robots", "h1", "title", "description",
    "specs", "card_top", "card_desc", "include", "popular", "var"];
  const esc = (v) => (/[";\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v));
  // plain() схлопывает перевод строки в пробел, поэтому многострочная ячейка чистится
  // построчно: верх карточки - это столбик строк, а не абзац.
  const cell = (v) => String(v == null ? "" : v).split("\n").map((x) => plain(x)).join("\n");
  const rowsOut = cards.map((c) => {
    const top = [];
    if (c.h1) top.push(c.h1);
    if (c.short) top.push(c.short);
    if (c.key.length) top.push(c.key.map((p) => `${keyLabel(p.label)} ${p.full}`).join(", "));
    const money = [c.price ? `${c.price} руб.` : "", c.stock ? `на складе ${c.stock}` : ""].filter(Boolean).join(", ");
    if (money) top.push(money);
    if (cta && c.tier !== "C") top.push(`Кнопка: ${cta}`);
    // Верх карточки собирается у ВСЕХ тиров, включая A. Цена, наличие, решающие параметры
    // и кнопка - это ДАННЫЕ, а не проза: писатель добирает к ним короткое описание от
    // выгоды и расширенный текст, а не перепечатывает таблицу. Пока верх гасили тиру A,
    // тридцать самых спросовых карточек уезжали в индекс пустыми - и это худший исход из
    // возможных, потому что уезжали именно дорогие.
    const cardTop = top.join("\n");
    if (NEVER.test(cardTop)) stat.guard++;
    c.topLen = chars(cardTop);
    return [
      // Тир A ждет письма: короткое описание и расширенный текст ему пишет site-author по
      // заданию из products-tasks.json. До этого момента строка закрыта noindex, как и
      // тир C, и по той же причине - показывать поиску пока нечего.
      c.code, c.name, c.node.id, c.url, c.tier, (c.tier === "C" || (c.tier === "A" && !c.short && !c.desc)) ? NOINDEX : "",
      c.h1, c.title, c.description,
      c.specs.map((p) => `${p.label}=${p.value}`).join("|"),
      NEVER.test(cardTop) ? "" : cardTop,
      c.desc, incOk ? "delivery" : "", popCell,
      c.varShare === undefined ? "" : String(c.varShare).replace(".", ",")
    ].map((v) => esc(cell(v)));
  });
  const csv = "﻿" + [H, ...rowsOut].map((r) => r.join(";")).join("\r\n") + "\r\n";

  const tierA = cards.filter((c) => c.tier === "A");
  const tasks = {
    v: 1, at: today(), slug: str(cat.slug) || str(project.slug),
    cards: tierA.map((c) => ({
      sku: c.code, name: c.name, node: c.node.id, url: c.url,
      h1: c.h1, title: c.title, description: c.description,
      specs: c.specs.map((p) => ({ label: p.label, value: p.value })),
      price: c.price, stock: c.stock
    }))
  };

  const check = [];
  check.push(`- [ ] Популярные товары: ${popLabel}. Плейсхолдер ${POPULAR_MIN}-${POPULAR_MAX} знаков, цепочка продажи - просмотры - ручной seed.`);
  if (popSrc === "seed" && !seedName) check.push("- [ ] Имя исполнителя ручного seed не названо: блок сдавать нельзя, передайте --seed \"<имя>\".");
  if (blocked.length) check.push(`- [ ] Карточек заблокировано по уникальности: ${blocked.length}. Лечится вариантами фразы в разделе lex правил, а не перезапуском.`);
  if (!incOk) check.push("- [ ] Инклуд доставки, оплаты и гарантии пуст: в project.json нет ни одного факта с publish yes по этой теме.");
  if (tierA.length) check.push(`- [ ] Тир A, карточек: ${tierA.length} - уходят к site-author страницами письма (type product в pages.json, задание из products-tasks.json). До письма строка закрыта ${NOINDEX}: показывать поиску пока нечего.`);
  if (dupTitle.length) check.push(`- [ ] Title повторяется у карточек, пар: ${dupTitle.length} (${dupTitle.slice(0, 2).join("; ")}). Дубль не ранжируется.`);
  if (shingleHits.length) check.push(`- [ ] Соседние карточки перекрываются выше ${pct(SHINGLE_WARN)} процентов, пар: ${shingleHits.length} из ${SHINGLE_PAIRS} проверенных.`);
  const checkText = [`# Чек-лист сдачи товарного конвейера ${str(cat.slug) || str(project.slug)}, ${today()}`, "", ...check, ""].join("\n");

  const outCsv = flags.out && flags.out !== true ? resolve(String(flags.out)) : join(dir, "products_out.csv");
  if (!flags.dry) {
    writeFileSync(outCsv, csv, "utf8");
    writeFileSync(join(dir, "products-tasks.json"), JSON.stringify(tasks, null, 2) + "\n", "utf8");
    if (incOk) writeFileSync(join(dir, "include-delivery.md"), `<!-- include:delivery -->\n${incText}\n`, "utf8");
    writeFileSync(join(dir, "products-checklist.md"), checkText, "utf8");
  }

  // ───────────────────────────────────────────── 10. Отчет
  const byTier = (t) => cards.filter((c) => c.tier === t).length;
  const said = (n) => (cat.counts && Number(cat.counts[n])) || 0;
  console.log(`[products] прайс ${basename(file)}: строк ${body.length}, карточек ${cards.length}, узлов ${byNode.size}, вердикт ${verdict}`);
  if (cutRows) notes.push(`строк в прайсе больше потолка ${ROWS_MAX}: обработаны первые ${ROWS_MAX}`);
  console.log(`  тиры: A ${byTier("A")} / B ${byTier("B")} / C ${byTier("C")}; в catalog.json записано A ${said("tier_a")} / B ${said("tier_b")} / C ${said("tier_c")}`);
  if (byTier("A") !== said("tier_a")) {
    console.log(demandSrc
      ? `  тир A ${byTier("A")} против ${said("tier_a")} в контракте: спрос берется из «${demandSrc}», и позиций с ненулевым спросом меньше квоты - на карточку без числа писателя не ставят`
      : "  тир A не назначен: спроса не замерено и списка клиента нет. «Топ-30» без числа, по которому он топ, это не топ, а первые тридцать строк выгрузки - все годные карточки идут тиром B");
  }
  if (noFacets) console.log(`  вердикт ${verdict}: тира A нет по контракту, товары идут тирами B и C, и это видно заказчику в ТЗ`);
  console.log(`  нормализация: значений приведено к единице категории ${stat.unitsMoved}, написаний сведено в одно ${stat.synMerged}${stat.derived.size ? `, разобрано из названий ${[...stat.derived.entries()].map(([a, n]) => `${a} ${n}`).join(", ")}` : ""}`);
  if (verdict !== "derivable_from_name" && !stat.derived.size) console.log("  разбор названий не запускался: он включается только вердиктом derivable_from_name, при других вердиктах название вторично");
  console.log(`  набор полей карточки: взят по данным у ${stat.noSet} узлов, короче ${SPECS_MIN} строк у ${stat.setThin}, пуст у ${stat.noFields}; значений ВНЕ набора отброшено ${stat.outOfSet} в ${stat.outOfSetCards} карточках - единообразие набора внутри категории важнее формулировок`);
  for (const l of setLines.slice(0, 8)) console.log(`  расхождение набора: ${l}`);
  if (setLines.length > 8) console.log(`  ... и еще строк расхождения набора: ${setLines.length - 8}`);
  const drops = [...stat.dropSlot.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  if (drops.length) console.log(`  правило пропуска сработало: ${drops.map(([k, n]) => `${k} ${n}`).join(", ")} - предложение выбрасывалось целиком, прочерк не печатался ни разу`);
  if (stat.guard) console.log(`  сторож выдачи погасил верх карточки у ${stat.guard} позиций: в собранный текст попало «не указано» либо неподставленный слот`);
  if (!ownFormula) console.log("  формула метатегов карточки взята ЗАПАСНАЯ: Title и Description на 200-300 знаков - самый дорогой текст проекта, формулу пишет catalog-architect разделом product");
  if (!T.short && !T.desc) console.log("  прозы в карточках нет: в catalog-rules.yml нет product.short и product.desc, а своего текста скрипт не выдумывает - тир B вышел данными без абзацев");
  if (thinLex.length) console.log(`  вариантов фразы меньше ${LEX_MIN} у ключей ${thinLex.slice(0, 6).join(", ")}: серия однотипных SKU станет потоком одинаковых абзацев`);
  const proseCards = cards.filter((c) => c.short || c.desc);
  if (proseCards.length) {
    const outTop = cards.filter((c) => c.tier !== "C" && c.topLen && (c.topLen < TOP_MIN || c.topLen > TOP_MAX)).length;
    const outDesc = cards.filter((c) => c.desc && (chars(c.desc) < DESC_MIN)).length;
    console.log(`  нормы: верх карточки вне вилки ${TOP_MIN}-${TOP_MAX} у ${outTop} карточек, расширенное описание короче ${DESC_MIN} у ${outDesc}`);
  }
  console.log(`  уникальность: доля варьируемого ниже ${String(VAR_SHARE_MIN).replace(".", ",")} у ${blocked.length} карточек (блокирует), шингл выше ${pct(SHINGLE_WARN)} процентов у ${shingleHits.length} пар из ${SHINGLE_PAIRS} проверенных (предупреждает)`);
  if (dupTitle.length) console.log(`  Title повторяется, пар: ${dupTitle.length} (${dupTitle.slice(0, 3).join("; ")}) - два адреса на один запрос, чинится формулой в product либо названием в прайсе`);
  for (const h of shingleHits.slice(0, 3)) console.log(`  соседи почти одинаковы: ${h.a} и ${h.b} - перекрытие ${pct(h.o)} процентов`);
  console.log(`  популярные товары: источник ${popLabel}`);
  console.log(`  инклуд доставки, оплаты и гарантии: ${incOk ? `${chars(incText)} знаков, ОДИН на сайт (include-delivery.md), в карточке только ссылка` : "пуст - фактов с publish yes по доставке, оплате и гарантии в контракте нет"}`);
  if (incOk && chars(incText) < INCLUDE_MIN) console.log(`  инклуд короче нормы ${INCLUDE_MIN}: добирается фактами в project.json, а не словами в карточке`);
  for (const m of notes) console.log(`  ВНИМАНИЕ: ${m}`);
  for (const m of bad) console.log(`  НАРУШЕНИЕ: ${m}`);
  if (flags.dry) {
    console.log("  --dry: на диск ничего не писалось");
  } else {
    console.log(`[products] записано: ${outCsv}`);
    console.log(`  плюс products-tasks.json (тир A), products-checklist.md${incOk ? ", include-delivery.md" : ""}`);
  }
  if (blocked.length || bad.length) {
    console.log(`  дальше: карточки с прозой ниже порога уникальности не сдаются - добавьте варианты фразы в lex и перезапустите`);
    return 2;
  }
  const warned = shingleHits.length || dupTitle.length || (popSrc === "seed" && !seedName) || !incOk || thinLex.length || setLines.length;
  return warned ? 1 : 0;
}

// ───────────────────────────────────────────────── 11. CLI
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
  const root = flags.root && flags.root !== true ? resolve(String(flags.root)) : repoRoot();
  process.exit(cmdRender(pos, flags, root));
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) main();
