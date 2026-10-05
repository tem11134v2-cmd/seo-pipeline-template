// Таблица КФ и КНДР для заказчика (программа 05.10, раздел 3.6). node scripts/build-kf-xlsx.mjs
//   [--record --status published|skipped [--file-id <id>] [--url <url>] [--reason <текст>]]
// Из корня задачи, без LLM. Правило включения: нет work/kf/matrix.json - этап КФ не проводился, таблица не строится
// (код 0, stdout {path: null, ..., skipped: "<причина>"}; причина - work/kf/status.json, нет файла - pre_kf).
// Выход: work/output/kf-kndr.xlsx и work/output/kf-xlsx.meta.json; stdout - одна строка JSON {path, drive_name, data_sha,
// need_publish, prev_url, prev_file_id}. drive_name - «КФ и КНДР - <компания>» без точек (Drive режет имя по точке). data_sha - sha256
// канонического JSON содержимого листов (по порядку: имя, шапка, значения ячеек; ключи отсортированы; без дат), считается
// из той же модели, из которой пишутся листы: таблица с тем же data_sha заново не публикуется (need_publish false).
// Листы: «Как читать» (простым языком), «Отбор конкурентов» (ranking.json + pool.json + competitors.json, до 30 кандидатов и
// строка «ваш сайт»), «Сравнение» (матрица: группы Шапка, Подвал, Мобильная версия, Закрепленные элементы, типы страниц
// карты, «Для разработчика»; первая строка - «Сумма элементов»; колонка «В прототипе» - prototype.modules.json -> shell и
// по типам - брифы, brief.stubs и prototype.index.json), «Ограничения» (что не проверено).
// --record пишет work/output/kf-publish.json {status, file_id, url, name, data_sha, published_at, reason, revisions}
// (оркестратор JSON руками не пишет): тот же data_sha при published - запись прежняя, без revisions; новый файл -
// прежний уходит в revisions (его переименовывают «(устарело)»; stdout сборки - prev_url, prev_file_id). skipped при
// действующей публикации с тем же data_sha запись не меняет; нет матрицы - --record ничего не пишет (код 0).
// exceljs - через scripts/deps.mjs.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { argv, P, exists, writeJson, nowIso } from './lib.mjs';
import { normDomain, domainUnicode } from './domains.mjs';

export const XLSX_REL = 'work/output/kf-kndr.xlsx';
export const META_REL = 'work/output/kf-xlsx.meta.json';
export const PUBLISH_REL = 'work/output/kf-publish.json';
const rjs = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, '')); } catch { return null; } };
const clean = s => String(s ?? '').replace(/\s+/g, ' ').trim();
// имя элемента для заказчика: без служебной пометки вида в скобках в конце («Отзывы (ссылка)»); пояснение
// («Реквизиты (ИНН, ОГРН)») остается
export const elName = s => clean(s).replace(/\s*\((ссылка|блок|кнопка|иконка|меню|раздел|страница|форма|виджет)\)$/i, '');
const arr = v => (Array.isArray(v) ? v : []);
const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// ---------------------------------------------------------------- общие справки (их берет и report.mjs)
const STATUS_RU = {
  no_competitors: 'нет доступных конкурентов',
  skip: 'этап пропущен (skipKf)',
  no_chrome: 'нет Chrome и Edge, матрица не построена',
  done: 'матрица не построена',
  pre_kf: 'задача начата до этапа КФ',
};
// этап КФ проведен, только если есть матрица; иначе причина из work/kf/status.json (нет файла - pre_kf)
export function kfStage() {
  const matrix = rjs(P('work', 'kf', 'matrix.json'));
  const st = rjs(P('work', 'kf', 'status.json'));
  const status = st && st.status ? String(st.status) : 'pre_kf';
  const reason = `${STATUS_RU[status] || status}${st && st.reason ? `: ${clean(st.reason)}` : ''}`;
  return { matrix: matrix && Array.isArray(matrix.rows) ? matrix : null, status, statusFile: !!st, reason };
}
// строка «Таблица КФ/КНДР» для сводки отчета: ссылка | xlsx без публикации | нет: <причина>; null - старая задача
export function kfTableLine() {
  const stage = kfStage();
  if (!stage.matrix) return stage.statusFile ? `нет: ${stage.reason}` : null;
  const meta = rjs(P(...META_REL.split('/')));
  const pub = rjs(P(...PUBLISH_REL.split('/')));
  const xlsx = exists(P(...XLSX_REL.split('/')));
  if (pub && pub.status === 'published' && pub.url) {
    const stale = meta && meta.data_sha && pub.data_sha !== meta.data_sha;
    return `${pub.url}${stale ? ' (устарела: таблица пересобрана после публикации, опубликовать заново)' : ''}`;
  }
  if (!xlsx) return 'не собрана (build-kf-xlsx.mjs не запускался)';
  if (pub && pub.status === 'skipped') {
    // прежняя публикация (таблица с тех пор изменилась) - ссылкой с пометкой «устарела»
    const old = arr(pub.revisions).filter(x => x && x.url).at(-1);
    return `xlsx без публикации (${clean(pub.reason) || 'причина не указана'}): ${XLSX_REL}${old ? `; прежняя публикация (устарела): ${old.url}` : ''}`;
  }
  return `xlsx без публикации: ${XLSX_REL}`;
}
// sha256 канонического JSON: ключи объектов отсортированы
export function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  return JSON.stringify(v === undefined ? null : v);
}
export function dataSha(sheets) {
  const body = sheets.map(s => ({ name: s.name, header: s.header, rows: s.rows.map(r => r.cells) }));
  return crypto.createHash('sha256').update(canonical(body)).digest('hex');
}
export const driveName = company => clean(`КФ и КНДР - ${clean(company) || 'проект'}`.replace(/\./g, ' '));

