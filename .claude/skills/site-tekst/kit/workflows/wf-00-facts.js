export const meta = {
  name: 'wf-00-facts',
  description: 'Phase 0: facts, audience and sitemap. source=doc: dump Google Doc analysis, extract, blind check, site snapshot, structure, enrich. source=project: import site-analiz project.json by script (+ anti-promise regexes), snapshot only without requisites, enrich',
  phases: [{ title: 'Dump' }, { title: 'Extract' }, { title: 'Check' }, { title: 'Import' }, { title: 'Structure' }, { title: 'Enrich' }],
}
// args: { source?: "doc"|"project" (по умолчанию doc), structureMode: "import"|"fallback", skipDump?: boolean, skipSnapshot?: boolean,
//         project?, factsSrc?, queue?, structure?: пути для source=project (по умолчанию config/project.json -> sources), allowUngated?: boolean }
const mode = (args && args.structureMode) || 'import'
const source = (args && args.source) || 'doc'
const ROOT = (args && args.root) || ''
if (!ROOT) throw new Error('args.root обязателен: абсолютный путь к папке проекта')
if (!['doc', 'project'].includes(source)) throw new Error(`args.source: doc или project, пришло ${source}`)
const MODEL = (args && args.model) || undefined
const MODEL_LIGHT = (args && args.model_light) || MODEL
const pre = p => `Папка проекта: ${ROOT}. Все относительные пути в промтах считаются от нее; команды запускай из нее (cd "${ROOT}" && ...). Сначала прочитай ${ROOT}/CLAUDE.md, затем ${ROOT}/${p}, и выполни роль строго по нему.`
const ANY = { type: 'object', properties: { ok: { type: 'boolean' }, summary: { type: 'string' }, data: { type: 'object' } }, required: ['ok', 'summary'] }
const FINDINGS = { type: 'object', properties: { findings: { type: 'array', items: { type: 'object', properties: { severity: { type: 'string', enum: ['blocker', 'major', 'minor'] }, category: { type: 'string' }, rule: { type: 'string' }, problem: { type: 'string' }, quote: { type: 'string' }, proposal: { type: 'string' } }, required: ['severity', 'rule', 'problem'] } }, verdict: { type: 'string' }, summary: { type: 'string' } }, required: ['findings', 'verdict', 'summary'] }
const RUN = { type: 'object', properties: { ok: { type: 'boolean' }, exit_code: { type: 'number' }, stdout_tail: { type: 'string' } }, required: ['ok', 'exit_code', 'stdout_tail'] }
const IMPORT = { type: 'object', properties: { ok: { type: 'boolean' }, summary: { type: 'string' }, facts: { type: 'number' }, publish_yes: { type: 'number' }, quotes_fallback: { type: 'number' }, anti_promises: { type: 'number' }, anti_pending: { type: 'number' }, anti_failed: { type: 'array', items: { type: 'string' } }, conflicts: { type: 'array', items: { type: 'string' } }, segments: { type: 'number' }, objections: { type: 'number' }, company_status: { type: 'string' }, site_url: { type: 'string' }, structure_pages: { type: 'number' }, warnings: { type: 'array', items: { type: 'string' } } }, required: ['ok', 'summary', 'company_status', 'anti_pending', 'structure_pages'] }
const run = (cmd, label, phase) => agent(`Запусти команду из папки проекта ${ROOT}:\ncd "${ROOT}" && ${cmd}\nНичего не исправляй и не интерпретируй. Верни ok (код выхода 0), exit_code и последние 40 строк вывода.`, { label, phase, effort: 'low', model: MODEL_LIGHT, schema: RUN })
const tail = 'Верни ok=true и в summary - JSON результата из раздела «Формат результата» твоего промта одной строкой; в data - тот же объект.'
const serious = r => (r && r.findings || []).filter(f => f.severity !== 'minor')
const snapshotAgent = () => agent(`${pre('prompts/00-site-snapshot.md')}\n${tail}`, { label: 'site-snapshot', phase: 'Structure', effort: 'medium', model: MODEL, schema: ANY })
const fallbackAgent = () => agent(`${pre('prompts/01-structure-fallback.md')}\n${tail}`, { label: 'structure-fallback', phase: 'Structure', effort: 'high', model: MODEL, schema: ANY })
const enrichAgent = () => agent(`${pre('prompts/01-sitemap-enricher.md')}\n${tail}`, { label: 'sitemap-enrich', phase: 'Enrich', effort: 'high', model: MODEL, schema: ANY })

