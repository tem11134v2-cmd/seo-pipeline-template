#!/usr/bin/env node
// run.mjs - набор /site-tekst (алгоритм текстов v9, kit в .claude/skills/site-tekst/kit).
//
// Использование:
//   .claude\scripts\_node.cmd .claude\tests\site-tekst\run.mjs
//   SITE_TEKST_TEST_KEEP=1 - не удалять песочницу (разбор упавшего шага руками)
//   SITE_TEKST_TEST_SECTIONS=2,3,7 - только эти разделы (шаги прочих не запускаются и не считаются). Зависимости: разделы
//   4 и 5 читают задачу раздела 3, раздел 5 - еще клиента раздела 2 (запускать вместе с ними).
//
// Состав:
//   1. kit: lint-cases.mjs (линтер), scripts-cases.mjs (скрипты) и workflow-models.mjs (модели по ролям в воркфлоу,
//      подставные agent/parallel/pipeline/workflow) рядом - против kit, код 0.
//   2. Папка задачи: task.mjs plan/init/place - номер max+1 по всем texts/* (v7 тоже), ссылки meta.json, пути sources
//      от папки задачи, копия kit по манифесту, правка на месте -> код 3, overrides/ поверх kit, --force, запрет
//      overrides на данные, пересчет sources после импорта (абсолютные пути чужой worktree); gate_approved по лестнице
//      анализа (nextStep queue.mjs: гейт на шаге 3b и круг ответов после гейта - false), gate_note без gate.checks; tier seo без --structure -
//      структура с тем же номером только своего анализа (project_path), иначе код 2 (не импортирована, чужая, нет).
//   3. Холостой прогон: клиентский проект во временной папке, texts/001-smoke/ + копия kit скриптом + дымовые фикстуры
//      + цепочка скриптов из kit/examples/smoke-fixtures/README.md с ожидаемыми итогами; args воркфлоу (волны по карте,
//      пилот при паузе pilot), status, stop, report (разделы C9), check-site-js (pass или SKIP), preview.
//   4. .gitignore: копия kit в папке задачи игнорируется, данные задачи и сам kit в .claude/skills - нет.
//   5. read-faq-input --from-tekst: задача v9 (sitemap + page.md, факты, бренд, регион, запреты в inputs.json) и v7 как раньше.
//   6. Цикл worktree: git worktree add, папка задачи, current-task.txt, коммит данных через pre-commit
//      (core.hooksPath .claude/git-hooks), копии kit в коммите нет; чужой файл и коммит без current-task - отказ;
//      current-task.txt с BOM (PowerShell) хук принимает.
//   7. Синк: движок sync-from-template.mjs шаблона раскатывает kit в пустой клиент без правки SYNC_DIRS, kit коммитится
//      (клиент во временной папке ОС: короткий путь Windows не считается worktree).
// bash ищется в PATH, затем рядом с git (Git for Windows: из PowerShell bash в PATH нет). Он нужен только прямому вызову
// update-meta.sh; шаги с коммитом через pre-commit к bash не привязаны - хуки исполняет сам git.
//
// Exit 0 - все прошли. Exit 1 - есть провал.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const SKILL = path.join(ROOT, '.claude', 'skills', 'site-tekst');
const KIT = path.join(SKILL, 'kit');
const TASK_MJS = '.claude/skills/site-tekst/task.mjs';
const KEEP = process.env.SITE_TEKST_TEST_KEEP === '1';
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'site-tekst-test-'));

let passed = 0, failed = 0, skipped = 0;
const failures = [];
const ONLY = new Set(String(process.env.SITE_TEKST_TEST_SECTIONS || '').split(',').map(x => x.trim()).filter(Boolean));
let CURRENT = '';
function step(name, fn) {
  if (ONLY.size && !ONLY.has(CURRENT)) return;
  try {
    const r = fn();
    if (r === true || r === undefined) { console.log(`  [test] ${name} ... PASS`); passed++; }
    else if (typeof r === 'string' && r.startsWith('SKIP')) { console.log(`  [test] ${name} ... SKIP (${r.slice(4).replace(/^:\s*/, '')})`); skipped++; }
    else { console.log(`  [test] ${name} ... FAIL (${r})`); failed++; failures.push(`${name}: ${r}`); }
  } catch (e) {
    console.log(`  [test] ${name} ... FAIL (${e.message})`); failed++; failures.push(`${name}: ${e.message}`);
  }
}
const section = t => {
  CURRENT = (String(t).match(/^(\d+)\./) || [])[1] || '';
  if (!ONLY.size || ONLY.has(CURRENT)) console.log(`\n=== ${t} ===`);
};

