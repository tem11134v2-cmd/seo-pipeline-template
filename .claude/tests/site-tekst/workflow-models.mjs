// Модели по ролям в воркфлоу kit /site-tekst (kit/workflows/*.js). Запуск:
//   node .claude/tests/site-tekst/workflow-models.mjs      код выхода 0 - все прошли (или через run.mjs рядом).
// Каждый воркфлоу исполняется как тело async-функции с подставными agent, parallel, pipeline, phase, log, workflow:
// агенты не запускаются, agent() записывает label и model и возвращает заглушку по schema вызова. Заглушки подобраны
// так, чтобы сработали все ветки с агентами: находки major (фиксеры и вторые круги), validator не pass (второй круг
// раскладок), реквизитов нет (снимок сайта), страница в находке кросса (фиксер кросса). Вложенный wf-05b идет через
// подставной workflow() из того же kit. Проверки:
//   - синтаксис: каждый файл workflows/*.js компилируется и покрыт прогоном ниже;
//   - таблица ROLES каждого воркфлоу совпадает с решением оркестратора (LIGHT/STRONG ниже) и с таблицей RUNBOOK;
//   - label каждого вызова дает роль из таблицы этого воркфлоу, каждая роль таблицы вызвана хотя бы раз;
//   - умолчание: light -> model_light, strong -> model; без model_light легкие берут model, без обеих - undefined;
//   - args.models переопределяет каждую роль точечно (и во вложенном турнире), остальные роли - по умолчанию;
//   - умолчание extract (wf-02) и writer (wf-05) - одна строка таблицы; ее правка меняет модель только этой роли;
//   - те же args - та же последовательность (label, model): resume берет кэш; args.models не объект - отказ.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const KIT = path.resolve(HERE, '..', '..', 'skills', 'site-tekst', 'kit');
const WF = path.join(KIT, 'workflows');
const RUNBOOK = path.join(KIT, 'docs', 'RUNBOOK.md');

// ---------- решение оркестратора: умолчания ролей ----------
const LIGHT = ['dump', 'snapshot', 'import', 'verify', 'inventory', 'catalog-analyst', 'layout', 'tz-publish', 'prep-args', 'briefs', 'build', 'run'];
const STRONG = ['facts-extract', 'facts-check', 'facts-fix', 'structure-fallback', 'sitemap-enrich', 'extract', 'aggregate', 'type-audit', 'type-fix',
  'strategist-global', 'strategist-type', 'writer', 'hero-writer', 'hero-select', 'hero-judge', 'judge', 'fixer', 'cross-judge', 'blind',
  'catalog-spec', 'tz-write', 'tz-audit', 'distill', 'distill-check', 'retro'];
const TIER = Object.fromEntries([...LIGHT.map(r => [r, 'light']), ...STRONG.map(r => [r, 'strong'])]);
// роли, умолчание которых меняется одной строкой таблицы: воркфлоу -> роль
const ONE_LINE = { 'wf-02-competitors': 'extract', 'wf-05-write': 'writer' };

// ---------- label вызова -> роль (независимо от таблицы воркфлоу) ----------
const LABELS = {
  'wf-00-facts': [[/^dump$/, 'dump'], [/^facts-extract$/, 'facts-extract'], [/^facts-check-[12]$/, 'facts-check'], [/^facts-fix$/, 'facts-fix'],
    [/^site-snapshot$/, 'snapshot'], [/^structure-fallback$/, 'structure-fallback'], [/^sitemap-enrich$/, 'sitemap-enrich'],
    [/^project-import$/, 'import'], [/^import-structure$/, 'run']],
  'wf-02-competitors': [[/^prep-args$/, 'prep-args'], [/^verify$/, 'verify'], [/^inventory:/, 'inventory'], [/^extract:/, 'extract'],
    [/^aggregate:/, 'aggregate'], [/^catalog-analyst$/, 'catalog-analyst']],
  'wf-03-audit-types': [[/^prep-args$/, 'prep-args'], [/^audit:.+:[12]$/, 'type-audit'], [/^fix:/, 'type-fix']],
  'wf-04-strategy-layouts': [[/^prep-args$/, 'prep-args'], [/^strategist-global$/, 'strategist-global'], [/^strategist:/, 'strategist-type'],
    [/^merge\+build-briefs$/, 'briefs'], [/^layout:/, 'layout']],
  'wf-05-write': [[/^hero:/, 'hero-writer'], [/^select:/, 'hero-select'], [/^block:/, 'writer']],
  'wf-05b-hero-tournament': [[/^hero-writer:/, 'hero-writer'], [/^judge:(checklist|blind):/, 'hero-judge'], [/^select:/, 'hero-select']],
  'wf-06-audit': [[/^judge:/, 'judge'], [/^fix:/, 'fixer'], [/^cross-judge$/, 'cross-judge'], [/^blind:/, 'blind'], [/^render-md$/, 'run']],
  'wf-06b-fix-repeats': [[/^fix:/, 'fixer'], [/^judge:/, 'judge'], [/^build$/, 'build']],
  'wf-07-catalog': [[/^catalog-spec$/, 'catalog-spec'], [/^tz-write(-2)?$/, 'tz-write'], [/^tz-audit-[12]$/, 'tz-audit'], [/^tz-publish$/, 'tz-publish']],
  'wf-T1-distill-rules': [[/^distill(-fix)?$/, 'distill'], [/^check-[12]$/, 'distill-check'], [/^normalize$/, 'run']],
  'wf-T2-retro': [[/^retro$/, 'retro']],
};
const roleOf = (wf, label) => ((LABELS[wf] || []).find(([re]) => re.test(label || '')) || [])[1];

