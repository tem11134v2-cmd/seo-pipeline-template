// Общие проверки линтера для lint.mjs (блок) и lint-page.mjs (страница). Модуль, напрямую не запускается.
// ai.* (формы, по которым текст звучит как сгенерированный), style.same-start, style.summary-tail,
// fact.claim-unsupported, страничные бюджеты (ai.contrast, ai.neg-pitch), word.overuse, placeholder.count.
// Правила и пороги - rules/lint.json. Политика severity:
// - заголовки (h1, h2, h3, sub, title карточки и шага, вопрос qa): любая находка ai.* - minor, в бюджеты не входит;
// - тело: severity паттерна; для id из page_budgets - бюджет страницы в порядке блоков: в бюджете minor, сверх - major на блок;
// - editorial.* (редакционный стандарт, rules/lint.json -> editorial): severity из секции, в заголовках и в теле одинаково,
//   в бюджеты не входят; editorial.internal-detail - только в блоках ролей из internal_detail.roles (block.role).
import { B, cyr, esc, splitSentences, elementTexts, PLACEHOLDER_RE } from './lib.mjs';

export const SKIP_KINDS = new Set(['button', 'link', 'field', 'image', 'filters', 'number']);
const HEAD_KINDS = new Set(['h1', 'h2', 'h3', 'sub']);
const HEAD_FIELDS = { card: new Set(['title']), step: new Set(['title']), qa: new Set(['q']) };
const SKIP_FIELDS = { quote: new Set(['author']) };

// 'head' | 'body' | null (поле не проверяется)
export function zoneOf(kind, field) {
  if (SKIP_KINDS.has(kind) || SKIP_FIELDS[kind]?.has(field)) return null;
  if (HEAD_KINDS.has(kind) || HEAD_FIELDS[kind]?.has(field)) return 'head';
  return 'body';
}

const clip = (s, n = 160) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 3) + '...' : t; };
const cyrWords = s => (String(s).toLowerCase().match(/[а-яa-z]+/g) || []);

// ---------- компиляция правил ----------
export function compileLint(rules, brief = {}, cfg = {}) {
  const budgets = {};
  for (const [k, v] of Object.entries(rules.page_budgets || {})) if (!k.startsWith('_') && typeof v === 'number') budgets[k] = v;
  const ai = (rules.ai_patterns || []).map(p => ({
    ...p,
    re: cyr(p.pattern, 'gi'),
    exRe: p.exceptions?.length ? cyr(B + '(' + p.exceptions.map(esc).join('|') + ')' + B, 'gi') : null,
    budget: budgets[p.id],
  }));
  const ss = rules.same_start || {};
  const wo = rules.word_overuse || {};
  const stemLen = wo.stem_len || 6;
  const stem = w => (w.length > stemLen ? w.slice(0, stemLen) : w);
  const minLen = wo.min_len || 5;
  const stop = new Set(wo.stop || []);
  const term = brief.terminology || {};
  const protectedText = [...(term.use || []).map(t => t.say), ...(term.untranslatable || []), brief.company, brief.subject, brief.geo].filter(Boolean).join(' ');
  const protectedStems = new Set(cyrWords(protectedText).filter(w => w.length >= minLen).map(stem));
  return {
    ai,
    budgets,
    placeholdersMax: cfg.limits?.placeholders_per_page_max ?? 3,
    tailRe: rules.summary_tail_pattern ? cyr(rules.summary_tail_pattern) : null,
    sameStartMin: ss.min_items || 3,
    questionWords: (ss.question_words || []).map(s => s.toLowerCase()),
    claimRe: rules.claim_markers?.length ? cyr(B + '(' + rules.claim_markers.map(esc).join('|') + ')[а-яa-z]*', 'gi') : null,
    claimExcept: rules.claim_markers_except || [],
    claimStems: rules.claim_markers || [],
    factText: Object.fromEntries((brief.facts || []).map(f => [f.id, [f.label, f.value, f.wording].filter(Boolean).join(' ').toLowerCase()])),
    embellish: (rules.embellish_markers || []).map(p => ({ p, re: cyr(B + '(' + p + ')', 'gi'), test: cyr(B + '(' + p + ')', 'i') })),
    word: { minLen, stop, stem, protectedStems },
    editorial: compileEditorial(mergeEditorial(rules.editorial, cfg.lint_extra?.editorial)),
  };
}

