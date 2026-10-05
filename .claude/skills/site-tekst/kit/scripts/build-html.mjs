// Сборка прототипа-сайта одним файлом. node scripts/build-html.mjs [--out work/output/prototype.html]
// Выход (контракт C10): work/output/prototype.html (сайт: шапка, меню, страницы, подвал, окна; служебный слой скрыт,
// включается клавишей D или ?debug), prototype.index.json ({slug: {block_id: текст}} - эталон дословности для
// check-html), prototype.modules.json ({модуль: {on, why, source}}).
// Вход: config/project.json (site: nav, off, tagline), work/sitemap.json, work/facts.json (company, публикуемые факты),
// work/strategy.json (cta_by_type), work/pages/<slug>/brief.json + blocks/*.json + work/audit/<slug>/lint-*.json,
// work/layouts/<type>.html, work/catalog/catalog-spec.json и sample-items.json (необязательно),
// html/site/{shell.html, site.css, ui.json, icons.svg}, rules/lint.json (маркеры утверждений для служебного слоя).
// Блоки писателя - дословно и в порядке брифа; блок без lint pass - скелет. Исключение из порядка одно: на странице
// с listing: true блок листинга идет сразу после компактного первого экрана.
// Правила сборщика поверх блоков писателя: блок pattern cta-band - карточка внутри контейнера (первая на странице
// темная); на странице info_contacts без блока с картой (адрес известен) - секция карты после первого экрана; вторая
// кнопка CTA без secondary_action - при старом формате CTA (Р6: в стратегии и брифах нет action) действие по подписи
// (канал, маршрут: site-parts secondaryByText), иначе правило C10; кнопки-ссылки без href - href="#" role="button";
// лендинг без якорей в config.site.nav - якоря из написанных блоков главной. Живые блоки проекта (K8) - реестр
// html/site/registry.json и html/site/behaviors/ (site-parts loadProjectRegistry).
// Оболочка по пересечениям лидеров (программа 05.10, раздел 3.5): work/shell.json (kf-matrix.mjs --shell) - элементы
// шапки, подвала, нижней панели и плавающих кнопок, чипы «нужны данные», кнопки-тосты; заглушки brief.stubs - секции
// без data-block-id (data-stub="1") с чипом. Нет shell.json - разметка, стили и скрипт как раньше, ключа shell в
// prototype.modules.json нет. Дата сборки для детерминизма тестов - переменная SITE_TEKST_BUILT_AT.
import path from 'node:path';
import { argv, P, readJson, readText, exists, writeText, writeJson, loadConfig, loadSitemap, pageDir, nowIso, PLACEHOLDER_RE, elementTexts, isListing } from './lib.mjs';
import { esc, icon, loadUi, makeEngine, blockState, protoDataSha, isKnownPattern } from './render-blocks.mjs';
import * as parts from './site-parts.mjs';

const a = argv({});
const out = a.out ? path.resolve(a.out) : P('work', 'output', 'prototype.html');
const warnings = [];
const warn = m => { if (!warnings.includes(m)) warnings.push(m); };
const relp = f => path.relative(process.cwd(), f).split(path.sep).join('/');
function opt(file) {
  if (!exists(file)) return null;
  try { return readJson(file); } catch (e) { warn(`${relp(file)}: не читается (${e.message})`); return null; }
}
function fail(msg) { console.error(`build-html: ${msg}`); process.exit(1); }

const cfg = loadConfig();
const sm = loadSitemap();
const facts = opt(P('work', 'facts.json')) || { facts: [], company: {} };
const strategy = opt(P('work', 'strategy.json'));
const catalogSpec = opt(P('work', 'catalog', 'catalog-spec.json'));
const samples = opt(P('work', 'catalog', 'sample-items.json'));
const lintRules = opt(P('rules', 'lint.json')) || {};
// оболочка по пересечениям лидеров: файла нет (этап КФ не проводился, старая задача) - прототип как раньше
let shellSpec = opt(P('work', 'shell.json'));
if (shellSpec && !Array.isArray(shellSpec.items)) { warn('work/shell.json: нет массива items - оболочка по пересечениям лидеров не строится'); shellSpec = null; }
// shell.json - снимок фазы 2: элементу словаря без page_match подсказка берется из текущего словаря задачи
// (config/kf-elements.json), чтобы правка словаря работала без пересчета матрицы; нишевые x-элементы не трогаются
if (shellSpec) {
  const dict = opt(P('config', 'kf-elements.json'));
  const pmById = new Map(((dict && Array.isArray(dict.elements)) ? dict.elements : []).filter(e => e && e.id && e.page_match).map(e => [e.id, e.page_match]));
  for (const it of shellSpec.items) if (it && !it.niche && !it.page_match && pmById.has(it.id)) it.page_match = pmById.get(it.id);
}
const HTML_DIR = P('html', 'site');
for (const f of ['shell.html', 'site.css', 'ui.json', 'icons.svg']) if (!exists(path.join(HTML_DIR, f))) fail(`нет html/site/${f} (kit не разложен в папку задачи: task.mjs place)`);
const ui = loadUi(path.join(HTML_DIR, 'ui.json'));
const t = ui.t;
let contacts = null;
try { contacts = await import(new URL('./contacts.mjs', import.meta.url).href); } catch { contacts = null; }

