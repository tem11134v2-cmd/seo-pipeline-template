// Итоговый отчет по прогону (C9): work/output/report.md. node scripts/report.mjs
// Без LLM, из корня задачи. Собирается после фазы 8 и после --fix (шаг сборки wf-06b). Разделы:
//   Сводка - производные статусы страниц (scripts/progress.mjs: написано, готово, заблокировано, в работе, без брифа), блоки
//            pass/total и скелеты в прототипе (все блоки без lint pass, из них exhausted - с причиной), импорт, брифы со
//            сменой структуры, разбор лидеров без конкурентов (competitors.json degraded), правки без проверки судьей,
//            проверки прототипа, каталог;
//   Что спросить у заказчика - открытые gaps, unknowns брифов, [[нужно: ...]] в текстах, needs_fact писателей (поле блока),
//            судей и слепого читателя (все круги round-*, blind, human) и кросса (живые отчеты и архивы cross-archive-*.json,
//            статус из самого свежего), прочие отказы фиксеров «нет факта» (retro-stats.mjs, раздел no_fact), выпавшие без
//            фактов блоки и вопросы work/briefs-report.json, сайты-ориентиры при разборе без конкурентов; без повторов, у
//            каждого вопроса страницы и блоки;
//   Не подтверждено или снято - факты publish: no и технические пробелы (для оператора); факты оператора F8xx строками
//            листа ответов анализа (F8NN: <что> = <значение> << <фраза>; без F8NN - «+:»);
//   Спорное: решения агента - decisions.md §8 (только формат v2), work/audit/strategy-review.json, disputes стратегов типов;
//   Предупреждения сборки брифов - work/briefs-report.json -> warnings;
//   Повторы между страницами - подтвержденные кросс-судьей (cross.json и архивы cross-archive-*.json, статус из самого
//            свежего), не исправленные (страницы вне аудита), правила dedup числами, кандидаты шинглов одной строкой;
//   Major, закрытые фиксером без правки;
//   Правки без проверки судьей - проходы фиксеров из work/audit/<slug>/fix-diff.json (fix-diff.mjs), после которых круга
//            судьи с большим номером нет: новые и измененные предложения по блокам, удаления, откаты;
//   Проверки прототипа (check-html, check-site-js); Интерфейс прототипа (prototype.modules.json, пожелания к оболочке);
//   Каталог (ТЗ, примеры товаров, открытые находки аудита ТЗ по статусам work/audit/catalog-tz.json и число вопросов
//            раздела 8 work/catalog/tz.md - они в документе ТЗ, в вопросы заказчику не копируются); По страницам.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import { P, readJson, exists, writeText, loadConfig, loadSitemap, loadBlocks, blockPlainText, PLACEHOLDER_RE, nowIso } from './lib.mjs';
import { pageProgress, pageFindings, waves, isOpenStatus, isSerious, isCrossArchive, archiveStamp, blockKey, ARCHIVE_PREFIX } from './progress.mjs';
import { protoDataSha } from './render-blocks.mjs';

const ROOT = process.cwd();
const rjs = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, '')); } catch { return null; } };
const clean = s => String(s ?? '').replace(/\s+/g, ' ').trim();
const clip = (s, n) => { s = clean(s); return s.length > n ? s.slice(0, n - 3) + '...' : s; };
const qKey = s => clean(s).toLowerCase().replace(/\u0451/g, 'е').replace(/[^a-zа-я0-9]+/gi, ' ').trim();
const listMore = (arr, n = 8) => arr.slice(0, n).join(', ') + (arr.length > n ? ` и еще ${arr.length - n}` : '');
const place = (slug, block) => [slug, block].filter(Boolean).join('/');

const cfg = (() => { try { return loadConfig(); } catch { return {}; } })();
const sm = loadSitemap();
const live = sm.pages.filter(p => p.status !== 'skip');
const W = waves(ROOT, sm);
const factsDoc = rjs(P('work', 'facts.json')) || {};
const facts = Array.isArray(factsDoc.facts) ? factsDoc.facts : [];
const gaps = (Array.isArray(factsDoc.gaps) ? factsDoc.gaps : []).map(clean).filter(Boolean);
const imp = rjs(P('work', 'import-report.json'));
const br = rjs(P('work', 'briefs-report.json')) || {};
const prog = Object.fromEntries(live.map(p => [p.slug, pageProgress(ROOT, p.slug)]));
const briefOf = slug => rjs(P('work', 'pages', slug, 'brief.json'));

// отказы фиксеров «нет факта» считает retro-stats.mjs (раздел no_fact); сбой скрипта - раздел без них
let retro = null;
if (exists(P('scripts', 'retro-stats.mjs'))) {
  const r = spawnSync(process.execPath, [P('scripts', 'retro-stats.mjs')], { cwd: ROOT, encoding: 'utf8' });
  if (r.status === 0) retro = rjs(P('work', 'audit', 'retro-stats.json'));
}

