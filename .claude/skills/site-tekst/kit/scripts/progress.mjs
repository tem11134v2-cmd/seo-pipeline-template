// Производные статусы страниц задачи /site-tekst: одна функция для plan-run, report, task.mjs status (и сборщика прототипа).
// Модуль без побочных действий: только экспорты, корень задачи передается явно (task.mjs шаблона импортирует его из kit
// шаблона, скрипты задачи - из своей копии). Время файлов нигде не сравнивается: после checkout и копирования оно
// недостоверно. Свежесть - по содержимому (sha среза брифа, sha page.md).
//
// Блок брифа:
//   pass       - файл блока есть и его lint-<block_id>.json с verdict pass;
//   exhausted  - есть отчет линтера к текущему содержимому блока и он не pass, attempts >= 2 и brief_sha равен текущему
//                sha среза (_brief_sha1, writer-inputs.mjs). attempts и brief_sha пишет в файл блока его автор: писатель
//                блока, у первого экрана - селектор (счетчик настоящих неудач линтера: прежний блок не pass по тому же
//                срезу - его attempts + 1). Файлы вариантов первого экрана (.variants*.json) попыток не дают: ответ без
//                блока (no_answer, chosen none) - не неудача линтера (RUNBOOK, фаза 5: «попытка не засчитана»). Блок без
//                отчета линтера (записан, но не проверен) и блок, чей отчет несет block_sha другого содержимого (отчет
//                прежней попытки), не exhausted. Сменился срез (новые факты, правка стратегии) - блок снова доступен писателю;
//   pending    - все прочие (нет файла, нет отчета или он устарел, lint не pass и попыток меньше двух или срез сменился).
// Страница:
//   done (написано)   - все блоки брифа pass;
//   complete (дописана для аудита) - каждый блок pass или exhausted;
//   audit_fresh       - есть round-N.json и lint-page.json без page_sha (старые задачи) или с page_sha, равным sha1
//                       текущего page.md; иначе страница снова идет в args audit;
//   ready (готово)    - done, audit_fresh и нет открытых blocker/major (последний round-N.json, blind.json, human-*.json,
//                       постраничный cross.json; находки с needs_fact - вопросы заказчику, готовность не снимают). Круг
//                       scope=fixed смотрит только блоки, которые правил фиксер: открытые blocker/major прежнего круга на
//                       блоках вне его fixer.blocks_touched тоже снимают готовность (фиксер не закрыл, судья не перепроверял).
// Волны (C8): волна 1 - главная и первая по карте рабочая страница каждого типа, у которого рабочих страниц 2+; волна 2 -
// остальные рабочие страницы. Состав волн не зависит от прогресса. Турнир первого экрана: главная, хабы и первая по карте
// страница типов service и category.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { briefSha } from './writer-inputs.mjs';

export const EXHAUST_AFTER = 2;
export const TOURNAMENT_TYPES = ['home', 'hub'];
export const TOURNAMENT_FIRST_OF = ['service', 'category'];
const OPEN = new Set(['open', 'new', 'pending', 'todo', '']);
const SERIOUS = new Set(['blocker', 'major']);