// брифы рабочих страниц
const briefs = {};
for (const p of sm.pages || []) {
  if (!p || !p.slug || p.status === 'skip') continue;
  const f = path.join(pageDir(p.slug), 'brief.json');
  if (exists(f)) { try { briefs[p.slug] = readJson(f); } catch (e) { warn(`${p.slug}: бриф не читается (${e.message})`); } }
}
const S = parts.buildSite({ cfg, sm, facts, strategy, briefs, ui, contacts, catalogSpec, samples, shellSpec });
if (!S.pages.length) fail('в карте нет рабочих страниц');
// реестр живых блоков проекта (K8): overrides/html/site/{registry.json, behaviors/} задачи лежат в html/site/ копии kit
const projReg = parts.loadProjectRegistry(HTML_DIR);
for (const p of projReg.problems) {
  if (p.code === 'js') warn(`html/site/behaviors/${p.file}: не выражение function (root, S) {...} или ошибка синтаксиса - поведение проекта пропущено`);
  else if (p.code === 'json') warn(`html/site/registry.json: не читается (${p.detail}) - реестр проекта пропущен`);
  else if (p.code === 'shape') warn('html/site/registry.json: ожидается объект { "<pattern | custom_name | type:<id>>": { "behavior": "<имя>" } } - реестр проекта пропущен');
  else if (p.code === 'no-behavior') warn(`html/site/registry.json: запись «${p.key}» без behavior - пропущена`);
  else if (p.code === 'unknown-behavior') warn(`html/site/registry.json: «${p.key}» ведет к поведению «${p.behavior}», но нет html/site/behaviors/${p.behavior}.js и такого поведения kit - запись пропущена`);
}
// фильтры спецификации с categories (K6): slug, которого нет среди рабочих страниц карты, - фильтр там не появится
if (catalogSpec && Array.isArray(catalogSpec.filters)) {
  for (const f of catalogSpec.filters) {
    const bad = (Array.isArray(f && f.categories) ? f.categories : []).map(String).filter(c => !S.bySlug.has(c));
    if (bad.length) warn(`catalog-spec: фильтр «${f.name}» - в categories нет таких страниц карты: ${bad.join(', ')}`);
  }
}

// примеры товаров и фото: встраиваются один раз - сначала первое фото каждого примера, затем остальные
const photos = parts.photoStore();
const items = S.catalogOn ? parts.sampleItems(S) : [];
for (const it of items) if (it.images[0]) photos.add(it.images[0]);
for (const it of items) for (const im of it.images.slice(1)) photos.add(im);
for (const s of photos.stats.skipped) warn(`фото примера ${s.path}: ${s.reason === 'missing' ? 'нет файла' : s.reason === 'type' ? 'не jpeg, png или webp' : s.reason === 'size' ? `${s.kb} КБ, больше предела` : s.reason === 'budget' ? 'сверх бюджета встроенных фото' : s.detail} - на его месте штриховка`);

let mapsUsed = 0;
const eng = makeEngine({
  ui, hrefFor: S.hrefFor, phoneDigits: S.contacts.phones.map(p => p.digits), email: S.contacts.email,
  claimMarkers: (lintRules.claim_markers || []).map(String), claimExcept: (lintRules.claim_markers_except || []).map(String),
  mapBox: () => { const b = parts.mapBoxHtml(S); if (b) mapsUsed++; return b; },
});

// статусы блоков всех страниц
const pageStates = {};
for (const x of S.pages) {
  const specs = x.brief && Array.isArray(x.brief.blocks) ? x.brief.blocks : [];
  pageStates[x.slug] = specs.map(spec => ({ spec, ...blockState(x.slug, spec.block_id) }));
}
// лендинг: якоря меню - типы блоков главной, кнопки ведут к блоку-форме
if (S.landing && S.home) {
  const st = pageStates[S.home.slug] || [];
  S.landingTypes = new Set(st.map(s => s.spec.type));
  const f = st.find(s => s.state === 'written' && s.block.elements.some(e => e.kind === 'field'));
  S.landingForm = f ? f.spec.type : '';
  // запасные якоря (config.site.nav не дал ни одного): написанные блоки главной кроме первого экрана, не больше 6,
  // блок-форма последним. Подпись - h2 блока, если он до 24 знаков; иначе имя по pattern из словаря (anchor_names);
  // иначе h2, обрезанный по слову до 24 знаков
  const names = ui.anchor_names || {};
  const cand = [];
  for (const s of st) {
    if (s.state !== 'written' || s.spec.role === 'hero' || /^hero/.test(String(s.spec.pattern || ''))) continue;
    const h2 = s.block.elements.find(e => e.kind === 'h2');
    const head = h2 ? eng.plainTitle(h2.text) : '';
    const dict = String(names[String(s.spec.pattern || '')] || '').trim();
    const label = head && head.length <= 24 ? head : dict || (head ? parts.navLabel({ nav_label: head }) : '');
    if (!label || cand.some(c => c.label.toLowerCase() === label.toLowerCase() || c.anchor === s.spec.type)) continue;
    cand.push({ anchor: s.spec.type, label, form: s.spec.type === S.landingForm });
  }
  const formA = cand.filter(c => c.form);
  S.landingAuto = [...cand.filter(c => !c.form).slice(0, 6 - formA.length), ...formA];
}

