// Проверка скриптов прототипа в jsdom. node scripts/check-site-js.mjs [--file work/output/prototype.html]
// Загружает prototype.html со скриптами (runScripts dangerously; заглушки matchMedia, scrollTo, scrollBy,
// scrollIntoView, IntersectionObserver, ResizeObserver), обходит все маршруты, нажимает пункты меню, кнопки и ссылки
// страниц, открывает и закрывает окна, мобильное меню; собирает ошибки скриптов и консоли, мертвые переходы (маршрут,
// которого нет, якорь без блока, окно не открылось) и пустые страницы. tel:, mailto: и внешние ссылки не нажимаются.
// Одинаковые действия проверяются не больше двух раз: кнопки блоков писателя - на каждой странице, элементы
// компонента каталога (выдача, чипы, панель, строка разделов) - на весь обход (их строит одна функция сборщика).
// Действия: toast - виден текст data-toast; up (кнопка «наверх» оболочки по пересечениям лидеров, программа 05.10) -
// прокрутка к началу; плавающие кнопки .shell-fab и кнопки оболочки на телефоне (.mbar, .shell-strip, .mnav-shell).
// Отчет work/output/prototype.js-check.json: { verdict: pass|fail|skip, routes_checked, clicks, errors: [{route, kind,
// detail}], warnings, skip_reason?, proto_sha, file_sha, checked_at }. proto_sha - sha входных данных из meta
// proto-data-sha проверенного файла, file_sha - sha1 самого файла (первые 16 знаков): по ним видно, что вердикт - о
// текущей сборке. Код 1 при ошибках. jsdom не найден (kit/scripts/deps.mjs) - код 0 и строка SKIP.
import path from 'node:path';
import crypto from 'node:crypto';
import { argv, P, readText, exists, writeJson } from './lib.mjs';
import { loadDep } from './deps.mjs';

const a = argv({});
const file = a.file ? path.resolve(a.file) : P('work', 'output', 'prototype.html');
const outFile = file.replace(/\.html$/, '.js-check.json');
const MAX_CLICKS_PER_PAGE = Number(a['max-clicks'] || 60);
const sleep = ms => new Promise(r => setTimeout(r, ms));
// контрольные суммы проверенного файла - в каждом итоге (и в SKIP)
let stamp = {};
function finish(res, code) {
  writeJson(outFile, { ...res, ...stamp, checked_at: new Date().toISOString() });
  const line = res.verdict === 'skip' ? `check-site-js: SKIP (${res.skip_reason})` : `check-site-js: ${res.verdict} - маршрутов ${res.routes_checked}, нажатий ${res.clicks}, ошибок ${res.errors.length}${res.warnings.length ? `, предупреждений ${res.warnings.length}` : ''}`;
  console.log(line);
  for (const e of res.errors.slice(0, 30)) console.log(` - [${e.kind}] ${e.route}: ${e.detail}`);
  process.exit(code);
}
if (!exists(file)) finish({ verdict: 'fail', routes_checked: 0, clicks: 0, errors: [{ route: '', kind: 'missing', detail: `нет файла ${file}` }], warnings: [] }, 1);
{
  const h0 = readText(file);
  stamp = { proto_sha: (h0.match(/<meta name="proto-data-sha" content="([^"]*)"/) || [])[1] || '', file_sha: crypto.createHash('sha1').update(h0).digest('hex').slice(0, 16) };
}

let jsdom = null;
try { jsdom = await loadDep('jsdom'); } catch { jsdom = null; }
const JSDOM = jsdom && (jsdom.JSDOM || (jsdom.default && jsdom.default.JSDOM));
const VirtualConsole = jsdom && (jsdom.VirtualConsole || (jsdom.default && jsdom.default.VirtualConsole));
if (!JSDOM || !VirtualConsole) finish({ verdict: 'skip', routes_checked: 0, clicks: 0, errors: [], warnings: [], skip_reason: 'jsdom не найден (npm install в корне проекта)' }, 0);

const html = readText(file);
const errors = [];
const warnings = [];
let where = '';
const err = (kind, detail) => { if (errors.length < 200 && !errors.some(e => e.route === where && e.kind === kind && e.detail === detail)) errors.push({ route: where, kind, detail: String(detail).slice(0, 300) }); };

async function load(width) {
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => {
    const msg = String((e && e.message) || e);
    if (/Not implemented: navigation/i.test(msg)) err('navigation', 'переход не по hash (ссылка ведет вне прототипа)');
    else if (/Not implemented: HTMLFormElement\.prototype\.(requestSubmit|submit)/i.test(msg)) err('form-submit', 'отправка формы не перехвачена');
    else if (/Not implemented/i.test(msg)) { if (warnings.length < 50 && !warnings.includes(msg)) warnings.push(msg.slice(0, 200)); }
    else err('script', msg);
  });
  vc.on('error', (...m) => err('console', m.map(String).join(' ')));
  const dom = new JSDOM(html, {
    url: 'http://localhost/prototype.html', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) {
      Object.defineProperty(win, 'innerWidth', { value: width, configurable: true });
      win.matchMedia = q => {
        const min = /min-width:\s*(\d+)/.exec(q), max = /max-width:\s*(\d+)/.exec(q);
        const matches = (!min || width >= +min[1]) && (!max || width <= +max[1]);
        return { matches, media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent() { return false; } };
      };
      // прокрутка к началу (кнопка «наверх» оболочки, data-act up) считается: проверка ждет вызова scrollTo
      win.scrollTo = () => { win.__protoScrollTop = (win.__protoScrollTop || 0) + 1; }; win.scrollBy = () => {};
      win.Element.prototype.scrollIntoView = function () {};
      win.Element.prototype.scrollBy = function () {};
      win.Element.prototype.scrollTo = function () {};
      win.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } };
      win.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
    },
  });
  await sleep(60);
  return dom;
}

