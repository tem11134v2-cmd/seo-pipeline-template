export const meta = {
  name: 'wf-02-competitors',
  description: 'Phase 2: verify competitors, inventory pages per domain, extract blocks in batches per domain, aggregate per page type (small types in batches), analyze catalogs',
  phases: [{ title: 'Verify' }, { title: 'Inventory' }, { title: 'Extract' }, { title: 'Aggregate' }],
}
// args: { root, types:[...], type_pages?:{type:N}, catalog?, model?, model_light?, models?: {роль: модель},
//   extract_batch?: 4 - снимков одного домена на вызов экстрактора,
//   small_type_max?: 2, small_batch?: 4, solo_types?: ["home"] - типы с <= small_type_max страниц в карте (кроме solo_types)
//     агрегируются пакетами по small_batch типов, файл по-прежнему один на тип,
//   skipInventory?: true - без верификатора и классификаторов: снимки из args.snapshots или из work/competitors/competitors.json,
//   snapshots?: [{domain,type,url,raw}], extract_types?: [...], extract_domains?: [...] - разбирать только снимки этих типов и доменов,
//   extract_out?: "work/competitors", aggregate_out?: "work/page-types", skipAggregate?: bool,
//   info_other?: ["<название страницы>"] - страницы info_other карты (доставка, оплата, гарантия): классификатор ищет у
//     конкурентов страницы того же назначения; без них info_other собирается по соседним инфо-типам }
// type_pages, info_other и snapshots печатает `node scripts/prep-args.mjs [--types a,b] [--snapshots]`; без них их получит легкий агент.
// Инвентаризация - только если кроме главной есть что искать (лендинг и карта из одной главной - без нее: главные снял
// верификатор). Классификаторы параллельно снимают страницы скриптом, браузерный добор - отдельным проходом по одному
// конкуренту за раз, аналитик каталогов (тоже браузер) - после него.
// Верификатор никого не оставил: деградация «без конкурентов» (degraded: no_competitors) - только если он ее отметил и
// `prep-args.mjs --check-degraded` подтвердил, что все кандидаты ответили, но недоступны; тогда без инвентаризации и
// разбора, агрегатор собирает все типы по анализу. Иначе (сбой среды) - ошибка, --resume повторит разбор.
const A = args || {}
const types = A.types || []
if (!types.length) throw new Error('args.types обязателен: список типов страниц из work/sitemap.json')
const ROOT = A.root || ''
if (!ROOT) throw new Error('args.root обязателен: абсолютный путь к папке проекта')
// Модели по ролям (docs/RUNBOOK.md, «Модели по ролям»): light -> args.model_light, strong -> args.model;
// args.models {роль: модель} переопределяет умолчание роли. Те же args - те же модели (resume берет кэш).
const MODEL = A.model || undefined
const MODEL_LIGHT = A.model_light || MODEL
const ROLE_MODELS = A.models || {}
if (typeof ROLE_MODELS !== 'object' || Array.isArray(ROLE_MODELS)) throw new Error('args.models: объект {роль: модель}')
const ROLES = {
  'prep-args': 'light', verify: 'light', inventory: 'light', 'catalog-analyst': 'light', aggregate: 'strong',
  extract: 'strong', // 02-block-extractor: пока strong до решения по эксперименту; умолчание меняется этой строкой
}
const modelFor = role => {
  if (!ROLES[role]) throw new Error(`роль ${role} не описана в ROLES`)
  return ROLE_MODELS[role] || (ROLES[role] === 'light' ? MODEL_LIGHT : MODEL)
}
const EXTRACT_BATCH = Math.max(1, Number(A.extract_batch) || 4)
const SMALL_MAX = A.small_type_max == null ? 2 : Number(A.small_type_max)
const SMALL_BATCH = Math.max(1, Number(A.small_batch) || 4)
const SOLO = A.solo_types || ['home']
const EXTRACT_OUT = A.extract_out || 'work/competitors'
const AGG_OUT = A.aggregate_out || 'work/page-types'
const pre = p => `Папка проекта: ${ROOT}. Все относительные пути в промтах считаются от нее; команды запускай из нее (cd "${ROOT}" && ...). Сначала прочитай ${ROOT}/CLAUDE.md, затем ${ROOT}/${p}, и выполни роль строго по нему.`
const VERIFY = { type: 'object', properties: { total_candidates: { type: 'number' }, kept: { type: 'array', items: { type: 'string' } }, excluded: { type: 'array', items: { type: 'object', properties: { domain: { type: 'string' }, reason: { type: 'string' } }, required: ['domain'] } }, method: { type: 'string' }, degraded: { type: 'string' } }, required: ['kept', 'excluded', 'method'] }
const PAGE_REF = { type: 'object', properties: { type: { type: 'string' }, url: { type: 'string' }, raw: { type: 'string' } }, required: ['type', 'url', 'raw'] }
const INVENTORY = { type: 'object', properties: { domain: { type: 'string' }, pages: { type: 'array', items: { type: 'object', properties: { type: { type: 'string' }, url: { type: 'string' }, status: { type: 'string' }, raw: { type: 'string' } }, required: ['type', 'url', 'status', 'raw'] } }, browser: { type: 'array', items: PAGE_REF }, types_missing: { type: 'array', items: { type: 'string' } } }, required: ['domain', 'pages', 'types_missing'] }
const SNAP = { type: 'object', properties: { domain: { type: 'string' }, type: { type: 'string' }, url: { type: 'string' }, raw: { type: 'string' }, status: { type: 'string' } }, required: ['domain', 'type', 'url', 'raw'] }
const PREP = { type: 'object', properties: { ok: { type: 'boolean' }, type_pages: { type: 'array', items: { type: 'object', properties: { type: { type: 'string' }, pages: { type: 'number' } }, required: ['type', 'pages'] } }, info_other: { type: 'array', items: { type: 'string' } }, snapshots: { type: 'array', items: SNAP }, error: { type: 'string' } }, required: ['ok', 'type_pages'] }
const DEGRADE = { type: 'object', properties: { ok: { type: 'boolean' }, degraded: { type: 'string' }, reason: { type: 'string' } }, required: ['ok'] }
const EXTRACT = { type: 'object', properties: { results: { type: 'array', items: { type: 'object', properties: { raw: { type: 'string' }, file: { type: 'string' }, blocks: { type: 'number' }, partial: { type: 'boolean' }, error: { type: 'string' } }, required: ['file', 'blocks'] } } }, required: ['results'] }
const AGG = { type: 'object', properties: { results: { type: 'array', items: { type: 'object', properties: { type: { type: 'string' }, market_blocks: { type: 'number' }, differentiation_blocks: { type: 'number' }, order: { type: 'array', items: { type: 'string' } }, sources: { type: 'number' }, notes: { type: 'string' } }, required: ['type', 'market_blocks', 'differentiation_blocks', 'order'] } } }, required: ['results'] }
const CAT = { type: 'object', properties: { domains_done: { type: 'array', items: { type: 'string' } }, domains_failed: { type: 'array', items: { type: 'object', properties: { domain: { type: 'string' }, reason: { type: 'string' } }, required: ['domain'] } }, file: { type: 'string' } }, required: ['domains_done', 'domains_failed'] }

