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
    .replace(/[—–]/g, '-')
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