// ---------------------------------------------------------------- подписи
const TYPE_RU = { home: 'Главная', hub: 'Раздел', category: 'Категория', service: 'Услуга', product: 'Карточка товара', info_about: 'О компании', info_contacts: 'Контакты', info_team: 'Команда', info_reviews: 'Отзывы', info_cases: 'Кейсы', info_faq: 'Вопросы и ответы', info_other: 'Информационная страница' };
const ZONE_GROUP = { header: 'Шапка', footer: 'Подвал', mobile: 'Мобильная версия', fixed: 'Закрепленные элементы' };
const ZONE_RU = { header: 'шапка', footer: 'подвал', mobile: 'мобильная версия', fixed: 'закрепленные элементы', body: 'страница' };
const LEVEL_RU = { must: 'обязательно', recommended: 'рекомендовано', optional: 'по желанию' };
const LEVEL_RANK = { must: 0, recommended: 1, optional: 2 };
const SRC_RU = { analysis: 'анализ', serp: 'выдача', serp_msk: 'выдача Москвы', structure: 'структура', keyso: 'Keys.so', both: 'анализ, выдача' };
const AGE_RU = { young: 'молодой', mid: 'средний', old: 'давний', unknown: '' };
const GROWTH_RU = { up: 'растет', flat: 'ровно', down: 'падает', unknown: '-' };
const SITE_RU = { multipage_leader: 'крупный', medium: 'средний', small: 'небольшой', landing: 'лендинг', unknown: '-' };
const STATE_RU = { shown: 'есть', chip: 'нужны данные', function: 'функция', page_missing: 'нужна страница', declined: 'нет, решение заказчика' };
const COMP_BAD_RU = { aggregator: 'агрегатор', closed: 'сайт недоступен', excluded: 'исключен', js_only: 'текст сайта виден только со скриптами', antibot: 'страница проверки (антибот)' };
export const zoneRu = z => ZONE_RU[z] || z || '';
// declined с reason "off" (модуль выключен оператором при наличии данных) - не решение заказчика
export const stateRu = (s, reason) => (s === 'declined' && reason === 'off' ? 'нет, выключено оператором' : STATE_RU[s] || s || '');
const val = v => (v === 1 ? '+' : v === 0 ? '-' : v === '?' ? '?' : '');
const dec = (x, d = 1) => (num(x) === null ? '-' : String(Math.round(x * 10 ** d) / 10 ** d).replace('.', ','));
const pct = x => (num(x) === null ? '-' : `${Math.round(x * 100)}%`);
const intOr = x => (num(x) === null ? '-' : Math.round(x));
export function scopeType(scope) {
  const s = String(scope || '');
  const m = s.match(/^([a-z_]+)[:/](.+)$/);
  return m ? { type: m[1], subject: m[2] } : { type: s, subject: '' };
}
const scopeTitle = scope => { const { type, subject } = scopeType(scope); return `${TYPE_RU[type] || type}${subject ? `: ${subject}` : ''}`; };

