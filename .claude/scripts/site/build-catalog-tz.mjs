#!/usr/bin/env node
// build-catalog-tz.mjs
// Сдача разработчику: подстановкой из catalog.json собирается пакет ТЗ каталога. ПРОЗУ ТУТ
// НЕ ГЕНЕРИРУЕТ НИКТО - ни скрипт, ни агент. Все, что печатается, уже лежит в контракте:
// дерево, оси, посадки, четыре числа режима, обе блокировки, наборы полей карточки. Если
// чего-то в контракте нет, в ТЗ этого нет тоже, и на месте раздела стоит строка о том,
// какой команды не хватило.
//
//   node build-catalog-tz.mjs <слаг|каталог> [--out <каталог>] [--dry]
//
// Кладет на диск четыре файла:
//   TZ-katalog.md        - сам документ, вставляется в Google Doc целиком;
//   meta.csv             - Title, H1 и Description ВСЕХ страниц каталога ЗНАЧЕНИЯМИ;
//   facet-landings.csv   - рабочий список посадок, он же список объема работ;
//   robots.snippet.txt   - Disallow и Clean-param, готово к вставке.
//
// ФОРМА ВАЖНЕЕ ОБЪЕМА. Разработчик читает таблицу, а не прозу: доля табличных строк
// считается и печатается в отчете, ниже порога - предупреждение. Пятнадцать-двадцать пять
// страниц на сорок категорий это норма; сто страниц прозы не читает никто, и невычитанное
// ТЗ возвращается вопросами через неделю.
//
// Exit: 0 чисто | 1 предупреждения | 2 отказ (нет контракта, либо контракт противоречив).

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { today, arr, str, low } from "./_contract.mjs";
import { repoRoot, findDir, plain } from "./queue.mjs";
import {
  readRulesYml, parseCsv, render, FORMULA, VERDICT_EFFECT, VERDICTS,
  AXIS_FILL_MIN, ATTR_FILL_MIN, LANDING_INDEX_SKU, LANDING_INDEX_DEMAND, SPECS_MIN
} from "./catalog.mjs";

const die = (msg) => { console.error("[tz] " + msg); process.exit(2); };

// ───────────────────────────────────────────────── 0. Имена файлов и нормы формы

export const TZ_FILE = "TZ-katalog.md";
export const META_FILE = "meta.csv";
export const LANDINGS_FILE = "facet-landings.csv";
export const ROBOTS_FILE = "robots.snippet.txt";

// Значений оси печатается списком не больше этого: сорок значений в ячейке таблицы
// разработчик не читает, а полный список у него и так есть в meta.csv и в прайсе.
export const VALUES_IN_TZ = 12;
// Доля строк-таблиц среди содержательных строк документа. Ниже порога - предупреждение.
export const TABLE_SHARE_MIN = 0.8;
// Знаков на условную страницу: только чтобы назвать объем в отчете.
export const PAGE_CHARS = 1800;
// Переключатели вида и сортировки: страница та же, адрес другой.
export const SWITCH_PARAMS = ["sort", "order", "view", "per_page", "limit"];
export const AD_PARAMS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "yclid", "gclid", "_openstat", "from"];
// Служебные разделы магазина: закрываются всегда, к фасетам отношения не имеют.
export const SERVICE_PATHS = ["/cart", "/order", "/checkout", "/compare", "/favorites", "/search", "/personal"];

const NEED_HUMAN = {
  facet_url: "адрес у отфильтрованной страницы",
  multi_select: "несколько значений одной оси",
  range: "фильтр диапазоном по числу",
  meta_override: "свои Title, H1 и Description у отфильтрованной страницы",
  canonical: "тег canonical",
  clean_param: "директива Clean-param",
  noindex: "мета-тег noindex"
};
// Что меняет ответ анкеты. Две ветки на каждую возможность: «да» и все остальное, потому
// что unknown работает как no и обещать по нему нечего.
const CAN_EFFECT = {
  multi_select: ["можно выбрать несколько значений оси сразу", "ось работает по одному значению, комбинации значений не собираются"],
  range: ["числовая ось дает фильтр «от и до»", "числовая ось публикуется только списком значений либо не публикуется вовсе"],
  meta_override: ["посадка получает свои Title, H1 и Description", "посадка остается дублем категории и не ранжируется: индексируемых комбинаций не назначается"],
  canonical: ["закрытая комбинация закрывается тегом canonical", "закрывать комбинации нечем, кроме Clean-param"],
  clean_param: ["параметры адреса склеиваются директивой Clean-param", "параметры адреса плодят дубли, и закрывать их нечем"],
  noindex: ["тонкая категория закрывается мета-тегом", "тонкую категорию закрыть нечем, кроме canonical"]
};
const MODE_HUMAN = {
  catalog: "листинг с фильтрами",
  service_like: "уходит в обычный тракт письма, потолок 6 блоков",
  thin_category: "интро, плитка подкатегорий, noindex до наполнения"
};
const INDEX_HUMAN = {
  index: "индексируется: свои Title, H1 и Description, строка в sitemap.xml",
  canonical: "закрыта тегом canonical на категорию",
  clean_param: "закрыта директивой Clean-param"
};

// ───────────────────────────────────────────────── 1. Мелочи разметки

const chars = (s) => Array.from(String(s == null ? "" : s)).length;
// Вертикальная черта внутри ячейки рвет таблицу markdown, перевод строки - тоже.
const cell = (v) => plain(String(v == null ? "" : v)).replace(/\|/g, "/") || "-";
const row = (cells) => "| " + cells.map(cell).join(" | ") + " |";
const head = (cells) => [row(cells), "|" + cells.map(() => "---").join("|") + "|"];
const pct = (x) => Math.round(Number(x || 0) * 100);
const num = (x) => String(Math.round(Number(x || 0)));
const yn = (x) => (str(x) === "yes" ? "да" : str(x) === "no" ? "нет" : "не знаем");

// Потолок метатега режется по слову: обрубок посреди слова заказчик видит сразу.
export function cut(s, max) {
  const a = Array.from(plain(s));
  if (a.length <= max) return a.join("");
  const t = a.slice(0, max).join("");
  const sp = t.lastIndexOf(" ");
  return (sp > max * 0.6 ? t.slice(0, sp) : t).replace(/[\s,;:-]+$/, "");
}
const cap1 = (s) => (s ? s.slice(0, 1).toUpperCase() + s.slice(1) : s);
const ruleOf = (rules, section, key) => {
  const s = rules.get(section);
  return s && key ? str(s.get(key)) : "";
};

