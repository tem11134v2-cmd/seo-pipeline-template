export const meta = {
  name: 'wf-04-strategy-layouts',
  description: 'Phase 4: global strategist, per-type strategists in parallel (differentiation matrix, small types in batches), merge strategy and build briefs, strategy review and a second merge + briefs build, generate and validate per-type HTML layouts; update mode after client answers (facts_diff, optional sitemap enrich pass with map check)',
  phases: [{ title: 'Strategy' }, { title: 'Briefs' }, { title: 'Layouts' }],
}
// args: { root, types:[...], type_pages?:{type:N}, skipGlobal?: bool, skipTypes?: bool, skipReview?: bool,
//   skipLayouts?: bool, update?: bool, enrich?: bool,
//   small_type_max?: 2, small_batch?: 4, solo_types?: ["home"], model?, model_light?, models?: {роль: модель} }
// Стратеги типов пишут каждый свой work/strategy.pages/<type>.json и идут параллельно; work/strategy.json (global от
// глобального стратега + pages) собирает scripts/merge-strategy.mjs, тот же легкий агент затем собирает брифы.
// Рецензия стратегии (04-strategist-global, mode=review; skipReview - без нее) правит записи страниц по матрице
// merge-strategy --matrix, затем merge + build-briefs повторяются (label merge+build-briefs:review). Возврат: проблемы
// сборки брифов целиком и сводка предупреждений; briefs_problems - проблемы последней сборки: непустой - автостоп (C8).
// Строки « ~ » обеих команд (замечания по содержанию) - поле review_notes: идут в рецензию, в автостоп не идут.
// Раскладки зависят только от work/page-types и идут параллельно со стратегией; skipLayouts - не перегенерировать.
// update (после ответов заказчика, K4): run-агент читает facts_diff из work/import-report.json (нет - отказ), стратеги
// идут с mode=update и facts_diff (переносят записи, правят только по диффу); глобальный - только при новых фактах
// (added, published), стратеги типов - только при непустом диффе. update + enrich: до стратегов проход обогатителя карты
// 01-sitemap-enricher mode=facts со сверкой карты скриптом до и после (изменилось лишнее - скрипт откатывает карту).
// Рецензия в update - с mode=review; update; facts_diff и changed_pages стратегов типов (правит только их и страницы из
// проблем и замечаний сборки); страниц с изменениями нет (пустой дифф) и сборка чистая - рецензия не нужна.
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
  'prep-args': 'light', briefs: 'light', layout: 'light', run: 'light', 'strategist-global': 'strong', 'strategist-type': 'strong',
  'strategy-review': 'strong', 'sitemap-enrich': 'strong',
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
const LIST = { type: 'array', items: { type: 'string' } }
const BRIEFS = { type: 'object', properties: { ok: { type: 'boolean' }, exit_code: { type: 'number' }, problems: LIST, review_notes: LIST, warnings: { type: 'string' }, merge: { type: 'string' } }, required: ['ok', 'exit_code', 'problems', 'review_notes', 'warnings'] }
const RUN = { type: 'object', properties: { ok: { type: 'boolean' }, exit_code: { type: 'number' }, stdout_tail: { type: 'string' } }, required: ['ok', 'exit_code', 'stdout_tail'] }
const DIFF_KEYS = ['added', 'removed', 'changed', 'published', 'unpublished']
const DIFF = { type: 'object', properties: { ok: { type: 'boolean' }, ...Object.fromEntries(DIFF_KEYS.map(k => [k, LIST])), error: { type: 'string' } }, required: ['ok', ...DIFF_KEYS] }
// сверка карты вокруг прохода обогатителя (import-structure.mjs --check-enrich, K4): before - копия карты в
// work/sitemap.pre-enrich.json; after - сверка с копией. Коды after: 0 - изменились только facts_available,
// fact_coverage, block_set; 3 - изменилось лишнее, скрипт вернул карту из копии; 2 - нет карты или копии (сверки не было)
const ENRICH_SAVE = 'node scripts/import-structure.mjs --check-enrich before'
const ENRICH_CHECK = 'node scripts/import-structure.mjs --check-enrich after'
const ENRICH_ROLLBACK = 3
const ENRICH_NO_COPY = 2
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
const run = (cmd, label) => agent(`Запусти команду из папки проекта ${ROOT}:\ncd "${ROOT}" && ${cmd}\nНичего не исправляй и не интерпретируй. Верни ok (код выхода 0), exit_code и последние 40 строк вывода.`, { label, phase: 'Strategy', effort: 'low', model: modelFor('run'), schema: RUN })

