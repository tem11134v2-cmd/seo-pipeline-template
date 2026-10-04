// Тесты пакета W3 kit /site-tekst: импорт анализа, контакты и реквизиты, карта, снимки страниц, воркфлоу фазы 0.
//   node .claude/tests/site-tekst/cases-import.mjs      код выхода 0 - все прошли (последняя строка - сводка).
// Разделы: contacts.mjs; import-project (конкуренты, F901-F907, d10 (и формат журнала W3b), ИНН/ОГРН, no_phone, до гейта, company_origin, --company-facts в режиме doc,
// --facts-only с дайджестом и снятием полей анализа, факты оператора, d3, wording и note); import-structure (адреса, parent, legal/ui_role,
// служебные, шаблоны, listing); fetch-page на локальном http-сервере (cp1251, редирект, error и closed, --text-from,
// footer_text, путь через curl, флаги curl); read-faq-input (ui_role); wf-00 (порядок, --company-facts после снимка, составитель, роли), wf-02 (каталоги);
// программа 28.09 (пакет P2): маркер снятия K2, поля d10 absent, снятие контактных фактов о них и каналы снимка K1, отпечаток
// анализа K3, сверка обогатителя --check-enrich K4 (и стык с командами wf-04), ключевая фраза K5, перенос фактов оператора K11, 50 фактов, причины, cta-final, промты.
// Все во временных папках (os.tmpdir()), без сети и без данных клиентов; сервер - отдельный процесс на 127.0.0.1.
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL, domainToASCII } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');
const TPL = path.resolve(HERE, '..', '..', 'skills', 'site-tekst', 'kit');
const { validate } = await import(pathToFileURL(path.join(TPL, 'scripts', 'lib.mjs')).href);
const C = await import(pathToFileURL(path.join(TPL, 'scripts', 'contacts.mjs')).href);
const FP = await import(pathToFileURL(path.join(TPL, 'scripts', 'fetch-page.mjs')).href);

let pass = 0, fail = 0;
const failures = [], notes = [];
function check(name, ok, detail = '') {
  if (ok) pass++;
  else { fail++; failures.push(`FAIL ${name}${detail ? ': ' + String(detail).slice(0, 700) : ''}`); }
}
const rj = f => JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, ''));
const wj = (f, o) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(o, null, 2) + '\n'); };
const wt = (f, s) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, s); };
const clone = o => JSON.parse(JSON.stringify(o));
const SCHEMAS = {};
const schemaErrors = (name, data) => validate(SCHEMAS[name] ??= rj(path.join(TPL, 'schemas', `${name}.schema.json`)), data);
const checkSchema = (label, name, data) => { const e = schemaErrors(name, data); check(`${label} проходит схему ${name}`, !e.length, e.slice(0, 3).join('; ')); };
function run(cwd, args, env = {}) {
  const r = spawnSync(process.execPath, args, { cwd, encoding: 'utf8', env: { ...process.env, ...env }, timeout: 120000 });
  return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '', out: (r.stdout || '') + (r.stderr || '') };
}
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cases-import-'));
function mkProject(name, patchCfg) {
  const dir = path.join(tmpRoot, name);
  for (const d of ['scripts', 'rules', 'schemas', 'config']) fs.cpSync(path.join(TPL, d), path.join(dir, d), { recursive: true });
  if (patchCfg) { const f = path.join(dir, 'config', 'project.json'); const c = rj(f); patchCfg(c); wj(f, c); }
  return dir;
}
const W = (dir, ...p) => path.join(dir, 'work', ...p);
let server = null;

// ---------- синтетический анализ ----------
const LONG = 'Гарантия на работы 12 месяцев с даты подписания акта при условии, что изделие эксплуатировалось по инструкции, не вскрывалось третьими лицами и было возвращено в мастерскую в оригинальной упаковке';
const PROJECT = {
  v: 2, slug: 'test-co', updated: '2026-09-27', source: ['бриф'], tier: 'basic',
  gates: { promise: true, facts3: true, proof1: true, ready: true },
  business: {
    name: 'Тест Мастер', what: 'Ремонт бытовой техники на дому', region: 'Тула', geo: ['Тула'], site: 'https://test-co.example', since: 2015,
    type: 'services', site_kind: 'multipage', sig: [],
    directions: [{ id: 'remont', name: 'Ремонт техники', marker: 'ремонт техники', url: '/remont', serves: ['home'] }],
    legal: { entity: 'ООО «Тест»', inn: '7700000000', ogrn: '1027700000000', address: 'Тула, ул. Примерная, д. 1', phone: '8-495-000-00-01', email: 'info@test-co.example', schedule: 'пн-пт 9:00-18:00' },
  },
  offer: { positioning: 'Ремонт на дому за один визит', promise: { who: 'владельцы техники', result: 'техника снова работает', how: 'выезд мастера', cta: 'Мастер приедет сегодня' }, limits: ['не обещаем ремонт любой техники'], tone: 'деловой, на вы' },
  audience: { segments: [{ id: 'home', name: 'Хозяин квартиры', who: 'Житель города', pain: ['сломалась техника'], objection: [{ says: 'дорого', answer: 'цена до начала работ', facts: [] }], choose: ['скорость'] }], words: [{ say: 'чтобы работало', means: 'исправная техника' }] },
  competitors: { list: ['example-one.ru', 'okna-primer.ru - производство окон', 'Окна Лидер - lider-okon.ru', 'Имя - пример.рф', 'https://www.site-two.ru/catalog', 'Stroy.RU - stroy-center.ru (сеть)', 'г.Тула', 'page.html', 'Без домена'], market: {} },
  facts: [
    { id: 'f01', label: 'год основания', value: 'работаем с 2015 года', kind: 'number', publish: 'yes', src: 'бриф' },
    { id: 'f02', label: 'WhatsApp', value: '8-906-000-00-02', kind: 'contact', publish: 'yes', src: 'сайт' },
    { id: 'f03', label: 'MAX и Telegram', value: '8-969-000-00-03', kind: 'contact', publish: 'yes', src: 'сайт' },
    { id: 'f04', label: 'Основной телефон', value: '8-495-000-00-01', kind: 'contact', publish: 'yes', src: 'бриф' },
    { id: 'f05', label: 'График работы', value: 'пн-пт 9:00-18:00', kind: 'contact', publish: 'yes', src: 'бриф' },
    { id: 'f06', label: 'гарантия на ремонт', value: LONG, kind: 'claim', publish: 'yes', src: 'бриф' },
  ],
  constraints: {}, lexicon: {}, gaps: [{ id: 'g1', ask: 'цены на выезд' }],
};
const SITE = path.join(tmpRoot, 'sites', '001-test');
const Q_WAIVER = path.join(SITE, 'queue.json');
const Q_OLD = path.join(SITE, 'queue-old.json');
const Q_EDIT = path.join(SITE, 'queue-edit.json');
wj(Q_WAIVER, { gate: { approved: true, by: 'заказчик', at: '2026-09-27' }, journal: [{ id: 'j1', kind: 'waiver', subject: 'молчание по решению d10 - контакты и реквизиты для сайта', ground: 'заказчик не поправил, принят рекомендованный дефолт' }] });
wj(Q_OLD, { gate: { approved: true, by: 'заказчик', at: '2026-09-27' }, journal: [] });
wj(Q_EDIT, { gate: { approved: true }, journal: [{ id: 'j3', kind: 'decision', subject: 'правка по решению d10 - контакты и реквизиты', ground: 'телефон: 8-495-000-00-09' }] });
// записи журнала в формате apply-answers анализа (W3b): правка - gap + сопутствующие dropped, подтверждение - waiver
const Q_W3B_EDIT = path.join(SITE, 'queue-w3b-edit.json');
const Q_W3B_OK = path.join(SITE, 'queue-w3b-ok.json');
const Q_VERNO = path.join(SITE, 'queue-verno.json');
const Q_UNGATED = path.join(SITE, 'queue-ungated.json');
wj(Q_W3B_EDIT, { gate: { approved: true }, journal: [
  { id: 'j1', kind: 'dropped', subject: 'd10 контакты и реквизиты: «кроме адреса»', ground: 'кусок ответа не разобран' },
  { id: 'j2', kind: 'gap', subject: 'правка по решению d10 - контакты и реквизиты', ground: 'ответ «Все верно, кроме адреса» не разобран в поля - контакты не сверены, сверь с заказчиком' },
] });
wj(Q_W3B_OK, { gate: { approved: true }, journal: [{ id: 'j1', kind: 'waiver', subject: 'подтверждение по решению d10 - контакты и реквизиты', ground: 'заказчик ответил «верно»: контакты и реквизиты верны' }] });
wj(Q_VERNO, { gate: { approved: true }, journal: [{ id: 'j4', kind: 'decision', subject: 'ответ по решению d10 - контакты и реквизиты', ground: 'заказчик написал «все верно, подтверждаю, но телефон другой»' }] });
wj(Q_UNGATED, { gate: { approved: false }, journal: [] });
function importCase(name, patch, queue = Q_WAIVER, extra = []) {
  const dir = mkProject(name);
  const p = clone(PROJECT);
  if (patch) patch(p);
  const pf = path.join(SITE, `project-${name}.json`);
  wj(pf, p);
  const r = run(dir, ['scripts/import-project.mjs', '--project', pf, '--queue', queue, ...extra]);
  return { dir, pf, r, facts: r.code === 0 ? rj(W(dir, 'facts.json')) : null, rep: r.code === 0 ? rj(W(dir, 'import-report.json')) : null };
}
const byId = (facts, id) => (facts && facts.facts.find(f => f.id === id)) || null;

