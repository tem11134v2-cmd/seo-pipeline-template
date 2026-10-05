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
//            каждого вопроса страницы и блоки. Сырые строки сводятся без LLM: пометки писателей и фиксеров (не вопросы:
//            «удален», «не добавляем», lint, handoff_note, факт есть, но не в брифе) - подразделом «Пометки писателей (для
//            оператора)»; повторы сливаются по ссылке на открытый вопрос анализа (gN), по id факта и по похожему тексту
//            (вопросы анализа первыми, затем слитые по числу мест); все сырые строки и куда они ушли - в
//            work/output/report-questions.json;
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
//   Шапка, подвал и элементы лидеров (программа 05.10 §3.6; только если был этап КФ или есть shell/stubs) - оболочка
//            prototype.modules.json -> shell: чипы и заглушки brief.stubs - вопросы заказчику с основанием «есть у n из N
//            лидеров» (вопрос по заглушке заменяет вопрос о выпадении блока), declined - справка (reason off - «выключено
//            оператором»), page_missing -
//            рекомендации страниц; строка «Таблица КФ/КНДР» в сводке (build-kf-xlsx.mjs kfTableLine);
//   Аудит прототипа (work/audit/site.json, wf-08): сводка, исправлено, не исправлено и почему, единые надписи cta-unify
//            (затронутые блоки - и в «Правки без проверки судьей»), сбои шагов, skips шага site-audited в meta.json;
//            needs_fact аудитора - в вопросы с основанием «аудит прототипа»;
//   Каталог (ТЗ, примеры товаров, открытые находки аудита ТЗ по статусам work/audit/catalog-tz.json и число вопросов
//            раздела 8 work/catalog/tz.md - они в документе ТЗ, в вопросы заказчику не копируются); По страницам.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import { P, readJson, exists, writeText, writeJson, loadConfig, loadSitemap, loadBlocks, blockPlainText, PLACEHOLDER_RE, nowIso, cyr } from './lib.mjs';
import { pageProgress, pageFindings, waves, isOpenStatus, isSerious, isCrossArchive, archiveStamp, blockKey, ARCHIVE_PREFIX } from './progress.mjs';
import { protoDataSha } from './render-blocks.mjs';
import { kfStage, kfTableLine, zoneRu, stateRu, scopeType, elName } from './build-kf-xlsx.mjs';

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
// basis - основание вопроса («есть у 4 из 5 лидеров», «аудит прототипа»): печатается после мест
function addQ(text, where, src, basis = '') {
  const t = clean(text).replace(/[\s;,:]+$/, '');
  const k = qKey(t);
  if (!k) return;
  let q = Q.get(k);
  if (!q) Q.set(k, q = { text: t, places: new Set(), src: new Set(), basis: new Set() });
  if (where) q.places.add(where);
  if (basis) q.basis.add(basis);
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
// заглушки элементов лидеров (brief.stubs, программа 05.10 §3.4): вопрос по заглушке заменяет вопрос о выпадении блока
// (у одного блока страницы - один вопрос), поэтому выпадение и вопросы briefs-report по типам-заглушкам пропускаются
const stubsOf = new Map();
for (const p of live) {
  const st = prog[p.slug].briefed ? (briefOf(p.slug) || {}).stubs : null;
  if (Array.isArray(st) && st.length) stubsOf.set(p.slug, st.filter(s => s && s.type));
}
const isStub = (slug, blk) => (stubsOf.get(slug) || []).some(s => s.type === blk);
// briefs-report: вопросы страниц (у каждого - блоки этой страницы), выпавшие блоки без своего вопроса; общий список
// questions - только для текстов, которых нет у страниц (сводный, без привязки блока к странице)
const pageQ = new Set();
for (const [slug, r] of Object.entries(br.pages || {})) {
  const asked = new Set();
  for (const q of Array.isArray(r && r.questions) ? r.questions : []) {
    pageQ.add(qKey(q.text));
    const all = Array.isArray(q.blocks) ? q.blocks : [];
    const blocks = all.filter(b => !isStub(slug, b));
    all.forEach(b => asked.add(b));
    if (!all.length) addQ(q.text, slug, 'briefs');
    for (const b of blocks) addQ(q.text, place(slug, b), 'briefs');
  }
  for (const d of Array.isArray(r && r.dropped) ? r.dropped : []) {
    const blk = typeof d === 'string' ? d : d.block;
    if (!asked.has(blk) && !isStub(slug, blk)) addQ(`нет фактов для блока «${blk}»${d.reason ? `: ${d.reason}` : ''}`, slug, 'briefs');
  }
}
for (const q of Array.isArray(br.questions) ? br.questions : []) {
  if (pageQ.has(qKey(q.text))) continue;
  const blocks = Array.isArray(q.blocks) ? q.blocks : [];
  const pages = Array.isArray(q.pages) ? q.pages : [];
  if (blocks.length && pages.length && pages.every(pg => blocks.every(b => isStub(pg, b)))) continue;
  const wh = blocks.length && pages.length === 1 ? blocks.filter(b => !isStub(pages[0], b)).map(b => place(pages[0], b)) : pages;
  if (!wh.length) addQ(q.text, '', 'briefs');
  for (const w of wh) addQ(q.text, w, 'briefs');
}

// ---------------------------------------------------------------- элементы лидеров (КФ/КНДР) и аудит прототипа
// Оболочка - prototype.modules.json -> shell.items (state shown|chip|function|page_missing|declined, пишет build-html по
// work/shell.json); подсказки «что нужно» - work/shell.json; охват заглушек - work/kf/matrix.json (строка типа страницы),
// иначе kf_coverage типа. Чип и заглушка - вопрос заказчику с основанием «есть у n из N лидеров»; declined - справка без
// вопроса; page_missing - рекомендация страницы. Без новых файлов раздела нет (старые задачи - отчет как раньше).
const modules = rjs(P('work', 'output', 'prototype.modules.json'));
const kf = kfStage();
const kfLine = kfTableLine();
const shellItems = modules && modules.shell && Array.isArray(modules.shell.items) ? modules.shell.items.filter(x => x && x.id) : [];
const shellSpec = rjs(P('work', 'shell.json'));
const specOf = id => (shellSpec && Array.isArray(shellSpec.items) ? shellSpec.items : []).find(x => x.id === id) || {};
const cov = s => { const m = String(s || '').match(/^(\d+)\/(\d+)$/); return m ? { n: +m[1], N: +m[2] } : null; };
const leaders = c => (c ? `есть у ${c.n} из ${c.N} лидеров` : 'есть у лидеров');
// слоты без поля company (рейтинг, оплата, города, элементы ниши): ответ войдет на сайт фактом со slot
const FACT_SLOT = new Set(['rating', 'payment_icons', 'city', 'generic', '']);
const byId = (list, pick) => {
  const m = new Map();
  for (const it of list) {
    const e = m.get(it.id) || { id: it.id, name: elName(it.name || it.id), zones: [], c: null };
    if (!e.zones.includes(it.zone)) e.zones.push(it.zone);
    const c = cov(it.coverage);
    if (c && (!e.c || c.n > e.c.n)) e.c = c;
    m.set(it.id, e);
  }
  return [...m.values()].map(pick || (x => x));
};
// поля проекта из needs (shell.json, brief.stubs) - простыми словами; технические имена в документ заказчику не идут:
// подсказка из needs - только если все поля есть в карте, иначе вопрос по имени элемента
const NEED_RU = {
  'company.phones': 'телефон для сайта', 'company.email': 'электронная почта', 'company.address': 'адрес',
  'company.hours': 'часы работы', 'company.channels': 'ссылки на мессенджеры и соцсети', 'company.legal_name': 'полное наименование юрлица',
  'company.inn': 'ИНН', 'company.ogrn': 'ОГРН', 'company.brand': 'название компании', 'site.tagline': 'короткое описание деятельности',
};
const FIELD_RE = /^[a-z_]+(\.[a-z0-9_+]+)+$/i;
function needsText(list) {
  const xs = (Array.isArray(list) ? list : []).map(clean).filter(Boolean);
  if (!xs.length) return '';
  if (xs.some(x => FIELD_RE.test(x) && !NEED_RU[x])) return '';
  return [...new Set(xs.map(x => NEED_RU[x] || x))].join(', ');
}
const kfChips = byId(shellItems.filter(x => x.state === 'chip'));
for (const e of kfChips) {
  const sp = specOf(e.id);
  const hint = clean(sp.needs_hint) || needsText(sp.needs);
  const viaFact = FACT_SLOT.has(String(sp.render || ''));
  e.text = `Нужны данные для элемента «${e.name}»${hint ? `: ${hint}` : ''}${viaFact ? ' (ответ войдет на сайт подтвержденным фактом)' : ''}`;
  for (const z of e.zones) addQ(e.text, zoneRu(z), 'shell', leaders(e.c));
}
// охват строки типа: матрица (сильнейшая строка id в scope типа), иначе n из kf_coverage типа
const ptCache = new Map();
function stubCoverage(type, el) {
  let best = null;
  for (const r of kf.matrix ? kf.matrix.rows : []) {
    if (!r || r.id !== el || r.scope === 'site' || scopeType(r.scope).type !== type) continue;
    if (!best || (Number(r.n) || 0) > best.n) best = { n: Number(r.n) || 0, N: Number(r.N) || 0 };
  }
  if (best) return best;
  if (!ptCache.has(type)) ptCache.set(type, rjs(P('work', 'page-types', `${type}.json`)));
  const c = ((ptCache.get(type) || {}).kf_coverage || []).find(x => x && x.el === el);
  const N = kf.matrix && Number(kf.matrix.target);
  return c && Number.isFinite(Number(c.n)) && N ? { n: Number(c.n), N } : null;
}
const kfStubs = [];
for (const [slug, list] of stubsOf) {
  const type = (live.find(p => p.slug === slug) || {}).type;
  for (const s of list) {
    const needs = needsText(s.needs);
    const c = stubCoverage(type, s.kf_el);
    const text = `Нужны данные для блока «${clean(s.name || s.type)}»${needs ? `: ${needs}` : ''}`;
    kfStubs.push({ slug, s, c, text });
    addQ(text, place(slug, s.type), 'stub', leaders(c));
  }
}
// declined с reason "off" - модуль выключен оператором (site.off) при наличии данных: справка, не решение заказчика
const isOff = x => x.state === 'declined' && x.reason === 'off';
const kfDeclined = byId(shellItems.filter(x => x.state === 'declined' && !isOff(x)));
const kfOperatorOff = byId(shellItems.filter(isOff));
const kfPagesMissing = byId(shellItems.filter(x => x.state === 'page_missing'));
const kfFunctions = byId(shellItems.filter(x => x.state === 'function'));
const kfOff = (Array.isArray(br.warnings) ? br.warnings : []).map(w => clean(typeof w === 'string' ? w : w.text || w.message)).filter(w => /элемент лидеров снят стратегом/.test(w));
// аудит прототипа (wf-08): work/audit/site.json; сбой wf-08 целиком - skips шага site-audited в meta.json задачи
const site = rjs(P('work', 'audit', 'site.json'));
const siteFindings = site && Array.isArray(site.findings) ? site.findings.filter(f => f && typeof f === 'object') : [];
const metaTask = rjs(P('meta.json'));
const siteSkips = (metaTask && Array.isArray(metaTask.skips) ? metaTask.skips : []).filter(x => x && x.step === 'site-audited').map(x => clean(x.reason)).filter(Boolean);
for (const f of siteFindings) if (asksFact(f)) addQ(factText(f), f.page ? place(f.page, f.block_id) : zoneRu(f.zone), 'site-auditor', 'аудит прототипа');
// cta-unify: массив надписей [{action, label, variants, applied?}] или объект {items|labels, applied}
const cu = site ? site.cta_unify : null;
const cuItems = Array.isArray(cu) ? cu : cu && typeof cu === 'object' ? (Array.isArray(cu.items) ? cu.items : Array.isArray(cu.labels) ? cu.labels : []) : [];
const appliedOf = list => (Array.isArray(list) ? list : []).flatMap(a => {
  if (typeof a === 'string') return [a];
  if (!a || typeof a !== 'object') return [];
  const pg = a.page || a.slug || '';
  const bl = Array.isArray(a.blocks) ? a.blocks : a.block ? [a.block] : [];
  return bl.length ? bl.map(b => place(pg, b)) : pg ? [pg] : [];
});
const cuApplied = [...new Set([...cuItems.flatMap(x => appliedOf(x && x.applied)), ...(cu && !Array.isArray(cu) ? appliedOf(cu.applied) : [])])];

// ---------------------------------------------------------------- вопросы: пометки писателей и слияние повторов
// Сырые строки Q (точный повтор текста слит в addQ) -> вопросы заказчику и пометки для оператора. Без LLM; лучше не слить,
// чем слить разное. Скобки при разборе не читаются: в них пометки писателя к вопросу («F26 снят на гейте», «в do_not_say»).
const lowQ = s => clean(s).toLowerCase().replace(/\u0451/g, 'е');
// скобки снимаются изнутри наружу; хвост без закрывающей (обрезка clip) - тоже скобка; keep - оставить текст скобки
function unparen(s, keep = () => false) {
  let t = s, prev;
  do { prev = t; t = t.replace(/\(([^()]*)\)/g, (_, p) => (keep(p) ? ` ${p} ` : ' ')); } while (t !== prev);
  return t.replace(/\(([^()]*)$/, (_, p) => (keep(p) ? ` ${p} ` : ' ')).replace(/\s+/g, ' ').trim();
}
// поручение судьи «Текст не трогать. Запросить у заказчика факт: X; после факта ...» - вопрос X; у вопроса снимаются хвосты
// писателя «- нет факта (...)» и «- запросить у заказчика»
const askOf = s => { const m = clean(s).match(/запросить\s+у\s+заказчика(?:\s+факт)?\s*:\s*(.+)/i); return m ? m[1].split(/(?<=[;.])\s+/)[0].replace(/[;.]+$/, '') : clean(s); };
const tidyQ = s => s.replace(/(?:\s*[-:,]\s*|\s+)нет\s+факта(?:\s+F\d{2,3})?(?:\s*\([^()]*\))?\s*\.?$/i, '').replace(/\s*[-,]\s*запросить\s+у\s+заказчика(?![а-я]).*$/i, '').replace(/[\s;,:]+$/, '') || s;
// Пометка - строка писателя, судьи или фиксера, которая ни о чем не спрашивает: одни id; id факта в начале строки (механика
// брифа); отчет о своей правке («удален», «текст не меняли», «не добавляем», «ждет подтверждения»); служебное (lint,
// handoff_note, §, decisions, срез брифа); правка-поручение («Добавить, что ...»); «для страницы ... нет факта»; «нет факта
// Fxx» при факте с publish yes (факт есть, но не в брифе страницы - это стратегу). gaps, unknowns, [[нужно]], briefs-report,
// сайты-ориентиры, чипы и заглушки КФ - всегда вопросы.
const ALWAYS_ASK = new Set(['gaps', 'competitors', 'unknowns', 'placeholder', 'briefs', 'shell', 'stub']);
const NOTE_RE = [
  /^[\s,;.и]*(?:[fagjb]\d+[a-z]?(?:-[a-z0-9-]+)?[\s,;.и]*)+$/i,
  /^f\d/i,
  cyr('\\b(?:удален|убран|очищен|заменен|перенесен|сохранен|оставлен|разгружен|добавлен|записан)[аоы]?\\b|\\b(?:ушел|ушла|ушло)\\b'),
  cyr('\\bне\\s+(?:добавля|называ|обеща|публику|объясня|меня|трога|пиш|став)'),
  cyr('\\bжд(?:ет|ут)\\s+(?:подтвержд|ответ)'),
  /(?<![a-z])(?:lint|decisions)(?![a-z])|fact\.unknown|[a-z]+_[a-z]+|judge-r\d|§\s*\d/i,
  cyr('\\bсрез[а-я]*\\s+брифа|\\bнет\\s+в\\s+брифе|\\bбриф\\s+правит'),
  cyr('^(?:добавить|убрать|удалить|заменить|переписать|перенести|сократить|оставить|снять)\\b'),
  cyr('\\bдля\\s+(?:этой\\s+)?страниц[а-я]*\\s+[^,.;]*нет\\s+факта'),
];
const pubYes = new Set(facts.filter(f => f.publish === 'yes').map(f => lowQ(f.id)));
const isNote = q => ![...q.src].some(s => ALWAYS_ASK.has(s)) && (NOTE_RE.some(re => re.test(q.core)) || [...q.core.matchAll(/нет\s+(?:факта\s+)?(f\d+)/g)].some(m => pubYes.has(m[1])));
// основы слов: служебные слова, id, номера и механика (do_not_say, task) - мимо; окончание снимается по списку
const STOP_Q = new Set(('и или а но в во на по с со к ко у о об от до из за для при без над под про через после ли же бы не ни нет да ' +
  'что чем где когда как какой какая какое какие каких каким кто сколько можно нужно нужна нужен нужны есть это этот эта эти ' +
  'его ее их она он они оно все весь вся так также только уже еще тоже будет быть был была были вы вас вам ваш ваша ваши мы нас наш ' +
  'свой свои своих том числе сейчас тогда если ру запросить спросить уточнить снят снята сняты гейте task lint blocker fact unknown the and').split(' '));
const STOP_STEM = new Set(['страниц', 'блок', 'факт', 'бриф', 'заказчик', 'сайт', 'вопрос', 'запрос', 'гейт']);
const ENDS = ['иями', 'ями', 'ами', 'остью', 'ости', 'ость', 'ениям', 'ениях', 'ению', 'ения', 'ение', 'ений', 'ого', 'его', 'ому', 'ему', 'ыми', 'ими',
  'ых', 'их', 'ой', 'ей', 'ий', 'ый', 'ая', 'яя', 'ое', 'ее', 'ые', 'ие', 'ую', 'юю', 'ом', 'ем', 'ам', 'ям', 'ах', 'ях', 'ов', 'ев', 'ия', 'ию', 'ья', 'ье', 'ьи',
  'а', 'я', 'ы', 'и', 'у', 'ю', 'е', 'о', 'ь'];
const stemOf = w => { const e = /[а-я]/.test(w) && ENDS.find(x => w.endsWith(x) && w.length - x.length >= 3); return e ? w.slice(0, -e.length) : w; };
// скобки с пометкой писателя (id, do_not_say, «снят», бриф, факт) в основы не идут, перечни в скобках («металл, размер») идут
const TECH_PAREN = /[a-z]+_[a-z]+|[fagjb]\d|снят|бриф|факт|task|lint/i;
function stemsOf(s) {
  const t = unparen(lowQ(s), p => !TECH_PAREN.test(p)).replace(/(?<![a-z0-9])b\d{2}[a-z]?(?:-[a-z0-9-]+)?/g, ' ').replace(/[a-z]+(?:_[a-z]+)+/g, ' ');
  const out = new Set();
  for (const w of t.split(/[^a-zа-я0-9]+/)) {
    if (w.length < 3 || STOP_Q.has(w) || /^[fagjb]?\d+$/.test(w)) continue;
    const st = stemOf(w);
    if (!STOP_STEM.has(st)) out.add(st);
  }
  return out;
}
// грань вопроса: цена, срок, оплата, адрес, размер, гарантия. Строки, у которых грани есть, но общих нет, не сливаются
// («цена доставки» и «срок доставки» - разные вопросы), в одной группе таких пар нет
const FACETS = [['price', /^(?:цен|стоим|стоит|стоя|прайс|платн|бесплатн|доплат|дорог|дешев)/], ['time', /^(?:срок|врем|недел|дн[еийя]|ждат|долг)/],
  ['pay', /^(?:оплат|оплач|предоплат|рассрочк)/], ['addr', /^(?:адрес|метро)/], ['size', /^размер/], ['warranty', /^гарант/]];
const isFacet = w => FACETS.some(([, re]) => re.test(w));
const facetsOf = st => new Set(FACETS.filter(([, re]) => [...st].some(w => re.test(w))).map(([k]) => k));
const clash = (a, b) => a.fc.size > 0 && b.fc.size > 0 && ![...a.fc].some(k => b.fc.has(k));
// похожий текст: общих основ не меньше 2, среди них редкая (не больше чем в 10% строк, но не меньше 5 строк) и не только
// грани (одна «цена» - не повод); у обеих строк есть свои основы - общих основ предмета (без граней) не меньше 2: «сколько
// стоит доставка заказа» и «сколько стоит изделие на заказ» - разные вопросы. Дальше - Jaccard >= 0.5, или короткая строка
// (от 3 основ) в длинной на 75% с двумя редкими (целиком - с одной), или 3 редкие общие и половина короткой. Двух основ
// короткой строки мало для вложения («срок изготовления» есть и в вопросе о работах для витрины). Возврат - число общих
// основ (0 - не похожи)
function alike(a, b) {
  if (clash(a, b)) return 0;
  const inter = [...a.st].filter(s => b.st.has(s)), r = inter.filter(rareQ).length, subj = inter.filter(s => !isFacet(s)).length;
  const small = Math.min(a.st.size, b.st.size), union = a.st.size + b.st.size - inter.length, part = inter.length / small;
  if (inter.length < 2 || !r || !subj || (inter.length < small && subj < 2)) return 0;
  return inter.length / union >= 0.5 || (small >= 3 && (part === 1 || (part >= 0.75 && r >= 2))) || (r >= 3 && part >= 0.5) ? inter.length : 0;
}
// строки об одном факте: общий id факта (или gN без строки анализа) и хотя бы одна общая основа
const sameFact = (a, b) => !clash(a, b) && [...a.ids].some(x => b.ids.has(x)) && [...a.st].some(s => b.st.has(s));
const ANALYSIS_ID = /^(?:открытый вопрос анализа|журнал гейта) \(([gj]\d+)\):/;
const REF_RE = /(?<![\p{L}\d_])([gj]\d{1,3})(?![\p{L}\d_])/gu;
const FACT_RE = /(?<![\p{L}\d_])(F\d{2,3})(?![\p{L}\d_])/gu;
const rawQ = [...Q.values()].map((q, i) => { const ask = askOf(q.text); return { ...q, i, ask, core: unparen(lowQ(ask)) }; });
const qNotes = rawQ.filter(isNote);
const qItems = rawQ.filter(q => !qNotes.includes(q)).map(q => {
  const st = stemsOf(q.ask);
  const aid = q.src.has('gaps') ? (q.text.match(ANALYSIS_ID) || [])[1] || '' : '';
  const refs = new Set([...q.ask.matchAll(REF_RE)].map(m => m[1]).filter(x => x !== aid));
  const ids = new Set([...[...q.ask.matchAll(FACT_RE)].map(m => m[1].toLowerCase()), ...refs]);
  return { ...q, st, fc: facetsOf(st), aid, refs, ids, anchor: q.src.has('gaps'), frozen: q.src.has('shell') || q.src.has('stub') };
});
// якоря - строки gaps (вопросы анализа): строка с одной ссылкой gN (jN) идет в строку анализа с этим id, строка без ссылок -
// в самый похожий якорь; чипы и заглушки КФ не сливаются (своя формулировка и основание)
const anchors = qItems.filter(x => x.anchor);
const loose = qItems.filter(x => !x.anchor && !x.frozen);
const dfQ = {};
for (const x of [...anchors, ...loose]) for (const s of x.st) dfQ[s] = (dfQ[s] || 0) + 1;
const rareMax = Math.max(5, Math.ceil(0.1 * (anchors.length + loose.length)));
function rareQ(s) { return (dfQ[s] || 0) <= rareMax; }
const byAid = new Map(anchors.filter(a => a.aid).map(a => [a.aid, a]));
for (const x of loose) {
  if (x.refs.size === 1 && byAid.has([...x.refs][0])) { x.to = byAid.get([...x.refs][0]); continue; }
  if (x.refs.size) continue;
  let n = 0;
  for (const a of anchors) { const k = alike(x, a); if (k > n) { n = k; x.to = a; } }
}
// прочие - одиночное связывание по похожему тексту или общему факту; группа без пар с разными гранями
const rest = loose.filter(x => !x.to);
rest.forEach(x => { x.grp = [x]; });
for (let i = 0; i < rest.length; i++) for (let j = i + 1; j < rest.length; j++) {
  const a = rest[i], b = rest[j];
  if (a.grp === b.grp || !(alike(a, b) || sameFact(a, b)) || a.grp.some(m => b.grp.some(o => clash(m, o)))) continue;
  const g = [...a.grp, ...b.grp].sort((x, y) => x.i - y.i);
  g.forEach(m => { m.grp = g; });
}
// формулировка группы: строка анализа, иначе строка без ссылок на другие вопросы анализа (gN - сборная строка), самая
// типичная и полная - больше общих основ со строками группы, меньше id, скобок и механики; при равенстве длиннее, раньше
const techOf = x => (x.ask.match(/[FAgjB]\d+|[a-z]+_[a-z]+|\(/g) || []).length;
const repScore = (x, g) => g.reduce((n, m) => n + [...x.st].filter(s => m.st.has(s)).length, 0) - techOf(x);
const pickRep = g => g.find(x => x.anchor) || [...g].sort((x, y) => (x.refs.size > 0) - (y.refs.size > 0) || repScore(y, g) - repScore(x, g) || y.ask.length - x.ask.length || x.i - y.i)[0];
const asks = [...anchors.map(a => [a, ...loose.filter(x => x.to === a)]), ...new Set(rest.map(x => x.grp)), ...qItems.filter(x => x.frozen).map(x => [x])].map(g => {
  const rep = pickRep(g);
  const places = [...new Set(g.flatMap(m => [...m.places]))];
  return {
    text: rep.anchor || rep.frozen ? rep.text : tidyQ(rep.ask), rep, members: g, site: rep.anchor, first: Math.min(...g.map(m => m.i)),
    // страница без блока лишняя, если у той же страницы в группе есть блок
    places: places.filter(p => p.includes('/') || !places.some(o => o.startsWith(`${p}/`))),
    basis: [...new Set(g.flatMap(m => [...m.basis]))],
  };
});
// порядок: вопросы анализа - как в анализе, затем слитые по числу мест, затем остальные в порядке сбора
const askRank = q => (q.site ? 0 : q.members.length > 1 ? 1 : 2);
asks.sort((a, b) => askRank(a) - askRank(b) || (askRank(a) === 1 ? b.places.length - a.places.length : 0) || a.first - b.first);
const qMerged = Q.size - qNotes.length - asks.length;

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
if (cuApplied.length) L.push(`- Единые надписи кнопок без проверки судьей (аудит прототипа, cta-unify): блоков ${cuApplied.length} (раздел «Правки без проверки судьей»)`);
// вопросов заказчику - после слияния повторов; сколько сырых строк слито и сколько ушло в пометки для оператора
const qFold = qMerged || qNotes.length ? ` (строк было ${Q.size}: слито повторов ${qMerged}, пометок писателей для оператора ${qNotes.length})` : '';
L.push(`- Пометок «нужны данные» в текстах: ${placeholders}; вопросов заказчику: ${asks.length}${qFold}`);
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
if (kfLine) L.push(`- Таблица КФ/КНДР: ${kfLine}`);
if (exhaustedLines.length) { L.push(''); L.push('### Блоки exhausted'); L.push(...exhaustedLines); }
L.push('');

// ---------------------------------------------------------------- что спросить
L.push('## Что спросить у заказчика');
if (!asks.length) L.push('- вопросов нет');
// вопрос анализа - на весь сайт, места слитых строк - блоки, которые ждут ответа (шаг 2 SKILL.md)
const whereQ = q => (q.site ? `весь сайт${q.places.length ? `; ждут ответа: ${listMore(q.places, 12)}` : ''}` : q.places.length ? listMore(q.places, 12) : 'весь сайт');
for (const q of asks) L.push(`- ${q.text} (${whereQ(q)}${q.basis.length ? `; основание: ${q.basis.join(', ')}` : ''})`);
if (qNotes.length) {
  L.push('');
  L.push('### Пометки писателей (для оператора)');
  L.push('Не вопросы заказчику: что писатели, судьи и фиксеры сделали без факта или чего нет в брифе страницы. Нужное - в бриф или в вопросы; все сырые строки и куда слиты повторы - work/output/report-questions.json.');
  for (const n of qNotes) L.push(`- ${n.text} (${n.places.size ? listMore([...n.places], 12) : 'весь сайт'})`);
}
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
// единая надпись одного действия (cta-unify, аудит прототипа): замена текста кнопок скриптом, судья ее не видел
if (cuApplied.length) {
  L.push('');
  L.push('### Единые надписи кнопок (аудит прототипа, cta-unify)');
  for (const x of cuItems.filter(x => x && appliedOf(x.applied).length)) L.push(`- ${clean(x.action) || '-'}: «${clean(x.label)}» - ${listMore(appliedOf(x.applied), 12)}`);
  const listed = new Set(cuItems.flatMap(x => appliedOf(x && x.applied)));
  const rest = cuApplied.filter(x => !listed.has(x));
  if (rest.length) L.push(`- затронуто: ${listMore(rest, 12)}`);
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
if (!modules) L.push('- prototype.modules.json нет (прототип не собран или собран старым kit - пересобрать фазу 8)');
else for (const [k, m] of Object.entries(modules)) L.push(`- ${k}: ${m && m.on ? 'включен' : 'выключен'}${m && m.why ? ` - ${clip(m.why, 140)}` : ''}${m && m.source ? ` (${clip(m.source, 80)})` : ''}`);
const prefs = rjs(P('work', 'client-preferences.json'));
for (const x of prefs && Array.isArray(prefs.items) ? prefs.items : []) {
  if (String(x.where || '').split(/[,;]/).map(s => s.trim().toLowerCase()).includes('shell')) L.push(`- пожелание к шапке и подвалу: ${clip(x.text, 200)} (${x.status})`);
}
L.push('');

// ---------------------------------------------------------------- элементы лидеров
if (kf.matrix || kf.statusFile || shellItems.length || kfStubs.length || kfOff.length) {
  L.push('## Шапка, подвал и элементы лидеров');
  if (!kf.matrix) L.push(`- Анализ КФ не проводился: ${kf.reason}`);
  if (shellItems.length) {
    const n = s => shellItems.filter(x => x.state === s).length;
    L.push(`- Оболочка по пересечениям лидеров: элементов ${shellItems.length} (показаны ${n('shown')}, нужны данные ${n('chip')}, функции ${n('function')}, нужна страница ${n('page_missing')}, решение заказчика ${n('declined') - shellItems.filter(isOff).length}${shellItems.some(isOff) ? `, выключено оператором ${shellItems.filter(isOff).length}` : ''})`);
  } else if (kf.matrix) L.push(`- Оболочка по пересечениям лидеров: ${modules ? 'в прототипе ее нет (прототип собран без work/shell.json)' : 'прототип не собран'}`);
  const zl = e => e.zones.map(zoneRu).join(', ');
  if (kfChips.length) L.push(`- Нужны данные (вопросы заказчику): ${kfChips.map(e => `«${e.name}» (${zl(e)}, ${leaders(e.c)})`).join('; ')}`);
  if (kfStubs.length) L.push(`- Заглушки блоков, нужны данные (вопросы заказчику): ${kfStubs.map(x => `${place(x.slug, x.s.type)} «${clean(x.s.name || x.s.type)}» (${leaders(x.c)})`).join('; ')}`);
  if (kfDeclined.length) L.push(`- Не показываем по решению заказчика: ${kfDeclined.map(e => `«${e.name}» (${zl(e)})`).join('; ')}`);
  if (kfOperatorOff.length) L.push(`- Выключено оператором (справка, без вопроса заказчику): ${kfOperatorOff.map(e => `«${e.name}» (${zl(e)})`).join('; ')}`);
  if (kfPagesMissing.length) {
    L.push('- Рекомендуем страницы (в карте их нет, в прототипе - кнопка «страница вне прототипа»):');
    kfPagesMissing.forEach(e => L.push(`  - «${e.name}» (${zl(e)}): ${leaders(e.c)}`));
  }
  if (kfFunctions.length) L.push(`- Функции интерфейса (кнопки; без своей страницы - «функция вне прототипа»): ${kfFunctions.map(e => `«${e.name}»`).join(', ')}`);
  kfOff.slice(0, 20).forEach(w => L.push(`- ${clip(w, 240)}`));
  L.push('');
}

// ---------------------------------------------------------------- аудит прототипа
if (site || siteSkips.length) {
  L.push('## Аудит прототипа');
  siteSkips.forEach(s => L.push(`- ${clip(s, 240)}`));
  if (site) {
    const sev = { blocker: 0, major: 0, minor: 0 };
    siteFindings.forEach(f => { if (sev[f.severity] != null) sev[f.severity]++; });
    L.push(`- Аудитор: ${site.verdict || '-'}${site.summary ? ` (${clip(site.summary, 200)})` : ''}; находок ${siteFindings.length} (blocker/major/minor ${sev.blocker}/${sev.major}/${sev.minor})`);
    const where = f => (f.page ? place(f.page, f.block_id) : f.zone ? zoneRu(f.zone) : 'весь сайт');
    const head = f => `[${f.severity || '-'}] ${where(f)}: ${clip(f.problem, 160)}`;
    const fixed = siteFindings.filter(f => f.status === 'fixed');
    const left = siteFindings.filter(f => f.status !== 'fixed');
    const why = f => {
      if (f.needs_fact) return 'нужен факт - вопрос заказчику';
      if (!f.page || f.zone) return 'оболочка или весь сайт - только в отчет';
      if (clean(f.resolution)) return clip(f.resolution, 160);
      return isOpenStatus(f.status) ? 'фиксер не правил (за пределом страниц или не дошел)' : clean(f.status);
    };
    if (fixed.length) { L.push('### Исправлено'); fixed.slice(0, 25).forEach(f => L.push(`- ${head(f)}${f.resolution ? ` -> ${clip(f.resolution, 140)}` : ''}`)); }
    if (left.length) { L.push('### Не исправлено'); left.slice(0, 25).forEach(f => L.push(`- ${head(f)} - ${why(f)}`)); }
    if (cuItems.length) {
      L.push('### Единые надписи кнопок');
      for (const x of cuItems.filter(Boolean)) {
        const vars = (Array.isArray(x.variants) ? x.variants : []).map(v => `«${clean(typeof v === 'string' ? v : v && (v.label || v.text))}»`);
        const ap = appliedOf(x.applied);
        // partial: заменено на части страниц - и замены, и причина отказа по остальным
        const why = clean(typeof x.refused === 'string' ? x.refused : '') || clean(x.reason);
        L.push(`- ${clean(x.action) || '-'}: «${clean(x.label)}»${vars.length ? ` из ${vars.join(', ')}` : ''}${ap.length ? `; заменено: ${listMore(ap, 8)}` : ''}${why || x.refused ? `; не применено${ap.length ? ' на остальных' : ''}: ${clip(why || 'причина не указана', 140)}` : ''}`);
      }
    }
    const run = site.run && typeof site.run === 'object' ? site.run : {};
    const badSteps = (Array.isArray(run.steps) ? run.steps : []).filter(s => s && !/^(ok|done|pass|skip|skipped)$/i.test(String(s.status || '')));
    const errs = (Array.isArray(run.errors) ? run.errors : []).map(e => clean(typeof e === 'string' ? e : e && (e.message || e.step))).filter(Boolean);
    if (badSteps.length || errs.length) {
      L.push('### Сбои шагов');
      badSteps.forEach(s => L.push(`- ${clean(s.name) || '-'}: ${clean(s.status) || 'сбой'}${s.reason ? ` (${clip(s.reason, 140)})` : ''}`));
      errs.slice(0, 12).forEach(e => L.push(`- ${clip(e, 200)}`));
    }
  }
  L.push('');
}

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
// все сырые строки раздела «Что спросить у заказчика»: вопрос, его места и слитые в него строки; пометки писателей
const srcList = m => [...m.src];
writeJson(P('work', 'output', 'report-questions.json'), {
  generated_at: nowIso(), raw: Q.size, merged: qMerged,
  questions: asks.map(q => ({
    text: q.text, ...(q.text !== q.rep.text ? { text_raw: q.rep.text } : {}), places: q.places, basis: q.basis, sources: [...new Set(q.members.flatMap(srcList))],
    merged: q.members.filter(m => m !== q.rep).map(m => ({ text: m.text, places: [...m.places], sources: srcList(m) })),
  })),
  notes: qNotes.map(n => ({ text: n.text, places: [...n.places], sources: srcList(n) })),
});
// итог сдачи (SKILL.md) берет числа из этой строки: блоки pass/total, скелеты, вопросы (после слияния повторов; в скобках
// слито и пометки писателей), правки без проверки судьей, каталог, таблица КФ/КНДР (только если этап КФ был: есть
// work/kf/matrix.json или status.json)
const catalogNote = tzAudit || tzQuestions != null ? `; каталог: ТЗ открыто blocker/major ${tzOpen.blocker}/${tzOpen.major}, вопросов раздела 8 ${tzQuestions ?? '-'}` : '';
const qNote = qMerged || qNotes.length ? ` [слито повторов ${qMerged}, пометок писателей ${qNotes.length}]` : '';
console.log(`отчет: work/output/report.md (страниц ${N.pages}, готово ${N.ready}, блоков ${N.pass}/${N.total}, скелетов ${skeletons}, exhausted ${N.exhausted}, пометок ${placeholders}, вопросов заказчику ${asks.length}${qNote}, правок без проверки судьей ${U.sentences + U.noSnap + cuApplied.length}${catalogNote}; прототип: ${hc ? hc.verdict : 'не проверен'}, скрипты: ${js ? (js.verdict === 'skip' ? 'SKIP' : js.verdict) : 'не проверены'}${kfLine ? `; таблица КФ/КНДР: ${kfLine}` : ''})`);
