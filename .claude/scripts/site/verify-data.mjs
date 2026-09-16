#!/usr/bin/env node
// verify-data.mjs
// Валидатор контракта v8: project.json против project.schema.json ПЛЮС проверки, которых
// схема не умеет в принципе - бюджет знаков, запрет полей-обоснований по всему дереву,
// пересчет и перезапись gates, ссылочная целостность с pages.yml, засев publish, типографика.
//
// Обход схемы, определение проверяемого факта и разбор pages.yml лежат в _contract.mjs -
// том же модуле, которым пользуется сборщик. Двух определений одного правила в этапе нет.
//
// Использование:
//   node verify-data.mjs <project.json|каталог> [--pages <pages.yml>] [--schema <file>]
//                        [--seed] [--no-write] [--quiet]
//   --seed     режим засева: любой факт с publish=yes - нарушение (yes ставит только гейт)
//   --no-write не переписывать gates и gaps[].weight в файле (по умолчанию переписываем)
//
// Exit: 0 чисто | 1 предупреждения | 2 нарушения (или файл не читается).

import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  arr, str, isCheckable, hasNumber, walkBanned, walkTypo, budget, BUDGET_WARN, BUDGET_MAX,
  readPages, PAGES_CHARS_MAX, PAGE_TYPES, NEEDS_KINDS, BLOCK_FN, validate, THIN
} from "./_contract.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
let target = null, pagesArg = null, schemaArg = null;
let seedMode = false, noWrite = false, quiet = false;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--pages") pagesArg = argv[++i] || null;
  else if (a === "--schema") schemaArg = argv[++i] || null;
  else if (a === "--seed") seedMode = true;
  else if (a === "--no-write") noWrite = true;
  else if (a === "--quiet") quiet = true;
  else if (!target) target = a;
}
if (!target) { console.error("[verify-data] usage: <project.json|каталог> [--pages <pages.yml>] [--schema <file>] [--seed] [--no-write]"); process.exit(2); }

const projPath = existsSync(target) && statSync(target).isDirectory() ? join(resolve(target), "project.json") : resolve(target);
const pagesPath = pagesArg ? resolve(pagesArg) : resolve(HERE, "..", "..", "skills", "site-proto", "pages.yml");
const schemaPath = schemaArg ? resolve(schemaArg) : resolve(HERE, "..", "..", "skills", "site-analiz", "project.schema.json");

const violations = [], warnings = [], infos = [];
const V = (path, msg) => violations.push(path ? `${path}: ${msg}` : msg);
const W = (path, msg) => warnings.push(path ? `${path}: ${msg}` : msg);
const I = (msg) => infos.push(msg);

function readJson(p, what) {
  if (!existsSync(p)) { console.error(`[verify-data] нет файла ${what}: ${p}`); process.exit(2); }
  try { return JSON.parse(readFileSync(p, "utf8").replace(/^﻿/, "")); }
  catch (e) { console.error(`[verify-data] ${what} не разобран (${p}): ${e.message}`); process.exit(2); }
}

// ---------------------------------------------------------------- pages.yml
const pages = readPages(pagesPath);
if (!pages) { console.error(`[verify-data] нет pages.yml: ${pagesPath}`); process.exit(2); }
const blockIds = new Set(pages.blocks.keys());
const sigIds = new Set(pages.sig);

// инварианты самого pages.yml: они держат контракт, поэтому проверяются здесь же
{
  const FN = new Set(BLOCK_FN);
  const NEEDS = new Set(NEEDS_KINDS);
  if (pages.chars > PAGES_CHARS_MAX) W("pages.yml", `${pages.chars} знаков, потолок ${PAGES_CHARS_MAX}`);
  if (pages.blocks.size > 30) W("pages.yml", `${pages.blocks.size} id блоков, потолок 30`);
  if (pages.sig.length !== 9) W("pages.yml", `признаков ниши ${pages.sig.length}, должно быть ровно 9`);
  let vCount = 0;
  for (const [id, cols] of pages.blocks) {
    if (cols.length !== 7) { V(`pages.yml blocks.${id}`, `колонок ${cols.length}, должно быть 7`); continue; }
    if (!FN.has(cols[0])) V(`pages.yml blocks.${id}`, `функция «${cols[0]}» вне набора ${BLOCK_FN.join(" ")}`);
    if (!NEEDS.has(cols[5])) V(`pages.yml blocks.${id}`, `NEEDS «${cols[5]}» вне закрытого списка: ${NEEDS_KINDS.join(", ")}`);
    if (cols[0] === "В") vCount++;
  }
  if (pages.blocks.size && vCount * 2 > pages.blocks.size) W("pages.yml", `блоков функции В ${vCount} из ${pages.blocks.size} - больше половины`);
  for (const t of PAGE_TYPES) {
    if (!pages.skel.has(t)) W("pages.yml skel", `нет типа страницы ${t}`);
  }
  if (pages.skel.has("article")) V("pages.yml skel", "типа страницы article не существует");
}

