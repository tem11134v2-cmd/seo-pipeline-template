// Стратегия по страницам: стратеги типов пишут каждый свой файл work/strategy.pages/<type>.json (параллельно),
// скрипт собирает из них work/strategy.json в прежнем формате. Глобальную часть пишет глобальный стратег, она не меняется.
// Файл типа: {"type":"<type>","pages":{"<slug>":{запись по schemas/strategy.schema.json -> pages}},"disputes":[...]}
// disputes - спорные решения стратега типа ({question, decision, why}, schemas/strategy.schema.json -> definitions.dispute):
// стратеги типов идут параллельно и в decisions.md не пишут, отчет берет споры из файлов типов.
//
// node scripts/merge-strategy.mjs                 - собрать: pages = прежние pages из strategy.json + записи всех файлов типов
//                                                   (запись файла типа заменяет прежнюю запись того же slug на ее месте, новые -
//                                                   в конец в порядке карты); global и прочие поля strategy.json не трогаются.
//                                                   Проверки содержания (как в --check) - предупреждения, запись не отклоняется
// node scripts/merge-strategy.mjs --check <file...> - проверить файлы типов: схема записей, slug есть в карте с этим типом,
//                                                   покрыты все страницы типа (без status skip), содержание (проблемы, код 1):
//                                                   факты facts, hero_facts, block_overrides.*.facts и id из task есть в
//                                                   facts.json, публикуются и не закрыты для страницы «Где можно» decisions.md
//                                                   (формат v2); hero_facts входят в facts; ключи block_overrides и
//                                                   exclude_blocks - блоки типа страницы (первый экран не исключается);
//                                                   segment есть в audience или all; objection_ids есть в audience; в task
//                                                   нет id после отрицания; action / secondary_action CTA по контракту C3
//                                                   (cta страницы необязателен: наследуется из global.cta_by_type; anchor на
//                                                   финальный призыв принимает cta-final и cta старых данных).
//                                                   Предупреждения: у блока из limits.drop_blocks_without_facts пустой явный
//                                                   facts - блок снимается со страницы, как exclude_blocks; у страницы с
//                                                   выдачей (listing: true в карте или блок pattern listing у типа) главная
//                                                   кнопка без action (по данным, не по словам кнопки). Файлы не меняет
// node scripts/merge-strategy.mjs --matrix         - компактная таблица стратегии для рецензии (slug, type, parent, segment,
//                                                   hook, unique_argument, hero_facts с wording), близнецы (родитель-ребенок и
//                                                   страницы одного типа с общим сегментом: общие hero_facts от 2/3 или
//                                                   похожие hook / unique_argument по шинглам основ), частота фактов по
//                                                   страницам. Все - в work/audit/strategy-matrix.md; в консоль таблица
//                                                   печатается, если страниц не больше 40 (иначе - путь к файлу). Код 0
// node scripts/merge-strategy.mjs --split [--force] - разрезать pages существующего strategy.json по типам карты в
//                                                   strategy.pages/<type>.json (перевод старого проекта; без --force не перезаписывает;
//                                                   записи страниц со status skip и вне карты остаются только в strategy.json)
// Код выхода: 0 - без проблем, 1 - есть проблемы (при сборке валидные записи все равно собраны), 2 - нет входных файлов.
import path from 'node:path';
import { argv, P, readJson, writeJson, readText, writeText, exists, listFiles, loadSitemap, loadSchema, loadConfig, validate, normalizeDeep, taskFactRefs, parseDecisions, decisionAllows, normPath, mergeCta, resolveBlockId, isServiceText } from './lib.mjs';

