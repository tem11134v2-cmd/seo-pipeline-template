// Дайджест готового прототипа для аудитора сайта (фаза 8, wf-08-site-audit; без LLM, без разбора HTML и без jsdom).
// node scripts/site-digest.mjs [--shots]
// Модель сайта - buildSite из site-parts.mjs с теми же входами, что у build-html (карта, факты, стратегия, брифы, словарь,
// контакты, каталог, work/shell.json - если есть); тексты - файлы блоков (написан = lint pass, как в прототипе) и
// work/output/prototype.index.json; действия кнопок - actionAttrs и headerCtaAttrs по правилам сборщика (C10); оболочка и
// чипы - work/output/prototype.modules.json (ключ shell) и brief.stubs.
// Выход work/audit/site-digest.json:
//   routes[]      - по маршруту: slug, тип, H1, подзаголовок, кнопки {label, action, role main|secondary, block}, блоки
//                   {id, type, h2, first - первая фраза}, ненаписанные блоки, заглушки, нижняя панель телефона (mbar);
//   shell         - меню, шапка (кнопка с ролью header, телефон, каналы), подвал, элементы оболочки по пересечениям
//                   лидеров (state);
//   cta_labels    - ключ - нормализованное действие (lead, page:<slug>, anchor:<id блока типа>, messenger, call), в нем
//                   подписи кнопок блоков со счетом, страницами и ролями; старый формат CTA (в стратегии и брифах нет
//                   action) - одна группа legacy, ее cta-unify.mjs не трогает. Кнопки отправки формы не считаются;
//   trust_facts   - id факта -> страницы (по полям facts элементов написанных блоков), trust_wording - формулировки
//                   фактов, стоящих на 2+ страницах; chips - чипы «нужны данные» по зонам; h2_repeats - одинаковые h2
//                   на разных страницах; proto - sha данных прототипа и свежесть файла; shots - скриншоты.
// --shots: первые экраны главной и первой страницы каждого типа (1366 и 390) - capture-pages.mjs --file
//   work/output/prototype.html --routes ... --out work/audit/site-shots/ (не в git); нет Chrome или скрипта - без них.
// В консоль - до 30 строк, последняя - SITE_DIGEST {json}. Код 0; 2 - нет карты или прототипа не из чего собрать.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { argv, P, readJson, exists, writeJson, loadConfig, nowIso, splitSentences } from './lib.mjs';
import { loadUi, blockState, protoDataSha } from './render-blocks.mjs';
import * as parts from './site-parts.mjs';

export const OUT_REL = 'work/audit/site-digest.json';
export const SHOTS_REL = 'work/audit/site-shots';
// действия по контракту C3 (те же, что проверяют merge-strategy и build-briefs)
export const ACTION_RE = /^(lead|messenger|call|page:[a-z0-9][a-z0-9-]*|anchor:[a-z0-9][a-z0-9-]*)$/;
export const LEGACY = 'legacy';

