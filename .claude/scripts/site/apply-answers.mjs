#!/usr/bin/env node
// apply-answers.mjs
// Применяет ответы заказчика к project.json. Восемь смысловых решений гейта, каждое
// возвращается РОВНО В ОДНО поле. Девятое, d9 «состав сайта», живет в structure_data.json
// рядом с контрактом (tier basic): ответ снимает страницу или возвращает снятую, то есть
// меняет только target_status. Десятое, d10 «контакты и реквизиты», правит поля
// business.legal по меткам («телефон: ...; адрес: ...»; «убрать» кладет поле в
// absent_fields) и оставляет в журнале запись со словами «решению d10»: по ней импорт текстов
// решает, сверены ли контакты. Список решений один на два файла и лежит в _contract.mjs: в
// документе 1 печатается ровно то, что тут умеют принять обратно.
//
// Круги ответов. answers.txt - первый круг, answers-2.txt, answers-3.txt - следующие, новым
// файлом рядом: прежний круг не переписывается, лист накопительный. Без --answers применяются
// все круги по порядку, начиная с первого непримененного или измененного; отметка «лист
// применен» (имя и контрольная сумма) - в queue.json -> answers[], ее проверяет гейт.
// Пересборка контракта снимает отметки, и повтор всех кругов дает тот же итог.
//
// Молчание (прочерк или пропуск строки) действует только в первом круге и только при его
// первом применении: по решению - принят дефолт документа 1, по факту - ровно то, что документ 1
// напечатал в колонке «Публиковать» (factRec в _contract.mjs, решение Р1). В следующих кругах
// молчание ничего не меняет: иначе второй лист с одними новыми вопросами вернул бы в публикацию
// факт, снятый в первом.
// Строка факта: «да» (верно, +) - публикуем как напечатано, значение и цитата прежние; «нет»
// (не публикуем) - снимаем; другой текст - новое значение. «Не разобрано» (ответ с
// оговоркой, «не знаю», служебная пометка, фраза после <<, которой нет во входе) - не
// молчание: факт не публикуется (и старое значение тоже), вопрос уходит в документ 2, запись
// dropped держит гейт, пока строку не поправят.
// Цитата факта (решение Р2): есть << - фраза ищется только во входе input/ и становится
// цитатой (where input/<файл>:<строка>); без << (заказчик сам заполнил лист) - строка листа.
// Новые факты: ответ на вопрос gN, строка «+: что = значение», строка «F8NN: что = значение»
// (факт оператора из отчета текстов, поле moved_from). Номер - следующий за наибольшим,
// когда-либо выданным в анализе (queue.json -> facts_seq); номера снятых фактов не
// переиспользуются, повтор той же строки получает тот же номер (queue.json -> fact_ids).
// При 40 фактах ответ сначала занимает место снятого факта засева (publish no, ни на что не
// ссылается), затем фактов становится до 50 (решение Р3).
// d7 и d8 пишутся и в queue.json; ответ d7, разобранный в «лендинг» (tier basic), сам пишет
// состав из одной главной, прежний состав - в structure_data.prev.json. Круг, примененный
// после гейта, сбрасывает гейт (прежняя отметка - gate.prev): гейт обязан видеть каждый круг.
// Дифф-лист печатается ВСЕГДА и ДО записи, у каждого непустого ответа - строка «понят как»;
// по умолчанию файлы не трогаем, пишем только с --apply.
//
// Использование:
//   node apply-answers.mjs <каталог|project.json> [--answers <файл>] [--apply] [--quiet]
//
// Формат листа ответов (одна строка на ответ):
//   d2: под ключ за 30 дней << мы всегда за месяц закрываем
//   d7: лендинг            решение с кодом из таблицы документа 1; «верно» - подтверждение
//   f03: 14 лет на рынке << с 2011 года работаем   (фраза после << - из input/)
//   f05: да                печатаем как в документе 1;  f06: нет - не публикуем
//   f07: -                 прочерк или пропущенная строка = молчание
//   g1: выезд бесплатный в пределах КАД
//   +: Мастеров в штате = 11 человек   новый факт без вопроса
//   F801: Гарантия на пайку = 6 месяцев   факт оператора из отчета текстов
//   d9: убрать 7, /otzyvy; вернуть /komanda   (номер или адрес страницы из документа 1)
//   d10: телефон: +7 (812) 555-01-02; адрес: убрать   (либо «верно»; ИНН и ОГРН - по маске)
//
// Exit: 0 применимо (или применено) | 2 отказ.

import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync } from "node:fs";
import { join, resolve, relative, basename } from "node:path";
import { appendJournal, findDir, isProjectDir, plain, repoRoot, readQueue, writeQueue, openDropped } from "./queue.mjs";
import {
  DECISIONS, readDecision, writeDecision, today, isCheckable, kindOf, SERVICE_NOTE, STRUCT_DECISION, parseStructureAnswer,
  LEGAL_DECISION, LEGAL_FIELDS, legalRow, parseLegalAnswer, applyLegalOps, factRec, parseFactAnswer, findInInput,
  answerSheets, sheetSha, ANSWER_SHEET, FACTS_SEED_MAX, FACTS_MAX, cutLabel, landingStructure, str
} from "./_contract.mjs";

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
const forbidden = arr(data.constraints && data.constraints.forbidden);
const hasQueue = isProjectDir(dir);
const q0 = hasQueue ? readQueue(dir) : null;

// Состав сайта (d9): только если его писал анализ, то есть при tier basic.
const structPath = join(dir, "structure_data.json");
let structure = null;
if (data.tier === "basic" && existsSync(structPath)) {
  try { structure = JSON.parse(readFileSync(structPath, "utf8").replace(/^﻿/, "")); }
  catch (e) { die(`structure_data.json не разобран: ${e.message}`); }
  if (!structure || !Array.isArray(structure.pages)) structure = null;
}
const structLine = () => {
  const pg = arr(structure && structure.pages);
  const off = pg.filter((x) => x.target_status === "no").length;
  return `${pg.length - off} страниц${off ? `, снято ${off}` : ""}`;
};