// ---------------------------------------------------------------- помощники
const rj = f => JSON.parse(fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, ''));
const wj = (f, o) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(o, null, 2) + '\n'); };
const wt = (f, s) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, s); };
const sha = f => crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex');
const canon = v => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map(key => [key, x[key]])) : x));
function sh(cmd, args, cwd, env) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', env: env ? { ...process.env, ...env } : process.env });
  return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '', out: (r.stdout || '') + (r.stderr || ''), error: r.error };
}
const node = (cwd, args) => sh(process.execPath, args, cwd);
const task = (cwd, ...args) => node(cwd, [TASK_MJS, ...args]);
const json = s => { try { return JSON.parse(s); } catch { return null; } };
// bash: PATH, затем рядом с git (Git for Windows: <git --exec-path>/../../../bin/bash.exe, каталог git var GIT_SHELL_PATH).
function findBash() {
  const ok = b => { const r = spawnSync(b, ['-c', 'exit 0'], { encoding: 'utf8' }); return !r.error && r.status === 0; };
  if (ok('bash')) return 'bash';
  const cands = [];
  const ex = spawnSync('git', ['--exec-path'], { encoding: 'utf8' });
  if (!ex.error && ex.status === 0 && ex.stdout.trim()) cands.push(path.resolve(ex.stdout.trim(), '..', '..', '..', 'bin', 'bash.exe'), path.resolve(ex.stdout.trim(), '..', '..', '..', 'usr', 'bin', 'bash.exe'));
  const gs = spawnSync('git', ['var', 'GIT_SHELL_PATH'], { encoding: 'utf8' });
  if (!gs.error && gs.status === 0 && gs.stdout.trim()) cands.push(path.join(path.dirname(gs.stdout.trim()), 'bash.exe'), path.resolve(path.dirname(gs.stdout.trim()), '..', '..', 'bin', 'bash.exe'));
  for (const c of cands) if (fs.existsSync(c) && ok(c)) return c;
  return null;
}
const BASH = findBash();
const HAS_GIT = !sh('git', ['--version'], ROOT).error;
function walk(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p).map(r => `${e.name}/${r}`)); else out.push(e.name);
  }
  return out.sort();
}
function git(cwd, args) { return sh('git', ['-c', 'core.quotepath=false', ...args], cwd); }
function gitInit(dir) {
  git(dir, ['init', '-q']);
  git(dir, ['config', 'user.email', 't@example.com']);
  git(dir, ['config', 'user.name', 'test']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  git(dir, ['config', 'core.autocrlf', 'false']);
}
// Клиентский проект: машинерия, которую трогает /site-tekst, скопирована из шаблона как есть.
function mkClient(name) {
  const dir = path.join(SANDBOX, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(path.join(ROOT, '.gitignore'), path.join(dir, '.gitignore'));
  fs.cpSync(SKILL, path.join(dir, '.claude', 'skills', 'site-tekst'), { recursive: true });
  for (const f of ['.claude/hooks/update-meta.sh', '.claude/git-hooks/pre-commit', '.claude/scripts/read-faq-input.mjs']) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.copyFileSync(path.join(ROOT, f), path.join(dir, f));
  }
  // лестница анализа (queue.mjs nextStep): по ней plan считает gate_approved
  fs.cpSync(path.join(ROOT, '.claude', 'scripts', 'site'), path.join(dir, '.claude', 'scripts', 'site'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.claude', 'tmp'), { recursive: true });
  return dir;
}
const declare = (dir, rel) => wt(path.join(dir, '.claude', 'tmp', 'current-task.txt'), `${rel}/\n`);
// Анализ sites/NNN на шаге «гейт пройден» лестницы queue.mjs nextStep (K10): три ответа оператора, фактура, смыслы,
// контракт, состав страниц (tier basic), два документа со ссылками, отметка гейта с gate.checks.
const CHECKS = { step: '5', verify: 0, sheets: [{ file: 'answers.txt', sha: 'x' }] };
function mkSite(dir, { tier = 'basic', gate = { approved: true, by: 'test', checks: CHECKS }, structure = true } = {}) {
  wj(path.join(dir, 'queue.json'), { tier, type: 'services', site_kind: 'multipage', docs: { understood: 'https://example.test/u', ask: 'https://example.test/a' }, ...(gate ? { gate } : {}) });
  wj(path.join(dir, 'project.json'), { tier, business: { type: 'services', site_kind: 'multipage' } });
  wj(path.join(dir, 'parts', 'facts.json'), { facts: [] });
  wj(path.join(dir, 'parts', 'market.json'), {});
  wt(path.join(dir, 'docs', 'understood.html'), '<p>понято</p>\n');
  wt(path.join(dir, 'docs', 'ask.html'), '<p>вопросы</p>\n');
  if (structure) wj(path.join(dir, 'structure_data.json'), { source_file: 'pages-planner', pages: [{ n: 1, url: '/', type: 'Главная', name: 'Главная', target_status: 'yes' }] });
}

const { kitFiles, KIT_DIRS, KIT_FILES, mergePatch, previewPort, PREVIEW_BASE, PREVIEW_SPAN } = await import(new URL('../../skills/site-tekst/task.mjs', import.meta.url));

console.log('=== site-tekst (kit v9, папка задачи, холостой прогон, .gitignore, FAQ, worktree, синк) ===');
console.log(`Песочница: ${SANDBOX}`);

// ================================================================ 1. kit
section('1. kit: lint-cases, scripts-cases, workflow-models');
// наборы кейсов: три базовых + любые cases-<тема>.mjs рядом (по одному файлу на тему правок)
const CASE_FILES = ['lint-cases.mjs', 'scripts-cases.mjs', 'workflow-models.mjs',
  ...fs.readdirSync(HERE).filter(f => /^cases-[a-z0-9-]+\.mjs$/.test(f)).sort()];
for (const f of CASE_FILES) {
  step(`${f}: код 0`, () => {
    const r = node(ROOT, [path.join(HERE, f)]);
    const tail = r.out.trim().split('\n').slice(-1)[0];
    console.log(`         ${tail}`);
    return r.code === 0 || `код ${r.code}: ${r.out.split('\n').filter(l => /^FAIL/.test(l)).slice(0, 5).join(' | ')}`;
  });
}
step('kit без данных и служебных документов источника', () => {
  const bad = walk(KIT).filter(r => /^(tests|docs\/(recon-|gate0-|NEXT-SESSION))/.test(r) || (/^(work|inputs)\//.test(r) && !/\/\.gitkeep$/.test(r)) || r === '.gitignore');
  return !bad.length || bad.slice(0, 5).join(', ');
});

// ================================================================ 2. папка задачи
section('2. task.mjs: номер, ссылки, копия kit');
const P = mkClient('client');
mkSite(path.join(P, 'sites', '002-okna'));
mkSite(path.join(P, 'sites', '003-nogate'), { gate: { approved: false } });
wj(path.join(P, 'structures', '005-okna', 'structure_data.json'), { pages: [] });
// гейт поставлен, но состав страниц пропал (d7 сменили после гейта): лестница стоит на 3b
mkSite(path.join(P, 'sites', '004-stale'), { structure: false });
// гейт до проверок готовности (queue.json без gate.checks)
mkSite(path.join(P, 'sites', '006-oldgate'), { gate: { approved: true, by: 'test' } });
// круг ответов после гейта: answers-2.txt появился после отметки (gate.checks.sheets его не знает) - анализ снова на шаге 5
mkSite(path.join(P, 'sites', '015-round2'));
wt(path.join(P, 'sites', '015-round2', 'answers-2.txt'), 'f01: нет\n');
// tier seo: 009 - своя структура; 010 - своя, не импортирована; 011 - структуры нет, но лежит состав планировщика
// (SEO докупили позже); 012 - структура с тем же номером построена на другом анализе; 013 - старая структура на analyses/
for (const n of ['009-seo', '010-seonoimp', '011-seonone', '012-seoalien', '013-seoold']) mkSite(path.join(P, 'sites', n), { tier: 'seo', structure: n === '011-seonone' });
wj(path.join(P, 'structures', '009-seo', 'meta.json'), { state: 'completed', project_path: 'sites/009-seo/project.json', site_dir: 'sites/009-seo/' });
wj(path.join(P, 'structures', '009-seo', 'structure_data.json'), { pages: [] });
wj(path.join(P, 'structures', '010-seonoimp', 'meta.json'), { state: 'client-review', project_path: 'sites/010-seonoimp/project.json' });
wj(path.join(P, 'structures', '012-seoalien', 'meta.json'), { state: 'completed', project_path: 'sites/001-other/project.json' });
wj(path.join(P, 'structures', '012-seoalien', 'structure_data.json'), { pages: [] });
wj(path.join(P, 'structures', '013-seoold', 'meta.json'), { state: 'completed', analysis_dir: 'analyses/013-seoold' });
wj(path.join(P, 'structures', '013-seoold', 'structure_data.json'), { pages: [] });
// задача v7 (формат выведенного конвейера текстов v7): для номера и для совместимости FAQ
wj(path.join(P, 'texts', '007-old', 'meta.json'), { format: 'v7', state: 'completed' });
wj(path.join(P, 'texts', '007-old', 'pages.json'), { pages: [{ slug: 'glavnaya', marker: 'окна тула', queries: ['окна тула', 'пластиковые окна'], url: 'https://old.example/' }] });
wj(path.join(P, 'texts', '007-old', 'pages', 'glavnaya', 'page.json'), { page: { slug: 'glavnaya', url: 'https://old.example/' }, h1: 'Окна в Туле', blocks: [{ title: 'Монтаж', text: 'Монтаж за один день' }] });

step('plan --site 2: номер 008 (max+1 и по v7), структура анализа, гейт согласован, tier basic', () => {
  const r = task(P, 'plan', '--site', '2'); const j = json(r.stdout);
  if (r.code !== 0 || !j) return `код ${r.code}: ${r.out}`;
  return (j.task_dir === 'texts/008-okna' && j.structure === 'sites/002-okna/structure_data.json' && j.source === 'project' && j.gate_approved === true && j.tier === 'basic' && j.gate_step === '' && j.gate_note === '' && !/внимание/.test(r.stderr)) || `${JSON.stringify(j)} ${r.stderr}`;
});
step('plan --structure 5: структура SEO вместо структуры анализа', () => {
  const j = json(task(P, 'plan', '--site', '2', '--structure', '5').stdout);
  return (j && j.structure === 'structures/005-okna') || JSON.stringify(j);
});
step('plan: гейт анализа не согласован - gate_approved false, gate_step 5', () => {
  const j = json(task(P, 'plan', '--site', '3').stdout);
  return (j && j.gate_approved === false && /^5 /.test(j.gate_step) && j.structure === 'sites/003-nogate/structure_data.json') || JSON.stringify(j);
});
step('plan: гейт поставлен, но лестница анализа на 3b (нет состава) - gate_approved false (K10)', () => {
  const r = task(P, 'plan', '--site', '4'); const j = json(r.stdout);
  return (r.code === 0 && j && j.gate_approved === false && /^3b /.test(j.gate_step) && /шаг 3b/.test(r.stderr)) || `${r.code} ${JSON.stringify(j)} ${r.stderr}`;
});
step('plan: гейт без gate.checks (до проверок готовности) принят, одна строка предупреждения', () => {
  const r = task(P, 'plan', '--site', '6'); const j = json(r.stdout);
  const warns = r.stderr.split('\n').filter(l => /внимание/.test(l));
  return (r.code === 0 && j && j.gate_approved === true && /нет gate\.checks/.test(j.gate_note) && warns.length === 1) || `${JSON.stringify(j)} ${r.stderr}`;
});
// стык P1-P8 (интеграция): круг ответов после гейта держит /site-tekst до apply-answers и нового гейта (nextStep, K10)
step('plan: круг ответов после гейта (answers-2.txt) - gate_approved false, gate_step 5', () => {
  const r = task(P, 'plan', '--site', '15'); const j = json(r.stdout);
  return (r.code === 0 && j && j.gate_approved === false && /^5 /.test(j.gate_step) && /после гейта/.test(`${j.gate_step} ${r.stderr}`)) || `${r.code} ${JSON.stringify(j)} ${r.stderr}`;
});
step('plan tier seo без --structure: своя структура с тем же номером (project_path), строка об этом, tier в выводе', () => {
  const r = task(P, 'plan', '--site', '9'); const j = json(r.stdout);
  return (r.code === 0 && j && j.tier === 'seo' && j.structure === 'structures/009-seo' && /взята по номеру анализа/.test(r.stderr)) || `${r.code} ${JSON.stringify(j)} ${r.stderr}`;
});
step('plan tier seo: структура не импортирована / нет структуры (состав планировщика не берется) - код 2 с подсказками', () => {
  const a = task(P, 'plan', '--site', '10'), b = task(P, 'plan', '--site', '11');
  if (a.code !== 2 || !/не импортирована \(state client-review\)/.test(a.stderr) || !/--import/.test(a.stderr)) return `010: ${a.code} ${a.out}`;
  return (b.code === 2 && /сначала \/seo-struktura 011/.test(b.stderr) && /--structure-file sites\/011-seonone\/structure_data\.json/.test(b.stderr) && !b.stdout.trim()) || `011: ${b.code} ${b.out}`;
});
step('plan tier seo: структура с тем же номером на чужом анализе или на analyses/ - код 2 «построена не на этом анализе»', () => {
  const a = task(P, 'plan', '--site', '12'), b = task(P, 'plan', '--site', '13');
  const ok = r => r.code === 2 && /построена не на этом анализе/.test(r.stderr) && /--structure <MMM>/.test(r.stderr);
  return (ok(a) && /sites\/001-other/.test(a.stderr) && ok(b) && /старая структура на analyses/.test(b.stderr)) || `${a.code} ${a.stderr} | ${b.code} ${b.stderr}`;
});
step('plan: анализ без tier (ни в queue.json, ни в project.json) - как basic: состав анализа берется', () => {
  const d = path.join(P, 'sites', '014-notier');
  mkSite(d);
  const q = rj(path.join(d, 'queue.json')); delete q.tier; wj(path.join(d, 'queue.json'), q);
  const pj = rj(path.join(d, 'project.json')); delete pj.tier; wj(path.join(d, 'project.json'), pj);
  const j = json(task(P, 'plan', '--site', '14').stdout);
  fs.rmSync(d, { recursive: true, force: true });
  return (j && j.tier === 'basic' && j.structure === 'sites/014-notier/structure_data.json') || JSON.stringify(j);
});
step('plan tier seo: явный обход - --structure-file состава анализа и --structure берутся', () => {
  const a = json(task(P, 'plan', '--site', '11', '--structure-file', 'sites/011-seonone/structure_data.json').stdout);
  const b = json(task(P, 'plan', '--site', '12', '--structure', '12').stdout);
  return (a && a.structure === 'sites/011-seonone/structure_data.json' && b && b.structure === 'structures/012-seoalien') || `${JSON.stringify(a)} ${JSON.stringify(b)}`;
});
step('plan: нет анализа / нет входа / --doc без slug - код 2', () => {
  const codes = [task(P, 'plan', '--site', '99').code, task(P, 'plan').code, task(P, 'plan', '--doc', 'X').code, task(P, 'plan', '--site', '2', '--structure', '6').code];
  return codes.every(c => c === 2) || `коды ${codes.join(',')}`;
});
step('plan ничего не пишет', () => !fs.existsSync(path.join(P, 'texts', '008-okna')) || 'папка задачи появилась');

const T8 = path.join(P, 'texts', '008-okna');
step('init --site 2 --structure 5: meta v9, конфиг, decisions, копия kit по манифесту', () => {
  declare(P, 'texts/008-okna');
  const r = task(P, 'init', '--task', 'texts/008-okna', '--site', '2', '--structure', '5');
  if (r.code !== 0) return `код ${r.code}: ${r.out}`;
  const meta = rj(path.join(T8, 'meta.json'));
  if (meta.format !== 'v9' || meta.site !== 'sites/002-okna' || meta.structure !== 'structures/005-okna' || meta.source !== 'project') return `meta ${JSON.stringify(meta)}`;
  const S = rj(path.join(T8, 'config', 'project.json')).sources;
  if (S.mode !== 'project' || !fs.existsSync(path.resolve(T8, S.project_json)) || !fs.existsSync(path.resolve(T8, S.structure_input))) return `sources ${JSON.stringify(S)}`;
  if (path.isAbsolute(S.project_json)) return 'sources.project_json абсолютный';
  if (!fs.existsSync(path.join(T8, 'rules', 'decisions.md'))) return 'нет rules/decisions.md';
  const man = rj(path.join(T8, '.kit.json'));
  const want = kitFiles();
  if (Object.keys(man.files).length !== want.length) return `манифест ${Object.keys(man.files).length}, kit ${want.length}`;
  // сверка с kit клиента (копия задачи кладется из него; kit шаблона могут править параллельно)
  const bad = want.filter(f => sha(path.join(T8, f)) !== sha(path.join(P, '.claude', 'skills', 'site-tekst', 'kit', f)));
  if (bad.length) return `не совпали с kit: ${bad.slice(0, 3).join(', ')}`;
  const args = json((r.stdout.match(/^args: (.*)$/m) || [])[1]);
  return (args && path.resolve(args.root) === path.resolve(T8) && args.model === 'opus' && args.model_light === 'sonnet') || `args ${JSON.stringify(args)}`;
});
step('init в занятую папку - отказ', () => task(P, 'init', '--task', 'texts/008-okna', '--site', '2').code === 1 || 'не отказал');
step('update-meta.sh: state поверх затравки init, format и ссылки на месте', () => {
  if (!BASH) return 'SKIP: bash не найден ни в PATH, ни рядом с git';
  const r = sh(BASH, ['.claude/hooks/update-meta.sh', 'texts/008-okna', 'init'], P);
  if (r.code !== 0) return `код ${r.code}: ${r.out}`;
  const m = rj(path.join(T8, 'meta.json'));
  return (m.state === 'init' && m.format === 'v9' && m.site === 'sites/002-okna' && (m.completed_steps || []).includes('init')) || JSON.stringify(m);
});
step('place повторно: ничего не копирует', () => {
  const r = task(P, 'place', '8');
  return (r.code === 0 && /скопировано 0,/.test(r.stdout)) || r.out;
});
step('правка копии kit на месте - код 3 со списком (.json - по данным: пробел не правка)', () => {
  const lf = path.join(T8, 'rules', 'lint.json');
  fs.appendFileSync(lf, ' ');
  const ws = task(P, 'place', '8');
  if (ws.code !== 0) return `пробел в .json: код ${ws.code}: ${ws.out}`;
  const l = rj(lf); l.x_edit = 1; fs.writeFileSync(lf, JSON.stringify(l, null, 2) + '\n');
  const r = task(P, 'place', '8');
  return (r.code === 3 && /rules\/lint\.json/.test(r.stderr) && /overrides/.test(r.stderr)) || `код ${r.code}: ${r.out}`;
});
step('overrides/ поверх kit: правка проекта переживает освежение', () => {
  fs.mkdirSync(path.join(T8, 'overrides', 'rules'), { recursive: true });
  fs.copyFileSync(path.join(T8, 'rules', 'lint.json'), path.join(T8, 'overrides', 'rules', 'lint.json'));
  const r = task(P, 'place', '8');
  if (r.code !== 0 || !/переопределений 1/.test(r.stdout)) return `код ${r.code}: ${r.out}`;
  const again = task(P, 'place', '8');
  // K9: .json override сливается с kit (RFC 7396); здесь override - полная копия kit с правкой, итог равен ему по данным
  const placed = rj(path.join(T8, 'rules', 'lint.json')), ov = rj(path.join(T8, 'overrides', 'rules', 'lint.json'));
  return (again.code === 0 && /скопировано 0,/.test(again.stdout) && canon(placed) === canon(mergePatch(rj(path.join(P, '.claude', 'skills', 'site-tekst', 'kit', 'rules', 'lint.json')), ov)) && canon(placed) === canon(ov)) || again.out;
});
step('override снят - файл снова из kit', () => {
  fs.rmSync(path.join(T8, 'overrides'), { recursive: true });
  const r = task(P, 'place', '8');
  return (r.code === 0 && sha(path.join(T8, 'rules', 'lint.json')) === sha(path.join(P, '.claude', 'skills', 'site-tekst', 'kit', 'rules', 'lint.json'))) || r.out;
});
step('чужой файл в копии kit: код 3, --force удаляет; decisions.md не трогается', () => {
  wt(path.join(T8, 'prompts', 'local.md'), 'x');
  fs.appendFileSync(path.join(T8, 'rules', 'decisions.md'), '\nрешение проекта\n');
  const r = task(P, 'place', '8');
  if (r.code !== 3 || !/prompts\/local\.md/.test(r.stderr) || /decisions/.test(r.stderr)) return `код ${r.code}: ${r.out}`;
  const f = task(P, 'place', '8', '--force');
  if (f.code !== 0 || fs.existsSync(path.join(T8, 'prompts', 'local.md'))) return `force: ${f.out}`;
  return /решение проекта/.test(fs.readFileSync(path.join(T8, 'rules', 'decisions.md'), 'utf8')) || 'decisions.md затерт';
});
step('overrides на данные задачи - отказ', () => {
  wt(path.join(T8, 'overrides', 'work', 'facts.json'), '{}');
  const r = task(P, 'place', '8');
  fs.rmSync(path.join(T8, 'overrides'), { recursive: true });
  return (r.code === 1 && /только файлы kit/.test(r.stderr)) || `код ${r.code}: ${r.out}`;
});
step('пути sources после импорта (абсолютные, чужая worktree) пересчитываются от meta', () => {
  const cf = path.join(T8, 'config', 'project.json');
  const cfg = rj(cf);
  cfg.sources.project_json = 'C:/elsewhere/.claude/worktrees/x/sites/002-okna/project.json';
  cfg.sources.facts_src = 'C:/elsewhere/sites/002-okna/parts/facts-src.json';
  wj(cf, cfg);
  const r = task(P, 'place', '8');
  const S = rj(cf).sources;
  return (r.code === 0 && /пересчитаны/.test(r.stdout) && S.project_json === '../../sites/002-okna/project.json' && S.facts_src === '') || `${r.out} ${JSON.stringify(S)}`;
});
step('args facts: source project, structureMode import', () => {
  const j = json(task(P, 'args', '8', 'facts').stdout);
  return (j && j.source === 'project' && j.structureMode === 'import' && !j.allowUngated) || JSON.stringify(j);
});
step('find: задача v9 видна, v7 - нет; задача v7 для скила - код 2', () => {
  const r = task(P, 'find');
  const v7 = task(P, 'status', '7');
  return (r.code === 0 && /texts\/008-okna init/.test(r.stdout) && !/007-old/.test(r.stdout) && v7.code === 2) || `${r.out} | ${v7.out}`;
});

// ================================================================ 3. холостой прогон
section('3. холостой прогон: texts/001-smoke, копия kit, фикстуры, цепочка скриптов');
const Q = mkClient('smoke');
const S = path.join(Q, 'texts', '001-smoke');
const FIX = path.join(KIT, 'examples', 'smoke-fixtures');
step('init --doc --slug smoke: texts/001-smoke, копия kit скриптом', () => {
  declare(Q, 'texts/001-smoke');
  const r = task(Q, 'init', '--task', 'texts/001-smoke', '--doc', 'TESTDOC', '--slug', 'smoke');
  if (r.code !== 0) return `код ${r.code}: ${r.out}`;
  const cfg = rj(path.join(S, 'config', 'project.json'));
  return (cfg.slug === 'smoke' && cfg.sources.mode === 'doc' && cfg.sources.analysis_doc_id === 'TESTDOC' && fs.existsSync(path.join(S, 'scripts', 'lib.mjs'))) || JSON.stringify(cfg.sources);
});
step('фикстуры: work/ - данные, правила фикстуры - через overrides/', () => {
  fs.cpSync(path.join(FIX, 'work'), path.join(S, 'work'), { recursive: true });
  fs.cpSync(path.join(FIX, 'rules'), path.join(S, 'overrides', 'rules'), { recursive: true });
  const cf = path.join(S, 'config', 'project.json');
  const cfg = rj(cf); cfg.company = 'Веста Окна'; cfg.site_url = 'https://okna-test.example'; cfg.niche.geo = 'Тула';
  cfg.competitors.aggregators_stoplist = ['avito.ru']; wj(cf, cfg);
  const r = task(Q, 'place', '1');
  // K9: .json из overrides - слияние с файлом kit по RFC 7396 (массив formulas фикстуры заменяет массив kit, прочие ключи
  // kit остаются), а не копия файла фикстуры
  const placed = rj(path.join(S, 'rules', 'offer-formulas.json'));
  const want = mergePatch(rj(path.join(Q, '.claude', 'skills', 'site-tekst', 'kit', 'rules', 'offer-formulas.json')), rj(path.join(FIX, 'rules', 'offer-formulas.json')));
  return (r.code === 0 && /переопределений 1/.test(r.stdout) && /дополняют kit[^\n]*rules\/offer-formulas\.json/.test(r.stdout) && canon(placed) === canon(want) && canon(placed.formulas) === canon(rj(path.join(FIX, 'rules', 'offer-formulas.json')).formulas)) || r.out;
});
const K = (...args) => node(S, args);
step('build-briefs: брифов 2, срезов 8, проблем 0', () => {
  const r = K('scripts/build-briefs.mjs');
  return (r.code === 0 && /брифов собрано: 2/.test(r.out) && /срезов для писателей: 8/.test(r.out) && /проблем: 0/.test(r.out)) || r.out.slice(0, 300);
});
step('lint: B02-benefits blocked, остальные 4 блока pass', () => {
  const blocks = ['home/blocks/B01-hero', 'home/blocks/B02-benefits', 'home/blocks/B03-process', 'okna-rehau/blocks/B01-hero', 'okna-rehau/blocks/B02-listing'];
  const res = blocks.map(b => { const r = K('scripts/lint.mjs', `work/pages/${b}.json`); return { b, code: r.code, v: (r.out.match(/: (pass|fix|blocked) \(/) || [])[1] }; });
  const bad = res.filter(x => (x.b.endsWith('B02-benefits') ? x.v !== 'blocked' || x.code === 0 : x.v !== 'pass'));
  return !bad.length || JSON.stringify(bad);
});
step('page-state home: готово 3/5; render-md; dedup - находок 0', () => {
  const ps = K('scripts/page-state.mjs', 'home'), md = K('scripts/render-md.mjs'), dd = K('scripts/dedup.mjs');
  return (ps.code === 0 && /готово блоков 3\/5/.test(ps.out) && md.code === 0 && fs.existsSync(path.join(S, 'work', 'pages', 'home', 'page.md')) && dd.code === 0 && /находок 0/.test(dd.out)) || `${ps.out} | ${md.out} | ${dd.out}`.slice(0, 400);
});
step('cross-digest: пар 0, код 0; blind-prep home: blind-view.md', () => {
  const cd = K('scripts/cross-digest.mjs'), bp = K('scripts/blind-prep.mjs', 'home');
  return (cd.code === 0 && /пар-кандидатов 0/.test(cd.out) && bp.code === 0 && fs.existsSync(path.join(S, 'work', 'audit', 'home', 'blind-view.md'))) || `${cd.out} | ${bp.out}`.slice(0, 400);
});
step('prep-args: типы home и category, по странице', () => {
  const j = json(K('scripts/prep-args.mjs').stdout);
  return (j && canon(j.types) === canon(['home', 'category']) && j.type_pages.home === 1 && j.type_pages.category === 1) || JSON.stringify(j);
});
step('merge-strategy --split и обратно: strategy.json как был', () => {
  const before = rj(path.join(S, 'work', 'strategy.json'));
  const a = K('scripts/merge-strategy.mjs', '--split'), b = K('scripts/merge-strategy.mjs');
  const after = rj(path.join(S, 'work', 'strategy.json'));
  const strip = o => { const c = JSON.parse(JSON.stringify(o)); delete c.generated_at; delete c.merged_at; return c; };
  return (a.code === 0 && b.code === 0 && canon(strip(before).pages) === canon(strip(after).pages)) || `${a.out} | ${b.out}`.slice(0, 300);
});
step('validate-layout home pass; build-html: 2 страницы, 5 блоков; check-html код 1; report', () => {
  const vl = K('scripts/validate-layout.mjs', 'home'), bh = K('scripts/build-html.mjs'), ch = K('scripts/check-html.mjs'), rp = K('scripts/report.mjs');
  return (vl.code === 0 && /pass/.test(vl.out) && bh.code === 0 && /страниц 2, блоков 5/.test(bh.out) && ch.code === 1 && rp.code === 0 && fs.existsSync(path.join(S, 'work', 'output', 'prototype.html'))) || `${vl.code} ${bh.out} ${ch.code} ${rp.code}`.slice(0, 300);
});
step('plan-run: турнир у главной и у первой категории (C8), волны по карте: home - 1, okna-rehau - 2', () => {
  const j = json(K('scripts/plan-run.mjs').stdout);
  const m = j && Object.fromEntries(j.pages.map(p => [p.slug, `${p.hero_mode}/${p.wave}`]));
  return (m && m.home === 'tournament/1' && m['okna-rehau'] === 'tournament/2' && j.hero.mode === 'first-of-type') || JSON.stringify(m);
});
step('check-site-js: код 0 (pass или SKIP без jsdom), отчет prototype.js-check.json', () => {
  if (!fs.existsSync(path.join(S, 'scripts', 'check-site-js.mjs'))) return 'SKIP: check-site-js.mjs еще нет в kit';
  const r = K('scripts/check-site-js.mjs');
  const rep = path.join(S, 'work', 'output', 'prototype.js-check.json');
  return (r.code === 0 && fs.existsSync(rep) && ['pass', 'skip'].includes(rj(rep).verdict)) || `код ${r.code}: ${r.out.slice(0, 300)}`;
});
step('report: разделы C9 и итог проверок прототипа', () => {
  const r = K('scripts/report.mjs');
  const md = fs.readFileSync(path.join(S, 'work', 'output', 'report.md'), 'utf8');
  const need = ['## Сводка', '## Что спросить у заказчика', '## Не подтверждено или снято', '## Спорное: решения агента', '## Повторы между страницами', '## Major, закрытые фиксером без правки', '## Проверки прототипа', '## Интерфейс прототипа', '## По страницам'];
  const miss = need.filter(h => !md.includes(h));
  // свежая цепочка build-html -> check-html -> check-site-js: отчет не называет прототип устаревшим (sha данных сборки и
  // file_sha/proto_sha проверки скриптов совпадают с текущими)
  const stale = (md.match(/^- Прототип:.*$/m) || [''])[0];
  return (r.code === 0 && !miss.length && /- нет цен «от» по типам окон \(весь сайт\)/.test(md) && /check-html: /.test(md) && !/устарело/.test(stale)) || `код ${r.code}; нет: ${miss.join(', ')}; ${stale} ${r.out.slice(0, 200)}`;
});
// Число находок сверяется с отчетами в work/audit (линтер блоков, html-check, dedup): жесткое число из README фикстур
// меняют правки линтера и check-html; архивы кросса и свои выходы retro-stats не считает.
step('retro-stats последним: файлов 8, находок - сумма отчетов линтера, html-check и dedup', () => {
  const r = K('scripts/retro-stats.mjs');
  const audit = path.join(S, 'work', 'audit');
  const files = walk(audit).filter(f => f.endsWith('.json') && !/(^|\/)(retro-stats|cross-digest)\.json$/.test(f) && !/cross-archive-/.test(f));
  const total = files.reduce((n, f) => n + ((rj(path.join(audit, f)).findings || []).length), 0);
  return (r.code === 0 && files.length === 8 && /файлов 8/.test(r.out) && new RegExp(`находок ${total}\\b`).test(r.out)) || `файлов ${files.length}, находок в отчетах ${total}: ${r.out.slice(0, 300)}`;
});
step('args write: без выборки - волна 1 (home), concurrency 4; --wave 2 - okna-rehau; --slugs home - concurrency 1', () => {
  const all = json(task(Q, 'args', '1', 'write').stdout), w2 = json(task(Q, 'args', '1', 'write', '--wave', '2').stdout), one = json(task(Q, 'args', '1', 'write', '--slugs', 'home').stdout);
  if (!all || all.pages.length !== 1 || all.pages[0].slug !== 'home' || all.concurrency !== 4 || !all.pages[0].pending_blocks || all.pages[0].hero_mode !== 'tournament') return JSON.stringify(all).slice(0, 300);
  if (!w2 || w2.pages.length !== 1 || w2.pages[0].slug !== 'okna-rehau') return JSON.stringify(w2).slice(0, 300);
  return (one && one.pages.length === 1 && one.pages[0].slug === 'home' && one.concurrency === 1 && path.resolve(one.root) === path.resolve(S)) || JSON.stringify(one).slice(0, 300);
});
step('args audit без дописанных страниц - код 4; types - catalog; hero; fix без файла - код 2', () => {
  const au = task(Q, 'args', '1', 'audit'), ty = json(task(Q, 'args', '1', 'types').stdout), he = json(task(Q, 'args', '1', 'hero', '--slug', 'home').stdout), fx = task(Q, 'args', '1', 'fix', '--slug', 'home', '--findings', 'work/audit/home/nope.json');
  return (au.code === 4 && ty && ty.catalog === true && canon(ty.types) === canon(['home', 'category']) && he && he.slug === 'home' && fx.code === 2) || `${au.code} ${JSON.stringify(ty)} ${JSON.stringify(he)} ${fx.code}`;
});
step('args fix: skipJudge по умолчанию, --judge - следующий круг судьи; --extra', () => {
  const lp = K('scripts/lint-page.mjs', 'home');
  if (!fs.existsSync(path.join(S, 'work', 'audit', 'home', 'lint-page.json'))) return `lint-page: ${lp.out.slice(0, 200)}`;
  const a = json(task(Q, 'args', '1', 'fix', '--slug', 'home', '--findings', 'work/audit/home/lint-page.json').stdout);
  const b = json(task(Q, 'args', '1', 'fix', '--slug', 'home', '--findings', 'work/audit/home/lint-page.json', '--judge', '--extra', '{"x":1}').stdout);
  return (a && a.skipJudge === true && !a.round && b && !b.skipJudge && b.round === 3 && b.x === 1) || `${JSON.stringify(a)} ${JSON.stringify(b)}`;
});
step('находка человека (producer human) проходит схему findings kit', () => {
  wj(path.join(S, 'work', 'audit', 'home', 'human-test.json'), { scope: 'home', producer: 'human', created_at: '2026-09-23T10:00:00Z', verdict: 'fix', summary: 'правка человека',
    findings: [{ id: 'H1', page: 'home', block_id: 'B03-process', severity: 'major', category: 'weak', rule: 'human.fix', problem: 'сделать шаги конкретнее', quote: 'Замер на следующий день', status: 'open' }] });
  const r = K('scripts/validate.mjs', 'findings', 'work/audit/home/human-test.json');
  fs.rmSync(path.join(S, 'work', 'audit', 'home', 'human-test.json'));
  return r.code === 0 || r.out;
});
step('status: остановка, волны по карте, без предложения пилота, прототип', () => {
  const r = task(Q, 'status', '1');
  return (r.code === 0 && /остановка: нет/.test(r.stdout) && /волна 1: 1 стр\., брифов 1/.test(r.stdout) && /волна 2: 1 стр\., брифов 1/.test(r.stdout) && !/пилот/.test(r.stdout) && /прототип: texts\/001-smoke\/work\/output\/prototype\.html/.test(r.stdout) && r.stdout.split('\n').length <= 15) || r.out;
});
step('stop --set pilot: status с предложением пилота, args write - пилот; --clear снимает', () => {
  const s1 = task(Q, 'stop', '1', '--set', 'pilot');
  const st = task(Q, 'status', '1');
  const w = json(task(Q, 'args', '1', 'write').stdout);
  const c = task(Q, 'stop', '1', '--clear');
  const meta = rj(path.join(S, 'meta.json'));
  if (s1.code !== 0 || !/остановка: pilot/.test(st.stdout) || !/пилот \(предложение\): home,okna-rehau/.test(st.stdout)) return `${s1.out} | ${st.out}`;
  if (!w || w.pages.map(p => p.slug).join() !== 'home,okna-rehau' || w.concurrency !== 1) return JSON.stringify(w).slice(0, 300);
  return (c.code === 0 && !('stop' in meta)) || `${c.out} ${JSON.stringify(meta)}`;
});
step('status: решение d9 (состав страниц) из отчета импорта - на гейте 1', () => {
  const rep = path.join(S, 'work', 'import-report.json');
  const had = fs.existsSync(rep) ? fs.readFileSync(rep) : null;
  wj(rep, { gate: { approved: true, decisions: { d9: { name: 'состав страниц', value: '2 страниц в работе, снято 1; источник - состав анализа (pages-planner)', how: 'молчание заказчика, принят рекомендованный дефолт (j1)' } } }, warnings: [], empty: [], anti: { pending: [] } });
  const r = task(Q, 'status', '1');
  if (had) fs.writeFileSync(rep, had); else fs.rmSync(rep);
  return (r.code === 0 && /состав страниц \(d9\): 2 страниц в работе, снято 1; источник - состав анализа \(pages-planner\); молчание заказчика/.test(r.stdout) && r.stdout.split('\n').length <= 15) || r.out;
});
step('preview: конфиг site-tekst-001-smoke с serve.mjs задачи, порт от хеша пути папки задачи, повтор - та же запись', () => {
  const r = task(Q, 'preview', '1'); const j = json(r.stdout);
  const r2 = task(Q, 'preview', '1');
  const lj = rj(path.join(Q, '.claude', 'launch.json'));
  const mine = lj.configurations.filter(x => /texts\/001-smoke\/scripts\/serve\.mjs$/.test(x.runtimeArgs[0]));
  const want = previewPort(S);
  return (j && j.name === 'site-tekst-001-smoke' && j.port === want && want >= PREVIEW_BASE && want < PREVIEW_BASE + PREVIEW_SPAN && r2.code === 0 && mine.length === 1 && mine[0].port === want) || `${r.out} ${JSON.stringify(lj.configurations)}`;
});
step('preview: порт занят записью другой задачи в launch.json - следующий свободный; разные пути - разный хеш', () => {
  const lf = path.join(Q, '.claude', 'launch.json');
  const lj = rj(lf);
  const want = previewPort(S);
  lj.configurations = [{ name: 'site-tekst-001-other', runtimeExecutable: 'node', runtimeArgs: ['C:/other/texts/001-other/scripts/serve.mjs'], port: want }];
  wj(lf, lj);
  const j = json(task(Q, 'preview', '1').stdout);
  const next = PREVIEW_BASE + ((want - PREVIEW_BASE + 1) % PREVIEW_SPAN);
  const ports = new Set(['C:/a/texts/001-x', 'C:/b/texts/001-x', 'C:/a/.claude/worktrees/w1/texts/001-x', '/home/u/texts/001-x'].map(previewPort));
  return (j && j.port === next && ports.size > 1) || `${JSON.stringify(j)} ожидался ${next}; порты ${[...ports]}`;
});

// ================================================================ 4. .gitignore
section('4. .gitignore: копия kit - кеш, данные задачи - в git');
step('git add -A: данные задачи в индексе, копии kit нет', () => {
  gitInit(Q);
  const add = git(Q, ['add', '-A']);
  if (add.code !== 0) return add.out;
  const files = new Set(git(Q, ['ls-files', 'texts']).stdout.split('\n').filter(Boolean));
  const need = ['meta.json', 'config/project.json', 'rules/decisions.md', 'overrides/rules/offer-formulas.json', 'work/facts.json', 'work/sitemap.json', 'work/pages/home/page.md', 'work/pages/home/brief.json', 'work/output/prototype.html'].map(f => `texts/001-smoke/${f}`);
  const miss = need.filter(f => !files.has(f));
  if (miss.length) return `нет в индексе: ${miss.join(', ')}`;
  const man = Object.keys(rj(path.join(S, '.kit.json')).files).map(f => `texts/001-smoke/${f}`);
  const leaked = [...man, 'texts/001-smoke/.kit.json'].filter(f => files.has(f));
  return !leaked.length || `копия kit в индексе: ${leaked.slice(0, 5).join(', ')}`;
});
step('check-ignore: каждый файл манифеста и launch.json игнорируются, decisions.md и project.json - нет', () => {
  const man = Object.keys(rj(path.join(S, '.kit.json')).files).map(f => `texts/001-smoke/${f}`);
  const r = spawnSync('git', ['check-ignore', '--no-index', '--stdin'], { cwd: Q, input: [...man, '.claude/launch.json'].join('\n'), encoding: 'utf8' });
  const ignored = new Set((r.stdout || '').split('\n').filter(Boolean));
  const notIgnored = [...man, '.claude/launch.json'].filter(f => !ignored.has(f));
  if (notIgnored.length) return `не игнорируются: ${notIgnored.slice(0, 5).join(', ')}`;
  const keep = ['texts/001-smoke/rules/decisions.md', 'texts/001-smoke/config/project.json', 'texts/001-smoke/meta.json', 'texts/001-smoke/overrides/rules/lint.json'];
  const k = spawnSync('git', ['check-ignore', '--no-index', '--stdin'], { cwd: Q, input: keep.join('\n'), encoding: 'utf8' });
  return !(k.stdout || '').trim() || `игнорируются данные: ${k.stdout.trim()}`;
});
step('kit в .claude/skills/site-tekst/kit не игнорируется (иначе синк его не закоммитит)', () => {
  const all = walk(KIT).map(f => `.claude/skills/site-tekst/kit/${f}`);
  const r = spawnSync('git', ['check-ignore', '--no-index', '--stdin'], { cwd: ROOT, input: all.join('\n'), encoding: 'utf8' });
  return !(r.stdout || '').trim() || `игнорируются: ${r.stdout.trim().split('\n').slice(0, 5).join(', ')}`;
});
step('шаблоны .gitignore покрывают KIT_DIRS и KIT_FILES task.mjs', () => {
  const gi = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
  const need = [...KIT_DIRS.filter(d => d !== 'rules').map(d => `texts/*/${d}/`), ...KIT_FILES.map(f => `texts/*/${f}`), 'texts/*/rules/*', '!texts/*/rules/decisions.md', 'texts/*/.kit.json'];
  const miss = need.filter(l => !gi.split(/\r?\n/).includes(l));
  return !miss.length || `нет строк: ${miss.join(', ')}`;
});

// ================================================================ 5. FAQ
section('5. read-faq-input --from-tekst: v9 и v7');
step('v9: страницы из sitemap + page.md, url от site_url, запросы из source_queries', () => {
  wj(path.join(Q, 'faq', '001-smoke', 'inputs.json'), { slug: 'smoke-faq', region_yandex: 15 });
  const r = node(Q, ['.claude/scripts/read-faq-input.mjs', 'faq/001-smoke', '--from-tekst', '1']);
  if (r.code !== 0) return `код ${r.code}: ${r.out}`;
  const pj = rj(path.join(Q, 'faq', '001-smoke', 'pages.json'));
  const home = pj.pages.find(p => p.slug === 'home');
  if (pj.count !== 2 || !home) return `страниц ${pj.count}`;
  if (home.url !== 'https://okna-test.example/' || home.marker !== 'пластиковые окна тула' || home.queries.length !== 1) return JSON.stringify({ url: home.url, marker: home.marker });
  if (!/Окна, из которых не дует/.test(home.text) || /_факты|## B0|Тип: home|блок еще не написан|\[картинка/.test(home.text)) return `текст: ${home.text.slice(0, 200)}`;
  return fs.existsSync(path.join(Q, 'faq', '001-smoke', 'pages', 'okna-rehau')) || 'нет pages/okna-rehau/';
});
step('v9: факты, бренд, регион, запреты - в pages.json.tekst и в inputs.json без перетирания', () => {
  const pj = rj(path.join(Q, 'faq', '001-smoke', 'pages.json'));
  const inp = rj(path.join(Q, 'faq', '001-smoke', 'inputs.json'));
  const t = pj.tekst || {};
  if (t.format !== 'v9' || t.facts_path !== 'texts/001-smoke/work/facts.json' || !fs.existsSync(path.join(Q, t.facts_path))) return JSON.stringify(t);
  if (inp.slug !== 'smoke-faq' || inp.region_yandex !== 15) return 'перетерто заданное оркестратором';
  return (inp.brand_name === 'Веста Окна' && inp.region_name === 'Тула' && inp.forbidden_wordings.includes('пена') && inp.anti_promises.length === 1 && inp.stop_domains[0] === 'avito.ru' && inp.facts_path === t.facts_path) || JSON.stringify(inp);
});
step('v7: --from-tekst NNN и путем - как раньше (page.json + pages.json)', () => {
  const a = node(P, ['.claude/scripts/read-faq-input.mjs', 'faq/007-a', '--from-tekst', '7']);
  const b = node(P, ['.claude/scripts/read-faq-input.mjs', 'faq/007-b', '--from-tekst', 'texts/007-old']);
  if (a.code !== 0 || b.code !== 0) return `${a.out} | ${b.out}`;
  const pa = rj(path.join(P, 'faq', '007-a', 'pages.json')), pb = rj(path.join(P, 'faq', '007-b', 'pages.json'));
  const p = pa.pages[0];
  return (!pa.tekst && pa.count === 1 && p.slug === 'glavnaya' && p.queries.length === 2 && /Монтаж за один день/.test(p.text) && canon(pa.pages) === canon(pb.pages) && !fs.existsSync(path.join(P, 'faq', '007-a', 'inputs.json'))) || JSON.stringify(pa).slice(0, 300);
});

// ================================================================ 6. worktree
section('6. цикл worktree: папка задачи, current-task.txt, pre-commit');
const W = mkClient('repo');
const WT = path.join(SANDBOX, 'repo-wt');
// Хуки исполняет сам git (своим sh), поэтому шаги с коммитом к bash не привязаны; bash нужен только update-meta.sh.
step('репо с машинерией, core.hooksPath, git worktree add', () => {
  if (!HAS_GIT) return 'SKIP: нет git';
  gitInit(W);
  git(W, ['config', 'core.hooksPath', '.claude/git-hooks']);
  git(W, ['add', '-A']);
  const c = git(W, ['commit', '-q', '-m', 'машинерия']);
  if (c.code !== 0) return c.out;
  const r = git(W, ['worktree', 'add', '-q', '-b', 'tekst-task', WT]);
  return (r.code === 0 && fs.existsSync(path.join(WT, '.claude', 'skills', 'site-tekst', 'task.mjs'))) || r.out;
});
step('в worktree: current-task.txt, init', () => {
  if (!fs.existsSync(WT)) return 'SKIP: нет worktree';
  fs.mkdirSync(path.join(WT, '.claude', 'tmp'), { recursive: true });
  declare(WT, 'texts/001-smoke');
  const i = task(WT, 'init', '--task', 'texts/001-smoke', '--doc', 'TESTDOC', '--slug', 'smoke');
  return (i.code === 0 && !/не записана/.test(i.stderr)) || `init: ${i.out}`;
});
step('в worktree: update-meta.sh (bash из PATH или рядом с git)', () => {
  if (!fs.existsSync(WT)) return 'SKIP: нет worktree';
  if (!BASH) return 'SKIP: bash не найден ни в PATH, ни рядом с git';
  const u = sh(BASH, ['.claude/hooks/update-meta.sh', 'texts/001-smoke', 'init'], WT);
  if (u.code !== 0) return `update-meta: ${u.out}`;
  const m = rj(path.join(WT, 'texts', '001-smoke', 'meta.json'));
  return (m.state === 'init' && m.format === 'v9') || JSON.stringify(m);
});
step('в worktree: коммит данных задачи проходит pre-commit, копии kit в коммите нет', () => {
  if (!fs.existsSync(WT)) return 'SKIP: нет worktree';
  git(WT, ['add', '-A']);
  const c = git(WT, ['commit', '-q', '-m', 'Tekst 001 for smoke: init']);
  if (c.code !== 0) return `pre-commit отказал: ${c.out.slice(0, 400)}`;
  const files = git(WT, ['show', '--name-only', '--format=', 'HEAD']).stdout.split('\n').filter(Boolean);
  const outside = files.filter(f => !f.startsWith('texts/001-smoke/'));
  const kit = files.filter(f => /^texts\/001-smoke\/(scripts|prompts|schemas|workflows|html)\/|CLAUDE\.md$|house_style|\.kit\.json|rules\/(?!decisions\.md)/.test(f));
  if (outside.length || kit.length) return `вне задачи: ${outside.join(', ')}; копия kit: ${kit.slice(0, 5).join(', ')}`;
  return (files.includes('texts/001-smoke/meta.json') && files.includes('texts/001-smoke/config/project.json') && files.includes('texts/001-smoke/rules/decisions.md')) || `в коммите: ${files.join(', ')}`;
});
step('в worktree: правка .claude/ - pre-commit отказывает', () => {
  if (!fs.existsSync(WT)) return 'SKIP: нет worktree';
  fs.appendFileSync(path.join(WT, '.claude', 'skills', 'site-tekst', 'SKILL.md'), '\n');
  git(WT, ['add', '-A']);
  const c = git(WT, ['commit', '-q', '-m', 'чужое']);
  git(WT, ['reset', '-q', 'HEAD', '--', '.claude/skills/site-tekst/SKILL.md']);
  git(WT, ['checkout', '-q', '--', '.claude/skills/site-tekst/SKILL.md']);
  return (c.code !== 0 && /запрещено/.test(c.out)) || `код ${c.code}: ${c.out.slice(0, 300)}`;
});
step('в worktree: current-task.txt с BOM и CRLF (PowerShell) - pre-commit принимает файлы задачи, init тоже', () => {
  if (!fs.existsSync(WT)) return 'SKIP: нет worktree';
  fs.writeFileSync(path.join(WT, '.claude', 'tmp', 'current-task.txt'), '﻿texts/001-smoke/\r\n');
  fs.appendFileSync(path.join(WT, 'texts', '001-smoke', 'rules', 'decisions.md'), '\nрешение с BOM\n');
  git(WT, ['add', '-A']);
  const c = git(WT, ['commit', '-q', '-m', 'Tekst 001 for smoke: bom']);
  if (c.code !== 0) return `pre-commit отказал: ${c.out.slice(0, 300)}`;
  // init видит ту же строку объявленной (без предупреждения «не записана»)
  fs.writeFileSync(path.join(WT, '.claude', 'tmp', 'current-task.txt'), '﻿texts/002-bom/\r\n');
  const i = task(WT, 'init', '--task', 'texts/002-bom', '--doc', 'TESTDOC', '--slug', 'bom');
  fs.rmSync(path.join(WT, 'texts', '002-bom'), { recursive: true, force: true });
  return (i.code === 0 && !/не записана/.test(i.stderr)) || `init: ${i.out}`;
});
step('в worktree: без current-task.txt коммит отказан', () => {
  if (!fs.existsSync(WT)) return 'SKIP: нет worktree';
  fs.rmSync(path.join(WT, '.claude', 'tmp', 'current-task.txt'));
  fs.appendFileSync(path.join(WT, 'texts', '001-smoke', 'rules', 'decisions.md'), '\nx\n');
  git(WT, ['add', '-A']);
  const c = git(WT, ['commit', '-q', '-m', 'без задачи']);
  return (c.code !== 0 && /не объявила текущую задачу/.test(c.out)) || `код ${c.code}: ${c.out.slice(0, 300)}`;
});

// ================================================================ 7. синк
section('7. синк: kit уезжает в клиента без правки SYNC_DIRS');
step('sync-from-template --apply в пустой клиент: kit, task.mjs, SKILL.md, тесты - в коммите', () => {
  const C = path.join(SANDBOX, 'sync-client');
  wt(path.join(C, '.claude', 'CLAUDE.md'), 'client\n');
  wt(path.join(C, 'README.md'), 'client\n');
  gitInit(C);
  git(C, ['add', '-A']); git(C, ['commit', '-q', '-m', 'init']);
  const r = node(ROOT, [path.join(ROOT, '.claude', 'scripts', 'sync-from-template.mjs'), '--template', ROOT, '--target', C, '--apply', '--no-migrations', '--json']);
  const j = json(r.stdout);
  if (!j || j.status !== 'applied') return `статус ${j && j.status}: ${(j && j.error) || r.out.slice(0, 300)}`;
  const kitAll = walk(KIT).map(f => `site-tekst/kit/${f}`);
  const added = new Set(j.dirs.skills.added);
  const miss = [...kitAll, 'site-tekst/task.mjs', 'site-tekst/SKILL.md'].filter(f => !added.has(f));
  if (miss.length) return `нет в added: ${miss.slice(0, 5).join(', ')}`;
  if (!j.dirs.tests.added.includes('site-tekst/run.mjs')) return 'тесты site-tekst не синкаются';
  const tracked = git(C, ['ls-files', '.claude/skills/site-tekst/kit']).stdout.split('\n').filter(Boolean).length;
  return (tracked === kitAll.length) || `в коммите клиента kit-файлов ${tracked} из ${kitAll.length}`;
});

// ================================================================ итог
console.log('');
console.log(`=== ${passed}/${passed + failed} passed${skipped ? `, ${skipped} skipped` : ''} ===`);
if (failed) {
  console.log('\nFailed:');
  for (const f of failures) console.log(`  - ${f}`);
}
if (fs.existsSync(WT)) git(W, ['worktree', 'remove', '--force', WT]);
if (KEEP) console.log(`песочница оставлена: ${SANDBOX}`);
else fs.rmSync(SANDBOX, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
