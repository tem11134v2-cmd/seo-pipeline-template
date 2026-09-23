// Рендер inputs/analysis.md из контракта анализа (project.json v2). Вызывает scripts/import-project.mjs.
// Файл нужен пяти промтам вне фазы 0 (02-competitor-verifier, 02-type-aggregator, 02-catalog-analyst,
// 03-type-auditor, 07-catalog-spec-writer, плюс T2-retro): они грепают его по заголовкам разделов. Поэтому
// заголовки ## ниже - контракт, их не переименовывают без правки этих промтов:
//   «Конкуренты», «Чем отличаемся», «Чего нет у конкурентов / дыры рынка», «Обязательные блоки у рынка»,
//   «Вопросы читателя», «Чего не обещаем», «Позиции и карточки», «Обещания рынка», «Цифры рынка», «Факты».
// Строка факта «- F01 [src] label: value» и строка «основание: ...» содержат source_quote из work/facts.json
// дословно: проверка grep -F по этому файлу находит каждую цитату.
// Все строки уже нормализованы вызывающим скриптом (без буквы е с точками, тире только «-»).

// Мост словаря блоков анализа (pages.yml) к id блоков текстов (page-type): синонимы из гейта 0, п. 2.3.
export const BLOCK_SYNONYMS = {
  edge: 'benefits', steps: 'process', price: 'pricing', qa: 'faq', docs: 'documents', compare: 'comparison',
  geo: 'geo-list', about: 'about-short', cta_form: 'cta', cta_mid: 'cta', listing: 'listing', hero: 'hero',
  cases: 'cases', reviews: 'reviews', not_fit: 'not-fit', price_factors: 'price-factors', cat_intro: 'category-intro',
  cat_text: 'category-text', product_desc: 'product-description',
};
export const blockId = id => BLOCK_SYNONYMS[id] || String(id).replace(/_/g, '-');

const list = (arr, f = x => x) => (arr || []).map(x => `- ${f(x)}`).join('\n');
const para = s => (s ? `${s}\n` : '');

