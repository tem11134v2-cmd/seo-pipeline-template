#!/usr/bin/env node
// recon.mjs
// Замер лидеров: что снять и как разобрать снятое. Скрипт САМ В СЕТЬ НЕ ХОДИТ и
// process.env не читает - он печатает задание и разбирает то, что агент положил на диск
// в leaders_raw/. Сеть живет только в MCP-инструментах агента: arsenkin_top и check_top
// за выдачу, seo_fetch_batch за страницы.
//
// Глубина замера зависит от типа сайта, а не от щедрости оператора:
//   landing   - блоки лендингов однородны, скелет берется из pages.yml, замер только
//               подтверждает: 3 страницы, один кластер;
//   multipage - по каждому типу страниц свой кластер и свои 8 адресов.
// tier basic - платные инструменты не вызываются вовсе: лидеры берутся из
// competitors.list контракта, выдача не запрашивается.
//
// Использование:
//   node recon.mjs plan  [<слаг|каталог>] [--refresh] [--json]
//   node recon.mjs parse [<слаг|каталог>] [--cluster <id>] [--refresh]
//
// Кэш по маркеру и региону лежит в .claude/tmp/site-leaders, живет 14 дней и разделяется
// между проектами. Замер, уже записанный в проект, заморожен: parse его не перезапишет
// без --refresh, иначе план страницы переставал бы быть воспроизводимым.
//
// Exit: 0 сделано | 2 отказ (нет проекта, нет контракта, выдуманный id блока от агента).

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { today, readPages, arr, str } from "./_contract.mjs";
import { repoRoot, findDir, readQueue, plain } from "./queue.mjs";
import { loadRaw, readPage, dropBoilerplate, markAlive, pageBlocks, pageNumbers, coverage } from "./map-blocks.mjs";

const die = (msg) => { console.error("[recon] " + msg); process.exit(2); };

// Кластер - это ТИП СТРАНИЦЫ: рынок ставит разные блоки на главной, на услуге и в
// каталоге, и мерить их одной кучей значит не мерить ничего.
export const CLUSTERS = ["landing", "home", "service", "category", "product"];
// В этом срезе собран путь письма для landing, service, home и info. Каталог и товары
// контракт и pages.yml обслуживают, но их замер и письмо - следующий срез, и заглушки
// вместо них не ставятся.
export const CLUSTERS_NOW = ["landing", "home", "service"];
// info не меряется никогда: у инфо-страницы нет рыночного скелета, ее состав выводится
// правилом pages.yml из закрытых NEEDS.
export const CLUSTERS_NEVER = ["info", "facet"];

// Блоки каталога на коммерческой странице не засчитываются, и наоборот. Кластер - это и
// есть тип страницы: cat_intro, найденный на странице услуги, это примета верстки, а не
// блок рынка, и в покрытии он врет.
export const CATALOG_ONLY = ["cat_intro", "listing", "subcats", "cat_text", "gallery", "specs", "product_desc", "related"];
export const CATALOG_CLUSTERS = ["category", "facet", "product"];

export const ALIVE_MIN = 3;
export const TTL_DAYS = 14;
export const TAINTED_MAX = 300;

// Агрегаторы, справочники и маркетплейсы: у них своя механика страницы, и мерить по ним
// состав коммерческой страницы значит списать чужую задачу.
export const SKIP_DOMAINS = [
  "avito.ru", "yandex.ru", "ya.ru", "2gis.ru", "youla.ru", "profi.ru", "yclients.com",
  "tiu.ru", "ozon.ru", "wildberries.ru", "dzen.ru", "vk.com", "ok.ru", "t.me",
  "blizko.ru", "zoon.ru", "flamp.ru", "otzovik.com", "irecommend.ru", "hh.ru",
  "wikipedia.org", "pulscen.ru", "satom.ru", "uslugio.com", "youdo.com"
];

const cacheDir = (root) => join(root, ".claude/tmp/site-leaders");
const keyOf = (cluster, markers, region) =>
  createHash("sha1").update([cluster, arr(markers).join(","), region].join("|").toLowerCase()).digest("hex").slice(0, 16);

const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

export function readCache(root, key) {
  const f = join(cacheDir(root), key + ".json");
  if (!existsSync(f)) return null;
  try {
    const c = JSON.parse(readFileSync(f, "utf8"));
    const age = daysBetween(String(c.at || "1970-01-01"), today());
    if (!Number.isFinite(age) || age > TTL_DAYS || age < 0) return null;
    return { ...c, age };
  } catch { return null; }
}

