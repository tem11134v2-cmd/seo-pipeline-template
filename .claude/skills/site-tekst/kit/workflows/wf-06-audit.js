export const meta = {
  name: 'wf-06-audit',
  description: 'Phase 6: judge (runs lint-page itself) + blind reader on the sample -> one fixer over judge, blind and lint findings -> fix-diff (rollback, claims check) -> judge round 2 on blocker, low scores, changed claims or rollback -> narrowing fixer; cross-judge only when there is something to compare, narrowing cross fixers; one render-md + lint-page (fresh page_sha)',
  phases: [{ title: 'Judge' }, { title: 'Cross' }, { title: 'Final' }],
}
// args: { root, pages: [{slug, type, round?}], sample?: [slug...], skipCross?: boolean, skipBlind?: boolean, crossFixAll?: boolean,
//         model?, model_light?, models?: {роль: модель},
//         thresholds?: { hero_questions: 4, clonability: 4, flow: 4, objections_closed: 0.9, blocks_on_question: 0.9 } }
// round страницы - номер первого круга судьи этого аудита (task.mjs args audit: следующий после прежних round-N.json, 1 -
// первый аудит); второй круг - round + 1. Повторный аудит (page.md изменился после прежнего) прежние круги не перезаписывает.
// Порядок страницы (решение Р4, вариант Б): судья круга 1 и слепой читатель (страница из sample) параллельно, оба только
// читают -> снимок блоков (fix-diff --snap) -> один фиксер по всем находкам страницы (round-N, lint-page, blind) ->
// fix-diff: откат блока, который после правки не прошел линтер (находка снова open), и признак правок утверждений
// (новое или измененное предложение, число, закрыта находка слепого или категории fact) -> круг 2 судьи (scope=fixed),
// если после фиксера остался blocker, оценка круга 1 ниже порога (hero_questions, flow, objections_closed,
// blocks_on_question; clonability круг не назначает), фиксер менял утверждения, lint-page не pass или fix-diff не ответил
// -> фиксер круга 2 в режиме сужения (mode=narrow: только удалить, вернуть условие, подставить формулировку факта; minor
// без правки) -> fix-diff. Третьего судьи нет: правки режима сужения и правки без второго круга report.mjs выводит разделом
// «Правки без проверки судьей» (work/audit/<slug>/fix-diff.json).
// На прогон: run-агент dedup + cross-digest --empty-report; к суду нечего (0 пар, 0 написанных гео-страниц, 0 утечек) -
// кросс-судья не зовется (cross-digest пишет пустой отчет и раскладывает его). Иначе кросс-судья (параметр current -
// страницы этого аудита) + фиксеры страниц этого аудита с исправимыми находками кросса в режиме сужения, каждый по своему
// work/audit/<slug>/cross.json (общий файл только для чтения, статусы в него собирает split-cross --merge), со снимком и
// fix-diff. Находки кросса на страницах вне аудита фиксер не получает (кроме args.crossFixAll): они в возврате
// cross_outside и в отчете (report.mjs, «Повторы между страницами»). В конце один агент run: split-cross --merge (если
// кросс-судья был), render-md и lint-page затронутых страниц - lint-page после render-md пишет page_sha итогового page.md,
// и страница не уходит в повторный аудит, пока ее текст не изменится.
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
// оценки, по которым назначается второй круг судьи (clonability - только в отчет судьи, круг не назначает)
const ROUND2_SCORES = ['hero_questions', 'flow', 'objections_closed', 'blocks_on_question']
const pre = p => `Папка проекта: ${ROOT}. Все относительные пути в промтах считаются от нее; команды запускай из нее (cd "${ROOT}" && ...). Сначала прочитай ${ROOT}/CLAUDE.md, затем ${ROOT}/${p}, и выполни роль строго по нему.`
const ITEM = { type: 'object', properties: { severity: { type: 'string', enum: ['blocker', 'major', 'minor'] }, category: { type: 'string' }, rule: { type: 'string' }, problem: { type: 'string' }, page: { type: 'string' }, block_id: { type: 'string' }, quote: { type: 'string' }, proposal: { type: 'string' }, needs_fact: { type: 'boolean' } }, required: ['severity', 'rule', 'problem'] }
const FINDINGS = { type: 'object', properties: { findings: { type: 'array', items: ITEM }, verdict: { type: 'string' }, summary: { type: 'string' }, scores: { type: 'object' } }, required: ['findings', 'verdict', 'summary'] }
const JUDGE = { type: 'object', properties: { findings: { type: 'array', items: ITEM }, verdict: { type: 'string' }, summary: { type: 'string' },
  scores: { type: 'object', properties: { hero_questions: { type: 'number' }, blocks_on_question: { type: 'number' }, objections_closed: { type: 'number' }, clonability: { type: 'number' }, flow: { type: 'number' } }, required: ['hero_questions', 'blocks_on_question', 'objections_closed', 'clonability', 'flow'] },
  lint_page: { type: 'object', properties: { verdict: { type: 'string', enum: ['pass', 'fix', 'blocked'] }, summary: { type: 'string' } }, required: ['verdict', 'summary'] } },
  required: ['findings', 'verdict', 'summary', 'scores', 'lint_page'] }
