// Тесты пакета F программы 05.10 (КФ и КНДР): аудитор готового прототипа. Файлы пакета: kit scripts/site-digest.mjs,
// split-site.mjs, cta-unify.mjs, prompts/08-site-auditor.md, workflows/wf-08-site-audit.js (новые); schemas/findings.schema.json
// (producer site-auditor, zone, cta_unify, run), prompts/06-fixer.md (site.json), scripts/retro-stats.mjs (пропуски),
// .claude/skills/site-tekst/task.mjs (KIT_FILES, args site-audit, строки status для site-audited).
// Запуск: node .claude/tests/site-tekst/cases-site-audit.mjs (код 0 - все прошли).
// Все во временных папках (os.tmpdir()), без сети и данных клиентов. Синтетический проект (5 страниц, 2 блока) собирается
// скриптами kit: merge-strategy, build-briefs, lint-page; блоки проходят линтер. Скриншоты (Chrome) не снимаются.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validate } from '../../skills/site-tekst/kit/scripts/lib.mjs';
import { pageProgress } from '../../skills/site-tekst/kit/scripts/progress.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL = path.resolve(HERE, '..', '..', 'skills', 'site-tekst');
const KIT = path.join(SKILL, 'kit');
let pass = 0, fail = 0;
const failures = [], notes = [];
function check(name, ok, detail = '') {
  if (ok) pass++;
  else { fail++; failures.push(`FAIL ${name}${detail ? ': ' + String(detail).slice(0, 700) : ''}`); }
}
const rj = f => JSON.parse(fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, ''));
const wj = (f, o) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(o, null, 2) + '\n'); };
const rt = f => fs.readFileSync(f, 'utf8');
const read = rel => rt(path.join(KIT, rel)).replace(/^\uFEFF/, '');
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cases-site-audit-'));
function run(cwd, args, env = {}) {
  const r = spawnSync(process.execPath, args, { cwd, encoding: 'utf8', env: { ...process.env, ...env }, timeout: 240000 });
  return { code: r.status, stdout: r.stdout || '', out: (r.stdout || '') + (r.stderr || '') };
}
const lastJson = (out, tag) => { const m = String(out).match(new RegExp(`${tag} (\\{[^\\n]*\\})\\s*$`)); try { return m ? JSON.parse(m[1]) : null; } catch { return null; } };
const clone = o => JSON.parse(JSON.stringify(o));

// ---------- синтетический проект: главная, хаб, три услуги; у каждой страницы первый экран и призыв ----------
const SLUGS = ['home', 'uslugi', 'remont', 'montazh', 'pokraska'];
const LABELS = ['Получить расчет', 'Узнать цену', 'Узнать стоимость', 'Рассчитать цену', 'Посчитать цену'];
function mkProject(name, { legacy = false, pageExtra = {} } = {}) {
  const dir = path.join(tmpRoot, name);
  for (const d of ['scripts', 'rules', 'schemas', 'config', 'html']) fs.cpSync(path.join(KIT, d), path.join(dir, d), { recursive: true });
  const W = (...p) => path.join(dir, 'work', ...p);
  const cfg = rj(path.join(KIT, 'config', 'project.json')); cfg.company = 'Тест Мастерская'; cfg.slug = 'test'; cfg.niche.business_type = 'services';
  wj(path.join(dir, 'config', 'project.json'), cfg);
  const page = (slug, url, type, level, parent) => ({ slug, url, type, subject: `Страница ${slug}`, parent, level, segment: 'S1', status: 'planned', block_set: 'full' });
  wj(W('sitemap.json'), { page_types: ['home', 'hub', 'service'], pages: [page('home', '/', 'home', 0, ''), page('uslugi', '/uslugi', 'hub', 1, '/'), page('remont', '/uslugi/remont', 'service', 2, '/uslugi'), page('montazh', '/uslugi/montazh', 'service', 2, '/uslugi'), page('pokraska', '/uslugi/pokraska', 'service', 2, '/uslugi')] });
  wj(W('facts.json'), { source: 'синтетика', facts: [
    { id: 'F01', label: 'гарантия', value: '12 месяцев', wording: 'Гарантия 12 месяцев', publish: 'yes', kind: 'legal' },
    { id: 'F02', label: 'замер', value: 'на следующий день', wording: 'Замер на следующий день после заявки', publish: 'yes', kind: 'process' },
  ], anti_promises: [], terminology: { use: [], jargon: [], untranslatable: [] }, company: { status: 'confirmed', phones: ['+7 900 000-00-00'], channels: { telegram: 'https://t.me/test' } }, gaps: [] });
  wj(W('audience.json'), { segments: [{ id: 'S1', name: 'Семья', portrait: 'Семья с ремонтом', comes_with: 'хотят успеть', pains: ['дорого'], fears: ['обманут'], criteria: ['гарантия'], objections: [] }], client_phrases: [] });
  const el = (kind, count, max) => ({ kind, count, chars: { min: 0, median: 0, max } });
  const blk = (id, role, pattern, elements, extra = {}) => ({ id, name: `Блок ${id}`, role, reader_question: `Вопрос про ${id}`, pattern, elements, seen_at: [], examples: [], ...extra });
  const hero = blk('hero', 'hero', 'hero-split', [el('h1', '1', 70), el('sub', '1', 200), el('button', '1', 30)], { core: true, cta_allowed: true, fact_kinds: ['legal'] });
  const cta = blk('cta', 'conversion', 'cta-band', [el('h2', '1', 80), el('text', '1', 200), el('button', '1', 30)], { core: true, cta_allowed: true, fact_kinds: ['process'] });
  for (const t of ['home', 'hub', 'service']) wj(W('page-types', `${t}.json`), { type: t, sources: [{ domain: 'lider.example', url: 'https://lider.example/', raw: 'work/competitors/raw/x.json', status: 'ok' }], market_blocks: [hero, cta], differentiation_blocks: [], recommended_order: ['hero', 'cta'], cliches_to_avoid: [] });
  const A = x => (legacy ? {} : x);
  const entry = (slug, extra = {}) => ({ segment: 'S1', unique_argument: 'Довод страницы для теста', objection_ids: [], offer_formula: 'F3', facts: ['F01', 'F02'], hero_facts: ['F01'], ...(pageExtra[slug] || {}), ...extra });
  wj(W('strategy.json'), { global: { positioning: 'Позиционирование', main_promise: 'Обещание', offer_formula_by_type: {}, cta_by_type: { home: { main: LABELS[0], ...A({ action: 'lead' }), short: 'Расчет' }, hub: { main: LABELS[1], ...A({ action: 'lead' }) }, service: { main: LABELS[3], ...A({ action: 'lead' }) } }, argument_bank: [], objection_to_block: {}, disclaimer_block: '', disclaimer_text: '' },
    pages: Object.fromEntries(SLUGS.map(s => [s, entry(s)])) });
  wj(W('strategy.pages', 'service.json'), { type: 'service', pages: { remont: entry('remont', { cta: { main: LABELS[2], ...A({ action: 'lead' }) } }), montazh: entry('montazh'), pokraska: entry('pokraska', { cta: { main: LABELS[4], ...A({ action: 'lead' }) } }) }, disputes: [] });
  fs.writeFileSync(path.join(dir, 'rules', 'decisions.md'), '<!-- decisions:v2 -->\n# Решения\n');
  const ms = run(dir, ['scripts/merge-strategy.mjs']);
  const bb = run(dir, ['scripts/build-briefs.mjs']);
  const blockOf = (id, type, role, els, facts) => ({ block_id: id, type, role, elements: els, facts_used: facts, objections_closed: [], summary: 'блок теста', handoff_note: '' });
  const lint = {};
  for (const slug of SLUGS) {
    const lab = rj(W('pages', slug, 'brief.json')).cta.main;
    wj(W('pages', slug, 'blocks', 'B01-hero.json'), blockOf('B01-hero', 'hero', 'hero', [{ kind: 'h1', text: `Ремонт квартиры ${slug}` }, { kind: 'sub', text: 'Гарантия 12 месяцев на все работы', facts: ['F01'] }, { kind: 'button', text: lab }], ['F01']));
    wj(W('pages', slug, 'blocks', 'B02-cta.json'), blockOf('B02-cta', 'cta', 'conversion', [{ kind: 'h2', text: 'Начнем с замера' }, { kind: 'text', text: 'Замер на следующий день после заявки', facts: ['F02'] }, { kind: 'button', text: lab }], ['F02']));
    lint[slug] = run(dir, ['scripts/lint-page.mjs', slug]).code;
  }
  return { dir, W, ok: ms.code === 0 && bb.code === 0 && Object.values(lint).every(c => c === 0), detail: `${ms.out.slice(-300)} | ${bb.out.slice(-300)} | ${JSON.stringify(lint)}` };
}
// круг судьи без находок: страница «готово» (аудит свежий - lint-page.json с page_sha текущего page.md)
const judged = (W, slug) => wj(W('audit', slug, 'round-1.json'), { scope: slug, producer: 'page-judge', round: 1, findings: [], verdict: 'pass', summary: 'blocker 0, major 0, minor 0' });
const siteDoc = extra => ({ scope: 'site', producer: 'site-auditor', created_at: '2026-10-05 10:00:00', findings: [], verdict: 'pass', summary: '', ...extra });

