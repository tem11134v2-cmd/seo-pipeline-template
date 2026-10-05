// Хром и модули прототипа-сайта - только из данных проекта: карта -> маршруты и меню (мега-панели, группировка по
// типу, «Еще»), шапка, подвал, мобильное меню и нижняя панель, окна; каталог и примеры товаров (контракт C5),
// поиск, корзина, кабинет; реестр поведений (pattern -> { render?, behavior, script? }) и prototype.modules.json.
// Модуля без данных в файле нет вовсе. Подписи интерфейса - из html/site/ui.json (ui.t), кириллицы в литералах нет.
// Новый живой блок kit = одна запись в REGISTRY (ключ 'type:<id блока типа>' или pattern; behavior и script) + стили в
// html/site/site.css. Живой блок одного проекта (K8) - без форка: overrides/html/site/registry.json
// ({ "<pattern | custom_name | type:<id>>": { "behavior": "<name>", "requires"? } }) и overrides/html/site/behaviors/<name>.js
// (function (root, S) {...}) плюс необязательный <name>.css рядом; сливаются с реестром kit (loadProjectRegistry).
import fs from 'node:fs';
import path from 'node:path';
import { P, exists } from './lib.mjs';
import { esc, icon } from './render-blocks.mjs';
import { noPhone, absentOf, ABSENT_FIELDS } from './absent.mjs';

// ---------------------------------------------------------------- адреса и маршруты
// путь без схемы и хоста, без query и хеша, без слеша на конце; пусто - «/»
export function normUrl(u) {
  let s = String(u ?? '').trim();
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, '').split(/[?#]/)[0].replace(/\/+$/, '');
  if (s && !s.startsWith('/')) s = '/' + s;
  return s || '/';
}
export const isTemplate = p => !!p && (p.template === true || /\{[^}]*\}|\[[^\]]*\]/.test(String(p.url || '')) || /-slug$/.test(normUrl(p.url)));
export const routeFor = p => normUrl(p.url).replace(/\{[^}]*\}|\[[^\]]*\]/g, 'item').replace(/-slug$/, '-item');
export const ctaObj = x => (typeof x === 'string' ? { main: x } : (x && typeof x === 'object' ? { ...x } : {}));
const ROLES = new Set(['search', 'cart', 'account', 'legal']);
export const NAV_MAX = 7;
export const NAV_CHARS = 72;
const LABEL_MAX = 24;
// короткие служебные слова (предлоги, союзы) - словарь ui.json lang.nbsp_words; обрезка подписи на них не кончается
let TAIL_STOP = new Set();
export function setTailStop(words) { TAIL_STOP = new Set((Array.isArray(words) ? words : []).map(w => String(w).toLowerCase())); }
// название страницы для h1 интерфейса, document.title, плиток и поиска: subject до « / » без скобок (без обрезки)
export function pageTitle(p) {
  const s = String(p.subject || p.slug || '').split(' / ')[0].replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
  return s || String(p.subject || p.slug || '').trim();
}
// подпись пункта строки меню: nav_label (до 24 знаков), иначе название страницы, обрезка по слову до 24 знаков
export function navLabel(p) {
  const nl = String(p.nav_label || '').trim();
  if (nl) return nl.length > LABEL_MAX ? cutWords(nl, LABEL_MAX) : nl;
  return cutWords(pageTitle(p), LABEL_MAX);
}
// подпись в списках, где строка переносится (плитки и колонки мега-панели, мобильное меню, подвал, крошки):
// nav_label, иначе название страницы целиком - обрезка оставила бы висящее «Ремонт квартир на»
export function listLabel(p) { return String(p.nav_label || '').trim() ? navLabel(p) : pageTitle(p); }
function cutWords(s, n) {
  if (s.length <= n) return s;
  const w = s.slice(0, n + 1).split(' ');
  if (w.length > 1) w.pop();
  // хвост без предлога и без висящего знака (« -», «/», «=>»)
  while (w.length > 1 && (TAIL_STOP.has(w[w.length - 1].toLowerCase().replace(/[,.;:]+$/, '')) || !/[\p{L}\p{N}]/u.test(w[w.length - 1]))) w.pop();
  const r = w.join(' ').replace(/[,.;:]+$/, '');
  return r.length >= 4 ? r : s.slice(0, n);
}
const attrs = o => Object.entries(o || {}).filter(([, v]) => v != null && v !== false).map(([k, v]) => (v === true ? ` ${k}` : ` ${k}="${esc(v)}"`)).join('');
export const attrStr = attrs;
// атрибуты кнопки-ссылки <a class="btn">: без своего href (действие data-act) - href="#" и role="button", иначе элемент
// не получает фокус с клавиатуры (check-html: html.a11y-focus). Переход по «#» гасит обработчик клика оболочки.
export const btnAttrs = o => (o && o.href ? o : { ...(o || {}), href: '#', role: 'button' });

