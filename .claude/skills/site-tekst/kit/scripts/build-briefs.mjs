// Сборка брифов страниц из карты, типов страниц, стратегии, фактов, аудитории и rules/decisions.md.
// node scripts/build-briefs.mjs [slug...] [--force]
// Бриф всегда собирается в памяти (правка анализа или стратегии освежает факты, антиобещания, CTA и ссылки):
// - файла нет или список block_id прежний - файл пишется, только если содержимое изменилось (иначе mtime не трогается);
//   страницы с написанными блоками и измененным брифом печатаются списком «перелинтовать» (lint-page не запускается);
// - список block_id изменился: блоков еще нет - бриф пишется; блоки есть - бриф не трогается, предупреждение
//   «структура изменилась, нужен --force» и structure_changed в briefs-report; с --force - запись и перенумерация файлов
//   блоков (renumber-blocks.mjs переносит их lint-файлы и находки).
// Кроме brief.json пишет срезы для писателей work/pages/<slug>/brief/<block_id>.json (scripts/writer-inputs.mjs) и
// сливает по страницам work/briefs-report.json (выпавшие и исключенные блоки, снятые факты, вопросы, предупреждения).
// Проблемы (код 1) печатаются целиком, предупреждения (код 0) - сводкой по видам с примерами; содержательные заметки
// для рецензии стратегии (первый экран без фактов, подпись CTA без действия global) - строками « ~ » (wf-04 доносит их
// до рецензии отдельно от проблем).
// Редакционный стандарт (config/house_style.md): sub вне первого экрана и h2/text сеток с карточками - необязательные
// (count 0-N), у первого экрана bullets/badges - 0-N; лимит текста карточки и шага limits.card_max; возражение - в блок
// из global.objection_to_block; факт с явным домом (block_overrides.<блок>.facts или task) другим блокам по fact_kinds
// не раздается; добор фактов до опор - без фактов соседа сверху (они - только если других нет); без решения стратега
// первый экран - 2 факта.
// Страховки фактов: «не публикуем» без разрешенной формулировки при «все» снимает факт (lib.mjs parseDecisions);
// факт с конфликтом «против» антиобещания или запрета в gaps facts.json без строки §1 decisions.md в брифы не идет
// (причина conflict); разрешенная формулировка §1 с числами, которых нет в фактах ее строки, в бриф не кладется.
// Блок, снятый стратегом пустым явным facts (блок из drop-списка или блок цифр, без id в task), - исключение, как
// exclude_blocks, без вопроса заказчику. Блок цифр без числового факта выпадает (вопрос заказчику); без свежего (все его
// числовые факты у блоков выше) - тоже, но без вопроса (dropped_repeat в отчете: факты есть); явные facts стратега по
// свежести не выпадают. Нижняя граница count карточек, шагов, вопросов, строк таблицы, списков, плашек и цифр
// прижимается к опорам (пункты фактов - единицами, factUnits: придаточное и причастный оборот - не пункт; у цифр -
// только свежие числовые факты, подписи блока цифр без своих опор - не выше новой границы number; у списков и плашек
// возражение - опора, только если его факт вне фактов блока) - предупреждением, без вопроса заказчику. Подсказка
// элемента filters - всегда «названия признаков без значений».
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  argv, P, readJson, writeJson, readText, exists, loadConfig, loadSitemap, saveSitemap, pageDir, validate, loadSchema, nowIso,
  effectiveMax, kindCap, parseCount, fmtCount, isListing, blockContract, taskFactRefs, parseDecisions, decisionAllows, SEGMENT_ALL_NAME, normPath,
  digitsOf, factUnits, allowedRuleText, mergeCta, resolveBlockId, isNumbersBlock, isServiceText, cyr, stemRe,
} from './lib.mjs';
import { stopWordsRe } from './lint-common.mjs';
import { writeSlices } from './writer-inputs.mjs';

const a = argv({ force: 'bool' });
const cfg = loadConfig();
const sm = loadSitemap();
const facts = readJson(P('work', 'facts.json'));
const audience = readJson(P('work', 'audience.json'));
const strategy = readJson(P('work', 'strategy.json'));
const formulas = exists(P('rules', 'offer-formulas.json')) ? readJson(P('rules', 'offer-formulas.json')) : { formulas: [] };
const prefs = exists(P('work', 'client-preferences.json')) ? readJson(P('work', 'client-preferences.json')) : { items: [] };
const lintRules = exists(P('rules', 'lint.json')) ? readJson(P('rules', 'lint.json')) : {};
const limits = cfg.limits || {};
const REPORT = P('work', 'briefs-report.json');
// Необязательные слоты (редакционный стандарт: заголовок и подзаголовок - только если добавляют смысл). Вне первого экрана
// sub всегда 0-N; у сеток и плиток, где карточки, шаги или ссылки сами называют разделы, h2 и поясняющий text тоже 0-N.
// Писатель решает по 5 вопросам стандарта, линтер structure.element-missing на count «0-...» не срабатывает.
const SELF_NAMED_PATTERNS = new Set(limits.self_named_patterns || ['tiles', 'grid-2', 'grid-3', 'grid-4', 'cards-slider']);
function optionalCount(b, e) {
  const count = String(e.count ?? '1');
  const m = count.match(/^(\d+)(?:-(\d+))?$/);
  if (!m || m[1] === '0') return count;
  // первый экран: одно главное доказательство - в sub или одном пункте; пункты-доказательства необязательны, верх из замеров
  if (b.role === 'hero') return ['bullets', 'badges'].includes(e.kind) ? `0-${m[2] || m[1]}` : count;
  const selfNamed = SELF_NAMED_PATTERNS.has(b.pattern) && (b.elements || []).some(x => ['card', 'step', 'link'].includes(x.kind));
  if (e.kind === 'sub' || (selfNamed && ['h2', 'text'].includes(e.kind))) return `0-${m[2] || m[1]}`;
  return count;
}

const slugs = a._;
const live = sm.pages.filter(p => p.status !== 'skip');
const pages = live.filter(p => !slugs.length || slugs.includes(p.slug));
const factsById = Object.fromEntries((facts.facts || []).map(f => [f.id, f]));
const segById = Object.fromEntries((audience.segments || []).map(s => [s.id, s]));
const allObjections = (audience.segments || []).flatMap(s => (s.objections || []).map(o => ({ ...o, segment: s.id })));
const objById = Object.fromEntries(allObjections.map(o => [o.id, o]));
const pageTypes = [...new Set([...(sm.page_types || []), ...sm.pages.map(p => p.type)])];
const dec = parseDecisions(exists(P('rules', 'decisions.md')) ? readText(P('rules', 'decisions.md')) : null, { slugs: sm.pages.map(p => p.slug), types: pageTypes });
const company = facts.company || {};
const hasChannels = !!company.channels && Object.keys(company.channels).length > 0;
const hasPhone = Array.isArray(company.phones) && company.phones.some(x => String(x || '').trim());
const badVerbs = (lintRules.cta_verbs_bad || []).map(x => String(x).toLowerCase());
const dropRules = {};
for (const item of limits.drop_blocks_without_facts || []) { const [id, kind] = String(item).split(':'); dropRules[id] = kind || null; }

