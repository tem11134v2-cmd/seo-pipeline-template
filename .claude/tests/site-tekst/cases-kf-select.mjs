// Тесты пакета A программы КФ/КНДР (05.10): отбор лидеров фазы 2 kit /site-tekst. Запуск:
//   node .claude/tests/site-tekst/cases-kf-select.mjs      код выхода 0 - все прошли.
// Разделы:
//   1. rank-competitors --queries: порядок (фразы, маркеры по уровню и порядку карты, затем subject), без product, шаблонов,
//      skip и дублей, предел serp_queries_max, детерминизм; без фраз и карты - queries [] и код 0;
//   2. формула ранжирования: лог-шкала от лидера, пропуски метрик и coverage (с исключением «нет только Keys.so»), тип
//      сайта, молодой против старого на числах Goldax 05.10, эталон old при сильнейших young, все unknown, без метрик,
//      рост it50, регион вне баз Keys.so, федеральный рынок, ratio не применяется, независимость порядка двух сильных от слабого кандидата;
//   3. домены: канон (punycode, кириллица, www, порт, точка), --merge-pool сводит дубли и сливает sources, клиент - в own,
//      поддомены стоп-листа и клиента, исключенные структурой (затравка анализа побеждает), поддомен кандидата;
//   4. --merge-pool: позиции выдачи и доля, порог кандидата, need_msk, ошибки источника снимаются повтором, whois
//      DD.MM.YYYY, not_found не затирает метрики, неверный source - код 1; --prelim; --check fresh/stale; домены клиента
//      (serp, lookup, competitors_from); узкая ниша - источники исчерпаны (sources_done) -> fresh;
//   5. import-project: niche.yandex_id/keyso_base/site_kind, копия structure-competitors.json и раздел отпечатка, без
//      структуры - как раньше, старая задача без раздела - не изменение для --facts-only; parseCompetitor из domains.mjs;
//   6. regions.mjs - литералы CITIES/FEDERAL совпадают с .claude/scripts/validate-project-input.mjs, parseRegion;
//   7. стоп-лист kit (эталонный список, предел 40, без ниши), config competitors.selection = умолчания скрипта, схема
//      competitors (source structure/keyso, новые поля);
//   8. промты скаута и верификатора: ranking без своей выдачи, target 5 при max_domains 8, CDP раньше браузера,
//      ToolSearch по словам; стиль, UUID и ниша новых файлов пакета; бюджеты 3500 и 5200.
// Все во временных папках (os.tmpdir()), без сети и данных клиентов.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');
const TPL = path.resolve(HERE, '..', '..', 'skills', 'site-tekst', 'kit');
const { validate } = await import(pathToFileURL(path.join(TPL, 'scripts', 'lib.mjs')).href);
const R = await import(pathToFileURL(path.join(TPL, 'scripts', 'rank-competitors.mjs')).href);
const D = await import(pathToFileURL(path.join(TPL, 'scripts', 'domains.mjs')).href);
const RG = await import(pathToFileURL(path.join(TPL, 'scripts', 'regions.mjs')).href);

let pass = 0, fail = 0;
const failures = [], notes = [];
function check(name, ok, detail = '') {
  if (ok) pass++;
  else { fail++; failures.push(`FAIL ${name}${detail ? ': ' + String(detail).slice(0, 700) : ''}`); }
}
const noBom = s => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s);
const rj = f => JSON.parse(noBom(fs.readFileSync(f, 'utf8')));
const wj = (f, o) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(o, null, 2) + '\n'); };
const read = rel => noBom(fs.readFileSync(path.join(TPL, rel), 'utf8'));
const SCHEMAS = {};
const schemaErrors = (name, data) => validate(SCHEMAS[name] ??= rj(path.join(TPL, 'schemas', `${name}.schema.json`)), data);
function run(cwd, args) {
  const r = spawnSync(process.execPath, args, { cwd, encoding: 'utf8', timeout: 120000 });
  let json = null; try { json = JSON.parse(r.stdout); } catch { json = null; }
  return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '', out: (r.stdout || '') + (r.stderr || ''), json };
}
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cases-kf-select-'));
function mkProject(name, patchCfg) {
  const dir = path.join(tmpRoot, name);
  for (const d of ['scripts', 'rules', 'schemas', 'config']) fs.cpSync(path.join(TPL, d), path.join(dir, d), { recursive: true });
  if (patchCfg) { const f = path.join(dir, 'config', 'project.json'); const c = rj(f); patchCfg(c); wj(f, c); }
  return dir;
}
const W = (dir, ...p) => path.join(dir, 'work', ...p);
const RANK = 'scripts/rank-competitors.mjs';
const PRM = R.paramsOf({});
const r2x = x => Math.round(x * 100) / 100;
const cand = (domain, o = {}) => ({ domain, domain_unicode: domain, sources: ['analysis'], serp: null, keyso: null, keyso_status: 'none', history: null, iks: null, created: null, ...o });
const poolOf = (candidates, region = { keyso_base: 'msk', yandex_id: 213, city_not_in_keyso: false }) => ({ generated_at: '2026-10-05 10:00:00', input_sha: 'abcdef0123456789', region, queries: [], candidates, rejected: [], errors: [] });
const ctxOf = (o = {}) => ({ params: PRM, own: [], stoplist: [], structure: null, siteKind: '', warnings: [], region: { keyso_base: 'msk', yandex_id: 213 }, ...o });
const byDom = (rk, d) => rk.candidates.find(c => c.domain === d);
const log100 = (x, max) => Math.log1p(x) / Math.log1p(max) * 100;
const near = (a, b, eps = 0.06) => a != null && Math.abs(a - b) <= eps;

