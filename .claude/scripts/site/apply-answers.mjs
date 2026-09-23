#!/usr/bin/env node
// apply-answers.mjs
// Применяет ответы заказчика к project.json. Восемь смысловых решений гейта, каждое
// возвращается РОВНО В ОДНО поле. Девятое, d9 «состав сайта», живет в structure_data.json
// рядом с контрактом (tier basic): ответ снимает страницу или возвращает снятую, то есть
// меняет только target_status. У факта, выросшего из ответа, цитата-основание - строка
// листа ответов: она ложится в parts/facts-src.json, и verify-data сверит ее дословно. Список решений один на два файла и лежит в _contract.mjs:
// в документе 1 печатается ровно то, что тут умеют принять обратно. Молчание по решению - принятие рекомендованного, и это
// записывается явно в журнал. Молчание по фактуре - факт остается с publish="no", а вопрос
// уходит в gaps[]. Дифф-лист печатается ВСЕГДА и ДО записи: прямой записи в контракт без
// дифф-листа не бывает (по умолчанию файл не трогаем, пишем только с --apply).
//
// Использование:
//   node apply-answers.mjs <каталог|project.json> [--answers <файл>] [--apply] [--quiet]
//
// Формат листа ответов (одна строка на ответ):
//   d2: под ключ за 30 дней << мы всегда за месяц закрываем
//   d7: лендинг            решение с кодом из таблицы документа 1
//   f03: 14 лет на рынке << с 2011 года
//   f07: -            прочерк или пропущенная строка = молчание
//   g1: выезд бесплатный в пределах КАД
//   d9: убрать 7, /otzyvy; вернуть /komanda   (номер или адрес страницы из документа 1)
// После << - дословная фраза заказчика, если ответ разобран из прозы, комментария
// или голосового. В дифф-листе она стоит в колонке «на основании».
//
// Exit: 0 применимо (или применено) | 2 отказ.

import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync } from "node:fs";
import { join, resolve, relative } from "node:path";
import { appendJournal, findDir, isProjectDir, plain, repoRoot } from "./queue.mjs";
import { DECISIONS, readDecision, writeDecision, today, isCheckable, kindOf, SERVICE_NOTE, STRUCT_DECISION, parseStructureAnswer } from "./_contract.mjs";

const argv = process.argv.slice(2);
let target = null, answersArg = null, apply = false, quiet = false;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--answers") answersArg = argv[++i] || null;
  else if (a === "--apply") apply = true;
  else if (a === "--quiet") quiet = true;
  else if (!a.startsWith("--")) target = a;
}

// --quiet живет только в просмотре: записи без напечатанного дифф-листа не бывает.
if (apply && quiet) { quiet = false; console.log("[answers] --quiet при --apply не действует: без дифф-листа в контракт не пишут"); }

const die = (msg) => { console.error("[answers] " + msg); process.exit(2); };

// ---------------------------------------------------------------- где что лежит
const root = repoRoot();
let dir = null, projPath = null;
if (target && existsSync(target) && statSync(target).isFile()) { projPath = resolve(target); dir = resolve(projPath, ".."); }
else {
  dir = findDir(target, root) || (target ? resolve(target) : null);
  if (!dir) die("проект не найден - укажи каталог или сначала queue.mjs init <slug>");
  projPath = join(dir, "project.json");
}
if (!existsSync(projPath)) die(`нет project.json: ${projPath} - контракт еще не собран (шаг 3)`);

let data;
try { data = JSON.parse(readFileSync(projPath, "utf8")); }
catch (e) { die(`project.json не разобран: ${e.message}`); }

const arr = (x) => (Array.isArray(x) ? x : []);
const facts = arr(data.facts);
const gaps = arr(data.gaps);

// Состав сайта (d9): только если его писал анализ, то есть при tier basic.
const structPath = join(dir, "structure_data.json");
let structure = null;
if (data.tier === "basic" && existsSync(structPath)) {
  try { structure = JSON.parse(readFileSync(structPath, "utf8").replace(/^\uFEFF/, "")); }
  catch (e) { die(`structure_data.json не разобран: ${e.message}`); }
  if (!structure || !Array.isArray(structure.pages)) structure = null;
}
const structLine = () => {
  const pg = arr(structure && structure.pages);
  const off = pg.filter((x) => x.target_status === "no").length;
  return `${pg.length - off} страниц${off ? `, снято ${off}` : ""}`;
};

