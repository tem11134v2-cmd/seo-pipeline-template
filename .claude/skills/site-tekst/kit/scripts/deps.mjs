// Поиск npm-зависимостей для скриптов kit (jsdom, docx, marked). У kit своих node_modules нет: копия kit лежит в
// texts/NNN/ клиентского проекта, и обычный import находит пакеты подъемом по папкам до node_modules проекта.
// Порядок поиска: 1) переменная SITE_TEKST_NODE_MODULES (путь к папке node_modules, так делают тесты в песочнице);
// 2) обычный подъем от этого файла; 3) подъем от текущей папки (cwd). Не нашлось - null, решение за вызывающим
// (честный SKIP или ошибка с подсказкой «npm install в корне проекта»).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';

function fromDir(dir, name) {
  try {
    const req = createRequire(path.join(dir, 'noop.js'));
    return req.resolve(name);
  } catch { return null; }
}

// Путь к точке входа пакета или null.
export function resolveDep(name) {
  const env = process.env.SITE_TEKST_NODE_MODULES;
  if (env && fs.existsSync(path.join(env, name))) {
    const hit = fromDir(path.dirname(env), name);
    if (hit) return hit;
  }
  const here = fromDir(path.dirname(fileURLToPath(import.meta.url)), name);
  if (here) return here;
  return fromDir(process.cwd(), name);
}

// Загрузить пакет (ESM или CJS) или вернуть null.
export async function loadDep(name) {
  const p = resolveDep(name);
  if (!p) return null;
  const mod = await import(pathToFileURL(p).href);
  return mod.default && Object.keys(mod).length <= 2 ? { ...mod.default, ...mod } : mod;
}
