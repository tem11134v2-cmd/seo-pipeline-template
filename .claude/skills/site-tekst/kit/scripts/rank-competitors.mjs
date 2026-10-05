// Отбор лидеров фазы 2: запросы выдачи, длинный список кандидатов (pool.json) и ранжирование (ranking.json).
// Запуск из корня папки задачи текстов. Параметры - config/project.json -> competitors.selection (умолчания ниже).
//
// node scripts/rank-competitors.mjs --queries
//   stdout - {queries, region, own, target, serp_depth}: запросы выдачи ниши детерминированно - sources.key_phrases, затем
//   маркеры (key_phrase/marker) страниц hub, category, service карты по уровню и порядку, затем их subject; без product,
//   шаблонов и status skip; без дублей; до serp_queries_max. Пустой список - код 0, queries: [].
// node scripts/rank-competitors.mjs --merge-pool <raw.json>
//   Сливает часть, собранную скаутом по одному источнику, в work/competitors/pool.json и проверяет его схемой kf-pool.
//   raw: {source: analysis|serp|serp_msk|structure|keyso|data|keyso_batch|history|iks|whois, results?: [{query, urls: []}],
//   queries?: [], candidates?: [{domain, sources?, name?, keyso?, keyso_status?, history?, iks?, created?, notes?}],
//   rejected?: [{raw, reason}], errors?: [""], method?: ""}. Домены - канон scripts/domains.mjs (punycode и кириллица,
//   www сводятся); домены клиента - в own, не в кандидаты; source data (и keyso_batch, history, iks, whois) только
//   дописывает метрики уже известным кандидатам. Выдача: позиции считает скрипт по results (глубина serp_depth); домен
//   выдачи становится кандидатом при попадании в ТОП-10 не меньше чем по ceil(serp_share_min x запросов) запросам;
//   serp (top1/3/5/10, queries, share) пересчитывается у всех кандидатов и доменов клиента (own). Затравка seed.json
//   и конкуренты структуры (structure-competitors.json) добавляются сами. Ошибки «<источник>: ...» прошлых вызовов этого источника снимаются;
//   слияние без ошибок (и с пустым candidates) отмечает источник в sources_done.
//   Входы изменились (input_sha) - pool начинается заново. stdout - сводка {candidates, eligible, visible, need_msk, errors}.
//   Код 1 - raw не читается или итог не прошел схему (pool не записан).
// node scripts/rank-competitors.mjs --prelim
//   stdout - {keyso: [домены юникодом для domains_batch: Keys.so еще не спрашивали или была ошибка], own, history: [до history_max по предварительному весу],
//   lookup: [домены для ИКС и whois, в конце домены клиента], competitors_from: домен для domain_competitors}. Вес без
//   возраста и роста. own - домены клиента для того же вызова domains_batch (метрики - в pool.own, не в кандидаты).
// node scripts/rank-competitors.mjs [--now YYYY-MM-DD]
//   Ранжирование -> work/competitors/ranking.json (схема kf-ranking): чистая функция pool.json и параметров.
// node scripts/rank-competitors.mjs --check
//   stdout - {status: fresh|stale, reason, failed_sources, sources_done, candidates, eligible}, код 0. fresh - pool проходит
//   схему, input_sha совпадает, errors пуст и годных (без стопа) не меньше target; годных меньше, но пройдены все
//   источники кандидатов (exhaustSources: serp, serp_msk при регионе не 213, keyso_batch, keyso) - fresh, exhausted: true.
//   Запросов нет (--queries пуст) - serp и serp_msk считаются пройденными, их ошибки не в счет; в ответе no_queries: true.
// Общие флаги: --pool <файл> (work/competitors/pool.json), --out <файл> (work/competitors/ranking.json).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { argv, P, readJson, writeJson, exists, nowIso, normalizeText, validate } from './lib.mjs';
import { normDomain, domainUnicode, sameOrSub, isSub } from './domains.mjs';
import { parseRegion } from './regions.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const T = s => (typeof s === 'string' ? normalizeText(s) : typeof s === 'number' ? String(s) : '');
const arr = x => (Array.isArray(x) ? x : []);
const num = x => {
  if (typeof x === 'number') return Number.isFinite(x) ? x : null;
  if (typeof x === 'string' && x.trim()) { const n = Number(x.replace(/[\s\u00a0]/g, '').replace(',', '.')); return Number.isFinite(n) ? n : null; }
  return null;
};
const canon = v => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map(key => [key, x[key]])) : x));
const sha = s => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
const r1 = x => Math.round(x * 10) / 10;
const r2 = x => Math.round(x * 100) / 100;