// ---------- editorial.*: редакционный стандарт (config/house_style.md) ----------
// Секция rules/lint.json -> editorial; нет секции или подсекции - правило не проверяется (старые проекты с overrides).
// Проектные добавки - config/project.json -> lint_extra.editorial (данные задачи, копию lint.json в overrides/ не замораживают):
// по подсекции null - правило выключено; массив - дописывается к массиву kit (exceptions, patterns, stop, abbreviations...);
// скаляр (severity, порог) - заменяет значение kit.
export function mergeEditorial(ed, extra) {
  if (!ed || typeof ed !== 'object' || !extra || typeof extra !== 'object') return ed;
  const out = { ...ed };
  for (const [k, v] of Object.entries(extra)) {
    if (k.startsWith('_')) continue;
    if (v === null) { delete out[k]; continue; }
    if (typeof v !== 'object' || Array.isArray(v)) continue;
    const base = out[k] && typeof out[k] === 'object' ? { ...out[k] } : {};
    for (const [kk, vv] of Object.entries(v)) {
      if (kk.startsWith('_')) continue;
      base[kk] = Array.isArray(vv) && Array.isArray(base[kk]) ? [...base[kk], ...vv] : vv;
    }
    out[k] = base;
  }
  return out;
}

export function compileEditorial(ed) {
  if (!ed || typeof ed !== 'object') return null;
  const low = xs => (xs || []).map(s => String(s).toLowerCase());
  const hc = ed.heading_colon, sp = ed.stock_phrases, sr = ed.sub_repeats_heading, cl = ed.card_long, so = ed.social_proof, id = ed.internal_detail;
  return {
    hc: hc && {
      sev: hc.severity || 'major', kinds: new Set(hc.kinds || ['h1', 'h2', 'h3']), minWords: hc.min_words_before ?? 2,
      qStarts: new Set(low(hc.question_starts)), qSplit: hc.question_split !== false, ex: (hc.exceptions || []).map(p => cyr(p)),
    },
    sp: sp && {
      sev: sp.severity || 'major',
      list: (sp.patterns || []).map(p => (typeof p === 'string' ? { pattern: p } : p))
        .map(p => ({ re: cyr(p.pattern, 'gi'), say: p.say || '', kinds: p.kinds?.length ? new Set(p.kinds) : null })),
    },
    sr: sr && {
      sev: sr.severity || 'major', heads: new Set(sr.heading_kinds || ['h1', 'h2']), next: new Set(sr.next_kinds || ['sub', 'text']),
      minLen: sr.min_word_len || 4, stemLen: sr.stem_len || 5, minCommon: sr.min_common || 2, minShare: sr.min_share ?? 0.5, stop: new Set(low(sr.stop)),
      textMaxNew: sr.text_max_new_stems ?? 2, textPrefix: sr.text_prefix_repeat !== false,
    },
    cl: cl && {
      sev: cl.severity || 'major', kinds: new Set(cl.kinds || ['card', 'step']), roles: cl.roles?.length ? new Set(cl.roles) : null,
      max: cl.max_sentences || 2, abbr: new Set(low(cl.abbreviations)), addr: new Set(low(cl.address_abbreviations)),
    },
    so: so && { sev: so.severity || 'major', res: (so.patterns || []).map(p => cyr(p, 'gi')), markers: low(so.fact_markers) },
    id: id && { sev: id.severity || 'minor', roles: new Set(id.roles || ['hero', 'conversion']), res: (id.patterns || []).map(p => cyr(p, 'gi')) },
  };
}

