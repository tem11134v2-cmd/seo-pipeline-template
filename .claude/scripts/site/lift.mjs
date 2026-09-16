#!/usr/bin/env node
// lift.mjs
// Адресный список усиления страницы. 0 токенов: считает машина, добавляет агент.
//
// Это вторая половина симметрии качества. В v7 после писателя стояли три контролера, и
// все трое умели ровно одну операцию - РЕЗАТЬ. Правило «недобор от твоего же реза -
// правильный исход» делало усыхание законным, и шага, который делает текст СИЛЬНЕЕ, не
// было ни одного дня. lift.mjs - вход в такой шаг: он называет, ЧТО добавить и КУДА, и
// ни в одной своей строке не умеет предложить сокращение.
//
// Четыре вещи, которые тут важнее кода:
//   1. МАРКЕР, А НЕ ГРЕП. Список строится по разметке: id факта в closes:, id возражения,
//      блок плана, метка q:. Греп по значению - ВТОРИЧНЫЙ сигнал, и работы он не рождает,
//      а снимает: найденное в тексте значение переводит строку в предупреждение «факт
//      упомянут, но не помечен». Иначе усиление начнет спорить с формулировкой, а спор о
//      формулировке - это вкус, и у него нет конца.
//   2. ПУСТОЙ СПИСОК - НОРМАЛЬНЫЙ ИСХОД. Страница без строк не вызывает агента вовсе:
//      ноль токенов и ноль объяснений. Шаг, который обязан что-то сказать, всегда
//      что-нибудь скажет, и это «что-нибудь» потом кто-то правит.
//   3. ДОБАВИТЬ, А НЕ ЗАМЕНИТЬ. Действий ровно ЧЕТЫРЕ, и все четыре на добавление.
//      Потолок +10% к объему страницы посчитан и стоит рядом со строками: усиление не
//      превращается в переписывание.
//   4. ЧИСЕЛ ЛИДЕРОВ ТУТ НЕТ. В строку усиления уходит только ФОРМА блока у рынка
//      («таблица 3 строк») и порядок блоков. Цифра конкурента ядовита на этом шаге ровно
//      так же, как на шаге письма.
//
// Формат lift.json (в contracts-proto.md его нет: тот файл - этап 2, и он чужой):
//   {"v":1,"slug":"...","at":"2026-09-16","acts":{...},"pages":[{
//     "slug":"...","url":"/...","type":"service","chars":4200,"cap":420,"empty":false,
//     "lead":{"cluster":"service","measured":true,"order":["hero","scope"]},
//     "items":[{"id":"fact_open","act":"land","block":"hero","q":"Куда я попал...",
//               "line":7,"mark":"f03","use":"гарантия - 7 лет","form":"плашки",
//               "msg":"..."}],
//     "warn":[{"id":"fact_unmarked","block":"price","line":31,"mark":"f05","msg":"..."}]}],
//    "site":[{"id":"fact_open","mark":"f09","msg":"..."}]}
//
// Использование:
//   node lift.mjs [<слаг|каталог>] [--json] [--dry] [--root <репо>]
// Exit: 0 усиливать нечего | 1 список непуст, зовут site-strengthener | 2 считать нечем.

import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { today, arr, str, readPages, NUM_UNIT, pageName } from "./_contract.mjs";
import { repoRoot, findDir, plain } from "./queue.mjs";
import { parsePage } from "./verify-page.mjs";

const die = (msg) => { console.error("[lift] " + msg); process.exit(2); };
const loadJson = (f) => { try { return existsSync(f) ? JSON.parse(readFileSync(f, "utf8").replace(/^﻿/, "")) : null; } catch { return null; } };
const chars = (s) => Array.from(String(s == null ? "" : s)).length;

// ---------------------------------------------------------------- закрытый список действий
// Четыре действия и ни одного пятого. Пятым всегда просится «убрать лишнее», и именно с
// него начинается усыхание: роль без операции «резать» существует ровно до тех пор, пока
// этот объект состоит из четырех ключей.
export const ACTS = {
  hero: "поднять первый экран: обещание, а не название раздела",
  land: "приземлить обещание цифрой или именем из фактов",
  proof: "подставить доказательство-артефакт",
  rewrite: "переписать блок, который не меняет состояние читателя"
};
export const ACT_ORDER = ["hero", "land", "proof", "rewrite"];

