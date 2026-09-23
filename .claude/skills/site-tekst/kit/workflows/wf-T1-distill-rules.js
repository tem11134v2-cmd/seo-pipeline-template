export const meta = {
  name: 'wf-T1-distill-rules',
  description: 'Distill the copywriting rules file into role instructions, blind-check, fix, normalize',
  phases: [{ title: 'Distill' }, { title: 'Check' }, { title: 'Fix' }],
}
// args: { root, rulesFile: "<path>", skipDistill?: boolean, model?, model_light?, models?: {роль: модель} }
const rulesFile = args && args.rulesFile
if (!rulesFile) throw new Error('args.rulesFile обязателен')
const ROOT = (args && args.root) || ''
if (!ROOT) throw new Error('args.root обязателен: абсолютный путь к папке проекта')
// Модели по ролям (docs/RUNBOOK.md, «Модели по ролям»): light -> args.model_light, strong -> args.model;
// args.models {роль: модель} переопределяет умолчание роли. Те же args - те же модели (resume берет кэш).
const MODEL = (args && args.model) || undefined
const MODEL_LIGHT = (args && args.model_light) || MODEL
const ROLE_MODELS = (args && args.models) || {}
if (typeof ROLE_MODELS !== 'object' || Array.isArray(ROLE_MODELS)) throw new Error('args.models: объект {роль: модель}')
const ROLES = {
  run: 'light', distill: 'strong', 'distill-check': 'strong',
}
const modelFor = role => {
  if (!ROLES[role]) throw new Error(`роль ${role} не описана в ROLES`)
  return ROLE_MODELS[role] || (ROLES[role] === 'light' ? MODEL_LIGHT : MODEL)
}
const pre = p => `Папка проекта: ${ROOT}. Все относительные пути в промтах считаются от нее; команды запускай из нее (cd "${ROOT}" && ...). Сначала прочитай ${ROOT}/CLAUDE.md, затем ${ROOT}/${p}, и выполни роль строго по нему.`
const DISTILL = { type: 'object', properties: { files: { type: 'array', items: { type: 'object', properties: { path: { type: 'string' }, bytes: { type: 'number' } }, required: ['path'] } }, sections_map: { type: 'array', items: { type: 'object', properties: { section: { type: 'string' }, roles: { type: 'array', items: { type: 'string' } } }, required: ['section'] } }, conflicts_resolved: { type: 'array', items: { type: 'string' } }, excluded_sections: { type: 'array', items: { type: 'string' } } }, required: ['files', 'sections_map', 'conflicts_resolved', 'excluded_sections'] }
const FINDINGS = { type: 'object', properties: { findings: { type: 'array', items: { type: 'object', properties: { severity: { type: 'string', enum: ['blocker', 'major', 'minor'] }, category: { type: 'string' }, rule: { type: 'string' }, problem: { type: 'string' }, quote: { type: 'string' }, proposal: { type: 'string' } }, required: ['severity', 'rule', 'problem'] } }, verdict: { type: 'string' }, summary: { type: 'string' } }, required: ['findings', 'verdict', 'summary'] }
const RUN = { type: 'object', properties: { ok: { type: 'boolean' }, exit_code: { type: 'number' }, stdout_tail: { type: 'string' } }, required: ['ok', 'exit_code', 'stdout_tail'] }
const run = (cmd, label, phase) => agent(`Запусти команду из папки проекта ${ROOT}:\ncd "${ROOT}" && ${cmd}\nНичего не исправляй и не интерпретируй. Верни ok (код выхода 0), exit_code и последние 40 строк вывода.`, { label, phase, effort: 'low', model: modelFor('run'), schema: RUN })
const serious = r => (r && r.findings || []).filter(f => f.severity !== 'minor')

phase('Distill')
const distill = (args && args.skipDistill) ? { skipped: true } : await agent(`${pre('prompts/T1-rules-distiller.md')}\nПараметры: исходный файл правил: ${rulesFile}.`, { label: 'distill', phase: 'Distill', effort: 'high', model: modelFor('distill'), schema: DISTILL })
phase('Check')
let check = await agent(`${pre('prompts/T1-rules-checker.md')}\nПараметры: исходный файл правил: ${rulesFile}. Круг 1.`, { label: 'check-1', phase: 'Check', effort: 'high', model: modelFor('distill-check'), schema: FINDINGS })
log(`проверка: находок ${check ? check.findings.length : 'нет ответа'}, серьезных ${serious(check).length}`)
let fix = null
if (serious(check).length) {
  phase('Fix')
  fix = await agent(`${pre('prompts/T1-rules-distiller.md')}\nЭто второй проход. Не переписывай инструкции целиком: точечно исправь их по находкам ниже (дописать потерянное, убрать искажение, снять противоречие). Исходный файл правил: ${rulesFile}.\nНаходки:\n${JSON.stringify(serious(check), null, 1)}`, { label: 'distill-fix', phase: 'Fix', effort: 'high', model: modelFor('distill'), schema: DISTILL })
  check = await agent(`${pre('prompts/T1-rules-checker.md')}\nПараметры: исходный файл правил: ${rulesFile}. Круг 2: проверь, закрыты ли находки первого круга, и нет ли новых искажений.\nНаходки первого круга:\n${JSON.stringify(serious(check), null, 1)}`, { label: 'check-2', phase: 'Fix', effort: 'high', model: modelFor('distill-check'), schema: FINDINGS })
}
const norm = await run('node scripts/normalize.mjs rules/hero.md rules/conversion.md rules/info.md rules/auditor.md rules/offer-formulas.md rules/offer-formulas.json rules/lint.json rules/distill-notes.md', 'normalize', 'Check')
return { distill, fix, check, normalize: norm && norm.stdout_tail }