// ---------- минимальные args: все ветки с агентами ----------
const ROOT = '/fake/root';
const RUNS = {
  'wf-00-facts': [{ source: 'doc', structureMode: 'import' }, { source: 'project', structureMode: 'fallback' }],
  'wf-02-competitors': [{ types: ['home', 'category'], catalog: true }],
  'wf-03-audit-types': [{ types: ['home', 'category'] }],
  'wf-04-strategy-layouts': [{ types: ['home', 'category'] }],
  'wf-05-write': [{ concurrency: 2, pages: [
    { slug: 'home', type: 'home', hero_mode: 'tournament', hero_block_id: 'B01-hero', pending_blocks: ['B01-hero', 'B02-benefits'] },
    { slug: 'okna', type: 'category', hero_mode: 'single', hero_block_id: 'B01-hero', pending_blocks: ['B01-hero', 'B02-listing'] }] }],
  'wf-05b-hero-tournament': [{ slug: 'home' }],
  'wf-06-audit': [{ pages: [{ slug: 'home', type: 'home' }], sample: ['home'] }],
  'wf-06b-fix-repeats': [{ slug: 'home' }],
  'wf-07-catalog': [{}],
  'wf-T1-distill-rules': [{ rulesFile: 'rules-src.md' }],
  'wf-T2-retro': [{}],
};

// ---------- заглушки по schema ----------
const STR = { lint: 'pass', validator: 'fail', page: 'home', company_status: 'missing', status: 'ok', kept: 'd1.example', domain: 'd1.example' };
function stub(s, key, ctx) {
  if (!s) return 'текст';
  if (s.enum) return key === 'severity' ? 'major' : s.enum[0];
  if (s.type === 'object') return Object.fromEntries(Object.entries(s.properties || {}).map(([k, v]) => [k, stub(v, k, ctx)]));
  if (s.type === 'array') return key === 'results' && ctx.types ? ctx.types.map(t => ({ ...stub(s.items, 'item', ctx), type: t })) : [stub(s.items, key, ctx)];
  if (s.type === 'string') return STR[key] ?? 'x';
  if (s.type === 'number') return 1;
  if (s.type === 'boolean') return key === 'ok';
  return null;
}
const ctxOf = prompt => { const m = String(prompt).match(/types=(\[[^\]]*\])/); try { return { types: m ? JSON.parse(m[1]) : null }; } catch { return { types: null }; } };

