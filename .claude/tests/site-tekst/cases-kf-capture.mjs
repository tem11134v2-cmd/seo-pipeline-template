// Тесты пакета B программы 05.10 (анализ КФ и КНДР в /site-tekst): снятие страниц и DOM-находки. Запуск:
//   node .claude/tests/site-tekst/cases-kf-capture.mjs      код выхода 0 - все прошли.
// Разделы:
//   1. kf-dom.mjs в jsdom на фикстурах: зоны (шапка, подвал, тело, закрепленные), детекторы (tel, mailto, мессенджеры,
//      соцсети, формы, поиск, корзина, крошки, карты, видео, чат-виджет, куки, реквизиты, юридические ссылки, цены,
//      Schema.org), ссылки по synonyms словаря, скрытое с пометкой, контур секций (outline: has, без скрытого), шапка по
//      классу; id детекторов есть в словаре;
//   2. словарь config/kf-elements.json: схема, около 120 элементов, 13 категорий, слоты с needs или needs_hint, ссылки с
//      page_match, невидимые - только Schema.org;
//   3. fetch-page.mjs --html-from: снимок browser/verbatim/cdp, страница проверки - след .cdp.html и прежний снимок не
//      заменен, статический больше - остается, плоская страница; prep-args --check-degraded принимает след CDP;
//   4. capture-pages.mjs без Chrome (SITE_TEKST_CHROME на несуществующий путь): код 0, chrome null, skipped no_chrome;
//      --resume не переснимает готовое; домен не из competitors.json - stale; own без site_url; неверные аргументы - код 2;
//      прототип без Chrome; tilePlan: кадры тела не выше 1600 px и не больше 8; findChrome, cleanOrphans;
//   5. живой снимок Chrome (если Chrome или Edge есть; иначе SKIP с причиной) на локальном http-сервере теста: кадры и
//      размеры JPEG, kf.json, внутренний скролл-контейнер, антибот, --html-from из render.html, --max-seconds 1 - partial,
//      код 0, --resume не переснимает, own, кадры прототипа;
//   6. стиль, UUID и ниша в новых файлах пакета (kit), промт классификатора (CDP раньше браузера агента, бюджет).
// Все во временных папках (os.tmpdir()), без внешней сети и данных клиентов; сервер - отдельный процесс на 127.0.0.1.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TPL = path.resolve(HERE, '..', '..', 'skills', 'site-tekst', 'kit');
const { validate } = await import(pathToFileURL(path.join(TPL, 'scripts', 'lib.mjs')).href);
const KD = await import(pathToFileURL(path.join(TPL, 'scripts', 'kf-dom.mjs')).href);
const CP = await import(pathToFileURL(path.join(TPL, 'scripts', 'capture-pages.mjs')).href);
const { loadDep, resolveDep } = await import(pathToFileURL(path.join(TPL, 'scripts', 'deps.mjs')).href);
// node_modules шаблона для скриптов копии kit во временной папке (deps.mjs: SITE_TEKST_NODE_MODULES)
const JSDOM_PATH = resolveDep('jsdom');
const NM = JSDOM_PATH ? JSDOM_PATH.slice(0, JSDOM_PATH.lastIndexOf('node_modules') + 'node_modules'.length) : '';

let pass = 0, fail = 0, skip = 0;
const failures = [], notes = [];
function check(name, ok, detail = '') {
  if (ok) pass++;
  else { fail++; failures.push(`FAIL ${name}${detail ? ': ' + String(detail).slice(0, 700) : ''}`); }
}
const skipped = (name, why) => { skip++; notes.push(`SKIP ${name}: ${why}`); };
const noBom = s => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s);
const rj = f => JSON.parse(noBom(fs.readFileSync(f, 'utf8')));
const wj = (f, o) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(o, null, 2) + '\n'); };
const wt = (f, s) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, s); };
const read = rel => noBom(fs.readFileSync(path.join(TPL, rel), 'utf8'));
const SCHEMAS = {};
const schemaErrors = (name, data) => validate(SCHEMAS[name] ??= rj(path.join(TPL, 'schemas', `${name}.schema.json`)), data);
function run(cwd, args, env = {}, timeout = 300000) {
  const r = spawnSync(process.execPath, args, { cwd, encoding: 'utf8', env: { ...process.env, ...env }, timeout });
  return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '', out: (r.stdout || '') + (r.stderr || '') };
}
const tag = (out, t) => { const m = String(out).match(new RegExp(`${t} (\\{[^\\n]*\\})`)); try { return m ? JSON.parse(m[1]) : null; } catch { return null; } };
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cases-kf-capture-'));
function mkProject(name) {
  const dir = path.join(tmpRoot, name);
  for (const d of ['scripts', 'schemas', 'config']) fs.cpSync(path.join(TPL, d), path.join(dir, d), { recursive: true });
  return dir;
}
const setCfg = (dir, patch) => { const f = path.join(dir, 'config', 'project.json'); wj(f, { ...rj(f), ...patch }); };
// размер JPEG по маркеру SOF
function jpegSize(file) {
  const b = fs.readFileSync(file);
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) { i++; continue; }
    const m = b[i + 1];
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
    const len = b.readUInt16BE(i + 2);
    if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  return null;
}
const long = n => Array.from({ length: n }, (_, i) => `<p>Абзац текста номер ${i} про услугу и работу компании, достаточно длинный для проверки.</p>`).join('');
const DICT = rj(path.join(TPL, 'config', 'kf-elements.json'));
const DICT_IDS = new Set(DICT.elements.map(e => e.id));
const HOME = `<!doctype html><html><head><title>Главная</title><meta name="description" content="Описание">
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Organization","name":"A"},{"@type":"BreadcrumbList"}]}</script>
<script src="https://code.jivo.ru/widget/abc"></script>
<style>.fx{position:fixed;right:10px;bottom:10px}.mob{display:none}.hid{display:none}</style></head><body>
<header><a class="logo" href="/"><img src="/logo.png" alt="logo"></a><nav><a href="/catalog">Каталог</a><a href="/about">О компании</a><a href="/dostavka">Доставка и оплата</a><a href="/kontakty">Контакты</a></nav>
<a href="tel:+74950000000">+7 495 000-00-00</a><a href="https://wa.me/79000000000">WhatsApp</a><button class="btn-callback">Заказать звонок</button>
<form role="search" action="/search"><input type="search" name="q"></form><a href="/cart">Корзина</a><div class="mob"><a href="tel:+78005550000">8 800</a></div></header>
<main><div class="breadcrumbs"><a href="/">Главная</a> / Услуги</div><h1>Заголовок страницы</h1><p>Работы от 1 500 ₽ за проект</p>${long(30)}
<h2>Как мы работаем</h2><ol><li>Заявка</li><li>Замер</li><li>Работа</li></ol>${long(30)}
<h2>Галерея работ</h2><img src="/a.jpg" width="300" height="200"><iframe src="https://www.youtube.com/embed/x" width="400" height="300"></iframe>${long(30)}
<h2>Контакты</h2><iframe src="https://yandex.ru/map-widget/v1/?ll=37,55" width="400" height="300"></iframe>
<form><input name="name" placeholder="Имя"><input type="tel" name="phone"><button>Отправить</button></form>
<h3 class="hid">Скрытый заголовок</h3></main>
<div class="fx"><a class="to-top" href="#">Наверх</a></div>
<footer><a href="mailto:info@a.example">info@a.example</a> <a href="https://vk.com/a">ВКонтакте</a>
<p>ООО «Пример» ИНН 7700000000 ОГРН 1027700000000</p><p>Пн-Пт 9:00-18:00</p><a href="/privacy">Политика конфиденциальности</a>
<img src="/i/visa.svg" alt="Visa"><p>© 2024 Пример</p><div class="cookie-note">Мы используем cookie</div></footer></body></html>`;
let server = null;

