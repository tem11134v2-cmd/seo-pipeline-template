// Обновить в проекте логику из шаблона: scripts/, prompts/, schemas/, html/, workflows/, rules/ (кроме decisions.md), CLAUDE.md, README.md, docs/.
// node scripts/sync-from-template.mjs <путь к шаблону>   (запуск из корня проекта)
// Не трогает work/, inputs/, config/, rules/decisions.md, examples/.
import fs from 'node:fs';
import path from 'node:path';

const tpl = process.argv[2];
if (!tpl || !fs.existsSync(path.join(tpl, 'scripts', 'lib.mjs'))) { console.error('usage: sync-from-template.mjs <template-dir>'); process.exit(2); }
const dst = process.cwd();
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
