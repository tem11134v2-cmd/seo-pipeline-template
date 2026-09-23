// Статистика находок аудита для ретро проекта (шаг T2). Без LLM. Запуск из корня проекта:
//   node scripts/retro-stats.mjs
// Вход: work/audit/**/*.json - любые отчеты с массивом findings (формы у производителей разные: лишнее пропускается,
//       отсутствующие поля считаются пустыми); work/facts.json -> gaps (если есть); наличие
//       work/pages/<slug>/blocks/<id>.json (только чтобы найти устаревшие отчеты линтера).
// Выход: work/audit/retro-stats.json и сводка в консоль (не больше 30 строк). Код выхода 0, даже если данных нет.
import fs from 'node:fs';
import path from 'node:path';
import { P, walk, exists, nowIso } from './lib.mjs';

const AUDIT = P('work', 'audit');
const OUT = path.join(AUDIT, 'retro-stats.json');
const IGNORE = new Set(['retro-stats.json', 'cross-digest.json']);
const MACHINE = new Set(['lint', 'dedup', 'html-check', 'layout-validator']);
const JUDGES = new Set(['page-judge', 'blind-reader', 'cross-judge']);
const SEV = ['blocker', 'major', 'minor'];
const OPEN = new Set(['open', 'new', 'pending', 'todo']);
const NOTE_FIELDS = ['fix_note', 'resolution', 'fixer_note', 'reject_reason', 'reason', 'answer', 'comment', 'note'];
const NO_FACT_RE = /(нет|без)\s+(подтвержденного\s+|такого\s+)?факт|факт(а|ов)?\s+(нет|не\s+хватает|отсутству)|в\s+(брифе|brief[\w.]*|фактах|facts[\w.]*|паспорте\s+фактов)[^.;]{0,60}?\sнет\b|нет\s+в\s+(брифе|brief|фактах|facts)|не\s+подтвержд/i;
const ASK_RE = /запрос\w*\s+у\s+заказчика|запросить\s+у\s+заказчика|у\s+заказчика\s+нужно\s+запросить/i;
const STOP = new Set('для что это как или все его так там уже при без над под вас вам ваш вашу ваши они она оно чем где кто еще него них нет есть был была были будет быть которые который которая только тоже этот эта эти того этом the and'.split(' '));

// ---------- помощники ----------
const inc = (m, k, n = 1) => { m[k] = (m[k] || 0) + n; return m; };
const topN = (m, n) => Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, n);
const fmt = (m, n = 6) => topN(m, n).map(([k, v]) => `${k} ${v}`).join(', ') || '-';
const clip = (s, n) => { s = String(s ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 3) + '...' : s; };
const str = v => Array.isArray(v) ? v.filter(x => typeof x === 'string').join(' | ') : typeof v === 'string' ? v : '';
const isSerious = f => f.severity === 'blocker' || f.severity === 'major';
const isOpen = f => OPEN.has(f.status);
const blockKey = id => String(id || '').replace(/^B\d+[a-z]?[-_]/i, '').toLowerCase();