// ---------- проблемы и предупреждения ----------
const problems = [];
const warnings = []; // {kind, slug, text}
const warn = (kind, slug, text) => warnings.push({ kind, slug, text });
// заметки для рецензии стратегии: печатаются строками « ~ » (и остаются предупреждениями отчета)
const reviewNotes = [];
const note = (kind, slug, text) => { warn(kind, slug, text); reviewNotes.push(text); };
for (const w of dec.warnings) warn('decisions', null, w);
for (const id of Object.keys(dec.facts)) if (!factsById[id]) warn('decisions', null, `decisions §1: факта ${id} нет в facts.json`);

// разрешенная формулировка §1 с числами, которых нет в фактах ее строки (факт изменился после ответа заказчика), в бриф
// не идет. Строка может перечислять несколько id («F01, F02», «F41-F44») - одна формулировка на всех, поэтому числа
// сверяются с value, wording и note всех фактов строки; у факта в нескольких строках проверяется каждая строка.
const ruleOff = new Set();
const ownDigits = id => { const g = factsById[id]; return g ? digitsOf([g.value, g.wording, g.note].filter(Boolean).join(' ')) : []; };
for (const [id, d] of Object.entries(dec.facts)) {
  const f = factsById[id];
  if (!f || !d.rule) continue;
  const extra = new Set();
  let rowIds = [id];
  for (const row of (d.rows && d.rows.length ? d.rows : [{ rule: d.rule, ids: [id] }])) {
    const own = new Set(row.ids.flatMap(ownDigits));
    const add = digitsOf(allowedRuleText(row.rule)).filter(n => !own.has(n));
    if (add.length) { add.forEach(n => extra.add(n)); rowIds = row.ids; }
  }
  if (!extra.size) continue;
  ruleOff.add(id);
  const where = rowIds.length > 1 ? `в фактах строки (${rowIds.join(', ')})` : `в факте (value «${f.value}»)`;
  warn('decisions', null, `decisions §1: ${id}: в разрешенной формулировке числа ${[...extra].join(', ')}, их нет ${where} - формулировка в бриф не идет; поправь строку §1 или факт в анализе`);
}
// конфликт факта с антиобещанием или запретом (строка gaps «конфликт: F.. против ...») без строки §1 decisions.md -
// факт в брифы не идет (старый decisions.md без маркера v2: строкой считается любое упоминание id в файле)
const decText = exists(P('rules', 'decisions.md')) ? readText(P('rules', 'decisions.md')) : '';
const decMentions = id => (dec.v2 ? !!dec.facts[id] : new RegExp(`(^|[^A-Za-z0-9])${id}([^0-9]|$)`).test(decText));
const conflictOff = new Set();
for (const g of facts.gaps || []) {
  const m = typeof g === 'string' && g.match(/^\s*конфликт:\s*(F\d{2,3})\s+против\s/i);
  if (!m || !factsById[m[1]] || factsById[m[1]].publish !== 'yes' || decMentions(m[1]) || conflictOff.has(m[1])) continue;
  conflictOff.add(m[1]);
  warn('decisions', null, `${m[1]}: ${g.trim()} - строки §1 decisions.md нет, факт в брифы не идет`);
}
// пункты «пишем только так» (terminology.use) под стоп-словами и размытыми формулировками линтера - писатель не сможет их взять
{
  const stopRe = stopWordsRe(lintRules);
  const vague = (lintRules.vague_patterns || []).map(v => { try { return { id: v.id, re: cyr(v.pattern) }; } catch { return null; } }).filter(Boolean);
  for (const t of ((facts.terminology || {}).use || [])) {
    const say = String((t && t.say) || '');
    if (!say) continue;
    const m = say.match(stopRe);
    const hits = [...(m ? [`стоп-слово «${m[1]}»`] : []), ...vague.filter(v => v.re.test(say)).map(v => v.id)];
    if (hits.length) warn('vocab', null, `terminology.use «${say}»: ${hits.join(', ')} - линтер режет эту формулировку; поправь «пишем только так» или правила линтера проекта`);
  }
}
// оговорка-дисклеймер: ставится только в блок, который выбрал стратег (disclaimer_block); служебная записка в брифы не идет
const discText = (strategy.global || {}).disclaimer_text || '';
const discBlock = (strategy.global || {}).disclaimer_block || '';
const discUsable = !!discText && !!discBlock && !isServiceText(discText);
if (discText && isServiceText(discText)) warn('disclaimer', null, `disclaimer_text похож на служебную записку («${discText.slice(0, 80)}») - в брифы и срезы не идет; оговорка - текст для читателя`);
else if (discText && !discBlock) warn('disclaimer', null, 'disclaimer_text без disclaimer_block - оговорка не ставится');
let discPlaced = 0;

// ---------- помощники ----------
const LISTING_KINDS = new Set(['h2', 'h3', 'sub', 'text', 'filters', 'link', 'button', 'note']);
// сколько фактов нужно блоку при раскладке (нижняя граница главного содержательного элемента)
const NEED_KINDS = new Set(['card', 'step', 'qa', 'table_row', 'number']);
// нижняя граница count прижимается к опорам у этих видов; у сеток (карточки, шаги, вопросы, строки) - не ниже 2
const FLOOR_KINDS = new Set(['card', 'step', 'qa', 'table_row', 'bullets', 'badges', 'number']);
const GRID_KINDS = new Set(['card', 'step', 'qa', 'table_row']);
const NO_SUPPORT_PATTERNS = new Set(['listing', 'tiles', 'gallery', 'map', 'form']);
const canon = v => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map(key => [key, x[key]])) : x));
const writtenBlocks = slug => { const d = path.join(pageDir(slug), 'blocks'); return exists(d) ? fs.readdirSync(d).filter(f => /^B\d{2}-[a-z0-9-]+\.json$/.test(f)) : []; };
// подсказка элемента filters в брифе - одна на все листинги (п.19)
const FILTERS_NOTE = 'названия признаков без значений';
const REASON = { publish: 'не публикуется', where: 'закрыт колонкой «Где можно» decisions.md', unknown: 'нет в facts.json', conflict: 'конфликт с антиобещанием или запретом без строки §1 decisions.md' };
// нижняя граница count главного содержательного элемента блока (сколько фактов ему нужно при раскладке); иначе 1
const contentLo = b => Math.max(1, ...(b.elements || []).filter(e => NEED_KINDS.has(e.kind)).map(e => (parseCount(e.count) || { lo: 1 }).lo));
const antiRes = (facts.anti_promises || []).map(ap => { try { return ap.lint_pattern && ap.lint_pattern !== '(?!)' ? { id: ap.id, re: new RegExp(ap.lint_pattern, 'i') } : null; } catch { return null; } }).filter(Boolean);
const listingPage = page => (typeof page.listing === 'boolean' ? page.listing : page.type === 'category' && (cfg.niche || {}).business_type !== 'services');