phase('Strategy')
// режим обновления (K4): без facts_diff в отчете импорта - отказ до любых агентов стратегии
let diff = null
if (A.update) {
  const u = await agent(`Прочитай файл ${ROOT}/work/import-report.json. Ничего не запускай и не исправляй. Есть объект facts_diff - верни ok=true и его массивы ${DIFF_KEYS.join(', ')} как есть (нет массива - пустой). Нет файла или facts_diff - ok=false, массивы пустые, в error - причина.`, { label: 'update-check', phase: 'Strategy', effort: 'low', model: modelFor('run'), schema: DIFF })
  if (!u || !u.ok) throw new Error(`args.update: в work/import-report.json нет facts_diff (${(u && u.error) || 'агент не ответил'}) - сначала --facts-only новым kit: node scripts/import-project.mjs --facts-only`)
  diff = Object.fromEntries(DIFF_KEYS.map(k => [k, Array.isArray(u[k]) ? u[k] : []]))
}
if (A.enrich && !A.update) log('args.enrich без args.update не действует: обогатитель карты в wf-04 - только в режиме обновления')
let typePages = A.type_pages || null
if (!typePages) {
  const prep = await agent(`Запусти команду из папки проекта ${ROOT}:\ncd "${ROOT}" && node scripts/prep-args.mjs --types ${types.join(',')}\nНичего не исправляй. stdout команды - JSON: перенеси type_pages как список {type, pages}. ok - код выхода 0; при ошибке - текст в error.`, { label: 'prep-args', phase: 'Strategy', effort: 'low', model: modelFor('prep-args'), schema: PREP })
  if (prep && prep.ok) typePages = Object.fromEntries(prep.type_pages.map(x => [x.type, x.pages]))
  else log('prep-args не отработал: ' + ((prep && prep.error) || 'нет ответа') + ' - мелкие типы пойдут по одному')
}
const groups = typeGroups(types, typePages)
const packs = groups.filter(g => g.length > 1)
if (packs.length) log(`мелкие типы пакетами: ${packs.map(g => g.join('+')).join(' | ')}`)