// ---------------------------------------------------------------- отчеты кросса с архивами
// Общий cross.json и архивы work/audit/cross-archive-*.json, постраничные копии и их архивы. Одна находка - статус из самого
// свежего отчета (метка архива или created_at живого); при равной метке - решение фиксера (не open), недостающие поля
// (proposal, needs_fact от фиксера) - из другой копии того же отчета.
const auditDir = P('work', 'audit');
const archivesIn = d => (exists(d) ? fs.readdirSync(d).filter(isCrossArchive).sort().map(f => path.join(d, f)) : []);
const crossFiles = [P('work', 'audit', 'cross.json'), ...archivesIn(auditDir)];
for (const p of live) crossFiles.push(P('work', 'audit', p.slug, 'cross.json'), ...archivesIn(P('work', 'audit', p.slug)));
const crossReports = crossFiles.map(file => {
  const r = rjs(file);
  if (!r || !Array.isArray(r.findings)) return null;
  const stamp = isCrossArchive(file) ? path.basename(file, '.json').slice(ARCHIVE_PREFIX.length) : archiveStamp(r.source_created_at || r.created_at || '');
  return { stamp, findings: r.findings.filter(f => f && typeof f === 'object') };
}).filter(Boolean);
function crossLatest(keyOf, want) {
  const m = new Map();
  for (const { stamp, findings } of crossReports) for (const f of findings) {
    if (!want(f)) continue;
    const k = keyOf(f);
    const prev = m.get(k);
    if (!prev || stamp > prev.stamp) { m.set(k, { f, stamp }); continue; }
    if (stamp < prev.stamp) continue;
    const [a, b] = isOpenStatus(prev.f.status) && !isOpenStatus(f.status) ? [prev.f, f] : [f, prev.f];
    m.set(k, { f: { ...a, ...b, needs_fact: !!(a.needs_fact || b.needs_fact) }, stamp });
  }
  return [...m.values()].map(x => x.f);
}

const L = [];
L.push(`# Отчет по текстам: ${cfg.company || cfg.slug || ''}`);
L.push(`Дата: ${nowIso()}`);
L.push('');

// ---------------------------------------------------------------- вопросы заказчику
const Q = new Map();
function addQ(text, where, src) {
  const t = clean(text).replace(/[\s;,:]+$/, '');
  const k = qKey(t);
  if (!k) return;
  let q = Q.get(k);
  if (!q) Q.set(k, q = { text: t, places: new Set(), src: new Set() });
  if (where) q.places.add(where);
  q.src.add(src);
}
// needs_fact находки - вопрос, пока она открыта или закрыта фиксером без правки «нет факта» (fixed - утверждение убрано)
const NO_FACT = /нет\s+(подтвержденного\s+|такого\s+)?факт|факт(а|ов)?\s+(нет|не\s+хватает)|не\s+подтвержд|нет\s+в\s+(брифе|фактах)/i;
const asksFact = f => !!f.needs_fact && (isOpenStatus(f.status) || (/^(wontfix|rejected)$/.test(f.status || '') && (!clean(f.resolution) || NO_FACT.test(f.resolution))));
// текст вопроса: у закрытой фиксером - что он назвал недостающим («нет факта: ...», первая фраза), у открытой - proposal судьи
const factText = f => {
  const miss = !isOpenStatus(f.status) && (String(f.resolution || '').match(/нет\s+факта\s*[:.]\s*([\s\S]+)/i) || [])[1];
  return clip(miss ? miss.split(/(?<=[.;])\s+/)[0] : clean(f.proposal) || f.problem, 300);
};
// находки, взятые напрямую: их отказы фиксера в retro-stats (no_fact) не дублируются
const direct = new Set();
function markDirect(page, f) {
  const b = blockKey(f.block_id), q = qKey(f.quote).slice(0, 60);
  if (f.id) direct.add(`${page}|${b}|${f.id}`);
  if (q) direct.add(`${page}|${b}|q:${q}`);
}
// пробелы для оператора, а не вопросы заказчику: регулярки, разобранные составителем конфликты, режим импорта
// «<поле> снят заказчиком (Fxx publish no): в company и на сайт не идет» (импорт, prepareCompany) - заказчик уже ответил,
// строка для оператора, а не вопрос
const TECH_GAP = [/^регулярка антиобещания/i, /^конфликт:/i, /^факты не подтверждены заказчиком/i, /^телефона для сайта нет/i, / снят заказчиком \(F\d{2,3} publish no\)/];
const HELD_GAP = /^F\d{2,3} «[^»]*» не подтвержден или снят/;
const techGaps = gaps.filter(g => TECH_GAP.some(re => re.test(g)));
// unknowns брифа повторяют gaps (они остаются вопросом на весь сайт) и label снятых фактов (они - в «Не подтверждено»)
const siteWide = new Set(gaps.map(qKey));
for (const g of gaps) if (!techGaps.includes(g) && !HELD_GAP.test(g)) addQ(g, '', 'gaps');
// разбор лидеров без конкурентов (competitors.json degraded: no_competitors): типы собраны по анализу и форме фикстуры
// (sources: [], notes «без конкурентов...») - заказчику вопрос о сайтах-ориентирах
const comp = rjs(P('work', 'competitors', 'competitors.json'));
const noCompetitors = !!comp && comp.degraded === 'no_competitors';
const ptDir = P('work', 'page-types');
const noCompTypes = (exists(ptDir) ? fs.readdirSync(ptDir).filter(f => f.endsWith('.json')).sort() : [])
  .map(f => [path.basename(f, '.json'), rjs(path.join(ptDir, f))])
  .filter(([, t]) => t && ((Array.isArray(t.sources) && !t.sources.length) || /^\s*без конкурентов/i.test(String(t.notes || ''))))
  .map(([k]) => k);
