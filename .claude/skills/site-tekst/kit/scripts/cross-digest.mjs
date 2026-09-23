// Выжимка для кросс-судьи только по страницам из пар-кандидатов (без LLM).
// node scripts/cross-digest.mjs [--max-pairs 60]
// Вход: work/audit/dedup.json (pairs, geo_groups - сначала node scripts/dedup.mjs), work/sitemap.json, брифы и блоки страниц,
//       work/facts.json (поле geo фактов). Выход: work/audit/cross-digest.json и сводка в консоль.
//   pairs      - пары, где обе страницы написаны (shingles, h1, hero-sub, geo-twin); пары только по шинглам режутся до --max-pairs
//                по убыванию jaccard, счет срезанных - в counts.cut_pairs;
//   geo_groups - группы гео-близнецов: у написанных страниц тест подмены делается даже без написанного соседа;
//   geo_leaks  - факт, привязанный к чужому гео, на странице с geo (все написанные страницы, не только из пар);
//   pending    - пары, где хотя бы одна страница еще не написана (судить нечего);
//   pages      - выжимка по каждой странице из pairs и geo_groups: H1, подзаголовок, CTA, факты, возражения, блоки
//                (заголовок, первая фраза, summary, местная привязка), для гео-страниц - свои и общие гео-факты.
import path from 'node:path';
import { argv, P, exists, readJson, writeText, loadSitemap, pageDir, loadBrief, loadBlocks, elementTexts, B, esc, nowIso } from './lib.mjs';

const a = argv({});
const MAX_PAIRS = Number(a['max-pairs'] || 60);
const DEDUP = P('work', 'audit', 'dedup.json');
if (!exists(DEDUP)) { console.error('нет work/audit/dedup.json - сначала node scripts/dedup.mjs'); process.exit(2); }
const dd = readJson(DEDUP);
if (!Array.isArray(dd.pairs)) { console.error('в work/audit/dedup.json нет pairs - пересчитайте node scripts/dedup.mjs'); process.exit(2); }
const sm = loadSitemap();
const bySlug = Object.fromEntries(sm.pages.map(p => [p.slug, p]));
const factsFile = P('work', 'facts.json');
const allFacts = exists(factsFile) ? (readJson(factsFile).facts || []) : [];
const clip = (s, n) => { s = String(s ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 3) + '...' : s; };

// ---------- гео: основы названий для поиска в тексте ----------
const geoNames = s => String(s || '').split(/[,;]/).map(x => x.trim()).filter(Boolean);
const ALL_GEO = [...new Set(sm.pages.flatMap(p => geoNames(p.geo)))];
const reCache = {};
// короткие названия склоняются («Тула» -> «в Туле», «Ката» -> «на Кате»): основа без конечной гласной плюс до двух букв
// окончания со строгой границей слова, чтобы «Ката» не находила «каталог»; длинные - как stemRe
const geoWord = w => w.length > 4 ? esc(w.slice(0, -2)) + '[а-яa-z]*' : esc(/[аеиоуыэюя]$/i.test(w) ? w.slice(0, -1) : w) + '[а-я]{0,2}';
const geoRe = g => (reCache[g] ??= new RegExp(B + String(g).trim().split(/\s+/).map(geoWord).join('\\s+') + '(?![а-яa-z0-9])', 'i'));
const mentions = (text, g) => geoRe(g).test(String(text || ''));
// гео факта: поле geo плюс названия гео карты в публикуемой формулировке (wording; value - только если wording нет)
function factGeo(f) {
  const set = new Set(geoNames(f.geo).map(x => x.toLowerCase()));
  for (const g of ALL_GEO) if (mentions(f.wording || f.value || '', g)) set.add(g.toLowerCase());
  return set;
}
const FACT_GEO = Object.fromEntries(allFacts.map(f => [f.id, factGeo(f)]));
const covers = (id, g) => {
  const set = FACT_GEO[id];
  if (!set || !set.size) return false;
  return [...set].some(x => x === g.toLowerCase() || mentions(x, g));
};