// ---------------------------------------------------------------- модель листов
// лист: {name, header: [..], widths: [..], rows: [{cells: [..], kind: 'row'|'group'|'sum'|'note', fill?, italic?: [индексы]}]}
function readDoc() {
  const cfg = rjs(P('config', 'project.json')) || {};
  const sm = rjs(P('work', 'sitemap.json')) || { pages: [] };
  return {
    cfg,
    live: arr(sm.pages).filter(p => p && p.status !== 'skip'),
    matrix: rjs(P('work', 'kf', 'matrix.json')),
    status: rjs(P('work', 'kf', 'status.json')),
    ranking: rjs(P('work', 'competitors', 'ranking.json')),
    pool: rjs(P('work', 'competitors', 'pool.json')),
    comp: rjs(P('work', 'competitors', 'competitors.json')),
    capture: rjs(P('work', 'competitors', 'capture.json')),
    modules: rjs(P('work', 'output', 'prototype.modules.json')),
    index: rjs(P('work', 'output', 'prototype.index.json')),
    br: rjs(P('work', 'briefs-report.json')) || {},
  };
}
// конкуренты матрицы (без own): domains - объекты {domain, role} (схема kf-matrix) или строки
const matrixComps = m => new Set(arr(m && m.domains).map(x => (typeof x === 'string' ? { domain: x, role: 'competitor' } : x)).filter(x => x && x.domain && x.role !== 'own').map(x => x.domain));
// «в анализе» - как kf-matrix: верификатор дал ok и домен есть в матрице
function analysisOf(d) {
  const inMatrix = matrixComps(d.matrix);
  const compBy = new Map(arr(d.comp && d.comp.competitors).map(c => [c.domain, c]));
  const inAnalysis = dom => { const c = compBy.get(dom); return !!c && c.status === 'ok' && (!inMatrix.size || inMatrix.has(dom)); };
  const anchors = new Set(arr(d.ranking && d.ranking.anchors));
  const isAnchor = dom => { const c = compBy.get(dom); return !!c && (c.anchor === true || (anchors.has(dom) && c.anchor !== false)); };
  const anchorGood = [...compBy.keys()].some(x => inAnalysis(x) && isAnchor(x));
  return { compBy, inMatrix, inAnalysis, isAnchor, anchorGood, anchorsPlanned: anchors.size > 0 || [...compBy.values()].some(c => c.anchor === true) };
}

function sheetReadme(d) {
  const m = d.matrix;
  const target = num(m.target) || 5, mustN = num(m.must_n) || Math.ceil(0.8 * target), recN = num(m.recommended_n) || 2;
  const recSpan = mustN - 1 > recN ? `${recN}-${mustN - 1}` : String(recN);
  // «Как отбирали лидеров» - по данным отбора: ranking (или старый путь верификатора), Keys.so, эталон
  const A = analysisOf(d);
  const nComp = A.inMatrix.size || target;
  const region = (d.pool && d.pool.region) || {};
  const noKeyso = !!region.city_not_in_keyso;
  const keyso = !noKeyso && arr(d.pool && d.pool.candidates).some(c => c && c.keyso);
  const how = [];
  if (d.ranking) {
    how.push(`Кандидатов собрали по выдаче Яндекса по запросам вашей ниши и по анализу${keyso ? ', метрики сняли в сервисах оценки сайтов' : ''}.`);
    how.push(`Силу сайта считали по доле в выдаче ниши${keyso ? ', числу запросов в ТОП-10 и ТОП-50, трафику' : ''} и ИКС, учитывали тип сайта, возраст домена и рост.`);
    if (noKeyso) how.push(`Вашего города${region.city ? ` (${clean(region.city)})` : ''} нет в базе Keys.so: рынок оценивали по выдаче без Keys.so.`);
    how.push(`В сравнение взяли ${nComp} сайтов: смесь быстрорастущих и авторитетных.`);
    if (A.anchorGood) how.push('Среди них есть эталон - сильный давний сайт.');
    else if (A.anchorsPlanned) how.push('Эталон (сильный давний сайт) в сравнение не попал - см. лист «Ограничения».');
    else how.push('Годного эталона (сильного давнего сайта) среди кандидатов не нашлось.');
  } else {
    how.push(`Лидеров взяли из списка конкурентов анализа и проверили их сайты: доступность, профиль, нужные страницы. В сравнение взяли ${nComp} сайтов.`);
    if (noKeyso) how.push('Вашего города нет в базе Keys.so: метрики Keys.so не использовали.');
  }
  how.push('Агрегаторы, маркетплейсы, справочники и сайты другого профиля не брали. Подробности - лист «Отбор конкурентов».');
  const rows = [
    ['Что такое КФ', 'Коммерческие факторы - элементы, по которым поиск и посетитель узнают настоящую компанию: телефон, адрес, цены, условия, реквизиты, корзина и заявка.'],
    ['Что такое КНДР', 'Контент, необходимый для ранжирования, - блоки и элементы, которые есть у большинства сильных сайтов вашей ниши.'],
    ['Зачем эта таблица', 'Показывает, что есть у лидеров ниши, что есть у вас сейчас и что мы заложили в прототип. Согласовывать ее не нужно: это отчет о проделанной работе.'],
    ['Как отбирали лидеров', how.join(' ')],
    ['Обозначения', '«+» - элемент есть; «-» - элемента нет; «?» - проверить уверенно не удалось (курсив); пустая клетка - страницы этого типа у сайта нет или она не снята.'],
    ['Решение', `«обязательно» - элемент есть у ${mustN} и более лидеров из ${target}; «рекомендовано» - у ${recSpan}; «по желанию» - у одного. «Уже есть» - элемент уже есть на вашем сайте. В прототип идут «обязательно» и «рекомендовано».`],
    ['В прототипе', '«есть» - элемент показан; «нужны данные» - место в прототипе есть, нужны ваши данные (вопрос в отчете); «функция» - кнопка интерфейса; «нужна страница» - рекомендуем страницу, которой нет в карте сайта; «нет, решение заказчика» - вы попросили не показывать; «нет, выключено оператором» - данные есть, но этот модуль мы в прототипе не показываем; «есть на k из m» - элемент есть на части страниц типа; «не написано» - блок заложен, текст еще не готов; «нет: ...» - почему не берем.'],
    ['Группы строк', 'Шапка, подвал, мобильная версия и закрепленные элементы - общие для всего сайта; дальше - по типам страниц. «Для разработчика» - элементы, которых посетитель не видит (например, разметка для поиска).'],
    ['Сумма элементов', 'Первая строка листа «Сравнение» - сколько элементов нашли у каждого сайта.'],
  ];
  return { name: 'Как читать', header: ['Тема', 'Пояснение'], widths: [24, 110], rows: rows.map(cells => ({ kind: 'row', cells })) };
}

