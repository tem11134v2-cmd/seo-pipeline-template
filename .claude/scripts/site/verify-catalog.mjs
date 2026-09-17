#!/usr/bin/env node
// verify-catalog.mjs
// Механический гейт режима магазина: catalog.json против catalog.schema.json ПЛЮС восемь
// проверок, которых схема не умеет в принципе. Схема держит форму, гейт держит смысл.
//
// Что он не пропускает и почему именно это:
//   1. Обещанный фасет с заполненностью ниже порога. Ось ниже 0.7 - это фильтр, у которого
//      треть товаров проваливается мимо любого значения; в ТЗ такому фасету места нет,
//      его место в blocked_by_data со строкой «заполнено X процентов из 70».
//   2. Посадка в неизвестном статусе индексации. Статус проверяется не только по списку,
//      но и по анкете платформы: index без meta_override - это обещание своих метатегов
//      там, где платформа их не дает, а canonical без canonical - закрытие тем, чего нет.
//   3. Узел без трех падежных форм. Без них шаблон печатает «Цены на Насосы
//      циркуляционные» в первой же строке ТЗ, и это видит заказчик.
//   4. Повтор метатега. Одинаковый Title у двух посадок означает дубль, а дубль не
//      ранжируется: посадка без своего H1 и Title не посадка, а копия категории.
//   5. Узел без всех четырех чисел режима. Четыре числа печатаются колонкой, чтобы
//      решение проверялось глазом; заодно режим пересчитывается и сверяется с записанным.
//   6. Фасет при вердикте impossible. Данных нет - фасета нет, и притворяться нельзя.
//   7. Посадка на узле, которому режим отменил листинг. У thin_category категория закрыта
//      noindex, и canonical посадки указывал бы на закрытую страницу; у service_like
//      листинга нет вовсе. Посадки собирает tree, режим ставит mode - значит чистить их
//      обязан mode, а гейт обязан это проверять.
//   8. Узел без режима. Раньше tree предзаполнял его словом catalog и четырьмя нулями,
//      и страховка «сначала mode» молчала: заказчик получал ТЗ с колонкой из нулей.
// Плюс DERIVED: counts сверяются с деревом, расхождение - нарушение, потому что именно
// counts.landings едет в смету как объем работ. Квота тира A против фактически
// назначенного по спросу - предупреждение: числа расходятся законно, но не молча.
//
// Использование:
//   node verify-catalog.mjs <каталог|catalog.json> [--schema <file>] [--quiet]
//
// Exit: 0 чисто | 1 предупреждения | 2 нарушения (или файл не читается).

import { readFileSync, existsSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { arr, str, low, walkBanned, walkTypo, validate } from "./_contract.mjs";
import {
  AXIS_FILL_MIN, VERDICTS, SPECS_MIN, NODES_MAX, LANDINGS_MAX, LANDING_INDEX_SKU, LANDING_INDEX_DEMAND,
  readRulesYml, serviceRe, modeOf, platformGate
} from "./catalog.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
let target = null, schemaArg = null, quiet = false;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--schema") schemaArg = argv[++i] || null;
  else if (a === "--quiet") quiet = true;
  else if (!target) target = a;
}
if (!target) { console.error("[verify-catalog] usage: <каталог|catalog.json> [--schema <file>] [--quiet]"); process.exit(2); }

const isDir = existsSync(target) && statSync(target).isDirectory();
const catPath = isDir ? join(resolve(target), "catalog.json") : resolve(target);
const dir = dirname(catPath);
const schemaPath = schemaArg ? resolve(schemaArg) : resolve(HERE, "..", "..", "skills", "site-proto", "catalog.schema.json");

const violations = [], warnings = [], infos = [];
const V = (path, msg) => violations.push(path ? `${path}: ${msg}` : msg);
const W = (path, msg) => warnings.push(path ? `${path}: ${msg}` : msg);
const I = (msg) => infos.push(msg);
const pct = (x) => Math.round(Number(x) * 100);

function readJson(p, what) {
  if (!existsSync(p)) { console.error(`[verify-catalog] нет файла ${what}: ${p}`); process.exit(2); }
  try { return JSON.parse(readFileSync(p, "utf8").replace(/^﻿/, "")); }
  catch (e) { console.error(`[verify-catalog] ${what} не разобран (${p}): ${e.message}`); process.exit(2); }
}

const data = readJson(catPath, "catalog.json");
const schema = readJson(schemaPath, "catalog.schema.json");

