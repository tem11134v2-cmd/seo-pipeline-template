// Сверка прототипа с блоками. node scripts/check-html.mjs [--file work/output/prototype.html]
// Проверяет: текст каждого блока в HTML совпадает с JSON (без учета пробелов), число страниц,
// один h1 на страницу, нет внешних ресурсов, только серые цвета в CSS.
import path from 'node:path';
import { argv, P, readText, readJson, exists, writeJson, loadSitemap, pageDir, makeFindings, addFinding, finalizeVerdict } from './lib.mjs';

const a = argv({});
const file = a.file || P('work', 'output', 'prototype.html');
const report = makeFindings('prototype', 'html-check');
const F = (sev, rule, problem, page, block_id, quote) => addFinding(report, { severity: sev, category: 'format', rule, problem, page, block_id, quote: (quote || '').slice(0, 160) });
if (!exists(file)) { F('blocker', 'html.missing', `нет файла ${file}`); }
else {
  const html = readText(file);
  const idx = readJson(file.replace(/\.html$/, '.index.json'));
  const norm = s => s.replace(/\s+/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/\s+([.,;:!?)\]])/g, '$1').replace(/([(\[])\s+/g, '$1').trim();
  const strip = s => s.replace(/<div class="lbl">[\s\S]*?<\/div>/g, ' ').replace(/<!--stub-->[\s\S]*?<!--\/stub-->/g, ' ').replace(/<[^>]+>/g, ' ');
  // страницы
  const articles = [...html.matchAll(/<article data-page="([^"]+)"[\s\S]*?<\/article>/g)];
  const sm = loadSitemap();
  const expectedPages = sm.pages.filter(p => p.status !== 'skip' && exists(path.join(pageDir(p.slug), 'brief.json')) && exists(path.join(pageDir(p.slug), 'blocks'))).map(p => p.slug);
  for (const s of Object.keys(idx)) if (!articles.find(m => m[1] === s)) F('blocker', 'html.page-missing', `страницы ${s} нет в прототипе`, s);
  for (const m of articles) {
    const slug = m[1], body = m[0];
    const h1s = (body.match(/<h1\b/g) || []).length;
    if (h1s !== 1) F('blocker', 'html.h1', `на странице ${h1s} h1`, slug);
    for (const sec of body.matchAll(/<section\b[^>]*data-block-id="([^"]+)"[^>]*>([\s\S]*?)<\/section>/g)) {
      const id = sec[1];
      if (/data-missing="1"/.test(sec[0])) { F('major', 'html.block-missing', 'блок не написан', slug, id); continue; }
      const got = norm(strip(sec[2]));
      const expRaw = (idx[slug] || {})[id] || '';
      if (!expRaw) { F('blocker', 'html.index', 'нет эталонного текста блока в index.json', slug, id); continue; }
      // проверяем, что каждая строка эталона присутствует в HTML-тексте
      for (const line of expRaw.split('\n').map(x => x.trim()).filter(Boolean)) {
        const l = norm(line).replace(/\*\*/g, '');
        if (!got.includes(l)) F('blocker', 'html.text-mismatch', 'текст блока в HTML отличается от JSON', slug, id, l);
      }
    }
  }
  // внешние ресурсы
  if (/<(script|link)[^>]+(src|href)="https?:/i.test(html)) F('blocker', 'html.external', 'внешний скрипт или стиль');
  // цвета: только серые
  const styleBlock = (html.match(/<style>([\s\S]*?)<\/style>/) || [])[1] || '';
  for (const c of styleBlock.matchAll(/#([0-9a-f]{3}|[0-9a-f]{6})\b/gi)) {
    let h = c[1]; if (h.length === 3) h = h.split('').map(x => x + x).join('');
    const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    if (Math.abs(r - g) > 6 || Math.abs(g - b) > 6) F('major', 'html.color', `не серый цвет #${c[1]} в CSS`);
  }
  const kb = Buffer.byteLength(html) / 1024;
  if (kb > 6000) F('major', 'html.size', `файл ${kb.toFixed(0)} КБ, тяжело открывать на телефоне`);
  report.scores = { pages: articles.length, expected_pages: expectedPages.length, size_kb: Math.round(kb) };
}
finalizeVerdict(report);
writeJson(P('work', 'audit', 'html-check.json'), report);
console.log(`check-html: ${report.verdict} (${report.summary}) страниц ${report.scores?.pages ?? 0}`);
report.findings.slice(0, 40).forEach(f => console.log(` - [${f.severity}] ${f.rule} ${f.page || ''}/${f.block_id || ''}: ${f.problem}${f.quote ? ` | «${f.quote.slice(0, 80)}»` : ''}`));
process.exit(report.verdict === 'pass' ? 0 : 1);
