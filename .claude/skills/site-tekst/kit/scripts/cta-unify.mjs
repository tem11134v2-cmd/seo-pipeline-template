// Одно действие - одна надпись (фаза 8, wf-08-site-audit; без LLM). Применяет решения аудитора прототипа
// work/audit/site.json -> cta_unify: [{action, role?, label, variants, why?}].
// node scripts/cta-unify.mjs [--dry-run]
// Правила:
// - label - только одна из variants и подпись, которая уже стоит на сайте у этого действия (cta_labels дайджеста); иначе
//   отказ и строка в отчет. action - по контракту C3 (lead, page:<slug>, anchor:<id>, messenger, call); старый формат CTA
//   (группа legacy) не трогается. Группа - действие и роль кнопки (main по умолчанию или secondary).
// - Страницы: кнопки этой роли с этим действием и подписью из variants, отличной от label (по site-digest.mjs), плюс
//   страницы того же типа, которые наследуют подпись от global (при правке global).
// - Правка по месту источника подписи: work/strategy.pages/<type>.json pages.<slug>.cta (или pages.<slug>.cta в
//   strategy.json, если файла типа нет), а у страницы без своей подписи - global.cta_by_type.<type> в strategy.json. Вместе
//   с main пишется разрешенный action (mergeCta иначе потерял бы его при смене подписи), short - из того же варианта (CTA
//   с той же подписью, где short задан) или убирается; у secondary - secondary_action. В файл типа - запись в disputes.
// - Затем: снимок брифов, срезов и блоков затронутых страниц, merge-strategy.mjs, build-briefs.mjs <slugs> без --force.
//   Отказ по странице (снимок возвращается, правка источника откатывается): structure_changed, problems в
//   briefs-report.json или бриф изменился не только в cta. Откат общего источника типа (global) - отказ всех страниц типа.
// - Иначе: в блоках страницы кнопки этой роли с подписью из variants получают label; lint-page.mjs <slug>; блок, получивший
//   blocker или major, возвращается к снимку, lint-page повторяется. page-state.mjs <slug>.
// Итог - в site.json: у решения status (applied | partial | refused), applied [{page, source, blocks, rolled_back}],
// refused [{page?, reason}], reason - строка отказов для отчета; шаг cta-unify в run.steps (ok - отработал, skip - решений нет). В отчет - «Правки без проверки судьей» (отдельный список).
// Последняя строка - CTA_UNIFY {json}. Код 0 (отказы - не ошибка); 2 - нет work/audit/site.json.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { argv, P, exists, readJson, writeJson, mergeCta } from './lib.mjs';
import { buildDigest, normLabel, ACTION_RE, LEGACY } from './site-digest.mjs';

const a = argv({ 'dry-run': 'bool' });
const SITE = P('work', 'audit', 'site.json');
const STRATEGY = P('work', 'strategy.json');
const TYPES_DIR = P('work', 'strategy.pages');
const REPORT = P('work', 'briefs-report.json');
const rel = f => path.relative(P(), f).split(path.sep).join('/');
const opt = f => { try { return exists(f) ? readJson(f) : null; } catch { return null; } };
const node = (...args) => spawnSync(process.execPath, args, { cwd: P(), encoding: 'utf8' });
const canon = v => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map(key => [key, x[key]])) : x));
const tail = s => String(s || '').trim().split(/\r?\n/).slice(-3).join(' | ').slice(0, 300);

// ---------- снимок файлов: путь -> содержимое (null - файла не было)
function snapshot(files) {
  const m = new Map();
  for (const f of files) m.set(f, exists(f) ? fs.readFileSync(f) : null);
  return m;
}
function restore(snap, filter = () => true) {
  for (const [f, buf] of snap) {
    if (!filter(f)) continue;
    if (buf === null) { fs.rmSync(f, { force: true }); continue; }
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, buf);
  }
}
const listDir = d => (exists(d) ? fs.readdirSync(d).filter(n => n.endsWith('.json')).map(n => path.join(d, n)) : []);
const pageFiles = slug => {
  const dir = P('work', 'pages', slug);
  return [path.join(dir, 'brief.json'), ...listDir(path.join(dir, 'brief')), ...listDir(path.join(dir, 'blocks'))];
};
// срезы, которых не было в снимке, при откате удаляются
function restorePage(snap, slug) {
  const dir = P('work', 'pages', slug);
  restore(snap, f => f.startsWith(dir + path.sep));
  for (const f of listDir(path.join(dir, 'brief'))) if (!snap.has(f)) fs.rmSync(f, { force: true });
}