function normQuote(q) {
  return String(q || '').toLowerCase().replace(/ё/g, 'е').replace(/[*_#`>]+/g, ' ').replace(/[«»"„“”]/g, '')
    .replace(/[—–]/g, '-').replace(/\s+/g, ' ').trim().replace(/[\s.,;:!?-]+$/, '');
}
// «цитаты», которые не текст страницы: перечень id фактов, JSON-фрагменты
const isPseudo = (raw, q) => !q || /^(факты|facts)\s*:/.test(q) || /^\s*[{[]/.test(raw) || /^\s*"[\w.-]+"\s*:/.test(raw);

function ruleInfo(rule, producer) {
  const raw = String(rule || '').replace(/\s+/g, ' ').trim();
  if (!raw) return { key: `${producer}: (без правила)`, family: '(без правила)', naming: 'none' };
  let m = raw.match(/^(\d+)\s*[.)]\s*/);
  if (m) return { key: `${producer} п.${m[1]}`, family: `п.${m[1]}`, naming: 'number' };
  if (/^[a-z][a-z0-9_.-]*$/i.test(raw)) return { key: raw.toLowerCase(), family: raw.toLowerCase(), naming: 'id' };
  m = raw.match(/^([a-z][a-z0-9_.-]*)(?=\s*[:/(,]|\s)/i);
  const text = raw.toLowerCase().replace(/ё/g, 'е').replace(/\s*-\s*(blocker|major|minor)$/, '').slice(0, 90);
  if (m) return { key: text, family: m[1].toLowerCase(), naming: 'id+text' };
  return { key: text, family: text.split(' ').slice(0, 3).join(' '), naming: 'text' };
}

function resolutionText(f) {
  const parts = NOTE_FIELDS.map(k => str(f[k])).filter(Boolean);
  const pr = str(f.proposal);
  const m = pr.match(/\|\s*(ответ|отказ|фиксер)[^:|]*:\s*([\s\S]+)$/i);
  if (m) parts.push(m[2]);
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}
function gapText(res) {
  const m = res.match(/нет\s+факта\s*[:.]\s*([\s\S]+)/i);
  const s = m ? m[1] : (res.split(/(?<=[.;])\s+/).find(x => NO_FACT_RE.test(x)) || res);
  return clip(s.split(/(?<=[.;])\s+/)[0], 180);
}

function readJsonSafe(file) {
  try { return { data: JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')) }; }
  catch (e) { return { error: 'невалидный JSON: ' + clip(e.message, 80) }; }
}
function loadReport(file) {
  const { data, error } = readJsonSafe(file);
  if (error) return { error };
  let meta = {}, findings = null;
  if (Array.isArray(data)) findings = data;
  else if (data && typeof data === 'object') {
    meta = data;
    if (Array.isArray(data.findings)) findings = data.findings;
    else if (Array.isArray(data.issues)) findings = data.issues;
    else if (data.report && Array.isArray(data.report.findings)) { meta = data.report; findings = data.report.findings; }
  }
  if (!findings) return { error: 'нет массива findings' };
  return { meta, findings: findings.filter(f => f && typeof f === 'object' && !Array.isArray(f) && ['severity', 'rule', 'problem', 'quote'].some(k => f[k] != null)) };
}
function guessProducer(base, top) {
  if (top === 'types') return 'type-auditor';
  if (top === 'layouts') return 'layout-validator';
  if (/^lint/.test(base)) return 'lint';
  if (/^round/.test(base)) return 'page-judge';
  if (/^blind/.test(base)) return 'blind-reader';
  if (/^cross/.test(base)) return 'cross-judge';
  if (/^dedup/.test(base)) return 'dedup';
  if (/^html-check/.test(base)) return 'html-check';
  return 'unknown';
}
function classify(rel, meta) {
  const parts = rel.split('/');
  const base = parts[parts.length - 1].replace(/\.json$/i, '');
  const dir = parts.slice(0, -1).join('/');
  const mr = base.match(/(?:^|-)round-?(\d+)$/i);
  const round = mr ? Number(mr[1]) : (Number(meta.round) || null);
  let kind, scope;
  if (parts[0] === 'types' && parts.length === 2) { kind = 'type'; scope = base.replace(/-?round-?\d+$/i, '') || base; }
  else if (parts[0] === 'layouts' && parts.length === 2) { kind = 'layout'; scope = base; }
  else if (!dir) { kind = 'global'; scope = base; }
  else { kind = 'page'; scope = dir; }
  const producer = typeof meta.producer === 'string' && meta.producer ? meta.producer : guessProducer(base, parts[0]);
  let fileKind = kind === 'type' ? 'type-audit' : (base.replace(/-?round-?\d+$/i, '') || 'judge');
  return { rel, kind, scope, base, round, producer, fileKind };
}
function normFinding(f, ctx, i) {
  const rawQ = str(f.quote);
  const q = normQuote(rawQ);
  const ri = ruleInfo(str(f.rule), ctx.producer);
  const block = str(f.block_id);
  return {
    id: String(f.id || `${ctx.base}#${i + 1}`), file: ctx.rel, producer: ctx.producer, kind: ctx.kind, scope: ctx.scope, round: ctx.round,
    page: str(f.page) || (ctx.kind === 'page' ? ctx.scope : `${ctx.kind}:${ctx.scope}`),
    block, bkey: blockKey(block),
    severity: SEV.includes(f.severity) ? f.severity : 'unknown',
    category: str(f.category) || 'none',
    status: str(f.status) || 'open', status_set: !!str(f.status),
    rule: str(f.rule).trim(), rkey: ri.key, rfamily: ri.family, naming: ri.naming,
    quote: rawQ, q, qPseudo: isPseudo(rawQ, q),
    problem: str(f.problem), proposal: str(f.proposal), res: resolutionText(f),
    element_index: f.element_index ?? '',
  };
}
const countBy = (arr, k) => arr.reduce((m, x) => inc(m, x[k]), {});
// JSON для чтения агентом: разделы и списки по строкам, каждый элемент списка - одной строкой
function compactJson(v, depth = 0) {
  if (depth >= 3 || v === null || typeof v !== 'object') return JSON.stringify(v);
  const pad = '  '.repeat(depth + 1), end = '  '.repeat(depth);
  if (Array.isArray(v)) return v.length ? `[\n${v.map(x => pad + compactJson(x, depth + 1)).join(',\n')}\n${end}]` : '[]';
  const e = Object.entries(v);
  return e.length ? `{\n${e.map(([k, x]) => `${pad}${JSON.stringify(k)}: ${compactJson(x, depth + 1)}`).join(',\n')}\n${end}}` : '{}';
}
function similar(f, g) {
  if (f.bkey && g.bkey && f.bkey !== g.bkey) return false;
  if (!f.q || !g.q) return false;
  if (f.q === g.q) return true;
  if (f.qPseudo || g.qPseudo) return false;
  const [s, l] = f.q.length <= g.q.length ? [f.q, g.q] : [g.q, f.q];
  return s.length >= 12 && l.includes(s);
}
const stems = s => new Set(normQuote(s).split(/[^a-zа-я0-9]+/).filter(w => w.length >= 5 && !/^(брифе|brief|факта|фактов|запрос|записан|handoff|нужно|только|назван|стоит|ставлю)/.test(w)).map(w => w.slice(0, 4)));
// признаки того, что находку судьи можно ловить скриптом (подсказка для ретро, не вердикт)
const HINTS = [
  ['repeat-count', /дважды|трижды|\d+\s*раз|повтор\w*\s+(почти\s+)?(дословно|слово в слово)|дословно|слово в слово|заход\w*\s+на\s+одно/i],
  ['fact-id', /id\s+факт|заявлен\w*\s+в\s+(списке\s+)?факт|в\s+facts|facts_used|F\d+\s+(заявлен|стоит|в\s+списке)/i],
  ['vague-number', /без\s+(цифр|числа|знаменател)|нет\s+(ни\s+)?(одной\s+)?цифр|расплывчат|оценочн|словами,?\s+хотя/i],
  ['empty-slot', /пуст\w*\s+(слот|мест|поле|рамк|подпис|карточк)|без\s+номера|голые\s+звездочки|плейсхолдер|\[\[/i],
  ['heading-vs-body', /заголов\w*\s+обеща|подзаголов\w*\s+обеща|заголовок\s+называет/i],
];
const hintOf = f => (HINTS.find(([, re]) => re.test(`${f.problem} ${f.rule}`)) || ['semantic'])[0];

// ---------- чтение ----------
const files = exists(AUDIT) ? walk(AUDIT, '.json').filter(f => !IGNORE.has(path.basename(f))).sort() : [];
const reports = [], skipped = [];
for (const file of files) {
  const rel = path.relative(AUDIT, file).split(path.sep).join('/');
  const r = loadReport(file);
  if (r.error) { skipped.push({ file: rel, reason: r.error }); continue; }
  // постраничные копии кросс-судьи (split-cross.mjs) повторяют находки общего cross.json - считаем один раз
  if (r.meta && r.meta.split_from) continue;
  const ctx = classify(rel, r.meta);
  reports.push({ ...ctx, meta: r.meta, findings: r.findings.map((f, i) => normFinding(f, ctx, i)) });
}
const all = reports.flatMap(r => r.findings);
// линтер: lint-page.json повторяет находки lint-<block>.json - считаем один раз
const seenLint = new Set();
for (const f of all) {
  if (f.producer !== 'lint') continue;
  const k = [f.page, f.bkey, f.rkey, f.q, f.element_index].join('|');
  if (seenLint.has(k)) f.dup = true; else seenLint.add(k);
}
const eff = all.filter(f => !f.dup);
const consistency = [];

// ---------- 1. частота: правила, категории, severity ----------
const totals = {
  findings_raw: all.length, findings: eff.length,
  by_producer: countBy(eff, 'producer'), by_severity: countBy(eff, 'severity'),
  by_category: countBy(eff, 'category'), by_status: countBy(eff, 'status'),
};
const families = {}, naming = {};
function ruleGroups(list) {
  const map = new Map();
  for (const f of list) {
    let g = map.get(f.rkey);
    if (!g) map.set(f.rkey, g = { key: f.rkey, family: f.rfamily, count: 0, texts: {}, producers: {}, severity: {}, categories: {}, statuses: {}, blocks: new Set(), pages: new Set(), examples: [] });
    g.count++; inc(g.texts, f.rule || '(без правила)'); inc(g.producers, f.producer); inc(g.severity, f.severity); inc(g.categories, f.category); inc(g.statuses, f.status);
    g.pages.add(f.page); if (f.block) g.blocks.add(`${f.page}/${f.block}`);
    if (f.quote && !f.qPseudo && g.examples.length < 2) g.examples.push(clip(f.quote, 90));
  }
  return [...map.values()].sort((a, b) => b.count - a.count).map(g => {
    const [label] = topN(g.texts, 1)[0];
    const { texts, ...rest } = g;
    return { rule: clip(label, 120), variants: Object.keys(texts).length, ...rest, pages: [...g.pages].slice(0, 6), blocks: [...g.blocks].slice(0, 6) };
  });
}
for (const f of eff) { inc(families, `${f.producer} ${f.rfamily}`); inc((naming[f.producer] ??= {}), f.naming); }
const rulesPages = ruleGroups(eff.filter(f => !f.page.includes(':'))).slice(0, 15);
const rulesOther = ruleGroups(eff.filter(f => f.page.includes(':'))).slice(0, 8);
const mixedNaming = Object.entries(naming).filter(([, m]) => Object.keys(m).filter(k => k !== 'none').length > 1);

// ---------- 2. круги судьи и аудитора типов ----------
const streams = {};
for (const r of reports) (streams[`${r.kind}|${r.scope}|${r.producer}|${r.fileKind}`] ??= []).push(r);
// сверка одного отчета: заявленные числа против находок в файле
const reportChecks = [];
function reportStats(r) {
  const fs_ = r.findings; // все находки файла: сверяем с тем, что заявлено в нем же
  const sev = countBy(fs_, 'severity'), st = countBy(fs_, 'status');
  const serious = (sev.blocker || 0) + (sev.major || 0);
  const checks = [];
  const m = String(r.meta.summary || '').match(/blocker\s*(\d+)\D{1,6}major\s*(\d+)\D{1,6}minor\s*(\d+)/i);
  if (m && (+m[1] !== (sev.blocker || 0) || +m[2] !== (sev.major || 0) || +m[3] !== (sev.minor || 0)))
    checks.push(`summary заявляет ${m[1]}/${m[2]}/${m[3]}, в файле ${sev.blocker || 0}/${sev.major || 0}/${sev.minor || 0} (blocker/major/minor)`);
  const fx = r.meta.fixer && typeof r.meta.fixer === 'object' ? r.meta.fixer : null;
  if (fx) {
    const bad = [['fixed', st.fixed || 0], ['rejected', (st.rejected || 0) + (st.wontfix || 0)], ['left_open', fs_.filter(isOpen).length]]
      .filter(([k, v]) => typeof fx[k] === 'number' && fx[k] !== v);
    if (bad.length) checks.push('отчет фиксера ' + bad.map(([k, v]) => `${k} ${fx[k]}, по статусам ${v}`).join('; '));
  }
  if (r.meta.verdict === 'pass' && serious) checks.push(`verdict pass при ${serious} серьезных находках`);
  if (r.meta.verdict === 'blocked' && !sev.blocker) checks.push('verdict blocked без blocker');
  checks.forEach(c => reportChecks.push(`${r.rel}: ${c}`));
  return { round: r.round, file: r.rel, total: fs_.length, serious, severity: sev, status: st, verdict: r.meta.verdict || null, scores: r.meta.scores || null, checks };
}
const statsOf = new Map(reports.map(r => [r, reportStats(r)]));
const roundRow = r => statsOf.get(r);
const roundStreams = [];
for (const [key, reps] of Object.entries(streams)) {
  const prod = reps[0].producer;
  if (MACHINE.has(prod) || !reps.some(r => r.round != null)) continue;
  const sorted = [...reps].sort((a, b) => (a.round || 0) - (b.round || 0));
  const rows = sorted.map(roundRow);
  const transitions = [];
  for (let i = 1; i < sorted.length; i++) {
    const A = sorted[i - 1].findings.filter(f => !f.dup), B = sorted[i].findings.filter(f => !f.dup);
    const carried = [];
    for (const g of B) { const f = A.find(x => similar(x, g)); if (f) carried.push({ from: f.id, from_status: f.status, to: g.id, block: g.block, severity: g.severity, rule: clip(g.rule, 80), quote: clip(g.quote, 90) }); }
    const openPrevSerious = A.filter(f => isOpen(f) && isSerious(f)).length;
    const noStatus = A.filter(f => !f.status_set).length;
    if (openPrevSerious) consistency.push(`${sorted[i - 1].rel}: ${openPrevSerious} серьезных со статусом open, хотя есть круг ${sorted[i].round} (фиксер их не отметил или не получал)`);
    else if (noStatus) consistency.push(`${sorted[i - 1].rel}: у ${noStatus} находок нет status, хотя есть круг ${sorted[i].round}`);
    if (rows[i].serious >= rows[i - 1].serious && rows[i - 1].serious > 0) consistency.push(`${sorted[i].rel}: серьезных ${rows[i].serious}, в круге ${sorted[i - 1].round} было ${rows[i - 1].serious} - после фиксера не меньше`);
    transitions.push({
      from_round: sorted[i - 1].round, to_round: sorted[i].round, prev_total: A.length, next_total: B.length,
      prev_fixed: A.filter(f => f.status === 'fixed').length, prev_open_serious: openPrevSerious,
      carried: carried.length, reopened: carried.filter(c => c.from_status === 'fixed').length,
      new_findings: B.length - carried.length, items: carried.slice(0, 10),
    });
  }
  const last = sorted[sorted.length - 1].findings.filter(f => !f.dup);
  roundStreams.push({ stream: key, producer: prod, kind: sorted[0].kind, scope: sorted[0].scope, rounds: rows, transitions,
    last_open: last.filter(isOpen).length, last_open_serious: last.filter(f => isOpen(f) && isSerious(f)).length });
}
const roundAgg = {};
for (const s of roundStreams) {
  const a = roundAgg[s.producer] ??= { streams: 0, kinds: {}, byRound: {}, carried: 0, reopened: 0, last_open: 0, last_open_serious: 0 };
  a.streams++; inc(a.kinds, s.kind);
  for (const r of s.rounds) { const b = a.byRound[r.round ?? 0] ??= { total: 0, serious: 0 }; b.total += r.total; b.serious += r.serious; }
  for (const t of s.transitions) { a.carried += t.carried; a.reopened += t.reopened; }
  a.last_open += s.last_open; a.last_open_serious += s.last_open_serious;
}
// устаревшие отчеты линтера: блока уже нет (снят или перенумерован)
for (const r of reports) {
  if (r.producer !== 'lint' || r.kind !== 'page' || !/^lint-/.test(r.base) || r.base === 'lint-page') continue;
  const blockId = r.base.slice(5);
  if (exists(P('work', 'pages', r.scope, 'blocks')) && !exists(P('work', 'pages', r.scope, 'blocks', `${blockId}.json`)))
    consistency.push(`${r.rel}: блока ${blockId} на странице нет - устаревший отчет линтера`);
}
consistency.push(...reportChecks);
for (const s of skipped) consistency.push(`${s.file}: пропущен - ${s.reason}`);

// ---------- 3. судья против линтера ----------
const onPages = eff.filter(f => !f.page.includes(':'));
const machineIdx = {}, machineRules = {};
for (const f of onPages) if (MACHINE.has(f.producer)) {
  ((machineIdx[f.page] ??= {})[f.bkey] ??= []).push(f);
  inc(machineRules, f.rkey);
}
const judgeF = onPages.filter(f => JUDGES.has(f.producer));
const jOnly = [], jBoth = [];
for (const f of judgeF) {
  const p = machineIdx[f.page] || {};
  // пара: машинная находка на той же странице и в том же блоке (или без блока), той же категории, про тот же текст
  const pair = [...(p[f.bkey] || []), ...(f.bkey ? (p[''] || []) : [])]
    .find(m => m.category === f.category && (!m.q || !f.q || similar({ ...m, bkey: '' }, { ...f, bkey: '' })));
  (pair ? jBoth : jOnly).push(f);
}
const jRules = {};
for (const f of jOnly) {
  const g = jRules[f.rkey] ??= { rule: clip(f.rule, 120), count: 0, serious: 0, producers: {}, categories: {}, hints: {}, blocks: new Set(), examples: [] };
  g.count++; if (isSerious(f)) g.serious++; inc(g.producers, f.producer); inc(g.categories, f.category); inc(g.hints, hintOf(f));
  if (f.block) g.blocks.add(`${f.page}/${f.block}`);
  if (f.quote && !f.qPseudo && g.examples.length < 2) g.examples.push(clip(f.quote, 90));
}
const lintTimes = {};
for (const r of reports) if (r.kind === 'page' && MACHINE.has(r.producer) && r.meta.created_at) {
  const t = String(r.meta.created_at); if (!lintTimes[r.scope] || t > lintTimes[r.scope]) lintTimes[r.scope] = t;
}
const judgeVsLint = {
  note: 'Отчеты линтера хранят последний снимок: находки линтера до правок фиксера не сохраняются. Совпадение - та же страница, тот же блок (без номера Bnn), та же категория.',
  pages: [...new Set(judgeF.map(f => f.page))],
  judge_total: judgeF.length, judge_only: jOnly.length, both: jBoth.length,
  judge_only_by_category: countBy(jOnly, 'category'),
  judge_only_by_severity: countBy(jOnly, 'severity'),
  judge_only_by_producer: countBy(jOnly, 'producer'),
  judge_only_hints: jOnly.reduce((m, f) => inc(m, hintOf(f)), {}),
  hints_legend: 'repeat-count - повтор по счету; fact-id - id факта без опоры в тексте; vague-number - обещание словами при наличии цифры; empty-slot - пустой слот или плейсхолдер; heading-vs-body - заголовок обещает не то; semantic - нужен смысл, скриптом не ловится',
  judge_only_rules: Object.values(jRules).sort((a, b) => b.count - a.count || b.serious - a.serious).slice(0, 12).map(g => ({ ...g, blocks: [...g.blocks].slice(0, 6) })),
  machine_rules_on_pages: machineRules,
  lint_snapshot_at: lintTimes,
};

// ---------- 4. отказы фиксера «нет факта» ----------
let gaps = [];
const fj = P('work', 'facts.json');
if (exists(fj)) { const { data } = readJsonSafe(fj); if (data && Array.isArray(data.gaps)) gaps = data.gaps.map(str).filter(Boolean); }
const gapStems = gaps.map(stems);
// общие для многих gaps основы (слова ниши) не считаются совпадением
const gapDf = {};
gapStems.forEach(g => g.forEach(s => inc(gapDf, s)));
const rareStem = s => gaps.length < 4 || (gapDf[s] || 0) / gaps.length <= 0.2;
const noFact = { rejected: [], partial: [], rejected_other: [], asked_by_judge: [] };
for (const f of eff) {
  const rejected = f.status === 'rejected' || f.status === 'wontfix';
  const base = { id: f.id, file: f.file, page: f.page, block: f.block, producer: f.producer, severity: f.severity, quote: clip(f.quote, 100) };
  if (f.res && NO_FACT_RE.test(f.res) && (rejected || f.status === 'fixed')) {
    const missing = gapText(f.res);
    const st = [...stems(missing)].filter(rareStem);
    let best = -1, bestN = 0;
    gapStems.forEach((g, i) => { const n = st.filter(s => g.has(s)).length; if (n > bestN) { bestN = n; best = i; } });
    const ok = bestN >= 2 && bestN / Math.max(1, st.length) >= 0.25;
    (rejected ? noFact.rejected : noFact.partial).push({ ...base, missing, similar_gap: ok ? clip(gaps[best], 120) : null });
  } else if (rejected) noFact.rejected_other.push({ ...base, reason: clip(f.res || '(причина не записана)', 160) });
  else if (JUDGES.has(f.producer) && ASK_RE.test(`${f.problem} ${f.proposal}`)) noFact.asked_by_judge.push({ ...base, proposal: clip(f.proposal, 160) });
}
const nfAll = [...noFact.rejected, ...noFact.partial];
noFact.by_block = nfAll.reduce((m, x) => inc(m, x.block ? blockKey(x.block) : x.page), {});
noFact.facts_gaps_known = gaps.length;
noFact.not_in_gaps = nfAll.filter(x => !x.similar_gap).length;
noFact.asked_by_judge = noFact.asked_by_judge.slice(0, 8);

// ---------- 5. повторяющиеся цитаты и частые пары слов ----------
const qItems = eff.filter(f => f.q && !f.qPseudo);
const exact = {};
for (const f of qItems) (exact[f.q] ??= []).push(f);
const qKeys = Object.keys(exact);
const groups = qKeys.map(k => {
  const members = new Set(exact[k]);
  if (k.length >= 12) for (const k2 of qKeys) if (k2 !== k && k2.includes(k)) exact[k2].forEach(x => members.add(x));
  return { quote: k, members: [...members] };
}).filter(g => g.members.length >= 2).sort((a, b) => b.members.length - a.members.length || b.quote.length - a.quote.length);
const shown = [];
for (const g of groups) {
  if (shown.some(s => g.members.every(m => s.members.includes(m)))) continue;
  shown.push(g); if (shown.length >= 15) break;
}
const repeatedQuotes = shown.map(g => ({
  quote: clip(g.members[0].quote, 120), match: clip(g.quote, 120), count: g.members.length,
  producers: countBy(g.members, 'producer'), blocks: [...new Set(g.members.map(m => `${m.page}/${m.bkey || '-'}`))].slice(0, 6),
  ids: g.members.map(m => m.id).slice(0, 8),
}));
const bigrams = {};
for (const f of qItems) {
  if (f.page.includes(':')) continue; // только тексты страниц, не снимки конкурентов
  const w = f.q.split(/[^a-zа-я0-9%$]+/i).filter(Boolean);
  const seen = new Set();
  for (let i = 0; i + 1 < w.length; i++) {
    const [a, b] = [w[i], w[i + 1]];
    if ((a.length < 5 && b.length < 5) || (STOP.has(a) && STOP.has(b))) continue;
    seen.add(`${a} ${b}`);
  }
  seen.forEach(k => inc(bigrams, k));
}
const bigramTop = topN(bigrams, 15).filter(([, n]) => n >= 3);

// ---------- 6. открытые находки по страницам (последний круг каждого потока) ----------
const openBy = {};
for (const reps of Object.values(streams)) {
  const last = [...reps].sort((a, b) => (a.round || 0) - (b.round || 0)).pop();
  for (const f of last.findings) {
    if (f.dup || !isOpen(f)) continue;
    const o = openBy[f.page] ??= { scope: f.page, open: 0, serious: 0, severity: {}, producers: {} };
    o.open++; if (isSerious(f)) o.serious++; inc(o.severity, f.severity); inc(o.producers, f.producer);
  }
}
const openList = Object.values(openBy).sort((a, b) => b.serious - a.serious || b.open - a.open);

// ---------- запись ----------
const stats = {
  generated_at: nowIso(),
  root: process.cwd(),
  files: { found: files.length, used: reports.length, skipped, by_producer: reports.reduce((m, r) => inc(m, r.producer), {}) },
  totals,
  rules: { top_pages: rulesPages, top_types_layouts: rulesOther, families: Object.fromEntries(topN(families, 15)), naming_by_producer: naming },
  rounds: { by_producer: roundAgg, streams: roundStreams },
  consistency,
  judge_vs_lint: judgeVsLint,
  no_fact: noFact,
  quotes: { repeated: repeatedQuotes, bigrams: Object.fromEntries(bigramTop) },
  open: { total: openList.reduce((s, o) => s + o.open, 0), serious: openList.reduce((s, o) => s + o.serious, 0), by_scope: openList.slice(0, 40) },
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, compactJson(stats) + '\n', 'utf8');

// ---------- сводка (не больше 30 строк) ----------
const L = [];
const relOut = path.relative(process.cwd(), OUT).split(path.sep).join('/');
if (!files.length) {
  L.push('retro-stats: в work/audit нет JSON-отчетов - считать нечего, записана пустая статистика');
} else {
  const sv = totals.by_severity;
  L.push(`retro-stats: файлов ${files.length} (с находками ${reports.length}, пропущено ${skipped.length}); находок ${eff.length}${all.length > eff.length ? ` (дублей линтера снято ${all.length - eff.length})` : ''}`);
  L.push(`Severity: blocker ${sv.blocker || 0}, major ${sv.major || 0}, minor ${sv.minor || 0} | статусы: ${fmt(totals.by_status, 5)}`);
  L.push(`Источники: ${fmt(totals.by_producer, 8)}`);
  L.push(`Категории: ${fmt(totals.by_category, 9)}`);
  if (rulesPages.length) {
    L.push('Топ правил на страницах:');
    rulesPages.slice(0, 3).forEach(g => L.push(`  ${g.count} x ${clip(g.rule, 80)} [${Object.keys(g.producers).join(', ')}; блоков ${g.blocks.length}]`));
  }
  if (rulesOther.length) L.push(`Топ правил типов и раскладок: ${rulesOther.slice(0, 3).map(g => `${clip(g.rule, 45)} ${g.count}${g.variants > 1 ? ` (вариантов ${g.variants})` : ''}`).join('; ')}`);
  if (mixedNaming.length) L.push(`Разнобой имен правил: ${mixedNaming.map(([p, m]) => `${p} (${fmt(m, 4)})`).join('; ')}`);
  if (roundStreams.length) {
    L.push('Круги (всего/серьезных):');
    for (const [p, a] of Object.entries(roundAgg)) {
      const chain = Object.entries(a.byRound).sort((x, y) => x[0] - y[0]).map(([r, b]) => `r${r} ${b.total}/${b.serious}`).join(' -> ');
      L.push(`  ${p} (${fmt(a.kinds)}): ${chain}; повторов между кругами ${a.carried} (из них уже fixed ${a.reopened}); открыто в последнем круге ${a.last_open}, серьезных ${a.last_open_serious}`);
    }
  }
  L.push(`Сверка: расхождений ${consistency.length}${consistency.length ? ' - ' + clip(consistency[0], 150) : ''}`);
  if (consistency.length > 1) L.push(`  ${clip(consistency[1], 170)}`);
  if (judgeF.length) {
    L.push(`Судья нашел, линтер нет: ${jOnly.length} из ${judgeF.length} (страниц ${judgeVsLint.pages.length}); по категориям: ${fmt(judgeVsLint.judge_only_by_category, 7)}`);
    L.push(`  признаки проверки скриптом: ${fmt(judgeVsLint.judge_only_hints, 6)} | линтер на тех же страницах: ${fmt(machineRules, 3)}`);
    L.push(`  правила судей без пары: ${judgeVsLint.judge_only_rules.slice(0, 3).map(g => `${clip(g.rule || '(без правила)', 55)} ${g.count}`).join('; ') || '-'}`);
  }
  L.push(`Отказы «нет факта»: отклонено ${noFact.rejected.length}, исправлено частично ${noFact.partial.length}, нет похожего в facts.gaps ${noFact.not_in_gaps} (gaps ${gaps.length}); по блокам: ${fmt(noFact.by_block, 5)}`);
  const ex = noFact.rejected[0] || noFact.partial[0];
  if (ex) L.push(`  пример ${ex.id} ${ex.block || ex.page}: ${clip(ex.missing, 130)}`);
  if (noFact.rejected_other.length) L.push(`  другие отказы ${noFact.rejected_other.length}: ${noFact.rejected_other[0].id} - ${clip(noFact.rejected_other[0].reason, 120)}`);
  if (repeatedQuotes.length) {
    L.push('Повторяющиеся цитаты:');
    repeatedQuotes.slice(0, 3).forEach(q => L.push(`  x${q.count} «${clip(q.match, 70)}» [${Object.keys(q.producers).join(', ')}] ${q.blocks.slice(0, 3).join(', ')}`));
  }
  if (bigramTop.length) L.push(`Частые пары слов в цитатах: ${bigramTop.slice(0, 6).map(([k, n]) => `«${k}» ${n}`).join(', ')}`);
  L.push(`Открыто (всего/серьезных): ${stats.open.total}/${stats.open.serious}; ${openList.slice(0, 5).map(o => `${o.scope} ${o.open}/${o.serious}`).join(', ') || '-'}`);
}
// не больше 30 строк, строка с путем - всегда последняя
console.log([...L.slice(0, 29), `Итог: ${relOut}`].join('\n'));