// Цитаты фактов живут в parts/facts-src.json весь срок задачи.
const srcPath = join(dir, "parts", "facts-src.json");
let factsSrc = [];
if (existsSync(srcPath)) {
  try { factsSrc = JSON.parse(readFileSync(srcPath, "utf8").replace(/^﻿/, "")); }
  catch (e) { die(`parts/facts-src.json не разобран: ${e.message}`); }
  if (!Array.isArray(factsSrc)) die("parts/facts-src.json: ожидался массив записей");
}

const short = (s, n = 110) => { const t = String(s == null || s === "" ? "-" : s); return [...t].length > n ? [...t].slice(0, n - 1).join("") + "…" : t; };
const readOne = (d) => readDecision(data, d);

// ---------------------------------------------------------------- образец листа
function template() {
  const out = ["# Лист ответов. Одна строка на ответ. Прочерк или пропуск = молчание.",
    "# После << - дословная фраза заказчика из input/ (переписка, расшифровка), если ответ разобран из прозы или голосового.",
    "# Новый круг ответов - новый файл рядом: answers-2.txt, answers-3.txt. Прежний круг не переписывай.", "",
    "# Смысловые решения: молчание = как в документе 1; «верно» = подтверждение; иначе новый текст целиком."];
  // d6 - вопрос «да или нет»: «да» здесь - выбор, а не подтверждение; подтверждение - «верно» или «ок».
  const hint = (d) => (d.flag ? `. «да» - ${d.onText}, «нет» - ${d.offText}, «верно» или «ок» - как сейчас` : "");
  for (const d of DECISIONS) out.push(`${d.key}: -        # ${d.name}. Сейчас: ${readOne(d) || "не задано"}${hint(d)}`);
  if (structure) out.push(`${STRUCT_DECISION.key}: -        # ${STRUCT_DECISION.name}. Сейчас: ${structLine()}. Правка: убрать <номер|адрес>; вернуть <номер|адрес>`);
  const lr = legalRow(data);
  if (lr) out.push(`${LEGAL_DECISION.key}: -        # ${LEGAL_DECISION.name}. Сейчас: ${lr.value}. Правка: <метка>: <значение> через «;» (метки: ${LEGAL_FIELDS.map((f) => f.label).join(", ")}), «<метка>: убрать» либо «верно»`);
  out.push("", "# Вопросы документа 2 (порядок по ценности, считает verify-data.mjs).");
  gaps.forEach((g) => out.push(`${g.id}: -        # ${g.ask} [ждут блоков: ${arr(g.hits).length}]`));
  const printed = facts.filter((f) => factRec(f, forbidden).text);
  if (printed.length) {
    out.push("", "# Факты (таблица «Ваши цифры» документа 1). Молчание = как в документе 1; «да» = печатаем как есть;",
      "# «нет» = не публикуем (отказ заказчика - «нет», а не прочерк); другой текст = новое значение.");
    printed.forEach((f) => out.push(`${f.id}: -        # ${f.label}: ${short(f.value || f.artifact, 70)} [документ 1: ${factRec(f, forbidden).text}]`));
  }
  out.push("", "# Новый факт без вопроса: «+: что = значение». Факт оператора из отчета текстов: «F8NN: что = значение».");
  return out.join("\n");
}

// ---------------------------------------------------------------- какие листы применяем
const allSheets = answerSheets(dir);
if (!answersArg && !allSheets.length) {
  console.log(`[answers] листа ответов нет: ${join(dir, "answers.txt")}`);
  console.log("  образец ниже - положи его в answers.txt, заполни и запусти снова. Заказчик промолчал - пустой answers.txt тоже ответ.\n");
  console.log(template());
  process.exit(0);
}
const marks = q0 && Array.isArray(q0.answers) ? q0.answers.filter((m) => m && m.file) : [];
// Лист, примененный до программы 28.09: поля answers в queue.json нет, а следы применения
// есть. Такой первый круг считается примененным по прежним правилам и заново не разбирается:
// у старого листа прочерк значил «не публикуем», а фраза после << во входе не искалась.
const legacy = !!q0 && !Array.isArray(q0.answers) && (facts.some((f) => f.publish === "yes" || f.src === "ответ") ||
  arr(q0.journal).some((e) => /по решению d(10|[1-9])(?![0-9])/.test(str(e && e.subject))));
const legacyMarks = legacy ? allSheets.filter((s) => s.round === 1).map((s) => ({ file: s.file, sha: sheetSha(s.path), at: today(), legacy: true })) : [];
let sheets;
if (answersArg) {
  const p = resolve(answersArg);
  if (!existsSync(p)) die(`листа ответов нет: ${p}`);
  sheets = [{ file: relative(dir, p).replace(/\\/g, "/") || basename(p), path: p, round: 0 }];
} else {
  const eff = [...marks, ...legacyMarks];
  const i = allSheets.findIndex((s) => { const m = eff.find((x) => x.file === s.file); return !m || m.sha !== sheetSha(s.path); });
  // Лист до программы, который пересборка вернула в очередь (отметка legacy без суммы),
  // разбирается заново по своим прежним правилам.
  sheets = i === -1 ? [] : allSheets.slice(i).map((s) => ({ ...s, legacy: !!(eff.find((x) => x.file === s.file && x.legacy)) }));
}
const firstEver = !legacy && !marks.length;