if (!exists(SITE)) { console.error('нет work/audit/site.json - сначала аудитор прототипа'); process.exit(2); }
const site = readJson(SITE);
const items = Array.isArray(site.cta_unify) ? site.cta_unify : [];
const L = [];
const done = { applied: 0, refused: 0, pages: [] };

function record(status) {
  const run = site.run && typeof site.run === 'object' ? site.run : {};
  const steps = (Array.isArray(run.steps) ? run.steps : []).filter(s => s.name !== 'cta-unify');
  steps.push({ name: 'cta-unify', status });
  site.run = { steps, errors: Array.isArray(run.errors) ? run.errors : [] };
}

if (!items.length) {
  record('skip');
  if (!a['dry-run']) writeJson(SITE, site);
  console.log('cta-unify: решений о надписях нет');
  console.log(`CTA_UNIFY ${JSON.stringify(done)}`);
  process.exit(0);
}

const digest = await buildDigest();
const typeOf = Object.fromEntries(digest.routes.map(r => [r.slug, r.type]));
const routeOf = Object.fromEntries(digest.routes.map(r => [r.slug, r]));
const s = v => String(v ?? '').trim();
const ctaObj = x => (typeof x === 'string' ? { main: x } : x && typeof x === 'object' ? { ...x } : {});

