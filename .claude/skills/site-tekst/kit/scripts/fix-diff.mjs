// Снимок блоков страницы до фиксера и сравнение после него (фаза 6, без LLM). Запуск из корня задачи:
//   node scripts/fix-diff.mjs <slug> --snap
//        lint-page страницы (свежие вердикты), копия блоков брифа в work/audit/<slug>/pre-fix/<block_id>.json и
//        _snap.json {id, created_at, blocks: {id: {sha, lint}}} (lint - вердикт lint-<block_id>.json после этого
//        lint-page); прежний снимок удаляется. Последняя строка - FIX_SNAP {"id":...}.
//   node scripts/fix-diff.mjs <slug> [--findings f1,f2] [--mode full|narrow] [--snap-id <id>]
//        сравнение со снимком после фиксера (--snap-id: только со снимком с этим id - снимок этого прогона; другой id или
//        none - «снимка нет»: без отката, признак правок выставлен):
//        1) откат: блок изменен, в снимке его lint был pass, а после правки lint.mjs не pass - файл блока возвращается из
//           снимка; то же для измененных блоков выше нетронутого, если после lint-page он перестал проходить (повторы и
//           бюджеты страницы считаются по соседям). Находки файлов --findings по откатанным блокам со статусом fixed -
//           снова open, resolution «откат: правка не прошла линтер (<правила>)». После отката - page-state.
//        2) признак правок утверждений (claims_changed): новое или измененное предложение (нормализованное предложение
//           нет в снимке страницы; удаление и перенос целого предложения - не новое), новое число, фиксер закрыл (fixed)
//           находку слепого читателя или находку категории fact; нет снимка - тоже true (проверить нечем).
//        3) lint-page страницы (свежий page_sha), новый снимок (основа для следующего фиксера), запись прохода в
//           work/audit/<slug>/fix-diff.json (runs, последние 20; after_round - наибольший N у round-N.json на момент
//           прохода: проход проверен судьей, если потом появился круг с большим номером; читает report.mjs, раздел
//           «Правки без проверки судьей»).
//        Последняя строка вывода - FIX_DIFF {json} (счеты и признаки; ее разбирает wf-06/wf-06b).
// Код выхода 0; 2 - нет slug или брифа.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { argv, P, exists, pageDir, loadBrief, elementTexts, splitSentences, nowIso } from './lib.mjs';
import { blockKey } from './progress.mjs';

