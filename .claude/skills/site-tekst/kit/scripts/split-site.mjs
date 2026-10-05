// Раскладка находок аудитора прототипа по страницам (фаза 8, wf-08-site-audit; без LLM). Отдельно от split-cross.mjs:
// у аудитора сайта свои правила (зоны оболочки, находки на весь сайт) и свой общий файл.
// node scripts/split-site.mjs                  work/audit/site.json -> work/audit/<slug>/site.json: только находки с page
//                                              (страница карты с брифом) и без zone; находка без page, с zone или на
//                                              страницу без брифа остается только в общем файле (в отчет, фиксеру не идет).
//                                              Последняя строка - SITE_SPLIT {"pages":[{slug, fixable, blocker, major}]}:
//                                              страницы с исправимыми blocker/major без needs_fact, blocker первыми.
// node scripts/split-site.mjs --merge          статусы и resolution постраничных копий -> обратно в work/audit/site.json
// node scripts/split-site.mjs --record "<имя>=<статус>;..." [--errors "<текст>|<текст>"]
//                                              итог шагов воркфлоу -> site.json run.steps (шаг с тем же именем заменяется) и
//                                              run.errors (дописываются); статусы ok | fail | skip | partial.
//                                              Нет site.json (аудитор не отработал) - пишется пустой отчет с run.
// node scripts/split-site.mjs --rollback "<причина>"
//                                              правки wf-08 откачены по снимку (шаг 8, SKILL.md): находки fixed - снова
//                                              open с resolution «правка откачена: <причина>», решения cta_unify - refused
//                                              без applied, в run - шаг rollback fail с причиной; отчет не покажет
//                                              откаченное как исправленное. Нет site.json - код 2.
// --merge и --record можно в одном вызове (сначала merge). Постраничный site.json не входит в находки страницы
// (progress.mjs pageFindings): готовность страниц и волны от него не меняются; retro-stats копии с split_from не считает.
// Находкам без id раскладка присваивает id в общем файле, нет created_at - ставит текущее время. Повторная раскладка того же
// отчета (тот же created_at) сохраняет статусы фиксеров; копии прежнего отчета удаляются.
// Код 0; 2 - нет work/audit/site.json (кроме --record) или в нем нет массива findings.
import fs from 'node:fs';
import { argv, P, exists, readJson, writeJson, finalizeVerdict, nowIso } from './lib.mjs';

export const REL = 'work/audit/site.json';
const STATUSES = new Set(['ok', 'fail', 'skip', 'partial']);
const a = argv({ merge: 'bool' });
const SRC = P('work', 'audit', 'site.json');
const pageFile = slug => P('work', 'audit', slug, 'site.json');
const copies = () => (exists(P('work', 'audit')) ? fs.readdirSync(P('work', 'audit'), { withFileTypes: true }) : []).filter(d => d.isDirectory())
  .map(d => pageFile(d.name)).filter(f => { if (!exists(f)) return false; try { return readJson(f).split_from === REL; } catch { return false; } });
const isOpen = f => !f.status || f.status === 'open';
const fixable = f => (f.severity === 'blocker' || f.severity === 'major') && !f.needs_fact && isOpen(f);

function emptyReport() {
  // аудита не было: вердикт не pass (отчет не должен выглядеть как чистый аудит)
  return { scope: 'site', producer: 'site-auditor', created_at: nowIso(), findings: [], verdict: 'blocked', summary: 'аудитор прототипа не записал отчет' };
}

if (typeof a.rollback === 'string') {
  if (!exists(SRC)) { console.error(`нет ${REL} - откатывать в отчете нечего`); process.exit(2); }
  const site = readJson(SRC);
  const why = a.rollback.trim() || 'причина не указана';
  let reopened = 0, refused = 0;
  for (const f of Array.isArray(site.findings) ? site.findings : []) {
    if (f.status !== 'fixed') continue;
    f.status = 'open'; f.resolution = `правка откачена: ${why}`; reopened++;
  }
  const cu = site.cta_unify;
  const items = Array.isArray(cu) ? cu : cu && typeof cu === 'object' ? (Array.isArray(cu.items) ? cu.items : Array.isArray(cu.labels) ? cu.labels : []) : [];
  for (const x of items) {
    if (!x || typeof x !== 'object' || x.status === 'refused') continue;
    x.status = 'refused'; x.applied = []; x.reason = `правка откачена: ${why}`; refused++;
  }
  const run = site.run && typeof site.run === 'object' ? site.run : {};
  const steps = (Array.isArray(run.steps) ? run.steps : []).filter(s => s && s.name !== 'rollback');
  steps.push({ name: 'rollback', status: 'fail', reason: why });
  site.run = { steps, errors: Array.isArray(run.errors) ? run.errors : [] };
  writeJson(SRC, site);
  console.log(`split-site --rollback: находок снова открыто ${reopened}, решений надписей отменено ${refused}`);
  process.exit(0);
}

