#!/usr/bin/env node
// build-project.mjs
// Склейка контракта v8: parts/facts.json + parts/market.json -> project.json в корне задачи.
//
// Скрипт делает ровно ту работу, которую агенту делать нельзя, потому что она арифметическая:
//   - пересчитывает gates (агент их не проставляет никогда);
//   - засевает publish: при первой сборке у всех фактов "no", при пересборке уже поднятые
//     гейтом "yes" сохраняются по id; факты с маркером снятия и факты, задевающие
//     constraints.forbidden, помечаются в отчете отдельной строкой;
//   - выводит машинные признаки ниши sig из данных, а не из мнения;
//   - заполняет facts[].q сверкой label факта с колонкой NEEDS блоков pages.yml;
//   - проставляет directions[].serves обратной сверкой с segments[].dirs;
//   - считает gaps[].weight = сколько блоков ждут этот факт, и этим задает ПОРЯДОК
//     вопросов во втором клиентском документе.
// Агент приносит только фактуру и формулировки. Ничего, кроме полей контракта, в файл
// не попадает: сборка идет по белому списку, все лишнее отбрасывается и печатается в отчет.
// Перед записью собранный контракт проходит ТУ ЖЕ проверку схемы, что и verify-data.mjs:
// обход схемы один на два скрипта и лежит в _contract.mjs.
//
// Использование:
//   node build-project.mjs <root> [--pages <pages.yml>] [--schema <file>] [--out <file>]
//                          [--date YYYY-MM-DD] [--seed] [--force] [--quiet]
//   <root>   папка задачи: ждет <root>/parts/facts.json и <root>/parts/market.json,
//            пишет <root>/project.json
//   --seed   принудительный засев: publish у всех фактов становится "no", даже если
//            в прошлом project.json гейт уже поднял часть до "yes"
//   --force  пересобрать контракт после пройденного гейта (иначе отказ: пересборка
//            стерла бы согласованные с заказчиком решения)
//
// Exit: 0 чисто | 1 предупреждения | 2 нарушения (project.json не записан).

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import {
  arr, str, low, today, B, NUM_UNIT, isCheckable, heldBack, FACT_SRC, SOURCE_KINDS,
  walkBanned, walkTypo, budget, BUDGET_WARN, BUDGET_MAX, readPages, validate, THIN
} from "./_contract.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
let rootArg = null, pagesArg = null, schemaArg = null, outArg = null, dateArg = null;
let quiet = false, forceSeed = false, force = false;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--pages") pagesArg = argv[++i] || null;
  else if (a === "--schema") schemaArg = argv[++i] || null;
  else if (a === "--out") outArg = argv[++i] || null;
  else if (a === "--date") dateArg = argv[++i] || null;
  else if (a === "--seed") forceSeed = true;
  else if (a === "--force") force = true;
  else if (a === "--quiet") quiet = true;
  else if (!rootArg) rootArg = a;
}
if (!rootArg) {
  console.error("[build-project] usage: <root> [--pages <pages.yml>] [--schema <file>] [--out <file>] [--date YYYY-MM-DD] [--seed] [--force]");
  process.exit(2);
}
const root = resolve(rootArg);
const factsPath = join(root, "parts", "facts.json");
const marketPath = join(root, "parts", "market.json");
const queuePath = join(root, "queue.json");
const outPath = outArg ? resolve(outArg) : join(root, "project.json");
const pagesPath = pagesArg ? resolve(pagesArg) : resolve(HERE, "..", "..", "skills", "site-proto", "pages.yml");
const schemaPath = schemaArg ? resolve(schemaArg) : resolve(HERE, "..", "..", "skills", "site-analiz", "project.schema.json");

const violations = [], warnings = [], infos = [];
const V = (p, m) => violations.push(p ? `${p}: ${m}` : m);
const W = (p, m) => warnings.push(p ? `${p}: ${m}` : m);
const I = (m) => infos.push(m);

function readJson(p, what, required) {
  if (!existsSync(p)) {
    if (required) { console.error(`[build-project] нет файла ${what}: ${p}`); process.exit(2); }
    return null;
  }
  try { return JSON.parse(readFileSync(p, "utf8").replace(/^﻿/, "")); }
  catch (e) { console.error(`[build-project] ${what} не разобран (${p}): ${e.message}`); process.exit(2); }
}

