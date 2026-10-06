export const meta = {
  name: 'wf-02-competitors',
  description: 'Phase 2: select leaders (scout + rank), verify competitors, inventory pages per domain, capture pages and observe commercial factors (KF matrix, shell) in parallel with block extraction, aggregate per page type with KF rows (small types in batches), analyze catalogs',
  phases: [{ title: 'Select' }, { title: 'Verify' }, { title: 'Inventory' }, { title: 'Capture' }, { title: 'Look' }, { title: 'Extract' }, { title: 'Matrix' }, { title: 'Aggregate' }],
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
// Анализ КФ и КНДР (программа 05.10, раздел 2). Еще args: skipKf?: true - без отбора, снятия и матрицы (агрегатор без
//   строк КФ, status.json skip; прежние matrix.json и shell.json снимаются - этап считается непроведенным, наблюдения
//   kf/*.json остаются, следующий прогон без skipKf пересоберет матрицу без нового наблюдения); reselect?: true - скаут и при свежем pool.json; recapture?: true - снятие без --resume;
//   capture_seconds?: 480 - дедлайн одного вызова capture-pages.mjs.
// Select (обычный режим): run-агент rank-competitors.mjs --check (fresh - скаут не зовется, иначе 02-competitor-scout сам
//   собирает pool.json; fresh с exhausted или exhausted скаута - узкая ниша, верификатор получает note «кандидатов
//   меньше target: источники исчерпаны» строкой в method), run-агент rank-competitors.mjs --whois (бесплатный whois
//   дозаполняет возраст) и rank-competitors.mjs -> ranking.json; верификатор берет кандидатов по ranking.order, затем
//   run-агент rank-competitors.mjs --verify-order (пропуск выше последнего годного - повтор верификатора с recheck, метка
//   verify:2) и run-агент prep-args.mjs --prune-stale (разборы блоков не годных доменов - в work/competitors/_stale/).
// Capture/Look (после инвентаризации, параллельно разбору блоков): run-агенты capture-pages.mjs --domain <d> --resume по
//   доменам и own (partial - повтор с --resume не больше 2 раз), kf-matrix.mjs --stale-observers (план и домены, чьи
//   kf-файлы старше снимков), 02-kf-observer по домену (больше 12 кадров - части shell и types), kf-matrix.mjs
//   --candidates, 02-kf-normalizer (есть x-элементы без записи в aliases.json), снова --candidates, 02-kf-observer
//   mode=recheck по доменам с кандидатами. Matrix: kf-matrix.mjs --shell -> work/kf/matrix.json, work/shell.json,
//   work/kf/status.json. Агрегатор получает kf=on (строки своего типа - kf-coverage.mjs <type> --rows) или kf=off.
// Режимы: skipInventory - Select нет, снятие по доменам снимков (--resume); extract_out/aggregate_out/extract_types/
//   extract_domains (частичный разбор) - ни отбора, ни снятия, work/kf/* не трогается, агрегатор читает готовую матрицу;
//   skipKf - status skip без матрицы; degraded: no_competitors - status no_competitors без матрицы. Сбой или null run-агентов КФ,
//   наблюдателя, нормализатора, перепроверки, скаута - log и строка limits, без throw.
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
  scout: 'light', rank: 'light', capture: 'light', 'kf-observe': 'light', 'kf-normalize': 'light', 'kf-recheck': 'light', matrix: 'light',
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
const RUN = { type: 'object', properties: { ok: { type: 'boolean' }, exit_code: { type: 'number' }, stdout_tail: { type: 'string' } }, required: ['ok', 'exit_code', 'stdout_tail'] }
// ответ 02-competitor-scout: итог последнего rank-competitors.mjs --check и счетчики
const SCOUT = { type: 'object', properties: { status: { type: 'string' }, candidates: { type: 'number' }, eligible: { type: 'number' }, sources_done: { type: 'array', items: { type: 'string' } }, exhausted: { type: 'boolean' }, errors: { type: 'array', items: { type: 'string' } }, calls: { type: 'number' } }, required: ['candidates'] }
const OBSERVE = { type: 'object', properties: { domain: { type: 'string' }, file: { type: 'string' }, pages: { type: 'number' }, elements: { type: 'number' }, x: { type: 'number' }, ambiguous: { type: 'number' }, limits: { type: 'array', items: { type: 'string' } } }, required: ['domain', 'file', 'elements'] }
const NORMALIZE = { type: 'object', properties: { file: { type: 'string' }, x: { type: 'number' }, merged: { type: 'number' } }, required: ['file', 'x', 'merged'] }

// анализ КФ: режимы (раздел 2 программы 05.10)
const PARTIAL = ['extract_out', 'aggregate_out', 'extract_types', 'extract_domains'].some(k => A[k] != null)
const KF_RUN = !A.skipKf && !PARTIAL // снятие, наблюдение и матрица (кроме деградации без конкурентов)
const SELECT = KF_RUN && !A.skipInventory
const CAPTURE_SECONDS = Math.max(60, Number(A.capture_seconds) || 480)
const limits = []
const limit = m => { limits.push(m); log(m) }
const safe = p => Promise.resolve(p).catch(e => { limit(`сбой агента: ${String((e && e.message) || e).slice(0, 200)}`); return null })
// run-агент: команда из папки проекта, ok - код 0, хвост вывода дословно
const run = (cmd, label, phaseName, role) => safe(agent(`Запусти команду из папки проекта ${ROOT} (в Bash, timeout 600000):\ncd "${ROOT}" && ${cmd}\nНичего не исправляй и не интерпретируй. Верни ok (код выхода 0), exit_code и последние 40 строк вывода дословно.`, { label, phase: phaseName, effort: 'low', model: modelFor(role), schema: RUN }))
// машинная строка скрипта в хвосте вывода: KF_CAPTURE {...}, KF_STALE {...}, KF_CANDIDATES {...}, KF_MATRIX {...}
const machine = (r, tag) => {
  const m = r && typeof r.stdout_tail === 'string' ? r.stdout_tail.match(new RegExp(`${tag} (\\{[^\\n]*\\})`)) : null
  if (!m) return null
  try { return JSON.parse(m[1]) } catch { return null }
}
const tail = r => (r ? `код ${r.exit_code}: ${String(r.stdout_tail || '').slice(-200)}` : 'нет ответа')

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
let select = null
let selectNote = ''
const EXHAUSTED = 'кандидатов меньше target: источники исчерпаны'
if (SELECT) {
  // отбор лидеров: платный пул (выдача, Keys.so) не повторяется, пока rank-competitors.mjs --check говорит fresh
  phase('Select')
  let fresh = false, exhausted = false, why = 'args.reselect'
  if (!A.reselect) {
    const chk = await run('node scripts/rank-competitors.mjs --check', 'rank:check', 'Select', 'rank')
    const t = chk && chk.ok ? String(chk.stdout_tail || '') : ''
    fresh = /"status"\s*:\s*"fresh"|"fresh"\s*:\s*true|^fresh\b/m.test(t)
    // fresh с exhausted: годных меньше target, но все источники кандидатов пройдены (узкая ниша) - платный отбор не повторяется
    exhausted = fresh && /"exhausted"\s*:\s*true/.test(t)
    why = chk ? (t.trim().split('\n').pop() || `код ${chk.exit_code}`).slice(0, 200) : 'проверка не ответила'
  }
  let scout = null
  if (fresh) log(exhausted ? `отбор: ${EXHAUSTED} - скаут не зовется` : 'отбор: pool.json свежий - скаут не зовется')
  else {
    scout = await safe(agent(`${pre('prompts/02-competitor-scout.md')}\nПараметры: reason=${JSON.stringify(why)}.`, { label: 'scout', phase: 'Select', effort: 'medium', model: modelFor('scout'), schema: SCOUT }))
    if (!scout) limit('скаут не вернул ответ - ранжирование по прежнему pool.json (если он есть)')
    else if ((scout.errors || []).length) log(`скаут: ${scout.errors.slice(0, 5).join('; ')}`)
    if (scout && scout.exhausted === true) exhausted = true
  }
  // узкая ниша: строка в method верификатора (параметр note) и в итог фазы
  if (exhausted) selectNote = EXHAUSTED
  // бесплатный whois (порт 43) дозаполняет даты регистрации, если whois Арсенкина не ответил: без возраста отбор теряет
  // фактор молодости; сбой whois ранжированию не мешает
  const rk = await run('node scripts/rank-competitors.mjs --whois; node scripts/rank-competitors.mjs', 'rank', 'Select', 'rank')
  if (!rk || !rk.ok) limit(`ранжирование кандидатов не отработало (${tail(rk)}) - верификатор идет по ranking.json, если он есть, иначе по-старому`)
  select = { fresh, exhausted, scout: scout ? { status: scout.status || '', candidates: scout.candidates, eligible: scout.eligible, sources_done: scout.sources_done || [], errors: (scout.errors || []).length, calls: scout.calls } : null, rank_ok: !!(rk && rk.ok) }
}
if (!A.skipInventory) {
  phase('Verify')
  verify = await agent(`${pre('prompts/02-competitor-verifier.md')}${selectNote ? `\nПараметры: note=${JSON.stringify(selectNote)}.` : ''}`, { label: 'verify', phase: 'Verify', effort: 'medium', model: modelFor('verify'), schema: VERIFY })
  if (!verify) throw new Error('нет доступных конкурентов: верификатор не вернул ответ')
  // верификатор обязан идти по ranking.order: пропуск домена выше последнего годного (например, прежний список при новом
  // порядке) - повтор верификатора на пропущенных; проверяет скрипт, а не самоотчет агента
  if (verify.kept.length && select && select.rank_ok) {
    const ord = await run('node scripts/rank-competitors.mjs --verify-order', 'rank:order', 'Verify', 'rank')
    const gap = ord && ord.ok ? (() => { try { return JSON.parse(String(ord.stdout_tail).trim().split('\n').pop()).skipped || [] } catch { return [] } })() : []
    if (gap.length) {
      log(`верификатор пропустил по порядку: ${gap.join(', ')} - повторная проверка`)
      const v2 = await agent(`${pre('prompts/02-competitor-verifier.md')}\nПараметры: recheck=${JSON.stringify(gap)}${selectNote ? `; note=${JSON.stringify(selectNote)}` : ''}.`, { label: 'verify:2', phase: 'Verify', effort: 'medium', model: modelFor('verify'), schema: VERIFY })
      if (v2 && v2.kept.length) verify = v2
      else limit(`повторная проверка пропущенных (${gap.join(', ')}) не вернула ответ - остается первый список`)
    }
  }
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
    // разборы блоков доменов не из годных (остались от прежнего отбора) - в _stale/, иначе их подхватит агрегатор
    if (!A.extract_out) {
      const pr = await run('node scripts/prep-args.mjs --prune-stale', 'prep-args:prune', 'Verify', 'prep-args')
      if (pr && pr.ok && /"moved":\["/.test(pr.stdout_tail || '')) log(`устаревшие разборы убраны в work/competitors/_stale/: ${String(pr.stdout_tail).slice(0, 200)}`)
    }
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
// ---------- анализ КФ и КНДР: снятие, наблюдение, матрица (параллельно разбору блоков) ----------
const infoObs = INFO_NAMES.length ? `; info_other=${JSON.stringify(INFO_NAMES)}` : ''
async function captureDomain(d) {
  let last = null
  for (let i = 0; i < 3; i++) {
    const resume = i > 0 || !A.recapture ? ' --resume' : ''
    const r = await run(`node scripts/capture-pages.mjs --domain ${d}${resume} --max-seconds ${CAPTURE_SECONDS}`, `capture:${d}${i ? `:${i + 1}` : ''}`, 'Capture', 'capture')
    const j = machine(r, 'KF_CAPTURE')
    if (!j) { limit(`снятие ${d}: ${r && r.ok ? 'нет строки KF_CAPTURE' : tail(r)} - наблюдение по тому, что снято`); return last }
    last = j
    if (!j.partial) return j
  }
  limit(`снятие ${d}: не уложилось в 3 захода - остаток skipped (timeout)`)
  return last
}
async function observe(d, role, part) {
  const o = await safe(agent(`${pre('prompts/02-kf-observer.md')}\nПараметры: domain=${d}; role=${role}; mode=observe; part=${part}${infoObs}.`, { label: `kf-observe:${d}${part === 'all' ? '' : `:${part}`}`, phase: 'Look', effort: 'medium', model: modelFor('kf-observe'), schema: OBSERVE }))
  if (!o) limit(`наблюдатель ${d} (${part}): нет ответа - домен без этой части наблюдения`)
  return o
}
async function kfBranch(domains) {
  phase('Capture')
  const cap = await parallel([...domains, 'own'].map(d => () => captureDomain(d)))
  const noChrome = cap.filter(Boolean).some(j => j.chrome === false)
  if (noChrome) limit('нет Chrome и Edge: кадров нет, наблюдение по тексту снимков (status no_chrome)')
  phase('Look')
  const st = machine(await run('node scripts/kf-matrix.mjs --stale-observers', 'matrix:stale', 'Look', 'matrix'), 'KF_STALE')
  const stale = st && Array.isArray(st.domains) ? st.domains : [...domains.map(d => ({ domain: d, role: 'competitor', parts: ['all'] })), { domain: 'own', role: 'own', parts: ['all'] }]
  if (!st) limit('план наблюдения не получен (kf-matrix.mjs --stale-observers) - наблюдатель по всем доменам')
  else log(`наблюдение: ${stale.length ? stale.map(x => `${x.domain} (${(x.parts || ['all']).join('+')})`).join(', ') : 'все kf-файлы свежие'}`)
  // части одного домена - по очереди (вторая дописывает файл первой), домены - параллельно
  const obs = (await parallel(stale.map(x => async () => { const out = []; for (const part of (x.parts && x.parts.length ? x.parts : ['all'])) out.push(await observe(x.domain, x.role || 'competitor', part)); return out }))).flat().filter(Boolean)
  let cand = machine(await run('node scripts/kf-matrix.mjs --candidates', 'matrix:candidates', 'Look', 'matrix'), 'KF_CANDIDATES')
  let normalized = null
  if (cand && cand.x_unaliased > 0) {
    normalized = await safe(agent(`${pre('prompts/02-kf-normalizer.md')}`, { label: 'kf-normalize', phase: 'Look', effort: 'medium', model: modelFor('kf-normalize'), schema: NORMALIZE }))
    if (!normalized) limit('нормализатор x-элементов не ответил - синонимы сведены только скриптом')
    cand = machine(await run('node scripts/kf-matrix.mjs --candidates', 'matrix:candidates:2', 'Look', 'matrix'), 'KF_CANDIDATES') || cand
  }
  if (!cand) limit('кандидаты перепроверки не получены (kf-matrix.mjs --candidates) - x-элементы без перепроверки: «?»')
  const recheck = cand && Array.isArray(cand.recheck) ? cand.recheck : []
  const rc = await parallel(recheck.map(d => () => safe(agent(`${pre('prompts/02-kf-observer.md')}\nПараметры: domain=${d}; mode=recheck.`, { label: `kf-recheck:${d}`, phase: 'Look', effort: 'low', model: modelFor('kf-recheck'), schema: OBSERVE }))))
  rc.forEach((r, i) => { if (!r) limit(`перепроверка ${recheck[i]}: нет ответа - «?» по ее x-элементам`) })
  phase('Matrix')
  const mx = await run('node scripts/kf-matrix.mjs --shell', 'matrix', 'Matrix', 'matrix')
  const mj = machine(mx, 'KF_MATRIX')
  if (!mj) limit(`матрица КФ не построена (${tail(mx)}) - агрегатор без строк КФ`)
  else log(`матрица КФ: строк ${mj.rows} (обязательно ${mj.must}, рекомендовано ${mj.recommended}), оболочка ${mj.shell_items ?? '-'}, статус ${mj.status}`)
  return { captured: cap.filter(Boolean).map(j => ({ domain: j.domain, ok: j.ok, antibot: j.antibot, error: j.error, skipped: j.skipped, partial: j.partial })), observed: obs.length, x: cand ? cand.x : null, normalized: !!normalized, recheck: recheck.length, matrix: mj }
}
let kfP = null
if (PARTIAL) log('частичный разбор (extract_*/aggregate_out): снятие и матрица КФ не трогаются, агрегатор читает готовую матрицу')
else if (A.skipKf) await run('node scripts/kf-matrix.mjs --status skip', 'matrix:status', 'Matrix', 'matrix')
else if (degraded) await run('node scripts/kf-matrix.mjs --status no_competitors', 'matrix:status', 'Matrix', 'matrix')
else {
  const kfDomains = verify ? verify.kept : [...new Set(pages.map(p => p.domain))]
  if (kfDomains.length) kfP = kfBranch(kfDomains).catch(e => { limit(`этап КФ упал: ${String((e && e.message) || e).slice(0, 200)}`); return null })
  else limit('анализ КФ: доменов нет - этап пропущен')
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

// матрица КФ нужна агрегатору: ветка снятия и наблюдения шла параллельно разбору
const kf = kfP ? await kfP : null
const KF_ON = !A.skipKf && !degraded

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
  // kf=on: агрегатор берет строки КФ своего типа (kf-coverage.mjs <type> --rows; нет матрицы - []), kf=off - без них
  const kfParam = `; kf=${KF_ON ? 'on' : 'off'}`
  agg = (await parallel(groups.map(g => () => agent(`${pre('prompts/02-type-aggregator.md')}\nПараметры: types=${JSON.stringify(g)}; no_data=${JSON.stringify(noData(g))}${degParam}; blocks_dir=${EXTRACT_OUT}; out=${AGG_OUT}${kfParam}.`, { label: `aggregate:${g.join('+')}`, phase: 'Aggregate', effort: 'high', model: modelFor('aggregate'), schema: AGG })))).filter(Boolean).flatMap(r => r.results || [])
  const lost = types.filter(t => !agg.find(r => r.type === t))
  if (lost.length) log(`нет результата агрегатора для типов: ${lost.join(', ')}`)
}
const catalog = catalogP ? await catalogP : null
const catFail = catalog && (catalog.domains_failed || []).find(d => d.domain === '*')
if (catFail) log(`каталоги не разобраны: ${catFail.reason}`)
return { verify, degraded, inventories: inventories.map(i => ({ domain: i.domain, pages: (i.pages || []).length, missing: i.types_missing })), browser_pass: browserPass, extract_calls: batches.length, extracted: extracted.length - failed.length, extract_failed: failed.map(e => e.raw || e.file), aggregated: agg, catalog, select, kf, kf_status: PARTIAL ? 'kept' : A.skipKf ? 'skip' : degraded ? 'no_competitors' : (kf && kf.matrix && kf.matrix.status) || null, limits }
