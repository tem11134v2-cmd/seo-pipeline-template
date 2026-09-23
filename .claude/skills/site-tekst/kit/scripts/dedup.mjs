// Повторы между страницами и внутри страницы + пары-кандидаты для кросс-судьи.
// node scripts/dedup.mjs [--shingle 6] [--min-shared 3] [--jaccard 0.15]
// Выход: work/audit/dedup.json - findings (как раньше) и два поля для кросс-судьи (prompts/06-cross-judge.md):
//   pairs      - пары страниц-кандидатов {a, b, reasons, ...}; reasons: shingles (общие шинглы блоков выше порога),
//                h1 (одинаковый H1), hero-sub (одинаковая первая фраза подзаголовка первого экрана),
//                geo-twin (один тип, один родитель, разный geo - считается по карте, тексты не нужны);
//   geo_groups - группы гео-близнецов {type, parent, pages: [{slug, geo}]}.
// Шинглы обязательных формулировок (wording фактов, terminology.use, CTA, дисклеймер, название компании) повтором не считаются.
import path from 'node:path';
import { argv, P, loadSitemap, pageDir, exists, loadBlocks, loadBrief, writeJson, blockPlainText, makeFindings, addFinding, finalizeVerdict, splitSentences } from './lib.mjs';

const a = argv({});
const N = Number(a.shingle || 6), MIN_SHARED = Number(a['min-shared'] || 3), JAC = Number(a.jaccard || 0.15);
const sm = loadSitemap();
const live = sm.pages.filter(p => p.status !== 'skip');
function norm(s) { return s.toLowerCase().replace(/\[\[[^\]]+\]\]/g, ' ').replace(/[^a-zа-я0-9 ]+/gi, ' ').replace(/\s+/g, ' ').trim(); }
function shingleList(text) {
  const w = norm(text).split(' ').filter(Boolean);
  const out = [];
  for (let i = 0; i + N <= w.length; i++) out.push(w.slice(i, i + N).join(' '));
  return out;
}
// обязательные формулировки всех брифов: их шинглы вычитаются из текстов
const briefs = {};
for (const p of live) if (exists(path.join(pageDir(p.slug), 'brief.json'))) briefs[p.slug] = loadBrief(p.slug);
const PROTECTED = new Set();
for (const b of Object.values(briefs)) {
  const texts = [...(b.facts || []).map(f => f.wording), ...(b.terminology?.use || []).map(t => t.say), b.cta?.main, b.cta?.secondary, b.disclaimer_text, b.company];
  for (const t of texts) if (typeof t === 'string') shingleList(t).forEach(s => PROTECTED.add(s));
}
const shingles = text => new Set(shingleList(text).filter(s => !PROTECTED.has(s)));

