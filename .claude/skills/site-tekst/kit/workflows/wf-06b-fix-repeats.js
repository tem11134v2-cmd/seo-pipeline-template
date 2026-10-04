export const meta = {
  name: 'wf-06b-fix-repeats',
  description: 'Manual tool for one page: snapshot, fixer over lint-page (+ optional findings) that re-lints itself, fix-diff (rollback), optional full judge round with a narrowing fixer, one build agent',
  phases: [{ title: 'Fix' }, { title: 'Judge' }, { title: 'Build' }],
}
// Ручной инструмент на одну страницу, когда после wf-06-audit остались повторы или страницу правили руками.
// args: { root, slug, findings?: [пути], round?: 3, skipJudge?: boolean, model?, model_light?, models?: {роль: модель} }
// Агентов: снимок блоков 1 (fix-diff --snap) + фиксер 1 (сам гоняет lint-page, до 2 кругов) + fix-diff 1 (откат блока, который
// после правки не прошел линтер, находка снова open) + судья 0-1 + фиксер по судье 0-1 (режим сужения: третьего судьи нет)
// с fix-diff + сборка 1. Правки без круга судьи после них report.mjs выводит разделом «Правки без проверки судьей».
// Сборка: render-md и lint-page страницы (page_sha итогового page.md - аудит свежий), split-cross --merge (если среди findings
// постраничный cross.json), build-html; проверки check-html, check-site-js и отчет report.mjs - только после кода 0
// build-html (иначе они прочли бы прежний прототип), между собой через «;»: код 1 check-html (major, например ненаписанный
// блок) штатный и цепочку не обрывает; итог каждой проверки - в work/output/report.md и в stdout_tail сборки. Код 2
// check-html (blocker) и ошибки check-site-js - повод для автостопа оркестратора после одной пересборки.
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
  build: 'light', run: 'light', fixer: 'strong', judge: 'strong',
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
const cmdAgent = (cmd, label, phase, role, note) => agent(`Запусти команду из папки проекта ${ROOT} (в Bash, timeout 600000: проверка скриптов прототипа на большом сайте идет дольше 2 минут):\ncd "${ROOT}" && ${cmd}\nНичего не исправляй. Верни ok (код выхода 0), exit_code и последние 40 строк вывода дословно${note || ''}.`, { label, phase, effort: 'low', model: modelFor(role), schema: RUN })
const machine = (r, tag) => {
  const m = r && typeof r.stdout_tail === 'string' ? r.stdout_tail.match(new RegExp(`${tag} (\\{[^\\n]*\\})`)) : null
  if (!m) return null
  try { return JSON.parse(m[1]) } catch { return null }
}
// снимок блоков до фиксера и сравнение после (scripts/fix-diff.mjs, --snap-id - только снимок этого прогона)
let snapId = ''
const snap = async label => { const s = machine(await cmdAgent(`node scripts/fix-diff.mjs ${slug} --snap`, label, 'Fix', 'run'), 'FIX_SNAP'); snapId = (s && s.id) || 'none' }
const diff = async (list, mode, label, phase) => {
  const d = machine(await cmdAgent(`node scripts/fix-diff.mjs ${slug} --findings ${list.join(',')} --mode ${mode} --snap-id ${snapId || 'none'}`, label, phase, 'run'), 'FIX_DIFF')
  snapId = (d && d.snap_id) || ''
  return d
}
const fixer = (list, label, phase, mode) => agent(`${pre('prompts/06-fixer.md')}\nПараметры: slug=${slug}; findings=${list.join(',')}; mode=${mode}.`, { label, phase, effort: 'high', model: modelFor('fixer'), schema: FIX })

phase('Fix')
await snap(`snap:${slug}`)
const fix = await fixer(files, 'fix:1', 'Fix', 'full')
const d1 = await diff(files, 'full', `diff:${slug}:1`, 'Fix')
log(`фиксер: fixed ${fix && fix.fixed}, lint-page ${fix && fix.page_lint} (${fix && fix.page_lint_summary}); fix-diff: ${d1 ? `изменено блоков ${d1.blocks_changed}, новых предложений ${d1.new_sentences}${(d1.restored || []).length ? `, откат ${d1.restored.join(', ')}` : ''}` : 'нет ответа'}`)

let judge = null, fix2 = null, d2 = null
if (!(args && args.skipJudge)) {
  phase('Judge')
  judge = await agent(`${pre('prompts/06-page-judge.md')}\nПараметры: slug=${slug}; round=${round}; scope=full; diff=work/audit/${slug}/fix-diff.json. Это финальный круг после лечения повторов: проверь всю страницу заново по всем пунктам, особенно повторы по счету (п. 9), название компании (п. 10) и связность переходов после правок.`, { label: `judge:${round}`, phase: 'Judge', effort: 'high', model: modelFor('judge'), schema: FINDINGS })
  if (serious(judge).length) {
    const list = [`work/audit/${slug}/round-${round}.json`, lintFile]
    if (!snapId || snapId === 'none') await snap(`snap:${slug}:2`)
    fix2 = await fixer(list, 'fix:2', 'Judge', 'narrow')
    d2 = await diff(list, 'narrow', `diff:${slug}:2`, 'Judge')
  }
}

phase('Build')
const merge = files.some(f => /\/cross\.json$/.test(f)) ? 'node scripts/split-cross.mjs --merge; ' : ''
const BUILD = `node scripts/render-md.mjs ${slug}; node scripts/lint-page.mjs ${slug}; ${merge}node scripts/build-html.mjs && { node scripts/check-html.mjs; node scripts/check-site-js.mjs; node scripts/report.mjs; }`
const build = await cmdAgent(BUILD, 'build', 'Build', 'build', '; строки итога build-html, check-html, check-site-js и report должны быть в stdout_tail (build-html упал - проверок и отчета нет, это не ошибка команды)')
return { fix, diff: d1, judge: judge && { summary: judge.summary, scores: judge.scores, open: serious(judge).length }, fix2, diff2: d2, build: build && build.stdout_tail }
