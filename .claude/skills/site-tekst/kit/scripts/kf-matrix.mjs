// Матрица КФ и КНДР лидеров (фаза 2): наблюдения 02-kf-observer (work/competitors/kf/<домен>.json, сайт заказчика -
// kf/own.json) -> work/kf/matrix.json (schemas/kf-matrix), work/shell.json (schemas/shell), work/kf/status.json.
//
// node scripts/kf-matrix.mjs [--shell]            матрица и статус; --shell - еще оболочка work/shell.json
// node scripts/kf-matrix.mjs --compact --type <t> [--min recommended]   одна строка JSON: строки тела типа t
//                                                  [{id, name, n, N, level, kind, block_hint[, scope]}]; нет матрицы - []
// node scripts/kf-matrix.mjs --candidates         x-элементы после сведения -> work/kf/candidates.json: найденные хотя бы у
//                                                  одного домена и по каждому домену - записи {key: "<scope>|<zone>|<id>", id,
//                                                  ...} x-элементов, по которым у него 0 без перепроверки, по записи на scope
//                                                  (их проверяет 02-kf-observer в режиме recheck: recheck {"<key>": 1|0|"?"};
//                                                  голый id прежнего формата отвечает за все scope)
// node scripts/kf-matrix.mjs --stale-observers    план наблюдения work/kf/plan.json (кадры, DOM, текст по частям; body_pages -
//                                                  страницы, чье тело описывает часть; limits - непросмотренные кадры, сайт
//                                                  заказчика без снятия) и домены, чей kf/<домен>.json старше снимков или с
//                                                  другим набором страниц
// node scripts/kf-matrix.mjs --status skip|no_competitors [--reason "..."]   work/kf/status.json; оба статуса снимают
//                                                  matrix.json, shell.json и candidates.json (этап КФ не проведен - правило
//                                                  включения §3; наблюдения kf/*.json остаются, матрица пересобирается
//                                                  обычным прогоном)
// Последняя строка stdout - KF_MATRIX | KF_CANDIDATES | KF_STALE | KF_STATUS {json} (кроме --compact). Код 0; 2 - нет
// work/competitors/competitors.json или неверные аргументы.
//
// Правила матрицы (программа 05.10, §3.3):
// - домены - только годные из competitors.json (status ok) плюс own; kf-файлы других доменов - строка limits «устаревший
//   файл: <домен>»;
// - строка = (scope, zone, id): scope site - зоны header, footer, mobile, fixed (элемент есть, если есть на любой снятой
//   странице домена); scope <тип> - зона body (есть на любой странице типа); info_other - по назначению (subject), scope
//   info_other:<назначение>; тело - только типов карты (work/sitemap.json, без skip), если карта есть;
// - значение: 1, 0 (страница scope снята, элемента нет; у x-элемента - только после перепроверки, без нее - «?» и строка
//   limits), «?»; охват n из N - N конкуренты со снятыми страницами scope;
// - уровень по абсолютному n: must (n >= must_n, по умолчанию ceil(0,8 x target)), recommended (n >= recommended_n, 2),
//   optional (n = 1); n = 0 - строки нет; N < target - пометка «охват неполный: N из target»; multipage_only на лендинге -
//   не выше recommended; target - config competitors.selection.target (5), пороги - competitors.kf {must_n, recommended_n};
// - kind: словарь; x-элемент - work/kf/aliases.json, иначе большинство голосов наблюдателей (при равенстве slot > function >
//   page_link > block), нет голосов - slot; own - отдельное поле, already - производная «уже есть»; sums - «сумма элементов».
// Сведение x-элементов: aliases.json ({"x-a": {"to": "x-b"|"<id словаря>", "kind"}}) и скриптом - одинаковое название.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { argv, P, exists, readJson, writeJson, nowIso } from './lib.mjs';

export const ZONES = ['header', 'footer', 'mobile', 'fixed', 'body'];
export const SITE_ZONES = ['header', 'footer', 'mobile', 'fixed'];
export const LEVELS = ['must', 'recommended', 'optional'];
const KIND_ORDER = ['slot', 'function', 'page_link', 'block', 'nav'];
export const IMAGES_MAX = 12;
const rel = (...p) => path.posix.join(...p);
const tryJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8').replace(/^\ufeff/, '')); } catch { return null; } };
const normName = s => String(s || '').toLowerCase().replace(/\u0451/g, 'е').replace(/[^a-zа-я0-9]+/g, ' ').trim();
const mtime = f => { try { return fs.statSync(f).mtimeMs; } catch { return 0; } };
const isX = id => /^x-/.test(String(id));

