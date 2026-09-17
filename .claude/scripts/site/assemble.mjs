#!/usr/bin/env node
// assemble.mjs
// Сборка написанных страниц в ОДИН self-contained site.html: стартовая страница-список,
// секции страниц с неймспейсом, hash-роутер, меню из состава страниц.
//
// Четыре вещи, которые тут важнее кода:
//   1. СЛУЖЕБНЫЙ ХВОСТ В ВЕРСТКУ НЕ ПОПАДАЕТ. Все после последней строки --- живет в
//      журнале исключений и в отчете, но не в документе: «снят», «слито», «мысль» и
//      «недостает» адресованы конвейеру, а не читателю.
//   2. РАЗБОР СТРАНИЦЫ ОДИН НА ВЕСЬ КОНВЕЙЕР. Файл разбирает parsePage из verify-page.mjs.
//      Второй разбор тех же меток разошелся бы с первым на первой же опечатке, и сборка
//      показывала бы не то, что проверил верификатор.
//   3. ПОЗИЦИОННЫЙ ФОЛБЭК. Раздел без метки q: встает на место из плана по порядку и
//      помечается в верстке. Опечатка в разметке не теряет текст - это закон этапа.
//   4. ТЕМА WIREFRAME. Черное на белом, рамки, никаких цветных тем, попапов и анимаций:
//      прототип показывает состав и текст, а не вкус сборщика.
//
// Использование:
//   node assemble.mjs [<слаг|каталог>] [--out <файл>] [--dry] [--json] [--root <репо>]
//
// Exit: 0 собрано | 2 отказ (нет проекта, нет написанных страниц).

import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { arr, str, today, readPages, pageName } from "./_contract.mjs";
import { repoRoot, findDir, plain, isProjectDir, readQueue, appendJournal } from "./queue.mjs";
import { parsePage } from "./verify-page.mjs";

const die = (msg) => { console.error("[assemble] " + msg); process.exit(2); };
const chars = (s) => Array.from(String(s == null ? "" : s)).length;
const loadJson = (f) => { try { return existsSync(f) ? JSON.parse(readFileSync(f, "utf8").replace(/^﻿/, "")) : null; } catch { return null; } };

// ---------------------------------------------------------------- имя файла страницы
// То же правило, что у build-tasks.mjs: слаг, а у главной и лендинга - index. Иначе
// задание, написанная страница и секция сборки называются по-разному и не находят друг
// друга. Дедупликация идет в порядке плана, как и там.
export const nameOf = pageName;