const menu = parts.buildMenu(S);
const header = parts.headerHtml(S, menu, photos);
const used = new Set(['form']);
const index = {};
const stats = { stubs: 0, briefPages: 0, files: 0, written: 0, missing: 0, lint: 0, placeholders: 0, fallback: [], formBlocks: 0, customRendered: 0, secondary: 0, secondaryDefault: 0, secondaryText: { channel: 0, route: 0 }, mapAdded: [], projectSections: 0 };
if (menu.navIgnored) warn('config.site.nav не дал пунктов меню (только якоря или неизвестные slug) - меню построено по карте');
const debugRows = [];

// ---------------------------------------------------------------- кнопки (C10)
function titled(r, text) { return r && r['data-act'] === 'lead' && !r['data-title'] ? { ...r, 'data-title': eng.plainTitle(text) } : r; }
function resolved(action, pc, text) {
  const r = parts.actionAttrs(S, action, pc);
  if (!r) warn(`${pc.page.slug}: действие кнопки «${action}» не разрешилось (нет цели, каналов или телефона) - правило по умолчанию`);
  return titled(r, text);
}
function defaultAttrs(el, pc, spec, hasFields, text) {
  if (hasFields) return { 'data-act': 'submit' };
  if (el && el.href) { const h = S.hrefFor(el.href); if (h) return /^https?:/i.test(h) ? { href: h, target: '_blank', rel: 'noopener' } : { href: h }; }
  if (pc.formAnchor && pc.formAnchor !== spec.type) return { 'data-act': 'scroll', 'data-target': pc.formAnchor };
  return { 'data-act': 'lead', 'data-title': eng.plainTitle(text) };
}
// вторая кнопка CTA без secondary_action (старые данные): действие по подписи (канал, маршрут) - parts.secondaryByText.
// Р6: только при старом формате CTA (S.ctaLegacy); в новых прогонах действие задает стратег, иначе правило C10
function byText(text) {
  if (!S.ctaLegacy) return null;
  const b = parts.secondaryByText(S, text);
  if (b) stats.secondaryText[b.kind]++;
  return b ? b.attrs : null;
}
function buttonAttrs(el, pc, spec, hasFields) {
  const text = String(el.text || '').trim();
  const c = pc.cta;
  const sec = String(c.secondary || '').trim();
  let r = null;
  if (c.action && text === String(c.main || '').trim()) r = resolved(c.action, pc, text);
  else if (c.secondary_action && text === sec) r = resolved(c.secondary_action, pc, text);
  // кнопка блока с подписью cta.secondary без secondary_action: поля формы и ссылка писателя важнее подписи
  else if (!c.secondary_action && sec && text === sec && !hasFields && !(el.href && S.hrefFor(el.href))) r = byText(text);
  return r || defaultAttrs(el, pc, spec, hasFields, text);
}
// секции с поведением из реестра проекта (K8) - для prototype.modules.json
function noteProject(spec, beh) { const r = parts.registryEntry(spec); if (r && r.project && beh.includes(r.behavior)) stats.projectSections++; }
function blockCtx(pc, spec, block, opts = {}) {
  const hasFields = block.elements.some(e => e.kind === 'field');
  const secText = String(pc.cta.secondary || '').trim();
  const hasSec = !secText || block.elements.some(e => (e.kind === 'button' || e.kind === 'link') && String(e.text || '').trim() === secText);
  // вторая кнопка - не в блоке с полями: там главная кнопка отправляет форму
  let secDone = !(opts.hero || opts.final) || hasSec || hasFields;
  let consentDone = !hasFields;
  const ctx = {
    step: 0, pc, heroMedia: !!opts.heroMedia, childTiles: opts.childTiles || '',
    button: (el, f) => {
      const cls = `btn${el.layout === 'secondary' ? ' secondary' : ''}`;
      const main = `<a class="${cls}"${parts.attrStr(parts.btnAttrs(buttonAttrs(el, pc, spec, hasFields)))}${f}>${eng.inline(el.text, false)}</a>`;
      // согласие под кнопкой отправки формы - строка словаря
      if (!consentDone) { consentDone = true; return `${main}<p class="consent">${esc(t('consent'))}</p>`; }
      if (secDone || el.layout === 'secondary') return main;
      secDone = true;
      // вторая кнопка CTA (контурная) рядом с главной - в первом экране и финальном блоке
      let r = pc.cta.secondary_action ? resolved(pc.cta.secondary_action, pc, secText) : null;
      stats.secondary++;
      // нет secondary_action - сначала узкий путь по подписи (канал, маршрут), затем правило по умолчанию
      if (!r && !pc.cta.secondary_action) r = byText(secText);
      if (!r) {
        // правило по умолчанию (старые данные без secondary_action): кнопка ведет к форме независимо от подписи - в отчет
        stats.secondaryDefault++;
        r = pc.formAnchor && pc.formAnchor !== spec.type ? { 'data-act': 'scroll', 'data-target': pc.formAnchor } : { 'data-act': 'lead', 'data-title': secText };
      }
      return `<div class="btn-row">${main}<a class="btn secondary"${parts.attrStr(parts.btnAttrs(r))}>${esc(secText)}</a></div>`;
    },
  };
  return ctx;
}