const FIX = { type: 'object', properties: { slug: { type: 'string' }, fixed: { type: 'number' }, rejected: { type: 'number' }, left_open: { type: 'number' }, blocker_open: { type: 'number' }, blocks_touched: { type: 'array', items: { type: 'string' } }, lint: { type: 'string' }, page_lint: { type: 'string' }, page_lint_summary: { type: 'string' } }, required: ['slug', 'fixed', 'rejected', 'left_open', 'blocker_open', 'lint', 'page_lint'] }
const RUN = { type: 'object', properties: { ok: { type: 'boolean' }, exit_code: { type: 'number' }, stdout_tail: { type: 'string' } }, required: ['ok', 'exit_code', 'stdout_tail'] }
const run = (cmd, label, phase) => agent(`Запусти команду из папки проекта ${ROOT} (в Bash, timeout 600000):\ncd "${ROOT}" && ${cmd}\nНичего не исправляй. Верни ok (код выхода 0), exit_code и последние 40 строк вывода дословно.`, { label, phase, effort: 'low', model: modelFor('run'), schema: RUN })
// машинная строка скрипта в хвосте вывода run-агента: FIX_DIFF {...} (fix-diff.mjs), CROSS_DIGEST {...} (cross-digest.mjs)
const machine = (r, tag) => {
  const m = r && typeof r.stdout_tail === 'string' ? r.stdout_tail.match(new RegExp(`${tag} (\\{[^\\n]*\\})`)) : null
  if (!m) return null
  try { return JSON.parse(m[1]) } catch { return null }
}
const serious = r => (r && r.findings || []).filter(f => f.severity !== 'minor')
const below = s => ROUND2_SCORES.filter(k => !(s && typeof s[k] === 'number' && s[k] >= TH[k]))
const lintBad = v => !!v && v !== 'pass'
const judge = (slug, round, scope, extra) => agent(`${pre('prompts/06-page-judge.md')}\nПараметры: slug=${slug}; round=${round}; scope=${scope}${extra || ''}.`, { label: `judge:${slug}:${round}`, phase: 'Judge', effort: 'high', model: modelFor('judge'), schema: JUDGE })
const blindAgent = slug => agent(`${pre('prompts/06-blind-reader.md')}\nПараметры: slug=${slug}.`, { label: `blind:${slug}`, phase: 'Judge', effort: 'high', model: modelFor('blind'), schema: FINDINGS })
const fixer = (slug, files, phase, label, mode) => agent(`${pre('prompts/06-fixer.md')}\nПараметры: slug=${slug}; findings=${files.join(',')}; mode=${mode}.`, { label, phase, effort: 'high', model: modelFor('fixer'), schema: FIX })
// снимок блоков перед фиксером и сравнение после него (scripts/fix-diff.mjs). У снимка id: сравнение принимает только снимок
// этого прогона (--snap-id), чужой или старый снимок - «снимка нет» (без отката). Сравнение делает новый снимок и отдает
// его id - основа для следующего фиксера страницы; id неизвестен - перед фиксером новый снимок.
const snapIds = {}
const ensureSnap = async (slug, label, phase) => {
  if (snapIds[slug]) return
  const s = machine(await run(`node scripts/fix-diff.mjs ${slug} --snap`, label, phase), 'FIX_SNAP')
  snapIds[slug] = (s && s.id) || 'none'
}
const diff = async (slug, files, mode, label, phase) => {
  const d = machine(await run(`node scripts/fix-diff.mjs ${slug} --findings ${files.join(',')} --mode ${mode} --snap-id ${snapIds[slug] || 'none'}`, label, phase), 'FIX_DIFF')
  snapIds[slug] = (d && d.snap_id) || ''
  return d
}
// fix-diff не ответил - признак правок считается выставленным (проверить нечем - пусть проверит судья)
const claimsChanged = d => !d || !!d.claims_changed || !!d.no_snapshot
const baseRound = p => (Number.isInteger(p.round) && p.round > 0 ? p.round : 1)
const inSample = new Set(!(args && args.skipBlind) ? sample : [])

