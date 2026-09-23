// Входы писателей фазы 5: срез брифа на блок (work/pages/<slug>/brief/<block_id>.json).
// Полный brief.json остается для линтера, судьи и фиксера; писатель блока и первого экрана читают только срез.
// Срез выводится из brief.json и помнит его sha1 (_brief_sha1): устаревший или недостающий срез пересобирается сам
// (build-briefs.mjs - всегда, page-state.mjs и plan-run.mjs --phase write - при расхождении).
// CLI: node scripts/writer-inputs.mjs [slug...]   (без аргументов - все страницы карты с brief.json)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { pageDir, exists, readJson, writeText, loadSchema, validate, loadSitemap } from './lib.mjs';

// JSON для чтения агентом: короткие объекты и массивы в одну строку, длинные - построчно с отступом в 1 пробел.
export function compactJson(v, indent = '', width = 200) {
  const flat = JSON.stringify(v);
  if (v === null || typeof v !== 'object' || flat.length + indent.length <= width) return flat;
  const ni = indent + ' ';
  if (Array.isArray(v) && v.every(x => x === null || typeof x !== 'object')) {
    // массив строк и чисел - плотными строками до ширины
    const lines = [];
    for (const s of v.map(x => JSON.stringify(x))) {
      if (lines.length && lines[lines.length - 1].length + s.length + 1 + ni.length <= width) lines[lines.length - 1] += ',' + s;
      else lines.push(s);
    }
    return `[\n${lines.map(l => ni + l).join(',\n')}\n${indent}]`;
  }
  if (Array.isArray(v)) return v.length ? `[\n${v.map(x => ni + compactJson(x, ni, width)).join(',\n')}\n${indent}]` : '[]';
  const ent = Object.entries(v).filter(([, x]) => x !== undefined);
  return ent.length ? `{\n${ent.map(([k, x]) => `${ni}${JSON.stringify(k)}: ${compactJson(x, ni, width)}`).join(',\n')}\n${indent}}` : '{}';
}
export function writeCompact(file, obj) { writeText(file, compactJson(obj) + '\n'); }

// Виды элементов, которым нужны ссылки из карты (href у ссылок, кнопок, карточек; витрина каталога)
const LINK_KINDS = new Set(['link', 'button', 'card']);
const needsLinks = b => b.type === 'listing' || b.pattern === 'listing' || (b.elements || []).some(e => LINK_KINDS.has(e.kind));
// Один пример конкурента на блок: первый (агрегатор кладет их по силе) с обоснованием и не короче 80 знаков, иначе первый.
const bestExample = ex => (ex || []).find(e => e.why_strong && (e.text || '').length >= 80) || (ex || [])[0];

export function sliceBrief(brief, sha = '') {
  const allObj = brief.segment?.objections || [];
  const seg = brief.segment || {};
  // label и angle (угол подачи от стратега) - смысл факта: без них писатель искажал цифры («до 14% уже за вычетом
  // расходов», второй пилот, A/B 2026-09-23). Режем объем (примеры конкурентов, ссылки), а не смысл.
  const facts = (brief.facts || []).map(f => ({ id: f.id, ...(f.label ? { label: f.label } : {}), wording: f.wording, ...(f.value && f.value !== f.wording ? { value: f.value } : {}), ...(f.kind ? { kind: f.kind } : {}), ...(f.angle ? { angle: f.angle } : {}) }));
  const outline = (brief.blocks || []).map(b => `${b.block_id}: ${b.reader_question || b.name || ''}`);
  const links = (brief.links || []).map(l => ({ url: l.url, subject: l.subject }));
  return (brief.blocks || []).map(b => {
    const hero = b.role === 'hero';
    const own = new Set(b.objection_ids || []);
    const ex = bestExample(b.examples);
    const slice = {
      _brief_sha1: sha,
      slug: brief.slug, url: brief.url, type: brief.type, subject: brief.subject, geo: brief.geo || '', block_set: brief.block_set,
      company: brief.company || '',
      segment: {
        id: seg.id, name: seg.name, portrait: seg.portrait, comes_with: seg.comes_with || '', pains: seg.pains || [], fears: seg.fears || [], criteria: seg.criteria || [],
        // возражения блока - целиком с ответом; первому экрану - еще и список всех возражений страницы (без ответов)
        objections: allObj.filter(o => own.has(o.id)),
        ...(hero ? { objections_page: allObj.filter(o => !own.has(o.id)).map(o => ({ id: o.id, text: o.text })) } : {}),
      },
      // позиционирование и формула оффера - рамка всей страницы, нужна каждому блоку, не только первому экрану
      positioning: brief.positioning || '',
      unique_argument: brief.unique_argument || '', hook: brief.hook || '', main_promise: brief.main_promise || '',
      offer_formula: brief.offer_formula,
      cta: brief.cta || { main: '' },
      facts,
      anti_promises: brief.anti_promises || [],
      disclaimer_text: brief.disclaimer_text || '',
      terminology: brief.terminology || {},
      client_phrases: brief.client_phrases || [],
      do_not_say: brief.do_not_say || [],
      cliches_to_avoid: brief.cliches_to_avoid || [],
      ...(hero ? { client_preferences: brief.client_preferences || [] } : {}),
      ...(needsLinks(b) ? { links } : {}),
      page_outline: outline,
      block: { ...b, examples: ex ? [ex] : [] },
    };
    return { block_id: b.block_id, slice };
  });
}