// ───────────────────────────────────────────────── 2. Метатеги узла
// У посадки H1, Title и Description лежат в контракте: их собрал tree по формуле агента.
// У УЗЛА их там нет, и это не пропуск: узел - страница категории, ее метатеги делает та же
// одна формула на весь каталог. Двухсот ручных заголовков не пишется никогда, поэтому
// формула тут ровно та же, что в catalog.mjs, и берется из того же catalog-rules.yml.

export function metaOfNode(node, rules, region) {
  const nm = (node && node.name) || {};
  const vars = {
    nom: str(nm.nom), gen: str(nm.gen), acc: str(nm.acc),
    value: "", value2: "", values: "", attr: "",
    sku: Number(node && node.sku) || 0, region: str(region), node: str(nm.nom)
  };
  const exc = ruleOf(rules, "h1_exceptions", str(node && node.id));
  const h1 = cut(cap1(exc || render(ruleOf(rules, "formula", "h1") || FORMULA.h1, vars)), 120);
  const title = cut(render(ruleOf(rules, "formula", "title") || FORMULA.title, { ...vars, h1 }), 70) || h1;
  const description = cut(render(ruleOf(rules, "formula", "description") || FORMULA.description, { ...vars, h1, title }), 160);
  return { h1, title, description };
}

// Страница закрывается от индексации ровно в одном случае - thin_category: товаров мало,
// показывать поиску нечего, и это лечится наполнением, а не текстом.
export const robotsOfNode = (node) => (str(node && node.mode) === "thin_category" ? "noindex,follow" : "index,follow");
// Посадка остается индексируемой ВСЕГДА, в том числе закрытая canonical: canonical - это
// склейка сигналов, а не запрет обхода, и noindex поверх нее лишил бы страницу права
// передать вес категории. Закрытие стоит в колонке canonical, а не в robots.
export const robotsOfLanding = () => "index,follow";

// ───────────────────────────────────────────────── 3. Дерево

export function levels(nodes) {
  const byId = new Map(nodes.map((n) => [str(n.id), n]));
  const lvl = new Map();
  const depth = (n, seen = 0) => {
    const id = str(n.id);
    if (lvl.has(id)) return lvl.get(id);
    const p = str(n.parent) && byId.get(str(n.parent));
    const d = !p || seen > 5 ? 1 : depth(p, seen + 1) + 1;
    lvl.set(id, d);
    return d;
  };
  for (const n of nodes) depth(n);
  return { byId, lvl };
}

// Вложенный список: разработчик видит форму дерева раньше, чем таблицу. Порядок обхода -
// тот же, что в контракте: родитель, потом его потомки в порядке контракта.
export function treeList(nodes) {
  const { byId, lvl } = levels(nodes);
  const kids = new Map();
  for (const n of nodes) {
    const p = str(n.parent) && byId.has(str(n.parent)) ? str(n.parent) : "";
    if (!kids.has(p)) kids.set(p, []);
    kids.get(p).push(n);
  }
  const out = [];
  const walk = (parentId, pad) => {
    for (const n of kids.get(parentId) || []) {
      const nm = (n.name || {}).nom || n.id;
      out.push(`${pad}- **${plain(nm)}** \`${str(n.url)}\` - товаров ${num(n.sku)}, ${MODE_HUMAN[str(n.mode)] || str(n.mode)}`);
      if (pad.length < 8) walk(str(n.id), pad + "  ");
    }
  };
  walk("", "");
  return { lines: out, lvl };
}

// ───────────────────────────────────────────────── 4. Источник значений оси
// Откуда разработчик возьмет значения фильтра. Ответов ровно три, и все три проверяемые:
// колонка прайса, разбор названия при вердикте derivable_from_name, запрос заказчику.

export function valueSource(attr, map, verdict) {
  const col = arr(map && map.cols).find((c) => str(c.attr) === str(attr));
  if (col && str(col.col)) return `колонка прайса «${plain(col.col)}»`;
  if (col) return `колонка прайса номер ${Number(col.i) + 1}`;
  if (verdict === "derivable_from_name") return "разбор названия товара";
  return "запрос характеристик заказчику";
}

// Чего фасет требует от платформы. Печатается рядом с осью, чтобы «не работает» всплыло
// на сдаче ТЗ, а не на приемке фильтра.
export function facetNeeds(facet, platform) {
  const need = [];
  if (str(facet.kind) === "range") need.push(`range (анкета: ${yn(platform.range)})`);
  if (arr(facet.values).length > 1) need.push(`multi_select (анкета: ${yn(platform.multi_select)})`);
  need.push(`адрес фильтра ${str(platform.facet_url) || "unknown"}`);
  return need.join("; ");
}

// ───────────────────────────────────────────────── 5. robots.snippet.txt
// Готово к вставке. Две честные оговорки внутри самого файла:
//   - при facet_url path фасет закрывается тегом canonical, а НЕ строкой Disallow: одна
//     строка Disallow на ветку убила бы вместе с закрытыми и индексируемые посадки;
//   - Clean-param пишется только по тем осям, чьи посадки в контракте закрыты.

