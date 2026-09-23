export const meta = {
  name: 'wf-05b-hero-tournament',
  description: 'Hero tournament for one page: 3 writers with different constructions, 2 independent judges, final selector. Called by wf-05-write for hero_mode=tournament pages; standalone - to re-run the hero of a finished page',
  phases: [{ title: 'Write' }, { title: 'Judge' }, { title: 'Select' }],
}
// args: { root, slug, block_id?: 'B01-hero', model?, model_light?, last?: true }
// last - селектор после page-state собирает page.md (render-md). По умолчанию true: отдельный перезапуск турнира на готовой странице
// обновляет page.md; wf-05-write передает last=true, только если первый экран - последний блок прогона страницы.
// Конструкции писателей (w1, w2, w3), режим оценки и финальный выбор описаны в prompts/05-hero-writer.md и prompts/05-hero-selector.md.
const ROOT = (args && args.root) || ''
if (!ROOT) throw new Error('args.root обязателен: абсолютный путь к папке проекта')
const MODEL = (args && args.model) || undefined
const MODEL_LIGHT = (args && args.model_light) || MODEL // легких агентов в турнире нет; параметр принимается ради единых args
const slug = args && args.slug
if (!slug) throw new Error('args.slug обязателен')
const bid = (args && args.block_id) || 'B01-hero'
const last = !(args && args.last === false)
const pre = p => `Папка проекта: ${ROOT}. Все относительные пути в промтах считаются от нее; команды запускай из нее (cd "${ROOT}" && ...). Сначала прочитай ${ROOT}/CLAUDE.md, затем ${ROOT}/${p}, и выполни роль строго по нему.`
const HERO = { type: 'object', properties: { slug: { type: 'string' }, block_id: { type: 'string' }, variants: { type: 'number' }, lint: { type: 'object' }, facts_used: { type: 'array', items: { type: 'string' } }, notes: { type: 'string' } }, required: ['slug', 'block_id', 'variants'] }
const SCORES = { type: 'object', properties: { scores: { type: 'object' }, top3: { type: 'array', items: { type: 'string' } }, notes: { type: 'string' } }, required: ['scores', 'top3', 'notes'] }
const SELECT = { type: 'object', properties: { slug: { type: 'string' }, block_id: { type: 'string' }, chosen: { type: 'string' }, scores: { type: 'object' }, lint: { type: 'string' }, reason: { type: 'string' }, top3: { type: 'array', items: { type: 'object', properties: { variant: { type: 'string' }, h1: { type: 'string' }, sub: { type: 'string' }, score: { type: 'number' } }, required: ['variant', 'h1'] } } }, required: ['slug', 'block_id', 'chosen', 'lint'] }

const KEYS = ['w1', 'w2', 'w3']
const vfile = k => `work/pages/${slug}/blocks/${bid}.variants.${k}.json`

phase('Write')
const res = await parallel(KEYS.map(k => () => agent(`${pre('prompts/05-hero-writer.md')}
Параметры: slug=${slug}; block_id=${bid}; mode=tournament; key=${k}.`, { label: `hero-writer:${slug}:${k}`, phase: 'Write', effort: 'high', model: MODEL, schema: HERO })))
const keys = KEYS.filter((k, i) => res[i])
if (!keys.length) throw new Error(`${slug}: ни один писатель турнира не вернул варианты`)
if (keys.length < KEYS.length) log(`${slug}: турнир идет без ${KEYS.filter(k => !keys.includes(k)).join(', ')} (писатель не ответил)`)
const files = keys.map(vfile).join(',')

phase('Judge')
const [j1, j2] = await parallel([
  () => agent(`${pre('prompts/05-hero-selector.md')}
Параметры: slug=${slug}; block_id=${bid}; mode=score; variants=${files}.`, { label: `judge:checklist:${slug}`, phase: 'Judge', effort: 'high', model: MODEL, schema: SCORES }),
  () => agent(`Папка проекта: ${ROOT}. Ты - слепой читатель. Прочитай в work/pages/${slug}/brief/${bid}.json только поле segment (portrait, comes_with, pains, fears) и стань этим человеком. Затем открой файлы вариантов ${files.split(',').join(', ')} (формат {"variants":[...]}) и для каждого варианта прочитай только h1, sub и текст кнопки. Правила копирайтинга не читай.
Для каждого варианта ответь как этот человек: что мне обещают (одной фразой своими словами), верю ли я этому (да/нет и почему), хочу ли я это получить (0-5), нажал бы кнопку (да/нет). Отдельно: какой заголовок ты бы пересказал знакомому, а какой забыл бы через минуту.
Верни scores: {"<variant>": хочу-получить 0-5 плюс 1 если нажал бы кнопку}, top3 - три лучших variant с фразой «что обещают» своими словами, notes - чего не хватает всем.`, { label: `judge:blind:${slug}`, phase: 'Judge', effort: 'high', model: MODEL, schema: SCORES }),
])

phase('Select')
const selected = await agent(`${pre('prompts/05-hero-selector.md')}
Параметры: slug=${slug}; block_id=${bid}; mode=select; variants=${files}; last=${last}; external_scores=${JSON.stringify({ checklist: j1, blind: j2 })}.`, { label: `select:${slug}`, phase: 'Select', effort: 'high', model: MODEL, schema: SELECT })
const writers = keys.map(k => { const r = res[KEYS.indexOf(k)]; return { key: k, variants: r.variants, lint: r.lint } })
return { slug, block_id: bid, writers, checklist: j1, blind: j2, selected }
