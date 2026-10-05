// Тесты пакета D программы 05.10 (КФ и КНДР): прототип с оболочкой по пересечениям лидеров (work/shell.json) и
// заглушками блоков (brief.stubs). Файлы пакета: kit scripts/site-parts.mjs, build-html.mjs, render-blocks.mjs,
// check-html.mjs, check-site-js.mjs, html/site/{ui.json, site.css, shell.html}, schemas/facts.schema.json (slot), эталон
// fixtures/site-golden/.
// Запуск: node .claude/tests/site-tekst/cases-kf-site.mjs (код 0 - все прошли).
// Все во временных папках (os.tmpdir()), без сети и данных клиентов. shell.json и stubs - фикстуры по схемам разделов
// 3.3 и 3.4 спецификации (их пишут пакеты B и C). jsdom для check-site-js - от node_modules шаблона (как cases-site);
// нет jsdom - проверки check-site-js SKIP с причиной.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { validate } from '../../skills/site-tekst/kit/scripts/lib.mjs';
import { TPL, FIXTURES, goldenFile, goldenHeadFile, buildProject, normalizeBody, normalizeHead } from './fixtures/site-golden/golden.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0, skip = 0;
const failures = [], notes = [];
function check(name, ok, detail = '') {
  if (ok) pass++;
  else { fail++; failures.push(`FAIL ${name}${detail ? ': ' + String(detail).slice(0, 600) : ''}`); }
}
function skipped(name, why) { skip++; notes.push(`SKIP ${name}: ${why}`); }
const rj = f => JSON.parse(fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, ''));
const wj = (f, o) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(o, null, 2) + '\n'); };
const rt = f => fs.readFileSync(f, 'utf8');
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cases-kf-site-'));
let NM = '';
try { const p = createRequire(import.meta.url).resolve('jsdom'); NM = p.slice(0, p.lastIndexOf(`${path.sep}node_modules${path.sep}`) + `${path.sep}node_modules`.length); } catch { NM = ''; }
const ENV = { SITE_TEKST_BUILT_AT: '2026-10-05 12:00:00', ...(NM ? { SITE_TEKST_NODE_MODULES: NM } : {}) };
function run(cwd, args) {
  const r = spawnSync(process.execPath, args, { cwd, encoding: 'utf8', env: { ...process.env, ...ENV }, timeout: 240000 });
  return { code: r.status, stdout: r.stdout || '', out: (r.stdout || '') + (r.stderr || '') };
}
const build = (name, fixture, mutate) => buildProject(fixture, { root: fs.mkdtempSync(path.join(tmpRoot, `${name}-`)), mutate, env: ENV });
const markupOf = s => s.replace(/<script\b[\s\S]*?<\/script>/g, ' ').replace(/<style\b[\s\S]*?<\/style>/g, ' ');
function pageOf(html, route) {
  const re = new RegExp(`<div class="page"[^>]*data-route="${route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>`);
  const m = html.match(re);
  if (!m) return '';
  const rest = html.slice(m.index + m[0].length);
  const next = rest.search(/<div class="page"/);
  return m[0] + (next < 0 ? rest : rest.slice(0, next));
}
const between = (html, start, end) => { const a = html.indexOf(start); if (a < 0) return ''; const b = html.indexOf(end, a); return html.slice(a, b < 0 ? html.length : b + end.length); };
const modsOf = dir => rj(path.join(dir, 'work', 'output', 'prototype.modules.json'));
const stateOf = (mods, id, zone) => ((mods.shell && mods.shell.items) || []).find(i => i.id === id && (!zone || i.zone === zone))?.state;
function checkSiteJs(name, dir) {
  if (!NM) { skipped(`${name}: check-site-js`, 'jsdom не найден от шаблона (npm install в корне шаблона)'); return; }
  const js = run(dir, ['scripts/check-site-js.mjs']);
  const rep = fs.existsSync(path.join(dir, 'work', 'output', 'prototype.js-check.json')) ? rj(path.join(dir, 'work', 'output', 'prototype.js-check.json')) : {};
  check(`${name}: check-site-js pass (не SKIP)`, js.code === 0 && rep.verdict === 'pass', js.out.slice(0, 800));
  return rep;
}

// ================================================================ 1. эталон: без shell.json прототип прежний
{
  for (const name of FIXTURES) {
    const r = build(`golden-${name}`, name);
    check(`эталон ${name}: build-html код 0`, r.code === 0, r.out.slice(0, 400));
    const gb = fs.existsSync(goldenFile(name)) ? rt(goldenFile(name)) : '';
    const gh = fs.existsSync(goldenHeadFile(name)) ? rt(goldenHeadFile(name)) : '';
    const body = normalizeBody(r.html), head = normalizeHead(r.html);
    let at = 0; while (at < body.length && body[at] === gb[at]) at++;
    check(`эталон ${name}: <body> без shell.json совпадает с эталоном`, !!gb && body === gb, `первое расхождение на ${at}: «${body.slice(Math.max(0, at - 60), at + 60)}»`);
    let ah = 0; while (ah < head.length && head[ah] === gh[ah]) ah++;
    check(`эталон ${name}: <head> (стили без правил оболочки) совпадает с эталоном`, !!gh && head === gh, `первое расхождение на ${ah}: «${head.slice(Math.max(0, ah - 60), ah + 60)}»`);
    const mods = modsOf(r.dir);
    check(`эталон ${name}: в prototype.modules.json нет ключа shell`, !('shell' in mods));
    check(`эталон ${name}: в файле нет чипов оболочки, заглушек, кнопки «наверх» и меток /*@shell*/`, !/ph-need|data-stub|data-act="up"|shell-fab|shell-hdr|@shell/.test(r.html));
    check(`эталон ${name}: дата сборки из SITE_TEKST_BUILT_AT`, /<meta name="generator" content="site-tekst build-html 2026-10-05 12:00:00">/.test(r.html));
  }
}

