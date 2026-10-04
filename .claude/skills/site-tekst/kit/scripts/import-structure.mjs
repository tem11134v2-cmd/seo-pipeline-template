// Импорт готовой структуры сайта в work/sitemap.json.
// node scripts/import-structure.mjs [--src inputs/structure_data.json]
// Поддерживаемый формат источника: {pages:[{n,url,type,name,section,target_status,marker,queries[],status,role,client_notes}]}
// (формат seo-struktura). Для других форматов карту пишет резервный агент по schemas/sitemap.schema.json.
// Адрес страницы приводится к пути один раз на входе: без схемы и хоста, без ?query и #якоря, без слеша на конце,
// пустой - «/» (одно правило с urlPath в import-project.mjs); от него считаются slug, level, parent и главная. Хост,
// отличный от config.site_url, - предупреждение. Две строки с одним путем - в карту идет первая, вторая - в
// sitemap.skipped.json с причиной.
// Юридические страницы (политика, согласие на обработку, оферта, cookie) - status skip и ui_role legal; служебные
// (избранное, сравнение) - status skip без ui_role. Тип из колонки структуры важнее шаблонного адреса ({slug}, [id],
// -slug): шаблон - пометка template, product - только при пустой колонке типа или «Товар». listing - у category, если
// бизнес не услуги (config.niche.business_type). Волн карта не содержит (их считает scripts/progress.mjs).
// Ключевая фраза страницы (K5): маркер структуры (живая фраза клиента с регионом; у /seo-struktura - маркерный запрос)
// идет первым в source_queries и в key_phrase (нет маркера - первый запрос); subject - по-прежнему name (пункт меню).
//
// Сверка прохода обогатителя в режиме mode=facts (K4, режим обновления стратегии wf-04; формы вызова и коды берет wf-04:
// константы ENRICH_SAVE, ENRICH_CHECK, ENRICH_ROLLBACK, ENRICH_NO_COPY):
//   node scripts/import-structure.mjs --check-enrich before - до прохода: копия карты в work/sitemap.pre-enrich.json;
//   node scripts/import-structure.mjs --check-enrich after  - после прохода: карта сверяется с копией: список и порядок
//     страниц, все поля страниц, кроме facts_available, fact_coverage и block_set, и поля карты (кроме generated_at) не
//     изменились, карта проходит схему. Синонимы: --check-enrich --save = before, голый --check-enrich = after.
// Коды выхода режима (одно место): 0 - копия снята или сверка прошла (копия удалена); 3 - изменилось лишнее: карта уже
// возвращена из копии, в stdout строки « - откат: ...» (это не ошибка фазы); 2 - нет карты или копии (before не
// запускался) или неизвестный шаг; прочий ненулевой код (1 - падение node) - сверка не выполнена, откатом не считается.
import fs from 'node:fs';
import { argv, P, readJson, writeJson, exists, nowIso, loadConfig, validate, loadSchema } from './lib.mjs';

const RAW = process.argv.slice(2);

