// Обновить в автономной копии kit (вне SEO-шаблона) логику из шаблона: scripts/, prompts/, schemas/, html/, workflows/, rules/
// (кроме decisions.md), CLAUDE.md, README.md, docs/.
// node scripts/sync-from-template.mjs <путь к шаблону>   (запуск из корня копии)
// Не трогает work/, inputs/, config/, rules/decisions.md, examples/.
// В папке задачи /site-tekst SEO-шаблона (texts/NNN-<slug>/ с .kit.json или meta.json format v9) не работает: там копию kit
// кладет task.mjs place (манифест, overrides/ проекта), а этот скрипт затер бы overrides и записал docs/ и README.md в данные
// задачи. Путь там: правка в kit шаблона -> /sync-from-template (или /sync-all) в проекте -> task.mjs place.
import fs from 'node:fs';
import path from 'node:path';

const tpl = process.argv[2];
const dst = process.cwd();
const readJson = p => { try { return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^﻿/, '')); } catch { return null; } };
const meta = readJson(path.join(dst, 'meta.json'));
if (fs.existsSync(path.join(dst, '.kit.json')) || (meta && meta.format === 'v9')) {
  console.error('это папка задачи /site-tekst: копию kit здесь кладет task.mjs place, этот скрипт затер бы overrides/ проекта.');
  console.error('Обновление kit: правка в .claude/skills/site-tekst/kit/ шаблона -> /sync-from-template (или /sync-all) в проекте ->');
  console.error('.claude\\scripts\\_node.cmd .claude\\skills\\site-tekst\\task.mjs place <KKK> из корня проекта.');
  process.exit(2);
}
if (!tpl || !fs.existsSync(path.join(tpl, 'scripts', 'lib.mjs'))) { console.error('usage: sync-from-template.mjs <template-dir>'); process.exit(2); }
const DIRS = ['scripts', 'prompts', 'schemas', 'html', 'workflows', 'docs', 'rules'];
const FILES = ['CLAUDE.md', 'README.md'];
let copied = 0;
function copyDir(s, d, skip) {
  fs.mkdirSync(d, { recursive: true });
  for (const f of fs.readdirSync(s)) {
    const sp = path.join(s, f), dp = path.join(d, f);
    if (skip && skip(f)) continue;
    if (fs.statSync(sp).isDirectory()) copyDir(sp, dp, skip);
    else { fs.copyFileSync(sp, dp); copied++; }
  }
}
for (const dir of DIRS) {
  if (!fs.existsSync(path.join(tpl, dir))) continue;
  copyDir(path.join(tpl, dir), path.join(dst, dir), dir === 'rules' ? f => f === 'decisions.md' : null);
}
for (const f of FILES) if (fs.existsSync(path.join(tpl, f))) { fs.copyFileSync(path.join(tpl, f), path.join(dst, f)); copied++; }
console.log(`синхронизировано файлов: ${copied} (work/, inputs/, config/, rules/decisions.md не тронуты)`);
