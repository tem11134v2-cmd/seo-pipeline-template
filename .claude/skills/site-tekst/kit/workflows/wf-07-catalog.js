export const meta = {
  name: 'wf-07-catalog',
  description: 'Phase 7: catalog spec (checked by schema), sample items for prototype cards (parallel to TZ, failure does not stop the phase), developer TZ, TZ audit with finding statuses and round 2 (spec first, then TZ), publish to Google Doc',
  phases: [{ title: 'Spec' }, { title: 'Samples' }, { title: 'TZ' }, { title: 'Publish' }],
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
  'tz-publish': 'light', 'sample-items': 'light', 'catalog-spec': 'strong', 'tz-write': 'strong', 'tz-audit': 'strong', run: 'light',
}
const modelFor = role => {
  if (!ROLES[role]) throw new Error(`роль ${role} не описана в ROLES`)
  return ROLE_MODELS[role] || (ROLES[role] === 'light' ? MODEL_LIGHT : MODEL)
}
const pre = p => `Папка проекта: ${ROOT}. Все относительные пути в промтах считаются от нее; команды запускай из нее (cd "${ROOT}" && ...). Сначала прочитай ${ROOT}/CLAUDE.md, затем ${ROOT}/${p}, и выполни роль строго по нему.`
const ANY = { type: 'object', properties: { ok: { type: 'boolean' }, summary: { type: 'string' } }, required: ['ok', 'summary'] }
const RUN = { type: 'object', properties: { ok: { type: 'boolean' }, exit_code: { type: 'number' }, tail: { type: 'string' } }, required: ['ok', 'tail'] }
// находки аудитора ТЗ (K12): id CT-NN сквозные между кругами, status - как в schemas/findings.schema.json (нет - open)
const FINDINGS = { type: 'object', properties: { round: { type: 'number' }, findings: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, severity: { type: 'string', enum: ['blocker', 'major', 'minor'] }, status: { type: 'string', enum: ['open', 'fixed', 'rejected', 'wontfix'] }, category: { type: 'string', enum: ['fact', 'repeat', 'logic', 'rule', 'coverage', 'weak', 'style', 'structure', 'format'] }, rule: { type: 'string' }, problem: { type: 'string' }, quote: { type: 'string' }, proposal: { type: 'string' }, resolution: { type: 'string' } }, required: ['id', 'severity', 'rule', 'problem'] } }, verdict: { type: 'string' }, summary: { type: 'string' } }, required: ['findings', 'verdict', 'summary'] }
const tail = 'Верни ok=true и в summary - JSON результата из раздела «Формат результата» твоего промта одной строкой.'
// открытые blocker/major: статус open или без статуса (прежние находки круга 2 со status fixed/rejected/wontfix не в счет)
const serious = r => (r && r.findings || []).filter(f => f.severity !== 'minor' && (!f.status || f.status === 'open'))
const run = (cmd, label, phase) => agent(`Запусти команду из папки проекта ${ROOT}:\ncd "${ROOT}" && ${cmd}\nНичего не исправляй и не интерпретируй. Верни ok (код выхода 0), exit_code и последние 40 строк вывода.`, { label, phase, effort: 'low', model: modelFor('run'), schema: RUN })
const SPEC_CHECK = 'node scripts/validate.mjs catalog-spec work/catalog/catalog-spec.json'
const TZ_CHECK = 'node scripts/md-to-docx.mjs --check work/catalog/tz.md'
const must = (r, what) => { if (!r || r.ok === false) throw new Error(`${what}: ${String((r && (r.tail || r.summary)) || 'агент не ответил').slice(-600)}`) }

phase('Spec')
const spec = (args && args.skipSpec) ? { ok: true, summary: 'skipped' } : await agent(`${pre('prompts/07-catalog-spec-writer.md')}\n${tail}`, { label: 'catalog-spec', phase: 'Spec', effort: 'high', model: modelFor('catalog-spec'), schema: ANY })
must(spec, 'спецификация каталога не собрана (07-catalog-spec-writer)')
// спецификация - источник ТЗ и прототипа: нет файла или он не проходит схему - фаза не идет дальше
must(await run(SPEC_CHECK, 'check:spec', 'Spec'), 'нет work/catalog/catalog-spec.json или он не проходит схему')

// Примеры товаров (work/catalog/sample-items.json) нужны только прототипу: идут параллельно ТЗ, ждем в конце. Отказ шага
// (сеть, антибот) не валит фазу: прототип рисует запасные карточки, причина - в samples результата.
const samplesP = agent(`${pre('prompts/07-sample-items.md')}\n${tail}`, { label: 'sample-items', phase: 'Samples', effort: 'medium', model: modelFor('sample-items'), schema: ANY })
  .catch(e => ({ ok: false, summary: `агент упал: ${String((e && e.message) || e).slice(0, 300)}` }))

phase('TZ')
const tz1 = await agent(`${pre('prompts/07-catalog-tz-writer.md')}\nПараметры: round=1.\n${tail}`, { label: 'tz-write', phase: 'TZ', effort: 'high', model: modelFor('tz-write'), schema: ANY })
must(tz1, 'ТЗ на каталог не написано (07-catalog-tz-writer)')
must(await run(TZ_CHECK, 'check:tz', 'TZ'), 'нет work/catalog/tz.md или он пустой')
let audit = await agent(`${pre('prompts/07-catalog-tz-auditor.md')}\nКруг 1.`, { label: 'tz-audit-1', phase: 'TZ', effort: 'high', model: modelFor('tz-audit'), schema: FINDINGS })
let tz2 = null
if (serious(audit).length) {
  // второй круг: писатель сначала правит спецификацию (фильтры только добавляет), затем ТЗ; проверка обоих файлов.
  // Примеры товаров читают catalog-spec.json: до его правки ждем их, иначе агент примеров прочтет файл посреди записи
  await samplesP
  tz2 = await agent(`${pre('prompts/07-catalog-tz-writer.md')}\nПараметры: round=2.\n${tail}`, { label: 'tz-write-2', phase: 'TZ', effort: 'high', model: modelFor('tz-write'), schema: ANY })
  must(await run(`${SPEC_CHECK} && ${TZ_CHECK}`, 'check:tz-2', 'TZ'), 'после второго круга спецификация не проходит схему или ТЗ пустое')
  audit = await agent(`${pre('prompts/07-catalog-tz-auditor.md')}\nКруг 2: проставь статусы находкам из work/audit/catalog-tz.json (раздел «Круги и статусы»), затем ищи новые ошибки.`, { label: 'tz-audit-2', phase: 'TZ', effort: 'high', model: modelFor('tz-audit'), schema: FINDINGS })
}

let publish = null
if (!(args && args.publish === false)) {
  phase('Publish')
  publish = await agent(`${pre('prompts/07-catalog-publisher.md')}\n${tail}`, { label: 'tz-publish', phase: 'Publish', effort: 'medium', model: modelFor('tz-publish'), schema: ANY })
}
const samples = await samplesP
return { spec: spec && spec.summary, samples: samples && (samples.ok === false ? `ошибка: ${samples.summary}` : samples.summary), tz: (tz2 || tz1) && (tz2 || tz1).summary, audit: audit && audit.summary, open: serious(audit).length, publish: publish && publish.summary }
