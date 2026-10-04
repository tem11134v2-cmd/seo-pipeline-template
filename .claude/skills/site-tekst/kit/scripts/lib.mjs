// Общие функции для скриптов пайплайна. Node 18+. Запуск из корня папки проекта.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const ROOT = process.cwd();
export const P = (...parts) => path.join(ROOT, ...parts);

export function exists(p) { return fs.existsSync(p); }
export function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }
export function writeJson(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}
export function readText(p) { return fs.readFileSync(p, 'utf8'); }
export function writeText(p, s) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, s, 'utf8');
}
export function listFiles(dir, ext) {
  if (!exists(dir)) return [];
  return fs.readdirSync(dir).filter(f => !ext || f.endsWith(ext)).map(f => path.join(dir, f));
}
export function walk(dir, ext, acc = []) {
  if (!exists(dir)) return acc;
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) walk(p, ext, acc);
    else if (!ext || p.endsWith(ext)) acc.push(p);
  }
  return acc;
}
export function nowIso() { return new Date().toISOString().slice(0, 19).replace('T', ' '); }

export function loadConfig() { return readJson(P('config', 'project.json')); }
export function loadSchema(name) { return readJson(P('schemas', `${name}.schema.json`)); }

// ---------- регулярки с кириллической границей слова ----------
// Граница слова в JS-регулярках знает только [A-Za-z0-9_], перед кириллицей ее нет.
// B - граница слова через lookaround для кириллицы и латиницы. Буква е с точками в класс не входит:
// она запрещена house style (blocker house.yo), поэтому на тексты, где она есть, граница не рассчитана.
export const B = '(?:(?<![а-яa-z0-9])(?=[а-яa-z0-9])|(?<=[а-яa-z0-9])(?![а-яa-z0-9]))';
export function esc(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
// Паттерн из rules/lint.json: последовательность «обратная косая + b» заменяется на B. flags по умолчанию 'i'.
export const cyr = (p, flags = 'i') => new RegExp(String(p).replace(/\\b/g, B), flags);
// Клише и запреты ловим по основам слов: «индивидуальный подход» -> «индивидуальн[а-яa-z]* подход[а-яa-z]*»
export const stemRe = phrase => new RegExp(B + String(phrase).trim().split(/\s+/).map(w => (w.length > 4 ? esc(w.slice(0, -2)) + '[а-яa-z]*' : esc(w))).join('\\s+'), 'i');

// ---------- служебная пометка вместо значения факта ----------
// Правило одно - SERVICE_NOTE в .claude/scripts/site/_contract.mjs проекта (им же пользуются verify-data.mjs и
// apply-answers.mjs анализа). serviceNoteRule() ищет этот модуль вверх от переданных папок (папка project.json,
// папка запуска) и берет правило оттуда. SERVICE_NOTE_COPY - только для kit вне проекта (временные папки тестов);
// что копия совпадает с правилом анализа, сверяет набор tests/site-tekst.
export const SERVICE_NOTE_COPY = /в этой версии|не разворачива|уточн[а-я]* (у заказчика|у клиента|позже|потом)|запрос[а-я]* (ответ|позже)|ответ позже|нет данных|данных нет|(^|[^a-z])(todo|tbd|tba)([^a-z]|$)|\?\?|\[(заполнить|уточнить|нужно)|см\. выше/i;
export async function serviceNoteRule(...starts) {
  const seen = new Set();
  for (const s of starts.filter(Boolean)) {
    for (let d = path.resolve(s); !seen.has(d); d = path.dirname(d)) {
      seen.add(d);
      const f = path.join(d, '.claude', 'scripts', 'site', '_contract.mjs');
      if (exists(f)) {
        try {
          const m = await import(pathToFileURL(f).href);
          if (m.SERVICE_NOTE instanceof RegExp) return { re: m.SERVICE_NOTE, from: f };
        } catch { /* модуль не грузится - ищем дальше, в конце копия */ }
      }
    }
  }
  return { re: SERVICE_NOTE_COPY, from: '' };
}

// ---------- нормализация текста (house style) ----------
export function normalizeText(s) {
  if (typeof s !== 'string') return s;
  return s
    .replace(/\u0451/g, 'е').replace(/\u0401/g, 'Е')
    .replace(/[\u2014\u2013]/g, '-')
    .replace(/ /g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ +\n/g, '\n')
    .trim();
}
export function normalizeDeep(obj, stats = { changed: 0 }) {
  if (typeof obj === 'string') {
    const n = normalizeText(obj);
    if (n !== obj) stats.changed++;
    return n;
  }
  if (Array.isArray(obj)) return obj.map(x => normalizeDeep(x, stats));
  if (obj && typeof obj === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) out[k] = normalizeDeep(v, stats);
    return out;
  }
  return obj;
}
export function charsNoSpaces(s) { return (s || '').replace(/\s/g, '').length; }
// Числа текста для сверки с фактами: «12 400», «1,5», «2012», «10-35» -> отдельные токены; пробел допустим только как
// разделитель тысяч. Цифра, приклеенная к букве («3D», «1С»), тоже число: утверждение с ней требует факт.
export function digitsOf(s) {
  return (String(s ?? '').match(/\d{1,3}(?:[  ]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?/g) || []).map(x => x.replace(/[  ]/g, '').replace(',', '.')).filter(Boolean);
}
// Опоры факта для нижней границы count: пункты списка внутри факта (wording или value через «;» и «,»), минимум 1.
// Запятая внутри числа («1,5») пункт не делит. Эвристика только вычитает из этого деления части, которые не пункт, и
// никогда не дает больше частей через «,» и «;». Не пункт (условие или уточнение соседней части):
// - придаточное и оговорка: «если ...», «когда ...», «чтобы ...», «кроме ...», «учитывая ...», «при ...» после запятой
//   («вывоз бесплатно, при демонтаже нашими силами»); «при ...» в начале предложения - пункт («При заказе от 3 изделий
//   скидка 10%, от 5 - 15%» - две опоры); часть с « - » («если нужно - укорачиваем») - пункт;
// - «где ...», «который ...» и предложная часть перед ними, если предлог не повторяет предыдущую часть («у изделий, где
//   ...» - уточнение; «в Москве, в Подмосковье, где ...» - пункт «в Подмосковье»);
// - причастный оборот: причастие (-ущ-, -ющ-, -ащ-, -ящ-, -вш-, -анн-, -янн-, -енн-) с зависимым словом сразу за ним
//   (предлог, творительный падеж, наречие из списка) или с «не» перед ним, в любом падеже («изделия, купленные у нас,
//   ...»; «окна, установленные нашими монтажниками, ...»). Без зависимого слова это определение или существительное в
//   списке - пункт («понравившаяся модель», «учащимся», «ванной комнаты», «постоянным клиентам скидка»).
// Оговорка в начале части («при необходимости образец», «по желанию с палладием», «если нужно - X») пункт не снимает.
// Часть после оборота в середине продолжает часть до него, только если та не закончена (нет глагола, « - », «:»,
// наречия-сказуемого) и следующая часть начинается со сказуемого: «размер кольца, заказанного у нас, скорректируем
// бесплатно» - одна опора; «вывоз бесплатно, если демонтаж делаем мы, замер в день заявки» - две. Предложение (точка и
// заглавная буква) - отдельная группа, как «;».
const UNIT_QUAL_RE = /^(?:при\s+(?:необходимости|желании|возможности)|по\s+(?:желанию|запросу)|в\s+случае\s+необходимости|если\s+(?:нужно|надо|необходимо|требуется|хотите|захотите|понадобится|потребуется))(?![а-яё])\s*(?:-\s*)?/i;
const UNIT_SUB_RE = /^(?:если|когда|пока|хотя|чтобы|поскольку|так как|потому что|(?:даже|только|лишь) если|в случае|кроме|за исключением|включая|исключая|не считая|учитывая|при(?!\s+этом(?![а-яё])))(?![а-яё])/i;
const UNIT_REL_RE = /^(?:где|куда|откуда|котор[а-яё]+|чей|чья|чье|чьи)(?![а-яё])/i;
const UNIT_PARTICIPLE_RE = /^[а-яё]{2,}(?:ущ|ющ|ащ|ящ|вш|анн|янн|енн|ённ)(?:ий|ый|ой|ая|яя|ое|ее|ые|ие|ого|его|ому|ему|ым|им|ыми|ими|ую|юю|ых|их|ей)(?:ся|сь)?$/i;
const UNIT_ADJ_RE = /^(?:[а-яё]*ственн|длинн|временн|современн|драгоценн|деревянн|стеклянн|оловянн|странн|иностранн|постоянн|настоящ|следующ|будущ|предыдущ|блестящ|ведущ|текущ|бывш)/i;
const UNIT_PREPS = 'у|в|во|на|по|с|со|для|из|от|до|за|к|ко|через|под|над|без|о|об|обо|про|при|между|перед|после|около|вне|ради';
const UNIT_PREP_RE = new RegExp(`^(?:${UNIT_PREPS})\\s`, 'i');
const UNIT_DEP_WORD_RE = new RegExp(`^(?:${UNIT_PREPS}|нами|вами|ими|мной|мною|[а-яё]+(?:ами|ями|ыми|ими)|заранее|ранее|лично|вручную|специально|отдельно|заново|давно|недавно|уже|только|лишь|сразу|сегодня|вчера)$`, 'i');
const UNIT_VERB_RE = /^[а-яё]{2,}(?:ем|ём|им|ает|яет|еет|ует|юет|ится|ется|ают|яют|уют|еют|ются|ятся|утся|атся|лся|лась|лись|лось|ть|ться)$/i;
const UNIT_PRED_RE = /^(?:всегда|обязательно|бесплатно|можно|нужно|надо|нельзя|тоже|также|сразу|уже|не|ни|еще|сами|сам|сама|само)$/i;
const UNIT_SENT_RE = /(?<=[а-яёА-ЯЁa-zA-Z]{3}|\d|[»")])[.!?]\s+(?=[А-ЯЁA-Z«"])/;
const unitWords = s => String(s || '').toLowerCase().split(/\s+/).map(w => w.replace(/^[^а-яёa-z0-9]+|[^а-яёa-z0-9-]+$/g, '')).filter(Boolean);
function unitParticiple(p) {
  const w = unitWords(p);
  const i = w[0] === 'не' ? 1 : 0;
  return w.length > i + 1 && UNIT_PARTICIPLE_RE.test(w[i]) && !UNIT_ADJ_RE.test(w[i]) && (i === 1 || UNIT_DEP_WORD_RE.test(w[i + 1]));
}
const unitDone = p => / - |:/.test(p) || unitWords(p).some(x => UNIT_VERB_RE.test(x) || UNIT_PRED_RE.test(x));
const unitPredStart = p => { const w = unitWords(p)[0] || ''; return UNIT_VERB_RE.test(w) || UNIT_PRED_RE.test(w); };
export function unitCount(t) {
  const s = String(t || '');
  let n = 0;
  for (const group of s.split(';').flatMap(g => g.split(UNIT_SENT_RE))) {
    const parts = group.split(/,(?!\d)/).map(x => x.trim()).filter(x => /[а-яёa-z]/i.test(x));
    let head = '', open = false; // head - последний пункт группы; open - следующая часть продолжает его
    parts.forEach((part, i) => {
      let p = part;
      const q = p.match(UNIT_QUAL_RE);
      if (q) { p = p.slice(q[0].length).trim(); if (!/[а-яёa-z0-9]/i.test(p)) return; }
      const lead = p.split(/\s/)[0].toLowerCase();
      const sub = !q && UNIT_SUB_RE.test(p) && !(i === 0 && lead === 'при') && !/ - /.test(p);
      const prepRel = !!head && UNIT_PREP_RE.test(p) && UNIT_REL_RE.test(parts[i + 1] || '') && !unitWords(parts[i - 1]).includes(lead);
      if (sub || UNIT_REL_RE.test(p) || unitParticiple(p) || prepRel) {
        if (head && i + 1 < parts.length && !unitDone(head) && unitPredStart(parts[i + 1])) open = true;
        return;
      }
      if (open) { open = false; return; }
      n++; head = p;
    });
  }
  return Math.min(n, s.split(/;|,(?!\d)/).filter(x => /[а-яёa-z]/i.test(x)).length);
}
export function factUnits(f) {
  return Math.max(1, unitCount(f && f.wording), unitCount(f && f.value));
}
export function words(s) { return (s || '').split(/\s+/).filter(Boolean); }
export function splitSentences(s) {
  return (s || '').split(/(?<=[.!?])\s+(?=[А-ЯA-Z«"\d])/).map(x => x.trim()).filter(Boolean);
}
export const PLACEHOLDER_RE = /\[\[[^\]]+\]\]/g;

// ---------- тексты элементов блока ----------
// Возвращает массив {field, text} для всех текстовых полей элемента.
export function elementTexts(el) {
  const out = [];
  const push = (field, text) => { if (typeof text === 'string' && text.length) out.push({ field, text }); };
  switch (el.kind) {
    case 'h1': case 'h2': case 'h3': case 'sub': case 'text': case 'button': case 'note': case 'link':
      push('text', el.text); break;
    case 'bullets': case 'badges': case 'filters': case 'table_row':
      (el.items || []).forEach((t, i) => push(`items[${i}]`, t)); break;
    case 'card':
      push('title', el.title); push('text', el.text); (el.meta || []).forEach((t, i) => push(`meta[${i}]`, t)); break;
    case 'step':
      push('title', el.title); push('text', el.text); break;
    case 'qa':
      push('q', el.q); push('a', el.a); break;
    case 'quote':
      push('text', el.text); push('author', el.author); break;
    case 'image':
      push('alt', el.alt); break;
    case 'field':
      push('label', el.label); break;
    case 'number':
      push('value', el.value); push('label', el.label); break;
    default:
      push('text', el.text);
  }
  return out;
}
export function blockPlainText(block) {
  return (block.elements || []).flatMap(el => elementTexts(el).map(t => t.text)).join('\n');
}
// Основной текст элемента для проверки длины (заголовок/абзац/кнопка).
export function elementMainText(el) {
  const t = elementTexts(el);
  return t.length ? t[0].text : '';
}

// ---------- findings ----------
export function makeFindings(scope, producer, round) {
  return { scope, producer, round: round || 1, created_at: nowIso(), findings: [], verdict: 'pass', summary: '' };
}
export function addFinding(report, f) {
  const id = `${report.producer}-${String(report.findings.length + 1).padStart(3, '0')}`;
  report.findings.push({ id, status: 'open', ...f });
  return id;
}
export function finalizeVerdict(report) {
  const sev = report.findings.map(f => f.severity);
  if (sev.includes('blocker')) report.verdict = 'blocked';
  else if (sev.includes('major')) report.verdict = 'fix';
  else report.verdict = 'pass';
  const c = { blocker: 0, major: 0, minor: 0 };
  sev.forEach(s => c[s]++);
  report.summary = `blocker ${c.blocker}, major ${c.major}, minor ${c.minor}`;
  return report;
}

// ---------- минимальный валидатор JSON Schema (подмножество) ----------
export function validate(schema, data, rootSchema = schema, p = '$', errors = []) {
  if (schema.$ref) {
    const ref = schema.$ref.replace('#/', '').split('/');
    let s = rootSchema;
    for (const k of ref) s = s[k];
    return validate(s, data, rootSchema, p, errors);
  }
  const t = schema.type;
  const actual = Array.isArray(data) ? 'array' : data === null ? 'null' : typeof data;
  if (t && t !== actual && !(t === 'number' && actual === 'number')) {
    errors.push(`${p}: ожидался ${t}, получен ${actual}`);
    return errors;
  }
  if (schema.enum && !schema.enum.includes(data)) errors.push(`${p}: значение "${data}" не из списка [${schema.enum.join(', ')}]`);
  if (t === 'string') {
    if (schema.minLength != null && data.length < schema.minLength) errors.push(`${p}: короче ${schema.minLength} символов`);
    if (schema.maxLength != null && data.length > schema.maxLength) errors.push(`${p}: длиннее ${schema.maxLength} символов (${data.length})`);
    if (schema.pattern && !(new RegExp(schema.pattern, 'u')).test(data)) errors.push(`${p}: не соответствует шаблону ${schema.pattern}`);
  }
  if (t === 'array') {
    if (schema.minItems != null && data.length < schema.minItems) errors.push(`${p}: меньше ${schema.minItems} элементов`);
    if (schema.maxItems != null && data.length > schema.maxItems) errors.push(`${p}: больше ${schema.maxItems} элементов`);
    if (schema.items) data.forEach((x, i) => validate(schema.items, x, rootSchema, `${p}[${i}]`, errors));
  }
  if (t === 'object') {
    for (const r of schema.required || []) if (!(r in data)) errors.push(`${p}: нет обязательного поля "${r}"`);
    for (const [k, v] of Object.entries(data)) {
      if (k.startsWith('_')) continue;
      if (schema.properties && schema.properties[k]) validate(schema.properties[k], v, rootSchema, `${p}.${k}`, errors);
      else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') validate(schema.additionalProperties, v, rootSchema, `${p}.${k}`, errors);
      else if (schema.additionalProperties === false) errors.push(`${p}: лишнее поле "${k}"`);
    }
  }
  return errors;
}
export function validateFile(schemaName, filePath) {
  const schema = loadSchema(schemaName);
  const data = readJson(filePath);
  return validate(schema, data);
}

// ---------- страницы ----------
export function loadSitemap() { return readJson(P('work', 'sitemap.json')); }
export function saveSitemap(s) { writeJson(P('work', 'sitemap.json'), s); }
export function pageDir(slug) { return P('work', 'pages', slug); }
export function loadBrief(slug) { return readJson(path.join(pageDir(slug), 'brief.json')); }
export function loadBlocks(slug) {
  const brief = loadBrief(slug);
  const out = [];
  for (const b of brief.blocks) {
    const f = path.join(pageDir(slug), 'blocks', `${b.block_id}.json`);
    if (exists(f)) out.push({ spec: b, block: readJson(f), file: f });
  }
  return out;
}
export function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---------- лимиты элементов: одна таблица для build-briefs и линтера ----------
// KIND_CAP - верхняя граница по виду элемента в символах без пробелов, если у типа страницы нет замеров. Списки
// (bullets, badges, filters, table_row) - лимит на пункт. config/project.json -> limits.*_max переопределяет свои виды.
// Замер у типа страницы (chars.max из разборов лидеров) может превышать границу не больше чем на CAP_TOLERANCE.
// Поля с фиксированным лимитом (заголовок карточки и шага, вопрос FAQ, подпись цитаты, значение числа) - FIELD_CAP.
export const KIND_CAP = { h1: 70, h2: 80, h3: 60, sub: 160, text: 350, button: 30, note: 300, link: 60, bullets: 120, badges: 40, filters: 45, table_row: 120, card: 220, step: 220, qa: 550, quote: 300, number: 40, field: 40, image: 120 };
export const FIELD_CAP = { 'card.title': 80, 'step.title': 80, 'qa.title': 80, 'qa.q': 90, 'quote.author': 60, 'number.value': 20 };
export const CAP_TOLERANCE = 1.2;
const LIMIT_KEYS = { h1: 'h1_max', sub: 'sub_max', text: 'text_max', bullets: 'bullet_max', button: 'button_max' };
export function kindCap(kind, limits = {}) {
  const k = LIMIT_KEYS[kind];
  const v = k && Number(limits && limits[k]);
  return v > 0 ? v : (KIND_CAP[kind] || 350);
}
// Итоговый max элемента: поле с фиксированным лимитом; иначе замер типа (не выше границы вида * CAP_TOLERANCE); без замера - граница вида.
// Для уже собранного брифа функция идемпотентна: линтер зовет ее с max брифа и второй раз не режет.
export function effectiveMax(kind, specMax, field = '', limits = {}) {
  const fc = FIELD_CAP[`${kind}.${field}`];
  if (fc) return fc;
  const cap = kindCap(kind, limits);
  const s = Number(specMax);
  return s > 0 ? Math.min(Math.round(s), Math.round(cap * CAP_TOLERANCE)) : cap;
}
// count элемента: «3», «3-5», «0-1» -> {lo, hi}; иначе null
export function parseCount(c) {
  const m = String(c ?? '').trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
  if (!m) return null;
  const lo = Number(m[1]), hi = Number(m[2] ?? m[1]);
  return { lo: Math.min(lo, hi), hi: Math.max(lo, hi) };
}
export const fmtCount = (lo, hi) => (lo === hi ? String(lo) : `${lo}-${hi}`);

// ---------- блоки ----------
export const isListing = b => !!b && b.pattern === 'listing';
// Финальный призыв: id `cta-final`; в старых данных (типы страниц до программы 28.09) - `cta`. Проверки, которые ищут
// финальный призыв по id (action anchor:, objection_to_block, disclaimer_block, адрес пожелания), принимают оба.
export const FINAL_CTA_IDS = ['cta-final', 'cta'];
// id блока среди доступных: как есть, иначе синоним финального призыва; нет - ''.
export function resolveBlockId(id, available) {
  const s = String(id || '');
  const list = [...(available || [])];
  if (list.includes(s)) return s;
  if (FINAL_CTA_IDS.includes(s)) return list.find(x => FINAL_CTA_IDS.includes(x)) || '';
  return '';
}
// Блок цифр: pattern numbers или блок, где главный содержательный элемент - number (count от 1), без карточек, шагов,
// вопросов, строк таблицы, списков и плашек. Без числового факта такой блок выпадает (номер без факта - выдумка).
const NUMBERS_OTHER = new Set(['card', 'step', 'qa', 'table_row', 'bullets', 'badges']);
export function isNumbersBlock(b) {
  if (!b || b.role === 'hero') return false;
  if (b.pattern === 'numbers') return true;
  const els = b.elements || [];
  return els.some(e => e.kind === 'number' && (parseCount(e.count) || { lo: 0 }).lo > 0) && !els.some(e => NUMBERS_OTHER.has(e.kind));
}

// ---------- CTA страницы: наследование от global.cta_by_type ----------
// Страница переопределяет только заданные поля. action и short привязаны к подписи main, secondary_action - к secondary:
// они наследуются из global, только если подпись страницы пуста или совпадает с подписью global. secondary: "" - второй
// кнопки нет; поля secondary нет - берется пара global (secondary и secondary_action). Строка (старые данные) - {main}.
// Возвращает {cta, lost}: lost - поля global, не перенесенные из-за измененной подписи.
export function mergeCta(globalCta, pageCta) {
  const obj = x => (typeof x === 'string' ? { main: x } : x && typeof x === 'object' ? { ...x } : {});
  const g = obj(globalCta), p = obj(pageCta);
  const s = v => String(v ?? '').trim();
  const same = (a, b) => s(a).toLowerCase() === s(b).toLowerCase();
  const out = { main: s(p.main) ? p.main : (g.main ?? '') };
  const lost = [];
  const mainSame = !s(p.main) || same(p.main, g.main);
  for (const f of ['action', 'short']) {
    if (s(p[f])) out[f] = p[f];
    else if (s(g[f])) { if (mainSame) out[f] = g[f]; else lost.push(f); }
  }
  if (!('secondary' in p)) {
    if (s(g.secondary)) out.secondary = g.secondary;
    const sa = s(p.secondary_action) ? p.secondary_action : g.secondary_action;
    if (s(g.secondary) && s(sa)) out.secondary_action = sa;
  } else if (s(p.secondary)) {
    out.secondary = p.secondary;
    if (s(p.secondary_action)) out.secondary_action = p.secondary_action;
    else if (s(g.secondary_action)) { if (same(p.secondary, g.secondary)) out.secondary_action = g.secondary_action; else lost.push('secondary_action'); }
  }
  return { cta: out, lost };
}

// ---------- оговорка-дисклеймер: служебная записка вместо текста для читателя ----------
// Служебный текст узнается по сумме признаков (нужно 2 очка), потому что слова пайплайна бывают и в тексте для читателя:
// «стратегии» в инвестиционной оговорке, «сборщик» у мебели, «бриф» у дизайн-студии, B200 и F150 - коды моделей.
// Сильный признак (2 очка): имя поля snake_case (не почта), английское task, id блока (B03-hero), «см. F12», два разных
// id фактов. Слабый (1 очко): один id факта, роль «стратег» (не «стратегия»), бриф, писатель, оркестратор, сборщик,
// «по типам». Служебная записка в брифы и срезы писателей не идет.
const SERVICE_STRONG_RES = [
  /(?<![a-z0-9@.\/])[a-z]+_[a-z0-9_]+(?![a-z0-9@])/,
  /(?<![a-z])tasks?(?![a-z])/i,
  /(?<![A-Za-z0-9])B\d{2}-[a-z]/,
  /(?<![а-я\u0451a-z])см\.?\s*[FB]\d{2,3}(?![0-9])/i,
];
const SERVICE_WEAK_RE = /(?<![а-я\u0451a-z])(бриф[а-я\u0451]*|стратег(?:а|у|ом|е|и|ов|ам|ами|ах)?|писател[а-я\u0451]*|оркестратор[а-я\u0451]*|сборщик[а-я\u0451]*|по\s+типам)(?![а-я\u0451a-z])/gi;
export function isServiceText(s) {
  const t = String(s || '');
  if (!t.trim()) return false;
  if (SERVICE_STRONG_RES.some(re => re.test(t))) return true;
  const ids = new Set([...t.matchAll(/(?<![A-Za-z0-9])F\d{2,3}(?![0-9])/g)].map(m => m[0]));
  if (ids.size >= 2) return true;
  const words = new Set([...t.matchAll(SERVICE_WEAK_RE)].map(m => m[1].toLowerCase().replace(/\s+/g, ' ').replace(/^(стратег|бриф|писател|оркестратор|сборщик).*$/, '$1')));
  return ids.size + words.size >= 2;
}
// Контракт кнопок блока брифа: у первого экрана ровно одна кнопка; у блока с CTA - не больше одной;
// кнопки интерфейса (cta_allowed false) не трогаются. Правит block.elements на месте, возвращает предупреждения.
export function blockContract(block, limits = {}) {
  const warnings = [];
  const els = block.elements || (block.elements = []);
  const isHero = block.role === 'hero';
  if (!isHero && !block.cta_allowed) return warnings;
  const idx = els.map((e, i) => (e.kind === 'button' ? i : -1)).filter(i => i >= 0);
  if (isHero && !idx.length) {
    els.push({ kind: 'button', count: '1', chars: { min: 0, median: 0, max: kindCap('button', limits) }, note: '' });
    warnings.push(`${block.block_id || block.type}: у первого экрана не было кнопки - добавлена одна`);
    return warnings;
  }
  for (const i of idx.slice(1).reverse()) els.splice(i, 1);
  if (idx.length > 1) warnings.push(`${block.block_id || block.type}: несколько описаний кнопки - оставлено одно`);
  const btn = els[idx[0]];
  if (!btn) return warnings;
  const c = parseCount(btn.count);
  if (!c) { warnings.push(`${block.block_id || block.type}: count кнопки «${btn.count}» не разобран`); if (isHero) btn.count = '1'; return warnings; }
  const next = isHero ? '1' : fmtCount(Math.min(c.lo, 1), Math.min(c.hi, 1));
  if (next !== String(btn.count)) { warnings.push(`${block.block_id || block.type}: кнопок ${btn.count} -> ${next}`); btn.count = next; }
  return warnings;
}

// ---------- id фактов в тексте задания стратега ----------
// Факт в задании блока - утвердительно («назови F03»). Id после короткого отрицания в той же части фразы (до , ; . : ! ?)
// или сразу перед отрицанием («F06 не называй») - отрицательный: в факты не идет, merge-strategy --check считает проблемой.
// Утвердительный глагол между отрицанием и id снимает отрицание («без оговорок назови F03»).
const NEG_RE = /(?:^|[^а-яa-z])(без|кроме(?!\s+того)|не\s+(?:называ|упомина|использ|приводи|пиши|обеща)[а-я]*)(?=$|[^а-яa-z])/gi;
const NEG_AFTER_RE = /^[\s)»"]*не\s+(?:называ|упомина|использ|приводи|пиши|обеща)/i;
const POS_VERB_RE = /(?:^|[^а-яa-z])(назови|упомяни|используй|приведи|опирайся|покажи|дай|сошлись|поставь|возьми|добавь)(?=$|[^а-яa-z])/i;
export function taskFactRefs(task) {
  const pos = [], neg = [];
  for (const clause of String(task || '').split(/[,;.:!?\n]/)) {
    const negs = [...clause.matchAll(NEG_RE)].map(m => ({ start: m.index, end: m.index + m[0].length }));
    for (const m of clause.matchAll(/\bF\d{2,3}\b/g)) {
      const before = negs.filter(n => n.end <= m.index).pop();
      const isNeg = (before && !POS_VERB_RE.test(clause.slice(before.end, m.index))) || NEG_AFTER_RE.test(clause.slice(m.index + m[0].length));
      (isNeg ? neg : pos).push(m[0]);
    }
  }
  const p = [...new Set(pos)];
  return { pos: p, neg: [...new Set(neg)].filter(x => !p.includes(x)) };
}

// ---------- rules/decisions.md, §1 (формат v2) ----------
// Разбор только при строке-маркере в начале файла; у старых задач правила и «Где можно» не извлекаются.
// Таблица | Факт | Конфликт | Разрешенная формулировка | Где можно |: id (списки и диапазоны F41-F44 раскрываются;
// строка без id, например заготовка «F..», пропускается). «Где можно»: все (везде) | нигде | slug и типы страниц карты
// через запятую (info_* - все инфо-типы; слово «только» перед ними - шум) | «все, кроме a, b» (или «-a») - везде, кроме
// перечисленных | «нигде, кроме a» - только a. Хоть один нераспознанный токен - колонка не применяется (предупреждение).
// Страховка «не публикуем»: строка, в формулировке которой есть «не публик...» («не публикуем», «Не публиковать»,
// «Снят: не публикуем») и нет разрешенного фрагмента в «елочках» и условия («не публикуем без/кроме ...»), при «все»
// (или неразобранной колонке) снимает факт со всех страниц (предупреждение).
// Один id в нескольких строках: rule и where склеиваются через « | », допуск - объединение разобранных строк; rows -
// строки факта с формулировкой и всеми id строки (build-briefs сверяет числа формулировки с фактами строки).
// allow: 'all' | 'none' | null (не разобрано) | Set (slug и типы) | {except: Set, only?: Set} | {any: [допуски]}.
export const DECISIONS_V2 = '<!-- decisions:v2 -->';
const GAPS_LINE_RE = /^\s*Открытые пробелы, по которым не пишем[^:]*:?/i;
const tableCells = line => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(x => x.trim());
function expandIds(cell) {
  const out = [];
  for (const m of String(cell || '').matchAll(/F(\d{2,3})(?:\s*-\s*F?(\d{2,3}))?/g)) {
    if (!m[2]) { out.push(`F${m[1]}`); continue; }
    const from = Number(m[1]), to = Number(m[2]), w = m[1].length;
    if (to < from || to - from > 50) { out.push(`F${m[1]}`); continue; }
    for (let n = from; n <= to; n++) out.push(`F${String(n).padStart(w, '0')}`);
  }
  return [...new Set(out)];
}
export function parseDecisions(text, { slugs = [], types = [] } = {}) {
  const res = { v2: false, facts: {}, gaps: [], warnings: [] };
  if (typeof text !== 'string') return res;
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  res.v2 = lines.slice(0, 10).some(l => l.trim() === DECISIONS_V2);
  if (!res.v2) return res;
  const slugSet = new Set(slugs.map(s => String(s).toLowerCase()));
  const typeSet = new Set(types.map(s => String(s).toLowerCase()));
  const known = t => slugSet.has(t) || typeSet.has(t) || t === 'info_*';
  const parseWhere = raw => {
    const toks = String(raw || '').toLowerCase().replace(/[«»`"]/g, '').split(/[,;]/).map(t => t.trim().replace(/[.:]+$/, '').trim()).filter(Boolean);
    if (!toks.length) return { ok: false, bad: ['пусто'] };
    const bad = [], set = new Set(), except = new Set();
    let all = false, none = false, inExcept = false;
    for (let t of toks) {
      const km = t.match(/^(.*?)(?:^|\s)кроме\s+(.+)$/);
      if (km) {
        const head = km[1].trim().replace(/^только\s*:?\s*/, '');
        if (head === 'все' || head === 'везде') all = true;
        else if (head === 'нигде') none = true;
        else if (head && known(head)) set.add(head);
        else if (head) bad.push(head);
        inExcept = true;
        t = km[2].trim();
      }
      let ex = inExcept;
      if (/^-\s*\S/.test(t)) { ex = true; t = t.replace(/^-\s*/, ''); }
      t = t.replace(/^только\s*:?\s*/, '');
      if (ex) { if (known(t)) except.add(t); else bad.push(t); continue; }
      if (t === 'все' || t === 'везде') all = true;
      else if (t === 'нигде') none = true;
      else if (known(t)) set.add(t);
      else bad.push(t);
    }
    if (bad.length) return { ok: false, bad };
    if (except.size) {
      // «нигде, кроме a» - только a; «все, кроме a» и «-a» - везде, кроме a; «service, кроме remont» - service без remont
      if (none && !all && !set.size) return { ok: true, allow: except };
      return { ok: true, allow: !all && set.size ? { only: set, except } : { except } };
    }
    return { ok: true, allow: all ? 'all' : set.size ? set : none ? 'none' : 'all' };
  };
  // «не публикуем», «Не публиковать», «Снят: не публикуем» - в любой части строки
  const UNPUBLISH_RE = /(^|[^а-я\u0451])не\s+публик/i;
  // часть строки (через , ; . |) с фрагментом в «елочках» и глаголом подачи без отрицания - разрешенная формулировка
  const POSITIVE_CLAUSE_RE = /(^|[^а-я\u0451])(пиш[а-я\u0451]*|писать|подава[а-я\u0451]*|подать|формулир[а-я\u0451]*|называ[а-я\u0451]*|говори[а-я\u0451]*|можно|только)(?![а-я\u0451])/i;
  const hasAllowedClause = rule => String(rule || '').split(/[,;.|]/).some(c => /«[^«»]+»/.test(c) && POSITIVE_CLAUSE_RE.test(c.replace(/«[^«»]*»/g, ' ')) && !RULE_NEG_RE.test(c.replace(/«[^«»]*»/g, ' ')));
  const UNPUBLISH_COND_RE = /не\s+публику[а-я\u0451]*\s+(без|кроме|вне)(?![а-я\u0451])/i;
  const hi = lines.findIndex(l => /^\s*\|/.test(l) && /Факт/i.test(l) && /Где можно/i.test(l));
  if (hi >= 0) {
    const head = tableCells(lines[hi]).map(x => x.toLowerCase());
    const col = { fact: head.findIndex(x => /факт/.test(x)), rule: head.findIndex(x => /формулировк/.test(x)), where: head.findIndex(x => /где можно/.test(x)) };
    for (let i = hi + 1; i < lines.length && /^\s*\|/.test(lines[i]); i++) {
      const c = tableCells(lines[i]);
      if (c.every(x => !x || /^:?-{2,}:?$/.test(x))) continue;
      const ids = expandIds(c[col.fact]);
      if (!ids.length) continue;
      const rule = col.rule >= 0 ? c[col.rule] || '' : '';
      const whereRaw = col.where >= 0 ? c[col.where] || '' : '';
      const w = parseWhere(whereRaw);
      if (!w.ok) res.warnings.push(`decisions §1: ${ids.join(', ')}: «Где можно» не разобрано (${w.bad.join(', ')}) - колонка не применяется`);
      let allowRow = w.ok ? w.allow : null;
      // страховка: «не публикуем» без разрешенной формулировки при «все» (или неразобранной колонке) - как «нигде»
      if ((allowRow === 'all' || allowRow === null) && UNPUBLISH_RE.test(rule) && !UNPUBLISH_COND_RE.test(rule) && !allowedRuleText(rule) && !hasAllowedClause(rule)) {
        res.warnings.push(`decisions §1: ${ids.join(', ')}: «не публикуем» при «Где можно» = ${whereRaw || 'пусто'} - факт снят со всех страниц (в «Где можно» писать «нигде»)`);
        allowRow = 'none';
      }
      for (const id of ids) {
        const e = (res.facts[id] ??= { rules: [], wheres: [], allows: [], rows: [] });
        if (rule) { e.rules.push(rule); e.rows.push({ rule, ids }); }
        if (whereRaw) e.wheres.push(whereRaw);
        e.allows.push(allowRow);
      }
    }
  }
  for (const [id, e] of Object.entries(res.facts)) {
    let allow;
    if (e.allows.some(x => x === null)) allow = null;
    else if (e.allows.some(x => x === 'all')) allow = 'all';
    else {
      const open = e.allows.filter(x => x !== 'none');
      const sets = open.filter(x => x instanceof Set);
      const other = open.filter(x => !(x instanceof Set));
      const union = sets.length ? new Set(sets.flatMap(s => [...s])) : null;
      if (!open.length) allow = 'none';
      else if (!other.length) allow = union;
      else if (!union && other.length === 1) allow = other[0];
      else allow = { any: [...(union ? [union] : []), ...other] };
    }
    res.facts[id] = { rule: [...new Set(e.rules)].join(' | '), where: [...new Set(e.wheres)].join(' | '), allow, rows: e.rows };
  }
  const gi = lines.findIndex(l => GAPS_LINE_RE.test(l));
  if (gi >= 0) {
    let s = lines[gi].replace(GAPS_LINE_RE, '');
    for (let j = gi + 1; j < lines.length && lines[j].trim() && !/^\s*(#|\|)/.test(lines[j]); j++) s += ' ' + lines[j].trim();
    // пункты - через «;»; запятая делит только id (g1, j2, F05), формулировка с запятой внутри остается целой
    const isId = x => /^([gj]\d+|F\d{2,3})$/i.test(x);
    for (const part of s.split(';')) {
      let text = [];
      const flush = () => { if (text.length) res.gaps.push(text.join(', ')); text = []; };
      for (const piece of part.split(',').map(x => x.trim().replace(/\.$/, '')).filter(Boolean)) {
        if (isId(piece)) { flush(); res.gaps.push(piece); } else text.push(piece);
      }
      flush();
    }
  }
  return res;
}

// Разрешенная часть rule из decisions.md: фрагменты в «елочках», кроме запрещенных. Фрагмент запрещен, если в его
// предложении (до точки, «;» или « | ») перед ним стоит отрицание («не», «без», «нельзя», «запрещ...») после последнего
// противопоставления («, а», «, но»), прямо перед ним «вместо» или сразу после него (и после перечисления других
// фрагментов через запятую, «и», «или») - «- нельзя», «не ...», «запрещены». Примеры: «Не пересчитывать в «18 лет»,
// «почти 20 лет»» - пусто; «Писать «с 2008 года», не «18 лет»» - «с 2008 года»; «Слова «вечная», «пожизненная» запрещены» - пусто.
// Цифры и маркеры из запрета (lint.mjs, lint-common.mjs) не считаются подтвержденными фактом.
const RULE_NEG_RE = /(^|[^а-я\u0451])(не|без|нельзя|запрещ[а-я\u0451]*)(?![а-я\u0451])/i;
const FRAG = '\u0001';
export function allowedRuleText(rule) {
  const s = String(rule || '');
  const blank = x => x.replace(/«[^«»]*»/g, FRAG);
  const out = [];
  for (const m of s.matchAll(/«([^«»]*)»/g)) {
    const before = blank(s.slice(0, m.index)).split(/[.;!?|\n]/).pop().split(/,\s*(?:а|но)\s/i).pop();
    const after = blank(s.slice(m.index + m[0].length)).split(/[.;!?|\n]/)[0].replace(/^(?:[\s,]*(?:(?:и|или)\s+)?\u0001)*/i, '');
    if (RULE_NEG_RE.test(before) || /(^|[^а-я\u0451])вместо\s*$/i.test(before) || /^\s*(-\s*)?(не|нельзя|запрещ)/i.test(after)) continue;
    out.push(m[1]);
  }
  return out.join(' ');
}
// Допускает ли разобранное «Где можно» страницу: null (не разобрано) и 'all' - да, 'none' - нет, набор - slug или тип,
// {except} - все, кроме slug или типа из набора (с only - только из only и не из except), {any} - любой из допусков.
export function decisionAllows(allow, page) {
  if (allow == null || allow === 'all') return true;
  if (allow === 'none') return false;
  const t = String(page.type || '').toLowerCase();
  const hit = set => set.has(String(page.slug || '').toLowerCase()) || set.has(t) || (t.startsWith('info_') && set.has('info_*'));
  if (allow instanceof Set) return hit(allow);
  if (Array.isArray(allow.any)) return allow.any.some(x => decisionAllows(x, page));
  if (allow.except instanceof Set) return (!(allow.only instanceof Set) || hit(allow.only)) && !hit(allow.except);
  return true;
}

// Тексты, которые повторяются дословно по праву: формулировка факта и его разрешенная формулировка (rule из decisions.md).
// Их n-граммы не считаются повтором (lint.mjs phrase.repeat, lint-page.mjs phrase.overuse, page-state.mjs).
export function protectedFactTexts(brief) {
  return (brief && brief.facts || []).flatMap(f => [f.wording, f.rule]).filter(x => typeof x === 'string' && x);
}

// Имя сегмента страницы для всех сегментов сразу (главная, хаб): константа, не из словаря интерфейса.
export const SEGMENT_ALL_NAME = 'Все посетители';

// Адрес страницы как путь: без схемы и хоста, без слеша на конце (кроме корня). Пусто - пусто (нет родителя).
export function normPath(u) {
  let s = String(u ?? '').trim();
  if (!s) return '';
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, '').split(/[?#]/)[0];
  if (!s.startsWith('/')) s = '/' + s;
  if (s.length > 1) s = s.replace(/\/+$/, '');
  return s || '/';
}
export function argv(flags = {}) {
  const args = process.argv.slice(2);
  const out = { _: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      if (flags[k] === 'bool') out[k] = true;
      else out[k] = args[++i];
    } else out._.push(a);
  }
  return out;
}