export function robotsSnippet(data, site) {
  const platform = data.platform || {};
  const q = str(platform.facet_url) === "query";
  const out = [];
  out.push("# robots.txt: фрагмент каталога, готов к вставке. Собран из catalog.json " + str(data.at));
  out.push("User-agent: *");
  for (const p of SERVICE_PATHS) out.push(`Disallow: ${p}`);
  out.push("");
  out.push("# переключатели вида и сортировки: страница та же, адрес другой");
  out.push(`Clean-param: ${SWITCH_PARAMS.join("&")}`);
  out.push("# метки рекламы");
  out.push(`Clean-param: ${AD_PARAMS.join("&")}`);

  const byNode = new Map();
  for (const L of arr(data.landings)) {
    if (str(L.index) !== "clean_param") continue;
    const k = str(L.node);
    if (!byNode.has(k)) byNode.set(k, new Set());
    for (const a of arr(L.attrs)) byNode.get(k).add(str(a.attr));
  }
  const nodes = new Map(arr(data.tree).map((n) => [str(n.id), n]));
  if (byNode.size) {
    out.push("");
    out.push("# оси, по которым отфильтрованная страница в поиск не идет");
    for (const [id, set] of byNode) {
      const n = nodes.get(id);
      out.push(`Clean-param: ${[...set].sort().join("&")} ${n ? str(n.url) : "/"}`);
    }
  } else if (q) {
    out.push("");
    out.push("# закрытых Clean-param посадок в контракте нет: все опубликованные комбинации индексируются");
  }
  if (!q) {
    out.push("");
    out.push("# адрес фильтра " + (str(platform.facet_url) || "unknown") + ": закрытые комбинации закрываются тегом canonical на категорию,");
    out.push("# а не строкой Disallow. Одна строка Disallow на ветку закрыла бы вместе с ними и индексируемые посадки.");
  }
  const host = plain(site).replace(/^[a-z]+:\/\//i, "").replace(/\/.*$/, "");
  out.push("");
  out.push(host ? `Sitemap: https://${host}/sitemap.xml` : "# Sitemap: домен не назван в project.json, business.site - строку допишет разработчик");
  return out.join("\n") + "\n";
}

// ───────────────────────────────────────────────── 6. Две таблицы, которые уедут в csv
// Разделитель точка с запятой и BOM: так Excel открывает русский csv колонками, а не
// одной строкой.

const esc = (v) => (/[";\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v));
export const toCsv = (rows) => "﻿" + rows.map((r) => r.map((v) => esc(plain(v))).join(";")).join("\r\n") + "\r\n";

export const META_HEAD = ["url", "type", "node", "h1", "title", "description", "robots", "canonical"];

export function metaRows(data, rules, region, products) {
  const nodes = new Map(arr(data.tree).map((n) => [str(n.id), n]));
  const rows = [META_HEAD];
  for (const n of arr(data.tree)) {
    const m = metaOfNode(n, rules, region);
    rows.push([str(n.url), "category", str(n.id), m.h1, m.title, m.description, robotsOfNode(n), str(n.canonical || "")]);
  }
  for (const L of arr(data.landings)) {
    const parent = nodes.get(str(L.node));
    rows.push([
      str(L.url), "facet", str(L.node), str(L.h1), str(L.title), str(L.description),
      robotsOfLanding(L), str(L.index) === "canonical" && parent ? str(parent.url) : ""
    ]);
  }
  for (const p of arr(products)) {
    rows.push([str(p.url), "product", str(p.node), str(p.h1), str(p.title), str(p.description), str(p.robots) || "index,follow", ""]);
  }
  return rows;
}

export const LANDING_HEAD = ["id", "node", "node_name", "url", "marker", "filter", "sku", "demand", "index", "h1", "title", "description"];

export function landingRows(data) {
  const nodes = new Map(arr(data.tree).map((n) => [str(n.id), n]));
  const rows = [LANDING_HEAD];
  for (const L of arr(data.landings)) {
    const n = nodes.get(str(L.node));
    rows.push([
      str(L.id), str(L.node), n ? str((n.name || {}).nom) : "", str(L.url), str(L.marker),
      arr(L.attrs).map((a) => `${str(a.attr)}=${str(a.value)}`).join(" + "),
      num(L.sku), L.demand === undefined ? "" : num(L.demand), str(L.index),
      str(L.h1), str(L.title), str(L.description)
    ]);
  }
  return rows;
}

// ───────────────────────────────────────────────── 7. Товарные метатеги из products_out.csv
// Карточки в ТЗ не пересобираются: их уже собрал render-products.mjs, и второй сборщик
// тех же строк дал бы два разных ответа на один вопрос.

export function readProducts(dir) {
  const f = join(dir, "products_out.csv");
  if (!existsSync(f)) return { rows: [], found: false, file: f };
  const raw = readFileSync(f, "utf8").replace(/^﻿/, "");
  const table = parseCsv(raw, ";");
  if (!table.length) return { rows: [], found: true, file: f };
  const h = table[0].map((x) => low(x));
  const at = (name) => h.indexOf(name);
  const iu = at("url"), ih = at("h1"), it = at("title"), id = at("description"), ir = at("robots"), inn = at("node"), is = at("sku");
  if (iu < 0 || ih < 0) return { rows: [], found: true, file: f, broken: true };
  const rows = table.slice(1).map((r) => ({
    url: str(r[iu]), h1: str(r[ih]), title: it >= 0 ? str(r[it]) : "", description: id >= 0 ? str(r[id]) : "",
    robots: ir >= 0 ? str(r[ir]) : "", node: inn >= 0 ? str(r[inn]) : "", sku: is >= 0 ? str(r[is]) : ""
  })).filter((r) => r.url && r.h1);
  return { rows, found: true, file: f };
}

// Шапка запроса характеристик. Читается из файла, а не описывается словами: заказчик
// открывает именно этот файл, и колонки в ТЗ обязаны совпадать с его колонками.
export function readAsk(dir) {
  const f = join(str(dir) || ".", "ask-attributes.csv");
  if (!existsSync(f)) return { head: [], rows: 0, found: false };
  const raw = readFileSync(f, "utf8").replace(/^﻿/, "");
  const table = parseCsv(raw, ";");
  if (!table.length) return { head: [], rows: 0, found: true };
  return { head: table[0].map((x) => plain(x)).filter(Boolean), rows: Math.max(0, table.length - 1), found: true };
}

// ───────────────────────────────────────────────── 8. Сам документ
// Каждый раздел - таблица либо список из контракта. Прозы нет: строка, которую нельзя
// вывести из catalog.json, в документ не попадает вовсе.

export function buildTz(ctx) {
  const { data, project, map, rules, products } = ctx;
  const business = (project && project.business) || {};
  const platform = data.platform || {};
  const nodes = arr(data.tree);
  const landings = arr(data.landings);
  const verdict = str(data.verdict);
  const noFacets = verdict === "must_request_from_client" || verdict === "impossible";
  const counts = data.counts || {};
  const byId = new Map(nodes.map((n) => [str(n.id), n]));
  const L = [];
  const warn = [];

  // --- шапка
  L.push(`# ТЗ каталога: ${plain(business.name) || str(data.slug)}, ${str(data.at) || today()}`);
  L.push("");
  L.push(...head(["Что", "Значение"]));
  L.push(row(["Проект", `${str(data.slug)}${plain(business.site) ? `, ${plain(business.site)}` : ""}`]));
  L.push(row(["Платформа", `${str(platform.kind)}, адрес фильтра ${str(platform.facet_url)}, импорт ${str(platform.import)}`]));
  L.push(row(["Вердикт товарных данных", `${verdict} - ${VERDICT_EFFECT[verdict] || ""}`]));
  L.push(row(["Категорий", num(counts.nodes != null ? counts.nodes : nodes.length)]));
  const idxN = landings.filter((x) => str(x.index) === "index").length;
  L.push(row(["ПОСАДОК всего (верстает разработчик)", `${num(counts.landings != null ? counts.landings : landings.length)} - у каждой свой адрес, H1, Title и Description по формуле, они лежат значениями в meta.csv`]));
  L.push(row(["Из них СТРАНИЦ С ТЕКСТОМ (пишет автор)", `${idxN} индексируемых: только им пишутся интро над листингом и текст под ним. Остальные ${Math.max(0, landings.length - idxN)} закрыты canonical либо Clean-param - это склейки, и платить за текст на склеенной странице не за что`]));
  L.push(row(["Позиций в прайсе", num(counts.sku)]));
  const tierAssigned = ctx.tasks && Array.isArray(ctx.tasks.cards) ? ctx.tasks.cards.length : null;
  L.push(row(["Товарные тиры", `A ${tierAssigned === null ? `квота ${num(counts.tier_a)}, спрос не замерен - назначения пока нет` : `квота ${num(counts.tier_a)}, НАЗНАЧЕНО ПО СПРОСУ ${tierAssigned} - пишет автор именно их`}; B ${num(counts.tier_b)} рендер по шаблону; C ${num(counts.tier_c)} минимальная карточка и noindex`]));
  if (tierAssigned !== null && tierAssigned !== Number(counts.tier_a)) {
    warn.push(`тир A: квота ${num(counts.tier_a)}, назначено по спросу ${tierAssigned} - в смету идет второе число`);
  }
  L.push("");
  L.push("**Объем работ считается в ПОСАДКАХ, а не в категориях**, и это ДВА числа, а не одно: посадок всего - столько адресов и метатегов; страниц с текстом - столько интро и текстов под листингом. Метатеги всех страниц значениями - в `meta.csv`, посадки - в `facet-landings.csv`, robots - в `robots.snippet.txt`.");
  L.push("");

  // --- 1. дерево
  const { lines: tl, lvl } = treeList(nodes);
  L.push("## 1. Дерево каталога");
  L.push("");
  if (tl.length) L.push(...tl);
  else L.push("Узлов в контракте нет: соберите дерево командой `catalog.mjs tree`.");
  L.push("");

  // --- 2. плоская таблица категорий
  L.push("## 2. Категории плоской таблицей");
  L.push("");
  L.push("Четыре числа режима стоят колонками, чтобы решение проверялось глазом: H1 товаров меньше 8, H2 доля не-листингов в топ-10 от 0,5, H3 медиана видимого текста от 2500 знаков, H4 сервисных запросов от 3. `service_like` требует обязательного H2 либо H4 плюс любого второго условия.");
  L.push("");
  L.push(...head(["ID", "Уровень", "Название", "URL", "Родитель", "H1 страницы", "Маркер", "Товаров", "Режим", "Пр.1 товаров<8", "Пр.2 не-лист>=0,5", "Пр.3 медиана>=2500", "Пр.4 сервис>=3"]));
  for (const n of nodes) {
    const m = metaOfNode(n, rules, business.region);
    const s = n.signals || {};
    L.push(row([
      str(n.id), num(lvl.get(str(n.id)) || 1), plain((n.name || {}).nom), str(n.url),
      str(n.parent) || "корень", m.h1, str(n.marker), num(n.sku), str(n.mode),
      num(s.products), String(Number(s.non_listing || 0)), num(s.text_median), num(s.service_hits)
    ]));
  }
  L.push("");
  L.push("### 2.1. Нормы текста категории и посадки");
  L.push("");
  L.push("Центр тяжести категории - не текст: ее ранжируют ассортимент, цены, наличие, доставка и корзина. Полотно на 4000 знаков под листингом - прямой риск фильтра за переспам, в том числе хостового.");
  L.push("");
  L.push(...head(["Элемент", "Сколько знаков", "Форма", "Какую работу делает"]));
  L.push(row(["Title", "до 70, потолок жесткий", "формула на весь каталог плюс список исключений", "на каталоге из 200 категорий это 200 Title - самый дорогой текст проекта"]));
  L.push(row(["H1", "до 120", "формула, заглавную ставит скрипт", "называет раздел словами покупателя"]));
  L.push(row(["Description", "до 160, потолок жесткий", "формула", "сниппет, по нему кликают"]));
  L.push(row(["Интро над листингом", "200-500, потолок ЖЕСТКИЙ", "один абзац, без подзаголовков", "каждые лишние 500 знаков отодвигают первый товар ниже сгиба"]));
  L.push(row(["Текст под листингом, конкурентная ниша", "800-2000", "H2 и 3-4 подраздела «как выбрать»", "структурный разбор вытягивается в генеративную выдачу, простыня с вхождениями - нет"]));
  L.push(row(["Текст под листингом, тонкая ниша", "0-800", "тот же разбор, короче", "дописывать до нормы нечем, и добор воды дороже отсутствия текста"]));
  L.push(row(["Перелинковка и теги", "100-500", "блок тегов над листингом либо под ним", "уводит в посадки, то есть в тот трафик, ради которого посадки и делались"]));
  L.push("");

  // --- 3. фасеты
  L.push("## 3. Фасеты: оси фильтра");
  L.push("");
  const facetPairs = [];
  for (const n of nodes) for (const f of arr(n.facets)) facetPairs.push({ n, f });
  if (!facetPairs.length) {
    L.push(noFacets
      ? `Опубликованных осей НОЛЬ. Вердикт товарных данных - ${verdict}: фильтровать не по чему, и обещать фасет нельзя. Что нужно от вас, чтобы фасеты появились, - раздел 9 и файл \`ask-attributes.csv\`.`
      : "Опубликованных осей ноль: ни один атрибут не прошел порог заполненности. Разбор - раздел 9.");
    L.push("");
  } else {
    L.push(...head(["Узел", "Ось", "Поле", "Тип", "Источник значений", "Заполнено", "Область действия", "Зависимости"]));
    for (const { n, f } of facetPairs) {
      const kids = nodes.filter((x) => str(x.parent) === str(n.id)).length;
      L.push(row([
        str(n.id), plain(f.label), str(f.attr), str(f.kind),
        valueSource(f.attr, map, verdict), `${pct(f.fill)} процентов`,
        `${str(n.url)}${kids ? ` и вложенные (${kids})` : ""}`,
        facetNeeds(f, platform)
      ]));
    }
    L.push("");
    L.push("### 3.1. Значения осей");
    L.push("");
    L.push(...head(["Узел", "Ось", "Значений всего", `Первые ${VALUES_IN_TZ} со счетом позиций`]));
    for (const { n, f } of facetPairs) {
      const vals = arr(f.values);
      L.push(row([
        str(n.id), str(f.attr), vals.length ? num(vals.length) : "диапазон",
        vals.length
          ? vals.slice(0, VALUES_IN_TZ).map((v) => `${plain(v.value)} (${num(v.sku)})`).join(", ")
          : `от и до по колонке прайса, шаг задает разработчик`
      ]));
    }
    L.push("");
  }

  // --- 4. посадки
  L.push("## 4. Посадки и правила индексации");
  L.push("");
  L.push(`Комбинация индексируется, только когда хватило и позиций (от ${LANDING_INDEX_SKU}), и замеренного спроса (от ${LANDING_INDEX_DEMAND} в месяц), и платформа дает свои метатеги. Спрос неизвестен - это ноль, и комбинация закрывается: обещанной, но незаслуженной индексации в ТЗ не бывает.`);
  L.push("");
  if (!landings.length) {
    L.push(noFacets
      ? `Посадок НОЛЬ, и это прямое следствие вердикта ${verdict}. Объем работ каталога равен числу категорий, а не числу посадок.`
      : "Посадок ноль: ни одна комбинация не набрала позиций либо оси не публикуются.");
    L.push("");
  } else {
    L.push(...head(["ID", "URL", "Узел", "Фильтр", "Товаров", "Спрос", "Статус", "Что делает разработчик"]));
    for (const x of landings) {
      const parent = byId.get(str(x.node));
      const st = str(x.index);
      const act = st === "canonical" && parent ? `rel=canonical на ${str(parent.url)}` : (INDEX_HUMAN[st] || st);
      L.push(row([
        str(x.id), str(x.url), str(x.node),
        arr(x.attrs).map((a) => `${str(a.attr)}=${str(a.value)}`).join(" + "),
        num(x.sku), x.demand === undefined ? "не мерили" : num(x.demand), st, act
      ]));
    }
    L.push("");
    L.push(...head(["Статус", "Сколько", "Что это значит"]));
    for (const st of ["index", "canonical", "clean_param"]) {
      const n = landings.filter((x) => str(x.index) === st).length;
      if (n) L.push(row([st, num(n), INDEX_HUMAN[st]]));
    }
    L.push("");
  }

  // --- 5. переключатели
  const cols = arr(map && map.cols);
  const hasRole = (r) => cols.some((c) => str(c.role) === r);
  L.push("## 5. Логика переключений");
  L.push("");
  L.push(...head(["Переключатель", "Значения", "Адрес", "Индексация"]));
  const sorts = [];
  if (hasRole("price")) sorts.push("сначала дешевые", "сначала дорогие");
  if (hasRole("stock")) sorts.push("сначала в наличии");
  if (hasRole("name")) sorts.push("по названию");
  sorts.push("по умолчанию");
  L.push(row(["Сортировка", sorts.join(", "), "параметр `sort`, значение по умолчанию в адрес не пишется", "Clean-param, в поиск не идет"]));
  L.push(row(["Вид выдачи", "плитка, список", "параметр `view`, плитка по умолчанию", "Clean-param, в поиск не идет"]));
  L.push(row(["Пагинация", "страницы по 24 либо 36 позиций", "`/page/2/`, первая страница БЕЗ параметра", "открыта, canonical каждой страницы на саму себя"]));
  L.push(row(["Показать еще", "догрузка следующей порции", "адрес не меняется", "у робота обязана остаться обычная ссылка на `/page/2/`, иначе вторая страница не существует"]));
  L.push(row(["Позиций на странице", "24, 36, 72", "параметр `per_page`", "Clean-param, в поиск не идет"]));
  L.push("");
  if (!hasRole("price")) warn.push("в прайсе нет колонки цены: сортировка по цене в ТЗ не обещана");

  // --- 6. пустая выдача
  const thin = nodes.filter((n) => str(n.mode) === "thin_category").length;
  L.push("## 6. Поведение пустой выдачи");
  L.push("");
  L.push(...head(["Случай", "Что показываем", "Код ответа", "Индексация"]));
  L.push(row(["Фильтр не дал ни одной позиции", "заголовок остается, список пуст, кнопка сброса фильтра, плитка соседних значений оси", "200", "noindex, follow: страницы с нулем товаров в поиске быть не должно"]));
  L.push(row(["Категория без товаров", `интро и плитка подкатегорий; таких узлов сейчас ${thin}`, "200", "noindex, follow до наполнения"]));
  L.push(row(["Товар снят с продажи, замена есть", "карточка остается, цена скрыта, блок «на замену»", "200", "открыта"]));
  L.push(row(["Товар снят навсегда", "переход в категорию", "301 на категорию", "закрыта переходом"]));
  L.push(row(["Адрес фильтра собран руками и не существует", "страница категории", "404", "закрыта"]));
  L.push("");

  // --- 7. крошки
  L.push("## 7. Хлебные крошки");
  L.push("");
  L.push(...head(["Уровень", "Шаблон", "Пример из этого каталога"]));
  const deep = nodes.slice().sort((a, b) => (lvl.get(str(b.id)) || 1) - (lvl.get(str(a.id)) || 1))[0];
  const chain = [];
  let cur = deep;
  for (let i = 0; cur && i < 4; i++) { chain.unshift(plain((cur.name || {}).nom) || str(cur.id)); cur = byId.get(str(cur.parent)); }
  const sample = chain.length ? chain.join(" / ") : "-";
  L.push(row(["Категория", "Главная / Каталог / {категория}", `Главная / Каталог / ${sample}`]));
  const sampleL = landings[0];
  L.push(row(["Посадка", "Главная / Каталог / {категория} / {значение фильтра}",
    sampleL ? `Главная / Каталог / ${plain((byId.get(str(sampleL.node)) || { name: {} }).name.nom)} / ${arr(sampleL.attrs).map((a) => plain(a.value)).join(" ")}` : "посадок нет"]));
  L.push(row(["Товар", "Главная / Каталог / {категория} / {название товара}", products.length ? `Главная / Каталог / ${sample} / ${plain(products[0].h1)}` : "карточки соберет render-products.mjs"]));
  L.push(row(["Разметка", "schema.org BreadcrumbList на каждой странице каталога", "последний элемент без ссылки"]));
  L.push("");

  // --- 8. перелинковка
  L.push("## 8. Перелинковка");
  L.push("");
  L.push(...head(["Откуда", "Куда", "Сколько", "Правило"]));
  L.push(row(["Категория", "свои подкатегории", "все", "плитка под интро, до листинга"]));
  L.push(row(["Категория", "свои индексируемые посадки", `${landings.filter((x) => str(x.index) === "index").length} на весь каталог`, "блок тегов над листингом либо под ним, анкор равен H1 посадки"]));
  L.push(row(["Посадка", "своя категория", "1", "хлебная крошка; при статусе canonical еще и тег canonical"]));
  L.push(row(["Посадка", "соседние значения той же оси", "до 8", "тот же блок тегов, своя посадка из него исключается"]));
  L.push(row(["Товар", "своя категория и посадки своих значений", "1 плюс по одной на ось", "крошка плюс ссылки из строк характеристик"]));
  L.push(row(["Товар", "соседние товары", "4-8", "блок «похожие»; источник - та же категория и тот же ценовой диапазон"]));
  L.push("");

  // --- 9. что нужно от вас: блокировки по данным плюс запрос характеристик
  // Раньше раздел 3 отсылал сюда за списком «что нужно от заказчика», а тут при пустом
  // blocked_by_data стояло «все оси порог прошли» - два утверждения, противоречащих друг
  // другу в одном документе. При вердикте impossible атрибутивных колонок нет вовсе,
  // значит и блокировать по данным нечего, и заказчик так и не узнавал, чего от него ждут.
  L.push("## 9. Что нужно от вас: фасеты, невозможные ПО ДАННЫМ");
  L.push("");
  const bd = arr(data.blocked_by_data);
  const fillRows = arr(map && map.fill);
  const publishedAttrs = new Set();
  for (const n of nodes) for (const f of arr(n.facets)) publishedAttrs.add(str(f.attr));
  // Кандидаты в оси: колонка прайса, которую заполняют хоть у пятой части позиций, но
  // осью она не стала - либо не добрала порога, либо ее снял вердикт. Именно это
  // заказчик и дозаполняет.
  const cand = new Map();
  for (const f of fillRows) {
    const a = str(f.attr);
    if (!a || publishedAttrs.has(a)) continue;
    const cur = cand.get(a);
    const fill = Number(f.filled) || 0;
    if (!cur || fill > cur.fill) cand.set(a, { attr: a, label: plain(f.label) || a, fill, cat: plain(f.cat) });
  }
  if (noFacets || !publishedAttrs.size) {
    const ask = readAsk(ctx.dir);
    L.push(`Вердикт товарных данных - ${verdict}. Фасеты появятся только после того, как характеристики приедут от вас: фильтр - это проекция атрибутов, и по названию с ценой фильтровать не по чему.`);
    L.push("");
    L.push(...head(["Что делаем мы", "Что нужно от вас", "Как отдать"]));
    L.push(row(["Отдали заполняемый файл", `\`ask-attributes.csv\`${ask.rows ? `, строк ${ask.rows}` : ""}: точка с запятой и BOM, Excel открывает колонками`, "заполнить колонки характеристик и вернуть файл"]));
    L.push(row(["Считаем порог", `ось публикуется от ${pct(AXIS_FILL_MIN)} процентов заполненности ПО КАТЕГОРИИ`, "заполнять не выборочно, а целыми категориями"]));
    L.push(row(["Пересобираем режим", "`catalog.mjs ingest --refresh`, дальше дерево и режим заново", "ничего: это наша работа"]));
    L.push("");
    if (ask.head.length) {
      L.push(...head(["Колонка файла", "Что вписать"]));
      for (const h of ask.head.slice(0, 20)) {
        L.push(row([h, ["Артикул", "Наименование", "Раздел"].includes(h) ? "уже заполнено, менять не надо" : "значение характеристики, единицу измерения писать как в шапке"]));
      }
      L.push("");
    }
    if (cand.size) {
      L.push(...head(["Кандидат в ось", "Поле", "Максимальная заполненность по категории", "Порог"]));
      for (const c of [...cand.values()].sort((a, b) => b.fill - a.fill).slice(0, 20)) {
        L.push(row([c.label, c.attr, `${pct(c.fill)} процентов${c.cat ? ` (${c.cat})` : ""}`, `${pct(AXIS_FILL_MIN)} процентов`]));
      }
      L.push("");
    } else {
      L.push("Кандидатов в оси в прайсе нет ни одного: атрибутивных колонок в нем не нашлось вовсе, и список характеристик задаете вы.");
      L.push("");
    }
  }
  if (!bd.length && !noFacets) {
    L.push(publishedAttrs.size
      ? "Осей, снятых порогом заполненности, нет: все атрибутивные колонки прайса порог прошли."
      : "Атрибутивных колонок в прайсе не нашлось вовсе, поэтому и снимать порогом нечего - список характеристик приходит от вас.");
  }
  if (bd.length) {
    L.push(`Ось публикуется, только если атрибут заполнен у ${pct(AXIS_FILL_MIN)} процентов позиций категории и больше: ниже порога фильтр отправляет треть товаров мимо любого значения, и это хуже, чем его отсутствие.`);
    L.push("");
    L.push(...head(["Узел", "Ось", "Поле", "Заполнено", "Порог", "Позиций", "Что нужно, чтобы ось появилась"]));
    for (const b of bd) {
      L.push(row([
        str(b.node), plain(b.label) || str(b.attr), str(b.attr),
        `заполнено ${pct(b.fill)} процентов из ${pct(AXIS_FILL_MIN)}`, `${pct(AXIS_FILL_MIN)} процентов`, num(b.sku),
        `заполнить поле еще у ${Math.max(0, Math.ceil((AXIS_FILL_MIN - Number(b.fill || 0)) * (Number(b.sku) || 0)))} позиций`
      ]));
    }
  }
  L.push("");

  // --- 10. блокировки по платформе
  L.push("## 10. Фасеты, невозможные НА ВАШЕЙ ПЛАТФОРМЕ");
  L.push("");
  const bp = arr(data.blocked_by_platform);
  L.push(...head(["Ответ анкеты", "Значение", "Что это дает фильтру"]));
  L.push(row(["Движок", str(platform.kind), "определяет, чем вообще собирается умный фильтр"]));
  L.push(row(["Адрес фильтра", str(platform.facet_url), "без своего адреса отфильтрованная страница не существует для поиска"]));
  for (const k of ["multi_select", "range", "meta_override", "canonical", "clean_param", "noindex"]) {
    const ok = str(platform[k]) === "yes";
    L.push(row([NEED_HUMAN[k], yn(platform[k]), ok ? CAN_EFFECT[k][0] : `${CAN_EFFECT[k][1]}${str(platform[k]) === "unknown" ? " (ответа нет, а неподтвержденное считается как нет)" : ""}`]));
  }
  L.push(row(["Импорт товаров", str(platform.import), "определяет, как обновляются значения осей"]));
  L.push("");
  if (!bp.length) L.push("Осей, снятых платформой, нет.");
  else {
    L.push(...head(["Узел", "Ось", "Чего не хватает", "Что это значит"]));
    for (const b of bp) {
      L.push(row([str(b.node), plain(b.label) || str(b.attr), str(b.need), NEED_HUMAN[str(b.need)] || str(b.need)]));
    }
  }
  L.push("");

  // --- 11. эксплуатация
  L.push("## 11. Эксплуатация каталога");
  L.push("");
  L.push("### 11.1. Обязательные атрибуты по категориям");
  L.push("");
  L.push("Набор полей ОДИН на всю категорию: разные наборы у соседних моделей означают, что сравнить нельзя, и человек уходит туда, где можно.");
  L.push("");
  L.push(...head(["Узел", "Обязательные поля карточки", "Полей", "Оси фильтра этой категории"]));
  for (const n of nodes) {
    const specs = arr(n.specs);
    const ax = arr(n.facets).map((f) => str(f.attr));
    L.push(row([
      str(n.id), specs.length ? specs.join(", ") : "набор не задан: нет ни одной заполненной колонки",
      num(specs.length), ax.length ? ax.join(", ") : "нет"
    ]));
    if (specs.length && specs.length < SPECS_MIN) warn.push(`${str(n.id)}: полей в наборе ${specs.length} при норме от ${SPECS_MIN}`);
  }
  L.push("");
  L.push("### 11.2. Валидация на импорте");
  L.push("");
  L.push(...head(["Проверка", "Условие", "Реакция системы"]));
  L.push(row(["Обязательное поле пусто", "любое поле набора категории", "товар публикуется, поле в карточку не печатается, строка уходит в отчет импорта"]));
  L.push(row(["Нет названия либо цены", "пустая ячейка", "товар не публикуется, тир C"]));
  L.push(row(["Значение оси вне словаря", "значение не встречалось раньше", "товар публикуется, новое значение уходит на подтверждение контент-менеджеру"]));
  L.push(row(["Единица измерения чужая", "см вместо мм и подобное", "значение приводится к единице категории, расхождение в отчет"]));
  L.push(row(["Дубль артикула", "один артикул в двух строках", "импорт строки отклоняется целиком"]));
  L.push(row(["«Не указано», прочерк, квадратный плейсхолдер", "любое такое значение", "поле гасится: в товарную выдачу это не печатается никогда"]));
  L.push("");
  L.push("### 11.3. Заполненность упала ниже порога");
  L.push("");
  L.push(...head(["Заполненность оси", "Что делает система", "Кто чинит"]));
  L.push(row([`от ${pct(AXIS_FILL_MIN)} процентов`, "ось в фильтре, посадки живут", "никто, это норма"]));
  L.push(row([`от ${pct(ATTR_FILL_MIN)} до ${pct(AXIS_FILL_MIN)} процентов`, "ось снимается с фильтра, значения остаются в карточке, посадки на этой оси закрываются canonical", "контент-менеджер заполняет поле"]));
  L.push(row([`ниже ${pct(ATTR_FILL_MIN)} процентов`, "поле выводится из набора категории и попадает в запрос характеристик заказчику", "заказчик присылает характеристики"]));
  L.push("");
  L.push("Проверка заполненности - на каждом импорте: падение ниже порога это не авария, а плановое событие, потому что новые позиции приходят без характеристик.");
  L.push("");

  // --- 12. приложения
  L.push("## 12. Файлы пакета");
  L.push("");
  L.push(...head(["Файл", "Что в нем", "Строк"]));
  const metaN = nodes.length + landings.length + products.length;
  L.push(row([META_FILE, "Title, H1 и Description всех страниц каталога значениями, не шаблонами", num(metaN)]));
  L.push(row([LANDINGS_FILE, "рабочий список посадок: фильтр, позиции, спрос, статус индексации", num(landings.length)]));
  L.push(row([ROBOTS_FILE, "фрагмент robots.txt: Disallow и Clean-param", "-"]));
  if (!products.length) L.push(row(["products_out.csv", "карточки товаров: метатеги, характеристики, верх карточки", "файла нет, соберет render-products.mjs"]));
  else L.push(row(["products_out.csv", "карточки товаров: метатеги, характеристики, верх карточки", num(products.length)]));
  const side = ctx.side || {};
  L.push(row(["include-delivery.md", "ОДИН инклуд доставки, оплаты и гарантии на весь сайт: в карточке стоит ссылка на него, а не копия текста", side.include ? "есть" : "файла нет, соберет render-products.mjs"]));
  L.push(row(["products-checklist.md", "строки сдачи товарного конвейера: источник блока «популярные», имя исполнителя ручного seed, заблокированные по уникальности", side.checklist ? "есть" : "файла нет, соберет render-products.mjs"]));
  if (noFacets || !products.length || side.ask) {
    L.push(row(["ask-attributes.csv", "запрос характеристик заказчику: заполняемый файл, а не просьба словами", side.ask ? `строк ${side.ask}` : "не требуется при этом вердикте"]));
  }
  L.push("");

  return { md: L.join("\n") + "\n", warn };
}

// Доля табличных строк среди содержательных: форма важнее объема, и проверяется она
// числом, а не на глаз.
export function tableShare(md) {
  const lines = String(md).split("\n").filter((l) => l.trim());
  const tab = lines.filter((l) => /^\s*\|/.test(l) || /^\s*-\s/.test(l)).length;
  return { share: lines.length ? Math.round((tab / lines.length) * 100) / 100 : 0, lines: lines.length, tab };
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

function loadJson(f, what) {
  if (!existsSync(f)) return null;
  try { return JSON.parse(readFileSync(f, "utf8").replace(/^﻿/, "")); }
  catch (e) { die(`${what} не разобран (${f}): ${e.message}`); }
}

function main() {
  const { flags, pos } = parseArgs(process.argv.slice(2));
  const root = flags.root && flags.root !== true ? resolve(String(flags.root)) : repoRoot();
  const dir = findDir(pos[0], root);
  if (!dir) die("проект не найден: укажите слаг либо каталог sites/NNN-slug");

  const data = loadJson(join(dir, "catalog.json"), "catalog.json");
  if (!data) die("нет catalog.json: сначала node .claude/scripts/site/catalog.mjs tree <каталог>, потом mode");
  const project = loadJson(join(dir, "project.json"), "project.json") || {};
  const map = loadJson(join(dir, "attr_map.json"), "attr_map.json") || {};
  const rules = readRulesYml(join(dir, "catalog-rules.yml"));
  const verdict = str(data.verdict);
  if (!VERDICTS.includes(verdict)) die(`вердикт «${verdict || "пусто"}» вне списка: ${VERDICTS.join(", ")}`);

  // Отказ, а не предупреждение: ТЗ с фасетом при вердикте «фильтровать не по чему» это
  // ровно та фикция, ради отказа от которой режим и начинается с приемки данных.
  const facets = arr(data.tree).reduce((s, n) => s + arr(n.facets).length, 0);
  const noFacets = verdict === "must_request_from_client" || verdict === "impossible";
  if (noFacets && (facets || arr(data.landings).length)) {
    die(`вердикт ${verdict}, а в контракте осей ${facets} и посадок ${arr(data.landings).length}: прогоните verify-catalog.mjs, ТЗ с обещанным и невыполнимым фасетом не собирается`);
  }
  // Страховка «сначала mode». Раньше она была написана как «хотя бы у одного узла есть
  // mode и signals», а tree предзаполнял оба у КАЖДОГО узла - и die не срабатывал никогда:
  // ТЗ собиралось с колонкой из четырех нулей, то есть ровно с тем «решением на глаз»,
  // ради запрета которого признак и делали машинным. Теперь tree их не пишет вовсе, а
  // требуется режим у ВСЕХ узлов.
  {
    const noMode = arr(data.tree).filter((n) => !str(n && n.mode) || !(n && n.signals)).map((n) => str(n && n.id));
    if (noMode.length) {
      die(`режима нет у ${noMode.length} узлов (${noMode.slice(0, 6).join(", ")}): сначала node .claude/scripts/site/catalog.mjs mode <каталог>, иначе четыре числа режима уедут заказчику нулями`);
    }
  }

  const prod = readProducts(dir);
  if (prod.broken) die(`products_out.csv без колонок url и h1 (${prod.file}): пересоберите render-products.mjs`);
  const tasks = loadJson(join(dir, "products-tasks.json"), "products-tasks.json");
  const ask = readAsk(dir);
  const ctx = {
    data, project, map, rules, products: prod.rows, dir, tasks,
    side: {
      include: existsSync(join(dir, "include-delivery.md")),
      checklist: existsSync(join(dir, "products-checklist.md")),
      ask: ask.found ? ask.rows || 1 : 0
    }
  };
  const { md, warn } = buildTz(ctx);
  const meta = metaRows(data, rules, (project.business || {}).region, prod.rows);
  const lands = landingRows(data);
  const robots = robotsSnippet(data, (project.business || {}).site);

  const outDir = flags.out && flags.out !== true ? resolve(String(flags.out)) : dir;
  if (!flags.dry) {
    writeFileSync(join(outDir, TZ_FILE), md, "utf8");
    writeFileSync(join(outDir, META_FILE), toCsv(meta), "utf8");
    writeFileSync(join(outDir, LANDINGS_FILE), toCsv(lands), "utf8");
    writeFileSync(join(outDir, ROBOTS_FILE), robots, "utf8");
  }

  // --- отчет
  const t = tableShare(md);
  const pages = Math.max(1, Math.round(chars(md) / PAGE_CHARS));
  const idx = arr(data.landings).filter((x) => str(x.index) === "index").length;
  console.log(`[tz] ${dir}`);
  console.log(`  ${TZ_FILE}: ${chars(md)} знаков, около ${pages} страниц, таблицами ${pct(t.share)} процентов строк (${t.tab} из ${t.lines})`);
  console.log(`  ОБЪЕМ РАБОТ В ПОСАДКАХ, А НЕ В КАТЕГОРИЯХ: категорий ${arr(data.tree).length}, посадок ${arr(data.landings).length} (столько адресов и метатегов), из них СТРАНИЦ С ТЕКСТОМ ${idx} - это два разных числа и две разные цены`);
  if (tasks && Array.isArray(tasks.cards)) {
    console.log(`  тир A: квота по контракту ${Number((data.counts || {}).tier_a) || 0}, назначено по спросу ${tasks.cards.length} - в ТЗ печатаются оба`);
  }
  console.log(`  ${META_FILE}: строк ${meta.length - 1} (категории ${arr(data.tree).length}, посадки ${arr(data.landings).length}, товары ${prod.rows.length}) - значения, а не шаблоны`);
  console.log(`  ${LANDINGS_FILE}: строк ${lands.length - 1}; ${ROBOTS_FILE}: строк ${robots.split("\n").length - 1}`);
  console.log(`  вердикт ${verdict}: осей ${facets}, заблокировано по данным ${arr(data.blocked_by_data).length}, по платформе ${arr(data.blocked_by_platform).length}`);
  if (noFacets) console.log(`  фасетов в ТЗ НОЛЬ и это сказано прямым текстом: ${VERDICT_EFFECT[verdict]}`);
  if (!prod.found) console.log("  карточек товаров в пакете нет: products_out.csv соберет render-products.mjs, после него перезапустите сборку ТЗ");
  for (const w of warn.slice(0, 8)) console.log(`  ВНИМАНИЕ: ${w}`);
  if (warn.length > 8) console.log(`  ... и еще ${warn.length - 8} строк внимания`);
  if (!flags.dry) console.log(`[tz] записано: ${join(outDir, TZ_FILE)}, ${META_FILE}, ${LANDINGS_FILE}, ${ROBOTS_FILE}`);

  if (t.share < TABLE_SHARE_MIN) {
    console.log(`  ВНИМАНИЕ: таблицами ${pct(t.share)} процентов строк при норме ${pct(TABLE_SHARE_MIN)} - разработчик читает таблицу, а не прозу`);
    return 1;
  }
  return warn.length ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) process.exit(main());