// ---------------------------------------------------------------- pages.yml
const pages = readPages(pagesPath);
if (!pages) { console.error(`[build-project] нет pages.yml: ${pagesPath}`); process.exit(2); }
const blockIds = new Set(pages.blocks.keys());
const sigIds = new Set(pages.sig);
const needsOf = (id) => { const c = pages.blocks.get(id); return c && c.length === 7 ? c[5] : ""; };
const corpusOf = (id) => { const c = pages.blocks.get(id); return c && c.length === 7 ? `${c[1]} ${c[2]}` : ""; };

// ---------------------------------------------------------------- вход
const partFacts = readJson(factsPath, "parts/facts.json", true) || {};
const partMarket = readJson(marketPath, "parts/market.json", false) || {};
const queue = readJson(queuePath, "queue.json", false) || {};
const prev = existsSync(outPath) ? readJson(outPath, "прошлый project.json", false) : null;

// Слитый вход: раздел берется оттуда, где он есть. Чей это раздел по промту, неважно -
// важно, чтобы смысл не потерялся между двумя агентами.
const merge = (name) => {
  const m = partMarket[name], f = partFacts[name];
  const okm = m && typeof m === "object", okf = f && typeof f === "object";
  if (okm && okf) I(`${name}: раздел пришел и из market.json, и из facts.json - взят market.json`);
  return okm ? m : okf ? f : {};
};

// Пересборка после гейта стирает и publish, и шесть согласованных решений, которые живут
// только в контракте. Молча этого не делаем.
if (queue.gate && queue.gate.approved === true && !force) {
  V("", `гейт пройден ${str(queue.gate.at)} (${str(queue.gate.by) || "кто-то"}) - пересборка стерла бы согласованные решения. Нужна правка - повтори с --force и перепроведи гейт`);
}

const arrOf = arr;
const clean = (list, cap, path) => {
  const out = [...new Set(arrOf(list).map((x) => str(x)).filter(Boolean))];
  if (cap != null && out.length > cap) { W(path, `элементов ${out.length}, потолок ${cap} - хвост отброшен`); return out.slice(0, cap); }
  return out;
};

// Белый список: в контракт едут только описанные поля. Остальное отбрасывается тут же,
// иначе additionalProperties false у схемы ловил бы чужое поле как нарушение.
function pick(o, keys, path) {
  const r = {};
  if (!o || typeof o !== "object" || Array.isArray(o)) return r;
  for (const k of keys) {
    const v = o[k];
    if (v === undefined || v === null) continue;
    if (typeof v === "string" && !v.trim()) continue;
    if (Array.isArray(v) && !v.length) continue;
    r[k] = typeof v === "string" ? v.trim() : v;
  }
  const extra = Object.keys(o).filter((k) => !keys.includes(k));
  if (extra.length) I(`${path}: за контракт не пущены поля ${extra.join(", ")}`);
  return r;
}
const pickList = (list, keys, path, cap) => {
  const src = arrOf(list);
  const out = src.slice(0, cap == null ? src.length : cap).map((x, i) => pick(x, keys, `${path}[${i}]`));
  if (cap != null && src.length > cap) W(path, `элементов ${src.length}, в контракт влезает ${cap} - хвост отброшен`);
  return out.filter((x) => Object.keys(x).length);
};

// ---------------------------------------------------------------- сборка узлов
const slug = (str(partFacts.slug) || str(queue.slug) || basename(root)).toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
const updated = str(dateArg) || today();

const bizIn = partFacts.business && typeof partFacts.business === "object" ? partFacts.business : {};
const business = pick(bizIn, ["name", "what", "region", "geo", "since", "type", "site_kind", "sig", "directions", "legal"], "business");
business.geo = clean(business.geo, 30, "business.geo");
if (!business.geo.length) delete business.geo;
business.directions = pickList(business.directions, ["id", "parent", "name", "marker", "url", "serves"], "business.directions", 25);
business.directions.forEach((d, i) => { if (!d.id) d.id = `dir-${i + 1}`; });
if (bizIn.legal) business.legal = pick(bizIn.legal, ["entity", "inn", "ogrn", "address", "phone", "email", "schedule", "phone_absent"], "business.legal");
if (business.legal && !Object.keys(business.legal).length) delete business.legal;

// Три ответа оператора живут в queue.json. Догадка агента - фолбэк, а не источник истины.
{
  const ask = [["type", ["services", "shop", "both"], "services"], ["site_kind", ["landing", "multipage"], "multipage"]];
  for (const [k, list, def] of ask) {
    const op = str(queue[k]), ag = str(business[k]);
    if (op && list.includes(op)) {
      if (ag && ag !== op) W(`business.${k}`, `оператор ответил «${op}», агент решил «${ag}» - взят ответ оператора`);
      business[k] = op;
    } else if (!ag || !list.includes(ag)) {
      business[k] = def;
      W(`business.${k}`, `значения не было ни в queue.json, ни в parts/facts.json, поставлен ${def} - проверь руками`);
    }
  }
}
if (business.directions.length < THIN.directions) {
  W("business.directions", `направлений ${business.directions.length}, порог отчета ${THIN.directions} - недобор законен, выдумкой он не добивается`);
}

