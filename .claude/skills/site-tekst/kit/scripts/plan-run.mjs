// Список незавершенной работы для args воркфлоу фазы 5/6.
// node scripts/plan-run.mjs [--wave N] [--slugs a,b,c] [--types category,service] [--phase write|audit]
//                           [--hero single|tournament] [--tournament-types home,hub,service] [--sample-per-type 1]
// Печатает JSON: {phase, hero:{mode, tournament_types}, pages:[{slug, type, block_set, briefed, hero_done, hero_mode, hero_block_id,
//   block_roles, pending_blocks:[...], blocks_total, lint_dirty:[...], audit_rounds, status, slices}][, sample:[slug...]]}
// hero_mode страницы: tournament (3 писателя -> 2 судьи -> селектор, wf-05b-hero-tournament.js) для типов из --tournament-types
// (по умолчанию home, hub, service), иначе single (писатель + селектор). --hero задает режим всем страницам сразу.
// В фазе audit печатает sample - выборку для слепого читателя wf-06: первые N страниц каждого типа в порядке карты
// среди страниц этого вывода (N - --sample-per-type, по умолчанию 1; 0 - пустая выборка).
// В фазе write заодно проверяет срезы брифа для писателей (brief/<block_id>.json) и пересобирает устаревшие: поле slices.
import path from 'node:path';
import { argv, loadSitemap, pageDir, exists, readJson, listFiles } from './lib.mjs';
import { ensureSlices } from './writer-inputs.mjs';

const a = argv({});
const phase = a.phase || 'write';
const HERO_MODES = ['single', 'tournament'];
if (a.hero && !HERO_MODES.includes(a.hero)) { console.error(`--hero: ожидается ${HERO_MODES.join(' | ')}, получено «${a.hero}»`); process.exit(2); }
const tournamentTypes = (a['tournament-types'] ?? 'home,hub,service').split(',').map(s => s.trim()).filter(Boolean);
const perType = a['sample-per-type'] == null ? 1 : Number(a['sample-per-type']);
if (!Number.isInteger(perType) || perType < 0) { console.error(`--sample-per-type: ожидается целое >= 0, получено «${a['sample-per-type']}»`); process.exit(2); }
const heroMode = type => a.hero || (tournamentTypes.includes(type) ? 'tournament' : 'single');
const sm = loadSitemap();
let pages = sm.pages.filter(p => p.status !== 'skip');
if (a.wave) pages = pages.filter(p => String(p.wave) === String(a.wave));
if (a.slugs) { const s = new Set(a.slugs.split(',')); pages = pages.filter(p => s.has(p.slug)); }
if (a.types) { const t = new Set(a.types.split(',')); pages = pages.filter(p => t.has(p.type)); }

const out = { phase, hero: { mode: a.hero || 'by-type', tournament_types: a.hero ? [] : tournamentTypes }, pages: [] };
for (const p of pages) {
  const dir = pageDir(p.slug);
  const briefFile = path.join(dir, 'brief.json');
  const row = { slug: p.slug, type: p.type, block_set: p.block_set || 'full', briefed: exists(briefFile), hero_done: false, hero_mode: heroMode(p.type), hero_block_id: '', block_roles: {}, pending_blocks: [], blocks_total: 0, lint_dirty: [], audit_rounds: 0, status: p.status };
  if (row.briefed) {
    const brief = readJson(briefFile);
    row.blocks_total = brief.blocks.length;
    row.hero_block_id = (brief.blocks.find(b => b.role === 'hero') || {}).block_id || '';
    for (const b of brief.blocks) row.block_roles[b.block_id] = b.role;
    for (const b of brief.blocks) {
      const f = path.join(dir, 'blocks', `${b.block_id}.json`);
      const lint = path.join(process.cwd(), 'work', 'audit', p.slug, `lint-${b.block_id}.json`);
      const done = exists(f) && exists(lint) && readJson(lint).verdict === 'pass';
      if (!done) row.pending_blocks.push(b.block_id);
      else if (b.role === 'hero') row.hero_done = true;
      if (exists(f) && exists(lint) && readJson(lint).verdict !== 'pass') row.lint_dirty.push(b.block_id);
    }
    row.audit_rounds = listFiles(path.join(process.cwd(), 'work', 'audit', p.slug), '.json').filter(f => /round-\d+\.json$/.test(f)).length;
  }
  if (phase === 'write' && row.briefed && row.pending_blocks.length === 0) continue;
  if (phase === 'audit' && (!row.briefed || row.pending_blocks.length > 0)) continue;
  if (phase === 'write' && row.briefed) row.slices = ensureSlices(p.slug);
  out.pages.push(row);
}
if (phase === 'audit') {
  const taken = {};
  out.sample = out.pages.filter(r => (taken[r.type] = (taken[r.type] || 0) + 1) <= perType).map(r => r.slug);
}
console.log(JSON.stringify(out, null, 2));
