#!/usr/bin/env node
// task.mjs - механика папки задачи /site-tekst (формат v9): номер и slug, копия kit в texts/NNN-<slug>/,
// args воркфлоу kit, короткая сводка, превью прототипа. Без LLM. Запуск из корня проекта (там, где texts/, sites/).
//
//   node .claude/skills/site-tekst/task.mjs plan    (--site <NNN> | --doc <id>) [--structure <MMM> | --structure-file <путь>] [--slug <slug>]
//   node .claude/skills/site-tekst/task.mjs init    --task texts/NNN-<slug> <те же флаги> [--allow-ungated]
//   node .claude/skills/site-tekst/task.mjs place   <task_dir> [--force]
//   node .claude/skills/site-tekst/task.mjs find    [<NNN>]
//   node .claude/skills/site-tekst/task.mjs args    <task_dir> facts|types|write|audit|fix|hero|catalog [флаги вида] [--extra '<json>']
//   node .claude/skills/site-tekst/task.mjs status  <task_dir>
//   node .claude/skills/site-tekst/task.mjs preview <task_dir>
//
// plan  - ничего не пишет; stdout: JSON {task_dir, nnn, slug, site, structure, source, doc_id, gate_approved}.
// init  - папка задачи: meta.json (format v9, ссылки; state ставит update-meta.sh), config/project.json, rules/decisions.md,
//         inputs/, work/, затем place. Последняя строка stdout: «args: {...}» - база args воркфлоу.
// place - копия kit в папку задачи (кеш, в .gitignore): KIT_DIRS и KIT_FILES ниже, поверх - overrides/ задачи (в git).
//         Правка скопированного файла kit на месте (хеш не совпал с .kit.json) - код 3 и список: правка проекта
//         переносится в overrides/<путь>, правка алгоритма - в kit шаблона; --force затирает.
//         Заодно пути sources в config/project.json пересчитываются от ссылок meta.json (относительно папки задачи).
// args  - stdout: одна строка JSON для args воркфлоу (root, model, model_light + данные вида). Код 4 - делать нечего.
//   facts   wf-00-facts.js     source и structureMode по конфигу, allowUngated из meta
//   types   wf-02/03/04        вывод prep-args + catalog (niche.business_type не services)
//   write   wf-05-write.js     plan-run --phase write [--wave N | --slugs a,b] [--hero ...]; concurrency 1 при --slugs, иначе 4
//   audit   wf-06-audit.js     plan-run --phase audit, только страницы без round-N.json (--all - все), sample пересчитан
//   fix     wf-06b-fix-repeats --slug s --findings f1,f2 [--judge]; без --judge skipJudge: true
//   hero    wf-05b-hero-tournament --slug s [--block B01-hero]: турнир первого экрана на готовой странице
//   catalog wf-07-catalog.js   publish: true (--no-publish - false)
// Коды выхода: 0 - ок; 1 - ошибка; 2 - нет входа (анализа, структуры, задачи); 3 - правки в копии kit; 4 - делать нечего.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const KIT = path.join(HERE, 'kit');
// Что из kit кладется в папку задачи. Все это - кеш: в .gitignore шаблона, освежается при старте и --resume.
export const KIT_DIRS = ['workflows', 'prompts', 'scripts', 'schemas', 'html', 'rules'];
export const KIT_FILES = ['CLAUDE.md', 'config/house_style.md'];
// Лежит в папке kit-правил, но это решение проекта (данные задачи, в git).
export const KEEP = new Set(['rules/decisions.md']);
export const MANIFEST = '.kit.json';
export const OVERRIDES = 'overrides';
export const DATA_DIRS = ['inputs', 'work/competitors/raw', 'work/page-types', 'work/layouts', 'work/pages', 'work/audit', 'work/catalog', 'work/output'];
// Модели агентов воркфлоу: сильная роль - opus, легкая - sonnet, раскладка ролей и args.models (docs/RUNBOOK.md kit, «Обязательные args»).
export const MODELS = { model: 'opus', model_light: 'sonnet' };

