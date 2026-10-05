// Покрытие элементов лидеров (КФ/КНДР) файлом типа страницы.
// node scripts/kf-coverage.mjs <type>|--all [--json] [--rows] [--dir <папка типов>]
// Читает work/kf/matrix.json напрямую (не через kf-matrix.mjs) и <dir>/<type>.json -> kf_coverage (dir по умолчанию
// work/page-types; частичный разбор A/B агрегатора - его out).
// Строки типа - строки матрицы зоны body со scope <type> (и <type>:<назначение>/<type>/<назначение> - дробление
// info_other по subject), уровень «обязательно» или «рекомендовано»; невидимые элементы (visible: false, разметка) - не
// строки типа: их место - группа «Для разработчика» таблицы, не текст страницы. Проверки:
// - каждая строка есть в kf_coverage (по el = id элемента);
// - to - блок типа, стоящий в recommended_order; у строки «обязательно» блок в short_set (short_set пуст - core: true);
// - to: shell - рисует оболочка (без проверок); to: skip - why начинается с причины из закрытого списка SKIP_REASONS.
// Нарушение по «обязательно» - blocker, по «рекомендовано» - major; код 1 при любом нарушении.
// Правило включения: нет work/kf/matrix.json - этап КФ не проводился: код 0 и строка «анализ КФ не проводился:
// <причина>» (причина - status из work/kf/status.json, нет файла - pre_kf).
// --json: {types: [{type, kf, reason, rows, violations, findings}]}; findings - готовые находки по
//   schemas/findings.schema.json (rule kf.coverage, category coverage, id kf-<элемент> - один и тот же между кругами
//   аудита), аудитор типов переносит их в свой файл как есть.
// --rows: строки типа одной строкой JSON [{id, name, n, N, level, kind, block_hint}] (как kf-matrix.mjs --compact
//   --min recommended), код 0.
// Экспорт для сборки брифов: loadKfMatrix, kfRows, kfLevel, SKIP_REASONS, skipReasonOk, coverageViolations.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { argv, P, readJson, exists } from './lib.mjs';

