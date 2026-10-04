// Пересчет состояния страницы после каждого блока.
// node scripts/page-state.mjs <slug> [<block_id>]
// Пишет state.json (полное: судья, фиксер, кросс-судья) и state.writer.json (компактное: следующий писатель блока),
// заодно пересобирает срезы брифа brief/<block_id>.json, если они устарели (scripts/writer-inputs.mjs).
// Блок, чей отчет линтера есть и не pass, в facts_used, objections_covered и повторы не входит: в прототипе он скелет,
// его факты и фразы следующим блокам не запрещены. Поля attempts и brief_sha файлов блоков скрипт не трогает.
// state.writer.json строится для следующего блока (for_block, решение Р5): только прошедшие блоки выше него по брифу -
// факты, возражения, повторы и last_block (ближайший прошедший блок выше). Блоки ниже (повтор блока в середине
// страницы) и не прошедшие линтер писателю ничего не запрещают. Следующий блок: <block_id> из аргумента; иначе первый
// по брифу блок, который не пройден, не исчерпан (progress.mjs) и еще не писался по текущему срезу; иначе первый не
// пройденный и не исчерпанный. Блок с файлом без отчета линтера считается пройденным (как раньше).
import path from 'node:path';
import { P, pageDir, loadBrief, loadBlocks, writeJson, nowIso, blockPlainText, PLACEHOLDER_RE, validate, loadSchema, exists, readJson, protectedFactTexts } from './lib.mjs';
import { ensureSlices, writeCompact } from './writer-inputs.mjs';
import { blockState } from './progress.mjs';

const slug = process.argv[2];
if (!slug) { console.error('usage: page-state.mjs <slug> [<block_id>]'); process.exit(2); }
const forArg = process.argv[3] || '';
const brief = loadBrief(slug);
const blocks = loadBlocks(slug);
const doneIds = blocks.map(b => b.block.block_id);
const order = brief.blocks.map(b => b.block_id);
if (forArg && !order.includes(forArg)) { console.error(`page-state: блока ${forArg} нет в брифе ${slug}`); process.exit(2); }
const lintFailed = id => { const f = P('work', 'audit', slug, `lint-${id}.json`); try { return exists(f) && readJson(f).verdict !== 'pass'; } catch { return false; } };
const counted = blocks.filter(({ block }) => !lintFailed(block.block_id));
const countedIds = new Set(counted.map(({ block }) => block.block_id));
// следующий блок для писателя
const states = Object.fromEntries(brief.blocks.map(spec => [spec.block_id, blockState(process.cwd(), slug, spec)]));
const open = order.filter(id => !countedIds.has(id) && !states[id].exhausted);
const next = forArg || open.find(id => !states[id].attempts) || open[0] || '';

// Сбор фактов, возражений, слов клиента и фраз по набору блоков (прошедших линтер)
function collect(list) {
  const facts = {}, objections = {}, phrases = new Set(), ctaUsed = [];
  let placeholders = 0;
  for (const { block } of list) {
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
  // фразы, которые уже звучат в двух и более блоках: следующий писатель их не повторяет (предмет страницы и ключевая
  // фраза - лексика страницы, повтором не считаются)
  const norm = s => s.toLowerCase().replace(/\[\[[^\]]+\]\]/g, ' ').replace(/[^a-zа-я0-9 ]+/gi, ' ').split(/\s+/).filter(w => w.length >= 3);
  const protectedText = [...(brief.terminology?.use || []).map(t => t.say), brief.cta?.main || '', ...protectedFactTexts(brief), brief.subject || '', brief.key_phrase || ''].join(' \n ');
  const prot = new Set(); { const w = norm(protectedText); for (let i = 0; i + 3 <= w.length; i++) prot.add(w.slice(i, i + 3).join(' ')); }
  const count = {};
  for (const { block } of list) { const w = norm(blockPlainText(block)); const seen = new Set(); for (let i = 0; i + 3 <= w.length; i++) { const g = w.slice(i, i + 3).join(' '); if (prot.has(g) || seen.has(g)) continue; seen.add(g); (count[g] ??= []).push(block.block_id); } }
  const repeated = Object.entries(count).filter(([, ids]) => ids.length >= 2).sort((a, b) => b[1].length - a[1].length).slice(0, 12);
  const factLines = [], restLines = [];
  for (const [f, where] of Object.entries(facts)) {
    const fact = (brief.facts || []).find(x => x.id === f);
    factLines.push(`факт ${f}${fact ? ` (${fact.label})` : ''} уже назван в ${where.join(', ')}: не повторять цифру, можно сослаться одним словом`);
  }
  for (const [o, where] of Object.entries(objections)) factLines.push(`возражение ${o} уже закрыто в ${where.join(', ')}`);
  if (ctaUsed.length) restLines.push(`кнопка уже стоит в ${ctaUsed.join(', ')}: в промежуточных блоках кнопок нет`);
  if (repeated.length) restLines.push(`фразы, которые уже повторяются на странице (не использовать): ${repeated.map(([g, ids]) => `«${g}» (${ids.join(', ')})`).join('; ')}`);
  return { facts, objections, phrases, ctaUsed, placeholders, factLines, restLines };
}