export const CAP_SHARE = 0.1;   // потолок прибавки к объему страницы
export const ITEMS_MAX = 8;     // строк на страницу: список длиннее перестает быть адресным
export const CLAIM_HIT = 0.6;   // доля слов причины, при которой она считается прозвучавшей
export const VALUE_HIT = 0.6;   // то же для значения факта без числа
export const NEAR_HIT = 0.4;    // при совпавшем числе от значения хватает и трети слов

// ---------------------------------------------------------------- шесть маркеров
// Ровно те шесть, что названы законом. Седьмой не добавляется даже временно: список
// усиления держится на разметке, а каждый маркер вне разметки - это возврат к спору о
// формулировке, который в v7 и заменял собой работу.
export const MARKER_IDS = ["fact_open", "obj_open", "claim_off", "hero_flat", "q_zero", "query_off"];
export const MARKERS = [
  { id: "fact_open", acts: ["land"], what: "факт publish yes не стоит ни в одном closes: по сайту" },
  { id: "obj_open", acts: ["rewrite"], what: "objection.answer сегмента не отражен на его странице" },
  { id: "claim_off", acts: ["land", "proof"], what: "reasons[].claim не звучит в тексте нигде" },
  { id: "hero_flat", acts: ["hero"], what: "первый экран без числа при непустых фактах" },
  { id: "q_zero", acts: ["proof"], what: "вопрос раздела с нулевым покрытием" },
  { id: "query_off", acts: ["rewrite"], what: "запрос страницы не встречается в тексте ни разу" }
];
export const WARN_ID = "fact_unmarked";

if (MARKERS.length !== MARKER_IDS.length || MARKERS.some((m, i) => m.id !== MARKER_IDS[i])) {
  throw new Error(`[lift] маркеров ${MARKERS.length} против ${MARKER_IDS.length} заявленных: новый маркер вносится только вместо старого`);
}
if (ACT_ORDER.length !== Object.keys(ACTS).length || ACT_ORDER.some((a) => !ACTS[a])) {
  throw new Error("[lift] действий не четыре: список закрыт, и все четыре на добавление");
}
for (const m of MARKERS) for (const a of m.acts) {
  if (!ACTS[a]) throw new Error(`[lift] маркер ${m.id} зовет действие ${a}, которого нет в закрытом списке`);
}

// Блоки, которым доказательство не нужно по природе: кнопка, навигация и листинг ничего
// не утверждают о мире, и требовать от них артефакт значит наливать воду в переход.
const NO_PROOF = ["cta_mid", "cta_form", "nav", "listing", "related", "subcats", "gallery"];
const PROOF_KINDS = ["документ", "кейс", "отзыв", "гарантия"];

// ---------------------------------------------------------------- слова и числа
// Сравнение грубое и нарочно одинаковое с обеих сторон: обрезка до пяти букв ловит падеж
// и число («гарантия» и «гарантии» дают «гаран»), а тонкая морфология тут не нужна -
// вторичный сигнал не должен быть умнее первичного.
const STOP = new Set(["для", "под", "при", "или", "как", "что", "это", "все", "его", "они", "там", "так", "уже", "над", "из", "от", "до", "по", "на", "в", "с", "и", "а", "но", "же", "ли", "не", "ни", "то", "мы", "вы", "он", "она", "оно", "наш", "ваш", "без", "про", "том", "тем", "их", "ее", "мой"]);
const PREFIX = 5;
const wordsOf = (s) => plain(s).toLowerCase().replace(/[^а-яa-z0-9]+/gi, " ").split(" ").filter(Boolean);
const stem = (w) => (w.length > PREFIX ? w.slice(0, PREFIX) : w);
const stemsOf = (s) => new Set(wordsOf(s).filter((w) => w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w)).map(stem));
const share = (need, have) => { const n = [...need]; return n.length ? n.filter((w) => have.has(w)).length / n.length : 1; };
const digitsOf = (s) => [...String(s == null ? "" : s).matchAll(/\d[\d  .,]*\d|\d/g)].map((m) => m[0].replace(/[  .,]/g, "")).filter(Boolean);
const digitLine = (s) => " " + String(s == null ? "" : s).replace(/[  .,](?=\d)/g, "").replace(/[^\d]+/g, " ").trim() + " ";

