// Тесты пакета B программы 05.10 (анализ КФ и КНДР в /site-tekst): матрица и поток фазы 2. Запуск:
//   node .claude/tests/site-tekst/cases-kf-matrix.mjs      код выхода 0 - все прошли.
// Разделы:
//   1. kf-matrix.mjs: абсолютные пороги (n = 1..5 из 5), «?», own и «уже есть», сумма элементов, охват неполный (N < target),
//      info_other по назначению, тело только типов карты, устаревший kf-файл игнорируется, схемы matrix/shell/status;
//   2. x-элементы: у 3 из 5 доходит до матрицы и shell.json (kind, render generic, niche, needs []), три синонима у трех
//      доменов + aliases -> 3/5, алиас x на словарный id поднимает 4/5 до 5/5, перепроверка 1/5 -> 3/5, сбой перепроверки
//      -> «?» и строка limits, kind большинством голосов (при равенстве slot), сведение скриптом по названию;
//   3. --compact (одна строка JSON, --min, нет матрицы - []), лендинг: multipage_only не выше recommended, --candidates,
//      --stale-observers (план частей при больше 12 кадров, устаревание по времени и набору страниц), --status skip и
//      no_competitors, no_chrome;
//   4. wf-02 с подставными агентами: порядок шагов, режимы таблицы раздела 2 (обычный, skipInventory, частичный разбор,
//      skipKf, деградация, лендинг, нет Chrome), повтор без resume не зовет скаута и снимает с --resume, recapture, partial
//      - повтор до 3 заходов, части наблюдателя по очереди, null на новых метках не меняет итог, роли и модели;
//   5. стиль, UUID и ниша в новых файлах пакета (kit).
// Все во временных папках (os.tmpdir()), без сети и данных клиентов.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TPL = path.resolve(HERE, '..', '..', 'skills', 'site-tekst', 'kit');
const { validate } = await import(pathToFileURL(path.join(TPL, 'scripts', 'lib.mjs')).href);
const KM = await import(pathToFileURL(path.join(TPL, 'scripts', 'kf-matrix.mjs')).href);

let pass = 0, fail = 0;
const failures = [], notes = [];
function check(name, ok, detail = '') {
  if (ok) pass++;
  else { fail++; failures.push(`FAIL ${name}${detail ? ': ' + String(detail).slice(0, 700) : ''}`); }
}
const noBom = s => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s);
const rj = f => JSON.parse(noBom(fs.readFileSync(f, 'utf8')));
const wj = (f, o) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(o, null, 2) + '\n'); };
const read = rel => noBom(fs.readFileSync(path.join(TPL, rel), 'utf8'));
const SCHEMAS = {};
const schemaErrors = (name, data) => validate(SCHEMAS[name] ??= rj(path.join(TPL, 'schemas', `${name}.schema.json`)), data);
function run(cwd, args, env = {}) {
  const r = spawnSync(process.execPath, args, { cwd, encoding: 'utf8', env: { ...process.env, ...env }, timeout: 120000 });
  return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '', out: (r.stdout || '') + (r.stderr || '') };
}
const tag = (out, t) => { const m = String(out).match(new RegExp(`${t} (\\{[^\\n]*\\})`)); try { return m ? JSON.parse(m[1]) : null; } catch { return null; } };
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cases-kf-matrix-'));
const D5 = ['d1.example', 'd2.example', 'd3.example', 'd4.example', 'd5.example'];

function mkProject(name, { sitemap = null, target = 5, siteKind = null, domains = D5, chrome = 'C:/chrome.exe' } = {}) {
  const dir = path.join(tmpRoot, name);
  for (const d of ['scripts', 'schemas', 'config']) fs.cpSync(path.join(TPL, d), path.join(dir, d), { recursive: true });
  const cfg = rj(path.join(dir, 'config', 'project.json'));
  cfg.site_url = 'https://own.example/';
  cfg.competitors = { ...(cfg.competitors || {}), selection: { target } };
  if (siteKind) cfg.business = { site_kind: siteKind };
  wj(path.join(dir, 'config', 'project.json'), cfg);
  wj(path.join(dir, 'work', 'competitors', 'competitors.json'), { verified_at: 'x', competitors: [...domains.map(d => ({ domain: d, status: 'ok', source: 'analysis', pages: [{ type: 'home', url: `https://${d}/`, raw: `work/competitors/raw/${d}/home.json`, status: 'ok' }] })), { domain: 'closed.example', status: 'closed', source: 'serp' }] });
  wj(path.join(dir, 'work', 'sitemap.json'), sitemap || { pages: [
    { slug: 'home', url: '/', type: 'home', subject: 'Главная', level: 0, status: 'planned' },
    { slug: 'uslugi', url: '/uslugi', type: 'service', subject: 'Услуга', level: 1, status: 'planned' },
    { slug: 'dostavka', url: '/dostavka', type: 'info_other', subject: 'Доставка', level: 1, status: 'planned' },
    { slug: 'politika', url: '/politika', type: 'info_other', subject: 'Политика', level: 1, status: 'skip', ui_role: 'legal' }] });
  wj(path.join(dir, 'work', 'competitors', 'capture.json'), { chrome, pages: [] });
  return dir;
}
const E = (id, extra = {}) => ({ id, name: extra.name || id, present: 1, via: 'dom', ...extra });
// наблюдение домена: zones главной (site) и тела по типам
function observe(dir, domain, { header = [], footer = [], fixed = [], mobile = [], body = {}, recheck = null, role = 'competitor', captured = true, extraPages = [] } = {}) {
  const pages = [{ name: 'home', type: 'home', url: `https://${domain}/`, captured, zones: { header, footer, fixed, mobile, body: body.home || [] } }];
  for (const [t, list] of Object.entries(body)) if (t !== 'home' && list.length) pages.push({ name: `${t.replace(/[^a-z_]/g, '')}-1`, type: t.split(':')[0], ...(t.includes(':') ? { subject: t.split(':')[1] } : {}), url: `https://${domain}/${t}`, captured, zones: { body: list } });
  pages.push(...extraPages);
  const j = { domain: domain === 'own' ? 'own.example' : domain, role, pages, ambiguous: [], limits: [] };
  if (recheck) j.recheck = recheck;
  wj(path.join(dir, 'work', 'competitors', 'kf', `${domain}.json`), j);
  return j;
}
const matrixOf = dir => rj(path.join(dir, 'work', 'kf', 'matrix.json'));
const rowOf = (m, id, zone = null, scope = null) => m.rows.find(r => r.id === id && (!zone || r.zone === zone) && (!scope || r.scope === scope));