// ---------------------------------------------------------------- служебный слой
function plaque(spec, st) {
  const parts2 = [`<b>${esc(spec.block_id)}</b>`];
  if (spec.role) parts2.push(`${esc(t('debug_role'))}: ${esc(spec.role)}`);
  if (spec.pattern) parts2.push(`pattern: ${esc(spec.pattern)}`);
  if (spec.custom_name) parts2.push(`${esc(t('debug_custom'))}: ${esc(spec.custom_name)}`);
  if (spec.reader_question) parts2.push(`${esc(t('debug_question'))}: ${esc(spec.reader_question)}`);
  if (Array.isArray(spec.objection_ids) && spec.objection_ids.length) parts2.push(`${esc(t('debug_objections'))}: ${esc(spec.objection_ids.join(', '))}`);
  if (Array.isArray(spec.facts) && spec.facts.length) parts2.push(`${esc(t('debug_facts'))}: ${esc(spec.facts.join(', '))}`);
  parts2.push(esc(st.state === 'written' ? t('st_written') : st.state === 'lint' ? t('st_lint') : t('st_missing')));
  return `<aside class="dbg-plq">${parts2.join(' · ')}</aside>`;
}
function debugPage(x) {
  const b = x.brief;
  if (!b) return `<aside class="dbg-page">${esc(x.slug)} · ${esc(t('debug_type'))}: ${esc(x.type)} · ${esc(t('st_page_nobrief'))}</aside>`;
  const seg = b.segment && typeof b.segment === 'object' ? b.segment.name || b.segment.id || '' : '';
  const cta = parts.ctaObj(b.cta);
  return `<aside class="dbg-page">${esc(x.slug)} · ${esc(t('debug_type'))}: ${esc(x.type)} · ${esc(t('debug_set'))}: ${esc(b.block_set || '')}${seg ? ` · ${esc(t('debug_segment'))}: ${esc(seg)}` : ''}${cta.main ? ` · ${esc(t('debug_cta'))}: ${esc(cta.main)}` : ''}</aside>`;
}

