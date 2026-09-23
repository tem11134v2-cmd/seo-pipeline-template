// Вход для слепого читателя без агента подготовки (без LLM). node scripts/blind-prep.mjs <slug>
// Печатает портрет сегмента (name + portrait + comes_with, до 600 символов по границе фразы) и до 3 дословных первых экранов
// конкурентов из примеров блока первого экрана в брифе (без разбора аналитика why_strong и без доменов).
// Пишет work/audit/<slug>/blind-view.md - тексты страницы без служебных строк page.md (тип, сегмент, уникальный аргумент,
// вопросы читателя): слепой читатель не должен видеть бриф. Код выхода 2 - нет брифа, 1 - нет ни одного написанного блока.
import path from 'node:path';
import { P, exists, pageDir, loadBrief, loadBlocks, writeText, elementTexts } from './lib.mjs';

const slug = process.argv[2];
if (!slug) { console.error('usage: blind-prep.mjs <slug>'); process.exit(2); }
if (!exists(path.join(pageDir(slug), 'brief.json'))) { console.error(`нет work/pages/${slug}/brief.json`); process.exit(2); }
const brief = loadBrief(slug);
const flat = s => String(s || '').replace(/\s+/g, ' ').trim();
function cut(s, n) {
  s = flat(s);
  if (s.length <= n) return s;
  const head = s.slice(0, n);
  const end = Math.max(head.lastIndexOf('. '), head.lastIndexOf('! '), head.lastIndexOf('? '));
  return end > n * 0.5 ? head.slice(0, end + 1) : head.slice(0, head.lastIndexOf(' ')) + '...';
}
const seg = brief.segment || {};
const persona = cut([seg.name ? `${flat(seg.name)}.` : '', seg.portrait, seg.comes_with].filter(Boolean).join(' '), 600);
const heroSpec = (brief.blocks || []).find(b => b.role === 'hero') || (brief.blocks || [])[0] || {};
const examples = (heroSpec.examples || []).map(e => flat(typeof e === 'string' ? e : e.text)).filter(Boolean).slice(0, 3);

// чистый текст страницы: block_id (нужен фиксеру) и тексты элементов, без названий блоков, ролей и вопросов читателя
const blocks = loadBlocks(slug);
if (!blocks.length) { console.error(`у ${slug} нет написанных блоков`); process.exit(1); }
const lines = [];
blocks.forEach(({ block }) => {
  lines.push(`## ${block.block_id}`);
  for (const el of block.elements || []) {
    const t = elementTexts(el).map(x => flat(x.text)).filter(Boolean);
    if (!t.length) continue;
    switch (el.kind) {
      case 'h1': lines.push(`# ${t[0]}`); break;
      case 'h2': lines.push(`### ${t[0]}`); break;
      case 'h3': lines.push(`#### ${t[0]}`); break;
      case 'image': lines.push(`[картинка: ${t.join(' ')}]`); break;
      case 'button': lines.push(`[кнопка: ${t[0]}]`); break;
      case 'field': lines.push(`[поле формы: ${t[0]}]`); break;
      case 'link': lines.push(`[ссылка: ${t[0]}]`); break;
      case 'bullets': t.forEach(x => lines.push(`- ${x}`)); break;
      case 'badges': case 'filters': case 'table_row': lines.push(t.join(' | ')); break;
      case 'number': lines.push(t.join(' ')); break;
      case 'card': case 'step': case 'qa': lines.push(`**${t[0]}**`, ...t.slice(1)); break;
      default: lines.push(...t);
    }
  }
  lines.push('');
});
const view = P('work', 'audit', slug, 'blind-view.md');
writeText(view, lines.join('\n'));

console.log('ПОРТРЕТ СЕГМЕНТА:');
console.log(persona || '(в брифе нет портрета сегмента)');
console.log('');
console.log('ПЕРВЫЕ ЭКРАНЫ КОНКУРЕНТОВ:');
if (examples.length) examples.forEach((e, i) => console.log(`${i + 1}. ${e}`));
else console.log('(примеров нет)');
console.log('');
console.log(`СТРАНИЦА: work/audit/${slug}/blind-view.md (блоков ${blocks.length} из ${(brief.blocks || []).length})`);