// ссылки: страницы карты по близости (родитель, дети, соседи, хабы ветки, верхний уровень), до 60
function linksFor(page) {
  const url = normPath(page.url), parent = normPath(page.parent);
  const rank = p => {
    const pu = normPath(p.url), pp = normPath(p.parent);
    if (parent && pu === parent) return 0;
    if (pp && pp === url) return 1;
    if (parent && pp === parent) return 2;
    if (pu !== '/' && url.startsWith(pu + '/')) return 3; // хабы и разделы ветки (предки страницы)
    if ((p.level ?? 9) <= 1) return 4;
    if (page.type === 'home' && (p.level ?? 9) <= 2) return 5;
    if (['hub', 'service'].includes(p.type)) return 6;
    return -1;
  };
  return live
    .filter(p => p.slug !== page.slug && !p.template && !['search', 'cart', 'account', 'legal'].includes(p.ui_role))
    .map((p, i) => ({ p, r: rank(p), i }))
    .filter(x => x.r >= 0)
    .sort((x, y) => x.r - y.r || x.i - y.i)
    .slice(0, 60)
    .map(({ p }) => ({ url: p.url, subject: p.subject, type: p.type }));
}

// CTA: объект C3; action проверяется в контексте страницы, неверное - предупреждение и правило сборщика по умолчанию
const ACTION_RE = /^(lead|messenger|call|page:[a-z0-9][a-z0-9-]*|anchor:[a-z0-9][a-z0-9-]*)$/;
function checkAction(slug, field, action, blockTypes) {
  if (!ACTION_RE.test(action)) return `${field} «${action}» не из списка: lead | page:<slug> | anchor:<id блока> | messenger | call`;
  if (action.startsWith('page:')) { const t = action.slice(5); if (!live.some(p => p.slug === t)) return `${field}: страницы ${t} нет среди рабочих страниц карты`; }
  if (action.startsWith('anchor:')) { const t = action.slice(7); if (!blockTypes.includes(t)) return `${field}: блока ${t} нет на странице`; }
  if (action === 'messenger' && !hasChannels) return `${field}: messenger без каналов в facts.company.channels`;
  if (action === 'call' && !hasPhone) return `${field}: call без телефона в facts.company.phones`;
  return '';
}

// unknowns: открытые вопросы (gaps без технических строк), неподтвержденные факты, строка пробелов decisions.md §1
function buildUnknowns() {
  const gaps = (facts.gaps || []).filter(g => typeof g === 'string' && g.trim() && !/регулярк[а-я]* антиобещани/i.test(g));
  const out = [...gaps];
  for (const f of facts.facts || []) {
    if (f.publish === 'yes') continue;
    if (gaps.some(g => new RegExp(`(^|[^A-Za-z0-9])${f.id}([^0-9]|$)`).test(g))) continue;
    out.push(`не подтверждено: ${f.label || f.id}`);
  }
  for (const item of dec.gaps) {
    let s = item;
    if (/^[gj]\d+$/i.test(item)) s = gaps.find(g => g.includes(`(${item.toLowerCase()})`)) || item;
    else if (/^F\d{2,3}$/.test(item)) s = factsById[item] ? `${factsById[item].label} (${item}): не утверждать` : item;
    out.push(s);
  }
  return [...new Set(out)];
}
const unknowns = buildUnknowns();

// ---------- отчет: прежний файл, записи страниц сливаются ----------
let prevReport = { pages: {} };
try { if (exists(REPORT)) prevReport = readJson(REPORT); } catch { prevReport = { pages: {} }; }
const reportPages = { ...(prevReport.pages || {}) };

let built = 0, same = 0, structureChanged = 0, sliced = 0, statusChanged = false;
const relint = [], info = [];
function slice(slug) { const r = writeSlices(slug); sliced += r.written; problems.push(...r.errors); }

