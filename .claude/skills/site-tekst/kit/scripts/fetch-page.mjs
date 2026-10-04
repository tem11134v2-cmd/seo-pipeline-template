// Снимок страницы (конкурента или сайта компании) со статусом.
// node scripts/fetch-page.mjs <url> <out.json> [--timeout 20000]
// node scripts/fetch-page.mjs <url> <out.json> --text-from <file.md>   - текст, снятый браузером
//   (заголовки строками "# ", "## ", "### "; ссылки - [текст](url); остальное - абзацы). Статус будет "browser".
// node scripts/fetch-page.mjs --dom-snippet   - печатает код обхода DOM для javascript_tool браузера (DOM_SNIPPET ниже).
// Результат: {url, final_url, fetched_at, status, flat?, verbatim?, http_status, via?, cause?, error?, html_bytes, text_chars,
//   headings_count, title, description, sections:[{level, heading, chars, words, text, truncated?}], links:[{href,text}],
//   footer_text, html_path}
// Статусы (pageStatus): antibot - HTTP 401/403/429/498/503 или страница проверки (признак в заголовке окна или в видимом
//   тексте короткой страницы; виджеты форм и скрипты CDN в коде не считаются) | closed (HTTP >= 400) | js_only - текста
//   меньше 1500 знаков или пустая оболочка SPA | ok (flat: true - текст есть, а заголовков h1-h3 меньше двух) |
//   error (исключение, таймаут: сайт не ответил) | browser.
// --text-from: первая строка «<!-- dom-snapshot: N -->» - отметка обхода DOM из 02-competitor-verifier (N - знаков без
//   пробелов в остальном тексте); нет отметки или N не сходится - verbatim: false (пересказ, а не снимок). Статический
//   снимок того же адреса (ok или js_only) не меньше браузерного по text_chars - остается он (js_only становится ok).
//   Текст секции в снимке - до 4000 знаков (chars - по полному тексту), обрезанная секция - truncated: true.
// Сбой запроса: один повтор через 4 с (FETCH_PAGE_RETRY_MS), затем запасной путь через curl (via: curl): флаги по
// `curl -V` (--compressed только при поддержке сжатия; на Schannel/WinSSL - --ssl-revoke-best-effort или
// --ssl-no-revoke), тело в файл, код ответа, конечный адрес и Content-Type - из -w. На Windows при системном curl без
// сжатия берется curl из Git. Кодировка - из Content-Type, иначе из meta charset (windows-1251 и др. через TextDecoder).
// Ссылки - только своего хоста (без www), относительные считаются от конечного адреса после редиректа.
// footer_text - текст подвала (<footer> или элемент с footer в class/id; в --text-from - хвост текста), там реквизиты.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { argv, nowIso, writeJson, charsNoSpaces, words } from './lib.mjs';

export const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

export function stripTags(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article|header|footer|blockquote|dd|dt)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&mdash;/g, '-').replace(/&ndash;/g, '-').replace(/&laquo;/g, '«').replace(/&raquo;/g, '»')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
}

export function sectionsFromHtml(html) {
  // Режем body по заголовкам h1-h3. Текст до первого заголовка - секция level 0.
  let body = html;
  const m = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  if (m) body = m[1];
  body = body.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<header[\s\S]*?<\/header>/i, ' ').replace(/<footer[\s\S]*?<\/footer>/i, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ');
  const re = /<h([123])[^>]*>([\s\S]*?)<\/h\1>/gi;
  const sections = [];
  let last = 0, mm, prev = null;
  while ((mm = re.exec(body))) {
    const before = body.slice(last, mm.index);
    if (prev) prev.raw = before; else if (stripTags(before).length > 40) sections.push({ level: 0, heading: '(до первого заголовка)', raw: before });
    prev = { level: Number(mm[1]), heading: stripTags(mm[2]).replace(/\s+/g, ' ').trim(), raw: '' };
    sections.push(prev);
    last = mm.index + mm[0].length;
  }
  if (prev) prev.raw = body.slice(last); else sections.push({ level: 0, heading: '(без заголовков)', raw: body });
  return sections.map(s => section(s.level, s.heading, stripTags(s.raw)));
}
export const SECTION_TEXT_MAX = 4000;
const section = (level, heading, text) => ({ level, heading, chars: charsNoSpaces(text), words: words(text).length, text: text.slice(0, SECTION_TEXT_MAX), ...(text.length > SECTION_TEXT_MAX ? { truncated: true } : {}) });