// ---------- входы ----------
export function loadInputs(root = process.cwd()) {
  const R = (...p) => path.join(root, ...p);
  const limits = [];
  const dict = tryJson(R('config', 'kf-elements.json'));
  if (!dict) limits.push('нет словаря config/kf-elements.json - все элементы как x-элементы');
  const cfg = tryJson(R('config', 'project.json')) || {};
  const comp = tryJson(R('work', 'competitors', 'competitors.json'));
  const sitemap = tryJson(R('work', 'sitemap.json'));
  const capture = tryJson(R('work', 'competitors', 'capture.json'));
  const aliases = tryJson(R('work', 'kf', 'aliases.json')) || {};
  const plan = tryJson(R('work', 'kf', 'plan.json'));
  if (plan && Array.isArray(plan.limits)) limits.push(...plan.limits.map(String));
  const kfDir = R('work', 'competitors', 'kf');
  const observed = {};
  if (fs.existsSync(kfDir)) for (const f of fs.readdirSync(kfDir).filter(f => f.endsWith('.json')).sort()) {
    const j = tryJson(path.join(kfDir, f));
    if (!j) { limits.push(`kf/${f}: не читается`); continue; }
    observed[f.replace(/\.json$/, '')] = j;
  }
  const sel = (cfg.competitors && cfg.competitors.selection) || {};
  const kfCfg = (cfg.competitors && cfg.competitors.kf) || {};
  const target = Math.max(1, Number(sel.target) || 5);
  const mustN = Math.max(1, Number(kfCfg.must_n) || Math.ceil(0.8 * target));
  const recN = Math.max(1, Number(kfCfg.recommended_n) || 2);
  const pagesLive = sitemap && Array.isArray(sitemap.pages) ? sitemap.pages.filter(p => p && p.status !== 'skip' && p.type) : null;
  const kindRaw = String((cfg.business && cfg.business.site_kind) || (cfg.niche && cfg.niche.site_kind) || '').toLowerCase();
  const siteKind = /landing|лендинг/.test(kindRaw) ? 'landing' : kindRaw ? 'multipage' : pagesLive && pagesLive.length === 1 ? 'landing' : 'multipage';
  const types = pagesLive ? [...new Set(pagesLive.map(p => p.type))] : null;
  const competitors = comp ? (comp.competitors || []).filter(c => c && c.domain && c.status === 'ok') : null;
  return { root, dict: dict || { elements: [] }, cfg, comp, competitors, sitemap, capture, aliases, observed, target, mustN, recN, siteKind, types, limits };
}

// Канонический id: алиасы нормализатора, затем сведение скриптом по одинаковому названию x-элементов.
export function canonizer(observed, aliases, dictIds) {
  const al = id => { let cur = id; for (let k = 0; k < 10; k++) { const t = aliases[cur] && aliases[cur].to; if (!t || t === cur) break; cur = t; } return cur; };
  const byName = new Map(), auto = new Map();
  for (const d of Object.keys(observed).sort()) for (const p of observed[d].pages || []) for (const z of ZONES) for (const e of ((p.zones || {})[z] || [])) {
    const id = al(fixId(e.id, dictIds));
    if (!isX(id)) continue;
    const k = normName(e.name);
    if (!k) continue;
    if (!byName.has(k)) byName.set(k, id);
    else if (byName.get(k) !== id && !auto.has(id)) auto.set(id, byName.get(k));
  }
  return id => { let c = al(fixId(id, dictIds)); if (auto.has(c)) c = al(auto.get(c)); return c; };
}
// id не из словаря и не x- (ошибка наблюдателя) - как x-элемент
export const fixId = (id, dictIds) => (isX(id) || dictIds.has(id) ? String(id) : `x-${String(id).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'unknown'}`);