for (const page of pages) {
  const slug = page.slug;
  const pw = (kind, text) => warn(kind, slug, text);
  const rec = { excluded: [], dropped: [], dropped_repeat: [], objections_unassigned: [], facts_dropped: [], structure_changed: false, questions: [], warnings: [] };
  const warnStart = warnings.length;
  const problemStart = problems.length;
  const out = path.join(pageDir(slug), 'brief.json');
  const finish = () => { if (exists(out)) slice(slug); };
  const typeFile = P('work', 'page-types', `${page.type}.json`);
  if (!exists(typeFile)) { problems.push(`${slug}: нет файла типа страницы ${page.type}`); finish(); continue; }
  const pt = readJson(typeFile);
  const ps = (strategy.pages || {})[slug];
  if (!ps) { problems.push(`${slug}: нет решений стратега`); finish(); continue; }

  // сегмент: обычный или all (страница для нескольких сегментов: список - pages[].segments карты, иначе все сегменты audience)
  let segIds;
  if (ps.segment === 'all') {
    segIds = (Array.isArray(page.segments) && page.segments.length ? page.segments : (audience.segments || []).map(s => s.id)).filter(id => segById[id]);
    if (!segIds.length) { problems.push(`${slug}: segment all, но сегментов нет ни в карте, ни в audience.json`); finish(); continue; }
    if (segIds.length === 1) pw('segment', `${slug}: segment all, а сегмент один (${segIds[0]}) - бриф собран под него`);
  } else {
    if (!segById[ps.segment]) { problems.push(`${slug}: сегмент ${ps.segment} не найден в audience.json`); finish(); continue; }
    segIds = [ps.segment];
  }
  const isAll = segIds.length > 1;

  // a. порядок блоков: рекомендованный (или короткий набор) минус exclude_blocks
  const allBlocks = [...(pt.market_blocks || []), ...(pt.differentiation_blocks || [])];
  const byId = Object.fromEntries(allBlocks.map(b => [b.id, b]));
  let order = (pt.recommended_order || []).filter(id => byId[id]);
  if (page.block_set === 'short') {
    const short = pt.short_set && pt.short_set.length ? pt.short_set : allBlocks.filter(b => b.core).map(b => b.id);
    order = order.filter(id => short.includes(id));
  }
  const ov = ps.block_overrides || {};
  for (const id of ps.exclude_blocks || []) {
    if (!byId[id]) problems.push(`${slug}: exclude_blocks: блока ${id} нет в типе ${page.type}`);
    else if (byId[id].role === 'hero') problems.push(`${slug}: exclude_blocks: первый экран (${id}) исключать нельзя`);
    else if (order.includes(id)) rec.excluded.push(id);
  }
  // явный пустой facts у блока, который без фактов выпадает (drop-список, блок цифр), без id в task - решение стратега
  // снять блок: исключение, как exclude_blocks (без вопроса заказчику; его явные возражения уходят в авто-раскладку)
  for (const id of order) {
    const o = ov[id];
    if (!o || !Array.isArray(o.facts) || o.facts.length || rec.excluded.includes(id) || byId[id].role === 'hero') continue;
    if (!(id in dropRules) && !isNumbersBlock(byId[id])) continue;
    if (taskFactRefs(o.task || '').pos.length) continue;
    rec.excluded.push(id);
    pw('excluded', `${slug}: блок ${id} снят стратегом (пустой facts) - как exclude_blocks`);
  }
  order = order.filter(id => !rec.excluded.includes(id));
  for (const k of Object.keys(ov)) if (!byId[k]) pw('overrides', `${slug}: block_overrides.${k}: блока нет в типе ${page.type}`);
  if (!order.length) { problems.push(`${slug}: пустой порядок блоков`); finish(); continue; }

  // возражения: страницы и явные списки блоков (неизвестный id в override - проблема, id убирается)
  const pageObj = [];
  for (const id of ps.objection_ids || []) { if (objById[id]) pageObj.push(id); else pw('objections', `${slug}: objection_ids: возражения ${id} нет в audience.json`); }
  const explicitObj = {};
  for (const id of order) {
    const o = ov[id];
    if (!o || !Array.isArray(o.objection_ids)) continue;
    explicitObj[id] = o.objection_ids.filter(x => { if (objById[x]) return true; problems.push(`${slug}: block_overrides.${id}.objection_ids: возражения ${x} нет в audience.json`); return false; });
  }
  // явные возражения исключенных блоков не теряются: идут в авто-раскладку, как у выпавших без фактов
  const excludedObj = [];
  for (const id of rec.excluded) {
    for (const x of ((ov[id] || {}).objection_ids || [])) {
      if (objById[x]) excludedObj.push(x);
      else pw('objections', `${slug}: block_overrides.${id}.objection_ids (блок исключен): возражения ${x} нет в audience.json`);
    }
  }

  // b. факты страницы: facts, hero_facts, явные факты блоков, утвердительные id из task, факты возражений;
  // фильтр publish и «Где можно» (decisions.md v2) - до раздачи блокам
  const taskOf = id => taskFactRefs((ov[id] || {}).task || '');
  const named = [];
  const name = (id, from) => named.push({ id, from });
  (ps.facts || []).forEach(id => name(id, 'facts'));
  (ps.hero_facts || []).forEach(id => name(id, 'hero_facts'));
  for (const id of order) {
    (Array.isArray((ov[id] || {}).facts) ? ov[id].facts : []).forEach(f => name(f, `${id}.facts`));
    taskOf(id).pos.forEach(f => name(f, `${id}.task`));
    const neg = taskOf(id).neg;
    if (neg.length) pw('task', `${slug}: ${id}.task: id после отрицания (${neg.join(', ')}) в факты блока не взят - запрет пишется словами`);
  }
  const objAll = [...new Set([...pageObj, ...Object.values(explicitObj).flat(), ...excludedObj])];
  for (const oid of objAll) (objById[oid].facts || []).forEach(f => name(f, `возражение ${oid}`));
  const pageFactIds = [];
  const droppedFacts = {};
  for (const { id, from } of named) {
    if (pageFactIds.includes(id)) continue;
    let reason = '';
    const f = factsById[id];
    if (!f) reason = 'unknown';
    else if (f.publish !== 'yes') reason = 'publish';
    else if (dec.facts[id] && !decisionAllows(dec.facts[id].allow, page)) reason = 'where';
    else if (conflictOff.has(id)) reason = 'conflict';
    if (reason) { const d = (droppedFacts[id] ??= { id, reason, from: [] }); if (!d.from.includes(from)) d.from.push(from); continue; }
    pageFactIds.push(id);
  }
  for (const d of Object.values(droppedFacts)) {
    rec.facts_dropped.push(d);
    pw('facts', `${slug}: факт ${d.id} снят (${REASON[d.reason]}): ${d.from.join(', ')}`);
  }
  const pageSet = new Set(pageFactIds);

  // d. факты блоков (hero_facts; явный ov.facts окончательный; иначе fact_kinds с дедупликацией, срез 6) + id из task;
  // все - в пределах фактов страницы. Два прохода: второй - после выпадения блоков без фактов.
  // Дом факта (редакционный стандарт): факт, который стратег назвал в block_overrides.<блок>.facts или утвердительно в task
  // блока, другим блокам по fact_kinds не раздается - полная формулировка звучит в своем блоке. Без hero_facts первый
  // экран берет 2 первых факта страницы (одно главное доказательство), не 4.
  // дом факта: первый по порядку блок (кроме первого экрана), где стратег назвал факт в block_overrides.<блок>.facts или
  // утвердительно в task; он же owner_block факта в брифе
  function homeOf(ids) {
    const home = {};
    for (const id of ids) {
      if (byId[id].role === 'hero') continue;
      for (const fid of [...(Array.isArray((ov[id] || {}).facts) ? ov[id].facts : []), ...taskOf(id).pos]) home[fid] ??= id;
    }
    return home;
  }
  function assignFacts(ids) {
    const used = new Set();
    const home = homeOf(ids);
    let prev = [];
    return ids.map(id => {
      const b = byId[id];
      const o = ov[id] || {};
      let base;
      let homed = [];
      if (Array.isArray(o.facts)) base = o.facts;
      else if (b.role === 'hero') base = ps.hero_facts && ps.hero_facts.length ? ps.hero_facts : pageFactIds.slice(0, 2);
      else if (b.fact_kinds && b.fact_kinds.length) {
        const kindAll = pageFactIds.filter(fid => b.fact_kinds.includes(factsById[fid].kind));
        homed = kindAll.filter(fid => home[fid] && home[fid] !== id);
        const cand = kindAll.filter(fid => !homed.includes(fid));
        const fresh = cand.filter(fid => !used.has(fid));
        const need = contentLo(b);
        // добор до опор - фактами блоков выше, кроме соседа сверху (два соседних блока с одним аргументом - находка
        // редакционного стандарта); факты соседа - только если других нет совсем (иначе блок выпал бы с вопросом заказчику)
        const reuse = cand.filter(fid => used.has(fid) && !prev.includes(fid));
        let pick = fresh.length >= need ? fresh : [...fresh, ...reuse.slice(0, need - fresh.length)];
        if (!pick.length) pick = cand.filter(fid => prev.includes(fid)).slice(0, need);
        base = pick.slice(0, 6);
        // правило выпадения по виду (cases:number) считается по кандидатам до дедупликации: если дедупликация сняла
        // последний факт нужного вида (его взял блок выше), один такой факт возвращается
        const dk = dropRules[id];
        if (dk && !base.some(fid => factsById[fid].kind === dk)) {
          const one = cand.find(fid => factsById[fid].kind === dk && !prev.includes(fid)) || cand.find(fid => factsById[fid].kind === dk);
          if (one) { const keep = base.slice(0, 5); base = cand.filter(fid => keep.includes(fid) || fid === one); }
        }
      } else base = [];
      const bf = [...new Set([...base, ...taskOf(id).pos])].filter(fid => pageSet.has(fid));
      bf.forEach(fid => used.add(fid));
      prev = bf;
      return { id, facts: bf, explicit: Array.isArray(o.facts), homed };
    });
  }
  // причина выпадения блока или '': блок цифр без числового факта или без свежего (все его числовые факты взяли блоки
  // выше - писатель цифру не повторяет, 05-block-writer п.3); блок из drop-списка без фактов (нужного вида).
  // Явные facts стратега по свежести не выпадают: повтор цифр первого экрана в полосе цифр - его решение (граница
  // number - от 1, ниже). above - факты оставшихся блоков выше (как usedAbove границы count ниже)
  const STALE = 'нет свежих числовых фактов (все у блоков выше)';
  const HOMED = 'факты блока звучат в своих блоках (дом факта: block_overrides и task стратега)';
  const mustDrop = (x, above) => {
    const b = byId[x.id];
    if (b.role === 'hero') return '';
    if (isNumbersBlock(b)) {
      const nums = x.facts.filter(fid => factsById[fid].kind === 'number');
      if (!nums.length) return x.homed.some(fid => factsById[fid].kind === 'number') ? HOMED : 'нет числовых фактов';
      if (!x.explicit && !nums.some(fid => !above.has(fid))) return STALE;
    }
    if (!(x.id in dropRules)) return '';
    const kind = dropRules[x.id];
    if (x.explicit || !kind) return x.facts.length ? '' : (x.homed.length ? HOMED : 'нет фактов');
    return x.facts.some(fid => factsById[fid].kind === kind) ? '' : (x.homed.some(fid => factsById[fid].kind === kind) ? HOMED : 'нет фактов');
  };
  // проход раздачи, выпадение, повторная раздача без выпавших; повторяется, пока выпадают блоки (раздача без выпавших
  // блоков выше может отдать свежий числовой факт блоку выше блока цифр). Вопрос заказчику - только при нехватке фактов:
  // блок цифр, чьи числа уже сказаны выше, фактов не просит (предупреждение)
  const droppedIds = [];
  const staleIds = [];
  let dealt = assignFacts(order);
  for (let round = 0; round < order.length; round++) {
    const above = new Set();
    const now = [];
    for (const x of dealt) {
      const why = mustDrop(x, above);
      if (!why) { x.facts.forEach(fid => above.add(fid)); continue; }
      now.push(x.id);
      if (why === STALE || why === HOMED) { staleIds.push(x.id); rec.dropped_repeat.push({ block: x.id, reason: why }); continue; }
      rec.dropped.push({ block: x.id, reason: why });
      rec.questions.push({ text: `Нужны факты для блока «${byId[x.id].name}»: ${byId[x.id].reader_question}`, blocks: [x.id] });
    }
    if (!now.length) break;
    droppedIds.push(...now);
    order = order.filter(id => !now.includes(id));
    dealt = assignFacts(order);
  }
  const noFacts = droppedIds.filter(id => !staleIds.includes(id));
  if (noFacts.length) pw('dropped', `${slug}: без фактов выпали блоки ${noFacts.join(', ')}`);
  const homedIds = rec.dropped_repeat.filter(x => x.reason === HOMED).map(x => x.block);
  const staleNum = staleIds.filter(id => !homedIds.includes(id));
  if (staleNum.length) pw('dropped', `${slug}: выпали блоки цифр ${staleNum.join(', ')}: все их числовые факты у блоков выше (вопроса заказчику нет)`);
  if (homedIds.length) pw('dropped', `${slug}: выпали блоки ${homedIds.join(', ')}: их факты звучат в своих блоках (вопроса заказчику нет)`);
  const assigned = Object.fromEntries(dealt.map(x => [x.id, x.facts]));
  // первый экран без фактов при фактах у страницы (все hero_facts сняты) - заметка для рецензии стратегии
  {
    const heroId = order.find(id => byId[id].role === 'hero');
    if (heroId && !(assigned[heroId] || []).length && (pageFactIds.length || (ps.hero_facts || []).length)) {
      const lostHero = (ps.hero_facts || []).filter(fid => !pageSet.has(fid));
      note('hero-facts', slug, `${slug}: первый экран без фактов${lostHero.length ? ` (hero_facts ${lostHero.join(', ')} сняты: ${lostHero.map(fid => REASON[(droppedFacts[fid] || {}).reason] || 'не в фактах страницы').join('; ')})` : ''} - задай hero_facts из публикуемых фактов страницы`);
    }
  }

  // c. возражения по слотам: явные списки окончательны; остальные (не названные явно ни в одном оставшемся блоке) -
  // сначала objection_to_block, затем по кругу в слот с наименьшей загрузкой; только блоки без явного списка
  const explicitKept = new Set(order.flatMap(id => explicitObj[id] || []));
  const pool = [...new Set([...pageObj, ...droppedIds.flatMap(id => explicitObj[id] || []), ...excludedObj])].filter(x => !explicitKept.has(x));
  const slots = order.filter(id => byId[id].objection_slot && !(id in explicitObj));
  const homeable = order.filter(id => byId[id].role !== 'hero' && !(id in explicitObj));
  const load = Object.fromEntries(slots.map(s => [s, 0]));
  const autoObj = {};
  const o2b = (strategy.global || {}).objection_to_block || {};
  for (const oid of pool) {
    // блок стратега закрывает возражение по смыслу: слот, иначе любой блок страницы без явного списка, кроме первого
    // экрана (там одно доказательство) - не по кругу в чужой слот; финальный призыв: cta-final и cta старых данных - синонимы
    const wanted = [].concat(o2b[oid] || []);
    const pref = wanted.map(t => resolveBlockId(t, slots)).find(Boolean) || wanted.map(t => resolveBlockId(t, homeable)).find(Boolean);
    const target = pref || slots.reduce((best, s) => (best === null || load[s] < load[best] ? s : best), null);
    if (!target) { rec.objections_unassigned.push(oid); continue; }
    (autoObj[target] ??= []).push(oid);
    load[target] = (load[target] || 0) + 1;
  }
  if (rec.objections_unassigned.length) pw('objections', `${slug}: возражения без блока (нет слота): ${rec.objections_unassigned.join(', ')}`);
  const pageObjections = [...new Set([...pageObj, ...Object.values(explicitObj).flat(), ...excludedObj])].map(id => objById[id]);

  // e. элементы: лимиты effectiveMax, контракт кнопок, нижняя граница count по опорам
  const links = linksFor(page);
  const isListingPage = listingPage(page);
  const blocks = order.map((id, i) => {
    const b = byId[id];
    const bFacts = assigned[id] || [];
    const listing = isListing(b);
    // витрина каталога: писатель дает только вступление и подписи фильтров, карточки приходят из спецификации каталога.
    // Элемент filters добавляется только на страницах со списком позиций (listing: true); свой filters типа остается.
    // Подписи фильтров - только названия признаков: значения задает спецификация каталога (фаза 7). Подсказка типа
    // («название группы и 2-4 значения») заменяется всегда: иначе у писателя два противоположных указания (п.19).
    let elements = (b.elements || []).filter(e => !listing || LISTING_KINDS.has(e.kind)).map(e => {
      const max = effectiveMax(e.kind, e.chars && e.chars.max, '', limits);
      const ch = e.chars || {};
      return { kind: e.kind, count: optionalCount(b, e), chars: { min: Math.min(ch.min || 0, max), median: Math.min(ch.median || 0, max), max }, note: e.kind === 'filters' ? FILTERS_NOTE : (e.note || '') };
    });
    if (listing && isListingPage && !elements.some(e => e.kind === 'filters')) elements.push({ kind: 'filters', count: '3-7', chars: { min: 5, median: 12, max: kindCap('filters', limits) }, note: FILTERS_NOTE });
    if (!elements.length) elements.push({ kind: 'h2', count: '1', chars: { min: 0, median: 0, max: kindCap('h2', limits) }, note: '' });
    // без ссылок в карте (лендинг) элемент link необязателен
    if (!links.length) for (const e of elements) { const c = parseCount(e.count); if (e.kind === 'link' && c && c.lo > 0) e.count = fmtCount(0, c.hi); }
    const blk = {
      block_id: `B${String(i + 1).padStart(2, '0')}-${id}`,
      type: id, name: b.name, role: b.role, reader_question: b.reader_question, pattern: b.pattern,
      ...(b.custom_name ? { custom_name: b.custom_name } : {}),
      cta_allowed: b.role === 'hero' ? true : !!b.cta_allowed,
      objection_ids: explicitObj[id] || autoObj[id] || [],
      facts: bFacts,
      elements,
      examples: (b.examples || []).slice(0, 3),
      task: (ov[id] || {}).task || '',
      notes: b.notes || '',
    };
    blockContract(blk, limits).forEach(w => pw('buttons', `${slug}: ${w}`));
    // нижняя граница count - не больше опор блока (инвариант опоры сильнее замеров лидеров). Опоры - единицами: пункты
    // списка внутри факта (factUnits); шаги - по фактам процесса; цифры - по свежим числовым фактам (без единиц): факт,
    // который уже взял блок выше, писатель цифрой не повторяет (05-block-writer п.3); вопросы - плюс возражения блока с
    // фактами; списки и плашки - плюс возражения, чьи факты не входят в факты блока (иначе один факт считался дважды:
    // единицами и возражениями). Сетки (карточки, шаги, вопросы, строки) - не ниже 2, списки и плашки - не ниже 1,
    // цифры - хоть 0 (блок цифр без свежего числового факта выпал выше; при явных facts стратега в блоке цифр - от 1:
    // повтор чисел выше - его решение). В блоке цифр после прижима number прочие элементы без своих опор (подписи
    // note, h3, text) с нижней границей выше новой границы number ограничиваются ей: иначе честные 2 цифры дают major по
    // подписям. Элементы с опорами (карточки, списки, плашки) держат свою границу по своим опорам, от порядка элементов
    // итог не зависит. Только предупреждение: нехватку по содержанию ловят писатель, судья и фиксер.
    if (!NO_SUPPORT_PATTERNS.has(b.pattern)) {
      const units = ids => ids.reduce((n, fid) => n + factUnits(factsById[fid]), 0);
      const objFacts = oid => (objById[oid].facts || []).filter(f => pageSet.has(f));
      const objSupports = blk.objection_ids.filter(oid => objFacts(oid).length).length;
      const objOutside = blk.objection_ids.filter(oid => objFacts(oid).some(f => !bFacts.includes(f))).length;
      const usedAbove = new Set(order.slice(0, i).flatMap(x => assigned[x] || []));
      const numbersBlock = isNumbersBlock(b);
      let numberLo = null;
      for (const e of blk.elements) {
        if (!FLOOR_KINDS.has(e.kind)) continue;
        const c = parseCount(e.count);
        if (!c) continue;
        let supports;
        if (e.kind === 'step') supports = units(bFacts.filter(fid => factsById[fid].kind === 'process'));
        else if (e.kind === 'number') {
          const nums = bFacts.filter(fid => factsById[fid].kind === 'number');
          supports = nums.filter(fid => !usedAbove.has(fid)).length;
          if (numbersBlock && nums.length && Array.isArray((ov[id] || {}).facts)) supports = Math.max(1, supports);
        }
        else supports = units(bFacts);
        if (e.kind === 'qa') supports += objSupports;
        else if (e.kind === 'bullets' || e.kind === 'badges') supports += objOutside;
        if (c.lo <= supports) continue;
        const lo = GRID_KINDS.has(e.kind) ? Math.max(2, supports) : e.kind === 'number' ? supports : Math.max(1, supports);
        if (lo >= c.lo) continue;
        e.count = fmtCount(lo, Math.max(lo, c.hi));
        pw('count', `${slug}: ${blk.block_id}: ${e.kind} ${c.lo}-${c.hi} при опорах ${supports} -> ${e.count}`);
        if (e.kind === 'number' && numbersBlock) numberLo = numberLo === null ? lo : Math.min(numberLo, lo);
      }
      if (numberLo !== null) for (const o of blk.elements) {
        if (FLOOR_KINDS.has(o.kind)) continue;
        const oc = parseCount(o.count);
        if (!oc || oc.lo <= numberLo) continue;
        o.count = fmtCount(numberLo, Math.max(numberLo, oc.hi));
        pw('count', `${slug}: ${blk.block_id}: ${o.kind} ${oc.lo}-${oc.hi} вместе с number -> ${o.count}`);
      }
    }
    return blk;
  });

  // h. оговорка-дисклеймер: только в блоке, который выбрал стратег (disclaimer_block; финальный призыв - и под старым
  // id cta). Нет такого блока на странице - оговорки на ней нет (запасного блока с CTA нет: оговорка не лезет в призывы
  // служебных страниц). Служебная записка вместо текста в брифы не идет (предупреждение выше).
  let discOn = '';
  if (discUsable) {
    const tid = resolveBlockId(discBlock, blocks.map(b => b.type));
    const target = tid && blocks.find(b => b.type === tid && b.role !== 'hero');
    if (target) { target.disclaimer_text = discText; discOn = target.block_id; discPlaced++; }
  }

  // g. CTA: объект C3 (строку старых данных - в {main}); страница наследует от global.cta_by_type поля, которых не задала
  // (action и short - при той же подписи main, secondary_action - при той же подписи secondary: lib.mjs mergeCta);
  // action проверяется; слабый глагол - предупреждение
  const merged = mergeCta(((strategy.global || {}).cta_by_type || {})[page.type], ps.cta);
  const cta = merged.cta;
  if (typeof cta.main !== 'string') cta.main = String(cta.main || '');
  if (merged.lost.length) note('cta', slug, `${slug}: подпись CTA страницы изменена, ${merged.lost.join(', ')} из global.cta_by_type.${page.type} не перенесены - задай их в записи страницы`);
  const blockTypes = blocks.map(b => b.type);
  for (const field of ['action', 'secondary_action']) {
    if (cta[field] == null || cta[field] === '') { delete cta[field]; continue; }
    // anchor на финальный призыв: cta-final и cta старых данных - синонимы (действие переписывается на id блока страницы)
    const act = String(cta[field]);
    if (act.startsWith('anchor:')) { const t = resolveBlockId(act.slice(7), blockTypes); if (t && t !== act.slice(7)) cta[field] = `anchor:${t}`; }
    const err = checkAction(slug, field, String(cta[field]), blockTypes);
    if (err) { pw('cta', `${slug}: CTA ${err} - снято, действует правило сборщика`); delete cta[field]; }
  }
  if (cta.short && cta.short.length > 20) { pw('cta', `${slug}: CTA short «${cta.short}» длиннее 20 знаков - снято`); delete cta.short; }
  for (const field of ['main', 'secondary']) {
    const t = String(cta[field] || '').toLowerCase();
    const bad = badVerbs.find(v => t.includes(v));
    if (bad) pw('cta', `${slug}: CTA ${field} «${cta[field]}»: слабый глагол «${bad}» - кнопка должна называть, что получит читатель`);
  }
  if (!cta.main) pw('cta', `${slug}: нет текста главной кнопки (cta.main)`);

  // сегмент брифа
  const segs = segIds.map(id => segById[id]);
  const segment = isAll
    ? {
      id: 'all', name: SEGMENT_ALL_NAME,
      portrait: segs.map(s => `${s.name}: ${s.comes_with || s.portrait || ''}`.replace(/:\s*$/, '')).join('; ').slice(0, 600),
      comes_with: '', pains: segs.map(s => (s.pains || [])[0]).filter(Boolean), fears: [],
      criteria: [...new Set(segs.flatMap(s => s.criteria || []))], objections: pageObjections,
      segments: segs.map(s => ({ id: s.id, name: s.name, comes_with: s.comes_with || '' })),
    }
    : { id: segs[0].id, name: segs[0].name, portrait: segs[0].portrait, comes_with: segs[0].comes_with || '', pains: segs[0].pains || [], fears: segs[0].fears || [], criteria: segs[0].criteria || [], objections: pageObjections };

  const formulaId = ps.offer_formula || ((strategy.global || {}).offer_formula_by_type || {})[page.type] || '';
  const formula = (formulas.formulas || []).find(f => f.id === formulaId) || { id: formulaId, name: formulaId, recipe: '' };
  const bank = Object.fromEntries(((strategy.global || {}).argument_bank || []).map(x => [x.fact_id, x.angles || []]));
  const angleOf = fid => { for (const sid of segIds) { const hit = (bank[fid] || []).find(x => x.segment === sid); if (hit && hit.angle) return hit.angle; } return ''; };
  // owner_block - домашний блок факта (дом из block_overrides и task стратега, если блок на странице и факт в нем есть),
  // иначе первый по порядку блок, получивший факт (у hero_facts без дома - первый экран). Писатель раскрывает факт полностью
  // только в его owner_block (05-block-writer п.3): дом важнее первого экрана, который назвал факт коротко
  const owner = {};
  const homeIds = homeOf(order);
  blocks.forEach((b, i) => { for (const fid of b.facts) if (homeIds[fid] === order[i]) owner[fid] ??= b.block_id; });
  for (const b of blocks) for (const fid of b.facts) owner[fid] ??= b.block_id;

  // ключевая фраза страницы (K5): маркер из карты (pages[].key_phrase), иначе первый запрос source_queries
  const keyPhrase = String(page.key_phrase || (Array.isArray(page.source_queries) ? page.source_queries[0] : '') || '').trim();

  // пожелания заказчика: адрес на блок, которого на странице нет (для пожелания, явно назначенного странице) - предупреждение
  const pagePrefs = (prefs.items || []).filter(x => !x.pages || !x.pages.length || x.pages.includes(slug));
  const SPECIAL = new Set(['', 'tone', 'all', 'все', 'must-say', 'shell', 'none', 'hero', 'positioning', 'cta', 'not-promise']);
  for (const x of pagePrefs) {
    if (!x.pages || !x.pages.includes(slug)) continue;
    const toks = String(x.where || '').toLowerCase().split(/[,;]/).map(t => t.trim()).filter(Boolean);
    if (toks.length && !toks.some(t => SPECIAL.has(t) || resolveBlockId(t, blockTypes) || blocks.some(b => b.block_id.toLowerCase() === t))) pw('prefs', `${slug}: пожелание «${String(x.text).slice(0, 60)}» адресовано блоку ${x.where}, которого на странице нет`);
  }

  // предмет страницы и ключевая фраза под антиобещанием или запретом стратега: H1 с предметом не пройдет линтер
  for (const [what, val] of [['предмет страницы', page.subject], ['ключевая фраза', keyPhrase]]) {
    if (!val) continue;
    const hits = [...antiRes.filter(x => x.re.test(val)).map(x => `антиобещание ${x.id}`), ...(ps.do_not_say || []).filter(w => { try { return stemRe(w).test(val); } catch { return false; } }).map(w => `запрет стратега «${w}»`)];
    if (hits.length) pw('vocab', `${slug}: ${what} «${val}» попадает под ${hits.join(', ')} - первый экран с предметом страницы не пройдет линтер`);
  }

  const brief = {
    slug, url: page.url, type: page.type, subject: page.subject, ...(keyPhrase ? { key_phrase: keyPhrase } : {}), geo: page.geo || '', block_set: page.block_set || 'full',
    company: cfg.company, positioning: (strategy.global || {}).positioning || '', main_promise: (strategy.global || {}).main_promise || '',
    segment,
    unique_argument: ps.unique_argument, hook: ps.hook || '',
    offer_formula: { id: formula.id, name: formula.name, recipe: formula.recipe || '' },
    cta,
    facts: pageFactIds.map(fid => {
      const f = factsById[fid], d = dec.facts[fid];
      return {
        id: f.id, label: f.label, value: f.value, wording: f.wording, kind: f.kind, angle: angleOf(fid),
        // rule с числами, которых нет в факте (ruleOff), не кладется: старая формулировка не подтверждает устаревшее число
        ...(f.note ? { note: f.note } : {}), ...(d && d.rule && !ruleOff.has(fid) ? { rule: d.rule } : {}), ...(d && d.where ? { where: d.where } : {}), ...(owner[fid] ? { owner_block: owner[fid] } : {}),
      };
    }),
    unknowns,
    anti_promises: (facts.anti_promises || []).map(x => ({ id: x.id, text: x.text, allowed_context: x.allowed_context || '' })),
    disclaimer_text: discOn ? discText : '',
    terminology: facts.terminology,
    client_phrases: (audience.client_phrases || []).filter(p => !p.segments || !p.segments.length || p.segments.some(s => segIds.includes(s))).slice(0, 15).map(p => ({ phrase: p.phrase, meaning: p.meaning, ...(p.src ? { src: p.src } : {}) })),
    do_not_say: ps.do_not_say || [],
    cliches_to_avoid: pt.cliches_to_avoid || [],
    // pages не задан или пуст - пожелание для всех страниц
    client_preferences: pagePrefs.map(x => ({ text: x.text, status: x.status, where: x.where || '' })),
    // разрешенные ссылки: только страницы карты, ближние первыми; писатель не выдумывает URL
    links,
    blocks,
  };
  const errors = validate(loadSchema('brief'), brief);
  if (errors.length) { problems.push(`${slug}: бриф не прошел схему: ${errors.slice(0, 3).join('; ')}`); finish(); continue; }

  // j. запись
  let old = null;
  try { if (exists(out)) old = readJson(out); } catch { old = null; }
  const ids = brief.blocks.map(b => b.block_id);
  const oldIds = old && Array.isArray(old.blocks) ? old.blocks.map(b => b.block_id) : null;
  const hasBlocks = writtenBlocks(slug).length > 0;
  let write = false, renumber = false;
  if (!old) write = true;
  else if (oldIds && oldIds.join() === ids.join()) {
    if (canon(old) !== canon(brief)) { write = true; if (hasBlocks) relint.push(slug); }
  } else if (!hasBlocks) {
    write = true;
    info.push(`${slug}: состав блоков изменился (блоков еще нет) - бриф пересобран: ${(oldIds || []).filter(x => !ids.includes(x)).map(x => '-' + x).concat(ids.filter(x => !(oldIds || []).includes(x)).map(x => '+' + x)).join(' ')}`);
  } else if (a.force) {
    write = true; renumber = true; relint.push(slug);
  } else {
    rec.structure_changed = true;
    structureChanged++;
    pw('structure', `${slug}: структура изменилась (${(oldIds || []).join(',')} -> ${ids.join(',')}), блоки уже написаны - бриф не тронут, нужен --force`);
  }
  if (write) {
    writeJson(out, brief);
    built++;
    if (renumber) {
      const r = spawnSync(process.execPath, [path.join('scripts', 'renumber-blocks.mjs'), slug], { cwd: process.cwd(), encoding: 'utf8' });
      info.push(`${slug}: перенумерация блоков: ${((r.stdout || '') + (r.stderr || '')).trim().split('\n').join(' | ')}`);
      if (r.status !== 0) problems.push(`${slug}: renumber-blocks.mjs завершился с кодом ${r.status}`);
    }
  } else if (!rec.structure_changed) same++;
  if (page.status === 'planned' && (write || old)) { page.status = 'briefed'; statusChanged = true; }
  finish();

  // запись страницы в отчете: при «структура изменилась» прежние поля остаются, ставится только флаг
  rec.questions = [...new Map(rec.questions.map(q => [q.text, q])).values()];
  rec.warnings = warnings.slice(warnStart).map(w => w.text);
  rec.problems = problems.slice(problemStart);
  if (!rec.problems.length) delete rec.problems;
  reportPages[slug] = rec.structure_changed && reportPages[slug] ? { ...reportPages[slug], structure_changed: true, warnings: rec.warnings } : rec;
}
if (statusChanged) saveSitemap(sm);
if (discUsable && pages.length && !discPlaced) warn('disclaimer', null, `оговорка не поставлена ни на одну собранную страницу: блока ${discBlock} нет на страницах - проверь disclaimer_block`);