const a = argv({ snap: 'bool' });
const slug = a._[0];
if (!slug) { console.error('usage: fix-diff.mjs <slug> [--snap] [--findings f1,f2] [--mode full|narrow]'); process.exit(2); }
if (!exists(path.join(pageDir(slug), 'brief.json'))) { console.error(`нет work/pages/${slug}/brief.json`); process.exit(2); }
const brief = loadBrief(slug);
const ids = (brief.blocks || []).map(b => b.block_id);
const AUDIT = P('work', 'audit', slug);
const SNAP = path.join(AUDIT, 'pre-fix');
const LOG = path.join(AUDIT, 'fix-diff.json');
const blockFile = id => path.join(pageDir(slug), 'blocks', `${id}.json`);
const rjs = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, '')); } catch { return null; } };
const sha = f => { try { return crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex'); } catch { return ''; } };
const lintOf = id => { const r = rjs(path.join(AUDIT, `lint-${id}.json`)); return r && typeof r.verdict === 'string' ? r.verdict : ''; };
const node = (...args) => spawnSync(process.execPath, args, { stdio: 'ignore' });

function snapshot() {
  // вердикты снимка - по свежему линтеру: страницу могли править руками после последнего lint-page (wf-06b), и
  // устаревший pass у сломанного блока откатил бы потом чужие правки
  node(path.join('scripts', 'lint-page.mjs'), slug);
  fs.rmSync(SNAP, { recursive: true, force: true });
  fs.mkdirSync(SNAP, { recursive: true });
  const blocks = {};
  for (const id of ids) {
    if (!exists(blockFile(id))) continue;
    fs.copyFileSync(blockFile(id), path.join(SNAP, `${id}.json`));
    blocks[id] = { sha: sha(blockFile(id)), lint: lintOf(id) };
  }
  const id = `${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`;
  fs.writeFileSync(path.join(SNAP, '_snap.json'), JSON.stringify({ id, created_at: nowIso(), blocks }, null, 2) + '\n');
  return { id, n: Object.keys(blocks).length };
}

if (a.snap) {
  const s = snapshot();
  console.log(`fix-diff ${slug}: снимок блоков ${s.n} -> work/audit/${slug}/pre-fix/`);
  console.log(`FIX_SNAP ${JSON.stringify({ id: s.id, blocks: s.n })}`);
  process.exit(0);
}

// ---------- сравнение ----------
const norm = s => String(s || '').toLowerCase().replace(/\u0451/g, 'е').replace(/[\u2014\u2013]/g, '-').replace(/[«»"„“”*_]/g, '')
  .replace(/\s+/g, ' ').trim().replace(/[\s.,;:!?-]+$/, '');
const readBlock = f => rjs(f) || {};
const textsOf = block => (block.elements || []).flatMap(el => elementTexts(el).map(t => t.text));
const sentencesOf = block => textsOf(block).flatMap(t => splitSentences(t)).map(s => ({ raw: s.trim(), key: norm(s) })).filter(s => s.key);
const numbersOf = block => textsOf(block).flatMap(t => String(t).match(/\d+(?:[.,]\d+)*/g) || []);
const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
// --snap-id: сравнивать только со снимком этого прогона (id из FIX_SNAP или прежнего FIX_DIFF); иначе снимка нет
const snapRead = rjs(path.join(SNAP, '_snap.json'));
const staleSnap = !!(snapRead && a['snap-id'] && snapRead.id !== a['snap-id']);
const snapMeta = staleSnap ? null : snapRead;
const files = String(a.findings || '').split(',').map(s => s.trim()).filter(Boolean);
const maxRound = () => Math.max(0, ...(exists(AUDIT) ? fs.readdirSync(AUDIT) : []).map(f => Number((f.match(/^round-(\d+)\.json$/) || [])[1]) || 0));
const out = { slug, mode: a.mode || 'full', no_snapshot: !snapMeta, blocks_changed: [], new_sentences: [], new_numbers: [], removed_sentences: 0,
  restored: [], reopened: 0, closed_blind: 0, closed_fact: 0, page_lint: '', claims_changed: true, after_round: maxRound() };

if (snapMeta) {
  const pre = Object.fromEntries(ids.filter(id => exists(path.join(SNAP, `${id}.json`))).map(id => [id, readBlock(path.join(SNAP, `${id}.json`))]));
  const snapLint = id => (snapMeta.blocks && snapMeta.blocks[id] && snapMeta.blocks[id].lint) || '';
  // измененные блоки: файл отличается от снимка, удален (при снимке) или новый (без снимка)
  const changed = () => ids.filter(id => (exists(blockFile(id)) ? !pre[id] || !same(readBlock(blockFile(id)), pre[id]) : !!pre[id]));
  // откатывать есть куда, только если в снимке блок проходил линтер
  const canRestore = id => !!pre[id] && snapLint(id) === 'pass';
  const restore = (id, why) => {
    fs.copyFileSync(path.join(SNAP, `${id}.json`), blockFile(id));
    node(path.join('scripts', 'lint.mjs'), blockFile(id), '--quiet');
    out.restored.push({ block: id, rules: why });
  };
  const seriousRules = id => {
    const r = rjs(path.join(AUDIT, `lint-${id}.json`));
    const rules = [...new Set(((r && r.findings) || []).filter(f => f.severity === 'blocker' || f.severity === 'major').map(f => f.rule || f.severity))];
    return rules.slice(0, 4).join(', ') || (r ? r.verdict : 'нет отчета');
  };
  // 1) измененный блок, который до правки проходил линтер, а после - нет (или файл удален)
  for (const id of changed().filter(canRestore)) {
    if (!exists(blockFile(id))) { restore(id, 'файл блока удален'); continue; }
    node(path.join('scripts', 'lint.mjs'), blockFile(id), '--quiet');
    if (lintOf(id) !== 'pass') restore(id, seriousRules(id));
  }
  node(path.join('scripts', 'lint-page.mjs'), slug);
  // 2) после lint-page: измененный блок не проходит, или сломался нетронутый (повтор, бюджет страницы считаются по
  //    соседям) - откат всех правок, которые есть куда откатить
  const ch = changed();
  const broken = ids.filter(id => snapLint(id) === 'pass' && exists(blockFile(id)) && lintOf(id) !== 'pass');
  const brokenUntouched = broken.filter(id => !ch.includes(id));
  // нетронутый блок могли сломать только правки выше него: повторы и бюджеты страницы lint-page считает по блокам выше
  // (порядок брифа, Р5) - измененные блоки ниже первого сломанного не откатываются
  const firstBroken = brokenUntouched.length ? Math.min(...brokenUntouched.map(id => ids.indexOf(id))) : -1;
  const second = ch.filter(id => canRestore(id) && (broken.includes(id) || (firstBroken >= 0 && ids.indexOf(id) < firstBroken)));
  if (second.length) {
    for (const id of second) restore(id, broken.includes(id) ? seriousRules(id) : `ломал блок ${brokenUntouched.join(', ')}`);
    node(path.join('scripts', 'lint-page.mjs'), slug);
  }
  if (out.restored.length) node(path.join('scripts', 'page-state.mjs'), slug);
  // находки по откатанным блокам снова открыты
  const back = new Map(out.restored.map(r => [blockKey(r.block), r.rules]));
  for (const f of files) {
    if (/lint-page\.json$/.test(f) || !back.size) continue;
    const file = P(f), doc = rjs(file);
    if (!doc || !Array.isArray(doc.findings)) continue;
    let n = 0;
    for (const x of doc.findings) {
      if (!x || x.status !== 'fixed' || !back.has(blockKey(x.block_id))) continue;
      x.status = 'open';
      x.resolution = `откат: правка не прошла линтер (${back.get(blockKey(x.block_id))})`;
      n++;
    }
    if (n) { fs.writeFileSync(file, JSON.stringify(doc, null, 2) + '\n'); out.reopened += n; }
  }
  // 3) что изменилось после отката
  const preSent = new Set(ids.flatMap(id => (pre[id] ? sentencesOf(pre[id]).map(s => s.key) : [])));
  const preNum = new Set(ids.flatMap(id => (pre[id] ? numbersOf(pre[id]) : [])));
  const postSent = new Set();
  for (const id of ids) {
    if (!exists(blockFile(id))) continue;
    const cur = readBlock(blockFile(id));
    if (pre[id] && same(cur, pre[id])) { sentencesOf(cur).forEach(s => postSent.add(s.key)); continue; }
    out.blocks_changed.push(id);
    for (const s of sentencesOf(cur)) {
      postSent.add(s.key);
      if (!preSent.has(s.key) && !out.new_sentences.some(x => x.block === id && norm(x.text) === s.key)) out.new_sentences.push({ block: id, text: s.raw });
    }
    for (const n of numbersOf(cur)) if (!preNum.has(n) && !out.new_numbers.some(x => x.value === n)) out.new_numbers.push({ block: id, value: n });
  }
  out.removed_sentences = [...preSent].filter(k => !postSent.has(k)).length;
}

// находки, закрытые фиксером: слепого читателя и категории fact
for (const f of files) {
  if (/lint-page\.json$/.test(f)) continue;
  const doc = rjs(P(f));
  if (!doc || !Array.isArray(doc.findings)) continue;
  const blind = doc.producer === 'blind-reader' || path.basename(f) === 'blind.json';
  for (const x of doc.findings) {
    if (!x || x.status !== 'fixed') continue;
    if (blind) out.closed_blind++;
    else if (x.category === 'fact' || /^fact\./.test(String(x.rule || ''))) out.closed_fact++;
  }
}
if (!out.no_snapshot) {
  out.claims_changed = !!(out.new_sentences.length || out.new_numbers.length || out.closed_blind || out.closed_fact);
  const lp = rjs(path.join(AUDIT, 'lint-page.json'));
  out.page_lint = lp && typeof lp.verdict === 'string' ? lp.verdict : '';
}
const next = snapshot();
const log = rjs(LOG) || { slug, runs: [] };
log.runs = [...(Array.isArray(log.runs) ? log.runs : []), { at: nowIso(), files, ...out }].slice(-20);
fs.mkdirSync(AUDIT, { recursive: true });
fs.writeFileSync(LOG, JSON.stringify(log, null, 2) + '\n');

const list = (arr, n = 6) => arr.slice(0, n).join(', ') + (arr.length > n ? ` и еще ${arr.length - n}` : '');
if (out.no_snapshot) console.log(`fix-diff ${slug}: снимка этого прогона до фиксера нет${staleSnap ? ' (снимок в pre-fix от другого прогона)' : ''} - сравнить и откатить нечем, признак правок утверждений: да; новый снимок сделан`);
else {
  console.log(`fix-diff ${slug}: изменено блоков ${out.blocks_changed.length}${out.blocks_changed.length ? ` (${list(out.blocks_changed)})` : ''}, новых предложений ${out.new_sentences.length}, чисел ${out.new_numbers.length}, удалено предложений ${out.removed_sentences}`);
  console.log(`  закрыто находок слепого ${out.closed_blind}, категории fact ${out.closed_fact}; lint-page ${out.page_lint || '-'}`);
  if (out.restored.length) console.log(`  откат (правка не прошла линтер): ${out.restored.map(r => `${r.block} (${r.rules})`).join('; ')}; находок снова open ${out.reopened}`);
}
const line = { claims_changed: out.claims_changed, no_snapshot: out.no_snapshot, blocks_changed: out.blocks_changed.length, new_sentences: out.new_sentences.length,
  new_numbers: out.new_numbers.length, closed_blind: out.closed_blind, closed_fact: out.closed_fact, restored: out.restored.map(r => r.block), reopened: out.reopened,
  page_lint: out.page_lint, snap_id: next.id };
console.log(`FIX_DIFF ${JSON.stringify(line)}`);