export const SKIP_REASONS = ['нет такой сущности у бизнеса', 'противоречит фактам', 'покрыто другим типом'];
const LEVELS = {
  must: 'must', required: 'must', 'обязательно': 'must',
  recommended: 'recommended', 'рекомендовано': 'recommended',
  optional: 'optional', 'по желанию': 'optional',
};
const LEVEL_RU = { must: 'обязательно', recommended: 'рекомендовано', optional: 'по желанию' };
const low = s => String(s ?? '').toLowerCase().replace(/\u0451/g, 'е').replace(/[«»"]/g, '').replace(/\s+/g, ' ').trim();
// уровень строки матрицы или записи kf_coverage: must | recommended | optional | ''
export function kfLevel(x) { return LEVELS[low(x)] || ''; }
export function skipReasonOk(why) { const w = low(why); return SKIP_REASONS.some(r => w.startsWith(r)); }

// матрица или null; причина отсутствия - из work/kf/status.json (нет файла - pre_kf)
export function loadKfMatrix() {
  const f = P('work', 'kf', 'matrix.json');
  if (exists(f)) {
    try { return { matrix: readJson(f), reason: '' }; } catch (e) { return { matrix: null, reason: `matrix.json не читается: ${e.message}` }; }
  }
  let reason = 'pre_kf';
  try { const s = readJson(P('work', 'kf', 'status.json')); if (s && s.status) reason = String(s.status) + (s.reason ? `: ${s.reason}` : ''); } catch { /* нет файла - задача начата до этапа */ }
  return { matrix: null, reason };
}

const rowsOf = m => (m && (Array.isArray(m.rows) ? m.rows : Array.isArray(m.items) ? m.items : Array.isArray(m.elements) ? m.elements : [])) || [];
const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);
function levelOf(r, m) {
  const l = kfLevel(r.level);
  if (l) return l;
  const n = num(r.n);
  if (n === null) return '';
  const p = (m && m.params) || m || {};
  const target = num(p.target) || 5;
  const mustN = num(p.must_n) || Math.ceil(0.8 * target);
  const recN = num(p.recommended_n) || 2;
  return n >= mustN ? 'must' : n >= recN ? 'recommended' : n >= 1 ? 'optional' : '';
}
const inType = (scope, type) => scope === type || scope.startsWith(type + ':') || scope.startsWith(type + '/');
const RANK = { must: 3, recommended: 2, optional: 1, '': 0 };

// строки тела типа (зона body), уровень не ниже min ('recommended' - «обязательно» и «рекомендовано»; 'optional' - все);
// один id - одна строка (при дроблении info_other берется сильнейшая)
export function kfRows(matrix, type, min = 'recommended') {
  const floor = RANK[min] || RANK.recommended;
  const byId = new Map();
  for (const r of rowsOf(matrix)) {
    if (!r || typeof r !== 'object') continue;
    const scope = String(r.scope || '');
    const zone = String(r.zone || 'body');
    if (scope === 'site' || zone !== 'body' || !inType(scope, type) || r.visible === false) continue;
    const level = levelOf(r, matrix);
    if (RANK[level] < floor) continue;
    const id = String(r.id || r.el || '');
    if (!id) continue;
    const row = { id, name: String(r.name || id), n: num(r.n), N: num(r.N), level, kind: r.kind || '', block_hint: r.block_hint || null, ...(r.needs_hint ? { needs_hint: String(r.needs_hint) } : {}) };
    const prev = byId.get(id);
    if (!prev || RANK[level] > RANK[prev.level] || (RANK[level] === RANK[prev.level] && (row.n || 0) > (prev.n || 0))) byId.set(id, row);
  }
  return [...byId.values()];
}

// нарушения покрытия: [{severity, el, name, level, n, N, to, problem, proposal}]
export function coverageViolations(pt, rows) {
  const blocks = [...((pt && pt.market_blocks) || []), ...((pt && pt.differentiation_blocks) || [])];
  const byId = Object.fromEntries(blocks.map(b => [b.id, b]));
  const order = (pt && pt.recommended_order) || [];
  const short = (pt && pt.short_set) || [];
  const cov = Array.isArray(pt && pt.kf_coverage) ? pt.kf_coverage : [];
  const out = [];
  for (const r of rows) {
    if (r.level !== 'must' && r.level !== 'recommended') continue;
    const must = r.level === 'must';
    const v = (problem, proposal, to = '') => out.push({ severity: must ? 'blocker' : 'major', el: r.id, name: r.name, level: r.level, n: r.n, N: r.N, to, problem, proposal });
    const c = cov.find(x => x && x.el === r.id);
    const lead = `элемент лидеров «${r.name}» (${r.id}, ${LEVEL_RU[r.level]}${r.n != null && r.N != null ? `, ${r.n} из ${r.N}` : ''})`;
    if (!c) { v(`${lead}: нет записи в kf_coverage`, `добавить {el: "${r.id}", to: <id блока>|shell|skip, why}${r.block_hint ? `; подсказка блока: ${r.block_hint}` : ''}`); continue; }
    const to = String(c.to || '');
    if (to === 'shell') continue;
    if (to === 'skip') {
      if (!skipReasonOk(c.why)) v(`${lead}: skip с причиной не из списка («${String(c.why || '').slice(0, 80)}»)`, `why - одна из причин: ${SKIP_REASONS.map(x => `«${x}»`).join(', ')}; иначе покрыть блоком`, to);
      continue;
    }
    if (!to) { v(`${lead}: в записи kf_coverage пустой to`, 'to - id блока типа, shell или skip', to); continue; }
    if (!byId[to]) { v(`${lead}: блока ${to} нет в типе`, 'указать блок из market_blocks или differentiation_blocks', to); continue; }
    if (!order.includes(to)) { v(`${lead}: блок ${to} не стоит в recommended_order`, `поставить ${to} в recommended_order`, to); continue; }
    if (must) {
      if (short.length && !short.includes(to)) v(`${lead}: блок ${to} не в short_set`, `добавить ${to} в short_set`, to);
      else if (!short.length && !byId[to].core) v(`${lead}: блок ${to} не core при пустом short_set`, `core: true у ${to} или short_set с ${to}`, to);
    }
  }
  return out;
}

// id находки - по элементу (не по позиции): повторный аудит не путает статусы фиксера
const findingId = el => 'kf-' + (String(el).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'el');
const toFindings = viol => viol.map(x => ({
  id: findingId(x.el), ...(x.to && !['shell', 'skip'].includes(x.to) ? { block_id: x.to } : {}),
  quote: `${x.el}: ${x.name}`, severity: x.severity, category: 'coverage', rule: 'kf.coverage', problem: x.problem, proposal: x.proposal, status: 'open',
}));

function checkType(type, matrix, dir) {
  const f = path.join(dir, `${type}.json`);
  let pt = null, note = '';
  if (exists(f)) { try { pt = readJson(f); } catch (e) { note = `файл типа не читается: ${e.message}`; } } else note = 'файла типа нет';
  const rows = kfRows(matrix, type);
  const violations = coverageViolations(pt || {}, rows);
  return { type, kf: true, reason: '', note, rows, violations, findings: toFindings(violations) };
}

function main() {
  const a = argv({ all: 'bool', json: 'bool', rows: 'bool' });
  const type = a._[0];
  if ((!type && !a.all) || ('dir' in a && !a.dir)) { console.error('usage: kf-coverage.mjs <type>|--all [--json] [--rows] [--dir <папка типов>]'); process.exit(2); }
  const dir = a.dir ? path.resolve(P(), a.dir) : P('work', 'page-types');
  const { matrix, reason } = loadKfMatrix();
  if (a.rows) { console.log(JSON.stringify(matrix && type ? kfRows(matrix, type).map(({ needs_hint, ...r }) => r) : [])); return; }
  let types = type ? [type] : [];
  if (a.all) {
    types = exists(dir) ? fs.readdirSync(dir).filter(x => x.endsWith('.json')).map(x => path.basename(x, '.json')).sort() : [];
  }
  if (!matrix) {
    if (a.json) console.log(JSON.stringify({ types: types.map(t => ({ type: t, kf: false, reason, rows: [], violations: [], findings: [] })) }));
    else console.log(`анализ КФ не проводился: ${reason}`);
    return;
  }
  const res = types.map(t => checkType(t, matrix, dir));
  const bad = res.reduce((n, r) => n + r.violations.length, 0);
  if (a.json) console.log(JSON.stringify({ types: res }));
  else {
    for (const r of res) {
      const c = { must: r.rows.filter(x => x.level === 'must').length, rec: r.rows.filter(x => x.level === 'recommended').length };
      const s = { blocker: r.violations.filter(x => x.severity === 'blocker').length, major: r.violations.filter(x => x.severity === 'major').length };
      console.log(`kf-coverage ${r.type}: строк КФ ${r.rows.length} (обязательно ${c.must}, рекомендовано ${c.rec}); нарушений: blocker ${s.blocker}, major ${s.major}${r.note ? `; ${r.note}` : ''}`);
      if (!r.rows.length) console.log('  строк КФ для типа нет');
      for (const v of r.violations) console.log(`  - [${v.severity}] ${v.problem} -> ${v.proposal}`);
    }
  }
  process.exitCode = bad ? 1 : 0;
}

const real = p => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
if (process.argv[1] && real(process.argv[1]) === real(fileURLToPath(import.meta.url))) main();
