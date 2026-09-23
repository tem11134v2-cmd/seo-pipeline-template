// Проверка HTML-шаблона типа страницы. node scripts/validate-layout.mjs <type> [<type>...]
// Шаблон: work/layouts/<type>.html. Требования: по <section data-block="<id>"> на каждый блок из
// recommended_order файла типа страницы, без лишних секций, без вложенных section, без текста,
// без script/style/link, классы только из html/primitives.css, data-slot только из видов элементов или "*".
// Отчет по каждому типу - work/audit/layouts/<type>.json. Код выхода 0, только если все типы pass.
import { P, readJson, readText, exists, writeJson, makeFindings, addFinding, finalizeVerdict } from './lib.mjs';

const types = process.argv.slice(2);
if (!types.length) { console.error('usage: validate-layout.mjs <type> [<type>...]'); process.exit(2); }
const KINDS = ['h1', 'h2', 'h3', 'sub', 'text', 'bullets', 'button', 'badges', 'card', 'step', 'qa', 'quote', 'image', 'field', 'number', 'note', 'link', 'filters', 'table_row', '*'];

function check(type) {
  const file = P('work', 'layouts', `${type}.html`);
  const ptFile = P('work', 'page-types', `${type}.json`);
  const report = makeFindings(`layout/${type}`, 'layout-validator');
  const F = (sev, rule, problem, quote) => addFinding(report, { severity: sev, category: 'structure', rule, problem, quote: (quote || '').slice(0, 120) });
  if (!exists(file)) F('blocker', 'layout.missing', `нет файла ${file}`);
  if (!exists(ptFile)) F('blocker', 'layout.page-type', `нет файла типа ${ptFile}`);
  if (!report.findings.length) {
    const html = readText(file);
    const pt = readJson(ptFile);
    const css = readText(P('html', 'primitives.css'));
    const allowedClasses = new Set([...css.matchAll(/\.([a-zA-Z][\w-]*)/g)].map(m => m[1]));
    if (/<(script|style|link|iframe)\b/i.test(html)) F('blocker', 'layout.forbidden-tag', 'script/style/link/iframe в шаблоне');
    const sections = [...html.matchAll(/<section\b([^>]*)>/gi)];
    const ids = sections.map(m => (m[1].match(/data-block="([^"]+)"/) || [])[1]).filter(Boolean);
    const expected = pt.recommended_order;
    for (const id of expected) if (!ids.includes(id)) F('blocker', 'layout.block-missing', `нет секции для блока ${id}`);
    for (const id of ids) if (!expected.includes(id)) F('major', 'layout.block-extra', `секция ${id} не входит в recommended_order`);
    const dup = ids.filter((x, i) => ids.indexOf(x) !== i);
    for (const d of new Set(dup)) F('blocker', 'layout.block-dup', `секция ${d} повторяется`);
    // вложенные section
    const opens = [...html.matchAll(/<\/?section\b/gi)].map(m => m[0].startsWith('</') ? -1 : 1);
    let depth = 0; for (const o of opens) { depth += o; if (depth > 1) { F('blocker', 'layout.nested-section', 'вложенные section'); break; } }
    // текст
    const text = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (text.length) F('blocker', 'layout.has-text', 'в шаблоне есть текст, шаблон задает только раскладку', text);
    // классы и слоты
    for (const m of html.matchAll(/class="([^"]*)"/g)) for (const c of m[1].split(/\s+/).filter(Boolean)) if (!allowedClasses.has(c)) F('major', 'layout.class', `класс «${c}» не из primitives.css`);
    for (const m of html.matchAll(/data-slot="([^"]*)"/g)) for (const k of m[1].split(/\s+/).filter(Boolean)) if (!KINDS.includes(k)) F('major', 'layout.slot', `неизвестный вид элемента в data-slot: ${k}`);
    // у каждой секции есть хотя бы один слот
    for (const m of html.matchAll(/<section\b[^>]*data-block="([^"]+)"[^>]*>([\s\S]*?)<\/section>/gi)) if (!/data-slot=/.test(m[2])) F('blocker', 'layout.no-slot', `в секции ${m[1]} нет ни одного data-slot`);
    // соответствие паттерну: листинг должен иметь слот filters и card
    for (const b of [...pt.market_blocks, ...pt.differentiation_blocks]) {
      const sec = (html.match(new RegExp(`<section\\b[^>]*data-block="${b.id}"[^>]*>([\\s\\S]*?)<\\/section>`, 'i')) || [])[1] || '';
      if (!sec) continue;
      const need = b.elements.map(e => e.kind);
      const slots = [...sec.matchAll(/data-slot="([^"]*)"/g)].flatMap(m => m[1].split(/\s+/));
      if (!slots.includes('*')) for (const k of need) if (!slots.includes(k)) F('major', 'layout.slot-missing', `в секции ${b.id} нет слота для элемента ${k} и нет слота "*"`);
    }
  }
  finalizeVerdict(report);
  writeJson(P('work', 'audit', 'layouts', `${type}.json`), report);
  console.log(`layout ${type}: ${report.verdict} (${report.summary})`);
  report.findings.forEach(f => console.log(` - [${f.severity}] ${f.rule}: ${f.problem}`));
  return report.verdict === 'pass';
}

let failed = 0;
for (const t of types) if (!check(t)) failed++;
process.exit(failed ? 1 : 0);
