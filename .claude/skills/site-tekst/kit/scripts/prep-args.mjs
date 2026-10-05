// Параметры для воркфлоу фаз 2-4: типы страниц из карты, число страниц по типу, снимки конкурентов.
// node scripts/prep-args.mjs [--types a,b] [--snapshots [--snapshot-types a,b] [--domains d1,d2]] [--small-max 2] [--solo home]
// node scripts/prep-args.mjs --check-degraded
// stdout - JSON-фрагмент для args воркфлоу: {"types":[...],"type_pages":{"<type>":N}[, "info_other":[...]][, "snapshots":[{domain,type,url,raw,status}]]}.
//   types - уникальные типы страниц карты (без status skip) в порядке первого появления; --types оставляет только эти типы.
//   type_pages - число страниц типа; по нему воркфлоу отделяют мелкие типы (<= small_type_max) и обрабатывают их пакетами.
//   info_other - названия (subject) страниц типа info_other карты без status skip и без ui_role (доставка, оплата,
//   гарантия и т.п., до 6); поле есть, только если такие страницы есть: wf-02 передает их классификатору, и он ищет у
//   конкурентов страницы того же назначения.
//   --snapshots - снимки конкурентов из work/competitors/competitors.json (конкурент status ok, страница ok/browser,
//   файл снимка есть на диске); фильтры --snapshot-types и --domains (без них - все); нужны для wf-02 с skipInventory.
// stderr - сводка: какие типы мелкие при пороге --small-max (по умолчанию 2) без --solo (по умолчанию home).
// --check-degraded - проверка деградации «без конкурентов» (wf-02, когда верификатор никого не оставил): stdout
//   {"degraded":"no_competitors"|null,"why":"..."}, код 0. Деградация подтверждается, только если верификатор отметил ее
//   в competitors.json и каждый кандидат (не агрегатор и не excluded) ответил, но недоступен: главная закрыта HTTP-кодом
//   400+, статус js_only или antibot и браузер пробовал (рядом след home.browser.md браузера агента или home.cdp.html
//   снятия CDP со страницей проверки), или браузерный снимок главной пуст
//   (status browser, текста меньше JS_ONLY_CHARS fetch-page). Браузерный снимок с текстом - сайт доступен. Кандидатов нет,
//   сайт не ответил (error, в том числе при сохраненной браузером странице ошибки), статус js_only или antibot без
//   браузерного снимка - это сбой среды или пустой вход: degraded null, фазу останавливают, --resume повторит.
import fs from 'node:fs';
import path from 'node:path';
import { argv, P, readJson, exists, loadSitemap } from './lib.mjs';
import { JS_ONLY_CHARS } from './fetch-page.mjs';

const a = argv({ snapshots: 'bool', 'check-degraded': 'bool', 'prune-stale': 'bool' });

