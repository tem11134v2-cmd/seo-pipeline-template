// Тесты прототипа-сайта /site-tekst (пакет W4a): build-html, render-blocks, site-parts, check-html, check-site-js,
// serve, словарь интерфейса html/site/ui.json, стили html/site/site.css, фикстуры kit/examples/fixture-{services,
// landing,shop} и дымовая smoke-fixtures; §8e - правки по аудиту 28.09 (пакет P5: меню больших карт, K6/K7, чипы,
// доступность, таблицы, якоря лендинга, реестр проекта K8, согласие, cta-final, Р6, отчет check-site-js, serve).
// Запуск: node .claude/tests/site-tekst/cases-site.mjs (код 0 - все прошли).
// Все во временных папках (os.tmpdir()), без сети и данных клиентов. jsdom для check-site-js ищется от этого файла
// (node_modules шаблона) и передается скриптам переменной SITE_TEKST_NODE_MODULES; если jsdom есть, SKIP - провал.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { validate } from '../../skills/site-tekst/kit/scripts/lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TPL = path.resolve(HERE, '..', '..', 'skills', 'site-tekst', 'kit');
const EX = path.join(TPL, 'examples');
let pass = 0, fail = 0;
const failures = [], notes = [];
function check(name, ok, detail = '') {
  if (ok) pass++;
  else { fail++; failures.push(`FAIL ${name}${detail ? ': ' + String(detail).slice(0, 500) : ''}`); }
}
const rj = f => JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, ''));
const wj = (f, o) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(o, null, 2) + '\n'); };
const rt = f => fs.readFileSync(f, 'utf8');
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cases-site-'));
// jsdom: node_modules шаблона, найденный от файла теста
let NM = '';
try { const p = createRequire(import.meta.url).resolve('jsdom'); NM = p.slice(0, p.lastIndexOf(`${path.sep}node_modules${path.sep}`) + `${path.sep}node_modules`.length); } catch { NM = ''; }
if (!NM) notes.push('jsdom не найден от шаблона: проверки check-site-js пропущены (npm install в корне шаблона)');
function run(cwd, args, env = {}) {
  const r = spawnSync(process.execPath, args, { cwd, encoding: 'utf8', env: { ...process.env, ...(NM ? { SITE_TEKST_NODE_MODULES: NM } : {}), ...env }, timeout: 240000 });
  return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '', out: (r.stdout || '') + (r.stderr || '') };
}
function mkProject(name, fixture) {
  const dir = path.join(tmpRoot, name);
  for (const d of ['scripts', 'rules', 'schemas', 'config', 'html']) fs.cpSync(path.join(TPL, d), path.join(dir, d), { recursive: true });
  if (fixture) for (const d of ['config', 'work', 'rules']) if (fs.existsSync(path.join(fixture, d))) fs.cpSync(path.join(fixture, d), path.join(dir, d), { recursive: true });
  return dir;
}
const count = (s, re) => (s.match(re) || []).length;
// страница прототипа по маршруту: от ее открывающего тега до следующей страницы
function pageOf(html, route) {
  const re = new RegExp(`<div class="page"[^>]*data-route="${route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>`);
  const m = html.match(re);
  if (!m) return '';
  const rest = html.slice(m.index + m[0].length);
  const next = rest.search(/<div class="page"/);
  return m[0] + (next < 0 ? rest : rest.slice(0, next));
}
const sectionOf = (html, id) => (html.match(new RegExp(`<section\\b[^>]*data-block-id="${id}"[^>]*>[\\s\\S]*?<\\/section>`)) || [''])[0];
const markupOf = s => s.replace(/<script\b[\s\S]*?<\/script>/g, ' ').replace(/<style\b[\s\S]*?<\/style>/g, ' ');
// текст без неразрывных пробелов типографики: проверки дословности - по обычным пробелам
const T = s => String(s).replace(/&nbsp;/g, ' ').replace(/ /g, ' ');
const visibleText = s => s.replace(/<script\b[\s\S]*?<\/script>/g, ' ').replace(/<style\b[\s\S]*?<\/style>/g, ' ').replace(/<mark class="ph"[\s\S]*?<\/mark>/g, ' ').replace(/<[^>]+>/g, ' ');
const CYR = /[А-Яа-я\u0401\u0451]/;

