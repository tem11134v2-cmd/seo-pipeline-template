#!/usr/bin/env node
// plan.mjs
// Состав страницы арифметикой: ШЕСТЬ правил R1-R6 и ни одного седьмого. Седьмое правило
// не пишется даже временно: как только состав начинает решать мнение, страница снова
// становится набором ячеек, которые кто-то заполнит.
//
// Вход: project.json (контракт), pages.json (адреса, pages.mjs), leaders/<кластер>.json
// (замер, recon.mjs parse) и pages.yml (скелеты). Выход: plan.json по contracts-proto.md.
//
// Три вещи, которые тут важнее кода:
//   1. ПЕРВИЧНАЯ ЕДИНИЦА ОБЪЕМА - ЧИСЛО БЛОКОВ. Знаки лидеров лежат рядом справкой и
//      целью не назначаются: цель в знаках и есть машина долива воды.
//   2. ЧЕМ ОТВЕЧАЕМ, ТЕМ И ПИШЕМ. work - отвечаем фактом либо возражением, числа и
//      доказательства на руках; tmpl - материал есть, но не фактом: структура сайта,
//      причины, зоны, границы, и блок идет по своей строке FALLBACK, короче и без числа;
//      stub - отвечать нечем, блок снят, его вопрос уходит заказчику. Плейсхолдера нет.
//   3. ЯДРО НЕ РЕЖЕТСЯ. Блок со знаком ! в skel не снимается никогда: при пустой фактуре
//      он идет по FALLBACK, а не исчезает и не заполняется выдумкой.
//
// Детерминизм обязателен: один и тот же замер дает байт-в-байт тот же plan.json.
// Случайности, обхода множеств без сортировки и чтения часов внутри правил тут нет.
//
// Использование:
//   node plan.mjs [<слаг|каталог>] [--dry] [--json]
//
// Exit: 0 сделано | 2 отказ (нет проекта, нет контракта, нет pages.json, нет pages.yml).

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { today, readPages, arr, str, NUM_UNIT, BLOCK_FN, NEEDS_KINDS } from "./_contract.mjs";
import { repoRoot, findDir } from "./queue.mjs";

const die = (msg) => { console.error("[plan] " + msg); process.exit(2); };

// ---------------------------------------------------------------- константы состава
// Шесть id правил. Тест считает их и валит сборку на седьмом.
export const RULE_IDS = ["R1", "R2", "R3", "R4", "R5", "R6"];

export const COV_CORE = 0.6;   // R1: от этой доли живых лидеров блок уходит в ядро
export const COV_DROP = 0.2;   // R2: до этой доли опциональный блок снимается
export const SEEN_KEEP = 2;    // R2: признак найден у стольких живых лидеров - не снимать
export const BLOCK_CAP = 12;   // R4: потолок блоков на странице при любом замере
export const FN_B_SHARE = 0.5; // R4: доля блоков функции В на странице
export const NO_MATTER = "фактуры нет вовсе"; // причина снятия, которая рождает вопрос заказчику

// vol - вилка числа блоков по типу страницы. Медиана лидеров зажимается в нее, при
// measured false берется середина. Типы каталога сюда не входят: их замер и письмо
// собирает следующий срез, и вилка без замера была бы догадкой.
export const VOL = {
  landing: [8, 12],
  home: [6, 10],
  service: [6, 11],
  info: [3, 7]
};
export const TYPES_NOW = ["landing", "home", "service", "info"];
// Кластер замера по типу страницы. info не меряется никогда: рыночного скелета у
// инфо-страницы нет, ее состав выводится правилом pages.yml из закрытых NEEDS.
export const CLUSTER_OF = { landing: "landing", home: "home", service: "service", info: "" };

// Лестница деградации ответа. Граница и состав не понижаются: ниже них ответа нет.
export const LADDER = { "число": "условие", "условие": "состав", "действие": "состав", "состав": "", "граница": "" };

// Сколько единиц материала требует блок. Это не новое правило, а колонка FALLBACK
// pages.yml числом: «цифр меньше трех - снят», «меньше четырех возражений - снят».
export const MIN = { numbers: 3, nav: 4, edge: 3, qa: 4, reviews: 3, cases: 2, compare: 2, specs: 6 };

