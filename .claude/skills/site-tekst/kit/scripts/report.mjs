// Итоговый отчет по прогону. node scripts/report.mjs
import path from 'node:path';
import { P, readJson, exists, writeText, loadConfig, loadSitemap, pageDir, listFiles, loadBlocks, blockPlainText, PLACEHOLDER_RE, nowIso } from './lib.mjs';

const cfg = loadConfig();
const sm = loadSitemap();
const facts = exists(P('work', 'facts.json')) ? readJson(P('work', 'facts.json')) : { gaps: [] };
const lines = [];
lines.push(`# Отчет по текстам: ${cfg.company || cfg.slug}`);
lines.push(`Дата: ${nowIso()}`);
lines.push('');
const rows = [];
let totals = { pages: 0, done: 0, blocks: 0, blocks_expected: 0, placeholders: 0, blocked: 0 };
const openBySev = { blocker: 0, major: 0, minor: 0 };
for (const p of sm.pages) {
  if (p.status === 'skip') continue;
  totals.pages++;
  const dir = pageDir(p.slug);
  if (!exists(path.join(dir, 'brief.json'))) { rows.push(`| ${p.url} | ${p.type} | - | нет брифа | | | ${p.status} |`); continue; }
  const blocks = loadBlocks(p.slug);
  const brief = readJson(path.join(dir, 'brief.json'));
  totals.blocks += blocks.length; totals.blocks_expected += brief.blocks.length;
  const ph = blocks.reduce((s, b) => s + (blockPlainText(b.block).match(PLACEHOLDER_RE) || []).length, 0);
  totals.placeholders += ph;
  const auditDir = path.join(process.cwd(), 'work', 'audit', p.slug);
  const rounds = listFiles(auditDir, '.json').filter(f => /round-\d+\.json$/.test(f)).sort();
  let open = { blocker: 0, major: 0, minor: 0 };
  if (rounds.length) {
    const last = readJson(rounds[rounds.length - 1]);
    for (const f of last.findings) if (f.status === 'open' || !f.status) open[f.severity]++;
  }
  const lintDirty = listFiles(auditDir, '.json').filter(f => /lint-/.test(f)).filter(f => readJson(f).verdict !== 'pass').length;
  Object.keys(open).forEach(k => openBySev[k] += open[k]);
  if (p.status === 'done') totals.done++;
  if (p.status === 'blocked') totals.blocked++;
  rows.push(`| ${p.url} | ${p.type} | ${p.block_set || 'full'} | ${blocks.length}/${brief.blocks.length} | ${lintDirty ? 'грязных ' + lintDirty : 'чисто'} | ${rounds.length} кругов, открыто: ${open.blocker}/${open.major}/${open.minor} | ${ph} | ${p.status} |`);
}
lines.push(`## Итого`);
lines.push(`- Страниц в работе: ${totals.pages}, готово: ${totals.done}, заблокировано: ${totals.blocked}`);
lines.push(`- Блоков написано: ${totals.blocks} из ${totals.blocks_expected}`);
lines.push(`- Пометок «нужны данные»: ${totals.placeholders}`);
lines.push(`- Открытых находок аудита (blocker/major/minor): ${openBySev.blocker}/${openBySev.major}/${openBySev.minor}`);
const dedup = P('work', 'audit', 'dedup.json');
if (exists(dedup)) { const d = readJson(dedup); lines.push(`- Повторы между страницами: ${d.findings.length} (${d.summary})`); }
const htmlCheck = P('work', 'audit', 'html-check.json');
if (exists(htmlCheck)) { const h = readJson(htmlCheck); lines.push(`- Прототип: ${h.verdict} (${h.summary}), страниц ${h.scores?.pages ?? '-'}`); }
const pub = P('work', 'catalog', 'publish.json');
if (exists(pub)) { const c = readJson(pub); lines.push(`- ТЗ на каталог: ${c.url || c.doc_url || 'опубликовано'}`); }
lines.push('');
lines.push('## По страницам');
lines.push('| URL | тип | набор | блоков | линтер | аудит | пометок | статус |');
lines.push('|---|---|---|---|---|---|---|---|');
lines.push(...rows);
lines.push('');
lines.push('## Где не хватило данных');
if (facts.gaps?.length) facts.gaps.forEach(g => lines.push(`- ${g}`)); else lines.push('- нет записей');
const phList = [];
for (const p of sm.pages) {
  if (p.status === 'skip' || !exists(path.join(pageDir(p.slug), 'brief.json'))) continue;
  for (const { block } of loadBlocks(p.slug)) for (const m of (blockPlainText(block).match(PLACEHOLDER_RE) || [])) phList.push(`- ${p.url} / ${block.block_id}: ${m}`);
}
if (phList.length) { lines.push(''); lines.push('### Пометки в текстах'); lines.push(...phList); }
const decisions = P('rules', 'decisions.md');
if (exists(decisions)) { lines.push(''); lines.push('## Решения по проекту'); lines.push('См. `rules/decisions.md`.'); }
writeText(P('work', 'output', 'report.md'), lines.join('\n') + '\n');
console.log(`отчет: work/output/report.md (страниц ${totals.pages}, блоков ${totals.blocks}/${totals.blocks_expected}, пометок ${totals.placeholders})`);
