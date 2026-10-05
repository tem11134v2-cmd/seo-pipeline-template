// Снятие страниц для анализа КФ (фаза 2): мини-клиент CDP на встроенном WebSocket Node к установленному Chrome или Edge
// (--headless=new). Без npm-зависимостей и скачивания браузера; свой процесс браузера на поток со своим --user-data-dir во
// временной папке (префикс site-tekst-cdp-, осиротевшие профили старше часа удаляются при старте). MCP-браузер агентов не
// трогается. Браузер: переменная SITE_TEKST_CHROME (только она, если задана), иначе пути Chrome и Edge по умолчанию.
//
// node scripts/capture-pages.mjs --domain <d> [--resume] [--concurrency 1] [--max-seconds 480]
//   страницы домена из work/competitors/competitors.json (конкурент status ok, страницы ok/browser/js_only/antibot, главная
//   всегда); --domain own - главная config.site_url (сайт заказчика, role own).
// node scripts/capture-pages.mjs --url <u> --domain <d> --name <имя снимка>   - одна страница (верификатор, классификатор:
//   затем fetch-page.mjs <u> <raw> --html-from work/competitors/shots/<d>/<имя>/render.html).
// node scripts/capture-pages.mjs --file <html> --routes "#/,#/x" --out <папка>   - первые экраны прототипа (1366 и 390)
//   для аудитора: <out>/<маршрут>-1366.jpg и -390.jpg.
// Выход на страницу - work/competitors/shots/<домен>/<имя снимка>/ (не в git): top.jpg (0-1100 px), bottom.jpg (последние
//   1400 px), body-01.jpg..body-NN.jpg (тело кадрами 1366x1600, не больше 8; не хватило - truncated в limits), mobile.jpg
//   (первый экран 390x844, мобильный UA), kf.json (DOM-находки и контур секций, scripts/kf-dom.mjs; mobile - шапка и
//   закрепленные на 390 px), render.html (отрисованный DOM). Монолитный снимок страницы не делается.
// Сводка - work/competitors/capture.json {chrome, pages: [{domain, name, url, type, role, status, reason, height, ms,
//   files: [{file, y0, y1}], partial, limits}]}: слияние вызовов по доменам (shots/<домен>/capture.part.json) под замком.
//   Домены не из competitors.json (устаревшие после пересбора) - skipped, причина stale.
// Статусы: ok | antibot (страница проверки: правила pageStatus fetch-page.mjs по коду и видимому тексту, ожидание проверки до
//   12 с; сетевой отказ ERR_CONNECTION_* - один повтор в конце очереди после паузы SITE_TEKST_CAPTURE_RETRY_MS, 20 с) | error (сайт не ответил, HTTP 400+, таймаут) | skipped (нет Chrome - no_chrome; дедлайн - timeout; stale).
// --resume: готовое (ok, antibot с файлами) не переснимается; переснимаются error, skipped и новые страницы.
// --max-seconds: по дедлайну новые страницы не берутся, текущие доснимаются не дольше дедлайна + 90 с (иначе skipped,
//   timeout), браузеры закрываются; остаток - skipped (timeout, partial: true), код 0. Часть домена и сводка пишутся после
//   каждой страницы: вызов, убитый внешним таймаутом, не теряет снятое (--resume его не переснимает). Нет Chrome и Edge - код 0, chrome null, страницы skipped (no_chrome), DOM-находки
//   по статическому html снимка (raw -> html_path, jsdom) - kf.json со static: true, запись dom: "static". Код 1 - внутренняя ошибка,
//   код 2 - неверные аргументы. Последняя строка stdout - KF_CAPTURE {json} (или KF_PROTO {json} для --file).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { argv, P, exists, readJson, writeJson, nowIso } from './lib.mjs';
import { pageStatus, sectionsFromHtml, CHALLENGE, CHALLENGE_TITLE, JS_ONLY_CHARS } from './fetch-page.mjs';
import { scanExpression, linkPatterns, readDict, scanHtml } from './kf-dom.mjs';

export const W = 1366, VH = 900, MW = 390, MH = 844;
export const TOP_H = 1100, BOTTOM_H = 1400, TILE_H = 1600, TILES_MAX = 8, HEIGHT_MAX = 40000;
export const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
export const MOBILE_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36';
export const PROFILE_PREFIX = 'site-tekst-cdp-';
const CAPTURABLE = ['ok', 'browser', 'js_only', 'antibot'];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const posix = s => String(s).replace(/\\/g, '/');

