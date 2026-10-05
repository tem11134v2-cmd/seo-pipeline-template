// Раздел отчета «Что спросить у заказчика» (report.mjs): пометки писателей отдельно, слияние повторов без LLM. Запуск:
//   node .claude/tests/site-tekst/cases-report-questions.mjs      код выхода 0 - все прошли (или через run.mjs рядом).
// Все во временной папке (os.tmpdir()), синтетические данные, без сети и без данных клиентов; скрипты - из kit шаблона.
// Разделы: 1. слияние по ссылке gN в строку анализа (места - «ждут ответа»), переформулированные повторы в одну строку
// (объединение мест, формулировка полнее, хвост «- запросить у заказчика» снят), поручение «Запросить у заказчика факт: X» -
// вопрос X; 2. разные вопросы с общими словами не сливаются («сколько стоит замер» и «сколько стоит монтаж», «срок» и
// «стоимость» доставки); 3. пометки писателей - подразделом для оператора (правка «удален», одни id, lint и «нет в брифе»,
// «нет факта Fxx» при факте с publish yes - с id факта для брифа), «нет факта» о неизвестном факте - вопрос; 4. чип КФ - своя
// строка с основанием, похожая строка писателя в него не сливается; 5. порядок (анализ, слитые по числу мест, остальные), счет
// в сводке и в строке консоли, report-questions.json (каждая сырая строка - в вопросе или в пометках); 6. без вопросов -
// «вопросов нет»; 7. ничего не теряется (ревью 577d062): строка, покрытая формулировкой лишь частью («срок и канал ответа (g4)»
// при вопросе g4 только о сроке, «... и подъем на этаж» при g6, «... и пример расчета»), - уточнением «также» под вопросом,
// полная формулировка - формулировкой группы («стоимость и срок доставки СДЭК ..., оплата при отправке»); голые ссылки «g6»,
// «g6, F05» и сборная строка (g6 и g8) - в «ждут ответа»; вложение «что означают статусы», «входит ли образец ... в цену»;
// 8. вопросы, а не пометки: «<тема> - нет факта, не обещан», «... записан в handoff_note», «ждет подтверждения», находки судьи
// и слепого читателя («- вопрос не ставится до факта», поручение «Добавить, что X; если Y - сказать об этом»); пометки: отчет о
// правке писателя, строка только со ссылкой «(F28)» на факт с publish yes, «Добавить ...» писателя; 9. разные факты не
// сливаются (F69 и F70 со скобкой-источником «данные блога x.рф», F61 и F73, F63 в группе и F90 у похожей строки), пара
// «не подтверждено: X» и «X (Fnn): не утверждать» - одна строка; id судьи «(judge-r3-012)» не склеивает «материал штанги» и
// «материал цепочки»; одинаковый после снятия хвоста текст («цена - нет факта F99» и «(F98)») - одна строка; «цена доставки» и
// «цена изделия» - разные.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TPL = path.resolve(HERE, '..', '..', 'skills', 'site-tekst', 'kit');
let pass = 0, fail = 0;
const failures = [];
function check(name, ok, detail = '') {
  if (ok) pass++;
  else { fail++; failures.push(`FAIL ${name}${detail ? ': ' + String(detail).slice(0, 900) : ''}`); }
}
const rj = f => JSON.parse(fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, ''));
const wj = (f, o) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(o, null, 2) + '\n'); };
function run(cwd, args) {
  const r = spawnSync(process.execPath, args, { cwd, encoding: 'utf8', timeout: 240000 });
  return { code: r.status, stdout: r.stdout || '', out: (r.stdout || '') + (r.stderr || '') };
}
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cases-report-q-'));
const sectionOf = (md, h) => { const i = md.indexOf(`## ${h}`); if (i < 0) return ''; const j = md.indexOf('\n## ', i + 3); return md.slice(i, j < 0 ? undefined : j); };