const opt = f => { try { return exists(f) ? readJson(f) : null; } catch { return null; } };
// текст без разметки писателя: **жирный**, [ссылка](адрес), [[пометка]]
export const plain = s => String(s ?? '').replace(/\[\[[^\]]*\]\]/g, ' ').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[*_`]+/g, '').replace(/\s+/g, ' ').trim();
// ключ сравнения подписей: регистр, е с точками, пробелы, знаки на концах
export const normLabel = s => plain(s).toLowerCase().replace(/\u0451/g, '\u0435').replace(/[\s.,;:!?«»"-]+$/g, '').replace(/^[\s«»"-]+/, '').replace(/\s+/g, ' ');
const firstPhrase = s => { const t = plain(s); if (!t) return ''; const x = (splitSentences(t)[0] || t).trim(); return x.length > 160 ? x.slice(0, 157) + '...' : x; };
const TEXT_KINDS = ['sub', 'text', 'card', 'step', 'qa', 'quote', 'bullets'];
function firstOf(block) {
  for (const k of TEXT_KINDS) {
    const el = (block.elements || []).find(e => e.kind === k);
    if (!el) continue;
    const t = k === 'qa' ? el.a : k === 'bullets' ? (el.items || [])[0] : el.text || el.title;
    if (t) return firstPhrase(t);
  }
  return '';
}

// Ключ действия по атрибутам кнопки сборщика (C10): lead, messenger, call, page:<slug>, anchor:<id>, submit, external, other
export function actionKey(S, attrs) {
  if (!attrs) return '';
  const act = attrs['data-act'];
  if (act === 'lead') return 'lead';
  if (act === 'msg') return 'messenger';
  if (act === 'scroll') return `anchor:${attrs['data-target'] || ''}`;
  if (act === 'submit') return 'submit';
  if (act) return `act:${act}`;
  const h = String(attrs.href || '');
  if (/^tel:/i.test(h)) return 'call';
  if (h.startsWith('#/')) {
    const r = h.slice(1).split('?')[0];
    const x = S.pages.find(p => p.route === r);
    return x ? `page:${x.slug}` : 'other';
  }
  if (/^mailto:/i.test(h)) return 'email';
  if (/^https?:/i.test(h)) return S.mapsHref && h === S.mapsHref ? 'route' : 'external';
  return 'other';
}

async function loadContacts() {
  try { return await import(new URL('./contacts.mjs', import.meta.url).href); } catch { return null; }
}

export async function buildDigest({ shots = null } = {}) {
  const cfg = loadConfig();
  const sm = readJson(P('work', 'sitemap.json'));
  const facts = opt(P('work', 'facts.json')) || { facts: [], company: {} };
  const strategy = opt(P('work', 'strategy.json'));
  const catalogSpec = opt(P('work', 'catalog', 'catalog-spec.json'));
  const samples = opt(P('work', 'catalog', 'sample-items.json'));
  let shellSpec = opt(P('work', 'shell.json'));
  if (shellSpec && !Array.isArray(shellSpec.items)) shellSpec = null;
  const ui = loadUi(P('html', 'site', 'ui.json'));
  const contacts = await loadContacts();
  const briefs = {};
  for (const p of sm.pages || []) {
    if (!p || !p.slug || p.status === 'skip') continue;
    const b = opt(P('work', 'pages', p.slug, 'brief.json'));
    if (b) briefs[p.slug] = b;
  }
  const limits = [];
  let S;
  try { S = parts.buildSite({ cfg, sm, facts, strategy, briefs, ui, contacts, catalogSpec, samples, shellSpec }); }
  catch (e) {
    // оболочка по пересечениям не разобралась - модель без нее (чипы оболочки дайджест берет из prototype.modules.json)
    if (!shellSpec) throw e;
    limits.push(`модель сайта без work/shell.json: ${e.message}`);
    S = parts.buildSite({ cfg, sm, facts, strategy, briefs, ui, contacts, catalogSpec, samples });
  }
  const index = opt(P('work', 'output', 'prototype.index.json')) || {};
  const modules = opt(P('work', 'output', 'prototype.modules.json')) || {};

  // статусы блоков (как в прототипе: написан = файл блока и lint pass)
  const states = {};
  for (const x of S.pages) {
    const specs = x.brief && Array.isArray(x.brief.blocks) ? x.brief.blocks : [];
    states[x.slug] = specs.map(spec => ({ spec, ...blockState(x.slug, spec.block_id) }));
  }
  // лендинг: якоря и блок-форма главной - как в build-html (шапка и меню их читают)
  if (S.landing && S.home) {
    const st = states[S.home.slug] || [];
    S.landingTypes = new Set(st.map(s => s.spec.type));
    const f = st.find(s => s.state === 'written' && s.block.elements.some(e => e.kind === 'field'));
    S.landingForm = f ? f.spec.type : '';
    const cand = [];
    for (const s of st) {
      if (s.state !== 'written' || s.spec.role === 'hero' || /^hero/.test(String(s.spec.pattern || ''))) continue;
      const h2 = s.block.elements.find(e => e.kind === 'h2');
      const label = h2 ? plain(h2.text) : '';
      if (label && !cand.some(c => c.anchor === s.spec.type)) cand.push({ anchor: s.spec.type, label: label.length > 24 ? parts.navLabel({ nav_label: label }) : label });
    }
    S.landingAuto = cand.slice(0, 6);
  }

  // ---------- кнопки по правилам сборщика (build-html: buttonAttrs, blockCtx, нижняя панель)
  const defaultAttrs = (el, pc, spec, hasFields) => {
    if (hasFields) return { 'data-act': 'submit' };
    if (el && el.href) { const h = S.hrefFor(el.href); if (h) return { href: h }; }
    if (pc.formAnchor && pc.formAnchor !== spec.type) return { 'data-act': 'scroll', 'data-target': pc.formAnchor };
    return { 'data-act': 'lead' };
  };
  const byText = text => { if (!S.ctaLegacy) return null; const b = parts.secondaryByText(S, text); return b ? b.attrs : null; };
  function buttonAttrs(el, pc, spec, hasFields) {
    const text = String(el.text || '').trim();
    const c = pc.cta;
    const sec = String(c.secondary || '').trim();
    let r = null;
    if (c.action && text === String(c.main || '').trim()) r = parts.actionAttrs(S, c.action, pc);
    else if (c.secondary_action && text === sec) r = parts.actionAttrs(S, c.secondary_action, pc);
    else if (!c.secondary_action && sec && text === sec && !hasFields && !(el.href && S.hrefFor(el.href))) r = byText(text);
    return r || defaultAttrs(el, pc, spec, hasFields);
  }

  const routes = [];
  const labels = {};
  const trust = {};
  const h2s = new Map();
  const chips = { header: [], footer: [], mobile: [], fixed: [], body: [] };
  const addLabel = (key, label, slug, role) => {
    const g = (labels[key] ??= { total: 0, labels: [] });
    const n = normLabel(label);
    let e = g.labels.find(x => x.norm === n);
    if (!e) { e = { label: plain(label), norm: n, n: 0, pages: [], roles: [] }; g.labels.push(e); }
    e.n++; g.total++;
    if (!e.pages.includes(slug)) e.pages.push(slug);
    if (!e.roles.includes(role)) e.roles.push(role);
  };
  for (const x of S.pages) {
    const brief = x.brief;
    const st = states[x.slug] || [];
    const cta = parts.ctaObj(brief ? brief.cta : S.ctaByType[x.type]);
    const stubs = brief && Array.isArray(brief.stubs) ? brief.stubs.filter(z => z && z.type) : [];
    const formSt = st.find(s => s.state === 'written' && s.block.elements.some(e => e.kind === 'field'));
    const pc = { page: x, brief, cta, types: new Set([...st.map(s => s.spec.type), ...stubs.map(z => String(z.type))]), formAnchor: formSt ? formSt.spec.type : '' };
    if (x.listing) pc.types.add('listing');
    let heroIdx = st.findIndex(s => s.spec.role === 'hero');
    if (heroIdx < 0) heroIdx = st.findIndex(s => /^hero/.test(String(s.spec.pattern || '')));
    let finalIdx = -1;
    st.forEach((s, i) => { if (i !== heroIdx && s.state === 'written' && s.spec.cta_allowed !== false && s.block.elements.some(e => e.kind === 'button')) finalIdx = i; });
    const hero = heroIdx >= 0 && st[heroIdx].state === 'written' ? st[heroIdx].block : null;
    const h1El = hero && hero.elements.find(e => e.kind === 'h1');
    const subEl = hero && hero.elements.find(e => e.kind === 'sub');
    const buttons = [], blocks = [], missing = [];
    const secText = String(cta.secondary || '').trim();
    st.forEach((s, i) => {
      if (s.state !== 'written') { missing.push(s.spec.block_id); return; }
      const els = s.block.elements;
      const hasFields = els.some(e => e.kind === 'field');
      const h2 = els.find(e => e.kind === 'h2');
      const bfacts = [...new Set(els.flatMap(e => (Array.isArray(e.facts) ? e.facts : [])))];
      blocks.push({ id: s.spec.block_id, type: s.spec.type, ...(s.spec.role ? { role: s.spec.role } : {}), h2: h2 ? plain(h2.text) : '', first: firstOf(s.block), ...(bfacts.length ? { facts: bfacts } : {}) });
      for (const f of bfacts) { const list = (trust[f] ??= []); if (!list.includes(x.slug)) list.push(x.slug); }
      if (h2) { const k = normLabel(h2.text); if (k) { const e = h2s.get(k) || { h2: plain(h2.text), pages: [] }; if (!e.pages.includes(x.slug)) e.pages.push(x.slug); h2s.set(k, e); } }
      for (const el of els) {
        if (el.kind !== 'button') continue;
        const text = String(el.text || '').trim();
        if (!text) continue;
        const action = actionKey(S, buttonAttrs(el, pc, s.spec, hasFields));
        const role = el.layout === 'secondary' || (secText && text === secText) ? 'secondary' : 'main';
        buttons.push({ label: plain(text), action, role, block: s.spec.block_id });
      }
      // вторая (контурная) кнопка CTA, которую сборщик ставит рядом с главной в первом экране и финальном блоке
      const hasSec = !secText || els.some(e => (e.kind === 'button' || e.kind === 'link') && String(e.text || '').trim() === secText);
      if ((i === heroIdx || i === finalIdx) && !hasSec && !hasFields && els.some(e => e.kind === 'button')) {
        let r = cta.secondary_action ? parts.actionAttrs(S, cta.secondary_action, pc) : null;
        if (!r && !cta.secondary_action) r = byText(secText);
        if (!r) r = pc.formAnchor && pc.formAnchor !== s.spec.type ? { 'data-act': 'scroll', 'data-target': pc.formAnchor } : { 'data-act': 'lead' };
        buttons.push({ label: plain(secText), action: actionKey(S, r), role: 'secondary', block: s.spec.block_id, auto: true });
      }
    });
    for (const b of buttons) {
      if (S.ctaLegacy) { if (b.action !== 'submit') addLabel(LEGACY, b.label, x.slug, b.role); }
      else if (ACTION_RE.test(b.action)) addLabel(b.action, b.label, x.slug, b.role);
    }
    for (const z of stubs) chips.body.push({ page: x.slug, name: String(z.name || z.type), needs: Array.isArray(z.needs) ? z.needs : [] });
    let mbar = null;
    if (cta.main) {
      let r = cta.action ? parts.actionAttrs(S, cta.action, pc) : null;
      if (!r) r = pc.formAnchor ? { 'data-act': 'scroll', 'data-target': pc.formAnchor } : { 'data-act': 'lead' };
      mbar = { label: plain(cta.short || cta.main), action: actionKey(S, r) };
    }
    const idx = index[x.slug] || {};
    routes.push({
      route: x.route, slug: x.slug, type: x.type, title: x.title, ...(x.role ? { ui_role: x.role } : {}), ...(x.parent ? { parent: x.parent.slug } : {}),
      brief: !!brief, h1: h1El ? plain(h1El.text) : x.title, h1_from: h1El ? 'block' : 'page', sub: subEl ? plain(subEl.text) : '',
      cta: { main: plain(cta.main || ''), ...(cta.action ? { action: cta.action } : {}), ...(cta.secondary ? { secondary: plain(cta.secondary) } : {}), ...(cta.secondary_action ? { secondary_action: cta.secondary_action } : {}) },
      buttons, blocks, ...(missing.length ? { missing } : {}), ...(stubs.length ? { stubs: stubs.map(z => ({ type: z.type, name: z.name, after: z.after, needs: z.needs })) } : {}),
      ...(mbar ? { mbar } : {}), in_index: Object.keys(idx).length,
    });
  }

  // ---------- оболочка
  const menu = parts.buildMenu(S);
  const menuItems = (menu.items || []).map(it => ({ label: String(it.label || ''), ...(it.page ? { route: it.page.route, slug: it.page.slug } : {}), ...(it.anchor ? { anchor: it.anchor } : {}), ...(it.kind ? { kind: it.kind } : {}), children: Array.isArray(it.children) ? it.children.length : 0 }));
  const hc = S.homeCta || {};
  const shellItems = modules.shell && Array.isArray(modules.shell.items) ? modules.shell.items : [];
  for (const it of shellItems) if (it.state === 'chip' && chips[it.zone]) chips[it.zone].push({ id: it.id, name: it.name, level: it.level, coverage: it.coverage });
  const shell = {
    menu: { mode: menu.mode || '', items: menuItems },
    header: { cta: hc.main ? { label: plain(hc.short || hc.main), action: actionKey(S, parts.headerCtaAttrs(S)), role: 'header' } : null, phone: S.contacts.phones.length > 0, channels: S.contacts.channels.map(c => c.key) },
    footer: { legal: (S.legalPages || []).map(p => p.slug), email: !!S.contacts.email, address: !!S.contacts.address, hours: !!S.contacts.hours, requisites: !!(S.contacts.legal.inn || S.contacts.legal.ogrn) },
    kf: shellItems.map(it => ({ id: it.id, name: it.name, zone: it.zone, level: it.level, coverage: it.coverage, state: it.state, ...(it.niche ? { niche: true } : {}) })),
  };

  // ---------- сводные счетчики
  const ctaLabels = {};
  for (const [k, g] of Object.entries(labels)) {
    ctaLabels[k] = { total: g.total, variants: g.labels.length, labels: g.labels.sort((a, b) => b.n - a.n).map(({ norm, ...e }) => e) };
  }
  const withBrief = S.pages.filter(x => x.brief).map(x => x.slug);
  const trustSorted = Object.fromEntries(Object.entries(trust).sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0])));
  const byId = Object.fromEntries((facts.facts || []).filter(f => f && f.id).map(f => [f.id, f]));
  const trustWording = {};
  for (const [id, pages] of Object.entries(trustSorted)) if (pages.length >= 2 && byId[id]) trustWording[id] = String(byId[id].wording || byId[id].value || '');
  const h2Repeats = [...h2s.values()].filter(e => e.pages.length >= 2);

  // ---------- свежесть прототипа: sha данных в файле против текущих данных
  const protoFile = P('work', 'output', 'prototype.html');
  let built = '';
  if (exists(protoFile)) { const m = fs.readFileSync(protoFile, 'utf8').match(/<meta name="proto-data-sha" content="([0-9a-f]+)">/); built = m ? m[1] : ''; }
  const now = protoDataSha();
  const proto = { file: exists(protoFile), built_sha: built, data_sha: now, fresh: !!built && built === now };
  if (proto.file && !proto.fresh) limits.push('прототип старше данных (sha данных не совпал): дайджест - по текущим данным');

  // маршруты для скриншотов: главная и первая по карте страница каждого типа
  const seen = new Set();
  const shotRoutes = [];
  for (const x of [...(S.home ? [S.home] : []), ...S.pages]) {
    if (x.role || x.template || seen.has(x.type)) continue;
    seen.add(x.type);
    shotRoutes.push(x.route === '/' ? '#/' : `#${x.route}`);
  }

  const digest = {
    generated_at: nowIso(), landing: !!S.landing, cta_legacy: !!S.ctaLegacy, pages: S.pages.length, pages_with_brief: withBrief.length,
    proto, routes, shell, cta_labels: ctaLabels, trust_facts: trustSorted, trust_wording: trustWording,
    trust_all_pages: Object.entries(trustSorted).filter(([, p]) => withBrief.length > 1 && p.length === withBrief.length).map(([id]) => id),
    chips, h2_repeats: h2Repeats, shot_routes: shotRoutes, shots: shots || { status: 'skip', reason: 'без --shots' }, limits,
  };
  return digest;
}

