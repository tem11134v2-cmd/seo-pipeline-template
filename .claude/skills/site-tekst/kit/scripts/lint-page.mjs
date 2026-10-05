// Линт всех блоков страницы одним отчетом. node scripts/lint-page.mjs <slug> [--fix]
// Пишет work/audit/<slug>/lint-page.json (findings всех блоков) и печатает сводку. Код выхода 1 при blocker/major.
// Бюджеты страницы (ai.contrast, ai.neg-pitch, word.overuse, placeholder.count) считаются по всей странице в порядке
// блоков брифа: первые N вхождений законны, major - на блоки с вхождениями сверх бюджета (scripts/lint-common.mjs).
// word.overuse major только здесь: в lint.mjs и в строках блоков ниже он minor, вердикт блока от него не зависит.
// Перед отчетом пересобирает page.md (render-md.mjs) и пишет в отчет page_sha - sha1 page.md: аудит страницы свежий,
// пока page_sha совпадает с текущим page.md (сравнений по времени файлов нет).
// Блоки линтуются по порядку брифа с флагом --page: повтор фраз (phrase.repeat) - только с прошедшими линтер блоками
// выше (решение Р5): фраза, вставленная ниже, не переворачивает вердикт готового блока, находка одна - у нижнего блока.
// Предмет страницы, ключевая фраза и компания повтором (phrase.overuse) не считаются.
// editorial.few-headings (minor): от 5 написанных блоков меньше 2 h2 на странице.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { argv, P, pageDir, loadBrief, loadBlocks, loadConfig, blockPlainText, exists, readJson, writeJson, makeFindings, finalizeVerdict, protectedFactTexts } from './lib.mjs';
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
  spawnSync(process.execPath, [path.join('scripts', 'lint.mjs'), f, '--quiet', '--page', ...(a.fix ? ['--fix'] : [])], { stdio: 'ignore' });
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
  const protectedText = [...(brief.terminology?.use || []).map(t => t.say), brief.cta?.main || '', brief.cta?.secondary || '', ...protectedFactTexts(brief), brief.company || '', brief.subject || '', brief.key_phrase || ''].join(' \n ');
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
// мало заголовков (редакционный стандарт, правило 3: h2 необязателен у блоков вне первого экрана): от 5 написанных
// блоков и меньше 2 h2 на странице - minor, вердикт не меняет
{
  const MIN_BLOCKS = 5, MIN_H2 = 2;
  const h2 = blocks.reduce((n, { block }) => n + (block.elements || []).filter(e => e && e.kind === 'h2' && String(e.text || '').trim()).length, 0);
  if (blocks.length >= MIN_BLOCKS && h2 < MIN_H2) report.findings.push({ id: 'page:few-headings', page: slug, severity: 'minor', category: 'structure', rule: 'editorial.few-headings', problem: `мало заголовков: ${h2} h2 на ${blocks.length} написанных блоков`, proposal: `дать h2 блокам, где заголовок называет раздел для читателя (не меньше ${MIN_H2} на странице)`, status: 'open', auto_fixable: false });
}
finalizeVerdict(report);
// page.md по текущим блокам и его sha1
{
  const md = path.join(pageDir(slug), 'page.md');
  if (exists(P('scripts', 'render-md.mjs'))) spawnSync(process.execPath, [path.join('scripts', 'render-md.mjs'), slug], { stdio: 'ignore' });
  report.page_sha = exists(md) ? crypto.createHash('sha1').update(fs.readFileSync(md)).digest('hex') : '';
}
writeJson(P('work', 'audit', slug, 'lint-page.json'), report);
console.log(`lint-page ${slug}: ${report.verdict} (${report.summary})`);
perBlock.forEach(l => console.log('  ' + l));
const byRule = {}, minorByRule = {};
for (const f of report.findings) {
  if (f.severity !== 'minor') byRule[f.rule] = (byRule[f.rule] || 0) + 1;
  else if (showMinor(f.rule)) minorByRule[f.rule] = (minorByRule[f.rule] || 0) + 1;
}
console.log('  по правилам:', JSON.stringify(byRule));
console.log('  minor ai.*, style.*, editorial.*, fact.claim-unsupported:', JSON.stringify(minorByRule));
process.exit(report.verdict === 'pass' ? 0 : 1);
