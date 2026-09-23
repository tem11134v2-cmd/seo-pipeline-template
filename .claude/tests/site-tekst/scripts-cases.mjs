// Тесты скриптов kit /site-tekst (кроме линтера - он в lint-cases.mjs рядом). Запуск:
//   node .claude/tests/site-tekst/scripts-cases.mjs          код выхода 0 - все прошли (или через run.mjs рядом).
// Корень алгоритма (TPL) - .claude/skills/site-tekst/kit; до переноса в шаблон набор жил в tests/ test-text-template.
// Все во временных папках (os.tmpdir()): фикстуры examples/smoke-fixtures и синтетические данные, без сети и данных клиентов.
// Скрипты запускаются как CLI из корня временного проекта; схемы - из schemas/ шаблона.
// Разделы: init-project, build-briefs + writer-inputs, blind-prep, page-state, plan-run, merge-strategy, prep-args,
// dedup + cross-digest (гео-близнецы), split-cross, retro-stats, import-project + render-analysis, схема конфига.
// Синтетический project.json проверяется по схеме анализа site-analiz, если она есть на этой машине (иначе проверка пропущена).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validate, SERVICE_NOTE_COPY } from '../../skills/site-tekst/kit/scripts/lib.mjs';
import { blockId } from '../../skills/site-tekst/kit/scripts/render-analysis.mjs';

const TPL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'skills', 'site-tekst', 'kit');
const FIX = path.join(TPL, 'examples', 'smoke-fixtures');
// схема анализа - соседний скил этого же шаблона (раньше - абсолютный путь на машине автора)
const ANALYSIS_SCHEMA = path.resolve(TPL, '..', '..', 'site-analiz', 'project.schema.json');
let pass = 0, fail = 0;
const failures = [], notes = [];
function check(name, ok, detail = '') {
  if (ok) pass++;
  else { fail++; failures.push(`FAIL ${name}${detail ? ': ' + String(detail).slice(0, 600) : ''}`); }
}

// ---------- помощники ----------
const rj = f => JSON.parse(fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, ''));
const wj = (f, o) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(o, null, 2) + '\n'); };
const wt = (f, s) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, s); };
const sha1 = s => crypto.createHash('sha1').update(s).digest('hex');
const SCHEMAS = {};
const schemaErrors = (name, data) => validate(SCHEMAS[name] ??= rj(path.join(TPL, 'schemas', `${name}.schema.json`)), data);
function checkSchema(label, name, data) { const e = schemaErrors(name, data); check(`${label} проходит схему ${name}`, !e.length, e.slice(0, 3).join('; ')); }
// JSON с сортировкой ключей: сравнение «по содержанию»
const canon = v => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map(key => [key, x[key]])) : x));
function run(cwd, args) {
  const r = spawnSync(process.execPath, args, { cwd, encoding: 'utf8' });
  return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '', out: (r.stdout || '') + (r.stderr || '') };
}
const runJson = (cwd, args) => { const r = run(cwd, args); try { r.json = JSON.parse(r.stdout); } catch { r.json = null; } return r; };
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'scripts-cases-'));
// проект без init-project: только логика шаблона (быстрее и без проверки на пустую папку)
function mkProject(name) {
  const dir = path.join(tmpRoot, name);
  for (const d of ['scripts', 'rules', 'schemas', 'config']) fs.cpSync(path.join(TPL, d), path.join(dir, d), { recursive: true });
  return dir;
}
const argsLine = out => { const m = out.match(/^args: (\{.*\})\s*$/m); try { return m ? JSON.parse(m[1]) : null; } catch { return null; } };
// подмножество draft-07 для схемы анализа: $ref, const, enum, type (строка или массив, integer), строки, числа, массивы, объекты
function v07(s, d, root = s, p = '$', e = []) {
  if (s.$ref) { let r = root; for (const k of s.$ref.replace('#/', '').split('/')) r = r[k]; return v07(r, d, root, p, e); }
  const tOf = x => (Array.isArray(x) ? 'array' : x === null ? 'null' : Number.isInteger(x) ? 'integer' : typeof x);
  if ('const' in s && JSON.stringify(s.const) !== JSON.stringify(d)) e.push(`${p}: не равно ${JSON.stringify(s.const)}`);
  if (s.enum && !s.enum.includes(d)) e.push(`${p}: «${d}» не из enum`);
  if (s.type) {
    const ts = [].concat(s.type), t = tOf(d);
    if (!ts.includes(t) && !(t === 'integer' && ts.includes('number'))) { e.push(`${p}: тип ${t}, ожидался ${ts.join('|')}`); return e; }
  }
  if (typeof d === 'string') {
    const n = Array.from(d).length;
    if (s.minLength != null && n < s.minLength) e.push(`${p}: короче ${s.minLength}`);
    if (s.maxLength != null && n > s.maxLength) e.push(`${p}: длиннее ${s.maxLength}`);
    if (s.pattern && !new RegExp(s.pattern, 'u').test(d)) e.push(`${p}: не по шаблону ${s.pattern}`);
  }
  if (typeof d === 'number') {
    if (s.minimum != null && d < s.minimum) e.push(`${p}: меньше ${s.minimum}`);
    if (s.maximum != null && d > s.maximum) e.push(`${p}: больше ${s.maximum}`);
  }
  if (Array.isArray(d)) {
    if (s.minItems != null && d.length < s.minItems) e.push(`${p}: элементов меньше ${s.minItems}`);
    if (s.maxItems != null && d.length > s.maxItems) e.push(`${p}: элементов больше ${s.maxItems}`);
    if (s.uniqueItems && new Set(d.map(x => JSON.stringify(x))).size !== d.length) e.push(`${p}: повторы`);
    if (s.items) d.forEach((x, i) => v07(s.items, x, root, `${p}[${i}]`, e));
  }
  if (d && typeof d === 'object' && !Array.isArray(d)) {
    for (const r of s.required || []) if (!(r in d)) e.push(`${p}: нет поля ${r}`);
    for (const [k, x] of Object.entries(d)) {
      if (s.properties && s.properties[k]) v07(s.properties[k], x, root, `${p}.${k}`, e);
      else if (s.additionalProperties === false) e.push(`${p}: лишнее поле ${k}`);
    }
  }
  return e;
}