// ---------------------------------------------------------------- схема
const schema = readJson(schemaPath, "схема");
const data = readJson(projPath, "project.json");
validate(data, schema, "", schema, V);

// ------------------------------------------- запрет полей-обоснований по всему дереву
// Отдельная проверка, а не следствие схемы: схема ловит лишнее поле только там, где стоит
// additionalProperties false, и молчит про вложенные структуры, которых она не описывает.
walkBanned(data, (p, k) => V(p, `поле-обоснование «${k}» запрещено в контракте v8 - решение печатается без защиты`));

// ---------------------------------------------------------------- типографика
// Клиентские строки: длинное и среднее тире и е-с-точками - ошибка по правилу репозитория.
walkTypo(data, (p, kinds) => V(p, `${kinds} в клиентской строке - только дефис и е`));

// ---------------------------------------------------------------- бюджет знаков
// Меряем компактный JSON: отступы форматирования к содержанию отношения не имеют.
{
  const { size, fat } = budget(data);
  I(`бюджет: ${size} знаков (предупреждение ${BUDGET_WARN}, ошибка ${BUDGET_MAX}); самый толстый массив ${fat.path} - ${fat.size} знаков, элементов ${fat.n}`);
  if (size >= BUDGET_MAX) V("", `бюджет файла ${size} знаков, потолок ${BUDGET_MAX} - режь массив ${fat.path} (${fat.size} знаков, элементов ${fat.n})`);
  else if (size >= BUDGET_WARN) W("", `бюджет файла ${size} знаков, порог ${BUDGET_WARN} - самый толстый массив ${fat.path} (${fat.size} знаков, элементов ${fat.n})`);
}

// ---------------------------------------------------------------- ссылки на pages.yml
const facts = arr(data.facts);
const gaps = arr(data.gaps);
{
  facts.forEach((f, i) => arr(f && f.q).forEach((q, j) => {
    if (!blockIds.has(q)) V(`facts[${i}].q[${j}]`, `«${q}» не id блока из pages.yml`);
  }));
  gaps.forEach((g, i) => arr(g && g.hits).forEach((h, j) => {
    if (!blockIds.has(h)) V(`gaps[${i}].hits[${j}]`, `«${h}» не id блока из pages.yml`);
  }));
  const mh = arr(data.competitors && data.competitors.market && data.competitors.market.must_have);
  mh.forEach((b, i) => { if (!blockIds.has(b)) V(`competitors.market.must_have[${i}]`, `«${b}» не id блока из pages.yml`); });
  arr(data.business && data.business.sig).forEach((s, i) => {
    if (!sigIds.has(s)) V(`business.sig[${i}]`, `«${s}» не признак ниши из pages.yml (их 9: ${[...sigIds].join(", ")})`);
  });
}

// ---------------------------------------------------------------- тонкая фактура
// Порог, а не минимум схемы. Минимум означал бы «допиши до числа», то есть выдумай.
{
  const dirs = arr(data.business && data.business.directions).length;
  if (facts.length < THIN.facts) W("facts", `фактов ${facts.length}, порог отчета ${THIN.facts} - это законно: тексты выйдут короче, недостающее стоит вопросами в gaps`);
  if (dirs < THIN.directions) W("business.directions", `направлений ${dirs}, порог отчета ${THIN.directions} - законно для одной услуги и для лендинга`);
}

// ---------------------------------------------------------------- внутренние ссылки
{
  const dirs = arr(data.business && data.business.directions);
  const dirIds = new Set(), roots = new Set();
  dirs.forEach((d, i) => {
    const id = d && d.id;
    if (!id) return;
    if (dirIds.has(id)) V(`business.directions[${i}].id`, `id «${id}» повторяется`);
    dirIds.add(id);
    if (!d.parent) roots.add(id);
  });
  dirs.forEach((d, i) => {
    if (!d || !d.parent) return;
    if (!dirIds.has(d.parent)) V(`business.directions[${i}].parent`, `нет направления «${d.parent}»`);
    else if (!roots.has(d.parent)) V(`business.directions[${i}].parent`, `глубина больше 2: родитель «${d.parent}» сам вложен`);
  });
  const segs = arr(data.audience && data.audience.segments);
  const segIds = new Set();
  segs.forEach((s, i) => {
    if (!s || !s.id) return;
    if (segIds.has(s.id)) V(`audience.segments[${i}].id`, `id «${s.id}» повторяется`);
    segIds.add(s.id);
  });
  segs.forEach((s, i) => arr(s && s.dirs).forEach((d, j) => {
    if (!dirIds.has(d)) W(`audience.segments[${i}].dirs[${j}]`, `«${d}» нет среди направлений`);
  }));
  dirs.forEach((d, i) => arr(d && d.serves).forEach((s, j) => {
    if (!segIds.has(s)) W(`business.directions[${i}].serves[${j}]`, `«${s}» нет среди сегментов`);
  }));
  const factIds = new Set();
  facts.forEach((f, i) => {
    if (!f || !f.id) return;
    if (factIds.has(f.id)) V(`facts[${i}].id`, `id «${f.id}» повторяется`);
    factIds.add(f.id);
  });
  const pid = data.offer && data.offer.promise && data.offer.promise.proof_id;
  if (pid && !factIds.has(pid)) V("offer.promise.proof_id", `нет факта «${pid}»`);
  const gapIds = new Set();
  gaps.forEach((g, i) => {
    if (!g || !g.id) return;
    if (gapIds.has(g.id)) V(`gaps[${i}].id`, `id «${g.id}» повторяется`);
    gapIds.add(g.id);
  });
}