phase('Judge')
const judged = await pipeline(pages,
  p => parallel([() => judge(p.slug, baseRound(p), 'full'), () => (inSample.has(p.slug) ? blindAgent(p.slug) : Promise.resolve(null))]),
  async (pair, p) => {
    const [r1, rb] = pair || []
    const n1 = baseRound(p), n2 = n1 + 1
    const blindRow = inSample.has(p.slug) ? { slug: p.slug, blind: rb && rb.summary, scores: rb && rb.scores } : null
    if (!r1) return { slug: p.slug, round1: null, blind: blindRow }
    const base = { slug: p.slug, rounds: [n1], round1: r1.summary, lint_page: r1.lint_page && r1.lint_page.summary, scores: r1.scores, blind: blindRow }
    if (!serious(r1).length && !serious(rb).length && r1.lint_page && r1.lint_page.verdict === 'pass') return { ...base, closed: 'judge' }
    // один фиксер по всем находкам страницы: судья, линтер страницы и слепой читатель (его находки - до фиксера)
    const files1 = [`work/audit/${p.slug}/round-${n1}.json`, `work/audit/${p.slug}/lint-page.json`, ...(rb ? [`work/audit/${p.slug}/blind.json`] : [])]
    await ensureSnap(p.slug, `snap:${p.slug}`, 'Judge')
    const fix = await fixer(p.slug, files1, 'Judge', `fix:${p.slug}`, 'full')
    const d1 = await diff(p.slug, files1, 'full', `diff:${p.slug}`, 'Judge')
    if (!fix) return { ...base, fix: null, diff: d1, closed: null }
    const low = below(r1.scores)
    // restored: fix-diff откатил сломанный блок и снова открыл его находки - самоотчет фиксера (blocker_open) их не видит
    const why = [fix.blocker_open > 0 ? 'blocker' : '', low.length ? `scores:${low.join(',')}` : '', claimsChanged(d1) ? 'claims' : '',
      d1 && d1.reopened > 0 ? 'restored' : '',
      lintBad(d1 && d1.page_lint ? d1.page_lint : fix.page_lint) ? 'lint' : ''].filter(Boolean).join(';')
    if (!why) return { ...base, fix, diff: d1, closed: 'fixer' }
    const r2 = await judge(p.slug, n2, 'fixed', `; reason=${why}; prev=work/audit/${p.slug}/round-${n1}.json; diff=work/audit/${p.slug}/fix-diff.json`)
    // после круга 2 - фиксер в режиме сужения: третьего судьи нет, новых утверждений он не пишет
    const files2 = [`work/audit/${p.slug}/round-${n2}.json`, `work/audit/${p.slug}/lint-page.json`]
    const need2 = !!r2 && (serious(r2).length > 0 || lintBad(r2.lint_page && r2.lint_page.verdict))
    if (need2) await ensureSnap(p.slug, `snap:${p.slug}:2`, 'Judge')
    const fix2 = need2 ? await fixer(p.slug, files2, 'Judge', `fix:${p.slug}:2`, 'narrow') : null
    // сравнение и после сбоя фиксера: недописанная правка, сломавшая блок, откатывается
    const d2 = need2 ? await diff(p.slug, files2, 'narrow', `diff:${p.slug}:2`, 'Judge') : null
    return { ...base, rounds: [n1, n2], fix, diff: d1, round2: r2 && r2.summary, why2: why, fix2, diff2: d2, open: r2 ? (fix2 ? fix2.left_open + fix2.blocker_open : serious(r2).length) : null, scores: r2 ? r2.scores : r1.scores, closed: r2 ? (fix2 ? 'fixer-2' : 'judge-2') : null }
  })
