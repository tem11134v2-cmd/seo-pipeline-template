// Пакет E программы 05.10 (КФ и КНДР): таблица для заказчика и отчет. Запуск:
//   node .claude/tests/site-tekst/cases-kf-xlsx.mjs      код выхода 0 - все прошли.
// Файлы пакета: kit scripts/build-kf-xlsx.mjs, schemas/kf-publish.schema.json, scripts/report.mjs.
// Все во временной папке (os.tmpdir()), синтетические данные, без сети и без данных клиентов. Входы других пакетов
// (work/kf/matrix.json, status.json, work/shell.json, ranking.json, pool.json, competitors.json, prototype.modules.json ->
// shell, brief.stubs, work/audit/site.json) - фикстуры по контрактам разделов 3.1-3.7 программы. exceljs - от node_modules
// шаблона (переменная SITE_TEKST_NODE_MODULES, как jsdom в cases-kf-site); нет exceljs - проверки xlsx SKIP с причиной.
// Разделы: 1. без матрицы - таблица не строится, отчет как раньше (старая задача) и с причиной (status.json);
// 2. листы и шапки (ExcelJS readFile), группы, «Сумма элементов», колонка «В прототипе», цвета; без own - без колонки
// «Ваш сайт сейчас»; 3. data_sha стабилен и меняется от ячейки; 4. --record (тот же data_sha - без revisions, новый -
// прежний в revisions; skipped; схема kf-publish); 5. отчет с новыми разделами (вопросы с основанием, заглушка вместо
// вопроса о выпадении, declined без вопроса, рекомендации страниц, аудит прототипа, cta-unify); 7. правки по рецензии
// (зона строки оболочки, js_only, кириллический домен, отбор без ranking и Keys.so, чип без needs_hint, cta-unify
// partial и счет правок, skipped при том же data_sha, --record без матрицы); 6. стиль, UUID и ниша.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TPL = path.resolve(HERE, '..', '..', 'skills', 'site-tekst', 'kit');
let pass = 0, fail = 0, skip = 0;
const failures = [], notes = [];
function check(name, ok, detail = '') {
  if (ok) pass++;
  else { fail++; failures.push(`FAIL ${name}${detail ? ': ' + String(detail).slice(0, 600) : ''}`); }
}
function skipped(name, why) { skip++; notes.push(`SKIP ${name}: ${why}`); }
const rj = f => JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, ''));
const wj = (f, o) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(o, null, 2) + '\n'); };
const read = f => fs.readFileSync(path.join(TPL, f), 'utf8');
let NM = '', ExcelJS = null;
try {
  const p = createRequire(import.meta.url).resolve('exceljs');
  NM = p.slice(0, p.lastIndexOf(`${path.sep}node_modules${path.sep}`) + `${path.sep}node_modules`.length);
  ExcelJS = createRequire(import.meta.url)('exceljs');
} catch { NM = ''; }
const ENV = NM ? { SITE_TEKST_NODE_MODULES: NM } : {};
function run(cwd, args) {
  const r = spawnSync(process.execPath, args, { cwd, encoding: 'utf8', env: { ...process.env, ...ENV }, timeout: 240000 });
  let json = null;
  try { json = JSON.parse((r.stdout || '').trim().split(/\r?\n/).pop()); } catch { json = null; }
  return { code: r.status, stdout: r.stdout || '', out: (r.stdout || '') + (r.stderr || ''), json };
}
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cases-kf-xlsx-'));
const lib = await import(pathToFileURL(path.join(TPL, 'scripts', 'lib.mjs')).href);
const SCH = n => rj(path.join(TPL, 'schemas', `${n}.schema.json`));

