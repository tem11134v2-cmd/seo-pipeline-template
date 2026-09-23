#!/usr/bin/env node
// validate-project-input.mjs
// Вход /seo-struktura (шаг 1a): контракт анализа sites/NNN-<slug>/project.json плюс тир-гейт.
// Заменяет validate-analysis-inputs.mjs: вход analyses/NNN v7 ушел вместе с /seo-analiz,
// режима доделки старых структур на analyses/ нет.
//
// Использование:
//   node .claude/scripts/validate-project-input.mjs <NNN|slug|sites/NNN-slug> [--root <dir>]
//                                                   [--schema <file>] [--out <inputs.json>]
//
// Порядок проверок (первое блокирующее - выход, до создания structures/ и до первого MCP):
//   1. Каталог проекта sites/NNN-<slug>/ найден.
//   2. Тир-гейт. Источник - queue.json.tier (ответ оператора, `queue.mjs init <slug> --tier`):
//      seo - проход; project.json.tier=basic при queue seo - проход с предупреждением «tier в
//      контракте отстал» (tier_lagging: true); queue basic - exit 2; в queue.json tier нет - exit 2
//      (лазейки «анализ без tier идет как legacy» здесь нет). Флага обхода нет намеренно.
//   3. project.json есть, разбирается и проходит project.schema.json (тот же обход схемы, что у
//      verify-data.mjs и build-project.mjs - один модуль _contract.mjs).
//   4. business.region и business.type непусты; business.assortment или business.directions
//      непусты; id направлений уникальны.
// Что вычисляет: keyso_base по региону (20 баз Keyso, вне таблицы - msk с пометкой),
//   region_yandex (зашитый список городов; федеральный или неизвестный регион - 213 с пометкой,
//   225/0 не ставятся никогда), domain из business.site (хост, IDN в кириллице).
// Предупреждения (не блок): tier отстал; гейт анализа не согласован (project_gate: false);
//   site_kind=landing; слаг каталога и project.slug расходятся.
//
// Выход:
//   stdout - JSON для <structure_dir>/inputs.json (только при exit 0);
//   --out <file> - тот же JSON записать в файл (папки создаются), stdout тогда пуст;
//   stderr - отчет: предупреждения и справка, при exit 2 - список проблем с подсказкой.
// Exit: 0 проход (в том числе с предупреждениями) | 2 вход не годится или SEO не куплено |
//       1 ошибка запуска (нет аргумента, битый JSON, нет схемы).

import { readFileSync, writeFileSync, existsSync, statSync, readdirSync, mkdirSync } from "node:fs";
import { join, resolve, dirname, basename, relative, isAbsolute } from "node:path";
import { fileURLToPath, domainToUnicode } from "node:url";
import { validate, arr, str, B } from "./site/_contract.mjs";
import { repoRoot } from "./site/queue.mjs";

const TAG = "[validate-project-input]";
const HERE = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------- аргументы
const argv = process.argv.slice(2);
let target = null, rootArg = null, schemaArg = null, outArg = null;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--root") rootArg = argv[++i] || null;
  else if (a === "--schema") schemaArg = argv[++i] || null;
  else if (a === "--out") outArg = argv[++i] || null;
  else if (!a.startsWith("--") && !target) target = a;
}
if (!target) {
  console.error(`${TAG} usage: node validate-project-input.mjs <NNN|slug|sites/NNN-slug> [--root <dir>] [--schema <file>] [--out <inputs.json>]`);
  process.exit(1);
}
const root = rootArg ? resolve(rootArg) : repoRoot();
const schemaPath = schemaArg ? resolve(schemaArg) : resolve(HERE, "..", "skills", "site-analiz", "project.schema.json");

const problems = [], warnings = [], infos = [];
const block = (msg) => { problems.push(msg); };
const toPosix = (p) => String(p).replace(/\\/g, "/");
// Пути в inputs.json - от корня проекта, как раньше analysis_dir: скрипты структуры
// запускаются из корня и резолвят их от cwd.
const rel = (p) => {
  const r = toPosix(relative(root, p));
  return !r || r.startsWith("..") || isAbsolute(r) ? toPosix(p) : r;
};

function stop(code, lines) {
  for (const l of lines) console.error(l);
  process.exit(code);
}

function readJson(p, what) {
  try { return JSON.parse(readFileSync(p, "utf8").replace(/^﻿/, "")); }
  catch (e) { stop(1, [`${TAG} ${what} не разобран (${toPosix(p)}): ${e.message}`]); }
}

// ---------------------------------------------------------------- 1. каталог проекта
const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };
const looksProject = (p) => isDir(p) && (existsSync(join(p, "project.json")) || existsSync(join(p, "queue.json")));