// ---------------------------------------------------------------- форма: схема, обоснования, типографика
validate(data, schema, "", schema, (p, m) => V(p ? `схема ${p}` : "схема", m));
walkBanned(data, (p, k) => V(p, `поле-обоснование «${k}» запрещено во всех форматах режима`));
walkTypo(data, (p, names) => V(p, `запрещенная типографика (${names}) - в клиентский текст едет дефис и буква е`));

const nodes = arr(data.tree);
const landings = arr(data.landings);
const platform = (data.platform && typeof data.platform === "object") ? data.platform : {};
const verdict = str(data.verdict);
const byId = new Map(nodes.map((n) => [str(n && n.id), n]));
const noFacets = verdict === "must_request_from_client" || verdict === "impossible";
const CAN = (x) => str(x) === "yes";

// ---------------------------------------------------------------- 1. оси: порог и две блокировки
{
  let published = 0;
  for (const n of nodes) {
    const id = str(n && n.id);
    for (const f of arr(n && n.facets)) {
      published++;
      const fill = Number(f && f.fill);
      if (!Number.isFinite(fill) || fill < AXIS_FILL_MIN) {
        V(`tree.${id}.facets.${str(f && f.attr)}`, `обещанный фасет с заполненностью ${Number.isFinite(fill) ? pct(fill) + " процентов" : "без числа"} при пороге ${pct(AXIS_FILL_MIN)}: место такой оси в blocked_by_data`);
      }
      if (noFacets) V(`tree.${id}.facets.${str(f && f.attr)}`, `вердикт ${verdict}: фасетов в ТЗ нет ни одного, данных под них не существует`);
      const need = platformGate(platform, str(f && f.kind), Boolean(f && f.multi));
      if (need) V(`tree.${id}.facets.${str(f && f.attr)}`, `ось опубликована, а платформа ее не держит: не хватает ${need} (анкета: facet_url ${str(platform.facet_url)}, range ${str(platform.range)})`);
      if (str(f && f.kind) !== "range" && !arr(f && f.values).length) {
        W(`tree.${id}.facets.${str(f && f.attr)}`, "ось опубликована без значений: в ТЗ нечего печатать списком фильтра");
      }
    }
  }
  if (noFacets && landings.length) V("landings", `вердикт ${verdict}: посадок не бывает, а их ${landings.length} - объем работ посчитан по фасетам, которых нельзя построить`);
  I(`вердикт ${verdict}, опубликованных осей ${published}, заблокировано по данным ${arr(data.blocked_by_data).length}, по платформе ${arr(data.blocked_by_platform).length}`);
}

for (const b of arr(data.blocked_by_data)) {
  const where = `blocked_by_data.${str(b && b.node)}.${str(b && b.attr)}`;
  if (!byId.has(str(b && b.node))) V(where, "блокировка ссылается на узел, которого нет в дереве");
  const fill = Number(b && b.fill);
  if (Number.isFinite(fill) && fill >= AXIS_FILL_MIN) V(where, `заполнено ${pct(fill)} процентов при пороге ${pct(AXIS_FILL_MIN)}: ось порог прошла, блокировать ее по данным нельзя`);
}
for (const b of arr(data.blocked_by_platform)) {
  const where = `blocked_by_platform.${str(b && b.node)}.${str(b && b.attr)}`;
  const need = str(b && b.need);
  if (!byId.has(str(b && b.node))) V(where, "блокировка ссылается на узел, которого нет в дереве");
  if (need === "facet_url" && ["path", "query"].includes(str(platform.facet_url))) V(where, `платформа дает адрес фильтра (${str(platform.facet_url)}), блокировка ложная`);
  if (["multi_select", "range", "meta_override", "canonical", "clean_param", "noindex"].includes(need) && CAN(platform[need])) {
    V(where, `анкета платформы отвечает ${need} = yes, блокировка ложная: невыполнимого фасета в ТЗ не бывает, но и выдуманного тоже`);
  }
}

