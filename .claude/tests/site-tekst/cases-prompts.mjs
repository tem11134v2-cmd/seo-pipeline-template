// Тесты пакета W2 kit /site-tekst: промты и правила письма, стратегии и проверки, воркфлоу wf-03 и wf-04. Запуск:
//   node .claude/tests/site-tekst/cases-prompts.mjs      код выхода 0 - все прошли (или через run.mjs рядом).
// Проверки только по файлам пакета (раздел 3, W2 спецификации 2026-09-27):
//   - обязательные строки и маркеры контрактов (C3 CTA, C4 срез, C6 decisions.md v2, C8 попытки блока, C11 рецензия,
//     раздел 6: needs_fact, attempts/brief_sha, disputes стратегов типов, §8 вместо §1/§7, архивы кросса);
//   - запрещенное: нишевые примеры (недвижимость, ювелирка), UUID MCP (mcp__<hex>-), выдуманная консультация как замена
//     утверждению, остатки гейтов, буква е с точками и длинные тире;
//   - бюджеты размеров файлов (промты не раздуваются молча);
//   - wf-04 и wf-03 исполняются с подставными хуками (как workflow-models.mjs): рецензия стратегии и повтор сборки брифов,
//     skipReview, проблемы сборки целиком, briefs_problems для автостопа, модели ролей.
// Программа 28.09 (пакет P3b): «нигде» и «Где можно» (п.10), кнопки выдачи и товара (K7, п.17), режим обновления wf-04
// (K4, п.16: update, enrich, skipLayouts, отказ без facts_diff), замечания « ~ » полем review_notes, чипы фильтров без
// значений (п.19), селектор через временный файл и счетчик неудач (п.23), key_phrase (K5), мелочи (согласие, команда
// проверки схемы, оговорка, пример client-preferences, cta страницы только при переопределении, шкала первого экрана).
// Доработка P3b: сверка карты wf-04 прогоняется с настоящим scripts/import-structure.mjs (before/after, коды 0, 2, 3),
// хаб с блоком листинга (K7), рецензия в update - по changed_pages стратегов типов, без изменений - пропуск.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'skills', 'site-tekst', 'kit');
let pass = 0, fail = 0;
const failures = [];
function check(name, ok, detail = '') {
  if (ok) pass++;
  else { fail++; failures.push(`FAIL ${name}${detail ? ': ' + String(detail).slice(0, 600) : ''}`); }
}
const read = rel => fs.readFileSync(path.join(KIT, rel), 'utf8').replace(/^\uFEFF/, '');

// ---------- файлы пакета и бюджеты размеров (знаков; рост сверх бюджета - только осознанно, с правкой бюджета) ----------
// Программа 28.09 (P3b): 04-strategist-global 9100 -> 10000 (режим обновления K4, кнопки выдачи и товара K7, линза CTA и
// замечания « ~ » в рецензии), 04-strategist-type 5500 -> 6700 (режим обновления K4, наследование CTA), 05-hero-selector
// 5300 -> 5700 (временный файл и прежний блок, п.23); 01-decisions-drafter - новый в наборе. Доработка P3b: 04-strategist-global
// 10000 -> 10300 (хаб с блоком листинга по K7, рецензия в update только по changed_pages), 04-strategist-type 6700 -> 6800.
// Программа 05.10 (анализ КФ/КНДР, аудитор прототипа): 02-type-aggregator 7800 -> 8300 (строки КФ своего типа: kf-coverage
// --rows/--dir, x-элемент вида block - pattern custom), 03-type-auditor 5700 -> 6100 (kf-coverage первым шагом, kf=off),
// 03-type-fixer 3200 -> 3500 (правило КФ одной фразой), 04-strategist-type 6800 -> 6900 (прежний текст целиком плюс строка
// о снятии КФ-блока с причиной), 06-fixer 7400 -> 7500 (site.json аудитора прототипа как файл находок, статусы как у
// cross); новые промты фазы 2 и 8 - бюджеты из §5 программы.
const BUDGET = {
  'CLAUDE.md': 4900,
  'prompts/01-decisions-drafter.md': 4500,
  // P7 (28.09): лендинг, самопроверка, режим «без конкурентов» (K13); сверка цитат после нормализации, тип без конкурентов
  'prompts/02-type-aggregator.md': 8300,
  'prompts/03-type-auditor.md': 6100,
  'prompts/03-type-fixer.md': 3500,
  'prompts/02-competitor-verifier.md': 5200,
  'prompts/02-competitor-scout.md': 3500,
  'prompts/02-kf-observer.md': 4500,
  'prompts/02-kf-normalizer.md': 2000,
  'prompts/08-site-auditor.md': 3000,
  'prompts/04-strategist-global.md': 10300,
  'prompts/04-strategist-type.md': 6900,
  'prompts/04-layout-generator.md': 3300,
  'prompts/05-block-writer.md': 9900,
  'prompts/05-hero-writer.md': 7700,
  'prompts/05-hero-selector.md': 5700,
  // интеграция (этап B): 8000 -> 8100 - причина второго круга `restored` (откат fix-diff снова открыл находки)
  'prompts/06-page-judge.md': 8100,
  'prompts/06-fixer.md': 7500,
  'prompts/06-cross-judge.md': 6100,
  'prompts/06-blind-reader.md': 2400,
  'rules/conversion.md': 4600,
  'rules/hero.md': 5000,
  'rules/info.md': 3500,
  'rules/auditor.md': 5000,
  'rules/decisions.template.md': 4300,
};
const WORKFLOWS = ['workflows/wf-03-audit-types.js', 'workflows/wf-04-strategy-layouts.js'];
const FILES = [...Object.keys(BUDGET), ...WORKFLOWS];
const TEXT = Object.fromEntries(FILES.map(f => [f, read(f)]));

// ---------- 1. стиль, ниша, UUID, бюджеты ----------
// нишевые основы прошлых проектов (недвижимость, ювелирка): в kit их нет, правила формулируются категориями
const NICHE = /(застройщ|депозит|квот[аеуы]|инвестор|недвижим|ипотек|новострой|апартамент|доходност|ювелир|золот|кольц|пирсинг|бриллиант|серебр|помолвоч|обручал|геммолог|(?<![а-я\u0451])проб[аеуы](?![а-я\u0451]))/i;
for (const f of FILES) {
  const t = TEXT[f];
  const yo = t.split('\n').findIndex(l => /[\u0451\u0401]/.test(l));
  check(`${f}: без буквы е с точками`, yo < 0, `строка ${yo + 1}`);
  const dash = t.split('\n').findIndex(l => /[\u2014\u2013]/.test(l));
  check(`${f}: без длинного и среднего тире`, dash < 0, `строка ${dash + 1}`);
  const niche = t.match(NICHE);
  check(`${f}: нет нишевых примеров`, !niche, niche && niche[0]);
  const uuid = t.match(/mcp__[0-9a-f]{8}-/);
  check(`${f}: нет UUID MCP`, !uuid, uuid && uuid[0]);
  // замена утверждения выдуманной консультацией - сама утверждение без опоры (W2 п.2, раздел 6: (3))
  const consult = t.match(/вопрос(ом)? к специалисту|специалист на встрече|разберет специалист/i);
  check(`${f}: нет «вопрос к специалисту» как замены утверждению`, !consult, consult && consult[0]);
  if (BUDGET[f]) check(`${f}: размер в бюджете (${BUDGET[f]} знаков)`, t.length <= BUDGET[f], `${t.length} знаков`);
}