// Цитаты фактов: запись на факт из ответа, строка листа - основание.
const srcPath = join(dir, "parts", "facts-src.json");
let factsSrc = [];
if (existsSync(srcPath)) {
  try { factsSrc = JSON.parse(readFileSync(srcPath, "utf8").replace(/^\uFEFF/, "")); }
  catch (e) { die(`parts/facts-src.json не разобран: ${e.message}`); }
  if (!Array.isArray(factsSrc)) die("parts/facts-src.json: ожидался массив записей");
}
// Цитата - ответ так, как он стоит в листе: значение факта в нем дословно, и сверка находит
// именно то, что уйдет на страницу. Фраза после << остается в дифф-листе колонкой основания.
const quotes = [];   // {id, quote, where}
const setQuote = (id, quote, line) => quotes.push({ id, quote: plain(quote).slice(0, 300), where: `${answersRel}:${line}` });

// ------------------------------------------------------------- восемь решений гейта
// Читаются и пишутся функциями общего модуля: два списка решений в двух файлах уже один раз
// разошлись, и заказчику предлагали выбрать то, что принять было нечем.
const readOne = (d) => readDecision(data, d);
const writeOne = (d, answer) => writeDecision(data, d, answer);

// ---------------------------------------------------------------- проверяемость факта
// Подсказка для дифф-листа. Последнее слово за verify-data.mjs - он и считает ворота,
// и делает это тем же isCheckable из общего модуля.

// ---------------------------------------------------------------- разбор листа ответов
const answersPath = answersArg ? resolve(answersArg)
  : [join(dir, "answers.txt"), join(dir, "answers.md")].find((p) => existsSync(p)) || join(dir, "answers.txt");

function template() {
  const out = ["# Лист ответов. Одна строка на ответ. Прочерк или пропуск = молчание.",
    "# После << - дословная фраза заказчика, если ответ разобран из прозы или голосового.", "",
    "# Смысловые решения: молчание = принимаем то, что уже напечатано в документе 1."];
  for (const d of DECISIONS) out.push(`${d.key}: -        # ${d.name}. Сейчас: ${readOne(d) || "не задано"}`);
  if (structure) out.push(`${STRUCT_DECISION.key}: -        # ${STRUCT_DECISION.name}. Сейчас: ${structLine()}. Правка: убрать <номер|адрес>; вернуть <номер|адрес>`);
  out.push("", "# Вопросы документа 2 (порядок по ценности, считает verify-data.mjs).");
  gaps.forEach((g) => out.push(`${g.id}: -        # ${g.ask} [ждут блоков: ${arr(g.hits).length}]`));
  const waiting = facts.filter((f) => f.publish === "no" && arr(f.q).length).slice(0, 15);
  if (waiting.length) {
    out.push("", "# Факты, которые пока не печатаем. Ответ = печатаем, молчание = уходит в вопросы.");
    waiting.forEach((f) => out.push(`${f.id}: -        # ${f.label}: ${f.value || "-"} [блоков: ${arr(f.q).length}]`));
  }
  return out.join("\n");
}

if (!existsSync(answersPath)) {
  console.log(`[answers] листа ответов нет: ${answersPath}`);
  console.log("  образец ниже - положи его в answers.txt, заполни и запусти снова.\n");
  console.log(template());
  process.exit(0);
}