export function renderAnalysis(ctx) {
  const { p, facts, audience, prefs, gate, projectRel, seed } = ctx;
  const b = p.business || {}, o = p.offer || {}, c = p.competitors || {}, m = c.market || {};
  const cons = p.constraints || {}, lex = p.lexicon || {};
  const segByOld = ctx.segMap || {};
  const out = [];
  const H = (lvl, t) => out.push(`${'#'.repeat(lvl)} ${t}\n`);
  const L = s => out.push(s);

  H(1, `Анализ проекта «${b.name || p.slug}»`);
  L(`Рендер контракта анализа ${projectRel} (v${p.v}, обновлен ${p.updated}, тир ${p.tier}). Собран скриптом scripts/import-project.mjs, руками не править: правки вносятся в project.json и импорт повторяется.`);
  L(`Гейт анализа: ${gate.approved ? `согласован (${gate.by || 'кем - не указано'}, ${gate.at || 'дата не указана'})` : 'НЕ согласован: факты не подтверждены заказчиком'}. Источники входа анализа: ${(p.source || []).join(', ') || 'нет'}.\n`);

  H(2, 'Компания и ниша');
  L(list([
    `Название: ${b.name || '-'}`,
    `Что делает: ${b.what || '-'}`,
    `Регион: ${b.region || '-'}`,
    `География работы: ${(b.geo || []).join(', ') || '-'}`,
    `Год начала работы: ${b.since || '-'}`,
    `Тип бизнеса: ${b.type || '-'}; тип сайта: ${b.site_kind || '-'}`,
    `Признаки ниши: ${(b.sig || []).join(', ') || '-'}`,
    `Сайт: ${ctx.siteUrl || '-'}`,
  ]) + '\n');
  const lg = b.legal || {};
  const legalRows = [['юрлицо', lg.entity], ['ИНН', lg.inn], ['ОГРН', lg.ogrn], ['адрес', lg.address], ['телефон', lg.phone], ['почта', lg.email], ['часы', lg.schedule]].filter(([, v]) => v);
  L(`Реквизиты: ${legalRows.length ? legalRows.map(([k, v]) => `${k} - ${v}`).join('; ') : 'в контракте нет'}.\n`);

  H(2, 'Направления и страницы');
  const dirs = b.directions || [];
  if (dirs.length) {
    L('| id | Направление | Родитель | Маркер | Адрес | Сегменты |\n|---|---|---|---|---|---|');
    for (const d of dirs) L(`| ${d.id} | ${d.name} | ${d.parent || ''} | ${d.marker || ''} | ${d.url || ''} | ${(d.serves || []).map(s => segByOld[s] || s).join(', ')} |`);
    L('');
  } else L('Направлений в контракте нет.\n');
  if ((b.client_pages || []).length) { L('Страницы действующего сайта:'); L(list(b.client_pages, x => `${x.url}${x.name ? ' - ' + x.name : ''}`) + '\n'); }

  H(2, 'Позиционирование и главное обещание');
  const pr = o.promise || {};
  L(list([
    `Позиционирование (d1): ${o.positioning || '-'}`,
    `Кому: ${pr.who || '-'}`,
    `Обещание, что получит клиент (d2): ${pr.result || '-'}`,
    `Как: ${pr.how || '-'}`,
    `Доказательство обещания: ${pr.proof_id ? (ctx.factIdMap[pr.proof_id] || pr.proof_id) : '-'}`,
    `Главное действие на сайте (d3): ${pr.cta || '-'}`,
  ]) + '\n');

  H(2, 'Чем отличаемся');
  const reasons = o.reasons || [];
  const withProof = reasons.filter(r => r.proof), noProof = reasons.filter(r => !r.proof);
  const factOf = proof => (facts.facts.find(f => f.value.toLowerCase() === String(proof).toLowerCase()) || {}).id;
  L(withProof.length ? list(withProof, r => `${r.claim} - доказательство (${r.kind}): ${r.proof}${factOf(r.proof) ? ` (${factOf(r.proof)})` : ''}`) + '\n' : 'Причин с доказательством в контракте нет.\n');
  if (noProof.length) { L('Без доказательства (на страницу не идут, пока нет подтверждения):'); L(list(noProof, r => `${r.claim} (${r.kind})`) + '\n'); }

  H(2, 'Чего не обещаем');
  L(para('Границы работы и антиобещания. Регулярки для линтера - в work/facts.json -> anti_promises.'));
  L(list(facts.anti_promises || [], a => `${a.id}: ${a.text}`) + '\n');
  if ((cons.not_selling || []).length) { L('Чего не продаем:'); L(list(cons.not_selling) + '\n'); }

  H(2, 'Запреты и обязательные формулировки');
  L(`Запрещенные слова: ${(cons.forbidden || []).join(', ') || 'не заданы'}.`);
  L(`Не про нас: ${(cons.not_self || []).join('; ') || 'не задано'}.`);
  L(`Обязательно сказать на сайте: ${(cons.must_say || []).join('; ') || 'не задано'}.`);
  L(`Что не раскрываем: ${cons.opsec || 'не задано'}.\n`);

  H(2, 'Тон');
  L(`${o.tone || 'Тон в контракте не задан.'} (d5)\n`);

  H(2, 'Сегменты аудитории');
  for (const s of audience.segments) {
    H(3, `${s.id}. ${s.name}`);
    L(`Портрет: ${s.portrait}\n`);
    L('Боли:'); L(list(s.pains) + '\n');
    if (s.fears.length) { L('Страхи:'); L(list(s.fears) + '\n'); }
    L('Возражения:'); L(list(s.objections, x => `${x.id}: «${x.text}»${x.behind ? ` (за этим: ${x.behind})` : ''} - ответ: ${x.answer}`) + '\n');
    L('Критерии выбора:'); L(list(s.criteria) + '\n');
    if ((s.directions || []).length) { L('Направления:'); L(list(s.directions) + '\n'); }
  }

  H(2, 'Вопросы читателя');
  L(para('Возражения сегментов словами клиента: на них страница обязана ответить.'));
  L(list(audience.segments.flatMap(s => s.objections.map(x => ({ ...x, seg: s.id }))), x => `${x.id} (${x.seg}): ${x.text}`) + '\n');

  H(2, 'Слова клиентов');
  L(list(audience.client_phrases, x => `«${x.phrase}» - ${x.meaning}${x.src ? ` [${x.src}]` : ''}`) + '\n');
  L('Метка [persona] - формулировка аналитика, в кавычках на сайте не ставится; [forum] и [client] - живая речь.\n');

  H(2, 'Конкуренты');
  L(para('Стартовый список анализа (затравка work/competitors/seed.json).'));
  L((seed.domains.length ? list(seed.domains, d => d.domain) : 'Список конкурентов в контракте пуст.') + '\n');
  if (seed.rejected && seed.rejected.length) L(`Строки списка, которые не удалось привести к домену: ${seed.rejected.join('; ')}.\n`);

  H(2, 'Чего нет у конкурентов / дыры рынка');
  L(((m.gaps || []).length ? list(m.gaps) : 'Дыр рынка в контракте нет.') + '\n');

  H(2, 'Обязательные блоки у рынка');
  L(para('Блоки, которые стоят у большинства лидеров (id анализа -> id блока текстов).'));
  L(((m.must_have || []).length ? list(m.must_have, id => `${id} -> ${blockId(id)}`) : 'Замера блоков в контракте нет.') + '\n');

  H(2, 'Обещания рынка');
  L(((m.offers_seen || []).length ? list(m.offers_seen) : 'Нет данных.') + '\n');

  H(2, 'Цифры рынка');
  L(para('Цифры лидеров как они их печатают. Это не наши факты: в тексты не идут, нужны для отстройки и клише.'));
  L(((c.seen_numbers || []).length ? list(c.seen_numbers) : 'Нет данных.') + '\n');

  H(2, 'Позиции и карточки');
  const products = facts.facts.filter(f => f.kind === 'product');
  if ((b.assortment || []).length) { L('Ассортимент словами клиента:'); L(list(b.assortment) + '\n'); }
  else L('Ассортимента (business.assortment) в контракте нет.\n');
  if (products.length) { L('Факты о позициях:'); L(list(products, f => `${f.id}: ${f.label} - ${f.value}`) + '\n'); }

  H(2, 'Факты');
  L(para('Строка факта: «- F01 [источник] название: значение», ниже основание - цитата из входа анализа (или та же строка, если цитаты нет). Публикация: да - подтверждено на гейте, нет - не подтверждено или снято.'));
  for (const f of facts.facts) {
    L(`- ${f.id} [${(ctx.factSrc || {})[f.id] || 'источник не указан'}] ${f.label}: ${f.value} | kind: ${f.kind}${f.geo ? `, гео: ${f.geo}` : ''} | публикация: ${f.publish === 'yes' ? 'да' : 'нет'}`);
    L(`  - основание: ${f.source_quote}`);
  }
  L('');

  H(2, 'Терминология');
  const t = facts.terminology;
  L(`Пишем только так: ${t.use.map(x => x.say).join('; ') || '-'}.`);
  L(`Жаргон и замена: ${t.jargon.map(x => `${x.internal} -> ${x.public}`).join('; ') || '-'}.`);
  L(`Не переводим: ${t.untranslatable.join('; ') || '-'}.\n`);

  H(2, 'Пробелы');
  L((facts.gaps.length ? list(facts.gaps) : 'Пробелов нет.') + '\n');

  H(2, 'Решения гейта');
  const rows = Object.entries(gate.decisions || {});
  if (rows.length) {
    L('| Код | Решение | Значение | Как принято |\n|---|---|---|---|');
    for (const [k, d] of rows) L(`| ${k} | ${d.name} | ${String(d.value).replace(/\|/g, '/')} | ${d.how} |`);
    L('');
  } else L('Журнала гейта нет.\n');
  if ((prefs.items || []).length) { L('Пожелания заказчика для текстов (work/client-preferences.json):'); L(list(prefs.items, x => `[${x.status}${x.where ? ', ' + x.where : ''}] ${x.text}`) + '\n'); }

  return out.join('\n').replace(/\n{3,}/g, '\n\n').replace(/[\u0451]/g, 'е').replace(/[\u0401]/g, 'Е').replace(/[\u2012-\u2015\u2212]/g, '-').replace(/\u00a0/g, ' ');
}
