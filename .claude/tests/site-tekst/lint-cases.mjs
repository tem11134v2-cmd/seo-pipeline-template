// Тесты линтера kit /site-tekst. Запуск: node .claude/tests/site-tekst/lint-cases.mjs (или через run.mjs рядом). Код выхода 0 - все прошли.
// Корень алгоритма (TPL) - .claude/skills/site-tekst/kit; до переноса в шаблон набор жил в tests/ test-text-template.
// 1. Табличные случаи: текст + вид элемента -> какие правила есть / каких нет (scripts/lint-common.mjs напрямую).
// 2. Бюджеты страницы на синтетической странице во временной папке: lint.mjs и lint-page.mjs как CLI.
// 3. Регрессия старых правил: смоук по examples/smoke-fixtures (B02-benefits blocked с 8 ошибками, остальные блоки pass).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { cyr } from '../../skills/site-tekst/kit/scripts/lib.mjs';
import { compileLint, scanBlock, applyPageBudgets } from '../../skills/site-tekst/kit/scripts/lint-common.mjs';

const TPL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'skills', 'site-tekst', 'kit');
const RULES = JSON.parse(fs.readFileSync(path.join(TPL, 'rules', 'lint.json'), 'utf8'));
let pass = 0, fail = 0;
const failures = [];
function check(name, ok, detail = '') {
  if (ok) pass++;
  else { fail++; failures.push(`FAIL ${name}${detail ? ': ' + detail : ''}`); }
}