// ================================================================ 2. фикстуры shell.json (схема 3.3) и stubs (схема 3.4)
const item = (o) => ({ level: 'recommended', coverage: '3/5', needs: [], needs_hint: '', page_match: null, niche: false, render: 'generic', ...o });
const SHELL_SERVICES = {
  generated_at: '2026-10-05T10:00:00Z', n_competitors: 5,
  items: [
    item({ id: 'phone', name: 'Телефон', zone: 'header', level: 'must', coverage: '5/5', kind: 'slot', render: 'phone', needs: ['company.phones'] }),
    item({ id: 'whatsapp', name: 'WhatsApp', zone: 'header', kind: 'slot', render: 'messengers' }),
    item({ id: 'search', name: 'Поиск по сайту', zone: 'header', level: 'must', coverage: '4/5', kind: 'function', render: 'search' }),
    item({ id: 'cart', name: 'Корзина', zone: 'header', kind: 'function', render: 'cart' }),
    item({ id: 'account', name: 'Личный кабинет', zone: 'header', kind: 'function', render: 'account' }),
    item({ id: 'rating', name: 'Рейтинг на картах', zone: 'header', kind: 'slot', render: 'rating', needs_hint: 'ссылка на карточку с отзывами' }),
    item({ id: 'city', name: 'Выбор города', zone: 'header', kind: 'slot', render: 'city' }),
    item({ id: 'x-online-booking', name: '«Онлайн-запись»', zone: 'header', kind: 'function', niche: true }),
    item({ id: 'x-requisites-doc', name: 'Политика обработки данных', zone: 'header', kind: 'page_link', page_match: { ui_role: 'legal' } }),
    item({ id: 'x-price-list', name: 'Прайс-лист', zone: 'header', kind: 'page_link', page_match: { subject_re: 'прайс' } }),
    item({ id: 'email', name: 'Почта', zone: 'footer', kind: 'slot', render: 'email', needs: ['company.email'] }),
    item({ id: 'legal_line', name: 'Реквизиты', zone: 'footer', level: 'must', coverage: '4/5', kind: 'slot', render: 'legal_line' }),
    item({ id: 'x-warranty-card', name: 'Гарантийный талон', zone: 'footer', kind: 'slot', niche: true, needs_hint: 'образец талона' }),
    item({ id: 'subscribe', name: 'Подписка на новости', zone: 'footer', kind: 'function', render: 'subscribe' }),
    item({ id: 'x-reviews-page', name: 'Отзывы', zone: 'footer', kind: 'page_link', page_match: { subject_re: 'отзыв' } }),
    item({ id: 'x-about-page', name: 'О компании', zone: 'footer', kind: 'page_link', page_match: { type: 'info_about' } }),
    item({ id: 'x-quick-calc', name: 'Быстрый расчет', zone: 'mobile', kind: 'function', niche: true }),
    item({ id: 'up_button', name: 'Наверх', zone: 'fixed', kind: 'function', render: 'up_button' }),
    item({ id: 'callback', name: 'Обратный звонок', zone: 'fixed', kind: 'function', render: 'callback' }),
    // часть оболочки, которую прототип рисует всегда (вид nav словаря): shown, без новой разметки и без вопроса
    item({ id: 'logo', name: 'Логотип', zone: 'header', kind: 'slot', render: 'native' }),
    item({ id: 'copyright', name: 'Копирайт', zone: 'footer', kind: 'slot', render: 'native' }),
  ],
};
const CITY_FACT = { id: 'F810', label: 'Город работы', value: 'Самара и область', wording: 'Самара и область', publish: 'yes', source_quote: 'оператор: работаем по Самаре и области', kind: 'geo', slot: 'city', source: 'оператор: 2026-10-05 ответ заказчика' };
{
  // схема фактов: необязательное поле slot (факт оператора F8xx) - проходит, старые факты без него - тоже
  const sch = rj(path.join(TPL, 'schemas', 'facts.schema.json'));
  const facts = rj(path.join(TPL, 'examples', 'fixture-services', 'work', 'facts.json'));
  const withSlot = { ...facts, facts: [...facts.facts, CITY_FACT] };
  // (фикстура услуг схему целиком не проходит - сравниваются только добавленные ошибки)
  const e1 = validate(sch, facts), e2 = validate(sch, withSlot);
  const e3 = validate(sch, { ...facts, facts: [...facts.facts, { ...CITY_FACT, slot: 'Город!' }] });
  const added = (a, b) => b.filter(x => !a.includes(x));
  check('facts.schema: факт со slot (id элемента) не добавляет ошибок, slot не id - ошибка по slot', !added(e1, e2).length && added(e1, e3).some(x => /slot/.test(x)), [...added(e1, e2), ...added(e1, e3)].slice(0, 3).join('; '));
}