// «Кто делает украшение: больше 10 ювелиров», «Точно золото? Проверьте пробу» -> {form, before}; иначе null.
// Двоеточие считается, только если за ним пробел и текст (время «10:00» не заголовок-объяснение).
export function headingColonHit(text, hc) {
  const t = String(text || '').replace(PLACEHOLDER_RE, ' ').replace(/\s+/g, ' ').trim();
  if (!t || hc.ex.some(re => re.test(t))) return null;
  const firstWord = s => ((s.toLowerCase().match(/[а-яa-z]+/) || [''])[0]);
  const m = t.match(/^([^:]+?):\s+\S/);
  if (m) {
    const n = m[1].split(/\s+/).filter(w => /[а-яa-z]/i.test(w)).length;
    if (n >= hc.minWords || hc.qStarts.has(firstWord(m[1]))) return { form: 'colon', before: m[1].trim() };
  }
  if (hc.qSplit) {
    const q = t.match(/^([^?]+)\?\s+(.*)$/);
    if (q && /[а-яa-z]/i.test(q[2])) return { form: 'question', before: q[1].trim() + '?' };
  }
  return null;
}

// Основы содержательных слов для editorial.sub-repeats-heading (в порядке текста, без повторов).
export function editorialStemList(s, sr) {
  const out = [];
  for (const w of String(s || '').toLowerCase().replace(PLACEHOLDER_RE, ' ').match(/[а-яa-z0-9]+/g) || []) {
    if (w.length < sr.minLen || sr.stop.has(w)) continue;
    const st = w.length > sr.stemLen ? w.slice(0, sr.stemLen) : w;
    if (!out.includes(st)) out.push(st);
  }
  return out;
}
export function editorialStems(s, sr) { return new Set(editorialStemList(s, sr)); }

// Пересказывает ли cmp (подзаголовок или первое предложение текста) заголовок head: {common, size, form} или null.
// sub: доля основ подзаголовка из заголовка >= min_share при общих >= min_common.
// text: первое предложение начинается с основ заголовка (все основы заголовка на первых позициях - «prefix»)
// или то же правило доли, но новых основ (которых нет в заголовке) не больше text_max_new_stems («share»):
// предложение, которое добавляет срок, способ, условие, пересказом не считается.
// Для text то же проверяется по частям предложения, соединенным противительно («..., а пробу вы проверяете сами»):
// пересказ заголовка во второй части - тоже пересказ.
const CLAUSE_SPLIT = /\s*(?:[,;]\s+(?:а|но|и|зато|однако)\s+|;\s+|\s+-\s+)/i;
export function subRepeatsHeading(head, cmp, kind, sr) {
  const H = editorialStems(head, sr);
  if (!H.size) return null;
  const test = text => {
    const L = editorialStemList(text, sr);
    if (!L.length) return null;
    const common = L.filter(x => H.has(x));
    if (common.length < sr.minCommon) return null;
    const share = common.length / L.length >= sr.minShare;
    if (kind !== 'text') return share ? { common, size: L.length, form: 'share' } : null;
    if (sr.textPrefix && H.size >= sr.minCommon && L.slice(0, H.size).every(x => H.has(x))) return { common, size: L.length, form: 'prefix' };
    if (share && L.length - common.length <= sr.textMaxNew) return { common, size: L.length, form: 'share' };
    return null;
  };
  const whole = test(cmp);
  if (whole || kind !== 'text') return whole;
  const parts = String(cmp || '').split(CLAUSE_SPLIT).filter(Boolean);
  if (parts.length < 2) return null;
  for (const p of parts) { const hit = test(p); if (hit) return hit; }
  return null;
}

