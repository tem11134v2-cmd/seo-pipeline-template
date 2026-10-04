// Контакты компании: единый формат телефонов, ссылки tel:/мессенджеров, каналы company.channels.
// Модуль без побочных действий: его зовут import-project.mjs (контактные факты F901-F907, company) и сборщик прототипа.
//
// Формат российского телефона: «+7 (XXX) XXX-XX-XX» (10-11 цифр: 8XXXXXXXXXX, 7XXXXXXXXXX, +7..., XXXXXXXXXX с кодом 3/4/8/9);
// иные номера (другие страны, добавочные, неразборные) остаются как в источнике. Сравнение телефонов - по цифрам (phoneDigits).
// Каналы - объект { "<ключ>": { label, value, href, fact? } }; href - полный URL со схемой или ''. В старых данных значение
// канала - строка-URL: readChannel() читает обе формы. Названия и адреса каналов - только в словаре CHANNELS ниже.

// Словарь каналов: ключ, подпись, как канал называют в label факта, хост ссылки, ссылка по номеру (только WhatsApp и
// Telegram), ссылка по нику (@name). Новый канал - одна строка словаря.
export const CHANNELS = [
  { key: 'whatsapp', label: 'WhatsApp', names: /whats\s?app|вотсап|ватсап|вацап/i, host: /(^|\.)(wa\.me|whatsapp\.com)$/i, byPhone: d => `https://wa.me/${d}` },
  { key: 'telegram', label: 'Telegram', names: /telegram|телеграм/i, host: /(^|\.)(t\.me|telegram\.me)$/i, byPhone: d => `https://t.me/+${d}`, byNick: n => `https://t.me/${n}` },
  { key: 'max', label: 'MAX', names: /(^|[^a-zа-я])(max|макс)([^a-zа-я]|$)/i, host: /(^|\.)max\.ru$/i },
  { key: 'viber', label: 'Viber', names: /viber|вайбер/i, host: /(^|\.)viber\.com$/i },
  { key: 'vk', label: 'ВКонтакте', names: /вконтакте|(^|[^a-z])vk([^a-z]|$)/i, host: /(^|\.)(vk\.com|vk\.ru)$/i },
  { key: 'youtube', label: 'YouTube', names: /youtube|ютуб/i, host: /(^|\.)(youtube\.com|youtu\.be)$/i },
  { key: 'instagram', label: 'Instagram', names: /instagram|инстаграм/i, host: /(^|\.)instagram\.com$/i },
  { key: 'dzen', label: 'Дзен', names: /(^|[^а-я])дзен([^а-я]|$)|dzen/i, host: /(^|\.)dzen\.ru$/i },
  { key: 'ok', label: 'Одноклассники', names: /одноклассник/i, host: /(^|\.)ok\.ru$/i },
];
const CH = Object.fromEntries(CHANNELS.map(c => [c.key, c]));

const str = s => (s == null ? '' : String(s)).trim();

// Цифры телефона для сравнения: российский номер - 11 цифр с 7 в начале, остальные - как есть.
export function phoneDigits(s) {
  const d = str(s).replace(/\D/g, '');
  if (d.length === 11 && (d[0] === '7' || d[0] === '8')) return '7' + d.slice(1);
  if (d.length === 10 && /^[3489]/.test(d)) return '7' + d;
  return d;
}

// Строка целиком - один российский номер: 8/7/+7 и 10 цифр в скобках, пробелах, дефисах или точках.
const PHONE_RU = /^(?:\+\s?7|8|7)?[\s\u00a0(.-]*(\d{3})[\s\u00a0).-]*(\d{3})[\s\u00a0.-]*(\d{2})[\s\u00a0.-]*(\d{2})$/;
export function normalizePhoneRu(s) {
  const t = str(s).replace(/[\u2012-\u2015\u2212]/g, '-');
  if (!PHONE_RU.test(t)) return null;
  const d = phoneDigits(t);
  if (d.length !== 11 || d[0] !== '7') return null;
  return `+7 (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7, 9)}-${d.slice(9, 11)}`;
}
// Формат для company.phones и wording: российский - «+7 (XXX) XXX-XX-XX», иной - как в источнике.
export function phoneFormat(s) { return normalizePhoneRu(s) || str(s); }