for (const item of items) {
  delete item.status; delete item.applied; delete item.refused; delete item.reason;
  const role = item.role === 'secondary' ? 'secondary' : 'main';
  const field = role === 'main' ? 'main' : 'secondary';
  const actField = role === 'main' ? 'action' : 'secondary_action';
  const action = s(item.action);
  const label = s(item.label);
  const variants = (Array.isArray(item.variants) ? item.variants : []).map(normLabel).filter(Boolean);
  const refuseAll = reason => { item.status = 'refused'; item.refused = [{ reason }]; item.reason = reason; done.refused++; L.push(`отказ ${action || '-'} «${label}»: ${reason}`); };
  if (digest.cta_legacy || action === LEGACY) { refuseAll('старый формат CTA (группа legacy) - надписи не унифицируются'); continue; }
  if (!ACTION_RE.test(action)) { refuseAll(`действие «${action}» не по контракту C3`); continue; }
  if (!label || !variants.includes(normLabel(label))) { refuseAll('надпись не из вариантов'); continue; }
  const group = digest.cta_labels[action];
  if (!group || !group.labels.some(l => normLabel(l.label) === normLabel(label))) { refuseAll('надпись не встречается на сайте у этого действия'); continue; }
  const want = normLabel(label);
  const isVariant = t => { const n = normLabel(t); return variants.includes(n) && n !== want; };
  // страницы с кнопкой этой роли, этим действием и подписью-вариантом
  const targets = digest.routes.filter(r => r.buttons.some(b => b.role === role && b.action === action && isVariant(b.label))).map(r => r.slug);
  if (!targets.length) { item.status = 'applied'; item.applied = []; L.push(`${action} «${label}»: править нечего`); continue; }

  const strategy = readJson(STRATEGY);
  const glob = ((strategy.global ||= {}).cta_by_type ||= {});
  const typeFile = t => path.join(TYPES_DIR, `${t}.json`);
  const typeDocs = {};
  const typeDoc = t => (t in typeDocs ? typeDocs[t] : (typeDocs[t] = opt(typeFile(t))));
  // источник подписи страницы: запись файла типа, запись strategy.json или global типа
  const sourceOf = slug => {
    const t = typeOf[slug];
    const td = typeDoc(t);
    const e = td && td.pages && td.pages[slug];
    if (e && e.cta && typeof e.cta === 'object' && s(e.cta[field])) return { kind: 'type', type: t, slug, where: `strategy.pages/${t}.json pages.${slug}.cta` };
    if (!td || !e) {
      const se = (strategy.pages || {})[slug];
      if (se && se.cta && typeof se.cta === 'object' && s(se.cta[field])) return { kind: 'page', type: t, slug, where: `strategy.json pages.${slug}.cta` };
    }
    return { kind: 'global', type: t, slug, where: `strategy.json global.cta_by_type.${t}` };
  };
  const sources = targets.map(sourceOf);
  const globalTypes = [...new Set(sources.filter(x => x.kind === 'global').map(x => x.type))];
  // страницы, наследующие подпись от global правимого типа (своей подписи нет)
  const inherit = digest.routes.filter(r => globalTypes.includes(r.type) && r.brief && sourceOf(r.slug).kind === 'global').map(r => r.slug);
  const affected = [...new Set([...targets, ...inherit])];
  // short - из того же варианта: CTA с этой подписью, у которой short задан
  const allCtas = [...Object.values(glob), ...Object.values(strategy.pages || {}).map(e => e && e.cta)].map(ctaObj);
  for (const f of listDir(TYPES_DIR)) { const d = opt(f); for (const e of Object.values((d && d.pages) || {})) if (e && e.cta) allCtas.push(ctaObj(e.cta)); }
  const sameShort = (allCtas.find(c => normLabel(c.main) === want && s(c.short)) || {}).short || '';
  const edit = c => {
    const o = ctaObj(c);
    o[field] = label;
    o[actField] = action;
    if (role === 'main') { if (sameShort) o.short = sameShort; else delete o.short; }
    return o;
  };
  if (a['dry-run']) { item.status = 'applied'; item.applied = affected.map(slug => ({ page: slug, source: sourceOf(slug).where, blocks: [] })); L.push(`${action} «${label}» (проба): страниц ${affected.length}`); continue; }

  // снимок: стратегия, файлы типов, отчет брифов, карта, брифы, срезы и блоки затронутых страниц
  const snapFiles = [STRATEGY, REPORT, P('work', 'sitemap.json'), ...listDir(TYPES_DIR), ...affected.flatMap(pageFiles)];
  const snap = snapshot(snapFiles);
  const touchedTypes = new Set(), globalDone = new Set();
  for (const src of sources) {
    if (src.kind === 'type') { const td = typeDoc(src.type); td.pages[src.slug].cta = edit(td.pages[src.slug].cta); touchedTypes.add(src.type); }
    else if (src.kind === 'page') strategy.pages[src.slug].cta = edit(strategy.pages[src.slug].cta);
    else if (!globalDone.has(src.type)) { glob[src.type] = edit(glob[src.type]); globalDone.add(src.type); touchedTypes.add(src.type); }
  }
  // спор - в файл типа (стратеги типов и отчет читают disputes)
  for (const t of touchedTypes) {
    const td = typeDoc(t);
    if (!td) continue;
    (td.disputes ||= []).push({ question: `Одно действие ${action} - одна надпись (${role})`, decision: `«${label}»`, why: `аудит прототипа: варианты ${(item.variants || []).map(v => `«${v}»`).join(', ')}${item.why ? `; ${item.why}` : ''}`, pages: affected.filter(x => typeOf[x] === t) });
  }
  for (const [t, td] of Object.entries(typeDocs)) if (td && touchedTypes.has(t)) writeJson(typeFile(t), td);
  writeJson(STRATEGY, strategy);

  const merge = () => node(path.join('scripts', 'merge-strategy.mjs'));
  let m = merge();
  // проверка итога сборки стратегии: у целевых страниц подпись роли - label
  const effective = slug => {
    const st = opt(STRATEGY) || {};
    const g = ((st.global || {}).cta_by_type || {})[typeOf[slug]];
    return s(mergeCta(g, ((st.pages || {})[slug] || {}).cta).cta[field]);
  };
  if (m.status === 2 || m.error || !targets.every(slug => normLabel(effective(slug)) === want)) {
    restore(snap);
    refuseAll(`merge-strategy не собрал правку (код ${m.status}): ${tail(m.stdout || m.stderr)}`);
    continue;
  }
  const b = node(path.join('scripts', 'build-briefs.mjs'), ...affected);
  const report = opt(REPORT) || { pages: {} };
  const refused = [];
  for (const slug of affected) {
    const rec = (report.pages || {})[slug] || {};
    const oldBuf = snap.get(P('work', 'pages', slug, 'brief.json'));
    let oldBrief = null, newBrief = null;
    try { oldBrief = oldBuf ? JSON.parse(oldBuf.toString('utf8')) : null; } catch { oldBrief = null; }
    newBrief = opt(P('work', 'pages', slug, 'brief.json'));
    const strip = x => { if (!x) return x; const { cta, ...rest } = x; return rest; };
    if (rec.structure_changed) refused.push({ page: slug, reason: 'structure_changed: состав блоков брифа изменился' });
    else if (Array.isArray(rec.problems) && rec.problems.length) refused.push({ page: slug, reason: `problems: ${String(rec.problems[0]).slice(0, 160)}` });
    else if (b.status !== 0 && b.status !== 1) refused.push({ page: slug, reason: `build-briefs код ${b.status}: ${tail(b.stderr || b.stdout)}` });
    else if (!oldBrief || !newBrief || canon(strip(oldBrief)) !== canon(strip(newBrief))) refused.push({ page: slug, reason: 'бриф изменился не только в cta' });
  }
  // откат страниц: правка источника (global типа - для всех страниц типа, что его наследуют), бриф, срезы, блоки, запись
  // отчета брифов; lint-page и page-state - если страницу уже перелинтовали (lint-файлы и page.md - как до правки)
  const linted = new Set();
  const revert = list => {
    const back = new Set(list.map(r => r.page));
    const globalBack = new Set();
    for (const r of [...list]) { const src = sourceOf(r.page); if (src.kind === 'global') globalBack.add(src.type); }
    for (const slug of affected) {
      if (back.has(slug) || !globalBack.has(typeOf[slug]) || sourceOf(slug).kind !== 'global') continue;
      back.add(slug);
      list.push({ page: slug, reason: `общий источник типа ${typeOf[slug]} откачен из-за отказа другой страницы` });
    }
    const st2 = readJson(STRATEGY);
    const was = JSON.parse(snap.get(STRATEGY).toString('utf8'));
    for (const t of globalBack) { const w = ((was.global || {}).cta_by_type || {})[t]; if (w === undefined) delete st2.global.cta_by_type[t]; else st2.global.cta_by_type[t] = w; }
    for (const slug of back) {
      const src = sourceOf(slug);
      if (src.kind === 'page') st2.pages[slug] = (was.pages || {})[slug];
      if (src.kind === 'type') {
        const tf = typeFile(src.type);
        const cur = readJson(tf);
        cur.pages[slug] = JSON.parse(snap.get(tf).toString('utf8')).pages[slug];
        writeJson(tf, cur);
      }
    }
    writeJson(STRATEGY, st2);
    merge();
    const snapReport = snap.get(REPORT) ? JSON.parse(snap.get(REPORT).toString('utf8')) : null;
    const cur = opt(REPORT);
    for (const slug of back) {
      restorePage(snap, slug);
      if (cur && cur.pages) { if (snapReport && snapReport.pages && snapReport.pages[slug]) cur.pages[slug] = snapReport.pages[slug]; else delete cur.pages[slug]; }
      if (linted.has(slug)) { node(path.join('scripts', 'lint-page.mjs'), slug); node(path.join('scripts', 'page-state.mjs'), slug); }
    }
    if (cur) writeJson(REPORT, cur);
    return back;
  };
  const refusedSet = refused.length ? revert(refused) : new Set();
  // замена надписей в блоках принятых страниц, lint-page; блок, получивший blocker или major, - откат к снимку и повтор
  // lint-page; блок, который до правки проходил линтер, а после отката - нет (кнопка расходится с новым CTA брифа), -
  // откат всей страницы (иначе в прототипе на его месте был бы скелет)
  const lintOf = (slug, id) => { const r = opt(P('work', 'audit', slug, `lint-${id}.json`)); return r && typeof r.verdict === 'string' ? r : null; };
  const results = [];
  for (const slug of affected.filter(x => !refusedSet.has(x))) {
    const blocksDir = P('work', 'pages', slug, 'blocks');
    const before = {};
    const changed = [];
    for (const f of listDir(blocksDir)) {
      const blk = opt(f);
      if (!blk || !Array.isArray(blk.elements)) continue;
      const id = blk.block_id || path.basename(f, '.json');
      before[id] = (lintOf(slug, id) || {}).verdict || '';
      let n = 0;
      for (const el of blk.elements) {
        if (el.kind !== 'button' || !s(el.text)) continue;
        const btn = (routeOf[slug] ? routeOf[slug].buttons : []).find(x => x.block === id && normLabel(x.label) === normLabel(el.text));
        const elRole = btn ? btn.role : el.layout === 'secondary' ? 'secondary' : 'main';
        if (elRole !== role || !isVariant(el.text)) continue;
        if (btn && btn.action !== action && !inherit.includes(slug)) continue;
        el.text = label; n++;
      }
      if (n) { writeJson(f, blk); changed.push(id); }
    }
    const briefFile = P('work', 'pages', slug, 'brief.json');
    const briefChanged = !snap.get(briefFile) || !exists(briefFile) || !fs.readFileSync(briefFile).equals(snap.get(briefFile));
    const rolled = [];
    if (changed.length || briefChanged) {
      node(path.join('scripts', 'lint-page.mjs'), slug);
      linted.add(slug);
      for (const id of changed) {
        const lr = lintOf(slug, id);
        if (lr && !(lr.findings || []).some(x => x.severity === 'blocker' || x.severity === 'major')) continue;
        const bf = path.join(blocksDir, `${id}.json`);
        restore(snap, x => x === bf);
        rolled.push(id);
      }
      if (rolled.length) node(path.join('scripts', 'lint-page.mjs'), slug);
    }
    const broken = Object.keys(before).filter(id => before[id] === 'pass' && (lintOf(slug, id) || {}).verdict !== 'pass');
    if (broken.length) { results.push({ page: slug, broken }); continue; }
    node(path.join('scripts', 'page-state.mjs'), slug);
    results.push({ page: slug, source: sourceOf(slug).where, blocks: changed.filter(x => !rolled.includes(x)), ...(rolled.length ? { rolled_back: rolled } : {}) });
  }
  const brokenList = results.filter(r => r.broken).map(r => ({ page: r.page, reason: `после правки надписи блок не проходит линтер (${r.broken.join(', ')}) - страница откачена` }));
  const back2 = brokenList.length ? revert(brokenList) : new Set();
  refused.push(...brokenList);
  const applied = results.filter(r => !r.broken && !back2.has(r.page));
  done.pages.push(...applied.map(x => x.page));
  item.applied = applied;
  if (refused.length) { item.refused = refused; item.reason = refused.map(r => `${r.page}: ${r.reason}`).join("; ").slice(0, 300); }
  item.status = !applied.length ? 'refused' : refused.length ? 'partial' : 'applied';
  if (item.status === 'refused') done.refused++; else done.applied++;
  const appliedLine = applied.map(x => `${x.page}${x.blocks.length ? `: ${x.blocks.join(',')}` : ''}${x.rolled_back ? `, откат ${x.rolled_back.join(',')}` : ''}`).join('; ');
  L.push(`${action} «${label}» (${role}): ${item.status}; страниц ${applied.length}${applied.length ? ` (${appliedLine})` : ''}${refused.length ? `; отказ: ${refused.map(r => `${r.page} - ${r.reason}`).join('; ')}` : ''}`);
}

// шаг отработал - ok (отказы по решениям - в самих решениях, не сбой шага)
record('ok');
if (!a['dry-run']) writeJson(SITE, site);
done.pages = [...new Set(done.pages)];
console.log(`cta-unify: решений ${items.length}, применено ${done.applied}, отказ ${done.refused}${done.pages.length ? `; страницы: ${done.pages.join(', ')}` : ''}`);
L.slice(0, 25).forEach(l => console.log('  ' + l));
console.log(`CTA_UNIFY ${JSON.stringify(done)}`);