// ---------------------------------------------------------------- страница
function crumbs(x) {
  const chain = [];
  for (let p = x.parent; p; p = p.parent) { if (chain.includes(p)) break; chain.unshift(p); }
  const list = [`<a href="#/">${esc(t('home'))}</a>`, ...chain.map(c => `<a href="#${esc(c.route)}">${esc(c.name || c.label)}</a>`), `<span>${esc(x.name || x.label)}</span>`];
  return `<nav class="crumbs" aria-label="${esc(t('crumbs'))}"><div class="container">${list.join('<i>/</i>')}</div></nav>`;
}
function sectionAttrs(spec, cls, extra = {}) {
  return parts.attrStr({ class: cls, 'data-block-id': spec.block_id, 'data-block-type': spec.type, 'data-anchor': spec.type, 'data-role': spec.role || null, 'data-pattern': spec.pattern || null, 'data-custom-name': spec.custom_name || null, ...extra });
}
function skeletonSection(x, st, cls, h1) {
  const reason = st.state === 'lint' ? 'lint' : 'missing';
  return `<section${sectionAttrs(st.spec, `${cls} skel`, { 'data-missing': '1', 'data-missing-reason': reason })}>${plaque(st.spec, st)}<div class="container">${eng.skeletonInner(st.spec, { h1 })}</div></section>`;
}
function countWritten(x, st) {
  stats.written++;
  stats.placeholders += (JSON.stringify(st.block.elements).match(PLACEHOLDER_RE) || []).length;
  (index[x.slug] ??= {})[st.spec.block_id] = st.block.elements.flatMap(el => elementTexts(el).map(tx => tx.text)).join('\n');
  if (st.block.elements.some(e => e.kind === 'field')) stats.formBlocks++;
  if (st.spec.pattern === 'custom' || !isKnownPattern(st.spec.pattern)) stats.customRendered++;
}
function listHead(x, st, pc) {
  if (st.state !== 'written') return skeletonSection(x, st, 'list-head', x.title);
  const ctx = blockCtx(pc, st.spec, st.block, { hero: true });
  const main = [], acts = [];
  let img = '';
  for (const el of st.block.elements) {
    if (el.kind === 'button' || el.kind === 'link') acts.push(eng.renderEl(el, ctx));
    else if (el.kind === 'image') img = `<div class="img lh-img"><span>${el.alt ? eng.inline(el.alt, false) : esc(t('photo_place'))}</span></div>`;
    else main.push(eng.renderEl(el, ctx));
  }
  countWritten(x, st);
  return `<section${sectionAttrs(st.spec, 'list-head blk-hero')}>${plaque(st.spec, st)}<div class="container"><div class="lh-row"><div class="lh-main">${main.join('\n')}</div>${acts.length ? `<div class="lh-acts">${acts.join('\n')}</div>` : ''}${img}</div></div></section>`;
}
function catalogSection(x, st, pc) {
  const spec = st ? st.spec : { block_id: 'catalog', type: 'catalog', pattern: 'listing' };
  const written = st && st.state === 'written';
  const block = written ? st.block : null;
  const ctx = block ? blockCtx(pc, spec, block, {}) : { step: 0, pc, button: null };
  const cat = parts.catalogHtml(S, x, block, eng, ctx, photos, items);
  used.add('catalog');
  if (block) countWritten(x, st);
  const miss = st && !written ? { 'data-missing': '1', 'data-missing-reason': st.state === 'lint' ? 'lint' : 'missing' } : {};
  const head = st && !written ? `<div class="sk"><div class="sk-name">${esc(t('block_wip'))}</div><i class="sk-h2"></i><i style="width:70%"></i></div>` : '';
  const attrsStr = st ? sectionAttrs(spec, 'blk blk-listing', { 'data-behavior': 'catalog', ...miss }) : parts.attrStr({ class: 'blk blk-listing', 'data-module': 'catalog', 'data-anchor': 'listing', 'data-behavior': 'catalog' });
  return `<section${attrsStr}>${st ? plaque(spec, st) : ''}<div class="container">${head}${cat.html}</div></section>`;
}
function wipSection(x) {
  const tiles = parts.navTiles(S, S.kids(x), photos);
  return `<section class="blk wip-sec"><div class="container"><div class="wip"><span class="wip-ico">${icon('clock')}</span><div><div class="wip-t">${esc(t('wip_title'))}</div><p>${esc(t('wip_text'))}</p><div class="wip-links"><a class="link-arrow" href="#/">${esc(t('go_home'))} ${icon('arrow')}</a></div></div></div>${tiles ? `<div style="margin-top:32px">${tiles}</div>` : ''}</div></section>`;
}
function renderPage(x) {
  const brief = x.brief;
  const states = pageStates[x.slug] || [];
  const cta = parts.ctaObj(brief ? brief.cta : S.ctaByType[x.type]);
  const formSt = states.find(s => s.state === 'written' && s.block.elements.some(e => e.kind === 'field'));
  // заглушки элементов лидеров (brief.stubs): вне blocks, после блока after; якорь anchor:<тип заглушки> валиден
  const stubs = brief && Array.isArray(brief.stubs) ? brief.stubs.filter(z => z && z.type) : [];
  const pc = { page: x, brief, cta, types: new Set([...states.map(s => s.spec.type), ...stubs.map(z => String(z.type))]), formAnchor: formSt ? formSt.spec.type : '' };
  const dark = ['home', 'service', 'hub'].includes(x.type);
  let heroIdx = states.findIndex(s => s.spec.role === 'hero');
  if (heroIdx < 0) heroIdx = states.findIndex(s => /^hero/.test(String(s.spec.pattern || '')));
  // магазин без страниц-листингов и без страницы товара (магазин-лендинг): карточки примеров - в блоке листинга главной,
  // нет такого блока - секцией каталога после первого экрана (минимум одна карточка в прототипе магазина)
  const shopHome = S.catalogOn && !S.listingPages.length && !S.productPage && x === S.home;
  const listIdx = x.listing || shopHome ? states.findIndex(s => isListing(s.spec)) : -1;
  let finalIdx = -1;
  states.forEach((s, i) => { if (i !== heroIdx && s.state === 'written' && s.spec.cta_allowed !== false && s.block.elements.some(e => e.kind === 'button')) finalIdx = i; });
  let lastFormIdx = -1;
  states.forEach((s, i) => { if (s.spec.pattern === 'form' || (s.state === 'written' && s.block.elements.some(e => e.kind === 'field'))) lastFormIdx = i; });
  // порядок: блоки брифа как есть; на странице с листингом блок листинга - сразу после первого экрана
  let order = states.map((_, i) => i);
  if (x.listing && listIdx >= 0 && heroIdx >= 0 && listIdx > heroIdx + 1) order =[...order.slice(0, heroIdx + 1), listIdx, ...order.slice(heroIdx + 1).filter(i => i !== listIdx)];
  // функциональные вставки страницы - сразу после первого экрана
  const extras = [];
  // секция каталога без блока листинга в брифе - якорь «listing» (action anchor:listing стратега разрешается и здесь)
  if ((x.listing || (shopHome && items.length)) && listIdx < 0) { extras.push(() => catalogSection(x, null, pc)); pc.types.add('listing'); }
  if (S.productPage === x) { extras.push(() => parts.productHtml(S, photos, items, cta)); used.add('product'); used.add('form'); }
  if (S.searchPage === x) { extras.push(() => parts.searchHtml(S)); used.add('search'); }
  if (S.cartPage === x) { const hub = S.listingPages.find(p => !p.parent) || S.listingPages[0]; extras.push(() => parts.cartHtml(S, pc.formAnchor, hub ? hub.route : '')); used.add('cart'); }
  if (S.accountPage === x) extras.push(() => parts.accountHtml(S));
  // страница контактов: адрес компании известен, а блока с картой нет (pattern map или слот карты в раскладке
  // написанного блока) - сборщик добавляет секцию карты после первого экрана (модуль map, why - prototype.modules.json)
  const mapInLayout = s => s.state === 'written' && /class="[^"]*\bmap\b/.test(eng.sectionOf(x.type, s.spec.type) || '');
  const autoMap = x.type === 'info_contacts' && !!S.mapsHref && !states.some(s => s.spec.pattern === 'map' || mapInLayout(s));
  const mapSec = cls => { const h = parts.mapSectionHtml(S, cls); if (h) { mapsUsed++; stats.mapAdded.push(x.slug); } return h; };

  let html = x.route !== '/' ? crumbs(x) : '';
  html += debugPage(x);
  if (!brief || !states.length) {
    html += `<section class="page-intro"><div class="container"><h1 data-ui="1">${esc(x.title)}</h1></div></section>`;
    html += extras.map(f => f()).join('\n');
    if (autoMap) html += mapSec('blk alt');
    if (!extras.length) html += wipSection(x);
  } else {
    stats.briefPages++;
    let alt = false, darkUsed = false, extrasDone = false;
    const placeExtras = () => {
      if (extrasDone) return;
      extrasDone = true;
      html += extras.map(f => f()).join('\n');
      // секция карты чередует фон как блок
      if (autoMap) { alt = !alt; html += mapSec(alt ? 'blk alt' : 'blk'); }
    };
    if (heroIdx < 0) { html += `<section class="page-intro"><div class="container"><h1 data-ui="1">${esc(x.title)}</h1></div></section>`; placeExtras(); }
    // порядок с заглушками: каждая - после своего блока after (нет такого блока - в конце страницы)
    const seq = order.map(i => ({ i }));
    for (const z of stubs) {
      let at = -1;
      seq.forEach((e, k) => { if ((e.i != null && states[e.i].spec.block_id === z.after) || (e.z && e.z.after === z.after && at >= 0)) at = k; });
      if (at < 0) seq.push({ z }); else seq.splice(at + 1, 0, { z });
    }
    for (const { i, z } of seq) {
      if (z) {
        alt = !alt;
        stats.stubs++;
        html += `<section${sectionAttrs({ type: String(z.type), block_id: null }, `blk blk-stub${alt ? ' alt' : ''}`, { 'data-stub': '1' })}><div class="container">${parts.stubHtml(S, z)}</div></section>`;
        continue;
      }
      const st = states[i];
      const spec = st.spec;
      if (st.state !== 'missing') stats.files++;
      if (st.state === 'lint') stats.lint++;
      if (st.state === 'missing') stats.missing++;
      if (i === heroIdx) {
        if (x.listing) html += listHead(x, st, pc);
        else if (st.state !== 'written') html += skeletonSection(x, st, `blk blk-hero${dark ? ' hero-dark' : ''}`, x.title);
        else {
          const ctx = blockCtx(pc, spec, st.block, { hero: true, heroMedia: dark });
          let { inner, viaLayout } = eng.renderBlock(x.type, spec, st.block, ctx);
          if (!viaLayout) stats.fallback.push(spec.type);
          if (dark) inner = eng.ensureHeroMedia(inner);
          const beh = parts.behaviorsOf(spec, st.block, inner); beh.forEach(b => used.add(b)); noteProject(spec, beh);
          html += `<section${sectionAttrs(spec, `blk blk-hero${dark ? ' hero-dark' : ''}`, beh.length ? { 'data-behavior': beh.join(' ') } : {})}>${plaque(spec, st)}<div class="container">${inner}</div></section>`;
          countWritten(x, st);
        }
        placeExtras();
        continue;
      }
      if (i === listIdx) { html += catalogSection(x, st, pc); continue; }
      let cls = 'blk';
      // призыв pattern cta-band - карточка внутри контейнера (как в визуальном эталоне), не полоса во всю ширину:
      // секция чередует фон как обычный блок; первая на странице - темная (.band.band-dark), следующие - светлые (.band)
      const band = spec.pattern === 'cta-band' && st.state === 'written' && i !== lastFormIdx;
      if (i === lastFormIdx) cls += ' blk-cta';
      else { alt = !alt; if (alt) cls += ' alt'; }
      if (band) cls += ' blk-band';
      if (st.state !== 'written') { html += skeletonSection(x, st, cls); continue; }
      const childTiles = isListing(spec) ? parts.navTiles(S, S.kids(x), photos) : '';
      const ctx = blockCtx(pc, spec, st.block, { final: i === finalIdx, childTiles });
      let { inner, viaLayout } = eng.renderBlock(x.type, spec, st.block, ctx);
      if (!viaLayout) stats.fallback.push(spec.type);
      // полосы раскладки внутри карточки гасятся стилями (.blk-band .band .band)
      if (band) { inner = `<div class="band${darkUsed ? '' : ' band-dark'}">${inner}</div>`; darkUsed = true; }
      const beh = parts.behaviorsOf(spec, st.block, inner); beh.forEach(b => used.add(b)); noteProject(spec, beh);
      html += `<section${sectionAttrs(spec, cls, beh.length ? { 'data-behavior': beh.join(' ') } : {})}>${plaque(spec, st)}<div class="container">${inner}</div></section>`;
      countWritten(x, st);
    }
    placeExtras();
  }
  // нижняя панель телефона - CTA этой страницы
  let mb = null;
  if (cta.main) {
    let r = cta.action ? parts.actionAttrs(S, cta.action, pc) : null;
    if (!r) r = pc.formAnchor ? { 'data-act': 'scroll', 'data-target': pc.formAnchor } : { 'data-act': 'lead', 'data-title': String(cta.main) };
    mb = { label: String(cta.short || cta.main), attrs: titled(r, cta.main) };
  }
  const written = states.filter(s => s.state === 'written').length;
  debugRows.push({ x, status: !brief ? t('st_page_nobrief') : written === states.length && states.length ? t('st_page_ready') : written ? t('st_page_partial') : t('st_page_wip') });
  const nav = x.parent ? topOf(x).route : x.route;
  return `<div class="page"${parts.attrStr({ 'data-route': x.route, 'data-slug': x.slug, 'data-type': x.type, 'data-title': x.title, 'data-nav': nav, 'data-cta': mb ? JSON.stringify(mb) : null })} hidden>\n${html}\n</div>`;
}
function topOf(x) { let p = x; while (p.parent) p = p.parent; return p; }

