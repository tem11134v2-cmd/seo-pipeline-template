// Сборка брифов страниц из карты, типов страниц, стратегии, фактов и аудитории.
// node scripts/build-briefs.mjs [slug...] [--force]
// Кроме brief.json пишет срезы для писателей work/pages/<slug>/brief/<block_id>.json (scripts/writer-inputs.mjs) -
// и для новых брифов, и для уже существующих (они не пересобираются без --force, срезы обновляются всегда).
import path from 'node:path';
import { argv, P, readJson, writeJson, exists, loadConfig, loadSitemap, saveSitemap, pageDir, validate, loadSchema } from './lib.mjs';
import { writeSlices } from './writer-inputs.mjs';

const a = argv({ force: 'bool' });
const cfg = loadConfig();
const sm = loadSitemap();
const facts = readJson(P('work', 'facts.json'));
const audience = readJson(P('work', 'audience.json'));
const strategy = readJson(P('work', 'strategy.json'));
const formulas = exists(P('rules', 'offer-formulas.json')) ? readJson(P('rules', 'offer-formulas.json')) : { formulas: [] };
const prefs = exists(P('work', 'client-preferences.json')) ? readJson(P('work', 'client-preferences.json')) : { items: [] };
const limits = cfg.limits || {};
const kindCap = { h1: limits.h1_max, sub: limits.sub_max, text: limits.text_max, bullets: limits.bullet_max, button: limits.button_max };

let slugs = a._;
const pages = sm.pages.filter(p => p.status !== 'skip' && (!slugs.length || slugs.includes(p.slug)));
const factsById = Object.fromEntries(facts.facts.map(f => [f.id, f]));
const segById = Object.fromEntries(audience.segments.map(s => [s.id, s]));
let built = 0, skipped = 0, sliced = 0;
const problems = [];
function slice(slug) { const r = writeSlices(slug); sliced += r.written; problems.push(...r.errors); }