const offerIn = merge("offer");
const offer = pick(offerIn, ["positioning", "reasons", "promise", "limits", "tone"], "offer");
offer.reasons = pickList(offer.reasons, ["claim", "proof", "kind"], "offer.reasons", 8);
offer.promise = pick(offerIn.promise, ["who", "result", "how", "proof_id", "cta"], "offer.promise");
offer.limits = clean(offer.limits, 8, "offer.limits");
if (!offer.limits.length) delete offer.limits;

const audIn = merge("audience");
const audience = { segments: pickList(audIn.segments, ["id", "name", "who", "dirs", "pain", "fear", "objection", "choose"], "audience.segments", 4) };
audience.segments.forEach((s, i) => {
  if (!s.id) s.id = `seg-${i + 1}`;
  s.pain = clean(s.pain, 3, `audience.segments[${i}].pain`);
  s.fear = clean(s.fear, 2, `audience.segments[${i}].fear`);
  s.choose = clean(s.choose, 3, `audience.segments[${i}].choose`);
  s.dirs = clean(s.dirs, 10, `audience.segments[${i}].dirs`);
  if (!s.fear.length) delete s.fear;
  if (!s.dirs.length) delete s.dirs;
  s.objection = pickList(s.objection, ["says", "behind", "answer"], `audience.segments[${i}].objection`, 3);
});
const words = pickList(audIn.words, ["say", "means", "src"], "audience.words", 25).filter((w) => w.say);
words.forEach((w) => { if (!w.src) w.src = "persona"; });
if (words.length) audience.words = words;
{
  const persona = words.filter((w) => w.src === "persona").length;
  if (words.length) I(`слова аудитории: ${words.length}, из них persona ${persona} - это штатно, ярлык происхождения воротами не является`);
}

// directions[].serves владельца среди агентов не имеет по построению: intake не знает
// сегментов, market не пишет business. Считается тут, обратной сверкой с segments[].dirs.
{
  const segIds = new Set(audience.segments.map((s) => s.id));
  const back = new Map();
  for (const s of audience.segments) for (const d of arrOf(s.dirs)) {
    const list = back.get(d) || [];
    if (!list.includes(s.id)) list.push(s.id);
    back.set(d, list);
  }
  let filled = 0;
  for (const d of business.directions) {
    const given = clean(d.serves, 4, "business.directions.serves").filter((s) => segIds.has(s));
    const calc = (back.get(d.id) || []).slice(0, 4);
    const serves = [...new Set([...given, ...calc])].slice(0, 4);
    if (serves.length) { d.serves = serves; filled++; } else delete d.serves;
  }
  if (filled) I(`directions[].serves проставлены скриптом у ${filled} направлений из ${business.directions.length} - по обратной сверке с segments[].dirs`);
  else if (business.directions.length && audience.segments.length) I("directions[].serves пусты: ни один сегмент не назвал направлений в dirs - строка «Кому это нужно» в документе 1 не напечатается");
}

const mkRoot = merge("competitors");
const mkIn = mkRoot && Object.keys(mkRoot).length ? mkRoot : partMarket;
const competitors = {};
{
  const list = clean(mkIn.list, 15, "competitors.list");
  if (list.length) competitors.list = list;
  const m = mkIn.market && typeof mkIn.market === "object" ? mkIn.market : {};
  const market = {};
  const mh = clean(m.must_have, 20, "competitors.market.must_have").filter((b) => {
    if (blockIds.has(b)) return true;
    V("competitors.market.must_have", `«${b}» не id блока из pages.yml - состав страницы по нему не посчитать`);
    return false;
  });
  if (mh.length) market.must_have = mh;
  const mg = clean(m.gaps, 10, "competitors.market.gaps");
  if (mg.length) market.gaps = mg;
  const os = clean(m.offers_seen, 12, "competitors.market.offers_seen");
  if (os.length) market.offers_seen = os;
  if (Object.keys(market).length) competitors.market = market;
  const sn = clean(mkIn.seen_numbers, 20, "competitors.seen_numbers");
  if (sn.length) competitors.seen_numbers = sn;
}
{
  const scan = partMarket.scan && typeof partMarket.scan === "object" ? partMarket.scan : null;
  const seen = scan ? Number(scan.pages_seen != null ? scan.pages_seen : scan.seen) : NaN;
  const total = scan ? Number(scan.pages_total != null ? scan.pages_total : scan.total) : NaN;
  if (Number.isFinite(seen) && Number.isFinite(total)) I(`перепись разведки: померено на ${seen} из ${total} страниц; в контракт она не едет, документ 1 берет ее из parts/market.json`);
  else if (partMarket && Object.keys(partMarket).length) W("parts/market.json", "нет блока scan {pages_seen, pages_total} - строка «померено на N из M страниц» в документе 1 не напечатается");
}