export function writeCache(root, key, data) {
  mkdirSync(cacheDir(root), { recursive: true });
  writeFileSync(join(cacheDir(root), key + ".json"), JSON.stringify(data, null, 2) + "\n", "utf8");
}

// ---------------------------------------------------------------- план замера
// Маркер кластера - то, что вбивают в поиск. Для услуг это маркеры направлений, для
// главной - маркер первого направления с регионом, для лендинга - он же.
export function clustersOf(project, pages) {
  const b = project.business || {};
  const dirs = arr(b.directions).filter((d) => !str(d.parent));
  const markers = dirs.map((d) => str(d.marker) || str(d.name)).filter(Boolean);
  const main = markers[0] || str(b.what).slice(0, 60);
  const region = str(b.region);
  const withRegion = (m) => (region && !m.toLowerCase().includes(region.toLowerCase()) ? `${m} ${region}` : m);

  if (b.site_kind === "landing") {
    return { clusters: [{ id: "landing", markers: [withRegion(main)].filter(Boolean), want: 3, take: "found" }], later: [] };
  }
  const byType = new Map();
  for (const p of arr(pages)) byType.set(str(p.type), (byType.get(str(p.type)) || 0) + 1);
  // Мерим только те типы, которые на сайте есть. Список страниц уже посчитан, и кластер
  // услуг на магазине - это оплаченный замер того, чего мы писать не будем.
  const need = (t) => (byType.size ? byType.has(t) : t === "home" || t === "service");

  // take root: у кластера home снимается КОРЕНЬ домена лидера, а не найденная страница.
  // Главная мерится на главных, иначе в замер главной уезжает состав страницы услуги.
  const clusters = [];
  if (need("home")) clusters.push({ id: "home", markers: [withRegion(main)].filter(Boolean), want: 8, take: "root" });
  if (need("service") && markers.length) clusters.push({ id: "service", markers: markers.slice(0, 3).map(withRegion), want: 8, take: "found" });
  const later = [...byType.entries()]
    .filter(([t]) => t && !CLUSTERS_NOW.includes(t) && !CLUSTERS_NEVER.includes(t))
    .map(([id, n]) => ({ id, pages: n }))
    .sort((a, b2) => a.id.localeCompare(b2.id));
  return { clusters, later };
}

function loadProject(dir) {
  const f = join(dir, "project.json");
  if (!existsSync(f)) die(`нет ${f} - замер опирается на контракт, а не на догадку`);
  return JSON.parse(readFileSync(f, "utf8"));
}

function loadPages(dir) {
  const f = join(dir, "pages.json");
  if (!existsSync(f)) return [];
  try { return arr(JSON.parse(readFileSync(f, "utf8")).pages); } catch { return []; }
}