// Материал, который есть, но не фактом: структура сайта, причины с доказательством,
// зоны выезда, границы работы, слова клиента. Такой блок пишется режимом шаблона -
// короче и без числа, - а не снимается: выбросить nav с шестью направлениями значит
// выбросить навигацию, а не сэкономить.
// У каждой строки два поля: чем блок закрывается и как этот материал называется словами.
// Одно определение на два скрипта: задание автору печатает ровно тот источник, по
// которому блок остался на странице.
export const STRUCT = {
  hero: { src: "обещание оффера", has: (m) => Boolean(m.promise) },
  nav: { src: "направления сайта", has: (m) => m.dirs >= 4 },
  scope: { src: "состав направления и ассортимент", has: (m) => m.kids >= 3 || m.assort >= 3 },
  fit: { src: "по чему выбирают, choose сегментов", has: (m) => m.choose >= 2 },
  not_fit: { src: "границы работы, offer.limits", has: (m) => m.limits >= 1 },
  problem: { src: "боли сегментов", has: (m) => m.pains >= 3 },
  result: { src: "обещание и причины оффера", has: (m) => Boolean(m.promise) && m.reasons >= 1 },
  edge: { src: "причины с доказательством", has: (m) => m.proofs >= 3 },
  geo: { src: "зоны обслуживания", has: (m) => m.geo >= 1 },
  reviews: { src: "слова клиентов с src forum либо client", has: (m) => m.quotes >= 3 },
  cta_mid: { src: "главное действие оффера", has: (m) => Boolean(m.cta) },
  cta_form: { src: "главное действие оффера", has: (m) => Boolean(m.cta) }
};