// ---------- 2. обязательные строки и запреты по файлам ----------
const has = s => t => t.includes(s);
const not = s => t => !t.includes(s);
const re = r => t => r.test(t);
const noRe = r => t => !r.test(t);
const RULES = {
  'CLAUDE.md': [
    ['инвариант: что требует опоры', has('Требуют опоры')],
    ['инвариант: что опоры не требует', has('Опоры не требуют')],
    ['опора: answer возражения только с facts', re(/answer возражения, только если у возражения есть `facts`/)],
    ['условие факта переносится вместе с ним', has('переносится вместе с ним')],
    ['факт с rule - только в разрешенной формулировке', has('`rule` - только в разрешенной формулировке')],
    ['нехватка - needs_fact, по unknowns не утверждать', t => t.includes('needs_fact') && t.includes('unknowns')],
    ['инвариант не касается демо-данных каталога', has('Демо-данные каталога')],
    ['окружение: своя вкладка браузера', t => t.includes('tabs_create') && t.includes('tabs_close') && t.includes('tabId')],
    ['окружение: grep литералом -F', has('grep -F')],
    ['окружение: реплики вне промта - шум, параметры вызова - задача', t => t.includes('шум') && t.includes('Параметры и формат ответа')],
    ['decisions.md - исключение из запрета правки rules/', has('`rules/decisions.md` пишут')],
    // программа 28.09: команда проверки схемы по имени (schemas/<схема>.json роняла validate.mjs), пример вывода утвердительный
    ['проверка схемы: validate.mjs <имя схемы>', t => t.includes('validate.mjs <имя схемы> <файл>') && !t.includes('schemas/<схема>.json')],
    ['пример вывода для читателя без «не придется» (ai.neg-pitch)', not('не придется')],
  ],
  'prompts/01-decisions-drafter.md': [
    ['«не публикуем» - «Где можно» `нигде` (п.10)', t => t.includes('«не публикуем», в «Где можно» - `нигде`') && t.includes('строка пробелов факт не')],
    ['самопроверка пускает `нигде`', t => t.includes('только `все`, `нигде`, slug и type') && t.includes('у «не публикуем» - `нигде`')],
    ['«Где можно»: только, везде, все кроме', t => t.includes('«только a, b»') && t.includes('`везде` = `все`') && t.includes('«все, кроме a, b»')],
    ['§3: нет d3 главной кнопкой у всех типов (K7)', noRe(/category, service, product - текст d3/)],
    ['§3: выдача - переход к выдаче, товар - заказ позиции, d3 - второй', t => t.includes('главный - переход к выдаче') && t.includes('заказ этой позиции') && (t.match(/d3 - второй/g) || []).length >= 2],
    ['§3 без action, skip не ставит (cases-import)', t => t.includes('Без `action`') && t.includes('`skip` не ставь')],
  ],
  'rules/decisions.template.md': [
    ['маркер v2 первой строкой', t => t.split('\n')[0].trim() === '<!-- decisions:v2 -->'],
    ['заполняет 01-decisions-drafter', has('01-decisions-drafter')],
    ['писатели его не читают: решения через brief', has('Писатели его не читают')],
    ['таблица §1 по C6', has('| Факт | Конфликт | Разрешенная формулировка | Где можно |')],
    // программа 28.09, п.10: «не публикуем» записывается `нигде` (парсер его понимает, а шаблон знал только `все`)
    ['«Где можно»: все, нигде или slug и типы карты', t => t.includes('`все`, `нигде` или slug и типы страниц из `work/sitemap.json`')],
    ['«Не публикуем» - всегда `нигде`', has('«Не публикуем» - всегда `нигде`')],
    ['«Где можно»: только, везде, все кроме', t => t.includes('«только a, b»') && t.includes('`везде` = `все`') && t.includes('«все, кроме a, b»')],
    ['§3: выдача - переход к выдаче, товар - заказ позиции, d3 второй (K7)', t => t.includes('главный CTA - переход к выдаче') && t.includes('заказ позиции') && t.includes('d3 у них - второй CTA')],
    ['строка открытых пробелов', re(/^Открытые пробелы, по которым не пишем:/m)],
    ['§8 «Спорное: решения агента»', re(/^## 8\. Спорное: решения агента$/m)],
    ['§8: вопрос | что решил агент | почему', has('| Вопрос | Что решил агент | Почему |')],
    ['§8: стратеги типов - в disputes своих файлов', has('`disputes`')],
    ['§3 без action: куда ведет - стратег и сборщик', t => /## 3\. CTA/.test(t) && !/\| *Действие *\|/.test(t)],
    ['§5 разводит оговорку-дисклеймер и условие факта', t => t.includes('Оговорка-дисклеймер') && t.includes('Условие факта')],
    ['§6: skip только по решению анализа или человека', has('снять страницу (`skip`) можно только так')],
    ['нет заготовки строки | F.. |', noRe(/^\|\s*F\.\./m)],
    ['нет упоминаний гейта 1', noRe(/гейт[аеу]? 1/)],
  ],
  'prompts/05-block-writer.md': [
    ['кнопка перехода: href обязателен', t => /href` обязателен/.test(t)],
    ['cta.secondary писатель не пишет', has('`cta.secondary` ты не пишешь')],
    ['CTA без href', has('без `href`')],
    ['факт с owner_block другого блока', has('owner_block')],
    ['факт с rule - только в разрешенной формулировке', has('Факт с `rule` - только в разрешенной формулировке')],
    ['словарь - не факт', has('Словарь - не факт')],
    ['фраза клиента в conversion-блоке остается', has('минимум одно по смыслу в conversion-блоке')],
    ['нехватка - поле блока needs_fact, blocked_reasons только при blocked', t => t.includes('`needs_fact`') && t.includes('`blocked_reasons`')],
    ['самопроверка: показать пальцем в опоре', has('показать пальцем в опоре')],
    ['pattern custom - по custom_name и элементам', has('custom_name')],
    ['segment all - сценарии segment.segments', has('segment.segments')],
    ['attempts и brief_sha из _brief_sha1 среза', t => t.includes('attempts') && t.includes('brief_sha') && t.includes('_brief_sha1')],
    ['счетчик один раз за вызов', has('один раз за вызов')],
    ['действующее лицо - из фактов process или «вы»', has('фактов `process`')],
    ['нет «страница остановится»', not('страница остановится')],
    ['нет нишевой кнопки интерфейса «Показать объекты»', not('Показать объекты')],
    ['формат ответа с needs_fact и attempts', t => /"needs_fact":\[/.test(t) && /"attempts":/.test(t)],
    // программа 28.09
    ['фильтры листинга: названия признаков без значений (п.19)', has('одно название признака покупателя, без двоеточия и перечня значений')],
    ['disclaimer_text среза - оговорка стратега для блока', t => t.includes('`disclaimer_text` среза') && t.includes('своей оговорки не добавляй')],
    ['attempts считает неудачи: +1 только если прежний блок не прошел линтер (п.23)', t => t.includes('прежний блок не прошел линтер (счетчик считает') && t.includes('lint-<block_id>.json')],
  ],
  'prompts/05-hero-writer.md': [
    ['механизм - только из фактов process', has('только из фактов `process`')],
    ['(c) без фактов process - другая конструкция', has('иначе (c)')],
    ['w1 без фактов process - другая конструкция', has('Нет фактов `process` в срезе')],
    ['segment all - общий результат и сценарии', t => (t.match(/segment\.id: all/g) || []).length >= 2 && t.includes('segment.segments')],
    ['страх сегмента - для страницы одного сегмента (b и w2 с веткой all)', t => /\(b\) снятие главного страха сегмента, а при/.test(t)],
    ['w3: словами клиента - желание, не действие компании', has('а не действие компании')],
    ['словарь - не факт', has('Словарь - не факт')],
    ['оговорка-дисклеймер не условие факта', t => t.includes('оговорок-дисклеймеров') && t.includes('Условие факта')],
    ['attempts и brief_sha в файле вариантов', t => t.includes('"attempts":1,"brief_sha"') && t.includes('_brief_sha1')],
    ['needs_fact у варианта', has('"needs_fact":[]')],
    ['временный файл single - tmp-single, блок пишет селектор', t => t.includes('.tmp-single.json') && t.includes('`<block_id>.json` не трогай')],
    ['одна кнопка cta.main без href', has('Ровно одна кнопка с текстом `cta.main`')],
    ['нет нишевых примеров H1', t => !/до депозита|комплексов в каталоге|10-35 минут/.test(t)],
    // программа 28.09
    ['H1 по ключевой фразе key_phrase среза (K5)', t => t.includes('`key_phrase` среза') && t.includes('без «купить» и порядка слов запроса')],
    ['attempts считает неудачи (п.23)', t => t.includes('прежний блок не прошел линтер') && t.includes('счетчик считает неудачи')],
  ],
  'prompts/05-hero-selector.md': [
    ['нет «страница остановится»', not('страница остановится')],
    ['нет «решения человека на гейте»', noRe(/на гейте/)],
    ['переносит attempts, brief_sha, needs_fact в блок', t => t.includes('`attempts`') && t.includes('`brief_sha`') && t.includes('`needs_fact`')],
    ['механизм без фактов process - не применим', has('не применим')],
    ['segment all: ничья и минус за один сегмент', t => (t.match(/segment\.id: all/g) || []).length >= 2],
    ['улучшение победителя - только словами фактов', has('только словами value/wording фактов')],
    ['чистит tmp-файлы писателей', has('.tmp-*.json')],
    ['нет нишевых примеров отсева', t => !/до депозита|комплексов/.test(t)],
    // программа 28.09, п.23: победитель - сначала во временный файл, прежний блок заменяется только при pass
    ['победитель пишется в tmp-select и линтуется там', t => t.includes('<block_id>.tmp-select.json') && t.includes('`node scripts/lint.mjs <T> --fix`')],
    ['прежний блок до успеха не трогается', has('Прежний блок до успеха не трогай')],
    ['pass - замена, прежний блок в _old', t => t.includes('Итог pass - замена') && t.includes('work/pages/<slug>/_old/<block_id>')],
    ['не pass при прежнем pass - прежний остается', t => t.includes('прежний блок прошел линтер') && t.includes('он остается') && t.includes('«оставлен прежний блок»')],
    ['не pass без прежнего pass - неудача засчитана', has('неудача засчитана')],
    ['lint в ответе - вердикт блока после шага', has('вердикт `<block_id>.json` после этого шага')],
  ],
  'prompts/06-page-judge.md': [
    ['fact.unsupported', has('fact.unsupported')],
    ['fact.scope с расширением объема', t => t.includes('fact.scope') && t.includes('снятое «стандартно»')],
    ['нарушение rule факта - major', has('fact.rule')],
    ['одобренные пожелания и главное обещание - не находки', has('Не находки: одобренные пожелания заказчика')],
    ['линза к своим proposal', has('Та же линза - к твоим собственным proposal')],
    ['нехватка детали - needs_fact, не «добавить конкретику»', t => t.includes('needs_fact: true') && t.includes('не «добавить конкретику»')],
    ['клонируемость без фактов отличия - needs_fact', has('Фактов отличия нет - находка с `needs_fact`')],
    ['blocks_on_question без listing, form, tiles, map', t => /`listing`, `form`, `tiles`, `map` не считаются/.test(t)],
    ['summary: проверено / без опоры', has('проверено N, без опоры M')],
    ['custom - по custom_name и роли', has('custom_name')],
    ['segment all - глазами каждого сценария', has('глазами каждого сценария')],
    ['механизм - только из фактов process', has('только из фактов `process`')],
    ['нет нишевых примеров утверждений', t => !/рассыл|налог|форм[аы] собственности/.test(t)],
  ],
  'prompts/06-fixer.md': [
    ['архивы кросса: cross-archive-*.json, если есть, только чтение', t => t.includes('cross-archive-*.json') && t.includes('Если есть') && t.includes('только для чтения')],
    ['quote находок fixed не возвращать', has('со статусом `fixed` в текст не возвращай')],
    ['нет файлов - не ошибка', has('Файлов нет - это не ошибка')],
    ['новое утверждение - только с id опоры в resolution', has('только с id опоры в `resolution`')],
    ['нет факта - rejected и needs_fact', t => t.includes('«нет факта: <какого>»') && t.includes('`needs_fact: true`')],
    // P4 (программа 28.09, п.8): повтор по умолчанию удаляется или сослается, другой угол - только факт брифа
    ['повтор - удалить или сослаться, другой угол - только факт брифа', t => /удалить повтор или\s+сослаться одним словом/.test(t) && /другой угол - только\s+факт брифа, которого еще нет на\s+странице/.test(t) && !t.includes('не удалением фразы')],
    ['действующее лицо - из фактов process или «вы»', has('из фактов `process` (кто что делает) или «вы»')],
    ['поля attempts/brief_sha/needs_fact не трогать', has('Поля блока `attempts`, `brief_sha`, `needs_fact` не трогай')],
    ['needs_fact любого файла - wontfix', has('(в любом файле)')],
    ['нет нишевых примеров действующего лица', t => !/специалист считает/.test(t)],
  ],
  'prompts/06-cross-judge.md': [
    ['параметр current', has('`current`')],
    ['created_at обязателен', has('`created_at` (время ISO, обязательно)')],
    ['разрешенная формулировка (rule) - не повтор', has('разрешенная формулировка (`rule`) повтором не считаются')],
    ['развести только деталью без факта - ссылка/удаление, иначе needs_fact', t => t.includes('только деталью, которой нет') && t.includes('`needs_fact: true`')],
    ['находка на страницу из current', has('на страницу из `current`')],
  ],
  'prompts/06-blind-reader.md': [
    ['несколько сценариев (segment all)', has('несколько сценариев')],
  ],
  'prompts/04-strategist-global.md': [
    ['режим review', t => t.includes('mode=review') && t.includes('## Режим рецензии')],
    ['review читает --matrix', has('merge-strategy.mjs --matrix')],
    ['review: пять линз', t => ['условие факта', 'близнецы', 'не о предмете', 'сверх фактов', 'чужой сегмент'].every(x => t.includes(x))],
    ['review правит strategy.pages, затем --check и сборка', t => t.includes('work/strategy.pages/<type>.json') && t.includes('merge-strategy.mjs --check')],
    ['review: старая задача - --split', has('--split')],
    ['review: итог strategy-review.json, producer strategy-review', t => t.includes('work/audit/strategy-review.json') && t.includes('producer `strategy-review`')],
    ['review: проверка схемой findings', has('validate.mjs findings work/audit/strategy-review.json')],
    ['§1 не дописывать и не править', has('§1 не дописывай и не правь')],
    ['споры - в §8', has('строкой в §8')],
    ['нет «раздел 7 как вопрос оператору»', noRe(/раздел 7 как вопрос/)],
    ['нет «дополни файл»', noRe(/[Дд]ополни (файл|`?rules\/decisions)/)],
    ['cta_by_type - объект C3', has('{main, secondary?, action?, secondary_action?, short?}')],
    ['action - только переход, мессенджер, звонок', t => t.includes('`page:<slug>`') && t.includes('`anchor:') && t.includes('`messenger`') && t.includes('`call`')],
    ['short до 20 знаков', has('до 20 знаков')],
    ['пожелания: where shell / none и нет pages - все страницы', t => t.includes('`shell`') && t.includes('`none`') && t.includes('нет `pages` - все страницы')],
    ['нет строки «пустой массив - ни одной страницы»', noRe(/ни одной страницы/)],
    ['условия фактов: «без оговорок» не значит «без условий»', has('«без оговорок» не значит «без условий факта»')],
    ['disclaimer_text - текст для читателя', has('`disclaimer_text` - текст\n   для читателя')],
    ['нет secondary_segment', not('secondary_segment')],
    // программа 28.09
    ['disclaimer_text - не записка писателям', re(/Это не\s+записка писателям/)],
    ['gate:d3 не главная кнопка всех типов (K7)', noRe(/это `main` для home, hub, category, service и product/)],
    ['выдача: переход к выдаче anchor на листинг, d3 второй; товар: lead', t => t.includes('`main` - переход к выдаче, `action: anchor:<id блока листинга>`') && t.includes('`action: lead`') && (t.match(/d3 - `secondary`/g) || []).length >= 2],
    ['кнопка «в каталог» - page: хаба каталога', has('`page:<slug хаба каталога>`')],
    ['что будет с кнопкой без action', has('Кнопка без `action` ведет к форме страницы или окну заявки')],
    ['пример client-preferences с source и facts, поля импорта не трогать (п.15)', t => t.includes('"source":"","facts":["F01"]') && t.includes('`source` и `facts` не меняешь')],
    ['режим обновления: углы только фактов added и published (K4)', t => t.includes('## Режим обновления (`mode=update`)') && t.includes('`facts_diff`') && t.includes('фактов `added` и `published`') && t.includes('остальное в `global`')],
    ['рецензия: замечания « ~ » - находки на проверку', has('Замечания сборки (строки « ~ »)')],
    ['рецензия: линза CTA по данным - listing без action (K7)', t => t.includes('(6) по данным') && t.includes('`listing: true`') && t.includes('`strategy.cta-action`')],
    // доработка P3b: условие выдачи как в K7 и merge-strategy - listing у страниц или блок pattern listing у типа (хаб с выдачей)
    ['выдача по K7: listing у страниц или блок pattern: listing у типа (п.3 и линза 6)', t => t.includes('`listing: true` у его страниц или блок `pattern: listing` в файле типа - хаб с выдачей') && /\(6\) по данным: у страницы с `listing: true` в карте или с блоком\s+`pattern: listing` у типа \(не в `exclude_blocks`\)/.test(t)],
    ['переход к выдаче в §3 у типа без выдачи - main d3 и §8', re(/Переход к выдаче в §3 у типа без\s+выдачи - `main` d3, строка в §8/)],
    ['page-types читаются с полем pattern (id блока листинга)', has('только поля id/name/pattern/reader_question')],
    ['рецензия с update - только changed_pages и страницы из проблем и замечаний', t => /С `update`[^\n]*`changed_pages`/.test(t) && /только по страницам из\s+`changed_pages` и страницам из проблем и замечаний сборки/.test(t) && /нет `changed_pages` - по страницам, у которых в `facts` id из\s+`added`, `published`, `changed`/.test(t) && t.includes('Остальные записи прошли рецензию раньше: не трогай')],
  ],
  'prompts/04-strategist-type.md': [
    ['exclude_blocks (hero нельзя)', t => t.includes('exclude_blocks') && t.includes('`hero` исключать нельзя')],
    ['block_overrides C3: facts, objection_ids, task', has('{facts?: [id], objection_ids?: [id], task?: "..."}')],
    ['явный facts: [] снимает блок из drop_blocks_without_facts', t => t.includes('явный `facts: []`') && t.includes('drop_blocks_without_facts')],
    ['id фактов в task - только утвердительно', has('только в утвердительной форме')],
    ['крючок и hero_facts - о предмете и намерении типа', t => t.includes('намерении ее типа') && t.includes('о предмете страницы')],
    ['условия фактов переносятся в hook/unique_argument/task', has('переносится в hook, unique_argument и task')],
    ['cta - объект C3', has('{main, secondary?, action?, secondary_action?, short?}')],
    ['споры - поле disputes своего файла, не decisions.md', t => t.includes('"disputes"') && t.includes('В `rules/decisions.md` не пиши')],
    ['сегмент all с segments', has('`all`')],
    ['нет secondary_segment', not('secondary_segment')],
    // программа 28.09
    ['cta страницы - только при переопределении, наследование парами по подписи', t => t.includes('пиши их только при переопределении') && t.includes('при той же подписи `main`') && t.includes('при той же `secondary`')],
    ['страница с listing: переход к выдаче (K7)', t => t.includes('Страница с `listing: true`') && t.includes('`action: anchor:<id блока листинга>`')],
    ['страница с listing или тип с блоком pattern: listing (K7)', re(/Страница с `listing: true` \(или ее тип с блоком\s+`pattern: listing`\)/)],
    ['update: changed_pages у каждого типа в results', has('у каждого типа в `results` добавь `"changed_pages":["<slug>"]`')],
    ['режим обновления: прежний файл типа и facts_diff (K4)', t => t.includes('## Режим обновления (`mode=update`)') && t.includes('Стратегия не пишется заново') && t.includes('прежний `work/strategy.pages/<type>.json`') && t.includes('`facts_diff`')],
    ['update: снятые убрать, новые - по предмету в пределах §1, changed - не на новые страницы', t => ['`removed`', '`unpublished`', '`added`', '`published`', '`changed`'].every(k => t.includes(k)) && t.includes('только страницам по их предмету, в пределах «Где можно» §1') && t.includes('на новые страницы факт не переносится')],
  ],
  'prompts/04-layout-generator.md': [
    ['hero-split: слот image всегда', has('справа слот `image`\n   всегда')],
    ['listing: один слот *, без aside', has('`listing` - одна секция со слотом `*`, без aside')],
    ['custom - раскладка по элементам', t => t.includes('`custom`') && t.includes('раскладка по элементам')],
  ],
  'prompts/02-type-aggregator.md': [
    ['читает «Запреты и обязательные формулировки»', has('«Запреты и обязательные формулировки»')],
    ['must_say страницы - блок отстройки с source «анализ: обязательные формулировки»', has('«анализ: обязательные формулировки»')],
    ['шапка, подвал, меню - notes «оболочка»', has('«оболочка»')],
    ['кнопок не больше одной, у hero ровно одна, второе действие - link', t => t.includes('не больше одной `button`') && t.includes('ровно одна') && t.includes('элемент `link`')],
    ['chars у списков - на пункт', has('на один пункт')],
    ['pattern custom с custom_name', t => t.includes('`pattern: custom`') && t.includes('`custom_name`')],
    ['листинг с фильтрами - только магазину', has('`niche.business_type` не `services`')],
    ['листинг: элемент filters - признаки без значений (повторная проверка №19)', has('`filters` (признаки без значений)')],
  ],
  'prompts/03-type-auditor.md': [
    ['всегда читает «Запреты и обязательные формулировки»', has('всегда раздел\n  «Запреты и обязательные формулировки»')],
    ['покрытие обязательных формулировок, пропуск - major', t => t.includes('Обязательные формулировки') && t.includes('пропуск = major')],
    ['hero - ровно одна кнопка', has('у первого экрана ровно одна `button`')],
    ['custom - осмысленный набор элементов', t => t.includes('`pattern: custom`') && t.includes('custom_name')],
  ],
  'prompts/03-type-fixer.md': [
    ['общие id блоков', t => ['hero', 'faq', 'cta-final', 'reviews', 'team', 'cases', 'media', 'gallery', 'listing', 'form', 'contacts'].every(id => t.includes('`' + id + '`'))],
    ['нет нишевых id', t => !/developer-check|fin-model|deals-proof|price-composition/.test(t)],
    ['нет нишевого примера клише', not('тропический')],
    ['пропущенная обязательная формулировка закрывается блоком отстройки', has('«анализ: обязательные\n   формулировки»')],
  ],
  'rules/hero.md': [
    ['механизм - только из фактов process', has('только из фактов вида `process`')],
    ['segment all - сценарии всех сегментов', t => t.includes('`segment: all`') && t.includes('segment.segments')],
    ['главный страх - для страницы одного сегмента', has('страницы одного сегмента')],
    ['оговорка-дисклеймер и условие факта разведены', t => t.includes('оговорок-дисклеймеров') && t.includes('Условие факта')],
    ['инвариант кратко (ссылка на CLAUDE.md)', has('«Инвариант опоры»')],
    ['чек-лист: механизм не применим без process', has('нет их - пункт не применим')],
    // программа 28.09: п.3 - ключевая фраза брифа = key_phrase (K5); шкала первого экрана 5, вопрос 2 - только при факте
    ['п.3: ключевая фраза брифа - key_phrase', re(/^3\. Это то, что я искал\?[^\n]*`key_phrase`/m)],
    ['шкала 5: вопрос «новое или старое» только при факте', t => t.includes('шкала 5') && t.includes('Нет такого факта - вопрос не считается') && !t.includes('## 6 вопросов')],
  ],
  'rules/conversion.md': [
    ['инвариант кратко', has('«Инвариант опоры»')],
    ['segment all - сценарии', t => t.includes('`segment: all`') && t.includes('segment.segments')],
    ['выгода остается без факта', has('Нет факта - нет цифры, но выгода остается')],
    ['конкретика и механизм - только из фактов', has('конкретика и механизм - только из фактов')],
  ],
  'rules/info.md': [
    ['инвариант кратко', has('«Инвариант опоры»')],
    ['оговорка-дисклеймер (disclaimer_text) и условие факта разведены', t => t.includes('disclaimer_text') && t.includes('Условие факта')],
    // программа 28.09: согласие под формой ставит сборщик (два согласия в каждой форме прототипа)
    ['согласие под формой не пишет писатель', t => t.includes('ставит сборщик прототипа') && !t.includes('ссылка на политику')],
  ],
  'rules/auditor.md': [
    ['не требовать конкретики, которой нет в фактах: needs_fact', has('Не требуй конкретики, которой нет в фактах')],
    ['fact.unsupported и fact.scope - major', t => t.includes('fact.unsupported') && t.includes('fact.scope')],
    ['механизм - только из фактов process', has('только из фактов `process`')],
    ['segment all в чек-листе первого экрана', has('`segment: all`')],
    ['нет «Каждое обещание конкретно: цифра, срок или механизм»', not('Каждое обещание конкретно: цифра, срок или механизм')],
  ],
};
for (const [f, list] of Object.entries(RULES)) for (const [name, fn] of list) check(`${f}: ${name}`, fn(TEXT[f]));

// §1 шаблона без строк данных: пустой шаблон не дает правил и предупреждений разбора
{
  const t = TEXT['rules/decisions.template.md'];
  const sec = t.slice(t.indexOf('## 1.'), t.indexOf('## 2.'));
  const rows = sec.split('\n').filter(l => /^\|/.test(l));
  check('decisions.template.md: таблица §1 - только шапка и разделитель', rows.length === 2, rows.join(' / '));
  const gapsLine = sec.split('\n').find(l => l.startsWith('Открытые пробелы, по которым не пишем:')) || '';
  check('decisions.template.md: строка пробелов пустая после двоеточия', gapsLine.trim() === 'Открытые пробелы, по которым не пишем:', gapsLine);
}

// ---------- 3. воркфлоу с подставными хуками ----------
const AsyncFunction = (async () => {}).constructor;
const compile = src => new AsyncFunction('args', 'agent', 'parallel', 'pipeline', 'phase', 'log', 'workflow', 'budget', src.replace(/^export const meta\s*=/m, 'const meta ='));
function rolesOf(src) {
  const i = src.indexOf('const ROLES = {');
  if (i < 0) return {};
  const start = src.indexOf('{', i), end = src.indexOf('\n}', start);
  return new Function(`return (${src.slice(start, end + 2)})`)();
}
// ответы агентов по label; reply(label, prompt, schema) может вернуть null (агент не ответил)
async function runWf(rel, args, reply) {
  const calls = [], logs = [], errors = [];
  const agent = async (prompt, opts = {}) => { calls.push({ label: opts.label, model: opts.model, prompt: String(prompt), schema: opts.schema }); return reply(opts.label, String(prompt), opts.schema); };
  const guard = async f => { try { return await f(); } catch (e) { errors.push(e.message); return null; } };
  const parallel = thunks => Promise.all(thunks.map(t => guard(t)));
  const pipeline = (items, ...stages) => Promise.all(items.map((it, i) => guard(async () => { let r = it; for (const st of stages) r = await st(r, it, i); return r; })));
  let result = null, threw = '';
  try { result = await compile(TEXT[rel])(args, agent, parallel, pipeline, () => {}, m => logs.push(m), async () => null, { total: null, spent: () => 0, remaining: () => Infinity }); }
  catch (e) { threw = e.message; }
  return { calls, logs, errors, result, threw };
}
const typesOf = prompt => { const m = prompt.match(/types=(\[[^\]]*\])/); try { return m ? JSON.parse(m[1]) : []; } catch { return []; } };
const P1 = 'work/strategy.pages/category.json: pages.okna: факт F99 нет в facts.json';
const N1 = 'home: первый экран без фактов (hero_facts сняты)';
const DIFF0 = { added: [], removed: [], changed: [], published: [], unpublished: [] };
function wf04Reply(over = {}) {
  return (label, prompt) => {
    if (label in over) return typeof over[label] === 'function' ? over[label](prompt) : over[label];
    if (label === 'prep-args') return { ok: true, type_pages: [{ type: 'home', pages: 1 }, { type: 'category', pages: 3 }] };
    if (label === 'strategist-global' || /^strategist:/.test(label) || label === 'strategy-review' || label === 'sitemap-enrich') return { ok: true, summary: '{}' };
    if (label === 'merge+build-briefs') return { ok: false, exit_code: 1, problems: [P1], review_notes: [N1], warnings: 'facts_dropped: 2 (пример: home F05 where)', merge: 'strategy.json: записей 2' };
    if (label === 'merge+build-briefs:review') return { ok: true, exit_code: 0, problems: [], review_notes: [], warnings: '', merge: 'strategy.json: записей 2' };
    if (/^layout:/.test(label)) return { results: typesOf(prompt).map(t => ({ type: t, sections: 5, validator: 'pass' })) };
    if (label === 'update-check') return { ok: true, ...DIFF0, added: ['F12'], removed: ['F03'] };
    if (/^enrich-check:/.test(label)) return { ok: true, exit_code: 0, stdout_tail: 'OK' };
    return null;
  };
}
// label -> роль wf-04 по C11 (так же их сопоставит workflow-models.mjs после W6); run и sitemap-enrich - только в update
const WF04_LABELS = [[/^prep-args$/, 'prep-args'], [/^strategist-global$/, 'strategist-global'], [/^strategist:/, 'strategist-type'],
  [/^merge\+build-briefs(:review)?$/, 'briefs'], [/^strategy-review$/, 'strategy-review'], [/^layout:/, 'layout'],
  [/^sitemap-enrich$/, 'sitemap-enrich'], [/^(update-check|enrich-check:(before|after))$/, 'run']];