// ---------- фикстуры ----------
function mkProject(name, { kf = true, own = true } = {}) {
  const dir = path.join(tmpRoot, name);
  for (const d of ['scripts', 'rules', 'schemas', 'config']) fs.cpSync(path.join(TPL, d), path.join(dir, d), { recursive: true });
  const cfg = rj(path.join(dir, 'config', 'project.json'));
  cfg.company = 'Тест.Компания'; cfg.slug = 'test'; cfg.site_url = 'https://own.example/';
  wj(path.join(dir, 'config', 'project.json'), cfg);
  const page = (slug, type, i, extra = {}) => ({ slug, url: i ? `/${slug}` : '/', type, subject: extra.subject || slug, parent: i ? '/' : '', level: i ? 1 : 0, segment: 'S1', status: 'briefed', ...extra });
  wj(path.join(dir, 'work', 'sitemap.json'), { source: 'test', page_types: ['home', 'service'], pages: [page('home', 'home', 0), page('s1', 'service', 1), page('s2', 'service', 2), page('legal', 'info_other', 3, { status: 'skip', ui_role: 'legal' })] });
  const brief = (slug, type, blocks, extra = {}) => wj(path.join(dir, 'work', 'pages', slug, 'brief.json'), { slug, url: `/${slug}`, type, subject: slug, segment: { id: 'S1', name: 'Все' }, facts: [], blocks: blocks.map(([block_id, t, name, role]) => ({ block_id, type: t, name, role: role || 'conversion' })), ...extra });
  brief('home', 'home', [['B01-hero', 'hero', 'Первый экран', 'hero']]);
  brief('s1', 'service', [['B01-hero', 'hero', 'Первый экран', 'hero'], ['B02-reviews', 'reviews', 'Отзывы'], ['B03-steps', 'steps', 'Как работаем']],
    kf ? { stubs: [{ type: 'prices', name: 'Цены', after: 'B02-reviews', needs: ['цены на услуги'], kf_el: 'prices', level: 'recommended' }] } : {});
  brief('s2', 'service', [['B01-hero', 'hero', 'Первый экран', 'hero'], ['B02-reviews', 'reviews', 'Отзывы'], ['B03-steps', 'steps', 'Как работаем'], ['B04-prices', 'prices', 'Цены']]);
  // блоки и lint pass - чтобы прогресс страниц был «написано» там, где текст есть
  const block = (slug, id, text) => {
    wj(path.join(dir, 'work', 'pages', slug, 'blocks', `${id}.json`), { block_id: id, elements: [{ kind: 'text', text }] });
    wj(path.join(dir, 'work', 'audit', slug, `lint-${id}.json`), { verdict: 'pass', findings: [] });
  };
  block('home', 'B01-hero', 'Текст главной');
  block('s1', 'B01-hero', 'Текст первого экрана услуги'); block('s1', 'B02-reviews', 'Отзывы клиентов');
  block('s2', 'B01-hero', 'Первый экран второй услуги'); block('s2', 'B04-prices', 'Цены второй услуги');
  wj(path.join(dir, 'work', 'output', 'prototype.index.json'), { home: { 'B01-hero': 'Текст главной' }, s1: { 'B01-hero': 'Текст первого экрана услуги', 'B02-reviews': 'Отзывы клиентов' }, s2: { 'B01-hero': 'Первый экран второй услуги', 'B04-prices': 'Цены второй услуги' } });
  // старые вопросы сборки брифов о выпадении блока prices на s1 (до заглушек): отчет их не дублирует при заглушке
  wj(path.join(dir, 'work', 'briefs-report.json'), {
    pages: { s1: { excluded: [], dropped: [{ block: 'prices', reason: 'нет фактов' }], questions: [{ text: 'Нужны факты для блока «Цены»: сколько стоит услуга', blocks: ['prices'] }] } },
    questions: [{ text: 'Нужны факты для блока «Цены»: сколько стоит услуга', pages: ['s1'], blocks: ['prices'] }],
    warnings: kf ? ['s2: элемент лидеров снят стратегом: блок cases («Кейсы», cases) - exclude_blocks; нет кейсов'] : [],
  });
  const mods = { catalog: { on: false, why: 'нет страниц listing', source: 'sitemap' } };
  if (kf) {
    mods.shell = { on: true, why: 'элементов 6', source: 'work/shell.json', items: [
      { id: 'phone', name: 'Телефон', zone: 'header', level: 'must', coverage: '5/5', niche: false, state: 'declined' },
      { id: 'search', name: 'Поиск', zone: 'header', level: 'recommended', coverage: '3/5', niche: false, state: 'function' },
      { id: 'legal_line', name: 'Реквизиты', zone: 'footer', level: 'must', coverage: '4/5', niche: false, state: 'chip' },
      { id: 'delivery', name: 'Доставка и оплата', zone: 'footer', level: 'recommended', coverage: '2/5', niche: false, state: 'page_missing' },
      { id: 'up_button', name: 'Кнопка наверх', zone: 'fixed', level: 'recommended', coverage: '2/5', niche: false, state: 'shown' },
      { id: 'x-warranty-badge', name: 'Плашка гарантии', zone: 'header', level: 'recommended', coverage: '3/5', niche: true, state: 'chip' },
    ] };
  }
  wj(path.join(dir, 'work', 'output', 'prototype.modules.json'), mods);
  if (!kf) return dir;
  // матрица по §3.3 (пакет B): domains с role, строки (scope, zone, id), values, own, already, sums
  const C = ['a.example', 'b.example', 'xn--80atjc.example', 'd.example', 'e.example'];
  const v = (...xs) => Object.fromEntries(C.map((d, i) => [d, xs[i]]));
  const row = (scope, zone, id, name, kind, values, level, extra = {}) => {
    const n = Object.values(values).filter(x => x === 1).length;
    return { scope, zone, id, name, kind, level, n, N: 5, values, own: own ? 0 : null, already: false, ...extra };
  };
  const rows = [
    row('site', 'header', 'phone', 'Телефон', 'slot', v(1, 1, 1, 1, 1), 'must', { own: own ? 1 : null, already: own }),
    row('site', 'header', 'search', 'Поиск', 'function', v(1, 1, 1, 0, 0), 'recommended'),
    row('site', 'header', 'x-warranty-badge', 'Плашка гарантии', 'slot', v(1, 1, 1, 0, 0), 'recommended', { x: true }),
    row('site', 'footer', 'legal_line', 'Реквизиты', 'slot', v(1, 1, 1, 1, 0), 'must'),
    row('site', 'footer', 'delivery', 'Доставка и оплата', 'page_link', v(1, 1, 0, 0, 0), 'recommended'),
    row('site', 'mobile', 'callback', 'Обратный звонок', 'function', v(1, '?', 0, 0, 0), 'optional'),
    row('site', 'fixed', 'up_button', 'Кнопка наверх', 'function', v(1, 0, 1, 0, 0), 'recommended'),
    row('service', 'body', 'reviews', 'Отзывы', 'block', v(1, 1, 1, 1, 0), 'must'),
    row('service', 'body', 'rating', 'Рейтинг', 'slot', v(1, 1, 1, 0, 0), 'recommended'),
    row('service', 'body', 'prices', 'Цены', 'block', v(1, 1, 0, 0, 0), 'recommended'),
    row('service', 'body', 'steps', 'Этапы работы', 'block', v(1, 0, 1, 0, 0), 'recommended'),
    row('service', 'body', 'x-guarantee-card', 'Гарантийный талон', 'block', v(1, 1, 1, 0, 0), 'recommended', { x: true }),
    row('home', 'body', 'schema_org', 'Разметка Schema.org', 'block', v(1, 1, 1, 1, 0), 'must', { visible: false }),
  ];
  const sums = Object.fromEntries(C.map(d => [d, rows.filter(r => r.values[d] === 1).length]));
  if (own) sums['own.example'] = 1;
  const domains = [...C.map(d => ({ domain: d, role: 'competitor', pages: 3, captured: 3, observed: true })), ...(own ? [{ domain: 'own.example', role: 'own', pages: 1, captured: 1, observed: true }] : [])];
  wj(path.join(dir, 'work', 'kf', 'matrix.json'), { generated_at: '2026-10-05 10:00:00', target: 5, must_n: 4, recommended_n: 2, site_kind: 'multipage', mode: 'frames', domains, scopes: [{ scope: 'site', N: 5 }, { scope: 'service', N: 5 }, { scope: 'home', N: 5 }], rows, sums, limits: ['охват неполный: e.example без страницы услуги'] });
  wj(path.join(dir, 'work', 'kf', 'status.json'), { status: 'done', generated_at: '2026-10-05 10:00:00', competitors: 5, rows: rows.length });
  wj(path.join(dir, 'work', 'shell.json'), { generated_at: '2026-10-05 10:00:00', n_competitors: 5, items: [
    { id: 'legal_line', name: 'Реквизиты', zone: 'footer', level: 'must', coverage: '4/5', kind: 'slot', render: 'legal_line', needs: ['company.legal_inn'], needs_hint: 'ИНН и ОГРН для подвала', page_match: null, niche: false },
    { id: 'x-warranty-badge', name: 'Плашка гарантии', zone: 'header', level: 'recommended', coverage: '3/5', kind: 'slot', render: 'generic', needs: [], needs_hint: 'срок гарантии', page_match: null, niche: true },
  ] });
  wj(path.join(dir, 'work', 'page-types', 'service.json'), { type: 'service', sources: [], market_blocks: [], differentiation_blocks: [], recommended_order: ['hero', 'reviews', 'steps', 'prices'], cliches_to_avoid: [], kf_coverage: [
    { el: 'reviews', name: 'Отзывы', level: 'must', n: 4, to: 'reviews', why: '' },
    { el: 'rating', name: 'Рейтинг', level: 'recommended', n: 3, to: 'hero', why: 'badges первого экрана' },
    { el: 'prices', name: 'Цены', level: 'recommended', n: 2, to: 'prices', why: '' },
    { el: 'steps', name: 'Этапы работы', level: 'recommended', n: 2, to: 'steps', why: '' },
    { el: 'x-guarantee-card', name: 'Гарантийный талон', level: 'recommended', n: 3, to: 'skip', why: 'нет такой сущности у бизнеса' },
  ] });
  // отбор (§3.1): pool, ranking, competitors
  const cand = (domain, extra = {}) => ({ domain, domain_unicode: domain, sources: ['serp'], serp: { top1: 1, top3: 2, top5: 3, top10: 6, queries: 10, share: 0.6 }, keyso: { top10: 120, top50: 400, traffic: 3000, pages: 500 }, keyso_status: 'ok', history: null, iks: 300, created: '2010-01-01', ...extra });
  wj(path.join(dir, 'work', 'competitors', 'pool.json'), { generated_at: 'x', input_sha: 'abcdef0123', region: { keyso_base: 'msk', yandex_id: 213, city: 'Москва', city_not_in_keyso: false }, queries: ['услуга'], candidates: [...C.map(d => cand(d, d.startsWith('xn--') ? { domain_unicode: 'тест.example' } : {})), cand('agg.example', { sources: ['serp', 'analysis'] }), cand('slow.example', { keyso: null, keyso_status: 'not_found' })], own: [{ domain: 'own.example', domain_unicode: 'own.example', serp: { share: 0.1, top10: 1, queries: 10 }, keyso: null, iks: 10 }], rejected: [], errors: [] });
  const rc = (domain, i, extra = {}) => ({ domain, stop: '', weight: 90 - i * 10, effective: 90 - i * 10, coverage: 1, age_years: 3 + i * 4, age_class: i === 2 ? 'old' : i ? 'mid' : 'young', growth: i ? 'flat' : 'up', site_type: 'medium', metrics_used: ['share'], reason: '', ...extra });
  wj(path.join(dir, 'work', 'competitors', 'ranking.json'), { generated_at: 'x', params: { target: 5 }, order: [...C, 'slow.example'], anchors: ['xn--80atjc.example'], warnings: ['эталон без подтвержденного возраста: нет'], candidates: [...C.map((d, i) => rc(d, i)), rc('slow.example', 6, { weight: null, effective: null }), rc('agg.example', 7, { stop: 'стоп-лист: агрегатор' })] });
  wj(path.join(dir, 'work', 'competitors', 'competitors.json'), { verified_at: 'x', method: 'по ranking', competitors: C.map((d, i) => ({ domain: d, status: 'ok', source: 'serp', rank: i + 1, anchor: i === 2 })) });
  wj(path.join(dir, 'work', 'competitors', 'capture.json'), { chrome: 'chrome.exe', pages: [{ domain: 'e.example', name: 'service-1', status: 'antibot', reason: 'проверка' }] });
  // аудит прототипа (§3.7)
  wj(path.join(dir, 'work', 'audit', 'site.json'), { scope: 'site', producer: 'site-auditor', verdict: 'fix', summary: 'три находки', findings: [
    { id: 's1', page: 's1', block_id: 'B01-hero', severity: 'major', category: 'logic', rule: 'site.first-screen', problem: 'первый экран не говорит, что за услуга', status: 'fixed', resolution: 'H1 уточнен' },
    { id: 's2', page: 's2', block_id: 'B02-reviews', severity: 'major', category: 'fact', rule: 'site.trust', problem: 'нет срока гарантии на страницах услуг', proposal: 'срок гарантии на работы', needs_fact: true, status: 'open' },
    { id: 's3', zone: 'header', severity: 'minor', category: 'structure', rule: 'site.shell', problem: 'в шапке две кнопки одного действия', status: 'open' },
  ], cta_unify: [{ action: 'lead', label: 'Оставить заявку', variants: ['Оставить заявку', 'Отправить заявку'], applied: [{ page: 's1', blocks: ['B01-hero'] }] }],
    run: { steps: [{ name: 'digest', status: 'ok' }, { name: 'fixer s2', status: 'error', reason: 'timeout' }], errors: [] } });
  return dir;
}
const xlsxOf = d => path.join(d, 'work', 'output', 'kf-kndr.xlsx');
const reportOf = d => fs.readFileSync(path.join(d, 'work', 'output', 'report.md'), 'utf8');
const sectionOf = (md, h) => { const i = md.indexOf(`## ${h}`); if (i < 0) return ''; const j = md.indexOf('\n## ', i + 3); return md.slice(i, j < 0 ? undefined : j); };
async function sheetRows(file) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  return wb.worksheets.map(ws => {
    const rows = [];
    ws.eachRow({ includeEmpty: true }, (r, n) => { rows[n - 1] = r; });
    const val = c => { const v = c.value; return v === null || v === undefined ? '' : typeof v === 'object' && v.richText ? v.richText.map(x => x.text).join('') : v; };
    return { name: ws.name, ws, cells: rows.map(r => (r ? Array.from({ length: ws.columnCount }, (_, i) => val(r.getCell(i + 1))) : [])) };
  });
}