// ---------- фикстура: три страницы, пробелы анализа, needs_fact писателей, находки судьи, чип оболочки ----------
function mkProject(name, { empty = false } = {}) {
  const dir = path.join(tmpRoot, name);
  for (const d of ['scripts', 'rules', 'schemas', 'config']) fs.cpSync(path.join(TPL, d), path.join(dir, d), { recursive: true });
  const cfg = rj(path.join(dir, 'config', 'project.json'));
  cfg.company = 'Тест Окна'; cfg.slug = 'test';
  wj(path.join(dir, 'config', 'project.json'), cfg);
  const page = (slug, type, i) => ({ slug, url: i ? `/${slug}` : '/', type, subject: slug, parent: i ? '/' : '', level: i ? 1 : 0, segment: 'S1', status: 'briefed' });
  wj(path.join(dir, 'work', 'sitemap.json'), { source: 'test', page_types: ['home', 'service'], pages: [page('home', 'home', 0), page('s1', 'service', 1), page('s2', 'service', 2)] });
  const ids = { home: ['B01-hero', 'B02-faq'], s1: ['B01-hero', 'B02-delivery', 'B03-reviews'], s2: ['B01-hero', 'B02-delivery', 'B03-reviews'] };
  for (const [slug, list] of Object.entries(ids)) {
    wj(path.join(dir, 'work', 'pages', slug, 'brief.json'), { slug, url: `/${slug}`, type: slug === 'home' ? 'home' : 'service', subject: slug, segment: { id: 'S1', name: 'Все' }, facts: [], blocks: list.map((block_id, i) => ({ block_id, type: block_id.slice(4), name: block_id, role: i ? 'conversion' : 'hero' })) });
  }
  const need = empty ? {} : {
    'home/B01-hero': ['ИНН и ОГРН для подвала'],
    'home/B02-faq': ['стоимость доставки по городу (g2)', 'адрес страницы отзывов на Яндекс Картах', 'Пункт о скидке удален: факта нет', 'F05'],
    's1/B01-hero': ['какой срок изготовления окон по размерам заказчика'],
    's1/B02-delivery': ['стоимость доставки по области', 'Сколько стоит замер на объекте'],
    's1/B03-reviews': ['F05 нет в брифе страницы - lint fact.unknown blocker'],
    's2/B01-hero': ['срок изготовления окон по размерам заказчика', 'гарантия на монтаж - нет факта F05 в брифе', 'гарантия на откосы - нет факта F99'],
    's2/B02-delivery': ['срок доставки по области', 'Сколько стоит монтаж на объекте'],
    's2/B03-reviews': ['Адреса страниц отзывов компании на Яндекс Картах и в 2ГИС - запросить у заказчика'],
  };
  for (const [slug, list] of Object.entries(ids)) for (const id of list) {
    wj(path.join(dir, 'work', 'pages', slug, 'blocks', `${id}.json`), { block_id: id, elements: [{ kind: 'text', text: `Текст ${slug} ${id}` }], needs_fact: need[`${slug}/${id}`] || [] });
    wj(path.join(dir, 'work', 'audit', slug, `lint-${id}.json`), { verdict: 'pass', findings: [] });
  }
  wj(path.join(dir, 'work', 'facts.json'), {
    facts: [
      { id: 'F05', label: 'Гарантия', value: '2 года', wording: 'гарантия 2 года', publish: 'yes', kind: 'claim' },
      { id: 'F07', label: 'Монтаж зимой', value: 'да', wording: 'монтаж зимой', publish: 'no', kind: 'claim' },
    ],
    gaps: empty ? [] : [
      'открытый вопрос анализа (g2): Сколько стоит доставка по городу и с какой суммы она бесплатна',
      'открытый вопрос анализа (g3): Работаете ли вы по выходным',
      'журнал гейта (j1): не спрошен порядок оплаты для юрлиц',
    ],
  });
  if (empty) return dir;
  // судья: вопрос-повтор отзывов, поручение «Запросить у заказчика факт: ...», ссылка на вопрос анализа g2
  wj(path.join(dir, 'work', 'audit', 's1', 'round-1.json'), { producer: 'page-judge', findings: [
    { id: 'j1', block_id: 'B03-reviews', severity: 'minor', rule: 'fact', problem: 'нет ссылок на отзывы', proposal: 'адреса страниц отзывов на Яндекс Картах и в 2ГИС', needs_fact: true, status: 'open' },
    { id: 'j2', block_id: 'B01-hero', severity: 'minor', rule: 'fact', problem: 'нет графика', proposal: 'Текст не трогать. Запросить у заказчика факт: работаете ли вы по субботам и воскресеньям; после факта дописать график.', needs_fact: true, status: 'open' },
  ] });
  wj(path.join(dir, 'work', 'audit', 's2', 'round-1.json'), { producer: 'page-judge', findings: [
    { id: 'j3', block_id: 'B02-delivery', severity: 'minor', rule: 'fact', problem: 'нет порога доставки', proposal: 'доставка по городу бесплатна от какой суммы (вопрос g2)', needs_fact: true, status: 'open' },
  ] });
  // чип оболочки КФ: «Реквизиты» с подсказкой - та же фраза есть у писателя главной
  wj(path.join(dir, 'work', 'output', 'prototype.modules.json'), { shell: { on: true, why: 'элементов 1', source: 'work/shell.json', items: [
    { id: 'legal_line', name: 'Реквизиты', zone: 'footer', level: 'must', coverage: '4/5', niche: false, state: 'chip' },
  ] } });
  wj(path.join(dir, 'work', 'shell.json'), { generated_at: 'x', n_competitors: 5, items: [
    { id: 'legal_line', name: 'Реквизиты', zone: 'footer', level: 'must', coverage: '4/5', kind: 'slot', render: 'legal_line', needs: ['company.inn'], needs_hint: 'ИНН и ОГРН для подвала', page_match: null, niche: false },
  ] });
  return dir;
}

