// Перенумерация файлов блоков страницы под текущий brief.json (после пересборки брифа, когда блок выпал или добавился).
// node scripts/renumber-blocks.mjs <slug>
// Файл блока находится по типу (суффикс после «-»), получает новый block_id из брифа; его отчет линтера
// work/audit/<slug>/lint-<block_id>.json переносится под новый id (scope и block_id находок - тоже), чтобы
// перенумерованный блок не считался ненаписанным. Блоки, которых в брифе больше нет (и лишние копии одного типа),
// переносятся в work/pages/<slug>/_old/, их отчеты линтера удаляются. Отчеты судей и кросса не переписываются.
// Затем пересчитывается state. После перенумерации бриф изменился: страницу нужно перелинтовать (lint-page.mjs).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pageDir, loadBrief, readJson, writeJson, exists } from './lib.mjs';

const slug = process.argv[2];
if (!slug) { console.error('usage: renumber-blocks.mjs <slug>'); process.exit(2); }
const brief = loadBrief(slug);
const dir = path.join(pageDir(slug), 'blocks');
const oldDir = path.join(pageDir(slug), '_old');
if (!exists(dir)) { console.log('нет папки блоков'); process.exit(0); }
const files = fs.readdirSync(dir).filter(f => /^B\d{2}-[a-z0-9-]+\.json$/.test(f)).sort();
const byType = {};
for (const f of files) { const type = f.replace(/^B\d{2}-/, '').replace(/\.json$/, ''); (byType[type] ??= []).push(f); }
const auditDir = path.join(process.cwd(), 'work', 'audit', slug);
const lintFile = id => path.join(auditDir, `lint-${id}.json`);
let renamed = 0, moved = 0;
// сначала читаем все переносимое, потом пишем: имена могут меняться по кругу (B02 -> B03, B03 -> B04)
const plan = [];
for (const b of brief.blocks) {
  const list = byType[b.type] || [];
  if (!list.length) continue;
  // среди копий одного типа файл с целевым именем остается на месте, остальные копии уходят в _old
  const at = list.indexOf(`${b.block_id}.json`);
  const src = list.splice(at >= 0 ? at : 0, 1)[0];
  if (src !== `${b.block_id}.json`) plan.push({ src, from: src.replace(/\.json$/, ''), to: b.block_id });
}
for (const p of plan) {
  p.data = readJson(path.join(dir, p.src));
  p.lint = exists(lintFile(p.from)) ? readJson(lintFile(p.from)) : null;
}
for (const p of plan) {
  fs.unlinkSync(path.join(dir, p.src));
  if (p.lint) fs.unlinkSync(lintFile(p.from));
}
for (const p of plan) {
  p.data.block_id = p.to;
  writeJson(path.join(dir, `${p.to}.json`), p.data);
  if (p.lint) {
    p.lint.scope = `${slug}/${p.to}`;
    for (const f of p.lint.findings || []) if (f && f.block_id === p.from) f.block_id = p.to;
    writeJson(lintFile(p.to), p.lint);
  }
  renamed++;
}
// не в брифе или лишняя копия того же типа - в _old
for (const list of Object.values(byType)) {
  for (const f of list) {
    const cur = path.join(dir, f);
    if (!exists(cur) || plan.some(p => `${p.to}.json` === f)) continue;
    fs.mkdirSync(oldDir, { recursive: true });
    fs.renameSync(cur, path.join(oldDir, f));
    moved++;
    const l = lintFile(f.replace(/\.json$/, ''));
    if (exists(l)) fs.unlinkSync(l);
  }
}
console.log(`переименовано: ${renamed}, убрано в _old: ${moved}`);
const r = spawnSync(process.execPath, [path.join('scripts', 'page-state.mjs'), slug], { cwd: process.cwd(), encoding: 'utf8' });
process.stdout.write(r.stdout || '');
process.stderr.write(r.stderr || '');
process.exit(r.status === 0 ? 0 : 1);
