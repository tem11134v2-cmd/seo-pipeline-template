// DOM-находки КФ (фаза 2): одна функция обхода страницы kfScanPage - для отрисованной страницы в Chrome (CDP,
// capture-pages.mjs) и для статического html в jsdom (scanHtml; jsdom - через deps.mjs, нет его - null и строка
// ограничения у вызывающего). Детектор - доказательство, решение по видимости - у наблюдателя (02-kf-observer).
// Результат (kf.json снимка): {zones: {header, footer, body, fixed, mobile: [{id, evidence: {selector, text, href},
//   hidden?}]}, outline: [{level, heading, text80, y, tile, has: ["table"|"list"|"form"|"img"|"video"|"map"]}],
//   schema: ["@type"], page: {title, h1, height, layout}}.
// Зоны: header - первый header/[role=banner] (иначе элемент с header в id/class, при раскладке - верхние 200 px), footer -
// последний footer/[role=contentinfo] (иначе элемент с footer в id/class, при раскладке - нижние 500 px), fixed - видимые
// position fixed|sticky вне шапки, body - остальное. mobile заполняет capture-pages.mjs: шапка и закрепленные того же
// обхода на 390 px. Без раскладки (jsdom) y и tile - null, зоны - только по элементам.
// Детекторы: tel:, mailto:, мессенджеры, соцсети, формы и поля, поиск, корзина, избранное, сравнение, кабинет, крошки,
// iframe карт и видео, чат-виджеты (общий список src), куки-баннер, ИНН/ОГРН/КПП, юридические ссылки, цены, рейтинг,
// Schema.org, логотип, меню, кнопка вверх, часы работы, копирайт, значки оплаты, приложения, площадки отзывов; ссылки на
// страницы - по synonyms элементов словаря вида page_link (linkPatterns).
import fs from 'node:fs';
import { loadDep } from './deps.mjs';