function sheetSelection(d) {
  const header = ['Домен', 'Источник', 'Доля в выдаче ниши', 'ТОП-10', 'ТОП-50', 'Трафик', 'ИКС', 'Возраст, лет', 'Рост', 'Тип сайта', 'Вес', 'Место', 'Итог'];
  const poolBy = new Map(arr(d.pool && d.pool.candidates).map(c => [c.domain, c]));
  const A = analysisOf(d);
  const compBy = A.compBy;
  const order = arr(d.ranking && d.ranking.order);
  const rankBy = new Map(arr(d.ranking && d.ranking.candidates).map(c => [c.domain, c]));
  const verdict = dom => {
    const c = compBy.get(dom), r = rankBy.get(dom);
    if (A.inAnalysis(dom)) return A.isAnchor(dom) ? 'в анализе, эталон' : 'в анализе';
    if (c && c.status === 'ok') return 'не взят: страницы для сравнения не сняты';
    if (c) return `не взят: ${clean(c.reason) || COMP_BAD_RU[c.status] || c.status}`;
    if (r && r.stop) return `не взят: ${clean(r.stop)}`;
    return 'не взят: не проверялся (лидеры уже набраны)';
  };
  const line = (dom, sources, r, p, extra) => {
    const serp = p && p.serp, ks = p && p.keyso;
    const age = r && num(r.age_years) !== null ? `${dec(r.age_years)}${AGE_RU[r.age_class] ? ` (${AGE_RU[r.age_class]})` : ''}` : '-';
    return [
      clean((p && p.domain_unicode) || (r && r.domain_unicode) || domainUnicode(dom)),
      sources.map(s => SRC_RU[s] || s).filter(Boolean).join(', ') || '-',
      serp ? pct(serp.share) : '-',
      ks ? intOr(ks.top10) : '-',
      ks ? intOr(ks.top50) : '-',
      ks ? intOr(ks.traffic) : '-',
      p ? intOr(p.iks) : '-',
      age,
      r ? GROWTH_RU[r.growth] || '-' : '-',
      r ? SITE_RU[r.site_type] || '-' : '-',
      r && num(r.weight) !== null ? dec(r.weight) : '-',
      ...extra,
    ];
  };
  const rows = [];
  let list;
  if (d.ranking) {
    // порядок ranking.order, затем остальные (стоп) по весу; до 30, но все взятые в анализ - в списке
    const rest = arr(d.ranking.candidates).map(c => c.domain).filter(x => !order.includes(x))
      .sort((a, b) => (num((rankBy.get(b) || {}).weight) ?? -1) - (num((rankBy.get(a) || {}).weight) ?? -1));
    list = [...order, ...rest];
    const keep = list.filter(A.inAnalysis);
    list = [...list.slice(0, 30), ...keep.filter(x => !list.slice(0, 30).includes(x))];
  } else list = [...compBy.keys()].slice(0, 30);
  for (const dom of list) {
    const r = rankBy.get(dom) || null, p = poolBy.get(dom) || null, c = compBy.get(dom) || null;
    const sources = p ? arr(p.sources) : r ? arr(r.sources) : c ? [c.source] : [];
    const place = order.indexOf(dom) >= 0 ? order.indexOf(dom) + 1 : c && num(c.rank) !== null ? c.rank : '-';
    const v = verdict(dom);
    rows.push({ kind: 'row', cells: line(dom, sources, r, p, [place, v]), fill: /^в анализе/.test(v) ? 'prio_high' : null });
  }
  // ваш сайт: метрики из pool.own (если скаут их снял)
  // домен - общей нормализацией domains.mjs (кириллица -> punycode, как pool.own[].domain); в таблице - юникод-форма
  const ownDom = normDomain(d.cfg.site_url) || normDomain((arr(d.pool && d.pool.own)[0] || {}).domain);
  if (ownDom) {
    const p = arr(d.pool && d.pool.own).find(o => normDomain(o && o.domain) === ownDom) || null;
    rows.push({ kind: 'row', cells: line(ownDom, [], null, p, ['-', 'ваш сайт']), fill: 'own' });
  }
  if (!rows.length) rows.push({ kind: 'note', cells: ['данных отбора нет (задача до этапа отбора)', ...Array(header.length - 1).fill('')] });
  return { name: 'Отбор конкурентов', header, widths: [26, 18, 12, 9, 9, 10, 8, 14, 10, 12, 8, 8, 36], rows };
}