// Факт «упомянут»: число факта стоит в тексте и рядом хоть часть его слов, а без числа -
// больше половины слов значения. Это единственное место, где lift смотрит на значение, и
// смотрит он ради того, чтобы СНЯТЬ работу, а не назначить.
function factSeen(f, pg) {
  const val = str(f.value), lab = str(f.label);
  if (!val && !lab) return false;
  const nums = digitsOf(val);
  const need = stemsOf(val + " " + lab);
  if (nums.length) return nums.every((d) => pg.digits.includes(" " + d + " ")) && share(need, pg.stems) >= NEAR_HIT;
  return share(need, pg.stems) >= VALUE_HIT;
}

// ---------------------------------------------------------------- разбор страниц
// Разбор страницы берется у verify-page: парсер на два скрипта ровно один. Два парсера
// рано или поздно разойдутся в том, где кончается раздел, и тогда усиление будет
// добавлять ответ не туда, куда показывает отказ.
function readSite(dir, root) {
  const project = loadJson(join(dir, "project.json"));
  if (!project) die(`нет ${join(dir, "project.json")} - усиливать нечем: материал берется из контракта`);
  const plan = loadJson(join(dir, "plan.json"));
  if (!plan) die("нет plan.json - у строки усиления не будет адреса блока; сначала node .claude/scripts/site/plan.mjs");
  const yml = readPages(join(root, ".claude/skills/site-proto/pages.yml"));
  if (!yml) die("нет pages.yml - вопросы читателя и функции блоков берутся оттуда");
  const pdir = join(dir, "pages");
  if (!existsSync(pdir)) die(`нет ${pdir} - страницы еще не написаны, усиливать нечего`);
  const files = readdirSync(pdir).filter((n) => n.endsWith(".md")).sort();
  if (!files.length) die("в pages/ нет ни одной страницы");

  const pagesJson = loadJson(join(dir, "pages.json"));
  const dirOf = new Map(arr(pagesJson && pagesJson.pages).map((p) => [str(p.slug) || "index", str(p.dir)]));
  // Имя страницы считает pageName: у главной и лендинга слаг пуст, а файл зовется index.
  const planOf = new Map();
  const takenPlan = new Set();
  for (const p of arr(plan.pages)) planOf.set(pageName(p.page, takenPlan), p);

  const leaders = new Map();
  const leadOf = (cluster) => {
    if (!cluster) return null;
    if (!leaders.has(cluster)) leaders.set(cluster, loadJson(join(dir, "leaders", cluster + ".json")));
    return leaders.get(cluster);
  };

  const pages = files.map((name) => {
    const P = parsePage(join(pdir, name));
    const pl = planOf.get(P.slug) || null;
    const blocks = pl ? arr(pl.blocks) : [];
    const active = blocks.filter((b) => b.ord).sort((a, z) => a.ord - z.ord);
    const order = active.map((b) => str(b.id));
    // Метка, если ее знает pages.yml; иначе позиционное место по действующему составу -
    // тот же закон, что и в verify-page: опечатка в разметке не валит хороший текст.
    P.sections.forEach((s, i) => {
      s.known = Boolean(s.qid && yml.blocks.has(s.qid));
      s.id = s.known ? s.qid : (order[i] || "");
    });
    const body = [P.h1, ...P.sections.map((s) => s.text)].join("\n");
    const lead = leadOf(str(pl && pl.cluster));
    return {
      slug: P.slug, file: join(pdir, name), P, plan: pl, blocks, active, order,
      url: str(pl && pl.page && pl.page.url) || "/" + P.slug + "/",
      type: str(pl && pl.page && pl.page.type),
      marker: str(pl && pl.page && pl.page.marker),
      dir: dirOf.get(P.slug) || "",
      closes: new Set(P.sections.flatMap((s) => s.closes)),
      secById: new Map(P.sections.filter((s) => s.id).map((s) => [s.id, s])),
      text: body, stems: stemsOf(body), digits: digitLine(body),
      chars: chars(body.replace(/\s+/g, " ").trim()),
      lead, items: [], warn: []
    };
  });
  return { project, plan, yml, pages };
}