const a = argv({ check: 'bool', split: 'bool', force: 'bool', matrix: 'bool' });
const STRATEGY = P('work', 'strategy.json');
const DIR = P('work', 'strategy.pages');
const schema = loadSchema('strategy');
const pageSchema = schema.properties.pages.additionalProperties;
const sm = loadSitemap();
const live = sm.pages.filter(p => p.status !== 'skip');
const typeOf = Object.fromEntries(sm.pages.map(p => [p.slug, p.type]));
const pageBySlug = Object.fromEntries(sm.pages.map(p => [p.slug, p]));
const liveSlugs = new Set(live.map(p => p.slug));
const mapOrder = Object.fromEntries(sm.pages.map((p, i) => [p.slug, i]));
const typeOrder = [...new Set(live.map(p => p.type))];
const rel = f => path.relative(process.cwd(), f).replace(/\\/g, '/');
const tryJson = f => { try { return exists(f) ? readJson(f) : null; } catch { return null; } };
// глобальная часть стратегии для наследования CTA в проверках (--check идет и без strategy.json)
const strategy0 = tryJson(STRATEGY) || {};

// ---------- данные для проверок содержания (нет файла - соответствующая проверка пропускается) ----------
const factsFile = tryJson(P('work', 'facts.json'));
const factsById = factsFile ? Object.fromEntries((factsFile.facts || []).map(f => [f.id, f])) : null;
const aud = tryJson(P('work', 'audience.json'));
const segIds = aud ? new Set((aud.segments || []).map(s => s.id)) : null;
const objIds = aud ? new Set((aud.segments || []).flatMap(s => (s.objections || []).map(o => o.id))) : null;
const dec = parseDecisions(exists(P('rules', 'decisions.md')) ? readText(P('rules', 'decisions.md')) : null, { slugs: sm.pages.map(p => p.slug), types: [...new Set([...(sm.page_types || []), ...sm.pages.map(p => p.type)])] });
let limits = {};
try { limits = loadConfig().limits || {}; } catch { limits = {}; }
const dropIds = new Set((limits.drop_blocks_without_facts || []).map(x => String(x).split(':')[0]));
const typeCache = {};
const typeBlocks = t => {
  if (!(t in typeCache)) {
    const pt = tryJson(P('work', 'page-types', `${t}.json`));
    typeCache[t] = pt ? Object.fromEntries([...(pt.market_blocks || []), ...(pt.differentiation_blocks || [])].map(b => [b.id, b])) : null;
  }
  return typeCache[t];
};
const ACTION_RE = /^(lead|messenger|call|page:[a-z0-9][a-z0-9-]*|anchor:[a-z0-9][a-z0-9-]*)$/;
function checkCtaAction(where, action, blocks, excluded) {
  if (action == null || action === '') return '';
  if (!ACTION_RE.test(String(action))) return `${where} «${action}» не по контракту: lead | page:<slug> | anchor:<id блока типа> | messenger | call`;
  if (action.startsWith('page:') && !liveSlugs.has(action.slice(5))) return `${where}: страницы ${action.slice(5)} нет среди рабочих страниц карты`;
  if (action.startsWith('anchor:') && blocks) {
    // финальный призыв: cta-final и cta старых данных - синонимы
    const id = resolveBlockId(action.slice(7), Object.keys(blocks)) || action.slice(7);
    if (!blocks[id]) return `${where}: блока ${id} нет в типе страницы`;
    if (excluded.includes(id)) return `${where}: блок ${id} исключен на этой странице (exclude_blocks)`;
  }
  return '';
}
const globalCta = t => ((strategy0.global || {}).cta_by_type || {})[t];
// Проверки содержания записи страницы: {problems, warnings}
function contentChecks(slug, e) {
  const problems = [], warnings = [];
  const P1 = s => problems.push(`pages.${slug}: ${s}`), W = s => warnings.push(`pages.${slug}: ${s}`);
  const page = pageBySlug[slug] || { slug, type: typeOf[slug] };
  const blocks = typeBlocks(page.type);
  const ov = e.block_overrides || {};
  const excluded = e.exclude_blocks || [];
  const factOk = (id, where) => {
    if (!factsById) return;
    const f = factsById[id];
    if (!f) return P1(`${where}: факта ${id} нет в facts.json`);
    if (f.publish !== 'yes') return P1(`${where}: факт ${id} не публикуется`);
    if (dec.facts[id] && !decisionAllows(dec.facts[id].allow, page)) P1(`${where}: факт ${id} закрыт для этой страницы колонкой «Где можно» decisions.md`);
  };
  (e.facts || []).forEach(id => factOk(id, 'facts'));
  (e.hero_facts || []).forEach(id => factOk(id, 'hero_facts'));
  for (const id of e.hero_facts || []) if (!(e.facts || []).includes(id)) P1(`hero_facts: ${id} нет в facts страницы`);
  if (blocks) {
    for (const k of Object.keys(ov)) if (!blocks[k]) P1(`block_overrides.${k}: блока нет в типе ${page.type}`);
    for (const k of excluded) {
      if (!blocks[k]) P1(`exclude_blocks: блока ${k} нет в типе ${page.type}`);
      else if (blocks[k].role === 'hero') P1(`exclude_blocks: первый экран (${k}) исключать нельзя`);
    }
  } else W(`нет work/page-types/${page.type}.json - ключи block_overrides и exclude_blocks не проверены`);
  for (const [k, o] of Object.entries(ov)) {
    if (!o || typeof o !== 'object') continue;
    (Array.isArray(o.facts) ? o.facts : []).forEach(id => factOk(id, `block_overrides.${k}.facts`));
    const refs = taskFactRefs(o.task || '');
    refs.pos.forEach(id => factOk(id, `block_overrides.${k}.task`));
    if (refs.neg.length) P1(`block_overrides.${k}.task: id после отрицания (${refs.neg.join(', ')}) - в задании id фактов только утвердительно, запрет - словами`);
    if (objIds) for (const oid of o.objection_ids || []) if (!objIds.has(oid)) P1(`block_overrides.${k}.objection_ids: возражения ${oid} нет в audience.json`);
    if (dropIds.has(k) && Array.isArray(o.facts) && !o.facts.length && !refs.pos.length) W(`block_overrides.${k}: пустой facts - блок снимается со страницы (как exclude_blocks); оставить блок - дать факт`);
  }
  if (segIds && e.segment !== 'all' && !segIds.has(e.segment)) P1(`segment ${e.segment} нет в audience.json (или all)`);
  if (objIds) for (const oid of e.objection_ids || []) if (!objIds.has(oid)) P1(`objection_ids: возражения ${oid} нет в audience.json`);
  if (e.cta && typeof e.cta === 'object') for (const f of ['action', 'secondary_action']) { const err = checkCtaAction(`cta.${f}`, e.cta[f], blocks, excluded); if (err) P1(err); }
  // K7: страница с выдачей - главная кнопка без action ведет к форме или окну заявки, а не к выдаче (по данным)
  const listingBlock = blocks ? Object.values(blocks).find(b => b.pattern === 'listing' && !excluded.includes(b.id)) : null;
  if (page.listing === true || listingBlock) {
    const eff = mergeCta(globalCta(page.type), e.cta).cta;
    if (String(eff.main || '').trim() && !String(eff.action || '').trim()) W(`cta: у страницы с выдачей главная кнопка без action - она ведет к форме или окну заявки, а не к выдаче; выбор из каталога - action anchor:${listingBlock ? listingBlock.id : '<id блока листинга>'}, честная заявка - без action`);
  }
  return { problems, warnings };
}

