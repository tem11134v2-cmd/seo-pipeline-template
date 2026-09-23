// md-представление страницы для людей. node scripts/render-md.mjs [slug...]  (без аргументов - все страницы с блоками)
import path from 'node:path';
import { loadSitemap, pageDir, loadBrief, loadBlocks, exists, writeText, elementTexts } from './lib.mjs';

let slugs = process.argv.slice(2);
if (!slugs.length) slugs = loadSitemap().pages.filter(p => p.status !== 'skip' && exists(path.join(pageDir(p.slug), 'brief.json'))).map(p => p.slug);

function renderEl(el) {
  switch (el.kind) {
    case 'h1': return `# ${el.text}`;
    case 'h2': return `## ${el.text}`;
    case 'h3': return `### ${el.text}`;
    case 'sub': return `*${el.text}*`;
    case 'text': return el.text;
    case 'note': return `> ${el.text}`;
    case 'button': return `**[ ${el.text} ]**`;
    case 'link': return `[${el.text}](${el.href || '#'})`;
    case 'bullets': return (el.items || []).map(i => `- ${i}`).join('\n');
    case 'badges': return (el.items || []).map(i => `\`${i}\``).join(' ');
    case 'filters': return `Фильтры: ${(el.items || []).join(' | ')}`;
    case 'table_row': return `| ${(el.items || []).join(' | ')} |`;
    case 'card': return `${el.title ? `**${el.title}**\n` : ''}${el.text || ''}${el.meta?.length ? '\n' + el.meta.map(m => `  - ${m}`).join('\n') : ''}`;
    case 'step': return `${el.title ? `**Шаг: ${el.title}**\n` : ''}${el.text || ''}`;
    case 'qa': return `**${el.q}**\n${el.a}`;
    case 'quote': return `> ${el.text}\n> - ${el.author || ''}`;
    case 'image': return `[картинка: ${el.alt || ''}]`;
    case 'field': return `[поле формы: ${el.label || ''}]`;
    case 'number': return `**${el.value || '[нет значения]'}** ${el.label || ''}`;
    default: return elementTexts(el).map(t => t.text).join('\n');
  }
}
for (const slug of slugs) {
  const brief = loadBrief(slug);
  const blocks = loadBlocks(slug);
  const lines = [];
  lines.push(`# ${brief.subject} (${brief.url})`);
  lines.push(`Тип: ${brief.type} · набор блоков: ${brief.block_set} · сегмент: ${brief.segment?.name || '-'} · CTA: ${brief.cta?.main || '-'}`);
  lines.push(`Уникальный аргумент: ${brief.unique_argument || '-'}`);
  lines.push('');
  for (const spec of brief.blocks) {
    const found = blocks.find(b => b.block.block_id === spec.block_id);
    lines.push(`---`);
    lines.push(`## ${spec.block_id} · ${spec.name} · роль ${spec.role} · вопрос читателя: ${spec.reader_question}`);
    if (!found) { lines.push('_блок еще не написан_'); lines.push(''); continue; }
    for (const el of found.block.elements) { lines.push(renderEl(el)); lines.push(''); }
    if (found.block.facts_used?.length) lines.push(`_факты: ${found.block.facts_used.join(', ')}_`);
    lines.push('');
  }
  writeText(path.join(pageDir(slug), 'page.md'), lines.join('\n'));
  console.log(`md: ${slug} (${blocks.length}/${brief.blocks.length} блоков)`);
}
