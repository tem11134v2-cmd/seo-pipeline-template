// Аудит фазы 6 и отчет (пакет P4 программы 2026-09-28-audit-fixes). Запуск:
//   node .claude/tests/site-tekst/cases-audit.mjs      код выхода 0 - все прошли (или через run.mjs рядом).
// Все во временной папке (os.tmpdir()), без сети и данных клиентов; скрипты - из kit шаблона, воркфлоу - с подставными agent.
// Разделы: 1. fix-diff.mjs: снимок, откат блока, не прошедшего линтер (находка снова open), признак правок утверждений,
// снимок другого прогона, повтор с нетронутым блоком, журнал; retro-stats не считает журнал и снимки;
// 2. wf-06: порядок Р4 (судья и слепой -> один фиксер -> fix-diff -> круг 2 по правкам утверждений -> фиксер сужения),
// кросс-судья только когда есть что сравнивать, фиксеры кросса в режиме сужения; 3. wf-06b: снимок, сужение после судьи,
// сборка без проверок после сбоя build-html, timeout 600000; 4. dedup: пары родитель-ребенок, cross-digest --empty-report;
// 5. report: блоки pass/total и скелеты, «Правки без проверки судьей», факты оператора строками K11, разбор без конкурентов
// (K13), аудит ТЗ каталога и вопросы раздела 8 (K12); 6. промты и правила аудита (06-*, rules/auditor.md).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validate } from '../../skills/site-tekst/kit/scripts/lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const KIT = path.resolve(HERE, '..', '..', 'skills', 'site-tekst', 'kit');
let pass = 0, fail = 0;
const failures = [];
function check(name, ok, detail = '') {
  if (ok) pass++;
  else { fail++; failures.push(`FAIL ${name}${detail ? ': ' + String(detail).slice(0, 700) : ''}`); }
}
const rj = f => JSON.parse(fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, ''));
const wj = (f, o) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(o, null, 2) + '\n'); };
const wt = (f, s) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, s); };
const canon = v => JSON.stringify(v);
function run(cwd, args) {
  const r = spawnSync(process.execPath, args, { cwd, encoding: 'utf8' });
  return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '', out: (r.stdout || '') + (r.stderr || '') };
}
const lastJson = (out, tag) => { const m = String(out).match(new RegExp(`${tag} (\\{[^\\n]*\\})\\s*$`)); try { return m ? JSON.parse(m[1]) : null; } catch { return null; } };
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cases-audit-'));
function mkProject(name) {
  const dir = path.join(tmpRoot, name);
  for (const d of ['scripts', 'rules', 'schemas', 'config']) fs.cpSync(path.join(KIT, d), path.join(dir, d), { recursive: true });
  fs.mkdirSync(path.join(dir, 'work', 'audit'), { recursive: true });
  return dir;
}
const FINDINGS_SCHEMA = rj(path.join(KIT, 'schemas', 'findings.schema.json'));
// страница из блоков info, которые проходят настоящий линтер: [[id, [текст, ...]]]
function writePage(dir, slug, blocks, extra = {}) {
  wj(path.join(dir, 'work', 'pages', slug, 'brief.json'), { slug, url: `/${slug}`, type: 'info_other', segment: { id: 'S1', name: 'Семья' }, facts: [], cta: { main: 'Оставить заявку' },
    blocks: blocks.map(([id]) => ({ block_id: id, role: 'info', pattern: 'text', elements: [{ kind: 'h2', count: 1 }, { kind: 'text', count: '1-3' }] })), ...extra });
  for (const [id, texts] of blocks) writeBlock(dir, slug, id, texts);
}
function writeBlock(dir, slug, id, texts) {
  wj(path.join(dir, 'work', 'pages', slug, 'blocks', `${id}.json`), { block_id: id, type: 'text', elements: [{ kind: 'h2', text: texts[0] }, ...texts.slice(1).map(t => ({ kind: 'text', text: t }))],
    facts_used: [], objections_closed: [], summary: 'блок страницы для теста', handoff_note: '' });
}
const blockText = (dir, slug, id) => rj(path.join(dir, 'work', 'pages', slug, 'blocks', `${id}.json`)).elements.slice(1).map(e => e.text).join(' ');
const lintVerdict = (dir, slug, id) => { try { return rj(path.join(dir, 'work', 'audit', slug, `lint-${id}.json`)).verdict; } catch { return ''; } };

// ---------- воркфлоу с подставными хуками ----------
const AsyncFunction = (async () => {}).constructor;
const wfSource = name => fs.readFileSync(path.join(KIT, 'workflows', `${name}.js`), 'utf8');
function rolesOf(src) {
  const i = src.indexOf('const ROLES = {');
  const start = src.indexOf('{', i), end = src.indexOf('\n}', start);
  return new Function(`return (${src.slice(start, end + 2)})`)();
}
async function runWf(name, args, answer) {
  const calls = [], logs = [];
  const agent = async (prompt, opts = {}) => { calls.push({ label: opts.label || '', prompt: String(prompt), model: opts.model }); return answer(opts.label || '', String(prompt)); };
  const parallel = thunks => Promise.all(thunks.map(t => t()));
  const pipeline = (items, ...stages) => Promise.all(items.map(async (it, i) => { let r = it; for (const st of stages) r = await st(r, it, i); return r; }));
  const fn = new AsyncFunction('args', 'agent', 'parallel', 'pipeline', 'phase', 'log', 'workflow', 'budget', wfSource(name).replace(/^export const meta\s*=/m, 'const meta ='));
  let result = null, threw = '';
  try { result = await fn({ root: '/fake/root', model: 'M-STRONG', model_light: 'M-LIGHT', ...args }, agent, parallel, pipeline, () => {}, m => logs.push(m), async () => null, {}); } catch (e) { threw = e.stack || e.message; }
  return { calls, logs, result, threw, labels: calls.map(c => c.label) };
}
const RUNOK = tail => ({ ok: true, exit_code: 0, stdout_tail: tail });
const diffLine = o => RUNOK(`fix-diff p1: ...\nFIX_DIFF ${JSON.stringify({ claims_changed: false, no_snapshot: false, restored: [], page_lint: 'pass', snap_id: 's-next', ...o })}`);