// ---------- work/briefs-report.json: слияние по страницам ----------
const liveSet = new Set(live.map(p => p.slug));
for (const s of Object.keys(reportPages)) if (!liveSet.has(s)) delete reportPages[s];
const qmap = new Map();
for (const [s, r] of Object.entries(reportPages)) for (const q of r.questions || []) {
  const e = qmap.get(q.text) || { text: q.text, pages: [], blocks: [] };
  if (!e.pages.includes(s)) e.pages.push(s);
  for (const b of q.blocks || []) if (!e.blocks.includes(b)) e.blocks.push(b);
  qmap.set(q.text, e);
}
const globalWarnings = warnings.filter(w => !w.slug).map(w => w.text);
writeJson(REPORT, {
  generated_at: nowIso(),
  pages: reportPages,
  questions: [...qmap.values()],
  warnings: [...globalWarnings, ...Object.values(reportPages).flatMap(r => r.warnings || [])],
});

// ---------- вывод: проблемы целиком, затем сводка предупреждений по видам ----------
if (problems.length) { console.log(`проблемы (${problems.length}):`); problems.forEach(p => console.log(' - ' + p)); }
if (warnings.length) {
  const byKind = {};
  for (const w of warnings) (byKind[w.kind] ??= []).push(w.text);
  console.log(`предупреждения (${warnings.length}) по видам:`);
  for (const [k, list] of Object.entries(byKind)) console.log(` - ${k}: ${list.length}; например: ${list.slice(0, 3).join(' | ')}`);
}
// заметки для рецензии стратегии - целиком, строками « ~ » (как предупреждения по содержанию merge-strategy)
if (reviewNotes.length) { console.log(`для рецензии стратегии (${reviewNotes.length}):`); reviewNotes.slice(0, 60).forEach(t => console.log(' ~ ' + t)); }
info.forEach(l => console.log(l));
if (relint.length) console.log(`перелинтовать (бриф изменился, блоки уже написаны): ${relint.join(', ')} - node scripts/lint-page.mjs <slug>`);
console.log(`брифов собрано: ${built}, без изменений: ${same}, структура изменилась: ${structureChanged}, срезов для писателей: ${sliced}, проблем: ${problems.length}, предупреждений: ${warnings.length}; отчет work/briefs-report.json`);
if (problems.length) process.exit(1);