// ---------- проекты ревью: страницы и блоки из ключей needs («p1/B01-hero»), unknowns брифа, находки судьи (round-1) и слепого
// читателя (blind.json); результат - строки вопросов (с уточнениями и без), пометки, сводка, консоль, report-questions.json ----------
function runCase(name, { gaps = [], needs = {}, unknowns = {}, judge = {}, blind = {}, facts = [], human = {} }) {
  const dir = path.join(tmpRoot, name);
  for (const d of ['scripts', 'rules', 'schemas', 'config']) fs.cpSync(path.join(TPL, d), path.join(dir, d), { recursive: true });
  const cfg = rj(path.join(dir, 'config', 'project.json'));
  cfg.company = 'Тест'; cfg.slug = 'test';
  wj(path.join(dir, 'config', 'project.json'), cfg);
  const pages = {};
  const keys = [...Object.keys(needs), ...Object.keys(unknowns).map(s => `${s}/B01-hero`), ...[...Object.entries(judge), ...Object.entries(blind), ...Object.entries(human)].flatMap(([s, l]) => l.map(([b]) => `${s}/${b}`))];
  for (const k of keys) { const [slug, block] = k.split('/'); (pages[slug] = pages[slug] || new Set()).add(block); }
  const slugs = Object.keys(pages).sort();
  wj(path.join(dir, 'work', 'sitemap.json'), { source: 'test', page_types: ['service'], pages: slugs.map((slug, i) => ({ slug, url: i ? `/${slug}` : '/', type: 'service', subject: slug, parent: i ? '/' : '', level: i ? 1 : 0, segment: 'S1', status: 'briefed' })) });
  for (const slug of slugs) {
    const ids = [...pages[slug]].sort();
    wj(path.join(dir, 'work', 'pages', slug, 'brief.json'), { slug, url: `/${slug}`, type: 'service', subject: slug, segment: { id: 'S1', name: 'Все' }, facts: [], unknowns: unknowns[slug] || [], blocks: ids.map((block_id, i) => ({ block_id, type: block_id.slice(4), name: block_id, role: i ? 'conversion' : 'hero' })) });
    for (const id of ids) {
      wj(path.join(dir, 'work', 'pages', slug, 'blocks', `${id}.json`), { block_id: id, elements: [{ kind: 'text', text: `Текст ${slug} ${id}` }], needs_fact: needs[`${slug}/${id}`] || [] });
      wj(path.join(dir, 'work', 'audit', slug, `lint-${id}.json`), { verdict: 'pass', findings: [] });
    }
  }
  const finding = ([block_id, proposal], i) => ({ id: `j${i + 1}`, block_id, severity: 'minor', rule: 'fact', problem: 'нет факта', proposal, needs_fact: true, status: 'open' });
  for (const [slug, list] of Object.entries(judge)) wj(path.join(dir, 'work', 'audit', slug, 'round-1.json'), { producer: 'page-judge', findings: list.map(finding) });
  for (const [slug, list] of Object.entries(blind)) wj(path.join(dir, 'work', 'audit', slug, 'blind.json'), { findings: list.map(finding) });
  // правки заказчика (human), отклоненные фиксером «нет факта»: строка retro-stats no_fact с producer human
  for (const [slug, list] of Object.entries(human)) wj(path.join(dir, 'work', 'audit', slug, 'human-20260929-client.json'), { scope: 'page', producer: 'human', round: 1, created_at: '2026-09-29T10:00:00Z', verdict: 'fail', summary: 'правки заказчика',
    findings: list.map(([block_id, quote, problem, resolution], i) => ({ id: `client-${slug}-${i + 1}`, page: slug, block_id, severity: 'major', category: 'fact', rule: 'human.fix', quote, problem, proposal: problem, status: 'wontfix', resolution })) });
  wj(path.join(dir, 'work', 'facts.json'), { facts, gaps });
  const r = run(dir, ['scripts/report.mjs']);
  const md = r.code === 0 ? fs.readFileSync(path.join(dir, 'work', 'output', 'report.md'), 'utf8') : '';
  check(`${name}: код 0`, r.code === 0, r.out.slice(0, 800));
  const ask = sectionOf(md, 'Что спросить у заказчика');
  const [qPart, notePart = ''] = ask.split('### Пометки писателей (для оператора)');
  const qf = path.join(dir, 'work', 'output', 'report-questions.json');
  return {
    ask, lines: qPart.split('\n').filter(l => /^(?: {2})?- /.test(l)), top: qPart.split('\n').filter(l => l.startsWith('- ')),
    notes: notePart.split('\n').filter(l => l.startsWith('- ')), sum: sectionOf(md, 'Сводка'), stdout: r.stdout, qj: fs.existsSync(qf) ? rj(qf) : { questions: [], notes: [] },
  };
}