const cIn = partFacts.constraints && typeof partFacts.constraints === "object" ? partFacts.constraints : {};
const constraints = {};
for (const k of ["forbidden", "not_self", "not_selling", "must_say"]) {
  const cap = k === "forbidden" ? 30 : 10;
  const v = clean(cIn[k], cap, `constraints.${k}`);
  if (v.length) constraints[k] = v;
}
if (str(cIn.opsec)) constraints.opsec = str(cIn.opsec);

const lIn = merge("lexicon");
const lexicon = {};
for (const k of ["locked", "canonical"]) { const v = clean(lIn[k], 25, `lexicon.${k}`); if (v.length) lexicon[k] = v; }
{
  const tr = pickList(lIn.translate, ["from", "to"], "lexicon.translate", 25).filter((t) => t.from && t.to);
  if (tr.length) lexicon.translate = tr;
}
if (!Object.keys(lexicon).length) I("lexicon пуст: язык заказчика не снят - три секции документа 1 про слова не напечатаются");

const facts = pickList(partFacts.facts, ["id", "label", "value", "q", "artifact", "publish", "src"], "facts", 40)
  .filter((f) => f.label && (f.value || f.artifact));
// value обязателен схемой, даже когда он пуст: факт с одним artifact - законное состояние,
// и в документе 1 такая строка печатается ссылкой на подтверждение, а не прочерком.
facts.forEach((f, i) => { if (!f.id) f.id = "f" + String(i + 1).padStart(2, "0"); if (f.value === undefined) f.value = ""; });
{
  const dropped = arrOf(partFacts.facts).length - facts.length;
  if (dropped > 0) I(`фактов отброшено ${dropped}: без label или без value и artifact факта нет`);
  if (facts.length < THIN.facts) W("facts", `фактов ${facts.length}, порог отчета ${THIN.facts} - недостающее уходит в gaps, а не в выдумку`);
}

// gaps пишет site-intake: он единственный видит, чего не хватило. Если вопросы пришли
// из market.json, берем и оттуда - владелец раздела важнее, чем имя файла.
const gapsIn = pickList(arrOf(partFacts.gaps).length ? partFacts.gaps : partMarket.gaps, ["id", "ask", "hits", "weight"], "gaps", 10).filter((g) => g.ask);
gapsIn.forEach((g, i) => { if (!g.id) g.id = "g" + (i + 1); delete g.weight; });

// ---------------------------------------------------------------- активные блоки
// Что вообще будет на сайте: от этого зависят и q фактов, и вес вопросов. Блок, которого
// на сайте не будет, ничего не ждет и вес вопросу не добавляет.
function activeTypes(kind, type) {
  if (kind === "landing") return ["landing"];
  const t = ["home"];
  if (type === "services" || type === "both") t.push("service");
  if (type === "shop" || type === "both") t.push("category", "facet", "product");
  return t;
}
const types = activeTypes(business.site_kind, business.type);
const active = new Set();
for (const t of types) {
  const line = pages.skel.get(t) || "";
  for (const tok of line.split(/\s+/)) { const id = tok.replace(/!$/, ""); if (blockIds.has(id)) active.add(id); }
}
for (const b of arrOf(competitors.market && competitors.market.must_have)) active.add(b);
I(`типы страниц: ${types.join(", ")}; активных блоков ${active.size} из ${blockIds.size}`);

