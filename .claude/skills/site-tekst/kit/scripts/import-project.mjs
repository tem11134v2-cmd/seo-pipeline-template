// Импорт контракта анализа site-analiz (project.json v2) во входы текстового алгоритма.
// Второй вход фазы 0 вместо прозы inputs/analysis.md (режим config sources.mode = "project").
//
// node scripts/import-project.mjs [--project <project.json>] [--facts-src <facts-src.json>] [--queue <queue.json>]
//                                 [--structure <structure_data.json>] [--allow-ungated]
// node scripts/import-project.mjs --apply-patterns work/anti-promises.patterns.json
//
// Запуск из корня проекта текстов. Пути по умолчанию: config/project.json -> sources.project_json, facts_src, queue,
// structure_input; facts-src и queue иначе ищутся рядом с project.json (parts/facts-src.json, queue.json).
// Пишет: work/facts.json, work/audience.json, work/client-preferences.json, work/directions.json,
// work/competitors/seed.json, config/project.json (company, site_url, niche.*, sources.*), inputs/analysis.md
// (рендер, scripts/render-analysis.mjs), inputs/structure_data.json (копия --structure), work/import-report.json.
// Регулярки антиобещаний скрипт не сочиняет: оставляет заглушку (?!) (не ловит ничего), их пишет агент по
// prompts/00-antipromise-patterns.md в work/anti-promises.patterns.json, а --apply-patterns проверяет каждую
// на примерах агента (3 должны ловиться, 2 нет) и переносит прошедшие в work/facts.json. Если файл регулярок
// уже есть, импорт применяет его сам (для антиобещаний с тем же текстом).
// Коды выхода: 0 - записано; 1 - выход не прошел схему или регулярки не прошли проверку; 2 - нет входа или гейт
// анализа не согласован (queue.json -> gate.approved), без --allow-ungated.
import fs from 'node:fs';
import path from 'node:path';
import { argv, P, readJson, writeJson, writeText, readText, exists, nowIso, loadSchema, validate, normalizeText, esc } from './lib.mjs';
import { renderAnalysis } from './render-analysis.mjs';

const a = argv({ 'allow-ungated': 'bool' });
const SENTINEL = '(?!)';
const PENDING_GAP = 'регулярка антиобещания ';
const T = s => (typeof s === 'string' ? normalizeText(s) : typeof s === 'number' ? String(s) : '');
const len = s => Array.from(s || '').length;
const arr = x => (Array.isArray(x) ? x : []);
const rel = f => path.relative(process.cwd(), f).replace(/\\/g, '/');
const abs = f => (f ? path.resolve(f) : '');
const die = (code, msg) => { console.error(msg); process.exit(code); };

// Число с единицей: копия UNIT/NUM_UNIT из site-analiz .claude/scripts/site/_contract.mjs (одно определение
// «проверяемого факта» на обе стороны стыка; при правке там - поправить и тут).
const UNIT = '%|₽|руб[а-я]*|тыс[а-я.]*|млн|млрд|шт[а-я.]*|кв\\.?\\s?м|м2|м²|мм|см|км|кг|тонн[а-я]*|литр[а-я]*|год[а-я]*|лет|месяц[а-я]*|мес(?![а-я])|недел[а-я]+|дней|дня|день|дн(?![а-я])|час[а-я]*|мин[а-я]*|раз(?![а-я])|человек[а-я]*|сотрудник[а-я]*|специалист[а-я]*|объект[а-я]*|проект[а-я]*|клиент[а-я]*|позици[а-я]+|балл[а-я]*|ед(?![а-я])|м(?![а-яa-z])|т(?![а-яa-z])|л(?![а-яa-z])';
const NUM_UNIT = new RegExp('\\d[\\d\\s.,]*\\s*(?:' + UNIT + ')', 'i');
const HELD = /(^|[^a-z])nda([^a-z]|$)|под nda|конфиденц|коммерческая тайна|не публиков|не печата|снято|снят с|снимаем/;

// ---------------------------------------------------------------- проверка регулярок антиобещаний
function checkPattern(item) {
  const errs = [];
  const pat = String(item.lint_pattern || '');
  if (!pat || pat === SENTINEL) return ['регулярка пустая или заглушка'];
  if (/\\[bBwW]/.test(pat)) errs.push('\\b, \\B, \\w, \\W не работают с кириллицей: границу слова задавай (?<![а-я]), букву - [а-я]');
  if (/[\u0451\u0401]/.test(pat)) errs.push('буква е с точками в регулярке (house style ее запрещает, в текстах ее нет)');
  if (/(^|[^\\])\.[*+]/.test(pat)) errs.push('.* и .+ без предела ловят лишнее: вместо них [а-я ,]{0,30}');
  let re;
  try { re = new RegExp(pat, 'i'); } catch (e) { errs.push('не компилируется: ' + e.message); return errs; }
  if (re.test('') || re.test(' ') || re.test('а')) errs.push('ловит пустую строку или одну букву');
  const mm = arr(item.must_match), mn = arr(item.must_not_match);
  if (mm.length < 3) errs.push(`примеров, которые должны ловиться, ${mm.length}, нужно 3`);
  if (mn.length < 2) errs.push(`примеров, которые не должны ловиться, ${mn.length}, нужно 2`);
  for (const x of mm) if (!re.test(T(x))) errs.push(`не ловит «${x}»`);
  for (const x of mn) if (re.test(T(x))) errs.push(`ловит безобидное «${x}»`);
  return errs;
}

