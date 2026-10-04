// Раскладка находок кросс-судьи по страницам, чтобы фиксеры разных страниц не писали в один файл (без LLM).
// node scripts/split-cross.mjs            work/audit/cross.json -> work/audit/<slug>/cross.json (только находки с page == slug)
// node scripts/split-cross.mjs --merge    статусы и resolution из постраничных файлов -> обратно в work/audit/cross.json
// После раскладки общий файл только для чтения: фиксер правит статусы в своем постраничном. Находкам без id раскладка
// присваивает id в общем файле (иначе merge не сопоставит), нет created_at - ставит текущее время. Повторная раскладка
// того же отчета (тот же created_at) сохраняет статусы фиксеров; постраничные копии от прежнего отчета не удаляются, а
// переименовываются в work/audit/<slug>/cross-archive-<stamp>.json (stamp - время прежнего отчета без двоеточий и точек):
// по ним фиксер не возвращает исправленные повторы, отчет выводит раздел «Повторы между страницами». Метка split_from -
// признак копии для сводок (retro-stats копии и архивы не считает).
import fs from 'node:fs';
import path from 'node:path';
import { argv, P, exists, readJson, writeJson, finalizeVerdict, nowIso } from './lib.mjs';
import { archiveName, isCrossArchive } from './progress.mjs';

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

// id для сопоставления при merge; время отчета - для меток копий и архивов
let added = 0;
cross.findings.forEach((f, i) => { if (!f.id) { f.id = `cross-judge-${String(i + 1).padStart(3, '0')}`; added++; } });
const stampAdded = !cross.created_at;
if (stampAdded) cross.created_at = nowIso();
if (added || stampAdded) writeJson(SRC, cross);
const stamp = cross.created_at;
const groups = {};
for (const f of cross.findings) if (f.page) (groups[f.page] ??= []).push(f);
// прежние копии от другого отчета - в архив рядом, от этого же - взять статусы
const keep = new Map();
const archived = [];
for (const f of copies()) {
  const c = readJson(f);
  if (c.source_created_at === stamp) { (c.findings || []).forEach(x => keep.set(x.id, x)); continue; }
  const to = path.join(path.dirname(f), archiveName(c.source_created_at || c.created_at));
  if (isCrossArchive(to)) { fs.renameSync(f, to); archived.push(path.basename(path.dirname(f))); }
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
console.log(`split-cross: страниц ${rows.length}, находок ${cross.findings.length - orphan}${orphan ? `, без page ${orphan} (остались только в ${REL})` : ''}${added ? `, присвоено id ${added}` : ''}${stampAdded ? ', created_at поставлен' : ''}${archived.length ? `, копий прежнего отчета в архив ${archived.length}` : ''}`);
rows.forEach(r => console.log('  ' + r));
