// Движок блоков прототипа-сайта. Тексты писателя - дословно (сверяет check-html по prototype.index.json).
// Любой блок отрисовывается: раскладка типа (work/layouts/<type>.html) -> раскладка по умолчанию для pattern ->
// секция по элементам (pattern custom и незнакомый pattern); незнакомый вид элемента - его text/title/label.
// Здесь же: статус блока (написан = файл блока + lint pass), скелет ненаписанного блока по той же карте pattern,
// типографика (неразрывные пробелы из словаря), пометки [[...]] -> серый чип с исходником в data-ph, автоссылки
// только на телефоны и почту компании, подсветка утверждений о компании без опоры (служебный слой) и sha входных данных.
// Кириллицы в литералах нет: подписи - из html/site/ui.json (ui.t), языковые списки - ui.lang (тест cases-site).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { P, exists, readJson, readText, listFiles, escapeHtml, splitSentences, isListing } from './lib.mjs';
import { blockState as progressBlockState } from './progress.mjs';

export const esc = escapeHtml;
const reEsc = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const icon = (n, cls = 'ico') => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><use href="#i-${n}"></use></svg>`;

// ---------------------------------------------------------------- словарь интерфейса
export function loadUi(file = P('html', 'site', 'ui.json')) {
  const d = exists(file) ? readJson(file) : {};
  const ui = d.ui || {};
  const t = k => (ui[k] != null ? String(ui[k]) : String(k));
  const op = (k, vars = {}) => String((d.ops || {})[k] ?? k).replace(/\{(\w+)\}/g, (m, v) => (v in vars ? String(vars[v]) : m));
  return { ...d, ui, t, op, lang: d.lang || {}, maps: d.maps || {}, type_groups: d.type_groups || {}, contract: d.contract || [] };
}

// ---------------------------------------------------------------- статус блока
// Правило одно с plan-run, report и task.mjs status (progress.mjs blockState): написан - файл блока и
// work/audit/<slug>/lint-<block_id>.json с verdict pass. Файл есть, но линтер не pass (в том числе exhausted) -
// в прототипе скелет, текст заказчику не показывается. Файл без элементов - как ненаписанный.
export function blockState(slug, blockId) {
  const st = progressBlockState(P(), slug, { block_id: blockId }, '');
  if (!st.written) return { state: 'missing', block: null };
  let block = null;
  try { block = readJson(P('work', 'pages', slug, 'blocks', `${blockId}.json`)); } catch { return { state: 'missing', block: null }; }
  if (!block || !Array.isArray(block.elements) || !block.elements.length) return { state: 'missing', block: null };
  return st.pass ? { state: 'written', block } : { state: 'lint', block, verdict: st.lint };
}

// ---------------------------------------------------------------- sha входных данных («прототип старше данных»)
const rel = f => path.relative(P(), f).split(path.sep).join('/');
export function protoDataSha() {
  const h = crypto.createHash('sha1');
  const add = (name, s) => { h.update(name); h.update('\u0000'); h.update(String(s)); h.update('\u0000'); };
  const file = r => { const f = P(r); if (exists(f)) add(r, readText(f)); };
  // work/shell.json (оболочка по пересечениям лидеров, программа 05.10) - только если есть: у задач без этапа КФ sha
  // прежний. Правки аудитора прототипа (wf-08: блоки, брифы со stubs, strategy.json после merge-strategy) входят ниже.
  ['config/project.json', 'work/sitemap.json', 'work/facts.json', 'work/strategy.json', 'work/catalog/catalog-spec.json', 'work/catalog/sample-items.json', 'work/shell.json'].forEach(file);
  for (const f of listFiles(P('work', 'layouts'), '.html').sort()) add(rel(f), readText(f));
  const pagesDir = P('work', 'pages');
  const slugs = exists(pagesDir) ? fs.readdirSync(pagesDir).filter(s => fs.statSync(path.join(pagesDir, s)).isDirectory()).sort() : [];
  for (const slug of slugs) {
    file(`work/pages/${slug}/brief.json`);
    for (const f of listFiles(P('work', 'pages', slug, 'blocks'), '.json').filter(f => /^B\d{2}-[a-z0-9-]+\.json$/.test(path.basename(f))).sort()) add(rel(f), readText(f));
    for (const f of listFiles(P('work', 'audit', slug), '.json').filter(f => /^lint-B\d{2}-[a-z0-9-]+\.json$/.test(path.basename(f))).sort()) {
      let v = ''; try { v = readJson(f).verdict || ''; } catch { v = ''; }
      add(rel(f), v);
    }
  }
  for (const f of listFiles(P('work', 'catalog', 'samples')).sort()) { try { add(rel(f), fs.statSync(f).size); } catch { /* файл пропал - пропускаем */ } }
  return h.digest('hex').slice(0, 16);
}

// ---------------------------------------------------------------- таблицы
// Подряд идущие строки таблицы (элементы table_row - <div class="row">) собираются в одну таблицу .tbl: колонки
// выровнены по наибольшему числу ячеек (--cols), на телефоне таблица из 3+ колонок прокручивается вбок целиком
// (site.css), строки не переносятся «лесенкой». Текст ячеек не меняется (дословность check-html).
const ROW_SRC = '<div class="row"(?:\\s[^>]*)?>(?:(?!<\\/?div\\b)[\\s\\S])*?<\\/div>';
export function wrapTables(html) {
  return String(html).replace(new RegExp(`${ROW_SRC}(?:\\s*${ROW_SRC})*`, 'g'), run => {
    const rows = run.match(new RegExp(ROW_SRC, 'g')) || [];
    // пустые слоты раскладки (<div class="row" data-slot="table_row"></div>) скрыты правилом [data-slot]:empty - обертка
    // вокруг них заняла бы место (лишний отступ gap во flex-колонке)
    if (rows.every(r => !r.replace(/^<div[^>]*>/, '').replace(/<\/div>$/, '').trim())) return run;
    const cols = Math.max(1, ...rows.map(r => (r.match(/<span>/g) || []).length));
    return `<div class="tbl${cols >= 3 ? ' tbl-wide' : ''}" style="--cols:${cols}">${run}</div>`;
  });
}

// ---------------------------------------------------------------- семейства pattern: одна карта для раскладки по
// умолчанию и для скелета ненаписанного блока
const CARD_PATTERNS = { 'grid-2': 'grid grid-2', 'grid-3': 'grid grid-3', 'grid-4': 'grid grid-4', tiles: 'tiles', numbers: 'grid grid-4 num-grid', quote: 'grid grid-2', badges: 'stack' };
const KNOWN_PATTERNS = new Set(['hero-split', 'hero-center', 'grid-2', 'grid-3', 'grid-4', 'steps', 'accordion', 'list', 'table', 'listing', 'cards-slider', 'form', 'text', 'badges', 'map', 'numbers', 'quote', 'cta-band', 'gallery', 'tiles', 'custom']);
export function familyOf(spec, els = []) {
  const p = String((spec && spec.pattern) || '');
  if ((spec && spec.role === 'hero') || /^hero/.test(p)) return 'hero';
  if (isListing(spec)) return 'listing';
  if (p === 'form' || els.some(e => e && e.kind === 'field')) return 'form';
  if (p === 'map') return 'map';
  if (p === 'cta-band') return 'band';
  if (p === 'steps') return 'steps';
  if (p === 'accordion') return 'accordion';
  if (p === 'cards-slider' || p === 'gallery') return 'slider';
  if (p in CARD_PATTERNS) return 'cards';
  if (p === 'text' || p === 'list' || p === 'table') return 'text';
  return 'elements';
}
export const isKnownPattern = p => KNOWN_PATTERNS.has(String(p || ''));

// Повторяющиеся группы элементов (карточка/шаг/вопрос + картинка + текст + ссылка) собираются в плитки.
const NO_GROUP = new Set(['hero', 'form', 'listing', 'band', 'map', 'accordion']);
const STARTER_ORDER = ['card', 'step', 'quote', 'qa', 'number', 'h3', 'image'];
const LEAD = new Set(['h3', 'image', 'badges']);
export function groupTiles(elements, spec) {
  const fam = familyOf(spec, elements);
  if (NO_GROUP.has(fam)) return { intro: elements, groups: [], tail: [] };
  const primary = STARTER_ORDER.find(k => elements.filter(e => e.kind === k).length >= 2);
  if (!primary) return { intro: elements, groups: [], tail: [] };
  const intro = [], groups = [];
  let cur = null, pending = [];
  for (const el of elements) {
    if (el.kind === primary) { cur = [...pending, el]; pending = []; groups.push(cur); continue; }
    if (!cur) { if (LEAD.has(el.kind)) pending.push(el); else intro.push(el); continue; }
    if (LEAD.has(el.kind) && cur.some(x => x.kind === el.kind)) { pending.push(el); continue; }
    cur.push(el);
  }
  if (pending.length) (cur || intro).push(...pending);
  // хвост последней группы (ссылка, сноска или кнопка после последней карточки, вида которых нет в других группах)
  // относится ко всему блоку, а не к последней карточке
  const tail = [];
  if (groups.length > 1) {
    const last = groups[groups.length - 1];
    const at = last.map(e => e.kind).lastIndexOf(primary);
    const other = new Set(groups.slice(0, -1).flat().map(e => e.kind));
    for (let k = last.length - 1; k > at; k--) if (!other.has(last[k].kind)) tail.unshift(...last.splice(k, 1));
  }
  return { intro, groups, tail };
}

// ---------------------------------------------------------------- движок
// env: { ui (loadUi), hrefFor(href) -> string|null, phoneDigits: [7XXXXXXXXXX], email, claimMarkers: [основы],
//        mapBox() -> html|null }
export function makeEngine(env) {
  const ui = env.ui;
  const t = ui.t;
  const lang = ui.lang || {};
  const words = (lang.nbsp_words || []).map(reEsc).sort((a, b) => b.length - a.length);
  const NBSP = words.length ? new RegExp(`(?<![^\\s(«])(${words.join('|')})\\s(?=\\S)`, 'gi') : null;
  const typoText = s => { let x = s; if (NBSP) x = x.replace(NBSP, '$1&nbsp;'); return x.replace(/ - /g, '&nbsp;- '); };
  const typo = h => h.split(/(<[^>]+>)/).map(part => (part.startsWith('<') ? part : typoText(part))).join('');

  // автоссылки: только телефоны компании (сравнение по цифрам) и ее почта (точная строка)
  const phoneSet = new Set((env.phoneDigits || []).filter(Boolean));
  const PHONE_RE = /(?<![\d+])(?:\+\s?7|8|7)[\s (.-]*\d{3}[\s ).-]*\d{3}[\s .-]*\d{2}[\s .-]*\d{2}(?!\d)/g;
  const digits7 = s => { const d = String(s).replace(/\D/g, ''); return d.length === 11 && (d[0] === '7' || d[0] === '8') ? '7' + d.slice(1) : d; };
  function autolink(h) {
    let x = h;
    if (phoneSet.size) x = x.replace(PHONE_RE, m => { const d = digits7(m); return phoneSet.has(d) ? `<a class="link" href="tel:+${d}">${m}</a>` : m; });
    if (env.email) { const e = esc(env.email); if (x.includes(e)) x = x.split(e).join(`<a class="link" href="mailto:${e}">${e}</a>`); }
    return x;
  }
  const plain = (s, links) => { let h = esc(s); if (links) h = autolink(h); return typo(h); };
  const ext = h => (/^https?:/i.test(h) ? ' target="_blank" rel="noopener"' : '');
  const chip = x => `<mark class="ph" data-ph="${esc(x)}" title="${esc(x)}">${esc(t('need_data'))}</mark>`;
  function mdLink(text, url) {
    const h = env.hrefFor ? env.hrefFor(url) : null;
    const inner = plain(text, false);
    return h ? `<a class="link" href="${esc(h)}"${ext(h)}>${inner}</a>` : `<span class="link-off">${inner}</span>`;
  }
  // Строка писателя -> HTML: [[X]] - чип «нужны данные» (X в data-ph и title), [текст](адрес) - ссылка, если адрес
  // ведет на страницу сайта или наружу (иначе текст), **жирный**, типографика; links=false - без ссылок (кнопки, заголовки).
  function inline(s, links = true) {
    const src = String(s ?? '');
    const re = /\[\[([^\]]+)\]\]|\[([^[\]]+)\]\(([^()\s]*)\)/g;
    let out = '', last = 0, m;
    while ((m = re.exec(src))) {
      out += plain(src.slice(last, m.index), links);
      out += m[1] !== undefined ? chip(m[1]) : (links ? mdLink(m[2], m[3]) : plain(m[2], false));
      last = m.index + m[0].length;
    }
    out += plain(src.slice(last), links);
    return out.replace(/\*\*([^*]+?)\*\*/g, '<b>$1</b>');
  }

  // детектор утверждений о компании без опоры (служебный слой: подсветка предложения, не находка)
  const subj = (lang.we_subjects || []).map(reEsc);
  const SUBJ = subj.length ? new RegExp(`(^|[\\s«(,])(${subj.join('|')})\\s+\\p{L}`, 'iu') : null;
  const ends = (lang.we_verb_endings || []).map(String);
  const except = new Set((lang.we_verb_except || []).map(String));
  // маркеры утверждений - основы из rules/lint.json (claim_markers), минус исключения (claim_markers_except)
  const markers = (env.claimMarkers || []).map(x => String(x).toLowerCase()).filter(Boolean);
  const markersExcept = (env.claimExcept || []).map(x => String(x).toLowerCase()).filter(Boolean);
  function isClaim(s) {
    const low = String(s || '').toLowerCase().replace(/\[\[[^\]]*\]\]/g, ' ');
    if (SUBJ && SUBJ.test(low)) return true;
    for (const w of low.split(/[^\p{L}-]+/u)) {
      if (!w) continue;
      if (w.length >= 5 && !except.has(w) && ends.some(e => w.endsWith(e))) return true;
      if (markers.some(m => w.startsWith(m)) && !markersExcept.some(x => w.startsWith(x))) return true;
    }
    return false;
  }
  // [[...]], [текст](адрес) и **жирный** на время разбиения на предложения заменяются метками: точка внутри них
  // не рвет конструкцию (иначе заказчик увидел бы сырые скобки)
  const WHOLE_RE = /\[\[[^\]]+\]\]|\[[^[\]]+\]\([^()\s]*\)|\*\*[^*]+?\*\*/g;
  function para(s, el, links = true) {
    const str = String(s ?? '');
    const supported = el && Array.isArray(el.facts) && el.facts.length;
    if (supported || !str) return inline(str, links);
    const saved = [];
    const masked = str.replace(WHOLE_RE, m => `\u0001${saved.push(m) - 1}\u0001`);
    const parts = splitSentences(masked).map(p => p.replace(/\u0001(\d+)\u0001/g, (m, i) => saved[+i]));
    if (parts.length <= 1) return isClaim(str) ? `<span class="dbg-claim">${inline(str, links)}</span>` : inline(str, links);
    return parts.map(p => (isClaim(p) ? `<span class="dbg-claim">${inline(p, links)}</span>` : inline(p, links))).join(' ');
  }

  const F = el => { const f = (el && Array.isArray(el.facts) ? el.facts : []).filter(x => typeof x === 'string' && x); return f.length ? ` data-f="${esc(f.join(' '))}"` : ''; };
  const plainTitle = s => String(s ?? '').replace(/\[\[[^\]]*\]\]/g, '').replace(/\*\*/g, '').replace(/\[([^[\]]+)\]\([^()]*\)/g, '$1').replace(/\s+/g, ' ').trim();

  // вид поля формы: layout писателя (text|tel|email|textarea|file), иначе основы подписи из словаря
  const FIELD_KINDS = new Set(['text', 'tel', 'email', 'textarea', 'file']);
  function fieldKind(el) {
    if (FIELD_KINDS.has(el.layout)) return el.layout;
    const s = String(el.label || '').replace(/\[\[[^\]]*\]\]/g, ' ').toLowerCase();
    for (const row of lang.field_kinds || []) {
      const [kind, stems] = row;
      if (FIELD_KINDS.has(kind) && (stems || []).some(x => s.includes(String(x).toLowerCase()))) return kind;
    }
    return 'text';
  }
  function fieldHtml(el, attrF = '') {
    const kind = fieldKind(el);
    const cap = `<span class="field-l">${inline(el.label || '', false)}</span>`;
    if (kind === 'file') return `<label class="field field-file"${attrF}>${cap}<span class="drop">${icon('upload')}<span data-file-name>${esc(t('file_attach'))}</span></span><input type="file" hidden data-file></label>`;
    if (kind === 'textarea') return `<label class="field"${attrF}>${cap}<textarea rows="3"></textarea></label>`;
    const extra = kind === 'tel' ? ` placeholder="${esc(t('tel_placeholder'))}" autocomplete="tel"` : kind === 'email' ? ' autocomplete="email"' : '';
    return `<label class="field"${attrF}>${cap}<input type="${kind}"${extra}></label>`;
  }
  const hatched = (label, cls = 'img') => `<div class="${cls}"><span>${esc(label)}</span></div>`;

  function renderEl(el, ctx = {}) {
    const f = F(el);
    const L = !ctx.inLink;
    switch (el.kind) {
      case 'h1': case 'h2': case 'h3': return `<${el.kind}${f}>${para(el.text, el, false)}</${el.kind}>`;
      case 'sub': return `<p class="sub"${f}>${para(el.text, el, L)}</p>`;
      case 'text': return `<p${f}>${para(el.text, el, L)}</p>`;
      case 'note': return `<p class="note"${f}>${para(el.text, el, L)}</p>`;
      case 'button': return ctx.button ? ctx.button(el, f) : `<a class="btn" data-act="lead" data-title="${esc(plainTitle(el.text))}" href="#" role="button"${f}>${inline(el.text, false)}</a>`;
      case 'link': {
        const inner = inline(el.text, false);
        const h = L && el.href && env.hrefFor ? env.hrefFor(el.href) : null;
        return h ? `<a class="link-arrow" href="${esc(h)}"${ext(h)}${f}>${inner}${icon('arrow')}</a>` : `<span class="link-off"${f}>${inner}</span>`;
      }
      case 'bullets': return `<ul class="bl"${f}>${(el.items || []).map(i => `<li>${para(i, el, L)}</li>`).join('')}</ul>`;
      case 'badges': return `<div class="badges"${f}>${(el.items || []).map(i => `<span class="badge">${inline(i, false)}</span>`).join('')}</div>`;
      // вне каталога (услуги, старые задачи, листинг без listing: true) подписи фильтров - простым списком, не чипами;
      // чипы над выдачей рисует компонент каталога (site-parts catalogHtml)
      case 'filters': return `<ul class="bl"${f}>${(el.items || []).map(i => `<li>${inline(i, false)}</li>`).join('')}</ul>`;
      // строка таблицы; подряд идущие строки блока renderBlock собирает в одну таблицу (wrapTables)
      case 'table_row': return `<div class="row"${f}>${(el.items || []).map(i => `<span>${inline(i, L)}</span>`).join('')}</div>`;
      case 'card': {
        const h = L && el.href && env.hrefFor ? env.hrefFor(el.href) : null;
        const lk = L && !h;
        const inner = `${el.title ? `<h3>${inline(el.title, false)}</h3>` : ''}${el.text ? `<p>${para(el.text, el, lk)}</p>` : ''}${Array.isArray(el.meta) && el.meta.length ? `<ul class="meta">${el.meta.map(m => `<li>${inline(m, lk)}</li>`).join('')}</ul>` : ''}`;
        return h ? `<a class="card is-link" href="${esc(h)}"${ext(h)}${f}>${inner}${icon('arrow', 'ico tile-go')}</a>` : `<div class="card"${f}>${inner}</div>`;
      }
      case 'step': {
        ctx.step = (ctx.step || 0) + 1;
        return `<div class="step"${f}><span class="n">${String(ctx.step).padStart(2, '0')}</span><div>${el.title ? `<h3>${inline(el.title, false)}</h3>` : ''}${el.text ? `<p>${para(el.text, el, L)}</p>` : ''}</div></div>`;
      }
      case 'qa': return `<details class="qa"${f}><summary>${inline(el.q, false)}</summary><div class="qa-a"><p>${para(el.a, el, L)}</p></div></details>`;
      case 'quote': return `<blockquote${f}><p>${para(el.text, el, L)}</p>${el.author ? `<footer>${inline(el.author, false)}</footer>` : ''}</blockquote>`;
      case 'image': return `<div class="img${el.layout === 'tall' ? ' tall' : ''}"${f}><span>${el.alt ? inline(el.alt, false) : esc(t('photo_place'))}</span></div>`;
      case 'field': return ctx.field ? ctx.field(el, f) : fieldHtml(el, f);
      case 'number': return `<div class="num"${f}><b>${el.value ? inline(el.value, false) : chip(t('need_data'))}</b>${el.label ? `<span>${inline(el.label, false)}</span>` : ''}</div>`;
      default: {
        const parts = [el.title, el.text, el.label, el.value, el.q, el.a, ...(Array.isArray(el.items) ? el.items : [])].filter(x => typeof x === 'string' && x);
        return parts.length ? `<p class="el-x"${f}>${parts.map(x => para(x, el, L)).join(' ')}</p>` : '';
      }
    }
  }

  // ---------------- раскладка типа страницы
  const layouts = {};
  function layoutFor(type) {
    if (type in layouts) return layouts[type];
    const f = P('work', 'layouts', `${type}.html`);
    // пустые слоты-обертки details/ul -> div: внутрь ляжет свой details/ul, вложенный закрытый details спрятал бы ответы
    layouts[type] = exists(f) ? readText(f).replace(/<(details|ul)\b([^>]*\bdata-slot="[^"]*"[^>]*)>\s*<\/\1>/gi, '<div$2></div>') : null;
    return layouts[type];
  }
  function sectionOf(pageType, blockType) {
    const lay = layoutFor(pageType);
    if (!lay || !blockType) return null;
    const m = lay.match(new RegExp(`<section\\b[^>]*data-block="${reEsc(blockType)}"[^>]*>[\\s\\S]*?<\\/section>`, 'i'));
    return m ? m[0] : null;
  }
  function findTileTemplate(html) {
    const re = /<div\b[^>]*class="[^"]*\b(?:tile|card|step)\b[^"]*"[^>]*>/gi;
    let m;
    while ((m = re.exec(html))) {
      const start = m.index;
      let depth = 0, end = -1, tg;
      const tag = /<\/?div\b[^>]*>/gi;
      tag.lastIndex = start;
      while ((tg = tag.exec(html))) {
        if (tg[0].startsWith('</')) { depth--; if (depth === 0) { end = tg.index + tg[0].length; break; } } else depth++;
      }
      if (end < 0) continue;
      const inner = html.slice(start, end);
      if (/data-slot=/.test(inner)) return { start, end, html: inner };
    }
    return null;
  }
  function parseSlots(html) {
    const slotRe = /<([a-z]+)\b([^>]*)data-slot="([^"]*)"([^>]*)>/gi;
    const slots = [];
    let m; while ((m = slotRe.exec(html))) slots.push({ tag: m[1], kinds: m[3].split(/\s+/).filter(Boolean), index: m.index, len: m[0].length });
    return slots;
  }
  const classesOf = open => ((open.match(/\bclass="([^"]*)"/) || [])[1] || '').split(/\s+/).filter(Boolean);
  const setClasses = (open, list) => (/\bclass="/.test(open) ? open.replace(/\s*\bclass="[^"]*"/, list.length ? ` class="${list.join(' ')}"` : '') : (list.length ? open.replace(/>$/, ` class="${list.join(' ')}">`) : open));
  function mediaFill(isMap) {
    if (isMap) { const box = env.mapBox ? env.mapBox() : null; return box || hatched(t('map_place'), 'map'); }
    return hatched(t('photo_place'));
  }
  function fillSlots(html, slots, elements, ctx) {
    const buckets = slots.map(() => []);
    const kinds = slots.map(() => []);
    const rest = [];
    for (const el of elements) {
      const k = el.kind === '__tiles' ? el.primary : el.kind;
      let i = slots.findIndex(s => s.kinds.includes(k));
      if (i < 0 && el.kind === '__tiles') i = slots.findIndex(s => s.kinds.some(x => ['card', 'step', 'qa', 'quote', 'number'].includes(x)));
      if (i < 0) i = slots.findIndex(s => s.kinds.includes('*'));
      const slotIsGrid = i >= 0 && classesOf(html.slice(slots[i].index, slots[i].index + slots[i].len)).some(c => ['grid', 'tiles', 'slider', 'steps', 'acc'].includes(c));
      const o = el.kind === '__tiles' ? groupsHtml(el.groups, ctx, '', slotIsGrid) : renderEl(el, ctx);
      if (i < 0) rest.push(o); else { buckets[i].push(o); kinds[i].push(k); }
    }
    let out = '', last = 0;
    slots.forEach((s, i) => {
      let open = html.slice(s.index, s.index + s.len);
      const cls = classesOf(open);
      const isMap = cls.includes('map');
      const media = s.kinds.includes('image') || cls.includes('img') || isMap;
      // класс картинки или карты со слота переносится на дочерний элемент: слот остается оберткой
      if (media && (cls.includes('img') || isMap)) open = setClasses(open, cls.filter(c => c !== 'img' && c !== 'map' && c !== 'tall'));
      // несколько картинок в одном слоте - сеткой (если слот сам не сетка и не лента слайдера)
      if (kinds[i].filter(k => k === 'image').length > 1 && kinds[i].every(k => k === 'image') && !cls.some(c => ['grid', 'tiles', 'slider'].includes(c))) open = setClasses(open, [...classesOf(open), 'media-grid']);
      let body = buckets[i].join('\n');
      let skip = 0;
      if (!body && media) {
        // в слоте раскладки уже лежит пустая плашка картинки или карты - заполняется она, второй плашки нет
        const inner = html.slice(s.index + s.len).match(/^\s*<(div|span)\b([^>]*)>\s*<\/\1>/i);
        const icls = inner && !/data-slot=/.test(inner[2]) ? classesOf(`<x${inner[2]}>`) : [];
        if (icls.includes('map')) { body = mediaFill(true); skip = inner[0].length; }
        else if (icls.includes('img')) { body = `<div class="${esc(icls.join(' '))}"><span>${esc(t('photo_place'))}</span></div>`; skip = inner[0].length; }
        else body = mediaFill(isMap);
      }
      out += html.slice(last, s.index) + open + body;
      last = s.index + s.len + skip;
    });
    return { html: out + html.slice(last), rest };
  }
  // плитка группы: ведет на страницу, если у карточки или заголовка группы есть href писателя (без ссылок и полей внутри)
  function tileHtml(openTag, g, ctx) {
    const inLink = g.some(el => ['link', 'button', 'field', 'qa'].includes(el.kind));
    let h = null;
    if (!inLink && !ctx.inLink && env.hrefFor) for (const el of g) if ((el.kind === 'card' || el.kind === 'h3') && el.href) { h = env.hrefFor(el.href); if (h) break; }
    if (!h) return `${openTag}${g.map(el => renderEl(el, ctx)).join('\n')}</div>`;
    const c2 = { ...ctx, inLink: true };
    const inner = g.map(el => renderEl(el, c2)).join('\n');
    ctx.step = c2.step;
    const a = openTag.replace(/^<div\b/i, `<a href="${esc(h)}"${ext(h)}`);
    const withCls = /\bclass="/.test(a) ? a.replace(/\bclass="/, 'class="is-link ') : a.replace(/>$/, ' class="is-link">');
    return `${withCls}${inner}${icon('arrow', 'ico tile-go')}</a>`;
  }
  function stepGroup(g, ctx) {
    const stepEl = g.find(el => el.kind === 'step');
    if (!stepEl) return `<div class="tile">${g.map(el => renderEl(el, ctx)).join('\n')}</div>`;
    const html = renderEl(stepEl, ctx);
    const others = g.filter(el => el !== stepEl).map(el => renderEl(el, ctx)).join('\n');
    return others ? html.replace(/<\/div><\/div>$/, `${others}</div></div>`) : html;
  }
  // группы одним контейнером: шаги - вертикальный список, вопросы - аккордеон, прочее - сетка по pattern блока
  // bare - слот сам сетка (grid, tiles, slider, steps): плитки кладутся прямо в него, без второй сетки внутри ячейки
  function groupsHtml(groups, ctx, cls, bare = false) {
    const spec = ctx.spec || {};
    const primary = ((groups[0] || []).find(el => STARTER_ORDER.includes(el.kind)) || {}).kind;
    const grid = CARD_PATTERNS[spec.pattern] && CARD_PATTERNS[spec.pattern] !== 'stack' ? CARD_PATTERNS[spec.pattern] : 'grid grid-3';
    // только картинки по одной - сетка медиа (первая крупно, остальные парой), а не сетка карточек
    const onlyImages = groups.every(g => g.length === 1 && g[0].kind === 'image');
    const c = cls || (primary === 'step' ? 'steps' : primary === 'qa' ? 'acc' : primary === 'image' && onlyImages ? 'media-grid' : grid);
    // группа из одного элемента (карточка, цитата, число, вопрос) - сам элемент, без обертки-плитки
    const one = g => (g.length === 1 || primary === 'qa' ? g.map(el => renderEl(el, ctx)).join('\n') : g.some(el => el.kind === 'step') ? stepGroup(g, ctx) : tileHtml('<div class="tile">', g, ctx));
    const inner = groups.map(one).join('\n');
    return bare ? inner : `<div class="${c}">${inner}</div>`;
  }
  function fillLayout(sectionHtml, block, spec, ctx) {
    const tpl = findTileTemplate(sectionHtml);
    const { intro, groups, tail } = groupTiles(block.elements, spec);
    const tailText = tail.filter(el => el.kind === 'text');
    const own = [...intro, ...tail.filter(el => el.kind !== 'text')];
    let outer = sectionHtml, rest = [];
    if (tpl && groups.length) {
      const openTag = (tpl.html.match(/^<div\b[^>]*>/i) || ['<div class="tile">'])[0].replace(/\s*data-slot="[^"]*"/i, '');
      const isStepTpl = /\bstep\b/.test(openTag);
      const clones = groups.map(g => (isStepTpl && g.some(el => el.kind === 'step') ? stepGroup(g, ctx) : tileHtml(openTag, g, ctx)));
      const marker = '\u0000TILES\u0000';
      let skeleton = sectionHtml.slice(0, tpl.start) + marker + sectionHtml.slice(tpl.end);
      // соседние образцы плитки (раскладка рисует 2-3 одинаковые карточки) заменяются клонами: пустые образцы не
      // остаются в сетке пустыми карточками или плашками картинок
      const pos = tpl.start + marker.length;
      for (let k = 0; k < 100; k++) {
        const restH = skeleton.slice(pos);
        const ws = restH.match(/^\s*/)[0].length;
        const nx = findTileTemplate(restH);
        if (!nx || nx.start !== ws) break;
        skeleton = skeleton.slice(0, pos) + restH.slice(0, ws) + restH.slice(nx.end);
      }
      const r = fillSlots(skeleton, parseSlots(skeleton), own, ctx);
      outer = r.html.replace(marker, () => clones.join('\n'));
      rest = [...r.rest, ...tailText.map(el => renderEl(el, ctx))];
    } else if (tpl) {
      const r = fillSlots(sectionHtml, parseSlots(sectionHtml), block.elements, ctx);
      outer = r.html; rest = r.rest;
    } else {
      // шаблона плитки нет: группы - одним элементом-сеткой на месте первой группы, в слот их главного вида (или *)
      const slots = parseSlots(sectionHtml);
      const list = [...intro];
      if (groups.length) list.push({ kind: '__tiles', primary: groups[0].find(el => STARTER_ORDER.includes(el.kind))?.kind || 'card', groups });
      list.push(...tail);
      const r = fillSlots(sectionHtml, slots, list, ctx);
      outer = r.html; rest = r.rest;
    }
    const centered = /class="[^"]*\bcenter\b/.test(sectionHtml);
    if (rest.length) outer = outer.replace(/<\/section>\s*$/i, () => `<div class="stack rest${centered ? ' center' : ''}">${rest.join('\n')}</div></section>`);
    return outer;
  }

  // ---------------- слайдер: лента .slider с data-slider и стрелки под ней (поведение slider реестра)
  const sliderNav = () => `<div class="slider-nav"><button type="button" class="icon-btn" data-act="slide" data-dir="-1" aria-label="${esc(t('prev'))}">${icon('left')}</button><button type="button" class="icon-btn" data-act="slide" data-dir="1" aria-label="${esc(t('next'))}">${icon('right')}</button></div>`;
  // раскладка типа: первая лента .slider получает data-slider, стрелки - после нее; ленты нет - блок статичный
  function markSlider(html) {
    if (/\bdata-slider=/.test(html)) return html;
    const m = html.match(/<[a-z]+\b[^>]*\bclass="(?:[^"]*\s)?slider(?:\s[^"]*)?"[^>]*>/i);
    if (!m) return html;
    const open = m[0].replace(/^<([a-z]+)\b/i, '<$1 data-slider="1"');
    // конец ленты: закрывающий тег того же элемента по глубине вложенности
    const tag = (m[0].match(/^<([a-z]+)/i) || [])[1].toLowerCase();
    const re = new RegExp(`<\\/?${tag}\\b[^>]*>`, 'gi');
    re.lastIndex = m.index;
    let depth = 0, end = -1, x;
    while ((x = re.exec(html))) {
      if (x[0].startsWith('</')) { depth--; if (depth === 0) { end = x.index + x[0].length; break; } } else if (!/\/>$/.test(x[0])) depth++;
    }
    const body = html.slice(0, m.index) + open + html.slice(m.index + m[0].length);
    if (end < 0) return body + sliderNav();
    const shift = open.length - m[0].length;
    return body.slice(0, end + shift) + sliderNav() + body.slice(end + shift);
  }

  // ---------------- раскладка по умолчанию (нет секции блока в раскладке типа)
  function defaultInner(block, spec, ctx) {
    const els = block.elements || [];
    const fam = familyOf(spec, els);
    const R = list => list.map(el => renderEl(el, ctx)).join('\n');
    const head = list => (list.length ? `<div class="stack sec-head">${R(list)}</div>` : '');
    const tilesOf = (groups, cls) => groupsHtml(groups, ctx, cls);
    switch (fam) {
      case 'hero': {
        const media = els.filter(e => e.kind === 'image');
        const text = els.filter(e => e.kind !== 'image');
        if (!media.length && !ctx.heroMedia) return `<div class="stack narrow">${R(text)}</div>`;
        return `<div class="hero-split"><div class="stack hero-text">${R(text)}</div><div class="hero-media">${media.length ? R(media) : hatched(t('media_place'))}</div></div>`;
      }
      case 'form': {
        let lastF = -1; els.forEach((e, i) => { if (e.kind === 'field') lastF = i; });
        const right = els.filter((e, i) => e.kind === 'field' || e.kind === 'button' || i > lastF);
        const left = els.filter(e => !right.includes(e));
        return `<div class="cols cols-2 form-cols">${left.length ? `<div class="stack">${R(left)}</div>` : ''}<div class="stack form-panel">${R(right)}</div></div>`;
      }
      case 'band': return `<div class="band center"><div class="stack narrow center">${R(els)}</div></div>`;
      case 'map': {
        const box = env.mapBox ? env.mapBox() : null;
        return `<div class="cols cols-2"><div class="stack">${R(els)}</div>${box || hatched(t('map_place'), 'map')}</div>`;
      }
      case 'steps': {
        const { intro, groups, tail } = groupTiles(els, spec);
        if (!groups.length) return `<div class="stack narrow">${R(els)}</div>`;
        return `<div class="cols cols-steps">${head(intro) || '<div></div>'}<div class="steps">${groups.map(g => stepGroup(g, ctx)).join('\n')}${R(tail)}</div></div>`;
      }
      case 'accordion': {
        const qa = els.filter(e => e.kind === 'qa'), other = els.filter(e => e.kind !== 'qa');
        return `<div class="cols cols-faq">${head(other) || '<div></div>'}<div class="acc">${R(qa)}</div></div>`;
      }
      case 'slider': {
        const { intro, groups, tail } = groupTiles(els, spec);
        if (!groups.length) return `<div class="stack">${R(els)}</div>`;
        return `${head(intro)}${tilesOf(groups, 'slider" data-slider="1')}${sliderNav()}${tail.length ? `<div class="stack rest">${R(tail)}</div>` : ''}`;
      }
      case 'cards': {
        const { intro, groups, tail } = groupTiles(els, spec);
        const cls = CARD_PATTERNS[spec.pattern] || 'grid grid-3';
        if (!groups.length) return `${head(intro.filter(e => !['card', 'number', 'quote'].includes(e.kind)))}${intro.some(e => ['card', 'number', 'quote'].includes(e.kind)) ? `<div class="${cls === 'stack' ? 'grid grid-3' : cls}">${R(intro.filter(e => ['card', 'number', 'quote'].includes(e.kind)))}</div>` : ''}`;
        return `${head(intro)}${tilesOf(groups, cls === 'stack' ? 'grid grid-3' : cls)}${tail.length ? `<div class="stack rest">${R(tail)}</div>` : ''}`;
      }
      case 'listing': {
        const { intro, groups, tail } = groupTiles(els, spec);
        return `${head(intro)}${groups.length ? tilesOf(groups) : ''}${ctx.childTiles || ''}${tail.length ? `<div class="stack rest">${R(tail)}</div>` : ''}`;
      }
      case 'text': {
        const { intro, groups, tail } = groupTiles(els, spec);
        return `<div class="stack narrow">${R(intro)}</div>${groups.length ? tilesOf(groups) : ''}${tail.length ? `<div class="stack narrow rest">${R(tail)}</div>` : ''}`;
      }
      default: {
        // pattern custom и незнакомый pattern: секция по элементам в порядке писателя, повторы - сеткой
        const { intro, groups, tail } = groupTiles(els, spec);
        return `<div class="custom-block"><div class="stack">${R(intro)}</div>${groups.length ? tilesOf(groups) : ''}${tail.length ? `<div class="stack rest">${R(tail)}</div>` : ''}</div>`;
      }
    }
  }

  // Внутренность секции написанного блока: { inner, viaLayout }. ctx: { button, field, heroMedia, childTiles }
  function renderBlock(pageType, spec, block, ctx) {
    ctx.spec = spec;
    const sec = sectionOf(pageType, spec.type);
    if (sec) {
      const open = sec.match(/^<section\b[^>]*>/i)[0];
      const secCls = classesOf(open).filter(c => c !== 'blk');
      let inner = fillLayout(sec, block, spec, ctx).replace(/^\s*<section\b[^>]*>/i, '').replace(/<\/section>\s*$/i, '');
      if (familyOf(spec, block.elements) === 'slider') inner = markSlider(inner);
      if (secCls.length) inner = `<div class="${esc(secCls.join(' '))}">${inner}</div>`;
      if (ctx.childTiles) inner += ctx.childTiles;
      return { inner: wrapTables(inner), viaLayout: true };
    }
    return { inner: wrapTables(defaultInner(block, spec, ctx)), viaLayout: false };
  }

  // Первый экран home/service/hub: если раскладка не дала медиа (нет картинки, карты, колонок и полей) -
  // две колонки «текст | штриховка» (правило сборщика, работает и на старых раскладках hero-center)
  function ensureHeroMedia(inner) {
    if (/class="[^"]*\b(img|map|hero-media|hero-split|cols)\b/.test(inner) || /<label class="field/.test(inner)) return inner;
    const text = inner.replace(/\bclass="([^"]*)"/g, (m, c) => { const list = c.split(/\s+/).filter(x => x && x !== 'center' && x !== 'narrow'); return list.length ? `class="${list.join(' ')}"` : 'class=""'; }).replace(/\s*class=""/g, '');
    return `<div class="hero-split"><div class="stack hero-text">${text}</div><div class="hero-media">${hatched(t('media_place'))}</div></div>`;
  }

  // Скелет ненаписанного блока - по той же карте pattern; у первого экрана h1 интерфейса (тема страницы)
  function skeletonInner(spec, opts = {}) {
    const fam = familyOf(spec, []);
    const lines = w => w.map(x => `<i style="width:${x}%"></i>`).join('');
    const cards = n => `<div class="sk-cards">${Array.from({ length: n }, (_, i) => `<div class="sk-card">${lines([80 - i * 5, 95, 60])}</div>`).join('')}</div>`;
    let body;
    switch (fam) {
      case 'hero': body = `${opts.h1 ? `<h1 data-ui="1">${esc(opts.h1)}</h1>` : '<i class="sk-h1"></i>'}${lines([72, 56])}<i class="sk-btn"></i>`; break;
      case 'cards': case 'slider': case 'listing': body = `<i class="sk-h2"></i>${cards(3)}`; break;
      case 'steps': body = `<i class="sk-h2"></i>${[1, 2, 3].map(n => `<div class="sk-step"><span>${n}</span><div>${lines([60, 85])}</div></div>`).join('')}`; break;
      case 'accordion': body = `<i class="sk-h2"></i>${[1, 2, 3, 4].map(() => '<i class="sk-bar"></i>').join('')}`; break;
      case 'form': body = `<div class="sk-form"><div><i class="sk-h2"></i>${lines([80, 60])}</div><div><i class="sk-in"></i><i class="sk-in"></i><i class="sk-btn"></i></div></div>`; break;
      case 'map': body = `<div class="sk-map"><div><i class="sk-h2"></i>${lines([80, 70, 50])}</div>${hatched(t('map_place'), 'map')}</div>`; break;
      case 'band': body = `<i class="sk-h2" style="margin-left:auto;margin-right:auto"></i>${lines([70, 50])}<i class="sk-btn" style="margin-left:auto;margin-right:auto"></i>`; break;
      default: body = `<i class="sk-h2"></i>${lines([92, 88, 70, 45])}`;
    }
    return `<div class="sk"><div class="sk-name">${esc(t('block_wip'))}</div>${body}</div>`;
  }

  return { inline, para, renderEl, renderBlock, ensureHeroMedia, skeletonInner, fieldHtml, fieldKind, chip, hatched, isClaim, plainTitle, familyOf, layoutFor, sectionOf };
}