// полное состояние страницы: все прошедшие блоки (судья, фиксер, кросс-судья)
const all = collect(counted);
const last = blocks[blocks.length - 1];
const state = {
  slug, updated_at: nowIso(),
  blocks_done: doneIds, next_block: next,
  cta: { main: brief.cta?.main || '', used_in: all.ctaUsed },
  facts_used: Object.entries(all.facts).map(([id, where]) => ({ id, in: where })),
  objections_covered: Object.entries(all.objections).map(([id, where]) => ({ id, in: where })),
  client_phrases_used: [...all.phrases],
  blocks_summary: blocks.map(({ block }) => ({ block_id: block.block_id, summary: block.summary || '', handoff_note: block.handoff_note || '' })),
  last_block: last ? { block_id: last.block.block_id, text: blockPlainText(last.block) } : { block_id: '', text: '' },
  // строки про факты и возражения - только в полном state.json: писателю те же данные идут картами facts_used / objections_covered
  do_not_repeat: [...all.factLines, ...all.restLines],
  placeholders_total: all.placeholders,
};
const errors = validate(loadSchema('state'), state);
if (errors.length) { console.error('state не прошел схему:'); errors.forEach(e => console.error(' - ' + e)); process.exit(1); }
writeJson(path.join(pageDir(slug), 'state.json'), state);

// компактное состояние для писателя следующего блока: прошедшие блоки выше него (нет следующего - все прошедшие)
const pos = next ? order.indexOf(next) : order.length;
const above = counted.filter(({ block }) => { const i = order.indexOf(block.block_id); return i >= 0 && i < pos; });
const mine = collect(above);
const prev = above[above.length - 1];
const clip = (s, n) => (s.length > n ? s.slice(0, n).replace(/\s+\S*$/, '') + ' (...)' : s);
const writerState = {
  slug,
  for_block: next,
  blocks_done: `${doneIds.length}/${order.length}`,
  facts_used: mine.facts,
  objections_covered: mine.objections,
  do_not_repeat: mine.restLines,
  blocks_summary: above.map(({ block }) => `${block.block_id}: ${clip(block.summary || '', 240)}`),
  // текст построчно (строка на текстовое поле элемента): длинный блок одной JSON-строкой инструмент чтения обрезал бы
  last_block: prev ? { block_id: prev.block.block_id, text: blockPlainText(prev.block).split('\n').filter(Boolean), handoff_note: prev.block.handoff_note || '' } : { block_id: '', text: [], handoff_note: '' },
};
const werr = validate(loadSchema('state-writer'), writerState);
if (werr.length) { console.error('state.writer не прошел схему:'); werr.forEach(e => console.error(' - ' + e)); process.exit(1); }
writeCompact(path.join(pageDir(slug), 'state.writer.json'), writerState);
const slices = ensureSlices(slug);
console.log(`state ${slug}: готово блоков ${doneIds.length}/${order.length}, следующий: ${next || '-'}, плейсхолдеров ${all.placeholders}${slices === 'ok' ? '' : `, срезы брифа: ${slices}`}`);
