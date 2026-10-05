// Брифы, линтер и скрипты стратегии kit /site-tekst (пакет W1 программы 2026-09-27). Запуск:
//   node .claude/tests/site-tekst/cases-briefs.mjs      код выхода 0 - все прошли (или через run.mjs рядом).
// Все во временной папке (os.tmpdir()), синтетические данные, без сети и без данных клиентов.
// Разделы: 1. lib (лимиты, контракт кнопок, id в task, decisions.md v2, пути); 2. схемы (custom, strategy-review,
// поля блока, CTA); 3. build-briefs на синтетической карте (порядок, факты, возражения, выпадение, count, оговорка,
// ссылки, сегмент all, CTA, листинг, unknowns, отчет, срезы); 4. смена данных (5.19: без изменений, перелинт,
// структура, --force с перенумерацией и lint-файлами); 5. лендинг; 6. merge-strategy --check, сборка, --matrix;
// 7. линтер (fact.hedge-lost, embellish, лимиты без второго среза, CTA, rule не повтор, подсказки, нишевые маркеры),
// lint-page (page_sha), page-state, срезы старого формата; 8. renumber-blocks; 9. программа 28.09, пакет P3a: «Где можно»
// (только, везде, кроме), страховки «не публикуем» и конфликта, цифры формулировки §1, count по опорам-единицам, блок
// цифр, пустой facts = исключение, наследование CTA, K5 key_phrase, K7 (предупреждение по данным), cta-final, маска
// примеров, оговорка, первый экран без фактов (« ~ »), словарь страницы в линтере, стоп-слова, «обращение ко всем»,
// embellish, Р5 (повторы только с блоками выше, состояние писателя по блокам выше); 9.7 №24 после повторной проверки:
// придаточное и причастный оборот (только с зависимым словом) - не пункт в единицах опор, прилагательные и
// субстантивированные причастия в списке - пункты, подписи блока цифр не выше новой границы number, блок цифр без свежих
// числовых фактов (явные facts стратега не выпадают, вопроса заказчику нет).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  validate, KIND_CAP, effectiveMax, kindCap, parseCount, isListing, blockContract, taskFactRefs, parseDecisions, decisionAllows,
  protectedFactTexts, normPath, SEGMENT_ALL_NAME, DECISIONS_V2, allowedRuleText,
  digitsOf, factUnits, mergeCta, resolveBlockId, isNumbersBlock, isServiceText,
} from '../../skills/site-tekst/kit/scripts/lib.mjs';
import { compileLint, hedgeLostFindings, scanBlock, nameMask, stopWordsRe } from '../../skills/site-tekst/kit/scripts/lint-common.mjs';
import { briefSha, prefsForBlock, maskExample, sliceBrief, SLICE_FORMAT } from '../../skills/site-tekst/kit/scripts/writer-inputs.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TPL = path.resolve(HERE, '..', '..', 'skills', 'site-tekst', 'kit');
let pass = 0, fail = 0;
const failures = [];
function check(name, ok, detail = '') {
  if (ok) pass++;
  else { fail++; failures.push(`FAIL ${name}${detail ? ': ' + String(detail).slice(0, 600) : ''}`); }
}

// ---------- помощники ----------
const rj = f => JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, ''));
const wj = (f, o) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(o, null, 2) + '\n'); };
const wt = (f, s) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, s); };
const clone = o => JSON.parse(JSON.stringify(o));
const SCHEMAS = {};
const schemaErrors = (name, data) => validate(SCHEMAS[name] ??= rj(path.join(TPL, 'schemas', `${name}.schema.json`)), data);
function checkSchema(label, name, data) { const e = schemaErrors(name, data); check(`${label} проходит схему ${name}`, !e.length, e.slice(0, 3).join('; ')); }
function run(cwd, args) {
  const r = spawnSync(process.execPath, args, { cwd, encoding: 'utf8' });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), stdout: r.stdout || '' };
}
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cases-briefs-'));
function mkProject(name) {
  const dir = path.join(tmpRoot, name);
  for (const d of ['scripts', 'rules', 'schemas', 'config']) fs.cpSync(path.join(TPL, d), path.join(dir, d), { recursive: true });
  return dir;
}
const RULES = rj(path.join(TPL, 'rules', 'lint.json'));

// ---------- синтетический проект ----------
const el = (kind, count, max, extra = {}) => ({ kind, count, chars: { min: 0, median: 0, max }, ...extra });
const blk = (id, role, pattern, elements, extra = {}) => ({ id, name: `Блок ${id}`, role, reader_question: `Вопрос читателя про ${id}`, pattern, elements, seen_at: [], examples: [], ...extra });
const B = {
  hero: blk('hero', 'hero', 'hero-split', [el('h1', '1', 70), el('sub', '1', 200), el('button', '1', 30)], { core: true, cta_allowed: true, fact_kinds: ['number', 'legal', 'claim'] }),
  heroNoBtn: blk('hero', 'hero', 'hero-center', [el('h1', '1', 70), el('sub', '1', 160)], { core: true, cta_allowed: true, fact_kinds: ['claim'] }),
  benefits: blk('benefits', 'conversion', 'grid-3', [el('h2', '1', 80), el('card', '3-4', 900)], { objection_slot: true, fact_kinds: ['number', 'claim', 'legal'] }),
  process: blk('process', 'conversion', 'steps', [el('h2', '1', 80), el('step', '3-5', 200)], { objection_slot: true, fact_kinds: ['process'] }),
  reviews: blk('reviews', 'conversion', 'quote', [el('h2', '1', 80), el('quote', '2-3', 300)], { fact_kinds: ['claim'] }),
  calc: blk('calc', 'conversion', 'custom', [el('h2', '1', 80), el('text', '1', 300), el('field', '2-3', 30)], { custom_name: 'калькулятор стоимости' }),
  faq: blk('faq', 'info', 'accordion', [el('h2', '1', 80), el('qa', '4-6', 400)], { objection_slot: true, fact_kinds: ['legal'] }),
  notPromise: blk('not-promise', 'conversion', 'list', [el('h2', '1', 80), el('bullets', '3-5', 120)]),
  cta: blk('cta', 'conversion', 'cta-band', [el('h2', '1', 80), el('text', '1', 200), el('button', '1-2', 30)], { core: true, cta_allowed: true, fact_kinds: ['process'] }),
  listing: blk('listing', 'conversion', 'listing', [el('h2', '1', 60), el('text', '1', 200), el('card', '3-6', 200)], { core: true }),
  related: blk('related', 'info', 'tiles', [el('h2', '1', 60), el('link', '1-3', 40)]),
};
const ptype = (type, blocks, order) => ({ type, sources: [{ domain: 'lider.example', url: 'https://lider.example/', raw: 'work/competitors/raw/x.json', status: 'ok' }], market_blocks: blocks, differentiation_blocks: [], recommended_order: order || blocks.map(b => b.id), cliches_to_avoid: ['индивидуальный подход'] });
const page = (slug, url, type, level, parent, extra = {}) => ({ slug, url, type, subject: `Страница ${slug}`, parent, level, segment: 'S1', status: 'planned', block_set: 'full', ...extra });
const entry = (facts, extra = {}) => ({ segment: 'S1', unique_argument: 'Уникальный довод страницы для теста', objection_ids: [], offer_formula: 'F3', cta: { main: 'Получить расчет' }, facts, ...extra });
function base() {
  return {
    config: (() => { const c = rj(path.join(TPL, 'config', 'project.json')); c.company = 'Тест Мастерская'; c.niche.business_type = 'both'; c.limits.drop_blocks_without_facts = ['reviews', 'cases:number']; return c; })(),
    sitemap: { page_types: ['home', 'hub', 'category', 'service', 'product', 'info_about', 'info_contacts', 'info_other'], pages: [
      page('home', '/', 'home', 0, ''),
      page('uslugi', '/uslugi', 'hub', 1, '/'),
      page('remont', '/uslugi/remont/', 'service', 2, '/uslugi/'),
      page('montazh', '/uslugi/montazh', 'service', 2, 'https://site.example/uslugi'),
      page('okna', '/okna', 'category', 1, '/', { listing: true }),
      page('dveri', '/dveri', 'category', 1, '/', { listing: false }),
      page('korzina', '/korzina', 'info_other', 1, '/', { ui_role: 'cart' }),
      page('tovar', '/okna/{slug}', 'product', 2, '/okna', { template: true }),
      page('privacy', '/privacy', 'info_other', 1, '/', { status: 'skip' }),
    ] },
    facts: {
      source: 'синтетика',
      facts: [
        { id: 'F01', label: 'срок изготовления', value: 'стандартно 3 недели', wording: 'Стандартно 3 недели на изделие', publish: 'yes', kind: 'number', note: 'срочно - по договоренности' },
        { id: 'F02', label: 'замер', value: 'на следующий день', wording: 'Замер на следующий день после заявки', publish: 'yes', kind: 'process' },
        { id: 'F03', label: 'договор', value: 'до начала работ', wording: 'Договор до начала работ', publish: 'yes', kind: 'process' },
        { id: 'F04', label: 'гарантия', value: '12 месяцев', wording: 'Гарантия 12 месяцев', publish: 'yes', kind: 'legal' },
        { id: 'F05', label: 'свой цех', value: 'свой цех', wording: 'Свой цех в городе', publish: 'yes', kind: 'claim' },
        { id: 'F06', label: 'старая цена', value: '9 900', wording: 'от 9 900', publish: 'no', kind: 'number' },
        { id: 'F07', label: 'только главная', value: 'факт главной', wording: 'Факт для главной страницы', publish: 'yes', kind: 'claim' },
        { id: 'F08', label: 'экономия', value: 'в среднем на 20%', wording: 'В среднем на 20% дешевле', publish: 'yes', kind: 'number' },
        { id: 'F09', label: 'выезд', value: 'выезд мастера', wording: 'Выезд мастера по городу', publish: 'yes', kind: 'process' },
        { id: 'F10', label: 'снятый решением', value: 'снят', wording: 'Факт, снятый решением', publish: 'yes', kind: 'claim' },
        { id: 'F11', label: 'телефон', value: '+7 000 000-00-00', wording: '+7 000 000-00-00', publish: 'yes', kind: 'contact' },
      ],
      anti_promises: [{ id: 'A01', text: 'не обещаем самую низкую цену', lint_pattern: 'самая низкая цена' }],
      terminology: { use: [], jargon: [], untranslatable: [] },
      company: { status: 'confirmed', phones: ['+7 000 000-00-00'], channels: {} },
      gaps: ['открытый вопрос анализа (g1): цены по типам изделий', 'регулярка антиобещания A01 не задана'],
    },
    audience: {
      segments: [
        { id: 'S1', name: 'Семья', portrait: 'Семья с ремонтом', comes_with: 'хотят успеть до зимы', pains: ['дует', 'дорого'], fears: ['обманут'], criteria: ['гарантия'], objections: [{ id: 'O1', text: 'сломается', answer: 'гарантия 12 месяцев', facts: ['F04'] }, { id: 'O2', text: 'долго', answer: 'замер завтра', facts: [] }] },
        { id: 'S2', name: 'Дачник', portrait: 'Владелец дачи', comes_with: 'нужно к сезону', pains: ['холодно'], fears: [], criteria: ['цена'], objections: [{ id: 'O3', text: 'дорого', answer: 'свой цех', facts: ['F05'] }] },
      ],
      client_phrases: [{ phrase: 'чтобы не дуло', meaning: 'герметичность', segments: ['S1'] }, { phrase: 'к сезону', meaning: 'срок', segments: ['S2'] }, { phrase: 'без переплат', meaning: 'цена' }],
    },
    strategy: {
      global: {
        positioning: 'Позиционирование теста', main_promise: 'Главное обещание теста',
        offer_formula_by_type: {}, cta_by_type: { service: 'Вызвать мастера', hub: { main: 'Отправить заявку' }, category: { main: 'Подобрать модель', action: 'page:ghost' } },
        argument_bank: [{ fact_id: 'F04', angles: [{ segment: 'S2', angle: 'угол для дачи' }] }],
        objection_to_block: { O1: 'faq' }, disclaimer_block: 'not-promise', disclaimer_text: 'Итог считается по замеру',
      },
      pages: {
        home: entry(['F01', 'F02', 'F04', 'F05', 'F07', 'F08', 'F06', 'F10'], { hero_facts: ['F01', 'F04'], objection_ids: ['O1', 'O2'], exclude_blocks: ['process'], block_overrides: { reviews: { facts: [] } }, cta: { main: 'Получить расчет', action: 'anchor:cta', short: 'Расчет' } }),
        uslugi: entry(['F05'], { cta: undefined }),
        remont: entry(['F02', 'F05', 'F07', 'F09'], { block_overrides: { cta: { task: 'Назови F02. Без F03 не пиши про договор.' } }, cta: undefined }),
        montazh: entry(['F05'], { cta: undefined }),
        okna: entry(['F05'], { cta: undefined }),
        dveri: entry(['F05'], { cta: undefined }),
        korzina: entry([]),
        tovar: entry([]),
      },
    },
    types: {
      home: ptype('home', [B.hero, B.benefits, B.process, B.reviews, B.calc, B.faq, B.notPromise, B.cta]),
      hub: ptype('hub', [B.hero, B.listing, B.related, B.cta]),
      service: ptype('service', [B.heroNoBtn, B.process, B.faq, B.cta]),
      category: ptype('category', [B.hero, B.listing, B.cta]),
      product: ptype('product', [B.hero, B.cta]),
      info_other: ptype('info_other', [B.hero, B.cta]),
    },
    prefs: { items: [
      { text: 'Тон спокойный и деловой', status: 'basis', where: 'tone' },
      { text: 'Сказать про свой цех', status: 'basis', where: 'faq', pages: ['home'] },
      { text: 'Обещание первого экрана', status: 'candidate', where: 'hero' },
      { text: 'Телефон в шапке', status: 'basis', where: 'shell' },
      { text: 'Без адреса', status: 'basis' },
      { text: 'Пожелание блоку, которого нет', status: 'basis', where: 'gallery', pages: ['home'] },
    ] },
    decisions: [
      DECISIONS_V2, '# Решения', '', '## 1. Конфликты фактов', '',
      '| Факт | Конфликт | Разрешенная формулировка | Где можно |', '|---|---|---|---|',
      '| F.. | | | |',
      '| F07 | только главная | «Факт для главной» | home |',
      '| F08 | цифра без условия | «в среднем на 20% дешевле» | все |',
      '| F09 | проза | как есть | главная и услуги |',
      '| F10 | снят | не публикуем | нигде |',
      '| F12-F13 | диапазон | «диапазон» | service, hub |',
      '', 'Открытые пробелы, по которым не пишем: g1, срок ответа на заявку', '', '## 8. Спорное: решения агента', '',
    ].join('\n'),
  };
}
function writeProject(dir, d) {
  wj(path.join(dir, 'config', 'project.json'), d.config);
  wj(path.join(dir, 'work', 'sitemap.json'), d.sitemap);
  wj(path.join(dir, 'work', 'facts.json'), d.facts);
  wj(path.join(dir, 'work', 'audience.json'), d.audience);
  const st = clone(d.strategy);
  for (const e of Object.values(st.pages)) if (e.cta === undefined) delete e.cta;
  for (const [slug, e] of Object.entries(st.pages)) if (!e.cta) e.cta = { main: '' };
  wj(path.join(dir, 'work', 'strategy.json'), st);
  for (const [t, pt] of Object.entries(d.types)) wj(path.join(dir, 'work', 'page-types', `${t}.json`), pt);
  wj(path.join(dir, 'work', 'client-preferences.json'), d.prefs);
  if (d.decisions != null) wt(path.join(dir, 'rules', 'decisions.md'), d.decisions);
}
// cta без main у страницы: берется cta_by_type типа
function fixCta(d) { for (const e of Object.values(d.strategy.pages)) if (e.cta && !e.cta.main) delete e.cta; return d; }