// ---------- исполнение воркфлоу с подставными хуками ----------
const AsyncFunction = (async () => {}).constructor;
const source = name => fs.readFileSync(path.join(WF, `${name}.js`), 'utf8');
const compile = src => new AsyncFunction('args', 'agent', 'parallel', 'pipeline', 'phase', 'log', 'workflow', 'budget', src.replace(/^export const meta\s*=/m, 'const meta ='));
async function runWf(name, args, src) {
  const calls = [], errors = [];
  const exec = (wf, a, text) => {
    const agent = async (prompt, opts = {}) => { calls.push({ wf, label: opts.label, model: opts.model }); return stub(opts.schema, null, ctxOf(prompt)); };
    const guard = async f => { try { return await f(); } catch (e) { errors.push(`${wf}: ${e.message}`); return null; } };
    const parallel = thunks => Promise.all(thunks.map(t => guard(t)));
    const pipeline = (items, ...stages) => Promise.all(items.map((it, i) => guard(async () => { let r = it; for (const st of stages) r = await st(r, it, i); return r; })));
    const workflow = async (ref, childArgs) => {
      if (wf !== name) throw new Error('вложенный workflow() глубже одного уровня');
      const child = path.basename(ref.scriptPath || '', '.js');
      return exec(child, childArgs, source(child));
    };
    return compile(text)(a, agent, parallel, pipeline, () => {}, () => {}, workflow, { total: null, spent: () => 0, remaining: () => Infinity });
  };
  const result = await exec(name, args, src ?? source(name));
  return { calls, errors, result };
}
// все конфигурации RUNS воркфлоу с одними и теми же модельными args
async function runAll(name, modelArgs, src) {
  const calls = [], errors = [];
  for (const a of RUNS[name]) { const r = await runWf(name, { root: ROOT, ...a, ...modelArgs }, src); calls.push(...r.calls); errors.push(...r.errors); }
  return { calls, errors };
}

// таблица ROLES из исходника: литерал объекта после «const ROLES =»
function rolesOf(src) {
  const i = src.indexOf('const ROLES = {');
  if (i < 0) return null;
  const start = src.indexOf('{', i), end = src.indexOf('\n}', start);
  return new Function(`return (${src.slice(start, end + 2)})`)();
}

// ---------- проверки ----------
let pass = 0, fail = 0;
const failures = [];
function check(name, ok, detail = '') {
  if (ok) pass++;
  else { fail++; failures.push(`FAIL ${name}${detail ? ': ' + String(detail).slice(0, 600) : ''}`); }
}
const S = 'M-STRONG', L = 'M-LIGHT';
const want = role => (TIER[role] === 'light' ? L : S);
const bad = (calls, fn) => calls.filter(c => !fn(c)).map(c => `${c.wf}/${c.label}=${c.model}`).slice(0, 5).join(', ');

try {
  const files = fs.readdirSync(WF).filter(f => f.endsWith('.js')).map(f => f.replace(/\.js$/, '')).sort();
  check('каждый воркфлоу kit покрыт прогоном и наоборот', JSON.stringify(files) === JSON.stringify(Object.keys(RUNS).sort()), files.join(', '));
  check('решение оркестратора: роль ровно в одном ярусе', LIGHT.length + STRONG.length === Object.keys(TIER).length);

  const tables = {};
  for (const name of files) {
    const src = source(name);
    let compiled = true;
    try { compile(src); } catch (e) { compiled = false; check(`${name}: синтаксис`, false, e.message); }
    if (compiled) check(`${name}: синтаксис`, true);
    const roles = tables[name] = rolesOf(src) || {};
    check(`${name}: таблица ROLES есть`, Object.keys(roles).length > 0);
    const off = Object.entries(roles).filter(([r, t]) => TIER[r] !== t).map(([r, t]) => `${r}:${t} (ждем ${TIER[r] || 'нет роли'})`);
    check(`${name}: ROLES совпадает с решением оркестратора`, !off.length, off.join(', '));
    check(`${name}: ни одного model: MODEL в вызовах agent (только modelFor)`, !/\bmodel: MODEL(_LIGHT)?\s*,\s*schema/.test(src));
  }

  // RUNBOOK kit: таблица «Модели по ролям» - все роли с теми же умолчаниями
  const rb = fs.readFileSync(RUNBOOK, 'utf8');
  const rbRows = Object.fromEntries([...rb.matchAll(/^\| `([a-z-]+)` \| (light|strong)\b/gm)].map(m => [m[1], m[2]]));
  const rbOff = Object.keys(TIER).filter(r => rbRows[r] !== TIER[r]).map(r => `${r}:${rbRows[r] || 'нет'}`);
  check('RUNBOOK: таблица ролей совпадает с умолчаниями', !rbOff.length && Object.keys(rbRows).length === Object.keys(TIER).length, rbOff.join(', ') || Object.keys(rbRows).join(','));

  for (const name of files) await checkWorkflow(name, tables).catch(e => check(`${name}: исключение`, false, e.message));

  // extract / writer: умолчание - одна строка таблицы
  for (const [name, role] of Object.entries(ONE_LINE)) {
    const src = source(name);
    const re = new RegExp(`^\\s*${role}: '(light|strong)',.*$`, 'gm');
    const lines = src.match(re) || [];
    check(`${name}: умолчание ${role} - отдельная строка таблицы`, lines.length === 1, `строк ${lines.length}`);
    if (lines.length !== 1) continue;
    const flipped = TIER[role] === 'light' ? 'strong' : 'light';
    const edited = src.replace(re, l => l.replace(/'(light|strong)'/, `'${flipped}'`));
    const r = await runAll(name, { model: S, model_light: L }, edited);
    const other = flipped === 'light' ? L : S;
    const ok = c => c.model === (roleOf(c.wf, c.label) === role ? other : want(roleOf(c.wf, c.label)));
    check(`${name}: правка строки ${role} меняет модель только ${role}`, r.calls.some(c => roleOf(c.wf, c.label) === role) && !bad(r.calls, ok), bad(r.calls, ok));
  }

  // переопределение сразу нескольких ролей, пример из RUNBOOK
  const ex = await runAll('wf-05-write', { model: 'opus', model_light: 'sonnet', models: { writer: 'sonnet', 'hero-judge': 'haiku' } });
  const exOk = c => c.model === ({ writer: 'sonnet', 'hero-judge': 'haiku' }[roleOf(c.wf, c.label)] || (TIER[roleOf(c.wf, c.label)] === 'light' ? 'sonnet' : 'opus'));
  check('wf-05-write: models доходит до вложенного турнира wf-05b', ex.calls.some(c => c.wf === 'wf-05b-hero-tournament' && c.model === 'haiku') && !bad(ex.calls, exOk), bad(ex.calls, exOk));
} catch (e) {
  fail++; failures.push(`FAIL исключение: ${e.stack || e.message}`);
}