// ================================================================ 3. сайт услуг с оболочкой
{
  const r = build('svc-shell', 'fixture-services', dir => {
    wj(path.join(dir, 'work', 'shell.json'), SHELL_SERVICES);
    const ff = path.join(dir, 'work', 'facts.json');
    const facts = rj(ff); facts.facts.push(CITY_FACT); wj(ff, facts);
  });
  check('услуги+оболочка: build-html код 0, строка «оболочка:»', r.code === 0 && /оболочка: /.test(r.out), r.out.slice(0, 500));
  const html = r.html, mk = markupOf(html), mods = modsOf(r.dir);
  const hdr = between(html, '<header class="hdr"', '</header>');
  const ftr = between(html, '<footer class="ftr"', '</footer>');
  const nav = (html.match(/<nav class="nav"[\s\S]*?<\/nav>/) || [''])[0];
  check('услуги+оболочка: modules.shell - on, why, source и элементы {id, name, zone, level, coverage, niche, state}', mods.shell && mods.shell.on === true && mods.shell.why && mods.shell.source && mods.shell.items.length === SHELL_SERVICES.items.length && mods.shell.items.every(i => ['id', 'name', 'zone', 'level', 'coverage', 'niche', 'state'].every(k => k in i)), JSON.stringify(mods.shell).slice(0, 300));
  check('услуги+оболочка: живые модули не включены - нет data-cart, data-search, секций модулей, mods.cart/search/account off', !/data-cart|data-search|search-sec|cart-sec|acc-sec/.test(mk) && mods.cart.on === false && mods.search.on === false && mods.account.on === false);
  check('услуги+оболочка: поиск, корзина, кабинет без страниц - state function, кнопки-тосты «функция вне прототипа» в шапке', ['search', 'cart', 'account'].every(id => stateOf(mods, id) === 'function') && ['search', 'cart', 'account'].every(id => new RegExp(`<button type="button" class="shell-fn" data-act="toast" data-toast="Функция вне прототипа" data-kf="${id}">`).test(hdr)));
  check('услуги+оболочка: native (логотип, копирайт) - shown, без data-kf и без чипа', stateOf(mods, 'logo') === 'shown' && stateOf(mods, 'copyright') === 'shown' && !/data-kf="logo"|data-kf="copyright"/.test(html));
  check('услуги+оболочка: телефон и мессенджер с данными - shown, на своих местах без новой разметки', stateOf(mods, 'phone') === 'shown' && stateOf(mods, 'whatsapp') === 'shown' && !/data-kf="phone"|data-kf="whatsapp"/.test(html) && /class="hdr-phone"/.test(hdr));
  check('услуги+оболочка: слот без данных - чип «нужны данные: рейтинг на картах» в группе шапки перед CTA', stateOf(mods, 'rating') === 'chip' && /<span class="shell-hdr">[\s\S]*<span class="ph-need" data-kf="rating">нужны данные: рейтинг на картах<\/span>[\s\S]*<\/span><a class="btn btn-cta/.test(hdr));
  check('услуги+оболочка: слот из факта с полем slot - значение факта, state shown, без чипа', stateOf(mods, 'city') === 'shown' && /<span class="shell-v" data-kf="city">Самара и область<\/span>/.test(hdr) && !/class="ph-need" data-kf="city"/.test(html));
  check('услуги+оболочка: x-элемент function - кнопка-тост с нормализованным названием (без кавычек)', stateOf(mods, 'x-online-booking') === 'function' && /data-kf="x-online-booking">Онлайн-запись<\/button>/.test(hdr));
  check('услуги+оболочка: юридическая страница карты (status skip) - «есть в карте» (shown), тост «Документ вне прототипа»', stateOf(mods, 'x-requisites-doc') === 'shown' && /data-act="toast" data-toast="Документ вне прототипа" data-kf="x-requisites-doc">Политика обработки данных<\/button>/.test(hdr));
  check('услуги+оболочка: нет страницы в карте - page_missing; из шапки - не кнопкой в шапке, а в колонке «Информация» подвала (правка по приемке)', stateOf(mods, 'x-price-list') === 'page_missing' && !/data-kf="x-price-list"/.test(hdr) && /data-toast="Страница вне прототипа" data-kf="x-price-list">Прайс-лист<\/button>/.test(ftr));
  check('услуги+оболочка: подвал - почта и реквизиты уже есть (shown, без новой разметки)', stateOf(mods, 'email', 'footer') === 'shown' && stateOf(mods, 'legal_line') === 'shown' && !/data-kf="email"|data-kf="legal_line"/.test(ftr));
  check('услуги+оболочка: x-элемент generic slot - чип data-kf="x-warranty-card" в строках контактов подвала', stateOf(mods, 'x-warranty-card') === 'chip' && /<div class="fc-row fc-kf">[\s\S]{0,400}?<span class="ph-need" data-kf="x-warranty-card">нужны данные: гарантийный талон<\/span>/.test(ftr) && mods.shell.items.find(i => i.id === 'x-warranty-card').niche === true);
  check('услуги+оболочка: функция подвала - кнопка-тост в строке документов', stateOf(mods, 'subscribe') === 'function' && /<p class="ftr-docs">[\s\S]*data-kf="subscribe">Подписка на новости<\/button>[\s\S]*<span class="sp">/.test(ftr));
  check('услуги+оболочка: страница вне карты в подвале - колонка «Информация» с кнопкой-тостом; страница из карты уже в подвале', /<div class="fcol"><div class="fcol-h">Информация<\/div><ul><li>[\s\S]*?data-kf="x-reviews-page">Отзывы<\/button><\/li>[\s\S]*?<\/ul><\/div>/.test(ftr) && stateOf(mods, 'x-about-page') === 'shown' && !/data-kf="x-about-page"/.test(ftr));
  check('услуги+оболочка: зона mobile - в нижней панели (mbar) кнопкой-тостом', /<div class="mbar">[\s\S]*data-kf="x-quick-calc">Быстрый расчет<\/button>[\s\S]*<\/div>/.test(between(html, '<div class="mbar">', '</div>')));
  const fab = between(html, '<div class="shell-fab">', '</div>');
  check('услуги+оболочка: закрепленные - плавающие кнопки: «наверх» (data-act up) и обратный звонок (окно заявки)', /data-act="up" aria-label="Наверх"/.test(fab) && /data-act="lead" data-title="Обратный звонок" data-kf="callback"/.test(fab) && stateOf(mods, 'up_button') === 'shown');
  check('услуги+оболочка: чипов нет в меню и кнопках, подписи конкурента (needs_hint) в файл не попали', !/ph-need/.test(nav) && ![...mk.matchAll(/<(a|button)\b[^>]*\bclass="[^"]*\bbtn\b[^"]*"[^>]*>([\s\S]*?)<\/\1>/g)].some(m => /ph-need/.test(m[2])) && !/ссылка на карточку с отзывами|образец талона/.test(html));
  check('услуги+оболочка: стили оболочки и обработчик up - в файле (метки /*@shell*/ оставлены комментариями)', /\.ph-need \{/.test(html) && /\.shell-fab \{/.test(html) && /act === 'up'/.test(html));
  check('услуги+оболочка: телефонная версия - новые элементы шапки в мобильном меню', /<div class="mnav-shell">[\s\S]*data-kf="rating"/.test(between(html, '<div class="mnav"', '<div class="mnav-contacts">')));
  const ch = run(r.dir, ['scripts/check-html.mjs']);
  check('услуги+оболочка: check-html pass, код 0', ch.code === 0 && /check-html: pass/.test(ch.stdout), ch.out.slice(0, 800));
  checkSiteJs('услуги+оболочка', r.dir);
  // sha данных прототипа учитывает shell.json; без файла - прежний
  const shaWith = (html.match(/<meta name="proto-data-sha" content="([^"]*)"/) || [])[1];
  fs.rmSync(path.join(r.dir, 'work', 'shell.json'));
  const b2 = run(r.dir, ['scripts/build-html.mjs']);
  const html2 = rt(path.join(r.dir, 'work', 'output', 'prototype.html'));
  const shaWithout = (html2.match(/<meta name="proto-data-sha" content="([^"]*)"/) || [])[1];
  check('услуги+оболочка: protoDataSha меняется от work/shell.json, без файла ключа shell нет', b2.code === 0 && shaWith && shaWithout && shaWith !== shaWithout && !('shell' in modsOf(r.dir)));
  // check-html ловит: чип в меню; элемент chip без чипа; declined на сайте
  const bad = html.replace('<nav class="nav" aria-label="', '<nav class="nav" data-x="1" aria-label="').replace(/(<nav class="nav"[^>]*>)/, '$1<span class="ph-need">нужны данные: x</span>');
  fs.writeFileSync(path.join(r.dir, 'work', 'output', 'prototype.html'), bad);
  const m2 = { ...mods, shell: { ...mods.shell, items: [...mods.shell.items, { id: 'x-ghost', name: 'X', zone: 'header', level: 'recommended', coverage: '2/5', niche: true, state: 'chip' }, { id: 'rating', name: 'R', zone: 'footer', level: 'recommended', coverage: '2/5', niche: false, state: 'declined' }] } };
  wj(path.join(r.dir, 'work', 'output', 'prototype.modules.json'), m2);
  run(r.dir, ['scripts/check-html.mjs']);
  const rep = rj(path.join(r.dir, 'work', 'audit', 'html-check.json'));
  const rules = rep.findings.map(f => f.rule);
  check('check-html: чип в меню - major placeholder-ui, чип без data-kf и элемент chip без чипа - minor shell-chip, declined на сайте - major shell-declined', rules.includes('html.placeholder-ui') && rules.filter(x => x === 'html.shell-chip').length === 2 && rules.includes('html.shell-declined'), rules.join(', '));
}

// ================================================================ 3б. сопоставление страниц по названию (правка по приемке Goldax)
{
  // страница поиска без ui_role (как у Goldax: «Поиск по каталогу») - ссылка на нее, живой модуль не включается;
  // политика: роль legal или название - альтернативы (страница без ui_role находится по названию)
  const SH = { generated_at: '2026-10-05T10:00:00Z', n_competitors: 5, items: [
    item({ id: 'search', name: 'Поиск по сайту', zone: 'header', kind: 'function', render: 'search', page_match: { subject_re: 'поиск' } }),
    item({ id: 'privacy_policy', name: 'Политика конфиденциальности', zone: 'footer', kind: 'page_link', page_match: { ui_role: 'legal', subject_re: 'политик' } }),
  ] };
  const r = build('svc-match', 'fixture-services', dir => {
    wj(path.join(dir, 'work', 'shell.json'), SH);
    const sf = path.join(dir, 'work', 'sitemap.json'); const sm = rj(sf);
    sm.pages = sm.pages.map(p => (p.slug === 'politika' ? { ...p, ui_role: undefined } : p));
    sm.pages.push({ slug: 'poisk', url: '/poisk', type: 'info_other', subject: 'Поиск по каталогу', level: 1, status: 'skip' });
    wj(sf, sm);
  });
  const mods = modsOf(r.dir);
  check('сопоставление: политика без ui_role legal - по названию «есть в карте», не page_missing', r.code === 0 && stateOf(mods, 'privacy_policy') === 'shown', JSON.stringify(mods.shell && mods.shell.items));
  check('сопоставление: поиск без страницы ui_role search и без живой страницы - функция (страница skip не дает ссылки)', stateOf(mods, 'search') === 'function' && mods.search.on === false);
  // shell.json - снимок фазы 2 без page_match у поиска: сборка берет подсказку из словаря задачи; живая страница
  // «Поиск по каталогу» без ui_role - ссылка на нее, живой модуль поиска не включается
  const r2 = build('svc-match-live', 'fixture-services', dir => {
    wj(path.join(dir, 'work', 'shell.json'), { ...SH, items: [item({ id: 'search', name: 'Поиск по сайту', zone: 'header', kind: 'function', render: 'search' })] });
    const sf = path.join(dir, 'work', 'sitemap.json'); const sm = rj(sf);
    sm.pages = sm.pages.map(p => (p.slug === 'uslugi-elektrika' ? { ...p, subject: 'Поиск по каталогу' } : p));
    wj(sf, sm);
  });
  const m2 = modsOf(r2.dir);
  check('сопоставление: page_match из словаря задачи, живая страница поиска без ui_role - shown и ссылка, модуль поиска выключен', r2.code === 0 && stateOf(m2, 'search') === 'shown' && m2.search.on === false && /<a class="shell-v" href="#\/[^"]*" data-kf="search">/.test(r2.html), JSON.stringify(m2.shell && m2.shell.items) + r2.out.slice(0, 300));
}

// ================================================================ 4. решения заказчика: no_phone, absent, частичные реквизиты
{
  const SHELL_DECL = { generated_at: '2026-10-05T10:00:00Z', n_competitors: 5, items: [
    item({ id: 'phone', name: 'Телефон', zone: 'header', level: 'must', coverage: '5/5', kind: 'slot', render: 'phone', needs: ['company.phones'] }),
    item({ id: 'phone', name: 'Телефон', zone: 'mobile', level: 'must', coverage: '5/5', kind: 'slot', render: 'phone', needs: ['company.phones'] }),
    item({ id: 'x-call-me', name: 'Перезвоните мне', zone: 'header', kind: 'function', needs: ['company.phones'] }),
    item({ id: 'email', name: 'Почта', zone: 'footer', kind: 'slot', render: 'email', needs: ['company.email'] }),
    item({ id: 'hours', name: 'Часы работы', zone: 'footer', kind: 'slot', render: 'hours' }),
    item({ id: 'legal_line', name: 'Реквизиты', zone: 'footer', kind: 'slot', render: 'legal_line' }),
  ] };
  const r = build('svc-declined', 'fixture-services', dir => {
    wj(path.join(dir, 'work', 'shell.json'), SHELL_DECL);
    const ff = path.join(dir, 'work', 'facts.json');
    const facts = rj(ff);
    // как после импорта (K1): телефона и снятых полей нет в company, отметки - no_phone и absent; часы просто неизвестны
    facts.company.no_phone = true; delete facts.company.phones; delete facts.company.email; delete facts.company.inn; delete facts.company.hours;
    facts.company.absent = ['email', 'inn'];
    wj(ff, facts);
  });
  const html = r.html, mods = modsOf(r.dir);
  check('решения заказчика: build-html код 0', r.code === 0, r.out.slice(0, 400));
  check('решения заказчика: телефон при no_phone - declined в шапке и на телефоне, без чипа', stateOf(mods, 'phone', 'header') === 'declined' && stateOf(mods, 'phone', 'mobile') === 'declined' && !/data-kf="phone"/.test(html));
  check('решения заказчика: функция, зависящая от телефона (needs company.phones), - declined', stateOf(mods, 'x-call-me') === 'declined' && !/data-kf="x-call-me"/.test(html));
  check('решения заказчика: поле в company.absent (почта) - declined, без чипа', stateOf(mods, 'email') === 'declined' && !/data-kf="email"/.test(html));
  check('решения заказчика: поле неизвестно и не снято (часы) - чип', stateOf(mods, 'hours') === 'chip' && /<span class="ph-need" data-kf="hours">нужны данные: часы работы<\/span>/.test(html));
  check('решения заказчика: реквизиты сняты частично (ИНН) - остаток без чипа (shown)', stateOf(mods, 'legal_line') === 'shown' && !/data-kf="legal_line"/.test(html) && /ООО «Кварта»/.test(between(html, '<div class="ftr-legal">', '</div>')) && !/ИНН 6300000000/.test(html));
  const ch = run(r.dir, ['scripts/check-html.mjs']);
  check('решения заказчика: check-html pass', ch.code === 0, ch.out.slice(0, 600));
  // все части реквизитов сняты - слота нет
  const r2 = build('svc-declined-legal', 'fixture-services', dir => {
    wj(path.join(dir, 'work', 'shell.json'), { generated_at: 'x', n_competitors: 5, items: [item({ id: 'legal_line', name: 'Реквизиты', zone: 'footer', kind: 'slot', render: 'legal_line' })] });
    const ff = path.join(dir, 'work', 'facts.json');
    const facts = rj(ff);
    for (const k of ['legal_name', 'inn', 'ogrn']) delete facts.company[k];
    facts.company.absent = ['legal_name', 'inn', 'ogrn'];
    facts.facts = facts.facts.filter(f => f.kind !== 'legal');
    wj(ff, facts);
  });
  check('решения заказчика: сняты все части реквизитов - declined, ни чипа, ни строки', r2.code === 0 && stateOf(modsOf(r2.dir), 'legal_line') === 'declined' && !/data-kf="legal_line"/.test(r2.html));
  // реквизитов нет и они не сняты - чип
  const r3 = build('svc-legal-chip', 'fixture-services', dir => {
    wj(path.join(dir, 'work', 'shell.json'), { generated_at: 'x', n_competitors: 5, items: [item({ id: 'legal_line', name: 'Реквизиты', zone: 'footer', kind: 'slot', render: 'legal_line' })] });
    const ff = path.join(dir, 'work', 'facts.json');
    const facts = rj(ff);
    for (const k of ['legal_name', 'inn', 'ogrn']) delete facts.company[k];
    wj(ff, facts);
  });
  check('реквизитов нет и они не сняты - чип в строках контактов подвала', r3.code === 0 && stateOf(modsOf(r3.dir), 'legal_line') === 'chip' && /<span class="ph-need" data-kf="legal_line">нужны данные: реквизиты<\/span>/.test(r3.html));
}

// ================================================================ 5. заглушки brief.stubs: секция без data-block-id, якорь валиден
{
  const STUB = { type: 'reviews-kf', name: 'Отзывы клиентов', after: 'B01-hero', needs: ['отзывы клиентов с именами'], kf_el: 'x-client-reviews', level: 'must' };
  const r = build('svc-stubs', 'fixture-services', dir => {
    const bf = path.join(dir, 'work', 'pages', 'home', 'brief.json');
    const b = rj(bf);
    b.stubs = [STUB, { type: 'licenses-kf', name: 'Лицензии', after: 'B99-nope', needs: ['скан лицензии'], kf_el: 'licenses', level: 'recommended' }];
    b.cta = { ...b.cta, action: 'anchor:reviews-kf' };
    wj(bf, b);
  });
  const home = pageOf(r.html, '/');
  check('заглушки: build-html код 0, строка о заглушках, ключа shell нет (shell.json нет)', r.code === 0 && /заглушек блоков лидеров: 2/.test(r.out) && !('shell' in modsOf(r.dir)), r.out.slice(0, 400));
  const sec = (home.match(/<section\b[^>]*data-stub="1"[^>]*data-block-type="reviews-kf"[^>]*>|<section\b[^>]*data-block-type="reviews-kf"[^>]*data-stub="1"[^>]*>/) || [''])[0];
  check('заглушки: секция с data-block-type, data-anchor, data-stub, без data-block-id', !!sec && /data-anchor="reviews-kf"/.test(sec) && !/data-block-id/.test(sec), sec);
  check('заглушки: стоит сразу после блока after (первый экран), чип «нужны данные: <needs>» с data-kf', /data-block-id="B01-hero"[\s\S]*?<\/section><section[^>]*data-block-type="reviews-kf"/.test(home) && /<div class="stub-name">Отзывы клиентов<\/div>[\s\S]*?<span class="ph-need" data-kf="x-client-reviews">нужны данные: отзывы клиентов с именами<\/span>/.test(home));
  check('заглушки: after не найден - в конце страницы', /data-block-type="licenses-kf"[^>]*>[\s\S]*$/.test(home) && home.lastIndexOf('data-block-type="licenses-kf"') > home.lastIndexOf('data-block-id="B07-form"'));
  check('заглушки: действие anchor:<тип заглушки> разрешилось в прокрутку к ней', /data-act="scroll" data-target="reviews-kf"/.test(home));
  check('заглушки: текст заглушек не в prototype.index.json (сверка дословности их не касается)', !JSON.stringify(rj(path.join(r.dir, 'work', 'output', 'prototype.index.json'))).includes('Отзывы клиентов'));
  const ch = run(r.dir, ['scripts/check-html.mjs']);
  const rep = rj(path.join(r.dir, 'work', 'audit', 'html-check.json'));
  check('заглушки: check-html pass (якорь на заглушку валиден), scores.stubs = 2', ch.code === 0 && rep.scores.stubs === 2 && !rep.findings.some(f => f.rule === 'html.anchor'), ch.out.slice(0, 600));
  checkSiteJs('заглушки', r.dir);
}

// ================================================================ 6. магазин и лендинг с оболочкой
{
  const r = build('shop-shell', 'fixture-shop', dir => wj(path.join(dir, 'work', 'shell.json'), { generated_at: 'x', n_competitors: 5, items: [
    item({ id: 'search', name: 'Поиск', zone: 'header', kind: 'function', render: 'search' }),
    item({ id: 'cart', name: 'Корзина', zone: 'header', kind: 'function', render: 'cart' }),
    item({ id: 'favorites', name: 'Избранное', zone: 'header', kind: 'function', render: 'favorites' }),
    item({ id: 'payment_icons', name: 'Способы оплаты', zone: 'footer', kind: 'slot', render: 'payment_icons' }),
    item({ id: 'x-delivery', name: 'Доставка', zone: 'footer', kind: 'page_link', page_match: { subject_re: 'достав' } }),
  ] }));
  const mods = modsOf(r.dir);
  check('магазин+оболочка: поиск и корзина со страницами ui_role - живые (shown), модули on, без кнопок-тостов', r.code === 0 && stateOf(mods, 'search') === 'shown' && stateOf(mods, 'cart') === 'shown' && mods.cart.on && mods.search.on && !/data-kf="search"|data-kf="cart"/.test(r.html) && /data-search/.test(r.html), r.out.slice(0, 300));
  check('магазин+оболочка: избранное без страницы - функция вне прототипа', stateOf(mods, 'favorites') === 'function' && /data-kf="favorites">Избранное<\/button>/.test(r.html));
  check('магазин+оболочка: способы оплаты без факта - чип в подвале', stateOf(mods, 'payment_icons') === 'chip' && /data-kf="payment_icons">нужны данные: способы оплаты/.test(r.html));
  check('магазин+оболочка: страница карты по subject_re - shown', stateOf(mods, 'x-delivery') === 'shown');
  const ch = run(r.dir, ['scripts/check-html.mjs']);
  check('магазин+оболочка: check-html pass', ch.code === 0, ch.out.slice(0, 600));
  checkSiteJs('магазин+оболочка', r.dir);
  const l = build('landing-shell', 'fixture-landing', dir => wj(path.join(dir, 'work', 'shell.json'), { generated_at: 'x', n_competitors: 5, items: [
    item({ id: 'rating', name: 'Рейтинг', zone: 'header', kind: 'slot', render: 'rating' }),
    item({ id: 'up_button', name: 'Наверх', zone: 'fixed', kind: 'function', render: 'up_button' }),
  ] }));
  check('лендинг+оболочка: новые элементы шапки на телефоне - полосой под шапкой (меню нет)', l.code === 0 && /<div class="shell-strip"><span class="ph-need" data-kf="rating">/.test(l.html), l.out.slice(0, 300));
  const chl = run(l.dir, ['scripts/check-html.mjs']);
  check('лендинг+оболочка: check-html pass', chl.code === 0, chl.out.slice(0, 600));
  checkSiteJs('лендинг+оболочка', l.dir);
  // shell.json без items - предупреждение, прототип как без файла
  const w = build('svc-bad-shell', 'fixture-services', dir => wj(path.join(dir, 'work', 'shell.json'), { generated_at: 'x' }));
  check('shell.json без items - предупреждение, ключа shell нет, тело совпадает с эталоном', w.code === 0 && /work\/shell\.json: нет массива items/.test(w.out) && !('shell' in modsOf(w.dir)) && normalizeBody(w.html) === rt(goldenFile('fixture-services')));
}

// ================================================================ 6б. id словаря КФ (config/kf-elements.json): каналы по ключу,
// docs по page_match, регистр в чипе, выключенные модули (замечания рецензии D1-D4)
{
  const DICT = { generated_at: 'x', n_competitors: 5, items: [
    item({ id: 'messenger_whatsapp', name: 'WhatsApp', zone: 'header', kind: 'slot', render: 'messengers' }),
    item({ id: 'messenger_viber', name: 'Viber', zone: 'header', kind: 'slot', render: 'messengers' }),
    item({ id: 'messenger_max', name: 'MAX', zone: 'footer', kind: 'slot', render: 'messengers' }),
    item({ id: 'social_telegram', name: 'Telegram-канал', zone: 'footer', kind: 'slot', render: 'socials' }),
    item({ id: 'social_tiktok', name: 'TikTok', zone: 'footer', kind: 'slot', render: 'socials' }),
    item({ id: 'messengers', name: 'Мессенджеры', zone: 'footer', kind: 'slot', render: 'messengers' }),
    item({ id: 'certificates', name: 'Сертификаты', zone: 'footer', kind: 'page_link', render: 'docs', page_match: { subject_re: 'сертификат|документ' } }),
    item({ id: 'docs', name: 'Документы', zone: 'footer', kind: 'page_link', render: 'docs' }),
    item({ id: 'x-quick-calc', name: 'Быстрый расчет', zone: 'mobile', kind: 'function', niche: true }),
  ] };
  const r = build('svc-dict', 'fixture-services', dir => wj(path.join(dir, 'work', 'shell.json'), DICT));
  const mods = modsOf(r.dir), html = r.html;
  check('словарь КФ: build-html код 0', r.code === 0, r.out.slice(0, 400));
  check('словарь КФ: messenger_whatsapp при канале WhatsApp - shown', stateOf(mods, 'messenger_whatsapp') === 'shown');
  check('словарь КФ: messenger_viber и messenger_max без своих каналов - chip (не «любой канал набора»)', stateOf(mods, 'messenger_viber') === 'chip' && stateOf(mods, 'messenger_max') === 'chip' && /data-kf="messenger_viber"/.test(html) && /data-kf="messenger_max"/.test(html));
  check('словарь КФ: social_telegram при канале telegram - shown', stateOf(mods, 'social_telegram') === 'shown');
  check('словарь КФ: social_tiktok без канала - chip, бренд в чипе с прописной («нужны данные: TikTok»)', stateOf(mods, 'social_tiktok') === 'chip' && /data-kf="social_tiktok">нужны данные: TikTok</.test(html));
  check('словарь КФ: обобщенный id messengers - любой канал набора (shown)', stateOf(mods, 'messengers') === 'shown');
  check('словарь КФ: certificates (docs с page_match) без страницы в карте - page_missing, кнопка-тост «Страница вне прототипа»', stateOf(mods, 'certificates') === 'page_missing' && /data-toast="Страница вне прототипа" data-kf="certificates">Сертификаты<\/button>/.test(html));
  check('словарь КФ: docs без page_match - строка юридических страниц (shown, без новой разметки)', stateOf(mods, 'docs') === 'shown' && !/data-kf="docs"/.test(html));
  const ch = run(r.dir, ['scripts/check-html.mjs']);
  check('словарь КФ: check-html pass', ch.code === 0, ch.out.slice(0, 600));
  // выключенные модули: мессенджеры (каналы есть) - declined с reason off, без чипа; нижняя панель - зона mobile в меню
  const o = build('svc-dict-off', 'fixture-services', dir => {
    wj(path.join(dir, 'work', 'shell.json'), DICT);
    const cf = path.join(dir, 'config', 'project.json');
    const cfg = rj(cf); cfg.site = { ...(cfg.site || {}), off: ['messengers', 'mbar'] }; wj(cf, cfg);
  });
  const om = modsOf(o.dir);
  const wa = ((om.shell && om.shell.items) || []).find(i => i.id === 'messenger_whatsapp');
  check('off messengers: канал есть - declined с reason off, без чипа «нужны данные»', o.code === 0 && wa && wa.state === 'declined' && wa.reason === 'off' && !/data-kf="messenger_whatsapp"/.test(o.html), o.out.slice(0, 300));
  check('off messengers: канала нет - по-прежнему chip', stateOf(om, 'messenger_viber') === 'chip');
  check('off mbar: нижней панели нет, элемент зоны mobile - в мобильном меню', !/<div class="mbar">/.test(o.html) && /<div class="mnav-shell">[\s\S]*data-kf="x-quick-calc"/.test(between(o.html, '<div class="mnav"', '<div class="mnav-contacts">')));
  const co = run(o.dir, ['scripts/check-html.mjs']);
  check('off messengers и mbar: check-html pass (нет chip без чипа)', co.code === 0 && !/shell-chip/.test(co.out), co.out.slice(0, 600));
}

// ================================================================ 7. стиль, UUID, ниша и кириллица в файлах пакета
{
  const YO = String.fromCharCode(0x451), YO2 = String.fromCharCode(0x401), D1 = String.fromCharCode(0x2014), D2 = String.fromCharCode(0x2013);
  const INVIS = [0xad, 0x200b, 0x200c, 0x200d, 0x2060, 0xfeff].map(c => String.fromCharCode(c));
  const NICHE = /(застройщ|депозит|квот[аеуы]|инвестор|недвижим|ипотек|новострой|апартамент|доходност|ювелир|золот|кольц|пирсинг|бриллиант|серебр|серьг|помолвоч|обручал|геммолог|пхукет|двигател|запчаст|trade-in|автомобил|goldax)/i;
  // файлы пакета D в kit и эталонный скрипт; данные фикстур (examples/) и эталонные body/head исключены явно
  const OWN = ['scripts/site-parts.mjs', 'scripts/build-html.mjs', 'scripts/render-blocks.mjs', 'scripts/check-html.mjs', 'scripts/check-site-js.mjs', 'html/site/ui.json', 'html/site/site.css', 'html/site/shell.html', 'schemas/facts.schema.json'].map(f => path.join(TPL, f));
  OWN.push(path.join(HERE, 'fixtures', 'site-golden', 'golden.mjs'));
  const bad = [];
  for (const f of OWN) {
    const t = rt(f);
    const n = path.relative(TPL, f);
    if ([YO, YO2, D1, D2].some(c => t.includes(c))) bad.push(`${n}: е с точками или длинное тире`);
    if (INVIS.some(c => t.includes(c))) bad.push(`${n}: невидимый символ литералом`);
    if (/mcp__[0-9a-f]{8}-/.test(t)) bad.push(`${n}: UUID MCP`);
    const nm = t.match(NICHE); if (nm) bad.push(`${n}: нишевое слово «${nm[0]}»`);
  }
  check('файлы пакета D: без е с точками, длинных тире, невидимых символов, UUID MCP и нишевых слов', !bad.length, bad.join('; '));
  // подписи оболочки - только в ui.json (раздел kf); в стилях оболочки - только серые цвета
  const ui = rj(path.join(TPL, 'html', 'site', 'ui.json'));
  check('ui.json: раздел kf с шаблонами оболочки, need с {name}', ui.kf && /\{name\}/.test(ui.kf.need) && ['toast_function', 'toast_page', 'footer_info', 'stub_note'].every(k => ui.kf[k]));
  const css = rt(path.join(TPL, 'html', 'site', 'site.css'));
  const block = (css.match(/\/\*@shell\*\/([\s\S]*?)\/\*@\/shell\*\//) || [, ''])[1].replace(/\/\*[\s\S]*?\*\//g, '');
  const grey = (r, g, b) => Math.abs(r - g) <= 6 && Math.abs(g - b) <= 6 && Math.abs(r - b) <= 6;
  const colors = [...block.matchAll(/#([0-9a-f]{6}|[0-9a-f]{3})\b/gi)].map(m => (m[1].length === 3 ? m[1].split('').map(x => x + x).join('') : m[1])).filter(h => !grey(...[0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16))));
  const rgba = [...block.matchAll(/rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/g)].filter(m => !grey(+m[1], +m[2], +m[3]));
  check('site.css: блок оболочки есть, в нем только серые цвета', block.length > 200 && !colors.length && !rgba.length, [...colors, ...rgba.map(m => m[0])].join(', '));
  // кириллица в литералах - тест cases-site (сканер scanJs) по site-parts, build-html, render-blocks; здесь - быстрая
  // проверка, что новые строки оболочки не легли литералами
  const sp = rt(path.join(TPL, 'scripts', 'site-parts.mjs'));
  const shellSrc = sp.slice(sp.indexOf('const SHELL_ZONES'), sp.indexOf('export const shellCut'));
  const lits = [...shellSrc.replace(/\/\/[^\n]*/g, '').matchAll(/'[^'\n]*'|`[^`]*`/g)].map(m => m[0]).filter(x => /[А-Яа-я]/.test(x));
  check('site-parts.mjs: в коде оболочки нет кириллицы в литералах (подписи - ui.json kf)', !lits.length, lits.slice(0, 5).join(' | '));
}

fs.rmSync(tmpRoot, { recursive: true, force: true });
for (const n of notes) console.log(n);
for (const f of failures) console.log(f);
console.log(`cases-kf-site: pass ${pass}, fail ${fail}, skip ${skip}`);
process.exit(fail ? 1 : 0);
