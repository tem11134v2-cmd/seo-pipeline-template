// Каталог фазы 7 kit /site-tekst: схемы catalog-spec и sample-items, скрипт md-to-docx, воркфлоу wf-07-catalog,
// промты каталога. Запуск:
//   node .claude/tests/site-tekst/cases-catalog.mjs      код выхода 0 - все прошли (или через run.mjs рядом).
// Все во временной папке (os.tmpdir()), без сети и без данных клиентов. docx и marked скрипт находит через
// kit/scripts/deps.mjs: тест выставляет SITE_TEKST_NODE_MODULES в node_modules шаблона (require.resolve от этого файла).
// Разделы: 1. схема sample-items (товары сайта, карточка "*", отказы); 2. схема catalog-spec (values_source, range,
// старые данные, K6: categories, values_by_category, labels, field); 3. md-to-docx (таблица с ширинами в
// word/document.xml, имя без точек, house style, <br>, сущности, нумерация после абзаца, блок HTML, --check: разделы и
// служебные ссылки, коды выхода); 4. wf-07-catalog с подставными agent (проверки спецификации и ТЗ скриптом и
// исключения, шаг примеров параллельно ТЗ и его отказ, второй круг и статусы находок K12); 5. промты (п.18-20, K7).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { validate } from '../../skills/site-tekst/kit/scripts/lib.mjs';

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
function run(cwd, args, env = {}) {
  const r = spawnSync(process.execPath, args, { cwd, encoding: 'utf8', env: { ...process.env, ...env } });
  return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '', out: (r.stdout || '') + (r.stderr || '') };
}
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cases-catalog-'));
function mkProject(name) {
  const dir = path.join(tmpRoot, name);
  for (const d of ['scripts', 'schemas']) fs.cpSync(path.join(TPL, d), path.join(dir, d), { recursive: true });
  return dir;
}
// node_modules шаблона: от этого файла вверх, как у проекта
function templateNodeModules() {
  try {
    const p = createRequire(import.meta.url).resolve('docx');
    const i = p.lastIndexOf('node_modules');
    return i < 0 ? '' : p.slice(0, i + 'node_modules'.length);
  } catch { return ''; }
}
// чтение файла из zip (docx) по центральному каталогу: без сторонних пакетов
function zipEntry(buf, name) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) return null;
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let k = 0; k < count; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) return null;
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28), elen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const entry = buf.toString('utf8', p + 46, p + 46 + nlen);
    if (entry === name) {
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const data = buf.subarray(start, start + csize);
      return (method === 8 ? zlib.inflateRawSync(data) : data).toString('utf8');
    }
    p += 46 + nlen + elen + clen;
  }
  return null;
}
const YO = /[\u0451\u0401]/, DASH = /[\u2014\u2013]/;

// ---------- данные ----------
const siteItem = (key, slug, extra = {}) => ({
  key, category_slug: slug, source: 'site', name: `Позиция ${key}`, price: 12500, price_note: 'от',
  attributes: [{ label: 'Материал', value: 'Сталь' }, { label: 'Размер', value: '40 x 60' }],
  facets: { 'Материал': ['Сталь'], 'Цена': ['12500'] },
  images: [`work/catalog/samples/${key}-1.jpg`], source_url: `https://old.example/catalog/${slug}/${key}`,
  taken_at: '2026-09-27', why: 'самый полный из 4 кандидатов', ...extra,
});
const starItem = { key: 'sample-all', category_slug: '*', source: 'illustrative', name: 'Позиция каталога - пример',
  attributes: [{ label: 'Материал', value: 'Сталь' }], facets: { 'Материал': ['Сталь'] }, images: [], why: 'значения фильтров catalog-spec' };
const MIXED = { generated_at: '2026-09-27 12:00', items: [siteItem('p1', 'cat-a'), siteItem('p2', 'cat-b', { images: ['work/catalog/samples/p2-1.webp', 'work/catalog/samples/p2-2.png'] }), starItem] };
const ILLUSTRATIVE = { generated_at: '2026-09-27 12:00', items: [starItem] };
const SPEC = {
  generated_at: '2026-09-27', entities: [{ name: 'позиция', url_pattern: '/catalog/{slug}', page_type: 'product' }],
  listing: { layout: 'сетка', cards_per_page: 12, pagination: 'номера страниц' },
  card_fields: [{ name: 'Название', type: 'text', required: true, source: 'анализ' }, { name: 'Цена', type: 'money', required: true, source: 'конкурент a.example' }, { name: 'Фото', type: 'image', required: true, source: 'конкурент a.example' }],
  filters: [
    { name: 'Материал', type: 'multiselect', values: ['Сталь', 'Дерево'], values_source: 'analysis', source: 'анализ: позиции' },
    { name: 'Покрытие', type: 'select', values: ['Матовое'], values_source: 'competitor', source: 'конкурент a.example' },
    { name: 'Серия', type: 'select', values: [], values_source: 'market_gap', source: 'дыра рынка' },
    { name: 'Цена', type: 'range', min: 1000, max: 90000, step: 500, values_source: 'fact', source: 'F12' },
    { name: 'Поиск', type: 'search', source: 'конкуренты' },
  ],
  sorting: ['по цене'], states: [{ state: 'нет цены', behavior: 'по запросу' }], card_cta: { main: 'Оставить заявку', secondary: 'Подробнее' },
  sources: [{ domain: 'a.example', url: 'https://a.example/catalog' }],
};