const ROOT = process.cwd();
const posix = p => p.split(path.sep).join('/');
const exists = p => fs.existsSync(p);
const readJson = p => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^﻿/, ''));
const readJsonSafe = p => { try { return readJson(p); } catch { return null; } };
const writeJson = (p, o) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(o, null, 2) + '\n'); };
const sha = p => crypto.createHash('sha1').update(fs.readFileSync(p)).digest('hex');
const pad3 = n => String(n).padStart(3, '0');
function die(code, msg) { console.error(`[site-tekst] ${msg}`); process.exit(code); }

function argv(list) {
  const o = { _: [] };
  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    if (!t.startsWith('--')) { o._.push(t); continue; }
    const k = t.slice(2);
    const v = list[i + 1];
    if (v === undefined || v.startsWith('--')) o[k] = true; else { o[k] = v; i++; }
  }
  return o;
}

export function walk(dir) {
  const out = [];
  if (!exists(dir)) return out;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    for (const e of fs.readdirSync(cur, { withFileTypes: true })) {
      const p = path.join(cur, e.name);
      if (e.isDirectory()) stack.push(p); else if (e.isFile()) out.push(posix(path.relative(dir, p)));
    }
  }
  return out.sort();
}

export const isKitPath = rel => !KEEP.has(rel) && (KIT_FILES.includes(rel) || KIT_DIRS.some(d => rel.startsWith(d + '/')));
// Файлы kit, которые кладутся в папку задачи (пути от корня kit и от корня задачи совпадают).
export function kitFiles() {
  const out = [];
  for (const d of KIT_DIRS) for (const r of walk(path.join(KIT, d))) out.push(`${d}/${r}`);
  for (const f of KIT_FILES) if (exists(path.join(KIT, f))) out.push(f);
  return out.filter(isKitPath).sort();
}

// ---------------------------------------------------------------- номера и ссылки
function numberedDirs(base) {
  const dir = path.join(ROOT, base);
  if (!exists(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(e => e.isDirectory() && /^\d+-/.test(e.name))
    .map(e => ({ name: e.name, n: Number(e.name.match(/^(\d+)-/)[1]) }));
}
export function nextNumber() {
  return pad3(numberedDirs('texts').reduce((m, d) => Math.max(m, d.n), 0) + 1);
}
// <NNN> (с нулями или без) или путь к папке -> путь от корня проекта; '' - не найдено.
function findNumbered(base, ref) {
  const s = String(ref);
  if (!/^\d+$/.test(s)) {
    const abs = path.resolve(ROOT, s);
    return exists(abs) && fs.statSync(abs).isDirectory() ? posix(path.relative(ROOT, abs)) : '';
  }
  const hits = numberedDirs(base).filter(d => d.n === Number(s));
  if (hits.length > 1) die(2, `${base}/${pad3(s)}-* - папок несколько (${hits.map(h => h.name).join(', ')}): укажи путь`);
  return hits.length ? `${base}/${hits[0].name}` : '';
}
const slugOf = rel => { const m = path.basename(rel || '').match(/^\d+-(.+)$/); return m ? m[1] : ''; };
export const structureFile = s => (!s ? '' : s.endsWith('.json') ? s : `${s}/structure_data.json`);
const fromTask = (task, repoRel) => posix(path.relative(task, path.resolve(ROOT, repoRel)));

export function plan(a) {
  if (!a.site && !a.doc) die(2, 'нужен --site <NNN> (контракт анализа) или --doc <google doc id> (анализ в Google Doc)');
  const site = a.site ? findNumbered('sites', a.site) : '';
  if (a.site && !site) die(2, `нет папки анализа sites/${/^\d+$/.test(String(a.site)) ? pad3(a.site) + '-*' : a.site}`);
  const source = a.doc ? 'doc' : 'project';
  if (source === 'project' && !exists(path.join(ROOT, site, 'project.json'))) die(2, `нет ${site}/project.json: анализ не собран (/site-analiz)`);
  let structure = '';
  if (a.structure) {
    structure = findNumbered('structures', a.structure);
    if (!structure) die(2, `нет папки структуры structures/${pad3(a.structure)}-*`);
    if (!exists(path.join(ROOT, structureFile(structure)))) die(2, `нет ${structureFile(structure)}: структура не собрана (/seo-struktura)`);
  } else if (a['structure-file']) {
    const abs = path.resolve(ROOT, a['structure-file']);
    if (!exists(abs)) die(2, `нет файла структуры ${a['structure-file']}`);
    structure = posix(path.relative(ROOT, abs));
  } else if (site && exists(path.join(ROOT, site, 'structure_data.json'))) structure = `${site}/structure_data.json`;
  const slug = (typeof a.slug === 'string' && a.slug) || slugOf(site) || slugOf(a.structure ? structure : '');
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug || '')) die(2, `slug «${slug || ''}»: нужен латиницей (a-z, 0-9, дефис) - задай --slug`);
  const nnn = nextNumber();
  const queue = site ? readJsonSafe(path.join(ROOT, site, 'queue.json')) : null;
  return {
    task_dir: `texts/${nnn}-${slug}`, nnn, slug, site, structure, source, doc_id: a.doc && a.doc !== true ? String(a.doc) : '',
    gate_approved: site ? !!(queue && queue.gate && queue.gate.approved === true) : null,
  };
}

