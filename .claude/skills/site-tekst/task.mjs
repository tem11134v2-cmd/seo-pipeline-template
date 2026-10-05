#!/usr/bin/env node
// task.mjs - механика папки задачи /site-tekst (формат v9): номер и slug, копия kit в texts/NNN-<slug>/,
// args воркфлоу kit, короткая сводка, превью прототипа. Без LLM. Запуск из корня проекта (там, где texts/, sites/).
//
//   node .claude/skills/site-tekst/task.mjs plan    (--site <NNN> | --doc <id>) [--structure <MMM> | --structure-file <путь>] [--slug <slug>]
//   node .claude/skills/site-tekst/task.mjs init    --task texts/NNN-<slug> <те же флаги> [--allow-ungated] [--stop map|strategy|pilot] [--pilot a,b]
//   node .claude/skills/site-tekst/task.mjs place   <task_dir> [--force] [--reconciled <путь,...>]
//   node .claude/skills/site-tekst/task.mjs find    [<NNN>]
//   node .claude/skills/site-tekst/task.mjs args    <task_dir> facts|types|write|audit|fix|hero|catalog|site-audit [флаги вида] [--extra '<json>']
//   node .claude/skills/site-tekst/task.mjs status  <task_dir>
//   node .claude/skills/site-tekst/task.mjs stop    <task_dir> [--set map|strategy|pilot [--pilot a,b] | --autostop '<причина>' | --clear [all]]
//   node .claude/skills/site-tekst/task.mjs preview <task_dir>
//
// plan  - ничего не пишет; stdout: JSON {task_dir, nnn, slug, site, tier, structure, source, doc_id, gate_approved, gate_step,
//         gate_note}. gate_approved - nextStep(sites/NNN).n === "-" из .claude/scripts/site/queue.mjs (гейт поставлен и файлы
//         анализа на месте); проверки гейта (gate.checks) не перезапускаются, гейт без gate.checks (старше проверок) - строка
//         gate_note. tier - queue.tier (нет - project.tier, нет и его - basic). Состав страниц: --structure / --structure-file;
//         без них при tier basic - sites/NNN/structure_data.json, при tier seo - structures/<тот же номер>-*, только если ее
//         meta.project_path ведет на этот анализ и structure_data.json есть (иначе код 2 с подсказкой).
// init  - папка задачи: meta.json (format v9, ссылки; state ставит update-meta.sh), config/project.json, rules/decisions.md,
//         inputs/, work/, затем place. Последняя строка stdout: «args: {...}» - база args воркфлоу.
//         --stop - одноразовая пауза прогона (meta.stop), --pilot a,b = --stop pilot с этим пилотом (meta.pilot);
//         --allow-ungated без --stop - тоже --stop pilot (пилот до гейта анализа, как раньше).
// stop  - пауза прогона в meta.json (пишет node, не update-meta.sh): --set - ручная пауза; --autostop - автостоп по аномалии
//         с причиной (--resume не идет дальше, пока человек не снимет); --clear - снять автостоп, а если его нет - паузу
//         (--clear all - обе). Без флагов печатает текущие. Пустая строка stop (update-meta.sh stop=) - паузы нет.
// place - копия kit в папку задачи (кеш, в .gitignore): KIT_DIRS и KIT_FILES ниже, поверх - overrides/ задачи (в git).
//         Override (K9): .json - слияние с файлом kit по RFC 7396 (объекты рекурсивно, массивы и значения правки заменяют
//         значение kit, null удаляет ключ; не JSON - код 1); .md с первой строкой <!-- overrides:append --> - файл kit +
//         дописка; прочее - полная замена. В копию кладется, сравнивается и хешируется итог. Живые блоки проекта (K8:
//         html/site/behaviors/*, html/site/registry.json) и override без пары в kit - как есть.
//         Правка скопированного файла kit на месте (хеш не совпал с .kit.json; .json - разобранный JSON не совпал с итогом)
//         - код 3 и список: правка проекта переносится в overrides/<путь>, правка алгоритма - в kit шаблона; --force затирает.
//         Заодно пути sources в config/project.json пересчитываются от ссылок meta.json (относительно папки задачи).
//         Печатает overrides по видам: закрывают файлы kit (полная замена), дополняют kit, без пары в kit. База сверки
//         полных замен - meta.json overrides_base (в git, git blob id файла kit и override): kit обновил файл - строка с
//         готовой командой git diff <база> <kit>, пока override не изменится или не отмечена сверка (--reconciled <путь>:
//         override оставлен как есть, база - текущий kit). Первая база - kit на последнем коммите override (история git),
//         нет истории - текущий kit и одна строка с командой git diff --no-index <kit> <override>.
// args  - stdout: одна строка JSON для args воркфлоу (root, model, model_light + данные вида). Код 4 - делать нечего.
//   facts   wf-00-facts.js     source и structureMode по конфигу, allowUngated из meta
//   types   wf-02/03/04        вывод prep-args + catalog (niche.business_type не services)
//   write   wf-05-write.js     plan-run --phase write [--wave 1|2 | --slugs a,b | --types t] [--hero ...]; без выборки - пилот
//                              при паузе pilot (meta.pilot, иначе главная + первая категория/услуга/хаб), иначе недописанные
//                              страницы волны 1, а когда их нет - волны 2 (волны по карте, scripts/progress.mjs); страницы -
//                              все поля plan-run (hero_mode и прочие); concurrency 1 при --slugs и пилоте, иначе 4
//   audit   wf-06-audit.js     plan-run --phase audit (дописанные: каждый блок pass или exhausted), только страницы без свежего
//                              аудита - нет round-N.json или page.md изменился после него (--all - все); round - следующий
//                              номер круга судьи страницы; при паузе pilot без выборки - только пилот; sample пересчитан
//   fix     wf-06b-fix-repeats --slug s --findings f1,f2 [--judge]; без --judge skipJudge: true
//   hero    wf-05b-hero-tournament --slug s [--block B01-hero]: турнир первого экрана на готовой странице
//   catalog wf-07-catalog.js   publish: true (--no-publish - false)
//   site-audit wf-08-site-audit.js  maxFixPages: 8 (--max-fix-pages N, не больше 8); нужен собранный work/output/prototype.html
//                              (иначе код 2): аудитор готового прототипа, шаг 8 при state catalog-done
//   --slugs, пилот (meta.pilot) и stop --set pilot --pilot сверяются с рабочими страницами карты: незнакомый slug - код 2.
// status - строки для автостопов оркестратора (таблица автостопов SKILL.md): «без сегмента N», «брифов B из N», «decisions.md:
//         ...» (и «Где можно» не разобрано: <id> по parseDecisions копии kit), «фактов анализа с publish yes 0 из N» (факты
//         анализа - без F8xx оператора и служебных F9xx; при импорте до гейта - import-report gate.ungated_import, без отчета
//         meta.allow_ungated - строки нет, ноль ожидаем), «волна 1, exhausted больше 30%» (у образца 2+ exhausted-блока),
//         «блоки: ... недописано X%», «собран старым kit - пересобрать фазу 8»; итог аудита прототипа (work/audit/site.json:
//         находки, исправлено, надписи cta-unify, сбои шагов) и при state site-audited - строка следующего шага (или пропуск
//         аудита из meta.json skips).
// preview - порт от хеша пути папки задачи (задачи с одним номером у разных клиентов и в разных worktree не делят порт).
// Коды выхода: 0 - ок; 1 - ошибка; 2 - нет входа (анализа, структуры, задачи); 3 - правки в копии kit; 4 - делать нечего.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadMap, livePages, waveSummary, pilotOffer } from './kit/scripts/progress.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const KIT = path.join(HERE, 'kit');
// Что из kit кладется в папку задачи. Все это - кеш: в .gitignore шаблона, освежается при старте и --resume.
export const KIT_DIRS = ['workflows', 'prompts', 'scripts', 'schemas', 'html', 'rules'];
// Словарь элементов лидеров и стоп-лист отбора (анализ КФ и КНДР, программа 05.10): проект дополняет их через
// overrides/config/kf-elements.json (слияние JSON по ключам) - нишевые элементы живут только в проекте.
export const KIT_FILES = ['CLAUDE.md', 'config/house_style.md', 'config/kf-elements.json', 'config/kf-stoplist.json', 'config/shared-sld.json'];
// Лежит в папке kit-правил, но это решение проекта (данные задачи, в git).
export const KEEP = new Set(['rules/decisions.md']);
// Файлы kit, которые в папку задачи не кладутся: старый путь обновления автономной копии kit. В проектах SEO-шаблона kit
// обновляет /sync-from-template (или /sync-all) и task.mjs place; этот скрипт в задаче обошел бы манифест и overrides.
export const KIT_EXCLUDE = new Set(['scripts/sync-from-template.mjs']);
export const MANIFEST = '.kit.json';
export const OVERRIDES = 'overrides';
// Дописка к файлу kit (K9): первая строка .md правки проекта.
export const APPEND_MARK = '<!-- overrides:append -->';
// Живые блоки проекта (K8): у них нет пары в kit, кладутся как есть, не сливаются и не идут в строку «без пары в kit».
export const isOwnPart = rel => /^html\/site\/behaviors\/[^/]+$/.test(rel) || rel === 'html/site/registry.json';
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
const shaBuf = b => crypto.createHash('sha1').update(b).digest('hex');
// git blob id содержимого (как git hash-object --no-filters): по нему человек сравнит версии командой git diff <id> <id>
export const blobId = b => crypto.createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${b.length}\0`), b])).digest('hex');
// decisions.md - нетронутая копия шаблона: равен шаблону kit задачи или ни в одной таблице нет строки данных, где заполнено
// что-то кроме первой ячейки (копия шаблона прежнего kit: текст шаблона с тех пор изменился, равенство не сработает).
// Составитель всегда заполняет §3 (кнопки по d3) или без d3 пишет строку §8, поэтому его файл под второе правило не попадает.
export function decisionsIsTemplate(decText, tplText = '') {
  const lines = String(decText || '').replace(/^﻿/, '').replace(/\r\n/g, '\n').trim().split('\n').map(l => l.trim());
  const flat = t => String(t || '').replace(/^﻿/, '').replace(/\r\n/g, '\n').trim();
  if (tplText && flat(decText) === flat(tplText)) return true;
  const isSep = l => /^\|[\s|:-]*\|$/.test(l) && l.includes('-');
  const cells = l => l.slice(1, -1).split('|').map(c => c.trim());
  // строки данных: строка таблицы, не разделитель и не шапка (шапка стоит перед разделителем)
  const data = lines.filter((l, i) => /^\|.*\|$/.test(l) && !isSep(l) && !isSep(lines[i + 1] || ''));
  return !data.some(l => cells(l).slice(1).some(c => c && !/^[.\s]*$/.test(c)));
}
const canonJson = v => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map(key => [key, x[key]])) : x));
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
  return out.filter(r => isKitPath(r) && !KIT_EXCLUDE.has(r)).sort();
}

// Слияние JSON по RFC 7396: объект правки сливается с объектом kit рекурсивно, массив и значение правки заменяют значение kit
// целиком, null удаляет ключ kit.
export function mergePatch(target, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return patch;
  const out = target && typeof target === 'object' && !Array.isArray(target) ? { ...target } : {};
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete out[k];
    else Object.defineProperty(out, k, { value: mergePatch(out[k], v), enumerable: true, writable: true, configurable: true });
  }
  return out;
}

// Итог override для копии kit (K9): {buf, mode}. mode: merge (.json со слиянием), append (.md с пометкой в первой строке -
// файл kit + дописка), full (полная замена; short - правка .md без пометки короче половины файла kit), nopair (в kit такого
// файла нет), own (живой блок проекта, K8).
export function overlay(rel, kitAbs, ovAbs) {
  const ov = fs.readFileSync(ovAbs);
  if (isOwnPart(rel)) return { buf: ov, mode: 'own' };
  if (!exists(kitAbs)) return { buf: ov, mode: 'nopair' };
  const kit = fs.readFileSync(kitAbs);
  const text = b => b.toString('utf8').replace(/^﻿/, '');
  if (/\.json$/i.test(rel)) {
    let o, k;
    try { o = JSON.parse(text(ov)); } catch (e) { die(1, `${OVERRIDES}/${rel}: не JSON (${e.message}) - правка проекта не применена, копия kit не освежена`); }
    try { k = JSON.parse(text(kit)); } catch (e) { die(1, `kit ${rel}: не JSON (${e.message})`); }
    return { buf: Buffer.from(JSON.stringify(mergePatch(k, o), null, 2) + '\n'), mode: 'merge' };
  }
  if (/\.md$/i.test(rel)) {
    const t = text(ov);
    const m = t.match(/^\s*<!-- overrides:append -->[ \t]*(\r?\n|$)/);
    if (m) {
      const base = kit.toString('utf8');
      return { buf: Buffer.from(base + (base.endsWith('\n') ? '' : '\n') + t.slice(m[0].length)), mode: 'append' };
    }
    return { buf: ov, mode: 'full', short: ov.length * 2 < kit.length };
  }
  return { buf: ov, mode: 'full' };
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

// Лестница анализа (K10): nextStep из .claude/scripts/site/queue.mjs - одна проверка «гейт поставлен и файлы на месте».
const QUEUE_MJS = path.join(HERE, '..', '..', 'scripts', 'site', 'queue.mjs');
async function queueModule() {
  if (!exists(QUEUE_MJS)) die(1, `нет ${posix(path.relative(ROOT, QUEUE_MJS))}: машинерия анализа не на месте (/sync-from-template)`);
  return import(pathToFileURL(QUEUE_MJS).href);
}
const samePath = (x, y) => { const n = p => { const r = posix(path.resolve(ROOT, p)).replace(/\/+$/, ''); return process.platform === 'win32' ? r.toLowerCase() : r; }; return n(x) === n(y); };

// tier seo без --structure: структура с тем же номером, что у анализа (номер structures/NNN зеркалит sites/NNN), и только
// построенная на этом анализе (meta.project_path); иначе - код 2 с подсказкой явного выбора.
function seoStructure(site) {
  const n = Number((path.basename(site).match(/^(\d+)-/) || [])[1]);
  const num = pad3(n);
  const bypass = `явный выбор: --structure <MMM> (структура SEO) или --structure-file ${site}/structure_data.json (состав анализа без SEO)`;
  const hits = numberedDirs('structures').filter(d => d.n === n);
  if (!hits.length) die(2, `tier seo: структуры structures/${num}-* нет - сначала /seo-struktura ${num}; ${bypass}`);
  if (hits.length > 1) die(2, `structures/${num}-* - папок несколько (${hits.map(h => h.name).join(', ')}): ${bypass}`);
  const dir = `structures/${hits[0].name}`;
  const m = readJsonSafe(path.join(ROOT, dir, 'meta.json')) || {};
  const pp = typeof m.project_path === 'string' ? m.project_path.trim() : '';
  if (!pp || !samePath(path.dirname(pp), site)) {
    die(2, `структура ${num} построена не на этом анализе (${dir}/meta.json project_path: ${pp || 'нет - старая структура на analyses/'}); ${bypass}`);
  }
  if (!exists(path.join(ROOT, dir, 'structure_data.json'))) {
    die(2, `структура ${dir} не импортирована (state ${m.state || '-'}): /seo-struktura ${num} --import <xlsx> после ответа заказчика; ${bypass}`);
  }
  console.error(`[site-tekst] tier seo: структура ${dir} взята по номеру анализа`);
  return dir;
}

export async function plan(a) {
  if (!a.site && !a.doc) die(2, 'нужен --site <NNN> (контракт анализа) или --doc <google doc id> (анализ в Google Doc)');
  const site = a.site ? findNumbered('sites', a.site) : '';
  if (a.site && !site) die(2, `нет папки анализа sites/${/^\d+$/.test(String(a.site)) ? pad3(a.site) + '-*' : a.site}`);
  const source = a.doc ? 'doc' : 'project';
  if (source === 'project' && !exists(path.join(ROOT, site, 'project.json'))) die(2, `нет ${site}/project.json: анализ не собран (/site-analiz)`);
  const queue = site ? readJsonSafe(path.join(ROOT, site, 'queue.json')) : null;
  const proj = site ? readJsonSafe(path.join(ROOT, site, 'project.json')) : null;
  // анализ без tier - как basic (как было до проверки tier)
  const tier = site ? (String((queue && queue.tier) || (proj && proj.tier) || '').trim() || 'basic') : '';
  let structure = '';
  if (a.structure) {
    structure = findNumbered('structures', a.structure);
    if (!structure) die(2, `нет папки структуры structures/${pad3(a.structure)}-*`);
    if (!exists(path.join(ROOT, structureFile(structure)))) die(2, `нет ${structureFile(structure)}: структура не собрана (/seo-struktura)`);
  } else if (a['structure-file']) {
    const abs = path.resolve(ROOT, a['structure-file']);
    if (!exists(abs)) die(2, `нет файла структуры ${a['structure-file']}`);
    structure = posix(path.relative(ROOT, abs));
  } else if (site && tier === 'seo') structure = seoStructure(site);
  else if (site && exists(path.join(ROOT, site, 'structure_data.json'))) structure = `${site}/structure_data.json`;
  const slug = (typeof a.slug === 'string' && a.slug) || slugOf(site) || slugOf(a.structure ? structure : '');
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug || '')) die(2, `slug «${slug || ''}»: нужен латиницей (a-z, 0-9, дефис) - задай --slug`);
  const nnn = nextNumber();
  let gate_approved = null, gate_step = '', gate_note = '';
  if (site) {
    const { nextStep } = await queueModule();
    const st = nextStep(path.join(ROOT, site));
    gate_approved = st.n === '-';
    if (!gate_approved) {
      gate_step = `${st.n} ${st.name}${st.need ? ` (нет: ${st.need})` : ''}`;
      console.error(`[site-tekst] анализ ${site}: шаг ${gate_step} - ${st.cmd}`);
    } else {
      // проверки гейта не перезапускаются: их итог - gate.checks, записанный командой gate
      const g = (queue && queue.gate) || {};
      const bypass = g.checks && Array.isArray(g.checks.bypass) ? g.checks.bypass : [];
      if (!g.checks) gate_note = 'гейт анализа поставлен до проверок готовности (в queue.json нет gate.checks): verify-data и листы ответов на гейте не сверялись';
      else if (bypass.length) gate_note = `гейт анализа поставлен в обход проверок (--ground, журнал анализа): ${bypass.join('; ')}`;
      if (gate_note) console.error(`[site-tekst] внимание: ${gate_note}`);
    }
  }
  return {
    task_dir: `texts/${nnn}-${slug}`, nnn, slug, site, tier, structure, source, doc_id: a.doc && a.doc !== true ? String(a.doc) : '',
    gate_approved, gate_step, gate_note,
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

// git в корне проекта, только чтение: stdout или null (нет git, не репозиторий, нет объекта).
function gitOut(args) {
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } });
  return !r.error && r.status === 0 ? r.stdout.trim() : null;
}
// Путь для команды из корня проекта (kit вне проекта - абсолютный).
const cmdPath = p => { const r = posix(path.relative(ROOT, p)); return !r || r.startsWith('..') || path.isAbsolute(r) ? posix(p) : r; };
// Первая база полной замены (override старше K9 или новый): kit на последнем коммите override из истории git, если override
// с тех пор не менялся (блоб коммита = рабочий файл). Так расхождение, накопленное до базы (kit обновлен синком, override
// заморожен), видно сразу. Нет истории (новый override, правится сейчас, нет git, kit вне проекта) - null: база по текущему kit.
function historyKit(task, rel, cur) {
  const kitRel = posix(path.relative(ROOT, path.join(KIT, rel)));
  const ovRel = posix(path.relative(ROOT, path.join(task, OVERRIDES, rel)));
  if ([kitRel, ovRel].some(r => r.startsWith('..') || path.isAbsolute(r))) return null;
  const c = gitOut(['log', '-1', '--format=%H', '--', ovRel]);
  const ovThen = c && gitOut(['rev-parse', '--verify', '-q', `${c}:./${ovRel}`]);
  // рабочий файл сверяется и как есть, и через фильтры git (концы строк при autocrlf)
  if (!ovThen || (ovThen !== cur.ov && gitOut(['hash-object', '--', ovRel]) !== ovThen)) return null;
  const k = gitOut(['rev-parse', '--verify', '-q', `${c}:./${kitRel}`]);
  if (!k) return null;
  // kit тот же, отличие только в концах строк рабочего файла - не обновление
  return k === cur.kit || gitOut(['hash-object', '--', kitRel]) === k ? cur.kit : k;
}
// --reconciled a,b: пути полных замен (rules/hero.md или overrides/rules/hero.md)
const reconciledList = v => pilotList(v).map(s => posix(s).replace(/^\.\//, '').replace(/^(?:.*\/)?overrides\//, ''));

export function place(task, { force = false, reconciled = [] } = {}) {
  if (!exists(path.join(KIT, 'scripts', 'lib.mjs'))) die(1, `kit не найден: ${KIT}`);
  // want: rel -> {src} (файл kit как есть) | {buf} (итог override: слияние, дописка, замена)
  const want = new Map();
  for (const rel of kitFiles()) want.set(rel, { src: path.join(KIT, rel) });
  const ovDir = path.join(task, OVERRIDES);
  const overrides = walk(ovDir);
  const kinds = { full: [], merge: [], append: [], nopair: [], own: [], short: [] };
  const fullNow = {};
  for (const rel of overrides) {
    if (!isKitPath(rel)) die(1, `${OVERRIDES}/${rel}: переопределяются только файлы kit (${[...KIT_DIRS.map(d => d + '/'), ...KIT_FILES].join(', ')}); данные задачи правятся на месте`);
    const o = overlay(rel, path.join(KIT, rel), path.join(ovDir, rel));
    want.set(rel, { buf: o.buf });
    kinds[o.mode].push(rel);
    if (o.short) kinds.short.push(rel);
    if (o.mode === 'full') fullNow[rel] = { kit: blobId(fs.readFileSync(path.join(KIT, rel))), ov: blobId(o.buf) };
  }
  const unknown = reconciled.filter(r => !(r in fullNow));
  if (unknown.length) die(1, `--reconciled: не полная замена файла kit: ${unknown.join(', ')} (полные замены: ${Object.keys(fullNow).join(', ') || 'нет'})`);
  const wantSha = new Map();
  const shaOf = rel => {
    if (!wantSha.has(rel)) { const w = want.get(rel); wantSha.set(rel, w.buf ? shaBuf(w.buf) : sha(w.src)); }
    return wantSha.get(rel);
  };
  const oldManifest = readJsonSafe(path.join(task, MANIFEST)) || {};
  const old = oldManifest.files || {};
  // База сверки полных замен (K9) - meta.json overrides_base (в git, переживает смену worktree): git blob id файла kit и
  // override на момент сверки. kit обновил файл после базы - предупреждение с командой git diff при каждом place, пока override
  // не изменится (человек сверил и поправил) или сверка не отмечена (--reconciled: override оставлен как есть); тогда база
  // сдвигается. Базы нет - kit из истории git override (historyKit), нет истории - текущий kit и одна строка с командой
  // сравнения. Слияние .json и дописка .md базы не требуют: исправления kit доходят до них сами.
  const metaPath = path.join(task, 'meta.json');
  const meta = readJsonSafe(metaPath);
  const oldBase = meta && meta.overrides_base && typeof meta.overrides_base === 'object' ? meta.overrides_base : {};
  const base = {}, kitUpdated = [], based = [], marked = [];
  for (const [rel, cur] of Object.entries(fullNow)) {
    let b = oldBase[rel] && typeof oldBase[rel] === 'object' && oldBase[rel].kit ? oldBase[rel] : null;
    if (!b) {
      const k = historyKit(task, rel, cur);
      b = { kit: k || cur.kit, ov: cur.ov };
      based.push({ rel, history: !!k, changed: !!k && k !== cur.kit, cmd: `git diff --no-index ${cmdPath(path.join(KIT, rel))} ${cmdPath(path.join(task, OVERRIDES, rel))}` });
    }
    if (reconciled.includes(rel)) marked.push(rel);
    const ok = reconciled.includes(rel) || b.kit === cur.kit || (b.ov && b.ov !== cur.ov);
    if (!ok) kitUpdated.push({ rel, from: b.kit, to: cur.kit });
    base[rel] = ok ? cur : { kit: b.kit, ov: b.ov || cur.ov };
  }
  const present = [
    ...KIT_FILES.filter(f => exists(path.join(task, f))),
    ...KIT_DIRS.flatMap(d => walk(path.join(task, d)).map(r => `${d}/${r}`)),
  ].filter(isKitPath);
  // Правка на месте: файл отличается и от того, что положено в прошлый раз (.kit.json), и от того, что ляжет сейчас.
  // Файл, равный своему override (правку перенесли в overrides/ целиком, как советует код 3), - не правка: она сохранена.
  // .json сверяется разобранным: правка, перенесенная в overrides/ измененными ключами, дает тот же JSON, что итог слияния,
  // а форматирование копии (ручное у lint.json, ui.json) с JSON.stringify итога может не совпасть.
  const text = b => b.toString('utf8').replace(/^﻿/, '');
  const sameJson = rel => {
    if (!/\.json$/i.test(rel) || !want.has(rel)) return false;
    const w = want.get(rel);
    try { return canonJson(JSON.parse(text(fs.readFileSync(path.join(task, rel))))) === canonJson(JSON.parse(text(w.buf || fs.readFileSync(w.src)))); } catch { return false; }
  };
  const edited = present.filter(rel => {
    const h = sha(path.join(task, rel));
    if (want.has(rel) && h === shaOf(rel)) return false;
    if (overrides.includes(rel) && h === sha(path.join(ovDir, rel))) return false;
    if (old[rel] && h === old[rel]) return false;
    return !sameJson(rel);
  });
  if (edited.length && !force) {
    console.error(`[site-tekst] в копии kit ${posix(path.relative(ROOT, task))} правки на месте (${edited.length}), освежение их затрет:`);
    edited.slice(0, 30).forEach(r => console.error(`  - ${r}`));
    if (edited.length > 30) console.error(`  ... и еще ${edited.length - 30}`);
    console.error(`  правка проекта -> перенеси файл в ${OVERRIDES}/<тот же путь> (в git, ложится поверх kit при каждом старте;`);
    console.error(`  .json - только измененные ключи, .md - дописка с первой строкой ${APPEND_MARK});`);
    console.error('  правка алгоритма -> в .claude/skills/site-tekst/kit/ шаблона; затем повтори. --force - затереть правки.');
    process.exit(3);
  }
  let copied = 0, same = 0, removed = 0;
  for (const [rel, w] of want) {
    const dst = path.join(task, rel);
    if (exists(dst) && sha(dst) === shaOf(rel)) { same++; continue; }
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    if (w.buf) fs.writeFileSync(dst, w.buf); else fs.copyFileSync(w.src, dst);
    copied++;
  }
  for (const rel of present) if (!want.has(rel)) { fs.rmSync(path.join(task, rel), { force: true }); removed++; }
  for (const d of DATA_DIRS) fs.mkdirSync(path.join(task, d), { recursive: true });
  const files = {};
  for (const rel of want.keys()) files[rel] = shaOf(rel);
  writeJson(path.join(task, MANIFEST), {
    _doc: 'Манифест копии kit /site-tekst (кеш, не в git): хеш каждого положенного файла (у override - итога слияния или дописки). Файл с другим хешем - правка на месте, task.mjs place ее не затрет без --force. База сверки overrides - в meta.json (overrides_base).',
    placed_at: new Date().toISOString(), kit_files: want.size - overrides.length, overrides, files,
  });
  if (meta) {
    const next = Object.keys(base).length ? base : undefined;
    if (canonJson(meta.overrides_base) !== canonJson(next)) {
      if (next) meta.overrides_base = next; else delete meta.overrides_base;
      writeJson(metaPath, meta);
    }
  }
  const rebased = rebaseSources(task, meta || {});
  return {
    copied, same, removed, overrides: overrides.length, forced: force ? edited.length : 0, rebased,
    closing: kinds.full, extending: [...kinds.merge, ...kinds.append].sort(), nopair: kinds.nopair, own: kinds.own, short: kinds.short,
    kitUpdated, based, marked, task: posix(path.relative(ROOT, task)),
  };
}
const listLine = (xs, n = 12) => `${xs.slice(0, n).join(', ')}${xs.length > n ? ` и еще ${xs.length - n}` : ''}`;
function printOverrides(r) {
  if (r.closing.length) {
    console.log(`overrides закрывают файлы kit (${r.closing.length}): ${listLine(r.closing)}`);
    if (r.kitUpdated.length) console.log(`  внимание: kit обновил их с прошлой сверки - сверь override с новой версией (строка уйдет, когда override изменится; сверено и override оставлен как есть - task.mjs place ${r.task} --reconciled <путь>): ${r.kitUpdated.map(x => `${x.rel} - git diff ${x.from} ${x.to}`).join('; ')}`);
    if (r.marked.length) console.log(`  сверка отмечена (--reconciled), база сдвинута на текущий kit: ${listLine(r.marked)}`);
    // первая база: по истории git (kit с последнего коммита override не менялся - сверять нечего; менялся - строка «kit обновил»)
    const hist = r.based.filter(b => b.history && !b.changed).map(b => b.rel);
    if (hist.length) console.log(`  база сверки записана в meta.json (overrides_base) по истории git: kit не менялся с последнего коммита override: ${listLine(hist)}`);
    // первая база по текущему kit (истории нет): одна строка с готовой командой сравнения из корня проекта
    const now = r.based.filter(b => !b.history);
    if (now.length) console.log(`  база сверки записана в meta.json (overrides_base) по текущему kit: сверь override с kit один раз, дальше place предупредит, когда kit их изменит: ${now.map(b => `${b.rel} - ${b.cmd}`).join('; ')}`);
    if (r.short.length) console.log(`  похоже на дописку без пометки ${APPEND_MARK} (правка короче половины файла kit и заменяет его целиком): ${listLine(r.short)}`);
  }
  if (r.extending.length) console.log(`overrides дополняют kit (.json - слияние по ключам, .md - дописка) (${r.extending.length}): ${listLine(r.extending)}`);
  if (r.nopair.length) console.log(`правки без пары в kit (overrides/: новый файл проекта или kit переименовал файл - сверь путь): ${listLine(r.nopair)}`);
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

// Пауза прогона (C8): map - после фазы 0 (карта и решения), strategy - после фазы 4, pilot - после пилота.
export const STOPS = ['map', 'strategy', 'pilot'];
const pilotList = v => String(v || '').split(',').map(s => s.trim()).filter(Boolean);
// Список slug (--slugs, пилот) сверяется с рабочими страницами карты: опечатка иначе молча сужает выборку, а неверный список
// целиком дает пустой пилот с кодом 4 «пилот дописан». Карты еще нет (до фазы 0) - сверять не с чем.
function checkSlugs(abs, list, what, hint = '') {
  const live = livePages(loadMap(abs)).map(p => p.slug);
  if (!live.length || !list.length) return;
  const known = new Set(live);
  const bad = list.filter(s => !known.has(s));
  if (bad.length) die(2, `${what}: нет среди рабочих страниц карты: ${bad.join(', ')}${hint ? `; ${hint}` : ''}; страницы карты: ${live.slice(0, 40).join(', ')}${live.length > 40 ? ` и еще ${live.length - 40}` : ''}`);
}
const stopLine = meta => `остановка: ${meta.stop || 'нет'}${meta.autostop ? `; автостоп: ${meta.autostop}` : ''}`;
function stopFlags(a) {
  if (a.stop === true || (typeof a.stop === 'string' && !STOPS.includes(a.stop))) die(1, `--stop: ожидается ${STOPS.join(' | ')}`);
  if (a.pilot === true) die(1, '--pilot: нужен список slug через запятую');
  const pilot = pilotList(a.pilot).join(',');
  let stop = typeof a.stop === 'string' ? a.stop : '';
  if (pilot && stop && stop !== 'pilot') die(1, `--pilot означает --stop pilot, вместе с --stop ${stop} нельзя: паузу пилота поставь позже (task.mjs stop <задача> --set pilot --pilot ${pilot})`);
  if (!stop && (pilot || a['allow-ungated'])) stop = 'pilot';
  return { stop, pilot };
}

async function init(a) {
  const p = await plan(a);
  const rel = typeof a.task === 'string' ? posix(a.task).replace(/\/+$/, '') : p.task_dir;
  if (!/^texts\/\d+-[a-z0-9][a-z0-9-]*$/.test(rel)) die(1, `--task: ожидается texts/NNN-<slug>, пришло ${rel}`);
  const { stop, pilot } = stopFlags(a);
  const task = path.resolve(ROOT, rel);
  if (exists(task) && fs.readdirSync(task).length) die(1, `${rel} уже есть: продолжение - --resume`);
  const cur = path.join(ROOT, '.claude', 'tmp', 'current-task.txt');
  const declared = exists(cur) && fs.readFileSync(cur, 'utf8').split(/\r?\n/).some(l => l.trim().replace(/\/+$/, '') === rel);
  if (!declared) console.error(`[site-tekst] внимание: ${rel} не записана в .claude/tmp/current-task.txt - в worktree pre-commit откажет`);
  fs.mkdirSync(task, { recursive: true });
  const meta = {
    format: 'v9', slug: p.slug, site: p.site, structure: p.structure, source: p.source,
    ...(p.doc_id ? { doc_id: p.doc_id } : {}), ...(a['allow-ungated'] ? { allow_ungated: true } : {}),
    ...(stop ? { stop } : {}), ...(pilot ? { pilot } : {}),
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
  console.log(`${stopLine(meta)}${meta.pilot ? `; пилот: ${meta.pilot}` : ''}`);
  console.log(`args: ${JSON.stringify(baseArgs(task))}`);
}

function stopCmd(a) {
  const { abs, rel, meta } = taskDir(a._[1]);
  const file = path.join(abs, 'meta.json');
  let changed = '';
  if (a.set !== undefined) {
    if (typeof a.set !== 'string' || !STOPS.includes(a.set)) die(1, `stop --set: ожидается ${STOPS.join(' | ')}`);
    if (a.pilot !== undefined && (a.set !== 'pilot' || !pilotList(a.pilot).length)) die(1, 'stop --pilot: только с --set pilot и списком slug через запятую');
    if (a.pilot !== undefined) checkSlugs(abs, pilotList(a.pilot), 'stop --pilot');
    meta.stop = a.set;
    if (a.pilot !== undefined) meta.pilot = pilotList(a.pilot).join(',');
    changed = `пауза ${a.set}`;
  } else if (a.autostop !== undefined) {
    if (typeof a.autostop !== 'string' || !a.autostop.trim()) die(1, 'stop --autostop: нужна причина');
    meta.autostop = a.autostop.trim();
    changed = 'автостоп записан';
  } else if (a.clear !== undefined) {
    if (a.clear === 'all') { delete meta.autostop; delete meta.stop; changed = 'сняты автостоп и пауза'; }
    else if (meta.autostop) { delete meta.autostop; changed = `снят автостоп${meta.stop ? `, пауза ${meta.stop} остается` : ''}`; }
    else { changed = meta.stop ? `снята пауза ${meta.stop}` : 'снимать нечего'; delete meta.stop; }
  }
  if (changed) writeJson(file, meta);
  console.log(`${rel}: ${changed ? changed + '; ' : ''}${stopLine(meta)}${meta.pilot ? `; пилот: ${meta.pilot}` : ''}`);
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
const hasSelection = a => ['wave', 'slugs', 'types'].some(k => typeof a[k] === 'string');
// Пауза pilot и выборка не задана: пилот - meta.pilot, иначе предложение (главная + первая категория, услуга или хаб).
function pilotScope(abs, meta, a) {
  if (meta.stop !== 'pilot' || hasSelection(a)) return null;
  const list = pilotList(meta.pilot);
  if (list.length) { checkSlugs(abs, list, `пилот (meta.pilot: ${meta.pilot})`, `поправь: task.mjs stop ${posix(path.relative(ROOT, abs))} --set pilot --pilot <slug,...>`); return list; }
  const offer = pilotOffer(loadMap(abs));
  return offer.length ? offer : null;
}

function args(a) {
  const { abs, meta } = taskDir(a._[1]);
  const kind = a._[2];
  const cfg = readJsonSafe(path.join(abs, 'config', 'project.json')) || {};
  const S = cfg.sources || {};
  if ((kind === 'write' || kind === 'audit') && typeof a.slugs === 'string') checkSlugs(abs, pilotList(a.slugs), '--slugs');
  let out;
  if (kind === 'facts') {
    const source = S.mode || 'doc';
    const hasStructure = source === 'project' ? !!S.structure_input : exists(path.join(abs, S.structure_source || 'inputs/structure_data.json'));
    out = { source, structureMode: hasStructure ? 'import' : 'fallback', ...(meta.allow_ungated ? { allowUngated: true } : {}) };
  } else if (kind === 'types') {
    out = { ...runKit(abs, 'prep-args.mjs', []), catalog: ((cfg.niche || {}).business_type || 'both') !== 'services' };
  } else if (kind === 'write') {
    const pilot = pilotScope(abs, meta, a);
    const pr = runKit(abs, 'plan-run.mjs', ['--phase', 'write', ...filters(a), ...(pilot ? ['--slugs', pilot.join(',')] : [])]);
    let rows = pr.pages.filter(p => p.briefed);
    const unbriefed = pr.pages.filter(p => !p.briefed).map(p => p.slug);
    if (unbriefed.length) console.error(`[site-tekst] без брифа (фаза 4 не дошла до них): ${unbriefed.slice(0, 20).join(', ')}${unbriefed.length > 20 ? ` и еще ${unbriefed.length - 20}` : ''}`);
    let scope = pilot ? `пилот ${pilot.join(',')}` : 'выборка';
    // без выборки: волна 1 целиком раньше волны 2 (exhausted-блоки не отдаются, поэтому волна 1 кончается)
    if (!pilot && !hasSelection(a)) {
      const w1 = rows.filter(p => p.wave === 1);
      scope = w1.length ? 'волна 1' : 'волна 2';
      if (w1.length) rows = w1;
    }
    if (!rows.length) die(4, `писать нечего: ${pilot ? 'пилот дописан' : 'все страницы выборки дописаны'} (блоки exhausted не отдаются, см. status)`);
    console.error(`[site-tekst] args write: ${scope}, страниц ${rows.length}`);
    out = { pages: rows.map(({ briefed, ...p }) => p), concurrency: Number(a.concurrency) || (a.slugs || pilot ? 1 : 4) };
  } else if (kind === 'audit') {
    const pilot = pilotScope(abs, meta, a);
    const f = [...filters(a), ...(pilot ? ['--slugs', pilot.join(',')] : [])];
    let pr = runKit(abs, 'plan-run.mjs', ['--phase', 'audit', ...f]);
    if (!pr.pages.length) die(4, 'аудировать нечего: в выборке нет дописанных страниц');
    if (!a.all) {
      const stale = pr.pages.filter(p => !p.audit_fresh).map(p => p.slug);
      if (!stale.length) die(4, 'аудировать нечего: у дописанных страниц выборки аудит свежий - page.md не менялся после него (--all - все заново)');
      if (stale.length !== pr.pages.length) pr = runKit(abs, 'plan-run.mjs', ['--phase', 'audit', '--slugs', stale.join(','), ...f.filter((x, i, arr) => x !== '--slugs' && arr[i - 1] !== '--slugs')]);
    }
    if (!pr.pages.length) die(4, 'аудировать нечего: нет дописанных страниц в выборке');
    // повторный аудит пишет следующие круги (round-<n+1>.json), прежние остаются историей
    out = { pages: pr.pages.map(p => ({ slug: p.slug, type: p.type, round: (p.audit_last_round || 0) + 1 })), sample: pr.sample || [] };
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
  } else if (kind === 'site-audit') {
    // аудитор готового прототипа (wf-08): только по собранному сайту; потолок фиксера - 8 страниц
    if (!exists(path.join(abs, 'work', 'output', 'prototype.html'))) die(2, 'site-audit: нет work/output/prototype.html - сначала сборка и проверки (шаг 8)');
    const n = Number(a['max-fix-pages']);
    out = { maxFixPages: Number.isInteger(n) && n >= 0 ? Math.min(n, 8) : 8 };
  } else die(1, `args: вид ${kind || '(пусто)'} не из facts|types|write|audit|fix|hero|catalog|site-audit`);
  let extra = {};
  if (typeof a.extra === 'string') { try { extra = JSON.parse(a.extra); } catch (e) { die(1, `--extra: не JSON (${e.message})`); } }
  console.log(JSON.stringify({ ...baseArgs(abs), ...out, ...extra }));
}

// ---------------------------------------------------------------- сводка
// Статусы страниц, волны и exhausted-блоки - kit/scripts/progress.mjs (та же функция, что у plan-run и report). Строки
// status - данные для автостопов оркестратора (таблица автостопов SKILL.md; тест cases-flow читает ее цитаты): брифов меньше
// половины рабочих страниц, страницы без сегмента, decisions.md без маркера v2 или копия шаблона, 0 фактов анализа с publish
// yes, exhausted у образцов волны 1, доля недописанных блоков, прототип старого kit.
// Факты анализа - без F8xx (оператор) и F9xx (служебные контакты): служебные publish yes не маскируют ноль фактов анализа.
export const isAnalysisFact = f => !/^F[89]\d\d$/i.test(String((f && f.id) || ''));
// Автостоп после волны 1: у образца типа exhausted не меньше 2 блоков и больше 30% (один трудный блок короткой страницы -
// не системная проблема типа).
export const EXHAUSTED_MIN = 2;
export const weakSample = pr => pr.blocks_total > 0 && pr.exhausted.length >= EXHAUSTED_MIN && pr.exhausted.length / pr.blocks_total > 0.3;
// «Где можно» decisions.md, которое парсер не разобрал (колонка не применяется): parseDecisions копии kit задачи со slug и
// типами карты. Копии нет (задача до place) - не проверяется.
async function whereUnparsed(abs, text, sm) {
  const lib = path.join(abs, 'scripts', 'lib.mjs');
  if (!exists(lib)) return [];
  try {
    const { parseDecisions } = await import(pathToFileURL(lib).href);
    if (typeof parseDecisions !== 'function') return [];
    const pages = ((sm && sm.pages) || []).filter(p => p && p.slug);
    const res = parseDecisions(text, { slugs: pages.map(p => p.slug), types: [...new Set(pages.map(p => p.type).filter(Boolean))] });
    const ids = [];
    for (const w of (res && res.warnings) || []) {
      const m = String(w).match(/^decisions §1: (.+?): «Где можно» не разобрано/);
      if (m) for (const id of m[1].split(/,\s*/)) if (id && !ids.includes(id)) ids.push(id);
    }
    return ids;
  } catch { return []; }
}
async function status(a) {
  const { abs, rel, meta } = taskDir(a._[1]);
  const L = [`${rel}: state ${meta.state || 'init'}, источник ${meta.source}${meta.site ? ' ' + meta.site : ''}${meta.structure ? ', структура ' + meta.structure : ''}`];
  L.push(stopLine(meta));
  const rep = readJsonSafe(path.join(abs, 'work', 'import-report.json'));
  if (rep) L.push(`импорт: предупреждений ${(rep.warnings || []).length}, пустых полей ${(rep.empty || []).length}, антиобещаний без регулярки ${((rep.anti && rep.anti.pending) || []).length}`);
  const d9 = rep && rep.gate && rep.gate.decisions && rep.gate.decisions.d9;
  if (d9) L.push(`состав страниц (d9): ${d9.value}; ${d9.how}`);
  const facts = readJsonSafe(path.join(abs, 'work', 'facts.json'));
  const sm = readJsonSafe(path.join(abs, 'work', 'sitemap.json'));
  const dec = path.join(abs, 'rules', 'decisions.md');
  const decText = exists(dec) ? fs.readFileSync(dec, 'utf8').replace(/^﻿/, '') : '';
  const v2 = decText.split(/\r?\n/).slice(0, 10).some(l => l.trim() === '<!-- decisions:v2 -->');
  // шаблон уже несет маркер v2: файл, равный шаблону kit или без единой заполненной строки таблиц (копия шаблона
  // прежнего kit), - составитель решений (01-decisions-drafter) не отработал
  const tpl = path.join(abs, 'rules', 'decisions.template.md');
  const asTemplate = v2 && decisionsIsTemplate(decText, exists(tpl) ? fs.readFileSync(tpl, 'utf8') : '');
  if (facts) {
    const all = Array.isArray(facts.facts) ? facts.facts : [];
    const an = all.filter(isAnalysisFact);
    const anYes = an.filter(f => f.publish === 'yes').length;
    const bad = v2 && !asTemplate ? await whereUnparsed(abs, decText, sm) : [];
    // Импорт до гейта (--allow-ungated): у всех фактов publish: no - «не подтверждено», ноль publish yes ожидаем. Текущий
    // режим - import-report (после гейта --facts-only ставит ungated_import: false), отчета нет - meta.allow_ungated.
    const ungated = rep && rep.gate && typeof rep.gate.ungated_import === 'boolean' ? rep.gate.ungated_import : !!meta.allow_ungated;
    const zero = an.length >= 3 && anYes === 0;
    L.push(`факты: ${all.length} (publish yes ${all.filter(f => f.publish === 'yes').length}; анализа ${an.length}, из них publish yes ${anYes}${zero && ungated ? ' - импорт до гейта анализа, publish не подтвержден, ожидаемо' : ''}), пробелов ${(facts.gaps || []).length}; decisions.md: ${!v2 ? 'без маркера v2' : asTemplate ? 'v2, копия шаблона (составитель не отработал)' : 'v2'}${bad.length ? `; «Где можно» не разобрано: ${bad.join(', ')}` : ''}`);
    // автостоп после фазы 0: у анализа 3+ фактов, но ни один не идет в тексты (молчание заказчика обнулило факты и т.п.);
    // до гейта анализа строки нет
    if (zero && !ungated) L.push(`фактов анализа с publish yes 0 из ${an.length}`);
  }
  if (sm) {
    const pages = livePages(sm);
    const byType = {};
    for (const p of pages) byType[p.type] = (byType[p.type] || 0) + 1;
    const noSeg = pages.filter(p => !String(p.segment || '').trim()).length;
    const { rows } = waveSummary(abs, sm);
    let blocks = 0, pass = 0, exhausted = 0, briefed = 0;
    const waveLines = [];
    for (const w of [1, 2]) {
      const g = rows[w];
      if (!g.pages) continue;
      waveLines.push(`волна ${w}: ${g.pages} стр., брифов ${g.briefed}, дописано ${g.complete}, готово ${g.ready}, аудит свежий ${g.audited}, exhausted блоков ${g.exhausted}`);
      for (const pr of g.progress) { blocks += pr.blocks_total; pass += pr.passed; exhausted += pr.exhausted.length; if (pr.briefed) briefed++; }
    }
    L.push(`карта: ${pages.length} стр. (skip ${(sm.pages || []).length - pages.length}); ${Object.entries(byType).map(([t, n]) => `${t} ${n}`).join(', ')}; брифов ${briefed} из ${pages.length}${noSeg ? `; без сегмента ${noSeg}` : ''}`);
    L.push(...waveLines);
    if (briefed) L.push(`блоки: прошли линтер ${pass} из ${blocks}, недописано ${blocks - pass} (${Math.round((blocks - pass) * 100 / Math.max(1, blocks))}%), из них exhausted ${exhausted}`);
    // образец типа в волне 1: exhausted 2+ блока и больше 30% - системная проблема типа (автостоп после волны 1)
    const weak = rows[1].progress.filter(weakSample).map(pr => `${pr.slug} ${pr.exhausted.length}/${pr.blocks_total}`);
    if (weak.length) L.push(`волна 1, exhausted больше 30%: ${weak.join(', ')}`);
    const bt = ((readJsonSafe(path.join(abs, 'config', 'project.json')) || {}).niche || {}).business_type || 'both';
    const catalog = bt !== 'services' && (bt === 'shop' || pages.some(p => p.type === 'category' || p.type === 'product'));
    L.push(`каталог (фаза 7): ${catalog ? 'да' : 'нет'}`);
    if (meta.pilot) L.push(`пилот: ${meta.pilot}`);
    else if (meta.stop === 'pilot') { const offer = pilotOffer(sm); if (offer.length) L.push(`пилот (предложение): ${offer.join(',')}`); }
  } else if (meta.pilot) L.push(`пилот: ${meta.pilot}`);
  const out = path.join(abs, 'work', 'output');
  const proto = path.join(out, 'prototype.html');
  if (!exists(proto)) L.push('прототип: не собран');
  else {
    const hc = readJsonSafe(path.join(abs, 'work', 'audit', 'html-check.json'));
    const js = readJsonSafe(path.join(out, 'prototype.js-check.json'));
    const checks = [`check-html ${hc ? hc.verdict : '-'}`, `check-site-js ${js ? (js.verdict === 'skip' ? 'SKIP' : js.verdict) : '-'}`];
    const old = exists(path.join(out, 'prototype.modules.json')) ? '' : '; собран старым kit - пересобрать фазу 8';
    L.push(`прототип: ${posix(path.relative(ROOT, proto))} (${checks.join(', ')})${old}`);
  }
  L.push(...siteAuditLines(abs, meta));
  console.log(L.join('\n'));
}

// Аудит прототипа (wf-08, state site-audited): итог work/audit/site.json и следующий шаг. Нет отчета и state не
// site-audited - строк нет (старые задачи и задачи до шага 8).
export function siteAuditLines(abs, meta) {
  const L = [];
  const site = readJsonSafe(path.join(abs, 'work', 'audit', 'site.json'));
  const skips = (Array.isArray(meta.skips) ? meta.skips : []).filter(x => x && x.step === 'site-audited' && x.reason).map(x => String(x.reason));
  if (site && Array.isArray(site.findings)) {
    const f = site.findings.filter(x => x && typeof x === 'object');
    const n = s => f.filter(x => x.severity === s).length;
    const cu = Array.isArray(site.cta_unify) ? site.cta_unify : [];
    const steps = site.run && Array.isArray(site.run.steps) ? site.run.steps : [];
    const bad = steps.filter(s => s && /^(fail|partial)$/.test(String(s.status || ''))).map(s => `${s.name} ${s.status}`);
    L.push(`аудит прототипа: находок ${f.length} (blocker ${n('blocker')}, major ${n('major')}, minor ${n('minor')}), исправлено ${f.filter(x => x.status === 'fixed').length}; надписей cta-unify ${cu.filter(x => x && (x.status === 'applied' || x.status === 'partial')).length} из ${cu.length}${bad.length ? `; сбои шагов: ${bad.join(', ')}` : ''}${skips.length ? `; ${skips[skips.length - 1]}` : ''}`);
  } else if (meta.state === 'site-audited') L.push(`аудит прототипа: нет work/audit/site.json${skips.length ? ` (${skips[skips.length - 1]})` : ''}`);
  if (meta.state === 'site-audited') L.push('дальше (site-audited): сборка и проверки заново (поломка - откат правок аудитора по снимку), таблица КФ/КНДР, report.mjs -> built');
  return L;
}

// ---------------------------------------------------------------- превью (serve.mjs kit в панели браузера)
export const PREVIEW_BASE = 4610, PREVIEW_SPAN = 390;
export function previewPort(abs) {
  const key = posix(path.resolve(abs)).replace(/\/+$/, '');
  const h = crypto.createHash('sha1').update(process.platform === 'win32' ? key.toLowerCase() : key).digest();
  return PREVIEW_BASE + (h.readUInt32BE(0) % PREVIEW_SPAN);
}
function preview(a) {
  const { abs, rel } = taskDir(a._[1]);
  const out = path.join(abs, 'work', 'output');
  if (!exists(path.join(out, 'prototype.html'))) die(2, `нет ${rel}/work/output/prototype.html: сначала сборка (build-html.mjs)`);
  // Порт - от хеша абсолютного пути папки задачи: у задач с одним номером (texts/001 разных клиентов, старая и новая
  // worktree одной задачи) порты разные, живой сервер другой задачи не подменит превью. Занят другой записью launch.json -
  // следующий свободный.
  const serve = posix(path.join(abs, 'scripts', 'serve.mjs'));
  const lj = path.join(ROOT, '.claude', 'launch.json');
  const conf = readJsonSafe(lj) || { version: '0.0.1', configurations: [] };
  const name = `site-tekst-${path.basename(abs)}`;
  // прежние записи этой задачи (и старое имя site-tekst-NNN с тем же serve.mjs) заменяются
  conf.configurations = (Array.isArray(conf.configurations) ? conf.configurations : []).filter(c => c && c.name !== name && !(Array.isArray(c.runtimeArgs) && c.runtimeArgs[0] === serve));
  const taken = new Set(conf.configurations.map(c => Number(c.port)).filter(Boolean));
  let port = previewPort(abs);
  for (let i = 0; i < PREVIEW_SPAN && taken.has(port); i++) port = PREVIEW_BASE + ((port - PREVIEW_BASE + 1) % PREVIEW_SPAN);
  conf.configurations.push({ name, runtimeExecutable: 'node', runtimeArgs: [serve, '--dir', posix(out), '--port', String(port)], port });
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
async function main() {
  const a = argv(process.argv.slice(2));
  const cmd = a._[0];
  if (!exists(path.join(ROOT, '.claude'))) die(1, `запускай из корня проекта (нет .claude в ${ROOT})`);
  if (cmd === 'plan') console.log(JSON.stringify(await plan(a)));
  else if (cmd === 'init') await init(a);
  else if (cmd === 'place') {
    const { abs, rel } = taskDir(a._[1]);
    if (a.reconciled === true) die(1, '--reconciled: нужен путь полной замены (rules/hero.md), несколько - через запятую');
    const r = place(abs, { force: !!a.force, reconciled: a.reconciled ? reconciledList(a.reconciled) : [] });
    console.log(`kit -> ${rel}: скопировано ${r.copied}, без изменений ${r.same}, удалено ${r.removed}, переопределений ${r.overrides}${r.forced ? `, затерто правок ${r.forced}` : ''}${r.rebased ? ', пути sources пересчитаны' : ''}`);
    printOverrides(r);
    console.log(`args: ${JSON.stringify(baseArgs(abs))}`);
  } else if (cmd === 'args') args(a);
  else if (cmd === 'status') await status(a);
  else if (cmd === 'stop') stopCmd(a);
  else if (cmd === 'preview') preview(a);
  else if (cmd === 'find') find(a);
  else die(1, 'команда: plan | init | place | find | args | status | stop | preview (см. шапку task.mjs)');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(e => { console.error(`[site-tekst] ${(e && e.stack) || e}`); process.exit(1); });
}
