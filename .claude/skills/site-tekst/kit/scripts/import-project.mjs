// Импорт контракта анализа site-analiz (project.json v2) во входы текстового алгоритма.
// Второй вход фазы 0 вместо прозы inputs/analysis.md (режим config sources.mode = "project").
//
// node scripts/import-project.mjs [--project <project.json>] [--facts-src <facts-src.json>] [--queue <queue.json>]
//                                 [--structure <structure_data.json>] [--allow-ungated]
// node scripts/import-project.mjs --facts-only [--force] [те же пути и --allow-ungated]
// node scripts/import-project.mjs --apply-patterns work/anti-promises.patterns.json
// node scripts/import-project.mjs --company-facts
//
// Запуск из корня проекта текстов. Пути по умолчанию: config/project.json -> sources.project_json, facts_src, queue,
// structure_input; facts-src и queue иначе ищутся рядом с project.json (parts/facts-src.json, queue.json).
// Пишет: work/facts.json, work/audience.json, work/client-preferences.json, work/directions.json,
// work/competitors/seed.json, config/project.json (company, site_url, niche.*, sources.*), inputs/analysis.md
// (рендер, scripts/render-analysis.mjs), inputs/structure_data.json (копия --structure), work/import-report.json.
// niche.yandex_id и niche.keyso_base - по региону (scripts/regions.mjs), niche.site_kind - тип сайта анализа; рядом со
// структурой лежит competitors.json seo-base - копия work/competitors/structure-competitors.json (ее отпечаток - раздел
// structure-competitors в analysis_fingerprint, только если копия есть). Домены затравки - scripts/domains.mjs.
// Регулярки антиобещаний скрипт не сочиняет: оставляет заглушку (?!) (не ловит ничего), их пишет агент по
// prompts/00-antipromise-patterns.md в work/anti-promises.patterns.json, а --apply-patterns проверяет каждую
// на примерах агента (3 должны ловиться, 2 нет) и переносит прошедшие в work/facts.json. Если файл регулярок
// уже есть, импорт применяет его сам (для антиобещаний с тем же текстом).
// Связь возражения с фактами: objection[].facts контракта, если поле есть (только публикуемые, остальное - строкой
// в warnings); у старого контракта без поля - эвристика по числу или паре слов (heuristic). Служебная пометка
// вместо значения факта - одно правило с анализом, SERVICE_NOTE из .claude/scripts/site/_contract.mjs (lib.mjs ->
// serviceNoteRule). Решения гейта d1-d8, d9 (состав страниц) и d10 (контакты и реквизиты) - в report.gate.decisions
// и в inputs/analysis.md.
// Контакты и реквизиты (business.legal) - в facts.company (телефоны в формате «+7 (XXX) XXX-XX-XX», scripts/contacts.mjs)
// и служебными фактами с id по полю: F901-F903 телефоны, F904 почта, F905 часы, F906 адрес, F907 юрлицо, ИНН, ОГРН.
// Дубль контактного факта анализа (те же цифры телефона, почта, адрес, часы, ИНН/ОГРН) не заводится. Сверено
// заказчиком (company.status confirmed) - только при пройденном гейте и принятом без правки решении d10; иначе строка
// gaps «контакты и реквизиты не сверены заказчиком». business.legal.phone_absent анализа - company.no_phone: true, телефон
// ниоткуда не берется (старое имя company.phone_absent читается и переводится в no_phone). В report.company_missing -
// пустые телефон, адрес, часы: по ним фаза 0 снимает сайт. report.company_origin - откуда каждое поле company: analysis
// (business.legal) или site (снимок сайта); по нему --company-facts и --facts-only отличают данные снимка от анализа.
// Поля, которые заказчик велел убрать ответом на d10 (business.legal.absent_fields, контракт K1), - company.absent в именах
// kit (schedule -> hours, entity -> legal_name; телефон - no_phone): их нет в company, в F9xx и в company_missing, данные
// снимка по ним снимаются, контактные факты анализа о них (по label или значению) получают publish: no и строку gaps
// «Fxx «label» не подтвержден или снят на гейте: заказчик снял в d10 (...)» - так во всех трех режимах (полный импорт,
// --facts-only, --company-facts). Каналы company.channels - только из фактов (анализа, оператора); канал со старого сайта без
// факта - строка gaps «канал со старого сайта: <подпись> <ссылка> - публиковать?» (вопрос заказчику).
// До гейта (--allow-ungated) publish: no у фактов значит «не подтверждено», поля company по нему не снимаются.
// Факты оператора F801-F899 (source «оператор: <дата> <основание>», заводит человек при --fix) импорт сохраняет; факт,
// перенесенный в анализ (у факта анализа moved_from: "F8NN", K11), снимает с предупреждением.
// Маркер снятия в тексте факта (явные пометки «не публиковать», «(снято ...)», K2) при publish: yes - строка «конфликт:»
// в gaps; правило - HELD_MARK из _contract.mjs анализа или копия HELD_MARK_COPY ниже. Факт с пометкой, публикацию которого
// подтвердил заказчик на гейте (журнал queue.json), - предупреждение в import-report, а не конфликт.
// report.analysis_fingerprint - хеши того, что пришло из анализа помимо фактов (ЦА, пожелания, направления, затравка
// конкурентов, антиобещания, реквизиты; K3): по ним --facts-only видит правку анализа, а не правки стратегов.
//
// --facts-only: правка анализа посреди прогона. Из анализа пересобираются только facts[] и строки gaps про факты;
// company: поля business.legal анализа - из анализа, пустые - из текущего company, только если их дал снимок сайта
// (поле прошлого анализа, снятое сейчас, например правкой d10, убирается вместе со служебным фактом);
// F901-F907 пересобираются с теми же id, anti_promises с регулярками, терминология, тон и прочие выходы
// не трогаются. Перед записью facts[] сверяется с дайджестом прошлого импорта (import-report.json -> facts_digest,
// без F8xx и F9xx): facts.json правили руками - дифф по id и код 3 (без --force ничего не записано). Нет дайджеста
// (старая задача) - сверка с тем, что дает анализ сейчас. В отчете - facts_diff (что изменилось в анализе; его читает
// режим обновления стратегии wf-04 args.update) и other_changed (изменились ЦА, пожелания, направления, конкуренты,
// антиобещания - нужен повтор фазы 0): по analysis_fingerprint прошлого импорта, в отчете без него - по рабочим файлам
// (пожелания - парами «текст, статус»).
// --company-facts: после снимка сайта (00-site-snapshot) дописывает служебные факты F9xx из facts.company в пустые
// слоты, нормализует телефоны, каналы из фактов - объектами, каналы снимка - в gaps, поля company.absent снимает; не
// требует project.json и гейта (работает и в режиме doc).
// Коды выхода: 0 - записано; 1 - выход не прошел схему или регулярки не прошли проверку; 2 - нет входа или гейт
// анализа не согласован (queue.json -> gate.approved), без --allow-ungated; 3 - --facts-only: facts.json правили руками.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { argv, P, readJson, writeJson, writeText, readText, exists, nowIso, loadSchema, validate, normalizeText, esc, serviceNoteRule } from './lib.mjs';
import { renderAnalysis, factsSection, gapsSection, replaceSection } from './render-analysis.mjs';
import { parseCompetitor, normDomain } from './domains.mjs';
import { parseRegion } from './regions.mjs';
import { noPhone, absentOf, ABSENT_KIT } from './absent.mjs';
import { phoneDigits, phoneFormat, phonesInText, formatPhonesInText, buildChannels, splitChannels, syncChannelGaps, CHANNELS } from './contacts.mjs';

const a = argv({ 'allow-ungated': 'bool', 'facts-only': 'bool', 'company-facts': 'bool', force: 'bool' });
const SENTINEL = '(?!)';
const PENDING_GAP = 'регулярка антиобещания ';
const CONTACT_GAP = 'контакты и реквизиты не сверены заказчиком';
const SERVICE_ID = /^F9\d\d$/;
const OPERATOR_ID = /^F8\d\d$/;
const isAnalysisFact = f => !SERVICE_ID.test(f.id) && !OPERATOR_ID.test(f.id);
const T = s => (typeof s === 'string' ? normalizeText(s) : typeof s === 'number' ? String(s) : '');
const len = s => Array.from(s || '').length;
const arr = x => (Array.isArray(x) ? x : []);
const rel = f => path.relative(process.cwd(), f).replace(/\\/g, '/');
const abs = f => (f ? path.resolve(f) : '');
const die = (code, msg) => { console.error(msg); process.exit(code); };
const sha = s => crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);
const canon = v => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().filter(key => key !== 'generated_at').map(key => [key, x[key]])) : x));

// Число с единицей: копия UNIT/NUM_UNIT из site-analiz .claude/scripts/site/_contract.mjs (одно определение
// «проверяемого факта» на обе стороны стыка; при правке там - поправить и тут).
const UNIT = '%|₽|руб[а-я]*|тыс[а-я.]*|млн|млрд|шт[а-я.]*|кв\\.?\\s?м|м2|м²|мм|см|км|кг|тонн[а-я]*|литр[а-я]*|год[а-я]*|лет|месяц[а-я]*|мес(?![а-я])|недел[а-я]+|дней|дня|день|дн(?![а-я])|час[а-я]*|мин[а-я]*|раз(?![а-я])|человек[а-я]*|сотрудник[а-я]*|специалист[а-я]*|объект[а-я]*|проект[а-я]*|клиент[а-я]*|позици[а-я]+|балл[а-я]*|ед(?![а-я])|м(?![а-яa-z])|т(?![а-яa-z])|л(?![а-яa-z])';
const NUM_UNIT = new RegExp('\\d[\\d\\s.,]*\\s*(?:' + UNIT + ')', 'i');
// Маркер снятия (контракт K2): только явные пометки - «не публиковать», «не разглашать», «не показывать на сайте», «не для
// сайта», «не для печати» где угодно (кроме обещания и разрешения: «обязуемся / обязаны / можем / может / можете / вправе
// не раскрывать», в том числе через одно-три слова, «можно не печатать»); «не публикуем», «не показываем», «не указываем»,
// «не называем» (и «... на сайте») целым полем или куском после «:», «;», «(», «[», «,», «.», « - »; «(скрыть)», «(убрать)»; «под NDA»,
// «коммерческая тайна» куском после «:», «;», «(», « - »; «NDA» куском после «:», «;», « - » (кроме «договор: NDA», «защита
// идеи: NDA»); «конфиденциально» после «:», «(», а после «,» и « - » - если перед ними не наречие на «-о» («120 млн,
// конфиденциально» - пометка, «анонимно, конфиденциально» - нет); «строго конфиденциально», «конфиденциальная информация» -
// только после «:», «(»; «(внутреннее)» (кроме пояснения прилагательного среднего рода: «квартирное (внутреннее)»), «(NDA)» (кроме
// расшифровки «соглашение о конфиденциальности (NDA)») - скобкой; «для внутреннего пользования»; «(снято)», «(снято
// заказчиком)», «- снято заказчиком». Продающие «снимаем мерки», «гарантируем конфиденциальность», «Строго
// конфиденциально», «соблюдаем коммерческую тайну», «работаем под NDA», «(снятие старых окон)» не ловит. Проверяется каждое
// поле факта отдельно. Слово-пометка целым полем («NDA», «под NDA», «конфиденциально», «коммерческая тайна») - пометка только
// как значение (или artifact) поля, подпись которого не о тайне и защите: HELD_NDA_FIELD_COPY проверяет строку
// «подпись\nзначение» («Выручка» - «NDA» закрыт; «Договор», «Анонимность», «Гарантии» - «NDA», «конфиденциально» -
// продающие; подпись целым полем - тема). Одно правило с анализом: HELD_MARK и HELD_NDA_FIELD из
// .claude/scripts/site/_contract.mjs (ищется рядом с SERVICE_NOTE), вне проекта - эти копии.
// Литералы копируются дословно (е с точками - через \u0451); равенство копий и экспорта сверяет набор tests/site-tekst
// (cases-import.mjs).
const HELD_MARK_COPY = /(^|[^а-я\u0451a-z0-9])(?<!(^|[^а-я\u0451])(обязу|обязан|гарантиру|обеща|мож|вправе|будем|стара|чтоб)[а-я\u0451]*\s+([а-я\u0451]+\s+){0,3})(не\s+(публиковать|печатать|указывать|упоминать|раскрывать|разглашать|называть|показывать|размещать|озвучивать)|не\s+для\s+(сайта|публикации|печати|размещения|распространения|показа))(?![а-я\u0451])|(^|[:;(\[,.]|\s[-\u2013\u2014])\s*не\s+(публик[а-я\u0451]*|печата[а-я\u0451]*|(показыва|указыва|размеща|выкладыва|озвучива|называ)(ем|ется|ются|ть|йте))(\s+(на|в)\s+(сайте|открытом\s+доступе|интернете|сети))?\s*($|[),.;!\]])|[(\[]\s*(скрыть|скрыто|скрыта|скрыты|скрываем|убрать|убираем)\s*[)\]]|([:;(\[]|\s[-\u2013\u2014])\s*(под\s+nda|коммерческ[а-я\u0451]*\s+тайн[а-я\u0451]*)\s*($|[).;!\]])|(?<!(nda|конфиденц|неразглаш|соглаш|договор|тайн|секрет|аноним|приватн|защит|гарант|безопасн)[^:;\n]*)([:;]|\s[-\u2013\u2014])\s*nda\s*($|[).;!])|(?<!(конфиденциальност|неразглашени|соглашени|договор)[а-я\u0451]*\s*)\(\s*nda\s*\)|([:(\[]|(?<![а-я\u0451]о)(,|\s[-\u2013\u2014]))\s*конфиденциально\s*($|[).;!\]])|[:(]\s*(строго\s+конфиденциально|конфиденциальн(ая|ые)\s+(информация|данные|сведения))\s*($|[).;!])|(?<![а-я\u0451](ое|ее)\s*)\(\s*внутреннее\s*\)|(^|[:;(]|\s[-\u2013\u2014]|только\s+)\s*для\s+внутренн[а-я\u0451]*\s+(пользования|использования)|\(\s*снят[оаы]?(\s+(заказчиком|с\s+публикации))?\s*\)|(^|[:;,]|\s[-\u2013\u2014])\s*снят[оаы]?\s+(заказчиком|с\s+публикации)\s*($|[).;!])/i;
const HELD_NDA_FIELD_COPY = /^(?![^\n]*(nda|конфиденц|неразглаш|соглаш|договор|тайн|секрет|аноним|приватн|защит|гарант|безопасн))[^\n]*\n\s*(nda|под\s+nda|конфиденциально|коммерческ[а-я\u0451]*\s+тайн[а-я\u0451]*)\s*[.!]?\s*$/i;