function cmdPlan(pos, flags, root) {
  const dir = findDir(pos[0], root);
  if (!dir) die("проект не найден - сначала queue.mjs init <slug>");
  const project = loadProject(dir);
  const q = existsSync(join(dir, "queue.json")) ? readQueue(dir) : {};
  const tier = str(q.tier) || str(project.tier) || "basic";
  const region = str((project.business || {}).region);
  const kind = str((project.business || {}).site_kind) || "multipage";
  const { clusters, later } = clustersOf(project, loadPages(dir));

  mkdirSync(join(dir, "leaders"), { recursive: true });
  const out = [];
  for (const c of clusters) {
    const key = keyOf(c.id, c.markers, region);
    const frozen = existsSync(join(dir, "leaders", c.id + ".json"));
    const cached = flags.refresh ? null : readCache(root, key);
    let source = tier === "seo" ? "serp" : "competitors";
    let done = false;
    if (frozen && !flags.refresh) { done = true; source = "проект"; }
    else if (cached) {
      writeFileSync(join(dir, "leaders", c.id + ".json"), JSON.stringify(cached.data, null, 2) + "\n", "utf8");
      done = true; source = `кэш ${cached.age} дней`;
    }
    out.push({ id: c.id, markers: c.markers, want: c.want, take: c.take, alive_need: ALIVE_MIN, key, source, done, raw: `leaders_raw/${c.id}` });
  }

  const plan = {
    v: 1, slug: str(project.slug), at: today(), region, tier, site_kind: kind,
    clusters: out, later
  };
  writeFileSync(join(dir, "leaders", "plan.json"), JSON.stringify(plan, null, 2) + "\n", "utf8");

  if (flags.json) { console.log(JSON.stringify(plan, null, 2)); return 0; }
  console.log(`[recon] ${dir}`);
  console.log(`  тип сайта ${kind} | tier ${tier} | регион ${region || "-"}`);
  if (kind === "landing") console.log("  лендинг: блоки однородны, скелет из pages.yml, замер только подтверждает");
  for (const c of out) {
    console.log(`  кластер ${c.id}: маркеры ${c.markers.join(" | ") || "-"} | адресов снять: ${c.want}, живых от ${ALIVE_MIN}`);
    if (c.done) { console.log(`     снимать не надо, замер взят из источника: ${c.source}`); continue; }
    if (tier === "seo") {
      console.log(`     1. выдача: arsenkin_top либо check_top по маркерам, регион ${region || "не задан"}, топ-10`);
      console.log(`        выкинуть агрегаторы: ${SKIP_DOMAINS.slice(0, 8).join(", ")} и прочие из SKIP_DOMAINS`);
      console.log(`        сохранить leaders_raw/${c.id}/serp.json вида {"results":[{"url":"...","pos":1}]}`);
    } else {
      console.log("     1. tier basic: платные инструменты не вызываются вовсе, адреса берутся из competitors.list");
    }
    if (c.take === "root") console.log("        адреса для снятия - КОРНИ доменов лидеров: главная мерится на главных");
    console.log(`     2. страницы: seo_fetch_batch на выбранные адреса -> leaders_raw/${c.id}/pages.json вида [{"url":"...","pos":1,"html":"..."}]`);
    console.log(`     3. приметы: node .claude/scripts/site/map-blocks.mjs ${join(dir, "leaders_raw", c.id)} --json --out ${join(dir, "leaders_raw", c.id, "sections.json")}`);
    console.log(`     4. имена: агент leader-mapper читает sections.json и пишет leaders_raw/${c.id}/map.json`);
    console.log(`     5. разбор: node .claude/scripts/site/recon.mjs parse ${dir} --cluster ${c.id}${existsSync(join(dir, "leaders", c.id + ".json")) ? " --refresh" : ""}`);
  }
  if (later.length) {
    console.log(`  за границей среза: ${later.map((l) => `${l.id} (${l.pages} стр.)`).join(", ")} - каталог и товары меряет и пишет следующий срез`);
  }
  console.log(`  план записан: ${join(dir, "leaders", "plan.json")}`);
  return 0;
}

// ---------------------------------------------------------------- разбор снятого
function readJsonMaybe(f) {
  if (!existsSync(f)) return null;
  try { return JSON.parse(readFileSync(f, "utf8")); } catch { return null; }
}

// map.json агента: {"pages":[{"url":"...","blocks":[{"at":2,"id":"price"}]}]}.
// Возвращаем имена по адресу и разделу плюс два списка: чужое (other:) и выдуманное.
export function readMap(mapJson, known) {
  const named = new Map(), extra = new Map(), invented = [];
  for (const p of arr(mapJson && mapJson.pages)) {
    const url = str(p.url);
    const byAt = named.get(url) || {};
    for (const b of arr(p.blocks)) {
      const id = str(b.id);
      const at = Number(b.at);
      if (!id) continue;
      if (id.startsWith("other:")) {
        const name = plain(id.slice(6));
        if (name) extra.set(name, (extra.get(name) || 0) + 1);
        continue;
      }
      if (!known.has(id)) { invented.push(`${url} [${Number.isFinite(at) ? at : "?"}] ${id}`); continue; }
      if (!Number.isFinite(at)) continue;
      byAt[at] = (byAt[at] || []).concat(id);
    }
    named.set(url, byAt);
  }
  return { named, extra, invented };
}

