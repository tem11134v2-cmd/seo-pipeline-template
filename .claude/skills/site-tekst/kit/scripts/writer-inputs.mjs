// Входы писателей фазы 5: срез брифа на блок (work/pages/<slug>/brief/<block_id>.json).
// Полный brief.json остается для линтера, судьи и фиксера; писатель блока и первого экрана читают только срез.
// Срез выводится из brief.json и помнит sha среза (_brief_sha1 = sha1 версии формата среза и текста brief.json):
// устаревший или недостающий срез пересобирается сам (build-briefs.mjs - всегда, page-state.mjs и plan-run.mjs --phase
// write - при расхождении). Новая версия формата (SLICE_FORMAT) пересобирает срезы старых задач. Писатель пишет этот sha
// в поле brief_sha файла блока (счетчик попыток attempts привязан к нему).
// Состав среза: все факты страницы (с owner_block, rule, note), unknowns, сегмент целиком (у «all» - с segments), рамка
// страницы, пожелания заказчика по адресу (where), оговорка - только блоку, за которым она закреплена (служебная записка
// вместо текста для читателя не передается); первому экрану - ключевая фраза страницы (key_phrase, K5); заметки
// агрегатора (block.notes) не передаются. Пример лидера - только форма: цифры в нем заменены на N, бренд (домен и его
// части) - на [компания].
// CLI: node scripts/writer-inputs.mjs [slug...]   (без аргументов - все страницы карты с brief.json)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { pageDir, exists, readJson, writeText, loadSchema, validate, loadSitemap, isListing, isServiceText, FINAL_CTA_IDS, esc } from './lib.mjs';

// slice-v3 (программа 28.09): маска примера лидера, без служебной записки, key_phrase у первого экрана. Смена версии
// пересобирает срезы задач в работе без пересборки брифов и сбрасывает attempts их блоков (sha среза другой).
export const SLICE_FORMAT = 'slice-v3';
// sha среза по тексту brief.json (тот же, что _brief_sha1 в срезах этой страницы)
export const briefSha = text => crypto.createHash('sha1').update(`${SLICE_FORMAT}\n${text}`).digest('hex');

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
const needsLinks = b => isListing(b) || (b.elements || []).some(e => LINK_KINDS.has(e.kind));
// Один пример конкурента на блок: первый (агрегатор кладет их по силе) с обоснованием и не короче 80 знаков, иначе первый.
const bestExample = ex => (ex || []).find(e => e.why_strong && (e.text || '').length >= 80) || (ex || [])[0];
// Маска примера лидера для писателя: пример нужен как форма, а не как источник фактов. Цифры -> N (адреса, сроки, годы,
// цены чужой компании), домен и его части латиницей от 3 букв -> [компания]. Поле domain тоже маскируется.
export function maskExample(ex) {
  if (!ex) return ex;
  const host = String(ex.domain || '').toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
  const base = host.replace(/\.[a-z]{2,}(\.[a-z]{2,})?$/, '');
  // части домена - только латиницей: кириллический домен («окна.рф») маскируется целиком, иначе ушло бы слово «окна»
  const parts = [...new Set([host, ...[base, ...base.split(/[-_.]/)].filter(x => /^[a-z0-9-]+$/.test(x))].filter(x => x && x.length >= 3))].sort((a, b) => b.length - a.length);
  const mask = s => {
    let t = String(s ?? '');
    for (const p of parts) t = t.replace(new RegExp(`(?<![a-z0-9])${esc(p)}(?![a-z0-9])`, 'gi'), '[компания]');
    return t.replace(/\d+(?:[.,  :/-]?\d+)*/g, 'N');
  };
  return { ...ex, domain: '[компания]', text: mask(ex.text), ...(ex.why_strong ? { why_strong: mask(ex.why_strong) } : {}) };
}

// Пожелания заказчика по адресу (where пожелания - токены через запятую):
// без адреса (пусто, tone, all, must-say без решения стратега) - во все срезы; shell (шапка и подвал) и none - ни в один;
// id или тип блока - в срез этого блока; первому экрану еще candidate и адреса hero, positioning, cta.
const PREF_ALL = new Set(['', 'tone', 'all', 'все', 'must-say']);
const PREF_NONE = new Set(['shell', 'none']);
const PREF_HERO = new Set(['hero', 'positioning', 'cta']);
const whereTokens = w => String(w || '').toLowerCase().split(/[,;]/).map(x => x.trim()).filter(Boolean);
export function prefsForBlock(prefs, b) {
  const hero = b.role === 'hero';
  return (prefs || []).filter(x => {
    const toks = whereTokens(x.where);
    if (!toks.length || toks.some(t => PREF_ALL.has(t))) return true;
    if (toks.every(t => PREF_NONE.has(t))) return false;
    // финальный призыв: адрес cta-final и блок cta старых данных (и наоборот) - синонимы
    const type = String(b.type).toLowerCase();
    const sameBlock = t => t === type || (FINAL_CTA_IDS.includes(t) && FINAL_CTA_IDS.includes(type));
    if (toks.some(t => sameBlock(t) || t === String(b.block_id).toLowerCase())) return true;
    return hero && (x.status === 'candidate' || toks.some(t => PREF_HERO.has(t)));
  }).map(x => ({ text: x.text, status: x.status, ...(x.where ? { where: x.where } : {}) }));
}

