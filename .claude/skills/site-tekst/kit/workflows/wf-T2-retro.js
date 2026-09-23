export const meta = {
  name: 'wf-T2-retro',
  description: 'Retro after a project: one agent runs the audit statistics script and proposes template changes (work/output/retro.md + retro.json)',
  phases: [{ title: 'Retro' }],
}
// args: { root, model?, template?: "<путь к шаблону>", skipStats?: boolean }
// skipStats: work/audit/retro-stats.json уже посчитан - агент не перезапускает скрипт
// Скрипт статистики запускает сам агент ретро: отдельный агент-обертка ради одной node-команды не нужен.
const ROOT = (args && args.root) || ''
if (!ROOT) throw new Error('args.root обязателен: абсолютный путь к папке проекта')
const MODEL = (args && args.model) || undefined
const TEMPLATE = (args && args.template) || ''
const pre = p => `Папка проекта: ${ROOT}. Все относительные пути в промтах считаются от нее; команды запускай из нее (cd "${ROOT}" && ...). Сначала прочитай ${ROOT}/CLAUDE.md, затем ${ROOT}/${p}, и выполни роль строго по нему.`
const RETRO = { type: 'object', properties: { ok: { type: 'boolean' }, files: { type: 'array', items: { type: 'string' } }, proposals: { type: 'number' }, top3: { type: 'string' } }, required: ['ok', 'files', 'proposals', 'top3'] }

phase('Retro')
const stats = (args && args.skipStats)
  ? 'Файл work/audit/retro-stats.json уже посчитан - скрипт не запускай.'
  : `Первым шагом выполни cd "${ROOT}" && node scripts/retro-stats.mjs. Код выхода не 0 - остановись и верни ok=false, в top3 - последние строки вывода.`
const tpl = TEMPLATE ? `\nПараметры: template=${TEMPLATE}.` : ''
const retro = await agent(`${pre('prompts/T2-retro.md')}${tpl}\n${stats}`, { label: 'retro', phase: 'Retro', effort: 'high', model: MODEL, schema: RETRO })
log(`ретро: ${retro ? `предложений ${retro.proposals}; ${retro.top3}` : 'нет ответа'}`)
return { ok: !!(retro && retro.ok), retro }