// «В прототипе» для строки типа: все страницы типа (по scope) - блок to на странице, заглушка, текст в prototype.index.json
function typeProto(d, row, kfc, rowKind) {
  if (!kfc) return { cell: 'нет', note: row.level === 'optional' ? '' : 'не покрыто типом страницы' };
  if (kfc.to === 'skip') return { cell: `нет: ${clean(kfc.why) || 'причина не указана'}`, note: '' };
  if (kfc.to === 'shell') {
    const it = arr(d.modules && d.modules.shell && d.modules.shell.items).find(x => x.id === row.id);
    return { cell: it ? stateRu(it.state, it.reason) : 'в оболочке сайта', note: '' };
  }
  if (!d.modules) return { cell: 'прототип не собран', note: '' };
  const { type, subject } = scopeType(row.scope);
  const pages = d.live.filter(p => p.type === type && (!subject || clean(p.subject) === clean(subject)));
  if (!pages.length) return { cell: 'нет страниц типа', note: '' };
  const res = pages.map(p => {
    const brief = rjs(P('work', 'pages', p.slug, 'brief.json'));
    if (!brief) return { slug: p.slug, st: 'nobrief' };
    if (arr(brief.stubs).some(s => s.type === kfc.to)) return { slug: p.slug, st: 'stub' };
    const blk = arr(brief.blocks).find(b => b.type === kfc.to);
    if (!blk) {
      const r = (d.br.pages || {})[p.slug] || {};
      const why = arr(r.excluded).includes(kfc.to) ? 'снят стратегом' : (arr(r.dropped).concat(arr(r.dropped_repeat)).find(x => (typeof x === 'string' ? x : x.block) === kfc.to) ? 'выпал без фактов' : 'нет в брифе');
      return { slug: p.slug, st: 'absent', why };
    }
    const text = d.index && d.index[p.slug] && d.index[p.slug][blk.block_id];
    return { slug: p.slug, st: clean(text) ? 'ok' : 'unwritten', name: blk.name || kfc.to };
  });
  const k = res.filter(x => x.st === 'ok').length, m = res.length;
  const WHY = { stub: 'нужны данные', unwritten: 'не написано', nobrief: 'нет брифа', absent: '' };
  const others = res.filter(x => x.st !== 'ok').map(x => `${x.slug}: ${x.why || WHY[x.st]}`);
  const blockName = (res.find(x => x.name) || {}).name || kfc.to;
  if (res.some(x => x.st === 'stub')) return { cell: 'нужны данные', note: `заглушка: ${res.filter(x => x.st === 'stub').map(x => x.slug).join(', ')}` };
  if (k === m) return { cell: rowKind === 'block' ? 'есть' : `есть (элементом блока «${blockName}»)`, note: '' };
  if (!k && res.every(x => x.st === 'unwritten')) return { cell: 'не написано', note: '' };
  if (!k) return { cell: 'нет', note: others.join('; ') };
  return { cell: `есть на ${k} из ${m}`, note: others.join('; ') };
}