// merge-strategy + build-briefs одним легким агентом: проблемы целиком, замечания « ~ » отдельно, предупреждения сводкой
const buildBriefs = async label => {
  const r = await agent(`Выполни из папки проекта ${ROOT} две команды по очереди, вторую - даже если первая завершилась с ошибкой:\n1) cd "${ROOT}" && node scripts/merge-strategy.mjs\n2) cd "${ROOT}" && node scripts/build-briefs.mjs\nНичего не исправляй и не интерпретируй. Верни: ok (обе с кодом 0); exit_code (первый ненулевой код или 0); problems - все строки проблем обеих команд дословно и целиком, без сокращений (merge-strategy печатает их строками « - ...» в конце, build-briefs - разделом проблем перед сводкой предупреждений); нет проблем - пустой список; review_notes - все строки « ~ ...» обеих команд дословно и целиком (замечания по содержанию, в problems их не клади); нет - пустой список; warnings - сводка предупреждений build-briefs как есть (виды, счетчики, примеры); merge - итоговая строка merge-strategy.`, { label, phase: 'Briefs', effort: 'low', model: modelFor('briefs'), schema: BRIEFS })
  if (!r) log(`${label}: агент сборки не ответил`)
  else if (!r.ok) log(`${label}: код ${r.exit_code}, проблем ${(r.problems || []).length}`)
  return r
}
// update + enrich (K4): проход обогатителя mode=facts до стратегов (стратег типа читает block_set), карта сверяется скриптом
const enrichStep = async () => {
  if (!(A.update && A.enrich)) return null
  const before = await run(ENRICH_SAVE, 'enrich-check:before')
  if (!before || !before.ok) {
    const notes = `копия карты не снята (${before ? 'код ' + before.exit_code + ': ' + before.stdout_tail : 'нет ответа'}) - обогатитель не запускался`
    log('enrich: ' + notes.slice(0, 300))
    return { ok: false, rolled_back: false, notes }
  }
  const en = await agent(`${pre('prompts/01-sitemap-enricher.md')}\nПараметры: mode=facts.\n${tail}`, { label: 'sitemap-enrich', phase: 'Strategy', effort: 'high', model: modelFor('sitemap-enrich'), schema: ANY })
  const after = await run(ENRICH_CHECK, 'enrich-check:after')
  if (after && after.ok) return { ok: true, rolled_back: false, notes: `${(en && en.summary) || 'обогатитель не ответил'} | сверка: ${after.stdout_tail}` }
  const rolledBack = !!after && after.exit_code === ENRICH_ROLLBACK
  const notes = !after ? 'сверка карты после обогатителя не ответила - карта не сверена'
    : rolledBack ? `карта после обогатителя изменилась сверх facts_available, fact_coverage, block_set - скрипт вернул ее из копии (код ${after.exit_code}): ${after.stdout_tail}`
    : `сверка не выполнена (код ${after.exit_code}${after.exit_code === ENRICH_NO_COPY ? ': нет карты или копии' : ''}) - карта после обогатителя не сверена: ${after.stdout_tail}`
  log('enrich: ' + notes.slice(0, 300))
  return { ok: false, rolled_back: rolledBack, notes }
}
// changed_pages стратегов типов в update (раздел «Режим обновления» 04-strategist-type); null - не все вернули это поле
const changedOf = perType => {
  const all = []
  for (const r of perType) {
    let j = null
    try { j = JSON.parse((r && r.summary) || '') } catch (e) { return null }
    const lists = j && Array.isArray(j.changed_pages) ? [j.changed_pages] : ((j && j.results) || []).map(x => x && x.changed_pages)
    if (!lists.length || lists.some(x => !Array.isArray(x))) return null
    lists.forEach(x => all.push(...x))
  }
  return [...new Set(all)]
}
const strategyChain = async () => {
  const enrich = await enrichStep()
  // update: глобальный стратег - только при новых фактах (дописать углы), стратеги типов - только при непустом диффе
  const newFacts = diff ? diff.added.length + diff.published.length : 0
  const anyDiff = diff ? DIFF_KEYS.some(k => diff[k].length) : true
  const upd = diff ? `mode=update; facts_diff=${JSON.stringify(diff)}` : ''
  if (diff && !newFacts && !A.skipGlobal) log('update: новых фактов (added, published) нет - глобальный стратег не нужен')
  if (diff && !anyDiff && !A.skipTypes) log('update: facts_diff пуст - стратеги типов не запускались, записи страниц как были')
  const skipGlobal = A.skipGlobal || (diff && !newFacts)
  const skipTypes = A.skipTypes || !anyDiff
  const global = skipGlobal ? { ok: true, summary: 'skipped' } : await agent(`${pre('prompts/04-strategist-global.md')}${upd ? `\nПараметры: ${upd}.` : ''}\n${tail}`, { label: 'strategist-global', phase: 'Strategy', effort: 'high', model: modelFor('strategist-global'), schema: ANY })
  // skipTypes: стратеги типов уже отработали (strategy.pages/*.json или strategy.json на диске) - не перезапускать при смене модели
  const perType = skipTypes ? [] : await parallel(groups.map(g => () => agent(`${pre('prompts/04-strategist-type.md')}\nПараметры: types=${JSON.stringify(g)}${upd ? '; ' + upd : ''}.\n${tail}`, { label: `strategist:${key(g)}`, phase: 'Strategy', effort: 'high', model: modelFor('strategist-type'), schema: ANY })))
  const lost = skipTypes ? [] : groups.filter((g, i) => !perType[i]).map(key)
  if (lost.length) log(`стратеги без ответа: ${lost.join(', ')} - в strategy.json останутся прежние записи этих типов (если были)`)
  const first = await buildBriefs('merge+build-briefs')
  if (A.skipReview) return { enrich, global, perType, briefs: first, review: null, final: first }
  // рецензия стратегии: правит записи strategy.pages/<type>.json по матрице, неразрешимое - в §8 decisions.md
  const probs = first ? (first.problems || []) : ['сборка брифов не ответила']
  const probsText = probs.length ? `\nПроблемы сборки брифов до рецензии (те, что вызваны записями стратегии, исправь первыми):\n${probs.map(p => `- ${p}`).join('\n')}` : ''
  const notes = first ? (first.review_notes || []) : []
  const notesText = notes.length ? `\nЗамечания сборки брифов (строки « ~ », в автостоп не идут; разбери по записям стратегии):\n${notes.map(p => `- ${p}`).join('\n')}` : ''
  // update: рецензия - только по страницам, которые изменили стратеги типов (changed_pages), и по проблемам и замечаниям
  // сборки; пустой дифф - изменений нет; changed_pages неизвестен (skipTypes, ответ без поля) - в параметры не идет
  const changed = diff ? (!anyDiff ? [] : (skipTypes ? null : changedOf(perType))) : null
  if (diff && changed && !changed.length && !probs.length && !notes.length) {
    log('update: страниц с изменениями нет, проблем и замечаний сборки нет - рецензия не нужна')
    return { enrich, global, perType, briefs: first, review: null, reviewSkipped: true, final: first }
  }
  const updReview = diff ? `; update; facts_diff=${JSON.stringify(diff)}${changed ? `; changed_pages=${JSON.stringify(changed)}` : ''}` : ''
  const review = await agent(`${pre('prompts/04-strategist-global.md')}\nПараметры: mode=review${updReview}.${probsText}${notesText}\n${tail}`, { label: 'strategy-review', phase: 'Briefs', effort: 'high', model: modelFor('strategy-review'), schema: ANY })
  if (!review) log('рецензия стратегии не ответила - брифы пересобираются по стратегии как есть')
  const final = await buildBriefs('merge+build-briefs:review')
  return { enrich, global, perType, briefs: first, review, final }
}
// skipLayouts: раскладки уже есть (повтор фазы 4 после ответов заказчика, типы страниц не менялись) - не перегенерировать
const layoutChain = async () => A.skipLayouts ? 'skipped' : pipeline(groups,
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
const view = r => r ? { ok: r.ok, exit_code: r.exit_code, problems: r.problems || [], review_notes: r.review_notes || [], warnings: r.warnings || '', merge: r.merge || '' } : null
// автостоп C8: проблемы последней сборки брифов (после рецензии); сборка не ответила или цепочка упала - тоже проблема.
// Замечания « ~ » (review_notes) в автостоп не идут.
const briefs_problems = s.final ? (s.final.problems || []) : ['сборка брифов не ответила']
return {
  global: s.global && s.global.summary, perType: (s.perType || []).filter(Boolean).map(x => x.summary),
  briefs: view(s.briefs), review: s.review ? s.review.summary : (A.skipReview || s.reviewSkipped ? 'skipped' : null), briefs_final: view(s.final),
  briefs_problems, layouts: layouts === 'skipped' ? 'skipped' : (layouts || []).filter(Boolean).flat(),
  ...(diff ? { update: { facts_diff: diff }, enrich: s.enrich || null } : {}),
}
