export const meta = {
  name: 'wf-06-audit',
  description: 'Phase 6: judge (runs lint-page itself) -> one fixer pass over judge + lint findings -> judge round 2 only on blocker or low scores; cross-judge over dedup pairs and geo twins; blind readers on a sample; one render-md',
  phases: [{ title: 'Judge' }, { title: 'Cross' }, { title: 'Blind' }],
}
// args: { root, pages: [{slug, type}], sample?: [slug...], skipCross?: boolean, skipBlind?: boolean, model?, model_light?, models?: {роль: модель},
//         thresholds?: { hero_questions: 4, clonability: 4, flow: 4, objections_closed: 0.9, blocks_on_question: 0.9 } }
// Агентов на страницу: судья 1 (сам запускает lint-page) + фиксер 0-1 (blocker/major у судьи или у линтера страницы, один проход
// по обоим файлам) + судья круга 2 0-1 (после фиксера остались blocker или оценка круга 1 ниже порога) + фиксер 0-1
// по находкам круга 2 (третьего судьи нет).
// На прогон: кросс-судья 1 (сам запускает dedup, cross-digest и split-cross) + фиксеры страниц с исправимыми находками кросса,
// каждый по своему work/audit/<slug>/cross.json (общий файл только для чтения, статусы в него собирает split-cross --merge);
// слепой читатель 1 на страницу выборки (сам запускает blind-prep) + фиксер 0-1; render-md 1.
const pages = (args && args.pages) || []
if (!pages.length) throw new Error('args.pages пуст')
const sample = (args && args.sample) || []
const ROOT = (args && args.root) || ''
if (!ROOT) throw new Error('args.root обязателен: абсолютный путь к папке проекта')
// Модели по ролям (docs/RUNBOOK.md, «Модели по ролям»): light -> args.model_light, strong -> args.model;
// args.models {роль: модель} переопределяет умолчание роли. Те же args - те же модели (resume берет кэш).
const MODEL = (args && args.model) || undefined
const MODEL_LIGHT = (args && args.model_light) || MODEL
const ROLE_MODELS = (args && args.models) || {}
if (typeof ROLE_MODELS !== 'object' || Array.isArray(ROLE_MODELS)) throw new Error('args.models: объект {роль: модель}')
const ROLES = {
  run: 'light', judge: 'strong', fixer: 'strong', 'cross-judge': 'strong', blind: 'strong',
}
const modelFor = role => {
  if (!ROLES[role]) throw new Error(`роль ${role} не описана в ROLES`)
  return ROLE_MODELS[role] || (ROLES[role] === 'light' ? MODEL_LIGHT : MODEL)
}
const TH = Object.assign({ hero_questions: 4, clonability: 4, flow: 4, objections_closed: 0.9, blocks_on_question: 0.9 }, (args && args.thresholds) || {})
const pre = p => `Папка проекта: ${ROOT}. Все относительные пути в промтах считаются от нее; команды запускай из нее (cd "${ROOT}" && ...). Сначала прочитай ${ROOT}/CLAUDE.md, затем ${ROOT}/${p}, и выполни роль строго по нему.`
const ITEM = { type: 'object', properties: { severity: { type: 'string', enum: ['blocker', 'major', 'minor'] }, category: { type: 'string' }, rule: { type: 'string' }, problem: { type: 'string' }, page: { type: 'string' }, block_id: { type: 'string' }, quote: { type: 'string' }, proposal: { type: 'string' }, needs_fact: { type: 'boolean' } }, required: ['severity', 'rule', 'problem'] }
const FINDINGS = { type: 'object', properties: { findings: { type: 'array', items: ITEM }, verdict: { type: 'string' }, summary: { type: 'string' }, scores: { type: 'object' } }, required: ['findings', 'verdict', 'summary'] }
const JUDGE = { type: 'object', properties: { findings: { type: 'array', items: ITEM }, verdict: { type: 'string' }, summary: { type: 'string' },
  scores: { type: 'object', properties: { hero_questions: { type: 'number' }, blocks_on_question: { type: 'number' }, objections_closed: { type: 'number' }, clonability: { type: 'number' }, flow: { type: 'number' } }, required: ['hero_questions', 'blocks_on_question', 'objections_closed', 'clonability', 'flow'] },
  lint_page: { type: 'object', properties: { verdict: { type: 'string', enum: ['pass', 'fix', 'blocked'] }, summary: { type: 'string' } }, required: ['verdict', 'summary'] } },
  required: ['findings', 'verdict', 'summary', 'scores', 'lint_page'] }