// ---------------------------------------------------------------- номера фактов
const numOf = (id) => { const m = /^f(\d{2,3})$/i.exec(str(id)); return m ? Number(m[1]) : 0; };
let partsIds = [];
try { partsIds = arr(JSON.parse(readFileSync(join(dir, "parts", "facts.json"), "utf8").replace(/^﻿/, "")).facts).map((f) => f && f.id); } catch { /* засева нет */ }
const factIds = q0 && q0.fact_ids && typeof q0.fact_ids === "object" && !Array.isArray(q0.fact_ids) ? { ...q0.fact_ids } : {};
let seq = Math.max(0, Number(q0 && q0.facts_seq) || 0, ...facts.map((f) => numOf(f.id)), ...partsIds.map(numOf),
  ...factsSrc.map((x) => numOf(x && x.id)), ...Object.values(factIds).map(numOf));
// 800-999 - диапазоны оператора и служебных фактов kit: туда номера анализа не заходят.
const issue = () => { if (seq + 1 >= 800) return null; seq++; return "f" + String(seq).padStart(seq > 99 ? 3 : 2, "0"); };

// ---------------------------------------------------------------- накопители
const changes = [];   // {field, was, now, from}
const silence = [];   // {what, kept}
const toGaps = [];    // {factId, ask}
const dropped = [];   // {what, ground}
const journal = [];   // {kind, subject, ground, key}
const understood = []; // {sheet, key, answer, as}
const warns = [];
const quotes = [];    // {id, quote, where}
const dropQuotes = new Set();
const applied = [];   // листы, примененные в этом запуске
const factById = new Map(facts.map((f) => [f.id, f]));
const pending = new Set(q0 ? openDropped(q0, new Set(facts.map((f) => f.id))).map((e) => e.key) : []);
let structChanged = false;
let d7Landing = false;  // ответ d7 в этом запуске разобран в «лендинг»

const nextGapId = () => {
  const nums = gaps.map((g) => parseInt(String(g.id).slice(1), 10)).filter(Number.isInteger);
  return "g" + String((nums.length ? Math.max(...nums) : 0) + 1);
};
function askGap(ask, hits, factId) {
  if (gaps.some((g) => plain(g.ask) === plain(ask))) return null;
  if (gaps.length >= 10) { dropped.push({ what: ask, ground: "вопросов уже 10 - потолок документа 2" });
    journal.push({ kind: "dropped", subject: `вопрос «${ask}»`, ground: "в документе 2 уже 10 вопросов, потолок" }); return null; }
  const g = { id: nextGapId(), ask: ask.slice(0, 200), hits: arr(hits).slice(0, 20) };
  gaps.push(g);
  toGaps.push({ factId, ask: g.ask });
  return g;
}
const refs = () => {
  const s = new Set();
  for (const seg of arr(data.audience && data.audience.segments)) for (const o of arr(seg && seg.objection)) for (const id of arr(o && o.facts)) s.add(id);
  const pid = data.offer && data.offer.promise && data.offer.promise.proof_id;
  if (pid) s.add(pid);
  for (const r of arr(data.offer && data.offer.reasons)) for (const id of arr(r && r.facts)) s.add(id);
  return s;
};
// Место под новый факт (Р3): до 40 - свободно; дальше - место снятого факта засева; потом до 50.
function takeSlot(forWhat) {
  if (facts.length < FACTS_SEED_MAX) return "";
  const rs = refs();
  const cand = facts.filter((f) => f.publish === "no" && f.src !== "ответ" && !f.moved_from && !rs.has(f.id) && !pending.has(f.id))
    .sort((a, b) => numOf(a.id) - numOf(b.id))[0];
  if (cand) {
    facts.splice(facts.indexOf(cand), 1);
    factById.delete(cand.id);
    dropQuotes.add(cand.id);
    changes.push({ field: `facts[${cand.id}] ${cand.label}`, was: `${cand.value || cand.artifact || "-"} / publish no`, now: `удален: место отдано ответу ${forWhat}`, from: "" });
    journal.push({ kind: "waiver", key: cand.id, subject: `факт ${cand.id} уступил место ответу - ${cand.label}`,
      ground: `снят (publish no) и ни на что не ссылается; место занял ответ ${forWhat}` });
    return "";
  }
  if (facts.length < FACTS_MAX) return "";
  return `фактов ${facts.length} - потолок ${FACTS_MAX} для ответов, снятых фактов засева на замену нет`;
}
// Цитата факта из ответа (Р2).
function quoteOf(value, from, sheet, line) {
  if (from && !sheet.legacy) {
    const hit = findInInput(dir, from);
    if (!hit) return { drop: `фраза после << не найдена во входе input/ («${short(from, 60)}») - положи переписку или расшифровку в input/ либо убери <<, если заказчик сам написал значение` };
    return { quote: plain(hit.quote).slice(0, 300), where: hit.where };
  }
  return { quote: plain(value).slice(0, 300), where: `${sheet.file}:${line}` };
}
const UNSURE = /^(не знаю|не помню|затрудняюсь|уточню|подумаем|дайте подумать|\?+)(?![а-яa-z0-9])/i;