// ---------------------------------------------------------------- копия kit
function rebaseSources(task, meta) {
  const cfgPath = path.join(task, 'config', 'project.json');
  if (!exists(cfgPath) || meta.source !== 'project' || !meta.site) return false;
  const cfg = readJson(cfgPath);
  const s = cfg.sources = cfg.sources || {};
  // Пути от папки задачи (import-project.mjs резолвит их от своей cwd), вычисляются из ссылок meta.json:
  // так они верны в любой worktree, а не только в той, где шел импорт (он пишет абсолютные).
  const want = { project_json: fromTask(task, `${meta.site}/project.json`), facts_src: '', queue: '', structure_input: meta.structure ? fromTask(task, structureFile(meta.structure)) : '' };
  let changed = false;
  for (const [k, v] of Object.entries(want)) if (s[k] !== v) { s[k] = v; changed = true; }
  if (s.mode !== 'project') { s.mode = 'project'; changed = true; }
  if (changed) writeJson(cfgPath, cfg);
  return changed;
}

export function place(task, { force = false } = {}) {
  if (!exists(path.join(KIT, 'scripts', 'lib.mjs'))) die(1, `kit не найден: ${KIT}`);
  const want = new Map();
  for (const rel of kitFiles()) want.set(rel, path.join(KIT, rel));
  const ovDir = path.join(task, OVERRIDES);
  const overrides = walk(ovDir);
  for (const rel of overrides) {
    if (!isKitPath(rel)) die(1, `${OVERRIDES}/${rel}: переопределяются только файлы kit (${[...KIT_DIRS.map(d => d + '/'), ...KIT_FILES].join(', ')}); данные задачи правятся на месте`);
    want.set(rel, path.join(ovDir, rel));
  }
  const old = (readJsonSafe(path.join(task, MANIFEST)) || {}).files || {};
  const present = [
    ...KIT_FILES.filter(f => exists(path.join(task, f))),
    ...KIT_DIRS.flatMap(d => walk(path.join(task, d)).map(r => `${d}/${r}`)),
  ].filter(isKitPath);
  // Правка на месте: файл отличается и от того, что положено в прошлый раз (.kit.json), и от того, что ляжет сейчас.
  const edited = present.filter(rel => {
    const h = sha(path.join(task, rel));
    if (want.has(rel) && h === sha(want.get(rel))) return false;
    return !(old[rel] && h === old[rel]);
  });
  if (edited.length && !force) {
    console.error(`[site-tekst] в копии kit ${posix(path.relative(ROOT, task))} правки на месте (${edited.length}), освежение их затрет:`);
    edited.slice(0, 30).forEach(r => console.error(`  - ${r}`));
    if (edited.length > 30) console.error(`  ... и еще ${edited.length - 30}`);
    console.error(`  правка проекта -> перенеси файл в ${OVERRIDES}/<тот же путь> (в git, ложится поверх kit при каждом старте);`);
    console.error('  правка алгоритма -> в .claude/skills/site-tekst/kit/ шаблона; затем повтори. --force - затереть правки.');
    process.exit(3);
  }
  let copied = 0, same = 0, removed = 0;
  for (const [rel, src] of want) {
    const dst = path.join(task, rel);
    if (exists(dst) && sha(dst) === sha(src)) { same++; continue; }
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
    copied++;
  }
  for (const rel of present) if (!want.has(rel)) { fs.rmSync(path.join(task, rel), { force: true }); removed++; }
  for (const d of DATA_DIRS) fs.mkdirSync(path.join(task, d), { recursive: true });
  const files = {};
  for (const rel of want.keys()) files[rel] = sha(path.join(task, rel));
  writeJson(path.join(task, MANIFEST), {
    _doc: 'Манифест копии kit /site-tekst (кеш, не в git): хеш каждого положенного файла. Файл с другим хешем - правка на месте, task.mjs place ее не затрет без --force.',
    placed_at: new Date().toISOString(), kit_files: want.size - overrides.length, overrides, files,
  });
  const meta = readJsonSafe(path.join(task, 'meta.json')) || {};
  const rebased = rebaseSources(task, meta);
  return { copied, same, removed, overrides: overrides.length, forced: force ? edited.length : 0, rebased };
}