try {
  // ================================================================== 1. дайджест без jsdom
  const P1 = mkProject('digest');
  check('синтетический проект: стратегия, брифы, блоки проходят линтер', P1.ok, P1.detail);
  {
    const src = read('scripts/site-digest.mjs');
    check('site-digest: без jsdom и deps.mjs, без разбора HTML (модель - buildSite из site-parts)', !/^import[^\n]*(jsdom|deps\.mjs)/m.test(src) && !/new JSDOM|DOMParser|loadDeps/.test(src) && /parts\.buildSite\(/.test(src) && /parts\.actionAttrs\(/.test(src) && /parts\.headerCtaAttrs\(/.test(src));
    const r = run(P1.dir, ['scripts/site-digest.mjs'], { NODE_PATH: '' });
    const d = rj(P1.W('audit', 'site-digest.json'));
    const lead = d.cta_labels.lead;
    check('дайджест: код 0, последняя строка SITE_DIGEST, не больше 30 строк', r.code === 0 && !!lastJson(r.stdout, 'SITE_DIGEST') && r.stdout.trim().split('\n').length <= 30, r.out);
    check('дайджест: 5 надписей одного действия lead (каждая на своей странице, роль main)', !!lead && lead.variants === 5 && LABELS.every(l => lead.labels.some(x => x.label === l && x.roles.includes('main'))) && lead.total === 10, JSON.stringify(d.cta_labels));
    check('дайджест: факт F01 на всех страницах (trust_all_pages, trust_facts, формулировка)', d.trust_all_pages.includes('F01') && d.trust_facts.F01.length === 5 && d.trust_wording.F01 === 'Гарантия 12 месяцев', JSON.stringify(d.trust_facts));
    const home = d.routes.find(x => x.slug === 'home');
    check('дайджест: маршрут - тип, H1 из блока, подзаголовок, кнопки с действием и ролью, блоки с первой фразой', home && home.route === '/' && home.type === 'home' && home.h1 === 'Ремонт квартиры home' && home.sub === 'Гарантия 12 месяцев на все работы'
      && home.buttons.length === 2 && home.buttons.every(b => b.action === 'lead' && b.role === 'main') && home.blocks.find(b => b.id === 'B02-cta').first === 'Замер на следующий день после заявки', JSON.stringify(home));
    check('дайджест: повтор h2 между страницами, оболочка (меню, шапка с кнопкой и телефоном)', d.h2_repeats.some(x => x.h2 === 'Начнем с замера' && x.pages.length === 5) && d.shell.header.cta && d.shell.header.cta.label === 'Расчет' && d.shell.header.phone === true && d.shell.menu.items.some(i => i.slug === 'uslugi'), JSON.stringify(d.shell));
    check('дайджест: без --shots скриншотов нет, маршруты главной и первой страницы типа', d.shots.status === 'skip' && JSON.stringify(d.shot_routes) === JSON.stringify(['#/', '#/uslugi', '#/uslugi/remont']), JSON.stringify(d.shot_routes));
    check('дайджест: прототип не собран - proto.file false', d.proto.file === false);
    // старый формат CTA: ни в стратегии, ни в брифах нет action - одна группа legacy
    const L1 = mkProject('legacy', { legacy: true });
    run(L1.dir, ['scripts/site-digest.mjs']);
    const dl = rj(L1.W('audit', 'site-digest.json'));
    check('дайджест: старый формат CTA - группа legacy (одна), cta_legacy true', L1.ok && dl.cta_legacy === true && JSON.stringify(Object.keys(dl.cta_labels)) === '["legacy"]' && dl.cta_labels.legacy.variants === 5, JSON.stringify(Object.keys(dl.cta_labels)) + L1.detail);
    // фикстура kit с собранным прототипом: свежесть и разные действия
    const FX = path.join(tmpRoot, 'fixture');
    for (const dd of ['scripts', 'rules', 'schemas', 'config', 'html']) fs.cpSync(path.join(KIT, dd), path.join(FX, dd), { recursive: true });
    for (const dd of ['config', 'work', 'rules']) if (fs.existsSync(path.join(KIT, 'examples', 'fixture-services', dd))) fs.cpSync(path.join(KIT, 'examples', 'fixture-services', dd), path.join(FX, dd), { recursive: true });
    const bh = run(FX, ['scripts/build-html.mjs'], { SITE_TEKST_BUILT_AT: '2026-10-05 12:00:00' });
    const rf = run(FX, ['scripts/site-digest.mjs']);
    const df = fs.existsSync(path.join(FX, 'work', 'audit', 'site-digest.json')) ? rj(path.join(FX, 'work', 'audit', 'site-digest.json')) : {};
    check('дайджест фикстуры услуг: прототип свежий, действия messenger/page/anchor, кнопки отправки формы не в cta_labels', bh.code === 0 && rf.code === 0 && df.proto && df.proto.fresh === true && !!df.cta_labels.messenger && !!df.cta_labels['page:uslugi'] && !df.cta_labels.submit
      && df.routes.some(x => x.buttons.some(b => b.action === 'submit')), rf.out + bh.out.slice(-300));
  }

  // ================================================================== 2. схема находок
  {
    const schema = rj(path.join(KIT, 'schemas', 'findings.schema.json'));
    const good = siteDoc({ verdict: 'fix', findings: [
      { id: 'site-001', zone: 'header', severity: 'major', category: 'structure', rule: 'site.nav-h1', problem: 'меню обещает одно' },
      { id: 'site-002', page: 'home', block_id: 'B01-hero', quote: 'x', severity: 'minor', category: 'repeat', rule: 'site.repeat', problem: 'повтор' },
    ], cta_unify: [{ action: 'lead', role: 'main', label: 'Рассчитать цену', variants: ['Рассчитать цену', 'Узнать цену'], why: 'называет результат' }], run: { steps: [{ name: 'digest', status: 'ok' }], errors: [] } });
    check('findings: site-auditor, находка с zone без page, cta_unify и run проходят схему', !validate(schema, good).length, validate(schema, good).join('; '));
    const bad1 = clone(good); bad1.findings[0].zone = 'sidebar';
    const bad2 = clone(good); bad2.cta_unify[0].variants = ['Рассчитать цену'];
    const bad3 = clone(good); bad3.cta_unify[0].action = 'legacy';
    const bad4 = clone(good); bad4.cta_unify[0].label = 'x'.repeat(41);
    check('findings: зона не из списка, один вариант, действие legacy, длинная надпись - ошибки схемы', [bad1, bad2, bad3, bad4].every(b => validate(schema, b).length > 0));
    const old = { scope: 'p', producer: 'cross-judge', findings: [{ id: 'a', severity: 'major', category: 'repeat', rule: 'r', problem: 'p' }], verdict: 'fix' };
    check('findings: прежние отчеты без новых полей проходят схему', !validate(schema, old).length);
  }

  // ================================================================== 3. split-site и merge
  {
    const { dir, W } = mkProject('split');
    SLUGS.forEach(s => judged(W, s));
    const cross = { scope: 'cross', producer: 'cross-judge', created_at: '2026-10-01 10:00:00', findings: [{ id: 'c1', page: 'home', severity: 'major', category: 'repeat', rule: 'repeat', problem: 'p', status: 'open' }], verdict: 'fix', summary: '' };
    wj(W('audit', 'cross.json'), cross);
    const crossBefore = rt(W('audit', 'cross.json'));
    const before = Object.fromEntries(SLUGS.map(s => [s, pageProgress(dir, s)]));
    wj(W('audit', 'site.json'), siteDoc({ verdict: 'blocked', findings: [
      { page: 'remont', block_id: 'B01-hero', severity: 'major', category: 'weak', rule: 'site.first-screen', problem: 'не видно действия' },
      { page: 'home', block_id: 'B02-cta', severity: 'blocker', category: 'logic', rule: 'site.trust-pack', problem: 'противоречие' },
      { page: 'home', block_id: 'B01-hero', severity: 'major', category: 'fact', rule: 'site.trust-pack', problem: 'нужен факт', needs_fact: true },
      { zone: 'footer', severity: 'major', category: 'structure', rule: 'site.chip-place', problem: 'чип в подвале' },
      { page: 'home', zone: 'header', severity: 'major', category: 'structure', rule: 'site.nav-h1', problem: 'шапка' },
      { severity: 'minor', category: 'style', rule: 'site.voice', problem: 'весь сайт' },
      { page: 'net-takoy', severity: 'major', category: 'weak', rule: 'site.clone', problem: 'нет брифа' },
    ] }));
    const s1 = run(dir, ['scripts/split-site.mjs']);
    const sp = lastJson(s1.stdout, 'SITE_SPLIT');
    const all = rj(W('audit', 'site.json'));
    const homeCopy = fs.existsSync(W('audit', 'home', 'site.json')) ? rj(W('audit', 'home', 'site.json')) : null;
    check('split-site: id присвоены в общем файле, копии только страниц с брифом и без zone', s1.code === 0 && all.findings.every(f => /^site-auditor-\d{3}$/.test(f.id)) && !!homeCopy && homeCopy.split_from === 'work/audit/site.json'
      && homeCopy.findings.length === 2 && fs.existsSync(W('audit', 'remont', 'site.json')) && !fs.existsSync(W('audit', 'net-takoy', 'site.json')), s1.out);
    check('split-site: SITE_SPLIT - исправимые без needs_fact, blocker первыми', !!sp && JSON.stringify(sp.pages.map(p => p.slug)) === '["home","remont"]' && sp.pages[0].blocker === 1 && sp.pages[0].fixable === 1, JSON.stringify(sp));
    check('split-site: только в отчет - с зоной 2, без page 1, страница без брифа 1', /только в отчет: с зоной 2, без page 1, на страницу без брифа 1/.test(s1.out), s1.out);
    const after = Object.fromEntries(SLUGS.map(s => [s, pageProgress(dir, s)]));
    check('split-site: готовность и открытые находки страниц не меняются (site.json не входит в pageFindings)', SLUGS.every(s => after[s].ready === before[s].ready && after[s].open_serious === before[s].open_serious && after[s].status === before[s].status) && after.remont.ready === true, JSON.stringify(SLUGS.map(s => [s, after[s].status, before[s].status])));
    // фиксер правит статусы своей копии; merge переносит; повторная раскладка того же отчета их сохраняет
    const hc = rj(W('audit', 'home', 'site.json'));
    hc.findings[0].status = 'fixed'; hc.findings[0].resolution = 'удалено предложение';
    wj(W('audit', 'home', 'site.json'), hc);
    const m = run(dir, ['scripts/split-site.mjs', '--merge']);
    const all2 = rj(W('audit', 'site.json'));
    const fixedId = hc.findings[0].id;
    check('split-site --merge: статус и resolution в общем site.json, cross.json не тронут', m.code === 0 && all2.findings.find(f => f.id === fixedId).status === 'fixed' && all2.findings.find(f => f.id === fixedId).resolution === 'удалено предложение' && rt(W('audit', 'cross.json')) === crossBefore, m.out);
    run(dir, ['scripts/split-site.mjs']);
    check('split-site: повторная раскладка того же отчета сохраняет статусы фиксера', rj(W('audit', 'home', 'site.json')).findings.find(f => f.id === fixedId).status === 'fixed');
    // новый отчет (другой created_at) - копии прежнего удаляются
    wj(W('audit', 'site.json'), siteDoc({ created_at: '2026-10-05 11:00:00', findings: [{ page: 'montazh', severity: 'major', category: 'weak', rule: 'site.clone', problem: 'клон' }] }));
    run(dir, ['scripts/split-site.mjs']);
    check('split-site: новый отчет - копии прежнего удалены', !fs.existsSync(W('audit', 'home', 'site.json')) && fs.existsSync(W('audit', 'montazh', 'site.json')));
    // --record: шаги и ошибки; без site.json - пустой отчет по схеме
    const rec = run(dir, ['scripts/split-site.mjs', '--record', 'digest=ok;audit=ok;fix:home=fail', '--errors', 'fix:home: агент не ответил']);
    run(dir, ['scripts/split-site.mjs', '--record', 'fix:home=ok;cta-unify=skip']);
    const sr = rj(W('audit', 'site.json'));
    check('split-site --record: шаги по имени заменяются, ошибки дописываются', rec.code === 0 && JSON.stringify(sr.run.steps) === JSON.stringify([{ name: 'digest', status: 'ok' }, { name: 'audit', status: 'ok' }, { name: 'fix:home', status: 'ok' }, { name: 'cta-unify', status: 'skip' }]) && sr.run.errors.length === 1, JSON.stringify(sr.run));
    // откат правок wf-08 (шаг 8): исправленное снова открыто, надписи cta-unify отменены, шаг rollback в run, схема цела
    {
      const s = rj(W('audit', 'site.json'));
      if (s.findings[0]) s.findings[0].status = 'fixed';
      s.cta_unify = [{ action: 'lead', label: 'Получить расчет', variants: ['Получить расчет', 'Рассчитать стоимость'], status: 'applied', applied: [{ page: 'home', blocks: ['B01-hero'] }] }];
      fs.writeFileSync(W('audit', 'site.json'), JSON.stringify(s, null, 2));
      const rb = run(dir, ['scripts/split-site.mjs', '--rollback', 'check-site-js fail']);
      const s2 = rj(W('audit', 'site.json'));
      check('split-site --rollback: fixed -> open с причиной, cta_unify refused без applied, шаг rollback fail, схема цела',
        rb.code === 0 && !s2.findings.some(f => f.status === 'fixed') && (!s2.findings[0] || /откачена: check-site-js fail/.test(s2.findings[0].resolution)) &&
        s2.cta_unify[0].status === 'refused' && s2.cta_unify[0].applied.length === 0 && s2.run.steps.some(x => x.name === 'rollback' && x.status === 'fail') &&
        !validate(rj(path.join(KIT, 'schemas', 'findings.schema.json')), s2).length, rb.out + JSON.stringify(s2.run));
    }
    fs.rmSync(W('audit', 'site.json'));
    const r0 = run(dir, ['scripts/split-site.mjs', '--merge', '--record', 'digest=fail;audit=skip', '--errors', 'digest: код 1']);
    const s0 = rj(W('audit', 'site.json'));
    check('split-site --record без site.json: пустой отчет аудитора с run, вердикт не pass, проходит схему', r0.code === 0 && s0.producer === 'site-auditor' && s0.findings.length === 0 && s0.verdict !== 'pass' && s0.run.steps[0].status === 'fail' && !validate(rj(path.join(KIT, 'schemas', 'findings.schema.json')), s0).length, r0.out);
    check('split-site без site.json и без --record - код 2', (fs.rmSync(W('audit', 'site.json')), run(dir, ['scripts/split-site.mjs']).code === 2));
  }

  // ================================================================== 4. cta-unify
  const unify = (p, items) => { wj(p.W('audit', 'site.json'), siteDoc({ cta_unify: items })); return run(p.dir, ['scripts/cta-unify.mjs']); };
  const ITEM = { action: 'lead', label: LABELS[3], variants: [...LABELS] };
  {
    // a) надпись вне вариантов и не с сайта - отказ, файлы не тронуты
    const p = mkProject('cu-refuse');
    const st0 = rt(p.W('strategy.json'));
    const r = unify(p, [{ ...ITEM, label: 'Заказать звонок' }, { ...ITEM, label: 'Новая надпись', variants: [...LABELS, 'Новая надпись'] }]);
    const s = rj(p.W('audit', 'site.json'));
    check('cta-unify: label вне variants - отказ; label не с сайта - отказ; стратегия не тронута', r.code === 0 && s.cta_unify.every(x => x.status === 'refused') && /не из вариантов/.test(s.cta_unify[0].reason) && /не встречается на сайте/.test(s.cta_unify[1].reason) && rt(p.W('strategy.json')) === st0, r.out);
    check('cta-unify: шаг cta-unify в run (ok), CTA_UNIFY в конце', s.run.steps.some(x => x.name === 'cta-unify' && x.status === 'ok') && !!lastJson(r.stdout, 'CTA_UNIFY'));
  }
  {
    // b) применено: правка по месту источника, переживает merge-strategy, кнопки заменены, готовность сохранена
    const p = mkProject('cu-apply');
    SLUGS.forEach(s => judged(p.W, s));
    const ready0 = SLUGS.filter(s => pageProgress(p.dir, s).ready);
    const r = unify(p, [ITEM]);
    const s = rj(p.W('audit', 'site.json'));
    const it = s.cta_unify[0];
    const st = rj(p.W('strategy.json'));
    const tf = rj(p.W('strategy.pages', 'service.json'));
    check('cta-unify: применено на 4 страницах (montazh уже с этой надписью)', r.code === 0 && it.status === 'applied' && JSON.stringify(it.applied.map(x => x.page).sort()) === JSON.stringify(['home', 'pokraska', 'remont', 'uslugi']), r.out);
    check('cta-unify: источник - запись файла типа (remont, pokraska) и global (home, hub); action записан, short без пары убран', tf.pages.remont.cta.main === LABELS[3] && tf.pages.remont.cta.action === 'lead' && tf.pages.pokraska.cta.main === LABELS[3]
      && st.global.cta_by_type.home.main === LABELS[3] && st.global.cta_by_type.home.action === 'lead' && !('short' in st.global.cta_by_type.home) && st.global.cta_by_type.hub.main === LABELS[3]
      && it.applied.find(x => x.page === 'remont').source === 'strategy.pages/service.json pages.remont.cta' && it.applied.find(x => x.page === 'home').source === 'strategy.json global.cta_by_type.home', JSON.stringify(st.global.cta_by_type));
    check('cta-unify: спор в disputes файла типа', (tf.disputes || []).some(d => /одна надпись/.test(d.question) && d.decision === `«${LABELS[3]}»` && d.pages.includes('remont')), JSON.stringify(tf.disputes));
    const ms = run(p.dir, ['scripts/merge-strategy.mjs']);
    const st2 = rj(p.W('strategy.json'));
    check('cta-unify: правка переживает повторный merge-strategy (pages.remont.cta из файла типа)', st2.pages.remont.cta.main === LABELS[3] && st2.pages.pokraska.cta.main === LABELS[3], ms.out);
    const briefs = SLUGS.map(x => rj(p.W('pages', x, 'brief.json')).cta.main);
    const btns = SLUGS.flatMap(x => ['B01-hero', 'B02-cta'].map(b => rj(p.W('pages', x, 'blocks', `${b}.json`)).elements.find(e => e.kind === 'button').text));
    check('cta-unify: брифы и кнопки блоков - одна надпись, блоки проходят линтер', briefs.every(x => x === LABELS[3]) && btns.every(x => x === LABELS[3]) && SLUGS.every(x => rj(p.W('audit', x, 'lint-page.json')).verdict === 'pass'), JSON.stringify({ briefs, btns }));
    const ready1 = SLUGS.filter(x => pageProgress(p.dir, x).ready);
    check('cta-unify: ready и audit_fresh сохраняются (lint-page пишет page_sha нового page.md)', ready0.length === 5 && JSON.stringify(ready1) === JSON.stringify(ready0) && SLUGS.every(x => pageProgress(p.dir, x).audit_fresh), JSON.stringify({ ready0, ready1 }));
    check('cta-unify: site.json проходит схему', !validate(rj(path.join(KIT, 'schemas', 'findings.schema.json')), s).length);
  }
  {
    // c) структура изменилась (тип главной получил блок, блоки уже написаны) - отказ, снимок возвращен
    const p = mkProject('cu-structure');
    const pt = rj(p.W('page-types', 'home.json'));
    pt.market_blocks.push({ id: 'faq', name: 'Вопросы', role: 'info', reader_question: 'Что спрашивают', pattern: 'accordion', elements: [{ kind: 'h2', count: '1', chars: { min: 0, median: 0, max: 80 } }, { kind: 'qa', count: '3', chars: { min: 0, median: 0, max: 300 } }], seen_at: [], examples: [] });
    pt.recommended_order = ['hero', 'faq', 'cta'];
    wj(p.W('page-types', 'home.json'), pt);
    const brief0 = rt(p.W('pages', 'home', 'brief.json'));
    const r = unify(p, [ITEM]);
    const it = rj(p.W('audit', 'site.json')).cta_unify[0];
    const st = rj(p.W('strategy.json'));
    check('cta-unify: structure_changed - отказ страницы, global главной откачен, бриф и кнопки прежние', it.status === 'partial' && it.refused.some(x => x.page === 'home' && /structure_changed/.test(x.reason)) && st.global.cta_by_type.home.main === LABELS[0] && st.global.cta_by_type.home.short === 'Расчет'
      && rt(p.W('pages', 'home', 'brief.json')) === brief0 && rj(p.W('pages', 'home', 'blocks', 'B01-hero.json')).elements[2].text === LABELS[0] && rj(p.W('audit', 'home', 'lint-page.json')).verdict === 'pass', r.out);
    check('cta-unify: прочие страницы при отказе главной применены', it.applied.some(x => x.page === 'remont') && rj(p.W('pages', 'remont', 'brief.json')).cta.main === LABELS[3]);
  }
  {
    // d) бриф изменился не только в cta (факт поменялся после сборки брифов) - отказ страниц
    const p = mkProject('cu-brief');
    const f = rj(p.W('facts.json')); f.facts[1].wording = 'Замер в день заявки'; wj(p.W('facts.json'), f);
    const r = unify(p, [ITEM]);
    const it = rj(p.W('audit', 'site.json')).cta_unify[0];
    check('cta-unify: бриф изменился не только в cta - отказ всех страниц, стратегия возвращена', it.status === 'refused' && it.refused.length === 4 && it.refused.every(x => /не только в cta/.test(x.reason) || /общий источник/.test(x.reason))
      && rj(p.W('strategy.pages', 'service.json')).pages.remont.cta.main === LABELS[2] && rj(p.W('strategy.json')).pages.remont.cta.main === LABELS[2] && rj(p.W('pages', 'remont', 'brief.json')).facts.find(x => x.id === 'F02').wording !== 'Замер в день заявки', r.out);
  }
  {
    // e) блок с major после замены надписи (запрет стратега на слово надписи) - откат блока, затем страницы
    const p = mkProject('cu-rollback', { pageExtra: { uslugi: { do_not_say: ['рассчитать'] } } });
    judged(p.W, 'uslugi');
    const r = unify(p, [ITEM]);
    const it = rj(p.W('audit', 'site.json')).cta_unify[0];
    const hero = rj(p.W('pages', 'uslugi', 'blocks', 'B01-hero.json'));
    check('cta-unify: блок с major после правки - откат блока, кнопка расходится с CTA - откат страницы', p.ok && it.status === 'partial' && it.refused.some(x => x.page === 'uslugi' && /не проходит линтер/.test(x.reason)) && hero.elements[2].text === LABELS[1]
      && rj(p.W('pages', 'uslugi', 'brief.json')).cta.main === LABELS[1] && rj(p.W('strategy.json')).global.cta_by_type.hub.main === LABELS[1] && rj(p.W('audit', 'uslugi', 'lint-page.json')).verdict === 'pass' && pageProgress(p.dir, 'uslugi').ready, r.out + p.detail);
  }
  {
    // f) старый формат CTA - группа legacy не трогается
    const p = mkProject('cu-legacy', { legacy: true });
    const st0 = rt(p.W('strategy.json'));
    const r = unify(p, [ITEM]);
    const it = rj(p.W('audit', 'site.json')).cta_unify[0];
    check('cta-unify: старый формат CTA - отказ (legacy), стратегия не тронута', it.status === 'refused' && /legacy/.test(it.reason) && rt(p.W('strategy.json')) === st0, r.out);
    // нет решений - шаг skip
    wj(p.W('audit', 'site.json'), siteDoc({}));
    const r2 = run(p.dir, ['scripts/cta-unify.mjs']);
    check('cta-unify: решений нет - шаг skip, код 0', r2.code === 0 && rj(p.W('audit', 'site.json')).run.steps.some(x => x.name === 'cta-unify' && x.status === 'skip'));
  }

  // ================================================================== 5. wf-08 с подставными агентами
  {
    const src = read('workflows/wf-08-site-audit.js');
    const AsyncFunction = (async () => {}).constructor;
    async function runWf(args, answer) {
      const calls = [], logs = [];
      const agent = async (prompt, opts = {}) => { calls.push({ label: opts.label || '', prompt: String(prompt), model: opts.model }); return answer(opts.label || '', String(prompt)); };
      const parallel = thunks => Promise.all(thunks.map(t => t()));
      const pipeline = (items, ...stages) => Promise.all(items.map(async (it, i) => { let r = it; for (const st of stages) r = await st(r, it, i); return r; }));
      const fn = new AsyncFunction('args', 'agent', 'parallel', 'pipeline', 'phase', 'log', 'workflow', 'budget', src.replace(/^export const meta\s*=/m, 'const meta ='));
      let result = null, threw = '';
      try { result = await fn({ root: '/fake/root', model: 'M-STRONG', model_light: 'M-LIGHT', ...args }, agent, parallel, pipeline, () => {}, m => logs.push(m), async () => null, {}); } catch (e) { threw = e.stack || e.message; }
      return { calls, logs, result, threw, labels: calls.map(c => c.label) };
    }
    const OK = tail => ({ ok: true, exit_code: 0, stdout_tail: tail });
    const ten = Array.from({ length: 10 }, (_, i) => ({ slug: `p${i + 1}`, fixable: 1, blocker: i < 2 ? 1 : 0, major: 1 }));
    const happy = (label, prompt) => {
      if (label === 'site-digest') return OK(`site-digest: ...\nSITE_DIGEST ${JSON.stringify({ pages: 10, cta_groups: 2, cta_multi: ['lead'], shots: 'no_chrome', routes: ['#/'] })}`);
      if (label === 'site-audit') return { findings: 12, blocker: 2, major: 10, cta_unify: 1, verdict: 'blocked', summary: 'blocker 2, major 10', file: 'work/audit/site.json' };
      if (label === 'split-site') return OK(`split-site: ...\nSITE_SPLIT ${JSON.stringify({ pages: ten })}`);
      if (label.startsWith('snap:')) return OK(`FIX_SNAP ${JSON.stringify({ id: 'snap1', blocks: 2 })}`);
      if (label.startsWith('fix:')) return { slug: label.slice(4), fixed: 1, rejected: 0, left_open: 0, blocker_open: 0, blocks_touched: ['B01-hero'], lint: 'pass', page_lint: 'pass' };
      if (label.startsWith('diff:')) return OK(`FIX_DIFF ${JSON.stringify({ claims_changed: false, restored: [], page_lint: 'pass', snap_id: 'n' })}`);
      if (label === 'cta-unify') return OK(`cta-unify: ...\nCTA_UNIFY ${JSON.stringify({ applied: 1, refused: 0, pages: ['p1'] })}`);
      return OK('ok');
    };
    const w = await runWf({}, happy);
    const fixers = w.calls.filter(c => /^fix:/.test(c.label));
    check('wf-08: порядок - дайджест, аудитор, split-site, фиксеры, merge, cta-unify; без исключения', !w.threw && w.labels[0] === 'site-digest' && w.labels[1] === 'site-audit' && w.labels[2] === 'split-site' && w.labels.indexOf('split-site:merge') > w.labels.lastIndexOf('diff:p8') && w.labels[w.labels.length - 1] === 'cta-unify', w.threw || w.labels.join(','));
    check('wf-08: потолок фиксера 8 страниц (blocker первыми), режим сужения по постраничному site.json', fixers.length === 8 && fixers.every(c => /mode=narrow/.test(c.prompt) && /findings=work\/audit\/p\d+\/site\.json/.test(c.prompt) && /prompts\/06-fixer\.md/.test(c.prompt)) && !w.labels.includes('fix:p9'), w.labels.join(','));
    check('wf-08: снимок и fix-diff вокруг каждого фиксера (--snap-id из FIX_SNAP, --mode narrow)', w.calls.filter(c => /^diff:/.test(c.label)).length === 8 && w.calls.filter(c => /^diff:/.test(c.label)).every(c => /--snap-id snap1/.test(c.prompt) && /--mode narrow/.test(c.prompt)));
    check('wf-08: дайджест со скриншотами, merge пишет итог шагов (--record)', /site-digest\.mjs --shots/.test(w.calls[0].prompt) && /split-site\.mjs --merge --record "digest=ok;audit=ok;split=ok;fix=ok;merge=ok"/.test(w.calls.find(c => c.label === 'split-site:merge').prompt), w.calls.find(c => c.label === 'split-site:merge').prompt);
    check('wf-08: возврат {fixed_pages, cta_unified, failed_steps}', JSON.stringify(w.result.fixed_pages) === JSON.stringify(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8']) && w.result.cta_unified === 1 && Array.isArray(w.result.failed_steps) && !w.result.failed_steps.length, JSON.stringify(w.result));
    const ROLES = new Function(`return (${src.slice(src.indexOf('{', src.indexOf('const ROLES = {')), src.indexOf('\n}', src.indexOf('const ROLES = {')) + 2)})`)();
    check('wf-08: ROLES - run light, site-audit и fixer strong; модели по ролям', JSON.stringify(ROLES) === JSON.stringify({ run: 'light', 'site-audit': 'strong', fixer: 'strong' }) && w.calls.find(c => c.label === 'site-audit').model === 'M-STRONG' && fixers.every(c => c.model === 'M-STRONG') && w.calls.filter(c => /^(site-digest|split-site|snap:|diff:|cta-unify)/.test(c.label)).every(c => c.model === 'M-LIGHT'));
    // сбой аудитора: дальше только запись итога, без исключения
    const w2 = await runWf({}, (label, prompt) => (label === 'site-audit' ? null : happy(label, prompt)));
    const rec2 = w2.calls.find(c => c.label === 'split-site:merge');
    check('wf-08: аудитор не ответил - без split, фиксеров и cta-unify; запись audit=fail в run, не throw', !w2.threw && !w2.labels.includes('split-site') && !w2.labels.some(l => /^fix:/.test(l)) && !w2.labels.includes('cta-unify') && !!rec2 && /--record "digest=ok;audit=fail;split=skip;fix=skip"/.test(rec2.prompt) && !/--merge/.test(rec2.prompt) && /--errors "audit: агент не ответил"/.test(rec2.prompt)
      && w2.result.failed_steps.includes('audit') && /не отработал/.test(w2.result.summary), w2.threw || (rec2 && rec2.prompt));
    // исключение агента-фиксера и сбой cta-unify: шаги в run, фаза идет дальше
    const w3 = await runWf({ maxFixPages: 2 }, (label, prompt) => {
      if (label === 'fix:p1') throw new Error('сбой среды');
      if (label === 'cta-unify') return { ok: false, exit_code: 1, stdout_tail: 'Error' };
      return happy(label, prompt);
    });
    check('wf-08: исключение фиксера и код 1 cta-unify - записи в run (fix=partial, cta-unify=fail), не throw', !w3.threw && w3.labels.filter(l => /^fix:/.test(l)).length === 2 && w3.labels.includes('diff:p1') && /fix:p1=fail/.test(w3.calls.find(c => c.label === 'split-site:merge').prompt) && /fix=partial/.test(w3.calls.find(c => c.label === 'split-site:merge').prompt)
      && w3.calls.some(c => c.label === 'split-site:record' && /--record "cta-unify=fail"/.test(c.prompt)) && w3.result.failed_steps.includes('fix:p1') && w3.result.failed_steps.includes('cta-unify'), w3.threw || w3.labels.join(','));
    const w4 = await runWf({ fixPages: ['home', 'uslugi'] }, happy);
    check('wf-08: явный fixPages вместо SITE_SPLIT (повтор вручную)', !w4.threw && JSON.stringify(w4.labels.filter(l => /^fix:/.test(l))) === '["fix:home","fix:uslugi"]', w4.labels.join(','));
    check('wf-08: maxFixPages больше 8 - потолок 8', !(await runWf({ maxFixPages: 20 }, happy)).threw && (await runWf({ maxFixPages: 20 }, happy)).labels.filter(l => /^fix:/.test(l)).length === 8);
  }

  // ================================================================== 6. task.mjs: place, args site-audit, status
  {
    const T = await import(pathToFileURL(path.join(SKILL, 'task.mjs')).href);
    check('task.mjs: KIT_FILES - словарь и стоп-лист КФ', T.KIT_FILES.includes('config/kf-elements.json') && T.KIT_FILES.includes('config/kf-stoplist.json'));
    const ROOT = path.join(tmpRoot, 'proj');
    const task = path.join(ROOT, 'texts', '001-test');
    fs.mkdirSync(path.join(ROOT, '.claude'), { recursive: true });
    wj(path.join(task, 'meta.json'), { format: 'v9', slug: 'test', source: 'doc', state: 'site-audited' });
    const kitHas = ['config/kf-elements.json', 'config/kf-stoplist.json'].filter(f => fs.existsSync(path.join(KIT, f)));
    if (kitHas.length < 2) notes.push(`SKIP часть проверок place: в kit нет ${['config/kf-elements.json', 'config/kf-stoplist.json'].filter(f => !kitHas.includes(f)).join(', ')} (пакеты A, B)`);
    const kfEl = fs.existsSync(path.join(KIT, 'config', 'kf-elements.json')) ? rj(path.join(KIT, 'config', 'kf-elements.json')) : null;
    wj(path.join(task, 'overrides', 'config', 'kf-elements.json'), { version: 'override-test' });
    const cwd0 = process.cwd();
    let placed = null, perr = '';
    try { process.chdir(ROOT); placed = T.place(task); } catch (e) { perr = e.message; } finally { process.chdir(cwd0); }
    const got = fs.existsSync(path.join(task, 'config', 'kf-elements.json')) ? rj(path.join(task, 'config', 'kf-elements.json')) : null;
    check('task.mjs place: кладет config/kf-*.json, override словаря сливается по ключам', !!placed && kitHas.every(f => fs.existsSync(path.join(task, f))) && (!kfEl || (got && got.version === 'override-test' && JSON.stringify(got.elements) === JSON.stringify(kfEl.elements))) && placed.extending.includes('config/kf-elements.json'), perr || JSON.stringify(placed && placed.extending));
    const tm = path.join(SKILL, 'task.mjs');
    const a0 = run(ROOT, [tm, 'args', 'texts/001-test', 'site-audit']);
    fs.mkdirSync(path.join(task, 'work', 'output'), { recursive: true });
    fs.writeFileSync(path.join(task, 'work', 'output', 'prototype.html'), '<html></html>');
    const a1 = run(ROOT, [tm, 'args', 'texts/001-test', 'site-audit']);
    const a2 = run(ROOT, [tm, 'args', 'texts/001-test', 'site-audit', '--max-fix-pages', '20']);
    const j1 = (() => { try { return JSON.parse(a1.stdout); } catch { return null; } })();
    const j2 = (() => { try { return JSON.parse(a2.stdout); } catch { return null; } })();
    check('task.mjs args site-audit: без прототипа код 2; с прототипом root, модели, maxFixPages 8 (не больше 8)', a0.code === 2 && /prototype\.html/.test(a0.out) && !!j1 && j1.maxFixPages === 8 && j1.model === 'opus' && j1.model_light === 'sonnet' && j1.root && !!j2 && j2.maxFixPages === 8, a0.out + a1.out);
    const ax = run(ROOT, [tm, 'args', 'texts/001-test', 'nope']);
    check('task.mjs args: неизвестный вид - код 1 со списком, в нем site-audit', ax.code === 1 && /catalog\|site-audit/.test(ax.out), ax.out);
    wj(path.join(task, 'meta.json'), { format: 'v9', slug: 'test', source: 'doc', state: 'site-audited', skips: [{ step: 'site-audited', reason: 'аудит прототипа не отработал: отказ агента', at: 'x' }] });
    const s0 = run(ROOT, [tm, 'status', 'texts/001-test']);
    check('task.mjs status: site-audited без site.json - причина из skips и следующий шаг', s0.code === 0 && /аудит прототипа: нет work\/audit\/site\.json \(аудит прототипа не отработал: отказ агента\)/.test(s0.out) && /дальше \(site-audited\)/.test(s0.out), s0.out);
    wj(path.join(task, 'work', 'audit', 'site.json'), siteDoc({ findings: [{ id: 's1', page: 'home', severity: 'major', category: 'weak', rule: 'site.first-screen', problem: 'x', status: 'fixed' }, { id: 's2', zone: 'footer', severity: 'minor', category: 'style', rule: 'site.voice', problem: 'y' }],
      cta_unify: [{ action: 'lead', label: 'A', variants: ['A', 'B'], status: 'applied' }, { action: 'call', label: 'C', variants: ['C', 'D'], status: 'refused' }], run: { steps: [{ name: 'digest', status: 'ok' }, { name: 'fix', status: 'partial' }], errors: [] } }));
    const s1 = run(ROOT, [tm, 'status', 'texts/001-test']);
    check('task.mjs status: итог аудита прототипа (находки, исправлено, надписи, сбои шагов)', /аудит прототипа: находок 2 \(blocker 0, major 1, minor 1\), исправлено 1; надписей cta-unify 1 из 2; сбои шагов: fix partial/.test(s1.out), s1.out);
    wj(path.join(task, 'meta.json'), { format: 'v9', slug: 'test', source: 'doc', state: 'catalog-done' });
    fs.rmSync(path.join(task, 'work', 'audit', 'site.json'));
    const s2 = run(ROOT, [tm, 'status', 'texts/001-test']);
    check('task.mjs status: старая задача без site.json и не site-audited - строк аудита нет', s2.code === 0 && !/аудит прототипа/.test(s2.out), s2.out);
  }

  // ================================================================== 7. retro-stats: пропуски
  {
    const { dir, W } = mkProject('retro');
    run(dir, ['scripts/site-digest.mjs']);
    wj(W('audit', 'site.json'), siteDoc({ findings: [{ page: 'home', block_id: 'B01-hero', severity: 'major', category: 'weak', rule: 'site.first-screen', problem: 'x' }] }));
    run(dir, ['scripts/split-site.mjs']);
    fs.mkdirSync(W('audit', 'site-shots'), { recursive: true });
    wj(W('audit', 'site-shots', 'x.json'), { findings: [{ severity: 'major', rule: 'r', problem: 'p' }] });
    const r = run(dir, ['scripts/retro-stats.mjs']);
    const rs = rj(W('audit', 'retro-stats.json'));
    const siteN = rs.files.by_producer['site-auditor'] || 0;
    check('retro-stats: site-digest.json и site-shots/ не читаются, копия site.json с split_from не считается', r.code === 0 && !rs.files.skipped.some(x => /site-digest|site-shots/.test(x.file)) && siteN === 1 && !rs.files.by_producer.unknown, JSON.stringify(rs.files));
  }

  // ================================================================== 8. стиль, UUID, ниша, бюджеты промтов
  {
    const OWN = ['scripts/site-digest.mjs', 'scripts/split-site.mjs', 'scripts/cta-unify.mjs', 'prompts/08-site-auditor.md', 'workflows/wf-08-site-audit.js', 'schemas/findings.schema.json', 'prompts/06-fixer.md', 'scripts/retro-stats.mjs'];
    const YO = String.fromCharCode(0x451), YO2 = String.fromCharCode(0x401), D1 = String.fromCharCode(0x2014), D2 = String.fromCharCode(0x2013);
    const NICHE = /(застройщ|депозит|квот[аеуы]|инвестор|недвижим|ипотек|новострой|апартамент|доходност|ювелир|золот|кольц|пирсинг|бриллиант|серебр|помолвоч|обручал|геммолог|пхукет|двигател|запчаст|trade-in|автомобил|goldax)/i;
    const bad = [];
    for (const f of [...OWN.map(x => [x, read(x)]), ['task.mjs', rt(path.join(SKILL, 'task.mjs'))]]) {
      const [name, t] = f;
      if ([YO, YO2, D1, D2].some(ch => t.includes(ch))) bad.push(`${name}: е с точками или длинное тире`);
      if (/mcp__[0-9a-f]{8}-/.test(t)) bad.push(`${name}: UUID MCP`);
      const nm = t.match(NICHE); if (nm) bad.push(`${name}: нишевое слово «${nm[0]}»`);
    }
    check('файлы пакета F: без е с точками, длинных тире, UUID MCP и нишевых слов', !bad.length, bad.join('; '));
    const au = read('prompts/08-site-auditor.md'), fx = read('prompts/06-fixer.md');
    check('08-site-auditor: до 3000 знаков', au.length <= 3000, `${au.length} знаков`);
    check('08-site-auditor: первый экран 3-5 секунд, одно действие - одна надпись, пакет доверия, повторы, клоны, меню против H1, чипы, единый голос', ['3-5 секунд', 'Одно действие - одна надпись', 'Пакет доверия', 'Повтор аргумента', 'Клоны', 'Меню и подвал против H1', 'Чипы', 'Единый голос'].every(s => au.includes(s)));
    check('08-site-auditor: выход site.json по схеме, zone - только в отчет, label только из подписей группы, legacy не трогать, до 25 находок', au.includes('`work/audit/site.json`') && au.includes('`producer` «site-auditor»') && au.includes('только в отчет') && au.includes('`label` - только одна из подписей группы') && au.includes('Группу `legacy` не трогай') && au.includes('Не больше 25 находок') && au.includes('`needs_fact: true`'));
    check('06-fixer: постраничный site.json - файл находок, статусы как у cross; размер до 7500 (для бюджета)', fx.includes('`site.json` (аудитор прототипа,\n  постраничный)') && fx.includes('постраничных cross.json и site.json') && fx.length <= 7500, `${fx.length} знаков`);
    notes.push(`размер prompts/06-fixer.md: ${fx.length} знаков (бюджет cases-prompts.mjs 7400 -> 7500); 08-site-auditor.md: ${au.length}`);
  }
} catch (e) {
  fail++; failures.push(`FAIL исключение: ${e.stack || e.message}`);
} finally {
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* временная папка */ }
}

notes.forEach(n => console.log(`NOTE ${n}`));
failures.forEach(f => console.log(f));
console.log(`cases-site-audit: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
