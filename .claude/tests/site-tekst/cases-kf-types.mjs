// Пакет C программы 05.10 (КФ и КНДР): типы страниц и брифы. Запуск:
//   node .claude/tests/site-tekst/cases-kf-types.mjs      код выхода 0 - все прошли.
// Все во временной папке (os.tmpdir()), синтетические данные, без сети и без данных клиентов. Матрица
// work/kf/matrix.json - фикстура по разделу 3.3 программы (выход пакета B строится здесь).
// Разделы: 1. kf-coverage (нет матрицы - код 0 с причиной; blocker/major; recommended_order; short_set или core; skip из
// списка; shell; уровни по-русски и по n; дробление info_other; невидимые элементы - не строки типа; --all, --rows,
// --json, --dir и находки по схеме с id по элементу); 2. схемы page-type (kf_coverage) и brief (stubs); 3. build-briefs:
// заглушка только для КФ-блока и только «нет фактов» / «нет числовых фактов», STALE / exclude_blocks / пустой facts -
// без заглушки, с предупреждением; вопрос не дублируется; без kf_coverage или без матрицы - как раньше; уровень из
// матрицы сильнее kf_coverage; h2 необязателен вне первого экрана; заглушка вне blocks (page-state, plan-run, progress);
// 4. lint-page: minor editorial.few-headings; 5. промты, wf-03 (skipKf - kf=off аудитору), бюджеты для пакета G;
// 6. стиль, UUID и ниша новых файлов.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TPL = path.resolve(HERE, '..', '..', 'skills', 'site-tekst', 'kit');
let pass = 0, fail = 0;
const failures = [], notes = [];
function check(name, ok, detail = '') {
  if (ok) pass++;
  else { fail++; failures.push(`FAIL ${name}${detail ? ': ' + String(detail).slice(0, 600) : ''}`); }
}
const rj = f => JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, ''));
const wj = (f, o) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(o, null, 2) + '\n'); };
const read = f => fs.readFileSync(path.join(TPL, f), 'utf8');
const run = (cwd, args) => { const r = spawnSync(process.execPath, args, { cwd, encoding: 'utf8' }); return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), stdout: r.stdout || '' }; };
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cases-kf-types-'));
function mkProject(name) {
  const dir = path.join(tmpRoot, name);
  for (const d of ['scripts', 'rules', 'schemas', 'config']) fs.cpSync(path.join(TPL, d), path.join(dir, d), { recursive: true });
  return dir;
}
const lib = await import(pathToFileURL(path.join(TPL, 'scripts', 'lib.mjs')).href);
const SCH = n => rj(path.join(TPL, 'schemas', `${n}.schema.json`));

// ---------- фикстуры ----------
const el = (kind, count, max) => ({ kind, count, chars: { min: 0, median: 0, max } });
const blk = (id, role, pattern, elements, extra = {}) => ({ id, name: `Блок ${id}`, role, reader_question: `Вопрос читателя про ${id}`, pattern, elements, seen_at: [], examples: [], ...extra });
const B = {
  hero: blk('hero', 'hero', 'hero-split', [el('h1', '1', 70), el('sub', '1', 160), el('button', '1', 30)], { core: true, cta_allowed: true, fact_kinds: ['number', 'claim'] }),
  steps: blk('steps', 'conversion', 'steps', [el('h2', '1', 80), el('step', '2-4', 150)], { fact_kinds: ['process'] }),
  numbers: blk('numbers', 'conversion', 'numbers', [el('h2', '1', 80), el('number', '2-4', 40)], { fact_kinds: ['number'] }),
  reviews: blk('reviews', 'conversion', 'quote', [el('h2', '1', 80), el('quote', '2-3', 300)], { fact_kinds: ['claim'] }),
  cases: blk('cases', 'conversion', 'grid-3', [el('h2', '1', 80), el('card', '2-3', 150)], { fact_kinds: ['number'] }),
  faq: blk('faq', 'info', 'accordion', [el('h2', '1', 80), el('qa', '2-4', 300)], { objection_slot: true }),
  text: id => blk(id, 'conversion', 'text', [el('h2', '1-2', 80), el('text', '1', 300)]),
  cta: blk('cta-final', 'conversion', 'cta-band', [el('h2', '1', 80), el('text', '1', 200), el('button', '1', 30)], { core: true, cta_allowed: true }),
};
const ptype = (type, blocks, extra = {}) => ({ type, sources: [{ domain: 'lider.example', url: 'https://lider.example/', raw: 'work/competitors/raw/x.json', status: 'ok' }], market_blocks: blocks, differentiation_blocks: [], recommended_order: blocks.map(b => b.id), cliches_to_avoid: ['индивидуальный подход'], ...extra });
// матрица по §3.3: строки (scope, zone, id), значения по доменам, охват n из N, уровень по абсолютному n, kind, own
const DOMS = ['a.example', 'b.example', 'c.example', 'd.example', 'e.example'];
const vals = n => Object.fromEntries(DOMS.map((d, i) => [d, i < n ? 1 : 0]));
const mrow = (scope, zone, id, name, n, level, extra = {}) => ({ scope, zone, id, name, kind: 'block', n, N: 5, level, values: vals(n), own: 0, ...extra });
function matrix(rows) {
  return { generated_at: '2026-10-05T00:00:00Z', target: 5, must_n: 4, recommended_n: 2, domains: DOMS, own: 'client.example', rows, sums: {}, limits: [] };
}