// ---------------------------------------------------------------- адреса в маршруты
export function routeOf(href, from, urls) {
  const h = str(href);
  if (!h) return { href: "", kind: "empty", path: "" };
  if (/^(?:[a-z]+:|\/\/)/i.test(h)) return { href: h, kind: "out", path: "" };
  if (h.startsWith("#")) return { href: h, kind: "anchor", path: "" };
  const clean = h.replace(/[?#].*$/, "");
  const abs = clean.startsWith("/") ? clean : String(from || "/").replace(/[^/]*$/, "") + clean;
  const seg = [];
  for (const s of abs.split("/")) {
    if (!s || s === ".") continue;
    if (s === "..") { seg.pop(); continue; }
    seg.push(s);
  }
  let path = "/" + seg.join("/");
  if (path !== "/" && /\/$/.test(clean)) path += "/";
  return { href: "#" + path, kind: urls.has(path) ? "in" : "miss", path };
}

// ---------------------------------------------------------------- markdown
const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function inline(text, ctx) {
  let s = esc(text);
  s = s.replace(/\[([^\]\n]{1,120})\]\(([^)\s]*)\)/g, (m, label, href) => {
    const r = routeOf(href, ctx.url, ctx.urls);
    if (r.kind === "miss") ctx.warn(`${ctx.name}: ссылка на ${r.path} - такой страницы в сборке нет`);
    return r.href ? `<a href="${esc(r.href)}">${label}</a>` : label;
  });
  s = s.replace(/\*\*([^*\n]{1,200})\*\*/g, "<b>$1</b>");
  s = s.replace(/(^|[\s(])\*([^*\n]{1,200})\*(?=[\s).,;:!?]|$)/g, "$1<i>$2</i>");
  s = s.replace(/`([^`\n]{1,120})`/g, "<code>$1</code>");
  return s;
}

const isSep = (r) => /^\|?[\s:|-]+\|?$/.test(r) && r.includes("-");
const cells = (r) => r.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());

function table(rows, ctx) {
  const body = rows.filter((r) => !isSep(r));
  if (!body.length) return "";
  const head = cells(body[0]).map((c) => "<th>" + inline(c, ctx) + "</th>").join("");
  const rest = body.slice(1).map((r) => "<tr>" + cells(r).map((c) => "<td>" + inline(c, ctx) + "</td>").join("") + "</tr>").join("");
  return `<table><thead><tr>${head}</tr></thead><tbody>${rest}</tbody></table>`;
}

// Разметки ровно столько, сколько пишет автор: заголовок, абзац, список, таблица, цитата,
// ссылка, жирное, строка-кнопка. Больше синтаксиса - больше расхождений между тем, что
// проверил верификатор, и тем, что увидел заказчик.
export function renderBody(rawLines, ctx) {
  const L = rawLines.map((x) => (typeof x === "string" ? x : x.s));
  const out = [];
  let para = [];
  const flush = () => {
    const t = para.join(" ").trim();
    para = [];
    if (t) out.push("<p>" + inline(t, ctx) + "</p>");
  };
  for (let i = 0; i < L.length; i++) {
    const t = String(L[i]).trim();
    if (!t) { flush(); continue; }
    const h = /^(#{2,6})\s+(.+)$/.exec(t);
    if (h) { flush(); const lv = Math.min(h[1].length, 4); out.push(`<h${lv}>${inline(h[2].trim(), ctx)}</h${lv}>`); continue; }
    if (/^\|/.test(t)) {
      flush();
      const rows = [];
      while (i < L.length && /^\s*\|/.test(L[i])) { rows.push(L[i]); i++; }
      i--;
      out.push(table(rows, ctx));
      continue;
    }
    if (/^[-*+]\s+/.test(t)) {
      flush();
      const items = [];
      while (i < L.length && /^\s*[-*+]\s+/.test(L[i])) { items.push(L[i].trim().replace(/^[-*+]\s+/, "")); i++; }
      i--;
      out.push("<ul>" + items.map((x) => "<li>" + inline(x, ctx) + "</li>").join("") + "</ul>");
      continue;
    }
    if (/^\d+[.)]\s+/.test(t)) {
      flush();
      const items = [];
      while (i < L.length && /^\s*\d+[.)]\s+/.test(L[i])) { items.push(L[i].trim().replace(/^\d+[.)]\s+/, "")); i++; }
      i--;
      out.push("<ol>" + items.map((x) => "<li>" + inline(x, ctx) + "</li>").join("") + "</ol>");
      continue;
    }
    if (/^>\s?/.test(t)) {
      flush();
      const items = [];
      while (i < L.length && /^\s*>\s?/.test(L[i])) { items.push(L[i].trim().replace(/^>\s?/, "")); i++; }
      i--;
      out.push("<blockquote>" + inline(items.join(" "), ctx) + "</blockquote>");
      continue;
    }
    const btn = /^\*\*([^*\n]{1,60})\*\*$/.exec(t);
    if (btn) { flush(); out.push(`<p class="btn"><span>${inline(btn[1], ctx)}</span></p>`); continue; }
    para.push(t);
  }
  flush();
  return out.filter(Boolean).join("\n");
}

// ---------------------------------------------------------------- страницы
// Разрешение id раздела повторяет verify-page: метка, известная pages.yml, иначе место по
// порядку в действующем составе плана. Верстка и проверка обязаны видеть один и тот же
// состав, иначе отчет говорит про один блок, а верстка показывает другой.
function resolve_ids(P, yml, planBlocks) {
  const active = planBlocks.filter((b) => b.ord).sort((a, b) => a.ord - b.ord).map((b) => b.id);
  P.sections.forEach((s, idx) => {
    const known = Boolean(s.qid && yml.blocks.has(s.qid));
    s.id = known ? s.qid : (active[idx] || "");
    s.known = known;
    s.fallback = !known && Boolean(s.id);
  });
}

export function collect(dir, root) {
  const yml = readPages(join(root, ".claude/skills/site-proto/pages.yml"));
  if (!yml) die("нет pages.yml - вопросы читателя и состав блоков берутся оттуда");
  const pdir = join(dir, "pages");
  if (!existsSync(pdir)) die(`нет ${pdir} - собирать нечего, страницы пишет site-author`);
  const files = readdirSync(pdir).filter((n) => n.endsWith(".md")).sort();
  if (!files.length) die(`в ${pdir} нет ни одной страницы`);

  const project = loadJson(join(dir, "project.json"));
  const plan = loadJson(join(dir, "plan.json"));
  const pagesJson = loadJson(join(dir, "pages.json"));
  const warnings = [];
  const warn = (m) => { if (!warnings.includes(m)) warnings.push(m); };

  // Порядок страниц - порядок плана; имена считаются тем же дедупликатором, что и у заданий.
  const taken = new Set();
  const byName = new Map();
  const order = [];
  const src = plan ? arr(plan.pages) : arr(pagesJson && pagesJson.pages).map((page) => ({ page, blocks: [] }));
  for (const p of src) {
    const name = nameOf(p.page || p, taken);
    byName.set(name, p);
    order.push(name);
  }
  if (!plan) warn("нет plan.json: позиционного фолбэка нет, состав сверить не с чем");

  const urls = new Set();
  for (const p of src) urls.add(str((p.page || p).url) || "/");
  const titleByUrl = new Map(arr(pagesJson && pagesJson.pages).map((p) => [str(p.url), str(p.name)]));
  // Метатеги считает формула на шаге 5 и кладет в tasks/meta.json. Автор их не пишет: у
  // него дорогое место, а title и description выводятся из контракта без единого решения.
  // Врезка страницы, если автор ее все-таки написал, перебивает расчет.
  const metaJson = loadJson(join(dir, "tasks", "meta.json"));
  const calcMeta = new Map(arr(metaJson && metaJson.pages).map((m) => [str(m.url), m]));
  if (!metaJson) warn("нет tasks/meta.json: title и description в сборку не попадут, шаг 5 не пройден");

  const pages = [];
  const seen = new Set();
  for (const name of order.concat(files.map((f) => f.replace(/\.md$/i, "")))) {
    if (seen.has(name)) continue;
    seen.add(name);
    const file = join(pdir, name + ".md");
    if (!existsSync(file)) { warn(`страница ${name} запланирована, но не написана`); continue; }
    const entry = byName.get(name) || null;
    const meta = entry ? (entry.page || entry) : null;
    if (!meta) warn(`${name}.md написана, но в плане ее нет`);
    const P = parsePage(file);
    resolve_ids(P, yml, entry ? arr(entry.blocks) : []);
    const url = str(meta && meta.url) || "/" + name + "/";
    pages.push({
      name,
      url,
      type: str(meta && meta.type) || "",
      // Имя в меню - короткое имя страницы из pages.json. H1 сюда не ставится: в плане
      // имени нет, а заголовок-ответ в меню занимает три строки и перестает быть меню.
      title: titleByUrl.get(url) || str(meta && meta.name) || P.h1 || name,
      plan: entry && entry.blocks ? arr(entry.blocks) : [],
      meta: {
        title: str(P.meta && P.meta.title) || str((calcMeta.get(url) || {}).title),
        description: str(P.meta && P.meta.description) || str((calcMeta.get(url) || {}).description)
      },
      P
    });
  }
  if (!pages.length) die("ни одной написанной страницы не сопоставлено - проверь каталог pages/");
  for (const p of pages) urls.add(p.url);
  return { yml, project, plan, pages, warnings, warn, urls };
}

// ---------------------------------------------------------------- верстка
const firstLine = (s) => {
  for (const l of s.lines) {
    const t = String(l.s).trim();
    if (!t || /^(#{2,6}\s|[|>]|[-*+]\s|\d+[.)]\s)/.test(t)) continue;
    const clean = t.replace(/\*\*|\*|`/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
    return clean.length > 64 ? clean.slice(0, 63).replace(/\s+\S*$/, "") + "..." : clean;
  }
  return "";
};