try {
  // ================================================================== 1. fix-diff.mjs
  {
    const A = mkProject('fixdiff');
    const B1 = ['Как устроена работа', 'Вы выбираете удобный день. Мастер приезжает с образцами материалов.'];
    const B2 = ['Что входит в заказ', 'Замер помещения и подбор материалов по вашему бюджету.'];
    const B3 = ['Документы по заказу', 'Договор и смету вы получаете на руки до начала работ. Оплата после подписания акта.'];
    writePage(A, 'p1', [['B01-about', B1], ['B02-text', B2], ['B03-more', B3]]);
    const lp0 = run(A, ['scripts/lint-page.mjs', 'p1']);
    check('fix-diff: исходная страница проходит линтер (основа сценариев)', lp0.code === 0 && ['B01-about', 'B02-text', 'B03-more'].every(id => lintVerdict(A, 'p1', id) === 'pass'), lp0.out);
    const s1 = run(A, ['scripts/fix-diff.mjs', 'p1', '--snap']);
    const snap1 = lastJson(s1.out, 'FIX_SNAP');
    const snapMeta = rj(path.join(A, 'work', 'audit', 'p1', 'pre-fix', '_snap.json'));
    check('fix-diff --snap: копии блоков, _snap.json с id и lint, последняя строка FIX_SNAP', s1.code === 0 && !!snap1 && snap1.id === snapMeta.id && snap1.blocks === 3
      && ['B01-about', 'B02-text', 'B03-more'].every(id => fs.existsSync(path.join(A, 'work', 'audit', 'p1', 'pre-fix', `${id}.json`)) && snapMeta.blocks[id].lint === 'pass'), s1.out);

    // фиксер: B01 - правка предложения, B02 - число без факта (линтер не пройдет), B03 - потеря условия; находки закрыты
    writeBlock(A, 'p1', 'B01-about', [B1[0], 'Вы выбираете удобный день. Мастер приезжает с образцами материалов и каталогом.']);
    writeBlock(A, 'p1', 'B02-text', [B2[0], 'Замер помещения за 3 дня и подбор материалов по вашему бюджету.']);
    writeBlock(A, 'p1', 'B03-more', [B3[0], 'Договор и смету вы получаете на руки. Оплата после подписания акта.']);
    wj(path.join(A, 'work', 'audit', 'p1', 'round-1.json'), { scope: 'p1', producer: 'page-judge', round: 1, verdict: 'fix', summary: '', findings: [
      { id: 'r1', block_id: 'B02-text', severity: 'major', category: 'fact', rule: 'fact.scope', problem: 'x', status: 'fixed', resolution: 'добавлен срок' },
      { id: 'r2', block_id: 'B01-about', severity: 'major', category: 'weak', rule: 'weak', problem: 'y', status: 'fixed' },
      { id: 'r3', block_id: 'B03-more', severity: 'minor', category: 'fact', rule: 'fact.scope', problem: 'z', status: 'fixed' },
    ] });
    wj(path.join(A, 'work', 'audit', 'p1', 'blind.json'), { scope: 'p1', producer: 'blind-reader', verdict: 'fix', summary: '', findings: [{ id: 'b1', block_id: 'B01-about', severity: 'major', category: 'logic', rule: 'blind', problem: 'z', status: 'fixed' }] });
    const files = 'work/audit/p1/round-1.json,work/audit/p1/lint-page.json,work/audit/p1/blind.json';
    const d1 = run(A, ['scripts/fix-diff.mjs', 'p1', '--findings', files, '--mode', 'full', '--snap-id', snap1.id]);
    const j1 = lastJson(d1.out, 'FIX_DIFF');
    const r1 = rj(path.join(A, 'work', 'audit', 'p1', 'round-1.json'));
    check('fix-diff: код 0, последняя строка FIX_DIFF', d1.code === 0 && !!j1, d1.out);
    check('fix-diff: блок, который после правки не прошел линтер, возвращен из снимка и проходит', j1 && canon(j1.restored) === canon(['B02-text']) && blockText(A, 'p1', 'B02-text') === B2[1] && lintVerdict(A, 'p1', 'B02-text') === 'pass', d1.out);
    check('fix-diff: находка откатанного блока снова open с причиной, прочие не тронуты', r1.findings[0].status === 'open' && /^откат: правка не прошла линтер \(fact\.number-without-source/.test(r1.findings[0].resolution) && r1.findings[1].status === 'fixed' && j1.reopened === 1, JSON.stringify(r1.findings));
    check('fix-diff: измененное предложение и потеря условия - новые предложения, признак правок утверждений', j1.claims_changed === true && j1.new_sentences === 2 && j1.blocks_changed === 2 && j1.closed_blind === 1 && j1.closed_fact === 1, JSON.stringify(j1));
    const log1 = rj(path.join(A, 'work', 'audit', 'p1', 'fix-diff.json'));
    const run1 = log1.runs[log1.runs.length - 1];
    check('fix-diff: журнал - тексты новых предложений, after_round, файлы и режим', run1.after_round === 1 && run1.mode === 'full' && run1.new_sentences.some(s => s.block === 'B03-more' && /на руки\.$/.test(s.text)) && canon(run1.files) === canon(files.split(',')), JSON.stringify(run1).slice(0, 500));
    check('fix-diff: после сравнения новый снимок (другой id), основа следующего фиксера', j1.snap_id && j1.snap_id !== snap1.id && rj(path.join(A, 'work', 'audit', 'p1', 'pre-fix', '_snap.json')).id === j1.snap_id);
    checkSchemaFile('fix-diff: round-1.json после отката', path.join(A, 'work', 'audit', 'p1', 'round-1.json'));

    // только удаление целого предложения и перенос предложения в другой блок - не правка утверждений
    writeBlock(A, 'p1', 'B03-more', [B3[0], 'Договор и смету вы получаете на руки.']);
    writeBlock(A, 'p1', 'B01-about', [B1[0], 'Вы выбираете удобный день. Мастер приезжает с образцами материалов и каталогом. Оплата после подписания акта.']);
    wj(path.join(A, 'work', 'audit', 'p1', 'round-2.json'), { scope: 'p1', producer: 'page-judge', round: 2, verdict: 'fix', summary: '', findings: [{ id: 's1', block_id: 'B03-more', severity: 'major', category: 'repeat', rule: 'repeat', problem: 'x', status: 'fixed' }] });
    const d2 = run(A, ['scripts/fix-diff.mjs', 'p1', '--findings', 'work/audit/p1/round-2.json,work/audit/p1/lint-page.json', '--mode', 'narrow', '--snap-id', j1.snap_id]);
    const j2 = lastJson(d2.out, 'FIX_DIFF');
    check('fix-diff: удаление и перенос целого предложения - новых предложений нет, признак не выставлен', j2 && j2.claims_changed === false && j2.new_sentences === 0 && j2.blocks_changed === 2 && !j2.restored.length, d2.out);
    check('fix-diff: режим и круг в журнале (narrow, after_round 2)', (() => { const l = rj(path.join(A, 'work', 'audit', 'p1', 'fix-diff.json')); const r = l.runs[l.runs.length - 1]; return r.mode === 'narrow' && r.after_round === 2 && l.runs.length === 2; })());

    // снимок другого прогона: без отката, признак выставлен
    writeBlock(A, 'p1', 'B02-text', [B2[0], 'Замер помещения за 5 дней и подбор материалов.']);
    const d3 = run(A, ['scripts/fix-diff.mjs', 'p1', '--findings', 'work/audit/p1/round-2.json', '--snap-id', 'none']);
    const j3 = lastJson(d3.out, 'FIX_DIFF');
    check('fix-diff: --snap-id не совпал - «снимка нет»: без отката, признак правок выставлен', j3 && j3.no_snapshot === true && j3.claims_changed === true && !j3.restored.length && /5 дней/.test(blockText(A, 'p1', 'B02-text')) && /от другого прогона/.test(d3.out), d3.out);
    writeBlock(A, 'p1', 'B02-text', B2);
    run(A, ['scripts/lint-page.mjs', 'p1']);

    // повтор: фиксер вписал в верхний блок фразу нижнего нетронутого блока - правка откатывается, оба блока проходят
    const s4 = lastJson(run(A, ['scripts/fix-diff.mjs', 'p1', '--snap']).out, 'FIX_SNAP');
    const rep = 'Договор и смету вы получаете на руки.';
    writeBlock(A, 'p1', 'B01-about', [B1[0], `Вы выбираете удобный день. ${rep}`]);
    const d4 = run(A, ['scripts/fix-diff.mjs', 'p1', '--snap-id', s4.id]);
    const j4 = lastJson(d4.out, 'FIX_DIFF');
    check('fix-diff: повтор с нетронутым блоком - правка откатана, все блоки проходят линтер', j4 && canon(j4.restored) === canon(['B01-about']) && !blockText(A, 'p1', 'B01-about').includes(rep) && ['B01-about', 'B02-text', 'B03-more'].every(id => lintVerdict(A, 'p1', id) === 'pass'), d4.out);
    // интеграция (рецензия P4): снимок сам перелинтовывает страницу - блок, сломанный руками без lint-page, в снимке не pass,
    // и безобидная правка фиксера в другом блоке из-за него не откатывается
    writeBlock(A, 'p1', 'B03-more', [B3[0], 'Договор и смету вы получаете на руки за 3 дня до начала работ. Оплата после подписания акта.']);
    const s5 = lastJson(run(A, ['scripts/fix-diff.mjs', 'p1', '--snap']).out, 'FIX_SNAP');
    const snap5 = rj(path.join(A, 'work', 'audit', 'p1', 'pre-fix', '_snap.json'));
    const B1edit = 'Вы выбираете удобный день. Мастер приезжает с образцами материалов и каталогом.';
    writeBlock(A, 'p1', 'B01-about', [B1[0], B1edit]);
    const j5 = lastJson(run(A, ['scripts/fix-diff.mjs', 'p1', '--snap-id', s5.id]).out, 'FIX_DIFF');
    check('fix-diff --snap: вердикты по свежему lint-page - сломанный руками блок в снимке не pass, чужая правка не откатана', snap5.blocks['B03-more'].lint !== 'pass' && j5 && !j5.restored.length && blockText(A, 'p1', 'B01-about') === B1edit, JSON.stringify({ snap: snap5.blocks, j5 }));
    writeBlock(A, 'p1', 'B01-about', B1); writeBlock(A, 'p1', 'B03-more', B3); run(A, ['scripts/lint-page.mjs', 'p1']);
    // откат из-за нетронутого блока, сломанного бюджетом страницы (ai.contrast: 2 на страницу в порядке блоков), - только
    // правки выше него; правка ниже (удаление предложения) остается
    const C2 = ['Что входит в заказ', 'Замер помещения - не просто замер, а подбор материалов по вашему бюджету.'];
    writePage(A, 'p2', [['B01-about', B1], ['B02-text', C2], ['B03-more', B3]]);
    run(A, ['scripts/lint-page.mjs', 'p2']);
    const base6 = ['B01-about', 'B02-text', 'B03-more'].map(id => lintVerdict(A, 'p2', id)).join(',');
    const s6 = lastJson(run(A, ['scripts/fix-diff.mjs', 'p2', '--snap']).out, 'FIX_SNAP');
    writeBlock(A, 'p2', 'B01-about', [B1[0], 'Вы выбираете удобный день, а не мы. Мастер приезжает не просто так, а с образцами материалов.']);
    const B3cut = 'Договор и смету вы получаете на руки до начала работ.';
    writeBlock(A, 'p2', 'B03-more', [B3[0], B3cut]);
    const j6 = lastJson(run(A, ['scripts/fix-diff.mjs', 'p2', '--snap-id', s6.id]).out, 'FIX_DIFF');
    check('fix-diff: нетронутый блок сломан бюджетом страницы - откат только блока выше (B01), правка ниже (B03) остается', base6 === 'pass,pass,pass' && j6 && canon(j6.restored) === canon(['B01-about']) && /ломал блок B02-text/.test(JSON.stringify(rj(path.join(A, 'work', 'audit', 'p2', 'fix-diff.json')).runs.at(-1).restored)) && blockText(A, 'p2', 'B03-more') === B3cut && ['B01-about', 'B02-text', 'B03-more'].every(id => lintVerdict(A, 'p2', id) === 'pass'), `${base6} ${JSON.stringify(j6)}`);
    check('fix-diff: без slug - код 2, неизвестная страница - код 2', run(A, ['scripts/fix-diff.mjs']).code === 2 && run(A, ['scripts/fix-diff.mjs', 'nope']).code === 2);

    // retro-stats: журнал сравнений и снимки не отчеты с находками
    const rs = run(A, ['scripts/retro-stats.mjs']);
    const st = rj(path.join(A, 'work', 'audit', 'retro-stats.json'));
    check('retro-stats: fix-diff.json и pre-fix/ не читаются и не дают строк «пропущен»', rs.code === 0 && !st.files.skipped.some(s => /fix-diff|pre-fix/.test(s.file)) && !st.consistency.some(c => /fix-diff|pre-fix/.test(c)), JSON.stringify(st.files.skipped));
  }

  // ================================================================== 2. wf-06: порядок Р4 с подставными agent
  {
    const good = { hero_questions: 5, blocks_on_question: 1, objections_closed: 1, clonability: 5, flow: 5 };
    const judgeR = (findings, extra = {}) => ({ findings, verdict: findings.length ? 'fix' : 'pass', summary: 's', scores: good, lint_page: { verdict: 'pass', summary: 'ok' }, ...extra });
    const major = { severity: 'major', rule: 'weak', problem: 'x' };
    const FIXR = prompt => ({ slug: (prompt.match(/slug=([^;]+);/) || [])[1], fixed: 1, rejected: 0, left_open: 0, blocker_open: 0, lint: 'pass', page_lint: 'pass' });
    // o: judge1, judge2, blind, diff (по label), crossPre, cross
    const answer = (o = {}) => (label, prompt) => {
      if (/^judge:[^:]+:\d+$/.test(label)) { const n = Number(label.split(':')[2]); return n % 2 ? (o.judge1 ?? judgeR([major])) : (o.judge2 ?? judgeR([])); }
      if (/^blind:/.test(label)) return o.blind ?? { findings: [], verdict: 'pass', summary: 'b' };
      if (/^fix:/.test(label)) return FIXR(prompt);
      if (/^snap:/.test(label)) return RUNOK('FIX_SNAP {"id":"snap-1","blocks":3}');
      if (/^diff:/.test(label)) return 'diff' in o ? o.diff : diffLine({});
      if (label === 'cross-pre') return o.crossPre ?? RUNOK('CROSS_DIGEST {"nothing_to_judge":true,"pairs_to_judge":0,"geo_pages_written":0,"geo_leaks":0,"pending_pairs":2,"empty_report":true}');
      if (label === 'cross-judge') return o.cross ?? { findings: [], verdict: 'pass', summary: 'c' };
      return RUNOK('');
    };
    const P1 = [{ slug: 'p1', type: 'category', round: 1 }];

    const a = await runWf('wf-06-audit', { pages: P1, sample: ['p1'] }, answer({ diff: diffLine({ claims_changed: true, new_sentences: 2 }) }));
    const L = a.labels, at = l => L.indexOf(l);
    check('wf-06: прогон без исключений', !a.threw, a.threw);
    check('wf-06: судья и слепой читатель до фиксера, снимок перед фиксером, fix-diff после', at('judge:p1:1') >= 0 && at('blind:p1') >= 0 && at('blind:p1') < at('fix:p1') && at('snap:p1') < at('fix:p1') && at('fix:p1') < at('diff:p1'), L.join(', '));
    const f1 = a.calls.find(c => c.label === 'fix:p1');
    check('wf-06: один фиксер по round, lint-page и blind.json, режим full', /findings=work\/audit\/p1\/round-1\.json,work\/audit\/p1\/lint-page\.json,work\/audit\/p1\/blind\.json; mode=full/.test(f1.prompt), f1.prompt.slice(-200));
    check('wf-06: отдельного фиксера слепого читателя нет', !L.some(l => /^fix:p1:blind/.test(l)), L.join(', '));
    const j2 = a.calls.find(c => c.label === 'judge:p1:2');
    check('wf-06: правки утверждений - круг 2 (reason claims, prev, diff)', !!j2 && /reason=claims/.test(j2.prompt) && /prev=work\/audit\/p1\/round-1\.json/.test(j2.prompt) && /diff=work\/audit\/p1\/fix-diff\.json/.test(j2.prompt), j2 && j2.prompt.slice(-240));
    const dcall = a.calls.find(c => c.label === 'diff:p1');
    check('wf-06: fix-diff с теми же файлами, режимом и id снимка этого прогона', /fix-diff\.mjs p1 --findings work\/audit\/p1\/round-1\.json,work\/audit\/p1\/lint-page\.json,work\/audit\/p1\/blind\.json --mode full --snap-id snap-1/.test(dcall.prompt) && /timeout 600000/.test(dcall.prompt), dcall.prompt.slice(0, 300));

    const b = await runWf('wf-06-audit', { pages: P1, sample: [] }, answer({ judge2: judgeR([major]) }));
    const f2 = b.calls.find(c => c.label === 'fix:p1:2');
    check('wf-06: без правок утверждений и при хороших оценках - второго круга нет', !a.threw && !(await runWf('wf-06-audit', { pages: P1, sample: [] }, answer())).labels.includes('judge:p1:2'));
    check('wf-06: страница не в выборке - слепого нет, фиксер без blind.json', !b.labels.some(l => /^blind:/.test(l)) && !/blind\.json/.test(b.calls.find(c => c.label === 'fix:p1').prompt));
    const bScores = await runWf('wf-06-audit', { pages: P1, sample: [] }, answer({ judge1: judgeR([major], { scores: { ...good, flow: 2 } }), judge2: judgeR([major]) }));
    const fx2 = bScores.calls.find(c => c.label === 'fix:p1:2');
    check('wf-06: оценка ниже порога - круг 2 (reason scores), после него фиксер в режиме сужения по round-2 и lint-page', /reason=scores:flow/.test(bScores.calls.find(c => c.label === 'judge:p1:2').prompt) && !!fx2 && /findings=work\/audit\/p1\/round-2\.json,work\/audit\/p1\/lint-page\.json; mode=narrow/.test(fx2.prompt) && bScores.labels.includes('diff:p1:2'), bScores.labels.join(', '));
    check('wf-06: перед фиксером круга 2 снимок не повторяется (id из fix-diff)', !bScores.labels.includes('snap:p1:2') && /--snap-id s-next/.test(bScores.calls.find(c => c.label === 'diff:p1:2').prompt), bScores.labels.join(', '));
    check('wf-06: без правок утверждений f2 не звался', !f2);

    const c = await runWf('wf-06-audit', { pages: P1, sample: [] }, answer({ diff: null }));
    check('wf-06: fix-diff не ответил - круг 2 (проверить нечем); у круга 2 нет находок - фиксера сужения нет', /reason=claims/.test((c.calls.find(x => x.label === 'judge:p1:2') || {}).prompt || '') && !c.labels.includes('fix:p1:2'), c.labels.join(', '));
    const c2 = await runWf('wf-06-audit', { pages: P1, sample: [] }, answer({ diff: null, judge2: judgeR([major]) }));
    check('wf-06: id снимка неизвестен - снимок перед фиксером сужения', c2.labels.includes('snap:p1:2') && c2.labels.indexOf('snap:p1:2') < c2.labels.indexOf('fix:p1:2'), c2.labels.join(', '));
    const cl = await runWf('wf-06-audit', { pages: P1, sample: [] }, answer({ judge2: judgeR([], { lint_page: { verdict: 'fix', summary: 'major 1' } }), diff: diffLine({ page_lint: 'fix' }) }));
    check('wf-06: линтер страницы не pass после фиксера - круг 2 (reason lint), не pass в круге 2 - фиксер сужения', /reason=lint/.test((cl.calls.find(x => x.label === 'judge:p1:2') || {}).prompt || '') && cl.labels.includes('fix:p1:2'), cl.labels.join(', '));
    // интеграция (рецензия P4): фиксер сообщил blocker_open 0, но fix-diff откатил сломанный блок и снова открыл находки -
    // круг 2 (reason restored), иначе повторной попытки закрыть их сужением нет
    const rs = await runWf('wf-06-audit', { pages: P1, sample: [] }, answer({ judge2: judgeR([major]), diff: diffLine({ restored: ['B02-text'], reopened: 1 }) }));
    check('wf-06: откат fix-diff (reopened) - круг 2 (reason restored) и фиксер сужения', /reason=restored/.test((rs.calls.find(x => x.label === 'judge:p1:2') || {}).prompt || '') && rs.labels.includes('fix:p1:2'), rs.labels.join(', '));

    const bl = await runWf('wf-06-audit', { pages: P1, sample: ['p1'] }, answer({ judge1: judgeR([]), blind: { findings: [{ severity: 'major', rule: 'blind', problem: 'не понял' }], verdict: 'fix', summary: 'b' } }));
    check('wf-06: major только у слепого читателя - фиксер по всем файлам страницы', bl.labels.includes('fix:p1') && /blind\.json; mode=full/.test(bl.calls.find(x => x.label === 'fix:p1').prompt), bl.labels.join(', '));
    const clean = await runWf('wf-06-audit', { pages: P1, sample: ['p1'] }, answer({ judge1: judgeR([]), blind: { findings: [{ severity: 'minor', rule: 'blind', problem: 'мелочь' }], verdict: 'pass', summary: 'b' } }));
    check('wf-06: у судьи, линтера и слепого нет blocker/major - ни снимка, ни фиксера', !clean.labels.some(l => /^(snap|fix|diff):/.test(l)) && clean.result.judged[0].closed === 'judge' && clean.result.blind.length === 1, clean.labels.join(', '));

    // кросс: сравнивать нечего - судья не зовется; есть пары - судья, фиксер кросса в режиме сужения
    check('wf-06: к суду нечего - кросс-судьи нет, без split-cross --merge, итог в cross', a.labels.includes('cross-pre') && !a.labels.includes('cross-judge') && !/split-cross/.test(a.calls.find(x => x.label === 'render-md').prompt) && /кросс-судья не нужен/.test(a.result.cross || ''), a.labels.join(', '));
    const pre = a.calls.find(x => x.label === 'cross-pre');
    check('wf-06: проверка перед кросс-судьей - dedup и cross-digest --empty-report run-агентом', /node scripts\/dedup\.mjs && node scripts\/cross-digest\.mjs --empty-report/.test(pre.prompt) && pre.model === 'M-LIGHT');
    const crossAns = answer({ crossPre: RUNOK('CROSS_DIGEST {"nothing_to_judge":false,"pairs_to_judge":1}'), cross: { findings: [{ severity: 'major', rule: 'cross.repeat', problem: 'p', page: 'p1' }, { severity: 'major', rule: 'cross.repeat', problem: 'p', page: 'p2' }], verdict: 'fix', summary: 'c' } });
    const x = await runWf('wf-06-audit', { pages: [...P1, { slug: 'p2', type: 'category', round: 1 }], sample: [] }, (label, prompt) => (label === 'judge:p2:1' ? judgeR([]) : crossAns(label, prompt)));
    const xf = x.calls.find(y => y.label === 'fix:p1:cross');
    check('wf-06: есть пары - кросс-судья, фиксер кросса в режиме сужения по постраничному cross.json, fix-diff после', x.labels.includes('cross-judge') && !!xf && /findings=work\/audit\/p1\/cross\.json; mode=narrow/.test(xf.prompt) && x.labels.includes('diff:p1:cross'), x.labels.join(', '));
    check('wf-06: снимок перед фиксером кросса - только у страницы без снимка этого прогона', !x.labels.includes('snap:p1:cross') && x.labels.includes('snap:p2:cross') && x.labels.indexOf('snap:p2:cross') < x.labels.indexOf('fix:p2:cross'), x.labels.join(', '));
    check('wf-06: кросс-судья был - в конце split-cross --merge, render-md, lint-page страниц', /split-cross\.mjs --merge; node scripts\/render-md\.mjs; node scripts\/lint-page\.mjs p1; node scripts\/lint-page\.mjs p2/.test(x.calls.find(y => y.label === 'render-md').prompt));
    const crossBroken = await runWf('wf-06-audit', { pages: P1, sample: [] }, answer({ crossPre: RUNOK('dedup упал') }));
    check('wf-06: проверка перед кросс-судьей не дала строку CROSS_DIGEST - кросс-судья зовется', crossBroken.labels.includes('cross-judge'), crossBroken.labels.join(', '));
    const skip = await runWf('wf-06-audit', { pages: P1, sample: [], skipCross: true }, answer());
    check('wf-06: skipCross - ни проверки, ни судьи', !skip.labels.includes('cross-pre') && !skip.labels.includes('cross-judge'));

    // модели по ролям: новые вызовы - run (light)
    const roles = rolesOf(wfSource('wf-06-audit'));
    const runCalls = a.calls.filter(y => /^(snap|diff):|^cross-pre$|^render-md$/.test(y.label));
    check('wf-06: снимок, fix-diff и проверка кросса - роль run (light)', roles.run === 'light' && runCalls.length >= 4 && runCalls.every(y => y.model === 'M-LIGHT'), runCalls.map(y => `${y.label}=${y.model}`).join(', '));
    check('wf-06: фиксер и судьи - strong', a.calls.filter(y => /^(fix|judge|blind):/.test(y.label)).every(y => y.model === 'M-STRONG'));
  }

  // ================================================================== 3. wf-06b
  {
    const ans = (o = {}) => label => {
      if (/^snap:/.test(label)) return RUNOK('FIX_SNAP {"id":"b-1","blocks":2}');
      if (/^diff:/.test(label)) return diffLine({});
      if (/^fix:/.test(label)) return { slug: 'p1', fixed: 1, rejected: 0, left_open: 0, blocker_open: 0, lint: 'pass', page_lint: 'pass' };
      if (/^judge:/.test(label)) return o.judge ?? { findings: [{ severity: 'major', rule: 'weak', problem: 'x' }], verdict: 'fix', summary: 's', scores: {} };
      return RUNOK('build-html: ok');
    };
    const w = await runWf('wf-06b-fix-repeats', { slug: 'p1', findings: ['work/audit/p1/human-1.json'] }, ans());
    const L = w.labels;
    check('wf-06b: снимок -> фиксер (full) -> fix-diff -> судья -> фиксер сужения -> fix-diff -> сборка', !w.threw && canon(L) === canon(['snap:p1', 'fix:1', 'diff:p1:1', 'judge:3', 'fix:2', 'diff:p1:2', 'build']), w.threw || L.join(', '));
    check('wf-06b: fix:1 - mode=full, fix:2 - mode=narrow по round-3 и lint-page', /human-1\.json; mode=full/.test(w.calls[1].prompt) && /findings=work\/audit\/p1\/round-3\.json,work\/audit\/p1\/lint-page\.json; mode=narrow/.test(w.calls[4].prompt));
    const bp = w.calls.find(c => c.label === 'build').prompt;
    check('wf-06b: проверки и отчет только после кода 0 build-html; timeout 600000', /node scripts\/build-html\.mjs && \{ node scripts\/check-html\.mjs; node scripts\/check-site-js\.mjs; node scripts\/report\.mjs; \}/.test(bp) && /timeout 600000/.test(bp) && !/split-cross/.test(bp), bp.slice(0, 400));
    const wc = await runWf('wf-06b-fix-repeats', { slug: 'p1', findings: ['work/audit/p1/cross.json'], skipJudge: true }, ans());
    check('wf-06b: findings с постраничным cross.json - split-cross --merge в сборке; skipJudge - без судьи', /split-cross\.mjs --merge; node scripts\/build-html\.mjs/.test(wc.calls.find(c => c.label === 'build').prompt) && !wc.labels.some(l => /^judge/.test(l)), wc.labels.join(', '));
    const roles = rolesOf(wfSource('wf-06b-fix-repeats'));
    check('wf-06b: ROLES - build и run light, fixer и judge strong; снимок и fix-diff на light', roles.build === 'light' && roles.run === 'light' && roles.fixer === 'strong' && roles.judge === 'strong' && w.calls.filter(c => /^(snap|diff):/.test(c.label)).every(c => c.model === 'M-LIGHT'), JSON.stringify(roles));
  }

  // ================================================================== 4. dedup: родитель-ребенок, cross-digest --empty-report
  {
    const D = mkProject('parent');
    const pg = (slug, url, type, parent, extra = {}) => ({ slug, url, type, subject: slug, parent, level: parent ? 1 : 0, segment: 'S1', status: 'briefed', ...extra });
    wj(path.join(D, 'work', 'sitemap.json'), { pages: [
      pg('home', '/', 'home', ''), pg('uslugi', '/uslugi/', 'hub', ''), pg('remont', '/uslugi/remont/', 'service', '/uslugi/'),
      pg('dizajn', '/uslugi/dizajn', 'service', '/uslugi'), pg('about', '/about', 'info_about', '/'), pg('poisk', '/uslugi/poisk', 'info_other', '/uslugi', { ui_role: 'search' }),
      pg('tovar', '/uslugi/{slug}', 'product', '/uslugi', { template: true }),
      // интеграция (рецензия P4): старая карта без флага template - шаблон по адресу с [...] или {...}
      pg('kartochka', '/uslugi/[id]', 'product', '/uslugi'), pg('kartochka-2', '/uslugi/{slug}-2', 'product', '/uslugi'),
    ] });
    const texts = { home: 'Главная про ремонт и дизайн квартир', uslugi: 'Все услуги студии в одном месте', remont: 'Ремонт квартир с отделкой', dizajn: 'Дизайн интерьера квартиры', about: 'О студии и команде' };
    for (const [s, t] of Object.entries(texts)) writePage(D, s, [['B01-about', ['Раздел', t]]]);
    const dd = run(D, ['scripts/dedup.mjs']);
    const ddj = rj(path.join(D, 'work', 'audit', 'dedup.json'));
    const par = ddj.pairs.filter(p => p.reasons.includes('parent')).map(p => `${p.a}~${p.b}:${p.parent_page}`).sort();
    check('dedup: пары родитель-ребенок по карте (слеш на конце не мешает), главная, поиск и шаблон - нет', dd.code === 0 && canon(par) === canon(['dizajn~uslugi:uslugi', 'remont~uslugi:uslugi']), par.join(', '));
    check('dedup: сводка пар с родителем-ребенком', /родитель-ребенок 2/.test(ddj.pairs_summary), ddj.pairs_summary);
    const cd = run(D, ['scripts/cross-digest.mjs', '--max-pairs', '0', '--empty-report']);
    const cdj = rj(path.join(D, 'work', 'audit', 'cross-digest.json'));
    const line = lastJson(cd.out, 'CROSS_DIGEST');
    check('cross-digest: пары родитель-ребенок не режутся --max-pairs, к суду есть что - отчет не пишется', cdj.counts.pairs_to_judge === 2 && line && line.nothing_to_judge === false && !fs.existsSync(path.join(D, 'work', 'audit', 'cross.json')), cd.out);

    // одна рабочая страница: к суду нечего - пустой отчет, прежние постраничные копии уходят в архив
    const E = mkProject('empty');
    wj(path.join(E, 'work', 'sitemap.json'), { pages: [pg('home', '/', 'home', '')] });
    writePage(E, 'home', [['B01-about', ['Раздел', 'Главная про ремонт']]]);
    wj(path.join(E, 'work', 'audit', 'cross.json'), { scope: 'cross', producer: 'cross-judge', created_at: '2026-09-20T10:00:00Z', verdict: 'fix', summary: '', findings: [{ id: 'o1', page: 'home', block_id: 'B01-about', severity: 'major', category: 'repeat', rule: 'cross.repeat', problem: 'старая', status: 'open' }] });
    run(E, ['scripts/split-cross.mjs']);
    run(E, ['scripts/dedup.mjs']);
    const ce = run(E, ['scripts/cross-digest.mjs', '--empty-report']);
    const le = lastJson(ce.out, 'CROSS_DIGEST');
    const cr = rj(path.join(E, 'work', 'audit', 'cross.json'));
    check('cross-digest --empty-report: к суду нечего - пустой cross.json кросс-судьи, строка CROSS_DIGEST последней', le && le.nothing_to_judge === true && le.empty_report === true && cr.producer === 'cross-judge' && cr.findings.length === 0 && cr.verdict === 'pass' && /к суду нечего/.test(cr.summary), ce.out);
    check('cross-digest --empty-report: отчет по схеме findings', !validate(FINDINGS_SCHEMA, cr).length, validate(FINDINGS_SCHEMA, cr).join('; '));
    const homeFiles = fs.readdirSync(path.join(E, 'work', 'audit', 'home'));
    check('cross-digest --empty-report: прежняя постраничная копия в архиве, прежний общий отчет в архиве dedup', !homeFiles.includes('cross.json') && homeFiles.some(f => /^cross-archive-20260920T100000Z\.json$/.test(f)) && fs.readdirSync(path.join(E, 'work', 'audit')).includes('cross-archive-20260920T100000Z.json'), homeFiles.join(', '));
    const noFlag = run(E, ['scripts/cross-digest.mjs']);
    check('cross-digest без --empty-report: к суду нечего, но отчет не пишется', lastJson(noFlag.out, 'CROSS_DIGEST').empty_report === false && /пар-кандидатов 0/.test(noFlag.out));
  }

  // ================================================================== 5. report
  {
    const R = mkProject('report');
    const mp = (slug, type, i, extra = {}) => ({ slug, url: i ? `/${slug}` : '/', type, subject: slug, parent: i ? '/' : '', level: i ? 1 : 0, segment: 'S1', status: 'briefed', ...extra });
    wj(path.join(R, 'work', 'sitemap.json'), { pages: [mp('home', 'home', 0), mp('c1', 'category', 1, { listing: true }), mp('c2', 'category', 2)] });
    wj(path.join(R, 'work', 'facts.json'), { facts: [
      { id: 'F01', label: 'Срок', value: '3 дня', wording: 'за 3 дня', publish: 'yes', kind: 'number', source_quote: 'делаем за три дня' },
      { id: 'F801', label: 'Скидка = постоянным', value: '10%', wording: 'скидка 10%', publish: 'yes', kind: 'number', source_quote: 'постоянным даем скидку 10 процентов', source: 'оператор: 2026-09-27 письмо заказчика' },
      { id: 'F802', label: 'Выезд', value: 'бесплатно по городу', wording: 'выезд бесплатно', publish: 'yes', kind: 'claim', source_quote: 'коротко', source: 'оператор: 2026-09-28 звонок' },
      { id: 'F40', label: 'Самовывоз', value: 'со склада', wording: 'самовывоз со склада', publish: 'yes', kind: 'claim', source_quote: 'можно забрать << со склада сами', source: 'оператор: 2026-09-28 чат' },
    ], gaps: [] });
    for (const s of ['home', 'c1', 'c2']) writePage(R, s, [['B01-about', ['Раздел', `Текст страницы ${s}`]], ['B02-text', ['Раздел два', `Второй блок ${s}`]]]);
    for (const s of ['home', 'c1', 'c2']) for (const id of ['B01-about', 'B02-text']) wj(path.join(R, 'work', 'audit', s, `lint-${id}.json`), { verdict: 'pass', findings: [] });
    // c2: второй блок сломан (скелет), не exhausted
    wj(path.join(R, 'work', 'audit', 'c2', 'lint-B02-text.json'), { verdict: 'fix', findings: [{ severity: 'major', rule: 'fact.unknown', problem: 'x' }] });
    // журналы fix-diff: home - круг 2 после прохода (проверено), c1 - сужение после последнего круга, c2 - без снимка
    wj(path.join(R, 'work', 'audit', 'home', 'round-1.json'), { findings: [] });
    wj(path.join(R, 'work', 'audit', 'home', 'round-2.json'), { findings: [] });
    wj(path.join(R, 'work', 'audit', 'home', 'fix-diff.json'), { slug: 'home', runs: [{ mode: 'full', after_round: 1, blocks_changed: ['B01-about'], new_sentences: [{ block: 'B01-about', text: 'Проверенная правка первого круга.' }], restored: [] }] });
    wj(path.join(R, 'work', 'audit', 'c1', 'round-1.json'), { findings: [] });
    wj(path.join(R, 'work', 'audit', 'c1', 'round-2.json'), { findings: [] });
    wj(path.join(R, 'work', 'audit', 'c1', 'fix-diff.json'), { slug: 'c1', runs: [
      { mode: 'full', after_round: 1, blocks_changed: ['B01-about'], new_sentences: [{ block: 'B01-about', text: 'Правка до второго круга.' }], restored: [] },
      { mode: 'narrow', after_round: 2, blocks_changed: ['B01-about', 'B02-text'], new_sentences: [{ block: 'B01-about', text: 'Гарантия 12 месяцев на работы.' }], restored: [{ block: 'B03-x', rules: 'fact.number-without-source' }] },
    ] });
    wj(path.join(R, 'work', 'audit', 'c2', 'fix-diff.json'), { slug: 'c2', runs: [{ mode: 'narrow', after_round: 0, no_snapshot: true, blocks_changed: [], new_sentences: [], restored: [] }] });
    // K13: лидеры недоступны, тип category собран без конкурентов
    wj(path.join(R, 'work', 'competitors', 'competitors.json'), { verified_at: 'x', degraded: 'no_competitors', competitors: [] });
    wj(path.join(R, 'work', 'page-types', 'category.json'), { type: 'category', sources: [], notes: 'без конкурентов: собран по анализу', market_blocks: [], differentiation_blocks: [], recommended_order: [], cliches_to_avoid: [] });
    wj(path.join(R, 'work', 'page-types', 'home.json'), { type: 'home', sources: [{ domain: 'a.ru', url: 'https://a.ru/', raw: 'x', status: 'ok' }], market_blocks: [], differentiation_blocks: [], recommended_order: [], cliches_to_avoid: [] });
    // K12: аудит ТЗ - одна major fixed, одна major open, одна minor без status; раздел 8 - таблица из 3 строк и пункт списка
    wj(path.join(R, 'work', 'audit', 'catalog-tz.json'), { scope: 'catalog', producer: 'catalog-auditor', round: 2, verdict: 'fix', summary: '', findings: [
      { id: 't1', severity: 'major', category: 'structure', rule: 'tz.x', problem: 'a', status: 'fixed' },
      { id: 't2', severity: 'major', category: 'structure', rule: 'tz.y', problem: 'b', status: 'open' },
      { id: 't3', severity: 'minor', category: 'structure', rule: 'tz.z', problem: 'c' },
    ] });
    wt(path.join(R, 'work', 'catalog', 'tz.md'), '# ТЗ\n\n## 7. Прочее\n\n- не вопрос\n\n## 8. Открытые вопросы\n\n| N | Вопрос | Кому |\n|---|---|---|\n| 8.1 | Какие металлы | заказчику |\n| 8.2 | Оплата на сайте | заказчику |\n| 8.3 | Куда уходят заявки | заказчику |\n\n- Индексация фильтров\n\n## 9. Дальше\n\n- тоже не вопрос\n');
    const r = run(R, ['scripts/report.mjs']);
    const md = fs.readFileSync(path.join(R, 'work', 'output', 'report.md'), 'utf8');
    const sectionOf = h => { const i = md.indexOf(`## ${h}`); if (i < 0) return ''; const j = md.indexOf('\n## ', i + 3); return md.slice(i, j < 0 ? undefined : j); };
    // правок без проверки: 1 предложение c1 + 1 проход c2 без снимка (интеграция, рецензия P4: проход без сравнения входит
    // в число, иначе в самом опасном случае K = 0 и оркестратор не предупредит оператора)
    check('report: код 0; итог в консоли - блоки pass/total, скелеты, правки без проверки судьей, каталог', r.code === 0 && /блоков 5\/6, скелетов 1, exhausted 0/.test(r.stdout) && /правок без проверки судьей 2/.test(r.stdout) && /каталог: ТЗ открыто blocker\/major 0\/1, вопросов раздела 8 4/.test(r.stdout), r.out.slice(0, 600));
    const sum = sectionOf('Сводка');
    check('report: сводка - скелеты в прототипе (не написан или сломан правкой), разбор без конкурентов, правки без проверки', /Блоков прошли линтер: 5 из 6; скелетов в прототипе: 1 \(exhausted 0, не написаны или не прошли линтер после правки 1\)/.test(sum) && /Разбор лидеров: без конкурентов[^\n]*category/.test(sum) && !/Разбор лидеров:[^\n]*home/.test(sum) && /Правки фиксеров без проверки судьей: новых или измененных предложений 1 в 1 блоках, страниц 2, проходов без сравнения 1, откатов 1/.test(sum), sum);
    const un = sectionOf('Правки без проверки судьей');
    check('report: «Правки без проверки судьей» - последний проход после последнего круга, удаления, откат, без снимка', /c1\/B01-about: новые или измененные предложения \(1\): «Гарантия 12 месяцев на работы\.» \(фиксер в режиме сужения, после круга 2\)/.test(un)
      && /c1: только удаления или перестановки: B02-text/.test(un) && /c1\/B03-x: откат правки фиксера \(не прошла линтер: fact\.number-without-source\)/.test(un) && /c2: правки фиксера не сравнены - снимка до правки не было/.test(un), un);
    check('report: проход, после которого был круг судьи, не выводится', !/Проверенная правка первого круга|Правка до второго круга/.test(un), un);
    const held = sectionOf('Не подтверждено или снято');
    const block = (held.match(/```text\n([\s\S]*?)\n```/) || [])[1] || '';
    const lines = block.split('\n');
    check('report: факты оператора строками K11 в блоке для листа ответов', lines.includes('F801: Скидка - постоянным = 10% << постоянным даем скидку 10 процентов') && lines.includes('F802: Выезд = бесплатно по городу') && lines.includes('+: Самовывоз = со склада << можно забрать « со склада сами') && lines.length === 3, block);
    check('report: у фактов оператора основание и подсказка про input/ анализа', /F801 «Скидка = постоянным»: оператор: 2026-09-27 письмо заказчика/.test(held) && /answers-N\.txt/.test(held) && /input\//.test(held), held);
    const ask = sectionOf('Что спросить у заказчика');
    check('report: разбор без конкурентов - вопрос заказчику о сайтах-ориентирах (весь сайт)', /- Сайты лидеров ниши не открылись: назовите 2-3 сайта-ориентира[^\n]*\(весь сайт\)/.test(ask), ask);
    check('report: вопросы раздела 8 ТЗ в «Что спросить» не копируются', !/металлы|Оплата на сайте|Индексация/.test(ask), ask);
    const cat = sectionOf('Каталог');
    check('report: каталог - аудит ТЗ по статусам (нет status - open) и число вопросов раздела 8', /Аудит ТЗ \(круг 2\): открыто blocker\/major\/minor 0\/1\/1/.test(cat) && /Открытые вопросы ТЗ \(раздел 8\): 4 - они в документе ТЗ/.test(cat), cat);
    // старая задача: журналов нет, раздел честно пустой
    for (const s of ['home', 'c1', 'c2']) fs.rmSync(path.join(R, 'work', 'audit', s, 'fix-diff.json'));
    fs.rmSync(path.join(R, 'work', 'competitors'), { recursive: true });
    fs.rmSync(path.join(R, 'work', 'page-types'), { recursive: true });
    const r2 = run(R, ['scripts/report.mjs']);
    const md2 = fs.readFileSync(path.join(R, 'work', 'output', 'report.md'), 'utf8');
    check('report: без fix-diff.json - «сравнений правок фиксера нет», без строк сводки о правках и лидерах', r2.code === 0 && /## Правки без проверки судьей\n- сравнений правок фиксера нет/.test(md2) && !/Правки фиксеров без проверки|Разбор лидеров/.test(md2) && !/Сайты лидеров ниши/.test(md2), md2.slice(0, 900));
  }

  // ================================================================== 6. промты и правила аудита
  {
    const read = rel => fs.readFileSync(path.join(KIT, rel), 'utf8');
    const fixer = read('prompts/06-fixer.md'), judge = read('prompts/06-page-judge.md'), blind = read('prompts/06-blind-reader.md');
    const cross = read('prompts/06-cross-judge.md'), aud = read('rules/auditor.md');
    check('06-fixer: параметр mode и раздел режима сужения', /`mode`: `full`/.test(fixer) && /## Режим сужения \(`mode=narrow`\)/.test(fixer) && /вернуть условие факта/.test(fixer) && /«в отчет: режим сужения»/.test(fixer));
    check('06-fixer: гео-клон в режиме сужения - только wording факта брифа, иначе needs_fact', /Гео-клон - только wording факта брифа с id, иначе `needs_fact`/.test(fixer));
    check('06-fixer: откат блока из снимка pre-fix, находка open', fixer.includes('work/audit/<slug>/pre-fix/<block_id>.json') && /откат: правка не проходит линтер/.test(fixer));
    check('06-fixer: proposal слепого - потребность, не текст; отказ от сужения до одного сегмента', /Proposal слепого читателя - потребность, не текст/.test(fixer) && /до одного сегмента или сценария/.test(fixer) && /предмет H1 не меняй/.test(fixer));
    check('06-fixer: proposal судьи для fact и repeat - операция, нет «не удалением фразы» и «второго судьи может не быть»', /для fact и repeat - операция/.test(fixer) && !/не удалением фразы/.test(fixer) && !/второго судьи после тебя может не быть/.test(fixer));
    check('06-page-judge: proposal - операция, п. 2 - major coverage с block_id', /Proposal - операция: «подставить wording F\.\.»/.test(judge) && /не отвечает - major, category\s+coverage, с `block_id`/.test(judge) && /для fact и repeat -\s+операция/.test(judge));
    check('06-page-judge: reason restored (интеграция: откат fix-diff назначает круг 2) описан в параметрах', /`restored` - правку фиксера откатили/.test(judge));
    check('06-page-judge: п. 9 - удалить или сослаться, reason claims и lint, параметр diff', /где оставить, а где удалить или сослаться одним словом/.test(judge) && !/переписать другим углом/.test(judge) && /`claims` - фиксер добавил или изменил/.test(judge) && /`diff` - журнал `fix-diff\.json`/.test(judge));
    check('06-blind-reader: major - только «не понял» и противоречие первого экрана; coverage - needs_fact; proposal - потребность', /Severity major -\s+только «не понял» на вопрос первых 5 секунд и противоречие первого экрана/.test(blind) && /У coverage\s+`needs_fact: true`/.test(blind) && /потребность простыми словами, не текст/.test(blind));
    check('06-cross-judge: пары parent судятся всегда; proposal повтора - операция', /`parent` - родитель \(`parent_page`\) и дочерняя страница: судятся всегда/.test(cross) && /Proposal - операция: удалить повтор, сослаться одним словом/.test(cross));
    check('rules/auditor.md: шкала первого экрана - 5 вопросов, шестой - при факте', /^5 вопросов читателя/m.test(aud) && !/6 вопрос/.test(aud) && /новое или старое \(признак актуальности\)/.test(aud));
    check('rules/auditor.md: неответивший блок - major; blocker - выдумка, две кнопки, антиобещание', /- blocker: выдуманный факт, две кнопки в первом экране, обещание из anti_promises\./.test(aud) && /- major: блок не отвечает на свой вопрос \(coverage\)/.test(aud) && /Нет ответа - major на страницу/.test(aud));
    // стиль файлов пакета: без буквы е с точками и длинных тире
    for (const rel of ['prompts/06-fixer.md', 'prompts/06-page-judge.md', 'prompts/06-blind-reader.md', 'prompts/06-cross-judge.md', 'rules/auditor.md', 'workflows/wf-06-audit.js', 'workflows/wf-06b-fix-repeats.js',
      'scripts/fix-diff.mjs', 'scripts/report.mjs', 'scripts/dedup.mjs', 'scripts/cross-digest.mjs', 'scripts/retro-stats.mjs']) {
      const t = read(rel);
      check(`${rel}: без буквы е с точками и длинных тире`, !/[\u0451\u0401\u2014\u2013]/.test(t), (t.split('\n').findIndex(l => /[\u0451\u0401\u2014\u2013]/.test(l)) + 1) + '');
    }
  }
} catch (e) {
  fail++; failures.push(`FAIL исключение: ${e.stack || e.message}`);
} finally {
  if (process.env.SITE_TEKST_TEST_KEEP === '1') console.log(`песочница оставлена: ${tmpRoot}`);
  else fs.rmSync(tmpRoot, { recursive: true, force: true });
}

function checkSchemaFile(label, file) { const e = validate(FINDINGS_SCHEMA, rj(file)); check(`${label} проходит схему findings`, !e.length, e.slice(0, 3).join('; ')); }

failures.forEach(f => console.log(f));
console.log(`cases-audit: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