if (noCompetitors) addQ('Сайты лидеров ниши не открылись: назовите 2-3 сайта-ориентира (конкурентов или просто сайты, которые вам нравятся) - по ним сверим набор блоков страниц', '', 'competitors');
const heldLabels = new Set(facts.filter(f => f.publish === 'no').map(f => qKey(f.label || f.id)));
let placeholders = 0;
for (const p of live) {
  const pr = prog[p.slug];
  if (!pr.briefed) continue;
  const brief = briefOf(p.slug) || {};
  for (const u of Array.isArray(brief.unknowns) ? brief.unknowns : []) {
    const k = qKey(u);
    if (!k || /^g\d+$/i.test(clean(u)) || heldLabels.has(k) || siteWide.has(k)) continue;
    addQ(u, p.slug, 'unknowns');
  }
  for (const { block } of loadBlocks(p.slug)) {
    for (const m of blockPlainText(block).match(PLACEHOLDER_RE) || []) {
      placeholders++;
      addQ(m.replace(/^\[\[\s*/, '').replace(/\s*\]\]$/, '').replace(/^нужн[оы]\s*(данные)?\s*:\s*/i, ''), place(p.slug, block.block_id), 'placeholder');
    }
  }
  for (const b of pr.blocks) for (const n of b.needs_fact) addQ(n, place(p.slug, b.block_id), 'writer');
  // судьи и слепой читатель - все круги (второй круг смотрит только правленые блоки и вопросы первого не повторяет)
  for (const f of pageFindings(ROOT, p.slug, { allRounds: true })) {
    if (f._file.endsWith('/cross.json') || !asksFact(f)) continue;
    addQ(factText(f), place(p.slug, f.block_id), f._producer);
    markDirect(p.slug, f);
  }
}
// кросс - с архивами: вопрос прежнего запуска не теряется, когда новый отчет кросса эту страницу не назвал. Ключ находки -
// страница, блок без номера, правило и цитата (нет цитаты - текст problem: его фиксер не меняет)
for (const f of crossLatest(f => [f.page, blockKey(f.block_id), f.rule, qKey(f.quote) || qKey(f.problem || f.proposal).slice(0, 80)].join('|'), f => !!f.page)) {
  if (!asksFact(f)) continue;
  addQ(factText(f), place(f.page, f.block_id), 'cross-judge');
  markDirect(f.page, f);
}
// retro-stats no_fact - отказы фиксеров «нет факта» по находкам без needs_fact (с needs_fact уже взяты выше)
for (const x of retro && retro.no_fact ? [...(retro.no_fact.rejected || []), ...(retro.no_fact.partial || [])] : []) {
  const b = blockKey(x.block), q = qKey(x.quote).slice(0, 60);
  if (direct.has(`${x.page}|${b}|${x.id}`) || (q && direct.has(`${x.page}|${b}|q:${q}`))) continue;
  addQ(x.missing, place(String(x.page || '').includes(':') ? '' : x.page, x.block), 'fixer');
}
// briefs-report: вопросы страниц (у каждого - блоки этой страницы), выпавшие блоки без своего вопроса; общий список
// questions - только для текстов, которых нет у страниц (сводный, без привязки блока к странице)
const pageQ = new Set();
for (const [slug, r] of Object.entries(br.pages || {})) {
  const asked = new Set();
  for (const q of Array.isArray(r && r.questions) ? r.questions : []) {
    pageQ.add(qKey(q.text));
    const blocks = Array.isArray(q.blocks) ? q.blocks : [];
    blocks.forEach(b => asked.add(b));
    if (!blocks.length) addQ(q.text, slug, 'briefs');
    for (const b of blocks) addQ(q.text, place(slug, b), 'briefs');
  }
  for (const d of Array.isArray(r && r.dropped) ? r.dropped : []) {
    const blk = typeof d === 'string' ? d : d.block;
    if (!asked.has(blk)) addQ(`нет фактов для блока «${blk}»${d.reason ? `: ${d.reason}` : ''}`, slug, 'briefs');
  }
}
for (const q of Array.isArray(br.questions) ? br.questions : []) {
  if (pageQ.has(qKey(q.text))) continue;
  const blocks = Array.isArray(q.blocks) ? q.blocks : [];
  const pages = Array.isArray(q.pages) ? q.pages : [];
  const wh = blocks.length && pages.length === 1 ? blocks.map(b => place(pages[0], b)) : pages;
  if (!wh.length) addQ(q.text, '', 'briefs');
  for (const w of wh) addQ(q.text, w, 'briefs');
}