const done = judged.filter(Boolean)
const restoredN = done.reduce((s, x) => s + [x.diff, x.diff2].reduce((k, d) => k + ((d && d.restored) || []).length, 0), 0)
log(`судья: страниц ${done.length}, закрыто судьей ${done.filter(x => x.closed === 'judge').length}, фиксером ${done.filter(x => x.closed === 'fixer').length}, вторым кругом ${done.filter(x => x.closed === 'judge-2').length}, фиксером после второго круга (сужение) ${done.filter(x => x.closed === 'fixer-2').length}; слепой читатель ${done.filter(x => x.blind).length}; откатов правок фиксера ${restoredN}`)

let cross = null, crossRan = false, crossFixes = [], crossOutside = []
if (!(args && args.skipCross)) {
  phase('Cross')
  const current = pages.map(p => p.slug)
  // сравнивать нечего (0 пар к суду, 0 написанных гео-страниц, 0 утечек) - кросс-судья не зовется, пустой отчет пишет скрипт
  const pre0 = await run('node scripts/dedup.mjs && node scripts/cross-digest.mjs --empty-report', 'cross-pre', 'Cross')
  const cd = machine(pre0, 'CROSS_DIGEST')
  if (cd && cd.nothing_to_judge) {
    cross = { findings: [], verdict: 'pass', summary: `кросс-судья не нужен: пар к суду 0, гео-страниц 0, утечек 0 (ждут текстов ${cd.pending_pairs || 0})` }
    log(`кросс: ${cross.summary}`)
  } else {
    crossRan = true
    cross = await agent(`${pre('prompts/06-cross-judge.md')}\nПараметры: current=${current.join(',')}.`, { label: 'cross-judge', phase: 'Cross', effort: 'high', model: modelFor('cross-judge'), schema: FINDINGS })
    const fixable = serious(cross).filter(f => !f.needs_fact)
    const bySlug = {}
    for (const f of fixable) if (f.page) bySlug[f.page] = (bySlug[f.page] || 0) + 1
    const inAudit = s => current.includes(s)
    const affected = Object.keys(bySlug).filter(s => (args && args.crossFixAll) || inAudit(s))
    crossOutside = Object.keys(bySlug).filter(s => !affected.includes(s)).map(s => ({ slug: s, findings: bySlug[s] }))
    if (crossOutside.length) log(`кросс: находки на страницах вне аудита (фиксер не получает, в отчете): ${crossOutside.map(x => x.slug).join(', ')}`)
    const crossFix = async s => {
      const files = [`work/audit/${s}/cross.json`]
      await ensureSnap(s, `snap:${s}:cross`, 'Cross')
      const f = await fixer(s, files, 'Cross', `fix:${s}:cross`, 'narrow')
      const d = await diff(s, files, 'narrow', `diff:${s}:cross`, 'Cross')
      return f ? { ...f, diff: d } : null
    }
    if (affected.length) crossFixes = (await parallel(affected.map(s => () => crossFix(s)))).filter(Boolean)
  }
}

phase('Final')
// итоговый page.md и свежий page_sha в lint-page.json у всех страниц аудита и страниц, которые правил фиксер кросса
const touched = [...new Set([...pages.map(p => p.slug), ...crossFixes.map(f => f.slug).filter(Boolean)])]
const lintAll = touched.map(s => `node scripts/lint-page.mjs ${s}`).join('; ')
await run(`${crossRan ? 'node scripts/split-cross.mjs --merge; ' : ''}node scripts/render-md.mjs; ${lintAll}`, 'render-md', 'Final')
return { judged: done, cross: cross && cross.summary, crossFixes, cross_outside: crossOutside, blind: done.map(x => x.blind).filter(Boolean) }