// Скриншоты первых экранов прототипа (capture-pages.mjs --file): нет скрипта, прототипа или Chrome - статус с причиной
export function takeShots(routes) {
  const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'capture-pages.mjs');
  const proto = P('work', 'output', 'prototype.html');
  if (!exists(script)) return { status: 'skip', reason: 'нет scripts/capture-pages.mjs' };
  if (!exists(proto)) return { status: 'skip', reason: 'нет work/output/prototype.html' };
  const r = spawnSync(process.execPath, [script, '--file', 'work/output/prototype.html', '--routes', routes.join(','), '--out', `${SHOTS_REL}/`], { cwd: P(), encoding: 'utf8', timeout: 480000 });
  const line = String(r.stdout || '').split(/\r?\n/).reverse().find(l => l.startsWith('KF_PROTO '));
  let res = null;
  try { res = line ? JSON.parse(line.slice('KF_PROTO '.length)) : null; } catch { res = null; }
  if (r.status !== 0 || !res) return { status: 'error', reason: `capture-pages: код ${r.status}${r.error ? ` (${r.error.message})` : ''}` };
  if (!res.chrome) return { status: 'no_chrome', reason: 'нет Chrome или Edge - аудит без скриншотов', dir: SHOTS_REL };
  const rel = f => path.relative(P(), path.resolve(P(), f)).split(path.sep).join('/');
  return { status: 'ok', dir: SHOTS_REL, files: (res.shots || []).map(s => ({ route: s.route, files: (s.files || []).map(rel) })) };
}