// ---------------------------------------------------------------- адрес строки
// Строка усиления без адреса - это мнение. Блок ищется в таком порядке: раздел с этой
// меткой на странице, действующий блок плана, первый раздел страницы.
const qOf = (yml, id) => (id && yml.blocks.has(id) ? str((yml.blocks.get(id) || [])[1]) : "");
const fnOf = (yml, id) => (id && yml.blocks.has(id) ? str((yml.blocks.get(id) || [])[0]) : "");
const formOf = (pg, id) => {
  if (!pg.lead || !pg.lead.measured) return "замера нет";
  return plain((pg.lead.form || {})[id]) || "форма не снята";
};

function where(pg, ids, yml) {
  for (const id of ids) {
    const s = pg.secById.get(id);
    if (s) return { block: id, line: s.line, q: qOf(yml, id) };
  }
  for (const id of ids) {
    if (pg.order.includes(id)) return { block: id, line: pg.P.h1Line || 1, q: qOf(yml, id) };
  }
  const first = pg.P.sections[0];
  const id = first ? str(first.id) : str((pg.active[0] || {}).id);
  return { block: id || "страница", line: first ? first.line : (pg.P.h1Line || 1), q: qOf(yml, id) };
}

function item(pg, yml, { id, act, ids, mark, use, msg }) {
  const w = where(pg, arr(ids).filter(Boolean), yml);
  pg.items.push({ id, act, block: w.block, q: w.q, line: w.line, mark: str(mark), use: plain(use), form: formOf(pg, w.block), msg: plain(msg) });
}

// ---------------------------------------------------------------- маркеры
// fact_open: факт к публикации не приземлен НИГДЕ на сайте. Хозяин строки - страница,
// которой этот факт поручен планом; если планом никому, то та, у которой стоит блок из
// facts[].q. Не нашлось и такой - строка уходит в site и агента не зовет: усиливать
// некому, это вопрос состава, а не текста.
function markFacts(S, out) {
  const pub = arr(S.project.facts).filter((f) => str(f.publish) === "yes");
  const closedAnywhere = new Set(S.pages.flatMap((p) => [...p.closes]));
  for (const f of pub.slice().sort((a, z) => str(a.id).localeCompare(str(z.id)))) {
    const fid = str(f.id);
    if (!fid || closedAnywhere.has(fid)) continue;
    const planned = S.pages.filter((p) => p.active.some((b) => arr(b.answers_with).includes(fid)));
    const wanted = S.pages.filter((p) => p.order.some((id) => arr(f.q).includes(id)));
    const host = planned[0] || wanted[0] || null;
    const use = `${str(f.label)} - ${str(f.value)}` + (str(f.artifact) ? ` (артефакт: ${str(f.artifact)})` : "");
    if (!host) {
      out.site.push({ id: "fact_open", mark: fid, msg: plain(`${use}: факт не приземлен ни на одной странице и планом никому не поручен - это состав, а не текст`) });
      continue;
    }
    const ids = [
      ...host.active.filter((b) => arr(b.answers_with).includes(fid)).map((b) => str(b.id)),
      ...arr(f.q).filter((id) => host.order.includes(id))
    ];
    if (factSeen(f, host)) {
      const w = where(host, ids, S.yml);
      host.warn.push({ id: WARN_ID, block: w.block, line: w.line, mark: fid, msg: plain(`${use}: значение в тексте есть, а id в closes: нет - пометить, а не дописывать`) });
      continue;
    }
    item(host, S.yml, { id: "fact_open", act: "land", ids, mark: fid, use, msg: `обещание блока держится на словах: факта ${fid} нет ни в одном closes: по сайту` });
  }
}