// ---------------------------------------------------------------- сводка
const N = { pages: live.length, ready: 0, done: 0, blocked: 0, work: 0, nobrief: 0, closed: 0, pass: 0, total: 0, exhausted: 0 };
const open = { blocker: 0, major: 0, minor: 0 };
const exhaustedLines = [], nobrief = [];
for (const p of live) {
  const pr = prog[p.slug];
  if (!pr.briefed) { N.nobrief++; nobrief.push(p.slug); continue; }
  N.total += pr.blocks_total; N.pass += pr.passed; N.exhausted += pr.exhausted.length;
  if (pr.ready) N.ready++;
  if (pr.done) N.done++;
  if (pr.complete && pr.exhausted.length) N.blocked++;
  if (!pr.complete) N.work++;
  if (pr.closed_no_fix.length) N.closed++;
  for (const k of Object.keys(open)) open[k] += pr.open[k];
  for (const b of pr.blocks.filter(x => x.exhausted)) exhaustedLines.push(`- ${place(p.slug, b.block_id)}: не прошел линтер (попыток ${b.attempts}${b.lint ? `, lint ${b.lint}` : ', блок не записан'})${b.reasons.length ? `: ${clip(b.reasons.slice(0, 3).join('; '), 300)}` : ''}`);
}
// скелет в прототипе - любой блок брифа без lint pass (exhausted, не написан, сломан правкой)
const skeletons = N.total - N.pass;

// ---------------------------------------------------------------- правки без проверки судьей
// work/audit/<slug>/fix-diff.json (fix-diff.mjs): проход фиксера проверен, если потом появился круг судьи с большим номером,
// чем after_round (наибольший круг на момент прохода); иначе его правки видит только оператор
const unchecked = [];
let diffLogs = 0;
for (const p of live) {
  const log = rjs(P('work', 'audit', p.slug, 'fix-diff.json'));
  const runs = log && Array.isArray(log.runs) ? log.runs : [];
  if (!runs.length) continue;
  diffLogs++;
  const last = prog[p.slug].audit_last_round || 0;
  for (const r of runs) if (r && !(last > (Number(r.after_round) || 0))) unchecked.push({ slug: p.slug, r });
}
const uncheckedLines = [];
// noSnap - проходы без снимка: правки не сравнены вовсе; в итоге консоли они входят в число правок без проверки (по одной
// на проход), иначе самый опасный случай давал бы 0 и оркестратор не предупредил бы оператора
const U = { sentences: 0, blocks: new Set(), pages: new Set(), restored: 0, noSnap: 0 };
for (const { slug, r } of unchecked) {
  const who = `фиксер ${r.mode === 'narrow' ? 'в режиме сужения' : 'полный'}, после круга ${Number(r.after_round) || 0}`;
  if (r.no_snapshot) { uncheckedLines.push(`- ${slug}: правки фиксера не сравнены - снимка до правки не было (${who}); прочитать страницу`); U.pages.add(slug); U.noSnap++; continue; }
  const sent = Array.isArray(r.new_sentences) ? r.new_sentences : [];
  const byBlock = {};
  for (const s of sent) (byBlock[s.block] ??= []).push(s.text);
  for (const [b, list] of Object.entries(byBlock)) {
    uncheckedLines.push(`- ${place(slug, b)}: новые или измененные предложения (${list.length}): ${list.slice(0, 3).map(t => `«${clip(t, 160)}»`).join('; ')}${list.length > 3 ? ` и еще ${list.length - 3}` : ''} (${who})`);
    U.sentences += list.length; U.blocks.add(`${slug}/${b}`); U.pages.add(slug);
  }
  const quiet = (Array.isArray(r.blocks_changed) ? r.blocks_changed : []).filter(b => !byBlock[b]);
  if (quiet.length) { uncheckedLines.push(`- ${slug}: только удаления или перестановки: ${listMore(quiet, 8)} (${who})`); U.pages.add(slug); }
  for (const x of Array.isArray(r.restored) ? r.restored : []) {
    uncheckedLines.push(`- ${place(slug, x.block)}: откат правки фиксера (не прошла линтер: ${clip(x.rules, 120)}), находка снова открыта`);
    U.restored++;
  }
}
const hc = rjs(P('work', 'audit', 'html-check.json'));
const js = rjs(P('work', 'output', 'prototype.js-check.json'));
const jsLine = !js ? 'не запускалась'
  : js.verdict === 'skip' ? `SKIP (${js.skip_reason || js.reason || 'jsdom не найден'}): скрипты не проверены, нужен npm install в корне проекта`
    : `${js.verdict}${Array.isArray(js.errors) ? ` (ошибок ${js.errors.length})` : ''}`;