// мелкие типы (<= SMALL_MAX страниц в карте, кроме SOLO) - пакетами по SMALL_BATCH; без type_pages все типы по одному
const typeGroups = (list, tp) => {
  const small = tp ? list.filter(t => !SOLO.includes(t) && (tp[t] || 0) <= SMALL_MAX) : []
  const groups = list.filter(t => !small.includes(t)).map(t => [t])
  for (let i = 0; i < small.length; i += SMALL_BATCH) groups.push(small.slice(i, i + SMALL_BATCH))
  return groups
}
// снимки одного домена - пакетами не больше EXTRACT_BATCH, пакеты домена выровнены по размеру
const extractBatches = list => {
  const byDomain = {}
  for (const p of list) (byDomain[p.domain] ??= []).push(p)
  const out = []
  for (const [domain, items] of Object.entries(byDomain)) {
    const n = Math.ceil(items.length / EXTRACT_BATCH)
    for (let k = 0; k < n; k++) out.push({ domain, items: items.slice(Math.round(k * items.length / n), Math.round((k + 1) * items.length / n)), part: `${k + 1}/${n}` })
  }
  return out
}

// параметры из карты и снимков: только если их не передали в args
let typePages = A.type_pages || null
let snapshots = A.snapshots || null
let infoNames = Array.isArray(A.info_other) ? A.info_other : null
const needPrep = (!typePages && !A.skipAggregate) || (A.skipInventory && !snapshots)
if (needPrep) {
  const wantSnaps = A.skipInventory && !snapshots
  const flags = [`--types ${types.join(',')}`, wantSnaps ? '--snapshots' : '', wantSnaps && A.extract_types ? `--snapshot-types ${A.extract_types.join(',')}` : '', wantSnaps && A.extract_domains ? `--domains ${A.extract_domains.join(',')}` : ''].filter(Boolean).join(' ')
  const prep = await agent(`Запусти команду из папки проекта ${ROOT}:\ncd "${ROOT}" && node scripts/prep-args.mjs ${flags}\nНичего не исправляй. stdout команды - JSON: перенеси type_pages как список {type, pages}, info_other и snapshots (если есть) без изменений. ok - код выхода 0; при ошибке - текст в error.`, { label: 'prep-args', phase: A.skipInventory ? 'Extract' : 'Verify', effort: 'low', model: modelFor('prep-args'), schema: PREP })
  if (prep && prep.ok) {
    if (!typePages) typePages = Object.fromEntries(prep.type_pages.map(x => [x.type, x.pages]))
    if (!infoNames && Array.isArray(prep.info_other)) infoNames = prep.info_other
    if (A.skipInventory && !snapshots) snapshots = prep.snapshots || []
  } else log('prep-args не отработал: ' + ((prep && prep.error) || 'нет ответа') + ' - мелкие типы пойдут по одному')
}
const INFO_NAMES = (infoNames || []).map(s => String(s).trim()).filter(Boolean).slice(0, 6)

