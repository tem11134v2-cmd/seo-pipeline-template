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

// ---------------------------------------------------------------- состав страниц
export function buildPages(project) {
  const b = project.business || {};
  const kind = str(b.site_kind) || "multipage";
  const dirs = arr(b.directions);
  const warn = [];
  const pages = [];

  const mainMarker = str((dirs[0] || {}).marker) || str((dirs[0] || {}).name) || str(b.what).slice(0, 80);

  if (kind === "landing") {
    pages.push({ slug: "", type: "landing", url: "/", name: str(b.name) || "Лендинг", marker: mainMarker, dir: null, parent: null, fixed: false });
    if (dirs.length > 1) warn.push(`лендинг: направлений ${dirs.length}, все они становятся блоками одной страницы, отдельных адресов у них нет`);
    return finish(project, pages, warn, kind);
  }

  // Маркер главной - общий, а не маркер первого направления: иначе главная и первая
  // услуга уходят в предупреждение о каннибализации сами с собой.
  pages.push({ slug: "", type: "home", url: "/", name: "Главная", marker: str(b.what).slice(0, 80), dir: null, parent: null, fixed: false });

  const type = str(b.type) === "shop" ? "category" : "service";
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
  if (str(b.type) === "both") {
    warn.push(`type both: направления стали страницами услуг, каталог из assortment (${arr(b.assortment).length} позиций) собирает следующий срез`);
  }
  return finish(project, pages, warn, kind);
}

// Старые страницы, адреса и каннибализация - общий хвост для обоих типов сайта.
function finish(project, pages, warn, kind) {
  const b = project.business || {};

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
  const cands = pages.filter((p) => p.dir);
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
  const marked = pages.filter((p) => p.marker && p.type !== "home");
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
  const out = buildPages(project);

  if (flags.json) { console.log(JSON.stringify(out, null, 2)); return 0; }
  if (!flags.dry) {
    writeFileSync(join(dir, "pages.json"), JSON.stringify(out, null, 2) + "\n", "utf8");
    if (out.redirects.length) writeFileSync(join(dir, "redirects.csv"), toCsv(out.redirects), "utf8");
  }
  console.log(`[pages] ${dir}`);
  console.log(`  тип сайта ${out.site_kind} | страниц ${out.pages.length}`);
  for (const p of out.pages) {
    console.log(`  ${p.url.padEnd(34)} ${p.type.padEnd(9)} ${p.fixed ? "адрес сохранен" : "адрес новый  "} ${p.name}`);
  }
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
