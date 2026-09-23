// Замер объемов секций по всем снимкам конкурентов.
// node scripts/measure-blocks.mjs [--raw work/competitors/raw] [--out work/competitors/measurements.csv] [--if-stale]
// Читает fetch-page JSON, тип страницы берет из work/competitors/competitors.json (pages[].url -> type).
// Выход: CSV domain,type,url,status,level,heading,chars,words + сводка по типу в measurements.summary.json
// --if-stale: ничего не делать, если CSV и сводка новее competitors.json и всех снимков (повторный вызов из агрегатора дешевый).
// Файлы пишутся через временный файл и переименование: параллельный читатель не увидит половину файла.
import fs from 'node:fs';
import path from 'node:path';
import { argv, P, walk, readJson, exists } from './lib.mjs';

const a = argv({ 'if-stale': 'bool' });
const rawDir = a.raw || P('work', 'competitors', 'raw');
const outCsv = a.out || P('work', 'competitors', 'measurements.csv');
const outSummary = outCsv.replace(/\.csv$/, '.summary.json');
const compFile = P('work', 'competitors', 'competitors.json');
if (a['if-stale'] && exists(outCsv) && exists(outSummary)) {
  const mtime = f => fs.statSync(f).mtimeMs;
  const own = Math.min(mtime(outCsv), mtime(outSummary));
  const inputs = [...walk(rawDir, '.json'), ...(exists(compFile) ? [compFile] : [])];
  if (inputs.every(f => mtime(f) <= own)) {
    console.log(`замер свежий, пропуск: ${path.relative(process.cwd(), outSummary)} новее ${inputs.length} входных файлов`);
    process.exit(0);
  }
}
function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, text, 'utf8');
  try { fs.renameSync(tmp, file); }
  catch { fs.writeFileSync(file, text, 'utf8'); try { fs.unlinkSync(tmp); } catch {} }
}
const typeByUrl = new Map();
if (exists(compFile)) {
  for (const c of readJson(compFile).competitors || []) for (const pg of c.pages || []) typeByUrl.set(pg.url.replace(/\/$/, ''), pg.type);
}
const rows = [];
const perType = {};
for (const f of walk(rawDir, '.json')) {
  let d; try { d = readJson(f); } catch { continue; }
  if (!d.url || !Array.isArray(d.sections)) continue;
  if (!['ok', 'browser'].includes(d.status)) continue;
  let domain = ''; try { domain = new URL(d.url).host; } catch {}
  const type = typeByUrl.get(d.url.replace(/\/$/, '')) || d.type || 'unknown';
  const total = d.sections.reduce((s, x) => s + x.chars, 0);
  perType[type] ??= { pages: 0, total_chars: [], sections: [], h2_count: [] };
  perType[type].pages++;
  perType[type].total_chars.push(total);
  perType[type].h2_count.push(d.sections.filter(s => s.level === 2).length);
  for (const s of d.sections) {
    rows.push([domain, type, d.url, d.status, s.level, csv(s.heading), s.chars, s.words].join(','));
    if (s.level > 0) perType[type].sections.push(s.chars);
  }
}
function csv(s) { return '"' + String(s || '').replace(/"/g, '""') + '"'; }
function q(arr, p) { if (!arr.length) return 0; const s = [...arr].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))]; }
const summary = {};
for (const [t, v] of Object.entries(perType)) {
  summary[t] = {
    pages: v.pages,
    total_chars: { q1: q(v.total_chars, 0.25), median: q(v.total_chars, 0.5), q3: q(v.total_chars, 0.75) },
    section_chars: { q1: q(v.sections, 0.25), median: q(v.sections, 0.5), q3: q(v.sections, 0.75), n: v.sections.length },
    h2_count: { median: q(v.h2_count, 0.5) },
  };
}
writeAtomic(outCsv, 'domain,type,url,status,level,heading,chars,words\n' + rows.join('\n') + '\n');
writeAtomic(outSummary, JSON.stringify(summary, null, 2) + '\n');
console.log(`секций: ${rows.length}, типов: ${Object.keys(summary).length}, файл: ${path.relative(process.cwd(), outCsv)}`);
for (const [t, s] of Object.entries(summary)) console.log(`  ${t}: страниц ${s.pages}, объем страницы медиана ${s.total_chars.median} (${s.total_chars.q1}-${s.total_chars.q3}), секция медиана ${s.section_chars.median}, h2 медиана ${s.h2_count.median}`);