try {
  // ================================================================== 0. init-project и фикстуры
  const S = path.join(tmpRoot, 'smoke');
  {
    const init = run(TPL, ['scripts/init-project.mjs', 'smoke', S]);
    check('init: код 0', init.code === 0, init.out);
    const ia = argsLine(init.stdout);
    check('init: строка args с root, model, model_light', !!ia && path.resolve(ia.root) === path.resolve(S) && !!ia.model && !!ia.model_light, init.stdout);
    check('init: без --project в args нет source', !!ia && !('source' in ia), init.stdout);
    checkSchema('init: config/project.json', 'project-config', rj(path.join(S, 'config', 'project.json')));
    const again = run(TPL, ['scripts/init-project.mjs', 'smoke', S]);
    check('init: непустая папка - код 1', again.code === 1, again.out);
    check('init: --structure без --project - код 2', run(TPL, ['scripts/init-project.mjs', 'x', path.join(tmpRoot, 'x'), '--structure', 'a.json']).code === 2);
    check('init: --project на несуществующий файл - код 2', run(TPL, ['scripts/init-project.mjs', 'x', path.join(tmpRoot, 'x'), '--project', path.join(tmpRoot, 'nope.json')]).code === 2 && !fs.existsSync(path.join(tmpRoot, 'x')));
    const noDest = run(TPL, ['scripts/init-project.mjs', 'smoke']);
    check('init: без пути - код 2', noDest.code === 2, noDest.out);
  }
  fs.cpSync(path.join(FIX, 'work'), path.join(S, 'work'), { recursive: true });
  fs.cpSync(path.join(FIX, 'rules'), path.join(S, 'rules'), { recursive: true });
  { const f = path.join(S, 'config', 'project.json'); const c = rj(f); c.company = 'Окна Тест'; wj(f, c); }
  const SW = (...p) => path.join(S, 'work', ...p);

  // ================================================================== 1. build-briefs + writer-inputs
  {
    // задание блока ссылается на факт вне списка страницы: F03 (замер) у категории, где в facts только F04, F05
    const st = rj(SW('strategy.json'));
    st.pages['okna-rehau'].block_overrides = { cta: { task: 'Рядом с кнопкой назови срок замера (F03).' } };
    wj(SW('strategy.json'), st);
    const bb = run(S, ['scripts/build-briefs.mjs']);
    check('build-briefs: код 0, брифов 2, срезов 8, проблем 0', bb.code === 0 && /брифов собрано: 2\b/.test(bb.out) && /срезов для писателей: 8\b/.test(bb.out) && /проблем: 0\b/.test(bb.out), bb.out);
    for (const slug of ['home', 'okna-rehau']) checkSchema(`build-briefs: ${slug}/brief.json`, 'brief', rj(SW('pages', slug, 'brief.json')));
    const slices = [];
    for (const slug of ['home', 'okna-rehau']) {
      const briefText = fs.readFileSync(SW('pages', slug, 'brief.json'), 'utf8');
      const ids = JSON.parse(briefText).blocks.map(b => b.block_id);
      const files = fs.readdirSync(SW('pages', slug, 'brief')).filter(f => f.endsWith('.json')).sort();
      check(`writer-inputs: ${slug} - срез на каждый блок брифа`, canon(files) === canon(ids.map(id => `${id}.json`).sort()), files.join(', '));
      for (const f of files) {
        const s = rj(SW('pages', slug, 'brief', f));
        slices.push({ slug, f, s });
        const e = schemaErrors('brief-slice', s);
        check(`writer-inputs: ${slug}/${f} проходит схему brief-slice`, !e.length, e.slice(0, 3).join('; '));
        check(`writer-inputs: ${slug}/${f} помнит sha1 брифа`, s._brief_sha1 === sha1(briefText));
      }
    }
    const sl = (slug, id) => (slices.find(x => x.slug === slug && x.f === `${id}.json`) || {}).s || {};
    const okBrief = rj(SW('pages', 'okna-rehau', 'brief.json'));
    const cta = okBrief.blocks.find(b => b.type === 'cta');
    check('build-briefs: факт из текста задания (F03) - в фактах страницы', okBrief.facts.some(f => f.id === 'F03'), okBrief.facts.map(f => f.id).join(','));
    check('build-briefs: факт из текста задания (F03) - в фактах блока', !!cta && cta.facts.includes('F03') && /F03/.test(cta.task), JSON.stringify(cta));
    check('writer-inputs: срез блока с заданием видит F03 в facts и в block.facts', sl('okna-rehau', cta.block_id).facts?.some(f => f.id === 'F03') && sl('okna-rehau', cta.block_id).block?.facts.includes('F03'));
    const hero = sl('home', 'B01-hero'), benefits = sl('home', 'B02-benefits'), proc = sl('home', 'B03-process');
    const okBriefHome = rj(SW('pages', 'home', 'brief.json'));
    check('writer-inputs: первый экран получает формулу оффера и список возражений страницы', !!hero.offer_formula && Array.isArray(hero.segment?.objections_page));
    // A/B 2026-09-23: рамка страницы (позиционирование, формула оффера) и смысл фактов (label, angle) нужны каждому блоку
    check('writer-inputs: обычный блок получает формулу оффера и позиционирование, без objections_page', !!benefits.offer_formula && 'positioning' in benefits && !('objections_page' in (benefits.segment || {})));
    check('writer-inputs: факты среза несут label и angle, если они есть в брифе', (benefits.facts || []).every(f => { const bf = okBriefHome.facts.find(x => x.id === f.id) || {}; return (!bf.label || f.label === bf.label) && (!bf.angle || f.angle === bf.angle); }));
    check('writer-inputs: ссылки карты только блокам с кнопкой, карточкой или ссылкой', Array.isArray(hero.links) && Array.isArray(benefits.links) && !('links' in proc), `hero ${!!hero.links}, benefits ${!!benefits.links}, process ${'links' in proc}`);
    check('writer-inputs: один пример конкурента на блок', (hero.block?.examples || []).length === 1);
    check('writer-inputs: page_outline - все блоки страницы', (proc.page_outline || []).length === 5);
    // ручная пересборка: лишний срез удаляется, недостающий появляется
    wj(SW('pages', 'home', 'brief', 'B09-old.json'), { stale: true });
    fs.rmSync(SW('pages', 'home', 'brief', 'B02-benefits.json'));
    const wi = run(S, ['scripts/writer-inputs.mjs', 'home']);
    check('writer-inputs CLI: код 0, срезов 5', wi.code === 0 && /срезов брифа: 5 на 1 стр\., ошибок: 0/.test(wi.out), wi.out);
    check('writer-inputs CLI: срез выпавшего блока удален, недостающий восстановлен', !fs.existsSync(SW('pages', 'home', 'brief', 'B09-old.json')) && fs.existsSync(SW('pages', 'home', 'brief', 'B02-benefits.json')));
    // ссылка на непубликуемый факт (F06, publish: no) - строка проблемы и код 1, в бриф факт не идет
    st.pages['okna-rehau'].block_overrides.hero = { task: 'Старую цену F06 не называй.' };
    wj(SW('strategy.json'), st);
    const bad = run(S, ['scripts/build-briefs.mjs', '--force', 'okna-rehau']);
    check('build-briefs: ссылка на непубликуемый F06 - код 1 и строка проблемы', bad.code === 1 && /okna-rehau: задание блока ссылается на F06, которого нет среди публикуемых фактов/.test(bad.out), bad.out);
    const okBrief2 = rj(SW('pages', 'okna-rehau', 'brief.json'));
    check('build-briefs: F06 не попал ни в факты страницы, ни в факты блоков', !okBrief2.facts.some(f => f.id === 'F06') && !okBrief2.blocks.some(b => b.facts.includes('F06')));
    const noBrief = run(S, ['scripts/build-briefs.mjs', 'okna-rehau']);
    check('build-briefs: без --force бриф не пересобирается, срезы обновляются', noBrief.code === 0 && /собрано: 0, пропущено \(уже есть\): 1, срезов для писателей: 3/.test(noBrief.out), noBrief.out);
  }

  // ================================================================== 2. blind-prep
  {
    const bp = run(S, ['scripts/blind-prep.mjs', 'home']);
    check('blind-prep: код 0', bp.code === 0, bp.out);
    check('blind-prep: печатает портрет сегмента', /ПОРТРЕТ СЕГМЕНТА:\nСемья в новостройке\. Пара 30-40 лет/.test(bp.stdout), bp.stdout);
    check('blind-prep: первый экран конкурента дословно, без why_strong и домена', /1\. Пластиковые окна в Туле от производителя/.test(bp.stdout) && !/есть срок, нет выгоды|example-okna\.ru/.test(bp.stdout), bp.stdout);
    check('blind-prep: блоков 3 из 5', /blind-view\.md \(блоков 3 из 5\)/.test(bp.stdout), bp.stdout);
    const view = fs.readFileSync(SW('audit', 'home', 'blind-view.md'), 'utf8');
    check('blind-prep: текст страницы с block_id, H1 и кнопкой', view.includes('## B01-hero') && view.includes('# Окна, из которых не дует') && view.includes('[кнопка: Получить расчет окна]') && view.includes('**Замер на следующий день**'), view.slice(0, 300));
    const brief = rj(SW('pages', 'home', 'brief.json'));
    const service = [brief.unique_argument, brief.segment.name, brief.hook, 'Куда я попал и что мне здесь дадут', 'Почему я должен верить именно вам', 'Первый экран', 'conversion', 'summary', 'handoff', 'Гарантия 5 лет и ГОСТ уже названы цифрами'];
    const leaked = service.filter(s => view.includes(s));
    check('blind-prep: в тексте нет служебных строк (аргумент, сегмент, вопросы читателя, роли, summary)', !leaked.length, leaked.join(' | '));
    check('blind-prep: без slug - код 2, неизвестная страница - код 2', run(S, ['scripts/blind-prep.mjs']).code === 2 && run(S, ['scripts/blind-prep.mjs', 'nope']).code === 2);
    wj(SW('pages', 'empty-page', 'brief.json'), { slug: 'empty-page', segment: {}, blocks: [{ block_id: 'B01-hero', role: 'hero' }] });
    check('blind-prep: бриф без написанных блоков - код 1', run(S, ['scripts/blind-prep.mjs', 'empty-page']).code === 1);
    fs.rmSync(SW('pages', 'empty-page'), { recursive: true });
  }

  // ================================================================== 3. page-state
  {
    const ps = run(S, ['scripts/page-state.mjs', 'home']);
    check('page-state: код 0, готово 3/5, следующий B04', ps.code === 0 && /готово блоков 3\/5, следующий: B04-not-promise/.test(ps.out), ps.out);
    const state = rj(SW('pages', 'home', 'state.json'));
    const ws = rj(SW('pages', 'home', 'state.writer.json'));
    checkSchema('page-state: state.json', 'state', state);
    checkSchema('page-state: state.writer.json', 'state-writer', ws);
    check('page-state: last_block - последний написанный (B03-process)', ws.last_block.block_id === 'B03-process' && state.last_block.block_id === 'B03-process', JSON.stringify(ws.last_block).slice(0, 200));
    check('page-state: текст last_block построчно, с handoff_note', Array.isArray(ws.last_block.text) && ws.last_block.text.includes('Что будет после заявки') && /Процесс закрыт/.test(ws.last_block.handoff_note));
    check('page-state: blocks_done 3/5, facts_used - карта факт -> блоки', ws.blocks_done === '3/5' && canon(ws.facts_used.F03) === canon(['B01-hero', 'B03-process']), JSON.stringify(ws.facts_used));
    check('page-state: строки про факты только в полном state', state.do_not_repeat.some(s => /^факт F0/.test(s)) && !ws.do_not_repeat.some(s => /^факт F0/.test(s)));
    // следующий блок написан -> last_block сдвигается
    wj(SW('pages', 'home', 'blocks', 'B04-not-promise.json'), { block_id: 'B04-not-promise', type: 'not-promise', role: 'conversion', elements: [{ kind: 'h2', text: 'Где граница нашей работы', facts: [] }, { kind: 'bullets', items: ['Смету считают только после замера', 'Сроки поставки профиля зависят от завода'], facts: [] }], facts_used: [], objections_closed: [], summary: 'Границы работы', handoff_note: 'Дальше финальный призыв' });
    const ps2 = run(S, ['scripts/page-state.mjs', 'home']);
    const ws2 = rj(SW('pages', 'home', 'state.writer.json'));
    check('page-state: после B04 - last_block B04, 4/5, следующий B05', ps2.code === 0 && ws2.last_block.block_id === 'B04-not-promise' && ws2.blocks_done === '4/5' && /следующий: B05-cta/.test(ps2.out), ps2.out);
    fs.rmSync(SW('pages', 'home', 'blocks', 'B04-not-promise.json'));
    // устаревшие срезы брифа пересобираются
    const bf = SW('pages', 'home', 'brief.json');
    fs.writeFileSync(bf, JSON.stringify(rj(bf), null, 1) + '\n');
    const ps3 = run(S, ['scripts/page-state.mjs', 'home']);
    check('page-state: бриф изменился - срезы брифа rebuilt', ps3.code === 0 && /срезы брифа: rebuilt/.test(ps3.out) && rj(SW('pages', 'home', 'brief', 'B01-hero.json'))._brief_sha1 === sha1(fs.readFileSync(bf, 'utf8')), ps3.out);
    check('page-state: last_block снова B03 после удаления B04', rj(SW('pages', 'home', 'state.writer.json')).last_block.block_id === 'B03-process');
    check('page-state: без slug - код 2', run(S, ['scripts/page-state.mjs']).code === 2);
  }

  // ================================================================== 4. plan-run
  {
    const mode = (r, slug) => (r.json?.pages || []).find(p => p.slug === slug)?.hero_mode;
    const def = runJson(S, ['scripts/plan-run.mjs']);
    check('plan-run: по умолчанию home - tournament, category - single', def.code === 0 && mode(def, 'home') === 'tournament' && mode(def, 'okna-rehau') === 'single', def.out.slice(0, 300));
    check('plan-run: hero by-type со списком типов турнира', def.json?.hero?.mode === 'by-type' && canon(def.json.hero.tournament_types) === canon(['home', 'hub', 'service']));
    check('plan-run: фаза write - без sample, срезы ok', !!def.json && !('sample' in def.json) && def.json.pages.every(p => p.slices === 'ok'), JSON.stringify(def.json?.pages?.map(p => p.slices)));
    const single = runJson(S, ['scripts/plan-run.mjs', '--hero', 'single']);
    check('plan-run: --hero single - все single, tournament_types пуст', mode(single, 'home') === 'single' && mode(single, 'okna-rehau') === 'single' && single.json.hero.mode === 'single' && single.json.hero.tournament_types.length === 0);
    const tour = runJson(S, ['scripts/plan-run.mjs', '--hero', 'tournament']);
    check('plan-run: --hero tournament - все tournament', mode(tour, 'home') === 'tournament' && mode(tour, 'okna-rehau') === 'tournament');
    const tt = runJson(S, ['scripts/plan-run.mjs', '--tournament-types', 'category']);
    check('plan-run: --tournament-types category - home single, category tournament', mode(tt, 'home') === 'single' && mode(tt, 'okna-rehau') === 'tournament');
    const none = runJson(S, ['scripts/plan-run.mjs', '--tournament-types', '']);
    check('plan-run: --tournament-types пустой - все single', mode(none, 'home') === 'single' && mode(none, 'okna-rehau') === 'single');
    check('plan-run: --hero с чужим значением - код 2', run(S, ['scripts/plan-run.mjs', '--hero', 'triple']).code === 2);
    check('plan-run: hero_block_id и block_roles из брифа', def.json?.pages?.[0]?.hero_block_id === 'B01-hero' && def.json.pages[0].block_roles['B02-benefits'] === 'conversion');
    const au = runJson(S, ['scripts/plan-run.mjs', '--phase', 'audit']);
    check('plan-run: --phase audit на недописанных страницах - pages и sample пусты', au.code === 0 && au.json?.pages?.length === 0 && Array.isArray(au.json?.sample) && au.json.sample.length === 0, au.out.slice(0, 300));

    // синтетическая карта: выборка по типам в порядке карты, только дописанные страницы
    const A = mkProject('plan');
    const pages = [['home', 'home'], ['c3', 'category'], ['c2', 'category'], ['s1', 'service'], ['c1', 'category'], ['x', 'info_other', 'skip']];
    wj(path.join(A, 'work', 'sitemap.json'), { pages: pages.map(([slug, type, status], i) => ({ slug, url: i ? `/${slug}` : '/', type, subject: slug, level: i ? 1 : 0, status: status || 'briefed', wave: 1 })) });
    for (const [slug, , status] of pages) {
      if (status) continue;
      const dir = path.join(A, 'work', 'pages', slug);
      wj(path.join(dir, 'brief.json'), { slug, blocks: [{ block_id: 'B01-hero', role: 'hero' }, { block_id: 'B02-text', role: 'conversion' }] });
      for (const id of ['B01-hero', 'B02-text']) {
        wj(path.join(dir, 'blocks', `${id}.json`), { block_id: id, elements: [] });
        wj(path.join(A, 'work', 'audit', slug, `lint-${id}.json`), { verdict: slug === 'c3' && id === 'B02-text' ? 'fix' : 'pass', findings: [] });
      }
    }
    const pa = runJson(A, ['scripts/plan-run.mjs', '--phase', 'audit']);
    check('plan-run audit: pages - только дописанные, в порядке карты', pa.code === 0 && canon(pa.json?.pages?.map(p => p.slug)) === canon(['home', 'c2', 's1', 'c1']), pa.out.slice(0, 400));
    check('plan-run audit: sample - первая дописанная страница каждого типа', canon(pa.json?.sample) === canon(['home', 'c2', 's1']), JSON.stringify(pa.json?.sample));
    check('plan-run audit: hero_done у дописанных', pa.json?.pages?.every(p => p.hero_done));
    const p2 = runJson(A, ['scripts/plan-run.mjs', '--phase', 'audit', '--sample-per-type', '2']);
    check('plan-run audit: --sample-per-type 2', canon(p2.json?.sample) === canon(['home', 'c2', 's1', 'c1']), JSON.stringify(p2.json?.sample));
    const p0 = runJson(A, ['scripts/plan-run.mjs', '--phase', 'audit', '--sample-per-type', '0']);
    check('plan-run audit: --sample-per-type 0 - пустая выборка', Array.isArray(p0.json?.sample) && p0.json.sample.length === 0);
    const pt = runJson(A, ['scripts/plan-run.mjs', '--phase', 'audit', '--types', 'category']);
    check('plan-run audit: --types category - sample из отобранных', canon(pt.json?.sample) === canon(['c2']) && pt.json.pages.length === 2, JSON.stringify(pt.json?.sample));
    check('plan-run audit: --sample-per-type -1 и abc - код 2', run(A, ['scripts/plan-run.mjs', '--phase', 'audit', '--sample-per-type', '-1']).code === 2 && run(A, ['scripts/plan-run.mjs', '--phase', 'audit', '--sample-per-type', 'abc']).code === 2);
    const pw = runJson(A, ['scripts/plan-run.mjs']);
    const c3 = pw.json?.pages?.find(p => p.slug === 'c3');
    check('plan-run write: только недописанная c3, блок с lint fix - в pending и lint_dirty', pw.json?.pages?.length === 1 && !!c3 && canon(c3.pending_blocks) === canon(['B02-text']) && canon(c3.lint_dirty) === canon(['B02-text']) && c3.hero_done, pw.out.slice(0, 400));
    const pwave = runJson(A, ['scripts/plan-run.mjs', '--phase', 'audit', '--wave', '2']);
    check('plan-run audit: --wave без страниц - пусто', pwave.json?.pages?.length === 0 && pwave.json.sample.length === 0);
  }

  // ================================================================== 5. merge-strategy
  {
    // старый strategy.json с записями страницы со status skip (privacy) и slug вне карты: при --split остаются только в нем
    { const st = rj(SW('strategy.json')); st.pages.privacy = { ...st.pages['okna-rehau'] }; st.pages['old-page'] = { ...st.pages['okna-rehau'] }; wj(SW('strategy.json'), st); }
    const orig = rj(SW('strategy.json'));
    const live = { ...orig, pages: { home: orig.pages.home, 'okna-rehau': orig.pages['okna-rehau'] } };
    const sp = run(S, ['scripts/merge-strategy.mjs', '--split']);
    check('merge-strategy --split: код 0, файлов 2', sp.code === 0 && /разрезано: файлов 2, оставлено как есть 0/.test(sp.out), sp.out);
    check('merge-strategy --split: запись skip-страницы и slug вне карты - не в файлах типов', /status skip \(остаются только в strategy\.json\): privacy, old-page/.test(sp.out) && !fs.existsSync(SW('strategy.pages', 'info_other.json')), sp.out);
    const home = rj(SW('strategy.pages', 'home.json')), cat = rj(SW('strategy.pages', 'category.json'));
    check('merge-strategy --split: файл типа {type, pages} с записями своего типа', home.type === 'home' && Object.keys(home.pages).join() === 'home' && cat.type === 'category' && Object.keys(cat.pages).join() === 'okna-rehau');
    const sp2 = run(S, ['scripts/merge-strategy.mjs', '--split']);
    check('merge-strategy --split повторно без --force не перезаписывает', sp2.code === 0 && /оставлено как есть 2/.test(sp2.out), sp2.out);
    const ck = run(S, ['scripts/merge-strategy.mjs', '--check', 'work/strategy.pages/home.json', 'work/strategy.pages/category.json']);
    check('merge-strategy --check: оба файла OK', ck.code === 0 && (ck.out.match(/^OK /gm) || []).length === 2, ck.out);
    const m1 = run(S, ['scripts/merge-strategy.mjs']);
    check('merge-strategy: сборка поверх прежнего - код 0, заменено 2', m1.code === 0 && /заменено 2, новых 0/.test(m1.out), m1.out);
    check('merge-strategy: split + сборка - тот же strategy.json по содержанию', canon(rj(SW('strategy.json'))) === canon(orig));
    wj(SW('strategy.json'), { ...orig, pages: {} });
    const m2 = run(S, ['scripts/merge-strategy.mjs']);
    const re = rj(SW('strategy.json'));
    check('merge-strategy: сборка с пустыми pages - те же записи живых страниц, порядок карты', m2.code === 0 && canon(re) === canon(live) && Object.keys(re.pages).join() === 'home,okna-rehau', m2.out);
    checkSchema('merge-strategy: strategy.json', 'strategy', re);
    // проблемные файлы типов
    const entry = orig.pages.home;
    wj(SW('strategy.pages', 'service.json'), { type: 'service', pages: { ghost: entry } });
    wj(SW('strategy.pages', 'hub.json'), { type: 'hub', pages: { home: entry } });
    wj(SW('strategy.pages', 'info_about.json'), { type: 'other', pages: {} });
    const badCat = { type: 'category', pages: { 'okna-rehau': { ...orig.pages['okna-rehau'], unique_argument: 'коротко' } } };
    wj(SW('strategy.pages', 'category.json'), badCat);
    const ck2 = run(S, ['scripts/merge-strategy.mjs', '--check', 'work/strategy.pages/service.json', 'work/strategy.pages/hub.json', 'work/strategy.pages/info_about.json', 'work/strategy.pages/category.json', 'work/strategy.pages/nope.json']);
    check('merge-strategy --check: slug нет в карте', /pages\.ghost: slug нет в карте/.test(ck2.out), ck2.out);
    check('merge-strategy --check: тип файла не совпадает с картой', /pages\.home: в карте тип home, а файл типа hub/.test(ck2.out), ck2.out);
    check('merge-strategy --check: поле type не совпадает с именем файла', /type="other" не совпадает с именем файла/.test(ck2.out), ck2.out);
    check('merge-strategy --check: ошибка схемы записи', /pages.okna-rehau.unique_argument: короче 10/.test(ck2.out), ck2.out);
    check('merge-strategy --check: нет файла - FAIL, код 1', /FAIL work\/strategy\.pages\/nope\.json: нет файла/.test(ck2.out) && ck2.code === 1, ck2.out);
    wj(SW('strategy.pages', 'category.json'), { type: 'category', pages: {} });
    const ck3 = run(S, ['scripts/merge-strategy.mjs', '--check', 'work/strategy.pages/category.json']);
    check('merge-strategy --check: страница типа без записи', ck3.code === 1 && /нет записей для страниц типа category: okna-rehau/.test(ck3.out), ck3.out);
    wj(SW('strategy.pages', 'category.json'), badCat);
    const m3 = run(S, ['scripts/merge-strategy.mjs']);
    const re3 = rj(SW('strategy.json'));
    check('merge-strategy: с плохими файлами - код 1, валидные записи собраны, плохие не попали', m3.code === 1 && canon(re3.pages.home) === canon(orig.pages.home) && re3.pages['okna-rehau'].unique_argument === orig.pages['okna-rehau'].unique_argument && !re3.pages.ghost, m3.out);
    for (const t of ['service', 'hub', 'info_about']) fs.rmSync(SW('strategy.pages', `${t}.json`));
    wj(SW('strategy.pages', 'category.json'), cat);
    check('merge-strategy --check без файлов - код 2', run(S, ['scripts/merge-strategy.mjs', '--check']).code === 2);
    fs.renameSync(SW('strategy.json'), SW('strategy.json.bak'));
    check('merge-strategy: нет strategy.json - код 2', run(S, ['scripts/merge-strategy.mjs']).code === 2);
    fs.renameSync(SW('strategy.json.bak'), SW('strategy.json'));
  }

  // ================================================================== 6. prep-args
  {
    const pa = runJson(S, ['scripts/prep-args.mjs']);
    check('prep-args: фикстуры - types и type_pages', pa.code === 0 && canon(pa.json) === canon({ types: ['home', 'category'], type_pages: { home: 1, category: 1 } }) && pa.json.types.join() === 'home,category', pa.out);
    check('prep-args: фикстуры - category мелкий тип', /мелкие \(<= 2, кроме home\): category$/m.test(pa.stderr), pa.stderr);
    const Q = mkProject('prep');
    const map = [['home', 'home'], ['c1', 'category'], ['s1', 'service'], ['c2', 'category'], ['about', 'info_about'], ['c3', 'category'], ['s2', 'service'], ['policy', 'info_other', 'skip']];
    wj(path.join(Q, 'work', 'sitemap.json'), { pages: map.map(([slug, type, status]) => ({ slug, url: `/${slug}`, type, subject: slug, level: 1, status: status || 'planned' })) });
    const small = r => (r.stderr.match(/мелкие \([^)]*\): (.*)$/m) || [])[1];
    const q0 = runJson(Q, ['scripts/prep-args.mjs']);
    check('prep-args: типы в порядке карты без skip', q0.json?.types.join() === 'home,category,service,info_about' && canon(q0.json.type_pages) === canon({ home: 1, category: 3, service: 2, info_about: 1 }), q0.out);
    check('prep-args: мелкие по умолчанию - service, info_about (home в solo)', small(q0) === 'service, info_about', q0.stderr);
    check('prep-args: --small-max 3', small(runJson(Q, ['scripts/prep-args.mjs', '--small-max', '3'])) === 'category, service, info_about');
    check('prep-args: --solo home,service', small(runJson(Q, ['scripts/prep-args.mjs', '--solo', 'home,service'])) === 'info_about');
    check('prep-args: --solo пустой - home тоже мелкий', small(runJson(Q, ['scripts/prep-args.mjs', '--solo', ''])) === 'home, service, info_about');
    const qt = runJson(Q, ['scripts/prep-args.mjs', '--types', 'category,info_faq']);
    check('prep-args: --types с типом без страниц - 0 и предупреждение', canon(qt.json) === canon({ types: ['category', 'info_faq'], type_pages: { category: 3, info_faq: 0 } }) && /тип info_faq: в карте нет страниц/.test(qt.stderr), qt.out);
    check('prep-args: --snapshots без competitors.json - код 2', run(Q, ['scripts/prep-args.mjs', '--snapshots']).code === 2);
    const raw = f => `work/competitors/raw/${f}`;
    wj(path.join(Q, 'work', 'competitors', 'competitors.json'), { competitors: [
      { domain: 'a.example', status: 'ok', pages: [
        { type: 'home', url: 'https://a.example/', raw: raw('a.example/home.json'), status: 'ok' },
        { type: 'category', url: 'https://a.example/c', raw: raw('a.example/cat.json'), status: 'browser' },
        { type: 'category', url: 'https://a.example/m', raw: raw('a.example/missing.json'), status: 'ok' },
        { type: 'service', url: 'https://a.example/s', raw: raw('a.example/s.json'), status: 'antibot' } ] },
      { domain: 'b.example', status: 'rejected', pages: [{ type: 'home', url: 'https://b.example/', raw: raw('b.example/home.json'), status: 'ok' }] } ] });
    for (const f of ['a.example/home.json', 'a.example/cat.json', 'a.example/s.json', 'b.example/home.json']) wj(path.join(Q, raw(f)), {});
    const qs = runJson(Q, ['scripts/prep-args.mjs', '--snapshots']);
    check('prep-args --snapshots: ok и browser с файлом, без antibot, чужого статуса и пропавшего файла', qs.code === 0 && qs.json?.snapshots?.length === 2 && /без файла: 1/.test(qs.stderr) && qs.json.snapshots.every(s => s.domain === 'a.example'), qs.out);
    check('prep-args --snapshot-types home', runJson(Q, ['scripts/prep-args.mjs', '--snapshots', '--snapshot-types', 'home']).json?.snapshots?.length === 1);
    check('prep-args --domains b.example (конкурент не ok) - 0', runJson(Q, ['scripts/prep-args.mjs', '--snapshots', '--domains', 'b.example']).json?.snapshots?.length === 0);
  }

  // ================================================================== 7. dedup + cross-digest
  {
    const noDd = run(S, ['scripts/cross-digest.mjs']);
    check('cross-digest: без dedup.json - код 2', noDd.code === 2, noDd.out);
    const dd = run(S, ['scripts/dedup.mjs']);
    const ddj = rj(SW('audit', 'dedup.json'));
    check('dedup: фикстуры - находок 0, пар 0, гео-групп 0', dd.code === 0 && ddj.findings.length === 0 && ddj.pairs.length === 0 && ddj.geo_groups.length === 0, dd.out);
    checkSchema('dedup: dedup.json', 'findings', ddj);
    const cd = run(S, ['scripts/cross-digest.mjs']);
    const cdj = rj(SW('audit', 'cross-digest.json'));
    check('cross-digest: фикстуры - пар 0, гео-групп 0, код 0', cd.code === 0 && cdj.counts.pairs_total === 0 && cdj.counts.geo_groups === 0, cd.out);
  }
  // синтетическая карта с гео-близнецами: один тип и родитель, разный geo
  const G = mkProject('geo');
  const GW = (...p) => path.join(G, 'work', ...p);
  {
    const pg = (slug, url, type, parent, geo, level = 1) => ({ slug, url, type, subject: `Окна ${slug}`, parent, level, geo, status: 'briefed' });
    wj(GW('sitemap.json'), { pages: [
      pg('home', '/', 'home', '', '', 0),
      pg('okna-ryazan', '/okna/ryazan', 'category', '/okna', 'Рязань'),
      pg('okna-kaluga', '/okna/kaluga', 'category', '/okna/', 'Калуга'),
      pg('okna-smolensk', '/okna/smolensk', 'category', '/okna', 'Смоленск'),
      pg('dveri-ryazan', '/dveri/ryazan', 'category', '/dveri', 'Рязань'),
      pg('montazh-ryazan', '/okna/montazh', 'service', '/okna', 'Рязань'),
      pg('okna-ryazan-2', '/okna/ryazan-2', 'category', '/okna', 'рязань'),
    ] });
    wj(GW('facts.json'), { source: 'синтетика', facts: [
      { id: 'F01', label: 'шоурум', value: 'шоурум в Рязани', wording: 'Шоурум и склад профиля в Рязани', publish: 'yes', source_quote: '[бриф] шоурум в Рязани', kind: 'geo', geo: 'Рязань' },
      { id: 'F02', label: 'бригада', value: 'своя бригада в Калуге', wording: 'Своя бригада монтажа в Калуге', publish: 'yes', source_quote: '[бриф] бригада в Калуге', kind: 'geo', geo: 'Калуга' },
      { id: 'F03', label: 'гарантия', value: '5 лет', wording: 'Гарантия 5 лет на монтаж', publish: 'yes', source_quote: '[бриф] гарантия 5 лет', kind: 'legal' },
    ], anti_promises: [], terminology: { use: [], jargon: [], untranslatable: [] }, company: { status: 'missing' }, gaps: [] });
    const page = (slug, h1, sub, text, factsUsed) => {
      const dir = GW('pages', slug);
      wj(path.join(dir, 'brief.json'), { slug, segment: { id: 'S1', name: 'Семья' }, unique_argument: `аргумент ${slug}`, cta: { main: 'Вызвать замерщика' }, facts: [], terminology: { use: [] },
        blocks: [{ block_id: 'B01-hero', type: 'hero', role: 'hero' }, { block_id: 'B02-benefits', type: 'benefits', role: 'conversion' }] });
      wj(path.join(dir, 'blocks', 'B01-hero.json'), { block_id: 'B01-hero', elements: [{ kind: 'h1', text: h1 }, { kind: 'sub', text: sub }], facts_used: [], summary: 'первый экран' });
      wj(path.join(dir, 'blocks', 'B02-benefits.json'), { block_id: 'B02-benefits', elements: [{ kind: 'h2', text: 'Почему выбирают' }, { kind: 'text', text }], facts_used: factsUsed, summary: 'доводы' });
    };
    page('home', 'Пластиковые окна с монтажом по стандарту', 'Производство профиля и монтаж для квартир и частных домов', 'Замер бесплатно, смета фиксируется в договоре до начала работ.', ['F03']);
    page('okna-ryazan', 'Окна для квартир в Рязани', 'Шоурум рядом с центром, образцы профиля можно потрогать руками', 'Образцы профиля стоят в шоуруме, склад в том же здании, доставка по городу в день заказа.', ['F01', 'F03']);
    page('okna-kaluga', 'Окна для частных домов в Калуге', 'Своя бригада приезжает в любой район области без субподрядчиков', 'Монтаж ведет своя бригада, шоурум с образцами тоже доступен для поездки на выходных.', ['F01', 'F02']);
    const dd = run(G, ['scripts/dedup.mjs']);
    const ddj = rj(GW('audit', 'dedup.json'));
    const twins = ddj.pairs.filter(p => p.reasons.includes('geo-twin'));
    const key = p => `${p.a}~${p.b}`;
    check('dedup гео: код 0, одна группа category /okna (слеш на конце родителя не мешает)', dd.code === 0 && ddj.geo_groups.length === 1 && ddj.geo_groups[0].type === 'category' && ddj.geo_groups[0].parent === '/okna', JSON.stringify(ddj.geo_groups));
    check('dedup гео: в группе все 4 страницы category /okna', canon(ddj.geo_groups[0]?.pages.map(p => p.slug).sort()) === canon(['okna-kaluga', 'okna-ryazan', 'okna-ryazan-2', 'okna-smolensk']));
    check('dedup гео: пары-близнецы с разным geo, без пары одного geo в другом регистре', canon(twins.map(key).sort()) === canon(['okna-kaluga~okna-ryazan', 'okna-kaluga~okna-ryazan-2', 'okna-kaluga~okna-smolensk', 'okna-ryazan-2~okna-smolensk', 'okna-ryazan~okna-smolensk']), twins.map(key).join(', '));
    check('dedup гео: другой тип или другой родитель - не близнецы', !twins.some(p => /dveri|montazh/.test(key(p))));
    check('dedup гео: у пары тип и родитель', twins.every(p => p.type === 'category' && p.parent === '/okna'));
    check('dedup гео: сводка пар', /гео-близнецы 5 \(групп 1\)/.test(ddj.pairs_summary) && /гео-близнецы 5/.test(dd.out), ddj.pairs_summary);
    checkSchema('dedup гео: dedup.json', 'findings', ddj);
    const cd = run(G, ['scripts/cross-digest.mjs']);
    const cdj = rj(GW('audit', 'cross-digest.json'));
    check('cross-digest гео: код 0, к суду 1 пара, ждут текстов 4', cd.code === 0 && cdj.counts.pairs_to_judge === 1 && cdj.pairs[0].a === 'okna-kaluga' && cdj.pairs[0].b === 'okna-ryazan' && cdj.counts.pending_pairs === 4, JSON.stringify(cdj.counts));
    check('cross-digest гео: группа 1, страниц 4, написано 2', cdj.counts.geo_groups === 1 && cdj.counts.geo_pages === 4 && cdj.counts.geo_pages_written === 2, JSON.stringify(cdj.counts));
    const ry = cdj.pages['okna-ryazan'], kg = cdj.pages['okna-kaluga'];
    check('cross-digest гео: соседи Рязани - Калуга и Смоленск', !!ry?.geo_check && canon([...ry.geo_check.neighbors].sort()) === canon(['Калуга', 'Смоленск']), JSON.stringify(ry?.geo_check));
    check('cross-digest гео: свой гео-факт Рязани F01 использован и помечен в блоке', ry?.geo_check.own_facts.some(f => f.id === 'F01' && f.used) && canon(ry.geo_check.blocks_with_own_facts) === canon(['B02-benefits']), JSON.stringify(ry?.geo_check));
    check('cross-digest гео: утечка - рязанский F01 на странице Калуги', cdj.counts.geo_leaks === 1 && cdj.geo_leaks[0].slug === 'okna-kaluga' && cdj.geo_leaks[0].fact === 'F01' && canon(cdj.geo_leaks[0].blocks) === canon(['B02-benefits']), JSON.stringify(cdj.geo_leaks));
    check('cross-digest гео: блок первого экрана Калуги называет гео', kg?.blocks.find(b => b.id === 'B01-hero')?.geo_named === true, JSON.stringify(kg?.blocks));
    check('cross-digest гео: в выжимке только страницы из пар и групп', canon(Object.keys(cdj.pages).sort()) === canon(['okna-kaluga', 'okna-ryazan']), Object.keys(cdj.pages).join(', '));
  }

  // ================================================================== 8. split-cross
  {
    const REP = GW('audit', 'cross.json');
    const f = (id, page, severity, extra = {}) => ({ ...(id ? { id } : {}), ...(page ? { page } : {}), block_id: 'B01-hero', severity, category: 'repeat', rule: 'cross.geo-swap', problem: `подмена гео: ${page || '-'}`, ...extra });
    wj(REP, { scope: 'all-pages', producer: 'cross-judge', round: 1, created_at: '2026-09-23 10:00', verdict: 'blocked', findings: [
      f('', 'okna-ryazan', 'major', { status: 'open' }),
      f('cj-2', 'okna-kaluga', 'blocker'),
      f('cj-3', 'okna-kaluga', 'minor', { needs_fact: true }),
      f('cj-4', '', 'major'),
    ] });
    // копия от прежнего отчета (удаляется) и чужой файл без split_from (не трогается)
    wj(GW('audit', 'old-page', 'cross.json'), { scope: 'old-page', producer: 'cross-judge', split_from: 'work/audit/cross.json', source_created_at: '2026-09-01 10:00', findings: [], verdict: 'pass' });
    wj(GW('audit', 'manual', 'cross.json'), { scope: 'manual', producer: 'cross-judge', findings: [], verdict: 'pass' });
    const s1 = run(G, ['scripts/split-cross.mjs']);
    const cross = rj(REP);
    check('split-cross: код 0, страниц 2, без page 1, присвоен id 1', s1.code === 0 && /страниц 2, находок 3, без page 1/.test(s1.out) && /присвоено id 1/.test(s1.out), s1.out);
    check('split-cross: находке без id присвоен id в общем файле', cross.findings[0].id === 'cross-judge-001');
    const ry = rj(GW('audit', 'okna-ryazan', 'cross.json')), kg = rj(GW('audit', 'okna-kaluga', 'cross.json'));
    check('split-cross: раскладка по страницам', ry.findings.map(x => x.id).join() === 'cross-judge-001' && kg.findings.map(x => x.id).join() === 'cj-2,cj-3', `${ry.findings.map(x => x.id)} | ${kg.findings.map(x => x.id)}`);
    check('split-cross: вердикты копий и метки split_from', ry.verdict === 'fix' && kg.verdict === 'blocked' && ry.split_from === 'work/audit/cross.json' && kg.source_created_at === '2026-09-23 10:00');
    checkSchema('split-cross: копия okna-kaluga', 'findings', kg);
    check('split-cross: статус open по умолчанию, needs_fact сохранен', kg.findings.every(x => x.status === 'open') && kg.findings[1].needs_fact === true);
    check('split-cross: печатает «к фиксеру» без minor и needs_fact', /okna-kaluga: blocker 1, major 0, minor 1, к фиксеру 1/.test(s1.out), s1.out);
    check('split-cross: копия прежнего отчета удалена, чужой файл на месте', !fs.existsSync(GW('audit', 'old-page', 'cross.json')) && fs.existsSync(GW('audit', 'manual', 'cross.json')));
    // фиксер правит статус в своей копии; повторная раскладка того же отчета статус сохраняет
    kg.findings[0].status = 'fixed'; kg.findings[0].resolution = 'первый экран переписан под Калугу';
    kg.findings[1].status = 'wontfix'; kg.findings[1].resolution = 'нет факта: адрес бригады';
    wj(GW('audit', 'okna-kaluga', 'cross.json'), kg);
    const s2 = run(G, ['scripts/split-cross.mjs']);
    const kg2 = rj(GW('audit', 'okna-kaluga', 'cross.json'));
    check('split-cross: повторная раскладка сохраняет статусы и resolution фиксера', s2.code === 0 && kg2.findings[0].status === 'fixed' && kg2.findings[0].resolution === 'первый экран переписан под Калугу' && kg2.findings[1].status === 'wontfix', JSON.stringify(kg2.findings));
    const mg = run(G, ['scripts/split-cross.mjs', '--merge']);
    const merged = rj(REP);
    const byId = Object.fromEntries(merged.findings.map(x => [x.id, x]));
    check('split-cross --merge: статусы и resolution в общем файле', mg.code === 0 && /обновлено статусов 2/.test(mg.out) && byId['cj-2'].status === 'fixed' && byId['cj-2'].resolution === 'первый экран переписан под Калугу' && byId['cj-3'].status === 'wontfix', mg.out);
    check('split-cross --merge: находка без page не тронута', !byId['cj-4'].status);
    const mg2 = run(G, ['scripts/split-cross.mjs', '--merge']);
    check('split-cross --merge повторно - обновлено 0', mg2.code === 0 && /обновлено статусов 0/.test(mg2.out), mg2.out);
    checkSchema('split-cross --merge: общий cross.json', 'findings', merged);

    // retro-stats: постраничные копии (split_from) не удваивают счет
    const rs = run(G, ['scripts/retro-stats.mjs']);
    const stats = rj(GW('audit', 'retro-stats.json'));
    check('retro-stats: код 0 на данных кросса', rs.code === 0, rs.out);
    check('retro-stats: находки кросса считаются один раз (копии split_from пропущены)', stats.totals.by_producer['cross-judge'] === merged.findings.length && stats.totals.findings === merged.findings.length, JSON.stringify(stats.totals));
    const rs2 = run(G, ['scripts/retro-stats.mjs']);
    check('retro-stats: повторный запуск не считает свой выход', rs2.code === 0 && rj(GW('audit', 'retro-stats.json')).totals.findings === merged.findings.length);

    // новый отчет (другой created_at): копии прежнего удаляются, статусы не переносятся
    wj(REP, { scope: 'all-pages', producer: 'cross-judge', round: 1, created_at: '2026-09-24 10:00', verdict: 'fix', findings: [f('cj-9', 'okna-ryazan', 'major')] });
    const s3 = run(G, ['scripts/split-cross.mjs']);
    check('split-cross: новый отчет - копия страницы без находок удалена', s3.code === 0 && !fs.existsSync(GW('audit', 'okna-kaluga', 'cross.json')) && rj(GW('audit', 'okna-ryazan', 'cross.json')).findings.map(x => x.id).join() === 'cj-9', s3.out);
    fs.rmSync(REP);
    check('split-cross: нет общего файла - код 2', run(G, ['scripts/split-cross.mjs']).code === 2);
  }

  // ================================================================== 9. retro-stats: пустая и битая папка
  {
    const E = mkProject('retro-empty');
    const e1 = run(E, ['scripts/retro-stats.mjs']);
    const st = rj(path.join(E, 'work', 'audit', 'retro-stats.json'));
    check('retro-stats: нет work/audit - код 0, пустая статистика записана', e1.code === 0 && /нет JSON-отчетов/.test(e1.out) && st.totals.findings === 0 && st.files.found === 0, e1.out);
    const B = mkProject('retro-broken');
    const BA = (...p) => path.join(B, 'work', 'audit', ...p);
    wt(BA('p', 'bad.json'), '{ "findings": [ oops');
    wt(BA('p', 'nofind.json'), '{"a": 1}');
    wt(BA('p', 'empty.json'), '');
    wt(BA('p', 'bom.json'), '\uFEFF' + JSON.stringify({ producer: 'blind-reader', findings: [{ severity: 'minor', rule: 'blind.x', problem: 'непонятно', quote: 'цитата' }], verdict: 'pass' }));
    wj(BA('p', 'round-1.json'), { producer: 'page-judge', verdict: 'pass', summary: 'blocker 0, major 0, minor 0', findings: [null, 'строка', [1], { severity: 'major', rule: 'judge.flow', problem: 'обрыв логики', quote: 'Первый экран' }, { note: 'без полей находки' }] });
    wj(BA('p', 'lint-B01-hero.json'), [{ severity: 'minor', rule: 'ai.filler', quote: 'важно отметить' }]);
    const b1 = run(B, ['scripts/retro-stats.mjs']);
    const bs = rj(BA('retro-stats.json'));
    check('retro-stats: битая папка - код 0', b1.code === 0, b1.out);
    check('retro-stats: битые и пустые файлы пропущены с причиной', bs.files.skipped.length === 3 && bs.consistency.some(s => /bad\.json: пропущен - невалидный JSON/.test(s)) && bs.consistency.some(s => /nofind\.json: пропущен - нет массива findings/.test(s)), JSON.stringify(bs.files.skipped));
    check('retro-stats: из битых форм взяты только находки (3: BOM, массив, объект)', bs.totals.findings === 3 && bs.totals.by_producer['page-judge'] === 1 && bs.totals.by_producer.lint === 1 && bs.totals.by_producer['blind-reader'] === 1, JSON.stringify(bs.totals));
    check('retro-stats: сверка ловит verdict pass при серьезной и неверный summary', bs.consistency.some(s => /round-1\.json: verdict pass при 1 серьезных/.test(s)) && bs.consistency.some(s => /summary заявляет 0\/0\/0/.test(s)), JSON.stringify(bs.consistency));
    check('retro-stats: сводка не длиннее 30 строк, последняя - путь', b1.stdout.trim().split('\n').length <= 30 && /Итог: work\/audit\/retro-stats\.json$/.test(b1.stdout.trim()), b1.stdout);
  }

  // ================================================================== 10. import-project + render-analysis
  {
    const SITE = path.join(tmpRoot, 'sites', '001-okna-test');
    const project = {
      v: 2, slug: 'okna-test', updated: '2026-09-20', source: ['бриф', 'сайт'], tier: 'basic',
      gates: { promise: true, facts3: true, proof1: true, ready: true },
      business: {
        name: 'Веста Окна', what: 'Производство и монтаж пластиковых окон в квартирах и частных домах', region: 'Тула',
        geo: ['Тула', 'Новомосковск'], site: null, since: 2012, type: 'services', site_kind: 'multipage', sig: ['visit'],
        directions: [
          { id: 'okna', name: 'Пластиковые окна', marker: 'пластиковые окна', url: '/okna', serves: ['family'] },
          { id: 'okna-novomoskovsk', parent: 'okna', name: 'Окна в Новомосковске', marker: 'окна новомосковск', url: '/okna/novomoskovsk', serves: ['family', 'dacha'] },
          { id: 'balkony', name: 'Остекление балконов', marker: 'остекление балконов' },
        ],
        legal: { entity: 'ООО «Веста»', address: 'Тула, ул. Примерная, 1', phone: '+7 000 000-00-00' },
      },
      offer: {
        positioning: 'Окна с монтажом по ГОСТ для семей в новостройках',
        reasons: [{ claim: 'Монтаж по ГОСТ с трехслойным швом', proof: 'ГОСТ 30971', kind: 'документ' }, { claim: 'Бережный монтаж без пыли', kind: 'процесс' }],
        promise: { who: 'семьи в новостройках', result: 'окна, из которых не дует', how: 'монтаж по ГОСТ', proof_id: 'f02', cta: 'Вызвать замерщика' },
        limits: ['не обещаем самую низкую цену'],
        tone: 'деловой, на вы',
      },
      audience: {
        segments: [
          // O1 и O4 без поля facts (старый контракт) - эвристика; O2 - facts из контракта (f04 не публикуется,
          // f09 нет среди фактов - обе ссылки снимаются с предупреждением); O3 - facts: [] (ответ держится рассуждением)
          { id: 'family', name: 'Семья в новостройке', who: 'Пара 30-40 лет с ключами от квартиры в новостройке', dirs: ['okna'], pain: ['дует из-под подоконника', 'непонятно, за что платим в смете'], fear: ['поставят криво'], objection: [{ says: 'все равно будет дуть', answer: 'монтаж по ГОСТ 30971, работаем с 2012 года' }, { says: 'цена вырастет после замера', behind: 'обжигались на допах', answer: 'смета по замеру фиксируется в договоре', facts: ['f02', 'f04', 'f09'] }], choose: ['гарантия в договоре', 'понятная смета'] },
          { id: 'dacha', name: 'Владелец дачи', who: '', pain: ['старые деревянные окна', 'холодно зимой на веранде'], objection: [{ says: 'долго ждать замера', answer: 'замер на следующий день после заявки', facts: [] }, { says: 'грязь после монтажа', answer: 'мусор после монтажа увозим сами' }], choose: ['скорость', 'чистота'] },
        ],
        words: [{ say: 'чтобы не дуло', means: 'герметичный монтажный шов', src: 'forum' }, { say: 'теплые окна', src: 'persona' }],
      },
      competitors: { list: ['https://www.example-okna.ru/catalog', 'okna-primer.ru', 'Окна Лидер'], market: { must_have: ['hero', 'steps', 'price', 'cta_form'], gaps: ['нет гарантии на монтаж в договоре'], offers_seen: ['монтаж за 1 день'] }, seen_numbers: ['гарантия 3 года'] },
      facts: [
        // kind - вид факта из анализа (site-intake); f03 geo, хотя мост q -> kind дал бы claim: импорт берет вид анализа
        { id: 'f01', label: 'год основания', value: 'работаем с 2012 года', kind: 'number', q: ['numbers'], publish: 'yes', src: 'бриф' },
        { id: 'f02', label: 'гарантия на монтаж', value: '5 лет', kind: 'legal', q: ['docs'], publish: 'yes', src: 'бриф' },
        { id: 'f03', label: 'склад в Новомосковске', value: 'склад профиля в Новомосковске', kind: 'geo', publish: 'yes', src: 'сайт' },
        { id: 'f04', label: 'цена окна', value: 'от 9 900 руб', kind: 'number', q: ['price'], publish: 'no', src: 'сайт' },
        { id: 'f05', label: 'телефон', value: '+7 000 000-00-00', kind: 'contact', publish: 'yes', src: 'сайт' },
      ],
      constraints: { forbidden: ['под ключ'], not_selling: ['двери'], must_say: ['гарантия на монтаж в договоре'] },
      lexicon: { locked: ['монтажный шов'], translate: [{ from: 'ОП', to: 'отдел продаж' }], canonical: ['Rehau', 'vesta-okna.example'] },
      gaps: [{ id: 'g1', ask: 'цены по типам окон', hits: ['price'] }],
    };
    const projectFile = path.join(SITE, 'project.json');
    wj(projectFile, project);
    wj(path.join(SITE, 'parts', 'facts-src.json'), [
      { id: 'f01', quote: 'Работаем с 2012 года', where: 'input/brief.md: раздел о компании' },
      { id: 'f02', quote: 'гарантия на монтаж 5 лет', where: 'input/brief.md' },
    ]);
    wt(path.join(SITE, 'input', 'brief.md'), '# Бриф\n\nРаботаем с 2012 года в Туле.\n\n> Даем гарантия на монтаж\n> 5 лет по договору.\n');
    wj(path.join(SITE, 'queue.json'), { gate: { approved: true, by: 'заказчик', at: '2026-09-21' }, journal: [{ id: 'j1', kind: 'decision', subject: 'решение d1 согласовано', ground: 'созвон' }, { id: 'j2', kind: 'gap', subject: 'нет цен по типам окон' }] });
    const openQueue = path.join(SITE, 'queue-open.json');
    wj(openQueue, { gate: { approved: false }, journal: [] });
    if (fs.existsSync(ANALYSIS_SCHEMA)) {
      const e = v07(rj(ANALYSIS_SCHEMA), project);
      check('import: синтетический project.json валиден по схеме анализа site-analiz', !e.length, e.slice(0, 5).join('; '));
    } else notes.push(`пропущено: нет схемы анализа ${ANALYSIS_SCHEMA}`);

    const I = path.join(tmpRoot, 'import');
    const init = run(TPL, ['scripts/init-project.mjs', 'okna-test', I, '--project', projectFile]);
    const ia = argsLine(init.stdout);
    check('init --project: код 0, args с source project', init.code === 0 && !!ia && ia.source === 'project' && path.resolve(ia.root) === path.resolve(I) && !!ia.model && !!ia.model_light, init.out);
    const icfg = rj(path.join(I, 'config', 'project.json'));
    check('init --project: sources.mode project и абсолютный путь к project.json', icfg.sources.mode === 'project' && icfg.sources.project_json === path.resolve(projectFile), JSON.stringify(icfg.sources));
    const IW = (...p) => path.join(I, 'work', ...p);

    // без гейта - код 2, ничего не записано
    const g0 = run(I, ['scripts/import-project.mjs', '--queue', openQueue]);
    check('import: гейт не согласован - код 2', g0.code === 2 && /гейт анализа не согласован/.test(g0.stderr), g0.out);
    check('import: без гейта выходы не записаны', !fs.existsSync(IW('facts.json')) && !fs.existsSync(IW('import-report.json')));
    const g1 = run(I, ['scripts/import-project.mjs', '--queue', path.join(SITE, 'no-queue.json')]);
    check('import: нет queue.json - код 2', g1.code === 2, g1.out);
    // --allow-ungated: предупреждение и строка в gaps
    const ug = run(I, ['scripts/import-project.mjs', '--queue', openQueue, '--allow-ungated']);
    const ufacts = rj(IW('facts.json')), urep = rj(IW('import-report.json'));
    check('import --allow-ungated: код 0', ug.code === 0, ug.out);
    check('import --allow-ungated: предупреждение в отчете и в консоли', urep.gate.ungated_import === true && urep.warnings.some(w => /импорт до гейта анализа/.test(w)) && /НЕ согласован/.test(ug.out), JSON.stringify(urep.warnings));
    check('import --allow-ungated: первая строка gaps - факты не подтверждены', /^факты не подтверждены заказчиком/.test(ufacts.gaps[0] || ''), JSON.stringify(ufacts.gaps));
    check('import --allow-ungated: реквизиты from_site_unconfirmed', ufacts.company.status === 'from_site_unconfirmed');
    checkSchema('import --allow-ungated: work/facts.json', 'facts', ufacts);
    check('import --allow-ungated: гейт не в анализе', /НЕ согласован: факты не подтверждены заказчиком/.test(fs.readFileSync(path.join(I, 'inputs', 'analysis.md'), 'utf8')));

    // гейт согласован
    // структура: слеш на конце адреса снимается, страницы сверяются с направлениями по dir:<id> и по адресу
    const structFile = path.join(tmpRoot, 'structure_data.json');
    wj(structFile, { pages: [{ url: '/okna/', name: 'Пластиковые окна', section: 'dir:okna' }, { url: '/okna/novomoskovsk', name: 'Окна в Новомосковске' }, { url: '/dveri/', name: 'Двери', client_notes: 'dir:dveri' }, { url: '/', name: 'Главная' }] });
    const ok = run(I, ['scripts/import-project.mjs', '--queue', path.join(SITE, 'queue.json'), '--structure', structFile]);
    check('import: гейт согласован - код 0', ok.code === 0, ok.out);
    const facts = rj(IW('facts.json')), rep = rj(IW('import-report.json')), cfg = rj(path.join(I, 'config', 'project.json'));
    const outs = [['facts', facts], ['audience', rj(IW('audience.json'))], ['client-preferences', rj(IW('client-preferences.json'))], ['directions', rj(IW('directions.json'))], ['competitors-seed', rj(IW('competitors', 'seed.json'))], ['project-config', cfg], ['import-report', rep]];
    for (const [name, data] of outs) checkSchema(`import: выход ${name}`, name, data);
    check('import: без предупреждения о гейте и без строки «не подтверждены»', rep.gate.approved === true && !rep.warnings.some(w => /до гейта/.test(w)) && !facts.gaps.some(g => /^факты не подтверждены/.test(g)), JSON.stringify(rep.warnings));
    const F = id => facts.facts.find(f => f.id === id) || {};
    check('import: id фактов f01 -> F01, сегментов family -> S1', rep.id_map.facts.f01 === 'F01' && rep.id_map.segments.family === 'S1' && rep.id_map.segments.dacha === 'S2');
    check('import: цитата facts-src в source_quote (F01)', F('F01').source_quote === '[бриф] input/brief.md: раздел о компании: Работаем с 2012 года', F('F01').source_quote);
    check('import: цитата facts-src в source_quote (F02)', /^\[бриф\] input\/brief\.md: гарантия на монтаж 5 лет$/.test(F('F02').source_quote), F('F02').source_quote);
    check('import: без цитаты - строка «[src] label: value»', F('F03').source_quote === '[сайт] склад в Новомосковске: склад профиля в Новомосковске', F('F03').source_quote);
    check('import: цитаты найдены во входе анализа (и через перенос в «> »)', rep.counts.quotes_from_facts_src === 2 && rep.counts.quotes_verified_in_input === 2 && rep.counts.quotes_fallback === 3, JSON.stringify(rep.counts));
    check('import: kind из анализа как есть (F03 geo, не claim моста)', F('F01').kind === 'number' && F('F02').kind === 'legal' && F('F03').kind === 'geo' && F('F05').kind === 'contact', facts.facts.map(f => `${f.id}:${f.kind}`).join(' '));
    {
      // анализ без kind (контракт до site-intake v9): мост q -> kind и число с единицей
      const NK = path.join(tmpRoot, 'import-nokind');
      const pNoKind = JSON.parse(JSON.stringify(project));
      pNoKind.facts.forEach(f => { delete f.kind; });
      const nkFile = path.join(SITE, 'project-nokind.json');
      wj(nkFile, pNoKind);
      run(TPL, ['scripts/init-project.mjs', 'okna-nokind', NK, '--project', nkFile]);
      const nk = run(NK, ['scripts/import-project.mjs', '--queue', path.join(SITE, 'queue.json'), '--facts-src', path.join(SITE, 'parts', 'facts-src.json')]);
      const nf = nk.code === 0 ? rj(path.join(NK, 'work', 'facts.json')) : { facts: [] };
      const G = id => nf.facts.find(f => f.id === id) || {};
      check('import: без kind в анализе - мост q -> kind и число с единицей', nk.code === 0 && G('F01').kind === 'number' && G('F02').kind === 'legal' && G('F03').kind === 'claim' && G('F05').kind === 'contact', nk.code ? nk.out : nf.facts.map(f => `${f.id}:${f.kind}`).join(' '));
    }
    check('import: гео факта по business.geo', F('F03').geo === 'Новомосковск' && !F('F01').geo, JSON.stringify(F('F03')));
    check('import: wording без предмета дополнен названием', F('F02').wording === 'Гарантия на монтаж: 5 лет', F('F02').wording);
    check('import: publish no после гейта - строка в gaps', F('F04').publish === 'no' && facts.gaps.some(g => /^F04 «цена окна» не подтвержден или снят на гейте/.test(g)), JSON.stringify(facts.gaps));
    check('import: открытый вопрос анализа и gap журнала гейта в gaps', facts.gaps.some(g => /открытый вопрос анализа \(g1\): цены по типам окон/.test(g)) && facts.gaps.some(g => /журнал гейта \(j2\)/.test(g)));
    check('import: год основания заведен фактом - без пробела про since', !facts.gaps.some(g => /год начала работы/.test(g)));
    const a1 = facts.anti_promises.find(x => x.id === 'A01'), aKey = facts.anti_promises.find(x => /под ключ/.test(x.text));
    check('import: антиобещание из limits - заглушка и pending', a1?.text === 'не обещаем самую низкую цену' && a1.lint_pattern === '(?!)' && rep.anti.pending.includes('A01') && facts.gaps.some(g => /регулярка антиобещания A01 не задана/.test(g)));
    check('import: запрет «под ключ» - своя регулярка по основам', !!aKey && rep.anti.auto.includes(aKey.id) && new RegExp(aKey.lint_pattern, 'i').test('окна под ключ') && !new RegExp(aKey.lint_pattern, 'i').test('под ключевым словом'), aKey?.lint_pattern);
    const aud = rj(IW('audience.json'));
    check('import: портрет без who - имя сегмента', aud.segments[1].portrait === 'Владелец дачи' && aud.segments[0].comes_with === 'дует из-под подоконника');
    check('import: возражения O1..O4 и связь с фактом по числу', aud.segments.flatMap(s => s.objections.map(o => o.id)).join() === 'O1,O2,O3,O4' && canon(aud.segments[0].objections[0].facts) === canon(['F01']), JSON.stringify(aud.segments[0].objections));
    const objs = aud.segments.flatMap(s => s.objections);
    check('import: objection[].facts из контракта берутся как есть, только публикуемые (O2 -> F02, O3 пусто)', canon(objs[1].facts) === canon(['F02']) && canon(objs[2].facts) === canon([]), JSON.stringify(objs.map(o => [o.id, o.facts])));
    check('import: снятые ссылки objection[].facts - в предупреждениях (f04 не публикуется, f09 нет в фактах)', rep.warnings.some(w => /^O2: факт F04 из objection\[\]\.facts не публикуется/.test(w)) && rep.warnings.some(w => /^O2: факт f09 из objection\[\]\.facts не импортирован/.test(w)), JSON.stringify(rep.warnings));
    const hObj = (rep.heuristic.find(h => h.field === 'audience.objections[].facts') || { items: [] }).items;
    check('import: эвристика связи возражения с фактом - только у возражений без поля facts', hObj.some(x => x === 'O1: F01') && !hObj.some(x => /^O[23]:/.test(x)) && rep.counts.objections_facts_from_contract === 2 && rep.counts.objections_facts_heuristic === 2, JSON.stringify({ hObj, counts: rep.counts }));
    check('import: слово клиента без means - meaning = say, src сохранен', aud.client_phrases[1].meaning === 'теплые окна' && aud.client_phrases[1].src === 'persona');
    const prefs = rj(IW('client-preferences.json'));
    check('import: пожелание d2 с фактом доказательства F02', prefs.items.some(x => x.source === 'gate:d2' && x.status === 'candidate' && canon(x.facts) === canon(['F02'])) && prefs.items.some(x => x.where === 'must-say'));
    const dirs = rj(IW('directions.json'));
    check('import: направления с сегментами S1.. и гео из имени', dirs.directions.find(d => d.id === 'okna-novomoskovsk')?.geo === 'Новомосковск' && canon(dirs.directions[1].serves) === canon(['S1', 'S2']) && dirs.directions[2].serves.length === 0 && rep.warnings.some(w => /serves пуст\): balkony/.test(w)));
    const seed = rj(IW('competitors', 'seed.json'));
    check('import: затравка конкурентов - домены и отбракованная строка', seed.domains.map(d => d.domain).join() === 'example-okna.ru,okna-primer.ru' && canon(seed.rejected) === canon(['Окна Лидер']), JSON.stringify(seed));
    check('import: конфиг - компания, сайт из lexicon.canonical, key_phrases корней', cfg.company === 'Веста Окна' && cfg.site_url === 'https://vesta-okna.example' && canon(cfg.sources.key_phrases) === canon(['пластиковые окна', 'остекление балконов']) && cfg.sources.queue === path.join(SITE, 'queue.json'), JSON.stringify({ c: cfg.company, s: cfg.site_url, k: cfg.sources.key_phrases }));
    const sd = rj(path.join(I, 'inputs', 'structure_data.json'));
    check('import --structure: копия со снятым слешем и счетом сверки', sd.pages.map(p => p.url).join() === '/okna,/okna/novomoskovsk,/dveri,/' && rep.structure.slash_fixed === 2 && rep.structure.pages_with_dir_id === 1 && rep.structure.pages_matched_by_url === 1 && cfg.sources.structure_input === structFile, JSON.stringify(rep.structure));
    check('import --structure: неизвестный dir:<id> - предупреждение', rep.warnings.some(w => /dir:<id>, которых нет в business\.directions: dveri/.test(w)), JSON.stringify(rep.warnings));
    const d9main = rep.gate.decisions.d9 || {};
    check('import: решение d9 в отчете - состав из внешней структуры (SEO), 4 страницы, принят ее гейтом', d9main.name === 'состав страниц' && /^4 страниц в работе; источник - /.test(d9main.value || '') && /гейте \/seo-struktura/.test(d9main.how || ''), JSON.stringify(d9main));
    check('import: реквизиты при гейте - confirmed', facts.company.status === 'confirmed' && facts.company.phones?.[0] === '+7 000 000-00-00');
    // render-analysis: заголовки-контракт, цитаты дословно, house style
    const md = fs.readFileSync(path.join(I, 'inputs', 'analysis.md'), 'utf8');
    const HEADS = ['Конкуренты', 'Чем отличаемся', 'Чего нет у конкурентов / дыры рынка', 'Обязательные блоки у рынка', 'Вопросы читателя', 'Чего не обещаем', 'Позиции и карточки', 'Обещания рынка', 'Цифры рынка', 'Факты', 'Пробелы'];
    const missH = HEADS.filter(h => !md.includes(`\n## ${h}\n`));
    check('render-analysis: все заголовки-контракт на месте', !missH.length, missH.join(', '));
    const missQ = facts.facts.filter(f => !md.includes(f.source_quote)).map(f => f.id);
    check('render-analysis: каждая source_quote дословно в analysis.md', !missQ.length && rep.counts.quotes_in_render === facts.facts.length, missQ.join(', '));
    check('render-analysis: строка факта с источником', md.includes('- F01 [бриф] год основания: работаем с 2012 года | kind: number | публикация: да'));
    check('render-analysis: мост блоков анализа к блокам текстов', md.includes('- steps -> process') && md.includes('- price -> pricing') && md.includes('- cta_form -> cta'));
    check('render-analysis: причина без доказательства вынесена отдельно', /Без доказательства[^\n]*\n- Бережный монтаж без пыли \(процесс\)/.test(md));
    check('render-analysis: гейт согласован, без буквы е с точками и длинных тире', /Гейт анализа: согласован \(заказчик, 2026-09-21\)/.test(md) && !/[\u0451\u0401\u2014\u2013]/.test(md));
    check('render-analysis: blockId - синонимы и подчеркивания', blockId('steps') === 'process' && blockId('cta_mid') === 'cta' && blockId('new_block') === 'new-block');
    // регулярки антиобещаний: проверка на примерах и перенос в facts.json
    wj(IW('anti-promises.patterns.json'), { items: [
      { id: 'A01', text: 'не обещаем самую низкую цену', lint_pattern: 'сам(ая|ой|ую) низк(ая|ой|ую) цен', must_match: ['самая низкая цена в городе', 'по самой низкой цене', 'гарантируем самую низкую цену'], must_not_match: ['цена ниже рынка не обещана', 'низкий порог входа'] },
    ] });
    const ap = run(I, ['scripts/import-project.mjs', '--apply-patterns', 'work/anti-promises.patterns.json']);
    const facts2 = rj(IW('facts.json'));
    check('import --apply-patterns: регулярка принята и перенесена, пробел снят', ap.code === 0 && facts2.anti_promises[0].lint_pattern === 'сам(ая|ой|ую) низк(ая|ой|ую) цен' && !facts2.gaps.some(g => /регулярка антиобещания A01/.test(g)) && !rj(IW('import-report.json')).anti.pending.includes('A01'), ap.out);
    checkSchema('import --apply-patterns: work/facts.json', 'facts', facts2);
    wj(IW('anti-promises.patterns.json'), { items: [{ id: 'A01', lint_pattern: '\\bниз.*цен', must_match: ['низкая цена', 'низкие цены', 'низкой цене'], must_not_match: ['цена', 'низина'] }] });
    const apBad = run(I, ['scripts/import-project.mjs', '--apply-patterns', 'work/anti-promises.patterns.json']);
    check('import --apply-patterns: \\b и .* - код 1 с причинами', apBad.code === 1 && /не работают с кириллицей/.test(apBad.out) && /без предела/.test(apBad.out), apBad.out);
    const reimp = run(I, ['scripts/import-project.mjs', '--queue', path.join(SITE, 'queue.json')]);
    check('import: повторный импорт - код 0, регулярка с тем же текстом не применена из плохого файла', reimp.code === 0 && rj(IW('facts.json')).anti_promises[0].lint_pattern === '(?!)', reimp.out);

    // d9 при tier basic: состав пишет анализ (sites/NNN/structure_data.json), молчание заказчика по d9 - строка журнала гейта
    {
      const D = path.join(tmpRoot, 'import-d9');
      run(TPL, ['scripts/init-project.mjs', 'okna-d9', D, '--project', projectFile]);
      const sdSite = path.join(SITE, 'structure_data.json');
      wj(sdSite, { pages: [{ n: 1, url: '/', name: 'Главная', type: 'Главная', target_status: 'yes' }, { n: 2, url: '/okna', name: 'Пластиковые окна', type: 'Категория', section: 'dir:okna', target_status: 'yes' }, { n: 3, url: '/otzyvy', name: 'Отзывы', type: 'Инфо', target_status: 'no' }] });
      const qD9 = path.join(SITE, 'queue-d9.json');
      wj(qD9, { gate: { approved: true, by: 'заказчик', at: '2026-09-22' }, journal: [{ id: 'j1', kind: 'waiver', subject: 'молчание по решению d9 - состав страниц', ground: 'заказчик не поправил, принят рекомендованный состав: 2 страниц, снято 1' }] });
      const r = run(D, ['scripts/import-project.mjs', '--queue', qD9, '--structure', sdSite]);
      const dd = r.code === 0 ? (rj(path.join(D, 'work', 'import-report.json')).gate.decisions.d9 || {}) : {};
      check('import: d9 при basic - состав анализа, снятая страница посчитана, молчание из журнала гейта', r.code === 0 && dd.value === '2 страниц в работе, снято 1; источник - состав анализа (pages-planner)' && /молчание заказчика, принят рекомендованный дефолт \(j1\)/.test(dd.how || ''), r.code ? r.out : JSON.stringify(dd));
      const md9 = r.code === 0 ? fs.readFileSync(path.join(D, 'inputs', 'analysis.md'), 'utf8') : '';
      check('import: d9 в таблице решений гейта analysis.md и в выводе импорта', /\n\| d9 \| состав страниц \| 2 страниц в работе, снято 1/.test(md9) && /решение d9 \(состав страниц\): 2 страниц в работе/.test(r.out), r.out);
      fs.rmSync(sdSite, { force: true });
    }

    // служебная пометка вместо значения факта: одно правило с анализом - SERVICE_NOTE из .claude/scripts/site/_contract.mjs
    {
      const contractFile = path.resolve(TPL, '..', '..', '..', 'scripts', 'site', '_contract.mjs');
      if (fs.existsSync(contractFile)) {
        const { SERVICE_NOTE } = await import(pathToFileURL(contractFile).href);
        check('SERVICE_NOTE: копия в kit (lib.mjs) совпадает с правилом анализа (_contract.mjs)', SERVICE_NOTE_COPY.source === SERVICE_NOTE.source && SERVICE_NOTE_COPY.flags === SERVICE_NOTE.flags, `${SERVICE_NOTE_COPY} | ${SERVICE_NOTE}`);
      } else notes.push(`пропущено: нет ${contractFile}`);
      // вне проекта (во временной папке нет .claude/scripts/site) - копия kit; «уточним позже» снимает publish
      const pNote = JSON.parse(JSON.stringify(project));
      pNote.facts.find(f => f.id === 'f05').value = 'телефон уточним позже';
      const noteFile = path.join(SITE, 'project-note.json');
      wj(noteFile, pNote);
      const N1 = path.join(tmpRoot, 'import-note');
      run(TPL, ['scripts/init-project.mjs', 'okna-note', N1, '--project', noteFile]);
      const n1 = run(N1, ['scripts/import-project.mjs', '--queue', path.join(SITE, 'queue.json')]);
      const n1f = n1.code === 0 ? rj(path.join(N1, 'work', 'facts.json')) : { facts: [], gaps: [] };
      const n1r = n1.code === 0 ? rj(path.join(N1, 'work', 'import-report.json')) : { inputs: {} };
      check('SERVICE_NOTE вне проекта: правило - копия kit, пометка снимает publish и уходит в gaps', n1.code === 0 && /^копия SERVICE_NOTE/.test(n1r.inputs.service_note_rule || '') && (n1f.facts.find(f => f.id === 'F05') || {}).publish === 'no' && n1f.gaps.some(g => /^F05 «телефон»: в анализе вместо факта пометка/.test(g)), n1.code ? n1.out : JSON.stringify({ rule: n1r.inputs.service_note_rule, gaps: n1f.gaps }));
      // в проекте: правило берется из _contract.mjs, найденного вверх от project.json (подмененное правило ловит свою пометку)
      const PR = path.join(tmpRoot, 'proj-note');
      const fake = path.join(PR, '.claude', 'scripts', 'site', '_contract.mjs');
      wt(fake, 'export const SERVICE_NOTE = /нестандартная пометка анализа/i;\n');
      const pFake = JSON.parse(JSON.stringify(project));
      pFake.facts.find(f => f.id === 'f05').value = 'нестандартная пометка анализа';
      const fakeSite = path.join(PR, 'sites', '001-okna-test');
      wj(path.join(fakeSite, 'project.json'), pFake);
      wj(path.join(fakeSite, 'queue.json'), { gate: { approved: true, by: 'заказчик', at: '2026-09-21' }, journal: [] });
      const N2 = path.join(PR, 'texts', '001-okna');
      run(TPL, ['scripts/init-project.mjs', 'okna-note2', N2, '--project', path.join(fakeSite, 'project.json')]);
      const n2 = run(N2, ['scripts/import-project.mjs']);
      const n2f = n2.code === 0 ? rj(path.join(N2, 'work', 'facts.json')) : { facts: [] };
      const n2r = n2.code === 0 ? rj(path.join(N2, 'work', 'import-report.json')) : { inputs: {} };
      check('SERVICE_NOTE в проекте: правило из _contract.mjs анализа, а не копия kit', n2.code === 0 && path.resolve(n2r.inputs.service_note_rule || '.') === path.resolve(fake) && (n2f.facts.find(f => f.id === 'F05') || {}).publish === 'no', n2.code ? n2.out : JSON.stringify(n2r.inputs));
    }
  }

  // ================================================================== 11. схема конфига: sources.mode необязателен
  {
    const cfg = rj(path.join(TPL, 'config', 'project.json'));
    checkSchema('config шаблона', 'project-config', cfg);
    const old = JSON.parse(JSON.stringify(cfg)); delete old.sources.mode;
    checkSchema('config без sources.mode (старый проект)', 'project-config', old);
    const bad = JSON.parse(JSON.stringify(cfg)); bad.sources.mode = 'gdoc';
    check('config: sources.mode вне списка - ошибка схемы', schemaErrors('project-config', bad).some(e => /sources\.mode/.test(e)));
  }
} catch (e) {
  fail++; failures.push(`FAIL исключение: ${e.stack || e.message}`);
} finally {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
}

failures.forEach(f => console.log(f));
notes.forEach(n => console.log(n));
console.log(`scripts-cases: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
