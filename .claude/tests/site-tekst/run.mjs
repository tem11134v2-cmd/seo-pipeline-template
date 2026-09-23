#!/usr/bin/env node
// run.mjs - набор /site-tekst (алгоритм текстов v9, kit в .claude/skills/site-tekst/kit).
//
// Использование:
//   .claude\scripts\_node.cmd .claude\tests\site-tekst\run.mjs
//   SITE_TEKST_TEST_KEEP=1 - не удалять песочницу (разбор упавшего шага руками)
//
// Состав:
//   1. kit: lint-cases.mjs (линтер) и scripts-cases.mjs (скрипты) рядом - против kit, код 0.
//   2. Папка задачи: task.mjs plan/init/place - номер max+1 по всем texts/* (v7 тоже), ссылки meta.json, пути sources
//      от папки задачи, копия kit по манифесту, правка на месте -> код 3, overrides/ поверх kit, --force, запрет
//      overrides на данные, пересчет sources после импорта (абсолютные пути чужой worktree).
//   3. Холостой прогон: клиентский проект во временной папке, texts/001-smoke/ + копия kit скриптом + дымовые фикстуры
//      + цепочка скриптов из kit/examples/smoke-fixtures/README.md с ожидаемыми итогами; args воркфлоу, status, preview.
//   4. .gitignore: копия kit в папке задачи игнорируется, данные задачи и сам kit в .claude/skills - нет.
//   5. read-faq-input --from-tekst: задача v9 (sitemap + page.md, факты, бренд, регион, запреты в inputs.json) и v7 как раньше.
//   6. Цикл worktree: git worktree add, папка задачи, current-task.txt, коммит данных через pre-commit
//      (core.hooksPath .claude/git-hooks), копии kit в коммите нет; чужой файл и коммит без current-task - отказ.
//   7. Синк: движок sync-from-template.mjs шаблона раскатывает kit в пустой клиент без правки SYNC_DIRS, kit коммитится.
// Шаги, которым нужен bash (update-meta.sh, pre-commit), без bash помечаются SKIP и набор не валят.
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
function step(name, fn) {
  try {
    const r = fn();
    if (r === true || r === undefined) { console.log(`  [test] ${name} ... PASS`); passed++; }
    else if (typeof r === 'string' && r.startsWith('SKIP')) { console.log(`  [test] ${name} ... SKIP (${r.slice(4).replace(/^:\s*/, '')})`); skipped++; }
    else { console.log(`  [test] ${name} ... FAIL (${r})`); failed++; failures.push(`${name}: ${r}`); }
  } catch (e) {
    console.log(`  [test] ${name} ... FAIL (${e.message})`); failed++; failures.push(`${name}: ${e.message}`);
  }
}
const section = t => console.log(`\n=== ${t} ===`);

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
const HAS_BASH = !sh('bash', ['-c', 'exit 0'], ROOT).error;
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
  fs.mkdirSync(path.join(dir, '.claude', 'tmp'), { recursive: true });
  return dir;
}
const declare = (dir, rel) => wt(path.join(dir, '.claude', 'tmp', 'current-task.txt'), `${rel}/\n`);

const { kitFiles, KIT_DIRS, KIT_FILES } = await import(new URL('../../skills/site-tekst/task.mjs', import.meta.url));

console.log('=== site-tekst (kit v9, папка задачи, холостой прогон, .gitignore, FAQ, worktree, синк) ===');
console.log(`Песочница: ${SANDBOX}`);