// ---------------------------------------------------------------- проверка регулярок антиобещаний
function checkPattern(item) {
  const errs = [];
  const pat = String(item.lint_pattern || '');
  if (!pat || pat === SENTINEL) return ['регулярка пустая или заглушка'];
  if (/\\[bBwW]/.test(pat)) errs.push('\\b, \\B, \\w, \\W не работают с кириллицей: границу слова задавай (?<![а-я]), букву - [а-я]');
  if (/[\u0451\u0401]/.test(pat)) errs.push('буква е с точками в регулярке (house style ее запрещает, в текстах ее нет)');
  if (/(^|[^\\])\.[*+]/.test(pat)) errs.push('.* и .+ без предела ловят лишнее: вместо них [а-я ,]{0,30}');
  let re;
  try { re = new RegExp(pat, 'i'); } catch (e) { errs.push('не компилируется: ' + e.message); return errs; }
  if (re.test('') || re.test(' ') || re.test('а')) errs.push('ловит пустую строку или одну букву');
  const mm = arr(item.must_match), mn = arr(item.must_not_match);
  if (mm.length < 3) errs.push(`примеров, которые должны ловиться, ${mm.length}, нужно 3`);
  if (mn.length < 2) errs.push(`примеров, которые не должны ловиться, ${mn.length}, нужно 2`);
  for (const x of mm) if (!re.test(T(x))) errs.push(`не ловит «${x}»`);
  for (const x of mn) if (re.test(T(x))) errs.push(`ловит безобидное «${x}»`);
  return errs;
}