// ---------- статус снимка ----------
export const ANTIBOT_CODES = [401, 403, 429, 498, 503];
export const JS_ONLY_CHARS = 1500;
// Страница проверки (челлендж защиты от ботов). Признак ищется в заголовке окна и в видимом тексте (без head, script,
// style) и только на короткой странице: у заглушки мало текста. Слова captcha и cloudflare в коде страницы (виджет
// формы, скрипт с CDN) признаком не считаются.
const CHALLENGE = /just a moment|attention required|checking (if the site|your browser)|ddos-guard|qrator|stormwall|servicepipe|access denied|доступ (запрещен|ограничен)|вы не робот|что запросы отправляли вы|are you (a )?(robot|human)|enable javascript and cookies|проверка (браузера|безопасности)|security check|похоже, нет соединения/i;
const CHALLENGE_TITLE = /captcha|капча/i;
// Пустая оболочка SPA: корневой контейнер приложения без содержимого (текст рисует скрипт).
const EMPTY_SPA = /<(div|main|section)\b[^>]*\bid=["'](root|app|__next|__nuxt|__layout|q-app)["'][^>]*>\s*<\/\1>|<app-root\b[^>]*>\s*<\/app-root>/i;
export function pageStatus({ html = '', http_status = 0, text_chars = 0, headings_count = 0, title = '' }) {
  const body = (String(html).match(/<body[^>]*>([\s\S]*)<\/body>/i) || [])[1] ?? String(html).replace(/<head[\s\S]*?<\/head>/i, ' ');
  const small = text_chars < JS_ONLY_CHARS;
  if (ANTIBOT_CODES.includes(http_status)) return { status: 'antibot' };
  if (small && (CHALLENGE.test(title) || CHALLENGE_TITLE.test(title) || CHALLENGE.test(stripTags(body)))) return { status: 'antibot' };
  if (http_status >= 400) return { status: 'closed' };
  if (small || EMPTY_SPA.test(body)) return { status: 'js_only' };
  return headings_count < 2 ? { status: 'ok', flat: true } : { status: 'ok' };
}

// Обход DOM для браузерного снимка (javascript_tool в своей вкладке; `node scripts/fetch-page.mjs --dom-snippet` печатает
// код). Текст страницы дословно: h1-h3 - строки «#», ссылки - [текст](url), блочные элементы - абзацы; nav, шапка и
// подвал страницы (header/footer вне main, article, section) - только ссылками первой строкой, скрытое не берется.
// Первая строка результата - отметка «<!-- dom-snapshot: N -->», N - знаков без пробелов в остальном тексте; текст -
// до 20000 знаков. Функция исполняется в браузере: в node ее только печатают и проверяют в тестах (jsdom).
function domSnapshot() {
  const SKIP = /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|SVG|IFRAME|SELECT)$/, INLINE = /^(A|ABBR|B|BDI|CITE|CODE|EM|FONT|I|IMG|KBD|MARK|Q|S|SMALL|SPAN|STRONG|SUB|SUP|TIME|U)$/;
  const sp = s => s.replace(/[\u00ad\u200b-\u200d\u2060\ufeff]/g, '').replace(/\s+/g, ' ').trim();
  const link = a => '[' + sp(a.textContent).replace(/[[\]]/g, '') + '](' + a.href.replace(/[()\s]/g, c => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')) + ')';
  const out = [], menu = [], seen = new Set();
  let buf = '';
  const flush = () => { const t = sp(buf); if (t) out.push(t); buf = ''; };
  const walk = n => {
    if (n.nodeType === 3) { buf += n.textContent; return; }
    if (n.nodeType !== 1) return;
    // tagName элементов SVG (svg, style, text) в HTML-документе строчный: сравнение - по заглавным
    const tag = String(n.tagName || '').toUpperCase();
    if (SKIP.test(tag)) return;
    if (tag === 'NAV' || (/^(HEADER|FOOTER)$/.test(tag) && !n.parentElement.closest('main,article,section'))) {
      for (const a of n.querySelectorAll('a[href]')) if (/^https?:/.test(a.href) && !seen.has(a.href) && menu.length < 150) { seen.add(a.href); menu.push(link(a)); }
      return;
    }
    const cs = getComputedStyle(n);
    if (cs.display === 'none' || cs.visibility === 'hidden') return;
    const h = /^H([1-3])$/.exec(tag);
    if (h) { flush(); const t = sp(n.textContent); if (t) out.push('#'.repeat(Number(h[1])) + ' ' + t); return; }
    if (tag === 'A' && /^https?:/.test(n.href)) { buf += ' ' + link(n) + ' '; return; }
    if (tag === 'BR') { flush(); return; }
    const block = !INLINE.test(tag) && !String(cs.display).startsWith('inline');
    if (block) flush();
    for (const c of n.childNodes) walk(c);
    if (block) flush();
  };
  walk(document.body); flush();
  let md = [menu.join(' '), ...out].filter(Boolean).join('\n\n');
  if (md.length > 20000) md = md.slice(0, md.lastIndexOf('\n', 20000));
  return '<!-- dom-snapshot: ' + md.replace(/\s/g, '').length + ' -->\n' + md;
}
export const DOM_SNIPPET = `(${domSnapshot.toString()})()`;

