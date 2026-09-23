export const meta = {
  name: 'wf-07-catalog',
  description: 'Phase 7: catalog spec, developer TZ, TZ audit and fix, publish to Google Doc',
  phases: [{ title: 'Spec' }, { title: 'TZ' }, { title: 'Publish' }],
}
// args: { publish?: boolean (default true), skipSpec?: boolean }
const ROOT = (args && args.root) || ''
if (!ROOT) throw new Error('args.root обязателен: абсолютный путь к папке проекта')
const MODEL = (args && args.model) || undefined
const MODEL_LIGHT = (args && args.model_light) || MODEL
const pre = p => `Папка проекта: ${ROOT}. Все относительные пути в промтах считаются от нее; команды запускай из нее (cd "${ROOT}" && ...). Сначала прочитай ${ROOT}/CLAUDE.md, затем ${ROOT}/${p}, и выполни роль строго по нему.`
const ANY = { type: 'object', properties: { ok: { type: 'boolean' }, summary: { type: 'string' } }, required: ['ok', 'summary'] }
const FINDINGS = { type: 'object', properties: { findings: { type: 'array', items: { type: 'object', properties: { severity: { type: 'string', enum: ['blocker', 'major', 'minor'] }, category: { type: 'string' }, rule: { type: 'string' }, problem: { type: 'string' }, quote: { type: 'string' }, proposal: { type: 'string' } }, required: ['severity', 'rule', 'problem'] } }, verdict: { type: 'string' }, summary: { type: 'string' } }, required: ['findings', 'verdict', 'summary'] }
const tail = 'Верни ok=true и в summary - JSON результата из раздела «Формат результата» твоего промта одной строкой.'
const serious = r => (r && r.findings || []).filter(f => f.severity !== 'minor')

phase('Spec')
const spec = (args && args.skipSpec) ? { ok: true, summary: 'skipped' } : await agent(`${pre('prompts/07-catalog-spec-writer.md')}\n${tail}`, { label: 'catalog-spec', phase: 'Spec', effort: 'high', model: MODEL, schema: ANY })

phase('TZ')
const tz1 = await agent(`${pre('prompts/07-catalog-tz-writer.md')}\nПараметры: round=1.\n${tail}`, { label: 'tz-write', phase: 'TZ', effort: 'high', model: MODEL, schema: ANY })
let audit = await agent(`${pre('prompts/07-catalog-tz-auditor.md')}`, { label: 'tz-audit-1', phase: 'TZ', effort: 'high', model: MODEL, schema: FINDINGS })
let tz2 = null
if (serious(audit).length) {
  tz2 = await agent(`${pre('prompts/07-catalog-tz-writer.md')}\nПараметры: round=2.\n${tail}`, { label: 'tz-write-2', phase: 'TZ', effort: 'high', model: MODEL, schema: ANY })
  audit = await agent(`${pre('prompts/07-catalog-tz-auditor.md')}\nКруг 2: проверь закрытие находок из work/audit/catalog-tz.json и новых ошибок.`, { label: 'tz-audit-2', phase: 'TZ', effort: 'high', model: MODEL, schema: FINDINGS })
}

let publish = null
if (!(args && args.publish === false)) {
  phase('Publish')
  publish = await agent(`${pre('prompts/07-catalog-publisher.md')}\n${tail}`, { label: 'tz-publish', phase: 'Publish', effort: 'medium', model: MODEL, schema: ANY })
}
return { spec: spec && spec.summary, tz: (tz2 || tz1) && (tz2 || tz1).summary, audit: audit && audit.summary, open: serious(audit).length, publish: publish && publish.summary }