// Проверка одного файла типа. Возвращает {type, entries:[[slug, entry]], problems:[...], missing:[...], content:{problems, warnings}, disputes}
function checkTypeFile(file) {
  const res = { file, type: '', entries: [], problems: [], missing: [], content: { problems: [], warnings: [] }, disputes: 0 };
  let d;
  try { d = readJson(file); } catch (e) { res.problems.push(`${rel(file)}: невалидный JSON: ${e.message}`); return res; }
  const base = path.basename(file, '.json');
  if (!d || typeof d !== 'object' || Array.isArray(d)) { res.problems.push(`${rel(file)}: ожидался объект {"type","pages"}`); return res; }
  res.type = base;
  if (d.type && d.type !== base) res.problems.push(`${rel(file)}: поле type="${d.type}" не совпадает с именем файла`);
  if (!d.pages || typeof d.pages !== 'object' || Array.isArray(d.pages)) { res.problems.push(`${rel(file)}: нет объекта pages`); return res; }
  if (d.disputes !== undefined) {
    const errs = validate({ type: 'array', items: { $ref: '#/definitions/dispute' } }, d.disputes, schema, 'disputes');
    if (errs.length) res.problems.push(...errs.map(e => `${rel(file)}: ${e}`));
    else res.disputes = d.disputes.length;
  }
  for (const [slug, entry] of Object.entries(d.pages)) {
    const errs = validate(pageSchema, entry, schema, `pages.${slug}`);
    if (!liveSlugs.has(slug)) errs.push(typeOf[slug] ? `pages.${slug}: страница в карте со status skip` : `pages.${slug}: slug нет в карте`);
    else if (typeOf[slug] !== res.type) errs.push(`pages.${slug}: в карте тип ${typeOf[slug]}, а файл типа ${res.type}`);
    if (errs.length) { res.problems.push(...errs.map(e => `${rel(file)}: ${e}`)); continue; }
    res.entries.push([slug, entry]);
    const c = contentChecks(slug, entry);
    res.content.problems.push(...c.problems.map(e => `${rel(file)}: ${e}`));
    res.content.warnings.push(...c.warnings.map(e => `${rel(file)}: ${e}`));
  }
  res.missing = live.filter(p => p.type === res.type && !(p.slug in d.pages)).map(p => p.slug);
  return res;
}

