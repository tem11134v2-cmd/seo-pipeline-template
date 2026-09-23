// Копия шаблона под проект.
// node scripts/init-project.mjs <slug> <dest-dir>   (запуск из корня шаблона)
// Копирует все, кроме work/*, examples/* и tests/* (тесты шаблона), создает пустые рабочие папки, проставляет slug в config,
// проверяет, что в шаблоне нет проектных данных (grep по словам из --check "слово1,слово2").
// В конце печатает строку «args: {...}» - root, model, model_light (и source, если задан --project) для args воркфлоу.
import fs from 'node:fs';
import path from 'node:path';
import { argv, readJson, writeJson } from './lib.mjs';

const a = argv({});
const [slug, dest] = a._;
if (!slug || !dest) { console.error('usage: init-project.mjs <slug> <dest-dir> [--check слово1,слово2] [--project <sites/NNN/project.json> [--structure <structure_data.json>]]'); process.exit(2); }
if (a.structure && !a.project) { console.error('--structure задается вместе с --project'); process.exit(2); }
if (a.project && !fs.existsSync(a.project)) { console.error(`нет файла: ${a.project}`); process.exit(2); }
const src = process.cwd();
const SKIP = new Set(['work', 'examples', 'tests', 'node_modules', '.git']);
function copyDir(s, d) {
  fs.mkdirSync(d, { recursive: true });
  for (const f of fs.readdirSync(s)) {
    if (s === src && SKIP.has(f)) continue;
    const sp = path.join(s, f), dp = path.join(d, f);
    if (fs.statSync(sp).isDirectory()) copyDir(sp, dp); else fs.copyFileSync(sp, dp);
  }
}
if (a.check) {
  const toks = a.check.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
  const hits = [];
  (function walk(dir) {
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f);
      if (fs.statSync(p).isDirectory()) { if (!SKIP.has(f)) walk(p); continue; }
      if (!/\.(md|json|mjs|js|html|css|txt)$/.test(f)) continue;
      const low = fs.readFileSync(p, 'utf8').toLowerCase();
      for (const t of toks) if (low.includes(t)) hits.push(`${path.relative(src, p)}: "${t}"`);
    }
  })(src);
  if (hits.length) { console.error('В шаблоне найдены проектные данные:'); hits.forEach(h => console.error(' - ' + h)); process.exit(1); }
  console.log('проверка на проектные данные: чисто');
}
if (fs.existsSync(dest) && fs.readdirSync(dest).length) { console.error(`папка не пустая: ${dest}`); process.exit(1); }
copyDir(src, dest);
for (const d of ['work/competitors/raw', 'work/page-types', 'work/layouts', 'work/pages', 'work/audit', 'work/catalog', 'work/output', 'inputs', 'examples']) fs.mkdirSync(path.join(dest, d), { recursive: true });
const cfgPath = path.join(dest, 'config', 'project.json');
const cfg = readJson(cfgPath); cfg.slug = slug;
// --project: вход из контракта анализа (sources.mode project); сам импорт - scripts/import-project.mjs в фазе 0
if (a.project) {
  cfg.sources = { ...cfg.sources, mode: 'project', project_json: path.resolve(a.project) };
  if (a.structure) cfg.sources.structure_input = path.resolve(a.structure);
}
writeJson(cfgPath, cfg);
fs.copyFileSync(path.join(dest, 'rules', 'decisions.template.md'), path.join(dest, 'rules', 'decisions.md'));
console.log(`проект создан: ${dest}`);
console.log(a.project
  ? 'дальше: фаза 0 в режиме project - Workflow wf-00-facts.js с args ниже плюс "structureMode" (импорт: node scripts/import-project.mjs)'
  : 'дальше: заполнить config/project.json, положить inputs/ (структура, пожелания заказчика), запустить фазу 0 - см. docs/RUNBOOK.md');
// <base> args воркфлоу (docs/RUNBOOK.md, «Обязательные args»); source - только для режима project (по умолчанию doc)
const baseArgs = { root: path.resolve(dest), model: 'claude-opus-5', model_light: 'claude-sonnet-5', ...(a.project ? { source: 'project' } : {}) };
console.log(`args: ${JSON.stringify(baseArgs)}`);
