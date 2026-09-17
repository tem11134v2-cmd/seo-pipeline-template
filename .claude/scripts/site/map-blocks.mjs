#!/usr/bin/env node
// map-blocks.mjs
// Разметка страницы лидера по DOM-ПРИЗНАКАМ: какие блоки стоят на странице, в каком
// порядке и какой они формы. Словарь заголовков тут ВТОРОЙ сигнал: сам по себе он блок
// не засчитывает никогда - только вместе со структурной приметой или с подтверждением
// агента leader-mapper. Причина прямая: у половины рынка заголовок раздела - это ярлык
// («Наши преимущества»), и словарь по нему находит блок там, где его нет.
//
// Скрипт в сеть не ходит и process.env не читает. На вход ему кладут снятый HTML.
//
// Использование:
//   node map-blocks.mjs <файл.html | каталог> [--url <адрес>] [--json] [--out <файл>]
//
// Каталог разбирается целиком: *.html плюс pages.json вида [{url, html}] либо
// {pages:[{url, html}]}. Страницы одного домена сверяются между собой, и раздел,
// повторившийся на двух адресах, вычитается как обвязка.
//
// Exit: 0 разобрано | 2 отказ (нет входа).

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve, extname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { UNIT } from "./_contract.mjs";

// ---------------------------------------------------------------- признак живости
export const ALIVE_HEADINGS = 3;
export const ALIVE_CHARS = 800;

const NUM_UNIT_G = new RegExp("\\d[\\d\\s.,]*\\s*(?:" + UNIT + ")", "gi");
const PRICE_G = /\d[\d\s]{1,9}(?:руб[а-я.]*|\u20bd|р\.(?![а-я]))/gi;

// ---------------------------------------------------------------- текст и теги
const ENT = {
  amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ", laquo: "«", raquo: "»",
  mdash: "-", ndash: "-", minus: "-", rsquo: "'", lsquo: "'", ldquo: "\"", rdquo: "\"",
  hellip: "...", deg: " градусов", times: "x", sup2: "2", middot: "-", bull: "-", rarr: "-"
};

export function textOf(html) {
  return String(html == null ? "" : html)
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z0-9]+);/gi, (m, n) => (ENT[n.toLowerCase()] === undefined ? " " : ENT[n.toLowerCase()]))
    .replace(/[\u2012\u2013\u2014\u2015\u2212]/g, "-")
    .replace(/\u0451/g, "е").replace(/\u0401/g, "Е")
    .replace(/\s+/g, " ")
    .trim();
}

const count = (html, re) => (String(html).match(re) || []).length;

// Вырезать парный тег вместе с содержимым, с учетом вложенности. Разметка, в которой тег
// не закрыт, остается нетронутой: испорченный кусок хуже лишнего.
export function cutTag(html, tag) {
  const re = new RegExp("<" + tag + "\\b[^>]*>|</" + tag + "\\s*>", "gi");
  let out = "", last = 0, depth = 0, m;
  while ((m = re.exec(html))) {
    const open = m[0][1] !== "/";
    if (open && /\/>\s*$/.test(m[0])) continue;
    if (open) { if (depth === 0) out += html.slice(last, m.index); depth++; }
    else if (depth > 0) { depth--; if (depth === 0) last = m.index + m[0].length; }
  }
  if (depth > 0) return html;
  return out + html.slice(last);
}

// Содержимое первого парного тега.
export function grabTag(html, tag) {
  const open = new RegExp("<" + tag + "\\b[^>]*>", "i").exec(html);
  if (!open) return "";
  const from = open.index + open[0].length;
  const re = new RegExp("<" + tag + "\\b[^>]*>|</" + tag + "\\s*>", "gi");
  re.lastIndex = from;
  let depth = 1, m;
  while ((m = re.exec(html))) {
    if (m[0][1] === "/") { depth--; if (!depth) return html.slice(from, m.index); }
    else if (!/\/>\s*$/.test(m[0])) depth++;
  }
  return html.slice(from);
}

