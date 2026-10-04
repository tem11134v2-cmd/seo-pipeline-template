// Локальный просмотр прототипа. node scripts/serve.mjs [--dir work/output] [--port 4610]
// Открывать http://localhost:<port>/prototype.html. Кеш браузера выключен (Cache-Control: no-store): после пересборки
// обновление страницы показывает новый файл. Порт занят - код 2 и строка с подсказкой --port (порт задачи выбирает
// task.mjs preview).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { argv } from './lib.mjs';

const a = argv({});
const dir = path.resolve(a.dir || 'work/output');
const port = Number(a.port || 4610);
const types = { '.html': 'text/html; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.json': 'application/json; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript' };
const server = http.createServer((req, res) => {
  let rel = decodeURIComponent(req.url.split('?')[0].split('#')[0]);
  if (rel === '/' || rel === '') rel = '/prototype.html';
  const file = path.join(dir, rel);
  if (!file.startsWith(dir)) { res.writeHead(403, { 'Cache-Control': 'no-store' }); return res.end('forbidden'); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Cache-Control': 'no-store' }); return res.end('not found: ' + rel); }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
});
// порт занят (превью другой задачи или прошлый запуск) - понятная строка и код 2, а не трасса исключения
server.on('error', e => {
  if (e && e.code === 'EADDRINUSE') { console.error(`serve: порт ${port} занят - уже открыт другой просмотр; укажите другой: --port <номер>`); process.exit(2); }
  console.error(`serve: ${e && e.message}`); process.exit(1);
});
server.listen(port, () => console.log(`prototype: http://localhost:${port}/prototype.html (dir ${dir})`));
