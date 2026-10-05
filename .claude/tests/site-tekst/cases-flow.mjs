// Поток /site-tekst (пакет W5): статусы страниц и волны (scripts/progress.mjs), plan-run, отчет report.mjs (разделы C9),
// архивы кросса (split-cross, dedup), обязательные формулировки в dedup, task.mjs (пауза, пилот, args write/audit, status,
// overrides), воркфлоу wf-05/wf-05b/wf-06/wf-06b с подставными agent. Запуск:
//   node .claude/tests/site-tekst/cases-flow.mjs      код выхода 0 - все прошли (или через run.mjs рядом).
// Все во временной папке (os.tmpdir()), без сети и без данных клиентов. Время файлов нарочно портится (utimes): статусы
// от него не зависят.
// Разделы: 1. progress: написано без mtime, exhausted, смена среза, варианты первого экрана (попыток не дают: счет по
// файлу блока, №23; exhausted - только по отчету линтера к текущему содержимому блока, block_sha), свежесть аудита, готово;
// 2. волны на картах из 1, 5 и 60 страниц, стабильность; 3. турнир (C8) и plan-run; 4. task.mjs: пауза, пилот, args
// write/audit, status, place (overrides K9: слияние .json по RFC 7396, дописка .md, полная замена с базой сверки в meta.json,
// без пары в kit, живые блоки K8; смена worktree), опечатки --slugs и пилота (код 2), строки status автостопов против цитат
// таблицы автостопов SKILL.md (строки, которых в таблице еще нет, - SKIP), «Где можно» не разобрано, 0 фактов анализа,
// exhausted у образца волны 1 (2+ блока и больше 30%); 5. report: разделы C9 на синтетике, §8 только v2; 5b. report: вопросы
// кросса после нового запуска (архивы), все круги судьи; 6. split-cross: created_at, архив;
// 7. dedup: архив cross.json, обязательные формулировки; 8. воркфлоу.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { briefSha } from '../../skills/site-tekst/kit/scripts/writer-inputs.mjs';
import { pageProgress, waves, tournamentSlugs, archiveStamp, isCrossArchive } from '../../skills/site-tekst/kit/scripts/progress.mjs';
import { mergePatch, blobId, APPEND_MARK } from '../../skills/site-tekst/task.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const SKILL = path.join(ROOT, '.claude', 'skills', 'site-tekst');
const TPL = path.join(SKILL, 'kit');
const TASK_MJS = '.claude/skills/site-tekst/task.mjs';
let pass = 0, fail = 0, skipped = 0;
const failures = [], skips = [];
function check(name, ok, detail = '') {
  if (ok) pass++;
  else { fail++; failures.push(`FAIL ${name}${detail ? ': ' + String(detail).slice(0, 600) : ''}`); }
}
// SKIP с причиной: проверка ждет правку другого пакета (не провал набора)
function skip(name, why) { skipped++; skips.push(`SKIP ${name}: ${why}`); }

// ---------- помощники ----------
const rj = f => JSON.parse(fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, ''));
const wj = (f, o) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(o, null, 2) + '\n'); };
const wt = (f, s) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, s); };
const sha1 = s => crypto.createHash('sha1').update(s).digest('hex');
const canon = v => JSON.stringify(v);
function run(cwd, args) {
  const r = spawnSync(process.execPath, args, { cwd, encoding: 'utf8' });
  return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '', out: (r.stdout || '') + (r.stderr || '') };
}
const runJson = (cwd, args) => { const r = run(cwd, args); try { r.json = JSON.parse(r.stdout); } catch { r.json = null; } return r; };
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cases-flow-'));
// проект задачи: копия логики kit (скрипты, правила, схемы, конфиг)
function mkProject(name) {
  const dir = path.join(tmpRoot, name);
  for (const d of ['scripts', 'rules', 'schemas', 'config']) fs.cpSync(path.join(TPL, d), path.join(dir, d), { recursive: true });
  fs.mkdirSync(path.join(dir, 'work', 'audit'), { recursive: true });
  return dir;
}
const mapPage = (slug, type, i, extra = {}) => ({ slug, url: i ? `/${slug}` : '/', type, subject: slug, parent: i ? '/' : '', level: i ? 1 : 0, segment: 'S1', status: 'briefed', ...extra });
function writeMap(dir, pages) { wj(path.join(dir, 'work', 'sitemap.json'), { pages }); }
// бриф страницы: blocks - [[id, role]]; возвращает sha среза (как у писателя в brief_sha)
function writeBrief(dir, slug, blocks, extra = {}) {
  const brief = { slug, url: `/${slug}`, type: extra.type || 'category', segment: { id: 'S1', name: 'Семья' }, facts: [], blocks: blocks.map(([block_id, role, more]) => ({ block_id, role, ...(more || {}) })), ...extra };
  const text = JSON.stringify(brief, null, 2) + '\n';
  wt(path.join(dir, 'work', 'pages', slug, 'brief.json'), text);
  return briefSha(text);
}
// блок и его отчет линтера; opts.attempts/brief_sha - счетчик писателя
function writeBlock(dir, slug, id, verdict, opts = {}) {
  const { elements = [{ kind: 'h2', text: `Заголовок ${id}` }], ...rest } = opts;
  wj(path.join(dir, 'work', 'pages', slug, 'blocks', `${id}.json`), { block_id: id, elements, ...rest });
  if (verdict) wj(path.join(dir, 'work', 'audit', slug, `lint-${id}.json`), { verdict, findings: verdict === 'pass' ? [] : [{ severity: verdict === 'blocked' ? 'blocker' : 'major', rule: 'fact.unknown', problem: 'нет факта в брифе' }] });
}
const OLD = new Date('2001-01-01T00:00:00Z');
const touchOld = f => fs.utimesSync(f, OLD, OLD);

// ---------- воркфлоу с подставными хуками (как workflow-models.mjs) ----------
const AsyncFunction = (async () => {}).constructor;
const wfSource = name => fs.readFileSync(path.join(TPL, 'workflows', `${name}.js`), 'utf8');
async function runWf(name, args, answer) {
  const calls = [], logs = [];
  const exec = async (wf, a) => {
    const agent = async (prompt, opts = {}) => { calls.push({ wf, label: opts.label, prompt: String(prompt) }); return answer(opts.label || '', String(prompt), wf); };
    const parallel = thunks => Promise.all(thunks.map(t => t()));
    const pipeline = (items, ...stages) => Promise.all(items.map(async (it, i) => { let r = it; for (const st of stages) r = await st(r, it, i); return r; }));
    const workflow = async (ref, childArgs) => exec(path.basename(ref.scriptPath || '', '.js'), childArgs);
    const fn = new AsyncFunction('args', 'agent', 'parallel', 'pipeline', 'phase', 'log', 'workflow', 'budget', wfSource(wf).replace(/^export const meta\s*=/m, 'const meta ='));
    return fn(a, agent, parallel, pipeline, () => {}, m => logs.push(m), workflow, {});
  };
  const result = await exec(name, { root: '/fake/root', ...args });
  return { calls, logs, result };
}