// ---------- страницы ----------
const cache = {};
function pageData(slug) {
  if (slug in cache) return cache[slug];
  const p = bySlug[slug];
  if (!p || !exists(path.join(pageDir(slug), 'brief.json'))) return (cache[slug] = null);
  const blocks = loadBlocks(slug);
  if (!blocks.length) return (cache[slug] = null);
  const brief = loadBrief(slug);
  return (cache[slug] = { p, brief, blocks });
}
const firstText = (block, kinds) => {
  for (const el of block.elements || []) if (kinds.includes(el.kind)) { const t = elementTexts(el)[0]; if (t) return t.text; }
  return '';
};
function digest(slug, neighbors = []) {
  const { p, brief, blocks } = pageData(slug);
  const hero = (blocks.find(x => x.spec.role === 'hero') || blocks[0]).block;
  const geos = geoNames(p.geo);
  const g = geos[0] || '';
  const factsUsed = [...new Set(blocks.flatMap(({ block }) => block.facts_used || []))];
  const out = {
    url: p.url, type: p.type, parent: p.parent || '', geo: p.geo || '',
    segment: [brief.segment?.id, brief.segment?.name].filter(Boolean).join(' '),
    unique_argument: clip(brief.unique_argument, 300),
    h1: firstText(hero, ['h1']), sub: firstText(hero, ['sub']), cta_main: brief.cta?.main || '',
    facts_used: factsUsed,
    objections_covered: [...new Set(blocks.flatMap(({ block }) => block.objections_closed || []))],
    blocks: blocks.map(({ spec, block }) => {
      const row = { id: block.block_id, head: firstText(block, ['h1', 'h2']), lead: clip(firstText(block, ['sub', 'text', 'card', 'step', 'qa', 'bullets']), 120), summary: clip(block.summary, 160) };
      if (g && neighbors.length) {
        // geo_named - название гео звучит в блоке (при подмене названия не спасает); geo_facts - свои факты гео, которых нет у соседей
        const text = (block.elements || []).flatMap(el => elementTexts(el).map(t => t.text)).join('\n');
        row.geo_named = mentions(text, g);
        const local = (block.facts_used || []).filter(id => covers(id, g) && !neighbors.some(n => covers(id, n)));
        if (local.length) row.geo_facts = local;
      }
      return row;
    }),
  };
  if (g && neighbors.length) {
    const inBrief = new Set((brief.facts || []).map(f => f.id));
    const wording = Object.fromEntries([...allFacts, ...(brief.facts || [])].map(f => [f.id, f.wording || f.value || '']));
    const pageText = blocks.map(({ block }) => (block.elements || []).flatMap(el => elementTexts(el).map(t => t.text)).join('\n')).join('\n');
    const geoFacts = allFacts.filter(f => f.publish !== 'no' && covers(f.id, g));
    out.geo_check = {
      neighbors,
      own_facts: geoFacts.filter(f => !neighbors.some(n => covers(f.id, n)))
        .map(f => ({ id: f.id, wording: clip(wording[f.id], 160), in_brief: inBrief.has(f.id), used: factsUsed.includes(f.id) })),
      shared_facts: geoFacts.filter(f => neighbors.some(n => covers(f.id, n))).map(f => f.id),
      blocks_with_own_facts: out.blocks.filter(b => b.geo_facts).map(b => b.id),
      blocks_without_geo: out.blocks.filter(b => !b.geo_named && !b.geo_facts).map(b => b.id),
      blocks_total: out.blocks.length,
      mentions_neighbors: neighbors.filter(n => mentions(pageText, n)),
    };
  }
  return out;
}

// ---------- пары и группы ----------
const written = s => !!pageData(s);
const judgePairs = [], pending = [];
for (const pr of dd.pairs) {
  const miss = [pr.a, pr.b].filter(s => !written(s));
  if (miss.length) pending.push(`${pr.a} ~ ${pr.b} (${pr.reasons.join(', ')}): нет текста ${miss.join(', ')}`);
  else judgePairs.push(pr);
}
const onlyShingles = pr => pr.reasons.length === 1 && pr.reasons[0] === 'shingles';
const keep = judgePairs.filter(pr => !onlyShingles(pr));
const shinglePairs = judgePairs.filter(onlyShingles).sort((x, y) => (y.max_jaccard || 0) - (x.max_jaccard || 0) || (y.shared || 0) - (x.shared || 0));
const pairsOut = [...keep, ...shinglePairs.slice(0, MAX_PAIRS)].map(pr => ({ ...pr, blocks: pr.blocks ? pr.blocks.slice(0, 5) : undefined }));
const cut = Math.max(0, shinglePairs.length - MAX_PAIRS);