const FIX = { type: 'object', properties: { slug: { type: 'string' }, fixed: { type: 'number' }, rejected: { type: 'number' }, left_open: { type: 'number' }, blocker_open: { type: 'number' }, blocks_touched: { type: 'array', items: { type: 'string' } }, lint: { type: 'string' }, page_lint: { type: 'string' }, page_lint_summary: { type: 'string' } }, required: ['slug', 'fixed', 'rejected', 'left_open', 'blocker_open', 'lint', 'page_lint'] }
const RUN = { type: 'object', properties: { ok: { type: 'boolean' }, exit_code: { type: 'number' }, stdout_tail: { type: 'string' } }, required: ['ok', 'exit_code', 'stdout_tail'] }
const run = (cmd, label, phase) => agent(`Запусти команду из папки проекта ${ROOT}:\ncd "${ROOT}" && ${cmd}\nНичего не исправляй. Верни ok (код выхода 0), exit_code и последние 40 строк вывода.`, { label, phase, effort: 'low', model: modelFor('run'), schema: RUN })
const serious = r => (r && r.findings || []).filter(f => f.severity !== 'minor')
const below = s => Object.keys(TH).filter(k => !(s && typeof s[k] === 'number' && s[k] >= TH[k]))
const judge = (slug, round, extra) => agent(`${pre('prompts/06-page-judge.md')}\nПараметры: slug=${slug}; round=${round}; scope=${round === 1 ? 'full' : 'fixed'}${extra || ''}.`, { label: `judge:${slug}:${round}`, phase: 'Judge', effort: 'high', model: modelFor('judge'), schema: JUDGE })
const fixer = (slug, files, phase, label) => agent(`${pre('prompts/06-fixer.md')}\nПараметры: slug=${slug}; findings=${files.join(',')}.`, { label, phase, effort: 'high', model: modelFor('fixer'), schema: FIX })

phase('Judge')
const judged = await pipeline(pages,
  p => judge(p.slug, 1),
  async (r1, p) => {
    if (!r1) return { slug: p.slug, round1: null }
    const base = { slug: p.slug, round1: r1.summary, lint_page: r1.lint_page && r1.lint_page.summary, scores: r1.scores }
    if (!serious(r1).length && r1.lint_page && r1.lint_page.verdict === 'pass') return { ...base, closed: 'judge' }
    const fix = await fixer(p.slug, [`work/audit/${p.slug}/round-1.json`, `work/audit/${p.slug}/lint-page.json`], 'Judge', `fix:${p.slug}`)
    if (!fix) return { ...base, fix: null, closed: null }
    const low = below(r1.scores)
    const why = [fix.blocker_open > 0 ? 'blocker' : '', low.length ? `scores:${low.join(',')}` : ''].filter(Boolean).join(';')
    if (!why) return { ...base, fix, closed: 'fixer' }
    const r2 = await judge(p.slug, 2, `; reason=${why}`)
    // A/B 2026-09-23: после второго круга находки оставались открытыми (по 5 major на страницу) - один проход фиксера
    // по находкам второго круга, третьего судьи нет: фиксер проверяет себя линтером страницы
    const fix2 = (r2 && serious(r2).length) ? await fixer(p.slug, [`work/audit/${p.slug}/round-2.json`, `work/audit/${p.slug}/lint-page.json`], 'Judge', `fix:${p.slug}:2`) : null
    return { ...base, fix, round2: r2 && r2.summary, why2: why, fix2, open: r2 ? (fix2 ? fix2.left_open + fix2.blocker_open : serious(r2).length) : null, scores: r2 ? r2.scores : r1.scores, closed: r2 ? (fix2 ? 'fixer-2' : 'judge-2') : null }
  })
log(`судья: страниц ${judged.filter(Boolean).length}, закрыто судьей ${judged.filter(x => x && x.closed === 'judge').length}, фиксером ${judged.filter(x => x && x.closed === 'fixer').length}, вторым кругом ${judged.filter(x => x && x.closed === 'judge-2').length}, фиксером после второго круга ${judged.filter(x => x && x.closed === 'fixer-2').length}`)

let cross = null, crossFixes = []
if (!(args && args.skipCross)) {
  phase('Cross')
  cross = await agent(`${pre('prompts/06-cross-judge.md')}`, { label: 'cross-judge', phase: 'Cross', effort: 'high', model: modelFor('cross-judge'), schema: FINDINGS })
  const fixable = serious(cross).filter(f => !f.needs_fact)
  const affected = [...new Set(fixable.map(f => f.page).filter(Boolean))].filter(s => pages.some(p => p.slug === s))
  if (affected.length) crossFixes = (await parallel(affected.map(s => () => fixer(s, [`work/audit/${s}/cross.json`], 'Cross', `fix:${s}:cross`)))).filter(Boolean)
}

let blind = []
if (!(args && args.skipBlind) && sample.length) {
  phase('Blind')
  blind = await pipeline(sample,
    s => agent(`${pre('prompts/06-blind-reader.md')}\nПараметры: slug=${s}.`, { label: `blind:${s}`, phase: 'Blind', effort: 'high', model: modelFor('blind'), schema: FINDINGS }),
    async (r, s) => (r && serious(r).length) ? { slug: s, blind: r.summary, scores: r.scores, fix: await fixer(s, [`work/audit/${s}/blind.json`], 'Blind', `fix:${s}:blind`) } : { slug: s, blind: r && r.summary, scores: r && r.scores })
}
await run(crossFixes.length ? 'node scripts/split-cross.mjs --merge; node scripts/render-md.mjs' : 'node scripts/render-md.mjs', 'render-md', 'Blind')
return { judged: judged.filter(Boolean), cross: cross && cross.summary, crossFixes, blind: blind.filter(Boolean) }