let verify = null
let degraded = null
let inventories = []
let browserPass = 0
let pages = []
let catalogP = null
if (!A.skipInventory) {
  phase('Verify')
  verify = await agent(`${pre('prompts/02-competitor-verifier.md')}`, { label: 'verify', phase: 'Verify', effort: 'medium', model: modelFor('verify'), schema: VERIFY })
  if (!verify) throw new Error('нет доступных конкурентов: верификатор не вернул ответ')
  if (!verify.kept.length) {
    // деградация - только когда все кандидаты ответили, но недоступны; проверяет скрипт, а не самоотчет верификатора
    let why = 'верификатор не отметил degraded: no_competitors (сбой среды или пустой список)'
    if (verify.degraded === 'no_competitors') {
      const chk = await agent(`Запусти команду из папки проекта ${ROOT}:\ncd "${ROOT}" && node scripts/prep-args.mjs --check-degraded\nНичего не исправляй. stdout команды - JSON {degraded, why}: перенеси degraded (строка или пусто) и why в reason. ok - код выхода 0; при ошибке - текст в reason.`, { label: 'prep-args', phase: 'Verify', effort: 'low', model: modelFor('prep-args'), schema: DEGRADE })
      why = !chk || !chk.ok ? `проверка деградации не отработала${chk && chk.reason ? `: ${chk.reason}` : ''}` : chk.degraded === 'no_competitors' ? '' : (chk.reason || 'проверка не подтвердила деградацию')
    }
    if (why) throw new Error(`нет доступных конкурентов: ${why}`)
    degraded = 'no_competitors'
    log('без конкурентов: все кандидаты ответили, но недоступны - типы собираются по анализу (degraded: no_competitors), в отчете вопрос о сайтах-ориентирах')
  } else {
    log(`конкурентов в работе: ${verify.kept.length} (${verify.kept.join(', ')})`)
    // главную снял верификатор; info_other ищется только по названиям страниц карты
    const invTypes = types.filter(t => t !== 'home' && (t !== 'info_other' || INFO_NAMES.length))
    if (!invTypes.length) log(`инвентаризация не нужна: кроме главной искать нечего (типы: ${types.join(', ')}) - разбираем главные конкурентов`)
    else {
      phase('Inventory')
      const infoParam = invTypes.includes('info_other') ? `; info_other=${JSON.stringify(INFO_NAMES)}` : ''
      inventories = (await parallel(verify.kept.map(d => () => agent(`${pre('prompts/02-page-classifier.md')}\nПараметры: domain=${d}; types=${JSON.stringify(invTypes)}${infoParam}; mode=static.`, { label: `inventory:${d}`, phase: 'Inventory', effort: 'medium', model: modelFor('inventory'), schema: INVENTORY })))).filter(Boolean)
      // браузерный добор - по одному конкуренту за раз: агенты с браузером не идут параллельно
      for (const inv of inventories) {
        const items = (inv.browser || []).filter(x => x && x.url && x.raw).map(x => ({ type: x.type, url: x.url, raw: x.raw }))
        if (!items.length) continue
        browserPass++
        const b = await agent(`${pre('prompts/02-page-classifier.md')}\nПараметры: domain=${inv.domain}; mode=browser; items=${JSON.stringify(items)}.`, { label: `inventory:browser:${inv.domain}`, phase: 'Inventory', effort: 'medium', model: modelFor('inventory'), schema: INVENTORY })
        if (!b) { log(`браузерный добор ${inv.domain}: нет ответа - не сняты: ${items.map(x => x.url).join(', ')}`); continue }
        const got = (b.pages || []).filter(p => ['ok', 'browser'].includes(p.status))
        inv.pages = [...(inv.pages || []).filter(p => !got.some(g => g.raw === p.raw)), ...got]
        inv.types_missing = [...new Set([...(inv.types_missing || []), ...(b.types_missing || [])])].filter(t => !inv.pages.some(p => p.type === t && ['ok', 'browser'].includes(p.status)))
      }
      if (browserPass) log(`браузерный добор: конкурентов ${browserPass}, по одному`)
    }
    pages = inventories.flatMap(inv => (inv.pages || []).filter(p => ['ok', 'browser'].includes(p.status)).map(p => ({ domain: inv.domain, type: p.type, url: p.url, raw: p.raw })))
    // главные страницы тоже разбираем как тип home
    for (const d of verify.kept) if (types.includes('home') && !pages.find(p => p.domain === d && p.type === 'home')) pages.push({ domain: d, type: 'home', url: `https://${d}/`, raw: `work/competitors/raw/${d}/home.json` })
    // каталоги не зависят от разбора блоков: запускаем после браузерного добора (аналитик тоже ходит в браузер), ждем в
    // конце; сбой не валит фазу, причина - в результате
    if (A.catalog) catalogP = agent(`${pre('prompts/02-catalog-analyst.md')}\nПараметры: domains=${JSON.stringify(verify.kept.slice(0, 4))}.`, { label: 'catalog-analyst', phase: 'Aggregate', effort: 'medium', model: modelFor('catalog-analyst'), schema: CAT })
      .then(r => r || { domains_done: [], domains_failed: [{ domain: '*', reason: 'аналитик каталогов не вернул ответ' }] })
      .catch(e => ({ domains_done: [], domains_failed: [{ domain: '*', reason: `аналитик каталогов упал: ${String((e && e.message) || e).slice(0, 200)}` }] }))
  }
  if (degraded && A.catalog) log('catalog пропущен: без конкурентов разбирать нечего')
} else {
  pages = (snapshots || []).map(p => ({ domain: p.domain, type: p.type, url: p.url, raw: p.raw }))
  log(`skipInventory: снимков из ${A.snapshots ? 'args.snapshots' : 'competitors.json'}: ${pages.length}`)
  if (A.catalog) log('catalog пропущен: при skipInventory нет списка доменов верификатора')
}
const seenTypes = [...new Set(pages.map(p => p.type))]
if (A.extract_types) pages = pages.filter(p => A.extract_types.includes(p.type))
if (A.extract_domains) pages = pages.filter(p => A.extract_domains.includes(p.domain))