if (a.check) {
  const files = a._;
  if (!files.length) { console.error('usage: merge-strategy.mjs --check <work/strategy.pages/<type>.json ...>'); process.exit(2); }
  let bad = 0;
  for (const f of files) {
    if (!exists(f)) { console.log(`FAIL ${f}: нет файла`); bad++; continue; }
    const r = checkTypeFile(path.resolve(f));
    const probs = [...r.problems, ...r.content.problems, ...(r.missing.length ? [`${f}: нет записей для страниц типа ${r.type}: ${r.missing.join(', ')}`] : [])];
    if (probs.length) { bad++; console.log(`FAIL ${f}: ${probs.length} проблем`); probs.slice(0, 50).forEach(p => console.log(' - ' + p)); }
    else console.log(`OK ${f}: тип ${r.type}, страниц ${r.entries.length}${r.disputes ? `, споров ${r.disputes}` : ''}`);
    r.content.warnings.slice(0, 30).forEach(w => console.log(' ~ предупреждение: ' + w));
  }
  process.exit(bad ? 1 : 0);
}

if (!exists(STRATEGY)) { console.error('нет work/strategy.json: сначала глобальный стратег (prompts/04-strategist-global.md)'); process.exit(2); }
const strategy = readJson(STRATEGY);

// ---------- --matrix: таблица для рецензии стратегии ----------
if (a.matrix) {
  const clip = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 3) + '...' : t; };
  const cell = s => String(s).replace(/\|/g, '/');
  const stems = s => (String(s || '').toLowerCase().match(/[а-яa-z0-9]+/g) || []).filter(w => w.length >= 3).map(w => w.slice(0, 5));
  const shingles = s => { const w = stems(s); const out = new Set(); for (let i = 0; i + 2 <= w.length; i++) out.add(w[i] + ' ' + w[i + 1]); return out; };
  const jaccard = (x, y) => { const A = shingles(x), B = shingles(y); if (!A.size || !B.size) return 0; let n = 0; for (const g of A) if (B.has(g)) n++; return n / (A.size + B.size - n); };
  const segsOf = (slug, e) => (e.segment === 'all' ? (pageBySlug[slug]?.segments || ['all']) : [e.segment]);
  const rows = Object.entries(strategy.pages || {}).filter(([slug]) => liveSlugs.has(slug)).sort((x, y) => mapOrder[x[0]] - mapOrder[y[0]]);
  const lines = ['| slug | type | parent | segment | hook | unique_argument | hero_facts |', '|---|---|---|---|---|---|---|'];
  for (const [slug, e] of rows) {
    const p = pageBySlug[slug];
    const hf = (e.hero_facts || []).map(id => `${id} ${clip(factsById?.[id]?.wording || '?', 50)}`).join('; ');
    lines.push(`| ${slug} | ${p.type} | ${normPath(p.parent) || '-'} | ${e.segment}${e.segment === 'all' && p.segments ? ` (${p.segments.join(',')})` : ''} | ${cell(clip(e.hook, 110))} | ${cell(clip(e.unique_argument, 130))} | ${cell(hf)} |`);
  }
  const twins = [];
  for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) {
    const [s1, e1] = rows[i], [s2, e2] = rows[j];
    const p1 = pageBySlug[s1], p2 = pageBySlug[s2];
    const kin = (!!p2.parent && normPath(p2.parent) === normPath(p1.url)) || (!!p1.parent && normPath(p1.parent) === normPath(p2.url));
    const sameType = p1.type === p2.type && segsOf(s1, e1).some(x => segsOf(s2, e2).includes(x));
    if (!kin && !sameType) continue;
    const h1 = e1.hero_facts || [], h2 = e2.hero_facts || [];
    const common = h1.filter(x => h2.includes(x));
    const why = [];
    if (common.length && common.length / Math.min(h1.length, h2.length) >= 2 / 3) why.push(`общие hero_facts ${common.join(', ')}`);
    const jh = jaccard(e1.hook, e2.hook), ju = jaccard(e1.unique_argument, e2.unique_argument);
    if (jh >= 0.3) why.push(`похожий hook (${jh.toFixed(2)})`);
    if (ju >= 0.3) why.push(`похожий unique_argument (${ju.toFixed(2)})`);
    if (why.length) twins.push(`${s1} ~ ${s2} (${kin ? 'родитель-ребенок' : `тип ${p1.type}, общий сегмент`}): ${why.join('; ')}`);
  }
  const freq = {};
  for (const [slug, e] of rows) {
    for (const id of new Set(e.facts || [])) (freq[id] ??= { facts: 0, hero: 0 }).facts++;
    for (const id of new Set(e.hero_facts || [])) (freq[id] ??= { facts: 0, hero: 0 }).hero++;
  }
  const fl = Object.entries(freq).sort((x, y) => y[1].hero - x[1].hero || y[1].facts - x[1].facts).map(([id, c]) => `${id}: hero ${c.hero}, facts ${c.facts}`);
  const tail = ['', `## Близнецы (${twins.length})`, ...(twins.length ? twins.map(t => `- ${t}`) : ['- нет']), '', `## Частота фактов по страницам (hero_facts / facts)`, fl.join('; ') || '-'];
  const file = P('work', 'audit', 'strategy-matrix.md');
  writeText(file, [`# Матрица стратегии: страниц ${rows.length}`, '', ...lines, ...tail].join('\n') + '\n');
  // большая карта: таблица только в файле (вывод инструмента обрезал бы ее), в консоли - близнецы и частота фактов
  const MAX_ROWS_STDOUT = 40;
  console.log([`# Матрица стратегии: страниц ${rows.length}`, '', ...(rows.length <= MAX_ROWS_STDOUT ? lines : [`таблица (${rows.length} строк) - в файле ${rel(file)}, читать частями`]), ...tail].join('\n'));
  console.log(`\nматрица: ${rel(file)}; близнецов ${twins.length}`);
  process.exit(0);
}