try {
  const D = mkProject('main');
  const r = run(D, ['scripts/report.mjs']);
  const md = r.code === 0 ? fs.readFileSync(path.join(D, 'work', 'output', 'report.md'), 'utf8') : '';
  check('report: код 0', r.code === 0, r.out.slice(0, 800));
  const ask = sectionOf(md, 'Что спросить у заказчика');
  const [qPart, notePart = ''] = ask.split('### Пометки писателей (для оператора)');
  const qLines = qPart.split('\n').filter(l => l.startsWith('- '));
  const nLines = notePart.split('\n').filter(l => l.startsWith('- '));

  // ================================================================ 1. слияние
  check('gN: строки со ссылкой на g2 слиты в строку анализа, места - «ждут ответа»', qLines.includes('- открытый вопрос анализа (g2): Сколько стоит доставка по городу и с какой суммы она бесплатна (весь сайт; ждут ответа: home/B02-faq, s2/B02-delivery)') && !/\(g2\)\s*\(home|вопрос g2/.test(qPart), qPart);
  check('вопрос анализа без ссылок - как раньше «(весь сайт)»', qLines.includes('- открытый вопрос анализа (g3): Работаете ли вы по выходным (весь сайт)') && qLines.includes('- журнал гейта (j1): не спрошен порядок оплаты для юрлиц (весь сайт)'), qPart);
  check('переформулированные повторы: одна строка, формулировка полнее, хвост «- запросить у заказчика» снят, места - объединение', qLines.includes('- Адреса страниц отзывов компании на Яндекс Картах и в 2ГИС (home/B02-faq, s1/B03-reviews, s2/B03-reviews)') && qLines.filter(l => /отзыв/i.test(l)).length === 1, qPart);
  check('повтор с вопросным словом: «какой срок ...» и «срок ...» - одна строка с двумя местами', qLines.filter(l => /срок изготовления окон по размерам заказчика/.test(l)).length === 1 && qLines.some(l => /срок изготовления окон по размерам заказчика \(s1\/B01-hero, s2\/B01-hero\)$/.test(l)), qPart);
  check('поручение судьи «Запросить у заказчика факт: X; ...» - вопрос X без поручения', qLines.includes('- работаете ли вы по субботам и воскресеньям (s1/B01-hero)') && !/Текст не трогать|после факта/.test(ask), qPart);

  // ================================================================ 2. разные вопросы с общими словами
  check('«сколько стоит замер» и «сколько стоит монтаж» на объекте - разные строки', qLines.some(l => l.startsWith('- Сколько стоит замер на объекте (s1/B02-delivery)')) && qLines.some(l => l.startsWith('- Сколько стоит монтаж на объекте (s2/B02-delivery)')), qPart);
  check('«срок доставки» и «стоимость доставки» по области - разные строки (разные грани), не в строке анализа g2', qLines.includes('- стоимость доставки по области (s1/B02-delivery)') && qLines.includes('- срок доставки по области (s2/B02-delivery)'), qPart);

  // ================================================================ 3. пометки писателей
  check('пометки - подразделом для оператора: правка «удален», одни id, lint и «нет в брифе», «нет факта F05» (факт есть)', nLines.length === 4 && nLines.includes('- Пункт о скидке удален: факта нет (home/B02-faq)') && nLines.includes('- F05 (home/B02-faq)') && nLines.includes('- F05 нет в брифе страницы - lint fact.unknown blocker (s1/B03-reviews)') && nLines.includes('- гарантия на монтаж - нет факта F05 в брифе (s2/B01-hero; факт есть: F05 - в бриф страницы)'), notePart);
  check('пометок нет в вопросах; «нет факта» о неизвестном факте (F99) - вопрос без хвоста', !qLines.some(l => /удален|^- F05|lint|нет факта F05/.test(l)) && qLines.includes('- гарантия на откосы (s2/B01-hero)'), qPart);

  // ================================================================ 4. чип КФ
  check('чип КФ: формулировка и основание свои, похожая строка писателя - отдельно', qLines.includes('- Нужны данные для элемента «Реквизиты»: ИНН и ОГРН для подвала (подвал; основание: есть у 4 из 5 лидеров)') && qLines.includes('- ИНН и ОГРН для подвала (home/B01-hero)'), qPart);

  // ================================================================ 5. порядок, счет, report-questions.json
  const at = re => qLines.findIndex(l => re.test(l));
  check('порядок: вопросы анализа, затем слитые по числу мест (3, затем 2), затем остальные, чип - в конце', at(/\(g2\)/) === 0 && at(/\(j1\)/) === 2 && at(/Адреса страниц отзывов/) === 3 && at(/срок изготовления окон/) === 4 && at(/^- ИНН и ОГРН/) === 5 && at(/элемента «Реквизиты»/) === qLines.length - 1, qLines.join('\n'));
  check('сводка: вопросов после слияния, строк было, слито, пометок для оператора', /- Пометок «нужны данные» в текстах: 0; вопросов заказчику: 13 \(строк было 22: слито повторов 5, пометок писателей для оператора 4\)/.test(sectionOf(md, 'Сводка')) && qLines.length === 13, sectionOf(md, 'Сводка'));
  check('строка консоли: вопросов заказчику 13 [слито повторов 5, пометок писателей 4]', /вопросов заказчику 13 \[слито повторов 5, пометок писателей 4\], правок без проверки судьей/.test(r.stdout), r.stdout);
  const qf = path.join(D, 'work', 'output', 'report-questions.json');
  const qj = fs.existsSync(qf) ? rj(qf) : { questions: [], notes: [] };
  const counted = qj.questions.reduce((n, q) => n + 1 + q.merged.length, 0) + qj.notes.length;
  check('report-questions.json: raw = вопросы + слитые + пометки, у вопроса анализа g2 две слитые строки с местами', qj.raw === 22 && qj.merged === 5 && qj.questions.length === 13 && qj.notes.length === 4 && counted === 22
    && (qj.questions.find(q => /\(g2\)/.test(q.text)) || { merged: [] }).merged.map(m => m.places.join()).join('|') === 'home/B02-faq|s2/B02-delivery', JSON.stringify(qj).slice(0, 900));
  check('report-questions.json: исходная формулировка поручения - text_raw', qj.questions.some(q => q.text === 'работаете ли вы по субботам и воскресеньям' && /^Текст не трогать/.test(q.text_raw || '')), JSON.stringify(qj.questions.map(q => q.text)));
  check('без е с точками и длинных тире в разделе', !/[\u0451\u0401\u2014\u2013]/.test(ask), ask);

  // ================================================================ 6. без вопросов
  const E = mkProject('empty', { empty: true });
  const re = run(E, ['scripts/report.mjs']);
  const mdE = re.code === 0 ? fs.readFileSync(path.join(E, 'work', 'output', 'report.md'), 'utf8') : '';
  check('без вопросов: «вопросов нет», без подраздела пометок, счет без скобки', /## Что спросить у заказчика\n- вопросов нет\n/.test(mdE) && !/Пометки писателей/.test(mdE) && /вопросов заказчику: 0$/m.test(sectionOf(mdE, 'Сводка')) && /вопросов заказчику 0, /.test(re.stdout), re.out.slice(0, 400) + sectionOf(mdE, 'Сводка'));

  // ================================================================ 7. ничего не теряется: уточнения «также», ссылки gN, вложение
  const A = runCase('cover', {
    gaps: ['открытый вопрос анализа (g4): За какое время отвечаете на заявку с фото на расчет',
      'открытый вопрос анализа (g6): Сколько стоит доставка курьером по Москве и с какой суммы она бесплатна',
      'открытый вопрос анализа (g8): Сколько дней изделие проходит Пробирную палату'],
    needs: {
      'p1/B01-hero': ['срок и канал ответа на заявку с фото (g4)'], 'p1/B02-x': ['За какое время отвечаете на заявку с фото (g4)'],
      'p2/B01-hero': ['стоимость доставки курьером по Москве и подъем на этаж'], 'p2/B02-x': ['стоимость доставки СДЭК в другой город'],
      'p3/B01-hero': ['g6'], 'p3/B02-x': ['g6, F05'], 'p3/B03-y': ['срок изготовления кольца, срок доставки (g6), срок Пробирной палаты (g8)'],
      'p4/B01-hero': ['что означают статусы'], 'p4/B02-x': ['что значат статусы «Есть образец» и «Пример работы»'],
      'p5/B01-hero': ['входит ли образец из полимера в цену'], 'p5/B02-x': ['кто решает про образец из полимера и его стоимость'],
      'p6/B01-hero': ['где опубликована цена приема грамма на сегодня'], 'p6/B02-x': ['цена приема грамма на сегодня и пример расчета с цифрами'],
      'p6/B03-y': ['где опубликована цена приема грамма на сегодня и когда называют итоговую сумму'],
      'p7/B01-hero': ['стоимость и срок доставки СДЭК в другой город, оплата при отправке'],
    },
    facts: [{ id: 'F05', label: 'Гарантия', value: '2 года', wording: 'гарантия 2 года', publish: 'yes', kind: 'claim' }],
  });
  const ix = (lines, re) => lines.findIndex(l => re.test(l));
  const gi4 = ix(A.lines, /\(g4\)/), gi6 = ix(A.lines, /\(g6\):/);
  check('также: «срок и канал ответа (g4)» при вопросе g4 о сроке - уточнением под g4, покрытая целиком строка - молча',
    A.lines[gi4] === '- открытый вопрос анализа (g4): За какое время отвечаете на заявку с фото на расчет (весь сайт; ждут ответа: p1/B01-hero, p1/B02-x)'
    && A.lines[gi4 + 1] === '  - также: срок и канал ответа на заявку с фото (p1/B01-hero)' && !/За какое время отвечаете на заявку с фото \(g4\)/.test(A.ask), A.ask);
  check('также под g6 без ссылки («... и подъем на этаж»); голые «g6», «g6, F05» и сборная строка (g6 и g8) - в «ждут ответа», не в пометках',
    A.lines[gi6] === '- открытый вопрос анализа (g6): Сколько стоит доставка курьером по Москве и с какой суммы она бесплатна (весь сайт; ждут ответа: p2/B01-hero, p3/B01-hero, p3/B02-x, p3/B03-y)'
    && A.lines[gi6 + 1] === '  - также: стоимость доставки курьером по Москве и подъем на этаж (p2/B01-hero)'
    && A.lines.includes('- открытый вопрос анализа (g8): Сколько дней изделие проходит Пробирную палату (весь сайт; ждут ответа: p3/B03-y)')
    && A.lines.includes('- срок изготовления кольца, срок доставки (g6), срок Пробирной палаты (g8) (p3/B03-y)') && !A.notes.length, A.ask);
  check('полная строка - формулировка группы: «стоимость доставки СДЭК» в «стоимость и срок ..., оплата при отправке» (срок и оплата не теряются)',
    A.lines.includes('- стоимость и срок доставки СДЭК в другой город, оплата при отправке (p2/B02-x, p7/B01-hero)') && A.lines.filter(l => /СДЭК/.test(l)).length === 1, A.ask);
  check('также в группе без анализа: «пример расчета» под формулировкой с «итоговой суммой», подвопросы не теряются',
    A.lines.includes('- где опубликована цена приема грамма на сегодня и когда называют итоговую сумму (p6/B01-hero, p6/B02-x, p6/B03-y)')
    && A.lines[ix(A.lines, /итоговую сумму/) + 1] === '  - также: цена приема грамма на сегодня и пример расчета с цифрами (p6/B02-x)', A.ask);
  check('вложение: «что означают статусы» в «что значат статусы А и Б», «входит ли образец из полимера в цену» в «кто решает ... и его стоимость»',
    A.lines.includes('- что значат статусы «Есть образец» и «Пример работы» (p4/B01-hero, p4/B02-x)') && A.lines.includes('- кто решает про образец из полимера и его стоимость (p5/B01-hero, p5/B02-x)'), A.ask);
  check('счет с уточнениями: сводка и строка консоли (вопросов 8, строк 18, слито 10, уточнений «также» 3)',
    /вопросов заказчику: 8 \(строк было 18: слито повторов 10, пометок писателей для оператора 0; уточнений «также» под вопросами 3\)/.test(A.sum)
    && /вопросов заказчику 8 \[слито повторов 10, пометок писателей 0, уточнений «также» 3\]/.test(A.stdout) && A.top.length === 8, A.sum + A.stdout);
  check('report-questions.json: уточнение помечено also, у сборной строки (g6 и g8) - linked, raw = вопросы + слитые + пометки',
    A.qj.also === 3 && A.qj.questions.reduce((n, q) => n + 1 + q.merged.length, 0) + A.qj.notes.length === A.qj.raw
    && (A.qj.questions.find(q => /\(g4\)/.test(q.text)) || { merged: [] }).merged.some(m => m.also && /канал/.test(m.text))
    && ((A.qj.questions.find(q => /\(g8\)/.test(q.text)) || {}).linked || [{ places: [] }])[0].places.join() === 'p3/B03-y', JSON.stringify(A.qj).slice(0, 900));

  // ================================================================ 8. вопросы, а не пометки; пометки
  const B = runCase('notes', {
    needs: {
      'p1/B01-hero': ['пересчет срока и цены при изменениях - нет факта, не обещан'],
      'p1/B02-x': ['Что покрывает гарантия и как ее получить - нет факта, запрос заказчику записан в handoff_note'],
      'p1/B03-y': ['Строка о длине и толщине браслета - формулировка заказчика без факта (F29 снят как неверная опора), ждет подтверждения'],
      'p2/B01-hero': ['Пункт о переплавке удален: факта нет'], 'p2/B02-x': ['Отдельную плавку не обещаем - нет факта, в do_not_say'],
      'p2/B03-y': ['Добавить пример расчета в блок'],
    },
    judge: { p3: [['B01-hero', 'факт о выборе между лабораторным и натуральным камнем на один бюджет (F28)'], ['B02-x', 'ориентир срока изготовления кольца (F20 - только «зависит от сложности»)'],
      ['B03-y', 'как узнать или подогнать размер без примерки (F25 или аналог) - вопрос не ставится до факта']] },
    blind: { p3: [['B01-hero', 'Добавить, что готовое можно забрать в мастерской; если помогают с заменой украшения в проколе - сказать об этом.']] },
    facts: [{ id: 'F28', label: 'Лабораторный камень на один бюджет', value: 'крупнее', wording: 'при одном бюджете лабораторный бриллиант крупнее натурального', publish: 'yes', kind: 'claim' },
      { id: 'F20', label: 'Срок изготовления', value: 'зависит от сложности', wording: 'срок зависит от сложности', publish: 'yes', kind: 'claim' }],
  });
  check('вопросы, а не пометки: «<тема> - нет факта, не обещан» и «... записан в handoff_note» - тема без хвоста, «ждет подтверждения» - как есть',
    B.lines.includes('- пересчет срока и цены при изменениях (p1/B01-hero)') && B.lines.includes('- Что покрывает гарантия и как ее получить (p1/B02-x)')
    && B.lines.includes('- Строка о длине и толщине браслета - формулировка заказчика без факта (F29 снят как неверная опора), ждет подтверждения (p1/B03-y)'), B.ask);
  check('находки судьи и слепого читателя - вопросы: «- вопрос не ставится до факта» снят, «Добавить, что X; если Y - сказать об этом» - «подтвердить: X; Y - да или нет», «(F20 - только ...)» - вопрос',
    B.lines.includes('- как узнать или подогнать размер без примерки (F25 или аналог) (p3/B03-y)')
    && B.lines.includes('- подтвердить: готовое можно забрать в мастерской; помогают с заменой украшения в проколе - да или нет (p3/B01-hero)')
    && B.lines.includes('- ориентир срока изготовления кольца (F20 - только «зависит от сложности») (p3/B02-x)') && B.top.length === 6, B.ask);
  check('пометки: отчет о правке писателя («удален», «не обещаем ... в do_not_say», «Добавить ...»), строка только со ссылкой (F28) на факт с publish yes - с id для брифа',
    B.notes.length === 4 && B.notes.includes('- Пункт о переплавке удален: факта нет (p2/B01-hero)') && B.notes.includes('- Отдельную плавку не обещаем - нет факта, в do_not_say (p2/B02-x)')
    && B.notes.includes('- Добавить пример расчета в блок (p2/B03-y)')
    && B.notes.includes('- факт о выборе между лабораторным и натуральным камнем на один бюджет (F28) (p3/B01-hero; факт есть: F28 - в бриф страницы)')
    && (B.qj.notes.find(n => /F28/.test(n.text)) || {}).why === 'known', B.ask);

  // ================================================================ 9. разные факты, id судьи, одинаковый текст после снятия хвоста
  const C = runCase('facts', {
    unknowns: { p1: ['Доплата за наступление (данные блога x.рф) (F69): не утверждать', 'Доплата за продвижение (данные блога x.рф) (F70): не утверждать',
      'не подтверждено: Доплата за наступление (данные блога x.рф)', 'Единовременная выплата (данные y.ru) (F61): не утверждать',
      'Африканский корпус: единовременная выплата (данные y.ru) (F73): не утверждать', 'не подтверждено: Единовременная выплата (данные y.ru)',
      'не подтверждено: Земельный сертификат (данные y.ru)', 'Земельный сертификат (данные y.ru) (F63): не утверждать', 'Земельный сертификат (F90): не утверждать'] },
    needs: {
      'p1/B01-hero': ['материал штанги - нет факта (judge-r3-012)'], 'p2/B01-hero': ['материал цепочки - нет факта (judge-r2-004)'], 'p2/B02-x': ['материал штанги', 'материал цепочки'],
      'p3/B01-hero': ['цена - нет факта F99'], 'p3/B02-x': ['цена - нет факта (F98)'], 'p1/B02-x': ['цена доставки'], 'p2/B03-y': ['цена изделия'],
    },
  });
  check('разные факты не сливаются: F69 и F70 (скобка-источник «данные блога x.рф» не в основах), F73 и F61; «не подтверждено: X» и «X (Fnn)» - одна строка',
    C.lines.includes('- не подтверждено: Доплата за наступление (данные блога x.рф) (p1)') && C.lines.includes('- Доплата за продвижение (данные блога x.рф) (F70): не утверждать (p1)')
    && C.lines.includes('- не подтверждено: Единовременная выплата (данные y.ru) (p1)') && C.lines.includes('- Африканский корпус: единовременная выплата (данные y.ru) (F73): не утверждать (p1)')
    && !C.lines.some(l => /\(F69\)|\(F61\)/.test(l)), C.ask);
  check('id факта сверяется по группе: «Земельный сертификат (F90)» не сливается в группу с F63, хотя формулировка группы без id',
    C.lines.includes('- не подтверждено: Земельный сертификат (данные y.ru) (p1)') && C.lines.includes('- Земельный сертификат (F90): не утверждать (p1)'), C.ask);
  check('id судьи «(judge-r3-012)» не склеивает: «материал штанги» и «материал цепочки» - две строки',
    C.lines.includes('- материал штанги (p1/B01-hero, p2/B02-x)') && C.lines.includes('- материал цепочки (p2/B01-hero, p2/B02-x)'), C.ask);
  check('одинаковый после снятия хвоста текст («цена - нет факта F99» и «(F98)») - одна строка; «цена доставки» и «цена изделия» - разные',
    C.lines.filter(l => /^- цена /.test(l)).length === 3 && C.lines.includes('- цена (p3/B01-hero, p3/B02-x)') && C.lines.includes('- цена доставки (p1/B02-x)') && C.lines.includes('- цена изделия (p2/B03-y)')
    && C.top.length === 11 && /вопросов заказчику 11 \[слито повторов 6, пометок писателей 0\]/.test(C.stdout), C.ask + C.stdout);

  // ================================================================ 10. контрольный круг: правка заказчика и просьба из двух частей
  const F28 = { id: 'F28', label: 'Лабораторный и натуральный камень', value: 'при одном бюджете лабораторный камень заметно крупнее натурального', publish: 'yes', kind: 'claim' };
  const H = runCase('human-known', {
    facts: [F28],
    human: { p1: [['B07-faq', 'Срок ремонта, срочные работы', 'Заказчик просит в FAQ вопросы про срок ремонта и срочные работы', 'нет факта: сроки ремонта не называем (decisions §1 F06, A27), срочность F22 - только про изготовление цепи. Вопрос заказчику']] },
    judge: { p2: [['B07-faq', 'Спросить у заказчика: разница лабораторного и натурального камня на один бюджет (F28) и рекомендация толщины от 1,3 мм фактом брифа'], ['B08-x', 'Спросить у заказчика: выбор между лабораторным и натуральным камнем на один бюджет (F28)']] },
  });
  const inQ = re => H.lines.some(l => re.test(l)), inN = re => H.notes.some(l => re.test(l));
  check('правка заказчика, отклоненная «нет факта» (retro-stats producer human), - вопрос заказчику, не пометка фиксера', inQ(/сроки ремонта/) && !inN(/сроки ремонта/), H.ask);
  check('просьба из двух частей с известным фактом (F28) и второй частью без факта - вопрос со своим блоком; только про F28 - пометка known', inQ(/толщины от 1,3 мм.*p2\/B07-faq/) && inN(/выбор между лабораторным.*факт есть: F28/), H.ask);
  const YO2 = [0x451, 0x401, 0x2014, 0x2013].map(c => String.fromCharCode(c));
  check('сценарий 10: без е с точками и длинных тире', !YO2.some(ch => H.ask.includes(ch)));
  check('без е с точками и длинных тире в разделах проектов ревью', ![A.ask, B.ask, C.ask].some(t => /[\u0451\u0401\u2014\u2013]/.test(t)));
} catch (e) {
  fail++; failures.push(`FAIL исключение: ${e.stack || e.message}`);
} finally {
  if (process.env.SITE_TEKST_TEST_KEEP === '1') console.log(`песочница оставлена: ${tmpRoot}`);
  else fs.rmSync(tmpRoot, { recursive: true, force: true });
}

failures.forEach(f => console.log(f));
console.log(`cases-report-questions: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