// ---------------------------------------------------------------- задача
function taskDir(ref) {
  if (!ref) die(1, 'не задана папка задачи');
  const rel = /^\d+$/.test(String(ref)) ? findNumbered('texts', ref) : posix(path.relative(ROOT, path.resolve(ROOT, ref)));
  const abs = path.resolve(ROOT, rel || String(ref));
  if (!rel || !exists(path.join(abs, 'meta.json'))) die(2, `нет задачи ${ref} (texts/NNN-<slug>/meta.json)`);
  const meta = readJson(path.join(abs, 'meta.json'));
  if (meta.format !== 'v9') die(2, `${rel}: задача формата ${meta.format || 'без format'}, не v9 - это не /site-tekst`);
  return { abs, rel, meta };
}
const baseArgs = abs => ({ root: abs, ...MODELS });

function init(a) {
  const p = plan(a);
  const rel = typeof a.task === 'string' ? posix(a.task).replace(/\/+$/, '') : p.task_dir;
  if (!/^texts\/\d+-[a-z0-9][a-z0-9-]*$/.test(rel)) die(1, `--task: ожидается texts/NNN-<slug>, пришло ${rel}`);
  const task = path.resolve(ROOT, rel);
  if (exists(task) && fs.readdirSync(task).length) die(1, `${rel} уже есть: продолжение - --resume`);
  const cur = path.join(ROOT, '.claude', 'tmp', 'current-task.txt');
  const declared = exists(cur) && fs.readFileSync(cur, 'utf8').split(/\r?\n/).some(l => l.trim().replace(/\/+$/, '') === rel);
  if (!declared) console.error(`[site-tekst] внимание: ${rel} не записана в .claude/tmp/current-task.txt - в worktree pre-commit откажет`);
  fs.mkdirSync(task, { recursive: true });
  const meta = {
    format: 'v9', slug: p.slug, site: p.site, structure: p.structure, source: p.source,
    ...(p.doc_id ? { doc_id: p.doc_id } : {}), ...(a['allow-ungated'] ? { allow_ungated: true } : {}),
    started: new Date().toISOString(),
  };
  writeJson(path.join(task, 'meta.json'), meta);
  const cfg = readJson(path.join(KIT, 'config', 'project.json'));
  cfg.slug = p.slug;
  cfg.sources = { ...cfg.sources, mode: p.source };
  if (p.doc_id) cfg.sources.analysis_doc_id = p.doc_id;
  writeJson(path.join(task, 'config', 'project.json'), cfg);
  fs.mkdirSync(path.join(task, 'rules'), { recursive: true });
  fs.copyFileSync(path.join(KIT, 'rules', 'decisions.template.md'), path.join(task, 'rules', 'decisions.md'));
  // режим doc: структуру читает фаза 0 из inputs/structure_data.json (в режиме project копию делает импорт)
  if (p.source === 'doc' && p.structure) {
    fs.mkdirSync(path.join(task, 'inputs'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, structureFile(p.structure)), path.join(task, 'inputs', 'structure_data.json'));
  }
  const r = place(task);
  console.log(`задача: ${rel} (источник ${p.source}${p.site ? ', анализ ' + p.site : ''}${p.structure ? ', структура ' + p.structure : ', без структуры'})`);
  console.log(`kit: положено файлов ${r.copied}`);
  console.log(`args: ${JSON.stringify(baseArgs(task))}`);
}