const structureChanged = Object.entries(br.pages || {}).filter(([, r]) => r && r.structure_changed).map(([s]) => s);
L.push('## Сводка');
L.push(`- Страниц в работе: ${N.pages}; готово ${N.ready}, написано ${N.done}, заблокировано (есть exhausted-блоки) ${N.blocked}, в работе ${N.work}, без брифа ${N.nobrief}`);
L.push(`- Волны: 1 - ${W[1].length} стр., 2 - ${W[2].length} стр.`);
L.push(`- Блоков прошли линтер: ${N.pass} из ${N.total}; скелетов в прототипе: ${skeletons} (exhausted ${N.exhausted}${skeletons > N.exhausted ? `, не написаны или не прошли линтер после правки ${skeletons - N.exhausted}` : ''})`);
if (noCompetitors || noCompTypes.length) L.push(`- Разбор лидеров: ${noCompetitors ? 'без конкурентов (сайты лидеров недоступны), ' : ''}типы собраны по анализу без снимков лидеров: ${noCompTypes.length ? listMore(noCompTypes, 10) : '-'}`);
if (unchecked.length) L.push(`- Правки фиксеров без проверки судьей: новых или измененных предложений ${U.sentences} в ${U.blocks.size} блоках, страниц ${U.pages.size}${U.noSnap ? `, проходов без сравнения ${U.noSnap}` : ''}${U.restored ? `, откатов ${U.restored}` : ''} (раздел «Правки без проверки судьей»)`);
L.push(`- Пометок «нужны данные» в текстах: ${placeholders}; вопросов заказчику: ${Q.size}`);
L.push(`- Открытых находок аудита (blocker/major/minor): ${open.blocker}/${open.major}/${open.minor}; страниц с major, закрытыми фиксером без правки: ${N.closed}`);
if (imp) L.push(`- Импорт: предупреждений ${(imp.warnings || []).length}, антиобещаний без регулярки ${((imp.anti && imp.anti.pending) || []).length}${((imp.anti && imp.anti.pending) || []).length ? ` (${listMore(imp.anti.pending, 6)})` : ''}`);
// --facts-only: в анализе изменилось не только факты (ЦА, пожелания, направления, конкуренты) - нужен повтор фазы 0
const otherChanged = imp && Array.isArray(imp.other_changed) ? imp.other_changed.filter(Boolean) : [];
if (otherChanged.length) L.push(`- В анализе изменилось кроме фактов (нужен повтор фазы 0 с --stop map): ${listMore(otherChanged.map(clean), 8)}`);
if (nobrief.length) L.push(`- Без брифа: ${listMore(nobrief, 12)}`);
if (structureChanged.length) L.push(`- Брифы не пересобраны, структура изменилась (нужен build-briefs --force): ${listMore(structureChanged, 12)}`);
// сверка проверок с текущим прототипом: proto-data-sha сборки против данных сейчас (build-html не перезапускали после правок),
// proto_sha и file_sha отчета check-site-js против файла (вердикт скриптов - о другой сборке)
const protoFile = P('work', 'output', 'prototype.html');
const protoStale = [];
if (exists(protoFile)) {
  const h = fs.readFileSync(protoFile, 'utf8');
  const metaSha = (h.match(/<meta name="proto-data-sha" content="([^"]*)"/) || [])[1] || '';
  let dataNow = '';
  try { dataNow = protoDataSha(); } catch { dataNow = ''; }
  if (metaSha && dataNow && metaSha !== dataNow) protoStale.push('данные изменились после сборки');
  const fileSha = crypto.createHash('sha1').update(h).digest('hex').slice(0, 16);
  if (js && js.verdict !== 'skip' && ((js.file_sha && js.file_sha !== fileSha) || (js.proto_sha && metaSha && js.proto_sha !== metaSha))) protoStale.push('check-site-js проверял другую сборку');
}
L.push(`- Прототип: ${hc ? `${hc.verdict} (${hc.summary})` : 'check-html не запускался'}; скрипты прототипа: ${jsLine}${protoStale.length ? `; устарело, пересобрать (${protoStale.join('; ')}): build-html, check-html, check-site-js` : ''}`);
const pub = rjs(P('work', 'catalog', 'publish.json'));
// publish.json публикатора (07-catalog-publisher): status published (url, format gdoc|docx, checks или checks_note) или
// skipped (reason, путь docx); старые файлы - url без status
function pubLine(p) {
  const skipped = p.status === 'skipped' || !!p.skipped;
  if (skipped) return `не опубликовано (${clean(p.reason || (typeof p.skipped === 'string' ? p.skipped : '') || 'причина не указана')})${p.docx ? `, файл ${clean(p.docx)}` : ''}`;
  const url = p.url || p.doc_url || '';
  if (!url) return `опубликовано без ссылки в publish.json${p.status ? ` (status ${clean(p.status)})` : ''} - проверить`;
  const checks = p.checks && typeof p.checks === 'object' ? Object.entries(p.checks).filter(([, v]) => v === false).map(([k]) => k) : null;
  const chk = p.checks === null || p.checks === undefined ? (p.checks_note ? `, сверка пропущена: ${clip(p.checks_note, 120)}` : '') : checks.length ? `, сверка не прошла: ${checks.join(', ')}` : ', сверка пройдена';
  return `${url}${p.format === 'docx' ? ' (docx без конверсии)' : ''}${chk}`;
}
if (pub) L.push(`- ТЗ на каталог: ${pubLine(pub)}`);
if (exhaustedLines.length) { L.push(''); L.push('### Блоки exhausted'); L.push(...exhaustedLines); }
L.push('');

// ---------------------------------------------------------------- что спросить
L.push('## Что спросить у заказчика');
if (!Q.size) L.push('- вопросов нет');
for (const q of Q.values()) L.push(`- ${q.text} (${q.places.size ? listMore([...q.places]) : 'весь сайт'})`);
L.push('');