// Шаблон по основам слов для коротких запретов (constraints.forbidden): LLM не нужен.
function stemPattern(phrase) {
  const words = T(phrase).toLowerCase().replace(/[«»"()]/g, '').split(/\s+/).filter(Boolean);
  if (!words.length) return SENTINEL;
  return '(?<![а-яa-z])' + words.map(w => {
    const cls = /[а-я]/.test(w) ? '[а-я]' : '[a-z]';
    return w.length > 4 ? esc(w.slice(0, -2)) + cls + '*' : esc(w) + `(?!${cls})`;
  }).join('\\s+');
}

// Применение файла регулярок к facts.json: возвращает {ok, failed, conflicts}.
function applyPatterns(facts, file, report, { onlySameText }) {
  const res = { ok: [], failed: [], conflicts: [] };
  if (!file || !exists(file)) return res;
  let pf;
  try { pf = readJson(file); } catch (e) { res.failed.push({ id: '*', errors: [`невалидный JSON: ${e.message} (обратная косая в строке JSON пишется двойной: \\\\s)`] }); return res; }
  const schemaErr = validate(loadSchema('antipromise-patterns'), pf);
  if (schemaErr.length) { res.failed.push({ id: '*', errors: schemaErr.slice(0, 10) }); return res; }
  const byId = Object.fromEntries(facts.anti_promises.map(x => [x.id, x]));
  for (const it of pf.items) {
    const ap = byId[it.id];
    if (!ap) { res.failed.push({ id: it.id, errors: ['такого антиобещания нет в work/facts.json'] }); continue; }
    if (it.text && T(it.text) !== ap.text) {
      if (onlySameText) continue; // текст сменился после прошлого импорта: регулярка устарела, остается заглушка
      res.failed.push({ id: it.id, errors: ['text в файле регулярок не совпадает с текстом антиобещания'] }); continue;
    }
    const errs = checkPattern(it);
    if (errs.length) { res.failed.push({ id: it.id, errors: errs }); continue; }
    ap.lint_pattern = it.lint_pattern;
    if (it.allowed_context) ap.allowed_context = T(it.allowed_context);
    res.ok.push(it.id);
  }
  const factIds = new Set(facts.facts.map(f => f.id));
  for (const c of arr(pf.conflicts)) {
    if (!factIds.has(c.fact) || !byId[c.anti]) { report.warnings.push(`конфликт ${c.fact} против ${c.anti} из файла регулярок: нет такого факта или антиобещания`); continue; }
    res.conflicts.push(`конфликт: ${c.fact} против ${c.anti}${c.why ? ` (${T(c.why)})` : ''}`);
  }
  // регулярка ловит формулировку опубликованного факта - писатель не сможет ее взять
  for (const ap of facts.anti_promises) {
    if (ap.lint_pattern === SENTINEL) continue;
    const re = new RegExp(ap.lint_pattern, 'i');
    for (const f of facts.facts) if (f.publish === 'yes' && (re.test(f.wording) || re.test(f.value))) res.conflicts.push(`конфликт: ${f.id} против ${ap.id} (регулярка ловит формулировку факта)`);
  }
  return res;
}

function syncAntiGaps(facts, report, conflicts) {
  const pending = facts.anti_promises.filter(x => x.lint_pattern === SENTINEL).map(x => x.id);
  // строки прошлого применения регулярок снимаются целиком: повтор --apply-patterns дает тот же результат
  const prev = new Set(report.anti.conflicts || []);
  facts.gaps = facts.gaps.filter(g => !g.startsWith(PENDING_GAP) && !prev.has(g));
  for (const id of pending) facts.gaps.push(`${PENDING_GAP}${id} не задана: линтер это антиобещание не ловит`);
  const added = [];
  for (const c of conflicts) {
    const key = c.split(' (')[0];
    if (!facts.gaps.some(g => g.split(' (')[0] === key)) { facts.gaps.push(c); added.push(c); }
  }
  report.anti.pending = pending;
  report.anti.conflicts = added;
  return pending;
}

function validateOut(name, file, data, problems) {
  const errs = validate(loadSchema(name), data);
  if (errs.length) problems.push(`${file} (${name}): ${errs.slice(0, 5).join('; ')}`);
}

// ---------------------------------------------------------------- режим --apply-patterns
if (a['apply-patterns']) {
  const factsFile = P('work', 'facts.json'), repFile = P('work', 'import-report.json');
  if (!exists(factsFile)) die(2, 'нет work/facts.json: сначала импорт');
  const facts = readJson(factsFile);
  const report = exists(repFile) ? readJson(repFile) : { warnings: [], anti: { pending: [], ok: [], failed: [] } };
  const res = applyPatterns(facts, abs(a['apply-patterns']), report, { onlySameText: false });
  report.anti.ok = [...new Set([...(report.anti.ok || []), ...res.ok])];
  report.anti.failed = res.failed;
  const pending = syncAntiGaps(facts, report, res.conflicts);
  const problems = [];
  validateOut('facts', 'work/facts.json', facts, problems);
  if (problems.length) die(1, problems.join('\n'));
  writeJson(factsFile, facts);
  report.counts = { ...(report.counts || {}), anti_pending: pending.length, gaps: facts.gaps.length };
  writeJson(repFile, report);
  // раздел «Пробелы» в отрендеренном анализе
  const md = P('inputs', 'analysis.md');
  if (exists(md)) {
    const src = readText(md);
    const body = facts.gaps.length ? facts.gaps.map(g => `- ${g}`).join('\n') : 'Пробелов нет.';
    writeText(md, src.replace(/## Пробелы\n[\s\S]*?(?=\n## )/, `## Пробелы\n\n${body}\n`));
  }
  console.log(`регулярки: приняты ${res.ok.length} (${res.ok.join(', ') || '-'}), не прошли ${res.failed.length}, без регулярки ${pending.length}, конфликтов ${res.conflicts.length}`);
  for (const f of res.failed) console.log(` - ${f.id}: ${f.errors.join('; ')}`);
  for (const c of res.conflicts) console.log(` - ${c}`);
  process.exit(res.failed.length ? 1 : 0);
}

// ---------------------------------------------------------------- входы
const cfgFile = P('config', 'project.json');
const cfg = readJson(cfgFile);
const S = cfg.sources || {};
const fromCfg = !a.project;
const projectPath = abs(a.project || S.project_json);
if (!projectPath || !exists(projectPath)) die(2, `нет project.json: ${projectPath || '(путь не задан: --project или config/project.json -> sources.project_json)'}`);
const siteDir = path.dirname(projectPath);
const pick = (flag, cfgVal, def) => abs(a[flag] || (fromCfg && cfgVal) || def);
const factsSrcPath = pick('facts-src', S.facts_src, path.join(siteDir, 'parts', 'facts-src.json'));
const queuePath = pick('queue', S.queue, path.join(siteDir, 'queue.json'));
const structurePath = a.structure ? abs(a.structure) : (fromCfg && S.structure_input ? abs(S.structure_input) : '');

const raw = readJson(projectPath);
if (raw.v !== 2 || !raw.business || !raw.audience || !Array.isArray(raw.facts)) die(2, `${projectPath}: ожидался project.json v2 (v, business, audience, facts)`);
const p = raw;
const b = p.business || {}, o = p.offer || {}, cons = p.constraints || {}, lex = p.lexicon || {};

const queue = exists(queuePath) ? readJson(queuePath) : null;
const approved = !!(queue && queue.gate && queue.gate.approved === true);
const ungated = !approved;
if (ungated && !a['allow-ungated']) {
  die(2, `гейт анализа не согласован: ${queue ? `${rel(queuePath)} -> gate.approved = ${JSON.stringify(queue.gate && queue.gate.approved)}` : `нет ${queuePath}`}.\n` +
    'До гейта у фактов publish: no означает «заказчик не подтвердил», импорт даст ноль публикуемых фактов. Пилот до гейта - только с --allow-ungated.');
}
const journal = arr(queue && queue.journal);
const factsSrc = exists(factsSrcPath) ? readJson(factsSrcPath) : [];

const report = {
  generated_at: nowIso(),
  inputs: { project: projectPath, facts_src: exists(factsSrcPath) ? factsSrcPath : '', queue: queue ? queuePath : '', structure: structurePath },
  gate: { approved, ungated_import: ungated, by: T(queue && queue.gate && queue.gate.by), at: T(queue && queue.gate && queue.gate.at), decisions: {} },
  outputs: [], counts: {}, id_map: { facts: {}, segments: {} }, heuristic: [], empty: [], warnings: [],
  anti: { pending: [], ok: [], auto: [], failed: [], conflicts: [] },
};
const H = {};
const heur = (field, rule, item) => { const k = field + '|' + rule; (H[k] ??= { field, rule, items: [] }).items.push(item); };
const empty = (field, effect) => report.empty.push({ field, effect });
const warn = s => report.warnings.push(s);
if (ungated) warn('импорт до гейта анализа (--allow-ungated): факты не подтверждены заказчиком, publish взят из project.json как есть');
if (!exists(factsSrcPath)) warn(`нет parts/facts-src.json (${factsSrcPath}): source_quote у всех фактов - строка «[src] label: value»`);

// ---------------------------------------------------------------- решения гейта d1-d8
const DECISIONS = [
  { key: 'd1', name: 'позиционирование', get: () => T(o.positioning) },
  { key: 'd2', name: 'обещание: что получит клиент', get: () => T(o.promise && o.promise.result) },
  { key: 'd3', name: 'главное действие на сайте', get: () => T(o.promise && o.promise.cta) },
  { key: 'd4', name: 'границы работы, чего не обещаем', get: () => arr(o.limits).map(T).join('; ') },
  { key: 'd5', name: 'тон', get: () => T(o.tone) },
  { key: 'd6', name: 'цены на сайте открыты', get: () => (arr(b.sig).includes('price_open') ? 'да' : 'нет') },
  { key: 'd7', name: 'тип сайта', get: () => T(b.site_kind) },
  { key: 'd8', name: 'что продаем', get: () => T(b.type) },
];
function decisionHow(key) {
  const re = new RegExp(`решени[а-я]*\\s+${key}(?![0-9])`);
  const j = journal.find(x => re.test(T(x.subject)));
  if (!j) return approved ? 'согласовано на гейте, записи в журнале нет' : 'гейт не пройден';
  if (/молчани/.test(T(j.subject)) || /молчани|не поправил/.test(T(j.ground))) return `молчание заказчика, принят рекомендованный дефолт (${j.id})`;
  return `${T(j.kind) || 'запись'}: ${T(j.subject)} (${j.id})`;
}
for (const d of DECISIONS) report.gate.decisions[d.key] = { name: d.name, value: d.get(), how: decisionHow(d.key) };

// ---------------------------------------------------------------- гео
function geoRe(g) {
  const words = T(g).toLowerCase().split(/[\s-]+/).filter(Boolean);
  return new RegExp('(^|[^а-яa-z])' + words.map(w => (w.length > 4 && /[аяеиоуыьйю]$/.test(w) ? esc(w.slice(0, -1)) : esc(w)) + '[а-яa-z]*').join('[\\s-]+'), 'i');
}
const GEO = arr(b.geo).map(T).filter(Boolean).map(g => ({ g, re: geoRe(g) }));
const geoOf = s => GEO.filter(x => x.re.test(s)).map(x => x.g).join(', ');

// ---------------------------------------------------------------- сегменты
const segs = arr(p.audience && p.audience.segments);
const segMap = {};
segs.forEach((s, i) => { segMap[s.id] = `S${i + 1}`; });
if (segs.length > 9) warn(`сегментов ${segs.length}: схема текстов допускает S1..S9, лишние отброшены`);
report.id_map.segments = segMap;

// ---------------------------------------------------------------- факты
const factIdMap = {};
p.facts.forEach(f => { factIdMap[f.id] = String(f.id).replace(/^f/, 'F'); });
report.id_map.facts = factIdMap;
const srcById = {}, fieldSrc = {};
for (const x of arr(factsSrc)) {
  if (x.id) srcById[x.id] = x;
  else if (x.field) fieldSrc[x.field] = x;
}
// проверка цитаты по входу анализа (sites/NNN/input/...): Д3 - цитаты facts-src никто не сверял
const inputCache = {};
function quoteFound(q, where) {
  const file = T(where).split(/[:\s]/)[0];
  if (!file) return null;
  const f = path.join(siteDir, file);
  if (!exists(f)) return null;
  const norm = s => normalizeText(s).replace(/\s+/g, ' ').toLowerCase();
  // цитата может идти через перенос строки внутри markdown-цитаты «> »
  inputCache[f] ??= norm(fs.readFileSync(f, 'utf8').replace(/^[ \t]*>[ \t]?/gm, ''));
  return inputCache[f].includes(norm(q));
}

const Q_KIND = { price: 'number', price_factors: 'number', compare: 'number', numbers: 'number', cat_intro: 'number', docs: 'legal', steps: 'process', cta_form: 'process', cta_mid: 'process', geo: 'geo', delivery: 'geo', specs: 'product', gallery: 'product', product_desc: 'product', listing: 'product', subcats: 'product' };
const CONTACT_RE = /телефон|e-?mail|почт[аыу]|(^|[^а-я])адрес|whatsapp|telegram|телеграм|вотсап|youtube|ютуб|(^|[^a-z])vk([^a-z]|$)|вконтакте|instagram|инстаграм|мессенджер|канал[а-я]* (компании|связи)|часы работы|график работы/i;
const NOTE_RE = /в этой версии|не разворачива|уточн[а-я]* у заказчика|нет данных|не указан|(^|[^a-z])(todo|tbd)([^a-z]|$)|\?\?/i;
const QUALIFIER_RE = /^(до|от|около|более|свыше|менее|не более|не менее|порядка|примерно)\s/i;

// Вид факта: из анализа (facts[].kind ставит site-intake, пустой выводит build-project.mjs), иначе мост q -> kind.
const FACT_KINDS = new Set(['number', 'claim', 'process', 'contact', 'legal', 'product', 'geo']);
function kindOf(label, value, q) {
  const ks = new Set(arr(q).map(x => Q_KIND[x]).filter(Boolean));
  const qs = arr(q).join(', ') || 'нет';
  const digit = /\d/.test(value);
  if (CONTACT_RE.test(label + ' ' + value)) return ['contact', `слова контакта; q: ${qs}`];
  if (ks.has('legal')) return ['legal', `q docs; q: ${qs}`];
  if (digit && ks.has('number')) return ['number', `q числа и цифра в value; q: ${qs}`];
  if (digit && NUM_UNIT.test(value)) return ['number', `число с единицей в value; q: ${qs}`];
  if (ks.has('geo')) return ['geo', `q: ${qs}`];
  if (ks.has('process')) return ['process', `q: ${qs}`];
  if (ks.has('product')) return ['product', `q: ${qs}`];
  return ['claim', ks.has('number') ? `q числа, но в value нет цифры; q: ${qs}` : `по умолчанию; q: ${qs}`];
}
function makeWording(id, label, value) {
  let w = value;
  if (QUALIFIER_RE.test(value) || !/[а-яa-z]{4,}/i.test(value.replace(/\d/g, ''))) {
    w = `${label}: ${value}`;
    heur('facts[].wording', 'value без предмета (начинается с «до/от...» или без слов) - добавлено название факта', id);
  }
  if (len(w) > 160) {
    w = len(value) <= 160 ? value : Array.from(value).slice(0, 160).join('').replace(/\s+\S*$/, '');
    heur('facts[].wording', 'длиннее 160 знаков - обрезано по слову', id);
  }
  if (len(w) < 3) w = `${label}: ${value}`;
  return w.charAt(0).toUpperCase() + w.slice(1);
}

const forbidden = arr(cons.forbidden).map(T).filter(Boolean);
const gapsOut = [];
const conflicts = [];
const factsOut = [];
const factSrcLabel = {};
let qFromSrc = 0, qFallback = 0, qVerified = 0, qMissing = 0, qNoFile = 0;
for (const f of p.facts) {
  const id = factIdMap[f.id];
  let label = T(f.label), value = T(f.value);
  const art = T(f.artifact), src = T(f.src) || 'источник не указан';
  if (!/^F[0-9]{2,3}$/.test(id)) { warn(`факт ${f.id}: id не приводится к F01..F999, пропущен`); continue; }
  if (!value && art) { value = `документ: ${art}`; heur('facts[].value', 'пустой value при непустом artifact - value = «документ: artifact»', id); }
  if (!value) { warn(`факт ${f.id}: пустые value и artifact, пропущен`); continue; }
  if (len(label) < 3) { label = `${label}: ${value}`.slice(0, 80); heur('facts[].label', 'label короче 3 знаков - дополнен значением', id); }
  const fromAnalysis = FACT_KINDS.has(T(f.kind));
  const [kind, why] = fromAnalysis ? [T(f.kind), 'из анализа'] : kindOf(label, value, f.q);
  if (!fromAnalysis) heur('facts[].kind', 'мост q -> kind плюс число с единицей в value', `${id}: ${kind} (${why})`);
  const geo = geoOf(`${label} ${value}`);
  if (geo) heur('facts[].geo', 'сверка label и value с business.geo[]', `${id}: ${geo}`);
  const wording = makeWording(id, label, value);
  let publish = f.publish === 'yes' ? 'yes' : 'no';
  if (publish === 'yes' && NOTE_RE.test(value)) {
    publish = 'no';
    warn(`${id} «${label}»: значение похоже на служебную пометку, а не на факт («${value}») - publish снят`);
    gapsOut.push(`${id} «${label}»: в анализе вместо факта пометка «${value}» - в публикацию не идет, нужен ответ заказчика`);
  }
  // цитата
  const s = srcById[f.id];
  let quote;
  factSrcLabel[id] = src;
  if (s && T(s.quote)) {
    quote = `[${src}] ${T(s.where) || 'место не указано'}: ${T(s.quote)}`;
    qFromSrc++;
    const found = quoteFound(T(s.quote), s.where);
    if (found === true) qVerified++;
    else if (found === false) { qMissing++; warn(`${id}: цитата facts-src не найдена дословно в ${T(s.where)}`); }
    else qNoFile++;
  } else {
    quote = `[${src}] ${label}: ${value}`;
    qFallback++;
    heur('facts[].source_quote', 'нет цитаты в facts-src.json - строка «[src] label: value»', id);
  }
  // запреты заказчика и маркер снятия (heldBack из _contract.mjs анализа)
  const t = `${label} ${value} ${art}`.toLowerCase();
  if (HELD.test(t) && publish === 'yes') conflicts.push({ id, what: 'маркер снятия в тексте факта' });
  for (const w of forbidden) if (w.length >= 3 && t.includes(w.toLowerCase())) conflicts.push({ id, forbidden: w });
  factsOut.push({ id, label, value, wording, publish, source_quote: quote, kind, ...(geo ? { geo } : {}) });
}

// ---------------------------------------------------------------- антиобещания
const antiOut = [];
const antiSrc = [];
const pushAnti = (text, from, pattern, ctx) => {
  const id = `A${String(antiOut.length + 1).padStart(2, '0')}`;
  if (antiOut.length >= 99) return;
  antiOut.push({ id, text, lint_pattern: pattern, allowed_context: ctx });
  antiSrc.push({ id, from, text });
  return id;
};
const DEF_CTX = 'блок «что мы не обещаем», ответ на возражение, где формулировка приводится как чужая и опровергается';
for (const x of arr(o.limits).map(T).filter(Boolean)) pushAnti(x, 'offer.limits', SENTINEL, DEF_CTX);
for (const x of arr(cons.not_self).map(T).filter(Boolean)) pushAnti(x, 'constraints.not_self', SENTINEL, DEF_CTX);
for (const x of arr(cons.not_selling).map(T).filter(Boolean)) pushAnti(`Не продаем: ${x}`, 'constraints.not_selling', SENTINEL, DEF_CTX);
if (T(cons.opsec)) pushAnti(`Не раскрываем: ${T(cons.opsec)}`, 'constraints.opsec', SENTINEL, '');
const forbiddenIds = {};
for (const w of forbidden) {
  const id = pushAnti(`Не пишем: «${w}»`, 'constraints.forbidden', stemPattern(w), '');
  if (id) { forbiddenIds[w] = id; report.anti.auto.push(id); }
}
for (const c of conflicts) {
  if (c.forbidden) gapsOut.push(`конфликт: ${c.id} против ${forbiddenIds[c.forbidden] || 'запрета'} (в факте запрещенное слово «${c.forbidden}»)`);
  else gapsOut.push(`конфликт: ${c.id} - ${c.what}, при этом publish: yes`);
}
if (!antiOut.length) empty('offer.limits, constraints.forbidden, constraints.not_self', 'антиобещаний нет: линтеру нечего ловить, блок «что мы не обещаем» не из чего собрать');
if (!forbidden.length) empty('constraints.forbidden', 'запрещенных слов нет: tone.forbidden_words пуст');

// ---------------------------------------------------------------- компания, тон, терминология
const lg = b.legal || {};
const legalFilled = ['entity', 'address', 'phone', 'email', 'schedule', 'inn', 'ogrn'].some(k => T(lg[k]));
const company = { brand: T(b.name), status: legalFilled ? (approved ? 'confirmed' : 'from_site_unconfirmed') : 'missing' };
if (T(lg.entity)) company.legal_name = T(lg.entity);
if (T(lg.address)) company.address = T(lg.address);
if (T(lg.phone)) company.phones = [T(lg.phone)];
if (T(lg.email)) company.email = T(lg.email);
if (T(lg.schedule)) company.hours = T(lg.schedule);
if (T(lg.inn)) company.inn = T(lg.inn);
if (T(lg.ogrn)) company.ogrn = T(lg.ogrn);
if (legalFilled) company.source = 'project.json -> business.legal';
else {
  empty('business.legal', 'реквизитов нет: company.status = missing, фаза 0 снимает контакты с сайта (00-site-snapshot)');
  gapsOut.push('реквизиты: в анализе нет юрлица, адреса, телефона, почты и часов работы (business.legal)');
}
if (lg.phone_absent) gapsOut.push('телефона для сайта нет (business.legal.phone_absent)');
// каналы: ссылки из фактов вида contact и их цитат
const CH = { youtube: /https?:\/\/(www\.)?youtube\.com\/[^\s;,)]+/i, telegram: /https?:\/\/t\.me\/[^\s;,)]+/i, vk: /https?:\/\/(www\.)?vk\.com\/[^\s;,)]+/i, instagram: /https?:\/\/(www\.)?instagram\.com\/[^\s;,)]+/i, whatsapp: /https?:\/\/wa\.me\/[^\s;,)]+/i };
const channels = {};
for (const f of p.facts) {
  if (factsOut.find(x => x.id === factIdMap[f.id])?.kind !== 'contact') continue;
  const hay = `${T(f.artifact)} ${T(f.value)} ${T(srcById[f.id] && srcById[f.id].quote)}`;
  for (const [k, re] of Object.entries(CH)) { const m = hay.match(re); if (m && !channels[k]) channels[k] = m[0]; }
}
if (Object.keys(channels).length) { company.channels = channels; heur('company.channels', 'ссылки из фактов-контактов и их цитат', Object.keys(channels).join(', ')); }