const pagesHtml = S.pages.map(renderPage).join('\n')
  + `\n<div class="page" data-route="404" data-type="404" data-title="${esc(t('not_found_title'))}" hidden><section class="page-intro"><div class="container"><h1 data-ui="1">${esc(t('not_found_title'))}</h1><p class="sub">${esc(t('not_found_text'))}</p><a class="btn" href="#/">${esc(t('go_home'))}</a></div></section></div>`;

// ---------------------------------------------------------------- данные для скрипта страницы
const factsMap = {};
const usedFacts = new Set(Object.values(pageStates).flat().filter(s => s.state === 'written').flatMap(s => s.block.elements.flatMap(e => (Array.isArray(e.facts) ? e.facts : []))));
for (const f of facts.facts || []) if (f && usedFacts.has(f.id) && f.publish !== 'no') factsMap[f.id] = String(f.wording || f.value || '');
const searchIdx = [];
for (const x of S.pages) if (!x.role && !x.template) searchIdx.push({ t: x.title, r: x.route, l: `${x.subject} ${x.label}`.toLowerCase() });
for (const it of items) {
  const cat = S.bySlug.get(it.cat);
  const r = S.productPage ? `${S.productPage.route}?item=${encodeURIComponent(it.key)}` : cat ? cat.route : '';
  if (r) searchIdx.push({ t: it.name, r, l: it.name.toLowerCase(), d: t('demo') });
}
const itemsData = {};
for (const it of items) itemsData[it.key] = { name: it.name, price: it.price, img: it.images[0] ? photos.get(it.images[0]) : null, site: it.site };
if (!items.length) itemsData._tpl = { name: t('tpl_name'), price: null, img: null, site: false };
const hc = S.homeCta;
const data = {
  brand: S.brand, homeTitle: S.brand + (S.tagline ? ` - ${S.tagline}` : ''), ui: ui.ui, facts: factsMap,
  searchRoute: S.searchPage ? S.searchPage.route : '', search: S.searchPage ? searchIdx : [],
  items: S.cartPage ? itemsData : {}, cart: S.cartPage ? { key: `${String(cfg.slug || 'site').replace(/[^a-z0-9-]/gi, '') || 'site'}-proto-cart-v1`, demo: Object.keys(itemsData)[0] } : {},
  homeCta: hc.main ? { label: String(hc.short || hc.main), attrs: parts.headerCtaAttrs(S) } : null,
};