async function checkWorkflow(name, tables) {
  // умолчание
  const def = await runAll(name, { model: S, model_light: L });
  check(`${name}: прогон без ошибок в parallel/pipeline`, !def.errors.length, def.errors.join(' | '));
  const unknown = def.calls.filter(c => !roleOf(c.wf, c.label) || !(roleOf(c.wf, c.label) in (tables[c.wf] || {})));
  check(`${name}: у каждого вызова роль из таблицы своего воркфлоу`, !unknown.length, unknown.map(c => `${c.wf}/${c.label}`).slice(0, 5).join(', '));
  check(`${name}: умолчание light -> model_light, strong -> model`, def.calls.length && !bad(def.calls, c => c.model === want(roleOf(c.wf, c.label))), bad(def.calls, c => c.model === want(roleOf(c.wf, c.label))));
  for (const wf of new Set([name, ...def.calls.map(c => c.wf)])) {
    const hit = new Set(def.calls.filter(c => c.wf === wf).map(c => roleOf(wf, c.label)));
    const miss = Object.keys(tables[wf] || {}).filter(r => !hit.has(r));
    check(`${name}: все роли ${wf} вызваны хотя бы раз`, !miss.length, miss.join(', '));
  }
  // resume: те же args - та же последовательность
  const again = await runAll(name, { model: S, model_light: L });
  check(`${name}: те же args - те же (label, model)`, JSON.stringify(again.calls) === JSON.stringify(def.calls));
  // без model_light легкие берут model; без обеих - undefined (модель сессии)
  const noLight = await runAll(name, { model: S });
  check(`${name}: без model_light все роли на model`, !bad(noLight.calls, c => c.model === S), bad(noLight.calls, c => c.model === S));
  const none = await runAll(name, {});
  check(`${name}: без model и model_light - model не задан`, !bad(none.calls, c => c.model === undefined), bad(none.calls, c => c.model === undefined));
  // args.models: каждая роль воркфлоу (и вложенного) по одной, остальные - по умолчанию
  const roles = [...new Set(def.calls.map(c => roleOf(c.wf, c.label)))];
  for (const role of roles) {
    const o = await runAll(name, { model: S, model_light: L, models: { [role]: `O:${role}` } });
    const ok = c => c.model === (roleOf(c.wf, c.label) === role ? `O:${role}` : want(roleOf(c.wf, c.label)));
    check(`${name}: models.${role} переопределяет только ${role}`, o.calls.some(c => c.model === `O:${role}`) && !bad(o.calls, ok), bad(o.calls, ok));
  }
  // args.models не объект - отказ
  let threw = '';
  try { await runWf(name, { root: ROOT, ...RUNS[name][0], model: S, models: ['sonnet'] }); } catch (e) { threw = e.message; }
  check(`${name}: args.models массивом - отказ`, /args\.models/.test(threw), threw || 'не отказал');
}

failures.forEach(f => console.log(f));
console.log(`workflow-models: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
