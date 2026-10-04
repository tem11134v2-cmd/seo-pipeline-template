export const meta = {
  name: 'wf-05-write',
  description: 'Phase 5: write pages block by block (hero by hero_mode: tournament via wf-05b or writer + selector; then sequential block writers with lint; a block that fails lint does not stop the page), pages in parallel batches. Top level only',
  phases: [{ title: 'Write' }],
}
// Запускать только верхним уровнем: турнир первого экрана - вложенный воркфлоу wf-05b, а вложенность глубже одного уровня
// движок не допускает. Из другого воркфлоу - только с args от task.mjs args write --hero single (без турнира).
// args: вывод node scripts/plan-run.mjs (--phase write) + root, model?, model_light?, models?: {роль: модель}, concurrency?,
//       stopOnBlock? (true - прежнее поведение: страница встает на первом блоке, не прошедшем линтер)
// models уходит и во вложенный турнир wf-05b (роли hero-writer, hero-judge, hero-select).
// { root, pages: [{ slug, type, hero_mode: 'tournament'|'single', pending_blocks: [...], hero_block_id, block_roles: {block_id: role} }], concurrency }
// Первый экран: hero_mode=tournament - вложенный воркфлоу workflows/wf-05b-hero-tournament.js (3 писателя -> 2 судьи -> селектор),
// single (и страницы без hero_mode) - писатель трех вариантов + селектор. Стандартный первый экран на турнирной странице не пишется.
// Последний блок прогона страницы получает last=true: его писатель (или селектор первого экрана) сам запускает render-md после page-state.
// Режим без остановок (по умолчанию): блок, не прошедший линтер, не останавливает страницу - писатели идут к следующим блокам.
// Счетчик попыток (attempts, brief_sha) пишет в файл блока его автор: писатель блока, у первого экрана - селектор (неудача
// линтера: прежний блок не pass по тому же срезу - его attempts + 1); воркфлоу файлов не пишет. Файлы вариантов первого
// экрана попыток не дают (scripts/progress.mjs). Блок с двумя неудачными запусками по тому же срезу брифа plan-run больше
// не отдает (exhausted): в прототипе скелет, в отчете «не прошел линтер».
// failed[].no_answer - агент или турнир не ответил (писатель вариантов, селектор, вложенный турнир, писатель блока):
// попытка не засчитана (RUNBOOK, фаза 5) - файла блока нет, он прежний или записан без проверки линтером (exhausted
// только по отчету линтера к текущему содержимому блока: без отчета или с block_sha другого содержимого - pending);
// тот же блок с no_answer второй запуск подряд - аномалия для автостопа оркестратора. Селектор с chosen none (все
// варианты выбыли на отсеве) блока тоже не пишет: попытки нет, повтор ловит автостоп «два запуска подряд без прогресса».
const pages = (args && args.pages) || []
if (!pages.length) throw new Error('args.pages пуст: нечего писать (plan-run вернул пустой список)')
const CONC = (args && args.concurrency) || 4
const STOP_ON_BLOCK = !!(args && args.stopOnBlock)
const ROOT = (args && args.root) || ''
if (!ROOT) throw new Error('args.root обязателен: абсолютный путь к папке проекта')
// Модели по ролям (docs/RUNBOOK.md, «Модели по ролям»): light -> args.model_light, strong -> args.model;
// args.models {роль: модель} переопределяет умолчание роли. Те же args - те же модели (resume берет кэш).
const MODEL = (args && args.model) || undefined
const MODEL_LIGHT = (args && args.model_light) || MODEL
const ROLE_MODELS = (args && args.models) || {}
if (typeof ROLE_MODELS !== 'object' || Array.isArray(ROLE_MODELS)) throw new Error('args.models: объект {роль: модель}')
const ROLES = {
  'hero-writer': 'strong', 'hero-select': 'strong',
  writer: 'strong', // 05-block-writer: пока strong; умолчание меняется этой строкой
}
const modelFor = role => {
  if (!ROLES[role]) throw new Error(`роль ${role} не описана в ROLES`)
  return ROLE_MODELS[role] || (ROLES[role] === 'light' ? MODEL_LIGHT : MODEL)
}
const TOURNAMENT = `${ROOT.replace(/[\\/]+$/, '')}/workflows/wf-05b-hero-tournament.js`
const pre = p => `Папка проекта: ${ROOT}. Все относительные пути в промтах считаются от нее; команды запускай из нее (cd "${ROOT}" && ...). Сначала прочитай ${ROOT}/CLAUDE.md, затем ${ROOT}/${p}, и выполни роль строго по нему.`
const HERO = { type: 'object', properties: { slug: { type: 'string' }, block_id: { type: 'string' }, variants: { type: 'number' }, attempts: { type: 'number' }, lint: { type: 'object' }, facts_used: { type: 'array', items: { type: 'string' } }, notes: { type: 'string' } }, required: ['slug', 'block_id', 'variants'] }
const SELECT = { type: 'object', properties: { slug: { type: 'string' }, block_id: { type: 'string' }, chosen: { type: 'string' }, scores: { type: 'object' }, lint: { type: 'string' }, reason: { type: 'string' } }, required: ['slug', 'block_id', 'chosen', 'lint'] }
const BLOCK = { type: 'object', properties: { slug: { type: 'string' }, block_id: { type: 'string' }, lint: { type: 'string' }, rounds: { type: 'number' }, attempts: { type: 'number' }, facts_used: { type: 'array', items: { type: 'string' } }, objections_closed: { type: 'array', items: { type: 'string' } }, placeholders: { type: 'number' }, needs_fact: { type: 'array', items: { type: 'string' } }, blocked_reasons: { type: 'array', items: { type: 'string' } } }, required: ['slug', 'block_id', 'lint'] }

