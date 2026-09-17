#!/usr/bin/env node
// pages.mjs
// Список страниц сайта из project.json: слаги, адреса, редиректы и предупреждение о
// каннибализации. Ничего не выдумывает: страница берется из business.directions[] и из
// business.client_pages[], больше ей взяться неоткуда.
//
// Три правила, которые тут важнее кода:
//   1. СУЩЕСТВУЮЩИЙ АДРЕС НЕ ПЕРЕСОЗДАЕТСЯ. Есть directions[].url - он и остается
//      адресом страницы, как бы красиво ни получился новый слаг. Позиции живут на
//      адресах, а не на нашем вкусе.
//   2. Адрес сменился - появляется строка в redirects.csv. Молча переехавшая страница
//      это потерянный трафик, а не аккуратная структура.
//   3. Лендинг - это ОДНА страница, а не режим: направления становятся ее блоками.
//
// ЧЕТВЕРТОЕ ПРАВИЛО - ТИПИЗАЦИЯ МАГАЗИНА. При business.type shop либо both страницы
// каталога берутся из catalog.json, а не из догадки «магазин - значит категория»:
//   узел дерева в режиме catalog либо thin_category  -> type category;
//   узел в режиме service_like                       -> type service, то есть МАРШРУТИЗАЦИЯ
//     в обычный тракт письма к site-author: третьего движка письма в режиме не появляется;
//   посадка (узел плюс значение фильтра)             -> type facet, и ИМЕННО ПОСАДКИ - единица
//     объема работ: 40 категорий по 5 посадок дают 200 страниц, а не 40. Страницей письма
//     становится только ИНДЕКСИРУЕМАЯ посадка: комбинацию, которую мы сами склеили
//     canonical на категорию, писать некому и незачем. Это два разных числа, и оба печатаются;
//   карточка тира A из products-tasks.json           -> type product. Тиры B и C страницами
//     письма НЕ становятся: это строки products_out.csv, их рендерит шаблон, и писателя на
//     пятьсот карточек не бывает.
// Нет catalog.json - каталожных страниц нет вовсе, и это сказано строкой, а не подменено
// заглушкой: сначала catalog.mjs tree и mode.
//
// Использование:
//   node pages.mjs [<слаг|каталог>] [--dry] [--json]
//
// Exit: 0 сделано | 2 отказ (нет проекта или контракта).

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { today, arr, str } from "./_contract.mjs";
import { repoRoot, findDir, plain } from "./queue.mjs";

const die = (msg) => { console.error("[pages] " + msg); process.exit(2); };

export const SLUG_WORDS = 5;
export const SLUG_CHARS = 60;
export const INFO_MAX = 20;
// Потолок списка страниц. Дерево на 400 узлов, 600 посадок и 30 карточек тира A дают
// тысячу с лишним адресов - это законно для каталога, но список все равно ограничен,
// чтобы битая выгрузка не превратилась в бесконечный pages.json.
export const PAGES_MAX = 1200;
// Типы, которые рождаются из catalog.json, а не из directions[].
export const CATALOG_TYPES = ["category", "facet", "product"];
// Режим узла -> тип страницы. service_like уходит в обычный тракт письма, и это
// маршрутизация, а не новый движок.
export const TYPE_OF_MODE = { catalog: "category", thin_category: "category", service_like: "service" };
// Признак «страница пришла из каталога». По нему plan.mjs берет каталожную вилку объема
// и держит потолок 6 блоков у service_like, а build-tasks подкладывает автору CATALOG.md.
// Без него узел service_like типизировался в service и молча получал вилку страницы
// услуги до 11 блоков - то есть ровно тот лендинг, ради запрета которого признак режима
// и делали строгим.
export const FROM_CATALOG = "from_catalog";
// Порядок типов в отчете и число печатаемых строк.
export const PAGE_ORDER = ["landing", "home", "service", "category", "facet", "product", "info"];
export const PRINT_MAX = 40;

// Служебные слова выбрасываются до счета слов: «ремонт ванной комнаты под ключ в спб»
// это пять смысловых слов, а не восемь.
const STOP = new Set(["и", "в", "во", "на", "для", "по", "с", "со", "от", "до", "под", "из", "за", "у", "о", "об", "а", "но", "же", "ли", "или", "к", "при", "без", "the", "for", "and"]);