function resolveSiteDir(arg) {
  const direct = resolve(arg);
  if (looksProject(direct)) return { dir: direct };
  if (/project\.json$/i.test(arg) && existsSync(direct)) return { dir: dirname(direct) };
  const sites = join(root, "sites");
  if (!isDir(sites)) return { dir: null };
  const names = readdirSync(sites).filter((n) => looksProject(join(sites, n))).sort();
  const want = toPosix(arg).replace(/\/+$/, "").replace(/^sites\//, "");
  let hits;
  if (/^\d{1,3}$/.test(want)) {
    const nnn = want.padStart(3, "0");
    hits = names.filter((n) => n.startsWith(`${nnn}-`));
  } else {
    hits = names.filter((n) => n === want || n.replace(/^\d+-/, "") === want);
  }
  if (hits.length > 1) return { dir: null, ambiguous: hits };
  return { dir: hits.length ? join(sites, hits[0]) : null };
}

const found = resolveSiteDir(target);
if (found.ambiguous) {
  stop(2, [
    `${TAG} НЕ ПРОЙДЕНО: «${target}» подходит к нескольким проектам: ${found.ambiguous.map((n) => `sites/${n}`).join(", ")}`,
    "Укажите каталог целиком: /seo-struktura sites/NNN-<slug>",
  ]);
}
if (!found.dir) {
  stop(2, [
    `${TAG} НЕ ПРОЙДЕНО: проект «${target}» не найден в ${toPosix(join(root, "sites"))}/`,
    "Структура строится только на контракте анализа v8: сначала /site-analiz (sites/NNN-<slug>/project.json).",
    "Старые анализы analyses/NNN структура больше не читает.",
  ]);
}
const siteDir = found.dir;
const dirName = basename(siteDir);
const dirMatch = dirName.match(/^(\d{3})-(.+)$/);
if (!dirMatch) {
  stop(2, [`${TAG} НЕ ПРОЙДЕНО: каталог ${rel(siteDir)} не в раскладке sites/NNN-<slug> (нет трехзначного номера)`]);
}
const nnn = dirMatch[1];

// ---------------------------------------------------------------- 2. тир-гейт
const queuePath = join(siteDir, "queue.json");
const queue = existsSync(queuePath) ? readJson(queuePath, "queue.json") : null;
const projectPath = join(siteDir, "project.json");
const project = existsSync(projectPath) ? readJson(projectPath, "project.json") : null;

const TIERS = ["basic", "seo"];
const qTier = queue && TIERS.includes(str(queue.tier)) ? str(queue.tier) : "";
const pTier = project && TIERS.includes(str(project.tier)) ? str(project.tier) : "";
const slugHint = str(queue && queue.slug) || str(project && project.slug) || dirMatch[2];
const buyHint = `Докупили - \`node .claude/scripts/site/queue.mjs init ${slugHint} --tier seo\` и повторить.`;

if (qTier === "basic") {
  stop(2, [
    `${TAG} НЕ ПРОЙДЕНО: Проект ${nnn}: SEO не куплено (tier=basic), структура не строится.`,
    `Без SEO состав страниц пишет планировщик анализа. ${buyHint}`,
  ]);
}
if (!qTier) {
  const where = pTier
    ? `в queue.json ответа оператора о тарифе нет, в project.json стоит tier=${pTier}`
    : "tier нет ни в queue.json, ни в project.json";
  stop(2, [
    `${TAG} НЕ ПРОЙДЕНО: Проект ${nnn}: ${where}. Тир-гейт читает только ответ оператора (queue.json).`,
    `Если SEO куплено - \`node .claude/scripts/site/queue.mjs init ${slugHint} --tier seo\` и повторить.`,
  ]);
}
// qTier === "seo"
const tierLagging = pTier !== "seo";
if (tierLagging) {
  warnings.push(`tier в контракте отстал: queue.json tier=seo, project.json tier=${pTier || "нет"}. ` +
    "Контракт после гейта не пересобирается; структура идет по ответу оператора, пометка уйдет в A6.md.");
}

// ---------------------------------------------------------------- 3. project.json и схема
if (!project) {
  stop(2, [
    `${TAG} НЕ ПРОЙДЕНО: нет ${rel(projectPath)} - контракт анализа не собран.`,
    `Дособерите анализ: /site-analiz ${slugHint} (шаг 3, build-project.mjs), затем повторите.`,
  ]);
}
if (!existsSync(schemaPath)) stop(1, [`${TAG} нет схемы анализа: ${toPosix(schemaPath)}`]);
const schema = readJson(schemaPath, "схема");
validate(project, schema, "", schema, (p, m) => block(`схема ${p || "(корень)"}: ${m}`));

// ---------------------------------------------------------------- 4. поля, без которых структуре не на чем строить
const business = project.business && typeof project.business === "object" ? project.business : {};
const region = str(business.region);
const type = str(business.type);
if (!region) block("business.region пуст: без региона нет ни базы Keyso, ни кода Яндекса");
if (!type) block("business.type пуст: без него не выбрать 2 или 3 уровня меню");
const assortment = arr(business.assortment).map(str).filter(Boolean);
const directions = arr(business.directions).filter((d) => d && typeof d === "object");
if (!assortment.length && !directions.length) {
  block("business.assortment и business.directions оба пусты: структуре не из чего добирать страницы и маркеры");
}
{
  const seen = new Set(), dup = new Set();
  for (const d of directions) {
    const id = str(d.id);
    if (!id) continue;
    if (seen.has(id)) dup.add(id);
    seen.add(id);
  }
  if (dup.size) block(`business.directions: id не уникальны: ${[...dup].join(", ")}`);
}

if (problems.length) {
  const lines = [`${TAG} НЕ ПРОЙДЕНО: ${rel(projectPath)}`, "Проблемы входа:"];
  for (const p of problems.slice(0, 40)) lines.push(`  - ${p}`);
  if (problems.length > 40) lines.push(`  ... и еще ${problems.length - 40}`);
  lines.push("");
  lines.push(`Контракт чинится в анализе: /site-analiz ${slugHint} (build-project.mjs, затем verify-data.mjs), не руками в структуре.`);
  stop(2, lines);
}

// ---------------------------------------------------------------- регион: база Keyso и код Яндекса
// Таблица 20 баз Keyso перенесена из brief-structurer.md (v7); коды Яндекса - зашитый список
// /seo-struktura (MCP_MAP.md). Поиск по основе слова с границей-классом: \b в JS кириллицу не видит.
const CITIES = [
  // [база Keyso, код Яндекса, имя, основа]
  ["msk", 213, "Москва", "москв|подмосков"],
  ["spb", 2, "Санкт-Петербург", "санкт|петербург|спб|питер|ленинградск|ленобл"],
  ["ekb", 54, "Екатеринбург", "екатеринбург|екб|свердловск"],
  ["nsk", 65, "Новосибирск", "новосибирск"],
  ["kzn", 43, "Казань", "казан"],
  ["nnv", 47, "Нижний Новгород", "нижн[а-я]*\\s+новгород|нижегородск|н\\.\\s*новгород"],
  ["che", 56, "Челябинск", "челябинск"],
  ["sam", 51, "Самара", "самар"],
  ["rnd", 39, "Ростов-на-Дону", "ростов"],
  ["tom", 67, "Томск", "томск"],
  ["krr", 35, "Краснодар", "краснодар|кубан"],
  ["vrn", 193, "Воронеж", "воронеж"],
  ["vlg", 38, "Волгоград", "волгоград"],
  ["ufa", 172, "Уфа", "уф(?:а|е|у|ой|ы)(?![а-я])|башкир|башкорт"],
  ["prm", 50, "Пермь", "перм"],
  ["kry", 62, "Красноярск", "красноярск"],
  ["oms", 66, "Омск", "омск"],
  ["sar", 194, "Саратов", "саратов"],
  ["tmn", 55, "Тюмень", "тюмен"],
  ["mns", 157, "Минск", "минск"],
  // код Яндекса есть, базы Keyso нет
  [null, 15, "Тула", "тул(?:а|е|у|ой|ы|ьск)(?![а-я])"],
];
const FEDERAL = new RegExp(B + "(росси|рф(?![а-я])|вся страна|по всей|снг|федеральн)");
const regionLow = region.toLowerCase().replace(/ё/g, "е");

// Первый по положению в строке город: «Москва и Санкт-Петербург» -> Москва.
let city = null, cityAt = Infinity;
for (const row of CITIES) {
  const m = new RegExp(B + "(" + row[3] + ")").exec(regionLow);
  if (m && m.index < cityAt) { city = row; cityAt = m.index; }
}
const federal = !city && FEDERAL.test(regionLow);

let keysoBase = "msk", cityNotInKeyso = false, noteKeyso = "";
if (city && city[0]) keysoBase = city[0];
else {
  cityNotInKeyso = true;
  noteKeyso = federal
    ? `Регион федеральный («${region}»): отдельной базы Keyso нет, используется msk (Москва).`
    : `Регион «${region}» не в базах Keyso, используется msk (Москва); реальный регион учитывается через выдачу Яндекса.`;
}

let regionYandex = 213, noteRegion = "";
if (city) regionYandex = city[1];
else if (federal) noteRegion = `Регион федеральный («${region}»); 225/0 ломают источник Sug в JM, взят 213 для оценки рынка.`;
else noteRegion = `Регион «${region}» вне зашитого списка городов Яндекса; взят 213 (Москва) для оценки рынка.`;

// ---------------------------------------------------------------- домен из business.site
// Хост без схемы, www, пути и порта; Punycode -> кириллица (Keyso ищет IDN в кириллице).
// Ссылка на площадку (соцсеть, маркетплейс, агрегатор) - не сайт клиента: domain = null.
const PLATFORMS = /^(?:[a-z0-9-]+\.)*(vk\.com|vk\.ru|vkontakte\.ru|instagram\.com|facebook\.com|fb\.com|ok\.ru|t\.me|telegram\.me|wa\.me|youtube\.com|dzen\.ru|taplink\.cc|avito\.ru|ozon\.ru|wildberries\.ru|2gis\.ru|yandex\.ru|profi\.ru|zoon\.ru)$/;
let domain = null, noteDomain = "";
{
  const raw = str(business.site);
  if (raw) {
    let host = raw.toLowerCase().replace(/^[a-z][a-z0-9+.-]*:\/\//, "").replace(/^\/\//, "");
    host = host.split(/[/?#\s]/)[0].replace(/:\d+$/, "").replace(/\.$/, "").replace(/^www\./, "");
    if (host.includes("xn--")) {
      const uni = domainToUnicode(host);
      if (uni) host = uni;
    }
    if (!/^[^\s.]+(\.[^\s.]+)+$/.test(host)) {
      noteDomain = `business.site «${raw}» не похож на адрес сайта - домен не задан`;
    } else if (PLATFORMS.test(host)) {
      noteDomain = `business.site «${raw}» указывает на площадку ${host}, а не на сайт клиента - домен не задан`;
    } else domain = host;
  }
}
if (noteDomain) warnings.push(noteDomain);

// ---------------------------------------------------------------- гейт анализа и прочие предупреждения
const projectGate = !!(queue && queue.gate && queue.gate.approved === true);
if (!projectGate) {
  warnings.push("контракт анализа не согласован с заказчиком (queue.json gate.approved не true): " +
    "структура строится, но project.json еще может поменяться; пометка project_gate: false уйдет в A6.md.");
}
const slug = str(project.slug);
if (slug && slug !== dirMatch[2]) {
  warnings.push(`слаг каталога «${dirMatch[2]}» и project.slug «${slug}» расходятся - папка структуры берет project.slug`);
}
const siteKind = str(business.site_kind);
if (siteKind === "landing") {
  warnings.push("business.site_kind=landing: заказчик выбрал одностраничник, а структура строит многостраничный сайт - сверьте с заказчиком");
}

const withMarker = directions.filter((d) => str(d.marker)).length;
if (directions.length && !withMarker) {
  infos.push("ни у одного направления нет marker: маркер главной и SERP-запросы seo-base сгенерирует из имен направлений");
}
const compList = arr(project.competitors && project.competitors.list).map(str).filter(Boolean);
const compDomains = compList.filter((s) => /^(?:https?:\/\/)?(?:www\.)?[^\s/]+\.[^\s/]+/i.test(s));
infos.push(`конкуренты анализа: ${compDomains.length} доменов из ${compList.length} строк` +
  (compDomains.length < 6 ? " - seo-base доберет через domain_competitors" : ""));

// ---------------------------------------------------------------- вывод
const structureDir = `structures/${nnn}-${slug}/`;
const out = {
  project_path: rel(projectPath),
  site_dir: rel(siteDir) + "/",
  nnn,
  slug,
  structure_dir: structureDir,
  domain,
  keyso_base: keysoBase,
  city_not_in_keyso: cityNotInKeyso,
  note_keyso: noteKeyso,
  region_yandex: regionYandex,
  region_name: region,
  note_region: noteRegion,
  business_type: type,
  site_kind: siteKind || null,
  tier: "seo",
  tier_lagging: tierLagging,
  project_gate: projectGate,
  competitors_source: `${structureDir}competitors.json`,
  serp_source: `${structureDir}serp.json`,
  stop_list_source: `${structureDir}stop_list.md`,
};

const report = [`${TAG} OK: ${rel(projectPath)} - контракт анализа цел, SEO куплено (queue.json tier=seo)`];
for (const w of warnings) report.push(`  ! ${w}`);
report.push(`  i keyso_base=${keysoBase}${cityNotInKeyso ? " (вне баз Keyso)" : ""}, region_yandex=${regionYandex} (${region})`);
if (noteRegion) report.push(`  i ${noteRegion}`);
report.push(`  i domain=${domain || "нет"}; structure_dir=${structureDir}`);
for (const i of infos) report.push(`  i ${i}`);
for (const l of report) console.error(l);

const json = JSON.stringify(out, null, 2) + "\n";
if (outArg) {
  const p = resolve(outArg);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, json, "utf8");
  console.error(`${TAG} inputs.json записан: ${rel(p)}`);
} else {
  process.stdout.write(json);
}
process.exit(0);
