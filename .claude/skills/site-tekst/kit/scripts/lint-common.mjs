// Общие проверки линтера для lint.mjs (блок) и lint-page.mjs (страница). Модуль, напрямую не запускается.
// ai.* (формы, по которым текст звучит как сгенерированный), style.same-start, style.summary-tail,
// fact.claim-unsupported, fact.embellish, fact.hedge-lost (hedgeLostFindings, зовет lint.mjs по элементам),
// страничные бюджеты (ai.contrast, ai.neg-pitch), word.overuse, placeholder.count.
// Правила и пороги - rules/lint.json. Политика severity:
// - заголовки (h1, h2, h3, sub, title карточки и шага, вопрос qa): любая находка ai.* - minor, в бюджеты не входит;
// - тело: severity паттерна; для id из page_budgets - бюджет страницы в порядке блоков: в бюджете minor, сверх - major на блок.
import { B, cyr, esc, splitSentences, elementTexts, PLACEHOLDER_RE, allowedRuleText } from './lib.mjs';

// ---------- стоп-слова: одна регулярка для lint.mjs и предупреждений build-briefs ----------
// Левая граница - граница слова; правая - граница слова после окончания до 2 букв («надежная», «качественного»), поэтому
// «надежность», «эффективность», «быстросъемные» не ловятся. Пункт с «*» на конце - основа без правой границы
// («динамично развивающ*»). m[1] - найденная фраза.
export function stopWordsRe(rules) {
  const alts = (rules.stop_words || []).map(w => String(w).trim()).filter(Boolean)
    .map(w => (w.endsWith('*') ? esc(w.slice(0, -1)) : `${esc(w)}[а-яa-z]{0,2}${B}`));
  return alts.length ? cyr(B + '(' + alts.join('|') + ')') : /(?!)/;
}

// ---------- маска имен: предмет страницы, ключевая фраза, компания, предметы страниц из ссылок, непереводимые термины ----------
// Имя целиком (без учета регистра) заменяется пробелами той же длины. Токены имени с цифрой и буквой или с дробью (R16,
// S24, М300, 205/55, 3D в предмете) маскируются отдельно по всему тексту: они переживают склонение соседних слов. Голое
// число из имени («24» в «Окна 24») маскируется только в составе всего имени, иначе «24 часа» прошли бы без факта.
// Антиобещания, do_not_say и клише по маске не проверяются (линтер смотрит их по исходному тексту).
// maskLoose - для стоп-слов: имя из двух и больше слов маскируется и в склонении («ремонта квартир под ключ»): слова
// имени сверяются по основам подряд, между ними допускается один предлог («монтаж окон в Туле» при «монтаж окон тула»).
// Стоп-слово прощается только внутри такого фрагмента: «Быстрый выезд» при ссылке «Быстрый ремонт окон» - находка.
const NAME_TOKEN_RE = /[\p{L}\d]*\d[\p{L}\d]*(?:\/[\p{L}\d]+)*|\d+(?:\/\d+)+/gu;
const NAME_WORD_RE = /[\p{L}\d]+(?:[\/-][\p{L}\d]+)*/gu;
const NAME_GAP = '[^\\p{L}\\d]+(?:(?:в|во|на|по|для|из|у|с|со|к|ко|от|и)[^\\p{L}\\d]+)?';
// основа слова имени: короткие (до 3 знаков) и слова с цифрой - целиком; 4 буквы - 2 первые («окна» - «окон»); длиннее -
// без двух последних, не короче 3; к основе - до 3 букв окончания
const nameStem = w => {
  if (w.length <= 3 || /\d/.test(w)) return esc(w);
  const n = w.length === 4 ? 2 : Math.max(3, w.length - 2);
  return `${esc(w.slice(0, n))}\\p{L}{0,${w.length - n + 3}}`;
};
export function nameMask(names) {
  const list = [...new Set((names || []).map(x => String(x || '').replace(/\s+/g, ' ').trim()).filter(x => x.length >= 2))].sort((a, b) => b.length - a.length);
  const whole = list.map(n => new RegExp(`(?<![\\p{L}\\d])${esc(n).replace(/ /g, '\\s+')}(?![\\p{L}\\d])`, 'giu'));
  const toks = new Set();
  for (const n of list) for (const m of n.matchAll(NAME_TOKEN_RE)) { const t = m[0]; if (/\p{L}/u.test(t) || t.includes('/')) toks.add(t); }
  const tokRes = [...toks].sort((a, b) => b.length - a.length).map(t => new RegExp(`(?<![\\p{L}\\d])${esc(t)}(?![\\p{L}\\d])`, 'giu'));
  const loose = list.map(n => (n.match(NAME_WORD_RE) || []).map(w => w.toLowerCase())).filter(ws => ws.length >= 2)
    .map(ws => new RegExp(`(?<![\\p{L}\\d])${ws.map(nameStem).join(NAME_GAP)}(?![\\p{L}\\d])`, 'giu'));
  const blank = s => ' '.repeat(s.length);
  const mask = s => { let t = String(s ?? ''); for (const re of [...whole, ...tokRes]) t = t.replace(re, blank); return t; };
  return {
    names: list,
    mask,
    maskLoose: s => { let t = mask(s); for (const re of loose) t = t.replace(re, blank); return t; },
  };
}
export const briefNames = brief => [brief && brief.subject, brief && brief.key_phrase, brief && brief.company, ...((brief && brief.links) || []).map(l => l && l.subject), ...(((brief && brief.terminology) || {}).untranslatable || [])];

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
    // текст факта для сверки маркеров: label, value, wording, условие (note) и разрешенная часть rule (без запретов)
    factText: Object.fromEntries((brief.facts || []).map(f => [f.id, [f.label, f.value, f.wording, f.note, allowedRuleText(f.rule)].filter(Boolean).join(' ').toLowerCase()])),
    embellish: (rules.embellish_markers || []).map(p => ({ p, re: cyr(B + '(' + p + ')', 'gi'), test: cyr(B + '(' + p + ')', 'i') })),
    embellishWindow: rules.embellish_window || rules.hedge_window || 3,
    word: { minLen, stop, stem, protectedStems },
    hedge: compileHedge(rules, brief),
  };
}