const TR = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ж: "zh", з: "z", и: "i", й: "y",
  к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u",
  ф: "f", х: "h", ц: "c", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e",
  ю: "yu", я: "ya"
};

export function translit(s) {
  return String(s == null ? "" : s).toLowerCase().replace(/\u0451/g, "е")
    .split("").map((c) => (TR[c] === undefined ? c : TR[c])).join("");
}

export function slugify(name) {
  // Служебные слова снимаются ДО транслитерации: после нее «под» становится «pod» и в
  // списке служебных не находится, а слаг молча теряет одно из пяти смысловых слов.
  const words = String(name == null ? "" : name).toLowerCase()
    .replace(/[^a-z0-9а-я\u0451]+/g, " ")
    .split(/\s+/)
    .filter((w) => w && !STOP.has(w.replace(/\u0451/g, "е")))
    .map((w) => translit(w))
    .filter(Boolean)
    .slice(0, SLUG_WORDS);
  let s = words.join("-").replace(/^-+|-+$/g, "");
  if (s.length > SLUG_CHARS) {
    s = s.slice(0, SLUG_CHARS);
    const cut = s.lastIndexOf("-");
    if (cut >= 10) s = s.slice(0, cut);
    s = s.replace(/-+$/, "");
  }
  return s;
}

// Адрес в путь: домен и параметры отбрасываются, ведущая косая ставится, остальное
// остается ровно таким, каким его дал контракт.
export function pathOf(url) {
  let u = plain(url);
  if (!u) return "";
  u = u.replace(/^[a-z]+:\/\/[^/]+/i, "").replace(/[?#].*$/, "");
  if (!u.startsWith("/")) u = "/" + u;
  return u.replace(/\/{2,}/g, "/");
}

// Адрес посадки строкой запроса. pathOf режет `[?#].*`, и при platform.facet_url query
// (OpenCart, Woo, InSales - большая часть реальных магазинов) `/nasosy/?brand=grundfos`
// схлопывался в `/nasosy/`: семь посадок садились на адрес своей категории, а счетчик
// рядом печатал «посадок 7». Тут домен и двойные слеши нормализуются, а строка запроса
// остается ровно такой, какой ее дал контракт.
export function urlOf(url) {
  const u = plain(url);
  if (!u) return "";
  const cut = u.replace(/^[a-z]+:\/\/[^/]+/i, "");
  const q = cut.indexOf("?");
  const path = q < 0 ? cut : cut.slice(0, q);
  const tail = q < 0 ? "" : cut.slice(q);
  const norm = (path.startsWith("/") ? path : "/" + path).replace(/\/{2,}/g, "/");
  return norm + tail;
}

const lastSeg = (path) => {
  const seg = String(path).split("/").filter(Boolean).pop() || "";
  return seg.replace(/\.[a-z0-9]{2,5}$/i, "");
};

// Значимые корни слов для сверки страницы с направлением. Четыре знака: короче - шум.
export function tokens(...parts) {
  const out = new Set();
  for (const p of parts) {
    for (const w of translit(p).replace(/[^a-z0-9]+/g, " ").split(/\s+/)) {
      if (w.length >= 4 && !STOP.has(w)) out.add(w.slice(0, 6));
    }
  }
  return out;
}

const inter = (a, b) => [...a].filter((x) => b.has(x)).length;
// Отпечаток имени корнями слов: «Насосы циркуляционные» из брифа и «циркуляционные
// насосы» из дерева это одно и то же имя, а не два.
const wordsOf = (s) => [...tokens(s)].sort().join("|");

// ---------------------------------------------------------------- страницы каталога
// Каталог приходит СОБРАННЫМ: дерево, режимы узлов и посадки уже посчитал catalog.mjs, а
// тут они только превращаются в адреса. Своего дерева этот скрипт не строит и режим узла
// не пересматривает: два места, решающих одно и то же, разошлись бы на первом же проекте.
export function catalogPages(catalog, tierA, warn) {
  const nodes = arr(catalog && catalog.tree);
  const out = [], byId = new Map();
  if (!nodes.length) return { pages: out, byId };

  const slugOfUrl = (url, name) => lastSeg(pathOf(url)) || slugify(name) || "";
  // Сколько у узла потомков и сколько в нем позиций. Это МАТЕРИАЛ каталожной страницы:
  // по нему plan.mjs решает, остается ли плитка подкатегорий и блок похожих позиций, или
  // отвечать им нечем. Направления из брифа тут не работают - у каталожной страницы
  // dir пуст, и без этих двух чисел все некритичные блоки каталога уходили бы в снятые.
  const kidsOf = new Map();
  for (const n of nodes) {
    const pid = str(n.parent);
    if (pid) kidsOf.set(pid, (kidsOf.get(pid) || 0) + 1);
  }
  for (const n of nodes) {
    const id = str(n.id);
    const name = str((n.name || {}).nom) || id;
    const mode = str(n.mode);
    const type = TYPE_OF_MODE[mode] || "category";
    const url = pathOf(n.url) || `/${slugify(name) || id}/`;
    const page = {
      slug: slugOfUrl(n.url, name), type, url, name,
      marker: str(n.marker) || name, dir: null, parent: null, fixed: true, from_catalog: true,
      kids: kidsOf.get(id) || 0, sku: Number(n.sku) || 0
    };
    byId.set(id, page);
    out.push(page);
  }
  for (const n of nodes) {
    const page = byId.get(str(n.id));
    const parent = str(n.parent) && byId.get(str(n.parent));
    if (page && parent) page.parent = parent.slug;
  }

  // Посадка - единица объема работ и единица цены. Но СТРАНИЦЕЙ ПИСЬМА становится только
  // индексируемая: комбинация, закрытая canonical на категорию, - это склейка, и платить
  // за свой H1 и свое интро там, где мы сами склеили страницу с категорией, нельзя.
  // Закрытые посадки остаются в контракте и в ТЗ строкой meta.csv: их верстает
  // разработчик, но текста им не пишут. Два числа, а не одно.
  //
  // Адрес берется urlOf, а НЕ pathOf: при facet_url query строка запроса и есть адрес
  // посадки, а слаг берется из id контракта - lastSeg от `/nasosy/?brand=grundfos` дал бы
  // слаг категории всем посадкам сразу.
  let closed = 0;
  for (const L of arr(catalog && catalog.landings)) {
    if (str(L.index) !== "index") { closed++; continue; }
    const parent = byId.get(str(L.node));
    const name = str(L.h1) || str(L.id);
    out.push({
      slug: str(L.id) || slugify(name), type: "facet", url: urlOf(L.url) || `/${slugify(name)}/`,
      name, marker: str(L.marker) || name, dir: null, parent: parent ? parent.slug : null,
      fixed: true, from_catalog: true, kids: 0, sku: Number(L.sku) || 0
    });
  }
  if (closed) warn.push(`посадок закрыто от индексации ${closed} из ${arr(catalog && catalog.landings).length}: страницами письма они не становятся (свой H1 и свое интро у склеенной canonical страницы - выброшенные деньги), но в ТЗ и в meta.csv остаются`);

  // Товары: СТРАНИЦАМИ ПИСЬМА становится только тир A. Тиры B и C - строки products_out.csv,
  // их собирает шаблон за ноль токенов, и заводить им задание автору значило бы вернуть
  // пятьсот одинаковых абзацев, за которые поиск снимает весь раздел.
  for (const c of arr(tierA && tierA.cards)) {
    const name = str(c.name) || str(c.h1) || str(c.sku);
    const parent = byId.get(str(c.node));
    if (!str(c.url)) continue;
    out.push({
      slug: slugOfUrl(c.url, name), type: "product", url: pathOf(c.url), name,
      marker: str(c.h1) || name, dir: null, parent: parent ? parent.slug : null,
      fixed: true, from_catalog: true, kids: 0,
      // У карточки sku - число позиций ЕЕ категории: блок похожих берет соседей оттуда,
      // и без соседей его нечем наполнять.
      sku: parent ? Number(parent.sku) || 0 : 0
    });
  }

  const sl = out.filter((p) => p.type === "service").length;
  if (sl) warn.push(`узлов service_like ${sl}: они идут обычным трактом письма к site-author с потолком 6 блоков, отдельного писателя у каталога нет`);
  if (!arr(tierA && tierA.cards).length) warn.push("карточек тира A нет: страницами письма становится только тир A, тиры B и C живут строками products_out.csv и собираются шаблоном");
  return { pages: out, byId };
}

// ---------------------------------------------------------------- состав страниц
export function buildPages(project, catalog, tierA) {
  const b = project.business || {};
  const kind = str(b.site_kind) || "multipage";
  const dirs = arr(b.directions);
  const warn = [];
  const pages = [];

  const mainMarker = str((dirs[0] || {}).marker) || str((dirs[0] || {}).name) || str(b.what).slice(0, 80);

  if (kind === "landing") {
    pages.push({ slug: "", type: "landing", url: "/", name: str(b.name) || "Лендинг", marker: mainMarker, dir: null, parent: null, fixed: false });
    if (dirs.length > 1) warn.push(`лендинг: направлений ${dirs.length}, все они становятся блоками одной страницы, отдельных адресов у них нет`);
    if (arr(catalog && catalog.tree).length) warn.push(`лендинг: каталог из ${arr(catalog.tree).length} узлов и ${arr(catalog.landings).length} посадок отдельных адресов не получает, товары живут блоком листинга`);
    return finish(project, pages, warn, kind, new Set());
  }

  // Маркер главной - общий, а не маркер первого направления: иначе главная и первая
  // услуга уходят в предупреждение о каннибализации сами с собой.
  pages.push({ slug: "", type: "home", url: "/", name: "Главная", marker: str(b.what).slice(0, 80), dir: null, parent: null, fixed: false });

  // Каталог типизируется ДО направлений: узел дерева знает свой режим, а направление -
  // нет, и типизация «магазин - значит категория» промахивалась на каждом втором узле.
  const shop = str(b.type) === "shop" || str(b.type) === "both";
  const cat = shop ? catalogPages(catalog, tierA, warn) : { pages: [], byId: new Map() };
  const born = new Set(cat.pages);
  const catUrls = new Set(cat.pages.map((p) => p.url));
  const catNames = new Set(cat.pages.map((p) => wordsOf(p.name)));
  for (const p of cat.pages) pages.push(p);
  if (shop && !cat.pages.length) {
    warn.push(`business.type ${str(b.type)}, а catalog.json пуст либо его нет: каталожных страниц не заведено ни одной, сначала catalog.mjs tree и mode`);
  }

  // Направление, которое уже стало узлом дерева, второй страницы не получает: это был бы
  // дубль категории с собственным адресом, то есть каннибализация, созданная конвейером.
  const type = shop && !cat.pages.length ? "category" : "service";
  const byId = new Map(dirs.map((d) => [str(d.id), d]));
  const slugById = new Map(), urlById = new Map();
  for (const d of dirs) {
    const id = str(d.id);
    if (!id) { warn.push(`направление без id пропущено: ${str(d.name)}`); continue; }
    const fixedPath = pathOf(d.url);
    slugById.set(id, fixedPath ? lastSeg(fixedPath) : (slugify(str(d.name)) || slugify(id) || id));
    if (fixedPath) urlById.set(id, fixedPath);
  }
  // Корни раньше детей: адрес ребенка растет из адреса родителя, в том числе из
  // существующего. Иначе сохраненный /uslugi/plitka/ теряет свою ветку.
  const roots = dirs.filter((d) => !str(d.parent) || !byId.has(str(d.parent)));
  const kids = dirs.filter((d) => !roots.includes(d));
  for (const d of roots.concat(kids)) {
    const id = str(d.id);
    if (!id) continue;
    const already = catUrls.has(urlById.get(id) || "") || catNames.has(wordsOf(str(d.name)));
    if (already) {
      warn.push(`направление ${id} уже стоит узлом дерева каталога: второй страницы под тот же запрос не заводим`);
      continue;
    }
    const parentId = str(d.parent);
    const parent = parentId && byId.has(parentId) ? parentId : null;
    if (parentId && !parent) warn.push(`направление ${id}: родитель ${parentId} не найден, страница встает в корень`);
    const slug = slugById.get(id);
    const fixedPath = pathOf(d.url);
    let url = fixedPath;
    if (!url) {
      let base = "/";
      if (parent) {
        const pu = urlById.get(parent) || `/${slugById.get(parent)}/`;
        if (pu.endsWith("/")) base = pu;
        else if (/\.[a-z0-9]{2,5}$/i.test(pu)) warn.push(`направление ${id}: у родителя адрес-файл ${pu}, ребенок встает в корень`);
        else base = pu + "/";
      }
      url = `${base}${slug}/`;
    }
    urlById.set(id, url);
    pages.push({
      slug, type, url, name: str(d.name), marker: str(d.marker) || str(d.name),
      dir: id, parent: parent ? slugById.get(parent) : null, fixed: Boolean(fixedPath)
    });
  }
  if (str(b.type) === "both" && cat.pages.length) {
    warn.push(`type both: услуги остались страницами направлений (${pages.filter((p) => p.type === "service" && p.dir).length}), товары пришли деревом каталога`);
  }
  if (pages.length > PAGES_MAX) {
    warn.push(`страниц ${pages.length} при потолке ${PAGES_MAX}: в список вошли первые ${PAGES_MAX}, остальное - признак битой выгрузки, а не большого каталога`);
    pages.length = PAGES_MAX;
  }
  return finish(project, pages, warn, kind, born);
}

// Старые страницы, адреса и каннибализация - общий хвост для обоих типов сайта.
// born - страницы, рожденные из catalog.json: их уникальность держат catalog.mjs и
// verify-catalog.mjs (свои H1, Title и адрес у каждой посадки), и гонять по ним еще и
// пересечение маркеров значило бы ловить на каждом проекте одно и то же по второму разу.
function finish(project, pages, warn, kind, born) {
  const b = project.business || {};
  const isBorn = (p) => Boolean(born && born.has(p));

  // Столкновение адресов. Придуманному адресу двигаться можно, существующему - нет.
  const seen = new Map();
  for (const p of pages) {
    if (!seen.has(p.url)) { seen.set(p.url, p); continue; }
    const other = seen.get(p.url);
    if (p.fixed && other.fixed) { warn.push(`два направления делят один существующий адрес ${p.url}: ${other.name} и ${p.name}`); continue; }
    const move = p.fixed ? other : p;
    let n = 2, next;
    do { next = move.url.replace(/\/$/, "") + "-" + n + "/"; n++; } while (seen.has(next) && n < 50);
    warn.push(`адрес ${move.url} занят, страница «${move.name}» переехала на ${next}`);
    move.url = next;
    move.slug = lastSeg(next);
    seen.set(next, move);
  }

  // Старые страницы клиента: та, что легла на направление, дает редирект; та, что не
  // легла ни на что, остается инфо-страницей по своему адресу.
  const redirects = [];
  const urls = new Set(pages.map((p) => p.url));
  const cands = pages.filter((p) => p.dir || CATALOG_TYPES.includes(p.type));
  let info = 0;
  for (const cp of arr(b.client_pages)) {
    const from = pathOf(cp.url);
    if (!from || from === "/") continue;
    if (urls.has(from)) continue;
    const t = tokens(str(cp.name), lastSeg(from));
    const scored = cands
      .map((p) => ({ p, n: inter(t, tokens(p.name, p.marker, p.slug)) }))
      .sort((x, y) => y.n - x.n);
    const best = scored[0];
    const unique = best && best.n >= 1 && (!scored[1] || scored[1].n < best.n);
    if (kind === "landing") { redirects.push({ from, to: "/" }); continue; }
    if (unique) { redirects.push({ from, to: best.p.url }); continue; }
    if (info < INFO_MAX) {
      info++;
      pages.push({ slug: lastSeg(from), type: "info", url: from, name: str(cp.name) || lastSeg(from), marker: "", dir: null, parent: null, fixed: true });
      urls.add(from);
    } else warn.push(`инфо-страниц больше ${INFO_MAX}, лишние не заведены: ${from}`);
  }

  // Каннибализация: два маркера об одном и том же. Ловится до письма, потому что после
  // письма это уже две написанные страницы, конкурирующие между собой.
  // Главная в сверку не идет: ее маркер - описание бизнеса, а не запрос, и от сравнения
  // с запросами он дает предупреждение на каждом проекте.
  const marked = pages.filter((p) => p.marker && p.type !== "home" && !isBorn(p));
  for (let i = 0; i < marked.length; i++) {
    for (let j = i + 1; j < marked.length; j++) {
      const a = marked[i], c = marked[j];
      const ta = tokens(a.marker), tc = tokens(c.marker);
      if (!ta.size || !tc.size) continue;
      const both = inter(ta, tc);
      const jac = both / (ta.size + tc.size - both);
      const nested = both === Math.min(ta.size, tc.size) && both >= 2 && Math.abs(ta.size - tc.size) <= 1;
      if (jac >= 0.6 || nested) {
        warn.push(`каннибализация: «${a.marker}» (${a.url}) и «${c.marker}» (${c.url}) делят один запрос`);
      }
    }
  }

  return {
    v: 1, slug: str(project.slug), at: today(), site_kind: kind,
    pages, redirects, warnings: warn
  };
}

export const toCsv = (rows) =>
  ["from,to"].concat(rows.map((r) => [r.from, r.to].map((x) => (/[",]/.test(x) ? `"${String(x).replace(/"/g, '""')}"` : x)).join(","))).join("\n") + "\n";

// ---------------------------------------------------------------- CLI
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
  const dir = findDir(pos[0], root);
  if (!dir) die("проект не найден - сначала queue.mjs init <slug>");
  const pf = join(dir, "project.json");
  if (!existsSync(pf)) die(`нет ${pf} - состав страниц выводится из контракта, а не из догадки`);
  const project = JSON.parse(readFileSync(pf, "utf8"));
  // Каталог и задания тира A читаются, только если они уже собраны. Их отсутствие - не
  // отказ: сайт услуг про них ничего не знает, а магазин получит строку «сначала tree».
  const side = (name) => {
    const f = join(dir, name);
    if (!existsSync(f)) return null;
    try { return JSON.parse(readFileSync(f, "utf8").replace(/^﻿/, "")); }
    catch (e) { return die(`${name} не разобран: ${e.message}`); }
  };
  const catalog = side("catalog.json");
  const out = buildPages(project, catalog, side("products-tasks.json"));

  if (flags.json) { console.log(JSON.stringify(out, null, 2)); return 0; }
  if (!flags.dry) {
    writeFileSync(join(dir, "pages.json"), JSON.stringify(out, null, 2) + "\n", "utf8");
    if (out.redirects.length) writeFileSync(join(dir, "redirects.csv"), toCsv(out.redirects), "utf8");
  }
  console.log(`[pages] ${dir}`);
  const byType = PAGE_ORDER.map((t) => [t, out.pages.filter((p) => p.type === t).length]).filter(([, n]) => n);
  console.log(`  тип сайта ${out.site_kind} | страниц ${out.pages.length}: ${byType.map(([t, n]) => `${t} ${n}`).join(", ")}`);
  const facets = out.pages.filter((p) => p.type === "facet").length;
  const allLandings = arr(catalog && catalog.landings).length;
  if (facets || allLandings) {
    console.log(`  ОБЪЕМ РАБОТ СЧИТАЕТСЯ В ПОСАДКАХ, А НЕ В КАТЕГОРИЯХ: посадок в контракте ${allLandings} при категориях ${out.pages.filter((p) => p.type === "category").length}`);
    console.log(`  из них СТРАНИЦАМИ ПИСЬМА стали ${facets} индексируемых; остальные ${Math.max(0, allLandings - facets)} закрыты и живут строкой meta.csv - это два разных числа и две разные цены`);
  }
  // Печатаются первые сорок строк: на каталоге их тысяча, и список в консоли перестает
  // быть отчетом. Полный список лежит в pages.json.
  for (const p of out.pages.slice(0, PRINT_MAX)) {
    console.log(`  ${p.url.padEnd(34)} ${p.type.padEnd(9)} ${p.fixed ? "адрес сохранен" : "адрес новый  "} ${p.name}`);
  }
  if (out.pages.length > PRINT_MAX) console.log(`  ... и еще ${out.pages.length - PRINT_MAX} страниц, все они в pages.json`);
  if (out.redirects.length) {
    console.log(`  редиректы (${out.redirects.length}):`);
    for (const r of out.redirects) console.log(`    ${r.from} -> ${r.to}`);
  }
  for (const w of out.warnings) console.log(`  ВНИМАНИЕ: ${w}`);
  if (!flags.dry) {
    console.log(`  записано: ${join(dir, "pages.json")}${out.redirects.length ? " и redirects.csv" : ""}`);
    console.log("  дальше: node .claude/scripts/site/recon.mjs plan " + dir);
  }
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) main();
