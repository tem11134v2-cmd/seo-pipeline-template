export const meta = {
  name: 'wf-03-audit-types',
  description: 'Phase 3: audit page-type files against snapshots (small types in batches), fix, re-audit (max 2 rounds)',
  phases: [{ title: 'Audit' }],
}
// args: { root, types:[...], type_pages?:{type:N}, small_type_max?: 2, small_batch?: 4, solo_types?: ["home"], model?, model_light?, models?: {роль: модель} }
// Мелкие типы (<= small_type_max страниц в карте, кроме solo_types) идут пакетом: один аудитор, один фиксер и один
// повторный аудитор на пакет; файлы находок по-прежнему свои у каждого типа. type_pages - из `node scripts/prep-args.mjs`.
const A = args || {}
const types = A.types || []
if (!types.length) throw new Error('args.types обязателен')
const ROOT = A.root || ''
if (!ROOT) throw new Error('args.root обязателен: абсолютный путь к папке проекта')
// Модели по ролям (docs/RUNBOOK.md, «Модели по ролям»): light -> args.model_light, strong -> args.model;
// args.models {роль: модель} переопределяет умолчание роли. Те же args - те же модели (resume берет кэш).
const MODEL = A.model || undefined
const MODEL_LIGHT = A.model_light || MODEL
const ROLE_MODELS = A.models || {}
if (typeof ROLE_MODELS !== 'object' || Array.isArray(ROLE_MODELS)) throw new Error('args.models: объект {роль: модель}')
const ROLES = {
  'prep-args': 'light', 'type-audit': 'strong', 'type-fix': 'strong',
}
const modelFor = role => {
  if (!ROLES[role]) throw new Error(`роль ${role} не описана в ROLES`)
  return ROLE_MODELS[role] || (ROLES[role] === 'light' ? MODEL_LIGHT : MODEL)
}
const SMALL_MAX = A.small_type_max == null ? 2 : Number(A.small_type_max)
const SMALL_BATCH = Math.max(1, Number(A.small_batch) || 4)
const SOLO = A.solo_types || ['home']
const pre = p => `Папка проекта: ${ROOT}. Все относительные пути в промтах считаются от нее; команды запускай из нее (cd "${ROOT}" && ...). Сначала прочитай ${ROOT}/CLAUDE.md, затем ${ROOT}/${p}, и выполни роль строго по нему.`
const PREP = { type: 'object', properties: { ok: { type: 'boolean' }, type_pages: { type: 'array', items: { type: 'object', properties: { type: { type: 'string' }, pages: { type: 'number' } }, required: ['type', 'pages'] } }, error: { type: 'string' } }, required: ['ok', 'type_pages'] }
const AUDIT = { type: 'object', properties: { results: { type: 'array', items: { type: 'object', properties: { type: { type: 'string' }, file: { type: 'string' }, verdict: { type: 'string' }, summary: { type: 'string' }, blocker: { type: 'number' }, major: { type: 'number' }, minor: { type: 'number' } }, required: ['type', 'verdict', 'summary', 'blocker', 'major'] } } }, required: ['results'] }
const FIX = { type: 'object', properties: { results: { type: 'array', items: { type: 'object', properties: { type: { type: 'string' }, fixed: { type: 'number' }, rejected: { type: 'number' }, left_open: { type: 'number' }, changes: { type: 'array', items: { type: 'string' } } }, required: ['type', 'fixed', 'rejected', 'left_open'] } } }, required: ['results'] }
const typeGroups = (list, tp) => {
  const small = tp ? list.filter(t => !SOLO.includes(t) && (tp[t] || 0) <= SMALL_MAX) : []
  const groups = list.filter(t => !small.includes(t)).map(t => [t])
  for (let i = 0; i < small.length; i += SMALL_BATCH) groups.push(small.slice(i, i + SMALL_BATCH))
  return groups
}
const byType = r => Object.fromEntries(((r && r.results) || []).map(x => [x.type, x]))
const serious = x => x ? (x.blocker || 0) + (x.major || 0) : 0

phase('Audit')
let typePages = A.type_pages || null
if (!typePages) {
  const prep = await agent(`Запусти команду из папки проекта ${ROOT}:\ncd "${ROOT}" && node scripts/prep-args.mjs --types ${types.join(',')}\nНичего не исправляй. stdout команды - JSON: перенеси type_pages как список {type, pages}. ok - код выхода 0; при ошибке - текст в error.`, { label: 'prep-args', phase: 'Audit', effort: 'low', model: modelFor('prep-args'), schema: PREP })
  if (prep && prep.ok) typePages = Object.fromEntries(prep.type_pages.map(x => [x.type, x.pages]))
  else log('prep-args не отработал: ' + ((prep && prep.error) || 'нет ответа') + ' - мелкие типы пойдут по одному')
}
const groups = typeGroups(types, typePages)
const packs = groups.filter(g => g.length > 1)
if (packs.length) log(`мелкие типы пакетами: ${packs.map(g => g.join('+')).join(' | ')}`)
const key = g => g.join('+')

const results = await pipeline(groups,
  g => agent(`${pre('prompts/03-type-auditor.md')}\nПараметры: types=${JSON.stringify(g)}; round=1.`, { label: `audit:${key(g)}:1`, phase: 'Audit', effort: 'high', model: modelFor('type-audit'), schema: AUDIT }),
  async (r1, g) => {
    const one = byType(r1)
    const lost = g.filter(t => !one[t])
    if (lost.length) log(`аудит круг 1: нет результата для ${lost.join(', ')}`)
    const bad = g.filter(t => serious(one[t]))
    if (!bad.length) return g.map(t => ({ type: t, round1: one[t] || null, fix: null, round2: null }))
    const fix = byType(await agent(`${pre('prompts/03-type-fixer.md')}\nПараметры: types=${JSON.stringify(bad)}; round=1.`, { label: `fix:${key(bad)}`, phase: 'Audit', effort: 'high', model: modelFor('type-fix'), schema: FIX }))
    const two = byType(await agent(`${pre('prompts/03-type-auditor.md')}\nПараметры: types=${JSON.stringify(bad)}; round=2.`, { label: `audit:${key(bad)}:2`, phase: 'Audit', effort: 'high', model: modelFor('type-audit'), schema: AUDIT }))
    for (const t of bad) if (serious(two[t])) log(`тип ${t}: после второго круга остались серьезные находки (${serious(two[t])}) - смотреть work/audit/types/${t}-round-2.json`)
    return g.map(t => bad.includes(t) ? { type: t, round1: one[t], fix: fix[t] || null, round2: two[t] || null } : { type: t, round1: one[t] || null, fix: null, round2: null })
  })
return results.filter(Boolean).flat().map(r => ({ type: r.type, round1: r.round1 && r.round1.summary, fixed: r.fix && r.fix.fixed, round2: r.round2 && r.round2.summary, open: r.round2 ? serious(r.round2) : serious(r.round1) }))