const scopeOf = page => (page.type === 'info_other' && page.subject ? `info_other:${String(page.subject).trim()}` : String(page.type || ''));
const typeAllowed = (scope, types) => !types || types.includes(scope.split(':')[0]);

// Наблюдения доменов: {domain: {role, pages: [{name, scope, captured}], vals: Map(key -> 1|"?"), recheck, votes}}
function collect(inp, canon) {
  const dictIds = new Set(inp.dict.elements.map(e => e.id));
  const compSet = new Set((inp.competitors || []).map(c => String(c.domain).toLowerCase()));
  const limits = [];
  const doms = {};
  const meta = {}; // key -> {name, labels, votes, hints}
  for (const [file, j] of Object.entries(inp.observed)) {
    const isOwn = file === 'own' || j.role === 'own';
    const d = isOwn ? 'own' : String(j.domain || file).toLowerCase();
    if (!isOwn && !compSet.has(d)) { limits.push(`устаревший файл: ${d} (нет среди годных конкурентов competitors.json) - не учтен`); continue; }
    const rec = doms[d] = { domain: d, role: isOwn ? 'own' : 'competitor', pages: [], vals: new Map(), recheck: {}, limits: (j.limits || []).map(String) };
    // ответ перепроверки: ключ "<scope>|<zone>|<id>" (по scope) или голый id (прежний формат - за все scope)
    for (const [k, v] of Object.entries(j.recheck || {})) {
      const parts = String(k).split('|');
      rec.recheck[parts.length === 3 ? `${parts[0]}|${parts[1]}|${canon(parts[2])}` : canon(k)] = v === 1 || v === 0 ? v : '?';
    }
    for (const p of j.pages || []) {
      const scope = scopeOf(p);
      rec.pages.push({ name: p.name, type: p.type, scope, captured: p.captured !== false });
      for (const z of ZONES) for (const e of ((p.zones || {})[z] || [])) {
        if (!e || !e.id) continue;
        const id = canon(e.id);
        if (!isX(e.id) && !dictIds.has(e.id)) limits.push(`${d}: id «${e.id}» не из словаря - учтен как ${id}`);
        if (!dictIds.has(e.id) && !e.kind) limits.push(`x-элемент без kind: ${d}/${e.id} - вид по голосам других наблюдателей или slot`);
        const sc = SITE_ZONES.includes(z) ? 'site' : scope;
        if (z === 'body' && !typeAllowed(sc, inp.types)) continue;
        const key = `${sc}|${z}|${id}`;
        const v = e.present === 1 ? 1 : '?';
        if (rec.vals.get(key) !== 1) rec.vals.set(key, v);
        const m = meta[key] ||= { names: {}, labels: [], votes: {}, hints: [] };
        if (e.name) m.names[e.name] = (m.names[e.name] || 0) + 1;
        if (e.label && m.labels.length < 5 && !m.labels.includes(e.label)) m.labels.push(String(e.label).slice(0, 80));
        if (e.kind) m.votes[e.kind] = (m.votes[e.kind] || 0) + 1;
        if (e.needs_hint && !m.hints.includes(e.needs_hint)) m.hints.push(String(e.needs_hint));
      }
    }
  }
  for (const c of inp.competitors || []) { const d = String(c.domain).toLowerCase(); if (!doms[d]) limits.push(`нет наблюдения: ${d} (kf/${d}.json) - домен не в охвате`); }
  return { doms, meta, limits };
}

// N-множество scope: конкуренты с наблюденными страницами scope (для site - с любой страницей)
function scopeDomains(doms, scope, includeOwn = false) {
  return Object.values(doms).filter(r => (includeOwn || r.role === 'competitor') && r.pages.length && (scope === 'site' || r.pages.some(p => p.scope === scope))).map(r => r.domain);
}
// перепроверка x-элемента: сначала ответ по ключу строки (scope|zone|id), затем голый id (прежний формат)
const hasRecheck = (rec, key, id) => key in rec.recheck || id in rec.recheck;
const xValue = (rec, key, id) => { const v = key in rec.recheck ? rec.recheck[key] : rec.recheck[id]; return v === 1 || v === 0 ? v : '?'; };
// оболочка домена без кадров (текст снимков: снятие не удалось, антибот): отсутствие элемента шапки, подвала, мобильной
// версии и закрепленных - «?», а не 0: этих зон без кадров не видно (тело страницы текст снимка показывает)
const unseenShell = (rec, scope, zone) => zone !== 'body' && !rec.pages.some(p => p.captured && (scope === 'site' || p.scope === scope));