export function parseCluster(dir, cluster, known) {
  const rawDir = join(dir, "leaders_raw", cluster);
  if (!existsSync(rawDir)) return { skip: `нет ${rawDir}` };
  const raw = loadRaw(rawDir);
  const serp = readJsonMaybe(join(rawDir, "serp.json"));
  const mapJson = readJsonMaybe(join(rawDir, "map.json"));
  const { named, extra, invented } = readMap(mapJson, known);
  if (invented.length) return { invented };

  const posByUrl = new Map();
  for (const r of arr(serp && (serp.results || serp.items || serp.pages))) {
    const u = str(r.url || r.link);
    if (u) posByUrl.set(u, Number(r.pos || r.position || 0) || 0);
  }
  const attempted = posByUrl.size || raw.length;

  const pages = dropBoilerplate(
    raw.map((r, i) => readPage(r.html, { url: r.url, pos: posByUrl.get(r.url) || r.pos || i + 1 }))
  ).map(markAlive);

  const catalog = CATALOG_CLUSTERS.includes(cluster);
  const fits = (id) => (catalog ? true : !CATALOG_ONLY.includes(id));
  const alive = pages
    .filter((p) => p.alive)
    .map((p) => ({
      url: p.url, pos: p.pos, chars: p.chars,
      blocks: pageBlocks(p, named.get(p.url) || {}).filter((b) => fits(b.id)),
      numbers: pageNumbers(p)
    }))
    .sort((a, b) => (a.pos || 99) - (b.pos || 99) || a.url.localeCompare(b.url));

  const measured = alive.length >= ALIVE_MIN;
  const cv = measured ? coverage(alive) : { cov: {}, cov_evidence: {}, order: [], form: {}, blocks_median: 0, chars_median: 0 };
  const tainted = [...new Set(alive.flatMap((p) => p.numbers))].sort().slice(0, TAINTED_MAX);

  return {
    data: {
      v: 1, cluster, at: today(),
      attempted, alive: alive.length, measured,
      cov: cv.cov, cov_evidence: cv.cov_evidence,
      blocks_median: cv.blocks_median, chars_median: cv.chars_median,
      order: cv.order, form: cv.form,
      extra: [...extra.entries()].map(([name, pages2]) => ({ name, pages: pages2 })).sort((a, b) => b.pages - a.pages || a.name.localeCompare(b.name)),
      tainted,
      pages: alive.map((p) => ({ url: p.url, pos: p.pos, chars: p.chars, blocks: p.blocks.map((b) => b.id) }))
    }
  };
}

function cmdParse(pos, flags, root) {
  const dir = findDir(pos[0], root);
  if (!dir) die("проект не найден");
  const project = loadProject(dir);
  const pages = readPages(join(root, ".claude/skills/site-proto/pages.yml"));
  if (!pages) die("нет pages.yml - именам блоков неоткуда взяться");
  const known = new Set(pages.blocks.keys());
  const region = str((project.business || {}).region);

  const plan = readJsonMaybe(join(dir, "leaders", "plan.json"));
  let list = arr(plan && plan.clusters).map((c) => c.id);
  if (!list.length) {
    const rawRoot = join(dir, "leaders_raw");
    list = existsSync(rawRoot) ? readdirSync(rawRoot).filter((n) => statSync(join(rawRoot, n)).isDirectory()).sort() : [];
  }
  if (flags.cluster && flags.cluster !== true) list = [String(flags.cluster)];
  if (!list.length) die("нечего разбирать: ни плана, ни leaders_raw");

  mkdirSync(join(dir, "leaders"), { recursive: true });
  let wrote = 0;
  for (const id of list) {
    const target = join(dir, "leaders", id + ".json");
    if (existsSync(target) && !flags.refresh) { console.log(`[recon] ${id}: замер заморожен в проекте, пропуск (--refresh перепишет)`); continue; }
    const r = parseCluster(dir, id, known);
    if (r.skip) { console.log(`[recon] ${id}: ${r.skip}`); continue; }
    if (r.invented) {
      console.error(`[recon] ${id}: агент назвал блоки, которых нет в pages.yml:`);
      for (const line of r.invented) console.error("   " + line);
      console.error("   допустимо только имя из pages.yml либо other:<строка>");
      process.exit(2);
    }
    writeFileSync(target, JSON.stringify(r.data, null, 2) + "\n", "utf8");
    wrote++;
    const c = arr(plan && plan.clusters).find((x) => x.id === id);
    writeCache(root, c ? c.key : keyOf(id, [], region), { at: today(), cluster: id, region, markers: c ? c.markers : [], data: r.data });
    const d = r.data;
    console.log(`[recon] ${id}: померено на ${d.alive} из ${d.attempted} страниц${d.measured ? "" : " - живых меньше " + ALIVE_MIN + ", measured false, правила R1 и R2 не применяются"}`);
    console.log(`   блоков медиана ${d.blocks_median}, знаков медиана ${d.chars_median}, чужих чисел ${d.tainted.length}`);
    const top = Object.entries(d.cov).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k} ${v}`);
    if (top.length) console.log(`   покрытие: ${top.join(", ")}`);
    if (d.extra.length) console.log(`   чужое, чего нет в pages.yml: ${d.extra.map((e) => `${e.name} x${e.pages}`).join(", ")}`);
  }
  console.log(`[recon] записано кластеров: ${wrote}`);
  return 0;
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
  const cmd = (pos.shift() || "plan").toLowerCase();
  const root = flags.root && flags.root !== true ? resolve(String(flags.root)) : repoRoot();
  switch (cmd) {
    case "plan": return cmdPlan(pos, flags, root);
    case "parse": return cmdParse(pos, flags, root);
    default: die(`команда «${cmd}» неизвестна: plan, parse`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) main();