function pageHtml(p, n, ctx) {
  const ns = "p" + n;
  const qOf = (id) => {
    const row = ctx.yml.blocks.get(id);
    return row ? str(row[1]) : "";
  };
  const toc = [], body = [];
  const anchors = new Set();
  p.sections = [];
  p.P.sections.forEach((s, idx) => {
    const id = s.id || "";
    // Неймспейс страницы плюс защита от двух разделов с одной меткой: id в документе
    // обязан быть один, иначе роутер и якоря меню уводят не туда.
    let anchor = ns + "-" + (id || "s" + (idx + 1));
    let k = 2;
    while (anchors.has(anchor)) anchor = `${ns}-${id || "s" + (idx + 1)}-${k++}`;
    anchors.add(anchor);
    // Пункт меню - ЗАГОЛОВОК-ОТВЕТ, а вопрос читателя стоит под ним второй строкой. У
    // первого экрана заголовка нет, и тогда пунктом становится его первая строка: меню из
    // одних вопросов читалось бы как список дырок, а не как состав страницы.
    const head = s.head || firstLine(s) || (id ? qOf(id) : "") || "Раздел " + (idx + 1);
    const tag = id ? (s.fallback ? id + " - место по порядку" : id) : "раздел без метки";
    body.push(
      `<section class="blk" id="${esc(anchor)}"${id ? ` data-block="${esc(id)}"` : ""}${s.fallback ? ' data-fallback="1"' : ""}>` +
      `<p class="tag">${esc(tag)}</p>` +
      renderBody(s.lines, { url: p.url, urls: ctx.urls, warn: ctx.warn, name: p.name }) +
      "</section>"
    );
    const q = id ? qOf(id) : "";
    toc.push(`<li><a href="#${esc(p.url)}~${esc(anchor)}">${esc(head)}</a>${q && q !== head ? `<span class="q">${esc(q)}</span>` : ""}</li>`);
    p.sections.push({ id, anchor, head, fallback: Boolean(s.fallback) });
  });
  const meta = [];
  for (const k of ["title", "description"]) if (p.meta && p.meta[k]) meta.push(`${k}: ${esc(p.meta[k])}`);
  return [
    `<section class="page" id="${ns}" data-page="${esc(p.url)}" hidden>`,
    `<p class="crumb">${esc(p.type || "страница")} | ${esc(p.url)}</p>`,
    `<h1>${esc(p.P.h1 || p.title)}</h1>`,
    toc.length ? `<nav class="toc"><p class="tag">состав страницы</p><ul>${toc.join("")}</ul></nav>` : "",
    body.join("\n"),
    meta.length ? `<p class="meta">${meta.join("<br>")}</p>` : "",
    "</section>"
  ].filter(Boolean).join("\n");
}