export function buildMatrix(inp) {
  const dictIds = new Set(inp.dict.elements.map(e => e.id));
  const dictById = new Map(inp.dict.elements.map((e, i) => [e.id, { ...e, order: i }]));
  const canon = canonizer(inp.observed, inp.aliases || {}, dictIds);
  const { doms, meta, limits } = collect(inp, canon);
  limits.unshift(...inp.limits);
  const keys = new Set();
  for (const r of Object.values(doms)) for (const k of r.vals.keys()) keys.add(k);
  const rows = [];
  const scopeN = {};
  const noRecheck = {};
  const aliasKind = id => { const own = inp.aliases && inp.aliases[id]; if (own && own.kind) return own.kind; const hit = Object.entries(inp.aliases || {}).find(([k, v]) => v && v.kind && canon(k) === id); return hit ? hit[1].kind : null; };
  for (const key of keys) {
    const [scope, zone, id] = key.split('|');
    const nset = scopeN[scope] ||= scopeDomains(doms, scope);
    const x = !dictById.has(id);
    const values = {};
    let n = 0;
    for (const d of nset) {
      const rec = doms[d];
      let v = rec.vals.get(key);
      if (v == null) { v = x ? xValue(rec, key, id) : unseenShell(rec, scope, zone) ? '?' : 0; if (x && v === '?' && !hasRecheck(rec, key, id)) (noRecheck[d] ||= new Set()).add(id); }
      values[d] = v;
      if (v === 1) n++;
    }
    if (!n) continue;
    const N = nset.length;
    let level = n >= inp.mustN ? 'must' : n >= inp.recN ? 'recommended' : 'optional';
    const el = dictById.get(id);
    const m = meta[key] || { names: {}, labels: [], votes: {}, hints: [] };
    const notes = [];
    if (N < inp.target) notes.push(`охват неполный: ${N} из ${inp.target}`);
    if (el && el.multipage_only && inp.siteKind === 'landing' && level === 'must') { level = 'recommended'; notes.push('на лендинге не выше «рекомендовано»'); }
    let kind = el ? el.kind : aliasKind(id);
    if (!kind) { const v = Object.entries(m.votes).sort((a, b) => b[1] - a[1] || KIND_ORDER.indexOf(a[0]) - KIND_ORDER.indexOf(b[0])); kind = v.length ? v[0][0] : 'slot'; }
    const ownRec = doms.own;
    let own = null;
    if (ownRec && ownRec.pages.length && (scope === 'site' || ownRec.pages.some(p => p.scope === scope))) {
      own = ownRec.vals.get(key);
      if (own == null) own = x ? xValue(ownRec, key, id) : 0;
    }
    const name = el ? el.name : Object.entries(m.names).sort((a, b) => b[1] - a[1])[0]?.[0] || id;
    rows.push({
      scope, zone, id, name, kind, category: el ? el.category : 'Неопределено', eeat: el ? el.eeat ?? null : null, x, visible: el ? el.visible !== false : true,
      level, n, N, values, own, already: own === 1, label: m.labels[0] || '', block_hint: el ? el.block_hint ?? null : null, render: el ? el.render ?? null : null,
      needs: el ? el.needs || [] : [], needs_hint: (el && el.needs_hint) || m.hints[0] || '', page_match: el ? el.page_match ?? null : null,
      multipage_only: !!(el && el.multipage_only), notes,
    });
  }
  // порядок: site, затем типы в порядке карты; зоны; уровень; охват; словарь
  const typeOrder = inp.types || [];
  const sRank = s => (s === 'site' ? -1 : (typeOrder.indexOf(s.split(':')[0]) + 1 || 999));
  rows.sort((a, b) => sRank(a.scope) - sRank(b.scope) || a.scope.localeCompare(b.scope) || ZONES.indexOf(a.zone) - ZONES.indexOf(b.zone) || LEVELS.indexOf(a.level) - LEVELS.indexOf(b.level) || b.n - a.n || (dictById.get(a.id)?.order ?? 1e4) - (dictById.get(b.id)?.order ?? 1e4) || a.name.localeCompare(b.name));
  for (const [scope, list] of Object.entries(scopeN)) if (list.length < inp.target) limits.push(`охват неполный (${scope}): ${list.length} из ${inp.target}`);
  for (const [d, ids] of Object.entries(noRecheck)) limits.push(`перепроверка не выполнена: ${d} - «?» по ${[...ids].slice(0, 8).join(', ')}${ids.size > 8 ? ' и еще ' + (ids.size - 8) : ''}`);
  for (const r of Object.values(doms)) for (const l of r.limits.slice(0, 5)) limits.push(`${r.domain}: ${l}`);
  if ((!doms.own || !doms.own.pages.length) && !limits.some(l => /^сайт заказчика не наблюдался/.test(l))) limits.push(`сайт заказчика не наблюдался: ${ownReason(inp)} - колонки «уже есть» нет`);
  const sums = {};
  for (const r of Object.values(doms)) sums[r.domain] = rows.filter(x => (r.role === 'own' ? x.own : x.values[r.domain]) === 1).length;
  const domains = Object.values(doms).map(r => ({ domain: r.domain, role: r.role, pages: r.pages.length, captured: r.pages.filter(p => p.captured).length, observed: r.pages.length > 0 }));
  const allPages = Object.values(doms).flatMap(r => r.pages);
  const mode = !allPages.length ? 'text' : allPages.every(p => p.captured) ? 'frames' : allPages.some(p => p.captured) ? 'mixed' : 'text';
  if (mode === 'text') limits.push('без кадров (нет Chrome или снятие не удалось): наблюдение по тексту снимков, шапка и подвал не выше «?»');
  const scopes = Object.entries(scopeN).map(([scope, list]) => ({ scope, N: list.length, domains: list }));
  return { generated_at: nowIso(), target: inp.target, must_n: inp.mustN, recommended_n: inp.recN, site_kind: inp.siteKind, mode, domains, scopes, rows, sums, limits: [...new Set(limits)] };
}