// ---------- fact.hedge-lost: условие у числа факта ----------
// Группы оговорок (lint.json hedge_groups): маркер - слова через пробел; слово до 3 букв сравнивается целиком, длиннее -
// по началу (основа). В факте маркер стоит в 1-3 словах перед числом (hedge_near_only - только прямо перед числом).
// В тексте элемента достаточно маркера той же группы где угодно.
function compileHedge(rules, brief) {
  const groups = (rules.hedge_groups || []).map(g => ({ id: g.id, markers: (g.markers || []).map(m => String(m).toLowerCase().split(/\s+/).filter(Boolean)) }));
  return {
    groups,
    window: rules.hedge_window || 3,
    nearOnly: new Set((rules.hedge_near_only || []).map(s => String(s).toLowerCase())),
    comparatives: new Set((rules.hedge_comparatives || []).map(s => String(s).toLowerCase())),
    // плашки, цифры и строки прайса проверяются: оговорка ищется во всем элементе (подпись number, соседняя ячейка строки)
    skipKinds: new Set(rules.hedge_skip_kinds || ['button', 'link', 'field', 'image', 'filters']),
    skipFactKinds: new Set(rules.hedge_skip_fact_kinds || ['contact', 'legal']),
    facts: Object.fromEntries((brief.facts || []).map(f => [f.id, { text: [f.wording, f.value].filter(Boolean).join(' \n '), kind: f.kind || '' }])),
  };
}
const tokMatch = (tok, w) => (tok.length <= 3 ? w === tok : w.startsWith(tok));
const markerAt = (words, i, m) => m.every((tok, k) => words[i + k] !== undefined && tokMatch(tok, words[i + k]));
// Число - отдельный токен: не часть слова («3D», «4K»), не время «10:00», не часть номера («ЮЛ770»).
const NUM_RE = /(?<![\p{L}\d.,:])(\d{1,3}(?:[  ]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?)(?![\p{L}\d:]|[.,]\d)/gu;
const numVal = s => s.replace(/[  ]/g, '').replace(',', '.');
const lcWords = s => String(s).toLowerCase().match(/[а-яa-z]+/g) || [];
// Группы маркеров, стоящих у каждого числа текста: [{n, groups:Set}]
function hedgedNumbers(text, H) {
  const out = [];
  for (const m of String(text).matchAll(NUM_RE)) {
    const before = String(text).slice(0, m.index).split(/[.;!?\n]/).pop();
    const w = lcWords(before);
    const groups = new Set();
    for (const g of H.groups) for (const mk of g.markers) {
      const near = mk.length === 1 && H.nearOnly.has(mk[0]);
      const from = near ? w.length - 1 : Math.max(0, w.length - H.window - mk.length + 1);
      for (let i = Math.max(0, from); i <= w.length - mk.length; i++) if (markerAt(w, i, mk)) groups.add(g.id);
    }
    out.push({ n: numVal(m[1]), index: m.index, len: m[0].length, groups });
  }
  return out;
}
const groupInText = (words, g) => g.markers.some(mk => words.some((_, i) => markerAt(words, i, mk)));
// Находки fact.hedge-lost для одного элемента (idx - индекс в блоке).
export function hedgeLostFindings(el, idx, R) {
  const H = R.hedge;
  if (!H || !H.groups.length || H.skipKinds.has(el.kind)) return [];
  const ids = (el.facts || []).filter(id => H.facts[id] && !H.skipFactKinds.has(H.facts[id].kind));
  if (!ids.length) return [];
  const text = elementTexts(el).map(t => t.text).join('\n').replace(PLACEHOLDER_RE, ' ');
  const words = lcWords(text);
  const nums = hedgedNumbers(text, { ...H, groups: [] });
  const out = [];
  const seen = new Set();
  for (const fid of ids) {
    const other = ids.filter(x => x !== fid).flatMap(x => hedgedNumbers(H.facts[x].text, H)).filter(x => !x.groups.size).map(x => x.n);
    for (const fn of hedgedNumbers(H.facts[fid].text, H)) {
      for (const gid of fn.groups) {
        const g = H.groups.find(x => x.id === gid);
        if (other.includes(fn.n) || groupInText(words, g)) continue;
        const hits = nums.filter(x => x.n === fn.n).filter(x => {
          const pre = lcWords(text.slice(0, x.index).split(/[.;!?\n]/).pop()).slice(-2);
          if (pre.some(w => H.comparatives.has(w) || /[а-я]{3,}ее$/.test(w))) return false; // «тоньше 1,3 мм» - сравнение, не факт
          // край диапазона «2-5» заменяет оговорки «от» и «до»
          if (g.markers.some(mk => mk.length === 1 && H.nearOnly.has(mk[0]))) {
            if (/\d\s*-\s*$/.test(text.slice(Math.max(0, x.index - 3), x.index)) || /^\s*-\s*\d/.test(text.slice(x.index + x.len, x.index + x.len + 3))) return false;
          }
          return true;
        });
        // одна находка на потерю условия: оба края диапазона «20-25» при «в среднем» - одна находка, не две
        const key = `${fid}:${gid}`;
        if (!hits.length || seen.has(key)) continue;
        seen.add(key);
        const mk = g.markers.map(m => m.join(' ')).slice(0, 3).join(' / ');
        out.push({
          severity: 'major', category: 'fact', rule: 'fact.hedge-lost', element_index: idx, quote: clip(text),
          problem: `условие факта ${fid} потеряно: в факте у числа ${fn.n} стоит оговорка (${mk}), в тексте ее нет`,
          proposal: 'вернуть условие рядом с числом, как в wording факта (или в разрешенной формулировке rule), либо убрать число',
        });
      }
    }
  }
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
            proposal: 'подтвердить фактом из брифа (поле facts) или убрать утверждение; не заменять обещанием консультации, звонка, встречи',
          });
        }
      }
    }
    // fact.embellish: элемент ссылается на факты, а предложение усиливает их тем, чего в фактах нет
    // («до 14% годовых уже за вычетом расходов», «гарантированный доход»). Цифру линтер подтвердил, а усиление - нет.
    // Не находка: отрицание перед маркером («не гарантируем»); маркер из группы оговорок (hedge_groups), если в факте
    // стоит любой маркер той же группы («минимум 5 лет» при факте «не менее 5 лет»); в факте есть общая основа маркера
    // («гарантируем» при факте «гарантия 12 месяцев»); маркер дальше embellish_window слов от числа и от ключевого слова
    // фактов элемента (инструкция читателю «запишитесь минимум за неделю» к факту не относится).
    if (R.embellish.length && (el.facts || []).length) {
      const factsText = (el.facts || []).map(id => R.factText[id] || '').join(' ');
      const factWords = lcWords(factsText);
      const sameGroup = hit => {
        const hw = lcWords(hit);
        const g = (R.hedge?.groups || []).find(x => x.markers.some(mk => mk.length === hw.length && markerAt(hw, 0, mk)));
        return !!g && groupInText(factWords, g);
      };
      const stemOf = w => w.slice(0, Math.max(4, Math.min(6, w.length - 2)));
      const sameStem = hit => { const ws = lcWords(hit).filter(w => w.length >= 4); return ws.length > 0 && ws.every(w => factWords.some(fw => fw.startsWith(stemOf(w)))); };
      const keys = new Set(factWords.filter(w => w.length >= 5).map(w => w.slice(0, 5)));
      const nearFact = (s, idx, len) => {
        const toks = [...s.toLowerCase().matchAll(/[а-яa-z0-9]+/g)].map(t => ({ w: t[0], i: t.index }));
        const own = toks.map((t, k) => (t.i >= idx && t.i < idx + len ? k : -1)).filter(k => k >= 0);
        if (!own.length) return true;
        const from = own[0], to = own[own.length - 1];
        return toks.some((t, k) => !own.includes(k) && Math.min(Math.abs(k - from), Math.abs(k - to)) <= R.embellishWindow && (/^\d/.test(t.w) || (t.w.length >= 5 && keys.has(t.w.slice(0, 5)))));
      };
      for (const { field, text } of texts) {
        if (!zoneOf(el.kind, field)) continue;
        for (const s of splitSentences(String(text).replace(PLACEHOLDER_RE, ' '))) {
          const hits = [];
          for (const e of R.embellish) for (const m of s.matchAll(e.re)) {
            if (/(^|[^а-яa-z])не\s+$/i.test(s.slice(Math.max(0, m.index - 4), m.index))) continue;
            if (e.test.test(factsText) || sameGroup(m[0]) || sameStem(m[0])) continue;
            if (!nearFact(s, m.index, m[0].length)) continue;
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
export const showMinor = rule => /^(ai|style)\./.test(rule) || rule === 'fact.claim-unsupported' || rule === 'word.overuse';