if (a.split) {
  const byType = {};
  const orphans = [];
  for (const [slug, entry] of Object.entries(strategy.pages || {})) {
    const t = typeOf[slug];
    // slug без страницы в карте или со status skip - только в strategy.json: сборка такие записи отклоняет (код 1)
    if (!t || !liveSlugs.has(slug)) { orphans.push(slug); continue; }
    (byType[t] ??= {})[slug] = entry;
  }
  let written = 0, kept = 0;
  for (const [t, pages] of Object.entries(byType)) {
    const f = path.join(DIR, `${t}.json`);
    if (exists(f) && !a.force) { kept++; console.log(`есть, не трогаю: ${rel(f)}`); continue; }
    writeJson(f, { type: t, pages });
    written++;
    console.log(`${rel(f)}: страниц ${Object.keys(pages).length}`);
  }
  console.log(`разрезано: файлов ${written}, оставлено как есть ${kept}${orphans.length ? `; slug нет в карте или status skip (остаются только в strategy.json): ${orphans.join(', ')}` : ''}`);
  process.exit(0);
}

// сборка
const files = listFiles(DIR, '.json').sort((x, y) => {
  const tx = path.basename(x, '.json'), ty = path.basename(y, '.json');
  const ix = typeOrder.indexOf(tx), iy = typeOrder.indexOf(ty);
  return (ix < 0 ? 1e9 : ix) - (iy < 0 ? 1e9 : iy) || tx.localeCompare(ty);
});
const problems = [];
const contentWarnings = [];
const pages = { ...(strategy.pages || {}) };
const oldSlugs = new Set(Object.keys(pages));
const added = [];
let replaced = 0, merged = 0, disputes = 0;
const stats = { changed: 0 };
for (const f of files) {
  const r = checkTypeFile(f);
  problems.push(...r.problems);
  contentWarnings.push(...r.content.problems, ...r.content.warnings);
  disputes += r.disputes;
  for (const [slug, entry] of r.entries) {
    const clean = normalizeDeep(entry, stats);
    if (oldSlugs.has(slug)) replaced++; else added.push(slug);
    pages[slug] = clean;
    merged++;
  }
  console.log(`${rel(f)}: записей ${r.entries.length}${r.problems.length ? `, отклонено ${r.problems.length}` : ''}${r.missing.length ? `, нет записей для ${r.missing.length} страниц типа` : ''}`);
}
// CTA глобальной части: действие по контракту C3 (anchor проверяется по блокам типа)
for (const [t, c] of Object.entries((strategy.global || {}).cta_by_type || {})) {
  if (!c || typeof c !== 'object') continue;
  for (const f of ['action', 'secondary_action']) { const err = checkCtaAction(`global.cta_by_type.${t}.${f}`, c[f], typeBlocks(t), []); if (err) contentWarnings.push(err); }
}
// оговорка-дисклеймер - текст для читателя: служебная записка в брифы не пойдет (build-briefs)
{
  const dt = (strategy.global || {}).disclaimer_text || '';
  if (dt && isServiceText(dt)) contentWarnings.push(`global.disclaimer_text похож на служебную записку («${dt.slice(0, 80)}») - в брифы не пойдет; оговорка - текст для читателя, задания блокам - в task`);
}
// новые slug - в порядке карты, после прежних
const ordered = {};
for (const slug of Object.keys(pages)) if (oldSlugs.has(slug)) ordered[slug] = pages[slug];
for (const slug of added.sort((x, y) => (mapOrder[x] ?? 1e9) - (mapOrder[y] ?? 1e9))) ordered[slug] = pages[slug];
const out = { ...strategy, pages: ordered };
const errors = validate(schema, out);
if (errors.length) problems.push(...errors.map(e => `strategy.json после сборки: ${e}`));
writeJson(STRATEGY, out);
const uncovered = live.filter(p => !ordered[p.slug]).map(p => p.slug);
console.log(`strategy.json: файлов типов ${files.length}, записей из них ${merged} (заменено ${replaced}, новых ${added.length}), всего страниц ${Object.keys(ordered).length}${stats.changed ? `, нормализовано строк ${stats.changed}` : ''}${disputes ? `, споров стратегов ${disputes}` : ''}`);
if (!files.length) console.log('нет файлов work/strategy.pages/*.json: pages оставлены как были');
if (uncovered.length) console.log(`нет решений стратега для страниц карты (${uncovered.length}): ${uncovered.join(', ')}`);
problems.forEach(p => console.log(' - ' + p));
if (contentWarnings.length) { console.log(`предупреждения по содержанию (${contentWarnings.length}; в --check это проблемы, кроме помеченных):`); contentWarnings.slice(0, 40).forEach(w => console.log(' ~ ' + w)); }
process.exit(problems.length ? 1 : 0);
