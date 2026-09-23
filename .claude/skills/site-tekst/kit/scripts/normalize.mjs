// node scripts/normalize.mjs <file...>   - ё -> е, длинные тире -> «-», неразрывные пробелы -> пробел
// JSON нормализуется по всем строковым значениям, md/txt/html - по содержимому.
import fs from 'node:fs';
import { normalizeDeep, normalizeText, readJson, writeJson } from './lib.mjs';

const files = process.argv.slice(2);
if (!files.length) { console.error('usage: normalize.mjs <file...>'); process.exit(2); }
let total = 0;
for (const f of files) {
  if (!fs.existsSync(f)) { console.log(`skip (нет файла): ${f}`); continue; }
  if (f.endsWith('.json')) {
    const stats = { changed: 0 };
    const data = normalizeDeep(readJson(f), stats);
    if (stats.changed) writeJson(f, data);
    console.log(`${f}: изменено строк ${stats.changed}`);
    total += stats.changed;
  } else {
    const src = fs.readFileSync(f, 'utf8');
    const out = src.replace(/ё/g, 'е').replace(/Ё/g, 'Е').replace(/[—–]/g, '-').replace(/ /g, ' ');
    const changed = (src.match(/[ёЁ—– ]/g) || []).length;
    if (changed) fs.writeFileSync(f, out, 'utf8');
    console.log(`${f}: заменено символов ${changed}`);
    total += changed;
  }
}
console.log(`итого замен: ${total}`);