function runKit(task, script, args) {
  const r = spawnSync(process.execPath, [`scripts/${script}`, ...args], { cwd: task, encoding: 'utf8' });
  if (r.status !== 0) die(1, `${script} ${args.join(' ')}: код ${r.status}\n${(r.stderr || r.stdout || '').slice(-1500)}`);
  try { return JSON.parse(r.stdout); } catch { die(1, `${script}: вывод не JSON: ${r.stdout.slice(0, 300)}`); }
}
function filters(a) {
  const f = [];
  for (const k of ['wave', 'slugs', 'types', 'hero', 'tournament-types', 'sample-per-type']) if (typeof a[k] === 'string') f.push(`--${k}`, a[k]);
  return f;
}

function args(a) {
  const { abs, meta } = taskDir(a._[1]);
  const kind = a._[2];
  const cfg = readJsonSafe(path.join(abs, 'config', 'project.json')) || {};
  const S = cfg.sources || {};
  let out;
  if (kind === 'facts') {
    const source = S.mode || 'doc';
    const hasStructure = source === 'project' ? !!S.structure_input : exists(path.join(abs, S.structure_source || 'inputs/structure_data.json'));
    out = { source, structureMode: hasStructure ? 'import' : 'fallback', ...(meta.allow_ungated ? { allowUngated: true } : {}) };
  } else if (kind === 'types') {
    out = { ...runKit(abs, 'prep-args.mjs', []), catalog: ((cfg.niche || {}).business_type || 'both') !== 'services' };
  } else if (kind === 'write') {
    const pr = runKit(abs, 'plan-run.mjs', ['--phase', 'write', ...filters(a)]);
    const pages = pr.pages.filter(p => p.briefed).map(p => ({ slug: p.slug, type: p.type, hero_mode: p.hero_mode, hero_block_id: p.hero_block_id, pending_blocks: p.pending_blocks, block_roles: p.block_roles }));
    const unbriefed = pr.pages.filter(p => !p.briefed).map(p => p.slug);
    if (unbriefed.length) console.error(`[site-tekst] без брифа (фаза 4 не дошла до них): ${unbriefed.slice(0, 20).join(', ')}${unbriefed.length > 20 ? ` и еще ${unbriefed.length - 20}` : ''}`);
    if (!pages.length) die(4, 'писать нечего: все страницы выборки дописаны');
    out = { pages, concurrency: Number(a.concurrency) || (a.slugs ? 1 : 4) };
  } else if (kind === 'audit') {
    const f = filters(a);
    let pr = runKit(abs, 'plan-run.mjs', ['--phase', 'audit', ...f]);
    if (!pr.pages.length) die(4, 'аудировать нечего: в выборке нет дописанных страниц');
    if (!a.all) {
      const fresh = pr.pages.filter(p => !p.audit_rounds).map(p => p.slug);
      if (!fresh.length) die(4, 'аудировать нечего: у дописанных страниц выборки уже есть round-N.json (--all - все заново)');
      if (fresh.length !== pr.pages.length) pr = runKit(abs, 'plan-run.mjs', ['--phase', 'audit', '--slugs', fresh.join(','), ...f.filter((x, i, arr) => x !== '--slugs' && arr[i - 1] !== '--slugs')]);
    }
    if (!pr.pages.length) die(4, 'аудировать нечего: нет дописанных страниц в выборке');
    out = { pages: pr.pages.map(p => ({ slug: p.slug, type: p.type })), sample: pr.sample || [] };
  } else if (kind === 'fix') {
    if (typeof a.slug !== 'string') die(1, 'fix: нужен --slug');
    const findings = typeof a.findings === 'string' ? a.findings.split(',').map(s => s.trim()).filter(Boolean) : [];
    for (const f of findings) if (!exists(path.join(abs, f))) die(2, `fix: нет файла находок ${f}`);
    out = { slug: a.slug, findings };
    if (a.judge) {
      const rounds = walk(path.join(abs, 'work', 'audit', a.slug)).map(f => (f.match(/^round-(\d+)\.json$/) || [])[1]).filter(Boolean).map(Number);
      out.round = Math.max(2, ...rounds) + 1;
    } else out.skipJudge = true;
  } else if (kind === 'hero') {
    if (typeof a.slug !== 'string') die(1, 'hero: нужен --slug');
    if (!exists(path.join(abs, 'work', 'pages', a.slug, 'brief.json'))) die(2, `hero: нет брифа work/pages/${a.slug}/brief.json`);
    out = { slug: a.slug, ...(typeof a.block === 'string' ? { block_id: a.block } : {}) };
  } else if (kind === 'catalog') {
    out = { publish: !a['no-publish'] };
  } else die(1, `args: вид ${kind || '(пусто)'} не из facts|types|write|audit|fix|hero|catalog`);
  let extra = {};
  if (typeof a.extra === 'string') { try { extra = JSON.parse(a.extra); } catch (e) { die(1, `--extra: не JSON (${e.message})`); } }
  console.log(JSON.stringify({ ...baseArgs(abs), ...out, ...extra }));
}