function sheetCompare(d) {
  const m = d.matrix;
  // domains - объекты {domain, role} (схема kf-matrix); строка - конкурент, сайт заказчика - role own (или поле own)
  const doms = arr(m.domains).map(x => (typeof x === 'string' ? { domain: x, role: 'competitor' } : x)).filter(x => x && x.domain);
  const comps = doms.filter(x => x.role !== 'own').map(x => x.domain);
  const own = doms.find(x => x.role === 'own') || (typeof m.own === 'string' && m.own ? { domain: m.own, role: 'own' } : null);
  const uni = new Map();
  for (const c of arr(d.ranking && d.ranking.candidates)) if (c.domain_unicode) uni.set(c.domain, c.domain_unicode);
  for (const c of arr(d.pool && d.pool.candidates)) if (c.domain_unicode) uni.set(c.domain, c.domain_unicode);
  const header = ['Элемент', ...comps.map(x => clean(uni.get(x) || x)), ...(own ? ['Ваш сайт сейчас'] : []), 'Охват', 'Решение', 'В прототипе', 'Комментарий'];
  const width = header.length;
  const sums = m.sums || {};
  const rows = [{ kind: 'sum', cells: ['Сумма элементов', ...comps.map(x => num(sums[x]) ?? 0), ...(own ? [num(sums[own.domain]) ?? 0] : []), '', '', '', ''] }];
  const modItems = arr(d.modules && d.modules.shell && d.modules.shell.items);
  const ptCache = new Map();
  const coverageOf = (type, id) => {
    if (!ptCache.has(type)) ptCache.set(type, rjs(P('work', 'page-types', `${type}.json`)));
    const pt = ptCache.get(type);
    return arr(pt && pt.kf_coverage).find(c => c.el === id) || null;
  };
  const line = r => {
    const vals = comps.map(x => val((r.values || {})[x]));
    const ownCell = own ? [val(r.own)] : [];
    let proto, note = [];
    if (r.visible === false) {
      // невидимые (Schema.org и т.п.): прототип их не показывает; в комментарии - к чему строка относится
      proto = 'для разработчика (в прототипе не показывается)';
      note.push(r.scope === 'site' ? `весь сайт, ${zoneRu(r.zone)}` : scopeTitle(r.scope));
    } else if (r.scope === 'site') {
      // только пара id + zone: телефон подвала не берет состояние телефона шапки
      const it = modItems.find(x => x.id === r.id && x.zone === r.zone);
      // «по желанию» в оболочку не идет; нет ключа shell - прототип собран без shell.json
      proto = it ? stateRu(it.state, it.reason) : !d.modules ? 'прототип не собран' : !d.modules.shell ? 'прототип собран без оболочки' : r.level === 'optional' ? 'нет (по желанию)' : 'нет';
      if (!it && d.modules && d.modules.shell && r.level !== 'optional') note.push('в оболочку прототипа не вошел');
    } else {
      const tp = typeProto(d, r, coverageOf(scopeType(r.scope).type, r.id), r.kind);
      proto = tp.cell;
      if (tp.note) note.push(tp.note);
    }
    if (r.x) note.push('элемент ниши: нашли у лидеров, в общем словаре его нет');
    note.push(...arr(r.notes).map(clean).filter(Boolean));
    if (r.needs_hint && /нужны данные/.test(proto)) note.push(`нужно от вас: ${clean(r.needs_hint)}`);
    const decision = `${LEVEL_RU[r.level] || r.level || '-'}${r.already ? '; уже есть' : ''}`;
    const cells = [elName(r.name || r.id), ...vals, ...ownCell, `${num(r.n) ?? 0} из ${num(r.N) ?? 0}`, decision, proto, note.join('; ')];
    const italic = cells.map((c, i) => (c === '?' ? i : -1)).filter(i => i >= 0);
    return { kind: 'row', cells, fill: r.level === 'must' ? 'prio_high' : r.level === 'recommended' ? 'prio_medium' : null, already: !!r.already, decisionCol: 1 + comps.length + (own ? 1 : 0) + 1, italic };
  };
  const sortRows = list => list.map((r, i) => [r, i]).sort((a, b) => (LEVEL_RANK[a[0].level] ?? 9) - (LEVEL_RANK[b[0].level] ?? 9) || (num(b[0].n) ?? 0) - (num(a[0].n) ?? 0) || a[1] - b[1]).map(x => x[0]);
  const group = (title, list) => {
    if (!list.length) return;
    rows.push({ kind: 'group', cells: [title, ...Array(width - 1).fill('')] });
    for (const r of sortRows(list)) rows.push(line(r));
  };
  const all = arr(m.rows).filter(r => r && r.id);
  const hidden = all.filter(r => r.visible === false);
  const shown = all.filter(r => r.visible !== false);
  for (const z of ['header', 'footer', 'mobile', 'fixed']) group(ZONE_GROUP[z], shown.filter(r => r.scope === 'site' && r.zone === z));
  // типы - в порядке карты (первое появление типа), затем scope, которых в карте нет
  const scopes = [...new Set(shown.filter(r => r.scope !== 'site').map(r => r.scope))];
  const typeOrder = [...new Set(d.live.map(p => p.type))];
  const pos = s => { const i = typeOrder.indexOf(scopeType(s).type); return i < 0 ? 999 : i; };
  scopes.map((s, i) => [s, i]).sort((a, b) => pos(a[0]) - pos(b[0]) || a[1] - b[1]).forEach(([s]) => group(scopeTitle(s), shown.filter(r => r.scope === s)));
  group('Для разработчика', hidden);
  return { name: 'Сравнение', header, widths: [34, ...comps.map(() => 14), ...(own ? [14] : []), 9, 18, 22, 48], rows, frozenX: 1 };
}