try {
  // ================================================================== 1. progress
  {
    const A = mkProject('progress');
    writeMap(A, [mapPage('home', 'home', 0), mapPage('c1', 'category', 1), mapPage('c2', 'category', 2), mapPage('c3', 'category', 3)]);
    // home: оба блока pass, время файлов испорчено (lint и блоки старше брифа) - написано
    writeBrief(A, 'home', [['B01-hero', 'hero'], ['B02-text', 'conversion']], { type: 'home' });
    writeBlock(A, 'home', 'B01-hero', 'pass'); writeBlock(A, 'home', 'B02-text', 'pass');
    for (const f of ['blocks/B01-hero.json', 'blocks/B02-text.json']) touchOld(path.join(A, 'work', 'pages', 'home', f));
    for (const f of ['lint-B01-hero.json', 'lint-B02-text.json']) touchOld(path.join(A, 'work', 'audit', 'home', f));
    const h = pageProgress(A, 'home');
    check('progress: написано без сравнения времени файлов', h.done && h.complete && h.passed === 2 && h.pending.length === 0 && h.status === 'написано', JSON.stringify(h).slice(0, 300));
    // c1: B02 lint fix, attempts 2 по текущему срезу - exhausted, страница дописана и заблокирована
    const s1 = writeBrief(A, 'c1', [['B01-hero', 'hero'], ['B02-text', 'conversion'], ['B03-faq', 'info']]);
    writeBlock(A, 'c1', 'B01-hero', 'pass'); writeBlock(A, 'c1', 'B02-text', 'fix', { attempts: 2, brief_sha: s1 }); writeBlock(A, 'c1', 'B03-faq', 'pass');
    const c1 = pageProgress(A, 'c1');
    check('progress: lint не pass, attempts 2, тот же срез - exhausted', canon(c1.exhausted) === canon(['B02-text']) && c1.pending.length === 0 && c1.complete && !c1.done && c1.status === 'заблокировано', JSON.stringify(c1).slice(0, 300));
    check('progress: у exhausted причина из отчета линтера', /fact\.unknown/.test((c1.blocks.find(b => b.block_id === 'B02-text') || {}).reasons.join(' ')));
    // c2: attempts 1 - еще pending; attempts 2 по старому срезу - pending
    const s2 = writeBrief(A, 'c2', [['B01-hero', 'hero'], ['B02-text', 'conversion'], ['B03-faq', 'info']]);
    writeBlock(A, 'c2', 'B01-hero', 'pass'); writeBlock(A, 'c2', 'B02-text', 'fix', { attempts: 1, brief_sha: s2 }); writeBlock(A, 'c2', 'B03-faq', 'blocked', { attempts: 2, brief_sha: 'старый' });
    const c2 = pageProgress(A, 'c2');
    check('progress: attempts 1 и другой срез - блоки pending', canon(c2.pending) === canon(['B02-text', 'B03-faq']) && c2.exhausted.length === 0 && !c2.complete && c2.status === 'в работе', JSON.stringify(c2).slice(0, 300));
    // смена среза (правка брифа) снимает exhausted
    writeBrief(A, 'c1', [['B01-hero', 'hero'], ['B02-text', 'conversion'], ['B03-faq', 'info']], { unknowns: ['новый пробел'] });
    const c1b = pageProgress(A, 'c1');
    check('progress: бриф изменился - exhausted-блок снова pending', canon(c1b.pending) === canon(['B02-text']) && c1b.exhausted.length === 0, JSON.stringify(c1b.pending));
    // c3: первый экран не записан, у файла вариантов attempts 2 по текущему срезу (писатели вариантов отработали, селектор
    // дважды не ответил) - не exhausted: попытки первого экрана считает только файл блока, который пишет селектор (№23,
    // повторная проверка: no_answer - попытка не засчитана, RUNBOOK фаза 5). Прежнее утверждение «варианты с attempts 2 -
    // exhausted» снято: оно давало exhausted без единой проверки линтером.
    const s3 = writeBrief(A, 'c3', [['B01-hero', 'hero'], ['B02-text', 'conversion']]);
    wj(path.join(A, 'work', 'pages', 'c3', 'blocks', 'B01-hero.variants.json'), { attempts: 2, brief_sha: s3, variants: [] });
    writeBlock(A, 'c3', 'B02-text', 'pass');
    const c3 = pageProgress(A, 'c3');
    const hero3 = c3.blocks.find(b => b.block_id === 'B01-hero') || {};
    check('progress (№23): первый экран без блока, варианты с attempts 2 - pending, попыток 0 (no_answer селектора не засчитан)', canon(c3.pending) === canon(['B01-hero']) && !c3.exhausted.length && hero3.attempts === 0 && !hero3.exhausted && !hero3.written && !c3.complete && !c3.hero_done, JSON.stringify(c3.blocks));
    // турнир: файлы трех писателей с attempts 2 - тоже не попытки
    for (const k of ['w1', 'w2', 'w3']) wj(path.join(A, 'work', 'pages', 'c3', 'blocks', `B01-hero.variants.${k}.json`), { attempts: 2, brief_sha: s3, variants: [] });
    const c3t = pageProgress(A, 'c3');
    check('progress (№23): файлы вариантов турнира (.variants.w1..w3) attempts не дают', canon(c3t.pending) === canon(['B01-hero']) && !c3t.exhausted.length, JSON.stringify(c3t.blocks));
    // селектор записал блок после неудачи линтера: attempts 1 (первая настоящая неудача) - pending, хотя варианты с attempts 2
    writeBlock(A, 'c3', 'B01-hero', 'fix', { attempts: 1, brief_sha: s3 });
    const c3a = pageProgress(A, 'c3');
    check('progress (№23): блок первого экрана attempts 1 при вариантах с attempts 2 - pending (счет по блоку)', canon(c3a.pending) === canon(['B01-hero']) && (c3a.blocks.find(b => b.block_id === 'B01-hero') || {}).attempts === 1, JSON.stringify(c3a.blocks));
    // вторая настоящая неудача по тому же срезу - exhausted; по старому срезу - pending
    writeBlock(A, 'c3', 'B01-hero', 'fix', { attempts: 2, brief_sha: s3 });
    const c3b = pageProgress(A, 'c3');
    check('progress (№23): блок первого экрана, две неудачи линтера по тому же срезу - exhausted', canon(c3b.exhausted) === canon(['B01-hero']) && c3b.complete && !c3b.hero_done, JSON.stringify(c3b.blocks));
    writeBlock(A, 'c3', 'B01-hero', 'fix', { attempts: 2, brief_sha: 'старый' });
    check('progress (№23): блок первого экрана attempts 2 по старому срезу - pending', canon(pageProgress(A, 'c3').pending) === canon(['B01-hero']));
    // №23, повторная проверка: неудача - только по отчету линтера к текущему содержимому блока. Блок attempts 2 без
    // отчета (писатель записал и не ответил до lint) - pending; отчет с block_sha другого содержимого (прежняя попытка) -
    // pending и без причин прежнего отчета; block_sha текущего файла - exhausted; отчет без block_sha (старые задачи) -
    // как раньше (c1 выше)
    const heroFile = path.join(A, 'work', 'pages', 'c3', 'blocks', 'B01-hero.json');
    const heroLint = path.join(A, 'work', 'audit', 'c3', 'lint-B01-hero.json');
    writeBlock(A, 'c3', 'B01-hero', null, { attempts: 2, brief_sha: s3 });
    fs.rmSync(heroLint, { force: true });
    const c3n = pageProgress(A, 'c3');
    const h3n = c3n.blocks.find(b => b.block_id === 'B01-hero') || {};
    check('progress (№23): блок attempts 2 без отчета линтера - pending, не exhausted (no_answer до lint не засчитан)', canon(c3n.pending) === canon(['B01-hero']) && !c3n.exhausted.length && h3n.written && h3n.attempts === 2 && !h3n.exhausted && !c3n.complete, JSON.stringify(c3n.blocks));
    const failRep = blockSha => ({ verdict: 'fix', block_sha: blockSha, findings: [{ severity: 'major', rule: 'fact.unknown', problem: 'нет факта в брифе' }] });
    wj(heroLint, failRep(sha1('{"другой":"блок"}\n')));
    const c3s = pageProgress(A, 'c3');
    const h3s = c3s.blocks.find(b => b.block_id === 'B01-hero') || {};
    check('progress (№23): отчет линтера прежнего содержимого (block_sha не совпал) - pending, причины прежнего отчета не показаны', canon(c3s.pending) === canon(['B01-hero']) && !c3s.exhausted.length && !h3s.exhausted && !(h3s.reasons || []).length, JSON.stringify(c3s.blocks));
    wj(heroLint, failRep(sha1(fs.readFileSync(heroFile))));
    const c3f = pageProgress(A, 'c3');
    check('progress (№23): отчет линтера к текущему содержимому (block_sha совпал), две неудачи - exhausted с причиной', canon(c3f.exhausted) === canon(['B01-hero']) && /fact\.unknown/.test(((c3f.blocks.find(b => b.block_id === 'B01-hero') || {}).reasons || []).join(' ')), JSON.stringify(c3f.blocks));
    wj(heroLint, { verdict: 'pass', block_sha: sha1('{"другой":"блок"}\n'), findings: [] });
    check('progress (№23): pass по отчету не зависит от block_sha (перенумерация блоков меняет файл, вердикт остается)', pageProgress(A, 'c3').hero_done);
    fs.rmSync(heroFile);
    fs.rmSync(heroLint);
    // свежесть аудита: page_sha против текущего page.md
    wt(path.join(A, 'work', 'pages', 'home', 'page.md'), '# Главная\n');
    wj(path.join(A, 'work', 'audit', 'home', 'round-1.json'), { findings: [{ id: 'j1', severity: 'major', rule: 'weak', problem: 'слабо', status: 'fixed' }] });
    wj(path.join(A, 'work', 'audit', 'home', 'lint-page.json'), { verdict: 'pass', findings: [], page_sha: sha1('# Главная\n') });
    const h2 = pageProgress(A, 'home');
    check('progress: page_sha совпадает - аудит свежий, готово', h2.audit_fresh && h2.ready && h2.status === 'готово' && h2.audit_last_round === 1, JSON.stringify(h2).slice(0, 300));
    wt(path.join(A, 'work', 'pages', 'home', 'page.md'), '# Главная, новая\n');
    const h3 = pageProgress(A, 'home');
    check('progress: page.md изменился после аудита - аудит не свежий, статус написано', h3.audited && !h3.audit_fresh && !h3.ready && h3.status === 'написано');
    wj(path.join(A, 'work', 'audit', 'home', 'lint-page.json'), { verdict: 'pass', findings: [] });
    check('progress: lint-page без page_sha (старая задача) - аудит свежий', pageProgress(A, 'home').audit_fresh);
    // готово: открытые major последнего круга мешают, needs_fact - нет, прежние круги не считаются
    wj(path.join(A, 'work', 'audit', 'home', 'blind.json'), { findings: [{ id: 'b1', severity: 'major', rule: 'blind', problem: 'нужен факт', needs_fact: true, status: 'open' }] });
    const h4 = pageProgress(A, 'home');
    check('progress: needs_fact не снимает готовность, считается вопросом', h4.ready && h4.needs_fact_open === 1, JSON.stringify({ ready: h4.ready, nf: h4.needs_fact_open }));
    wj(path.join(A, 'work', 'audit', 'home', 'round-1.json'), { findings: [{ id: 'j1', severity: 'major', rule: 'weak', problem: 'слабо', status: 'open' }] });
    check('progress: открытый major последнего круга - не готово', !pageProgress(A, 'home').ready && pageProgress(A, 'home').open_serious === 1);
    wj(path.join(A, 'work', 'audit', 'home', 'round-2.json'), { findings: [{ id: 'j2', severity: 'minor', rule: 'style', problem: 'мелочь', status: 'open' }, { id: 'j3', severity: 'major', rule: 'weak', problem: 'x', status: 'wontfix' }] });
    const h5 = pageProgress(A, 'home');
    check('progress: круг 2 закрыл major круга 1 - готово; wontfix считается «закрыто без правки»', h5.ready && h5.open.minor === 1 && h5.closed_no_fix.length === 1 && h5.closed_no_fix[0].id === 'j3' && h5.audit_last_round === 2, JSON.stringify(h5.open));
    // круг 2 (scope=fixed) смотрит только правленые блоки: открытый major круга 1 вне fixer.blocks_touched снимает готовность
    wj(path.join(A, 'work', 'audit', 'home', 'round-1.json'), { fixer: { blocks_touched: ['B01-hero'] }, findings: [
      { id: 'j1', block_id: 'B02-text', severity: 'major', rule: 'weak', problem: 'слабо', status: 'open' },
      { id: 'j4', block_id: 'B01-hero', severity: 'major', rule: 'weak', problem: 'x', status: 'open' },
      { id: 'j5', block_id: 'B02-text', severity: 'minor', rule: 'fact', problem: 'нужен срок', needs_fact: true, status: 'open' },
    ] });
    const h6 = pageProgress(A, 'home');
    check('progress: открытый major круга 1 вне правленых блоков - не готово; на правленом блоке решает круг 2; needs_fact по всем кругам', !h6.ready && h6.carried === 1 && h6.open.major === 1 && h6.needs_fact_open === 2, JSON.stringify({ ready: h6.ready, carried: h6.carried, open: h6.open, nf: h6.needs_fact_open }));
    const none = pageProgress(A, 'nope');
    check('progress: страница без брифа - нет брифа', !none.briefed && none.status === 'нет брифа');
  }

  // ================================================================== 2. волны
  {
    const W1 = mkProject('waves1');
    writeMap(W1, [mapPage('home', 'home', 0)]);
    const w1 = waves(W1);
    check('волны: карта из 1 страницы - волна 1 = главная, волна 2 пуста', canon(w1[1]) === canon(['home']) && w1[2].length === 0);
    const W5 = mkProject('waves5');
    writeMap(W5, [mapPage('home', 'home', 0), mapPage('c1', 'category', 1), mapPage('c2', 'category', 2), mapPage('s1', 'service', 3), mapPage('about', 'info_about', 4), mapPage('old', 'category', 5, { status: 'skip' })]);
    const w5 = waves(W5);
    check('волны: 5 страниц - волна 1 главная и первая категория (у услуги одна страница)', canon(w5[1]) === canon(['home', 'c1']) && canon(w5[2]) === canon(['c2', 's1', 'about']) && !('old' in w5.of), JSON.stringify(w5));
    const W60 = mkProject('waves60');
    const big = [mapPage('home', 'home', 0)];
    for (let i = 1; i <= 2; i++) big.push(mapPage(`hub${i}`, 'hub', big.length));
    big.push(mapPage('poisk', 'info_other', big.length, { ui_role: 'search' }));
    for (let i = 1; i <= 30; i++) big.push(mapPage(`cat${i}`, 'category', big.length));
    for (let i = 1; i <= 20; i++) big.push(mapPage(`svc${i}`, 'service', big.length));
    big.push(mapPage('tovar', 'product', big.length, { template: true }));
    for (const s of ['o1', 'o2', 'o3']) big.push(mapPage(s, 'info_other', big.length));
    big.push(mapPage('about', 'info_about', big.length));
    big.push(mapPage('contacts', 'info_contacts', big.length));
    check('волны: карта 60 страниц собрана', big.length === 60, big.length);
    writeMap(W60, big);
    const w60 = waves(W60);
    check('волны: 60 страниц - волна 1 главная и первая обычная страница каждого типа с 2+ страницами (поиск не образец)', canon(w60[1]) === canon(['home', 'hub1', 'cat1', 'svc1', 'o1']) && w60[2].length === 55, canon(w60[1]));
    // стабильность: волна 1 написана целиком - состав волн тот же
    for (const s of w60[1]) { writeBrief(W60, s, [['B01-hero', 'hero']]); writeBlock(W60, s, 'B01-hero', 'pass'); }
    check('волны: состав не зависит от прогресса', canon(waves(W60)) === canon(w60));
    const pw = runJson(W60, ['scripts/plan-run.mjs', '--phase', 'audit', '--wave', '1']);
    check('plan-run --wave 1 --phase audit: дописанная волна 1 целиком', pw.code === 0 && canon(pw.json?.pages?.map(p => p.slug)) === canon(w60[1]) && pw.json.pages.every(p => p.wave === 1), pw.out.slice(0, 300));
    const pw2 = runJson(W60, ['scripts/plan-run.mjs', '--phase', 'audit', '--wave', '2']);
    check('plan-run --wave 2 --phase audit: волна 2 не написана - пусто', pw2.code === 0 && pw2.json.pages.length === 0);

    // ================================================================== 3. турнир первого экрана
    const T = tournamentSlugs(rj(path.join(W60, 'work', 'sitemap.json')));
    check('турнир: главная, хабы, первая категория и первая услуга', canon([...T].sort()) === canon(['cat1', 'home', 'hub1', 'hub2', 'svc1']), canon([...T]));
    for (const s of ['cat2', 'o2', 'tovar']) writeBrief(W60, s, [['B01-hero', 'hero']]);
    const def = runJson(W60, ['scripts/plan-run.mjs', '--slugs', 'home,hub2,cat2,o2,tovar,svc1']);
    const mode = (r, s) => (r.json?.pages || []).find(p => p.slug === s)?.hero_mode;
    check('plan-run: hero.mode first-of-type', def.json?.hero?.mode === 'first-of-type' && canon(def.json.hero.first_of_types) === canon(['service', 'category']), JSON.stringify(def.json?.hero));
    check('plan-run: вторая категория, инфо и шаблон - single; хаб - tournament', mode(def, 'cat2') === 'single' && mode(def, 'o2') === 'single' && mode(def, 'tovar') === 'single' && mode(def, 'hub2') === 'tournament', def.out.slice(0, 300));
    check('plan-run: написанные главная и svc1 в фазе write не отдаются', !mode(def, 'home') && !mode(def, 'svc1'));
    const bt = runJson(W60, ['scripts/plan-run.mjs', '--slugs', 'cat2,o2', '--tournament-types', 'category']);
    check('plan-run: --tournament-types category - вся категория турнир (by-type)', bt.json?.hero?.mode === 'by-type' && mode(bt, 'cat2') === 'tournament' && mode(bt, 'o2') === 'single');
    const hs = runJson(W60, ['scripts/plan-run.mjs', '--slugs', 'cat2,hub2', '--hero', 'single']);
    check('plan-run: --hero single - все single', mode(hs, 'cat2') === 'single' && mode(hs, 'hub2') === 'single');
  }

  // ================================================================== 3b. plan-run: exhausted не отдается, страница в аудит
  {
    const E = mkProject('exhausted');
    writeMap(E, [mapPage('home', 'home', 0), mapPage('c1', 'category', 1), mapPage('c2', 'category', 2)]);
    writeBrief(E, 'home', [['B01-hero', 'hero']], { type: 'home' }); writeBlock(E, 'home', 'B01-hero', 'pass');
    const s = writeBrief(E, 'c1', [['B01-hero', 'hero'], ['B02-text', 'conversion'], ['B03-faq', 'info']]);
    writeBlock(E, 'c1', 'B01-hero', 'pass'); writeBlock(E, 'c1', 'B02-text', 'fix', { attempts: 2, brief_sha: s }); writeBlock(E, 'c1', 'B03-faq', 'fix', { attempts: 1, brief_sha: s });
    writeBrief(E, 'c2', [['B01-hero', 'hero']]); writeBlock(E, 'c2', 'B01-hero', 'pass');
    const w = runJson(E, ['scripts/plan-run.mjs']);
    const c1 = w.json?.pages?.find(p => p.slug === 'c1');
    check('plan-run write: exhausted не в pending, следующий блок страницы отдается', !!c1 && canon(c1.pending_blocks) === canon(['B03-faq']) && canon(c1.exhausted_blocks) === canon(['B02-text']) && canon(c1.lint_dirty) === canon(['B02-text', 'B03-faq']), JSON.stringify(c1));
    writeBlock(E, 'c1', 'B03-faq', 'blocked', { attempts: 2, brief_sha: s });
    const w2 = runJson(E, ['scripts/plan-run.mjs']);
    check('plan-run write: остались только exhausted - писать нечего', w2.code === 0 && w2.json.pages.length === 0, w2.out.slice(0, 300));
    const au = runJson(E, ['scripts/plan-run.mjs', '--phase', 'audit']);
    const ac1 = au.json?.pages?.find(p => p.slug === 'c1');
    check('plan-run audit: страница с exhausted-блоками дописана и идет в аудит', !!ac1 && ac1.complete && ac1.exhausted_blocks.length === 2 && ac1.audit_fresh === false, JSON.stringify(ac1));
  }

  // ================================================================== 4. task.mjs
  {
    const C = path.join(tmpRoot, 'client');
    fs.mkdirSync(path.join(C, '.claude', 'tmp'), { recursive: true });
    fs.cpSync(SKILL, path.join(C, '.claude', 'skills', 'site-tekst'), { recursive: true });
    const task = (...args) => run(C, [TASK_MJS, ...args]);
    const meta = rel => rj(path.join(C, rel, 'meta.json'));
    wt(path.join(C, '.claude', 'tmp', 'current-task.txt'), 'texts/001-a/\ntexts/002-b/\ntexts/003-c/\ntexts/004-d/\n');
    const i1 = task('init', '--task', 'texts/001-a', '--doc', 'D1', '--slug', 'a');
    check('init без паузы: stop нет, строка «остановка: нет»', i1.code === 0 && !('stop' in meta('texts/001-a')) && /остановка: нет/.test(i1.stdout), i1.out.slice(0, 400));
    const i2 = task('init', '--task', 'texts/002-b', '--doc', 'D1', '--slug', 'b', '--pilot', 'home, c1');
    check('init --pilot: stop pilot и meta.pilot', i2.code === 0 && meta('texts/002-b').stop === 'pilot' && meta('texts/002-b').pilot === 'home,c1', i2.out.slice(0, 300));
    const i3 = task('init', '--task', 'texts/003-c', '--doc', 'D1', '--slug', 'c', '--allow-ungated');
    check('init --allow-ungated без --stop: stop pilot', i3.code === 0 && meta('texts/003-c').stop === 'pilot' && meta('texts/003-c').allow_ungated === true, i3.out.slice(0, 300));
    const i4 = task('init', '--task', 'texts/004-d', '--doc', 'D1', '--slug', 'd', '--stop', 'map', '--pilot', 'home');
    const i5 = task('init', '--task', 'texts/004-d', '--doc', 'D1', '--slug', 'd', '--stop', 'wave');
    check('init: --stop map с --pilot и --stop чужое - код 1, папки нет', i4.code === 1 && i5.code === 1 && !fs.existsSync(path.join(C, 'texts', '004-d')), `${i4.out} | ${i5.out}`);
    const i6 = task('init', '--task', 'texts/004-d', '--doc', 'D1', '--slug', 'd', '--stop', 'strategy');
    check('init --stop strategy', i6.code === 0 && meta('texts/004-d').stop === 'strategy');

    // stop: ручная пауза, автостоп, снятие
    const A1 = 'texts/001-a';
    check('stop --set map', task('stop', '1', '--set', 'map').code === 0 && meta(A1).stop === 'map');
    const au = task('stop', '1', '--autostop', 'брифов меньше половины рабочих страниц');
    check('stop --autostop: причина в meta.autostop, пауза остается', au.code === 0 && meta(A1).autostop === 'брифов меньше половины рабочих страниц' && meta(A1).stop === 'map' && /автостоп: брифов/.test(au.stdout), au.out);
    const c1 = task('stop', '1', '--clear');
    check('stop --clear: сначала снимается автостоп', c1.code === 0 && !('autostop' in meta(A1)) && meta(A1).stop === 'map', c1.out);
    const c2 = task('stop', '1', '--clear');
    check('stop --clear второй раз: снята пауза', c2.code === 0 && !('stop' in meta(A1)) && /остановка: нет/.test(c2.stdout), c2.out);
    check('stop: --set чужое, --autostop без причины, --pilot без --set pilot - код 1', task('stop', '1', '--set', 'wave').code === 1 && task('stop', '1', '--autostop').code === 1 && task('stop', '1', '--set', 'map', '--pilot', 'home').code === 1);
    check('stop --set pilot --pilot', task('stop', '1', '--set', 'pilot', '--pilot', 'home,c2').code === 0 && meta(A1).pilot === 'home,c2' && meta(A1).stop === 'pilot');
    task('stop', '1', '--autostop', 'x'); task('stop', '1', '--clear', 'all');
    check('stop --clear all: снимает и автостоп, и паузу', !('autostop' in meta(A1)) && !('stop' in meta(A1)));
    // пустая строка stop (update-meta.sh stop=) - паузы нет
    { const m = meta(A1); m.stop = ''; delete m.pilot; wj(path.join(C, A1, 'meta.json'), m); }

    // данные задачи 001: главная, 3 категории, услуга; главная и c1 написаны, у c2 exhausted-блок
    const TA = path.join(C, A1);
    writeMap(TA, [mapPage('home', 'home', 0), mapPage('c1', 'category', 1), mapPage('c2', 'category', 2), mapPage('c3', 'category', 3), mapPage('s1', 'service', 4)]);
    writeBrief(TA, 'home', [['B01-hero', 'hero'], ['B02-text', 'conversion']], { type: 'home' });
    writeBrief(TA, 'c1', [['B01-hero', 'hero']]);
    const sc2 = writeBrief(TA, 'c2', [['B01-hero', 'hero'], ['B02-text', 'conversion']]);
    writeBrief(TA, 'c3', [['B01-hero', 'hero']]);
    writeBrief(TA, 's1', [['B01-hero', 'hero']], { type: 'service' });
    const st1 = task('status', '1');
    check('status: остановка нет, волна 1 = 2 стр. (главная, c1), волна 2 = 3 стр., без предложения пилота', st1.code === 0 && /остановка: нет/.test(st1.stdout) && /волна 1: 2 стр\., брифов 2, дописано 0/.test(st1.stdout) && /волна 2: 3 стр\., брифов 3/.test(st1.stdout) && !/пилот/.test(st1.stdout), st1.out);
    const aw1 = runJson(C, [TASK_MJS, 'args', '1', 'write']);
    check('args write без выборки: волна 1 (главная и c1), concurrency 4', aw1.code === 0 && canon(aw1.json?.pages?.map(p => p.slug)) === canon(['home', 'c1']) && aw1.json.concurrency === 4 && /волна 1/.test(aw1.stderr), aw1.out.slice(0, 300));
    check('args write: все поля plan-run (hero_mode, wave, exhausted_blocks) без потерь', aw1.json?.pages?.every(p => p.hero_mode === 'tournament' && p.wave === 1 && Array.isArray(p.exhausted_blocks) && p.hero_block_id === 'B01-hero'), JSON.stringify(aw1.json?.pages?.[0]));
    for (const [s, ids] of [['home', ['B01-hero', 'B02-text']], ['c1', ['B01-hero']]]) for (const id of ids) writeBlock(TA, s, id, 'pass');
    writeBlock(TA, 'c2', 'B01-hero', 'pass'); writeBlock(TA, 'c2', 'B02-text', 'fix', { attempts: 2, brief_sha: sc2 });
    const aw2 = runJson(C, [TASK_MJS, 'args', '1', 'write']);
    check('args write: волна 1 дописана - волна 2 без c2 (только exhausted), concurrency 4', aw2.code === 0 && canon(aw2.json?.pages?.map(p => p.slug)) === canon(['c3', 's1']) && /волна 2/.test(aw2.stderr), aw2.out.slice(0, 300));
    const aws = runJson(C, [TASK_MJS, 'args', '1', 'write', '--slugs', 'c2,c3']);
    check('args write --slugs: выборка без волн, concurrency 1', aws.code === 0 && canon(aws.json?.pages?.map(p => p.slug)) === canon(['c3']) && aws.json.concurrency === 1);
    for (const s of ['c3', 's1']) writeBlock(TA, s, 'B01-hero', 'pass');
    const aw3 = task('args', '1', 'write');
    check('args write: остались только exhausted-блоки - код 4', aw3.code === 4 && /exhausted/.test(aw3.stderr), aw3.out);
    // аудит: все дописанные без аудита, у c2 exhausted - тоже; round - следующий круг
    const aa = runJson(C, [TASK_MJS, 'args', '1', 'audit']);
    check('args audit: дописанные страницы (и с exhausted), round 1', aa.code === 0 && canon(aa.json?.pages?.map(p => p.slug)) === canon(['home', 'c1', 'c2', 'c3', 's1']) && aa.json.pages.every(p => p.round === 1), aa.out.slice(0, 300));
    for (const s of ['home', 'c1', 'c2', 'c3', 's1']) {
      wt(path.join(TA, 'work', 'pages', s, 'page.md'), `# ${s}\n`);
      wj(path.join(TA, 'work', 'audit', s, 'round-1.json'), { findings: [] });
      wj(path.join(TA, 'work', 'audit', s, 'round-2.json'), { findings: [] });
      wj(path.join(TA, 'work', 'audit', s, 'lint-page.json'), { verdict: 'pass', findings: [], page_sha: sha1(`# ${s}\n`) });
    }
    const aa2 = task('args', '1', 'audit');
    check('args audit: аудит свежий у всех - код 4', aa2.code === 4 && /свежий/.test(aa2.stderr), aa2.out);
    wt(path.join(TA, 'work', 'pages', 'c1', 'page.md'), '# c1 переписана\n');
    const aa3 = runJson(C, [TASK_MJS, 'args', '1', 'audit']);
    check('args audit: page.md изменился после аудита - повторный аудит со следующего круга (3)', aa3.code === 0 && canon(aa3.json?.pages) === canon([{ slug: 'c1', type: 'category', round: 3 }]), aa3.out.slice(0, 300));
    const aa4 = runJson(C, [TASK_MJS, 'args', '1', 'audit', '--all']);
    check('args audit --all: все дописанные', aa4.code === 0 && aa4.json.pages.length === 5);
    const st2 = task('status', '1');
    check('status: блоки и exhausted, прототип не собран', /блоки: прошли линтер 6 из 7, недописано 1 \(14%\), из них exhausted 1/.test(st2.stdout) && /прототип: не собран/.test(st2.stdout) && st2.stdout.trim().split('\n').length <= 15, st2.out);

    // пилот: пауза pilot без meta.pilot - предложение (главная + первая категория)
    const TB = path.join(C, 'texts', '003-c');
    writeMap(TB, [mapPage('home', 'home', 0), mapPage('s1', 'service', 1), mapPage('c1', 'category', 2), mapPage('c2', 'category', 3)]);
    for (const s of ['home', 's1', 'c1', 'c2']) writeBrief(TB, s, [['B01-hero', 'hero']], { type: s === 'home' ? 'home' : s.startsWith('s') ? 'service' : 'category' });
    const st3 = task('status', '3');
    check('status при паузе pilot: предложение пилота (главная + первая категория)', /остановка: pilot/.test(st3.stdout) && /пилот \(предложение\): home,c1/.test(st3.stdout), st3.out);
    const ap = runJson(C, [TASK_MJS, 'args', '3', 'write']);
    check('args write при паузе pilot: только пилот, concurrency 1', ap.code === 0 && canon(ap.json?.pages?.map(p => p.slug)) === canon(['home', 'c1']) && ap.json.concurrency === 1 && /пилот home,c1/.test(ap.stderr), ap.out.slice(0, 300));
    const apw = runJson(C, [TASK_MJS, 'args', '3', 'write', '--wave', '2']);
    check('args write --wave 2 при паузе pilot: явная выборка важнее пилота', apw.code === 0 && canon(apw.json?.pages?.map(p => p.slug)) === canon(['s1', 'c2']));
    const TBm = path.join(C, 'texts', '002-b');
    writeMap(TBm, [mapPage('home', 'home', 0), mapPage('c1', 'category', 1), mapPage('c2', 'category', 2)]);
    for (const s of ['home', 'c1', 'c2']) writeBrief(TBm, s, [['B01-hero', 'hero']]);
    writeBlock(TBm, 'home', 'B01-hero', 'pass'); writeBlock(TBm, 'c1', 'B01-hero', 'pass');
    const apd = task('args', '2', 'write');
    check('args write при паузе pilot: пилот (meta.pilot) дописан - код 4', apd.code === 4 && /пилот дописан/.test(apd.stderr), apd.out);
    check('status: пилот из meta', /пилот: home,c1/.test(task('status', '2').stdout));
    // decisions.md после init - копия шаблона с маркером v2: составитель решений не отработал (автостоп после фазы 0)
    wj(path.join(TA, 'work', 'facts.json'), { facts: [], gaps: [] });
    const sd1 = task('status', '1');
    fs.appendFileSync(path.join(TA, 'rules', 'decisions.md'), '\n| F01 | конфликт | «с 2008 года» | все |\n');
    const sd2 = task('status', '1');
    check('status: decisions.md - копия шаблона видна, заполненный v2 - просто v2', /decisions\.md: v2, копия шаблона \(составитель не отработал\)/.test(sd1.stdout) && /decisions\.md: v2$/m.test(sd2.stdout), `${sd1.out} | ${sd2.out}`);

    // ---------- place (K9): overrides по видам, база сверки полных замен в meta.json (в git) ----------
    const KITC = path.join(C, '.claude', 'skills', 'site-tekst', 'kit');
    // blob id так же, как git: сверка формулы task.mjs с git hash-object (нет git - формула)
    const blobOf = f => { const r = spawnSync('git', ['hash-object', '--no-filters', f], { encoding: 'utf8' }); return !r.error && r.status === 0 ? r.stdout.trim() : blobId(fs.readFileSync(f)); };
    // смена worktree: копии kit и манифеста нет (кеш вне git), данные задачи (meta.json, overrides/) - на месте
    const newWorktree = () => {
      fs.rmSync(path.join(TA, '.kit.json'), { force: true });
      for (const d of ['workflows', 'prompts', 'scripts', 'schemas', 'html']) fs.rmSync(path.join(TA, d), { recursive: true, force: true });
      for (const f of fs.readdirSync(path.join(TA, 'rules'))) if (f !== 'decisions.md') fs.rmSync(path.join(TA, 'rules', f), { force: true });
      fs.rmSync(path.join(TA, 'CLAUDE.md'), { force: true }); fs.rmSync(path.join(TA, 'config', 'house_style.md'), { force: true });
    };
    const ov = path.join(TA, 'overrides', 'rules', 'hero.md');
    fs.mkdirSync(path.dirname(ov), { recursive: true });
    fs.copyFileSync(path.join(TA, 'rules', 'hero.md'), ov);
    fs.appendFileSync(ov, '\nправило проекта\n');
    const p1 = task('place', '1');
    const base1 = (meta(A1).overrides_base || {})['rules/hero.md'] || {};
    check('place: полная замена - «закрывают файлы kit», база сверки в meta.json (git blob id kit и override), без «kit обновил»', p1.code === 0 && /overrides закрывают файлы kit \(1\): rules\/hero\.md/.test(p1.stdout) && /база сверки записана[^\n]*rules\/hero\.md/.test(p1.stdout) && !/kit обновил/.test(p1.stdout) && base1.kit === blobOf(path.join(KITC, 'rules', 'hero.md')) && base1.ov === blobOf(ov), `${p1.out} ${JSON.stringify(base1)}`);
    check('place: первая база без истории git - строка «по текущему kit» с готовой командой сравнения из корня проекта', /база сверки записана в meta\.json \(overrides_base\) по текущему kit[^\n]*rules\/hero\.md - git diff --no-index \.claude\/skills\/site-tekst\/kit\/rules\/hero\.md texts\/001-a\/overrides\/rules\/hero\.md/.test(p1.stdout), p1.out);
    const p1b = task('place', '1');
    check('place повторно: ничего не копирует, строка базы не повторяется', p1b.code === 0 && /скопировано 0,/.test(p1b.stdout) && !/база сверки записана/.test(p1b.stdout), p1b.out);
    newWorktree();
    const p2 = task('place', '1');
    check('place в новой worktree, kit не менялся: копия с override восстановлена, ни «kit обновил», ни «нет базы»', p2.code === 0 && !/kit обновил|нет базы|база сверки записана/.test(p2.stdout) && fs.readFileSync(path.join(TA, 'rules', 'hero.md'), 'utf8') === fs.readFileSync(ov, 'utf8'), p2.out);
    const heroOld = blobOf(path.join(KITC, 'rules', 'hero.md'));
    fs.appendFileSync(path.join(KITC, 'rules', 'hero.md'), '\nновое правило kit\n');
    newWorktree();
    const p3 = task('place', '1');
    const heroNew = blobOf(path.join(KITC, 'rules', 'hero.md'));
    check('place: kit обновил файл под полной заменой, новая worktree - предупреждение с готовой командой git diff <база> <kit>', p3.code === 0 && new RegExp(`kit обновил их с прошлой сверки[^\\n]*rules/hero\\.md - git diff ${heroOld} ${heroNew}`).test(p3.stdout), p3.out);
    const p4 = task('place', '1');
    check('place: предупреждение держится, пока override не изменен', p4.code === 0 && /kit обновил их с прошлой сверки[^\n]*rules\/hero\.md/.test(p4.stdout), p4.out);
    fs.appendFileSync(ov, '\nсверено с новым kit\n');
    const p5 = task('place', '1');
    check('place: override изменен (сверен) - предупреждения нет, база сдвинута на текущий kit', p5.code === 0 && /overrides закрывают файлы kit/.test(p5.stdout) && !/kit обновил/.test(p5.stdout) && meta(A1).overrides_base['rules/hero.md'].kit === heroNew, p5.out);
    // сверено, override оставлен как есть: --reconciled сдвигает базу без пустой правки override
    fs.appendFileSync(path.join(KITC, 'rules', 'hero.md'), '\nеще правило kit\n');
    const heroNew2 = blobOf(path.join(KITC, 'rules', 'hero.md'));
    const p6 = task('place', '1');
    check('place: строка «kit обновил» называет отметку сверки task.mjs place <задача> --reconciled <путь>', p6.code === 0 && /kit обновил их с прошлой сверки[^\n]*task\.mjs place texts\/001-a --reconciled <путь>[^\n]*rules\/hero\.md - git diff/.test(p6.stdout), p6.out);
    const p7 = task('place', '1', '--reconciled', 'rules/nope.md');
    const p7b = task('place', '1', '--reconciled');
    check('place --reconciled: путь не полной замены или без пути - код 1, база не тронута', p7.code === 1 && /--reconciled: не полная замена файла kit: rules\/nope\.md \(полные замены: rules\/hero\.md\)/.test(p7.stderr) && p7b.code === 1 && meta(A1).overrides_base['rules/hero.md'].kit === heroNew, `${p7.out} | ${p7b.out}`);
    const p8 = task('place', '1', '--reconciled', 'overrides/rules/hero.md');
    const p9 = task('place', '1');
    check('place --reconciled <путь>: сверка отмечена, база сдвинута на текущий kit, дальше без предупреждения', p8.code === 0 && /сверка отмечена \(--reconciled\), база сдвинута на текущий kit: rules\/hero\.md/.test(p8.stdout) && !/kit обновил/.test(p8.stdout) && meta(A1).overrides_base['rules/hero.md'].kit === heroNew2 && p9.code === 0 && !/kit обновил|сверка отмечена/.test(p9.stdout), `${p8.out} | ${p9.out}`);

    // слияние .json по RFC 7396 (примеры приложения A RFC)
    const rfc = [
      [{ a: 'b' }, { a: 'c' }, { a: 'c' }], [{ a: 'b' }, { b: 'c' }, { a: 'b', b: 'c' }], [{ a: 'b' }, { a: null }, {}],
      [{ a: 'b', b: 'c' }, { a: null }, { b: 'c' }], [{ a: ['b'] }, { a: 'c' }, { a: 'c' }], [{ a: 'c' }, { a: ['b'] }, { a: ['b'] }],
      [{ a: { b: 'c' } }, { a: { b: 'd', c: null } }, { a: { b: 'd' } }], [{ a: [{ b: 'c' }] }, { a: [1] }, { a: [1] }],
      [['a', 'b'], ['c', 'd'], ['c', 'd']], [{ a: 'b' }, ['c'], ['c']], [{ a: 'foo' }, null, null], [{ a: 'foo' }, 'bar', 'bar'],
      [{ e: null }, { a: 1 }, { e: null, a: 1 }], [[1, 2], { a: 'b', c: null }, { a: 'b' }], [{}, { a: { bb: { ccc: null } } }, { a: { bb: {} } }],
    ];
    const rfcBad = rfc.filter(([t, p, want]) => canon(mergePatch(t, p)) !== canon(want));
    check('mergePatch: примеры RFC 7396 (приложение A)', !rfcBad.length, JSON.stringify(rfcBad));
    const kitLint = rj(path.join(KITC, 'rules', 'lint.json'));
    const lintOv = path.join(TA, 'overrides', 'rules', 'lint.json');
    wj(lintOv, { stop_words: ['слово проекта'], _doc: null, page_budgets: { x_project: 1 }, x_project: { a: [1] } });
    const j1 = task('place', '1');
    const placedLint = rj(path.join(TA, 'rules', 'lint.json'));
    check('place: .json override - слияние с kit (массив заменен, null удаляет ключ, объект дополнен), «дополняют kit»', j1.code === 0 && /overrides дополняют kit[^\n]*rules\/lint\.json/.test(j1.stdout) && canon(placedLint.stop_words) === canon(['слово проекта']) && !('_doc' in placedLint) && placedLint.page_budgets.x_project === 1 && Object.keys(kitLint.page_budgets).every(k => k in placedLint.page_budgets) && canon(placedLint.x_project) === canon({ a: [1] }) && canon(placedLint.ai_patterns) === canon(kitLint.ai_patterns) && !(meta(A1).overrides_base || {})['rules/lint.json'], j1.out);
    const j2 = task('place', '1');
    check('place: повторный без изменений - слияние не копируется заново (same, не copied)', j2.code === 0 && /скопировано 0,/.test(j2.stdout), j2.out);
    const kl = rj(path.join(KITC, 'rules', 'lint.json')); kl.x_kit_new = 7; wj(path.join(KITC, 'rules', 'lint.json'), kl);
    const j3 = task('place', '1');
    check('place: kit обновил .json под слиянием - новое значение kit доходит само, без предупреждения', j3.code === 0 && rj(path.join(TA, 'rules', 'lint.json')).x_kit_new === 7 && !/kit обновил/.test(j3.stdout), j3.out);
    wt(lintOv, '{ "stop_words": [ ');
    const j4 = task('place', '1');
    check('place: override .json - не JSON: код 1 с путем, копия не тронута', j4.code === 1 && /overrides\/rules\/lint\.json: не JSON/.test(j4.stderr) && rj(path.join(TA, 'rules', 'lint.json')).x_kit_new === 7, j4.out);
    fs.rmSync(lintOv);
    // совет кода 3 для .json («только измененные ключи») работает: копия с правкой в своем форматировании, правка перенесена
    // в overrides/ ключом - разобранный JSON копии равен итогу слияния, повтор без --force проходит
    check('place: overrides/rules/lint.json снят - копия снова из kit', task('place', '1').code === 0 && !('x_project' in rj(path.join(TA, 'rules', 'lint.json'))));
    const lintCopy = path.join(TA, 'rules', 'lint.json');
    { const l = rj(lintCopy); l.x_edit = 1; wt(lintCopy, JSON.stringify(l)); }
    const j5 = task('place', '1');
    check('place: правка .json на месте (свое форматирование) - код 3 со списком', j5.code === 3 && /rules\/lint\.json/.test(j5.stderr), j5.out);
    wj(lintOv, { x_edit: 1 });
    const j6 = task('place', '1');
    check('place: правка .json перенесена в overrides/ ключом - повтор без --force: код 0, итог слияния с правкой', j6.code === 0 && rj(lintCopy).x_edit === 1 && rj(lintCopy).x_kit_new === 7 && /overrides дополняют kit[^\n]*rules\/lint\.json/.test(j6.stdout), j6.out);
    fs.rmSync(lintOv);

    // дописка .md по пометке, короткая замена без пометки, без пары в kit, живые блоки проекта (K8)
    const infoOv = path.join(TA, 'overrides', 'rules', 'info.md');
    wt(infoOv, `﻿${APPEND_MARK}\n## Проект\nстрока проекта\n`);
    wt(path.join(TA, 'overrides', 'rules', 'conversion.md'), 'короткая замена\n');
    wt(path.join(TA, 'overrides', 'html', 'site-shell.html'), '<main></main>\n');
    wt(path.join(TA, 'overrides', 'html', 'site', 'behaviors', 'calc.js'), 'function (root, S) {}\n');
    wj(path.join(TA, 'overrides', 'html', 'site', 'registry.json'), { calc: { behavior: 'calc' } });
    const m1 = task('place', '1');
    const kitInfo = fs.readFileSync(path.join(KITC, 'rules', 'info.md'), 'utf8');
    const placedInfo = fs.readFileSync(path.join(TA, 'rules', 'info.md'), 'utf8');
    check('place: .md с пометкой - файл kit + дописка, без пометки, «дополняют kit»', m1.code === 0 && placedInfo === kitInfo + (kitInfo.endsWith('\n') ? '' : '\n') + '## Проект\nстрока проекта\n' && !placedInfo.includes('overrides:append') && /overrides дополняют kit[^\n]*rules\/info\.md/.test(m1.stdout), m1.out);
    check('place: .md без пометки короче половины файла kit - «похоже на дописку без пометки»', /похоже на дописку без пометки[^\n]*rules\/conversion\.md/.test(m1.stdout) && /overrides закрывают файлы kit[^\n]*rules\/conversion\.md/.test(m1.stdout), m1.out);
    const nopair = (m1.stdout.match(/^правки без пары в kit[^\n]*$/m) || [''])[0];
    check('place: override без пары в kit - своя строка; живые блоки K8 кладутся как есть и в эту строку не идут', /html\/site-shell\.html/.test(nopair) && !/behaviors|registry/.test(nopair) && fs.readFileSync(path.join(TA, 'html', 'site', 'behaviors', 'calc.js'), 'utf8') === 'function (root, S) {}\n' && rj(path.join(TA, 'html', 'site', 'registry.json')).calc.behavior === 'calc', m1.out);
    fs.appendFileSync(path.join(KITC, 'rules', 'info.md'), '\nправка kit в info\n');
    const m2 = task('place', '1');
    check('place: kit обновил файл под дописанным .md - правка kit доходит, дописка остается в конце', m2.code === 0 && /правка kit в info\n## Проект\nстрока проекта\n$/.test(fs.readFileSync(path.join(TA, 'rules', 'info.md'), 'utf8')), m2.out);
    for (const f of ['rules/info.md', 'rules/conversion.md', 'html/site-shell.html', 'html/site/behaviors/calc.js', 'html/site/registry.json']) fs.rmSync(path.join(TA, 'overrides', f));
    const m3 = task('place', '1');
    check('place: overrides сняты - файлы снова из kit, живые блоки удалены из копии', m3.code === 0 && fs.readFileSync(path.join(TA, 'rules', 'info.md'), 'utf8') === fs.readFileSync(path.join(KITC, 'rules', 'info.md'), 'utf8') && !fs.existsSync(path.join(TA, 'html', 'site', 'registry.json')) && canon(Object.keys(meta(A1).overrides_base)) === canon(['rules/hero.md']), m3.out);
    check('place: старый путь обновления kit (scripts/sync-from-template.mjs) в копию задачи не кладется', !fs.existsSync(path.join(TA, 'scripts', 'sync-from-template.mjs')) && fs.existsSync(path.join(TA, 'scripts', 'lib.mjs')));
    const oldSync = run(TA, [path.join(KITC, 'scripts', 'sync-from-template.mjs'), KITC]);
    check('kit sync-from-template.mjs в папке задачи /site-tekst - отказ (код 2) с путем через task.mjs place', oldSync.code === 2 && /task\.mjs place/.test(oldSync.stderr) && !fs.existsSync(path.join(TA, 'docs')), oldSync.out);

    // ---------- первая база по истории git: override старше K9 (сценарий Goldax - kit обновлен синком, override заморожен) ----------
    {
      const G = path.join(tmpRoot, 'gitclient');
      const git = (...args) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'core.autocrlf=false', '-c', 'commit.gpgsign=false', ...args], { cwd: G, encoding: 'utf8' });
      fs.mkdirSync(path.join(G, '.claude', 'tmp'), { recursive: true });
      const gi = git('init', '-q');
      if (gi.error || gi.status !== 0) skip('place: первая база по истории git', `git недоступен (${gi.error ? gi.error.message : gi.stderr})`);
      else {
        fs.cpSync(SKILL, path.join(G, '.claude', 'skills', 'site-tekst'), { recursive: true });
        wt(path.join(G, '.claude', 'tmp', 'current-task.txt'), 'texts/001-g/\n');
        const gt = (...args) => run(G, [TASK_MJS, ...args]);
        const KITG = path.join(G, '.claude', 'skills', 'site-tekst', 'kit');
        const TG = path.join(G, 'texts', '001-g');
        const ig = gt('init', '--task', 'texts/001-g', '--doc', 'D1', '--slug', 'g');
        // два старых override без базы в meta.json: hero.md (kit потом обновлен), info.md (kit не менялся)
        for (const f of ['hero.md', 'info.md']) { fs.mkdirSync(path.join(TG, 'overrides', 'rules'), { recursive: true }); fs.writeFileSync(path.join(TG, 'overrides', 'rules', f), fs.readFileSync(path.join(KITG, 'rules', f), 'utf8') + '\nправило проекта\n'); }
        git('add', '-A'); const c1g = git('commit', '-q', '-m', 'old overrides');
        const heroThen = blobOf(path.join(KITG, 'rules', 'hero.md'));
        fs.appendFileSync(path.join(KITG, 'rules', 'hero.md'), '\nправка kit после override\n');
        git('add', '-A'); git('commit', '-q', '-m', 'sync kit');
        const heroNowG = blobOf(path.join(KITG, 'rules', 'hero.md'));
        const g1 = gt('place', '1');
        const bg = rj(path.join(TG, 'meta.json')).overrides_base || {};
        check('place: первая база по истории git - kit обновлен после коммита override: сразу «kit обновил» с git diff <kit того коммита> <kit>, база в meta.json - kit того коммита', ig.code === 0 && c1g.status === 0 && g1.code === 0 && new RegExp(`kit обновил их с прошлой сверки[^\\n]*rules/hero\\.md - git diff ${heroThen} ${heroNowG}`).test(g1.stdout) && (bg['rules/hero.md'] || {}).kit === heroThen, `${ig.out.slice(0, 200)} ${c1g.stderr} ${g1.out} ${JSON.stringify(bg)}`);
        check('place: первая база по истории git - kit не менялся с коммита override: строка «по истории git», без «kit обновил» для него', /база сверки записана в meta\.json \(overrides_base\) по истории git[^\n]*rules\/info\.md/.test(g1.stdout) && !/kit обновил[^\n]*rules\/info\.md/.test(g1.stdout) && (bg['rules/info.md'] || {}).kit === blobOf(path.join(KITG, 'rules', 'info.md')), g1.out);
        const g2 = gt('place', '1');
        check('place: предупреждение по истории git держится до сверки (строка базы разовая)', g2.code === 0 && /kit обновил[^\n]*rules\/hero\.md/.test(g2.stdout) && !/база сверки записана/.test(g2.stdout), g2.out);
      }
    }

    // ---------- опечатки в --slugs и пилоте: код 2 со списком, а не молча суженная выборка ----------
    const ts1 = task('args', '1', 'write', '--slugs', 'c3,nope');
    const ts2 = task('args', '1', 'audit', '--slugs', 'zzz');
    check('args write/audit --slugs с незнакомым slug - код 2 со списком', ts1.code === 2 && /--slugs: нет среди рабочих страниц карты: nope/.test(ts1.stderr) && /страницы карты: home/.test(ts1.stderr) && ts2.code === 2 && /zzz/.test(ts2.stderr), `${ts1.out} | ${ts2.out}`);
    const pr2 = run(TA, ['scripts/plan-run.mjs', '--slugs', 'home,nope']);
    check('plan-run --slugs с незнакомым slug - код 2', pr2.code === 2 && /nope/.test(pr2.stderr), pr2.out);
    const sp1 = task('stop', '2', '--set', 'pilot', '--pilot', 'home,c9');
    check('stop --set pilot --pilot с незнакомым slug (карта есть) - код 2, meta не тронута', sp1.code === 2 && /c9/.test(sp1.stderr) && meta('texts/002-b').pilot === 'home,c1', sp1.out);
    { const m = meta('texts/002-b'); m.pilot = 'glavnaya'; wj(path.join(C, 'texts', '002-b', 'meta.json'), m); }
    const sp2 = task('args', '2', 'write');
    check('args write: пилот meta.pilot не из карты - код 2 с подсказкой, а не код 4 «пилот дописан»', sp2.code === 2 && /пилот \(meta\.pilot: glavnaya\)/.test(sp2.stderr) && /--set pilot --pilot/.test(sp2.stderr), sp2.out);
    { const m = meta('texts/002-b'); m.pilot = 'home,c1'; wj(path.join(C, 'texts', '002-b', 'meta.json'), m); }

    // ---------- строки status автостопов ----------
    wt(path.join(C, '.claude', 'tmp', 'current-task.txt'), 'texts/005-e/\ntexts/006-f/\n');
    check('init texts/005-e и 006-f', task('init', '--task', 'texts/005-e', '--doc', 'D1', '--slug', 'e').code === 0 && task('init', '--task', 'texts/006-f', '--doc', 'D1', '--slug', 'f').code === 0);
    const TE = path.join(C, 'texts', '005-e');
    writeMap(TE, [mapPage('home', 'home', 0), mapPage('c1', 'category', 1), mapPage('c2', 'category', 2), mapPage('s1', 'service', 3, { segment: '' })]);
    const she = writeBrief(TE, 'home', [['B01-hero', 'hero'], ['B02-a', 'x'], ['B03-b', 'y'], ['B04-c', 'z']], { type: 'home' });
    writeBlock(TE, 'home', 'B01-hero', 'pass');
    for (const id of ['B02-a', 'B03-b', 'B04-c']) writeBlock(TE, 'home', id, 'fix', { attempts: 2, brief_sha: she });
    wj(path.join(TE, 'work', 'facts.json'), { facts: [
      { id: 'F01', label: 'a', value: '1', publish: 'no' }, { id: 'F02', label: 'b', value: '2', publish: 'no' }, { id: 'F03', label: 'c', value: '3', publish: 'no' },
      { id: 'F801', label: 'оператор', value: '4', publish: 'yes' }, { id: 'F901', label: 'телефон', value: '5', publish: 'yes' },
    ], gaps: [] });
    wt(path.join(TE, 'work', 'output', 'prototype.html'), '<html></html>\n');
    const stE = task('status', '5');
    check('status: факты анализа без F8xx и F9xx - «анализа 3, из них publish yes 0», строка 0 фактов анализа', stE.code === 0 && /факты: 5 \(publish yes 2; анализа 3, из них publish yes 0\)/.test(stE.stdout) && /^фактов анализа с publish yes 0 из 3$/m.test(stE.stdout), stE.out);
    // цитаты строк status из таблицы автостопов (и Resume) SKILL.md: плейсхолдеры N, B, X - число, «...» - любой текст
    const SKILL_TEXT = fs.readFileSync(path.join(SKILL, 'SKILL.md'), 'utf8');
    const quotes = [];
    for (const line of SKILL_TEXT.split(/\r?\n/)) if (/`status`/.test(line)) for (const m of line.matchAll(/«([^«»]+)»/g)) quotes.push(m[1].trim());
    const quoteRe = q => new RegExp(q.split(/(\.\.\.|…|(?<![\p{L}\d])[NBX](?![\p{L}\d]))/u).map((part, i) => (i % 2 ? (/^[.…]/.test(part) ? '.*?' : '\\d+') : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).join(''), 'u');
    const AUTOSTOP_LINES = [
      ['после фазы 0: без сегмента', 'без сегмента'],
      ['после фазы 0: decisions.md', 'decisions.md:'],
      ['после фазы 4: брифов', 'брифов'],
      ['после волны 1: exhausted больше 30%', 'волна 1, exhausted'],
      ['после всех волн: недописано', 'блоки:'],
      ['resume: прототип старого kit', 'собран старым kit'],
      ['после фазы 0: 0 фактов анализа с publish yes', 'фактов анализа с publish yes 0'],
    ];
    // Цитаты, которые расходятся с кодом (найдено этим тестом), и верная форма для таблицы: пока в SKILL.md старая цитата,
    // а верная совпадает с выводом, - SKIP с причиной (правит P9 на этапе C), потом проверка идет по новой цитате.
    const QUOTE_FIX = { 'блоки:': 'блоки: ... недописано N (X%)' };
    for (const [name, lead] of AUTOSTOP_LINES) {
      const q = quotes.find(x => x.startsWith(lead));
      if (!q) { skip(`автостоп «${name}»: строка status по цитате SKILL.md`, `цитаты «${lead}...» нет в таблице автостопов SKILL.md - ждет P9 (этап C: строка таблицы), тогда SKIP снимается сам`); continue; }
      const fixQ = QUOTE_FIX[lead];
      if (!quoteRe(q).test(stE.stdout) && fixQ && fixQ !== q && quoteRe(fixQ).test(stE.stdout)) { skip(`автостоп «${name}»: цитата SKILL.md «${q}»`, `расходится с выводом status - в таблице должно быть «${fixQ}» (ждет P9, этап C)`); continue; }
      check(`автостоп «${name}»: строка status совпадает с цитатой SKILL.md «${q}»`, quoteRe(q).test(stE.stdout), `${quoteRe(q)} | ${stE.stdout}`);
    }
    wj(path.join(TE, 'work', 'facts.json'), { facts: [{ id: 'F01', publish: 'yes' }, { id: 'F02', publish: 'no' }, { id: 'F03', publish: 'no' }, { id: 'F901', publish: 'yes' }], gaps: [] });
    const stE2 = task('status', '5');
    wj(path.join(TE, 'work', 'facts.json'), { facts: [{ id: 'F01', publish: 'no' }, { id: 'F02', publish: 'no' }, { id: 'F901', publish: 'yes' }], gaps: [] });
    const stE3 = task('status', '5');
    check('status: факт анализа с publish yes есть или фактов анализа меньше 3 - строки 0 фактов нет', !/фактов анализа с publish yes 0/.test(stE2.stdout) && !/фактов анализа с publish yes 0/.test(stE3.stdout), `${stE2.out} | ${stE3.out}`);
    // импорт до гейта (--allow-ungated): у всех фактов publish: no - ноль ожидаем, строки автостопа нет. Режим - из
    // import-report (после гейта --facts-only ставит ungated_import: false), без отчета - meta.allow_ungated.
    wj(path.join(TE, 'work', 'facts.json'), { facts: [{ id: 'F01', publish: 'no' }, { id: 'F02', publish: 'no' }, { id: 'F03', publish: 'no' }], gaps: [] });
    const repE = path.join(TE, 'work', 'import-report.json');
    wj(repE, { warnings: [], empty: [], gate: { approved: false, ungated_import: true } });
    const stU1 = task('status', '5');
    { const m = meta('texts/005-e'); m.allow_ungated = true; wj(path.join(TE, 'meta.json'), m); }
    wj(repE, { warnings: [], empty: [], gate: { approved: true, ungated_import: false } });
    const stU2 = task('status', '5');
    fs.rmSync(repE);
    const stU3 = task('status', '5');
    { const m = meta('texts/005-e'); delete m.allow_ungated; wj(path.join(TE, 'meta.json'), m); }
    check('status: импорт до гейта (import-report ungated_import, без отчета meta.allow_ungated) - строки 0 фактов нет, в строке фактов «ожидаемо»; после гейта (ungated_import false) - строка есть', !/^фактов анализа с publish yes 0/m.test(stU1.stdout) && /анализа 3, из них publish yes 0 - импорт до гейта анализа, publish не подтвержден, ожидаемо\)/.test(stU1.stdout) && /^фактов анализа с publish yes 0 из 3$/m.test(stU2.stdout) && !/^фактов анализа с publish yes 0/m.test(stU3.stdout), `${stU1.out} | ${stU2.out} | ${stU3.out}`);
    wt(path.join(TE, 'rules', 'decisions.md'), '<!-- decisions:v2 -->\n# Решения\n\n## 1. Конфликты фактов\n\n| Факт | Конфликт | Разрешенная формулировка | Где можно |\n|---|---|---|---|\n| F01 | конфликт | «с 2008 года» | главная страничка |\n| F02 | конфликт | «с 2010 года» | home |\n');
    const stE4 = task('status', '5');
    check('status: «Где можно» не разобрано - id фактов к строке decisions.md (parseDecisions копии kit, slug и типы карты)', /decisions\.md: v2; «Где можно» не разобрано: F01$/m.test(stE4.stdout), stE4.out);
    // exhausted у образца волны 1: 2+ блока и больше 30% (одного трудного блока короткой страницы мало)
    const TF = path.join(C, 'texts', '006-f');
    writeMap(TF, [mapPage('home', 'home', 0), mapPage('c1', 'category', 1), mapPage('c2', 'category', 2)]);
    const sample = (slug, total, ex) => {
      fs.rmSync(path.join(TF, 'work', 'pages', slug), { recursive: true, force: true });
      fs.rmSync(path.join(TF, 'work', 'audit', slug), { recursive: true, force: true });
      const ids = Array.from({ length: total }, (_, i) => `B0${i + 1}-b${i}`);
      const sh = writeBrief(TF, slug, ids.map((id, i) => [id, i ? 'x' : 'hero']), { type: slug === 'home' ? 'home' : 'category' });
      ids.forEach((id, i) => writeBlock(TF, slug, id, i < ex ? 'fix' : 'pass', i < ex ? { attempts: 2, brief_sha: sh } : {}));
    };
    const weakLine = () => (task('status', '6').stdout.match(/^волна 1, exhausted больше 30%: .*$/m) || [''])[0];
    const cases30 = [[['home', 3, 0], ['c1', 3, 1], ''], [['home', 3, 0], ['c1', 6, 2], 'c1 2/6'], [['home', 3, 0], ['c1', 7, 2], ''], [['home', 4, 3], ['c1', 3, 0], 'home 3/4']];
    const bad30 = [];
    for (const [h, c, want] of cases30) {
      sample(...h); sample(...c);
      const line = weakLine();
      if (want ? !line.includes(want) : line) bad30.push(`${h.join('/')} ${c.join('/')}: «${line}»`);
    }
    check('status: автостоп после волны 1 - 1/3 нет, 2/6 да, 2/7 нет, 3/4 у главной да', !bad30.length, bad30.join(' | '));
  }

  // ================================================================== 5. report
  {
    const R = mkProject('report');
    writeMap(R, [mapPage('home', 'home', 0), mapPage('c1', 'category', 1, { listing: true }), mapPage('c2', 'category', 2, { listing: true }), mapPage('nb', 'service', 3)]);
    wj(path.join(R, 'work', 'facts.json'), {
      facts: [
        { id: 'F01', label: 'Срок', value: '3 дня', wording: 'за 3 дня', publish: 'yes', kind: 'number' },
        { id: 'F02', label: 'Гарантия', value: '5 лет', wording: '5 лет', publish: 'no', kind: 'claim', note: 'снят на гейте' },
        { id: 'F801', label: 'Скидка', value: '10%', wording: 'скидка 10%', publish: 'yes', kind: 'number', source: 'оператор: 2026-09-27 письмо заказчика' },
      ],
      gaps: ['нет цен по категориям', 'регулярка антиобещания A2 не задана: линтер это антиобещание не ловит', 'конфликт: F01 против запрета', 'F02 «Гарантия» не подтвержден или снят на гейте: в тексты не идет'],
    });
    wj(path.join(R, 'work', 'import-report.json'), { warnings: ['w1', 'w2'], empty: [], anti: { pending: ['A2'] } });
    const sh = writeBrief(R, 'home', [['B01-hero', 'hero'], ['B02-text', 'conversion'], ['B03-faq', 'info']], { type: 'home', unknowns: ['нет цен по категориям', 'Гарантия', 'сроки доставки по регионам'] });
    writeBlock(R, 'home', 'B01-hero', 'pass', { elements: [{ kind: 'h1', text: 'Окна за 3 дня' }, { kind: 'text', text: 'Цена от [[нужно: цена за м2]]' }], needs_fact: ['адрес шоурума'] });
    writeBlock(R, 'home', 'B02-text', 'fix', { attempts: 2, brief_sha: sh });
    writeBlock(R, 'home', 'B03-faq', 'pass');
    writeBrief(R, 'c1', [['B01-hero', 'hero']], { unknowns: ['сроки доставки по регионам'] });
    writeBlock(R, 'c1', 'B01-hero', 'pass', { needs_fact: ['адрес шоурума'] });
    writeBrief(R, 'c2', [['B01-hero', 'hero']]);
    writeBlock(R, 'c2', 'B01-hero', 'pass');
    wj(path.join(R, 'work', 'audit', 'home', 'round-1.json'), { producer: 'page-judge', findings: [
      { id: 'j1', block_id: 'B03-faq', severity: 'major', rule: 'weak', problem: 'не хватает срока гарантии', proposal: 'спросить у заказчика срок гарантии', needs_fact: true, status: 'open' },
      { id: 'j2', block_id: 'B01-hero', severity: 'major', rule: 'fact.unsupported', problem: 'обещание без опоры', status: 'wontfix', resolution: 'нет факта: срок монтажа' },
    ] });
    wj(path.join(R, 'work', 'audit', 'c1', 'cross.json'), { producer: 'cross-judge', split_from: 'work/audit/cross.json', source_created_at: '2026-09-27 10:00', findings: [
      { id: 'x1', page: 'c1', block_id: 'B01-hero', severity: 'major', rule: 'cross.twin', problem: 'близнец c2', proposal: 'нужен факт отличия c1', needs_fact: true, status: 'open' },
    ] });
    wj(path.join(R, 'work', 'audit', 'cross.json'), { producer: 'cross-judge', created_at: '2026-09-27 10:00', findings: [
      { id: 'x1', page: 'c1', block_id: 'B01-hero', severity: 'major', rule: 'cross.twin', problem: 'близнец c2', needs_fact: true, status: 'open' },
      { id: 'x2', page: 'c2', block_id: 'B01-hero', severity: 'major', rule: 'cross.repeat', problem: 'повтор с c1', quote: 'одинаковая фраза', status: 'open' },
    ] });
    wj(path.join(R, 'work', 'audit', 'cross-archive-20260926T100000Z.json'), { producer: 'cross-judge', created_at: '2026-09-26 10:00', findings: [
      { id: 'x0', page: 'c2', block_id: 'B01-hero', severity: 'major', rule: 'cross.repeat', problem: 'повтор с c1', quote: 'одинаковая фраза', status: 'fixed' },
      { id: 'x9', page: 'home', block_id: 'B02-text', severity: 'blocker', rule: 'cross.h1', problem: 'одинаковый H1', status: 'fixed' },
    ] });
    wj(path.join(R, 'work', 'audit', 'dedup.json'), { findings: [{ rule: 'dedup.h1' }, { rule: 'dedup.shingles' }, { rule: 'dedup.shingles' }], pairs_summary: 'пар 3: шинглы 2, H1 1' });
    wt(path.join(R, 'rules', 'decisions.md'), '<!-- decisions:v2 -->\n# Решения\n\n## 1. Конфликты фактов\n\n| Факт | Конфликт | Разрешенная формулировка | Где можно |\n|---|---|---|---|\n\n## 8. Спорное: решения агента\n\nВводный текст раздела.\n\n| Вопрос | Что решил агент | Почему |\n|---|---|---|\n| Показывать ли цену | не показывать | нет фактов цены |\n');
    wj(path.join(R, 'work', 'audit', 'strategy-review.json'), { producer: 'strategy-review', findings: [{ severity: 'major', page: 'c1', problem: 'крючок не о предмете', proposal: 'переписан', status: 'fixed' }], verdict: 'fix', summary: 'x' });
    wj(path.join(R, 'work', 'strategy.pages', 'category.json'), { type: 'category', disputes: [{ question: 'объединить c1 и c2', decision: 'не объединять', why: 'разные сегменты' }] });
    wj(path.join(R, 'work', 'briefs-report.json'), { pages: { nb: { excluded: [], dropped: [{ block: 'price', reason: 'нет фактов цены' }], structure_changed: true }, c2: { dropped: [{ block: 'price', reason: 'нет фактов цены' }, { block: 'B05-steps', reason: 'нет фактов' }], questions: [{ text: 'Нужны факты для блока «Как работаем»: что будет после заявки', blocks: ['B05-steps'] }] } }, questions: [{ text: 'какие сроки доставки по регионам', pages: ['c1'], blocks: ['B01-hero'] }, { text: 'Нужны факты для блока «Как работаем»: что будет после заявки', pages: ['c2', 'nb'], blocks: ['B05-steps'] }], warnings: ['decisions §1: F01: «Где можно» не разобрано (главная) - колонка не применяется'] });
    wj(path.join(R, 'work', 'audit', 'html-check.json'), { verdict: 'fix', summary: 'blocker 0, major 1, minor 0', findings: [{ severity: 'major', rule: 'html.block-missing', page: 'home', block_id: 'B02-text', problem: 'блок не написан' }], scores: { pages: 3 } });
    wj(path.join(R, 'work', 'output', 'prototype.js-check.json'), { verdict: 'skip', routes_checked: 0, clicks: 0, errors: [], skip_reason: 'jsdom не найден' });
    wj(path.join(R, 'work', 'output', 'prototype.modules.json'), { catalog: { on: true, why: 'есть страницы listing', source: 'sitemap' }, cart: { on: false, why: 'нет страницы cart', source: 'sitemap' } });
    wj(path.join(R, 'work', 'client-preferences.json'), { items: [{ text: 'телефон крупно в шапке', status: 'basis', where: 'shell' }] });
    wj(path.join(R, 'work', 'catalog', 'sample-items.json'), { generated_at: 'x', items: [{ key: 'k1', category_slug: 'c1', name: 'Товар', source: 'site', attributes: [], images: [] }, { key: 'k2', category_slug: '*', name: 'Пример', source: 'illustrative', attributes: [], images: [] }] });
    wj(path.join(R, 'work', 'catalog', 'publish.json'), { url: 'https://docs.example/tz' });
    const r = run(R, ['scripts/report.mjs']);
    const md = fs.existsSync(path.join(R, 'work', 'output', 'report.md')) ? fs.readFileSync(path.join(R, 'work', 'output', 'report.md'), 'utf8') : '';
    check('report: код 0, итог в консоли', r.code === 0 && /^отчет: work\/output\/report\.md \(страниц 4/.test(r.stdout) && /скрипты: SKIP/.test(r.stdout), r.out.slice(0, 500));
    const sectionOf = h => { const i = md.indexOf(`## ${h}`); if (i < 0) return ''; const j = md.indexOf('\n## ', i + 3); return md.slice(i, j < 0 ? undefined : j); };
    for (const h of ['Сводка', 'Что спросить у заказчика', 'Не подтверждено или снято', 'Спорное: решения агента', 'Предупреждения сборки брифов', 'Повторы между страницами', 'Major, закрытые фиксером без правки', 'Проверки прототипа', 'Интерфейс прототипа', 'Каталог', 'По страницам']) check(`report: раздел «${h}»`, !!sectionOf(h), h);
    const sum = sectionOf('Сводка');
    check('report: сводка - статусы, exhausted, без брифа, смена структуры, импорт, SKIP', /готово 0, написано 2, заблокировано \(есть exhausted-блоки\) 1, в работе 0, без брифа 1/.test(sum) && /скелетов в прототипе: 1 \(exhausted 1\)/.test(sum) && /Без брифа: nb/.test(sum) && /нужен build-briefs --force\): nb/.test(sum) && /антиобещаний без регулярки 1 \(A2\)/.test(sum) && /скрипты прототипа: SKIP/.test(sum) && /home\/B02-text: не прошел линтер \(попыток 2/.test(sum), sum);
    const ask = sectionOf('Что спросить у заказчика');
    const askLines = ask.split('\n').filter(l => l.startsWith('- '));
    check('report: вопросы - gaps весь сайт, технические и снятые gaps не в вопросах', /- нет цен по категориям \(весь сайт\)/.test(ask) && !/регулярка антиобещания|конфликт:|F02 «Гарантия»/.test(ask), ask);
    check('report: вопросы - [[нужно]], needs_fact писателя (одна строка на две страницы), судьи и кросса, отказ фиксера', /- цена за м2 \(home\/B01-hero\)/.test(ask) && /- адрес шоурума \(home\/B01-hero, c1\/B01-hero\)/.test(ask) && /спросить у заказчика срок гарантии \(home\/B03-faq\)/.test(ask) && /нужен факт отличия c1 \(c1\/B01-hero\)/.test(ask) && /срок монтажа \(home\/B01-hero\)/.test(ask), ask);
    // unknowns «сроки доставки по регионам» (home, c1) и вопрос briefs-report «какие сроки доставки по регионам» (c1/B01-hero) -
    // один вопрос: формулировка полнее, места - объединение (страница c1 без блока лишняя при c1/B01-hero)
    check('report: вопросы - выпавшие блоки и questions briefs-report, unknowns без повторов', /нет фактов для блока «price»: нет фактов цены \(nb, c2\)/.test(ask) && /- какие сроки доставки по регионам \(home, c1\/B01-hero\)/.test(ask) && /Нужны факты для блока «Как работаем»: что будет после заявки \(c2\/B05-steps\)/.test(ask) && !/блока «B05-steps»/.test(ask) && !/^- сроки доставки по регионам/m.test(ask) && !askLines.some(l => /^- Гарантия/.test(l)), ask);
    check('report: вопросы без повторов (общий и постраничный отчет кросса - одна находка, текст из proposal)', new Set(askLines.map(l => l.replace(/\s*\(.*$/, '').toLowerCase())).size === askLines.length && !/близнец c2/.test(ask), askLines.join(' | '));
    const held = sectionOf('Не подтверждено или снято');
    check('report: publish no, технические пробелы и факты оператора', /F02 «Гарантия»: 5 лет \(снят на гейте\)/.test(held) && /### Технические пробелы/.test(held) && /регулярка антиобещания A2/.test(held) && /F801 «Скидка»/.test(held) && /перенести в анализ/.test(held), held);
    const disp = sectionOf('Спорное: решения агента');
    check('report: спорное - §8 v2 (без шапки и вводного текста), рецензия, disputes стратега типа', /decisions\.md §8: Показывать ли цену \| не показывать \| нет фактов цены/.test(disp) && !/Вводный текст|Вопрос \| Что решил/.test(disp) && /рецензия стратегии: \[major\] c1: крючок не о предмете/.test(disp) && /стратег типа category: объединить c1 и c2 \| не объединять \| разные сегменты/.test(disp), disp);
    check('report: предупреждения сборки брифов', /«Где можно» не разобрано/.test(sectionOf('Предупреждения сборки брифов')));
    const rep = sectionOf('Повторы между страницами');
    check('report: повторы - статус из свежего отчета, архив учтен, не исправленные вне аудита, dedup числами', /Подтверждено кросс-судьей \(с архивами\): 3/.test(rep) && /c2\/B01-hero: cross\.repeat \(major\) - open/.test(rep) && /home\/B02-text: cross\.h1 \(blocker\) - fixed/.test(rep) && /Не исправлены[^\n]*: 1 - c2/.test(rep) && /dedup\.h1 1, dedup\.shingles 2/.test(rep) && /Кандидаты для кросс-судьи: пар 3/.test(rep), rep);
    check('report: major закрыт без правки', /home\/B01-hero: fact\.unsupported \(major, wontfix\)/.test(sectionOf('Major, закрытые фиксером без правки')));
    const proto = sectionOf('Проверки прототипа');
    check('report: проверки прототипа - check-html и SKIP check-site-js', /check-html: fix/.test(proto) && /html\.block-missing home\/B02-text/.test(proto) && /check-site-js: SKIP \(jsdom не найден\)/.test(proto), proto);
    const ui = sectionOf('Интерфейс прототипа');
    check('report: интерфейс - модули и пожелание к оболочке', /catalog: включен - есть страницы listing \(sitemap\)/.test(ui) && /cart: выключен/.test(ui) && /телефон крупно в шапке/.test(ui), ui);
    const cat = sectionOf('Каталог');
    check('report: каталог - ТЗ, примеры по источникам, выдачи без своего примера', /https:\/\/docs\.example\/tz/.test(cat) && /site 1, illustrative 1/.test(cat) && /без своего примера[^\n]*c2/.test(cat), cat);
    const pages = sectionOf('По страницам');
    check('report: по страницам - волна и производный статус', /\| \/c1 \| category \| 1 \| написано \| 1\/1 \|/.test(pages) && /\| \/ \| home \| 1 \| заблокировано \| 2\/3 \| 1 \|/.test(pages) && /\| \/nb \| service \| 2 \| нет брифа/.test(pages), pages);
    // старые задачи: §8 без маркера v2 - это другой раздел, в «Спорное» не идет
    wt(path.join(R, 'rules', 'decisions.md'), '# Решения\n\n## 8. ТЗ заказчика как скелет страниц\n\n| Вопрос | Что решил агент | Почему |\n|---|---|---|\n| ТЗ | скелет | из ТЗ |\n');
    fs.rmSync(path.join(R, 'work', 'audit', 'strategy-review.json'));
    fs.rmSync(path.join(R, 'work', 'strategy.pages'), { recursive: true });
    run(R, ['scripts/report.mjs']);
    const md2 = fs.readFileSync(path.join(R, 'work', 'output', 'report.md'), 'utf8');
    check('report: decisions.md без маркера v2 - §8 не выводится', /## Спорное: решения агента\n- записей нет/.test(md2) && !/ТЗ \| скелет/.test(md2), md2.slice(md2.indexOf('## Спорное'), md2.indexOf('## Спорное') + 200));
    // публикация ТЗ пропущена (нет папки), --facts-only: изменилось кроме фактов, предупреждения импорта списком
    wj(path.join(R, 'work', 'catalog', 'publish.json'), { status: 'skipped', reason: 'нет texts_folder_id', docx: 'work/catalog/tz.docx' });
    wj(path.join(R, 'work', 'import-report.json'), { warnings: ['company.hours «9-18»: в анализе этого поля больше нет - снято'], empty: [], anti: { pending: [] }, other_changed: ['audience'] });
    run(R, ['scripts/report.mjs']);
    const md3 = fs.readFileSync(path.join(R, 'work', 'output', 'report.md'), 'utf8');
    check('report: ТЗ не опубликовано - причина и файл docx, не «опубликовано»', /ТЗ на каталог: не опубликовано \(нет texts_folder_id\), файл work\/catalog\/tz\.docx/.test(md3) && !/ТЗ на каталог: опубликовано/.test(md3), md3.slice(0, 900));
    check('report: other_changed и предупреждения импорта для оператора', /изменилось кроме фактов[^\n]*audience/.test(md3) && /### Предупреждения импорта[\s\S]*больше нет - снято/.test(md3), md3.slice(0, 1500));
  }

  // ================================================================== 5b. report: вопросы кросса после нового запуска, все круги судьи
  {
    const Q = mkProject('report-runs');
    writeMap(Q, [mapPage('home', 'home', 0), mapPage('c1', 'category', 1)]);
    writeBrief(Q, 'home', [['B01-hero', 'hero'], ['B02-text', 'conversion']], { type: 'home' });
    writeBlock(Q, 'home', 'B01-hero', 'pass', { elements: [{ kind: 'h1', text: 'Главная страница' }, { kind: 'text', text: 'Текст главной про заказ и сроки изготовления изделия' }] });
    writeBlock(Q, 'home', 'B02-text', 'pass', { elements: [{ kind: 'text', text: 'Отдельный текст про оплату и доставку заказа' }] });
    writeBrief(Q, 'c1', [['B01-hero', 'hero']]);
    writeBlock(Q, 'c1', 'B01-hero', 'pass', { elements: [{ kind: 'h1', text: 'Категория' }, { kind: 'text', text: 'Текст категории про выбор модели и размера' }] });
    // круг 1 с вопросом, круг 2 (scope=fixed) его не повторяет
    wj(path.join(Q, 'work', 'audit', 'home', 'round-1.json'), { producer: 'page-judge', fixer: { blocks_touched: ['B01-hero'] }, findings: [
      { id: 'r1', block_id: 'B02-text', severity: 'minor', rule: 'fact', problem: 'нет срока', proposal: 'срок изготовления на заказ', needs_fact: true, status: 'open' },
    ] });
    wj(path.join(Q, 'work', 'audit', 'home', 'round-2.json'), { producer: 'page-judge', findings: [{ id: 'r2', block_id: 'B01-hero', severity: 'minor', rule: 'style', problem: 'мелочь', status: 'open' }] });
    const CR = path.join(Q, 'work', 'audit', 'cross.json');
    const askOf = () => {
      const r = run(Q, ['scripts/report.mjs']);
      const md = fs.readFileSync(path.join(Q, 'work', 'output', 'report.md'), 'utf8');
      const i = md.indexOf('## Что спросить у заказчика');
      return { code: r.code, out: r.out, ask: md.slice(i, md.indexOf('\n## ', i + 3)) };
    };
    const setStatus = (slug, id, status, resolution) => { const f = path.join(Q, 'work', 'audit', slug, 'cross.json'); const c = rj(f); const x = c.findings.find(y => y.id === id); x.status = status; x.resolution = resolution; wj(f, c); };
    // запуск кросса 1: вопрос по home (фиксер ставит wontfix «нет факта»), вопрос по c1 (фиксер убрал утверждение - fixed)
    wj(CR, { producer: 'cross-judge', created_at: '2026-09-26T10:00:00Z', findings: [
      { id: 'n1', page: 'home', block_id: 'B01-hero', severity: 'minor', rule: 'cross.twin', problem: 'не хватает местного факта', proposal: 'адрес склада в городе', needs_fact: true },
      { id: 'n2', page: 'c1', block_id: 'B01-hero', severity: 'minor', rule: 'cross.twin', problem: 'нужен факт', proposal: 'сроки доставки в область', needs_fact: true },
    ] });
    run(Q, ['scripts/split-cross.mjs']);
    setStatus('home', 'n1', 'wontfix', 'нет факта: адрес склада');
    setStatus('c1', 'n2', 'fixed', 'утверждение убрано');
    run(Q, ['scripts/split-cross.mjs', '--merge']);
    const q1 = askOf();
    const lines1 = q1.ask.split('\n').filter(l => l.startsWith('- '));
    const nf1 = rj(path.join(Q, 'work', 'audit', 'retro-stats.json')).no_fact;
    check('report: retro-stats видит отказ фиксера по n1 (проверка дублей не пустая)', (nf1.rejected || []).some(x => x.id === 'n1' && /адрес склада/.test(x.missing)), JSON.stringify(nf1).slice(0, 300));
    check('report: вопрос кросса (wontfix - что фиксер назвал недостающим) и круга 1 при круге 2 (proposal); fixed - не вопрос; без дублей', q1.code === 0 && lines1.filter(l => /адрес склада/.test(l)).length === 1 && /- адрес склада \(home\/B01-hero\)/.test(q1.ask) && /- срок изготовления на заказ \(home\/B02-text\)/.test(q1.ask) && !/сроки доставки в область/.test(q1.ask), q1.ask);
    // запуск кросса 2 (dedup архивирует общий отчет, split-cross - постраничные копии): home в новом отчете нет
    const dd = run(Q, ['scripts/dedup.mjs']);
    wj(CR, { producer: 'cross-judge', created_at: '2026-09-27T10:00:00Z', findings: [{ id: 'm1', page: 'c1', block_id: 'B01-hero', severity: 'major', rule: 'cross.repeat', problem: 'повтор', quote: 'выбор модели и размера' }] });
    run(Q, ['scripts/split-cross.mjs']);
    const arch = fs.readdirSync(path.join(Q, 'work', 'audit')).filter(isCrossArchive).concat(fs.readdirSync(path.join(Q, 'work', 'audit', 'home')).filter(isCrossArchive));
    const q2 = askOf();
    check('report: после второго запуска кросса вопрос из архива остается, fixed не возвращается', canon(arch) === canon(['cross-archive-20260926T100000Z.json', 'cross-archive-20260926T100000Z.json']) && /- адрес склада \(home\/B01-hero\)/.test(q2.ask) && !/сроки доставки в область/.test(q2.ask), `${dd.out} | ${arch.join(', ')} | ${q2.ask}`);
    // запуск кросса 3: та же находка снова и фиксер ее закрыл правкой - статус самого свежего отчета
    run(Q, ['scripts/dedup.mjs']);
    wj(CR, { producer: 'cross-judge', created_at: '2026-09-28T10:00:00Z', findings: [{ id: 'k1', page: 'home', block_id: 'B01-hero', severity: 'minor', rule: 'cross.twin', problem: 'не хватает местного факта', proposal: 'адрес склада в городе', needs_fact: true }] });
    run(Q, ['scripts/split-cross.mjs']);
    setStatus('home', 'k1', 'fixed', 'утверждение убрано');
    const q3 = askOf();
    check('report: свежий отчет закрыл находку (fixed) - вопрос из архива снят', !/адрес склада/.test(q3.ask) && /- срок изготовления на заказ/.test(q3.ask), q3.ask);
  }

  // ================================================================== 6. split-cross: created_at и архив
  {
    const G = mkProject('split');
    writeMap(G, [mapPage('home', 'home', 0), mapPage('c1', 'category', 1)]);
    const REP = path.join(G, 'work', 'audit', 'cross.json');
    wj(REP, { scope: 'all-pages', producer: 'cross-judge', round: 1, verdict: 'fix', findings: [{ id: 'a1', page: 'c1', block_id: 'B01-hero', severity: 'major', rule: 'cross.repeat', problem: 'p' }] });
    wj(path.join(G, 'work', 'audit', 'c1', 'cross.json'), { scope: 'c1', producer: 'cross-judge', split_from: 'work/audit/cross.json', source_created_at: '2026-09-23 10:00', created_at: '2026-09-23 10:00', findings: [{ id: 'old', page: 'c1', severity: 'major', rule: 'cross.twin', problem: 'q', status: 'fixed', quote: 'старый повтор' }], verdict: 'fix' });
    wj(path.join(G, 'work', 'audit', 'home', 'cross.json'), { scope: 'home', producer: 'cross-judge', split_from: 'work/audit/cross.json', source_created_at: '', findings: [], verdict: 'pass' });
    const s1 = run(G, ['scripts/split-cross.mjs']);
    const cross = rj(REP);
    check('split-cross: нет created_at - поставлен в общем файле', s1.code === 0 && !!cross.created_at && /created_at поставлен/.test(s1.out), s1.out);
    const c1files = fs.readdirSync(path.join(G, 'work', 'audit', 'c1'));
    const arch = c1files.filter(isCrossArchive);
    check('split-cross: прежняя копия переименована в cross-archive-20260923T100000Z.json, не удалена', canon(arch) === canon(['cross-archive-20260923T100000Z.json']) && rj(path.join(G, 'work', 'audit', 'c1', arch[0])).findings[0].id === 'old', c1files.join(', '));
    check('split-cross: новая копия страницы - по новому отчету', rj(path.join(G, 'work', 'audit', 'c1', 'cross.json')).findings.map(f => f.id).join() === 'a1');
    const homeFiles = fs.readdirSync(path.join(G, 'work', 'audit', 'home'));
    check('split-cross: пустая метка - архив со временем сейчас, в имени нет двоеточий', homeFiles.length === 1 && /^cross-archive-\d{8}T\d{6}Z\.json$/.test(homeFiles[0]) && fs.statSync(path.join(G, 'work', 'audit', 'home', homeFiles[0])).size > 10, homeFiles.join(', '));
    check('archiveStamp: форматы времени, пустая метка, метка без даты - только латиница и цифры', archiveStamp('2026-09-27T02:07:00.123Z') === '20260927T020700Z' && archiveStamp('2026-09-23 10:00') === '20260923T100000Z' && /^\d{8}T\d{6}Z$/.test(archiveStamp('')) && archiveStamp('v1: r.2') === 'v1r2' && /^\d{8}T\d{6}Z$/.test(archiveStamp('без даты')));
    const rs = run(G, ['scripts/retro-stats.mjs']);
    const stats = rj(path.join(G, 'work', 'audit', 'retro-stats.json'));
    check('retro-stats: архивы кросса не считаются', rs.code === 0 && stats.totals.findings === 1 && (stats.totals.by_producer['cross-judge'] || 0) === 1, JSON.stringify(stats.totals));
  }

  // ================================================================== 7. dedup: архив и обязательные формулировки
  {
    const D = mkProject('dedup');
    writeMap(D, [mapPage('home', 'home', 0), mapPage('c1', 'category', 1), mapPage('c2', 'category', 2)]);
    const RULE = 'Стандартный срок изготовления заказа составляет от трех до пяти рабочих дней после согласования эскиза';
    const D2 = 'Каждый клиент получает персонального менеджера который ведет заказ от первого звонка до получения готового изделия';
    const MUST = 'Все изделия проходят обязательное клеймение в пробирной палате перед отправкой клиенту по всей стране';
    const facts = [{ id: 'F01', label: 'Срок', wording: 'срок от 3 до 5 дней', rule: RULE, publish: 'yes' }];
    writeBrief(D, 'home', [['B01-hero', 'hero']], { type: 'home', facts });
    writeBrief(D, 'c1', [['B01-hero', 'hero'], ['B02-text', 'conversion']], { facts });
    writeBrief(D, 'c2', [['B01-hero', 'hero']], { facts });
    writeBlock(D, 'home', 'B01-hero', 'pass', { elements: [{ kind: 'h1', text: 'Главная' }, { kind: 'text', text: `${MUST}. Отдельная фраза главной страницы про выбор. ${RULE}.` }] });
    writeBlock(D, 'c1', 'B01-hero', 'pass', { elements: [{ kind: 'h1', text: 'Категория один' }, { kind: 'text', text: `${RULE}. ${D2}.` }], facts_used: ['F01'] });
    writeBlock(D, 'c1', 'B02-text', 'pass', { elements: [{ kind: 'text', text: `${RULE}. Своя фраза категории про размеры и примерку. ${MUST}.` }] });
    writeBlock(D, 'c2', 'B01-hero', 'pass', { elements: [{ kind: 'h1', text: 'Категория два' }, { kind: 'text', text: `${D2}.` }] });
    wj(path.join(D, 'work', 'client-preferences.json'), { items: [{ text: MUST, status: 'basis', where: 'must-say', source: 'constraints.must_say' }, { text: D2, status: 'candidate', where: 'hero', source: 'gate:d2' }] });
    wj(path.join(D, 'work', 'audit', 'cross.json'), { producer: 'cross-judge', created_at: '2026-09-27T02:07:00Z', findings: [{ id: 'k1', page: 'c1', severity: 'major', rule: 'cross.twin', problem: 'x', status: 'fixed' }] });
    const d1 = run(D, ['scripts/dedup.mjs']);
    const dd = rj(path.join(D, 'work', 'audit', 'dedup.json'));
    const between = dd.findings.filter(f => f.rule === 'dedup.shingles');
    const pairKey = pr => `${pr.a}~${pr.b}`;
    check('dedup: rule факта и must_say на разных страницах - не повтор', d1.code === 0 && !dd.pairs.some(pr => pr.a === 'c1' && pr.b === 'home' && pr.reasons.includes('shingles')), JSON.stringify(dd.pairs.map(pairKey)));
    check('dedup: такая же фраза из пункта гейта d2 - пара шинглов', dd.pairs.some(pr => pairKey(pr) === 'c1~c2' && pr.reasons.includes('shingles')) && between.some(f => ['c1', 'c2'].includes(f.page)), JSON.stringify(dd.pairs));
    check('dedup: rule в двух блоках одной страницы - не dedup.in-page', !dd.findings.some(f => f.rule === 'dedup.in-page'), JSON.stringify(dd.findings.filter(f => f.rule === 'dedup.in-page')));
    const archives = () => fs.readdirSync(path.join(D, 'work', 'audit')).filter(isCrossArchive);
    check('dedup: прежний cross.json в архиве cross-archive-20260927T020700Z.json', canon(archives()) === canon(['cross-archive-20260927T020700Z.json']) && rj(path.join(D, 'work', 'audit', archives()[0])).findings[0].status === 'fixed' && /прежний отчет кросса/.test(d1.out), d1.out);
    const x = rj(path.join(D, 'work', 'audit', 'cross.json')); x.findings[0].status = 'wontfix'; wj(path.join(D, 'work', 'audit', 'cross.json'), x);
    run(D, ['scripts/dedup.mjs']);
    check('dedup: повторный запуск по тому же отчету - тот же архив, перезаписан', archives().length === 1 && rj(path.join(D, 'work', 'audit', archives()[0])).findings[0].status === 'wontfix');
    const cd = run(D, ['scripts/cross-digest.mjs']);
    const dig = rj(path.join(D, 'work', 'audit', 'cross-digest.json'));
    const pc1 = (dig.pages || {}).c1, pc2 = (dig.pages || {}).c2;
    check('cross-digest: fact_rules - rule использованных фактов (c1 использует F01), без использованных - поля нет', cd.code === 0 && !!pc1 && !!pc1.fact_rules && pc1.fact_rules.F01 === RULE && !!pc2 && !('fact_rules' in pc2), `${cd.out} | ${JSON.stringify(dig.pages || {}).slice(0, 400)}`);
    // blind-prep: страница для всех сегментов - строка «Сценарии:» с именем и поводом каждого сегмента
    writeBrief(D, 'all', [['B01-hero', 'hero']], { type: 'home', segment: { id: 'all', name: 'Все посетители', segments: [{ id: 'S1', name: 'Семья', comes_with: 'ремонт квартиры' }, { id: 'S2', name: 'Бизнес', comes_with: 'обустройство офиса' }] } });
    writeBlock(D, 'all', 'B01-hero', 'pass', { elements: [{ kind: 'h1', text: 'Для всех' }] });
    const bp = run(D, ['scripts/blind-prep.mjs', 'all']);
    const bp1 = run(D, ['scripts/blind-prep.mjs', 'c1']);
    check('blind-prep: segment all - «Сценарии:» со всеми сегментами; обычный сегмент - без строки', bp.code === 0 && /Все посетители\. Сценарии: Семья - ремонт квартиры; Бизнес - обустройство офиса\./.test(bp.stdout) && bp1.code === 0 && !/Сценарии:/.test(bp1.stdout), `${bp.out} | ${bp1.out}`);
  }

  // ================================================================== 8. воркфлоу с подставными agent
  {
    // wf-05: блок не прошел линтер - страница идет дальше; stopOnBlock - прежняя остановка
    const pagesArg = [{ slug: 'p1', type: 'category', hero_mode: 'single', hero_block_id: 'B01-hero', pending_blocks: ['B01-hero', 'B02-a', 'B03-b'], block_roles: { 'B01-hero': 'hero', 'B02-a': 'x', 'B03-b': 'y' } }];
    const ans = label => {
      if (/^hero:/.test(label)) return { slug: 'p1', block_id: 'B01-hero', variants: 3 };
      if (/^select:/.test(label)) return { slug: 'p1', block_id: 'B01-hero', chosen: 'a', lint: 'pass' };
      if (label === 'block:p1:B02-a') return { slug: 'p1', block_id: 'B02-a', lint: 'fix', blocked_reasons: ['нет факта'] };
      return { slug: 'p1', block_id: 'B03-b', lint: 'pass' };
    };
    const a = await runWf('wf-05-write', { pages: pagesArg }, ans);
    check('wf-05: без остановок - после неудачного B02 пишется B03, last у B03', a.calls.some(c => c.label === 'block:p1:B03-b' && /last=true/.test(c.prompt)) && a.result.failed.length === 1 && a.result.failed[0].block_id === 'B02-a' && canon(a.result.pages[0].done) === canon(['B01-hero', 'B03-b']), JSON.stringify(a.result));
    const b = await runWf('wf-05-write', { pages: pagesArg, stopOnBlock: true }, ans);
    check('wf-05: stopOnBlock - страница встает на B02', !b.calls.some(c => c.label === 'block:p1:B03-b') && b.result.stopped[0].at.block_id === 'B02-a');
    const t = await runWf('wf-05-write', { pages: [{ ...pagesArg[0], hero_mode: 'tournament', pending_blocks: ['B01-hero'] }] }, () => null);
    const src05 = wfSource('wf-05-write');
    check('wf-05: подсказка «только верхним уровнем» в шапке и в причине сбоя турнира', /только верхним уровнем/.test(src05) && t.result.failed.length === 1 && /турнир первого экрана не отработал[\s\S]*args write --hero single/.test(t.result.failed[0].reason), JSON.stringify(t.result).slice(0, 300));
    const silent = await runWf('wf-05-write', { pages: pagesArg }, label => (label === 'block:p1:B02-a' ? null : ans(label)));
    check('wf-05: агент не ответил - failed с no_answer и строка в логе; неудача линтера - без no_answer', t.result.failed[0].no_answer === true && silent.result.failed.length === 1 && silent.result.failed[0].no_answer === true && a.result.failed[0].no_answer === undefined && silent.logs.some(l => /без ответа агента[^\n]*p1\/B02-a/.test(l)), JSON.stringify(silent.result.failed) + ' | ' + silent.logs.join(' | '));
    // №23 (повторная проверка): селектор не ответил - no_answer (попытка не засчитана: progress считает попытки первого
    // экрана только по файлу блока); селектор ответил chosen none - неудача без no_answer, блока нет
    const selSilent = await runWf('wf-05-write', { pages: [{ ...pagesArg[0], pending_blocks: ['B01-hero'] }] }, label => (/^select:/.test(label) ? null : ans(label)));
    const selNone = await runWf('wf-05-write', { pages: [{ ...pagesArg[0], pending_blocks: ['B01-hero'] }] }, label => (/^select:/.test(label) ? { slug: 'p1', block_id: 'B01-hero', chosen: 'none', lint: 'none', reason: 'все выбыли на отсеве' } : ans(label)));
    check('wf-05 (№23): селектор не ответил - failed с no_answer; chosen none - failed без no_answer', selSilent.result.failed.length === 1 && selSilent.result.failed[0].no_answer === true && selNone.result.failed.length === 1 && selNone.result.failed[0].no_answer === undefined, JSON.stringify([selSilent.result.failed, selNone.result.failed]));
    const runbook = fs.readFileSync(path.join(TPL, 'docs', 'RUNBOOK.md'), 'utf8');
    check('wf-05 (№23): шапка согласована с RUNBOOK - no_answer: попытка не засчитана, файлы вариантов попыток не дают', /no_answer[^\n]*\n?[^\n]*попытка не засчитана/.test(src05) && /Файлы вариантов первого\s*\n?\/\/ экрана попыток не дают/.test(src05) && /`no_answer` - агент или турнир не\s*\n?\s*ответил: попытка не засчитана/.test(runbook), src05.slice(0, 1600));
    const sel = fs.readFileSync(path.join(TPL, 'prompts', '05-hero-selector.md'), 'utf8');
    check('05-hero-selector (№23): прежний блок без отчета линтера - сначала lint.mjs на нем (без --fix), не «не прошел»', /Есть прежний `<block_id>\.json` без отчета\s+`work\/audit\/<slug>\/lint-<block_id>\.json` - сначала `node scripts\/lint\.mjs` на нем \(без `--fix`\): это его вердикт/.test(sel), sel.slice(1800, 3200));
    check('05-hero-selector (№23): attempts - неудачи линтера по прежнему блоку, файлы вариантов не в счет', /`attempts` \(неудачи линтера: прежний блок с тем же `brief_sha` не прошел - его \+ 1, иначе 1; файлы вариантов не в\s+счет\)/.test(sel) && !/наибольшее из файлов\s+вариантов/.test(sel), sel.slice(1800, 3200));
    // повторная проверка №23: при замене отчет прежнего блока удаляется до переноса T - сбой между заменой и lint не
    // оставляет вердикт прежнего содержимого (progress: блок без отчета - pending)
    check('05-hero-selector (№23): при замене отчет прежнего блока удаляется до переноса T и lint нового блока', /_old\/<block_id>\.<время>\.json`\s+и удали его отчет `lint-<block_id>\.json`, `T` - в `<block_id>\.json`, `node scripts\/lint\.mjs/.test(sel), sel.slice(2400, 3400));
    check('wf-05 (№23): шапка - no_answer до lint не засчитан, exhausted только по отчету к текущему содержимому', /записан без проверки линтером \(exhausted\s*\n?\/\/ только по отчету линтера к текущему содержимому блока: без отчета или с block_sha другого содержимого - pending\)/.test(src05), src05.slice(0, 2200));
    // wf-05b: слепой судья знает про сценарии segment all
    const tb = await runWf('wf-05b-hero-tournament', { slug: 'home' }, label => (/^hero-writer/.test(label) ? { slug: 'home', block_id: 'B01-hero', variants: 3 } : /^judge/.test(label) ? { scores: {}, top3: [], notes: '' } : { slug: 'home', block_id: 'B01-hero', chosen: 'w1a', lint: 'pass' }));
    check('wf-05b: слепой судья читает segment.segments и берет наименьшую оценку', tb.calls.some(c => c.label === 'judge:blind:home' && /segments/.test(c.prompt) && /наименьшая оценка/.test(c.prompt)));

    // wf-06: второй круг без clonability, круги от round страницы, current кросс-судье, вне аудита - в cross_outside
    const judgeAns = scores => (label, prompt) => {
      if (/^judge:/.test(label)) return { findings: [{ severity: 'major', rule: 'weak', problem: 'x' }], verdict: 'fix', summary: 's', scores, lint_page: { verdict: 'pass', summary: 'ok' } };
      if (/^fix:/.test(label)) return { slug: (prompt.match(/slug=([^;]+);/) || [])[1], fixed: 1, rejected: 0, left_open: 0, blocker_open: 0, lint: 'pass', page_lint: 'pass' };
      if (label === 'cross-judge') return { findings: [{ severity: 'major', rule: 'cross.repeat', problem: 'p', page: 'p1' }, { severity: 'major', rule: 'cross.repeat', problem: 'p', page: 'out' }, { severity: 'major', rule: 'cross.twin', problem: 'p', page: 'out2', needs_fact: true }], verdict: 'fix', summary: 'c' };
      if (/^blind:/.test(label)) return { findings: [], verdict: 'pass', summary: 'b' };
      // fix-diff (P4, программа 28.09): правки утверждений нет - второй круг только по порогам и blocker
      if (/^snap:/.test(label)) return { ok: true, exit_code: 0, stdout_tail: 'FIX_SNAP {"id":"s1","blocks":2}' };
      if (/^diff:/.test(label)) return { ok: true, exit_code: 0, stdout_tail: 'FIX_DIFF {"claims_changed":false,"no_snapshot":false,"restored":[],"page_lint":"pass","snap_id":"s2"}' };
      return { ok: true, exit_code: 0, stdout_tail: '' };
    };
    const good = { hero_questions: 5, blocks_on_question: 1, objections_closed: 1, clonability: 1, flow: 5 };
    const w6 = await runWf('wf-06-audit', { pages: [{ slug: 'p1', type: 'category', round: 3 }], sample: [] }, judgeAns(good));
    const labels = w6.calls.map(c => c.label);
    check('wf-06: круг от round страницы (judge:p1:3), фиксер по round-3.json', labels.includes('judge:p1:3') && w6.calls.some(c => c.label === 'fix:p1' && /round-3\.json/.test(c.prompt)), labels.join(', '));
    check('wf-06: clonability ниже порога второй круг не назначает', !labels.includes('judge:p1:4'), labels.join(', '));
    const cj = w6.calls.find(c => c.label === 'cross-judge');
    check('wf-06: кросс-судье передан current', !!cj && /current=p1\b/.test(cj.prompt), cj && cj.prompt.slice(-120));
    check('wf-06: находки кросса вне аудита фиксер не получает, они в cross_outside (needs_fact - нет)', labels.includes('fix:p1:cross') && !labels.includes('fix:out:cross') && canon(w6.result.cross_outside) === canon([{ slug: 'out', findings: 1 }]), JSON.stringify(w6.result.cross_outside));
    const fin = w6.calls.find(c => c.label === 'render-md');
    check('wf-06: в конце split-cross --merge, render-md, затем lint-page страниц аудита', !!fin && /split-cross\.mjs --merge; node scripts\/render-md\.mjs; node scripts\/lint-page\.mjs p1/.test(fin.prompt), fin && fin.prompt.slice(0, 300));
    const w6b = await runWf('wf-06-audit', { pages: [{ slug: 'p1', type: 'category' }], sample: [] }, judgeAns({ ...good, flow: 2 }));
    const l6b = w6b.calls.map(c => c.label);
    const r2 = w6b.calls.find(c => c.label === 'judge:p1:2');
    check('wf-06: flow ниже порога - второй круг (round 2, scope fixed, prev round-1)', !!r2 && /scope=fixed/.test(r2.prompt) && /reason=scores:flow/.test(r2.prompt) && /prev=work\/audit\/p1\/round-1\.json/.test(r2.prompt) && l6b.includes('judge:p1:1'), l6b.join(', '));
    const w6c = await runWf('wf-06-audit', { pages: [{ slug: 'p1', type: 'category' }], sample: [], crossFixAll: true }, judgeAns(good));
    check('wf-06: crossFixAll - фиксер и вне аудита, lint-page и у него', w6c.calls.some(c => c.label === 'fix:out:cross') && /lint-page\.mjs out\b/.test(w6c.calls.find(c => c.label === 'render-md').prompt));
    const w6d = await runWf('wf-06-audit', { pages: [{ slug: 'p1', type: 'category' }], sample: [], skipCross: true }, judgeAns(good));
    check('wf-06: без кросса - без split-cross --merge', !/split-cross/.test(w6d.calls.find(c => c.label === 'render-md').prompt));
    const wNoFix = await runWf('wf-06-audit', { pages: [{ slug: 'p1', type: 'category' }], sample: [] }, (label, prompt) => (label === 'cross-judge' ? { findings: [], verdict: 'pass', summary: '' } : judgeAns(good)(label, prompt)));
    check('wf-06: кросс без исправимых находок - split-cross --merge все равно', /split-cross\.mjs --merge/.test(wNoFix.calls.find(c => c.label === 'render-md').prompt));
    // wf-06b: сборка - render-md раньше lint-page, проверки через «;», check-site-js до report
    const w6f = await runWf('wf-06b-fix-repeats', { slug: 'p1', skipJudge: true }, label => (label === 'build' ? { ok: true, exit_code: 0, stdout_tail: '' } : { slug: 'p1', fixed: 0, rejected: 0, left_open: 0, blocker_open: 0, lint: 'pass', page_lint: 'pass' }));
    const bp = (w6f.calls.find(c => c.label === 'build') || {}).prompt || '';
    // P4 (программа 28.09): проверки и отчет - только после кода 0 build-html, сборка в Bash с timeout 600000
    check('wf-06b: сборка render-md -> lint-page -> build-html && { check-html; check-site-js; report; }, timeout 600000', /render-md\.mjs p1; node scripts\/lint-page\.mjs p1; node scripts\/build-html\.mjs && \{ node scripts\/check-html\.mjs; node scripts\/check-site-js\.mjs; node scripts\/report\.mjs; \}/.test(bp) && /timeout 600000/.test(bp), bp.slice(0, 400));
  }
} catch (e) {
  fail++; failures.push(`FAIL исключение: ${e.stack || e.message}`);
} finally {
  // SITE_TEKST_TEST_KEEP=1 - не удалять песочницу (разбор упавшего шага руками), как в run.mjs
  if (process.env.SITE_TEKST_TEST_KEEP === '1') console.log(`песочница оставлена: ${tmpRoot}`);
  else fs.rmSync(tmpRoot, { recursive: true, force: true });
}

skips.forEach(s => console.log(s));
failures.forEach(f => console.log(f));
console.log(`cases-flow: ${pass} ok, ${fail} fail${skipped ? `, ${skipped} skip` : ''}`);
process.exit(fail ? 1 : 0);
