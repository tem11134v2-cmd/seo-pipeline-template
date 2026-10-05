// Раздел отчета «Что спросить у заказчика» (report.mjs): пометки писателей отдельно, слияние повторов без LLM. Запуск:
//   node .claude/tests/site-tekst/cases-report-questions.mjs      код выхода 0 - все прошли (или через run.mjs рядом).
// Все во временной папке (os.tmpdir()), синтетические данные, без сети и без данных клиентов; скрипты - из kit шаблона.
// Разделы: 1. слияние по ссылке gN в строку анализа (места - «ждут ответа»), переформулированные повторы в одну строку
// (объединение мест, формулировка полнее, хвост «- запросить у заказчика» снят), поручение «Запросить у заказчика факт: X» -
// вопрос X; 2. разные вопросы с общими словами не сливаются («сколько стоит замер» и «сколько стоит монтаж», «срок» и
// «стоимость» доставки); 3. пометки писателей - подразделом для оператора (правка «удален», одни id, lint и «нет в брифе»,
// «нет факта Fxx» при факте с publish yes), «нет факта» о неизвестном факте - вопрос; 4. чип КФ - своя строка с основанием,
// похожая строка писателя в него не сливается; 5. порядок (анализ, слитые по числу мест, остальные), счет в сводке и в строке
// консоли, report-questions.json (каждая сырая строка - в вопросе или в пометках); 6. без вопросов - «вопросов нет».
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
  check('пометки - подразделом для оператора: правка «удален», одни id, lint и «нет в брифе», «нет факта F05» (факт есть)', nLines.length === 4 && nLines.includes('- Пункт о скидке удален: факта нет (home/B02-faq)') && nLines.includes('- F05 (home/B02-faq)') && nLines.includes('- F05 нет в брифе страницы - lint fact.unknown blocker (s1/B03-reviews)') && nLines.includes('- гарантия на монтаж - нет факта F05 в брифе (s2/B01-hero)'), notePart);
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
} catch (e) {
  fail++; failures.push(`FAIL исключение: ${e.stack || e.message}`);
} finally {
  if (process.env.SITE_TEKST_TEST_KEEP === '1') console.log(`песочница оставлена: ${tmpRoot}`);
  else fs.rmSync(tmpRoot, { recursive: true, force: true });
}

failures.forEach(f => console.log(f));
console.log(`cases-report-questions: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
