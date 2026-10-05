// Эталон прототипа без оболочки КФ (программа 05.10, пакет D): нормализованный <body> сборки фикстур kit
// examples/fixture-{services,landing,shop} тем же способом, что cases-site.mjs (копия scripts, rules, schemas, config,
// html kit + config, work, rules фикстуры во временной папке, затем scripts/build-html.mjs).
// Обновить эталон (только намеренно, после проверки разницы): node .claude/tests/site-tekst/fixtures/site-golden/golden.mjs
// Модуль экспортирует buildBody(name), normalizeBody(html) и normalizeHead(html) для cases-kf-site.mjs; эталон - <body>
// (<name>.body.html) и отдельно <head> со стилями (<name>.head.html).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const TPL = path.resolve(HERE, '..', '..', '..', '..', 'skills', 'site-tekst', 'kit');
export const FIXTURES = ['fixture-services', 'fixture-landing', 'fixture-shop'];
export const goldenFile = name => path.join(HERE, `${name}.body.html`);

// <body>...</body> без изменчивых данных: переводы строк, дата сборки и sha данных (они в <head>, но на случай переноса)
export function normalizeBody(html) {
  const s = String(html).replace(/\r\n/g, '\n');
  const a = s.indexOf('<body');
  const b = s.lastIndexOf('</body>');
  const body = a < 0 ? s : s.slice(a, b < 0 ? s.length : b + 7);
  return body
    .replace(/<meta name="(generator|proto-data-sha)"[^>]*>/g, '')
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g, '<ts>')
    .replace(/[ \t]+$/gm, '');
}

// <head> (стили, контракт) без даты сборки и sha данных: стили прототипа без оболочки не меняются
export const goldenHeadFile = name => path.join(HERE, `${name}.head.html`);
export function normalizeHead(html) {
  const s = String(html).replace(/\r\n/g, '\n');
  const a = s.indexOf('<body');
  return (a < 0 ? '' : s.slice(0, a)).replace(/<meta name="(generator|proto-data-sha)"[^>]*>/g, '').replace(/[ \t]+$/gm, '');
}

// сборка фикстуры во временной папке; mutate(dir) - необязательная правка проекта перед сборкой
export function buildProject(name, { root, mutate, env = {} } = {}) {
  const base = root || fs.mkdtempSync(path.join(os.tmpdir(), 'site-golden-'));
  const dir = path.join(base, name);
  for (const d of ['scripts', 'rules', 'schemas', 'config', 'html']) fs.cpSync(path.join(TPL, d), path.join(dir, d), { recursive: true });
  const fx = path.join(TPL, 'examples', name);
  for (const d of ['config', 'work', 'rules']) if (fs.existsSync(path.join(fx, d))) fs.cpSync(path.join(fx, d), path.join(dir, d), { recursive: true });
  if (mutate) mutate(dir);
  const r = spawnSync(process.execPath, ['scripts/build-html.mjs'], { cwd: dir, encoding: 'utf8', env: { ...process.env, ...env }, timeout: 240000 });
  const file = path.join(dir, 'work', 'output', 'prototype.html');
  return { dir, code: r.status, out: (r.stdout || '') + (r.stderr || ''), html: fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '' };
}
export function buildBody(name, opts) {
  const r = buildProject(name, opts);
  return { ...r, body: normalizeBody(r.html), head: normalizeHead(r.html) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'site-golden-'));
  let bad = 0;
  for (const name of FIXTURES) {
    const r = buildBody(name, { root });
    if (r.code !== 0 || !r.body) { bad++; console.error(`${name}: build-html код ${r.code}\n${r.out.slice(0, 600)}`); continue; }
    fs.writeFileSync(goldenFile(name), r.body);
    fs.writeFileSync(goldenHeadFile(name), r.head);
    console.log(`${name}: ${path.basename(goldenFile(name))} (${(Buffer.byteLength(r.body) / 1024).toFixed(0)} КБ)`);
  }
  fs.rmSync(root, { recursive: true, force: true });
  process.exit(bad ? 1 : 0);
}