// ---------------------------------------------------------------- контакты (contacts.mjs, если он есть в kit)
const digitsOf = s => { const d = String(s || '').replace(/\D/g, ''); if (d.length === 11 && (d[0] === '7' || d[0] === '8')) return '7' + d.slice(1); if (d.length === 10 && /^[3489]/.test(d)) return '7' + d; return d; };
function fmtPhoneLocal(s) { const d = digitsOf(s); return d.length === 11 && d[0] === '7' ? `+7 (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7, 9)}-${d.slice(9, 11)}` : String(s || '').trim(); }
function telLocal(s) { const d = digitsOf(s); return d.length >= 8 ? `tel:+${d}` : ''; }
function channelsLocal(company) {
  const out = {};
  for (const [k, v] of Object.entries((company && company.channels) || {})) {
    if (typeof v === 'string') out[k] = { label: k, value: v, href: /^https?:\/\//i.test(v) ? v : '' };
    else if (v && typeof v === 'object') out[k] = { label: String(v.label || k), value: String(v.value || v.href || ''), href: /^https?:\/\//i.test(String(v.href || '')) ? String(v.href) : '' };
  }
  return out;
}
export function readContacts(facts, contacts) {
  const company = (facts && facts.company) || {};
  const fmt = contacts && contacts.phoneFormat ? contacts.phoneFormat : fmtPhoneLocal;
  const tel = contacts && contacts.telHref ? contacts.telHref : telLocal;
  const dig = contacts && contacts.phoneDigits ? contacts.phoneDigits : digitsOf;
  const phones = company.no_phone === true ? [] : (Array.isArray(company.phones) ? company.phones : []).map(s => ({ raw: s, text: fmt(s), href: tel(s), digits: dig(s) })).filter(x => x.text && x.href);
  let ch = {};
  try { ch = contacts && contacts.buildChannels ? contacts.buildChannels((facts && facts.facts) || [], company) : channelsLocal(company); } catch { ch = channelsLocal(company); }
  // text - значение для строки подвала: номер телефона в едином формате или ник; ссылка (URL) строкой не выводится -
  // такой канал виден значком
  const chText = v => (/^[\d\s()+.-]{7,}$/.test(v) ? fmt(v) : /^(https?:\/\/|www\.)|\.[a-z]{2,}\//i.test(v) ? '' : v);
  const channels = Object.entries(ch || {}).map(([key, v]) => ({ key, label: String((v && v.label) || key), value: String((v && v.value) || ''), href: v && /^https?:\/\//i.test(String(v.href || '')) ? String(v.href) : '' })).filter(c => c.href || c.value).map(c => ({ ...c, text: chText(c.value) }));
  return {
    brand: '', company, phones, channels,
    email: String(company.email || '').trim(), address: String(company.address || '').trim(), hours: String(company.hours || '').trim(),
    legal: { name: String(company.legal_name || '').trim(), inn: String(company.inn || '').trim(), ogrn: String(company.ogrn || '').trim() },
  };
}

// ---------------------------------------------------------------- фото примеров: встраиваются один раз (класс на фото)
const SIG = [[/^ffd8ff/, 'image/jpeg'], [/^89504e47/, 'image/png'], [/^52494646........57454250/, 'image/webp']];
export function photoStore({ budget = 2 * 1024 * 1024, perFile = 300 * 1024 } = {}) {
  const byPath = new Map();
  const css = [];
  const st = { wanted: 0, embedded: 0, bytes: 0, skipped: [] };
  function add(relPath) {
    const key = String(relPath || '');
    if (!key) return null;
    if (byPath.has(key)) return byPath.get(key);
    st.wanted++;
    let cls = null;
    try {
      const f = P(key);
      if (!exists(f)) { st.skipped.push({ path: key, reason: 'missing' }); byPath.set(key, null); return null; }
      const buf = fs.readFileSync(f);
      const head = buf.subarray(0, 12).toString('hex');
      const type = (SIG.find(([re]) => re.test(head)) || [])[1];
      if (!type) st.skipped.push({ path: key, reason: 'type' });
      else if (buf.length > perFile) st.skipped.push({ path: key, reason: 'size', kb: Math.round(buf.length / 1024) });
      else if (st.bytes + buf.length > budget) st.skipped.push({ path: key, reason: 'budget' });
      else {
        cls = `pi-${css.length + 1}`;
        css.push(`.${cls}{background-image:url(data:${type};base64,${buf.toString('base64')})}`);
        st.bytes += buf.length; st.embedded++;
      }
    } catch (e) { st.skipped.push({ path: key, reason: 'error', detail: e.message }); }
    byPath.set(key, cls);
    return cls;
  }
  return { add, get: k => byPath.get(String(k || '')) || null, css: () => css.join('\n'), stats: st };
}

// ---------------------------------------------------------------- модель сайта
// { cfg, sm, facts, strategy, briefs: { slug: brief }, ui, contacts, shellSpec? } - shellSpec (work/shell.json, программа
// 05.10) необязателен: без него S.shell = null и разметка прежняя (check-html зовет без него)
export function buildSite({ cfg, sm, facts, strategy, briefs, ui, contacts, catalogSpec, samples, shellSpec = null }) {
  const t = ui.t;
  setTailStop(ui.lang && ui.lang.nbsp_words);
  const site = cfg.site && typeof cfg.site === 'object' ? cfg.site : {};
  const off = new Set((Array.isArray(site.off) ? site.off : []).map(String));
  const btype = String((cfg.niche && cfg.niche.business_type) || '');
  const catalogOn = btype !== 'services' && !off.has('catalog');
  const all = Array.isArray(sm.pages) ? sm.pages : [];
  const working = all.filter(p => p && p.slug && p.status !== 'skip');
  const homeP = working.find(p => p.type === 'home') || working.find(p => normUrl(p.url) === '/') || null;
  // маршруты; у главной всегда «/» (адрес вида /ru - тоже: на «/» ведут логотип и крошки)
  const routeBySlug = new Map();
  const usedRoutes = new Set(['404']);
  for (const p of [...(homeP ? [homeP] : []), ...working.filter(p => p !== homeP)]) {
    let r = p === homeP ? '/' : routeFor(p);
    if (usedRoutes.has(r)) { let n = 2; while (usedRoutes.has(`${r}-${n}`)) n++; r = `${r}-${n}`; }
    usedRoutes.add(r); routeBySlug.set(p.slug, r);
  }
  const byUrl = new Map();
  for (const p of working) if (!byUrl.has(normUrl(p.url))) byUrl.set(normUrl(p.url), p);
  // главная - не родитель: у карты с языковым префиксом главная живет по адресу вида /ru (import-structure), и parent
  // «/ru» у страниц первого уровня иначе сделал бы их детьми главной - меню осталось бы пустым
  function parentOf(p) {
    if (p === homeP) return null;
    const pu = String(p.parent || '').trim();
    if (pu) {
      const n = normUrl(pu);
      if (n === '/') return null;
      const hit = byUrl.get(n);
      if (hit === homeP) return null;
      if (hit && hit !== p) return hit;
    }
    // пустой parent у страницы не верхнего уровня или parent не найден - ближайший предок по префиксу адреса
    if (!pu && !(Number(p.level) > 0)) return null;
    let u = normUrl(p.url);
    while (u.lastIndexOf('/') > 0) { u = u.slice(0, u.lastIndexOf('/')); const hit = byUrl.get(u); if (hit && hit !== p && hit !== homeP) return hit; }
    return null;
  }
  const pages = working.map(p => ({
    p, slug: p.slug, route: routeBySlug.get(p.slug), type: p.type, subject: String(p.subject || p.slug), title: pageTitle(p),
    role: ROLES.has(p.ui_role) ? p.ui_role : '', template: isTemplate(p), label: navLabel(p), name: listLabel(p),
    listing: catalogOn && p.listing === true && p.type !== 'product', brief: (briefs && briefs[p.slug]) || null,
  }));
  const bySlug = new Map(pages.map(x => [x.slug, x]));
  for (const x of pages) { const par = parentOf(x.p); x.parent = par ? bySlug.get(par.slug) : null; }
  for (const x of pages) x.children = pages.filter(c => c.parent === x);
  const home = homeP ? bySlug.get(homeP.slug) : null;
  const navOk = x => !x.role && !x.template;
  const kids = x => x.children.filter(navOk);
  // потомки страницы для меню (дети, внуки и глубже) в порядке карты: { x, depth } (depth 1 - дети)
  const descendants = x => {
    const out = [], seen = new Set([x]);
    const walk = (y, d) => { for (const c of kids(y)) { if (seen.has(c)) continue; seen.add(c); out.push({ x: c, depth: d }); walk(c, d + 1); } };
    walk(x, 1);
    return out;
  };
  const content = pages.filter(x => x.role !== 'legal');
  const landing = content.length === 1;
  const findRole = r => (off.has(r) ? null : pages.find(x => x.role === r) || null);
  const searchPage = landing ? null : findRole('search');
  const cartPage = landing ? null : findRole('cart');
  const accountPage = landing ? null : findRole('account');
  const legalPages = all.filter(p => p && p.ui_role === 'legal');
  const productPage = catalogOn && !off.has('product') ? pages.find(x => x.type === 'product') || null : null;
  const listingPages = pages.filter(x => x.listing);
  const siteHost = (() => { try { return cfg.site_url ? new URL(/^https?:\/\//i.test(cfg.site_url) ? cfg.site_url : `https://${cfg.site_url}`).hostname.replace(/^www\./, '') : ''; } catch { return ''; } })();

  // ссылка писателя -> маршрут сайта, внешний адрес или null (страницы нет в прототипе - текст без ссылки)
  function hrefFor(h) {
    const s = String(h ?? '').trim();
    if (!s || s === '#') return null;
    if (/^(tel|mailto):/i.test(s)) return s;
    if (/^https?:\/\//i.test(s)) {
      let host = '';
      try { host = new URL(s).hostname.replace(/^www\./, ''); } catch { return null; }
      if (siteHost && host === siteHost) { const x = byUrl.get(normUrl(s)); return x ? `#${routeBySlug.get(x.slug)}` : null; }
      return s;
    }
    if (s.startsWith('#/')) { const r = s.slice(1).split('?')[0]; return usedRoutes.has(r) ? s : null; }
    if (s.startsWith('/')) { const x = byUrl.get(normUrl(s)); return x ? `#${routeBySlug.get(x.slug)}` : null; }
    return null;
  }

  // контакты
  const cc = readContacts(facts, contacts);
  const brand = String(cc.company.brand || cfg.company || cfg.slug || '').trim();
  const ctaByType = (strategy && strategy.global && strategy.global.cta_by_type) || {};
  const homeCta = ctaObj((home && home.brief && home.brief.cta) || ctaByType.home || Object.values(ctaByType)[0]);
  // Р6: старый формат CTA - ни в стратегии (cta_by_type, pages[].cta), ни в брифах нет объекта CTA с action или
  // secondary_action. Только тогда вторая кнопка без secondary_action ищет действие по подписи (secondaryByText) -
  // узкий запасной путь для данных до контракта C3; в новых прогонах действие задает стратег.
  const hasAction = c => !!c && typeof c === 'object' && !Array.isArray(c) && !!(String(c.action || '').trim() || String(c.secondary_action || '').trim());
  const allCtas = [...Object.values(ctaByType), ...Object.values((strategy && strategy.pages) || {}).map(x => x && x.cta), ...Object.values(briefs || {}).map(b => b && b.cta)];
  const ctaLegacy = !allCtas.some(hasAction);
  const mapsUrl = String((ui.maps && ui.maps.url) || '');
  const mapsHref = cc.address && mapsUrl && !off.has('map') ? mapsUrl + encodeURIComponent(cc.address) : '';
  // прочие реквизиты для подвала: публикуемые факты kind legal с номером регистрации (лицензия, учет, реестр: знак
  // номера или 6+ цифр подряд), кроме юрлица с ИНН/ОГРН (оно уже в строке реквизитов); условия вроде гарантий - не реквизиты
  const lg = cc.legal;
  const legalExtra = ((facts && Array.isArray(facts.facts)) ? facts.facts : [])
    .filter(f => f && f.kind === 'legal' && f.publish === 'yes' && /№|\d{6,}/.test(String(f.value || '')))
    .map(f => String(f.wording || f.value || '').trim())
    .filter(s => s && !(lg.inn && s.includes(lg.inn)) && !(lg.ogrn && s.includes(lg.ogrn)) && !(lg.name && s.includes(lg.name)))
    .slice(0, 4);

  const S = {
    cfg, off, catalogOn, btype, pages, bySlug, home, landing, navOk, kids, descendants, searchPage, cartPage, accountPage, legalPages,
    productPage, listingPages, hrefFor, routeBySlug, usedRoutes, byUrl, brand, contacts: cc, homeCta, ctaByType, ctaLegacy, mapsHref, legalExtra,
    tagline: String(site.tagline || '').trim(), nav: Array.isArray(site.nav) ? site.nav : null, siteHost, catalogSpec, samples,
    t, ui, allPages: all,
  };
  S.shell = shellSpec ? shellPlan(S, shellSpec, facts) : null;
  return S;
}

// ---------------------------------------------------------------- действия кнопок (C3, C10)
// action: lead | page:<slug> | anchor:<id блока типа> | messenger | call. Возврат - объект атрибутов или null (неверное).
export function actionAttrs(S, action, pc) {
  const a = String(action || '').trim();
  if (!a) return null;
  if (a === 'lead') return { 'data-act': 'lead' };
  if (a === 'messenger') return S.contacts.channels.length && !S.off.has('messengers') ? { 'data-act': 'msg' } : null;
  if (a === 'call') return S.contacts.phones[0] ? { href: S.contacts.phones[0].href } : null;
  if (a.startsWith('page:')) { const x = S.bySlug.get(a.slice(5)); return x && x.route ? { href: `#${x.route}` } : null; }
  if (a.startsWith('anchor:')) { const id = a.slice(7); return pc && pc.types && pc.types.has(id) ? { 'data-act': 'scroll', 'data-target': id } : null; }
  return null;
}
// Вторая кнопка CTA без secondary_action (старые данные) - узкий запасной путь по подписи, до правила по умолчанию C10.
// Р6: сборщик зовет его только при старом формате CTA (S.ctaLegacy: в стратегии и брифах нет ни одного action и
// secondary_action), это исключение из «ctaAttrs по словам кнопки» (раздел 4 программы 27.09, ADR-044).
// Основной путь - action от стратега; здесь только два случая, оба по данным проекта:
// - подпись содержит точное имя канала из company.channels (label целым словом, без учета регистра) - кнопка открывает
//   этот канал: его ссылка, а у канала без ссылки - окно каналов;
// - подпись содержит основу из ui.json lang.cta_route_words и известен адрес компании - ссылка на карту «Построить
//   маршрут» (та же, что в подвале).
// Возврат { kind: 'channel' | 'route', attrs } или null (действует правило C10).
const wordIn = (text, word) => new RegExp(`(^|[^\\p{L}\\p{N}])${String(word).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^\\p{L}\\p{N}])`, 'iu').test(text);
const stemIn = (text, stem) => new RegExp(`(^|[^\\p{L}\\p{N}])${String(stem).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'iu').test(text);
export function secondaryByText(S, text) {
  const s = String(text || '').trim();
  if (!s) return null;
  if (!S.off.has('messengers')) {
    for (const c of S.contacts.channels) {
      const label = String(c.label || '').trim();
      if (!label || !wordIn(s, label)) continue;
      return { kind: 'channel', attrs: c.href ? { href: c.href, target: '_blank', rel: 'noopener' } : { 'data-act': 'msg' } };
    }
  }
  const stems = ((S.ui && S.ui.lang && S.ui.lang.cta_route_words) || []).map(w => String(w).trim()).filter(Boolean);
  if (S.mapsHref && stems.some(w => stemIn(s, w))) return { kind: 'route', attrs: { href: S.mapsHref, target: '_blank', rel: 'noopener' } };
  return null;
}

// ---------------------------------------------------------------- фрагменты интерфейса
const phIco = n => icon(n);
// значок канала: свой для известных ключей contacts.mjs (whatsapp, telegram, max, vk), иначе общий «чат»
const CH_ICONS = new Set(['whatsapp', 'telegram', 'max', 'vk']);
export const channelIcon = key => (CH_ICONS.has(key) ? `ch-${key}` : 'chat');
function msgLinks(S, cls = '') {
  const list = S.contacts.channels.filter(c => c.href);
  if (!list.length || S.off.has('messengers')) return '';
  return `<span class="msgs ${cls}">${list.map(c => `<a class="msg" href="${esc(c.href)}" target="_blank" rel="noopener" title="${esc(c.label)}" aria-label="${esc(c.label)}">${phIco(channelIcon(c.key))}</a>`).join('')}</span>`;
}
function ctaLink(S, cta, act, cls, extra = '') {
  const label = String(cta.main || '');
  if (!label) return '';
  return `<a class="${cls}"${attrs(act)}${extra}>${esc(label)}</a>`;
}
export function headerCtaAttrs(S) {
  const c = S.homeCta;
  let a = c.action ? actionAttrs(S, c.action, null) : null;
  if (a && a['data-act'] === 'scroll') a = null;
  if (!a && S.landing) {
    const f = S.landingForm;
    if (f) a = { 'data-act': 'scroll', 'data-target': f };
  }
  // окно заявки - с заголовком по тексту CTA (как у кнопок страниц)
  if (a && a['data-act'] === 'lead' && !a['data-title']) a = { ...a, 'data-title': String(c.main || '') };
  return a || { 'data-act': 'lead', 'data-title': String(c.main || '') };
}
function photoOfPage(S, x, photos) {
  if (!photos || !S.samples) return null;
  const item = (S.samples.items || []).find(i => i.category_slug === x.slug && Array.isArray(i.images) && i.images[0]);
  return item ? photos.get(item.images[0]) : null;
}
function thumb(S, x, photos, cls) {
  const pc = photoOfPage(S, x, photos);
  return pc ? `<span class="${cls} has-img"><span class="pimg ${pc}" role="img" aria-label="${esc(x.label)}"></span></span>` : `<span class="${cls} ph-photo"><span>${esc(S.t('photo'))}</span></span>`;
}
export function navTiles(S, list, photos) {
  if (!list.length) return '';
  return `<div class="navtiles">${list.map(x => `<a class="ntile" href="#${esc(x.route)}">${thumb(S, x, photos, 'ntile-img')}<span class="ntile-l">${esc(x.title)}</span>${icon('arrow')}</a>`).join('')}</div>`;
}

// ---------------------------------------------------------------- меню
// Пункты верхнего уровня: рабочие страницы первого уровня без ui_role, без шаблонов и страниц товара. Больше 7 -
// группировка по типу (виртуальные разделы с подписью из словаря; страница с детьми и контакты - отдельными пунктами).
// Сверх 7 пунктов или 72 знаков подписей - «Еще». Выпадающие панели и мобильное меню показывают всех потомков пункта.
// Лендинг: якоря из config.site.nav; не дал ни одного - якоря из написанных блоков главной (S.landingAuto, build-html).
export function buildMenu(S) {
  const t = S.t;
  if (S.off.has('menu')) return { items: [], mode: 'off' };
  if (S.landing) {
    const items = [];
    for (const n of S.nav || []) {
      if (n && typeof n === 'object' && n.anchor && n.label && S.home && S.landingTypes && S.landingTypes.has(n.anchor)) items.push({ kind: 'anchor', label: String(n.label), anchor: String(n.anchor), children: [] });
    }
    let anchorsAuto = false;
    if (!items.length && Array.isArray(S.landingAuto)) {
      for (const a of S.landingAuto) items.push({ kind: 'anchor', label: String(a.label), anchor: String(a.anchor), children: [] });
      anchorsAuto = items.length > 0;
    }
    return { items, mode: 'landing', anchorsAuto };
  }
  const pageItem = x => ({ kind: 'page', page: x, label: x.label, children: S.kids(x) });
  let items = [];
  let mode = 'map';
  let navIgnored = false;
  if (S.nav && S.nav.length) {
    mode = 'config';
    for (const n of S.nav) {
      if (typeof n === 'string') { const x = S.bySlug.get(n); if (x && x.route) items.push(pageItem(x)); continue; }
      if (!n || typeof n !== 'object') continue;
      if (n.page) { const x = S.bySlug.get(String(n.page)); if (x && x.route) items.push({ ...pageItem(x), label: n.label ? String(n.label) : x.label }); }
    }
    // config.site.nav не дал ни одного пункта (только якоря или неизвестные slug) - меню по карте, сборщик предупреждает
    if (!items.length) { mode = 'map'; navIgnored = true; }
  }
  if (mode === 'map') {
    const top = S.pages.filter(x => x !== S.home && !x.parent && S.navOk(x) && x.type !== 'product');
    items = top.map(pageItem);
    if (items.length > NAV_MAX) items = groupByType(S, items);
  }
  // «Еще»: не больше NAV_MAX пунктов и NAV_CHARS знаков подписей вместе с ним
  const more = [];
  const total = items.reduce((s, it) => s + it.label.length, 0);
  if (items.length > NAV_MAX || total > NAV_CHARS) {
    const keep = [];
    let chars = t('more').length;
    for (const it of items) {
      if (!more.length && keep.length < NAV_MAX - 1 && chars + it.label.length <= NAV_CHARS) { keep.push(it); chars += it.label.length; } else more.push(it);
    }
    items = keep;
    items.push({ kind: 'more', label: t('more'), children: [], more });
  }
  return { items, mode, navIgnored };
}
// Группировка плоской карты по типу. Не группируются: хаб, страница с детьми (ее дети остались бы без пункта меню),
// контакты. Группа с подписью, как у страницы верхнего уровня (хаб «Услуги» и услуги в корне, корневая категория
// «Каталог» и категории в корне), вливается в эту страницу (хаб - первым): два одинаковых пункта в строке меню выглядят
// ошибкой сборки.
function groupByType(S, items) {
  const key = x => (x.type === 'hub' || x.type === 'info_contacts' ? '' : /^info_/.test(x.type) ? 'info' : ['service', 'category', 'product'].includes(x.type) ? x.type : 'other');
  const groupable = it => it.kind === 'page' && !!key(it.page) && !(it.children && it.children.length);
  const count = {};
  for (const it of items) if (groupable(it)) count[key(it.page)] = (count[key(it.page)] || 0) + 1;
  const tg = S.ui.type_groups || {};
  const low = s => String(s || '').trim().toLowerCase();
  const out = [];
  const groups = {};
  for (const it of items) {
    const k = groupable(it) ? key(it.page) : '';
    if (!k || count[k] < 2) { out.push(it); continue; }
    if (!groups[k]) {
      const label = String(tg[k] || tg.other || k);
      const same = items.filter(o => o.kind === 'page' && low(o.label) === low(label) && !(groupable(o) && key(o.page) === k));
      const twin = same.find(o => o.page.type === 'hub') || same[0];
      groups[k] = twin ? { twin, members: [] } : { kind: 'group', label, children: [], members: [] };
      if (!twin) out.push(groups[k]);
    }
    groups[k].members.push(it.page);
  }
  for (const g of Object.values(groups)) { if (g.twin) g.twin.children = [...g.twin.children, ...g.members]; else g.children = g.members; }
  return out;
}
// ссылки меню на список страниц и их потомков: [{ x, depth }] (depth 1 - сам список)
function subtree(S, list) { return list.flatMap(c => [{ x: c, depth: 1 }, ...S.descendants(c).map(d => ({ x: d.x, depth: d.depth + 1 }))]); }
const MEGA_WIDE = 24;
function megaHtml(S, item, photos, ctaHtml) {
  const t = S.t;
  const list = item.children || [];
  const li = (x, depth = 1) => `<li${depth > 1 ? ` class="d${Math.min(depth, 3)}"` : ''}><a href="#${esc(x.route)}"><span>${esc(x.name)}</span>${icon('right')}</a></li>`;
  const headLi = x => `<li><a class="mlist-h" href="#${esc(x.route)}"><span>${esc(x.name)}</span>${icon('right')}</a></li>`;
  let body, links;
  if (item.kind === 'more') {
    // «Еще»: колонки ссылок - пункты, не вошедшие в строку меню, со всеми их потомками (без обрезки: панель прокручивается)
    const cols = item.more.map(it => {
      const head = it.page ? headLi(it.page) : `<li><span class="mlist-h">${esc(it.label)}</span></li>`;
      const sub = subtree(S, it.children || []);
      return { html: `<ul class="mlist">${head}${sub.map(d => li(d.x, d.depth)).join('')}</ul>`, n: sub.length + (it.page ? 1 : 0) };
    });
    links = cols.reduce((s, c) => s + c.n, 0);
    body = `<div class="mcols${links >= MEGA_WIDE ? ' wide' : ''}">${cols.map(c => c.html).join('')}</div>`;
  } else if (list.some(c => S.kids(c).length)) {
    // у детей есть свои дети: колонка на ребенка - он заголовком, его потомки списком
    links = subtree(S, list).length;
    body = `<div class="mcols${links >= MEGA_WIDE ? ' wide' : ''}">${list.map(c => `<ul class="mlist">${headLi(c)}${S.descendants(c).map(d => li(d.x, d.depth)).join('')}</ul>`).join('')}</div>`;
  } else if (list.length <= 8) {
    links = list.length;
    body = `<div class="mtiles">${list.map(c => `<a class="mtile" href="#${esc(c.route)}" title="${esc(c.title)}">${thumb(S, c, photos, 'mtile-img')}<span class="mtile-l">${esc(c.name)}</span></a>`).join('')}</div>`;
  } else {
    // длинный список - колонками; от 24 ссылок - больше колонок и без колонки промо
    links = list.length;
    const k = links >= MEGA_WIDE ? 5 : 3;
    const n = Math.ceil(list.length / k);
    const cols = Array.from({ length: k }, (_, i) => list.slice(i * n, (i + 1) * n)).filter(c => c.length);
    body = `<div class="mcols${links >= MEGA_WIDE ? ' wide' : ''}">${cols.map(col => `<ul class="mlist">${col.map(c => li(c)).join('')}</ul>`).join('')}</div>`;
  }
  const all = item.page ? `<a class="mega-all" href="#${esc(item.page.route)}">${esc(t('all'))} ${icon('arrow')}</a>` : '';
  const phone = S.contacts.phones[0];
  const promo = ctaHtml && links < MEGA_WIDE ? `<div class="mpromo"><div><div class="mpromo-t">${esc(S.brand)}</div>${phone ? `<div class="mp-line">${esc(phone.text)}</div>` : ''}${S.contacts.hours ? `<div class="mp-line">${esc(S.contacts.hours)}</div>` : ''}</div>${ctaHtml}</div>` : '';
  return `<div class="mega" role="region" aria-label="${esc(item.label)}"><div class="container mega-in${promo ? '' : ' no-promo'}"><div class="mcol">${body}${all}</div>${promo}</div></div>`;
}

// ---------------------------------------------------------------- шапка, мобильное меню, нижняя панель
export function headerHtml(S, menu, photos) {
  const t = S.t;
  const c = S.contacts;
  const hc = S.homeCta;
  const hca = headerCtaAttrs(S);
  const main = String(hc.main || '');
  const short = String(hc.short || '');
  const ctaCls = short ? ' has-short' : main.length > 24 ? ' icon-only' : '';
  const ctaBtn = main ? `<a class="btn btn-cta${ctaCls}"${attrs(btnAttrs(hca))} title="${esc(main)}" aria-label="${esc(main)}">${icon('lead')}<span class="l-full">${esc(main)}</span>${short ? `<span class="l-short">${esc(short)}</span>` : ''}</a>` : '';
  const promoCta = main ? `<a class="btn btn-inv btn-block"${attrs(btnAttrs(hca))}>${esc(main)}</a>` : '';
  const topFields = [c.address, c.hours, c.channels.some(x => x.href) ? 'ch' : ''].filter(Boolean).length;
  const topbarOn = topFields >= 2 && !S.off.has('topbar');
  const phone = c.phones[0];
  const topbar = topbarOn ? `<div class="topbar"><div class="container topbar-in">${c.address ? `<span class="tb-item">${icon('pin')}${esc(c.address)}</span>` : ''}${c.hours ? `<span class="tb-item">${icon('clock')}${esc(c.hours)}</span>` : ''}<span class="tb-right">${msgLinks(S)}${phone ? `<a class="tb-phone" href="${esc(phone.href)}">${esc(phone.text)}</a>` : ''}</span></div></div>` : '';
  const megaOn = !S.off.has('mega');
  let megaCount = 0;
  const navItems = menu.items.map(it => {
    if (it.kind === 'anchor') return `<div class="nav-item"><button type="button" class="nav-link" data-act="scroll" data-target="${esc(it.anchor)}">${esc(it.label)}</button></div>`;
    const hasMega = megaOn && ((it.children && it.children.length) || it.kind === 'more');
    const mega = hasMega ? megaHtml(S, it, photos, promoCta) : '';
    if (hasMega) megaCount++;
    const match = it.page ? it.page.route : '';
    const link = it.page
      ? `<a class="nav-link" href="#${esc(it.page.route)}" title="${esc(it.page.title)}">${esc(it.label)}${hasMega ? icon('chev') : ''}</a>`
      : `<button type="button" class="nav-link" data-act="mega">${esc(it.label)}${icon('chev')}</button>`;
    return `<div class="nav-item${hasMega ? ' has-mega' : ''}" data-match="${esc(match)}">${link}${mega}</div>`;
  }).join('');
  const nav = navItems ? `<nav class="nav" aria-label="${esc(t('main_menu'))}"><div class="container nav-in">${navItems}</div></nav>` : '';
  const burger = !S.landing && menu.items.length ? `<button type="button" class="icon-btn burger" data-act="mnav-open" aria-label="${esc(t('menu'))}">${icon('burger')}</button>` : '';
  const search = S.searchPage ? `<form class="search" data-search role="search"><input type="search" name="q" placeholder="${esc(t('search_placeholder'))}" aria-label="${esc(t('search'))}"><button type="submit" aria-label="${esc(t('search_button'))}">${icon('search')}</button></form>` : '';
  const searchToggle = S.searchPage ? `<button type="button" class="icon-btn search-toggle" data-act="search-toggle" aria-label="${esc(t('search'))}">${icon('search')}</button>` : '';
  const acc = S.accountPage ? `<a class="hdr-icon" href="#${esc(S.accountPage.route)}" aria-label="${esc(S.accountPage.label)}" title="${esc(S.accountPage.title)}">${icon('user')}<span class="hdr-il">${esc(t('account'))}</span></a>` : '';
  const cart = S.cartPage ? `<a class="hdr-icon" href="#${esc(S.cartPage.route)}" aria-label="${esc(t('cart'))}">${icon('bag')}<span class="cart-n" data-cart-count hidden>0</span><span class="hdr-il">${esc(t('cart'))}</span></a>` : '';
  // оболочка по пересечениям лидеров (S.shell): чипы телефона и мессенджеров - на своих местах, новые элементы - группой
  // перед CTA; без S.shell строка шапки прежняя
  const sh = S.shell ? shellHeader(S, menu) : null;
  const hdrPhone = phone ? `<a class="hdr-phone" href="${esc(phone.href)}">${icon('phone')}<span>${esc(phone.text)}</span></a>` : sh ? sh.phone : '';
  const hdrMsgs = msgLinks(S) ? `<span class="hdr-msgs">${msgLinks(S)}</span>` : sh ? sh.msgs : '';
  const logo = `<a class="logo" href="#/" aria-label="${esc(S.brand)}"><span class="logo-w">${esc(S.brand)}</span>${S.tagline ? `<span class="logo-t">${esc(S.tagline)}</span>` : ''}</a>`;
  const html = `${topbar}<header class="hdr" id="hdr"><div class="hdr-main"><div class="container hdr-main-in">${burger}${logo}${search || '<span class="hdr-sp"></span>'}${hdrPhone}${hdrMsgs}${searchToggle}${acc}${cart}${sh ? sh.group : ''}${ctaBtn}</div></div>${nav}</header>${megaCount ? '<div class="mega-dim" data-act="mega-close" data-mega-dim></div>' : ''}`;
  return { html, topbarOn, megaCount, navCount: menu.items.length };
}
export function mobileNavHtml(S, menu) {
  const t = S.t;
  // без меню (лендинг) новые элементы шапки из S.shell - полосой под шапкой на телефоне
  if (S.landing || !menu.items.length) return S.shell ? shellStrip(S, menu) : '';
  // уровень пункта: дети и все их потомки (внуки и глубже - с отступом)
  const row = d => `<a class="mrow${d.depth > 1 ? ` d${Math.min(d.depth, 3)}` : ''}" href="#${esc(d.x.route)}">${esc(d.x.name)}</a>`;
  const items = menu.items.map(it => {
    if (it.kind === 'more') return it.more.map(m => mItem(m)).join('');
    return mItem(it);
  }).join('');
  function mItem(it) {
    const kidsList = it.children || [];
    const lab = it.page && it.kind === 'page' && it.label === it.page.label ? it.page.name : it.label;
    if (it.page && !kidsList.length) return `<li><a href="#${esc(it.page.route)}">${esc(lab)}</a></li>`;
    if (!kidsList.length) return '';
    return `<li class="macc"><button type="button" class="macc-h" data-act="macc">${esc(lab)}${icon('chev')}</button><div class="macc-b">${it.page ? `<a class="mrow mall" href="#${esc(it.page.route)}">${esc(t('all'))}</a>` : ''}${subtree(S, kidsList).map(row).join('')}</div></li>`;
  }
  const extra = [S.searchPage, S.accountPage, S.cartPage].filter(Boolean).map(x => `<li><a href="#${esc(x.route)}">${esc(x.name)}</a></li>`).join('');
  const c = S.contacts;
  const phone = c.phones[0];
  const hca = headerCtaAttrs(S);
  const cta = S.homeCta.main ? `<a class="btn btn-block"${attrs(btnAttrs(hca))}>${esc(S.homeCta.main)}</a>` : '';
  return `<div class="mnav" id="mnav" aria-hidden="true"><div class="mnav-h"><a class="logo" href="#/"><span class="logo-w">${esc(S.brand)}</span></a><button type="button" class="icon-btn" data-act="mnav-close" aria-label="${esc(t('close'))}">${icon('close')}</button></div><div class="mnav-body"><ul class="mroot">${items}${extra}</ul>${S.shell ? shellMnav(S, menu) : ''}<div class="mnav-contacts">${phone ? `<a class="mphone" href="${esc(phone.href)}">${icon('phone')}${esc(phone.text)}</a>` : ''}${c.hours ? `<span class="mhours">${esc(c.hours)}</span>` : ''}${msgLinks(S, 'msgs-lg')}</div>${cta}</div></div>`;
}
export function mbarHtml(S) {
  if (S.off.has('mbar')) return '';
  const t = S.t;
  const phone = S.contacts.phones[0];
  const hc = S.homeCta;
  const hca = headerCtaAttrs(S);
  const cta = hc.main ? `<a class="btn mbar-btn" data-mbar-cta${attrs(btnAttrs(hca))}>${esc(hc.short || hc.main)}</a>` : '';
  // элементы оболочки зоны mobile (S.shell), которых нет на первом экране телефона
  const mob = S.shell ? shellZoneHtml(S, null, 'mobile', 'mbar') : '';
  if (!phone && !cta && !mob) return '';
  return `<div class="mbar">${phone ? `<a class="mbar-call" href="${esc(phone.href)}" aria-label="${esc(t('call'))}">${icon('phone')}</a>` : ''}${mob}${cta}</div>`;
}

// ---------------------------------------------------------------- подвал
export function footerHtml(S, menu) {
  const t = S.t;
  const c = S.contacts;
  const col = (title, list) => (list.length ? `<div class="fcol"><div class="fcol-h">${esc(title)}</div><ul>${list.map(x => `<li><a href="#${esc(x.route)}">${esc(x.name || x.label)}</a></li>`).join('')}</ul></div>` : '');
  // колонки по веткам карты: пункт с детьми - своя колонка, прочие пункты верхнего уровня - общая колонка
  const flat = [];
  const cols = [];
  const items = menu.items.flatMap(it => (it.kind === 'more' ? it.more : [it]));
  for (const it of items) {
    if (it.kind === 'anchor') continue;
    const k = (it.children || []).slice(0, 8);
    if (k.length) cols.push(col(it.label, [...(it.page ? [{ ...it.page, label: t('all'), name: t('all') }] : []), ...k]));
    else if (it.page) flat.push(it.page);
  }
  if (!S.landing) {
    const svc = [S.searchPage, S.accountPage, S.cartPage].filter(Boolean);
    if (flat.length) cols.push(col(t('footer_site'), flat));
    if (svc.length) cols.push(col(t('footer_service'), svc));
  }
  // оболочка по пересечениям лидеров: ссылки страниц - колонкой «Информация», слоты - строками контактов, функции - в
  // строке документов (без S.shell подвал прежний)
  const sf = S.shell ? shellFooter(S, menu) : null;
  if (sf && sf.col) cols.push(sf.col);
  const phones = c.phones.map(p => `<a class="fphone" href="${esc(p.href)}">${esc(p.text)}</a>`).join('');
  // каналы строками «подпись: значение» (номера мессенджеров видны, а не только значки)
  const chRows = S.off.has('messengers') ? '' : c.channels.filter(x => x.text).map(x => `<div class="fc-row fc-ch">${icon(channelIcon(x.key))}<span>${x.href ? `<a href="${esc(x.href)}" target="_blank" rel="noopener">${esc(x.label)}: ${esc(x.text)}</a>` : `${esc(x.label)}: ${esc(x.text)}`}</span></div>`).join('');
  const rows = [
    c.address ? `<div class="fc-row">${icon('pin')}<span>${esc(c.address)}${S.mapsHref ? `<a class="fc-route" href="${esc(S.mapsHref)}" target="_blank" rel="noopener">${esc(t('map_route'))}</a>` : ''}</span></div>` : '',
    phones ? `<div class="fc-row">${icon('phone')}<span>${phones}</span></div>` : '',
    chRows,
    c.hours ? `<div class="fc-row">${icon('clock')}<span>${esc(c.hours)}</span></div>` : '',
    c.email ? `<div class="fc-row">${icon('mail')}<span><a href="mailto:${esc(c.email)}">${esc(c.email)}</a></span></div>` : '',
    sf ? sf.rows : '',
  ].join('');
  const legalParts = [c.legal.name ? esc(c.legal.name) : '', c.legal.inn ? `${esc(t('inn'))} ${esc(c.legal.inn)}` : '', c.legal.ogrn ? `${esc(t('ogrn'))} ${esc(c.legal.ogrn)}` : ''].filter(Boolean);
  const docs = S.legalPages.length
    ? S.legalPages.map(p => `<button type="button" class="linkbtn" data-act="toast" data-toast="${esc(t('toast_legal'))}">${esc(p.nav_label || pageTitle(p))}</button>`).join('')
    : `<button type="button" class="linkbtn" data-act="toast" data-toast="${esc(t('toast_legal'))}">${esc(t('policy'))}</button>`;
  return `<footer class="ftr"><div class="container"><div class="ftr-top"><div class="fbrand"><a class="logo logo-inv" href="#/"><span class="logo-w">${esc(S.brand)}</span>${S.tagline ? `<span class="logo-t">${esc(S.tagline)}</span>` : ''}</a><div class="fcontacts">${rows}${msgLinks(S, 'msgs-lg msgs-dark')}</div></div><div class="fcols">${cols.join('')}</div></div><div class="ftr-legal">${legalParts.length ? `<p>${legalParts.join(' · ')}</p>` : ''}${S.legalExtra.map(s => `<p>${esc(s)}</p>`).join('')}<p class="ftr-docs">${docs}${sf ? sf.docs : ''}<span class="sp"></span><span class="proto-badge">${esc(t('prototype_badge'))}</span><span>© ${esc(S.brand)}</span></p></div></div></footer>`;
}

// ---------------------------------------------------------------- окна, тост, служебная панель
export function overlaysHtml(S, debugPanel) {
  const t = S.t;
  const c = S.contacts;
  const field = (label, type) => `<label class="field"><span class="field-l">${esc(label)}</span><input type="${type}"${type === 'tel' ? ` placeholder="${esc(t('tel_placeholder'))}" autocomplete="tel"` : ' autocomplete="name"'}></label>`;
  const chan = c.channels.filter(x => x.href || x.value);
  const msgOn = chan.length && !S.off.has('messengers');
  const lead = `<div class="modal" id="modal-lead" aria-hidden="true" role="dialog" aria-modal="true" aria-labelledby="ml-t"><div class="modal-bg" data-act="modal-close"></div><div class="modal-box" data-form-scope><button type="button" class="icon-btn modal-x" data-act="modal-close" aria-label="${esc(t('close'))}">${icon('close')}</button><div class="modal-h" id="ml-t">${esc(S.homeCta.main || t('lead_default'))}</div><p class="modal-ref" data-ref hidden></p><div class="modal-form"><div class="modal-fields" data-fields>${field(t('field_name'), 'text')}${field(t('field_phone'), 'tel')}</div><button type="button" class="btn btn-block" data-act="submit">${esc(t('send'))}</button><p class="consent">${esc(t('consent'))}</p></div>${msgOn ? `<div class="modal-msg"><span>${esc(t('messengers_or'))}</span>${msgLinks(S, 'msgs-lg')}</div>` : ''}</div></div>`;
  const msg = msgOn ? `<div class="modal" id="modal-msg" aria-hidden="true" role="dialog" aria-modal="true" aria-labelledby="mm-t"><div class="modal-bg" data-act="modal-close"></div><div class="modal-box modal-sm"><button type="button" class="icon-btn modal-x" data-act="modal-close" aria-label="${esc(t('close'))}">${icon('close')}</button><div class="modal-h" id="mm-t">${esc(t('messengers'))}</div><ul class="msg-list">${chan.map(x => (x.href ? `<li><a href="${esc(x.href)}" target="_blank" rel="noopener"><b>${esc(x.label)}</b><span>${esc(x.text || x.value)}</span>${icon('arrow')}</a></li>` : `<li><div><b>${esc(x.label)}</b><span>${esc(x.text || x.value)}</span><span></span></div></li>`)).join('')}</ul></div></div>` : '';
  return `${lead}${msg}<div class="toast" id="toast" role="status" aria-live="polite"></div>${debugPanel || ''}`;
}

// ---------------------------------------------------------------- оболочка по пересечениям лидеров (work/shell.json)
// Программа 05.10 (КФ и КНДР), раздел 3.5. Только при shellSpec (work/shell.json пишет kf-matrix.mjs --shell): без него
// разметка, стили и скрипт прототипа прежние (эталон .claude/tests/site-tekst/fixtures/site-golden). Элемент - строка
// scope site уровня не ниже «рекомендовано»: { id, name, zone header|footer|mobile|fixed, level, coverage, kind
// slot|function|page_link, render, needs, page_match, niche }. Состояние (prototype.modules.json shell.items[].state):
// shown - элемент на сайте (данные проекта, живая функция, страница карты); chip - слот без данных (чип «нужны данные:
// <название>» на своем месте, вопрос заказчику задает отчет); function - функция без страницы модуля (кнопка-тост
// «функция вне прототипа», без data-search, data-cart, секций и данных модуля); page_missing - нужной страницы нет в
// карте (кнопка-тост «страница вне прототипа», рекомендация в отчете); declined - поле снято заказчиком (company.absent,
// телефон при no_phone) или каналы есть, а модуль мессенджеров выключен оператором (reason: "off" в modules.json): ни
// чипа, ни вопроса. Мессенджер или соцсеть ищется по ключу канала из id (messenger_viber -> viber), обобщенный id -
// любой канал набора. Подписи - только шаблоны ui.json с нормализованным name; подпись
// конкурента (label) в прототип не попадает. Отрисовка оболочки - только в этом файле.
const SHELL_ZONES = ['header', 'footer', 'mobile', 'fixed'];
const SHELL_RENDERS = {
  phone: 'slot', messengers: 'slot', socials: 'slot', email: 'slot', address: 'slot', hours: 'slot', map_link: 'slot', legal_line: 'slot',
  licenses: 'slot', tagline: 'slot', rating: 'slot', payment_icons: 'slot', city: 'slot', docs: 'page_link',
  callback: 'function', cta: 'function', up_button: 'function', subscribe: 'function',
  search: 'function', cart: 'function', account: 'function', favorites: 'function', compare: 'function',
  // native - часть оболочки, которую прототип рисует всегда (логотип, меню, бургер, колонки подвала, крошки, копирайт):
  // показано, без новой разметки и без вопроса
  native: 'slot',
};
const MSG_KEYS = new Set(['whatsapp', 'telegram', 'max', 'viber']);
const SOC_KEYS = new Set(['vk', 'youtube', 'instagram', 'dzen', 'ok']);
// ключ канала элемента: id словаря КФ с префиксом (messenger_viber, social_telegram) или голый ключ канала (whatsapp);
// '' - обобщенный id (messengers, socials): тогда подходит любой канал набора
const channelKeyOf = id => { const k = String(id).replace(/^(messengers?|socials?)_/, ''); return k !== id || MSG_KEYS.has(k) || SOC_KEYS.has(k) ? k : ''; };
const LIVE_PAGE = { search: 'searchPage', cart: 'cartPage', account: 'accountPage' };
const LEGAL_PARTS = ['legal_name', 'inn', 'ogrn'];
const RENDER_FIELDS = { email: ['email'], address: ['address'], map_link: ['address'], hours: ['hours'], legal_line: LEGAL_PARTS };
// Снятые заказчиком поля (noPhone, absentOf, ABSENT_FIELDS) - общий модуль scripts/absent.mjs, тот же, что у импорта.
export { noPhone, absentOf };
// подписи оболочки - раздел kf словаря (в данные скрипта страницы не идет: без shell.json файл прототипа прежний)
const tv = (S, key, vars = {}) => String(((S.ui && S.ui.kf) || {})[key] ?? key).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
// название элемента для подписей: без кавычек и хвостовой пунктуации, до 40 знаков по слову, с прописной
export function shellName(s) {
  // служебная пометка словаря или наблюдателя в скобках в конце («Отзывы (ссылка)», «Гарантии (блок)») - не подпись
  let n = String(s ?? '').replace(/[«»"“”„']/g, '').replace(/\s+/g, ' ').trim().replace(/\s*\([^()]*\)$/, '').replace(/[\s.,;:!?-]+$/, '');
  if (n.length > 40) n = cutWords(n, 40);
  return n ? n.charAt(0).toUpperCase() + n.slice(1) : '';
}
// в чипе - со строчной только кириллическое первое слово с прописной в начале и строчными дальше; сокращения и латиница
// (имена брендов вроде WhatsApp, TikTok) - как есть
const lowerFirst = s => (/^[\u0410-\u042F\u0401][\u0430-\u044F\u0451-]*(\s|$)/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);
const legalVal = (c, k) => (k === 'legal_name' ? c.legal.name : c.legal[k]);
// страница карты по page_match ({type?, ui_role?, subject_re?}): рабочая - { x }, со status skip - { skip }, нет - null
// без type - информационные страницы (info_*): ссылка оболочки (доставка, гарантия, поиск, кабинет) не ведет на раздел,
// услугу, товар или категорию с тем же словом в названии («Гарантийный ремонт», «Поиск персонала», «Кабинеты руководителя»);
// элемент, которому подходят раздел, категория или услуга (каталог, акции, цены, вакансии), называет типы списком
const PAGE_MATCH_TYPES = ['info_about', 'info_contacts', 'info_team', 'info_reviews', 'info_cases', 'info_faq', 'info_other'];
const noYo = v => String(v ?? '').replace(/\u0451/g, '\u0435').replace(/\u0401/g, '\u0415');
export function matchPage(S, pm) {
  // список правил - по порядку, первое с рабочей страницей; иначе первое «есть в карте» (цены: информационная страница
  // со словом в названии, затем услуга или категория с ним в начале названия)
  if (Array.isArray(pm)) {
    let skip = null;
    for (const one of pm) { const m = matchPage(S, one); if (m && m.x) return m; if (m && m.skip && !skip) skip = m; }
    return skip;
  }
  if (!pm || typeof pm !== 'object') return null;
  let re = null;
  // название - с начала слова («цен» - «Цены», но не «Оценка»), е и е с точками не различаются
  if (pm.subject_re) { try { re = new RegExp(`(?<![a-z0-9\u0430-\u044f\u0451])(?:${noYo(pm.subject_re)})`, 'i'); } catch { return null; } }
  const types = (Array.isArray(pm.type) ? pm.type : pm.type ? [pm.type] : []).map(String);
  if (!types.length && !pm.ui_role && !re) return null;
  const typeOk = p => (types.length ? types.includes(p.type) : PAGE_MATCH_TYPES.includes(p.type));
  const texts = p => [p.subject, p.nav_label].filter(Boolean).map(noYo);
  const reOk = p => !!re && texts(p).some(t => re.test(t));
  // роль элемента (ui_role) снимает условие типа, но не названия: при subject_re название обязательно - оферта не
  // становится политикой конфиденциальности; без subject_re нужна сама роль
  const ok = p => p && p.slug && (pm.ui_role && p.ui_role === pm.ui_role ? true : typeOk(p)) && (re ? reOk(p) : !pm.ui_role || p.ui_role === pm.ui_role);
  // совпадение с начала названия - раньше («Цены» раньше «Ремонт: цены»), дальше порядок карты
  const atStart = p => !!re && texts(p).some(t => { const m = re.exec(t); return !!m && m.index === 0; });
  const hits = (S.allPages || []).filter(ok).map((p, i) => ({ p, i, k: atStart(p) ? 0 : 1 })).sort((x, y) => x.k - y.k || x.i - y.i).map(x => x.p);
  const live = hits.map(p => S.bySlug.get(p.slug)).find(Boolean);
  if (live) return { x: live };
  const skip = hits.find(p => p.status === 'skip');
  return skip ? { skip } : null;
}
// модель оболочки: элементы с состоянием (вызывается из buildSite)
export function shellPlan(S, spec, facts) {
  if (!spec || typeof spec !== 'object' || !Array.isArray(spec.items)) return null;
  const c = S.contacts;
  const absent = absentOf(c.company);
  const noPh = noPhone(c.company);
  // слоты без поля company (рейтинг, оплата, города, нишевые) - публикуемый факт с полем slot: "<id элемента>"
  const slotVal = {};
  for (const f of (facts && Array.isArray(facts.facts) ? facts.facts : [])) {
    const k = f && typeof f.slot === 'string' ? f.slot.trim() : '';
    const v = k && f.publish === 'yes' ? String(f.wording || f.value || '').trim() : '';
    if (v && !(k in slotVal)) slotVal[k] = { value: v, fact: String(f.id || '') };
  }
  const items = [];
  const seen = new Set();
  for (const raw of spec.items) {
    if (!raw || typeof raw !== 'object' || !raw.id) continue;
    const id = String(raw.id).trim();
    const zone = SHELL_ZONES.includes(raw.zone) ? raw.zone : '';
    if (!zone || seen.has(`${zone}:${id}`)) continue;
    seen.add(`${zone}:${id}`);
    const render = Object.hasOwn(SHELL_RENDERS, raw.render) ? raw.render : 'generic';
    const kind = render !== 'generic' ? SHELL_RENDERS[render] : ['slot', 'function', 'page_link'].includes(raw.kind) ? raw.kind : 'slot';
    const it = {
      id, name: shellName(raw.name) || id, zone, level: String(raw.level || ''), coverage: String(raw.coverage || ''), niche: raw.niche === true,
      kind, render, needs: (Array.isArray(raw.needs) ? raw.needs : []).map(String), value: '', fact: '', channels: [], page: null, skipPage: null,
      match: render === 'docs' && docsMatch(raw.page_match),
    };
    it.state = shellState(S, it, raw, { absent, noPh, slot: slotVal[id] || null });
    items.push(it);
  }
  return { items };
}
function shellState(S, it, raw, { absent, noPh, slot }) {
  const c = S.contacts;
  if ((it.render === 'phone' || it.needs.includes('company.phones')) && noPh) return 'declined';
  if (it.render === 'legal_line') {
    // реквизиты: сняты все части - слота нет; часть - остаток без чипа
    const cut = LEGAL_PARTS.filter(k => absent.includes(k));
    if (LEGAL_PARTS.some(k => !cut.includes(k) && legalVal(c, k))) return 'shown';
    return cut.length ? 'declined' : 'chip';
  }
  const fields = [...(RENDER_FIELDS[it.render] || []), ...it.needs.map(n => n.replace(/^company\./, '')).filter(k => ABSENT_FIELDS.includes(k))];
  if (fields.length && fields.every(k => absent.includes(k))) return 'declined';
  const fromFact = () => { if (!slot) return 'chip'; it.value = slot.value; it.fact = slot.fact; return 'shown'; };
  switch (it.render) {
    case 'phone': return c.phones[0] ? 'shown' : 'chip';
    case 'messengers': case 'socials': {
      const set = it.render === 'messengers' ? MSG_KEYS : SOC_KEYS;
      const key = channelKeyOf(it.id);
      it.channels = c.channels.filter(ch => (key ? ch.key === key : set.has(ch.key)) && (ch.href || ch.text));
      if (!it.channels.length) return 'chip';
      // каналы есть, но оператор выключил модуль мессенджеров: не вопрос заказчику, а решение оператора
      if (S.off.has('messengers')) { it.reason = 'off'; return 'declined'; }
      return 'shown';
    }
    case 'email': return c.email ? 'shown' : 'chip';
    case 'address': return c.address ? 'shown' : 'chip';
    case 'hours': return c.hours ? 'shown' : 'chip';
    case 'map_link': return S.mapsHref ? 'shown' : 'chip';
    case 'licenses': return S.legalExtra.length ? 'shown' : fromFact();
    case 'tagline': if (S.tagline) { it.value = S.tagline; return 'shown'; } return fromFact();
    case 'rating': case 'payment_icons': case 'city': return fromFact();
    case 'docs': if (it.match) return pageState(S, it, raw); return 'shown';
    case 'callback': case 'cta': case 'up_button': case 'native': return 'shown';
    case 'subscribe': return 'function';
    case 'search': case 'cart': case 'account': case 'favorites': case 'compare': {
      const x = it.render in LIVE_PAGE ? S[LIVE_PAGE[it.render]] : S.pages.find(p => p.p.ui_role === it.render);
      if (x) { it.page = x; return 'shown'; }
      // страница есть в карте без ui_role (поиск, корзина, кабинет по названию) - ссылка на нее, живой модуль не включается
      const m = matchPage(S, raw.page_match);
      if (m && m.x) { it.page = m.x; return 'shown'; }
      return 'function';
    }
    default: break;
  }
  if (it.kind === 'function') return 'function';
  if (it.kind === 'page_link') return pageState(S, it, raw);
  return fromFact();
}
// ссылка на страницу карты: рабочая - ссылка, status skip - «есть в карте» с тостом, нет - page_missing и тост
function pageState(S, it, raw) {
  const m = matchPage(S, raw.page_match);
  if (m && m.x) { it.page = m.x; return 'shown'; }
  if (m && m.skip) { it.skipPage = m.skip; return 'shown'; }
  return 'page_missing';
}
// docs с page_match не на юридические страницы (сертификаты, документы) - как page_link; иначе строка юридических страниц
const docsMatch = pm => !!pm && typeof pm === 'object' && !!(pm.type || pm.subject_re || pm.ui_role) && pm.ui_role !== 'legal';
// маршруты, видимые в строке меню и выпадающих панелях; маршруты колонок подвала
function menuRoutes(S, menu) {
  const out = new Set();
  const add = it => { if (it.page) out.add(it.page.route); for (const c of it.children || []) { out.add(c.route); for (const d of S.descendants(c)) out.add(d.x.route); } };
  for (const it of (menu && menu.items) || []) { if (it.kind === 'more') it.more.forEach(add); else add(it); }
  return out;
}
function footerRoutes(S, menu) {
  const out = new Set();
  for (const it of ((menu && menu.items) || []).flatMap(it => (it.kind === 'more' ? it.more : [it]))) {
    if (it.kind === 'anchor') continue;
    const k = (it.children || []).slice(0, 8);
    if (it.page) out.add(it.page.route);
    k.forEach(x => out.add(x.route));
  }
  if (!S.landing) [S.searchPage, S.accountPage, S.cartPage].filter(Boolean).forEach(x => out.add(x.route));
  return out;
}
// элемент уже стоит в зоне прежней разметкой (тогда новой разметки нет)
function shellExisting(S, it, menu) {
  if (it.state !== 'shown') return false;
  const c = S.contacts;
  const r = it.render;
  const msgs = !S.off.has('messengers') && it.channels.some(ch => ch.href);
  if (r === 'native') return true;
  if (it.zone === 'header' || it.zone === 'fixed') {
    // шапка закреплена (sticky): ее элементы видны и при прокрутке
    if (r === 'phone') return !!c.phones[0];
    if (r === 'messengers' || r === 'socials') return msgs;
    if (r in LIVE_PAGE) return !!S[LIVE_PAGE[r]];
    if (r === 'cta') return !!S.homeCta.main;
    if (r === 'tagline') return !!S.tagline;
    if (it.zone === 'header' && (r === 'address' || r === 'hours')) {
      const topFields = [c.address, c.hours, c.channels.some(x => x.href) ? 'ch' : ''].filter(Boolean).length;
      return topFields >= 2 && !S.off.has('topbar');
    }
    if (it.page && it.zone === 'header') return menuRoutes(S, menu).has(it.page.route);
    return false;
  }
  if (it.zone === 'footer') {
    if (['phone', 'email', 'address', 'hours', 'legal_line'].includes(r) || (r === 'docs' && !it.match)) return true;
    if (r === 'messengers' || r === 'socials') return !S.off.has('messengers');
    if (r === 'map_link') return !!c.address;
    if (r === 'licenses') return S.legalExtra.length > 0;
    if (r === 'tagline') return !!S.tagline;
    if (it.page) return footerRoutes(S, menu).has(it.page.route);
    if (it.skipPage) return S.legalPages.includes(it.skipPage);
    return false;
  }
  // mobile: первый экран телефона - шапка (бургер, значки поиска, кабинета и корзины) и нижняя панель
  // без нижней панели (off mbar) первый экран - мобильное меню многостраничника: там телефон и CTA уже есть
  const inMnav = S.off.has('mbar') && !S.landing && !!(menu && menu.items && menu.items.length);
  if (r === 'phone') return !!c.phones[0] && (!S.off.has('mbar') || inMnav);
  if (r === 'cta') return !!S.homeCta.main && (!S.off.has('mbar') || inMnav);
  if (r in LIVE_PAGE) return !!S[LIVE_PAGE[r]];
  return false;
}
const SHELL_ICON = { phone: 'phone', email: 'mail', address: 'pin', map_link: 'pin', hours: 'clock', messengers: 'chat', socials: 'chat', callback: 'phone', up_button: 'chev', cta: 'lead' };
// разметка одного элемента; where: hdr | mob | fc (строка контактов подвала) | fdoc (строка документов) | fcol (колонка
// «Информация») | mbar | fab
function shellItemHtml(S, it, where) {
  const c = S.contacts;
  const dk = esc(it.id);
  const btnCls = where === 'fdoc' || where === 'fcol' ? 'linkbtn' : where === 'fab' ? 'shell-fab-b' : 'shell-fn';
  const toast = key => `<button type="button" class="${btnCls}" data-act="toast" data-toast="${esc(tv(S, key))}" data-kf="${dk}">${esc(it.name)}</button>`;
  if (it.state === 'declined') return '';
  if (it.state === 'chip') return `<span class="ph-need" data-kf="${dk}">${esc(tv(S, 'need', { name: lowerFirst(it.name) }))}</span>`;
  if (it.state === 'function') return toast('toast_function');
  if (it.state === 'page_missing') return toast('toast_page');
  const vCls = where === 'fab' ? 'shell-fab-b' : 'shell-v';
  const ext = { target: '_blank', rel: 'noopener' };
  const link = (href, text, more = {}) => `<a${attrs({ class: vCls, href, ...more, 'data-kf': it.id })}>${text}</a>`;
  switch (it.render) {
    case 'phone': { const p = c.phones[0]; return link(p.href, where === 'fab' ? icon('phone') : esc(p.text), where === 'fab' ? { 'aria-label': it.name } : {}); }
    case 'messengers': case 'socials': {
      const withHref = it.channels.filter(ch => ch.href);
      if (withHref.length) return `<span class="msgs" data-kf="${dk}">${withHref.map(ch => `<a class="msg" href="${esc(ch.href)}" target="_blank" rel="noopener" title="${esc(ch.label)}" aria-label="${esc(ch.label)}">${phIco(channelIcon(ch.key))}</a>`).join('')}</span>`;
      return `<span class="${vCls}" data-kf="${dk}">${it.channels.map(ch => `${esc(ch.label)}: ${esc(ch.text || ch.value)}`).join(', ')}</span>`;
    }
    case 'email': return link(`mailto:${c.email}`, esc(c.email));
    case 'address': return `<span class="${vCls}" data-kf="${dk}">${esc(c.address)}</span>`;
    case 'hours': return `<span class="${vCls}" data-kf="${dk}">${esc(c.hours)}</span>`;
    case 'map_link': return link(S.mapsHref, esc(S.t('map_route')), ext);
    case 'legal_line': {
      const p = [c.legal.name ? esc(c.legal.name) : '', c.legal.inn ? `${esc(S.t('inn'))} ${esc(c.legal.inn)}` : '', c.legal.ogrn ? `${esc(S.t('ogrn'))} ${esc(c.legal.ogrn)}` : ''].filter(Boolean);
      return `<span class="${vCls}" data-kf="${dk}">${p.join(' · ')}</span>`;
    }
    case 'licenses': return `<span class="${vCls}" data-kf="${dk}">${esc(S.legalExtra.length ? S.legalExtra.join('; ') : it.value)}</span>`;
    case 'docs': if (it.match) break; return S.legalPages.length
      ? S.legalPages.map(p => `<button type="button" class="${btnCls}" data-act="toast" data-toast="${esc(S.t('toast_legal'))}" data-kf="${dk}">${esc(p.nav_label || pageTitle(p))}</button>`).join('')
      : `<button type="button" class="${btnCls}" data-act="toast" data-toast="${esc(S.t('toast_legal'))}" data-kf="${dk}">${esc(S.t('policy'))}</button>`;
    case 'callback': return `<button type="button" class="${btnCls}" data-act="lead" data-title="${esc(it.name)}" data-kf="${dk}">${where === 'fab' ? icon('phone') : ''}${esc(it.name)}</button>`;
    case 'cta': { const main = String(S.homeCta.main || '') || S.t('lead_default'); return `<a${attrs({ class: where === 'fab' ? 'shell-fab-b' : 'btn btn-sm', ...btnAttrs(headerCtaAttrs(S)), 'data-kf': it.id })}>${esc(main)}</a>`; }
    case 'up_button': return `<button type="button" class="${btnCls} shell-up" data-act="up" aria-label="${esc(it.name)}" title="${esc(it.name)}" data-kf="${dk}">${icon('chev')}</button>`;
    default: break;
  }
  if (it.page) return link(`#${it.page.route}`, esc(it.name));
  if (it.skipPage) return `<button type="button" class="${btnCls}" data-act="toast" data-toast="${esc(it.skipPage.ui_role === 'legal' ? S.t('toast_legal') : tv(S, 'toast_page'))}" data-kf="${dk}">${esc(it.name)}</button>`;
  return `<span class="${vCls}" data-kf="${dk}">${esc(it.value)}</span>`;
}
// новые элементы зоны (без уже стоящих в прежней разметке) - склеенная разметка
export function shellZoneHtml(S, menu, zone, where, filter = () => true) {
  if (!S.shell) return '';
  return S.shell.items.filter(it => it.zone === zone && filter(it) && !shellExisting(S, it, menu)).map(it => shellItemHtml(S, it, where)).join('');
}
const hdrPlace = it => it.state === 'chip' && (it.render === 'phone' || it.render === 'messengers');
// страница лидеров из шапки, которой нет в карте, - не кнопкой в шапке (шум и тупик), а в колонке «Информация» подвала
const hdrMoved = it => it.zone === 'header' && it.kind === 'page_link' && it.state === 'page_missing';
// шапка: чип телефона и мессенджеров - на месте телефона и значков, прочие - группой перед CTA
export function shellHeader(S, menu) {
  const one = r => S.shell.items.filter(it => it.zone === 'header' && it.render === r && hdrPlace(it)).map(it => shellItemHtml(S, it, 'hdr')).join('');
  const group = shellZoneHtml(S, menu, 'header', 'hdr', it => !hdrPlace(it) && !hdrMoved(it));
  return { phone: one('phone'), msgs: one('messengers'), group: group ? `<span class="shell-hdr">${group}</span>` : '' };
}
// телефон: новые элементы шапки - в мобильном меню (многостраничник) или полосой под шапкой (лендинг)
// нижняя панель выключена (off mbar) - туда же элементы зоны mobile
const mobExtra = (S, menu) => (S.off.has('mbar') ? shellZoneHtml(S, menu, 'mobile', 'mob') : '');
export function shellMnav(S, menu) {
  const h = shellZoneHtml(S, menu, 'header', 'mob', it => !hdrMoved(it)) + mobExtra(S, menu);
  return h ? `<div class="mnav-shell">${h}</div>` : '';
}
export function shellStrip(S, menu) {
  const h = shellZoneHtml(S, menu, 'header', 'mob', it => !hdrMoved(it)) + mobExtra(S, menu);
  return h ? `<div class="shell-strip">${h}</div>` : '';
}
// подвал: { rows (строки контактов), docs (строка документов), col (колонка «Информация») }
export function shellFooter(S, menu) {
  const rows = S.shell.items.filter(it => it.zone === 'footer' && it.kind === 'slot' && !shellExisting(S, it, menu))
    .map(it => { const h = shellItemHtml(S, it, 'fc'); return h ? `<div class="fc-row fc-kf">${icon(SHELL_ICON[it.render] || 'info')}<span>${h}</span></div>` : ''; }).join('');
  const docs = shellZoneHtml(S, menu, 'footer', 'fdoc', it => it.kind === 'function');
  const seenId = new Set();
  const links = S.shell.items.filter(it => (it.zone === 'footer' || hdrMoved(it)) && it.kind === 'page_link' && !shellExisting(S, it, menu))
    .filter(it => (seenId.has(it.id) ? false : (seenId.add(it.id), true))).map(it => shellItemHtml(S, it, 'fcol')).filter(Boolean);
  const col = links.length ? `<div class="fcol"><div class="fcol-h">${esc(tv(S, 'footer_info'))}</div><ul>${links.map(l => `<li>${l}</li>`).join('')}</ul></div>` : '';
  return { rows, docs, col };
}
// закрепленные элементы: плавающие кнопки
export function shellFabHtml(S, menu) {
  const h = shellZoneHtml(S, menu, 'fixed', 'fab');
  return h ? `<div class="shell-fab">${h}</div>` : '';
}
// заглушка блока лидеров без фактов (brief.stubs, программа 05.10 3.4): название и чип «нужны данные: <needs>»
export function stubHtml(S, stub) {
  const needs = (Array.isArray(stub.needs) ? stub.needs : []).map(s => String(s).trim()).filter(Boolean);
  const name = shellName(stub.name) || String(stub.type || '');
  const chip = `<span class="ph-need"${attrs({ 'data-kf': stub.kf_el ? String(stub.kf_el) : null })}>${esc(tv(S, 'need', { name: needs.length ? needs.join(', ') : lowerFirst(name) }))}</span>`;
  return `<div class="stub"><div class="stub-name">${esc(name)}</div><p class="stub-note">${esc(tv(S, 'stub_note'))}</p>${chip}</div>`;
}
// стили и скрипт оболочки в site.css и shell.html - между метками /*@shell*/ и /*@/shell*/: без оболочки вырезаются
// (файл прототипа совпадает с прежним), с оболочкой метки остаются комментариями
// (метка в начале строки - вместе с переводом строки после закрывающей, внутри строки - без него)
export const shellCut = (text, on) => (on ? String(text) : String(text)
  .replace(/(^|\n)\/\*@shell\*\/[\s\S]*?\/\*@\/shell\*\/\n?/g, '$1')
  .replace(/\/\*@shell\*\/[\s\S]*?\/\*@\/shell\*\//g, ''));

// ---------------------------------------------------------------- каталог (C5)
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const toNum = v => { if (typeof v === 'number') return Number.isFinite(v) ? v : null; const n = parseFloat(String(v ?? '').replace(/\s+/g, '').replace(',', '.')); return Number.isFinite(n) ? n : null; };
const fmtNum = n => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
export function sampleItems(S) {
  const raw = S.samples && Array.isArray(S.samples.items) ? S.samples.items : [];
  const mode = S.samples && S.samples.mode;
  const order = new Map(S.pages.map((x, i) => [x.slug, i]));
  return raw.filter(i => i && i.key && i.name).map(i => ({
    key: String(i.key), cat: String(i.category_slug ?? '*') || '*', name: String(i.name),
    price: toNum(i.price), note: String(i.price_note || ''), attrs: Array.isArray(i.attributes) ? i.attributes.filter(a => a && a.label && a.value) : [],
    facets: Object.fromEntries(Object.entries(i.facets && typeof i.facets === 'object' ? i.facets : {}).map(([k, v]) => [k, (Array.isArray(v) ? v : [v]).map(String).filter(Boolean)])),
    images: (Array.isArray(i.images) ? i.images : []).filter(x => typeof x === 'string' && x),
    site: (i.source || (mode === 'from_site' ? 'site' : 'illustrative')) === 'site',
  })).sort((a, b) => (order.get(a.cat) ?? 1e9) - (order.get(b.cat) ?? 1e9));
}
// выдача страницы: хаб с дочерними листингами - по примеру каждой дочерней категории; категория - свои примеры,
// иначе примеры родительской категории-листинга той же ветки, иначе карточка «*»; чужая категория не подставляется
export function listingPicks(S, page, items) {
  const of = slug => items.filter(i => i.cat === slug);
  const childListings = page.children.filter(c => c.listing);
  if (childListings.length) {
    const picks = childListings.map(c => of(c.slug)[0]).filter(Boolean);
    if (picks.length) return picks;
  }
  let own = of(page.slug);
  if (own.length) return own;
  for (let a = page.parent; a; a = a.parent) if (a.listing) { own = of(a.slug); if (own.length) return own; }
  return of('*');
}
function priceHtml(S, it) {
  if (it.price == null) return it.note ? `<span>${esc(it.note)}</span>` : '';
  return `${it.note ? `<small>${esc(it.note)}</small>` : ''}<span>${fmtNum(it.price)} ${esc(S.t('currency'))}</span>`;
}
function demoMark(S, it) { return `<span class="demo-mark">${esc(it && it.site ? S.t('demo_site') : S.t('demo'))}</span>`; }
export function cardHtml(S, it, photos, cardCta, opts = {}) {
  const t = S.t;
  const pc = it.images[0] ? photos.get(it.images[0]) : null;
  const img = `<div class="pcard-img${pc ? ' has-img' : ''}">${pc ? `<span class="pimg ${pc}" role="img" aria-label="${esc(it.name)}"></span>` : `<span class="pcard-ph">${esc(t('photo'))}</span>`}</div>`;
  const meta = it.attrs.slice(0, 3).map(a => `${esc(a.label)}: ${esc(a.value)}`).join(' · ');
  const body = `${img}<div class="pcard-b"><div class="pcard-name">${esc(it.name)}</div>${meta ? `<div class="pcard-meta">${meta}</div>` : ''}${priceHtml(S, it) ? `<div class="pcard-price">${priceHtml(S, it)}</div>` : ''}</div>`;
  const route = S.productPage ? `#${S.productPage.route}?item=${encodeURIComponent(it.key)}` : '';
  const a = route ? `<a class="pcard-a" href="${esc(route)}">${body}</a>` : `<div class="pcard-a">${body}</div>`;
  const main = String(cardCta.main || '');
  const sec = String(cardCta.secondary || '');
  const btn = main ? `<button type="button" class="btn btn-sm" data-act="lead" data-title="${esc(main)}" data-ref="${esc(it.name)}">${esc(main)}</button>` : '';
  const btn2 = sec && route ? `<a class="link-arrow" href="${esc(route)}">${esc(sec)}</a>` : '';
  const f = JSON.stringify(it.facets).replace(/</g, '\\u003c');
  return `<div class="pcard" data-demo="1" data-item="${esc(it.key)}" data-facets="${esc(f)}"${it.price != null ? ` data-price="${it.price}"` : ''} data-name="${esc(it.name.toLowerCase())}"${opts.copy ? ' data-copy="1"' : ''}>${demoMark(S, it)}${a}<div class="pcard-f">${btn}${btn2}</div></div>`;
}
export function templateCard(S, cardCta, extra = false) {
  const t = S.t;
  const main = String(cardCta.main || '');
  return `<div class="pcard pcard-tpl" data-demo="1"${extra ? ' data-tpl-x="1" hidden' : ''}><span class="demo-mark">${esc(t('card_template'))}</span><div class="pcard-a"><div class="pcard-img"><span class="pcard-ph">${esc(t('photo'))}</span></div><div class="pcard-b"><div class="pcard-name"><i class="tph">${esc(t('tpl_name'))}</i></div><div class="pcard-meta"><i class="tph">${esc(t('tpl_meta'))}</i></div><div class="pcard-price"><i class="tph">${esc(t('tpl_price'))}</i></div></div></div>${main ? `<div class="pcard-f"><button type="button" class="btn btn-sm" data-act="lead" data-title="${esc(main)}">${esc(main)}</button></div>` : ''}</div>`;
}
// Фильтры спецификации на странице-выдаче (K6): без categories (или пустой) - на всех выдачах; с categories - на
// странице, чей slug или slug предка в списке (хаб с listing - такая же страница). Одно имя дважды - первый подходящий.
const strList = v => (Array.isArray(v) ? v.map(x => String(x).trim()).filter(Boolean) : []);
const lineage = page => { const out = []; for (let p = page; p && !out.includes(p); p = p.parent) out.push(p); return out; };
export function pageFilters(S, page) {
  const spec = S.catalogSpec;
  if (!spec || !Array.isArray(spec.filters)) return [];
  const line = page ? lineage(page).map(p => p.slug) : [];
  // одно имя - один фильтр, самый точный для страницы: categories со slug страницы, затем ближайшего предка, затем
  // фильтр без categories (K6: одно имя с разными областями - свои значения у каждой ветки); порядок - первое появление
  // имени в спецификации, при равной точности - первый в спецификации
  const rank = f => { const cats = strList(f.categories); if (!cats.length) return Infinity; const i = line.findIndex(s => cats.includes(s)); return i < 0 ? -1 : i; };
  const best = new Map();
  for (const f of spec.filters) {
    if (!f || !f.name) continue;
    const r = rank(f);
    if (r < 0) continue;
    const k = String(f.name);
    if (!best.has(k) || r < best.get(k).r) best.set(k, { f, r });
  }
  return [...best.values()].map(x => x.f);
}
// значения фильтра на странице: values_by_category[slug страницы], иначе ближайшего предка, иначе values
function filterValues(f, page) {
  const vbc = f.values_by_category && typeof f.values_by_category === 'object' ? f.values_by_category : null;
  if (vbc && page) for (const p of lineage(page)) { const v = strList(vbc[p.slug]); if (v.length) return v; }
  return strList(f.values);
}
// группы панели фильтров страницы: из catalog-spec (фильтры страницы, значения и диапазон - по карточкам страницы
// items); до фазы 7 - имена групп из элемента filters писателя (плашки). labels - подписи чипов писателя фильтра.
export function panelGroups(S, page, items, writerFilters) {
  const spec = S.catalogSpec;
  const moneyNames = new Set(((spec && spec.card_fields) || []).filter(f => f && f.type === 'money').map(f => String(f.name)));
  if (spec && Array.isArray(spec.filters) && spec.filters.length) {
    // known - значения фильтра с этим именем во всей спецификации (values и values_by_category всех веток): по ним
    // chipTarget узнает в подписи значение, которого нет на этой странице (п.19)
    const knownOf = name => [...new Set(spec.filters.filter(f => f && String(f.name) === name).flatMap(f => [...strList(f.values),
      ...Object.values(f.values_by_category && typeof f.values_by_category === 'object' ? f.values_by_category : {}).flatMap(strList)]))];
    return pageFilters(S, page).map(f => {
      const name = String(f.name);
      const labels = strList(f.labels);
      const known = knownOf(name);
      const demo = f.values_source === 'competitor' || f.values_source === 'market_gap';
      if (f.type === 'toggle') return { name, labels, type: 'toggle', demo };
      if (f.type === 'search') return { name, labels, type: 'search', demo: false };
      if (f.type === 'range') {
        // фильтр цены - явное field: "price" (K6) или имя поля карточки типа money (старые спецификации)
        const field = f.field === 'price' || moneyNames.has(name) ? 'price' : 'facet';
        const nums = items.map(i => (field === 'price' ? i.price : toNum((i.facets[name] || [])[0]))).filter(n => n != null);
        let min = toNum(f.min), max = toNum(f.max);
        const step = toNum(f.step) || 1;
        const fromItems = min == null || max == null;
        if (fromItems && new Set(nums).size >= 2) { min = Math.min(...nums); max = Math.max(...nums); }
        const slider = min != null && max != null && max > min;
        return { name, labels, type: 'range', field, min: slider ? min : null, max: slider ? max : null, step, demo: demo || (fromItems && slider) };
      }
      const vals = filterValues(f, page);
      if (vals.length) return { name, labels, known, type: 'check', values: vals, demo };
      const fromItems = [...new Set(items.flatMap(i => i.facets[name] || []))];
      if (fromItems.length) return { name, labels, known, type: 'check', values: fromItems, demo: true };
      return { name, labels, known, type: 'need' };
    });
  }
  return (writerFilters || []).map(n => ({ name: String(n), labels: [], type: 'need' }));
}
// чип filters писателя: живой, если совпадает со значением (выбор значения), именем или подписью фильтра панели
// (раскрыть группу). Возврат { value } | { group } | null (неживой чип - надпись, check-html: html.chip-dead).
// Значения (п.19): чип, который называет значения, живой, только если каждое из них есть у фильтра на этой странице:
// иначе текст обещает значения, которых нет в каталоге, и чип остается надписью в списке check-html.
// - После двоеточия («Порода: дуб, бук»; признак - имя фильтра, его подпись или чип целиком в labels) - всегда значения.
// - Подпись labels без двоеточия - перечень значений, если хотя бы одна ее часть - значение этого фильтра (на этой странице
//   или в другой ветке спецификации, known): тогда значения - все ее части («Дуб, бук, венге» - неживой, даже если
//   «Венге» - подпись другого фильтра), а первая часть может начинаться с признака («Порода дуб и бук»).
// - Подпись без значений («Длина, см», «Материал, отделка», «Порода дерева») - фильтр другими словами: ее смысл подтвердил
//   автор спецификации (07-catalog-spec-writer п.5), слова фраз сборщик не разбирает. Одно значение не из каталога или
//   варианты словами («Для кухни и для офиса») сборщик от такой подписи не отличит: их не пускает в labels автор, ловит
//   аудитор ТЗ.
// - У диапазона, переключателя и поиска значений нет: такой чип живой по признаку («Цена: от и до»).
// Части перечня - через запятую, точку с запятой, косую черту, «и», «или»; значение с разделителем внутри («16,5»,
// «Столы и стулья») - одна часть, общее последнее слово («Белый и черный мрамор») - у каждой части. Сравнение без учета
// регистра, лишних пробелов, точки или многоточия в конце и разницы е и е с точками.
const ckey = s => String(s ?? '').replace(/[\s\u00a0]+/g, ' ').trim().replace(/[\s.\u2026]+$/, '').toLowerCase().replace(/\u0451/g, '\u0435');
// ключ значения: еще и без пробелов у запятой, точки с запятой и косой черты («16, 5» и «16,5» - одно)
const vkey = s => ckey(s).replace(/\s*([,;/])\s*/g, '$1');
const words = s => ckey(s).split(' ').filter(Boolean);
const NO_VALUES = new Set(['range', 'toggle', 'search']);
const LIST_SEP = /(\s*[,;/]\s*|\s+(?:\u0438|\u0438\u043b\u0438)\s+)/i;
// перечень: части (atoms) и разделители между ними; tails - последние слова последней части (общее слово перечня)
function lex(text) {
  const a = String(text).replace(/([,;/])(?:\s*[,;/])+/g, '$1').replace(/^[\s,;/]+|[\s,;/]+$/g, '').split(LIST_SEP);
  const atoms = a.filter((_, i) => i % 2 === 0), seps = a.filter((_, i) => i % 2 === 1);
  const lw = words(atoms[atoms.length - 1]);
  return { atoms, seps, tails: lw.slice(1).map((_, i) => lw.slice(i + 1).join(' ')) };
}
// одно слово в другой форме («породы» - «порода»): общее начало от 3 букв, расхождение не больше 2 букв с конца
const sameWord = (a, b) => { if (a === b) return true; let c = 0; while (c < a.length && c < b.length && a[c] === b[c]) c++; return c >= 3 && c >= Math.max(a.length, b.length) - 2; };
// начало подписи - признак фильтра или его первые слова («Порода дуб и бук» при подписи «Порода дерева»)
const sameFeature = (pre, feats) => feats.some(f => f.length >= pre.length && pre.every((w, i) => sameWord(w, f[i])));
// части atoms[i..j) вместе - значение из set (с общим словом перечня или без); feats - признаки фильтра по словам: с
// признака может начинаться первая часть подписи без двоеточия (признак - внутри первой части, значение - ее остаток);
// feats = true - любое начало (поиск значения в подписи: «Темный дуб, бук» - перечень, хотя признак не узнан)
function partOk(L, i, j, set, feats) {
  let s = L.atoms[i];
  for (let x = i + 1; x < j; x++) s += L.seps[x - 1] + L.atoms[x];
  const hit = v => !!v && (set.has(v) || L.tails.some(t => set.has(vkey(`${v} ${t}`))));
  const k = vkey(s);
  if (hit(k)) return true;
  if (!feats || i !== 0) return false;
  const w = k.split(' '), n0 = words(L.atoms[0]).length;
  for (let m = 1; m < n0; m++) if ((feats === true || sameFeature(w.slice(0, m), feats)) && hit(w.slice(m).join(' '))) return true;
  return false;
}
// весь текст делится на части-значения из set
function listOk(text, set, feats) {
  const L = lex(text), n = L.atoms.length, ok = [true];
  for (let j = 1; j <= n; j++) { ok[j] = false; for (let i = 0; i < j && !ok[j]; i++) ok[j] = ok[i] && partOk(L, i, j, set, feats); }
  return ok[n];
}
// в тексте есть хотя бы одна часть-значение из set
function anyValue(text, set, feats) {
  const L = lex(text), n = L.atoms.length;
  for (let i = 0; i < n; i++) for (let j = i + 1; j <= n; j++) if (partOk(L, i, j, set, feats)) return true;
  return false;
}
function chipOk(g, s) {
  const k = ckey(s);
  if (k === ckey(g.name)) return true;
  const labels = (g.labels || []).map(String);
  const inLabels = labels.some(l => ckey(l) === k);
  const have = new Set((g.values || []).map(vkey));
  const i = s.indexOf(':');
  if (i >= 0) {
    const feature = ckey(s.slice(0, i));
    const named = feature === ckey(g.name) || labels.some(l => !l.includes(':') && ckey(l) === feature);
    if (!inLabels && !named) return false;
    if (NO_VALUES.has(g.type)) return true;
    const rest = s.slice(i + 1);
    return !ckey(rest) || listOk(rest, have, null);
  }
  if (!inLabels) return false;
  if (NO_VALUES.has(g.type)) return true;
  const seen = new Set([...have, ...(g.known || []).map(vkey)]);
  if (!anyValue(s, seen, true)) return true;
  // признаки - имя фильтра и его подписи без двоеточия и без значений (не сам чип и не другой перечень)
  const feats = [g.name, ...labels.filter(l => !l.includes(':') && ckey(l) !== k && !anyValue(l, seen, true))].map(words);
  return listOk(s, have, feats);
}
export function chipTarget(groups, text) {
  const s = String(text ?? '').trim();
  if (!s) return null;
  const k = vkey(s);
  for (const g of groups) {
    if (g.type === 'check') { const v = g.values.find(x => vkey(x) === k); if (v != null) return { value: v }; }
    if (g.type === 'toggle' && vkey(g.name) === k) return { value: g.name };
  }
  for (const g of groups) if (chipOk(g, s)) return { group: g.name };
  return null;
}
// подпись кнопки карточки без card_cta спецификации (K7): CTA товара, затем главный и второй CTA страницы, затем CTA
// главной - только тот, что не ведет переходом (action page: или anchor: - это «выбрать в каталоге», а не заявка по
// позиции); иначе подпись окна заявки из словаря
const navAction = a => /^(page|anchor):/.test(String(a || '').trim());
export function cardCtaLabel(S, pageCta) {
  const c = pageCta || {};
  const prod = ctaObj(S.ctaByType && S.ctaByType.product);
  const home = S.homeCta || {};
  const cand = [[prod.main, prod.action], [c.main, c.action], [c.secondary, c.secondary_action], [home.main, home.action]];
  for (const [label, act] of cand) if (String(label || '').trim() && !navAction(act)) return String(label).trim();
  return S.t('lead_default');
}
function groupHtml(S, g) {
  const t = S.t;
  const mark = g.demo ? ` <span class="demo-mark">${esc(t('demo'))}</span>` : '';
  const head = `<button type="button" class="fgroup-h" data-act="fgroup">${esc(g.name)}${mark}${icon('chev')}</button>`;
  if (g.type === 'range') {
    const slider = g.min != null ? `<div class="range" data-range><div class="range-track"><div class="range-fill"></div></div><input type="range" class="r-min" min="${g.min}" max="${g.max}" step="${g.step}" value="${g.min}" aria-label="${esc(g.name)}"><input type="range" class="r-max" min="${g.min}" max="${g.max}" step="${g.step}" value="${g.max}" aria-label="${esc(g.name)}"></div>` : '';
    return `<div class="fgroup open" data-group="${esc(g.name)}" data-type="range" data-field="${g.field}"${g.min != null ? ` data-min="${g.min}" data-max="${g.max}"` : ''}>${head}<div class="fgroup-b">${slider}<div class="range-in"><label><span>${esc(t('range_from'))}</span><input type="text" inputmode="numeric" class="in-min"${g.min != null ? ` placeholder="${fmtNum(g.min)}"` : ''}></label><label><span>${esc(t('range_to'))}</span><input type="text" inputmode="numeric" class="in-max"${g.max != null ? ` placeholder="${fmtNum(g.max)}"` : ''}></label></div></div></div>`;
  }
  if (g.type === 'toggle') return `<div class="fgroup open" data-group="${esc(g.name)}" data-type="toggle">${head}<div class="fgroup-b"><label class="chk"><input type="checkbox" value="${esc(g.name)}"><span class="box">${icon('check')}</span><span>${esc(g.name)}</span></label></div></div>`;
  if (g.type === 'search') return `<div class="fgroup open" data-group="${esc(g.name)}" data-type="search">${head}<div class="fgroup-b"><input type="search" class="fsearch" aria-label="${esc(g.name)}"></div></div>`;
  if (g.type === 'need') return `<div class="fgroup" data-group="${esc(g.name)}" data-type="need">${head}<div class="fgroup-b"><p class="fneed"><span class="need">${esc(t('need_data'))}</span></p></div></div>`;
  const LIMIT = 6;
  const items = g.values.map((v, k) => `<label class="chk${k >= LIMIT ? ' more' : ''}"><input type="checkbox" value="${esc(v)}"><span class="box">${icon('check')}</span><span>${esc(v)}</span></label>`).join('');
  const more = g.values.length > LIMIT ? `<button type="button" class="fmore" data-act="fmore">${esc(t('show_more'))}</button>` : '';
  return `<div class="fgroup open" data-group="${esc(g.name)}" data-type="check">${head}<div class="fgroup-b">${items}${more}</div></div>`;
}
// Компонент каталога на странице listing: true: вводные элементы писателя сверху (дословно), чипы filters писателя,
// панель фильтров, выдача с пометками «пример», пагинация статично; ссылки и кнопки писателя - под выдачей.
export function catalogHtml(S, page, block, eng, bctx, photos, items) {
  const t = S.t;
  const spec = S.catalogSpec;
  const els = block ? block.elements || [] : [];
  const writerFilters = els.filter(e => e.kind === 'filters').flatMap(e => e.items || []);
  const headEls = els.filter(e => !['filters', 'link', 'button'].includes(e.kind));
  const afterEls = els.filter(e => e.kind === 'link' || e.kind === 'button');
  const R = list => list.map(el => eng.renderEl(el, bctx)).join('\n');
  // выдача страницы; панель фильтров - по фильтрам этой страницы (K6), значения и диапазон - по ее карточкам
  const picks = listingPicks(S, page, items);
  const groups = panelGroups(S, page, picks, writerFilters);
  // чипы filters писателя - дословно; чип, совпавший со значением, именем или подписью фильтра панели, живой
  const quick = els.filter(e => e.kind === 'filters').map(e => `<div class="quick"${e.facts && e.facts.length ? ` data-f="${esc(e.facts.join(' '))}"` : ''}>${(e.items || []).map(v => {
    const tg = chipTarget(groups, v);
    if (!tg) return `<span class="qchip">${eng.inline(v, false)}</span>`;
    const at = tg.value != null ? { 'data-value': tg.value } : { 'data-group': tg.group };
    return `<button type="button" class="qchip" data-act="qchip"${attrs(at)} aria-pressed="false">${eng.inline(v, false)}</button>`;
  }).join('')}</div>`).join('');
  // хаб с дочерними листингами: строка разделов (миниатюра примера и название) над выдачей
  const kidsL = page.children.filter(c => c.listing && !c.template && !c.role && c.route);
  const kidStrip = kidsL.length >= 2 ? `<nav class="cat-kids" aria-label="${esc(page.name || page.title)}">${kidsL.map(c => `<a class="ckid" href="#${esc(c.route)}">${thumb(S, c, photos, 'ckid-img')}<span class="ckid-l">${esc(c.name)}</span></a>`).join('')}</nav>` : '';
  const cardCta = ctaObj(spec && spec.card_cta);
  if (!cardCta.main) cardCta.main = cardCtaLabel(S, bctx.pc.cta);
  const per = clamp(Math.round(toNum(spec && spec.listing && spec.listing.cards_per_page) || 12), 6, 24);
  let cards;
  if (picks.length) {
    const list = Array.from({ length: per }, (_, i) => cardHtml(S, picks[i % picks.length], photos, cardCta, { copy: i >= picks.length }));
    cards = `${list.join('\n')}\n${[0, 1, 2].map(() => templateCard(S, cardCta, true)).join('\n')}`;
  } else cards = Array.from({ length: per }, () => templateCard(S, cardCta)).join('\n');
  const sorting = spec && Array.isArray(spec.sorting) && spec.sorting.length ? `<label class="sort"><span>${esc(t('sort'))}</span><select aria-label="${esc(t('sort'))}">${spec.sorting.map(s => `<option>${esc(s)}</option>`).join('')}</select>${icon('chev')}</label>` : '';
  const pager = `<div class="cat-more"><button type="button" class="btn secondary" data-act="toast" data-toast="${esc(t('toast_pager'))}">${esc(t('show_more'))}</button><nav class="pager" aria-label="${esc(t('show_more'))}"><span class="on">1</span><button type="button" data-act="toast" data-toast="${esc(t('toast_pager'))}">2</button><button type="button" data-act="toast" data-toast="${esc(t('toast_pager'))}">3</button><button type="button" data-act="toast" data-toast="${esc(t('toast_pager'))}" aria-label="${esc(t('next'))}">${icon('right')}</button></nav></div>`;
  const note = `<p class="cat-note">${icon('info')}<span>${esc(picks.length ? t('listing_note_ex') : t('listing_note_tpl'))}</span></p>`;
  const panel = `<aside class="cat-side" data-side><div class="cat-side-h"><b>${esc(t('filters'))}</b><button type="button" class="icon-btn" data-act="side-close" aria-label="${esc(t('close'))}">${icon('close')}</button></div>${groups.length ? `<p class="fnote">${esc(t('filter_note'))}</p>${groups.map(g => groupHtml(S, g)).join('\n')}` : ''}<div class="cat-side-f"><button type="button" class="btn btn-block" data-act="side-close">${esc(t('show'))}</button><button type="button" class="btn secondary btn-block" data-act="reset">${esc(t('reset'))}</button></div></aside>`;
  const html = `${headEls.length ? `<div class="cat-head stack">${R(headEls)}</div>` : ''}${quick}${kidStrip}<div class="catalog" data-catalog>${panel}<div class="cat-main"><div class="cat-bar"><button type="button" class="btn-filters" data-act="side-open">${icon('filter')}<span>${esc(t('filters'))}</span><span data-filters-n></span></button><div class="chips" data-chips></div>${sorting}</div><p class="cat-note cat-note-f" data-nomatch hidden>${icon('info')}<span>${esc(t('no_example'))}</span></p><div class="pgrid" data-grid>${cards}</div>${note}${pager}</div></div>${afterEls.length ? `<div class="cat-after">${R(afterEls)}</div>` : ''}`;
  return { html, groups, picks, per };
}
// Секция «пример карточки» страницы type product: по примеру на каждый key (показывается выбранный ?item=, иначе первый)
export function productHtml(S, photos, items, pageCta) {
  const t = S.t;
  const spec = S.catalogSpec;
  const cardCta = ctaObj(spec && spec.card_cta);
  const main = String(cardCta.main || cardCtaLabel(S, pageCta));
  const field = (label, type) => `<label class="field"><span class="field-l">${esc(label)}</span><input type="${type}"${type === 'tel' ? ` placeholder="${esc(t('tel_placeholder'))}" autocomplete="tel"` : ' autocomplete="name"'}></label>`;
  const quick = `<div class="quick-form" data-form-scope data-behavior="form"><div class="qf-t">${esc(t('quick_order'))}</div><div class="qf-row">${field(t('field_name'), 'text')}${field(t('field_phone'), 'tel')}</div><button type="button" class="btn" data-act="submit">${esc(t('send'))}</button><p class="consent">${esc(t('consent'))}</p></div>`;
  const one = (it, first) => {
    const imgs = it.images.map(p => photos.get(p)).filter(Boolean);
    const mainImg = imgs[0] ? `<div class="pp-main has-img"><span class="pimg ${imgs[0]}" data-main role="img" aria-label="${esc(it.name)}"></span></div>` : `<div class="pp-main"><span class="pcard-ph">${esc(t('photo'))}</span></div>`;
    const thumbs = imgs.length > 1 ? `<div class="pp-thumbs">${imgs.map((c, i) => `<button type="button" class="thumb has-img${i === 0 ? ' on' : ''}" data-act="thumb" data-img="${c}" aria-label="${esc(t('photo'))} ${i + 1}"><span class="pimg ${c}"></span></button>`).join('')}</div>` : '';
    const specs = it.attrs.length ? `<dl class="specs">${it.attrs.map(a => `<div><dt>${esc(a.label)}</dt><dd>${esc(a.value)}</dd></div>`).join('')}</dl>` : '';
    const price = priceHtml(S, it);
    return `<div class="pp-item" data-item="${esc(it.key)}" data-demo="1"${first ? '' : ' hidden'}><div class="pp-grid"><div class="pp-gal${thumbs ? '' : ' one'}" data-gallery>${thumbs}${mainImg}</div><div class="pp-info"><div class="pp-name">${esc(it.name)}</div>${demoMark(S, it)}${price ? `<div class="pp-price">${price}</div>` : ''}${specs}<div class="pp-actions"><button type="button" class="btn" data-act="lead" data-title="${esc(main)}" data-ref="${esc(it.name)}">${esc(main)}</button></div>${quick}</div></div></div>`;
  };
  const tpl = `<div class="pp-item" data-item="_tpl" data-demo="1"><div class="pp-grid"><div class="pp-gal one"><div class="pp-main"><span class="pcard-ph">${esc(t('photo'))}</span></div></div><div class="pp-info"><div class="pp-name"><i class="tph">${esc(t('tpl_name'))}</i></div><span class="demo-mark">${esc(t('card_template'))}</span><div class="pp-price"><i class="tph">${esc(t('tpl_price'))}</i></div><dl class="specs"><div><dt><i class="tph">${esc(t('tpl_meta'))}</i></dt><dd></dd></div></dl><div class="pp-actions"><button type="button" class="btn" data-act="lead" data-title="${esc(main)}">${esc(main)}</button></div>${quick}</div></div></div>`;
  const body = items.length ? items.map((it, i) => one(it, i === 0)).join('\n') : tpl;
  return `<section class="blk pp-sec" data-module="product" data-behavior="product"><div class="container"><p class="pp-ex">${icon('info')}<span>${esc(t('product_example'))}</span></p>${body}</div></section>`;
}
export function searchHtml(S) {
  const t = S.t;
  return `<section class="blk search-sec" data-module="search" data-behavior="search"><div class="container"><div class="search-big">${icon('search')}<input type="search" data-search-input placeholder="${esc(t('search_placeholder'))}" aria-label="${esc(t('search'))}"></div><div class="search-res" data-search-res></div></div></section>`;
}
export function cartHtml(S, formAnchor, hubRoute) {
  const t = S.t;
  const field = (label, type) => `<label class="field"><span class="field-l">${esc(label)}</span><input type="${type}"${type === 'tel' ? ` placeholder="${esc(t('tel_placeholder'))}" autocomplete="tel"` : ' autocomplete="name"'}></label>`;
  // поля оформления - из блока-формы страницы (прокрутка к нему), иначе запасной набор из словаря
  const checkout = formAnchor
    ? `<button type="button" class="btn btn-block" data-act="scroll" data-target="${esc(formAnchor)}">${esc(t('cart_checkout'))}</button>`
    : `<div class="stack" data-form-scope>${field(t('field_name'), 'text')}${field(t('field_phone'), 'tel')}<button type="button" class="btn btn-block" data-act="submit">${esc(t('cart_checkout'))}</button><p class="consent">${esc(t('consent'))}</p></div>`;
  return `<section class="blk cart-sec" data-module="cart" data-behavior="cart"><div class="container"><div class="cartv" data-cartview><div class="cart-empty"><div class="wip-t">${esc(t('cart_empty'))}</div><button type="button" class="btn" data-act="cart-demo">${esc(t('cart_put_example'))}</button>${hubRoute ? `<a class="link-arrow" href="#${esc(hubRoute)}">${esc(t('cart_to_catalog'))} ${icon('arrow')}</a>` : ''}</div><div class="cart-full"><div class="cart-items" data-cart-items></div><aside class="cart-sum"><div class="sum-row"><span>${esc(t('cart_total'))}</span><b data-cart-total></b></div>${checkout}</aside></div></div></div></section>`;
}
export function accountHtml(S) {
  const t = S.t;
  return `<section class="blk acc-sec" data-module="account"><div class="container"><div class="acc-stub"><div class="wip-t">${esc(t('account_title'))}</div><p class="muted">${esc(t('account_text'))}</p><button type="button" class="btn" data-act="toast" data-toast="${esc(t('toast_account'))}">${esc(t('account_login'))}</button></div></div></section>`;
}
export function mapBoxHtml(S) {
  if (!S.mapsHref) return null;
  const t = S.t;
  return `<div class="map-box"><div class="map" role="img" aria-label="${esc(t('map_label'))}: ${esc(S.contacts.address)}"><span class="map-pin">${icon('pin')}</span><span>${esc(S.contacts.address)}</span></div><a class="link-arrow" href="${esc(S.mapsHref)}" target="_blank" rel="noopener">${esc(t('map_route'))} ${icon('arrow')}</a></div>`;
}
// Секция карты, которую сборщик добавляет на страницу контактов без блока с картой (адрес известен): слева адрес и
// часы работы из company, справа заглушка карты со ссылкой «Построить маршрут». Не блок писателя: без data-block-id.
export function mapSectionHtml(S, cls = 'blk') {
  const box = mapBoxHtml(S);
  if (!box) return '';
  const t = S.t;
  const c = S.contacts;
  const row = (label, value) => `<div class="map-row"><span class="map-l">${esc(label)}</span><span class="map-v">${esc(value)}</span></div>`;
  const info = [row(t('label_address'), c.address), c.hours ? row(t('label_hours'), c.hours) : ''].join('');
  return `<section class="${esc(cls)} blk-map" data-module="map"><div class="container"><div class="cols cols-2 map-sec"><div class="stack map-info">${info}</div>${box}</div></div></section>`;
}

// ---------------------------------------------------------------- реестр поведений
// pattern -> { behavior, script? }. behavior - имя функции в скрипте страницы (вызывается для секции с
// data-behavior при каждом показе маршрута); script - ее код (function (root, S) {...}, может вернуть { show(q) }).
// Блоки вне реестра - статичные, но оформленные. Поля (field) и вопросы (qa) в любом блоке включают form и accordion.
const JS = {
  form: `function (root, S) {
  root.addEventListener('change', function (e) {
    var i = e.target;
    if (!i || !i.hasAttribute || !i.hasAttribute('data-file')) return;
    var f = i.closest('.field'), s = f && f.querySelector('[data-file-name]');
    if (s) s.textContent = i.files && i.files[0] ? i.files[0].name : S.t('file_attach');
  });
  return {};
}`,
  accordion: `function (root, S) {
  S.$$('details', root).forEach(function (d) {
    d.addEventListener('toggle', function () {
      if (!d.open) return;
      S.$$('details', root).forEach(function (o) { if (o !== d && o.open) o.open = false; });
    });
  });
  return {};
}`,
  slider: `function (root, S) {
  var track = S.$('[data-slider]', root);
  root.addEventListener('click', function (e) {
    var b = e.target && e.target.closest ? e.target.closest('[data-act="slide"]') : null;
    if (!b || !track) return;
    var step = (track.clientWidth || 600) * 0.8 * (+b.getAttribute('data-dir') || 1);
    if (typeof track.scrollBy === 'function') track.scrollBy({ left: step, behavior: 'smooth' }); else track.scrollLeft += step;
  });
  return {};
}`,
  catalog: `function (root, S) {
  var $ = S.$, $$ = S.$$;
  var side = $('[data-side]', root);
  function groups() { return $$('.fgroup', root); }
  function num(s) { var v = parseFloat(String(s == null ? '' : s).replace(/\\s+/g, '').replace(',', '.')); return isNaN(v) ? null : v; }
  function arr(v) { return Array.isArray(v) ? v : (v == null || v === '' ? [] : [v]); }
  function state() {
    var st = { sel: {}, toggles: [], ranges: [], q: '', n: 0 };
    groups().forEach(function (g) {
      var name = g.getAttribute('data-group'), type = g.getAttribute('data-type');
      if (type === 'range') {
        var a = num(($('.in-min', g) || {}).value), b = num(($('.in-max', g) || {}).value);
        var lo = num(g.getAttribute('data-min')), hi = num(g.getAttribute('data-max'));
        if ((a != null && (lo == null || a > lo)) || (b != null && (hi == null || b < hi))) { st.ranges.push({ name: name, field: g.getAttribute('data-field') || '', a: a, b: b }); st.n++; }
      } else if (type === 'toggle') {
        var c = $('input[type=checkbox]', g); if (c && c.checked) { st.toggles.push(name); st.n++; }
      } else if (type === 'search') {
        var q = String(($('.fsearch', g) || {}).value || '').trim().toLowerCase(); if (q) { st.q = q; st.n++; }
      } else {
        $$('input[type=checkbox]:checked', g).forEach(function (i) { (st.sel[name] = st.sel[name] || []).push(i.value); st.n++; });
      }
    });
    return st;
  }
  function facetsOf(c) { try { return JSON.parse(c.getAttribute('data-facets') || '{}') || {}; } catch (e) { return {}; } }
  function match(c, st) {
    var f = facetsOf(c), k, i;
    for (k in st.sel) { var have = arr(f[k]).map(String); if (!st.sel[k].some(function (x) { return have.indexOf(x) >= 0; })) return false; }
    for (i = 0; i < st.toggles.length; i++) if (!arr(f[st.toggles[i]]).length) return false;
    for (i = 0; i < st.ranges.length; i++) {
      var r = st.ranges[i], v = r.field === 'price' ? num(c.getAttribute('data-price')) : num(arr(f[r.name])[0]);
      if (v == null || (r.a != null && v < r.a) || (r.b != null && v > r.b)) return false;
    }
    return !(st.q && String(c.getAttribute('data-name') || '').indexOf(st.q) < 0);
  }
  function chips(st) {
    var box = $('[data-chips]', root), html = '';
    groups().forEach(function (g) {
      var name = g.getAttribute('data-group'), tg = g.getAttribute('data-type') === 'toggle';
      $$('input[type=checkbox]:checked', g).forEach(function (i) { html += '<button type="button" class="chip" data-act="chip" data-group="' + S.esc(name) + '" data-value="' + S.esc(i.value) + '">' + S.esc(tg ? name : i.value) + S.icon('close') + '</button>'; });
    });
    st.ranges.forEach(function (r) { html += '<button type="button" class="chip" data-act="chip" data-group="' + S.esc(r.name) + '" data-value="">' + S.esc(r.name) + ': ' + (r.a != null ? S.fmt(r.a) : '') + ' - ' + (r.b != null ? S.fmt(r.b) : '') + S.icon('close') + '</button>'; });
    if (st.q) html += '<button type="button" class="chip" data-act="chip" data-group="" data-value="">' + S.esc(st.q) + S.icon('close') + '</button>';
    if (html) html += '<button type="button" class="chip-reset" data-act="reset">' + S.esc(S.t('reset')) + '</button>';
    if (box) box.innerHTML = html;
    $$('.qchip[data-value]', root).forEach(function (q) {
      var on = $$('input[type=checkbox]', root).some(function (i) { return i.checked && i.value === q.getAttribute('data-value'); });
      q.classList.toggle('on', on); q.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    var bf = $('[data-filters-n]', root); if (bf) bf.textContent = st.n ? ' (' + st.n + ')' : '';
  }
  function apply() {
    var st = state(), cards = $$('.pcard[data-facets]', root), shown = 0;
    cards.forEach(function (c) { var ok = match(c, st); c.hidden = !ok; if (ok) shown++; });
    var none = cards.length > 0 && shown === 0;
    $$('[data-tpl-x]', root).forEach(function (c) { c.hidden = !none; });
    var nm = $('[data-nomatch]', root); if (nm) nm.hidden = !none;
    chips(st);
  }
  function paint(g) {
    var ra = $('.r-min', g), rb = $('.r-max', g), fill = $('.range-fill', g);
    if (!ra || !rb || !fill) return;
    var lo = +g.getAttribute('data-min'), hi = +g.getAttribute('data-max'), span = (hi - lo) || 1;
    fill.style.left = ((+ra.value - lo) / span * 100) + '%';
    fill.style.right = (100 - (+rb.value - lo) / span * 100) + '%';
  }
  function resetRange(g) {
    var a = $('.in-min', g), b = $('.in-max', g), ra = $('.r-min', g), rb = $('.r-max', g);
    if (a) a.value = ''; if (b) b.value = '';
    if (ra) ra.value = g.getAttribute('data-min'); if (rb) rb.value = g.getAttribute('data-max');
    paint(g);
  }
  function reset() {
    groups().forEach(function (g) {
      $$('input[type=checkbox]', g).forEach(function (i) { i.checked = false; });
      if (g.getAttribute('data-type') === 'range') resetRange(g);
      var s = $('.fsearch', g); if (s) s.value = '';
    });
    apply();
  }
  function clearChip(b) {
    var name = b.getAttribute('data-group'), val = b.getAttribute('data-value');
    groups().forEach(function (g) {
      var type = g.getAttribute('data-type');
      if (!name) { if (type === 'search') { var s = $('.fsearch', g); if (s) s.value = ''; } return; }
      if (g.getAttribute('data-group') !== name) return;
      if (type === 'range') { resetRange(g); return; }
      $$('input[type=checkbox]', g).forEach(function (i) { if (i.value === val) i.checked = false; });
    });
    apply();
  }
  root.addEventListener('change', function (e) { if (e.target && e.target.type === 'checkbox') apply(); });
  root.addEventListener('input', function (e) {
    var tg = e.target, g = tg && tg.closest ? tg.closest('.fgroup') : null;
    if (!g) return;
    if (tg.classList.contains('r-min') || tg.classList.contains('r-max')) {
      var ra = $('.r-min', g), rb = $('.r-max', g);
      if (+ra.value > +rb.value) { if (tg === ra) ra.value = rb.value; else rb.value = ra.value; }
      var a = $('.in-min', g), b = $('.in-max', g); if (a) a.value = ra.value; if (b) b.value = rb.value;
      paint(g);
    }
    apply();
  });
  root.addEventListener('click', function (e) {
    var b = e.target && e.target.closest ? e.target.closest('[data-act]') : null;
    if (!b || !root.contains(b)) return;
    var act = b.getAttribute('data-act');
    if (act === 'fgroup') { b.parentNode.classList.toggle('open'); return; }
    if (act === 'fmore') { var g = b.closest('.fgroup'); g.classList.toggle('show-more'); b.textContent = g.classList.contains('show-more') ? S.t('collapse') : S.t('show_more'); return; }
    if (act === 'side-open') { if (side) { side.classList.add('open'); S.lock(); } return; }
    if (act === 'side-close') { if (side) { side.classList.remove('open'); S.unlock(); } return; }
    if (act === 'reset') { reset(); return; }
    if (act === 'chip') { clearChip(b); return; }
    if (act === 'qchip') {
      var v = b.getAttribute('data-value'), gname = b.getAttribute('data-group') || v, hit = null, grp = null;
      if (v != null) $$('input[type=checkbox]', root).forEach(function (i) { if (!hit && i.value === v) hit = i; });
      if (hit) { hit.checked = !hit.checked; var gg = hit.closest('.fgroup'); if (gg) gg.classList.add('open'); apply(); return; }
      groups().forEach(function (g2) { if (!grp && g2.getAttribute('data-group') === gname) grp = g2; });
      if (grp) { grp.classList.add('open'); grp.classList.remove('flash'); void grp.offsetWidth; grp.classList.add('flash'); if (side && !S.desk()) { side.classList.add('open'); S.lock(); } }
    }
  });
  groups().forEach(function (g) { if (g.getAttribute('data-type') === 'range') paint(g); });
  return { show: function () { reset(); if (side && side.classList.contains('open')) { side.classList.remove('open'); S.unlock(); } } };
}`,
  search: `function (root, S) {
  var input = S.$('[data-search-input]', root), res = S.$('[data-search-res]', root), idx = S.data.search || [];
  function render() {
    if (!res) return;
    var raw = String(input ? input.value : '').trim(), v = raw.toLowerCase();
    if (!v) { res.innerHTML = '<p class="muted">' + S.esc(S.t('search_hint')) + '</p>'; return; }
    var hits = idx.filter(function (x) { return String(x.l || '').indexOf(v) >= 0; }).slice(0, 40);
    res.innerHTML = hits.length
      ? '<p class="muted">' + S.esc(S.t('search_found')) + ': ' + S.esc(raw) + '</p><ul class="sres">' + hits.map(function (h) { return '<li><a href="#' + S.esc(h.r) + '"><span>' + S.esc(h.t) + '</span>' + (h.d ? '<small>' + S.esc(h.d) + '</small>' : '') + '</a></li>'; }).join('') + '</ul>'
      : '<p class="muted">' + S.esc(S.t('search_none')) + ': ' + S.esc(raw) + '</p>';
  }
  if (input) input.addEventListener('input', render);
  return { show: function (q) { if (input) input.value = q.q || ''; render(); } };
}`,
  cart: `function (root, S) {
  var C = S.data.cart || {}, items = S.data.items || {};
  function load() {
    var st = S.store.get(C.key);
    if (!st || typeof st !== 'object' || !st.items || typeof st.items !== 'object') {
      st = { items: {} };
      if (C.demo && items[C.demo]) st.items[C.demo] = 1;
      S.store.set(C.key, st);
    }
    return st;
  }
  var st = load();
  function render() {
    var box = S.$('[data-cart-items]', root), total = 0, unknown = false, n = 0, html = '';
    Object.keys(st.items).forEach(function (k) {
      var q = +st.items[k] || 0, it = items[k];
      if (!it || q <= 0) return;
      n += q;
      var p = typeof it.price === 'number' ? it.price : null;
      if (p == null) unknown = true; else total += p * q;
      html += '<div class="citem" data-key="' + S.esc(k) + '"><div class="citem-img' + (it.img ? ' has-img' : '') + '">' + (it.img ? '<span class="pimg ' + S.esc(it.img) + '"></span>' : '') + '</div>'
        + '<div class="citem-t"><div>' + S.esc(it.name) + '</div><span class="demo-mark">' + S.esc(it.site ? S.t('demo_site') : S.t('demo')) + '</span></div>'
        + '<div class="qty"><button type="button" data-act="qty" data-d="-1" aria-label="' + S.esc(S.t('qty_minus')) + '">-</button><span>' + q + '</span><button type="button" data-act="qty" data-d="1" aria-label="' + S.esc(S.t('qty_plus')) + '">+</button></div>'
        + '<div class="citem-p">' + (p == null ? '<span class="need">' + S.esc(S.t('need_data')) + '</span>' : S.fmt(p * q) + ' ' + S.esc(S.t('currency'))) + '</div>'
        + '<button type="button" class="icon-btn" data-act="cart-remove" aria-label="' + S.esc(S.t('cart_remove')) + '">' + S.icon('close') + '</button></div>';
    });
    if (box) box.innerHTML = html;
    var v = S.$('[data-cartview]', root); if (v) v.classList.toggle('has', n > 0);
    var tt = S.$('[data-cart-total]', root);
    if (tt) tt.innerHTML = unknown ? '<span class="need">' + S.esc(S.t('need_data')) + '</span>' : S.fmt(total) + ' ' + S.esc(S.t('currency'));
    S.badge();
  }
  function save() { S.store.set(C.key, st); render(); }
  root.addEventListener('click', function (e) {
    var b = e.target && e.target.closest ? e.target.closest('[data-act]') : null;
    if (!b || !root.contains(b)) return;
    var act = b.getAttribute('data-act'), row = b.closest('[data-key]'), k = row && row.getAttribute('data-key');
    if (act === 'qty' && k) { st.items[k] = Math.max(0, (+st.items[k] || 0) + (+b.getAttribute('data-d') || 0)); if (!st.items[k]) delete st.items[k]; save(); return; }
    if (act === 'cart-remove' && k) { delete st.items[k]; save(); return; }
    if (act === 'cart-demo' && C.demo && items[C.demo]) { st.items[C.demo] = (+st.items[C.demo] || 0) + 1; save(); S.toast(S.t('toast_added')); }
  });
  return { show: function () { st = load(); render(); } };
}`,
  product: `function (root, S) {
  function pick(key) {
    var list = S.$$('[data-item]', root), hit = null;
    list.forEach(function (i) { if (!hit && key && i.getAttribute('data-item') === key) hit = i; });
    if (!hit) hit = list[0];
    list.forEach(function (i) { i.hidden = i !== hit; });
  }
  root.addEventListener('click', function (e) {
    var b = e.target && e.target.closest ? e.target.closest('[data-act="thumb"]') : null;
    if (!b || !root.contains(b)) return;
    var it = b.closest('[data-item]'), main = it && S.$('[data-main]', it);
    if (main) main.className = 'pimg ' + b.getAttribute('data-img');
    S.$$('[data-act="thumb"]', it).forEach(function (x) { x.classList.toggle('on', x === b); });
  });
  return { show: function (q) { pick(q.item || ''); } };
}`,
};
// render - встроенный модуль, который рисует блок сам: map - карта с адресом и «Построить маршрут» (mapBoxHtml, в слот
// карты или колонку раскладки по умолчанию), catalog - компонент каталога (catalogHtml) на странице listing: true.
// Поведение модуля ставит его секция; остальным блокам - по записи реестра.
// Ключ записи: 'type:<id блока типа>' (латинский slug из page-types, например 'type:calc') - для нового вида блока, который
// приходит как pattern custom (калькулятор, квиз, «до/после»): запись включает поведение только этому блоку типа, другие
// custom-блоки остаются статичными; иначе ключ - pattern (общее поведение всех блоков этого pattern).
// requires - строка, которая должна быть в разметке секции (иначе поведение не ставится, блок статичный).
export const REGISTRY = {
  form: { behavior: 'form' },
  accordion: { behavior: 'accordion' },
  'cards-slider': { behavior: 'slider', requires: 'data-slider=' },
  gallery: { behavior: 'slider', requires: 'data-slider=' },
  map: { behavior: '', render: 'map' },
  listing: { behavior: 'catalog', render: 'catalog' },
};
// Реестр проекта (K8, идея 9): html/site/registry.json и html/site/behaviors/<name>.js (+ <name>.css) копии kit задачи -
// туда их кладет task.mjs place из overrides/html/site/. Ключ записи проекта - 'type:<id блока типа>', custom_name блока
// (без учета регистра) или pattern; значение - { behavior, requires? } или строка-имя поведения. Код поведения -
// выражение function (root, S) {...}; поведение проекта с именем поведения kit заменяет его. Нет файлов - поведение kit.
const PROJECT = { entries: {}, byName: {}, scripts: {}, css: {}, keys: [] };
const jsFn = code => { try { return typeof new Function(`"use strict"; return (${code}\n);`)() === 'function'; } catch { return false; } };
// Возврат { problems: [{ code: js|json|shape|no-behavior|unknown-behavior, file?, key?, behavior?, detail? }], keys,
// behaviors } - сообщения оператору печатает сборщик.
export function loadProjectRegistry(dir = P('html', 'site')) {
  const problems = [];
  PROJECT.entries = {}; PROJECT.byName = {}; PROJECT.scripts = {}; PROJECT.css = {}; PROJECT.keys = [];
  const bdir = path.join(dir, 'behaviors');
  if (exists(bdir)) {
    for (const f of fs.readdirSync(bdir).sort()) {
      const m = f.match(/^([A-Za-z0-9_-]+)\.(js|css)$/);
      if (!m) continue;
      const text = fs.readFileSync(path.join(bdir, f), 'utf8').replace(/^\uFEFF/, '').trim();
      if (m[2] === 'css') { PROJECT.css[m[1]] = text; continue; }
      const code = text.replace(/^export\s+default\s+/, '').replace(/;\s*$/, '');
      if (!jsFn(code)) { problems.push({ code: 'js', file: f }); continue; }
      PROJECT.scripts[m[1]] = code;
    }
  }
  const rf = path.join(dir, 'registry.json');
  if (exists(rf)) {
    let reg = null;
    try { reg = JSON.parse(fs.readFileSync(rf, 'utf8').replace(/^\uFEFF/, '')); } catch (e) { problems.push({ code: 'json', detail: e.message }); }
    if (reg && typeof reg === 'object' && !Array.isArray(reg)) {
      for (const [key, v] of Object.entries(reg)) {
        if (key.startsWith('_')) continue;
        const e = typeof v === 'string' ? { behavior: v } : v && typeof v === 'object' ? { behavior: String(v.behavior || ''), ...(v.requires ? { requires: String(v.requires) } : {}) } : null;
        if (!e || !e.behavior) { problems.push({ code: 'no-behavior', key }); continue; }
        if (!PROJECT.scripts[e.behavior] && !JS[e.behavior] && !Object.values(REGISTRY).some(r => r.behavior === e.behavior && r.script)) { problems.push({ code: 'unknown-behavior', key, behavior: e.behavior }); continue; }
        e.project = true;
        if (key.startsWith('type:')) PROJECT.entries[key] = e; else PROJECT.byName[key.trim().toLowerCase()] = e;
        PROJECT.keys.push(key);
      }
    } else if (reg) problems.push({ code: 'shape' });
  }
  return { problems, keys: [...PROJECT.keys], behaviors: Object.keys(PROJECT.scripts) };
}
// запись реестра блока: 'type:<id>' (проект, kit) -> custom_name (проект) -> pattern (проект, kit)
export const registryEntry = spec => {
  if (!spec) return null;
  const t = spec.type ? `type:${spec.type}` : '';
  const cn = String(spec.custom_name || '').trim().toLowerCase();
  const pt = String(spec.pattern || '').trim().toLowerCase();
  return (t && (PROJECT.entries[t] || REGISTRY[t])) || (cn && PROJECT.byName[cn]) || (pt && PROJECT.byName[pt]) || REGISTRY[spec.pattern] || null;
};
// стили поведений проекта, которые встречаются в файле (html/site/behaviors/<name>.css)
export function projectBehaviorCss(used) { return [...used].sort().map(n => PROJECT.css[n]).filter(Boolean).join('\n'); }
// поведения секции блока: запись реестра (по id блока типа, иначе по pattern) + по элементам (поля - form, вопросы -
// accordion); inner - разметка секции (для requires)
export function behaviorsOf(spec, block, inner = null) {
  const out = new Set();
  const reg = registryEntry(spec);
  if (reg && reg.behavior && !reg.render && (!reg.requires || inner == null || String(inner).includes(reg.requires))) out.add(reg.behavior);
  const els = (block && block.elements) || [];
  if (els.some(e => e.kind === 'field')) out.add('form');
  if (els.some(e => e.kind === 'qa')) out.add('accordion');
  return [...out];
}
// код поведений, которые встречаются в файле: объект-литерал для скрипта страницы
export function behaviorsScript(used) {
  const parts = [];
  for (const name of [...used].sort()) {
    const entry = Object.values(REGISTRY).find(r => r.behavior === name && r.script);
    const code = PROJECT.scripts[name] || (entry && entry.script) || JS[name];
    if (code) parts.push(`${JSON.stringify(name)}: ${code}`);
  }
  return `{\n${parts.join(',\n')}\n}`;
}

// ---------------------------------------------------------------- prototype.modules.json
export function modulesJson(S, info) {
  const op = S.ui.op;
  const src = k => op(k);
  const m = {};
  const put = (key, on, why, source) => { m[key] = { on: !!on && !S.off.has(key), why: S.off.has(key) ? op('off') : why, source }; };
  const menuWhy = S.landing ? op('menu_landing') : !info.navCount ? op('menu_none') : info.menuMode === 'config' ? op('menu_nav', { n: info.navCount }) : info.navIgnored ? op('menu_nav_empty', { n: info.navCount }) : op('menu_on', { n: info.navCount });
  put('menu', !S.landing && info.navCount > 0, menuWhy, info.menuMode === 'config' ? src('src_config') : src('src_sitemap'));
  if (S.landing) {
    if (info.anchorsAuto) put('anchors', info.navCount > 0, op('anchors_auto', { n: info.navCount }), src('src_blocks'));
    else put('anchors', info.navCount > 0, op('anchors', { n: info.navCount }), src('src_config'));
  }
  put('mega', info.megaCount > 0, info.megaCount ? op('mega_on', { n: info.megaCount }) : op('mega_none'), src('src_sitemap'));
  put('topbar', info.topbarOn, info.topbarOn ? op('topbar_on', { n: info.topFields }) : op('topbar_few'), src('src_facts'));
  put('search', !!S.searchPage, S.searchPage ? op('search_on', { page: S.searchPage.slug }) : op('search_none'), src('src_sitemap'));
  put('cart', !!S.cartPage, S.cartPage ? op('cart_on', { page: S.cartPage.slug }) : op('cart_none'), src('src_sitemap'));
  put('account', !!S.accountPage, S.accountPage ? op('account_on', { page: S.accountPage.slug }) : op('account_none'), src('src_sitemap'));
  // магазин без страниц-листингов: каталог с карточкой-примером на главной (build-html, info.catalogHome)
  const catOn = S.catalogOn && (S.listingPages.length > 0 || !!info.catalogHome);
  put('catalog', catOn, !S.catalogOn && S.btype === 'services' ? op('catalog_services') : catOn ? op('catalog_on', { n: S.listingPages.length || 1, spec: S.catalogSpec ? op('yes') : op('no'), items: info.items }) : op('catalog_none'), src('src_catalog'));
  put('product', !!S.productPage, S.productPage ? op('product_on', { page: S.productPage.slug, items: info.items }) : !S.catalogOn && S.btype === 'services' ? op('catalog_services') : op('product_none'), src('src_catalog'));
  put('photos', info.photos.embedded > 0, info.photos.wanted ? op('photos_on', { n: info.photos.embedded, m: info.photos.wanted, kb: Math.round(info.photos.bytes / 1024) }) : op('photos_none'), src('src_catalog'));
  put('forms', true, op('forms_on', { n: info.formBlocks }), src('src_blocks'));
  // вторые (контурные) кнопки CTA без cta.secondary_action: по подписи (канал, маршрут - secondaryByText), иначе к
  // блоку-форме или окну заявки независимо от подписи; by_text - сколько кнопок пошло путем по подписи
  const sd = info.secondaryDefault || 0;
  const bt = info.secondaryText || { channel: 0, route: 0 };
  const btN = (bt.channel || 0) + (bt.route || 0);
  const ctaWhy = [sd ? op('cta2_default', { n: sd, m: info.secondaryTotal }) : '', btN ? op('cta2_text', { n: btN, ch: bt.channel || 0, rt: bt.route || 0 }) : '', !sd && !btN && info.secondaryTotal ? op('cta2_on', { n: info.secondaryTotal }) : '', S.ctaLegacy && info.secondaryTotal ? op('cta2_legacy') : ''].filter(Boolean).join('; ');
  put('cta_secondary', (info.secondaryTotal || 0) > 0 || btN > 0, ctaWhy || op('cta2_none'), src('src_strategy'));
  m.cta_secondary.by_text = { channel: bt.channel || 0, route: bt.route || 0 };
  // Р6: путь по подписи включен только при старом формате CTA (в стратегии и брифах нет action/secondary_action)
  m.cta_secondary.legacy_cta = !!S.ctaLegacy;
  const added = Array.isArray(info.mapAdded) ? info.mapAdded : [];
  const mapWhy = S.mapsHref && info.maps ? [op('map_on', { n: info.maps }), added.length ? op('map_added', { pages: added.join(', ') }) : ''].filter(Boolean).join('; ') : op('map_none');
  put('map', !!S.mapsHref && info.maps > 0, mapWhy, src('src_facts'));
  m.map.added = added;
  put('messengers', S.contacts.channels.length > 0, S.contacts.channels.length ? op('messengers_on', { n: S.contacts.channels.length }) : op('messengers_none'), src('src_facts'));
  put('mbar', info.mbar, op('mbar_on', { call: S.contacts.phones.length ? op('mbar_call') : '' }), src('src_facts'));
  put('landing', S.landing, S.landing ? op('landing_on') : op('landing_none'), src('src_sitemap'));
  // живые блоки проекта (K8): записи html/site/registry.json и поведения html/site/behaviors, сколько секций их получили
  const pr = info.projectRegistry || { keys: [], behaviors: [], sections: 0 };
  put('project_behaviors', pr.keys.length > 0 && pr.sections > 0, pr.keys.length ? op('project_behaviors_on', { keys: pr.keys.join(', '), n: pr.sections }) : op('project_behaviors_none'), src('src_project_registry'));
  put('debug', true, op('debug_on'), src('src_blocks'));
  // оболочка по пересечениям лидеров (программа 05.10): ключ только при work/shell.json; ключи живых модулей (search,
  // cart, account) описывают только живые модули
  if (S.shell) {
    const items = S.shell.items.map(it => ({ id: it.id, name: it.name, zone: it.zone, level: it.level, coverage: it.coverage, niche: it.niche, state: it.state, ...(it.reason ? { reason: it.reason } : {}) }));
    const n = st => items.filter(i => i.state === st).length;
    m.shell = { on: true, why: op('shell_on', { n: items.length, shown: n('shown'), chip: n('chip'), fn: n('function'), pm: n('page_missing'), dec: n('declined'), stubs: info.stubs || 0 }), source: src('src_shell'), items };
  }
  return m;
}
