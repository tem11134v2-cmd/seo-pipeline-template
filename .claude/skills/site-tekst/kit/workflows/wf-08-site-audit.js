export const meta = {
  name: 'wf-08-site-audit',
  description: 'Phase 8: audit of the built prototype as a whole site - digest and first-screen shots, one site auditor, split findings by page, one narrowing fixer round (max 8 pages) with fix-diff, merge statuses, one label per action (cta-unify). Step failures are recorded, never thrown',
  phases: [{ title: 'Digest' }, { title: 'Audit' }, { title: 'Fix' }, { title: 'Unify' }],
}
// args: { root, maxFixPages?: 8, fixPages?: [slug], model?, model_light?, models?: {роль: модель} }
// fixPages - явный список страниц фиксера вместо строки SITE_SPLIT (повтор вручную, проверка ролей); тот же потолок 8.
// Один круг, без пауз (решение владельца 05.10, §0 п.7): run-агент дайджеста и скриншотов (site-digest.mjs --shots) ->
// аудитор прототипа (prompts/08-site-auditor.md -> work/audit/site.json) -> run-агент split-site.mjs (постраничные
// work/audit/<slug>/site.json: только находки с page и без zone) -> на страницу с исправимыми blocker/major без needs_fact
// (не больше maxFixPages, blocker первыми): run-агент fix-diff --snap, фиксер 06-fixer в режиме сужения (mode=narrow) по
// постраничному site.json, run-агент fix-diff --mode narrow (откат блока, который после правки не прошел линтер) ->
// run-агент split-site --merge --record (статусы в общий site.json, итог шагов в run) -> run-агент cta-unify.mjs (одно
// действие - одна надпись; свой шаг пишет сам). Судьи после фиксера нет: правки - в отчете «Правки без проверки судьей»
// (fix-diff.json, cta_unify в site.json). Сбой шага (null или исключение агента, код не 0) - запись в run и в failed_steps,
// не throw: аудит прототипа не останавливает сдачу (автостопа нет). wf-06b через workflow() не зовется.
// Возврат: { fixed_pages: [slug], cta_unified: N, failed_steps: [имя], summary }.
const ROOT = (args && args.root) || ''
if (!ROOT) throw new Error('args.root обязателен: абсолютный путь к папке проекта')
const MAX_FIX = Number.isInteger(args && args.maxFixPages) && args.maxFixPages >= 0 ? Math.min(args.maxFixPages, 8) : 8
// Модели по ролям (docs/RUNBOOK.md, «Модели по ролям»): light -> args.model_light, strong -> args.model;
// args.models {роль: модель} переопределяет умолчание роли. Те же args - те же модели (resume берет кэш).
const MODEL = (args && args.model) || undefined
const MODEL_LIGHT = (args && args.model_light) || MODEL
const ROLE_MODELS = (args && args.models) || {}
if (typeof ROLE_MODELS !== 'object' || Array.isArray(ROLE_MODELS)) throw new Error('args.models: объект {роль: модель}')
const ROLES = {
  run: 'light', 'site-audit': 'strong', fixer: 'strong',
}
const modelFor = role => {
  if (!ROLES[role]) throw new Error(`роль ${role} не описана в ROLES`)
  return ROLE_MODELS[role] || (ROLES[role] === 'light' ? MODEL_LIGHT : MODEL)
}
const pre = p => `Папка проекта: ${ROOT}. Все относительные пути в промтах считаются от нее; команды запускай из нее (cd "${ROOT}" && ...). Сначала прочитай ${ROOT}/CLAUDE.md, затем ${ROOT}/${p}, и выполни роль строго по нему.`
const RUN = { type: 'object', properties: { ok: { type: 'boolean' }, exit_code: { type: 'number' }, stdout_tail: { type: 'string' } }, required: ['ok', 'exit_code', 'stdout_tail'] }
const FIX = { type: 'object', properties: { slug: { type: 'string' }, fixed: { type: 'number' }, rejected: { type: 'number' }, left_open: { type: 'number' }, blocker_open: { type: 'number' }, blocks_touched: { type: 'array', items: { type: 'string' } }, lint: { type: 'string' }, page_lint: { type: 'string' }, page_lint_summary: { type: 'string' } }, required: ['slug', 'fixed', 'rejected', 'left_open', 'blocker_open', 'lint', 'page_lint'] }
const AUDIT = { type: 'object', properties: { findings: { type: 'number' }, blocker: { type: 'number' }, major: { type: 'number' }, cta_unify: { type: 'number' }, verdict: { type: 'string', enum: ['pass', 'fix', 'blocked'] }, summary: { type: 'string' }, file: { type: 'string' } }, required: ['findings', 'verdict', 'summary'] }

