// Снимок страницы конкурента со статусом.
// node scripts/fetch-page.mjs <url> <out.json> [--timeout 20000]
// node scripts/fetch-page.mjs <url> <out.json> --text-from <file.md>   - текст, снятый браузером
//   (заголовки строками "# ", "## ", "### "; остальное - абзацы). Статус будет "browser".
// Результат: {url, fetched_at, status, http_status, html_bytes, text_chars, headings_count, title,
//   description, sections:[{level, heading, chars, words, text}], links:[{href,text}], html_path}
// Статусы: ok | js_only | antibot | closed | browser
import fs from 'node:fs';
import path from 'node:path';
import { argv, nowIso, writeJson, charsNoSpaces, words } from './lib.mjs';

const a = argv({});
const [url, out] = a._;
if (!url || !out) { console.error('usage: fetch-page.mjs <url> <out.json> [--text-from file] [--timeout ms]'); process.exit(2); }
const timeout = Number(a.timeout || 20000);

function stripTags(html) {
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
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&mdash;/g, '-').replace(/&ndash;/g, '-')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
}

function sectionsFromHtml(html) {
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
  return sections.map(s => {
    const text = stripTags(s.raw);
    return { level: s.level, heading: s.heading, chars: charsNoSpaces(text), words: words(text).length, text: text.slice(0, 4000) };
  });
}

function sectionsFromMarkdown(md) {
  const lines = md.split(/\r?\n/);
  const sections = [];
  let cur = { level: 0, heading: '(до первого заголовка)', lines: [] };
  for (const line of lines) {
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) { sections.push(cur); cur = { level: h[1].length, heading: h[2].trim(), lines: [] }; }
    else cur.lines.push(line);
  }
  sections.push(cur);
  return sections.filter(s => s.heading !== '(до первого заголовка)' || s.lines.join('').trim().length > 40).map(s => {
    const text = s.lines.join('\n').replace(/\n\s*\n+/g, '\n').trim();
    return { level: s.level, heading: s.heading, chars: charsNoSpaces(text), words: words(text).length, text: text.slice(0, 4000) };
  });
}

function linksFromHtml(html, base) {
  const out = [];
  const re = /<a\s+[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m; const seen = new Set();
  let host = '';
  try { host = new URL(base).host; } catch {}
  while ((m = re.exec(html)) && out.length < 400) {
    let href = m[1].trim();
    if (/^(mailto:|tel:|javascript:)/i.test(href)) continue;
    try { href = new URL(href, base).toString(); } catch { continue; }
    if (host && new URL(href).host !== host) continue;
    href = href.replace(/\?.*$/, '');
    if (seen.has(href)) continue;
    seen.add(href);
    out.push({ href, text: stripTags(m[2]).replace(/\s+/g, ' ').trim().slice(0, 80) });
  }
  return out;
}

async function main() {
  const result = { url, fetched_at: nowIso(), status: 'closed', http_status: 0, html_bytes: 0, text_chars: 0, headings_count: 0, title: '', description: '', sections: [], links: [], html_path: '' };
  if (a['text-from']) {
    const md = fs.readFileSync(a['text-from'], 'utf8');
    result.status = 'browser';
    result.sections = sectionsFromMarkdown(md);
    result.text_chars = result.sections.reduce((s, x) => s + x.chars, 0);
    result.headings_count = result.sections.filter(s => s.level > 0).length;
    const t = md.match(/^#\s+(.*)$/m); result.title = t ? t[1] : '';
    writeJson(out, result);
    console.log(`browser ${url}: секций ${result.sections.length}, символов ${result.text_chars}`);
    return;
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  let html = '';
  try {
    const r = await fetch(url, { signal: ctrl.signal, redirect: 'follow', headers: {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      'accept': 'text/html,application/xhtml+xml', 'accept-language': 'ru,en;q=0.8' } });
    result.http_status = r.status;
    html = await r.text();
  } catch (e) {
    result.status = 'closed'; result.error = `${e.name}: ${e.message}`.slice(0, 200);
    writeJson(out, result);
    console.log(`closed ${url}: ${result.error}`);
    return;
  } finally { clearTimeout(timer); }
  result.html_bytes = Buffer.byteLength(html, 'utf8');
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
  result.links = linksFromHtml(html, url);
  const low = html.toLowerCase();
  const antibot = [401, 403, 429, 498, 503].includes(result.http_status) || /captcha|access denied|cloudflare|attention required|ddos-guard|нет соединения|похоже, нет соединения/.test(low) && result.text_chars < 2000;
  if (antibot) result.status = 'antibot';
  else if (result.http_status >= 400) result.status = 'closed';
  else if (result.text_chars < 1500 || result.headings_count < 2) result.status = 'js_only';
  else result.status = 'ok';
  writeJson(out, result);
  console.log(`${result.status} ${url}: http ${result.http_status}, html ${result.html_bytes} байт, текст ${result.text_chars} символов, заголовков ${result.headings_count}, ссылок ${result.links.length}`);
}
main();