phase('Extract')
const batches = extractBatches(pages)
log(`снимков к разбору: ${pages.length}, вызовов экстрактора: ${batches.length} (до ${EXTRACT_BATCH} снимков домена на вызов), разборы в ${EXTRACT_OUT}`)
// замер для агрегаторов делает первый пакет (снимки к этому моменту сняты все, разбору CSV не нужен)
const extracts = (await parallel(batches.map((b, i) => () => agent(`${pre('prompts/02-block-extractor.md')}\nПараметры: domain=${b.domain}; out=${EXTRACT_OUT}; measure=${i === 0 && !A.skipInventory}; items=${JSON.stringify(b.items.map(p => ({ raw: p.raw, type: p.type, url: p.url })))}.`, { label: `extract:${b.domain}:${b.part}`, phase: 'Extract', effort: 'medium', model: modelFor('extract'), schema: EXTRACT })))).filter(Boolean)
const extracted = extracts.flatMap(e => e.results || [])
const failed = extracted.filter(e => e.error || !e.file)
log(`разобрано снимков: ${extracted.length - failed.length} из ${pages.length}, блоков всего: ${extracted.reduce((s, e) => s + (e.blocks || 0), 0)}${failed.length ? `; не разобраны: ${failed.map(e => e.raw || e.file).join(', ')}` : ''}`)