// ---------- режим project: анализ из контракта site-analiz, 2-3 вызова вместо 7-9 ----------
if (source === 'project') {
  phase('Import')
  const q = s => `"${String(s).replace(/"/g, '')}"`
  const flags = [
    args.project && `--project ${q(args.project)}`,
    args.factsSrc && `--facts-src ${q(args.factsSrc)}`,
    args.queue && `--queue ${q(args.queue)}`,
    args.structure && `--structure ${q(args.structure)}`,
    args.allowUngated && '--allow-ungated',
  ].filter(Boolean).join(' ')
  const imp = await agent(`${pre('prompts/00-project-import.md')}\nКоманда импорта: node scripts/import-project.mjs${flags ? ' ' + flags : ''}\nРежим структуры: ${mode}.\nВерни JSON по разделу «Формат результата» промта; в summary - одна строка итога.`, { label: 'project-import', phase: 'Import', effort: 'medium', model: MODEL_LIGHT, schema: IMPORT })
  if (!imp || !imp.ok) throw new Error('импорт project.json не удался: ' + (imp && imp.summary))
  log(`импорт: фактов ${imp.facts}, publish yes ${imp.publish_yes}, антиобещаний ${imp.anti_promises} (без регулярки ${imp.anti_pending}), реквизиты ${imp.company_status}, страниц ${imp.structure_pages}`)
  if (imp.anti_pending) log(`ВНИМАНИЕ: ${imp.anti_pending} антиобещаний без регулярки - линтер их не ловит (строки в facts.gaps)`)
  if (mode === 'import' && !imp.structure_pages) throw new Error('структура не импортирована: нет inputs/structure_data.json (args.structure или sources.structure_input), либо запусти со structureMode=fallback')

  phase('Structure')
  const needSnapshot = !(args && args.skipSnapshot) && imp.company_status === 'missing'
  const [snapshot, structure] = await parallel([
    () => needSnapshot ? snapshotAgent() : Promise.resolve({ ok: true, summary: `skipped: реквизиты ${imp.company_status}` }),
    () => mode === 'import' ? Promise.resolve({ ok: true, summary: `импортирована вместе с анализом: ${imp.structure_pages} страниц` }) : fallbackAgent(),
  ])

  phase('Enrich')
  const enrich = await enrichAgent()
  return { source, imp, snapshot, structure, enrich }
}

// ---------- режим doc (по умолчанию): анализ из Google Doc ----------
phase('Dump')
const dump = (args && args.skipDump) ? { ok: true, summary: 'skipped' } : await agent(`${pre('prompts/00-analysis-dumper.md')}\n${tail}`, { label: 'dump', phase: 'Dump', effort: 'medium', model: MODEL, schema: ANY })
if (!dump || !dump.ok) throw new Error('дамп анализа не удался: ' + (dump && dump.summary))

phase('Extract')
const extract = await agent(`${pre('prompts/00-facts-extractor.md')}\n${tail}`, { label: 'facts-extract', phase: 'Extract', effort: 'high', model: MODEL, schema: ANY })

phase('Check')
let check = await agent(`${pre('prompts/00-facts-checker.md')}\n${tail}`, { label: 'facts-check-1', phase: 'Check', effort: 'high', model: MODEL, schema: FINDINGS })
log(`проверка фактов: находок ${check ? check.findings.length : '-'}, серьезных ${serious(check).length}`)
let extractFix = null
if (serious(check).length) {
  extractFix = await agent(`${pre('prompts/00-facts-extractor.md')}\nЭто второй проход: исправь work/facts.json и work/audience.json точечно по находкам ниже (удали выдуманное, добавь пропущенное, почисти wording, почини цитаты). Остальное не трогай.\nНаходки:\n${JSON.stringify(serious(check), null, 1)}\n${tail}`, { label: 'facts-fix', phase: 'Check', effort: 'high', model: MODEL, schema: ANY })
  check = await agent(`${pre('prompts/00-facts-checker.md')}\nКруг 2: проверь только, закрыты ли находки ниже, и нет ли новых выдумок.\n${JSON.stringify(serious(check), null, 1)}\n${tail}`, { label: 'facts-check-2', phase: 'Check', effort: 'high', model: MODEL, schema: FINDINGS })
}

phase('Structure')
const [snapshot, structure] = await parallel([
  () => (args && args.skipSnapshot) ? Promise.resolve({ ok: true, summary: 'skipped' }) : snapshotAgent(),
  () => mode === 'import'
    ? run('node scripts/import-structure.mjs', 'import-structure', 'Structure')
    : fallbackAgent(),
])

phase('Enrich')
const enrich = await enrichAgent()
return { source, dump, extract, check, extractFix, snapshot, structure, enrich }
