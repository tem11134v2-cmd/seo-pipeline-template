// Список незавершенной работы для args воркфлоу фазы 5/6.
// node scripts/plan-run.mjs [--wave 1|2] [--slugs a,b,c] [--types category,service] [--phase write|audit]
//                           [--hero single|tournament] [--tournament-types home,hub,service] [--sample-per-type 1]
// Печатает JSON: {phase, hero:{mode, tournament_types, first_of_types?}, pages:[{slug, type, wave, block_set, briefed, hero_done,
//   hero_mode, hero_block_id, block_roles, pending_blocks:[...], exhausted_blocks:[...], blocks_total, lint_dirty:[...],
//   audit_rounds, audit_last_round, audit_fresh, complete, status, slices}][, sample:[slug...]]}
// Статусы блоков и страниц, волны и турнир - scripts/progress.mjs (без сравнения времени файлов):
//   write - страницы с блоками pending (нет файла или lint не pass и попыток меньше двух); exhausted-блоки (2 неудачных
//           запуска писателя по тому же срезу брифа) не отдаются, в прототипе они скелет, в отчете - «не прошел линтер»;
//   audit - дописанные страницы (каждый блок pass или exhausted); audit_fresh - аудит есть и page.md с тех пор не менялся.
// --wave: волна по карте (C8): 1 - главная и первая страница каждого типа, у которого 2+ рабочих страницы; 2 - остальные.
// hero_mode по умолчанию (hero.mode first-of-type): tournament (3 писателя -> 2 судьи -> селектор, wf-05b) - главная, хабы
// и первая по карте страница типов service и category; остальные - single (писатель + селектор). --tournament-types
// задает турнир всем страницам перечисленных типов (hero.mode by-type); --hero - режим всем страницам сразу.
// В фазе audit печатает sample - выборку для слепого читателя wf-06: первые N страниц каждого типа в порядке карты
// среди страниц этого вывода (N - --sample-per-type, по умолчанию 1; 0 - пустая выборка).
// В фазе write заодно проверяет срезы брифа для писателей (brief/<block_id>.json) и пересобирает устаревшие: поле slices.
// Код 2 - неверный флаг или --slugs с slug, которого нет среди рабочих страниц карты (список в stderr).
import { argv, loadSitemap } from './lib.mjs';
import { ensureSlices } from './writer-inputs.mjs';
import { pageProgress, waves, tournamentSlugs, TOURNAMENT_TYPES, TOURNAMENT_FIRST_OF } from './progress.mjs';

const ROOT = process.cwd();
const a = argv({});
const phase = a.phase || 'write';
const HERO_MODES = ['single', 'tournament'];
if (a.hero && !HERO_MODES.includes(a.hero)) { console.error(`--hero: ожидается ${HERO_MODES.join(' | ')}, получено «${a.hero}»`); process.exit(2); }
const byType = a['tournament-types'] != null;
const tournamentTypes = String(a['tournament-types'] ?? '').split(',').map(s => s.trim()).filter(Boolean);
const perType = a['sample-per-type'] == null ? 1 : Number(a['sample-per-type']);
if (!Number.isInteger(perType) || perType < 0) { console.error(`--sample-per-type: ожидается целое >= 0, получено «${a['sample-per-type']}»`); process.exit(2); }
const sm = loadSitemap();
const W = waves(ROOT, sm);
const T = tournamentSlugs(sm);
const heroMode = p => a.hero || (byType ? (tournamentTypes.includes(p.type) ? 'tournament' : 'single') : (T.has(p.slug) ? 'tournament' : 'single'));
let pages = sm.pages.filter(p => p.status !== 'skip');
if (a.wave) pages = pages.filter(p => String(W.of[p.slug]) === String(a.wave));
if (a.slugs) {
  const s = new Set(String(a.slugs).split(',').map(x => x.trim()).filter(Boolean));
  // опечатка в --slugs не сужает выборку молча: незнакомый slug (нет в карте или skip) - код 2 со списком
  const live = new Set(sm.pages.filter(p => p.status !== 'skip').map(p => p.slug));
  const bad = [...s].filter(x => !live.has(x));
  if (bad.length) { console.error(`--slugs: нет среди рабочих страниц карты: ${bad.join(', ')}`); process.exit(2); }
  pages = pages.filter(p => s.has(p.slug));
}
if (a.types) { const t = new Set(a.types.split(',')); pages = pages.filter(p => t.has(p.type)); }

const hero = a.hero ? { mode: a.hero, tournament_types: [] }
  : byType ? { mode: 'by-type', tournament_types: tournamentTypes }
    : { mode: 'first-of-type', tournament_types: TOURNAMENT_TYPES, first_of_types: TOURNAMENT_FIRST_OF };
const out = { phase, hero, pages: [] };
for (const p of pages) {
  const pr = pageProgress(ROOT, p.slug);
  const row = {
    slug: p.slug, type: p.type, wave: W.of[p.slug], block_set: p.block_set || 'full', briefed: pr.briefed, hero_done: pr.hero_done,
    hero_mode: heroMode(p), hero_block_id: pr.hero_block_id, block_roles: Object.fromEntries(pr.blocks.map(b => [b.block_id, b.role])),
    pending_blocks: pr.pending, exhausted_blocks: pr.exhausted, blocks_total: pr.blocks_total, lint_dirty: pr.lint_dirty,
    audit_rounds: pr.audit_rounds, audit_last_round: pr.audit_last_round, audit_fresh: pr.audit_fresh, complete: pr.briefed && pr.complete, status: p.status,
  };
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