// Число предложений для editorial.card-long. Адресное сокращение с точкой (addr: «ул.», «г.», «д.», «стр.») предложение
// не кончает, что бы ни шло за ним («ул. Ленина», «г. Москва», «д. 5»); единица или деньги (abbr: «руб.», «тыс.», «м.») -
// только перед цифрой («от 5 тыс. 500 руб.»), а перед заглавной это обычный конец предложения («от 500 руб. Пришлите фото»).
export function countSentences(text, abbr = new Set(), addr = new Set()) {
  const parts = splitSentences(String(text || '').replace(PLACEHOLDER_RE, ' '));
  let n = 0;
  parts.forEach((p, i) => {
    const prev = parts[i - 1];
    const tail = prev && (prev.toLowerCase().match(/(?:^|[^а-яa-z])([а-яa-z]+)\.$/) || [])[1];
    if (i && tail && (addr.has(tail) || (abbr.has(tail) && /^\d/.test(p)))) return;
    n++;
  });
  return n;
}

function editorialScan(block, R) {
  const E = R.editorial;
  const out = [];
  if (!E) return out;
  const els = block.elements || [];
  els.forEach((el, idx) => {
    const texts = elementTexts(el).filter(x => zoneOf(el.kind, x.field));
    // editorial.heading-colon
    if (E.hc && E.hc.kinds.has(el.kind) && el.text) {
      const hit = headingColonHit(el.text, E.hc);
      if (hit) out.push({
        severity: E.hc.sev, category: 'style', rule: 'editorial.heading-colon', element_index: idx, quote: clip(el.text),
        problem: hit.form === 'colon' ? `заголовок «объяснение: смысл» - перед двоеточием «${clip(hit.before, 60)}»` : `заголовок «вопрос? ответ» - «${clip(hit.before, 60)}» перед ответом`,
        proposal: 'оставить только смысловую часть, если она работает сама: «Более 10 мастеров в штате», а не «Кто делает: более 10 мастеров в штате»',
      });
    }
    // editorial.card-long
    if (E.cl && E.cl.kinds.has(el.kind) && el.text && (!E.cl.roles || E.cl.roles.has(block.role))) {
      const n = countSentences(el.text, E.cl.abbr, E.cl.addr);
      if (n > E.cl.max) out.push({
        severity: E.cl.sev, category: 'style', rule: 'editorial.card-long', element_index: idx, quote: clip(el.text),
        problem: `текст ${el.kind === 'card' ? 'карточки' : 'шага'} - ${n} предложений при норме до ${E.cl.max}`,
        proposal: 'заголовок + 1-2 коротких предложения: что это и что читатель сможет сделать; примеры и доказательства - в свой блок',
      });
    }
    // editorial.sub-repeats-heading: подзаголовок или первое предложение текста сразу после h1/h2
    const next = els[idx + 1];
    if (E.sr && E.sr.heads.has(el.kind) && el.text && next && E.sr.next.has(next.kind) && next.text) {
      const cmp = next.kind === 'text' ? (splitSentences(next.text)[0] || next.text) : next.text;
      const hit = subRepeatsHeading(el.text, cmp, next.kind, E.sr);
      if (hit) out.push({
        severity: E.sr.sev, category: 'repeat', rule: 'editorial.sub-repeats-heading', element_index: idx + 1, quote: clip(cmp),
        problem: `${next.kind === 'sub' ? 'подзаголовок' : 'первое предложение текста'} ${hit.form === 'prefix' ? 'начинается с пересказа заголовка' : 'пересказывает заголовок'} «${clip(el.text, 60)}»: общих основ ${hit.common.length} из ${hit.size} (${hit.common.join(', ')})`,
        proposal: next.kind === 'sub' ? 'удалить подзаголовок или дать в нем новую информацию: условие, срок, механизм' : 'начать текст с новой информации, а не с пересказа заголовка',
      });
    }
    for (const { text } of texts) {
      for (const s of splitSentences(String(text).replace(PLACEHOLDER_RE, ' '))) {
        // editorial.stock-phrase (пересекающиеся совпадения разных паттернов - одна находка: «Где границы работы»)
        const spans = [];
        if (E.sp) for (const p of E.sp.list) if (!p.kinds || p.kinds.has(el.kind)) for (const m of s.matchAll(p.re)) {
          const a = m.index, b = m.index + m[0].length;
          if (spans.some(([x, y]) => a < y && x < b)) continue;
          spans.push([a, b]);
          out.push({
            severity: E.sp.sev, category: 'style', rule: 'editorial.stock-phrase', element_index: idx, quote: clip(s),
            problem: `«креативный» оборот вместо прямой формулировки: «${clip(m[0], 60)}»`, proposal: p.say || 'назвать предмет или действие прямо',
          });
        }
        // editorial.social-proof: без цифры в предложении и без факта элемента про рекомендации, отзывы, повторные заказы
        if (E.so && !/\d/.test(s)) {
          const factsText = (el.facts || []).map(fid => R.factText[fid] || '').join(' ');
          if (!E.so.markers.some(mk => factsText.includes(mk))) {
            const hits = E.so.res.flatMap(re => [...s.matchAll(re)].map(m => m[0].trim()));
            if (hits.length) out.push({
              severity: E.so.sev, category: 'fact', rule: 'editorial.social-proof', element_index: idx, quote: clip(s),
              problem: `социальное доказательство без факта: «${[...new Set(hits)].map(h => clip(h, 50)).join('», «')}»`,
              proposal: 'убрать или заменить ссылкой на реальные отзывы; цифра или доля - только из факта брифа',
            });
          }
        }
        // editorial.internal-detail: производственная кухня в продающих блоках
        if (E.id && E.id.roles.has(block.role)) {
          const hits = E.id.res.flatMap(re => [...s.matchAll(re)].map(m => m[0].trim()));
          if (hits.length) out.push({
            severity: E.id.sev, category: 'rule', rule: 'editorial.internal-detail', element_index: idx, quote: clip(s),
            problem: `внутренняя деталь производства в продающем блоке: «${[...new Set(hits)].join('», «')}»`,
            proposal: 'убрать, если она не меняет решение читателя; обязательное раскрытие - в FAQ или условиях',
          });
        }
      }
    }
  });
  return out;
}

