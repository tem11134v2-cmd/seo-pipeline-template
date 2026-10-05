// Домены конкурентов: одна нормализация для импорта анализа (import-project.mjs), отбора (rank-competitors.mjs) и
// верификатора. Канон - хост в нижнем регистре, без протокола, www, порта, пути и точки в конце, в ASCII (кириллический
// домен - punycode xn--), как в work/competitors/seed.json; поддомены не схлопываются, кроме www. Юникод-форма
// (domainUnicode) - для Keys.so (по punycode он отвечает «не найден») и для таблицы заказчику.
// Модуль без побочных эффектов: только функции, CLI нет.
import { domainToASCII, domainToUnicode } from 'node:url';
import { normalizeText } from './lib.mjs';

const T = s => (typeof s === 'string' ? normalizeText(s) : typeof s === 'number' ? String(s) : '');
const len = s => Array.from(s || '').length;
export const DOMAIN_RE = /^(?:[a-z0-9-]+\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})$/;

// Хост из строки: URL, «//host», «host/path», «host:port», «www.host.», в любом регистре и в кириллице -> канон или ''.
export function normDomain(s) {
  let h = T(String(s ?? '')).toLowerCase();
  if (!h) return '';
  h = h.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').replace(/^\/\//, '');
  h = h.split(/[/?#\s]/)[0].replace(/^[^@]*@/, '').replace(/:\d*$/, '').replace(/\.+$/, '');
  let ascii = '';
  try { ascii = domainToASCII(h); } catch { ascii = ''; }
  ascii = ascii.replace(/^www\./, '');
  return DOMAIN_RE.test(ascii) ? ascii : '';
}

// Юникод-форма канона (для Keys.so и таблицы); не разбирается - канон как есть.
export function domainUnicode(d) {
  const c = normDomain(d) || T(String(d ?? '')).toLowerCase();
  let u = '';
  try { u = domainToUnicode(c); } catch { u = ''; }
  return u || c;
}

// d совпадает с base или его поддомен (оба - каноны).
export const sameOrSub = (d, base) => !!d && !!base && (d === base || d.endsWith('.' + base));
// Строгий поддомен.
export const isSub = (d, base) => !!d && !!base && d !== base && d.endsWith('.' + base);

// Строка списка конкурентов анализа -> { domain (ASCII, punycode для кириллицы), name, raw } или null.
// Домен - доменоподобный токен строки: из URL (путь не разбирается), латинская зона (не расширение файла) или
// кириллическая из списка зон, каждая метка не короче 2 знаков. Токенов несколько - берется написанный строчными
// (формат анализа «домен - имя (пометки)»), иначе первый. Остаток строки без пометок в скобках - name.
const FILE_EXT = /^(html?|php|aspx?|jsp|pdf|jpe?g|png|gif|svg|webp|js|css|xml|txt|docx?|xlsx?|zip|rar)$/i;
const CYR_ZONES = /^(рф|рус|москва|онлайн|сайт|орг|ком|дети)$/;
const DOMAIN_TOKEN = /(?<![\p{L}\p{N}@._-])(?:www\.)?((?:[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?\.)+(?:[\p{L}]{2,63}|xn--[a-z0-9-]{2,59}))(?![\p{L}\p{N}_-]|\.[\p{L}\p{N}])/giu;
export function domainOf(tok) {
  const t = String(tok || '').replace(/^www\./i, '');
  const labels = t.split('.');
  const zone = labels[labels.length - 1].toLowerCase();
  const cyr = /[а-я]/i.test(t);
  if (cyr) { if (!CYR_ZONES.test(zone) || labels.some(l => len(l) < 2) || /[a-z]/i.test(t)) return ''; }
  else if (!/^([a-z]{2,63}|xn--[a-z0-9-]{2,59})$/i.test(zone) || FILE_EXT.test(zone)) return '';
  return normDomain(t);
}
export function parseCompetitor(line) {
  const src = T(line);
  const cands = [];
  let rest = src;
  for (const m of src.matchAll(/https?:\/\/[^\s;,()«»<>]+/gi)) {
    let host = '';
    try { host = new URL(m[0]).hostname; } catch { host = ''; }
    const d = host && domainOf(host);
    if (d) cands.push({ written: host, domain: d, text: m[0] });
    rest = rest.replace(m[0], ' ');
  }
  for (const m of rest.matchAll(DOMAIN_TOKEN)) {
    const d = domainOf(m[1]);
    if (d) cands.push({ written: m[1], domain: d, text: m[0] });
  }
  if (!cands.length) return null;
  const pickC = cands.find(c => c.written === c.written.toLowerCase()) || cands[0];
  const name = src.replace(pickC.text, ' ').replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').replace(/^[\s\-:|,;/]+|[\s\-:|,;/]+$/g, '').trim();
  const uni = domainUnicode(pickC.domain);
  const punny = uni !== pickC.domain;
  const nm = punny ? (name ? `${name} (${uni})` : uni) : name;
  return { domain: pickC.domain, ...(nm ? { name: nm } : {}), raw: src };
}