// Российские номера внутри текста (с 8, 7 или +7 впереди - так не ловятся ИНН, ОГРН и прочие длинные числа).
const PHONE_IN_TEXT = /(?<![\d+])(?:\+\s?7|8|7)[\s\u00a0(.-]*\d{3}[\s\u00a0).-]*\d{3}[\s\u00a0.-]*\d{2}[\s\u00a0.-]*\d{2}(?!\d)/g;
export function phonesInText(text) { return (str(text).replace(/[\u2012-\u2015\u2212]/g, '-').match(PHONE_IN_TEXT) || []).map(p => p.trim()); }
// Все российские номера текста - в едином формате; остальной текст не меняется.
export function formatPhonesInText(text) {
  return str(text).replace(/[\u2012-\u2015\u2212]/g, '-').replace(PHONE_IN_TEXT, m => normalizePhoneRu(m.trim()) || m);
}

const intl = s => { const t = str(s); const d = t.replace(/\D/g, ''); return /^\+/.test(t) && d.length >= 8 && d.length <= 15 ? d : ''; };
export function telHref(s) {
  const ru = normalizePhoneRu(s);
  if (ru) return `tel:+${phoneDigits(ru)}`;
  const d = intl(s);
  return d ? `tel:+${d}` : '';
}
export function waHref(s) {
  const ru = normalizePhoneRu(s);
  if (ru) return CH.whatsapp.byPhone(phoneDigits(ru));
  const d = intl(s);
  return d ? CH.whatsapp.byPhone(d) : '';
}
export function tgHref(s) {
  const t = str(s);
  const nick = t.match(/^@([a-z0-9_]{4,32})$/i) || t.match(/^(?:https?:\/\/)?(?:t|telegram)\.me\/([a-z0-9_+]{4,40})\/?$/i);
  if (nick) return nick[1].startsWith('+') ? `https://t.me/${nick[1]}` : CH.telegram.byNick(nick[1]);
  const ru = normalizePhoneRu(t);
  if (ru) return CH.telegram.byPhone(phoneDigits(ru));
  const d = intl(t);
  return d ? CH.telegram.byPhone(d) : '';
}