let agg = []
if (!A.skipAggregate) {
  phase('Aggregate')
  const typesWithData = degraded ? [] : types.filter(t => seenTypes.includes(t) || t === 'home')
  const missingTypes = types.filter(t => !typesWithData.includes(t))
  if (missingTypes.length && !A.skipInventory && !degraded) log(`нет снимков конкурентов для типов: ${missingTypes.join(', ')} - агрегатор соберет их по ближайшему типу и анализу`)
  const groups = typeGroups(types, typePages)
  const packs = groups.filter(g => g.length > 1)
  if (packs.length) log(`мелкие типы пакетами: ${packs.map(g => g.join('+')).join(' | ')}`)
  const noData = g => A.skipInventory ? [] : g.filter(t => missingTypes.includes(t))
  const degParam = degraded ? `; degraded=${degraded}` : ''
  agg = (await parallel(groups.map(g => () => agent(`${pre('prompts/02-type-aggregator.md')}\nПараметры: types=${JSON.stringify(g)}; no_data=${JSON.stringify(noData(g))}${degParam}; blocks_dir=${EXTRACT_OUT}; out=${AGG_OUT}.`, { label: `aggregate:${g.join('+')}`, phase: 'Aggregate', effort: 'high', model: modelFor('aggregate'), schema: AGG })))).filter(Boolean).flatMap(r => r.results || [])
  const lost = types.filter(t => !agg.find(r => r.type === t))
  if (lost.length) log(`нет результата агрегатора для типов: ${lost.join(', ')}`)
}
const catalog = catalogP ? await catalogP : null
const catFail = catalog && (catalog.domains_failed || []).find(d => d.domain === '*')
if (catFail) log(`каталоги не разобраны: ${catFail.reason}`)
return { verify, degraded, inventories: inventories.map(i => ({ domain: i.domain, pages: (i.pages || []).length, missing: i.types_missing })), browser_pass: browserPass, extract_calls: batches.length, extracted: extracted.length - failed.length, extract_failed: failed.map(e => e.raw || e.file), aggregated: agg, catalog }
