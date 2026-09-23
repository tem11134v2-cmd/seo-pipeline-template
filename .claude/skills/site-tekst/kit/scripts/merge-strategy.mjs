// Стратегия по страницам: стратеги типов пишут каждый свой файл work/strategy.pages/<type>.json (параллельно),
// скрипт собирает из них work/strategy.json в прежнем формате. Глобальную часть пишет глобальный стратег, она не меняется.
// Файл типа: {"type":"<type>","pages":{"<slug>":{запись по schemas/strategy.schema.json -> pages}}}
//
// node scripts/merge-strategy.mjs                 - собрать: pages = прежние pages из strategy.json + записи всех файлов типов
//                                                   (запись файла типа заменяет прежнюю запись того же slug на ее месте, новые -
//                                                   в конец в порядке карты); global и прочие поля strategy.json не трогаются
// node scripts/merge-strategy.mjs --check <file...> - проверить файлы типов: схема записей, slug есть в карте с этим типом,
//                                                   покрыты все страницы типа (без status skip); файлы не меняет
// node scripts/merge-strategy.mjs --split [--force] - разрезать pages существующего strategy.json по типам карты в
//                                                   strategy.pages/<type>.json (перевод старого проекта; без --force не перезаписывает;
//                                                   записи страниц со status skip и вне карты остаются только в strategy.json)
// Код выхода: 0 - без проблем, 1 - есть проблемы (при сборке валидные записи все равно собраны), 2 - нет входных файлов.
import path from 'node:path';
import { argv, P, readJson, writeJson, exists, listFiles, loadSitemap, loadSchema, validate, normalizeDeep } from './lib.mjs';

const a = argv({ check: 'bool', split: 'bool', force: 'bool' });
const STRATEGY = P('work', 'strategy.json');
const DIR = P('work', 'strategy.pages');
const schema = loadSchema('strategy');
const pageSchema = schema.properties.pages.additionalProperties;
const sm = loadSitemap();
const live = sm.pages.filter(p => p.status !== 'skip');
const typeOf = Object.fromEntries(sm.pages.map(p => [p.slug, p.type]));
const liveSlugs = new Set(live.map(p => p.slug));
const mapOrder = Object.fromEntries(sm.pages.map((p, i) => [p.slug, i]));
const typeOrder = [...new Set(live.map(p => p.type))];
const rel = f => path.relative(process.cwd(), f).replace(/\\/g, '/');

// Проверка одного файла типа. Возвращает {type, entries:[[slug, entry]], problems:[...], missing:[...]}
function checkTypeFile(file) {
  const res = { file, type: '', entries: [], problems: [], missing: [] };
  let d;
  try { d = readJson(file); } catch (e) { res.problems.push(`${rel(file)}: невалидный JSON: ${e.message}`); return res; }
  const base = path.basename(file, '.json');
  if (!d || typeof d !== 'object' || Array.isArray(d)) { res.problems.push(`${rel(file)}: ожидался объект {"type","pages"}`); return res; }
  res.type = base;
  if (d.type && d.type !== base) res.problems.push(`${rel(file)}: поле type="${d.type}" не совпадает с именем файла`);
  if (!d.pages || typeof d.pages !== 'object' || Array.isArray(d.pages)) { res.problems.push(`${rel(file)}: нет объекта pages`); return res; }
  for (const [slug, entry] of Object.entries(d.pages)) {
    const errs = validate(pageSchema, entry, schema, `pages.${slug}`);
    if (!liveSlugs.has(slug)) errs.push(typeOf[slug] ? `pages.${slug}: страница в карте со status skip` : `pages.${slug}: slug нет в карте`);
    else if (typeOf[slug] !== res.type) errs.push(`pages.${slug}: в карте тип ${typeOf[slug]}, а файл типа ${res.type}`);
    if (errs.length) { res.problems.push(...errs.map(e => `${rel(file)}: ${e}`)); continue; }
    res.entries.push([slug, entry]);
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
    const probs = [...r.problems, ...(r.missing.length ? [`${f}: нет записей для страниц типа ${r.type}: ${r.missing.join(', ')}`] : [])];
    if (probs.length) { bad++; console.log(`FAIL ${f}: ${probs.length} проблем`); probs.slice(0, 50).forEach(p => console.log(' - ' + p)); }
    else console.log(`OK ${f}: тип ${r.type}, страниц ${r.entries.length}`);
  }
  process.exit(bad ? 1 : 0);
}

if (!exists(STRATEGY)) { console.error('нет work/strategy.json: сначала глобальный стратег (prompts/04-strategist-global.md)'); process.exit(2); }
const strategy = readJson(STRATEGY);

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
const pages = { ...(strategy.pages || {}) };
const oldSlugs = new Set(Object.keys(pages));
const added = [];
let replaced = 0, merged = 0;
const stats = { changed: 0 };
for (const f of files) {
  const r = checkTypeFile(f);
  problems.push(...r.problems);
  for (const [slug, entry] of r.entries) {
    const clean = normalizeDeep(entry, stats);
    if (oldSlugs.has(slug)) replaced++; else added.push(slug);
    pages[slug] = clean;
    merged++;
  }
  console.log(`${rel(f)}: записей ${r.entries.length}${r.problems.length ? `, отклонено ${r.problems.length}` : ''}${r.missing.length ? `, нет записей для ${r.missing.length} страниц типа` : ''}`);
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
console.log(`strategy.json: файлов типов ${files.length}, записей из них ${merged} (заменено ${replaced}, новых ${added.length}), всего страниц ${Object.keys(ordered).length}${stats.changed ? `, нормализовано строк ${stats.changed}` : ''}`);
if (!files.length) console.log('нет файлов work/strategy.pages/*.json: pages оставлены как были');
if (uncovered.length) console.log(`нет решений стратега для страниц карты (${uncovered.length}): ${uncovered.join(', ')}`);
problems.forEach(p => console.log(' - ' + p));
process.exit(problems.length ? 1 : 0);
