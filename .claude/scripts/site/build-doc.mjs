#!/usr/bin/env node
// build-doc.mjs
// Собирает ОБА клиентских документа гейта v8 подстановкой из project.json:
//   docs/understood.html - «Что мы поняли о вашем бизнесе» (полный, без единого плейсхолдера)
//   docs/ask.html        - «Что нам от вас нужно» (одна страница, до 10 вопросов по весу)
// Имена файлов те самые, по которым queue.mjs считает шаг закрытым.
//
// Прозу не генерирует НИКТО. Скрипт только подставляет значения в шаблон, поэтому раздуть
// документ нечем: нет данных - секция не печатается вовсе. В шаблонизаторе намеренно нет
// ветки «иначе» ({{^...}} запрещен и ловится проверкой), а дефолта нет и в самом скрипте:
// причина без доказательства выбрасывается из таблицы, а не подписывается словами «пока нечем».
//
// Использование:
//   node build-doc.mjs <project.json|каталог> [--pages <pages.yml>] [--tmpl <dir>]
//                      [--market <parts/market.json>] [--out-dir <dir>] [--quiet]
//
// Проверяет СОБРАННЫЙ результат: ноль неподставленных маркеров, ноль плейсхолдеров и
// открытых вопросов, ноль длинных тире и е-с-точками, не больше 10 вопросов в документе 2.
// Объем - предупреждение с именем самого толстого раздела, а не отказ: документ, который
// не записан, не читает никто, и оператору некуда идти.
// Документы записываются ПОШТУЧНО: брак одного не уносит второй.
//
// Exit: 0 чисто | 1 предупреждения | 2 нарушения (хотя бы один документ не записан).

import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  arr, str, low, isCheckable, heldBack, SRC_HUMAN, DECISIONS, decisionRow,
  BAD_TYPO, TYPO_NAME, readPages
} from "./_contract.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
let target = null, pagesArg = null, tmplArg = null, marketArg = null, outArg = null, quiet = false;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--pages") pagesArg = argv[++i] || null;
  else if (a === "--tmpl") tmplArg = argv[++i] || null;
  else if (a === "--market") marketArg = argv[++i] || null;
  else if (a === "--out-dir") outArg = argv[++i] || null;
  else if (a === "--quiet") quiet = true;
  else if (!target) target = a;
}
if (!target) { console.error("[build-doc] usage: <project.json|каталог> [--pages <pages.yml>] [--tmpl <dir>] [--market <file>] [--out-dir <dir>]"); process.exit(2); }

const projPath = existsSync(target) && statSync(target).isDirectory() ? join(resolve(target), "project.json") : resolve(target);
const taskDir = dirname(projPath);
const outDir = join(outArg ? resolve(outArg) : taskDir, "docs");
const tmplDir = tmplArg ? resolve(tmplArg) : resolve(HERE, "..", "..", "skills", "site-analiz");
const pagesPath = pagesArg ? resolve(pagesArg) : resolve(HERE, "..", "..", "skills", "site-proto", "pages.yml");
const marketCandidates = marketArg ? [resolve(marketArg)] : [join(taskDir, "parts", "market.json"), join(dirname(taskDir), "parts", "market.json")];

const violations = [], warnings = [], infos = [];
const V = (p, m) => violations.push(p ? `${p}: ${m}` : m);
const W = (p, m) => warnings.push(p ? `${p}: ${m}` : m);
const I = (m) => infos.push(m);

function readJson(p, what, required) {
  if (!existsSync(p)) { if (required) { console.error(`[build-doc] нет файла ${what}: ${p}`); process.exit(2); } return null; }
  try { return JSON.parse(readFileSync(p, "utf8").replace(/^﻿/, "")); }
  catch (e) { console.error(`[build-doc] ${what} не разобран (${p}): ${e.message}`); process.exit(2); }
}
const data = readJson(projPath, "project.json", true);

// ---------------------------------------------------------------- pages.yml
const pagesFile = readPages(pagesPath);
if (!pagesFile) { console.error(`[build-doc] нет pages.yml: ${pagesPath}`); process.exit(2); }
const blocks = pagesFile.blocks;
// Имя блока для заказчика - это вопрос читателя из pages.yml, а не наш служебный id.
const askOfBlock = (id) => { const c = blocks.get(id); return c && c.length === 7 ? c[1] : id; };