try {
  // ================================================================== 1. схема sample-items
  {
    const e1 = schemaErrors('sample-items', MIXED);
    check('sample-items: товары сайта и карточка "*" в одном файле проходят схему', !e1.length, e1.join('; '));
    const e2 = schemaErrors('sample-items', ILLUSTRATIVE);
    check('sample-items: одна карточка "*" (illustrative, images []) проходит схему', !e2.length, e2.join('; '));
    const bad = (label, mut, re) => {
      const d = clone(MIXED); mut(d);
      const e = schemaErrors('sample-items', d);
      check(`sample-items: отказ - ${label}`, e.length && (!re || e.some(x => re.test(x))), e.join('; ') || 'ошибок нет');
    };
    bad('верхнеуровневый mode (заменен полем source у элемента)', d => { d.mode = 'from_site'; }, /лишнее поле "mode"/);
    bad('значение facets строкой, а не массивом', d => { d.items[0].facets['Материал'] = 'Сталь'; }, /facets/);
    bad('source вне списка', d => { d.items[0].source = 'from_site'; }, /source/);
    bad('фото вне work/catalog/samples/', d => { d.items[0].images = ['https://old.example/img/p1.jpg']; }, /images/);
    bad('точки в имени файла фото', d => { d.items[0].images = ['work/catalog/samples/p1.v2.jpg']; }, /images/);
    bad('больше 2 фото у товара', d => { d.items[1].images.push('work/catalog/samples/p2-3.jpg'); }, /images/);
    bad('цена строкой', d => { d.items[0].price = '12 500 руб.'; }, /price/);
    bad('category_slug не slug и не "*"', d => { d.items[0].category_slug = 'Кат А'; }, /category_slug/);
    bad('category_slug null', d => { d.items[2].category_slug = null; }, /category_slug/);
    bad('нет images', d => { delete d.items[0].images; }, /images/);
    bad('ключ с пробелом', d => { d.items[0].key = 'p 1'; }, /key/);
    bad('пустой список items', d => { d.items = []; }, /items/);
    bad('лишнее поле товара (описание не берется)', d => { d.items[0].description = 'текст с сайта'; }, /лишнее поле "description"/);

    // CLI validate.mjs, как в промте 07-sample-items
    const P = mkProject('validate');
    wj(path.join(P, 'work', 'catalog', 'sample-items.json'), MIXED);
    const ok = run(P, ['scripts/validate.mjs', 'sample-items', 'work/catalog/sample-items.json']);
    check('validate.mjs sample-items: хороший файл - код 0', ok.code === 0 && /^OK /m.test(ok.stdout), ok.out);
    const broken = clone(MIXED); broken.items[0].facets['Материал'] = 'Сталь';
    wj(path.join(P, 'work', 'catalog', 'broken.json'), broken);
    const ko = run(P, ['scripts/validate.mjs', 'sample-items', 'work/catalog/broken.json']);
    check('validate.mjs sample-items: плохой файл - код 1', ko.code === 1 && /FAIL/.test(ko.stdout), ko.out);
  }

  // ================================================================== 2. схема catalog-spec
  {
    const e1 = schemaErrors('catalog-spec', SPEC);
    check('catalog-spec: values_source и min/max/step у range проходят схему', !e1.length, e1.join('; '));
    const old = clone(SPEC);
    for (const f of old.filters) { delete f.values_source; delete f.min; delete f.max; delete f.step; }
    const e2 = schemaErrors('catalog-spec', old);
    check('catalog-spec: старые данные без values_source проходят схему', !e2.length, e2.join('; '));
    const b1 = clone(SPEC); b1.filters[0].values_source = 'client_site';
    check('catalog-spec: values_source вне списка - ошибка', schemaErrors('catalog-spec', b1).some(e => /values_source/.test(e)));
    const b2 = clone(SPEC); b2.filters[3].min = 'от 1000';
    check('catalog-spec: min строкой - ошибка', schemaErrors('catalog-spec', b2).some(e => /min/.test(e)));
    const b3 = clone(SPEC); b3.card_cta = { main: { main: 'Купить', action: 'lead' } };
    check('catalog-spec: card_cta.main объектом CTA - ошибка (берется .main)', schemaErrors('catalog-spec', b3).some(e => /card_cta\.main/.test(e)));
    // K6 (п.18, 19): область фильтра по листингам, значения по веткам, подписи чипов писателя, фильтр цены по полю price
    const k6 = clone(SPEC);
    k6.filters[0].categories = ['cat-a', 'cat-b'];
    k6.filters[1].values_by_category = { 'cat-a': ['Матовое'], 'cat-b': ['Глянец', 'Матовое'] };
    k6.filters[0].labels = ['Материал корпуса', 'Из чего сделано'];
    k6.filters[3].field = 'price'; k6.filters[3].name = 'Стоимость';
    k6.filters.push({ name: 'Покрытие', type: 'select', values: ['Лак'], categories: ['cat-c'], source: 'анализ' });
    const e3 = schemaErrors('catalog-spec', k6);
    check('catalog-spec K6: categories, values_by_category, labels, field: "price" и повтор имени с другой областью проходят схему', !e3.length, e3.join('; '));
    const k6bad = (label, mut, re) => { const d = clone(k6); mut(d); const e = schemaErrors('catalog-spec', d); check(`catalog-spec K6: отказ - ${label}`, e.some(x => re.test(x)), e.join('; ') || 'ошибок нет'); };
    k6bad('categories строкой', d => { d.filters[0].categories = 'cat-a'; }, /categories/);
    k6bad('slug в categories не slug (URL)', d => { d.filters[0].categories = ['/catalog/cat-a']; }, /categories\[0\]/);
    k6bad('значения ветки строкой', d => { d.filters[1].values_by_category['cat-a'] = 'Матовое'; }, /values_by_category\.cat-a/);
    k6bad('labels строкой', d => { d.filters[0].labels = 'Материал корпуса'; }, /labels/);
    k6bad('пустая подпись в labels', d => { d.filters[0].labels = ['']; }, /labels\[0\]/);
    k6bad('field не price', d => { d.filters[3].field = 'cost'; }, /field/);
  }

  // ================================================================== 3. md-to-docx
  {
    const NM = templateNodeModules();
    check('node_modules шаблона с docx найден (npm install в корне шаблона)', !!NM && fs.existsSync(path.join(NM, 'marked')), NM || 'require.resolve(docx) не нашел');
    const P = mkProject('docx');
    const env = { SITE_TEKST_NODE_MODULES: NM };
    const md = [
      '# ТЗ на каталог', '',
      '## 1. Назначение', '',
      'Позиции ведет контент-менеджер, буква \u0451 и тире \u2014 нормализуются.', '',
      '| Поле | Тип | Обязательное | Откуда значения |', '|---|---|---|---|',
      '| Название позиции | text | да | анализ: раздел позиций и карточек |', '| Цена | money | нет | конкурент |', '',
      '## 2. Фильтры', '',
      '| Фильтр | Тип |', '|---|---|', '| Материал | multiselect |', '',
      '- первый', '  - второй', '    - третий', '      - четвертый', '',
    ].join('\n');
    wt(path.join(P, 'work', 'catalog', 'tz.md'), md);
    const r = run(P, ['scripts/md-to-docx.mjs', 'work/catalog/tz.md', 'work/catalog/tz.docx', 'ТЗ на каталог - ООО Пример.ру v1.2'], env);
    let out = null; try { out = JSON.parse(r.stdout.trim().split('\n').pop()); } catch { /* ниже */ }
    check('md-to-docx: код 0 и JSON в выводе (docx найден через SITE_TEKST_NODE_MODULES, не SKIP)', r.code === 0 && out, r.out);
    const docxFile = path.join(P, 'work', 'catalog', 'tz.docx');
    check('md-to-docx: файл docx записан', fs.existsSync(docxFile) && fs.statSync(docxFile).size > 1000);
    if (out) {
      check('md-to-docx: drive_name без точек', out.drive_name === 'ТЗ на каталог - ООО Пример ру v1 2' && !out.drive_name.includes('.'), out.drive_name);
      check('md-to-docx: счетчики заголовков и таблиц для сверки публикации', out.headings === 3 && out.tables === 2 && out.title_added === false, JSON.stringify(out));
    }
    if (fs.existsSync(docxFile)) {
      const buf = fs.readFileSync(docxFile);
      const xml = zipEntry(buf, 'word/document.xml') || '';
      check('docx: word/document.xml читается', xml.includes('<w:body>'), xml.slice(0, 200));
      const grids = [...xml.matchAll(/<w:tblGrid>([\s\S]*?)<\/w:tblGrid>/g)].map(m => [...m[1].matchAll(/<w:gridCol w:w="(\d+)"/g)].map(x => Number(x[1])));
      check('docx: у каждой таблицы tblGrid с колонкой на каждый столбец', grids.length === 2 && grids[0].length === 4 && grids[1].length === 2, JSON.stringify(grids));
      check('docx: ширины tblGrid в сумме - ширина текста A4 с полями 2 см (9638)', grids.length === 2 && grids.every(g => g.reduce((s, w) => s + w, 0) === 9638), JSON.stringify(grids));
      check('docx: ширины колонок разные (по содержимому), не равные доли', grids[0] && new Set(grids[0]).size > 1, JSON.stringify(grids[0]));
      const tc = [...xml.matchAll(/<w:tcW w:type="(\w+)" w:w="(\d+)"\/>|<w:tcW w:w="(\d+)" w:type="(\w+)"\/>/g)].map(m => ({ type: m[1] || m[4], w: Number(m[2] || m[3]) }));
      check('docx: ширины ячеек заданы в dxa и совпадают с tblGrid первой таблицы', tc.length >= 4 && tc.every(c => c.type === 'dxa') && grids[0] && tc.slice(0, 4).every((c, i) => c.w === grids[0][i]), JSON.stringify(tc.slice(0, 6)));
      check('docx: раскладка таблиц фиксированная', /<w:tblLayout w:type="fixed"\/>/.test(xml));
      check('docx: house style - нет буквы «е с точками» и длинных тире, текст на месте', !YO.test(xml) && !DASH.test(xml) && /буква е и тире - нормализуются/.test(xml), (xml.match(/[^<>]{0,40}нормализ[^<>]{0,20}/) || [''])[0]);
      const core = zipEntry(buf, 'docProps/core.xml') || '';
      check('docx: автор нейтральный (без бренда проекта)', /<dc:creator>SEO pipeline<\/dc:creator>/.test(core), core.slice(0, 300));
      const numbering = zipEntry(buf, 'word/numbering.xml') || '';
      check('docx: маркер 4 уровня - дефис, без среднего тире', /<w:lvlText w:val="-"\/>/.test(numbering) && !DASH.test(numbering));
    }
    // без H1 - заголовок документа добавляется, счет заголовков md не меняется
    wt(path.join(P, 'work', 'catalog', 'noh1.md'), '## Раздел\n\nТекст.\n');
    const r2 = run(P, ['scripts/md-to-docx.mjs', 'work/catalog/noh1.md', 'work/catalog/noh1.docx', 'Документ'], env);
    let o2 = null; try { o2 = JSON.parse(r2.stdout.trim()); } catch { /* ниже */ }
    const x2 = fs.existsSync(path.join(P, 'work', 'catalog', 'noh1.docx')) ? zipEntry(fs.readFileSync(path.join(P, 'work', 'catalog', 'noh1.docx')), 'word/document.xml') || '' : '';
    check('md-to-docx: md без H1 - абзац Title с заголовком, title_added и headings по md', o2 && o2.title_added === true && o2.headings === 1 && /<w:pStyle w:val="Title"\/>[\s\S]*Документ/.test(x2), r2.out);
    // мелочь «md-to-docx»: <br> в ячейке - перенос строки, HTML-сущности декодируются (house style после них), список,
    // прерванный абзацем, продолжает номер «3.», блок HTML - текст без тегов и комментариев
    const edge = [
      '# Край', '',
      '| Статус | Пример |', '|---|---|',
      '| В наличии<br>Под заказ<br/>Снято | от 1&nbsp;000 &laquo;руб&raquo; &#8470;&#x20;5 &mdash; A&amp;B &hellip; &#1105; |', '',
      '1. Первый', '2. Второй', '', 'Абзац между пунктами.', '', '3. Третий', '4. Четвертый', '',
      '<!-- служебная пометка -->', '', '<div>Строка один<br>строка &laquo;два&raquo;</div>', '',
    ].join('\n');
    wt(path.join(P, 'work', 'catalog', 'edge.md'), edge);
    const re = run(P, ['scripts/md-to-docx.mjs', 'work/catalog/edge.md', 'work/catalog/edge.docx', 'Край'], env);
    const eb = re.code === 0 && fs.existsSync(path.join(P, 'work', 'catalog', 'edge.docx')) ? fs.readFileSync(path.join(P, 'work', 'catalog', 'edge.docx')) : null;
    const ex = eb ? zipEntry(eb, 'word/document.xml') || '' : '';
    const en = eb ? zipEntry(eb, 'word/numbering.xml') || '' : '';
    check('md-to-docx: крайние случаи md - код 0', re.code === 0 && !!ex, re.out);
    check('md-to-docx: теги <br>, <div> и сущности не выводятся текстом', ex && !/&lt;\/?(br|div)|&amp;(nbsp|laquo|raquo|mdash|hellip|#)/.test(ex), (ex.match(/[^>]{0,30}&(lt|amp);[^<]{0,30}/) || [''])[0]);
    const cellXml = (ex.match(/<w:tc>(?:(?!<\/w:tc>)[\s\S])*В наличии[\s\S]*?<\/w:tc>/) || [''])[0];
    check('md-to-docx: <br> в ячейке таблицы - два переноса строки внутри ячейки', (cellXml.match(/<w:br\/>/g) || []).length === 2 && /Под заказ/.test(cellXml) && /Снято/.test(cellXml), cellXml.slice(0, 400));
    check('md-to-docx: сущности декодированы (nbsp, елочки, номер, числовые), &mdash; -> дефис, «е с точками» -> е', ex.includes('от 1 000 «руб» № 5 - A&amp;B … е') && !YO.test(ex) && !DASH.test(ex), (ex.match(/от 1[^<]{0,40}/) || [''])[0]);
    const numIdOf = word => ((ex.match(new RegExp(`<w:p>(?:(?!</w:p>)[\\s\\S])*<w:numId w:val="(\\d+)"/>(?:(?!</w:p>)[\\s\\S])*${word}`)) || [])[1]);
    const startOf = id => ((en.match(new RegExp(`<w:num w:numId="${id}">[\\s\\S]*?<w:startOverride w:val="(\\d+)"/>`)) || [])[1]);
    check('md-to-docx: список после абзаца начинается с 3 (как в md), первый - с 1', startOf(numIdOf('Третий')) === '3' && startOf(numIdOf('Первый')) === '1' && numIdOf('Третий') === numIdOf('Четвертый'), `${numIdOf('Первый')}:${startOf(numIdOf('Первый'))} ${numIdOf('Третий')}:${startOf(numIdOf('Третий'))}`);
    check('md-to-docx: блок HTML - строки без тегов с переносом, комментарий не выводится', /Строка один<\/w:t>[\s\S]{0,200}<w:br\/>[\s\S]{0,200}строка «два»/.test(ex) && !/служебная пометка/.test(ex), (ex.match(/Строка один[\s\S]{0,300}/) || [''])[0]);
    // --check: разделы ТЗ и служебные ссылки конвейера, без пакетов docx и marked
    const noNm = { ...process.env }; delete noNm.SITE_TEKST_NODE_MODULES;
    const chk = (file, extraEnv) => { const r = spawnSync(process.execPath, ['scripts/md-to-docx.mjs', '--check', file], { cwd: P, encoding: 'utf8', env: extraEnv || noNm }); let o = null; try { o = JSON.parse((r.stdout || '').trim()); } catch { /* ниже */ } return { code: r.status, o, out: (r.stdout || '') + (r.stderr || '') }; };
    const c1 = chk('work/catalog/tz.md');
    check('md-to-docx --check: разделы ТЗ по «## N.» и список недостающих, код 0 без пакетов', c1.code === 0 && c1.o && JSON.stringify(c1.o.sections) === '[1,2]' && JSON.stringify(c1.o.missing) === '[3,4,5,6,7,8]' && c1.o.internal_refs === 0, c1.out);
    wt(path.join(P, 'work', 'catalog', 'refs.md'), '## 3. Листинг\n\nЦена (F08) в блоке B02-listing, запрет A04, файл inputs/items.csv, решение §8 в rules/decisions.md, находка CT-04, сегмент S1, пробел g3, решение d3.\n');
    const c2 = chk('work/catalog/refs.md');
    const wantRefs = ['F08', 'B02-listing', 'A04', 'inputs/items.csv', '§8', 'rules/decisions.md', 'CT-04', 'S1', 'g3', 'd3'];
    check('md-to-docx --check: служебные ссылки конвейера находятся все', c2.code === 0 && c2.o && wantRefs.every(x => c2.o.refs.includes(x)), c2.o ? c2.o.refs.join(', ') : c2.out);
    wt(path.join(P, 'work', 'catalog', 'clean.md'), '## 7. Роли и процесс наполнения\n\nФайл данных - items.csv или items.xlsx, колонки: Название, Цена, Фото. Бланк A4, модель X100, цена от 1 000 руб.\n');
    const c3 = chk('work/catalog/clean.md');
    check('md-to-docx --check: чистый текст для разработчика - 0 ссылок (имя файла данных, A4, модель - не ссылки)', c3.code === 0 && c3.o && c3.o.internal_refs === 0, c3.o ? c3.o.refs.join(', ') : c3.out);
    wt(path.join(P, 'work', 'catalog', 'empty.md'), ' \n\n');
    const c4 = chk('work/catalog/empty.md'), c5 = chk('work/catalog/none.md');
    check('md-to-docx --check: пустой файл - код 3, нет файла - код 2', c4.code === 3 && c5.code === 2 && /нет файла/.test(c5.out), `${c4.code} ${c5.code}`);
    // коды выхода
    const u1 = run(P, ['scripts/md-to-docx.mjs'], env);
    const u2 = run(P, ['scripts/md-to-docx.mjs', 'work/catalog/nope.md', 'work/catalog/x.docx'], env);
    const u3 = run(P, ['scripts/md-to-docx.mjs', 'work/catalog/tz.md', 'work/catalog/tz.pdf'], env);
    check('md-to-docx: без аргументов, без входа, выход не .docx - код 2', u1.code === 2 && u2.code === 2 && /нет файла/.test(u2.stderr) && u3.code === 2, `${u1.code} ${u2.code} ${u3.code}`);
    // без переменной: пакеты находятся подъемом по папкам или честный отказ с подсказкой
    const noEnv = { ...process.env }; delete noEnv.SITE_TEKST_NODE_MODULES;
    const r3 = spawnSync(process.execPath, ['scripts/md-to-docx.mjs', 'work/catalog/tz.md', 'work/catalog/tz2.docx'], { cwd: P, encoding: 'utf8', env: noEnv });
    check('md-to-docx без SITE_TEKST_NODE_MODULES: код 0 или код 1 с подсказкой npm install', r3.status === 0 || (r3.status === 1 && /npm install/.test(r3.stderr)), `${r3.status}: ${r3.stderr}`);
  }

  // ================================================================== 4. wf-07-catalog с подставными agent
  {
    const src = fs.readFileSync(path.join(TPL, 'workflows', 'wf-07-catalog.js'), 'utf8');
    const AsyncFunction = (async () => {}).constructor;
    const compile = () => new AsyncFunction('args', 'agent', 'parallel', 'pipeline', 'phase', 'log', 'workflow', 'budget', src.replace(/^export const meta\s*=/m, 'const meta ='));
    // reply: { label: ответ | (prompt, opts) => ответ } - ответ подставного агента по label; по умолчанию аудитор - без
    // находок, run-агент - ok, остальные - ok с summary
    async function runWf(args, failLabel = '', reply = {}) {
      const calls = [];
      const agent = (prompt, opts = {}) => {
        calls.push({ label: opts.label, model: opts.model, prompt, schema: opts.schema });
        if (opts.label === failLabel) return Promise.reject(new Error('сеть недоступна'));
        if (opts.label in reply) { const r = reply[opts.label]; return Promise.resolve(typeof r === 'function' ? r(prompt, opts) : r); }
        const props = (opts.schema && opts.schema.properties) || {};
        if (props.findings) return Promise.resolve({ findings: [], verdict: 'pass', summary: 'ok' });
        if (props.tail) return Promise.resolve({ ok: true, exit_code: 0, tail: 'OK' });
        return Promise.resolve({ ok: true, summary: `{"label":"${opts.label}"}` });
      };
      const parallel = thunks => Promise.all(thunks.map(t => t()));
      const result = await compile()({ root: '/fake/root', ...args }, agent, parallel, null, () => {}, () => {}, null, null);
      return { calls, result };
    }
    let threw = '';
    const a = await runWf({ model: 'S', model_light: 'L' }).catch(e => { threw = e.message; return { calls: [], result: null }; });
    const labels = a.calls.map(c => c.label);
    check('wf-07: прогон по умолчанию без исключений', !threw, threw);
    // порядок: проверка спецификации скриптом до примеров и ТЗ, проверка ТЗ до аудитора (мелочь «сбой спецификации
    // проходит молча»); прежний порядок был catalog-spec,sample-items,tz-write,tz-audit-1,tz-publish
    check('wf-07: check:spec после спецификации, sample-items до ТЗ, check:tz до аудита', labels.join(',') === 'catalog-spec,check:spec,sample-items,tz-write,check:tz,tz-audit-1,tz-publish', labels.join(','));
    const cs = a.calls.find(c => c.label === 'check:spec'), ct = a.calls.find(c => c.label === 'check:tz');
    check('wf-07: проверки - run-агенты (model_light) командами validate.mjs catalog-spec и md-to-docx.mjs --check', cs && ct && cs.model === 'L' && ct.model === 'L' && /node scripts\/validate\.mjs catalog-spec work\/catalog\/catalog-spec\.json/.test(cs.prompt) && /node scripts\/md-to-docx\.mjs --check work\/catalog\/tz\.md/.test(ct.prompt), `${cs && cs.model} ${ct && ct.model}`);
    // мелочь: сбой спецификации или ТЗ - ошибка фазы, а не молчаливое продолжение
    const failRun = async (reply, label) => { let err = ''; const r = await runWf({}, '', reply).catch(e => { err = e.message; return null; }); return { err, r }; };
    const f1 = await failRun({ 'catalog-spec': { ok: false, summary: 'нет sitemap' } });
    check('wf-07: спецификация ok=false - исключение, ТЗ не пишется', /спецификация каталога не собрана.*нет sitemap/.test(f1.err), f1.err || 'нет исключения');
    const f2 = await failRun({ 'check:spec': { ok: false, exit_code: 2, tail: 'нет файла work/catalog/catalog-spec.json' } });
    check('wf-07: нет catalog-spec.json (проверка скриптом) - исключение с хвостом вывода', /нет work\/catalog\/catalog-spec\.json или он не проходит схему: нет файла/.test(f2.err), f2.err || 'нет исключения');
    const f3 = await failRun({ 'check:tz': { ok: false, exit_code: 3, tail: 'пустой файл: work/catalog/tz.md' } });
    check('wf-07: пустое ТЗ (проверка скриптом) - исключение', /нет work\/catalog\/tz\.md или он пустой/.test(f3.err), f3.err || 'нет исключения');
    const f4 = await failRun({ 'tz-write': { ok: false, summary: 'нет catalog-spec.json' } });
    check('wf-07: писатель ТЗ ok=false - исключение', /ТЗ на каталог не написано/.test(f4.err), f4.err || 'нет исключения');
    let f5 = ''; await runWf({ skipSpec: true }, '', { 'check:spec': { ok: false, exit_code: 2, tail: 'нет файла' } }).catch(e => { f5 = e.message; });
    check('wf-07: skipSpec - спецификация все равно проверяется скриптом, нет файла - исключение', /не проходит схему: нет файла/.test(f5), f5 || 'нет исключения');
    // п.20 и K12: второй круг - писатель сначала правит спецификацию, затем ТЗ; аудитор ставит статусы прежним находкам
    const major = { id: 'CT-01', severity: 'major', category: 'coverage', status: 'open', rule: 'чек-лист 2', problem: 'нет поля в спецификации' };
    const r2 = await runWf({ model: 'S', model_light: 'L' }, '', {
      'tz-audit-1': { round: 1, findings: [major], verdict: 'fix', summary: 'major 1' },
      'tz-audit-2': { round: 2, findings: [{ ...major, status: 'fixed' }, { id: 'CT-02', severity: 'minor', category: 'format', status: 'open', rule: 'чек-лист 11', problem: 'служебные ссылки' }], verdict: 'pass', summary: 'ok' },
    });
    const l2 = r2.calls.map(c => c.label);
    check('wf-07: major круга 1 - второй круг: tz-write-2, проверка спецификации и ТЗ, tz-audit-2, публикация', l2.join(',') === 'catalog-spec,check:spec,sample-items,tz-write,check:tz,tz-audit-1,tz-write-2,check:tz-2,tz-audit-2,tz-publish', l2.join(','));
    // интеграция (рецензия P6): второй круг правит catalog-spec.json, агент примеров читает его параллельно - до правки его ждут
    const order = [];
    await runWf({}, '', {
      'sample-items': () => new Promise(res => setTimeout(() => { order.push('samples-done'); res({ ok: true, summary: 'ok' }); }, 30)),
      'tz-audit-1': { round: 1, findings: [major], verdict: 'fix', summary: 'major 1' },
      'tz-write-2': () => { order.push('tz-write-2'); return { ok: true, summary: 'ok' }; },
    });
    check('wf-07: второй круг ждет примеры товаров до правки спецификации (tz-write-2)', order.join(',') === 'samples-done,tz-write-2', order.join(','));
    const w2 = r2.calls.find(c => c.label === 'tz-write-2'), c2k = r2.calls.find(c => c.label === 'check:tz-2'), a2 = r2.calls.find(c => c.label === 'tz-audit-2');
    check('wf-07: второй круг - промт писателя с round=2, проверка обоих файлов, аудитор ставит статусы', w2 && /round=2/.test(w2.prompt) && c2k && /validate\.mjs catalog-spec[\s\S]*&&[\s\S]*md-to-docx\.mjs --check/.test(c2k.prompt) && a2 && /статусы/.test(a2.prompt));
    check('wf-07: open - только открытые blocker/major (fixed и minor не в счет)', r2.result && r2.result.open === 0, JSON.stringify(r2.result));
    const r3w = await runWf({}, '', {
      'tz-audit-1': { round: 1, findings: [major], verdict: 'fix', summary: 'major 1' },
      'tz-audit-2': { round: 2, findings: [major, { ...major, id: 'CT-02', status: 'wontfix' }, { ...major, id: 'CT-03', status: undefined }], verdict: 'fix', summary: 'major' },
    });
    check('wf-07: major не закрыт во втором круге - open 2 (open и без статуса; wontfix не в счет), ТЗ все равно публикуется', r3w.result && r3w.result.open === 2 && r3w.calls.some(c => c.label === 'tz-publish'), JSON.stringify(r3w.result));
    const r4 = await runWf({}, '', { 'tz-audit-1': { round: 1, findings: [{ ...major, severity: 'minor' }], verdict: 'pass', summary: 'minor' } });
    check('wf-07: только minor в круге 1 - второго круга нет', !r4.calls.some(c => /-2$/.test(c.label)), r4.calls.map(c => c.label).join(','));
    let e5 = ''; await runWf({}, '', { 'tz-audit-1': { findings: [major], verdict: 'fix', summary: 'x' }, 'check:tz-2': { ok: false, exit_code: 1, tail: 'FAIL catalog-spec: $.filters[0]: нет обязательного поля "type"' } }).catch(e => { e5 = e.message; });
    check('wf-07: второй круг сломал спецификацию - исключение с выводом проверки', /после второго круга спецификация не проходит схему[\s\S]*FAIL catalog-spec/.test(e5), e5 || 'нет исключения');
    const fs1 = a.calls.find(c => c.label === 'tz-audit-1').schema;
    const it = fs1 && fs1.properties.findings.items;
    const fsch = rj(path.join(TPL, 'schemas', 'findings.schema.json')).properties.findings.items.properties;
    check('wf-07: схема ответа аудитора - id обязателен, status и category как в findings.schema, round', it && it.required.includes('id') && JSON.stringify(it.properties.status.enum) === JSON.stringify(fsch.status.enum) && JSON.stringify(it.properties.category.enum) === JSON.stringify(fsch.category.enum) && fs1.properties.round, JSON.stringify(it && it.required));
    check('wf-07: ROLES содержит run: light', /\brun: 'light'/.test(src));
    const s = a.calls.find(c => c.label === 'sample-items');
    check('wf-07: sample-items - легкая роль (model_light) и промт 07-sample-items.md', s && s.model === 'L' && /prompts\/07-sample-items\.md/.test(s.prompt), s && s.model);
    check('wf-07: итог содержит samples', a.result && /sample-items/.test(a.result.samples || ''), JSON.stringify(a.result));
    const over = await runWf({ model: 'S', model_light: 'L', models: { 'sample-items': 'X' } });
    check('wf-07: args.models переопределяет sample-items', over.calls.find(c => c.label === 'sample-items')?.model === 'X');
    let threw2 = '';
    const b = await runWf({}, 'sample-items').catch(e => { threw2 = e.message; return { calls: [], result: null }; });
    check('wf-07: отказ шага примеров не валит фазу, ТЗ публикуется', !threw2 && b.calls.some(c => c.label === 'tz-publish') && /ошибка: агент упал: сеть недоступна/.test(b.result?.samples || ''), threw2 || JSON.stringify(b.result));
    const c = await runWf({ skipSpec: true, publish: false });
    const cl = c.calls.map(x => x.label);
    check('wf-07: skipSpec и publish=false - примеры все равно собираются, публикации нет', !cl.includes('catalog-spec') && cl.includes('sample-items') && !cl.includes('tz-publish'), cl.join(','));
    check('wf-07: ROLES содержит sample-items: light', /'sample-items': 'light'/.test(src));
  }

  // ================================================================== 5. промты каталога
  {
    const P = f => fs.readFileSync(path.join(TPL, 'prompts', f), 'utf8');
    const samples = P('07-sample-items.md');
    const need = (label, text, parts) => { const miss = parts.filter(x => !text.includes(x)); check(label, !miss.length, `нет: ${miss.join(' | ')}`); };
    need('07-sample-items: контракт C5 (source, "*", 12 категорий, лимиты фото, проверка и нормализация)', samples,
      ['schemas/sample-items.schema.json', 'source: "site"', 'source: "illustrative"', '`"*"`', 'listing: true', 'первые 12', '200 КБ', '2 МБ',
        'work/catalog/samples/', 'node scripts/validate.mjs sample-items work/catalog/sample-items.json', 'node scripts/normalize.mjs work/catalog/sample-items.json',
        'seo_fetch_page', 'curl', 'родительской категории', '«пример»', 'Не брать описания']);
    const pub = P('07-catalog-publisher.md');
    need('07-catalog-publisher: docx -> uploadFile в texts_folder_id, пропуск без папки, сверка через ToolSearch, архив прошлой версии', pub,
      ['node scripts/md-to-docx.mjs work/catalog/tz.md work/catalog/tz.docx', 'drive_name', 'texts_folder_id', '~/.claude/seo-knowledge/DRIVE.md', 'TODO_*',
        '"status":"skipped"', 'uploadFile', 'convertToGoogleFormat: true', 'ToolSearch', 'checks: null', 'renameItem', '(устарело)', 'revisions']);
    check('07-catalog-publisher: createGoogleDoc не вызывается', !/select:[^\n`]*createGoogleDoc/.test(pub) && /createGoogleDoc` не использовать/.test(pub));
    need('07-catalog-spec-writer: values_source, границы range, CTA-объект (.main)', P('07-catalog-spec-writer.md'),
      ['values_source', '`min`, `max`, `step`', '`.main`', '`.secondary`', 'ui_role: cart', 'как покупают у лидеров']);
    need('07-catalog-tz-writer: столбец «откуда значения» по values_source', P('07-catalog-tz-writer.md'), ['values_source']);
    const aud = P('07-catalog-tz-auditor.md');
    check('07-catalog-tz-auditor: сверки с прототипом нет (прототип собирается после фазы 7)', !/prototype/.test(aud));
    need('02-catalog-analyst: строка «как покупают у лидеров»', P('02-catalog-analyst.md'), ['как покупают у лидеров']);
    // п.18, 19, 20, K6, K7, K12 и мелочи каталога
    const specW = P('07-catalog-spec-writer.md');
    need('07-catalog-spec-writer: K6 - область и значения по веткам при 3+ листингах, field price', specW, ['`categories`', '`values_by_category: {', '3 и более листингах', '`field: "price"`', 'не в `note`']);
    need('07-catalog-spec-writer: п.19 - чипы писателя из блоков листинга в labels, чип без фильтра - в notes', specW, ['work/pages/<slug>/blocks/*.json', '`kind: "filters"`', '`labels`', 'чип без фильтра', 'имя фильтра не менять']);
    need('07-catalog-spec-writer: K7 - card_cta.main из CTA товара, иначе подпись заявки, не main категории', specW, ['`cta_by_type.product`', '`.secondary` из `cta_by_type.category`', '`.main` категории не брать', '`page:`', '`anchor:`']);
    check('07-catalog-spec-writer: мертвый гейт данных убран («карточки не пишутся»)', !/Карточки не пишутся/.test(specW));
    const tzW = P('07-catalog-tz-writer.md');
    need('07-catalog-tz-writer: п.20 - второй круг сначала правит спецификацию с проверкой схемы, фильтры не переименовывать', tzW, ['`round`', 'сначала правь `work/catalog/catalog-spec.json`', 'не переименовывать', 'node scripts/validate.mjs catalog-spec work/catalog/catalog-spec.json', '"spec_changed"']);
    check('07-catalog-tz-writer: во втором круге спецификация раньше ТЗ', tzW.indexOf('validate.mjs catalog-spec') > 0 && tzW.indexOf('validate.mjs catalog-spec') < tzW.indexOf('затронутые разделы ТЗ'));
    need('07-catalog-tz-writer: п.18 - колонка «где выводится» по categories, значения веток', tzW, ['где выводится', '`categories`', '`values_by_category`', 'все выдачи']);
    need('07-catalog-tz-writer: обязательность отстроек конвенцией, чипы без фильтра - вопросом в разделе 8', tzW, ['в данных - нет, в шаблоне - да', 'чип без фильтра', 'один вопрос - одна строка']);
    need('07-catalog-tz-writer: без служебных ссылок конвейера и путей задачи', tzW, ['Без служебных ссылок', 'id фактов', 'CSV или XLSX']);
    check('07-catalog-tz-writer: путь inputs/items.csv разработчику не задается', !/inputs\/items\.csv/.test(tzW));
    need('07-catalog-tz-auditor: K12 - статусы прежних находок во втором круге, сквозные id', aud, ['`CT-01`', '`fixed`', '`wontfix`', '`rejected`', '`open`', 'round: 2', 'node scripts/validate.mjs findings work/audit/catalog-tz.json']);
    need('07-catalog-tz-auditor: п.18, 19 и служебные ссылки - в чек-листе', aud, ['где выводится', '`categories`', 'чип без фильтра', 'md-to-docx.mjs --check work/catalog/tz.md', 'minor']);
    need('02-catalog-analyst: п.18 - не больше двух дополнительных листингов при 3+ ветках', P('02-catalog-analyst.md'), ['3 и больше листингов', 'первых двух доменов', 'Больше двух дополнительных листингов', 'фильтры только одной ветки']);
    need('07-sample-items: facets по области фильтров (K6)', samples, ['`categories`', '`values_by_category`', '`field: "price"`']);
    // интеграция (рецензия P6): чип - по фильтрам своей страницы; facets - по всей цепочке предков; refs аудитора -
    // кандидаты (id проверяются по facts.json и блокам); писатель ТЗ читает факты, чтобы передать их словами
    need('07-catalog-spec-writer: чип сверяется с фильтрами своей страницы, фильтр вне ее области - slug в categories или «чип без фильтра»', specW, ['Чип сверяется с фильтрами своей страницы', 'добавь ее slug в `categories`']);
    // повторная проверка №19: перечень значений с двоеточием и без - только при всех значениях фильтра, иначе «значения не
    // из фильтра»; чип по range/toggle/search («Цена: от и до») - не вопрос; аудитор ТЗ п.10 - то же правило
    const flat = s => s.replace(/\s+/g, ' ');
    need('07-catalog-spec-writer (№19): перечень значений после двоеточия или без него - в labels только при всех значениях, иначе «значения не из фильтра»', flat(specW),
      ['Чип с перечнем значений - после двоеточия («Признак: A, B и C») или без него («A, B, C»)', 'только если каждое его значение есть в `values` фильтра',
        '«чип без фильтра: <подпись> (<slug>) - значения не из фильтра»', 'Сборщик такой чип живым не делает', 'Чип из признаков через запятую - в `labels`, только если каждый признак - фильтр этой страницы']);
    need('07-catalog-spec-writer (№19): чип по range/toggle/search без значений - не вопрос, по имени фильтра - ничего не делать', flat(specW),
      ['У `range`, `toggle`, `search` значений нет: чип по такому фильтру («Цена: от и до») - не вопрос', 'до двоеточия имя фильтра - ничего не делать, иначе подпись в `labels`']);
    need('07-catalog-tz-auditor (№19): п.10 - «значения не из фильтра» вопросом в разделе 8, перечень в labels со значением не из фильтра - major, range/toggle/search - не находка', flat(aud),
      ['10. Каждая строка «чип без фильтра» из `notes` спецификации (и «значения не из фильтра») есть вопросом в разделе 8',
        'Подпись в `labels` с перечнем значений (после двоеточия, через запятую, косую черту или «и»), где значение не из `values` фильтра, - major',
        'У `range`, `toggle`, `search` значений нет: их подпись («Цена: от и до») - не находка и не вопрос']);
    // вторая повторная проверка №19: сборщик не отличает от признака одно значение и варианты словами - их не пускает в
    // labels автор и ловит аудитор; «признак, единица» - подпись признака, не перечень и не вопрос; описание после
    // двоеточия у фильтра со значениями - ошибка формы чипа: не labels и не вопрос в ТЗ
    need('07-catalog-spec-writer (№19, вторая проверка): одно значение, варианты словами, косая черта и признак впереди - перечень; единица - не признак; описание после двоеточия - «чип с описанием», не вопрос', flat(specW),
      ['в том числе через косую черту («A/B»), с признаком впереди («Порода дуб и бук»), одно значение («Венге») и варианты словами («Для нее и для него»)',
        'одно значение не из каталога и варианты словами он от названия признака не отличит, поэтому их в `labels` не класть',
        'признак с единицей измерения: «Длина, см», «Объем чаши, л»', 'единица измерения («см», «л») - не признак',
        'описание («Вставка: любая», «Размер: от 16 до 18») он выводит надписью', 'строка в `notes` «чип с описанием: <подпись> (<slug>)», в ТЗ она не идет']);
    need('07-catalog-tz-auditor (№19, вторая проверка): одно значение и варианты словами в labels - major; единица и «чип с описанием» - не находка', flat(aud),
      ['То же - подпись из одного значения не из `values` («Венге» у фильтра породы) и варианты словами, которых нет среди значений («Для нее и для него»)',
        'в том числе с единицей измерения («Длина, см»), - не находка', 'Строка «чип с описанием» (ошибка формы чипа) - не вопрос заказчику']);
    check('07-catalog-tz-writer (№19): в раздел 8 идут только строки «чип без фильтра», не «чип с описанием»', /строки «чип без фильтра» из `notes` спецификации - вопросом/.test(tzW) && !/чип с описанием/.test(tzW));
    need('07-sample-items: facets - область фильтра по любому предку категории, не только родителю', samples, ['любого предка по `parent`']);
    check('07-sample-items: правила «slug ее родителя» (один уровень) больше нет', !/slug ее\s+родителя в `categories`/.test(samples));
    need('07-catalog-tz-auditor: refs - кандидаты, служебная ссылка только по facts.json, блокам, путям и параграфам', aud, ['`refs` - кандидаты', '«d20», «A100», «products.json»', 'только проверка id из `refs`']);
    need('07-catalog-tz-writer: факты по id из спецификации - словами (work/facts.json, grep)', tzW, ['`work/facts.json` - только записи с id', 'передать факт словами']);
    // стиль и чистота файлов пакета
    const files = ['prompts/07-sample-items.md', 'prompts/07-catalog-publisher.md', 'prompts/07-catalog-spec-writer.md', 'prompts/07-catalog-tz-writer.md',
      'prompts/07-catalog-tz-auditor.md', 'prompts/02-catalog-analyst.md', 'workflows/wf-07-catalog.js', 'schemas/sample-items.schema.json',
      'schemas/catalog-spec.schema.json', 'scripts/md-to-docx.mjs'];
    const NICHE = /кольц|золот|ювелир|пирсинг|бриллиант|недвижим|квартир|застройщ|goldax/i;
    for (const f of files) {
      const t = fs.readFileSync(path.join(TPL, f), 'utf8');
      check(`${f}: без буквы «е с точками» и длинных тире`, !YO.test(t) && !DASH.test(t));
      check(`${f}: без UUID MCP и нишевых слов`, !/mcp__[0-9a-f]{8}-/.test(t) && !NICHE.test(t), (t.match(NICHE) || t.match(/mcp__[0-9a-f]{8}-/) || [''])[0]);
    }
  }
} catch (e) {
  fail++; failures.push(`FAIL исключение: ${e.stack || e.message}`);
} finally {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
}

failures.forEach(f => console.log(f));
console.log(`cases-catalog: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
