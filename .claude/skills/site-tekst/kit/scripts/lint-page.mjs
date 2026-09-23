// Линт всех блоков страницы одним отчетом. node scripts/lint-page.mjs <slug> [--fix]
// Пишет work/audit/<slug>/lint-page.json (findings всех блоков) и печатает сводку. Код выхода 1 при blocker/major.
// Бюджеты страницы (ai.contrast, ai.neg-pitch, word.overuse, placeholder.count) считаются по всей странице в порядке
// блоков брифа: первые N вхождений законны, major - на блоки с вхождениями сверх бюджета (scripts/lint-common.mjs).
// word.overuse major только здесь: в lint.mjs и в строках блоков ниже он minor, вердикт блока от него не зависит.
import path from 'node:path';
import { execSync } from 'node:child_process';
import { argv, P, pageDir, loadBrief, loadBlocks, loadConfig, blockPlainText, exists, readJson, writeJson, makeFindings, finalizeVerdict } from './lib.mjs';
import { compileLint, scanBlock, applyPageBudgets, pageRuleIds, showMinor } from './lint-common.mjs';

const a = argv({ fix: 'bool' });
const slug = a._[0];
if (!slug) { console.error('usage: lint-page.mjs <slug> [--fix]'); process.exit(2); }
const brief = loadBrief(slug);
const R = compileLint(readJson(P('rules', 'lint.json')), brief, loadConfig());
const PAGE_RULES = pageRuleIds(R);
const report = makeFindings(slug, 'lint');
const perBlock = [];
for (const b of brief.blocks) {
  const f = path.join(pageDir(slug), 'blocks', `${b.block_id}.json`);
  if (!exists(f)) { perBlock.push(`${b.block_id}: нет файла`); continue; }
  try { execSync(`node scripts/lint.mjs "${f}" --quiet${a.fix ? ' --fix' : ''}`, { stdio: 'ignore' }); } catch {}
  const rep = P('work', 'audit', slug, `lint-${b.block_id}.json`);
  if (!exists(rep)) { perBlock.push(`${b.block_id}: отчет не создан`); continue; }
  const r = readJson(rep);
  // страничные правила пересчитываются ниже по всей странице
  for (const x of r.findings) if (!PAGE_RULES.has(x.rule)) report.findings.push({ ...x, id: `${b.block_id}:${x.id}` });
  perBlock.push(`${b.block_id}: ${r.verdict} (${r.summary})`);
}
const blocks = loadBlocks(slug);
// бюджеты страницы: ai.contrast, ai.neg-pitch, word.overuse, placeholder.count
{
  const seq = blocks.map(({ block }) => ({ block_id: block.block_id, scan: scanBlock(block, R) }));
  const paged = applyPageBudgets(seq, R);
  for (const { block_id } of seq) (paged.get(block_id) || []).forEach((f, i) => report.findings.push({ id: `${block_id}:page-${String(i + 1).padStart(3, '0')}`, page: slug, block_id, status: 'open', auto_fixable: false, ...f }));
}
// уровень страницы: перебор коротких фраз (2-граммы в 4+ блоках)
{
  const norm = s => s.toLowerCase().replace(/\[\[[^\]]+\]\]/g, ' ').replace(/[^a-zа-я0-9 ]+/gi, ' ').split(/\s+/).filter(Boolean);
  const protectedText = [...(brief.terminology?.use || []).map(t => t.say), brief.cta?.main || '', brief.cta?.secondary || '', ...(brief.facts || []).map(f => f.wording), brief.company || ''].join(' \n ');
  const prot = new Set(); { const w = norm(protectedText); for (let i = 0; i + 2 <= w.length; i++) prot.add(w.slice(i, i + 2).join(' ')); }
  const STOP = new Set(['для', 'что', 'это', 'как', 'или', 'при', 'его', 'она', 'они', 'вас', 'ваш', 'вам', 'нас', 'наш', 'уже', 'еще', 'все', 'так', 'там', 'тут', 'где', 'кто', 'чем', 'том', 'той', 'тот', 'эта', 'эти', 'без', 'над', 'под', 'про', 'между']);
  const usage = {};
  blocks.forEach(({ block }, order) => {
    const w = norm(blockPlainText(block));
    const seen = new Set();
    for (let i = 0; i + 2 <= w.length; i++) {
      const a = w[i], b = w[i + 1];
      if (STOP.has(a) || STOP.has(b)) continue;
      if (!(a.length >= 5 || b.length >= 5) || (a.length < 2 || b.length < 2)) continue;
      if (a.length + b.length < 9) continue;
      const g = a + ' ' + b;
      if (prot.has(g) || seen.has(g)) continue;
      seen.add(g);
      (usage[g] ??= []).push({ id: block.block_id, order });
    }
  });
  const OVERUSE_BLOCKS = 4;
  for (const [g, list] of Object.entries(usage)) {
    if (list.length < OVERUSE_BLOCKS) continue;
    for (const { id } of list.slice(2)) report.findings.push({ id: `${id}:overuse:${g}`, page: slug, block_id: id, severity: 'major', category: 'repeat', rule: 'phrase.overuse', quote: g, problem: `«${g}» звучит в ${list.length} блоках (${list.map(x => x.id).join(', ')})`, proposal: 'оставить в двух блоках, здесь сказать иначе или сослаться одним словом', status: 'open' });
  }
}
finalizeVerdict(report);
writeJson(P('work', 'audit', slug, 'lint-page.json'), report);
console.log(`lint-page ${slug}: ${report.verdict} (${report.summary})`);
perBlock.forEach(l => console.log('  ' + l));
const byRule = {}, minorByRule = {};
for (const f of report.findings) {
  if (f.severity !== 'minor') byRule[f.rule] = (byRule[f.rule] || 0) + 1;
  else if (showMinor(f.rule)) minorByRule[f.rule] = (minorByRule[f.rule] || 0) + 1;
}
console.log('  по правилам:', JSON.stringify(byRule));
console.log('  minor ai.*, style.*, fact.claim-unsupported:', JSON.stringify(minorByRule));
process.exit(report.verdict === 'pass' ? 0 : 1);