const items = [];
for (const p of live) {
  if (!briefs[p.slug]) continue;
  for (const { spec, block } of loadBlocks(p.slug)) {
    const text = blockPlainText(block);
    const h1 = (block.elements.find(e => e.kind === 'h1') || {}).text || '';
    const sub = (block.elements.find(e => e.kind === 'sub') || {}).text || '';
    items.push({ slug: p.slug, block_id: block.block_id, type: spec.type, role: spec.role, text, h1, sub, sh: shingles(text) });
  }
}
const report = makeFindings('all-pages', 'dedup');
const pairs = new Map();
const pairOf = (x, y) => {
  const [s1, s2] = [x, y].sort();
  const k = s1 + '|' + s2;
  if (!pairs.has(k)) pairs.set(k, { a: s1, b: s2, reasons: [] });
  return pairs.get(k);
};
const reason = (pr, r) => { if (!pr.reasons.includes(r)) pr.reasons.push(r); return pr; };
// между страницами
for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
  const A = items[i], B = items[j];
  if (A.slug === B.slug) continue;
  if (!A.sh.size || !B.sh.size) continue;
  const common = []; for (const s of A.sh) if (B.sh.has(s)) common.push(s);
  const shared = common.length;
  if (!shared) continue;
  const jac = shared / (A.sh.size + B.sh.size - shared);
  if (shared >= MIN_SHARED || jac >= JAC) {
    addFinding(report, { page: A.slug, block_id: A.block_id, quote: common[0], severity: jac >= 0.4 ? 'blocker' : 'major', category: 'repeat', rule: 'dedup.shingles',
      problem: `повтор с ${B.slug}/${B.block_id}: общих фрагментов ${shared}, jaccard ${jac.toFixed(2)}`, proposal: 'переписать один из блоков под сегмент и предмет своей страницы' });
    const pr = reason(pairOf(A.slug, B.slug), 'shingles');
    const [ba, bb] = pr.a === A.slug ? [A, B] : [B, A];
    (pr.blocks ??= []).push({ a: ba.block_id, b: bb.block_id, shared, jaccard: Number(jac.toFixed(2)), sample: common.slice(0, 3) });
  }
}
// одинаковые H1 и первые фразы hero
const groupPairs = (arr, r) => { for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) if (arr[i].slug !== arr[j].slug) reason(pairOf(arr[i].slug, arr[j].slug), r); };
const byH1 = {};
for (const it of items) if (it.h1) (byH1[norm(it.h1)] ??= []).push(it);
for (const [h, arr] of Object.entries(byH1)) if (arr.length > 1) {
  for (const it of arr) addFinding(report, { page: it.slug, block_id: it.block_id, quote: it.h1, severity: 'blocker', category: 'repeat', rule: 'dedup.h1', problem: `одинаковый H1 на страницах: ${arr.map(x => x.slug).join(', ')}`, proposal: 'H1 должен нести предмет и обещание именно этой страницы' });
  groupPairs(arr, 'h1');
}
const bySub = {};
for (const it of items) if (it.role === 'hero' && it.sub) (bySub[norm(splitSentences(it.sub)[0] || it.sub)] ??= []).push(it);
for (const [s, arr] of Object.entries(bySub)) if (arr.length > 1) {
  for (const it of arr) addFinding(report, { page: it.slug, block_id: it.block_id, quote: it.sub, severity: 'major', category: 'repeat', rule: 'dedup.hero-sub', problem: `одинаковый подзаголовок первого экрана: ${arr.map(x => x.slug).join(', ')}`, proposal: 'подзаголовок под сегмент и крючок своей страницы' });
  groupPairs(arr, 'hero-sub');
}
// гео-близнецы по карте: один тип, один родитель, разный geo
const geoOf = p => String(p.geo || '').trim();
const parentOf = p => String(p.parent || '').trim().replace(/\/+$/, '') || '/';
const geoGroups = {};
for (const p of live) if (geoOf(p)) (geoGroups[`${p.type}|${parentOf(p)}`] ??= []).push(p);
const geo_groups = [];
for (const [k, arr] of Object.entries(geoGroups)) {
  if (new Set(arr.map(p => geoOf(p).toLowerCase())).size < 2) continue;
  const [type, parent] = k.split('|');
  geo_groups.push({ type, parent, pages: arr.map(p => ({ slug: p.slug, geo: geoOf(p) })) });
  for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) {
    if (geoOf(arr[i]).toLowerCase() === geoOf(arr[j]).toLowerCase()) continue;
    const pr = reason(pairOf(arr[i].slug, arr[j].slug), 'geo-twin');
    Object.assign(pr, { type, parent });
  }
}
// внутри страницы: одинаковые предложения в разных блоках
const pages = {};
for (const it of items) (pages[it.slug] ??= []).push(it);
for (const [slug, arr] of Object.entries(pages)) {
  const seen = new Map();
  for (const it of arr) for (const s of splitSentences(it.text)) {
    const k = norm(s); if (k.split(' ').length < 5) continue;
    if (seen.has(k) && seen.get(k) !== it.block_id) addFinding(report, { page: slug, block_id: it.block_id, quote: s, severity: 'major', category: 'repeat', rule: 'dedup.in-page', problem: `предложение уже есть в ${seen.get(k)}`, proposal: 'убрать повтор или заменить ссылкой одним словом' });
    else seen.set(k, it.block_id);
  }
}
finalizeVerdict(report);
// пары: сильнейшие вперед (H1, затем максимальный jaccard блоков, затем гео-близнецы)
const pairList = [...pairs.values()].map(pr => {
  if (pr.blocks) {
    pr.blocks.sort((x, y) => y.jaccard - x.jaccard || y.shared - x.shared);
    pr.max_jaccard = pr.blocks[0].jaccard;
    pr.shared = pr.blocks.reduce((s, x) => s + x.shared, 0);
  }
  return pr;
}).sort((x, y) => (y.reasons.includes('h1') - x.reasons.includes('h1')) || ((y.max_jaccard || 0) - (x.max_jaccard || 0)) || (x.a + x.b).localeCompare(y.a + y.b));
const count = r => pairList.filter(pr => pr.reasons.includes(r)).length;
report.pairs = pairList;
report.geo_groups = geo_groups;
report.pairs_summary = `пар ${pairList.length}: шинглы ${count('shingles')}, H1 ${count('h1')}, подзаголовок ${count('hero-sub')}, гео-близнецы ${count('geo-twin')} (групп ${geo_groups.length})`;
writeJson(P('work', 'audit', 'dedup.json'), report);
console.log(`dedup: страниц в карте ${live.length}, с брифом ${Object.keys(briefs).length}, блоков ${items.length}, находок ${report.findings.length} (${report.summary})`);
console.log(`  ${report.pairs_summary}`);