// ---------------------------------------------------------------- признаки ниши sig
// Выводятся из данных. Список агента не стирается - к нему добавляется то, что видно машинно,
// и печатается расхождение. Словарь ровно девять имен, он лежит в pages.yml.
const dirText = business.directions.map((d) => `${d.name || ""} ${d.marker || ""}`).join(" ");
const corp = {
  biz: low(`${business.what} ${business.region} ${dirText} ${offer.positioning || ""}`),
  facts: low(facts.map((f) => `${f.label} ${f.value || ""} ${f.artifact || ""}`).join(" ")),
  who: low(`${audience.segments.map((s) => `${s.name} ${s.who || ""}`).join(" ")} ${(business.legal && business.legal.entity) || ""}`),
  pain: low(audience.segments.map((s) => `${arrOf(s.pain).join(" ")} ${arrOf(s.fear).join(" ")} ${arrOf(s.objection).map((o) => o.says).join(" ")}`).join(" ")),
  choose: low(audience.segments.map((s) => `${arrOf(s.choose).join(" ")} ${arrOf(s.objection).map((o) => `${o.says} ${o.behind || ""}`).join(" ")}`).join(" ")),
  market: low(`${arrOf(competitors.seen_numbers).join(" ")} ${arrOf(competitors.market && competitors.market.offers_seen).join(" ")}`)
};
const input = partFacts.input && typeof partFacts.input === "object" ? partFacts.input : (queue.input && typeof queue.input === "object" ? queue.input : {});
const skus = Number(input.skus != null ? input.skus : input.items);
const photos = Number(input.photos);
const mustHave = new Set(arrOf(competitors.market && competitors.market.must_have));

const derived = new Set();
if (business.type === "shop" || business.type === "both" || (Number.isFinite(skus) && skus >= 30) || mustHave.has("listing")) derived.add("catalog");
if (new RegExp(`лиценз|${B}сро([^а-яa-z]|$)|допуск|сертификат|аккредитац|разрешени|свидетельств`).test(corp.facts + " " + corp.biz)) derived.add("licensed");
if (business.legal && str(business.legal.entity) && /организац|юрлиц|юр\.|компан|подрядчик|застройщ|оптов|b2b|тендер|безнал|по счету/.test(corp.who)) derived.add("b2b");
if (arrOf(business.geo).length >= 2 || /выезд|радиус|зона обслуж|по районам|доставк/.test(corp.biz + " " + corp.facts)) derived.add("geo_bound");
if (/замер|выезд|монтаж|установк|на объект|обследован|осмотр|подключ/.test(corp.biz)) derived.add("visit");
if (/авари|срочн|прорв|течет|не работает|встал|сегодня же|за час|немедлен/.test(corp.pain)) derived.add("urgent");
if (/сравнива|несколько подрядч|несколько компан|тендер|смет|выбираем долго|не первый месяц|согласован/.test(corp.choose)) derived.add("long_cycle");
if (arrOf(competitors.seen_numbers).filter((n) => /\d/.test(n) && new RegExp(`₽|руб|${B}р\\.|цен|стоим|от \\d`, "i").test(n)).length >= 2) derived.add("price_open");
if (mustHave.has("cat_text")) derived.add("serp_hot");
{
  const given = new Set(clean(business.sig, 9, "business.sig").filter((s) => {
    if (sigIds.has(s)) return true;
    V("business.sig", `«${s}» не признак ниши из pages.yml (их девять: ${pages.sig.join(", ")})`);
    return false;
  }));
  const added = [...derived].filter((s) => !given.has(s));
  const onlyAgent = [...given].filter((s) => !derived.has(s));
  const sig = [...new Set([...given, ...derived])].filter((s) => sigIds.has(s));
  if (sig.length) business.sig = sig; else delete business.sig;
  if (added.length) I(`sig выведены машинно и добавлены: ${added.join(", ")}`);
  if (onlyAgent.length) I(`sig стоят со слов агента, машинного подтверждения нет: ${onlyAgent.join(", ")}`);
  if (Number.isFinite(photos)) I(`фото на входе: ${photos}; отдельного признака под фото в словаре pages.yml нет, на sig число не влияет - оно влияет на блоки cases и gallery`);
  if (Number.isFinite(skus)) I(`номенклатура на входе: ${skus} позиций`);
  // Следствие признака ниши - это третья колонка секции sig в pages.yml: «docs обязателен»,
  // «steps и geo обязательны». Имена блоков вычитываются оттуда, а не перечисляются тут руками.
  const grown = [];
  for (const s of arrOf(business.sig)) {
    for (const id of blockIds) {
      if (active.has(id)) continue;
      if (new RegExp(`(^|[^a-z0-9_])${id}([^a-z0-9_]|$)`).test(pages.sigBody.get(s) || "")) { active.add(id); grown.push(`${id} (по признаку ${s})`); }
    }
  }
  if (grown.length) I(`блоки добавлены следствием признака ниши: ${grown.join(", ")}; активных стало ${active.size}`);
}