function sheetLimits(d) {
  const lines = [];
  const add = (what, where) => { const k = `${clean(what)}|${clean(where)}`; if (!lines.some(l => `${l[0]}|${l[1]}` === k)) lines.push([clean(what), clean(where)]); };
  const st = d.status || {};
  if (st.status === 'no_chrome' || d.matrix.mode === 'text') add('нет Chrome и Edge: элементы сняты по тексту страниц, без кадров', 'шапка и мобильная версия - не выше «?»');
  if (d.pool && d.pool.region && d.pool.region.city_not_in_keyso) add('рынок оценен по выдаче без Keys.so', `города нет в базе Keys.so${d.pool.region.city ? `: ${clean(d.pool.region.city)}` : ''}`);
  const byStatus = {};
  for (const p of arr(d.capture && d.capture.pages)) if (p && p.status && p.status !== 'ok') (byStatus[p.status] ??= []).push(`${p.domain}${p.name ? `/${p.name}` : ''}${p.reason ? ` (${clean(p.reason)})` : ''}`);
  const CAP_RU = { antibot: 'страница проверки (антибот): не снято', error: 'ошибка снятия страницы', skipped: 'страница не снята' };
  for (const [s, list] of Object.entries(byStatus)) add(CAP_RU[s] || `страница не снята (${s})`, list.slice(0, 12).join(', ') + (list.length > 12 ? ` и еще ${list.length - 12}` : ''));
  const scopes = new Map(arr(d.matrix.scopes).map(s => [s.scope, s]));
  const types = [...new Set(d.live.map(p => p.type))];
  for (const t of types) {
    const hit = [...scopes.values()].filter(s => scopeType(s.scope).type === t);
    if (scopes.size && (!hit.length || hit.every(s => !num(s.N)))) add(`тип «${TYPE_RU[t] || t}»: у лидеров страниц этого типа не снято`, 'сравнение по типу не проводилось');
  }
  const q = arr(d.matrix.rows).filter(r => Object.values(r.values || {}).includes('?'));
  if (q.length) add(`«?» - не удалось проверить уверенно: строк ${q.length}`, q.slice(0, 10).map(r => elName(r.name || r.id)).join(', ') + (q.length > 10 ? ` и еще ${q.length - 10}` : ''));
  const A = analysisOf(d);
  if (d.comp && A.anchorsPlanned && !A.anchorGood) add('эталон (сильный давний сайт) в сравнение не попал', clean(d.comp.method).slice(0, 200));
  for (const w of arr(d.ranking && d.ranking.warnings)) add(w, 'отбор');
  for (const l of arr(d.matrix.limits)) add(l, 'сравнение');
  const rows = lines.length ? lines.map(cells => ({ kind: 'row', cells })) : [{ kind: 'row', cells: ['ограничений нет', ''] }];
  return { name: 'Ограничения', header: ['Что не проверено', 'Где'], widths: [70, 70], rows };
}

export function buildModel() {
  const d = readDoc();
  if (!d.matrix || !Array.isArray(d.matrix.rows)) return null;
  return { d, sheets: [sheetReadme(d), sheetSelection(d), sheetCompare(d), sheetLimits(d)] };
}

// ---------------------------------------------------------------- запись xlsx (стиль .claude/scripts/build-structure-xlsx.mjs)
const COLORS = { header_bg: 'FF2F5496', header_text: 'FFFFFFFF', border: 'FFD9D9D9', prio_high: 'FFE2EFDA', prio_medium: 'FFFFF2CC', own: 'FFD9E2D5', group: 'FFDCE6F1', text: 'FF000000' };
const FONT_FAMILY = 'Arial', FONT_SIZE = 10;
const thin = { style: 'thin', color: { argb: COLORS.border } };
const thinBorder = { top: thin, left: thin, bottom: thin, right: thin };
const fill = argb => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
async function writeXlsx(sheets, file) {
  const { loadDep } = await import('./deps.mjs');
  const ExcelJS = await loadDep('exceljs');
  if (!ExcelJS || !ExcelJS.Workbook) throw new Error('exceljs не найден: npm install в корне проекта');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'seo-pipeline /site-tekst';
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name);
    ws.addRow(s.header);
    s.header.forEach((_, i) => {
      const c = ws.getCell(1, i + 1);
      c.font = { name: FONT_FAMILY, size: FONT_SIZE + 1, bold: true, color: { argb: COLORS.header_text } };
      c.fill = fill(COLORS.header_bg);
      c.border = thinBorder;
      c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    });
    ws.getRow(1).height = 30;
    s.rows.forEach((r, k) => {
      const n = k + 2;
      ws.addRow(r.cells.map(v => (v === '' ? null : v)));
      for (let i = 1; i <= s.header.length; i++) {
        const c = ws.getCell(n, i);
        c.font = { name: FONT_FAMILY, size: FONT_SIZE, bold: r.kind === 'group' || r.kind === 'sum' || (i === 1 && s.name === 'Как читать'), italic: arr(r.italic).includes(i - 1) || r.kind === 'note' };
        c.border = thinBorder;
        c.alignment = { vertical: 'top', wrapText: true, ...(i > 1 && s.name === 'Сравнение' && r.kind !== 'group' ? { horizontal: i <= s.header.length - 3 ? 'center' : 'left' } : {}) };
        if (r.kind === 'group') c.fill = fill(COLORS.group);
        else if (r.fill && COLORS[r.fill]) c.fill = fill(COLORS[r.fill]);
      }
      if (r.kind === 'group') ws.mergeCells(n, 1, n, s.header.length);
      if (r.already && r.decisionCol) ws.getCell(n, r.decisionCol + 1).fill = fill(COLORS.own);
    });
    (s.widths || []).forEach((w, i) => { ws.getColumn(i + 1).width = w; });
    ws.views = [{ state: 'frozen', xSplit: s.frozenX || 0, ySplit: 1 }];
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await wb.xlsx.writeFile(file);
}