// ---------------------------------------------------------------- сборка файла
const debugPanel = `<div class="dbg-panel"><b>${esc(t('debug_title'))}</b> · ${esc(t('debug_hint'))}<div>${esc(t('debug_pages'))}:</div><ul>${debugRows.map(r => `<li><a href="#${esc(r.x.route)}">${esc(r.x.name || r.x.label)}</a><span>${esc(r.status)}</span></li>`).join('')}</ul></div>`;
// стили и скрипт оболочки по пересечениям - между метками /*@shell*/ ... /*@/shell*/ (без shell.json вырезаются)
const shell = parts.shellCut(readText(path.join(HTML_DIR, 'shell.html')), !!S.shell);
if (S.shell && !/act === 'up'/.test(shell)) warn('html/site/shell.html (overrides задачи) не знает действия up: кнопка «наверх» оболочки не сработает');
// фото примеров - по одному правилу на файл: каждое встроено один раз, карточки ссылаются на класс
const projCss = parts.projectBehaviorCss(used);
const css = parts.shellCut(readText(path.join(HTML_DIR, 'site.css')), !!S.shell) + (projCss ? `\n${projCss}\n` : '') + (photos.css() ? `\n${photos.css()}\n` : '');
const letter = (S.brand || 'S').trim().charAt(0).toUpperCase();
const favicon = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' fill='#0e0e0e'/><text x='16' y='22.5' font-family='Arial,sans-serif' font-size='18' font-weight='700' fill='#ffffff' text-anchor='middle'>${esc(letter)}</text></svg>`)}`;
const map = {
  title: esc(S.brand || cfg.slug || ''),
  built_at: process.env.SITE_TEKST_BUILT_AT || nowIso(),
  proto_sha: protoDataSha(),
  favicon,
  contract: (ui.contract || []).map(l => `  ${String(l).replace(/--+/g, '-')}`).join('\n'),
  css,
  body_class: S.landing ? 'is-landing' : '',
  sprite: readText(path.join(HTML_DIR, 'icons.svg')).trim(),
  header: header.html + '\n' + parts.mobileNavHtml(S, menu) + '\n' + parts.mbarHtml(S) + (S.shell ? `\n${parts.shellFabHtml(S, menu)}` : ''),
  pages: pagesHtml,
  footer: parts.footerHtml(S, menu),
  overlays: parts.overlaysHtml(S, debugPanel),
  data: JSON.stringify(data).replace(/</g, '\\u003c'),
  behaviors: parts.behaviorsScript(used),
};
const unknown = [...new Set([...shell.matchAll(/\{\{(\w+)\}\}/g)].map(m => m[1]))].filter(k => !(k in map));
if (unknown.length) fail(`оболочка html/site/shell.html ждет неизвестные подстановки (${unknown.join(', ')}): она переопределена в overrides/ и не совместима с build-html`);
const html = shell.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in map ? map[k] : m));
writeText(out, html);
writeJson(out.replace(/\.html$/, '.index.json'), index);
const topFields = [S.contacts.address, S.contacts.hours, S.contacts.channels.some(c => c.href) ? 'ch' : ''].filter(Boolean).length;
const modules = parts.modulesJson(S, { navCount: header.navCount, megaCount: header.megaCount, menuMode: menu.mode, navIgnored: !!menu.navIgnored, topbarOn: header.topbarOn, topFields, items: items.length, photos: photos.stats, formBlocks: stats.formBlocks, maps: mapsUsed, mbar: !!parts.mbarHtml(S), catalogHome: !S.listingPages.length && used.has('catalog'), secondaryTotal: stats.secondary, secondaryDefault: stats.secondaryDefault, secondaryText: stats.secondaryText, mapAdded: stats.mapAdded, anchorsAuto: !!menu.anchorsAuto, projectRegistry: { keys: projReg.keys, behaviors: projReg.behaviors, sections: stats.projectSections }, stubs: stats.stubs });
writeJson(out.replace(/\.html$/, '.modules.json'), modules);

if (stats.secondaryDefault) warn(`вторых кнопок CTA без cta.secondary_action: ${stats.secondaryDefault} - ведут к блоку-форме или окну заявки независимо от подписи (prototype.modules.json cta_secondary)`);
for (const w of warnings) console.warn(`внимание: ${w}`);
if (stats.fallback.length) console.log(`без раскладки: ${stats.fallback.length} блоков (${[...new Set(stats.fallback)].join(', ')}) - собраны раскладкой по умолчанию для pattern`);
const skel = stats.missing + stats.lint;
const onMods = Object.entries(modules).filter(([, v]) => v.on).map(([k]) => k);
if (modules.shell) console.log(`оболочка: ${modules.shell.why}`);
else if (stats.stubs) console.log(`заглушек блоков лидеров: ${stats.stubs}`);
console.log(`прототип: ${relp(out)} - страниц ${stats.briefPages}, блоков ${stats.files} (текстом ${stats.written}, скелетов ${skel}: не написано ${stats.missing}, не прошли линтер ${stats.lint}), маршрутов ${S.pages.length}, плейсхолдеров ${stats.placeholders}, модули: ${onMods.join(', ')}, размер ${(Buffer.byteLength(html) / 1024).toFixed(0)} КБ`);