// obj_open: два слоя, и оба адресные. Первый - возражение, которое план поручил этой
// странице, а разметка его не закрыла. Второй - сегмент, чья страница не сняла НИ ОДНОГО
// его возражения, и только при живом блоке функции В: без места, куда добавлять, строка
// превратилась бы в требование нового раздела, а разделы считает plan.mjs.
function markObjections(S) {
  const segs = arr((S.project.audience || {}).segments);
  const byId = new Map();
  segs.forEach((s, i) => arr(s.objection).forEach((ob, j) => byId.set(`o${i + 1}.${j + 1}`, { seg: s, ob })));
  for (const pg of S.pages) {
    const planned = [];
    for (const b of pg.active) {
      for (const a of arr(b.answers_with)) {
        if (/^o\d+\.\d+$/.test(a) && !planned.some((x) => x.a === a)) planned.push({ a, id: str(b.id) });
      }
    }
    const done = new Set();
    for (const { a, id } of planned) {
      if (pg.closes.has(a)) { done.add(a); continue; }
      const rec = byId.get(a);
      if (!rec) continue;
      item(pg, S.yml, {
        id: "obj_open", act: "rewrite", ids: [id], mark: a,
        use: `«${str(rec.ob.says)}» -> ответ: ${str(rec.ob.answer)}`,
        msg: `блок поручен возражению ${a} сегмента «${str(rec.seg.name)}», а закрытым его не объявил: читатель уходит с тем же сомнением`
      });
    }
    const forAll = pg.type === "home" || pg.type === "landing";
    const bBlock = pg.order.find((id) => fnOf(S.yml, id) === "В" && pg.secById.has(id));
    if (!bBlock) continue;
    segs.forEach((s, i) => {
      const mine = arr(s.objection).map((_, j) => `o${i + 1}.${j + 1}`);
      if (!mine.length) return;
      if (!(forAll || (pg.dir && arr(s.dirs).includes(pg.dir)))) return;
      if (mine.some((a) => pg.closes.has(a) || done.has(a))) return;
      if (pg.items.some((x) => x.id === "obj_open" && mine.includes(x.mark))) return;
      const rec = byId.get(mine[0]);
      item(pg, S.yml, {
        id: "obj_open", act: "rewrite", ids: [bBlock], mark: mine[0],
        use: `«${str(rec.ob.says)}» -> ответ: ${str(rec.ob.answer)}`,
        msg: `сегмент «${str(s.name)}» приходит на эту страницу, и ни одно его возражение тут не снято`
      });
    });
  }
}

// claim_off: причина оффера, которой нет в тексте НИГДЕ. Маркера у причин в разметке нет
// по построению, поэтому проверка тут одна - по словам; зато и порог высокий, и хозяин
// один: страница с блоком, который этими причинами и живет.
function markClaims(S, out) {
  const reasons = arr((S.project.offer || {}).reasons);
  if (!reasons.length) {
    out.site.push({ id: "claim_off", mark: "-", msg: "в offer.reasons нет ни одной причины: усиливать отстройку нечем, это вопрос к контракту" });
    return;
  }
  const all = new Set(S.pages.flatMap((p) => [...p.stems]));
  const carriers = ["edge", "about", "result", "fit", "numbers"];
  reasons.forEach((r, i) => {
    const claim = str(r.claim);
    if (!claim) return;
    if (share(stemsOf(claim), all) >= CLAIM_HIT) return;
    const host = S.pages.find((p) => p.order.some((id) => carriers.includes(id)))
      || S.pages.find((p) => p.type === "home" || p.type === "landing");
    // Блока, который живет причинами, на сайте нет вовсе - строка уходит в site и агента
    // не зовет. Положить причину на первую попавшуюся страницу значило бы решать состав
    // мнением, а состав считает plan.mjs.
    if (!host) {
      out.site.push({ id: "claim_off", mark: `r${i + 1}`, msg: plain(`${claim}: причина не звучит нигде, а блока под нее (${carriers.join(", ")}) нет ни на одной странице - это состав, а не текст`) });
      return;
    }
    item(host, S.yml, {
      id: "claim_off", act: PROOF_KINDS.includes(str(r.kind)) ? "proof" : "land", ids: carriers, mark: `r${i + 1}`,
      use: `${claim}${str(r.proof) ? ` - ${str(r.proof)}` : ""}`,
      msg: `причина оффера не звучит ни на одной странице сайта, а доказательство под нее есть (${str(r.kind) || "вид не назван"})`
    });
  });
}