const answersRel = relative(dir, answersPath).replace(/\\/g, "/") || "answers.txt";
const lines = readFileSync(answersPath, "utf8").replace(/^﻿/, "").split(/\r?\n/);
const answers = new Map();   // key -> { value, from, line }
const unknown = [];
let lineNo = 0;
for (const raw of lines) {
  lineNo++;
  const line = raw.replace(/\s+$/, "");
  if (!line.trim() || /^\s*#/.test(line)) continue;
  const m = line.match(/^\s*([a-zA-Zа-яА-Я0-9]+)\s*[:=]\s*(.*)$/);
  if (!m) { unknown.push(plain(line)); continue; }
  const key = plain(m[1]).toLowerCase();
  let rest = m[2].replace(/\s+#.*$/, "");
  let from = "";
  const cut = rest.split("<<");
  if (cut.length > 1) { rest = cut[0]; from = plain(cut.slice(1).join("<<")).replace(/^[«"']|[»"']$/g, ""); }
  const value = plain(rest);
  if (!/^(d[1-9]|f\d{2,3}|g\d{1,2})$/.test(key)) { unknown.push(`${key}: ${value}`); continue; }
  answers.set(key, { value, from, line: lineNo });
}

// ---------------------------------------------------------------- применение
const changes = [];   // {field, was, now, from}
const silence = [];   // {what, kept}
const toGaps = [];    // {factId, ask}
const dropped = [];   // {what, ground}
const journal = [];   // {kind, subject, ground}
const short = (s, n = 110) => { const t = String(s == null || s === "" ? "-" : s); return [...t].length > n ? [...t].slice(0, n - 1).join("") + "…" : t; };

// 1. Восемь решений
for (const d of DECISIONS) {
  const a = answers.get(d.key);
  const was = readOne(d);
  if (!a || !a.value || a.value === "-") {
    silence.push({ what: `${d.key} ${d.name}`, kept: was || "не задано" });
    journal.push({ kind: "waiver", subject: `молчание по решению ${d.key} - ${d.name}`,
      ground: `заказчик не поправил, принят рекомендованный дефолт: ${was || "поле пусто"}` });
    continue;
  }
  const now = writeOne(d, a.value);
  if (now === null) { dropped.push({ what: `${d.key}: ${a.value}`, ground: "ответ не разобран в значение поля" });
    journal.push({ kind: "dropped", subject: `${d.key} ${d.name}`, ground: `ответ «${a.value}» не разобран в значение поля` }); continue; }
  if (now !== was) changes.push({ field: d.path + (d.flag ? ` (${d.flag})` : ""), was, now, from: a.from });
  else silence.push({ what: `${d.key} ${d.name}`, kept: `${was} - ответ совпал с дефолтом` });
}

// 1b. Состав сайта (d9): только target_status, новых страниц разбор ответа не рождает
let structChanged = false;
if (structure) {
  const a = answers.get(STRUCT_DECISION.key);
  const res = parseStructureAnswer(structure, a ? a.value : "");
  if (res.accept) {
    silence.push({ what: `${STRUCT_DECISION.key} ${STRUCT_DECISION.name}`, kept: structLine() });
    journal.push({ kind: "waiver", subject: `молчание по решению ${STRUCT_DECISION.key} - ${STRUCT_DECISION.name}`,
      ground: `заказчик не поправил, принят рекомендованный состав: ${structLine()}` });
  }
  for (const op of res.ops) {
    const was = op.page.target_status;
    if (was === op.status) { silence.push({ what: `${STRUCT_DECISION.key} ${op.page.url}`, kept: `target_status ${was} - ответ совпал с составом` }); continue; }
    op.page.target_status = op.status;
    structChanged = true;
    changes.push({ field: `structure_data.json ${op.page.url} (${op.page.name})`, was: `target_status ${was}`, now: `target_status ${op.status}`, from: a.from || a.value });
  }
  for (const d of res.dropped) {
    dropped.push({ what: `${STRUCT_DECISION.key}: ${d.token}`, ground: d.ground });
    journal.push({ kind: "dropped", subject: `${STRUCT_DECISION.key} ${STRUCT_DECISION.name}: «${d.token}»`, ground: d.ground });
  }
} else if (answers.has(STRUCT_DECISION.key) && answers.get(STRUCT_DECISION.key).value && answers.get(STRUCT_DECISION.key).value !== "-") {
  dropped.push({ what: `${STRUCT_DECISION.key}: ${answers.get(STRUCT_DECISION.key).value}`, ground: data.tier === "seo" ? "tier seo: состав решает /seo-struktura" : "structure_data.json нет - сначала pages-planner" });
}

// Служебная пометка вместо ответа («не разворачиваем в этой версии») фактом не становится.
const isNote = (v) => SERVICE_NOTE.test(v);

// 2. Факты
const factById = new Map(facts.map((f) => [f.id, f]));
const nextFactId = () => {
  const nums = facts.map((f) => parseInt(String(f.id).slice(1), 10)).filter(Number.isInteger);
  const n = (nums.length ? Math.max(...nums) : 0) + 1;
  return "f" + String(n).padStart(n > 99 ? 3 : 2, "0");
};
const nextGapId = () => {
  const nums = gaps.map((g) => parseInt(String(g.id).slice(1), 10)).filter(Number.isInteger);
  return "g" + String((nums.length ? Math.max(...nums) : 0) + 1);
};
function askGap(ask, hits, factId) {
  if (gaps.length >= 10) { dropped.push({ what: ask, ground: "вопросов уже 10 - потолок документа 2" });
    journal.push({ kind: "dropped", subject: `вопрос «${ask}»`, ground: "в документе 2 уже 10 вопросов, потолок" }); return null; }
  if (gaps.some((g) => plain(g.ask) === plain(ask))) return null;
  const g = { id: nextGapId(), ask: ask.slice(0, 200), hits: arr(hits).slice(0, 20) };
  gaps.push(g);
  toGaps.push({ factId, ask: g.ask });
  return g;
}

for (const [key, a] of answers) {
  if (!/^f\d{2,3}$/.test(key)) continue;
  const f = factById.get(key);
  if (!f) { dropped.push({ what: `${key}: ${a.value}`, ground: "такого факта в контракте нет" });
    journal.push({ kind: "dropped", subject: `ответ по ${key}`, ground: `факта ${key} в контракте нет` }); continue; }
  if (!a.value || a.value === "-") {
    f.publish = "no";
    silence.push({ what: `${key} ${f.label}`, kept: "publish no, вопрос уходит в gaps" });
    askGap(`Уточните: ${f.label}`, f.q, key);
    journal.push({ kind: "gap", subject: `молчание по факту ${key} - ${f.label}`,
      ground: `ответа нет, факт не публикуем, вопрос ушел в документ 2 (блоков ждет ${arr(f.q).length})` });
    continue;
  }
  if (isNote(a.value)) {
    f.publish = "no";
    dropped.push({ what: `${key}: ${a.value}`, ground: "служебная пометка, а не факт - факт не публикуем" });
    journal.push({ kind: "dropped", subject: `ответ по ${key} - ${f.label}`, ground: `«${a.value}» - пометка, а не факт; publish no` });
    continue;
  }
  const was = `${f.value || "-"} / publish ${f.publish}`;
  f.value = plain(a.value).slice(0, 200);
  setQuote(f.id, a.value, a.line);
  f.publish = "yes";
  // Источник у факта, выросшего из ответа заказчика, - его ответ, а не бриф, которого
  // могло не быть вовсе. Документ 1 печатает эту колонку заказчику, она обязана быть правдой.
  f.src = "ответ";
  // Дословная фраза остается в дифф-листе и не едет в artifact: artifact делает факт
  // проверяемым, а сказанное вслух доказательством не становится.
  const now = `${f.value} / publish yes / проверяемый ${isCheckable(f) ? "да" : "нет"}`;
  changes.push({ field: `facts[${f.id}] ${f.label}`, was, now, from: a.from });
}

// 3. Вопросы документа 2
for (const [key, a] of answers) {
  if (!/^g\d{1,2}$/.test(key)) continue;
  const i = gaps.findIndex((g) => g.id === key);
  if (i === -1) { dropped.push({ what: `${key}: ${a.value}`, ground: "такого вопроса в документе 2 нет" });
    journal.push({ kind: "dropped", subject: `ответ по ${key}`, ground: `вопроса ${key} в контракте нет` }); continue; }
  const g = gaps[i];
  if (!a.value || a.value === "-") {
    silence.push({ what: `${key} ${g.ask}`, kept: "вопрос остается в документе 2" });
    journal.push({ kind: "gap", subject: `молчание по вопросу ${key}`, ground: `${g.ask} - ответа нет, вопрос остается открытым` });
    continue;
  }
  if (isNote(a.value)) {
    silence.push({ what: `${key} ${g.ask}`, kept: "ответ - служебная пометка, вопрос остается в документе 2" });
    journal.push({ kind: "gap", subject: `пометка вместо ответа по вопросу ${key}`, ground: `«${a.value}» - это не факт; ${g.ask} - вопрос остается открытым` });
    continue;
  }
  if (facts.length >= 40) { dropped.push({ what: `${key}: ${a.value}`, ground: "фактов уже 40 - потолок контракта" });
    journal.push({ kind: "dropped", subject: `ответ по ${key}`, ground: "в контракте уже 40 фактов, потолок" }); continue; }
  const id = nextFactId();
  const f = { id, label: plain(g.ask).replace(/^Уточните:\s*/i, "").slice(0, 80), value: plain(a.value).slice(0, 200),
    q: arr(g.hits).slice(0, 12), publish: "yes", src: "ответ" };
  f.kind = kindOf(f);
  facts.push(f);
  setQuote(id, a.value, a.line);
  factById.set(id, f);
  gaps.splice(i, 1);
  changes.push({ field: `facts[${id}] (был вопрос ${key})`, was: `вопрос «${g.ask}», блоков ждет ${arr(g.hits).length}`,
    now: `${f.value} / publish yes / проверяемый ${isCheckable(f) ? "да" : "нет"}`, from: a.from });
}

for (const u of unknown) { dropped.push({ what: u, ground: "строка листа не разобрана" });
  journal.push({ kind: "dropped", subject: `строка листа «${short(u, 60)}»`, ground: "строка не в формате <ключ>: <ответ>" }); }

data.facts = facts;
data.gaps = gaps;
if (data.updated) data.updated = today();

// ---------------------------------------------------------------- дифф-лист
if (!quiet) {
  console.log(`[answers] ${projPath}`);
  console.log(`  лист ответов: ${answersPath}`);
  console.log(`  режим: ${apply ? "ЗАПИСЬ" : "просмотр, файл не тронут"}`);
  console.log("\nДИФФ-ЛИСТ");
  if (!changes.length) console.log("  изменений нет.");
  changes.forEach((c, i) => {
    console.log(`  ${i + 1}. ${c.field}`);
    console.log(`     было:        ${short(c.was)}`);
    console.log(`     стало:       ${short(c.now)}`);
    console.log(`     на основании: ${c.from ? "«" + short(c.from, 120) + "»" : "ответ листа, дословной фразы нет"}`);
  });
  if (silence.length) {
    console.log("\nМОЛЧАНИЕ (записано в журнал)");
    for (const s of silence) console.log(`  ${s.what} -> ${short(s.kept)}`);
  }
  if (toGaps.length) {
    console.log("\nУШЛО В ВОПРОСЫ ДОКУМЕНТА 2");
    for (const g of toGaps) console.log(`  ${g.factId} -> ${g.ask}`);
  }
  if (dropped.length) {
    console.log("\nНЕ РАЗОБРАНО");
    for (const d of dropped) console.log(`  ${short(d.what)} - ${d.ground}`);
  }
  if (quotes.length) {
    console.log("\nЦИТАТЫ ФАКТОВ (в parts/facts-src.json)");
    for (const q of quotes) console.log(`  ${q.id} <- ${q.where}: «${short(q.quote, 90)}»`);
  }
  if (structure && changes.some((c) => c.field.startsWith("business.site_kind"))) {
    console.log("\nВНИМАНИЕ: тип сайта изменен, состав страниц устарел - лендинг пересоберет build-project, многостраничник - pages-planner (шаг 3b)");
  }
  console.log(`\nИТОГ: изменений ${changes.length}, молчаний ${silence.length}, вопросов в документе 2 ${gaps.length}, не разобрано ${dropped.length}`);
}

// ---------------------------------------------------------------- запись
if (!apply) {
  console.log("\nФайл не изменен. Запись - тот же дифф-лист и флаг --apply:");
  console.log(`  node .claude/scripts/site/apply-answers.mjs ${dir} --apply`);
  process.exit(0);
}

writeFileSync(projPath, JSON.stringify(data, null, 2) + "\n", "utf8");
console.log(`\n[answers] записано: ${projPath}`);
if (structChanged) { writeFileSync(structPath, JSON.stringify(structure, null, 2) + "\n", "utf8"); console.log(`  состав сайта: ${structPath} (${structLine()})`); }
if (quotes.length && answersRel.startsWith("..")) {
  console.log(`  ВНИМАНИЕ: лист ответов лежит вне каталога задачи - verify-data ищет цитаты в ${dir}/answers.txt и input/, скопируй лист туда`);
}
if (quotes.length) {
  const ids = new Set(quotes.map((q) => q.id));
  const next = factsSrc.filter((x) => !(x && ids.has(x.id))).concat(quotes);
  mkdirSync(join(dir, "parts"), { recursive: true });
  writeFileSync(srcPath, JSON.stringify(next, null, 2) + "\n", "utf8");
  console.log(`  цитаты фактов: ${quotes.length} записей в ${srcPath}`);
}
if (isProjectDir(dir)) {
  let n = 0;
  for (const j of journal) { try { appendJournal(dir, j.kind, j.subject, j.ground); n++; } catch (e) { console.log(`  журнал отказал: ${e.message}`); } }
  console.log(`  журнал исключений: ${n} записей`);
} else console.log("  журнала нет: рядом нет queue.json (запусти queue.mjs init)");
console.log("  дальше: node .claude/scripts/site/verify-data.mjs <каталог>   (пересчитает ворота и вес вопросов)");
console.log("          node .claude/scripts/site/queue.mjs gate --by \"<кто согласовал>\"");
process.exit(0);