export const levelAtLeast = (level, min) => LEVELS.indexOf(level) <= LEVELS.indexOf(min);

export function compactRows(matrix, type, min = 'optional') {
  if (!matrix || !Array.isArray(matrix.rows)) return [];
  const m = LEVELS.includes(min) ? min : 'optional';
  return matrix.rows.filter(r => r.zone === 'body' && r.visible !== false && (r.scope === type || (type === 'info_other' && r.scope.startsWith('info_other:'))) && levelAtLeast(r.level, m))
    .map(r => ({ id: r.id, name: r.name, n: r.n, N: r.N, level: r.level, kind: r.kind, block_hint: r.block_hint ?? null, ...(r.scope !== type ? { scope: r.scope } : {}) }));
}

export function shellOf(matrix) {
  const comp = (matrix.domains || []).filter(d => d.role === 'competitor' && d.observed).length;
  const items = matrix.rows.filter(r => r.scope === 'site' && r.visible !== false && levelAtLeast(r.level, 'recommended')).map(r => ({
    id: r.id, name: r.name, zone: r.zone, level: r.level, coverage: `${r.n}/${r.N}`, kind: ['slot', 'function', 'page_link'].includes(r.kind) ? r.kind : 'slot',
    // вид nav (логотип, меню, бургер, крошки) - часть оболочки прототипа всегда: render native, не чип
    render: r.kind === 'nav' ? 'native' : r.x ? 'generic' : r.render || 'generic', needs: r.x ? [] : r.needs || [], needs_hint: r.needs_hint || '', page_match: r.x ? null : r.page_match ?? null, niche: !!r.x, own: r.own ?? null,
  }));
  return { generated_at: matrix.generated_at, n_competitors: comp, items };
}