{
  const idle = [...blockIds].filter((b) => !active.has(b));
  if (idle.length) I(`не активны при этом типе сайта: ${idle.join(", ")} - они входят только через must_have разведки либо через правило страницы info`);
}

// ---------------------------------------------------------------- facts[].q
// Какой блок ждет этот факт. Сверка идет по колонке NEEDS блока и по словам самого блока:
// корпус берется из pages.yml, руками тут ничего не перечислено, кроме коротких подсказок
// для пар, которые по словам не совпадают (гарантия - блок edge, лицензия - блок docs).
const HINTS = [
  [new RegExp(`${B}цен|стоим|тариф|прайс|${B}смет`), ["price", "price_factors", "cat_intro", "compare", "hero"]],
  [/руб|₽|за кв м|за м2|за квадрат/, ["price", "price_factors", "cat_intro", "compare"]],
  [/срок|дней|дня|недел|за час|график/, ["hero", "steps", "delivery", "cases"]],
  [/гаранти/, ["edge", "qa", "docs", "product_desc"]],
  [new RegExp(`лиценз|${B}сро([^а-яa-z]|$)|допуск|сертификат|свидетельств|страхов`), ["docs", "edge"]],
  [/опыт|стаж|год работ|лет на рынке|с 19|с 20/, ["numbers", "about", "edge"]],
  [/объект|кейс|выполнен|сдан|реализован/, ["cases", "numbers"]],
  [/отзыв|оцен|рейтинг|благодарн/, ["reviews", "edge"]],
  [/фото|галере|снимк|портфолио/, ["cases", "gallery", "about"]],
  [/сотрудник|бригад|команд|человек|специалист|мастер/, ["about", "numbers", "edge"]],
  [/склад|наличи|остат|ассортимент|позиц|номенклатур|моделей/, ["listing", "subcats", "cat_intro", "gallery"]],
  [/доставк|самовывоз|оплат|рассрочк|счет/, ["delivery", "cta_form"]],
  [/выезд|зона|район|радиус|адрес/, ["geo", "delivery"]],
  [/оборудован|техник|парк|станк/, ["about", "edge", "specs"]],
  [/что входит|состав|комплект|перечень/, ["scope", "result", "product_desc", "cat_text"]],
  [/не работаем|не берем|не делаем|ограничен|минималь/, ["not_fit", "fit", "geo"]],
  [/шаг|этап|процесс|заявк|запис|перезвон/, ["steps", "cta_form", "cta_mid"]],
  [/характерист|парамет|размер|мощност|вес|материал/, ["specs", "cat_text", "compare"]]
];
const STOP = new Set(["который", "которые", "какой", "какие", "этот", "этом", "что", "как", "для", "при", "под", "если", "или", "его", "вас", "вам", "они", "дают", "делает", "строка", "список", "блок", "есть", "нет", "это", "будет", "после", "перед", "чем", "где", "кто", "куда", "сколько", "почему", "зачем", "только", "один", "одна", "одно", "тут", "мной", "меня", "мне"]);
const stems = (s) => new Set(String(s || "").toLowerCase().replace(/[^а-яa-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length >= 4 && !STOP.has(w)).map((w) => w.slice(0, 5)));
const BLOCK_STEMS = new Map([...blockIds].map((id) => [id, stems(corpusOf(id))]));

function needsOfFact(f) {
  const t = `${low(f.label)} ${low(f.value)}`;
  if (/шаг|этап|процесс|заявк|запис|перезвон|как заказать/.test(t)) return "действие";
  if (/не работаем|не берем|не делаем|ограничен|минималь|только для|отказ|предел/.test(t)) return "граница";
  if (/услови|рассрочк|предоплат|при заказе|если |бесплатн[оы] при|скидк/.test(t)) return "условие";
  if (/что входит|состав|комплект|перечень|список|ассортимент|номенклатур|характерист/.test(t)) return "состав";
  if (NUM_UNIT.test(str(f.value)) || new RegExp(`${B}цен|стоим|срок|гаранти|опыт|количеств|объем|площад|доля|процент`).test(t)) return "число";
  return "состав";
}
function matchBlocks(text, kind) {
  const hint = new Set();
  const t = low(text);
  for (const [re, ids] of HINTS) if (re.test(t)) for (const id of ids) hint.add(id);
  const fs = stems(text);
  const score = new Map();
  for (const id of active) {
    if (!blockIds.has(id)) continue;
    let shared = 0;
    for (const st of BLOCK_STEMS.get(id) || []) if (fs.has(st)) shared += 1;
    const topical = hint.has(id) ? 3 : 0;
    // Блок ждет факт только при теме. Совпадение по колонке NEEDS - ранг, а не пропуск:
    // иначе к цене прилипают все блоки с NEEDS «число», включая «кто вы такие».
    if (!topical && !shared) continue;
    let s = topical + shared;
    if (kind) s += needsOf(id) === kind ? 1 : -0.5;
    if (s > 0) score.set(id, s);
  }
  return [...score.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([id]) => id);
}
{
  let filled = 0, empty = 0;
  for (const f of facts) {
    const given = clean(f.q, 12, "facts.q").filter((b) => blockIds.has(b));
    const q = given.length ? given : matchBlocks(`${f.label} ${f.value || ""}`, needsOfFact(f)).slice(0, 5);
    if (q.length) { f.q = q; if (!given.length) filled++; } else { delete f.q; empty++; }
  }
  I(`facts[].q: заполнено скриптом ${filled}, без единого ждущего блока ${empty} - такой факт лежит в файле весом без применения`);
}

// ---------------------------------------------------------------- publish
{
  const forbidden = arrOf(constraints.forbidden);
  const keep = new Map();
  if (prev && !forceSeed) for (const f of arrOf(prev.facts)) if (f && f.publish === "yes" && f.id) keep.set(f.id, true);
  const flagged = [];
  for (const f of facts) {
    const mark = heldBack(f, forbidden);
    f.publish = keep.has(f.id) && !mark ? "yes" : "no";
    if (mark) flagged.push(`${f.id} «${f.label}» - ${mark}`);
    if (!FACT_SRC.includes(f.src)) {
      V(`facts ${f.id}`, `источник «${f.src || "нет"}» вне набора ${FACT_SRC.join(", ")} - факт без источника не факт и не пишется вовсе`);
    }
  }
  const yes = facts.filter((f) => f.publish === "yes").length;
  if (yes) I(`publish: сохранено "yes" у ${yes} фактов из прошлой сборки (гейт их уже поднял), остальные засеяны "no"`);
  else I(`publish: засеяно "no" у всех ${facts.length} фактов - "yes" поднимает только гейт после ответа заказчика по таблице «ваши цифры»`);
  if (flagged.length) {
    I(`не предлагать к публикации (${flagged.length}): ${flagged.join("; ")}`);
    W("facts", `${flagged.length} фактов задевают запреты или помечены снятием - в документе 1 они идут с рекомендацией «не публикуем»`);
  }
}

// ---------------------------------------------------------------- gaps: вес и порядок
// weight = сколько АКТИВНЫХ блоков ждут этот факт. Ровно он задает порядок вопросов во втором
// документе: сверху то, что наполнит больше всего блоков. Блок, которого на сайте не будет,
// веса не дает. При равном весе выше идет вопрос, который наполняет пока пустые блоки -
// те, на которые не смотрит ни один факт (по facts[].q).
const covered = new Set();
for (const f of facts) for (const b of arrOf(f.q)) covered.add(b);
const gaps = [];
for (const g of gapsIn) {
  const given = clean(g.hits, 20, "gaps.hits").filter((h) => blockIds.has(h));
  const guess = given.length ? given : matchBlocks(g.ask, needsOfFact({ label: g.ask, value: "" })).slice(0, 8);
  const hits = guess.filter((h) => active.has(h));
  const cut = guess.filter((h) => !active.has(h));
  g.hits = hits;
  g.weight = hits.length;
  const hungry = hits.filter((h) => !covered.has(h)).length;
  if (cut.length && given.length) I(`${g.id}: блоки ${cut.join(", ")} веса не дают - их не будет на сайте при типе ${business.site_kind}/${business.type}`);
  gaps.push({ g, hungry });
}
gaps.sort((a, b) => b.g.weight - a.g.weight || b.hungry - a.hungry || a.g.id.localeCompare(b.g.id));
const gapsOut = gaps.map((x) => x.g);
if (gapsOut.length) {
  I(`вопросов в документе 2: ${gapsOut.length} (потолок 10). Порядок по весу: ${gapsOut.map((g) => `${g.id}=${g.weight}`).join(", ")}`);
  const zero = gapsOut.filter((g) => !g.weight);
  if (zero.length) W("gaps", `${zero.length} вопросов не ждет ни один блок (вес 0): ${zero.map((g) => g.id).join(", ")} - такой вопрос отнимает у заказчика строку и ничего не добавляет`);
} else W("gaps", "вопросов нет вовсе - документ 2 не соберется. Вопросы пишет site-intake: он видит, чего не хватило");

// ---------------------------------------------------------------- gates
// Считает только скрипт. Ровно та же арифметика, что в verify-data.mjs.
const gates = (() => {
  const checkable = facts.filter((f) => f.publish === "yes" && isCheckable(f));
  const g = {
    promise: str(offer.promise && offer.promise.result).length > 0,
    facts3: checkable.length >= 3,
    proof1: arrOf(offer.reasons).some((r) => str(r.proof).length > 0),
    ready: false
  };
  g.ready = g.promise && g.facts3 && g.proof1;
  I(`ворота: promise ${g.promise}, facts3 ${g.facts3} (проверяемых опубликованных фактов ${checkable.length}), proof1 ${g.proof1}, ready ${g.ready}`);
  if (!g.ready && !facts.some((f) => f.publish === "yes")) I("ready false - штатно для засева: publish поднимает гейт после ответа заказчика, до этого ворота закрыты по построению");
  return g;
})();

// ---------------------------------------------------------------- итог
const project = {
  v: 2, slug, updated,
  source: clean(partFacts.source, 5, "source").filter((s) => {
    if (SOURCE_KINDS.includes(s)) return true;
    V("source", `«${s}» вне набора ${SOURCE_KINDS.join(", ")}`);
    return false;
  }),
  tier: null,
  gates, business, offer, audience, competitors, facts, constraints, lexicon, gaps: gapsOut
};
{
  const op = str(queue.tier), ag = str(partFacts.tier);
  const ok = (x) => ["basic", "seo"].includes(x);
  project.tier = ok(op) ? op : ok(ag) ? ag : "basic";
  if (ok(op) && ok(ag) && op !== ag) W("tier", `оператор ответил «${op}», в parts/facts.json стоит «${ag}» - взят ответ оператора`);
  if (!ok(op) && !ok(ag)) W("tier", "тарифа не было ни в queue.json, ни в parts/facts.json, поставлен basic - платные замеры будут считаться некупленными");
}
if (!project.source.length) I("source пуст - входа не было вовсе, это законное состояние контракта");

// ---------------------------------------------------- последние проверки перед записью
// Поля-обоснования, типографика, бюджет и СХЕМА. Схема тут та же самая, что у валидатора:
// собранный контракт обязан проходить проверку, которой его встретят на следующем шаге.
walkBanned(project, (p, k) => V(p, `поле-обоснование «${k}» запрещено контрактом v8`));
walkTypo(project, (p, kinds) => V(p, `${kinds} в клиентской строке - правь вход, только дефис и е`));
{
  const { size, fat } = budget(project);
  I(`бюджет: ${size} знаков (предупреждение ${BUDGET_WARN}, ошибка ${BUDGET_MAX}); самый толстый массив ${fat.path} - ${fat.size} знаков, элементов ${fat.n}`);
  if (size >= BUDGET_MAX) V("", `бюджет файла ${size} знаков, потолок ${BUDGET_MAX} - режь массив ${fat.path}`);
  else if (size >= BUDGET_WARN) W("", `бюджет файла ${size} знаков, порог ${BUDGET_WARN} - самый толстый массив ${fat.path}`);
}
{
  const schema = readJson(schemaPath, "схема", true);
  const before = violations.length;
  validate(project, schema, "", schema, (p, m) => V(p ? `схема ${p}` : "схема", m));
  const n = violations.length - before;
  if (n) I(`схема отвергла сборку: нарушений ${n} - файл не записан, правится вход, а не выход`);
  else I("схема пройдена: собранный контракт примет и verify-data.mjs");
}

let written = false;
if (!violations.length) {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(project, null, 2) + "\n", "utf8");
  written = true;
}

if (!quiet) {
  console.log(`[build-project] ${written ? outPath : "НЕ ЗАПИСАН"}  (фактов ${facts.length}, направлений ${business.directions.length}, сегментов ${audience.segments.length}, вопросов ${gapsOut.length})`);
  for (const m of infos) console.log("   i " + m);
  if (warnings.length) { console.log("  предупреждения:"); for (const w of warnings) console.log("   ~ " + w); }
  if (violations.length) { console.log("  НАРУШЕНИЯ (project.json не записан):"); for (const v of violations) console.log("   ! " + v); }
  if (written) console.log("  дальше: verify-data.mjs на этом файле, затем build-doc.mjs на оба документа.");
}
process.exit(violations.length ? 2 : warnings.length ? 1 : 0);