// Путь к Chrome или Edge: SITE_TEKST_CHROME (если задана - только она), иначе пути по умолчанию. Нет - null.
export function findChrome(env = process.env) {
  if (env.SITE_TEKST_CHROME != null && env.SITE_TEKST_CHROME !== '') return fs.existsSync(env.SITE_TEKST_CHROME) ? env.SITE_TEKST_CHROME : null;
  const pf = [env.ProgramW6432, env.ProgramFiles, env['ProgramFiles(x86)'], 'C:/Program Files', 'C:/Program Files (x86)'].filter(Boolean);
  const cands = process.platform === 'win32'
    ? [...pf.map(b => path.join(b, 'Google', 'Chrome', 'Application', 'chrome.exe')), env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'), ...pf.map(b => path.join(b, 'Microsoft', 'Edge', 'Application', 'msedge.exe'))]
    : process.platform === 'darwin'
      ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/Applications/Chromium.app/Contents/MacOS/Chromium']
      : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge', '/snap/bin/chromium'];
  return cands.filter(Boolean).find(p => fs.existsSync(p)) || null;
}

// Кадры страницы высотой H: top 0-1100, bottom - последние 1400, тело между ними кадрами по 1600 (не больше 8).
export function tilePlan(H) {
  const h = Math.max(1, Math.min(Math.round(Number(H) || 0) || 1, HEIGHT_MAX));
  const files = [{ file: 'top.jpg', y0: 0, y1: Math.min(h, TOP_H) }];
  let truncated = false;
  if (h > TOP_H) {
    const bStart = Math.max(TOP_H, h - BOTTOM_H);
    let y = TOP_H, k = 0;
    while (y < bStart) {
      if (k >= TILES_MAX) { truncated = true; break; }
      const y1 = Math.min(y + TILE_H, bStart);
      files.push({ file: `body-${String(++k).padStart(2, '0')}.jpg`, y0: y, y1 });
      y = y1;
    }
    files.push({ file: 'bottom.jpg', y0: Math.max(0, h - BOTTOM_H), y1: h });
  }
  return { height: h, files, truncated: truncated || (Number(H) || 0) > HEIGHT_MAX };
}

// Кадр секции контура: тело - его кадр, иначе top или bottom.
export function tileOf(y, files) {
  if (y == null) return null;
  const body = files.find(f => /^body-/.test(f.file) && y >= f.y0 && y < f.y1);
  if (body) return body.file;
  const top = files.find(f => f.file === 'top.jpg' && y < f.y1);
  if (top) return top.file;
  const bot = files.find(f => f.file === 'bottom.jpg' && y >= f.y0);
  return bot ? bot.file : null;
}

// Осиротевшие профили (старше maxAgeMs) - удалить.
export function cleanOrphans(dir = os.tmpdir(), maxAgeMs = 3600000) {
  let n = 0;
  try {
    for (const f of fs.readdirSync(dir)) {
      if (!f.startsWith(PROFILE_PREFIX)) continue;
      const p = path.join(dir, f);
      try { if (Date.now() - fs.statSync(p).mtimeMs > maxAgeMs) { fs.rmSync(p, { recursive: true, force: true }); n++; } } catch { /* занят */ }
    }
  } catch { /* нет папки */ }
  return n;
}

// ---------- мини-клиент CDP ----------
export class Browser {
  constructor(proc, ws, udd) {
    this.proc = proc; this.ws = ws; this.udd = udd; this.id = 0; this.pending = new Map(); this.listeners = new Set(); this.closed = false;
    ws.onmessage = ev => {
      let m; try { m = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString('utf8')); } catch { return; }
      if (m.id && this.pending.has(m.id)) { const p = this.pending.get(m.id); this.pending.delete(m.id); clearTimeout(p.t); m.error ? p.rej(new Error(`${p.method}: ${m.error.message}`)) : p.res(m.result || {}); }
      else for (const f of this.listeners) f(m);
    };
    ws.onclose = () => { this.closed = true; for (const p of this.pending.values()) { clearTimeout(p.t); p.rej(new Error('браузер закрыл соединение')); } this.pending.clear(); };
  }
  static async launch(chrome) {
    const udd = fs.mkdtempSync(path.join(os.tmpdir(), PROFILE_PREFIX));
    const proc = spawn(chrome, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${udd}`, '--no-first-run', '--no-default-browser-check',
      '--disable-gpu', '--hide-scrollbars', '--mute-audio', '--disable-extensions', '--disable-sync', '--disable-background-networking',
      '--disable-blink-features=AutomationControlled', '--disable-features=Translate,MediaRouter', `--window-size=${W},${VH}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
    let exited = false; proc.on('exit', () => { exited = true; }); proc.on('error', () => { exited = true; });
    let port = null;
    for (let i = 0; i < 150 && !port && !exited; i++) {
      await sleep(100);
      try { const t = fs.readFileSync(path.join(udd, 'DevToolsActivePort'), 'utf8').split(/\r?\n/); if (t[0] && t[1]) port = t; } catch { /* еще нет */ }
    }
    if (!port) { try { proc.kill(); } catch { /* */ } rmProfile(udd); throw new Error(exited ? 'процесс браузера завершился при старте' : 'браузер не открыл порт отладки за 15 с'); }
    const ws = new WebSocket(`ws://127.0.0.1:${port[0].trim()}${port[1].trim()}`);
    await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('нет соединения с браузером')), 10000); ws.onopen = () => { clearTimeout(t); res(); }; ws.onerror = () => { clearTimeout(t); rej(new Error('ошибка соединения с браузером')); }; });
    return new Browser(proc, ws, udd);
  }
  send(method, params = {}, sessionId, timeoutMs = 30000) {
    if (this.closed) return Promise.reject(new Error('браузер закрыт'));
    return new Promise((res, rej) => {
      const id = ++this.id;
      const t = setTimeout(() => { this.pending.delete(id); rej(new Error(`${method}: нет ответа за ${Math.round(timeoutMs / 1000)} с`)); }, timeoutMs);
      this.pending.set(id, { res, rej, t, method });
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  async close() {
    try { await this.send('Browser.close', {}, undefined, 3000); } catch { /* уже закрыт */ }
    try { this.ws.close(); } catch { /* */ }
    const t0 = Date.now();
    while (this.proc.exitCode == null && this.proc.signalCode == null && Date.now() - t0 < 3000) await sleep(100);
    try { this.proc.kill(); } catch { /* */ }
    await sleep(200);
    rmProfile(this.udd);
  }
}
function rmProfile(udd) { for (let i = 0; i < 5; i++) { try { fs.rmSync(udd, { recursive: true, force: true }); return; } catch { /* файлы еще заняты */ } const t = Date.now(); while (Date.now() - t < 200) { /* ждем */ } } }

export async function openTab(b) {
  const { targetId } = await b.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await b.send('Target.attachToTarget', { targetId, flatten: true });
  const S = (m, p, t) => b.send(m, p, sessionId, t);
  await S('Page.enable');
  await S('Network.enable');
  return { targetId, sessionId, S, close: () => b.send('Target.closeTarget', { targetId }, undefined, 5000).catch(() => {}) };
}
export async function evalJs(tab, expression, awaitPromise = false, timeoutMs = 30000) {
  const r = await tab.S('Runtime.evaluate', { expression, returnByValue: true, awaitPromise }, timeoutMs);
  if (r.exceptionDetails) throw new Error(`скрипт страницы: ${String((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text).slice(0, 200)}`);
  return r.result ? r.result.value : undefined;
}
export async function navigate(b, tab, url, timeoutMs = 30000) {
  let status = 0, loaded = false;
  const off = b.on(m => {
    if (m.sessionId !== tab.sessionId) return;
    if (m.method === 'Network.responseReceived' && m.params && m.params.type === 'Document' && m.params.frameId === tab.targetId) status = m.params.response.status;
    if (m.method === 'Page.loadEventFired') loaded = true;
  });
  try {
    const nav = await tab.S('Page.navigate', { url }, timeoutMs);
    if (nav.errorText) return { error: nav.errorText, status };
    const t0 = Date.now();
    while (!loaded && Date.now() - t0 < timeoutMs) await sleep(100);
    return { status, loaded };
  } finally { off(); }
}
const PROBE = '(() => { const t = (document.body && document.body.innerText) || ""; return { title: document.title || "", len: t.length, text: t.slice(0, 3000) }; })()';
// ожидание проверки антибота и дорисовки: до maxMs, выход - текста достаточно и не страница проверки, или текст устоялся
async function settle(tab, maxMs) {
  const t0 = Date.now();
  let prev = -1, p = { title: '', len: 0, text: '' };
  while (Date.now() - t0 < maxMs) {
    try { p = await evalJs(tab, PROBE, false, 10000) || p; } catch { /* страница меняется */ }
    const challenge = p.len < JS_ONLY_CHARS && (CHALLENGE.test(p.title) || CHALLENGE_TITLE.test(p.title) || CHALLENGE.test(p.text));
    if (!challenge && (p.len >= JS_ONLY_CHARS || (p.len === prev && Date.now() - t0 >= 1500))) break;
    prev = p.len;
    await sleep(500);
  }
  return p;
}
// Прокрутка для ленивой загрузки; страница во внутреннем контейнере (высота документа равна окну) - прокрутка
// контейнера и снятие ограничений высоты (html, body, контейнер и его предки; большие fixed/sticky секции внутри - в поток).
const SCROLL = `(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const de = document.documentElement, b = document.body || de, vh = innerHeight;
  const docH = () => Math.max(de.scrollHeight, b.scrollHeight);
  let box = null;
  if (docH() <= vh + 20) {
    let best = 0;
    for (const el of b.querySelectorAll('*')) {
      if (el.scrollHeight <= el.clientHeight + 100 || el.clientHeight < vh * 0.5) continue;
      const s = getComputedStyle(el);
      if (!/(auto|scroll|overlay)/.test(s.overflowY)) continue;
      if (el.scrollHeight > best) { best = el.scrollHeight; box = el; }
    }
  }
  const total = Math.min(box ? box.scrollHeight : docH(), ${HEIGHT_MAX});
  const t0 = Date.now();
  for (let y = 0; y < total && Date.now() - t0 < 9000; y += 700) { if (box) box.scrollTop = y; else scrollTo(0, y); await sleep(110); }
  if (box) box.scrollTop = 0;
  scrollTo(0, 0);
  if (box) {
    const st = document.createElement('style');
    st.textContent = 'html, body { height: auto !important; max-height: none !important; overflow: visible !important; }';
    (document.head || de).appendChild(st);
    const set = (n, k, v) => n.style.setProperty(k, v, 'important');
    for (let n = box; n && n !== de && n !== b; n = n.parentElement) { set(n, 'height', 'auto'); set(n, 'max-height', 'none'); set(n, 'overflow', 'visible'); if (/fixed|absolute/.test(getComputedStyle(n).position)) set(n, 'position', 'relative'); }
    for (const el of box.querySelectorAll('*')) {
      const s = getComputedStyle(el);
      if (!/fixed|sticky/.test(s.position)) continue;
      const r = el.getBoundingClientRect();
      if (r.height > vh * 0.6 && r.width > innerWidth * 0.6) set(el, 'position', 'relative');
    }
  }
  await sleep(400);
  return { inner: !!box, height: docH() };
})()`;
const HTML = '"<!doctype html>\\n" + document.documentElement.outerHTML';

async function shot(tab, clip, file) {
  const r = await tab.S('Page.captureScreenshot', { format: 'jpeg', quality: 60, captureBeyondViewport: true, clip: { x: 0, y: clip.y0, width: clip.w || W, height: Math.max(1, clip.y1 - clip.y0), scale: 1 } }, 90000);
  fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
}

// Одна страница: запись для capture.json. Ошибки внутри - status error с причиной.
async function capturePage(b, job, ctx) {
  const t0 = Date.now();
  const rel = posix(path.join('work', 'competitors', 'shots', job.domain, job.name));
  const dir = P(rel);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const rec = { domain: job.domain, name: job.name, url: job.url, type: job.type, role: job.role, status: 'error', reason: '', height: 0, ms: 0, files: [], partial: false };
  let tab = null;
  try {
    tab = await openTab(b);
    await tab.S('Emulation.setDeviceMetricsOverride', { width: W, height: VH, deviceScaleFactor: 1, mobile: false });
    await tab.S('Network.setUserAgentOverride', { userAgent: DESKTOP_UA, acceptLanguage: 'ru-RU,ru;q=0.9,en;q=0.5' });
    const nav = await navigate(b, tab, job.url, 30000);
    if (nav.error) { rec.reason = `сайт не ответил: ${nav.error}`; return rec; }
    const pr = await settle(tab, 12000);
    const sc = await evalJs(tab, SCROLL, true, 30000).catch(() => ({ inner: false, height: 0 }));
    const html = await evalJs(tab, HTML, false, 30000);
    fs.writeFileSync(path.join(dir, 'render.html'), html, 'utf8');
    const sections = sectionsFromHtml(html);
    const textChars = sections.reduce((s, x) => s + x.chars, 0);
    const st = pageStatus({ html, http_status: nav.status || 0, text_chars: textChars, headings_count: sections.filter(s => s.level > 0).length, title: pr.title || '' });
    const H0 = Number(await evalJs(tab, 'Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0)').catch(() => sc.height)) || VH;
    const plan = tilePlan(H0);
    rec.height = plan.height;
    if (sc.inner) rec.inner_scroll = true;
    if (st.status === 'antibot') {
      await shot(tab, { y0: 0, y1: Math.min(plan.height, TOP_H) }, path.join(dir, 'top.jpg'));
      rec.files = [{ file: `${rel}/top.jpg`, y0: 0, y1: Math.min(plan.height, TOP_H) }];
      rec.status = 'antibot'; rec.reason = 'страница проверки (антибот)';
      return rec;
    }
    if (st.status === 'closed') { rec.reason = `HTTP ${nav.status}`; return rec; }
    // сбой обхода DOM не валит снятие: кадры есть, DOM-находок нет (строка limits)
    const kf = await evalJs(tab, scanExpression({ links: ctx.links }), false, 60000).catch(e => {
      (rec.limits ||= []).push(`dom: ${String(e.message || e).slice(0, 120)}`);
      return { zones: { header: [], footer: [], body: [], fixed: [], mobile: [] }, outline: [], schema: [], page: { layout: true } };
    });
    for (const f of plan.files) await shot(tab, f, path.join(dir, f.file));
    rec.files = plan.files.map(f => ({ file: `${rel}/${f.file}`, y0: f.y0, y1: f.y1 }));
    if (plan.truncated) (rec.limits ||= []).push('truncated');
    for (const s of kf.outline || []) s.tile = tileOf(s.y, plan.files);
    // мобильная версия: первый экран 390x844 и шапка с закрепленными элементами того же обхода
    let mobile = [];
    try {
      await tab.close();
      tab = await openTab(b);
      await tab.S('Emulation.setDeviceMetricsOverride', { width: MW, height: MH, deviceScaleFactor: 1, mobile: true });
      await tab.S('Network.setUserAgentOverride', { userAgent: MOBILE_UA, acceptLanguage: 'ru-RU,ru;q=0.9,en;q=0.5' });
      await tab.S('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
      const mn = await navigate(b, tab, job.url, 25000);
      if (mn.error) throw new Error(mn.error);
      await settle(tab, 4000);
      await sleep(600);
      const r = await tab.S('Page.captureScreenshot', { format: 'jpeg', quality: 60, clip: { x: 0, y: 0, width: MW, height: MH, scale: 1 } }, 60000);
      fs.writeFileSync(path.join(dir, 'mobile.jpg'), Buffer.from(r.data, 'base64'));
      rec.files.push({ file: `${rel}/mobile.jpg`, y0: 0, y1: MH });
      const mk = await evalJs(tab, scanExpression({ links: ctx.links }), false, 60000);
      const seenIds = new Set();
      for (const e of [...(mk.zones.header || []), ...(mk.zones.fixed || [])]) if (!seenIds.has(e.id)) { seenIds.add(e.id); mobile.push(e); }
    } catch (e) { (rec.limits ||= []).push(`mobile: ${String(e.message || e).slice(0, 120)}`); }
    kf.zones.mobile = mobile;
    writeJson(path.join(dir, 'kf.json'), { url: job.url, domain: job.domain, name: job.name, type: job.type, captured_at: nowIso(), height: plan.height, inner_scroll: !!sc.inner, ...kf });
    rec.status = 'ok';
    return rec;
  } catch (e) {
    rec.status = 'error'; rec.reason = String(e.message || e).slice(0, 200);
    return rec;
  } finally {
    if (tab) await tab.close();
    rec.ms = Date.now() - t0;
  }
}

// ---------- список страниц ----------
function nameOf(raw, url) {
  const b = raw ? path.basename(String(raw)).replace(/\.json$/i, '') : '';
  if (b) return b;
  try { const u = new URL(url); return (u.pathname.replace(/^\/+|\/+$/g, '').replace(/[^a-z0-9]+/gi, '-').slice(0, 40) || 'home').toLowerCase(); } catch { return 'page'; }
}
function competitorsMap() {
  const f = P('work', 'competitors', 'competitors.json');
  if (!exists(f)) return null;
  try { return new Map((readJson(f).competitors || []).filter(c => c && c.domain).map(c => [String(c.domain).toLowerCase(), c])); } catch { return null; }
}
function domainJobs(domain) {
  if (domain === 'own') {
    let cfg = {}; try { cfg = readJson(P('config', 'project.json')); } catch { /* нет конфига */ }
    const site = String(cfg.site_url || '').trim();
    if (!site) return { jobs: [], note: 'config.site_url пуст - сайта заказчика нет' };
    const url = /^https?:\/\//i.test(site) ? site : `https://${site.replace(/^\/+/, '')}`;
    return { jobs: [{ domain: 'own', name: 'home', url, type: 'home', role: 'own' }] };
  }
  const map = competitorsMap();
  if (!map) return { jobs: [], note: 'нет work/competitors/competitors.json' };
  const c = map.get(domain.toLowerCase());
  if (!c) return { jobs: [], note: `домена ${domain} нет в competitors.json`, stale: true };
  if (c.status !== 'ok') return { jobs: [], note: `домен ${domain}: статус ${c.status} - не снимается` };
  const jobs = [];
  for (const p of c.pages || []) {
    if (!p || !p.url || !CAPTURABLE.includes(p.status)) continue;
    const name = nameOf(p.raw, p.url);
    if (!jobs.some(j => j.name === name)) jobs.push({ domain: c.domain, name, url: p.url, type: p.type || 'home', role: 'competitor', raw: p.raw || '' });
  }
  if (!jobs.some(j => j.type === 'home')) jobs.unshift({ domain: c.domain, name: 'home', url: c.home_url || `https://${c.domain}/`, type: 'home', role: 'competitor' });
  return { jobs };
}

// ---------- сводка ----------
const partFile = d => P('work', 'competitors', 'shots', d, 'capture.part.json');
function readPart(d) { try { return readJson(partFile(d)).pages || []; } catch { return []; } }
function lockSync(dir, ms = 15000) {
  const t0 = Date.now();
  for (;;) {
    try { fs.mkdirSync(dir); return () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* */ } }; } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try { if (Date.now() - fs.statSync(dir).mtimeMs > 60000) { fs.rmSync(dir, { recursive: true, force: true }); continue; } } catch { /* снят */ }
      if (Date.now() - t0 > ms) throw new Error('capture.json занят другим вызовом дольше 15 с');
      const t = Date.now(); while (Date.now() - t < 100) { /* ждем */ }
    }
  }
}
export function mergeCapture(chrome) {
  const shots = P('work', 'competitors', 'shots');
  fs.mkdirSync(shots, { recursive: true });
  const unlock = lockSync(path.join(shots, '.lock'));
  try {
    const map = competitorsMap();
    const pages = [];
    for (const d of fs.readdirSync(shots).sort()) {
      if (!exists(partFile(d))) continue;
      for (const r of readPart(d)) pages.push(map && r.role !== 'own' && !map.has(String(r.domain).toLowerCase()) ? { ...r, status: 'skipped', reason: 'stale' } : r);
    }
    const out = { generated_at: nowIso(), chrome: chrome || null, pages };
    writeJson(P('work', 'competitors', 'capture.json'), out);
    return out;
  } finally { unlock(); }
}

