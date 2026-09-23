// Параметры для воркфлоу фаз 2-4: типы страниц из карты, число страниц по типу, снимки конкурентов.
// node scripts/prep-args.mjs [--types a,b] [--snapshots [--snapshot-types a,b] [--domains d1,d2]] [--small-max 2] [--solo home]
// stdout - JSON-фрагмент для args воркфлоу: {"types":[...],"type_pages":{"<type>":N}[, "snapshots":[{domain,type,url,raw,status}]]}.
//   types - уникальные типы страниц карты (без status skip) в порядке первого появления; --types оставляет только эти типы.
//   type_pages - число страниц типа; по нему воркфлоу отделяют мелкие типы (<= small_type_max) и обрабатывают их пакетами.
//   --snapshots - снимки конкурентов из work/competitors/competitors.json (конкурент status ok, страница ok/browser,
//   файл снимка есть на диске); фильтры --snapshot-types и --domains (без них - все); нужны для wf-02 с skipInventory.
// stderr - сводка: какие типы мелкие при пороге --small-max (по умолчанию 2) без --solo (по умолчанию home).
import { argv, P, readJson, exists, loadSitemap } from './lib.mjs';

const a = argv({ snapshots: 'bool' });
const list = v => v ? String(v).split(',').map(s => s.trim()).filter(Boolean) : null;
const only = list(a.types);
const snapTypes = list(a['snapshot-types']);
const snapDomains = list(a.domains);
const sm = loadSitemap();
const typePages = {};
for (const p of sm.pages) {
  if (p.status === 'skip' || !p.type) continue;
  if (only && !only.includes(p.type)) continue;
  typePages[p.type] = (typePages[p.type] || 0) + 1;
}
if (only) for (const t of only) if (!(t in typePages)) { typePages[t] = 0; console.error(`тип ${t}: в карте нет страниц`); }
const out = { types: Object.keys(typePages), type_pages: typePages };

if (a.snapshots) {
  const f = P('work', 'competitors', 'competitors.json');
  if (!exists(f)) { console.error('нет work/competitors/competitors.json'); process.exit(2); }
  out.snapshots = [];
  let missing = 0;
  for (const c of readJson(f).competitors || []) {
    if (c.status !== 'ok' || (snapDomains && !snapDomains.includes(c.domain))) continue;
    for (const pg of c.pages || []) {
      if (!['ok', 'browser'].includes(pg.status)) continue;
      if (snapTypes && !snapTypes.includes(pg.type)) continue;
      if (!pg.raw || !exists(P(pg.raw))) { missing++; console.error(`нет файла снимка: ${pg.raw || '(пусто)'} (${c.domain}, ${pg.type})`); continue; }
      out.snapshots.push({ domain: c.domain, type: pg.type, url: pg.url, raw: pg.raw.replace(/\\/g, '/'), status: pg.status });
    }
  }
  console.error(`снимков: ${out.snapshots.length}${missing ? `, без файла: ${missing}` : ''}`);
}

const smallMax = a['small-max'] == null ? 2 : Number(a['small-max']);
const solo = (a.solo == null ? 'home' : a.solo).split(',').map(s => s.trim()).filter(Boolean);
const small = out.types.filter(t => !solo.includes(t) && typePages[t] <= smallMax);
console.error(`типов: ${out.types.length}, страниц: ${Object.values(typePages).reduce((s, n) => s + n, 0)}; мелкие (<= ${smallMax}, кроме ${solo.join(', ') || '-'}): ${small.join(', ') || 'нет'}`);
console.log(JSON.stringify(out, null, 2));
