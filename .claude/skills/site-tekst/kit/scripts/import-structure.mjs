// Импорт готовой структуры сайта в work/sitemap.json.
// node scripts/import-structure.mjs [--src inputs/structure_data.json] [--skip-legal]
// Поддерживаемый формат источника: {pages:[{n,url,type,name,section,target_status,marker,queries[],status,role,client_notes}]}
// (формат seo-struktura). Для других форматов карту пишет резервный агент по schemas/sitemap.schema.json.
import { argv, P, readJson, writeJson, exists, nowIso, loadConfig, validate, loadSchema } from './lib.mjs';

const a = argv({ 'skip-legal': 'bool' });
const cfg = loadConfig();
const src = a.src || cfg.sources?.structure_source || 'inputs/structure_data.json';
if (!exists(src)) { console.error(`нет файла структуры: ${src}`); process.exit(2); }
const data = readJson(src);
const pagesIn = data.pages || [];

const TYPE_ENUM = ['home', 'hub', 'category', 'service', 'product', 'info_about', 'info_contacts', 'info_team', 'info_reviews', 'info_cases', 'info_faq', 'info_other'];
const LEGAL_RE = /privacy|policy|terms|agreement|oferta|soglashenie|politika|favorites|izbrannoe|cookie/i;

function infoType(url, name) {
  const u = (url + ' ' + name).toLowerCase();
  if (/about|o-kompanii|о компании|о нас/.test(u)) return 'info_about';
  if (/contact|kontakt|контакт/.test(u)) return 'info_contacts';
  if (/team|komanda|команда/.test(u)) return 'info_team';
  if (/review|otzyv|отзыв/.test(u)) return 'info_reviews';
  if (/case|kejs|кейс/.test(u)) return 'info_cases';
  if (/faq|vopros|вопрос/.test(u)) return 'info_faq';
  return 'info_other';
}
function mapType(p) {
  const t = String(p.type || '').toLowerCase();
  const role = String(p.role || '').toLowerCase();
  const name = String(p.name || '').toLowerCase();
  if (t.includes('главн') || p.url === '/' || /^\/[a-z]{2}\/?$/.test(p.url)) return 'home';
  if (t.includes('статья') || t.includes('блог')) return null;
  if (/шаблон|-slug\b|\{[a-z_]+\}/.test(name + ' ' + p.url)) return 'product';
  if (/\(хаб\)|(^|\s)хаб(\s|$)/.test(name)) return 'hub';
  if (t.includes('услуг')) return 'service';
  if (t.includes('товар')) return 'product';
  if (t.includes('инфо')) return infoType(p.url, p.name || '');
  if (t.includes('прочее')) return 'info_other';
  if (t.includes('категор')) return (role.includes('навигац') || role.includes('обзор')) ? 'hub' : 'category';
  return 'category';
}
function slugOf(url) {
  return url.replace(/^\/+|\/+$/g, '').replace(/[{}<>]/g, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'home';
}
const urls = new Set(pagesIn.map(p => p.url));
function parentOf(url) {
  const parts = url.replace(/\/+$/, '').split('/');
  while (parts.length > 2) { parts.pop(); const cand = parts.join('/'); if (urls.has(cand)) return cand; }
  return '';
}

const pages = [];
const skipped = [];
for (const p of pagesIn) {
  const yes = String(p.target_status || p.target_raw || '').toLowerCase();
  if (yes && !/^(yes|да|целев)/.test(yes)) { skipped.push({ url: p.url, reason: `target_status=${p.target_status}` }); continue; }
  const type = mapType(p);
  if (!type) { skipped.push({ url: p.url, reason: 'статья/блог' }); continue; }
  const isLegal = LEGAL_RE.test(p.url);
  const level = Math.max(0, p.url.replace(/\/+$/, '').split('/').length - 2);
  pages.push({
    slug: slugOf(p.url),
    url: p.url,
    type,
    subject: p.name || p.marker || p.url,
    parent: parentOf(p.url),
    level,
    geo: '',
    segment: '',
    facts_available: [],
    fact_coverage: 0,
    block_set: 'full',
    listing: type === 'category' && !/hub/.test(type),
    wave: type === 'home' ? 1 : level <= 1 ? 1 : 2,
    status: isLegal && a['skip-legal'] !== false ? 'skip' : 'planned',
    source_h1: p.name || '',
    source_queries: (p.queries || []).map(q => q.query || q).filter(Boolean).slice(0, 5),
    notes: [p.role, p.client_notes, p.section].filter(Boolean).join(' | ').slice(0, 300),
  });
}
const sitemap = { source: src, generated_at: nowIso(), page_types: TYPE_ENUM, pages };
const errors = validate(loadSchema('sitemap'), sitemap);
if (errors.length) { console.error('sitemap не прошел схему:'); errors.slice(0, 20).forEach(e => console.error(' - ' + e)); process.exit(1); }
writeJson(P('work', 'sitemap.json'), sitemap);
writeJson(P('work', 'sitemap.skipped.json'), skipped);
const byType = {};
for (const p of pages) byType[p.type] = (byType[p.type] || 0) + 1;
console.log(`страниц: ${pages.length}, пропущено: ${skipped.length}`);
console.log('по типам:', JSON.stringify(byType));
console.log(`skip (юридические/служебные): ${pages.filter(p => p.status === 'skip').map(p => p.url).join(', ') || 'нет'}`);