// ---------- проверка одного блока ----------
// Возвращает { findings, occ, stems, placeholders }:
// findings - готовые находки без бюджета (ai.* вне бюджетов, style.*, fact.claim-unsupported);
// occ - вхождения бюджетных правил ai.* ({rule, zone, element_index, quote, match}); бюджет применяет applyPageBudgets;
// stems - Map основа -> {n, forms:Set} для word.overuse; placeholders - число плейсхолдеров в элементах блока.
export function scanBlock(block, R) {
  const findings = [], occ = [];
  const els = block.elements || [];
  let lastBody = null; // последнее предложение последнего текстового элемента тела
  els.forEach((el, idx) => {
    const texts = elementTexts(el);
    const bodyTexts = [];
    for (const { field, text } of texts) {
      const zone = zoneOf(el.kind, field);
      if (!zone) continue;
      const t = String(text).replace(PLACEHOLDER_RE, ' ');
      if (zone === 'body') bodyTexts.push(t);
      for (const s of splitSentences(t)) {
        const taken = [];
        for (const p of R.ai) {
          if (p.scope === 'body' && zone !== 'body') continue;
          if (p.skip_if_digit && /\d/.test(s)) continue;
          const src = p.skip_quoted ? s.replace(/«[^»]*»/g, m => ' '.repeat(m.length)) : s;
          const exSpans = p.exRe ? [...src.matchAll(p.exRe)].map(m => [m.index, m.index + m[0].length]) : [];
          for (const m of src.matchAll(p.re)) {
            const a = m.index, b = a + m[0].length;
            if (taken.some(([x, y]) => a >= x && b <= y)) continue;
            if (exSpans.some(([x, y]) => a < y && b > x)) continue;
            taken.push([a, b]);
            const hit = { rule: p.id, zone, element_index: idx, quote: clip(s), match: m[0].trim() };
            if (p.budget != null) { occ.push(hit); continue; }
            const head = zone === 'head';
            findings.push({
              severity: head ? 'minor' : p.severity, category: 'style', rule: p.id, element_index: idx, quote: clip(s),
              problem: `${p.message}: «${clip(m[0], 60)}»${head ? ' (в заголовке)' : ''}`, proposal: p.proposal || '',
            });
          }
        }
      }
    }
    if (bodyTexts.length) {
      const ss = splitSentences(bodyTexts[bodyTexts.length - 1]);
      if (ss.length) lastBody = { element_index: idx, sentence: ss[ss.length - 1] };
    }
    // fact.claim-unsupported: утверждение о законах, налогах, комиссиях, гарантиях, которое не подтверждает ни один
    // факт элемента: facts[] пуст или ни у одного факта (label, value, wording) нет основы маркера
    if (R.claimRe) {
      const ids = el.facts || [];
      const factsText = ids.map(id => R.factText[id] || '').join(' ');
      for (const { field, text } of texts) {
        if (!zoneOf(el.kind, field) || (el.kind === 'qa' && field === 'q')) continue;
        for (const s of splitSentences(String(text).replace(PLACEHOLDER_RE, ' '))) {
          if (/\?\s*$/.test(s)) continue;
          const hits = [...s.matchAll(R.claimRe)].map(m => m[0].toLowerCase())
            .filter(w => !R.claimExcept.some(x => w.startsWith(x)))
            .filter(w => !factsText.includes(R.claimStems.find(st => w.startsWith(st)) || w));
          if (!hits.length) continue;
          findings.push({
            severity: 'minor', category: 'fact', rule: 'fact.claim-unsupported', element_index: idx, quote: clip(s),
            problem: `утверждение про «${[...new Set(hits)].join('», «')}» ${ids.length ? `не подтверждено: факты элемента (${ids.join(', ')}) не про это` : 'без факта'}`,
            proposal: 'подтвердить фактом из брифа (поле facts) или переформулировать вопросом к специалисту',
          });
        }
      }
    }
    // fact.embellish: элемент ссылается на факты, а предложение усиливает их тем, чего в фактах нет
    // («до 14% годовых уже за вычетом расходов», «гарантированный доход»). Цифру линтер подтвердил, а усиление - нет.
    // Отрицание перед маркером («не гарантируем») - не усиление.
    if (R.embellish.length && (el.facts || []).length) {
      const factsText = (el.facts || []).map(id => R.factText[id] || '').join(' ');
      for (const { field, text } of texts) {
        if (!zoneOf(el.kind, field)) continue;
        for (const s of splitSentences(String(text).replace(PLACEHOLDER_RE, ' '))) {
          const hits = [];
          for (const e of R.embellish) for (const m of s.matchAll(e.re)) {
            if (/(^|[^а-яa-z])не\s+$/i.test(s.slice(Math.max(0, m.index - 4), m.index))) continue;
            if (e.test.test(factsText)) continue;
            hits.push(m[0].trim());
          }
          if (!hits.length) continue;
          findings.push({
            severity: 'major', category: 'fact', rule: 'fact.embellish', element_index: idx, quote: clip(s),
            problem: `усиление факта (${(el.facts || []).join(', ')}): «${[...new Set(hits)].join('», «')}» - этого нет в самом факте`,
            proposal: 'убрать усиление: цифра и условия - ровно как в wording факта',
          });
        }
      }
    }
  });
  // style.summary-tail: блок заканчивается резюме
  if (R.tailRe && lastBody && R.tailRe.test(lastBody.sentence.trim())) {
    const dup = findings.some(f => f.rule === 'ai.summary' && f.element_index === lastBody.element_index && f.quote === clip(lastBody.sentence));
    if (!dup) findings.push({
      severity: 'major', category: 'style', rule: 'style.summary-tail', element_index: lastBody.element_index, quote: clip(lastBody.sentence),
      problem: 'блок заканчивается резюмирующим предложением', proposal: 'убрать вывод: последняя фраза - факт или следующий шаг для читателя',
    });
  }
  findings.push(...editorialScan(block, R));
  findings.push(...sameStart(els, R));
  return { findings, occ, stems: blockStems(block, R), placeholders: placeholderCount(block) };
}

