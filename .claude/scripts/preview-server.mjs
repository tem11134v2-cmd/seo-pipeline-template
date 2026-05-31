// preview-server.mjs - минимальный статический HTTP-сервер для GP3 (скриншот-самопроверка
// шаблона в setup-project). Нужен потому, что Chrome-MCP navigate не открывает file://
// (принудительно дописывает https://), а python/npx в окружении может не быть.
//
// Запуск (через обёртку): .claude\scripts\_node.cmd .claude\scripts\preview-server.mjs <root> [port]
//   <root> - каталог, который раздаём (например .claude/handoff-requests/files)
//   port   - порт (по умолчанию 8765)
// Затем Chrome-MCP: navigate http://localhost:<port>/template.html -> screenshot.
// Останавливать: убить процесс (порт держится только на время проверки).

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';

const ROOT = resolve(process.argv[2] || process.cwd());
const PORT = Number(process.argv[3] || 8765);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.json': 'application/json',
};

createServer(async (req, res) => {
  try {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const filePath = normalize(join(ROOT, urlPath === '/' ? '/index.html' : urlPath));
    if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end('forbidden'); return; }
    const data = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': TYPES[extname(filePath).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404); res.end('not found');
  }
}).listen(PORT, '127.0.0.1', () => console.log(`preview-server: ${ROOT} -> http://localhost:${PORT}`));