// ---------------------------------------------------------------- засев publish
{
  const yes = facts.map((f, i) => [i, f]).filter(([, f]) => f && f.publish === "yes");
  if (seedMode && yes.length) {
    for (const [i, f] of yes) V(`facts[${i}].publish`, `при засеве обязан быть "no" (факт «${f.label || f.id}»), yes ставит только гейт`);
  } else if (yes.length) {
    I(`фактов с publish=yes: ${yes.length} из ${facts.length} (гейт уже прошел; для проверки засева запускай с --seed)`);
  }
  const noQ = facts.filter((f) => !arr(f && f.q).length).length;
  if (facts.length && noQ * 2 > facts.length) {
    W("facts", `${noQ} из ${facts.length} фактов не нужны ни одному блоку (пустой q) - это вес файла без применения`);
  }
  const blind = facts.map((f, i) => [i, f]).filter(([, f]) => f && f.publish === "yes" && !isCheckable(f) && hasNumber(f.value));
  for (const [i, f] of blind) I(`facts[${i}] «${f.label}»: цифра есть, единицы нет - проверяемым не считается`);
}

// ---------------------------------------------------------------- gates: пересчет и перезапись
let changed = false;
{
  const promiseResult = str((data.offer && data.offer.promise && data.offer.promise.result) || "");
  const reasons = arr(data.offer && data.offer.reasons);
  const checkable = facts.filter((f) => f && f.publish === "yes" && isCheckable(f));
  const calc = {
    promise: promiseResult.length > 0,
    facts3: checkable.length >= 3,
    proof1: reasons.some((r) => str((r && r.proof) || "").length > 0),
    ready: false
  };
  calc.ready = calc.promise && calc.facts3 && calc.proof1;
  const was = data.gates && typeof data.gates === "object" ? data.gates : {};
  const diff = ["promise", "facts3", "proof1", "ready"].filter((k) => was[k] !== calc[k]);
  if (diff.length) {
    changed = true;
    W("gates", `агент не вправе проставлять ворота, пересчитаны из данных: ${diff.map((k) => `${k} ${was[k]} -> ${calc[k]}`).join(", ")}`);
  }
  data.gates = calc;
  I(`ворота: promise ${calc.promise}, facts3 ${calc.facts3} (проверяемых опубликованных фактов ${checkable.length}), proof1 ${calc.proof1}, ready ${calc.ready}`);
  if (!calc.ready) I("ready false - это не брак сам по себе: значит тексты пишутся короче, а недостающее уехало в gaps");
}

// ---------------------------------------------------------------- gaps: вес и порядок
{
  const before = gaps.map((g) => (g && g.id) || "");
  for (let i = 0; i < gaps.length; i++) {
    const g = gaps[i];
    if (!g || typeof g !== "object") continue;
    const w = new Set(arr(g.hits).filter((h) => blockIds.has(h))).size;
    if (g.weight !== w) { changed = true; g.weight = w; }
    else g.weight = w;
  }
  const sorted = gaps.slice().sort((a, b) => ((b && b.weight) || 0) - ((a && a.weight) || 0));
  const after = sorted.map((g) => (g && g.id) || "");
  if (before.join("|") !== after.join("|")) {
    changed = true;
    W("gaps", `порядок вопросов не по ценности, отсортированы по weight: ${after.join(", ")}`);
    data.gaps = sorted;
  }
  if (gaps.length) I(`вопросов в документе 2: ${gaps.length} (потолок 10), верхний вес ${(sorted[0] && sorted[0].weight) || 0} блоков`);
}

if (changed && !noWrite) {
  try {
    writeFileSync(projPath, JSON.stringify(data, null, 2) + "\n", "utf8");
    I("gates и gaps[].weight перезаписаны в project.json");
  } catch (e) { W("", `не удалось записать project.json: ${e.message}`); }
}

// ---------------------------------------------------------------- отчет
if (!quiet) {
  console.log(`[verify-data] ${projPath}  (фактов ${facts.length}, направлений ${arr(data.business && data.business.directions).length}, сегментов ${arr(data.audience && data.audience.segments).length}, вопросов ${arr(data.gaps).length})`);
  for (const m of infos) console.log("   i " + m);
  if (warnings.length) { console.log("  предупреждения:"); for (const w of warnings) console.log("   ~ " + w); }
  if (violations.length) { console.log("  НАРУШЕНИЯ (документы не собираем):"); for (const v of violations) console.log("   ! " + v); }
  if (!violations.length && !warnings.length) console.log("  OK - контракт чист.");
}
process.exit(violations.length ? 2 : warnings.length ? 1 : 0);