// ---------- 1. табличные случаи ----------
const BRIEF = {
  terminology: { use: [{ say: 'рассрочка 0% на период строительства' }] }, company: 'Тест', subject: 'Главная', geo: '',
  facts: [
    { id: 'F1', label: 'Налоги при покупке', value: 'налог на покупку платит продавец', wording: 'Налог на покупку платит продавец' },
    { id: 'F2', label: 'Цена в каталоге', value: 'цена застройщика', wording: 'Цена в каталоге - цена застройщика, наценки агентства нет' },
  ],
};
const R = compileLint(RULES, BRIEF, { limits: { placeholders_per_page_max: 3 } });
function lintElements(elements) {
  const block = { block_id: 'B01-t', elements };
  const scan = scanBlock(block, R);
  const paged = applyPageBudgets([{ block_id: block.block_id, scan }], R).get(block.block_id);
  return [...scan.findings, ...paged];
}
const T = (kind, text, facts = []) => ({ kind, text, facts });
const cards = titles => titles.map(t => ({ kind: 'card', title: t, text: 'Расчет по объекту собирают на встрече.', facts: [] }));
// has / not - id правил; sev - ожидаемая severity (самая высокая среди находок правила)
const CASES = [
  // ai.contrast
  { el: [T('text', 'Доход считают по документам, а не по обещаниям.')], has: ['ai.contrast'], sev: { 'ai.contrast': 'minor' } },
  { el: [T('text', 'Это не ремонт, а реконструкция фасада.')], has: ['ai.contrast'] },
  { el: [T('text', 'Сопровождение не только до договора, но и после сдачи.')], has: ['ai.contrast'] },
  { el: [T('text', 'В отличие от банка, рассрочка идет без справок.')], has: ['ai.contrast'] },
  { el: [T('text', 'Зато платежи идут до сдачи дома.')], has: ['ai.contrast'] },
  { el: [T('text', 'Не просто подбор квартиры, а расчет дохода.')], has: ['ai.contrast'] },
  { el: [T('text', 'Считают, а не обещают. Документы, а не рендеры. Договор, а не слова.')], has: ['ai.contrast'], sev: { 'ai.contrast': 'major' } },
  { el: [T('sub', 'Считают, а не обещают. Документы, а не рендеры. Договор, а не слова.')], has: ['ai.contrast'], sev: { 'ai.contrast': 'minor' } },
  { el: [T('h2', 'Доход считают, а не обещают')], has: ['ai.contrast'], sev: { 'ai.contrast': 'minor' } },
  { el: [T('text', 'Монтаж идет по стандарту, а гарантия записана в договоре.', ['F1'])], not: ['ai.contrast'] },
  { el: [T('text', 'Если район не подошел, меняете район.')], not: ['ai.contrast'] },
  { el: [T('text', 'Цена не меняется, а также видна в договоре.')], not: ['ai.contrast'] },
  // ai.neg-pitch
  { el: [T('text', 'Платить все разом не нужно.')], has: ['ai.neg-pitch'] },
  { el: [T('text', 'Никаких скрытых платежей в расчете.')], has: ['ai.neg-pitch'] },
  { el: [T('text', 'Вы не платите агентству за подбор.')], has: ['ai.neg-pitch'] },
  { el: [T('text', 'Ненужные расходы видны в расчете.')], not: ['ai.neg-pitch'] },
  { el: [T('text', 'Нужно ли лететь на встречу, решаете вы.')], not: ['ai.neg-pitch'] },
  // ai.self-defense
  { el: [T('text', 'Не как у других: договор на русском языке.')], has: ['ai.self-defense'], sev: { 'ai.self-defense': 'major' } },
  { el: [T('text', 'Забудьте о переплатах за посредников.')], has: ['ai.self-defense'], sev: { 'ai.self-defense': 'major' } },
  { el: [T('text', 'Больше не придется ждать мастера.')], has: ['ai.self-defense'], not: ['ai.neg-pitch'] },
  { el: [T('h2', 'Забудьте о переплатах')], has: ['ai.self-defense'], sev: { 'ai.self-defense': 'minor' } },
  { el: [T('text', 'Как у застройщика, цена одна.')], not: ['ai.self-defense'] },
  // ai.summary и style.summary-tail
  { el: [T('text', 'Таким образом, вы видите весь расчет.')], has: ['ai.summary'], sev: { 'ai.summary': 'major' } },
  { el: [T('text', 'Итак, расчет готов к встрече.')], has: ['ai.summary'], not: ['style.summary-tail'] },
  { el: [T('text', 'Подводя итоги, специалист отвечает на вопросы. Встреча проходит в офисе.')], has: ['ai.summary'] },
  { el: [T('text', 'В итоге вы получаете ключи. Договор хранится у вас.')], not: ['ai.summary', 'style.summary-tail'] },
  { el: [T('text', 'Расчет собирают на встрече. В результате вы видите доход до депозита.')], has: ['style.summary-tail'], sev: { 'style.summary-tail': 'major' } },
  { el: [{ kind: 'bullets', items: ['Подборка объектов', 'Расчет по объекту', 'В итоге все в одном документе'], facts: [] }], has: ['style.summary-tail'] },
  { el: [T('text', 'В результате вы видите доход. Встреча проходит в офисе.')], not: ['style.summary-tail'] },
  { el: [T('text', 'В результате вы видите доход до депозита.'), T('note', 'Цены подтверждает специалист.')], not: ['style.summary-tail'] },
  // minor-правила
  { el: [T('text', 'Важно отметить, что цена одна.')], has: ['ai.filler'], sev: { 'ai.filler': 'minor' } },
  { el: [T('text', 'Как известно, рынок растет.')], has: ['ai.filler'] },
  { el: [T('text', 'Важно для вас: цена одна.')], not: ['ai.filler'] },
  { el: [T('text', 'Давайте разберемся, как устроен расчет.')], has: ['ai.transition'] },
  { el: [T('text', 'Перейдем к документам застройщика.')], has: ['ai.transition'] },
  { el: [T('text', 'Переход к расчету идет на встрече.')], not: ['ai.transition'] },
  { el: [T('text', 'Это очень важно для семьи.')], has: ['ai.amplifier'] },
  { el: [T('text', 'Рассрочка значительно повышает доступность покупки.')], has: ['ai.amplifier'] },
  { el: [T('text', 'Рассрочка значительно повышает доступность на 30%.', ['F1'])], not: ['ai.amplifier'] },
  { el: [T('text', 'В целях экономии расчет идет строками.')], has: ['ai.office2'] },
  { el: [T('text', 'Оплата посредством банковского перевода.')], has: ['ai.office2'] },
  { el: [T('text', 'В связи с тем, что стройка идет, платежи растянуты.')], has: ['ai.office2'] },
  { el: [T('text', 'Расчет является частью сделки.')], not: ['ai.office2'] },
  { el: [T('text', 'Проверяем застройщика, чтобы вы не рисковали деньгами.')], has: ['ai.goal-neg'] },
  { el: [T('text', 'Считаем заранее, чтобы не переплачивать.')], has: ['ai.goal-neg'] },
  { el: [T('text', 'Считаем заранее, чтобы вы видели доход.')], not: ['ai.goal-neg'] },
  { el: [T('h2', 'Чтобы не переплачивать')], not: ['ai.goal-neg'] },
  { el: [T('text', 'Не платите, не ждите и не рискуйте.')], has: ['ai.triple-neg'] },
  { el: [T('text', 'Если район не подошел, не спешите и не покупайте.')], has: ['ai.triple-neg'] },
  { el: [T('text', 'Не платите за подбор и не ждите ответа.')], not: ['ai.triple-neg'] },
  { el: [T('text', 'Наше агентство ведет сделку до депозита.')], has: ['ai.third-person'] },
  { el: [T('text', 'Специалисты компании проверяют документы.')], has: ['ai.third-person'] },
  { el: [T('text', 'Специалист ведет сделку до депозита.')], not: ['ai.third-person'] },
  { el: [T('text', 'Три сайта дают разные цифры.')], has: ['ai.num-word'] },
  { el: [T('text', 'Ответ приходит за две недели.')], has: ['ai.num-word'] },
  { el: [T('text', 'Выбор идет внутри двух регионов.')], has: ['ai.num-word'] },
  { el: [T('h2', 'Пять шагов до депозита')], has: ['ai.num-word'], sev: { 'ai.num-word': 'minor' } },
  { el: [T('text', 'Регионов в подборке два, и среда разная.')], not: ['ai.num-word'] },
  { el: [T('text', 'Расчет готов в два счета.')], not: ['ai.num-word'] },
  { el: [T('text', 'Раздел «Пять шагов» открыт в меню.')], not: ['ai.num-word'] },
  { el: [T('text', 'Один специалист ведет сделку.')], not: ['ai.num-word'] },
  // style.same-start
  { el: [{ kind: 'bullets', items: ['Ваши решения по объекту', 'Ваши вопросы к расчету', 'Ваше слово после расчета'], facts: [] }], has: ['style.same-start'], sev: { 'style.same-start': 'minor' } },
  { el: cards(['Первый шаг - расчет', 'Первый шаг - взносы', 'Первый шаг - аренда']), has: ['style.same-start'] },
  { el: [{ kind: 'bullets', items: ['Не переплачиваете агентству', 'Не ждете ответа сутками', 'Не рискуете депозитом'], facts: [] }], has: ['style.same-start'] },
  { el: [{ kind: 'bullets', items: ['Сумма и срок', 'Список комплексов', 'Расчет по объекту'], facts: [] }], not: ['style.same-start'] },
  { el: [{ kind: 'bullets', items: ['Ваши решения', 'Ваши вопросы', 'Расчет по объекту'], facts: [] }], not: ['style.same-start'] },
  { el: [{ kind: 'bullets', items: ['В каталоге цена застройщика', 'В офисе встреча очно', 'В расчете годовые расходы'], facts: [] }], not: ['style.same-start'] },
  { el: ['Можно ли начать без всей суммы?', 'Можно ли отказаться после расчета?', 'Можно ли купить удаленно?'].map(q => ({ kind: 'qa', q, a: 'Да, это разбирают на встрече.', facts: [] })), not: ['style.same-start'] },
  // fact.claim-unsupported
  { el: [T('text', 'Налог на покупку платит продавец.')], has: ['fact.claim-unsupported'], sev: { 'fact.claim-unsupported': 'minor' } },
  { el: [T('text', 'Комиссию агентству покупатель не платит.')], has: ['fact.claim-unsupported'] },
  { el: [T('text', 'Рассылок и звонков после заявки нет.')], has: ['fact.claim-unsupported'] },
  { el: [T('text', 'Налог на покупку платит продавец.', ['F1'])], not: ['fact.claim-unsupported'] },
  // строгий вариант: факты у элемента есть, но ни один (label, value, wording) не содержит основу маркера
  { el: [T('text', 'Комиссия покупателя - первый вопрос: в каталоге стоит цена застройщика.', ['F2'])], has: ['fact.claim-unsupported'], sev: { 'fact.claim-unsupported': 'minor' } },
  { el: [T('text', 'Гарантии - только те, что записаны в договоре с застройщиком.', ['F2'])], has: ['fact.claim-unsupported'] },
  { el: [T('text', 'Налоги и комиссия агентства разбирают на встрече.', ['F1'])], has: ['fact.claim-unsupported'] },
  { el: [T('text', 'Налог при покупке платит продавец, цена застройщика та же.', ['F1', 'F2'])], not: ['fact.claim-unsupported'] },
  { el: [T('text', 'Есть ли налог на покупку?')], not: ['fact.claim-unsupported'] },
  { el: [T('text', 'Стройку закончат к сроку сдачи.')], not: ['fact.claim-unsupported'] },
  { el: [{ kind: 'qa', q: 'Какие налоги платит покупатель?', a: 'Ответ дает специалист на встрече.', facts: [] }], not: ['fact.claim-unsupported'] },
];
const SEV = { minor: 1, major: 2, blocker: 3 };
CASES.forEach((c, i) => {
  const found = lintElements(c.el);
  const label = `#${i + 1} ${c.el.map(e => e.text || e.title || e.q || (e.items || []).join(' / ')).join(' + ').slice(0, 70)}`;
  for (const r of c.has || []) check(`${label} -> есть ${r}`, found.some(f => f.rule === r), `найдено: ${[...new Set(found.map(f => f.rule))].join(', ') || 'ничего'}`);
  for (const r of c.not || []) check(`${label} -> нет ${r}`, !found.some(f => f.rule === r), found.filter(f => f.rule === r).map(f => f.problem).join('; '));
  for (const [r, s] of Object.entries(c.sev || {})) {
    const top = found.filter(f => f.rule === r).reduce((m, f) => Math.max(m, SEV[f.severity]), 0);
    check(`${label} -> ${r} = ${s}`, top === SEV[s], `получено ${Object.keys(SEV).find(k => SEV[k] === top) || 'нет находки'}`);
  }
});
// граница слова для кириллицы: паттерны lint.json с границей слова идут через cyr() (баг старого lint-page: ASCII-граница перед «не»)
check('cyr: we_start_pattern ловит «Мы - ...»', cyr(RULES.we_start_pattern).test('Мы - надежная компания'));
check('cyr: we_start_pattern не ловит «Мыло»', !cyr(RULES.we_start_pattern).test('Мыло в подарок'));
// office-speak (vague_patterns): формы «осуществля*», «является/являются», «данный» в единственном числе; «данные» - сведения, не ловим
{
  const office = cyr(RULES.vague_patterns.find(v => v.id === 'office-speak').pattern);
  for (const s of ['Агентство осуществляет подбор квартиры.', 'Специалист осуществлял проверку.', 'Расчет является частью сделки.', 'Платежи являются частью графика.', 'Данный объект сдан.', 'В данном случае платит продавец.', 'Данная услуга идет отдельно.', 'Цена данного комплекса видна в расчете.', 'Встреча в рамках сделки.'])
    check(`office-speak ловит: ${s}`, office.test(s));
  for (const s of ['Данные клиента хранятся в договоре.', 'По данным застройщика, дом сдан.', 'Данных по налогам пока нет.', 'Сделка явная и прозрачная.'])
    check(`office-speak не ловит: ${s}`, !office.test(s));
}