// ---------------------------------------------------------------- 2. посадки: статус индексации
{
  let idx = 0, noDemand = 0;
  for (const L of landings) {
    const where = `landings.${str(L && L.id)}`;
    const node = byId.get(str(L && L.node));
    if (!node) { V(where, `посадка висит на узле ${str(L && L.node)}, которого нет в дереве`); continue; }
    const facets = new Map(arr(node.facets).map((f) => [str(f.attr), f]));
    for (const a of arr(L && L.attrs)) {
      const f = facets.get(str(a && a.attr));
      if (!f) { V(where, `посадка стоит на оси ${str(a && a.attr)}, которой у узла ${node.id} нет среди опубликованных`); continue; }
      const vals = arr(f.values).map((v) => low(v.value));
      if (vals.length && !vals.includes(low(a && a.value))) W(where, `значение «${str(a && a.value)}» не встречается в оси ${str(f.attr)} узла ${node.id}`);
    }
    const nm = str(node.mode);
    if (nm === "thin_category" || nm === "service_like") {
      V(where, nm === "thin_category"
        ? `посадка на узле ${node.id} в режиме thin_category: сама категория закрыта noindex, и canonical посадки указывал бы на закрытую от индексации страницу`
        : `посадка на узле ${node.id} в режиме service_like: листинга у него нет вовсе, а фильтр без листинга не существует`);
    }
    const st = str(L && L.index);
    if (st === "index") {
      idx++;
      if (!CAN(platform.meta_override)) V(where, "статус index, а платформа не дает своих Title и H1 отфильтрованной странице (meta_override) - это дубль категории, а не посадка");
      if (Number(L.sku) < LANDING_INDEX_SKU) V(where, `статус index при ${Number(L.sku) || 0} позициях: индексируемая комбинация требует не меньше ${LANDING_INDEX_SKU}`);
      if (!Number(L.demand)) { noDemand++; W(where, "статус index без замеренного спроса: индексируемая комбинация создается под спрос, а его никто не мерил"); }
      else if (Number(L.demand) < LANDING_INDEX_DEMAND) V(where, `статус index при спросе ${Number(L.demand)}: порог ${LANDING_INDEX_DEMAND}`);
    }
    if (st === "canonical" && !CAN(platform.canonical)) V(where, "комбинация закрыта canonical, а платформа canonical не умеет: закрывать нечем");
    if (st === "clean_param" && !CAN(platform.clean_param)) V(where, "комбинация закрыта Clean-param, а платформа его не умеет: закрывать нечем");
    if (!str(L && L.description)) W(where, "нет Description: самый дорогой текст проекта, формула живет в catalog-rules.yml");
  }
  I(`посадок ${landings.length}, из них индексируемых ${idx} - ОБЪЕМ РАБОТ И ЦЕНА СЧИТАЮТСЯ ПО ПОСАДКАМ, а не по категориям`);
  if (noDemand) I(`посадок со статусом index без замера спроса: ${noDemand}`);
}

// ---------------------------------------------------------------- 3. падежные формы
{
  let guessed = 0;
  const guessedList = [];
  for (const n of nodes) {
    const nm = (n && n.name) || {};
    const miss = ["nom", "gen", "acc"].filter((k) => !str(nm[k]));
    if (miss.length) V(`tree.${str(n && n.id)}.name`, `нет падежных форм: ${miss.join(", ")} - шаблон напечатает именительный вместо нужного падежа`);
    else if (/[а-я]/i.test(str(nm.nom)) && str(nm.gen) === str(nm.nom)) { guessed++; if (guessedList.length < 8) guessedList.push(str(n.id)); }
  }
  if (guessed) W("tree", `родительный падеж совпадает с именительным у ${guessed} узлов (${guessedList.join(", ")}): формы дает catalog-rules.yml, раздел names, машинно они не выводятся`);
}