// готовая запись: ok или antibot, файлы на месте, тот же адрес
const done = (r, job) => r && r.url === job.url && ['ok', 'antibot'].includes(r.status) && (r.files || []).length > 0 && r.files.every(f => exists(P(f.file)));

// время одной страницы: не больше PAGE_MS и не дольше дедлайна + DEADLINE_GRACE_MS (но не меньше PAGE_MIN_MS) -
// вызов с --max-seconds 480 укладывается в 600 с Bash run-агента
export const PAGE_MS = 150000, PAGE_MIN_MS = 30000, DEADLINE_GRACE_MS = 90000;
export const NET_RETRY = /ERR_CONNECTION_(REFUSED|RESET|CLOSED|TIMED_OUT)|ERR_EMPTY_RESPONSE|ERR_NETWORK_CHANGED/;
export const NET_RETRY_MS = Number(process.env.SITE_TEKST_CAPTURE_RETRY_MS) || 20000;
export const pageLimit = (deadline, now = Date.now()) => Math.min(PAGE_MS, Math.max(PAGE_MIN_MS, deadline + DEADLINE_GRACE_MS - now));
async function runJobs(jobs, chrome, { concurrency, deadline, links, onRecord = () => {} }) {
  const out = new Map();
  const put = rec => { out.set(rec.name + '@' + rec.domain, rec); onRecord(rec); };
  if (!chrome) {
    // нет Chrome: DOM-находки по статическому html снимка (jsdom), кадров нет
    for (const j of jobs) put({ ...base(j), status: 'skipped', reason: 'no_chrome', ...(await staticDom(j, links)) });
    return { out, partial: false };
  }
  const queue = [...jobs];
  let partial = false;
  let cut = false;
  const worker = async () => {
    let b = null;
    try {
      while (queue.length) {
        if (Date.now() >= deadline) { partial = true; break; }
        const job = queue.shift();
        if (!b || b.closed) {
          try { b = await Browser.launch(chrome); } catch (e) { put({ ...base(job), status: 'error', reason: `запуск браузера: ${e.message}` }); b = null; continue; }
        }
        const lim = pageLimit(deadline);
        const rec = await Promise.race([capturePage(b, job, { links }), sleep(lim).then(() => null)]);
        if (!rec) {
          // срезано дедлайном - skipped (timeout, повтор с --resume), иначе - ошибка страницы
          if (lim < PAGE_MS) { cut = true; put({ ...base(job), status: 'skipped', reason: 'timeout', partial: true }); } else put({ ...base(job), status: 'error', reason: `таймаут страницы (${PAGE_MS / 1000} с)` });
          try { await b.close(); } catch { /* */ } b = null; continue;
        }
        // сетевой отказ (защита сайта режет частые запросы после статического снимка): один повтор в конце очереди после
        // паузы, если дедлайн позволяет
        if (rec.status === 'error' && NET_RETRY.test(rec.reason || '') && !job._retried && Date.now() + NET_RETRY_MS + PAGE_MIN_MS < deadline) {
          job._retried = true;
          await sleep(NET_RETRY_MS);
          queue.push(job);
          continue;
        }
        put(rec);
      }
    } finally { if (b) await b.close(); }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));
  for (const j of queue) put({ ...base(j), status: 'skipped', reason: 'timeout', partial: true });
  return { out, partial: partial || cut || queue.length > 0 };
}
// Нет Chrome: kf.json по статическому html снимка (raw -> html_path) через jsdom; нет html или jsdom - строка limits.
async function staticDom(job, links) {
  let html = '', url = job.url;
  try { const s = job.raw ? readJson(P(job.raw)) : null; if (s && s.html_path && exists(s.html_path)) { html = fs.readFileSync(s.html_path, 'utf8'); url = s.final_url || url; } } catch { /* нет снимка */ }
  if (!html) return { limits: ['нет статического html - без DOM-находок'] };
  let kf = null;
  try { kf = await scanHtml(html, { url, dict: { elements: [] }, links }); } catch (e) { return { limits: [`dom: ${String(e.message || e).slice(0, 120)}`] }; }
  if (!kf) return { limits: ['нет jsdom (npm install в корне проекта) - без DOM-находок'] };
  const dir = P('work', 'competitors', 'shots', job.domain, job.name);
  fs.mkdirSync(dir, { recursive: true });
  writeJson(path.join(dir, 'kf.json'), { url: job.url, domain: job.domain, name: job.name, type: job.type, captured_at: nowIso(), static: true, ...kf });
  return { dom: 'static' };
}
const base = j => ({ domain: j.domain, name: j.name, url: j.url, type: j.type, role: j.role, status: 'skipped', reason: '', height: 0, ms: 0, files: [], partial: false });

