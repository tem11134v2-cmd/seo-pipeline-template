export const meta = {
  name: 'wf-06b-fix-repeats',
  description: 'Manual tool for one page: fixer over lint-page (+ optional findings) that re-lints itself, optional full judge round, one build agent',
  phases: [{ title: 'Fix' }, { title: 'Judge' }, { title: 'Build' }],
}
// Ручной инструмент на одну страницу, когда после wf-06-audit остались повторы или страницу правили руками.
// args: { root, slug, findings?: [пути], round?: 3, skipJudge?: boolean, model?, model_light?, models?: {роль: модель} }
// Агентов: фиксер 1 (сам гоняет lint-page, до 2 кругов) + судья 0-1 + фиксер по судье 0-1 + сборка 1 = 2-4 (было 5-7).
const ROOT = (args && args.root) || ''
if (!ROOT) throw new Error('args.root обязателен: абсолютный путь к папке проекта')
const slug = args && args.slug
if (!slug) throw new Error('args.slug обязателен')
// Модели по ролям (docs/RUNBOOK.md, «Модели по ролям»): light -> args.model_light, strong -> args.model;
// args.models {роль: модель} переопределяет умолчание роли. Те же args - те же модели (resume берет кэш).
const MODEL = (args && args.model) || undefined
const MODEL_LIGHT = (args && args.model_light) || MODEL
const ROLE_MODELS = (args && args.models) || {}
if (typeof ROLE_MODELS !== 'object' || Array.isArray(ROLE_MODELS)) throw new Error('args.models: объект {роль: модель}')
const ROLES = {
  build: 'light', fixer: 'strong', judge: 'strong',
}
const modelFor = role => {
  if (!ROLES[role]) throw new Error(`роль ${role} не описана в ROLES`)
  return ROLE_MODELS[role] || (ROLES[role] === 'light' ? MODEL_LIGHT : MODEL)
}
const round = (args && args.round) || 3
const lintFile = `work/audit/${slug}/lint-page.json`
const files = [lintFile, ...((args && args.findings) || []).filter(f => f !== lintFile)]
const pre = p => `Папка проекта: ${ROOT}. Все относительные пути в промтах считаются от нее; команды запускай из нее (cd "${ROOT}" && ...). Сначала прочитай ${ROOT}/CLAUDE.md, затем ${ROOT}/${p}, и выполни роль строго по нему.`
const RUN = { type: 'object', properties: { ok: { type: 'boolean' }, exit_code: { type: 'number' }, stdout_tail: { type: 'string' } }, required: ['ok', 'exit_code', 'stdout_tail'] }
const FIX = { type: 'object', properties: { slug: { type: 'string' }, fixed: { type: 'number' }, rejected: { type: 'number' }, left_open: { type: 'number' }, blocker_open: { type: 'number' }, blocks_touched: { type: 'array', items: { type: 'string' } }, lint: { type: 'string' }, page_lint: { type: 'string' }, page_lint_summary: { type: 'string' } }, required: ['slug', 'fixed', 'rejected', 'left_open', 'blocker_open', 'lint', 'page_lint'] }
const FINDINGS = { type: 'object', properties: { findings: { type: 'array', items: { type: 'object', properties: { severity: { type: 'string', enum: ['blocker', 'major', 'minor'] }, category: { type: 'string' }, rule: { type: 'string' }, problem: { type: 'string' }, block_id: { type: 'string' }, quote: { type: 'string' }, proposal: { type: 'string' } }, required: ['severity', 'rule', 'problem'] } }, verdict: { type: 'string' }, summary: { type: 'string' }, scores: { type: 'object' }, lint_page: { type: 'object' } }, required: ['findings', 'verdict', 'summary', 'scores'] }
const serious = r => (r && r.findings || []).filter(f => f.severity !== 'minor')
const fixer = (list, label, phase) => agent(`${pre('prompts/06-fixer.md')}\nПараметры: slug=${slug}; findings=${list.join(',')}.`, { label, phase, effort: 'high', model: modelFor('fixer'), schema: FIX })

phase('Fix')
const fix = await fixer(files, 'fix:1', 'Fix')
log(`фиксер: fixed ${fix && fix.fixed}, lint-page ${fix && fix.page_lint} (${fix && fix.page_lint_summary})`)

let judge = null, fix2 = null
if (!(args && args.skipJudge)) {
  phase('Judge')
  judge = await agent(`${pre('prompts/06-page-judge.md')}\nПараметры: slug=${slug}; round=${round}; scope=full. Это финальный круг после лечения повторов: проверь всю страницу заново по всем пунктам, особенно повторы по счету (п. 9), название компании (п. 10) и связность переходов после правок.`, { label: `judge:${round}`, phase: 'Judge', effort: 'high', model: modelFor('judge'), schema: FINDINGS })
  if (serious(judge).length) fix2 = await fixer([`work/audit/${slug}/round-${round}.json`, lintFile], 'fix:2', 'Judge')
}

phase('Build')
const build = await agent(`Запусти команду из папки проекта ${ROOT}:\ncd "${ROOT}" && node scripts/lint-page.mjs ${slug}; node scripts/render-md.mjs ${slug} && node scripts/build-html.mjs && node scripts/check-html.mjs; node scripts/report.mjs\nНичего не исправляй. Верни ok (код выхода 0), exit_code и последние 40 строк вывода.`, { label: 'build', phase: 'Build', effort: 'low', model: modelFor('build'), schema: RUN })
return { fix, judge: judge && { summary: judge.summary, scores: judge.scores, open: serious(judge).length }, fix2, build: build && build.stdout_tail }