// x-элементы после сведения и кандидаты перепроверки по доменам
export function candidatesOf(inp) {
  const dictIds = new Set(inp.dict.elements.map(e => e.id));
  const canon = canonizer(inp.observed, inp.aliases || {}, dictIds);
  const { doms, meta } = collect(inp, canon);
  const xs = new Map();
  for (const r of Object.values(doms)) for (const [key, v] of r.vals) {
    const [scope, zone, id] = key.split('|');
    if (!isX(id)) continue;
    const m = meta[key] || { names: {}, labels: [], votes: {} };
    const x = xs.get(key) || { id, name: Object.entries(m.names).sort((a, b) => b[1] - a[1])[0]?.[0] || id, kind: (inp.aliases[id] && inp.aliases[id].kind) || Object.entries(m.votes).sort((a, b) => b[1] - a[1] || KIND_ORDER.indexOf(a[0]) - KIND_ORDER.indexOf(b[0]))[0]?.[0] || 'slot', label: m.labels[0] || '', zone, scope, found: [] };
    if (v === 1 && !x.found.includes(r.domain)) x.found.push(r.domain);
    xs.set(key, x);
  }
  const domains = {};
  for (const [key, x] of xs) {
    for (const d of scopeDomains(doms, x.scope, true)) {
      const rec = doms[d];
      if (rec.vals.has(key) || hasRecheck(rec, key, x.id)) continue;
      // по записи на scope и зону: ответ по одному scope не переносится на другой
      (domains[d] ||= []).push({ key, id: x.id, name: x.name, kind: x.kind, label: x.label, zone: x.zone, scope: x.scope });
    }
  }
  const x = [...xs.values()];
  const xUn = [...new Set(x.map(e => e.id))].filter(id => !(inp.aliases && inp.aliases[id]));
  return { generated_at: nowIso(), x, domains, x_unaliased: xUn.length };
}

// почему сайт заказчика без наблюдения: запись own в capture.json или нет снятия
function ownReason(inp) {
  const rec = ((inp.capture && inp.capture.pages) || []).find(p => p && (p.domain === 'own' || p.role === 'own'));
  if (!inp.capture) return 'нет снятия (work/competitors/capture.json)';
  if (!rec) return 'главная не снималась (пустой config.site_url или сбой снятия)';
  if (rec.status === 'ok') return 'нет kf/own.json (наблюдатель не ответил)';
  return `главная ${rec.status}${rec.reason ? ` (${rec.reason})` : ''}`;
}