async function main() {
  const a = argv({ shots: 'bool' });
  if (!exists(P('work', 'sitemap.json'))) { console.error('site-digest: нет work/sitemap.json'); process.exit(2); }
  let d = await buildDigest();
  if (!d.pages) { console.error('site-digest: в карте нет рабочих страниц'); process.exit(2); }
  if (a.shots) { d.shots = takeShots(d.shot_routes); }
  writeJson(P(...OUT_REL.split('/')), d);
  const L = [`site-digest: страниц ${d.pages} (с брифом ${d.pages_with_brief})${d.landing ? ', лендинг' : ''}${d.cta_legacy ? ', старый формат CTA (группа legacy)' : ''}; прототип ${d.proto.file ? (d.proto.fresh ? 'свежий' : 'старше данных') : 'не собран'}`];
  const multi = Object.entries(d.cta_labels).filter(([, g]) => g.variants > 1);
  L.push(`надписи действий: групп ${Object.keys(d.cta_labels).length}, с разными подписями ${multi.length}`);
  for (const [k, g] of multi.slice(0, 8)) L.push(`  ${k}: ${g.labels.map(l => `«${l.label}» ${l.n}`).join(', ')}`);
  const top = Object.entries(d.trust_facts).slice(0, 5).map(([id, p]) => `${id} ${p.length}`);
  L.push(`факты по страницам (топ): ${top.join(', ') || '-'}${d.trust_all_pages.length ? `; на всех страницах: ${d.trust_all_pages.join(', ')}` : ''}`);
  const nChips = Object.values(d.chips).reduce((s, l) => s + l.length, 0);
  L.push(`чипы «нужны данные»: ${nChips}${nChips ? ` (${Object.entries(d.chips).filter(([, l]) => l.length).map(([z, l]) => `${z} ${l.length}`).join(', ')})` : ''}; повторов h2 между страницами ${d.h2_repeats.length}`);
  L.push(`скриншоты: ${d.shots.status}${d.shots.reason ? ` - ${d.shots.reason}` : ''}`);
  for (const l of d.limits.slice(0, 5)) L.push(`ограничение: ${l}`);
  L.push(`дайджест: ${OUT_REL}`);
  console.log(L.slice(0, 29).join('\n'));
  console.log(`SITE_DIGEST ${JSON.stringify({ pages: d.pages, cta_groups: Object.keys(d.cta_labels).length, cta_multi: multi.map(([k]) => k), legacy: d.cta_legacy, shots: d.shots.status, routes: d.shot_routes })}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(e => { console.error(`site-digest: ${(e && e.stack) || e}`); process.exit(1); });
}