try {
  // ================================================================== 1. kf-dom в jsdom
  const jsdom = await loadDep('jsdom');
  if (!jsdom || !jsdom.JSDOM) skipped('kf-dom в jsdom', 'jsdom не найден (npm install в корне шаблона)');
  else {
    const r = await KD.scanHtml(HOME, { url: 'https://a.example/', dict: DICT });
    const ids = z => (r.zones[z] || []).map(e => e.id);
    check('kf-dom: шапка - телефон, мессенджер, обратный звонок, поиск, корзина, логотип, меню, ссылки по словарю', ['phone', 'messenger_whatsapp', 'callback', 'search', 'cart', 'logo', 'menu_main', 'catalog_link', 'about_link', 'delivery', 'contacts_link'].every(id => ids('header').includes(id)), ids('header').join(','));
    check('kf-dom: подвал - почта, соцсеть, реквизиты, юрлицо, часы, политика, значки оплаты, копирайт, куки', ['email', 'social_vk', 'requisites', 'legal_name', 'hours', 'privacy_policy', 'payment_icons', 'copyright', 'cookie_banner'].every(id => ids('footer').includes(id)), ids('footer').join(','));
    check('kf-dom: тело - крошки, цена, форма заявки, карта, видео, Schema.org', ['breadcrumbs', 'price', 'lead_form', 'map', 'video', 'schema_organization', 'schema_breadcrumbs'].every(id => ids('body').includes(id)), ids('body').join(','));
    check('kf-dom: закрепленные - кнопка вверх и чат-виджет по src скрипта', ids('fixed').includes('up_button') && ids('fixed').includes('chat'), ids('fixed').join(','));
    const ph = r.zones.header.find(e => e.id === 'phone');
    check('kf-dom: доказательство - selector, текст и href', ph && ph.evidence.href === 'tel:+74950000000' && /header/.test(ph.evidence.selector) && /495/.test(ph.evidence.text), JSON.stringify(ph));
    const p8 = r.zones.header.find(e => e.id === 'phone_8800');
    check('kf-dom: элемент в скрытом блоке - с пометкой hidden (решение по видимости у наблюдателя)', p8 && p8.hidden === true, JSON.stringify(p8));
    check('kf-dom: mobile в jsdom пуст (его заполняет снятие на 390 px), раскладки нет - y null', Array.isArray(r.zones.mobile) && !r.zones.mobile.length && r.page.layout === false && r.outline.every(o => o.y === null && o.tile === null));
    const ol = r.outline;
    const sec = h => ol.find(o => o.heading === h) || {};
    check('kf-dom: контур секций - h1-h3 тела с has (список, фото и видео, карта и форма) и text80', sec('Заголовок страницы').level === 1 && sec('Как мы работаем').has.includes('list') && ['img', 'video'].every(h => sec('Галерея работ').has.includes(h)) && ['map', 'form'].every(h => sec('Контакты').has.includes(h)) && /Работы от/.test(sec('Заголовок страницы').text80) && sec('Заголовок страницы').text80.length <= 80, JSON.stringify(ol));
    check('kf-dom: скрытый заголовок и шапка с подвалом в контур не входят', !ol.some(o => /Скрытый/.test(o.heading)) && !ol.some(o => /Каталог|Политика/.test(o.heading)), JSON.stringify(ol.map(o => o.heading)));
    check('kf-dom: schema - типы JSON-LD с @graph', r.schema.includes('Organization') && r.schema.includes('BreadcrumbList'), JSON.stringify(r.schema));
    const r2 = await KD.scanHtml('<html><body><div class="site-header"><a href="tel:+7999">Позвонить</a></div><div class="content"><h1>Заголовок</h1><p>Текст</p></div><div class="site-footer"><a href="mailto:a@b.ru">a@b.ru</a></div></body></html>', { url: 'https://b.example/', dict: DICT });
    check('kf-dom: без тегов header и footer - зоны по классу (обертка всего содержимого не берется)', r2.zones.header.some(e => e.id === 'phone') && r2.zones.footer.some(e => e.id === 'email') && r2.outline.some(o => o.heading === 'Заголовок'), JSON.stringify(r2.zones));
    const r3 = await KD.scanHtml('<html><body class="has-header"><div class="page"><div class="header-top"><a href="tel:+7999">тел</a></div><h2>Раздел</h2><p>Текст раздела</p></div></body></html>', { url: 'https://c.example/', dict: DICT });
    check('kf-dom: класс header у body не делает всю страницу шапкой', r3.outline.some(o => o.heading === 'Раздел') && r3.zones.header.some(e => e.id === 'phone'), JSON.stringify({ o: r3.outline, h: r3.zones.header }));
    const allIds = new Set([...['header', 'footer', 'body', 'fixed'].flatMap(ids), ...r2.zones.header.map(e => e.id)]);
    const r4 = await KD.scanHtml('<html><body><header><a href="https://t.me/manager_x">Написать</a></header><main><h1>Заголовок</h1><p>Информация на сайте не является публичной офертой</p></main><footer><a href="https://t.me/s/news_x">Наш канал</a><a href="https://t.me/news_y">Подписаться на канал</a></footer></body></html>', { url: 'https://d.example/', dict: DICT });
    check('kf-dom: Telegram - контакт (t.me/<имя>) в messenger_telegram, канал (t.me/s/, подпись про канал) в social_telegram', r4.zones.header.some(e => e.id === 'messenger_telegram') && !r4.zones.header.some(e => e.id === 'social_telegram') && r4.zones.footer.filter(e => e.id === 'social_telegram').length >= 1 && !r4.zones.footer.some(e => e.id === 'messenger_telegram'), JSON.stringify(r4.zones));
    check('kf-dom: оговорка «не является публичной офертой» - не элемент offer', !['header', 'footer', 'body'].some(z => (r4.zones[z] || []).some(e => e.id === 'offer')), JSON.stringify(r4.zones.body));
    check('kf-dom: id находок - из словаря', [...allIds].every(id => DICT_IDS.has(id)), [...allIds].filter(id => !DICT_IDS.has(id)).join(','));
  }
  // детекторы kf-dom и словарь: все id, которые может выдать обход, есть в словаре
  {
    const src = read('scripts/kf-dom.mjs');
    const DETECT = ['phone', 'phone_8800', 'email', 'messenger_whatsapp', 'messenger_telegram', 'messenger_viber', 'messenger_max', 'social_telegram', 'social_vk', 'social_ok', 'social_youtube', 'social_rutube', 'social_dzen', 'social_instagram', 'social_tiktok', 'review_platforms', 'app_links', 'cart', 'favorites', 'compare', 'account', 'privacy_policy', 'offer', 'pd_consent', 'terms_of_use', 'sitemap_link', 'search', 'subscribe', 'footer_form', 'lead_form', 'breadcrumbs', 'rating', 'map', 'video', 'callback', 'quiz', 'chat', 'up_button', 'burger', 'buy_button', 'cookie_banner', 'logo', 'menu_main', 'footer_menu', 'payment_icons', 'requisites', 'legal_name', 'hours', 'copyright', 'price', 'schema_organization', 'schema_localbusiness', 'schema_breadcrumbs', 'schema_product', 'schema_faq', 'schema_rating'];
    check('kf-dom: каждый детектор - id словаря и есть в коде обхода', DETECT.every(id => DICT_IDS.has(id) && src.includes(`'${id}'`)), DETECT.filter(id => !DICT_IDS.has(id) || !src.includes(`'${id}'`)).join(','));
    const lp = KD.linkPatterns(DICT);
    const del = lp.find(x => x.id === 'delivery');
    check('linkPatterns: только элементы вида page_link, регулярки собираются, подпись ссылки находит элемент', lp.length > 20 && lp.every(x => DICT.elements.find(e => e.id === x.id).kind === 'page_link') && del && new RegExp(del.re, 'i').test('доставка и оплата') && !new RegExp(del.re, 'i').test('оплата доставки') && lp.every(x => { try { new RegExp(x.re); return true; } catch { return false; } }), JSON.stringify(del));
    let compiles = true; try { new Function(`return ${KD.scanExpression({ links: lp })}`); } catch { compiles = false; }
    check('scanExpression: выражение-вызов функции обхода компилируется, без сети', compiles && !/fetch\(|XMLHttpRequest/.test(KD.kfScanPage.toString()));
  }

  // ================================================================== 2. словарь
  {
    const e = schemaErrors('kf-elements', DICT);
    check('kf-elements.json: проходит схему', !e.length, e.join('; '));
    check('kf-elements.json: около 120 общих элементов, id без повторов', DICT.elements.length >= 100 && DICT.elements.length <= 160 && DICT_IDS.size === DICT.elements.length, DICT.elements.length);
    const CATS = ['Навигация', 'Контакты', 'Конверсия', 'Коммерческая информация', 'Доверие', 'E-E-A-T', 'Социальное доказательство', 'Контент', 'Сервисные элементы', 'Юридическая информация', 'Бренд', 'Вспомогательные элементы', 'Неопределено'];
    check('kf-elements.json: 13 категорий промта, категория элемента - из списка', JSON.stringify(DICT.categories) === JSON.stringify(CATS) && DICT.elements.every(x => CATS.includes(x.category)), DICT.elements.filter(x => !CATS.includes(x.category)).map(x => x.id).join(','));
    check('kf-elements.json: слот - с needs или needs_hint; ссылка на страницу - с page_match', DICT.elements.filter(x => x.kind === 'slot').every(x => x.needs.length || x.needs_hint) && DICT.elements.filter(x => x.kind === 'page_link').every(x => x.page_match), DICT.elements.filter(x => (x.kind === 'slot' && !x.needs.length && !x.needs_hint) || (x.kind === 'page_link' && !x.page_match)).map(x => x.id).join(','));
    check('kf-elements.json: невидимые (visible false) - только разметка Schema.org', DICT.elements.filter(x => x.visible === false).every(x => /^schema_/.test(x.id)) && DICT.elements.some(x => x.visible === false));
    check('kf-elements.json: четыре стороны E-E-A-T представлены', ['trust', 'experience', 'expertise', 'authority'].every(k => DICT.elements.some(x => x.eeat === k)));
    check('kf-elements.json: page_match.subject_re компилируются', DICT.elements.filter(x => x.page_match && x.page_match.subject_re).every(x => { try { new RegExp(x.page_match.subject_re, 'i'); return true; } catch { return false; } }));
  }

  // ================================================================== 3. fetch-page --html-from, prep-args
  {
    const F = mkProject('html-from');
    const raw = n => path.join(F, 'work', 'competitors', 'raw', 'a.example', `${n}.json`);
    const shot = (n, html) => { const f = path.join(F, 'work', 'competitors', 'shots', 'a.example', n, 'render.html'); wt(f, html); return f; };
    const url = 'https://a.example/';
    const fp = (n, html) => run(F, ['scripts/fetch-page.mjs', url, raw(n), '--html-from', shot(n, html)]);
    const r1 = fp('home', HOME);
    const j1 = rj(raw('home'));
    check('--html-from: снимок status browser, verbatim true, via cdp, html_path рядом, разбор секций как у статического', r1.code === 0 && j1.status === 'browser' && j1.verbatim === true && j1.via === 'cdp' && fs.existsSync(j1.html_path) && j1.title === 'Главная' && j1.sections.some(s => s.heading === 'Как мы работаем') && j1.links.some(l => l.href === 'https://a.example/catalog') && /ИНН 7700000000/.test(j1.footer_text), r1.out + JSON.stringify(j1).slice(0, 300));
    const CH = '<html><head><title>Just a moment...</title></head><body><p>Checking your browser before accessing a.example</p></body></html>';
    const r2 = fp('chal', CH);
    check('--html-from: CDP получил страницу проверки - след .cdp.html, снимок antibot (прежнего нет), браузер агента не запускать', r2.code === 0 && rj(raw('chal')).status === 'antibot' && fs.existsSync(raw('chal').replace(/\.json$/, '.cdp.html')) && /браузер агента не запускать/.test(r2.stdout), r2.out);
    wj(raw('chal2'), { url, status: 'antibot', http_status: 403, fetched_at: 'прежний', text_chars: 0, sections: [], html_path: '' });
    const r3 = fp('chal2', CH);
    check('--html-from: страница проверки при прежнем снимке - прежний не заменен', rj(raw('chal2')).fetched_at === 'прежний' && fs.existsSync(raw('chal2').replace(/\.json$/, '.cdp.html')) && /прежний не заменен/.test(r3.stdout), r3.out);
    const bigHtml = path.join(F, 'big.html'); wt(bigHtml, HOME);
    wj(raw('keep'), { url, final_url: url, status: 'js_only', text_chars: 999999, sections: [], html_path: bigHtml });
    const r4 = fp('keep', '<html><head><title>T</title></head><body><h1>A</h1><h2>B</h2><p>мало</p></body></html>');
    check('--html-from: статический снимок того же адреса не меньше отрисованного - остается он (js_only -> ok)', rj(raw('keep')).status === 'ok' && rj(raw('keep')).browser_smaller === true && /оставлен статический/.test(r4.stdout), r4.out);
    fp('flat', `<html><head><title>T</title></head><body><h1>Один заголовок</h1>${long(40)}</body></html>`);
    check('--html-from: плоская отрисованная страница (меньше двух заголовков) - flat', rj(raw('flat')).flat === true && rj(raw('flat')).status === 'browser');
    check('--html-from: снимок проходит схему страниц competitors (status browser, verbatim)', !schemaErrors('competitors', { verified_at: 'x', competitors: [{ domain: 'a.example', status: 'ok', source: 'analysis', pages: [{ url, type: 'home', raw: 'r', status: j1.status, verbatim: j1.verbatim }] }] }).length);

    // prep-args --check-degraded: след CDP наравне с .browser.md
    const D = mkProject('degraded');
    const home = d => path.join(D, 'work', 'competitors', 'raw', d, 'home.json');
    wj(path.join(D, 'work', 'competitors', 'competitors.json'), { verified_at: 'x', degraded: 'no_competitors', competitors: [{ domain: 'd1.example', status: 'closed', source: 'analysis' }, { domain: 'd2.example', status: 'closed', source: 'analysis' }] });
    wj(home('d1.example'), { url: 'https://d1.example/', status: 'closed', http_status: 404 });
    wj(home('d2.example'), { url: 'https://d2.example/', status: 'antibot', http_status: 403 });
    wt(home('d2.example').replace(/\.json$/, '.cdp.html'), CH);
    const c1 = run(D, ['scripts/prep-args.mjs', '--check-degraded']);
    check('--check-degraded: antibot со следом CDP (.cdp.html) - сайт ответил, no_competitors', c1.code === 0 && JSON.parse(c1.stdout).degraded === 'no_competitors', c1.out);
    fs.rmSync(home('d2.example').replace(/\.json$/, '.cdp.html'));
    const c2 = run(D, ['scripts/prep-args.mjs', '--check-degraded']);
    check('--check-degraded: antibot без следа браузера и CDP - сбой среды, null', JSON.parse(c2.stdout).degraded === null && /d2\.example: статус antibot без браузерного снимка/.test(JSON.parse(c2.stdout).why), c2.out);
  }

  // prep-args --prune-stale и замер только годных: разборы и снимки доменов прежнего отбора не попадают к агрегатору
  {
    const S = mkProject('prune');
    const comp = path.join(S, 'work', 'competitors');
    wj(path.join(comp, 'competitors.json'), { verified_at: 'x', competitors: [
      { domain: 'a.example', status: 'ok', source: 'analysis', pages: [{ type: 'home', url: 'https://a.example/', raw: 'work/competitors/raw/a.example/home.json', status: 'ok' }] },
      { domain: 'b.example', status: 'excluded', source: 'serp', reason: 'другой профиль', pages: [{ type: 'home', url: 'https://b.example/', raw: 'work/competitors/raw/b.example/home.json', status: 'ok' }] }] });
    for (const d of ['a.example', 'b.example', 'old.example']) {
      wj(path.join(comp, d, 'home.blocks.json'), { domain: d, blocks: [] });
      wj(path.join(comp, 'raw', d, 'home.json'), { url: `https://${d}/`, status: 'ok', sections: [{ level: 2, heading: 'Блок', chars: 100, words: 20, text: 'x' }, { level: 2, heading: 'Еще', chars: 50, words: 10, text: 'y' }] });
    }
    const pr = run(S, ['scripts/prep-args.mjs', '--prune-stale']);
    let pj = null; try { pj = JSON.parse(pr.stdout); } catch { pj = null; }
    check('--prune-stale: разборы не годных доменов - в _stale/, годный на месте, снимки raw не тронуты', pr.code === 0 && !!pj && JSON.stringify(pj.moved.sort()) === '["b.example","old.example"]' && fs.existsSync(path.join(comp, 'a.example', 'home.blocks.json')) && fs.existsSync(path.join(comp, '_stale', 'old.example', 'home.blocks.json')) && fs.existsSync(path.join(comp, 'raw', 'old.example', 'home.json')), pr.out);
    const ms = run(S, ['scripts/measure-blocks.mjs']);
    const csvText = fs.readFileSync(path.join(comp, 'measurements.csv'), 'utf8');
    check('measure-blocks: в замере только годные конкуренты (status ok)', ms.code === 0 && csvText.includes('a.example') && !csvText.includes('b.example') && !csvText.includes('old.example'), ms.out);
  }

  // ================================================================== 4. capture-pages без Chrome, кадры, служебные функции
  {
    const NOCH = { SITE_TEKST_CHROME: path.join(tmpRoot, 'нет-такого-chrome.exe'), ...(NM ? { SITE_TEKST_NODE_MODULES: NM } : {}) };
    const C = mkProject('nochrome');
    setCfg(C, { site_url: '' });
    wj(path.join(C, 'work', 'competitors', 'competitors.json'), { verified_at: 'x', competitors: [
      { domain: 'd1.example', status: 'ok', source: 'analysis', pages: [{ type: 'home', url: 'https://d1.example/', raw: 'work/competitors/raw/d1.example/home.json', status: 'ok' }, { type: 'service', url: 'https://d1.example/s', raw: 'work/competitors/raw/d1.example/service-1.json', status: 'js_only' }, { type: 'category', url: 'https://d1.example/c', raw: 'work/competitors/raw/d1.example/category-1.json', status: 'closed' }] },
      { domain: 'bad.example', status: 'closed', source: 'serp' }] });
    const stHtml = path.join(C, 'work', 'competitors', 'raw', 'd1.example', 'home.html');
    wt(stHtml, HOME);
    wj(path.join(C, 'work', 'competitors', 'raw', 'd1.example', 'home.json'), { url: 'https://d1.example/', final_url: 'https://d1.example/', status: 'ok', html_path: stHtml, sections: [] });
    const r1 = run(C, ['scripts/capture-pages.mjs', '--domain', 'd1.example'], NOCH);
    const k1 = tag(r1.stdout, 'KF_CAPTURE');
    const cap = rj(path.join(C, 'work', 'competitors', 'capture.json'));
    check('нет Chrome и Edge: код 0, chrome null, страницы skipped (no_chrome), closed-страница не берется', r1.code === 0 && k1 && k1.chrome === false && k1.jobs === 2 && k1.skipped === 2 && cap.chrome === null && cap.pages.length === 2 && cap.pages.every(p => p.status === 'skipped' && p.reason === 'no_chrome') && /no_chrome/.test(r1.stdout), r1.out + JSON.stringify(cap));
    const stKf = path.join(C, 'work', 'competitors', 'shots', 'd1.example', 'home', 'kf.json');
    const jsd = await loadDep('jsdom');
    if (jsd) check('нет Chrome: DOM-находки по статическому html снимка (jsdom) - kf.json static, запись dom static; без html - строка limits', fs.existsSync(stKf) && rj(stKf).static === true && rj(stKf).zones.header.some(e => e.id === 'phone') && cap.pages.find(p => p.name === 'home').dom === 'static' && (cap.pages.find(p => p.name === 'service-1').limits || []).some(l => /статического html/.test(l)), JSON.stringify(cap.pages));
    else skipped('DOM по статическому html без Chrome', 'jsdom не найден');
    check('capture.json: запись страницы - domain, name по снимку, type, role, files', cap.pages.find(p => p.name === 'service-1')?.type === 'service' && cap.pages.every(p => p.role === 'competitor' && Array.isArray(p.files)));
    // --resume: готовое не переснимается
    const okDir = path.join(C, 'work', 'competitors', 'shots', 'd1.example', 'home');
    wt(path.join(okDir, 'top.jpg'), 'x');
    const part = path.join(C, 'work', 'competitors', 'shots', 'd1.example', 'capture.part.json');
    wj(part, { domain: 'd1.example', pages: [{ domain: 'd1.example', name: 'home', url: 'https://d1.example/', type: 'home', role: 'competitor', status: 'ok', reason: '', height: 900, ms: 4242, files: [{ file: 'work/competitors/shots/d1.example/home/top.jpg', y0: 0, y1: 900 }], partial: false }] });
    const r2 = run(C, ['scripts/capture-pages.mjs', '--domain', 'd1.example', '--resume'], NOCH);
    const cap2 = rj(path.join(C, 'work', 'competitors', 'capture.json'));
    const home2 = cap2.pages.find(p => p.name === 'home');
    check('--resume: готовая страница (ok, файлы на месте) не переснимается, прочие - по правилам (нет Chrome - skipped)', r2.code === 0 && home2.status === 'ok' && home2.ms === 4242 && cap2.pages.find(p => p.name === 'service-1').status === 'skipped' && tag(r2.stdout, 'KF_CAPTURE').captured === 1, r2.out);
    fs.rmSync(path.join(okDir, 'top.jpg'));
    run(C, ['scripts/capture-pages.mjs', '--domain', 'd1.example', '--resume'], NOCH);
    check('--resume: файла кадра нет - страница переснимается', rj(path.join(C, 'work', 'competitors', 'capture.json')).pages.find(p => p.name === 'home').status === 'skipped');
    // stale: домен не из competitors.json
    wj(path.join(C, 'work', 'competitors', 'shots', 'zz.example', 'capture.part.json'), { domain: 'zz.example', pages: [{ domain: 'zz.example', name: 'home', url: 'https://zz.example/', type: 'home', role: 'competitor', status: 'ok', files: [] }] });
    const r3 = run(C, ['scripts/capture-pages.mjs', '--domain', 'zz.example'], NOCH);
    const cap3 = rj(path.join(C, 'work', 'competitors', 'capture.json'));
    check('домен не из competitors.json (устарел после пересбора) - skipped, причина stale; код 0', r3.code === 0 && cap3.pages.find(p => p.domain === 'zz.example')?.status === 'skipped' && cap3.pages.find(p => p.domain === 'zz.example').reason === 'stale' && /нет в competitors\.json/.test(r3.stdout), r3.out + JSON.stringify(cap3.pages.map(p => [p.domain, p.status, p.reason])));
    const r4 = run(C, ['scripts/capture-pages.mjs', '--domain', 'own'], NOCH);
    check('--domain own без site_url - нечего снимать, код 0', r4.code === 0 && tag(r4.stdout, 'KF_CAPTURE').jobs === 0 && /site_url пуст/.test(r4.stdout), r4.out);
    check('статус не ok у домена - не снимается', tag(run(C, ['scripts/capture-pages.mjs', '--domain', 'bad.example'], NOCH).stdout, 'KF_CAPTURE').jobs === 0);
    check('неверные аргументы - код 2', run(C, ['scripts/capture-pages.mjs'], NOCH).code === 2 && run(C, ['scripts/capture-pages.mjs', '--url', 'https://a/', '--domain', 'a'], NOCH).code === 2 && run(C, ['scripts/capture-pages.mjs', '--file', 'nope.html', '--out', 'x'], NOCH).code === 2);
    const proto = path.join(C, 'proto.html'); wt(proto, '<html><body>П</body></html>');
    const r5 = run(C, ['scripts/capture-pages.mjs', '--file', proto, '--routes', '#/,#/x', '--out', path.join(C, 'work', 'audit', 'site-shots')], NOCH);
    check('прототип без Chrome: код 0, KF_PROTO chrome false, кадров нет', r5.code === 0 && tag(r5.stdout, 'KF_PROTO')?.chrome === false && !tag(r5.stdout, 'KF_PROTO').shots.length, r5.out);
    // кадры
    const tp = H => CP.tilePlan(H);
    const bodies = p => p.files.filter(f => /^body-/.test(f.file));
    const big = tp(50000);
    check('tilePlan: длинная страница - кадров тела не больше 8, каждый не выше 1600 px, truncated', bodies(big).length === 8 && bodies(big).every(f => f.y1 - f.y0 <= 1600) && big.truncated === true && big.files[0].file === 'top.jpg' && big.files[0].y1 === 1100 && big.files.at(-1).file === 'bottom.jpg' && big.files.at(-1).y1 - big.files.at(-1).y0 === 1400, JSON.stringify(big.files));
    check('tilePlan: короткая страница - только top', JSON.stringify(tp(900).files) === JSON.stringify([{ file: 'top.jpg', y0: 0, y1: 900 }]) && tp(900).truncated === false);
    const mid = tp(6460);
    const covered = mid.files.filter(f => f.file !== 'bottom.jpg').every((f, i, a) => i === 0 || f.y0 === a[i - 1].y1) && bodies(mid).at(-1).y1 === mid.files.at(-1).y0;
    check('tilePlan: страница средней длины - top, тело без зазоров до bottom, кадры не выше 1600', covered && bodies(mid).length === 3 && bodies(mid).every(f => f.y1 - f.y0 <= 1600) && !mid.truncated, JSON.stringify(mid.files));
    check('tileOf: секция в своем кадре', CP.tileOf(50, mid.files) === 'top.jpg' && CP.tileOf(1200, mid.files) === 'body-01.jpg' && CP.tileOf(6400, mid.files) === 'bottom.jpg' && CP.tileOf(null, mid.files) === null);
    const now = 1e9;
    check('pageLimit: страница не дольше 150 с и не дольше дедлайна + 90 с (не меньше 30 с) - вызов с --max-seconds 480 укладывается в 600 с', CP.pageLimit(now + 480000, now) === 150000 && CP.pageLimit(now + 10000, now) === 100000 && CP.pageLimit(now - 200000, now) === 30000 && CP.pageLimit(now, now) + 480000 <= 600000 - 30000);
    const cpSrc = read('scripts/capture-pages.mjs');
    check('capture-pages: часть домена и сводка пишутся после каждой страницы (onRecord -> save), срезанная дедлайном страница - skipped timeout', cpSrc.includes('const onRecord = r => { keep.set(r.name, r); try { save();') && cpSrc.includes("if (lim < PAGE_MS) { cut = true; put({ ...base(job), status: 'skipped', reason: 'timeout', partial: true }); }"));
    check('сетевой отказ - повтор: ERR_CONNECTION_REFUSED/RESET, не HTTP и не DNS', CP.NET_RETRY.test('сайт не ответил: net::ERR_CONNECTION_REFUSED') && CP.NET_RETRY.test('net::ERR_CONNECTION_RESET') && !CP.NET_RETRY.test('HTTP 404') && !CP.NET_RETRY.test('net::ERR_NAME_NOT_RESOLVED') && CP.NET_RETRY_MS >= 1000);
    check('findChrome: SITE_TEKST_CHROME - только она (есть - путь, нет - null)', CP.findChrome({ SITE_TEKST_CHROME: process.execPath }) === process.execPath && CP.findChrome({ SITE_TEKST_CHROME: path.join(tmpRoot, 'nope.exe') }) === null);
    const od = path.join(tmpRoot, 'orph'); fs.mkdirSync(od);
    const o1 = path.join(od, `${CP.PROFILE_PREFIX}old`), o2 = path.join(od, `${CP.PROFILE_PREFIX}new`), o3 = path.join(od, 'other-old');
    for (const d of [o1, o2, o3]) fs.mkdirSync(d);
    const old = new Date(Date.now() - 2 * 3600000); fs.utimesSync(o1, old, old); fs.utimesSync(o3, old, old);
    check('cleanOrphans: удаляет только профили site-tekst-cdp- старше часа', CP.cleanOrphans(od) === 1 && !fs.existsSync(o1) && fs.existsSync(o2) && fs.existsSync(o3));
  }

  // ================================================================== 5. живой снимок Chrome
  {
    const chrome = CP.findChrome();
    if (!chrome) skipped('живой снимок Chrome', 'Chrome и Edge не найдены (SITE_TEKST_CHROME или пути по умолчанию)');
    else if (process.env.SITE_TEKST_TEST_NO_CHROME === '1') skipped('живой снимок Chrome', 'SITE_TEKST_TEST_NO_CHROME=1');
    else {
      const srvFile = path.join(tmpRoot, 'server.mjs');
      const inner = `<!doctype html><html><head><title>Внутренний скролл</title><style>html,body{height:100%;overflow:hidden;margin:0}#app{height:100vh;overflow-y:auto}</style></head><body><div id="app"><header><a href="tel:+79990000000">Позвонить</a></header><h1>Страница во внутреннем контейнере</h1>${long(150)}<h2>Низ страницы</h2><footer>Подвал ИНН 7700000001</footer></div></body></html>`;
      const CH = '<!doctype html><html><head><title>Just a moment...</title></head><body><p>Checking your browser before accessing</p></body></html>';
      const svc = `<!doctype html><html><head><title>Услуга</title></head><body><header><a href="tel:+74950000000">тел</a></header><main><h1>Услуга</h1>${long(40)}<h2>Цены</h2><table><tr><td>a</td></tr></table>${long(20)}</main><footer>Подвал</footer></body></html>`;
      const P = { '/': HOME.replace(long(30), long(60)), '/inner': inner, '/chal': CH, '/svc': svc, '/own': svc };
      wt(srvFile, `import http from 'node:http';
const P = ${JSON.stringify(P)};
http.createServer((q, s) => { const h = P[q.url]; s.writeHead(h ? 200 : 404, { 'content-type': 'text/html; charset=utf-8' }); s.end(h || 'no'); }).listen(0, '127.0.0.1', function () { console.log('PORT ' + this.address().port); });
`);
      server = spawn(process.execPath, [srvFile], { stdio: ['ignore', 'pipe', 'pipe'] });
      const port = await new Promise((res, rej) => {
        let buf = '';
        const t = setTimeout(() => rej(new Error('сервер не стартовал')), 10000);
        server.stdout.on('data', d => { buf += d; const m = buf.match(/PORT (\d+)/); if (m) { clearTimeout(t); res(Number(m[1])); } });
        server.on('exit', c => rej(new Error('сервер завершился: ' + c)));
      });
      const base = `http://127.0.0.1:${port}`;
      const L = mkProject('live');
      setCfg(L, { site_url: `${base}/own` });
      const pg = (d, type, n, p, status = 'ok') => ({ type, url: `${base}${p}`, raw: `work/competitors/raw/${d}/${n}.json`, status });
      wj(path.join(L, 'work', 'competitors', 'competitors.json'), { verified_at: 'x', competitors: [
        { domain: 'a.test', status: 'ok', source: 'analysis', pages: [pg('a.test', 'home', 'home', '/'), pg('a.test', 'service', 'service-1', '/inner', 'js_only'), pg('a.test', 'category', 'category-1', '/chal', 'antibot')] },
        { domain: 'b.test', status: 'ok', source: 'analysis', pages: [pg('b.test', 'home', 'home', '/svc'), pg('b.test', 'service', 'service-1', '/svc'), pg('b.test', 'category', 'category-1', '/inner')] }] });
      const r1 = run(L, ['scripts/capture-pages.mjs', '--domain', 'a.test', '--concurrency', '2']);
      const k1 = tag(r1.stdout, 'KF_CAPTURE');
      const cap = rj(path.join(L, 'work', 'competitors', 'capture.json'));
      const rec = n => cap.pages.find(p => p.domain === 'a.test' && p.name === n) || {};
      check('живой снимок: код 0, chrome в сводке, главная и внутренняя ok, страница проверки - antibot', r1.code === 0 && k1 && k1.chrome === true && rec('home').status === 'ok' && rec('service-1').status === 'ok' && rec('category-1').status === 'antibot' && cap.chrome && fs.existsSync(cap.chrome), r1.out);
      const SH = n => path.join(L, 'work', 'competitors', 'shots', 'a.test', n);
      const files = rec('home').files || [];
      const sz = f => jpegSize(path.join(L, f.file)) || {};
      const top = files.find(f => /\/top\.jpg$/.test(f.file)), bot = files.find(f => /\/bottom\.jpg$/.test(f.file)), mob = files.find(f => /\/mobile\.jpg$/.test(f.file));
      const bodyF = files.filter(f => /\/body-\d+\.jpg$/.test(f.file));
      check('кадры главной: top 1366x1100, тело кадрами шириной 1366 не выше 1600 и не больше 8, bottom не выше 1400, mobile 390x844', top && sz(top).w === 1366 && sz(top).h === 1100 && bodyF.length >= 1 && bodyF.length <= 8 && bodyF.every(f => sz(f).w === 1366 && sz(f).h <= 1600 && sz(f).h === f.y1 - f.y0) && bot && sz(bot).h <= 1400 && mob && sz(mob).w === 390 && sz(mob).h === 844, JSON.stringify(files.map(f => [f.file.split('/').pop(), sz(f)])));
      check('монолитного снимка нет: в папке страницы только кадры, kf.json и render.html', fs.readdirSync(SH('home')).every(f => /^(top|bottom|mobile|body-\d{2})\.jpg$|^kf\.json$|^render\.html$/.test(f)), fs.readdirSync(SH('home')).join(','));
      const kf = rj(path.join(SH('home'), 'kf.json'));
      const zid = z => (kf.zones[z] || []).map(e => e.id);
      check('kf.json живого снимка: зоны с раскладкой (шапка, подвал, закрепленные), mobile с 390 px, outline с y и кадром', zid('header').includes('phone') && zid('footer').includes('requisites') && zid('fixed').includes('up_button') && zid('mobile').includes('phone') && kf.page.layout === true && kf.outline.some(o => o.heading === 'Как мы работаем' && typeof o.y === 'number' && /^(top|body-\d{2}|bottom)\.jpg$/.test(o.tile)), JSON.stringify({ z: kf.zones.fixed, o: kf.outline.slice(0, 3) }));
      check('внутренний скролл-контейнер (высота документа равна окну): ограничения сняты, страница снята целиком', rec('service-1').inner_scroll === true && rec('service-1').height > 3000 && (rec('service-1').files || []).some(f => /bottom\.jpg$/.test(f.file)), JSON.stringify(rec('service-1')));
      check('антибот: страница проверки ждет до 12 с и записывается antibot с render.html и top.jpg', fs.existsSync(path.join(SH('category-1'), 'render.html')) && rec('category-1').reason && (rec('category-1').files || []).length === 1, JSON.stringify(rec('category-1')));
      const fr = run(L, ['scripts/fetch-page.mjs', `${base}/chal`, 'work/competitors/raw/a.test/category-1.json', '--html-from', 'work/competitors/shots/a.test/category-1/render.html']);
      const fh = run(L, ['scripts/fetch-page.mjs', `${base}/inner`, 'work/competitors/raw/a.test/service-1.json', '--html-from', 'work/competitors/shots/a.test/service-1/render.html']);
      check('render.html -> fetch-page --html-from: внутренняя - browser verbatim cdp, проверка - след .cdp.html', rj(path.join(L, 'work/competitors/raw/a.test/service-1.json')).via === 'cdp' && rj(path.join(L, 'work/competitors/raw/a.test/service-1.json')).text_chars > 1500 && fs.existsSync(path.join(L, 'work/competitors/raw/a.test/category-1.cdp.html')), fr.out + fh.out);
      // --max-seconds 1: дедлайн, partial, код 0; --resume не переснимает готовое
      const r2 = run(L, ['scripts/capture-pages.mjs', '--domain', 'b.test', '--concurrency', '1', '--max-seconds', '1']);
      const k2 = tag(r2.stdout, 'KF_CAPTURE');
      const capB = () => rj(path.join(L, 'work', 'competitors', 'capture.json')).pages.filter(p => p.domain === 'b.test');
      const b1 = capB();
      const firstOk = b1.find(p => p.status === 'ok');
      check('--max-seconds 1: текущая страница доснята, новые не взяты - skipped (timeout, partial), сводка partial, код 0', r2.code === 0 && k2 && k2.partial === true && firstOk && b1.filter(p => p.status === 'skipped' && p.reason === 'timeout' && p.partial === true).length === 2, r2.out + JSON.stringify(b1.map(p => [p.name, p.status, p.reason])));
      const r3 = run(L, ['scripts/capture-pages.mjs', '--domain', 'b.test', '--resume']);
      const b2 = capB();
      check('--resume после дедлайна: остаток снят, готовая страница не переснята', r3.code === 0 && tag(r3.stdout, 'KF_CAPTURE').partial === false && b2.every(p => p.status === 'ok') && firstOk && b2.find(p => p.name === firstOk.name).ms === firstOk.ms && tag(r3.stdout, 'KF_CAPTURE').captured === 2, r3.out);
      const r4 = run(L, ['scripts/capture-pages.mjs', '--domain', 'own']);
      const own = rj(path.join(L, 'work', 'competitors', 'capture.json')).pages.find(p => p.domain === 'own');
      check('--domain own: главная site_url, role own, папка shots/own', r4.code === 0 && own && own.role === 'own' && own.status === 'ok' && fs.existsSync(path.join(L, 'work', 'competitors', 'shots', 'own', 'home', 'kf.json')), r4.out);
      check('capture.json проходит слияние вызовов: оба домена и own, без устаревших', rj(path.join(L, 'work', 'competitors', 'capture.json')).pages.map(p => p.domain).filter((d, i, a) => a.indexOf(d) === i).sort().join() === 'a.test,b.test,own');
      // прототип: первые экраны маршрутов 1366 и 390
      const proto = path.join(L, 'work', 'output', 'prototype.html');
      wt(proto, '<!doctype html><html><body><div id="v"></div><script>function r(){document.getElementById("v").textContent="Маршрут "+location.hash}window.onhashchange=r;r()</script></body></html>');
      const out = path.join(L, 'work', 'audit', 'site-shots');
      const r5 = run(L, ['scripts/capture-pages.mjs', '--file', proto, '--routes', '#/,#/uslugi', '--out', out]);
      const pk = tag(r5.stdout, 'KF_PROTO');
      check('прототип: первые экраны 1366x900 и 390x844 по маршрутам', r5.code === 0 && pk && pk.chrome === true && pk.shots.length === 2 && ['home-1366.jpg', 'home-390.jpg', 'uslugi-1366.jpg', 'uslugi-390.jpg'].every(f => fs.existsSync(path.join(out, f))) && (jpegSize(path.join(out, 'uslugi-390.jpg')) || {}).w === 390 && (jpegSize(path.join(out, 'home-1366.jpg')) || {}).h === 900, r5.out);
      const leftovers = fs.readdirSync(os.tmpdir()).filter(f => f.startsWith(CP.PROFILE_PREFIX) && Date.now() - fs.statSync(path.join(os.tmpdir(), f)).mtimeMs < 600000);
      if (leftovers.length) notes.push(`профили CDP после теста (могут быть параллельные прогоны): ${leftovers.length}`);
    }
  }

  // ================================================================== 6. стиль, UUID, ниша; промт классификатора
  {
    const YO = String.fromCharCode(0x451), YO2 = String.fromCharCode(0x401), D1 = String.fromCharCode(0x2014), D2 = String.fromCharCode(0x2013);
    const INVIS = [0xad, 0x200b, 0x200c, 0x200d, 0x2060, 0xfeff].map(c => String.fromCharCode(c));
    const NICHE = /(застройщ|депозит|квот[аеуы]|инвестор|недвижим|ипотек|новострой|апартамент|доходност|ювелир|золот|кольц|пирсинг|бриллиант|серебр|помолвоч|обручал|геммолог|пхукет|двигател|запчаст|trade-in|автомобил|goldax)/i;
    const OWN = ['scripts/capture-pages.mjs', 'scripts/kf-dom.mjs', 'config/kf-elements.json', 'schemas/kf-elements.schema.json', 'scripts/fetch-page.mjs', 'scripts/prep-args.mjs', 'prompts/02-page-classifier.md'];
    const bad = [];
    for (const f of OWN) {
      const t = read(f);
      if ([YO, YO2, D1, D2].some(ch => t.includes(ch))) bad.push(`${f}: е с точками или длинное тире`);
      if (INVIS.some(ch => t.includes(ch))) bad.push(`${f}: невидимый символ литералом`);
      if (/mcp__[0-9a-f]{8}-/.test(t)) bad.push(`${f}: UUID MCP`);
      const nm = t.match(NICHE); if (nm) bad.push(`${f}: нишевое слово «${nm[0]}»`);
    }
    check('файлы пакета B (снятие, DOM, словарь, fetch-page, prep-args, классификатор): без е с точками, длинных тире, невидимых символов, UUID MCP и ниши', !bad.length, bad.join('; '));
    const cls = read('prompts/02-page-classifier.md');
    check('02-page-classifier: CDP раньше браузера агента (capture-pages --url, --html-from), страница проверки CDP - окончательный ответ, нет Chrome - в browser', cls.includes('capture-pages.mjs --url <url> --domain <domain> --name <type>-<n>') && cls.includes('--html-from work/competitors/shots/<domain>/<type>-<n>/render.html') && cls.includes('«CDP получил страницу проверки» - URL пропусти') && cls.includes('Нет Chrome или снятие не удалось') && cls.includes('браузер не открывай') && cls.includes('по одному конкуренту за раз'));
    check('02-page-classifier: размер в бюджете 3400', cls.length <= 3400, cls.length);
    const gi = fs.readFileSync(path.resolve(TPL, '..', '..', '..', '..', '.gitignore'), 'utf8').split(/\r?\n/);
    check('.gitignore корня: кадры снятия и аудита, словарь и стоп-лист копии kit', ['texts/*/work/competitors/shots/', 'texts/*/work/audit/site-shots/', 'texts/*/config/kf-elements.json', 'texts/*/config/kf-stoplist.json'].every(l => gi.includes(l)));
  }
} catch (e) {
  fail++; failures.push(`FAIL исключение: ${e.stack || e.message}`);
} finally {
  if (server) server.kill();
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* временная папка */ }
}

notes.forEach(n => console.log(`NOTE ${n}`));
failures.forEach(f => console.log(f));
console.log(`cases-kf-capture: ${pass} ok, ${fail} fail${skip ? `, ${skip} skip` : ''}`);
process.exit(fail ? 1 : 0);