// Новый факт из ответа: вопрос gN, строка «+» или F8NN. mapKey держит номер за строкой листа.
function newFact({ mapKey, label, value, from, line, sheet, hits, movedFrom, forWhat, key }) {
  const v = plain(value).slice(0, 200);
  const known = (factIds[mapKey] && factById.get(factIds[mapKey])) || (movedFrom && facts.find((f) => f.moved_from === movedFrom)) || null;
  if (known && known.value === v) {
    factIds[mapKey] = known.id;
    silence.push({ what: `${known.id} ${known.label}`, kept: `${v} - ответ ${forWhat} совпал с фактом` });
    return { id: known.id, same: true };
  }
  const qt = quoteOf(v, from, sheet, line);
  if (qt.drop) return { drop: qt.drop };
  if (known) {
    factIds[mapKey] = known.id;
    const was = `${known.value || "-"} / publish ${known.publish}`;
    known.value = v; known.publish = "yes"; known.src = "ответ";
    quotes.push({ id: known.id, ...qt });
    changes.push({ field: `facts[${known.id}] ${known.label} (${forWhat})`, was, now: `${v} / publish yes`, from });
    journal.push({ kind: "waiver", key: known.id, subject: `новое значение по факту ${known.id} - ${known.label}`, ground: `ответ ${forWhat}: ${v}` });
    return { id: known.id };
  }
  const full = takeSlot(forWhat);
  if (full) return { drop: full };
  const id = (factIds[mapKey] && !factById.has(factIds[mapKey])) ? factIds[mapKey] : issue();
  if (!id) return { drop: "номера фактов анализа кончились (f799)" };
  const f = { id, label, value: v, publish: "yes", src: "ответ" };
  if (arr(hits).length) f.q = arr(hits).slice(0, 12);
  f.kind = kindOf(f);
  if (movedFrom) f.moved_from = movedFrom;
  facts.push(f);
  factById.set(id, f);
  factIds[mapKey] = id;
  quotes.push({ id, ...qt });
  changes.push({ field: `facts[${id}] (${forWhat})`, was: "-", now: `${f.label}: ${v} / publish yes / проверяемый ${isCheckable(f) ? "да" : "нет"}`, from });
  journal.push({ kind: "waiver", key: id, subject: `новый факт ${id} из ответа ${forWhat} - ${f.label}`, ground: `заказчик ответил: ${v}` });
  return { id };
}