const UPDATE_ONLY = ['run', 'sitemap-enrich'];
const roleOf04 = label => (WF04_LABELS.find(([r]) => r.test(label || '')) || [])[1];
const BASE = { root: '/fake/root', types: ['home', 'category'], model: 'M-STRONG', model_light: 'M-LIGHT' };

{
  const roles = rolesOf(TEXT['workflows/wf-04-strategy-layouts.js']);
  check('wf-04: роль strategy-review - strong (C11)', roles['strategy-review'] === 'strong', JSON.stringify(roles));
  check('wf-04: роль briefs осталась light', roles.briefs === 'light', JSON.stringify(roles));
  check('wf-04: вызовы только через modelFor', !/\bmodel: MODEL(_LIGHT)?\s*,\s*schema/.test(TEXT['workflows/wf-04-strategy-layouts.js']));

  const r = await runWf('workflows/wf-04-strategy-layouts.js', BASE, wf04Reply());
  check('wf-04: прогон без исключений', !r.threw && !r.errors.length, r.threw || r.errors.join(' | '));
  const labels = r.calls.map(c => c.label);
  const at = l => labels.indexOf(l);
  check('wf-04: цепочка global -> типы -> сборка -> рецензия -> повтор сборки',
    at('strategist-global') >= 0 && labels.some(l => /^strategist:/.test(l)) && at('merge+build-briefs') > labels.findIndex(l => /^strategist:/.test(l))
    && at('strategy-review') > at('merge+build-briefs') && at('merge+build-briefs:review') > at('strategy-review'), labels.join(', '));
  const unknown = r.calls.filter(c => !roleOf04(c.label) || !(roleOf04(c.label) in roles)).map(c => c.label);
  check('wf-04: у каждого вызова роль из ROLES (label по C11)', !unknown.length, unknown.join(', '));
  const hit = new Set(r.calls.map(c => roleOf04(c.label)));
  // программа 28.09 (K4): роли run и sitemap-enrich вызываются только в режиме обновления - их покрывает прогон update ниже
  check('wf-04: все роли ROLES, кроме ролей режима обновления, вызваны', Object.keys(roles).filter(x => !UPDATE_ONLY.includes(x)).every(x => hit.has(x)), Object.keys(roles).filter(x => !hit.has(x)).join(', '));
  check('wf-04: без update нет вызовов run и sitemap-enrich', UPDATE_ONLY.every(x => !hit.has(x)));
  check('wf-04: роли run (light) и sitemap-enrich (strong) в ROLES (K4)', roles.run === 'light' && roles['sitemap-enrich'] === 'strong', JSON.stringify(roles));
  const badModel = r.calls.filter(c => c.model !== (roles[roleOf04(c.label)] === 'light' ? 'M-LIGHT' : 'M-STRONG')).map(c => `${c.label}=${c.model}`);
  check('wf-04: модели по ярусам ролей', !badModel.length, badModel.join(', '));
  const review = r.calls.find(c => c.label === 'strategy-review');
  check('wf-04: рецензия - 04-strategist-global в mode=review', review && review.prompt.includes('prompts/04-strategist-global.md') && /mode=review/.test(review.prompt), review && review.prompt.slice(0, 300));
  check('wf-04: рецензия получает проблемы первой сборки целиком', review && review.prompt.includes(P1));
  const build = r.calls.find(c => c.label === 'merge+build-briefs');
  check('wf-04: сборка брифов возвращает проблемы целиком и сводку предупреждений', build && build.schema && (build.schema.required || []).includes('problems') && (build.schema.required || []).includes('warnings') && !/60 строк/.test(build.prompt), build && JSON.stringify(build.schema));
  // программа 28.09: строки « ~ » (merge-strategy и build-briefs) - отдельное поле review_notes, не проблемы
  check('wf-04: сборка возвращает замечания « ~ » полем review_notes, не в problems', build && (build.schema.required || []).includes('review_notes') && build.prompt.includes('review_notes - все строки « ~ ...»') && build.prompt.includes('в problems их не клади'), build && build.prompt.slice(-600));
  check('wf-04: рецензия получает замечания « ~ » вместе с проблемами', review && review.prompt.includes(N1) && review.prompt.includes(P1) && /строки « ~ »/.test(review.prompt), review && review.prompt.slice(-600));
  check('wf-04: замечания « ~ » не идут в briefs_problems', !(r.result.briefs_problems || []).includes(N1) && JSON.stringify(r.result.briefs.review_notes) === JSON.stringify([N1]), JSON.stringify(r.result.briefs));
  check('wf-04: без update нет mode=update в промтах стратегов', !r.calls.some(c => /mode=update|facts_diff/.test(c.prompt)));
  check('wf-04: повтор сборки - те же команды', (() => { const b2 = r.calls.find(c => c.label === 'merge+build-briefs:review'); return b2 && b2.prompt === build.prompt; })());
  const res = r.result || {};
  check('wf-04: briefs_problems - проблемы последней сборки (после рецензии)', Array.isArray(res.briefs_problems) && res.briefs_problems.length === 0, JSON.stringify(res.briefs_problems));
  check('wf-04: в итоге первая сборка с проблемой и финальная без', res.briefs && res.briefs.problems[0] === P1 && res.briefs_final && res.briefs_final.ok === true, JSON.stringify({ b: res.briefs, f: res.briefs_final }));
  check('wf-04: в итоге summary рецензии и раскладки', res.review === '{}' && Array.isArray(res.layouts) && res.layouts.length === 2, JSON.stringify({ review: res.review, layouts: res.layouts }));

  // рецензия отключается skipReview: одна сборка, ее проблемы - в briefs_problems
  const s = await runWf('workflows/wf-04-strategy-layouts.js', { ...BASE, skipReview: true }, wf04Reply());
  const sl = s.calls.map(c => c.label);
  check('wf-04 skipReview: без рецензии и без повтора сборки', !s.threw && !sl.includes('strategy-review') && !sl.includes('merge+build-briefs:review') && sl.includes('merge+build-briefs'), sl.join(', '));
  check('wf-04 skipReview: briefs_problems - проблемы единственной сборки', JSON.stringify((s.result || {}).briefs_problems) === JSON.stringify([P1]), JSON.stringify((s.result || {}).briefs_problems));
  check('wf-04 skipReview: review = skipped', (s.result || {}).review === 'skipped');

  // проблемы остались после рецензии - автостоп увидит их
  const left = await runWf('workflows/wf-04-strategy-layouts.js', BASE, wf04Reply({ 'merge+build-briefs:review': { ok: false, exit_code: 1, problems: ['home: блок faq: hero исключать нельзя'], warnings: '', merge: '' } }));
  check('wf-04: проблемы после рецензии - в briefs_problems', JSON.stringify((left.result || {}).briefs_problems) === JSON.stringify(['home: блок faq: hero исключать нельзя']), JSON.stringify((left.result || {}).briefs_problems));

  // агент последней сборки не ответил - это тоже проблема (иначе автостоп пропустит битые брифы)
  const lost = await runWf('workflows/wf-04-strategy-layouts.js', BASE, wf04Reply({ 'merge+build-briefs:review': null }));
  check('wf-04: сборка не ответила - briefs_problems не пуст', ((lost.result || {}).briefs_problems || []).length > 0, JSON.stringify((lost.result || {}).briefs_problems));

  // рецензия не ответила - брифы все равно пересобираются
  const noRev = await runWf('workflows/wf-04-strategy-layouts.js', BASE, wf04Reply({ 'strategy-review': null }));
  check('wf-04: рецензия не ответила - повтор сборки все равно', noRev.calls.some(c => c.label === 'merge+build-briefs:review') && ((noRev.result || {}).briefs_problems || []).length === 0);

  // первая сборка без проблем - рецензия без блока проблем
  const clean = await runWf('workflows/wf-04-strategy-layouts.js', BASE, wf04Reply({ 'merge+build-briefs': { ok: true, exit_code: 0, problems: [], warnings: '', merge: '' } }));
  const rc = clean.calls.find(c => c.label === 'strategy-review');
  check('wf-04: без проблем первой сборки рецензия идет без списка проблем', rc && !/Проблемы сборки брифов до рецензии/.test(rc.prompt));

  // args.models переопределяет роль рецензии точечно
  const ov = await runWf('workflows/wf-04-strategy-layouts.js', { ...BASE, models: { 'strategy-review': 'O-REVIEW' } }, wf04Reply());
  const ovBad = ov.calls.filter(c => c.model !== (roleOf04(c.label) === 'strategy-review' ? 'O-REVIEW' : (roles[roleOf04(c.label)] === 'light' ? 'M-LIGHT' : 'M-STRONG'))).map(c => `${c.label}=${c.model}`);
  check('wf-04: models.strategy-review переопределяет только рецензию', !ovBad.length && ov.calls.some(c => c.model === 'O-REVIEW'), ovBad.join(', '));

  // те же args - та же последовательность (resume берет кэш)
  const again = await runWf('workflows/wf-04-strategy-layouts.js', BASE, wf04Reply());
  check('wf-04: те же args - те же (label, model)', JSON.stringify(again.calls.map(c => [c.label, c.model])) === JSON.stringify(r.calls.map(c => [c.label, c.model])));

  // skipReview: замечания « ~ » не становятся проблемами и без рецензии
  const sr = await runWf('workflows/wf-04-strategy-layouts.js', { ...BASE, skipReview: true }, wf04Reply());
  check('wf-04 skipReview: замечания « ~ » не в briefs_problems', JSON.stringify((sr.result || {}).briefs_problems) === JSON.stringify([P1]), JSON.stringify((sr.result || {}).briefs_problems));
}