// Шаблон по основам слов для коротких запретов (constraints.forbidden): LLM не нужен.
function stemPattern(phrase) {
  const words = T(phrase).toLowerCase().replace(/[«»"()]/g, '').split(/\s+/).filter(Boolean);
  if (!words.length) return SENTINEL;
  return '(?<![а-яa-z])' + words.map(w => {
    const cls = /[а-я]/.test(w) ? '[а-я]' : '[a-z]';
    return w.length > 4 ? esc(w.slice(0, -2)) + cls + '*' : esc(w) + `(?!${cls})`;
  }).join('\\s+');
}

// Применение файла регулярок к facts.json: возвращает {ok, failed, conflicts}.
function applyPatterns(facts, file, report, { onlySameText }) {
  const res = { ok: [], failed: [], conflicts: [] };
  if (file && exists(file)) {
    let pf = null;
    try { pf = readJson(file); } catch (e) { res.failed.push({ id: '*', errors: [`невалидный JSON: ${e.message} (обратная косая в строке JSON пишется двойной: \\\\s)`] }); return res; }
    const schemaErr = validate(loadSchema('antipromise-patterns'), pf);
    if (schemaErr.length) { res.failed.push({ id: '*', errors: schemaErr.slice(0, 10) }); return res; }
    const byId = Object.fromEntries(facts.anti_promises.map(x => [x.id, x]));
    for (const it of pf.items) {
      const ap = byId[it.id];
      if (!ap) { res.failed.push({ id: it.id, errors: ['такого антиобещания нет в work/facts.json'] }); continue; }
      if (it.text && T(it.text) !== ap.text) {
        if (onlySameText) continue; // текст сменился после прошлого импорта: регулярка устарела, остается заглушка
        res.failed.push({ id: it.id, errors: ['text в файле регулярок не совпадает с текстом антиобещания'] }); continue;
      }
      const errs = checkPattern(it);
      if (errs.length) { res.failed.push({ id: it.id, errors: errs }); continue; }
      ap.lint_pattern = it.lint_pattern;
      if (it.allowed_context) ap.allowed_context = T(it.allowed_context);
      res.ok.push(it.id);
    }
    const factIds = new Set(facts.facts.map(f => f.id));
    for (const c of arr(pf.conflicts)) {
      if (!factIds.has(c.fact) || !byId[c.anti]) { report.warnings.push(`конфликт ${c.fact} против ${c.anti} из файла регулярок: нет такого факта или антиобещания`); continue; }
      res.conflicts.push(`конфликт: ${c.fact} против ${c.anti}${c.why ? ` (${T(c.why)})` : ''}`);
    }
  }
  // регулярка ловит формулировку опубликованного факта - писатель не сможет ее взять
  for (const ap of facts.anti_promises) {
    if (ap.lint_pattern === SENTINEL) continue;
    let re;
    try { re = new RegExp(ap.lint_pattern, 'i'); } catch { continue; }
    for (const f of facts.facts) if (f.publish === 'yes' && (re.test(f.wording) || re.test(f.value))) res.conflicts.push(`конфликт: ${f.id} против ${ap.id} (регулярка ловит формулировку факта)`);
  }
  return res;
}

function syncAntiGaps(facts, report, conflicts) {
  const pending = facts.anti_promises.filter(x => x.lint_pattern === SENTINEL).map(x => x.id);
  // строки прошлого применения регулярок снимаются целиком: повтор --apply-patterns дает тот же результат
  const prev = new Set(report.anti.conflicts || []);
  facts.gaps = facts.gaps.filter(g => !g.startsWith(PENDING_GAP) && !prev.has(g));
  for (const id of pending) facts.gaps.push(`${PENDING_GAP}${id} не задана: линтер это антиобещание не ловит`);
  const added = [];
  for (const c of conflicts) {
    const key = c.split(' (')[0];
    if (!facts.gaps.some(g => g.split(' (')[0] === key)) { facts.gaps.push(c); added.push(c); }
  }
  report.anti.pending = pending;
  report.anti.conflicts = added;
  return pending;
}

function validateOut(name, file, data, problems) {
  const errs = validate(loadSchema(name), data);
  if (errs.length) problems.push(`${file} (${name}): ${errs.slice(0, 5).join('; ')}`);
}

// Формулировка до 160 знаков: обрезка по слову; если обрезка съела хвост - полный текст в note и предупреждение.
function cutWording(text, onCut) {
  if (len(text) <= 160) return { wording: text };
  const w = Array.from(text).slice(0, 160).join('').replace(/\s+\S*$/, '').replace(/[\s,;:(-]+$/, '');
  onCut && onCut();
  const full = len(text) <= 400 ? text : Array.from(text).slice(0, 396).join('').replace(/\s+\S*$/, '') + ' ...';
  return { wording: w, note: `полная формулировка: ${full}`.slice(0, 400) };
}

// ---------------------------------------------------------------- контакты и реквизиты (C2)
const validInn = s => /^(\d{10}|\d{12})$/.test(T(s).replace(/\s/g, ''));
const validOgrn = s => /^(\d{13}|\d{15})$/.test(T(s).replace(/\s/g, ''));
const normTxt = s => T(s).toLowerCase().replace(/[^а-яa-z0-9]+/g, '');
const legalLine = c => [c.legal_name, c.inn ? `ИНН ${c.inn}` : '', c.ogrn ? `ОГРН ${c.ogrn}` : ''].filter(Boolean).join(', ');
// Слоты служебных фактов: id закреплен за полем, пустое поле пропускает свой номер без сдвига.
const SLOTS = [
  { id: 'F901', field: 'phones', idx: 0, label: 'Телефон', legal: 'phone' },
  { id: 'F902', field: 'phones', idx: 1, label: 'Телефон 2', legal: 'phone' },
  { id: 'F903', field: 'phones', idx: 2, label: 'Телефон 3', legal: 'phone' },
  { id: 'F904', field: 'email', label: 'Электронная почта', legal: 'email' },
  { id: 'F905', field: 'hours', label: 'Часы работы', legal: 'schedule' },
  { id: 'F906', field: 'address', label: 'Адрес', legal: 'address' },
  { id: 'F907', field: 'legal', label: 'Юрлицо и реквизиты', legal: 'entity', kind: 'legal' },
];
const FIELD_NAME = { phones: 'телефон', email: 'почта', hours: 'часы работы', address: 'адрес', legal: 'юрлицо и реквизиты' };
const slotValue = (company, s) => (s.field === 'phones' ? arr(company.phones)[s.idx] || '' : s.field === 'legal' ? legalLine(company) : T(company[s.field]));
// Совпадает ли значение поля company с фактом анализа (дубль): телефон - по цифрам, почта - по адресу, адрес и часы -
// по нормализованному тексту (факт содержит значение), юрлицо - по ИНН или ОГРН (без них - по названию).
function sameAs(field, v, company, f) {
  const hay = `${T(f.value)} ${T(f.wording)}`;
  if (!v) return false;
  if (field === 'phones') { const d = phoneDigits(v); return d.length >= 10 && [...phonesInText(hay), T(f.value)].some(p => phoneDigits(p) === d); }
  if (field === 'email') return hay.toLowerCase().includes(v.toLowerCase());
  if (field === 'legal') {
    const digits = hay.replace(/\D/g, ' ');
    if (company.inn || company.ogrn) return [company.inn, company.ogrn].filter(Boolean).some(x => new RegExp(`(^|\\D)${x}(\\D|$)`).test(digits));
    return f.kind === 'legal' && normTxt(company.legal_name).length >= 5 && normTxt(hay).includes(normTxt(company.legal_name));
  }
  const n = normTxt(v);
  return n.length >= 8 && normTxt(hay).includes(n);
}
const contactLike = f => f && (f.kind === 'contact' || f.kind === 'legal');
// Заказчик без телефона (noPhone) и поля, которые заказчик велел убрать ответом на d10 (контракт K1: ABSENT_KIT,
// ABSENT_FIELDS, absentOf) - общий модуль scripts/absent.mjs (его же читает оболочка прототипа, site-parts.mjs). Снятое
// поле не берется ни из анализа, ни со снимка сайта, снимок ради него не зовется (company_missing), служебного факта F9xx нет.
const CO_NAME = { email: 'почта', hours: 'часы работы', address: 'адрес', legal_name: 'юрлицо', inn: 'ИНН', ogrn: 'ОГРН' };
// Нормализация company: телефоны в едином формате без повторов (исходный вид - в rawPhones), no_phone, поля absent,
// маска ИНН/ОГРН, снятие полей, совпавших с фактом анализа publish: no (только после гейта: honorUnpublished).
// Возвращает {rawPhones, notes}.
function prepareCompany(company, analysisFacts, warn, honorUnpublished = true) {
  const rawPhones = {};
  const notes = [];
  if (noPhone(company)) company.no_phone = true;
  delete company.phone_absent;
  const absent = absentOf(company);
  if (absent.length) company.absent = absent; else delete company.absent;
  for (const k of absent) {
    if (!T(company[k])) { delete company[k]; continue; }
    warn(`${CO_NAME[k]} «${T(company[k])}» не взят: заказчик снял это поле ответом на d10 (company.absent), ни из анализа, ни со старого сайта оно не публикуется`);
    delete company[k];
  }
  if (company.no_phone) {
    if (arr(company.phones).length) warn(`телефон ${company.phones.join(', ')} не взят: в анализе записано, что телефона для сайта нет (no_phone)`);
    delete company.phones;
  } else if (company.phones != null) {
    const seen = new Set();
    const out = [];
    for (const p of arr(company.phones).map(T).filter(Boolean)) {
      const d = phoneDigits(p);
      if (seen.has(d)) continue;
      seen.add(d);
      const f = phoneFormat(p);
      rawPhones[f] ??= p;
      out.push(f);
    }
    if (out.length) company.phones = out; else delete company.phones;
  }
  for (const [k, ok, what] of [['inn', validInn, 'ИНН: 10 или 12 цифр'], ['ogrn', validOgrn, 'ОГРН: 13 или 15 цифр']]) {
    if (company[k] == null) continue;
    const v = T(company[k]).replace(/\s/g, '');
    if (ok(v)) company[k] = v;
    else { warn(`${k.toUpperCase()} «${company[k]}» неверной длины (${what}) - не публикуется`); delete company[k]; }
  }
  const off = honorUnpublished ? analysisFacts.filter(f => f.publish === 'no' && contactLike(f)) : [];
  for (const field of ['phones', 'email', 'hours', 'address', 'legal']) {
    if (field === 'phones') {
      const keep = arr(company.phones).filter(p => { const f = off.find(x => sameAs('phones', p, company, x)); if (f) notes.push(`телефон ${p} снят заказчиком (${f.id} publish no): в company и на сайт не идет`); return !f; });
      if (company.phones) { if (keep.length) company.phones = keep; else delete company.phones; }
      continue;
    }
    const v = field === 'legal' ? legalLine(company) : T(company[field]);
    const f = v && off.find(x => sameAs(field, v, company, x));
    if (!f) continue;
    notes.push(`${FIELD_NAME[field]} снят заказчиком (${f.id} publish no): в company и на сайт не идет`);
    if (field === 'legal') { delete company.legal_name; delete company.inn; delete company.ogrn; } else delete company[field];
  }
  return { rawPhones, notes };
}
// Контактные факты о полях, которые заказчик снял в d10 (K1: company.absent и телефон при no_phone). Факт kind contact
// или legal с publish: yes, который относится к такому полю, получает publish: no и строку gaps «Fxx «label» не
// подтвержден или снят на гейте: заказчик снял в d10 (<поле>), на сайт не идет» (отчет относит ее к «Не подтверждено или
// снято», вопросом заказчику она не уходит). Поле факта: телефон - слово «телефон» в label или цифры снятого номера
// (факт, названный мессенджером, - канал: остается, при том же номере - предупреждение); почта - по label или адресу почты
// в значении; часы, адрес, юрлицо, ИНН, ОГРН - по label, по значению снятого поля (removed: прежние значения из анализа,
// прошлого company, снимка) или по виду значения (ИНН и ОГРН с цифрами, организационная форма в реквизитах). Факты
// оператора F8xx не снимаются - предупреждение. Возвращает {lines, ids}.
const HOLD_LABEL = {
  phones: /телефон/i,
  email: /электронн[а-я]* почт|e-?mail|(^|[^а-я])почта([^а-я]|$)/i,
  hours: /час[а-я]* работ|график|режим работ/i,
  address: /(^|[^а-я])адрес(?![а-я]*\s+(сайт|почт|электрон))/i,
  legal_name: /юрлиц|юридическ|наименовани/i,
  inn: /(^|[^а-я])инн([^а-я]|$)/i,
  ogrn: /(^|[^а-я])огрн/i,
};
const HOLD_NAME = { phones: 'телефон', ...CO_NAME };
const EMAIL_IN = /[^\s@<>«»()"',;:]+@[^\s@<>«»()"',;:]+\.[a-z]{2,}/i;
const ORG_FORM = /(^|[^а-яa-z])(ооо|оао|зао|пао|ао|ип|нко|ано)\s*[«"„]/i;
const namesChannel = s => CHANNELS.some(c => c.names.test(s));
const digitsIn = (x, s) => /^\d+$/.test(x) && new RegExp(`(^|\\D)${x}(\\D|$)`).test(s);
// Прежние значения снятых полей из нескольких company (анализ до снятия, прошлый facts.json, снимок сайта).
function removedValues(absent, noPh, cos) {
  const out = {};
  for (const c of cos) {
    if (!c || typeof c !== 'object') continue;
    for (const k of absent) if (T(c[k])) (out[k] ??= []).push(T(c[k]));
    if (noPh) for (const p of arr(c.phones).map(T).filter(Boolean)) (out.phones ??= []).push(p);
  }
  return out;
}
function holdAbsentFacts(list, company, removed, warn) {
  const fields = [...(noPhone(company) ? ['phones'] : []), ...absentOf(company)];
  const res = { lines: [], ids: [] };
  if (!fields.length) return res;
  const rmPhones = arr(removed.phones).map(phoneDigits).filter(d => d.length >= 10);
  const rm = k => arr(removed[k]).map(T).filter(Boolean);
  for (const f of list) {
    if (!contactLike(f) || f.publish !== 'yes' || SERVICE_ID.test(f.id)) continue;
    const label = T(f.label), val = `${T(f.value)} ${T(f.wording)}`;
    const phoneHit = () => [...phonesInText(val), T(f.value)].map(phoneDigits).some(d => rmPhones.includes(d));
    const HIT = {
      phones: () => !namesChannel(label) && (HOLD_LABEL.phones.test(label) || phoneHit()),
      email: () => HOLD_LABEL.email.test(label) || EMAIL_IN.test(val),
      hours: () => HOLD_LABEL.hours.test(label) || rm('hours').some(v => sameAs('hours', v, {}, f)),
      address: () => HOLD_LABEL.address.test(label) || rm('address').some(v => sameAs('address', v, {}, f)),
      legal_name: () => HOLD_LABEL.legal_name.test(label) || (/реквизит/i.test(label) && ORG_FORM.test(val)) || rm('legal_name').some(v => normTxt(v).length >= 5 && normTxt(val).includes(normTxt(v))),
      inn: () => HOLD_LABEL.inn.test(label) || /(^|[^а-я])инн\s*:?\s*\d{10}/i.test(val) || rm('inn').some(x => digitsIn(x, val)),
      ogrn: () => HOLD_LABEL.ogrn.test(label) || /огрн(ип)?\s*:?\s*\d{13}/i.test(val) || rm('ogrn').some(x => digitsIn(x, val)),
    };
    const hit = fields.filter(k => HIT[k]());
    if (!hit.length) {
      if (fields.includes('phones') && namesChannel(label) && phoneHit()) warn(`${f.id} «${label}»: канал мессенджера с номером телефона, который заказчик снял в d10, - канал оставлен, номер виден в ссылке; уточни у заказчика`);
      continue;
    }
    const names = hit.map(k => HOLD_NAME[k]).join(', ');
    if (OPERATOR_ID.test(f.id)) { warn(`факт оператора ${f.id} «${label}» о поле, которое заказчик снял в d10 (${names}): оставлен как есть, проверь`); continue; }
    f.publish = 'no';
    res.ids.push(f.id);
    res.lines.push(`${f.id} «${label}» не подтвержден или снят на гейте: заказчик снял в d10 (${names}), на сайт не идет`);
  }
  return res;
}
const filledCompany = c => !!(arr(c.phones).length || T(c.email) || T(c.hours) || T(c.address) || T(c.legal_name) || T(c.inn) || T(c.ogrn));
// Пустые поля, по которым фаза 0 снимает сайт: телефон (кроме no_phone), адрес, часы (кроме снятых заказчиком - absent).
const companyMissing = c => {
  const ab = absentOf(c);
  return [!noPhone(c) && !arr(c.phones).length ? 'phones' : '', T(c.address) || ab.includes('address') ? '' : 'address', T(c.hours) || ab.includes('hours') ? '' : 'hours'].filter(Boolean);
};
// Происхождение полей company (report.company_origin): analysis - business.legal анализа, site - снимок сайта.
const ANALYSIS_SOURCE = 'project.json -> business.legal';
const CO_FIELDS = ['phones', 'email', 'hours', 'address', 'legal_name', 'inn', 'ogrn'];
const LEGAL_PARTS = ['legal_name', 'inn', 'ogrn'];
const hasField = (c, k) => (k === 'phones' ? arr(c.phones).length > 0 : !!T(c[k]));
const slotOf = k => SLOTS.find(s => s.field === k || (s.field === 'legal' && LEGAL_PARTS.includes(k)));
const slotOrigin = (origin, s) => (s.field === 'legal' ? (LEGAL_PARTS.some(k => origin[k] === 'site') ? 'site' : 'analysis') : origin[s.field] || 'analysis');
const quoteTag = q => (T(q).match(/^\[[^\]]*\]/) || [''])[0];
// Происхождение до этой записи: import-report.company_origin (known). Старый отчет без него: по цитате F9xx поля
// ([сайт] или [анализ]); поле без факта - analysis, если в company.source нет адреса снимка, иначе '' (неизвестно).
function priorOrigin(company, report, svc) {
  if (report && report.company_origin && typeof report.company_origin === 'object') return { map: { ...report.company_origin }, known: true };
  const map = {};
  const url = firstUrl(company.source);
  for (const k of CO_FIELDS) {
    if (!hasField(company, k)) continue;
    const f = svc.find(x => x.id === slotOf(k).id);
    map[k] = f ? (quoteTag(f.source_quote) === '[сайт]' ? 'site' : 'analysis') : url ? '' : 'analysis';
  }
  return { map, known: false };
}
// Служебные факты F901-F907 из company. existing - прежние F9xx: факт с тем же значением и тем же источником
// ([анализ] или [сайт]) сохраняется как был. sourceOf(slot) - строка источника цитаты: «[анализ] business.legal.<поле>»
// или «[сайт] <url>».
function contactFacts(company, analysisFacts, { existing = [], rawPhones = {}, sourceOf, onlyEmpty = false }) {
  const out = [];
  const dups = [];
  const prev = Object.fromEntries(existing.map(f => [f.id, f]));
  const absent = absentOf(company);
  for (const s of SLOTS) {
    if (s.field === 'phones' && noPhone(company)) continue;
    // поле снято заказчиком (absent): слота нет; юрлицо - если сняты все его части
    if (s.field === 'legal' ? LEGAL_PARTS.every(k => absent.includes(k)) : absent.includes(s.field)) continue;
    const v = slotValue(company, s);
    // прежний F907 с частью, которую заказчик снял, пересобирается из того, что осталось
    const legalCut = s.field === 'legal' && LEGAL_PARTS.some(k => absent.includes(k));
    if (onlyEmpty && prev[s.id] && !legalCut) { out.push(prev[s.id]); continue; }
    if (!v) continue;
    const dup = analysisFacts.find(f => f.publish === 'yes' && contactLike(f) && sameAs(s.field, v, company, f));
    if (dup) { dups.push(`${s.id} -> ${dup.id}`); continue; }
    const old = prev[s.id];
    const same = old && (s.field === 'phones' ? phoneDigits(old.value) === phoneDigits(v) : normTxt(old.value) === normTxt(v)) && quoteTag(old.source_quote) === quoteTag(sourceOf(s));
    if (same) { out.push(old); continue; }
    const value = s.field === 'phones' ? (rawPhones[v] || v) : v;
    const wording0 = s.field === 'phones' ? phoneFormat(v) : v;
    const cut = cutWording(wording0);
    out.push({ id: s.id, label: s.label, value, wording: cut.wording, publish: 'yes', source_quote: `${sourceOf(s)}: ${value}`, kind: s.kind || 'contact', ...(cut.note ? { note: cut.note } : {}) });
  }
  return { facts: out, dups };
}
// Строка gaps о несверенных контактах: пересчитывается при каждой записи.
function syncContactGap(facts, reason) {
  facts.gaps = facts.gaps.filter(g => !g.startsWith(CONTACT_GAP));
  const svc = facts.facts.filter(f => SERVICE_ID.test(f.id));
  const confirmed = facts.company && facts.company.status === 'confirmed';
  const open = svc.filter(f => !confirmed || /^\[сайт\]/.test(f.source_quote)).map(f => f.id);
  if (open.length) facts.gaps.push(`${CONTACT_GAP}${reason ? ` (${reason})` : ''}: ${open.join(', ')} - подтвердить до публикации`);
}
// Формат телефонов в wording контактных фактов анализа (value не меняется).
function formatContactWording(f) {
  if (f.kind !== 'contact') return f;
  const w = formatPhonesInText(f.wording);
  return w === f.wording || len(w) > 160 ? f : { ...f, wording: w };
}
// Дайджест фактов анализа (без F8xx и F9xx): по нему --facts-only узнает ручную правку facts.json.
const digestOf = list => Object.fromEntries(list.filter(isAnalysisFact).map(f => [f.id, sha(`${f.value}\n${f.wording}\n${f.publish}`)]));
function digestDiff(base, cur) {
  const added = Object.keys(cur).filter(id => !(id in base));
  const removed = Object.keys(base).filter(id => !(id in cur));
  const changed = Object.keys(cur).filter(id => id in base && base[id] !== cur[id]);
  return { added, removed, changed, any: !!(added.length || removed.length || changed.length) };
}
const firstUrl = s => (T(s).match(/https?:\/\/[^\s;,)«»]+/) || [])[0] || '';
const sortFacts = list => [...list.filter(isAnalysisFact), ...list.filter(f => OPERATOR_ID.test(f.id)), ...list.filter(f => SERVICE_ID.test(f.id)).sort((x, y) => x.id.localeCompare(y.id))];
// Перерисовать разделы «Факты» и «Пробелы» отрендеренного анализа (только режим project: в doc там дамп Google Doc).
function rerenderSections(facts) {
  let mode = '';
  try { mode = (readJson(P('config', 'project.json')).sources || {}).mode || ''; } catch { mode = ''; }
  const md = P('inputs', 'analysis.md');
  if (mode !== 'project' || !exists(md)) return false;
  let src = readText(md);
  src = replaceSection(src, 'Факты', factsSection(facts));
  src = replaceSection(src, 'Пробелы', gapsSection(facts.gaps));
  writeText(md, src);
  return true;
}

// ---------------------------------------------------------------- режим --apply-patterns
if (a['apply-patterns']) {
  const factsFile = P('work', 'facts.json'), repFile = P('work', 'import-report.json');
  if (!exists(factsFile)) die(2, 'нет work/facts.json: сначала импорт');
  const facts = readJson(factsFile);
  const report = exists(repFile) ? readJson(repFile) : { warnings: [], anti: { pending: [], ok: [], failed: [] } };
  const res = applyPatterns(facts, abs(a['apply-patterns']), report, { onlySameText: false });
  report.anti.ok = [...new Set([...(report.anti.ok || []), ...res.ok])];
  report.anti.failed = res.failed;
  const pending = syncAntiGaps(facts, report, res.conflicts);
  const problems = [];
  validateOut('facts', 'work/facts.json', facts, problems);
  if (problems.length) die(1, problems.join('\n'));
  writeJson(factsFile, facts);
  report.counts = { ...(report.counts || {}), anti_pending: pending.length, gaps: facts.gaps.length };
  writeJson(repFile, report);
  rerenderSections(facts);
  console.log(`регулярки: приняты ${res.ok.length} (${res.ok.join(', ') || '-'}), не прошли ${res.failed.length}, без регулярки ${pending.length}, конфликтов ${res.conflicts.length}`);
  for (const f of res.failed) console.log(` - ${f.id}: ${f.errors.join('; ')}`);
  for (const c of res.conflicts) console.log(` - ${c}`);
  process.exit(res.failed.length ? 1 : 0);
}

// ---------------------------------------------------------------- режим --company-facts
// После снимка сайта: company заполнен агентом (телефоны как на сайте, каналы строками-URL). Нормализуем, заводим
// служебные факты в пустые слоты (существующие F9xx не трогаем), каналы - объектами. Ни project.json, ни гейт не нужны.
if (a['company-facts']) {
  const factsFile = P('work', 'facts.json'), repFile = P('work', 'import-report.json');
  if (!exists(factsFile)) die(2, 'нет work/facts.json: сначала импорт анализа или экстрактор фактов');
  const facts = readJson(factsFile);
  const report = exists(repFile) ? readJson(repFile) : null;
  const warns = [];
  const company = facts.company && typeof facts.company === 'object' ? facts.company : { status: 'missing' };
  facts.company = company;
  facts.gaps = arr(facts.gaps);
  const analysisFacts = facts.facts.filter(f => !SERVICE_ID.test(f.id));
  const existing = facts.facts.filter(f => SERVICE_ID.test(f.id));
  // до гейта анализа (--allow-ungated) publish: no значит «не подтверждено», а не «снято заказчиком»
  const honor = !(report && report.gate && report.gate.approved === false);
  // значения снятых в d10 полей (снимок все же их вернул) - до того, как prepareCompany их уберет: по ним K1 узнает факты
  const removed = removedValues(absentOf(company), noPhone(company), [company]);
  const { rawPhones, notes } = prepareCompany(company, analysisFacts, s => warns.push(s), honor);
  // контактные факты о полях, снятых в d10, - publish: no (K1); дайджест фактов анализа правится только у них, иначе
  // следующий --facts-only принял бы это снятие за ручную правку facts.json
  const hold = holdAbsentFacts(analysisFacts, company, removed, s => warns.push(s));
  for (const l of hold.lines) if (!facts.gaps.includes(l)) facts.gaps.push(l);
  if (report && report.facts_digest && typeof report.facts_digest === 'object') {
    const dg = digestOf(analysisFacts.filter(f => hold.ids.includes(f.id)));
    for (const id of hold.ids) if (id in report.facts_digest) report.facts_digest[id] = dg[id];
  }
  // каналы: только из фактов (анализа, оператора); каналы снимка без факта - вопросом заказчику в gaps (K1)
  const { confirmed: channels, fromSite: siteChannels } = splitChannels(facts.facts, company);
  if (Object.keys(channels).length) company.channels = channels; else delete company.channels;
  facts.gaps = syncChannelGaps(facts.gaps, siteChannels, channels);
  const url = firstUrl(company.source);
  let siteUrl = '';
  try { siteUrl = T(readJson(P('config', 'project.json')).site_url); } catch { siteUrl = ''; }
  // поле, которого нет в происхождении прошлой записи (report.company_origin), заполнил снимок сайта; без отчета
  // (режим doc) и в старом отчете - по адресу снимка в company.source
  const prior = priorOrigin(company, report, existing);
  const origin = {};
  for (const k of CO_FIELDS) if (hasField(company, k)) origin[k] = prior.map[k] || (prior.known || url ? 'site' : 'analysis');
  const siteSrc = `[сайт] ${url || siteUrl || 'старый сайт'}`;
  const made = contactFacts(company, analysisFacts, { existing, rawPhones, onlyEmpty: true, sourceOf: s => (slotOrigin(origin, s) === 'site' ? siteSrc : /business\.legal/.test(T(company.source)) ? `[анализ] business.legal.${s.legal}` : `[анализ] company.${s.field}`) });
  const added = made.facts.filter(f => !existing.some(x => x.id === f.id)).map(f => f.id);
  facts.facts = sortFacts([...analysisFacts, ...made.facts]);
  if (company.status === 'missing' && filledCompany(company)) company.status = 'from_site_unconfirmed';
  for (const n of notes) if (!facts.gaps.includes(n)) facts.gaps.push(n);
  // причина прежней строки о несверенных контактах сохраняется (ее знает только импорт), новые поля - со снимка
  const prevReason = ((facts.gaps.find(g => g.startsWith(CONTACT_GAP)) || '').match(/^[^(]*\((.*)\): /) || [])[1] || '';
  const fromSite = Object.values(origin).includes('site');
  syncContactGap(facts, company.status !== 'confirmed' && prevReason ? prevReason : fromSite ? 'сняты со старого сайта' : prevReason);
  const problems = [];
  validateOut('facts', 'work/facts.json', facts, problems);
  if (problems.length) die(1, 'facts.json не прошел схему, ничего не записано:\n' + problems.map(x => ' - ' + x).join('\n'));
  writeJson(factsFile, facts);
  if (report) {
    report.company_missing = companyMissing(company);
    report.company_origin = origin;
    report.contact_facts = facts.facts.filter(f => SERVICE_ID.test(f.id)).map(f => f.id);
    report.counts = { ...(report.counts || {}), contact_facts: report.contact_facts.length, gaps: facts.gaps.length };
    // дайджест (facts_digest) ведется только по фактам анализа: F9xx его не меняют, и следующий --facts-only
    // не примет их за ручную правку; поэтому здесь он не пересчитывается
    report.warnings = [...arr(report.warnings), ...warns];
    writeJson(repFile, report);
  }
  const rendered = rerenderSections(facts);
  console.log(`контакты: company ${company.status}; служебных фактов ${made.facts.length} (новых ${added.length}: ${added.join(', ') || '-'}); дублей фактов анализа ${made.dups.length}${made.dups.length ? ` (${made.dups.join(', ')})` : ''}${hold.ids.length ? `; сняты с публикации по d10: ${hold.ids.join(', ')}` : ''}; каналов ${Object.keys(channels).length}${Object.keys(siteChannels).length ? ` (со старого сайта без факта - в вопросы заказчику: ${Object.keys(siteChannels).join(', ')})` : ''}${rendered ? '; analysis.md: разделы «Факты» и «Пробелы» перерисованы' : ''}`);
  for (const w of [...warns, ...notes]) console.log(` ! ${w}`);
  process.exit(0);
}

// ---------------------------------------------------------------- входы
const cfgFile = P('config', 'project.json');
const cfg = readJson(cfgFile);
const S = cfg.sources || {};
const fromCfg = !a.project;
const projectPath = abs(a.project || S.project_json);
if (!projectPath || !exists(projectPath)) die(2, `нет project.json: ${projectPath || '(путь не задан: --project или config/project.json -> sources.project_json)'}`);
const siteDir = path.dirname(projectPath);
const pick = (flag, cfgVal, def) => abs(a[flag] || (fromCfg && cfgVal) || def);
const factsSrcPath = pick('facts-src', S.facts_src, path.join(siteDir, 'parts', 'facts-src.json'));
const queuePath = pick('queue', S.queue, path.join(siteDir, 'queue.json'));
const structurePath = a.structure ? abs(a.structure) : (fromCfg && S.structure_input ? abs(S.structure_input) : '');
const FACTS_ONLY = !!a['facts-only'];
const factsFileOut = P('work', 'facts.json');
if (FACTS_ONLY && !exists(factsFileOut)) die(2, 'нет work/facts.json: --facts-only правит факты после импорта, сначала полный импорт');

const raw = readJson(projectPath);
if (raw.v !== 2 || !raw.business || !raw.audience || !Array.isArray(raw.facts)) die(2, `${projectPath}: ожидался project.json v2 (v, business, audience, facts)`);
const p = raw;
const b = p.business || {}, o = p.offer || {}, cons = p.constraints || {}, lex = p.lexicon || {};

const queue = exists(queuePath) ? readJson(queuePath) : null;
const approved = !!(queue && queue.gate && queue.gate.approved === true);
const ungated = !approved;
if (ungated && !a['allow-ungated']) {
  die(2, `гейт анализа не согласован: ${queue ? `${rel(queuePath)} -> gate.approved = ${JSON.stringify(queue.gate && queue.gate.approved)}` : `нет ${queuePath}`}.\n` +
    'До гейта у фактов publish: no означает «заказчик не подтвердил», импорт даст ноль публикуемых фактов. Пилот до гейта - только с --allow-ungated.');
}
const journal = arr(queue && queue.journal);
const factsSrc = exists(factsSrcPath) ? readJson(factsSrcPath) : [];
// прежний facts.json: факты оператора F8xx (сохраняются), для --facts-only - company, F9xx, антиобещания
const prevFacts = exists(factsFileOut) ? (() => { try { return readJson(factsFileOut); } catch { return null; } })() : null;
if (FACTS_ONLY && !prevFacts) die(1, 'work/facts.json не читается как JSON');

const report = {
  generated_at: nowIso(),
  ...(FACTS_ONLY ? { mode: 'facts-only' } : {}),
  inputs: { project: projectPath, facts_src: exists(factsSrcPath) ? factsSrcPath : '', queue: queue ? queuePath : '', structure: structurePath },
  gate: { approved, ungated_import: ungated, by: T(queue && queue.gate && queue.gate.by), at: T(queue && queue.gate && queue.gate.at), decisions: {} },
  outputs: [], counts: {}, id_map: { facts: {}, segments: {} }, heuristic: [], empty: [], warnings: [],
  anti: { pending: [], ok: [], auto: [], failed: [], conflicts: [] },
};
const H = {};
const heur = (field, rule, item) => { const k = field + '|' + rule; (H[k] ??= { field, rule, items: [] }).items.push(item); };
const empty = (field, effect) => report.empty.push({ field, effect });
const warn = s => report.warnings.push(s);
if (ungated) warn('импорт до гейта анализа (--allow-ungated): факты не подтверждены заказчиком, publish взят из project.json как есть');
if (!exists(factsSrcPath)) warn(`нет parts/facts-src.json (${factsSrcPath}): source_quote у всех фактов - строка «[src] label: value»`);

// ---------------------------------------------------------------- решения гейта d1-d8, d10
const lg = b.legal || {};
const LEGAL_LABELS = [['phone', 'телефон'], ['email', 'почта'], ['schedule', 'часы'], ['address', 'адрес'], ['entity', 'юрлицо'], ['inn', 'ИНН'], ['ogrn', 'ОГРН']];
const DECISIONS = [
  { key: 'd1', name: 'позиционирование', get: () => T(o.positioning) },
  { key: 'd2', name: 'обещание: что получит клиент', get: () => T(o.promise && o.promise.result) },
  { key: 'd3', name: 'текст главной кнопки: что получит клиент', get: () => T(o.promise && o.promise.cta) },
  { key: 'd4', name: 'границы работы, чего не обещаем', get: () => arr(o.limits).map(T).join('; ') },
  { key: 'd5', name: 'тон', get: () => T(o.tone) },
  { key: 'd6', name: 'цены на сайте открыты', get: () => (arr(b.sig).includes('price_open') ? 'да' : 'нет') },
  { key: 'd7', name: 'тип сайта', get: () => T(b.site_kind) },
  { key: 'd8', name: 'что продаем', get: () => T(b.type) },
  { key: 'd10', name: 'контакты и реквизиты для сайта', get: () => {
    const ab = arr(lg.absent_fields).map(x => T(x).toLowerCase());
    const off = LEGAL_LABELS.filter(([k]) => ab.includes(k) || (k === 'phone' && lg.phone_absent === true)).map(([k]) => k);
    const set = LEGAL_LABELS.filter(([k]) => T(lg[k]) && !off.includes(k)).map(([k, n]) => `${n}: ${T(lg[k])}`).join('; ');
    const offNames = LEGAL_LABELS.filter(([k]) => off.includes(k)).map(([, n]) => n);
    return [set, offNames.length ? `не указываем: ${offNames.join(', ')}` : ''].filter(Boolean).join('; ') || 'не заданы';
  } },
];
const decisionRe = key => new RegExp(`решени[а-я]*\\s+${key}(?![0-9])`);
function decisionHow(key) {
  const j = journal.find(x => decisionRe(key).test(T(x.subject)));
  if (!j) return approved ? 'согласовано на гейте, записи в журнале нет' : 'гейт не пройден';
  if (/молчани/.test(T(j.subject)) || /молчани|не поправил/.test(T(j.ground))) return `молчание заказчика, принят рекомендованный дефолт (${j.id})`;
  return `${T(j.kind) || 'запись'}: ${T(j.subject)} (${j.id})`;
}
for (const d of DECISIONS) report.gate.decisions[d.key] = { name: d.name, value: d.get(), how: decisionHow(d.key) };
// d10 принято: гейт пройден и все записи журнала по d10 - kind waiver (молчание или подтверждение, так пишет
// apply-answers анализа) или молчание в subject. Любой другой kind (правка, неразобранный ответ, dropped) - реквизиты
// не сверены (строка gaps); старый анализ без d10 - тоже не сверены. Текст ground не читается: там бывает цитата ответа.
const D10_MAIN = /решени[а-я]*\s+d10(?![0-9])/i;
function d10State() {
  if (!approved) return { ok: false, why: 'гейт анализа не пройден' };
  const js = journal.filter(x => D10_MAIN.test(T(x.subject)) || /(^|[^a-z0-9])d10(?![0-9])/i.test(T(x.subject)));
  if (!js.length) return { ok: false, why: 'в анализе нет решения d10' };
  const notOk = x => !(x.kind === 'waiver' || (D10_MAIN.test(T(x.subject)) && /^молчани/i.test(T(x.subject))));
  // в причине - id главной записи «... по решению d10», а не сопутствующей dropped
  const bad = js.filter(x => D10_MAIN.test(T(x.subject))).find(notOk) || js.find(notOk);
  return bad ? { ok: false, why: `по d10 прислана правка (${bad.id})` } : { ok: true, why: '' };
}

// ---------------------------------------------------------------- гео
function geoRe(g) {
  const words = T(g).toLowerCase().split(/[\s-]+/).filter(Boolean);
  return new RegExp('(^|[^а-яa-z])' + words.map(w => (w.length > 4 && /[аяеиоуыьйю]$/.test(w) ? esc(w.slice(0, -1)) : esc(w)) + '[а-яa-z]*').join('[\\s-]+'), 'i');
}
const GEO = arr(b.geo).map(T).filter(Boolean).map(g => ({ g, re: geoRe(g) }));
const geoOf = s => GEO.filter(x => x.re.test(s)).map(x => x.g).join(', ');

// ---------------------------------------------------------------- сегменты
const segs = arr(p.audience && p.audience.segments);
const segMap = {};
segs.forEach((s, i) => { segMap[s.id] = `S${i + 1}`; });
if (segs.length > 9) warn(`сегментов ${segs.length}: схема текстов допускает S1..S9, лишние отброшены`);
report.id_map.segments = segMap;

// ---------------------------------------------------------------- факты
const factIdMap = {};
p.facts.forEach(f => { factIdMap[f.id] = String(f.id).replace(/^f/, 'F'); });
report.id_map.facts = factIdMap;
const srcById = {}, fieldSrc = {};
for (const x of arr(factsSrc)) {
  if (x.id) srcById[x.id] = x;
  else if (x.field) fieldSrc[x.field] = x;
}
// проверка цитаты по входу анализа (sites/NNN/input/...): Д3 - цитаты facts-src никто не сверял
const inputCache = {};
function quoteFound(q, where) {
  const file = T(where).split(/[:\s]/)[0];
  if (!file) return null;
  const f = path.join(siteDir, file);
  if (!exists(f)) return null;
  const norm = s => normalizeText(s).replace(/\s+/g, ' ').toLowerCase();
  // цитата может идти через перенос строки внутри markdown-цитаты «> »
  inputCache[f] ??= norm(fs.readFileSync(f, 'utf8').replace(/^[ \t]*>[ \t]?/gm, ''));
  return inputCache[f].includes(norm(q));
}

const Q_KIND = { price: 'number', price_factors: 'number', compare: 'number', numbers: 'number', cat_intro: 'number', docs: 'legal', steps: 'process', cta_form: 'process', cta_mid: 'process', geo: 'geo', delivery: 'geo', specs: 'product', gallery: 'product', product_desc: 'product', listing: 'product', subcats: 'product' };
// Слова контакта; названия мессенджеров и соцсетей - из словаря CHANNELS (contacts.mjs), здесь их нет.
const CONTACT_RE = new RegExp(['телефон|e-?mail|почт[аыу]|(^|[^а-я])адрес|мессенджер|канал[а-я]* (компании|связи)|часы работы|график работы', ...CHANNELS.map(c => c.names.source)].join('|'), 'i');
// Служебная пометка вместо факта: одно правило с анализом - SERVICE_NOTE из .claude/scripts/site/_contract.mjs
// (verify-data.mjs его уже проверяет; импорт - второй рубеж для анализа до гейта и старых контрактов).
const NOTE = await serviceNoteRule(siteDir, process.cwd());
report.inputs.service_note_rule = NOTE.from ? NOTE.from : 'копия SERVICE_NOTE в kit (_contract.mjs анализа не найден)';
// Маркер снятия - из того же _contract.mjs (экспорт HELD_MARK), в старом модуле без экспорта и вне проекта - копия kit.
// Правило «NDA целым полем» (HELD_NDA_FIELD) берется оттуда же, откуда HELD_MARK: модуль анализа без этого экспорта
// значение «NDA» не закрывает - импорт тоже (иначе конфликт по факту, который анализ опубликовал).
let HELD = HELD_MARK_COPY, HELD_NDA = HELD_NDA_FIELD_COPY;
report.inputs.held_mark_rule = 'копия HELD_MARK_COPY в kit (в _contract.mjs анализа нет HELD_MARK)';
if (NOTE.from) {
  try {
    const m = await import(pathToFileURL(NOTE.from).href);
    if (m.HELD_MARK instanceof RegExp) {
      HELD = new RegExp(m.HELD_MARK.source, m.HELD_MARK.flags.replace(/[gy]/g, ''));
      HELD_NDA = m.HELD_NDA_FIELD instanceof RegExp ? new RegExp(m.HELD_NDA_FIELD.source, m.HELD_NDA_FIELD.flags.replace(/[gy]/g, '')) : null;
      report.inputs.held_mark_rule = NOTE.from;
    }
  } catch { /* модуль не грузится - копия kit */ }
}
// Поле факта с пометкой: каждое поле отдельно по HELD; «NDA» вместо значения (или artifact) секретного поля - по HELD_NDA
// на строке «подпись\nзначение» (контракт K2, как heldMarked в _contract.mjs).
const heldIn = (label, value, art) => [label, value, art].some(x => HELD.test(String(x || '').toLowerCase()))
  || (!!HELD_NDA && [value, art].some(x => HELD_NDA.test(`${String(label || '').trim()}\n${String(x || '').trim()}`.toLowerCase())));
const QUALIFIER_RE = /^(до|от|около|более|свыше|менее|не более|не менее|порядка|примерно)\s/i;

// Вид факта: из анализа (facts[].kind ставит site-intake, пустой выводит build-project.mjs), иначе мост q -> kind.
const FACT_KINDS = new Set(['number', 'claim', 'process', 'contact', 'legal', 'product', 'geo']);
function kindOf(label, value, q) {
  const ks = new Set(arr(q).map(x => Q_KIND[x]).filter(Boolean));
  const qs = arr(q).join(', ') || 'нет';
  const digit = /\d/.test(value);
  if (CONTACT_RE.test(label + ' ' + value)) return ['contact', `слова контакта; q: ${qs}`];
  if (ks.has('legal')) return ['legal', `q docs; q: ${qs}`];
  if (digit && ks.has('number')) return ['number', `q числа и цифра в value; q: ${qs}`];
  if (digit && NUM_UNIT.test(value)) return ['number', `число с единицей в value; q: ${qs}`];
  if (ks.has('geo')) return ['geo', `q: ${qs}`];
  if (ks.has('process')) return ['process', `q: ${qs}`];
  if (ks.has('product')) return ['product', `q: ${qs}`];
  return ['claim', ks.has('number') ? `q числа, но в value нет цифры; q: ${qs}` : `по умолчанию; q: ${qs}`];
}
function makeWording(id, label, value) {
  let w = value;
  if (QUALIFIER_RE.test(value) || !/[а-яa-z]{4,}/i.test(value.replace(/\d/g, ''))) {
    w = `${label}: ${value}`;
    heur('facts[].wording', 'value без предмета (начинается с «до/от...» или без слов) - добавлено название факта', id);
  }
  let note;
  if (len(w) > 160) {
    const src = len(value) <= 160 ? null : value;
    if (!src) w = value;
    else {
      const cut = cutWording(value, () => warn(`${id}: value длиннее 160 знаков - формулировка обрезана по слову, полный текст в note (проверь, не потеряно ли условие)`));
      w = cut.wording; note = cut.note;
    }
    heur('facts[].wording', 'длиннее 160 знаков - обрезано по слову', id);
  }
  if (len(w) < 3) w = `${label}: ${value}`;
  return { wording: w.charAt(0).toUpperCase() + w.slice(1), note };
}

const forbidden = arr(cons.forbidden).map(T).filter(Boolean);
// Слово заказчика по факту анализа: последняя запись журнала гейта по его id - «подтверждение по факту», «новое значение
// по факту» или «новый факт ... из ответа» (apply-answers), а не молчание, «не разобрано» или уступленное место. Ключ
// записи - поле key, у записей без key - id из предмета.
const CLIENT_SAID = /^(подтверждение по факту|новое значение по факту|новый факт)\s/i;
const journalKey = x => T(x && x.key).toLowerCase() || ((T(x && x.subject).match(/(?:по факту|новый факт)\s+(f\d{2,3})(?![0-9])/i) || [])[1] || '').toLowerCase();
function clientSaid(aid) {
  const k = T(aid).toLowerCase();
  const last = [...journal].reverse().find(x => journalKey(x) === k);
  return !!last && last.kind === 'waiver' && CLIENT_SAID.test(T(last.subject));
}
const gapsOut = [];
const conflicts = [];
const factsOut = [];
const factSrcLabel = {};
const artifactOf = {};
let qFromSrc = 0, qFallback = 0, qVerified = 0, qMissing = 0, qNoFile = 0;
for (const f of p.facts) {
  const id = factIdMap[f.id];
  let label = T(f.label), value = T(f.value);
  const art = T(f.artifact), src = T(f.src) || 'источник не указан';
  if (!/^F[0-9]{2,3}$/.test(id)) { warn(`факт ${f.id}: id не приводится к F01..F999, пропущен`); continue; }
  if (SERVICE_ID.test(id) || OPERATOR_ID.test(id)) { warn(`факт ${f.id}: id ${id} занят служебными фактами (F801-F899 оператора, F901-F999 контактов), пропущен`); continue; }
  if (!value && art) { value = `документ: ${art}`; heur('facts[].value', 'пустой value при непустом artifact - value = «документ: artifact»', id); }
  if (!value) { warn(`факт ${f.id}: пустые value и artifact, пропущен`); continue; }
  if (len(label) < 3) { label = `${label}: ${value}`.slice(0, 80); heur('facts[].label', 'label короче 3 знаков - дополнен значением', id); }
  const fromAnalysis = FACT_KINDS.has(T(f.kind));
  const [kind, why] = fromAnalysis ? [T(f.kind), 'из анализа'] : kindOf(label, value, f.q);
  if (!fromAnalysis) heur('facts[].kind', 'мост q -> kind плюс число с единицей в value', `${id}: ${kind} (${why})`);
  const geo = geoOf(`${label} ${value}`);
  if (geo) heur('facts[].geo', 'сверка label и value с business.geo[]', `${id}: ${geo}`);
  const { wording, note } = makeWording(id, label, value);
  let publish = f.publish === 'yes' ? 'yes' : 'no';
  if (publish === 'yes' && NOTE.re.test(value)) {
    publish = 'no';
    warn(`${id} «${label}»: значение похоже на служебную пометку, а не на факт («${value}») - publish снят`);
    gapsOut.push(`${id} «${label}»: в анализе вместо факта пометка «${value}» - в публикацию не идет, нужен ответ заказчика`);
  }
  // цитата
  const s = srcById[f.id];
  let quote;
  factSrcLabel[id] = src;
  if (s && T(s.quote)) {
    quote = `[${src}] ${T(s.where) || 'место не указано'}: ${T(s.quote)}`;
    qFromSrc++;
    const found = quoteFound(T(s.quote), s.where);
    if (found === true) qVerified++;
    else if (found === false) { qMissing++; warn(`${id}: цитата facts-src не найдена дословно в ${T(s.where)}`); }
    else qNoFile++;
  } else {
    quote = `[${src}] ${label}: ${value}`;
    qFallback++;
    heur('facts[].source_quote', 'нет цитаты в facts-src.json - строка «[src] label: value»', id);
  }
  // запреты заказчика и маркер снятия (HELD: HELD_MARK из _contract.mjs анализа или копия kit, контракт K2). Маркер
  // проверяется по каждому полю отдельно («целое поле» не склеивается с соседним). Факт с пометкой, который заказчик
  // сам подтвердил или дал на гейте, - предупреждение оператору, а не «конфликт» в брифах.
  const t = `${label} ${value} ${art}`.toLowerCase();
  if (publish === 'yes' && heldIn(label, T(f.value), art)) {
    if (clientSaid(f.id)) warn(`${id} «${label}»: в тексте факта служебная пометка (K2), но публикацию подтвердил заказчик на гейте - факт идет в тексты; проверь формулировку`);
    else conflicts.push({ id, what: 'маркер снятия в тексте факта' });
  }
  for (const w of forbidden) if (w.length >= 3 && t.includes(w.toLowerCase())) conflicts.push({ id, forbidden: w });
  if (art) artifactOf[id] = art;
  factsOut.push(formatContactWording({ id, label, value, wording, publish, source_quote: quote, kind, ...(geo ? { geo } : {}), ...(note ? { note } : {}) }));
}

// ---------------------------------------------------------------- антиобещания
const antiOut = [];
const antiSrc = [];
const pushAnti = (text, from, pattern, ctx) => {
  const id = `A${String(antiOut.length + 1).padStart(2, '0')}`;
  if (antiOut.length >= 99) return;
  antiOut.push({ id, text, lint_pattern: pattern, allowed_context: ctx });
  antiSrc.push({ id, from, text });
  return id;
};
const DEF_CTX = 'блок «что мы не обещаем», ответ на возражение, где формулировка приводится как чужая и опровергается';
for (const x of arr(o.limits).map(T).filter(Boolean)) pushAnti(x, 'offer.limits', SENTINEL, DEF_CTX);
for (const x of arr(cons.not_self).map(T).filter(Boolean)) pushAnti(x, 'constraints.not_self', SENTINEL, DEF_CTX);
for (const x of arr(cons.not_selling).map(T).filter(Boolean)) pushAnti(`Не продаем: ${x}`, 'constraints.not_selling', SENTINEL, DEF_CTX);
if (T(cons.opsec)) pushAnti(`Не раскрываем: ${T(cons.opsec)}`, 'constraints.opsec', SENTINEL, '');
const forbiddenIds = {};
for (const w of forbidden) {
  const id = pushAnti(`Не пишем: «${w}»`, 'constraints.forbidden', stemPattern(w), '');
  if (id) { forbiddenIds[w] = id; report.anti.auto.push(id); }
}
for (const c of conflicts) {
  if (c.forbidden) gapsOut.push(`конфликт: ${c.id} против ${forbiddenIds[c.forbidden] || 'запрета'} (в факте запрещенное слово «${c.forbidden}»)`);
  else gapsOut.push(`конфликт: ${c.id} - ${c.what}, при этом publish: yes`);
}
if (!antiOut.length) empty('offer.limits, constraints.forbidden, constraints.not_self', 'антиобещаний нет: линтеру нечего ловить, блок «что мы не обещаем» не из чего собрать');
if (!forbidden.length) empty('constraints.forbidden', 'запрещенных слов нет: tone.forbidden_words пуст');

// ---------------------------------------------------------------- компания, контакты, тон, терминология
const company = { brand: T(b.name) };
if (T(lg.entity)) company.legal_name = T(lg.entity);
if (T(lg.address)) company.address = T(lg.address);
if (T(lg.phone)) company.phones = [T(lg.phone)];
if (T(lg.email)) company.email = T(lg.email);
if (T(lg.schedule)) company.hours = T(lg.schedule);
if (T(lg.inn)) company.inn = T(lg.inn);
if (T(lg.ogrn)) company.ogrn = T(lg.ogrn);
if (lg.phone_absent === true) company.no_phone = true;
// d10 «убрать» (K1): business.legal.absent_fields -> company.absent в именах kit, телефон - no_phone
const absentIn = [...new Set(arr(lg.absent_fields).map(x => T(x).toLowerCase()).filter(Boolean))];
const absentUnknown = absentIn.filter(k => k !== 'phone' && !ABSENT_KIT[k]);
if (absentUnknown.length) warn(`business.legal.absent_fields: неизвестные поля ${absentUnknown.join(', ')} - пропущены`);
if (absentIn.includes('phone')) company.no_phone = true;
const absentKit = absentIn.map(k => ABSENT_KIT[k]).filter(Boolean);
if (absentKit.length) company.absent = absentKit;
// значения снятых в d10 полей: анализ обычно их стирает (applyLegalOps), остаются старый анализ и прошлый facts.json
const removedVals = removedValues(absentKit, !!company.no_phone, [company, prevFacts && prevFacts.company]);
// до гейта publish: no - «не подтверждено»: поля company по таким фактам не снимаются
const prep = prepareCompany(company, factsOut, warn, approved);
gapsOut.push(...prep.notes);
// контактные факты анализа о снятых в d10 полях - publish: no до служебных фактов (дубль F9xx ищется только среди
// публикуемых: F907 без снятого названия заводится из оставшихся реквизитов) и до ссылок возражений на факты (K1)
const held = holdAbsentFacts(factsOut, company, removedVals, warn);
gapsOut.push(...held.lines);
const legalFilled = filledCompany(company);
const d10 = d10State();
company.status = legalFilled ? (d10.ok ? 'confirmed' : 'from_site_unconfirmed') : 'missing';
report.company_origin = Object.fromEntries(CO_FIELDS.filter(k => hasField(company, k)).map(k => [k, 'analysis']));
if (legalFilled) company.source = ANALYSIS_SOURCE;
else {
  empty('business.legal', 'реквизитов нет: company.status = missing, фаза 0 снимает контакты с сайта (00-site-snapshot)');
  gapsOut.push('реквизиты: в анализе нет юрлица, адреса, телефона, почты и часов работы (business.legal)');
}
if (company.no_phone) gapsOut.push('телефона для сайта нет (business.legal.phone_absent): телефон на сайт не ставим, со старого сайта не берем');
if (company.absent) warn(`заказчик снял ответом на d10 (business.legal.absent_fields): ${company.absent.map(k => CO_NAME[k]).join(', ')} - нет в company и служебных фактах, снимок сайта их не берет${held.ids.length ? `; контактные факты анализа о них сняты с публикации: ${held.ids.join(', ')}` : ''}`);
else if (held.ids.length) warn(`телефон снят заказчиком в d10: контактные факты анализа сняты с публикации: ${held.ids.join(', ')}`);
// каналы: прежние ссылки из фактов-контактов и их цитат + факты, в label которых назван мессенджер (contacts.mjs)
const channels = buildChannels(factsOut.map(f => (artifactOf[f.id] ? { ...f, source_quote: `${f.source_quote} ${artifactOf[f.id]}` } : f)), company);
if (Object.keys(channels).length) { company.channels = channels; heur('company.channels', 'ссылки из фактов-контактов и их цитат, факты-контакты с названием мессенджера в label', Object.keys(channels).join(', ')); }
// служебные факты F901-F907 (id по полю), без дублей контактных фактов анализа
const contact = contactFacts(company, factsOut, { rawPhones: prep.rawPhones, sourceOf: s => `[анализ] business.legal.${s.legal}` });
if (contact.dups.length) heur('facts F901-F907', 'поле business.legal уже есть контактным фактом анализа - служебный факт не заводится', contact.dups.join(', '));
for (const f of contact.facts) factSrcLabel[f.id] = 'анализ';
report.company_missing = companyMissing(company);
// Факты оператора F8xx сохраняются. Факт, перенесенный в анализ строкой «F8NN: ...» листа ответов (K11: у факта анализа
// moved_from: "F8NN"), снимается: иначе он стоял бы дважды.
const movedTo = {};
for (const f of p.facts) {
  const from = T(f.moved_from).toUpperCase();
  const to = factIdMap[f.id];
  if (OPERATOR_ID.test(from) && factsOut.some(x => x.id === to)) movedTo[from] = to;
}
const prevOperator = arr(prevFacts && prevFacts.facts).filter(f => OPERATOR_ID.test(f.id));
const operatorFacts = prevOperator.filter(f => !movedTo[f.id]);
const operatorMoved = prevOperator.filter(f => movedTo[f.id]).map(f => f.id);
for (const id of operatorMoved) warn(`факт оператора ${id} перенесен в анализ (${movedTo[id]}, moved_from): снят из work/facts.json, чтобы не стоять дважды`);
if (operatorFacts.length) warn(`факты оператора сохранены (перенести в анализ): ${operatorFacts.map(f => f.id).join(', ')}`);

const tone = {};
if (T(o.tone)) tone.register = T(o.tone); else empty('offer.tone', 'тон не задан (d5)');
if (T(o.positioning)) tone.idea = T(o.positioning);
if (forbidden.length) tone.forbidden_words = forbidden;
const terminology = {
  use: arr(lex.locked).map(T).filter(Boolean).map(say => ({ say })),
  jargon: arr(lex.translate).filter(x => x && x.from && x.to).map(x => ({ internal: T(x.from), public: T(x.to) })),
  untranslatable: arr(lex.canonical).map(T).filter(Boolean),
};

// сайт: business.site (Д1: build-project его выбрасывает) -> facts-src field business.site -> домен из lexicon.canonical
let siteUrl = T(b.site);
if (!siteUrl && fieldSrc['business.site']) {
  const m = T(fieldSrc['business.site'].raw).match(/https?:\/\/[^\s;,)«»]+|[a-z0-9.-]+\.[a-z]{2,}/i);
  if (m) { siteUrl = m[0]; heur('config.site_url', 'business.site пуст (Д1) - адрес из parts/facts-src.json, поле business.site', siteUrl); }
}
if (!siteUrl) {
  const d = arr(lex.canonical).map(T).find(x => /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(x));
  if (d) { siteUrl = d; heur('config.site_url', 'business.site пуст - домен из lexicon.canonical', d); }
}
if (siteUrl && !/^https?:\/\//i.test(siteUrl)) siteUrl = `https://${siteUrl.replace(/^\/+/, '')}`;
if (!siteUrl) empty('business.site', 'адреса сайта нет: 00-site-snapshot не сможет снять контакты');

// пробелы
if (!b.since) empty('business.since', 'года начала работы нет');
else if (!p.facts.some(f => new RegExp(String(b.since)).test(`${T(f.label)} ${T(f.value)}`))) gapsOut.push(`год начала работы: в business.since ${b.since}, но фактом с источником он не заведен - на сайт не идет, пока заказчик не подтвердит`);
for (const g of arr(p.gaps)) if (T(g.ask)) gapsOut.push(`открытый вопрос анализа (${g.id}): ${T(g.ask)}`);
// запись «... по решению d10» покрывает строка CONTACT_GAP (syncContactGap), второй строки о том же нет
for (const j of journal) if (j.kind === 'gap' && !/^молчание по/.test(T(j.subject)) && !D10_MAIN.test(T(j.subject))) gapsOut.push(`журнал гейта (${j.id}): ${T(j.subject)}`);
if (approved) for (const f of factsOut) if (f.publish === 'no' && !gapsOut.some(g => g.startsWith(`${f.id} «`))) gapsOut.push(`${f.id} «${f.label}» не подтвержден или снят на гейте: в тексты не идет`);
if (ungated) gapsOut.unshift('факты не подтверждены заказчиком: импорт до гейта анализа (--allow-ungated)');
if (!(b.assortment || []).length && (b.type === 'shop' || b.type === 'both')) empty('business.assortment', 'ассортимента нет (Д1): раздел «Позиции и карточки» пуст, каталогу не из чего взять товарные группы');

const facts = {
  generated_at: nowIso(),
  source: `project.json v2 «${p.slug}» от ${p.updated} (${projectPath})`,
  facts: sortFacts([...factsOut, ...operatorFacts, ...contact.facts]), anti_promises: antiOut, terminology, company, ...(Object.keys(tone).length ? { tone } : {}), gaps: gapsOut,
};
syncContactGap(facts, d10.why);
// регулярки из прошлого прогона
const patternsFile = P('work', 'anti-promises.patterns.json');
const applied = applyPatterns(facts, patternsFile, report, { onlySameText: true });
report.anti.ok = applied.ok;
report.anti.failed = applied.failed;
syncAntiGaps(facts, report, applied.conflicts);

// ---------------------------------------------------------------- аудитория
let objN = 0, objLinks = 0, objFromContract = 0, objHeuristic = 0;
const pubFacts = factsOut.filter(f => f.publish === 'yes');
const pubIds = new Set(pubFacts.map(f => f.id)), outIds = new Set(factsOut.map(f => f.id));
const nums = s => (String(s).match(/\d[\d\s]*\d|\d/g) || []).map(x => x.replace(/\s/g, '')).filter(x => x.length >= 2);
// пары соседних значимых слов по основам (5 букв): «период строительства» = «периоду строительства»
const bigrams = s => {
  const w = String(s).toLowerCase().split(/[^а-яa-z]+/).filter(x => x.length >= 5).map(x => x.slice(0, 5));
  return new Set(w.slice(1).map((x, i) => `${w[i]} ${x}`));
};
function linkFacts(answer) {
  const an = nums(answer), ab = bigrams(answer);
  return pubFacts.filter(f => nums(f.value).some(n => an.includes(n)) || [...bigrams(f.value)].some(g => ab.has(g))).map(f => f.id);
}
const dirById = Object.fromEntries(arr(b.directions).map(d => [d.id, d]));
const dirLabel = id => { const d = dirById[id]; return d ? `${T(d.name)}${T(d.url) ? ` (${T(d.url)})` : ''} [dir:${id}]` : `[dir:${id}]`; };
const segmentsOut = segs.slice(0, 9).map(s => {
  const objections = arr(s.objection).map(x => {
    objN++;
    const answer = T(x.answer);
    let fl;
    if (Array.isArray(x.facts)) {
      // контракт анализа сам говорит, на какие факты опирается ответ (site-market, objection[].facts):
      // берем как есть; в тексты идут только публикуемые, остальное - строкой в предупреждения
      objFromContract++;
      fl = [];
      for (const rawId of x.facts) {
        const id = factIdMap[rawId] || String(rawId).replace(/^f/, 'F');
        if (!outIds.has(id)) warn(`O${objN}: факт ${rawId} из objection[].facts не импортирован - ссылка снята`);
        else if (!pubIds.has(id)) warn(`O${objN}: факт ${id} из objection[].facts не публикуется (publish no) - ссылка снята`);
        else if (!fl.includes(id)) fl.push(id);
      }
    } else {
      // старый контракт без поля: связь по числу или паре слов (эвристика, стратег проверяет)
      objHeuristic++;
      fl = linkFacts(answer);
      if (fl.length) heur('audience.objections[].facts', 'поля facts в контракте нет: в ответе то же число или та же пара слов (по основам), что в value факта; стратег проверяет', `O${objN}: ${fl.join(', ')}`);
    }
    if (fl.length) objLinks++;
    return { id: `O${objN}`, text: T(x.says), answer, ...(T(x.behind) ? { behind: T(x.behind) } : {}), facts: fl };
  });
  const pains = arr(s.pain).map(T).filter(Boolean);
  return {
    id: segMap[s.id], name: T(s.name), portrait: T(s.who) || T(s.name),
    ...(pains[0] ? { comes_with: pains[0] } : {}),
    pains, fears: arr(s.fear).map(T).filter(Boolean), objections, criteria: arr(s.choose).map(T).filter(Boolean),
    directions: arr(s.dirs).map(dirLabel),
  };
});
if (segs.some(s => !T(s.who))) heur('audience.segments[].portrait', 'who пуст - портрет = имя сегмента', segs.filter(s => !T(s.who)).map(s => segMap[s.id]).join(', '));
if (objN > 99) warn(`возражений ${objN}: схема текстов допускает O1..O99`);
const words = arr(p.audience && p.audience.words);
const phrases = words.filter(w => T(w.say)).map(w => ({ phrase: T(w.say), meaning: T(w.means) || T(w.say), ...(w.src ? { src: w.src } : {}) }));
if (words.some(w => !T(w.means))) heur('audience.client_phrases[].meaning', 'means пуст - meaning = say', words.filter(w => !T(w.means)).map(w => T(w.say)).join('; '));
const audience = { source: facts.source, segments: segmentsOut, client_phrases: phrases };

// ---------------------------------------------------------------- пожелания заказчика (решения гейта)
const prefItems = [];
const how = k => report.gate.decisions[k].how;
const pref = (text, status, where, key, extra = {}) => { if (T(text)) prefItems.push({ text: T(text), status, where, reason: `${approved ? 'согласовано на гейте site-analiz' : 'гейт не пройден'}, ${key}: ${how(key)}`, source: `gate:${key}`, ...extra }); };
pref(o.positioning, 'basis', 'positioning', 'd1');
const proof = o.promise && o.promise.proof_id ? factIdMap[o.promise.proof_id] : '';
pref(o.promise && o.promise.result, 'candidate', 'hero', 'd2', proof ? { facts: [proof] } : {});
pref(o.promise && o.promise.cta, 'basis', 'cta', 'd3');
for (const x of arr(o.limits)) pref(x, 'basis', 'not-promise', 'd4');
pref(o.tone, 'basis', 'tone', 'd5');
for (const x of arr(cons.must_say)) if (T(x)) prefItems.push({ text: T(x), status: 'basis', where: 'must-say', reason: 'constraints.must_say: обязано стоять на сайте', source: 'constraints.must_say' });
if (!arr(cons.must_say).length) empty('constraints.must_say', 'обязательных формулировок нет');
const prefs = { source: facts.source, generated_at: nowIso(), items: prefItems };

// ---------------------------------------------------------------- направления, затравка конкурентов, конфиг
const directions = {
  source: facts.source,
  directions: arr(b.directions).map(d => {
    let geo = geoOf(T(d.name));
    if (!geo && T(d.marker)) { geo = geoOf(T(d.marker)); if (geo) heur('directions[].geo', 'в имени направления гео нет - взято из маркера', `${d.id}: ${geo}`); }
    return { id: d.id, name: T(d.name), ...(T(d.parent) ? { parent: T(d.parent) } : {}), ...(T(d.marker) ? { marker: T(d.marker) } : {}), ...(T(d.url) ? { url: T(d.url) } : {}), serves: arr(d.serves).map(s => segMap[s]).filter(Boolean), ...(geo ? { geo } : {}) };
  }),
};
const noServes = directions.directions.filter(d => !d.serves.length).map(d => d.id);
if (noServes.length) warn(`направления без сегментов (serves пуст): ${noServes.join(', ')} - обогатитель выберет сегмент сам`);

// Строка списка конкурентов анализа -> { domain, name, raw }: parseCompetitor из scripts/domains.mjs (одна нормализация
// доменов для импорта, отбора и верификатора).

const roots = arr(b.directions).filter(d => !T(d.parent));
const keyPhrases = [...new Set(roots.map(d => T(d.marker)).filter(Boolean))].slice(0, 7);
const seedDomains = [], seedRejected = [];
for (const x of arr(p.competitors && p.competitors.list)) {
  const c = parseCompetitor(x);
  if (!c) { if (T(x)) seedRejected.push(T(x)); continue; }
  if (!seedDomains.find(s => s.domain === c.domain)) seedDomains.push({ domain: c.domain, source: 'analysis', ...(c.name ? { name: c.name } : {}), raw: c.raw });
}
if (!seedDomains.length) empty('competitors.list', 'затравки конкурентов нет: верификатор возьмет только выдачу');
if (seedRejected.length) warn(`строки списка конкурентов без домена (${seedRejected.length}): в seed.rejected, верификатор разберет их сам`);
const seed = { source: facts.source, generated_at: nowIso(), region: T(b.region), key_phrases: keyPhrases, domains: seedDomains, ...(seedRejected.length ? { rejected: seedRejected } : {}) };

const prof = b.profile || {};
const sig = arr(b.sig);
const niche = { ...(cfg.niche || {}) };
niche.description = T(b.what);
niche.business_type = { services: 'services', shop: 'catalog', both: 'both' }[b.type] || niche.business_type;
if (prof.audience) niche.audience_type = prof.audience;
else if (sig.includes('b2b')) { niche.audience_type = 'b2b'; heur('config.niche.audience_type', 'признак b2b в business.sig (b2b от mixed не отличается)', 'b2b'); }
else empty('niche.audience_type', `в контракте нет (business.profile), оставлено «${niche.audience_type}»`);
if (prof.warmth) niche.demand_warmth = prof.warmth;
else if (sig.includes('urgent')) { niche.demand_warmth = 'hot'; heur('config.niche.demand_warmth', 'признак urgent в business.sig', 'hot'); }
else empty('niche.demand_warmth', `в контракте нет (business.profile), оставлено «${niche.demand_warmth}»`);
if (prof.price) niche.price_level = prof.price;
else empty('niche.price_level', `в контракте нет (business.profile), оставлено «${niche.price_level}»`);
if (prof.cycle) niche.purchase_cycle = prof.cycle;
else if (sig.includes('urgent')) { niche.purchase_cycle = 'days'; heur('config.niche.purchase_cycle', 'признак urgent в business.sig', 'days'); }
else if (sig.includes('long_cycle')) { niche.purchase_cycle = 'months'; heur('config.niche.purchase_cycle', 'признак long_cycle в business.sig (weeks от months не отличается)', 'months'); }
else empty('niche.purchase_cycle', `в контракте нет, оставлено «${niche.purchase_cycle}»`);
niche.geo = T(b.region) || niche.geo || '';
// регион для отбора конкурентов фазы 2 (rank-competitors.mjs, скаут): база Keys.so и код Яндекса - одно правило с
// /seo-struktura (scripts/regions.mjs); тип сайта (landing | multipage) - для множителя типа сайта в отборе
{
  const rg = parseRegion(niche.geo);
  niche.yandex_id = rg.yandex_id;
  niche.keyso_base = rg.keyso_base;
  if (T(b.site_kind)) niche.site_kind = T(b.site_kind);
}
const newCfg = {
  ...cfg,
  slug: cfg.slug || p.slug,
  company: T(b.name) || cfg.company,
  site_url: siteUrl || cfg.site_url || '',
  niche,
  sources: {
    ...S,
    mode: 'project',
    project_json: projectPath,
    facts_src: exists(factsSrcPath) ? factsSrcPath : '',
    queue: queue ? queuePath : '',
    structure_input: structurePath || '',
    // фразы, заданные руками до первого импорта, не затираются; после импорта их пересчитывает каждый повтор
    key_phrases: arr(S.key_phrases).length && S.mode !== 'project' ? S.key_phrases : keyPhrases,
  },
};
if (arr(S.key_phrases).length && S.mode !== 'project') warn('sources.key_phrases уже заполнены в конфиге руками - оставлены, маркеры направлений не подставлены');

// ---------------------------------------------------------------- структура
// Адрес страницы приводится к пути: без схемы и хоста, без ?query и #якоря, без слеша на конце, пустой - «/».
// Одно правило с urlPath в import-structure.mjs (при правке - поправить и там; тест cases-import сверяет оба).
const urlPath = u => { let s = T(u).replace(/^https?:\/\/[^/?#]+/i, '').replace(/[?#].*$/, ''); if (!s.startsWith('/')) s = '/' + s; return s.length > 1 ? s.replace(/\/+$/, '') || '/' : '/'; };
const structDest = P(newCfg.sources.structure_source || 'inputs/structure_data.json');
let structOut = null;
if (structurePath) {
  if (!exists(structurePath)) die(2, `нет файла структуры: ${structurePath}`);
  const sd = readJson(structurePath);
  if (!Array.isArray(sd.pages)) die(2, `${structurePath}: нет pages[] - формат не structure_data.json`);
  let slashFixed = 0, withDir = 0, byUrl = 0, byName = 0;
  const unknownDirs = new Set();
  const dirUrls = Object.fromEntries(directions.directions.filter(d => d.url).map(d => [urlPath(d.url), d.id]));
  const lowT = s => T(s).toLowerCase();
  const dirNames = new Set(directions.directions.flatMap(d => [lowT(d.name), lowT(d.marker)]).filter(Boolean));
  for (const pg of sd.pages) {
    if (typeof pg.url === 'string' && pg.url) { const u = urlPath(pg.url); if (u !== pg.url) { pg.url = u; slashFixed++; } }
    const m = `${pg.section || ''} ${pg.client_notes || ''}`.match(/dir:([a-z0-9-]+)/);
    if (m) { if (dirById[m[1]]) withDir++; else unknownDirs.add(m[1]); }
    else if (dirUrls[pg.url]) byUrl++;
    else if (dirNames.has(lowT(pg.name)) || dirNames.has(lowT(pg.marker))) byName++;
  }
  if (slashFixed) heur('inputs/structure_data.json', 'адрес приведен к пути: сняты схема, хост и слеш на конце (Д4: import-structure теряет родителя)', `${slashFixed} адресов`);
  if (unknownDirs.size) warn(`в структуре есть dir:<id>, которых нет в business.directions: ${[...unknownDirs].join(', ')}`);
  sd.imported_from = structurePath;
  structOut = sd;
  report.structure = { copied: true, pages: sd.pages.length, slash_fixed: slashFixed, pages_with_dir_id: withDir, pages_matched_by_url: byUrl, pages_matched_by_name_or_marker: byName };
  if (!withDir && !byUrl) warn('в структуре нет «dir:<id>» и адресов направлений: segment страниц обогатитель выбирает сам, без serves');
} else {
  report.structure = { copied: false, existing: exists(structDest) };
  if (!exists(structDest)) empty('structure_data.json', 'структуры нет: нужен --structure (seo-struktura или планировщик анализа) либо structure_mode fallback');
}

// ---------------------------------------------------------------- решение d9: состав сайта
// При tier basic состав пишет анализ (pages-planner, sites/NNN/structure_data.json) и принимает его гейт решением d9:
// ответ заказчика меняет только target_status. При tier seo состав решает /seo-struktura на своем гейте (A6.xlsx).
{
  const tier = T(queue && queue.tier) || T(p.tier);
  let sd = structOut;
  const src = structurePath || (exists(structDest) ? structDest : '');
  if (!sd) { try { sd = src ? readJson(src) : null; } catch { sd = null; } }
  const pages = arr(sd && sd.pages);
  const origin = T(sd && sd.imported_from) || src;
  const fromAnalysis = !!origin && path.resolve(path.dirname(origin)) === path.resolve(siteDir);
  const off = pages.filter(x => x.target_status === 'no').length;
  let value, dhow;
  if (!pages.length) {
    value = 'состава нет: карту строит фаза 0 (structure_mode fallback)';
    dhow = tier === 'seo' ? 'tier seo: состав решает /seo-struktura' : decisionHow('d9');
  } else {
    value = `${pages.length - off} страниц в работе${off ? `, снято ${off}` : ''}; источник - ${fromAnalysis ? 'состав анализа (pages-planner)' : rel(origin)}`;
    dhow = fromAnalysis ? decisionHow('d9') : 'состав структуры SEO: согласован на гейте /seo-struktura (A6.xlsx), не решением d9';
  }
  report.gate.decisions.d9 = { name: 'состав страниц', value, how: dhow };
}

// ---------------------------------------------------------------- конкуренты структуры SEO
// Рядом с внешним structure_data.json лежит competitors.json seo-base (/seo-struktura) - его копия в
// work/competitors/structure-competitors.json: {source, direct[], indirect[], excluded[{domain, reason}], stop_list[]}
// (stop_list - serp.json.stop_list с причинами). Домены - канон scripts/domains.mjs. Нет файла (tier basic,
// --structure-file без соседа, режим doc) - молча пропуск. Отбор (rank-competitors.mjs) ставит исключенным стоп.
let structComp = null;
if (structurePath) {
  const cf = path.join(path.dirname(structurePath), 'competitors.json');
  if (exists(cf)) {
    try {
      const sc = readJson(cf);
      const norm = list => arr(list).map(x => (typeof x === 'string' ? { domain: x } : x)).filter(x => x && typeof x === 'object')
        .map(x => ({ ...x, domain: normDomain(x.domain) })).filter(x => x.domain);
      let stop = [];
      const sf = path.join(path.dirname(structurePath), 'serp.json');
      if (exists(sf)) { try { stop = norm(readJson(sf).stop_list).map(x => ({ domain: x.domain, reason: T(x.reason) })); } catch { warn(`serp.json структуры не читается: ${sf}`); } }
      structComp = { source: cf, direct: norm(sc.direct), indirect: norm(sc.indirect), excluded: norm(sc.excluded).map(x => ({ domain: x.domain, reason: T(x.reason) })), stop_list: stop };
    } catch { warn(`competitors.json структуры не читается: ${cf} - копия конкурентов структуры не сделана`); }
  }
}

// ---------------------------------------------------------------- отпечаток анализа (K3)
// Хеш того, что пришло из анализа помимо фактов, по разделам. --facts-only сравнивает анализ с отпечатком прошлого
// импорта, а не с рабочими файлами: их дописывают стратеги (адреса блоков и свои пункты пожеланий). Без производного
// от publish фактов (ссылки возражений на факты - id контракта) и без пояснения «как принято» у пожеланий (reason).
const fpAudience = aud => ({ segments: arr(aud && aud.segments).map(s => ({ ...s, objections: arr(s.objections).map(x => Object.fromEntries(Object.entries(x).filter(([k]) => k !== 'facts'))) })), client_phrases: arr(aud && aud.client_phrases) });
const fpSeed = s => ({ region: T(s && s.region), key_phrases: arr(s && s.key_phrases), domains: arr(s && s.domains), rejected: arr(s && s.rejected) });
const FP_PARTS = {
  audience: { ...fpAudience(audience), objection_facts: segs.slice(0, 9).map(s => arr(s.objection).map(x => (Array.isArray(x.facts) ? x.facts.map(String) : null))) },
  'client-preferences': prefItems.map(x => Object.fromEntries(Object.entries(x).filter(([k]) => k !== 'reason'))),
  directions: directions.directions,
  'competitors-seed': fpSeed(seed),
  anti_promises: antiOut.map(x => x.text),
  company: lg,
  // копия конкурентов структуры: раздел есть, только если копия есть (старые задачи - прежние 6 разделов)
  ...(structComp ? { 'structure-competitors': { direct: structComp.direct, indirect: structComp.indirect, excluded: structComp.excluded, stop_list: structComp.stop_list } } : {}),
};
const fingerprint = Object.fromEntries(Object.entries(FP_PARTS).map(([k, v]) => [k, sha(canon(v))]));
report.analysis_fingerprint = fingerprint;

// ---------------------------------------------------------------- счетчики, рендер, запись
const kinds = {};
factsOut.forEach(f => { kinds[f.kind] = (kinds[f.kind] || 0) + 1; });
const prefCount = { candidate: 0, basis: 0, rejected: 0 };
prefItems.forEach(x => { prefCount[x.status]++; });
report.counts = {
  facts: factsOut.length, facts_in_project: p.facts.length, publish_yes: pubFacts.length, kinds, geo_facts: factsOut.filter(f => f.geo).length,
  contact_facts: contact.facts.length, operator_facts: operatorFacts.length, operator_moved: operatorMoved.length,
  quotes_from_facts_src: qFromSrc, quotes_fallback: qFallback, quotes_verified_in_input: qVerified, quotes_not_found_in_input: qMissing, quotes_input_file_missing: qNoFile,
  anti_promises: antiOut.length, anti_auto: report.anti.auto.length, anti_pending: report.anti.pending.length,
  segments: segmentsOut.length, objections: objN, objections_with_facts: objLinks,
  objections_facts_from_contract: objFromContract, objections_facts_heuristic: objHeuristic, client_phrases: phrases.length,
  client_phrases_persona: phrases.filter(x => x.src === 'persona').length, preferences: prefCount,
  directions: directions.directions.length, competitors_seed: seedDomains.length, key_phrases: keyPhrases.length, gaps: facts.gaps.length,
};
report.contact_facts = contact.facts.map(f => f.id);
report.heuristic = Object.values(H);
report.anti.sources = antiSrc.map(x => `${x.id}: ${x.from}`);

// ---------------------------------------------------------------- --facts-only: только факты, остальное как было
if (FACTS_ONLY) {
  const cur = prevFacts;
  const curList = arr(cur.facts);
  const prevRep = exists(P('work', 'import-report.json')) ? (() => { try { return readJson(P('work', 'import-report.json')); } catch { return null; } })() : null;
  const base = prevRep && prevRep.facts_digest;
  const hand = digestDiff(base || digestOf(factsOut), digestOf(curList));
  if (hand.any) {
    const head = base ? 'work/facts.json правили руками после прошлого импорта' : 'в import-report.json нет дайджеста фактов (старая задача): facts.json сверен с тем, что дает анализ сейчас';
    const lines = [`${head}:`, hand.added.length ? ` - нет в анализе: ${hand.added.join(', ')}` : '', hand.removed.length ? ` - удалены из facts.json: ${hand.removed.join(', ')}` : '', hand.changed.length ? ` - изменены (value, wording или publish): ${hand.changed.join(', ')}` : ''].filter(Boolean);
    if (!a.force) die(3, [...lines, 'Ручные правки перенеси в анализ (или факт оператора F801-F899 с source «оператор: <дата> <основание>») и повтори; --force - перезаписать факты анализа.'].join('\n'));
    warn(`--force: ${lines.join(' ')}`);
  }
  // company: поля business.legal анализа - из анализа. Пустое в анализе поле берется из текущего company, только если
  // его дал снимок сайта (report.company_origin); поле прошлого анализа, которого в анализе больше нет (снято правкой
  // d10 или фактом publish no), убирается вместе со служебным фактом.
  const curCo = cur.company && typeof cur.company === 'object' ? cur.company : {};
  const curSvc = curList.filter(f => SERVICE_ID.test(f.id));
  const prior = priorOrigin(curCo, prevRep, curSvc);
  const merged = {};
  for (const [k, v] of Object.entries(curCo)) if (!CO_FIELDS.includes(k) && !['no_phone', 'phone_absent', 'absent', 'channels', 'status', 'source'].includes(k)) merged[k] = v;
  if (T(company.brand)) merged.brand = company.brand;
  // снятые заказчиком поля (absent) - по анализу сейчас: данные снимка по ним prepareCompany ниже убирает
  if (company.absent) merged.absent = company.absent;
  const origin = {};
  for (const k of CO_FIELDS) {
    if (hasField(company, k)) { merged[k] = company[k]; origin[k] = 'analysis'; continue; }
    if (!hasField(curCo, k) || (k === 'phones' && company.no_phone)) continue;
    const o = prior.map[k] || (prior.known ? 'site' : '');
    const shown = Array.isArray(curCo[k]) ? curCo[k].join(', ') : T(curCo[k]);
    if (o === 'analysis') { warn(`company.${k} «${shown}»: в анализе этого поля больше нет - убрано из company и служебных фактов`); continue; }
    if (!o) warn(`company.${k} «${shown}»: источник неизвестен (в import-report.json нет company_origin) - оставлено как данные снимка сайта, проверь`);
    merged[k] = curCo[k];
    origin[k] = 'site';
  }
  if (company.no_phone) merged.no_phone = true;
  // каналы: из фактов анализа и оператора заново; прежние без факта (снимок сайта) в company не идут - вопросом
  // заказчику в gaps (K1), пока их не подтвердит факт
  const { confirmed: chs, fromSite: siteCh } = splitChannels([...factsOut, ...operatorFacts], curCo);
  if (Object.keys(chs).length) merged.channels = chs;
  const prep2 = prepareCompany(merged, factsOut, warn, approved);
  for (const k of Object.keys(origin)) if (!hasField(merged, k)) delete origin[k];
  merged.status = !filledCompany(merged) ? 'missing' : legalFilled ? company.status : 'from_site_unconfirmed';
  // источник без повторов: анализ (если из него есть поля) и адреса снимка (если от снимка что-то осталось)
  const siteParts = T(curCo.source).split(' + ').map(T).filter(x => x && x !== ANALYSIS_SOURCE);
  const keepSite = Object.values(origin).includes('site');
  const srcParts = [...new Set([...(legalFilled ? [ANALYSIS_SOURCE] : []), ...(keepSite ? siteParts : [])])];
  if (srcParts.length) merged.source = srcParts.join(' + ');
  const url = firstUrl(merged.source);
  const siteSrc = `[сайт] ${url || T(cfg.site_url) || 'старый сайт'}`;
  const svc = contactFacts(merged, factsOut, { existing: curSvc, rawPhones: { ...prep2.rawPhones, ...prep.rawPhones }, sourceOf: s => (slotOrigin(origin, s) === 'site' ? siteSrc : `[анализ] business.legal.${s.legal}`) });
  const IMPORT_GAP = /^(F\d{2,3} «|конфликт: |год начала работы|открытый вопрос анализа|журнал гейта|факты не подтверждены заказчиком|реквизиты: в анализе нет|телефона для сайта нет|регулярка антиобещания |контакты и реквизиты|телефон .* снят заказчиком|(почта|часы работы|адрес|юрлицо и реквизиты) снят заказчиком)/;
  const keptGaps = arr(cur.gaps).filter(g => !IMPORT_GAP.test(g));
  const out = {
    ...cur,
    generated_at: nowIso(),
    source: facts.source,
    facts: sortFacts([...factsOut, ...operatorFacts, ...svc.facts]),
    company: merged,
    // строка «в анализе нет реквизитов» не нужна, если company заполнен снимком сайта (его итог - в keptGaps)
    gaps: [...gapsOut.filter(g => !g.startsWith(CONTACT_GAP) && !(g.startsWith('реквизиты: в анализе нет') && filledCompany(merged))), ...prep2.notes.filter(n => !gapsOut.includes(n)), ...keptGaps],
  };
  out.gaps = syncChannelGaps(out.gaps, siteCh, chs);
  syncContactGap(out, legalFilled && !d10.ok ? d10.why : 'сняты со старого сайта');
  report.structure = { copied: false, skipped: '--facts-only: структура и карта не трогаются' };
  const re2 = applyPatterns(out, patternsFile, report, { onlySameText: true });
  report.anti.ok = re2.ok; report.anti.failed = re2.failed;
  syncAntiGaps(out, report, re2.conflicts);
  // что изменилось в анализе (для повтора стратегии и брифов)
  const oldById = Object.fromEntries(curList.filter(isAnalysisFact).map(f => [f.id, f]));
  const newById = Object.fromEntries(factsOut.map(f => [f.id, f]));
  // факт оператора, перенесенный в анализ (moved_from), - в removed: стратеги снимают его со страниц, новый id - в added
  report.facts_diff = {
    added: Object.keys(newById).filter(id => !oldById[id]),
    removed: [...Object.keys(oldById).filter(id => !newById[id]), ...operatorMoved],
    changed: Object.keys(newById).filter(id => oldById[id] && (oldById[id].value !== newById[id].value || oldById[id].wording !== newById[id].wording)),
    published: Object.keys(newById).filter(id => oldById[id] && oldById[id].publish !== 'yes' && newById[id].publish === 'yes'),
    unpublished: Object.keys(newById).filter(id => oldById[id] && oldById[id].publish === 'yes' && newById[id].publish !== 'yes'),
  };
  // что еще изменилось в анализе (K3): по отпечатку прошлого импорта; раздела нет в отпечатке (отчет до программы
  // 28.09) - по рабочему файлу, пожелания - парами «текст, статус» (стратег дописывает адреса и свои пункты)
  const prevFp = prevRep && prevRep.analysis_fingerprint && typeof prevRep.analysis_fingerprint === 'object' ? prevRep.analysis_fingerprint : {};
  const readWork = file => { try { return readJson(P(file)); } catch { return null; } };
  const pair = x => `${T(x.text)}\n${T(x.status)}`;
  const seedCore = s => ({ region: T(s && s.region), key_phrases: arr(s && s.key_phrases).map(T), domains: arr(s && s.domains).filter(d => d && (!d.source || d.source === 'analysis')).map(d => T(d.domain)).filter(Boolean) });
  const IMPORT_PREF = /^(gate:d\d+|constraints\.must_say)$/;
  const FALLBACK = {
    audience: () => { const w = readWork('work/audience.json'); return !w || canon(fpAudience(w)) !== canon(fpAudience(audience)); },
    'client-preferences': () => {
      const w = readWork('work/client-preferences.json');
      if (!w) return true;
      const want = new Set(prefItems.map(pair)), have = new Set(arr(w.items).map(pair));
      return [...want].some(x => !have.has(x)) || arr(w.items).some(x => IMPORT_PREF.test(T(x.source)) && !want.has(pair(x)));
    },
    directions: () => { const w = readWork('work/directions.json'); return !w || canon(arr(w.directions)) !== canon(directions.directions); },
    // затравка: регион, фразы и домены анализа строками (name и raw пишет по-разному каждая версия kit)
    'competitors-seed': () => { const w = readWork('work/competitors/seed.json'); return !w || canon(seedCore(w)) !== canon(seedCore(seed)); },
    anti_promises: () => canon(arr(cur.anti_promises).map(x => x.text)) !== canon(antiOut.map(x => x.text)),
    // копия конкурентов структуры: нет ни копии, ни структуры с competitors.json - не изменение
    'structure-competitors': () => { const w = readWork('work/competitors/structure-competitors.json'); const core = x => (x ? { direct: arr(x.direct), indirect: arr(x.indirect), excluded: arr(x.excluded), stop_list: arr(x.stop_list) } : null); return canon(core(w)) !== canon(core(structComp)); },
  };
  const other = [];
  const fpOut = {};
  for (const [k, changedByFile] of Object.entries(FALLBACK)) {
    const known = typeof prevFp[k] === 'string' && prevFp[k];
    // задача до программы 05.10: раздела конкурентов структуры нет ни в отпечатке, ни копией - раздел новый, не изменение;
    // его отпечаток пишет следующий полный импорт вместе с копией
    if (!known && k === 'structure-competitors' && !readWork('work/competitors/structure-competitors.json')) continue;
    const changed = known ? prevFp[k] !== fingerprint[k] : changedByFile();
    if (changed) { other.push(k); if (known) fpOut[k] = prevFp[k]; } else if (fingerprint[k]) fpOut[k] = fingerprint[k];
  }
  // company --facts-only переносит сам: его отпечаток - текущий
  fpOut.company = fingerprint.company;
  report.analysis_fingerprint = fpOut;
  report.other_changed = other;
  if (other.length) warn(`в анализе изменились не только факты (${other.join(', ')}): --facts-only их не переносит, нужен повтор фазы 0`);
  report.company_missing = companyMissing(merged);
  report.company_origin = origin;
  report.contact_facts = svc.facts.map(f => f.id);
  report.facts_digest = digestOf(out.facts);
  report.counts.gaps = out.gaps.length;
  report.counts.contact_facts = svc.facts.length;
  const problems = [];
  validateOut('facts', 'work/facts.json', out, problems);
  if (problems.length) die(1, 'выход --facts-only не прошел схему, ничего не записано:\n' + problems.map(x => ' - ' + x).join('\n'));
  writeJson(factsFileOut, out);
  report.outputs.push('work/facts.json', 'work/import-report.json');
  const rendered = rerenderSections(out);
  if (rendered) report.outputs.push('inputs/analysis.md (разделы «Факты» и «Пробелы»)');
  const repErr = validate(loadSchema('import-report'), report);
  if (repErr.length) warn(`отчет импорта не прошел схему: ${repErr.slice(0, 3).join('; ')}`);
  writeJson(P('work', 'import-report.json'), report);
  const fd = report.facts_diff;
  console.log(`--facts-only ${p.slug}: фактов анализа ${factsOut.length} (publish yes ${pubFacts.length}), контактных ${svc.facts.length}, оператора ${operatorFacts.length}`);
  console.log(`изменения анализа: новые ${fd.added.join(', ') || '-'}; сняты ${fd.removed.join(', ') || '-'}; изменены ${fd.changed.join(', ') || '-'}; стали публикуемыми ${fd.published.join(', ') || '-'}; сняты с публикации ${fd.unpublished.join(', ') || '-'}`);
  console.log(`company: ${merged.status}; пробелов: ${out.gaps.length}${other.length ? `; ВНИМАНИЕ: изменились ${other.join(', ')} - нужен повтор фазы 0` : ''}`);
  for (const w of report.warnings) console.log(` ! ${w}`);
  process.exit(0);
}

const md = renderAnalysis({ p, facts, audience, prefs, gate: report.gate, projectRel: projectPath, seed, segMap, factIdMap, factSrc: factSrcLabel, siteUrl });
const missingQuotes = facts.facts.filter(f => !md.includes(f.source_quote)).map(f => f.id);
if (missingQuotes.length) warn(`source_quote не находится в отрендеренном inputs/analysis.md: ${missingQuotes.join(', ')}`);
report.counts.quotes_in_render = facts.facts.length - missingQuotes.length;
report.facts_digest = digestOf(facts.facts);

const problems = [];
validateOut('facts', 'work/facts.json', facts, problems);
validateOut('audience', 'work/audience.json', audience, problems);
validateOut('client-preferences', 'work/client-preferences.json', prefs, problems);
validateOut('directions', 'work/directions.json', directions, problems);
validateOut('competitors-seed', 'work/competitors/seed.json', seed, problems);
validateOut('project-config', 'config/project.json', newCfg, problems);
if (problems.length) die(1, 'выход импорта не прошел схемы, ничего не записано:\n' + problems.map(x => ' - ' + x).join('\n'));

if (structOut) { writeJson(structDest, structOut); report.outputs.push(rel(structDest)); }
const OUT = [
  ['work/facts.json', facts], ['work/audience.json', audience], ['work/client-preferences.json', prefs],
  ['work/directions.json', directions], ['work/competitors/seed.json', seed], ['config/project.json', newCfg],
];
for (const [f, d] of OUT) { writeJson(P(f), d); report.outputs.push(f); }
if (structComp) { writeJson(P('work', 'competitors', 'structure-competitors.json'), { ...structComp, generated_at: nowIso() }); report.outputs.push('work/competitors/structure-competitors.json'); }
const mdPath = newCfg.sources.analysis_dump || 'inputs/analysis.md';
writeText(P(mdPath), md);
report.outputs.push(mdPath, 'work/import-report.json');
const repErr = validate(loadSchema('import-report'), report);
if (repErr.length) warn(`отчет импорта не прошел схему: ${repErr.slice(0, 3).join('; ')}`);
writeJson(P('work', 'import-report.json'), report);

console.log(`импорт ${p.slug} (гейт: ${approved ? 'согласован' : 'НЕ согласован, --allow-ungated'})`);
console.log(`факты: ${factsOut.length} (publish yes ${pubFacts.length}), kind ${JSON.stringify(kinds)}, гео ${report.counts.geo_facts}; контактных F9xx ${contact.facts.length}${operatorFacts.length ? `, оператора ${operatorFacts.length}` : ''}`);
console.log(`цитаты: из facts-src ${qFromSrc} (найдено во входе ${qVerified}, не найдено ${qMissing}, нет файла ${qNoFile}), строкой «[src] label: value» ${qFallback}`);
console.log(`антиобещания: ${antiOut.length}, без регулярки ${report.anti.pending.length}${report.anti.pending.length ? ' - нужен агент по prompts/00-antipromise-patterns.md' : ''}`);
console.log(`аудитория: сегментов ${segmentsOut.length}, возражений ${objN} (факты ответа из контракта ${objFromContract}, эвристикой ${objHeuristic}), слов клиентов ${phrases.length}; пожелания: ${JSON.stringify(prefCount)}`);
console.log(`компания: ${company.status}${d10.why && legalFilled ? ` (${d10.why})` : ''}; пусто для снимка сайта: ${report.company_missing.join(', ') || '-'}; сайт: ${siteUrl || '-'}; конкурентов в затравке: ${seedDomains.length}${structComp ? `, в структуре ${structComp.direct.length + structComp.indirect.length}` : ''}; пробелов: ${facts.gaps.length}`);
if (report.structure.copied) console.log(`структура: ${report.structure.pages} страниц -> ${rel(structDest)}`);
console.log(`решение d9 (состав страниц): ${report.gate.decisions.d9.value}; ${report.gate.decisions.d9.how}`);
for (const w of report.warnings) console.log(` ! ${w}`);