// сбой шага - запись, не исключение
const steps = []
const errors = []
const failed = []
const note = (name, status, err) => {
  steps.push(`${name}=${status}`)
  if (status === 'fail') { failed.push(name); if (err) errors.push(`${name}: ${err}`) }
}
const safe = async fn => { try { return await fn() } catch (e) { return { __error: String((e && e.message) || e).slice(0, 200) } } }
const errOf = r => (r && r.__error) || (!r ? 'агент не ответил' : '')
const run = (cmd, label, phase) => safe(() => agent(`Запусти команду из папки проекта ${ROOT} (в Bash, timeout 600000):\ncd "${ROOT}" && ${cmd}\nНичего не исправляй. Верни ok (код выхода 0), exit_code и последние 40 строк вывода дословно.`, { label, phase, effort: 'low', model: modelFor('run'), schema: RUN }))
const runOk = r => !!r && !r.__error && r.ok === true
// машинная строка скрипта в хвосте вывода run-агента: SITE_SPLIT {...}, FIX_SNAP {...}, FIX_DIFF {...}, CTA_UNIFY {...}
const machine = (r, tag) => {
  const m = r && typeof r.stdout_tail === 'string' ? r.stdout_tail.match(new RegExp(`${tag} (\\{[^\\n]*\\})`)) : null
  if (!m) return null
  try { return JSON.parse(m[1]) } catch { return null }
}
// текст ошибки - в аргумент командной строки без кавычек и спецсимволов оболочки
const clean = s => String(s || '').replace(/["'`$\\|;&<>\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160)

phase('Digest')
const dg = await run('node scripts/site-digest.mjs --shots', 'site-digest', 'Digest')
note('digest', runOk(dg) ? 'ok' : 'fail', errOf(dg) || (dg && !dg.ok ? `код ${dg.exit_code}` : ''))
const digestLine = machine(dg, 'SITE_DIGEST')
if (digestLine) log(`дайджест: страниц ${digestLine.pages}, групп надписей ${digestLine.cta_groups} (разные подписи: ${(digestLine.cta_multi || []).join(', ') || 'нет'}), скриншоты ${digestLine.shots}`)

phase('Audit')
let audit = null
if (runOk(dg)) {
  audit = await safe(() => agent(`${pre('prompts/08-site-auditor.md')}\nПараметры: digest=work/audit/site-digest.json; out=work/audit/site.json.`, { label: 'site-audit', phase: 'Audit', effort: 'high', model: modelFor('site-audit'), schema: AUDIT }))
  note('audit', audit && !audit.__error ? 'ok' : 'fail', errOf(audit))
  if (audit && !audit.__error) log(`аудитор прототипа: ${audit.summary}`)
} else note('audit', 'skip')
const auditOk = !!audit && !audit.__error

let fixPages = []
if (auditOk) {
  const sp = await run('node scripts/split-site.mjs', 'split-site', 'Audit')
  const split = machine(sp, 'SITE_SPLIT')
  note('split', runOk(sp) && split ? 'ok' : 'fail', errOf(sp) || (sp && !sp.ok ? `код ${sp.exit_code}` : 'нет строки SITE_SPLIT'))
  const explicit = Array.isArray(args && args.fixPages) ? args.fixPages.filter(s => typeof s === 'string' && s).map(slug => ({ slug })) : null
  fixPages = (explicit || (split && Array.isArray(split.pages) ? split.pages.filter(p => p && p.slug) : [])).slice(0, MAX_FIX)
  if (!explicit && split && split.pages && split.pages.length > MAX_FIX) log(`страниц с исправимыми находками ${split.pages.length}, фиксер - первым ${MAX_FIX} (остальное - в отчет)`)
} else note('split', 'skip')

phase('Fix')
const fixPage = async p => {
  const file = `work/audit/${p.slug}/site.json`
  const s = await run(`node scripts/fix-diff.mjs ${p.slug} --snap`, `snap:${p.slug}`, 'Fix')
  const snap = machine(s, 'FIX_SNAP')
  if (!runOk(s) || !snap) note(`snap:${p.slug}`, 'fail', errOf(s) || 'нет строки FIX_SNAP')
  const fix = await safe(() => agent(`${pre('prompts/06-fixer.md')}\nПараметры: slug=${p.slug}; findings=${file}; mode=narrow.`, { label: `fix:${p.slug}`, phase: 'Fix', effort: 'high', model: modelFor('fixer'), schema: FIX }))
  if (!fix || fix.__error) note(`fix:${p.slug}`, 'fail', errOf(fix))
  // сравнение и после сбоя фиксера: недописанная правка, сломавшая блок, откатывается
  const d = await run(`node scripts/fix-diff.mjs ${p.slug} --findings ${file} --mode narrow --snap-id ${(snap && snap.id) || 'none'}`, `diff:${p.slug}`, 'Fix')
  const diff = machine(d, 'FIX_DIFF')
  if (!runOk(d) || !diff) note(`diff:${p.slug}`, 'fail', errOf(d) || 'нет строки FIX_DIFF')
  const good = !!fix && !fix.__error
  return { slug: p.slug, ok: good, fixed: good ? fix.fixed : 0, left_open: good ? fix.left_open : null, restored: diff ? diff.restored || [] : [], page_lint: diff ? diff.page_lint : '' }
}
const fixes = fixPages.length ? (await safe(() => parallel(fixPages.map(p => () => fixPage(p))))) : []
const fixList = Array.isArray(fixes) ? fixes.filter(Boolean) : []
if (fixes && fixes.__error) note('fix', 'fail', fixes.__error)
else note('fix', fixPages.length ? (fixList.every(x => x.ok) ? 'ok' : 'partial') : 'skip')
const fixedPages = fixList.filter(x => x.ok && x.fixed > 0).map(x => x.slug)
if (fixList.length) log(`фиксер (сужение): страниц ${fixList.length}, с правками ${fixedPages.length}; откатов fix-diff ${fixList.reduce((n, x) => n + x.restored.length, 0)}`)

phase('Unify')
// статусы постраничных копий -> общий site.json и итог шагов (нет site.json - пустой отчет с run)
const merged = steps.concat(auditOk ? ['merge=ok'] : [])
const mg = await run(`node scripts/split-site.mjs${auditOk ? ' --merge' : ''} --record "${merged.join(';')}"${errors.length ? ` --errors "${errors.map(clean).join('|')}"` : ''}`, 'split-site:merge', 'Unify')
if (!runOk(mg)) { failed.push('merge'); errors.push(`merge: ${clean(errOf(mg) || (mg && `код ${mg.exit_code}`))}`) }
let ctaUnified = 0
if (auditOk) {
  const cu = await run('node scripts/cta-unify.mjs', 'cta-unify', 'Unify')
  const res = machine(cu, 'CTA_UNIFY')
  if (!runOk(cu) || !res) {
    failed.push('cta-unify')
    await run(`node scripts/split-site.mjs --record "cta-unify=fail" --errors "${clean(`cta-unify: ${errOf(cu) || (cu && `код ${cu.exit_code}`) || 'нет строки CTA_UNIFY'}`)}"`, 'split-site:record', 'Unify')
  } else {
    ctaUnified = res.applied || 0
    if (res.applied || res.refused) log(`cta-unify: применено ${res.applied}, отказ ${res.refused}${(res.pages || []).length ? `; страницы ${res.pages.join(', ')}` : ''}`)
  }
}
const summary = auditOk ? `аудит прототипа: ${audit.summary}; фиксер ${fixList.length} стр., надписей ${ctaUnified}${failed.length ? `; сбои: ${failed.join(', ')}` : ''}` : `аудит прототипа не отработал: ${errors.join('; ') || 'нет дайджеста'}`
return { fixed_pages: fixedPages, cta_unified: ctaUnified, failed_steps: failed, summary }
