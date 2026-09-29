// Сборка брифов страниц из карты, типов страниц, стратегии, фактов и аудитории.
// node scripts/build-briefs.mjs [slug...] [--force]
// Кроме brief.json пишет срезы для писателей work/pages/<slug>/brief/<block_id>.json (scripts/writer-inputs.mjs) -
// и для новых брифов, и для уже существующих (они не пересобираются без --force, срезы обновляются всегда).
// Редакционный стандарт (config/house_style.md): sub вне первого экрана и h2/text сеток с карточками - необязательные
// (count 0-N), лимит карточки limits.card_max, возражение - в блок из global.objection_to_block, факт с явным домом
// (block_overrides) не раздается другим блокам, соседние блоки по fact_kinds не получают одни и те же факты.
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
// карточка и шаг - заголовок + 1-2 коротких предложения (редакционный стандарт, config/house_style.md): лимит текста
// limits.card_max (по умолчанию 150 символов без пробелов), даже если у конкурентов карточки длиннее
const kindCap = { h1: limits.h1_max, sub: limits.sub_max, text: limits.text_max, bullets: limits.bullet_max, button: limits.button_max, card: limits.card_max ?? 150, step: limits.card_max ?? 150 };
// Необязательные слоты (редакционный стандарт: заголовок и подзаголовок - только если добавляют смысл). Вне первого экрана
// sub всегда 0-N; у сеток и плиток, где карточки, шаги или ссылки сами называют разделы, h2 и поясняющий text тоже 0-N.
// Писатель решает по 5 вопросам стандарта, линтер structure.element-missing на count «0-...» не срабатывает.
const SELF_NAMED_PATTERNS = new Set(limits.self_named_patterns || ['tiles', 'grid-2', 'grid-3', 'grid-4', 'cards-slider']);
function optionalCount(b, e) {
  const m = String(e.count).match(/^(\d+)(?:-(\d+))?$/);
  if (!m || m[1] === '0') return e.count;
  // первый экран: одно главное доказательство - в sub или одном пункте; пункты-доказательства необязательны, верх из замеров
  if (b.role === 'hero') return ['bullets', 'badges'].includes(e.kind) ? `0-${m[2] || m[1]}` : e.count;
  const selfNamed = SELF_NAMED_PATTERNS.has(b.pattern) && b.elements.some(x => ['card', 'step', 'link'].includes(x.kind));
  if (e.kind === 'sub' || (selfNamed && ['h2', 'text'].includes(e.kind))) return `0-${m[2] || m[1]}`;
  return e.count;
}

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
  // первый экран: одно главное доказательство (редакционный стандарт) - без решения стратега берутся 2 первых факта, не 4
  const heroFacts = (ps.hero_facts && ps.hero_facts.length ? ps.hero_facts : pageFacts.slice(0, 2).map(f => f.id)).filter(id => factsById[id]);
  // возражения страницы: свои по сегменту плюс те, что стратег назначил блокам явно (могут быть из других сегментов)
  const allObjections = audience.segments.flatMap(s => s.objections.map(o => ({ ...o, segment: s.id })));
  const overrideObjIds = Object.values(ps.block_overrides || {}).flatMap(o => o.objection_ids || []);
  const objIds = [...new Set([...(ps.objection_ids || []), ...overrideObjIds])];
  const objections = objIds.map(id => allObjections.find(o => o.id === id)).filter(Boolean);
  // возражение идет в блок, который его закрывает по смыслу: global.objection_to_block стратега (id возражения -> id блока),
  // если этот блок есть в порядке страницы; по кругу по слотам - только возражения без такого назначения
  const slots = order.filter(id => byId[id].objection_slot);
  const objHome = strategy.global.objection_to_block || {};
  const objByBlock = {};
  let rr = 0;
  objections.forEach(o => {
    const home = objHome[o.id];
    const id = home && order.includes(home) ? home : (slots.length ? slots[rr++ % slots.length] : null);
    if (id) (objByBlock[id] ??= []).push(o.id);
  });
  // факт с явным домом (стратег назвал его в block_overrides.<блок>.facts или в тексте задания блока) не раздается
  // другим блокам по fact_kinds: полная формулировка факта звучит в своем блоке, остальные ссылаются одним словом
  const factHome = {};
  for (const id of order) {
    if (byId[id].role === 'hero') continue;
    const ov = (ps.block_overrides || {})[id] || {};
    for (const fid of [...(ov.facts || []), ...taskRefs(id)]) factHome[fid] ??= id;
  }
  const cta = ps.cta && ps.cta.main ? ps.cta : (strategy.global.cta_by_type[page.type] || { main: '' });
  const formulaId = ps.offer_formula || strategy.global.offer_formula_by_type[page.type] || '';
  const formula = formulas.formulas.find(f => f.id === formulaId) || { id: formulaId, name: formulaId, recipe: '' };
  const bank = Object.fromEntries((strategy.global.argument_bank || []).map(b => [b.fact_id, b.angles]));

  let prevFacts = [];
  const blocks = order.map((id, i) => {
    const b = byId[id];
    const ov = (ps.block_overrides || {})[id] || {};
    let bfacts = ov.facts;
    if (!bfacts) {
      if (b.role === 'hero') bfacts = heroFacts;
      else if (b.fact_kinds && b.fact_kinds.length) {
        // по fact_kinds: без фактов с домом в другом блоке и, если останется хоть один, без фактов соседа сверху
        // (два соседних блока с одним аргументом - находка редакционного стандарта)
        const kindFacts = pageFacts.filter(f => b.fact_kinds.includes(f.kind) && (!factHome[f.id] || factHome[f.id] === id)).map(f => f.id);
        const fresh = kindFacts.filter(fid => !prevFacts.includes(fid));
        bfacts = (fresh.length ? fresh : kindFacts).slice(0, 6);
      }
      else bfacts = [];
    }
    bfacts = [...new Set([...bfacts, ...taskRefs(id).filter(publishable)])];
    prevFacts = bfacts;
    // витрина каталога: писатель дает только вступление и подписи фильтров, карточки приходят из спецификации каталога
    const isListing = id === 'listing' || b.pattern === 'listing';
    const LISTING_KINDS = new Set(['h2', 'h3', 'sub', 'text', 'filters', 'link', 'button', 'note']);
    const elements = b.elements.filter(e => !isListing || LISTING_KINDS.has(e.kind)).map(e => {
      const cap = kindCap[e.kind];
      const max = Math.min(e.chars.max || cap || 350, cap ? cap * 1.2 : 900);
      return { kind: e.kind, count: optionalCount(b, e), chars: { min: e.chars.min || 0, median: e.chars.median || 0, max: Math.round(max) }, note: e.note || '' };
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