// hero_flat: первый экран без числа, притом что число в фактах есть. Правило молчит,
// когда приземлять нечего: строка «поставьте цифру», под которой цифры нет, - это и есть
// та подсказка, из-за которой в v7 появлялось «около 30 минут».
function markHero(S) {
  const withNum = arr(S.project.facts).filter((f) => str(f.publish) === "yes" && NUM_UNIT.test(str(f.value)));
  if (!withNum.length) return;
  for (const pg of S.pages) {
    const P = pg.P;
    if (!P.h1) continue;
    const lines = [P.h1];
    for (let n = P.h1Line; n < P.bodyEnd; n++) {
      const s = P.lines[n];
      if (/^#{2,4}\s+/.test(s)) break;
      if (s.trim() && !/^\s*<!--/.test(s)) lines.push(s);
    }
    if (NUM_UNIT.test(lines.join(" "))) continue;
    const f = withNum.find((x) => pg.active.some((b) => arr(b.answers_with).includes(str(x.id)))) || withNum[0];
    item(pg, S.yml, {
      id: "hero_flat", act: "hero", ids: ["hero", ...pg.order.slice(0, 1)], mark: str(f.id),
      use: `${str(f.label)} - ${str(f.value)}`,
      msg: "на первом экране нет ни одного проверяемого числа, а в фактах оно есть: человеку нечего унести из первых двух секунд"
    });
  }
}

// q_zero: раздел написан, а вопрос читателя закрыт нулем - ни closes:, ни числа, ни
// артефакта в тексте. Это НЕ дубль closes_empty из verify-page: тот говорит про слепую
// разметку и молчит, когда closes: проставлен; этот смотрит, есть ли под ответом хоть
// что-то проверяемое, и зовет добавить доказательство, а не поправить метку.
// Маркер идет последним из четырех адресных и уступает место занятому блоку: блок, по
// которому уже есть строка, вторую не получает. Две строки на один блок - это спор двух
// поводов за одно место, а список усиления адресный или никакой.
function markZero(S) {
  const arts = new Set(arr(S.project.facts).filter((f) => str(f.publish) === "yes").flatMap((f) => [...stemsOf(str(f.artifact))]));
  for (const pg of S.pages) {
    for (const s of pg.P.sections) {
      const id = str(s.id);
      if (!id || NO_PROOF.includes(id) || !pg.order.includes(id)) continue;
      if (pg.items.some((x) => x.block === id)) continue;
      if (s.closes.length || NUM_UNIT.test(s.text)) continue;
      if (arts.size && share(arts, stemsOf(s.text)) > 0) continue;
      const need = str((pg.active.find((b) => str(b.id) === id) || {}).needs);
      item(pg, S.yml, {
        id: "q_zero", act: "proof", ids: [id], mark: id,
        use: `вопрос читателя: ${qOf(S.yml, id) || id}` + (need ? `; тип ответа по плану: ${need}` : ""),
        msg: "раздел отвечает без единого проверяемого утверждения: ни числа, ни документа, ни закрытого id"
      });
    }
  }
}

// query_off: запрос страницы не встречается в ее тексте ни разу. Маркер берется из плана
// (page.marker), а не из головы: страница, которая ни разу не называет своими словами то,
// зачем на нее пришли, промахивается мимо читателя раньше, чем мимо поиска.
function markQuery(S) {
  for (const pg of S.pages) {
    const need = [...stemsOf(pg.marker)];
    if (need.length < 2) continue;
    const miss = need.filter((w) => !pg.stems.has(w));
    if (!miss.length) continue;
    const said = [...new Set(wordsOf(pg.marker).filter((w) => miss.includes(stem(w))))].slice(0, 3);
    item(pg, S.yml, {
      id: "query_off", act: "rewrite", ids: ["hero", ...pg.order.slice(0, 2)], mark: plain(pg.marker),
      use: plain(pg.marker),
      msg: `запрос страницы «${plain(pg.marker)}» в тексте не звучит: нет слов ${said.join(", ")}`
    });
  }
}

// ---------------------------------------------------------------- сборка
export function buildLift(dir, root) {
  const S = readSite(dir, root);
  const out = { v: 1, slug: str(S.project.slug), at: today(), acts: ACTS, pages: [], site: [] };
  markFacts(S, out);
  markObjections(S);
  markClaims(S, out);
  markHero(S);
  markZero(S);
  markQuery(S);

  const rank = (x) => ACT_ORDER.indexOf(x.act) * 10000 + (x.line || 0);
  for (const pg of S.pages) {
    // Порядок строк детерминирован и осмыслен: сперва первый экран, потом приземление,
    // потом доказательство, потом переписывание. Агент идет сверху вниз и упирается в
    // потолок, а не выбирает, что ему интереснее.
    pg.items.sort((a, z) => rank(a) - rank(z) || a.block.localeCompare(z.block) || a.mark.localeCompare(z.mark));
    const cut = pg.items.length - ITEMS_MAX;
    out.pages.push({
      slug: pg.slug, url: pg.url, type: pg.type, chars: pg.chars,
      cap: Math.round(pg.chars * CAP_SHARE), empty: pg.items.length === 0,
      dropped: cut > 0 ? cut : 0,
      lead: { cluster: str(pg.plan && pg.plan.cluster), measured: Boolean(pg.lead && pg.lead.measured), order: arr(pg.lead && pg.lead.order).map(str) },
      items: pg.items.slice(0, ITEMS_MAX),
      warn: pg.warn.sort((a, z) => (a.line || 0) - (z.line || 0) || a.mark.localeCompare(z.mark))
    });
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
  const out = buildLift(dir, root);
  // --page сужает ВЫВОД до одной страницы, а не счет: маркеры «по сайту» (факт, не
  // попавший ни в один closes:) с одной страницы не видны, и lift.json остается полным -
  // он же отметка пройденного круга усиления для verify-build.
  const only = flags.page && flags.page !== true ? String(flags.page).replace(/\.md$/i, "") : "";
  if (only && !out.pages.some((p) => p.slug === only)) die(`страницы ${only}.md в pages/ нет`);
  const shown = only ? out.pages.filter((p) => p.slug === only) : out.pages;
  const live = shown.filter((p) => !p.empty);

  if (flags.json) console.log(JSON.stringify(out, null, 2));
  else {
    if (!flags.dry) writeFileSync(join(dir, "lift.json"), JSON.stringify(out, null, 2) + "\n", "utf8");
    console.log(`[lift] ${dir}`);
    console.log(`  страниц ${shown.length} | усиливать ${live.length} | маркеров ${MARKERS.length}, действий ${ACT_ORDER.length}, все на добавление`);
    for (const p of shown) {
      if (p.empty) console.log(`  ${p.url} | усиливать нечего: site-strengthener не вызывается, 0 токенов`);
      else {
        console.log(`  ${p.url} (${p.type}) | ${p.chars} знаков, потолок прибавки +${p.cap} | строк ${p.items.length}${p.dropped ? ` (+${p.dropped} не поместилось в ${ITEMS_MAX})` : ""}`);
        for (const x of p.items) {
          console.log(`    ${x.act.padEnd(8)} ${x.block.padEnd(14)} строка ${String(x.line).padStart(3)}  ${x.mark}: ${x.msg}`);
          console.log(`             брать: ${x.use} | у рынка: ${x.form}`);
        }
      }
      for (const w of p.warn) console.log(`    ВНИМАНИЕ ${w.block.padEnd(14)} строка ${String(w.line).padStart(3)}  ${w.mark}: ${w.msg}`);
    }
    for (const s of out.site) console.log(`  по сайту  ${s.mark}: ${s.msg}`);
    console.log(`  итого: страниц с усилением ${live.length}, строк ${live.reduce((n, p) => n + p.items.length, 0)}`);
    if (live.length) console.log("  добавляет site-strengthener и только добавляет: операции «резать» у него нет.");
  }
  return live.length ? 1 : 0;
}

function fileURLToPathSafe(u) {
  let p = decodeURIComponent(new URL(u).pathname);
  if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1);
  return p;
}
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPathSafe(import.meta.url))) process.exit(main());