for (const page of pages) {
  const out = path.join(pageDir(page.slug), 'brief.json');
  if (exists(out) && !a.force) { skipped++; slice(page.slug); continue; }
  const typeFile = P('work', 'page-types', `${page.type}.json`);
  if (!exists(typeFile)) { problems.push(`${page.slug}: нет файла типа страницы ${page.type}`); continue; }
  const pt = readJson(typeFile);
  const ps = strategy.pages[page.slug];
  if (!ps) { problems.push(`${page.slug}: нет решений стратега`); continue; }
  const seg = segById[ps.segment];
  if (!seg) { problems.push(`${page.slug}: сегмент ${ps.segment} не найден в audience.json`); continue; }
  const allBlocks = [...pt.market_blocks, ...pt.differentiation_blocks];
  const byId = Object.fromEntries(allBlocks.map(b => [b.id, b]));
  let order = pt.recommended_order.filter(id => byId[id]);
  if (page.block_set === 'short') {
    const short = pt.short_set && pt.short_set.length ? pt.short_set : allBlocks.filter(b => b.core).map(b => b.id);
    order = order.filter(id => short.includes(id));
  }
  if (!order.length) { problems.push(`${page.slug}: пустой порядок блоков`); continue; }
  // стратег называет факты и в тексте задания блока: такие факты тоже идут в бриф, иначе писатель получает задание
  // «используй F16», а самого факта не видит (второй пилот: F05, F11, F16, F24 на категории)
  const publishable = id => !!(factsById[id] && factsById[id].publish === 'yes');
  const taskRefs = id => [...new Set((((ps.block_overrides || {})[id] || {}).task || '').match(/\bF\d{2,3}\b/g) || [])];
  const refIds = order.flatMap(id => taskRefs(id));
  for (const id of new Set(refIds)) if (!publishable(id)) problems.push(`${page.slug}: задание блока ссылается на ${id}, которого нет среди публикуемых фактов`);
  const pageFacts = [...new Set([...(ps.facts || []), ...refIds])].map(id => factsById[id]).filter(f => f && f.publish === 'yes');
  const heroFacts = (ps.hero_facts && ps.hero_facts.length ? ps.hero_facts : pageFacts.slice(0, 4).map(f => f.id)).filter(id => factsById[id]);
  // возражения страницы: свои по сегменту плюс те, что стратег назначил блокам явно (могут быть из других сегментов)
  const allObjections = audience.segments.flatMap(s => s.objections.map(o => ({ ...o, segment: s.id })));
  const overrideObjIds = Object.values(ps.block_overrides || {}).flatMap(o => o.objection_ids || []);
  const objIds = [...new Set([...(ps.objection_ids || []), ...overrideObjIds])];
  const objections = objIds.map(id => allObjections.find(o => o.id === id)).filter(Boolean);
  const slots = order.filter(id => byId[id].objection_slot);
  const objByBlock = {};
  objections.forEach((o, i) => { const id = slots.length ? slots[i % slots.length] : null; if (id) (objByBlock[id] ??= []).push(o.id); });
  const cta = ps.cta && ps.cta.main ? ps.cta : (strategy.global.cta_by_type[page.type] || { main: '' });
  const formulaId = ps.offer_formula || strategy.global.offer_formula_by_type[page.type] || '';
  const formula = formulas.formulas.find(f => f.id === formulaId) || { id: formulaId, name: formulaId, recipe: '' };
  const bank = Object.fromEntries((strategy.global.argument_bank || []).map(b => [b.fact_id, b.angles]));

  const blocks = order.map((id, i) => {
    const b = byId[id];
    const ov = (ps.block_overrides || {})[id] || {};
    let bfacts = ov.facts;
    if (!bfacts) {
      if (b.role === 'hero') bfacts = heroFacts;
      else if (b.fact_kinds && b.fact_kinds.length) bfacts = pageFacts.filter(f => b.fact_kinds.includes(f.kind)).map(f => f.id).slice(0, 6);
      else bfacts = [];
    }
    bfacts = [...new Set([...bfacts, ...taskRefs(id).filter(publishable)])];
    // витрина каталога: писатель дает только вступление и подписи фильтров, карточки приходят из спецификации каталога
    const isListing = id === 'listing' || b.pattern === 'listing';
    const LISTING_KINDS = new Set(['h2', 'h3', 'sub', 'text', 'filters', 'link', 'button', 'note']);
    const elements = b.elements.filter(e => !isListing || LISTING_KINDS.has(e.kind)).map(e => {
      const cap = kindCap[e.kind];
      const max = Math.min(e.chars.max || cap || 350, cap ? cap * 1.2 : 900);
      return { kind: e.kind, count: e.count, chars: { min: e.chars.min || 0, median: e.chars.median || 0, max: Math.round(max) }, note: e.note || '' };
    });
    if (isListing && !elements.some(e => e.kind === 'filters')) elements.push({ kind: 'filters', count: '3-7', chars: { min: 5, median: 12, max: 30 }, note: 'подписи фильтров каталога' });
    return {
      block_id: `B${String(i + 1).padStart(2, '0')}-${id}`,
      type: id, name: b.name, role: b.role, reader_question: b.reader_question, pattern: b.pattern,
      cta_allowed: b.role === 'hero' ? true : !!b.cta_allowed,
      objection_ids: ov.objection_ids || objByBlock[id] || [],
      facts: bfacts,
      elements,
      examples: (b.examples || []).slice(0, 3),
      task: ov.task || '',
      notes: b.notes || '',
    };
  });
  // drop_blocks_without_facts: "reviews" - блок выпадает без фактов; "cases:number" - выпадает, если среди фактов нет факта этого вида
  const dropRules = {};
  for (const item of limits.drop_blocks_without_facts || []) { const [id, kind] = String(item).split(':'); dropRules[id] = kind || null; }
  const mustDrop = b => {
    if (!(b.type in dropRules)) return false;
    const kind = dropRules[b.type];
    if (!kind) return !b.facts.length;
    return !b.facts.some(fid => factsById[fid] && factsById[fid].kind === kind);
  };
  const droppedBlocks = blocks.filter(mustDrop).map(b => b.type);
  if (droppedBlocks.length) {
    console.log(`${page.slug}: без фактов выпали блоки ${droppedBlocks.join(', ')}`);
    const kept = blocks.filter(b => !mustDrop(b));
    blocks.length = 0;
    kept.forEach((b, i) => { b.block_id = `B${String(i + 1).padStart(2, '0')}-${b.type}`; blocks.push(b); });
  }
  const brief = {
    slug: page.slug, url: page.url, type: page.type, subject: page.subject, geo: page.geo || '', block_set: page.block_set || 'full',
    company: cfg.company, positioning: strategy.global.positioning || '', main_promise: strategy.global.main_promise || '',
    segment: { id: seg.id, name: seg.name, portrait: seg.portrait, comes_with: seg.comes_with || '', pains: seg.pains, fears: seg.fears, criteria: seg.criteria || [], objections },
    unique_argument: ps.unique_argument, hook: ps.hook || '',
    offer_formula: { id: formula.id, name: formula.name, recipe: formula.recipe || '' },
    cta,
    facts: pageFacts.map(f => ({ id: f.id, label: f.label, value: f.value, wording: f.wording, kind: f.kind, angle: ((bank[f.id] || []).find(x => x.segment === seg.id) || {}).angle || '' })),
    anti_promises: (facts.anti_promises || []).map(x => ({ id: x.id, text: x.text, allowed_context: x.allowed_context || '' })),
    disclaimer_text: strategy.global.disclaimer_text || '',
    terminology: facts.terminology,
    client_phrases: (audience.client_phrases || []).filter(p => !p.segments || !p.segments.length || p.segments.includes(seg.id)).slice(0, 15).map(p => ({ phrase: p.phrase, meaning: p.meaning, ...(p.src ? { src: p.src } : {}) })),
    do_not_say: ps.do_not_say || [],
    cliches_to_avoid: pt.cliches_to_avoid || [],
    // pages не задан или пуст - пожелание для всех страниц
    client_preferences: (prefs.items || []).filter(x => !x.pages || !x.pages.length || x.pages.includes(page.slug)).map(x => ({ text: x.text, status: x.status, where: x.where || '' })),
    // разрешенные ссылки: только страницы карты (дети страницы, соседи, верхние уровни); писатель не выдумывает URL
    links: sm.pages.filter(p => p.status !== 'skip' && p.slug !== page.slug && (p.level <= 1 || (page.type === 'home' && p.level <= 2) || ['hub', 'service'].includes(p.type) || p.parent === page.url || p.parent === page.parent || page.url.startsWith(p.url + '/'))).map(p => ({ url: p.url, subject: p.subject, type: p.type })).slice(0, 60),
    blocks,
  };
  const errors = validate(loadSchema('brief'), brief);
  if (errors.length) { problems.push(`${page.slug}: бриф не прошел схему: ${errors.slice(0, 3).join('; ')}`); continue; }
  writeJson(out, brief);
  slice(page.slug);
  page.status = page.status === 'planned' ? 'briefed' : page.status;
  built++;
}
saveSitemap(sm);
console.log(`брифов собрано: ${built}, пропущено (уже есть): ${skipped}, срезов для писателей: ${sliced}, проблем: ${problems.length}`);
problems.forEach(p => console.log(' - ' + p));
if (problems.length) process.exit(1);
