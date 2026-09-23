// Перенумерация файлов блоков страницы под текущий brief.json (после пересборки брифа, когда блок выпал или добавился).
// node scripts/renumber-blocks.mjs <slug>
// Файл блока находится по типу (суффикс после «-»), получает новый block_id из брифа; блоки, которых в брифе больше нет,
// переносятся в work/pages/<slug>/_old/. Затем пересчитывается state.
import fs from 'node:fs';
import path from 'node:path';
import { pageDir, loadBrief, readJson, writeJson, exists } from './lib.mjs';
import { execSync } from 'node:child_process';

const slug = process.argv[2];
if (!slug) { console.error('usage: renumber-blocks.mjs <slug>'); process.exit(2); }
const brief = loadBrief(slug);
const dir = path.join(pageDir(slug), 'blocks');
const oldDir = path.join(pageDir(slug), '_old');
if (!exists(dir)) { console.log('нет папки блоков'); process.exit(0); }
const files = fs.readdirSync(dir).filter(f => /^B\d{2}-[a-z0-9-]+\.json$/.test(f));
const byType = {};
for (const f of files) { const type = f.replace(/^B\d{2}-/, '').replace(/\.json$/, ''); (byType[type] ??= []).push(f); }
const auditDir = path.join(process.cwd(), 'work', 'audit', slug);
let renamed = 0, moved = 0;
// сначала во временные имена, чтобы не затереть друг друга
const plan = [];
for (const b of brief.blocks) {
  const list = byType[b.type] || [];
  if (!list.length) continue;
  const src = list.shift();
  if (src !== `${b.block_id}.json`) plan.push({ src, dst: `${b.block_id}.json`, id: b.block_id });
}
for (const p of plan) fs.renameSync(path.join(dir, p.src), path.join(dir, p.src + '.tmp'));
for (const p of plan) {
  const data = readJson(path.join(dir, p.src + '.tmp'));
  data.block_id = p.id;
  writeJson(path.join(dir, p.dst), data);
  fs.unlinkSync(path.join(dir, p.src + '.tmp'));
  const oldLint = path.join(auditDir, `lint-${p.src.replace(/\.json$/, '')}.json`);
  if (exists(oldLint)) fs.unlinkSync(oldLint);
  renamed++;
}
// лишние (не в брифе) - в _old
for (const [type, list] of Object.entries(byType)) {
  const inBrief = brief.blocks.some(b => b.type === type);
  for (const f of list) {
    const cur = path.join(dir, f);
    if (!exists(cur)) continue;
    if (!inBrief) { fs.mkdirSync(oldDir, { recursive: true }); fs.renameSync(cur, path.join(oldDir, f)); moved++; const l = path.join(auditDir, `lint-${f.replace(/\.json$/, '')}.json`); if (exists(l)) fs.unlinkSync(l); }
  }
}
console.log(`переименовано: ${renamed}, убрано в _old: ${moved}`);
execSync(`node scripts/page-state.mjs ${slug}`, { stdio: 'inherit' });