const sliceDir = slug => path.join(pageDir(slug), 'brief');
const sha1 = s => crypto.createHash('sha1').update(s).digest('hex');

// Пишет срезы всех блоков страницы из brief.json на диске, убирает срезы блоков, которых больше нет в брифе.
export function writeSlices(slug) {
  const file = path.join(pageDir(slug), 'brief.json');
  if (!exists(file)) return { written: 0, errors: [`${slug}: нет brief.json`] };
  const text = fs.readFileSync(file, 'utf8');
  const brief = JSON.parse(text);
  const schema = loadSchema('brief-slice');
  const errors = [];
  const items = sliceBrief(brief, sha1(text));
  const dir = sliceDir(slug);
  const keep = new Set(items.map(x => `${x.block_id}.json`));
  if (exists(dir)) for (const f of fs.readdirSync(dir)) if (f.endsWith('.json') && !keep.has(f)) fs.rmSync(path.join(dir, f));
  let written = 0;
  for (const { block_id, slice } of items) {
    const e = validate(schema, slice);
    if (e.length) { errors.push(`${slug}/${block_id}: срез не прошел схему: ${e.slice(0, 3).join('; ')}`); continue; }
    writeCompact(path.join(dir, `${block_id}.json`), slice);
    written++;
  }
  return { written, errors };
}

// 'ok' - срезы на месте и совпадают с brief.json; 'rebuilt' - пересобраны; 'error: ...' - не удалось; 'no-brief'
export function ensureSlices(slug) {
  const file = path.join(pageDir(slug), 'brief.json');
  if (!exists(file)) return 'no-brief';
  try {
    const text = fs.readFileSync(file, 'utf8');
    const sha = sha1(text);
    const ids = (JSON.parse(text).blocks || []).map(b => b.block_id);
    const fresh = ids.length && ids.every(id => {
      const f = path.join(sliceDir(slug), `${id}.json`);
      if (!exists(f)) return false;
      try { return readJson(f)._brief_sha1 === sha; } catch { return false; }
    });
    if (fresh) return 'ok';
    const r = writeSlices(slug);
    return r.errors.length ? `error: ${r.errors[0]}` : 'rebuilt';
  } catch (e) { return `error: ${e.message}`; }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let slugs = process.argv.slice(2);
  if (!slugs.length) slugs = loadSitemap().pages.filter(p => p.status !== 'skip' && exists(path.join(pageDir(p.slug), 'brief.json'))).map(p => p.slug);
  let n = 0; const errs = [];
  for (const s of slugs) { const r = writeSlices(s); n += r.written; errs.push(...r.errors); }
  console.log(`срезов брифа: ${n} на ${slugs.length} стр., ошибок: ${errs.length}`);
  errs.forEach(e => console.log(' - ' + e));
  if (errs.length) process.exit(1);
}
