// Проверка прототипа-сайта. node scripts/check-html.mjs [--file work/output/prototype.html]
// Отчет work/audit/html-check.json (findings). Код выхода: 0 - pass, 1 - есть major или minor, 2 - есть blocker.
// Проверяет: дословность каждого написанного блока (эталон prototype.index.json; неразрывные пробелы, теги, чипы
// «нужны данные» -> [[исходник]] из data-ph), один h1 на маршрут, нет [[ и чипов в h1, меню и кнопках, у демо-данных
// есть пометка, только серые цвета (CSS, style, fill/stroke в SVG), внешние ресурсы и картинки только встроенные
// (data:), каждое встроенное фото один раз, внешние ссылки только из данных проекта (каналы, ссылки писателя, сайт)
// и словаря (карта), мертвые кнопки, существование маршрутов и якорей, «прототип старше данных» (строка в консоли),
// размер файла. Ненаписанный блок (нет файла или lint не pass) - major html.block-missing. Меню (html.menu, major):
// каждая рабочая страница, кроме главной, страниц с ui_role, шаблонов и товаров, - ссылкой в меню компьютера (строка
// меню и выпадающие панели) и в мобильном меню. Кнопка-ссылка <a data-act> без href не получает фокус с клавиатуры
// (html.a11y-focus, major). Чипы filters писателя без фильтра каталога или со значениями не из фильтра - надписи, а не
// кнопки (html.chip-dead, minor).
// Оболочка по пересечениям лидеров (программа 05.10): заглушки brief.stubs (секции data-stub="1" без data-block-id) не
// сверяются на дословность, их якоря валидны; чип «нужны данные» (span.ph-need) - не в меню, h1 и кнопках (major
// html.placeholder-ui), с data-kf; элемент prototype.modules.json shell в состоянии chip - с чипом на сайте, declined -
// без следа в файле (html.shell-chip, minor; html.shell-declined, major).
import path from 'node:path';
import crypto from 'node:crypto';
import { argv, P, readText, readJson, exists, writeJson, loadSitemap, pageDir, makeFindings, addFinding, finalizeVerdict } from './lib.mjs';
import { protoDataSha, loadUi } from './render-blocks.mjs';
import { buildSite } from './site-parts.mjs';

