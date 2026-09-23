export const meta = {
  name: 'wf-05-write',
  description: 'Phase 5: write pages block by block (hero by hero_mode: tournament via wf-05b or writer + selector; then sequential block writers with lint), pages in parallel batches',
  phases: [{ title: 'Write' }],
}
// args: вывод node scripts/plan-run.mjs (--phase write) + root, model?, model_light?, concurrency?
// { root, pages: [{ slug, type, hero_mode: 'tournament'|'single', pending_blocks: [...], hero_block_id, block_roles: {block_id: role} }], concurrency }
// Первый экран: hero_mode=tournament - вложенный воркфлоу workflows/wf-05b-hero-tournament.js (3 писателя -> 2 судьи -> селектор),
// single (и страницы без hero_mode) - писатель трех вариантов + селектор. Стандартный первый экран на турнирной странице не пишется.
// Последний блок прогона страницы получает last=true: его писатель (или селектор первого экрана) сам запускает render-md после page-state.
const pages = (args && args.pages) || []
if (!pages.length) throw new Error('args.pages пуст: нечего писать (plan-run вернул пустой список)')
const CONC = (args && args.concurrency) || 4
const ROOT = (args && args.root) || ''
if (!ROOT) throw new Error('args.root обязателен: абсолютный путь к папке проекта')
const MODEL = (args && args.model) || undefined
const MODEL_LIGHT = (args && args.model_light) || MODEL
const TOURNAMENT = `${ROOT.replace(/[\\/]+$/, '')}/workflows/wf-05b-hero-tournament.js`
const pre = p => `Папка проекта: ${ROOT}. Все относительные пути в промтах считаются от нее; команды запускай из нее (cd "${ROOT}" && ...). Сначала прочитай ${ROOT}/CLAUDE.md, затем ${ROOT}/${p}, и выполни роль строго по нему.`
const HERO = { type: 'object', properties: { slug: { type: 'string' }, block_id: { type: 'string' }, variants: { type: 'number' }, lint: { type: 'object' }, facts_used: { type: 'array', items: { type: 'string' } }, notes: { type: 'string' } }, required: ['slug', 'block_id', 'variants'] }
const SELECT = { type: 'object', properties: { slug: { type: 'string' }, block_id: { type: 'string' }, chosen: { type: 'string' }, scores: { type: 'object' }, lint: { type: 'string' }, reason: { type: 'string' } }, required: ['slug', 'block_id', 'chosen', 'lint'] }
const BLOCK = { type: 'object', properties: { slug: { type: 'string' }, block_id: { type: 'string' }, lint: { type: 'string' }, rounds: { type: 'number' }, facts_used: { type: 'array', items: { type: 'string' } }, objections_closed: { type: 'array', items: { type: 'string' } }, placeholders: { type: 'number' }, blocked_reasons: { type: 'array', items: { type: 'string' } } }, required: ['slug', 'block_id', 'lint'] }

async function writeHero(p, bid, last) {
  if (p.hero_mode === 'tournament') {
    let t = null
    try {
      t = await workflow({ scriptPath: TOURNAMENT }, { root: ROOT, model: MODEL, model_light: MODEL_LIGHT, slug: p.slug, block_id: bid, last })
    } catch (e) {
      return { ok: false, reason: `турнир первого экрана не отработал: ${(e && e.message) || e}` }
    }
    const s = t && t.selected
    return { ok: !!(s && s.lint === 'pass'), reason: s ? `турнир: selector lint=${s.lint}: ${s.reason || ''}` : 'турнир: селектор не ответил' }
  }
  const w = await agent(`${pre('prompts/05-hero-writer.md')}\nПараметры: slug=${p.slug}; block_id=${bid}; mode=single.`, { label: `hero:${p.slug}`, phase: 'Write', effort: 'high', model: MODEL, schema: HERO })
  if (!w) return { ok: false, reason: 'hero-writer не ответил' }
  const s = await agent(`${pre('prompts/05-hero-selector.md')}\nПараметры: slug=${p.slug}; block_id=${bid}; mode=select; variants=work/pages/${p.slug}/blocks/${bid}.variants.json; last=${last}.`, { label: `select:${p.slug}`, phase: 'Write', effort: 'high', model: MODEL, schema: SELECT })
  return { ok: !!(s && s.lint === 'pass'), reason: s ? `selector lint=${s.lint}: ${s.reason || ''}` : 'селектор не ответил' }
}

async function writePage(p) {
  const done = [], failed = []
  const pending = p.pending_blocks || []
  for (let i = 0; i < pending.length; i++) {
    const bid = pending[i]
    const last = i === pending.length - 1
    const isHero = bid === p.hero_block_id || ((p.block_roles || {})[bid] === 'hero')
    let r
    if (isHero) r = await writeHero(p, bid, last)
    else {
      const b = await agent(`${pre('prompts/05-block-writer.md')}\nПараметры: slug=${p.slug}; block_id=${bid}; last=${last}.`, { label: `block:${p.slug}:${bid}`, phase: 'Write', effort: 'high', model: MODEL, schema: BLOCK })
      r = { ok: !!(b && b.lint === 'pass'), reason: b ? `lint=${b.lint}: ${(b.blocked_reasons || []).join('; ')}` : 'писатель не ответил' }
    }
    if (!r.ok) { failed.push({ block_id: bid, reason: r.reason }); log(`${p.slug}: остановка на ${bid}`); break }
    done.push(bid)
  }
  return { slug: p.slug, hero_mode: p.hero_mode || 'single', done, failed }
}

phase('Write')
const out = []
for (let i = 0; i < pages.length; i += CONC) {
  const chunk = pages.slice(i, i + CONC)
  log(`пакет ${Math.floor(i / CONC) + 1}: ${chunk.map(p => `${p.slug}${p.hero_mode === 'tournament' ? ' (турнир)' : ''}`).join(', ')}`)
  const res = await parallel(chunk.map(p => () => writePage(p)))
  out.push(...res.filter(Boolean))
}
const stopped = out.filter(r => r.failed.length)
log(`страниц: ${out.length}, остановлено: ${stopped.length}`)
return { pages: out, stopped: stopped.map(s => ({ slug: s.slug, at: s.failed[0] })) }