const uniq = (xs) => [...new Set(xs)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const isNum = (f) => NUM_UNIT.test(str(f.value));

// ---------------------------------------------------------------- материал страницы
// Сегменты, которые обслуживает страница. Привязки нет вовсе - страницу обслуживают все
// сегменты: у главной и лендинга иначе и не бывает.
function servingSegments(project, page) {
  const segs = arr((project.audience || {}).segments);
  const dir = str(page.dir);
  if (!dir) return segs.map((s, i) => ({ s, i }));
  const hit = segs.map((s, i) => ({ s, i })).filter(({ s }) => arr(s.dirs).includes(dir));
  return hit.length ? hit : segs.map((s, i) => ({ s, i }));
}

export function siteMaterial(project, page) {
  const b = project.business || {}, o = project.offer || {};
  const dirs = arr(b.directions);
  const segs = servingSegments(project, page);
  const objs = [];
  let pains = 0;
  for (const { s, i } of segs) {
    pains += arr(s.pain).length;
    arr(s.objection).forEach((_, j) => objs.push(`o${i + 1}.${j + 1}`));
  }
  const choose = segs.reduce((n, { s }) => n + arr(s.choose).length, 0);
  return {
    objs,
    pains,
    choose,
    dirs: dirs.filter((d) => !str(d.parent)).length,
    kids: dirs.filter((d) => str(d.parent) === str(page.dir)).length,
    assort: arr(b.assortment).length,
    geo: arr(b.geo).length,
    limits: arr(o.limits).length,
    reasons: arr(o.reasons).length,
    proofs: arr(o.reasons).filter((r) => str(r.proof)).length,
    quotes: arr((project.audience || {}).words).filter((w) => ["forum", "client"].includes(str(w.src))).length,
    promise: str((o.promise || {}).result),
    cta: str((o.promise || {}).cta)
  };
}

// Чем отвечает конкретный блок. Строго по facts[].q: факт про лицензию не аргумент в
// блоке про цену. Сводные блоки hero и numbers добирают числа из общей базы, но ТОЛЬКО
// когда своих не хватило до нормы: иначе первый экран каждой страницы отвечает всей
// фактурой сразу, и страницы перестают отличаться друг от друга.
export const SUMMARY = ["hero", "numbers"];
function blockMaterial(st, id, min = MIN[id] || 1) {
  const linked = st.pub.filter((f) => arr(f.q).includes(id));
  let facts = linked;
  if (SUMMARY.includes(id) && linked.length < min) {
    facts = uniq(linked.concat(st.pub).map((f) => str(f.id))).map((fid) => st.byId.get(fid)).slice(0, min);
  }
  const objs = st.fn.get(id) === "В" ? st.site.objs : [];
  return { facts, nums: facts.filter(isNum), objs };
}

// Закрыт ли ответ этого типа тем, что есть на руках.
function closedBy(kind, m, min) {
  if (kind === "число" || kind === "действие") return m.nums.length >= min;
  if (kind === "граница") return m.facts.length >= min;
  return m.facts.length + m.objs.length >= min; // условие и состав
}

// Маркеры ответа: только fNN и oN.M. Пусто при work быть не может - это и есть разница
// между «отвечаем фактом» и «пишем по шаблону».
function markers(kind, m, min) {
  const f = (kind === "число" || kind === "действие" ? m.nums : m.facts).map((x) => str(x.id));
  return uniq(f.concat(m.objs)).slice(0, Math.min(Math.max(min, 2) + 2, 6));
}

// ---------------------------------------------------------------- стартовый состав
// Скелет типа, must_have разведки и признаки ниши. Это ВХОД правил, а не правило:
// признак ниши говорит, что блок на странице обязан быть, а состав решают шесть правил.
export const SIG_CORE = { price_open: ["price"], visit: ["steps", "geo"], licensed: ["docs"], geo_bound: ["geo"], urgent: ["steps"] };
export const SIG_ADD = { long_cycle: ["cases", "docs"], b2b: ["delivery"] };
// Аварийная ниша: выбирают за час. Скелет тот же, но страница короче - потолок вилки
// опускается на два блока, а срок работы обязателен. Признак, объявленный в pages.yml и
// ничего не меняющий в составе, - правило в реестре без реализации.
export const SIG_SHORT = { urgent: 2 };

function startComposition(st) {
  const add = (id, core) => {
    if (!id) return;
    if (!st.yml.blocks.has(id)) { st.warn.push(`${st.page.url}: блока ${id} нет в pages.yml, пропущен`); return; }
    if (!st.fn.has(id)) return; // строка без буквы функции - блок в план не попадает
    if (st.catalogOnly.includes(id)) return;
    if (!st.base.includes(id)) st.base.push(id);
    if (core) st.core.add(id);
  };

  if (st.type === "info") {
    // Инфо-страница живет ПРАВИЛОМ, а не рецептом: блок ставится, если его NEEDS закрыт
    // опубликованным фактом, порядок - как в blocks. Меньше трех блоков - страницы нет.
    for (const id of st.yml.blocks.keys()) {
      if (!st.fn.has(id)) continue;
      const m = blockMaterial(st, id);
      if (closedBy(st.needs.get(id), m, MIN[id] || 1)) add(id, false);
    }
    return;
  }

  const skel = str(st.yml.skel.get(st.type));
  for (const w of skel.split(/\s+/).filter(Boolean)) {
    const core = w.endsWith("!");
    add(core ? w.slice(0, -1) : w, core);
  }
  for (const id of arr(((st.project.competitors || {}).market || {}).must_have)) add(str(id), false);
  const sig = arr((st.project.business || {}).sig);
  for (const s of sig) for (const id of SIG_CORE[s] || []) add(id, true);
  for (const s of sig) for (const id of SIG_ADD[s] || []) add(id, false);
}

// ---------------------------------------------------------------- шесть правил
// Правило читает и меняет одно состояние st. Порядок - как в законе: снятие назначает
// R2, вето накладывает R3, и поменять их местами значит поставить рынок выше ядра.
export const RULES = [
  {
    id: "R1",
    name: "покрытие от 0.6 - блок в ядро, даже если в pages.yml он опционален",
    apply(st) {
      if (!st.measured) return;
      for (const [id, v] of Object.entries(st.cov).sort((a, b) => a[0].localeCompare(b[0]))) {
        if (v < COV_CORE) continue;
        if (!st.fn.has(id) || st.catalogOnly.includes(id)) continue;
        if (!st.base.includes(id)) {
          // Лендинг: замер только подтверждает скелет. Блоки лендингов однородны, и
          // добирать состав с рынка тут нечего.
          if (st.kind === "landing") continue;
          st.base.push(id);
          st.grew.push(id);
        }
        st.core.add(id);
      }
    }
  },
  {
    id: "R2",
    name: "покрытие до 0.2 и блок опционален - снять; признак у двух живых лидеров - демотировать",
    apply(st) {
      if (!st.measured || st.kind === "landing") return;
      for (const id of st.base) {
        if (st.core.has(id)) continue;
        const cov = st.cov[id] || 0;
        if (cov > COV_DROP) continue;
        if ((st.seen[id] || 0) >= SEEN_KEEP) { st.demote.add(id); continue; }
        st.cut.set(id, cov > 0 ? `у лидеров покрытие ${cov}` : "у лидеров не встречается");
      }
    }
  },
  {
    id: "R3",
    name: "ядро не снимается; блок без рынка остается отстройкой, таких максимум один",
    apply(st) {
      for (const id of [...st.cut.keys()]) if (st.core.has(id)) st.cut.delete(id);
      const rank = (id) => { const m = blockMaterial(st, id); return m.facts.length + m.objs.length; };
      const off = [...st.cut.keys()].filter((id) => !(st.cov[id] > 0) && rank(id) > 0);
      if (off.length) {
        // Отстройка без материала - не отстройка, а дырка: рынку мы там ничего не
        // противопоставляем. Поэтому кандидат без единого факта и возражения не спасается.
        const keep = off.slice().sort((a, b) => rank(b) - rank(a) || st.base.indexOf(a) - st.base.indexOf(b))[0];
        st.cut.delete(keep);
        st.off = keep;
      }
      st.base = st.base.filter((id) => !st.cut.has(id));
    }
  },
  {
    id: "R4",
    name: "объем - число блоков: медиана живых лидеров в вилке vol, потолок 12; блоков функции В не больше половины",
    apply(st) {
      const [lo, hi0] = VOL[st.type] || VOL.service;
      const cutBy = arr((st.project.business || {}).sig).reduce((n, x) => n + (SIG_SHORT[x] || 0), 0);
      const hi = Math.max(lo, hi0 - cutBy);
      const raw = st.measured ? clamp(st.lead.blocks_median, lo, hi) : Math.round((lo + hi) / 2);
      // Демотированные R2 блоки считаются в неснимаемом остатке наравне с ядром и
      // отстройкой. Иначе бюджет отменял бы запрет предыдущего правила: у блока, который
      // R2 спас, покрытие по определению низкое, и в очереди на рез он стоял бы первым.
      const held = [...st.demote].filter((id) => st.base.includes(id)).length;
      const keep = st.core.size + (st.off ? 1 : 0) + held;
      st.bud = Math.min(BLOCK_CAP, Math.max(raw, keep));

      // Режем с хвоста: сперва то, чего рынок почти не показывает, при равном покрытии -
      // то, что стоит позже в pages.yml. Ядро не трогаем ни на каком шаге, отстройку - тоже:
      // снять ее по бюджету значит отменить R3 следующим правилом.
      // Материал считается по НАЛИЧИЮ, а не по количеству: блок, которому отвечать нечем,
      // уходит первым, а дальше решает место в pages.yml. Сравнение по числу фактов
      // выбрасывало бы первый экран с одним фактом раньше, чем блок возражений с пятью.
      const dead = (id) => { const m = blockMaterial(st, id); return m.facts.length + m.objs.length ? 1 : 0; };
      const rank = (list) => list
        .sort((a, b) => (st.cov[a] || 0) - (st.cov[b] || 0) || dead(a) - dead(b) || st.base.indexOf(b) - st.base.indexOf(a))[0];
      // Демотированные уходят в конец очереди на рез: сперва все, что R2 не спасал, и
      // только если бюджет все равно не сходится - спасенное, с названным конфликтом.
      const worst = (only) => {
        const fits = (id) => !st.core.has(id) && id !== st.off && (!only || only(id));
        const free = st.base.filter((id) => fits(id) && !st.demote.has(id));
        return free.length ? rank(free) : rank(st.base.filter(fits));
      };
      const drop = (id, why) => { st.cut.set(id, why); st.base = st.base.filter((x) => x !== id); };

      while (st.base.length > st.bud) {
        const id = worst(null);
        if (!id) break;
        drop(id, st.demote.has(id)
          ? `бюджет страницы ${st.bud} блоков перевесил защиту R2`
          : `бюджет страницы ${st.bud} блоков`);
      }

      // Арифметика функций: страница, добитая возражениями, обороняется вместо того,
      // чтобы отвечать. Доля блоков с Ф=В не больше половины.
      const isB = (id) => st.fn.get(id) === "В";
      while (st.base.length && st.base.filter(isB).length > Math.floor(st.base.length * FN_B_SHARE)) {
        const id = worst(isB);
        if (!id) break;
        drop(id, "блоков функции В больше половины страницы");
      }
      st.demote = new Set([...st.demote].filter((id) => st.base.includes(id)));
    }
  },
  {
    id: "R5",
    name: "порядок - медианный ранг у лидеров; блоки вне замера встают на место из pages.yml",
    apply(st) {
      const skel = st.base.slice();
      const mkt = arr(st.lead && st.lead.order).filter((id) => skel.includes(id));
      if (!st.measured || !mkt.length) { st.order = skel; return; }
      const after = new Map(), head = [];
      for (const id of skel) {
        if (mkt.includes(id)) continue;
        let anchor = "";
        for (let j = skel.indexOf(id) - 1; j >= 0; j--) if (mkt.includes(skel[j])) { anchor = skel[j]; break; }
        if (!anchor) head.push(id);
        else after.set(anchor, (after.get(anchor) || []).concat(id));
      }
      const out = head.slice();
      for (const id of mkt) { out.push(id); out.push(...(after.get(id) || [])); }
      st.order = out;
    }
  },
  {
    id: "R6",
    name: "деградация: число - условие - состав, действие - состав; затем режим шаблона; затем снятие",
    apply(st) {
      for (const id of st.order) {
        const min = MIN[id] || 1;
        const m = blockMaterial(st, id);
        let kind = st.needs.get(id);
        while (kind && !closedBy(kind, m, min)) kind = LADDER[kind];
        if (kind && !st.demote.has(id)) {
          st.needs.set(id, kind);
          st.mode.set(id, "work");
          st.ans.set(id, markers(kind, m, min));
          continue;
        }
        // Ответа фактом нет либо рынок показывает блок краем. Материал структурой -
        // режим шаблона; ядро - тоже шаблон, блок со знаком ! не снимается никогда;
        // иначе снятие и строка в вопросы заказчику.
        st.needs.set(id, bottom(st.needs.get(id)));
        const struct = STRUCT[id] ? STRUCT[id].has(st.site) : false;
        const keep = kind || struct || st.core.has(id);
        st.mode.set(id, keep ? "tmpl" : "stub");
        st.ans.set(id, []);
        if (!keep) st.cut.set(id, NO_MATTER);
      }
      st.order = st.order.filter((id) => st.mode.get(id) !== "stub");
    }
  }
];

const bottom = (kind) => { let k = kind; while (LADDER[k]) k = LADDER[k]; return k; };

// Седьмое правило не заводится даже на час: сборка падает на импорте, а не на ревью.
// Новое правило вносится ТОЛЬКО вместо старого, вместе с его id в RULE_IDS.
if (RULES.length !== RULE_IDS.length || RULES.some((r, i) => r.id !== RULE_IDS[i])) {
  throw new Error(`[plan] правил состава ${RULES.length} против ${RULE_IDS.length} заявленных: новое правило вносится только вместо старого`);
}

// ---------------------------------------------------------------- план страницы
export function planPage(project, page, lead, yml, kind, catalogOnly) {
  const pub = arr(project.facts).filter((f) => str(f.publish) === "yes");
  const st = {
    project, page, yml, kind, lead, catalogOnly,
    type: str(page.type),
    pub,
    byId: new Map(pub.map((f) => [str(f.id), f])),
    site: siteMaterial(project, page),
    measured: Boolean(lead && lead.measured),
    cov: (lead && lead.cov) || {},
    seen: {},
    fn: new Map(), needs: new Map(),
    base: [], core: new Set(), cut: new Map(), demote: new Set(),
    order: [], mode: new Map(), ans: new Map(),
    grew: [], off: "", bud: 0, warn: []
  };
  for (const [id, row] of yml.blocks) {
    if (!BLOCK_FN.includes(str(row[0]))) { st.warn.push(`блок ${id}: нет буквы функции, в план не попадает`); continue; }
    if (!NEEDS_KINDS.includes(str(row[5]))) { st.warn.push(`блок ${id}: NEEDS «${str(row[5])}» вне закрытого списка, в план не попадает`); continue; }
    st.fn.set(id, str(row[0]));
    st.needs.set(id, str(row[5]));
  }
  for (const p of arr(lead && lead.pages)) for (const id of arr(p.blocks)) st.seen[id] = (st.seen[id] || 0) + 1;

  startComposition(st);
  // Место блока по умолчанию - строка pages.yml. Скелет типа решает, кто на странице
  // стоит и кто из них ядро, а очередность блоков описана одним списком blocks, и
  // второго порядка в контракте нет. Медианный ранг лидеров накладывается сверху в R5.
  const decl = [...yml.blocks.keys()];
  st.base.sort((a, b) => decl.indexOf(a) - decl.indexOf(b));
  for (const r of RULES) r.apply(st);

  const blocks = st.order.map((id, i) => ({
    id, ord: i + 1, mode: st.mode.get(id), needs: st.needs.get(id), answers_with: st.ans.get(id) || []
  }));
  for (const id of [...st.cut.keys()].sort()) {
    if (blocks.some((b) => b.id === id)) continue;
    const why = str(st.cut.get(id));
    blocks.push({
      id, ord: 0, mode: "stub", needs: st.needs.get(id) || "", answers_with: [],
      cut: why, ask: why === NO_MATTER ? askText(project, st, id) : ""
    });
  }
  return {
    out: {
      page: { slug: str(page.slug), type: st.type, marker: str(page.marker), url: str(page.url) },
      bud: st.bud, measured: st.measured, cluster: str(CLUSTER_OF[st.type] || ""),
      blocks
    },
    st
  };
}

// ---------------------------------------------------------------- сборка проекта
export const CATALOG_ONLY = ["cat_intro", "listing", "subcats", "cat_text", "gallery", "specs", "product_desc", "related"];

function loadJson(f) {
  if (!existsSync(f)) return null;
  try { return JSON.parse(readFileSync(f, "utf8")); } catch { return null; }
}

export function buildPlan(dir, root) {
  const project = loadJson(join(dir, "project.json"));
  if (!project) die(`нет ${join(dir, "project.json")} - состав страницы выводится из контракта, а не из догадки`);
  const pagesJson = loadJson(join(dir, "pages.json"));
  if (!pagesJson) die("нет pages.json - сначала node .claude/scripts/site/pages.mjs <каталог>");
  const yml = readPages(join(root, ".claude/skills/site-proto/pages.yml"));
  if (!yml) die("нет pages.yml - скелетам страниц неоткуда взяться");

  const kind = str((project.business || {}).site_kind) || "multipage";
  const leads = new Map();
  const leadOf = (type) => {
    const c = CLUSTER_OF[type] || "";
    if (!c) return null;
    if (!leads.has(c)) leads.set(c, loadJson(join(dir, "leaders", c + ".json")));
    return leads.get(c);
  };

  const pages = [], later = [], warn = [], report = [];
  for (const page of arr(pagesJson.pages)) {
    const type = str(page.type);
    if (!TYPES_NOW.includes(type)) { later.push({ url: str(page.url), type }); continue; }
    const { out, st } = planPage(project, page, leadOf(type), yml, kind, CATALOG_ONLY);
    warn.push(...st.warn);
    if (type === "info" && out.blocks.filter((b) => b.ord).length < VOL.info[0]) {
      warn.push(`${str(page.url)}: закрытых блоков меньше ${VOL.info[0]}, инфо-страницы нет - правило pages.yml, а не сбой`);
      continue;
    }
    pages.push(out);
    report.push({ page, out, st });
  }
  return {
    plan: { v: 1, slug: str(project.slug), at: today(), site_kind: kind, pages, later, warnings: uniq(warn) },
    report, yml, project
  };
}

// Пересечения двух страниц тут НЕ ищутся. База фактов у сайта одна, и на плане все
// страницы услуг честно отвечают одними и теми же фактами; «одна мысль разными словами»
// ловится по написанным closes: на шаге проверки страницы, а не по плану, иначе
// предупреждение горит на каждом проекте и его перестают читать.

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

// Вопрос заказчику, рожденный снятым блоком. Он же уходит в plan.json: иначе вопрос,
// ради которого блок сняли, живет только в консоли и умирает вместе с окном терминала,
// а третий исход пустой фактуры («всплывет, когда фактура появится») не наступает никогда.
function askText(project, st, id) {
  const gap = arr(project.gaps).find((g) => arr(g.hits).includes(id));
  if (gap) return str(gap.ask);
  const row = st.yml.blocks.get(id);
  return row ? str(row[1]) : id;
}
function askLine(project, st, id) {
  const gap = arr(project.gaps).find((g) => arr(g.hits).includes(id));
  return `вопрос заказчику${gap ? " " + str(gap.id) : ""}: ${askText(project, st, id)}`;
}

function main() {
  const { flags, pos } = parseArgs(process.argv.slice(2));
  const root = flags.root && flags.root !== true ? resolve(String(flags.root)) : repoRoot();
  const dir = findDir(pos[0], root);
  if (!dir) die("проект не найден - сначала queue.mjs init <slug>");
  const { plan, report, project } = buildPlan(dir, root);

  if (flags.json) { console.log(JSON.stringify(plan, null, 2)); return 0; }
  if (!flags.dry) writeFileSync(join(dir, "plan.json"), JSON.stringify(plan, null, 2) + "\n", "utf8");

  console.log(`[plan] ${dir}`);
  console.log(`  тип сайта ${plan.site_kind} | страниц ${plan.pages.length} | правил состава ${RULES.length}`);
  for (const { out, st } of report) {
    const lead = st.lead;
    const meas = st.measured
      ? `померено на ${lead.alive} из ${lead.attempted}, медиана ${lead.blocks_median} блоков`
      : (lead
        ? `померено на ${lead.alive} из ${lead.attempted} - живых меньше трех, R1 и R2 не применяются, объем по середине вилки`
        : "замера нет, объем по середине вилки, R1 и R2 не применяются");
    console.log(`  ${out.page.url} (${out.page.type}) | блоков ${out.blocks.filter((b) => b.ord).length} из бюджета ${out.bud} | ${meas}`);
    for (const b of out.blocks.filter((x) => x.ord)) {
      console.log(`    ${String(b.ord).padStart(2)} ${b.id.padEnd(14)} ${b.mode.padEnd(5)} ${b.needs.padEnd(9)} ${b.answers_with.join(",") || "-"}`);
    }
    for (const b of out.blocks.filter((x) => !x.ord)) {
      const why = st.cut.get(b.id) || "-";
      // Вопрос уходит заказчику только там, где блок снят БЕЗ ФАКТУРЫ. Снятый рынком или
      // бюджетом блок вопроса не рождает: заказчику нечего спрашивать про то, чего рынок
      // не делает.
      const ask = why === NO_MATTER ? "; " + askLine(project, st, b.id) : "";
      console.log(`     - ${b.id.padEnd(14)} снят: ${why}${ask}`);
    }
    if (st.grew.length) console.log(`     рынок добавил: ${st.grew.join(", ")}`);
    if (st.off && out.blocks.some((b) => b.ord && b.id === st.off)) {
      console.log(`     отстройка (у лидеров нет, оставлен один): ${st.off}`);
    }
  }
  if (plan.later.length) {
    console.log(`  за границей среза: ${uniq(plan.later.map((l) => l.type)).join(", ")} - каталог и товары планирует следующий срез`);
  }
  for (const w of plan.warnings) console.log(`  ВНИМАНИЕ: ${w}`);
  if (!flags.dry) {
    console.log(`  записано: ${join(dir, "plan.json")}`);
    console.log("  дальше: node .claude/scripts/site/build-tasks.mjs " + dir);
  }
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) main();