export function pickMain(html) {
  let h = String(html || "").replace(/<!--[\s\S]*?-->/g, " ");
  for (const t of ["script", "style", "svg", "noscript", "iframe", "template"]) h = cutTag(h, t);
  const body = grabTag(h, "body") || h;
  const main = grabTag(body, "main") || grabTag(body, "article");
  let inner = main || body;
  for (const t of ["nav", "header", "footer", "aside"]) inner = cutTag(inner, t);
  return inner;
}

// ---------------------------------------------------------------- разделы и приметы
export function splitSections(main) {
  const re = /<h([1-3])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi;
  const out = [];
  let cur = { level: 0, heading: "", start: 0 }, m;
  while ((m = re.exec(main))) {
    out.push({ level: cur.level, heading: cur.heading, html: main.slice(cur.start, m.index) });
    cur = { level: Number(m[1]), heading: textOf(m[2]), start: m.index + m[0].length };
  }
  out.push({ level: cur.level, heading: cur.heading, html: main.slice(cur.start) });
  return out
    .filter((s, i) => (i === 0 ? textOf(s.html).length >= 40 : true))
    .map((s, i) => ({ at: i, level: s.level, heading: s.heading, html: s.html }));
}

export function feat(sec) {
  const h = sec.html;
  const ols = [];
  let rest = h, guard = 0;
  while (/<ol\b/i.test(rest) && guard++ < 20) {
    ols.push(grabTag(rest, "ol"));
    rest = rest.replace(/<ol\b[^>]*>/i, "<olcut>");
  }
  const text = textOf(h);
  const prices = count(h, PRICE_G);
  const cards = Math.max(
    count(h, /class=["'][^"']*\b(?:card|item|tile|product|case|review|advantage|benefit|service|step)[a-z0-9_-]*\b/gi),
    count(h, /<li\b/gi)
  );
  return {
    at: sec.at, level: sec.level, heading: sec.heading,
    h1: sec.level === 1,
    text: text.length,
    imgs: count(h, /<img\b/gi),
    links: count(h, /<a\b[^>]*href/gi),
    forms: count(h, /<form\b/gi),
    fields: count(h, /<input\b(?![^>]*type\s*=\s*.{0,2}(?:hidden|submit|button|image))/gi)
      + count(h, /<textarea\b/gi) + count(h, /<select\b/gi),
    buttons: count(h, /<button\b/gi) + count(h, /<input[^>]*type\s*=\s*.{0,2}submit/gi)
      + count(h, /class=["'][^"']*\bbtn|class=["'][^"']*\bbutton/gi),
    tables: count(h, /<table\b/gi),
    rows: count(h, /<tr\b/gi),
    cells: count(h, /<t[dh]\b/gi),
    li: count(h, /<li\b/gi),
    ol: ols.reduce((n, x) => n + count(x, /<li\b/gi), 0),
    paras: count(h, /<p\b/gi),
    details: count(h, /<details\b/gi) + count(h, /class=["'][^"']*\b(?:accordion|spoiler|faq|collapse)[a-z0-9_-]*\b/gi),
    quotes: count(h, /<blockquote\b/gi) + count(h, /class=["'][^"']*\b(?:review|testimonial|otzyv)[a-z0-9_-]*\b/gi),
    prices,
    cards,
    cardPrice: Math.min(cards, prices),
    nums: count(h, NUM_UNIT_G)
  };
}

// Вторая примета раздела для блоков, у которых структурного признака нет вовсе.
const sec2 = (f) => f.li >= 3 || f.cards >= 3 || f.paras >= 2;

// ---------------------------------------------------------------- таблица признаков
// dom - структурная примета, решает сама. need "dom+dict" - структура плюс словарь
// заголовка либо подтверждение агента. Блок без dom вовсе засчитывается только по
// словарю И второй примете раздела, либо по словарю И подтверждению агента.
// Порядок строк - как в pages.yml: на нем же разводятся ничьи при сборке order[].
export const D = [
  ["hero", { dom: (f) => f.at <= 1 && f.h1 && f.buttons >= 1 && f.text <= 1400, form: () => "заголовок и кнопка" }],
  ["numbers", { dom: (f) => f.nums >= 3 && f.text <= 500 && f.cards >= 3 && f.ol === 0 && f.prices === 0, form: () => "плашки с цифрами" }],
  ["nav", { dom: (f) => f.links >= 4 && f.cards >= 4 && f.text <= 800 && f.prices === 0 && f.at <= 3, form: (f) => f.cards + " плиток" }],
  ["scope", { dom: (f) => f.li >= 5 && f.li <= 14 && f.prices === 0 && f.tables === 0, dict: /что вход|состав работ|что дела|что мы дела|услуги включ|входит в/i, need: "dom+dict", form: (f) => "список " + f.li }],
  ["fit", { dict: /кому подход|подойдет|подходит|ваш случай|это для вас|когда нужн/i, form: () => "список условий" }],
  ["not_fit", { dict: /не подход|не работаем|не берем|не занимаемся|с кем не/i, form: () => "строки границы" }],
  ["problem", { dict: /проблем|ситуац|беда|с чем обраща|решаем задач/i, form: () => "пары ситуация и работа" }],
  ["result", { dict: /что вы получ|результат|на выходе|итог работ/i, form: () => "список результата" }],
  ["edge", { dom: (f) => f.cards >= 3 && f.cards <= 9 && f.nums >= 2 && f.prices === 0 && f.imgs <= 3, dict: /почему|преимуществ|отлича|выгод|нас выбир/i, need: "dom+dict", form: (f) => f.cards + " карточек" }],
  // Три колонки и больше: таблица сравнения вариантов, а не прайс из двух колонок.
  ["compare", { dom: (f) => f.tables >= 1 && f.rows >= 3 && f.rows <= 7 && f.prices >= 2 && f.cells >= f.rows * 3, form: (f) => "таблица " + f.rows + " строк" }],
  ["price", { dom: (f) => f.prices >= 2 && (f.rows >= 2 || f.cards >= 2) && f.cardPrice < 8, form: (f) => (f.tables ? "таблица " + f.rows + " строк" : f.cards + " карточек") }],
  ["price_factors", { dict: /от чего завис|что влия|почему дороже|формиру|влияет на стоим/i, form: () => "пары условие и эффект" }],
  ["steps", { dom: (f) => f.ol >= 3 && f.ol <= 9, dict: /как мы работ|этап|шаг|порядок работ|после заявк|как проходит/i, need: "dom+dict", form: (f) => f.ol + " шагов" }],
  ["cases", { dom: (f) => f.cards >= 2 && f.imgs >= 2 && f.nums >= 1 && f.cardPrice < 8, dict: /работ|проект|объект|кейс|портфолио|пример/i, need: "dom+dict", form: (f) => f.cards + " карточек с фото" }],
  ["reviews", { dom: (f) => f.quotes >= 2, dict: /отзыв|говорят|клиенты о нас|рекоменд/i, need: "dom+dict", form: (f) => f.quotes + " цитат" }],
  ["docs", { dom: (f) => f.imgs >= 2 && f.prices === 0 && f.text <= 900, dict: /лиценз|сертификат|допуск|свидетельств|документ|разрешен|сро/i, need: "dom+dict", form: (f) => f.imgs + " сканов" }],
  ["about", { dict: /о компании|о нас|кто мы|наша команда|о фирме/i, form: () => "абзацы" }],
  ["geo", { dict: /район|зона|выезжаем|где работаем|географ|обслужива/i, form: () => "список зон" }],
  ["delivery", { dict: /доставк|оплат|как получ|условия работы|самовывоз/i, form: () => "две колонки" }],
  ["qa", { dom: (f) => f.details >= 3, dict: /вопрос|faq|отвечаем|спрашива/i, form: (f) => "аккордеон " + f.details }],
  ["cta_mid", { dom: (f) => f.buttons >= 1 && f.fields === 0 && f.text <= 260 && f.at >= 2, form: () => "строка и кнопка" }],
  ["cta_form", { dom: (f) => f.forms >= 1 && f.fields >= 2 && f.fields <= 6, form: (f) => "форма " + f.fields + " полей" }],
  ["cat_intro", { dom: (f) => f.at <= 1 && f.text >= 150 && f.text <= 800 && f.cards <= 2 && f.paras >= 1, form: () => "абзац над листингом" }],
  ["listing", { dom: (f) => f.cardPrice >= 8, form: (f) => "сетка " + f.cards + " карточек" }],
  ["subcats", { dom: (f) => f.links >= 4 && f.imgs >= 4 && f.prices === 0 && f.text <= 600, form: (f) => f.links + " плиток" }],
  ["cat_text", { dom: (f) => f.text >= 800 && f.paras >= 3 && f.cards <= 2 && f.prices <= 4, form: (f) => f.paras + " абзацев" }],
  ["gallery", { dom: (f) => f.at <= 1 && f.imgs >= 4 && f.prices >= 1, form: (f) => f.imgs + " фото и панель" }],
  ["specs", { dom: (f) => f.tables >= 1 && f.rows >= 8 && f.cells >= 16, form: (f) => "таблица " + f.rows + " строк" }],
  ["product_desc", { dom: (f) => f.at >= 2 && f.paras >= 2 && f.text >= 400 && f.cards <= 2, dict: /описан|назначен|особенност|о товаре|комплект/i, need: "dom+dict", form: (f) => f.paras + " абзацев" }],
  ["related", { dom: (f) => f.at >= 2 && f.cardPrice >= 4 && f.cardPrice <= 10, dict: /похож|смотрят|сопутств|вместе с|другие/i, need: "dom+dict", form: (f) => f.cards + " карточек" }]
];
export const BLOCK_ORDER = D.map(([id]) => id);

// Один раздел - список id, которые он закрывает. named - что по этому разделу сказал
// агент leader-mapper; его может не быть вовсе, и тогда решает только структура.
export function detectSection(f, named = []) {
  const hit = [];
  for (const [id, d] of D) {
    const dom = typeof d.dom === "function" ? Boolean(d.dom(f)) : null;
    const dict = d.dict ? d.dict.test(f.heading) : false;
    let on;
    if (dom === null) on = dict && (named.includes(id) || sec2(f));
    else if (d.need === "dom+dict") on = dom && (dict || named.includes(id));
    else on = dom;
    if (on) hit.push({ id, form: d.form ? String(d.form(f)) : "" });
  }
  return hit;
}

// ---------------------------------------------------------------- страница
export function readPage(html, opts = {}) {
  const main = pickMain(html);
  const secs = splitSections(main).map((s) => ({ at: s.at, level: s.level, heading: s.heading, html: s.html, f: feat(s) }));
  return { url: String(opts.url || ""), pos: Number(opts.pos || 0) || 0, sections: secs };
}

export const domainOf = (url) =>
  String(url || "").replace(/^[a-z]+:\/\//i, "").split("/")[0].replace(/^www\./i, "").toLowerCase();

const norm = (s) => textOf(s).toLowerCase().replace(/[^a-zа-я0-9 ]/g, "").slice(0, 400);

// Обвязка: раздел, чей текст повторился на двух адресах одного домена. Шапка и подвал
// уже вычтены тегами, но меню-простыни и блок «о компании» в подвале живут дивами.
export function dropBoilerplate(pages) {
  const seen = new Map();
  for (const p of pages) {
    const own = new Set();
    for (const s of p.sections) {
      const k = domainOf(p.url) + "|" + norm(s.html);
      if (own.has(k)) continue;
      own.add(k);
      seen.set(k, (seen.get(k) || 0) + 1);
    }
  }
  return pages.map((p) => ({
    ...p,
    sections: p.sections
      .filter((s) => (seen.get(domainOf(p.url) + "|" + norm(s.html)) || 0) < 2)
      .map((s, i) => ({ ...s, at: i }))
  }));
}

// Живая страница: из main с вычетом обвязки снято >= 3 заголовка и >= 800 знаков.
export function markAlive(page) {
  const headings = page.sections.filter((s) => s.level > 0 && s.heading).length;
  const chars = page.sections.reduce((n, s) => n + textOf(s.html).length + s.heading.length, 0);
  return { ...page, headings, chars, alive: headings >= ALIVE_HEADINGS && chars >= ALIVE_CHARS };
}

// Блоки страницы: id -> первый раздел, где он найден, плюс форма.
export function pageBlocks(page, namedByAt = {}) {
  const first = new Map();
  for (const s of page.sections) {
    for (const h of detectSection(s.f, namedByAt[s.at] || [])) {
      if (!first.has(h.id)) first.set(h.id, { id: h.id, at: s.at, form: h.form });
    }
  }
  return [...first.values()].sort((a, b) => a.at - b.at || BLOCK_ORDER.indexOf(a.id) - BLOCK_ORDER.indexOf(b.id));
}

// Чужие числа страницы. Дальше они едут в tainted[] и грепаются по собранному сайту.
export function pageNumbers(page) {
  const out = new Set();
  for (const s of page.sections) {
    const t = textOf(s.html) + " " + s.heading;
    for (const m of t.match(NUM_UNIT_G) || []) out.add(m.replace(/\s+/g, " ").trim());
    for (const m of t.match(PRICE_G) || []) out.add(m.replace(/\s+/g, " ").trim());
  }
  return [...out].sort();
}

// ---------------------------------------------------------------- покрытие кластера
export const median = (xs) => {
  const a = xs.slice().sort((x, y) => x - y);
  if (!a.length) return 0;
  const i = Math.floor((a.length - 1) / 2);
  return a.length % 2 ? a[i] : Math.round((a[i] + a[i + 1]) / 2);
};

// pages - уже размеченные ЖИВЫЕ страницы вида {url, pos, chars, blocks:[{id, at, form}]}.
// Покрытие считается от живых, а не от попыток: это и есть разница между «рынок так
// делает» и «нам столько раз ответили пустой страницей».
export function coverage(pages) {
  const n = pages.length;
  const cov = {}, cov_evidence = {}, ranks = {}, form = {};
  const sorted = pages.slice().sort((a, b) => (a.pos || 99) - (b.pos || 99) || String(a.url).localeCompare(String(b.url)));
  for (const id of BLOCK_ORDER) {
    const on = sorted.filter((p) => p.blocks.some((b) => b.id === id));
    if (!on.length) continue;
    cov[id] = n ? Math.round((on.length / n) * 100) / 100 : 0;
    cov_evidence[id] = on[0].url;
    ranks[id] = median(on.map((p) => p.blocks.findIndex((b) => b.id === id) + 1));
    const tally = new Map();
    for (const p of on) {
      const f = (p.blocks.find((b) => b.id === id) || {}).form || "";
      if (f) tally.set(f, (tally.get(f) || 0) + 1);
    }
    const best = [...tally.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    if (best) form[id] = best[0];
  }
  const order = Object.keys(ranks).sort((a, b) => ranks[a] - ranks[b] || BLOCK_ORDER.indexOf(a) - BLOCK_ORDER.indexOf(b));
  return {
    cov, cov_evidence, order, form,
    blocks_median: median(pages.map((p) => p.blocks.length)),
    chars_median: median(pages.map((p) => p.chars || 0))
  };
}

// ---------------------------------------------------------------- вход с диска
export function loadRaw(path) {
  const p = resolve(path);
  if (!existsSync(p)) return [];
  if (statSync(p).isFile()) {
    if (extname(p).toLowerCase() === ".json") return fromJson(JSON.parse(readFileSync(p, "utf8")));
    return [{ url: "file://" + basename(p), html: readFileSync(p, "utf8"), pos: 0 }];
  }
  const out = [];
  for (const name of readdirSync(p).sort()) {
    const f = join(p, name);
    if (!statSync(f).isFile()) continue;
    const ext = extname(name).toLowerCase();
    if (ext === ".html" || ext === ".htm") out.push({ url: "file://" + name, html: readFileSync(f, "utf8"), pos: 0 });
    else if (ext === ".json" && /page|fetch|batch/i.test(name)) out.push(...fromJson(JSON.parse(readFileSync(f, "utf8"))));
  }
  return out;
}

// Форма ответа seo_fetch_batch у разных версий разная, поэтому принимаем четыре обертки
// и одну плоскую запись. Страница короче 200 знаков разметки - это не страница.
export function fromJson(j) {
  const list = Array.isArray(j) ? j : (j.pages || j.results || j.items || j.data || []);
  return (Array.isArray(list) ? list : [])
    .map((x) => ({
      url: String(x.url || x.link || x.address || ""),
      html: String(x.html || x.content || x.body || x.text || ""),
      pos: Number(x.pos || x.position || 0) || 0
    }))
    .filter((x) => x.html.length > 200);
}

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

function human(pages) {
  const L = [];
  for (const p of pages) {
    L.push(`${p.url} | ${p.alive ? "живая" : "пустая"} | заголовков ${p.headings} | знаков ${p.chars}`);
    for (const s of p.sections) {
      L.push(`  [${s.at}] h${s.level} ${s.heading || "(без заголовка)"} | знаков ${textOf(s.html).length} | машина: ${detectSection(s.f).map((h) => h.id).join(", ") || "-"}`);
      L.push(`       карточек ${s.f.cards}, фото ${s.f.imgs}, строк таблицы ${s.f.rows}, полей формы ${s.f.fields}, пунктов ol ${s.f.ol}, цен ${s.f.prices}, аккордеон ${s.f.details}`);
    }
    L.push(`  блоки: ${pageBlocks(p).map((b) => b.id).join(" ") || "-"}`);
  }
  return L.join("\n");
}

function main() {
  const { flags, pos } = parseArgs(process.argv.slice(2));
  if (!pos[0]) { console.error("[map-blocks] нужен файл или каталог со снятыми страницами"); process.exit(2); }
  const raw = loadRaw(pos[0]);
  if (!raw.length) { console.error(`[map-blocks] в ${pos[0]} нет снятых страниц`); process.exit(2); }
  if (flags.url && flags.url !== true && raw.length === 1) raw[0].url = String(flags.url);

  const pages = dropBoilerplate(raw.map((r, i) => readPage(r.html, { url: r.url, pos: r.pos || i + 1 }))).map(markAlive);
  const body = flags.json
    ? JSON.stringify({
        pages: pages.map((p) => ({
          url: p.url, pos: p.pos, alive: p.alive, headings: p.headings, chars: p.chars,
          sections: p.sections.map((s) => ({
            at: s.at, level: s.level, heading: s.heading, chars: textOf(s.html).length,
            f: s.f, machine: detectSection(s.f).map((h) => h.id)
          })),
          blocks: pageBlocks(p)
        }))
      }, null, 2)
    : human(pages);
  if (flags.out && flags.out !== true) { writeFileSync(String(flags.out), body + "\n", "utf8"); console.log(`[map-blocks] записано ${flags.out}`); }
  else console.log(body);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) main();
