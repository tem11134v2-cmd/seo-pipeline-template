// Тесты пакета P7 kit /site-tekst (программа 28.09): лидеры и типы страниц, фазы 2-3. Запуск:
//   node .claude/tests/site-tekst/cases-leaders.mjs      код выхода 0 - все прошли (или через run.mjs рядом).
// Разделы:
//   1. fetch-page на локальном http-сервере (отдельный процесс) и pageStatus: статусы по видимому тексту и заголовку окна
//      (reCAPTCHA формы, Contact Form 7, скрипт с CDN - не antibot; страница проверки, 401/403/429/503 - antibot; 404 и 500 -
//      closed), js_only - текст меньше 1500 знаков или пустая оболочка SPA, плоская страница - ok с flat, обрезанная секция -
//      truncated (chars - по полному тексту);
//   2. --text-from: отметка обхода DOM (verbatim), статический снимок не меньше браузерного остается (js_only -> ok),
//      страница проверки и старый браузерный снимок заменяются; обход DOM (--dom-snippet) в jsdom: h1 из h1, ссылки меню и
//      подвала первой строкой, без шапки, подвала, скрытого и скриптов; результат обхода -> fetch-page -> verbatim true;
//   3. measure-blocks: плоские страницы вне h2_count и section_chars, n и median null, пересказ браузера вне замера;
//   4. prep-args: info_other - названия страниц карты (без skip и ui_role), без таких страниц поля нет; --check-degraded;
//   5. wf-02 (подставной agent): лендинг без инвентаризации, info_other в задании классификатора, браузерный добор после
//      параллельной инвентаризации и строго по одному, аналитик каталогов после добора, деградация «без конкурентов»
//      (подтверждена скриптом, не подтверждена, не отмечена), роли и модели вызовов;
//   6. схемы page-type (sources [] у типа без конкурентов) и competitors (degraded, flat, verbatim);
//   7. промты 02-* и 03-*: инструмент браузера, пересказ запрещен, h1, info_other, режим browser, cta-final (cta старых
//      данных - синоним), лендинг, самопроверка агрегатора, без конкурентов, сверка цитат после нормализации; стиль, бюджеты.
// Все во временных папках (os.tmpdir()), без сети и без данных клиентов; сервер - отдельный процесс на 127.0.0.1.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TPL = path.resolve(HERE, '..', '..', 'skills', 'site-tekst', 'kit');
const { validate } = await import(pathToFileURL(path.join(TPL, 'scripts', 'lib.mjs')).href);
const FP = await import(pathToFileURL(path.join(TPL, 'scripts', 'fetch-page.mjs')).href);
const { loadDep } = await import(pathToFileURL(path.join(TPL, 'scripts', 'deps.mjs')).href);

let pass = 0, fail = 0;
const failures = [], notes = [];
function check(name, ok, detail = '') {
  if (ok) pass++;
  else { fail++; failures.push(`FAIL ${name}${detail ? ': ' + String(detail).slice(0, 700) : ''}`); }
}
const noBom = s => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s);
const rj = f => JSON.parse(noBom(fs.readFileSync(f, 'utf8')));
const wj = (f, o) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(o, null, 2) + '\n'); };
const wt = (f, s) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, s); };
const read = rel => noBom(fs.readFileSync(path.join(TPL, rel), 'utf8'));
const canon = v => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map(key => [key, x[key]])) : x));
const SCHEMAS = {};
const schemaErrors = (name, data) => validate(SCHEMAS[name] ??= rj(path.join(TPL, 'schemas', `${name}.schema.json`)), data);
function run(cwd, args, env = {}) {
  const r = spawnSync(process.execPath, args, { cwd, encoding: 'utf8', env: { ...process.env, ...env }, timeout: 120000 });
  return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '', out: (r.stdout || '') + (r.stderr || '') };
}
const runJson = (cwd, args) => { const r = run(cwd, args); try { r.json = JSON.parse(r.stdout); } catch { r.json = null; } return r; };
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cases-leaders-'));
function mkProject(name) {
  const dir = path.join(tmpRoot, name);
  for (const d of ['scripts', 'rules', 'schemas', 'config']) fs.cpSync(path.join(TPL, d), path.join(dir, d), { recursive: true });
  return dir;
}
// текст заданного числа знаков без пробелов: слова по 6 знаков
const words = n => Array.from({ length: Math.ceil(n / 6) }, (_, i) => `текст${i % 10}`).join(' ');
const page = (title, body, head = '') => `<html><head><title>${title}</title>${head}</head><body>${body}</body></html>`;
let server = null;