// ---------------------------------------------------------------- --record
function record(a) {
  // правило включения: нет матрицы - таблица не строится и kf-publish.json не пишется (даже если остался старый meta)
  const stage = kfStage();
  if (!stage.matrix) { console.log(JSON.stringify({ path: null, status: null, skipped: `анализ КФ не проводился: ${stage.reason}` })); return; }
  const meta = rjs(P(...META_REL.split('/')));
  if (!meta || !meta.data_sha) { console.error('нет work/output/kf-xlsx.meta.json: сначала node scripts/build-kf-xlsx.mjs'); process.exit(1); }
  const status = a.status;
  if (!['published', 'skipped'].includes(status)) { console.error('usage: build-kf-xlsx.mjs --record --status published|skipped [--file-id <id>] [--url <url>] [--reason <текст>]'); process.exit(2); }
  if (status === 'published' && !a['file-id'] && !a.url) { console.error('--status published: нужен --file-id или --url'); process.exit(2); }
  const file = P(...PUBLISH_REL.split('/'));
  const prev = rjs(file);
  const revisions = arr(prev && prev.revisions).map(x => ({ ...x }));
  const prevPub = prev && prev.status === 'published' && (prev.file_id || prev.url);
  const rev = (x, renamed) => ({ file_id: x.file_id || null, url: x.url || null, data_sha: x.data_sha || null, published_at: x.published_at || null, renamed });
  let out, note = null;
  if (status === 'published') {
    const same = prevPub && prev.data_sha === meta.data_sha && (!a['file-id'] || a['file-id'] === prev.file_id) && (!a.url || a.url === prev.url);
    if (same) out = { ...prev, name: meta.drive_name, reason: null, revisions };
    else {
      const nf = a['file-id'] || null, nu = a.url || null;
      const other = x => (x.file_id || null) !== nf || (x.url || null) !== nu;
      if (prevPub && other(prev)) revisions.push(rev(prev, '(устарело)'));
      // прежняя публикация, отложенная пропуском (renamed null), с новой публикацией тоже переименована (prev_url)
      for (const x of revisions) if (x.renamed === null && other(x)) x.renamed = '(устарело)';
      out = { status, file_id: nf, url: nu, name: meta.drive_name, data_sha: meta.data_sha, published_at: nowIso(), reason: null, revisions };
    }
  } else if (prevPub && prev.data_sha === meta.data_sha) {
    // таблица не менялась с публикации - публикация действует, пропуск ее не затирает
    out = prev;
    note = 'публикация актуальна (тот же data_sha), запись прежняя';
  } else {
    // пропуск публикации измененной таблицы: прежняя ссылка уходит в revisions (renamed null - еще не переименована)
    if (prevPub && !revisions.some(x => x.file_id === prev.file_id && x.url === prev.url)) revisions.push(rev(prev, null));
    out = { status, file_id: null, url: null, name: meta.drive_name, data_sha: meta.data_sha, published_at: null, reason: clean(a.reason) || 'причина не указана', revisions };
  }
  if (!note) writeJson(file, out);
  console.log(JSON.stringify({ path: PUBLISH_REL, status: out.status, data_sha: out.data_sha, revisions: arr(out.revisions).length, ...(note ? { note } : {}) }));
}

async function main() {
  const a = argv({ record: 'bool' });
  if (a.record) return record(a);
  const model = buildModel();
  if (!model) {
    const reason = kfStage().reason;
    console.log(JSON.stringify({ path: null, drive_name: null, data_sha: null, need_publish: false, skipped: `анализ КФ не проводился: ${reason}` }));
    return;
  }
  const { d, sheets } = model;
  const sha = dataSha(sheets);
  const name = driveName(d.cfg.company || d.cfg.slug);
  await writeXlsx(sheets, P(...XLSX_REL.split('/')));
  writeJson(P(...META_REL.split('/')), { generated_at: nowIso(), path: XLSX_REL, drive_name: name, data_sha: sha, sheets: sheets.map(s => ({ name: s.name, rows: s.rows.length })) });
  const pub = rjs(P(...PUBLISH_REL.split('/')));
  const need = !(pub && pub.status === 'published' && pub.data_sha === sha);
  // прежний файл для переименования «(устарело)»: действующая публикация или отложенная пропуском (revisions, renamed null)
  const prev = pub && pub.status === 'published' ? pub : arr(pub && pub.revisions).filter(x => x && x.renamed === null && (x.url || x.file_id)).at(-1) || null;
  console.log(JSON.stringify({ path: XLSX_REL, drive_name: name, data_sha: sha, need_publish: need, prev_url: prev ? prev.url || null : null, prev_file_id: prev ? prev.file_id || null : null }));
}

const real = p => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
if (process.argv[1] && real(process.argv[1]) === real(fileURLToPath(import.meta.url))) {
  main().catch(e => { console.error(`build-kf-xlsx: ${e.message}`); process.exit(1); });
}