// ---------- style.same-start ----------
function startKey(text) {
  const w = String(text).toLowerCase().replace(PLACEHOLDER_RE, ' ').match(/[а-яa-z0-9]+/g) || [];
  if (!w.length || /^\d/.test(w[0])) return null;
  const st = x => (x.length <= 3 ? x : x.length === 4 ? x.slice(0, 3) : x.slice(0, 4));
  return w[0].length < 3 && w[0] !== 'не' && w[1] ? `${w[0]} ${st(w[1])}` : st(w[0]);
}
function isQuestionStart(q, R) {
  const w = String(q).toLowerCase().match(/[а-яa-z0-9]+/g) || [];
  if (w[1] === 'ли') return true;
  const two = w.slice(0, 2).join(' ');
  return R.questionWords.includes(w[0]) || R.questionWords.includes(two);
}
function sameStart(els, R) {
  const groups = [];
  const collect = (name, pick) => {
    const items = [];
    els.forEach((el, idx) => { const t = pick(el); if (t) items.push({ idx, t }); });
    if (items.length) groups.push({ name, items });
  };
  els.forEach((el, idx) => { if (el.kind === 'bullets' && el.items?.length) groups.push({ name: 'пункты списка', items: el.items.map(t => ({ idx, t })) }); });
  collect('подзаголовки h3', el => (el.kind === 'h3' ? el.text : null));
  collect('заголовки карточек', el => (el.kind === 'card' ? el.title : null));
  collect('тексты карточек', el => (el.kind === 'card' ? el.text : null));
  collect('заголовки шагов', el => (el.kind === 'step' ? el.title : null));
  collect('тексты шагов', el => (el.kind === 'step' ? el.text : null));
  collect('вопросы', el => (el.kind === 'qa' && el.q && !isQuestionStart(el.q, R) ? el.q : null));
  const out = [];
  for (const g of groups) {
    const by = {};
    for (const it of g.items) { const k = startKey(it.t); if (k) (by[k] ??= []).push(it); }
    for (const [k, list] of Object.entries(by)) {
      if (list.length < R.sameStartMin) continue;
      out.push({
        severity: 'minor', category: 'style', rule: 'style.same-start', element_index: list[0].idx,
        quote: clip(list.map(x => x.t.split(/\s+/).slice(0, 4).join(' ')).join(' | ')),
        problem: `${g.name}: ${list.length} начинаются с «${k}...»`, proposal: 'начать пункты по-разному: с сути каждого пункта, а не с общего слова',
      });
    }
  }
  return out;
}