try {
  // ================================================================== 1. --queries
  {
    const dir = mkProject('queries', c => { c.sources.key_phrases = ['ремонт техники на дому', 'Ремонт техники на дому ']; });
    wj(W(dir, 'sitemap.json'), { source: 't', page_types: [], pages: [
      { slug: 'home', url: '/', type: 'home', subject: 'Главная', level: 0, status: 'planned' },
      { slug: 's2', url: '/s2', type: 'service', subject: 'Услуга два', level: 1, status: 'planned', key_phrase: 'услуга два цена' },
      { slug: 'hub', url: '/hub', type: 'hub', subject: 'Каталог', level: 0, status: 'planned', key_phrase: 'каталог техники' },
      { slug: 'c1', url: '/c1', type: 'category', subject: 'Раздел один', level: 1, status: 'planned', marker: 'раздел один купить' },
      { slug: 'p1', url: '/p1', type: 'product', subject: 'Товар', level: 2, status: 'planned', key_phrase: 'товар купить' },
      { slug: 'tpl', url: '/x-slug', type: 'category', subject: 'Шаблон', level: 1, status: 'planned', template: true, key_phrase: 'шаблон фраза' },
      { slug: 'skip', url: '/skip', type: 'service', subject: 'Снята', level: 0, status: 'skip', key_phrase: 'снятая фраза' },
      { slug: 's1', url: '/s1', type: 'service', subject: 'Каталог', level: 0, status: 'planned' },
    ] });
    const a = run(dir, [RANK, '--queries']), b = run(dir, [RANK, '--queries']);
    // subject «Каталог» - слово навигации, не запрос ниши: в выдачу не идет (NAV_WORDS)
    const want = ['ремонт техники на дому', 'каталог техники', 'услуга два цена', 'раздел один купить', 'Услуга два', 'Раздел один'];
    check('--queries: фразы, маркеры по уровню и порядку карты, затем subject (без слов навигации); без product, шаблонов, skip и дублей', a.code === 0 && JSON.stringify(a.json?.queries) === JSON.stringify(want), a.out);
    check('--queries: детерминированы', a.stdout === b.stdout);
    check('--queries: регион по умолчанию - Москва 213, msk', a.json?.region?.yandex_id === 213 && a.json.region.keyso_base === 'msk' && a.json.target === 5, JSON.stringify(a.json?.region));
    check('computeQueries: предел serp_queries_max', R.computeQueries({ sources: { key_phrases: ['а1', 'а2', 'а3', 'а4'] } }, null, 2).length === 2);
    {
      // запасной вход doc: фраз нет - маркерные и целевые запросы из строк анализа; subject - до двоеточия, без бренда, до 6 слов
      const text = '**Маркерные запросы для расширения:** ремонт техники на дому, мастер по ремонту \\(выезд\\), ремонт\n**Целевые запросы:** срочный ремонт холодильника; Альфа сервис ремонт\nпрочая строка: а, б';
      check('analysisQueries: дословно, 2-6 слов, без пометок в скобках, без одиночных слов', JSON.stringify(R.analysisQueries(text)) === JSON.stringify(['ремонт техники на дому', 'мастер по ремонту', 'срочный ремонт холодильника', 'альфа сервис ремонт']), JSON.stringify(R.analysisQueries(text)));
      const sm = { pages: [
        { slug: 'a', type: 'service', subject: 'Ремонт стиральных машин: все услуги по ремонту', level: 1, status: 'planned' },
        { slug: 'b', type: 'service', subject: 'Курсы мастеров Альфасервиса', level: 1, status: 'planned' },
        { slug: 'c', type: 'service', subject: 'Очень длинное название страницы из восьми слов подряд тут', level: 1, status: 'planned' },
      ] };
      const q = R.computeQueries({ company: 'Альфасервис', sources: { mode: 'doc', key_phrases: [] } }, sm, 15, text);
      check('computeQueries doc: сначала запросы анализа, subject до двоеточия, без бренда и длинных', JSON.stringify(q) === JSON.stringify(['ремонт техники на дому', 'мастер по ремонту', 'срочный ремонт холодильника', 'альфа сервис ремонт', 'Ремонт стиральных машин']), JSON.stringify(q));
      check('computeQueries: при key_phrases запросы анализа не берутся', !R.computeQueries({ sources: { key_phrases: ['фраза один'] } }, null, 15, text).includes('ремонт техники на дому'));
    }
    const e = mkProject('queries-empty');
    const r = run(e, [RANK, '--queries']);
    check('--queries без фраз и карты: код 0, queries []', r.code === 0 && Array.isArray(r.json?.queries) && r.json.queries.length === 0, r.out);
  }

  // ================================================================== 2. формула
  {
    // лог-шкала: одна метрика (ИКС), лидер 100, остальные - log1p(x)/log1p(max)
    const p1 = poolOf([cand('a.example', { iks: 1000 }), cand('b.example', { iks: 100 }), cand('c.example', { iks: 0 })]);
    const k1 = R.rankPool(p1, ctxOf());
    check('лог-шкала: лидер 100, второй log1p(100)/log1p(1000), ноль - 0', byDom(k1, 'a.example').weight === 100 && near(byDom(k1, 'b.example').weight, log100(100, 1000)) && byDom(k1, 'c.example').weight === 0, JSON.stringify(k1.candidates.map(c => [c.domain, c.weight])));
    check('ranking проходит схему kf-ranking', !schemaErrors('kf-ranking', k1).length, schemaErrors('kf-ranking', k1).join('; '));
    // max = 0 - метрика исключается для всех
    const k0 = R.rankPool(poolOf([cand('a.example', { iks: 0, serp: { top10: 1, share: 0.5 } }), cand('b.example', { iks: 0, serp: { top10: 0, share: 0 } })]), ctxOf());
    check('метрика с max 0 исключается для всех (в metrics_used только share)', JSON.stringify(byDom(k0, 'a.example').metrics_used) === '["share"]' && byDom(k0, 'a.example').coverage === 1, JSON.stringify(byDom(k0, 'a.example')));

    // пропуски: у b нет Keys.so (доля и ИКС есть) - без снижения; у c только доля - покрытие 3/7.5 = 0.4 -> x0.8
    const full = { serp: { top10: 4, share: 0.4 }, keyso: { top10: 500, top50: 1000, traffic: 5000, pages: 300 }, keyso_status: 'ok', iks: 400 };
    const p2 = poolOf([cand('a.example', full), cand('b.example', { serp: { top10: 2, share: 0.2 }, iks: 200, keyso_status: 'not_found' }), cand('c.example', { serp: { top10: 2, share: 0.2 } })]);
    const k2 = R.rankPool(p2, ctxOf());
    // трафик с весом 3: у b покрытие (3+1)/9,5 < 0,5, но нет только метрик Keys.so - без снижения
    const k2t = R.rankPool(p2, ctxOf({ params: R.paramsOf({ competitors: { selection: { weights: { traffic: 3 } } } }) }));
    const wb = (3 * log100(0.2, 0.4) + 1 * log100(200, 400)) / 4;
    const wc = log100(0.2, 0.4) * 0.8;
    check('пропуск метрик: вес по доступным метрикам, пропуски в reason', near(byDom(k2, 'b.example').weight, wb) && byDom(k2, 'b.example').coverage === 0.53 && /Keys.so: не найден/.test(byDom(k2, 'b.example').reason), JSON.stringify(byDom(k2, 'b.example')));
    check('покрытие ниже 0,5, но нет только метрик Keys.so (доля и ИКС есть) - без снижения', near(byDom(k2t, 'b.example').weight, wb) && byDom(k2t, 'b.example').coverage === 0.42 && /без снижения/.test(byDom(k2t, 'b.example').reason), JSON.stringify(byDom(k2t, 'b.example')));
    check('покрытие ниже 0,5 - W x coverage/0,5, причина в reason', near(byDom(k2, 'c.example').weight, wc) && byDom(k2, 'c.example').coverage === 0.4 && /вес x0.8/.test(byDom(k2, 'c.example').reason), JSON.stringify(byDom(k2, 'c.example')));
    check('ТОП-10/ТОП-50 - только при ТОП-50 от 50', byDom(k2, 'a.example').metrics_used.includes('ratio') && !R.rankPool(poolOf([cand('s.example', { keyso: { top10: 10, top50: 40 }, keyso_status: 'ok' }), cand('t.example', { keyso: { top10: 5, top50: 30 }, keyso_status: 'ok' })]), ctxOf()).candidates[0].metrics_used.includes('ratio'));

    // тип сайта
    const p3 = poolOf([cand('big.example', { iks: 100, keyso: { pages: 800, dr: 30 }, keyso_status: 'ok' }), cand('tiny.example', { iks: 100, keyso: { pages: 3 }, keyso_status: 'ok' }), cand('none.example', { iks: 100 })]);
    const k3 = R.rankPool(p3, ctxOf({ siteKind: 'multipage' }));
    // кандидаты фикстуры - затравка анализа: везде еще x1,25 (source_bonus)
    check('тип сайта: совпадение x1,15, несовпадение x0,85, unknown x1 (и x1,25 затравки)', byDom(k3, 'big.example').site_type === 'multipage_leader' && byDom(k3, 'big.example').effective === 143.75 && byDom(k3, 'tiny.example').site_type === 'landing' && byDom(k3, 'tiny.example').effective === 106.25 && byDom(k3, 'none.example').site_type === 'unknown' && byDom(k3, 'none.example').effective === 125, JSON.stringify(k3.candidates.map(c => [c.domain, c.site_type, c.effective])));
    check('тип сайта по таблице seo-base: 500+ и DR 25+, 50-499, 6-49, до 5; без DR при 500+ - medium', R.siteTypeOf({ pages: 500, dr: 25 }) === 'multipage_leader' && R.siteTypeOf({ pages: 600 }) === 'medium' && R.siteTypeOf({ pages: 50 }) === 'medium' && R.siteTypeOf({ pages: 6 }) === 'small' && R.siteTypeOf({ pages: 5 }) === 'landing' && R.siteTypeOf(null) === 'unknown');
    const k3l = R.rankPool(p3, ctxOf({ siteKind: 'landing' }));
    check('лендинг: landing/small совпадают', byDom(k3l, 'tiny.example').effective === 143.75 && byDom(k3l, 'big.example').effective === 106.25);

    // Goldax 05.10: top50, трафик, whois, ИКС (у nota-gold и fuzailov ИКС нет)
    const G = [['nota-gold.ru', 32973, 138200, '2010-10-22', null], ['fuzailov.ru', 2565, 6541, '2023-08-02', null], ['bendes.ru', 4073, 3810, '2013-05-20', 300], ['mkastom.ru', 1011, 579, '2023-03-24', 50], ['rings-master.ru', 171, 128, '2017-06-11', 260]];
    const pg = poolOf(G.map(([d, top50, traffic, created, iks]) => cand(d, { keyso: { top50, traffic }, keyso_status: 'ok', created, iks })));
    const kg = R.rankPool(pg, ctxOf());
    const ages = Object.fromEntries(kg.candidates.map(c => [c.domain, c.age_class]));
    check('Goldax: возраст - mkastom и fuzailov young, nota-gold и bendes old, rings-master mid', ages['mkastom.ru'] === 'young' && ages['fuzailov.ru'] === 'young' && ages['nota-gold.ru'] === 'old' && ages['bendes.ru'] === 'old' && ages['rings-master.ru'] === 'mid', JSON.stringify(ages));
    const fz = byDom(kg, 'fuzailov.ru'), bd = byDom(kg, 'bendes.ru');
    check('Goldax: молодой fuzailov (W 74,8) выше старого bendes (W 83,2): W_young >= W_old/1,15', fz.weight < bd.weight && fz.weight >= bd.weight / 1.15 && kg.order.indexOf('fuzailov.ru') < kg.order.indexOf('bendes.ru') && near(fz.weight, 74.8, 0.1) && near(bd.weight, 83.2, 0.1), JSON.stringify([fz, bd]));
    check('Goldax: порядок nota-gold, fuzailov, bendes, mkastom, rings-master; эталон nota-gold', JSON.stringify(kg.order) === JSON.stringify(['nota-gold.ru', 'fuzailov.ru', 'bendes.ru', 'mkastom.ru', 'rings-master.ru']) && kg.anchors[0] === 'nota-gold.ru' && JSON.stringify(kg.anchors) === JSON.stringify(['nota-gold.ru', 'bendes.ru', 'rings-master.ru']) && byDom(kg, 'nota-gold.ru').anchor === true && byDom(kg, 'fuzailov.ru').anchor === false, JSON.stringify([kg.order, kg.anchors]));
    check('Goldax: возраст от даты pool (05.10.2026): fuzailov 3,2 года, nota-gold 16', byDom(kg, 'fuzailov.ru').age_years === 3.2 && byDom(kg, 'nota-gold.ru').age_years === 16);
    // молодой встает выше старого ровно при W_young >= W_old / 1,15
    const edge = (wy) => { const k = R.rankPool(poolOf([cand('old.example', { iks: 1000, created: '2000-01-01' }), cand('young.example', { iks: Math.round(Math.expm1(Math.log1p(1000) * wy / 100)), created: '2024-01-01' })]), ctxOf()); return k.order[0]; };
    check('молодой выше старого при W >= W_old/1,15 и ниже при меньшем', edge(88) === 'young.example' && edge(85) === 'old.example');

    // эталон: пятеро сильнейших - young, старый шестой -> на место target (5)
    const six = [1000, 900, 800, 700, 600].map((x, i) => cand(`y${i}.example`, { iks: x, created: '2024-01-01' }));
    const k5 = R.rankPool(poolOf([...six, cand('old.example', { iks: 300, created: '2001-01-01' }), cand('mid.example', { iks: 200, created: '2016-01-01' })]), ctxOf());
    check('эталон old при сильнейших young: поднят на место target, остальные сдвинуты', k5.order[4] === 'old.example' && k5.order[5] === 'y4.example' && JSON.stringify(k5.anchors) === JSON.stringify(['old.example', 'mid.example']) && /эталон поднят на место 5/.test(byDom(k5, 'old.example').reason), JSON.stringify(k5.order));
    const k5b = R.rankPool(poolOf([cand('old.example', { iks: 1000, created: '2001-01-01' }), ...[400, 300, 200, 100, 50, 900].map((x, i) => cand(`z${i}.example`, { iks: x, created: '2024-01-01' }))]), ctxOf());
    check('эталон уже в первых target - порядок по E, без подъема', k5b.order.indexOf('old.example') === 1 && k5b.order[0] === 'z5.example' && !/эталон поднят/.test(byDom(k5b, 'old.example').reason), JSON.stringify(k5b.order));
    // все unknown
    const ku = R.rankPool(poolOf([cand('a.example', { iks: 10 }), cand('b.example', { iks: 20 })]), ctxOf());
    check('все без возраста: anchors - unknown по весу, предупреждение «эталон без подтвержденного возраста»', JSON.stringify(ku.anchors) === JSON.stringify(['b.example', 'a.example']) && ku.warnings.includes('эталон без подтвержденного возраста'), JSON.stringify(ku));
    // без метрик
    const kn = R.rankPool(poolOf([cand('s.example', { sources: ['serp'] }), cand('k.example', { sources: ['keyso'] }), cand('st.example', { sources: ['structure'] }), cand('a.example', { sources: ['analysis'] }), cand('as.example', { sources: ['analysis', 'serp'] })]), ctxOf());
    check('без метрик: W null, порядок по источникам (analysis+serp, analysis, structure, keyso, serp), предупреждение', kn.candidates.every(c => c.weight === null && c.effective === null) && JSON.stringify(kn.order) === JSON.stringify(['as.example', 'a.example', 'st.example', 'k.example', 's.example']) && kn.warnings.some(w => /отбор без метрик/.test(w)), JSON.stringify([kn.order, kn.warnings]));
    // рост it50
    const kr = R.rankPool(poolOf([cand('up.example', { iks: 100, history: { it50_now: 130, it50_12m: 100 } }), cand('flat.example', { iks: 100, history: { it50_now: 110, it50_12m: 100 } }), cand('down.example', { iks: 100, history: { it50_now: 70, it50_12m: 100 } })]), ctxOf());
    check('рост it50 от 20% - x1,05, падение - x0,95, иначе flat (и x1,25 затравки)', byDom(kr, 'up.example').growth === 'up' && byDom(kr, 'up.example').effective === 131.25 && byDom(kr, 'flat.example').growth === 'flat' && byDom(kr, 'flat.example').effective === 125 && byDom(kr, 'down.example').effective === 118.75);
    // затравка анализа и структуры x1,25; кандидат Keys.so без попаданий в ТОП-10 выдачи ниши - стоп, затравка - нет
    {
      const pq = { ...poolOf([cand('seed.example', { iks: 100 }), cand('serp.example', { sources: ['serp'], iks: 100, serp: { top1: 0, top3: 0, top5: 1, top10: 2, queries: 4, share: 0.5 } }), cand('ks.example', { sources: ['keyso'], iks: 900, serp: { top1: 0, top3: 0, top5: 0, top10: 0, queries: 4, share: 0 } }), cand('seed0.example', { iks: 50, serp: { top1: 0, top3: 0, top5: 0, top10: 0, queries: 4, share: 0 } })]), queries: ['а б', 'в г', 'д е', 'ж з'] };
      const kq = R.rankPool(pq, ctxOf());
      check('нет в выдаче ниши: кандидат Keys.so - стоп, затравка анализа без попаданий - в работе; затравка x1,25', /нет в выдаче ниши/.test(byDom(kq, 'ks.example').stop) && !byDom(kq, 'seed0.example').stop && byDom(kq, 'seed.example').effective === r2x(byDom(kq, 'seed.example').weight * 1.25) && byDom(kq, 'serp.example').effective === byDom(kq, 'serp.example').weight, JSON.stringify(kq.candidates.map(c => [c.domain, c.stop, c.weight, c.effective])));
    }
    // регион вне баз Keys.so: метрики Keys.so не в W, предупреждение, равенство - по трафику
    const pnk = poolOf([cand('a.example', { serp: { top10: 2, share: 0.2 }, keyso: { top10: 10, top50: 100, traffic: 50 }, keyso_status: 'ok' }), cand('b.example', { serp: { top10: 2, share: 0.2 }, keyso: { top10: 900, top50: 9000, traffic: 9000 }, keyso_status: 'ok' })], { keyso_base: 'msk', yandex_id: 15, city_not_in_keyso: true });
    const knk = R.rankPool(pnk, ctxOf());
    check('регион вне баз Keys.so: W только по выдаче, равенство - по трафику Keys.so, предупреждение', byDom(knk, 'a.example').weight === byDom(knk, 'b.example').weight && knk.order[0] === 'b.example' && knk.warnings.includes('рынок оценен по выдаче без Keys.so (регион вне баз Keys.so)') && JSON.stringify(byDom(knk, 'a.example').metrics_used) === '["share"]', JSON.stringify(knk));
    // федеральный рынок (вся Россия): база msk, метрики Keys.so в весе (city_not_in_keyso у parseRegion - не помеха)
    const pfd = poolOf(pnk.candidates, { keyso_base: 'msk', yandex_id: 213, federal: true, city_not_in_keyso: true, yandex_fallback_213: true });
    const kfd = R.rankPool(pfd, ctxOf());
    check('федеральный рынок: метрики Keys.so в весе, без предупреждения «без Keys.so»', byDom(kfd, 'b.example').weight > byDom(kfd, 'a.example').weight && byDom(kfd, 'a.example').metrics_used.includes('traffic') && kfd.params.keyso_in_weight === true && !kfd.warnings.some(w => /без Keys.so/.test(w)) && R.keysoOff({ city_not_in_keyso: true }) && !R.keysoOff({ city_not_in_keyso: true, federal: true }), JSON.stringify([byDom(kfd, 'a.example'), kfd.warnings]));
    // ratio при ТОП-50 ниже порога не применяется: не пропуск, покрытие не снижено
    const prt = poolOf([cand('big.example', { keyso: { top10: 500, top50: 1000, traffic: 5000 }, keyso_status: 'ok' }), cand('small.example', { keyso: { top10: 10, top50: 30, traffic: 40 }, keyso_status: 'ok' })]);
    const krt = byDom(R.rankPool(prt, ctxOf()), 'small.example');
    check('ratio при ТОП-50 < 50: не применяется (reason), не в «нет метрик», покрытие 1', krt.coverage === 1 && /ratio не применяется: ТОП-50 < 50/.test(krt.reason) && !/нет метрик/.test(krt.reason) && !krt.metrics_used.includes('ratio'), JSON.stringify(krt));
    // независимость: слабый кандидат не меняет порядок и веса двух сильных
    const strong = [cand('s1.example', { serp: { top10: 5, share: 0.5 }, keyso: { top10: 300, top50: 900, traffic: 4000 }, keyso_status: 'ok', iks: 500 }), cand('s2.example', { serp: { top10: 4, share: 0.4 }, keyso: { top10: 500, top50: 1200, traffic: 6000 }, keyso_status: 'ok', iks: 400 })];
    const ka = R.rankPool(poolOf(strong), ctxOf());
    const kb = R.rankPool(poolOf([...strong, cand('weak.example', { serp: { top10: 1, share: 0.1 }, keyso: { top10: 3, top50: 20, traffic: 10 }, keyso_status: 'ok', iks: 10 })]), ctxOf());
    check('слабый кандидат не меняет порядок и веса двух сильных', JSON.stringify(ka.order) === JSON.stringify(kb.order.filter(d => d !== 'weak.example')) && byDom(ka, 's1.example').weight === byDom(kb, 's1.example').weight && byDom(ka, 's2.example').weight === byDom(kb, 's2.example').weight, JSON.stringify([ka.order, kb.order]));
    // параметры из config
    const pc = R.paramsOf({ competitors: { selection: { target: 3, weights: { iks: 2 }, _doc: 'x' } } });
    check('paramsOf: config переопределяет умолчания поштучно', pc.target === 3 && pc.weights.iks === 2 && pc.weights.share === 3 && pc.young_years === 7);
  }

  // ================================================================== 3. домены и стопы
  {
    check('normDomain: punycode, кириллица, www, порт, путь, точка в конце, регистр', D.normDomain('https://WWW.Пример.РФ:8080/path?x=1') === 'xn--e1afmkfd.xn--p1ai' && D.normDomain('xn--e1afmkfd.xn--p1ai') === 'xn--e1afmkfd.xn--p1ai' && D.normDomain('www.Example.com.') === 'example.com' && D.normDomain('//shop.example.com/a') === 'shop.example.com' && D.normDomain('не домен') === '' && D.normDomain('') === '');
    check('domainUnicode: punycode -> кириллица, латиница как есть', D.domainUnicode('xn--e1afmkfd.xn--p1ai') === 'пример.рф' && D.domainUnicode('www.example.com') === 'example.com');
    check('sameOrSub и isSub', D.sameOrSub('market.yandex.ru', 'yandex.ru') && D.sameOrSub('yandex.ru', 'yandex.ru') && !D.sameOrSub('notyandex.ru', 'yandex.ru') && D.isSub('a.b.ru', 'b.ru') && !D.isSub('b.ru', 'b.ru'));
    const pc = D.parseCompetitor('Имя - пример.рф');
    check('parseCompetitor (domains.mjs): кириллический домен - punycode, имя с юникодом', pc && pc.domain === 'xn--e1afmkfd.xn--p1ai' && pc.name === 'Имя (пример.рф)', JSON.stringify(pc));

    const dir = mkProject('domains', c => { c.site_url = 'https://www.client.example/'; c.competitors.own_domains = ['old-client.example']; c.competitors.aggregators_stoplist = ['agg.example']; });
    wj(W(dir, 'competitors', 'seed.json'), { source: 't', generated_at: 'x', domains: [{ domain: 'seed-one.example', source: 'analysis', name: 'Первый' }, { domain: 'struct-ex.example', source: 'analysis' }], rejected: ['Компания без сайта'] });
    wj(W(dir, 'competitors', 'structure-competitors.json'), { source: 's', direct: [{ domain: 'struct-one.example', dr: 20, top10: 50, top50: 300, pages_keyso: 120, traffic_month: 900 }], indirect: [], excluded: [{ domain: 'struct-ex.example', reason: 'чужая ниша' }, { domain: 'gone.example', reason: 'инфопортал' }], stop_list: [{ domain: 'stop-serp.example', reason: 'агрегатор в выдаче' }] });
    wj(path.join(dir, 'raw-a.json'), { source: 'keyso', candidates: [{ domain: 'пример.рф' }, { domain: 'https://www.xn--e1afmkfd.xn--p1ai/' }, { domain: 'WWW.ПРИМЕР.РФ' }, { domain: 'client.example' }, { domain: 'shop.client.example' }, { domain: 'old-client.example' }, { domain: 'market.yandex.ru' }, { domain: 'agg.example' }, { domain: 'gone.example' }, { domain: 'stop-serp.example' }, { domain: 'blog.seed-one.example' }, { domain: '???' }] });
    const m = run(dir, [RANK, '--merge-pool', 'raw-a.json']);
    const pool = m.code === 0 ? rj(W(dir, 'competitors', 'pool.json')) : { candidates: [], own: [], rejected: [] };
    const doms = pool.candidates.map(c => c.domain);
    check('--merge-pool: код 0, pool проходит схему', m.code === 0 && !schemaErrors('kf-pool', pool).length, m.out + schemaErrors('kf-pool', pool).join('; '));
    const idn = pool.candidates.filter(c => c.domain === 'xn--e1afmkfd.xn--p1ai');
    check('--merge-pool: кириллица, punycode и www сведены в один кандидат с domain_unicode', idn.length === 1 && idn[0].domain_unicode === 'пример.рф' && JSON.stringify(idn[0].sources) === '["keyso"]', JSON.stringify(idn));
    check('--merge-pool: затравка и конкуренты структуры добавлены сами, метрики структуры - в keyso', doms.includes('seed-one.example') && pool.candidates.find(c => c.domain === 'struct-one.example')?.keyso?.traffic === 900 && pool.candidates.find(c => c.domain === 'struct-one.example')?.sources.includes('structure') && pool.rejected.some(r => r.raw === 'Компания без сайта'), JSON.stringify(pool.candidates.find(c => c.domain === 'struct-one.example')));
    check('--merge-pool: домены клиента (site_url, own_domains, поддомены) - в own, не в кандидаты', !doms.some(d => /client\.example$/.test(d)) && pool.own.map(o => o.domain).includes('client.example') && pool.own.map(o => o.domain).includes('shop.client.example'), JSON.stringify(pool.own));
    check('--merge-pool: не домен - в rejected', pool.rejected.some(r => r.raw === '???' && r.reason === 'не домен'));
    const rk = run(dir, [RANK]);
    const ranking = rk.code === 0 ? rj(W(dir, 'competitors', 'ranking.json')) : { candidates: [] };
    const st = d => (ranking.candidates.find(c => c.domain === d) || {}).stop;
    check('ranking: поддомен стоп-листа kit (market.yandex.ru) и проектный стоп-лист - стоп', /^стоп-лист: yandex\.ru/.test(st('market.yandex.ru') || '') && /^стоп-лист: agg\.example/.test(st('agg.example') || ''), rk.out);
    check('ranking: исключенные структурой (excluded и stop_list) - стоп с причиной', st('gone.example') === 'исключен структурой: инфопортал' && st('stop-serp.example') === 'исключен структурой: агрегатор в выдаче');
    const se = ranking.candidates.find(c => c.domain === 'struct-ex.example') || {};
    check('ranking: домен затравки анализа побеждает исключение структуры, пометка в reason', se.stop === '' && /затравка анализа сильнее исключения структурой: чужая ниша/.test(se.reason), JSON.stringify(se));
    check('ranking: поддомен кандидата - стоп «поддомен»', /^поддомен: основной домен seed-one\.example/.test(st('blog.seed-one.example') || ''));
    check('ranking: проходит схему, стоп не в order', !schemaErrors('kf-ranking', ranking).length && !ranking.order.includes('market.yandex.ru') && ranking.order.includes('seed-one.example'), schemaErrors('kf-ranking', ranking).join('; '));
  }

  // ================================================================== 4. --merge-pool, --prelim, --check
  {
    const dir = mkProject('merge', c => { c.niche.geo = 'Тула'; c.sources.key_phrases = ['фраза один', 'фраза два', 'фраза три']; });
    wj(W(dir, 'competitors', 'seed.json'), { source: 't', generated_at: 'x', domains: [{ domain: 'alpha.example', source: 'analysis' }] });
    const q = run(dir, [RANK, '--queries']);
    check('--queries: регион Тула - Яндекс 15, Keys.so msk вне баз', q.json?.region?.yandex_id === 15 && q.json.region.city_not_in_keyso === true, q.out);
    wj(path.join(dir, 'serp.json'), { source: 'serp', results: [
      { query: 'фраза один', urls: ['https://alpha.example/x', 'https://www.beta.example/', 'https://beta.example/2', 'https://gamma.example/'] },
      { query: 'фраза два', urls: ['https://beta.example/', 'https://delta.example/'] },
      { query: 'фраза три', urls: ['https://beta.example/a', 'https://avito.ru/1'] },
    ] });
    const m1 = run(dir, [RANK, '--merge-pool', 'serp.json']);
    const p1 = rj(W(dir, 'competitors', 'pool.json'));
    const beta = p1.candidates.find(c => c.domain === 'beta.example');
    check('выдача: позиции по первому вхождению домена, top1/3/5/10 и share = top10/queries', beta && beta.serp.top1 === 2 && beta.serp.top3 === 3 && beta.serp.top10 === 3 && beta.serp.queries === 3 && beta.serp.share === 1 && beta.serp.region === 15 && beta.sources.includes('serp'), JSON.stringify(beta));
    check('выдача: порог кандидата - ceil(0,1 x 3) = 1 запрос; у затравки без выдачи share 0', p1.candidates.some(c => c.domain === 'delta.example') && p1.candidates.find(c => c.domain === 'alpha.example').serp.share === 0.333 && p1.serp_results.length === 3, JSON.stringify(p1.candidates.map(c => [c.domain, c.serp && c.serp.share])));
    check('сводка: need_msk при регионе не 213 и заметных меньше target', m1.json?.need_msk === true && m1.json.visible < 5, m1.out);
    wj(path.join(dir, 'kb.json'), { source: 'keyso_batch', candidates: [{ domain: 'beta.example', keyso: { top10: '1 200', top50: 3400, traffic: 5000, pages: 700 } }, { domain: 'gamma.example', keyso_status: 'not_found' }, { domain: 'unknown.example', keyso: { top50: 1 } }], errors: ['таймаут по части доменов'] });
    const m2 = run(dir, [RANK, '--merge-pool', 'kb.json']);
    const p2 = rj(W(dir, 'competitors', 'pool.json'));
    check('данные Keys.so: числа строкой разобраны, not_found без метрик, неизвестный домен не добавлен', p2.candidates.find(c => c.domain === 'beta.example').keyso.top10 === 1200 && p2.candidates.find(c => c.domain === 'gamma.example').keyso_status === 'not_found' && !p2.candidates.some(c => c.domain === 'unknown.example') && p2.errors.includes('keyso_batch: таймаут по части доменов'), JSON.stringify(p2.errors) + m2.out);
    wj(path.join(dir, 'kb2.json'), { source: 'keyso_batch', candidates: [{ domain: 'beta.example', keyso_status: 'not_found' }] });
    run(dir, [RANK, '--merge-pool', 'kb2.json']);
    const p3 = rj(W(dir, 'competitors', 'pool.json'));
    check('повтор источника снимает его прошлые ошибки; not_found не затирает полученные метрики', !p3.errors.length && p3.candidates.find(c => c.domain === 'beta.example').keyso_status === 'ok', JSON.stringify(p3.errors));
    wj(path.join(dir, 'whois.json'), { source: 'whois', candidates: [{ domain: 'beta.example', created: '24.03.2023' }, { domain: 'alpha.example', created: '2001-02-03' }] });
    run(dir, [RANK, '--merge-pool', 'whois.json']);
    const p4 = rj(W(dir, 'competitors', 'pool.json'));
    check('whois: DD.MM.YYYY -> YYYY-MM-DD', p4.candidates.find(c => c.domain === 'beta.example').created === '2023-03-24' && p4.candidates.find(c => c.domain === 'alpha.example').created === '2001-02-03');
    wj(path.join(dir, 'bad.json'), { source: 'gossip', candidates: [] });
    const mb = run(dir, [RANK, '--merge-pool', 'bad.json']);
    check('неизвестный source - код 1, pool не тронут', mb.code === 1 && JSON.stringify(rj(W(dir, 'competitors', 'pool.json'))) === JSON.stringify(p4), mb.out);
    const pre = run(dir, [RANK, '--prelim']);
    check('--prelim: keyso без уже полученных и not_found, history до 8, lookup без стопа, competitors_from', pre.code === 0 && !pre.json.keyso.includes('beta.example') && !pre.json.keyso.includes('gamma.example') && pre.json.keyso.includes('alpha.example') && pre.json.history.length <= 8 && !pre.json.lookup.includes('avito.ru') && typeof pre.json.competitors_from === 'string', pre.out);

    // --check
    const c0 = run(mkProject('check-none'), [RANK, '--check']);
    check('--check: нет pool - stale, код 0', c0.code === 0 && c0.json?.status === 'stale' && /нет work\/competitors\/pool.json/.test(c0.json.reason), c0.out);
    const c1 = run(dir, [RANK, '--check']);
    check('--check: годных меньше target - stale', c1.json?.status === 'stale' && /годных кандидатов \d+ из 5/.test(c1.json.reason), c1.out);
    // кандидаты Keys.so без попаданий в выдачу ниши - стоп («нет в выдаче ниши»): годных добираем затравкой
    wj(path.join(dir, 'more.json'), { source: 'analysis', candidates: ['e1', 'e2', 'e3'].map(x => ({ domain: `${x}.example`, keyso: { top50: 100 } })) });
    run(dir, [RANK, '--merge-pool', 'more.json']);
    const c2 = run(dir, [RANK, '--check']);
    check('--check: схема, input_sha, без ошибок, годных >= target - fresh', c2.json?.status === 'fresh' && c2.json.eligible >= 5, c2.out);
    wj(path.join(dir, 'iks.json'), { source: 'iks', candidates: [], errors: ['инструмент не ответил'] });
    run(dir, [RANK, '--merge-pool', 'iks.json']);
    const c3 = run(dir, [RANK, '--check']);
    check('--check: частичные ошибки - stale, failed_sources только упавшие', c3.json?.status === 'stale' && JSON.stringify(c3.json.failed_sources) === '["iks"]', c3.out);
    wj(path.join(dir, 'iks.json'), { source: 'iks', candidates: [{ domain: 'beta.example', iks: 120 }] });
    run(dir, [RANK, '--merge-pool', 'iks.json']);
    check('--check: перезапрос упавшего источника сохраняет полученное - fresh', run(dir, [RANK, '--check']).json?.status === 'fresh' && rj(W(dir, 'competitors', 'pool.json')).candidates.find(c => c.domain === 'beta.example').created === '2023-03-24');
    const cf = path.join(dir, 'config', 'project.json'); const cfg = rj(cf); cfg.sources.key_phrases.push('фраза четыре'); wj(cf, cfg);
    const c4 = run(dir, [RANK, '--check']);
    check('--check: входы изменились (запросы) - stale', c4.json?.status === 'stale' && /входы изменились/.test(c4.json.reason), c4.out);
    wj(path.join(dir, 'whois2.json'), { source: 'whois', candidates: [] });
    const m5 = run(dir, [RANK, '--merge-pool', 'whois2.json']);
    check('--merge-pool при изменившихся входах начинает pool заново', m5.code === 0 && /pool начат заново/.test(m5.stdout) && !rj(W(dir, 'competitors', 'pool.json')).candidates.some(c => c.domain === 'beta.example'), m5.out);
    // домены клиента: serp по выдаче и lookup для ИКС и whois (строка «ваш сайт»)
    const dow = mkProject('own', c => { c.site_url = 'https://client.example/'; c.niche.geo = 'Москва'; c.sources.key_phrases = ['ф1', 'ф2']; });
    wj(path.join(dow, 'serp.json'), { source: 'serp', results: [{ query: 'ф1', urls: ['https://client.example/', 'https://one.example/'] }, { query: 'ф2', urls: ['https://one.example/'] }] });
    run(dow, [RANK, '--merge-pool', 'serp.json']);
    const po = rj(W(dow, 'competitors', 'pool.json'));
    const ow = po.own.find(o => o.domain === 'client.example');
    const preo = run(dow, [RANK, '--prelim']);
    check('own: serp у домена клиента (share), lookup с доменом клиента в конце', ow && ow.serp && ow.serp.top10 === 1 && ow.serp.share === 0.5 && !schemaErrors('kf-pool', po).length && preo.json?.lookup?.at(-1) === 'client.example' && !po.candidates.some(c => c.domain === 'client.example'), JSON.stringify([ow, preo.json?.lookup]));
    wj(path.join(dow, 'kb.json'), { source: 'keyso_batch', candidates: [{ domain: 'client.example', keyso: { top10: 5, top50: 80, traffic: 100 } }] });
    run(dow, [RANK, '--merge-pool', 'kb.json']);
    const preo2 = run(dow, [RANK, '--prelim']);
    check('own: метрики Keys.so клиента в own, competitors_from - домен клиента с видимостью', rj(W(dow, 'competitors', 'pool.json')).own.find(o => o.domain === 'client.example')?.keyso?.top50 === 80 && preo2.json?.competitors_from === 'client.example', preo2.out);
    // узкая ниша: годных меньше target, но все источники кандидатов пройдены - fresh, повтор отбора не нужен
    const ch1 = run(dow, [RANK, '--check']);
    check('--check: годных меньше target и не все источники - stale, sources_left', ch1.json?.status === 'stale' && JSON.stringify(ch1.json.sources_left) === '["keyso"]' && JSON.stringify(ch1.json.sources_done) === '["serp","keyso_batch"]', ch1.out);
    wj(path.join(dow, 'kc.json'), { source: 'keyso', candidates: [] });
    run(dow, [RANK, '--merge-pool', 'kc.json']);
    const ch2 = run(dow, [RANK, '--check']);
    check('--check: годных меньше target, источники исчерпаны (регион 213 - без serp_msk) - fresh, exhausted', ch2.json?.status === 'fresh' && ch2.json.exhausted === true && ch2.json.eligible < 5 && /источники исчерпаны/.test(ch2.json.reason), ch2.out);
    wj(path.join(dow, 'kc.json'), { source: 'keyso', candidates: [], errors: ['таймаут'] });
    run(dow, [RANK, '--merge-pool', 'kc.json']);
    const ch3 = run(dow, [RANK, '--check']);
    check('--check: источник упал при повторе - снят из sources_done, stale', ch3.json?.status === 'stale' && !ch3.json.sources_done.includes('keyso'), ch3.out);
    check('exhaustSources: регион не 213 требует serp_msk', JSON.stringify(R.exhaustSources({ yandex_id: 15 })) === '["serp","serp_msk","keyso_batch","keyso"]' && !R.exhaustSources({ yandex_id: 213 }).includes('serp_msk'));
    // pool до 05.10 без sources_done - как раньше (stale при недоборе)
    const pold = rj(W(dow, 'competitors', 'pool.json')); delete pold.sources_done; pold.errors = []; wj(W(dow, 'competitors', 'pool.json'), pold);
    check('--check: pool без sources_done при недоборе - stale, как раньше', run(dow, [RANK, '--check']).json?.status === 'stale');
    // нет запросов (ни фраз, ни маркеров): скаут пишет «serp: нет запросов» - выдача считается пройденной (интеграция G),
    // иначе --check stale навсегда и скаут зовется на каждом повторе wf-02
    const dnq = mkProject('no-queries', c => { c.niche.geo = 'Тула'; c.sources.key_phrases = []; });
    check('нет запросов: --queries пуст', run(dnq, [RANK, '--queries']).json?.queries?.length === 0);
    wj(path.join(dnq, 'serp.json'), { source: 'serp', candidates: [], errors: ['serp: нет запросов'] });
    run(dnq, [RANK, '--merge-pool', 'serp.json']);
    wj(path.join(dnq, 'kb.json'), { source: 'keyso_batch', candidates: [] });
    run(dnq, [RANK, '--merge-pool', 'kb.json']);
    const nq1 = run(dnq, [RANK, '--check']);
    check('нет запросов: ошибка serp не делает pool stale, недобор без keyso - stale только по keyso', nq1.json?.status === 'stale' && JSON.stringify(nq1.json.sources_left) === '["keyso"]' && nq1.json.no_queries === true && rj(W(dnq, 'competitors', 'pool.json')).errors.includes('serp: нет запросов'), nq1.out);
    wj(path.join(dnq, 'kc.json'), { source: 'keyso', candidates: [] });
    run(dnq, [RANK, '--merge-pool', 'kc.json']);
    const nq2 = run(dnq, [RANK, '--check']);
    check('нет запросов: serp и serp_msk (регион не 213) пройдены, Keys.so пройден - fresh, exhausted', nq2.json?.status === 'fresh' && nq2.json.exhausted === true && nq2.json.no_queries === true, nq2.out);
    // с запросами та же ошибка выдачи - stale, как раньше
    const dq = mkProject('with-queries', c => { c.niche.geo = 'Тула'; c.sources.key_phrases = ['фраза']; });
    wj(path.join(dq, 'serp.json'), { source: 'serp', candidates: [], errors: ['serp: нет запросов'] });
    run(dq, [RANK, '--merge-pool', 'serp.json']);
    const wq = run(dq, [RANK, '--check']);
    check('с запросами: ошибка выдачи - stale, failed_sources serp', wq.json?.status === 'stale' && JSON.stringify(wq.json.failed_sources) === '["serp"]' && !wq.json.no_queries, wq.out);
    // структура меняет input_sha
    const s1 = R.taskContext;
    check('taskContext экспортирован (для wf и тестов)', typeof s1 === 'function');
  }

  // ================================================================== 5. import-project
  {
    const SITE = path.join(tmpRoot, 'sites', '001-imp');
    const STRUCT = path.join(tmpRoot, 'structures', '001-imp');
    const PROJECT = {
      v: 2, slug: 'imp', updated: '2026-10-05', source: ['бриф'], tier: 'seo',
      gates: { promise: true, facts3: true, proof1: true, ready: true },
      business: { name: 'Тест', what: 'Ремонт бытовой техники на дому', region: 'Тула', geo: ['Тула'], site: 'https://imp.example', type: 'services', site_kind: 'multipage', sig: [],
        directions: [{ id: 'remont', name: 'Ремонт техники', marker: 'ремонт техники', url: '/remont', serves: ['home'] }], legal: {} },
      offer: { positioning: 'Ремонт за один визит', promise: { who: 'владельцы техники', result: 'работает', how: 'выезд', cta: 'Вызвать мастера' }, limits: [], tone: 'деловой' },
      audience: { segments: [{ id: 'home', name: 'Хозяин', who: 'Житель', pain: ['сломалось'], objection: [], choose: ['скорость'] }], words: [] },
      competitors: { list: ['one.example', 'Имя - пример.рф'], market: {} },
      facts: [{ id: 'f01', label: 'год основания', value: 'работаем с 2015 года', kind: 'number', publish: 'yes', src: 'бриф' }],
      constraints: {}, lexicon: {}, gaps: [],
    };
    wj(path.join(SITE, 'project.json'), PROJECT);
    wj(path.join(SITE, 'queue.json'), { tier: 'seo', gate: { approved: true, by: 'заказчик', at: '2026-10-05' }, journal: [] });
    wj(path.join(STRUCT, 'structure_data.json'), { pages: [{ url: '/', name: 'Главная', type: 'home' }] });
    wj(path.join(STRUCT, 'competitors.json'), { direct: [{ domain: 'www.Direct.example', dr: 10, top50: 100 }], indirect: [{ domain: 'пример.рф' }], excluded: [{ domain: 'avito.ru', reason: 'агрегатор' }] });
    wj(path.join(STRUCT, 'serp.json'), { stop_list: [{ domain: 'zoon.ru', reason: 'агрегатор в выдаче' }] });
    const di = mkProject('import');
    const r = run(di, ['scripts/import-project.mjs', '--project', path.join(SITE, 'project.json'), '--queue', path.join(SITE, 'queue.json'), '--structure', path.join(STRUCT, 'structure_data.json')]);
    const cfg = r.code === 0 ? rj(path.join(di, 'config', 'project.json')) : {};
    check('import: niche.yandex_id и keyso_base по региону (Тула - 15, msk), site_kind', r.code === 0 && cfg.niche?.yandex_id === 15 && cfg.niche.keyso_base === 'msk' && cfg.niche.site_kind === 'multipage', r.out.slice(0, 1500));
    const sc = r.code === 0 && fs.existsSync(W(di, 'competitors', 'structure-competitors.json')) ? rj(W(di, 'competitors', 'structure-competitors.json')) : null;
    check('import: копия structure-competitors.json - канон доменов, excluded и stop_list с причинами', sc && sc.direct[0].domain === 'direct.example' && sc.indirect[0].domain === 'xn--e1afmkfd.xn--p1ai' && sc.excluded[0].reason === 'агрегатор' && sc.stop_list[0].domain === 'zoon.ru', JSON.stringify(sc));
    const rep = r.code === 0 ? rj(W(di, 'import-report.json')) : {};
    check('import: отпечаток - раздел structure-competitors рядом с competitors-seed', !!rep.analysis_fingerprint?.['structure-competitors'] && !!rep.analysis_fingerprint['competitors-seed'], JSON.stringify(rep.analysis_fingerprint));
    const seed = r.code === 0 ? rj(W(di, 'competitors', 'seed.json')) : { domains: [] };
    check('import: затравка через domains.mjs - кириллица в punycode', seed.domains.map(d => d.domain).join(',') === 'one.example,xn--e1afmkfd.xn--p1ai', JSON.stringify(seed.domains));
    // правка конкурентов структуры -> --facts-only видит изменение
    wj(path.join(STRUCT, 'competitors.json'), { direct: [{ domain: 'other.example' }], indirect: [], excluded: [] });
    const r2 = run(di, ['scripts/import-project.mjs', '--facts-only', '--project', path.join(SITE, 'project.json'), '--queue', path.join(SITE, 'queue.json'), '--structure', path.join(STRUCT, 'structure_data.json')]);
    const rep2 = r2.code === 0 ? rj(W(di, 'import-report.json')) : {};
    check('import --facts-only: изменились конкуренты структуры - other_changed structure-competitors', r2.code === 0 && (rep2.other_changed || []).includes('structure-competitors'), r2.out.slice(0, 800) + JSON.stringify(rep2.other_changed));
    // старая задача (импорт до 05.10): ни копии, ни раздела отпечатка - --facts-only не считает раздел изменением
    const dold = mkProject('import-old');
    const ro = run(dold, ['scripts/import-project.mjs', '--project', path.join(SITE, 'project.json'), '--queue', path.join(SITE, 'queue.json'), '--structure', path.join(STRUCT, 'structure_data.json')]);
    if (ro.code === 0) {
      fs.rmSync(W(dold, 'competitors', 'structure-competitors.json'), { force: true });
      const rp = rj(W(dold, 'import-report.json')); delete rp.analysis_fingerprint['structure-competitors']; wj(W(dold, 'import-report.json'), rp);
    }
    const ro2 = run(dold, ['scripts/import-project.mjs', '--facts-only', '--project', path.join(SITE, 'project.json'), '--queue', path.join(SITE, 'queue.json'), '--structure', path.join(STRUCT, 'structure_data.json')]);
    const repo2 = ro2.code === 0 ? rj(W(dold, 'import-report.json')) : {};
    check('import --facts-only у старой задачи: раздела structure-competitors нет - не изменение, отпечаток не пишется', ro.code === 0 && ro2.code === 0 && Array.isArray(repo2.other_changed) && !repo2.other_changed.includes('structure-competitors') && !('structure-competitors' in (repo2.analysis_fingerprint || {})) && !/повтор фазы 0/.test(ro2.stdout), ro2.out.slice(0, 800) + JSON.stringify(repo2.other_changed));
    // без структуры рядом - как раньше
    const dn = mkProject('import-nostruct');
    const r3 = run(dn, ['scripts/import-project.mjs', '--project', path.join(SITE, 'project.json'), '--queue', path.join(SITE, 'queue.json')]);
    const rep3 = r3.code === 0 ? rj(W(dn, 'import-report.json')) : {};
    check('import без структуры: копии нет, отпечаток - прежние 6 разделов', r3.code === 0 && !fs.existsSync(W(dn, 'competitors', 'structure-competitors.json')) && Object.keys(rep3.analysis_fingerprint || {}).length === 6, r3.out.slice(0, 800));
    // ranking.json по копии структуры ставит стоп
    const ctx = { ...R.taskContext(), structure: { direct: [], indirect: [], excluded: [{ domain: 'avito.ru', reason: 'агрегатор' }], stop_list: [] }, stoplist: [] };
    const kk = R.rankPool(poolOf([cand('avito.ru', { sources: ['keyso'] })]), ctx);
    check('ranking: исключенный структурой без затравки - стоп', /^исключен структурой: агрегатор/.test(kk.candidates[0].stop));
  }

  // ================================================================== 6. regions.mjs
  {
    const src = path.join(REPO, '.claude', 'scripts', 'validate-project-input.mjs');
    if (!fs.existsSync(src)) notes.push('SKIP regions: нет .claude/scripts/validate-project-input.mjs');
    else {
      const a = fs.readFileSync(src, 'utf8'), b = read('scripts/regions.mjs');
      const block = (t, start, end) => { const i = t.indexOf(start); const j = t.indexOf(end, i); return i < 0 || j < 0 ? null : t.slice(i, j + end.length).replace(/\r\n/g, '\n'); };
      const ca = block(a, 'const CITIES = [', '\n];'), cb = block(b, 'const CITIES = [', '\n];');
      check('regions.mjs: литерал CITIES совпадает с validate-project-input.mjs', ca && ca === cb, `${ca?.length} vs ${cb?.length}`);
      const fa = (a.match(/const FEDERAL = .*\n/) || [])[0], fb = (b.match(/const FEDERAL = .*\n/) || [])[0];
      check('regions.mjs: литерал FEDERAL совпадает', !!fa && fa === fb, `${fa} | ${fb}`);
      const cpath = path.join(REPO, '.claude', 'scripts', 'site', '_contract.mjs');
      if (fs.existsSync(cpath)) {
        const bc = (fs.readFileSync(cpath, 'utf8').match(/export const B = (".*?");/) || [])[1];
        check('regions.mjs: граница B совпадает с _contract.mjs', !!bc && b.includes(`const B = ${bc};`), bc);
      }
    }
    const m = RG.parseRegion('Москва и Санкт-Петербург'), s = RG.parseRegion('Санкт-Петербург и Москва'), t = RG.parseRegion('Тула'), f = RG.parseRegion('вся Россия'), x = RG.parseRegion('Звенигородка');
    check('parseRegion: первый по положению город', m.city === 'Москва' && m.keyso_base === 'msk' && m.yandex_id === 213 && !m.city_not_in_keyso && s.keyso_base === 'spb' && s.yandex_id === 2);
    check('parseRegion: Тула - код Яндекса есть, базы Keys.so нет', t.yandex_id === 15 && t.keyso_base === 'msk' && t.city_not_in_keyso && !t.yandex_fallback_213);
    check('parseRegion: федеральный и неизвестный - msk и 213 с пометками', f.federal && f.yandex_id === 213 && f.yandex_fallback_213 && f.city_not_in_keyso && !x.federal && x.yandex_fallback_213 && x.city === null);
    check('parseRegion: е с точками в тексте региона', RG.parseRegion('Орел, Ростов-на-Дону').keyso_base === 'rnd' && RG.parseRegion('Пермь').yandex_id === 50);
  }

  // ================================================================== 7. стоп-лист, конфиг, схема competitors
  {
    const sl = rj(path.join(TPL, 'config', 'kf-stoplist.json'));
    const ds = sl.domains.map(x => x.domain);
    const REF = ['avito.ru', 'youla.ru', 'profi.ru', 'yandex.ru', 'ozon.ru', 'wildberries.ru', 'aliexpress.ru', 'megamarket.ru', 'vk.com', 'ok.ru', 't.me', 'youtube.com', 'dzen.ru', '2gis.ru', 'zoon.ru', 'yell.ru', 'flamp.ru', 'otzovik.com', 'irecommend.ru', 'wikipedia.org'];
    check('стоп-лист: эталонный список общих доменов', REF.every(d => ds.includes(d)), REF.filter(d => !ds.includes(d)).join(', '));
    check('стоп-лист: не больше 40, без дублей, каноны доменов, kind из списка', ds.length <= 40 && new Set(ds).size === ds.length && ds.every(d => D.normDomain(d) === d) && sl.domains.every(x => ['aggregator', 'marketplace', 'social', 'media', 'maps', 'directory'].includes(x.kind)), String(ds.length));
    const cfg = rj(path.join(TPL, 'config', 'project.json'));
    const sel = cfg.competitors.selection;
    check('config: competitors.selection = умолчания скрипта, max_domains 8 остался, own_domains []', JSON.stringify(R.paramsOf(cfg)) === JSON.stringify(R.DEFAULTS) && Object.keys(R.DEFAULTS).every(k => k in sel) && cfg.competitors.max_domains === 8 && Array.isArray(cfg.competitors.own_domains), JSON.stringify(sel));
    const comp = { verified_at: 'x', competitors: [{ domain: 'a.example', status: 'ok', source: 'structure', rank: 1, weight: 80.5, age_years: 3.2, age_class: 'young', growth: 'up', site_type: 'medium', anchor: false }, { domain: 'b.example', status: 'ok', source: 'keyso', weight: null, age_years: null, age_class: 'unknown', growth: 'unknown', site_type: 'unknown', anchor: true }, { domain: 'c.example', status: 'ok', source: 'analysis' }] };
    check('схема competitors: source structure и keyso, новые поля, старый формат проходит', !schemaErrors('competitors', comp).length && schemaErrors('competitors', { verified_at: 'x', competitors: [{ domain: 'a', status: 'ok', source: 'serp_msk' }] }).length > 0 && schemaErrors('competitors', { verified_at: 'x', competitors: [{ domain: 'a', status: 'ok', source: 'both', age_class: 'ancient' }] }).length > 0, schemaErrors('competitors', comp).join('; '));
    check('схема kf-pool: источник вне enum и created без даты не проходят', schemaErrors('kf-pool', { ...poolOf([cand('a.example', { sources: ['gossip'] })]) }).length > 0 && !schemaErrors('kf-pool', poolOf([cand('a.example')])).length);
  }

  // ================================================================== 8. промты, стиль, бюджеты
  {
    const ver = read('prompts/02-competitor-verifier.md'), sc = read('prompts/02-competitor-scout.md');
    check('верификатор: при ranking.json своей выдачи (arsenkin) нет, кандидаты строго по order', ver.includes('С `ranking.json` шага 1 нет') && ver.includes('кандидаты строго по `order`') && ver.includes('не кончится `order`'));
    check('верификатор: target 5 из selection.target, max_domains при ranking не действует (строка в method)', ver.includes('`selection.target` (5)') && ver.includes('`max_domains` не действует (строка в `method`)') && ver.includes('Без `ranking.json`: не больше `max_domains`'));
    check('верификатор: правило эталона - замена годного не эталона с наименьшим effective', ver.includes('«вытеснен эталоном»') && ver.includes('наименьшим `effective`') && ver.includes('годного эталона нет - строка в `method`'));
    check('верификатор: CDP раньше браузера, страница проверки CDP - окончательный ответ', ver.includes('node scripts/capture-pages.mjs --url https://<domain>/ --domain <domain> --name home') && ver.includes('--html-from work/competitors/shots/<domain>/home/render.html') && ver.includes('`home.cdp.html`') && ver.includes('окончательный ответ') && ver.includes('только при отказе CDP (нет Chrome, таймаут, код не 0)'));
    check('верификатор: новые поля и source в competitors.json, домены клиента отброшены', ['`rank`', '`weight`', '`age_years`', '`age_class`', '`growth`', '`site_type`', '`anchor`', '`structure`', '`keyso`', '`both`'].every(x => ver.includes(x)) && ver.includes('домены клиента'));
    check('скаут: ToolSearch по словам, merge-pool после каждого источника, --check fresh, регион из --queries', ['«arsenkin top»', '«keyso domains batch»', '«keyso dashboard»', '«keyso competitors»', '«arsenkin domains»'].every(x => sc.includes(x)) && sc.includes('--merge-pool') && sc.includes('`fresh` - ничего не делай') && sc.includes('<yandex_id>') && sc.includes('`keyso_base`') && sc.includes('not_found'));
    check('бюджеты: 02-competitor-scout <= 3500, 02-competitor-verifier <= 5200', sc.length <= 3500 && ver.length <= 5200, `${sc.length} / ${ver.length}`);

    const YO = String.fromCharCode(0x451), YO2 = String.fromCharCode(0x401), D1 = String.fromCharCode(0x2014), D2 = String.fromCharCode(0x2013);
    const INVIS = [0xad, 0x200b, 0x200c, 0x200d, 0x2060, 0xfeff].map(c => String.fromCharCode(c));
    const NICHE = /(застройщ|депозит|квот[аеуы]|инвестор|недвижим|ипотек|новострой|апартамент|доходност|ювелир|золот|кольц|пирсинг|бриллиант|серебр|помолвоч|обручал|геммолог|пхукет|двигател|запчаст|trade-in|автомобил|goldax)/i;
    const OWN = ['prompts/02-competitor-scout.md', 'prompts/02-competitor-verifier.md', 'scripts/rank-competitors.mjs', 'scripts/domains.mjs', 'scripts/regions.mjs', 'config/kf-stoplist.json', 'schemas/kf-pool.schema.json', 'schemas/kf-ranking.schema.json', 'schemas/competitors.schema.json', 'config/project.json', 'scripts/import-project.mjs'];
    const bad = [];
    for (const f of OWN) {
      const t = read(f);
      if ([YO, YO2, D1, D2].some(ch => t.includes(ch))) bad.push(`${f}: е с точками или длинное тире`);
      if (INVIS.some(ch => t.includes(ch))) bad.push(`${f}: невидимый символ литералом`);
      if (/mcp__[0-9a-f]{8}-/.test(t) || /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.test(t)) bad.push(`${f}: UUID`);
      const nm = t.match(NICHE); if (nm) bad.push(`${f}: нишевое слово «${nm[0]}»`);
    }
    check('файлы пакета A: без е с точками, длинных тире, невидимых символов, UUID и нишевых слов', !bad.length, bad.join('; '));
    for (const f of ['prompts/02-competitor-scout.md', 'prompts/02-competitor-verifier.md']) {
      const t = read(f);
      check(`${f}: кавычки - только «елочки» в тексте (без „ “ ”)`, ![0x201e, 0x201c, 0x201d].some(c => t.includes(String.fromCharCode(c))));
    }
  }
  // сверка верификатора с порядком отбора
  {
    const rk = { order: ['a.ru', 'b.ru', 'c.ru', 'd.ru', 'e.ru'] };
    const cp = list => ({ competitors: list.map(([domain, status]) => ({ domain, status })) });
    check('orderGaps: пропуски выше последнего годного (не годен и не исключен) - пропущены; ниже - не в счет', JSON.stringify(R.orderGaps(rk, cp([['a.ru', 'closed'], ['c.ru', 'ok'], ['e.ru', 'ok']]))) === '["b.ru","d.ru"]' && JSON.stringify(R.orderGaps(rk, cp([['a.ru', 'ok'], ['b.ru', 'excluded'], ['c.ru', 'ok']]))) === '[]' && JSON.stringify(R.orderGaps(rk, cp([]))) === '[]');
  }
  // ---------------------------------------------------------------- бесплатный whois (порт 43)
  {
    const NL = String.fromCharCode(10);
    check('parseCreated: created и Creation Date, дата YYYY-MM-DD; нет поля - null', R.parseCreated(`domain: X.RU${NL}created:       2023-03-24T15:05:09Z${NL}`) === '2023-03-24' && R.parseCreated('   Creation Date: 2012-12-18T11:06:56Z') === '2012-12-18' && R.parseCreated('No entries found') === null);
    check('whoisServerOf: .ru и .рф - tcinet, .com - verisign, неизвестная зона - null, переменная окружения сильнее', R.whoisServerOf('a.ru', {}) === 'whois.tcinet.ru' && R.whoisServerOf('xn--80a.xn--p1ai', {}) === 'whois.tcinet.ru' && R.whoisServerOf('a.com', {}) === 'whois.verisign-grs.com' && R.whoisServerOf('a.art', {}) === null && R.whoisServerOf('a.art', { SITE_TEKST_WHOIS_SERVER: '127.0.0.1:43' }) === '127.0.0.1:43');
    // поддельный whois-сервер - отдельный процесс (spawnSync блокирует цикл событий теста)
    const srvFile = path.join(tmpRoot, 'whois-srv.mjs');
    fs.writeFileSync(srvFile, [
      "import net from 'node:net';",
      "const ok = new Set(['alpha.ru', 'sub-parent.ru']);",
      "const s = net.createServer(c => { let b = ''; c.on('data', d => { b += d; if (b.includes(String.fromCharCode(10))) { const q = b.trim(); c.end(ok.has(q) ? 'domain: ' + q + String.fromCharCode(10) + 'created: 2023-03-24T15:05:09Z' + String.fromCharCode(10) : 'No entries found'); } }); });",
      "s.listen(0, '127.0.0.1', () => console.log('PORT ' + s.address().port));",
    ].join(NL));
    const { spawn } = await import('node:child_process');
    const srv = spawn(process.execPath, [srvFile], { stdio: ['ignore', 'pipe', 'ignore'] });
    const port = await new Promise(res => { let o = ''; srv.stdout.on('data', d => { o += d; const m = o.match(/PORT (\d+)/); if (m) res(Number(m[1])); }); setTimeout(() => res(0), 5000); });
    try {
      const dir = mkProject('whois');
      wj(path.join(dir, 'raw.json'), { source: 'analysis', candidates: [{ domain: 'alpha.ru' }, { domain: 'beta.ru' }, { domain: 'msk.sub-parent.ru' }] });
      run(dir, [RANK, '--merge-pool', 'raw.json']);
      const env = { ...process.env, SITE_TEKST_WHOIS_SERVER: `127.0.0.1:${port}`, SITE_TEKST_WHOIS_DELAY_MS: '0' };
      const r = spawnSync(process.execPath, [RANK, '--whois'], { cwd: dir, encoding: 'utf8', timeout: 60000, env });
      let j = null; try { j = JSON.parse(r.stdout); } catch { j = null; }
      const pool = rj(W(dir, 'competitors', 'pool.json'));
      const cr = d => (pool.candidates.find(c => c.domain === d) || {}).created || null;
      check('--whois: даты из whois (поддомен - по основному домену), не ответивший - в failed, whois в sources_done', port > 0 && r.status === 0 && !!j && j.filled === 2 && cr('alpha.ru') === '2023-03-24' && cr('msk.sub-parent.ru') === '2023-03-24' && cr('beta.ru') === null && j.failed.includes('beta.ru') && (pool.sources_done || []).includes('whois'), (r.stdout || '') + (r.stderr || ''));
      const r2 = spawnSync(process.execPath, [RANK, '--whois'], { cwd: dir, encoding: 'utf8', timeout: 60000, env });
      let j2 = null; try { j2 = JSON.parse(r2.stdout); } catch { j2 = null; }
      check('--whois повторно: заполненные не спрашиваются (только beta.ru)', !!j2 && j2.filled === 0 && JSON.stringify(j2.failed) === '["beta.ru"]', r2.stdout);
    } finally { srv.kill(); }
  }
} catch (e) {
  fail++; failures.push(`FAIL исключение: ${e.stack || e.message}`);
} finally {
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* временная папка */ }
}

notes.forEach(n => console.log(`NOTE ${n}`));
failures.forEach(f => console.log(f));
console.log(`cases-kf-select: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