// Функция исполняется в странице (браузер или окно jsdom): без замыканий и импортов, параметры - JSON.
export function kfScanPage(opts) {
  const o = opts || {};
  const doc = document, win = window;
  const sp = s => String(s || '').replace(/[\u00ad\u200b-\u200d\u2060\ufeff]/g, '').replace(/\s+/g, ' ').trim();
  const low = s => sp(s).toLowerCase().replace(/\u0451/g, 'е');
  const body = doc.body || doc.documentElement;
  const rectOf = el => { try { return el.getBoundingClientRect(); } catch (e) { return { top: 0, left: 0, width: 0, height: 0 }; } };
  const layout = rectOf(body).height > 0 || rectOf(doc.documentElement).height > 0;
  const scrollY = win.scrollY || 0;
  const absTop = el => Math.round(rectOf(el).top + scrollY);
  const docH = Math.max(doc.documentElement.scrollHeight || 0, body.scrollHeight || 0);
  const cs = el => { try { return win.getComputedStyle(el); } catch (e) { return null; } };
  const hiddenSelf = el => { const s = cs(el); return !!s && (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0'); };
  const visible = el => {
    if (layout) { const r = rectOf(el); if (r.width <= 0 || r.height <= 0) return false; const s = cs(el); return !(s && (s.visibility === 'hidden' || s.opacity === '0')); }
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) if (hiddenSelf(n)) return false;
    return true;
  };
  const tagOf = el => String(el.tagName || '').toLowerCase();
  const pathOf = el => {
    const parts = [];
    for (let n = el, i = 0; n && n.nodeType === 1 && i < 4 && n !== body; n = n.parentElement, i++) {
      let p = tagOf(n);
      if (n.id && /^[a-z][\w-]{0,30}$/i.test(n.id)) { parts.unshift(p + '#' + n.id); break; }
      const c = String(n.getAttribute('class') || '').trim().split(/\s+/).filter(x => /^[a-z][\w-]{0,30}$/i.test(x))[0];
      if (c) p += '.' + c;
      parts.unshift(p);
    }
    return parts.join(' > ');
  };
  const cls = el => (String(el.getAttribute && el.getAttribute('class') || '') + ' ' + String(el.id || '')).toLowerCase();
  // контейнеры зон
  // нет предка по селектору (html и body не в счет: класс has-header у body не делает страницу шапкой)
  const notIn = (el, sel) => { const a = el.parentElement && el.parentElement.closest(sel); return !a || a === body || a === doc.documentElement; };
  let header = [...doc.querySelectorAll('header, [role=banner]')].find(el => notIn(el, 'main, article, footer')) || null;
  // запасной путь: элемент с header/footer в id или class - не body и не обертка всего содержимого (внутри нет h1 и main)
  const wrapper = el => /^(html|body|main)$/.test(tagOf(el)) || !!el.querySelector('h1, main, article');
  if (!header) header = [...body.querySelectorAll('[id*=header i], [class*=header i]')].find(el => !wrapper(el) && notIn(el, 'main, article, footer, [id*=header i], [class*=header i]') && !/subheader|header__title/.test(cls(el))) || null;
  const footers = [...doc.querySelectorAll('footer, [role=contentinfo]')].filter(el => notIn(el, 'main, article, section'));
  let footer = footers.length ? footers[footers.length - 1] : null;
  if (!footer) { const f = [...body.querySelectorAll('[id*=footer i], [class*=footer i]')].filter(el => !wrapper(el) && notIn(el, '[id*=footer i], [class*=footer i]')); footer = f.length ? f[f.length - 1] : null; }
  const fixed = [];
  const all = [...body.querySelectorAll('*')];
  for (const el of all) {
    if (fixed.length >= 40) break;
    if ((header && header.contains(el)) || fixed.some(f => f.contains(el))) continue;
    const s = cs(el);
    if (!s || (s.position !== 'fixed' && s.position !== 'sticky')) continue;
    if (header && el.contains(header)) continue;
    // закрепленный элемент - панель или кнопка: fixed не больше половины окна, sticky - полоса до 160 px; большие
    // fixed/sticky секции (слайды, «стопки» экранов) - содержимое тела. Без раскладки sticky не отличить - не берется.
    if (layout) {
      const r = rectOf(el);
      if (s.position === 'fixed' && r.height > win.innerHeight * 0.5 && r.width > win.innerWidth * 0.5) continue;
      if (s.position === 'sticky' && r.height > 160) continue;
    } else if (s.position === 'sticky') continue;
    if (visible(el)) fixed.push(el);
  }
  const zoneOf = el => {
    if (header && header.contains(el)) return 'header';
    if (footer && footer.contains(el)) return 'footer';
    if (fixed.some(f => f.contains(el))) return 'fixed';
    if (layout) {
      const t = absTop(el);
      if (!header && t < 200) return 'header';
      if (!footer && docH > 1200 && t > docH - 500) return 'footer';
    }
    return 'body';
  };
  const zones = { header: [], footer: [], body: [], fixed: [], mobile: [] };
  const seen = {};
  const hit = (id, el, extra) => {
    if (!el || !id) return;
    const z = (extra && extra.zone) || zoneOf(el);
    const key = z + ':' + id;
    const vis = extra && extra.zone ? true : visible(el);
    const prev = seen[key];
    if (prev && (prev.hidden !== true || !vis)) return;
    const e = { id, evidence: { selector: pathOf(el), text: sp((extra && extra.text) || el.textContent || el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('alt') || '').slice(0, 80), href: String((extra && extra.href) || el.getAttribute('href') || el.getAttribute('src') || '').slice(0, 160) } };
    if (!vis) e.hidden = true;
    if (prev) zones[z][zones[z].indexOf(prev)] = e; else zones[z].push(e);
    seen[key] = e;
  };
  const hrefOf = a => String(a.getAttribute('href') || '');
  const links = [...doc.querySelectorAll('a[href]')];
  const MSG = [[/wa\.me|whatsapp|api\.whatsapp/i, 'messenger_whatsapp'], [/viber:|viber\.com|vb\.me/i, 'messenger_viber'], [/max\.ru\//i, 'messenger_max']];
  const SOC = [[/(^|\/\/|\.)vk\.(com|ru)\//i, 'social_vk'], [/(^|\/\/|\.)ok\.ru\//i, 'social_ok'], [/youtube\.com|youtu\.be/i, 'social_youtube'], [/rutube\.ru/i, 'social_rutube'], [/dzen\.ru|zen\.yandex/i, 'social_dzen'], [/instagram\.com/i, 'social_instagram'], [/tiktok\.com/i, 'social_tiktok']];
  const REV = /yandex\.[a-z]+\/maps\/org|2gis\.[a-z]+\/[^\s]*firm|otzovik\.com|zoon\.ru|irecommend\.ru|flamp\.ru|prodoctorov|market\.yandex\.[a-z]+\/business/i;
  const APP = /apps\.apple\.com|play\.google\.com|rustore\.ru|appgallery/i;
  const LEGAL = [[/политик[а-я]* (конфиденц|обработк)|конфиденциальност/, /privacy|politik|konfiden/, 'privacy_policy'], [/оферт/, /oferta|public-offer/, 'offer'], [/соглас[а-я]* на обработку|обработк[а-я]* персональн/, /soglasie|consent|personal-data/, 'pd_consent'], [/пользовательск[а-я]* соглашени|условия использования/, /terms|soglashenie|user-agreement/, 'terms_of_use']];
  const pat = (o.links || []).map(x => ({ id: x.id, re: new RegExp(x.re, 'i') }));
  for (const a of links) {
    const h = hrefOf(a);
    const t = low(a.textContent || a.getAttribute('aria-label') || a.getAttribute('title') || '');
    if (/^tel:/i.test(h)) { hit(/^tel:\+?(7|8)?-?\(?800/.test(h.replace(/[\s-]/g, '')) ? 'phone_8800' : 'phone', a); continue; }
    if (/^mailto:/i.test(h)) { hit('email', a); continue; }
    // Telegram: канал (t.me/s/..., приглашение, подпись про канал) или контакт для связи (прочие t.me, tg:) - эвристика,
    // окончательно различает наблюдатель по кадру
    if (/(^|\/\/)(t|telegram)\.me\/|^tg:/i.test(h)) { hit(/\/\/(t|telegram)\.me\/(s\/|joinchat|\+)/i.test(h) || /канал|подпис|новост|channel/.test(t) ? 'social_telegram' : 'messenger_telegram', a); continue; }
    const m = MSG.find(([re]) => re.test(h)); if (m) { hit(m[1], a); continue; }
    const s = SOC.find(([re]) => re.test(h)); if (s) { hit(s[1], a); continue; }
    if (REV.test(h)) { hit('review_platforms', a); continue; }
    if (APP.test(h)) { hit('app_links', a); continue; }
    const hl = h.toLowerCase();
    if (/cart|basket|korzin/.test(hl) || /^корзин/.test(t)) hit('cart', a);
    else if (/wish|favorit|izbran/.test(hl) || /^избранн/.test(t)) hit('favorites', a);
    else if (/compare|sravn/.test(hl) || /^сравн/.test(t)) hit('compare', a);
    else if (/\/(login|auth|signin|account|cabinet|lk|personal|my)(\/|$|\?)/.test(hl) || /^(войти|вход|личный кабинет|кабинет)$/.test(t)) hit('account', a);
    const lg = LEGAL.find(([rt, rh]) => rt.test(t) || rh.test(hl)); if (lg) { hit(lg[2], a); continue; }
    if (/^карта сайта$|sitemap/.test(t + ' ' + (/sitemap/.test(hl) ? 'sitemap' : ''))) { hit('sitemap_link', a); continue; }
    if (t && t.length <= 60) { const p = pat.find(x => x.re.test(t)); if (p) hit(p.id, a); }
  }
  // формы и поля
  for (const f of doc.querySelectorAll('form')) {
    const inputs = [...f.querySelectorAll('input, textarea, select')].filter(i => !/^(hidden|submit|button|checkbox|radio)$/i.test(i.getAttribute('type') || ''));
    if (!inputs.length) continue;
    const kinds = inputs.map(i => (i.getAttribute('type') || i.tagName).toLowerCase() + ' ' + String(i.getAttribute('name') || '').toLowerCase() + ' ' + String(i.getAttribute('placeholder') || '').toLowerCase());
    if (f.getAttribute('role') === 'search' || kinds.some(k => /^search|\b(q|s|search|query)\b|поиск|найти/.test(k)) && inputs.length <= 2) { hit('search', f); continue; }
    if (inputs.length === 1 && /email|почт/.test(kinds[0])) { hit('subscribe', f); continue; }
    hit(zoneOf(f) === 'footer' ? 'footer_form' : 'lead_form', f);
  }
  for (const i of doc.querySelectorAll('input[type=search], input[name=q], input[name=search], input[name=query]')) if (!i.closest('form')) hit('search', i);
  // крошки, рейтинг, цены
  for (const el of doc.querySelectorAll('[class*=breadcrumb i], [id*=breadcrumb i], nav[aria-label*=breadcrumb i], [itemtype*=BreadcrumbList]')) { hit('breadcrumbs', el); break; }
  for (const el of doc.querySelectorAll('[itemprop=ratingValue], [class*=rating i], [class*=stars i]')) { if (sp(el.textContent).length < 60) { hit('rating', el); break; } }
  // iframe карт и видео, видео, чат-виджеты
  for (const f of doc.querySelectorAll('iframe[src], iframe[data-src]')) {
    const src = String(f.getAttribute('src') || f.getAttribute('data-src') || '');
    if (/yandex\.[a-z]+\/map-widget|api-maps\.yandex|google\.[a-z.]+\/maps|maps\.google|2gis\.[a-z]+\/|widgets\.2gis/i.test(src)) hit('map', f, { href: src });
    else if (/youtube\.com\/embed|youtube-nocookie|rutube\.ru\/play|vk\.com\/video_ext|vkvideo|player\.vimeo|dzen\.ru\/embed/i.test(src)) hit('video', f, { href: src });
  }
  for (const el of doc.querySelectorAll('[class*=ymaps i], [id*=map i][class*=map i]')) { hit('map', el); break; }
  for (const v of doc.querySelectorAll('video')) { hit('video', v); break; }
  const CHAT = /calltouch|jivo|jivosite|livetex|carrotquest|chatra|tawk\.to|talk-me|verbox|usedesk|webim|b24-widget|bitrix24\.[a-z]+\/b\d|crm\/site_button|envybox|redconnect|leadback|callbackhunter|callbackkiller|cleversite|streamwood|marquiz|getcourse/i;
  const CB = /calltouch|envybox|callbackhunter|callbackkiller|redconnect|leadback|cleversite/i;
  for (const s of doc.querySelectorAll('script[src], iframe[src], link[href]')) {
    const src = String(s.getAttribute('src') || s.getAttribute('href') || '');
    if (!CHAT.test(src)) continue;
    if (CB.test(src)) hit('callback', s, { text: 'виджет обратного звонка', href: src, zone: 'fixed' });
    else if (/marquiz/i.test(src)) hit('quiz', s, { text: 'виджет квиза', href: src, zone: 'body' });
    else hit('chat', s, { text: 'виджет чата', href: src, zone: 'fixed' });
  }
  for (const el of doc.querySelectorAll('[class*=jivo i], [id*=jivo i], [class*=chat-widget i], [id*=chat-widget i], [class*=b24-widget i]')) { hit('chat', el); break; }
  // кнопки и элементы по классу или подписи
  const clickables = [...doc.querySelectorAll('button, a, [role=button], [class*=btn i], [class*=button i]')].slice(0, 3000);
  for (const el of clickables) {
    const t = low(el.textContent || el.getAttribute('aria-label') || el.getAttribute('title') || '');
    const c = cls(el);
    if (t.length > 60) continue;
    if (/(^|\b)(обратный звонок|заказать звонок|перезвоните|позвоните мне)/.test(t) || /callback|call-back|recall/.test(c)) hit('callback', el);
    else if (/(^|[-_ ])(up|totop|to-top|scroll-top|scrolltop|back-to-top|scroll-up)([-_ ]|$)/.test(c) || /^(наверх|вверх)$/.test(t)) hit('up_button', el);
    else if (/burger|hamburger|menu-toggle|menu__toggle|nav-toggle|mobile-menu-btn|menu-btn/.test(c)) hit('burger', el);
    else if (/^(купить|в корзину|добавить в корзину)$/.test(t)) hit('buy_button', el);
  }
  // куки-баннер
  for (const el of doc.querySelectorAll('[class*=cookie i], [id*=cookie i]')) { if (/cookie|куки/i.test(el.textContent || '') && sp(el.textContent).length < 600) { hit('cookie_banner', el); break; } }
  // логотип и меню
  const logo = doc.querySelector('[class*=logo i] img, img[class*=logo i], a[class*=logo i], [id*=logo i], img[alt*=logo i], img[src*=logo i]');
  if (logo) hit('logo', logo);
  if (footer) { const fl = footer.querySelector('[class*=logo i], img[src*=logo i], img[alt*=logo i]'); if (fl) hit('logo', fl); }
  const navs = [...doc.querySelectorAll('nav, [class*=menu i], [role=navigation]')];
  const mainNav = navs.find(n => header && header.contains(n) && n.querySelectorAll('a[href]').length >= 3);
  if (mainNav) hit('menu_main', mainNav, { text: [...mainNav.querySelectorAll('a')].slice(0, 6).map(a => sp(a.textContent)).filter(Boolean).join(' | ') });
  const footNav = navs.find(n => footer && footer.contains(n) && n.querySelectorAll('a[href]').length >= 3);
  if (footNav) hit('footer_menu', footNav, { text: [...footNav.querySelectorAll('a')].slice(0, 6).map(a => sp(a.textContent)).filter(Boolean).join(' | ') });
  // значки оплаты
  for (const img of doc.querySelectorAll('img[src], img[alt], svg[class]')) {
    const s = low((img.getAttribute('alt') || '') + ' ' + (img.getAttribute('src') || '') + ' ' + (img.getAttribute('class') || ''));
    if (/\b(visa|mastercard|maestro|mir-?pay|mir\b|сбп|sbp|юmoney|yoomoney|tinkoff-pay|апл пэй|apple-?pay|google-?pay)\b|(^|[\/_-])mir[._-]|платежн/.test(s)) { hit('payment_icons', img); break; }
  }
  // текстовые детекторы: реквизиты, часы, копирайт, цены, город
  const TXT = [
    [/(^|[^А-Яа-я])(ИНН|ОГРН|ОГРНИП|КПП)\s*:?\s*\d{9,15}/, 'requisites'],
    [/(^|\s)(ООО|ОАО|ПАО|АО|ИП|ЗАО)\s+[«"'A-ZА-Я]/, 'legal_name'],
    [/(\d{1,2}[:.]\d{2}\s*[-\u2013\u2014]\s*\d{1,2}[:.]\d{2})|круглосуточно|без выходных|(пн|понедельник)\s*[-\u2013\u2014]\s*(пт|сб|вс)/i, 'hours'],
    [/©|\(c\)\s*\d{4}|все права защищены/i, 'copyright'],
    [/(\d[\d\s ]{0,9}\s?(₽|руб\.?|р\.)(\s|$|\/))|(\bот\s\d[\d\s ]{2,9}\s?(₽|руб|р\.))/i, 'price'],
  ];
  const walker = doc.createTreeWalker(body, 4);
  let tn, scanned = 0;
  const textSeen = {};
  while ((tn = walker.nextNode()) && scanned < 20000) {
    scanned++;
    const t = tn.nodeValue;
    if (!t || t.trim().length < 2) continue;
    const el = tn.parentElement;
    if (!el || /^(script|style|noscript|template)$/.test(tagOf(el))) continue;
    for (const [re, id] of TXT) {
      if (!re.test(t)) continue;
      const k = zoneOf(el) + ':' + id;
      if (textSeen[k]) continue;
      textSeen[k] = 1;
      hit(id, el, { text: sp(t).slice(0, 80) });
    }
  }
  // Schema.org: JSON-LD и microdata
  const types = new Set();
  const addType = t => { for (const x of [].concat(t || [])) if (typeof x === 'string' && x) types.add(x.replace(/^https?:\/\/schema\.org\//, '')); };
  const walkLd = (j, d) => { if (!j || d > 6) return; if (Array.isArray(j)) { j.forEach(x => walkLd(x, d + 1)); return; } if (typeof j !== 'object') return; addType(j['@type']); for (const k of ['@graph', 'mainEntity', 'itemListElement', 'offers', 'aggregateRating', 'review', 'publisher', 'provider']) if (j[k]) walkLd(j[k], d + 1); };
  for (const s of doc.querySelectorAll('script[type="application/ld+json"]')) { try { walkLd(JSON.parse(s.textContent), 0); } catch (e) { types.add('?'); } }
  for (const el of doc.querySelectorAll('[itemtype]')) addType(String(el.getAttribute('itemtype')).split(/\s+/).map(x => x.replace(/^https?:\/\/schema\.org\//, '')));
  const schema = [...types].slice(0, 30);
  const SCH = [[/^(Organization|Corporation)$/, 'schema_organization'], [/LocalBusiness|Store|Shop$|Service$|Agency/, 'schema_localbusiness'], [/^BreadcrumbList$/, 'schema_breadcrumbs'], [/^(Product|Offer|AggregateOffer)$/, 'schema_product'], [/^FAQPage$/, 'schema_faq'], [/^(AggregateRating|Review)$/, 'schema_rating']];
  for (const t of schema) { const m = SCH.find(([re]) => re.test(t)); if (m && !seen['body:' + m[1]]) { const e = { id: m[1], evidence: { selector: 'schema.org', text: t, href: '' } }; zones.body.push(e); seen['body:' + m[1]] = e; } }
  // контур секций тела
  const outline = [];
  const MAXO = o.maxOutline || 120;
  const skipZone = el => (header && header.contains(el)) || (footer && footer.contains(el)) || fixed.some(f => f.contains(el));
  let cur = null;
  const startSection = (level, heading, el) => {
    if (outline.length >= MAXO) { cur = null; return; }
    cur = { level, heading: heading.slice(0, 120), text80: '', y: layout && el ? absTop(el) : null, tile: null, has: [] };
    outline.push(cur);
  };
  const has = h => { if (cur && !cur.has.includes(h)) cur.has.push(h); };
  const isTitle = el => /(^|[-_ ])(title|heading|caption)([-_ ]|$)/.test(cls(el)) && el.children.length <= 2 && sp(el.textContent).length >= 3 && sp(el.textContent).length <= 120 && !el.querySelector('p, li, h1, h2, h3, h4');
  const fewHeadings = body.querySelectorAll('h1, h2, h3').length < 3;
  const walk = n => {
    if (n.nodeType === 3) { if (cur && cur.text80.length < 80) cur.text80 = sp(cur.text80 + ' ' + n.nodeValue).slice(0, 80); else if (!cur && outline.length === 0 && sp(n.nodeValue)) { startSection(0, '(до первого заголовка)', n.parentElement); cur.text80 = sp(n.nodeValue).slice(0, 80); } return; }
    if (n.nodeType !== 1) return;
    const t = tagOf(n);
    if (/^(script|style|noscript|template|svg|head)$/.test(t)) return;
    if (n !== body && skipZone(n)) return;
    if (/^nav$/.test(t)) return;
    if (hiddenSelf(n)) return;
    const hm = /^h([1-3])$/.exec(t);
    if (hm) { const h = sp(n.textContent); if (h) startSection(Number(hm[1]), h, n); return; }
    if (fewHeadings && isTitle(n)) { startSection(3, sp(n.textContent), n); return; }
    if (t === 'table') has('table');
    else if ((t === 'ul' || t === 'ol') && [...n.children].filter(c => tagOf(c) === 'li').length >= 3) has('list');
    else if (t === 'form') has('form');
    else if (t === 'img' && (!layout || rectOf(n).width >= 40)) has('img');
    else if (t === 'video') has('video');
    else if (t === 'iframe') { const s = String(n.getAttribute('src') || ''); if (/map/i.test(s)) has('map'); else if (/youtube|rutube|vimeo|video/i.test(s)) has('video'); }
    for (const c of n.childNodes) walk(c);
  };
  walk(body);
  const h1 = doc.querySelector('h1');
  return { zones, outline, schema, page: { title: sp(doc.title).slice(0, 160), h1: h1 ? sp(h1.textContent).slice(0, 160) : '', height: layout ? docH : null, layout, containers: { header: header ? pathOf(header) : null, footer: footer ? pathOf(footer) : null, fixed: fixed.slice(0, 10).map(pathOf) } } };
}

// Выражение для Runtime.evaluate (CDP) и window.eval (jsdom).
export const scanExpression = (opts = {}) => `(${kfScanPage.toString()})(${JSON.stringify(opts)})`;

const escRe = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Подписи ссылок на страницы из словаря: элементы вида page_link (и nav с page_match) - name и synonyms, без коротких
// латинских. Регулярка - начало подписи (подпись ссылки в шапке и подвале короткая).
export function linkPatterns(dict) {
  const out = [];
  for (const e of (dict && dict.elements) || []) {
    if (e.kind !== 'page_link') continue;
    const words = [e.name, ...(e.synonyms || [])].map(s => String(s).toLowerCase().replace(/\u0451/g, 'е').replace(/\s*\(.*\)$/, '').trim()).filter(s => s.length >= 4);
    if (words.length) out.push({ id: e.id, re: `^(${[...new Set(words)].map(escRe).join('|')})` });
  }
  return out;
}

export function readDict(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\ufeff/, '')); } catch { return null; }
}

// Статический html через jsdom: {kf} или null (нет jsdom). Скрипты страницы не исполняются.
export async function scanHtml(html, { url = 'https://example.invalid/', dict = null, links = null } = {}) {
  const jsdom = await loadDep('jsdom');
  if (!jsdom || !jsdom.JSDOM) return null;
  const dom = new jsdom.JSDOM(String(html), { url, runScripts: 'outside-only', pretendToBeVisual: true });
  try { return dom.window.eval(scanExpression({ links: links || linkPatterns(dict) })); } finally { dom.window.close(); }
}
