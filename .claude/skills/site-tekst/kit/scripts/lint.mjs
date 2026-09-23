// Линтер блока. node scripts/lint.mjs work/pages/<slug>/blocks/<block_id>.json [--fix] [--quiet]
// Проверяет house style, стоп-слова, цифры без фактов, антиобещания, жаргон, CTA, длины, плейсхолдеры,
// формы ai.* и style.*, утверждения без факта (fact.claim-unsupported) и бюджеты страницы
// (ai.contrast, ai.neg-pitch, word.overuse, placeholder.count): бюджет расходуется в порядке блоков брифа -
// блоки выше этого плюс сам блок, так же, как считает lint-page.mjs по всей странице. word.overuse здесь - minor
// (major ставит только lint-page.mjs), поэтому вердикт блока и plan-run от повторов слов не зависят.
// Пишет work/audit/<slug>/lint-<block_id>.json (findings). Код выхода 1, если есть blocker или major.
// Печатает blocker, major и minor по правилам ai.*, style.*, fact.claim-unsupported, word.overuse.
import path from 'node:path';
import fs from 'node:fs';
import { argv, P, readJson, writeJson, exists, loadConfig, elementTexts, blockPlainText, normalizeDeep, splitSentences, words, charsNoSpaces, PLACEHOLDER_RE, makeFindings, addFinding, finalizeVerdict, validate, loadSchema, B, cyr, esc, stemRe } from './lib.mjs';
import { compileLint, scanBlock, applyPageBudgets, showMinor } from './lint-common.mjs';

const a = argv({ fix: 'bool', quiet: 'bool' });
const file = a._[0];
if (!file) { console.error('usage: lint.mjs <block.json> [--fix]'); process.exit(2); }
const cfg = loadConfig();
const rules = readJson(P('rules', 'lint.json'));
const pageDirPath = path.dirname(path.dirname(path.resolve(file)));
const slug = path.basename(pageDirPath);
const brief = readJson(path.join(pageDirPath, 'brief.json'));
const facts = exists(P('work', 'facts.json')) ? readJson(P('work', 'facts.json')) : { anti_promises: [], terminology: { jargon: [] } };
let block = readJson(file);

// --fix: нормализация символов
if (a.fix) {
  const stats = { changed: 0 };
  block = normalizeDeep(block, stats);
  block = JSON.parse(JSON.stringify(block).replace(/"([^"]*)"/g, m => m));
  writeJson(file, block);
}
const report = makeFindings(`${slug}/${block.block_id}`, 'lint');
const spec = brief.blocks.find(b => b.block_id === block.block_id);
if (!spec) { addFinding(report, { page: slug, block_id: block.block_id, severity: 'blocker', category: 'structure', rule: 'brief.block', problem: `блока ${block.block_id} нет в brief.json` }); }
const schemaErrors = validate(loadSchema('block'), block);
for (const e of schemaErrors) addFinding(report, { page: slug, block_id: block.block_id, severity: 'blocker', category: 'format', rule: 'schema.block', problem: e });

const factsById = Object.fromEntries((brief.facts || []).map(f => [f.id, f]));
const limits = cfg.limits || {};
const kindCap = { h1: limits.h1_max, sub: limits.sub_max, text: limits.text_max, bullets: limits.bullet_max, badges: 40, button: limits.button_max, note: 300, card: 220, step: 220, qa: 550, quote: 300, number: 40, h2: 80, h3: 60, link: 60, field: 40, image: 120, filters: 30, table_row: 200 };
// граница слова для кириллицы (B, cyr, esc, stemRe) - в lib.mjs
const stopRe = cyr(B + '(' + rules.stop_words.map(esc).join('|') + ')');
const introRe = cyr(`(${rules.intro_stop_phrases.map(esc).join('|')})`);
const weRe = cyr(rules.we_start_pattern);
const allRe = cyr(rules.address_all_pattern);
const antiRes = (facts.anti_promises || []).map(ap => ({ id: ap.id, re: new RegExp(ap.lint_pattern, 'i'), ctx: ap.allowed_context || '' }));
const jargonRes = (facts.terminology?.jargon || []).map(j => ({ internal: j.internal, public: j.public, re: new RegExp(`(^|[^а-яa-z])${esc(j.internal)}([^а-яa-z]|$)`, 'i') }));
// клише и запреты ловим по основам слов (stemRe)
const clicheRes = (brief.cliches_to_avoid || []).map(c => ({ c, re: stemRe(c) }));
const doNotSay = (brief.do_not_say || []).map(c => ({ c, re: stemRe(c) }));
function stripPh(s) { return s.replace(PLACEHOLDER_RE, ' '); }