if (a.merge || a.record !== undefined) {
  let site = exists(SRC) ? readJson(SRC) : null;
  if (!site && a.record === undefined) { console.error(`нет ${REL} - сначала аудитор прототипа`); process.exit(2); }
  if (!site) site = emptyReport();
  if (!Array.isArray(site.findings)) site.findings = [];
  const out = [];
  if (a.merge) {
    const byId = new Map(site.findings.map(f => [f.id, f]));
    let updated = 0;
    for (const f of copies()) for (const x of readJson(f).findings || []) {
      const g = byId.get(x.id);
      if (!g || (g.status === x.status && g.resolution === x.resolution)) continue;
      g.status = x.status; if (x.resolution != null) g.resolution = x.resolution; updated++;
    }
    const st = {}; site.findings.forEach(f => { st[f.status || 'open'] = (st[f.status || 'open'] || 0) + 1; });
    out.push(`split-site --merge: обновлено статусов ${updated}; итог ${JSON.stringify(st)}`);
  }
  if (typeof a.record === 'string') {
    const run = site.run && typeof site.run === 'object' ? site.run : {};
    const steps = Array.isArray(run.steps) ? run.steps : [];
    for (const part of a.record.split(';').map(s => s.trim()).filter(Boolean)) {
      const m = part.match(/^([^=]+)=(.+)$/);
      if (!m) continue;
      const name = m[1].trim(), status = STATUSES.has(m[2].trim()) ? m[2].trim() : 'fail';
      const i = steps.findIndex(s => s.name === name);
      if (i >= 0) steps[i] = { name, status }; else steps.push({ name, status });
    }
    const errors = Array.isArray(run.errors) ? run.errors : [];
    if (typeof a.errors === 'string') for (const e of a.errors.split('|').map(s => s.trim()).filter(Boolean)) if (!errors.includes(e)) errors.push(e);
    site.run = { steps, errors };
    out.push(`split-site --record: шагов ${steps.length} (${steps.map(s => `${s.name} ${s.status}`).join(', ')})${errors.length ? `, ошибок ${errors.length}` : ''}`);
  }
  writeJson(SRC, site);
  out.forEach(l => console.log(l));
  process.exit(0);
}

if (!exists(SRC)) { console.error(`нет ${REL} - сначала аудитор прототипа`); process.exit(2); }
const site = readJson(SRC);
if (!Array.isArray(site.findings)) { console.error(`в ${REL} нет массива findings`); process.exit(2); }
let added = 0;
site.findings.forEach((f, i) => { if (!f.id) { f.id = `site-auditor-${String(i + 1).padStart(3, '0')}`; added++; } });
const stampAdded = !site.created_at;
if (stampAdded) site.created_at = nowIso();
if (added || stampAdded) writeJson(SRC, site);
const stamp = site.created_at;
// фиксеру - только находки на страницу карты с брифом и без зоны оболочки
const hasBrief = slug => /^[a-z0-9][a-z0-9-]*$/i.test(String(slug)) && exists(P('work', 'pages', String(slug), 'brief.json'));
const groups = {};
let zoned = 0, noPage = 0, noBrief = 0;
for (const f of site.findings) {
  if (f.zone) { zoned++; continue; }
  if (!f.page) { noPage++; continue; }
  if (!hasBrief(f.page)) { noBrief++; continue; }
  (groups[f.page] ??= []).push(f);
}
const keep = new Map();
let removed = 0;
for (const f of copies()) {
  const c = readJson(f);
  if (c.source_created_at === stamp) { (c.findings || []).forEach(x => keep.set(x.id, x)); continue; }
  fs.rmSync(f, { force: true }); removed++;
}
const sm = exists(P('work', 'sitemap.json')) ? readJson(P('work', 'sitemap.json')) : { pages: [] };
const order = Object.fromEntries((sm.pages || []).map((p, i) => [p.slug, i]));
const rows = [], pages = [];
for (const [slug, list] of Object.entries(groups)) {
  const rep = { scope: slug, producer: 'site-auditor', created_at: stamp, source_created_at: stamp, split_from: REL,
    findings: list.map(f => { const k = keep.get(f.id); return k ? { ...f, status: k.status, resolution: k.resolution } : { status: 'open', ...f }; }),
    verdict: 'pass', summary: '' };
  finalizeVerdict(rep);
  writeJson(pageFile(slug), rep);
  const fx = rep.findings.filter(fixable);
  rows.push(`${slug}: ${rep.summary}${fx.length ? `, к фиксеру ${fx.length}` : ''}`);
  if (fx.length) pages.push({ slug, fixable: fx.length, blocker: fx.filter(f => f.severity === 'blocker').length, major: fx.filter(f => f.severity === 'major').length });
}
pages.sort((x, y) => y.blocker - x.blocker || y.major - x.major || (order[x.slug] ?? 1e9) - (order[y.slug] ?? 1e9));
const rest = [zoned ? `с зоной ${zoned}` : '', noPage ? `без page ${noPage}` : '', noBrief ? `на страницу без брифа ${noBrief}` : ''].filter(Boolean);
console.log(`split-site: страниц ${rows.length}, находок ${site.findings.length}${rest.length ? `; только в отчет: ${rest.join(', ')}` : ''}${added ? `, присвоено id ${added}` : ''}${stampAdded ? ', created_at поставлен' : ''}${removed ? `, копий прежнего отчета удалено ${removed}` : ''}`);
rows.slice(0, 25).forEach(r => console.log('  ' + r));
console.log(`SITE_SPLIT ${JSON.stringify({ pages })}`);