const pagesOut = {};
const geoGroups = (dd.geo_groups || []).map(gr => {
  const pages = gr.pages.map(x => ({ ...x, written: written(x.slug) }));
  for (const x of pages) if (x.written) {
    const neighbors = [...new Set(pages.map(y => y.geo).filter(gy => gy.toLowerCase() !== x.geo.toLowerCase()))];
    pagesOut[x.slug] = digest(x.slug, neighbors);
  }
  return { type: gr.type, parent: gr.parent, pages };
});
for (const pr of pairsOut) for (const s of [pr.a, pr.b]) if (!pagesOut[s]) pagesOut[s] = digest(s);

// ---------- утечки гео по всем написанным страницам с geo ----------
const geoLeaks = [];
for (const p of sm.pages) {
  if (p.status === 'skip' || !geoNames(p.geo).length || !written(p.slug)) continue;
  const g = geoNames(p.geo)[0];
  const { blocks } = pageData(p.slug);
  const where = {};
  for (const { block } of blocks) for (const id of block.facts_used || []) (where[id] ??= []).push(block.block_id);
  for (const [id, bl] of Object.entries(where)) {
    const set = FACT_GEO[id];
    if (!set || !set.size || covers(id, g)) continue;
    const f = allFacts.find(x => x.id === id) || {};
    geoLeaks.push({ slug: p.slug, page_geo: p.geo, fact: id, fact_geo: [...set].join(', '), wording: clip(f.wording || f.value, 160), blocks: bl });
  }
}

const counts = {
  pairs_total: dd.pairs.length, pairs_to_judge: pairsOut.length, cut_pairs: cut, pending_pairs: pending.length,
  geo_groups: geoGroups.length, geo_pages: geoGroups.reduce((s, g) => s + g.pages.length, 0),
  geo_pages_written: geoGroups.reduce((s, g) => s + g.pages.filter(x => x.written).length, 0),
  geo_leaks: geoLeaks.length, pages_in_digest: Object.keys(pagesOut).length,
};
// компактная запись: верхние уровни с отступами, каждая пара, группа, утечка и страница - одной строкой (выжимку читает агент)
const doc = { created_at: nowIso(), source: 'work/audit/dedup.json', counts, pairs: pairsOut, geo_groups: geoGroups, geo_leaks: geoLeaks, pending, pages: pagesOut };
const pad = d => ' '.repeat(d);
function dump(v, d) {
  if (d >= 2 || v === null || typeof v !== 'object') return JSON.stringify(v);
  const rows = Array.isArray(v) ? v.map(x => pad(d + 1) + dump(x, d + 1)) : Object.entries(v).map(([k, x]) => `${pad(d + 1)}${JSON.stringify(k)}: ${dump(x, d + 1)}`);
  const [open, close] = Array.isArray(v) ? ['[', ']'] : ['{', '}'];
  return rows.length ? `${open}\n${rows.join(',\n')}\n${pad(d)}${close}` : open + close;
}
writeText(P('work', 'audit', 'cross-digest.json'), dump(doc, 0) + '\n');
const byReason = {};
for (const pr of dd.pairs) for (const r of pr.reasons) byReason[r] = (byReason[r] || 0) + 1;
console.log(`cross-digest: пар-кандидатов ${counts.pairs_total} (${Object.entries(byReason).map(([k, v]) => `${k} ${v}`).join(', ') || '-'}), к суду ${counts.pairs_to_judge}, срезано ${cut}, ждут текстов ${counts.pending_pairs}`);
console.log(`  гео-близнецы: групп ${counts.geo_groups}, страниц ${counts.geo_pages}, написано ${counts.geo_pages_written}; утечек гео-фактов ${counts.geo_leaks}; страниц в выжимке ${counts.pages_in_digest}`);
console.log('  файл: work/audit/cross-digest.json');