// ---------- прототип: первые экраны маршрутов ----------
async function protoShots(file, routes, outDir, chrome) {
  fs.mkdirSync(outDir, { recursive: true });
  const res = { out: posix(outDir), chrome: !!chrome, shots: [] };
  if (!chrome) return res;
  const b = await Browser.launch(chrome);
  try {
    const href = pathToFileURL(path.resolve(file)).href;
    for (const r of routes) {
      const slug = (r.replace(/^#\/?/, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'home').toLowerCase();
      const files = [];
      for (const [w, h, mobile] of [[W, VH, false], [MW, MH, true]]) {
        const tab = await openTab(b);
        try {
          await tab.S('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile });
          if (mobile) await tab.S('Network.setUserAgentOverride', { userAgent: MOBILE_UA });
          await navigate(b, tab, href + (r.startsWith('#') ? r : `#${r}`), 20000);
          await sleep(700);
          const s = await tab.S('Page.captureScreenshot', { format: 'jpeg', quality: 60, clip: { x: 0, y: 0, width: w, height: h, scale: 1 } }, 60000);
          const f = path.join(outDir, `${slug}-${w}.jpg`);
          fs.writeFileSync(f, Buffer.from(s.data, 'base64'));
          files.push(posix(f));
        } finally { await tab.close(); }
      }
      res.shots.push({ route: r, files });
    }
  } finally { await b.close(); }
  return res;
}

async function main() {
  const a = argv({ resume: 'bool' });
  const t0 = Date.now();
  cleanOrphans();
  const chrome = findChrome();
  if (a.file) {
    const routes = String(a.routes || '#/').split(',').map(s => s.trim()).filter(Boolean);
    if (!a.out) { console.error('usage: capture-pages.mjs --file <html> --routes "#/,#/x" --out <папка>'); process.exit(2); }
    if (!fs.existsSync(a.file)) { console.error(`нет файла: ${a.file}`); process.exit(2); }
    const r = await protoShots(a.file, routes, a.out, chrome);
    console.log(chrome ? `кадров прототипа: ${r.shots.length * 2} в ${r.out}` : 'нет Chrome и Edge - кадров прототипа нет');
    console.log('KF_PROTO ' + JSON.stringify({ ...r, ms: Date.now() - t0 }));
    return;
  }
  const domain = a.domain ? String(a.domain).trim().toLowerCase() : '';
  if (!domain || (a.url && !a.name)) { console.error('usage: capture-pages.mjs --domain <d> [--resume] [--concurrency 1] [--max-seconds 480] | --url <u> --domain <d> --name <имя> | --file <html> --routes "#/,#/x" --out <папка>'); process.exit(2); }
  const concurrency = Math.max(1, Number(a.concurrency) || 1);
  const deadline = t0 + Math.max(1, Number(a['max-seconds'] || 480)) * 1000;
  let jobs, note = '';
  if (a.url) {
    const map = competitorsMap();
    const c = map && map.get(domain);
    const pg = c && (c.pages || []).find(p => p && p.url === a.url);
    jobs = [{ domain: domain === 'own' ? 'own' : domain, name: String(a.name).replace(/[^\w.-]+/g, '-'), url: a.url, type: (pg && pg.type) || String(a.name).replace(/-\d+$/, '') || 'home', role: domain === 'own' ? 'own' : 'competitor' }];
  } else ({ jobs, note = '' } = domainJobs(domain));
  const dirDomain = jobs[0] ? jobs[0].domain : domain;
  const prev = readPart(dirDomain);
  const keep = new Map(prev.map(r => [r.name, r]));
  const todo = a.resume ? jobs.filter(j => !done(keep.get(j.name), j)) : jobs;
  const dict = readDict(P('config', 'kf-elements.json'));
  // запись части домена: записи этого вызова поверх прежних; --domain оставляет только страницы текущего списка домена
  // (нет списка - часть не трогается: устаревший домен остается в сводке как stale), --url - все прежние страницы.
  // Пишется после каждой снятой страницы и в конце.
  const pagesNow = () => (a.url ? [...keep.values()] : [...keep.values()].filter(r => jobs.some(j => j.name === r.name)));
  const save = () => { if (jobs.length) writeJson(partFile(dirDomain), { domain: dirDomain, updated_at: nowIso(), pages: pagesNow() }); return mergeCapture(chrome); };
  const onRecord = r => { keep.set(r.name, r); try { save(); } catch (e) { console.log(`запись части: ${String(e.message || e).slice(0, 120)}`); } };
  const { out, partial } = todo.length ? await runJobs(todo, chrome, { concurrency, deadline, links: linkPatterns(dict), onRecord }) : { out: new Map(), partial: false };
  for (const r of out.values()) keep.set(r.name, r);
  const pages = pagesNow();
  const cap = save();
  const mine = pages.filter(r => jobs.some(j => j.name === r.name));
  const count = s => mine.filter(r => r.status === s).length;
  const sum = { domain: dirDomain, chrome: !!chrome, jobs: jobs.length, captured: out.size, ok: count('ok'), antibot: count('antibot'), error: count('error'), skipped: count('skipped'), partial, ms: Date.now() - t0 };
  if (note) console.log(note);
  if (!chrome && todo.length) console.log('нет Chrome и Edge (SITE_TEKST_CHROME или пути по умолчанию) - страницы skipped (no_chrome); наблюдение пойдет по тексту снимков');
  for (const r of mine) console.log(`${r.status} ${r.domain}/${r.name} ${r.url}${r.reason ? ` - ${r.reason}` : ''}${r.files && r.files.length ? `, кадров ${r.files.length}` : ''}${r.limits ? ` (${r.limits.join('; ')})` : ''}`);
  if (partial) console.log(`дедлайн ${a['max-seconds'] || 480} с: остаток skipped (timeout) - повтори с --resume`);
  console.log(`capture.json: страниц ${cap.pages.length}`);
  console.log('KF_CAPTURE ' + JSON.stringify(sum));
}

const real = f => { try { return fs.realpathSync.native(path.resolve(f)).toLowerCase(); } catch { return ''; } };
if (process.argv[1] && real(process.argv[1]) === real(fileURLToPath(import.meta.url))) {
  main().then(() => process.exit(0), e => { console.error(`capture-pages: внутренняя ошибка: ${e.stack || e.message}`); process.exit(1); });
}