// ---------------------------------------------------------------- --check-enrich (сверка обогатителя mode=facts)
if (RAW.includes('--check-enrich')) {
  const ENRICH_FIELDS = ['facts_available', 'fact_coverage', 'block_set'];
  const map = P('work', 'sitemap.json'), copy = P('work', 'sitemap.pre-enrich.json');
  const next = RAW[RAW.indexOf('--check-enrich') + 1];
  const step = next === 'before' || RAW.includes('--save') ? 'before' : next === 'after' || next === undefined ? 'after' : '';
  const canon = v => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map(key => [key, x[key]])) : x));
  if (step === 'before') {
    if (!exists(map)) { console.error('нет work/sitemap.json: сверять нечего'); process.exit(2); }
    fs.copyFileSync(map, copy);
    let n = 0;
    try { n = (readJson(copy).pages || []).length; } catch { n = 0; }
    console.log(`копия карты для сверки обогатителя: work/sitemap.pre-enrich.json (${n} страниц)`);
    process.exit(0);
  }
  if (step !== 'after') { console.error(`--check-enrich: неизвестный шаг «${next}» - before (до прохода обогатителя) или after (после)`); process.exit(2); }
  if (!exists(copy)) { console.error('нет копии work/sitemap.pre-enrich.json: сначала --check-enrich before'); process.exit(2); }
  const before = readJson(copy);
  const problems = [];
  let after = null;
  try { after = readJson(map); } catch (e) { problems.push(`work/sitemap.json не читается: ${e.message}`); }
  const changedPages = [];
  if (after) {
    for (const e of validate(loadSchema('sitemap'), after).slice(0, 10)) problems.push(`схема: ${e}`);
    for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (k !== 'pages' && k !== 'generated_at' && canon(before[k]) !== canon(after[k])) problems.push(`поле карты ${k} изменено`);
    }
    const bs = (before.pages || []).map(x => x.slug), as = (after.pages || []).map(x => x.slug);
    if (bs.join('\n') !== as.join('\n')) {
      const lost = bs.filter(s => !as.includes(s)), added = as.filter(s => !bs.includes(s));
      problems.push(`список страниц изменился: было ${bs.length}, стало ${as.length}${lost.length ? `; пропали: ${lost.join(', ')}` : ''}${added.length ? `; новые: ${added.join(', ')}` : ''}${!lost.length && !added.length ? '; другой порядок' : ''}`);
    } else {
      (before.pages || []).forEach((x, i) => {
        const y = after.pages[i];
        const keys = [...new Set([...Object.keys(x), ...Object.keys(y)])];
        for (const k of keys) if (!ENRICH_FIELDS.includes(k) && canon(x[k]) !== canon(y[k])) problems.push(`${x.slug}: поле ${k} изменено`);
        if (ENRICH_FIELDS.some(k => canon(x[k]) !== canon(y[k]))) changedPages.push(x.slug);
      });
    }
  }
  if (problems.length) {
    fs.copyFileSync(copy, map);
    fs.rmSync(copy, { force: true });
    console.log(`откат: обогатитель (mode=facts) изменил не только ${ENRICH_FIELDS.join(', ')} - карта возвращена из копии`);
    for (const p of problems.slice(0, 30)) console.log(` - откат: ${p}`);
    if (problems.length > 30) console.log(` - откат: и еще ${problems.length - 30}`);
    process.exit(3);
  }
  // ссылки на факты, которых нет среди публикуемых, - предупреждение (карту не откатывает: их снимет сборка брифов)
  if (exists(P('work', 'facts.json'))) {
    let pub = null;
    try { pub = new Set((readJson(P('work', 'facts.json')).facts || []).filter(f => f.publish === 'yes').map(f => f.id)); } catch { pub = null; }
    if (pub) for (const x of after.pages) {
      const bad = (x.facts_available || []).filter(id => !pub.has(id));
      if (bad.length) console.log(` ! ${x.slug}: facts_available с фактами не из публикуемых: ${bad.join(', ')}`);
    }
  }
  fs.rmSync(copy, { force: true });
  console.log(`сверка обогатителя (mode=facts): изменены только ${ENRICH_FIELDS.join(', ')}; страниц с изменениями ${changedPages.length}${changedPages.length ? ` (${changedPages.join(', ')})` : ''}`);
  process.exit(0);
}

const a = argv({});
const cfg = loadConfig();
const src = a.src || cfg.sources?.structure_source || 'inputs/structure_data.json';
if (!exists(src)) { console.error(`нет файла структуры: ${src}`); process.exit(2); }
const data = readJson(src);
const pagesIn = data.pages || [];
const warnings = [];

const TYPE_ENUM = ['home', 'hub', 'category', 'service', 'product', 'info_about', 'info_contacts', 'info_team', 'info_reviews', 'info_cases', 'info_faq', 'info_other'];
// юридические: адрес или название; голое «personal» (кабинет) не ловится
const LEGAL_URL = /privacy|policy|politika|konfidenc|terms|agreement|soglashenie|soglasie-na|oferta|cookie|personal-?data|personalnyh-dannyh|obrabotk[a-z-]*-dannyh/i;
const LEGAL_NAME = /политик[а-я]* конфиденц|персональн[а-я]* данн|согласи[еяю] на обработ|пользовательск[а-я]* соглашени|публичн[а-я]* оферт|(^|[^а-я])оферт|cookie|куки/i;
// служебные страницы интерфейса: без текста, в меню и подвал не идут
const SERVICE_URL = /favorites|izbrannoe|compare|sravnenie/i;
const TEMPLATE_URL = /\{[^}]*\}|\[[^\]]*\]|-slug(?![a-z0-9])|(^|\/)slug$/i;