const a = argv({});
const file = a.file ? path.resolve(a.file) : P('work', 'output', 'prototype.html');
const report = makeFindings('prototype', 'html-check');
const F = (sev, rule, problem, page, block_id, quote) => addFinding(report, { severity: sev, category: 'format', rule, problem, page, block_id, quote: String(quote || '').slice(0, 160) });
const once = new Set();
const F1 = (key, ...args) => { if (once.has(key)) return; once.add(key); F(...args); };
const attr = (s, n) => { const m = String(s).match(new RegExp(`\\b${n}="([^"]*)"`)); return m ? m[1] : ''; };
const decode = s => String(s).replace(/&nbsp;/g, ' ').replace(/ /g, ' ').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const INLINE = /<\/?(?:a|b|i|em|strong|span|small|u|s|sup|sub|abbr|label)\b[^>]*>/gi;
const stripDbg = s => s.replace(/<aside class="dbg-[a-z]+"[\s\S]*?<\/aside>/g, ' ');
const restorePh = s => s.replace(/<mark class="ph" data-ph="([^"]*)"[^>]*>[\s\S]*?<\/mark>/g, (m, x) => `[[${decode(x)}]]`);
const toText = s => decode(stripDbg(s).replace(/<svg\b[\s\S]*?<\/svg>/g, ' ').replace(INLINE, '').replace(/<[^>]+>/g, ' '));
const norm = s => String(s).replace(/\s+/g, ' ').replace(/\s+([.,;:!?)\]»])/g, '$1').replace(/([(\[«])\s+/g, '$1').trim();
const expectedLine = l => norm(String(l).replace(/\*\*/g, '').replace(/\[([^[\]]+)\]\(([^()\s]*)\)/g, '$1').replace(/ /g, ' '));
const hostOf = u => { try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } };
const isGrey = (r, g, b) => Math.abs(r - g) <= 6 && Math.abs(g - b) <= 6 && Math.abs(r - b) <= 6;
function colorProblems(css) {
  const out = [];
  const s = css.replace(/url\(\s*["']?data:[^)]*\)/gi, 'url()');
  for (const c of s.matchAll(/#([0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\b/gi)) {
    let h = c[1];
    if (h.length <= 4) h = h.slice(0, 3).split('').map(x => x + x).join('');
    const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
    if (!isGrey(r, g, b)) out.push(`#${c[1]}`);
  }
  for (const c of s.matchAll(/rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/gi)) if (!isGrey(+c[1], +c[2], +c[3])) out.push(c[0]);
  for (const c of s.matchAll(/hsla?\(\s*[\d.]+(?:deg)?[\s,]+([\d.]+)%/gi)) if (+c[1] > 3) out.push(c[0]);
  return out;
}

let exitCode = 0;
if (!exists(file)) F('blocker', 'html.missing', `нет файла ${file}`);
else {
  const html = readText(file);
  const idxFile = file.replace(/\.html$/, '.index.json');
  const idx = exists(idxFile) ? readJson(idxFile) : {};
  const ui = loadUi();
  // разметка без скриптов (данные и код страницы проверяются отдельно)
  const markup = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '<script></script>');
  const left = [...markup.matchAll(/\{\{(\w+)\}\}/g)].map(m => m[1]);
  if (left.length) F('blocker', 'html.shell', `остались подстановки оболочки: ${[...new Set(left)].join(', ')}`);

  // страницы (маршруты)
  const main = (markup.match(/<main\b[^>]*>([\s\S]*)<\/main>/) || [])[1] || '';
  const starts = [...main.matchAll(/<div class="page"([^>]*)>/g)];
  const pages = starts.map((m, i) => ({ route: attr(m[1], 'data-route'), slug: attr(m[1], 'data-slug'), body: main.slice(m.index, i + 1 < starts.length ? starts[i + 1].index : main.length) }));
  const routes = new Set(pages.map(p => p.route));
  const sm = loadSitemap();
  const working = (sm.pages || []).filter(p => p && p.slug && p.status !== 'skip');
  for (const s of Object.keys(idx)) if (!pages.find(p => p.slug === s)) F('blocker', 'html.page-missing', `страницы ${s} нет в прототипе`, s);
  for (const p of working) if (!pages.find(x => x.slug === p.slug)) F('major', 'html.page-missing', `рабочей страницы карты нет среди маршрутов прототипа`, p.slug);
  let written = 0, missing = 0;
  for (const pg of pages) {
    const slug = pg.slug || pg.route;
    const h1s = (pg.body.match(/<h1\b/g) || []).length;
    const heroWritten = /<section\b[^>]*data-role="hero"(?![^>]*data-missing)[^>]*>/.test(pg.body);
    if (h1s !== 1) F(heroWritten ? 'blocker' : 'major', 'html.h1', `на маршруте ${pg.route} ${h1s} h1`, slug);
    for (const h of pg.body.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/g)) if (/\[\[|class="ph(?:-need)?"/.test(h[1])) F('major', 'html.placeholder-ui', 'плейсхолдер в h1', slug, '', toText(h[1]));
    // блоки
    for (const sec of pg.body.matchAll(/<section\b([^>]*)>([\s\S]*?)<\/section>/g)) {
      const id = attr(sec[1], 'data-block-id');
      if (!id) continue;
      if (/data-missing="1"/.test(sec[1])) {
        missing++;
        const why = attr(sec[1], 'data-missing-reason') === 'lint' ? 'блок не прошел линтер (в прототипе скелет)' : 'блок не написан';
        F('major', 'html.block-missing', why, pg.slug, id);
        continue;
      }
      written++;
      const expRaw = (idx[pg.slug] || {})[id] || '';
      if (!expRaw) { F('blocker', 'html.index', 'нет эталонного текста блока в index.json', pg.slug, id); continue; }
      const got = norm(toText(restorePh(sec[2])));
      for (const line of expRaw.split('\n').map(x => x.trim()).filter(Boolean)) {
        const l = expectedLine(line);
        if (l && !got.includes(l)) F('blocker', 'html.text-mismatch', 'текст блока в HTML отличается от JSON', pg.slug, id, l);
      }
    }
    // якоря кнопок страницы
    for (const m of pg.body.matchAll(/<(?:a|button)\b([^>]*\bdata-act="scroll"[^>]*)>/g)) {
      const tg = attr(m[1], 'data-target');
      if (!tg || !new RegExp(`data-anchor="${tg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`).test(pg.body)) F1(`anchor:${slug}:${tg}`, 'major', 'html.anchor', `кнопка ведет к блоку «${tg}», которого нет на странице`, slug);
    }
    // чипы filters писателя, не совпавшие ни со значением, ни с именем, ни с подписью фильтра панели (K6), и чипы со
    // значениями, которых нет у фильтра страницы, в том числе описание после двоеточия у фильтра со значениями (п.19) - надписи
    const dead = [...pg.body.matchAll(/<span class="qchip">([\s\S]*?)<\/span>/g)].map(m => norm(toText(m[1]))).filter(Boolean);
    if (dead.length) F('minor', 'html.chip-dead', `чипов фильтров без фильтра каталога или со значениями не из фильтра: ${dead.length} (выводятся надписью, не кнопкой; признак другими словами - в labels фильтра catalog-spec, значения не из фильтра - вопрос в ТЗ, описание после двоеточия - правка чипа)`, slug, '', dead.join(' | '));
  }
  // сырые плейсхолдеры в видимом тексте
  const visible = toText(main.replace(/<mark class="ph"[\s\S]*?<\/mark>/g, ' '));
  if (/\[\[/.test(visible)) F('major', 'html.raw-placeholder', 'в видимом тексте есть [[ без чипа «нужны данные»', '', '', (visible.match(/.{0,40}\[\[.{0,60}/) || [''])[0]);
  // плейсхолдеры в меню и кнопках
  const navHtml = (markup.match(/<nav class="nav"[\s\S]*?<\/nav>/) || [''])[0];
  if (/\[\[|class="ph(?:-need)?"/.test(navHtml)) F('major', 'html.placeholder-ui', 'плейсхолдер в меню');
  // меню: каждая рабочая страница достижима из меню компьютера (строка и выпадающие панели; при выключенных панелях -
  // только мобильное) и из мобильного меню. Не проверяются: главная, ui_role, шаблоны, товары; лендинг и site.off menu
  let cfgDoc = {};
  try { cfgDoc = readJson(P('config', 'project.json')) || {}; } catch { cfgDoc = {}; }
  // модель сайта - та же, что у сборщика (родители, ui_role, шаблоны, лендинг, выключенные модули)
  let model = null;
  try { model = buildSite({ cfg: cfgDoc, sm, facts: exists(P('work', 'facts.json')) ? readJson(P('work', 'facts.json')) : {}, strategy: null, briefs: {}, ui, contacts: null, catalogSpec: null, samples: null }); } catch { model = null; }
  if (model && !model.off.has('menu') && !model.landing) {
    const mnavHtml = (markup.match(/<div class="mnav" id="mnav"[\s\S]*?<div class="mnav-contacts">/) || [''])[0];
    const hrefs = s => new Set([...s.matchAll(/href="#(\/[^"?]*)/g)].map(m => decode(m[1]).replace(/\/+$/, '') || '/'));
    const inDesk = hrefs(navHtml), inMob = hrefs(mnavHtml);
    // страница и все ее предки - без ui_role и не шаблоны (дети кабинета или шаблона ищутся там, а не в меню)
    const reachable = x => { for (let p = x; p; p = p.parent) if (!model.navOk(p)) return false; return true; };
    const need = model.pages.filter(x => x !== model.home && x.type !== 'product' && reachable(x))
      .map(x => ({ slug: x.slug, route: (pages.find(y => y.slug === x.slug) || {}).route })).filter(x => x.route);
    const offMods = model.off;
    const miss = (list, where) => { if (list.length) F('major', 'html.menu', `рабочих страниц нет в ${where}: ${list.length} - заказчик не найдет их по меню`, '', '', list.map(x => x.slug).join(', ')); };
    if (!offMods.has('mega')) miss(need.filter(x => !inDesk.has(x.route)), 'меню компьютера (строка меню и выпадающие панели)');
    miss(need.filter(x => !inMob.has(x.route)), 'мобильном меню');
  }
  for (const m of markup.matchAll(/<(a|button)\b([^>]*\bclass="[^"]*\bbtn\b[^"]*"[^>]*)>([\s\S]*?)<\/\1>/g)) if (/\[\[|class="ph(?:-need)?"/.test(m[3])) F1(`btn:${m[3]}`, 'major', 'html.placeholder-ui', 'плейсхолдер в кнопке', '', '', toText(m[3]));
  // оболочка по пересечениям лидеров и заглушки (проверки срабатывают, только если они есть в файле)
  const noKf = [...markup.matchAll(/<span\b[^>]*\bclass="ph-need"[^>]*>/g)].filter(m => !/\bdata-kf="[^"]+"/.test(m[0])).length;
  if (noKf) F('minor', 'html.shell-chip', `чипов «нужны данные» без data-kf: ${noKf} - отчет и таблица КФ не свяжут их с элементом лидеров`);
  let shellMod = null;
  try { const mf = file.replace(/\.html$/, '.modules.json'); shellMod = exists(mf) ? (readJson(mf).shell || null) : null; } catch { shellMod = null; }
  if (shellMod && Array.isArray(shellMod.items)) {
    // чипы заглушек тела страниц - не оболочка (их id может совпасть с id элемента оболочки)
    const outside = markup.replace(/<section\b[^>]*\bdata-stub="1"[\s\S]*?<\/section>/g, ' ');
    const kfIds = new Set([...outside.matchAll(/\bdata-kf="([^"]*)"/g)].map(m => decode(m[1])));
    const lost = shellMod.items.filter(i => i && i.state === 'chip' && !kfIds.has(String(i.id))).map(i => i.id);
    if (lost.length) F('minor', 'html.shell-chip', `элементов оболочки в состоянии chip без чипа на сайте: ${lost.length}`, '', '', lost.join(', '));
    const leaked = shellMod.items.filter(i => i && i.state === 'declined' && kfIds.has(String(i.id))).map(i => i.id);
    if (leaked.length) F('major', 'html.shell-declined', `элементы, снятые заказчиком, есть на сайте: ${leaked.length}`, '', '', leaked.join(', '));
  }
  // демо-данные с пометкой
  for (const m of markup.matchAll(/data-demo="1"/g)) {
    const near = markup.slice(m.index, m.index + 800);
    if (!/class="demo-mark"/.test(near)) F1(`demo:${m.index}`, 'major', 'html.demo', 'демо-данные без пометки «пример»', '', '', toText(near).slice(0, 100));
  }
  // цвета: только серые
  const styles = [...markup.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n');
  const inline = [...markup.matchAll(/\bstyle="([^"]*)"/g)].map(m => m[1]).join('\n');
  const svgAttrs = [...markup.matchAll(/\b(?:fill|stroke|stop-color|color)="([^"]*)"/g)].map(m => m[1]).join('\n');
  for (const c of [...new Set(colorProblems(`${styles}\n${inline}\n${svgAttrs}`))]) F('major', 'html.color', `не серый цвет ${c}`);
  // внешние ресурсы и картинки
  if (/<script\b[^>]*\bsrc="(?:https?:)?\/\//i.test(markup) || /<link\b(?![^>]*rel="icon")[^>]*\bhref="(?:https?:)?\/\//i.test(markup)) F('blocker', 'html.external', 'внешний скрипт или стиль');
  for (const m of markup.matchAll(/<img\b[^>]*\bsrc="([^"]*)"/gi)) {
    if (/^data:image\//i.test(m[1])) continue;
    if (/^(?:https?:)?\/\//i.test(m[1])) F1(`img:${m[1]}`, 'blocker', 'html.external', 'внешняя картинка: фото встраиваются в файл', '', '', m[1]);
    else F1(`img:${m[1]}`, 'major', 'html.img-path', 'картинка по пути, а не встроенная: у заказчика ее не будет', '', '', m[1]);
  }
  for (const m of styles.matchAll(/url\(\s*["']?([^)"']*)/gi)) {
    if (/^data:/i.test(m[1]) || !m[1]) continue;
    if (/^(?:https?:)?\/\//i.test(m[1])) F1(`url:${m[1]}`, 'blocker', 'html.external', 'внешний ресурс в CSS', '', '', m[1]);
    else F1(`url:${m[1]}`, 'major', 'html.img-path', 'путь к файлу в CSS: у заказчика его не будет', '', '', m[1]);
  }
  const imgs = {};
  for (const m of html.matchAll(/data:image\/(?:jpeg|png|webp|gif);base64,([A-Za-z0-9+/=]+)/g)) { const k = crypto.createHash('sha1').update(m[1]).digest('hex'); imgs[k] = (imgs[k] || 0) + 1; }
  const dups = Object.values(imgs).filter(n => n > 1).length;
  if (dups) F('major', 'html.img-dup', `встроенных фото, повторенных в файле: ${dups} (фото встраивается один раз)`);
  // внешние ссылки: только из данных проекта и словаря
  const allowed = new Set();
  if (ui.maps && ui.maps.host) allowed.add(String(ui.maps.host).toLowerCase());
  if (ui.maps && ui.maps.url) allowed.add(hostOf(ui.maps.url));
  try { const cfg = readJson(P('config', 'project.json')); const h = hostOf(/^https?:/i.test(cfg.site_url || '') ? cfg.site_url : `https://${cfg.site_url || ''}`); if (h) allowed.add(h); } catch { /* нет конфига */ }
  const factsDoc = exists(P('work', 'facts.json')) ? readJson(P('work', 'facts.json')) : {};
  const urlsIn = s => String(s || '').match(/https?:\/\/[^\s"'<>)]+/g) || [];
  for (const u of urlsIn(JSON.stringify((factsDoc && factsDoc.company) || {}))) allowed.add(hostOf(u));
  try {
    const contacts = await import(new URL('./contacts.mjs', import.meta.url).href);
    if (contacts.buildChannels) for (const c of Object.values(contacts.buildChannels((factsDoc && factsDoc.facts) || [], (factsDoc && factsDoc.company) || {}) || {})) if (c && c.href) allowed.add(hostOf(c.href));
  } catch { /* contacts.mjs нет - каналы только из company */ }
  for (const p of working) {
    const bdir = path.join(pageDir(p.slug), 'blocks');
    if (!exists(path.join(pageDir(p.slug), 'brief.json'))) continue;
    let brief; try { brief = readJson(path.join(pageDir(p.slug), 'brief.json')); } catch { continue; }
    for (const b of brief.blocks || []) {
      const f = path.join(bdir, `${b.block_id}.json`);
      if (!exists(f)) continue;
      try { const s = JSON.stringify(readJson(f).elements || []); for (const u of urlsIn(s)) allowed.add(hostOf(u)); } catch { /* блок не читается */ }
    }
  }
  for (const m of markup.matchAll(/<a\b[^>]*\bhref="(https?:\/\/[^"]+)"/gi)) {
    const h = hostOf(decode(m[1]));
    if (h && !allowed.has(h)) F1(`ext:${h}`, 'major', 'html.link-external', `внешняя ссылка не из данных проекта: ${h}`, '', '', m[1]);
  }
  // мертвые кнопки и ссылки, существование маршрутов
  const body = (markup.match(/<body\b[^>]*>([\s\S]*)<\/body>/) || [])[1] || markup;
  const noFocus = [];
  for (const m of body.matchAll(/<(a|button)\b([^>]*)>([\s\S]*?)<\/\1>/g)) {
    const at = m[2];
    const act = attr(at, 'data-act');
    const href = attr(at, 'href');
    const label = toText(m[3]).trim().slice(0, 60) || attr(at, 'aria-label');
    if (m[1] === 'a') {
      if (!act && (!href || href === '#')) F1(`dead:${label}`, 'major', 'html.dead', 'ссылка без действия', '', '', label);
      // <a> без href не получает фокус с клавиатуры: кнопка-ссылка - href="#" role="button" (сборщик: btnAttrs)
      if (act && !/\bhref="/.test(at)) noFocus.push(label);
      if (href.startsWith('#/')) { const r = decode(href).slice(1).split('?')[0].replace(/\/+$/, '') || '/'; if (!routes.has(r)) F1(`route:${r}`, 'major', 'html.route', `ссылка на несуществующий маршрут ${r}`, '', '', label); }
    } else if (!act && attr(at, 'type') !== 'submit') F1(`deadb:${label}`, 'major', 'html.dead', 'кнопка без действия', '', '', label);
  }
  if (noFocus.length) F('major', 'html.a11y-focus', `кнопок-ссылок без href: ${noFocus.length} - не получают фокус с клавиатуры (нужны href="#" и role="button" или button)`, '', '', [...new Set(noFocus)].slice(0, 8).join(' | '));
  // «прототип старше данных» - по sha входных данных, записанному сборщиком
  const shaMeta = (html.match(/<meta name="proto-data-sha" content="([^"]*)"/) || [])[1] || '';
  const shaNow = protoDataSha();
  const stale = !!shaMeta && shaMeta !== shaNow;
  const kb = Buffer.byteLength(html) / 1024;
  if (kb > 5 * 1024) F('minor', 'html.size', `файл ${kb.toFixed(0)} КБ: тяжело открывать на телефоне`);
  report.scores = { pages: pages.filter(p => p.slug).length, expected_pages: working.length, routes: routes.size, blocks_written: written, blocks_missing: missing, size_kb: Math.round(kb), stale };
  // заглушки элементов лидеров (brief.stubs): счетчик - только если они есть
  const stubsN = (main.match(/<section\b[^>]*\bdata-stub="1"/g) || []).length;
  if (stubsN) report.scores.stubs = stubsN;
  if (stale) console.log('check-html: прототип старше данных (брифы, блоки, линтер, каталог или карта изменились после сборки) - пересоберите build-html');
}
finalizeVerdict(report);
writeJson(P('work', 'audit', 'html-check.json'), report);
const sev = report.findings.map(f => f.severity);
exitCode = sev.includes('blocker') ? 2 : sev.length ? 1 : 0;
console.log(`check-html: ${report.verdict} (${report.summary}) страниц ${report.scores?.pages ?? 0}, код ${exitCode}`);
// в выводе - сначала тяжелые (blocker, major, minor; внутри - по порядку добавления): хвост вывода читает оркестратор,
// общие major (меню, фокус) не должны теряться за десятками minor по страницам; html-check.json - полный, как был
const RANK = { blocker: 0, major: 1, minor: 2 };
[...report.findings].sort((a, b) => (RANK[a.severity] ?? 3) - (RANK[b.severity] ?? 3)).slice(0, 40).forEach(f => console.log(` - [${f.severity}] ${f.rule} ${f.page || ''}/${f.block_id || ''}: ${f.problem}${f.quote ? ` | «${f.quote.slice(0, 80)}»` : ''}`));
process.exit(exitCode);