// Какой раздел документа 1 усилится, если факт придет. Ключи - это id блоков из pages.yml,
// а не поля-обоснования: карта переводит блок сайта в имя раздела клиентского документа.
// Лежит она тут, а не в контракте, потому что это свойство документа, а не данных.
const SECTION_OF = {
  hero: "Как мы поняли бизнес", nav: "Как мы поняли бизнес", scope: "Как мы поняли бизнес",
  result: "Как мы поняли бизнес", steps: "Как мы поняли бизнес", geo: "Как мы поняли бизнес",
  delivery: "Как мы поняли бизнес", cta_mid: "Как мы поняли бизнес", cta_form: "Как мы поняли бизнес",
  listing: "Как мы поняли бизнес", subcats: "Как мы поняли бизнес", product_desc: "Как мы поняли бизнес",
  related: "Как мы поняли бизнес",
  numbers: "Чем вы отличаетесь", edge: "Чем вы отличаетесь", cases: "Чем вы отличаетесь",
  docs: "Чем вы отличаетесь", about: "Чем вы отличаетесь",
  fit: "О чем спрашивают ваши клиенты", not_fit: "О чем спрашивают ваши клиенты",
  problem: "О чем спрашивают ваши клиенты", reviews: "О чем спрашивают ваши клиенты",
  qa: "О чем спрашивают ваши клиенты",
  price: "Ваши цифры", price_factors: "Ваши цифры", compare: "Ваши цифры",
  cat_intro: "Ваши цифры", gallery: "Ваши цифры", specs: "Ваши цифры",
  cat_text: "Что говорит рынок"
};