try {
  // ================================================================== 1. contacts.mjs
  {
    check('contacts: normalizePhoneRu - 8, +7, 10 цифр, скобки', C.normalizePhoneRu('8-495-642-07-30') === '+7 (495) 642-07-30' && C.normalizePhoneRu('+7(999)1234567') === '+7 (999) 123-45-67' && C.normalizePhoneRu('(495) 642-07-30') === '+7 (495) 642-07-30' && C.normalizePhoneRu('84956420730') === '+7 (495) 642-07-30');
    check('contacts: не российские и не телефоны - null, phoneFormat оставляет как есть', C.normalizePhoneRu('+44 20 7946 0958') === null && C.normalizePhoneRu('7721816292') === null && C.phoneFormat('+44 20 7946 0958') === '+44 20 7946 0958');
    check('contacts: phoneDigits сравнивает 8 и +7', C.phoneDigits('8 (495) 642-07-30') === C.phoneDigits('+7 495 642 07 30') && C.phoneDigits('8 (495) 642-07-30') === '74956420730');
    check('contacts: telHref, waHref, tgHref', C.telHref('8-495-642-07-30') === 'tel:+74956420730' && C.waHref('8-906-073-47-18') === 'https://wa.me/79060734718' && C.tgHref('8-969-346-36-80') === 'https://t.me/+79693463680' && C.tgHref('@test_nick') === 'https://t.me/test_nick' && C.telHref('звоните') === '');
    check('contacts: формат телефонов в тексте, ИНН и ОГРН не трогаются', C.formatPhonesInText('WhatsApp: 8-906-073-47-18, ИНН 7721816292, ОГРН 5137746188157') === 'WhatsApp: +7 (906) 073-47-18, ИНН 7721816292, ОГРН 5137746188157');
    const ch = C.buildChannels([
      { id: 'F39', kind: 'contact', label: 'WhatsApp', value: '8-906-073-47-18', publish: 'yes', source_quote: '[сайт] x' },
      { id: 'F40', kind: 'contact', label: 'MAX и Telegram', value: '8-969-346-36-80', publish: 'yes', source_quote: '[сайт] x' },
      { id: 'F41', kind: 'contact', label: 'Основной телефон', value: '8-495-642-07-30', publish: 'yes', source_quote: '[бриф] группа https://vk.com/test' },
      { id: 'F42', kind: 'contact', label: 'Viber', value: '8-900-000-00-00', publish: 'no', source_quote: '[бриф] x' },
    ], { channels: { youtube: 'https://youtube.com/@test' } });
    check('contacts: buildChannels - объекты, ссылка по номеру только WhatsApp и Telegram', ch.whatsapp?.href === 'https://wa.me/79060734718' && ch.whatsapp.fact === 'F39' && ch.telegram?.href === 'https://t.me/+79693463680' && ch.max?.href === '' && ch.max.fact === 'F40', JSON.stringify(ch));
    check('contacts: buildChannels - старая форма строкой читается, ссылка из цитаты, главный телефон не в мессенджер, publish no пропущен', ch.youtube?.href === 'https://youtube.com/@test' && ch.vk?.href === 'https://vk.com/test' && !ch.viber && !Object.values(ch).some(c => c.href && c.href.includes('74956420730')), JSON.stringify(ch));
    check('contacts: readChannel - строка и объект', C.readChannel('telegram', 'https://t.me/x').href === 'https://t.me/x' && C.readChannel('whatsapp', { label: 'WhatsApp', value: '1', href: 'wa.me/1' }).href === '');
  }

  // ================================================================== 2. import-project: конкуренты, контакты, d10, render
  const base = importCase('base');
  {
    const { r, facts, rep, dir } = base;
    check('import: код 0', r.code === 0, r.out);
    const seed = r.code === 0 ? rj(W(dir, 'competitors', 'seed.json')) : { domains: [] };
    checkSchema('import: seed.json', 'competitors-seed', seed);
    const D = d => seed.domains.find(x => x.domain === d);
    const puny = domainToASCII('пример.рф');
    check('конкуренты: голый домен, «домен - описание», «Имя - домен», URL с www и путем', !!D('example-one.ru') && D('okna-primer.ru')?.name === 'производство окон' && D('lider-okon.ru')?.name === 'Окна Лидер' && !!D('site-two.ru'), JSON.stringify(seed.domains));
    check('конкуренты: .рф хранится в punycode, юникод - в name', puny === 'xn--e1afmkfd.xn--p1ai' && D(puny)?.name === 'Имя (пример.рф)', JSON.stringify(D(puny)));
    check('конкуренты: из двух доменов - написанный строчными, пометки в скобках не в name', !!D('stroy-center.ru') && D('stroy-center.ru').name === 'Stroy.RU' && D('stroy-center.ru').raw === 'Stroy.RU - stroy-center.ru (сеть)', JSON.stringify(D('stroy-center.ru')));
    check('конкуренты: «г.Тула», файл и строка без домена - rejected', JSON.stringify(seed.rejected) === JSON.stringify(['г.Тула', 'page.html', 'Без домена']) && seed.domains.length === 6, JSON.stringify(seed.rejected));
    check('схема затравки принимает punycode и не принимает кириллицу', !schemaErrors('competitors-seed', { source: 's', generated_at: 'x', domains: [{ domain: 'xn--e1afmkfd.xn--p1ai', source: 'analysis' }] }).length && schemaErrors('competitors-seed', { source: 's', generated_at: 'x', domains: [{ domain: 'пример.рф', source: 'analysis' }] }).length > 0);

    checkSchema('import: facts.json', 'facts', facts || {});
    checkSchema('import: import-report.json', 'import-report', rep || {});
    const co = facts?.company || {};
    check('C2: company - телефон в едином формате, ИНН и ОГРН, d10 принят - confirmed', co.status === 'confirmed' && co.phones?.[0] === '+7 (495) 000-00-01' && co.inn === '7700000000' && co.ogrn === '1027700000000', JSON.stringify(co));
    check('C2: дубли фактов анализа не заводятся (телефон по цифрам - F04, часы - F05)', !byId(facts, 'F901') && !byId(facts, 'F905') && (rep?.heuristic || []).some(h => /F901 -> F04/.test(h.items.join()) && /F905 -> F05/.test(h.items.join())), JSON.stringify(rep?.heuristic));
    const f904 = byId(facts, 'F904'), f906 = byId(facts, 'F906'), f907 = byId(facts, 'F907');
    check('C2: F904 почта, F906 адрес - contact, publish yes, цитата [анализ]', f904?.value === 'info@test-co.example' && f904.kind === 'contact' && f904.publish === 'yes' && f906?.value === 'Тула, ул. Примерная, д. 1' && /^\[анализ\] business\.legal\.address: /.test(f906.source_quote), JSON.stringify([f904, f906]));
    check('C2: F907 юрлицо, ИНН, ОГРН одной строкой, kind legal', f907?.value === 'ООО «Тест», ИНН 7700000000, ОГРН 1027700000000' && f907.kind === 'legal', JSON.stringify(f907));
    check('C2: wording телефона анализа в едином формате, value как в источнике', byId(facts, 'F04')?.wording.includes(co.phones?.[0]) && byId(facts, 'F04').value === '8-495-000-00-01', JSON.stringify(byId(facts, 'F04')));
    check('C2: channels - объекты из фактов-мессенджеров', co.channels?.whatsapp?.href === 'https://wa.me/79060000002' && co.channels?.telegram?.href === 'https://t.me/+79690000003' && co.channels?.max?.href === '', JSON.stringify(co.channels));
    check('C2: сверено - строки «не сверены» нет, company_missing пуст, contact_facts в отчете', !facts.gaps.some(g => /^контакты и реквизиты не сверены/.test(g)) && JSON.stringify(rep.company_missing) === '[]' && JSON.stringify(rep.contact_facts) === JSON.stringify(['F904', 'F906', 'F907']), JSON.stringify({ g: facts.gaps, m: rep.company_missing, c: rep.contact_facts }));
    check('import: d10 в решениях гейта отчета', rep.gate.decisions.d10?.name === 'контакты и реквизиты для сайта' && /телефон: 8-495-000-00-01/.test(rep.gate.decisions.d10.value) && /молчание заказчика/.test(rep.gate.decisions.d10.how), JSON.stringify(rep.gate.decisions.d10));
    const f06 = byId(facts, 'F06');
    check('makeWording: обрезка съела хвост - полный текст в note и предупреждение', f06 && [...f06.wording].length <= 160 && f06.note?.includes('оригинальной упаковке') && rep.warnings.some(w => /^F06: value длиннее 160/.test(w)), JSON.stringify(f06));
    check('import: дайджест фактов анализа без F9xx', rep.facts_digest && Object.keys(rep.facts_digest).join() === 'F01,F02,F03,F04,F05,F06', JSON.stringify(rep.facts_digest));
    const md = fs.readFileSync(path.join(dir, 'inputs', 'analysis.md'), 'utf8');
    check('render: заголовок d3 «Текст главной кнопки: что получит клиент»', md.includes('- Текст главной кнопки: что получит клиент (d3): Мастер приедет сегодня') && !md.includes('Главное действие на сайте'));
    check('render: конкурент .рф - ASCII, юникод и имя', md.includes('- xn--e1afmkfd.xn--p1ai (пример.рф) - Имя (пример.рф)'), md.split('## Конкуренты')[1]?.slice(0, 400));
    check('render: служебные факты в разделе «Факты», все цитаты находятся', md.includes('- F907 [анализ] Юрлицо и реквизиты: ') && facts.facts.every(f => md.includes(f.source_quote)) && rep.counts.quotes_in_render === facts.facts.length);
    check('render: без буквы е с точками и длинных тире', !/[\u0451\u0401\u2014\u2013]/.test(md));
  }
  {
    const o = importCase('old-d10', null, Q_OLD);
    check('d10: старый анализ без решения - не сверены, причина в gaps', o.r.code === 0 && o.facts.company.status === 'from_site_unconfirmed' && o.facts.gaps.some(g => g === 'контакты и реквизиты не сверены заказчиком (в анализе нет решения d10): F904, F906, F907 - подтвердить до публикации'), o.r.code ? o.r.out : JSON.stringify(o.facts.gaps));
    const e = importCase('edit-d10', null, Q_EDIT);
    check('d10: правка заказчика - не сверены, id записи журнала в причине', e.r.code === 0 && e.facts.company.status === 'from_site_unconfirmed' && e.facts.gaps.some(g => /^контакты и реквизиты не сверены заказчиком \(по d10 прислана правка \(j3\)\)/.test(g)), e.r.code ? e.r.out : JSON.stringify(e.facts.gaps));
    const w = importCase('w3b-edit-d10', null, Q_W3B_EDIT);
    check('d10 (формат W3b): gap с цитатой «Все верно» и dropped - правка, причина по главной записи j2', w.r.code === 0 && w.facts.company.status === 'from_site_unconfirmed' && w.facts.gaps.some(g => /^контакты и реквизиты не сверены заказчиком \(по d10 прислана правка \(j2\)\)/.test(g)), w.r.code ? w.r.out : JSON.stringify(w.facts.gaps));
    check('d10: запись журнала «правка по решению d10» не дублирует строку о несверенных контактах', w.facts && !w.facts.gaps.some(g => /^журнал гейта \(j2\)/.test(g)) && w.facts.gaps.filter(g => /d10/.test(g)).length === 1, JSON.stringify(w.facts?.gaps));
    const k = importCase('w3b-ok-d10', null, Q_W3B_OK);
    check('d10 (формат W3b): waiver «подтверждение по решению d10» - confirmed', k.r.code === 0 && k.facts.company.status === 'confirmed' && !k.facts.gaps.some(g => /^контакты и реквизиты не сверены/.test(g)), k.r.code ? k.r.out : JSON.stringify(k.facts.gaps));
    const v = importCase('verno-d10', null, Q_VERNO);
    check('d10: запись не waiver со словами «верно», «подтверждаю» в ground - правка, не принятие', v.r.code === 0 && v.facts.company.status === 'from_site_unconfirmed' && v.facts.gaps.some(g => /прислана правка \(j4\)/.test(g)), v.r.code ? v.r.out : JSON.stringify(v.facts.company));
  }
  {
    // до гейта publish: no - «не подтверждено»: телефон из анализа остается в company, снимок за ним не идет
    const ug = importCase('ungated-unpub', p => { p.facts.find(f => f.id === 'f04').publish = 'no'; }, Q_UNGATED, ['--allow-ungated']);
    check('--allow-ungated: поле legal = факт publish no - остается в company, строки «снят заказчиком» нет', ug.r.code === 0 && ug.facts.company.phones?.[0] === '+7 (495) 000-00-01' && !ug.facts.gaps.some(g => /снят заказчиком/.test(g)) && !ug.rep.company_missing.includes('phones') && ug.facts.gaps.some(g => /^контакты и реквизиты не сверены заказчиком \(гейт анализа не пройден\)/.test(g)), ug.r.code ? ug.r.out : JSON.stringify({ c: ug.facts.company, g: ug.facts.gaps, m: ug.rep.company_missing }));
    const cf = run(ug.dir, ['scripts/import-project.mjs', '--company-facts']);
    const f2 = rj(W(ug.dir, 'facts.json'));
    check('--allow-ungated + --company-facts: телефон не снят', cf.code === 0 && f2.company.phones?.[0] === '+7 (495) 000-00-01' && !f2.gaps.some(g => /снят заказчиком/.test(g)), cf.out + JSON.stringify(f2.company));
  }
  {
    // мессенджер в label факта без kind: слова контакта из словаря CHANNELS (contacts.mjs)
    const kb = importCase('kind-bridge', p => { p.facts.push({ id: 'f07', label: 'Viber для заказов', value: '8-900-000-00-07', publish: 'yes', src: 'сайт' }); });
    check('kind: факт без kind с названием канала из словаря - contact', kb.r.code === 0 && byId(kb.facts, 'F07')?.kind === 'contact', kb.r.code ? kb.r.out : JSON.stringify(byId(kb.facts, 'F07')));
    const srcIp = fs.readFileSync(path.join(TPL, 'scripts', 'import-project.mjs'), 'utf8');
    check('import-project: названий мессенджеров нет (только словарь CHANNELS в contacts.mjs)', !/whats\s?app|telegram|телеграм|вотсап|youtube|ютуб|instagram|инстаграм|вконтакте/i.test(srcIp));
  }
  {
    const m = importCase('inn-mask', p => { p.business.legal.inn = '12345'; p.business.legal.ogrn = '1027700000000'; });
    const f907 = byId(m.facts, 'F907');
    check('ИНН неверной длины - не в company и не в F907, предупреждение', m.r.code === 0 && !m.facts.company.inn && f907?.value === 'ООО «Тест», ОГРН 1027700000000' && m.rep.warnings.some(w => /^INN «12345» неверной длины/.test(w)), m.r.code ? m.r.out : JSON.stringify([m.facts.company, f907]));
  }
  {
    // заказчик без телефона: из анализа и со старого сайта телефон не берется, снимок из-за телефона не нужен
    const pa = importCase('phone-absent', p => { p.business.legal = { entity: 'ООО «Тест»', address: 'Тула, ул. Примерная, д. 1', phone_absent: true }; p.facts = p.facts.filter(f => !['f04', 'f05'].includes(f.id)); });
    check('phone_absent анализа: company.no_phone (раздел 6.5), телефонов нет, F901 нет, gaps', pa.r.code === 0 && pa.facts.company.no_phone === true && !('phone_absent' in pa.facts.company) && !pa.facts.company.phones && !byId(pa.facts, 'F901') && pa.facts.gaps.some(g => /^телефона для сайта нет/.test(g)), pa.r.code ? pa.r.out : JSON.stringify(pa.facts.company));
    check('phone_absent: в company_missing нет телефона, есть часы', pa.rep && JSON.stringify(pa.rep.company_missing) === JSON.stringify(['hours']), JSON.stringify(pa.rep?.company_missing));
    // снимок все же записал телефон со старого сайта: --company-facts его снимает
    const ff = W(pa.dir, 'facts.json');
    const f = rj(ff);
    f.company.phones = ['8-800-000-00-00'];
    f.company.hours = 'ежедневно 10:00-20:00';
    f.company.source += ' + https://test-co.example/contacts';
    wj(ff, f);
    const cf = run(pa.dir, ['scripts/import-project.mjs', '--company-facts']);
    const f2 = rj(ff);
    check('phone_absent + --company-facts: телефон снят, F901 нет, часы F905 со снимка', cf.code === 0 && !f2.company.phones && !byId(f2, 'F901') && byId(f2, 'F905')?.value === 'ежедневно 10:00-20:00' && /^\[сайт\] https:\/\/test-co\.example\/contacts: /.test(byId(f2, 'F905').source_quote), cf.out + JSON.stringify(f2.company));
    check('phone_absent + --company-facts: поле со снимка не сверено - строка gaps с F905', f2.gaps.some(g => /^контакты и реквизиты не сверены заказчиком.*F905/.test(g)), JSON.stringify(f2.gaps));
    const org = rj(W(pa.dir, 'import-report.json')).company_origin || {};
    check('--company-facts: company_origin - часы со снимка, адрес и юрлицо из анализа', Object.keys(org).length === 3 && org.hours === 'site' && org.address === 'analysis' && org.legal_name === 'analysis', JSON.stringify(org));
    // старое имя флага в facts.json (phone_absent) читается и переводится в no_phone
    const f3 = rj(ff);
    delete f3.company.no_phone; f3.company.phone_absent = true; f3.company.phones = ['8-800-000-00-00'];
    wj(ff, f3);
    const cf2 = run(pa.dir, ['scripts/import-project.mjs', '--company-facts']);
    const f4 = rj(ff);
    check('--company-facts: старое phone_absent -> no_phone, телефон не взят', cf2.code === 0 && f4.company.no_phone === true && !('phone_absent' in f4.company) && !f4.company.phones && !byId(f4, 'F901'), cf2.out + JSON.stringify(f4.company));
  }
  {
    // снимок заполнил поле при confirmed и не дописал адрес в source: поле все равно со снимка (по company_origin)
    const sn = importCase('snap-nourl', p => { delete p.business.legal.schedule; p.facts = p.facts.filter(f => f.id !== 'f05'); });
    const ff = W(sn.dir, 'facts.json');
    const f = rj(ff);
    f.company.hours = 'пн-вс 8:00-22:00';
    wj(ff, f);
    const cf = run(sn.dir, ['scripts/import-project.mjs', '--company-facts']);
    const f2 = rj(ff);
    check('--company-facts: поле снимка без URL в source - цитата [сайт] site_url, строка gaps', cf.code === 0 && f2.company.status === 'confirmed' && /^\[сайт\] https:\/\/test-co\.example: /.test(byId(f2, 'F905')?.source_quote || '') && f2.gaps.some(g => /^контакты и реквизиты не сверены заказчиком \(сняты со старого сайта\): F905/.test(g)), cf.out + JSON.stringify([byId(f2, 'F905'), f2.gaps]));
  }
  {
    // publish no у факта анализа, совпавшего с полем legal: поле в company не пишется
    const un = importCase('unpub', p => { p.facts.find(f => f.id === 'f04').publish = 'no'; });
    check('поле legal = факт анализа publish no - снято из company, строка gaps', un.r.code === 0 && !un.facts.company.phones && !byId(un.facts, 'F901') && un.facts.gaps.some(g => /^телефон .* снят заказчиком \(F04 publish no\)/.test(g)), un.r.code ? un.r.out : JSON.stringify(un.facts.company));
  }

  // ================================================================== 3. --company-facts в режиме doc (без project.json и отчета)
  {
    const dir = mkProject('doc-mode');
    wt(path.join(dir, 'inputs', 'analysis.md'), '# Дамп документа\n\n## Пробелы\n\nтекст документа\n');
    wj(W(dir, 'facts.json'), {
      source: 'inputs/analysis.md', facts: [{ id: 'F01', label: 'год основания', value: 'с 2010 года', wording: 'С 2010 года', publish: 'yes', source_quote: 'работаем с 2010 года', kind: 'number' }],
      anti_promises: [], terminology: { use: [], jargon: [], untranslatable: [] },
      company: { brand: 'Док', status: 'missing', phones: ['8 (495) 111-22-33', '+7 495 111 22 33', '+44 20 7946 0958'], email: 'mail@doc.example', channels: { whatsapp: 'https://wa.me/79001112233' }, source: 'https://doc.example/contacts' },
      gaps: [],
    });
    const r1 = run(dir, ['scripts/import-project.mjs', '--company-facts']);
    const f = r1.code === 0 ? rj(W(dir, 'facts.json')) : { facts: [], company: {}, gaps: [] };
    check('--company-facts (doc): код 0 без project.json и гейта', r1.code === 0, r1.out);
    checkSchema('--company-facts (doc): facts.json', 'facts', f);
    check('--company-facts: телефоны в едином формате без повторов, иностранный как есть', JSON.stringify(f.company.phones) === JSON.stringify(['+7 (495) 111-22-33', '+44 20 7946 0958']), JSON.stringify(f.company.phones));
    check('--company-facts: F901 value как на сайте, wording в формате; F902 иностранный; F904 почта', byId(f, 'F901')?.value === '8 (495) 111-22-33' && byId(f, 'F901').wording === '+7 (495) 111-22-33' && byId(f, 'F902')?.value === '+44 20 7946 0958' && byId(f, 'F904')?.value === 'mail@doc.example' && /^\[сайт\] https:\/\/doc\.example\/contacts: /.test(byId(f, 'F901').source_quote), JSON.stringify(f.facts));
    // программа 28.09, K1: канал снимка без факта в company.channels не пишется - вопрос заказчику строкой gaps
    check('--company-facts: канал снимка строкой - не в company, строка gaps «канал со старого сайта», статус from_site_unconfirmed', !f.company.channels && f.gaps.includes('канал со старого сайта: WhatsApp https://wa.me/79001112233 - публиковать?') && f.company.status === 'from_site_unconfirmed' && f.gaps.some(g => /^контакты и реквизиты не сверены заказчиком \(сняты со старого сайта\): F901, F902, F904/.test(g)), JSON.stringify({ c: f.company, g: f.gaps }));
    check('--company-facts (doc): дамп анализа не перерисован, отчета нет', fs.readFileSync(path.join(dir, 'inputs', 'analysis.md'), 'utf8').includes('текст документа') && !fs.existsSync(W(dir, 'import-report.json')));
    const r2 = run(dir, ['scripts/import-project.mjs', '--company-facts']);
    const f2 = rj(W(dir, 'facts.json'));
    check('--company-facts: повтор - те же факты, без дублей строк gaps', r2.code === 0 && JSON.stringify(f2.facts) === JSON.stringify(f.facts) && f2.gaps.filter(g => /^контакты и реквизиты/.test(g)).length === 1, r2.out);
    check('--company-facts: нет facts.json - код 2', run(mkProject('doc-empty'), ['scripts/import-project.mjs', '--company-facts']).code === 2);
  }

  // ================================================================== 4. --facts-only
  {
    const fo = importCase('facts-only', p => { delete p.business.legal.schedule; p.facts = p.facts.filter(f => f.id !== 'f05'); });
    const { dir, pf } = fo;
    const ff = W(dir, 'facts.json'), rf = W(dir, 'import-report.json');
    const FO = (...x) => run(dir, ['scripts/import-project.mjs', '--project', pf, '--queue', Q_WAIVER, '--facts-only', ...x]);
    check('--facts-only: база - код 0, company_missing часы', fo.r.code === 0 && JSON.stringify(fo.rep.company_missing) === JSON.stringify(['hours']), fo.r.out);
    // снимок дописал часы -> --company-facts -> F905; следующий --facts-only не видит «ручной правки»
    const f = rj(ff);
    f.company.hours = 'пн-сб 10:00-20:00';
    f.company.source += ' + https://test-co.example/contacts';
    wj(ff, f);
    const cf = run(dir, ['scripts/import-project.mjs', '--company-facts']);
    check('--company-facts после импорта: F905 со снимка, дайджест не изменен', cf.code === 0 && byId(rj(ff), 'F905')?.value === 'пн-сб 10:00-20:00' && JSON.stringify(rj(rf).facts_digest) === JSON.stringify(fo.rep.facts_digest), cf.out);
    const cfgBefore = fs.readFileSync(path.join(dir, 'config', 'project.json'), 'utf8');
    const r0 = FO();
    const f0 = rj(ff), rep0 = rj(rf);
    check('--facts-only: после --company-facts - код 0 (F9xx не ручная правка)', r0.code === 0, r0.out);
    check('--facts-only: часы со снимка сохранены (company и F905)', f0.company.hours === 'пн-сб 10:00-20:00' && byId(f0, 'F905')?.value === 'пн-сб 10:00-20:00', JSON.stringify(f0.company));
    check('--facts-only: антиобещания, терминология и конфиг не тронуты, отчет с mode', JSON.stringify(f0.anti_promises) === JSON.stringify(f.anti_promises) && fs.readFileSync(path.join(dir, 'config', 'project.json'), 'utf8') === cfgBefore && rep0.mode === 'facts-only' && JSON.stringify(rep0.facts_diff.added) === '[]', JSON.stringify(rep0.facts_diff));
    checkSchema('--facts-only: import-report.json', 'import-report', rep0);
    // ручная правка facts.json - код 3, файл не тронут; --force - перезапись
    const hand = rj(ff);
    hand.facts.find(x => x.id === 'F01').wording = 'Работаем уже давно';
    wj(ff, hand);
    const r3 = FO();
    check('--facts-only: ручная правка facts.json - код 3, дифф по id, файл не тронут', r3.code === 3 && /изменены \(value, wording или publish\): F01/.test(r3.stderr) && rj(ff).facts.find(x => x.id === 'F01').wording === 'Работаем уже давно', r3.out);
    const rF = FO('--force');
    check('--facts-only --force: код 0, факт анализа восстановлен', rF.code === 0 && byId(rj(ff), 'F01').wording !== 'Работаем уже давно', rF.out);
    // факт оператора F801 не ручная правка и сохраняется
    const op = rj(ff);
    op.facts.push({ id: 'F801', label: 'срок выезда', value: 'выезд в день заявки', wording: 'Выезд в день заявки', publish: 'yes', source_quote: 'оператор: ответ заказчика в чате', kind: 'process', source: 'оператор: 2026-09-27 ответ заказчика' });
    wj(ff, op);
    const r8 = FO();
    check('--facts-only: факт оператора F801 - не ручная правка, сохранен', r8.code === 0 && byId(rj(ff), 'F801')?.source === 'оператор: 2026-09-27 ответ заказчика', r8.out);
    // правка анализа: новый телефон в legal и новый факт; ЦА изменилась - предупреждение
    const p2 = rj(pf);
    p2.business.legal.phone = '8-495-000-00-09';
    p2.facts.push({ id: 'f07', label: 'выезд', value: 'выезд по городу бесплатно', kind: 'claim', publish: 'yes', src: 'созвон' });
    p2.audience.segments[0].name = 'Хозяин дома';
    wj(pf, p2);
    const r9 = FO();
    const f9 = rj(ff), rep9 = rj(rf);
    check('--facts-only: новый телефон анализа - в company.phones и F901, часы снимка на месте', r9.code === 0 && f9.company.phones?.[0] === '+7 (495) 000-00-09' && byId(f9, 'F901')?.value === '8-495-000-00-09' && f9.company.hours === 'пн-сб 10:00-20:00' && !!byId(f9, 'F905'), r9.out + JSON.stringify(f9.company));
    check('--facts-only: facts_diff.added F07, other_changed audience с предупреждением', JSON.stringify(rep9.facts_diff?.added) === JSON.stringify(['F07']) && (rep9.other_changed || []).includes('audience') && /нужен повтор фазы 0/.test(r9.stdout) && !!byId(f9, 'F07') && !!byId(f9, 'F801'), JSON.stringify({ d: rep9.facts_diff, o: rep9.other_changed }));
    check('--facts-only: audience.json не переписан', rj(W(dir, 'audience.json')).segments[0].name === 'Хозяин квартиры');
    const md = fs.readFileSync(path.join(dir, 'inputs', 'analysis.md'), 'utf8');
    check('--facts-only: разделы «Факты» и «Пробелы» analysis.md перерисованы', md.includes('- F07 [созвон] выезд: выезд по городу бесплатно') && md.includes('- F801 [оператор: 2026-09-27 ответ заказчика] срок выезда: выезд в день заявки') && /\n## Пробелы\n/.test(md) && /\n## Терминология\n/.test(md), md.split('## Факты')[1]?.slice(0, 300));
    // старая задача без дайджеста: сверка с тем, что дает анализ сейчас
    const rOld = rj(rf); delete rOld.facts_digest; wj(rf, rOld);
    check('--facts-only без дайджеста: факты совпадают с анализом - код 0', FO().code === 0);
    const rOld2 = rj(rf); delete rOld2.facts_digest; wj(rf, rOld2);
    const h2 = rj(ff); h2.facts.find(x => x.id === 'F07').publish = 'no'; wj(ff, h2);
    const rNo = FO();
    check('--facts-only без дайджеста: расхождение - код 3 с пометкой о старой задаче', rNo.code === 3 && /нет дайджеста фактов/.test(rNo.stderr) && /F07/.test(rNo.stderr), rNo.out);
    check('--facts-only: нет facts.json - код 2', run(mkProject('fo-empty'), ['scripts/import-project.mjs', '--project', pf, '--queue', Q_WAIVER, '--facts-only']).code === 2);
    check('--facts-only: гейт не согласован - код 2', run(dir, ['scripts/import-project.mjs', '--project', pf, '--queue', path.join(SITE, 'nope.json'), '--facts-only']).code === 2);
    // полный повтор импорта сохраняет факты оператора
    const rr = run(dir, ['scripts/import-project.mjs', '--project', pf, '--queue', Q_WAIVER]);
    check('полный повтор импорта: факт оператора F801 сохранен с предупреждением', rr.code === 0 && !!byId(rj(ff), 'F801') && /факты оператора сохранены/.test(rr.stdout), rr.out);
  }
  {
    // ответ заказчика по d10 снял адрес (apply-answers удаляет business.legal.address): --facts-only убирает адрес
    // прошлого анализа из company и F906, часы снимка сайта остаются; повторы не множат source
    const rm = importCase('fo-remove', p => { delete p.business.legal.schedule; p.facts = p.facts.filter(f => f.id !== 'f05'); });
    const { dir, pf } = rm;
    const ff = W(dir, 'facts.json'), rf = W(dir, 'import-report.json');
    check('--facts-only (снятие): база - адрес в company и F906', rm.r.code === 0 && !!rm.facts.company.address && !!byId(rm.facts, 'F906'), rm.r.out);
    const f = rj(ff);
    f.company.hours = 'пн-сб 10:00-20:00';
    f.company.source += ' + https://test-co.example/contacts';
    wj(ff, f);
    run(dir, ['scripts/import-project.mjs', '--company-facts']);
    const p2 = rj(pf);
    delete p2.business.legal.address;
    wj(pf, p2);
    let rs = [];
    for (let i = 0; i < 3; i++) rs.push(run(dir, ['scripts/import-project.mjs', '--project', pf, '--queue', Q_W3B_EDIT, '--facts-only']));
    const f2 = rj(ff), rep2 = rj(rf);
    check('--facts-only (снятие): три повтора - код 0', rs.every(x => x.code === 0), rs.map(x => x.out).join('\n'));
    check('--facts-only (снятие): адреса нет ни в company, ни в F906, предупреждение', !f2.company.address && !byId(f2, 'F906') && /company\.address .* в анализе этого поля больше нет/.test(rs[0].stdout), JSON.stringify(f2.company) + rs[0].stdout);
    check('--facts-only (снятие): часы снимка на месте (company, F905 [сайт]), происхождение в отчете', f2.company.hours === 'пн-сб 10:00-20:00' && /^\[сайт\] /.test(byId(f2, 'F905')?.source_quote || '') && rep2.company_origin?.hours === 'site' && !rep2.company_origin?.address, JSON.stringify(rep2.company_origin));
    check('--facts-only (снятие): source без повторов', f2.company.source === 'project.json -> business.legal + https://test-co.example/contacts', f2.company.source);
    check('--facts-only (снятие): правка d10 - не сверено, причина j2, строки «журнал гейта» о d10 нет', f2.company.status === 'from_site_unconfirmed' && f2.gaps.some(g => /^контакты и реквизиты не сверены заказчиком \(по d10 прислана правка \(j2\)\)/.test(g)) && !f2.gaps.some(g => /^журнал гейта \(j2\)/.test(g)), JSON.stringify(f2.gaps));
    // полный повтор импорта дает тот же результат по адресу
    const full = run(dir, ['scripts/import-project.mjs', '--project', pf, '--queue', Q_W3B_EDIT]);
    check('полный импорт после снятия адреса - тоже без адреса и F906', full.code === 0 && !rj(ff).company.address && !byId(rj(ff), 'F906'), full.out);
  }

  // ================================================================== 5. import-structure
  {
    const STRUCT = { pages: [
      { url: '/', name: 'Главная', type: 'Главная', target_status: 'yes' },
      { url: 'https://test-co.example/uslugi/', name: 'Услуги', type: 'Категория', role: 'навигация', target_status: 'yes' },
      { url: '/uslugi/remont', name: 'Ремонт', type: 'Услуга', target_status: 'yes' },
      { url: 'https://www.test-co.example/uslugi/remont/tula/', name: 'Ремонт в Туле', type: 'Услуга', target_status: 'yes' },
      { url: '/katalog', name: 'Каталог', type: 'Категория', target_status: 'yes' },
      { url: '/katalog/{slug}', name: 'Карточка товара (шаблон)', type: 'Товар', target_status: 'yes' },
      { url: '/uslugi/[id]', name: 'Услуга (шаблон)', type: 'Услуга', target_status: 'yes' },
      { url: '/tovary/{slug}', name: 'Товар', type: '', target_status: 'yes' },
      { url: '/politika-konfidentsialnosti', name: 'Политика конфиденциальности', type: 'Прочее', target_status: 'yes' },
      { url: '/soglasie-na-obrabotku', name: 'Согласие на обработку', type: 'Прочее', target_status: 'yes' },
      { url: '/dokument', name: 'Публичная оферта', type: 'Прочее', target_status: 'yes' },
      { url: '/personal', name: 'Личный кабинет', type: 'Прочее', target_status: 'yes' },
      { url: '/sravnenie', name: 'Сравнение', type: 'Прочее', target_status: 'yes' },
      { url: '/izbrannoe', name: 'Избранное', type: 'Прочее', target_status: 'yes' },
      { url: 'https://other.example/x', name: 'Чужой', type: 'Инфо', target_status: 'yes' },
      { url: '/blog', name: 'Блог', type: 'Статья', target_status: 'yes' },
      { url: '/uslugi', name: 'Услуги (повтор)', type: 'Категория', target_status: 'yes' },
      { url: '/uslugi/remont?utm_source=x#top', name: 'Ремонт с меткой', type: 'Услуга', target_status: 'yes' },
    ] };
    const S1 = mkProject('struct-services', c => { c.site_url = 'https://test-co.example'; c.niche.business_type = 'services'; });
    wj(path.join(S1, 'inputs', 'structure_data.json'), STRUCT);
    const r = run(S1, ['scripts/import-structure.mjs']);
    const sm = r.code === 0 ? rj(W(S1, 'sitemap.json')) : { pages: [] };
    const G = u => sm.pages.find(p => p.url === u) || {};
    check('import-structure: код 0, карта проходит схему', r.code === 0 && !schemaErrors('sitemap', sm).length, r.out);
    check('import-structure: полный URL и слеш на конце -> путь; slug, level, parent от него', G('/uslugi').type === 'hub' && G('/uslugi').level === 0 && G('/uslugi').parent === '' && G('/uslugi/remont').parent === '/uslugi' && G('/uslugi/remont/tula').parent === '/uslugi/remont' && G('/uslugi/remont/tula').level === 2 && G('/uslugi/remont/tula').slug === 'uslugi-remont-tula', JSON.stringify(sm.pages.slice(0, 4)));
    check('import-structure: главная по пути, parent первого уровня пуст', G('/').type === 'home' && G('/').parent === '' && G('/remont').type === undefined);
    check('import-structure: юридические - skip и ui_role legal (адрес и название)', ['/politika-konfidentsialnosti', '/soglasie-na-obrabotku', '/dokument'].every(u => G(u).status === 'skip' && G(u).ui_role === 'legal'), JSON.stringify(sm.pages.filter(p => p.status === 'skip')));
    check('import-structure: служебные (сравнение, избранное) - skip без ui_role', ['/sravnenie', '/izbrannoe'].every(u => G(u).status === 'skip' && !G(u).ui_role && /служебная страница интерфейса/.test(G(u).notes)));
    check('import-structure: кабинет /personal - в работе, без ui_role', G('/personal').status === 'planned' && !G('/personal').ui_role);
    check('import-structure: шаблоны - template, тип из колонки важнее адреса', G('/katalog/{slug}').type === 'product' && G('/katalog/{slug}').template === true && G('/uslugi/[id]').type === 'service' && G('/uslugi/[id]').template === true && G('/tovary/{slug}').type === 'product' && G('/tovary/{slug}').template === true && !G('/uslugi/remont').template, JSON.stringify([G('/katalog/{slug}'), G('/uslugi/[id]'), G('/tovary/{slug}')]));
    check('import-structure: услуги - category без listing, волн нет', G('/katalog').type === 'category' && G('/katalog').listing === false && sm.pages.every(p => !('wave' in p)), JSON.stringify(G('/katalog')));
    check('import-structure: чужой хост - предупреждение, статья - в пропущенных', /хост other\.example не совпадает с сайтом проекта test-co\.example/.test(r.stdout) && rj(W(S1, 'sitemap.skipped.json')).some(x => x.url === '/blog'), r.stdout);
    const sk = r.code === 0 ? rj(W(S1, 'sitemap.skipped.json')) : [];
    check('import-structure: повтор адреса после приведения к пути (слеш, ?query, #якорь) - одна страница, повтор в пропущенных', sm.pages.filter(p => p.url === '/uslugi').length === 1 && G('/uslugi').subject === 'Услуги' && sm.pages.filter(p => p.url === '/uslugi/remont').length === 1 && ['/uslugi', '/uslugi/remont'].every(u => sk.some(x => x.url === u && /^повтор адреса после приведения к пути/.test(x.reason))), JSON.stringify(sk));
    const S2 = mkProject('struct-shop', c => { c.niche.business_type = 'catalog'; });
    wj(path.join(S2, 'inputs', 'structure_data.json'), STRUCT);
    const r2 = run(S2, ['scripts/import-structure.mjs']);
    const sm2 = r2.code === 0 ? rj(W(S2, 'sitemap.json')) : { pages: [] };
    check('import-structure: магазин - category с listing', r2.code === 0 && sm2.pages.find(p => p.url === '/katalog')?.listing === true, r2.out);
    const src = fs.readFileSync(path.join(TPL, 'scripts', 'import-structure.mjs'), 'utf8');
    check('import-structure: флага --skip-legal нет', !src.includes('skip-legal'));
    // import-project копирует структуру с адресами-путями
    const cp = importCase('struct-copy', null, Q_WAIVER, ['--structure', path.join(S1, 'inputs', 'structure_data.json')]);
    const sd = cp.r.code === 0 ? rj(path.join(cp.dir, 'inputs', 'structure_data.json')) : { pages: [] };
    check('import --structure: полные URL и слеш приведены к пути, направление по адресу', cp.r.code === 0 && sd.pages[1].url === '/uslugi' && sd.pages[3].url === '/uslugi/remont/tula' && cp.rep.structure.slash_fixed >= 3, cp.r.code ? cp.r.out : JSON.stringify(cp.rep.structure));
    check('import --structure и import-structure: одно правило пути (?query и #якорь сняты)', sd.pages[sd.pages.length - 1]?.url === '/uslugi/remont' && sk.some(x => x.url === '/uslugi/remont'), JSON.stringify(sd.pages[sd.pages.length - 1]));
  }

  // ================================================================== 6. fetch-page: локальный сервер (отдельный процесс)
  {
    const srvFile = path.join(tmpRoot, 'server.mjs');
    wt(srvFile, `import http from 'node:http';
const cp1251 = s => Buffer.from([...s].map(ch => { const c = ch.codePointAt(0); if (c < 128) return c; if (c >= 0x410 && c <= 0x44f) return c - 0x410 + 0xc0; if (c === 0xab || c === 0xbb) return c; return 0x3f; }));
const page = (t, b) => '<html><head><title>' + t + '</title></head><body>' + b + '</body></html>';
let port = 0;
const srv = http.createServer((req, res) => {
  const u = req.url;
  if (u === '/cp1251') { res.writeHead(200, { 'content-type': 'text/html; charset=windows-1251' }); return res.end(cp1251(page('Окна и двери', '<h1>Окна</h1><p>Текст страницы</p><footer>ООО «Тест», ИНН 7700000000</footer>'))); }
  if (u === '/meta1251') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(cp1251('<html><head><meta charset="windows-1251"><title>Мета кодировка</title></head><body><h1>Заголовок</h1></body></html>')); }
  if (u === '/redir') { res.writeHead(302, { location: '/sub/dir/final' }); return res.end(); }
  if (u === '/sub/dir/final') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(page('Финал', '<h1>Финал</h1><a href="child">Дочерняя</a><a href="/root?x=1">Корень</a><a href="http://127.0.0.1:' + port + '/abs#top">Абсолютная</a><a href="https://other.example/x">Чужая</a><a href="mailto:a@b.c">Почта</a><div class="site-footer">Телефон 8-495-000-00-01</div>')); }
  if (u === '/gone') { res.writeHead(404, { 'content-type': 'text/html' }); return res.end('<html><body>нет</body></html>'); }
  res.writeHead(200, { 'content-type': 'text/plain' }); res.end('ok');
});
srv.listen(0, '127.0.0.1', () => { port = srv.address().port; console.log('PORT ' + port); });
`);
    server = spawn(process.execPath, [srvFile], { stdio: ['ignore', 'pipe', 'pipe'] });
    const port = await new Promise((res, rej) => {
      let buf = '';
      const t = setTimeout(() => rej(new Error('сервер не стартовал')), 10000);
      server.stdout.on('data', d => { buf += d; const m = buf.match(/PORT (\d+)/); if (m) { clearTimeout(t); res(Number(m[1])); } });
      server.on('exit', c => rej(new Error('сервер завершился: ' + c)));
    });
    const base = `http://127.0.0.1:${port}`;
    const F = mkProject('fetch');
    const fetchTo = (u, name, extra = [], env = {}) => { const out = path.join(F, 'raw', `${name}.json`); const r = run(F, ['scripts/fetch-page.mjs', u, out, ...extra], env); return { r, j: fs.existsSync(out) ? rj(out) : {} }; };
    const a = fetchTo(`${base}/cp1251`, 'cp');
    check('fetch-page: cp1251 из Content-Type - текст раскодирован, html в utf-8', a.j.title === 'Окна и двери' && a.j.charset === 'windows-1251' && a.j.sections.some(s => s.text.includes('Текст страницы')) && fs.readFileSync(a.j.html_path, 'utf8').includes('Окна'), a.r.out + JSON.stringify(a.j).slice(0, 300));
    check('fetch-page: footer_text с реквизитами', /ИНН 7700000000/.test(a.j.footer_text || ''), a.j.footer_text);
    const m = fetchTo(`${base}/meta1251`, 'meta');
    check('fetch-page: кодировка из meta charset', m.j.title === 'Мета кодировка', JSON.stringify(m.j).slice(0, 200));
    const rd = fetchTo(`${base}/redir`, 'redir');
    const hrefs = (rd.j.links || []).map(l => l.href);
    check('fetch-page: редирект - база ссылок конечный адрес', rd.j.final_url === `${base}/sub/dir/final` && hrefs.includes(`${base}/sub/dir/child`) && hrefs.includes(`${base}/root`), JSON.stringify(rd.j.links));
    check('fetch-page: абсолютная своя ссылка без якоря, чужой хост и mailto отброшены', hrefs.includes(`${base}/abs`) && !hrefs.some(h => /other\.example|mailto/.test(h)), JSON.stringify(hrefs));
    const www = FP.linksFromHtml('<a href="https://www.site.example/a">А</a><a href="https://site.example/b">Б</a><a href="https://sub.site.example/c">В</a>', 'https://site.example/start');
    const wwwMd = FP.linksFromMarkdown('[А](https://www.site.example/a) [Б](/b "подсказка") [В](https://other.example/c)', 'https://www.site.example/start');
    check('fetch-page: хост без www - свой (html и md), поддомен и чужой - нет', JSON.stringify(www.map(l => l.href)) === JSON.stringify(['https://www.site.example/a', 'https://site.example/b']) && JSON.stringify(wwwMd.map(l => l.href)) === JSON.stringify(['https://www.site.example/a', 'https://www.site.example/b']), JSON.stringify([www, wwwMd]));
    check('fetch-page: footer_text по классу footer', /Телефон 8-495-000-00-01/.test(rd.j.footer_text || ''), rd.j.footer_text);
    const g = fetchTo(`${base}/gone`, 'gone');
    check('fetch-page: HTTP 404 - closed, не error', g.j.status === 'closed' && g.j.http_status === 404, JSON.stringify(g.j).slice(0, 200));
    // свободный порт без сервера: исключение - error (после повтора и curl), не closed
    const net = await import('node:net');
    const free = await new Promise(res => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
    const e = fetchTo(`http://127.0.0.1:${free}/`, 'err', ['--timeout', '3000'], { FETCH_PAGE_RETRY_MS: '50' });
    check('fetch-page: сайт не ответил - status error с cause, http 0', e.j.status === 'error' && e.j.http_status === 0 && /ECONNREFUSED|curl/.test(e.j.cause || ''), e.r.out + JSON.stringify(e.j).slice(0, 300));
    const md = path.join(F, 'page.browser.md');
    wt(md, '# Заголовок страницы\n\nТекст про [Контакты](/contacts) и [Чужой сайт](https://other.example/) и [Раздел](http://127.0.0.1:' + port + '/razdel "подсказка").\n\n## Раздел\n\nЕще текст раздела достаточной длины для секции.\n');
    const t = fetchTo(`${base}/page`, 'browser', ['--text-from', md]);
    const th = (t.j.links || []).map(l => l.href);
    check('fetch-page --text-from: ссылки [текст](url) своего хоста, текст без разметки ссылок', t.j.status === 'browser' && th.includes(`${base}/contacts`) && th.some(h => h.endsWith('/razdel')) && !th.some(h => /other\.example/.test(h)) && t.j.sections.some(s => s.text.includes('Текст про Контакты')), JSON.stringify(t.j).slice(0, 500));
    // путь через curl: функция вызывается напрямую (сервер в другом процессе)
    const cu = FP.pickCurl();
    if (cu) {
      const c1 = FP.fetchViaCurl(`${base}/redir`, { timeoutSec: 20 });
      check('curl: редирект, конечный адрес и код из -w', c1.ok && c1.http_status === 200 && c1.final_url === `${base}/sub/dir/final` && /text\/html/.test(c1.content_type), JSON.stringify({ ...c1, buf: undefined }));
      const c2 = FP.fetchViaCurl(`${base}/cp1251`, { timeoutSec: 20 });
      check('curl: тело в файле, cp1251 раскодируется по content_type', c2.ok && FP.decodeBody(c2.buf, c2.content_type).text.includes('Окна и двери'), c2.error || '');
      const c3 = FP.fetchViaCurl(`http://127.0.0.1:${free}/`, { timeoutSec: 5 });
      check('curl: соединение не удалось - cause curl:<код>', !c3.ok && /^curl:\d+/.test(c3.cause), JSON.stringify(c3));
    } else notes.push('пропущено: curl не найден, путь через curl не проверен');
    const v755 = 'curl 7.55.1 (Windows) libcurl/7.55.1 WinSSL\nRelease-Date: 2017-11-14\nProtocols: http https\nFeatures: AsynchDNS IPv6 Largefile SSPI Kerberos SPNEGO NTLM SSL\n';
    const v8 = 'curl 8.19.0 (x86_64-w64-mingw32) libcurl/8.19.0 Schannel zlib/1.3.2 brotli/1.2.0\nFeatures: alt-svc AsynchDNS brotli HSTS HTTP2 IPv6 Largefile libz NTLM SSL SSPI threadsafe UnixSockets zstd\n';
    const vLin = 'curl 8.5.0 (x86_64-pc-linux-gnu) libcurl/8.5.0 OpenSSL/3.0.13 zlib/1.3\nFeatures: alt-svc AsynchDNS HSTS HTTP2 HTTPS-proxy IPv6 Largefile libz NTLM SSL threadsafe UnixSockets\n';
    check('curl -V 7.55.1 WinSSL без libz: без --compressed, с --ssl-no-revoke', JSON.stringify(FP.curlFlags(v755, ' --ssl-no-revoke  Disable cert revocation checks (WinSSL)').flags) === JSON.stringify(['--ssl-no-revoke']));
    check('curl -V 8.x Schannel с libz: --compressed и --ssl-revoke-best-effort', JSON.stringify(FP.curlFlags(v8, ' --ssl-no-revoke ...\n --ssl-revoke-best-effort ...').flags) === JSON.stringify(['--compressed', '--ssl-revoke-best-effort']));
    check('curl -V OpenSSL: только --compressed', JSON.stringify(FP.curlFlags(vLin, '--ssl-no-revoke').flags) === JSON.stringify(['--compressed']));
  }

  // ================================================================== 7. read-faq-input: страницы интерфейса пропускаются
  {
    const R = path.join(tmpRoot, 'faqproj');
    const T = path.join(R, 'texts', '001-x');
    wj(path.join(T, 'meta.json'), { format: 'v9' });
    wj(path.join(T, 'config', 'project.json'), { slug: 'x', company: 'Икс', site_url: 'https://x.example', niche: { geo: 'Тула' } });
    wj(path.join(T, 'work', 'facts.json'), { company: { brand: 'Икс' }, terminology: {}, anti_promises: [] });
    const pages = [['home', '/', 'home'], ['uslugi', '/uslugi', 'service'], ['korzina', '/korzina', 'info_other', 'cart'], ['poisk', '/poisk', 'info_other', 'search'], ['kabinet', '/kabinet', 'info_other', 'account'], ['politika', '/politika', 'info_other', 'legal']];
    const mkMap = withRoles => wj(path.join(T, 'work', 'sitemap.json'), { pages: pages.map(([slug, url, type, role]) => ({ slug, url, type, subject: slug, level: 0, status: 'planned', ...(withRoles && role ? { ui_role: role } : {}) })) });
    for (const [slug] of pages) wt(path.join(T, 'work', 'pages', slug, 'page.md'), `# ${slug}\n\n---\n\nТекст страницы ${slug}.\n`);
    mkMap(true);
    const r1 = run(R, [path.join(REPO, '.claude', 'scripts', 'read-faq-input.mjs'), 'faq/001', '--from-tekst', 'texts/001-x']);
    const p1 = r1.code === 0 ? rj(path.join(R, 'faq', '001', 'pages.json')).pages.map(p => p.slug) : [];
    check('read-faq-input: ui_role search, cart, account, legal пропущены, число напечатано', r1.code === 0 && JSON.stringify(p1) === JSON.stringify(['home', 'uslugi']) && /4 страниц интерфейса/.test(r1.stdout), r1.out + JSON.stringify(p1));
    mkMap(false);
    const r2 = run(R, [path.join(REPO, '.claude', 'scripts', 'read-faq-input.mjs'), 'faq/002', '--from-tekst', 'texts/001-x']);
    const p2 = r2.code === 0 ? rj(path.join(R, 'faq', '002', 'pages.json')).pages.length : 0;
    check('read-faq-input: карта без ui_role - как раньше, все страницы', r2.code === 0 && p2 === 6 && !/страниц интерфейса/.test(r2.stdout), r2.out);
  }

  // ================================================================== 8. воркфлоу wf-00 и wf-02 (подставной agent)
  {
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    async function runWf(file, args, impl) {
      const src = fs.readFileSync(path.join(TPL, 'workflows', file), 'utf8').replace(/^export const meta\s*=/m, 'const meta =');
      const calls = [];
      const agent = async (prompt, opts) => { calls.push({ label: opts.label, model: opts.model, prompt }); return impl(opts.label, prompt); };
      const parallel = fns => Promise.all(fns.map(f => f()));
      const fn = new AsyncFunction('args', 'agent', 'parallel', 'phase', 'log', 'pipeline', 'workflow', src);
      try { return { r: await fn(args, agent, parallel, () => {}, () => {}, null, null), calls }; } catch (e) { return { e, calls }; }
    }
    const ok = { ok: true, summary: '{}', data: {} };
    const imp = missing => ({ ok: true, summary: 'ok', facts: 3, publish_yes: 3, anti_pending: 0, company_status: 'confirmed', company_missing: missing, structure_pages: 5 });
    const baseArgs = { root: '/fake', model: 'STRONG', model_light: 'LIGHT' };
    const labels = x => x.calls.map(c => c.label);
    const p1 = await runWf('wf-00-facts.js', { ...baseArgs, source: 'project', structureMode: 'import' }, l => (l === 'project-import' ? imp(['hours']) : ok));
    check('wf-00 project: импорт -> снимок -> --company-facts -> составитель -> обогатитель', !p1.e && JSON.stringify(labels(p1)) === JSON.stringify(['project-import', 'site-snapshot', 'company-facts', 'decisions', 'sitemap-enrich']), p1.e ? p1.e.message : JSON.stringify(labels(p1)));
    const cfc = p1.calls.find(c => c.label === 'company-facts');
    check('wf-00: после снимка - run-агент import-project.mjs --company-facts (легкая модель), K1 держит скрипт', !!cfc && cfc.prompt.includes('cd "/fake" && node scripts/import-project.mjs --company-facts\n') && cfc.model === 'LIGHT', cfc ? `${cfc.model} ${cfc.prompt}` : 'нет вызова');
    const pf = await runWf('wf-00-facts.js', { ...baseArgs, source: 'project', structureMode: 'import' }, l => (l === 'project-import' ? imp(['hours']) : l === 'company-facts' ? { ok: false, exit_code: 1, stdout_tail: 'facts.json не прошел схему' } : ok));
    check('wf-00: --company-facts упал - фаза идет дальше, код в результате', !pf.e && labels(pf).includes('sitemap-enrich') && pf.r.companyFacts?.exit_code === 1, pf.e ? pf.e.message : JSON.stringify(pf.r && pf.r.companyFacts));
    check('wf-00: составитель - роль decisions (strong), режим анализа в задании', p1.calls.find(c => c.label === 'decisions')?.model === 'STRONG' && /01-decisions-drafter\.md/.test(p1.calls.find(c => c.label === 'decisions').prompt) && /Режим анализа: project/.test(p1.calls.find(c => c.label === 'decisions').prompt));
    const p2 = await runWf('wf-00-facts.js', { ...baseArgs, source: 'project', structureMode: 'import' }, l => (l === 'project-import' ? imp([]) : ok));
    check('wf-00 project: company_missing пуст - снимка и --company-facts нет', !p2.e && !labels(p2).includes('site-snapshot') && !labels(p2).includes('company-facts') && labels(p2).includes('decisions'), JSON.stringify(labels(p2)));
    const d1 = await runWf('wf-00-facts.js', { ...baseArgs, source: 'doc', structureMode: 'import' }, l => (l.startsWith('facts-check') ? { findings: [], verdict: 'pass', summary: '' } : l === 'import-structure' ? { ok: true, exit_code: 0, stdout_tail: '' } : ok));
    const L = labels(d1);
    check('wf-00 doc: --company-facts после снимка и до составителя', !d1.e && L.indexOf('company-facts') > L.indexOf('site-snapshot') && L.indexOf('company-facts') < L.indexOf('decisions'), JSON.stringify(L));
    const d2 = await runWf('wf-00-facts.js', { ...baseArgs, source: 'doc', structureMode: 'import', skipSnapshot: true }, l => (l.startsWith('facts-check') ? { findings: [], verdict: 'pass', summary: '' } : l === 'import-structure' ? { ok: true, exit_code: 0, stdout_tail: '' } : ok));
    check('wf-00 doc + skipSnapshot: --company-facts не зовется', !d2.e && !labels(d2).includes('company-facts') && labels(d2).includes('decisions'), JSON.stringify(labels(d2)));
    check('wf-00 doc: составитель после снимка и карты, до обогатителя', !d1.e && L.indexOf('decisions') > L.indexOf('site-snapshot') && L.indexOf('decisions') > L.indexOf('import-structure') && L.indexOf('sitemap-enrich') === L.indexOf('decisions') + 1, JSON.stringify(L));
    const n1 = await runWf('wf-00-facts.js', { ...baseArgs, source: 'project', structureMode: 'import' }, l => (l === 'project-import' ? imp([]) : l === 'decisions' ? null : ok));
    check('wf-00: составитель без ответа - ошибка, обогатитель не зовется', !!n1.e && /составитель решений/.test(n1.e.message) && !labels(n1).includes('sitemap-enrich'), n1.e ? n1.e.message : 'нет ошибки');
    const n2 = await runWf('wf-00-facts.js', { ...baseArgs, source: 'project', structureMode: 'import' }, l => (l === 'project-import' ? imp([]) : l === 'sitemap-enrich' ? null : ok));
    check('wf-00: обогатитель без ответа - ошибка', !!n2.e && /обогатитель карты/.test(n2.e.message), n2.e ? n2.e.message : 'нет ошибки');
    const src00 = fs.readFileSync(path.join(TPL, 'workflows', 'wf-00-facts.js'), 'utf8');
    check('wf-00: роль decisions в таблице ROLES', /decisions: 'strong'/.test(src00));
    const w2 = await runWf('wf-02-competitors.js', { ...baseArgs, types: ['home'], type_pages: { home: 1 }, catalog: true }, l => {
      if (l === 'verify') return { total_candidates: 1, kept: ['d1.example'], excluded: [], method: 'm' };
      if (l.startsWith('inventory:')) return { domain: 'd1.example', pages: [], types_missing: [] };
      if (l.startsWith('extract:')) return { results: [] };
      if (l.startsWith('aggregate:')) return { results: [{ type: 'home', market_blocks: 1, differentiation_blocks: 0, order: [] }] };
      if (l === 'catalog-analyst') throw new Error('сеть недоступна');
      return ok;
    });
    check('wf-02: сбой аналитика каталогов - domains_failed со звездочкой и причиной, фаза не падает', !w2.e && w2.r.catalog?.domains_failed?.[0]?.domain === '*' && /сеть недоступна/.test(w2.r.catalog.domains_failed[0].reason), w2.e ? w2.e.message : JSON.stringify(w2.r?.catalog));
  }

  // ================================================================== 9. промты пакета: без UUID MCP и нишевых примеров
  {
    const own = ['00-analysis-dumper', '00-antipromise-patterns', '00-facts-checker', '00-facts-extractor', '00-project-import', '00-site-snapshot', '01-decisions-drafter', '01-sitemap-enricher', '01-structure-fallback', '02-competitor-verifier', '02-page-classifier', '02-block-extractor'];
    const NICHE = /(застройщ|депозит|квот[аеуы]|инвестор|недвижим|ипотек|новострой|апартамент|доходност|ювелир|золот|кольц|пирсинг|бриллиант|серебр|помолвоч|обручал|геммолог|пхукет)/i;
    const files = [...own.map(n => `prompts/${n}.md`), ...['import-project', 'import-structure', 'render-analysis', 'fetch-page', 'contacts'].map(n => `scripts/${n}.mjs`), 'workflows/wf-00-facts.js', 'workflows/wf-02-competitors.js'];
    const bad = [];
    for (const n of files) {
      const s = fs.readFileSync(path.join(TPL, n), 'utf8');
      if (/mcp__[0-9a-f]{8}-/.test(s)) bad.push(`${n}: UUID MCP`);
      const nm = s.match(NICHE);
      if (nm) bad.push(`${n}: нишевое слово «${nm[0]}»`);
      if (/[\u0451\u0401\u2014\u2013]/.test(s)) bad.push(`${n}: е с точками или длинное тире`);
    }
    check('файлы W3 (промты, скрипты, воркфлоу): без UUID MCP, нишевых слов, е с точками и длинных тире', !bad.length, bad.join('; '));
    const dd = fs.readFileSync(path.join(TPL, 'prompts', '01-decisions-drafter.md'), 'utf8');
    check('01-decisions-drafter: маркер v2, карта, §8, без action и снятия страниц', dd.includes('<!-- decisions:v2 -->') && dd.includes('work/sitemap.json') && dd.includes('§8') && /`skip` не ставь/.test(dd) && /Без `action`/.test(dd));
    const en = fs.readFileSync(path.join(TPL, 'prompts', '01-sitemap-enricher.md'), 'utf8');
    check('01-sitemap-enricher: ui_role, nav_label, segment all, без правила «самый большой чек» и волн', /ui_role/.test(en) && /nav_label/.test(en) && /segment: "all"/.test(en) && !/самым большим чеком/.test(en) && /`wave` не ставь/.test(en));
  }

  // ================================================================== 10. программа 28.09 (пакет P2): K1, K2, K3, K4, K5, K11
  {
    // ---------- K2: маркер снятия - только явные пометки; копия равна экспорту анализа
    const ipSrc = fs.readFileSync(path.join(TPL, 'scripts', 'import-project.mjs'), 'utf8');
    const lit = (ipSrc.match(/^const HELD_MARK_COPY = (\/.+\/[a-z]*);$/m) || [])[1];
    let HELD = null;
    try { HELD = lit ? new Function(`return ${lit}`)() : null; } catch { HELD = null; }
    // «NDA» целым полем - пометка только как значение (или artifact) секретного поля: копия HELD_NDA_FIELD на «подпись\nзначение»
    const litN = (ipSrc.match(/^const HELD_NDA_FIELD_COPY = (\/.+\/[a-z]*);$/m) || [])[1];
    let HELD_N = null;
    try { HELD_N = litN ? new Function(`return ${litN}`)() : null; } catch { HELD_N = null; }
    check('K2: HELD_NDA_FIELD_COPY - литерал регулярки в import-project.mjs', HELD_N instanceof RegExp, litN || 'нет строки const HELD_NDA_FIELD_COPY');
    check('K2: HELD_MARK_COPY - литерал регулярки в import-project.mjs', HELD instanceof RegExp, lit || 'нет строки const HELD_MARK_COPY');
    if (HELD instanceof RegExp) {
      const CATCH = ['не публиковать', 'не публикуем', 'адрес: не указывать', 'не упоминать на сайте', 'не для сайта', 'клиенты: под NDA', 'себестоимость - коммерческая тайна', '(снято заказчиком)', '(конфиденциально)', '(внутреннее)'];
      const PASS = ['снимаем мерки на дому', 'гарантируем конфиденциальность', 'снято нашей студией', 'заснято 120 свадеб', 'снят с учета', 'работаем по NDA', 'не раскрываем данные клиентов', 'мы не называем цену до замера',
        // доделка №13: слова пометки внутри продающей фразы и скобки-пояснения
        'соблюдаем коммерческую тайну', 'работаем под NDA', 'не публикуем имена клиентов без согласия', 'демонтаж (снятие старых окон)', '(сняты с производства) со скидкой', 'утепление (внутреннее и наружное)'];
      const miss = CATCH.filter(s => !HELD.test(s)), extra = PASS.filter(s => HELD.test(s));
      check('K2: маркер ловит явные пометки и не ловит продающие слова (таблица контракта)', !miss.length && !extra.length, JSON.stringify({ miss, extra }));
      // повторная проверка №13: все фразы пробника проверяющего (54) и реального корпуса клиентов (плашка «Строго
      // конфиденциально» PR-агентства, ответ с гейта, подпись юрлица); строка поля - в нижнем регистре, как в импорте
      const CATCH13 = [
        'не публиковать', 'Не публиковать!', 'НЕ ДЛЯ САЙТА', 'цена закупки: не для публикации', 'Оборот 50 млн (не публикуем)', 'Оборот 50 млн - не публикуем',
        'Оборот 50 млн, не публикуем', 'Оборот 50 млн. Не публикуем.', 'Не публикуем!', 'выручка: конфиденциально', 'Себестоимость: коммерческая тайна.', '(коммерческая тайна)',
        'Оборот 50 млн (конфиденциальная информация)', '(внутреннее)', '(снято)', 'Скидка 20% (снято заказчиком)', 'Скидка 20% - снято заказчиком', 'адрес склада не указывать',
        'Скидка для своих, не для сайта', 'цена закупки - не публикуется', 'цена закупки, не публикуется', 'не показывать на сайте',
        'только для внутреннего пользования', '(строго конфиденциально)', '(под NDA)', 'клиенты (NDA)', 'выручка: NDA', 'клиенты - NDA', 'Оборот: конфиденциальная информация',
        'Документы - для внутреннего пользования', 'снято заказчиком', 'Скидка 20%, снято заказчиком', 'просим не указывать адрес',
        // вторая повторная проверка №13: явные пометки, которые уходили в публикацию, и намеренно спорные куски
        '50 млн (не публикуем на сайте)', '50 млн - не публикуем на сайте', 'Не публикуем на сайте', 'Не публикуем, только для КП', '50 млн [не публикуем]',
        '50 млн (не для печати)', '1200 руб (не показываем)', 'ул. Ленина 5 - не указываем', '120 млн - конфиденциально', '120 млн, конфиденциально',
        'не разглашать', '50 млн (скрыть)', 'Возможно не публиковать', 'Сбер, ВТБ (не называем)', 'Консультация: конфиденциально',
        'Фото пациентов - не публикуем', 'Тиражи меньше 100 штук - не печатаем', '- (не указывается)', 'Ограничение (внутреннее): Татьяна делает работу сама',
        'Утепление (внутреннее)'
      ];
      const PASS13 = [
        'Снимаем мерки на дому бесплатно', 'Замер и снятие размеров - бесплатно', 'Демонтаж (снятие старых окон) входит в стоимость',
        'Снимаем старый натяжной потолок за 1 час без мусора', 'Снятие мерок бесплатно, выезд в день обращения', 'Гарантируем конфиденциальность',
        'Соблюдаем адвокатскую тайну и коммерческую тайну клиента', 'Работаем под NDA', 'Подписываем соглашение о конфиденциальности (NDA)',
        'Обязуемся не раскрывать сведения о клиенте третьим лицам', 'Обязуемся не публиковать фото пациентов без согласия', 'Лечение анонимно - строго конфиденциально',
        'Прием анонимно и конфиденциально', 'Консультация: анонимно, конфиденциально, бесплатно', 'Анонимно; конфиденциально.', 'Снятие арестов со счетов и запретов на выезд',
        'Снимаем ограничения ФССП за 2 месяца', 'Снят с учета в налоговой после процедуры', 'Ваши данные не публикуем, кроме обязательного ЕФРСБ', 'Видео снято на дроне',
        'Фото с объекта (снято на iPhone 15)', 'Заснято более 120 свадеб', 'внутреннее', 'Утепление - внутреннее', 'Утепление внутреннее и наружное',
        'Можно не печатать договор - подпишем по ЭДО', 'Не печатаем дешевые визитки', 'Снятие и установка колес - 1500 руб', 'Конфиденциальность', 'Внутреннее утепление',
        'Строго конфиденциально', 'Строго конфиденциально. Не разглашаем не только детали работы - даже сам факт вашего обращения остается между нами',
        'Строго конфиденциально: не разглашаем даже факт обращения', 'Не разглашаем даже сам факт вашего обращения - строго конфиденциально', 'Работаем строго конфиденциально',
        'NDA, договор, все конфиденциально', 'Мы строго следим за конфиденциальностью между нами, поэтому рассказываем без имен, отраслей и узнаваемых деталей',
        'ООО «КОММУНИКАЦИОННОЕ АГЕНТСТВО «ПРОГРЕСС» (из политики конфиденциальности старого сайта progresspr.ru)', 'Опыт (не печатаем счетчиком)',
        'Мы используем файлы cookie. Просматривая сайт, вы подтверждаете сво\u0451 согласие с условиями Политики конфиденциальности', 'договор о неразглашении (NDA)',
        'Работаем по договору (NDA)', 'Договор: NDA', 'NDA', 'Обязуемся никогда не раскрывать данные', 'Можем не указывать ваше имя в отзыве',
        'Шторы, чтобы не показывать комнату с улицы', 'Регламенты для внутреннего пользования разрабатываем', 'Видео: снято заказчиком на телефон', 'Ограничения - сняты',
        // вторая повторная проверка №13: разрешение и обязанность любой формы, пояснение «(внутреннее)», слово-пометка
        // целым полем (решает пара подпись/значение), обещание клиенту «не раскрываем»
        'Пациент может не называть свое имя', 'Вы можете не указывать имя в отзыве', 'По закону обязаны не раскрывать данные клиентов',
        'Обязуемся третьим лицам данные не раскрывать', 'Обязуемся никому и никогда не раскрывать данные', 'Подписываем соглашение о неразглашении',
        'Коммерческая тайна', 'Конфиденциально', 'Под NDA', 'Защита идеи: NDA', 'Фасадное (наружное), квартирное (внутреннее)', 'Светодиодное (внутреннее)',
        'Без согласия клиента не публикуем.', 'Имена клиентов не указываем', 'Снято заказчиком на телефон', 'Ролик снят заказчиком',
        'Работаем с агентствами под NDA', 'Договор и NDA', 'Анонимно, конфиденциально.', 'Лечение анонимно - конфиденциально', 'Данные клиентов - не раскрываем',
        'Что делать - не показывает.', 'Чего нет ниже - не называй.'
      ];
      const miss13 = CATCH13.filter(s => !HELD.test(s.toLowerCase())), extra13 = PASS13.filter(s => HELD.test(s.toLowerCase()));
      check('K2 (повторная проверка №13): фразы пробника и корпуса - ловит явные пометки, не ловит обязательства, «строго конфиденциально», «(NDA)»-расшифровку', !miss13.length && !extra13.length, JSON.stringify({ miss13, extra13 }));
      if (HELD_N instanceof RegExp) {
        const nda = (label, value) => HELD_N.test(`${label}\n${value}`.toLowerCase());
        check('K2: «NDA» целым полем - только значение секретного поля («Выручка» - да; «Договор», «Конфиденциальность», подпись «NDA» - нет)',
          nda('Выручка', 'NDA') && nda('Клиенты', 'NDA.') && nda('', 'NDA') && !nda('Договор', 'NDA') && !nda('Конфиденциальность', 'NDA') && !nda('Соглашение о неразглашении', 'NDA')
          && !nda('NDA', 'подписываем до старта работ') && !nda('Клиенты', 'Газпром, Сбер'), HELD_N.source);
        // вторая повторная проверка №13: «под NDA», «конфиденциально», «коммерческая тайна» целым полем - так же, как «NDA»;
        // подпись о тайне, анонимности, защите, гарантиях - продающий факт
        const pairs = [['Клиенты', 'Под NDA', true], ['Выручка', 'Конфиденциально.', true], ['', 'Конфиденциально', true], ['Себестоимость', 'Коммерческая тайна', true],
          ['Анонимность', 'Конфиденциально', false], ['Гарантии', 'NDA', false], ['Защита идеи', 'NDA', false], ['Конфиденциальность', 'Под NDA', false],
          ['Коммерческая тайна', 'Подписываем соглашение о неразглашении', false], ['Выручка', '120 млн', false]];
        const badPairs = pairs.filter(([l, v, want]) => nda(l, v) !== want).map(([l, v]) => `${l} - ${v}`);
        check('K2 (вторая повторная проверка №13): слово-пометка целым полем - пометка у подписи не о тайне, тема у подписи о ней', !badPairs.length, JSON.stringify(badPairs));
      }
      check('K2: копия без буквы е с точками в тексте файла (через \\u0451) и с флагом i', HELD.flags === 'i' && HELD.source.includes('\\u0451') && !/[\u0451]/.test(lit), HELD.flags);
      const contractFile = path.join(REPO, '.claude', 'scripts', 'site', '_contract.mjs');
      let exp = null;
      try { exp = fs.existsSync(contractFile) ? (await import(pathToFileURL(contractFile).href)).HELD_MARK : null; } catch { exp = null; }
      // запись буквы е с точками (escape или сама буква) не меняет правило: сравниваются source после приведения escape к букве
      const same = x => x.replace(/\\u0451/g, '\u0451');
      // SKIP «ждет P1» снят интеграцией (этап B): экспорт HELD_MARK есть, его пропажа - провал, а не пропуск
      let expN = null;
      try { expN = fs.existsSync(contractFile) ? (await import(pathToFileURL(contractFile).href)).HELD_NDA_FIELD : null; } catch { expN = null; }
      check('K2: HELD_NDA_FIELD_COPY совпадает с экспортом HELD_NDA_FIELD в _contract.mjs анализа (source и flags)', HELD_N instanceof RegExp && expN instanceof RegExp && same(HELD_N.source) === same(expN.source) && HELD_N.flags === expN.flags, expN instanceof RegExp ? `${HELD_N} | ${expN}` : 'в .claude/scripts/site/_contract.mjs нет экспорта HELD_NDA_FIELD (K2)');
      check('K2: HELD_MARK_COPY совпадает с экспортом HELD_MARK в _contract.mjs анализа (source и flags)', exp instanceof RegExp && same(HELD.source) === same(exp.source) && HELD.flags === exp.flags, exp instanceof RegExp ? `${HELD} | ${exp}` : 'в .claude/scripts/site/_contract.mjs нет экспорта HELD_MARK (K2)');
    }
    const hm = importCase('held', p => {
      p.facts.push({ id: 'f07', label: 'Замер', value: 'снимаем мерки на дому бесплатно', kind: 'process', publish: 'yes', src: 'бриф' });
      p.facts.push({ id: 'f08', label: 'Конфиденциальность', value: 'гарантируем конфиденциальность', kind: 'claim', publish: 'yes', src: 'бриф' });
      p.facts.push({ id: 'f09', label: 'Склад', value: 'адрес склада (не публиковать)', kind: 'claim', publish: 'yes', src: 'бриф' });
    });
    const conf = (hm.facts?.gaps || []).filter(g => /маркер снятия/.test(g));
    check('K2 импорт: «снимаем мерки», «конфиденциальность» - без конфликта, явная пометка «(не публиковать)» - конфликт', hm.r.code === 0 && conf.length === 1 && /^конфликт: F09 - маркер снятия/.test(conf[0]), hm.r.code ? hm.r.out : JSON.stringify(conf));
    {
      const hn = importCase('held-nda', p => {
        p.facts.push({ id: 'f07', label: 'Выручка', value: 'NDA', kind: 'claim', publish: 'yes', src: 'бриф' });
        p.facts.push({ id: 'f08', label: 'Договор', value: 'NDA', kind: 'claim', publish: 'yes', src: 'бриф' });
        p.facts.push({ id: 'f09', label: 'NDA', value: 'подписываем до старта работ', kind: 'claim', publish: 'yes', src: 'бриф' });
        p.facts.push({ id: 'f10', label: 'Клиенты', value: 'две сети клиник', artifact: 'NDA', kind: 'claim', publish: 'yes', src: 'бриф' });
        p.facts.push({ id: 'f11', label: 'Плашка', value: 'Строго конфиденциально', kind: 'claim', publish: 'yes', src: 'бриф' });
        p.facts.push({ id: 'f12', label: 'Юристы', value: 'Обязуемся не раскрывать сведения о клиенте третьим лицам', kind: 'claim', publish: 'yes', src: 'бриф' });
      });
      const gn = (hn.facts?.gaps || []).filter(g => /маркер снятия/.test(g));
      check('K2 импорт (повторная проверка №13): «Выручка» - «NDA» и NDA в artifact - конфликт; «Договор» - «NDA», подпись «NDA», «Строго конфиденциально», «обязуемся не раскрывать» - без конфликта',
        hn.r.code === 0 && gn.some(g => /^конфликт: F07 - маркер снятия/.test(g)) && gn.some(g => /^конфликт: F10 - маркер снятия/.test(g)) && gn.length === 2, hn.r.code ? hn.r.out : JSON.stringify(gn));
    }
    {
      // вторая повторная проверка №13: пометки проверяющего - конфликт, продающие факты о тайне и пояснения - без конфликта
      const h2 = importCase('held-13b', p => {
        p.facts.push({ id: 'f07', label: 'Выручка', value: '120 млн - конфиденциально', kind: 'number', publish: 'yes', src: 'бриф' });
        p.facts.push({ id: 'f08', label: 'Анонимность', value: 'Конфиденциально', kind: 'claim', publish: 'yes', src: 'бриф' });
        p.facts.push({ id: 'f09', label: 'Коммерческая тайна', value: 'Подписываем соглашение о неразглашении', kind: 'claim', publish: 'yes', src: 'бриф' });
        p.facts.push({ id: 'f10', label: 'Клиенты', value: 'Под NDA', kind: 'claim', publish: 'yes', src: 'бриф' });
        p.facts.push({ id: 'f11', label: 'Тайна', value: 'По закону обязаны не раскрывать данные клиентов', kind: 'claim', publish: 'yes', src: 'бриф' });
        p.facts.push({ id: 'f12', label: 'Оборот', value: '50 млн (не публикуем на сайте)', kind: 'number', publish: 'yes', src: 'бриф' });
        p.facts.push({ id: 'f13', label: 'Освещение', value: 'Светодиодное (внутреннее)', kind: 'product', publish: 'yes', src: 'бриф' });
        p.facts.push({ id: 'f14', label: 'Анонимность', value: 'Пациент может не называть свое имя', kind: 'claim', publish: 'yes', src: 'бриф' });
      });
      const g2 = (h2.facts?.gaps || []).filter(g => /маркер снятия/.test(g)).map(g => (g.match(/^конфликт: (F\d+)/) || [])[1]).sort();
      check('K2 импорт (вторая повторная проверка №13): конфликт ровно по F07 «120 млн - конфиденциально», F10 «Клиенты» - «Под NDA», F12 «(не публикуем на сайте)»',
        h2.r.code === 0 && JSON.stringify(g2) === JSON.stringify(['F07', 'F10', 'F12']), h2.r.code ? h2.r.out : JSON.stringify(g2));
    }
    check('K2 импорт вне проекта: правило - копия kit', /^копия HELD_MARK_COPY/.test(hm.rep?.inputs?.held_mark_rule || ''), JSON.stringify(hm.rep?.inputs));
    {
      // доделка №13: факт с пометкой, который заказчик подтвердил на гейте (запись журнала «подтверждение по факту»), -
      // предупреждение оператору в import-report, а не строка «конфликт:» в gaps (она ушла бы в unknowns всех брифов)
      const qc = path.join(SITE, 'queue-held-confirmed.json');
      const q0 = rj(Q_WAIVER);
      q0.journal = [...q0.journal, { id: 'j2', kind: 'waiver', key: 'f09', subject: 'подтверждение по факту f09 - Склад', ground: 'заказчик ответил «да»: публикуем как напечатано' },
        { id: 'j3', kind: 'waiver', key: 'f10', subject: 'молчание по факту f10 - Архив', ground: 'первый круг: принят документ 1' }];
      wj(qc, q0);
      const hc = importCase('held-confirmed', p => {
        p.facts.push({ id: 'f09', label: 'Склад', value: 'адрес склада (не публиковать)', kind: 'claim', publish: 'yes', src: 'бриф' });
        p.facts.push({ id: 'f10', label: 'Архив', value: 'архив объектов (снято заказчиком)', kind: 'claim', publish: 'yes', src: 'бриф' });
        p.facts.push({ id: 'f11', label: 'Тайна', value: 'соблюдаем коммерческую тайну клиента', kind: 'claim', publish: 'yes', src: 'бриф' });
      }, qc);
      const g = hc.facts?.gaps || [];
      check('K2 импорт: подтвержденный заказчиком помеченный факт - предупреждение, не конфликт; молчание - конфликт; продающая фраза - ничего',
        hc.r.code === 0 && !g.some(x => /^конфликт: F09/.test(x)) && (hc.rep?.warnings || []).some(w => /^F09 .*подтвердил заказчик/.test(w))
        && g.some(x => /^конфликт: F10 - маркер снятия/.test(x)) && !g.some(x => /^конфликт: F11/.test(x)) && byId(hc.facts, 'F09')?.publish === 'yes',
        hc.r.code ? hc.r.out : JSON.stringify({ g, w: hc.rep?.warnings }));
    }
    {
      // в проекте: правило из _contract.mjs анализа (подмененное правило ловит свою пометку, а не «не публиковать»)
      const PR = path.join(tmpRoot, 'proj-held');
      const fake = path.join(PR, '.claude', 'scripts', 'site', '_contract.mjs');
      wt(fake, 'export const SERVICE_NOTE = /уточним позже/i;\nexport const HELD_MARK = /особая пометка/i;\n');
      const site = path.join(PR, 'sites', '001-held');
      const p = clone(PROJECT);
      p.facts.push({ id: 'f07', label: 'Пометка', value: 'особая пометка анализа', kind: 'claim', publish: 'yes', src: 'бриф' });
      p.facts.push({ id: 'f08', label: 'Склад', value: 'склад (не публиковать)', kind: 'claim', publish: 'yes', src: 'бриф' });
      p.facts.push({ id: 'f09', label: 'Выручка', value: 'NDA', kind: 'claim', publish: 'yes', src: 'бриф' });
      wj(path.join(site, 'project.json'), p);
      wj(path.join(site, 'queue.json'), rj(Q_WAIVER));
      const dir = mkProject('held-proj');
      const r = run(dir, ['scripts/import-project.mjs', '--project', path.join(site, 'project.json'), '--queue', path.join(site, 'queue.json')]);
      const fx = r.code === 0 ? rj(W(dir, 'facts.json')) : { gaps: [] };
      const rp = r.code === 0 ? rj(W(dir, 'import-report.json')) : { inputs: {} };
      check('K2 в проекте: HELD_MARK из _contract.mjs анализа, а не копия kit', r.code === 0 && path.resolve(rp.inputs.held_mark_rule || '.') === path.resolve(fake) && fx.gaps.some(g => /^конфликт: F07 - маркер снятия/.test(g)) && !fx.gaps.some(g => /^конфликт: F08/.test(g)), r.code ? r.out : JSON.stringify({ i: rp.inputs, g: fx.gaps }));
      // модуль анализа без экспорта HELD_NDA_FIELD: анализ значение «NDA» не закрыл - импорт не пишет по нему конфликт
      check('K2 в проекте: правило «NDA целым полем» - из того же модуля; модуль без HELD_NDA_FIELD - значение «NDA» без конфликта', r.code === 0 && !fx.gaps.some(g => /^конфликт: F09/.test(g)), JSON.stringify(fx.gaps));
    }

    // ---------- K1: поля, снятые заказчиком в d10 (absent_fields), и каналы со старого сайта
    const ab = importCase('absent', p => {
      delete p.business.legal.address; delete p.business.legal.schedule;
      p.business.legal.absent_fields = ['address', 'schedule'];
      p.facts = p.facts.filter(f => f.id !== 'f05');
    });
    checkSchema('K1: facts.json с company.absent', 'facts', ab.facts || {});
    check('K1 импорт: absent_fields -> company.absent в именах kit, адреса и часов нет, F905/F906 нет', ab.r.code === 0 && JSON.stringify(ab.facts.company.absent) === JSON.stringify(['address', 'hours']) && !ab.facts.company.address && !ab.facts.company.hours && !byId(ab.facts, 'F905') && !byId(ab.facts, 'F906'), ab.r.code ? ab.r.out : JSON.stringify(ab.facts.company));
    check('K1 импорт: снятые поля не в company_missing - снимок ради них не зовется', JSON.stringify(ab.rep?.company_missing) === '[]', JSON.stringify(ab.rep?.company_missing));
    check('K1 импорт: d10 в отчете - «не указываем: адрес, часы», предупреждение', /не указываем: часы, адрес/.test(ab.rep?.gate?.decisions?.d10?.value || '') && ab.rep.warnings.some(w => /заказчик снял ответом на d10.*адрес, часы работы/.test(w)), JSON.stringify([ab.rep?.gate?.decisions?.d10, ab.rep?.warnings]));
    const abMd = ab.r.code === 0 ? fs.readFileSync(path.join(ab.dir, 'inputs', 'analysis.md'), 'utf8') : '';
    check('K1 render: реквизиты - «Не указываем на сайте по решению заказчика (d10): адрес, часы»', abMd.includes('Не указываем на сайте по решению заказчика (d10): адрес, часы.'), abMd.split('## Направления')[0].slice(-400));
    {
      // снимок сайта все же вернул адрес, часы и каналы: --company-facts снимает поля absent, каналы без факта - в gaps
      const ff = W(ab.dir, 'facts.json');
      const f = rj(ff);
      Object.assign(f.company, { address: 'Тула, ул. Старая, д. 5', hours: 'пн-вс 10:00-22:00', channels: { ...f.company.channels, instagram: 'https://instagram.com/testco', vk: 'https://vk.com/testco' } });
      f.company.source += ' + https://test-co.example/contacts';
      wj(ff, f);
      const cf = run(ab.dir, ['scripts/import-project.mjs', '--company-facts']);
      const f2 = rj(ff);
      check('K1 --company-facts: адрес и часы снимка сняты (absent), F905/F906 нет, предупреждение', cf.code === 0 && !f2.company.address && !f2.company.hours && !byId(f2, 'F905') && !byId(f2, 'F906') && /адрес «Тула, ул\. Старая, д\. 5» не взят: заказчик снял/.test(cf.stdout), cf.out + JSON.stringify(f2.company));
      check('K1 --company-facts: каналы из фактов на месте, каналы снимка без факта - не в company, строками gaps', f2.company.channels?.whatsapp?.fact === 'F02' && !f2.company.channels.instagram && !f2.company.channels.vk && f2.gaps.includes('канал со старого сайта: Instagram https://instagram.com/testco - публиковать?') && f2.gaps.includes('канал со старого сайта: ВКонтакте https://vk.com/testco - публиковать?'), JSON.stringify({ ch: f2.company.channels, g: f2.gaps }));
      check('K1: строка канала не начинается с технических префиксов отчета (уйдет вопросом заказчику)', f2.gaps.filter(g => g.startsWith('канал со старого сайта')).every(g => !/^(регулярка антиобещания|конфликт:|факты не подтверждены заказчиком|телефона для сайта нет)/i.test(g)));
      check('K1 --company-facts: company_missing пуст, происхождение без адреса и часов', JSON.stringify(rj(W(ab.dir, 'import-report.json')).company_missing) === '[]' && !('address' in (rj(W(ab.dir, 'import-report.json')).company_origin || {})));
      const cf2 = run(ab.dir, ['scripts/import-project.mjs', '--company-facts']);
      const f3 = rj(ff);
      check('K1 --company-facts: повтор - строки каналов не множатся', cf2.code === 0 && f3.gaps.filter(g => g.startsWith('канал со старого сайта')).length === 2, JSON.stringify(f3.gaps));
      // --facts-only: строки каналов сохраняются; анализ дал факт канала со ссылкой - строка снята, канал в company
      const p2 = rj(ab.pf);
      p2.facts.push({ id: 'f07', label: 'Instagram', value: 'https://instagram.com/testco', kind: 'contact', publish: 'yes', src: 'ответ' });
      wj(ab.pf, p2);
      const fo = run(ab.dir, ['scripts/import-project.mjs', '--project', ab.pf, '--queue', Q_WAIVER, '--facts-only']);
      const f4 = rj(ff);
      check('K1 --facts-only: канал подтвержден фактом анализа - в company, строка снята; другой канал - строкой', fo.code === 0 && f4.company.channels?.instagram?.fact === 'F07' && !f4.gaps.some(g => /^канал со старого сайта: Instagram/.test(g)) && f4.gaps.filter(g => /^канал со старого сайта: ВКонтакте/.test(g)).length === 1 && !f4.company.address && !f4.company.hours, fo.out + JSON.stringify({ ch: f4.company.channels, g: f4.gaps }));
    }
    {
      // --facts-only старой задачи: канал снимка лежал в company.channels строкой - уходит в gaps; часы снимка сняты,
      // когда заказчик убрал их в d10
      const ob = importCase('absent-fo', p => { delete p.business.legal.schedule; p.facts = p.facts.filter(f => f.id !== 'f05'); });
      const ff = W(ob.dir, 'facts.json');
      const f = rj(ff);
      Object.assign(f.company, { hours: 'пн-сб 10:00-20:00', channels: { ...f.company.channels, youtube: 'https://youtube.com/@testco' } });
      f.company.source += ' + https://test-co.example/contacts';
      wj(ff, f);
      const rep = rj(W(ob.dir, 'import-report.json')); rep.company_origin.hours = 'site'; wj(W(ob.dir, 'import-report.json'), rep);
      const p2 = rj(ob.pf); p2.business.legal.absent_fields = ['schedule']; wj(ob.pf, p2);
      const fo = run(ob.dir, ['scripts/import-project.mjs', '--project', ob.pf, '--queue', Q_WAIVER, '--facts-only']);
      const f2 = rj(ff);
      check('K1 --facts-only: часы снимка сняты по absent, канал снимка - строкой gaps, не в company', fo.code === 0 && !f2.company.hours && !byId(f2, 'F905') && JSON.stringify(f2.company.absent) === JSON.stringify(['hours']) && !f2.company.channels?.youtube && f2.gaps.includes('канал со старого сайта: YouTube https://youtube.com/@testco - публиковать?'), fo.out + JSON.stringify({ c: f2.company, g: f2.gaps }));
    }
    {
      // absent_fields: phone - no_phone; юрлицо снято, ИНН и ОГРН остались - F907 без названия
      const ph = importCase('absent-phone', p => { delete p.business.legal.phone; p.business.legal.absent_fields = ['phone', 'entity']; p.facts = p.facts.filter(f => f.id !== 'f04'); });
      check('K1: absent phone - no_phone, F901 нет, строка «телефона для сайта нет»; entity - F907 без названия', ph.r.code === 0 && ph.facts.company.no_phone === true && !ph.facts.company.phones && !byId(ph.facts, 'F901') && ph.facts.gaps.some(g => /^телефона для сайта нет/.test(g)) && !ph.facts.company.legal_name && byId(ph.facts, 'F907')?.value === 'ИНН 7700000000, ОГРН 1027700000000' && JSON.stringify(ph.facts.company.absent) === JSON.stringify(['legal_name']), ph.r.code ? ph.r.out : JSON.stringify([ph.facts.company, byId(ph.facts, 'F907')]));
    }

    // ---------- K1: контактные факты анализа о полях, снятых в d10, - publish: no (строка gaps «... снят на гейте ...»)
    const HELD_LINE = (id, label, what) => `${id} «${label}» не подтвержден или снят на гейте: заказчик снял в d10 (${what}), на сайт не идет`;
    // строка должна попасть в «Не подтверждено или снято» отчета (HELD_GAP report.mjs), а не в вопросы заказчику
    const REPORT_HELD = /^F\d{2,3} «[^»]*» не подтвержден или снят/;
    {
      // часы и адрес сняты, а факты анализа «График работы» и «Адрес офиса» публикуемые (повтор находки рецензии)
      const hw = importCase('absent-fact', p => {
        delete p.business.legal.schedule; delete p.business.legal.address;
        p.business.legal.absent_fields = ['address', 'schedule'];
        p.facts.push({ id: 'f07', label: 'Адрес офиса', value: 'Тула, ул. Примерная, д. 1', kind: 'contact', publish: 'yes', src: 'бриф' });
        p.facts.push({ id: 'f08', label: 'Адрес сайта', value: 'test-co.example', kind: 'contact', publish: 'yes', src: 'бриф' });
        p.audience.segments[0].objection[0].facts = ['f05'];
      });
      const g = (hw.facts && hw.facts.gaps) || [];
      check('K1: «График работы» и «Адрес офиса» при снятых часах и адресе - publish no и строки gaps, F905/F906 нет', hw.r.code === 0 && byId(hw.facts, 'F05').publish === 'no' && byId(hw.facts, 'F07').publish === 'no' && g.includes(HELD_LINE('F05', 'График работы', 'часы работы')) && g.includes(HELD_LINE('F07', 'Адрес офиса', 'адрес')) && !byId(hw.facts, 'F905') && !byId(hw.facts, 'F906'), hw.r.code ? hw.r.out : JSON.stringify(g));
      check('K1: «Адрес сайта» и прочие контакты не тронуты', hw.r.code === 0 && byId(hw.facts, 'F08').publish === 'yes' && byId(hw.facts, 'F04').publish === 'yes' && byId(hw.facts, 'F02').publish === 'yes', JSON.stringify(hw.facts && hw.facts.facts.map(f => [f.id, f.publish])));
      check('K1: по факту одна строка gaps, она в «Не подтверждено» отчета, а не вопросом', g.filter(x => x.startsWith('F05 «')).length === 1 && g.filter(x => x.startsWith('F07 «')).length === 1 && REPORT_HELD.test(HELD_LINE('F05', 'График работы', 'часы работы')), JSON.stringify(g));
      check('K1: предупреждение без противоречия (факты названы снятыми), ссылка возражения на снятый F05 снята', hw.r.code === 0 && hw.rep.warnings.some(w => /заказчик снял ответом на d10.*контактные факты анализа о них сняты с публикации: F05, F07/.test(w)) && !hw.rep.warnings.some(w => /публикуется, хотя/.test(w)) && rj(W(hw.dir, 'audience.json')).segments[0].objections[0].facts.length === 0, JSON.stringify(hw.rep && hw.rep.warnings));
      // --facts-only: то же правило, строки не множатся, F05 и F07 - в facts_diff.unpublished только при переходе
      const fo = run(hw.dir, ['scripts/import-project.mjs', '--project', hw.pf, '--queue', Q_WAIVER, '--facts-only']);
      const f2 = rj(W(hw.dir, 'facts.json')), rep2 = rj(W(hw.dir, 'import-report.json'));
      check('K1 --facts-only: снятые факты остаются publish no, строки по одной, дайджест не считает это ручной правкой', fo.code === 0 && byId(f2, 'F05').publish === 'no' && byId(f2, 'F07').publish === 'no' && f2.gaps.filter(x => x.startsWith('F05 «')).length === 1 && !rep2.facts_diff.unpublished.length, fo.out + JSON.stringify(rep2.facts_diff));
    }
    {
      // no_phone: «Основной телефон» снят, мессенджеры остаются; строки «телефон на сайт не ставим» и снятого факта
      const ph = importCase('absent-phone-fact', p => { delete p.business.legal.phone; p.business.legal.absent_fields = ['phone']; });
      check('K1: телефон снят в d10 - F04 «Основной телефон» publish no, строка gaps; WhatsApp и MAX/Telegram публикуются, каналы на месте', ph.r.code === 0 && byId(ph.facts, 'F04').publish === 'no' && ph.facts.gaps.includes(HELD_LINE('F04', 'Основной телефон', 'телефон')) && byId(ph.facts, 'F02').publish === 'yes' && byId(ph.facts, 'F03').publish === 'yes' && ph.facts.company.channels?.whatsapp?.fact === 'F02' && !byId(ph.facts, 'F901') && ph.facts.gaps.some(x => /^телефона для сайта нет/.test(x)), ph.r.code ? ph.r.out : JSON.stringify(ph.facts.gaps));
      // --facts-only после снятия телефона: факт с тем же номером без слова «телефон» снят по цифрам прежнего company,
      // мессенджер с тем же номером остается с предупреждением
      const base = importCase('absent-phone-digits');
      const p2 = rj(base.pf);
      delete p2.business.legal.phone; p2.business.legal.absent_fields = ['phone'];
      p2.facts.push({ id: 'f07', label: 'Для звонков', value: '8 (495) 000-00-01', kind: 'contact', publish: 'yes', src: 'ответ' });
      p2.facts.push({ id: 'f08', label: 'Viber', value: '+7 495 000 00 01', kind: 'contact', publish: 'yes', src: 'ответ' });
      wj(base.pf, p2);
      const fo = run(base.dir, ['scripts/import-project.mjs', '--project', base.pf, '--queue', Q_WAIVER, '--facts-only']);
      const f3 = rj(W(base.dir, 'facts.json')), rep3 = rj(W(base.dir, 'import-report.json'));
      check('K1 --facts-only: номер снятого телефона - факт снят по цифрам, мессенджер с тем же номером оставлен с предупреждением', fo.code === 0 && byId(f3, 'F04').publish === 'no' && byId(f3, 'F07').publish === 'no' && byId(f3, 'F08').publish === 'yes' && rep3.warnings.some(w => /^F08 «Viber»: канал мессенджера с номером телефона, который заказчик снял в d10/.test(w)) && f3.company.no_phone === true && !f3.company.phones && JSON.stringify(rep3.facts_diff.unpublished) === JSON.stringify(['F04']), fo.out + JSON.stringify(rep3.facts_diff));
    }
    {
      // юрлицо снято, ИНН и ОГРН нет: факт «Юрлицо и реквизиты» с названием снят, F907 заводится из ИНН и ОГРН
      const le = importCase('absent-entity-dup', p => {
        delete p.business.legal.entity; p.business.legal.absent_fields = ['entity'];
        p.facts.push({ id: 'f07', label: 'Юрлицо и реквизиты', value: 'ООО «Тест», ИНН 7700000000, ОГРН 1027700000000', kind: 'legal', publish: 'yes', src: 'бриф' });
      });
      check('K1: F907 с дублем-фактом - факт с названием снят, F907 = ИНН и ОГРН (без названия), publish yes', le.r.code === 0 && byId(le.facts, 'F07').publish === 'no' && le.facts.gaps.includes(HELD_LINE('F07', 'Юрлицо и реквизиты', 'юрлицо')) && byId(le.facts, 'F907')?.value === 'ИНН 7700000000, ОГРН 1027700000000' && byId(le.facts, 'F907').publish === 'yes' && le.rep.contact_facts.includes('F907'), le.r.code ? le.r.out : JSON.stringify([byId(le.facts, 'F07'), byId(le.facts, 'F907')]));
      // «Реквизиты» без названия организации при снятом юрлице не снимаются (правило не ловит лишнего)
      const lr = importCase('absent-entity-req', p => {
        delete p.business.legal.entity; p.business.legal.absent_fields = ['entity'];
        p.facts.push({ id: 'f07', label: 'Реквизиты', value: 'ИНН 7700000000, ОГРН 1027700000000', kind: 'legal', publish: 'yes', src: 'бриф' });
      });
      check('K1: «Реквизиты» только с ИНН и ОГРН при снятом юрлице - публикуются, F907 - дубль этого факта', lr.r.code === 0 && byId(lr.facts, 'F07').publish === 'yes' && !byId(lr.facts, 'F907'), lr.r.code ? lr.r.out : JSON.stringify(lr.facts.facts.map(f => [f.id, f.publish])));
    }
    {
      // данные в форме Goldax (F41-F44 - телефон, почта, график, юрлицо фактами анализа; значения синтетические):
      // заказчик убрал телефон, почту, часы и юрлицо, адрес, ИНН и ОГРН оставил
      const gx = importCase('absent-goldax-form', p => {
        p.business.legal = { inn: '7700000000', ogrn: '1027700000000', address: 'Тула, ул. Примерная, д. 1', phone_absent: true, absent_fields: ['phone', 'email', 'schedule', 'entity'] };
        p.facts = [
          p.facts[0],
          { id: 'f11', label: 'Учет в пробирной инспекции', value: 'карта постановки на учет № ЮЛ0000000000', kind: 'legal', publish: 'yes', src: 'ответ' },
          { id: 'f39', label: 'WhatsApp', value: '8-906-000-00-02', kind: 'contact', publish: 'yes', src: 'ответ' },
          { id: 'f40', label: 'MAX и Telegram', value: '+79690000003', kind: 'contact', publish: 'yes', src: 'ответ' },
          { id: 'f41', label: 'Основной телефон мастерской', value: '8-495-000-00-01', kind: 'contact', publish: 'yes', src: 'ответ' },
          { id: 'f42', label: 'Электронная почта', value: 'admin@test-co.example', kind: 'contact', publish: 'yes', src: 'ответ' },
          { id: 'f43', label: 'График работы', value: 'понедельник-суббота 10:00-20:00, воскресенье выходной', kind: 'contact', publish: 'yes', src: 'ответ' },
          { id: 'f44', label: 'Юрлицо и реквизиты', value: 'ООО «Тест Мастер», ИНН 7700000000, ОГРН 1027700000000', kind: 'legal', publish: 'yes', src: 'ответ' },
        ];
      });
      const pub = id => byId(gx.facts, id) && byId(gx.facts, id).publish;
      check('K1 форма Goldax: F41-F44 сняты с публикации, F11, F39, F40 публикуются', gx.r.code === 0 && ['F41', 'F42', 'F43', 'F44'].every(id => pub(id) === 'no') && ['F01', 'F11', 'F39', 'F40'].every(id => pub(id) === 'yes'), gx.r.code ? gx.r.out : JSON.stringify(gx.facts.facts.map(f => [f.id, f.publish])));
      check('K1 форма Goldax: 4 строки gaps снятых фактов, служебные - только адрес F906 и реквизиты F907 без названия', gx.r.code === 0 && [['F41', 'Основной телефон мастерской', 'телефон'], ['F42', 'Электронная почта', 'почта'], ['F43', 'График работы', 'часы работы'], ['F44', 'Юрлицо и реквизиты', 'юрлицо']].every(([id, l, w]) => gx.facts.gaps.includes(HELD_LINE(id, l, w))) && JSON.stringify(gx.rep.contact_facts) === JSON.stringify(['F906', 'F907']) && byId(gx.facts, 'F907').value === 'ИНН 7700000000, ОГРН 1027700000000', gx.r.code ? '' : JSON.stringify([gx.facts.gaps, gx.rep.contact_facts]));
      check('K1 форма Goldax: каналы WhatsApp, MAX, Telegram - из F39 и F40', gx.r.code === 0 && gx.facts.company.channels?.whatsapp?.fact === 'F39' && gx.facts.company.channels?.telegram?.fact === 'F40' && gx.facts.company.channels?.max?.fact === 'F40', JSON.stringify(gx.facts && gx.facts.company.channels));
    }
    {
      // --company-facts (режим doc, K1 держит скрипт): company.absent и факт экстрактора о снятом поле - publish no;
      // у задачи с отчетом дайджест факта правится, и следующий --facts-only не видит в этом ручной правки
      const dir = mkProject('cf-hold-doc');
      wj(W(dir, 'facts.json'), {
        source: 'inputs/analysis.md', facts: [
          { id: 'F01', label: 'Адрес мастерской', value: 'Тула, ул. Новая, д. 3', wording: 'Тула, ул. Новая, д. 3', publish: 'yes', source_quote: 'адрес: Тула, ул. Новая, д. 3', kind: 'contact' },
          { id: 'F02', label: 'Почта', value: 'info@doc.example', wording: 'info@doc.example', publish: 'yes', source_quote: 'почта info@doc.example', kind: 'contact' },
        ],
        anti_promises: [], terminology: { use: [], jargon: [], untranslatable: [] },
        company: { brand: 'Док', status: 'missing', absent: ['address'], address: 'Тула, ул. Новая, д. 3' }, gaps: [],
      });
      const r = run(dir, ['scripts/import-project.mjs', '--company-facts']);
      const f = rj(W(dir, 'facts.json'));
      check('K1 --company-facts: факт о снятом адресе - publish no и строка gaps, почта не тронута, адреса в company нет', r.code === 0 && byId(f, 'F01').publish === 'no' && f.gaps.includes(HELD_LINE('F01', 'Адрес мастерской', 'адрес')) && byId(f, 'F02').publish === 'yes' && !f.company.address && !byId(f, 'F906') && /сняты с публикации по d10: F01/.test(r.stdout), r.out + JSON.stringify(f.gaps));
      const r2 = run(dir, ['scripts/import-project.mjs', '--company-facts']);
      check('K1 --company-facts: повтор - строка не множится', r2.code === 0 && rj(W(dir, 'facts.json')).gaps.filter(x => x.startsWith('F01 «')).length === 1, r2.out);
      // задача, импортированная прошлым kit (факт о снятом поле остался publish yes, так и в дайджесте): --company-facts
      // снимает его и правит дайджест, следующий --facts-only не видит ручной правки
      const hw = importCase('cf-hold-digest', p => { delete p.business.legal.schedule; p.business.legal.absent_fields = ['schedule']; });
      const ff = W(hw.dir, 'facts.json'), rf = W(hw.dir, 'import-report.json');
      const fx = rj(ff), f5 = byId(fx, 'F05'); f5.publish = 'yes'; fx.gaps = fx.gaps.filter(x => !x.startsWith('F05 «')); wj(ff, fx);
      const rp = rj(rf); rp.facts_digest.F05 = crypto.createHash('sha1').update(`${f5.value}\n${f5.wording}\nyes`).digest('hex').slice(0, 12); wj(rf, rp);
      const r3 = run(hw.dir, ['scripts/import-project.mjs', '--company-facts']);
      const dgHeld = crypto.createHash('sha1').update(`${f5.value}\n${f5.wording}\nno`).digest('hex').slice(0, 12);
      check('K1 --company-facts: факт прошлого kit снят, строка gaps, дайджест факта - по снятому виду', r3.code === 0 && byId(rj(ff), 'F05').publish === 'no' && rj(ff).gaps.includes(HELD_LINE('F05', 'График работы', 'часы работы')) && rj(rf).facts_digest.F05 === dgHeld, r3.out);
      const fo = run(hw.dir, ['scripts/import-project.mjs', '--project', hw.pf, '--queue', Q_WAIVER, '--facts-only']);
      check('K1 --company-facts: снятие по d10 не считается ручной правкой facts.json (--facts-only код 0)', fo.code === 0, fo.out);
    }

    // ---------- K3: отпечаток анализа - --facts-only сравнивает анализ с анализом, а не с рабочими файлами
    const strategist = dir => {
      // стратег дописывает адреса блоков, пояснения и свои пункты в client-preferences.json (04-strategist-global п.8)
      const cpf = W(dir, 'client-preferences.json');
      const cp = rj(cpf);
      cp.items = cp.items.map(x => ({ ...x, where: x.where === 'not-promise' ? 'B07-not-fit' : x.where, reason: `${x.reason} (стратег)` }));
      cp.items.push({ text: 'Свой пункт стратега', status: 'basis', where: 'all', reason: 'из inputs/client-preferences.md' });
      wj(cpf, cp);
    };
    {
      const fp = importCase('fp-base');
      check('K3: полный импорт пишет analysis_fingerprint по разделам', fp.r.code === 0 && JSON.stringify(Object.keys(fp.rep.analysis_fingerprint || {})) === JSON.stringify(['audience', 'client-preferences', 'directions', 'competitors-seed', 'anti_promises', 'company']), JSON.stringify(fp.rep?.analysis_fingerprint));
      checkSchema('K3: import-report.json с отпечатком', 'import-report', fp.rep || {});
      strategist(fp.dir);
      const FO = () => run(fp.dir, ['scripts/import-project.mjs', '--project', fp.pf, '--queue', Q_WAIVER, '--facts-only']);
      const r1 = FO();
      const rep1 = rj(W(fp.dir, 'import-report.json'));
      check('K3: правки стратега в client-preferences.json - не изменение анализа (other_changed пуст)', r1.code === 0 && JSON.stringify(rep1.other_changed) === '[]' && !/нужен повтор фазы 0/.test(r1.stdout), r1.out + JSON.stringify(rep1.other_changed));
      const p2 = rj(fp.pf); p2.constraints.must_say = ['выезд мастера в день заявки']; wj(fp.pf, p2);
      const r2 = FO();
      const rep2 = rj(W(fp.dir, 'import-report.json'));
      check('K3: пожелание в анализе изменилось - other_changed client-preferences, отпечаток раздела прежний', r2.code === 0 && JSON.stringify(rep2.other_changed) === JSON.stringify(['client-preferences']) && rep2.analysis_fingerprint['client-preferences'] === fp.rep.analysis_fingerprint['client-preferences'] && rep2.analysis_fingerprint.audience === fp.rep.analysis_fingerprint.audience, JSON.stringify([rep2.other_changed, rep2.analysis_fingerprint]));
      const r3 = FO();
      check('K3: повтор --facts-only без повтора фазы 0 - изменение по-прежнему видно', r3.code === 0 && JSON.stringify(rj(W(fp.dir, 'import-report.json')).other_changed) === JSON.stringify(['client-preferences']), r3.out);
    }
    {
      // переход «гейт не пройден» -> «согласовано» меняет пояснение пожеланий (reason), но не анализ
      const ug = importCase('fp-gate', null, Q_UNGATED, ['--allow-ungated']);
      strategist(ug.dir);
      const r = run(ug.dir, ['scripts/import-project.mjs', '--project', ug.pf, '--queue', Q_WAIVER, '--facts-only']);
      check('K3: гейт пройден после пилота - пожелания не «изменились»', r.code === 0 && !(rj(W(ug.dir, 'import-report.json')).other_changed || []).length, r.out);
    }
    {
      // отчет импорта без отпечатка (задача до программы): пожелания - парами «текст, статус», прочее - по рабочим файлам
      const old = importCase('fp-old');
      strategist(old.dir);
      const rp = rj(W(old.dir, 'import-report.json')); delete rp.analysis_fingerprint; wj(W(old.dir, 'import-report.json'), rp);
      const FO = () => run(old.dir, ['scripts/import-project.mjs', '--project', old.pf, '--queue', Q_WAIVER, '--facts-only']);
      const r1 = FO();
      const rep1 = rj(W(old.dir, 'import-report.json'));
      check('K3 без отпечатка: правки стратега (адреса, свои пункты) - не изменение; отпечаток записан', r1.code === 0 && JSON.stringify(rep1.other_changed) === '[]' && Object.keys(rep1.analysis_fingerprint || {}).length === 6, r1.out + JSON.stringify(rep1.other_changed));
      delete rep1.analysis_fingerprint; wj(W(old.dir, 'import-report.json'), rep1);
      const p2 = rj(old.pf); p2.offer.positioning = 'Ремонт на дому за один визит мастера'; wj(old.pf, p2);
      const r2 = FO();
      const rep2 = rj(W(old.dir, 'import-report.json'));
      check('K3 без отпечатка: текст пожелания в анализе изменился - client-preferences, раздела нет в новом отпечатке', r2.code === 0 && (rep2.other_changed || []).includes('client-preferences') && !('client-preferences' in rep2.analysis_fingerprint), JSON.stringify([rep2.other_changed, rep2.analysis_fingerprint]));
    }
    {
      // затравка старого kit (без name у доменов, без rejected) при отчете без отпечатка - не изменение анализа;
      // домен в анализе сменился - изменение
      const sd = importCase('fp-seed-old');
      const sf = W(sd.dir, 'competitors', 'seed.json');
      const s0 = rj(sf); s0.domains = s0.domains.map(({ name, ...d }) => d); delete s0.rejected; wj(sf, s0);
      const rp = rj(W(sd.dir, 'import-report.json')); delete rp.analysis_fingerprint; wj(W(sd.dir, 'import-report.json'), rp);
      const FO = () => run(sd.dir, ['scripts/import-project.mjs', '--project', sd.pf, '--queue', Q_WAIVER, '--facts-only']);
      const r1 = FO();
      check('K3 без отпечатка: затравка старого kit (без name и rejected) - competitors-seed не изменился', r1.code === 0 && !(rj(W(sd.dir, 'import-report.json')).other_changed || []).includes('competitors-seed'), r1.out);
      const rp2 = rj(W(sd.dir, 'import-report.json')); delete rp2.analysis_fingerprint; wj(W(sd.dir, 'import-report.json'), rp2);
      const p2 = rj(sd.pf); p2.competitors.list = ['new-rival.ru', ...p2.competitors.list.slice(1)]; wj(sd.pf, p2);
      const r2 = FO();
      check('K3 без отпечатка: домен затравки в анализе сменился - competitors-seed изменился', r2.code === 0 && (rj(W(sd.dir, 'import-report.json')).other_changed || []).includes('competitors-seed'), r2.out);
    }

    // ---------- K11: факт оператора, перенесенный в анализ (moved_from), снимается
    {
      const mv = importCase('moved');
      const ff = W(mv.dir, 'facts.json');
      const f = rj(ff);
      f.facts.push({ id: 'F812', label: 'срок выезда', value: 'выезд в день заявки', wording: 'Выезд в день заявки', publish: 'yes', source_quote: 'оператор: ответ заказчика в чате', kind: 'process', source: 'оператор: 2026-09-28 ответ заказчика' });
      f.facts.push({ id: 'F813', label: 'оплата', value: 'оплата после работы', wording: 'Оплата после работы', publish: 'yes', source_quote: 'оператор: ответ заказчика в чате', kind: 'process', source: 'оператор: 2026-09-28 ответ заказчика' });
      wj(ff, f);
      const p2 = rj(mv.pf);
      p2.facts.push({ id: 'f07', label: 'срок выезда', value: 'выезд в день заявки', kind: 'process', publish: 'yes', src: 'ответ', moved_from: 'F812' });
      wj(mv.pf, p2);
      const fo = run(mv.dir, ['scripts/import-project.mjs', '--project', mv.pf, '--queue', Q_WAIVER, '--facts-only']);
      const f2 = rj(ff), rep = rj(W(mv.dir, 'import-report.json'));
      check('K11 --facts-only: F812 перенесен в анализ (F07) - снят, F813 сохранен, предупреждение', fo.code === 0 && !byId(f2, 'F812') && !!byId(f2, 'F07') && !!byId(f2, 'F813') && rep.warnings.some(w => /факт оператора F812 перенесен в анализ \(F07, moved_from\)/.test(w)), fo.out);
      check('K11 --facts-only: facts_diff - F812 в removed, F07 в added', JSON.stringify(rep.facts_diff?.removed) === JSON.stringify(['F812']) && JSON.stringify(rep.facts_diff?.added) === JSON.stringify(['F07']), JSON.stringify(rep.facts_diff));
      const p3 = rj(mv.pf); p3.facts.push({ id: 'f08', label: 'оплата', value: 'оплата после работы', kind: 'process', publish: 'yes', src: 'ответ', moved_from: 'f813' }); wj(mv.pf, p3);
      const full = run(mv.dir, ['scripts/import-project.mjs', '--project', mv.pf, '--queue', Q_WAIVER]);
      const f3 = rj(ff);
      check('K11 полный импорт: moved_from без учета регистра - F813 снят, F08 из анализа', full.code === 0 && !byId(f3, 'F813') && !!byId(f3, 'F08') && !f3.facts.some(x => /^F8\d\d$/.test(x.id)), full.out);
    }

    // ---------- Р3: до 50 фактов анализа (потолок после гейта), номера не переиспользуются - есть пропуски
    {
      const many = importCase('fifty', p => {
        p.facts = Array.from({ length: 50 }, (_, i) => ({ id: `f${String(i < 45 ? i + 1 : i + 11).padStart(2, '0')}`, label: `факт номер ${i + 1}`, value: `значение факта номер ${i + 1}`, kind: 'claim', publish: 'yes', src: 'бриф' }));
      });
      check('Р3: 50 фактов анализа (id с пропусками до F60) - импорт код 0, все в facts.json, схема', many.r.code === 0 && many.facts.facts.filter(f => /^F[0-7]\d$/.test(f.id)).length === 50 && !!byId(many.facts, 'F60') && !schemaErrors('facts', many.facts).length, many.r.code ? many.r.out : '');
    }

    // ---------- причины «чем отличаемся»: опора - факты с отметкой публикации (reason.facts)
    {
      const rs = importCase('reasons', p => {
        p.facts.push({ id: 'f07', label: 'рейтинг', value: 'рейтинг 5,0 на картах', kind: 'number', publish: 'no', src: 'сайт' });
        p.offer.reasons = [
          { claim: 'Работаем давно', proof: 'с 2015 года, рейтинг 5,0', kind: 'опыт', facts: ['f01', 'f07'] },
          { claim: 'Нас хвалят', proof: 'рейтинг 5,0', kind: 'отзывы', facts: ['f07'] },
          { claim: 'Честная цена', proof: 'без доплат', kind: 'цена', facts: [] },
          { claim: 'Рейтинг выше всех', proof: 'рейтинг 5,0 на картах', kind: 'отзывы' },
          { claim: 'С 2015 года', proof: 'работаем с 2015 года', kind: 'опыт' },
        ];
      });
      const md = rs.r.code === 0 ? fs.readFileSync(path.join(rs.dir, 'inputs', 'analysis.md'), 'utf8') : '';
      const sec = (md.split('## Чем отличаемся')[1] || '').split('\n## ')[0];
      const [shown, held] = sec.split('Без доказательства');
      check('причины: опора с отметкой публикации, неопубликованная часть помечена', /- Работаем давно - доказательство \(опыт\): с 2015 года, рейтинг 5,0 \(опора: F01, публикация: да; F07 не публикуются - эту часть не используем\)/.test(shown || '') && /- С 2015 года - доказательство \(опыт\): работаем с 2015 года \(F01, публикация: да\)/.test(shown || ''), sec);
      check('причины без опубликованного факта - «Без доказательства (на страницу не идут)»', /- Нас хвалят \(отзывы\) - факты опоры не публикуются: F07/.test(held || '') && /- Честная цена \(цена\) - фактов опоры в контракте нет/.test(held || '') && /- Рейтинг выше всех \(отзывы\) - факт опоры не публикуется: F07/.test(held || '') && !/Нас хвалят|Честная цена|Рейтинг выше всех/.test(shown || ''), sec);
      check('render: мост cta_form и cta_mid -> cta-final', md.includes('## Обязательные блоки у рынка') && (() => { const r2 = importCase('cta-final', p => { p.competitors.market = { must_have: ['cta_form', 'cta_mid'] }; }); const m2 = fs.readFileSync(path.join(r2.dir, 'inputs', 'analysis.md'), 'utf8'); return m2.includes('- cta_form -> cta-final') && m2.includes('- cta_mid -> cta-final'); })());
    }

    // ---------- K5 и K4: ключевая фраза страницы в карте; сверка обогатителя mode=facts
    {
      const S = mkProject('k5', c => { c.site_url = 'https://test-co.example'; c.niche.business_type = 'services'; });
      wj(path.join(S, 'inputs', 'structure_data.json'), { pages: [
        { url: '/', name: 'Главная', type: 'Главная', target_status: 'yes', marker: 'ремонт бытовой техники в Туле', queries: [] },
        { url: '/remont', name: 'Ремонт', type: 'Услуга', target_status: 'yes', marker: 'ремонт холодильников в Туле', queries: [{ query: 'Ремонт холодильников в Туле', freq: 90 }, 'ремонт холодильника на дому'] },
        { url: '/kontakty', name: 'Контакты', type: 'Инфо', target_status: 'yes', queries: ['контакты сервиса'] },
        { url: '/o-nas', name: 'О нас', type: 'Инфо', target_status: 'yes' },
      ] });
      const r = run(S, ['scripts/import-structure.mjs']);
      const sm = r.code === 0 ? rj(W(S, 'sitemap.json')) : { pages: [] };
      const G = u => sm.pages.find(p => p.url === u) || {};
      check('K5: маркер - первым в source_queries и в key_phrase, subject - name (пункт меню)', r.code === 0 && G('/').key_phrase === 'ремонт бытовой техники в Туле' && JSON.stringify(G('/').source_queries) === JSON.stringify(['ремонт бытовой техники в Туле']) && G('/').subject === 'Главная', r.code ? r.out : JSON.stringify(G('/')));
      check('K5: запрос, совпавший с маркером без учета регистра, не повторяется; нет маркера - первый запрос; ничего нет - без key_phrase', JSON.stringify(G('/remont').source_queries) === JSON.stringify(['ремонт холодильников в Туле', 'ремонт холодильника на дому']) && G('/kontakty').key_phrase === 'контакты сервиса' && !('key_phrase' in G('/o-nas')) && !schemaErrors('sitemap', sm).length, JSON.stringify(sm.pages.map(p => [p.url, p.key_phrase, p.source_queries])));
      const CE = step => run(S, ['scripts/import-structure.mjs', '--check-enrich', step]);
      const map = W(S, 'sitemap.json'), copy = W(S, 'sitemap.pre-enrich.json');
      check('K4 --check-enrich after без before - код 2', CE('after').code === 2);
      const b1 = CE('before');
      const m1 = rj(map);
      m1.pages[1].facts_available = ['F01', 'F06']; m1.pages[1].fact_coverage = 2; m1.pages[1].block_set = 'short';
      wj(map, m1);
      const a1 = CE('after');
      check('K4 --check-enrich: изменены только facts_available, fact_coverage, block_set - код 0, правка на месте, копия удалена', b1.code === 0 && a1.code === 0 && rj(map).pages[1].block_set === 'short' && !fs.existsSync(copy) && /страниц с изменениями 1 \(remont\)/.test(a1.stdout), b1.out + a1.out);
      const good = fs.readFileSync(map, 'utf8');
      CE('before');
      const m2 = rj(map);
      m2.pages[0].nav_label = 'Сервис'; m2.pages[2].block_set = 'short'; m2.pages.pop();
      wj(map, m2);
      const a2 = CE('after');
      check('K4 --check-enrich: пропала страница и изменен nav_label - код 3, карта возвращена из копии', a2.code === 3 && fs.readFileSync(map, 'utf8') === good && /откат/.test(a2.stdout) && /пропали: o-nas/.test(a2.stdout) && !fs.existsSync(copy), a2.out);
      CE('before');
      const m3 = rj(map); m3.pages[0].nav_label = 'Сервис'; wj(map, m3);
      const a3 = CE('after');
      check('K4 --check-enrich: чужое поле страницы - строка «откат: home: поле nav_label изменено»', a3.code === 3 && /откат: home: поле nav_label изменено/.test(a3.stdout) && fs.readFileSync(map, 'utf8') === good, a3.out);
      CE('before');
      fs.writeFileSync(map, '{ битый json');
      const a4 = CE('after');
      check('K4 --check-enrich: битая карта - откат, код 3', a4.code === 3 && fs.readFileSync(map, 'utf8') === good, a4.out);
      check('K4 --check-enrich: неизвестный шаг - код 2, карта не тронута', CE('later').code === 2 && fs.readFileSync(map, 'utf8') === good);
      // стык с wf-04 (P3b): ровно команды из констант ENRICH_SAVE и ENRICH_CHECK, код отката - ENRICH_ROLLBACK
      const wf4 = fs.readFileSync(path.join(TPL, 'workflows', 'wf-04-strategy-layouts.js'), 'utf8');
      const cmdOf = name => ((wf4.match(new RegExp(`const ${name} = '([^']+)'`)) || [])[1] || '');
      const saveCmd = cmdOf('ENRICH_SAVE'), checkCmd = cmdOf('ENRICH_CHECK');
      const rbCode = Number((wf4.match(/const ENRICH_ROLLBACK = (\d+)/) || wf4.match(/exit_code === (\d+)/) || [])[1]);
      const argsOf = cmd => cmd.replace(/^node\s+/, '').split(/\s+/);
      check('K4 стык с wf-04: константы команд сверки есть', /import-structure\.mjs --check-enrich/.test(saveCmd) && /import-structure\.mjs --check-enrich/.test(checkCmd) && rbCode > 0, JSON.stringify({ saveCmd, checkCmd, rbCode }));
      if (saveCmd && checkCmd) {
        const s1 = run(S, argsOf(saveCmd));
        const mm = rj(map); mm.pages[0].facts_available = ['F01']; wj(map, mm);
        const c1 = run(S, argsOf(checkCmd));
        check('K4 стык с wf-04: ENRICH_SAVE и ENRICH_CHECK - код 0, правка трех полей на месте', s1.code === 0 && c1.code === 0 && JSON.stringify(rj(map).pages[0].facts_available) === '["F01"]', s1.out + c1.out);
        const kept = fs.readFileSync(map, 'utf8');
        run(S, argsOf(saveCmd));
        const m5 = rj(map); m5.pages[0].segment = 'S9'; wj(map, m5);
        const c2 = run(S, argsOf(checkCmd));
        check(`K4 стык с wf-04: лишняя правка - код отката wf-04 (${rbCode}), карта возвращена, строки « - откат: »`, c2.code === rbCode && fs.readFileSync(map, 'utf8') === kept && / - откат: home: поле segment изменено/.test(c2.stdout), c2.out);
        const c3 = run(S, argsOf(checkCmd));
        check('K4 стык с wf-04: ENRICH_CHECK без копии - код 2 (ENRICH_NO_COPY), не код отката', c3.code === 2 && c3.code !== rbCode && Number((wf4.match(/const ENRICH_NO_COPY = (\d+)/) || [0, 2])[1]) === 2, c3.out);
      }
      // синонимы формы прежнего wf-04: --check-enrich --save и голый --check-enrich
      const s4 = run(S, ['scripts/import-structure.mjs', '--check-enrich', '--save']);
      const c4 = run(S, ['scripts/import-structure.mjs', '--check-enrich']);
      check('K4 синонимы: --check-enrich --save = before, голый --check-enrich = after', s4.code === 0 && c4.code === 0 && !fs.existsSync(copy), s4.out + c4.out);
    }

    // ---------- промты пакета: условие факта в режиме doc, экспорт через Drive, снимок и absent, обогатитель mode=facts
    {
      const P0 = n => fs.readFileSync(path.join(TPL, 'prompts', `${n}.md`), 'utf8');
      const ex = P0('00-facts-extractor'), ck = P0('00-facts-checker'), du = P0('00-analysis-dumper'), sn = P0('00-site-snapshot'), en = P0('01-sitemap-enricher');
      check('--doc: условие факта остается в value и wording (экстрактор и проверяющий), в note - только дисклеймеры', /Условие факта[^\n]*\n?[^\n]*остается в `value` и `wording`/.test(ex) && !/без оговорок\)/.test(ex) && /условие факта[\s\S]{0,120}в `value` и `wording`, а не в `note`/.test(ck));
      check('--doc: дамп первым путем - экспорт через Drive (downloadFile), readGoogleDoc - последним', du.indexOf('downloadFile') > 0 && du.indexOf('downloadFile') < du.indexOf('readGoogleDoc') && /text\/markdown/.test(du));
      check('снимок: поля company.absent не заполняет', /company\.absent/.test(sn));
      check('обогатитель: mode=facts (три поля и §6), повторный проход не затирает правки карты, geo из key_phrase', /mode=facts/.test(en) && /`facts_available`, `fact_coverage` и `block_set`/.test(en) && /Повторный проход/.test(en) && /key_phrase/.test(en));
      // mode=facts: из §6 только short (block_set); skip меняет status - сверка откатила бы весь проход
      const modeFacts = (en.match(/`mode=facts`[\s\S]*?(?=\n- )/) || [''])[0];
      check('обогатитель mode=facts: из п. 9 только решения short, status не меняет (skip - полным проходом, в notes)', /только решения `short`/.test(modeFacts) && /`status` не меняй/.test(modeFacts) && /skip/.test(modeFacts), modeFacts);
      check('дамп: ошибка пути или файла нет на месте - сразу следующий путь', /сразу следующий путь/.test(du) && /есть и не пуст/.test(du));
      const wf = fs.readFileSync(path.join(TPL, 'workflows', 'wf-00-facts.js'), 'utf8');
      check('wf-00: второй проход экстрактора не срезает условие факта', /условие факта оставь в value и wording/.test(wf));
    }
  }
} catch (e) {
  fail++; failures.push(`FAIL исключение: ${e.stack || e.message}`);
} finally {
  if (server) server.kill();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
}

failures.forEach(f => console.log(f));
notes.forEach(n => console.log(n));
console.log(`cases-import: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