export const SOURCES = ['analysis', 'serp', 'serp_msk', 'structure', 'keyso'];
const DATA_SOURCES = ['data', 'keyso_batch', 'history', 'iks', 'whois'];
const ERROR_KEYS = [...SOURCES, ...DATA_SOURCES, 'competitors'];
const KEYSO_METRICS = ['top10', 'top50', 'ratio', 'traffic'];
export const DEFAULTS = {
  target: 5, serp_queries_max: 15, serp_depth: 10, serp_share_min: 0.1, keyso_batch_max: 40, history_max: 8,
  weights: { share: 3, top10: 1, top50: 1, ratio: 0.5, traffic: 1, iks: 1 }, ratio_min_top50: 50, coverage_min: 0.5,
  young_years: 7, old_years: 12, young_bonus: 0.15, growth_bonus: 0.05, growth_threshold: 0.2,
  site_type_bonus: 0.15, site_type_penalty: 0.15,
};
export function paramsOf(cfg) {
  const sel = (cfg && cfg.competitors && cfg.competitors.selection) || {};
  const out = { ...DEFAULTS, weights: { ...DEFAULTS.weights } };
  for (const [k, v] of Object.entries(sel)) {
    if (k.startsWith('_')) continue;
    if (k === 'weights' && v && typeof v === 'object') { for (const [m, w] of Object.entries(v)) if (num(w) != null) out.weights[m] = num(w); }
    else if (num(v) != null) out[k] = num(v);
  }
  return out;
}

// ---------------------------------------------------------------- входы задачи
const readSafe = f => { try { return exists(f) ? readJson(f) : null; } catch { return null; } };
const lowKey = s => T(s).toLowerCase().replace(/\s+/g, ' ');

export function computeQueries(cfg, sitemap, max = DEFAULTS.serp_queries_max) {
  const out = [], seen = new Set();
  const add = q => { const t = T(q); const k = lowKey(t); if (t.length >= 2 && !seen.has(k)) { seen.add(k); out.push(t); } };
  arr(cfg && cfg.sources && cfg.sources.key_phrases).forEach(add);
  const pages = arr(sitemap && sitemap.pages).map((p, i) => ({ p, i }))
    .filter(({ p }) => p && ['hub', 'category', 'service'].includes(p.type) && p.status !== 'skip' && !p.template)
    .sort((a, b) => (Number(a.p.level) || 0) - (Number(b.p.level) || 0) || a.i - b.i);
  pages.forEach(({ p }) => add(p.key_phrase || p.marker || ''));
  pages.forEach(({ p }) => add(p.subject || ''));
  return out.slice(0, Math.max(0, max));
}

export function regionOf(cfg) {
  const n = (cfg && cfg.niche) || {};
  const text = T(n.geo) || 'Москва';
  const rg = parseRegion(text);
  if (num(n.yandex_id) != null) rg.yandex_id = num(n.yandex_id);
  if (T(n.keyso_base)) rg.keyso_base = T(n.keyso_base);
  return { ...rg, text };
}

export function ownDomainsOf(cfg) {
  return [...new Set([cfg && cfg.site_url, ...arr(cfg && cfg.competitors && cfg.competitors.own_domains)].map(normDomain).filter(Boolean))];
}

function siteKindOf(cfg, sitemap) {
  const k = T(cfg && cfg.niche && cfg.niche.site_kind);
  if (k) return k;
  const pj = T(cfg && cfg.sources && cfg.sources.project_json);
  if (pj) { const p = readSafe(path.resolve(pj)); const sk = T(p && p.business && p.business.site_kind); if (sk) return sk; }
  const live = arr(sitemap && sitemap.pages).filter(p => p && p.status !== 'skip');
  if (live.length === 1 && live[0].type === 'home') return 'landing';
  return '';
}

export function loadStoplist() {
  const list = [], warn = [];
  for (const f of [P('config', 'kf-stoplist.json'), path.join(HERE, '..', 'config', 'kf-stoplist.json')]) {
    const s = readSafe(f);
    if (s) { for (const x of arr(s.domains)) { const d = normDomain(typeof x === 'string' ? x : x && x.domain); if (d) list.push({ domain: d, kind: T(x && x.kind) || 'stop' }); } return { list, warn }; }
  }
  warn.push('нет config/kf-stoplist.json - стоп-лист только проектный');
  return { list, warn };
}

function structureOf() {
  const s = readSafe(P('work', 'competitors', 'structure-competitors.json'));
  if (!s) return null;
  return { direct: arr(s.direct), indirect: arr(s.indirect), excluded: arr(s.excluded), stop_list: arr(s.stop_list) };
}

export function taskContext() {
  const cfg = readSafe(P('config', 'project.json')) || {};
  const sitemap = readSafe(P('work', 'sitemap.json'));
  const params = paramsOf(cfg);
  const stop = loadStoplist();
  const proj = arr(cfg.competitors && cfg.competitors.aggregators_stoplist).map(normDomain).filter(Boolean).map(d => ({ domain: d, kind: 'project' }));
  const seed = readSafe(P('work', 'competitors', 'seed.json'));
  const structure = structureOf();
  const queries = computeQueries(cfg, sitemap, params.serp_queries_max);
  const region = regionOf(cfg);
  const own = ownDomainsOf(cfg);
  const seedCore = seed ? { domains: arr(seed.domains).map(d => normDomain(d && d.domain)).filter(Boolean).sort(), rejected: arr(seed.rejected).map(T) } : null;
  let analysisSha = '';
  if (!seed) {
    const af = P(T(cfg.sources && cfg.sources.analysis_dump) || 'inputs/analysis.md');
    try { analysisSha = exists(af) ? sha(fs.readFileSync(af, 'utf8')) : ''; } catch { analysisSha = ''; }
  }
  const input_sha = sha(canon({ queries, region: { keyso_base: region.keyso_base, yandex_id: region.yandex_id }, seed: seedCore, analysis: analysisSha, structure, own }));
  return { cfg, sitemap, params, stoplist: [...stop.list, ...proj], warnings: stop.warn, seed, structure, queries, region, own, input_sha, siteKind: siteKindOf(cfg, sitemap) };
}

