export const meta = {
  name: 'wf-04-strategy-layouts',
  description: 'Phase 4: global strategist, per-type strategists in parallel (differentiation matrix, small types in batches), merge strategy and build briefs, generate and validate per-type HTML layouts',
  phases: [{ title: 'Strategy' }, { title: 'Briefs' }, { title: 'Layouts' }],
}
// args: { root, types:[...], type_pages?:{type:N}, skipGlobal?: bool, skipTypes?: bool,
//   small_type_max?: 2, small_batch?: 4, solo_types?: ["home"], model?, model_light?, models?: {роль: модель} }
// Стратеги типов пишут каждый свой work/strategy.pages/<type>.json и идут параллельно; work/strategy.json (global от
// глобального стратега + pages) собирает scripts/merge-strategy.mjs, тот же легкий агент затем собирает брифы.
// Раскладки зависят только от work/page-types и идут параллельно со стратегией.
// Мелкие типы (<= small_type_max страниц в карте, кроме solo_types) - пакетом на одного стратега и одного генератора раскладок.
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
  'prep-args': 'light', briefs: 'light', layout: 'light', 'strategist-global': 'strong', 'strategist-type': 'strong',
}
const modelFor = role => {
  if (!ROLES[role]) throw new Error(`роль ${role} не описана в ROLES`)
  return ROLE_MODELS[role] || (ROLES[role] === 'light' ? MODEL_LIGHT : MODEL)
}
const SMALL_MAX = A.small_type_max == null ? 2 : Number(A.small_type_max)
const SMALL_BATCH = Math.max(1, Number(A.small_batch) || 4)
const SOLO = A.solo_types || ['home']
const pre = p => `Папка проекта: ${ROOT}. Все относительные пути в промтах считаются от нее; команды запускай из нее (cd "${ROOT}" && ...). Сначала прочитай ${ROOT}/CLAUDE.md, затем ${ROOT}/${p}, и выполни роль строго по нему.`
const ANY = { type: 'object', properties: { ok: { type: 'boolean' }, summary: { type: 'string' } }, required: ['ok', 'summary'] }
const RUN = { type: 'object', properties: { ok: { type: 'boolean' }, exit_code: { type: 'number' }, stdout_tail: { type: 'string' } }, required: ['ok', 'exit_code', 'stdout_tail'] }
const PREP = { type: 'object', properties: { ok: { type: 'boolean' }, type_pages: { type: 'array', items: { type: 'object', properties: { type: { type: 'string' }, pages: { type: 'number' } }, required: ['type', 'pages'] } }, error: { type: 'string' } }, required: ['ok', 'type_pages'] }
const LAYOUT = { type: 'object', properties: { results: { type: 'array', items: { type: 'object', properties: { type: { type: 'string' }, sections: { type: 'number' }, validator: { type: 'string' }, notes: { type: 'string' } }, required: ['type', 'validator'] } } }, required: ['results'] }
const tail = 'Верни ok=true и в summary - JSON результата из раздела «Формат результата» твоего промта одной строкой.'
const typeGroups = (list, tp) => {
  const small = tp ? list.filter(t => !SOLO.includes(t) && (tp[t] || 0) <= SMALL_MAX) : []
  const groups = list.filter(t => !small.includes(t)).map(t => [t])
  for (let i = 0; i < small.length; i += SMALL_BATCH) groups.push(small.slice(i, i + SMALL_BATCH))
  return groups
}
const key = g => g.join('+')
const byType = r => Object.fromEntries(((r && r.results) || []).map(x => [x.type, x]))

phase('Strategy')
let typePages = A.type_pages || null
if (!typePages) {
  const prep = await agent(`Запусти команду из папки проекта ${ROOT}:\ncd "${ROOT}" && node scripts/prep-args.mjs --types ${types.join(',')}\nНичего не исправляй. stdout команды - JSON: перенеси type_pages как список {type, pages}. ok - код выхода 0; при ошибке - текст в error.`, { label: 'prep-args', phase: 'Strategy', effort: 'low', model: modelFor('prep-args'), schema: PREP })
  if (prep && prep.ok) typePages = Object.fromEntries(prep.type_pages.map(x => [x.type, x.pages]))
  else log('prep-args не отработал: ' + ((prep && prep.error) || 'нет ответа') + ' - мелкие типы пойдут по одному')
}
const groups = typeGroups(types, typePages)
const packs = groups.filter(g => g.length > 1)
if (packs.length) log(`мелкие типы пакетами: ${packs.map(g => g.join('+')).join(' | ')}`)

const strategyChain = async () => {
  const global = A.skipGlobal ? { ok: true, summary: 'skipped' } : await agent(`${pre('prompts/04-strategist-global.md')}\n${tail}`, { label: 'strategist-global', phase: 'Strategy', effort: 'high', model: modelFor('strategist-global'), schema: ANY })
  // skipTypes: стратеги типов уже отработали (strategy.pages/*.json или strategy.json на диске) - не перезапускать при смене модели
  const perType = A.skipTypes ? [] : await parallel(groups.map(g => () => agent(`${pre('prompts/04-strategist-type.md')}\nПараметры: types=${JSON.stringify(g)}.\n${tail}`, { label: `strategist:${key(g)}`, phase: 'Strategy', effort: 'high', model: modelFor('strategist-type'), schema: ANY })))
  const lost = A.skipTypes ? [] : groups.filter((g, i) => !perType[i]).map(key)
  if (lost.length) log(`стратеги без ответа: ${lost.join(', ')} - в strategy.json останутся прежние записи этих типов (если были)`)
  const briefs = await agent(`Выполни из папки проекта ${ROOT} две команды по очереди, вторую - даже если первая завершилась с ошибкой:\n1) cd "${ROOT}" && node scripts/merge-strategy.mjs\n2) cd "${ROOT}" && node scripts/build-briefs.mjs\nНичего не исправляй и не интерпретируй. Верни ok (обе с кодом 0), exit_code (первый ненулевой код или 0) и последние 60 строк вывода обеих команд, каждую с заголовком «merge:» / «briefs:».`, { label: 'merge+build-briefs', phase: 'Briefs', effort: 'low', model: modelFor('briefs'), schema: RUN })
  if (!briefs || !briefs.ok) log('сборка стратегии или брифов с ошибками - смотри вывод: ' + (briefs && briefs.stdout_tail))
  return { global, perType, briefs }
}
const layoutChain = () => pipeline(groups,
  g => agent(`${pre('prompts/04-layout-generator.md')}\nПараметры: types=${JSON.stringify(g)}; round=1.`, { label: `layout:${key(g)}`, phase: 'Layouts', effort: 'medium', model: modelFor('layout'), schema: LAYOUT }),
  async (r, g) => {
    const one = byType(r)
    const redo = g.filter(t => !one[t] || one[t].validator !== 'pass')
    if (!redo.length) return g.map(t => one[t])
    const two = byType(await agent(`${pre('prompts/04-layout-generator.md')}\nПараметры: types=${JSON.stringify(redo)}; round=2. По каждому типу прочитай work/audit/layouts/<type>.json и исправь.`, { label: `layout:${key(redo)}:2`, phase: 'Layouts', effort: 'medium', model: modelFor('layout'), schema: LAYOUT }))
    return g.map(t => two[t] || one[t] || { type: t, validator: 'no-result' })
  })

const [strategy, layouts] = await parallel([strategyChain, layoutChain])
const s = strategy || {}
return { global: s.global && s.global.summary, perType: (s.perType || []).filter(Boolean).map(x => x.summary), briefs: s.briefs && s.briefs.stdout_tail, layouts: (layouts || []).filter(Boolean).flat() }