function mapHtml(pages) {
  const rows = pages.map((p) => {
    const named = p.sections.filter((s) => s.id).length;
    return `<tr><td><a href="#${esc(p.url)}">${esc(p.url)}</a></td><td>${esc(p.type || "-")}</td>` +
      `<td>${esc(p.P.h1 || p.title)}</td><td>${p.sections.length}${named < p.sections.length ? " (" + named + " с меткой)" : ""}</td></tr>`;
  }).join("");
  return [
    '<section class="page" id="map" data-page="">',
    "<h1>Карта сборки</h1>",
    '<p id="miss" class="miss"></p>',
    "<table><thead><tr><th>Адрес</th><th>Тип</th><th>H1</th><th>Разделов</th></tr></thead>",
    `<tbody>${rows}</tbody></table>`,
    "</section>"
  ].join("\n");
}

const CSS = `*{box-sizing:border-box}
[hidden]{display:none!important}
body{margin:0;background:#fff;color:#111;font:16px/1.55 -apple-system,"Segoe UI",Roboto,Arial,sans-serif}
.wrap{max-width:900px;margin:0 auto;padding:0 16px 64px}
.top{border-bottom:2px solid #111;margin:0 0 20px;padding:14px 0}
.top b{display:block;font-size:15px}
.nav{margin:8px 0 0;padding:0;list-style:none;font-size:14px}
.nav li{display:inline-block;margin:0 14px 4px 0}
.nav a{color:#111}
.nav a.on{font-weight:700;text-decoration:none;border-bottom:2px solid #111}
h1{font-size:27px;line-height:1.25;margin:0 0 14px}
h2{font-size:21px;line-height:1.3;margin:0 0 10px}
h3{font-size:18px;margin:0 0 8px}
h4{font-size:16px;margin:0 0 8px}
p{margin:0 0 10px}
.crumb{color:#666;font-size:13px;margin:0 0 6px}
.tag{font:11px/1.4 ui-monospace,Consolas,monospace;color:#666;letter-spacing:.06em;text-transform:uppercase;margin:0 0 8px}
.blk{border:1px dashed #c9c9c9;padding:12px 14px;margin:0 0 14px}
.toc{background:#f4f4f4;padding:10px 14px;margin:0 0 18px}
.toc ul{margin:0;padding:0 0 0 18px}
.toc li{margin:0 0 5px}
.toc .q{display:block;color:#666;font-size:13px}
.btn{margin:12px 0}
.btn span{display:inline-block;border:2px solid #111;padding:9px 18px;font-weight:600}
ul,ol{margin:0 0 10px;padding-left:22px}
li{margin:0 0 4px}
table{border-collapse:collapse;width:100%;margin:0 0 12px;font-size:15px}
th,td{border:1px solid #c9c9c9;padding:6px 9px;text-align:left;vertical-align:top}
th{background:#f4f4f4}
blockquote{margin:0 0 10px;padding:0 0 0 14px;border-left:3px solid #c9c9c9;color:#333}
code{font:13px/1.4 ui-monospace,Consolas,monospace;background:#f4f4f4;padding:1px 4px}
.meta{border-top:1px solid #c9c9c9;color:#666;font-size:13px;padding-top:8px;margin-top:20px}
.miss{color:#111;font-weight:600}
@media (max-width:600px){h1{font-size:23px}.wrap{padding:0 12px 48px}}`;

