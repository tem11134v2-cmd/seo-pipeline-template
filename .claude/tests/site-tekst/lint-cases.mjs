// Тесты линтера kit /site-tekst. Запуск: node .claude/tests/site-tekst/lint-cases.mjs (или через run.mjs рядом). Код выхода 0 - все прошли.
// Корень алгоритма (TPL) - .claude/skills/site-tekst/kit; до переноса в шаблон набор жил в tests/ test-text-template.
// 1. Табличные случаи: текст + вид элемента -> какие правила есть / каких нет (scripts/lint-common.mjs напрямую).
//    Среди них editorial.* - редакционный стандарт (config/house_style.md); у случая может быть role блока (internal-detail, card-long).
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
    { id: 'F3', label: 'Доходность на аренде', value: 'до 14% годовых от стоимости объекта', wording: 'Доходность на аренде до 14% годовых от стоимости объекта' },
    { id: 'F4', label: 'Повторные заказы', value: 'треть заказов', wording: 'Треть заказов - повторные' },
  ],
};
const R = compileLint(RULES, BRIEF, { limits: { placeholders_per_page_max: 3 } });
function lintElements(elements, role) {
  const block = { block_id: 'B01-t', elements, ...(role ? { role } : {}) };
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
  // fact.embellish (A/B 2026-09-23: «до 14% уже за вычетом годовых расходов» при факте «до 14% годовых от стоимости»)
  { el: [T('text', 'В расчете доходность до 14% годовых уже за вычетом годовых расходов.', ['F3'])], has: ['fact.embellish'], sev: { 'fact.embellish': 'major' } },
  { el: [T('h1', 'Гарантированный доход до 14% годовых', ['F3'])], has: ['fact.embellish'], sev: { 'fact.embellish': 'major' } },
  { el: [T('text', 'Доходность на аренде - до 14% годовых от стоимости объекта.', ['F3'])], not: ['fact.embellish'] },
  { el: [T('text', 'Доходность до 14% годовых мы не гарантируем: это расчет по объекту.', ['F3'])], not: ['fact.embellish'] },
  { el: [T('text', 'Стабильный рост района виден по сданным домам.')], not: ['fact.embellish'] },
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
  // editorial.* - редакционный стандарт (правки заказчика 2026-09-29: «объяснение: смысл», обороты, пересказ, длинные карточки)
  // editorial.heading-colon
  { el: [T('h2', 'Кто делает украшение: более 10 мастеров в штате')], has: ['editorial.heading-colon'], sev: { 'editorial.heading-colon': 'major' } },
  { el: [T('h1', 'Золотой браслет: готовый или на заказ')], has: ['editorial.heading-colon'] },
  { el: [T('h2', 'Точно золото? Проверьте пробу по QR-коду')], has: ['editorial.heading-colon'] },
  { el: [T('h3', 'Зачем: расчет до встречи')], has: ['editorial.heading-colon'] },
  { el: [T('h2', 'Более 10 мастеров в штате')], not: ['editorial.heading-colon'] },
  { el: [T('h2', 'Доплата: цена минус ваше золото')], not: ['editorial.heading-colon'] },
  { el: [T('h2', 'Есть идея или фото?')], not: ['editorial.heading-colon'] },
  { el: [T('h2', 'Браслеты - готовые и на заказ')], not: ['editorial.heading-colon'] },
  { el: [T('h2', 'Прием с 10:00 до 20:00')], not: ['editorial.heading-colon'] },
  { el: [T('h2', 'ГОСТ 30971: монтажный шов в договоре')], not: ['editorial.heading-colon'] },
  { el: [T('text', 'Кто делает украшение: более 10 мастеров в штате.')], not: ['editorial.heading-colon'] },
  // editorial.stock-phrase
  { el: [T('h2', 'Где последнее слово за вами')], has: ['editorial.stock-phrase'], sev: { 'editorial.stock-phrase': 'major' } },
  { el: [T('h2', 'Золото ждет вашего решения')], has: ['editorial.stock-phrase'] },
  { el: [T('text', 'Без подвоха: цену называют до работы.')], has: ['editorial.stock-phrase'] },
  { el: [T('text', 'Что выйдет, знаете заранее.')], has: ['editorial.stock-phrase'] },
  { el: [T('h2', 'Цепи, кольца, серьги - откройте свой раздел')], has: ['editorial.stock-phrase'] },
  { el: [T('h2', 'Где границы работы мастерской')], has: ['editorial.stock-phrase'] },
  { el: [T('text', 'Пустой поиск - не тупик.')], has: ['editorial.stock-phrase'] },
  { el: [T('h2', 'Сначала согласуем модель')], not: ['editorial.stock-phrase'] },
  { el: [T('text', 'Цену вы узнаете до начала работы.')], not: ['editorial.stock-phrase'] },
  { el: [T('text', 'Граница участка отмечена на плане.')], not: ['editorial.stock-phrase'] },
  // editorial.sub-repeats-heading
  { el: [T('h2', 'Пробу цепи проверите сами по QR-коду'), T('text', 'Пробу цепи вы проверяете сами по QR-коду на сайте палаты. Гарантия записана в чеке.')], has: ['editorial.sub-repeats-heading'], sev: { 'editorial.sub-repeats-heading': 'major' } },
  { el: [T('h2', 'Сначала увидите результат'), T('sub', 'Результат увидите до начала работы')], has: ['editorial.sub-repeats-heading'] },
  { el: [T('h1', 'Обручальные кольца на заказ'), T('sub', 'Сделаем пару по фото или эскизу за 3 недели', ['F1'])], not: ['editorial.sub-repeats-heading'] },
  { el: [T('h2', 'Кольца'), T('sub', 'Готовые модели и кольца на заказ')], not: ['editorial.sub-repeats-heading'] },
  { el: [T('h2', 'Пробу цепи проверите сами по QR-коду'), T('note', 'Пробу цепи вы проверяете сами по QR-коду.')], not: ['editorial.sub-repeats-heading'] },
  // editorial.card-long (роли hero и conversion; сокращение перед цифрой - не конец предложения)
  { role: 'conversion', el: [{ kind: 'card', title: 'Есть только идея', text: 'Нет ни фото, ни рисунка. Опишите идею своими словами. Мастер уточнит детали.', facts: [] }], has: ['editorial.card-long'], sev: { 'editorial.card-long': 'major' } },
  { role: 'conversion', el: [{ kind: 'step', title: 'Модель', text: 'Модельер готовит 3D. Металл идет в работу после согласия. Срок зависит от сложности.', facts: [] }], has: ['editorial.card-long'] },
  { role: 'conversion', el: [{ kind: 'card', title: 'Есть только идея', text: 'Опишите ее своими словами. Этого достаточно, чтобы начать.', facts: [] }], not: ['editorial.card-long'] },
  { role: 'conversion', el: [{ kind: 'card', title: 'Самовывоз', text: 'Садовая ул., д. 12, стр. 1. Вход со двора.', facts: [] }], not: ['editorial.card-long'] },
  // сокращение с точкой перед именем с заглавной («ул. Ленина», «г. Москва») - тоже не конец предложения
  { role: 'conversion', el: [{ kind: 'card', title: 'Самовывоз', text: 'ул. Ленина, д. 5. Вход со двора.', facts: [] }], not: ['editorial.card-long'] },
  { role: 'conversion', el: [{ kind: 'card', title: 'Самовывоз', text: 'г. Москва, ул. Ленина, д. 5.', facts: [] }], not: ['editorial.card-long'] },
  { role: 'conversion', el: [{ kind: 'card', title: 'Самовывоз', text: 'ул. Ленина, д. 5. Вход со двора. Звоните заранее. Пропуск закажем.', facts: [] }], has: ['editorial.card-long'] },
  // единица или деньги с точкой перед заглавной - обычный конец предложения
  { role: 'conversion', el: [{ kind: 'card', title: 'Ремонт цепи', text: 'Цепь порвалась? Ремонт стоит от 500 руб. Пришлите фото разрыва.', facts: [] }], has: ['editorial.card-long'] },
  { role: 'conversion', el: [{ kind: 'card', title: 'Ремонт цепи', text: 'Ремонт стоит от 5 тыс. 500 руб. Пришлите фото разрыва.', facts: [] }], not: ['editorial.card-long'] },
  { role: 'info', el: [{ kind: 'card', title: 'Реквизиты', text: 'ООО «Тест». ИНН указан в договоре. Счет выставляют по запросу.', facts: [] }], not: ['editorial.card-long'] },
  // editorial.social-proof
  { el: [T('text', 'Многие клиенты приходят по рекомендации.')], has: ['editorial.social-proof'], sev: { 'editorial.social-proof': 'major' } },
  { el: [T('h2', 'Мастерскую советуют знакомым')], has: ['editorial.social-proof'], sev: { 'editorial.social-proof': 'major' } },
  { el: [T('text', 'Клиенты возвращаются снова.')], has: ['editorial.social-proof'] },
  { el: [T('text', 'Треть заказов повторные: клиенты возвращаются снова.', ['F4'])], not: ['editorial.social-proof'] },
  { el: [T('text', 'Клиенты возвращаются снова.', ['F4'])], not: ['editorial.social-proof'] },
  { el: [T('text', 'Отзывы клиентов - на Яндекс Картах.')], not: ['editorial.social-proof'] },
  // editorial.internal-detail (только роли hero и conversion; minor)
  { role: 'conversion', el: [T('text', 'Отливку делает сторонняя компания.')], has: ['editorial.internal-detail'], sev: { 'editorial.internal-detail': 'minor' } },
  { role: 'hero', el: [T('sub', 'Часть работ ведет подрядчик')], has: ['editorial.internal-detail'] },
  { role: 'info', el: [T('text', 'Отливку делает сторонняя компания.')], not: ['editorial.internal-detail'] },
  { role: 'conversion', el: [T('text', 'Выбор модели на стороне клиента.')], not: ['editorial.internal-detail'] },
  { role: 'conversion', el: [T('text', 'Мы передаем литье подрядчику.')], has: ['editorial.internal-detail'] },
  { role: 'conversion', el: [T('text', 'Подрядчик отливает изделие за 3 дня.')], has: ['editorial.internal-detail'] },
  { role: 'conversion', el: [T('text', 'Часть работ отдаем на аутсорс.')], has: ['editorial.internal-detail'] },
  // собственная услуга компании в других нишах - не производственная кухня
  { role: 'hero', el: [T('h1', 'Генеральный подрядчик по строительству домов')], not: ['editorial.internal-detail'] },
  { role: 'hero', el: [T('text', 'Генеральный подрядчик выполняет весь цикл работ. Ведем объект как генеральный подрядчик.')], not: ['editorial.internal-detail'] },
  { role: 'hero', el: [T('h1', 'Бухгалтерия на аутсорсе для малого бизнеса')], not: ['editorial.internal-detail'] },
  // editorial.stock-phrase «границы работ»: в заголовке и в форме «где границы» - оборот, в тексте - условие договора
  { el: [T('text', 'Состав и границы работ фиксируем в смете.')], not: ['editorial.stock-phrase'] },
  { el: [T('h2', 'Границы нашей работы')], has: ['editorial.stock-phrase'] },
  { el: [T('text', 'Где границы заказа, расскажем на встрече.')], has: ['editorial.stock-phrase'] },
  // editorial.sub-repeats-heading для text: новая информация (способ, срок) - не пересказ; начало с пересказа заголовка - пересказ
  { el: [T('h2', 'Доставка по Москве и России'), T('text', 'Доставка по Москве курьером за 1 день, по России СДЭК за 3-5 дней.')], not: ['editorial.sub-repeats-heading'] },
  { el: [T('h2', 'Гарантия на ремонт 6 месяцев'), T('text', 'Гарантия на ремонт 6 месяцев записана в квитанции и действует в любом филиале.')], has: ['editorial.sub-repeats-heading'] },
  // пересказ во второй части предложения после «, а» - тоже пересказ
  { el: [T('h2', 'Качество проверите сами по QR-коду'), T('text', 'Изделие проходит контроль до выдачи, а качество вы проверяете сами по QR-коду.')], has: ['editorial.sub-repeats-heading'] },
  // пересекающиеся обороты - одна находка
  { el: [T('h2', 'Где границы работы мастерской')], custom: f => f.filter(x => x.rule === 'editorial.stock-phrase').length === 1 },
];
const SEV = { minor: 1, major: 2, blocker: 3 };
CASES.forEach((c, i) => {
  const found = lintElements(c.el, c.role);
  const label = `#${i + 1} ${c.el.map(e => e.text || e.title || e.q || (e.items || []).join(' / ')).join(' + ').slice(0, 70)}`;
  for (const r of c.has || []) check(`${label} -> есть ${r}`, found.some(f => f.rule === r), `найдено: ${[...new Set(found.map(f => f.rule))].join(', ') || 'ничего'}`);
  for (const r of c.not || []) check(`${label} -> нет ${r}`, !found.some(f => f.rule === r), found.filter(f => f.rule === r).map(f => f.problem).join('; '));
  if (c.custom) check(`${label} -> проверка случая`, c.custom(found), found.map(f => `${f.rule}: ${f.problem}`).join('; '));
  for (const [r, s] of Object.entries(c.sev || {})) {
    const top = found.filter(f => f.rule === r).reduce((m, f) => Math.max(m, SEV[f.severity]), 0);
    check(`${label} -> ${r} = ${s}`, top === SEV[s], `получено ${Object.keys(SEV).find(k => SEV[k] === top) || 'нет находки'}`);
  }
});
// проектные добавки editorial.* - config/project.json -> lint_extra.editorial (массив дописывается, null выключает подсекцию)
{
  const RX = compileLint(RULES, BRIEF, { lint_extra: { editorial: { heading_colon: { exceptions: ['^проба\\b'] }, internal_detail: null } } });
  const f = scanBlock({ block_id: 'B01-t', role: 'conversion', elements: [T('h2', 'Проба 585: что значит клеймо'), T('h2', 'Кто делает: мастера в штате'), T('text', 'Литье делает подрядчик.')] }, RX).findings.map(x => x.rule);
  check('lint_extra: исключение проекта снимает heading-colon, исключения kit и остальные заголовки работают', f.filter(r => r === 'editorial.heading-colon').length === 1, f.join(', '));
  check('lint_extra: internal_detail null - правило выключено', !f.includes('editorial.internal-detail'), f.join(', '));
  check('lint_extra: без добавок kit не меняется', RULES.editorial.internal_detail && lintElements([T('text', 'Литье делает подрядчик.')], 'conversion').some(x => x.rule === 'editorial.internal-detail'));
}
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
      { block_id: 'B04-terms', role: 'info', cta_allowed: false, elements: [{ kind: 'h2', count: '0-1' }, { kind: 'text', count: '1' }] },
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
    // editorial.* через CLI: заголовок «объяснение: смысл» - major, вердикт fix и код 1; роль блока для internal-detail - из брифа
    qblk('B03-text', [T('h2', 'Кто считает доход: специалист по объекту'), T('text', 'Доход считают по договору аренды и графику платежей. Отливку делает сторонняя компания.')]);
    const e1 = node(Q, ['scripts/lint.mjs', 'work/pages/q/blocks/B03-text.json']);
    const e1r = JSON.parse(fs.readFileSync(path.join(Q, 'work', 'audit', 'q', 'lint-B03-text.json'), 'utf8'));
    check('editorial CLI: heading-colon major -> fix, код 1', e1r.verdict === 'fix' && e1.code === 1 && e1r.findings.some(f => f.rule === 'editorial.heading-colon' && f.severity === 'major'), e1.out);
    check('editorial CLI: internal-detail в conversion - minor и печатается', e1r.findings.some(f => f.rule === 'editorial.internal-detail' && f.severity === 'minor') && /\[minor\] editorial\.internal-detail/.test(e1.out), e1.out);
    qblk('B03-text', [T('h2', 'Специалист считает доход по объекту'), T('text', 'Доход считают по договору аренды и графику платежей.')]);
    const e2 = node(Q, ['scripts/lint.mjs', 'work/pages/q/blocks/B03-text.json']);
    check('editorial CLI: исправленный блок - pass, код 0', e2.code === 0 && !/editorial\./.test(e2.out), e2.out);
    // B04: в файле блока роль conversion, в брифе info - берется роль брифа; h2 count 0-1 - блок без h2 проходит
    fs.writeFileSync(path.join(qdir, 'blocks', 'B04-terms.json'), JSON.stringify({ block_id: 'B04-terms', type: 'test', role: 'conversion', elements: [T('text', 'Отливку делает сторонняя компания, сроки те же.')], facts_used: [], objections_closed: [], summary: 'синтетический блок теста', handoff_note: '' }, null, 2));
    const e3 = qlint('B04-terms');
    check('editorial CLI: роль info из брифа - без internal-detail; h2 0-1 - без structure.element-missing', !rules(e3).includes('editorial.internal-detail') && !rules(e3).includes('structure.element-missing'), JSON.stringify(e3.findings));
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