// ---------------------------------------------------------------- разбор одного листа
function readSheet(sheet) {
  const answers = new Map(), extra = [], unknown = [];
  readFileSync(sheet.path, "utf8").replace(/^﻿/, "").split(/\r?\n/).forEach((raw, i) => {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim() || /^\s*#/.test(line)) return;
    const m = line.match(/^\s*([a-zA-Zа-яА-Я0-9+]+)\s*[:=]\s*(.*)$/);
    if (!m) { unknown.push({ text: plain(line) }); return; }
    const key0 = plain(m[1]), key = key0.toLowerCase();
    let rest = m[2].replace(/\s+#.*$/, "");
    let from = "";
    const cut = rest.split("<<");
    if (cut.length > 1) { rest = cut[0]; from = plain(cut.slice(1).join("<<")).replace(/^[«"']|[»"']$/g, ""); }
    const at = { value: plain(rest), from, line: i + 1 };
    // F8NN отделяется до поиска факта по id: f801 иначе ушел бы в «такого факта нет».
    if (key === "+") extra.push({ ...at, kind: "plus" });
    else if (/^f8\d\d$/.test(key)) extra.push({ ...at, kind: "op", code: "F" + key.slice(1) });
    else if (/^f9\d\d$/.test(key)) unknown.push({ text: `${key0}: ${at.value}`, ground: "служебный факт текстов (F9xx) в анализ не переносится - контакты правятся ответом d10" });
    else if (!/^(d(?:10|[1-9])|f\d{2,3}|g\d{1,2})$/.test(key)) unknown.push({ text: `${key0}: ${at.value}` });
    else answers.set(key, at);
  });
  return { answers, extra, unknown };
}

function applySheet(sheet, first) {
  // Лист до программы 28.09, который разбирается заново (после пересборки или правки): по его
  // правилам прочерк у факта значил «не публикуем», а фраза после << во входе не искалась.
  const { answers, extra, unknown } = readSheet(sheet);
  const tag = sheets.length > 1 ? `[${sheet.file}] ` : "";
  const heard = (key, a, as) => { if (a && a.value && a.value !== "-") understood.push({ sheet: sheet.file, key, answer: a.value, as }); };

  // 1. Восемь решений
  for (const d of DECISIONS) {
    const a = answers.get(d.key);
    const was = readOne(d);
    if (!a || !a.value || a.value === "-") {
      if (first) {
        silence.push({ what: `${d.key} ${d.name}`, kept: was || "не задано" });
        journal.push({ kind: "waiver", key: d.key, subject: `молчание по решению ${d.key} - ${d.name}`,
          ground: `заказчик не поправил, принят рекомендованный дефолт: ${was || "поле пусто"}` });
      }
      continue;
    }
    const r = writeDecision(data, d, a.value);
    if (d.key === "d7" && r.op === "set" && r.value === "landing") d7Landing = true;
    heard(d.key, a, r.as);
    if (r.op === "drop") {
      pending.add(d.key);
      dropped.push({ what: `${tag}${d.key}: ${a.value}`, ground: r.ground });
      journal.push({ kind: "dropped", key: d.key, subject: `${d.key} ${d.name}`, ground: `ответ «${short(a.value, 80)}» не разобран: ${r.ground}` });
      continue;
    }
    pending.delete(d.key);
    const now = readOne(d);
    if (r.op === "accept" || now === was) {
      silence.push({ what: `${d.key} ${d.name}`, kept: `${was || "не задано"} - заказчик подтвердил` });
      journal.push({ kind: "waiver", key: d.key, subject: `подтверждение по решению ${d.key} - ${d.name}`, ground: `заказчик ответил «${short(a.value, 80)}»: ${was || "поле пусто"}` });
      continue;
    }
    changes.push({ field: tag + d.path + (d.flag ? ` (${d.flag})` : ""), was, now, from: a.from });
    journal.push({ kind: "waiver", key: d.key, subject: `ответ по решению ${d.key} - ${d.name}`, ground: `заказчик ответил «${short(a.value, 80)}»: было ${short(was, 60)}, стало ${short(now, 60)}` });
  }

  // 1b. Состав сайта (d9): только target_status, новых страниц разбор ответа не рождает
  if (structure) {
    const a = answers.get(STRUCT_DECISION.key);
    const answered = !!(a && a.value && a.value !== "-");
    const res = parseStructureAnswer(structure, answered ? a.value : "");
    if (res.accept && (answered || first)) {
      silence.push({ what: `${STRUCT_DECISION.key} ${STRUCT_DECISION.name}`, kept: structLine() });
      journal.push({ kind: "waiver", subject: `${answered ? "подтверждение" : "молчание"} по решению ${STRUCT_DECISION.key} - ${STRUCT_DECISION.name}`,
        ground: answered ? `заказчик ответил «${short(a.value, 60)}»: ${structLine()}` : `заказчик не поправил, принят рекомендованный состав: ${structLine()}` });
    }
    heard(STRUCT_DECISION.key, a, res.accept ? "подтверждение состава" : `снять/вернуть: ${res.ops.map((o) => `${o.page.url} ${o.status}`).join(", ") || "-"}${res.dropped.length ? `; не разобрано ${res.dropped.length}` : ""}`);
    for (const op of res.ops) {
      const was = op.page.target_status;
      if (was === op.status) { silence.push({ what: `${STRUCT_DECISION.key} ${op.page.url}`, kept: `target_status ${was} - ответ совпал с составом` }); continue; }
      op.page.target_status = op.status;
      structChanged = true;
      changes.push({ field: `${tag}structure_data.json ${op.page.url} (${op.page.name})`, was: `target_status ${was}`, now: `target_status ${op.status}`, from: a.from || a.value });
    }
    for (const d of res.dropped) {
      dropped.push({ what: `${tag}${STRUCT_DECISION.key}: ${d.token}`, ground: d.ground });
      journal.push({ kind: "dropped", subject: `${STRUCT_DECISION.key} ${STRUCT_DECISION.name}: «${d.token}»`, ground: d.ground });
    }
  } else if (answers.has(STRUCT_DECISION.key) && answers.get(STRUCT_DECISION.key).value && answers.get(STRUCT_DECISION.key).value !== "-") {
    dropped.push({ what: `${tag}${STRUCT_DECISION.key}: ${answers.get(STRUCT_DECISION.key).value}`, ground: data.tier === "seo" ? "tier seo: состав решает /seo-struktura" : "structure_data.json нет - сначала pages-planner" });
  }

  // 1c. Контакты и реквизиты (d10): только поля business.legal по меткам. Молчание и
  // подтверждение - waiver (контакты сверены), правка или неразобранный ответ - gap.
  {
    const row = legalRow(data);
    const a = answers.get(LEGAL_DECISION.key);
    const answered = !!(a && a.value && a.value !== "-");
    if ((row && first) || answered) {
      const res = parseLegalAnswer(data.business && data.business.legal, answered ? a.value : "");
      const subj = (w) => `${w} по решению ${LEGAL_DECISION.key} - ${LEGAL_DECISION.name}`;
      const what = `${LEGAL_DECISION.key} ${LEGAL_DECISION.name}`;
      heard(LEGAL_DECISION.key, a, res.accept ? "подтверждение" : `правка: ${res.ops.map((o) => `${o.label} ${o.remove ? "убрать" : o.now}`).join("; ") || "-"}${res.dropped.length ? `; не разобрано ${res.dropped.length}` : ""}`);
      if (res.silent) {
        silence.push({ what, kept: row.value });
        journal.push({ kind: "waiver", subject: subj("молчание"), ground: `заказчик не поправил, принят рекомендованный дефолт: ${row.value}` });
      } else {
        for (const op of res.ops) changes.push({ field: `${tag}business.legal.${op.key} (${LEGAL_DECISION.key} ${op.label})`, was: op.was || "-", now: op.now, from: a.from });
        applyLegalOps(data, res.ops);
        for (const d of res.dropped) {
          dropped.push({ what: `${tag}${LEGAL_DECISION.key}: ${d.token}`, ground: d.ground });
          journal.push({ kind: "dropped", subject: `${what}: «${short(d.token, 60)}»`, ground: d.ground });
        }
        if (res.ops.length) {
          journal.push({ kind: "gap", subject: subj("правка"),
            ground: `заказчик поправил: ${res.ops.map((o) => o.label).join(", ")}${res.dropped.length ? `; не разобрано кусков ответа: ${res.dropped.length}` : ""} - новые значения сверить до публикации` });
        } else if (res.dropped.length) {
          journal.push({ kind: "gap", subject: subj("правка"), ground: `ответ «${short(a.value, 80)}» не разобран в поля - контакты не сверены, сверь с заказчиком` });
        } else {
          silence.push({ what, kept: `${row ? row.value : "-"} - заказчик подтвердил` });
          journal.push({ kind: "waiver", subject: subj("подтверждение"),
            ground: `заказчик ответил «${short(a.value, 60)}»: контакты и реквизиты верны${res.same.length ? ` (совпало: ${res.same.join(", ")})` : ""}` });
        }
      }
    }
  }

  // 2. Факты: три состояния строки и молчание первого круга
  const mentioned = new Set();
  for (const [key, a] of answers) {
    if (!/^f\d{2,3}$/.test(key)) continue;
    const f = factById.get(key);
    if (!f) {
      // Без ключа: по факту, которого нет, публиковать нечего - гейт такую строку не держит
      // (иначе опечатка «f77» или ответ по факту, уступившему место, держали бы гейт навсегда).
      dropped.push({ what: `${tag}${key}: ${a.value}`, ground: "такого факта в контракте нет" });
      journal.push({ kind: "dropped", subject: `ответ по ${key}`, ground: `факта ${key} в контракте нет` });
      continue;
    }
    const r = parseFactAnswer(a.value);
    if (r.op === "silence" && !(sheet.legacy && a.value === "-")) continue;
    if (r.op === "silence") { r.op = "refuse"; r.as = "прочерк старого листа - не публикуем"; }
    mentioned.add(key);
    const was = `${f.value || f.artifact || "-"} / publish ${f.publish}`;
    let op = r.op, ground = r.ground, qt = null, v = "";
    if (op === "set") {
      v = plain(r.value).slice(0, 200);
      // Значение совпало - это подтверждение: цитата и источник прежние. Лист до программы
      // разбирается по прежним правилам: там строка со значением всегда давала источник «ответ».
      if (v === f.value && !sheet.legacy) op = "accept";
      else { qt = quoteOf(v, a.from, sheet, a.line); if (qt.drop) { op = "drop"; ground = qt.drop; } }
    }
    heard(key, a, op === "drop" ? `не разобрано: ${ground}` : op === "accept" ? "да - печатаем как есть" : op === "refuse" ? "нет - не публикуем" : `новое значение «${v}»`);
    if (op === "drop") {
      f.publish = "no";
      pending.add(key);
      dropped.push({ what: `${tag}${key}: ${a.value}`, ground: `${ground}; факт не публикуем, пока строку не поправят` });
      askGap(`Уточните: ${f.label}`, f.q, key);
      journal.push({ kind: "dropped", key, subject: `ответ по факту ${key} - ${f.label}`, ground: `«${short(a.value, 80)}»: ${ground}; publish no до правки строки` });
      continue;
    }
    pending.delete(key);
    // Вопрос «Уточните: ...», заведенный по этому факту прежним «не разобрано», закрыт ответом.
    const asked = gaps.findIndex((g) => plain(g.ask) === plain(`Уточните: ${f.label}`));
    if (asked !== -1) gaps.splice(asked, 1);
    if (op === "accept") {
      const rec = factRec(f, forbidden);
      if (!rec.publish) warns.push(`${key} «${f.label}»: заказчик подтвердил факт, который документ 1 не предлагал (${rec.why}) - публикуем по его слову`);
      if (f.publish !== "yes") changes.push({ field: `${tag}facts[${key}] ${f.label}`, was, now: `${f.value || f.artifact} / publish yes (значение и цитата прежние)`, from: a.from });
      else silence.push({ what: `${key} ${f.label}`, kept: "publish yes - заказчик подтвердил" });
      f.publish = "yes";
      journal.push({ kind: "waiver", key, subject: `подтверждение по факту ${key} - ${f.label}`, ground: `заказчик ответил «${short(a.value, 60)}»: публикуем как напечатано` });
    } else if (op === "refuse") {
      if (f.publish !== "no") changes.push({ field: `${tag}facts[${key}] ${f.label}`, was, now: "publish no - заказчик снял", from: a.from });
      else silence.push({ what: `${key} ${f.label}`, kept: "publish no - заказчик снял" });
      f.publish = "no";
      journal.push({ kind: "waiver", key, subject: `отказ по факту ${key} - ${f.label}`, ground: `заказчик ответил «${short(a.value, 60)}»: не публикуем` });
    } else {
      f.value = v;
      f.publish = "yes";
      // Источник у факта, выросшего из ответа заказчика, - его ответ, а не бриф, которого
      // могло не быть вовсе. Документ 1 печатает эту колонку заказчику, она обязана быть правдой.
      f.src = "ответ";
      quotes.push({ id: f.id, quote: qt.quote, where: qt.where });
      changes.push({ field: `${tag}facts[${f.id}] ${f.label}`, was, now: `${f.value} / publish yes / проверяемый ${isCheckable(f) ? "да" : "нет"}`, from: a.from });
      journal.push({ kind: "waiver", key, subject: `новое значение по факту ${key} - ${f.label}`, ground: `заказчик ответил: ${short(v, 120)}` });
    }
  }
  if (first) {
    for (const f of facts.slice()) {
      if (mentioned.has(f.id)) continue;
      const rec = factRec(f, forbidden);
      f.publish = rec.publish ? "yes" : "no";
      silence.push({ what: `${f.id} ${f.label}`, kept: rec.publish ? "publish yes - как в документе 1" : `publish no - ${rec.why}` });
      journal.push({ kind: "waiver", key: f.id, subject: `молчание по факту ${f.id} - ${f.label}`,
        ground: `первый круг: принят документ 1 - ${rec.text || "строки в документе нет"}` });
    }
  }

  // 3. Вопросы документа 2
  for (const [key, a] of answers) {
    if (!/^g\d{1,2}$/.test(key)) continue;
    const gi = gaps.findIndex((g) => g.id === key);
    const mapKey = `${sheet.file}#${key}`;
    const g = gi === -1 ? null : gaps[gi];
    if (!a.value || a.value === "-") {
      if (g) {
        silence.push({ what: `${key} ${g.ask}`, kept: "вопрос остается в документе 2" });
        journal.push({ kind: "gap", key, subject: `молчание по вопросу ${key}`, ground: `${g.ask} - ответа нет, вопрос остается открытым` });
      }
      continue;
    }
    if (!g && !(factIds[mapKey] && factById.has(factIds[mapKey]))) {
      dropped.push({ what: `${tag}${key}: ${a.value}`, ground: "такого вопроса в документе 2 нет" });
      journal.push({ kind: "dropped", key, subject: `ответ по ${key}`, ground: `вопроса ${key} в контракте нет` });
      continue;
    }
    if (SERVICE_NOTE.test(a.value) || UNSURE.test(a.value)) {
      heard(key, a, "не факт: вопрос остается");
      silence.push({ what: `${key} ${g ? g.ask : ""}`, kept: "ответ - служебная пометка, вопрос остается в документе 2" });
      journal.push({ kind: "gap", key, subject: `пометка вместо ответа по вопросу ${key}`, ground: `«${a.value}» - это не факт; вопрос остается открытым` });
      continue;
    }
    const label = g ? cutLabel(plain(g.ask).replace(/^Уточните:\s*/i, ""), 80) : factById.get(factIds[mapKey]).label;
    const res = newFact({ mapKey, label, value: a.value, from: a.from, line: a.line, sheet, hits: g && g.hits, forWhat: key, key });
    heard(key, a, res.drop ? `не разобрано: ${res.drop}` : `факт ${res.id}${res.same ? " (без изменений)" : ""}`);
    if (res.drop) {
      dropped.push({ what: `${tag}${key}: ${a.value}`, ground: res.drop });
      journal.push({ kind: "dropped", key, subject: `ответ по ${key}`, ground: res.drop });
      continue;
    }
    const at = gaps.findIndex((x) => x.id === key);
    if (at !== -1) gaps.splice(at, 1);
  }

  // 4. Новые факты без вопроса: «+» и факты оператора F8NN из отчета текстов
  for (const e of extra) {
    const code = e.kind === "op" ? e.code : "+";
    const eq = e.value.indexOf("=");
    const label = eq === -1 ? "" : cutLabel(plain(e.value.slice(0, eq)), 80);
    const value = eq === -1 ? "" : plain(e.value.slice(eq + 1));
    let ground = "";
    if (eq === -1 || Array.from(label).length < 2 || !value) ground = `нужна строка «${code}: что = значение»`;
    else if (SERVICE_NOTE.test(value) || UNSURE.test(value)) ground = "служебная пометка, а не факт";
    const forWhat = e.kind === "op" ? e.code : `«+: ${short(label, 40)}»`;
    const res = ground ? { drop: ground } : newFact({ mapKey: `${sheet.file}#${e.kind === "op" ? e.code : "+" + label.toLowerCase()}`, label, value, from: e.from, line: e.line, sheet, movedFrom: e.kind === "op" ? e.code : "", forWhat });
    understood.push({ sheet: sheet.file, key: code, answer: e.value, as: res.drop ? `не разобрано: ${res.drop}` : `факт ${res.id}${res.same ? " (без изменений)" : ""}` });
    if (res.drop) {
      dropped.push({ what: `${tag}${code}: ${e.value}`, ground: res.drop });
      journal.push({ kind: "dropped", subject: `новый факт ${forWhat}`, ground: res.drop });
    }
  }

  for (const u of unknown) {
    dropped.push({ what: tag + u.text, ground: u.ground || "строка листа не разобрана" });
    journal.push({ kind: "dropped", subject: `строка листа «${short(u.text, 60)}»`, ground: u.ground || "строка не в формате <ключ>: <ответ>" });
  }
  applied.push(sheet);
}

sheets.forEach((s, i) => applySheet(s, firstEver && i === 0));

// ------------------------------------------------ тип сайта и состав лендинга (d7, d8)
const gateWas = !!(q0 && q0.gate && q0.gate.approved === true);
const gateReset = gateWas && sheets.length > 0;
const kindNow = str(data.business && data.business.site_kind), typeNow = str(data.business && data.business.type);
const queueSync = [];
if (q0) {
  if (["landing", "multipage"].includes(kindNow) && q0.site_kind !== kindNow) queueSync.push(["site_kind", kindNow]);
  if (["services", "shop", "both"].includes(typeNow) && q0.type !== typeNow) queueSync.push(["type", typeNow]);
}
// Состав лендинга пишется сам только по ответу d7 этого запуска либо когда состава нет вовсе:
// тип сайта из старого контракта молча не переписывает состав планировщика. Прежний состав
// уходит в structure_data.prev.json - смена d7 обратима без повторного планировщика.
let landingWritten = false, landingSkipped = false, prevStructure = null;
if (data.tier === "basic" && kindNow === "landing") {
  const ok = structure && arr(structure.pages).length === 1 && str(structure.source_file) === "site-analiz";
  const had = existsSync(structPath);
  if (!ok && (d7Landing || !had)) {
    if (had) { try { prevStructure = readFileSync(structPath, "utf8"); } catch { prevStructure = null; } }
    structure = landingStructure(data); structChanged = true; landingWritten = true;
  } else if (!ok) landingSkipped = true;
}

data.facts = facts;
data.gaps = gaps;
if (data.updated && sheets.length) data.updated = today();

// ---------------------------------------------------------------- дифф-лист
if (!quiet) {
  console.log(`[answers] ${projPath}`);
  console.log(`  листы: ${sheets.length ? sheets.map((s, i) => `${s.file}${s.legacy ? " (лист до программы 28.09: прочерк - «не публикуем», фраза после << не ищется)" : firstEver && i === 0 ? " (первое применение: молчание = документ 1)" : " (молчание ничего не меняет)"}`).join(", ") : "все уже применены"}`);
  if (legacy) {
    const unmarked = legacyMarks.filter((m) => !marks.some((x) => x.file === m.file)).map((m) => m.file);
    console.log("  первый круг применен до программы 28.09 - заново не разбирается");
    if (unmarked.length) console.log(`  отметка листа до программы (${unmarked.join(", ")}) ${apply ? "записывается сейчас" : "будет записана при --apply, без нее гейт откажет"}; правки этого листа не применяются - новый круг answers-2.txt`);
  }
  console.log(`  режим: ${apply ? "ЗАПИСЬ" : "просмотр, файлы не тронуты"}`);
  if (understood.length) {
    console.log("\nКАК ПОНЯТЫ ОТВЕТЫ");
    for (const u of understood) console.log(`  ${sheets.length > 1 ? `[${u.sheet}] ` : ""}${u.key}: «${short(u.answer, 70)}» -> ${short(u.as, 120)}`);
  }
  console.log("\nДИФФ-ЛИСТ");
  if (!changes.length) console.log("  изменений нет.");
  changes.forEach((c, i) => {
    console.log(`  ${i + 1}. ${c.field}`);
    console.log(`     было:        ${short(c.was)}`);
    console.log(`     стало:       ${short(c.now)}`);
    console.log(`     на основании: ${c.from ? "«" + short(c.from, 120) + "»" : "ответ листа, дословной фразы нет"}`);
  });
  if (silence.length) {
    console.log("\nМОЛЧАНИЕ И ПОДТВЕРЖДЕНИЯ (записано в журнал)");
    for (const s of silence) console.log(`  ${s.what} -> ${short(s.kept)}`);
  }
  if (toGaps.length) {
    console.log("\nУШЛО В ВОПРОСЫ ДОКУМЕНТА 2");
    for (const g of toGaps) console.log(`  ${g.factId} -> ${g.ask}`);
  }
  if (dropped.length) {
    console.log("\nНЕ РАЗОБРАНО (гейт ждет правки строк по фактам и d1-d8)");
    for (const d of dropped) console.log(`  ${short(d.what)} - ${d.ground}`);
  }
  if (warns.length) {
    console.log("\nВНИМАНИЕ");
    for (const w of warns) console.log(`  ${w}`);
  }
  if (quotes.length || dropQuotes.size) {
    console.log("\nЦИТАТЫ ФАКТОВ (в parts/facts-src.json)");
    for (const q of quotes) console.log(`  ${q.id} <- ${q.where}: «${short(q.quote, 90)}»`);
    for (const id of dropQuotes) console.log(`  ${id} - удалена вместе с фактом`);
  }
  if (queueSync.length) console.log(`\nQUEUE.JSON: ${queueSync.map(([k, v]) => `${k} -> ${v}`).join(", ")} (ответ заказчика по d7/d8 - источник для пересборки)`);
  if (landingWritten) console.log(`\nСОСТАВ: сайт - лендинг (ответ d7), structure_data.json - одна главная (пишется тут же, планировщик не нужен)${prevStructure ? "; прежний состав - в structure_data.prev.json" : ""}`);
  else if (landingSkipped) console.log("\nСОСТАВ: сайт - лендинг, а состав не лендинга и ответа d7 «лендинг» в листе нет - состав не трогаю: d7 в новом круге либо build-project.mjs <каталог>");
  else if (data.tier === "basic" && kindNow === "multipage" && structure && str(structure.source_file) === "site-analiz") console.log("\nСОСТАВ: сайт многостраничный, а состав - одна главная лендинга: шаг 3b, pages-planner");
  if (gateReset) console.log(`\nГЕЙТ: пройден раньше (${q0.gate.at}), а круг применяется после него - при записи гейт сбрасывается (прежняя отметка - gate.prev): verify-data, затем gate`);
  console.log(`\nИТОГ: изменений ${changes.length}, молчаний и подтверждений ${silence.length}, вопросов в документе 2 ${gaps.length}, не разобрано ${dropped.length}, фактов ${facts.length}`);
}

// ---------------------------------------------------------------- запись
if (!apply) {
  console.log("\nФайлы не изменены. Запись - тот же дифф-лист и флаг --apply:");
  console.log(`  node .claude/scripts/site/apply-answers.mjs ${dir} --apply`);
  process.exit(0);
}

writeFileSync(projPath, JSON.stringify(data, null, 2) + "\n", "utf8");
console.log(`\n[answers] записано: ${projPath}`);
if (prevStructure) { writeFileSync(join(dir, "structure_data.prev.json"), prevStructure, "utf8"); console.log(`  прежний состав: ${join(dir, "structure_data.prev.json")}`); }
if (structChanged) { writeFileSync(structPath, JSON.stringify(structure, null, 2) + "\n", "utf8"); console.log(`  состав сайта: ${structPath} (${structLine()})`); }
const outside = applied.filter((s) => !ANSWER_SHEET.test(s.file) || s.file.includes("/"));
if (quotes.length && outside.length) {
  console.log(`  ВНИМАНИЕ: ${outside.map((s) => s.file).join(", ")} вне корпуса сверки - verify-data ищет цитаты в input/ и в answers*.txt каталога ${dir}: положи лист туда`);
}
if (quotes.length || dropQuotes.size) {
  const ids = new Set([...quotes.map((q) => q.id), ...dropQuotes]);
  const next = factsSrc.filter((x) => !(x && ids.has(x.id))).concat(quotes);
  mkdirSync(join(dir, "parts"), { recursive: true });
  writeFileSync(srcPath, JSON.stringify(next, null, 2) + "\n", "utf8");
  console.log(`  цитаты фактов: ${quotes.length} записей${dropQuotes.size ? `, удалено ${dropQuotes.size}` : ""} в ${srcPath}`);
}
if (hasQueue) {
  let n = 0;
  for (const j of journal) { try { appendJournal(dir, j.kind, j.subject, j.ground, j.key); n++; } catch (e) { console.log(`  журнал отказал: ${e.message}`); } }
  console.log(`  журнал исключений: ${n} записей`);
  const q = readQueue(dir);
  for (const [k, v] of queueSync) q[k] = v;
  const done = new Set(applied.map((s) => s.file));
  const keep = (Array.isArray(q.answers) ? q.answers : []).filter((m) => m && !done.has(m.file));
  for (const m of legacyMarks) if (!done.has(m.file) && !keep.some((x) => x.file === m.file)) keep.push(m);
  for (const s of applied) keep.push({ file: s.file, sha: sheetSha(s.path), at: today(), ...(s.legacy ? { legacy: true } : {}) });
  q.answers = keep;
  q.facts_seq = seq;
  q.fact_ids = factIds;
  if (gateReset) {
    const { prev, ...was } = q.gate || {};
    q.gate = { approved: false, by: "", at: "", prev: was };
  }
  writeQueue(dir, q);
  if (gateReset) {
    const e = appendJournal(dir, "waiver", "гейт сброшен: круг ответов после гейта", `применено после гейта ${q0.gate.at}: ${applied.map((x) => x.file).join(", ")} - нужны verify-data и новый gate`);
    console.log(`  ГЕЙТ СБРОШЕН (${e.id}): круг применен после гейта - verify-data, затем gate`);
  }
  console.log(`  отметки листов: ${keep.map((m) => `${m.file}${m.legacy ? " (до программы)" : ""}`).join(", ") || "-"}`);
} else console.log("  журнала нет: рядом нет queue.json (запусти queue.mjs init)");
console.log("  дальше: node .claude/scripts/site/verify-data.mjs <каталог>   (пересчитает ворота и вес вопросов)");
console.log("          node .claude/scripts/site/queue.mjs gate --by \"<кто согласовал>\"");
process.exit(0);