try {
  // ================================================================== 1. статусы fetch-page
  {
    // pageStatus напрямую: правило без сети
    const st = o => { const r = FP.pageStatus(o); return r.status + (r.flat ? '+flat' : ''); };
    check('pageStatus: 403, 401, 429, 503 - antibot при любом тексте', ['403', '401', '429', '503'].every(c => st({ http_status: Number(c), text_chars: 9000, headings_count: 9 }) === 'antibot'));
    check('pageStatus: 404 и 500 - closed', st({ http_status: 404, text_chars: 9000, headings_count: 9 }) === 'closed' && st({ http_status: 500, text_chars: 100 }) === 'closed');
    check('pageStatus: заголовок окна «Just a moment...» на короткой странице - antibot', st({ html: '<html><head><title>Just a moment...</title></head></html>', http_status: 200, text_chars: 120, title: 'Just a moment...' }) === 'antibot');
    check('pageStatus: «капча» в заголовке большой страницы - не antibot', st({ html: page('Капча для сайта', `<h1>A</h1><h2>B</h2><p>${words(3000)}</p>`), http_status: 200, text_chars: 3000, headings_count: 2, title: 'Капча для сайта' }) === 'ok');
    check('pageStatus: recaptcha в коде короткой страницы - js_only, не antibot', st({ html: page('Контакты', '<script src="https://www.google.com/recaptcha/api.js"></script><h1>Контакты</h1><p>Адрес</p>'), http_status: 200, text_chars: 900, headings_count: 5, title: 'Контакты' }) === 'js_only');
    check('pageStatus: много текста, один заголовок - ok+flat', st({ html: page('Карточка', `<h1>A</h1><p>${words(2000)}</p>`), http_status: 200, text_chars: 2000, headings_count: 1 }) === 'ok+flat');
    check('pageStatus: пустой корень SPA при тексте вне него - js_only', st({ html: page('App', `<div id="root"></div><div>${words(2000)}</div>`), http_status: 200, text_chars: 2000, headings_count: 3 }) === 'js_only');

    const srvFile = path.join(tmpRoot, 'server.mjs');
    const long = n => Array.from({ length: Math.ceil(n / 6) }, (_, i) => `текст${i % 10}`).join(' ');
    const pages = {
      '/card-recaptcha': [200, page('Карточка', `<style>.grecaptcha-badge{visibility:hidden}</style><h1>Карточка позиции</h1><div class="title">Характеристики</div><p>${long(1800)}</p><form><input type="hidden" name="g-recaptcha-response"><input type="hidden" name="_wpcf7_recaptcha_response"></form>`, '<script src="https://www.google.com/recaptcha/api.js"></script>')],
      '/contacts-cdn': [200, page('Контакты', ['Адрес', 'Телефон', 'Почта', 'Часы', 'Проезд', 'Парковка', 'Реквизиты', 'Форма'].map((h, i) => `<h2>${h}</h2><p>${long(220)}</p>`).join('') + '<script src="//cdnjs.cloudflare.com/ajax/libs/jquery/3.7.1/jquery.min.js"></script>')],
      '/short-form': [200, page('Контакты', '<h1>Контакты</h1><h2>Адрес</h2><p>Город, улица, дом</p><h2>Форма</h2><p>Защищено reCAPTCHA</p>')],
      '/challenge': [200, page('Just a moment...', '<h1>site.example</h1><p>Checking your browser before accessing site.example</p><script src="/cdn-cgi/challenge-platform/h/b/orchestrate/jsch/v1"></script>')],
      '/ddos': [200, page('DDoS-Guard', '<p>Проверка браузера перед переходом на сайт</p>')],
      '/c503': [503, page('Service', `<h1>A</h1><h2>B</h2><p>${long(2000)}</p>`)],
      '/c403': [403, page('Forbidden', '<h1>403</h1>')],
      '/c429': [429, page('Too many', '<h1>429</h1>')],
      '/c401': [401, page('Auth', '<h1>401</h1>')],
      '/c404': [404, page('Нет', '<h1>404</h1>')],
      '/c500': [500, page('Ошибка', '<h1>500</h1>')],
      '/spa': [200, page('App', `<div id="root"></div><div class="seo">${long(2000)}</div>`)],
      '/spa-small': [200, page('App', '<div id="app"></div>')],
      '/long-flat': [200, page('Каталог', `<h1>Каталог</h1><p>${long(20000)}</p>`)],
      '/normal': [200, page('Услуга', ['Первый', 'Второй', 'Третий', 'Четвертый', 'Пятый'].map(h => `<h2>${h}</h2><p>${long(400)}</p>`).join(''))],
      '/js-short': [200, page('Короткая', '<h1>Раздел</h1><h2>A</h2><p>Мало текста</p>')],
      '/js-big': [200, page('Большая', `<h1>Раздел</h1><h2>A</h2><p>${long(1600)}</p>`)],
    };
    wt(srvFile, `import http from 'node:http';
const P = ${JSON.stringify(pages)};
const srv = http.createServer((req, res) => {
  const hit = P[req.url];
  if (!hit) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('no'); }
  res.writeHead(hit[0], { 'content-type': 'text/html; charset=utf-8' }); res.end(hit[1]);
});
srv.listen(0, '127.0.0.1', () => console.log('PORT ' + srv.address().port));
`);
    server = spawn(process.execPath, [srvFile], { stdio: ['ignore', 'pipe', 'pipe'] });
    const port = await new Promise((res, rej) => {
      let buf = '';
      const t = setTimeout(() => rej(new Error('сервер не стартовал')), 10000);
      server.stdout.on('data', d => { buf += d; const m = buf.match(/PORT (\d+)/); if (m) { clearTimeout(t); res(Number(m[1])); } });
      server.on('exit', c => rej(new Error('сервер завершился: ' + c)));
    });
    const base = `http://127.0.0.1:${port}`;
    const F = mkProject('fetch');
    const fetchTo = (u, name, extra = []) => { const out = path.join(F, 'raw', `${name}.json`); const r = run(F, ['scripts/fetch-page.mjs', u, out, ...extra], { FETCH_PAGE_RETRY_MS: '50' }); return { r, j: fs.existsSync(out) ? rj(out) : {}, out }; };
    const s = name => { const x = fetchTo(`${base}/${name}`, name); return { st: x.j.status + (x.j.flat ? '+flat' : ''), x }; };
    const cr = s('card-recaptcha');
    check('fetch-page: карточка с одним h1, reCAPTCHA и Contact Form 7 в коде, 1800 знаков - ok+flat', cr.st === 'ok+flat' && /плоская/.test(cr.x.r.stdout), cr.x.r.out);
    check('fetch-page: контакты на 8 заголовков со скриптом cdnjs.cloudflare.com - ok без flat', s('contacts-cdn').st === 'ok');
    check('fetch-page: короткая страница с «reCAPTCHA» в тексте - js_only, не antibot', s('short-form').st === 'js_only');
    check('fetch-page: страница проверки «Just a moment...» с HTTP 200 - antibot', s('challenge').st === 'antibot');
    check('fetch-page: заглушка DDoS-Guard - antibot', s('ddos').st === 'antibot');
    check('fetch-page: HTTP 503, 403, 429, 401 - antibot', ['c503', 'c403', 'c429', 'c401'].every(n => s(n).st === 'antibot'));
    check('fetch-page: HTTP 404 и 500 - closed', s('c404').st === 'closed' && s('c500').st === 'closed');
    check('fetch-page: пустой корень SPA при 2000 знаков текста вне него - js_only', s('spa').st === 'js_only');
    check('fetch-page: пустая оболочка SPA - js_only', s('spa-small').st === 'js_only');
    check('fetch-page: меньше 1500 знаков при заголовках - js_only, 1600 знаков - ok', s('js-short').st === 'js_only' && s('js-big').st === 'ok');
    const lf = fetchTo(`${base}/long-flat`, 'long-flat');
    const big = (lf.j.sections || []).find(x => x.heading === 'Каталог') || {};
    check('fetch-page: 20000 знаков под одним h1 - ok+flat, секция обрезана с truncated, chars по полному тексту', lf.j.status === 'ok' && lf.j.flat === true && big.truncated === true && big.text.length === FP.SECTION_TEXT_MAX && big.chars > 15000, JSON.stringify({ st: lf.j.status, flat: lf.j.flat, tr: big.truncated, len: (big.text || '').length, chars: big.chars }));
    const nm = s('normal');
    check('fetch-page: обычная страница - ok без flat, секции без truncated', nm.st === 'ok' && !nm.x.j.sections.some(x => 'truncated' in x), JSON.stringify(nm.x.j.sections.map(x => x.heading)));

    // ================================================================== 2. --text-from: отметка обхода, выбор снимка
    const mark = md => `<!-- dom-snapshot: ${md.replace(/\s/g, '').length} -->\n${md}`;
    const mdBig = `# Карточка позиции\n\n${long(3000)}\n\n## Характеристики\n\n${long(500)} [Контакты](${base}/contacts)\n`;
    const mdSmall = '# Раздел\n\nКороткий текст страницы из браузера\n\n## Подраздел\n\nЕще строка текста\n';
    const tf = (name, md) => { const f = path.join(F, 'raw', `${name}.browser.md`); wt(f, md); return fetchTo(`${base}/${name}`, name, ['--text-from', f]); };
    const v1 = tf('v-ok', mark(mdBig));
    check('--text-from: верная отметка обхода - browser, verbatim true, без «не дословно»', v1.j.status === 'browser' && v1.j.verbatim === true && !/не дословно/.test(v1.r.stdout), v1.r.out);
    const v2 = tf('v-nomark', mdBig);
    check('--text-from: без отметки - verbatim false и подсказка про обход', v2.j.status === 'browser' && v2.j.verbatim === false && /не дословно: нет отметки обхода DOM/.test(v2.r.stdout), v2.r.out);
    const v3 = tf('v-short', mark(mdBig).replace(long(500), long(200)));
    check('--text-from: отметка не сходится (сокращено) - verbatim false', v3.j.verbatim === false && /не дословно: знаков \d+ при отметке обхода \d+/.test(v3.r.stdout), v3.r.out);
    const bom = tf('v-bom', String.fromCharCode(0xfeff) + mark(mdSmall));
    check('--text-from: BOM перед отметкой не мешает', bom.j.verbatim === true && bom.j.title === 'Раздел', bom.r.out);
    // статический снимок не меньше браузерного - остается он; js_only становится ok
    const js = fetchTo(`${base}/js-short`, 'keep');
    const prevChars = js.j.text_chars;
    const kf = path.join(F, 'raw', 'keep.browser.md'); wt(kf, mark('# Раздел\n\nМало\n'));
    const kr = run(F, ['scripts/fetch-page.mjs', `${base}/js-short`, js.out, '--text-from', kf]);
    const kj = rj(js.out);
    check('--text-from: статический js_only больше браузерного - оставлен статический, статус ok, html_path цел', js.j.status === 'js_only' && kj.status === 'ok' && kj.browser_smaller === true && kj.text_chars === prevChars && !!kj.html_path && /оставлен статический, статус js_only -> ok/.test(kr.stdout), kr.out + JSON.stringify({ st: kj.status, c: kj.text_chars }));
    const sp = fetchTo(`${base}/spa`, 'spa-repl');
    const sf = path.join(F, 'raw', 'spa-repl.browser.md'); wt(sf, mark(`# Приложение\n\n${long(4000)}\n`));
    run(F, ['scripts/fetch-page.mjs', `${base}/spa`, sp.out, '--text-from', sf]);
    check('--text-from: браузерный снимок больше статического js_only - заменяет', sp.j.status === 'js_only' && rj(sp.out).status === 'browser' && rj(sp.out).verbatim === true);
    const ch = fetchTo(`${base}/challenge`, 'chal-repl');
    const cf = path.join(F, 'raw', 'chal-repl.browser.md'); wt(cf, mark('# Главная\n\nТекст\n'));
    run(F, ['scripts/fetch-page.mjs', `${base}/challenge`, ch.out, '--text-from', cf]);
    check('--text-from: статическая страница проверки (antibot) заменяется браузерным снимком, даже меньшим', ch.j.status === 'antibot' && rj(ch.out).status === 'browser');
    // интеграция (рецензия P7): браузер тоже получил страницу проверки - снимок не заменяется, без прежнего - antibot
    const ch2 = fetchTo(`${base}/challenge`, 'chal-browser');
    const cf2 = path.join(F, 'raw', 'chal-browser.browser.md'); wt(cf2, mark('# Just a moment...\n\nChecking your browser before accessing the site.\n'));
    const cr2 = run(F, ['scripts/fetch-page.mjs', `${base}/challenge`, ch2.out, '--text-from', cf2]);
    const nb = path.join(F, 'raw', 'chal-none.json'), nbf = path.join(F, 'raw', 'chal-none.browser.md'); wt(nbf, mark('# Проверка\n\nВы не робот? Подтвердите, что запросы отправляли вы.\n'));
    const cr3 = run(F, ['scripts/fetch-page.mjs', `${base}/x`, nb, '--text-from', nbf]);
    check('--text-from: браузер тоже получил страницу проверки - прежний снимок не заменен, без прежнего - antibot', ch2.j.status === 'antibot' && rj(ch2.out).status === 'antibot' && !rj(ch2.out).verbatim && /браузер получил страницу проверки/.test(cr2.stdout) && rj(nb).status === 'antibot' && /записан со статусом antibot/.test(cr3.stdout), cr2.out + cr3.out);
    const ob = path.join(F, 'raw', 'old-browser.json');
    wj(ob, { url: `${base}/old`, status: 'browser', text_chars: 99999, sections: [], html_path: '' });
    const of = path.join(F, 'raw', 'old-browser.browser.md'); wt(of, mark(mdSmall));
    run(F, ['scripts/fetch-page.mjs', `${base}/old`, ob, '--text-from', of]);
    check('--text-from: старый браузерный снимок (пересказ) переснимается, не сравнивается', rj(ob).verbatim === true && rj(ob).text_chars < 99999);
    const ou = fetchTo(`${base}/normal`, 'other-url');
    const uf = path.join(F, 'raw', 'other-url.browser.md'); wt(uf, mark(mdSmall));
    run(F, ['scripts/fetch-page.mjs', `${base}/js-big`, ou.out, '--text-from', uf]);
    check('--text-from: статический снимок другого адреса не удерживает файл', rj(ou.out).status === 'browser' && rj(ou.out).url === `${base}/js-big`);

    // обход DOM: код печатает --dom-snippet, он же - экспорт DOM_SNIPPET
    const ds = run(F, ['scripts/fetch-page.mjs', '--dom-snippet']);
    check('--dom-snippet: печатает DOM_SNIPPET, код 0', ds.code === 0 && ds.stdout.trim() === FP.DOM_SNIPPET.trim(), ds.out.slice(0, 200));
    let compiles = true; try { new Function(`return ${FP.DOM_SNIPPET}`); } catch { compiles = false; }
    check('DOM_SNIPPET: выражение-вызов функции, компилируется, без обращений к сети', compiles && /^\(function domSnapshot\(\)/.test(FP.DOM_SNIPPET) && /\)\(\)$/.test(FP.DOM_SNIPPET.trim()) && !/fetch\(|XMLHttpRequest/.test(FP.DOM_SNIPPET));
    const jsdom = await loadDep('jsdom');
    if (jsdom && jsdom.JSDOM) {
      const hidden = long(300);
      const html = page('Тег title страницы', `<header><a href="/">Лого</a><nav><a href="/katalog">Каталог</a><a href="/uslugi">Услуги</a></nav><div>Текст шапки</div></header>
<main><section><header><h2>Заголовок в header секции</h2></header><p>Абзац <b>жирный</b> и <a href="/contacts">Контакты (офис)</a> дальше.</p></section>
<h1>Настоящий заголовок H1</h1><div class="title">Подпись в div</div><ul><li>Пункт 1</li><li>Пункт <span>2</span></li></ul>
<p class="hid">${hidden}</p><p style="display:none">Скрыто стилем</p><script>var secret = "скрипт";</script>
<h3>Третий уровень</h3><p>Строка<br>вторая строка</p><a href="javascript:void(0)">Кнопка</a><a href="https://other.example/x">Чужая</a></main>
<footer><a href="/dostavka">Доставка</a> Подвал ИНН 7700000000</footer>`, '<style>.hid{display:none}</style>');
      const dom = new jsdom.JSDOM(html, { url: `${base}/page`, runScripts: 'outside-only' });
      const out = String(dom.window.eval(FP.DOM_SNIPPET));
      const lines = out.split('\n');
      check('обход DOM: первая строка - отметка с числом знаков без пробелов', /^<!-- dom-snapshot: \d+ -->$/.test(lines[0]) && Number(lines[0].match(/\d+/)[0]) === lines.slice(1).join('\n').replace(/\s/g, '').length, lines[0]);
      check('обход DOM: h1 из тега h1, а не title; h2 из header секции и h3 сохранены', lines.includes('# Настоящий заголовок H1') && lines.includes('## Заголовок в header секции') && lines.includes('### Третий уровень') && !out.includes('# Тег title'), out.slice(0, 600));
      check('обход DOM: ссылки меню и подвала - первой строкой, текст шапки и подвала не берется', lines[1].includes(`[Каталог](${base}/katalog)`) && lines[1].includes(`[Доставка](${base}/dostavka)`) && !out.includes('Текст шапки') && !out.includes('Подвал ИНН'), lines[1]);
      check('обход DOM: скрытое, скрипты и javascript:-ссылки не ломают текст', !out.includes(hidden.slice(0, 30)) && !out.includes('Скрыто стилем') && !out.includes('secret') && out.includes('Кнопка') && !out.includes('javascript:'), out);
      check('обход DOM: строчные теги в абзаце, ссылка внутри, скобки в адресе и br', out.includes(`Абзац жирный и [Контакты (офис)](${base}/contacts) дальше.`) && out.includes('Пункт 2') && lines.includes('Строка') && lines.includes('вторая строка'), out);
      const dm = path.join(F, 'raw', 'dom.browser.md'); wt(dm, out);
      const dj = fetchTo(`${base}/page`, 'dom', ['--text-from', dm]).j;
      check('обход DOM -> fetch-page --text-from: verbatim true, title - h1, ссылки меню, подвала и текста', dj.status === 'browser' && dj.verbatim === true && dj.title === 'Настоящий заголовок H1' && ['/katalog', '/uslugi', '/dostavka', '/contacts'].every(p => dj.links.some(l => l.href === base + p)) && !dj.links.some(l => /other\.example/.test(l.href)), JSON.stringify({ v: dj.verbatim, t: dj.title, l: dj.links }));
      const retold = out.split('\n').filter(l => !l.startsWith('Абзац')).join('\n');
      check('обход DOM: вывод без одного абзаца (пересказ) - verbatim false', FP.domSnapshotCheck(retold).verbatim === false && FP.domSnapshotCheck(out).verbatim === true);
      // интеграция (рецензия P7): у элементов SVG tagName строчный - иконка с <style> и <text> целиком вне снимка
      const svgDom = new jsdom.JSDOM(page('S', '<h1>S</h1><p>Корзина <svg viewBox="0 0 1 1"><style>.cls-1 { fill: #fff; }</style><text>иконка</text></svg> пуста</p><svg><defs><style>.x{fill:red}</style></defs></svg>'), { url: `${base}/s`, runScripts: 'outside-only' });
      const svgOut = String(svgDom.window.eval(FP.DOM_SNIPPET));
      check('обход DOM: inline-SVG (строчный tagName) пропускается целиком - ни CSS, ни текста иконки', /Корзина/.test(svgOut) && /пуста/.test(svgOut) && !/иконка|cls-1|fill/.test(svgOut) && FP.domSnapshotCheck(svgOut).verbatim === true, svgOut);
      const hugeDom = new jsdom.JSDOM(page('X', `<h1>X</h1>${Array.from({ length: 400 }, (_, i) => `<p>${long(120)} ${i}</p>`).join('')}`), { url: `${base}/x`, runScripts: 'outside-only' });
      const hugeOut = String(hugeDom.window.eval(FP.DOM_SNIPPET));
      check('обход DOM: длинная страница обрезается по строке до 20000 знаков, отметка сходится', hugeOut.length < 20100 && FP.domSnapshotCheck(hugeOut).verbatim === true, hugeOut.length);
    } else notes.push('пропущено: jsdom не найден (npm install в корне шаблона) - обход DOM в jsdom не проверен');
  }

  // ================================================================== 3. measure-blocks
  {
    const M = mkProject('measure');
    const raw = f => path.join(M, 'work', 'competitors', 'raw', f);
    const sec = (level, heading, chars) => ({ level, heading, chars, words: 1, text: 'т' });
    wj(path.join(M, 'work', 'competitors', 'competitors.json'), { verified_at: 'x', competitors: [
      { domain: 'a.example', status: 'ok', source: 'analysis', pages: [
        { type: 'home', url: 'https://a.example/', raw: 'work/competitors/raw/a.example/home.json', status: 'ok' },
        { type: 'product', url: 'https://a.example/p', raw: 'work/competitors/raw/a.example/product-1.json', status: 'ok' },
        { type: 'category', url: 'https://a.example/c', raw: 'work/competitors/raw/a.example/category-1.json', status: 'browser' }] },
      { domain: 'b.example', status: 'ok', source: 'analysis', pages: [
        { type: 'home', url: 'https://b.example/', raw: 'work/competitors/raw/b.example/home.json', status: 'ok' },
        { type: 'category', url: 'https://b.example/c', raw: 'work/competitors/raw/b.example/category-1.json', status: 'browser' }] },
      { domain: 'c.example', status: 'ok', source: 'serp', pages: [
        { type: 'category', url: 'https://c.example/c', raw: 'work/competitors/raw/c.example/category-1.json', status: 'browser' }] }] });
    wj(raw('a.example/home.json'), { url: 'https://a.example/', status: 'ok', sections: [sec(0, 'меню', 900), sec(1, 'H1', 100), sec(2, 'A', 300), sec(2, 'B', 500), sec(2, 'C', 700)] });
    wj(raw('b.example/home.json'), { url: 'https://b.example/', status: 'ok', flat: true, sections: [sec(1, 'H1', 30000)] });
    wj(raw('a.example/product-1.json'), { url: 'https://a.example/p', status: 'ok', flat: true, sections: [sec(1, 'Товар', 20000)] });
    wj(raw('a.example/category-1.json'), { url: 'https://a.example/c', status: 'browser', verbatim: false, sections: [sec(1, 'Пересказ', 500), sec(2, 'Выдумано', 400)] });
    wj(raw('b.example/category-1.json'), { url: 'https://b.example/c', status: 'browser', verbatim: true, sections: [sec(1, 'Кат', 100), sec(2, 'A', 200), sec(2, 'B', 300)] });
    // интеграция (рецензия P7): старый браузерный снимок без поля verbatim - тоже пересказ (как в 02-page-classifier п.4)
    wj(raw('c.example/category-1.json'), { url: 'https://c.example/c', status: 'browser', sections: [sec(1, 'Старый пересказ', 500), sec(2, 'Без отметки', 400), sec(2, 'Еще', 300), sec(2, 'И еще', 300)] });
    const r = run(M, ['scripts/measure-blocks.mjs']);
    const sm = rj(path.join(M, 'work', 'competitors', 'measurements.summary.json'));
    check('measure-blocks: плоская главная в pages, но не в h2_count и section_chars', r.code === 0 && sm.home.pages === 2 && canon(sm.home.h2_count) === canon({ median: 3, n: 1 }) && sm.home.section_chars.n === 4, r.out + JSON.stringify(sm.home));
    check('measure-blocks: у типа только плоские страницы - h2_count median null, n 0', canon(sm.product.h2_count) === canon({ median: null, n: 0 }) && sm.product.section_chars.n === 0, JSON.stringify(sm.product));
    check('measure-blocks: пересказ браузера (verbatim false и старый снимок без поля) вне замера, дословный browser - в замере', sm.category.pages === 1 && canon(sm.category.h2_count) === canon({ median: 2, n: 1 }), JSON.stringify(sm.category));
    check('measure-blocks: вывод - число плоских и пересказов, «нет замера» у h2', /плоских страниц \(без h2 и секций в сводке\): 2/.test(r.stdout) && /пересказов браузера \(browser без verbatim: true, не в замере\): 2/.test(r.stdout) && /product: .*h2 медиана нет замера \(страниц 0\)/.test(r.stdout), r.stdout);
    const csvText = fs.readFileSync(path.join(M, 'work', 'competitors', 'measurements.csv'), 'utf8');
    check('measure-blocks: CSV без строк пересказа, заголовок CSV прежний', !csvText.includes('Выдумано') && !csvText.includes('Без отметки') && csvText.startsWith('domain,type,url,status,level,heading,chars,words\n'));
    wj(path.join(M, 'work', 'sitemap.json'), { pages: [{ slug: 'home', url: '/', type: 'home', subject: 'Главная', level: 0, status: 'planned' }, { slug: 'c1', url: '/c1', type: 'category', subject: 'Кат', level: 1, status: 'planned' }] });
    const ps = runJson(M, ['scripts/prep-args.mjs', '--snapshots', '--snapshot-types', 'category']);
    check('prep-args --snapshots: пересказы браузера (без verbatim: true) названы в сводке, снимки в списке остаются', ps.code === 0 && ps.json?.snapshots?.length === 3 && /пересказов браузера \(browser без verbatim: true\): 2/.test(ps.stderr), ps.out);
    const r2 = run(M, ['scripts/measure-blocks.mjs', '--if-stale']);
    check('measure-blocks --if-stale: свежий замер - пропуск', r2.code === 0 && /замер свежий, пропуск/.test(r2.stdout), r2.out);
  }

  // ================================================================== 4. prep-args: info_other и --check-degraded
  {
    const Q = mkProject('prep');
    const map = [['home', 'home'], ['c1', 'category'], ['dostavka', 'info_other', 'Доставка и оплата'], ['garantiya', 'info_other', 'Гарантия'],
      ['politika', 'info_other', 'Политика', 'skip', 'legal'], ['poisk', 'info_other', 'Поиск', 'planned', 'search'], ['korzina', 'info_other', 'Корзина', 'planned', 'cart'], ['dostavka-2', 'info_other', 'Доставка и оплата']];
    wj(path.join(Q, 'work', 'sitemap.json'), { pages: map.map(([slug, type, subject, status, ui]) => ({ slug, url: `/${slug}`, type, subject: subject || slug, level: 1, status: status || 'planned', ...(ui ? { ui_role: ui } : {}) })) });
    const p0 = runJson(Q, ['scripts/prep-args.mjs']);
    check('prep-args: info_other - названия страниц без skip и ui_role, без повторов', p0.code === 0 && canon(p0.json.info_other) === canon(['Доставка и оплата', 'Гарантия']) && p0.json.type_pages.info_other === 5 && /info_other для поиска у конкурентов: Доставка и оплата; Гарантия/.test(p0.stderr), p0.out);
    const p1 = runJson(Q, ['scripts/prep-args.mjs', '--types', 'home,category']);
    check('prep-args --types без info_other - поля info_other нет', p1.code === 0 && !('info_other' in p1.json), p1.out);
    wj(path.join(Q, 'work', 'sitemap.json'), { pages: [['home', 'home'], ['poisk', 'info_other', 'search']].map(([slug, type, ui]) => ({ slug, url: `/${slug}`, type, subject: slug, level: 1, status: 'planned', ...(ui ? { ui_role: ui } : {}) })) });
    const p2 = runJson(Q, ['scripts/prep-args.mjs']);
    check('prep-args: info_other только служебные (ui_role) - поля нет, вывод как раньше', p2.code === 0 && canon(p2.json) === canon({ types: ['home', 'info_other'], type_pages: { home: 1, info_other: 1 } }), p2.out);

    // --check-degraded: работает без карты
    const D = mkProject('degraded');
    const chk = () => runJson(D, ['scripts/prep-args.mjs', '--check-degraded']);
    const c0 = chk();
    check('--check-degraded: нет competitors.json - degraded null, код 0', c0.code === 0 && c0.json && c0.json.degraded === null && /нет work\/competitors\/competitors.json/.test(c0.json.why), c0.out);
    const home = d => path.join(D, 'work', 'competitors', 'raw', d, 'home.json');
    const comp = (list, degraded = 'no_competitors') => wj(path.join(D, 'work', 'competitors', 'competitors.json'), { verified_at: 'x', ...(degraded ? { degraded } : {}), competitors: list });
    wj(home('d1.example'), { url: 'https://d1.example/', status: 'closed', http_status: 404 });
    wj(home('d2.example'), { url: 'https://d2.example/', status: 'antibot', http_status: 403 });
    wt(home('d2.example').replace(/\.json$/, '.browser.md'), '<!-- dom-snapshot: 0 -->\n');
    wj(home('d3.example'), { url: 'https://d3.example/', status: 'browser', http_status: 0, text_chars: 120 });
    const base3 = [{ domain: 'd1.example', status: 'closed', source: 'analysis' }, { domain: 'd2.example', status: 'closed', source: 'analysis' }, { domain: 'd3.example', status: 'closed', source: 'serp' },
      { domain: 'agg.example', status: 'aggregator', source: 'serp' }, { domain: 'noname', status: 'excluded', source: 'analysis' }];
    comp(base3, null);
    check('--check-degraded: верификатор не отметил degraded - null', chk().json?.degraded === null && /не отметил/.test(chk().json.why));
    comp(base3);
    const c2 = chk();
    check('--check-degraded: все ответили (404, 403 с браузерным следом, пустой браузерный снимок), агрегатор и excluded не в счет - no_competitors', c2.json?.degraded === 'no_competitors', c2.out);
    // интеграция (рецензия P7, K13): браузерный снимок с текстом - сайт доступен; error при сохраненной браузером странице
    // ошибки - сеть не ответила, это стоп, а не деградация
    wj(home('d3.example'), { url: 'https://d3.example/', status: 'browser', http_status: 0, text_chars: 4000 });
    const cb = chk();
    check('--check-degraded: браузерный снимок главной с текстом - сайт доступен, null', cb.json?.degraded === null && /d3\.example: браузер снял главную с текстом \(4000/.test(cb.json.why), cb.out);
    wj(home('d3.example'), { url: 'https://d3.example/', status: 'browser', http_status: 0, text_chars: 120 });
    wj(home('d6.example'), { url: 'https://d6.example/', status: 'error', http_status: 0 });
    wt(home('d6.example').replace(/\.json$/, '.browser.md'), '<!-- dom-snapshot: 10 -->\nThis site can t be reached\n');
    comp([...base3, { domain: 'd6.example', status: 'closed', source: 'analysis' }]);
    const ce = chk();
    check('--check-degraded: error при браузерном следе - сеть не ответила, null', ce.json?.degraded === null && /d6\.example: сайт не ответил/.test(ce.json.why), ce.out);
    comp(base3);
    fs.rmSync(home('d2.example').replace(/\.json$/, '.browser.md'));
    const c3 = chk();
    check('--check-degraded: antibot без браузерного снимка - сбой среды, null с доменом в причине', c3.json?.degraded === null && /d2\.example: статус antibot без браузерного снимка/.test(c3.json.why), c3.out);
    wt(home('d2.example').replace(/\.json$/, '.browser.md'), '<!-- dom-snapshot: 0 -->\n');
    wj(home('d4.example'), { url: 'https://d4.example/', status: 'error', http_status: 0 });
    comp([...base3, { domain: 'd4.example', status: 'closed', source: 'analysis' }]);
    const c4 = chk();
    check('--check-degraded: сайт не ответил (error, http 0) - null', c4.json?.degraded === null && /d4\.example: сайт не ответил/.test(c4.json.why), c4.out);
    comp([...base3, { domain: 'd5.example', status: 'closed', source: 'analysis' }]);
    check('--check-degraded: нет снимка главной - null', /d5\.example: нет снимка главной/.test(chk().json?.why || ''));
    comp([...base3, { domain: 'd6.example', status: 'ok', source: 'analysis' }]);
    check('--check-degraded: есть конкурент ok - null', /d6\.example доступен/.test(chk().json?.why || ''));
    comp([{ domain: 'agg.example', status: 'aggregator', source: 'serp' }]);
    check('--check-degraded: только агрегаторы - кандидатов нет, null', chk().json?.degraded === null && /кандидатов нет/.test(chk().json.why));
    wj(path.join(D, 'work', 'competitors', 'competitors.json'), { verified_at: 'x', degraded: 'no_competitors', competitors: [{ domain: 'd1.example', status: 'closed', source: 'analysis', pages: [{ type: 'home', url: 'https://d1.example/', raw: 'work/competitors/raw/d1.example/home.json', status: 'closed' }] }] });
    check('--check-degraded: путь главной из pages[].raw', chk().json?.degraded === 'no_competitors');
  }

  // ================================================================== 5. wf-02 с подставным agent
  {
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const SRC = read('workflows/wf-02-competitors.js');
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    async function runWf(args, impl) {
      const src = SRC.replace(/^export const meta\s*=/m, 'const meta =');
      const calls = [], logs = [];
      let active = 0, maxBrowser = 0, t = 0;
      const agent = async (prompt, opts) => {
        const c = { label: opts.label, model: opts.model, prompt, start: ++t, end: 0 };
        calls.push(c);
        const isBrowser = /^inventory:browser:/.test(opts.label);
        if (isBrowser) { active++; maxBrowser = Math.max(maxBrowser, active); }
        try { await sleep(/^inventory:/.test(opts.label) ? 15 : 2); return await impl(opts.label, prompt); } finally { if (isBrowser) active--; c.end = ++t; }
      };
      const parallel = fns => Promise.all(fns.map(f => f()));
      const fn = new AsyncFunction('args', 'agent', 'parallel', 'phase', 'log', 'pipeline', 'workflow', src);
      try { return { r: await fn(args, agent, parallel, () => {}, m => logs.push(m), null, null), calls, logs, maxBrowser }; } catch (e) { return { e, calls, logs, maxBrowser }; }
    }
    const baseArgs = { root: '/fake', model: 'STRONG', model_light: 'LIGHT' };
    const labels = x => x.calls.map(c => c.label);
    const typesOf = p => { const m = String(p).match(/types=(\[[^\]]*\])/); return m ? JSON.parse(m[1]) : []; };
    const agg = (l, p) => ({ results: typesOf(p).map(tp => ({ type: tp, market_blocks: 1, differentiation_blocks: 2, order: ['hero'] })) });
    const ext = (l, p) => { const m = String(p).match(/items=(\[.*\])\./); const items = m ? JSON.parse(m[1]) : []; return { results: items.map(i => ({ raw: i.raw, file: i.raw.replace(/\.json$/, '.blocks.json'), blocks: 3 })) }; };
    const verify = kept => ({ total_candidates: kept.length, kept, excluded: [], method: 'm' });

    // лендинг: только главная - без инвентаризации
    const land = await runWf({ ...baseArgs, types: ['home'], type_pages: { home: 1 } }, (l, p) => (l === 'verify' ? verify(['d1.example', 'd2.example']) : l.startsWith('extract:') ? ext(l, p) : l.startsWith('aggregate:') ? agg(l, p) : null));
    check('wf-02 лендинг (только home): инвентаризатор не зовется, главные разбираются', !land.e && !labels(land).some(l => l.startsWith('inventory:')) && labels(land).some(l => l.startsWith('extract:')) && labels(land).includes('aggregate:home') && land.logs.some(m => /инвентаризация не нужна/.test(m)), land.e ? land.e.message : labels(land).join(', '));
    const noNames = await runWf({ ...baseArgs, types: ['home', 'info_other'], type_pages: { home: 1, info_other: 2 } }, (l, p) => (l === 'verify' ? verify(['d1.example']) : l.startsWith('extract:') ? ext(l, p) : l.startsWith('aggregate:') ? agg(l, p) : null));
    check('wf-02: home + info_other без названий - инвентаризации нет (info_other по соседним типам)', !noNames.e && !labels(noNames).some(l => l.startsWith('inventory:')), noNames.e ? noNames.e.message : labels(noNames).join(', '));

    // info_other с названиями из args и из prep-args
    const named = await runWf({ ...baseArgs, types: ['home', 'info_other'], type_pages: { home: 1, info_other: 2 }, info_other: ['Доставка и оплата', 'Гарантия'] }, (l, p) => (l === 'verify' ? verify(['d1.example']) : l.startsWith('inventory:') ? { domain: 'd1.example', pages: [{ type: 'info_other', url: 'https://d1.example/delivery', status: 'ok', raw: 'work/competitors/raw/d1.example/info_other-1.json' }], browser: [], types_missing: [] } : l.startsWith('extract:') ? ext(l, p) : l.startsWith('aggregate:') ? agg(l, p) : null));
    const inv = named.calls.find(c => c.label === 'inventory:d1.example');
    check('wf-02: info_other с названиями - классификатор получает types [info_other], названия и mode=static', !named.e && inv && inv.prompt.includes('types=["info_other"]') && inv.prompt.includes('info_other=["Доставка и оплата","Гарантия"]') && inv.prompt.includes('mode=static') && inv.prompt.includes('prompts/02-page-classifier.md'), named.e ? named.e.message : inv && inv.prompt.slice(-200));
    const aggCall = named.calls.find(c => c.label.startsWith('aggregate:'));
    check('wf-02: info_other со снимками - не в no_data агрегатора', aggCall && /no_data=\[\]/.test(aggCall.prompt), aggCall && aggCall.prompt.slice(-200));
    const viaPrep = await runWf({ ...baseArgs, types: ['home', 'info_other'] }, (l, p) => (l === 'prep-args' ? { ok: true, type_pages: [{ type: 'home', pages: 1 }, { type: 'info_other', pages: 1 }], info_other: ['Гарантия'] } : l === 'verify' ? verify(['d1.example']) : l.startsWith('inventory:') ? { domain: 'd1.example', pages: [], types_missing: ['info_other'] } : l.startsWith('extract:') ? ext(l, p) : l.startsWith('aggregate:') ? agg(l, p) : null));
    const inv2 = viaPrep.calls.find(c => c.label === 'inventory:d1.example');
    check('wf-02: info_other из вывода prep-args доходит до классификатора', !viaPrep.e && inv2 && inv2.prompt.includes('info_other=["Гарантия"]') && /info_other/.test(viaPrep.calls.find(c => c.label === 'prep-args').prompt), viaPrep.e ? viaPrep.e.message : labels(viaPrep).join(', '));

    // браузерный добор: после параллельной инвентаризации, строго по одному, аналитик каталогов после
    const pg = (d, type, n, status = 'ok') => ({ type, url: `https://${d}/${type}-${n}`, status, raw: `work/competitors/raw/${d}/${type}-${n}.json` });
    const bq = await runWf({ ...baseArgs, types: ['home', 'category', 'service'], type_pages: { home: 1, category: 3, service: 3 }, catalog: true }, (l, p) => {
      if (l === 'verify') return verify(['d1.example', 'd2.example', 'd3.example']);
      if (l === 'inventory:d1.example') return { domain: 'd1.example', pages: [pg('d1.example', 'service', 1)], browser: [pg('d1.example', 'category', 1)], types_missing: [] };
      if (l === 'inventory:d2.example') return { domain: 'd2.example', pages: [], browser: [pg('d2.example', 'category', 1), pg('d2.example', 'service', 1)], types_missing: [] };
      if (l === 'inventory:d3.example') return { domain: 'd3.example', pages: [pg('d3.example', 'category', 1), pg('d3.example', 'service', 1)], types_missing: [] };
      if (l === 'inventory:browser:d1.example') return { domain: 'd1.example', pages: [pg('d1.example', 'category', 1, 'browser')], browser: [], types_missing: [] };
      if (l === 'inventory:browser:d2.example') return { domain: 'd2.example', pages: [pg('d2.example', 'category', 1, 'browser')], browser: [], types_missing: ['service'] };
      if (l === 'catalog-analyst') return { domains_done: ['d1.example'], domains_failed: [] };
      if (l.startsWith('extract:')) return ext(l, p);
      if (l.startsWith('aggregate:')) return agg(l, p);
      return null;
    });
    const B = bq.calls.filter(c => /^inventory:browser:/.test(c.label));
    const S = bq.calls.filter(c => /^inventory:d/.test(c.label));
    const cat = bq.calls.find(c => c.label === 'catalog-analyst');
    check('wf-02: браузерный добор только у конкурентов со списком browser, режим mode=browser и items', !bq.e && B.length === 2 && B.every(c => c.prompt.includes('mode=browser') && c.prompt.includes('items=[')) && !B.some(c => c.label.endsWith('d3.example')) && B[1].prompt.includes('"url":"https://d2.example/service-1"'), bq.e ? bq.e.message : B.map(c => c.label).join(', '));
    check('wf-02: добор после всей параллельной инвентаризации и строго по одному', bq.maxBrowser === 1 && B.every(b => S.every(s => s.end < b.start)) && B[0].end < B[1].start, JSON.stringify({ max: bq.maxBrowser, S: S.map(c => [c.start, c.end]), B: B.map(c => [c.start, c.end]) }));
    check('wf-02: аналитик каталогов стартует после браузерного добора', cat && B.every(b => b.end < cat.start), JSON.stringify({ cat: cat && cat.start, B: B.map(c => c.end) }));
    const exItems = bq.calls.filter(c => c.label.startsWith('extract:')).flatMap(c => JSON.parse(c.prompt.match(/items=(\[.*\])\./)[1]).map(i => i.raw));
    check('wf-02: в разбор идут снимки добора, недобранная страница - нет', exItems.includes('work/competitors/raw/d1.example/category-1.json') && exItems.includes('work/competitors/raw/d2.example/category-1.json') && !exItems.includes('work/competitors/raw/d2.example/service-1.json') && exItems.includes('work/competitors/raw/d1.example/service-1.json'), exItems.join(', '));
    check('wf-02: итог - browser_pass и missing после добора', bq.r && bq.r.browser_pass === 2 && canon(bq.r.inventories.find(i => i.domain === 'd2.example').missing) === canon(['service']) && bq.r.degraded === null, JSON.stringify(bq.r && bq.r.inventories));
    check('wf-02: добор - роль inventory, легкая модель', B.every(c => c.model === 'LIGHT'));

    // деградация «без конкурентов»
    const deg = (check2, v = { ...verify([]), degraded: 'no_competitors' }) => runWf({ ...baseArgs, types: ['home', 'category', 'info_about'], type_pages: { home: 1, category: 3, info_about: 1 }, catalog: true }, (l, p) => (l === 'verify' ? v : l === 'prep-args' ? check2 : l.startsWith('aggregate:') ? agg(l, p) : null));
    const d1 = await deg({ ok: true, degraded: 'no_competitors', reason: 'все кандидаты ответили, но недоступны' });
    const aggs = d1.calls.filter(c => c.label.startsWith('aggregate:'));
    check('wf-02 без конкурентов: проверка скриптом, без инвентаризации, разбора и каталогов', !d1.e && labels(d1).includes('prep-args') && d1.calls.find(c => c.label === 'prep-args').prompt.includes('prep-args.mjs --check-degraded') && !labels(d1).some(l => /^(inventory|extract):|^catalog-analyst$/.test(l)), d1.e ? d1.e.message : labels(d1).join(', '));
    check('wf-02 без конкурентов: агрегатор с degraded=no_competitors, no_data - все типы группы', aggs.length >= 2 && aggs.every(c => c.prompt.includes('degraded=no_competitors') && JSON.stringify(typesOf(c.prompt)) === (c.prompt.match(/no_data=(\[[^\]]*\])/) || [])[1]), aggs.map(c => c.prompt.slice(-160)).join(' | '));
    check('wf-02 без конкурентов: итог degraded и строка лога', d1.r && d1.r.degraded === 'no_competitors' && d1.logs.some(m => /без конкурентов/.test(m)), JSON.stringify(d1.r && d1.r.degraded));
    const d2 = await deg({ ok: true, degraded: '', reason: 'd2.example: сайт не ответил (сеть) - похоже на сбой среды' });
    check('wf-02: деградация не подтверждена скриптом - ошибка с причиной, агрегатор не зовется', !!d2.e && /нет доступных конкурентов: d2\.example: сайт не ответил/.test(d2.e.message) && !labels(d2).some(l => l.startsWith('aggregate:')), d2.e ? d2.e.message : 'нет ошибки');
    const d3 = await deg(null);
    check('wf-02: проверка деградации без ответа - ошибка', !!d3.e && /проверка деградации не отработала/.test(d3.e.message), d3.e ? d3.e.message : 'нет ошибки');
    const d4 = await deg({ ok: true, degraded: 'no_competitors' }, verify([]));
    check('wf-02: верификатор не отметил degraded - ошибка без проверки скриптом (сбой среды: новый запуск без resumeFromRunId)', !!d4.e && /нет доступных конкурентов: верификатор не отметил/.test(d4.e.message) && !labels(d4).includes('prep-args'), d4.e ? d4.e.message : 'нет ошибки');
    const d5 = await deg({ ok: true, degraded: 'no_competitors' }, null);
    check('wf-02: верификатор без ответа - ошибка', !!d5.e && /верификатор не вернул ответ/.test(d5.e.message), d5.e ? d5.e.message : 'нет ошибки');

    // роли: прежние 6 ролей wf-02 плюс роли этапа КФ (программа 05.10 §5: все light), у каждого вызова роль из таблицы
    const i0 = SRC.indexOf('const ROLES = {');
    const roles = new Function(`return (${SRC.slice(SRC.indexOf('{', i0), SRC.indexOf('\n}', i0) + 2)})`)();
    check('wf-02: таблица ROLES - прежние роли и роли этапа КФ (light)', canon(roles) === canon({ 'prep-args': 'light', verify: 'light', inventory: 'light', 'catalog-analyst': 'light', aggregate: 'strong', extract: 'strong', scout: 'light', rank: 'light', capture: 'light', 'kf-observe': 'light', 'kf-normalize': 'light', 'kf-recheck': 'light', matrix: 'light' }), JSON.stringify(roles));
    const LABELS = [[/^prep-args$/, 'prep-args'], [/^verify$/, 'verify'], [/^inventory:/, 'inventory'], [/^extract:/, 'extract'], [/^aggregate:/, 'aggregate'], [/^catalog-analyst$/, 'catalog-analyst'],
      [/^scout$/, 'scout'], [/^rank(:check)?$/, 'rank'], [/^capture:/, 'capture'], [/^kf-observe:/, 'kf-observe'], [/^kf-normalize$/, 'kf-normalize'], [/^kf-recheck:/, 'kf-recheck'], [/^matrix(:(stale|candidates(:2)?|status))?$/, 'matrix']];
    const all = [...land.calls, ...named.calls, ...viaPrep.calls, ...bq.calls, ...d1.calls];
    const roleOf = l => (LABELS.find(([re]) => re.test(l)) || [])[1];
    const off = all.filter(c => !roleOf(c.label) || c.model !== (roles[roleOf(c.label)] === 'light' ? 'LIGHT' : 'STRONG')).map(c => `${c.label}=${c.model}`);
    check('wf-02: у каждого вызова роль из таблицы и модель своего яруса (метки workflow-models)', !off.length, off.join(', '));
  }

  // ================================================================== 6. схемы
  {
    const pt = { type: 'home', sources: [], market_blocks: [{ id: 'hero', name: 'Первый экран', role: 'hero', reader_question: 'Что это и для кого', pattern: 'hero-split', elements: [{ kind: 'h1', count: '1', chars: { min: 0, median: 0, max: 0 } }], seen_at: [] }], differentiation_blocks: [], recommended_order: ['hero', 'cta-final'], cliches_to_avoid: [], notes: 'без конкурентов: по разделам анализа' };
    const e1 = schemaErrors('page-type', pt);
    check('page-type: тип без конкурентов (sources [], notes «без конкурентов») проходит схему', !e1.length, e1.join('; '));
    const e2 = schemaErrors('page-type', { ...pt, sources: [{ domain: 'a.example', url: 'https://a.example/', raw: 'r', status: 'weird' }] });
    check('page-type: статус источника по-прежнему из списка', e2.some(e => /status/.test(e)), e2.join('; '));
    const e3 = schemaErrors('page-type', { ...pt, sources: [{ domain: 'a.example' }] });
    check('page-type: у источника обязательны url, raw, status', e3.length >= 3, e3.join('; '));
    const psc = rj(path.join(TPL, 'schemas', 'page-type.schema.json'));
    check('page-type: описание sources говорит про «без конкурентов»', /без конкурентов/.test(psc.properties.sources.description || ''));
    const cp = { verified_at: 'x', degraded: 'no_competitors', competitors: [{ domain: 'a.example', status: 'closed', source: 'analysis', pages: [{ url: 'u', type: 'home', raw: 'r', status: 'ok', flat: true, verbatim: true }] }] };
    const e4 = schemaErrors('competitors', cp);
    check('competitors: degraded no_competitors, flat и verbatim у страницы - проходят', !e4.length, e4.join('; '));
    check('competitors: degraded - только no_competitors', schemaErrors('competitors', { ...cp, degraded: 'partial' }).some(e => /degraded/.test(e)));
    check('competitors: без degraded - как раньше', !schemaErrors('competitors', { verified_at: 'x', competitors: [] }).length);
  }

  // ================================================================== 7. промты 02-* и 03-*
  {
    const T = f => read(f);
    const ver = T('prompts/02-competitor-verifier.md'), cls = T('prompts/02-page-classifier.md'), ext = T('prompts/02-block-extractor.md');
    const agg = T('prompts/02-type-aggregator.md'), aud = T('prompts/03-type-auditor.md'), fix = T('prompts/03-type-fixer.md');
    check('02-competitor-verifier: обход DOM из --dom-snippet инструментом javascript_tool своей вкладкой', ver.includes('node scripts/fetch-page.mjs --dom-snippet') && ver.includes('`javascript_tool`') && ver.includes('`tabs_create`') && ver.includes('tabId'));
    check('02-competitor-verifier: get_page_text и read_page не годятся, пересказ запрещен, h1 не из title', ver.includes('`get_page_text` и `read_page` не годятся') && ver.includes('Пересказ, сокращение, свои заголовки') && ver.includes('`#` - h1 страницы, а не тег title'));
    check('02-competitor-verifier: статический снимок не меньше браузерного остается, «не дословно» - сохранить заново', ver.includes('оставит статический снимок, если он не меньше') && ver.includes('«не дословно»'));
    check('02-competitor-verifier: деградация - все ответили, след .browser.md; сбой среды - без degraded', ver.includes('"degraded": "no_competitors"') && ver.includes('`.browser.md` все равно') && ver.includes('Сбой среды') && ver.includes('`degraded`\n   не ставь') && /"degraded":""/.test(ver));
    check('02-page-classifier: параметры info_other и mode, браузер в режиме static не открывается', cls.includes('`info_other` - названия страниц проекта') && cls.includes('`mode` - `static`') && cls.includes('браузер не открывай') && cls.includes('по одному конкуренту за раз'));
    check('02-page-classifier: браузерный добор mode=browser по п.3 верификатора, старый пересказ переснимается', cls.includes('## Браузерный добор (mode=browser)') && cls.includes('п.3\n`prompts/02-competitor-verifier.md`') && cls.includes('без `"verbatim": true`') && /"browser":\[\{"type":"","url":"","raw":""\}\]/.test(cls));
    check('02-page-classifier: главная не ищется (сняла верификация)', cls.includes('главную уже снял верификатор'));
    check('02-block-extractor: финальный призыв - cta-final, не cta', ext.includes('cta-final (финальный призыв)') && !/\bfaq, cta, contacts\b/.test(ext));
    check('02-block-extractor: flat и truncated - по html_path, verbatim false - без цитат и partial', ext.includes('`flat: true`') && ext.includes('`truncated: true`') && ext.includes('`verbatim: false`') && ext.includes('`partial: true`'));
    check('02-type-aggregator: лендинг - что входит, цена или от чего зависит, как работаем, форма cta-final', agg.includes('«что входит»') && agg.includes('«сколько стоит или от чего зависит цена»') && agg.includes('«как работаем»') && agg.includes('финальная форма `cta-final`') && agg.includes('«правило лендинга»'));
    check('02-type-aggregator: самопроверка по правилам аудитора (reader_question, длина, short_set, клише)', agg.includes('## Самопроверка перед записью') && agg.includes('Один `reader_question` - один блок') && agg.includes('`h2_count`') && agg.includes('`short_set` не длиннее 8') && agg.includes('до 25 оборотов'));
    check('02-type-aggregator: без конкурентов - sources [], notes «без конкурентов:», пустые цитаты, chars 0', agg.includes('## Без конкурентов (`degraded=no_competitors`)') && agg.includes('`sources: []`') && agg.includes('«без конкурентов:»') && agg.includes('«Обязательные блоки у рынка»') && agg.includes('{0, 0, 0}') && agg.includes('`evidence`, `examples`'));
    check('02-type-aggregator: финальный призыв cta-final, неопубликованные причины не берутся', agg.includes('финальный\n  призыв - всегда `cta-final`') && agg.includes('«на\n   страницу не идут»'));
    check('03-type-auditor: сверка цитат после нормализации (е с точками, тире, пробелы), grep по JSON не годится', aud.includes('## Сверка цитат') && aud.includes('е с точками = е') && aud.includes('любое тире') && aud.includes('неразрывный пробел') && aud.includes('grep по JSON снимка\nне годится') && aud.includes('`truncated`'));
    check('03-type-auditor: порог доказательств как у агрегатора', aud.includes('от 2+ доменов (или от 1, если у типа всего 2 домена-источника)') && agg.includes('(или у 1 из 2, если конкурентов по типу всего два)'));
    check('03-type-auditor: лендинг без обязательных блоков - major; правило лендинга без grep', aud.includes('«сколько стоит или от чего зависит цена», «как работаем» или финальной формы = major') && aud.includes('`source` «правило лендинга» - без grep'));
    check('03-type-auditor: id cta-final, cta старых прогонов - синоним, не находка', aud.includes('`cta-final`, `contacts`') && aud.includes('`cta` в файлах старых прогонов - синоним `cta-final`, не находка') && !/`hero`, `faq`, `cta`, `contacts`/.test(aud));
    check('03-type-auditor: нет замера h2 - предел 10; тип без конкурентов - без проверок снимков, выдуманные цитаты - blocker', aud.includes('`h2_count.median` пустой - предел 10') && aud.includes('## Тип без конкурентов') && aud.includes('цитата без снимка выдумана'));
    // интеграция (рецензия P7): блоки формы без конкурентов - рыночные с source «без конкурентов: форма», аудитор их
    // принимает без ссылки на раздел анализа; «не дословно» - не больше 2 попыток
    check('без конкурентов: агрегатор кладет блоки формы в market_blocks с source «без конкурентов: форма», аудитор их принимает', agg.includes('Блоки формы - в `market_blocks`,\n`source` «без конкурентов: форма»') && aud.includes('или с `source` «без конкурентов: форма» (иначе major)'));
    check('02-competitor-verifier: «не дословно» - не больше 2 попыток, потом verbatim: false; окно шириной компьютера (h1 в мобильной верстке скрыт)', ver.includes('больше 2 попыток, затем снимок остается с `verbatim: false`') && ver.includes('Окно - шириной\n     компьютера (`resize_window`'));
    check('03-type-fixer: cta старых прогонов не переименовывать, нормализация при сверке, нет замера - 10, без конкурентов', fix.includes('`cta` в файлах старых прогонов не переименовывай') && fix.includes('е с точками = е') && fix.includes('нет - 10') && fix.includes('«без конкурентов»'));
    // сквозная проверка: финальный призыв одинаков во всех промтах фаз 2-3
    check('промты 02-03: cta-final во всех четырех, id `cta` - только как синоним старых данных', [ext, agg, aud, fix].every(t => t.includes('cta-final')) && [ext, agg].every(t => !/`cta`/.test(t)));

    // стиль и бюджеты файлов пакета
    const YO = String.fromCharCode(0x451), YO2 = String.fromCharCode(0x401), D1 = String.fromCharCode(0x2014), D2 = String.fromCharCode(0x2013);
    const INVIS = [0xad, 0x200b, 0x200c, 0x200d, 0x2060, 0xfeff].map(c => String.fromCharCode(c));
    const NICHE = /(застройщ|депозит|квот[аеуы]|инвестор|недвижим|ипотек|новострой|апартамент|доходност|ювелир|золот|кольц|пирсинг|бриллиант|серебр|помолвоч|обручал|геммолог|пхукет)/i;
    const OWN = ['scripts/fetch-page.mjs', 'scripts/measure-blocks.mjs', 'scripts/prep-args.mjs', 'prompts/02-competitor-verifier.md', 'prompts/02-page-classifier.md', 'prompts/02-block-extractor.md', 'prompts/02-type-aggregator.md', 'prompts/03-type-auditor.md', 'prompts/03-type-fixer.md', 'workflows/wf-02-competitors.js', 'workflows/wf-03-audit-types.js', 'schemas/page-type.schema.json', 'schemas/competitors.schema.json'];
    const bad = [];
    for (const f of OWN) {
      const t = read(f);
      if ([YO, YO2, D1, D2].some(ch => t.includes(ch))) bad.push(`${f}: е с точками или длинное тире`);
      if (INVIS.some(ch => t.includes(ch))) bad.push(`${f}: невидимый символ литералом (нужен escape)`);
      if (/mcp__[0-9a-f]{8}-/.test(t)) bad.push(`${f}: UUID MCP`);
      const nm = t.match(NICHE); if (nm) bad.push(`${f}: нишевое слово «${nm[0]}»`);
    }
    check('файлы P7: без е с точками, длинных тире, невидимых символов, UUID MCP и нишевых слов', !bad.length, bad.join('; '));
    // бюджеты: 02-type-aggregator 6400 -> 7800 и 03-type-auditor 4900 -> 5700 (лендинг, самопроверка, без конкурентов,
    // сверка цитат); остальные - новые в учете, с запасом на одну-две строки. Программа 05.10: 02-type-aggregator 8300,
    // 03-type-auditor 6100, 03-type-fixer 3500 (строки КФ, kf-coverage), 02-competitor-verifier 5200 (отбор по ranking, CDP)
    const BUDGET = { 'prompts/02-type-aggregator.md': 8300, 'prompts/03-type-auditor.md': 6100, 'prompts/03-type-fixer.md': 3500, 'prompts/02-competitor-verifier.md': 5200, 'prompts/02-page-classifier.md': 3400, 'prompts/02-block-extractor.md': 4600 };
    for (const [f, n] of Object.entries(BUDGET)) { const len = read(f).length; check(`${f}: размер в бюджете (${n} знаков)`, len <= n, `${len} знаков`); }
    // cases-prompts.mjs держит те же бюджеты для 02-type-aggregator и 03-type-auditor (утверждения P7 в файле P3b)
    const cpSrc = fs.readFileSync(path.join(HERE, 'cases-prompts.mjs'), 'utf8');
    const cpBudget = f => Number((cpSrc.match(new RegExp(`'${f.replace(/[.]/g, '[.]')}': (\\d+)`)) || [])[1]);
    check('cases-prompts.mjs: бюджеты 02-type-aggregator и 03-type-auditor не меньше размеров', ['prompts/02-type-aggregator.md', 'prompts/03-type-auditor.md', 'prompts/03-type-fixer.md'].every(f => cpBudget(f) >= read(f).length), ['prompts/02-type-aggregator.md', 'prompts/03-type-auditor.md', 'prompts/03-type-fixer.md'].map(f => `${f}: ${cpBudget(f)} vs ${read(f).length}`).join('; '));
  }
} catch (e) {
  fail++; failures.push(`FAIL исключение: ${e.stack || e.message}`);
} finally {
  if (server) server.kill();
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* временная папка */ }
}

notes.forEach(n => console.log(`NOTE ${n}`));
failures.forEach(f => console.log(f));
console.log(`cases-leaders: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