// План наблюдения: по домену режим (frames - кадры, text - текст снимков), части с кадрами (не больше 12), DOM и текстом
export function observePlan(inp) {
  const R = (...p) => path.join(inp.root, ...p);
  const capPages = (inp.capture && inp.capture.pages) || [];
  const out = {};
  const stale = [];
  const limits = [];
  const list = [...(inp.competitors || []).map(c => ({ domain: String(c.domain).toLowerCase(), role: 'competitor', c })), { domain: 'own', role: 'own', c: null }];
  const names = ps => ps.map(p => p.name);
  const short = f => f.split('/').slice(-2).join('/');
  for (const { domain, role, c } of list) {
    const ok = capPages.filter(p => String(p.domain).toLowerCase() === domain && p.status === 'ok');
    let mode = 'frames', pages;
    if (ok.length) {
      const order = [...new Set(ok.map(p => p.type))];
      pages = [...ok].sort((a, b) => (a.type === 'home' ? -1 : 0) - (b.type === 'home' ? -1 : 0) || order.indexOf(a.type) - order.indexOf(b.type));
    } else if (c) {
      mode = 'text';
      pages = (c.pages || []).filter(p => p && p.raw && ['ok', 'browser'].includes(p.status) && fs.existsSync(R(p.raw))).map(p => ({ name: path.basename(p.raw).replace(/\.json$/, ''), type: p.type, url: p.url, raw: p.raw.replace(/\\/g, '/') }));
    } else {
      // сайт заказчика без снятой главной: текстового снимка у него нет - не наблюдается, причина в limits
      limits.push(`сайт заказчика не наблюдался: ${ownReason(inp)}`);
      continue;
    }
    if (!pages.length) continue;
    const parts = [];
    const shotDir = p => rel('work/competitors/shots', role === 'own' ? 'own' : String(p.domain || domain), p.name);
    const files = p => (p.files || []).map(f => f.file);
    if (mode === 'frames') {
      const home = pages.find(p => p.type === 'home') || pages[0];
      const inner = pages.find(p => p !== home);
      const pick = (p, re) => (p ? files(p).filter(f => re.test(path.posix.basename(f))) : []);
      const shell = [...pick(home, /^(top|bottom|mobile)\.jpg$/), ...pick(inner, /^(top|bottom)\.jpg$/)];
      // первая страница каждого типа (страницы уже по порядку типов)
      const firsts = pages.filter((p, i) => pages.findIndex(q => q.type === p.type) === i);
      const others = firsts.filter(p => p !== home);
      const bodies = p => pick(p, /^body-\d+\.jpg$/);
      const all = [...shell, ...bodies(home), ...others.flatMap(bodies)];
      const dom = ps => ps.map(p => rel(shotDir(p), 'kf.json'));
      if (all.length <= IMAGES_MAX) parts.push({ part: 'all', pages: names(pages), body_pages: names(pages), images: all, dom: dom(pages) });
      else {
        // shell: шапка, подвал и мобильная главной, шапка и подвал внутренней, тело главной; тело внутренней - в types
        const p1 = [home, inner].filter(Boolean);
        const s1 = [...shell, ...bodies(home)];
        if (s1.length > IMAGES_MAX) limits.push(`${domain}: кадры не просмотрены (часть shell, лимит ${IMAGES_MAX}): ${s1.slice(IMAGES_MAX).map(short).join(', ')}`);
        parts.push({ part: 'shell', pages: names(p1), body_pages: [home.name], images: s1.slice(0, IMAGES_MAX), dom: dom(p1) });
        const rest = pages.filter(p => p !== home);
        if (rest.length) {
          // кадры тела первых страниц типов (и внутренней из shell) - по очереди, не больше 12
          const queues = others.map(bodies).filter(q => q.length);
          const imgs = [];
          for (let i = 0; imgs.length < IMAGES_MAX && queues.some(q => q.length > i); i++) for (const q of queues) if (q[i] && imgs.length < IMAGES_MAX) imgs.push(q[i]);
          const lost = queues.flat().filter(f => !imgs.includes(f));
          if (lost.length) limits.push(`${domain}: кадры не просмотрены (часть types, лимит ${IMAGES_MAX}): ${lost.slice(0, 8).map(short).join(', ')}${lost.length > 8 ? ` и еще ${lost.length - 8}` : ''}`);
          parts.push({ part: 'types', pages: names(rest), body_pages: names(rest), images: imgs, dom: dom(rest) });
        }
      }
    } else {
      // без кадров: текст снимков и DOM-находки по статическому html (capture-pages.mjs без Chrome, jsdom), если есть
      const dom = pages.map(p => rel('work/competitors/shots', String(c.domain), p.name, 'kf.json')).filter(f => fs.existsSync(R(...f.split('/'))));
      parts.push({ part: 'all', pages: names(pages), body_pages: names(pages), images: [], dom, raw: pages.map(p => p.raw) });
    }
    out[domain] = { role, mode, url: (pages[0] && pages[0].url) || '', parts };
    // устарело: нет файла, другой набор страниц, файл старше снимков
    const kfFile = R('work', 'competitors', 'kf', `${domain}.json`);
    const j = tryJson(kfFile);
    const want = pages.map(p => p.name).sort().join('|');
    const have = j ? (j.pages || []).map(p => p.name).sort().join('|') : null;
    const src = mode === 'frames' ? pages.map(p => R(...rel(shotDir(p), 'kf.json').split('/'))) : pages.map(p => R(...p.raw.split('/')));
    const newest = Math.max(0, ...src.map(mtime));
    if (!j || have !== want || mtime(kfFile) < newest) stale.push({ domain, role, parts: parts.map(p => p.part) });
  }
  return { plan: { generated_at: nowIso(), images_max: IMAGES_MAX, domains: out, limits }, stale };
}

export function writeStatus(root, status, extra = {}) {
  const f = path.join(root, 'work', 'kf', 'status.json');
  const s = { status, generated_at: nowIso(), ...extra };
  writeJson(f, s);
  return s;
}