const readJsonSafe = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, '')); } catch { return null; } };
const sha1File = f => { try { return crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex'); } catch { return ''; } };
const listDir = d => { try { return fs.readdirSync(d); } catch { return []; } };
export const isOpenStatus = s => OPEN.has(String(s || '').toLowerCase());
export const isSerious = f => !!f && SERIOUS.has(f.severity);

export function loadMap(root) { return readJsonSafe(path.join(root, 'work', 'sitemap.json')) || { pages: [] }; }
export const livePages = sm => ((sm && sm.pages) || []).filter(p => p && p.status !== 'skip');
// Функциональные страницы (поиск, корзина, кабинет, юридические) и шаблоны - не образец типа для волны 1 и турнира.
const functional = p => !!(p.ui_role || p.template);

// Первая по карте страница типа: сначала среди обычных страниц, нет таких - любая.
function firstOfType(live, type) {
  const all = live.filter(p => p.type === type);
  return (all.find(p => !functional(p)) || all[0] || {}).slug;
}

export function waves(root, sm = loadMap(root)) {
  const live = livePages(sm);
  const n = {};
  for (const p of live) n[p.type] = (n[p.type] || 0) + 1;
  const w1 = new Set(live.filter(p => p.type === 'home').map(p => p.slug));
  for (const t of Object.keys(n)) if (t !== 'home' && n[t] >= 2) { const s = firstOfType(live, t); if (s) w1.add(s); }
  const res = { 1: [], 2: [], of: {} };
  for (const p of live) { const w = w1.has(p.slug) ? 1 : 2; res.of[p.slug] = w; res[w].push(p.slug); }
  return res;
}

export function tournamentSlugs(sm) {
  const live = livePages(sm);
  const out = new Set(live.filter(p => TOURNAMENT_TYPES.includes(p.type)).map(p => p.slug));
  for (const t of TOURNAMENT_FIRST_OF) { const s = firstOfType(live, t); if (s) out.add(s); }
  return out;
}

// Пилот по умолчанию (--stop pilot без --pilot, --allow-ungated): главная и первая категория, нет категорий - услуга, иначе хаб.
export function pilotOffer(sm) {
  const live = livePages(sm);
  const pick = t => firstOfType(live, t);
  return [pick('home'), pick('category') || pick('service') || pick('hub')].filter(Boolean);
}

export function sliceSha(root, slug) {
  try { return briefSha(fs.readFileSync(path.join(root, 'work', 'pages', slug, 'brief.json'), 'utf8')); } catch { return ''; }
}

export function blockState(root, slug, spec, sha = sliceSha(root, slug)) {
  const id = spec.block_id;
  const bdir = path.join(root, 'work', 'pages', slug, 'blocks');
  const block = readJsonSafe(path.join(bdir, `${id}.json`));
  const lintRep = block ? readJsonSafe(path.join(root, 'work', 'audit', slug, `lint-${id}.json`)) : null;
  const lint = lintRep && typeof lintRep.verdict === 'string' ? lintRep.verdict : '';
  // попытки - только из файла блока (у первого экрана его пишет селектор); файлы вариантов не считаются
  const attempts = block && sha && block.brief_sha === sha && Number(block.attempts) > 0 ? Number(block.attempts) : 0;
  const pass = lint === 'pass';
  // неудача засчитывается по вердикту линтера к текущему содержимому блока: без отчета (писатель записал блок и не
  // ответил до lint) - pending; block_sha в отчете (sha1 файла блока после запуска линтера) не совпал - отчет прежней
  // попытки, тоже pending. Отчет без block_sha (старые задачи) принимается как есть
  const lintFresh = !!lint && (!lintRep.block_sha || lintRep.block_sha === sha1File(path.join(bdir, `${id}.json`)));
  const exhausted = !pass && lintFresh && attempts >= EXHAUST_AFTER;
  const reasons = pass || !lintFresh ? [] : (lintRep.findings || []).filter(isSerious).map(f => `${f.rule || f.severity}: ${String(f.problem || '').slice(0, 120)}`);
  return {
    block_id: id, role: spec.role || '', pattern: spec.pattern || '', written: !!block, lint, pass, attempts, exhausted,
    needs_fact: Array.isArray(block && block.needs_fact) ? block.needs_fact.filter(x => typeof x === 'string' && x.trim()) : [],
    reasons,
  };
}

export const blockKey = id => String(id || '').replace(/^B\d+[a-z]?[-_]/i, '').toLowerCase();
// файлы кругов судьи страницы по возрастанию номера
const roundFiles = files => files.map(f => [f, Number((f.match(/^round-(\d+)\.json$/) || [])[1])]).filter(x => x[1]).sort((a, b) => a[1] - b[1]).map(x => x[0]);

// Находки аудита страницы. По умолчанию - текущие: последний round-N.json, blind.json, human-*.json, постраничный cross.json
// (архивы cross-archive-*.json не читаются). allRounds - все круги судьи (список «закрыто без правки», вопросы заказчику).
export function pageFindings(root, slug, { allRounds = false } = {}) {
  const dir = path.join(root, 'work', 'audit', slug);
  const files = listDir(dir);
  const rounds = roundFiles(files);
  const pick = [...(allRounds ? rounds : rounds.slice(-1)), ...files.filter(f => f === 'blind.json' || f === 'cross.json' || /^human-.*\.json$/.test(f))];
  const out = [];
  for (const f of pick) {
    const r = readJsonSafe(path.join(dir, f));
    const list = r && (Array.isArray(r.findings) ? r.findings : Array.isArray(r) ? r : null);
    if (!list) continue;
    const producer = (r && r.producer) || (f.startsWith('round-') ? 'page-judge' : f === 'blind.json' ? 'blind-reader' : f === 'cross.json' ? 'cross-judge' : 'human');
    for (const x of list) if (x && typeof x === 'object') out.push({ ...x, page: x.page || slug, _file: `work/audit/${slug}/${f}`, _producer: producer });
  }
  return out;
}

export function pageProgress(root, slug) {
  const dir = path.join(root, 'work', 'pages', slug);
  const out = {
    slug, briefed: false, blocks_total: 0, blocks: [], pending: [], exhausted: [], lint_dirty: [], passed: 0, written: 0,
    hero_block_id: '', hero_done: false, done: false, complete: false, audit_rounds: 0, audit_last_round: 0, audited: false, audit_fresh: false,
    open: { blocker: 0, major: 0, minor: 0 }, open_serious: 0, carried: 0, needs_fact_open: 0, closed_no_fix: [], ready: false, status: 'нет брифа',
  };
  const brief = readJsonSafe(path.join(dir, 'brief.json'));
  if (!brief || !Array.isArray(brief.blocks)) return out;
  out.briefed = true;
  const sha = sliceSha(root, slug);
  out.blocks_total = brief.blocks.length;
  out.hero_block_id = (brief.blocks.find(b => b.role === 'hero') || {}).block_id || '';
  for (const b of brief.blocks) {
    const s = blockState(root, slug, b, sha);
    out.blocks.push(s);
    if (s.written) out.written++;
    if (s.pass) { out.passed++; if (b.role === 'hero') out.hero_done = true; continue; }
    if (s.written && s.lint) out.lint_dirty.push(s.block_id);
    (s.exhausted ? out.exhausted : out.pending).push(s.block_id);
  }
  out.done = out.passed === out.blocks_total;
  out.complete = out.pending.length === 0;
  const adir = path.join(root, 'work', 'audit', slug);
  const rounds = listDir(adir).map(f => Number((f.match(/^round-(\d+)\.json$/) || [])[1])).filter(Boolean);
  out.audit_rounds = rounds.length;
  out.audit_last_round = rounds.length ? Math.max(...rounds) : 0;
  out.audited = out.audit_rounds > 0;
  const lp = readJsonSafe(path.join(adir, 'lint-page.json'));
  out.audit_fresh = out.audited && (!lp || !lp.page_sha || lp.page_sha === sha1File(path.join(dir, 'page.md')));
  for (const f of pageFindings(root, slug)) {
    if (!f.needs_fact && isOpenStatus(f.status) && out.open[f.severity] != null) out.open[f.severity]++;
  }
  // вопросы заказчику (needs_fact) - по всем кругам: второй круг смотрит только правленые блоки и их не повторяет
  const all = pageFindings(root, slug, { allRounds: true });
  out.needs_fact_open = all.filter(f => f.needs_fact && isOpenStatus(f.status)).length;
  // прежний круг, по которому работал фиксер (есть fixer.blocks_touched): его открытые blocker/major вне правленых блоков
  // следующий круг (scope=fixed) не перепроверял - они остаются открытыми
  const rf = roundFiles(listDir(adir));
  const prev = rf.length >= 2 ? readJsonSafe(path.join(adir, rf[rf.length - 2])) : null;
  const touched = prev && prev.fixer && Array.isArray(prev.fixer.blocks_touched) ? new Set(prev.fixer.blocks_touched.map(blockKey)) : null;
  if (touched) for (const f of Array.isArray(prev.findings) ? prev.findings : []) {
    if (f && isSerious(f) && !f.needs_fact && isOpenStatus(f.status) && !touched.has(blockKey(f.block_id))) { out.open[f.severity]++; out.carried++; }
  }
  out.open_serious = out.open.blocker + out.open.major;
  // major и blocker, закрытые фиксером без правки (wontfix, rejected): готовность не снимают, идут отдельным списком отчета
  out.closed_no_fix = all.filter(f => isSerious(f) && /^(wontfix|rejected)$/.test(f.status || ''))
    .map(f => ({ file: f._file, id: f.id || '', block_id: f.block_id || '', rule: f.rule || '', severity: f.severity, status: f.status, problem: f.problem || '', resolution: f.resolution || '' }));
  out.ready = out.done && out.audit_fresh && out.open_serious === 0;
  out.status = !out.complete ? 'в работе' : out.exhausted.length ? 'заблокировано' : !out.audit_fresh ? 'написано'
    : out.open_serious ? `аудит: открыто ${out.open_serious}` : 'готово';
  return out;
}

// Архивы отчетов кросс-судьи: cross-archive-<stamp>.json (маска не пересекается с cross-digest.json). Метка - время отчета
// без двоеточий и точек (20260927T101500Z): двоеточие в имени файла на Windows ломает запись. Пустая метка - текущее время.
export const ARCHIVE_PREFIX = 'cross-archive-';
export const isCrossArchive = f => /^cross-archive-[0-9A-Za-z]+\.json$/.test(path.basename(String(f || '')));
export function archiveStamp(s, now = new Date()) {
  const str = String(s || '').trim();
  const m = str.match(/^(\d{4})-?(\d{2})-?(\d{2})(?:[T ]?(\d{2}):?(\d{2})(?::?(\d{2}))?)?/);
  if (m) return `${m[1]}${m[2]}${m[3]}T${m[4] || '00'}${m[5] || '00'}${m[6] || '00'}Z`;
  const flat = str.replace(/[^0-9A-Za-z]+/g, '').slice(0, 40);
  return flat || archiveStamp(now.toISOString());
}
export const archiveName = s => `${ARCHIVE_PREFIX}${archiveStamp(s)}.json`;

// Сводка по волнам для status: страниц, брифов, дописано, готово, аудит свежий, exhausted-блоков.
export function waveSummary(root, sm = loadMap(root)) {
  const W = waves(root, sm);
  const rows = {};
  for (const w of [1, 2]) {
    const g = rows[w] = { pages: W[w].length, briefed: 0, done: 0, complete: 0, ready: 0, audited: 0, exhausted: 0, blocks: 0, pending: 0, progress: [] };
    for (const slug of W[w]) {
      const pr = pageProgress(root, slug);
      g.progress.push(pr);
      if (pr.briefed) g.briefed++;
      if (pr.done) g.done++;
      if (pr.complete && pr.briefed) g.complete++;
      if (pr.ready) g.ready++;
      if (pr.audit_fresh) g.audited++;
      g.exhausted += pr.exhausted.length; g.blocks += pr.blocks_total; g.pending += pr.pending.length;
    }
  }
  return { waves: W, rows };
}