// ---------------------------------------------------------------- сводка
function pageProgress(abs, slug) {
  const dir = path.join(abs, 'work', 'pages', slug);
  const brief = readJsonSafe(path.join(dir, 'brief.json'));
  if (!brief) return { briefed: false, done: false, audited: false };
  const done = (brief.blocks || []).every(b => {
    const lint = readJsonSafe(path.join(abs, 'work', 'audit', slug, `lint-${b.block_id}.json`));
    return exists(path.join(dir, 'blocks', `${b.block_id}.json`)) && lint && lint.verdict === 'pass';
  });
  const audited = walk(path.join(abs, 'work', 'audit', slug)).some(f => /^round-\d+\.json$/.test(f));
  return { briefed: true, done, audited };
}
function status(a) {
  const { abs, rel, meta } = taskDir(a._[1]);
  const L = [`${rel}: state ${meta.state || 'init'}, источник ${meta.source}${meta.site ? ' ' + meta.site : ''}${meta.structure ? ', структура ' + meta.structure : ''}`];
  const rep = readJsonSafe(path.join(abs, 'work', 'import-report.json'));
  if (rep) L.push(`импорт: предупреждений ${(rep.warnings || []).length}, пустых полей ${(rep.empty || []).length}, антиобещаний без регулярки ${((rep.anti && rep.anti.pending) || []).length}`);
  const d9 = rep && rep.gate && rep.gate.decisions && rep.gate.decisions.d9;
  if (d9) L.push(`состав страниц (d9): ${d9.value}; ${d9.how}`);
  const facts = readJsonSafe(path.join(abs, 'work', 'facts.json'));
  if (facts) L.push(`факты: ${(facts.facts || []).length} (publish yes ${(facts.facts || []).filter(f => f.publish === 'yes').length}), пробелов ${(facts.gaps || []).length}`);
  const sm = readJsonSafe(path.join(abs, 'work', 'sitemap.json'));
  if (sm) {
    const pages = (sm.pages || []).filter(p => p.status !== 'skip');
    const byType = {};
    for (const p of pages) byType[p.type] = (byType[p.type] || 0) + 1;
    L.push(`карта: ${pages.length} стр. (skip ${(sm.pages || []).length - pages.length}); ${Object.entries(byType).map(([t, n]) => `${t} ${n}`).join(', ')}`);
    const waves = {};
    for (const p of pages) {
      const w = p.wave == null ? '-' : String(p.wave);
      const g = waves[w] = waves[w] || { n: 0, briefed: 0, done: 0, audited: 0 };
      const pr = pageProgress(abs, p.slug);
      g.n++; if (pr.briefed) g.briefed++; if (pr.done) g.done++; if (pr.audited) g.audited++;
    }
    for (const [w, g] of Object.entries(waves).sort()) L.push(`волна ${w}: ${g.n} стр., брифов ${g.briefed}, написано ${g.done}, аудит ${g.audited}`);
    const catalog = pages.some(p => p.type === 'category' || p.type === 'product');
    const bt = ((readJsonSafe(path.join(abs, 'config', 'project.json')) || {}).niche || {}).business_type || 'both';
    L.push(`каталог (фаза 7): ${catalog && bt !== 'services' ? 'да' : 'нет'}`);
  }
  if (meta.pilot) L.push(`пилот: ${meta.pilot}`);
  else if (sm) {
    // предложение пилота по RUNBOOK kit: главная + одна категория (нет категории - услуга или раздел)
    const live = (sm.pages || []).filter(p => p.status !== 'skip');
    const pick = t => (live.find(p => p.type === t) || {}).slug;
    const offer = [pick('home'), pick('category') || pick('service') || pick('hub')].filter(Boolean);
    if (offer.length) L.push(`пилот (предложение): ${offer.join(',')}`);
  }
  const proto = path.join(abs, 'work', 'output', 'prototype.html');
  L.push(`прототип: ${exists(proto) ? posix(path.relative(ROOT, proto)) : 'не собран'}`);
  console.log(L.join('\n'));
}