try {
  // ================================================================== 1. kf-coverage
  {
    const dir = mkProject('cov');
    const KC = args => run(dir, [path.join('scripts', 'kf-coverage.mjs'), ...args]);
    const home = ptype('home', [B.hero, B.steps, B.numbers, B.reviews, B.faq, B.cta]);
    wj(path.join(dir, 'work', 'page-types', 'home.json'), home);
    // нет матрицы
    let r = KC(['home']);
    check('kf-coverage: нет матрицы и status.json - код 0, «анализ КФ не проводился: pre_kf»', r.code === 0 && r.out.includes('анализ КФ не проводился: pre_kf'), r.out);
    wj(path.join(dir, 'work', 'kf', 'status.json'), { status: 'no_competitors' });
    r = KC(['home']);
    check('kf-coverage: причина из work/kf/status.json', r.code === 0 && r.out.includes('анализ КФ не проводился: no_competitors'), r.out);
    r = KC(['--all', '--json']);
    const j0 = JSON.parse(r.stdout);
    check('kf-coverage --json без матрицы: kf false, причина, нет находок', r.code === 0 && j0.types.length === 1 && j0.types[0].kf === false && j0.types[0].reason === 'no_competitors' && !j0.types[0].findings.length, r.out);
    r = KC(['home', '--rows']);
    check('kf-coverage --rows без матрицы - []', r.code === 0 && r.stdout.trim() === '[]', r.out);
    r = KC([]);
    check('kf-coverage без аргументов - код 2', r.code === 2, r.out);

    // матрица: home - must (reviews 5/5), recommended (x-numbers 3/5, rating 2/5), optional (map 1/5); строка site - не тип
    wj(path.join(dir, 'work', 'kf', 'matrix.json'), matrix([
      mrow('home', 'body', 'reviews', 'Отзывы', 5, 'must', { block_hint: 'reviews' }),
      mrow('home', 'body', 'x-numbers', 'Цифры компании', 3, 'recommended'),
      mrow('home', 'body', 'rating', 'Рейтинг', 2, 'recommended', { kind: 'slot' }),
      mrow('home', 'body', 'map', 'Карта', 1, 'optional'),
      mrow('site', 'header', 'phone', 'Телефон', 5, 'must', { kind: 'slot' }),
      mrow('service', 'body', 'price-from', 'Цена от', 4, 'must'),
    ]));
    r = KC(['home']);
    check('kf-coverage: без kf_coverage - blocker по «обязательно», major по «рекомендовано», код 1', r.code === 1 && /blocker 1, major 2/.test(r.out) && /\[blocker\][^\n]*reviews[^\n]*нет записи/.test(r.out) && /\[major\][^\n]*x-numbers/.test(r.out) && !/map|phone|price-from/.test(r.out.split('\n').filter(l => l.includes('[')).join('\n')), r.out);
    r = KC(['home', '--json']);
    const j1 = JSON.parse(r.stdout).types[0];
    check('kf-coverage --json: строки типа (без site и чужого типа, без «по желанию»)', j1.kf === true && j1.rows.map(x => x.id).sort().join() === 'rating,reviews,x-numbers', JSON.stringify(j1.rows));
    const fdoc = { scope: 'page-types/home', producer: 'type-auditor', round: 1, findings: j1.findings, verdict: 'blocked' };
    const fe = lib.validate(SCH('findings'), fdoc);
    check('kf-coverage --json: findings проходят schemas/findings (rule kf.coverage, category coverage)', !fe.length && j1.findings.length === 3 && j1.findings.every(f => f.rule === 'kf.coverage' && f.category === 'coverage' && f.status === 'open') && j1.findings.map(f => f.id).sort().join() === 'kf-rating,kf-reviews,kf-x-numbers', fe.join('; ') + JSON.stringify(j1.findings));
    r = KC(['home', '--rows']);
    const rows = JSON.parse(r.stdout);
    check('kf-coverage --rows: [{id, name, n, N, level, kind, block_hint}] как --compact --min recommended', r.code === 0 && rows.length === 3 && rows.every(x => ['id', 'name', 'n', 'N', 'level', 'kind', 'block_hint'].every(k => k in x)) && rows.find(x => x.id === 'reviews').block_hint === 'reviews', r.stdout);

    // полное покрытие: блок, элемент блока первого экрана, shell; блок «обязательно» в short_set
    const cov = (extra, kf) => { wj(path.join(dir, 'work', 'page-types', 'home.json'), { ...home, ...extra, kf_coverage: kf }); return KC(['home']); };
    const good = [
      { el: 'reviews', name: 'Отзывы', level: 'must', n: 5, to: 'reviews', why: 'рыночный блок' },
      { el: 'x-numbers', name: 'Цифры компании', level: 'recommended', n: 3, to: 'numbers', why: 'по смыслу' },
      { el: 'rating', name: 'Рейтинг', level: 'recommended', n: 2, to: 'hero', why: 'badges первого экрана' },
    ];
    r = cov({ short_set: ['hero', 'reviews', 'cta-final'] }, good);
    check('kf-coverage: полное покрытие - код 0, нарушений нет', r.code === 0 && /blocker 0, major 0/.test(r.out), r.out);
    r = cov({ short_set: ['hero', 'cta-final'] }, good);
    check('kf-coverage: блок строки «обязательно» не в short_set - blocker', r.code === 1 && /\[blocker\][^\n]*не в short_set/.test(r.out), r.out);
    r = cov({ short_set: [] }, good);
    check('kf-coverage: short_set пуст, блок не core - blocker', r.code === 1 && /\[blocker\][^\n]*не core/.test(r.out), r.out);
    r = cov({ short_set: [], market_blocks: home.market_blocks.map(b => b.id === 'reviews' ? { ...b, core: true } : b) }, good);
    check('kf-coverage: short_set пуст, блок core - без нарушений', r.code === 0, r.out);
    r = cov({ short_set: ['hero', 'reviews'], recommended_order: ['hero', 'steps', 'reviews', 'faq', 'cta-final'] }, good);
    check('kf-coverage: блок «рекомендовано» вне recommended_order - major', r.code === 1 && /\[major\][^\n]*numbers не стоит в recommended_order/.test(r.out) && /blocker 0, major 1/.test(r.out), r.out);
    r = cov({ short_set: ['hero', 'reviews'] }, good.map(c => c.el === 'reviews' ? { ...c, to: 'ghost' } : c));
    check('kf-coverage: to на блок не из типа - blocker', r.code === 1 && /\[blocker\][^\n]*блока ghost нет в типе/.test(r.out), r.out);
    r = cov({ short_set: ['hero', 'reviews'] }, good.map(c => c.el === 'x-numbers' ? { ...c, to: 'skip', why: 'нет такой сущности у бизнеса: цифр нет' } : c.el === 'rating' ? { ...c, to: 'shell', why: 'рисует оболочка' } : c));
    check('kf-coverage: skip с причиной из списка (с пояснением) и shell - без нарушений', r.code === 0, r.out);
    r = cov({ short_set: ['hero', 'reviews'] }, good.map(c => c.el === 'x-numbers' ? { ...c, to: 'skip', why: 'не хочется' } : c));
    check('kf-coverage: skip с причиной не из списка - major', r.code === 1 && /\[major\][^\n]*skip с причиной не из списка/.test(r.out), r.out);
    for (const why of ['«противоречит фактам»', 'Покрыто другим типом']) {
      r = cov({ short_set: ['hero', 'reviews'] }, good.map(c => c.el === 'reviews' ? { ...c, to: 'skip', why } : c));
      check(`kf-coverage: skip «${why}» принят (кавычки и регистр)`, r.code === 0, r.out);
    }
    // id находки по элементу: исправленный reviews не сдвигает id остальных
    wj(path.join(dir, 'work', 'page-types', 'home.json'), { ...home, short_set: ['hero', 'reviews'], kf_coverage: [good[0]] });
    r = KC(['home', '--json']);
    const ids2 = JSON.parse(r.stdout).types[0].findings.map(f => f.id).sort().join();
    check('kf-coverage: id находки стабилен между кругами (kf-<элемент>)', ids2 === 'kf-rating,kf-x-numbers', ids2);
    // невидимый элемент (разметка) «обязательно» - не строка типа: ни нарушения, ни строки --rows
    const m1 = rj(path.join(dir, 'work', 'kf', 'matrix.json'));
    wj(path.join(dir, 'work', 'kf', 'matrix.json'), { ...m1, rows: [...m1.rows, mrow('home', 'body', 'schema_organization', 'Разметка организации', 5, 'must', { kind: 'function', visible: false })] });
    r = cov({ short_set: ['hero', 'reviews', 'cta-final'] }, good);
    check('kf-coverage: невидимая строка «обязательно» (visible: false) - без нарушения', r.code === 0 && !r.out.includes('schema_organization'), r.out);
    r = KC(['home', '--rows']);
    const rowsInv = JSON.parse(r.stdout);
    check('kf-coverage --rows: без невидимых строк', r.code === 0 && !rowsInv.some(x => x.id === 'schema_organization') && rowsInv.length === 3, r.stdout);
    // --dir: частичный разбор A/B - проверка файла в папке агрегатора, основной page-types не нужен
    wj(path.join(dir, 'work', 'page-types-b', 'home.json'), { ...home, short_set: ['hero', 'reviews', 'cta-final'], kf_coverage: good });
    wj(path.join(dir, 'work', 'page-types', 'home.json'), home);
    r = KC(['home', '--dir', 'work/page-types-b']);
    const r0 = KC(['home']);
    check('kf-coverage --dir: проверяет <dir>/<type>.json (там покрыто - код 0, в основном - нарушения)', r.code === 0 && /blocker 0, major 0/.test(r.out) && r0.code === 1, r.out + r0.out);
    r = KC(['--all', '--json', '--dir', path.join(dir, 'work', 'page-types-b')]);
    check('kf-coverage --all --dir: типы из папки (абсолютный путь)', r.code === 0 && JSON.parse(r.stdout).types.map(t => t.type).join() === 'home', r.out);
    r = KC(['home', '--dir']);
    check('kf-coverage --dir без значения - код 2', r.code === 2, r.out);
    // уровни по-русски, уровень по n, дробление info_other, --all
    wj(path.join(dir, 'work', 'kf', 'matrix.json'), matrix([
      mrow('home', 'body', 'reviews', 'Отзывы', 5, 'обязательно'),
      { scope: 'home', zone: 'body', id: 'x-calc', name: 'Калькулятор', kind: 'block', n: 2, N: 5 },
      { scope: 'home', zone: 'body', id: 'x-one', name: 'Одиночка', kind: 'block', n: 1, N: 5 },
      mrow('info_other:доставка', 'body', 'x-terms', 'Условия', 2, 'рекомендовано'),
      mrow('info_other/оплата', 'body', 'x-terms', 'Условия', 4, 'must'),
    ]));
    wj(path.join(dir, 'work', 'page-types', 'home.json'), home);
    wj(path.join(dir, 'work', 'page-types', 'info_other.json'), ptype('info_other', [B.hero, B.text('terms'), B.cta]));
    r = KC(['--all', '--json']);
    const all = Object.fromEntries(JSON.parse(r.stdout).types.map(t => [t.type, t]));
    check('kf-coverage: уровень по-русски и по n (2 из 5 - рекомендовано, 1 - нет строки)', all.home.rows.map(x => `${x.id}:${x.level}`).sort().join() === 'reviews:must,x-calc:recommended', JSON.stringify(all.home.rows));
    check('kf-coverage: info_other по назначениям - одна строка, сильнейший уровень', all.info_other.rows.length === 1 && all.info_other.rows[0].level === 'must' && all.info_other.rows[0].n === 4, JSON.stringify(all.info_other.rows));
    check('kf-coverage --all: все типы page-types, код 1 при нарушениях', r.code === 1 && Object.keys(all).sort().join() === 'home,info_other', r.out);
    r = KC(['category']);
    check('kf-coverage: тип без строк и без файла - код 0, «строк КФ для типа нет»', r.code === 0 && r.out.includes('строк КФ для типа нет'), r.out);
    // экспорт
    const kc = await import(pathToFileURL(path.join(TPL, 'scripts', 'kf-coverage.mjs')).href);
    check('kf-coverage: экспорт kfLevel и skipReasonOk', kc.kfLevel('Обязательно') === 'must' && kc.kfLevel('recommended') === 'recommended' && kc.kfLevel('по желанию') === 'optional' && kc.kfLevel('x') === '' && kc.skipReasonOk('нет такой сущности у бизнеса') && !kc.skipReasonOk('просто так') && kc.SKIP_REASONS.length === 3);
  }

  // ================================================================== 2. схемы
  {
    const pt = ptype('home', [B.hero, B.cta]);
    check('page-type: без kf_coverage - как раньше', !lib.validate(SCH('page-type'), pt).length);
    check('page-type: kf_coverage проходит', !lib.validate(SCH('page-type'), { ...pt, kf_coverage: [{ el: 'reviews', name: 'Отзывы', level: 'must', n: 5, to: 'reviews', why: '' }, { el: 'x-a', to: 'shell' }, { el: 'x-b', to: 'skip', why: 'противоречит фактам' }] }).length);
    check('page-type: kf_coverage без el или с to не по шаблону - ошибка', lib.validate(SCH('page-type'), { ...pt, kf_coverage: [{ to: 'reviews' }] }).length > 0 && lib.validate(SCH('page-type'), { ...pt, kf_coverage: [{ el: 'a', to: 'B02-reviews' }] }).length > 0);
    const st = { type: 'reviews', name: 'Отзывы', after: 'B01-hero', needs: ['отзывы'], kf_el: 'reviews', level: 'must' };
    const bs = SCH('brief');
    check('brief: stubs - схема элемента (after - block_id, level must|recommended, needs не пуст)', !lib.validate(bs.properties.stubs, [st]).length && lib.validate(bs.properties.stubs, [{ ...st, after: 'hero' }]).length > 0 && lib.validate(bs.properties.stubs, [{ ...st, level: 'optional' }]).length > 0 && lib.validate(bs.properties.stubs, [{ ...st, needs: [] }]).length > 0);
  }

  // ================================================================== 3. build-briefs
  const page = (slug, url, type, extra = {}) => ({ slug, url, type, subject: `Страница ${slug}`, parent: url === '/' ? '' : '/', level: url === '/' ? 0 : 1, segment: 'S1', status: 'planned', block_set: 'full', ...extra });
  const entry = (facts, extra = {}) => ({ segment: 'S1', unique_argument: 'Уникальный довод страницы для теста', objection_ids: [], offer_formula: 'F3', cta: { main: 'Получить расчет' }, facts, ...extra });
  const HOME_KF = [
    { el: 'reviews', name: 'Отзывы', level: 'must', n: 5, to: 'reviews', why: '' },
    { el: 'x-numbers', name: 'Цифры компании', level: 'recommended', n: 3, to: 'numbers', why: '' },
    { el: 'x-cases', name: 'Кейсы', level: 'optional', n: 1, to: 'cases', why: '' },
  ];
  const SERVICE_KF = [{ el: 'reviews', name: 'Отзывы', level: 'must', n: 4, to: 'reviews', why: '' }, { el: 'x-numbers', name: 'Цифры компании', level: 'recommended', n: 3, to: 'numbers', why: '' }];
  function writeBriefProject(dir, { kf = true } = {}) {
    const cfg = rj(path.join(TPL, 'config', 'project.json'));
    cfg.company = 'Тест Мастерская'; cfg.niche.business_type = 'services'; cfg.limits.drop_blocks_without_facts = ['reviews', 'cases:number'];
    wj(path.join(dir, 'config', 'project.json'), cfg);
    wj(path.join(dir, 'work', 'sitemap.json'), { page_types: ['home', 'service', 'info_about'], pages: [
      page('home', '/', 'home'), page('uslugi', '/uslugi', 'service'), page('remont', '/remont', 'service'), page('o-nas', '/o-nas', 'info_about'),
    ] });
    wj(path.join(dir, 'work', 'facts.json'), { source: 'синтетика', facts: [
      { id: 'F01', label: 'срок', value: '3 недели', wording: 'Срок 3 недели', publish: 'yes', kind: 'number' },
      { id: 'F02', label: 'замер', value: 'на следующий день', wording: 'Замер на следующий день', publish: 'yes', kind: 'process' },
      { id: 'F03', label: 'договор', value: 'до начала работ', wording: 'Договор до начала работ', publish: 'yes', kind: 'process' },
      { id: 'F04', label: 'гарантия', value: '12 месяцев', wording: 'Гарантия 12 месяцев', publish: 'yes', kind: 'legal' },
    ], anti_promises: [], terminology: { use: [], jargon: [], untranslatable: [] }, company: { status: 'confirmed', phones: ['+7 000 000-00-00'], channels: {} }, gaps: [] });
    wj(path.join(dir, 'work', 'audience.json'), { segments: [{ id: 'S1', name: 'Семья', portrait: 'Семья с ремонтом', comes_with: 'нужно успеть', pains: ['дорого'], fears: ['обманут'], criteria: ['гарантия'], objections: [] }], client_phrases: [] });
    wj(path.join(dir, 'work', 'strategy.json'), { global: { positioning: 'п', main_promise: 'о', offer_formula_by_type: {}, cta_by_type: {}, argument_bank: [], objection_to_block: {} }, pages: {
      home: entry(['F02', 'F04']),
      uslugi: entry(['F01'], { exclude_blocks: ['reviews'], notes: 'отзывов у компании пока нет' }),
      remont: entry(['F02', 'F03'], { block_overrides: { reviews: { facts: [] } } }),
      'o-nas': entry(['F02']),
    } });
    const t = (type, blocks, kfc) => ptype(type, blocks, kf && kfc ? { kf_coverage: kfc } : {});
    wj(path.join(dir, 'work', 'page-types', 'home.json'), t('home', [B.hero, B.steps, B.numbers, B.reviews, B.cases, B.faq, B.cta], HOME_KF));
    wj(path.join(dir, 'work', 'page-types', 'service.json'), t('service', [B.hero, B.numbers, B.reviews, B.steps, B.cta], SERVICE_KF));
    wj(path.join(dir, 'work', 'page-types', 'info_about.json'), t('info_about', [B.hero, B.text('a'), B.text('b'), B.text('c'), B.text('d'), B.cta], null));
    if (kf) wj(path.join(dir, 'work', 'kf', 'matrix.json'), matrix([mrow('home', 'body', 'reviews', 'Отзывы', 5, 'must', { needs_hint: 'отзывы клиентов с именем и датой' })]));
  }
  const dir = mkProject('briefs');
  writeBriefProject(dir);
  const W = (...p) => path.join(dir, 'work', ...p);
  const bb = run(dir, [path.join('scripts', 'build-briefs.mjs')]);
  check('build-briefs с kf_coverage: код 0', bb.code === 0, bb.out);
  const home = rj(W('pages', 'home', 'brief.json'));
  const rep = rj(W('briefs-report.json'));
  {
    const ids = home.blocks.map(b => b.block_id);
    check('заглушки вне blocks: blocks без reviews и numbers', ids.join() === 'B01-hero,B02-steps,B03-faq,B04-cta-final', ids.join());
    const st = home.stubs || [];
    const byT = Object.fromEntries(st.map(x => [x.type, x]));
    check('заглушка «нет фактов» (must) и «нет числовых фактов» (recommended), после ближайшего блока выше', st.length === 2 && byT.reviews && byT.numbers && byT.reviews.after === 'B02-steps' && byT.numbers.after === 'B02-steps' && byT.reviews.level === 'must' && byT.numbers.level === 'recommended' && byT.reviews.kf_el === 'reviews' && byT.numbers.kf_el === 'x-numbers', JSON.stringify(st));
    check('заглушка: needs - needs_hint строки матрицы, иначе название элемента', JSON.stringify(byT.reviews && byT.reviews.needs) === '["отзывы клиентов с именем и датой"]' && JSON.stringify(byT.numbers && byT.numbers.needs) === '["Цифры компании"]', JSON.stringify(st));
    check('заглушки в порядке страницы', st.map(x => x.type).join() === 'numbers,reviews', JSON.stringify(st));
    check('бриф с заглушками проходит схему brief', !lib.validate(SCH('brief'), home).length, lib.validate(SCH('brief'), home).join('; '));
    const hr = rep.pages.home;
    check('КФ-блок уровня «по желанию» выпал как раньше: dropped и вопрос', hr.dropped.some(d => d.block === 'cases') && hr.questions.some(q => q.blocks.includes('cases')), JSON.stringify(hr));
    check('вопрос не дублируется: по заглушке нет вопроса о выпадении и записи dropped (вопрос задает отчет)', !hr.dropped.some(d => ['reviews', 'numbers'].includes(d.block)) && !hr.questions.some(q => q.blocks.some(b => ['reviews', 'numbers'].includes(b))) && !rep.questions.some(q => /Блок reviews|Блок numbers/.test(q.text)), JSON.stringify(hr));
    check('отчет брифов: stubs страницы и предупреждение stubs', JSON.stringify(hr.stubs) === JSON.stringify([{ block: 'numbers', kf_el: 'x-numbers', level: 'recommended' }, { block: 'reviews', kf_el: 'reviews', level: 'must' }]) && hr.warnings.some(w => /заглушки элементов лидеров \(нет фактов\): numbers, reviews/.test(w)), JSON.stringify(hr));
    // uslugi: hero забрал F01 - блок цифр STALE; reviews в exclude_blocks с notes
    const us = rj(W('pages', 'uslugi', 'brief.json'));
    const ur = rep.pages.uslugi;
    check('STALE и exclude_blocks у КФ-блоков: без заглушки', !('stubs' in us) && !us.blocks.some(b => ['numbers', 'reviews'].includes(b.type)), JSON.stringify(us.blocks.map(b => b.type)));
    check('STALE КФ-блока: предупреждение «элемент лидеров снят стратегом» с причиной, без вопроса', ur.warnings.some(w => /элемент лидеров снят стратегом: блок numbers \(«Цифры компании», x-numbers\) - нет свежих числовых фактов/.test(w)) && !ur.questions.length, JSON.stringify(ur));
    check('exclude_blocks КФ-блока: предупреждение с причиной из notes', ur.warnings.some(w => /элемент лидеров снят стратегом: блок reviews \(«Отзывы», reviews\) - exclude_blocks; notes: «отзывов у компании пока нет»/.test(w)), JSON.stringify(ur.warnings));
    const rr = rep.pages.remont;
    check('пустой facts КФ-блока: исключение как раньше, предупреждение «пустой facts», без заглушки и вопроса', rr.excluded.includes('reviews') && rr.warnings.some(w => /элемент лидеров снят стратегом: блок reviews [^\n]*- пустой facts; причины в notes страницы нет/.test(w)) && !(rj(W('pages', 'remont', 'brief.json')).stubs || []).some(x => x.type === 'reviews') && !rr.questions.some(q => q.blocks.includes('reviews')), JSON.stringify(rr));
    check('предупреждения КФ попадают в общий список отчета', rep.warnings.some(w => w.includes('элемент лидеров снят стратегом')));
    // h2 необязателен вне первого экрана
    const h2 = home.blocks.filter(b => b.role !== 'hero').flatMap(b => b.elements.filter(e => e.kind === 'h2').map(e => e.count));
    check('h2 вне первого экрана - 0-1 у всех блоков', h2.length === 3 && h2.every(c => c === '0-1'), JSON.stringify(h2));
    const about = rj(W('pages', 'o-nas', 'brief.json'));
    check('h2 «1-2» -> «0-2»; h1 первого экрана - 1', about.blocks.filter(b => b.type === 'a').every(b => b.elements.find(e => e.kind === 'h2').count === '0-2') && about.blocks[0].elements.find(e => e.kind === 'h1').count === '1', JSON.stringify(about.blocks.map(b => b.elements.map(e => `${e.kind}:${e.count}`))));
    // заглушка вне blocks: page-state, plan-run, progress ее не видят
    const ps = run(dir, [path.join('scripts', 'page-state.mjs'), 'home']);
    const sw = fs.existsSync(W('pages', 'home', 'state.writer.json')) ? rj(W('pages', 'home', 'state.writer.json')) : null;
    check('page-state: следующий блок - из blocks брифа, не заглушка', ps.code === 0 && sw && /^B0[1-4]-/.test(String(sw.for_block)) && !/reviews|numbers/.test(String(sw.for_block)), ps.out + JSON.stringify(sw));
    const slices = fs.readdirSync(W('pages', 'home', 'brief'));
    check('срезы писателей - только блоки брифа', slices.length === 4 && !slices.some(f => /reviews|numbers/.test(f)), slices.join());
    const prog = await import(pathToFileURL(path.join(dir, 'scripts', 'progress.mjs')).href);
    const pp = prog.pageProgress(dir, 'home');
    check('progress: blocks_total без заглушек', pp.blocks_total === 4 && !pp.blocks.some(b => /reviews|numbers/.test(b.block_id)), JSON.stringify({ total: pp.blocks_total, ids: pp.blocks.map(b => b.block_id) }));
    const pr = run(dir, [path.join('scripts', 'plan-run.mjs'), '--slugs', 'home', '--phase', 'write']);
    let plan = null; try { plan = JSON.parse(pr.stdout); } catch { plan = null; }
    const hp = plan && plan.pages.find(p => p.slug === 'home');
    check('plan-run: pending_blocks без заглушек', !!hp && hp.pending_blocks.length === 4 && !hp.pending_blocks.some(b => /reviews|numbers/.test(String(b))), pr.out.slice(0, 600));
    // повторная сборка без изменений - бриф не переписан
    const before = fs.readFileSync(W('pages', 'home', 'brief.json'), 'utf8');
    const bb2 = run(dir, [path.join('scripts', 'build-briefs.mjs')]);
    check('повторная сборка: без изменений', bb2.code === 0 && /брифов собрано: 0, без изменений: 4/.test(bb2.out) && fs.readFileSync(W('pages', 'home', 'brief.json'), 'utf8') === before, bb2.out);

    // ================================================================== 4. lint-page: мало заголовков
    const mk = (id, type, h2text, text) => wj(W('pages', 'o-nas', 'blocks', `${id}.json`), { block_id: id, type, role: type === 'hero' ? 'hero' : 'conversion', elements: [...(type === 'hero' ? [{ kind: 'h1', text: 'Страница о нас для теста', facts: [] }] : []), ...(h2text ? [{ kind: 'h2', text: h2text, facts: [] }] : []), { kind: 'text', text, facts: [] }], facts_used: [], objections_closed: [], summary: `блок ${type} для теста`, handoff_note: '' });
    const ab = about.blocks;
    const texts = ['Мы работаем по договору.', 'Расскажем, как устроен заказ.', 'Сначала встреча и замер.', 'Потом расчет и смета.', 'Итог согласуем вместе.', 'Оставьте заявку на расчет.'];
    ab.forEach((b, i) => mk(b.block_id, b.type, i === 1 ? 'Как мы работаем' : '', texts[i]));
    const lp = () => { run(dir, [path.join('scripts', 'lint-page.mjs'), 'o-nas']); return rj(W('audit', 'o-nas', 'lint-page.json')); };
    let L = lp();
    let few = L.findings.filter(f => f.rule === 'editorial.few-headings');
    check('lint-page: 6 блоков и 1 h2 - minor editorial.few-headings', few.length === 1 && few[0].severity === 'minor' && few[0].category === 'structure' && /1 h2 на 6/.test(few[0].problem), JSON.stringify(few));
    check('lint-page: отчет с few-headings проходит схему findings', !lib.validate(SCH('findings'), L).length, lib.validate(SCH('findings'), L).join('; '));
    mk(ab[2].block_id, ab[2].type, 'Что входит в работу', texts[2]);
    L = lp();
    check('lint-page: 2 h2 - находки нет', !L.findings.some(f => f.rule === 'editorial.few-headings'));
    mk(ab[2].block_id, ab[2].type, '', texts[2]);
    for (const b of ab.slice(3, 5)) fs.rmSync(W('pages', 'o-nas', 'blocks', `${b.block_id}.json`));
    L = lp();
    check('lint-page: 4 написанных блока - находки нет', !L.findings.some(f => f.rule === 'editorial.few-headings'), JSON.stringify(L.findings.map(f => f.rule)));
  }
  // без kf_coverage - как раньше: блок выпал с вопросом, поля stubs нет, предупреждений КФ нет
  {
    const d2 = mkProject('briefs-old');
    writeBriefProject(d2, { kf: false });
    const r = run(d2, [path.join('scripts', 'build-briefs.mjs')]);
    const h = rj(path.join(d2, 'work', 'pages', 'home', 'brief.json'));
    const rp = rj(path.join(d2, 'work', 'briefs-report.json'));
    check('без kf_coverage: поля stubs нет, reviews и numbers выпали с вопросами', r.code === 0 && !('stubs' in h) && ['reviews', 'numbers'].every(id => rp.pages.home.dropped.some(d => d.block === id) && rp.pages.home.questions.some(q => q.blocks.includes(id))), JSON.stringify(rp.pages.home));
    check('без kf_coverage: предупреждений КФ нет', !rp.warnings.some(w => /элемент лидеров|заглушки элементов/.test(w)));
  }
  // kf_coverage в типах остался, а матрицы нет (этап КФ не проводился) - как раньше, без заглушек
  {
    const d3 = mkProject('briefs-nomatrix');
    writeBriefProject(d3);
    fs.rmSync(path.join(d3, 'work', 'kf', 'matrix.json'));
    const r = run(d3, [path.join('scripts', 'build-briefs.mjs')]);
    const h = rj(path.join(d3, 'work', 'pages', 'home', 'brief.json'));
    const rp = rj(path.join(d3, 'work', 'briefs-report.json'));
    check('нет матрицы, kf_coverage в типе: stubs нет, блоки выпали как раньше, предупреждений КФ нет', r.code === 0 && !('stubs' in h) && ['reviews', 'numbers'].every(id => rp.pages.home.dropped.some(d => d.block === id)) && !rp.warnings.some(w => /элемент лидеров|заглушки элементов/.test(w)), JSON.stringify(rp.pages.home));
  }
  // уровень строки матрицы сильнее устаревшего kf_coverage.level: reviews в матрице «по желанию» - выпадает как раньше
  {
    const d4 = mkProject('briefs-level');
    writeBriefProject(d4);
    wj(path.join(d4, 'work', 'kf', 'matrix.json'), matrix([mrow('home', 'body', 'reviews', 'Отзывы', 1, 'optional')]));
    const r = run(d4, [path.join('scripts', 'build-briefs.mjs')]);
    const h = rj(path.join(d4, 'work', 'pages', 'home', 'brief.json'));
    const rp = rj(path.join(d4, 'work', 'briefs-report.json'));
    check('уровень из матрицы: reviews «по желанию» - не заглушка (dropped), numbers без строки в матрице - по kf_coverage', r.code === 0 && (h.stubs || []).map(x => x.type).join() === 'numbers' && rp.pages.home.dropped.some(d => d.block === 'reviews'), JSON.stringify({ stubs: h.stubs, dropped: rp.pages.home.dropped }));
  }

  // ================================================================== 5. промты, wf-03, бюджеты
  {
    const agg = read('prompts/02-type-aggregator.md'), aud = read('prompts/03-type-auditor.md'), fix = read('prompts/03-type-fixer.md'), str = read('prompts/04-strategist-type.md');
    check('02-type-aggregator: правило КФ одной фразой со ссылкой на kf-coverage.mjs, kf=off', agg.includes('`node scripts/kf-coverage.mjs <type> --rows`') && agg.includes('`kf-coverage.mjs <type> --dir <out>`') && agg.includes('`kind` block') && agg.includes('`kf_coverage`') && agg.includes('`kf=off`') && agg.includes('из фактов'));
    check('03-type-auditor: kf-coverage первым шагом, findings как есть', aud.includes('## Элементы лидеров') && aud.includes('Первым шагом') && aud.includes('`node scripts/kf-coverage.mjs <type> --json`') && aud.includes('как есть') && aud.includes('`kf=off`') && aud.indexOf('## Элементы лидеров') < aud.indexOf('## Что проверить'));
    check('03-type-fixer: находки kf.coverage по выводу kf-coverage.mjs', fix.includes('`kf.coverage`') && fix.includes('`node scripts/kf-coverage.mjs <type>`') && /^11\. Обнови статусы/m.test(fix));
    check('04-strategist-type: снятие КФ-блока - с причиной (одна строка)', str.includes('Блок элемента лидеров (`kf_coverage` типа) снимай только с причиной в `notes`'));
    check('04-strategist-type: прежние правила не сокращены', str.includes('без «не называй F12», «кроме F12»') && str.includes('гарантия, проверка') && str.includes('факты и блоки; не `validate.mjs strategy`'));
    const kfText = [agg.slice(agg.indexOf('11. Элементы лидеров'), agg.indexOf('## Самопроверка')), aud.slice(aud.indexOf('## Элементы лидеров'), aud.indexOf('## Что проверить')), fix.slice(fix.indexOf('9. Находки'), fix.indexOf('10. После правки'))];
    check('промты: правило КФ без перечня элементов КФ', kfText.every(t => t.length > 50 && t.length < 600) && !kfText.some(t => /телефон|корзин|мессенджер|реквизит|рейтинг|крошк|доставк/i.test(t)), kfText.map(t => t.length).join());
    const wf = read('workflows/wf-03-audit-types.js');
    check('wf-03: kf-coverage в аудиторе, роли без изменений', wf.includes('kf-coverage.mjs') && /const ROLES = \{\s*'prep-args': 'light', 'type-audit': 'strong', 'type-fix': 'strong',\s*\}/.test(wf));
    // wf-03 с подставным agent: skipKf - kf=off в обоих кругах аудитора; без флага текст вызовов прежний
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const answer = label => /^audit:.*:1$/.test(label) ? { results: [{ type: 'home', verdict: 'fix', summary: 's', blocker: 1, major: 0 }] }
      : /^fix:/.test(label) ? { results: [{ type: 'home', fixed: 1, rejected: 0, left_open: 0 }] }
      : { results: [{ type: 'home', verdict: 'ok', summary: 's', blocker: 0, major: 0 }] };
    const runWf03 = async args => {
      const calls = [];
      const agent = async (prompt, opts) => { calls.push({ label: opts.label, prompt }); return answer(opts.label); };
      const pipeline = (items, s1, s2) => Promise.all(items.map(async it => s2(await s1(it), it)));
      const fn = new AsyncFunction('args', 'agent', 'parallel', 'phase', 'log', 'pipeline', 'workflow', wf.replace(/^export const meta\s*=/m, 'const meta ='));
      try { await fn(args, agent, fns => Promise.all(fns.map(x => x())), () => {}, () => {}, pipeline, null); return { calls }; } catch (e) { return { e, calls }; }
    };
    const on = await runWf03({ root: '/fake', types: ['home'], type_pages: { home: 3 }, skipKf: true });
    const off = await runWf03({ root: '/fake', types: ['home'], type_pages: { home: 3 } });
    const audits = x => x.calls.filter(c => c.label.startsWith('audit:'));
    const tails = x => x.e ? x.e.message : x.calls.map(c => c.prompt.split('\n').pop()).join(' | ');
    check('wf-03 skipKf: оба круга аудитора с kf=off', !on.e && audits(on).length === 2 && audits(on).every(c => /round=\d; kf=off\.$/.test(c.prompt)), tails(on));
    check('wf-03 без skipKf: параметры аудитора прежние (round=N.)', !off.e && audits(off).length === 2 && audits(off).every(c => /types=\["home"\]; round=\d\.$/.test(c.prompt)), tails(off));
    // новые бюджеты (числа применяет пакет G в cases-prompts.mjs и cases-leaders.mjs)
    const BUDGET = { 'prompts/02-type-aggregator.md': 8300, 'prompts/03-type-auditor.md': 6100, 'prompts/03-type-fixer.md': 3500, 'prompts/04-strategist-type.md': 6900 };
    for (const [f, n] of Object.entries(BUDGET)) {
      const len = read(f).length;
      check(`${f}: размер в новом бюджете (${n} знаков)`, len <= n, `${len} знаков`);
      notes.push(`бюджет для пакета G: ${f} ${n} (сейчас ${len})`);
    }
  }

  // ================================================================== 6. стиль, UUID и ниша файлов пакета
  {
    const YO = String.fromCharCode(0x451), YO2 = String.fromCharCode(0x401), D1 = String.fromCharCode(0x2014), D2 = String.fromCharCode(0x2013);
    const INVIS = [0xad, 0x200b, 0x200c, 0x200d, 0x2060, 0xfeff].map(c => String.fromCharCode(c));
    const NICHE = /(застройщ|депозит|квот[аеуы]|инвестор|недвижим|ипотек|новострой|апартамент|доходност|ювелир|золот|кольц|пирсинг|бриллиант|серебр|помолвоч|обручал|геммолог|пхукет|двигател|запчаст|trade-in|автомобил|goldax)/i;
    const OWN = ['scripts/kf-coverage.mjs', 'prompts/02-type-aggregator.md', 'prompts/03-type-auditor.md', 'prompts/03-type-fixer.md', 'prompts/04-strategist-type.md', 'schemas/page-type.schema.json', 'schemas/brief.schema.json', 'workflows/wf-03-audit-types.js', 'scripts/build-briefs.mjs', 'scripts/lint-page.mjs'];
    const bad = [];
    for (const f of OWN) {
      const t = read(f);
      if ([YO, YO2, D1, D2].some(ch => t.includes(ch))) bad.push(`${f}: е с точками или длинное тире`);
      if (INVIS.some(ch => t.includes(ch))) bad.push(`${f}: невидимый символ литералом`);
      if (/mcp__[0-9a-f]{8}-/.test(t)) bad.push(`${f}: UUID MCP`);
      const nm = t.match(NICHE); if (nm) bad.push(`${f}: нишевое слово «${nm[0]}»`);
    }
    check('файлы пакета C: без е с точками, длинных тире, невидимых символов, UUID MCP и нишевых слов', !bad.length, bad.join('; '));
  }
} catch (e) {
  fail++; failures.push(`FAIL исключение: ${e.stack || e.message}`);
} finally {
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* временная папка */ }
}

notes.forEach(n => console.log(`NOTE ${n}`));
failures.forEach(f => console.log(f));
console.log(`cases-kf-types: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