let host = '';
try { host = new URL(cfg.site_url).hostname.replace(/^www\./, ''); } catch { host = ''; }
function urlPath(u) {
  let s = String(u || '').trim();
  const m = s.match(/^https?:\/\/([^/?#]+)/i);
  if (m) {
    const h = m[1].toLowerCase().replace(/^www\./, '').replace(/:\d+$/, '');
    if (host && h !== host) warnings.push(`адрес ${s}: хост ${h} не совпадает с сайтом проекта ${host}`);
    s = s.slice(m[0].length);
  }
  s = s.replace(/[?#].*$/, '');
  if (!s.startsWith('/')) s = '/' + s;
  return s.length > 1 ? (s.replace(/\/+$/, '') || '/') : '/';
}

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
function mapType(p, url, isTemplate) {
  const t = String(p.type || '').toLowerCase();
  const role = String(p.role || '').toLowerCase();
  const name = String(p.name || '').toLowerCase();
  if (t.includes('главн') || url === '/' || /^\/[a-z]{2}$/.test(url)) return 'home';
  if (t.includes('статья') || t.includes('блог')) return null;
  if (isTemplate && (!t || t.includes('товар'))) return 'product';
  if (/\(хаб\)|(^|\s)хаб(\s|$)/.test(name)) return 'hub';
  if (t.includes('услуг')) return 'service';
  if (t.includes('товар')) return 'product';
  if (t.includes('инфо')) return infoType(url, p.name || '');
  if (t.includes('прочее')) return 'info_other';
  if (t.includes('категор')) return (role.includes('навигац') || role.includes('обзор')) ? 'hub' : 'category';
  return 'category';
}
function slugOf(url) {
  return url.replace(/^\/+|\/+$/g, '').replace(/[{}<>[\]]/g, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'home';
}
const rows = pagesIn.map(p => ({ p, url: urlPath(p.url) }));
const urls = new Set(rows.map(r => r.url));
function parentOf(url) {
  const parts = url.split('/');
  while (parts.length > 2) { parts.pop(); const cand = parts.join('/'); if (urls.has(cand)) return cand; }
  return '';
}
const services = (cfg.niche && cfg.niche.business_type) === 'services';

const pages = [];
const skipped = [];
const taken = new Set();
for (const { p, url } of rows) {
  const yes = String(p.target_status || p.target_raw || '').toLowerCase();
  if (yes && !/^(yes|да|целев)/.test(yes)) { skipped.push({ url, reason: `target_status=${p.target_status}` }); continue; }
  // «https://x.ru/uslugi/» и «/uslugi» - одна страница: в карту идет первая строка, повтор - в пропущенные
  if (taken.has(url)) { skipped.push({ url, reason: `повтор адреса после приведения к пути: ${p.url}` }); continue; }
  taken.add(url);
  const isTemplate = TEMPLATE_URL.test(url) || /шаблон/i.test(String(p.name || ''));
  const type = mapType(p, url, isTemplate);
  if (!type) { skipped.push({ url, reason: 'статья/блог' }); continue; }
  const isLegal = LEGAL_URL.test(url) || LEGAL_NAME.test(String(p.name || ''));
  const isService = !isLegal && SERVICE_URL.test(url);
  const level = Math.max(0, url.split('/').length - 2);
  const notes = [p.role, p.client_notes, p.section, isService ? 'служебная страница интерфейса' : ''].filter(Boolean).join(' | ').slice(0, 300);
  // маркер - первым в запросах и ключевой фразой (без повторов без учета регистра)
  const marker = String(p.marker || '').trim();
  const queries = [];
  for (const q of [marker, ...(p.queries || []).map(x => String((x && x.query) || x || '').trim())]) {
    if (q && !queries.some(x => x.toLowerCase() === q.toLowerCase())) queries.push(q);
  }
  const keyPhrase = queries[0] || '';
  pages.push({
    slug: slugOf(url),
    url,
    type,
    subject: p.name || p.marker || url,
    parent: parentOf(url),
    level,
    geo: '',
    segment: '',
    facts_available: [],
    fact_coverage: 0,
    block_set: 'full',
    listing: type === 'category' && !services,
    ...(isTemplate ? { template: true } : {}),
    ...(isLegal ? { ui_role: 'legal' } : {}),
    status: isLegal || isService ? 'skip' : 'planned',
    source_h1: p.name || '',
    source_queries: queries.slice(0, 5),
    ...(keyPhrase.length >= 2 ? { key_phrase: keyPhrase } : {}),
    notes,
  });
}
const dup = pages.map(p => p.slug).filter((s, i, arr) => arr.indexOf(s) !== i);
if (dup.length) warnings.push(`повтор slug после приведения адресов: ${[...new Set(dup)].join(', ')}`);
const sitemap = { source: src, generated_at: nowIso(), page_types: TYPE_ENUM, pages };
const errors = validate(loadSchema('sitemap'), sitemap);
if (errors.length) { console.error('sitemap не прошел схему:'); errors.slice(0, 20).forEach(e => console.error(' - ' + e)); process.exit(1); }
writeJson(P('work', 'sitemap.json'), sitemap);
writeJson(P('work', 'sitemap.skipped.json'), skipped);
const byType = {};
for (const p of pages) byType[p.type] = (byType[p.type] || 0) + 1;
console.log(`страниц: ${pages.length}, пропущено: ${skipped.length}`);
console.log('по типам:', JSON.stringify(byType));
console.log(`skip юридические (ui_role legal): ${pages.filter(p => p.ui_role === 'legal').map(p => p.url).join(', ') || 'нет'}; служебные: ${pages.filter(p => p.status === 'skip' && !p.ui_role).map(p => p.url).join(', ') || 'нет'}`);
const tpl = pages.filter(p => p.template);
if (tpl.length) console.log(`страницы-шаблоны: ${tpl.map(p => `${p.url} (${p.type})`).join(', ')}`);
for (const w of [...new Set(warnings)]) console.log(` ! ${w}`);