// ================================================================ 1. kit
section('1. kit: lint-cases и scripts-cases');
for (const f of ['lint-cases.mjs', 'scripts-cases.mjs']) {
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
wj(path.join(P, 'sites', '002-okna', 'project.json'), {});
wj(path.join(P, 'sites', '002-okna', 'queue.json'), { gate: { approved: true, by: 'test' } });
wj(path.join(P, 'sites', '002-okna', 'structure_data.json'), { pages: [] });
wj(path.join(P, 'sites', '003-nogate', 'project.json'), {});
wj(path.join(P, 'sites', '003-nogate', 'queue.json'), { gate: { approved: false } });
wj(path.join(P, 'structures', '005-okna', 'structure_data.json'), { pages: [] });
// задача v7 (формат выведенного конвейера текстов v7): для номера и для совместимости FAQ
wj(path.join(P, 'texts', '007-old', 'meta.json'), { format: 'v7', state: 'completed' });
wj(path.join(P, 'texts', '007-old', 'pages.json'), { pages: [{ slug: 'glavnaya', marker: 'окна тула', queries: ['окна тула', 'пластиковые окна'], url: 'https://old.example/' }] });
wj(path.join(P, 'texts', '007-old', 'pages', 'glavnaya', 'page.json'), { page: { slug: 'glavnaya', url: 'https://old.example/' }, h1: 'Окна в Туле', blocks: [{ title: 'Монтаж', text: 'Монтаж за один день' }] });

step('plan --site 2: номер 008 (max+1 и по v7), структура анализа, гейт согласован', () => {
  const r = task(P, 'plan', '--site', '2'); const j = json(r.stdout);
  if (r.code !== 0 || !j) return `код ${r.code}: ${r.out}`;
  return (j.task_dir === 'texts/008-okna' && j.structure === 'sites/002-okna/structure_data.json' && j.source === 'project' && j.gate_approved === true) || JSON.stringify(j);
});
step('plan --structure 5: структура SEO вместо структуры анализа', () => {
  const j = json(task(P, 'plan', '--site', '2', '--structure', '5').stdout);
  return (j && j.structure === 'structures/005-okna') || JSON.stringify(j);
});
step('plan: гейт анализа не согласован - виден в gate_approved', () => {
  const j = json(task(P, 'plan', '--site', '3').stdout);
  return (j && j.gate_approved === false && j.structure === '') || JSON.stringify(j);
});
step('plan: нет анализа / нет входа / --doc без slug - код 2', () => {
  const codes = [task(P, 'plan', '--site', '9').code, task(P, 'plan').code, task(P, 'plan', '--doc', 'X').code, task(P, 'plan', '--site', '2', '--structure', '6').code];
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
  const bad = want.filter(f => sha(path.join(T8, f)) !== sha(path.join(KIT, f)));
  if (bad.length) return `не совпали с kit: ${bad.slice(0, 3).join(', ')}`;
  const args = json((r.stdout.match(/^args: (.*)$/m) || [])[1]);
  return (args && path.resolve(args.root) === path.resolve(T8) && args.model === 'opus' && args.model_light === 'sonnet') || `args ${JSON.stringify(args)}`;
});
step('init в занятую папку - отказ', () => task(P, 'init', '--task', 'texts/008-okna', '--site', '2').code === 1 || 'не отказал');
step('update-meta.sh: state поверх затравки init, format и ссылки на месте', () => {
  if (!HAS_BASH) return 'SKIP: нет bash';
  const r = sh('bash', ['.claude/hooks/update-meta.sh', 'texts/008-okna', 'init'], P);
  if (r.code !== 0) return `код ${r.code}: ${r.out}`;
  const m = rj(path.join(T8, 'meta.json'));
  return (m.state === 'init' && m.format === 'v9' && m.site === 'sites/002-okna' && (m.completed_steps || []).includes('init')) || JSON.stringify(m);
});
step('place повторно: ничего не копирует', () => {
  const r = task(P, 'place', '8');
  return (r.code === 0 && /скопировано 0,/.test(r.stdout)) || r.out;
});
step('правка копии kit на месте - код 3 со списком', () => {
  fs.appendFileSync(path.join(T8, 'rules', 'lint.json'), ' ');
  const r = task(P, 'place', '8');
  return (r.code === 3 && /rules\/lint\.json/.test(r.stderr) && /overrides/.test(r.stderr)) || `код ${r.code}: ${r.out}`;
});
step('overrides/ поверх kit: правка проекта переживает освежение', () => {
  fs.mkdirSync(path.join(T8, 'overrides', 'rules'), { recursive: true });
  fs.copyFileSync(path.join(T8, 'rules', 'lint.json'), path.join(T8, 'overrides', 'rules', 'lint.json'));
  const r = task(P, 'place', '8');
  if (r.code !== 0 || !/переопределений 1/.test(r.stdout)) return `код ${r.code}: ${r.out}`;
  const again = task(P, 'place', '8');
  return (again.code === 0 && sha(path.join(T8, 'rules', 'lint.json')) === sha(path.join(T8, 'overrides', 'rules', 'lint.json'))) || again.out;
});
step('override снят - файл снова из kit', () => {
  fs.rmSync(path.join(T8, 'overrides'), { recursive: true });
  const r = task(P, 'place', '8');
  return (r.code === 0 && sha(path.join(T8, 'rules', 'lint.json')) === sha(path.join(KIT, 'rules', 'lint.json'))) || r.out;
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
  return (r.code === 0 && /переопределений 1/.test(r.stdout) && sha(path.join(S, 'rules', 'offer-formulas.json')) === sha(path.join(FIX, 'rules', 'offer-formulas.json'))) || r.out;
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
step('plan-run: home - tournament, okna-rehau - single', () => {
  const j = json(K('scripts/plan-run.mjs').stdout);
  const m = j && Object.fromEntries(j.pages.map(p => [p.slug, p.hero_mode]));
  return (m && m.home === 'tournament' && m['okna-rehau'] === 'single') || JSON.stringify(m);
});
step('retro-stats последним: файлов 8, находок 20', () => {
  const r = K('scripts/retro-stats.mjs');
  return (r.code === 0 && /файлов 8/.test(r.out) && /находок 20/.test(r.out)) || r.out.slice(0, 300);
});
step('args write: 2 страницы, concurrency 4; --slugs home: 1 страница, concurrency 1', () => {
  const all = json(task(Q, 'args', '1', 'write').stdout), one = json(task(Q, 'args', '1', 'write', '--slugs', 'home').stdout);
  if (!all || all.pages.length !== 2 || all.concurrency !== 4 || !all.pages[0].pending_blocks) return JSON.stringify(all).slice(0, 300);
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
step('status: волна 1, предложение пилота, прототип', () => {
  const r = task(Q, 'status', '1');
  return (r.code === 0 && /волна 1: 2 стр\., брифов 2/.test(r.stdout) && /пилот \(предложение\): home,okna-rehau/.test(r.stdout) && /прототип: texts\/001-smoke\/work\/output\/prototype\.html/.test(r.stdout) && r.stdout.split('\n').length <= 15) || r.out;
});
step('status: решение d9 (состав страниц) из отчета импорта - на гейте 1', () => {
  const rep = path.join(S, 'work', 'import-report.json');
  const had = fs.existsSync(rep) ? fs.readFileSync(rep) : null;
  wj(rep, { gate: { approved: true, decisions: { d9: { name: 'состав страниц', value: '2 страниц в работе, снято 1; источник - состав анализа (pages-planner)', how: 'молчание заказчика, принят рекомендованный дефолт (j1)' } } }, warnings: [], empty: [], anti: { pending: [] } });
  const r = task(Q, 'status', '1');
  if (had) fs.writeFileSync(rep, had); else fs.rmSync(rep);
  return (r.code === 0 && /состав страниц \(d9\): 2 страниц в работе, снято 1; источник - состав анализа \(pages-planner\); молчание заказчика/.test(r.stdout) && r.stdout.split('\n').length <= 15) || r.out;
});
step('preview: конфиг site-tekst-001 с serve.mjs задачи в .claude/launch.json', () => {
  const r = task(Q, 'preview', '1'); const j = json(r.stdout);
  const lj = rj(path.join(Q, '.claude', 'launch.json'));
  const c = lj.configurations.find(x => x.name === 'site-tekst-001');
  return (j && j.port === 4611 && c && /texts\/001-smoke\/scripts\/serve\.mjs$/.test(c.runtimeArgs[0]) && c.port === 4611) || `${r.out} ${JSON.stringify(c)}`;
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
step('репо с машинерией, core.hooksPath, git worktree add', () => {
  if (!HAS_BASH) return 'SKIP: нет bash (хуки git и update-meta.sh)';
  gitInit(W);
  git(W, ['config', 'core.hooksPath', '.claude/git-hooks']);
  git(W, ['add', '-A']);
  const c = git(W, ['commit', '-q', '-m', 'машинерия']);
  if (c.code !== 0) return c.out;
  const r = git(W, ['worktree', 'add', '-q', '-b', 'tekst-task', WT]);
  return (r.code === 0 && fs.existsSync(path.join(WT, '.claude', 'skills', 'site-tekst', 'task.mjs'))) || r.out;
});
step('в worktree: current-task.txt, init, update-meta, коммит данных проходит pre-commit', () => {
  if (!HAS_BASH || !fs.existsSync(WT)) return 'SKIP: нет worktree';
  fs.mkdirSync(path.join(WT, '.claude', 'tmp'), { recursive: true });
  declare(WT, 'texts/001-smoke');
  const i = task(WT, 'init', '--task', 'texts/001-smoke', '--doc', 'TESTDOC', '--slug', 'smoke');
  if (i.code !== 0 || /не записана/.test(i.stderr)) return `init: ${i.out}`;
  const u = sh('bash', ['.claude/hooks/update-meta.sh', 'texts/001-smoke', 'init'], WT);
  if (u.code !== 0) return `update-meta: ${u.out}`;
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
  if (!HAS_BASH || !fs.existsSync(WT)) return 'SKIP: нет worktree';
  fs.appendFileSync(path.join(WT, '.claude', 'skills', 'site-tekst', 'SKILL.md'), '\n');
  git(WT, ['add', '-A']);
  const c = git(WT, ['commit', '-q', '-m', 'чужое']);
  git(WT, ['reset', '-q', 'HEAD', '--', '.claude/skills/site-tekst/SKILL.md']);
  git(WT, ['checkout', '-q', '--', '.claude/skills/site-tekst/SKILL.md']);
  return (c.code !== 0 && /запрещено/.test(c.out)) || `код ${c.code}: ${c.out.slice(0, 300)}`;
});
step('в worktree: без current-task.txt коммит отказан', () => {
  if (!HAS_BASH || !fs.existsSync(WT)) return 'SKIP: нет worktree';
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