// ---------------------------------------------------------------- 4. уникальность метатегов и адресов
{
  const seen = (list, what, where) => {
    const m = new Map();
    for (const [key, id] of list) {
      if (!key) continue;
      if (m.has(key)) V(`${where}.${id}`, `${what} повторяет посадку ${m.get(key)}: «${key}» - дубль не ранжируется`);
      else m.set(key, id);
    }
  };
  seen(landings.map((L) => [low(L && L.title), str(L && L.id)]), "Title", "landings");
  seen(landings.map((L) => [low(L && L.h1), str(L && L.id)]), "H1", "landings");
  const urls = new Map();
  for (const [u, id, kind] of [...nodes.map((n) => [str(n && n.url), str(n && n.id), "узел"]), ...landings.map((L) => [str(L && L.url), str(L && L.id), "посадка"])]) {
    if (!u) continue;
    if (urls.has(u)) V(`${kind} ${id}`, `адрес ${u} уже занят: ${urls.get(u)}`);
    else urls.set(u, `${kind} ${id}`);
  }
  const ids = new Map();
  for (const [id, kind] of [...nodes.map((n) => [str(n && n.id), "tree"]), ...landings.map((L) => [str(L && L.id), "landings"])]) {
    const key = `${kind}:${id}`;
    if (ids.has(key)) V(kind, `id ${id} встречается дважды`);
    else ids.set(key, true);
  }
  const markers = new Map();
  const nodeUrl = new Set(nodes.map((n) => str(n && n.url)));
  for (const n of nodes) {
    const can = str(n && n.canonical);
    if (can && !nodeUrl.has(can)) V(`tree.${str(n && n.id)}.canonical`, `склейка ведет на адрес ${can}, которого нет ни у одного узла дерева`);
    if (can && can === str(n.url)) V(`tree.${str(n && n.id)}.canonical`, "узел склеен сам на себя: это не склейка, а пустая строка в meta.csv");
    const mk = low(n && n.marker);
    if (!mk) { W(`tree.${str(n && n.id)}`, "нет маркера: мерить топ-10 и ставить режим категории не по чему"); continue; }
    if (markers.has(mk)) {
      const other = byId.get(markers.get(mk));
      const sameSku = other && Number(other.sku) === Number(n.sku);
      // Одинаковый маркер при одинаковом числе позиций и без склейки - это два
      // индексируемых адреса под один запрос, созданные самим конвейером. Вкусовщины тут
      // нет, поэтому нарушение, а не предупреждение.
      if (sameSku && !can && !str(other.canonical)) V(`tree.${str(n && n.id)}`, `маркер «${mk}» и число позиций (${Number(n.sku)}) те же, что у узла ${markers.get(mk)}, и ни один из двух не склеен canonical: каннибализация, созданная конвейером`);
      else W(`tree.${str(n && n.id)}`, `маркер «${mk}» уже стоит у узла ${markers.get(mk)}: два узла под один запрос - каннибализация`);
    } else markers.set(mk, str(n.id));
  }
}

// ---------------------------------------------------------------- 5. режим категории: четыре числа и пересчет
{
  const re = serviceRe([...(readRulesYml(join(dir, "catalog-rules.yml")).get("service_words") || new Map()).values()].flatMap((v) => String(v).split("|")));
  const counters = { catalog: 0, service_like: 0, thin_category: 0 };
  for (const n of nodes) {
    const id = str(n && n.id);
    const sig = (n && n.signals) || {};
    if (!str(n && n.mode)) { V(`tree.${id}.mode`, "режима у узла нет: сначала node .claude/scripts/site/catalog.mjs mode <каталог> - без него четыре числа в ТЗ будут нулями"); continue; }
    const miss = ["products", "non_listing", "text_median", "service_hits"].filter((k) => !Number.isFinite(Number(sig[k])));
    if (miss.length) { V(`tree.${id}.signals`, `режим поставлен без чисел: нет ${miss.join(", ")} - проверить решение глазом нечем`); continue; }
    const want = modeOf({
      products: Number(sig.products), non_listing: Number(sig.non_listing),
      text_median: Number(sig.text_median), service_hits: Number(sig.service_hits)
    }, str(n.marker), re);
    if (counters[str(n.mode)] !== undefined) counters[str(n.mode)]++;
    if (want.mode !== str(n.mode)) {
      V(`tree.${id}.mode`, `режим ${str(n.mode)} не сходится с числами (товаров ${sig.products}, не-листингов ${sig.non_listing}, медиана ${sig.text_median}, сервис ${sig.service_hits}${want.veto ? ", вето сработало" : ""}): по правилу выходит ${want.mode}`);
    }
    if (str(n.mode) === "thin_category" && !CAN(platform.noindex)) {
      W(`tree.${id}`, "тонкая категория закрывается noindex до наполнения, а платформа noindex не умеет");
    }
    if (arr(n.specs).length && arr(n.specs).length < SPECS_MIN) {
      W(`tree.${id}.specs`, `полей карточки ${arr(n.specs).length} при норме от ${SPECS_MIN}: единообразие набора внутри категории важнее формулировок, недостающее запрашивают у заказчика`);
    }
  }
  I(`режимы узлов: catalog ${counters.catalog}, service_like ${counters.service_like} (маршрутизация к site-author, потолок 6 блоков), thin_category ${counters.thin_category}`);
}