// ---------------------------------------------------------------- не подтверждено
L.push('## Не подтверждено или снято');
const held = facts.filter(f => f.publish === 'no');
if (!held.length) L.push('- фактов publish: no нет');
for (const f of held) L.push(`- ${f.id} «${clean(f.label)}»: ${clip(f.value || f.wording, 160)}${f.note ? ` (${clip(f.note, 100)})` : ''}`);
if (techGaps.length) { L.push(''); L.push('### Технические пробелы (для оператора)'); techGaps.forEach(g => L.push(`- ${g}`)); }
// предупреждения импорта (поля, которых больше нет в анализе, неизвестный источник поля company, конфликты регулярок)
const impWarn = imp && Array.isArray(imp.warnings) ? imp.warnings.map(clean).filter(Boolean) : [];
if (impWarn.length) {
  L.push(''); L.push('### Предупреждения импорта (для оператора)');
  impWarn.slice(0, 20).forEach(w => L.push(`- ${clip(w, 240)}`));
  if (impWarn.length > 20) L.push(`- ... и еще ${impWarn.length - 20}`);
}
// факты оператора - готовыми строками листа ответов анализа (K11): «F8NN: <что> = <значение> << <фраза заказчика>» (анализ
// заведет факт fNN с moved_from, импорт текстов снимет F8NN), без номера F8NN - «+: ...». Метка без «=», в тексте без «<<»
const operator = facts.filter(f => /^F8\d\d$/.test(f.id || '') || /^\s*оператор\s*:/i.test(String(f.source || '')));
const k11 = s => clean(s).replace(/<</g, '«').replace(/>>/g, '»');
const k11Line = f => {
  const quote = k11(f.source_quote);
  return `${/^F8\d\d$/.test(f.id || '') ? f.id : '+'}: ${k11(f.label || f.id).replace(/=/g, '-')} = ${k11(f.value || f.wording)}${quote.length >= 10 ? ` << ${quote}` : ''}`;
};
if (operator.length) {
  L.push(''); L.push('### Факты оператора: перенести в анализ');
  L.push('Строки для листа ответов анализа: новый круг - новый файл answers-N.txt рядом с прежними, затем apply-answers и gate. Фразу после « << » анализ ищет во входе input/: письмо или сообщение заказчика с ней положить туда, иначе строка уйдет в «не разобрано» (нет такого документа - хвост « << ...» убрать).');
  L.push('```text');
  operator.forEach(f => L.push(k11Line(f)));
  L.push('```');
  operator.filter(f => f.source).forEach(f => L.push(`- ${f.id} «${clean(f.label)}»: ${clean(f.source)}`));
}
L.push('');