// ---------- word.overuse и плейсхолдеры: сырье по блоку ----------
export function blockStems(block, R) {
  const m = new Map();
  for (const el of block.elements || []) for (const { field, text } of elementTexts(el)) {
    if (!zoneOf(el.kind, field)) continue;
    for (const w of cyrWords(String(text).replace(PLACEHOLDER_RE, ' '))) {
      if (w.length < R.word.minLen || R.word.stop.has(w)) continue;
      const s = R.word.stem(w);
      if (R.word.protectedStems.has(s)) continue;
      const e = m.get(s) || { n: 0, forms: new Set() };
      e.n++; e.forms.add(w); m.set(s, e);
    }
  }
  return m;
}
export function placeholderCount(block) { return (JSON.stringify(block.elements || []).match(PLACEHOLDER_RE) || []).length; }

// ---------- бюджеты страницы ----------
// seq: [{ block_id, scan }] в порядке блоков брифа (scan - результат scanBlock). Первые N вхождений законны.
// Возвращает Map block_id -> [находки]. only - вернуть находки только для этого block_id (lint.mjs: seq - блоки выше и сам блок).
// opts.wordSeverity - severity word.overuse: lint.mjs при письме передает 'minor' (писатель видит, вердикт блока
// от повторов слов не зависит, plan-run тоже), lint-page.mjs - 'major' (по умолчанию), чинит фиксер.
export function applyPageBudgets(seq, R, only, opts = {}) {
  const wordSeverity = opts.wordSeverity || 'major';
  const res = new Map(seq.map(x => [x.block_id, []]));
  const push = (id, f) => { if (!only || only === id) res.get(id).push(f); };
  const where = only ? 'в блоках выше и в этом' : 'на странице';
  // ai.* с бюджетом
  for (const p of R.ai.filter(x => x.budget != null)) {
    const total = seq.reduce((s, x) => s + x.scan.occ.filter(o => o.rule === p.id && o.zone === 'body').length, 0);
    let used = 0;
    for (const { block_id, scan } of seq) {
      const over = [];
      for (const o of scan.occ.filter(x => x.rule === p.id)) {
        if (o.zone === 'head') { push(block_id, { severity: 'minor', category: 'style', rule: p.id, element_index: o.element_index, quote: o.quote, problem: `${p.message}: «${clip(o.match, 60)}» (в заголовке, в бюджет страницы не входит)`, proposal: p.proposal || '' }); continue; }
        used++;
        if (used <= p.budget) push(block_id, { severity: 'minor', category: 'style', rule: p.id, element_index: o.element_index, quote: o.quote, problem: `${p.message}: «${clip(o.match, 60)}» (${used} из ${p.budget} допустимых на странице)`, proposal: p.proposal || '' });
        else over.push(o);
      }
      if (over.length) push(block_id, {
        severity: 'major', category: 'style', rule: p.id, element_index: over[0].element_index,
        quote: clip(over.map(o => o.quote).join(' | '), 300),
        problem: `${p.message} сверх бюджета страницы: ${where} ${total} при бюджете ${p.budget}, в этом блоке сверх бюджета ${over.length}: ${over.map(o => `«${clip(o.match, 50)}»`).join(', ')}`,
        proposal: p.proposal || '',
      });
    }
  }
  // word.overuse
  const thr = R.budgets['word.overuse'];
  if (thr != null) {
    const total = new Map();
    for (const { scan } of seq) for (const [s, e] of scan.stems) total.set(s, (total.get(s) || 0) + e.n);
    const run = new Map();
    for (const { block_id, scan } of seq) {
      for (const [s, e] of scan.stems) {
        const before = run.get(s) || 0;
        run.set(s, before + e.n);
        const excess = before + e.n - Math.max(thr, before);
        if (total.get(s) <= thr || excess <= 0) continue;
        push(block_id, {
          severity: wordSeverity, category: 'repeat', rule: 'word.overuse', quote: [...e.forms].join(', '),
          problem: `слово «${s}...» звучит ${where} ${total.get(s)} раз при пороге ${thr}; в этом блоке ${e.n}, из них сверх порога ${excess}`,
          proposal: 'лишние вхождения заменить местоимением или словом того же смысла, либо опустить, если смысл понятен без него',
        });
      }
    }
  }
  // placeholder.count
  {
    const total = seq.reduce((s, x) => s + x.scan.placeholders, 0);
    let before = 0;
    for (const { block_id, scan } of seq) {
      const n = scan.placeholders;
      const excess = before + n - Math.max(R.placeholdersMax, before);
      before += n;
      if (n && excess > 0) push(block_id, { severity: 'major', category: 'coverage', rule: 'placeholder.count', problem: `плейсхолдеров ${where} ${total} при лимите ${R.placeholdersMax}; в этом блоке ${n}, из них сверх лимита ${excess}`, proposal: 'переписать блок без пропавших данных' });
    }
  }
  return res;
}
// Правила, которые считаются по странице: lint-page пересчитывает их сам по всей странице.
export function pageRuleIds(R) { return new Set([...R.ai.filter(p => p.budget != null).map(p => p.id), 'word.overuse', 'placeholder.count']); }
// Какие minor печатать писателю
export const showMinor = rule => /^(ai|style|editorial)\./.test(rule) || rule === 'fact.claim-unsupported' || rule === 'word.overuse';