// ---------- 2. бюджеты страницы на синтетической странице ----------
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lint-cases-'));
function node(cwd, args) { const r = spawnSync(process.execPath, args, { cwd, encoding: 'utf8' }); return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }; }
try {
  const P = path.join(tmpRoot, 'page');
  for (const d of ['scripts', 'rules', 'schemas', 'config']) fs.cpSync(path.join(TPL, d), path.join(P, d), { recursive: true });
  // механику проверяем на пороге word.overuse 8, независимо от значения в шаблоне
  { const f = path.join(P, 'rules', 'lint.json'); const r = JSON.parse(fs.readFileSync(f, 'utf8')); r.page_budgets['word.overuse'] = 8; fs.writeFileSync(f, JSON.stringify(r, null, 2)); }
  const spec = id => ({ block_id: id, role: 'conversion', elements: [{ kind: 'h2', count: '1' }, { kind: 'text', count: '1' }, { kind: 'note', count: '0-1' }] });
  const ids = ['B01-a', 'B02-b', 'B03-c', 'B04-d', 'B05-e'];
  const brief = { slug: 'p', company: 'Тест', subject: 'Главная', geo: '', cta: { main: 'Получить расчет' }, facts: [], links: [], terminology: { use: [{ say: 'рассрочка 0% на период строительства', not: 'беспроцентная рассрочка' }] }, blocks: ids.map(spec) };
  const pdir = path.join(P, 'work', 'pages', 'p');
  fs.mkdirSync(path.join(pdir, 'blocks'), { recursive: true });
  fs.writeFileSync(path.join(pdir, 'brief.json'), JSON.stringify(brief, null, 2));
  const blk = (id, els) => fs.writeFileSync(path.join(pdir, 'blocks', `${id}.json`), JSON.stringify({ block_id: id, type: 'test', role: 'conversion', elements: els, facts_used: [], objections_closed: [], summary: 'синтетический блок теста', handoff_note: '' }, null, 2));
  // тело: противопоставления 1 (B01), 1 (B02), 2 (B03) при бюджете 2; отрицания 1 (B02), 2 (B03); «депозит» 3+3+3+1+3 при пороге 8
  // (B05 - только повтор слова, без других находок);
  // «рассрочка» 3+3+3+1 - защищена терминологией брифа; плейсхолдеры 2 (B02) + 2 (B04) при лимите 3
  blk('B01-a', [T('h2', 'Цены в договоре, а не на словах'), T('text', 'Расчет идет по документам, а не по обещаниям. Депозит вносят последним шагом. Сумма депозита видна в расчете. Возврат депозита прописан в договоре. Рассрочка идет до сдачи, рассрочка без переплаты, рассрочка по графику.')]);
  blk('B02-b', [T('h2', 'Кто ведет сделку'), T('text', 'Сделку ведет специалист, а не бот. Платить все разом не нужно. Депозит фиксирует выбранную квартиру. До депозита вы ничего не подписываете. Размер депозита зависит от комплекса. Рассрочка распределяет взносы, рассрочка покрывает стройку, рассрочка видна в графике.'), T('note', 'Адрес офиса: [[нужно: адрес офиса]], телефон: [[нужно: телефон]]')]);
  blk('B03-c', [T('h2', 'Документы застройщика'), T('text', 'Смотрите бумаги, а не рендеры. Это не ремонт, а реконструкция. Ждать ответа не придется. Никаких доплат после подписи. Депозит вносят после расчета. Депозит возвращают по договору. Депозит не сгорает при отказе. Рассрочка без процентов, рассрочка до ключей, рассрочка по договору.')]);
  blk('B04-d', [T('h2', 'Вопросы перед сделкой'), T('text', 'Специалист отвечает на вопросы о депозите. Рассрочку обсуждают на встрече.'), T('note', 'Реквизиты: [[нужно: реквизиты]], срок: [[нужно: срок]]')]);
  blk('B05-e', [T('h2', 'Когда платят депозит'), T('text', 'Сумму депозита фиксирует договор. Депозит закрепляет планировку за вами.')]);
  fs.writeFileSync(path.join(P, 'work', 'sitemap.json'), JSON.stringify({ pages: [{ slug: 'p', url: '/', type: 'home', status: 'briefed' }] }, null, 2));

  const lp = node(P, ['scripts/lint-page.mjs', 'p']);
  const page = JSON.parse(fs.readFileSync(path.join(P, 'work', 'audit', 'p', 'lint-page.json'), 'utf8'));
  const F = (id, rule, sev) => page.findings.filter(f => f.block_id === id && f.rule === rule && (!sev || f.severity === sev));
  check('page: вердикт fix, код выхода 1', page.verdict === 'fix' && lp.code === 1, `${page.verdict}, код ${lp.code}\n${lp.out}`);
  check('page: ai.contrast в заголовке B01 - minor, в бюджет не входит', F('B01-a', 'ai.contrast', 'minor').length === 2 && !F('B01-a', 'ai.contrast', 'major').length);
  check('page: ai.contrast B02 - второе вхождение в бюджете', F('B02-b', 'ai.contrast', 'minor').length === 1 && !F('B02-b', 'ai.contrast', 'major').length);
  check('page: ai.contrast B03 - один major на блок, в нем 2 вхождения', F('B03-c', 'ai.contrast', 'major').length === 1 && /сверх бюджета 2/.test(F('B03-c', 'ai.contrast', 'major')[0]?.problem || ''), JSON.stringify(F('B03-c', 'ai.contrast')));
  check('page: ai.contrast major только в B03', page.findings.filter(f => f.rule === 'ai.contrast' && f.severity === 'major').length === 1);
  check('page: ai.neg-pitch B03 - 1 в бюджете, 1 сверх', F('B03-c', 'ai.neg-pitch', 'minor').length === 1 && F('B03-c', 'ai.neg-pitch', 'major').length === 1);
  check('page: ai.neg-pitch B02 - minor', F('B02-b', 'ai.neg-pitch', 'minor').length === 1 && !F('B02-b', 'ai.neg-pitch', 'major').length);
  check('page: word.overuse «депози» - major в B03 и B04, не в B01/B02', F('B03-c', 'word.overuse', 'major').length === 1 && F('B04-d', 'word.overuse', 'major').length === 1 && !F('B01-a', 'word.overuse').length && !F('B02-b', 'word.overuse').length, JSON.stringify(page.findings.filter(f => f.rule === 'word.overuse').map(f => f.block_id + ' ' + f.problem)));
  check('page: word.overuse - major и в B05, где кроме повтора слова ничего нет', F('B05-e', 'word.overuse', 'major').length === 1);
  {
    const r5 = JSON.parse(fs.readFileSync(path.join(P, 'work', 'audit', 'p', 'lint-B05-e.json'), 'utf8'));
    check('block: B05 pass, word.overuse в lint.mjs - minor', r5.verdict === 'pass' && r5.findings.some(f => f.rule === 'word.overuse' && f.severity === 'minor') && !r5.findings.some(f => f.rule === 'word.overuse' && f.severity !== 'minor'), JSON.stringify(r5.findings.map(f => f.rule + ':' + f.severity)));
    check('page: строка блока B05 - pass', /B05-e: pass/.test(lp.out), lp.out);
    const l5 = node(P, ['scripts/lint.mjs', 'work/pages/p/blocks/B05-e.json']);
    check('block: B05 код 0 и печатает [minor] word.overuse', l5.code === 0 && /\[minor\] word\.overuse/.test(l5.out), l5.out);
    const pr = node(P, ['scripts/plan-run.mjs']);
    let plan = null; try { plan = JSON.parse(pr.out); } catch {}
    const row = plan?.pages?.find(x => x.slug === 'p');
    check('plan-run: B05 (только word.overuse) не в pending и не в lint_dirty, B03 - в pending', !!row && !row.pending_blocks.includes('B05-e') && !row.lint_dirty.includes('B05-e') && row.pending_blocks.includes('B03-c'), pr.out.slice(0, 400));
  }
  check('page: word.overuse не ловит «рассрочку» из терминологии брифа', !page.findings.some(f => f.rule === 'word.overuse' && /рассро/.test(f.problem)));
  check('page: placeholder.count - major только в B04 (4 при лимите 3)', F('B04-d', 'placeholder.count', 'major').length === 1 && !F('B02-b', 'placeholder.count').length);
  check('page: нет старого style.contrast-overuse', !page.findings.some(f => f.rule === 'style.contrast-overuse'));
  check('page: сводка печатает minor ai.*', /minor ai\.\*/.test(lp.out) && /"ai\.num-word"|"ai\.contrast"/.test(lp.out), lp.out);
  // lint.mjs на отдельных блоках: бюджет по блокам выше + сам блок
  const l1 = node(P, ['scripts/lint.mjs', 'work/pages/p/blocks/B01-a.json']);
  const r1 = JSON.parse(fs.readFileSync(path.join(P, 'work', 'audit', 'p', 'lint-B01-a.json'), 'utf8'));
  check('block: B01 pass (блоки ниже в его бюджет не входят)', r1.verdict === 'pass' && l1.code === 0, l1.out);
  check('block: B01 печатает [minor] ai.contrast', /\[minor\] ai\.contrast/.test(l1.out), l1.out);
  const l3 = node(P, ['scripts/lint.mjs', 'work/pages/p/blocks/B03-c.json']);
  const r3 = JSON.parse(fs.readFileSync(path.join(P, 'work', 'audit', 'p', 'lint-B03-c.json'), 'utf8'));
  const has3 = (rule, sev) => r3.findings.some(f => f.rule === rule && f.severity === sev);
  check('block: B03 fix с major ai.contrast, ai.neg-pitch и minor word.overuse', r3.verdict === 'fix' && l3.code === 1 && has3('ai.contrast', 'major') && has3('ai.neg-pitch', 'major') && has3('word.overuse', 'minor') && !has3('word.overuse', 'major'), l3.out);
  check('block: B03 печатает [minor] ai.neg-pitch', /\[minor\] ai\.neg-pitch/.test(l3.out), l3.out);
  const r4 = (node(P, ['scripts/lint.mjs', 'work/pages/p/blocks/B04-d.json']), JSON.parse(fs.readFileSync(path.join(P, 'work', 'audit', 'p', 'lint-B04-d.json'), 'utf8')));
  check('block: B04 placeholder.count по странице (2 выше + 2 свои)', r4.findings.some(f => f.rule === 'placeholder.count' && f.severity === 'major'));
  const r2 = (node(P, ['scripts/lint.mjs', 'work/pages/p/blocks/B02-b.json']), JSON.parse(fs.readFileSync(path.join(P, 'work', 'audit', 'p', 'lint-B02-b.json'), 'utf8')));
  check('block: B02 без placeholder.count (2 при лимите 3)', !r2.findings.some(f => f.rule === 'placeholder.count'));

  // кнопки (находки второго пилота): утвержденный CTA брифа не мерится лимитом из замеров конкурентов;
  // кнопки интерфейса (шаблон требует button, CTA не разрешен) не считаются CTA, но лимит длины для них остается
  {
    const Q = path.join(tmpRoot, 'buttons');
    for (const d of ['scripts', 'rules', 'schemas', 'config']) fs.cpSync(path.join(TPL, d), path.join(Q, d), { recursive: true });
    const qb = { slug: 'q', company: 'Тест', subject: 'Категория', geo: '', cta: { main: 'Получить расчет по объекту' }, facts: [], links: [], terminology: { use: [] }, blocks: [
      { block_id: 'B01-hero', role: 'hero', cta_allowed: true, elements: [{ kind: 'h1', count: '1' }, { kind: 'button', count: '1', chars: { min: 8, median: 12, max: 14 } }] },
      { block_id: 'B02-filters', role: 'conversion', cta_allowed: false, elements: [{ kind: 'h2', count: '1' }, { kind: 'button', count: '2', chars: { min: 6, median: 10, max: 16 } }] },
      { block_id: 'B03-text', role: 'conversion', cta_allowed: false, elements: [{ kind: 'h2', count: '1' }, { kind: 'text', count: '1' }] },
    ] };
    const qdir = path.join(Q, 'work', 'pages', 'q');
    fs.mkdirSync(path.join(qdir, 'blocks'), { recursive: true });
    fs.writeFileSync(path.join(qdir, 'brief.json'), JSON.stringify(qb, null, 2));
    const qblk = (id, els) => fs.writeFileSync(path.join(qdir, 'blocks', `${id}.json`), JSON.stringify({ block_id: id, type: 'test', role: id === 'B01-hero' ? 'hero' : 'conversion', elements: els, facts_used: [], objections_closed: [], summary: 'синтетический блок теста', handoff_note: '' }, null, 2));
    const qlint = id => (node(Q, ['scripts/lint.mjs', `work/pages/q/blocks/${id}.json`]), JSON.parse(fs.readFileSync(path.join(Q, 'work', 'audit', 'q', `lint-${id}.json`), 'utf8')));
    const rules = r => r.findings.map(f => f.rule);
    qblk('B01-hero', [T('h1', 'Комплексы Пхукета с расчетом дохода'), T('button', 'Получить расчет по объекту')]);
    const h = qlint('B01-hero');
    check('button: CTA брифа длиннее замера - без length.*', !rules(h).some(r => r.startsWith('length.')), JSON.stringify(h.findings));
    qblk('B02-filters', [T('h2', 'Подбор по району и сроку сдачи'), T('button', 'Показать объекты'), T('button', 'Сбросить фильтры')]);
    const u = qlint('B02-filters');
    check('button: кнопки интерфейса без cta.not-allowed, cta.one, cta.text', !rules(u).some(r => /^cta\./.test(r)), JSON.stringify(u.findings));
    qblk('B02-filters', [T('h2', 'Подбор по району и сроку сдачи'), T('button', 'Показать все объекты по выбранным параметрам'), T('button', 'Сбросить фильтры')]);
    const u2 = qlint('B02-filters');
    check('button: длинная кнопка интерфейса - length.*', rules(u2).some(r => r.startsWith('length.')), JSON.stringify(u2.findings));
    qblk('B03-text', [T('h2', 'Как считают доход'), T('text', 'Доход считают по договору аренды и графику платежей.'), T('button', 'Получить расчет по объекту')]);
    const c = qlint('B03-text');
    check('button: кнопка в обычном блоке без CTA - blocker cta.not-allowed', c.findings.some(f => f.rule === 'cta.not-allowed' && f.severity === 'blocker'), JSON.stringify(c.findings));
  }

  // ---------- 3. регрессия: смоук по фикстурам ----------
  const S = path.join(tmpRoot, 'smoke');
  const init = node(TPL, ['scripts/init-project.mjs', 'smoke', S]);
  check('smoke: init-project', init.code === 0, init.out);
  check('smoke: tests/ не копируется в проект', !fs.existsSync(path.join(S, 'tests')));
  fs.cpSync(path.join(TPL, 'examples', 'smoke-fixtures', 'work'), path.join(S, 'work'), { recursive: true });
  fs.cpSync(path.join(TPL, 'examples', 'smoke-fixtures', 'rules'), path.join(S, 'rules'), { recursive: true });
  const cfgPath = path.join(S, 'config', 'project.json');
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8')); cfg.company = 'Окна Тест'; fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  const bb = node(S, ['scripts/build-briefs.mjs']);
  check('smoke: build-briefs', bb.code === 0, bb.out);
  const PLANTED = ['house.yo', 'house.dash', 'copy.we-start', 'copy.cliche', 'fact.number-without-source', 'copy.stop-word', 'anti.A01', 'term.jargon'];
  for (const [pg, id] of [['home', 'B01-hero'], ['home', 'B02-benefits'], ['home', 'B03-process'], ['okna-rehau', 'B01-hero'], ['okna-rehau', 'B02-listing']]) {
    const res = node(S, ['scripts/lint.mjs', `work/pages/${pg}/blocks/${id}.json`]);
    const rep = JSON.parse(fs.readFileSync(path.join(S, 'work', 'audit', pg, `lint-${id}.json`), 'utf8'));
    if (id === 'B02-benefits' && pg === 'home') {
      const rules = new Set(rep.findings.filter(f => f.severity !== 'minor').map(f => f.rule));
      const missing = PLANTED.filter(r => !rules.has(r));
      check('smoke: home/B02-benefits blocked', rep.verdict === 'blocked' && res.code === 1, rep.summary);
      check('smoke: home/B02-benefits - все 8 заложенных ошибок', !missing.length, `нет: ${missing.join(', ')}`);
    } else check(`smoke: ${pg}/${id} pass`, rep.verdict === 'pass' && res.code === 0, res.out);
  }
} finally {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
}

failures.forEach(f => console.log(f));
console.log(`lint-cases: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