async function writeHero(p, bid, last) {
  if (p.hero_mode === 'tournament') {
    let t = null
    try {
      t = await workflow({ scriptPath: TOURNAMENT }, { root: ROOT, model: MODEL, model_light: MODEL_LIGHT, ...(Object.keys(ROLE_MODELS).length ? { models: ROLE_MODELS } : {}), slug: p.slug, block_id: bid, last })
    } catch (e) {
      return { ok: false, no_answer: true, reason: `турнир первого экрана не отработал: ${(e && e.message) || e} (wf-05 запускается только верхним уровнем; из другого воркфлоу - args от task.mjs args write --hero single)` }
    }
    const s = t && t.selected
    return { ok: !!(s && s.lint === 'pass'), no_answer: !s, reason: s ? `турнир: selector lint=${s.lint}: ${s.reason || ''}` : 'турнир: селектор не ответил' }
  }
  const w = await agent(`${pre('prompts/05-hero-writer.md')}\nПараметры: slug=${p.slug}; block_id=${bid}; mode=single.`, { label: `hero:${p.slug}`, phase: 'Write', effort: 'high', model: modelFor('hero-writer'), schema: HERO })
  if (!w) return { ok: false, no_answer: true, reason: 'hero-writer не ответил' }
  const s = await agent(`${pre('prompts/05-hero-selector.md')}\nПараметры: slug=${p.slug}; block_id=${bid}; mode=select; variants=work/pages/${p.slug}/blocks/${bid}.variants.json; last=${last}.`, { label: `select:${p.slug}`, phase: 'Write', effort: 'high', model: modelFor('hero-select'), schema: SELECT })
  return { ok: !!(s && s.lint === 'pass'), no_answer: !s, reason: s ? `selector lint=${s.lint}: ${s.reason || ''}` : 'селектор не ответил' }
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
      const b = await agent(`${pre('prompts/05-block-writer.md')}\nПараметры: slug=${p.slug}; block_id=${bid}; last=${last}.`, { label: `block:${p.slug}:${bid}`, phase: 'Write', effort: 'high', model: modelFor('writer'), schema: BLOCK })
      r = { ok: !!(b && b.lint === 'pass'), no_answer: !b, reason: b ? `lint=${b.lint}: ${(b.blocked_reasons || []).join('; ')}` : 'писатель не ответил' }
    }
    if (!r.ok) {
      failed.push({ block_id: bid, reason: r.reason, ...(r.no_answer ? { no_answer: true } : {}) })
      if (STOP_ON_BLOCK) { log(`${p.slug}: остановка на ${bid}`); break }
      log(`${p.slug}: ${bid} не прошел (${r.reason.slice(0, 120)}), дальше следующие блоки`)
      continue
    }
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
const silent = stopped.flatMap(s => s.failed.filter(f => f.no_answer).map(f => `${s.slug}/${f.block_id}`))
log(`страниц: ${out.length}, с блоками не pass: ${stopped.length}${STOP_ON_BLOCK ? ' (остановлены на первом)' : ''}${silent.length ? `; без ответа агента (не exhausted, повтор - автостоп): ${silent.join(', ')}` : ''}`)
// stopped - страницы с неудачными блоками (at - первый); failed - все неудачные блоки прогона
return { pages: out, stopped: stopped.map(s => ({ slug: s.slug, at: s.failed[0] })), failed: stopped.flatMap(s => s.failed.map(f => ({ slug: s.slug, ...f }))) }
