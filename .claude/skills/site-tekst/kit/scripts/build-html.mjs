// Сборка одного файла прототипа. node scripts/build-html.mjs [--out work/output/prototype.html]
// Вход: sitemap, pages/<slug>/brief.json + blocks/*.json, layouts/<type>.html, html/primitives.css, html/shell.html,
// catalog/catalog-spec.json (необязательно, для заглушки листинга).
import path from 'node:path';
import { argv, P, readJson, readText, exists, writeText, writeJson, loadConfig, loadSitemap, pageDir, loadBrief, loadBlocks, escapeHtml, elementTexts, nowIso, PLACEHOLDER_RE } from './lib.mjs';

const a = argv({});
const out = a.out || P('work', 'output', 'prototype.html');
const cfg = loadConfig();
const sm = loadSitemap();
const css = readText(P('html', 'primitives.css'));
const shell = readText(P('html', 'shell.html'));
const catalog = exists(P('work', 'catalog', 'catalog-spec.json')) ? readJson(P('work', 'catalog', 'catalog-spec.json')) : null;
const layouts = {};
function layoutFor(type) {
  if (layouts[type] !== undefined) return layouts[type];
  const f = P('work', 'layouts', `${type}.html`);
  layouts[type] = exists(f) ? readText(f) : null;
  return layouts[type];
}
function ph(s) { return escapeHtml(s).replace(/\[\[([^\]]+)\]\]/g, '<mark class="ph">[[$1]]</mark>'); }
function md(s) { return ph(s).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>'); }
function renderEl(el, ctx) {
  switch (el.kind) {
    case 'h1': return `<h1>${md(el.text)}</h1>`;
    case 'h2': return `<h2>${md(el.text)}</h2>`;
    case 'h3': return `<h3>${md(el.text)}</h3>`;
    case 'sub': return `<p class="sub">${md(el.text)}</p>`;
    case 'text': return `<p>${md(el.text)}</p>`;
    case 'note': return `<p class="note">${md(el.text)}</p>`;
    case 'button': return `<a class="btn${el.layout === 'secondary' ? ' secondary' : ''}" href="#">${ph(el.text)}</a>`;
    case 'link': return `<a class="link" href="${escapeHtml(el.href || '#')}">${ph(el.text)}</a>`;
    case 'bullets': return `<ul>${(el.items || []).map(i => `<li>${md(i)}</li>`).join('')}</ul>`;
    case 'badges': return `<div>${(el.items || []).map(i => `<span class="badge">${ph(i)}</span>`).join('')}</div>`;
    case 'filters': return `<div class="filters">${(el.items || []).map(i => `<span>${ph(i)}</span>`).join('')}</div>`;
    case 'table_row': return `<div class="row">${(el.items || []).map(i => `<span>${ph(i)}</span>`).join('')}</div>`;
    case 'card': return `<div class="card">${el.title ? `<h3>${md(el.title)}</h3>` : ''}${el.text ? `<p>${md(el.text)}</p>` : ''}${el.meta?.length ? `<ul class="meta">${el.meta.map(m => `<li>${ph(m)}</li>`).join('')}</ul>` : ''}</div>`;
    case 'step': ctx.step = (ctx.step || 0) + 1; return `<div class="step"><span class="n">${ctx.step}</span><div>${el.title ? `<h3>${md(el.title)}</h3>` : ''}${el.text ? `<p>${md(el.text)}</p>` : ''}</div></div>`;
    case 'qa': return `<details><summary>${ph(el.q)}</summary><p>${md(el.a)}</p></details>`;
    case 'quote': return `<blockquote>${md(el.text)}${el.author ? `<footer>${ph(el.author)}</footer>` : ''}</blockquote>`;
    case 'image': return `<div class="img${el.layout === 'tall' ? ' tall' : ''}">${ph(el.alt || 'изображение')}</div>`;
    case 'field': return `<label class="field">${ph(el.label)}<input disabled></label>`;
    case 'number': return `<div class="num"><b>${ph(el.value || '[нет значения]')}</b><span>${ph(el.label || '')}</span></div>`;
    default: return `<p>${md(elementTexts(el).map(t => t.text).join(' '))}</p>`;
  }
}
function catalogStub() {
  return `<!--stub-->${catalogStubInner()}<!--/stub-->`;
}
function catalogStubInner() {
  if (!catalog) return `<div class="stub"><div class="stub-title">заглушка каталога: спецификация еще не собрана</div><div class="cols cols-side"><div class="aside">фильтры</div><div class="grid grid-3"><div class="card"><h3>карточка</h3></div><div class="card"><h3>карточка</h3></div><div class="card"><h3>карточка</h3></div></div></div></div>`;
  const fields = catalog.card_fields.filter(f => f.in_listing_card !== false);
  const card = `<div class="card"><div class="img">фото</div>${fields.map(f => `<p><small>${escapeHtml(f.name)}${f.example ? `: ${escapeHtml(f.example)}` : ''}</small></p>`).join('')}<a class="btn" href="#">${escapeHtml(catalog.card_cta.main)}</a></div>`;
  return `<div class="stub"><div class="stub-title">заглушка каталога (по catalog-spec.json): сетка карточек, ${catalog.listing.cards_per_page} на страницу, ${escapeHtml(catalog.listing.pagination)}</div><div class="cols cols-side"><div class="aside"><b>Фильтры</b><ul class="list-plain">${catalog.filters.map(f => `<li>${escapeHtml(f.name)} (${f.type})</li>`).join('')}</ul><b>Сортировка</b><ul class="list-plain">${catalog.sorting.map(s => `<li>${escapeHtml(s)}</li>`).join('')}</ul></div><div class="grid grid-3">${card}${card}${card}</div></div></div>`;
}
// Повторяющиеся группы элементов (карточка/заголовок/шаг + картинка + текст + ссылка) собираются в плитки,
// иначе раскладка по видам разносит картинки в одну кучу, а подписи - в другую.
const GROUP_PATTERNS = new Set(['tiles', 'grid-2', 'grid-3', 'grid-4', 'cards-slider', 'gallery', 'steps']);
// главный вид элемента, который начинает плитку: первый из списка, встречающийся хотя бы дважды
const STARTER_ORDER = ['card', 'step', 'quote', 'qa', 'h3', 'image'];
const LEAD = new Set(['h3', 'image', 'badges']); // могут предварять главный элемент плитки
function groupTiles(elements, pattern) {
  if (!GROUP_PATTERNS.has(pattern)) return { intro: elements, groups: [] };
  const primary = STARTER_ORDER.find(k => elements.filter(e => e.kind === k).length >= 2);
  if (!primary) return { intro: elements, groups: [] };
  const intro = [], groups = [];
  let cur = null, pending = [];
  for (const el of elements) {
    if (el.kind === primary) { cur = [...pending, el]; pending = []; groups.push(cur); continue; }
    if (!cur) { if (LEAD.has(el.kind)) pending.push(el); else intro.push(el); continue; }
    if (LEAD.has(el.kind) && cur.some(x => x.kind === el.kind)) { pending.push(el); continue; }
    cur.push(el);
  }
  if (pending.length) (cur || intro).push(...pending);
  return { intro, groups };
}
// ищем в разметке шаблон плитки: div с классом tile/card, внутри которого есть data-slot; возвращаем его границы
function findTileTemplate(html) {
  const re = /<div\b[^>]*class="[^"]*\b(?:tile|card|step)\b[^"]*"[^>]*>/gi;
  let m;
  while ((m = re.exec(html))) {
    const start = m.index;
    // ищем парный </div> с учетом вложенности
    let depth = 0, i = start;
    const tag = /<\/?div\b[^>]*>/gi;
    tag.lastIndex = start;
    let t, end = -1;
    while ((t = tag.exec(html))) {
      if (t[0].startsWith('</')) { depth--; if (depth === 0) { end = t.index + t[0].length; break; } }
      else depth++;
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
function fillSlots(html, slots, elements, ctx) {
  // раскладывает элементы по слотам внутри html, возвращает {html, rest}
  const buckets = slots.map(() => []);
  const rest = [];
  for (const el of elements) {
    let i = slots.findIndex(s => s.kinds.includes(el.kind));
    if (i < 0) i = slots.findIndex(s => s.kinds.includes('*'));
    const out = renderEl(el, ctx);
    if (i < 0) rest.push(out); else buckets[i].push(out);
  }
  let outHtml = '', last = 0;
  slots.forEach((s, i) => { outHtml += html.slice(last, s.index + s.len) + buckets[i].join('\n'); last = s.index + s.len; });
  outHtml += html.slice(last);
  // пустые слоты-заглушки картинок и карт не рисуем серым прямоугольником
  outHtml = outHtml.replace(/<(div|aside)\b[^>]*class="[^"]*\b(?:img|map)\b[^"]*"[^>]*data-slot="[^"]*"[^>]*>\s*<\/\1>/gi, '');
  return { html: outHtml, rest };
}
function fillLayout(sectionHtml, block, spec) {
  const ctx = {};
  const tpl = findTileTemplate(sectionHtml);
  const { intro, groups } = groupTiles(block.elements, spec.pattern);
  let outer = sectionHtml, rest = [];
  if (tpl && groups.length) {
    // шаблон плитки клонируется под каждую группу элементов
    // от шаблона плитки берем только обертку (классы): элементы внутри идут в порядке, заданном писателем
    const openTag = (tpl.html.match(/^<div\b[^>]*>/i) || ['<div class="tile">'])[0].replace(/\s*data-slot="[^"]*"/i, '');
    const isStepTpl = /\bstep\b/.test(openTag);
    const clones = groups.map(g => {
      const stepEl = isStepTpl ? g.find(el => el.kind === 'step') : null;
      if (stepEl) {
        // шаг рисует свою обертку с номером; остальные элементы группы - внутрь шага
        const others = g.filter(el => el !== stepEl).map(el => renderEl(el, ctx)).join('\n');
        const html = renderEl(stepEl, ctx);
        return others ? html.replace(/<\/div><\/div>$/, `${others}</div></div>`) : html;
      }
      return `${openTag}${g.map(el => renderEl(el, ctx)).join('\n')}</div>`;
    });
    outer = sectionHtml.slice(0, tpl.start) + clones.join('\n') + sectionHtml.slice(tpl.end);
    // внешние слоты - те, что не внутри клонов: пересчитываем по разметке без клонов
    const marker = ' TILES ';
    const skeleton = sectionHtml.slice(0, tpl.start) + marker + sectionHtml.slice(tpl.end);
    const r = fillSlots(skeleton, parseSlots(skeleton), intro, ctx);
    outer = r.html.replace(marker, clones.join('\n'));
    rest = r.rest;
  } else if (tpl) {
    // один шаблон и нет повторяющихся групп: заполняем его и внешние слоты обычным порядком
    const r = fillSlots(sectionHtml, parseSlots(sectionHtml), block.elements, ctx);
    outer = r.html; rest = r.rest;
  } else {
    const slots = parseSlots(sectionHtml);
    const r = fillSlots(sectionHtml, slots, intro, ctx);
    outer = r.html; rest = r.rest;
    if (groups.length) {
      const tiles = `<div class="grid grid-3">${groups.map(g => `<div class="tile">${g.map(el => renderEl(el, ctx)).join('\n')}</div>`).join('\n')}</div>`;
      // плитки - в слот, принимающий card или *, иначе в конец секции
      const slotIdx = slots.findIndex(s => s.kinds.includes('card')) >= 0 ? slots.findIndex(s => s.kinds.includes('card')) : slots.findIndex(s => s.kinds.includes('*'));
      if (slotIdx >= 0) {
        // вставляем после открывающего тега слота в уже заполненной разметке: ищем тот же тег по порядку
        const re = /<([a-z]+)\b[^>]*data-slot="[^"]*"[^>]*>/gi; let m, n = 0, pos = -1;
        while ((m = re.exec(outer))) { if (n++ === slotIdx) { pos = m.index + m[0].length; break; } }
        if (pos >= 0) outer = outer.slice(0, pos) + tiles + outer.slice(pos); else rest.push(tiles);
      } else rest.push(tiles);
    }
  }
  if (rest.length) outer = outer.replace(/<\/section>\s*$/i, `<div class="stack">${rest.join('\n')}</div></section>`);
  if (spec.pattern === 'listing' || spec.type === 'listing') outer = outer.replace(/<\/section>\s*$/i, `${catalogStub()}</section>`);
  return outer;
}

function defaultSection(block, spec) {
  const ctx = {};
  const { intro, groups } = groupTiles(block.elements, spec.pattern);
  const body = intro.map(el => renderEl(el, ctx)).join('\n') + (groups.length ? `<div class="grid grid-3">${groups.map(g => `<div class="tile">${g.map(el => renderEl(el, ctx)).join('\n')}</div>`).join('\n')}</div>` : '');
  const stub = (spec.pattern === 'listing' || spec.type === 'listing') ? catalogStub() : '';
  return `<section data-block="${spec.type}" class="blk"><div class="stack narrow" data-slot="*">${body}</div>${stub}</section>`;
}

const index = {};
let pagesHtml = '';
let blocksCount = 0, placeholders = 0, pagesCount = 0;
const indexJson = {};
const pages = sm.pages.filter(p => p.status !== 'skip' && exists(path.join(pageDir(p.slug), 'brief.json')));
for (const p of pages) {
  const brief = loadBrief(p.slug);
  const blocks = loadBlocks(p.slug);
  if (!blocks.length) continue;
  pagesCount++;
  const layout = layoutFor(p.type);
  let body = '';
  indexJson[p.slug] = {};
  for (const spec of brief.blocks) {
    const found = blocks.find(b => b.block.block_id === spec.block_id);
    const label = `<div class="lbl">${escapeHtml(spec.block_id)} · ${escapeHtml(spec.name)} · роль: ${spec.role} · вопрос читателя: ${escapeHtml(spec.reader_question)}${spec.objection_ids?.length ? ' · возражения: ' + spec.objection_ids.join(', ') : ''}</div>`;
    if (!found) { body += `<section class="blk" data-block-id="${spec.block_id}" data-block-type="${spec.type}" data-missing="1">${label}<p class="note">блок еще не написан</p></section>`; continue; }
    let sec = '';
    const m = layout && layout.match(new RegExp(`<section\\b[^>]*data-block="${spec.type}"[^>]*>[\\s\\S]*?<\\/section>`, 'i'));
    sec = m ? fillLayout(m[0], found.block, spec) : defaultSection(found.block, spec);
    sec = sec.replace(/<section\b([^>]*)>/i, (_, attrs) => `<section${attrs.includes('class="') ? attrs.replace(/class="/, 'class="blk ') : attrs + ' class="blk'} data-block-id="${spec.block_id}" data-block-type="${spec.type}">${label}`);
    // если в атрибутах не было class, закрываем кавычку
    sec = sec.replace(/class="blk data-block-id=/, 'class="blk" data-block-id=');
    body += sec + '\n';
    blocksCount++;
    placeholders += (JSON.stringify(found.block.elements).match(PLACEHOLDER_RE) || []).length;
    indexJson[p.slug][spec.block_id] = found.block.elements.flatMap(el => elementTexts(el).map(t => t.text)).join('\n');
  }
  const head = `<div class="pg-head"><h2>${escapeHtml(brief.subject)}</h2><code>${escapeHtml(brief.url)}</code> · тип: ${brief.type} · набор: ${brief.block_set} · сегмент: ${escapeHtml(brief.segment?.name || '')} · CTA: ${escapeHtml(brief.cta?.main || '')}<br>уникальный аргумент: ${escapeHtml(brief.unique_argument || '')}</div>`;
  pagesHtml += `<article data-page="${p.slug}" data-url="${escapeHtml(brief.url)}">${head}${body}</article>\n`;
  (index[p.type] ??= []).push(`<li><a href="#p/${p.slug}">${escapeHtml(brief.subject)}</a> <small>${escapeHtml(brief.url)} · ${blocks.length}/${brief.blocks.length} блоков</small></li>`);
}
const indexHtml = Object.entries(index).map(([t, items]) => `<h3>${t}</h3><ul>${items.join('')}</ul>`).join('');
const html = shell
  .replace('{{title}}', escapeHtml(`${cfg.company || cfg.slug}: тексты сайта`))
  .replace('{{company}}', escapeHtml(cfg.company || cfg.slug))
  .replace('{{built_at}}', nowIso())
  .replace('{{css}}', css)
  .replace('{{pages_count}}', String(pagesCount)).replace('{{blocks_count}}', String(blocksCount)).replace('{{placeholders_count}}', String(placeholders))
  .replace('{{index}}', indexHtml)
  .replace('{{pages}}', pagesHtml);
writeText(out, html);
writeJson(out.replace(/\.html$/, '.index.json'), indexJson);
console.log(`прототип: ${path.relative(process.cwd(), out)} - страниц ${pagesCount}, блоков ${blocksCount}, плейсхолдеров ${placeholders}, размер ${(Buffer.byteLength(html) / 1024).toFixed(0)} КБ`);