// --prune-stale (wf-02 после верификатора): разборы блоков work/competitors/<домен>/ доменов, которых нет среди годных
// (status ok) в competitors.json, - в work/competitors/_stale/<домен>/ (остаются после пересбора отбора и попали бы в
// агрегатор). Снимки raw/ не трогаются (доказательная база; замер берет только годных). stdout {moved}, код 0.
if (a['prune-stale']) {
  const f = P('work', 'competitors', 'competitors.json');
  const kept = new Set(exists(f) ? (readJson(f).competitors || []).filter(c => c.status === 'ok').map(c => c.domain) : []);
  const moved = [];
  const base = P('work', 'competitors');
  if (kept.size && fs.existsSync(base)) for (const d of fs.readdirSync(base, { withFileTypes: true })) {
    if (!d.isDirectory() || ['raw', 'raw-pool', 'shots', 'kf', '_stale'].includes(d.name) || kept.has(d.name)) continue;
    const dir = path.join(base, d.name);
    if (!fs.readdirSync(dir).some(x => x.endsWith('.blocks.json'))) continue;
    const to = path.join(base, '_stale', d.name);
    fs.rmSync(to, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.renameSync(dir, to);
    moved.push(d.name);
  }
  console.log(JSON.stringify({ moved }));
  process.exit(0);
}

if (a['check-degraded']) {
  const done = why => { console.log(JSON.stringify({ degraded: why ? null : 'no_competitors', why: why || 'все кандидаты ответили, но недоступны' })); process.exit(0); };
  const f = P('work', 'competitors', 'competitors.json');
  if (!exists(f)) done('нет work/competitors/competitors.json');
  const comp = readJson(f);
  if (comp.degraded !== 'no_competitors') done('верификатор не отметил degraded: no_competitors');
  const cands = (comp.competitors || []).filter(c => c && c.domain && !['aggregator', 'excluded'].includes(c.status));
  if (!cands.length) done('кандидатов нет: список конкурентов пуст или только агрегаторы');
  const live = cands.find(c => c.status === 'ok');
  if (live) done(`конкурент ${live.domain} доступен (status ok)`);
  for (const c of cands) {
    const home = ((c.pages || []).find(p => p.type === 'home' && p.raw) || {}).raw || `work/competitors/raw/${c.domain}/home.json`;
    if (!exists(P(home))) done(`${c.domain}: нет снимка главной ${home} - запрос не прошел`);
    let s; try { s = readJson(P(home)); } catch { done(`${c.domain}: снимок главной не читается`); }
    if (s.status === 'closed' && s.http_status >= 400) continue;
    if (s.status === 'error') done(`${c.domain}: сайт не ответил (сеть) - похоже на сбой среды`);
    if (s.status === 'browser') {
      if ((Number(s.text_chars) || 0) < JS_ONLY_CHARS) continue;
      done(`${c.domain}: браузер снял главную с текстом (${s.text_chars} знаков) - сайт доступен, деградации нет`);
    }
    // след браузера: .browser.md (браузер агента) или .cdp.html (снятие CDP получило страницу проверки)
    if (['antibot', 'js_only'].includes(s.status) && ['.browser.md', '.cdp.html'].some(ext => exists(P(home.replace(/\.json$/, ext))))) continue;
    done(`${c.domain}: статус ${s.status || '?'} без браузерного снимка - похоже на сбой среды`);
  }
  done('');
}

const list = v => v ? String(v).split(',').map(s => s.trim()).filter(Boolean) : null;
const only = list(a.types);
const snapTypes = list(a['snapshot-types']);
const snapDomains = list(a.domains);
const sm = loadSitemap();
const typePages = {};
for (const p of sm.pages) {
  if (p.status === 'skip' || !p.type) continue;
  if (only && !only.includes(p.type)) continue;
  typePages[p.type] = (typePages[p.type] || 0) + 1;
}
if (only) for (const t of only) if (!(t in typePages)) { typePages[t] = 0; console.error(`тип ${t}: в карте нет страниц`); }
const out = { types: Object.keys(typePages), type_pages: typePages };
if (out.types.includes('info_other')) {
  const names = [...new Set(sm.pages.filter(p => p.type === 'info_other' && p.status !== 'skip' && !p.ui_role).map(p => String(p.subject || p.nav_label || '').trim()).filter(Boolean))].slice(0, 6);
  if (names.length) out.info_other = names;
}

if (a.snapshots) {
  const f = P('work', 'competitors', 'competitors.json');
  if (!exists(f)) { console.error('нет work/competitors/competitors.json'); process.exit(2); }
  out.snapshots = [];
  let missing = 0, retold = 0;
  for (const c of readJson(f).competitors || []) {
    if (c.status !== 'ok' || (snapDomains && !snapDomains.includes(c.domain))) continue;
    for (const pg of c.pages || []) {
      if (!['ok', 'browser'].includes(pg.status)) continue;
      if (snapTypes && !snapTypes.includes(pg.type)) continue;
      if (!pg.raw || !exists(P(pg.raw))) { missing++; console.error(`нет файла снимка: ${pg.raw || '(пусто)'} (${c.domain}, ${pg.type})`); continue; }
      // браузерный снимок без verbatim: true (у старых снимков поля нет) - пересказ: в замер не входит, цитат из него нет
      if (pg.status === 'browser') { try { if (readJson(P(pg.raw)).verbatim !== true) retold++; } catch { /* файл читает экстрактор */ } }
      out.snapshots.push({ domain: c.domain, type: pg.type, url: pg.url, raw: pg.raw.replace(/\\/g, '/'), status: pg.status });
    }
  }
  console.error(`снимков: ${out.snapshots.length}${missing ? `, без файла: ${missing}` : ''}${retold ? `; пересказов браузера (browser без verbatim: true): ${retold} - в замер не входят, цитат из них экстрактор не берет` : ''}`);
}

const smallMax = a['small-max'] == null ? 2 : Number(a['small-max']);
const solo = (a.solo == null ? 'home' : a.solo).split(',').map(s => s.trim()).filter(Boolean);
const small = out.types.filter(t => !solo.includes(t) && typePages[t] <= smallMax);
console.error(`типов: ${out.types.length}, страниц: ${Object.values(typePages).reduce((s, n) => s + n, 0)}; мелкие (<= ${smallMax}, кроме ${solo.join(', ') || '-'}): ${small.join(', ') || 'нет'}${out.info_other ? `; info_other для поиска у конкурентов: ${out.info_other.join('; ')}` : ''}`);
console.log(JSON.stringify(out, null, 2));