try {
  // ================================================================ 1. без матрицы: таблицы нет, отчет как раньше
  {
    const D = mkProject('old', { kf: false });
    const b = run(D, ['scripts/build-kf-xlsx.mjs']);
    check('без матрицы: build-kf-xlsx код 0, path null, xlsx и meta не пишутся', b.code === 0 && b.json && b.json.path === null && /анализ КФ не проводился: задача начата до этапа КФ/.test(b.json.skipped) && !fs.existsSync(xlsxOf(D)) && !fs.existsSync(path.join(D, 'work', 'output', 'kf-xlsx.meta.json')), b.out);
    const r = run(D, ['scripts/report.mjs']);
    const md = r.code === 0 ? reportOf(D) : '';
    check('старая задача: отчет без новых разделов и строки таблицы', r.code === 0 && !/## Шапка, подвал и элементы лидеров/.test(md) && !/## Аудит прототипа/.test(md) && !/Таблица КФ\/КНДР/.test(md) && !/основание:/.test(md) && !/таблица КФ/.test(r.stdout), r.out + md.slice(0, 600));
    check('старая задача: вопрос о выпадении блока - как раньше (заглушек нет)', /- Нужны факты для блока «Цены»: сколько стоит услуга \(s1\/prices\)/.test(sectionOf(md, 'Что спросить у заказчика')), sectionOf(md, 'Что спросить у заказчика'));
    // этап был, но без конкурентов: строка с причиной, таблица не строится
    wj(path.join(D, 'work', 'kf', 'status.json'), { status: 'no_competitors', generated_at: 'x' });
    const b2 = run(D, ['scripts/build-kf-xlsx.mjs']);
    check('no_competitors: таблица не строится, причина в stdout', b2.code === 0 && b2.json && b2.json.path === null && /нет доступных конкурентов/.test(b2.json.skipped), b2.out);
    run(D, ['scripts/report.mjs']);
    const md2 = reportOf(D);
    check('no_competitors: «Таблица КФ/КНДР: нет: <причина>» в сводке и строка раздела', /- Таблица КФ\/КНДР: нет: нет доступных конкурентов/.test(sectionOf(md2, 'Сводка')) && /Анализ КФ не проводился: нет доступных конкурентов/.test(sectionOf(md2, 'Шапка, подвал и элементы лидеров')), md2.slice(0, 1500));
    check('no_competitors: kf-publish.json не пишется', !fs.existsSync(path.join(D, 'work', 'output', 'kf-publish.json')));
  }

  // ================================================================ 2-4. таблица
  const D = mkProject('full');
  if (!ExcelJS) skipped('таблица КФ/КНДР (xlsx)', 'exceljs не найден от шаблона (npm install в корне шаблона)');
  else {
    const b = run(D, ['scripts/build-kf-xlsx.mjs']);
    check('build-kf-xlsx: код 0, stdout {path, drive_name, data_sha}', b.code === 0 && b.json && b.json.path === 'work/output/kf-kndr.xlsx' && /^[0-9a-f]{64}$/.test(b.json.data_sha) && fs.existsSync(xlsxOf(D)), b.out);
    check('drive_name без точек: «КФ и КНДР - <компания>»', b.json && b.json.drive_name === 'КФ и КНДР - Тест Компания' && !b.json.drive_name.includes('.'), b.json && b.json.drive_name);
    const meta = rj(path.join(D, 'work', 'output', 'kf-xlsx.meta.json'));
    check('kf-xlsx.meta.json: data_sha и имя как в stdout, need_publish при первой сборке', meta.data_sha === b.json.data_sha && meta.drive_name === b.json.drive_name && b.json.need_publish === true, JSON.stringify(meta));
    const sheets = await sheetRows(xlsxOf(D));
    check('листы по порядку', sheets.map(s => s.name).join('|') === 'Как читать|Отбор конкурентов|Сравнение|Ограничения', sheets.map(s => s.name).join('|'));
    const [readme, sel, cmp, lim] = sheets;
    check('«Как читать»: КФ, КНДР, обозначения, решение с порогами из матрицы', readme.cells[0].join('|') === 'Тема|Пояснение' && readme.cells.some(r => r[0] === 'Что такое КФ') && readme.cells.some(r => r[0] === 'Что такое КНДР') && readme.cells.some(r => r[0] === 'Обозначения' && /«\?»/.test(r[1])) && readme.cells.some(r => r[0] === 'Решение' && /у 4 и более лидеров из 5; «рекомендовано» - у 2-3/.test(r[1])), JSON.stringify(readme.cells.slice(0, 7)));
    check('«Отбор конкурентов»: шапка', sel.cells[0].join('|') === 'Домен|Источник|Доля в выдаче ниши|ТОП-10|ТОП-50|Трафик|ИКС|Возраст, лет|Рост|Тип сайта|Вес|Место|Итог', sel.cells[0].join('|'));
    const selRow = d => sel.cells.find(r => r[0] === d) || [];
    check('«Отбор конкурентов»: в анализе, эталон, не взят (стоп и не проверялся), домен по-русски, ваш сайт', selRow('a.example')[12] === 'в анализе' && selRow('тест.example')[12] === 'в анализе, эталон' && selRow('agg.example')[12] === 'не взят: стоп-лист: агрегатор' && /^не взят: не проверялся/.test(selRow('slow.example')[12]) && selRow('own.example')[12] === 'ваш сайт' && selRow('a.example')[2] === '60%' && selRow('a.example')[11] === 1, JSON.stringify(sel.cells));
    const H = cmp.cells[0];
    check('«Сравнение»: шапка - Элемент | лидеры | Ваш сайт сейчас | Охват | Решение | В прототипе | Комментарий', H.join('|') === 'Элемент|a.example|b.example|тест.example|d.example|e.example|Ваш сайт сейчас|Охват|Решение|В прототипе|Комментарий', H.join('|'));
    check('«Сравнение»: первая строка - «Сумма элементов» по сайтам', cmp.cells[1][0] === 'Сумма элементов' && cmp.cells[1][1] === 13 && cmp.cells[1][6] === 1, JSON.stringify(cmp.cells[1]));
    const groups = cmp.cells.filter((r, i) => i > 1 && r[1] === r[0] && r[0] && cmp.ws.getCell(i + 1, 1).isMerged).map(r => r[0]);
    check('«Сравнение»: группы строкой-заголовком с объединением, по порядку', groups.join('|') === 'Шапка|Подвал|Мобильная версия|Закрепленные элементы|Услуга|Для разработчика', groups.join('|'));
    check('«Сравнение»: невидимый элемент - в «Для разработчика», группы «Главная» нет (видимых строк нет)', groups.at(-1) === 'Для разработчика' && !groups.includes('Главная'), groups.join('|'));
    const C = name => cmp.cells.findIndex(r => r[0] === name);
    const cell = (name, col) => (cmp.cells[C(name)] || [])[H.indexOf(col)];
    check('«Сравнение»: +/-/?, охват n из N, решение и «уже есть»', cell('Телефон', 'a.example') === '+' && cell('Поиск', 'd.example') === '-' && cell('Обратный звонок', 'b.example') === '?' && cell('Телефон', 'Охват') === '5 из 5' && cell('Телефон', 'Решение') === 'обязательно; уже есть' && cell('Телефон', 'Ваш сайт сейчас') === '+' && cell('Обратный звонок', 'Решение') === 'по желанию', JSON.stringify(cmp.cells[C('Телефон')]));
    check('«В прототипе»: оболочка - declined, нужны данные, функция, нужна страница, есть', cell('Телефон', 'В прототипе') === 'нет, решение заказчика' && cell('Реквизиты', 'В прототипе') === 'нужны данные' && cell('Поиск', 'В прототипе') === 'функция' && cell('Доставка и оплата', 'В прототипе') === 'нужна страница' && cell('Кнопка наверх', 'В прототипе') === 'есть' && cell('Обратный звонок', 'В прототипе') === 'нет (по желанию)',['Телефон', 'Реквизиты', 'Поиск', 'Доставка и оплата', 'Кнопка наверх', 'Обратный звонок'].map(n => cell(n, 'В прототипе')).join('|'));
    check('«В прототипе»: тип - есть на 1 из 2 (страница и причина в комментарии), не написано, нужны данные, элементом блока, skip', cell('Отзывы', 'В прототипе') === 'есть на 1 из 2' && /s2: не написано/.test(cell('Отзывы', 'Комментарий')) && cell('Этапы работы', 'В прототипе') === 'не написано' && cell('Цены', 'В прототипе') === 'нужны данные' && /заглушка: s1/.test(cell('Цены', 'Комментарий')) && cell('Рейтинг', 'В прототипе') === 'есть (элементом блока «Первый экран»)' && cell('Гарантийный талон', 'В прототипе') === 'нет: нет такой сущности у бизнеса', ['Отзывы', 'Этапы работы', 'Цены', 'Рейтинг', 'Гарантийный талон'].map(n => `${cell(n, 'В прототипе')} / ${cell(n, 'Комментарий')}`).join(' | '));
    check('«Сравнение»: x-элемент - пометка ниши, подсказка данных у чипа', /элемент ниши/.test(cell('Плашка гарантии', 'Комментарий')) && cell('Плашка гарантии', 'В прототипе') === 'нужны данные', cell('Плашка гарантии', 'Комментарий'));
    check('«Сравнение»: невидимая строка - «для разработчика», в комментарии тип страницы, без пометки о непокрытии', cell('Разметка Schema.org', 'В прототипе') === 'для разработчика (в прототипе не показывается)' && cell('Разметка Schema.org', 'Комментарий') === 'Главная', `${cell('Разметка Schema.org', 'В прототипе')} / ${cell('Разметка Schema.org', 'Комментарий')}`);
    const how = (readme.cells.find(r => r[0] === 'Как отбирали лидеров') || [])[1] || '';
    check('«Как читать»: отбор по данным - выдача, метрики сервисов, 5 сайтов, эталон в сравнении', /по выдаче Яндекса/.test(how) && /сервисах оценки сайтов/.test(how) && /ТОП-10 и ТОП-50/.test(how) && /В сравнение взяли 5 сайтов/.test(how) && /Среди них есть эталон/.test(how) && !/без Keys\.so/.test(how), how);
    const fillOf = (name, col) => { const c = cmp.ws.getCell(C(name) + 1, H.indexOf(col) + 1); return c.fill && c.fill.fgColor ? c.fill.fgColor.argb : ''; };
    check('цвета: обязательно - prio_high, рекомендовано - prio_medium, по желанию - без заливки, «уже есть» - отдельный, «?» - курсив', fillOf('Реквизиты', 'Элемент') === 'FFE2EFDA' && fillOf('Поиск', 'Элемент') === 'FFFFF2CC' && !fillOf('Обратный звонок', 'Элемент') && fillOf('Телефон', 'Решение') && fillOf('Телефон', 'Решение') !== 'FFE2EFDA' && cmp.ws.getCell(C('Обратный звонок') + 1, H.indexOf('b.example') + 1).font.italic === true && !cmp.ws.getCell(C('Обратный звонок') + 1, H.indexOf('a.example') + 1).font.italic, [fillOf('Реквизиты', 'Элемент'), fillOf('Поиск', 'Элемент'), fillOf('Обратный звонок', 'Элемент'), fillOf('Телефон', 'Решение')].join('|'));
    check('«Ограничения»: антибот, «?», предупреждения отбора, пределы матрицы', lim.cells[0].join('|') === 'Что не проверено|Где' && lim.cells.some(r => /антибот/.test(r[0]) && /e\.example/.test(r[1])) && lim.cells.some(r => /«\?»/.test(r[0]) && /Обратный звонок/.test(r[1])) && lim.cells.some(r => /охват неполный/.test(r[0])), JSON.stringify(lim.cells));

    // без own: колонки «Ваш сайт сейчас» нет
    const N = mkProject('noown', { own: false });
    const bn = run(N, ['scripts/build-kf-xlsx.mjs']);
    const cmpN = bn.code === 0 ? (await sheetRows(xlsxOf(N)))[2] : { cells: [[]] };
    check('без own: колонки «Ваш сайт сейчас» нет, «уже есть» не ставится', bn.code === 0 && !cmpN.cells[0].includes('Ваш сайт сейчас') && cmpN.cells[0].length === 10 && !cmpN.cells.some(r => /уже есть/.test(r.join('|'))), bn.out + cmpN.cells[0].join('|'));
    // нет Chrome и рынок без Keys.so - в ограничениях
    const nc = rj(path.join(N, 'work', 'kf', 'matrix.json')); nc.mode = 'text'; wj(path.join(N, 'work', 'kf', 'matrix.json'), nc);
    const pl = rj(path.join(N, 'work', 'competitors', 'pool.json')); pl.region.city_not_in_keyso = true; pl.region.city = 'Город'; wj(path.join(N, 'work', 'competitors', 'pool.json'), pl);
    run(N, ['scripts/build-kf-xlsx.mjs']);
    const limN = (await sheetRows(xlsxOf(N)))[3];
    check('«Ограничения»: нет Chrome, рынок по выдаче без Keys.so', limN.cells.some(r => /нет Chrome/.test(r[0])) && limN.cells.some(r => /рынок оценен по выдаче без Keys\.so/.test(r[0])), JSON.stringify(limN.cells));

    // ================================================================ 3. data_sha
    const b2 = run(D, ['scripts/build-kf-xlsx.mjs']);
    check('data_sha стабилен между сборками', b2.json && b2.json.data_sha === b.json.data_sha, `${b.json.data_sha} vs ${b2.json && b2.json.data_sha}`);
    const mf = path.join(D, 'work', 'kf', 'matrix.json');
    const m0 = fs.readFileSync(mf, 'utf8');
    const m1 = JSON.parse(m0); m1.generated_at = '2030-01-01 00:00:00'; fs.writeFileSync(mf, JSON.stringify(m1));
    const b3 = run(D, ['scripts/build-kf-xlsx.mjs']);
    check('data_sha без дат: generated_at матрицы его не меняет', b3.json && b3.json.data_sha === b.json.data_sha);
    m1.rows.find(r => r.id === 'callback').values['b.example'] = 0; fs.writeFileSync(mf, JSON.stringify(m1));
    const b4 = run(D, ['scripts/build-kf-xlsx.mjs']);
    check('data_sha меняется от одной ячейки', b4.json && b4.json.data_sha !== b.json.data_sha);
    fs.writeFileSync(mf, m0);
    const lib2 = await import(pathToFileURL(path.join(TPL, 'scripts', 'build-kf-xlsx.mjs')).href);
    check('canonical: ключи отсортированы', lib2.canonical({ b: 1, a: [{ d: 2, c: 3 }] }) === '{"a":[{"c":3,"d":2}],"b":1}');
    check('elName: служебная пометка в скобках снимается, пояснение остается', lib2.elName('Отзывы (ссылка)') === 'Отзывы' && lib2.elName(' Гарантии  (Блок) ') === 'Гарантии' && lib2.elName('Реквизиты (ИНН, ОГРН)') === 'Реквизиты (ИНН, ОГРН)', [lib2.elName('Отзывы (ссылка)'), lib2.elName(' Гарантии  (Блок) '), lib2.elName('Реквизиты (ИНН, ОГРН)')].join(' | '));

    // ================================================================ 4. --record
    run(D, ['scripts/build-kf-xlsx.mjs']);
    const pubF = path.join(D, 'work', 'output', 'kf-publish.json');
    const bad = run(D, ['scripts/build-kf-xlsx.mjs', '--record', '--status', 'published']);
    check('--record published без --file-id и --url - отказ, файл не пишется', bad.code !== 0 && !fs.existsSync(pubF), bad.out);
    const r1 = run(D, ['scripts/build-kf-xlsx.mjs', '--record', '--status', 'published', '--file-id', 'F1', '--url', 'https://docs.example/F1']);
    const p1 = fs.existsSync(pubF) ? rj(pubF) : {};
    check('--record published: файл по схеме kf-publish, без revisions', r1.code === 0 && p1.status === 'published' && p1.file_id === 'F1' && p1.data_sha === b.json.data_sha && p1.name === 'КФ и КНДР - Тест Компания' && Array.isArray(p1.revisions) && !p1.revisions.length && !lib.validate(SCH('kf-publish'), p1).length, r1.out + JSON.stringify(p1) + lib.validate(SCH('kf-publish'), p1).join('; '));
    const b5 = run(D, ['scripts/build-kf-xlsx.mjs']);
    check('тот же data_sha после публикации: need_publish false, prev_url', b5.json && b5.json.need_publish === false && b5.json.prev_url === 'https://docs.example/F1', b5.out);
    run(D, ['scripts/build-kf-xlsx.mjs', '--record', '--status', 'published', '--file-id', 'F1', '--url', 'https://docs.example/F1']);
    const p2 = rj(pubF);
    check('--record с тем же data_sha: без revisions, дата прежняя', !p2.revisions.length && p2.published_at === p1.published_at, JSON.stringify(p2));
    // данные изменились - новая публикация, прежний файл в revisions «(устарело)»
    const m2 = JSON.parse(m0); m2.rows.find(r => r.id === 'search').values['d.example'] = 1; m2.rows.find(r => r.id === 'search').n = 4; fs.writeFileSync(mf, JSON.stringify(m2));
    const b6 = run(D, ['scripts/build-kf-xlsx.mjs']);
    check('данные изменились: need_publish true', b6.json && b6.json.need_publish === true && b6.json.data_sha !== b.json.data_sha, b6.out);
    run(D, ['scripts/report.mjs']);
    check('отчет: опубликованная таблица устарела - пометка в сводке', /- Таблица КФ\/КНДР: https:\/\/docs\.example\/F1 \(устарела/.test(sectionOf(reportOf(D), 'Сводка')), sectionOf(reportOf(D), 'Сводка'));
    run(D, ['scripts/build-kf-xlsx.mjs', '--record', '--status', 'published', '--file-id', 'F2', '--url', 'https://docs.example/F2']);
    const p3 = rj(pubF);
    check('--record с новым data_sha: прежний файл в revisions «(устарело)»', p3.file_id === 'F2' && p3.data_sha === b6.json.data_sha && p3.revisions.length === 1 && p3.revisions[0].file_id === 'F1' && p3.revisions[0].renamed === '(устарело)' && !lib.validate(SCH('kf-publish'), p3).length, JSON.stringify(p3));
    run(D, ['scripts/report.mjs']);
    const mdPub = reportOf(D);
    check('отчет: «Таблица КФ/КНДР: <url>» в сводке и в строке консоли', /- Таблица КФ\/КНДР: https:\/\/docs\.example\/F2$/m.test(sectionOf(mdPub, 'Сводка')), sectionOf(mdPub, 'Сводка'));
    const rc = run(D, ['scripts/report.mjs']);
    check('отчет: строка консоли с таблицей', /таблица КФ\/КНДР: https:\/\/docs\.example\/F2\)$/.test(rc.stdout.trim()), rc.stdout);
    // skipped при действующей публикации с тем же data_sha - запись не меняется, ссылка в итоге остается
    const s0 = run(D, ['scripts/build-kf-xlsx.mjs', '--record', '--status', 'skipped', '--reason', 'нет MCP']);
    const p3b = rj(pubF);
    check('--record skipped при том же data_sha: публикация действует, запись прежняя', s0.code === 0 && s0.json && /публикация актуальна/.test(s0.json.note) && p3b.status === 'published' && p3b.url === 'https://docs.example/F2' && p3b.published_at === p3.published_at && p3b.revisions.length === 1, s0.out + JSON.stringify(p3b));
    run(D, ['scripts/report.mjs']);
    check('отчет после skipped с тем же data_sha: ссылка прежняя', /- Таблица КФ\/КНДР: https:\/\/docs\.example\/F2$/m.test(sectionOf(reportOf(D), 'Сводка')), sectionOf(reportOf(D), 'Сводка'));
    // таблица изменилась, публикация пропущена - прежняя ссылка в revisions (renamed null) и в итоге с пометкой
    fs.writeFileSync(mf, m0);
    const b7 = run(D, ['scripts/build-kf-xlsx.mjs']);
    check('таблица изменилась после F2: need_publish, prev_url и prev_file_id - F2', b7.json && b7.json.need_publish === true && b7.json.prev_url === 'https://docs.example/F2' && b7.json.prev_file_id === 'F2', b7.out);
    run(D, ['scripts/build-kf-xlsx.mjs', '--record', '--status', 'skipped', '--reason', 'нет texts_folder_id']);
    const p4 = rj(pubF);
    check('--record skipped: причина, ссылки нет, прежние публикации в revisions', p4.status === 'skipped' && p4.reason === 'нет texts_folder_id' && p4.url === null && p4.revisions.some(x => x.file_id === 'F1') && p4.revisions.some(x => x.file_id === 'F2' && x.renamed === null) && !lib.validate(SCH('kf-publish'), p4).length, JSON.stringify(p4));
    run(D, ['scripts/report.mjs']);
    check('отчет: xlsx без публикации с причиной и прежней ссылкой «устарела»', /- Таблица КФ\/КНДР: xlsx без публикации \(нет texts_folder_id\): work\/output\/kf-kndr\.xlsx; прежняя публикация \(устарела\): https:\/\/docs\.example\/F2/.test(reportOf(D)), sectionOf(reportOf(D), 'Сводка'));
    const b8 = run(D, ['scripts/build-kf-xlsx.mjs']);
    check('после skipped: prev_file_id - отложенная F2 (переименовать при новой публикации)', b8.json && b8.json.prev_file_id === 'F2' && b8.json.need_publish === true, b8.out);
    run(D, ['scripts/build-kf-xlsx.mjs', '--record', '--status', 'published', '--file-id', 'F3', '--url', 'https://docs.example/F3']);
    const p5 = rj(pubF);
    check('новая публикация после skipped: F2 помечена «(устарело)», без дублей', p5.file_id === 'F3' && p5.revisions.length === 2 && p5.revisions.every(x => x.renamed === '(устарело)') && !lib.validate(SCH('kf-publish'), p5).length, JSON.stringify(p5));
  }

  // ================================================================ 5. отчет с новыми разделами
  {
    const r = run(D, ['scripts/report.mjs']);
    const md = r.code === 0 ? reportOf(D) : '';
    check('report: код 0', r.code === 0, r.out.slice(0, 800));
    const ask = sectionOf(md, 'Что спросить у заказчика');
    check('вопрос по чипу оболочки - с основанием «есть у n из N лидеров»', /- Нужны данные для элемента «Реквизиты»: ИНН и ОГРН для подвала \(подвал; основание: есть у 4 из 5 лидеров\)/.test(ask), ask);
    check('чип элемента ниши (generic) - ответ войдет фактом', /- Нужны данные для элемента «Плашка гарантии»: срок гарантии \(ответ войдет на сайт подтвержденным фактом\) \(шапка; основание: есть у 3 из 5 лидеров\)/.test(ask), ask);
    check('заглушка - вопрос с основанием, вопрос о выпадении того же блока не дублируется', /- Нужны данные для блока «Цены»: цены на услуги \(s1\/prices; основание: есть у 2 из 5 лидеров\)/.test(ask) && !/Нужны факты для блока «Цены»/.test(ask) && !/нет фактов для блока «prices»/.test(ask), ask);
    check('declined - без вопроса; функция и страница - не вопросы', !/Телефон/.test(ask) && !/Поиск/.test(ask) && !/Доставка и оплата/.test(ask), ask);
    check('вопрос аудитора с needs_fact - основание «аудит прототипа»', /- срок гарантии на работы \(s2\/B02-reviews; основание: аудит прототипа\)/.test(ask), ask);
    const kfSec = sectionOf(md, 'Шапка, подвал и элементы лидеров');
    check('раздел «Шапка, подвал и элементы лидеров»: счет оболочки, чипы, заглушки, declined справкой, рекомендации страниц, функции, снятые стратегом', /элементов 6 \(показаны 1, нужны данные 2, функции 1, нужна страница 1, решение заказчика 1\)/.test(kfSec) && /«Реквизиты» \(подвал, есть у 4 из 5 лидеров\)/.test(kfSec) && /s1\/prices «Цены» \(есть у 2 из 5 лидеров\)/.test(kfSec) && /Не показываем по решению заказчика: «Телефон» \(шапка\)/.test(kfSec) && /Рекомендуем страницы[\s\S]*«Доставка и оплата» \(подвал\): есть у 2 из 5 лидеров/.test(kfSec) && /Функции интерфейса[^\n]*«Поиск»/.test(kfSec) && /элемент лидеров снят стратегом: блок cases/.test(kfSec), kfSec);
    const au = sectionOf(md, 'Аудит прототипа');
    check('раздел «Аудит прототипа»: сводка, исправлено, не исправлено и почему, надписи, сбои шагов', /Аудитор: fix \(три находки\); находок 3 \(blocker\/major\/minor 0\/2\/1\)/.test(au) && /### Исправлено\n- \[major\] s1\/B01-hero: первый экран[^\n]*-> H1 уточнен/.test(au) && /\[major\] s2\/B02-reviews: [^\n]* - нужен факт - вопрос заказчику/.test(au) && /\[minor\] шапка: [^\n]* - оболочка или весь сайт - только в отчет/.test(au) && /lead: «Оставить заявку» из «Оставить заявку», «Отправить заявку»; заменено: s1\/B01-hero/.test(au) && /### Сбои шагов\n- fixer s2: error \(timeout\)/.test(au), au);
    const un = sectionOf(md, 'Правки без проверки судьей');
    check('cta-unify - отдельным списком в «Правки без проверки судьей»', /### Единые надписи кнопок \(аудит прототипа, cta-unify\)\n- lead: «Оставить заявку» - s1\/B01-hero/.test(un), un);
    check('порядок разделов: интерфейс -> элементы лидеров -> аудит прототипа -> по страницам', md.indexOf('## Интерфейс прототипа') < md.indexOf('## Шапка, подвал') && md.indexOf('## Шапка, подвал') < md.indexOf('## Аудит прототипа') && md.indexOf('## Аудит прототипа') < md.indexOf('## По страницам'));
    // сбой wf-08 целиком - строка из meta.json (skips шага site-audited), без site.json
    fs.rmSync(path.join(D, 'work', 'audit', 'site.json'));
    wj(path.join(D, 'meta.json'), { state: 'site-audited', skips: [{ step: 'site-audited', reason: 'аудит прототипа не отработал: отказ агента', at: 'x' }, { step: 'catalog-done', reason: 'каталога нет', at: 'x' }] });
    run(D, ['scripts/report.mjs']);
    const au2 = sectionOf(reportOf(D), 'Аудит прототипа');
    check('сбой wf-08 целиком: строка из meta.json skips, без чужих шагов', /- аудит прототипа не отработал: отказ агента/.test(au2) && !/каталога нет/.test(au2) && !/Аудитор:/.test(au2), au2);
  }

  // ================================================================ 7. правки по рецензии: зона, js_only, кириллический домен,
  // отбор без ranking и без Keys.so, чип без needs_hint, cta-unify partial, --record без матрицы
  {
    const F = mkProject('fix');
    const mfF = path.join(F, 'work', 'kf', 'matrix.json');
    const mx = rj(mfF);
    // телефон подвала «по желанию»: в оболочке его нет, состояние телефона шапки (declined) не наследует
    mx.rows.push({ scope: 'site', zone: 'footer', id: 'phone', name: 'Телефон', kind: 'slot', level: 'optional', n: 1, N: 5, values: { 'a.example': 1, 'b.example': 0, 'xn--80atjc.example': 0, 'd.example': 0, 'e.example': 0 }, own: 0, already: false });
    wj(mfF, mx);
    const cp = rj(path.join(F, 'work', 'competitors', 'competitors.json'));
    cp.competitors.find(c => c.domain === 'd.example').status = 'js_only';
    wj(path.join(F, 'work', 'competitors', 'competitors.json'), cp);
    const cfgF = rj(path.join(F, 'config', 'project.json'));
    cfgF.site_url = 'https://www.пример-сайта.рф/';
    wj(path.join(F, 'config', 'project.json'), cfgF);
    const { domainToASCII } = await import('node:url');
    const puny = domainToASCII('пример-сайта.рф');
    const plF = rj(path.join(F, 'work', 'competitors', 'pool.json'));
    plF.own = [{ domain: puny, serp: { share: 0.1 }, keyso: null, iks: 70 }];
    plF.region.city_not_in_keyso = true;
    wj(path.join(F, 'work', 'competitors', 'pool.json'), plF);
    fs.rmSync(path.join(F, 'work', 'competitors', 'ranking.json'));
    // чипы без needs_hint: поля проекта - простыми словами; неизвестное поле - вопрос по имени элемента
    const sh = rj(path.join(F, 'work', 'shell.json'));
    const ll = sh.items.find(x => x.id === 'legal_line'); delete ll.needs_hint; ll.needs = ['company.legal_name', 'company.inn', 'company.ogrn'];
    sh.items.push({ id: 'email', name: 'Почта', zone: 'footer', level: 'must', coverage: '4/5', kind: 'slot', render: 'email', needs: ['company.mailboxes'], page_match: null, niche: false });
    wj(path.join(F, 'work', 'shell.json'), sh);
    const mods = rj(path.join(F, 'work', 'output', 'prototype.modules.json'));
    mods.shell.items.push({ id: 'email', name: 'Почта', zone: 'footer', level: 'must', coverage: '4/5', niche: false, state: 'chip' });
    wj(path.join(F, 'work', 'output', 'prototype.modules.json'), mods);
    const st = rj(path.join(F, 'work', 'audit', 'site.json'));
    st.cta_unify = [{ action: 'lead', label: 'Оставить заявку', variants: ['Оставить заявку', 'Отправить заявку'], status: 'partial', applied: [{ page: 's1', blocks: ['B01-hero'] }], reason: 'на s2 кнопка внутри формы' }];
    wj(path.join(F, 'work', 'audit', 'site.json'), st);
    if (ExcelJS) {
      const bf = run(F, ['scripts/build-kf-xlsx.mjs']);
      const [readmeF, selF, cmpF] = bf.code === 0 ? await sheetRows(xlsxOf(F)) : [{ cells: [] }, { cells: [] }, { cells: [[]] }];
      const HF = cmpF.cells[0];
      const phones = cmpF.cells.filter(r => r[0] === 'Телефон');
      check('«В прототипе»: строка оболочки ищется по паре id + зона, «по желанию» без элемента - «нет (по желанию)»', phones.length === 2 && phones[0][HF.indexOf('В прототипе')] === 'нет, решение заказчика' && phones[1][HF.indexOf('В прототипе')] === 'нет (по желанию)', bf.out + JSON.stringify(phones));
      const selRowF = d => selF.cells.find(r => r[0] === d) || [];
      check('«Отбор конкурентов»: js_only - не в анализе (как kf-matrix), причина простыми словами', /^не взят: /.test(selRowF('d.example')[12]) && selRowF('a.example')[12] === 'в анализе', JSON.stringify(selRowF('d.example')));
      check('«Отбор конкурентов»: кириллический site_url - общая нормализация, метрики pool.own, домен по-русски', selRowF('пример-сайта.рф')[12] === 'ваш сайт' && selRowF('пример-сайта.рф')[6] === 70, JSON.stringify(selF.cells.at(-1)));
      const howF = (readmeF.cells.find(r => r[0] === 'Как отбирали лидеров') || [])[1] || '';
      check('«Как читать»: без ranking - по списку анализа и проверке сайтов, без Keys.so, без выдачи и эталона', /из списка конкурентов анализа/.test(howF) && /нет в базе Keys\.so/.test(howF) && !/по выдаче Яндекса/.test(howF) && !/эталон/.test(howF), howF);
    } else skipped('правки по рецензии (xlsx)', 'exceljs не найден от шаблона');
    const rF = run(F, ['scripts/report.mjs']);
    const mdF = rF.code === 0 ? reportOf(F) : '';
    const askF = sectionOf(mdF, 'Что спросить у заказчика');
    check('чип без needs_hint: поля простыми словами, без технических имен', /- Нужны данные для элемента «Реквизиты»: полное наименование юрлица, ИНН, ОГРН \(подвал; основание: есть у 4 из 5 лидеров\)/.test(askF) && /- Нужны данные для элемента «Почта» \(подвал; основание: есть у 4 из 5 лидеров\)/.test(askF) && !/company\.|site\./.test(mdF), askF);
    const auF = sectionOf(mdF, 'Аудит прототипа');
    check('cta-unify partial: и заменено, и причина по остальным', /lead: «Оставить заявку» из «Оставить заявку», «Отправить заявку»; заменено: s1\/B01-hero; не применено на остальных: на s2 кнопка внутри формы/.test(auF), auF);
    check('cta-unify: блоки в числе правок без проверки судьей (консоль и сводка)', /правок без проверки судьей 1[^0-9]/.test(rF.stdout) && /- Единые надписи кнопок без проверки судьей \(аудит прототипа, cta-unify\): блоков 1/.test(sectionOf(mdF, 'Сводка')), rF.stdout + sectionOf(mdF, 'Сводка'));
    // --record без матрицы (остался meta от прошлой сборки): kf-publish.json не пишется
    if (!fs.existsSync(path.join(F, 'work', 'output', 'kf-xlsx.meta.json'))) wj(path.join(F, 'work', 'output', 'kf-xlsx.meta.json'), { data_sha: 'a'.repeat(64), drive_name: 'КФ и КНДР - Тест Компания' });
    fs.rmSync(mfF);
    const rr = run(F, ['scripts/build-kf-xlsx.mjs', '--record', '--status', 'published', '--file-id', 'F9', '--url', 'https://docs.example/F9']);
    check('--record без матрицы: код 0, kf-publish.json не пишется, причина в stdout', rr.code === 0 && rr.json && rr.json.path === null && /анализ КФ не проводился/.test(rr.json.skipped) && !fs.existsSync(path.join(F, 'work', 'output', 'kf-publish.json')), rr.out);
  }

  // ================================================================ 8. declined с reason "off" (модуль выключен оператором,
  // пакет D, D4): «выключено оператором» - справка без вопроса, не «решение заказчика» (интеграция G)
  {
    const O = mkProject('operator-off');
    const mf = path.join(O, 'work', 'output', 'prototype.modules.json');
    const mods = rj(mf);
    mods.shell.items.find(x => x.id === 'phone').reason = 'off';
    wj(mf, mods);
    const r = run(O, ['scripts/report.mjs']);
    const md = r.code === 0 ? reportOf(O) : '';
    const kfSec = sectionOf(md, 'Шапка, подвал и элементы лидеров');
    check('reason off: в отчете «выключено оператором» справкой, не «решение заказчика», без вопроса', r.code === 0 && /решение заказчика 0, выключено оператором 1\)/.test(kfSec) && /- Выключено оператором \(справка, без вопроса заказчику\): «Телефон» \(шапка\)/.test(kfSec) && !/Не показываем по решению заказчика/.test(kfSec) && !/Телефон/.test(sectionOf(md, 'Что спросить у заказчика')), kfSec + r.out.slice(0, 400));
    if (!ExcelJS) skipped('reason off в таблице', 'exceljs не найден от шаблона');
    else {
      const b = run(O, ['scripts/build-kf-xlsx.mjs']);
      const cmp = b.code === 0 ? (await sheetRows(xlsxOf(O)))[2] : { cells: [[]] };
      const H = cmp.cells[0];
      const row = cmp.cells.find(x => x[0] === 'Телефон') || [];
      check('reason off: в таблице «нет, выключено оператором»', row[H.indexOf('В прототипе')] === 'нет, выключено оператором', JSON.stringify(row) + b.out.slice(0, 300));
    }
  }

  // ================================================================ 6. стиль, UUID и ниша новых файлов пакета
  {
    const YO = String.fromCharCode(0x451), YO2 = String.fromCharCode(0x401), D1 = String.fromCharCode(0x2014), D2 = String.fromCharCode(0x2013);
    const INVIS = [0xad, 0x200b, 0x200c, 0x200d, 0x2060, 0xfeff].map(c => String.fromCharCode(c));
    const NICHE = /(застройщ|депозит|квот[аеуы]|инвестор|недвижим|ипотек|новострой|апартамент|доходност|ювелир|золот|кольц|пирсинг|бриллиант|серебр|помолвоч|обручал|геммолог|пхукет|двигател|запчаст|trade-in|автомобил|goldax)/i;
    const OWN = ['scripts/build-kf-xlsx.mjs', 'schemas/kf-publish.schema.json', 'scripts/report.mjs'];
    const bad = [];
    for (const f of OWN) {
      const t = read(f);
      if ([YO, YO2, D1, D2].some(ch => t.includes(ch))) bad.push(`${f}: е с точками или длинное тире`);
      if (INVIS.some(ch => t.includes(ch))) bad.push(`${f}: невидимый символ литералом (нужен escape)`);
      if (/mcp__[0-9a-f]{8}-/.test(t)) bad.push(`${f}: UUID MCP`);
      const nm = t.match(NICHE); if (nm) bad.push(`${f}: нишевое слово «${nm[0]}»`);
    }
    check('файлы пакета E: без е с точками, длинных тире, невидимых символов, UUID MCP и нишевых слов', !bad.length, bad.join('; '));
    const s = SCH('kf-publish');
    check('схема kf-publish: обязательные поля по §3.6', ['status', 'file_id', 'url', 'name', 'data_sha', 'published_at', 'reason', 'revisions'].every(k => s.required.includes(k)) && s.properties.status.enum.join(',') === 'published,skipped');
  }
} catch (e) {
  fail++; failures.push(`FAIL исключение: ${e.stack || e.message}`);
} finally {
  if (process.env.SITE_TEKST_TEST_KEEP === '1') console.log(`песочница оставлена: ${tmpRoot}`);
  else fs.rmSync(tmpRoot, { recursive: true, force: true });
}

notes.forEach(s => console.log(s));
failures.forEach(f => console.log(f));
console.log(`cases-kf-xlsx: ${pass} ok, ${fail} fail${skip ? `, ${skip} skip` : ''}`);
process.exit(fail ? 1 : 0);