// ---------------------------------------------------------------- pool: слияние
const emptyCand = (domain) => ({ domain, domain_unicode: domainUnicode(domain), sources: [], serp: null, keyso: null, keyso_status: 'none', history: null, iks: null, created: null });
function keysoOf(x) {
  if (!x || typeof x !== 'object') return null;
  const out = {};
  for (const k of ['top10', 'top50', 'traffic', 'pages', 'top1', 'top3', 'top5', 'dr']) { const v = num(x[k]); if (v != null) out[k] = v; }
  if (out.traffic == null && num(x.traffic_month) != null) out.traffic = num(x.traffic_month);
  if (out.pages == null && num(x.pages_keyso) != null) out.pages = num(x.pages_keyso);
  return Object.keys(out).length ? out : null;
}
function historyOf(x) {
  if (!x || typeof x !== 'object') return null;
  const now = num(x.it50_now), m12 = num(x.it50_12m);
  return now == null && m12 == null ? null : { it50_now: now, it50_12m: m12 };
}
export function dateOf(s) {
  const t = T(String(s ?? ''));
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = t.match(/^(\d{2})\.(\d{2})\.(\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return null;
}
function serpStats(results, depth) {
  const by = {};
  const qs = arr(results).filter(r => r && arr(r.urls).length);
  for (const r of qs) {
    const seen = new Set();
    arr(r.urls).slice(0, depth).forEach((u, i) => {
      const d = normDomain(u);
      if (!d || seen.has(d)) return;
      seen.add(d);
      const s = (by[d] ??= { top1: 0, top3: 0, top5: 0, top10: 0 });
      const pos = i + 1;
      if (pos <= 1) s.top1++;
      if (pos <= 3) s.top3++;
      if (pos <= 5) s.top5++;
      if (pos <= 10) s.top10++;
    });
  }
  return { by, n: qs.length };
}
const compactResults = (results, depth) => arr(results).filter(r => r && T(r.query)).map(r => ({ query: T(r.query), domains: arr(r.urls).slice(0, depth).map(normDomain).map(d => d || '-') }));

export function mergePool(pool, raw, ctx) {
  const notes = [];
  const p = pool;
  const src = T(raw && raw.source);
  if (![...SOURCES, ...DATA_SOURCES].includes(src)) throw new Error(`raw.source «${src}» не из списка: ${[...SOURCES, ...DATA_SOURCES].join(', ')}`);
  const isData = DATA_SOURCES.includes(src);
  const depth = ctx.params.serp_depth || 10;
  const byDomain = Object.fromEntries(p.candidates.map(c => [c.domain, c]));
  const ownOf = d => ctx.own.find(o => sameOrSub(d, o));
  const ownEntry = d => { let o = p.own.find(x => x.domain === d); if (!o) { o = { domain: d, domain_unicode: domainUnicode(d) }; p.own.push(o); } return o; };
  const reject = (rawStr, reason) => { if (!p.rejected.find(x => x.raw === rawStr && x.reason === reason)) p.rejected.push({ raw: rawStr, reason }); };
  const touch = (d, sources, allowNew) => {
    if (ownOf(d)) return ownEntry(d);
    let c = byDomain[d];
    if (!c) { if (!allowNew) return null; c = emptyCand(d); p.candidates.push(c); byDomain[d] = c; }
    for (const s of sources) if (SOURCES.includes(s) && !c.sources.includes(s)) c.sources.push(s);
    return c;
  };
  const applyData = (c, x) => {
    if (T(x.name) && !c.name) c.name = T(x.name);
    const k = keysoOf(x.keyso);
    // метрики Keys.so - статус ok; «не найден» и ошибка не затирают уже полученные метрики (не ноль, а нет данных)
    if (k) { c.keyso = { ...(c.keyso || {}), ...k }; c.keyso_status = 'ok'; }
    else if (['not_found', 'error'].includes(T(x.keyso_status)) && c.keyso_status !== 'ok') { c.keyso_status = T(x.keyso_status); c.keyso = null; }
    const h = historyOf(x.history);
    if (h) c.history = h;
    if (num(x.iks) != null) c.iks = num(x.iks);
    if (x.created != null && T(String(x.created))) { const d = dateOf(x.created); if (d) c.created = d; else notes.push(`${c.domain}: дата «${T(String(x.created))}» не разобрана`); }
    if (T(x.notes)) c.notes = [c.notes, T(x.notes)].filter(Boolean).join('; ');
  };
  // затравка анализа и конкуренты структуры - всегда (идемпотентно)
  for (const d of arr(ctx.seed && ctx.seed.domains)) { const n = normDomain(d && d.domain); if (n) { const c = touch(n, ['analysis'], true); if (c && T(d.name) && !c.name && c.sources) c.name = T(d.name); } }
  for (const r of arr(ctx.seed && ctx.seed.rejected)) reject(T(r), 'строка анализа без домена: искать домен по названию в выдаче');
  if (ctx.structure) for (const x of [...ctx.structure.direct, ...ctx.structure.indirect]) {
    const n = normDomain(x && x.domain); if (!n) continue;
    const c = touch(n, ['structure'], true);
    const k = keysoOf(x);
    if (c && c.sources && k && !c.keyso) { c.keyso = k; c.keyso_status = 'ok'; c.notes = [c.notes, 'метрики Keys.so из структуры'].filter(Boolean).join('; '); }
  }
  // выдача
  if (src === 'serp' || src === 'serp_msk') {
    const res = compactResults(raw.results, depth);
    if (src === 'serp') p.serp_results = res; else { p.serp_msk_results = res; p.queries_msk = arr(raw.queries).length ? arr(raw.queries).map(T) : res.map(r => r.query); }
    const st = serpStats(arr(raw.results), depth);
    const minQ = Math.max(1, Math.ceil(st.n * (ctx.params.serp_share_min || 0)));
    for (const [d, s] of Object.entries(st.by)) if (s.top10 >= minQ) touch(d, [src], true);
  }
  // кандидаты сырого ответа
  for (const x of arr(raw && raw.candidates)) {
    const rawDom = T(typeof x === 'string' ? x : x && x.domain);
    const d = normDomain(rawDom);
    if (!d) { if (rawDom) reject(rawDom, 'не домен'); continue; }
    const srcs = isData ? [] : [...new Set([src, ...arr(x && x.sources).map(T)])];
    const c = touch(d, srcs, !isData);
    if (!c) { notes.push(`${d}: нет в пуле - данные источника ${src} пропущены`); continue; }
    if (x && typeof x === 'object') applyData(c, x);
  }
  for (const r of arr(raw && raw.rejected)) if (r && T(r.raw)) reject(T(r.raw), T(r.reason) || 'без причины');
  // serp - у всех кандидатов по сохраненной выдаче (региона, иначе Москвы)
  const reg = serpStats(arr(p.serp_results).map(r => ({ query: r.query, urls: r.domains })), depth);
  const msk = serpStats(arr(p.serp_msk_results).map(r => ({ query: r.query, urls: r.domains })), depth);
  // и у доменов клиента (own): строка «ваш сайт» в таблице лидеров
  for (const c of [...p.candidates, ...p.own]) {
    const use = reg.n ? { st: reg, region: ctx.region.yandex_id } : msk.n ? { st: msk, region: 213 } : null;
    if (!use) { c.serp = null; continue; }
    let s = use.st.by[c.domain], region = use.region, n = use.st.n;
    if (!s && reg.n && msk.n && msk.by[c.domain]) { s = msk.by[c.domain]; region = 213; n = msk.n; }
    s = s || { top1: 0, top3: 0, top5: 0, top10: 0 };
    c.serp = { ...s, queries: n, share: n ? Math.round(s.top10 / n * 1000) / 1000 : 0, region };
  }
  // ошибки: прошлые этого источника снимаются, новые - с префиксом источника
  p.errors = p.errors.filter(e => !e.startsWith(src + ':'));
  // пройденные источники: слияние без ошибок (в том числе с пустым candidates - список для вызова был пуст)
  p.sources_done = arr(p.sources_done).filter(x => x !== src);
  if (!arr(raw && raw.errors).some(e => T(e))) p.sources_done.push(src);
  for (const e of arr(raw && raw.errors)) { const t = T(e); if (!t) continue; const key = t.split(':')[0]; p.errors.push(ERROR_KEYS.includes(key) ? t : `${src}: ${t}`); }
  if (T(raw && raw.method)) { const parts = T(p.method).split('; ').filter(Boolean); if (!parts.includes(T(raw.method))) parts.push(T(raw.method)); p.method = parts.join('; '); }
  p.generated_at = nowIso();
  return { pool: p, notes };
}

export function newPool(ctx) {
  return { generated_at: nowIso(), input_sha: ctx.input_sha, region: ctx.region, queries: ctx.queries, queries_msk: [], candidates: [], own: ctx.own.map(d => ({ domain: d, domain_unicode: domainUnicode(d) })), rejected: [], method: '', errors: [], sources_done: [] };
}

// ---------------------------------------------------------------- ранжирование
function stopOf(c, ctx, pool) {
  const own = ctx.own.find(o => sameOrSub(c.domain, o));
  if (own) return { stop: 'сайт клиента' };
  const s = ctx.stoplist.find(x => sameOrSub(c.domain, x.domain));
  if (s) return { stop: `стоп-лист: ${s.domain}${s.kind && s.kind !== 'stop' ? ` (${s.kind})` : ''}` };
  if (ctx.structure) {
    const ex = [...ctx.structure.excluded, ...ctx.structure.stop_list].find(x => normDomain(x && x.domain) === c.domain);
    if (ex) {
      const why = T(ex.reason) || 'без причины';
      if (arr(c.sources).includes('analysis')) return { stop: '', note: `затравка анализа сильнее исключения структурой: ${why}` };
      return { stop: `исключен структурой: ${why}` };
    }
  }
  const parent = arr(pool.candidates).find(o => o.domain !== c.domain && isSub(c.domain, o.domain));
  if (parent) return { stop: `поддомен: основной домен ${parent.domain} в списке` };
  return { stop: '' };
}

export function siteTypeOf(k) {
  const pages = num(k && k.pages), dr = num(k && k.dr);
  if (pages == null) return 'unknown';
  if (pages >= 500) return dr != null && dr >= 25 ? 'multipage_leader' : 'medium';
  if (pages >= 50) return 'medium';
  if (pages >= 6) return 'small';
  return 'landing';
}
const KIND_MATCH = { landing: ['landing', 'small'], multipage: ['medium', 'multipage_leader'] };
const srcRank = c => {
  const s = arr(c.sources);
  const inSerp = s.includes('serp') || s.includes('serp_msk') || !!(c.serp && c.serp.top10 > 0);
  if (s.includes('analysis') && inSerp) return 0;
  if (s.includes('analysis')) return 1;
  if (s.includes('structure')) return 2;
  if (s.includes('keyso')) return 3;
  if (s.includes('serp')) return 4;
  return 5;
};
const yearsBetween = (from, to) => {
  const a = Date.parse(from + 'T00:00:00Z'), b = Date.parse(to + 'T00:00:00Z');
  return Number.isFinite(a) && Number.isFinite(b) ? (b - a) / (365.25 * 86400000) : null;
};

// Метрики кандидата: значение или undefined (нет данных); na - метрики, которые к кандидату не применяются (ratio при
// ТОП-50 Keys.so ниже ratio_min_top50): они не входят ни в вес, ни в покрытие и не считаются пропуском.
function metricsOf(c, prm) {
  const m = {}, na = [];
  if (c.serp && num(c.serp.share) != null) m.share = num(c.serp.share);
  const k = c.keyso_status === 'ok' ? c.keyso : null;
  if (k) {
    if (num(k.top10) != null) m.top10 = num(k.top10);
    if (num(k.top50) != null) m.top50 = num(k.top50);
    if (num(k.traffic) != null) m.traffic = num(k.traffic);
    if (num(k.top10) != null && num(k.top50) != null) {
      if (num(k.top50) >= prm.ratio_min_top50) m.ratio = num(k.top10) / num(k.top50); else na.push('ratio');
    }
  }
  if (num(c.iks) != null) m.iks = num(c.iks);
  return { m, na };
}

// Метрики Keys.so вне веса: город без базы Keys.so (или регион не распознан). Федеральный рынок - база msk, метрики в весе.
export const keysoOff = region => !!(region && region.city_not_in_keyso && !region.federal);

// Вес W 0-100 по метрикам среди кандидатов без стопа (лог-шкала от лидера) - общая часть ранжирования и --prelim.
function weigh(list, prm, region) {
  const noKeyso = keysoOff(region);
  const weights = Object.fromEntries(Object.entries(prm.weights).map(([k, w]) => [k, noKeyso && KEYSO_METRICS.includes(k) ? 0 : Number(w) || 0]));
  const mets = list.map(c => metricsOf(c, prm));
  const max = {};
  for (const k of Object.keys(weights)) max[k] = Math.max(0, ...mets.map(({ m }) => (m[k] != null ? m[k] : 0)));
  const active = Object.keys(weights).filter(k => weights[k] > 0 && max[k] > 0);
  return list.map((c, i) => {
    const { m, na: naAll } = mets[i];
    const na = active.filter(k => naAll.includes(k));
    const own = active.filter(k => !na.includes(k));
    const total = own.reduce((s, k) => s + weights[k], 0);
    const avail = own.filter(k => m[k] != null);
    const missing = own.filter(k => m[k] == null);
    if (!avail.length || !total) return { W: null, coverage: 0, used: [], missing, na, noKeyso };
    const aw = avail.reduce((s, k) => s + weights[k], 0);
    let W = avail.reduce((s, k) => s + weights[k] * (Math.log1p(m[k]) / Math.log1p(max[k]) * 100), 0) / aw;
    const coverage = aw / total;
    let penalty = 1;
    const onlyKeysoMissing = missing.length && missing.every(k => KEYSO_METRICS.includes(k)) && m.share != null && (m.iks != null || !own.includes('iks'));
    if (coverage < prm.coverage_min && !onlyKeysoMissing) { penalty = coverage / prm.coverage_min; W *= penalty; }
    return { W, coverage, used: avail, missing, na, penalty, onlyKeysoMissing, noKeyso };
  });
}

export function rankPool(pool, ctx, opts = {}) {
  const prm = { ...DEFAULTS, ...ctx.params, weights: { ...DEFAULTS.weights, ...((ctx.params && ctx.params.weights) || {}) } };
  const now = dateOf(opts.now) || dateOf(pool.generated_at) || new Date().toISOString().slice(0, 10);
  const region = pool.region || ctx.region || {};
  const warnings = [];
  const cands = arr(pool.candidates).map((c, idx) => ({ c, idx, ...stopOf(c, ctx, pool) }));
  const live = cands.filter(x => !x.stop);
  const ws = weigh(live.map(x => x.c), prm, region);
  live.forEach((x, i) => { x.w = ws[i]; });
  const kind = T(ctx.siteKind);
  const rows = cands.map(x => {
    const c = x.c;
    const reasons = [];
    if (x.note) reasons.push(x.note);
    const site_type = siteTypeOf(c.keyso_status === 'ok' ? c.keyso : null);
    let age_years = null, age_class = 'unknown';
    if (c.created) { const y = yearsBetween(c.created, now); if (y != null) { age_years = r1(y); age_class = y < prm.young_years ? 'young' : y >= prm.old_years ? 'old' : 'mid'; } }
    let growth = 'unknown';
    const h = c.history;
    if (h && num(h.it50_now) != null && num(h.it50_12m) != null) {
      const a = num(h.it50_now), b = num(h.it50_12m);
      const g = b > 0 ? a / b - 1 : a > 0 ? Infinity : 0;
      growth = g >= prm.growth_threshold ? 'up' : g <= -prm.growth_threshold ? 'down' : 'flat';
    }
    if (x.stop) return { domain: c.domain, domain_unicode: c.domain_unicode, sources: c.sources, stop: x.stop, weight: null, effective: null, coverage: 0, age_years, age_class, growth, site_type, metrics_used: [], reason: [x.stop, ...reasons].join('; '), _idx: x.idx, _c: c };
    const w = x.w;
    if (w.missing.length && w.W != null) reasons.push(`нет метрик: ${w.missing.join(', ')}${c.keyso_status === 'not_found' ? ' (Keys.so: не найден)' : ''}`);
    if (w.na.includes('ratio')) reasons.push(`ratio не применяется: ТОП-50 < ${prm.ratio_min_top50}`);
    if (w.noKeyso) reasons.push('метрики Keys.so - только для равенства (регион вне баз Keys.so)');
    if (w.W != null && w.penalty < 1) reasons.push(`покрытие ${r2(w.coverage)} - вес x${r2(w.penalty)}`);
    else if (w.W != null && w.coverage < prm.coverage_min && w.onlyKeysoMissing) reasons.push(`покрытие ${r2(w.coverage)} без снижения: нет только метрик Keys.so`);
    if (w.W == null) reasons.push('метрик нет');
    let typeMul = 1;
    if (kind && KIND_MATCH[kind] && site_type !== 'unknown') {
      if (KIND_MATCH[kind].includes(site_type)) { typeMul = 1 + prm.site_type_bonus; reasons.push(`тип сайта ${site_type} совпадает с ${kind}`); }
      else { typeMul = 1 - prm.site_type_penalty; reasons.push(`тип сайта ${site_type} не совпадает с ${kind}`); }
    }
    const ageMul = age_class === 'young' ? 1 + prm.young_bonus : 1;
    if (age_class === 'young') reasons.push(`молодой домен (${age_years} лет)`);
    const grMul = growth === 'up' ? 1 + prm.growth_bonus : growth === 'down' ? 1 - prm.growth_bonus : 1;
    if (growth === 'up' || growth === 'down') reasons.push(growth === 'up' ? 'рост it50' : 'падение it50');
    const E = w.W == null ? null : w.W * typeMul * ageMul * grMul;
    return { domain: c.domain, domain_unicode: c.domain_unicode, sources: c.sources, stop: '', weight: w.W == null ? null : r1(w.W), effective: E == null ? null : r2(E), coverage: r2(w.coverage), age_years, age_class, growth, site_type, metrics_used: w.used, reason: reasons.join('; '), _idx: x.idx, _c: c, _W: w.W, _E: E };
  });
  const ok = rows.filter(r => !r.stop);
  const traffic = r => num(r._c.keyso && r._c.keyso.traffic) || 0;
  const noKeyso = keysoOff(region);
  const weighted = ok.filter(r => r._E != null).sort((a, b) => b._E - a._E || (noKeyso ? traffic(b) - traffic(a) : 0) || b._W - a._W || srcRank(a._c) - srcRank(b._c) || a.domain.localeCompare(b.domain));
  const bare = ok.filter(r => r._E == null).sort((a, b) => srcRank(a._c) - srcRank(b._c) || a._idx - b._idx);
  if (ok.length && !weighted.length) warnings.push('отбор без метрик: порядок по источникам (анализ и выдача, анализ, структура, Keys.so, выдача)');
  if (noKeyso) warnings.push('рынок оценен по выдаче без Keys.so (регион вне баз Keys.so)');
  const order = [...weighted, ...bare].map(r => r.domain);
  const byW = (a, b) => (b._W ?? -1) - (a._W ?? -1) || order.indexOf(a.domain) - order.indexOf(b.domain);
  let anchors = [...ok.filter(r => r.age_class === 'old').sort(byW), ...ok.filter(r => r.age_class === 'mid').sort(byW)].map(r => r.domain);
  if (!anchors.length && ok.some(r => r.age_class === 'unknown')) {
    anchors = ok.filter(r => r.age_class === 'unknown').sort(byW).map(r => r.domain);
    warnings.push('эталон без подтвержденного возраста');
  }
  const target = Math.max(1, Math.round(prm.target));
  if (anchors.length && !order.slice(0, target).some(d => anchors.includes(d))) {
    const a = anchors[0];
    order.splice(order.indexOf(a), 1);
    order.splice(target - 1, 0, a);
    const row = rows.find(r => r.domain === a);
    row.reason = [row.reason, `эталон поднят на место ${target}`].filter(Boolean).join('; ');
  }
  const candidates = rows.map(r => {
    const { _idx, _c, _W, _E, ...rest } = r;
    return { ...rest, rank: r.stop ? null : order.indexOf(r.domain) + 1, anchor: anchors.includes(r.domain) };
  }).sort((a, b) => (a.rank == null) - (b.rank == null) || (a.rank || 0) - (b.rank || 0));
  return {
    generated_at: nowIso(),
    pool_sha: sha(canon({ ...pool, generated_at: '' })),
    params: { ...prm, site_kind: kind || null, now, keyso_in_weight: !noKeyso },
    order, anchors, warnings: [...arr(ctx.warnings), ...warnings], candidates,
  };
}

// ---------------------------------------------------------------- CLI
// Источники, после которых недобор кандидатов - свойство ниши: выдача (и Москва при регионе не 213), Keys.so и добор.
const SERP_SOURCES = ['serp', 'serp_msk'];
export const exhaustSources = region => ['serp', ...(num(region && region.yandex_id) !== 213 ? ['serp_msk'] : []), 'keyso_batch', 'keyso'];
function poolSchemaErrors(pool) {
  let schema = readSafe(P('schemas', 'kf-pool.schema.json')) || readSafe(path.join(HERE, '..', 'schemas', 'kf-pool.schema.json'));
  if (!schema) return ['нет схемы kf-pool'];
  const errs = validate(schema, pool);
  for (const c of arr(pool && pool.candidates)) if (c && c.created != null && !/^\d{4}-\d{2}-\d{2}$/.test(String(c.created))) errs.push(`${c.domain}: created не YYYY-MM-DD`);
  return errs;
}

function main() {
  const a = argv({ queries: 'bool', prelim: 'bool', check: 'bool' });
  const ctx = taskContext();
  const poolFile = P(a.pool || path.join('work', 'competitors', 'pool.json'));
  const outFile = P(a.out || path.join('work', 'competitors', 'ranking.json'));
  const print = o => console.log(JSON.stringify(o));

  if (a.queries) {
    print({ queries: ctx.queries, region: ctx.region, own: ctx.own.map(domainUnicode), target: ctx.params.target, serp_depth: ctx.params.serp_depth });
    process.exit(0);
  }

  if (a['merge-pool']) {
    let raw;
    try { raw = JSON.parse(fs.readFileSync(path.resolve(a['merge-pool']), 'utf8').replace(/^\uFEFF/, '')); } catch (e) { console.error(`raw не читается: ${e.message}`); process.exit(1); }
    let pool = readSafe(poolFile);
    let reset = '';
    if (pool && pool.input_sha !== ctx.input_sha) { reset = 'входы изменились (запросы, регион, затравка или конкуренты структуры) - pool начат заново'; pool = null; }
    if (!pool) pool = newPool(ctx);
    pool.candidates = arr(pool.candidates); pool.rejected = arr(pool.rejected); pool.errors = arr(pool.errors); pool.own = arr(pool.own);
    pool.queries = ctx.queries; pool.region = ctx.region; pool.input_sha = ctx.input_sha;
    let res;
    try { res = mergePool(pool, raw, ctx); } catch (e) { console.error(e.message); process.exit(1); }
    const errs = poolSchemaErrors(res.pool);
    if (errs.length) { console.error('pool.json не прошел схему kf-pool, не записан:\n' + errs.slice(0, 20).map(x => ' - ' + x).join('\n')); process.exit(1); }
    writeJson(poolFile, res.pool);
    const rk = rankPool(res.pool, ctx);
    const eligible = rk.candidates.filter(c => !c.stop);
    const visible = eligible.filter(c => { const pc = res.pool.candidates.find(x => x.domain === c.domain); return pc && pc.serp && pc.serp.share >= ctx.params.serp_share_min; }).length;
    print({ written: path.relative(process.cwd(), poolFile).replace(/\\/g, '/'), source: T(raw.source), candidates: res.pool.candidates.length, eligible: eligible.length, visible, need_msk: visible < ctx.params.target && ctx.region.yandex_id !== 213 && !arr(res.pool.serp_msk_results).length, errors: res.pool.errors, notes: [reset, ...res.notes].filter(Boolean) });
    process.exit(0);
  }

  const pool = readSafe(poolFile);

  if (a.check) {
    const done = (status, reason, extra = {}) => { print({ status, reason, failed_sources: [], sources_done: arr(pool && pool.sources_done), ...extra }); process.exit(0); };
    if (!pool) done('stale', 'нет work/competitors/pool.json');
    const errs = poolSchemaErrors(pool);
    if (errs.length) done('stale', `pool.json не проходит схему: ${errs.slice(0, 3).join('; ')}`);
    const rk = rankPool(pool, ctx);
    const eligible = rk.candidates.filter(c => !c.stop).length;
    const counts = { candidates: pool.candidates.length, eligible };
    if (pool.input_sha !== ctx.input_sha) done('stale', 'входы изменились (запросы, регион, затравка или конкуренты структуры)', counts);
    // запросов нет (ни фраз, ни маркеров) - выдачу спрашивать не о чем: serp и serp_msk считаются пройденными, их ошибки
    // («serp: нет запросов») не делают pool устаревшим (иначе stale навсегда и скаут на каждом повторе wf-02)
    const noQueries = !arr(ctx.queries).length;
    const serpKey = e => noQueries && SERP_SOURCES.includes(String(e).split(':')[0].trim());
    const errors = arr(pool.errors).filter(e => !serpKey(e));
    if (noQueries) counts.no_queries = true;
    if (errors.length) {
      const failed = [...new Set(errors.map(e => String(e).split(':')[0]).filter(k => ERROR_KEYS.includes(k)))];
      done('stale', `ошибки источников: ${errors.join('; ')}`, { ...counts, failed_sources: failed });
    }
    if (eligible < ctx.params.target) {
      // кандидатов мало, но все источники кандидатов пройдены без ошибок - ниша узкая, повтор платного отбора не нужен
      const passed = [...arr(pool.sources_done), ...(noQueries ? SERP_SOURCES : [])];
      const left = exhaustSources(ctx.region).filter(s => !passed.includes(s));
      if (!left.length) done('fresh', `кандидатов меньше target: годных ${eligible} из ${ctx.params.target}, источники исчерпаны`, { ...counts, exhausted: true });
      done('stale', `годных кандидатов ${eligible} из ${ctx.params.target}`, { ...counts, sources_left: left });
    }
    done('fresh', '', counts);
  }

  if (!pool) { console.error('нет work/competitors/pool.json: сначала скаут (prompts/02-competitor-scout.md)'); process.exit(2); }

  if (a.prelim) {
    const rk = rankPool(pool, ctx);
    const live = rk.candidates.filter(c => !c.stop);
    const ws = weigh(live.map(r => pool.candidates.find(c => c.domain === r.domain)), ctx.params, pool.region || ctx.region);
    const pre = live.map((r, i) => ({ domain: r.domain, domain_unicode: r.domain_unicode, weight: ws[i].W == null ? null : r1(ws[i].W), sources: r.sources }))
      .sort((x, y) => (y.weight ?? -1) - (x.weight ?? -1) || srcRank({ sources: x.sources }) - srcRank({ sources: y.sources }));
    const pc = d => pool.candidates.find(c => c.domain === d) || {};
    const keyso = pre.filter(x => ['none', 'error'].includes(pc(x.domain).keyso_status || 'none')).slice(0, ctx.params.keyso_batch_max).map(x => x.domain_unicode);
    const ownVisible = arr(pool.own).find(o => o.keyso && num(o.keyso.top50) > 0);
    const seedTop = pre.find(x => arr(x.sources).includes('analysis'));
    print({
      prelim: pre.map(({ sources, ...x }) => x),
      keyso,
      own: arr(pool.own).map(o => o.domain_unicode || domainUnicode(o.domain)),
      history: pre.slice(0, ctx.params.history_max).map(x => x.domain_unicode),
      lookup: [...pre.map(x => x.domain), ...arr(pool.own).map(o => o.domain).filter(d => !pre.some(x => x.domain === d))],
      competitors_from: ownVisible ? ownVisible.domain_unicode || domainUnicode(ownVisible.domain) : seedTop ? seedTop.domain_unicode : (pre[0] ? pre[0].domain_unicode : null),
    });
    process.exit(0);
  }

  const errs = poolSchemaErrors(pool);
  if (errs.length) { console.error('pool.json не проходит схему kf-pool:\n' + errs.slice(0, 20).map(x => ' - ' + x).join('\n')); process.exit(1); }
  const rk = rankPool(pool, ctx, { now: a.now });
  writeJson(outFile, rk);
  const top = rk.order.slice(0, Math.max(ctx.params.target, 8)).map(d => { const c = rk.candidates.find(x => x.domain === d); return `${d} (${c.effective ?? '-'}, ${c.age_class}${c.anchor ? ', эталон' : ''})`; });
  console.log(`ranking: кандидатов ${rk.candidates.length}, без стопа ${rk.order.length}, эталоны ${rk.anchors.slice(0, 3).join(', ') || '-'}`);
  console.log(`порядок: ${top.join(', ') || '-'}`);
  for (const w of rk.warnings) console.log(` ! ${w}`);
  process.exit(0);
}

const real = f => { try { return fs.realpathSync.native(path.resolve(f)).toLowerCase(); } catch { return ''; } };
if (process.argv[1] && real(process.argv[1]) === real(fileURLToPath(import.meta.url))) main();