const tone = {};
if (T(o.tone)) tone.register = T(o.tone); else empty('offer.tone', 'тон не задан (d5)');
if (T(o.positioning)) tone.idea = T(o.positioning);
if (forbidden.length) tone.forbidden_words = forbidden;
const terminology = {
  use: arr(lex.locked).map(T).filter(Boolean).map(say => ({ say })),
  jargon: arr(lex.translate).filter(x => x && x.from && x.to).map(x => ({ internal: T(x.from), public: T(x.to) })),
  untranslatable: arr(lex.canonical).map(T).filter(Boolean),
};

// сайт: business.site (Д1: build-project его выбрасывает) -> facts-src field business.site -> домен из lexicon.canonical
let siteUrl = T(b.site);
if (!siteUrl && fieldSrc['business.site']) {
  const m = T(fieldSrc['business.site'].raw).match(/https?:\/\/[^\s;,)«»]+|[a-z0-9.-]+\.[a-z]{2,}/i);
  if (m) { siteUrl = m[0]; heur('config.site_url', 'business.site пуст (Д1) - адрес из parts/facts-src.json, поле business.site', siteUrl); }
}
if (!siteUrl) {
  const d = arr(lex.canonical).map(T).find(x => /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(x));
  if (d) { siteUrl = d; heur('config.site_url', 'business.site пуст - домен из lexicon.canonical', d); }
}
if (siteUrl && !/^https?:\/\//i.test(siteUrl)) siteUrl = `https://${siteUrl.replace(/^\/+/, '')}`;
if (!siteUrl) empty('business.site', 'адреса сайта нет: 00-site-snapshot не сможет снять контакты');

// пробелы
if (!b.since) empty('business.since', 'года начала работы нет');
else if (!p.facts.some(f => new RegExp(String(b.since)).test(`${T(f.label)} ${T(f.value)}`))) gapsOut.push(`год начала работы: в business.since ${b.since}, но фактом с источником он не заведен - на сайт не идет, пока заказчик не подтвердит`);
for (const g of arr(p.gaps)) if (T(g.ask)) gapsOut.push(`открытый вопрос анализа (${g.id}): ${T(g.ask)}`);
for (const j of journal) if (j.kind === 'gap' && !/^молчание по/.test(T(j.subject))) gapsOut.push(`журнал гейта (${j.id}): ${T(j.subject)}`);
if (approved) for (const f of factsOut) if (f.publish === 'no' && !gapsOut.some(g => g.startsWith(`${f.id} «`))) gapsOut.push(`${f.id} «${f.label}» не подтвержден или снят на гейте: в тексты не идет`);
if (ungated) gapsOut.unshift('факты не подтверждены заказчиком: импорт до гейта анализа (--allow-ungated)');
if (!(b.assortment || []).length && (b.type === 'shop' || b.type === 'both')) empty('business.assortment', 'ассортимента нет (Д1): раздел «Позиции и карточки» пуст, каталогу не из чего взять товарные группы');

const facts = {
  generated_at: nowIso(),
  source: `project.json v2 «${p.slug}» от ${p.updated} (${projectPath})`,
  facts: factsOut, anti_promises: antiOut, terminology, company, ...(Object.keys(tone).length ? { tone } : {}), gaps: gapsOut,
};
// регулярки из прошлого прогона
const patternsFile = P('work', 'anti-promises.patterns.json');
const applied = applyPatterns(facts, patternsFile, report, { onlySameText: true });
report.anti.ok = applied.ok;
report.anti.failed = applied.failed;
syncAntiGaps(facts, report, applied.conflicts);

// ---------------------------------------------------------------- аудитория
let objN = 0, objLinks = 0;
const pubFacts = factsOut.filter(f => f.publish === 'yes');
const nums = s => (String(s).match(/\d[\d\s]*\d|\d/g) || []).map(x => x.replace(/\s/g, '')).filter(x => x.length >= 2);
// пары соседних значимых слов по основам (5 букв): «период строительства» = «периоду строительства»
const bigrams = s => {
  const w = String(s).toLowerCase().split(/[^а-яa-z]+/).filter(x => x.length >= 5).map(x => x.slice(0, 5));
  return new Set(w.slice(1).map((x, i) => `${w[i]} ${x}`));
};
function linkFacts(answer) {
  const an = nums(answer), ab = bigrams(answer);
  return pubFacts.filter(f => nums(f.value).some(n => an.includes(n)) || [...bigrams(f.value)].some(g => ab.has(g))).map(f => f.id);
}
const dirById = Object.fromEntries(arr(b.directions).map(d => [d.id, d]));
const dirLabel = id => { const d = dirById[id]; return d ? `${T(d.name)}${T(d.url) ? ` (${T(d.url)})` : ''} [dir:${id}]` : `[dir:${id}]`; };
const segmentsOut = segs.slice(0, 9).map(s => {
  const objections = arr(s.objection).map(x => {
    objN++;
    const answer = T(x.answer);
    const fl = linkFacts(answer);
    if (fl.length) { objLinks++; heur('audience.objections[].facts', 'в ответе то же число или та же пара слов (по основам), что в value факта; стратег проверяет', `O${objN}: ${fl.join(', ')}`); }
    return { id: `O${objN}`, text: T(x.says), answer, ...(T(x.behind) ? { behind: T(x.behind) } : {}), facts: fl };
  });
  const pains = arr(s.pain).map(T).filter(Boolean);
  return {
    id: segMap[s.id], name: T(s.name), portrait: T(s.who) || T(s.name),
    ...(pains[0] ? { comes_with: pains[0] } : {}),
    pains, fears: arr(s.fear).map(T).filter(Boolean), objections, criteria: arr(s.choose).map(T).filter(Boolean),
    directions: arr(s.dirs).map(dirLabel),
  };
});
if (segs.some(s => !T(s.who))) heur('audience.segments[].portrait', 'who пуст - портрет = имя сегмента', segs.filter(s => !T(s.who)).map(s => segMap[s.id]).join(', '));
if (objN > 99) warn(`возражений ${objN}: схема текстов допускает O1..O99`);
const words = arr(p.audience && p.audience.words);
const phrases = words.filter(w => T(w.say)).map(w => ({ phrase: T(w.say), meaning: T(w.means) || T(w.say), ...(w.src ? { src: w.src } : {}) }));
if (words.some(w => !T(w.means))) heur('audience.client_phrases[].meaning', 'means пуст - meaning = say', words.filter(w => !T(w.means)).map(w => T(w.say)).join('; '));
const audience = { source: facts.source, segments: segmentsOut, client_phrases: phrases };

// ---------------------------------------------------------------- пожелания заказчика (решения гейта)
const prefItems = [];
const how = k => report.gate.decisions[k].how;
const pref = (text, status, where, key, extra = {}) => { if (T(text)) prefItems.push({ text: T(text), status, where, reason: `${approved ? 'согласовано на гейте site-analiz' : 'гейт не пройден'}, ${key}: ${how(key)}`, source: `gate:${key}`, ...extra }); };
pref(o.positioning, 'basis', 'positioning', 'd1');
const proof = o.promise && o.promise.proof_id ? factIdMap[o.promise.proof_id] : '';
pref(o.promise && o.promise.result, 'candidate', 'hero', 'd2', proof ? { facts: [proof] } : {});
pref(o.promise && o.promise.cta, 'basis', 'cta', 'd3');
for (const x of arr(o.limits)) pref(x, 'basis', 'not-promise', 'd4');
pref(o.tone, 'basis', 'tone', 'd5');
for (const x of arr(cons.must_say)) if (T(x)) prefItems.push({ text: T(x), status: 'basis', where: 'must-say', reason: 'constraints.must_say: обязано стоять на сайте', source: 'constraints.must_say' });
if (!arr(cons.must_say).length) empty('constraints.must_say', 'обязательных формулировок нет');
const prefs = { source: facts.source, generated_at: nowIso(), items: prefItems };

// ---------------------------------------------------------------- направления, затравка конкурентов, конфиг
const directions = {
  source: facts.source,
  directions: arr(b.directions).map(d => {
    let geo = geoOf(T(d.name));
    if (!geo && T(d.marker)) { geo = geoOf(T(d.marker)); if (geo) heur('directions[].geo', 'в имени направления гео нет - взято из маркера', `${d.id}: ${geo}`); }
    return { id: d.id, name: T(d.name), ...(T(d.parent) ? { parent: T(d.parent) } : {}), ...(T(d.marker) ? { marker: T(d.marker) } : {}), ...(T(d.url) ? { url: T(d.url) } : {}), serves: arr(d.serves).map(s => segMap[s]).filter(Boolean), ...(geo ? { geo } : {}) };
  }),
};
const noServes = directions.directions.filter(d => !d.serves.length).map(d => d.id);
if (noServes.length) warn(`направления без сегментов (serves пуст): ${noServes.join(', ')} - обогатитель выберет сегмент сам`);

const roots = arr(b.directions).filter(d => !T(d.parent));
const keyPhrases = [...new Set(roots.map(d => T(d.marker)).filter(Boolean))].slice(0, 7);
const seedDomains = [], seedRejected = [];
for (const x of arr(p.competitors && p.competitors.list)) {
  const d = T(x).toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split(/[/?#:\s]/)[0];
  if (/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)) { if (!seedDomains.find(s => s.domain === d)) seedDomains.push({ domain: d, source: 'analysis', raw: T(x) }); }
  else seedRejected.push(T(x));
}
if (!seedDomains.length) empty('competitors.list', 'затравки конкурентов нет: верификатор возьмет только выдачу');
const seed = { source: facts.source, generated_at: nowIso(), region: T(b.region), key_phrases: keyPhrases, domains: seedDomains, ...(seedRejected.length ? { rejected: seedRejected } : {}) };

const prof = b.profile || {};
const sig = arr(b.sig);
const niche = { ...(cfg.niche || {}) };
niche.description = T(b.what);
niche.business_type = { services: 'services', shop: 'catalog', both: 'both' }[b.type] || niche.business_type;
if (prof.audience) niche.audience_type = prof.audience;
else if (sig.includes('b2b')) { niche.audience_type = 'b2b'; heur('config.niche.audience_type', 'признак b2b в business.sig (b2b от mixed не отличается)', 'b2b'); }
else empty('niche.audience_type', `в контракте нет (business.profile), оставлено «${niche.audience_type}»`);
if (prof.warmth) niche.demand_warmth = prof.warmth;
else if (sig.includes('urgent')) { niche.demand_warmth = 'hot'; heur('config.niche.demand_warmth', 'признак urgent в business.sig', 'hot'); }
else empty('niche.demand_warmth', `в контракте нет (business.profile), оставлено «${niche.demand_warmth}»`);
if (prof.price) niche.price_level = prof.price;
else empty('niche.price_level', `в контракте нет (business.profile), оставлено «${niche.price_level}»`);
if (prof.cycle) niche.purchase_cycle = prof.cycle;
else if (sig.includes('urgent')) { niche.purchase_cycle = 'days'; heur('config.niche.purchase_cycle', 'признак urgent в business.sig', 'days'); }
else if (sig.includes('long_cycle')) { niche.purchase_cycle = 'months'; heur('config.niche.purchase_cycle', 'признак long_cycle в business.sig (weeks от months не отличается)', 'months'); }
else empty('niche.purchase_cycle', `в контракте нет, оставлено «${niche.purchase_cycle}»`);
niche.geo = T(b.region) || niche.geo || '';
const newCfg = {
  ...cfg,
  slug: cfg.slug || p.slug,
  company: T(b.name) || cfg.company,
  site_url: siteUrl || cfg.site_url || '',
  niche,
  sources: {
    ...S,
    mode: 'project',
    project_json: projectPath,
    facts_src: exists(factsSrcPath) ? factsSrcPath : '',
    queue: queue ? queuePath : '',
    structure_input: structurePath || '',
    // фразы, заданные руками до первого импорта, не затираются; после импорта их пересчитывает каждый повтор
    key_phrases: arr(S.key_phrases).length && S.mode !== 'project' ? S.key_phrases : keyPhrases,
  },
};
if (arr(S.key_phrases).length && S.mode !== 'project') warn('sources.key_phrases уже заполнены в конфиге руками - оставлены, маркеры направлений не подставлены');

// ---------------------------------------------------------------- структура
const structDest = P(newCfg.sources.structure_source || 'inputs/structure_data.json');
if (structurePath) {
  if (!exists(structurePath)) die(2, `нет файла структуры: ${structurePath}`);
  const sd = readJson(structurePath);
  if (!Array.isArray(sd.pages)) die(2, `${structurePath}: нет pages[] - формат не structure_data.json`);
  let slashFixed = 0, withDir = 0, byUrl = 0, byName = 0;
  const unknownDirs = new Set();
  const dirUrls = Object.fromEntries(directions.directions.filter(d => d.url).map(d => [d.url.replace(/\/+$/, ''), d.id]));
  const lowT = s => T(s).toLowerCase();
  const dirNames = new Set(directions.directions.flatMap(d => [lowT(d.name), lowT(d.marker)]).filter(Boolean));
  for (const pg of sd.pages) {
    if (typeof pg.url === 'string' && pg.url.length > 1 && /\/$/.test(pg.url)) { pg.url = pg.url.replace(/\/+$/, ''); slashFixed++; }
    const m = `${pg.section || ''} ${pg.client_notes || ''}`.match(/dir:([a-z0-9-]+)/);
    if (m) { if (dirById[m[1]]) withDir++; else unknownDirs.add(m[1]); }
    else if (dirUrls[pg.url]) byUrl++;
    else if (dirNames.has(lowT(pg.name)) || dirNames.has(lowT(pg.marker))) byName++;
  }
  if (slashFixed) heur('inputs/structure_data.json', 'слеш на конце адреса снят (Д4: import-structure теряет родителя)', `${slashFixed} адресов`);
  if (unknownDirs.size) warn(`в структуре есть dir:<id>, которых нет в business.directions: ${[...unknownDirs].join(', ')}`);
  sd.imported_from = structurePath;
  writeJson(structDest, sd);
  report.structure = { copied: true, pages: sd.pages.length, slash_fixed: slashFixed, pages_with_dir_id: withDir, pages_matched_by_url: byUrl, pages_matched_by_name_or_marker: byName };
  if (!withDir && !byUrl) warn('в структуре нет «dir:<id>» и адресов направлений: segment страниц обогатитель выбирает сам, без serves');
  report.outputs.push(rel(structDest));
} else {
  report.structure = { copied: false, existing: exists(structDest) };
  if (!exists(structDest)) empty('structure_data.json', 'структуры нет: нужен --structure (seo-struktura или планировщик анализа) либо structure_mode fallback');
}

// ---------------------------------------------------------------- счетчики, рендер, запись
const kinds = {};
factsOut.forEach(f => { kinds[f.kind] = (kinds[f.kind] || 0) + 1; });
const prefCount = { candidate: 0, basis: 0, rejected: 0 };
prefItems.forEach(x => { prefCount[x.status]++; });
report.counts = {
  facts: factsOut.length, facts_in_project: p.facts.length, publish_yes: pubFacts.length, kinds, geo_facts: factsOut.filter(f => f.geo).length,
  quotes_from_facts_src: qFromSrc, quotes_fallback: qFallback, quotes_verified_in_input: qVerified, quotes_not_found_in_input: qMissing, quotes_input_file_missing: qNoFile,
  anti_promises: antiOut.length, anti_auto: report.anti.auto.length, anti_pending: report.anti.pending.length,
  segments: segmentsOut.length, objections: objN, objections_with_facts: objLinks, client_phrases: phrases.length,
  client_phrases_persona: phrases.filter(x => x.src === 'persona').length, preferences: prefCount,
  directions: directions.directions.length, competitors_seed: seedDomains.length, key_phrases: keyPhrases.length, gaps: facts.gaps.length,
};
report.heuristic = Object.values(H);
report.anti.sources = antiSrc.map(x => `${x.id}: ${x.from}`);

const md = renderAnalysis({ p, facts, audience, prefs, gate: report.gate, projectRel: projectPath, seed, segMap, factIdMap, factSrc: factSrcLabel, siteUrl });
const missingQuotes = factsOut.filter(f => !md.includes(f.source_quote)).map(f => f.id);
if (missingQuotes.length) warn(`source_quote не находится в отрендеренном inputs/analysis.md: ${missingQuotes.join(', ')}`);
report.counts.quotes_in_render = factsOut.length - missingQuotes.length;

const problems = [];
validateOut('facts', 'work/facts.json', facts, problems);
validateOut('audience', 'work/audience.json', audience, problems);
validateOut('client-preferences', 'work/client-preferences.json', prefs, problems);
validateOut('directions', 'work/directions.json', directions, problems);
validateOut('competitors-seed', 'work/competitors/seed.json', seed, problems);
validateOut('project-config', 'config/project.json', newCfg, problems);
if (problems.length) die(1, 'выход импорта не прошел схемы, ничего не записано:\n' + problems.map(x => ' - ' + x).join('\n'));

const OUT = [
  ['work/facts.json', facts], ['work/audience.json', audience], ['work/client-preferences.json', prefs],
  ['work/directions.json', directions], ['work/competitors/seed.json', seed], ['config/project.json', newCfg],
];
for (const [f, d] of OUT) { writeJson(P(f), d); report.outputs.push(f); }
const mdPath = newCfg.sources.analysis_dump || 'inputs/analysis.md';
writeText(P(mdPath), md);
report.outputs.push(mdPath, 'work/import-report.json');
const repErr = validate(loadSchema('import-report'), report);
if (repErr.length) warn(`отчет импорта не прошел схему: ${repErr.slice(0, 3).join('; ')}`);
writeJson(P('work', 'import-report.json'), report);

console.log(`импорт ${p.slug} (гейт: ${approved ? 'согласован' : 'НЕ согласован, --allow-ungated'})`);
console.log(`факты: ${factsOut.length} (publish yes ${pubFacts.length}), kind ${JSON.stringify(kinds)}, гео ${report.counts.geo_facts}`);
console.log(`цитаты: из facts-src ${qFromSrc} (найдено во входе ${qVerified}, не найдено ${qMissing}, нет файла ${qNoFile}), строкой «[src] label: value» ${qFallback}`);
console.log(`антиобещания: ${antiOut.length}, без регулярки ${report.anti.pending.length}${report.anti.pending.length ? ' - нужен агент по prompts/00-antipromise-patterns.md' : ''}`);
console.log(`аудитория: сегментов ${segmentsOut.length}, возражений ${objN}, слов клиентов ${phrases.length}; пожелания: ${JSON.stringify(prefCount)}`);
console.log(`компания: ${company.status}; сайт: ${siteUrl || '-'}; конкурентов в затравке: ${seedDomains.length}; пробелов: ${facts.gaps.length}`);
if (report.structure.copied) console.log(`структура: ${report.structure.pages} страниц -> ${rel(structDest)}`);
for (const w of report.warnings) console.log(` ! ${w}`);
