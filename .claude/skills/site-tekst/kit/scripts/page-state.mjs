// Пересчет состояния страницы после каждого блока.
// node scripts/page-state.mjs <slug>
// Пишет state.json (полное: судья, фиксер, кросс-судья) и state.writer.json (компактное: следующий писатель блока),
// заодно пересобирает срезы брифа brief/<block_id>.json, если они устарели (scripts/writer-inputs.mjs).
import path from 'node:path';
import { P, pageDir, loadBrief, loadBlocks, writeJson, nowIso, blockPlainText, PLACEHOLDER_RE, validate, loadSchema } from './lib.mjs';
import { ensureSlices, writeCompact } from './writer-inputs.mjs';

const slug = process.argv[2];
if (!slug) { console.error('usage: page-state.mjs <slug>'); process.exit(2); }
const brief = loadBrief(slug);
const blocks = loadBlocks(slug);
const doneIds = blocks.map(b => b.block.block_id);
const order = brief.blocks.map(b => b.block_id);
const next = order.find(id => !doneIds.includes(id)) || '';
const facts = {}, objections = {}, phrases = new Set(), ctaUsed = [];
let placeholders = 0;
for (const { block } of blocks) {
  const ids = new Set([...(block.facts_used || [])]);
  for (const el of block.elements || []) {
    (el.facts || []).forEach(f => ids.add(f));
    if (el.kind === 'button') ctaUsed.push(block.block_id);
  }
  ids.forEach(f => { (facts[f] ??= []).push(block.block_id); });
  (block.objections_closed || []).forEach(o => { (objections[o] ??= []).push(block.block_id); });
  (block.client_phrases_used || []).forEach(p => phrases.add(p));
  placeholders += (blockPlainText(block).match(PLACEHOLDER_RE) || []).length;
}
const last = blocks[blocks.length - 1];
// строки про факты и возражения - только в полном state.json: писателю те же данные идут картами facts_used / objections_covered
const factLines = [], restLines = [];
for (const [f, where] of Object.entries(facts)) {
  const fact = (brief.facts || []).find(x => x.id === f);
  factLines.push(`факт ${f}${fact ? ` (${fact.label})` : ''} уже назван в ${where.join(', ')}: не повторять цифру, можно сослаться одним словом`);
}
for (const [o, where] of Object.entries(objections)) factLines.push(`возражение ${o} уже закрыто в ${where.join(', ')}`);
if (ctaUsed.length) restLines.push(`кнопка уже стоит в ${ctaUsed.join(', ')}: в промежуточных блоках кнопок нет`);
// фразы, которые уже звучат в двух и более блоках: следующий писатель их не повторяет
{
  const norm = s => s.toLowerCase().replace(/\[\[[^\]]+\]\]/g, ' ').replace(/[^a-zа-я0-9 ]+/gi, ' ').split(/\s+/).filter(w => w.length >= 3);
  const protectedText = [...(brief.terminology?.use || []).map(t => t.say), brief.cta?.main || '', ...(brief.facts || []).map(f => f.wording)].join(' \n ');
  const prot = new Set(); { const w = norm(protectedText); for (let i = 0; i + 3 <= w.length; i++) prot.add(w.slice(i, i + 3).join(' ')); }
  const count = {};
  for (const { block } of blocks) { const w = norm(blockPlainText(block)); const seen = new Set(); for (let i = 0; i + 3 <= w.length; i++) { const g = w.slice(i, i + 3).join(' '); if (prot.has(g) || seen.has(g)) continue; seen.add(g); (count[g] ??= []).push(block.block_id); } }
  const repeated = Object.entries(count).filter(([, ids]) => ids.length >= 2).sort((a, b) => b[1].length - a[1].length).slice(0, 12);
  if (repeated.length) restLines.push(`фразы, которые уже повторяются на странице (не использовать): ${repeated.map(([g, ids]) => `«${g}» (${ids.join(', ')})`).join('; ')}`);
}
const doNotRepeat = [...factLines, ...restLines];
const state = {
  slug, updated_at: nowIso(),
  blocks_done: doneIds, next_block: next,
  cta: { main: brief.cta?.main || '', used_in: ctaUsed },
  facts_used: Object.entries(facts).map(([id, where]) => ({ id, in: where })),
  objections_covered: Object.entries(objections).map(([id, where]) => ({ id, in: where })),
  client_phrases_used: [...phrases],
  blocks_summary: blocks.map(({ block }) => ({ block_id: block.block_id, summary: block.summary || '', handoff_note: block.handoff_note || '' })),
  last_block: last ? { block_id: last.block.block_id, text: blockPlainText(last.block) } : { block_id: '', text: '' },
  do_not_repeat: doNotRepeat,
  placeholders_total: placeholders,
};
const errors = validate(loadSchema('state'), state);
if (errors.length) { console.error('state не прошел схему:'); errors.forEach(e => console.error(' - ' + e)); process.exit(1); }
writeJson(path.join(pageDir(slug), 'state.json'), state);

// компактное состояние для писателя: без истории handoff_note (кроме последнего блока) и без дублей строк про факты
const clip = (s, n) => (s.length > n ? s.slice(0, n).replace(/\s+\S*$/, '') + ' (...)' : s);
const writerState = {
  slug,
  blocks_done: `${doneIds.length}/${order.length}`,
  facts_used: facts,
  objections_covered: objections,
  do_not_repeat: restLines,
  blocks_summary: blocks.map(({ block }) => `${block.block_id}: ${clip(block.summary || '', 240)}`),
  // текст построчно (строка на текстовое поле элемента): длинный блок одной JSON-строкой инструмент чтения обрезал бы
  last_block: last ? { block_id: last.block.block_id, text: blockPlainText(last.block).split('\n').filter(Boolean), handoff_note: last.block.handoff_note || '' } : { block_id: '', text: [], handoff_note: '' },
};
const werr = validate(loadSchema('state-writer'), writerState);
if (werr.length) { console.error('state.writer не прошел схему:'); werr.forEach(e => console.error(' - ' + e)); process.exit(1); }
writeCompact(path.join(pageDir(slug), 'state.writer.json'), writerState);
const slices = ensureSlices(slug);
console.log(`state ${slug}: готово блоков ${doneIds.length}/${order.length}, следующий: ${next || '-'}, плейсхолдеров ${placeholders}${slices === 'ok' ? '' : `, срезы брифа: ${slices}`}`);