// ---------------------------------------------------------------- 6. DERIVED: counts и tier
{
  const c = (data.counts && typeof data.counts === "object") ? data.counts : {};
  const calc = {
    nodes: nodes.length,
    landings: landings.length,
    tier_a: nodes.reduce((s, n) => s + (Number(n && n.tier && n.tier.a) || 0), 0),
    tier_b: nodes.reduce((s, n) => s + (Number(n && n.tier && n.tier.b) || 0), 0),
    tier_c: nodes.reduce((s, n) => s + (Number(n && n.tier && n.tier.c) || 0), 0)
  };
  for (const k of Object.keys(calc)) {
    if (Number(c[k]) !== calc[k]) V(`counts.${k}`, `записано ${c[k]}, пересчитано ${calc[k]} - counts считает скрипт, агент проставлять не вправе`);
  }
  if (Number(c.sku) < calc.tier_a + calc.tier_b + calc.tier_c) {
    V("counts.sku", `позиций ${c.sku}, а по тирам разложено ${calc.tier_a + calc.tier_b + calc.tier_c}: одна карточка посчитана дважды`);
  }
  for (const n of nodes) {
    const t = (n && n.tier) || null;
    if (!t) continue;
    const sum = (Number(t.a) || 0) + (Number(t.b) || 0) + (Number(t.c) || 0);
    if (sum > (Number(n.sku) || 0)) V(`tree.${str(n.id)}.tier`, `по тирам разложено ${sum} карточек при ${Number(n.sku) || 0} позициях узла`);
  }
  if (noFacets && calc.tier_a > 0) V("counts.tier_a", `вердикт ${verdict}: товары идут тирами B и C, писателю по карточкам работы нет, а тир A равен ${calc.tier_a}`);
  // counts.tier_a - КВОТА письма по размеру узлов, а назначает тир A по спросу
  // render-products.mjs. Числа законно расходятся, но расходиться МОЛЧА они не вправе:
  // в ТЗ едет квота, а писать будут по факту.
  const tasksFile = join(dir, "products-tasks.json");
  if (existsSync(tasksFile)) {
    let tasks = null;
    try { tasks = JSON.parse(readFileSync(tasksFile, "utf8").replace(/^﻿/, "")); } catch { tasks = null; }
    if (tasks && Array.isArray(tasks.cards) && tasks.cards.length !== calc.tier_a) {
      W("counts.tier_a", `квота тира A ${calc.tier_a}, а по спросу назначено ${tasks.cards.length} карточек (products-tasks.json): в ТЗ печатаются оба числа, писать будут по второму`);
    }
  }
  if (nodes.length > NODES_MAX) V("tree", `узлов ${nodes.length} при потолке ${NODES_MAX}`);
  if (landings.length > LANDINGS_MAX) V("landings", `посадок ${landings.length} при потолке ${LANDINGS_MAX}`);
}

// ---------------------------------------------------------------- вердикт и анкета
if (!VERDICTS.includes(verdict)) V("verdict", `вердикт «${verdict}» вне закрытого списка: ${VERDICTS.join(", ")}`);
if (verdict === "derivable_from_name" && nodes.some((n) => arr(n && n.facets).length)) {
  W("tree", "вердикт derivable_from_name: значения осей вытащены разбором названий, до публикации их подтверждает заказчик");
}
{
  const unknown = ["facet_url", "multi_select", "range", "meta_override", "canonical", "clean_param", "noindex"].filter((k) => low(platform[k]) === "unknown");
  if (unknown.length) W("platform", `не подтверждено возможностей платформы: ${unknown.join(", ")} - unknown работает как no, и обещанного фасета на них не появится`);
}

// ---------------------------------------------------------------- отчет
if (!quiet) {
  console.log(`[verify-catalog] ${catPath}  (узлов ${nodes.length}, посадок ${landings.length}, позиций ${Number(data.counts && data.counts.sku) || 0}, платформа ${str(platform.kind) || "не названа"})`);
  for (const m of infos) console.log("   i " + m);
  if (warnings.length) { console.log("  предупреждения:"); for (const w of warnings) console.log("   ~ " + w); }
  if (violations.length) { console.log("  НАРУШЕНИЯ (ТЗ каталога не собираем):"); for (const v of violations) console.log("   ! " + v); }
  if (!violations.length && !warnings.length) console.log("  OK - режим чист.");
}
process.exit(violations.length ? 2 : warnings.length ? 1 : 0);