// ---------------------------------------------------------------- превью (serve.mjs kit в панели браузера)
function preview(a) {
  const { abs, rel } = taskDir(a._[1]);
  const out = path.join(abs, 'work', 'output');
  if (!exists(path.join(out, 'prototype.html'))) die(2, `нет ${rel}/work/output/prototype.html: сначала сборка (build-html.mjs)`);
  const nnn = Number((path.basename(abs).match(/^(\d+)-/) || [])[1] || 0);
  const port = 4610 + (nnn % 100);
  const name = `site-tekst-${pad3(nnn)}`;
  const lj = path.join(ROOT, '.claude', 'launch.json');
  const conf = readJsonSafe(lj) || { version: '0.0.1', configurations: [] };
  conf.configurations = (conf.configurations || []).filter(c => c.name !== name);
  conf.configurations.push({ name, runtimeExecutable: 'node', runtimeArgs: [posix(path.join(abs, 'scripts', 'serve.mjs')), '--dir', posix(out), '--port', String(port)], port });
  writeJson(lj, conf);
  console.log(JSON.stringify({ name, port, url: `http://localhost:${port}/prototype.html` }));
}

function find(a) {
  if (a._[1]) { const { rel, meta } = taskDir(a._[1]); console.log(`${rel} ${meta.state || 'init'}`); return; }
  const rows = numberedDirs('texts').sort((x, y) => x.n - y.n).map(d => ({ rel: `texts/${d.name}`, meta: readJsonSafe(path.join(ROOT, 'texts', d.name, 'meta.json')) }))
    .filter(r => r.meta && r.meta.format === 'v9' && r.meta.state !== 'completed');
  if (!rows.length) die(2, 'незавершенных задач v9 нет');
  for (const r of rows) console.log(`${r.rel} ${r.meta.state || 'init'}`);
}

// ---------------------------------------------------------------- CLI
function main() {
  const a = argv(process.argv.slice(2));
  const cmd = a._[0];
  if (!exists(path.join(ROOT, '.claude'))) die(1, `запускай из корня проекта (нет .claude в ${ROOT})`);
  if (cmd === 'plan') console.log(JSON.stringify(plan(a)));
  else if (cmd === 'init') init(a);
  else if (cmd === 'place') {
    const { abs, rel } = taskDir(a._[1]);
    const r = place(abs, { force: !!a.force });
    console.log(`kit -> ${rel}: скопировано ${r.copied}, без изменений ${r.same}, удалено ${r.removed}, переопределений ${r.overrides}${r.forced ? `, затерто правок ${r.forced}` : ''}${r.rebased ? ', пути sources пересчитаны' : ''}`);
    console.log(`args: ${JSON.stringify(baseArgs(abs))}`);
  } else if (cmd === 'args') args(a);
  else if (cmd === 'status') status(a);
  else if (cmd === 'preview') preview(a);
  else if (cmd === 'find') find(a);
  else die(1, 'команда: plan | init | place | find | args | status | preview (см. шапку task.mjs)');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