// Отметка обхода DOM в браузерном снимке: {marked, expected, actual, verbatim, rest}. Допуск - 1% (не меньше 5 знаков):
// копия вывода обхода совпадает по знакам без пробелов, пересказ и сокращение - нет.
export const DOM_MARK = /^\s*<!--\s*dom-snapshot:\s*(\d+)\s*-->[^\n]*\n?/;
export function domSnapshotCheck(md) {
  const m = String(md).match(DOM_MARK);
  const rest = m ? String(md).slice(m[0].length) : String(md);
  const actual = rest.replace(/\s/g, '').length;
  if (!m) return { marked: false, expected: null, actual, verbatim: false, rest };
  const expected = Number(m[1]);
  return { marked: true, expected, actual, verbatim: Math.abs(actual - expected) <= Math.max(5, expected * 0.01), rest };
}

export function sectionsFromMarkdown(md) {
  const lines = md.split(/\r?\n/);
  const sections = [];
  let cur = { level: 0, heading: '(до первого заголовка)', lines: [] };
  for (const line of lines) {
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) { sections.push(cur); cur = { level: h[1].length, heading: h[2].trim(), lines: [] }; }
    else cur.lines.push(line);
  }
  sections.push(cur);
  return sections.filter(s => s.heading !== '(до первого заголовка)' || s.lines.join('').trim().length > 40).map(s =>
    section(s.level, s.heading, s.lines.join('\n').replace(/\[([^\]]*)\]\([^)\s]+(?:\s+"[^"]*")?\)/g, '$1').replace(/\n\s*\n+/g, '\n').trim()));
}

const sameUrl = (x, y) => String(x || '').replace(/\/+$/, '') === String(y || '').replace(/\/+$/, '');
const bareHost = u => { try { return new URL(u).host.replace(/^www\./i, '').toLowerCase(); } catch { return ''; } };
// Ссылка своего хоста (без учета www): абсолютный адрес без query, или null.
function ownLink(href, base, host) {
  const h = String(href || '').trim();
  if (!h || h.startsWith('#') || /^(mailto:|tel:|javascript:|data:)/i.test(h)) return null;
  let abs;
  try { abs = new URL(h, base); } catch { return null; }
  if (!/^https?:$/.test(abs.protocol)) return null;
  if (host && abs.host.replace(/^www\./i, '').toLowerCase() !== host) return null;
  abs.hash = '';
  return abs.toString().replace(/\?.*$/, '');
}
export function linksFromHtml(html, base) {
  const out = [];
  const re = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const host = bareHost(base);
  const seen = new Set();
  let m;
  while ((m = re.exec(html)) && out.length < 400) {
    const href = ownLink(m[1], base, host);
    if (!href || seen.has(href)) continue;
    seen.add(href);
    out.push({ href, text: stripTags(m[2]).replace(/\s+/g, ' ').trim().slice(0, 80) });
  }
  return out;
}
// Ссылки браузерного снимка: строки [текст](url), тот же фильтр хоста.
export function linksFromMarkdown(md, base) {
  const out = [];
  const host = bareHost(base);
  const seen = new Set();
  for (const m of String(md).matchAll(/\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const href = ownLink(m[2], base, host);
    if (!href || seen.has(href)) continue;
    seen.add(href);
    out.push({ href, text: m[1].replace(/\s+/g, ' ').trim().slice(0, 80) });
    if (out.length >= 400) break;
  }
  return out;
}
export function footerText(html) {
  const tags = [...html.matchAll(/<footer[\s>][\s\S]*?<\/footer>/gi)].map(m => m[0]);
  let raw = tags.length ? tags[tags.length - 1] : '';
  if (!raw) {
    // элемент с footer в class или id: берем от него до конца body
    const i = html.search(/<(div|section)[^>]+(class|id)=["'][^"']*footer[^"']*["']/i);
    if (i >= 0) raw = html.slice(i).replace(/<\/body>[\s\S]*$/i, '');
  }
  if (!raw) {
    const body = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i) || [])[1] || html;
    return stripTags(body).slice(-1500);
  }
  return stripTags(raw).slice(0, 3000);
}

// Кодировка тела: charset из Content-Type, иначе из meta в начале документа, иначе utf-8.
export function decodeBody(buf, contentType) {
  let cs = (String(contentType || '').match(/charset=["']?([\w-]+)/i) || [])[1];
  if (!cs) {
    const head = Buffer.from(buf).subarray(0, 4096).toString('latin1');
    cs = (head.match(/<meta[^>]+charset=["']?([\w-]+)/i) || [])[1];
  }
  const label = String(cs || 'utf-8').toLowerCase();
  try { return { text: new TextDecoder(label).decode(buf), charset: label }; } catch { return { text: new TextDecoder('utf-8').decode(buf), charset: 'utf-8' }; }
}

// ---------- запасной путь: curl ----------
// Флаги по возможностям curl: версия и Features из `curl -V`, список ключей из `curl --help all`.
export function curlFlags(versionText, helpText) {
  const v = String(versionText || '');
  const features = (v.match(/^Features:(.*)$/mi) || [])[1] || '';
  const flags = [];
  const compressed = /\b(libz|brotli|zstd)\b/i.test(features);
  if (compressed) flags.push('--compressed');
  if (/WinSSL|Schannel/i.test(v.split('\n')[0] || '')) {
    const help = String(helpText || '');
    if (help.includes('--ssl-revoke-best-effort')) flags.push('--ssl-revoke-best-effort');
    else if (help.includes('--ssl-no-revoke')) flags.push('--ssl-no-revoke');
  }
  return { flags, compressed };
}
function probeCurl(bin) {
  const r = spawnSync(bin, ['-V'], { encoding: 'utf8', timeout: 10000, windowsHide: true });
  if (r.error || r.status !== 0 || !/^curl\s/m.test(r.stdout || '')) return null;
  const h = spawnSync(bin, ['--help', 'all'], { encoding: 'utf8', timeout: 10000, windowsHide: true });
  return { bin, ...curlFlags(r.stdout, h.stdout || '') };
}
let curlChoice;
// Какой curl брать: из PATH; на Windows, если он без сжатия, - curl из Git (mingw64/bin), если он есть.
export function pickCurl() {
  if (curlChoice !== undefined) return curlChoice;
  const cands = ['curl'];
  if (process.platform === 'win32') {
    const g = spawnSync('git', ['--exec-path'], { encoding: 'utf8', timeout: 10000, windowsHide: true });
    if (!g.error && g.status === 0 && g.stdout.trim()) cands.push(path.resolve(g.stdout.trim(), '..', '..', 'bin', 'curl.exe'));
    for (const base of [process.env.ProgramW6432, process.env.ProgramFiles, process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs')].filter(Boolean)) cands.push(path.join(base, 'Git', 'mingw64', 'bin', 'curl.exe'));
  }
  let first = null;
  for (const c of [...new Set(cands)]) {
    if (c !== 'curl' && !fs.existsSync(c)) continue;
    const p = probeCurl(c);
    if (!p) continue;
    first ??= p;
    if (p.compressed) { curlChoice = p; return p; }
  }
  curlChoice = first;
  return first;
}
// Запрос через curl: {ok, http_status, final_url, content_type, buf} или {ok:false, cause, error}.
export function fetchViaCurl(url, { timeoutSec = 30 } = {}) {
  const c = pickCurl();
  if (!c) return { ok: false, cause: 'curl:нет', error: 'curl не найден' };
  const tmp = path.join(os.tmpdir(), `fetch-page-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.body`);
  const args = [...c.flags, '-sSL', '-m', String(timeoutSec), '-A', UA, '-H', 'Accept: text/html,application/xhtml+xml', '-H', 'Accept-Language: ru,en;q=0.8',
    '-o', tmp, '-w', '%{http_code}\\n%{url_effective}\\n%{content_type}', url];
  const r = spawnSync(c.bin, args, { encoding: 'utf8', timeout: (timeoutSec + 10) * 1000, windowsHide: true });
  try {
    if (r.error) return { ok: false, cause: `curl:${r.error.code || 'spawn'}`, error: String(r.error.message).slice(0, 200) };
    if (r.status !== 0) return { ok: false, cause: `curl:${r.status}`, error: String(r.stderr || '').trim().slice(0, 200) };
    const [code, finalUrl, ctype] = String(r.stdout || '').split(/\r?\n/);
    const buf = fs.existsSync(tmp) ? fs.readFileSync(tmp) : Buffer.alloc(0);
    return { ok: true, http_status: Number(code) || 0, final_url: finalUrl || url, content_type: ctype || '', buf, bin: c.bin };
  } finally { try { fs.rmSync(tmp, { force: true }); } catch { /* временный файл */ } }
}

async function fetchNative(url, timeout) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await fetch(url, { signal: ctrl.signal, redirect: 'follow', headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml', 'accept-language': 'ru,en;q=0.8' } });
    const buf = Buffer.from(await r.arrayBuffer());
    return { ok: true, http_status: r.status, final_url: r.url || url, content_type: r.headers.get('content-type') || '', buf };
  } catch (e) {
    const cause = e.name === 'AbortError' ? 'timeout' : (e.cause && e.cause.code) || e.name || 'error';
    return { ok: false, cause, error: `${e.name}: ${e.message}${e.cause && e.cause.message ? ` (${e.cause.message})` : ''}`.slice(0, 200) };
  } finally { clearTimeout(timer); }
}

async function main() {
  const a = argv({ 'dom-snippet': 'bool' });
  if (a['dom-snippet']) { console.log(DOM_SNIPPET); return; }
  const [url, out] = a._;
  if (!url || !out) { console.error('usage: fetch-page.mjs <url> <out.json> [--text-from file] [--timeout ms] | --dom-snippet'); process.exit(2); }
  const timeout = Number(a.timeout || 20000);
  const result = { url, final_url: url, fetched_at: nowIso(), status: 'error', http_status: 0, html_bytes: 0, text_chars: 0, headings_count: 0, title: '', description: '', sections: [], links: [], footer_text: '', html_path: '' };
  if (a['text-from']) {
    const dom = domSnapshotCheck(fs.readFileSync(a['text-from'], 'utf8').replace(/^\ufeff/, ''));
    const md = dom.rest;
    result.status = 'browser';
    result.verbatim = dom.verbatim;
    result.sections = sectionsFromMarkdown(md);
    result.text_chars = result.sections.reduce((s, x) => s + x.chars, 0);
    result.headings_count = result.sections.filter(s => s.level > 0).length;
    const t = md.match(/^#\s+(.*)$/m); result.title = t ? t[1] : '';
    result.links = linksFromMarkdown(md, url);
    result.footer_text = md.replace(/\[([^\]]*)\]\([^)\s]+(?:\s+"[^"]*")?\)/g, '$1').replace(/^#+\s+/gm, '').replace(/\s+/g, ' ').trim().slice(-1500);
    const note = dom.verbatim ? '' : dom.marked
      ? `; не дословно: знаков ${dom.actual} при отметке обхода ${dom.expected} - сохрани вывод обхода DOM заново, без правок`
      : '; не дословно: нет отметки обхода DOM (первая строка <!-- dom-snapshot: N -->) - сними страницу обходом из промта';
    // статический снимок того же адреса не меньше браузерного - остается он (браузерный текст - только если он больше)
    let prev = null;
    try { prev = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8').replace(/^\ufeff/, '')) : null; } catch { prev = null; }
    // браузер тоже получил страницу проверки (короткий текст «Just a moment», «вы не робот», капча в заголовке) - это не
    // страница лидера: прежний снимок не заменяется, без него - статус antibot (как pageStatus статического снимка)
    if (result.text_chars < JS_ONLY_CHARS && (CHALLENGE.test(md) || CHALLENGE_TITLE.test(result.title))) {
      if (!prev) writeJson(out, { ...result, status: 'antibot' });
      console.log(`antibot ${url}: браузер получил страницу проверки (символов ${result.text_chars}) - снимок ${prev ? 'прежний не заменен' : 'записан со статусом antibot'}`);
      return;
    }
    if (prev && prev.html_path && ['ok', 'js_only'].includes(prev.status) && [prev.url, prev.final_url].some(u => sameUrl(u, url)) && (prev.text_chars || 0) >= result.text_chars) {
      const was = prev.status;
      if (was === 'js_only') { prev.status = 'ok'; prev.browser_smaller = true; }
      writeJson(out, prev);
      console.log(`${prev.status} ${url}: статический снимок не меньше браузерного (${prev.text_chars} >= ${result.text_chars}) - оставлен статический${was === 'js_only' ? ', статус js_only -> ok' : ''}${note}`);
      return;
    }
    writeJson(out, result);
    console.log(`browser ${url}: секций ${result.sections.length}, символов ${result.text_chars}, ссылок ${result.links.length}${note}`);
    return;
  }
  const retryMs = Number(process.env.FETCH_PAGE_RETRY_MS || 4000);
  let r = await fetchNative(url, timeout);
  if (!r.ok) { await new Promise(res => setTimeout(res, retryMs)); r = await fetchNative(url, timeout); }
  if (!r.ok) {
    const c = fetchViaCurl(url, { timeoutSec: Math.max(10, Math.ceil(timeout / 1000) + 10) });
    if (c.ok) { r = c; result.via = 'curl'; }
    else {
      result.status = 'error';
      result.cause = [r.cause, c.cause].filter(Boolean).join('; ');
      result.error = [r.error, c.error && `curl: ${c.error}`].filter(Boolean).join('; ').slice(0, 300);
      writeJson(out, result);
      console.log(`error ${url}: ${result.cause} - сайт не ответил (не путать с closed): ${result.error}`);
      return;
    }
  }
  result.http_status = r.http_status;
  result.final_url = r.final_url || url;
  const { text: html, charset } = decodeBody(r.buf, r.content_type);
  result.charset = charset;
  result.html_bytes = r.buf.length;
  const htmlPath = out.replace(/\.json$/, '.html');
  fs.mkdirSync(path.dirname(htmlPath), { recursive: true });
  fs.writeFileSync(htmlPath, html, 'utf8');
  result.html_path = htmlPath;
  const tm = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i); result.title = tm ? stripTags(tm[1]).trim() : '';
  const dm = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i) || html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i);
  result.description = dm ? dm[1].trim() : '';
  result.sections = sectionsFromHtml(html);
  result.text_chars = result.sections.reduce((s, x) => s + x.chars, 0);
  result.headings_count = result.sections.filter(s => s.level > 0).length;
  result.links = linksFromHtml(html, result.final_url);
  result.footer_text = footerText(html);
  const st = pageStatus({ html, http_status: result.http_status, text_chars: result.text_chars, headings_count: result.headings_count, title: result.title });
  result.status = st.status;
  if (st.flat) result.flat = true;
  writeJson(out, result);
  console.log(`${result.status}${result.flat ? ' (плоская: заголовков меньше двух, блоки - по html_path)' : ''} ${url}${result.final_url !== url ? ` -> ${result.final_url}` : ''}: http ${result.http_status}${result.via ? `, через ${result.via}` : ''}, html ${result.html_bytes} байт (${charset}), текст ${result.text_chars} символов, заголовков ${result.headings_count}, ссылок ${result.links.length}`);
}

// CLI: запуск файлом (при импорте модуля в тестах main не выполняется); пути сравниваются после realpath (8.3 и регистр)
const real = f => { try { return fs.realpathSync.native(path.resolve(f)).toLowerCase(); } catch { return ''; } };
if (process.argv[1] && real(process.argv[1]) === real(fileURLToPath(import.meta.url))) main();