const JS = `(function(){
var list=[].slice.call(document.querySelectorAll("section.page"));
var links=[].slice.call(document.querySelectorAll(".nav a"));
var map=document.getElementById("map");
var miss=document.getElementById("miss");
function go(){
  var raw=String(location.hash||"").replace(/^#/,"");
  var anchor="";var k=raw.indexOf("~");
  if(k>=0){anchor=raw.slice(k+1);raw=raw.slice(0,k);}
  var hit=null;
  for(var i=0;i<list.length;i++){if(list[i].getAttribute("data-page")===raw){hit=list[i];break;}}
  var show=hit||map;
  for(var j=0;j<list.length;j++){list[j].hidden=(list[j]!==show);}
  miss.textContent=(!hit&&raw)?("Адреса "+raw+" в этой сборке нет."):"";
  for(var m=0;m<links.length;m++){
    var on=links[m].getAttribute("href")===("#"+raw);
    if(on){links[m].className="on";}else{links[m].className="";}
  }
  var el=anchor?document.getElementById(anchor):null;
  if(el){el.scrollIntoView();}else{window.scrollTo(0,0);}
}
window.addEventListener("hashchange",go);
go();
})();`;

export function buildHtml(ctx) {
  const { pages, project } = ctx;
  const name = plain((project && project.business && project.business.name) || (ctx.plan && ctx.plan.slug) || "Прототип");
  const sections = pages.map((p, i) => pageHtml(p, i + 1, ctx));
  const nav = ['<li><a href="#">Карта</a></li>']
    .concat(pages.map((p) => `<li><a href="#${esc(p.url)}">${esc(p.title)}</a></li>`))
    .join("");
  return [
    "<!doctype html>",
    '<html lang="ru"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<meta name="robots" content="noindex">',
    `<title>${esc(name)} - прототип</title>`,
    `<style>${CSS}</style>`,
    "</head><body><div class=\"wrap\">",
    `<header class="top"><b>${esc(name)}</b><p class="tag">прототип wireframe | страниц ${pages.length} | собрано ${today()}</p>`,
    `<ul class="nav">${nav}</ul></header>`,
    mapHtml(pages),
    sections.join("\n"),
    "</div>",
    `<script>${JS}</script>`,
    "</body></html>",
    ""
  ].join("\n");
}

