export const meta = {
  name: 'wf-07-catalog',
  description: 'Phase 7: catalog spec, developer TZ, TZ audit and fix, publish to Google Doc',
  phases: [{ title: 'Spec' }, { title: 'TZ' }, { title: 'Publish' }],
}
// args: { root, publish?: boolean (default true), skipSpec?: boolean, model?, model_light?, models?: {роль: модель} }
const ROOT = (args && args.root) || ''
if (!ROOT) throw new Error('args.root обязателен: абсолютный путь к папке проекта')
// Модели по ролям (docs/RUNBOOK.md, «Модели по ролям»): light -> args.model_light, strong -> args.model;
// args.models {роль: модель} переопределяет умолчание роли. Те же args - те же модели (resume берет кэш).
const MODEL = (args && args.model) || undefined
const MODEL_LIGHT = (args && args.model_light) || MODEL
const ROLE_MODELS = (args && args.models) || {}
if (typeof ROLE_MODELS !== 'object' || Array.isArray(ROLE_MODELS)) throw new Error('args.models: объект {роль: модель}')
const ROLES = {
  'tz-publish': 'light', 'catalog-spec': 'strong', 'tz-write': 'strong', 'tz-audit': 'strong',
}
const modelFor = role => {
  if (!ROLES[role]) throw new Error(`роль ${role} не описана в ROLES`)
  return ROLE_MODELS[role] || (ROLES[role] === 'light' ? MODEL_LIGHT : MODEL)
}
const pre = p => `Папка проекта: ${ROOT}. Все относительные пути в промтах считаются от нее; команды запускай из нее (cd "${ROOT}" && ...). Сначала прочитай ${ROOT}/CLAUDE.md, затем ${ROOT}/${p}, и выполни роль строго по нему.`
const ANY = { type: 'object', properties: { ok: { type: 'boolean' }, summary: { type: 'string' } }, required: ['ok', 'summary'] }
const FINDINGS = { type: 'object', properties: { findings: { type: 'array', items: { type: 'object', properties: { severity: { type: 'string', enum: ['blocker', 'major', 'minor'] }, category: { type: 'string' }, rule: { type: 'string' }, problem: { type: 'string' }, quote: { type: 'string' }, proposal: { type: 'string' } }, required: ['severity', 'rule', 'problem'] } }, verdict: { type: 'string' }, summary: { type: 'string' } }, required: ['findings', 'verdict', 'summary'] }
const tail = 'Верни ok=true и в summary - JSON результата из раздела «Формат результата» твоего промта одной строкой.'
const serious = r => (r && r.findings || []).filter(f => f.severity !== 'minor')

phase('Spec')
const spec = (args && args.skipSpec) ? { ok: true, summary: 'skipped' } : await agent(`${pre('prompts/07-catalog-spec-writer.md')}\n${tail}`, { label: 'catalog-spec', phase: 'Spec', effort: 'high', model: modelFor('catalog-spec'), schema: ANY })

phase('TZ')
const tz1 = await agent(`${pre('prompts/07-catalog-tz-writer.md')}\nПараметры: round=1.\n${tail}`, { label: 'tz-write', phase: 'TZ', effort: 'high', model: modelFor('tz-write'), schema: ANY })
let audit = await agent(`${pre('prompts/07-catalog-tz-auditor.md')}`, { label: 'tz-audit-1', phase: 'TZ', effort: 'high', model: modelFor('tz-audit'), schema: FINDINGS })
let tz2 = null
if (serious(audit).length) {
  tz2 = await agent(`${pre('prompts/07-catalog-tz-writer.md')}\nПараметры: round=2.\n${tail}`, { label: 'tz-write-2', phase: 'TZ', effort: 'high', model: modelFor('tz-write'), schema: ANY })
  audit = await agent(`${pre('prompts/07-catalog-tz-auditor.md')}\nКруг 2: проверь закрытие находок из work/audit/catalog-tz.json и новых ошибок.`, { label: 'tz-audit-2', phase: 'TZ', effort: 'high', model: modelFor('tz-audit'), schema: FINDINGS })
}

let publish = null
if (!(args && args.publish === false)) {
  phase('Publish')
  publish = await agent(`${pre('prompts/07-catalog-publisher.md')}\n${tail}`, { label: 'tz-publish', phase: 'Publish', effort: 'medium', model: modelFor('tz-publish'), schema: ANY })
}
return { spec: spec && spec.summary, tz: (tz2 || tz1) && (tz2 || tz1).summary, audit: audit && audit.summary, open: serious(audit).length, publish: publish && publish.summary }
