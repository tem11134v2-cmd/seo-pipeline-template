// Раскладка находок кросс-судьи по страницам, чтобы фиксеры разных страниц не писали в один файл (без LLM).
// node scripts/split-cross.mjs            work/audit/cross.json -> work/audit/<slug>/cross.json (только находки с page == slug)
// node scripts/split-cross.mjs --merge    статусы и resolution из постраничных файлов -> обратно в work/audit/cross.json
// После раскладки общий файл только для чтения: фиксер правит статусы в своем постраничном. Находкам без id раскладка
// присваивает id в общем файле (иначе merge не сопоставит). Повторная раскладка того же отчета (тот же created_at) сохраняет
// статусы фиксеров; постраничные файлы от прежнего отчета удаляются. Метка split_from - признак копии для сводок.
import fs from 'node:fs';
import { argv, P, exists, readJson, writeJson, finalizeVerdict } from './lib.mjs';

const a = argv({ merge: 'bool' });
const SRC = P('work', 'audit', 'cross.json');
const REL = 'work/audit/cross.json';
if (!exists(SRC)) { console.error(`нет ${REL} - сначала кросс-судья`); process.exit(2); }
const cross = readJson(SRC);
if (!Array.isArray(cross.findings)) { console.error(`в ${REL} нет массива findings`); process.exit(2); }
const pageFile = slug => P('work', 'audit', slug, 'cross.json');
const copies = () => fs.readdirSync(P('work', 'audit'), { withFileTypes: true }).filter(d => d.isDirectory())
  .map(d => pageFile(d.name)).filter(f => exists(f) && readJson(f).split_from === REL);

if (a.merge) {
  const byId = new Map(cross.findings.map(f => [f.id, f]));
  let updated = 0;
  for (const f of copies()) for (const x of readJson(f).findings || []) {
    const g = byId.get(x.id);
    if (!g || (g.status === x.status && g.resolution === x.resolution)) continue;
    g.status = x.status; if (x.resolution != null) g.resolution = x.resolution; updated++;
  }
  writeJson(SRC, cross);
  const st = {}; cross.findings.forEach(f => { st[f.status || 'open'] = (st[f.status || 'open'] || 0) + 1; });
  console.log(`split-cross --merge: обновлено статусов ${updated}; итог ${JSON.stringify(st)}`);
  process.exit(0);
}

// id для сопоставления при merge
let added = 0;
cross.findings.forEach((f, i) => { if (!f.id) { f.id = `cross-judge-${String(i + 1).padStart(3, '0')}`; added++; } });
if (added) writeJson(SRC, cross);
const stamp = cross.created_at || '';
const groups = {};
for (const f of cross.findings) if (f.page) (groups[f.page] ??= []).push(f);
// прежние копии от другого отчета - удалить, от этого же - взять статусы
const keep = new Map();
for (const f of copies()) {
  const c = readJson(f);
  if (c.source_created_at === stamp) (c.findings || []).forEach(x => keep.set(x.id, x));
  else fs.unlinkSync(f);
}
const rows = [];
for (const [slug, list] of Object.entries(groups)) {
  const rep = { scope: slug, producer: 'cross-judge', round: cross.round || 1, created_at: stamp, source_created_at: stamp, split_from: REL,
    findings: list.map(f => { const k = keep.get(f.id); return k ? { ...f, status: k.status, resolution: k.resolution } : { status: 'open', ...f }; }),
    verdict: 'pass', summary: '' };
  finalizeVerdict(rep);
  writeJson(pageFile(slug), rep);
  const fixable = list.filter(f => f.severity !== 'minor' && !f.needs_fact).length;
  rows.push(`${slug}: ${rep.summary}${fixable ? `, к фиксеру ${fixable}` : ''}`);
}
const orphan = cross.findings.filter(f => !f.page).length;
console.log(`split-cross: страниц ${rows.length}, находок ${cross.findings.length - orphan}${orphan ? `, без page ${orphan} (остались только в ${REL})` : ''}${added ? `, присвоено id ${added}` : ''}`);
rows.forEach(r => console.log('  ' + r));