let buttons = 0;
const specElems = spec ? spec.elements : [];
// Кнопки интерфейса: шаблон блока требует кнопку, а CTA в блоке не разрешен (панель фильтров, «Показать», «Сбросить»).
// Это не призыв к действию: с CTA брифа они не сверяются и в cta.not-allowed / cta.one не считаются, лимит длины остается.
const uiButtons = !!(spec && spec.role !== 'hero' && !spec.cta_allowed && specElems.some(e => e.kind === 'button'));
block.elements.forEach((el, idx) => {
  const F = (sev, cat, rule, problem, quote, proposal, auto) => addFinding(report, { page: slug, block_id: block.block_id, element_index: idx, quote: (quote || '').slice(0, 160), severity: sev, category: cat, rule, problem, proposal: proposal || '', auto_fixable: !!auto });
  const texts = elementTexts(el);
  if (!texts.length && !['image', 'field'].includes(el.kind)) F('blocker', 'format', 'element.empty', `элемент ${el.kind} без текста`);
  if (el.kind === 'button') buttons++;
  // ссылки на факты
  for (const f of el.facts || []) if (!factsById[f]) F('blocker', 'fact', 'fact.unknown', `ссылка на факт ${f}, которого нет в брифе`, '', 'убрать цифру или взять факт из брифа');
  // ссылки только на страницы карты сайта
  if (el.href && el.href !== '#' && !/^(mailto:|tel:|https?:)/.test(el.href)) {
    const known = new Set((brief.links || []).map(l => l.url.replace(/\/$/, '')));
    if (!known.has(el.href.replace(/\/$/, ''))) F('blocker', 'fact', 'link.unknown-url', `ссылка на «${el.href}», такой страницы нет в брифе (поле links)`, el.href, 'взять URL из brief.links или убрать ссылку');
  }
  if (el.kind === 'number' && !(el.value && String(el.value).trim())) F('blocker', 'format', 'number.empty', 'элемент number без значения', el.label || '', 'указать значение из факта или убрать элемент');
  if (el.kind === 'link' && !(el.href && String(el.href).trim())) F('major', 'format', 'link.no-href', 'ссылка без адреса', el.text || '', 'указать URL из brief.links или убрать ссылку');
  const refFacts = (el.facts || []).map(f => factsById[f]).filter(Boolean);
  const factDigits = refFacts.flatMap(f => digitsOf(f.value + ' ' + f.wording));
  for (const { field, text } of texts) {
    const t = stripPh(text);
    if (/[\u0451\u0401]/.test(text)) F('blocker', 'style', 'house.yo', 'буква е с точками', text, 'заменить на е', true);
    if (/[—–]/.test(text)) F('blocker', 'style', 'house.dash', 'длинное тире', text, 'заменить на короткое «-»', true);
    if (/["]/.test(text)) F('minor', 'style', 'house.quotes', 'прямые кавычки', text, 'заменить на «елочки»');
    if (/[\u{1F300}-\u{1FAFF}☀-➿✓★→]/u.test(text)) F('major', 'style', 'house.emoji', 'эмодзи или спецсимвол', text);
    if (/\[(примечание|note|todo|уточнить у заказчика|для оркестратора)/i.test(text)) F('blocker', 'format', 'note.leak', 'служебная пометка в тексте', text);
    if (['h1', 'h2', 'h3', 'sub', 'text', 'card', 'step', 'qa', 'note'].includes(el.kind) && weRe.test(t.trim())) F('major', 'rule', 'copy.we-start', 'предложение начинается с «Мы / Наша компания»', text, 'начать с результата для читателя');
    if (introRe.test(t)) F('major', 'rule', 'copy.intro', 'вступление вместо выгоды', text);
    if (allRe.test(t)) F('major', 'rule', 'copy.address-all', 'обращение ко всем сразу', text, 'говорить с одним сегментом брифа');
    // стоп-слова без цифры в том же предложении
    for (const s of splitSentences(t)) {
      const m = s.match(stopRe);
      // «лучшая цена» допустима только через гарантию возврата разницы (формула F6)
      const guaranteed = m && /^лучш/i.test(m[1]) && /гарант|верн[е\u0451]м разниц/i.test(s);
      if (m && !guaranteed && !/\d/.test(s) && !(el.facts || []).length) F('major', 'rule', 'copy.stop-word', `пустое слово «${m[1]}» без цифры или факта рядом`, s, 'заменить на факт: за счет чего, сколько, за какой срок');
      const w = words(s).length;
      if (w > rules.sentence_words_max) F('major', 'rule', 'copy.sentence-long', `предложение из ${w} слов`, s, 'разбить на два');
    }
    for (const v of rules.vague_patterns) if (cyr(v.pattern).test(t)) F(v.severity, 'rule', v.id, v.message, t);
    for (const ap of antiRes) if (ap.re.test(t)) F('blocker', 'fact', `anti.${ap.id}`, `формулировка из антиобещаний (${ap.id})`, t, ap.ctx ? `допустимо только: ${ap.ctx}` : 'убрать');
    for (const j of jargonRes) if (j.re.test(t)) F('major', 'rule', 'term.jargon', `внутренний жаргон «${j.internal}»`, t, `писать «${j.public}»`);
    for (const c of clicheRes) if (c.re.test(t)) F('major', 'weak', 'copy.cliche', `клише конкурентов «${c.c}»`, t, 'сказать то, что не может сказать конкурент');
    for (const c of doNotSay) if (c.re.test(t)) F('major', 'rule', 'strategy.do-not-say', `запрещено стратегией: «${c.c}»`, t);
    // жирное
    const bold = t.match(/\*\*([^*]+)\*\*/g) || [];
    for (const b of bold) if (words(b.replace(/\*/g, '')).length > rules.bold_max_words) F('major', 'style', 'house.bold', `жирным больше ${rules.bold_max_words} слов`, b);
    // точки в коротких элементах
    if (['h1', 'h2', 'h3', 'button'].includes(el.kind) && /[.]$/.test(t.trim())) F('minor', 'style', 'house.dot', 'точка в конце заголовка или кнопки', t, 'убрать точку', true);
    if (['bullets', 'badges'].includes(el.kind) && /[.]$/.test(t.trim()) && !/[.].*[.]/.test(t)) F('minor', 'style', 'house.dot', 'точка в конце буллета', t, 'убрать точку', true);
    // цифры без факта
    const nums = digitsOf(t);
    for (const n of nums) {
      if (!factDigits.includes(n)) F('blocker', 'fact', 'fact.number-without-source', `число «${n}» не подтверждено фактом из брифа`, t, 'убрать число или сослаться на факт в поле facts');
    }
    // плейсхолдеры в недопустимых местах
    if (PLACEHOLDER_RE.test(text) && ['h1', 'h2', 'h3', 'sub', 'button', 'text', 'bullets'].includes(el.kind)) F('blocker', 'coverage', 'placeholder.position', 'плейсхолдер в заголовке, подзаголовке, кнопке или тексте', text, 'переписать без пропавшего факта');
    // длины. Кнопка с утвержденным CTA брифа не мерится: ее текст задан стратегией слово в слово,
    // а лимит кнопки берется из замеров конкурентов - иначе два правила блокируют друг друга
    const approvedCta = el.kind === 'button' && [brief.cta?.main, brief.cta?.secondary].filter(Boolean).map(x => x.toLowerCase()).includes(t.trim().toLowerCase());
    const cap = approvedCta ? null : capFor(el.kind, field, idx);
    if (cap) {
      const c = charsNoSpaces(t);
      if (c > cap.max * rules.chars_hard_overflow) F('blocker', 'style', 'length.overflow', `${el.kind}${field !== 'text' ? '.' + field : ''}: ${c} символов, лимит ${cap.max}`, t, 'сократить на треть без потери фактов');
      else if (c > cap.max * (1 + rules.chars_tolerance)) F('major', 'style', 'length.over', `${el.kind}: ${c} символов, лимит ${cap.max}`, t, 'сократить');
      else if (cap.min && c < cap.min * (1 - rules.chars_tolerance) && ['text', 'sub', 'qa', 'card'].includes(el.kind)) F('minor', 'style', 'length.under', `${el.kind}: ${c} символов, ожидалось от ${cap.min}`, t);
    }
    if (el.kind === 'button' && !uiButtons) {
      const low = t.toLowerCase();
      for (const bad of rules.cta_verbs_bad) if (low.includes(bad)) F('major', 'weak', 'cta.weak', `кнопка «${t}» не называет, что получит читатель`, t, `использовать CTA из брифа: «${brief.cta?.main}»`);
      const allowed = [brief.cta?.main, brief.cta?.secondary].filter(Boolean).map(x => x.toLowerCase());
      if (allowed.length && !allowed.includes(low)) F('major', 'rule', 'cta.text', `текст кнопки не совпадает с CTA брифа`, t, `один из: ${allowed.join(' / ')}`);
    }
  }
  // средняя длина предложений в абзацах
  if (['text', 'qa', 'card'].includes(el.kind)) {
    const ss = splitSentences(texts.map(x => x.text).join(' '));
    const avg = ss.length ? ss.reduce((s, x) => s + words(x).length, 0) / ss.length : 0;
    if (avg > rules.sentence_words_avg_max) F('minor', 'rule', 'copy.sentence-avg', `средняя длина предложения ${avg.toFixed(0)} слов`, '', 'короче');
  }
});
function digitsOf(s) {
  // «12 400», «1,5», «2012», «10-35» -> отдельные токены; пробел допустим только как разделитель тысяч
  return (String(s).match(/\d{1,3}(?:[  ]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?/g) || []).map(x => x.replace(/[  ]/g, '').replace(',', '.')).filter(Boolean);
}
function capFor(kind, field, idx) {
  const specEl = specElems.find(e => e.kind === kind);
  const capMax = kindCap[kind] || 350;
  if (specEl && specEl.chars) {
    let max = specEl.chars.max || capMax;
    if (['card', 'step', 'qa'].includes(kind) && field === 'title') max = 80;
    if (kind === 'qa' && field === 'q') max = 90;
    if (kind === 'quote' && field === 'author') max = 60;
    if (kind === 'number' && field === 'value') max = 20;
    return { min: specEl.chars.min || 0, max: Math.min(max, ['card', 'step', 'qa', 'quote'].includes(kind) ? 900 : capMax * 1.5) };
  }
  return { min: 0, max: capMax };
}
// повторы фраз с другими блоками страницы: 3-граммы содержательных слов
{
  const norm = s => s.toLowerCase().replace(/\[\[[^\]]+\]\]/g, ' ').replace(/[^a-zа-я0-9 ]+/gi, ' ').split(/\s+/).filter(w => w.length >= 3);
  const grams = words => { const set = new Set(); for (let i = 0; i + 3 <= words.length; i++) set.add(words.slice(i, i + 3).join(' ')); return set; };
  const protectedText = [...(brief.terminology?.use || []).map(t => t.say), brief.cta?.main || '', brief.cta?.secondary || '', ...(brief.facts || []).map(f => f.wording)].join(' \n ');
  const protectedGrams = grams(norm(protectedText));
  const mine = grams(norm(blockPlainText(block)));
  const others = [];
  const blocksDir = path.join(pageDirPath, 'blocks');
  if (exists(blocksDir)) for (const f of fs.readdirSync(blocksDir)) {
    if (!/^B\d{2}-[a-z0-9-]+\.json$/.test(f) || f === path.basename(file)) continue;
    // блок с тем же block_id (временный вариант первого экрана против текущего первого экрана) - не сосед, а предшественник
    try { const ob = readJson(path.join(blocksDir, f)); if (ob.block_id !== block.block_id) others.push({ id: ob.block_id, grams: grams(norm(blockPlainText(ob))) }); } catch {}
  }
  const hits = [];
  for (const g of mine) {
    if (protectedGrams.has(g)) continue;
    const where = others.filter(o => o.grams.has(g)).map(o => o.id);
    if (where.length) hits.push({ g, where });
  }
  // склеиваем соседние 3-граммы в одну фразу, чтобы не плодить находки
  const seen = new Set();
  for (const h of hits.slice(0, 40)) {
    const key = h.g.split(' ').slice(0, 2).join(' ');
    if (seen.has(key)) continue;
    seen.add(key);
    if (seen.size > 6) break;
    addFinding(report, { page: slug, block_id: block.block_id, severity: 'major', category: 'repeat', rule: 'phrase.repeat', quote: h.g, problem: `фраза «${h.g}» уже звучит в ${[...new Set(h.where)].join(', ')}`, proposal: 'сказать это другим углом или сослаться одним словом; формулировка целиком звучит на странице один раз' });
  }
}
// CTA по блоку
if (spec) {
  if (spec.role === 'hero' && buttons !== 1) addFinding(report, { page: slug, block_id: block.block_id, severity: 'blocker', category: 'rule', rule: 'cta.hero-one', problem: `в первом экране должна быть ровно одна кнопка, найдено ${buttons}` });
  if (spec.role !== 'hero' && !spec.cta_allowed && !uiButtons && buttons > 0) addFinding(report, { page: slug, block_id: block.block_id, severity: 'blocker', category: 'rule', rule: 'cta.not-allowed', problem: 'кнопка в блоке, где CTA не предусмотрен брифом', proposal: 'убрать кнопку' });
  if (spec.role !== 'hero' && !uiButtons && buttons > 1) addFinding(report, { page: slug, block_id: block.block_id, severity: 'major', category: 'rule', rule: 'cta.one', problem: `в блоке ${buttons} кнопки`, proposal: 'оставить одну' });
  // назначенные возражения и факты
  for (const o of spec.objection_ids || []) if (!(block.objections_closed || []).includes(o)) addFinding(report, { page: slug, block_id: block.block_id, severity: 'major', category: 'coverage', rule: 'coverage.objection', problem: `возражение ${o} назначено блоку, но не отмечено закрытым`, proposal: 'закрыть возражение конкретным предложением и отметить в objections_closed' });
  // элементы по спеке
  const kinds = new Set(block.elements.map(e => e.kind));
  const specKinds = new Set(spec.elements.map(e => e.kind));
  for (const k of kinds) if (!specKinds.has(k)) addFinding(report, { page: slug, block_id: block.block_id, severity: 'major', category: 'structure', rule: 'structure.element-extra', problem: `элемент ${k} не предусмотрен шаблоном блока (разрешены: ${[...specKinds].join(', ')})`, proposal: 'убрать элемент или перенести его содержимое в разрешенный вид' });
  for (const e of spec.elements) if (!kinds.has(e.kind) && !/^0/.test(e.count)) addFinding(report, { page: slug, block_id: block.block_id, severity: 'major', category: 'structure', rule: 'structure.element-missing', problem: `в блоке нет элемента ${e.kind}, который требует шаблон типа страницы (count ${e.count})` });
  for (const e of spec.elements) {
    const range = String(e.count).match(/^(\d+)(?:-(\d+))?$/);
    if (range) {
      // для table_row и card считаем сами элементы (строки и карточки), для списков - пункты
      const n = block.elements.filter(x => x.kind === e.kind).reduce((s, x) => s + (x.items && !['table_row', 'card'].includes(x.kind) ? x.items.length : 1), 0);
      const lo = Number(range[1]), hi = Number(range[2] || range[1]);
      if (n && (n < lo || n > hi)) addFinding(report, { page: slug, block_id: block.block_id, severity: 'major', category: 'structure', rule: 'structure.count', problem: `${e.kind}: ${n} шт., шаблон требует ${e.count}` });
    }
  }
}
// формы ai.*, style.*, fact.claim-unsupported и бюджеты страницы (ai.contrast, ai.neg-pitch, word.overuse, placeholder.count).
// Бюджет расходуется в порядке блоков брифа: блоки выше этого + сам блок (lint-page.mjs считает так же по всей странице).
{
  const R = compileLint(rules, brief, cfg);
  const mine = scanBlock(block, R);
  const order = (brief.blocks || []).map(b => b.block_id);
  const pos = order.indexOf(block.block_id);
  const seq = [];
  for (const id of pos > 0 ? order.slice(0, pos) : []) {
    const f = path.join(pageDirPath, 'blocks', `${id}.json`);
    if (!exists(f)) continue;
    try { seq.push({ block_id: id, scan: scanBlock(readJson(f), R) }); } catch {}
  }
  seq.push({ block_id: block.block_id, scan: mine });
  // word.overuse при письме - minor: блок не блокируется, major по повторам слов ставит только lint-page.mjs
  const paged = applyPageBudgets(seq, R, block.block_id, { wordSeverity: 'minor' }).get(block.block_id) || [];
  for (const f of [...mine.findings, ...paged]) addFinding(report, { page: slug, block_id: block.block_id, ...f, auto_fixable: false });
}
finalizeVerdict(report);
if (a.fix) {
  // автофикс точек в конце коротких элементов
  for (const el of block.elements) for (const k of ['text']) if (['h1', 'h2', 'h3', 'button'].includes(el.kind) && typeof el[k] === 'string') el[k] = el[k].replace(/\.$/, '');
  writeJson(file, block);
}
// временный файл (B01-hero.tmp-w1.json, варианты турнира) пишет свой отчет и не затирает отчет настоящего блока
const tmpTag = path.basename(file, '.json').slice(block.block_id.length);
writeJson(P('work', 'audit', slug, `lint-${block.block_id}${/^\.[a-z0-9.-]+$/.test(tmpTag) ? tmpTag : ''}.json`), report);
if (!a.quiet) {
  console.log(`lint ${slug}/${block.block_id}: ${report.verdict} (${report.summary})`);
  for (const f of report.findings) {
    if (f.severity !== 'minor') console.log(` - [${f.severity}] ${f.rule}: ${f.problem}${f.quote ? ` | «${f.quote.slice(0, 90)}»` : ''}${f.proposal ? ` -> ${f.proposal}` : ''}`);
    else if (showMinor(f.rule)) console.log(` - [minor] ${f.rule}: ${f.problem}${f.quote ? ` | «${f.quote.slice(0, 60)}»` : ''}`);
  }
}
process.exit(report.verdict === 'pass' ? 0 : 1);