// ---------------------------------------------------------------- спорное
L.push('## Спорное: решения агента');
const disputed = [];
const decisionsFile = P('rules', 'decisions.md');
if (exists(decisionsFile)) {
  const lines = fs.readFileSync(decisionsFile, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/);
  // §8 ищется по заголовку «Спорное» и только в формате v2: у старых задач раздел 8 - другое
  if (lines.slice(0, 10).some(l => l.trim() === '<!-- decisions:v2 -->')) {
    const i = lines.findIndex(l => /^#{1,6}\s*(\d+\.?\s*)?Спорное/i.test(l.trim()));
    if (i >= 0) {
      const level = lines[i].trim().match(/^#+/)[0].length;
      for (let j = i + 1; j < lines.length; j++) {
        const h = lines[j].trim().match(/^(#+)\s/);
        if (h && h[1].length <= level) break;
        const l = lines[j].trim();
        if (/^\|/.test(l)) {
          const cells = l.replace(/^\|/, '').replace(/\|$/, '').split('|').map(x => x.trim());
          if (cells.every(c => !c || /^:?-{2,}:?$/.test(c)) || /^вопрос$/i.test(cells[0])) continue;
          disputed.push(`- decisions.md §8: ${cells.filter(Boolean).join(' | ')}`);
        } else if (/^[-*]\s+\S/.test(l)) disputed.push(`- decisions.md §8: ${l.replace(/^[-*]\s+/, '')}`);
      }
    }
  }
}
const review = rjs(P('work', 'audit', 'strategy-review.json'));
if (review && Array.isArray(review.findings)) {
  for (const f of review.findings) disputed.push(`- рецензия стратегии: [${f.severity || '-'}] ${f.page ? `${f.page}: ` : ''}${clip(f.problem, 200)}${f.proposal ? ` -> ${clip(f.proposal, 160)}` : ''}${f.status ? ` (${f.status})` : ''}`);
  if (!review.findings.length && review.summary) disputed.push(`- рецензия стратегии: ${clip(review.summary, 200)}`);
}
const spDir = P('work', 'strategy.pages');
for (const f of exists(spDir) ? fs.readdirSync(spDir).filter(x => x.endsWith('.json')).sort() : []) {
  const d = rjs(path.join(spDir, f));
  for (const x of Array.isArray(d && d.disputes) ? d.disputes : []) disputed.push(`- стратег типа ${path.basename(f, '.json')}: ${clean(x.question)} | ${clean(x.decision)} | ${clean(x.why)}`);
}
if (!disputed.length) L.push('- записей нет');
L.push(...disputed);
L.push('');

const warns = Array.isArray(br.warnings) ? br.warnings : [];
if (warns.length) {
  L.push('## Предупреждения сборки брифов');
  warns.slice(0, 40).forEach(w => L.push(`- ${clip(typeof w === 'string' ? w : [w.kind, w.page || w.slug, w.text || w.message].filter(Boolean).join(': '), 240)}`));
  if (warns.length > 40) L.push(`- ... и еще ${warns.length - 40}`);
  L.push('');
}

// ---------------------------------------------------------------- повторы
L.push('## Повторы между страницами');
const liveCross = rjs(P('work', 'audit', 'cross.json'));
const confirmed = crossLatest(f => [f.page, blockKey(f.block_id), f.rule, qKey(f.quote)].join('|'), isSerious);
const repLines = confirmed.map(f => `- ${place(f.page, f.block_id)}: ${f.rule || '-'} (${f.severity}) - ${f.status || 'open'}: ${clip(f.problem, 160)}`);
L.push(`- Подтверждено кросс-судьей (с архивами): ${repLines.length}`);
L.push(...repLines.slice(0, 40));
if (repLines.length > 40) L.push(`- ... и еще ${repLines.length - 40}`);
const outside = (liveCross && Array.isArray(liveCross.findings) ? liveCross.findings : []).filter(f => isSerious(f) && !f.needs_fact && isOpenStatus(f.status));
if (outside.length) L.push(`- Не исправлены (страница вне аудита или фиксер не дошел): ${outside.length} - ${listMore([...new Set(outside.map(f => f.page || '-'))], 12)}`);
const dd = rjs(P('work', 'audit', 'dedup.json'));
if (dd) {
  const byRule = {};
  for (const f of dd.findings || []) byRule[f.rule] = (byRule[f.rule] || 0) + 1;
  L.push(`- Правила dedup: ${Object.entries(byRule).map(([k, v]) => `${k} ${v}`).join(', ') || 'находок нет'}`);
  if (dd.pairs_summary) L.push(`- Кандидаты для кросс-судьи: ${dd.pairs_summary}`);
} else L.push('- dedup не запускался');
L.push('');

// ---------------------------------------------------------------- закрыто без правки
L.push('## Major, закрытые фиксером без правки');
const closedLines = live.flatMap(p => prog[p.slug].closed_no_fix.map(f => `- ${place(p.slug, f.block_id)}: ${f.rule || '-'} (${f.severity}, ${f.status}) - ${clip(f.problem, 140)}${f.resolution ? ` | ${clip(f.resolution, 140)}` : ''}`));
if (!closedLines.length) L.push('- нет');
L.push(...closedLines.slice(0, 60));
if (closedLines.length > 60) L.push(`- ... и еще ${closedLines.length - 60}`);
L.push('');

// ---------------------------------------------------------------- правки без проверки судьей
L.push('## Правки без проверки судьей');
if (!diffLogs) L.push('- сравнений правок фиксера нет (fix-diff.json: аудит до 28.09 или фиксер не запускался)');
else if (!uncheckedLines.length) L.push('- нет: каждую правку фиксера проверил следующий круг судьи');
else {
  L.push('Правки последних проходов фиксера (после них круга судьи не было) - прочитать перед сдачей:');
  L.push(...uncheckedLines.slice(0, 40));
  if (uncheckedLines.length > 40) L.push(`- ... и еще ${uncheckedLines.length - 40}`);
}
L.push('');

// ---------------------------------------------------------------- прототип
L.push('## Проверки прототипа');
if (!hc) L.push('- check-html: не запускался');
else {
  L.push(`- check-html: ${hc.verdict} (${hc.summary})${hc.scores && hc.scores.pages != null ? `, страниц ${hc.scores.pages}` : ''}`);
  (hc.findings || []).filter(isSerious).slice(0, 12).forEach(f => L.push(`  - [${f.severity}] ${f.rule} ${place(f.page, f.block_id)}: ${clip(f.problem, 140)}`));
}
L.push(`- check-site-js: ${jsLine}${js && js.verdict !== 'skip' ? `; маршрутов ${js.routes_checked ?? '-'}, нажатий ${js.clicks ?? '-'}` : ''}`);
if (js && Array.isArray(js.errors)) js.errors.slice(0, 12).forEach(e => L.push(`  - ${clean(e.route) || '-'} ${clean(e.kind)}: ${clip(e.detail || e.message, 160)}`));
L.push('');
L.push('## Интерфейс прототипа');
const modules = rjs(P('work', 'output', 'prototype.modules.json'));
if (!modules) L.push('- prototype.modules.json нет (прототип не собран или собран старым kit - пересобрать фазу 8)');
else for (const [k, m] of Object.entries(modules)) L.push(`- ${k}: ${m && m.on ? 'включен' : 'выключен'}${m && m.why ? ` - ${clip(m.why, 140)}` : ''}${m && m.source ? ` (${clip(m.source, 80)})` : ''}`);
const prefs = rjs(P('work', 'client-preferences.json'));
for (const x of prefs && Array.isArray(prefs.items) ? prefs.items : []) {
  if (String(x.where || '').split(/[,;]/).map(s => s.trim().toLowerCase()).includes('shell')) L.push(`- пожелание к шапке и подвалу: ${clip(x.text, 200)} (${x.status})`);
}
L.push('');

// ---------------------------------------------------------------- каталог
const listing = live.filter(p => p.listing);
const samples = rjs(P('work', 'catalog', 'sample-items.json'));
// аудит ТЗ (K12): находки последнего круга work/audit/catalog-tz.json по статусам (нет status - open); вопросы - пункты
// раздела «8.» work/catalog/tz.md (строки таблицы без шапки и пункты списка): они в документе ТЗ, заказчику отдельно не идут
const tzAudit = rjs(P('work', 'audit', 'catalog-tz.json'));
const tzOpen = { blocker: 0, major: 0, minor: 0 };
for (const f of tzAudit && Array.isArray(tzAudit.findings) ? tzAudit.findings : []) if (f && isOpenStatus(f.status) && tzOpen[f.severity] != null) tzOpen[f.severity]++;
function section8(text) {
  const lines = String(text).replace(/^\uFEFF/, '').split(/\r?\n/);
  const i = lines.findIndex(l => /^#{1,6}\s*8[.)]?\s/.test(l.trim()));
  if (i < 0) return null;
  const level = lines[i].trim().match(/^#+/)[0].length;
  let n = 0;
  const sep = l => /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/.test(l);
  for (let j = i + 1; j < lines.length; j++) {
    const l = lines[j].trim(), h = l.match(/^(#+)\s/);
    if (h && h[1].length <= level) break;
    if (/^\|/.test(l)) { if (!sep(l) && !sep((lines[j + 1] || '').trim())) n++; }
    else if (/^([-*+]|\d+[.)])\s+\S/.test(l)) n++;
  }
  return n;
}
const tzMd = P('work', 'catalog', 'tz.md');
const tzQuestions = exists(tzMd) ? section8(fs.readFileSync(tzMd, 'utf8')) : null;
if (listing.length || samples || pub || tzAudit || tzQuestions != null) {
  L.push('## Каталог');
  if (pub) L.push(`- ТЗ на каталог: ${pubLine(pub)}`);
  if (tzAudit) L.push(`- Аудит ТЗ${tzAudit.round ? ` (круг ${tzAudit.round})` : ''}: открыто blocker/major/minor ${tzOpen.blocker}/${tzOpen.major}/${tzOpen.minor}${tzOpen.blocker + tzOpen.major ? ' - ТЗ и прототип могут расходиться, сверить перед передачей разработчику' : ''}`);
  if (tzQuestions != null) L.push(`- Открытые вопросы ТЗ (раздел 8): ${tzQuestions} - они в документе ТЗ, в «Что спросить у заказчика» не копируются`);
  if (samples && Array.isArray(samples.items)) {
    const src = x => x.source || samples.mode || '-';
    const by = {};
    samples.items.forEach(x => { by[src(x)] = (by[src(x)] || 0) + 1; });
    L.push(`- Примеры товаров: ${Object.entries(by).map(([k, v]) => `${k} ${v}`).join(', ') || 'нет'}`);
    const own = new Set(samples.items.filter(x => /site|from_site/.test(src(x))).map(x => x.category_slug));
    const without = listing.filter(p => !own.has(p.slug)).map(p => p.slug);
    if (listing.length && without.length) L.push(`- Выдачи без своего примера с сайта (родитель, карточка «*» или шаблон): ${listMore(without, 12)}`);
  } else if (listing.length) L.push('- Примеров товаров нет: в выдачах карточки-шаблоны; нужны данные и фото товаров');
  L.push('');
}

// ---------------------------------------------------------------- по страницам
L.push('## По страницам');
L.push('| URL | тип | волна | статус | блоков pass | exhausted | аудит | пометок |');
L.push('|---|---|---|---|---|---|---|---|');
for (const p of live) {
  const pr = prog[p.slug];
  if (!pr.briefed) { L.push(`| ${p.url} | ${p.type} | ${W.of[p.slug]} | нет брифа | - | - | - | - |`); continue; }
  const ph = loadBlocks(p.slug).reduce((s, b) => s + (blockPlainText(b.block).match(PLACEHOLDER_RE) || []).length, 0);
  const audit = pr.audit_rounds ? `кругов ${pr.audit_rounds}, открыто ${pr.open.blocker}/${pr.open.major}/${pr.open.minor}${pr.audit_fresh ? '' : ', page.md изменился после аудита'}` : 'нет';
  L.push(`| ${p.url} | ${p.type} | ${W.of[p.slug]} | ${pr.status} | ${pr.passed}/${pr.blocks_total} | ${pr.exhausted.length || ''} | ${audit} | ${ph || ''} |`);
}
writeText(P('work', 'output', 'report.md'), L.join('\n') + '\n');
// итог сдачи (SKILL.md) берет числа из этой строки: блоки pass/total, скелеты, вопросы, правки без проверки судьей, каталог
const catalogNote = tzAudit || tzQuestions != null ? `; каталог: ТЗ открыто blocker/major ${tzOpen.blocker}/${tzOpen.major}, вопросов раздела 8 ${tzQuestions ?? '-'}` : '';
console.log(`отчет: work/output/report.md (страниц ${N.pages}, готово ${N.ready}, блоков ${N.pass}/${N.total}, скелетов ${skeletons}, exhausted ${N.exhausted}, пометок ${placeholders}, вопросов заказчику ${Q.size}, правок без проверки судьей ${U.sentences + U.noSnap}${catalogNote}; прототип: ${hc ? hc.verdict : 'не проверен'}, скрипты: ${js ? (js.verdict === 'skip' ? 'SKIP' : js.verdict) : 'не проверены'})`);