// ---------------------------------------------------------------- шаблонизатор
// Три конструкции и все: {{поле}}, {{#секция}}...{{/секция}}, {{.}} внутри списка строк.
// Ветки «иначе» нет намеренно.
function parse(tmpl) {
  const re = /\{\{([#/]?)([a-z0-9_.]+)\}\}/g;
  const root = { kids: [] };
  const stack = [root];
  let last = 0, m;
  while ((m = re.exec(tmpl))) {
    const [full, sigil, name] = m;
    if (m.index > last) stack[stack.length - 1].kids.push({ t: "text", v: tmpl.slice(last, m.index) });
    last = m.index + full.length;
    if (sigil === "#") { const node = { t: "sec", name, kids: [] }; stack[stack.length - 1].kids.push(node); stack.push(node); }
    else if (sigil === "/") { if (stack.length > 1) stack.pop(); }
    else stack[stack.length - 1].kids.push({ t: "var", name });
  }
  if (last < tmpl.length) stack[stack.length - 1].kids.push({ t: "text", v: tmpl.slice(last) });
  return { root, balanced: stack.length === 1 };
}
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
function lookup(name, stack) {
  if (name === ".") return stack[0];
  for (const ctx of stack) {
    if (ctx && typeof ctx === "object" && !Array.isArray(ctx) && Object.prototype.hasOwnProperty.call(ctx, name)) return ctx[name];
  }
  return undefined;
}
function render(node, stack, log) {
  let out = "";
  for (const k of node.kids) {
    if (k.t === "text") { out += k.v; continue; }
    if (k.t === "var") {
      const v = lookup(k.name, stack);
      if (v === undefined || v === null || v === "") { log.missing.add(k.name); continue; }
      out += esc(v);
      continue;
    }
    const v = lookup(k.name, stack);
    const empty = v === undefined || v === null || v === "" || v === false ||
      (Array.isArray(v) && !v.length) || (v && typeof v === "object" && !Array.isArray(v) && !Object.keys(v).length);
    if (empty) { log.omitted.add(k.name); continue; }
    if (Array.isArray(v)) for (const it of v) out += render(k, [it, ...stack], log);
    else out += render(k, [v, ...stack], log);
  }
  return out;
}

// ---------------------------------------------------------------- модель документа 1
const biz = (data.business && typeof data.business === "object" ? data.business : {});
const offer = (data.offer && typeof data.offer === "object" ? data.offer : {});
const aud = (data.audience && typeof data.audience === "object" ? data.audience : {});
const comp = (data.competitors && typeof data.competitors === "object" ? data.competitors : {});
const cons = (data.constraints && typeof data.constraints === "object" ? data.constraints : {});
const lex = (data.lexicon && typeof data.lexicon === "object" ? data.lexicon : {});
const forbidden = arr(cons.forbidden);
const plural = (n, one, few, many) => {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return `${n} ${many}`;
  if (b > 1 && b < 5) return `${n} ${few}`;
  if (b === 1) return `${n} ${one}`;
  return `${n} ${many}`;
};

// Корневое имя называется company, а не name: name есть еще у направлений и у сегментов,
// и поиск переменной вверх по стеку подставил бы название компании вместо пустого имени.
const v1 = {};
v1.company = str(biz.name) || str(data.slug);
v1.updated = str(data.updated);
if (str(biz.what)) v1.what = str(biz.what);
if (str(biz.region)) v1.region = str(biz.region);
if (Number.isFinite(biz.since)) v1.since = String(biz.since);
if (arr(biz.geo).length) v1.geo_line = arr(biz.geo).join(", ");
if (str(offer.positioning)) v1.positioning = str(offer.positioning);

{
  const dirs = arr(biz.directions);
  const segName = new Map(arr(aud.segments).map((s) => [s.id, str(s.name)]));
  const kids = new Map();
  for (const d of dirs) if (str(d.parent)) { const k = kids.get(d.parent) || []; k.push(str(d.name)); kids.set(d.parent, k); }
  const rows = [];
  for (const d of dirs) {
    if (str(d.parent) || !str(d.name)) continue;
    const row = { name: str(d.name) };
    if (str(d.marker)) row.marker = str(d.marker);
    const k = kids.get(d.id);
    if (k && k.length) row.kids_line = k.filter(Boolean).join(", ");
    const serves = arr(d.serves).map((s) => segName.get(s)).filter(Boolean);
    if (serves.length) row.serves_line = serves.join(", ");
    rows.push(row);
  }
  if (rows.length) v1.directions = rows;
  const deep = dirs.length - rows.length;
  if (deep > 0) I(`направлений ${dirs.length}: корневых ${rows.length}, вложенных ${deep} - вложенные печатаются строкой внутри своего корня`);
}

// Смысловые решения: ровно те, что умеет принять обратно apply-answers.mjs. Список один
// на печать и на возврат и лежит в _contract.mjs, поэтому строки без ключа возврата
// тут появиться не могут.
{
  const rows = DECISIONS.map((d) => decisionRow(data, d)).filter(Boolean);
  if (rows.length) v1.decisions = rows;
  const missing = DECISIONS.filter((d) => !decisionRow(data, d)).map((d) => d.key);
  if (missing.length) I(`смысловых решений напечатано ${rows.length} из ${DECISIONS.length}; пусты ${missing.join(", ")} - пустое решение не печатается и дефолта у него нет`);
}

// Причина без доказательства на страницу не идет, значит и в документе ей не место:
// текст «пока нечем» был бы тем самым открытым вопросом внутри документа 1.
{
  const all = arr(offer.reasons).filter((r) => str(r.claim));
  const rows = all.filter((r) => str(r.proof)).map((r) => {
    const row = { claim: str(r.claim), proof: str(r.proof) };
    if (str(r.kind)) row.kind = str(r.kind);
    return row;
  });
  if (rows.length) v1.reasons = rows;
  const weak = all.length - rows.length;
  if (weak) {
    I(`причин без доказательства: ${weak} из ${all.length} - в документ они не попали вовсе`);
    W("offer.reasons", `${weak} причин без proof: на страницы они не пойдут. Нужно доказательство - заводи вопрос в gaps, документ 1 открытых вопросов не печатает`);
  }
}

{
  const segs = arr(aud.segments).map((s) => {
    const row = { name: str(s.name) };
    if (str(s.who)) row.who = str(s.who);
    if (arr(s.pain).length) row.pain = arr(s.pain);
    if (arr(s.fear).length) row.fear = arr(s.fear);
    if (arr(s.choose).length) row.choose = arr(s.choose);
    const obj = arr(s.objection).filter((o) => str(o.says) && str(o.answer)).map((o) => ({ says: str(o.says), answer: str(o.answer) }));
    if (obj.length) row.objections = obj;
    return row;
  }).filter((s) => s.name);
  if (segs.length) v1.segments = segs;
}
{
  const SRC = { forum: "с форума", client: "от вас" };
  const words = arr(aud.words).filter((w) => str(w.say));
  const quoted = words.filter((w) => w.src === "forum" || w.src === "client").map((w) => {
    const row = { say: str(w.say), src: SRC[w.src] };
    if (str(w.means)) row.means = str(w.means);
    return row;
  });
  const plain = words.filter((w) => w.src === "persona").map((w) => {
    const row = { say: str(w.say) };
    if (str(w.means)) row.means = str(w.means);
    return row;
  });
  if (quoted.length) v1.words_quoted = quoted;
  if (plain.length) v1.words_plain = plain;
}

{
  let scan = null;
  for (const p of marketCandidates) {
    const m = existsSync(p) ? readJson(p, "parts/market.json", false) : null;
    const s = m && m.scan && typeof m.scan === "object" ? m.scan : null;
    if (!s) continue;
    const seen = Number(s.pages_seen != null ? s.pages_seen : s.seen);
    const total = Number(s.pages_total != null ? s.pages_total : s.total);
    if (Number.isFinite(seen) && Number.isFinite(total) && total > 0) { scan = { seen: String(seen), total: String(total) }; break; }
  }
  if (scan) v1.scan = scan;
  else I("переписи разведки нет (parts/market.json без блока scan) - строка «померено на N из M страниц» не печатается, дефолта у нее нет");

  const mh = arr(comp.market && comp.market.must_have).filter((b) => blocks.has(b));
  if (mh.length) v1.must_have = mh.map((b) => ({ ask: askOfBlock(b) }));
  const os = arr(comp.market && comp.market.offers_seen);
  if (os.length) v1.offers_seen = os;
  const mg = arr(comp.market && comp.market.gaps);
  if (mg.length) v1.market_gaps = mg;
  if (arr(comp.seen_numbers).length) v1.seen_numbers = arr(comp.seen_numbers);
  if (arr(comp.list).length) v1.rivals_line = arr(comp.list).join(", ");
}

{
  const all = arr(data.facts).filter((f) => str(f.label) && (str(f.value) || str(f.artifact)));
  const rows = all.map((f) => ({
    label: str(f.label),
    // Значения нет - печатается ссылка на подтверждение, а не прочерк: прочерк в клиентском
    // документе читается как «мы не знаем», то есть как открытый вопрос.
    value: str(f.value) || str(f.artifact),
    src: str(f.artifact) ? `${SRC_HUMAN[str(f.src)] || str(f.src)}, есть подтверждение` : (SRC_HUMAN[str(f.src)] || str(f.src)),
    // Не публикуем только то, что задевает запреты заказчика. Непроверяемая строка
    // публикуется, просто доказательством она не работает - это разные вещи, и путать их
    // нельзя: иначе состав ремонта или перечень услуг вылетит со страницы за то, что в нем
    // нет цифры с единицей.
    rec: heldBack(f, forbidden) ? "нет, у вас это в запретах" : "да, публикуем"
  }));
  if (rows.length) v1.facts = rows;
  const proof = all.filter((f) => isCheckable(f) && !heldBack(f, forbidden)).length;
  I(`таблица «ваши цифры»: строк ${rows.length}, из них проверяемых ${proof} - на воротах facts3 нужно три`);
  if (proof < 3) W("facts", `проверяемых фактов ${proof}, воротам нужно 3 - пока заказчик не ответит, тексты будут доказывать нечем и станут короче`);
}

{
  if (str(offer.tone)) v1.tone = str(offer.tone);
  if (arr(offer.limits).length) v1.limits = arr(offer.limits);
  if (forbidden.length) v1.forbidden_line = forbidden.join(", ");
  if (arr(cons.not_self).length) v1.not_self = arr(cons.not_self);
  if (arr(cons.not_selling).length) v1.not_selling = arr(cons.not_selling);
  if (arr(cons.must_say).length) v1.must_say = arr(cons.must_say);
  if (str(cons.opsec)) v1.opsec = str(cons.opsec);
  if (arr(lex.locked).length) v1.locked_line = arr(lex.locked).join(", ");
  if (arr(lex.canonical).length) v1.canonical_line = arr(lex.canonical).join(", ");
  const tr = arr(lex.translate).filter((t) => str(t.from) && str(t.to)).map((t) => ({ from: str(t.from), to: str(t.to) }));
  if (tr.length) v1.translate = tr;
}

// Флаги has_*: секция с заголовком печатается один раз и только при данных. Заводятся
// механически по наполненным полям модели, поэтому шаблону нечего решать самому.
function flags(m) {
  for (const k of Object.keys(m)) {
    if (k.startsWith("has_")) continue;
    const v = m[k];
    const ok = Array.isArray(v) ? v.length > 0
      : v && typeof v === "object" ? Object.keys(v).length > 0
      : v !== undefined && v !== null && v !== "" && v !== false;
    if (ok) m["has_" + k] = true;
  }
}
flags(v1);
for (const k of Object.keys(v1)) {
  if (!Array.isArray(v1[k])) continue;
  for (const it of v1[k]) if (it && typeof it === "object") flags(it);
}
const any = (...keys) => keys.some((k) => v1["has_" + k]);
if (any("what", "positioning", "region", "geo_line", "since", "directions", "decisions")) v1.has_biz = true;
if (any("segments", "words_quoted", "words_plain")) v1.has_audience = true;
if (any("scan", "must_have", "offers_seen", "seen_numbers", "market_gaps", "rivals_line")) v1.has_market = true;
if (any("tone", "forbidden_line", "limits", "not_self", "not_selling", "must_say", "opsec", "locked_line", "canonical_line", "translate")) v1.has_tone_block = true;

// ---------------------------------------------------------------- модель документа 2
const VAGUE = /пришлите материал|расскажите о себе|дайте информац|любые данные|что-нибудь|материалы по проекту|опишите компанию|нужна информация/;
function formOf(ask) {
  const t = low(ask);
  if (/^есть ли|^можно ли|^даете ли|^дает ли|^работаете ли|^готовы ли|^верно ли|^берете ли/.test(t)) return "да/нет";
  if (/перечислите|список|какие именно|что именно|назовите|первые три|перечень|по пунктам/.test(t)) return "список";
  if (/^сколько|сколько |на сколько лет|какой процент|какая доля|за сколько дней|какой срок|с какого года/.test(t)) return "число";
  return "одна фраза";
}
const v2 = { company: v1.company, updated: v1.updated };
{
  const gaps = arr(data.gaps).slice().sort((a, b) => (Number(b && b.weight) || 0) - (Number(a && a.weight) || 0));
  if (gaps.length > 10) V("gaps", `вопросов ${gaps.length}, потолок 10 - документ 2 обязан быть одной страницей`);
  const rows = [];
  gaps.slice(0, 10).forEach((g, i) => {
    const ask = str(g.ask);
    if (!ask) return;
    if (VAGUE.test(low(ask))) W("gaps", `вопрос «${ask}» сформулирован общо - заказчик не поймет, что именно прислать`);
    const hits = arr(g.hits).filter((h) => blocks.has(h));
    const count = new Map();
    for (const h of hits) { const s = SECTION_OF[h]; if (s) count.set(s, (count.get(s) || 0) + 1); }
    const top = [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    const row = { num: String(i + 1), ask, form: formOf(ask) };
    if (top) row.adds_section = top[0];
    if (hits.length) {
      row.adds_blocks = plural(hits.length, "блок", "блока", "блоков");
      row.adds_first = hits.slice(0, 2).map((h) => askOfBlock(h).toLowerCase()).join("; ");
    }
    rows.push(row);
  });
  if (rows.length) {
    v2.asks = rows; v2.count = String(rows.length);
    // подпись подстраивается под фактическое число вопросов: обещать «первые три»,
    // когда в документе их два, - та самая небрежность, из-за которой документ
    // перестает читаться как аккуратная работа.
    v2.fin_hint = rows.length >= 3 ? "Ответите на первые три - тексты станут заметно сильнее"
      : rows.length === 2 ? "Ответите на оба - тексты станут заметно сильнее"
      : "Ответите на этот вопрос - тексты станут заметно сильнее";
  }
  I(`документ 2: вопросов ${rows.length}, порядок по весу задан скриптом сборки контракта`);
}

// ---------------------------------------------------------------- сборка и проверки
function readTmpl(name, bad) {
  const p = join(tmplDir, name);
  if (!existsSync(p)) { console.error(`[build-doc] нет шаблона: ${p}`); process.exit(2); }
  const t = readFileSync(p, "utf8").replace(/^﻿/, "");
  if (/\{\{\^/.test(t)) bad(name, "в шаблоне есть ветка «иначе» {{^...}} - контракт v8 запрещает дефолт в шаблоне");
  if (/<script|<link\b|https?:\/\/|<img\b/i.test(t)) bad(name, "шаблон тянет внешний ресурс либо скрипт - документ обязан быть самодостаточным");
  return t;
}
const PLACEHOLDER = /\[(?:[А-Я][А-Я _-]{2,40}|TODO|TBD|XXX|\.\.\.)\]/;
// Открытый вопрос внутри документа 1 - это тот же плейсхолдер, только словами.
const OPEN_Q = /пока нечем|уточнить у заказчика|нужно уточнить|дайте доказательство|\?\?\?|<td>\s*-\s*<\/td>/i;
const visible = (html) => html.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/gi, " ").replace(/\s+/g, " ").trim();

function build(tmplName, model, outName, budget, label) {
  const bad = [];
  const B = (p, m) => bad.push(p ? `${p}: ${m}` : m);
  const raw = readTmpl(tmplName, B);
  const { root, balanced } = parse(raw);
  if (!balanced) B(tmplName, "секции не закрыты - разошлись {{#...}} и {{/...}}");
  const log = { missing: new Set(), omitted: new Set() };
  const html = render(root, [model], log);
  if (log.missing.size) B(outName, `маркеры не подставлены: ${[...log.missing].join(", ")} - поле либо заводится в модели, либо оборачивается в свою секцию`);
  if (log.omitted.size) I(`${outName}: не напечатано за отсутствием данных - ${[...log.omitted].join(", ")}`);
  if (/\{\{|\}\}/.test(html)) B(outName, "в собранном документе остались фигурные маркеры");
  const ph = html.match(PLACEHOLDER);
  if (ph) B(outName, `плейсхолдер ${ph[0]} в клиентском документе - место вопросам в документе 2, а не в скобках`);
  const oq = html.match(OPEN_Q);
  if (oq) B(outName, `открытый вопрос «${String(oq[0]).trim()}» в клиентском документе - документ 1 говорит только то, что знает`);
  const typo = html.match(BAD_TYPO);
  if (typo) {
    const kinds = [...new Set(typo)].map((c) => TYPO_NAME[c]).join(", ");
    const at = html.search(BAD_TYPO);
    B(outName, `${kinds} (${typo.length} шт) - правь вход, например тут: ...${visible(html.slice(Math.max(0, at - 60), at + 60))}...`);
  }
  const text = visible(html);
  const size = Array.from(text).length;
  const parts = html.split(/<h2/i).slice(1);
  let fat = { name: "", size: 0 };
  for (const p of parts) {
    const t = visible(p.replace(/^[^>]*>/, ""));
    const n = Array.from(t).length;
    if (n > fat.size) fat = { name: t.slice(0, 40), size: n };
  }
  const fatLine = fat.size ? `, разделов ${parts.length}, самый толстый «${fat.name}» - ${fat.size} знаков` : "";
  I(`${outName}: ${size} знаков видимого текста (порог ${budget})${fatLine}`);
  if (size > budget) W(outName, `${label}: ${size} знаков, порог ${budget}${fat.size ? ` - самый толстый раздел «${fat.name}» (${fat.size} знаков)` : ""}. Режется не документом, а контрактом: правь project.json`);
  return { html, bad };
}

const written = [];
function put(name, made) {
  if (made.bad.length) { for (const b of made.bad) V("", b); return; }
  mkdirSync(outDir, { recursive: true });
  const p = join(outDir, name);
  writeFileSync(p, made.html, "utf8");
  written.push(p);
}

put("understood.html", build("doc1.tmpl.html", v1, "understood.html", 9000, "документ 1 длиннее двух минут чтения"));
if (v2.asks) {
  const d2 = build("doc2.tmpl.html", v2, "ask.html", 3500, "документ 2 длиннее одной страницы");
  const asks = (d2.html.match(/class="ask"/g) || []).length;
  if (asks > 10) d2.bad.push(`ask.html: вопросов в документе ${asks}, потолок 10`);
  put("ask.html", d2);
} else {
  W("ask.html", "вопросов нет - документ 2 не собран. Это законно только если фактура закрыта целиком");
}

if (!quiet) {
  console.log(`[build-doc] ${written.length ? written.join("  ") : "НЕ ЗАПИСАНЫ"}`);
  for (const m of infos) console.log("   i " + m);
  if (warnings.length) { console.log("  предупреждения:"); for (const w of warnings) console.log("   ~ " + w); }
  if (violations.length) { console.log("  НАРУШЕНИЯ (документ не записан):"); for (const v of violations) console.log("   ! " + v); }
  if (written.length) console.log("  дальше: оба файла в Google Doc через createDocFromHTML, ссылки - queue.mjs docs.");
}
process.exit(violations.length ? 2 : warnings.length ? 1 : 0);