// ---------- 3a. wf-04: режим обновления после ответов заказчика (K4), skipLayouts, проход обогатителя ----------
{
  const WF = 'workflows/wf-04-strategy-layouts.js';
  const roles = rolesOf(TEXT[WF]);
  const labelsOf = res => res.calls.map(c => c.label);
  const strategists = res => res.calls.filter(c => c.label === 'strategist-global' || /^strategist:/.test(c.label));

  // нет facts_diff в отчете импорта - отказ до стратегов, с подсказкой --facts-only
  const noDiff = await runWf(WF, { ...BASE, update: true }, wf04Reply({ 'update-check': { ok: false, ...DIFF0, error: 'нет поля facts_diff' } }));
  check('wf-04 update: без facts_diff - отказ с подсказкой --facts-only', /facts_diff/.test(noDiff.threw) && /--facts-only/.test(noDiff.threw), noDiff.threw || 'не отказал');
  check('wf-04 update: при отказе стратеги и сборка не вызваны', !strategists(noDiff).length && !labelsOf(noDiff).some(l => /^merge\+build-briefs/.test(l)), labelsOf(noDiff).join(', '));
  const lostCheck = await runWf(WF, { ...BASE, update: true }, wf04Reply({ 'update-check': null }));
  check('wf-04 update: проверка отчета импорта не ответила - отказ', /facts_diff/.test(lostCheck.threw), lostCheck.threw || 'не отказал');

  // дифф с новым и снятым фактом: сначала проверка, стратеги в mode=update с facts_diff, глобальный - дописать углы
  const up = await runWf(WF, { ...BASE, update: true }, wf04Reply());
  const ul = labelsOf(up);
  check('wf-04 update: прогон без исключений', !up.threw && !up.errors.length, up.threw || up.errors.join(' | '));
  check('wf-04 update: update-check - первый вызов', ul[0] === 'update-check', ul.join(', '));
  const uc = up.calls[0];
  check('wf-04 update: update-check читает work/import-report.json легкой моделью (роль run)', uc && uc.prompt.includes('work/import-report.json') && uc.model === 'M-LIGHT' && (uc.schema.required || []).includes('ok'), uc && uc.prompt);
  const diffJson = JSON.stringify({ ...DIFF0, added: ['F12'], removed: ['F03'] });
  const typeCalls = up.calls.filter(c => /^strategist:/.test(c.label));
  check('wf-04 update: стратеги типов - mode=update и facts_diff в параметрах', typeCalls.length === 2 && typeCalls.every(c => c.prompt.includes('; mode=update; facts_diff=' + diffJson) && typesOf(c.prompt).length), typeCalls.map(c => c.prompt.split('\n').pop()).join(' | '));
  const g = up.calls.find(c => c.label === 'strategist-global');
  check('wf-04 update: глобальный стратег при новых фактах - mode=update с facts_diff', g && g.prompt.includes('Параметры: mode=update; facts_diff=' + diffJson), g && g.prompt.slice(-300));
  check('wf-04 update: без enrich обогатитель и сверка карты не вызываются', !ul.some(l => l === 'sitemap-enrich' || /^enrich-check:/.test(l)), ul.join(', '));
  check('wf-04 update: в итоге facts_diff', JSON.stringify((up.result || {}).update) === JSON.stringify({ facts_diff: JSON.parse(diffJson) }) && (up.result || {}).enrich === null, JSON.stringify(up.result && up.result.update));
  const upAgain = await runWf(WF, { ...BASE, update: true }, wf04Reply());
  check('wf-04 update: те же args - те же (label, model)', JSON.stringify(upAgain.calls.map(c => [c.label, c.model])) === JSON.stringify(up.calls.map(c => [c.label, c.model])));

  // только снятые факты - глобальный стратег не нужен (углы дописывать некому), стратеги типов идут
  const rm = await runWf(WF, { ...BASE, update: true }, wf04Reply({ 'update-check': { ok: true, ...DIFF0, unpublished: ['F07'] } }));
  check('wf-04 update: без новых фактов глобальный стратег не вызывается', !labelsOf(rm).includes('strategist-global') && labelsOf(rm).some(l => /^strategist:/.test(l)), labelsOf(rm).join(', '));
  check('wf-04 update: global в итоге - skipped', (rm.result || {}).global === 'skipped', JSON.stringify((rm.result || {}).global));
  // пустой дифф - стратегов нет, записи как были; сборка и рецензия идут
  const empty = await runWf(WF, { ...BASE, update: true }, wf04Reply({ 'update-check': { ok: true, ...DIFF0 } }));
  check('wf-04 update: пустой facts_diff - ни одного стратега, сборка брифов идет', !strategists(empty).length && labelsOf(empty).includes('merge+build-briefs'), labelsOf(empty).join(', '));

  // рецензия в update: mode=review; update; facts_diff, changed_pages стратегов типов - только когда их вернули все
  const CLEAN = { ok: true, exit_code: 0, problems: [], review_notes: [], warnings: '', merge: '' };
  const revOf = res => res.calls.find(c => c.label === 'strategy-review');
  const upRev = revOf(up);
  check('wf-04 update: рецензия получает mode=review; update; facts_diff', upRev && upRev.prompt.includes('Параметры: mode=review; update; facts_diff=' + diffJson), upRev && upRev.prompt.slice(-500));
  check('wf-04 update: стратеги без changed_pages - рецензия без changed_pages', upRev && !upRev.prompt.includes('changed_pages='), upRev && upRev.prompt.slice(-500));
  const plainRev = revOf(await runWf(WF, BASE, wf04Reply()));
  check('wf-04: без update рецензия - просто mode=review, без update и facts_diff', plainRev && plainRev.prompt.includes('Параметры: mode=review.\n') && !/facts_diff|changed_pages|; update/.test(plainRev.prompt), plainRev && plainRev.prompt.slice(-400));
  const withChanged = { 'strategist:home': { ok: true, summary: JSON.stringify({ results: [{ type: 'home', changed_pages: ['home'] }] }) }, 'strategist:category': { ok: true, summary: JSON.stringify({ results: [{ type: 'category', changed_pages: ['okna', 'okna'] }] }) } };
  const ch = await runWf(WF, { ...BASE, update: true }, wf04Reply(withChanged));
  const chRev = revOf(ch);
  check('wf-04 update: changed_pages стратегов типов - в параметрах рецензии без повторов', chRev && chRev.prompt.includes(`; changed_pages=${JSON.stringify(['home', 'okna'])}.`), chRev && chRev.prompt.slice(-500));
  const chPart = await runWf(WF, { ...BASE, update: true }, wf04Reply({ ...withChanged, 'strategist:category': { ok: true, summary: 'не JSON' } }));
  check('wf-04 update: хоть один стратег без changed_pages - поле не передается', revOf(chPart) && !revOf(chPart).prompt.includes('changed_pages='), revOf(chPart) && revOf(chPart).prompt.slice(-400));
  const chNoField = await runWf(WF, { ...BASE, update: true }, wf04Reply({ ...withChanged, 'strategist:category': { ok: true, summary: '{"results":[{"type":"category","pages":3}]}' } }));
  check('wf-04 update: результат типа без поля changed_pages - поле не передается, без исключений', !chNoField.threw && !chNoField.errors.length && revOf(chNoField) && !revOf(chNoField).prompt.includes('changed_pages='), chNoField.threw || chNoField.errors.join(' | '));
  // стратеги ничего не поменяли и сборка чистая - рецензия не нужна
  const noCh = await runWf(WF, { ...BASE, update: true }, wf04Reply({ 'strategist:home': { ok: true, summary: '{"results":[{"type":"home","changed_pages":[]}]}' }, 'strategist:category': { ok: true, summary: '{"results":[{"type":"category","changed_pages":[]}]}' }, 'merge+build-briefs': CLEAN }));
  check('wf-04 update: изменений нет и сборка чистая - рецензии и повтора сборки нет, review = skipped', !labelsOf(noCh).includes('strategy-review') && !labelsOf(noCh).includes('merge+build-briefs:review') && (noCh.result || {}).review === 'skipped' && JSON.stringify((noCh.result || {}).briefs_problems) === '[]', labelsOf(noCh).join(', '));
  const emptyClean = await runWf(WF, { ...BASE, update: true }, wf04Reply({ 'update-check': { ok: true, ...DIFF0 }, 'merge+build-briefs': CLEAN }));
  check('wf-04 update: пустой facts_diff и чистая сборка - рецензии нет', !labelsOf(emptyClean).includes('strategy-review') && (emptyClean.result || {}).review === 'skipped' && emptyClean.logs.some(m => /рецензия не нужна/.test(m)), labelsOf(emptyClean).join(', '));
  const emptyRev = revOf(empty);
  check('wf-04 update: пустой facts_diff, но есть проблемы и замечания - рецензия с changed_pages=[]', emptyRev && emptyRev.prompt.includes('; changed_pages=[].') && emptyRev.prompt.includes(P1) && emptyRev.prompt.includes(N1), emptyRev && emptyRev.prompt.slice(-500));
  const emptyNotes = await runWf(WF, { ...BASE, update: true }, wf04Reply({ 'update-check': { ok: true, ...DIFF0 }, 'merge+build-briefs': { ...CLEAN, review_notes: [N1] } }));
  check('wf-04 update: пустой facts_diff, только замечания « ~ » - рецензия идет', labelsOf(emptyNotes).includes('strategy-review'), labelsOf(emptyNotes).join(', '));
  const skipT = await runWf(WF, { ...BASE, update: true, skipTypes: true }, wf04Reply({ 'merge+build-briefs': CLEAN }));
  check('wf-04 update + skipTypes: changed_pages неизвестен - рецензия идет, без changed_pages', revOf(skipT) && !revOf(skipT).prompt.includes('changed_pages=') && revOf(skipT).prompt.includes('mode=review; update; facts_diff='), labelsOf(skipT).join(', '));

  // update + enrich: проверка -> копия карты -> обогатитель mode=facts -> сверка -> стратеги
  const en = await runWf(WF, { ...BASE, update: true, enrich: true }, wf04Reply());
  const el = labelsOf(en);
  const at = l => el.indexOf(l);
  const firstStrategist = el.findIndex(l => l === 'strategist-global' || /^strategist:/.test(l));
  check('wf-04 enrich: порядок update-check -> копия карты -> обогатитель -> сверка -> стратеги', at('update-check') === 0 && at('update-check') < at('enrich-check:before') && at('enrich-check:before') < at('sitemap-enrich') && at('sitemap-enrich') < at('enrich-check:after') && at('enrich-check:after') < firstStrategist, el.join(', '));
  const enr = en.calls.find(c => c.label === 'sitemap-enrich');
  check('wf-04 enrich: обогатитель - 01-sitemap-enricher с mode=facts, сильная модель', enr && enr.prompt.includes('prompts/01-sitemap-enricher.md') && enr.prompt.includes('Параметры: mode=facts.') && enr.model === 'M-STRONG', enr && `${enr.model}: ${enr.prompt.slice(-200)}`);
  const before = en.calls.find(c => c.label === 'enrich-check:before'), after = en.calls.find(c => c.label === 'enrich-check:after');
  // флаги и коды - как в import-structure.mjs (P2): --check-enrich before|after; after: 0 - ок, 3 - откат, 2 - нет копии
  check('wf-04 enrich: сверка карты скриптом до (before) и после (after), легкой моделью', before && after && before.prompt.includes('import-structure.mjs --check-enrich before\n') && after.prompt.includes('import-structure.mjs --check-enrich after\n') && before.model === 'M-LIGHT' && after.model === 'M-LIGHT', [before && before.prompt, after && after.prompt].join(' | '));
  check('wf-04 enrich: в итоге enrich ok', en.result && en.result.enrich && en.result.enrich.ok === true && en.result.enrich.rolled_back === false, JSON.stringify(en.result && en.result.enrich));
  const enHit = new Set(en.calls.map(c => roleOf04(c.label)));
  check('wf-04 enrich: вызваны роли run и sitemap-enrich; у каждого вызова роль из ROLES', UPDATE_ONLY.every(x => enHit.has(x)) && en.calls.every(c => roleOf04(c.label) in roles), en.calls.map(c => c.label).filter(l => !(roleOf04(l) in roles)).join(', '));
  const enBad = en.calls.filter(c => c.model !== (roles[roleOf04(c.label)] === 'light' ? 'M-LIGHT' : 'M-STRONG')).map(c => `${c.label}=${c.model}`);
  check('wf-04 enrich: модели по ярусам ролей', !enBad.length, enBad.join(', '));

  // сверка нашла лишние изменения карты - откат скриптом, строка в итоге, стратеги идут дальше
  const rb = await runWf(WF, { ...BASE, update: true, enrich: true }, wf04Reply({ 'enrich-check:after': { ok: false, exit_code: 3, stdout_tail: ' - откат: okna: поле segment изменено' } }));
  check('wf-04 enrich: лишние изменения карты (код 3) - rolled_back и строка в итоге', rb.result && rb.result.enrich && rb.result.enrich.ok === false && rb.result.enrich.rolled_back === true && /segment/.test(rb.result.enrich.notes) && /вернул ее из копии/.test(rb.result.enrich.notes), JSON.stringify(rb.result && rb.result.enrich));
  check('wf-04 enrich: после отката стратеги все равно работают', strategists(rb).length > 0);
  // код 2 после обогатителя - сверки не было (нет копии): не откат и не «изменилось лишнее»
  const nc = await runWf(WF, { ...BASE, update: true, enrich: true }, wf04Reply({ 'enrich-check:after': { ok: false, exit_code: 2, stdout_tail: 'нет копии work/sitemap.pre-enrich.json: сначала --check-enrich before' } }));
  check('wf-04 enrich: код 2 после обогатителя - «сверка не выполнена», не откат', nc.result && nc.result.enrich && nc.result.enrich.ok === false && nc.result.enrich.rolled_back === false && /сверка не выполнена \(код 2: нет карты или копии\)/.test(nc.result.enrich.notes) && !/сверх/.test(nc.result.enrich.notes), JSON.stringify(nc.result && nc.result.enrich));
  // прочий ненулевой код (например, падение node) - тоже не откат
  const c1 = await runWf(WF, { ...BASE, update: true, enrich: true }, wf04Reply({ 'enrich-check:after': { ok: false, exit_code: 1, stdout_tail: 'SyntaxError' } }));
  check('wf-04 enrich: код 1 после обогатителя - не откат', c1.result && c1.result.enrich && c1.result.enrich.rolled_back === false && /сверка не выполнена \(код 1\)/.test(c1.result.enrich.notes), JSON.stringify(c1.result && c1.result.enrich));
  // копия карты не снята - обогатитель не запускается
  const nb = await runWf(WF, { ...BASE, update: true, enrich: true }, wf04Reply({ 'enrich-check:before': { ok: false, exit_code: 2, stdout_tail: 'нет work/sitemap.json' } }));
  check('wf-04 enrich: без копии карты обогатитель не вызывается', !labelsOf(nb).includes('sitemap-enrich') && nb.result && nb.result.enrich && nb.result.enrich.ok === false, labelsOf(nb).join(', '));
  // enrich без update не действует
  const eo = await runWf(WF, { ...BASE, enrich: true }, wf04Reply());
  check('wf-04: enrich без update - ни проверки отчета, ни обогатителя', !labelsOf(eo).some(l => l === 'update-check' || l === 'sitemap-enrich' || /^enrich-check:/.test(l)) && eo.logs.some(m => /args\.enrich без args\.update/.test(m)), labelsOf(eo).join(', '));

  // skipLayouts: раскладки не перегенерируются, стратегия идет
  const sl = await runWf(WF, { ...BASE, update: true, skipLayouts: true }, wf04Reply());
  check('wf-04 skipLayouts: нет вызовов генератора раскладок, layouts = skipped', !labelsOf(sl).some(l => /^layout:/.test(l)) && (sl.result || {}).layouts === 'skipped' && strategists(sl).length > 0, labelsOf(sl).join(', '));

  // wf-04 с настоящим scripts/import-structure.mjs (P2) на копии smoke-фикстуры: команды сверки из промтов run-агента
  // исполняются по-настоящему, заглушка только у обогатителя - флаги, коды и откат wf-04 и скрипта совпадают
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cases-prompts-enrich-'));
  try {
    for (const d of ['scripts', 'schemas']) fs.cpSync(path.join(KIT, d), path.join(tmp, d), { recursive: true });
    const MAP = path.join(tmp, 'work', 'sitemap.json'), COPY = path.join(tmp, 'work', 'sitemap.pre-enrich.json');
    const fixture = fs.readFileSync(path.join(KIT, 'examples', 'smoke-fixtures', 'work', 'sitemap.json'), 'utf8');
    const reset = () => { fs.mkdirSync(path.dirname(MAP), { recursive: true }); fs.writeFileSync(MAP, fixture); fs.rmSync(COPY, { force: true }); };
    const exec = prompt => {
      const m = prompt.match(/&& node (scripts\/\S+)([^\n]*)\n/);
      if (!m) return { ok: false, exit_code: -1, stdout_tail: 'команда не найдена в промте' };
      const r = spawnSync(process.execPath, [m[1], ...m[2].trim().split(/\s+/).filter(Boolean)], { cwd: tmp, encoding: 'utf8' });
      return { ok: r.status === 0, exit_code: r.status, stdout_tail: ((r.stdout || '') + (r.stderr || '')).split('\n').slice(-40).join('\n') };
    };
    const enricher = fn => () => { const m = JSON.parse(fs.readFileSync(MAP, 'utf8')); fn(m); fs.writeFileSync(MAP, JSON.stringify(m, null, 2)); return { ok: true, summary: '{"pages":1}' }; };
    const realRun = enrich => runWf(WF, { ...BASE, root: tmp, update: true, enrich: true }, wf04Reply({ 'enrich-check:before': exec, 'enrich-check:after': exec, 'sitemap-enrich': enrich }));
    const homeOf = () => JSON.parse(fs.readFileSync(MAP, 'utf8')).pages.find(p => p.slug === 'home');
    const fixHome = JSON.parse(fixture).pages.find(p => p.slug === 'home');

    reset();
    const good = await realRun(enricher(m => { m.pages.find(p => p.slug === 'home').block_set = 'short'; }));
    const ge = (good.result || {}).enrich || {};
    check('wf-04 + import-structure: обогатитель запущен, правка block_set прошла сверку', labelsOf(good).includes('sitemap-enrich') && ge.ok === true && ge.rolled_back === false && homeOf().block_set === 'short' && !fs.existsSync(COPY) && /страниц с изменениями 1 \(home\)/.test(ge.notes || ''), JSON.stringify(ge) + ' | ' + labelsOf(good).join(', '));

    reset();
    const bad = await realRun(enricher(m => { const h = m.pages.find(p => p.slug === 'home'); h.segment = 'S9'; h.block_set = 'short'; }));
    const be = (bad.result || {}).enrich || {};
    check('wf-04 + import-structure: лишняя правка карты - скрипт откатил (код 3), wf-04 rolled_back', be.ok === false && be.rolled_back === true && /home: поле segment изменено/.test(be.notes || '') && JSON.stringify(homeOf()) === JSON.stringify(fixHome) && strategists(bad).length > 0, JSON.stringify(be));

    reset();
    const lostCopy = await realRun(() => { fs.rmSync(COPY, { force: true }); return { ok: true, summary: '{}' }; });
    const le = (lostCopy.result || {}).enrich || {};
    check('wf-04 + import-structure: копия пропала (код 2) - «сверка не выполнена», не откат', le.ok === false && le.rolled_back === false && /сверка не выполнена \(код 2: нет карты или копии\)/.test(le.notes || ''), JSON.stringify(le));

    fs.rmSync(MAP, { force: true }); fs.rmSync(COPY, { force: true });
    const noMap = await realRun(enricher(() => {}));
    const ne = (noMap.result || {}).enrich || {};
    check('wf-04 + import-structure: нет карты - копия не снята, обогатитель не вызван', !labelsOf(noMap).includes('sitemap-enrich') && ne.ok === false && /копия карты не снята \(код 2/.test(ne.notes || ''), JSON.stringify(ne));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

{
  // wf-03: компилируется и проходит обе ветки (без находок и с фиксером и вторым кругом)
  const reply = serious => (label, prompt) => {
    if (label === 'prep-args') return { ok: true, type_pages: [{ type: 'home', pages: 1 }, { type: 'category', pages: 3 }] };
    if (/^audit:.+:1$/.test(label)) return { results: typesOf(prompt).map(t => ({ type: t, verdict: serious ? 'fix' : 'pass', summary: 's', blocker: 0, major: serious ? 1 : 0 })) };
    if (/^audit:.+:2$/.test(label)) return { results: typesOf(prompt).map(t => ({ type: t, verdict: 'pass', summary: 's', blocker: 0, major: 0 })) };
    if (/^fix:/.test(label)) return { results: typesOf(prompt).map(t => ({ type: t, fixed: 1, rejected: 0, left_open: 0 })) };
    return null;
  };
  const a = await runWf('workflows/wf-03-audit-types.js', BASE, reply(false));
  check('wf-03: прогон без находок', !a.threw && !a.errors.length && !a.calls.some(c => /^fix:/.test(c.label)), a.threw || a.errors.join(' | '));
  const b = await runWf('workflows/wf-03-audit-types.js', BASE, reply(true));
  check('wf-03: находки - фиксер и второй круг', !b.threw && b.calls.some(c => /^fix:/.test(c.label)) && b.calls.some(c => /^audit:.+:2$/.test(c.label)), b.threw || b.calls.map(c => c.label).join(', '));
  const roles = rolesOf(TEXT['workflows/wf-03-audit-types.js']);
  check('wf-03: таблица ролей без изменений', JSON.stringify(roles) === JSON.stringify({ 'prep-args': 'light', 'type-audit': 'strong', 'type-fix': 'strong' }), JSON.stringify(roles));
}

failures.forEach(f => console.log(f));
console.log(`cases-prompts: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