try {
  // ================================================================== 1. lib
  {
    check('KIND_CAP: все виды элементов схемы блока', ['h1', 'h2', 'h3', 'sub', 'text', 'bullets', 'button', 'badges', 'card', 'step', 'qa', 'quote', 'image', 'field', 'number', 'note', 'link', 'filters', 'table_row'].every(k => KIND_CAP[k] > 0));
    check('effectiveMax: замер выше границы вида режется до границы * 1.2', effectiveMax('card', 900) === Math.round(KIND_CAP.card * 1.2) && effectiveMax('card', 150) === 150);
    check('effectiveMax: без замера - граница вида; config limits переопределяет', effectiveMax('h1', 0) === 70 && effectiveMax('h1', 0, '', { h1_max: 60 }) === 60 && kindCap('bullets', { bullet_max: 90 }) === 90);
    check('effectiveMax: поля с фиксированным лимитом', effectiveMax('card', 200, 'title') === 80 && effectiveMax('qa', 400, 'q') === 90 && effectiveMax('number', 40, 'value') === 20 && effectiveMax('quote', 300, 'author') === 60);
    check('effectiveMax: идемпотентен (линтер не режет второй раз)', effectiveMax('text', effectiveMax('text', 900)) === effectiveMax('text', 900));
    check('parseCount', JSON.stringify(parseCount('3-5')) === '{"lo":3,"hi":5}' && JSON.stringify(parseCount('2')) === '{"lo":2,"hi":2}' && parseCount('много') === null);
    check('isListing - только pattern', isListing({ pattern: 'listing', type: 'x' }) && !isListing({ type: 'listing', pattern: 'grid-3' }));
    const hero = { block_id: 'B01-hero', role: 'hero', cta_allowed: true, elements: [{ kind: 'h1', count: '1' }] };
    const w1 = blockContract(hero);
    check('blockContract: у первого экрана нет кнопки - добавлена одна, предупреждение', hero.elements.filter(e => e.kind === 'button').length === 1 && hero.elements.find(e => e.kind === 'button').count === '1' && w1.length === 1);
    const hero2 = { block_id: 'B01-hero', role: 'hero', cta_allowed: true, elements: [{ kind: 'button', count: '1-2' }, { kind: 'button', count: '1' }] };
    blockContract(hero2);
    check('blockContract: у первого экрана ровно одна кнопка count 1', hero2.elements.length === 1 && hero2.elements[0].count === '1');
    const c = { block_id: 'B05-cta', role: 'conversion', cta_allowed: true, elements: [{ kind: 'button', count: '2' }] };
    blockContract(c);
    check('blockContract: блок с CTA - кнопок не больше 1', c.elements[0].count === '1');
    const ui = { block_id: 'B02-filters', role: 'conversion', cta_allowed: false, elements: [{ kind: 'button', count: '2' }] };
    check('blockContract: кнопки интерфейса не трогаются', !blockContract(ui).length && ui.elements[0].count === '2');
    const t = s => taskFactRefs(s);
    check('taskFactRefs: утвердительные', JSON.stringify(t('Назови F03 и F04 рядом с кнопкой')) === '{"pos":["F03","F04"],"neg":[]}');
    check('taskFactRefs: «без», «кроме», «не называй» перед id', JSON.stringify(t('Без F06. Кроме F07 все можно. Не называй F08')) === '{"pos":[],"neg":["F06","F07","F08"]}');
    check('taskFactRefs: «F06 не называй» (отрицание после id)', JSON.stringify(t('Старую цену F06 не называй.')) === '{"pos":[],"neg":["F06"]}');
    check('taskFactRefs: отрицание действует до запятой', JSON.stringify(t('Без F06, назови F07')) === '{"pos":["F07"],"neg":["F06"]}');
    check('taskFactRefs: «без оговорок назови F03» - утвердительно; «кроме того» не отрицание', JSON.stringify(t('Без оговорок назови F03')) === '{"pos":["F03"],"neg":[]}' && JSON.stringify(t('Кроме того назови F05')) === '{"pos":["F05"],"neg":[]}');
    // decisions.md
    const decText = base().decisions;
    const d0 = parseDecisions(decText.replace(DECISIONS_V2, ''), { slugs: ['home'], types: ['home'] });
    check('parseDecisions: без маркера v2 - ничего не разбирает', !d0.v2 && !Object.keys(d0.facts).length && !d0.gaps.length);
    const d = parseDecisions(decText, { slugs: ['home', 'remont'], types: ['home', 'service', 'hub'] });
    check('parseDecisions: маркер, заготовка F.. пропущена, диапазон раскрыт', d.v2 && !d.facts['F..'] && !!d.facts.F12 && !!d.facts.F13 && d.facts.F12.allow instanceof Set);
    check('parseDecisions: rule и where в строках', d.facts.F07.rule === '«Факт для главной»' && d.facts.F07.where === 'home');
    check('parseDecisions: все / нигде / список', d.facts.F08.allow === 'all' && d.facts.F10.allow === 'none' && d.facts.F07.allow.has('home'));
    check('parseDecisions: проза в «Где можно» - колонка не применяется, предупреждение', d.facts.F09.allow === null && d.warnings.some(w => /F09: «Где можно» не разобрано \(главная и услуги\)/.test(w)), JSON.stringify(d.warnings));
    check('parseDecisions: строка открытых пробелов', JSON.stringify(d.gaps) === JSON.stringify(['g1', 'срок ответа на заявку']));
    const d2 = parseDecisions([DECISIONS_V2, '| Факт | Конфликт | Разрешенная формулировка | Где можно |', '|---|---|---|---|', '| F01 | a | «один» | home |', '| F01 | b | «два» | remont |', '| F02 | c | x | home |', '| F02 | d | y | непонятно где |'].join('\n'), { slugs: ['home', 'remont'], types: [] });
    check('parseDecisions: один id в двух строках - rule склеен, допуск - объединение', d2.facts.F01.rule === '«один» | «два»' && decisionAllows(d2.facts.F01.allow, { slug: 'remont', type: 'service' }) && !decisionAllows(d2.facts.F01.allow, { slug: 'x', type: 'service' }));
    check('parseDecisions: неразобранная строка у id - фильтра нет', d2.facts.F02.allow === null);
    check('decisionAllows: тип и info_*', decisionAllows(new Set(['service']), { slug: 'a', type: 'service' }) && decisionAllows(new Set(['info_*']), { slug: 'a', type: 'info_faq' }) && !decisionAllows('none', { slug: 'a', type: 'home' }) && decisionAllows(null, { slug: 'a', type: 'home' }));
    const dg = parseDecisions([DECISIONS_V2, 'Открытые пробелы, по которым не пишем ничего: срок ответа (g4) - не обещать скорость, писать, что', 'человек получит и через какой канал; g1, g2, j3; металлы и пробы (g3); оплата - только F37.'].join('\n'), { slugs: [], types: [] });
    check('parseDecisions: пробелы - пункты через «;», запятая делит только id', JSON.stringify(dg.gaps) === JSON.stringify(['срок ответа (g4) - не обещать скорость, писать, что человек получит и через какой канал', 'g1', 'g2', 'j3', 'металлы и пробы (g3)', 'оплата - только F37']), JSON.stringify(dg.gaps));
    check('allowedRuleText: запрет с числом не разрешен', allowedRuleText('Не пересчитывать в «18 лет»') === '' && allowedRuleText('Без «от 3 дней»') === '' && allowedRuleText('«18 лет» - нельзя') === '');
    check('allowedRuleText: перечисления запретов через запятую и «запрещены» после списка', allowedRuleText('Только «работаем с 2008 года». Не пересчитывать в «18 лет», «почти 20 лет на рынке» и т.п.') === 'работаем с 2008 года' && allowedRuleText('«12 месяцев на изделие». Слова «пожизненная», «вечная» запрещены') === '12 месяцев на изделие' && allowedRuleText('Не публикуем: выпуск в день и «в основном ювелиры»') === '' && allowedRuleText('Вместо «18 лет» писать «с 2008 года»') === 'с 2008 года');
    check('allowedRuleText: разрешенный фрагмент при запрете рядом', allowedRuleText('Писать «с 2008 года», не пересчитывать в «18 лет»') === 'с 2008 года' && allowedRuleText('не «18 лет», а «с 2008 года»') === 'с 2008 года' && allowedRuleText('Писать так: «с 2008 года» | Не округлять: «20 лет»') === 'с 2008 года', allowedRuleText('Писать «с 2008 года», не пересчитывать в «18 лет»'));
    check('allowedRuleText: без елочек и пусто - пусто', allowedRuleText('как есть') === '' && allowedRuleText(undefined) === '');
    check('protectedFactTexts: wording и rule', JSON.stringify(protectedFactTexts({ facts: [{ wording: 'а', rule: 'б' }, { wording: 'в' }] })) === '["а","б","в"]');
    check('normPath: слеш, полный URL, пусто', normPath('/a/b/') === '/a/b' && normPath('https://site.example/a/') === '/a' && normPath('/') === '/' && normPath('') === '' && normPath('https://site.example') === '/');
    check('SEGMENT_ALL_NAME - константа kit', typeof SEGMENT_ALL_NAME === 'string' && SEGMENT_ALL_NAME.length > 3);
  }

  // ================================================================== 2. схемы
  {
    const pt = ptype('home', [B.hero, B.calc]);
    checkSchema('page-type с pattern custom и custom_name', 'page-type', pt);
    const bad = clone(pt); bad.market_blocks[1].pattern = 'calculator';
    check('page-type: неизвестный pattern - ошибка схемы', schemaErrors('page-type', bad).some(e => /pattern/.test(e)));
    checkSchema('findings с producer strategy-review', 'findings', { scope: 'strategy', producer: 'strategy-review', created_at: '2026-09-27 10:00', verdict: 'fix', findings: [{ id: 'SR-1', severity: 'major', category: 'fact', rule: 'strategy.twin', problem: 'близнецы', page: 'a' }] });
    checkSchema('блок с attempts, brief_sha и needs_fact', 'block', { block_id: 'B01-hero', type: 'hero', elements: [{ kind: 'h1', text: 'Текст' }], facts_used: [], objections_closed: [], summary: 'первый экран теста', handoff_note: '', attempts: 2, brief_sha: 'abc', needs_fact: ['срок доставки'] });
    const st = { global: { offer_formula_by_type: {}, cta_by_type: { home: { main: 'A', action: 'lead' }, service: 'Старая строка' }, argument_bank: [], objection_to_block: {}, disclaimer_block: '' }, pages: { a: entry(['F01'], { segment: 'all', exclude_blocks: ['faq'], block_overrides: { faq: { facts: [], objection_ids: [], task: 'Назови F01' } }, cta: { main: 'Получить', secondary: 'Позвонить', action: 'anchor:form', secondary_action: 'call', short: 'Расчет' } }) } };
    checkSchema('strategy: CTA C3, exclude_blocks, block_overrides, cta_by_type строкой и объектом', 'strategy', st);
    const long = clone(st); long.pages.a.cta.short = 'Очень длинная подпись кнопки';
    check('strategy: cta.short длиннее 20 - ошибка', schemaErrors('strategy', long).some(e => /short/.test(e)));
    const sch = rj(path.join(TPL, 'schemas', 'strategy.schema.json'));
    check('strategy: определение dispute', !validate({ type: 'array', items: { $ref: '#/definitions/dispute' } }, [{ question: 'Что ставить', decision: 'Решили так', why: 'Потому что' }], sch).length);
  }

  // ================================================================== 3. build-briefs на синтетической карте
  const A = mkProject('synth');
  const AW = (...p) => path.join(A, 'work', ...p);
  const data = fixCta(base());
  writeProject(A, data);
  const bb = run(A, ['scripts/build-briefs.mjs']);
  check('build-briefs: код 0, брифов 8 (skip-страница не в счет)', bb.code === 0 && /брифов собрано: 8, без изменений: 0/.test(bb.out) && /проблем: 0/.test(bb.out), bb.out);
  check('build-briefs: вывод - сводка предупреждений по видам с примерами', /^предупреждения \(\d+\) по видам:$/m.test(bb.out) && /^ - facts: \d+; например: /m.test(bb.out), bb.out);
  const brief = slug => rj(AW('pages', slug, 'brief.json'));
  const H = brief('home');
  for (const slug of ['home', 'uslugi', 'remont', 'montazh', 'okna', 'dveri', 'korzina', 'tovar']) checkSchema(`build-briefs: ${slug}/brief.json`, 'brief', brief(slug));
  const hb = type => H.blocks.find(b => b.type === type);
  // полный список предупреждений - в отчете (вывод печатает по 3 примера на вид)
  const WR = rj(AW('briefs-report.json')).warnings.join(' | ');
  const facts = b => (b ? b.facts : []);
  {
    // a. порядок
    // программа 28.09: явный пустой facts у блока из drop-списка - решение стратега снять блок, как exclude_blocks
    // (раньше - dropped с вопросом «Нужны факты для блока» заказчику)
    check('a: exclude_blocks убирает блок, excluded в отчете', !hb('process') && rj(AW('briefs-report.json')).pages.home.excluded.join() === 'process,reviews', rj(AW('briefs-report.json')).pages.home.excluded.join());
    check('a: явный пустой facts у блока из drop-списка - исключение: блока нет, в excluded, не в dropped, вопроса заказчику нет', !hb('reviews') && rj(AW('briefs-report.json')).pages.home.excluded.includes('reviews') && !rj(AW('briefs-report.json')).pages.home.dropped.some(x => x.block === 'reviews') && !rj(AW('briefs-report.json')).questions.some(q => /Блок reviews/.test(q.text)));
    check('a: block_id перенумерованы подряд', H.blocks.map(b => b.block_id).join() === 'B01-hero,B02-benefits,B03-calc,B04-faq,B05-not-promise,B06-cta', H.blocks.map(b => b.block_id).join());
    // b. факты страницы
    const ids = H.facts.map(f => f.id);
    check('b: publish no (F06) и «нигде» (F10) сняты, facts_dropped с причиной', !ids.includes('F06') && !ids.includes('F10') && rj(AW('briefs-report.json')).pages.home.facts_dropped.some(x => x.id === 'F06' && x.reason === 'publish') && rj(AW('briefs-report.json')).pages.home.facts_dropped.some(x => x.id === 'F10' && x.reason === 'where'));
    check('b: F07 (Где можно: home) на главной есть, на remont снят по where', ids.includes('F07') && !brief('remont').facts.some(f => f.id === 'F07') && rj(AW('briefs-report.json')).pages.remont.facts_dropped.some(x => x.id === 'F07' && x.reason === 'where'));
    check('b: F09 с прозой в «Где можно» не фильтруется, предупреждение decisions', brief('remont').facts.some(f => f.id === 'F09') && /F09: «Где можно» не разобрано/.test(WR) && /^ - decisions: \d+; например: /m.test(bb.out), WR);
    check('b: факты назначенных возражений (O1 -> F04) - в фактах страницы', ids.includes('F04'));
    check('b: rule и where из decisions.md, note из facts.json - в brief.facts', H.facts.find(f => f.id === 'F08').rule === '«в среднем на 20% дешевле»' && H.facts.find(f => f.id === 'F08').where === 'все' && H.facts.find(f => f.id === 'F01').note === 'срочно - по договоренности');
    check('b: id после отрицания в task - предупреждение строкой', /remont: cta\.task: id после отрицания \(F03\) в факты блока не взят - запрет пишется словами/.test(WR), WR);
    check('b: id после отрицания в task (F03) - не в фактах, F02 - в фактах блока cta', !brief('remont').facts.some(f => f.id === 'F03') && brief('remont').blocks.find(b => b.type === 'cta').facts.includes('F02'));
    // d. факты блоков
    check('d: первый экран - hero_facts', facts(hb('hero')).join() === 'F01,F04');
    check('d: дедупликация fact_kinds - факты первого экрана не повторяются, если хватает свежих', facts(hb('benefits')).join() === 'F05,F07,F08', facts(hb('benefits')).join());
    check('d: свежих не хватило - берется уже отданный факт (faq: F04)', facts(hb('faq')).join() === 'F04');
    check('d: все факты блоков - среди фактов страницы', H.blocks.every(b => b.facts.every(f => ids.includes(f))));
    check('d: owner_block - первый блок с фактом', H.facts.find(f => f.id === 'F04').owner_block === 'B01-hero' && H.facts.find(f => f.id === 'F05').owner_block === 'B02-benefits' && H.facts.find(f => f.id === 'F02').owner_block === 'B06-cta');
    // c. возражения
    check('c: objection_to_block (O1 -> faq), остальное - в слот с наименьшей загрузкой', hb('faq').objection_ids.join() === 'O1' && hb('benefits').objection_ids.join() === 'O2', JSON.stringify(H.blocks.map(b => [b.type, b.objection_ids])));
    // e. элементы
    check('e: max через effectiveMax, min и median не выше max', hb('benefits').elements.find(e => e.kind === 'card').chars.max === effectiveMax('card', 900) && H.blocks.every(b => b.elements.every(e => e.chars.min <= e.chars.max && e.chars.median <= e.chars.max)));
    check('e: первый экран - одна кнопка; cta 1-2 -> 1', hb('hero').elements.filter(e => e.kind === 'button').map(e => e.count).join() === '1' && hb('cta').elements.find(e => e.kind === 'button').count === '1');
    check('e: первый экран без кнопки в типе - кнопка добавлена', brief('remont').blocks[0].elements.some(e => e.kind === 'button' && e.count === '1') && /remont: B01-hero: у первого экрана не было кнопки/.test(WR));
    // программа 28.09 (мелкая развилка): снижение нижней границы - только предупреждение, вопроса заказчику нет
    check('e: qa 4-6 при опорах 2 (F04 + возражение O1 с фактами) -> 2-6, предупреждение count, вопроса в отчете нет', hb('faq').elements.find(e => e.kind === 'qa').count === '2-6' && /home: B0\d-faq: qa 4-6 при опорах 2 -> 2-6/.test(WR) && !rj(AW('briefs-report.json')).questions.some(q => /Блок faq/.test(q.text)), WR);
    check('e: шаги 3-5 при одном факте процесса -> 2-5 (remont process: F02, F09)', brief('remont').blocks.find(b => b.type === 'process').elements.find(e => e.kind === 'step').count === '2-5');
    check('e: custom_name блока pattern custom - в брифе', hb('calc').pattern === 'custom' && hb('calc').custom_name === 'калькулятор стоимости');
    // h. оговорка
    check('h: оговорка - в блоке оговорок; brief.disclaimer_text для судьи', hb('not-promise').disclaimer_text === 'Итог считается по замеру' && H.blocks.filter(b => b.disclaimer_text).length === 1 && H.disclaimer_text === 'Итог считается по замеру');
    // программа 28.09: оговорка только там, где ее решил стратег (запасного блока с CTA больше нет)
    check('h: нет блока оговорок на странице - оговорки нет ни в блоках, ни в брифе', !brief('okna').blocks.some(b => b.disclaimer_text) && !brief('okna').disclaimer_text);
    // i. ссылки
    const L = brief('remont').links.map(l => l.url);
    check('i: ссылки по близости: родитель (слеш на конце), сосед (полный URL родителя), дальше верхний уровень', L[0] === '/uslugi' && L[1] === '/uslugi/montazh' && L.includes('/okna'), L.join(' '));
    check('i: служебные страницы (ui_role) и шаблоны - не в ссылках', !L.includes('/korzina') && !L.includes('/okna/{slug}') && !H.links.some(l => /korzina|\{slug\}/.test(l.url)), `${L.join(' ')} || ${H.links.map(l => l.url).join(' ')}`);
    // g. CTA
    check('g: CTA - объект; action anchor:cta (блок на странице) сохранен, short сохранен', H.cta.main === 'Получить расчет' && H.cta.action === 'anchor:cta' && H.cta.short === 'Расчет');
    check('g: CTA строкой из старых данных -> {main}', brief('remont').cta.main === 'Вызвать мастера' && !('action' in brief('remont').cta));
    check('g: неверное действие (page:ghost) снято с предупреждением', brief('okna').cta.main === 'Подобрать модель' && !brief('okna').cta.action && /okna: CTA action: страницы ghost нет/.test(WR), WR);
    check('g: слабый глагол CTA - предупреждение build-briefs', /uslugi: CTA main «Отправить заявку»: слабый глагол «отправить»/.test(WR), WR);
    // листинг
    const ok = brief('okna').blocks.find(b => b.type === 'listing'), dv = brief('dveri').blocks.find(b => b.type === 'listing');
    check('листинг: listing true - filters добавлен, карточек писателя нет', ok.elements.some(e => e.kind === 'filters') && !ok.elements.some(e => e.kind === 'card'));
    check('листинг: listing false - filters не добавляется', !dv.elements.some(e => e.kind === 'filters'));
    // unknowns
    check('unknowns: gaps без технических строк, неподтвержденный факт, строка пробелов decisions', H.unknowns.includes('открытый вопрос анализа (g1): цены по типам изделий') && H.unknowns.includes('не подтверждено: старая цена') && H.unknowns.includes('срок ответа на заявку') && !H.unknowns.some(u => /регулярк/.test(u)) && H.unknowns.filter(u => /\(g1\)/.test(u)).length === 1, JSON.stringify(H.unknowns));
    // пожелания
    check('пожелание блоку, которого нет на странице (назначено странице) - предупреждение', /home: пожелание «Пожелание блоку, которого нет» адресовано блоку gallery/.test(WR), WR);
    // отчет
    const rep = rj(AW('briefs-report.json'));
    check('briefs-report: страницы, questions {text, pages, blocks}, warnings', Object.keys(rep.pages).length === 8 && rep.questions.every(q => q.text && Array.isArray(q.pages) && Array.isArray(q.blocks)) && rep.warnings.some(w => /F09/.test(w)));
    // срезы
    const sl = (slug, id) => rj(AW('pages', slug, 'brief', `${id}.json`));
    const text = fs.readFileSync(AW('pages', 'home', 'brief.json'), 'utf8');
    for (const b of H.blocks) checkSchema(`срез home/${b.block_id}`, 'brief-slice', sl('home', b.block_id));
    check('срез: _brief_sha1 = sha среза (версия формата + текст брифа)', sl('home', 'B01-hero')._brief_sha1 === briefSha(text) && briefSha(text) !== crypto.createHash('sha1').update(text).digest('hex'));
    check('срез: все факты страницы с owner_block, rule, note', sl('home', 'B02-benefits').facts.length === H.facts.length && sl('home', 'B02-benefits').facts.find(f => f.id === 'F04').owner_block === 'B01-hero' && !!sl('home', 'B02-benefits').facts.find(f => f.id === 'F08').rule && !!sl('home', 'B02-benefits').facts.find(f => f.id === 'F01').note);
    check('срез: unknowns в каждом срезе', H.blocks.every(b => (sl('home', b.block_id).unknowns || []).length === H.unknowns.length));
    check('срез: заметки агрегатора не передаются, custom_name передается', H.blocks.every(b => !('notes' in sl('home', b.block_id).block)) && sl('home', 'B03-calc').block.custom_name === 'калькулятор стоимости');
    check('срез: оговорка - только блоку оговорок', sl('home', 'B05-not-promise').disclaimer_text === 'Итог считается по замеру' && H.blocks.filter(b => b.type !== 'not-promise').every(b => !('disclaimer_text' in sl('home', b.block_id))));
    const prefText = (slug, id) => (sl(slug, id).client_preferences || []).map(p => p.text);
    check('срез: тон и пожелание без адреса - во все срезы, shell - ни в один', H.blocks.every(b => prefText('home', b.block_id).includes('Тон спокойный и деловой') && prefText('home', b.block_id).includes('Без адреса') && !prefText('home', b.block_id).includes('Телефон в шапке')));
    check('срез: пожелание с адресом faq - только в срез faq; candidate - первому экрану', prefText('home', 'B04-faq').includes('Сказать про свой цех') && !prefText('home', 'B02-benefits').includes('Сказать про свой цех') && !prefText('home', 'B01-hero').includes('Сказать про свой цех') && prefText('home', 'B01-hero').includes('Обещание первого экрана') && !prefText('home', 'B02-benefits').includes('Обещание первого экрана'));
    check('prefsForBlock: where списком через запятую', prefsForBlock([{ text: 'x', status: 'basis', where: 'faq, cta' }], { type: 'cta', block_id: 'B06-cta', role: 'conversion' }).length === 1);
  }
  // сегмент all
  {
    const S = mkProject('seg-all');
    const d = fixCta(base());
    d.strategy.pages.home.segment = 'all';
    d.sitemap.pages[0].segment = 'all';
    d.sitemap.pages[0].segments = ['S1', 'S2'];
    d.strategy.pages.home.objection_ids = ['O1', 'O3'];
    writeProject(S, d);
    const r = run(S, ['scripts/build-briefs.mjs', 'home']);
    const hb2 = rj(path.join(S, 'work', 'pages', 'home', 'brief.json'));
    check('all: код 0, бриф проходит схему', r.code === 0 && !schemaErrors('brief', hb2).length, r.out);
    const seg = hb2.segment;
    check('all: сегмент той же формы (id all, имя-константа, portrait, pains, fears, segments)', seg.id === 'all' && seg.name === SEGMENT_ALL_NAME && /Семья: хотят успеть до зимы; Дачник: нужно к сезону/.test(seg.portrait) && seg.pains.join() === 'дует,холодно' && Array.isArray(seg.fears) && seg.segments.map(s => s.id).join() === 'S1,S2', JSON.stringify(seg));
    check('all: возражения - назначенные стратегом', seg.objections.map(o => o.id).join() === 'O1,O3');
    check('all: угол факта - из argument_bank любого сегмента страницы', hb2.facts.find(f => f.id === 'F04').angle === 'угол для дачи');
    check('all: слова клиента - объединение сегментов', hb2.client_phrases.map(p => p.phrase).sort().join() === ['без переплат', 'к сезону', 'чтобы не дуло'].sort().join());
    const s1 = rj(path.join(S, 'work', 'pages', 'home', 'brief', 'B01-hero.json'));
    check('all: срез несет segments и проходит схему', s1.segment.segments?.length === 2 && !schemaErrors('brief-slice', s1).length);
    // нет segments в карте - все сегменты audience
    delete d.sitemap.pages[0].segments;
    writeProject(S, d);
    run(S, ['scripts/build-briefs.mjs', 'home']);
    check('all: без segments в карте - все сегменты audience', rj(path.join(S, 'work', 'pages', 'home', 'brief.json')).segment.segments.length === 2);
  }

  // ================================================================== 4. смена данных (5.19) и перенумерация
  {
    const hFile = AW('pages', 'home', 'brief.json');
    const m0 = fs.statSync(hFile).mtimeMs;
    const again = run(A, ['scripts/build-briefs.mjs']);
    check('5.19: повторная сборка без изменений - брифы не переписаны (mtime), «без изменений: 8»', again.code === 0 && /брифов собрано: 0, без изменений: 8, структура изменилась: 0/.test(again.out) && fs.statSync(hFile).mtimeMs === m0, again.out);
    // написанные блоки главной и их отчеты линтера
    const HB = rj(hFile);
    const mkBlock = (id, type, text) => ({ block_id: id, type, role: 'conversion', elements: [{ kind: 'h2', text }], facts_used: [], objections_closed: [], summary: `блок ${type} для теста`, handoff_note: '' });
    for (const b of HB.blocks) {
      wj(AW('pages', 'home', 'blocks', `${b.block_id}.json`), mkBlock(b.block_id, b.type, `Заголовок ${b.type}`));
      wj(AW('audit', 'home', `lint-${b.block_id}.json`), { scope: `home/${b.block_id}`, producer: 'lint', verdict: 'pass', summary: 'blocker 0, major 0, minor 1', findings: [{ id: 'lint-001', block_id: b.block_id, severity: 'minor', category: 'style', rule: 'ai.filler', problem: 'x' }] });
    }
    wj(AW('pages', 'home', 'blocks', 'B01-hero.variants.a.json'), { block_id: 'B01-hero' });
    // смена факта при том же составе: бриф переписан, страница в списке «перелинтовать», lint-page не запускается
    const d = fixCta(base());
    d.facts.facts.find(f => f.id === 'F05').wording = 'Свой цех в городе, 2 участка';
    writeProject(A, d);
    const ch = run(A, ['scripts/build-briefs.mjs']);
    check('5.19: факт изменился - бриф переписан, «перелинтовать: home», lint-page.json не создан', ch.code === 0 && /перелинтовать \(бриф изменился, блоки уже написаны\): home\b/.test(ch.out) && rj(hFile).facts.find(f => f.id === 'F05').wording === 'Свой цех в городе, 2 участка' && !fs.existsSync(AW('audit', 'home', 'lint-page.json')), ch.out);
    check('5.19: в «перелинтовать» только страницы с написанными блоками', !/перелинтовать[^\n]*uslugi/.test(ch.out));
    // смена состава у страницы без блоков - бриф переписан без --force
    d.strategy.pages.uslugi.exclude_blocks = ['related'];
    writeProject(A, d);
    const nb = run(A, ['scripts/build-briefs.mjs', 'uslugi']);
    check('5.19: состав изменился, блоков нет - бриф пересобран без --force', nb.code === 0 && /uslugi: состав блоков изменился \(блоков еще нет\) - бриф пересобран: -B03-related/.test(nb.out) && !rj(AW('pages', 'uslugi', 'brief.json')).blocks.some(b => b.type === 'related'), nb.out);
    // смена состава у страницы с блоками: без --force бриф не тронут, структура в отчете, код 0
    d.strategy.pages.home.exclude_blocks = ['process', 'calc'];
    writeProject(A, d);
    const before = fs.readFileSync(hFile, 'utf8');
    const sc = run(A, ['scripts/build-briefs.mjs']);
    const rep = rj(AW('briefs-report.json'));
    check('5.19: состав изменился, блоки есть - бриф не тронут, код 0, structure_changed', sc.code === 0 && fs.readFileSync(hFile, 'utf8') === before && /структура изменилась: 1/.test(sc.out) && rep.pages.home.structure_changed === true && rep.pages.home.excluded.join() === 'process,reviews', sc.out);
    check('5.19: отчет сливается - записи других страниц на месте', Object.keys(rep.pages).length === 8);
    // --force: запись, перенумерация файлов блоков и их lint-файлов
    const fo = run(A, ['scripts/build-briefs.mjs', '--force', 'home']);
    const nh = rj(hFile);
    const faqId = nh.blocks.find(b => b.type === 'faq').block_id;
    check('--force: бриф переписан без calc, перенумерация', fo.code === 0 && !nh.blocks.some(b => b.type === 'calc') && faqId === 'B03-faq' && /перенумерация блоков: переименовано: 3, убрано в _old: 1/.test(fo.out), fo.out);
    check('--force: файл блока переименован, block_id в нем новый', fs.existsSync(AW('pages', 'home', 'blocks', 'B03-faq.json')) && rj(AW('pages', 'home', 'blocks', 'B03-faq.json')).block_id === 'B03-faq' && !fs.existsSync(AW('pages', 'home', 'blocks', 'B04-faq.json')));
    const lf = AW('audit', 'home', 'lint-B03-faq.json');
    check('--force: lint-файл перенесен под новый id, scope и block_id находок обновлены', fs.existsSync(lf) && rj(lf).scope === 'home/B03-faq' && rj(lf).findings[0].block_id === 'B03-faq' && rj(lf).verdict === 'pass' && !fs.existsSync(AW('audit', 'home', 'lint-B06-cta.json')));
    check('--force: блок, которого нет в брифе, - в _old, его lint-файл удален', fs.existsSync(AW('pages', 'home', '_old', 'B03-calc.json')) && !fs.existsSync(AW('audit', 'home', 'lint-B03-calc.json')));
    check('--force: вариант турнира не тронут', fs.existsSync(AW('pages', 'home', 'blocks', 'B01-hero.variants.a.json')));
    const pr = run(A, ['scripts/plan-run.mjs', '--slugs', 'home']);
    let plan = null; try { plan = JSON.parse(pr.stdout); } catch {}
    check('--force: перенумерованные блоки не считаются ненаписанными (plan-run write: страница дописана)', !!plan && !plan.pages.some(p => p.slug === 'home'), pr.out.slice(0, 300));
    check('--force: запись в отчете без structure_changed', rj(AW('briefs-report.json')).pages.home.structure_changed === false);
    // страница пропала из карты - запись из отчета удалена
    d.sitemap.pages.find(p => p.slug === 'dveri').status = 'skip';
    writeProject(A, d);
    run(A, ['scripts/build-briefs.mjs', 'okna']);
    check('briefs-report: страница снята с карты - запись удалена, остальные на месте', !rj(AW('briefs-report.json')).pages.dveri && !!rj(AW('briefs-report.json')).pages.home);
    // срез старого формата (sha без версии) пересобирается
    const sf = AW('pages', 'okna', 'brief', 'B01-hero.json');
    const s = rj(sf); s._brief_sha1 = crypto.createHash('sha1').update(fs.readFileSync(AW('pages', 'okna', 'brief.json'), 'utf8')).digest('hex'); wj(sf, s);
    const pr2 = run(A, ['scripts/plan-run.mjs', '--slugs', 'okna']);
    check('срез старого формата - plan-run пересобирает (slices: rebuilt)', /"slices": "rebuilt"/.test(pr2.stdout), pr2.out.slice(0, 300));
  }

  // ================================================================== 5. лендинг: одна страница, один блок
  {
    const Lp = mkProject('landing');
    const d = fixCta(base());
    d.sitemap.pages = [page('home', '/', 'home', 0, '')];
    d.strategy.pages = { home: entry(['F01', 'F04'], { hero_facts: ['F01'] }) };
    d.types = { home: ptype('home', [B.hero, blk('about', 'info', 'text', [el('h2', '1', 60), el('text', '1', 300), el('link', '1-2', 40)])]) };
    writeProject(Lp, d);
    const r = run(Lp, ['scripts/build-briefs.mjs']);
    const lb = rj(path.join(Lp, 'work', 'pages', 'home', 'brief.json'));
    check('лендинг: ссылок нет - link необязателен (count 0-2)', r.code === 0 && lb.links.length === 0 && lb.blocks[1].elements.find(e => e.kind === 'link').count === '0-2', r.out);
    d.types.home = ptype('home', [B.hero]);
    writeProject(Lp, d);
    const r2 = run(Lp, ['scripts/build-briefs.mjs']);
    const lb2 = rj(path.join(Lp, 'work', 'pages', 'home', 'brief.json'));
    check('лендинг: страница из одного первого экрана - оговорки нет, предупреждение', r2.code === 0 && !lb2.disclaimer_text && !lb2.blocks[0].disclaimer_text && /оговорка не поставлена ни на одну собранную страницу: блока not-promise нет/.test(rj(path.join(Lp, 'work', 'briefs-report.json')).warnings.join(' ')), r2.out);
  }

  // ================================================================== 3a. проблемы build-briefs
  {
    const Pp = mkProject('problems');
    const d = fixCta(base());
    d.strategy.pages.home.exclude_blocks = ['hero', 'nope'];
    d.strategy.pages.home.block_overrides.faq = { objection_ids: ['O9'] };
    writeProject(Pp, d);
    const r = run(Pp, ['scripts/build-briefs.mjs', 'home']);
    check('проблемы: exclude hero и неизвестный id, неизвестное возражение в override - код 1', r.code === 1 && /exclude_blocks: первый экран \(hero\) исключать нельзя/.test(r.out) && /exclude_blocks: блока nope нет в типе home/.test(r.out) && /block_overrides\.faq\.objection_ids: возражения O9 нет/.test(r.out), r.out);
    check('проблемы печатаются первыми, целиком', /^проблемы \(3\):/.test(r.out), r.out.slice(0, 200));
    const hb3 = rj(path.join(Pp, 'work', 'pages', 'home', 'brief.json'));
    check('проблемы: первый экран остался, явный пустой список возражений faq после чистки - окончательный', hb3.blocks[0].type === 'hero' && hb3.blocks.find(b => b.type === 'faq').objection_ids.length === 0);
    // возражение, назначенное исключенному блоку, уходит в оставшийся слот
    const Q = mkProject('obj-exclude');
    const d2 = fixCta(base());
    d2.strategy.pages.home.exclude_blocks = ['process', 'faq'];
    writeProject(Q, d2);
    run(Q, ['scripts/build-briefs.mjs', 'home']);
    const hq = rj(path.join(Q, 'work', 'pages', 'home', 'brief.json'));
    check('возражения при exclude: objection_to_block на исключенный блок - O1 и O2 в оставшемся слоте', hq.blocks.find(b => b.type === 'benefits').objection_ids.join() === 'O1,O2', JSON.stringify(hq.blocks.map(b => [b.type, b.objection_ids])));
    // reviews с пустым facts, но с id в task - остается; только publish no - выпадает
    const R2 = mkProject('drop');
    const d3 = fixCta(base());
    d3.strategy.pages.home.block_overrides.reviews = { facts: [], task: 'Назови F05' };
    writeProject(R2, d3);
    run(R2, ['scripts/build-briefs.mjs', 'home']);
    check('drop: пустой facts и id в task - блок остается с фактом из task', rj(path.join(R2, 'work', 'pages', 'home', 'brief.json')).blocks.find(b => b.type === 'reviews')?.facts.join() === 'F05');
    d3.strategy.pages.home.block_overrides.reviews = { facts: ['F06'] };
    writeProject(R2, d3);
    run(R2, ['scripts/build-briefs.mjs', 'home']);
    check('drop: явные факты только publish no - блок выпадает', !rj(path.join(R2, 'work', 'pages', 'home', 'brief.json')).blocks.some(b => b.type === 'reviews'));
    // cases:number: числа взял первый экран (hero_facts), свежих фактов других видов хватает - блок кейсов не выпадает,
    // один числовой факт возвращается в блок (правило вида - по кандидатам до дедупликации)
    const Cs = mkProject('cases-number');
    const d4 = fixCta(base());
    const cases = blk('cases', 'conversion', 'grid-3', [el('h2', '1', 80), el('card', '2-3', 300)], { fact_kinds: ['number', 'claim', 'legal'] });
    d4.types.home = ptype('home', [B.hero, cases, B.cta]);
    d4.strategy.pages.home = entry(['F01', 'F08', 'F05', 'F07', 'F04'], { hero_facts: ['F01', 'F08'] });
    writeProject(Cs, d4);
    const rc = run(Cs, ['scripts/build-briefs.mjs', 'home']);
    const hc = rj(path.join(Cs, 'work', 'pages', 'home', 'brief.json'));
    const cb = hc.blocks.find(b => b.type === 'cases');
    const repC = rj(path.join(Cs, 'work', 'briefs-report.json'));
    check('cases:number: числа у первого экрана - блок кейсов остается, в нем есть числовой факт', rc.code === 0 && !!cb && cb.facts.some(x => ['F01', 'F08'].includes(x)) && cb.facts.includes('F05') && !/выпали блоки cases/.test(rc.out), rc.out + JSON.stringify(cb));
    check('cases:number: нет ложного вопроса «Нужны факты для блока»', !repC.pages.home.dropped.length && !repC.questions.some(q => /Блок cases/.test(q.text)), JSON.stringify(repC.questions));
    d4.strategy.pages.home.block_overrides = { cases: { facts: ['F05', 'F07'] } };
    writeProject(Cs, d4);
    run(Cs, ['scripts/build-briefs.mjs', 'home']);
    check('cases:number: явный непустой список без чисел - блок остается (W1-11)', rj(path.join(Cs, 'work', 'pages', 'home', 'brief.json')).blocks.find(b => b.type === 'cases')?.facts.join() === 'F05,F07');
    d4.strategy.pages.home = entry(['F05', 'F07'], { hero_facts: ['F05'] });
    writeProject(Cs, d4);
    run(Cs, ['scripts/build-briefs.mjs', 'home']);
    check('cases:number: чисел на странице нет - блок выпадает, как раньше', !rj(path.join(Cs, 'work', 'pages', 'home', 'brief.json')).blocks.some(b => b.type === 'cases'));
    // возражение, назначенное только исключенному блоку, не теряется: авто-раскладка, иначе objections_unassigned
    const Qx = mkProject('obj-excluded-override');
    const d5 = fixCta(base());
    d5.strategy.pages.home.objection_ids = ['O1'];
    d5.strategy.pages.home.exclude_blocks = ['process', 'faq'];
    d5.strategy.pages.home.block_overrides = { faq: { objection_ids: ['O2'] } };
    writeProject(Qx, d5);
    run(Qx, ['scripts/build-briefs.mjs', 'home']);
    const hx = rj(path.join(Qx, 'work', 'pages', 'home', 'brief.json'));
    check('возражение исключенного блока (override faq.objection_ids) - в оставшемся слоте и в segment.objections', hx.blocks.find(b => b.type === 'benefits').objection_ids.includes('O2') && hx.segment.objections.some(o => o.id === 'O2'), JSON.stringify(hx.blocks.map(b => [b.type, b.objection_ids])));
    d5.strategy.pages.home.exclude_blocks = ['process', 'faq', 'benefits'];
    writeProject(Qx, d5);
    run(Qx, ['scripts/build-briefs.mjs', 'home']);
    const rx = rj(path.join(Qx, 'work', 'briefs-report.json'));
    check('возражение исключенного блока без свободного слота - objections_unassigned и предупреждение', rx.pages.home.objections_unassigned.includes('O2') && /home: возражения без блока \(нет слота\): [^|]*O2/.test(rx.warnings.join(' | ')), JSON.stringify(rx.pages.home));
    // пустой parent не делает страницы соседями: страница без родителя уровня 3 не попадает в ссылки главной
    const Lk = mkProject('links-empty-parent');
    const d6 = fixCta(base());
    d6.sitemap.pages.push(page('sirota', '/sirota', 'info_other', 3, ''));
    d6.strategy.pages.sirota = entry([]);
    writeProject(Lk, d6);
    run(Lk, ['scripts/build-briefs.mjs', 'home', 'sirota']);
    const lh = rj(path.join(Lk, 'work', 'pages', 'home', 'brief.json')).links.map(l => l.url);
    check('i: пустой parent у главной и у страницы уровня 3 - соседства нет, страницы нет в ссылках главной', lh.length > 0 && !lh.includes('/sirota'), lh.join(' '));
    // n1/n11 и n4: факт из hero_facts закрыт «Где можно» - его нет ни в первом экране, ни в brief.facts, линтер блока
    // без fact.unknown; qa после снижения count до 2 - линтер на двух вопросах без structure.count
    const Hw = mkProject('hero-where');
    const d7 = fixCta(base());
    d7.strategy.pages.remont.hero_facts = ['F07', 'F02'];
    writeProject(Hw, d7);
    run(Hw, ['scripts/build-briefs.mjs', 'home', 'remont']);
    const rb = rj(path.join(Hw, 'work', 'pages', 'remont', 'brief.json'));
    const rh = rb.blocks[0];
    const repH = rj(path.join(Hw, 'work', 'briefs-report.json'));
    check('hero_facts закрыт «Где можно» (F07 на remont) - нет в первом экране и в brief.facts, facts_dropped из hero_facts', rh.facts.join() === 'F02' && !rb.facts.some(x => x.id === 'F07') && repH.pages.remont.facts_dropped.some(x => x.id === 'F07' && x.reason === 'where' && x.from.includes('hero_facts')), JSON.stringify(rh.facts));
    const wbl = (slug, b, els) => wj(path.join(Hw, 'work', 'pages', slug, 'blocks', `${b.block_id}.json`), { block_id: b.block_id, type: b.type, role: b.role, elements: els, facts_used: [], objections_closed: [], summary: 'синтетический блок теста', handoff_note: '' });
    const lintH = (slug, id) => { run(Hw, ['scripts/lint.mjs', `work/pages/${slug}/blocks/${id}.json`]); return rj(path.join(Hw, 'work', 'audit', slug, `lint-${id}.json`)).findings.map(x => x.rule); };
    wbl('remont', rh, [{ kind: 'h1', text: 'Ремонт окон с замером на следующий день', facts: rh.facts }, { kind: 'button', text: rb.cta.main }]);
    const lr = lintH('remont', rh.block_id);
    check('hero_facts закрыт «Где можно» - линтер первого экрана с фактами блока без fact.unknown', !lr.includes('fact.unknown'), lr.join());
    const hb7 = rj(path.join(Hw, 'work', 'pages', 'home', 'brief.json'));
    const fq = hb7.blocks.find(b => b.type === 'faq');
    const qa = (q, a) => ({ kind: 'qa', q, a, facts: ['F04'] });
    wbl('home', fq, [{ kind: 'h2', text: 'Частые вопросы', facts: [] }, qa('Что с гарантией?', 'Гарантия 12 месяцев на изделие.'), qa('Что если сломается?', 'Гарантия 12 месяцев, ремонт по гарантии.')]);
    const lq = lintH('home', fq.block_id);
    check('n4: qa 2-6 после снижения count - два вопроса без structure.count', fq.elements.find(e => e.kind === 'qa').count === '2-6' && !lq.includes('structure.count'), lq.join());
  }

  // ================================================================== 6. merge-strategy
  {
    const M = mkProject('merge');
    const MW = (...p) => path.join(M, 'work', ...p);
    const d = fixCta(base());
    writeProject(M, d);
    wj(MW('strategy.pages', 'service.json'), { type: 'service', pages: {
      remont: entry(['F02', 'F09'], { hero_facts: ['F02'] }),
      montazh: entry(['F02', 'F06', 'F07', 'F99'], {
        hero_facts: ['F02', 'F05'], segment: 'S9', objection_ids: ['O9'], exclude_blocks: ['hero', 'ghost'],
        block_overrides: { faq: { facts: ['F10'], task: 'Старую цену F06 не называй', objection_ids: ['O8'] }, ghost: { task: 'x' } },
        cta: { main: 'Вызвать мастера', action: 'anchor:faq', secondary_action: 'page:ghost' },
      }),
    }, disputes: [{ question: 'Какой сегмент у монтажа', decision: 'S1', why: 'по карте' }] });
    const ck = run(M, ['scripts/merge-strategy.mjs', '--check', 'work/strategy.pages/service.json']);
    const has = re => re.test(ck.out);
    check('--check: код 1, FAIL', ck.code === 1 && /^FAIL /m.test(ck.out), ck.out);
    check('--check: факт не публикуется / нет в facts.json', has(/pages\.montazh: facts: факт F06 не публикуется/) && has(/pages\.montazh: facts: факта F99 нет в facts\.json/), ck.out);
    check('--check: факт закрыт «Где можно» decisions.md', has(/pages\.montazh: facts: факт F07 закрыт для этой страницы/) && has(/block_overrides\.faq\.facts: факт F10 закрыт/), ck.out);
    check('--check: hero_facts вне facts', has(/hero_facts: F05 нет в facts страницы/), ck.out);
    check('--check: ключи block_overrides и exclude_blocks - блоки типа, первый экран не исключается', has(/block_overrides\.ghost: блока нет в типе service/) && has(/exclude_blocks: первый экран \(hero\) исключать нельзя/) && has(/exclude_blocks: блока ghost нет в типе service/), ck.out);
    check('--check: сегмент и возражения по audience', has(/segment S9 нет в audience\.json/) && has(/objection_ids: возражения O9 нет/) && has(/block_overrides\.faq\.objection_ids: возражения O8 нет/), ck.out);
    check('--check: id после отрицания в task', has(/block_overrides\.faq\.task: id после отрицания \(F06\)/), ck.out);
    check('--check: action по контракту C3 (page: - рабочая страница карты)', has(/cta\.secondary_action: страницы ghost нет среди рабочих страниц карты/) && !has(/cta\.action: блока faq/), ck.out);
    check('--check: запись remont без проблем', !has(/pages\.remont:/), ck.out);
    // предупреждение: пустой facts у блока из drop-списка
    wj(MW('strategy.pages', 'home.json'), { type: 'home', pages: { home: d.strategy.pages.home } });
    const ck2 = run(M, ['scripts/merge-strategy.mjs', '--check', 'work/strategy.pages/home.json']);
    check('--check: пустой facts у блока из drop_blocks_without_facts - предупреждение, не проблема', /~ предупреждение: [^\n]*block_overrides\.reviews: пустой facts - блок снимается со страницы \(как exclude_blocks\)/.test(ck2.out) && !/^ - [^\n]*reviews: пустой facts/m.test(ck2.out), ck2.out);
    const cleanHome = clone(d.strategy.pages.home); delete cleanHome.block_overrides; cleanHome.facts = cleanHome.facts.filter(f => !['F06', 'F10'].includes(f));
    wj(MW('strategy.pages', 'home.json'), { type: 'home', pages: { home: cleanHome } });
    const ck3 = run(M, ['scripts/merge-strategy.mjs', '--check', 'work/strategy.pages/home.json']);
    check('--check: чистая запись - OK, код 0', ck3.code === 0 && /^OK work\/strategy\.pages\/home\.json: тип home, страниц 1/m.test(ck3.out), ck3.out);
    // сборка: содержание - предупреждения, запись не отклоняется; споры посчитаны
    const mg = run(M, ['scripts/merge-strategy.mjs']);
    const st = rj(MW('strategy.json'));
    check('сборка: содержательные находки - предупреждения, запись montazh собрана, споры посчитаны', mg.code === 0 && st.pages.montazh.segment === 'S9' && /предупреждения по содержанию/.test(mg.out) && /споров стратегов 1/.test(mg.out), mg.out);
    wj(MW('strategy.pages', 'service.json'), { type: 'service', pages: { remont: entry(['F02']) }, disputes: [{ question: 'x' }] });
    const bd = run(M, ['scripts/merge-strategy.mjs', '--check', 'work/strategy.pages/service.json']);
    check('--check: спор без decision и why - проблема схемы', bd.code === 1 && /disputes\[0\]: нет обязательного поля "decision"/.test(bd.out), bd.out);
    // --matrix
    const d4 = fixCta(base());
    d4.strategy.pages.remont = entry(['F02', 'F05', 'F09'], { hero_facts: ['F02', 'F05', 'F09'], hook: 'Ремонт окон за один день без грязи', unique_argument: 'Свой цех и выезд мастера по городу в день заявки' });
    d4.strategy.pages.montazh = entry(['F02', 'F05', 'F09'], { hero_facts: ['F02', 'F05'], hook: 'Монтаж окон за один день без грязи', unique_argument: 'Свой цех и выезд мастера по городу на замер' });
    d4.strategy.pages.uslugi = entry(['F05'], { hero_facts: ['F05'], hook: 'Все услуги мастерской в одном месте', unique_argument: 'Каталог услуг с понятной ценой и сроками' });
    writeProject(M, d4);
    fs.rmSync(MW('strategy.pages'), { recursive: true, force: true });
    const mx = run(M, ['scripts/merge-strategy.mjs', '--matrix']);
    check('--matrix: код 0, таблица и файл', mx.code === 0 && /^\| slug \| type \| parent \| segment \| hook \| unique_argument \| hero_facts \|$/m.test(mx.out) && /^\| remont \| service \| \/uslugi \| S1 \|/m.test(mx.out) && fs.existsSync(MW('audit', 'strategy-matrix.md')), mx.out.slice(0, 600));
    check('--matrix: hero_facts с wording', /F02 Замер на следующий день после заявки/.test(mx.out));
    check('--matrix: близнецы одного типа с общим сегментом (hero_facts, hook)', /remont ~ montazh \(тип service, общий сегмент\): общие hero_facts F02, F05; похожий hook/.test(mx.out), mx.out);
    check('--matrix: частота фактов', /F05: hero 3, facts \d+/.test(mx.out), mx.out);
  }

  // ================================================================== 7. линтер
  {
    const brief = { facts: [
      { id: 'F03', wording: 'Стандартно 3 недели, срочное изготовление обсуждается отдельно', value: 'стандартно 3 недели', kind: 'number' },
      { id: 'F04', wording: 'В среднем на 20-25% ниже ритейла', value: 'в среднем на 20-25% ниже', kind: 'number' },
      { id: 'F27', wording: 'Толщина обручального кольца от 1,3 мм', value: 'от 1,3 мм', kind: 'number' },
      { id: 'F43', wording: 'Пн-сб 10:00-20:00', value: 'до 20:00', kind: 'contact' },
      { id: 'F50', wording: 'Доставка от 2 до 5 дней', value: 'от 2 до 5 дней', kind: 'process' },
      { id: 'F51', wording: 'Доставка до двери за 3 дня', value: 'за 3 дня', kind: 'process' },
      { id: 'F52', wording: 'Опыт не менее 5 лет', value: 'не менее 5 лет', kind: 'number' },
      { id: 'F53', wording: 'Обычно около 10 дней', value: 'около 10 дней', kind: 'number' },
      { id: 'F54', wording: 'Готовность 3 недели', value: '3 недели', kind: 'number' },
      { id: 'F55', wording: 'Доходность до 14% годовых', value: 'до 14% годовых', kind: 'number' },
    ] };
    const R = compileLint(RULES, brief, {});
    const T = (kind, text, f) => ({ kind, text, facts: f });
    const hl = e => hedgeLostFindings(e, 0, R).length;
    const HEDGE = [
      ['Сделаем за 3 недели.', ['F03'], 1],
      ['Пара за 3 недели', ['F03'], 1, 'h2'],
      ['На 20-25% ниже ритейла.', ['F04'], 1],
      ['Толщина 1,3 мм.', ['F27'], 1],
      ['Стандартно 3 недели. Сделаем за 3 недели.', ['F03'], 0],
      ['Стандартный срок изготовления - 3 недели.', ['F03'], 0],
      ['Обычный заказ - 3 недели.', ['F03'], 0],
      ['Как правило, 3 недели.', ['F03'], 0],
      ['После согласования 3D-модели - 3 недели стандартно.', ['F03'], 0],
      ['Согласуете 3D-модель до работы с металлом.', ['F03'], 0],
      ['Быстрее 3 недель - только по договоренности.', ['F03'], 0],
      ['Срок меньше 3 недель - по отдельной договоренности.', ['F03'], 0],
      ['Кольцо тоньше 1,3 мм не советуем.', ['F27'], 0],
      ['Толщина не меньше 1,3 мм.', ['F27'], 0],
      ['Работаем 10:00-20:00.', ['F43'], 0],
      ['Доставим за 2-5 дней.', ['F50'], 0],
      ['Доставим за 3 дня.', ['F51'], 0],
      ['Опыт минимум 5 лет.', ['F52'], 0],
      ['Опыт 5 лет.', ['F52'], 1],
      ['Обычно примерно 10 дней.', ['F53'], 0],
      ['Примерно 10 дней.', ['F53'], 1],
      ['10 дней на все.', ['F53'], 1],
      ['Стандартно 3 недели, 3 недели на готовность.', ['F03', 'F54'], 0],
      ['Готовность за 3 недели.', ['F03', 'F54'], 0],
    ];
    for (const [text, f, want, kind] of HEDGE) check(`hedge-lost: «${text}» (${f.join(',')}) -> ${want ? 'находка' : 'без находки'}`, (hl(T(kind || 'text', text, f)) > 0) === !!want, JSON.stringify(hedgeLostFindings(T(kind || 'text', text, f), 0, R)));
    // программа 28.09: плашки, цифры и строки прайса проверяются (оговорка ищется во всем элементе)
    check('hedge-lost: table_row, number, badges без оговорки - находка', hl({ kind: 'table_row', items: ['Срок', '3 недели'], facts: ['F03'] }) === 1 && hl({ kind: 'number', value: '3 недели', label: 'срок', facts: ['F03'] }) === 1 && hl({ kind: 'badges', items: ['Готово за 3 недели'], facts: ['F03'] }) === 1);
    check('hedge-lost: оговорка в подписи number, в соседней ячейке table_row, в пункте badges - без находки', !hl({ kind: 'table_row', items: ['Стандартный срок', '3 недели'], facts: ['F03'] }) && !hl({ kind: 'number', value: '3 недели', label: 'стандартный срок', facts: ['F03'] }) && !hl({ kind: 'number', value: '20-25%', label: 'в среднем ниже ритейла', facts: ['F04'] }) && !hl({ kind: 'badges', items: ['Стандартно', '3 недели'], facts: ['F03'] }));
    check('hedge-lost: диапазон «20-25» без «в среднем» - одна находка на потерю условия, не две', hl({ kind: 'number', value: '20-25%', label: 'ниже ритейла', facts: ['F04'] }) === 1 && hl({ kind: 'text', text: 'На 20-25% ниже ритейла.', facts: ['F04'] }) === 1);
    check('hedge-lost: «от 1000 руб.» в строке прайса без «от» - находка', hedgeLostFindings({ kind: 'table_row', items: ['Изменение размера', '1000 руб.'], facts: ['F90'] }, 0, compileLint(RULES, { facts: [{ id: 'F90', wording: 'Изменение размера от 1000 руб.', value: 'от 1000 руб.', kind: 'number' }] }, {})).length === 1);
    check('hedge-lost: оговорка в соседнем поле карточки - без находки', !hl({ kind: 'card', title: 'Стандартный срок', text: '3 недели на изделие.', facts: ['F03'] }));
    check('hedge-lost: major, category fact', hedgeLostFindings(T('text', 'Сделаем за 3 недели.', ['F03']), 0, R)[0]?.severity === 'major');
    // embellish и группы оговорок
    const scan = e => scanBlock({ block_id: 'B01-t', elements: [e] }, R).findings.map(x => x.rule);
    check('embellish: «минимум 5 лет» при факте «не менее 5 лет» - не усиление', !scan(T('text', 'Опыт минимум 5 лет.', ['F52'])).includes('fact.embellish'));
    check('embellish: «гарантированный» по-прежнему ловится', scan(T('text', 'Гарантированный доход до 14% годовых.', ['F55'])).includes('fact.embellish'));
    // подсказки
    const Rc = compileLint(RULES, { facts: [] }, {});
    const claim = scanBlock({ block_id: 'B01-t', elements: [T('text', 'Гарантию дает завод.', [])] }, Rc).findings.find(f => f.rule === 'fact.claim-unsupported');
    check('claim-unsupported: подсказка без «вопроса к специалисту»', !!claim && /убрать утверждение; не заменять обещанием консультации, звонка, встречи/.test(claim.proposal) && !/специалист/.test(claim.proposal));
    const niche = rj(path.join(TPL, 'examples', 'lint-niche-markers.example.json'));
    check('нишевые маркеры вынесены из ядра lint.json', !RULES.claim_markers.some(m => niche.claim_markers.includes(m)) && ['квот', 'налог', 'рассыл', 'пошлин', 'аккредит'].every(m => niche.claim_markers.includes(m)));
    const Rn = compileLint({ ...RULES, claim_markers: [...RULES.claim_markers, ...niche.claim_markers] }, { facts: [] }, {});
    check('нишевые маркеры из примера работают, если проект их добавил', scanBlock({ block_id: 'B01-t', elements: [T('text', 'Налог платит продавец.', [])] }, Rn).findings.some(f => f.rule === 'fact.claim-unsupported') && !scanBlock({ block_id: 'B01-t', elements: [T('text', 'Налог платит продавец.', [])] }, Rc).findings.some(f => f.rule === 'fact.claim-unsupported'));
    check('lint.json: нет cta.weak в линтере (слабый глагол - в build-briefs)', !/cta\.weak/.test(fs.readFileSync(path.join(TPL, 'scripts', 'lint.mjs'), 'utf8')));

    // CLI на синтетической странице
    const Lq = mkProject('lint-cli');
    const pdir = path.join(Lq, 'work', 'pages', 'p');
    const lb = { slug: 'p', url: '/p', type: 'service', subject: 'Ремонт', company: 'Тест', geo: '', cta: { main: 'Получить расчет' }, links: [{ url: '/katalog', subject: 'Каталог' }], terminology: { use: [] },
      facts: [{ id: 'F01', label: 'срок', value: '3 недели', wording: 'Изделие готово за 3 недели', rule: 'Стандартный срок изготовления три недели после согласования модели' }],
      blocks: [
        { block_id: 'B01-hero', role: 'hero', cta_allowed: true, elements: [{ kind: 'h1', count: '1', chars: { min: 0, max: 70 } }, { kind: 'button', count: '1', chars: { min: 0, max: 30 } }] },
        { block_id: 'B02-a', role: 'conversion', cta_allowed: true, elements: [{ kind: 'h2', count: '1', chars: { min: 0, max: 80 } }, { kind: 'text', count: '1', chars: { min: 0, max: 100 } }, { kind: 'text', count: '0-1', chars: { min: 0, max: 200 } }, { kind: 'card', count: '0-2', chars: { min: 0, max: 170 } }, { kind: 'button', count: '0-1', chars: { min: 0, max: 30 } }] },
        { block_id: 'B03-b', role: 'conversion', cta_allowed: false, elements: [{ kind: 'h2', count: '1', chars: { min: 0, max: 80 } }, { kind: 'text', count: '1', chars: { min: 0, max: 300 } }] },
      ] };
    wj(path.join(pdir, 'brief.json'), lb);
    wj(path.join(Lq, 'work', 'sitemap.json'), { pages: [{ slug: 'p', url: '/p', type: 'service', status: 'briefed' }] });
    const wb = (id, els) => wj(path.join(pdir, 'blocks', `${id}.json`), { block_id: id, type: id.slice(4), role: id === 'B01-hero' ? 'hero' : 'conversion', elements: els, facts_used: [], objections_closed: [], summary: 'синтетический блок теста', handoff_note: '' });
    const lint = id => { const r = run(Lq, ['scripts/lint.mjs', `work/pages/p/blocks/${id}.json`]); return { ...r, rep: rj(path.join(Lq, 'work', 'audit', 'p', `lint-${id}.json`)) }; };
    const rules = r => r.rep.findings.map(f => f.rule);
    const RULE_TXT = 'Стандартный срок изготовления три недели после согласования модели';
    wb('B01-hero', [{ kind: 'h1', text: 'Ремонт украшений в мастерской', facts: [] }, { kind: 'button', text: 'Получить расчет' }]);
    wb('B02-a', [{ kind: 'h2', text: 'Сроки работы', facts: [] }, { kind: 'text', text: `${RULE_TXT}.`, facts: ['F01'] }, { kind: 'button', text: 'Смотреть каталог', href: '/katalog' }]);
    wb('B03-b', [{ kind: 'h2', text: 'Как идет заказ', facts: [] }, { kind: 'text', text: `${RULE_TXT}, затем выдача.`, facts: ['F01'] }]);
    const l3 = lint('B03-b');
    check('rule факта не повтор: формулировка rule в двух блоках - без phrase.repeat', !rules(l3).includes('phrase.repeat'), JSON.stringify(l3.rep.findings));
    const l2 = lint('B02-a');
    check('кнопка-переход на страницу из links - без cta.text', !rules(l2).includes('cta.text'), JSON.stringify(l2.rep.findings));
    wb('B02-a', [{ kind: 'h2', text: 'Сроки работы', facts: [] }, { kind: 'text', text: 'Срок считаем после согласования.', facts: [] }, { kind: 'button', text: 'Оставить заявку' }]);
    const l2b = lint('B02-a');
    check('кнопка без href с чужим текстом - cta.text; cta.weak больше нет', rules(l2b).includes('cta.text') && !rules(l2b).includes('cta.weak'), JSON.stringify(l2b.rep.findings));
    // лимиты: max брифа (170 у card) не режется второй раз до границы вида (150 = limits.card_max)
    const card = n => ({ kind: 'card', title: 'Карточка', text: 'а'.repeat(n), facts: [] });
    wb('B02-a', [{ kind: 'h2', text: 'Сроки работы', facts: [] }, { kind: 'text', text: 'Срок считаем после согласования.', facts: [] }, card(200)]);
    const lc1 = lint('B02-a');
    wb('B02-a', [{ kind: 'h2', text: 'Сроки работы', facts: [] }, { kind: 'text', text: 'Срок считаем после согласования.', facts: [] }, card(210)]);
    const lc2 = lint('B02-a');
    check('лимит: card 200 при max брифа 170 - без length.* (второго среза до 150 нет)', !rules(lc1).some(r => /^length\./.test(r)), JSON.stringify(lc1.rep.findings));
    check('лимит: card 210 при max брифа 170 - length.over', rules(lc2).includes('length.over'), JSON.stringify(lc2.rep.findings));
    wb('B02-a', [{ kind: 'h2', text: 'Сроки работы', facts: [] }, { kind: 'text', text: 'а'.repeat(220), facts: [] }]);
    check('лимит: два text в шаблоне (100 и 200) - берется наибольший', !rules(lint('B02-a')).some(r => /^length\.over/.test(r)));
    // число из запрета в rule не подтверждено: «18 лет» при rule «Не пересчитывать в «18 лет»» - fact.number-without-source
    lb.facts.push({ id: 'F02', label: 'год основания', value: 'с 2008 года', wording: 'Работаем с 2008 года', rule: 'Не пересчитывать в «18 лет»' });
    wj(path.join(pdir, 'brief.json'), lb);
    wb('B03-b', [{ kind: 'h2', text: 'Как идет заказ', facts: [] }, { kind: 'text', text: '18 лет на рынке ремонта.', facts: ['F02'] }]);
    const ln = lint('B03-b');
    check('число из запрета в rule - fact.number-without-source', ln.rep.findings.some(f => f.rule === 'fact.number-without-source' && /18/.test(f.problem)), JSON.stringify(ln.rep.findings));
    lb.facts[1].rule = 'Писать «с 2008 года» или «18 лет на рынке»';
    wj(path.join(pdir, 'brief.json'), lb);
    const ln2 = lint('B03-b');
    check('число из разрешенной формулировки rule - подтверждено', !ln2.rep.findings.some(f => f.rule === 'fact.number-without-source'), JSON.stringify(ln2.rep.findings));
    lb.facts.pop();
    wj(path.join(pdir, 'brief.json'), lb);
    // copy.address-all: новая подсказка
    wb('B03-b', [{ kind: 'h2', text: 'Как идет заказ', facts: [] }, { kind: 'text', text: 'Подходит для всех, кто ищет мастера.', facts: [] }]);
    const la = lint('B03-b');
    check('copy.address-all: подсказка «называть сценарии сегментов страницы»', la.rep.findings.some(f => f.rule === 'copy.address-all' && f.proposal === 'называть сценарии сегментов страницы'), JSON.stringify(la.rep.findings));
    // lint-page: page_sha = sha1 page.md (page.md пересобран перед отчетом)
    wb('B03-b', [{ kind: 'h2', text: 'Как идет заказ', facts: [] }, { kind: 'text', text: `${RULE_TXT}, затем выдача.`, facts: ['F01'] }]);
    const lp = run(Lq, ['scripts/lint-page.mjs', 'p']);
    const lpr = rj(path.join(Lq, 'work', 'audit', 'p', 'lint-page.json'));
    const md = path.join(pdir, 'page.md');
    check('lint-page: page_sha = sha1 текущего page.md', fs.existsSync(md) && lpr.page_sha === crypto.createHash('sha1').update(fs.readFileSync(md)).digest('hex'), lp.out);
    check('lint-page: rule факта не phrase.overuse/phrase.repeat', !lpr.findings.some(f => /^phrase\./.test(f.rule)), JSON.stringify(lpr.findings.filter(f => /^phrase/.test(f.rule))));
    checkSchema('lint-page.json с page_sha', 'findings', lpr);
    // page-state: блок с непрошедшим линтером не входит в facts_used
    wj(path.join(Lq, 'work', 'audit', 'p', 'lint-B03-b.json'), { verdict: 'fix', findings: [] });
    wj(path.join(Lq, 'work', 'audit', 'p', 'lint-B02-a.json'), { verdict: 'pass', findings: [] });
    wb('B02-a', [{ kind: 'h2', text: 'Сроки', facts: [] }, { kind: 'text', text: 'Срок три недели.', facts: ['F01'] }]);
    const ps = run(Lq, ['scripts/page-state.mjs', 'p']);
    const ws = rj(path.join(pdir, 'state.writer.json'));
    check('page-state: facts_used только из блоков с lint pass (B03 fix не в счете)', ps.code === 0 && JSON.stringify(ws.facts_used.F01) === '["B02-a"]' && ws.blocks_done === '3/3', ps.out + JSON.stringify(ws.facts_used));
  }

  // ================================================================== 8. renumber-blocks сам по себе: коды и page-state
  {
    const Rr = mkProject('renumber');
    check('renumber-blocks: без slug - код 2', run(Rr, ['scripts/renumber-blocks.mjs']).code === 2);
    // две копии одного типа: файл с целевым именем остается, старая копия - в _old, ее lint-файл удаляется
    const RW = (...p) => path.join(Rr, 'work', ...p);
    wj(RW('sitemap.json'), { pages: [{ slug: 'p', url: '/p', type: 'service', status: 'briefed' }] });
    wj(RW('pages', 'p', 'brief.json'), { slug: 'p', blocks: [
      { block_id: 'B01-hero', type: 'hero', role: 'hero', cta_allowed: true, elements: [{ kind: 'h1', count: '1', chars: { min: 0, median: 0, max: 70 } }] },
      { block_id: 'B02-cta', type: 'cta', role: 'conversion', cta_allowed: true, elements: [{ kind: 'h2', count: '1', chars: { min: 0, median: 0, max: 80 } }] },
      { block_id: 'B03-faq', type: 'faq', role: 'info', cta_allowed: false, elements: [{ kind: 'h2', count: '1', chars: { min: 0, median: 0, max: 80 } }] },
    ], facts: [] });
    const mk = (id, text) => wj(RW('pages', 'p', 'blocks', `${id}.json`), { block_id: id, type: id.slice(4), role: 'info', elements: [{ kind: 'h2', text }], facts_used: [], objections_closed: [], summary: 'блок теста', handoff_note: '' });
    mk('B01-hero', 'Первый экран'); mk('B02-faq', 'Старый faq'); mk('B03-faq', 'Новый faq'); mk('B04-cta', 'Призыв');
    wj(RW('audit', 'p', 'lint-B02-faq.json'), { scope: 'p/B02-faq', verdict: 'fix', findings: [] });
    wj(RW('audit', 'p', 'lint-B03-faq.json'), { scope: 'p/B03-faq', verdict: 'pass', findings: [] });
    const rr = run(Rr, ['scripts/renumber-blocks.mjs', 'p']);
    check('renumber-blocks: копия с целевым именем остается, старая копия - в _old', rj(RW('pages', 'p', 'blocks', 'B03-faq.json')).elements[0].text === 'Новый faq' && fs.existsSync(RW('pages', 'p', '_old', 'B02-faq.json')) && !fs.existsSync(RW('pages', 'p', 'blocks', 'B02-faq.json')), rr.out);
    check('renumber-blocks: lint-файл оставшейся копии на месте, старой - удален; cta перенумерован', rj(RW('audit', 'p', 'lint-B03-faq.json')).verdict === 'pass' && !fs.existsSync(RW('audit', 'p', 'lint-B02-faq.json')) && fs.existsSync(RW('pages', 'p', 'blocks', 'B02-cta.json')) && /переименовано: 1, убрано в _old: 1/.test(rr.out), rr.out);
  }

  // ================================================================== 9. программа 28.09, пакет P3a
  // --- 9.1 lib: «Где можно», страховка «не публикуем», единицы опор, CTA, синонимы финального призыва
  {
    const opts = { slugs: ['home', 'remont', 'montazh', 'okna'], types: ['home', 'service', 'hub', 'category', 'info_about'] };
    const D = rows => parseDecisions([DECISIONS_V2, '| Факт | Конфликт | Разрешенная формулировка | Где можно |', '|---|---|---|---|', ...rows].join('\n'), opts);
    const pg = (slug, type) => ({ slug, type });
    const w1 = D(['| F01 | a | «x» | только remont |', '| F02 | b | «y» | везде |', '| F03 | c | «z» | все, кроме remont |', '| F04 | d | «w» | все, -remont, -okna |', '| F05 | e | «v» | нигде, кроме home |', '| F06 | f | «u» | service, кроме remont |', '| F07 | g | «t» | Только: home |']);
    check('«Где можно»: «только remont» - только remont', decisionAllows(w1.facts.F01.allow, pg('remont', 'service')) && !decisionAllows(w1.facts.F01.allow, pg('montazh', 'service')) && !w1.warnings.length, JSON.stringify(w1.warnings));
    check('«Где можно»: «везде» = все', w1.facts.F02.allow === 'all');
    check('«Где можно»: «все, кроме remont» - везде, кроме remont', decisionAllows(w1.facts.F03.allow, pg('home', 'home')) && decisionAllows(w1.facts.F03.allow, pg('montazh', 'service')) && !decisionAllows(w1.facts.F03.allow, pg('remont', 'service')));
    check('«Где можно»: «-slug» - исключение', !decisionAllows(w1.facts.F04.allow, pg('remont', 'service')) && !decisionAllows(w1.facts.F04.allow, pg('okna', 'category')) && decisionAllows(w1.facts.F04.allow, pg('home', 'home')));
    check('«Где можно»: «нигде, кроме home» - только home', decisionAllows(w1.facts.F05.allow, pg('home', 'home')) && !decisionAllows(w1.facts.F05.allow, pg('remont', 'service')));
    check('«Где можно»: «service, кроме remont» - услуги без remont', decisionAllows(w1.facts.F06.allow, pg('montazh', 'service')) && !decisionAllows(w1.facts.F06.allow, pg('remont', 'service')) && !decisionAllows(w1.facts.F06.allow, pg('home', 'home')));
    check('«Где можно»: «Только: home» (регистр, двоеточие)', decisionAllows(w1.facts.F07.allow, pg('home', 'home')) && !decisionAllows(w1.facts.F07.allow, pg('okna', 'category')));
    const w2 = D(['| F01 | a | «x» | все, кроме непонятно |', '| F02 | b | «y» | все, кроме remont |', '| F02 | c | «z» | remont |']);
    check('«Где можно»: нераспознанное в «кроме» - колонка не применяется, предупреждение', w2.facts.F01.allow === null && w2.warnings.some(w => /F01: «Где можно» не разобрано \(непонятно\)/.test(w)), JSON.stringify(w2.warnings));
    check('«Где можно»: две строки (кроме + список) - объединение допусков', decisionAllows(w2.facts.F02.allow, pg('remont', 'service')) && decisionAllows(w2.facts.F02.allow, pg('home', 'home')));
    const u = D(['| F01 | конфликт | Не публикуем: без выдумки не разрешить | все |', '| F02 | конфликт | Не публикуем цифру, писать «ниже рынка» | все |', '| F03 | условие | Не публикуем без условия «в среднем» | все |', '| F04 | конфликт | Не публикуем | главная и услуги |', '| F05 | конфликт | Не публикуем | home |']);
    check('страховка «не публикуем»: без разрешенной формулировки при «все» - как «нигде», предупреждение', u.facts.F01.allow === 'none' && u.warnings.some(w => /F01: «не публикуем» при «Где можно» = все - факт снят со всех страниц/.test(w)), JSON.stringify(u.warnings));
    check('страховка «не публикуем»: есть разрешенная формулировка - факт остается', u.facts.F02.allow === 'all');
    check('страховка «не публикуем»: «не публикуем без условия» - не запрет', u.facts.F03.allow === 'all');
    check('страховка «не публикуем»: неразобранная колонка - тоже «нигде»; явный список страниц не трогается', u.facts.F04.allow === 'none' && u.facts.F05.allow instanceof Set);
    const u2 = D(['| F01 | конфликт | Не публиковать | все |', '| F02 | снят | Снят: не публикуем | все |', '| F03 | условие | Снят: не публикуем без условия «от» | все |', '| F04 | формулировка | Публиковать «от 5 000 рублей» | все |']);
    check('страховка «не публикуем»: «Не публиковать» и «Снят: не публикуем» при «все» - тоже «нигде»', u2.facts.F01.allow === 'none' && u2.facts.F02.allow === 'none' && u2.warnings.some(w => /F02: «не публикуем» при «Где можно» = все/.test(w)), JSON.stringify(u2.warnings));
    check('страховка «не публикуем»: условие в середине строки и «публиковать» без «не» - не запрет', u2.facts.F03.allow === 'all' && u2.facts.F04.allow === 'all');
    const rw = D(['| F01, F02 | две гарантии | «12 месяцев на изделие», «6 месяцев на ремонт» | все |', '| F02 | ремонт | «гарантия на ремонт» | все |']);
    check('parseDecisions: rows - формулировка строки со всеми id строки', JSON.stringify(rw.facts.F01.rows) === JSON.stringify([{ rule: '«12 месяцев на изделие», «6 месяцев на ремонт»', ids: ['F01', 'F02'] }]) && rw.facts.F02.rows.length === 2 && rw.facts.F02.rows[1].ids.join() === 'F02', JSON.stringify(rw.facts));
    check('digitsOf: тысячи, дроби, 3D', JSON.stringify(digitsOf('12 400 и 1,5 и 3D')) === '["12400","1.5","3"]');
    check('factUnits: пункты списка через запятую и «;», минимум 1, «1,5» не делит', factUnits({ wording: 'Фото, эскиз, модель или старое украшение, свое золото, описание идеи' }) === 5 && factUnits({ wording: 'Гарантия 12 месяцев' }) === 1 && factUnits({ wording: 'Толщина от 1,5 мм' }) === 1 && factUnits({ wording: 'а; б; в', value: 'а' }) === 3);
    const g = { main: 'Получить расчет', short: 'Расчет', action: 'messenger', secondary: 'Написать мастеру', secondary_action: 'messenger' };
    const m0 = mergeCta(g, undefined), m1 = mergeCta(g, { main: 'Получить расчет' }), m2 = mergeCta(g, { main: 'Узнать статус', secondary: 'Приехать в мастерскую' }), m3 = mergeCta(g, { secondary: '' }), m4 = mergeCta('Старая строка', null);
    check('mergeCta: без cta страницы - весь global', m0.cta.main === 'Получить расчет' && m0.cta.short === 'Расчет' && m0.cta.action === 'messenger' && m0.cta.secondary_action === 'messenger' && !m0.lost.length);
    check('mergeCta: та же подпись - action и short наследуются парами', m1.cta.action === 'messenger' && m1.cta.short === 'Расчет' && !m1.lost.length);
    check('mergeCta: другая подпись - действия global не переносятся, lost', m2.cta.main === 'Узнать статус' && !m2.cta.action && !m2.cta.short && m2.cta.secondary === 'Приехать в мастерскую' && !m2.cta.secondary_action && m2.lost.join() === 'action,short,secondary_action', JSON.stringify(m2));
    check('mergeCta: secondary "" - второй кнопки нет; строка старых данных - {main}', !('secondary' in m3.cta) && m3.cta.main === 'Получить расчет' && JSON.stringify(m4.cta) === '{"main":"Старая строка"}');
    check('resolveBlockId: cta-final и cta - синонимы, прочее строго', resolveBlockId('cta-final', ['hero', 'cta']) === 'cta' && resolveBlockId('cta', ['cta-final']) === 'cta-final' && resolveBlockId('faq', ['hero']) === '' && resolveBlockId('hero', ['hero']) === 'hero');
    check('isNumbersBlock: pattern numbers или только цифры (без карточек и списков)', isNumbersBlock({ pattern: 'numbers', elements: [] }) && isNumbersBlock({ pattern: 'grid-4', elements: [{ kind: 'h2', count: '1' }, { kind: 'number', count: '3-4' }] }) && !isNumbersBlock({ pattern: 'grid-3', elements: [{ kind: 'number', count: '2' }, { kind: 'card', count: '3' }] }) && !isNumbersBlock({ role: 'hero', pattern: 'numbers', elements: [] }));
    check('isServiceText: служебная записка стратега - да, оговорка для читателя - нет', isServiceText('В блок «Условия» - только пункты из его task на странице. По типам: ...') && isServiceText('см. F12') && !isServiceText('Итоговая цена считается по замеру'));
    const SVC = [
      ['Прошлая доходность стратегии не гарантирует доходность в будущем', false], ['Инвестиционная стратегия фонда не гарантирует доход', false],
      ['Модель B200 поставляется под заказ', false], ['Ford F150 доступен под заказ, срок поставки уточняйте', false],
      ['Сборщик приезжает в день доставки, сборка оплачивается отдельно', false], ['Заполните бриф - смета придет на почту', false],
      ['Пишите на ivan_petrov@mail.ru', false], ['', false],
      ['Консультация стратега входит в тариф', false], ['Оговорка для писателя: по типам услуг разная', true],
      ['см. F12', true], ['Не ставить hero_facts в оговорку', true], ['Только в B04-not-promise', true], ['Про F01 и F02 не писать', true],
      ['Для стратега: F12 только на главной', true], ['Писатель берет формулировку из брифа', true],
    ];
    const svcBad = SVC.filter(([t, want]) => isServiceText(t) !== want).map(([t]) => t);
    check('isServiceText: два очка признаков; «стратегии», B200, F150, сборщик, бриф и почта в тексте для читателя - не служебная записка', !svcBad.length, svcBad.join(' | '));
    check('prefsForBlock: адрес cta-final - блок cta старых данных и наоборот', prefsForBlock([{ text: 'x', status: 'basis', where: 'cta-final' }], { type: 'cta', block_id: 'B06-cta', role: 'conversion' }).length === 1 && prefsForBlock([{ text: 'x', status: 'basis', where: 'cta' }], { type: 'cta-final', block_id: 'B06-cta-final', role: 'conversion' }).length === 1);
    const mx = maskExample({ domain: 'nota-gold.ru', text: 'Nota Gold: с 2009 года, 4 минуты от метро, www.nota-gold.ru', why_strong: 'цифра 2009 и бренд nota' });
    check('maskExample: цифры -> N, домен и его части -> [компания], domain замаскирован', mx.text === '[компания] [компания]: с N года, N минуты от метро, www.[компания]' && mx.domain === '[компания]' && mx.why_strong === 'цифра N и бренд [компания]', JSON.stringify(mx));
    const NMk = nameMask(['Шины 205/55 R16', 'Окна 24', 'Ремонт квартир под ключ']);
    check('nameMask: имя целиком, токены с цифрой и буквой - везде, голое число - только в составе имени', !/\d/.test(NMk.mask('Шин 205/55 R16 в наличии')) && !/24/.test(NMk.mask('Окна 24 ставят окна')) && /24/.test(NMk.mask('Приедем за 24 часа')));
    const NML = nameMask(['Ремонт квартир под ключ', 'Быстрый ремонт окон', 'лучший монтаж окон тула']);
    check('nameMask.maskLoose: склоненное имя (основы подряд, предлог между словами) маскируется', !/ключ/.test(NML.maskLoose('Ремонта квартир под ключ хватит на сезон')) && !/лучш/i.test(NML.maskLoose('Лучший монтаж окон в Туле')) && !/быстр/i.test(NML.maskLoose('Быстрого ремонта окон ждать не нужно')));
    check('nameMask.maskLoose: слово имени вне имени не маскируется', /Быстрый выезд/.test(NML.maskLoose('Быстрый выезд замерщика')) && /Лучший монтаж в городе/.test(NML.maskLoose('Лучший монтаж в городе')) && /под ключ/.test(NML.maskLoose('Сделаем под ключ')));
    const sr = stopWordsRe(RULES);
    check('стоп-слова: правая граница (надежность, эффективность, быстросъемные - нет; надежная, качественного - да)', !sr.test('Надежность крепления') && !sr.test('Эффективность монтажа') && !sr.test('Быстросъемные петли') && sr.test('Надежная компания') && sr.test('Для качественного ремонта') && sr.test('Динамично развивающаяся компания'));
  }

  // --- 9.2 build-briefs: страховки фактов, count по единицам, блок цифр, пустой facts, CTA, K5, оговорка, « ~ »
  {
    const X = mkProject('p3a-briefs');
    const XW = (...p) => path.join(X, 'work', ...p);
    const d = fixCta(base());
    // факты: список (5 единиц), числовые, конфликт с антиобещанием без строки §1, факт с устаревшей формулировкой §1
    d.facts.facts.push(
      { id: 'F20', label: 'варианты заказа', value: 'фото, эскиз, модель, старое украшение, свое золото', wording: 'Фото, эскиз, понравившаяся модель, старое украшение, свое золото', publish: 'yes', kind: 'process' },
      { id: 'F21', label: 'результат', value: '98% клиентов довольны', wording: '98% клиентов довольны', publish: 'yes', kind: 'number' },
      { id: 'F22', label: 'срок', value: 'от 45 дней', wording: 'От 45 дней на объект', publish: 'yes', kind: 'number' },
      { id: 'F23', label: 'опыт', value: '12 лет', wording: '12 лет в ремонте', publish: 'yes', kind: 'number' },
      { id: 'F24', label: 'бригады', value: '5 бригад', wording: '5 своих бригад', publish: 'yes', kind: 'number' },
    );
    d.facts.gaps.push('конфликт: F21 против A01 (регулярка ловит формулировку факта)', 'конфликт: F04 - маркер снятия в тексте факта, при этом publish: yes');
    d.facts.terminology.use = [{ say: 'надежный монтаж по ГОСТ', not: 'пена' }];
    const nums = blk('numbers', 'conversion', 'numbers', [el('h2', '1', 80), el('number', '3-4', 40)], { fact_kinds: ['number'] });
    const list = blk('options', 'conversion', 'list', [el('h2', '1', 80), el('bullets', '4-6', 120)], { fact_kinds: ['process'] });
    const cards = blk('ways', 'conversion', 'grid-3', [el('h2', '1', 80), el('card', '3-4', 200)], { fact_kinds: ['process'] });
    d.types.service = ptype('service', [B.heroNoBtn, nums, list, cards, B.faq, B.cta]);
    d.strategy.pages.remont = entry(['F02', 'F20', 'F21', 'F22', 'F23', 'F24'], { hero_facts: ['F21'], block_overrides: { ways: { facts: ['F20'] }, options: { facts: ['F02'] } }, cta: undefined });
    d.strategy.pages.montazh = entry(['F05', 'F02'], { hero_facts: ['F05'], cta: undefined });
    d.strategy.global.disclaimer_text = 'В блок «Условия» - только пункты из его task на странице. По типам: услуги';
    d.decisions = d.decisions.replace('| F10 | снят | не публикуем | нигде |', '| F10 | снят | не публикуем | нигде |\n| F04 | конфликт | Не публикуем: без выдумки не разрешить | все |\n| F22 | условие | «от 30 дней на объект» | все |\n| F23, F24 | опыт и бригады | «12 лет в ремонте и 5 своих бригад» | все |\n| F02, F20 | замер и варианты | «замер на следующий день, 7 вариантов заказа» | все |');
    d.sitemap.pages.find(p => p.slug === 'remont').source_queries = ['ремонт окон москва', 'ремонт окон'];
    writeProject(X, d);
    const r = run(X, ['scripts/build-briefs.mjs']);
    const rep = rj(XW('briefs-report.json'));
    const WR9 = rep.warnings.join(' | ');
    const rb = rj(XW('pages', 'remont', 'brief.json')), mb = rj(XW('pages', 'montazh', 'brief.json')), hb9 = rj(XW('pages', 'home', 'brief.json'));
    check('P3a build-briefs: код 0, брифы проходят схему', r.code === 0 && !schemaErrors('brief', rb).length && !schemaErrors('brief', mb).length, r.out.slice(0, 600));
    check('п.10: «не публикуем» при «все» - факт снят (where) со всех страниц, предупреждение', !hb9.facts.some(f => f.id === 'F04') && rep.pages.home.facts_dropped.some(x => x.id === 'F04' && x.reason === 'where') && /F04: «не публикуем» при «Где можно» = все/.test(WR9), WR9);
    check('п.10 (Р1): конфликт «против» антиобещания без строки §1 - в брифы не идет, причина conflict, предупреждение', !rb.facts.some(f => f.id === 'F21') && rep.pages.remont.facts_dropped.some(x => x.id === 'F21' && x.reason === 'conflict') && /F21: конфликт: F21 против A01 .* строки §1 decisions\.md нет, факт в брифы не идет/.test(WR9), WR9);
    check('п.10: строка «маркер снятия» (не «против») страховкой конфликта не снимает', !rep.pages.home.facts_dropped.some(x => x.id === 'F04' && x.reason === 'conflict'));
    check('п.11: формулировка §1 с числом, которого нет в факте, - в бриф не идет, предупреждение «поправь строку §1»', rb.facts.find(f => f.id === 'F22') && !rb.facts.find(f => f.id === 'F22').rule && /F22: в разрешенной формулировке числа 30, их нет в факте \(value «от 45 дней»\) - формулировка в бриф не идет/.test(WR9), WR9);
    check('п.11: формулировка без чужих чисел - в бриф идет', hb9.facts.find(f => f.id === 'F08').rule === '«в среднем на 20% дешевле»');
    check('п.11: строка «F23, F24» - числа формулировки сверяются с фактами строки, rule остается у обоих', rb.facts.find(f => f.id === 'F23').rule === '«12 лет в ремонте и 5 своих бригад»' && rb.facts.find(f => f.id === 'F24').rule === '«12 лет в ремонте и 5 своих бригад»' && !/F2[34]: в разрешенной формулировке/.test(WR9), WR9);
    check('п.11: число, которого нет ни в одном факте строки, - rule снят у всех, предупреждение «в фактах строки»', !rb.facts.find(f => f.id === 'F02').rule && /F02: в разрешенной формулировке числа 7, их нет в фактах строки \(F02, F20\)/.test(WR9) && /F20: в разрешенной формулировке числа 7/.test(WR9), WR9);
    const rbl = type => rb.blocks.find(b => b.type === type);
    check('п.24: карточки 3-4 при факте из 5 единиц - без изменений', rbl('ways').elements.find(e => e.kind === 'card').count === '3-4');
    check('п.24: список 4-6 при факте из 1 единицы - 1-6, предупреждение count, вопроса нет', rbl('options').elements.find(e => e.kind === 'bullets').count === '1-6' && /remont: B0\d-options: bullets 4-6 при опорах 1 -> 1-6/.test(WR9) && !rep.questions.some(q => /Блок options/.test(q.text)), WR9);
    check('п.24: блок цифр 3-4 при 3 числовых фактах - без изменений, при конфликтном F21 снятом - числовые F22-F24', rbl('numbers') && rbl('numbers').elements.find(e => e.kind === 'number').count === '3-4' && ['F22', 'F23', 'F24'].every(f => rbl('numbers').facts.includes(f)), JSON.stringify(rbl('numbers')));
    check('п.24: блок цифр без числовых фактов - выпал (dropped «нет числовых фактов») с вопросом заказчику', !mb.blocks.some(b => b.type === 'numbers') && rep.pages.montazh.dropped.some(x => x.block === 'numbers' && x.reason === 'нет числовых фактов') && rep.questions.some(q => /Блок numbers/.test(q.text) && q.pages.includes('montazh')), JSON.stringify(rep.pages.montazh));
    // первый экран remont: hero_facts [F21] снят конфликтом - заметка « ~ »
    check('первый экран без фактов - строка « ~ » в выводе build-briefs', /^ ~ remont: первый экран без фактов \(hero_facts F21 сняты: конфликт с антиобещанием/m.test(r.out), r.out);
    check('K5: key_phrase - первый source_queries страницы, в бриф и в срез первого экрана (только ему)', rb.key_phrase === 'ремонт окон москва' && rj(XW('pages', 'remont', 'brief', `${rb.blocks[0].block_id}.json`)).key_phrase === 'ремонт окон москва' && !('key_phrase' in rj(XW('pages', 'remont', 'brief', `${rb.blocks[1].block_id}.json`))) && !('key_phrase' in hb9));
    check('оговорка: служебная записка стратега - ни в брифы, ни в срезы, предупреждение', !rb.blocks.some(b => b.disclaimer_text) && !hb9.blocks.some(b => b.disclaimer_text) && !hb9.disclaimer_text && /disclaimer_text похож на служебную записку/.test(WR9), WR9);
    check('п.22: terminology.use под стоп-словом - предупреждение vocab', /terminology\.use «надежный монтаж по ГОСТ»: стоп-слово «надежный»/.test(WR9), WR9);
    const ok9 = rj(XW('pages', 'okna', 'brief.json')).blocks.find(b => b.type === 'listing');
    check('п.19: элемент filters листинга - «названия признаков без значений»', ok9.elements.find(e => e.kind === 'filters').note === 'названия признаков без значений');
    {
      // доделка №19: у типа свой filters с подсказкой «название группы и 2-4 значения» (так на Goldax писатель сочинил
      // значения) - в брифе и в срезе писателя остается только «названия признаков без значений», count типа прежний
      const d19 = fixCta(base());
      d19.types.category = ptype('category', [B.hero, blk('listing', 'conversion', 'listing', [el('h2', '1', 60), el('text', '1', 200), el('filters', '3-5', 30, { note: 'пункт - название группы фильтра и 2-4 значения коротко' })], { core: true }), B.cta]);
      writeProject(X, d19);
      const r19 = run(X, ['scripts/build-briefs.mjs', 'okna']);
      const lb19 = r19.code === 0 ? rj(XW('pages', 'okna', 'brief.json')).blocks.find(b => b.type === 'listing') : null;
      const fe19 = lb19 && lb19.elements.find(e => e.kind === 'filters');
      const sj19 = lb19 ? JSON.stringify(rj(XW('pages', 'okna', 'brief', `${lb19.block_id}.json`))) : '';
      check('п.19: свой filters типа с подсказкой «2-4 значения» - в брифе и в срезе писателя только «названия признаков без значений»', !!fe19 && fe19.note === 'названия признаков без значений' && fe19.count === '3-5' && sj19.includes('названия признаков без значений') && !/2-4 значения/.test(sj19), r19.code ? r19.out.slice(0, 400) : JSON.stringify(fe19));
    }
    {
      // доделка №24: возражения списка, опирающиеся на тот же факт, опорой второй раз не считаются (katalog-pirsing)
      const d24 = fixCta(base());
      const f04 = d24.facts.facts.find(f => f.id === 'F04');
      f04.value = '12 месяцев на монтаж, фурнитуру, стеклопакет'; f04.wording = 'Гарантия на монтаж, на фурнитуру, на стеклопакет';
      d24.audience.segments[1].objections[0].facts = ['F04'];
      const list24 = blk('options', 'conversion', 'list', [el('h2', '1', 80), el('bullets', '4-6', 120)]);
      const nums24 = blk('numbers', 'conversion', 'numbers', [el('h2', '1', 80), el('number', '3-4', 40)], { fact_kinds: ['number'] });
      d24.facts.facts.push({ id: 'F12', label: 'объекты', value: '500 объектов', wording: '500 объектов', publish: 'yes', kind: 'number' });
      d24.types.service = ptype('service', [B.hero, list24, nums24, B.cta]);
      d24.strategy.pages.remont = entry(['F04', 'F05', 'F01', 'F08', 'F12'], { hero_facts: ['F01', 'F08'], block_overrides: { options: { facts: ['F04'], objection_ids: ['O1', 'O3'] } }, cta: undefined });
      writeProject(X, d24);
      const r24 = run(X, ['scripts/build-briefs.mjs', 'remont']);
      const w24 = r24.code === 0 ? rj(XW('briefs-report.json')).warnings.join(' | ') : '';
      const b24 = r24.code === 0 ? rj(XW('pages', 'remont', 'brief.json')).blocks : [];
      const opt24 = b24.find(b => b.type === 'options'), num24 = b24.find(b => b.type === 'numbers');
      check('№24: bullets 4-6, один факт из 3 единиц и два возражения с тем же фактом - 3-6 и предупреждение count', r24.code === 0 && opt24 && opt24.elements.find(e => e.kind === 'bullets').count === '3-6' && /remont: B0\d-options: bullets 4-6 при опорах 3 -> 3-6/.test(w24), r24.code ? r24.out.slice(0, 400) : w24);
      check('№24: блок цифр - опоры только свежие числовые факты (цифры первого экрана писатель не повторяет): 3-4 при одном свежем - 1-4', !!num24 && num24.elements.find(e => e.kind === 'number').count === '1-4' && /remont: B0\d-numbers: number 3-4 при опорах 1 -> 1-4/.test(w24), JSON.stringify(num24 && num24.facts) + ' ' + w24);
      // возражение с фактом вне фактов блока - опора: 3 единицы + 1 = 4, граница 4-6 не меняется
      d24.audience.segments[1].objections[0].facts = ['F05'];
      writeProject(X, d24);
      const r24b = run(X, ['scripts/build-briefs.mjs', 'remont']);
      const opt24b = r24b.code === 0 ? rj(XW('pages', 'remont', 'brief.json')).blocks.find(b => b.type === 'options') : null;
      check('№24: возражение с фактом вне фактов блока - опора (4-6 без изменений)', !!opt24b && opt24b.elements.find(e => e.kind === 'bullets').count === '4-6', r24b.out.slice(0, 300));
    }
    // предмет страницы под антиобещанием
    const d2 = fixCta(base());
    d2.sitemap.pages.find(p => p.slug === 'remont').subject = 'Окна: самая низкая цена в городе';
    d2.types.service = d.types.service;
    d2.strategy.pages.montazh = entry(['F05', 'F02'], { hero_facts: ['F05'], block_overrides: { numbers: { facts: [] } } });
    writeProject(X, d2);
    const r2 = run(X, ['scripts/build-briefs.mjs', 'remont', 'montazh']);
    const rep2 = rj(XW('briefs-report.json'));
    check('пустой явный facts у блока цифр - исключение: excluded, не dropped, вопроса нет', rep2.pages.montazh.excluded.includes('numbers') && !rep2.pages.montazh.dropped.some(x => x.block === 'numbers') && !(rep2.pages.montazh.questions || []).some(q => /Блок numbers/.test(q.text)), JSON.stringify(rep2.pages.montazh));
    check('п.22: предмет страницы под антиобещанием - предупреждение vocab', /remont: предмет страницы «Окна: самая низкая цена в городе» попадает под антиобещание A01/.test(rj(XW('briefs-report.json')).warnings.join(' | ')), r2.out);
    // оговорка для читателя со словом «стратегии» (инвестиции) - не служебная записка: в бриф и в срез своего блока
    const d3 = fixCta(base());
    d3.strategy.global.disclaimer_text = 'Прошлая доходность стратегии не гарантирует доходность в будущем';
    writeProject(X, d3);
    const r3 = run(X, ['scripts/build-briefs.mjs', 'home']);
    const hb3 = rj(XW('pages', 'home', 'brief.json'));
    const np3 = hb3.blocks.find(b => b.type === 'not-promise');
    check('оговорка: инвестиционная оговорка со словом «стратегии» - в блоке disclaimer_block и в его срезе, без предупреждения', np3 && np3.disclaimer_text === d3.strategy.global.disclaimer_text && rj(XW('pages', 'home', 'brief', `${np3.block_id}.json`)).disclaimer_text === d3.strategy.global.disclaimer_text && !/похож на служебную записку/.test(rj(XW('briefs-report.json')).warnings.join(' | ')), r3.out);
    // срезы прошлой версии формата (slice-v2) пересобираются page-state без пересборки брифа
    const hbText = fs.readFileSync(XW('pages', 'home', 'brief.json'), 'utf8');
    const oldSha = crypto.createHash('sha1').update(`slice-v2\n${hbText}`).digest('hex');
    const sf = XW('pages', 'home', 'brief', `${np3.block_id}.json`);
    wj(sf, { ...rj(sf), _brief_sha1: oldSha });
    const ps9 = run(X, ['scripts/page-state.mjs', 'home']);
    check('срез: SLICE_FORMAT slice-v3, срез старого формата пересобран page-state', SLICE_FORMAT === 'slice-v3' && rj(sf)._brief_sha1 === briefSha(hbText) && briefSha(hbText) !== oldSha, ps9.out);
  }

  // --- 9.3 CTA через merge-strategy и build-briefs: наследование, K7, cta-final
  {
    const C = mkProject('p3a-cta');
    const CW = (...p) => path.join(C, 'work', ...p);
    const d = fixCta(base());
    d.facts.company.channels = { whatsapp: 'https://wa.me/70000000000' };
    d.strategy.global.cta_by_type = {
      home: { main: 'Получить расчет', short: 'Расчет', action: 'messenger' },
      service: { main: 'Вызвать мастера', secondary: 'Написать мастеру', secondary_action: 'messenger', short: 'Мастер' },
      category: { main: 'Выбрать модель' },
      hub: { main: 'Смотреть услуги', action: 'anchor:cta-final' },
    };
    writeProject(C, d);
    wj(CW('strategy.pages', 'home.json'), { type: 'home', pages: { home: entry(['F01', 'F02', 'F04', 'F05'], { hero_facts: ['F01'], cta: { main: 'Получить расчет' } }) } });
    wj(CW('strategy.pages', 'service.json'), { type: 'service', pages: {
      remont: entry(['F02'], { hero_facts: ['F02'], cta: undefined }),
      montazh: entry(['F05'], { hero_facts: ['F05'], cta: { main: 'Вызвать мастера', secondary: 'Приехать в мастерскую' } }),
    } });
    wj(CW('strategy.pages', 'category.json'), { type: 'category', pages: { okna: entry(['F05'], { cta: undefined }), dveri: entry(['F05'], { cta: { main: 'Выбрать модель', action: 'anchor:listing' } }) } });
    for (const f of ['service', 'category']) { const o = rj(CW('strategy.pages', `${f}.json`)); for (const e of Object.values(o.pages)) if (e.cta === undefined) delete e.cta; wj(CW('strategy.pages', `${f}.json`), o); }
    const ck = run(C, ['scripts/merge-strategy.mjs', '--check', 'work/strategy.pages/service.json', 'work/strategy.pages/category.json']);
    check('strategy: cta страницы необязателен - записи без cta проходят --check', !/нет обязательного поля "cta"/.test(ck.out) && /^OK work\/strategy\.pages\/service\.json/m.test(ck.out), ck.out);
    check('K7: страница с выдачей (listing: true) без action главной кнопки - предупреждение по данным', /pages\.okna: cta: у страницы с выдачей главная кнопка без action[^\n]*anchor:listing/.test(ck.out), ck.out);
    check('K7: с action anchor:listing - без предупреждения; dveri (listing: false, блок листинга у типа) - по блоку типа', !/pages\.dveri: cta: у страницы с выдачей/.test(ck.out), ck.out);
    const mg = run(C, ['scripts/merge-strategy.mjs']);
    const bb = run(C, ['scripts/build-briefs.mjs']);
    const br = s => rj(CW('pages', s, 'brief.json'));
    check('CTA через merge + build-briefs: сборка без проблем', mg.code === 0 && bb.code === 0, mg.out + bb.out);
    check('наследование: страница без cta - short и action из global', br('remont').cta.short === 'Мастер' && br('remont').cta.secondary_action === 'messenger' && br('remont').cta.main === 'Вызвать мастера');
    check('наследование: та же подпись main без action - action и short из global', br('home').cta.action === 'messenger' && br('home').cta.short === 'Расчет');
    check('наследование: другая подпись secondary - secondary_action global не переносится, заметка « ~ » для рецензии', br('montazh').cta.secondary === 'Приехать в мастерскую' && !br('montazh').cta.secondary_action && /^ ~ montazh: подпись CTA страницы изменена, secondary_action из global\.cta_by_type\.service не перенесены/m.test(bb.out), bb.out);
    check('cta-final: anchor:cta-final на типе со старым блоком cta - переписан на anchor:cta', br('uslugi').cta.action === 'anchor:cta', JSON.stringify(br('uslugi').cta));
    check('cta-final: anchor:cta-final в --check global на типе со старым cta - без проблемы', !/cta_by_type\.hub\.action[^\n]*блока cta-final нет/.test(mg.out), mg.out);
    // objection_to_block на cta-final при старом блоке cta: возражение уходит в слот cta
    const d2 = fixCta(base());
    d2.strategy.global.objection_to_block = { O1: 'cta-final' };
    d2.types.home = ptype('home', [B.hero, { ...B.cta, objection_slot: true }, B.faq]);
    d2.strategy.pages.home = entry(['F04'], { hero_facts: ['F04'], objection_ids: ['O1'] });
    d2.prefs.items = [{ text: 'Позвонить до 20:00', status: 'basis', where: 'cta-final', pages: ['home'] }];
    writeProject(C, d2);
    fs.rmSync(CW('strategy.pages'), { recursive: true, force: true });
    run(C, ['scripts/build-briefs.mjs', 'home']);
    const h2 = rj(CW('pages', 'home', 'brief.json'));
    check('cta-final: objection_to_block cta-final - слот старого блока cta', h2.blocks.find(b => b.type === 'cta').objection_ids.includes('O1'), JSON.stringify(h2.blocks.map(b => [b.type, b.objection_ids])));
    check('cta-final: пожелание с адресом cta-final при старом блоке cta - без предупреждения «блока нет»', !/пожелание «Позвонить до 20:00» адресовано блоку/.test(rj(CW('briefs-report.json')).warnings.join(' | ')));
  }

  // --- 9.4 срез: маска примера лидера
  {
    const sb = { slug: 's', url: '/s', type: 'home', subject: 'X', key_phrase: 'x москва', block_set: 'full', company: 'Тест', offer_formula: { id: 'F3', name: 'n', recipe: 'r' }, segment: { id: 'S1', name: 'n', portrait: 'p', pains: [], fears: [], objections: [] }, unique_argument: 'u', cta: { main: 'm' }, facts: [], anti_promises: [], terminology: {}, client_phrases: [],
      blocks: [{ block_id: 'B01-hero', type: 'hero', name: 'h', role: 'hero', reader_question: 'q', pattern: 'hero-split', cta_allowed: true, objection_ids: [], facts: [], elements: [{ kind: 'h1', count: '1', chars: { min: 0, max: 70 } }], examples: [{ domain: 'mkastom.ru', text: 'Mkastom: в 4 минутах от станции метро, работаем с 2009 года, более 300 изделий в месяц', why_strong: 'адрес и 300 изделий' }] }] };
    const sl9 = sliceBrief(sb, 'x')[0].slice;
    check('срез: пример лидера замаскирован (цифры, бренд), key_phrase у первого экрана, схема среза', sl9.block.examples[0].text === '[компания]: в N минутах от станции метро, работаем с N года, более N изделий в месяц' && sl9.key_phrase === 'x москва' && !schemaErrors('brief-slice', sl9).length, JSON.stringify(sl9.block.examples) + schemaErrors('brief-slice', sl9).join('; '));
  }

  // --- 9.5 линтер: словарь страницы, стоп-слова, «обращение ко всем», embellish (CLI на синтетической странице)
  {
    const Lz = mkProject('p3a-lint');
    const pdir = path.join(Lz, 'work', 'pages', 'p');
    const spec = (id, role, els, ctaOk = false) => ({ block_id: id, role, cta_allowed: ctaOk || role === 'hero', elements: els.map(([kind, count, max]) => ({ kind, count, chars: { min: 0, max } })) });
    const lb = { slug: 'p', url: '/p', type: 'service', subject: 'Ремонт квартир под ключ', key_phrase: 'ремонт квартир под ключ москва', company: 'Окна 24', geo: '', cta: { main: 'Получить смету' },
      links: [{ url: '/shiny', subject: 'Шины 205/55 R16' }, { url: '/galaxy', subject: 'Samsung Galaxy S24' }, { url: '/remont-okon', subject: 'Быстрый ремонт окон' }], terminology: { use: [], untranslatable: [] },
      facts: [{ id: 'F01', label: 'гарантия', value: '12 месяцев', wording: 'Гарантия 12 месяцев', kind: 'legal' }, { id: 'F02', label: 'доходность', value: 'до 14% годовых', wording: 'Доходность на аренде до 14% годовых', kind: 'number' }],
      blocks: [spec('B01-hero', 'hero', [['h1', '1', 70], ['sub', '0-1', 160], ['button', '1', 30]]), spec('B02-a', 'conversion', [['h2', '1', 80], ['text', '1-2', 350], ['link', '0-3', 60], ['card', '0-3', 220]]), spec('B03-b', 'conversion', [['h2', '1', 80], ['text', '1-2', 350]]), spec('B04-c', 'conversion', [['h2', '1', 80], ['text', '1-2', 350]])] };
    wj(path.join(pdir, 'brief.json'), lb);
    wj(path.join(Lz, 'work', 'sitemap.json'), { pages: [{ slug: 'p', url: '/p', type: 'service', status: 'briefed' }] });
    const wb = (id, els, extra = {}) => wj(path.join(pdir, 'blocks', `${id}.json`), { block_id: id, type: id.slice(4), role: id === 'B01-hero' ? 'hero' : 'conversion', elements: els, facts_used: [], objections_closed: [], summary: 'синтетический блок теста', handoff_note: '', ...extra });
    const lint = (id, extra = []) => { const r = run(Lz, ['scripts/lint.mjs', `work/pages/p/blocks/${id}.json`, ...extra]); return rj(path.join(Lz, 'work', 'audit', 'p', `lint-${id}.json`)); };
    const rules = r => r.findings.filter(f => f.severity !== 'minor').map(f => f.rule);
    const T = (kind, text, facts = []) => ({ kind, text, facts });
    wb('B01-hero', [T('h1', 'Ремонт квартир под ключ от Окна 24'), T('button', 'Получить смету')]);
    let l = lint('B01-hero');
    check('п.22: H1 = предмет страницы с «под ключ» и бренд с цифрой - pass (нет copy.stop-word, нет цифры без факта)', l.verdict === 'pass', JSON.stringify(l.findings));
    wb('B01-hero', [T('h1', 'Ремонта квартир под ключ хватит на сезон'), T('button', 'Получить смету')]);
    check('п.22: склоненный предмет с «под ключ» - стоп-фраза внутри имени не находка', !rules(lint('B01-hero')).includes('copy.stop-word'));
    wb('B02-a', [T('h2', 'Каталог шин и телефонов'), T('text', 'Подберем шины 205/55 R16 и Galaxy S24 по наличию.'), { kind: 'link', text: 'Шины 205/55 R16', href: '/shiny', facts: [] }]);
    check('п.22: модели и размеры из предметов ссылок - без fact.number-without-source', !lint('B02-a').findings.some(f => f.rule === 'fact.number-without-source'));
    wb('B02-a', [T('h2', 'Проект в 3D'), T('text', 'Покажем 3D-модель и приедем за 24 часа.')]);
    const l3d = lint('B02-a').findings.filter(f => f.rule === 'fact.number-without-source').map(f => f.problem).join(' ');
    check('п.22: «3D» и «24 часа» без факта - по-прежнему blocker (голое число из бренда вне имени не маскируется)', /«3»/.test(l3d) && /«24»/.test(l3d), l3d);
    wb('B02-a', [T('h2', 'Надежность крепления'), T('text', 'Быстросъемные петли и эффективность монтажа видны на объекте.')]);
    check('п.22: правая граница стоп-слов - «надежность», «быстросъемные», «эффективность» не стоп-слова', !rules(lint('B02-a')).includes('copy.stop-word'));
    wb('B02-a', [T('h2', 'Как выбрать'), T('text', 'Надежная компания рядом.')]);
    check('п.22: «надежная» без факта - по-прежнему copy.stop-word', rules(lint('B02-a')).includes('copy.stop-word'));
    wb('B02-a', [T('h2', 'Как выбрать'), T('text', 'Быстрый выезд замерщика.')]);
    check('п.22: стоп-слово из предмета ссылки вне имени («Быстрый выезд» при ссылке «Быстрый ремонт окон») - copy.stop-word', rules(lint('B02-a')).includes('copy.stop-word'));
    wb('B02-a', [T('h2', 'Как выбрать'), T('text', 'Заказать быстрый ремонт окон можно онлайн.')]);
    check('п.22: стоп-слово внутри предмета ссылки - не находка', !rules(lint('B02-a')).includes('copy.stop-word'));
    wb('B02-a', [T('h2', 'Как выбрать'), T('text', 'Сделаем под ключ за один выезд.')]);
    check('п.22: «под ключ» вне предмета страницы - copy.stop-word', rules(lint('B02-a')).includes('copy.stop-word'));
    // предмет страницы защищен от проверки повторов: маркерная фраза звучит на странице не один раз
    wb('B01-hero', [T('h1', 'Ремонт квартир под ключ от Окна 24'), T('button', 'Получить смету')]);
    wb('B04-c', [T('h2', 'С чего начинаем'), T('text', 'Ремонт квартир под ключ начинается со сметы.')]);
    lint('B01-hero');
    check('п.22: повтор предмета страницы в другом блоке - без phrase.repeat', !lint('B04-c').findings.some(f => f.rule === 'phrase.repeat'));
    // «обращение ко всем»
    const AA = [['Если вы въезжаете к зиме, смета готова заранее.', false], ['Для тех, кто въезжает к зиме, смета готова заранее.', false], ['У каждого объекта свой прораб.', false], ['Смета каждому клиенту до начала работ.', false], ['Подходит для всех, кто ищет мастера.', true], ['Подходит для каждого.', true], ['Для каждого объекта своя смета.', false], ['Подойдет каждому.', true], ['Подходит любому.', true], ['Любому клиенту смета до начала работ.', false]];
    for (const [t, want] of AA) { wb('B03-b', [T('h2', 'Как считаем'), T('text', t)]); check(`п.«обращение ко всем»: «${t}» -> ${want ? 'находка' : 'без находки'}`, lint('B03-b').findings.some(f => f.rule === 'copy.address-all') === want); }
    wb('B03-b', [T('h2', 'Как считаем'), T('text', 'Работаем для тех, кто ценит качество.')]);
    check('«для тех, кто ценит» - стоп-фраза (major без факта)', lint('B03-b').findings.some(f => f.rule === 'copy.stop-word'));
    wb('B03-b', [{ kind: 'sub', text: 'Стоимость каждого этапа видна в смете', facts: [] }, T('h2', 'Как считаем'), T('text', 'Смета до начала работ.')]);
    check('«Стоимость каждого этапа» в sub - без copy.address-all', !lint('B03-b').findings.some(f => f.rule === 'copy.address-all'));
    // embellish: общая основа и близость к числу
    const R9 = compileLint(RULES, lb, {});
    const emb = (text, facts) => scanBlock({ block_id: 'B01-t', elements: [T('text', text, facts)] }, R9).findings.some(f => f.rule === 'fact.embellish');
    check('embellish: «Гарантируем результат 12 месяцев» при «Гарантия 12 месяцев» - не усиление (общая основа)', !emb('Гарантируем результат 12 месяцев.', ['F01']));
    check('embellish: «Запишитесь минимум за неделю до даты» - инструкция читателю, не усиление', !emb('Запишитесь минимум за неделю до даты.', ['F01']));
    check('embellish: «Гарантированный доход до 14% годовых» - по-прежнему усиление', emb('Гарантированный доход до 14% годовых.', ['F02']) && emb('Доходность до 14% годовых уже за вычетом расходов.', ['F02']));
  }

  // --- 9.6 Р5: повторы только с блоками выше при перепроверке страницы; состояние писателя по блокам выше
  {
    const Rp = mkProject('p3a-r5');
    const pdir = path.join(Rp, 'work', 'pages', 'p');
    const ids = ['B01-hero', 'B02-a', 'B03-b', 'B04-c', 'B05-d'];
    const lb = { slug: 'p', url: '/p', type: 'service', subject: 'Ремонт', company: 'Тест', geo: '', cta: { main: 'Получить смету' }, links: [], terminology: { use: [] },
      facts: ['F01', 'F02', 'F03', 'F04', 'F05'].map((id, i) => ({ id, label: `факт ${i + 1}`, value: `значение ${i + 1}`, wording: `Формулировка факта номер ${i + 1}`, kind: 'claim' })),
      blocks: ids.map((id, i) => ({ block_id: id, role: i ? 'conversion' : 'hero', cta_allowed: !i, facts: [`F0${i + 1}`], elements: [{ kind: i ? 'h2' : 'h1', count: '1', chars: { min: 0, max: 80 } }, { kind: 'text', count: '1', chars: { min: 0, max: 350 } }, ...(i ? [] : [{ kind: 'button', count: '1', chars: { min: 0, max: 30 } }])] })) };
    wj(path.join(pdir, 'brief.json'), lb);
    wj(path.join(Rp, 'work', 'sitemap.json'), { pages: [{ slug: 'p', url: '/p', type: 'service', status: 'briefed' }] });
    const TXT = ['Смета фиксируется в договоре до начала работ', 'Замер проводит инженер с лазерным дальномером', 'Материалы закупаем по оптовым ценам поставщика', 'Мусор вывозим каждый вечер после смены', 'Приемка идет по чек-листу из сорока пунктов'];
    const wb = (i, text) => wj(path.join(pdir, 'blocks', `${ids[i]}.json`), { block_id: ids[i], type: ids[i].slice(4), role: i ? 'conversion' : 'hero', elements: [{ kind: i ? 'h2' : 'h1', text: ['Смета без сюрпризов', 'Точный замер', 'Материалы', 'Чистота на объекте', 'Приемка работ'][i], facts: [] }, { kind: 'text', text: `${text}.`, facts: [`F0${i + 1}`] }, ...(i ? [] : [{ kind: 'button', text: 'Получить смету' }])], facts_used: [`F0${i + 1}`], objections_closed: [], summary: `блок ${i + 1} синтетики Р5`, handoff_note: `после блока ${i + 1}`, attempts: 1 });
    TXT.forEach((t, i) => wb(i, t));
    const lp = run(Rp, ['scripts/lint-page.mjs', 'p']);
    const lr = id => rj(path.join(Rp, 'work', 'audit', 'p', `lint-${id}.json`));
    check('Р5: исходная страница - все блоки pass', ids.every(id => lr(id).verdict === 'pass'), lp.out);
    // фраза первого экрана вставлена в B04 - перепроверка страницы: B01 остается pass, находка одна - у B04
    wb(3, `${TXT[3]}. ${TXT[0]}`);
    const lp2 = run(Rp, ['scripts/lint-page.mjs', 'p']);
    const page = rj(path.join(Rp, 'work', 'audit', 'p', 'lint-page.json'));
    check('Р5: lint-page - первый экран не переворачивается (pass), повтор только у нижнего блока B04', lr('B01-hero').verdict === 'pass' && lr('B04-c').findings.some(f => f.rule === 'phrase.repeat' && /B01-hero/.test(f.problem)) && !page.findings.some(f => f.block_id === 'B01-hero' && f.rule === 'phrase.repeat'), lp2.out);
    // отдельный запуск автора правки - в обе стороны: B01 видит повтор с B04 (B04 не pass - не участвует; делаем B04 pass)
    wj(path.join(Rp, 'work', 'audit', 'p', 'lint-B04-c.json'), { ...lr('B04-c'), verdict: 'pass' });
    run(Rp, ['scripts/lint.mjs', 'work/pages/p/blocks/B01-hero.json']);
    check('Р5: отдельный запуск (автор правки) - повтор в обе стороны', lr('B01-hero').findings.some(f => f.rule === 'phrase.repeat' && /B04-c/.test(f.problem)));
    wj(path.join(Rp, 'work', 'audit', 'p', 'lint-B04-c.json'), { ...lr('B04-c'), verdict: 'fix' });
    run(Rp, ['scripts/lint.mjs', 'work/pages/p/blocks/B01-hero.json']);
    check('Р5: блок, не прошедший линтер, в сравнении повторов не участвует', !lr('B01-hero').findings.some(f => f.rule === 'phrase.repeat'));
    // состояние писателя: B02 не прошел (повтор блока в середине), B03-B05 pass
    wb(3, TXT[3]);
    ['B01-hero', 'B03-b', 'B04-c', 'B05-d'].forEach(id => wj(path.join(Rp, 'work', 'audit', 'p', `lint-${id}.json`), { verdict: 'pass', findings: [] }));
    wj(path.join(Rp, 'work', 'audit', 'p', 'lint-B02-a.json'), { verdict: 'fix', findings: [] });
    const ps = run(Rp, ['scripts/page-state.mjs', 'p', 'B02-a']);
    const ws = rj(path.join(pdir, 'state.writer.json'));
    check('Р5: page-state для B02 - for_block, last_block B01, facts_used только выше (без фактов B03-B05)', ps.code === 0 && ws.for_block === 'B02-a' && ws.last_block.block_id === 'B01-hero' && JSON.stringify(Object.keys(ws.facts_used)) === '["F01"]' && ws.blocks_summary.length === 1, ps.out + JSON.stringify(ws));
    const ps2 = run(Rp, ['scripts/page-state.mjs', 'p']);
    check('Р5: page-state без блока - следующий по брифу непройденный (B02), state.json полный', /следующий: B02-a/.test(ps2.out) && rj(path.join(pdir, 'state.writer.json')).for_block === 'B02-a' && rj(path.join(pdir, 'state.json')).facts_used.length === 4, ps2.out);
    // последовательная запись: B02 попытан по текущему срезу и не прошел, B03 еще не писался - следующий B03
    fs.rmSync(path.join(pdir, 'blocks', 'B03-b.json'));
    const sha = briefSha(fs.readFileSync(path.join(pdir, 'brief.json'), 'utf8'));
    const b2 = rj(path.join(pdir, 'blocks', 'B02-a.json')); wj(path.join(pdir, 'blocks', 'B02-a.json'), { ...b2, brief_sha: sha, attempts: 1 });
    const ps3 = run(Rp, ['scripts/page-state.mjs', 'p']);
    const ws3 = rj(path.join(pdir, 'state.writer.json'));
    check('Р5: неудачный B02 (попытка по срезу) не держит очередь - следующий B03, его состояние без B02 и без блоков ниже', /следующий: B03-b/.test(ps3.out) && ws3.for_block === 'B03-b' && ws3.last_block.block_id === 'B01-hero' && !('F02' in ws3.facts_used) && !('F04' in ws3.facts_used), ps3.out + JSON.stringify(ws3));
    check('page-state: незнакомый блок - код 2', run(Rp, ['scripts/page-state.mjs', 'p', 'B09-x']).code === 2);
    // доделка №23: все блоки pass, аудит оставил state.writer.json без блока (for_block пуст, вся страница); ответы заказчика
    // перенесли B03 в _old. Писатель B03 перед чтением собирает состояние для себя: своего F03 и фактов ниже (F04, F05)
    // в facts_used нет, last_block - B02, а не последний блок страницы.
    wb(1, TXT[1]); wb(2, TXT[2]);
    ids.forEach(id => wj(path.join(Rp, 'work', 'audit', 'p', `lint-${id}.json`), { verdict: 'pass', findings: [] }));
    const ps4 = run(Rp, ['scripts/page-state.mjs', 'p']);
    const ws4 = rj(path.join(pdir, 'state.writer.json'));
    check('№23: после аудита (все pass) state.writer.json - на всю страницу (for_block пуст, last_block B05)', ps4.code === 0 && ws4.for_block === '' && ws4.last_block.block_id === 'B05-d' && 'F03' in ws4.facts_used, ps4.out + JSON.stringify(ws4));
    fs.mkdirSync(path.join(pdir, 'blocks', '_old'), { recursive: true });
    fs.renameSync(path.join(pdir, 'blocks', 'B03-b.json'), path.join(pdir, 'blocks', '_old', 'B03-b.json'));
    const ps5 = run(Rp, ['scripts/page-state.mjs', 'p', 'B03-b']);
    const ws5 = rj(path.join(pdir, 'state.writer.json'));
    check('№23: блок, открытый заново (B03 в _old), - состояние для него: без F03, F04, F05, last_block B02', ps5.code === 0 && ws5.for_block === 'B03-b' && ws5.last_block.block_id === 'B02-a' && JSON.stringify(Object.keys(ws5.facts_used).sort()) === '["F01","F02"]', ps5.out + JSON.stringify(ws5));
    const bw = fs.readFileSync(path.join(TPL, 'prompts', '05-block-writer.md'), 'utf8');
    check('№23: писатель блока до чтения собирает состояние для своего блока (page-state <slug> <block_id>, сверка for_block)', /До чтения выполни `node scripts\/page-state\.mjs <slug> <block_id>`/.test(bw) && /`for_block` не твой - запусти снова/.test(bw) && !/Нет среза или `state\.writer\.json`/.test(bw));
  }

  // --- 9.7 №24, повторная проверка: придаточные в единицах опор, парная подпись блока цифр, блок цифр без свежих
  // числовых фактов выпадает; прежние границы с достаточными опорами не меняются, сборка идемпотентна
  {
    // единицы опор: придаточное и причастный оборот - не пункт (факты Goldax F25, F23, F08), список - как раньше
    const u = t => factUnits({ wording: t });
    check('№24 factUnits: причастный оборот в середине - одна опора («размер кольца, заказанного у нас, скорректируем бесплатно»)', u('Размер помолвочного кольца, заказанного у нас, скорректируем бесплатно') === 1);
    check('№24 factUnits: «если ...» в начале и в конце - одна опора', u('Если толщину цепи сложно представить, за короткий срок сделаем образец в серебре') === 1 && u('Вывоз бесплатно, если демонтаж делаем мы') === 1);
    check('№24 factUnits: «при ...», «когда ...», «который ...» - не пункт', u('Вывоз бесплатно, при демонтаже нашими силами') === 1 && u('Замер в день заявки, когда мастер свободен') === 1 && u('Скидка для клиентов, которые заказывали раньше') === 1);
    check('№24 factUnits: предложная часть перед «где» - уточнение (F08: «у изделий, где работает вторая цена»)', u('Две цены в карточке: из металла мастерской и из металла заказчика, у изделий, где работает вторая цена') === 1);
    // прежнее утверждение «... замер в день заявки ...» === 2 (часть после условия - всегда продолжение) занижало список:
    // «вывоз бесплатно» - законченная часть, «замер в день заявки» - новый пункт (повторная проверка №24, остаток 2)
    check('№24 factUnits: часть после оборота продолжает только незаконченную часть («вывоз бесплатно, если ..., замер ...» - 3 пункта)', u('Вывоз бесплатно, если демонтаж делаем мы, замер в день заявки, договор до начала работ') === 3 && u('Вывоз бесплатно, если демонтаж делаем мы; замер в день заявки, договор до начала работ') === 3);
    check('№24 factUnits: список не меняется (причастие-определение «понравившаяся модель» - пункт, «при этом» - новый пункт, «;», «1,5»)', u('Фото, эскиз, понравившаяся модель или старое украшение, свое золото, описание идеи') === 5 && u('Гарантия 12 месяцев, при этом чистка бесплатно') === 2 && u('а; б, если в; г') === 3 && u('Толщина от 1,5 мм') === 1 && u('По Москве доставляет курьер, в другие города отправляем СДЭК') === 2 && u('Работаем с золотом, серебром, собственного сплава нет') === 3);
    check('№24 factUnits: опора - наибольшее из value и wording, минимум 1', factUnits({ value: 'если заказ от 5000', wording: 'Если заказ от 5000' }) === 1 && factUnits({ value: 'а, б, в', wording: 'а, если б' }) === 3);
    // повторная проверка №24: прилагательные на -нн- и субстантивированные причастия в списке - пункты; оговорка в начале
    // пункта пункт не снимает; причастный оборот в именительном, обособленный с двух сторон, - одна опора
    check('№24 factUnits: «студентам, учащимся, пенсионерам» и «пенсионерам, многодетным, военнослужащим» - 3', u('Скидка 10% студентам, учащимся, пенсионерам') === 3 && u('Скидки пенсионерам, многодетным, военнослужащим') === 3);
    check('№24 factUnits: прилагательные на -нн- - пункты («кухни, ванной комнаты, санузла», «кирпичных, бетонных, газобетонных», «оконных проемов»)', u('Делаем ремонт кухни, ванной комнаты, санузла') === 3 && u('Монтаж кирпичных, бетонных, газобетонных перегородок') === 3 && u('Остекление балконов, лоджий, оконных проемов') === 3 && u('Работаем со стеклом, деревянными, металлическими конструкциями') === 3);
    check('№24 factUnits: «постоянным клиентам скидка», «сезонных наценок нет» - пункты', u('Бесплатная доставка, постоянным клиентам скидка 5%') === 2 && u('Цена фиксируется в договоре, сезонных наценок нет') === 2);
    check('№24 factUnits: F30 анализа Goldax - 7 этапов («при необходимости образец» - этап)', u('Обсуждение, 3D-модель, согласование, при необходимости образец, производство, Пробирная палата, выдача') === 7 && u('Обсуждение, 3D-модель, согласование, образец из полимера по желанию, производство, Пробирная палата, выдача') === 7);
    check('№24 factUnits: оговорка в начале пункта - пункт («при необходимости привозим образцы», «если нужно - укорачиваем»), одна оговорка в конце - нет', u('Выезжаем на замер, при необходимости привозим образцы') === 2 && u('Ремонтируем цепочки, если нужно - укорачиваем') === 2 && u('Сделаем образец в серебре, если нужно') === 1 && u('Работаем с золотом, серебром, платиной, по желанию с палладием') === 4);
    check('№24 factUnits: причастный оборот в именительном, обособленный с двух сторон, - одна опора', u('Изделия, купленные у нас, чистим бесплатно') === 1 && u('Окна, установленные нашими монтажниками, обслуживаем 3 года бесплатно') === 1 && u('Кольцо, сделанное у нас, увеличим на размер бесплатно') === 1 && u('Изделия, не подлежащие обмену, принимаем в ремонт') === 1);
    check('№24 factUnits: оборот с зависимым словом в конце - не пункт («камень, подходящий по бюджету»), «который», «кроме», «учитывая»', u('Помогаем выбрать камень, подходящий по бюджету') === 1 && u('Мастер, который ведет заказ, всегда на связи') === 1 && u('Работаем ежедневно, кроме воскресенья') === 1 && u('Подбираем оправу, учитывая бюджет') === 1);
    check('№24 factUnits: «при ...» в начале предложения - пункт, после запятой - условие', u('При заказе от 3 изделий скидка 10%, от 5 изделий - 15%') === 2 && u('Выезд замерщика бесплатно, при заказе от 50 000 руб.') === 1);
    check('№24 factUnits: предлог, повторяющий предыдущую часть, перед «где» - пункт («в Москве, в Подмосковье, где ...»)', u('Работаем в Москве, в Подмосковье, где доставка бесплатна') === 2);
    check('№24 factUnits: часть после оборота не съедается, если часть до него закончена (глагол, « - »)', u('Не пирсинг-студия: продаем и изготавливаем украшения, куда их ставить, решает пирсер') === 2 && u('Материалы закупаем и привозим мы - они в смете отдельным разделом. Первый платеж - 20% от суммы, когда материал уже привезен к вам на участок, окончательный расчет - после приемки по акту') === 3);
    {
      const oldSplit = t => Math.max(1, String(t).split(/;|,(?!\d)/).filter(x => /[а-яёa-z]/i.test(x)).length);
      const probe = ['Гарантия 12 месяцев. Чистка бесплатно', 'Работаем с 2008 года. Более 10 мастеров, свой закрепщик', 'Скидка 10% студентам, учащимся, пенсионерам', 'Изделия, купленные у нас, чистим бесплатно', 'а; б, если в; г', 'Мясницкая ул., д. 24/7, стр. 1, подъезд 12а, вход со двора', 'г. Москва, ул. Ленина, д. 1'];
      check('№24 factUnits: опор не больше частей через «,» и «;» (точка между предложениями пункт не добавляет)', probe.every(t => u(t) <= oldSplit(t)) && u('Гарантия 12 месяцев. Чистка бесплатно') === 1 && u('Мясницкая ул., д. 24/7, стр. 1, подъезд 12а, вход со двора') === 5, JSON.stringify(probe.map(t => [u(t), oldSplit(t)])));
    }

    const Y = mkProject('n24-recheck');
    const YW = (...p) => path.join(Y, 'work', ...p);
    const mk = (pageFacts, over = {}, hero = ['F01', 'F08'], numsEls = null) => {
      const d = fixCta(base());
      d.facts.facts.push(
        { id: 'F12', label: 'объекты', value: '500 объектов', wording: '500 объектов', publish: 'yes', kind: 'number' },
        { id: 'F13', label: 'опыт', value: '15 лет', wording: '15 лет в ремонте', publish: 'yes', kind: 'number' },
        { id: 'F14', label: 'вывоз', value: 'вывоз бесплатно, если демонтаж делаем мы', wording: 'Вывоз мусора бесплатно, если демонтаж делаем мы', publish: 'yes', kind: 'claim' },
        { id: 'F15', label: 'предоплата', value: 'без предоплаты', wording: 'Без предоплаты', publish: 'yes', kind: 'claim' },
        { id: 'F16', label: 'размер', value: 'размер кольца, заказанного у нас, скорректируем бесплатно', wording: 'Размер кольца, заказанного у нас, скорректируем бесплатно', publish: 'yes', kind: 'claim' },
      );
      const nums = blk('numbers', 'conversion', 'numbers', numsEls ? numsEls.map(([k, c]) => el(k, c, 80)) : [el('h2', '0-1', 80), el('number', '3-4', 40), el('note', '3-4', 80), el('text', '0-1', 200)], { fact_kinds: ['number'] });
      const terms = blk('terms', 'conversion', 'list', [el('h2', '1', 80), el('bullets', '3-5', 120)]);
      const terms2 = blk('terms2', 'conversion', 'list', [el('h2', '1', 80), el('bullets', '3-5', 120)]);
      const mix = blk('mix', 'conversion', 'grid-3', [el('h2', '1', 80), el('card', '2-3', 200), el('number', '2', 40), el('note', '2', 80)], { fact_kinds: ['number'] });
      d.types.service = ptype('service', [B.hero, nums, terms, terms2, mix, B.cta]);
      d.strategy.pages.remont = entry(pageFacts, { hero_facts: hero, block_overrides: { terms: { facts: ['F14', 'F15'], task: 'Только эти пункты: вывоз и предоплата' }, terms2: { facts: ['F16', 'F04'], task: 'Только эти пункты: размер и гарантия' }, ...over }, cta: undefined });
      writeProject(Y, d);
      const r = run(Y, ['scripts/build-briefs.mjs', 'remont']);
      const rep = r.code === 0 ? rj(YW('briefs-report.json')) : { pages: { remont: {} }, questions: [], warnings: [] };
      const bl = r.code === 0 ? rj(YW('pages', 'remont', 'brief.json')).blocks : [];
      const cnt = (type, kind) => { const b = bl.find(x => x.type === type); const e = b && b.elements.find(x => x.kind === kind); return e ? e.count : null; };
      return { r, rep, bl, cnt, w: rep.warnings.join(' | ') };
    };
    // два свежих числовых факта (F01 и F08 у первого экрана): number 3-4 -> 2-4, парная note 3-4 -> 2-4
    const s2 = mk(['F01', 'F08', 'F12', 'F13', 'F04']);
    check('№24: блок цифр, 2 свежих числовых факта - number 2-4 и парная note 2-4, предупреждения count, вопроса нет', s2.r.code === 0 && s2.cnt('numbers', 'number') === '2-4' && s2.cnt('numbers', 'note') === '2-4' && /remont: B0\d-numbers: number 3-4 при опорах 2 -> 2-4/.test(s2.w) && /remont: B0\d-numbers: note 3-4 вместе с number -> 2-4/.test(s2.w) && !s2.rep.questions.some(q => /Блок numbers/.test(q.text)), s2.r.code ? s2.r.out.slice(0, 400) : s2.w);
    check('№24: в блоке цифр элементы с другой нижней границей не трогаются (h2 0-1, text 0-1)', s2.cnt('numbers', 'h2') === '0-1' && s2.cnt('numbers', 'text') === '0-1');
    check('№24: не блок цифр (есть карточки) - подпись к числу не прижимается вместе с number', s2.cnt('mix', 'note') === '2' && s2.cnt('mix', 'card') === '2-3', JSON.stringify(s2.bl.find(b => b.type === 'mix')));
    check('№24: «Только эти пункты» с условием через запятую - опор 2, bullets 3-5 -> 2-5 (F14 «..., если ...» + F15)', s2.cnt('terms', 'bullets') === '2-5' && /remont: B0\d-terms: bullets 3-5 при опорах 2 -> 2-5/.test(s2.w), s2.w);
    check('№24: «Только эти пункты» с причастным оборотом - опор 2, bullets 3-5 -> 2-5 (F16 + F04)', s2.cnt('terms2', 'bullets') === '2-5', JSON.stringify(s2.bl.find(b => b.type === 'terms2')));
    // идемпотентность: второй запуск на тех же данных - без изменений
    const s2b = run(Y, ['scripts/build-briefs.mjs', 'remont']);
    check('№24: повторная сборка брифа - без изменений', s2b.code === 0 && /брифов собрано: 0, без изменений: 1/.test(s2b.out), s2b.out.slice(-300));
    // один свежий: обе границы 1-4
    const s1 = mk(['F01', 'F08', 'F12', 'F04']);
    check('№24: блок цифр, 1 свежий числовой факт - number 1-4 и note 1-4', s1.r.code === 0 && s1.cnt('numbers', 'number') === '1-4' && s1.cnt('numbers', 'note') === '1-4', s1.r.code ? s1.r.out.slice(0, 400) : s1.w);
    // свежих нет: все числовые факты у первого экрана - блок выпадает, а не получает 0-4; факты есть - вопроса заказчику
    // нет (ни в брифах, ни в итоговом отчете: report.mjs спрашивает по dropped, выпадение по свежести - в dropped_repeat)
    const s0 = mk(['F01', 'F08', 'F04']);
    const s0p = s0.rep.pages.remont || {};
    check('№24: блок цифр без свежих числовых фактов (все у блоков выше) - выпал, причина в отчете (dropped_repeat), count 0-4 нет', s0.r.code === 0 && !s0.bl.some(b => b.type === 'numbers') && (s0p.dropped_repeat || []).some(x => x.block === 'numbers' && x.reason === 'нет свежих числовых фактов (все у блоков выше)'), s0.r.code ? s0.r.out.slice(0, 400) : JSON.stringify(s0p));
    check('№24: выпадение по свежести - без вопроса заказчику «Нужны факты» и без записи в dropped, предупреждение без «без фактов»', !(s0p.dropped || []).some(x => x.block === 'numbers') && !s0.rep.questions.some(q => /Блок numbers/.test(q.text)) && !(s0p.questions || []).length && /remont: выпали блоки цифр numbers: все их числовые факты у блоков выше \(вопроса заказчику нет\)/.test(s0.w) && !/без фактов выпали блоки numbers/.test(s0.w), JSON.stringify(s0p));
    {
      const rr = run(Y, ['scripts/report.mjs']);
      const md = rr.code === 0 ? fs.readFileSync(YW('output', 'report.md'), 'utf8') : '';
      check('№24: итоговый отчет не спрашивает заказчика о фактах блока цифр, выпавшего по свежести', rr.code === 0 && !/нет фактов для блока «numbers»|Нужны факты для блока «Блок numbers»/.test(md), rr.code ? rr.out.slice(0, 400) : md.slice(0, 400));
    }
    // явные факты стратега, все числовые - у первого экрана: повтор - решение стратега, блок остается (number от 1),
    // вопроса нет (прежнее «блок выпал» давало ложный вопрос «Нужны факты» при фактах в блоке - повторная проверка №24)
    const sx = mk(['F01', 'F08', 'F12', 'F04'], { numbers: { facts: ['F01', 'F08'], task: 'Цифры' } });
    const sxp = sx.rep.pages.remont || {};
    check('№24: явные факты блока цифр все у первого экрана - блок остается, number 3-4 -> 1-4, note -> 1-4, вопроса нет', sx.r.code === 0 && sx.cnt('numbers', 'number') === '1-4' && sx.cnt('numbers', 'note') === '1-4' && !(sxp.dropped || []).length && !(sxp.dropped_repeat || []).length && !sx.rep.questions.some(q => /Блок numbers/.test(q.text)) && /remont: B0\d-numbers: number 3-4 при опорах 1 -> 1-4/.test(sx.w), sx.r.code ? sx.r.out.slice(0, 400) : JSON.stringify(sxp));
    // прижим подписей блока цифр: все элементы без своих опор с нижней границей выше новой границы number (а не только
    // с равной); элементы 0-x не трогаются (h2 вне первого экрана - 0-1 по программе 05.10 §3.4, остаток правила 3
    // редакционного стандарта); элементы с опорами (карточки, плашки) держат свою границу
    const sd2 = mk(['F01', 'F08', 'F12', 'F04'], {}, undefined, [['h2', '1'], ['number', '3-4'], ['note', '2-4'], ['text', '0-1']]);
    check('№24: number 3-4 -> 1-4, подпись note 2-4 (граница ниже, чем у number, но выше новой) -> 1-4', sd2.r.code === 0 && sd2.cnt('numbers', 'number') === '1-4' && sd2.cnt('numbers', 'note') === '1-4' && sd2.cnt('numbers', 'h2') === '0-1' && sd2.cnt('numbers', 'text') === '0-1' && /note 2-4 вместе с number -> 1-4/.test(sd2.w), sd2.r.code ? sd2.r.out.slice(0, 400) : sd2.w);
    const sd3 = mk(['F01', 'F08', 'F12', 'F04'], {}, undefined, [['h2', '0-1'], ['number', '2-4'], ['note', '3-4'], ['h3', '2-4']]);
    check('№24: number 2-4 -> 1-4, подписи note 3-4 и h3 2-4 (выше number) -> 1-4', sd3.r.code === 0 && sd3.cnt('numbers', 'number') === '1-4' && sd3.cnt('numbers', 'note') === '1-4' && sd3.cnt('numbers', 'h3') === '1-4', sd3.r.code ? sd3.r.out.slice(0, 400) : sd3.w);
    // карточки в блоке цифр (pattern numbers): своя граница по опорам блока (2 единицы: F08 + F12), не ниже 2, от порядка
    // элементов не зависит; плашки с тремя своими опорами (F08, F12, F13) остаются 3-5
    const sc1 = mk(['F01', 'F08', 'F12', 'F04'], { numbers: { facts: ['F08', 'F12'], task: 'Цифры' } }, undefined, [['h2', '1'], ['number', '3-4'], ['card', '3-4']]);
    const sc2 = mk(['F01', 'F08', 'F12', 'F04'], { numbers: { facts: ['F08', 'F12'], task: 'Цифры' } }, undefined, [['h2', '1'], ['card', '3-4'], ['number', '3-4']]);
    check('№24: карточки блока цифр - 2-4 при number 1-4, порядок элементов не меняет итог', sc1.r.code === 0 && sc2.r.code === 0 && sc1.cnt('numbers', 'card') === '2-4' && sc2.cnt('numbers', 'card') === '2-4' && sc1.cnt('numbers', 'number') === '1-4' && sc2.cnt('numbers', 'number') === '1-4', `${sc1.w} || ${sc2.w}`);
    const sbd = mk(['F01', 'F08', 'F12', 'F13', 'F04'], { numbers: { facts: ['F01', 'F08', 'F12', 'F13'], task: 'Цифры' } }, ['F01', 'F08', 'F12'], [['h2', '1'], ['number', '3-4'], ['note', '3-4'], ['badges', '3-5']]);
    check('№24: плашки со своими опорами (4 единицы) не прижимаются вместе с number; number и note -> 1-4', sbd.r.code === 0 && sbd.cnt('numbers', 'badges') === '3-5' && sbd.cnt('numbers', 'number') === '1-4' && sbd.cnt('numbers', 'note') === '1-4' && !/badges 3-5 вместе с number/.test(sbd.w), sbd.r.code ? sbd.r.out.slice(0, 400) : sbd.w);
    // прежнее: явный факт блока цифр свежий - блок остается; без числовых фактов - «нет числовых фактов»
    const sk = mk(['F01', 'F08', 'F12', 'F04'], { numbers: { facts: ['F08', 'F12'], task: 'Цифры' } });
    check('№24: явные факты блока цифр, один свежий - блок остается, number 1-4', sk.r.code === 0 && sk.cnt('numbers', 'number') === '1-4' && sk.cnt('numbers', 'note') === '1-4', sk.r.code ? sk.r.out.slice(0, 400) : sk.w);
    const sn = mk(['F04', 'F05'], {}, ['F04']);
    check('№24: блок цифр совсем без числовых фактов - по-прежнему «нет числовых фактов»', sn.r.code === 0 && (sn.rep.pages.remont.dropped || []).some(x => x.block === 'numbers' && x.reason === 'нет числовых фактов'), sn.r.code ? sn.r.out.slice(0, 400) : JSON.stringify(sn.rep.pages.remont));
  }
} catch (e) {
  fail++; failures.push(`FAIL исключение: ${e.stack || e.message}`);
} finally {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
}

failures.forEach(f => console.log(f));
console.log(`cases-briefs: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