const res = { verdict: 'pass', routes_checked: 0, clicks: 0, errors, warnings };
let dom;
try { dom = await load(1280); } catch (e) { err('load', e.message); finish({ ...res, verdict: 'fail' }, 1); }
const W = dom.window;
const doc = W.document;
// окна находятся один раз: запрос по всему документу на каждое нажатие дорог на больших прототипах
const modalsAll = [...doc.querySelectorAll('.modal')];
const openModalEl = () => modalsAll.find(m => m.classList.contains('on')) || null;
const api = W.__PROTO;
if (!api || typeof api.open !== 'function') { err('load', 'нет window.__PROTO: скрипт страницы не выполнился'); finish({ ...res, verdict: 'fail' }, 1); }
const routes = api.routes().filter(r => r && r !== '404');
const routeSet = new Set(api.routes());
const cur = () => api.current();
const curRoute = () => (cur() ? cur().getAttribute('data-route') : '');
async function open(route) { api.open(`#${route}`); await sleep(2); }
function click(el) { el.dispatchEvent(new W.MouseEvent('click', { bubbles: true, cancelable: true, view: W })); res.clicks++; }
const hashRoute = h => { const r = String(h || '').replace(/^#/, '').split('?')[0].replace(/\/+$/, ''); return r || '/'; };
const visible = el => !el.closest('[hidden]') && !el.closest('template');

async function checkClickable(route, el) {
  const act = el.getAttribute('data-act') || '';
  const href = el.getAttribute('href') || '';
  if (/^(tel:|mailto:|https?:)/i.test(href)) return;
  if (el.closest('.cat-side') && !['fgroup', 'fmore', 'reset', 'side-close'].includes(act)) return;
  if (act === 'lead' || act === 'msg') {
    click(el); await sleep(5);
    const m = doc.querySelector(act === 'msg' ? '#modal-msg' : '#modal-lead');
    if (!m || !m.classList.contains('on')) err('dead', `окно ${act} не открылось: ${(el.textContent || '').trim().slice(0, 60)}`);
    const om = openModalEl(), x = om && om.querySelector('[data-act="modal-close"]');
    if (x) { click(x); await sleep(5); }
    if (openModalEl()) err('modal', 'окно не закрылось');
    return;
  }
  if (act === 'scroll') {
    const tg = el.getAttribute('data-target');
    if (!cur() || !cur().querySelector(`[data-anchor="${tg}"]`)) err('dead', `якорь «${tg}» не найден на странице`);
    click(el); await sleep(5);
    return;
  }
  if (href.startsWith('#/')) {
    const want = hashRoute(href);
    if (!routeSet.has(want)) { err('dead', `ссылка на несуществующий маршрут ${want}`); return; }
    click(el); await sleep(8);
    if (curRoute() !== want) err('dead', `переход на ${want} не случился (сейчас ${curRoute()})`);
    await open(route);
    return;
  }
  if (el.tagName === 'BUTTON' && el.type === 'submit') {
    const form = el.closest('form');
    if (!form) { err('dead', 'кнопка отправки вне формы'); return; }
    const inp = form.querySelector('input'); if (inp) inp.value = 'a';
    click(el); await sleep(8);
    const search = W.__SITE && W.__SITE.searchRoute;
    if (form.hasAttribute('data-search') && search && curRoute() !== search) err('dead', 'поиск из шапки не открыл страницу поиска');
    if (inp) inp.value = '';
    await open(route);
    return;
  }
  // тост (документ, функция или страница вне прототипа): текст из data-toast виден
  if (act === 'toast') {
    click(el); await sleep(3);
    const te = doc.getElementById('toast');
    if (!te || !te.classList.contains('on') || te.textContent !== (el.getAttribute('data-toast') || '')) err('dead', `тост не показан: ${(el.textContent || '').trim().slice(0, 60) || el.getAttribute('aria-label') || ''}`);
    return;
  }
  // кнопка «наверх» оболочки по пересечениям лидеров
  if (act === 'up') {
    const n0 = W.__protoScrollTop || 0;
    click(el); await sleep(3);
    if ((W.__protoScrollTop || 0) <= n0) err('dead', 'кнопка «наверх» не прокрутила страницу');
    return;
  }
  if (!act && (!href || href === '#')) { err('dead', `кнопка или ссылка без действия: ${(el.textContent || '').trim().slice(0, 60) || el.getAttribute('aria-label') || el.outerHTML.slice(0, 80)}`); return; }
  click(el); await sleep(5);
  const om = openModalEl();
  if (om) { const x = om.querySelector('[data-act="modal-close"]'); if (x) { click(x); await sleep(5); } }
  if (curRoute() !== route && !href) await open(route);
}

// ---------------------------------------------------------------- десктоп: все маршруты, меню, кнопки страниц
// счетчик сигнатур компонента каталога - общий на весь обход (выдача, чипы, панель фильтров, строка разделов)
const seenCatalog = new Map();
const CATALOG = '[data-catalog], .quick, .cat-kids';
for (const route of routes) {
  where = route;
  await open(route);
  const page = cur();
  if (!page || page.getAttribute('data-route') !== route) { err('route', `маршрут не открылся (показан ${curRoute()})`); continue; }
  res.routes_checked++;
  const text = (page.textContent || '').replace(/\s+/g, ' ').trim();
  if (text.length < 20) err('empty', 'страница пустая');
  if (page.querySelectorAll('h1').length !== 1) err('h1', `h1 на странице: ${page.querySelectorAll('h1').length}`);
  // одинаковые действия (та же цель, тот же тип) проверяются не больше двух раз: копии карточек, повторы кнопок
  const seen = new Map();
  const list = [...page.querySelectorAll('a, button')].filter(visible).filter(el => {
    const sig = `${el.getAttribute('data-act') || ''}|${el.getAttribute('href') || ''}|${el.getAttribute('data-target') || ''}|${el.getAttribute('data-value') || ''}|${el.getAttribute('data-group') || ''}`;
    const m = el.closest(CATALOG) ? seenCatalog : seen;
    const n = (m.get(sig) || 0) + 1; m.set(sig, n);
    return n <= 2;
  }).slice(0, MAX_CLICKS_PER_PAGE);
  for (const el of list) {
    if (!el.isConnected) continue;
    if (curRoute() !== route) await open(route);
    try { await checkClickable(route, el); } catch (e) { err('script', e.message); }
  }
}
// меню, мега-панели, подвал - с главной
where = '/';
await open('/');
// (плавающие кнопки оболочки .shell-fab - есть только при work/shell.json)
for (const el of [...doc.querySelectorAll('.nav a, .nav button, .ftr a, .ftr button, .hdr-main a, .hdr-main button, .shell-fab a, .shell-fab button')].slice(0, 120)) {
  if (el.closest('.mnav')) continue;
  try { await checkClickable('/', el); } catch (e) { err('script', e.message); }
  if (curRoute() !== '/') await open('/');
}
// страница товара: пример по каждому ключу (?item=<key>) - виден ровно он
for (const it of [...doc.querySelectorAll('.pp-item[data-item]')]) {
  const key = it.getAttribute('data-item');
  const route = it.closest('.page') && it.closest('.page').getAttribute('data-route');
  if (!route || key === '_tpl') continue;
  where = `${route}?item=${key}`;
  api.open(`#${route}?item=${encodeURIComponent(key)}`); await sleep(2);
  const vis = cur() ? [...cur().querySelectorAll('.pp-item')].filter(x => !x.hidden) : [];
  if (vis.length !== 1 || vis[0].getAttribute('data-item') !== key) err('product', `пример ${key} не показан на странице товара`);
}
// 404
where = '404';
api.open('#/__no_such_route__'); await sleep(15);
if (!cur() || cur().getAttribute('data-route') !== '404') err('route', 'нет страницы 404');
// служебный слой по клавише D
where = '/';
await open('/');
doc.dispatchEvent(new W.KeyboardEvent('keydown', { key: 'd', code: 'KeyD', bubbles: true }));
if (!doc.body.classList.contains('dbg')) err('debug', 'служебный слой не включается клавишей D');
doc.dispatchEvent(new W.KeyboardEvent('keydown', { key: 'd', code: 'KeyD', bubbles: true }));
if (doc.body.classList.contains('dbg')) err('debug', 'служебный слой не выключается');
dom.window.close();

// ---------------------------------------------------------------- телефон: бургер, мобильное меню, нижняя панель
try {
  const m = await load(375);
  const d = m.window.document;
  const api2 = m.window.__PROTO;
  where = '/ (375)';
  api2.open('#/'); await sleep(15);
  const burger = d.querySelector('[data-act="mnav-open"]');
  if (burger) {
    burger.dispatchEvent(new m.window.MouseEvent('click', { bubbles: true, cancelable: true })); res.clicks++;
    if (!d.querySelector('#mnav.open')) err('mobile', 'мобильное меню не открылось');
    const acc = d.querySelector('#mnav [data-act="macc"]');
    if (acc) { acc.dispatchEvent(new m.window.MouseEvent('click', { bubbles: true, cancelable: true })); res.clicks++; if (!acc.parentNode.classList.contains('open')) err('mobile', 'уровень мобильного меню не раскрылся'); }
    const link = d.querySelector('#mnav a[href^="#/"]');
    if (link) {
      const want = hashRoute(link.getAttribute('href'));
      link.dispatchEvent(new m.window.MouseEvent('click', { bubbles: true, cancelable: true })); res.clicks++;
      await sleep(25);
      const now = api2.current() && api2.current().getAttribute('data-route');
      if (now !== want) err('mobile', `переход из мобильного меню на ${want} не случился`);
      if (d.querySelector('#mnav.open')) err('mobile', 'мобильное меню не закрылось после перехода');
    }
  }
  // кнопки оболочки на телефоне (нижняя панель, полоса под шапкой лендинга, блок мобильного меню): тост и «наверх»
  for (const b of [...d.querySelectorAll('.mbar button[data-act], .shell-strip button[data-act], .mnav-shell button[data-act]')].slice(0, 20)) {
    const act = b.getAttribute('data-act');
    if (act !== 'toast' && act !== 'up') continue;
    const n0 = m.window.__protoScrollTop || 0;
    b.dispatchEvent(new m.window.MouseEvent('click', { bubbles: true, cancelable: true })); res.clicks++;
    await sleep(3);
    const te = d.getElementById('toast');
    if (act === 'toast' && (!te || te.textContent !== (b.getAttribute('data-toast') || ''))) err('mobile', `тост не показан: ${(b.textContent || '').trim().slice(0, 60)}`);
    if (act === 'up' && (m.window.__protoScrollTop || 0) <= n0) err('mobile', 'кнопка «наверх» не прокрутила страницу');
  }
  const mb = d.querySelector('[data-mbar-cta]');
  if (mb && !mb.hidden) {
    mb.dispatchEvent(new m.window.MouseEvent('click', { bubbles: true, cancelable: true })); res.clicks++;
    await sleep(5);
    const x = d.querySelector('.modal.on [data-act="modal-close"]');
    if (x) x.dispatchEvent(new m.window.MouseEvent('click', { bubbles: true, cancelable: true }));
  }
  m.window.close();
} catch (e) { err('mobile', e.message); }

res.verdict = errors.length ? 'fail' : 'pass';
finish(res, errors.length ? 1 : 0);