// Ключ канала по URL (по хосту) или ''.
export function channelOfUrl(u) {
  let host = '';
  try { host = new URL(/^https?:\/\//i.test(str(u)) ? str(u) : `https://${str(u)}`).hostname.replace(/^www\./, ''); } catch { return ''; }
  const c = CHANNELS.find(x => x.host.test(host));
  return c ? c.key : '';
}
const URL_RE = /https?:\/\/[^\s;,)«»"'<>]+|(?<![@\w.-])(?:wa\.me|t\.me|vk\.com|vk\.ru|max\.ru|youtube\.com|youtu\.be|instagram\.com|dzen\.ru|ok\.ru)\/[^\s;,)«»"'<>]+/gi;
export function channelUrls(text) {
  return (str(text).match(URL_RE) || []).map(u => (/^https?:\/\//i.test(u) ? u : `https://${u}`).replace(/[.]+$/, '')).filter(u => channelOfUrl(u));
}

// Значение канала в любой форме (строка-URL старых данных или объект) -> { label, value, href, fact? }.
export function readChannel(key, v) {
  const c = CH[key];
  if (typeof v === 'string') {
    const href = /^https?:\/\//i.test(v) ? v : channelOfUrl(v) ? `https://${v.replace(/^\/+/, '')}` : '';
    return { label: c ? c.label : key, value: v, href };
  }
  if (!v || typeof v !== 'object') return null;
  const out = { label: str(v.label) || (c ? c.label : key), value: str(v.value) || str(v.href), href: /^https?:\/\//i.test(str(v.href)) ? str(v.href) : '' };
  if (v.fact) out.fact = v.fact;
  return out;
}

// Ссылка канала по значению факта: URL этого канала в тексте, иначе ник (Telegram), иначе номер (WhatsApp, Telegram).
function hrefFor(c, value) {
  const url = channelUrls(value).find(u => channelOfUrl(u) === c.key);
  if (url) return url;
  if (c.byNick) { const n = str(value).match(/(^|\s)@([a-z0-9_]{4,32})(?![a-z0-9_])/i); if (n) return c.byNick(n[2]); }
  if (c.byPhone) {
    const p = phonesInText(value)[0] || (normalizePhoneRu(value) ? value : '');
    if (p) return c.byPhone(phoneDigits(p));
  }
  return '';
}

// Каналы компании: прежние company.channels (строки или объекты), ссылки из фактов-контактов и факты-контакты, в label
// которых назван канал. Ссылка по номеру - только из факта, который сам назван каналом: главный телефон в мессенджер
// не подставляется. Канал с непустой ссылкой не перезаписывается.
// Канал со старого сайта (в company.channels без поля fact: снимок сайта, строка-URL) до подтверждения фактом анализа
// или оператора не публикуется: splitChannels() отделяет такие каналы, import-project.mjs уносит их строкой gaps
// «канал со старого сайта: <подпись> <ссылка> - публиковать?» (вопрос заказчику в отчете).
export const CHANNEL_GAP = 'канал со старого сайта: ';
export function channelGapLine(key, ch) {
  const c = CH[key];
  const label = str(ch && ch.label) || (c ? c.label : key);
  const link = str(ch && (ch.href || ch.value));
  return `${CHANNEL_GAP}${label}${link ? ` ${link}` : ''} - публиковать?`;
}
// Ключ канала строки gaps о канале со старого сайта (по подписи из словаря, иначе по хосту ссылки) или ''.
export function channelOfGap(line) {
  const s = str(line);
  if (!s.startsWith(CHANNEL_GAP)) return '';
  const rest = s.slice(CHANNEL_GAP.length);
  const c = CHANNELS.find(x => rest === x.label || rest.startsWith(`${x.label} `));
  if (c) return c.key;
  const u = channelUrls(rest)[0];
  return u ? channelOfUrl(u) : '';
}
// { confirmed, fromSite }: confirmed - каналы из фактов (buildChannels без прежних company.channels); fromSite - прежние
// каналы без поля fact, которых факты не дают (или дают без ссылки, а у прежнего ссылка есть).
export function splitChannels(facts, company) {
  const confirmed = buildChannels(facts, {});
  const fromSite = {};
  for (const [k, v] of Object.entries((company && company.channels) || {})) {
    const r = readChannel(k, v);
    if (!r || r.fact) continue;
    if (confirmed[k] && (confirmed[k].href || !r.href)) continue;
    fromSite[k] = r;
  }
  return { confirmed, fromSite };
}
// Строки gaps о каналах со старого сайта: снимаются строки каналов, которые теперь дает факт со ссылкой, дописываются
// новые (по одной на канал). Возвращает новый массив gaps.
export function syncChannelGaps(gaps, fromSite, confirmed) {
  const out = [];
  const have = new Set();
  for (const g of gaps || []) {
    const k = channelOfGap(g);
    if (k && confirmed[k] && confirmed[k].href) continue;
    if (k) { if (have.has(k)) continue; have.add(k); }
    out.push(g);
  }
  for (const [k, r] of Object.entries(fromSite || {})) {
    const line = channelGapLine(k, r);
    if (have.has(k) || out.includes(line)) continue;
    out.push(line);
    have.add(k);
  }
  return out;
}
export function buildChannels(facts, company) {
  const list = Array.isArray(facts) ? facts : (facts && Array.isArray(facts.facts) ? facts.facts : []);
  const out = {};
  for (const [k, v] of Object.entries((company && company.channels) || {})) { const r = readChannel(k, v); if (r) out[k] = r; }
  const put = (key, rec) => { if (!out[key] || (!out[key].href && rec.href)) out[key] = { ...(out[key] || {}), ...rec }; };
  for (const f of list) {
    if (!f || f.kind !== 'contact' || f.publish === 'no') continue;
    const text = `${str(f.value)} ${str(f.source_quote)}`;
    for (const u of channelUrls(text)) { const key = channelOfUrl(u); put(key, { label: CH[key].label, value: u, href: u, fact: f.id }); }
    for (const c of CHANNELS) {
      if (!c.names.test(str(f.label))) continue;
      put(c.key, { label: c.label, value: str(f.value), href: hrefFor(c, f.value), fact: f.id });
    }
  }
  return out;
}