try {
  // ================================================================== 1. пороги, «?», own, сумма, охват
  {
    const M = mkProject('base');
    // phone у 5, email у 4, address у 3, hours у 2, messenger_viber у 1
    const H = { phone: 5, email: 4, address: 3, hours: 2, messenger_viber: 1 };
    D5.forEach((d, i) => observe(M, d, {
      header: Object.entries(H).filter(([, n]) => i < n).map(([id]) => E(id)).concat(i === 0 ? [E('social_vk', { present: '?' })] : i === 1 ? [E('social_vk')] : []),
      footer: i < 2 ? [E('requisites')] : [],
      body: { home: i < 3 ? [E('reviews'), E('schema_organization')] : [], service: i < 4 ? [E('steps')] : [], 'info_other:Доставка': i < 2 ? [E('delivery_calc')] : [], 'info_other:Гарантия': i < 2 ? [E('guarantees_block')] : [], product: [E('specs')] },
    }));
    observe(M, 'own', { role: 'own', header: [E('phone'), E('hours')], body: { home: [E('reviews')] } });
    observe(M, 'old.example', { header: [E('phone'), E('cart')] });
    const r = run(M, ['scripts/kf-matrix.mjs', '--shell']);
    const m = matrixOf(M);
    const lv = id => { const x = rowOf(m, id, 'header'); return x ? `${x.level}:${x.n}/${x.N}` : 'нет'; };
    check('пороги: n=5 и n=4 - must, n=3 и n=2 - recommended, n=1 - optional (абсолютные, при N=5)', r.code === 0 && lv('phone') === 'must:5/5' && lv('email') === 'must:4/5' && lv('address') === 'recommended:3/5' && lv('hours') === 'recommended:2/5' && lv('messenger_viber') === 'optional:1/5', r.out + JSON.stringify(Object.keys(H).map(lv)));
    check('n=0 - строки нет (элемент только у устаревшего домена)', !rowOf(m, 'cart'), JSON.stringify(rowOf(m, 'cart')));
    const vk = rowOf(m, 'social_vk', 'header');
    check('«?»: значение «?» у домена, n считает только 1', vk && vk.values['d1.example'] === '?' && vk.values['d2.example'] === 1 && vk.values['d3.example'] === 0 && vk.n === 1 && vk.level === 'optional', JSON.stringify(vk));
    check('own: отдельное поле, «уже есть» производная и на уровень не влияет', rowOf(m, 'phone', 'header').own === 1 && rowOf(m, 'phone', 'header').already === true && rowOf(m, 'email', 'header').own === 0 && rowOf(m, 'email', 'header').already === false && rowOf(m, 'hours', 'header').level === 'recommended', JSON.stringify(['phone', 'email', 'hours'].map(id => rowOf(m, id, 'header')).map(x => [x.own, x.already, x.level])));
    check('own не входит в N и n', rowOf(m, 'hours', 'header').n === 2 && rowOf(m, 'hours', 'header').N === 5 && !('own' in rowOf(m, 'hours', 'header').values));
    const own = rowOf(m, 'requisites', 'footer');
    check('own без элемента на снятой странице scope - 0; тело типа, которого у own нет, - null', own && own.own === 0 && rowOf(m, 'steps', 'body', 'service').own === null, JSON.stringify([own && own.own, rowOf(m, 'steps', 'body', 'service')?.own]));
    check('сумма элементов: число строк со значением 1 у домена (own тоже)', m.sums['d1.example'] === m.rows.filter(x => x.values['d1.example'] === 1).length && m.sums['d5.example'] === 1 && m.sums['d1.example'] > m.sums['d4.example'] && m.sums.own === 3, JSON.stringify(m.sums));
    check('устаревший kf-файл игнорируется со строкой limits', m.limits.some(l => /устаревший файл: old\.example/.test(l)) && !m.domains.some(d => d.domain === 'old.example'), JSON.stringify(m.limits));
    check('тело: scope типа, info_other дробится по назначению, типы вне карты не берутся', rowOf(m, 'steps', 'body', 'service')?.n === 4 && rowOf(m, 'delivery_calc', 'body', 'info_other:Доставка')?.N === 2 && rowOf(m, 'guarantees_block', 'body', 'info_other:Гарантия')?.n === 2 && !rowOf(m, 'specs'), JSON.stringify(m.scopes));
    check('охват неполный: N < target - пометка в строке и в limits', rowOf(m, 'delivery_calc', 'body', 'info_other:Доставка').notes.includes('охват неполный: 2 из 5') && m.limits.some(l => /охват неполный \(info_other:Доставка\): 2 из 5/.test(l)), JSON.stringify(rowOf(m, 'delivery_calc')));
    check('невидимые элементы словаря (Schema.org) в матрице с visible false', rowOf(m, 'schema_organization', 'body', 'home')?.visible === false);
    const sh = rj(path.join(M, 'work', 'shell.json'));
    {
      const nm = { generated_at: 'x', domains: [], rows: [{ scope: 'site', zone: 'header', id: 'logo', name: 'Логотип', kind: 'nav', level: 'recommended', n: 3, N: 5, render: null }, { scope: 'site', zone: 'header', id: 'x-nav', name: 'Меню регионов', kind: 'nav', level: 'recommended', n: 2, N: 5, x: true }] };
      const ns = KM.shellOf(nm);
      check('shellOf: вид nav (логотип, меню; и x-элемент) - render native, не чип', ns.items.every(i => i.render === 'native'), JSON.stringify(ns.items));
    }
    check('shell.json: только scope site уровня не ниже recommended, coverage n/N, render словаря', !sh.items.some(i => i.id === 'messenger_viber' || i.id === 'social_vk' || i.id === 'reviews') && sh.items.find(i => i.id === 'phone' && i.zone === 'header')?.coverage === '5/5' && sh.items.find(i => i.id === 'phone').render === 'phone' && sh.items.find(i => i.id === 'requisites')?.render === 'legal_line' && sh.n_competitors === 5, JSON.stringify(sh.items.map(i => [i.id, i.zone, i.level])));
    const st = rj(path.join(M, 'work', 'kf', 'status.json'));
    check('status.json: done, счетчики', st.status === 'done' && st.rows === m.rows.length && st.must >= 2, JSON.stringify(st));
    check('схемы: kf-matrix, shell, kf-status', !schemaErrors('kf-matrix', m).length && !schemaErrors('shell', sh).length && !schemaErrors('kf-status', st).length, [...schemaErrors('kf-matrix', m), ...schemaErrors('shell', sh), ...schemaErrors('kf-status', st)].join('; '));
    check('kf-observed: наблюдение проходит схему, x-элемент без латиницы - нет', !schemaErrors('kf-observed', rj(path.join(M, 'work', 'competitors', 'kf', 'd1.example.json'))).length && schemaErrors('kf-observed', { domain: 'a', role: 'competitor', pages: [{ name: 'home', type: 'home', zones: { header: [{ id: 'x-Телефон', name: 'a', present: 1, via: 'dom' }] } }] }).length > 0 && schemaErrors('kf-observed', { domain: 'a', role: 'competitor', pages: [{ name: 'home', type: 'home', zones: { header: [{ id: 'phone', name: 'a', present: 0, via: 'dom' }] } }] }).length > 0);
    check('KF_MATRIX - последняя машинная строка', tag(r.stdout, 'KF_MATRIX')?.rows === m.rows.length, r.stdout.slice(-300));

    // --compact
    const c = run(M, ['scripts/kf-matrix.mjs', '--compact', '--type', 'service', '--min', 'recommended']);
    let cj = null; try { cj = JSON.parse(c.stdout); } catch { /* ниже */ }
    check('--compact: одна строка JSON [{id, name, n, N, level, kind, block_hint}]', c.code === 0 && c.stdout.trim().split('\n').length === 1 && Array.isArray(cj) && cj.length === 1 && cj[0].id === 'steps' && cj[0].level === 'must' && cj[0].block_hint === 'process' && Object.keys(cj[0]).sort().join() === 'N,block_hint,id,kind,level,n,name', c.out);
    const ci = JSON.parse(run(M, ['scripts/kf-matrix.mjs', '--compact', '--type', 'info_other', '--min', 'recommended']).stdout);
    check('--compact info_other: строки всех назначений с scope', ci.length === 2 && ci.every(x => /^info_other:/.test(x.scope)), JSON.stringify(ci));
    const ch = JSON.parse(run(M, ['scripts/kf-matrix.mjs', '--compact', '--type', 'home', '--min', 'recommended']).stdout);
    check('--compact: невидимые элементы (Schema.org) не входят', ch.some(x => x.id === 'reviews') && !ch.some(x => /^schema_/.test(x.id)), JSON.stringify(ch));
    check('--compact --min optional - и optional', JSON.parse(run(M, ['scripts/kf-matrix.mjs', '--compact', '--type', 'service']).stdout).length === 1);
    fs.rmSync(path.join(M, 'work', 'kf', 'matrix.json'));
    const c0 = run(M, ['scripts/kf-matrix.mjs', '--compact', '--type', 'service', '--min', 'recommended']);
    check('--compact без матрицы - [] и код 0', c0.code === 0 && c0.stdout.trim() === '[]', c0.out);
  }

  // ================================================================== 2. x-элементы
  {
    const X = mkProject('x');
    D5.forEach((d, i) => observe(X, d, {
      header: [E('phone'), ...(i < 3 ? [E('x-online-zapis', { name: 'Онлайн-запись на прием', kind: 'function', label: 'Записаться онлайн' })] : [])],
      body: {
        home: [
          ...(i === 0 ? [E('x-a', { name: 'Блок А', kind: 'block' })] : i === 1 ? [E('x-b', { name: 'Блок Б', kind: 'block' })] : i === 2 ? [E('x-c', { name: 'Блок В', kind: 'block' })] : []),
          ...(i < 4 ? [E('reviews')] : [E('x-otzyvy-klientov', { name: 'Что говорят клиенты', kind: 'block' })]),
          ...(i === 0 ? [E('x-bar', { name: 'Блок без перепроверки', kind: 'block' })] : []),
          ...(i < 3 ? [E('x-vote', { name: 'Голоса', kind: i < 2 ? 'function' : 'slot' })] : []),
          ...(i < 2 ? [E('x-tie', { name: 'Ничья', kind: i === 0 ? 'function' : 'slot' })] : []),
          ...(i === 0 ? [E('x-same-1', { name: 'Таблица размеров товара', kind: 'block' })] : i === 1 ? [E('x-same-2', { name: 'Таблица размеров  товара', kind: 'block' })] : []),
        ],
        service: i === 0 ? [E('x-foo', { name: 'Особый блок', kind: 'block' })] : [E('steps')],
      },
      recheck: i === 0 ? null : {
        'x-online-zapis': 0, 'x-a': 0, 'x-b': 0, 'x-c': 0, 'x-vote': 0, 'x-tie': 0, 'x-same-1': 0, 'x-otzyvy-klientov': 0,
        ...(i === 1 || i === 2 ? { 'x-foo': 1 } : { 'x-foo': 0 }),
      },
    }));
    wj(path.join(X, 'work', 'kf', 'aliases.json'), { 'x-b': { to: 'x-a', kind: 'block' }, 'x-c': { to: 'x-a', kind: 'block' }, 'x-a': { to: 'x-a', kind: 'block' }, 'x-otzyvy-klientov': { to: 'reviews', kind: 'block' } });
    run(X, ['scripts/kf-matrix.mjs', '--shell']);
    const m = matrixOf(X);
    const oz = rowOf(m, 'x-online-zapis', 'header');
    check('x-элемент у 3 из 5 (после перепроверки 0 у двух) - строка recommended 3/5 с kind наблюдателей', oz && oz.n === 3 && oz.N === 5 && oz.level === 'recommended' && oz.kind === 'function' && oz.x === true && oz.values['d4.example'] === 0, JSON.stringify(oz));
    const shx = rj(path.join(X, 'work', 'shell.json')).items.find(i => i.id === 'x-online-zapis');
    check('x-элемент доходит до shell.json: render generic, needs [], niche true, kind', shx && shx.render === 'generic' && Array.isArray(shx.needs) && !shx.needs.length && shx.niche === true && shx.kind === 'function' && shx.coverage === '3/5', JSON.stringify(shx));
    const xa = rowOf(m, 'x-a', 'body', 'home');
    check('три синонима у трех доменов + aliases -> одна строка 3/5', xa && xa.n === 3 && !rowOf(m, 'x-b') && !rowOf(m, 'x-c'), JSON.stringify(xa));
    const rv = rowOf(m, 'reviews', 'body', 'home');
    check('алиас x-элемента на словарный id: 4/5 -> 5/5', rv && rv.n === 5 && rv.level === 'must' && !rowOf(m, 'x-otzyvy-klientov'), JSON.stringify(rv));
    const foo = rowOf(m, 'x-foo', 'body', 'service');
    check('перепроверка: x-элемент у 1 из 5, ответы 1, 1, 0, 0 -> 3/5', foo && foo.n === 3 && foo.values['d4.example'] === 0 && foo.level === 'recommended', JSON.stringify(foo));
    const bar = rowOf(m, 'x-bar', 'body', 'home');
    check('сбой перепроверки (нет ответа) - «?» по этим id и строка limits', bar && bar.n === 1 && ['d2.example', 'd3.example', 'd4.example', 'd5.example'].every(d => bar.values[d] === '?') && m.limits.some(l => /перепроверка не выполнена: d2\.example - «\?» по .*x-bar/.test(l)), JSON.stringify({ bar, limits: m.limits }));
    check('kind x-элемента большинством голосов (function 2 против slot 1); равенство - slot', rowOf(m, 'x-vote')?.kind === 'function' && rowOf(m, 'x-tie')?.kind === 'slot', JSON.stringify([rowOf(m, 'x-vote')?.kind, rowOf(m, 'x-tie')?.kind]));
    const same = rowOf(m, 'x-same-1', 'body', 'home');
    check('сведение скриптом: одинаковое название x-элементов (регистр и пробелы) - одна строка', same && same.n === 2 && !rowOf(m, 'x-same-2'), JSON.stringify(same));
    check('без aliases.json kind x-элемента - из голосов, алиас задает kind', rowOf(m, 'x-a').kind === 'block');

    // x-элемент в двух scope: перепроверка по ключу scope не переносится на другой scope; x без kind - строка limits
    const X3 = mkProject('x3');
    D5.forEach((d, i) => observe(X3, d, {
      header: i === 0 ? [{ id: 'x-nokind', name: 'Без вида', present: 1, via: 'dom' }] : [],
      body: { home: i === 0 ? [E('x-calc', { name: 'Калькулятор', kind: 'function' })] : [E('reviews')], service: i === 1 ? [E('x-calc', { name: 'Калькулятор', kind: 'function' })] : [E('steps')] },
      recheck: i === 2 ? { 'home|body|x-calc': 1, 'service|body|x-calc': 0 } : i === 3 ? { 'home|body|x-calc': 0 } : null,
    }));
    const c3 = run(X3, ['scripts/kf-matrix.mjs', '--candidates']);
    const cj3 = rj(path.join(X3, 'work', 'kf', 'candidates.json'));
    const keysOf = d => (cj3.domains[d] || []).filter(x => x.id === 'x-calc').map(x => x.key).sort().join();
    check('--candidates: x-элемент в двух scope - запись на каждый scope с key, без схлопывания по id; отвеченный key не кандидат', c3.code === 0 && keysOf('d5.example') === 'home|body|x-calc,service|body|x-calc' && keysOf('d1.example') === 'service|body|x-calc' && keysOf('d2.example') === 'home|body|x-calc' && keysOf('d3.example') === '' && keysOf('d4.example') === 'service|body|x-calc', JSON.stringify(cj3.domains));
    run(X3, ['scripts/kf-matrix.mjs']);
    const m3 = matrixOf(X3);
    const ch3 = rowOf(m3, 'x-calc', 'body', 'home'), cs3 = rowOf(m3, 'x-calc', 'body', 'service');
    check('перепроверка по key: ответ 1 по главной не делает 1 в услуге и наоборот; без ответа по scope - «?»', ch3 && cs3 && ch3.values['d3.example'] === 1 && cs3.values['d3.example'] === 0 && ch3.values['d4.example'] === 0 && cs3.values['d4.example'] === '?' && ch3.n === 2 && cs3.n === 1, JSON.stringify([ch3, cs3]));
    check('x-элемент без kind - строка limits (схема if/then не проверяет)', m3.limits.some(l => /x-элемент без kind: d1\.example\/x-nokind/.test(l)), JSON.stringify(m3.limits));
    check('матрица без наблюдения сайта заказчика - строка limits с причиной', m3.limits.some(l => /^сайт заказчика не наблюдался: /.test(l)), JSON.stringify(m3.limits));

    // --candidates
    const X2 = mkProject('x2');
    D5.forEach((d, i) => observe(X2, d, { header: [E('phone'), ...(i === 0 ? [E('x-online-zapis', { name: 'Онлайн-запись', kind: 'function', label: 'Записаться' })] : [])], body: { home: i === 1 ? [E('x-blok', { name: 'Блок', kind: 'block' })] : [] }, recheck: i === 2 ? { 'x-online-zapis': 1 } : null }));
    observe(X2, 'own', { role: 'own', header: [E('phone')] });
    const c = run(X2, ['scripts/kf-matrix.mjs', '--candidates']);
    const cj = rj(path.join(X2, 'work', 'kf', 'candidates.json'));
    const k = tag(c.stdout, 'KF_CANDIDATES');
    check('--candidates: x-элементы с зоной, scope и найденными доменами', cj.x.length === 2 && cj.x.find(x => x.id === 'x-online-zapis').found.join() === 'd1.example' && cj.x.find(x => x.id === 'x-online-zapis').zone === 'header' && cj.x.find(x => x.id === 'x-blok').scope === 'home', JSON.stringify(cj.x));
    check('--candidates: по домену - x-элементы с 0 без перепроверки; ответ уже есть - не кандидат; own тоже', cj.domains['d2.example'].map(x => x.id).join() === 'x-online-zapis' && cj.domains['d2.example'][0].key === 'site|header|x-online-zapis' && !(cj.domains['d3.example'] || []).some(x => x.id === 'x-online-zapis') && (cj.domains['d3.example'] || []).some(x => x.id === 'x-blok') && cj.domains.own.some(x => x.id === 'x-online-zapis'), JSON.stringify(cj.domains));
    check('KF_CANDIDATES: x, x_unaliased, recheck', k && k.x === 2 && k.x_unaliased === 2 && k.recheck.includes('d2.example') && !k.recheck.includes('d1.example') === false, c.stdout.slice(-300));
    wj(path.join(X2, 'work', 'kf', 'aliases.json'), { 'x-online-zapis': { to: 'x-online-zapis', kind: 'function' }, 'x-blok': { to: 'x-blok', kind: 'block' } });
    check('--candidates: все x-элементы в aliases.json - x_unaliased 0 (нормализатор не нужен)', tag(run(X2, ['scripts/kf-matrix.mjs', '--candidates']).stdout, 'KF_CANDIDATES')?.x_unaliased === 0);
  }

  // ================================================================== 3. лендинг, план наблюдения, статусы
  {
    const L = mkProject('landing', { sitemap: { pages: [{ slug: 'home', url: '/', type: 'home', subject: 'Главная', level: 0, status: 'planned' }] } });
    D5.forEach(d => observe(L, d, { header: [E('search'), E('phone')] }));
    run(L, ['scripts/kf-matrix.mjs', '--shell']);
    const m = matrixOf(L);
    check('лендинг (карта из одной главной): multipage_only не выше recommended с пометкой, прочие must', m.site_kind === 'landing' && rowOf(m, 'search').level === 'recommended' && rowOf(m, 'search').notes.some(n => /лендинге/.test(n)) && rowOf(m, 'phone').level === 'must', JSON.stringify(rowOf(m, 'search')));
    const L2 = mkProject('landing-kind', { siteKind: 'landing' });
    D5.forEach(d => observe(L2, d, { header: [E('search')] }));
    run(L2, ['scripts/kf-matrix.mjs']);
    check('лендинг по business.site_kind конфига', matrixOf(L2).site_kind === 'landing' && rowOf(matrixOf(L2), 'search').level === 'recommended');

    // план наблюдения и устаревание
    const S = mkProject('stale', { domains: ['d1.example', 'd2.example'] });
    const shot = (d, name, type, tiles) => {
      const dir = path.join(S, 'work', 'competitors', 'shots', d, name);
      const files = ['top.jpg', ...Array.from({ length: tiles }, (_, i) => `body-0${i + 1}.jpg`), 'bottom.jpg', 'mobile.jpg'];
      for (const f of files) { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, f), 'x'); }
      wj(path.join(dir, 'kf.json'), { zones: {}, outline: [] });
      return { domain: d, name, url: `https://${d}/${name}`, type, role: d === 'own' ? 'own' : 'competitor', status: 'ok', files: files.map(f => ({ file: `work/competitors/shots/${d}/${name}/${f}`, y0: 0, y1: 1 })) };
    };
    const capPages = [shot('d1.example', 'home', 'home', 2), shot('d1.example', 'service-1', 'service', 1),
      shot('d2.example', 'home', 'home', 8), shot('d2.example', 'category-1', 'category', 8), shot('d2.example', 'service-1', 'service', 8), shot('d2.example', 'category-2', 'category', 3), shot('own', 'home', 'home', 1)];
    wj(path.join(S, 'work', 'competitors', 'capture.json'), { chrome: 'C:/chrome.exe', pages: capPages });
    const s1 = run(S, ['scripts/kf-matrix.mjs', '--stale-observers']);
    const plan = rj(path.join(S, 'work', 'kf', 'plan.json'));
    const k1 = tag(s1.stdout, 'KF_STALE');
    check('--stale-observers: до 12 кадров - одна часть all со всеми страницами', plan.domains['d1.example'].parts.length === 1 && plan.domains['d1.example'].parts[0].part === 'all' && plan.domains['d1.example'].parts[0].images.length <= 12 && plan.domains['d1.example'].parts[0].pages.join() === 'home,service-1', JSON.stringify(plan.domains['d1.example']));
    const p2 = plan.domains['d2.example'].parts;
    check('--stale-observers: больше 12 кадров - части shell (главная и внутренняя, тело - главной) и types (тело всех внутренних, и первой тоже), в каждой не больше 12', p2.map(p => p.part).join() === 'shell,types' && p2.every(p => p.images.length <= 12) && p2[0].pages.join() === 'home,category-1' && p2[0].body_pages.join() === 'home' && p2[1].pages.join() === 'category-1,category-2,service-1' && p2[1].body_pages.join() === 'category-1,category-2,service-1' && p2[0].images.some(f => /home\/mobile\.jpg$/.test(f)), JSON.stringify(p2));
    const seenImg = new Set(p2.flatMap(p => p.images));
    check('--stale-observers: у каждого типа кадры тела первой страницы есть в какой-то части (category-1, не category-2)', ['home', 'category-1', 'service-1'].every(n => [...seenImg].some(f => f.includes('/d2.example/' + n + '/body-'))) && ![...seenImg].some(f => f.includes('/category-2/body-')), JSON.stringify([...seenImg]));
    check('--stale-observers: непросмотренные кадры (сверх 12 в части) - строки limits плана', plan.limits.some(l => /d2\.example: кадры не просмотрены \(часть shell, лимит 12\): home\/body-08\.jpg/.test(l)) && plan.limits.some(l => /d2\.example: кадры не просмотрены \(часть types, лимит 12\)/.test(l)) && !plan.limits.some(l => /d1\.example/.test(l)), JSON.stringify(plan.limits));
    {
      // фикстура рецензента: home 4, category-1 3, service-1 3, product-1 2 кадра тела
      const S2 = mkProject('stale-split', { domains: ['d3.example'] });
      const sh2 = (name, type, tiles) => { const dir = path.join(S2, 'work', 'competitors', 'shots', 'd3.example', name); const files = ['top.jpg', ...Array.from({ length: tiles }, (_, i) => 'body-0' + (i + 1) + '.jpg'), 'bottom.jpg', 'mobile.jpg']; for (const x of files) { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, x), 'x'); } return { domain: 'd3.example', name, url: 'https://d3.example/' + name, type, role: 'competitor', status: 'ok', files: files.map(x => ({ file: 'work/competitors/shots/d3.example/' + name + '/' + x, y0: 0, y1: 1 })) }; };
      wj(path.join(S2, 'work', 'competitors', 'capture.json'), { chrome: 'C:/chrome.exe', pages: [sh2('home', 'home', 4), sh2('category-1', 'category', 3), sh2('service-1', 'service', 3), sh2('product-1', 'product', 2)] });
      run(S2, ['scripts/kf-matrix.mjs', '--stale-observers']);
      const pl = rj(path.join(S2, 'work', 'kf', 'plan.json'));
      const imgs = pl.domains['d3.example'].parts.flatMap(p => p.images);
      const want = [['home', 4], ['category-1', 3], ['service-1', 3], ['product-1', 2]].flatMap(([n, k]) => Array.from({ length: k }, (_, i) => 'work/competitors/shots/d3.example/' + n + '/body-0' + (i + 1) + '.jpg'));
      check('--stale-observers (home 4, category-1 3, service-1 3, product-1 2 кадра тела): все кадры тела в частях, тело первой внутренней - в types, ограничений нет', want.every(x => imgs.includes(x)) && pl.domains['d3.example'].parts.find(p => p.part === 'types').images.some(x => x.includes('/category-1/body-')) && !pl.limits.some(l => /d3\.example/.test(l)), JSON.stringify(pl));
      check('--stale-observers: сайт заказчика без снятия - строка limits плана с причиной', pl.limits.some(l => /^сайт заказчика не наблюдался: главная не снималась/.test(l)), JSON.stringify(pl.limits));
    }
    check('--stale-observers: без kf-файлов устарели все домены и own (кадры есть)', k1 && k1.domains.map(x => x.domain).sort().join() === 'd1.example,d2.example,own' && k1.domains.find(x => x.domain === 'd2.example').parts.join() === 'shell,types', s1.stdout);
    observe(S, 'd1.example', { header: [E('phone')], body: { service: [E('steps')] } });
    const k2 = tag(run(S, ['scripts/kf-matrix.mjs', '--stale-observers']).stdout, 'KF_STALE');
    check('--stale-observers: свежий kf-файл с тем же набором страниц - не наблюдать', !k2.domains.some(x => x.domain === 'd1.example'), JSON.stringify(k2));
    const old = new Date(Date.now() - 60000);
    fs.utimesSync(path.join(S, 'work', 'competitors', 'kf', 'd1.example.json'), old, old);
    check('--stale-observers: kf-файл старше снимков - наблюдать заново', tag(run(S, ['scripts/kf-matrix.mjs', '--stale-observers']).stdout, 'KF_STALE').domains.some(x => x.domain === 'd1.example'));
    observe(S, 'd1.example', { header: [E('phone')] });
    check('--stale-observers: другой набор страниц - наблюдать заново', tag(run(S, ['scripts/kf-matrix.mjs', '--stale-observers']).stdout, 'KF_STALE').domains.some(x => x.domain === 'd1.example'));
    // без кадров (нет Chrome): текстовые снимки
    const T = mkProject('text', { domains: ['d1.example'], chrome: null });
    wj(path.join(T, 'work', 'competitors', 'raw', 'd1.example', 'home.json'), { url: 'https://d1.example/', status: 'ok', links: [], sections: [] });
    wj(path.join(T, 'work', 'competitors', 'shots', 'd1.example', 'home', 'kf.json'), { static: true, zones: {}, outline: [] });
    run(T, ['scripts/kf-matrix.mjs', '--stale-observers']);
    const tp = rj(path.join(T, 'work', 'kf', 'plan.json'));
    check('--stale-observers без кадров: режим text, raw снимки и DOM по статическому html, own без кадров не наблюдается', tp.domains['d1.example'].mode === 'text' && tp.domains['d1.example'].parts[0].raw[0] === 'work/competitors/raw/d1.example/home.json' && tp.domains['d1.example'].parts[0].dom[0] === 'work/competitors/shots/d1.example/home/kf.json' && !tp.domains.own, JSON.stringify(tp));
    observe(T, 'd1.example', { header: [E('phone', { present: '?', via: 'text' })], captured: false });
    run(T, ['scripts/kf-matrix.mjs', '--shell']);
    const ts = rj(path.join(T, 'work', 'kf', 'status.json'));
    check('нет Chrome: матрица по тексту, status no_chrome и строка ограничения', ts.status === 'no_chrome' && matrixOf(T).mode === 'text' && matrixOf(T).limits.some(l => /без кадров/.test(l)), JSON.stringify(ts));
    // смешанный режим: домен без кадров (антибот) - отсутствие элемента оболочки «?», а не 0; тело - 0 по тексту снимка
    const MX = mkProject('mixed', { domains: ['d1.example', 'd2.example', 'd3.example'] });
    for (const d of ['d1.example', 'd2.example']) observe(MX, d, { header: [E('phone'), E('cart')], mobile: [E('burger')], body: { home: [E('reviews')] } });
    observe(MX, 'd3.example', { header: [E('phone', { present: '?', via: 'text' })], body: { home: [] }, captured: false });
    run(MX, ['scripts/kf-matrix.mjs', '--shell']);
    const mx = matrixOf(MX);
    const vx = (id, zone) => (rowOf(mx, id, zone) || { values: {} }).values['d3.example'];
    check('смешанный режим: у домена без кадров шапка и мобильная версия - «?», тело главной - 0', vx('cart', 'header') === '?' && vx('burger', 'mobile') === '?' && vx('reviews', 'body') === 0, JSON.stringify(['cart', 'burger', 'reviews'].map(id => rowOf(mx, id))));

    // --status
    const Q = mkProject('status');
    observe(Q, 'd1.example', { header: [E('phone')] });
    run(Q, ['scripts/kf-matrix.mjs', '--shell']);
    const q1 = run(Q, ['scripts/kf-matrix.mjs', '--status', 'skip']);
    check('--status skip при готовой матрице - матрица, оболочка и кандидаты сняты (этап не проведен), status skip, наблюдения остаются', q1.code === 0 && !fs.existsSync(path.join(Q, 'work', 'kf', 'matrix.json')) && !fs.existsSync(path.join(Q, 'work', 'shell.json')) && rj(path.join(Q, 'work', 'kf', 'status.json')).status === 'skip' && tag(q1.stdout, 'KF_STATUS')?.removed === 2 && fs.existsSync(path.join(Q, 'work', 'competitors', 'kf', 'd1.example.json')), q1.out);
    run(Q, ['scripts/kf-matrix.mjs', '--shell']);
    check('после skip обычный прогон пересобирает матрицу из прежних наблюдений', fs.existsSync(path.join(Q, 'work', 'kf', 'matrix.json')) && rj(path.join(Q, 'work', 'kf', 'status.json')).status === 'done');
    const q2 = run(Q, ['scripts/kf-matrix.mjs', '--status', 'no_competitors']);
    check('--status no_competitors: матрица и оболочка сняты, status.json no_competitors', q2.code === 0 && !fs.existsSync(path.join(Q, 'work', 'kf', 'matrix.json')) && !fs.existsSync(path.join(Q, 'work', 'shell.json')) && rj(path.join(Q, 'work', 'kf', 'status.json')).status === 'no_competitors', q2.out);
    const Q2 = mkProject('status2');
    run(Q2, ['scripts/kf-matrix.mjs', '--status', 'skip']);
    check('--status skip без матрицы - status.json skip, схема', rj(path.join(Q2, 'work', 'kf', 'status.json')).status === 'skip' && !schemaErrors('kf-status', rj(path.join(Q2, 'work', 'kf', 'status.json'))).length);
    check('--status с неизвестным значением - код 2', run(Q2, ['scripts/kf-matrix.mjs', '--status', 'done']).code === 2);
    const N0 = path.join(tmpRoot, 'nocomp'); fs.mkdirSync(N0, { recursive: true });
    check('нет competitors.json - код 2', run(N0, [path.join(TPL, 'scripts', 'kf-matrix.mjs')]).code === 2);
  }

  // ================================================================== 4. wf-02 с подставными агентами
  {
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const SRC = read('workflows/wf-02-competitors.js');
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    async function runWf(args, impl) {
      const src = SRC.replace(/^export const meta\s*=/m, 'const meta =');
      const calls = [], logs = [];
      let t = 0;
      const agent = async (prompt, opts) => {
        const c = { label: opts.label, model: opts.model, prompt, start: ++t, end: 0 };
        calls.push(c);
        try { await sleep(/^(extract|capture):/.test(opts.label) ? 8 : 2); return await impl(opts.label, prompt); } finally { c.end = ++t; }
      };
      const parallel = fns => Promise.all(fns.map(f => f()));
      const fn = new AsyncFunction('args', 'agent', 'parallel', 'phase', 'log', 'pipeline', 'workflow', src);
      try { return { r: await fn(args, agent, parallel, () => {}, m => logs.push(m), null, null), calls, logs }; } catch (e) { return { e, calls, logs }; }
    }
    const baseArgs = { root: '/fake', model: 'STRONG', model_light: 'LIGHT' };
    const labels = x => x.calls.map(c => c.label);
    const typesOf = p => { const m = String(p).match(/types=(\[[^\]]*\])/); return m ? JSON.parse(m[1]) : []; };
    const agg = (l, p) => ({ results: typesOf(p).map(tp => ({ type: tp, market_blocks: 1, differentiation_blocks: 2, order: ['hero'] })) });
    const ext = (l, p) => { const m = String(p).match(/items=(\[.*\])\./); const items = m ? JSON.parse(m[1]) : []; return { results: items.map(i => ({ raw: i.raw, file: i.raw.replace(/\.json$/, '.blocks.json'), blocks: 3 })) }; };
    const verify = kept => ({ total_candidates: kept.length, kept, excluded: [], method: 'm' });
    const out = (t, j) => ({ ok: true, exit_code: 0, stdout_tail: `строка\n${t} ${JSON.stringify(j)}` });
    const domOf = l => l.split(':')[1];
    // полный набор ответов: fresh по умолчанию false, x-элементы есть, перепроверка у d2
    const full = (o = {}) => (l, p) => {
      if (l === 'rank:check') return o.fresh ? out('x', {}) && { ok: true, exit_code: 0, stdout_tail: o.exhausted ? '{"status":"fresh","reason":"кандидатов меньше target","exhausted":true}' : '{"status":"fresh"}' } : { ok: true, exit_code: 0, stdout_tail: '{"status":"stale","reason":"нет pool.json"}' };
      if (l === 'scout') return { candidates: 12, errors: [], method: 'm', ...(o.scoutExhausted ? { status: 'fresh', exhausted: true, eligible: 3, sources_done: ['serp', 'keyso_batch', 'keyso'] } : {}) };
      if (l === 'rank') return { ok: true, exit_code: 0, stdout_tail: 'ranking.json: 12' };
      if (l === 'verify') return o.verify || verify(['d1.example', 'd2.example']);
      if (l === 'rank:order') return { ok: true, exit_code: 0, stdout_tail: JSON.stringify({ ok: !o.gap, skipped: o.gap || [], checked: true }) };
      if (l === 'verify:2') return o.verify2 === undefined ? verify(['d1.example', 'd3.example']) : o.verify2;
      if (l.startsWith('inventory:')) return { domain: domOf(l), pages: [{ type: 'service', url: `https://${domOf(l)}/s`, status: 'ok', raw: `work/competitors/raw/${domOf(l)}/service-1.json` }], browser: [], types_missing: [] };
      if (l.startsWith('capture:')) return o.capture ? o.capture(l, p) : out('KF_CAPTURE', { domain: domOf(l), chrome: o.chrome !== false, ok: 2, antibot: 0, error: 0, skipped: 0, partial: false });
      if (l === 'matrix:stale') return out('KF_STALE', { domains: o.stale || [{ domain: 'd1.example', role: 'competitor', parts: ['all'] }, { domain: 'd2.example', role: 'competitor', parts: ['shell', 'types'] }, { domain: 'own', role: 'own', parts: ['all'] }] });
      if (l.startsWith('kf-observe:')) return { domain: domOf(l), file: 'f', pages: 2, elements: 10, x: 1, ambiguous: 0, limits: [] };
      if (l.startsWith('matrix:candidates')) return out('KF_CANDIDATES', o.cand || { x: 2, x_unaliased: l.endsWith(':2') ? 0 : 2, recheck: ['d2.example', 'own'] });
      if (l === 'kf-normalize') return { file: 'work/kf/aliases.json', x: 2, merged: 1 };
      if (l.startsWith('kf-recheck:')) return { domain: domOf(l), file: 'f', elements: 2, x: 0, pages: 2 };
      if (l === 'matrix') return out('KF_MATRIX', { status: o.chrome === false ? 'no_chrome' : 'done', rows: 30, must: 8, recommended: 9, shell_items: 12, limits: 0 });
      if (l === 'matrix:status') return out('KF_STATUS', { status: 'skip', changed: true });
      if (l === 'prep-args') return o.prep || { ok: true, degraded: 'no_competitors', reason: 'все ответили' };
      if (l.startsWith('extract:')) return ext(l, p);
      if (l.startsWith('aggregate:')) return agg(l, p);
      if (l === 'catalog-analyst') return { domains_done: [], domains_failed: [] };
      return null;
    };
    const idx = (x, re) => x.calls.findIndex(c => re.test(c.label));
    const callsOf = (x, re) => x.calls.filter(c => re.test(c.label));
    const types2 = { types: ['home', 'service'], type_pages: { home: 1, service: 3 } };

    const n1 = await runWf({ ...baseArgs, ...types2, info_other: [] }, full());
    const L1 = labels(n1);
    const capCalls = callsOf(n1, /^capture:/), inv = callsOf(n1, /^inventory:/), mx = n1.calls.find(c => c.label === 'matrix'), aggs = callsOf(n1, /^aggregate:/);
    check('wf-02 обычный: Select (rank:check -> scout -> rank) до верификатора', !n1.e && L1.indexOf('rank:check') === 0 && L1.indexOf('scout') === 1 && L1.indexOf('rank') === 2 && L1.indexOf('verify') === 3, n1.e ? n1.e.stack : L1.join(', '));
    check('wf-02: снятие по доменам и own после инвентаризации, с --resume и дедлайном, в Bash с timeout 600000', capCalls.map(c => c.label).sort().join() === 'capture:d1.example,capture:d2.example,capture:own' && capCalls.every(c => inv.every(i => i.end < c.start) && / --resume --max-seconds 480/.test(c.prompt) && c.prompt.includes('capture-pages.mjs --domain') && c.prompt.includes('timeout 600000')), capCalls.map(c => c.prompt.split('\n')[1]).join(' | '));
    check('wf-02: разбор блоков параллельно ветке снятия (стартует до конца матрицы)', callsOf(n1, /^extract:/).some(e => e.start < mx.start) && callsOf(n1, /^extract:/).length > 0, JSON.stringify(n1.calls.map(c => [c.label, c.start, c.end])));
    const obsD2 = callsOf(n1, /^kf-observe:d2\.example/);
    check('wf-02 Look: --stale-observers после снятия, наблюдатель по частям плана; части одного домена по очереди', idx(n1, /^matrix:stale$/) > Math.max(...capCalls.map(c => L1.indexOf(c.label))) && obsD2.map(c => c.label).join() === 'kf-observe:d2.example:shell,kf-observe:d2.example:types' && obsD2[0].end < obsD2[1].start && obsD2.every(c => c.prompt.includes('prompts/02-kf-observer.md') && /mode=observe/.test(c.prompt)) && n1.calls.find(c => c.label === 'kf-observe:own')?.prompt.includes('role=own'), L1.join(', '));
    check('wf-02 Look: кандидаты -> нормализатор (есть x без алиасов) -> кандидаты снова -> перепроверка по доменам из списка', idx(n1, /^matrix:candidates$/) < idx(n1, /^kf-normalize$/) && idx(n1, /^kf-normalize$/) < idx(n1, /^matrix:candidates:2$/) && callsOf(n1, /^kf-recheck:/).map(c => c.label).sort().join() === 'kf-recheck:d2.example,kf-recheck:own' && callsOf(n1, /^kf-recheck:/).every(c => /mode=recheck/.test(c.prompt) && c.start > n1.calls.find(x => x.label === 'matrix:candidates:2').end), L1.join(', '));
    check('wf-02 Matrix: kf-matrix.mjs --shell после перепроверки, агрегатор после матрицы с kf=on', mx && mx.prompt.includes('kf-matrix.mjs --shell') && callsOf(n1, /^kf-recheck:/).every(c => c.end < mx.start) && aggs.length && aggs.every(a => a.start > mx.end && /; kf=on\./.test(a.prompt)), aggs.map(a => a.prompt.slice(-80)).join(' | '));
    check('wf-02: итог - select, kf (матрица), kf_status, limits', n1.r && n1.r.select && n1.r.select.fresh === false && n1.r.kf && n1.r.kf.matrix.rows === 30 && n1.r.kf_status === 'done' && Array.isArray(n1.r.limits), JSON.stringify(n1.r && { s: n1.r.select, k: n1.r.kf, st: n1.r.kf_status }));
    check('wf-02: info_other названия доходят до наблюдателя', (await runWf({ ...baseArgs, types: ['home', 'info_other'], type_pages: { home: 1, info_other: 1 }, info_other: ['Доставка'] }, full())).calls.find(c => c.label === 'kf-observe:d1.example').prompt.includes('info_other=["Доставка"]'));

    // повтор без resume: pool свежий - скаут не зовется, снятие с --resume
    const n2 = await runWf({ ...baseArgs, ...types2 }, full({ fresh: true }));
    check('wf-02 повтор: --check fresh - скаут не зовется, ранжирование идет, снятие только с --resume', !n2.e && !labels(n2).includes('scout') && labels(n2).includes('rank') && callsOf(n2, /^capture:/).every(c => / --resume/.test(c.prompt)) && n2.logs.some(m => /скаут не зовется/.test(m)), labels(n2).join(', '));
    check('wf-02: без узкой ниши верификатор без параметра note (текст вызова прежний)', !/note=/.test(n2.calls.find(c => c.label === 'verify').prompt) && n2.r.select.exhausted === false);
    // узкая ниша (интеграция G): --check fresh с exhausted - скаут не зовется, строка в method верификатора (note)
    const n2e = await runWf({ ...baseArgs, ...types2 }, full({ fresh: true, exhausted: true }));
    check('wf-02 узкая ниша: fresh + exhausted - скаут не зовется, верификатор получает note, select.exhausted', !n2e.e && !labels(n2e).includes('scout') && /Параметры: note="кандидатов меньше target: источники исчерпаны"/.test(n2e.calls.find(c => c.label === 'verify').prompt) && n2e.r.select.exhausted === true && n2e.logs.some(m => /источники исчерпаны - скаут не зовется/.test(m)), labels(n2e).join(', ') + JSON.stringify(n2e.r && n2e.r.select));
    const n2s = await runWf({ ...baseArgs, ...types2 }, full({ scoutExhausted: true }));
    check('wf-02 узкая ниша по ответу скаута (exhausted) - note верификатору, sources_done в итоге', !n2s.e && labels(n2s).includes('scout') && /note=/.test(n2s.calls.find(c => c.label === 'verify').prompt) && n2s.r.select.exhausted === true && n2s.r.select.scout.sources_done.length === 3, JSON.stringify(n2s.r && n2s.r.select));
    // сверка с порядком отбора: пропуск выше последнего годного - повтор верификатора с recheck, итог - второй список
    check('wf-02: после верификатора сверка с ranking.order (rank:order), пропусков нет - без повтора', idx(n2, /^rank:order$/) === idx(n2, /^verify$/) + 1 && !labels(n2).includes('verify:2'), labels(n2).join(', '));
    const ng = await runWf({ ...baseArgs, ...types2 }, full({ fresh: true, gap: ['d3.example'] }));
    check('wf-02: верификатор пропустил по порядку - verify:2 с recheck, дальше по второму списку', !ng.e && ng.calls.find(c => c.label === 'verify:2').prompt.includes('Параметры: recheck=["d3.example"]') && labels(ng).includes('inventory:d3.example') && !labels(ng).includes('inventory:d2.example') && ng.logs.some(m => /пропустил по порядку: d3.example/.test(m)), labels(ng).join(', '));
    const ng2 = await runWf({ ...baseArgs, ...types2 }, full({ fresh: true, gap: ['d3.example'], verify2: null }));
    check('wf-02: повтор верификатора без ответа - первый список и строка limits, не ошибка', !ng2.e && labels(ng2).includes('inventory:d2.example') && ng2.r.limits.some(m => /повторная проверка пропущенных/.test(m)), JSON.stringify(ng2.r && ng2.r.limits));
    const n3 = await runWf({ ...baseArgs, ...types2, reselect: true }, full({ fresh: true }));
    check('wf-02 reselect: без --check, скаут зовется', !labels(n3).includes('rank:check') && labels(n3).includes('scout'), labels(n3).join(', '));
    const n4 = await runWf({ ...baseArgs, ...types2, recapture: true }, full());
    check('wf-02 recapture: первый вызов снятия без --resume', callsOf(n4, /^capture:[^:]+$/).every(c => !/--resume/.test(c.prompt)), callsOf(n4, /^capture:/).map(c => c.prompt.split('\n')[1]).join(' | '));
    // partial: повтор с --resume не больше 2 раз
    let k = 0;
    const n5 = await runWf({ ...baseArgs, ...types2 }, full({ capture: l => out('KF_CAPTURE', { domain: domOf(l), chrome: true, ok: 1, partial: l.startsWith('capture:d1.example') ? true : (k++, false) }) }));
    const d1caps = callsOf(n5, /^capture:d1\.example/);
    check('wf-02 partial: повтор того же вызова с --resume не больше 2 раз, остаток - строка limits', d1caps.map(c => c.label).join() === 'capture:d1.example,capture:d1.example:2,capture:d1.example:3' && d1caps.every(c => / --resume/.test(c.prompt)) && d1caps[0].end < d1caps[1].start && n5.r.limits.some(l => /d1\.example: не уложилось в 3 захода/.test(l)) && callsOf(n5, /^capture:d2\.example/).length === 1, d1caps.map(c => c.label).join());
    // нет Chrome
    const n6 = await runWf({ ...baseArgs, ...types2 }, full({ chrome: false }));
    check('wf-02 нет Chrome: снятие skipped, наблюдение и матрица идут, строка ограничения', !n6.e && labels(n6).includes('matrix') && labels(n6).some(l => l.startsWith('kf-observe:')) && n6.r.limits.some(l => /нет Chrome/.test(l)) && n6.r.kf_status === 'no_chrome', JSON.stringify(n6.r && n6.r.limits));
    // лендинг
    const n7 = await runWf({ ...baseArgs, types: ['home'], type_pages: { home: 1 } }, full());
    check('wf-02 лендинг: отбор и снятие главных без инвентаризации, агрегатор home с kf=on', !n7.e && labels(n7).includes('scout') && !labels(n7).some(l => l.startsWith('inventory:')) && callsOf(n7, /^capture:/).length === 3 && n7.calls.find(c => c.label === 'aggregate:home').prompt.includes('kf=on'), labels(n7).join(', '));
    // skipInventory
    const snaps = [{ domain: 'd1.example', type: 'home', url: 'u', raw: 'work/competitors/raw/d1.example/home.json' }, { domain: 'd3.example', type: 'service', url: 'u2', raw: 'work/competitors/raw/d3.example/service-1.json' }];
    const n8 = await runWf({ ...baseArgs, ...types2, skipInventory: true, snapshots: snaps }, full());
    check('wf-02 skipInventory: без отбора и верификатора, снятие --resume по доменам снимков и own, агрегатор с kf=on', !n8.e && !labels(n8).some(l => /^(rank|scout|verify)/.test(l)) && callsOf(n8, /^capture:/).map(c => c.label).sort().join() === 'capture:d1.example,capture:d3.example,capture:own' && callsOf(n8, /^capture:/).every(c => /--resume/.test(c.prompt)) && labels(n8).includes('matrix') && callsOf(n8, /^aggregate:/).every(c => /kf=on/.test(c.prompt)), labels(n8).join(', '));
    // частичный разбор
    for (const key of ['extract_out', 'aggregate_out', 'extract_types', 'extract_domains']) {
      const val = key === 'extract_types' ? ['home'] : key === 'extract_domains' ? ['d1.example'] : `work/ab-${key}`;
      const n9 = await runWf({ ...baseArgs, ...types2, [key]: val }, full());
      check(`wf-02 ${key}: ни отбора, ни снятия, ни матрицы, work/kf не трогается; агрегатор читает готовую матрицу (kf=on)`, !n9.e && !labels(n9).some(l => /^(rank|scout|capture|kf-|matrix)/.test(l)) && labels(n9).includes('verify') && callsOf(n9, /^aggregate:/).every(c => /kf=on/.test(c.prompt)) && n9.r.kf_status === 'kept', labels(n9).join(', '));
    }
    // skipKf
    const n10 = await runWf({ ...baseArgs, ...types2, skipKf: true }, full());
    const st10 = n10.calls.find(c => c.label === 'matrix:status');
    check('wf-02 skipKf: без отбора и снятия, status skip, агрегатор kf=off', !n10.e && !labels(n10).some(l => /^(rank|scout|capture|kf-)/.test(l)) && st10 && st10.prompt.includes('kf-matrix.mjs --status skip') && callsOf(n10, /^aggregate:/).every(c => /kf=off/.test(c.prompt)) && n10.r.kf_status === 'skip', labels(n10).join(', '));
    // деградация
    const n11 = await runWf({ ...baseArgs, types: ['home', 'service'], type_pages: { home: 1, service: 3 } }, full({ verify: { ...verify([]), degraded: 'no_competitors' } }));
    const st11 = n11.calls.find(c => c.label === 'matrix:status');
    check('wf-02 без конкурентов: status no_competitors, без снятия, агрегатор kf=off и degraded', !n11.e && n11.r.degraded === 'no_competitors' && st11 && st11.prompt.includes('--status no_competitors') && !labels(n11).some(l => /^(capture|kf-|matrix$)/.test(l)) && callsOf(n11, /^aggregate:/).every(c => /kf=off/.test(c.prompt) && /degraded=no_competitors/.test(c.prompt)), labels(n11).join(', '));
    // план наблюдения не получен: наблюдатель по всем доменам и own
    const n13 = await runWf({ ...baseArgs, ...types2 }, (l, p) => (l === 'matrix:stale' ? null : full()(l, p)));
    check('wf-02: --stale-observers не ответил - наблюдатель по всем доменам и own, строка limits', !n13.e && callsOf(n13, /^kf-observe:/).map(c => c.label).sort().join() === 'kf-observe:d1.example,kf-observe:d2.example,kf-observe:own' && n13.calls.find(c => c.label === 'kf-observe:own').prompt.includes('role=own') && n13.r.limits.some(l => /план наблюдения не получен/.test(l)), labels(n13).join(', '));
    // нормализатор и перепроверка не нужны
    const n12 = await runWf({ ...baseArgs, ...types2 }, full({ cand: { x: 2, x_unaliased: 0, recheck: [] }, stale: [] }));
    check('wf-02: все kf-файлы свежие, x-элементы с алиасами, перепроверка не нужна - наблюдатель, нормализатор и перепроверка не зовутся', !n12.e && !labels(n12).some(l => /^kf-/.test(l)) && labels(n12).includes('matrix'), labels(n12).join(', '));

    // null на новых метках: итог старых сценариев тот же, без throw
    const NEW = /^(rank|scout|capture|kf-|matrix)/;
    const nulls = await runWf({ ...baseArgs, ...types2 }, (l, p) => (NEW.test(l) ? null : full()(l, p)));
    const base2 = await runWf({ ...baseArgs, ...types2, skipKf: true }, (l, p) => (NEW.test(l) ? null : full()(l, p)));
    const strip = r => JSON.stringify({ v: r.verify, d: r.degraded, i: r.inventories, x: r.extracted, a: r.aggregated });
    check('wf-02: null на всех новых метках - без throw, итог разбора и агрегации тот же, строки limits', !nulls.e && !base2.e && strip(nulls.r) === strip(base2.r) && nulls.r.limits.length >= 3 && nulls.r.limits.some(l => /скаут не вернул ответ/.test(l)) && nulls.r.limits.some(l => /матрица КФ не построена/.test(l)), nulls.e ? nulls.e.stack : JSON.stringify(nulls.r.limits));
    const thrown = await runWf({ ...baseArgs, ...types2 }, (l, p) => { if (/^(capture|kf-observe|matrix)/.test(l)) throw new Error('среда упала'); return full()(l, p); });
    check('wf-02: исключение run-агента или наблюдателя - строка limits, фаза идет дальше', !thrown.e && labels(thrown).some(l => l.startsWith('aggregate:')) && thrown.r.limits.some(l => /сбой агента: среда упала/.test(l)), thrown.e ? thrown.e.stack : JSON.stringify(thrown.r.limits));

    // роли и модели новых меток
    const i0 = SRC.indexOf('const ROLES = {');
    const roles = new Function(`return (${SRC.slice(SRC.indexOf('{', i0), SRC.indexOf('\n}', i0) + 2)})`)();
    const NEWROLES = { scout: 'light', rank: 'light', capture: 'light', 'kf-observe': 'light', 'kf-normalize': 'light', 'kf-recheck': 'light', matrix: 'light' };
    check('wf-02: роли раздела 5 в таблице ROLES (все light), прежние без изменений', Object.entries(NEWROLES).every(([k, v]) => roles[k] === v) && roles.extract === 'strong' && roles.aggregate === 'strong' && roles.verify === 'light', JSON.stringify(roles));
    const LABELS = [[/^prep-args(:prune)?$/, 'prep-args'], [/^verify(:2)?$/, 'verify'], [/^inventory:/, 'inventory'], [/^extract:/, 'extract'], [/^aggregate:/, 'aggregate'], [/^catalog-analyst$/, 'catalog-analyst'],
      [/^scout$/, 'scout'], [/^rank(:check|:order)?$/, 'rank'], [/^capture:/, 'capture'], [/^kf-observe:/, 'kf-observe'], [/^kf-normalize$/, 'kf-normalize'], [/^kf-recheck:/, 'kf-recheck'], [/^matrix(:(stale|candidates(:2)?|status))?$/, 'matrix']];
    const roleOf = l => (LABELS.find(([re]) => re.test(l)) || [])[1];
    const all = [...n1.calls, ...n5.calls, ...n10.calls, ...n11.calls];
    const off = all.filter(c => !roleOf(c.label) || c.model !== (roles[roleOf(c.label)] === 'light' ? 'LIGHT' : 'STRONG')).map(c => `${c.label}=${c.model}`);
    check('wf-02: у каждого вызова роль из таблицы и модель своего яруса (новые метки - для workflow-models)', !off.length, off.join(', '));
    const used = new Set(all.map(c => roleOf(c.label)));
    check('wf-02: каждая новая роль вызвана в сценариях', Object.keys(NEWROLES).every(r => used.has(r)), [...used].join(', '));
    const mo = await runWf({ ...baseArgs, ...types2, models: { capture: 'CAP', matrix: 'MX' } }, full());
    check('wf-02: args.models переопределяет новые роли точечно', callsOf(mo, /^capture:/).every(c => c.model === 'CAP') && callsOf(mo, /^matrix/).every(c => c.model === 'MX') && callsOf(mo, /^kf-observe:/).every(c => c.model === 'LIGHT'));
  }

  // ================================================================== 5. стиль, UUID, ниша - новые файлы пакета
  {
    const YO = String.fromCharCode(0x451), YO2 = String.fromCharCode(0x401), D1 = String.fromCharCode(0x2014), D2 = String.fromCharCode(0x2013);
    const INVIS = [0xad, 0x200b, 0x200c, 0x200d, 0x2060, 0xfeff].map(c => String.fromCharCode(c));
    const NICHE = /(застройщ|депозит|квот[аеуы]|инвестор|недвижим|ипотек|новострой|апартамент|доходност|ювелир|золот|кольц|пирсинг|бриллиант|серебр|помолвоч|обручал|геммолог|пхукет|двигател|запчаст|trade-in|автомобил|goldax)/i;
    const OWN = ['scripts/kf-matrix.mjs', 'prompts/02-kf-observer.md', 'prompts/02-kf-normalizer.md', 'schemas/kf-matrix.schema.json', 'schemas/shell.schema.json', 'schemas/kf-status.schema.json', 'schemas/kf-observed.schema.json', 'workflows/wf-02-competitors.js'];
    const bad = [];
    for (const f of OWN) {
      const t = read(f);
      if ([YO, YO2, D1, D2].some(ch => t.includes(ch))) bad.push(`${f}: е с точками или длинное тире`);
      if (INVIS.some(ch => t.includes(ch))) bad.push(`${f}: невидимый символ литералом`);
      if (/mcp__[0-9a-f]{8}-/.test(t)) bad.push(`${f}: UUID MCP`);
      const nm = t.match(NICHE); if (nm) bad.push(`${f}: нишевое слово «${nm[0]}»`);
    }
    check('файлы пакета B (матрица, промты, схемы, wf-02): без е с точками, длинных тире, невидимых символов, UUID MCP и ниши', !bad.length, bad.join('; '));
    const BUDGET = { 'prompts/02-kf-observer.md': 4500, 'prompts/02-kf-normalizer.md': 2000 };
    for (const [f, n] of Object.entries(BUDGET)) { const len = read(f).length; check(`${f}: размер в бюджете (${n} знаков)`, len <= n, `${len} знаков`); }
    const obs = read('prompts/02-kf-observer.md'), nrm = read('prompts/02-kf-normalizer.md');
    check('02-kf-observer: только видимое, «?» и ambiguous, отсутствие не перечислять, x-<латиница> с kind и needs_hint, нишевые блоки обязательно, режим recheck 1/0/«?»', obs.includes('`x-<латиница через дефис>`') && obs.includes('`needs_hint`') && obs.includes('Нишевые блоки и элементы фиксируй') && obs.includes('Отсутствующее не') && obs.includes('`ambiguous`') && obs.includes('## Режим recheck') && obs.includes('строго 1 (есть), 0') && obs.includes('новых x-элементов не добавляй') && obs.includes('не больше 12') && obs.includes('не выше «?»'));
    check('02-kf-normalizer: сведение в той же зоне и scope, элементы не удаляет, значения не меняет, aliases.json', nrm.includes('в той же зоне и scope') && nrm.includes('Элементы не удаляй, значения наблюдателей не меняй') && nrm.includes('`work/kf/aliases.json`'));
  }
} catch (e) {
  fail++; failures.push(`FAIL исключение: ${e.stack || e.message}`);
} finally {
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* временная папка */ }
}

notes.forEach(n => console.log(`NOTE ${n}`));
failures.forEach(f => console.log(f));
console.log(`cases-kf-matrix: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