export function sliceBrief(brief, sha = '') {
  const allObj = brief.segment?.objections || [];
  const seg = brief.segment || {};
  // label и angle (угол подачи от стратега) - смысл факта: без них писатель искажал цифры («до 14% уже за вычетом
  // расходов», второй пилот, A/B 2026-09-23). Режем объем (примеры конкурентов, ссылки), а не смысл.
  // rule - разрешенная формулировка из decisions.md, note - условие факта, owner_block - домашний блок факта (дом из стратегии, иначе первый блок с фактом).
  const facts = (brief.facts || []).map(f => ({ id: f.id, ...(f.label ? { label: f.label } : {}), wording: f.wording, ...(f.value && f.value !== f.wording ? { value: f.value } : {}), ...(f.kind ? { kind: f.kind } : {}), ...(f.angle ? { angle: f.angle } : {}), ...(f.note ? { note: f.note } : {}), ...(f.rule ? { rule: f.rule } : {}), ...(f.owner_block ? { owner_block: f.owner_block } : {}) }));
  const outline = (brief.blocks || []).map(b => `${b.block_id}: ${b.reader_question || b.name || ''}`);
  const links = (brief.links || []).map(l => ({ url: l.url, subject: l.subject }));
  return (brief.blocks || []).map(b => {
    const hero = b.role === 'hero';
    const own = new Set(b.objection_ids || []);
    const ex = bestExample(b.examples);
    const prefs = prefsForBlock(brief.client_preferences, b);
    const { notes, disclaimer_text: pinned, ...block } = b;
    // оговорка: закрепленная за блоком (старые брифы без закрепления - всем, как раньше); служебная записка - никому
    const disclaimer = pinned || (!brief.blocks.some(x => x.disclaimer_text) ? brief.disclaimer_text : '');
    const slice = {
      _brief_sha1: sha,
      slug: brief.slug, url: brief.url, type: brief.type, subject: brief.subject,
      ...(hero && brief.key_phrase ? { key_phrase: brief.key_phrase } : {}),
      geo: brief.geo || '', block_set: brief.block_set,
      company: brief.company || '',
      segment: {
        id: seg.id, name: seg.name, portrait: seg.portrait, comes_with: seg.comes_with || '', pains: seg.pains || [], fears: seg.fears || [], criteria: seg.criteria || [],
        // возражения блока - целиком с ответом; первому экрану - еще и список всех возражений страницы (без ответов)
        objections: allObj.filter(o => own.has(o.id)),
        ...(hero ? { objections_page: allObj.filter(o => !own.has(o.id)).map(o => ({ id: o.id, text: o.text })) } : {}),
        // страница для всех сегментов (segment all): сценарии каждого сегмента
        ...(Array.isArray(seg.segments) && seg.segments.length ? { segments: seg.segments } : {}),
      },
      // позиционирование и формула оффера - рамка всей страницы, нужна каждому блоку, не только первому экрану
      positioning: brief.positioning || '',
      unique_argument: brief.unique_argument || '', hook: brief.hook || '', main_promise: brief.main_promise || '',
      offer_formula: brief.offer_formula,
      cta: brief.cta || { main: '' },
      facts,
      ...(Array.isArray(brief.unknowns) && brief.unknowns.length ? { unknowns: brief.unknowns } : {}),
      anti_promises: brief.anti_promises || [],
      // оговорка-дисклеймер - только блоку, за которым ее закрепил сборщик брифов (старые брифы - всем, как раньше)
      ...(disclaimer && !isServiceText(disclaimer) ? { disclaimer_text: disclaimer } : {}),
      terminology: brief.terminology || {},
      client_phrases: brief.client_phrases || [],
      do_not_say: brief.do_not_say || [],
      cliches_to_avoid: brief.cliches_to_avoid || [],
      ...(prefs.length ? { client_preferences: prefs } : {}),
      ...(needsLinks(b) ? { links } : {}),
      page_outline: outline,
      block: { ...block, examples: ex ? [maskExample(ex)] : [] },
    };
    return { block_id: b.block_id, slice };
  });
}

const sliceDir = slug => path.join(pageDir(slug), 'brief');

// Пишет срезы всех блоков страницы из brief.json на диске, убирает срезы блоков, которых больше нет в брифе.
export function writeSlices(slug) {
  const file = path.join(pageDir(slug), 'brief.json');
  if (!exists(file)) return { written: 0, errors: [`${slug}: нет brief.json`] };
  const text = fs.readFileSync(file, 'utf8');
  const brief = JSON.parse(text);
  const schema = loadSchema('brief-slice');
  const errors = [];
  const items = sliceBrief(brief, briefSha(text));
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
    const sha = briefSha(text);
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