function main() {
  const a = argv({ shell: 'bool', candidates: 'bool', 'stale-observers': 'bool', compact: 'bool' });
  const root = process.cwd();
  const matrixFile = P('work', 'kf', 'matrix.json');
  if (a.compact) {
    if (!a.type) { console.error('usage: kf-matrix.mjs --compact --type <t> [--min recommended]'); process.exit(2); }
    const m = tryJson(matrixFile);
    console.log(JSON.stringify(compactRows(m, String(a.type), a.min || 'optional')));
    return;
  }
  if (a.status) {
    const st = String(a.status);
    if (!['skip', 'no_competitors'].includes(st)) { console.error('--status: skip или no_competitors'); process.exit(2); }
    // skip и no_competitors: этап КФ не проведен (правило включения §3 - по наличию matrix.json), поэтому прежние
    // матрица, оболочка и кандидаты снимаются: агрегатор без строк КФ, kf-coverage и сборка не видят старую матрицу
    const removed = [matrixFile, P('work', 'shell.json'), P('work', 'kf', 'candidates.json')].filter(f => exists(f));
    for (const f of removed) fs.rmSync(f, { force: true });
    const s = writeStatus(root, st, a.reason ? { reason: String(a.reason) } : {});
    console.log(`work/kf/status.json: ${st}${removed.length ? `; сняты: ${removed.map(f => path.relative(root, f).split(path.sep).join('/')).join(', ')}` : ''}`);
    console.log('KF_STATUS ' + JSON.stringify({ status: s.status, changed: true, removed: removed.length }));
    return;
  }
  const inp = loadInputs(root);
  if (!inp.comp) { console.error('нет work/competitors/competitors.json'); process.exit(2); }
  if (a['stale-observers']) {
    const { plan, stale } = observePlan(inp);
    writeJson(P('work', 'kf', 'plan.json'), plan);
    for (const l of plan.limits) console.log(`limits: ${l}`);
    for (const [d, x] of Object.entries(plan.domains)) console.log(`${d}: ${x.mode === 'frames' ? 'кадры' : 'текст снимков'}, частей ${x.parts.length} (${x.parts.map(p => `${p.part}: страниц ${p.pages.length}, кадров ${p.images.length}`).join('; ')})${stale.some(s => s.domain === d) ? ' - наблюдать' : ' - свежий'}`);
    console.log('KF_STALE ' + JSON.stringify({ domains: stale }));
    return;
  }
  if (a.candidates) {
    const c = candidatesOf(inp);
    writeJson(P('work', 'kf', 'candidates.json'), c);
    const recheck = Object.keys(c.domains).filter(d => c.domains[d].length);
    console.log(`x-элементов: ${c.x.length} (без записи в aliases.json: ${c.x_unaliased}); перепроверка: ${recheck.map(d => `${d} (${c.domains[d].length})`).join(', ') || 'не нужна'}`);
    console.log('KF_CANDIDATES ' + JSON.stringify({ x: c.x.length, x_unaliased: c.x_unaliased, recheck }));
    return;
  }
  const m = buildMatrix(inp);
  writeJson(matrixFile, m);
  let shellN = null;
  if (a.shell) { const sh = shellOf(m); writeJson(P('work', 'shell.json'), sh); shellN = sh.items.length; }
  const noChrome = !!inp.capture && !inp.capture.chrome && m.mode !== 'frames';
  const cnt = l => m.rows.filter(r => r.level === l).length;
  const st = writeStatus(root, noChrome ? 'no_chrome' : 'done', { competitors: m.domains.filter(d => d.role === 'competitor').length, rows: m.rows.length, must: cnt('must'), recommended: cnt('recommended'), ...(shellN != null ? { shell_items: shellN } : {}), limits: m.limits.slice(0, 20) });
  console.log(`matrix.json: строк ${m.rows.length} (обязательно ${st.must}, рекомендовано ${st.recommended}, по желанию ${cnt('optional')}); конкурентов ${st.competitors}, режим ${m.mode}${shellN != null ? `; shell.json: элементов ${shellN}` : ''}`);
  for (const l of m.limits.slice(0, 15)) console.log(`limits: ${l}`);
  console.log('KF_MATRIX ' + JSON.stringify({ status: st.status, rows: m.rows.length, must: st.must, recommended: st.recommended, shell_items: shellN, limits: m.limits.length }));
}

const real = f => { try { return fs.realpathSync.native(path.resolve(f)).toLowerCase(); } catch { return ''; } };
if (process.argv[1] && real(process.argv[1]) === real(fileURLToPath(import.meta.url))) main();