// ---------------------------------------------------------------- журнал исключений
// Снятое и слитое автором уезжает ТУДА ЖЕ, куда все остальные отступления конвейера, -
// в queue.json. Второго журнала в v8 нет, и verify-build ищет объяснение только там.
export function journalize(dir, pages, write) {
  const out = [];
  const q = isProjectDir(dir) ? readQueue(dir) : null;
  const had = new Set(arr(q && q.journal).map((e) => `${e.kind}|${e.subject}`));
  const push = (kind, subject, ground) => {
    const rec = { kind, subject: plain(subject), ground: plain(ground), known: false, written: false };
    if (had.has(`${kind}|${rec.subject}`)) { rec.known = true; rec.written = true; out.push(rec); return; }
    // Основания нет - записи нет. Строка «снят: docs» без причины не объясняет ничего, и
    // выдавать ее за объяснение хуже, чем показать дырку: ее увидит verify-build.
    if (rec.ground) {
      had.add(`${kind}|${rec.subject}`);
      if (write && q) { try { appendJournal(dir, kind, rec.subject, rec.ground); rec.written = true; } catch { rec.written = false; } }
    }
    out.push(rec);
  };
  for (const p of pages) {
    for (const [id, why] of p.P.dropped) push("dropped", `страница ${p.name}: блок ${id} снят`, why);
    const mm = [...p.P.merged];
    if (mm.length) {
      const written = new Set(p.sections.filter((s) => s.id).map((s) => s.id));
      for (const id of mm) {
        if (written.has(id)) continue;
        push("waiver", `страница ${p.name}: блок ${id} слит с соседним ответом`, "автор слил два ответа в один раздел");
      }
    }
  }
  return out;
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

function main() {
  const { flags, pos } = parseArgs(process.argv.slice(2));
  const root = flags.root && flags.root !== true ? resolve(String(flags.root)) : repoRoot();
  const dir = findDir(pos[0], root);
  if (!dir) die("проект не найден - укажи слаг или каталог проекта");

  const ctx = collect(dir, root);
  const html = buildHtml(ctx);
  const out = flags.out && flags.out !== true ? resolve(String(flags.out)) : join(dir, "site.html");
  const dry = Boolean(flags.dry || flags.json);
  const jour = journalize(dir, ctx.pages, !dry);

  // Блок плана, которого нет ни в верстке, ни в журнале. Сборка на этом не останавливается:
  // отказ по составу выносит verify-build, чтобы отказ был один и в одном месте.
  const gaps = [];
  for (const p of ctx.pages) {
    const written = new Set(p.sections.filter((s) => s.id).map((s) => s.id));
    for (const b of p.plan.filter((x) => x.ord)) {
      if (written.has(b.id) || p.P.dropped.has(b.id) || p.P.merged.has(b.id)) continue;
      gaps.push(`${p.name}: блок ${b.id} (место ${b.ord}) не собран и в журнале не объявлен`);
    }
  }

  // Вопросы заказчику одним списком: снятые блоки из plan.json и строки «недостает:» из
  // хвостов страниц. Без этой сборки вопрос, ради которого блок сняли, остается в консоли
  // шага 4, фактура не появляется никогда, и блок снят навсегда.
  if (flags.ask) {
    const out2 = [];
    for (const p of ctx.pages) {
      for (const b of p.plan.filter((x) => !x.ord && str(x.ask))) out2.push(`${p.url} | блок ${b.id} снят: ${str(b.ask)}`);
      for (const n of arr(p.P.needs)) out2.push(`${p.url} | автору не хватило: ${n}`);
      for (const [id, why] of p.P.dropped) out2.push(`${p.url} | автор снял ${id}: ${why}`);
    }
    console.log(`[ask] ${dir} | вопросов ${out2.length}`);
    for (const l of out2) console.log("  " + l);
    if (!out2.length) console.log("  открытых вопросов нет: фактуры хватило на весь состав");
    return 0;
  }

  if (flags.json) {
    console.log(JSON.stringify({
      v: 1, at: today(), dir, file: out, size: chars(html),
      pages: ctx.pages.map((p) => ({
        name: p.name, url: p.url, type: p.type, h1: p.P.h1,
        blocks: p.sections.filter((s) => s.id).map((s) => s.id),
        fallback: p.sections.filter((s) => s.fallback).map((s) => s.id),
        dropped: [...p.P.dropped.keys()], merged: [...p.P.merged]
      })),
      journal: jour, gaps, warnings: ctx.warnings
    }, null, 2));
    return 0;
  }

  if (!dry) writeFileSync(out, html, "utf8");
  console.log(`[assemble] ${dir}`);
  console.log(`  страниц ${ctx.pages.length} | разделов ${ctx.pages.reduce((n, p) => n + p.sections.length, 0)} | ${chars(html)} знаков`);
  for (const p of ctx.pages) {
    const fb = p.sections.filter((s) => s.fallback).length;
    console.log(`  ${p.url.padEnd(30)} ${String(p.type || "-").padEnd(8)} разделов ${String(p.sections.length).padStart(2)}${fb ? `, по порядку ${fb}` : ""}${p.P.dropped.size ? `, снято ${p.P.dropped.size}` : ""}`);
  }
  const fresh = jour.filter((e) => !e.known);
  if (fresh.length) {
    console.log(`  журнал исключений: записей ${fresh.length}`);
    for (const e of fresh) console.log(`    ${e.kind} ${e.subject}${e.ground ? " - " + e.ground : " - ОСНОВАНИЯ НЕТ, запись не принята"}`);
  }
  for (const g of gaps) console.log(`  ВНИМАНИЕ: ${g}`);
  for (const w of ctx.warnings) console.log(`  ВНИМАНИЕ: ${w}`);
  if (!dry) {
    console.log(`  записано: ${out}`);
    console.log(`  дальше: node .claude/scripts/site/verify-build.mjs ${dir}`);
  }
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) process.exit(main());