// ================================================================ 1. словарь интерфейса: кириллица только в ui.json
// Литералы JS (строки, шаблоны, регулярки) без кириллицы, кроме аргументов console.*, warn(), fail(), die(), new Error()
// (сообщения оператору) и комментариев.
function scanJs(src) {
  const found = [];
  const modes = [{ t: 'code', depth: 0 }];
  const parens = [];
  let i = 0, prev = '', chain = '';
  const exemptNow = () => parens.some(Boolean);
  const regexOk = () => prev === '' || /^[(,=:[!&|?{};+\-*%<>~^]$/.test(prev) || ['return', 'typeof', 'case', 'in', 'of', 'new', 'delete', 'void', 'throw', 'else', 'do'].includes(prev);
  while (i < src.length) {
    const mode = modes[modes.length - 1];
    if (mode.t === 'tpl') {
      let seg = '';
      while (i < src.length) {
        const c = src[i];
        if (c === '\\') { seg += src.slice(i, i + 2); i += 2; continue; }
        if (c === '`') { i++; modes.pop(); break; }
        if (c === '$' && src[i + 1] === '{') { i += 2; modes.push({ t: 'code', depth: 0, inTpl: true }); break; }
        seg += c; i++;
      }
      found.push({ text: seg, exempt: mode.exempt });
      prev = 'tpl';
      continue;
    }
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? src.length : e + 2; continue; }
    if (/\s/.test(c)) { i++; continue; }
    if (c === '"' || c === "'") {
      let j = i + 1, s = '';
      while (j < src.length && src[j] !== c) { if (src[j] === '\\') { s += src.slice(j, j + 2); j += 2; continue; } s += src[j]; j++; }
      found.push({ text: s, exempt: exemptNow() }); i = j + 1; prev = 'str'; chain = ''; continue;
    }
    if (c === '`') { i++; modes.push({ t: 'tpl', exempt: exemptNow() }); continue; }
    if (c === '/' && regexOk()) {
      let j = i + 1, s = '', cls = false;
      while (j < src.length) { const d = src[j]; if (d === '\\') { s += src.slice(j, j + 2); j += 2; continue; } if (d === '[') cls = true; else if (d === ']') cls = false; else if ((d === '/' && !cls) || d === '\n') break; s += d; j++; }
      j++; while (/[a-z]/i.test(src[j] || '')) j++;
      found.push({ text: s, exempt: exemptNow(), regex: true }); i = j; prev = 're'; continue;
    }
    if (/[A-Za-z_$]/.test(c)) { let j = i; while (j < src.length && /[A-Za-z0-9_$]/.test(src[j])) j++; const id = src.slice(i, j); chain = prev === '.' ? `${chain}.${id}` : id; prev = id; i = j; continue; }
    if (c === '(') { parens.push(/^console\.\w+$/.test(chain) || ['warn', 'fail', 'die', 'Error'].includes(chain)); i++; prev = '('; chain = ''; continue; }
    if (c === ')') { parens.pop(); i++; prev = ')'; chain = ''; continue; }
    if (c === '{') { mode.depth++; i++; prev = '{'; chain = ''; continue; }
    if (c === '}') { if (mode.inTpl && mode.depth === 0) { modes.pop(); i++; continue; } mode.depth--; i++; prev = '}'; chain = ''; continue; }
    if (c === '.') { i++; prev = '.'; continue; }
    prev = c; chain = ''; i++;
  }
  return found;
}
{
  // самопроверка сканера: сообщение в console и комментарий - не находки, строка интерфейса - находка
  const probe = scanJs("// коммент\nconst a = 'ok'; console.log(`итог ${'x'}`); warn(`w ${1 > 0 ? 'а' : 'б'}`); const b = `x${y ? 'кнопка' : ''}`; const r = /[а-я]/i; const d = 1 / 2 / 3;");
  const bad = probe.filter(x => !x.exempt && CYR.test(x.text)).map(x => x.text);
  check('сканер литералов: находит кириллицу в шаблоне и регулярке, пропускает console/warn и комментарии', bad.length === 2 && bad.includes('кнопка') && bad.includes('[а-я]'), JSON.stringify(bad));
  for (const f of ['render-blocks.mjs', 'site-parts.mjs', 'build-html.mjs']) {
    const hits = scanJs(rt(path.join(TPL, 'scripts', f))).filter(x => !x.exempt && CYR.test(x.text)).map(x => x.text.slice(0, 60));
    check(`словарь: в литералах ${f} нет кириллицы вне словаря`, !hits.length, hits.slice(0, 5).join(' | '));
  }
  const shell = rt(path.join(TPL, 'html', 'site', 'shell.html'));
  const scripts = [...shell.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  const markup = shell.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, ' ').replace(/<!--[\s\S]*?-->/g, ' ');
  const jsHits = scripts.flatMap(s => scanJs(s)).filter(x => CYR.test(x.text)).map(x => x.text.slice(0, 60));
  check('словарь: в разметке и скрипте html/site/shell.html (без комментариев) нет кириллицы', !CYR.test(markup) && !jsHits.length, `${(markup.match(/.{0,30}[А-Яа-я].{0,30}/) || [''])[0]} ${jsHits.join(' | ')}`);
  const css = rt(path.join(TPL, 'html', 'site', 'site.css'));
  check('словарь: в site.css (без комментариев) нет кириллицы, content без текста', !CYR.test(css.replace(/\/\*[\s\S]*?\*\//g, '')) && !/content:\s*"[^"]+"/.test(css));
  const ui = rj(path.join(TPL, 'html', 'site', 'ui.json'));
  const strs = JSON.stringify(ui);
  check('ui.json: без буквы е с точками и длинных тире', !/[\u0451\u0401\u2014\u2013]/.test(strs));
  check('ui.json: разделы ui, contract, type_groups, lang, maps, ops', ['ui', 'contract', 'type_groups', 'lang', 'maps', 'ops'].every(k => ui[k]) && ui.contract.length >= 3 && Array.isArray(ui.lang.nbsp_words) && Array.isArray(ui.lang.field_kinds));
  const niche = /кольц|золот|пирсинг|ювелир|goldax|бриллиант|серьг|(^|[^а-я])проб[аыу]([^а-я]|$)/i;
  const own = ['scripts/render-blocks.mjs', 'scripts/site-parts.mjs', 'scripts/build-html.mjs', 'scripts/check-html.mjs', 'scripts/check-site-js.mjs', 'scripts/serve.mjs', 'html/site/shell.html', 'html/site/site.css', 'html/site/ui.json', 'html/site/icons.svg', 'html/primitives.css'];
  const nicheHits = own.filter(f => niche.test(rt(path.join(TPL, f))));
  check('нишевых слов прошлых проектов в файлах прототипа kit нет', !nicheHits.length, nicheHits.join(', '));
  check('старая оболочка вайрфрейма html/shell.html удалена', !fs.existsSync(path.join(TPL, 'html', 'shell.html')));
}

// ================================================================ 2. стили: все классы primitives.css стилизованы в site.css
{
  const prim = rt(path.join(TPL, 'html', 'primitives.css')).replace(/\/\*[\s\S]*?\*\//g, '');
  const site = rt(path.join(TPL, 'html', 'site', 'site.css')).replace(/\/\*[\s\S]*?\*\//g, '');
  const classes = [...new Set([...prim.matchAll(/\.([a-zA-Z][\w-]*)/g)].map(m => m[1]))];
  const missing = classes.filter(c => !new RegExp(`\\.${c}(?![\\w-])`).test(site));
  check('site.css стилизует все классы primitives.css', classes.length > 30 && !missing.length, missing.join(', '));
  check('primitives.css: каркаса вайрфрейма нет (stub, pg-head, idx, contract, article[data-page])', !/\.(stub|pg-head|idx|contract)\b|article\[data-page\]/.test(prim));
  check('site.css: только серые цвета', (() => { const bad = [...site.matchAll(/#([0-9a-f]{3,8})\b/gi)].filter(m => { let h = m[1]; if (h.length <= 4) h = h.slice(0, 3).split('').map(x => x + x).join(''); const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); return Math.abs(r - g) > 6 || Math.abs(g - b) > 6; }); return !bad.length; })());
  check('site.css: брейкпоинты 1280/1140/900/520 и prefers-reduced-motion', /max-width: 1279px/.test(site) && /max-width: 1140px/.test(site) && /max-width: 899px/.test(site) && /max-width: 520px/.test(site) && /prefers-reduced-motion/.test(site));
  check('site.css: фото примеров и картинки ч/б (grayscale)', /\.pimg\s*\{[^}]*grayscale\(1\)/.test(site) && /img\s*\{[^}]*grayscale\(1\)/.test(site));
  check('site.css: служебный слой скрыт по умолчанию', /\.dbg-plq, \.dbg-page, \.dbg-panel \{ display: none; \}/.test(site) && /body\.dbg \.dbg-plq/.test(site));
}

// ================================================================ 3. схемы фикстур
{
  const sch = n => rj(path.join(TPL, 'schemas', `${n}.schema.json`));
  for (const f of ['fixture-services', 'fixture-landing', 'fixture-shop']) {
    const e = validate(sch('project-config'), rj(path.join(EX, f, 'config', 'project.json')));
    check(`${f}: config/project.json проходит схему project-config (блок site - C7)`, !e.length, e.slice(0, 3).join('; '));
    const s = validate(sch('sitemap'), rj(path.join(EX, f, 'work', 'sitemap.json')));
    check(`${f}: sitemap проходит схему`, !s.length, s.slice(0, 3).join('; '));
  }
  const bad = validate(sch('project-config'), { slug: 'x', company: 'x', niche: { description: '', business_type: 'services', audience_type: 'b2c', demand_warmth: 'warm', price_level: 'mid', purchase_cycle: 'weeks' }, sources: {}, site: { off: ['nope'] } });
  check('project-config: неизвестный модуль в site.off - ошибка схемы', bad.length === 1, bad.join('; '));
  const cs = validate(sch('catalog-spec'), rj(path.join(EX, 'fixture-shop', 'work', 'catalog', 'catalog-spec.json')));
  check('fixture-shop: catalog-spec проходит схему', !cs.length, cs.slice(0, 3).join('; '));
  if (fs.existsSync(path.join(TPL, 'schemas', 'sample-items.schema.json'))) {
    const si = validate(sch('sample-items'), rj(path.join(EX, 'fixture-shop', 'work', 'catalog', 'sample-items.json')));
    check('fixture-shop: sample-items проходит схему sample-items (C5)', !si.length, si.slice(0, 3).join('; '));
  } else notes.push('схемы sample-items нет (пакет W4b): проверка sample-items фикстуры пропущена');
}

// ================================================================ 4. сайт услуг
const svc = mkProject('services', path.join(EX, 'fixture-services'));
{
  const types = fs.readdirSync(path.join(svc, 'work', 'layouts')).map(f => f.replace(/\.html$/, ''));
  const vl = run(svc, ['scripts/validate-layout.mjs', ...types]);
  check('услуги: validate-layout pass по всем типам фикстуры', vl.code === 0, vl.out.slice(0, 400));
  const b = run(svc, ['scripts/build-html.mjs']);
  check('услуги: build-html код 0, итог «страниц 6, блоков 23», все блоки по раскладкам типа', b.code === 0 && /страниц 6, блоков 23/.test(b.stdout) && !/без раскладки/.test(b.stdout), b.out.slice(0, 400));
  const html = rt(path.join(svc, 'work', 'output', 'prototype.html'));
  const ch = run(svc, ['scripts/check-html.mjs']);
  check('услуги: check-html pass, код 0', ch.code === 0 && /check-html: pass/.test(ch.stdout), ch.out.slice(0, 500));
  const vis = visibleText(html);
  check('услуги: в файле нет каталога, корзины, поиска и фильтров', !/data-catalog|class="catalog|cat-side|fgroup|qchip|fchip|class="filters|class="quick"|pcard|data-cart|data-search|search-sec|cart-sec/.test(markupOf(html)));
  check('услуги: старый элемент filters в листинге хаба - простым списком, без чипов (6.5)', /<ul class="bl"><li>Квартиры<\/li><li>Новостройки<\/li>/.test(sectionOf(pageOf(html, '/uslugi'), 'B02-list')));
  const home = pageOf(html, '/');
  const hero = sectionOf(home, 'B01-hero');
  check('услуги: первый экран главной на раскладке hero-center - темный, с медиа-колонкой', /hero-dark/.test(hero) && /hero-media/.test(hero) && /hero-split/.test(hero));
  check('услуги: вторая кнопка CTA рядом с главной (secondary_action page:uslugi)', /<a class="btn secondary" href="#\/uslugi">/.test(hero));
  const calc = sectionOf(home, 'B03-calc');
  check('услуги: блок pattern custom отрисован текстом (custom_name в служебном слое)', /Сколько стоит ремонт/.test(calc) && !/data-missing/.test(calc) && /калькулятор/.test(calc));
  const rev = T(sectionOf(home, 'B05-reviews'));
  check('услуги: блок незнакомого pattern (timeline) отрисован', /Смета не выросла/.test(rev) && /<blockquote/.test(rev));
  const form = sectionOf(home, 'B07-form');
  check('услуги: поля формы по layout - tel, textarea, file; живая форма', /type="tel"/.test(form) && /<textarea/.test(form) && /type="file"/.test(form) && /data-behavior="form"/.test(form) && /data-act="submit"/.test(form));
  check('услуги: плейсхолдер - чип с исходником в data-ph, в видимом тексте нет [[', /<mark class="ph" data-ph="нужно: юрлицо и ИНН для договора"/.test(form) && !/\[\[/.test(vis));
  check('услуги: неразрывные пробелы после коротких слов и перед « - »', /&nbsp;/.test(home) && /&nbsp;- /.test(home));
  check('услуги: подсветка утверждения без опоры (служебный слой)', /class="dbg-claim"[^>]*>[^<]*Ведем ремонт/.test(sectionOf(home, 'B04-process')));
  check('услуги: у элементов id опорных фактов (data-f), подсказки - в данных скрипта', /data-f="F03"/.test(hero) && /"F03":"смета фиксируется в договоре до начала работ"/.test(html));
  check('услуги: служебный слой скрыт по умолчанию (нет класса dbg у body)', /<body class="">/.test(html) && /<aside class="dbg-plq">/.test(html));
  const cont = pageOf(html, '/kontakty');
  const route = sectionOf(cont, 'B02-route');
  check('услуги: автоссылки только на телефон и почту компании, текст номера дословно', /<a class="link" href="tel:\+78462000000">8 \(846\) 200-00-00<\/a>/.test(route) && /href="mailto:info@kvarta\.example"/.test(route));
  check('услуги: пустой слот карты - карта с адресом и «Построить маршрут»', /class="map-box"/.test(route) && /yandex\.ru\/maps\/\?text=/.test(route));
  const diz = sectionOf(pageOf(html, '/uslugi/dizajn-proekt'), 'B01-hero');
  check('услуги: пустой слот картинки - видимая штриховка с подписью', /data-slot="image"><div class="img"><span>место для фото<\/span><\/div>/.test(diz));
  const gal = sectionOf(pageOf(html, '/uslugi/dizajn-proekt'), 'B02-gallery');
  check('услуги: галерея на раскладке типа - живой слайдер (лента data-slider, стрелки, поведение реестра)', /data-behavior="slider"/.test(gal) && /<div data-slider="1" class="slider"/.test(gal) && count(gal, /data-act="slide"/g) === 2 && !/media-grid/.test(gal), gal.slice(0, 400));
  const nav = (html.match(/<nav class="nav"[\s\S]*?<\/nav>/) || [''])[0];
  check('услуги: меню - пункты первого уровня, у хаба выпадающая панель с плитками детей', count(nav, /class="nav-item/g) === 3 && /has-mega/.test(nav) && count(nav, /class="mtile"/g) === 3);
  check('услуги: юридическая страница - не в меню, в подвале кнопкой с тостом', !/politika/.test(nav) && /data-act="toast" data-toast="Документ вне прототипа">Политика конфиденциальности/.test(html));
  check('услуги: каналы старой (строка) и новой (объект) формы', /href="https:\/\/wa\.me\/78462000000"/.test(html) && /href="https:\/\/t\.me\/kvarta_example"/.test(html));
  check('услуги: телефон в шапке в едином формате', /class="hdr-phone" href="tel:\+78462000000">[\s\S]{0,300}\+7 \(846\) 200-00-00/.test(html));
  check('услуги: страница без брифа - «страница в работе» с h1 интерфейса (subject до « / » без скобок)', /data-ui="1">Электромонтаж в квартире<\/h1>/.test(pageOf(html, '/uslugi/elektrika')) && /data-title="Электромонтаж в квартире"/.test(pageOf(html, '/uslugi/elektrika')) && /Страница в работе/.test(pageOf(html, '/uslugi/elektrika')));
  check('услуги: хаб с pattern listing и старой пометкой listing: true - плитки детей, без каталога', count(pageOf(html, '/uslugi'), /class="ntile"/g) === 3);
  check('услуги: адреса со слешем - маршруты без слеша, крошки по parent', /data-route="\/uslugi\/remont-kvartir"/.test(html) && /<a href="#\/uslugi">Услуги<\/a>/.test(pageOf(html, '/uslugi/remont-kvartir')));
  check('услуги: комментарий-контракт в head и значок «прототип» в подвале из словаря', /<!--\n  ПРОТОТИП САЙТА/.test(html) && /class="proto-badge">Прототип/.test(html));
  check('услуги: подстановки оболочки не остались, sha данных записан', !/\{\{\w+\}\}/.test(html.replace(/<script[\s\S]*?<\/script>/g, '')) && /<meta name="proto-data-sha" content="[0-9a-f]{16}">/.test(html));
  const mods = rj(path.join(svc, 'work', 'output', 'prototype.modules.json'));
  check('услуги: prototype.modules.json - каталога нет (сайт услуг), формы и карта есть', mods.catalog && mods.catalog.on === false && /services/.test(mods.catalog.why) && mods.forms.on && mods.map.on && mods.search.on === false && mods.cart.on === false && Object.values(mods).every(m => 'on' in m && 'why' in m && 'source' in m));
  const idx = rj(path.join(svc, 'work', 'output', 'prototype.index.json'));
  check('услуги: prototype.index.json - {slug: {block_id: текст}}', Object.keys(idx).length === 6 && typeof idx.home['B01-hero'] === 'string');
  if (NM) {
    const js = run(svc, ['scripts/check-site-js.mjs']);
    const rep = fs.existsSync(path.join(svc, 'work', 'output', 'prototype.js-check.json')) ? rj(path.join(svc, 'work', 'output', 'prototype.js-check.json')) : {};
    check('услуги: check-site-js pass (не SKIP)', js.code === 0 && !/SKIP/.test(js.stdout) && rep.verdict === 'pass' && rep.routes_checked === 7 && rep.clicks > 20, js.out.slice(0, 500));
  }
  // запасной путь: без раскладки главной блоки собираются раскладкой по умолчанию для pattern
  const fb = mkProject('services-fallback', path.join(EX, 'fixture-services'));
  fs.rmSync(path.join(fb, 'work', 'layouts', 'home.html'));
  const b2 = run(fb, ['scripts/build-html.mjs']);
  const h2 = rt(path.join(fb, 'work', 'output', 'prototype.html'));
  const home2 = pageOf(h2, '/');
  check('запасной путь: «без раскладки: 7 блоков», custom - секция по элементам, незнакомый pattern отрисован', b2.code === 0 && /без раскладки: 7 блоков/.test(b2.stdout) && /class="custom-block"/.test(sectionOf(home2, 'B03-calc')) && /Смета не выросла/.test(T(sectionOf(home2, 'B05-reviews'))), b2.out.slice(0, 300));
  check('запасной путь: шаги - вертикальный список, вопросы - аккордеон, форма - две колонки', /class="steps"/.test(sectionOf(home2, 'B04-process')) && /class="acc"/.test(sectionOf(home2, 'B06-faq')) && /form-panel/.test(sectionOf(home2, 'B07-form')));
  const ch2 = run(fb, ['scripts/check-html.mjs']);
  check('запасной путь: check-html pass', ch2.code === 0, ch2.out.slice(0, 300));
  // новый живой блок = одна запись в реестре поведений (код сборщика не меняется). Новый вид блока приходит как
  // pattern custom (enum page-type), запись - по id блока типа: 'type:calc'. Второй custom-блок без записи - статичный.
  const reg = mkProject('services-registry', path.join(EX, 'fixture-services'));
  fs.appendFileSync(path.join(reg, 'scripts', 'site-parts.mjs'), "\nREGISTRY['type:calc'] = { behavior: 'calculator', script: \"function (root, S) { root.setAttribute('data-live', '1'); return { show: function () { root.setAttribute('data-shown', '1'); } }; }\" };\n");
  const bf = path.join(reg, 'work', 'pages', 'home', 'brief.json');
  const brief = rj(bf);
  const calcSpec = brief.blocks.find(x => x.block_id === 'B03-calc');
  brief.blocks.find(x => x.block_id === 'B05-reviews').pattern = 'custom';
  wj(bf, brief);
  const br = run(reg, ['scripts/build-html.mjs']);
  const hr = rt(path.join(reg, 'work', 'output', 'prototype.html'));
  const calcOpen = (hr.match(/<section\b[^>]*data-block-id="B03-calc"[^>]*>/) || [''])[0];
  const revOpen = (hr.match(/<section\b[^>]*data-block-id="B05-reviews"[^>]*>/) || [''])[0];
  check('реестр поведений: у блока в фикстуре pattern custom и custom_name (как в схеме page-type)', calcSpec && calcSpec.pattern === 'custom' && !!calcSpec.custom_name);
  check('реестр поведений: запись type:<id блока типа> включает поведение только этому custom-блоку', br.code === 0 && /data-behavior="calculator"/.test(calcOpen) && /data-custom-name="калькулятор"/.test(calcOpen) && /data-pattern="custom"/.test(revOpen) && !/data-behavior/.test(revOpen) && /"calculator": function \(root, S\)/.test(hr), `${br.out.slice(0, 200)} ${calcOpen} ${revOpen}`);
  if (NM) {
    const { JSDOM, VirtualConsole } = createRequire(import.meta.url)('jsdom');
    const dom = new JSDOM(hr, { url: 'http://localhost/prototype.html', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: new VirtualConsole(), beforeParse(w) { w.matchMedia = () => ({ matches: true, addEventListener() {}, addListener() {} }); w.scrollTo = () => {}; } });
    const sec = dom.window.document.querySelector('[data-block-id="B03-calc"]');
    const other = dom.window.document.querySelector('[data-block-id="B05-reviews"]');
    check('реестр поведений: скрипт нового поведения работает при показе маршрута, второй custom-блок не задет', sec && sec.getAttribute('data-live') === '1' && sec.getAttribute('data-shown') === '1' && other && !other.hasAttribute('data-live'));
    dom.window.close();
  }
  // слайдер на раскладке типа: стрелка прокручивает ленту (jsdom)
  if (NM) {
    const { JSDOM, VirtualConsole } = createRequire(import.meta.url)('jsdom');
    let scrolled = 0;
    const dom = new JSDOM(rt(path.join(svc, 'work', 'output', 'prototype.html')), { url: 'http://localhost/prototype.html', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: new VirtualConsole(), beforeParse(w) { w.matchMedia = () => ({ matches: true, addEventListener() {}, addListener() {} }); w.scrollTo = () => {}; w.Element.prototype.scrollBy = function () { if (this.hasAttribute('data-slider')) scrolled++; }; } });
    const W = dom.window;
    W.__PROTO.open('#/uslugi/dizajn-proekt');
    const next = W.__PROTO.current().querySelector('[data-block-id="B02-gallery"] [data-act="slide"][data-dir="1"]');
    if (next) next.dispatchEvent(new W.MouseEvent('click', { bubbles: true }));
    check('слайдер (jsdom): стрелка галереи на раскладке типа прокручивает ленту', !!next && scrolled === 1, `next ${!!next}, scrollBy ${scrolled}`);
    W.close();
  }
  // подсветка утверждений: точка внутри [[...]], [текст](адрес) и **жирного** не рвет конструкцию
  const pa = mkProject('services-para', path.join(EX, 'fixture-services'));
  const pf = path.join(pa, 'work', 'pages', 'home', 'blocks', 'B04-process.json');
  const pj = rj(pf);
  pj.elements.push({ kind: 'text', text: 'Приезжайте в офис. Адрес: [[нужно: адрес. Уточнить у заказчика]]. Цены - **по смете. Без доплат** и [список услуг. Все](/uslugi/). Мы делаем ремонт.' });
  wj(pf, pj);
  const bp = run(pa, ['scripts/build-html.mjs']);
  const hp = rt(path.join(pa, 'work', 'output', 'prototype.html'));
  const secP = sectionOf(pageOf(hp, '/'), 'B04-process');
  const chp = run(pa, ['scripts/check-html.mjs']);
  const repP = rj(path.join(pa, 'work', 'audit', 'html-check.json'));
  check('подсветка утверждений: [[...]], ссылка и жирный с точкой внутри не рвутся, сырых скобок нет', bp.code === 0 && /<mark class="ph" data-ph="нужно: адрес. Уточнить у заказчика"/.test(secP) && /<b>по смете. Без доплат<\/b>/.test(T(secP)) && /<a class="link" href="#\/uslugi">список услуг. Все<\/a>/.test(T(secP)) && /class="dbg-claim"[^>]*>Мы делаем ремонт/.test(secP) && !repP.findings.some(f => f.rule === 'html.raw-placeholder' || f.rule === 'html.text-mismatch'), `${chp.code} ${repP.findings.map(f => f.rule).join(',')}`);
  // негативные: check-html ловит правку текста, внешнюю картинку, цвет, мертвую ссылку, маршрут; «старше данных»
  const bad = mkProject('services-bad', path.join(EX, 'fixture-services'));
  run(bad, ['scripts/build-html.mjs']);
  const outF = path.join(bad, 'work', 'output', 'prototype.html');
  let h3 = rt(outF);
  h3 = h3.replace('Что делаем', 'Что мы делаем').replace('</style>', '.x{color:#ff0000}</style>').replace('<main id="app">', '<main id="app"><img src="https://example.com/a.png"><a href="#">x</a><a href="#/no-such">y</a>');
  fs.writeFileSync(outF, h3);
  const blk = path.join(bad, 'work', 'pages', 'home', 'blocks', 'B02-services.json');
  const bj = rj(blk); bj.summary = 'правка после сборки'; wj(blk, bj);
  const ch3 = run(bad, ['scripts/check-html.mjs']);
  const rep3 = rj(path.join(bad, 'work', 'audit', 'html-check.json'));
  const rules = new Set(rep3.findings.map(f => f.rule));
  check('check-html: blocker - код 2; ловит text-mismatch, external, color, dead, route', ch3.code === 2 && ['html.text-mismatch', 'html.external', 'html.color', 'html.dead', 'html.route'].every(r => rules.has(r)), [...rules].join(', '));
  check('check-html: «прототип старше данных» - строка в консоли и scores.stale, не находка', /прототип старше данных/.test(ch3.stdout) && rep3.scores.stale === true && !rep3.findings.some(f => /stale|старше/.test(f.problem + f.rule)));
  if (NM) {
    const h4 = rt(path.join(svc, 'work', 'output', 'prototype.html')).replace('<main id="app">', '<main id="app"><div class="page" data-route="/zz" data-slug="zz" data-type="x" data-title="z" hidden><h1>z</h1><p>тестовая страница для проверки</p><a href="#/nope">мертвая</a><button type="button">без действия</button></div>').replace('</body>', '<script>setTimeout(function(){ throw new Error("boom"); }, 5);</script></body>');
    const f4 = path.join(svc, 'work', 'output', 'broken.html');
    fs.writeFileSync(f4, h4);
    const js4 = run(svc, ['scripts/check-site-js.mjs', '--file', 'work/output/broken.html']);
    const r4 = rj(path.join(svc, 'work', 'output', 'broken.js-check.json'));
    check('check-site-js: мертвая ссылка, кнопка без действия и ошибка скрипта - код 1', js4.code === 1 && r4.verdict === 'fail' && r4.errors.some(e => e.kind === 'dead' && /nope/.test(e.detail)) && r4.errors.some(e => e.kind === 'dead' && /без действия/.test(e.detail)) && r4.errors.some(e => e.kind === 'script' && /boom/.test(e.detail)), JSON.stringify(r4.errors).slice(0, 400));
  }
}

// ================================================================ 5. лендинг
{
  const land = mkProject('landing', path.join(EX, 'fixture-landing'));
  const vl = run(land, ['scripts/validate-layout.mjs', 'home']);
  check('лендинг: validate-layout pass', vl.code === 0, vl.out.slice(0, 300));
  const b = run(land, ['scripts/build-html.mjs']);
  check('лендинг: build-html код 0, «страниц 1, блоков 5»', b.code === 0 && /страниц 1, блоков 5/.test(b.stdout), b.out.slice(0, 300));
  const html = rt(path.join(land, 'work', 'output', 'prototype.html'));
  const ch = run(land, ['scripts/check-html.mjs']);
  check('лендинг: check-html pass, код 0', ch.code === 0, ch.out.slice(0, 400));
  const nav = (html.match(/<nav class="nav"[\s\S]*?<\/nav>/) || [''])[0];
  check('лендинг: меню нет - ни пунктов-страниц, ни мега-панелей, ни бургера', !/has-mega|nav-link" href="#\/|mnav-open|class="mnav"/.test(markupOf(html)));
  check('лендинг: якоря шапки только из config.site.nav', count(nav, /data-act="scroll"/g) === 4 && /data-target="benefits">Преимущества/.test(nav) && /data-target="form">Заявка/.test(nav));
  const mob = (rt(path.join(TPL, 'html', 'site', 'site.css')).match(/@media \(max-width: 899px\) \{[\s\S]*?\n\}/) || [''])[0];
  check('лендинг: на телефоне якоря шапки видны прокручиваемой строкой (бургера у лендинга нет)', /<body class="is-landing">/.test(html) && /body\.is-landing \.nav \{ display: block !important; \}/.test(mob) && /body\.is-landing \.nav-in \{ overflow-x: auto;/.test(mob));
  const page = pageOf(html, '/');
  check('лендинг: кнопки ведут к блоку-форме (первый экран и шапка)', /class="btn"[^>]*data-act="scroll" data-target="form"/.test(sectionOf(page, 'B01-hero')) && /class="btn btn-cta[^"]*" data-act="scroll" data-target="form"/.test(html));
  check('лендинг: ссылки и плитки на страницы вне прототипа - текстом', /<span class="link-off"[^>]*>Подробнее о материалах/.test(T(page)) && !/href="#\/uslugi|href="#\/materialy/.test(html) && /Все работы/.test(page));
  const mods = rj(path.join(land, 'work', 'output', 'prototype.modules.json'));
  check('лендинг: modules - menu выключено, landing и anchors включены', mods.menu.on === false && mods.landing.on === true && mods.anchors && mods.anchors.on === true);
  if (NM) {
    const js = run(land, ['scripts/check-site-js.mjs']);
    check('лендинг: check-site-js pass (не SKIP)', js.code === 0 && !/SKIP/.test(js.stdout), js.out.slice(0, 400));
  }
}

// ================================================================ 5b. магазин-лендинг: минимум одна карточка (решение 6, n111)
{
  const sl = mkProject('shop-landing', path.join(EX, 'fixture-landing'));
  const cf = path.join(sl, 'config', 'project.json');
  const cfg = rj(cf); cfg.niche = { ...(cfg.niche || {}), business_type: 'catalog' }; wj(cf, cfg);
  wj(path.join(sl, 'work', 'catalog', 'sample-items.json'), { generated_at: '2026-09-27 12:00', items: [{ key: 'primer', category_slug: '*', source: 'illustrative', name: 'Изделие-пример', price: 1000, attributes: [], images: [] }] });
  const b = run(sl, ['scripts/build-html.mjs']);
  const html = b.code === 0 ? rt(path.join(sl, 'work', 'output', 'prototype.html')) : '';
  const page = pageOf(html, '/');
  check('магазин-лендинг: карточка «*» на главной (секция каталога после первого экрана)', b.code === 0 && /data-item="primer"/.test(page) && /class="demo-mark"/.test(page), b.out.slice(0, 300));
  const mods = b.code === 0 ? rj(path.join(sl, 'work', 'output', 'prototype.modules.json')) : {};
  check('магазин-лендинг: modules - catalog включен', mods.catalog && mods.catalog.on === true, JSON.stringify(mods.catalog));
  const ch = run(sl, ['scripts/check-html.mjs']);
  check('магазин-лендинг: check-html без blocker', ch.code !== 2, ch.out.slice(0, 400));
}

// ================================================================ 6. магазин: каталог C5, товар, поиск, корзина, кабинет
{
  const shop = mkProject('shop', path.join(EX, 'fixture-shop'));
  const types = fs.readdirSync(path.join(shop, 'work', 'layouts')).map(f => f.replace(/\.html$/, ''));
  const vl = run(shop, ['scripts/validate-layout.mjs', ...types]);
  check('магазин: validate-layout pass по всем типам', vl.code === 0, vl.out.slice(0, 400));
  const b = run(shop, ['scripts/build-html.mjs']);
  check('магазин: build-html код 0, «страниц 8»', b.code === 0 && /страниц 8, блоков 17/.test(b.stdout), b.out.slice(0, 400));
  const html = rt(path.join(shop, 'work', 'output', 'prototype.html'));
  const ch = run(shop, ['scripts/check-html.mjs']);
  check('магазин: check-html pass, код 0', ch.code === 0, ch.out.slice(0, 500));
  const cards = pg => [...pg.matchAll(/<div class="pcard" data-demo="1" data-item="([^"]+)"/g)].map(m => m[1]);
  const cat = pageOf(html, '/katalog/stulya');
  const cc = cards(cat);
  check('магазин: выдача категории - свои примеры, копии до cards_per_page (8), чужой категории нет', cc.length === 8 && cc.every(k => k === 'stul-oslo'), cc.join(','));
  check('магазин: у выдачи запасные карточки-шаблоны на случай «нет примера» (скрыты)', count(cat, /data-tpl-x="1" hidden/g) === 3);
  const hub = pageOf(html, '/katalog');
  const hc = cards(hub);
  check('магазин: выдача хаба - по примеру каждой дочерней категории, затем копии', hc.length === 8 && hc[0] === 'stul-oslo' && hc[1] === 'stol-berg' && hc.filter(k => k === 'stol-berg').length === 4);
  check('магазин: у каждой карточки пометка «пример с текущего сайта»', count(hub, /<div class="pcard" data-demo="1"/g) === count(hub, /<div class="pcard" data-demo="1"[^>]*><span class="demo-mark">пример с текущего сайта/g));
  check('магазин: первый экран листинга компактный, блок листинга сразу после него', /<section class="list-head blk-hero"/.test(hub) && hub.indexOf('B02-listing') < hub.indexOf('B03-delivery'));
  // п.19: чип, совпавший со значением, выбирает значение (data-value); с именем или подписью фильтра - раскрывает группу
  // (data-group; раньше имя шло в data-value и искалось среди значений)
  check('магазин: чипы filters писателя дословно над панелью, живые при совпадении со значением и именем фильтра', /<button type="button" class="qchip" data-act="qchip" data-value="Дуб"/.test(hub) && /class="qchip" data-act="qchip" data-group="Цвет"/.test(hub), (hub.match(/<div class="quick"[\s\S]*?<\/div>/) || [''])[0]);
  const group = (pg, name) => (pg.match(new RegExp(`<div class="fgroup[^"]*" data-group="${name}"[\\s\\S]*?(?=<div class="fgroup(?: open)?" data-group|<div class="cat-side-f)`)) || [''])[0];
  check('магазин: группа с пустыми values - значения из facets примеров с пометкой «пример»', /Сканди/.test(group(hub, 'Стиль')) && /demo-mark/.test(group(hub, 'Стиль')));
  check('магазин: группа без значений - плашка «нужны данные»', /class="need">нужны данные/.test(group(hub, 'Назначение')));
  check('магазин: значения конкурентов (values_source competitor) - с пометкой «пример»', /demo-mark/.test(group(hub, 'Цвет')) && !/demo-mark/.test(group(hub, 'Материал')));
  check('магазин: range без min/max - ползунок по ценам примеров; toggle и search без плашки', /data-type="range" data-field="price" data-min="7900" data-max="24500"/.test(hub) && /data-type="toggle"/.test(hub) && /data-type="search"/.test(hub) && !/need/.test(group(hub, 'В наличии') + group(hub, 'Поиск по названию')));
  const photos = ['stul-oslo.png', 'stul-oslo-2.png', 'stol-berg.png'].map(f => fs.readFileSync(path.join(shop, 'work', 'catalog', 'samples', f)).toString('base64'));
  check('магазин: каждое фото встроено в файл ровно один раз (копии карточек ссылаются на класс)', photos.every(b64 => html.split(b64).length - 1 === 1) && count(hub, /class="pimg pi-\d+"/g) >= 8);
  check('магазин: внешних картинок нет', !/<img\b[^>]*src="https?:/.test(html));
  const prod = pageOf(html, '/katalog/item');
  check('магазин: страница товара - один h1 (писателя), пример карточки по каждому ключу, первый виден', count(prod, /<h1\b/g) === 1 && count(prod, /class="pp-item" data-item=/g) === 3 && /data-item="stul-oslo" data-demo="1"><div/.test(prod) && /data-item="stol-berg" data-demo="1" hidden/.test(prod));
  check('магазин: карточка ведет на товар с ключом примера (?item=)', /class="pcard-a" href="#\/katalog\/item\?item=stul-oslo"/.test(cat));
  const nav = (html.match(/<nav class="nav"[\s\S]*?<\/nav>/) || [''])[0];
  check('магазин: в меню и мега-панели нет поиска, корзины, кабинета и шаблона товара', !/poisk|korzina|kabinet|katalog\/item/.test(nav) && count(nav, /class="mtile"/g) === 2);
  check('магазин: значки поиска, кабинета и корзины в шапке - по страницам с ui_role', /<form class="search" data-search/.test(html) && /class="hdr-icon" href="#\/kabinet"/.test(html) && /class="hdr-icon" href="#\/korzina"/.test(html));
  check('магазин: корзина с ключом localStorage <slug>-proto-cart-v1 и позицией-примером', /"cart":\{"key":"fixture-shop-proto-cart-v1","demo":"stul-oslo"\}/.test(html) && /data-behavior="cart"/.test(pageOf(html, '/korzina')));
  check('магазин: оформление корзины - прокрутка к блоку-форме страницы', /data-act="scroll" data-target="checkout">Оформить заказ/.test(pageOf(html, '/korzina')));
  check('магазин: кабинет - блоки писателя и заглушка входа', /Вход в кабинет - вне прототипа/.test(pageOf(html, '/kabinet')));
  const mods = rj(path.join(shop, 'work', 'output', 'prototype.modules.json'));
  check('магазин: modules - каталог, товар, фото 3 из 3, поиск, корзина, кабинет', mods.catalog.on && mods.product.on && mods.photos.on && /3 из 3/.test(mods.photos.why) && mods.search.on && mods.cart.on && mods.account.on);
  // K7: действия кнопок магазина по данным стратегии (фикстура с action): выбор - к выдаче, заявка - второе действие
  const decodeAttr = s => String(s).replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  const pageCta = pg => { const m = pg.match(/<div class="page"[^>]*data-cta="([^"]*)"/); try { return m ? JSON.parse(decodeAttr(m[1])) : null; } catch { return null; } };
  const stoly = pageOf(html, '/katalog/stoly');
  const catHead = (cat.match(/<section class="list-head blk-hero"[\s\S]*?<\/section>/) || [''])[0];
  const hubHead = (hub.match(/<section class="list-head blk-hero"[\s\S]*?<\/section>/) || [''])[0];
  check('K7: главная кнопка категории - к выдаче (anchor:listing), вторая «Оставить заявку» - окно заявки', /<a class="btn" data-act="scroll" data-target="listing" href="#" role="button">Выбрать модель<\/a>/.test(catHead) && /<a class="btn secondary" data-act="lead"[^>]*>Оставить заявку<\/a>/.test(catHead), catHead.slice(-700));
  check('K7: главная кнопка хаба - к выдаче', /<a class="btn" data-act="scroll" data-target="listing"[^>]*>Выбрать в каталоге<\/a>/.test(T(hubHead)), hubHead.slice(-500));
  check('K7: нижняя панель телефона на хабе и категориях - к выдаче', [hub, cat, stoly].every(pg => { const c = pageCta(pg); return c && c.attrs && c.attrs['data-act'] === 'scroll' && c.attrs['data-target'] === 'listing'; }), JSON.stringify(pageCta(cat)));
  check('K7: вторая кнопка главной «Смотреть каталог» - переход на хаб каталога (page:katalog)', /<a class="btn secondary" href="#\/katalog">Смотреть каталог<\/a>/.test(pageOf(html, '/')));
  check('K7: кнопка карточки выдачи - card_cta спецификации, не главный CTA страницы', /class="btn btn-sm" data-act="lead" data-title="Узнать цену"/.test(cat) && !/class="btn btn-sm"[^>]*>Выбрать модель</.test(cat));
  // K6: панель по фильтрам страницы и ее родителей, значения и диапазон - по карточкам страницы
  const fgroups = pg => [...pg.matchAll(/<div class="fgroup[^"]*" data-group="([^"]+)"/g)].map(m => m[1]);
  check('K6: фильтр с categories [katalog-stulya] - только на выдаче стульев (нет у столов и хаба), фильтр без categories - на всех', fgroups(cat).includes('Высота сиденья') && !fgroups(stoly).includes('Высота сиденья') && !fgroups(hub).includes('Высота сиденья') && [cat, stoly, hub].every(pg => fgroups(pg).includes('Материал')), `${fgroups(cat)} | ${fgroups(stoly)} | ${fgroups(hub)}`);
  check('K6: values_by_category - свои значения у столов, у хаба и стульев (нет своих и у родителя) - плашка «нужны данные»', /Обеденный/.test(group(stoly, 'Назначение')) && /class="need"/.test(group(hub, 'Назначение')) && /class="need"/.test(group(cat, 'Назначение')));
  check('K6: значения и диапазон по карточкам страницы - у стульев один пример (без ползунка), «Стиль» у столов без значений', !/data-type="range" data-field="price" data-min/.test(cat) && /data-type="range" data-field="price"/.test(cat) && /Сканди/.test(group(cat, 'Стиль')) && /class="need"/.test(group(stoly, 'Стиль')) && !/Сканди/.test(group(stoly, 'Стиль')));
  check('п.19: чип по подписи фильтра (labels) и по имени фильтра ветки - живые, раскрывают группу (data-group)', /data-act="qchip" data-group="Материал"[^>]*>Порода дерева</.test(cat) && /data-act="qchip" data-group="Высота сиденья"[^>]*>Высота сиденья</.test(cat) && !/<span class="qchip">/.test(html));
  if (NM) {
    const js = run(shop, ['scripts/check-site-js.mjs']);
    check('магазин: check-site-js pass (не SKIP)', js.code === 0 && !/SKIP/.test(js.stdout), js.out.slice(0, 500));
    // поведение каталога, товара, поиска и корзины в jsdom
    const { JSDOM, VirtualConsole } = createRequire(import.meta.url)('jsdom');
    const errs = [];
    const vc = new VirtualConsole(); vc.on('jsdomError', e => { if (!/Not implemented/.test(e.message)) errs.push(e.message); }); vc.on('error', m => errs.push(String(m)));
    const dom = new JSDOM(html, { url: 'http://localhost/prototype.html', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc, beforeParse(w) { w.matchMedia = () => ({ matches: true, addEventListener() {}, addListener() {} }); w.scrollTo = () => {}; } });
    const W = dom.window, d = W.document, api = W.__PROTO;
    const cur = () => api.current();
    const shown = () => [...cur().querySelectorAll('.pcard[data-facets]')].filter(c => !c.hidden).map(c => c.getAttribute('data-item'));
    const tick = (el, v) => { const i = [...cur().querySelectorAll('.fgroup input[type=checkbox]')].find(x => x.value === v); i.checked = !i.checked; i.dispatchEvent(new W.Event('change', { bubbles: true })); };
    api.open('#/katalog');
    tick(null, 'Дуб');
    const hubDub = shown();
    check('магазин (jsdom): фильтр по facets на хабе оставляет свои карточки', hubDub.length === 4 && hubDub.every(k => k === 'stol-berg'), hubDub.join(','));
    check('магазин (jsdom): чип выбранного значения и «Сбросить все»', /data-value="Дуб"/.test(cur().querySelector('[data-chips]').innerHTML) && !!cur().querySelector('[data-chips] .chip-reset'));
    api.open('#/katalog/stulya');
    check('магазин (jsdom): новый визит в выдачу - фильтры сброшены', shown().length === 8);
    const lchip = cur().querySelector('.qchip[data-group="Материал"]');
    if (lchip) lchip.dispatchEvent(new W.MouseEvent('click', { bubbles: true }));
    const mg = cur().querySelector('.fgroup[data-group="Материал"]');
    check('магазин (jsdom): чип-подпись фильтра раскрывает и подсвечивает его группу', !!lchip && !!mg && mg.classList.contains('open') && mg.classList.contains('flash'));
    tick(null, 'Дуб');
    const none = cur().querySelector('[data-nomatch]');
    check('магазин (jsdom): отсеклось все - строка «нет примера» и карточки-шаблоны', shown().length === 0 && none && !none.hidden && [...cur().querySelectorAll('[data-tpl-x]')].every(c => !c.hidden));
    api.open('#/katalog/item?item=stol-berg');
    const vis = [...cur().querySelectorAll('.pp-item')].filter(x => !x.hidden).map(x => x.getAttribute('data-item'));
    check('магазин (jsdom): страница товара показывает пример по ключу', vis.length === 1 && vis[0] === 'stol-berg');
    api.open('#/poisk?q=' + encodeURIComponent('стол'));
    check('магазин (jsdom): живой поиск по страницам и примерам', /Стол Берг/.test(cur().querySelector('[data-search-res]').textContent) && /Столы из массива/.test(cur().querySelector('[data-search-res]').textContent));
    api.open('#/korzina');
    check('магазин (jsdom): корзина с позицией-примером', cur().querySelectorAll('.citem').length === 1 && /Стул Осло/.test(cur().querySelector('.citem').textContent));
    cur().querySelector('[data-act="cart-remove"]').dispatchEvent(new W.MouseEvent('click', { bubbles: true }));
    check('магазин (jsdom): удаление позиции - пустая корзина, счетчик скрыт', !cur().querySelector('[data-cartview]').classList.contains('has') && d.querySelector('[data-cart-count]').hidden);
    const lead = cur().querySelector('[data-act="cart-demo"]');
    lead.dispatchEvent(new W.MouseEvent('click', { bubbles: true }));
    check('магазин (jsdom): «положить пример» возвращает позицию', cur().querySelectorAll('.citem').length === 1 && d.querySelector('[data-cart-count]').textContent === '1');
    api.open('#/');
    d.dispatchEvent(new W.KeyboardEvent('keydown', { key: 'd', code: 'KeyD', bubbles: true }));
    check('магазин (jsdom): клавиша D включает служебный слой, у элементов - подсказки фактов', d.body.classList.contains('dbg') && /F02: мебель из массива дуба и бука/.test((cur().querySelector('[data-f]') || {}).title || ''));
    const inp = d.querySelector('.search input');
    inp.focus();
    inp.dispatchEvent(new W.KeyboardEvent('keydown', { key: 'd', code: 'KeyD', bubbles: true }));
    check('магазин (jsdom): в поле ввода клавиша D слой не переключает', d.body.classList.contains('dbg'));
    check('магазин (jsdom): ошибок скриптов нет', !errs.length, errs.join(' | '));
    W.close();
  }
}

// ================================================================ 6b. магазин: запасные ветки выдачи C5 (синтетика поверх fixture-shop)
{
  const cards = pg => [...pg.matchAll(/<div class="pcard" data-demo="1" data-item="([^"]+)"/g)].map(m => m[1]);
  const tpls = pg => count(pg, /<div class="pcard pcard-tpl" data-demo="1">/g);
  const addPages = dir => {
    const f = path.join(dir, 'work', 'sitemap.json');
    const sm = rj(f);
    const base = { geo: '', segment: 'S1', facts_available: [], fact_coverage: 1, block_set: 'full', status: 'planned', source_queries: [], notes: '' };
    sm.pages.push({ ...base, slug: 'katalog-stulya-barnye', url: '/katalog/stulya/barnye', type: 'category', subject: 'Барные стулья', parent: '/katalog/stulya', level: 2, listing: true, source_h1: 'Барные стулья' });
    sm.pages.push({ ...base, slug: 'katalog-divany', url: '/katalog/divany', type: 'category', subject: 'Диваны', parent: '/katalog', level: 1, listing: true, source_h1: 'Диваны' });
    wj(f, sm);
  };
  const s1 = mkProject('shop-fallback', path.join(EX, 'fixture-shop'));
  addPages(s1);
  const b1 = run(s1, ['scripts/build-html.mjs']);
  const h1 = rt(path.join(s1, 'work', 'output', 'prototype.html'));
  const sub = cards(pageOf(h1, '/katalog/stulya/barnye'));
  check('C5: подкатегория без своего товара - товар родительской категории-листинга той же ветки', b1.code === 0 && sub.length === 8 && sub.every(k => k === 'stul-oslo'), `${b1.code} ${sub.join(',')} ${b1.out.slice(0, 200)}`);
  const div = cards(pageOf(h1, '/katalog/divany'));
  check('C5: категория без товаров - карточка «*», товар чужой категории не подставляется', div.length === 8 && div.every(k => k === 'primer'), div.join(','));
  check('C5: карточка «*» - с пометкой «пример» (не «с текущего сайта»)', /<div class="pcard" data-demo="1" data-item="primer"[^>]*><span class="demo-mark">пример<\/span>/.test(pageOf(h1, '/katalog/divany')));
  const hubC = cards(pageOf(h1, '/katalog'));
  check('C5: хаб - по примеру дочерних категорий, у кого они есть; «*» и чужие в выдачу хаба не подмешиваются', hubC[0] === 'stul-oslo' && hubC[1] === 'stol-berg' && !hubC.includes('primer'), hubC.join(','));
  // без карточки «*»: категория без товаров - карточки-шаблоны
  const s2 = mkProject('shop-fallback-tpl', path.join(EX, 'fixture-shop'));
  addPages(s2);
  const sf = path.join(s2, 'work', 'catalog', 'sample-items.json');
  const si = rj(sf); si.items = si.items.filter(i => i.category_slug !== '*'); wj(sf, si);
  const b2 = run(s2, ['scripts/build-html.mjs']);
  const h2 = rt(path.join(s2, 'work', 'output', 'prototype.html'));
  const div2 = pageOf(h2, '/katalog/divany');
  check('C5: нет своих товаров и карточки «*» - карточки-шаблоны, чужих товаров нет', b2.code === 0 && !cards(div2).length && tpls(div2) === 8, `${cards(div2).join(',')} tpl ${tpls(div2)}`);
}

// ================================================================ 7. smoke-fixtures: блок без lint pass - скелет
{
  const sm = mkProject('smoke', path.join(EX, 'smoke-fixtures'));
  const cf = path.join(sm, 'config', 'project.json');
  const cfg = rj(cf); cfg.company = 'Веста Окна'; cfg.slug = 'smoke'; wj(cf, cfg);
  const bb = run(sm, ['scripts/build-briefs.mjs']);
  if (bb.code !== 0) notes.push(`smoke: build-briefs код ${bb.code} (зависимость от W1): ${bb.out.slice(0, 200)}`);
  for (const f of ['home/blocks/B01-hero', 'home/blocks/B02-benefits', 'home/blocks/B03-process', 'okna-rehau/blocks/B01-hero', 'okna-rehau/blocks/B02-listing']) run(sm, ['scripts/lint.mjs', `work/pages/${f}.json`]);
  const b = run(sm, ['scripts/build-html.mjs']);
  check('smoke: build-html - «страниц 2, блоков 5» (строку ждет run.mjs)', b.code === 0 && /страниц 2, блоков 5/.test(b.stdout), b.out.slice(0, 300));
  const ch = run(sm, ['scripts/check-html.mjs']);
  const rep = rj(path.join(sm, 'work', 'audit', 'html-check.json'));
  // ожидаемые скелеты: блоки брифа без файла или без lint pass
  let expected = 0;
  for (const slug of ['home', 'okna-rehau']) {
    const brief = rj(path.join(sm, 'work', 'pages', slug, 'brief.json'));
    for (const bl of brief.blocks) {
      const lf = path.join(sm, 'work', 'audit', slug, `lint-${bl.block_id}.json`);
      const ok = fs.existsSync(path.join(sm, 'work', 'pages', slug, 'blocks', `${bl.block_id}.json`)) && fs.existsSync(lf) && rj(lf).verdict === 'pass';
      if (!ok) expected++;
    }
  }
  check('smoke: check-html код 1, находки - только html.block-missing по скелетам', ch.code === 1 && rep.findings.length === expected && rep.findings.every(f => f.rule === 'html.block-missing') && rep.scores.pages === 2, `${ch.code} ${expected} ${rep.findings.map(f => f.rule + ':' + f.block_id).join(',')}`);
  const lintB02 = path.join(sm, 'work', 'audit', 'home', 'lint-B02-benefits.json');
  if (fs.existsSync(lintB02) && rj(lintB02).verdict !== 'pass') {
    const html = rt(path.join(sm, 'work', 'output', 'prototype.html'));
    const sec = sectionOf(html, 'B02-benefits');
    check('smoke: блок с файлом, но без lint pass - скелет с пометкой «не прошел линтер», текст заказчику не показан', /data-missing="1" data-missing-reason="lint"/.test(sec) && !/Мы/.test(visibleText(sec)) && rep.findings.some(f => f.block_id === 'B02-benefits' && /линтер/.test(f.problem)));
  } else notes.push('smoke: B02-benefits прошел линтер (правила W1 изменились) - проверка скелета «не прошел линтер» пропущена');
  if (NM) {
    const js = run(sm, ['scripts/check-site-js.mjs']);
    check('smoke: check-site-js pass (не SKIP)', js.code === 0 && !/SKIP/.test(js.stdout), js.out.slice(0, 400));
  }
}

// ================================================================ 8. меню на синтетической карте: группировка по типу, «Еще», ui_role, шаблоны
{
  const dir = mkProject('menu');
  const cfg = rj(path.join(dir, 'config', 'project.json')); cfg.slug = 'menu'; cfg.company = 'Тест'; cfg.niche.business_type = 'services'; wj(path.join(dir, 'config', 'project.json'), cfg);
  const pages = [{ slug: 'home', url: '/', type: 'home', subject: 'Главная', parent: '', level: 0, status: 'planned' }];
  for (let i = 1; i <= 12; i++) pages.push({ slug: `usluga-${i}`, url: `https://test.example/usluga-${i}/`, type: 'service', subject: `Услуга номер ${i} с длинным названием для проверки обрезки`, parent: '', level: 0, status: 'planned' });
  pages.push({ slug: 'usluga-1-detal', url: '/usluga-1/detal/', type: 'service', subject: 'Деталь услуги', parent: '', level: 1, status: 'planned' });
  pages.push({ slug: 'dizain', url: '/dizain/', type: 'hub', subject: 'Дизайн интерьера на заказ под ключ', parent: '', level: 0, status: 'planned' });
  pages.push({ slug: 'about', url: '/about/', type: 'info_about', subject: 'О нас', parent: '', level: 0, status: 'planned' });
  pages.push({ slug: 'contacts', url: '/contacts/', type: 'info_contacts', subject: 'Контакты', parent: '', level: 0, status: 'planned' });
  pages.push({ slug: 'poisk', url: '/poisk/', type: 'info_other', subject: 'Поиск', parent: '', level: 0, status: 'planned', ui_role: 'search' });
  pages.push({ slug: 'lk', url: '/lk/', type: 'info_other', subject: 'Кабинет', parent: '', level: 0, status: 'planned', ui_role: 'account' });
  pages.push({ slug: 'tovar', url: '/tovar/{slug}', type: 'product', subject: 'Шаблон', parent: '', level: 0, status: 'planned', template: true });
  wj(path.join(dir, 'work', 'sitemap.json'), { pages });
  wj(path.join(dir, 'work', 'facts.json'), { facts: [], company: { brand: 'Тест', status: 'missing' } });
  const b = run(dir, ['scripts/build-html.mjs']);
  const html = rt(path.join(dir, 'work', 'output', 'prototype.html'));
  const nav = (html.match(/<nav class="nav"[\s\S]*?<\/nav>/) || [''])[0];
  const items = [...nav.matchAll(/<div class="nav-item[^"]*"[^>]*>(?:<a class="nav-link"[^>]*>|<button[^>]*class="nav-link"[^>]*>)([^<]*)/g)].map(m => m[1]);
  check('меню: карта без страниц - сборка проходит (страницы в работе)', b.code === 0, b.out.slice(0, 300));
  check('меню: больше 7 пунктов - группировка по типу, не больше 7 и 72 знаков', items.length <= 7 && items.join('').length <= 72 && items.includes('Услуги') && /data-act="mega"/.test(nav), items.join(' | '));
  // п.21: страница с детьми не группируется - отдельный пункт, ее дети в выпадающей панели и мобильном меню
  // (раньше usluga-1 уходила в группу «Услуги», и ее ребенок usluga-1-detal не имел пункта ни в одном меню)
  const mnav = (html.match(/<div class="mnav" id="mnav"[\s\S]*?<div class="mnav-contacts">/) || [''])[0];
  check('меню: группа из 11 страниц без детей - колонки ссылок, без поиска, кабинета и шаблона', count(nav, /class="mlist"/g) >= 1 && count(nav, /<li><a href="#\/usluga-\d+">/g) === 11 && !/<li><a href="#\/usluga-1">/.test(nav) && !/poisk|\/lk|tovar/.test(nav), nav.slice(0, 300));
  check('меню (п.21): услуга с ребенком - отдельный пункт строки меню, ребенок в ее панели и в мобильном меню', /<a class="nav-link" href="#\/usluga-1"/.test(nav) && /href="#\/usluga-1\/detal"/.test(nav) && /href="#\/usluga-1\/detal"/.test(mnav), items.join(' | '));
  check('меню (п.21): контакты не прячутся в группу «Компания»', /<a class="nav-link" href="#\/contacts"/.test(nav) || /<li><a class="mlist-h" href="#\/contacts"/.test(nav), items.join(' | '));
  check('меню: полные адреса и слеш на конце - маршрут-путь, ребенок по префиксу адреса', /data-route="\/usluga-3"/.test(html) && /<a href="#\/usluga-1">Услуга номер 1 с/.test(pageOf(html, '/usluga-1/detal')));
  const navLabels = [...nav.matchAll(/<(?:a|button)\b[^>]*\bclass="nav-link"[^>]*>([^<]*)/g)].map(m => m[1]);
  const listLabels = [...nav.matchAll(/<li><a href="#\/usluga-\d+"><span>([^<]*)<\/span>/g)].map(m => m[1]);
  const tileLabels = [...html.matchAll(/<span class="mtile-l">([^<]*)<\/span>/g)].map(m => m[1]);
  check('меню: подписи пунктов строки меню - не длиннее 24 знаков', navLabels.length >= 2 && navLabels.every(l => l.length > 0 && l.length <= 24), JSON.stringify(navLabels.filter(l => !l || l.length > 24)));
  check('меню: пункт строки без nav_label - subject, обрезанный по слову до 24 знаков, без висящего предлога', navLabels.includes('Дизайн интерьера'), navLabels.join(' | '));
  check('меню: в колонках и плитках мега-панели без nav_label - название страницы целиком (строка переносится)', listLabels.length === 11 && listLabels.includes('Услуга номер 2 с длинным названием для проверки обрезки') && tileLabels.every(l => l.length > 0), listLabels.slice(0, 2).join(' | '));
  const ch = run(dir, ['scripts/check-html.mjs']);
  const rep = rj(path.join(dir, 'work', 'audit', 'html-check.json'));
  check('меню: check-html без blocker на страницах в работе (h1 интерфейса)', ch.code !== 2 && !rep.findings.some(f => f.rule === 'html.h1'), rep.findings.map(f => f.rule).join(','));
  check('меню (п.21): check-html - все рабочие страницы в меню компьютера и мобильном (нет html.menu)', !rep.findings.some(f => f.rule === 'html.menu'), JSON.stringify(rep.findings.filter(f => f.rule === 'html.menu')));
  // config.site.nav только с якорями и неизвестным slug - меню по карте и предупреждение
  const cfg2 = rj(path.join(dir, 'config', 'project.json')); cfg2.site = { nav: [{ label: 'Якорь', anchor: 'form' }, 'net-takoj'] }; wj(path.join(dir, 'config', 'project.json'), cfg2);
  const b2 = run(dir, ['scripts/build-html.mjs']);
  const h2 = rt(path.join(dir, 'work', 'output', 'prototype.html'));
  const nav2 = (h2.match(/<nav class="nav"[\s\S]*?<\/nav>/) || [''])[0];
  const mods2 = rj(path.join(dir, 'work', 'output', 'prototype.modules.json'));
  check('меню: config.site.nav без пунктов - меню по карте, бургер, предупреждение и why в modules', b2.code === 0 && /config\.site\.nav не дал пунктов/.test(b2.stderr) && count(nav2, /class="nav-item/g) >= 2 && /data-act="mnav-open"/.test(h2) && mods2.menu.on && /config\.site\.nav не дал пунктов/.test(mods2.menu.why) && mods2.menu.source === 'work/sitemap.json', `${b2.out.slice(0, 300)} ${JSON.stringify(mods2.menu)}`);
}

// ================================================================ 8b. CTA главной с action lead: окно заявки с заголовком CTA
{
  const dir = mkProject('lead-title', path.join(EX, 'fixture-services'));
  const bf = path.join(dir, 'work', 'pages', 'home', 'brief.json');
  const brief = rj(bf); brief.cta = { ...(typeof brief.cta === 'object' ? brief.cta : { main: brief.cta }), action: 'lead' }; wj(bf, brief);
  const b = run(dir, ['scripts/build-html.mjs']);
  const html = rt(path.join(dir, 'work', 'output', 'prototype.html'));
  const main = brief.cta.main;
  const hdrBtn = (html.match(/<a class="btn btn-cta[^"]*"[^>]*>/) || [''])[0];
  const mbar = (html.match(/<a class="btn mbar-btn"[^>]*>/) || [''])[0];
  check('шапка: CTA главной с action lead - data-title по тексту CTA (шапка, нижняя панель)', b.code === 0 && !!main && hdrBtn.includes('data-act="lead"') && hdrBtn.includes(`data-title="${main}"`) && mbar.includes(`data-title="${main}"`), `${hdrBtn} | ${mbar}`);
}

// ================================================================ 8c. приемка на данных Goldax: регрессии сборщика (синтетика поверх фикстур)
{
  const dir = mkProject('goldax-regress', path.join(EX, 'fixture-services'));
  const lay = f => path.join(dir, 'work', 'layouts', f);
  // первый экран: в слоте картинки раскладки уже лежит пустая плашка .img; три одинаковых образца карточки на 3 карточки;
  // галерея из трех картинок в слоте-картинке (не лента)
  let home = rt(lay('home.html'));
  home = home.replace(/<section data-block="hero">[\s\S]*?<\/section>/, '<section data-block="hero">\n  <div class="cols cols-2">\n    <div class="stack" data-slot="h1 sub bullets button"></div>\n    <div data-slot="image"><div class="img tall"></div></div>\n  </div>\n</section>');
  home = home.replace(/<section data-block="services">[\s\S]*?<\/section>/, '<section data-block="services">\n  <div class="stack" data-slot="h2"></div>\n  <div class="grid grid-3">\n    <div class="card" data-slot="card image"></div>\n    <div class="card" data-slot="card image"></div>\n    <div class="card" data-slot="card image"></div>\n    <div class="card" data-slot="card image"></div>\n  </div>\n</section>');
  fs.writeFileSync(lay('home.html'), home);
  fs.writeFileSync(lay('service.html'), rt(lay('service.html')).replace('<div class="slider" data-slot="image"></div>', '<div class="img tall" data-slot="image"></div>'));
  // реквизиты: факт kind legal с номером регистрации - в подвал; условие kind legal без номера - нет
  const ff = path.join(dir, 'work', 'facts.json');
  const facts = rj(ff); facts.facts.push({ id: 'F60', label: 'лицензия', value: 'лицензия № 63-000123', wording: 'Лицензия № 63-000123', publish: 'yes', source_quote: 'лицензия', kind: 'legal' }); wj(ff, facts);
  const b = run(dir, ['scripts/build-html.mjs']);
  const html = rt(path.join(dir, 'work', 'output', 'prototype.html'));
  const hero = sectionOf(pageOf(html, '/'), 'B01-hero');
  check('раскладка: пустая плашка картинки в слоте заполняется, второй плашки нет', b.code === 0 && count(hero, /<div class="img\b/g) === 1 && /<div class="img tall"><span>/.test(hero), hero.slice(0, 400));
  const svcSec = sectionOf(pageOf(html, '/'), 'B02-services');
  check('раскладка: соседние образцы плитки заменены клонами - нет пустых карточек и плашек фото', count(svcSec, /class="card[ "]/g) >= 3 && !/data-slot="card image"/.test(svcSec) && !/<div class="img/.test(svcSec), svcSec.slice(0, 500));
  const gal = sectionOf(pageOf(html, '/uslugi/dizajn-proekt'), 'B02-gallery');
  check('раскладка: картинки по одной в слоте-картинке - сетка медиа, не сетка карточек', /<div class="media-grid">/.test(gal) && count(gal, /<div class="img"/g) === 3, gal.slice(0, 400));
  const ftr = (html.match(/<footer class="ftr">[\s\S]*?<\/footer>/) || [''])[0];
  check('подвал: каналы строками «подпись: значение» (ник или номер), ссылка-URL строкой не выводится', /class="fc-row fc-ch"/.test(ftr) && ftr.includes('Telegram: @kvarta_example') && !/fc-ch[^>]*>[\s\S]{0,300}?https:\/\/wa\.me/.test(ftr.replace(/href="[^"]*"/g, '')), ftr.slice(0, 300));
  check('подвал: «Построить маршрут» под адресом (адрес есть)', /class="fc-route" href="https:\/\/yandex\.ru\/maps\//.test(ftr));
  check('подвал: реквизит с номером (kind legal) - строкой, условие kind legal без номера - нет', ftr.includes('Лицензия № 63-000123') && !ftr.includes('гарантия 3 года'));
  check('значки каналов: свой значок у известного канала, символ есть в спрайте', /href="#i-ch-telegram"/.test(html) && /id="i-ch-telegram"/.test(html));
  const ch = run(dir, ['scripts/check-html.mjs']);
  check('регрессии: check-html без blocker', ch.code !== 2, ch.out.slice(-300));
  // магазин: строка разделов хаба каталога над выдачей (дочерние листинги), на категории ее нет
  const shop = mkProject('goldax-regress-shop', path.join(EX, 'fixture-shop'));
  run(shop, ['scripts/build-html.mjs']);
  const sh = rt(path.join(shop, 'work', 'output', 'prototype.html'));
  const sm = rj(path.join(shop, 'work', 'sitemap.json'));
  const hubP = sm.pages.find(p => p.type === 'hub' && p.listing);
  const kids = sm.pages.filter(p => p.listing && p.type === 'category');
  const hubHtml = hubP ? pageOf(sh, hubP.url.replace(/\/+$/, '')) : '';
  const strip = (hubHtml.match(/<nav class="cat-kids"[\s\S]*?<\/nav>/) || [''])[0];
  check('каталог: хаб - строка разделов (плитки дочерних листингов) над выдачей', !!hubP && kids.length >= 2 && count(strip, /class="ckid"/g) === kids.length && hubHtml.indexOf('cat-kids') < hubHtml.indexOf('data-catalog'), strip.slice(0, 300));
  check('каталог: на категории строки разделов нет', kids.every(k => !/class="cat-kids"/.test(pageOf(sh, k.url.replace(/\/+$/, '')))));
}

{
  // интеграция (рецензия P5, K6): одно имя фильтра с разными областями - на странице самый точный (своя категория, затем
  // ближайший предок, затем фильтр без categories); порядок групп - первое появление имени
  const parts = await import(new URL('../../skills/site-tekst/kit/scripts/site-parts.mjs', import.meta.url).href);
  const hub = { slug: 'katalog', parent: null }, stoly = { slug: 'katalog-stoly', parent: hub }, kruglye = { slug: 'stoly-kruglye', parent: stoly }, stulya = { slug: 'katalog-stulya', parent: hub };
  const S = { catalogSpec: { filters: [
    { name: 'Материал', type: 'multi', values: ['Дуб', 'Сосна'] },
    { name: 'Цвет', type: 'multi', values: ['Белый'] },
    { name: 'Материал', type: 'multi', values: ['Металл'], categories: ['katalog-stoly'] },
    { name: 'Материал', type: 'multi', values: ['Стекло'], categories: ['stoly-kruglye'] },
    { name: 'Высота', type: 'multi', values: ['45 см'], categories: ['katalog-stulya'] },
  ] } };
  const pf = pg => parts.pageFilters(S, pg).map(f => `${f.name}:${f.values.join('/')}`).join(', ');
  check('K6: одно имя с разными областями - на столах фильтр ветки, у круглых столов - свой, у стульев и хаба - общий; порядок по первому появлению',
    pf(stoly) === 'Материал:Металл, Цвет:Белый' && pf(kruglye) === 'Материал:Стекло, Цвет:Белый' && pf(stulya) === 'Материал:Дуб/Сосна, Цвет:Белый, Высота:45 см' && pf(hub) === 'Материал:Дуб/Сосна, Цвет:Белый',
    [stoly, kruglye, stulya, hub].map(pf).join(' | '));
}
{
  // доделка №19 (повторная проверка): chipTarget - чип по фильтру без значений, разбор перечня значений, перечень без
  // двоеточия в labels; прежние ответы (значение, имя, подпись-синоним, чип без фильтра) не меняются
  const parts = await import(new URL('../../skills/site-tekst/kit/scripts/site-parts.mjs', import.meta.url).href);
  const G = (name, type, values, labels = []) => ({ name, type, ...(values ? { values } : {}), labels });
  const groups = [
    G('Цена', 'range', null, ['Стоимость: от и до', 'Цена от и до']),
    G('Из своего материала', 'toggle', null),
    G('Поиск по названию', 'search', null),
    G('Размер', 'check', ['16,5', '17', '18']),
    G('Порода', 'check', ['Дуб', 'Бук', 'Сосна'], ['Порода дерева', 'Порода: дуб, бук, венге']),
    G('Отделка', 'check', ['Матовая', 'Глянцевая', 'Шпон'], ['Матовая, Глянцевая, Лак', 'Матовая, Глянцевая', 'Матовая и лак', 'Для кухни, для офиса', 'Отделка и цвет', 'Отделка, порода']),
    G('В наличии', 'toggle', null),
    G('Стиль', 'need', null),
  ];
  const ct = s => JSON.stringify(parts.chipTarget(groups, s));
  const live = (s, g) => ct(s) === JSON.stringify({ group: g });
  const dead = s => parts.chipTarget(groups, s) === null;
  check('доделка №19: чип с двоеточием по range/toggle/search - живой по имени фильтра или подписи, значения после двоеточия не нужны',
    live('Цена: от и до', 'Цена') && live('Стоимость: от и до', 'Цена') && live('Цена от и до', 'Цена') && live('Из своего материала: да', 'Из своего материала') && live('Поиск по названию: модель', 'Поиск по названию') && dead('Своего материала: да') && dead('Стоимость: до 10 000'),
    ['Цена: от и до', 'Стоимость: от и до', 'Из своего материала: да', 'Своего материала: да', 'Стоимость: до 10 000'].map(ct).join(' | '));
  check('доделка №19: значения после двоеточия - десятичная запятая, союз «и»/«или», точка в конце, ; и запятая без пробела, без учета регистра',
    live('Размер: 16,5, 17', 'Размер') && dead('Размер: 16,5, 19') && live('Размер: 16,5 и 17.', 'Размер') && live('Порода: дуб и бук', 'Порода') && live('Порода: дуб, бук.', 'Порода') && live('Порода: ДУБ; бук', 'Порода') && live('Порода: дуб,бук', 'Порода') && live('Порода дерева: дуб или сосна', 'Порода') && dead('Порода: дуб или венге') && dead('Порода: дуб, бук, венге'),
    ['Размер: 16,5, 17', 'Размер: 16,5 и 17.', 'Порода: дуб и бук', 'Порода: дуб, бук.', 'Порода дерева: дуб или сосна'].map(ct).join(' | '));
  check('доделка №19: значение и переключатель - без учета регистра и точки в конце, data-value - значение фильтра как в панели',
    ct('дуб') === JSON.stringify({ value: 'Дуб' }) && ct('Сосна.') === JSON.stringify({ value: 'Сосна' }) && ct('в наличии') === JSON.stringify({ value: 'В наличии' }) && ct('16,5') === JSON.stringify({ value: '16,5' }),
    ['дуб', 'Сосна.', 'в наличии'].map(ct).join(' | '));
  // подпись в labels без двоеточия - перечень, только если в ней есть значение фильтра; без значений - признак другими
  // словами (смысл подтвердил автор спецификации): «Для кухни, для офиса» живой, как «Для нее и для него» (07-catalog-spec-writer п.5)
  check('доделка №19: перечень в labels без двоеточия - все значения у фильтра, иначе неживой; подпись без значений - признак',
    dead('Матовая, Глянцевая, Лак') && live('Матовая, Глянцевая', 'Отделка') && dead('Матовая и лак') && live('Для кухни, для офиса', 'Отделка') && live('Отделка, порода', 'Отделка'),
    ['Матовая, Глянцевая, Лак', 'Матовая и лак', 'Для кухни, для офиса', 'Отделка, порода'].map(ct).join(' | '));
  check('доделка №19: прежние ответы - значение, имя, подпись-синоним и чип из двух признаков через «и» живые, чип без фильтра и без значений неживой',
    ct('Дуб') === JSON.stringify({ value: 'Дуб' }) && live('Порода', 'Порода') && live('Порода дерева', 'Порода') && live('Отделка и цвет', 'Отделка') && live('Стиль', 'Стиль') && dead('Стиль: лофт') && dead('Гарибальди') && dead('Порода: венге'),
    ['Порода дерева', 'Отделка и цвет', 'Стиль', 'Стиль: лофт'].map(ct).join(' | '));
}
{
  // доделка №19 (вторая повторная проверка): подписи labels, живые на версии 28.09, остаются живыми - признак с единицей
  // («Длина, см»), синонимы через запятую («Металл, цвет»); признак и значения без двоеточия, общее слово перечня. Перечень
  // со значением фильтра - все его части значения: подпись другого фильтра частью-признаком не считается, косая черта
  // делит; значение другой ветки (known) - значение, а не признак; запятая без пробела и многоточие после двоеточия
  const parts = await import(new URL('../../skills/site-tekst/kit/scripts/site-parts.mjs', import.meta.url).href);
  const G = (name, type, values, labels = [], known) => ({ name, type, ...(values ? { values } : {}), labels, ...(known ? { known } : {}) });
  const groups = [
    G('Мощность', 'range', null, ['Мощность, Вт']),
    G('Размер', 'check', ['16', '16,5', '17'], ['Размер, мм', 'Размер кольца']),
    G('Длина цепочки', 'check', ['40', '45', '50'], ['Длина, см', 'Длина цепочки, см']),
    G('Объем', 'check', ['0,5', '1', '1,5'], ['Объем, л', 'Объем чаши, л']),
    G('Металл и цвет', 'check', ['Белое золото', 'Желтое золото', 'Серебро'], ['Металл, цвет', 'Белое и желтое золото', 'Белое, желтое и красное золото', 'Золото/серебро', 'Белое золото/серебро']),
    G('Вставка', 'check', ['Бриллиант', 'Фианит', 'Без вставки'], ['Камень, вставка', 'Основная вставка']),
    G('Проба', 'check', ['585', '750'], ['Проба 585 и 750', 'Проба золота']),
    G('Плетение', 'check', ['Бисмарк', 'Фигаро', 'Якорное'], ['Плетения Бисмарк и Фигаро', 'Бисмарк, Фигаро, Гарибальди', 'Двойной Бисмарк, Фигаро', 'Вид плетения Бисмарк', 'Гарибальди'], ['Бисмарк', 'Фигаро', 'Якорное', 'Гарибальди']),
    G('Вид', 'check', ['Цепь', 'Браслет'], ['Гарибальди', 'Ромб']),
    G('Порода', 'check', ['Дуб', 'Бук'], ['Порода дерева', 'Порода дуб и бук', 'Ромб, Бук']),
  ];
  const ct = s => JSON.stringify(parts.chipTarget(groups, s));
  const live = (s, g) => ct(s) === JSON.stringify({ group: g });
  const dead = s => parts.chipTarget(groups, s) === null;
  const LIVE_OLD = [['Мощность, Вт', 'Мощность'], ['Размер, мм', 'Размер'], ['Длина, см', 'Длина цепочки'], ['Длина цепочки, см', 'Длина цепочки'], ['Объем, л', 'Объем'], ['Объем чаши, л', 'Объем'], ['Металл, цвет', 'Металл и цвет'], ['Камень, вставка', 'Вставка'], ['Основная вставка', 'Вставка'], ['Размер кольца', 'Размер'], ['Проба золота', 'Проба']];
  check('вторая проверка №19: подпись «признак, единица» и синонимы через запятую у фильтра со значениями - живые, как на версии 28.09',
    LIVE_OLD.every(([s, g]) => live(s, g)), LIVE_OLD.map(([s]) => `${s} ${ct(s)}`).join(' | '));
  check('вторая проверка №19: признак и значения без двоеточия, общее слово перечня - живые при всех значениях фильтра',
    live('Проба 585 и 750', 'Проба') && live('Плетения Бисмарк и Фигаро', 'Плетение') && live('Белое и желтое золото', 'Металл и цвет') && live('Порода дуб и бук', 'Порода') && live('Белое золото/серебро', 'Металл и цвет'),
    ['Проба 585 и 750', 'Плетения Бисмарк и Фигаро', 'Белое и желтое золото', 'Порода дуб и бук', 'Белое золото/серебро'].map(ct).join(' | '));
  check('вторая проверка №19: перечень со значением фильтра - неживой при чужой части (подпись другого фильтра, слово перед значением, косая черта, общее слово)',
    dead('Бисмарк, Фигаро, Гарибальди') && dead('Двойной Бисмарк, Фигаро') && dead('Вид плетения Бисмарк') && dead('Золото/серебро') && dead('Белое, желтое и красное золото') && dead('Ромб, Бук'),
    ['Бисмарк, Фигаро, Гарибальди', 'Двойной Бисмарк, Фигаро', 'Вид плетения Бисмарк', 'Золото/серебро', 'Белое, желтое и красное золото', 'Ромб, Бук'].map(ct).join(' | '));
  check('вторая проверка №19: одно значение другой ветки (known) в labels - неживой; без known подпись из одного слова - признак',
    dead('Гарибальди') === false && ct('Гарибальди') === JSON.stringify({ group: 'Вид' }) && parts.chipTarget([groups[7]], 'Гарибальди') === null && parts.chipTarget([{ ...groups[7], known: undefined }], 'Гарибальди') !== null,
    [ct('Гарибальди'), JSON.stringify(parts.chipTarget([groups[7]], 'Гарибальди'))].join(' | '));
  check('вторая проверка №19: после двоеточия - запятая без пробела у десятичных, многоточие в конце; описание у фильтра со значениями - неживой',
    live('Размер: 16,5,17', 'Размер') && live('Вставка: бриллиант…', 'Вставка') && live('Вставка: бриллиант...', 'Вставка') && dead('Вставка: любая') && dead('Размер: от 16 до 18') && dead('Размер: 16,5,18'),
    ['Размер: 16,5,17', 'Вставка: бриллиант…', 'Вставка: любая', 'Размер: 16,5,18'].map(ct).join(' | '));
}
// ================================================================ 8d. правки по приемке Goldax: вторая кнопка CTA по подписи,
// карта на странице контактов, cta-band - темная карточка внутри контейнера
{
  // 1. site-parts secondaryByText: точное имя канала (целым словом, без учета регистра) - канал; основа из
  // ui.json lang.cta_route_words при известном адресе - карта; иначе null (правило C10)
  const parts = await import(new URL('../../skills/site-tekst/kit/scripts/site-parts.mjs', import.meta.url).href);
  const uiJ = rj(path.join(TPL, 'html', 'site', 'ui.json'));
  const Sx = { off: new Set(), mapsHref: 'https://yandex.ru/maps/?text=A', ui: { lang: uiJ.lang }, contacts: { channels: [{ key: 'telegram', label: 'Telegram', href: 'https://t.me/x', value: '@x' }, { key: 'max', label: 'MAX', href: '', value: '+7 900 000-00-00' }, { key: 'vk', label: 'ВКонтакте', href: 'https://vk.com/x', value: '' }] } };
  const sb = tx => parts.secondaryByText(Sx, tx);
  check('ui.json: lang.cta_route_words - список основ с «маршрут»', Array.isArray(uiJ.lang.cta_route_words) && uiJ.lang.cta_route_words.includes('маршрут'));
  check('вторая кнопка по подписи: канал со ссылкой - ссылка канала, без ссылки - окно каналов, регистр не важен',
    sb('Написать в telegram')?.attrs.href === 'https://t.me/x' && sb('Написать в telegram').attrs.target === '_blank' && sb('Написать в MAX')?.attrs['data-act'] === 'msg' && sb('Мы во вконтакте')?.kind === 'channel');
  check('вторая кнопка по подписи: имя канала только целым словом, «мессенджер» без имени - не канал',
    sb('Maximum выгоды') === null && sb('Написать в мессенджер') === null && sb('Посмотреть услуги') === null);
  check('вторая кнопка по подписи: слово маршрута и адрес - карта «Построить маршрут»', sb('Построить маршрут')?.kind === 'route' && sb('Построить маршрут').attrs.href === Sx.mapsHref && sb('Как добраться до офиса')?.kind === 'route');
  check('вторая кнопка по подписи: без адреса нет маршрута, мессенджеры выключены - нет канала', parts.secondaryByText({ ...Sx, mapsHref: '' }, 'Построить маршрут') === null && parts.secondaryByText({ ...Sx, off: new Set(['messengers']) }, 'Написать в Telegram') === null);

  // сборка: вторые кнопки без secondary_action - в первом экране, финальном блоке и кнопкой блока
  const dir = mkProject('accept-fixes', path.join(EX, 'fixture-services'));
  const pgf = (slug, f) => path.join(dir, 'work', 'pages', slug, f);
  const setCta = (slug, cta) => { const b = rj(pgf(slug, 'brief.json')); b.cta = cta; wj(pgf(slug, 'brief.json'), b); };
  // Р6: путь по подписи - только при старом формате CTA. Копия фикстуры становится «старыми данными»: у стратегии и
  // всех брифов нет action и secondary_action (фикстура как есть - новый формат, там путь по подписи выключен, ниже)
  const stripAct = c => { if (!c || typeof c !== 'object') return c; const { action, secondary_action, ...rest } = c; return rest; };
  { const sf = path.join(dir, 'work', 'strategy.json'); const sj = rj(sf); for (const k of Object.keys(sj.global.cta_by_type)) sj.global.cta_by_type[k] = stripAct(sj.global.cta_by_type[k]); wj(sf, sj); }
  for (const slug of fs.readdirSync(path.join(dir, 'work', 'pages'))) { if (!fs.existsSync(pgf(slug, 'brief.json'))) continue; const bj = rj(pgf(slug, 'brief.json')); bj.cta = stripAct(bj.cta); wj(pgf(slug, 'brief.json'), bj); }
  setCta('home', { main: 'Рассчитать стоимость ремонта', short: 'Рассчитать', secondary: 'Написать в Telegram' });
  setCta('uslugi-dizajn-proekt', { main: 'Рассчитать стоимость', secondary: 'Построить маршрут' });
  setCta('uslugi-remont-kvartir', { main: 'Рассчитать стоимость', secondary: 'Посмотреть услуги' });
  setCta('uslugi', { main: 'Подобрать услугу', secondary: 'Написать в WhatsApp' });
  const hubCta = rj(pgf('uslugi', 'blocks/B03-cta.json')); hubCta.elements.push({ kind: 'button', text: 'Написать в WhatsApp', layout: 'secondary' }); wj(pgf('uslugi', 'blocks/B03-cta.json'), hubCta);
  // 3 (подготовка). второй cta-band на странице: галерея дизайн-проекта становится призывом перед B03-cta
  const db = rj(pgf('uslugi-dizajn-proekt', 'brief.json')); db.blocks.find(x => x.block_id === 'B02-gallery').pattern = 'cta-band'; wj(pgf('uslugi-dizajn-proekt', 'brief.json'), db);
  // 2. страница контактов без блока с картой: блок pattern map убран из брифа
  const kb = rj(pgf('kontakty', 'brief.json')); kb.blocks = kb.blocks.filter(x => x.pattern !== 'map'); wj(pgf('kontakty', 'brief.json'), kb);
  const b = run(dir, ['scripts/build-html.mjs']);
  const html = b.code === 0 ? rt(path.join(dir, 'work', 'output', 'prototype.html')) : '';
  const heroOf = r => sectionOf(pageOf(html, r), 'B01-hero');
  check('вторая кнопка без secondary_action: «Написать в Telegram» открывает канал Telegram', b.code === 0 && /<a class="btn secondary" href="https:\/\/t\.me\/kvarta_example" target="_blank" rel="noopener">Написать в Telegram<\/a>/.test(heroOf('/')), b.out.slice(0, 300));
  const diz = pageOf(html, '/uslugi/dizajn-proekt');
  check('вторая кнопка без secondary_action: «Построить маршрут» - ссылка на карту (первый экран и финальный блок)', count(diz, /<a class="btn secondary" href="https:\/\/yandex\.ru\/maps\/\?text=[^"]+" target="_blank" rel="noopener">Построить маршрут<\/a>/g) === 2);
  check('вторая кнопка без secondary_action: подпись без канала и маршрута - прежнее правило C10 (к блоку-форме)', /<a class="btn secondary" data-act="scroll" data-target="cta" href="#" role="button">Посмотреть услуги<\/a>/.test(heroOf('/uslugi/remont-kvartir')), heroOf('/uslugi/remont-kvartir').slice(-600));
  check('вторая кнопка без secondary_action: кнопка блока с подписью cta.secondary - канал WhatsApp', /<a class="btn secondary" href="https:\/\/wa\.me\/78462000000" target="_blank" rel="noopener"[^>]*>Написать в WhatsApp<\/a>/.test(T(sectionOf(pageOf(html, '/uslugi'), 'B03-cta'))));
  const mods = b.code === 0 ? rj(path.join(dir, 'work', 'output', 'prototype.modules.json')) : {};
  const cs = mods.cta_secondary || {};
  check('prototype.modules.json: cta_secondary.by_text - сколько кнопок пошло путем по подписи, why с числом', cs.on && cs.by_text && cs.by_text.channel === 3 && cs.by_text.route === 2 && /по подписи кнопки: 5 \(канал из company\.channels: 3, маршрут на карту: 2\)/.test(cs.why) && /без cta\.secondary_action: 1 из \d+/.test(cs.why), JSON.stringify(cs));
  check('Р6: prototype.modules.json - пометка старого формата CTA (legacy_cta и строка why)', cs.legacy_cta === true && /старый формат CTA/.test(cs.why), JSON.stringify(cs));
  const cont = pageOf(html, '/kontakty');
  const mapSec = (cont.match(/<section class="blk[^"]*blk-map" data-module="map">[\s\S]*?<\/section>/) || [''])[0];
  check('контакты без блока с картой: сборщик добавил секцию карты после первого экрана', !!mapSec && cont.indexOf('data-module="map"') > cont.indexOf('data-block-id="B01-hero"') && cont.indexOf('data-module="map"') < cont.indexOf('data-block-id="B03-form"'), cont.slice(0, 300));
  check('контакты: секция карты - заглушка карты, адрес и «Построить маршрут»', /class="map-box"/.test(mapSec) && /class="map"/.test(mapSec) && count(mapSec, /Самара, ул\. Примерная, 10/g) >= 2 && /href="https:\/\/yandex\.ru\/maps\/\?text=[^"]+" target="_blank" rel="noopener">Построить маршрут/.test(mapSec) && !/data-block-id/.test(mapSec));
  check('контакты: модуль map в prototype.modules.json - added и why', mods.map && mods.map.on && Array.isArray(mods.map.added) && mods.map.added.join() === 'kontakty' && /секция карты после первого экрана добавлена сборщиком \(kontakty\)/.test(mods.map.why), JSON.stringify(mods.map));
  check('контакты с блоком pattern map (фикстура как есть): секция карты не добавляется', !/data-module="map"/.test(pageOf(rt(path.join(svc, 'work', 'output', 'prototype.html')), '/kontakty')) && rj(path.join(svc, 'work', 'output', 'prototype.modules.json')).map.added.length === 0);
  // 3. cta-band: темная карточка внутри контейнера, секция чередует фон, полосы во всю ширину нет
  const band = sectionOf(pageOf(html, '/uslugi'), 'B03-cta');
  check('cta-band: секция blk-band, внутри контейнера карточка band band-dark (не темная секция во всю ширину)', /^<section class="blk(?: alt)? blk-band"/.test(band) && /<div class="container"><div class="band band-dark">/.test(band) && !/class="blk-dark|class="blk[^"]*\bblk-dark\b/.test(html), band.slice(0, 300));
  const dizGal = sectionOf(diz, 'B02-gallery'), dizCta = sectionOf(diz, 'B03-cta');
  check('cta-band: первая карточка страницы темная, следующая - светлая (.band), обе внутри контейнера, и в последнем блоке',
    /^<section class="blk(?: alt)? blk-band"/.test(dizGal) && /<div class="container"><div class="band band-dark">/.test(dizGal) && /^<section class="blk(?: alt)? blk-band"/.test(dizCta) && /<div class="container"><div class="band">/.test(dizCta) && !/band-dark/.test(dizCta), `${dizGal.slice(0, 200)} | ${dizCta.slice(0, 200)}`);
  const css = rt(path.join(TPL, 'html', 'site', 'site.css'));
  check('site.css: карточка .blk-band .band.band-dark - темный фон, отступы, скругление; вложенные полосы гасятся; на телефоне меньше отступы', /\.blk-band \.band\.band-dark \{[^}]*background: var\(--dark\)[^}]*padding: 88px 56px[^}]*border-radius/.test(css) && /\.blk-band > \.container > \.band \.band[^{]*\{[^}]*background: transparent/.test(css) && /@media \(max-width: 899px\) \{[\s\S]*?\.blk-band \.band\.band-dark \{ padding: 48px 20px; \}/.test(css) && !/\.blk-band\s*\{[^}]*background/.test(css));
  const ch = run(dir, ['scripts/check-html.mjs']);
  check('правки приемки: check-html pass (внешние ссылки канала и карты - из данных)', ch.code === 0, ch.out.slice(-400));
  if (NM) {
    const js = run(dir, ['scripts/check-site-js.mjs']);
    check('правки приемки: check-site-js pass', js.code === 0 && !/SKIP/.test(js.stdout), js.out.slice(0, 400));
  }
  // нет адреса - секции карты нет, модуль map выключен
  const na = mkProject('accept-fixes-noaddr', path.join(EX, 'fixture-services'));
  const kb2 = rj(path.join(na, 'work', 'pages', 'kontakty', 'brief.json')); kb2.blocks = kb2.blocks.filter(x => x.pattern !== 'map'); wj(path.join(na, 'work', 'pages', 'kontakty', 'brief.json'), kb2);
  const ff = path.join(na, 'work', 'facts.json'); const fj = rj(ff); fj.company.address = ''; wj(ff, fj);
  const bn = run(na, ['scripts/build-html.mjs']);
  const hn = bn.code === 0 ? rt(path.join(na, 'work', 'output', 'prototype.html')) : '';
  check('контакты без адреса компании: секции карты нет, модуль map выключен', bn.code === 0 && !/data-module="map"/.test(hn) && rj(path.join(na, 'work', 'output', 'prototype.modules.json')).map.on === false, bn.out.slice(0, 300));
  // Р6: новый формат CTA (у фикстуры есть action и secondary_action) - путь по подписи выключен: вторая кнопка без
  // secondary_action идет по правилу C10, даже если в подписи имя канала или маршрут
  const nf = mkProject('accept-fixes-newformat', path.join(EX, 'fixture-services'));
  const nhf = path.join(nf, 'work', 'pages', 'home', 'brief.json');
  const nhb = rj(nhf); nhb.cta = { main: 'Рассчитать стоимость ремонта', short: 'Рассчитать', secondary: 'Написать в Telegram' }; wj(nhf, nhb);
  const bnf = run(nf, ['scripts/build-html.mjs']);
  const hnf = bnf.code === 0 ? rt(path.join(nf, 'work', 'output', 'prototype.html')) : '';
  const heroNf = sectionOf(pageOf(hnf, '/'), 'B01-hero');
  const csNf = bnf.code === 0 ? rj(path.join(nf, 'work', 'output', 'prototype.modules.json')).cta_secondary : {};
  check('Р6: новый формат CTA - «Написать в Telegram» без secondary_action не угадывается по подписи (правило C10), legacy_cta false', bnf.code === 0 && /<a class="btn secondary" data-act="scroll" data-target="form" href="#" role="button">Написать в Telegram<\/a>/.test(heroNf) && !/t\.me[^"]*" target="_blank" rel="noopener">Написать в Telegram/.test(heroNf) && csNf.legacy_cta === false && csNf.by_text.channel === 0 && !/старый формат CTA/.test(csNf.why), `${heroNf.slice(-400)} ${JSON.stringify(csNf)}`);
}

// ================================================================ 8e. аудит 28.09 (пакет P5): меню больших карт, каталог
// K6/K7, чипы, доступность, таблицы, якоря лендинга, реестр проекта K8, согласие, cta-final, отчет check-site-js
const navOf = h => (h.match(/<nav class="nav"[\s\S]*?<\/nav>/) || [''])[0];
const mnavOf = h => (h.match(/<div class="mnav" id="mnav"[\s\S]*?<div class="mnav-contacts">/) || [''])[0];
const navLinks = h => [...navOf(h).matchAll(/<(?:a|button)\b[^>]*\bclass="nav-link"[^>]*>([^<]*)/g)].map(m => m[1]);
function mkMenu(name, pages, extra = {}) {
  const dir = mkProject(name);
  const cfg = rj(path.join(dir, 'config', 'project.json')); cfg.slug = name; cfg.company = 'Тест'; cfg.niche.business_type = extra.btype || 'services'; if (extra.site) cfg.site = extra.site; wj(path.join(dir, 'config', 'project.json'), cfg);
  wj(path.join(dir, 'work', 'sitemap.json'), { pages: pages.map(p => ({ parent: '', level: 0, status: 'planned', ...p })) });
  wj(path.join(dir, 'work', 'facts.json'), { facts: [], company: { brand: 'Тест', status: 'missing' } });
  const b = run(dir, ['scripts/build-html.mjs']);
  const html = b.code === 0 ? rt(path.join(dir, 'work', 'output', 'prototype.html')) : '';
  const ch = run(dir, ['scripts/check-html.mjs']);
  const rep = fs.existsSync(path.join(dir, 'work', 'audit', 'html-check.json')) ? rj(path.join(dir, 'work', 'audit', 'html-check.json')) : { findings: [] };
  return { dir, b, html, ch, rep };
}
{
  // п.21: главная по адресу /ru - не родитель страниц первого уровня (раньше меню было пустым)
  const ru = mkMenu('menu-ru', [
    { slug: 'home', url: '/ru', type: 'home', subject: 'Главная' },
    { slug: 'uslugi', url: '/ru/uslugi', type: 'hub', subject: 'Услуги', parent: '/ru', level: 1 },
    { slug: 'uslugi-a', url: '/ru/uslugi/a', type: 'service', subject: 'Услуга А', parent: '/ru/uslugi', level: 2 },
    { slug: 'kontakty', url: '/ru/kontakty', type: 'info_contacts', subject: 'Контакты', parent: '/ru', level: 1 },
  ]);
  check('меню (п.21): главная /ru не родитель - пункты первого уровня в меню, ребенок в панели', ru.b.code === 0 && navLinks(ru.html).includes('Услуги') && navLinks(ru.html).includes('Контакты') && /href="#\/ru\/uslugi\/a"/.test(navOf(ru.html)) && !ru.rep.findings.some(f => f.rule === 'html.menu'), `${ru.b.out.slice(0, 200)} ${navLinks(ru.html).join('|')}`);
  // мелочь: плоская карта - хаб «Услуги» и услуги в корне дают один пункт «Услуги» (группа вливается в хаб)
  const flat = [{ slug: 'home', url: '/', type: 'home', subject: 'Главная' }, { slug: 'uslugi', url: '/uslugi', type: 'hub', subject: 'Все услуги компании', nav_label: 'Услуги' }];
  for (let i = 1; i <= 8; i++) flat.push({ slug: `s${i}`, url: `/s${i}`, type: 'service', subject: `Услуга ${i}`, nav_label: `Услуга ${i}` });
  flat.push({ slug: 'about', url: '/about', type: 'info_about', subject: 'О компании', nav_label: 'О компании' }, { slug: 'kontakty', url: '/kontakty', type: 'info_contacts', subject: 'Контакты', nav_label: 'Контакты' });
  const fl = mkMenu('menu-flat', flat);
  const flLinks = navLinks(fl.html);
  check('меню (плоская карта): один пункт «Услуги» - услуги в его панели, контакты отдельным пунктом', fl.b.code === 0 && flLinks.filter(l => l === 'Услуги').length === 1 && count(navOf(fl.html), /href="#\/s\d"/g) === 8 && flLinks.includes('Контакты') && (mnavOf(fl.html).match(/>Услуги</g) || []).length === 1 && !fl.rep.findings.some(f => f.rule === 'html.menu'), flLinks.join(' | '));
  // то же с корневой категорией «Каталог» (не хаб, с детьми) и категориями в корне - один пункт «Каталог»
  const flatC = [{ slug: 'home', url: '/', type: 'home', subject: 'Главная' }, { slug: 'production', url: '/production', type: 'category', subject: 'Каталог / Продукция' }, { slug: 'production-a', url: '/production/a', type: 'category', subject: 'Раздел А', parent: '/production', level: 1 }];
  for (let i = 1; i <= 7; i++) flatC.push({ slug: `k${i}`, url: `/k${i}`, type: 'category', subject: `Категория ${i}` });
  flatC.push({ slug: 'kontakty', url: '/kontakty', type: 'info_contacts', subject: 'Контакты' });
  const fc = mkMenu('menu-flat-cat', flatC, { btype: 'catalog' });
  check('меню (плоская карта): корневая категория «Каталог» и категории в корне - один пункт «Каталог»', fc.b.code === 0 && navLinks(fc.html).filter(l => l === 'Каталог').length === 1 && count(navOf(fc.html), /href="#\/k\d"/g) === 7 && /href="#\/production\/a"/.test(navOf(fc.html)) && !fc.rep.findings.some(f => f.rule === 'html.menu'), navLinks(fc.html).join(' | '));
  const partsM = await import(new URL('../../skills/site-tekst/kit/scripts/site-parts.mjs', import.meta.url).href);
  check('подпись меню: обрезка до 24 знаков без висящего знака в конце («заказ -»)', partsM.navLabel({ subject: 'Индивидуальный заказ - фотофоны на праздник' }) === 'Индивидуальный заказ' && partsM.navLabel({ subject: 'Сепарационное => оборудование высокого давления' }) === 'Сепарационное', partsM.navLabel({ subject: 'Индивидуальный заказ - фотофоны на праздник' }));
  // п.21: внуки и глубже - в панели (колонка на ребенка) и в мобильном меню с отступом; 24+ ссылок - больше колонок без промо
  const deep = [{ slug: 'home', url: '/', type: 'home', subject: 'Главная' }, { slug: 'katalog', url: '/katalog', type: 'hub', subject: 'Каталог', nav_label: 'Каталог' }];
  for (let i = 1; i <= 6; i++) {
    deep.push({ slug: `c${i}`, url: `/katalog/c${i}`, type: 'category', subject: `Раздел ${i}`, parent: '/katalog', level: 1 });
    for (let j = 1; j <= 4; j++) deep.push({ slug: `c${i}-${j}`, url: `/katalog/c${i}/${j}`, type: 'category', subject: `Подраздел ${i}.${j}`, parent: `/katalog/c${i}`, level: 2 });
  }
  deep.push({ slug: 'kontakty', url: '/kontakty', type: 'info_contacts', subject: 'Контакты' });
  const dp = mkMenu('menu-deep', deep);
  const katMega = (navOf(dp.html).match(/<div class="mega" role="region" aria-label="Каталог">[\s\S]*?<\/div><\/div><\/div>/) || [''])[0];
  check('меню (п.21): внуки - в панели хаба (колонка на ребенка, с отступом) и в мобильном меню', dp.b.code === 0 && count(katMega, /class="mlist-h" href="#\/katalog\/c\d"/g) === 6 && count(katMega, /<li><a href="#\/katalog\/c\d\/\d"/g) === 24 && count(mnavOf(dp.html), /class="mrow d2" href="#\/katalog\/c\d\/\d"/g) === 24 && !dp.rep.findings.some(f => f.rule === 'html.menu'), katMega.slice(0, 300));
  check('меню (п.21): от 24 ссылок в панели - больше колонок (mcols wide), колонки промо нет', /class="mcols wide"/.test(katMega) && !/class="mpromo"/.test(katMega));
  const css = rt(path.join(TPL, 'html', 'site', 'site.css'));
  const shell = rt(path.join(TPL, 'html', 'site', 'shell.html'));
  check('меню (п.21): панель прокручивается внутри шапки (overflow-y auto), высоту по факту ставит оболочка', /\.mega \{ max-height: calc\(100vh - 120px\); overflow-y: auto; overscroll-behavior: contain; \}/.test(css) && /\.mcols\.wide \{ grid-template-columns: repeat\(auto-fill, minmax\(200px, 1fr\)\); \}/.test(css) && /function fitMega\(n\)/.test(shell) && /m\.style\.maxHeight = h \+ 'px'/.test(shell));
  // check-html html.menu: страница, до которой нельзя дойти по меню (config.site.nav без нее) - major со списком
  const cut = mkMenu('menu-cut', [
    { slug: 'home', url: '/', type: 'home', subject: 'Главная' },
    { slug: 'uslugi', url: '/uslugi', type: 'hub', subject: 'Услуги' },
    { slug: 'kontakty', url: '/kontakty', type: 'info_contacts', subject: 'Контакты' },
    { slug: 'poisk', url: '/poisk', type: 'info_other', subject: 'Поиск', ui_role: 'search' },
    { slug: 'lk', url: '/lk', type: 'info_other', subject: 'Кабинет', ui_role: 'account' },
    { slug: 'lk-orders', url: '/lk/orders', type: 'info_other', subject: 'Заказы', parent: '/lk', level: 1 },
  ], { site: { nav: ['uslugi'] } });
  const mf = cut.rep.findings.filter(f => f.rule === 'html.menu');
  check('check-html (п.21): рабочая страница без пункта меню - major html.menu со списком (ui_role и их дети не требуются)', cut.b.code === 0 && cut.ch.code === 1 && mf.length === 2 && mf.every(f => f.severity === 'major' && /kontakty/.test(f.quote) && !/poisk|home|lk/.test(f.quote)), JSON.stringify(mf));
  const land = mkProject('menu-landing-check', path.join(EX, 'fixture-landing'));
  run(land, ['scripts/build-html.mjs']); run(land, ['scripts/check-html.mjs']);
  check('check-html (п.21): у лендинга проверки меню нет', !rj(path.join(land, 'work', 'audit', 'html-check.json')).findings.some(f => f.rule === 'html.menu'));
}
{
  // K6: явное field: "price" у фильтра цены с другим именем; значения и диапазон по карточкам страницы (хаб)
  const sp = mkProject('shop-k6', path.join(EX, 'fixture-shop'));
  const csf = path.join(sp, 'work', 'catalog', 'catalog-spec.json');
  const cs = rj(csf); const pf = cs.filters.find(f => f.name === 'Цена'); pf.name = 'Стоимость'; wj(csf, cs);
  // п.19: чип без фильтра каталога (подпись писателя, которой нет ни в значениях, ни в именах, ни в labels)
  const lbf = path.join(sp, 'work', 'pages', 'katalog-stoly', 'blocks', 'B03-listing.json');
  const lb = rj(lbf); lb.elements.find(e => e.kind === 'filters').items.push('Гарибальди', 'Порода: дуб, бук, венге', 'Порода: дуб, бук'); wj(lbf, lb);
  // доделка №19: подпись с двоеточием в labels фильтра живая, только если все ее значения есть у фильтра
  const mf = cs.filters.find(f => f.name === 'Материал'); mf.labels = [...(mf.labels || []), 'Порода: дуб, бук, венге', 'Порода: дуб, бук']; wj(csf, cs);
  // повторная проверка №19: чип по диапазону и переключателю с двоеточием (по имени), значение в другом регистре,
  // союз и точка в конце, перечень без двоеточия в labels (все значения есть - живой, нет одного - надпись)
  const LIVE2 = ['Стоимость: от и до', 'В наличии: да', 'дуб', 'Порода: дуб и бук.', 'Бук, Сосна'];
  { const lb2 = rj(lbf); lb2.elements.find(e => e.kind === 'filters').items.push(...LIVE2, 'Бук, Сосна, Венге'); wj(lbf, lb2); }
  mf.labels.push('Порода: дуб и бук.', 'Бук, Сосна', 'Бук, Сосна, Венге'); wj(csf, cs);
  // вторая повторная проверка №19: подписи labels на столах - синоним через запятую, признак и значения без двоеточия,
  // косая черта; значение другой ветки (values_by_category стульев) в labels - надпись, значение своей ветки - кнопка
  const LIVE3 = ['Материал, отделка', 'Материал дуб и бук', 'Дуб/Сосна'];
  const DEAD3 = ['Дуб/Венге', 'Барный'];
  { const lb3 = rj(lbf); lb3.elements.find(e => e.kind === 'filters').items.push(...LIVE3, ...DEAD3, 'Обеденный'); wj(lbf, lb3); }
  mf.labels.push(...LIVE3, 'Дуб/Венге');
  { const nf = cs.filters.find(f => f.name === 'Назначение'); nf.labels = ['Барный']; nf.values_by_category['katalog-stulya'] = ['Барный']; wj(csf, cs); }
  const b = run(sp, ['scripts/build-html.mjs']);
  const html = b.code === 0 ? rt(path.join(sp, 'work', 'output', 'prototype.html')) : '';
  check('K6: фильтр цены по field: "price" при имени не как у поля карточки - ползунок по ценам карточек хаба', /data-group="Стоимость" data-type="range" data-field="price" data-min="7900" data-max="24500"/.test(pageOf(html, '/katalog')), b.out.slice(0, 300));
  check('п.19: чип без фильтра - надпись (span), не кнопка', /<span class="qchip">Гарибальди<\/span>/.test(pageOf(html, '/katalog/stoly')));
  check('п.19 (доделка): подпись «Признак: значения» в labels - живая только при всех значениях фильтра', /<span class="qchip">Порода: дуб, бук, венге<\/span>/.test(pageOf(html, '/katalog/stoly')) && /data-act="qchip" data-group="Материал"[^>]*>Порода: дуб, бук</.test(pageOf(html, '/katalog/stoly')), (pageOf(html, '/katalog/stoly').match(/<div class="quick"[\s\S]*?<\/div>/) || [''])[0]);
  {
    const st = T(pageOf(html, '/katalog/stoly'));
    const quickSt = (st.match(/<div class="quick"[\s\S]*?<\/div>/) || [''])[0];
    check('повторная проверка №19: «Стоимость: от и до» (диапазон) и «В наличии: да» (переключатель) - кнопки по имени фильтра, «дуб» - значение «Дуб», союз и точка, перечень в labels со всеми значениями - кнопки',
      /data-act="qchip" data-group="Стоимость"[^>]*>Стоимость: от и до</.test(st) && /data-act="qchip" data-group="В наличии"[^>]*>В наличии: да</.test(st) && /data-act="qchip" data-value="Дуб"[^>]*>дуб</.test(st) && /data-act="qchip" data-group="Материал"[^>]*>Порода: дуб и бук\.</.test(st) && /data-act="qchip" data-group="Материал"[^>]*>Бук, Сосна</.test(st), quickSt);
    check('повторная проверка №19: перечень без двоеточия в labels со значением не из фильтра - надпись (span)', /<span class="qchip">Бук, Сосна, Венге<\/span>/.test(st), quickSt);
    check('вторая проверка №19: синоним через запятую, признак и значения без двоеточия, косая черта - кнопки группы «Материал», значение своей ветки - кнопка-значение; значение другой ветки и чужое через косую черту - надписи',
      LIVE3.every(x => st.includes(`data-group="Материал" aria-pressed="false">${x}</button>`)) && /data-act="qchip" data-value="Обеденный"[^>]*>Обеденный</.test(st) && DEAD3.every(x => st.includes(`<span class="qchip">${x}</span>`)), quickSt);
    // неживой чип внешне не кнопка: у span.qchip нет рамки, фона и скругления кнопки; у живого (button.qchip) - есть
    const css = rt(path.join(TPL, 'html', 'site', 'site.css')).replace(/\/\*[\s\S]*?\*\//g, '');
    const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m => ({ sel: m[1].trim(), body: m[2] })).filter(r => /qchip/.test(r.sel));
    // правила, которые доходят до span.qchip: селектор с .qchip, кроме button.qchip и .qchip.on (у span нет класса on)
    const btnLook = /\bborder|\bbackground/;
    const forSpan = rules.filter(r => r.sel.split(',').map(x => x.trim()).some(s => /\.qchip\b/.test(s) && !/^button\.qchip/.test(s) && !/\.qchip\.on/.test(s)));
    const btn = rules.find(r => r.sel === 'button.qchip');
    check('повторная проверка №19: неживой чип (span.qchip) - подпись без рамки и фона кнопки, живой (button.qchip) - кнопка с рамкой и скруглением',
      rules.some(r => r.sel === 'span.qchip') && forSpan.every(r => !btnLook.test(r.body)) && !!btn && /border: 1px solid/.test(btn.body) && /border-radius: 999px/.test(btn.body), JSON.stringify(forSpan));
  }
  const ch = run(sp, ['scripts/check-html.mjs']);
  const rep = rj(path.join(sp, 'work', 'audit', 'html-check.json'));
  const cd = rep.findings.filter(f => f.rule === 'html.chip-dead');
  check('check-html (п.19): неживые чипы - minor html.chip-dead со списком по странице, без blocker', ch.code === 1 && cd.length === 1 && cd[0].severity === 'minor' && cd[0].page === 'katalog-stoly' && /Гарибальди/.test(cd[0].quote) && /венге/.test(cd[0].quote) && !/Порода: дуб, бук(?!,)/.test(cd[0].quote), JSON.stringify(rep.findings));
  {
    const deadList = cd.length ? T(cd[0].quote).split(' | ') : [];
    check('повторная проверка №19: в html.chip-dead - перечень без двоеточия с чужим значением, живых чипов (диапазон, переключатель, регистр, союз, перечень) нет',
      deadList.includes('Бук, Сосна, Венге') && !LIVE2.some(x => deadList.includes(x)), JSON.stringify(deadList));
    check('вторая проверка №19: в html.chip-dead - значение другой ветки и чужое через косую черту, живых подписей (синоним, признак и значения, косая черта) нет',
      DEAD3.every(x => deadList.includes(x)) && !LIVE3.some(x => deadList.includes(x)) && !deadList.includes('Обеденный'), JSON.stringify(deadList));
  }
  {
    // интеграция (рецензия P5): вывод check-html - сначала major, потом minor (общий html.menu не теряется за чипами страниц)
    const cfgF = path.join(sp, 'config', 'project.json');
    const cfg0 = fs.readFileSync(cfgF, 'utf8');
    const cfgD = JSON.parse(cfg0); cfgD.site = { ...(cfgD.site || {}), nav: ['katalog'] }; wj(cfgF, cfgD);
    run(sp, ['scripts/build-html.mjs']);
    const chs = run(sp, ['scripts/check-html.mjs']);
    const lines = chs.stdout.split('\n').filter(l => /^ - \[/.test(l));
    const firstMinor = lines.findIndex(l => l.startsWith(' - [minor]')), lastMajor = lines.map(l => l.startsWith(' - [major]')).lastIndexOf(true);
    check('check-html: в выводе major раньше minor (html.menu не теряется за чипами страниц)', lastMajor >= 0 && firstMinor > lastMajor && lines.some(l => /html\.menu/.test(l)) && lines.some(l => /html\.chip-dead/.test(l)), chs.stdout.slice(0, 600));
    fs.writeFileSync(cfgF, cfg0);
  }
  // K6: categories с несуществующим slug - предупреждение сборщика
  const cs2 = rj(csf); cs2.filters.find(f => f.name === 'Высота сиденья').categories = ['katalog-stulya', 'katalog-divany']; wj(csf, cs2);
  const b2 = run(sp, ['scripts/build-html.mjs']);
  check('K6: categories со slug не из карты - предупреждение сборщика', b2.code === 0 && /фильтр «Высота сиденья» - в categories нет таких страниц карты: katalog-divany/.test(b2.stderr), b2.out.slice(0, 300));
  // K7: без card_cta кнопка карточки не берет главный CTA страницы с action anchor:/page: - CTA товара, иначе
  // вторая кнопка страницы или CTA главной без перехода
  const k7 = mkProject('shop-k7', path.join(EX, 'fixture-shop'));
  const k7s = path.join(k7, 'work', 'catalog', 'catalog-spec.json');
  const s7 = rj(k7s); delete s7.card_cta; wj(k7s, s7);
  run(k7, ['scripts/build-html.mjs']);
  const h7 = rt(path.join(k7, 'work', 'output', 'prototype.html'));
  check('K7: без card_cta кнопка карточки - CTA товара «Узнать цену», не «Выбрать модель» с переходом к выдаче', /class="btn btn-sm" data-act="lead" data-title="Узнать цену"/.test(pageOf(h7, '/katalog/stulya')) && !/class="btn btn-sm"[^>]*data-title="Выбрать/.test(h7));
  const k7st = path.join(k7, 'work', 'strategy.json');
  const st7 = rj(k7st); delete st7.global.cta_by_type.product; wj(k7st, st7);
  const k7p = path.join(k7, 'work', 'pages', 'katalog-slug', 'brief.json'); const bp7 = rj(k7p); bp7.cta = { main: 'Смотреть похожие', action: 'page:katalog' }; wj(k7p, bp7);
  run(k7, ['scripts/build-html.mjs']);
  const h7b = rt(path.join(k7, 'work', 'output', 'prototype.html'));
  check('K7: без card_cta и CTA товара - вторая кнопка категории (заявка), на хабе - CTA главной без перехода', /class="btn btn-sm" data-act="lead" data-title="Оставить заявку"/.test(pageOf(h7b, '/katalog/stulya')) && /class="btn btn-sm" data-act="lead" data-title="Подобрать мебель"/.test(pageOf(h7b, '/katalog')) && !/class="btn btn-sm"[^>]*data-title="(Выбрать|Смотреть)/.test(h7b));
  // секция каталога, вставленная сборщиком (в брифе нет блока листинга): action anchor:listing разрешается
  const k7c = mkProject('shop-k7-inserted', path.join(EX, 'fixture-shop'));
  const bf = path.join(k7c, 'work', 'pages', 'katalog-stoly', 'brief.json');
  const bs = rj(bf); bs.blocks = bs.blocks.filter(x => x.pattern !== 'listing'); wj(bf, bs);
  const bi = run(k7c, ['scripts/build-html.mjs']);
  const hi = bi.code === 0 ? rt(path.join(k7c, 'work', 'output', 'prototype.html')) : '';
  check('K7: секция каталога сборщика без блока листинга в брифе - anchor:listing разрешается, без предупреждения', bi.code === 0 && /data-act="scroll" data-target="listing"[^>]*>Выбрать модель/.test(pageOf(hi, '/katalog/stoly')) && /data-anchor="listing"/.test(pageOf(hi, '/katalog/stoly')) && !/katalog-stoly: действие кнопки «anchor:listing» не разрешилось/.test(bi.stderr), bi.out.slice(0, 300));
}
{
  // доступность: кнопки-ссылки без href получают href="#" role="button"; Enter в поле формы отправляет форму
  const noHref = h => [...markupOf(h).matchAll(/<a\b(?![^>]*\bhref=")[^>]*\bdata-act="[^"]*"[^>]*>/g)].map(m => m[0].slice(0, 120));
  const htmls = { services: rt(path.join(tmpRoot, 'services', 'work', 'output', 'prototype.html')), landing: rt(path.join(tmpRoot, 'landing', 'work', 'output', 'prototype.html')), shop: rt(path.join(tmpRoot, 'shop', 'work', 'output', 'prototype.html')) };
  for (const [k, h] of Object.entries(htmls)) check(`доступность: ${k} - нет <a data-act> без href (фокус с клавиатуры)`, !noHref(h).length && /<a class="btn[^"]*"[^>]*href="#" role="button"/.test(h), noHref(h).slice(0, 3).join(' | '));
  const shell = rt(path.join(TPL, 'html', 'site', 'shell.html'));
  check('доступность: нижняя панель - href="#" role="button", если у CTA страницы нет адреса', /if \(!at\.href\) \{ mbarBtn\.setAttribute\('href', '#'\); mbarBtn\.setAttribute\('role', 'button'\); \}/.test(shell));
  if (NM) {
    const { JSDOM, VirtualConsole } = createRequire(import.meta.url)('jsdom');
    const dom = new JSDOM(htmls.services, { url: 'http://localhost/prototype.html', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: new VirtualConsole(), beforeParse(w) { w.matchMedia = () => ({ matches: true, addEventListener() {}, addListener() {} }); w.scrollTo = () => {}; } });
    const W = dom.window;
    W.__PROTO.open('#/');
    const form = W.__PROTO.current().querySelector('[data-block-id="B07-form"]');
    const inputs = [...form.querySelectorAll('input, textarea')].filter(i => !['file', 'checkbox', 'radio'].includes(i.type));
    const tel = form.querySelector('input[type="tel"]');
    tel.dispatchEvent(new W.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    const errShown = form.querySelectorAll('.field.err').length > 0;
    inputs.forEach(i => { i.value = i.type === 'email' ? 'a@b.ru' : '1234567'; });
    tel.dispatchEvent(new W.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    const toast = W.document.getElementById('toast');
    check('доступность (jsdom): Enter в поле формы - отправка как кнопкой (пустые поля - ошибка, заполненные - тост)', !!tel && errShown && toast.classList.contains('on') && /не отправляется/.test(toast.textContent) && inputs.every(i => !i.value));
    const sb = W.document.querySelector('.search input');
    check('доступность (jsdom): поле поиска шапки Enter не перехватывает (своя форма)', !sb || !!sb.closest('form'));
    W.close();
  }
  const bad = mkProject('a11y-bad', path.join(EX, 'fixture-services'));
  run(bad, ['scripts/build-html.mjs']);
  const of = path.join(bad, 'work', 'output', 'prototype.html');
  fs.writeFileSync(of, rt(of).replace('<main id="app">', '<main id="app"><a class="btn" data-act="lead">Без фокуса</a>'));
  run(bad, ['scripts/check-html.mjs']);
  const ra = rj(path.join(bad, 'work', 'audit', 'html-check.json')).findings.filter(f => f.rule === 'html.a11y-focus');
  check('check-html: <a data-act> без href - major html.a11y-focus', ra.length === 1 && ra[0].severity === 'major' && /Без фокуса/.test(ra[0].quote), JSON.stringify(ra));
}
{
  // таблицы: подряд идущие строки - одна таблица с колонками по наибольшему числу ячеек, на телефоне прокрутка целиком
  const tb = mkProject('tables', path.join(EX, 'fixture-services'));
  const pf = path.join(tb, 'work', 'pages', 'uslugi-remont-kvartir', 'blocks', 'B03-price.json');
  const pj = rj(pf); pj.elements.filter(e => e.kind === 'table_row').forEach((e, i) => e.items.push(i ? 'стандартно' : 'условие')); wj(pf, pj);
  const b = run(tb, ['scripts/build-html.mjs']);
  const html = b.code === 0 ? rt(path.join(tb, 'work', 'output', 'prototype.html')) : '';
  const sec = sectionOf(pageOf(html, '/uslugi/remont-kvartir'), 'B03-price');
  check('таблицы: строки блока - одна таблица .tbl с --cols по наибольшему числу ячеек (3), обе строки внутри', /<div class="tbl tbl-wide" style="--cols:3"><div class="row"/.test(sec) && count((sec.match(/<div class="tbl[\s\S]*?<\/div><\/div>/) || [''])[0], /<div class="row"/g) === 2, sec.slice(0, 500));
  const ch = run(tb, ['scripts/check-html.mjs']);
  check('таблицы: check-html pass (текст дословно, стиль --cols без цвета)', ch.code === 0, ch.out.slice(0, 300));
  const svcSec = sectionOf(pageOf(rt(path.join(tmpRoot, 'services', 'work', 'output', 'prototype.html')), '/uslugi/remont-kvartir'), 'B03-price');
  check('таблицы: две колонки - таблица без прокрутки (tbl без tbl-wide)', /<div class="tbl" style="--cols:2">/.test(svcSec));
  {
    // интеграция (рецензия P5): пустые слоты раскладки table_row не оборачиваются (обертка давала лишний отступ gap)
    const rb = await import(new URL('../../skills/site-tekst/kit/scripts/render-blocks.mjs', import.meta.url).href);
    const empty = '<div class="stack"><h2>X</h2><div class="row" data-slot="table_row"></div><div class="row" data-slot="table_row"></div></div>';
    const full = '<div class="row" data-slot="table_row"><span>a</span><span>b</span></div>';
    check('таблицы: серия пустых слотов table_row - без обертки .tbl, с содержимым - в обертке', rb.wrapTables(empty) === empty && /^<div class="tbl" style="--cols:2">/.test(rb.wrapTables(full)), rb.wrapTables(empty));
  }
  const css = rt(path.join(TPL, 'html', 'site', 'site.css'));
  check('site.css: .tbl > .row - колонки по --cols; на телефоне tbl-wide прокручивается целиком', /\.tbl > \.row \{ grid-template-columns: repeat\(var\(--cols, 2\), minmax\(0, 1fr\)\); \}/.test(css) && /@media \(max-width: 520px\) \{[\s\S]*?\.tbl-wide \{ overflow-x: auto;[\s\S]*?\.tbl-wide > \.row \{ min-width: calc\(var\(--cols\) \* 110px\); \}/.test(css));
}
{
  // лендинг без config.site.nav: якоря из написанных блоков главной (не больше 6, форма последней)
  const la = mkProject('landing-auto', path.join(EX, 'fixture-landing'));
  const cf = path.join(la, 'config', 'project.json'); const cfg = rj(cf); delete cfg.site; wj(cf, cfg);
  const b = run(la, ['scripts/build-html.mjs']);
  const html = b.code === 0 ? rt(path.join(la, 'work', 'output', 'prototype.html')) : '';
  const nav = navOf(html);
  const anchors = [...nav.matchAll(/data-act="scroll" data-target="([^"]+)">([^<]*)</g)].map(m => ({ t: m[1], l: m[2] }));
  const brief = rj(path.join(la, 'work', 'pages', 'home', 'brief.json'));
  const nonHero = brief.blocks.filter(x => x.role !== 'hero').map(x => x.type);
  const mods = b.code === 0 ? rj(path.join(la, 'work', 'output', 'prototype.modules.json')) : {};
  check('лендинг без site.nav: якоря из блоков главной (кроме первого экрана), форма последней, подписи до 24 знаков', b.code === 0 && anchors.length === nonHero.length && anchors.length <= 6 && anchors[anchors.length - 1].t === 'form' && anchors.every(a => a.l.length > 0 && a.l.length <= 24) && anchors.every(a => nonHero.includes(a.t)), JSON.stringify(anchors));
  check('лендинг без site.nav: modules - anchors из блоков главной (source work/pages/*/blocks)', mods.anchors && mods.anchors.on && /из написанных блоков главной/.test(mods.anchors.why) && mods.anchors.source === 'work/pages/*/blocks', JSON.stringify(mods.anchors));
  const ch = run(la, ['scripts/check-html.mjs']);
  check('лендинг без site.nav: check-html pass (якоря ведут к блокам страницы)', ch.code === 0, ch.out.slice(0, 300));
}
{
  // K8: живые блоки проекта - html/site/registry.json и html/site/behaviors/ (туда их кладет place из overrides задачи)
  const pr = mkProject('project-registry', path.join(EX, 'fixture-services'));
  const sd = path.join(pr, 'html', 'site');
  fs.mkdirSync(path.join(sd, 'behaviors'), { recursive: true });
  wj(path.join(sd, 'registry.json'), { 'Калькулятор': { behavior: 'calc' }, 'type:faq': 'nosuch' });
  fs.writeFileSync(path.join(sd, 'behaviors', 'calc.js'), "function (root, S) { root.setAttribute('data-live', '1'); return { show: function () { root.setAttribute('data-shown', '1'); } }; }\n");
  fs.writeFileSync(path.join(sd, 'behaviors', 'calc.css'), '.calc-live { outline: 1px solid #000; }\n');
  fs.writeFileSync(path.join(sd, 'behaviors', 'broken.js'), 'function (root, S) { return {\n');
  const b = run(pr, ['scripts/build-html.mjs']);
  const html = b.code === 0 ? rt(path.join(pr, 'work', 'output', 'prototype.html')) : '';
  const calcOpen = (html.match(/<section\b[^>]*data-block-id="B03-calc"[^>]*>/) || [''])[0];
  const faqOpen = (html.match(/<section\b[^>]*data-block-id="B06-faq"[^>]*>/) || [''])[0];
  const mods = b.code === 0 ? rj(path.join(pr, 'work', 'output', 'prototype.modules.json')) : {};
  check('K8: запись реестра проекта по custom_name (без учета регистра) включает поведение проекта блоку, код и стили в файле', b.code === 0 && /data-behavior="calc"/.test(calcOpen) && /"calc": function \(root, S\)/.test(html) && /\.calc-live \{ outline: 1px solid #000; \}/.test(html) && !/data-behavior="calc"/.test(faqOpen), `${b.out.slice(0, 300)} ${calcOpen}`);
  check('K8: ошибки реестра проекта - предупреждения сборщика, прочее работает', /behaviors\/broken\.js: не выражение function/.test(b.stderr) && /«type:faq» ведет к поведению «nosuch»/.test(b.stderr) && !/"broken":/.test(html), b.stderr.slice(0, 400));
  check('K8: prototype.modules.json - project_behaviors (записи и число секций)', mods.project_behaviors && mods.project_behaviors.on === true && /Калькулятор/.test(mods.project_behaviors.why) && /1$/.test(mods.project_behaviors.why), JSON.stringify(mods.project_behaviors));
  const ch = run(pr, ['scripts/check-html.mjs']);
  check('K8: check-html pass со стилями проекта (серые цвета)', ch.code === 0, ch.out.slice(0, 300));
  if (NM) {
    const { JSDOM, VirtualConsole } = createRequire(import.meta.url)('jsdom');
    const dom = new JSDOM(html, { url: 'http://localhost/prototype.html', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: new VirtualConsole(), beforeParse(w) { w.matchMedia = () => ({ matches: true, addEventListener() {}, addListener() {} }); w.scrollTo = () => {}; } });
    const sec = dom.window.document.querySelector('[data-block-id="B03-calc"]');
    check('K8 (jsdom): поведение проекта работает при показе маршрута', sec && sec.getAttribute('data-live') === '1' && sec.getAttribute('data-shown') === '1');
    dom.window.close();
  }
  const svcMods = rj(path.join(tmpRoot, 'services', 'work', 'output', 'prototype.modules.json'));
  check('K8: без реестра проекта - project_behaviors выключен, поведение kit', svcMods.project_behaviors && svcMods.project_behaviors.on === false);
}
{
  // согласие: под каждой формой сборщик ставит одну строку (писатель его не пишет - правило P3b)
  const html = rt(path.join(tmpRoot, 'services', 'work', 'output', 'prototype.html'));
  const secs = [...markupOf(html).matchAll(/<section\b[^>]*data-block-id="[^"]*"[^>]*>[\s\S]*?<\/section>/g)].map(m => m[0]).filter(s => /<label class="field/.test(s));
  const lead = (html.match(/<div class="modal" id="modal-lead"[\s\S]*?<\/div><\/div><\/div>/) || [''])[0];
  check('согласие: под каждой формой блока и в окне заявки - ровно одна строка сборщика', secs.length >= 2 && secs.every(s => count(s, /class="consent"/g) === 1) && count(lead, /class="consent"/g) === 1, secs.map(s => count(s, /class="consent"/g)).join(','));
}
{
  // cta-final: fixture-services держит старый id финального призыва «cta» (старые данные); сборщик id не ищет -
  // тот же итог и с «cta-final»
  const cf = mkProject('cta-final', path.join(EX, 'fixture-services'));
  for (const slug of ['uslugi', 'uslugi-dizajn-proekt', 'uslugi-remont-kvartir']) {
    const bf = path.join(cf, 'work', 'pages', slug, 'brief.json'); const b = rj(bf);
    for (const x of b.blocks) if (x.type === 'cta') x.type = 'cta-final';
    wj(bf, b);
    for (const f of fs.readdirSync(path.join(cf, 'work', 'pages', slug, 'blocks'))) { const p = path.join(cf, 'work', 'pages', slug, 'blocks', f); const j = rj(p); if (j.type === 'cta') { j.type = 'cta-final'; wj(p, j); } }
  }
  for (const f of ['hub.html', 'service.html']) { const p = path.join(cf, 'work', 'layouts', f); fs.writeFileSync(p, rt(p).replace('data-block="cta"', 'data-block="cta-final"')); }
  const b = run(cf, ['scripts/build-html.mjs']);
  const h2 = b.code === 0 ? rt(path.join(cf, 'work', 'output', 'prototype.html')) : '';
  const h1 = rt(path.join(tmpRoot, 'services', 'work', 'output', 'prototype.html'));
  const sec2 = (h, r) => count(pageOf(h, r), /class="btn secondary"/g);
  check('cta-final: сборка с id «cta-final» - тот же итог, что со старым «cta» (вторые кнопки, раскладки, якорь формы)', b.code === 0 && /страниц 6, блоков 23/.test(b.stdout) && !/без раскладки/.test(b.stdout) && ['/uslugi', '/uslugi/dizajn-proekt', '/uslugi/remont-kvartir'].every(r => sec2(h1, r) === sec2(h2, r)) && /data-anchor="cta-final"/.test(h2) && /data-target="cta-final"/.test(pageOf(h2, '/uslugi/remont-kvartir')), b.out.slice(0, 300));
  const ch = run(cf, ['scripts/check-html.mjs']);
  check('cta-final: check-html pass', ch.code === 0, ch.out.slice(0, 300));
}
if (NM) {
  // check-site-js: контрольные суммы проверенного файла в отчете; компонент каталога проверяется один раз на обход
  const js = run(path.join(tmpRoot, 'services'), ['scripts/check-site-js.mjs']);
  const rep = rj(path.join(tmpRoot, 'services', 'work', 'output', 'prototype.js-check.json'));
  const html = rt(path.join(tmpRoot, 'services', 'work', 'output', 'prototype.html'));
  const meta = (html.match(/<meta name="proto-data-sha" content="([^"]*)"/) || [])[1];
  check('check-site-js: в отчете proto_sha (meta проверенного файла), file_sha и checked_at', js.code === 0 && rep.proto_sha === meta && rep.file_sha === crypto.createHash('sha1').update(html).digest('hex').slice(0, 16) && !!rep.checked_at, JSON.stringify({ p: rep.proto_sha, meta, f: rep.file_sha }));
  const src = rt(path.join(TPL, 'scripts', 'check-site-js.mjs'));
  check('check-site-js: счетчик действий компонента каталога - общий на весь обход', /const seenCatalog = new Map\(\);/.test(src) && /el\.closest\(CATALOG\) \? seenCatalog : seen/.test(src));
}
{
  // serve.mjs: порт занят - код 2 и строка с подсказкой, без трассы исключения
  const dir = path.join(tmpRoot, 'services');
  const port = 5400 + Math.floor(Math.random() * 400);
  const busy = http.createServer(() => {}).listen(port);
  await new Promise(r => busy.once('listening', r));
  const r = await new Promise(resolve => {
    const p = spawn(process.execPath, ['scripts/serve.mjs', '--port', String(port)], { cwd: dir });
    let err = '';
    p.stderr.on('data', d => { err += d; });
    const t = setTimeout(() => { p.kill(); resolve({ code: 'timeout', err }); }, 10000);
    p.on('exit', code => { clearTimeout(t); resolve({ code, err }); });
  });
  busy.close();
  check('serve.mjs: порт занят - код 2 и подсказка --port', r.code === 2 && /порт \d+ занят/.test(r.err) && /--port/.test(r.err) && !/at Server|EADDRINUSE/.test(r.err), JSON.stringify(r));
}

// ================================================================ 9. serve.mjs: Cache-Control no-store
{
  const dir = path.join(tmpRoot, 'services');
  const port = 4800 + Math.floor(Math.random() * 500);
  const ch = spawn(process.execPath, ['scripts/serve.mjs', '--port', String(port)], { cwd: dir });
  const ok = await new Promise(resolve => {
    let tries = 0;
    const tryGet = () => {
      http.get(`http://localhost:${port}/prototype.html`, res => { res.resume(); resolve(res.statusCode === 200 && res.headers['cache-control'] === 'no-store'); }).on('error', () => { if (++tries > 40) resolve(false); else setTimeout(tryGet, 100); });
    };
    tryGet();
  });
  ch.kill();
  check('serve.mjs: prototype.html с заголовком Cache-Control: no-store', ok);
}

fs.rmSync(tmpRoot, { recursive: true, force: true });
for (const n of notes) console.log(`NOTE ${n}`);
for (const f of failures) console.log(f);
console.log(`cases-site: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
