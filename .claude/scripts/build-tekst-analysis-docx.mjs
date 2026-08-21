#!/usr/bin/env node
// build-tekst-analysis-docx.mjs
// Клиентский документ согласования: анализ ЦА + стратегия оффера, ДО написания текстов.
// Заказчик читает -> OK или правки -> revising-цикл (паттерн /seo-analiz).
//
// Вход:  <texts_dir>/inputs.json, audience.json, strategy.json
//        (+ pages.json для автономного источника, + facts.json / intake.json - опционально)
// Выход: <texts_dir>/Analysis_<slug>.docx
// Использование: node build-tekst-analysis-docx.mjs <texts_dir>
//
// Секция «0. Состав страниц» рендерится ТОЛЬКО когда страницы собраны из брифа
// (pages.json.source начинается с "brief:", источник --from-brief, ADR-031): структуры сайта
// в таком проекте нет, и состав должен получить подпись заказчика здесь. Для источников
// structure/analysis/table состав уже согласован раньше - секция не нужна.
//
// Секция «Формулировки, которые встанут на всех страницах» (ADR-037 п.9) - канон проекта:
// строки, которые дальше тиражируются дословно и закрыты для правок аудитора, подписывает
// заказчик. Нет канона в strategy/facts - секции нет (ADR-031).
//
// Секция «3. Что нужно от вас» собирается во ВСЕХ источниках: круг сбора недостающей
// фактуры есть только у brief (шаг 2a), а клиентский гейт - везде. Дыры (`[ЗАПОЛНИТЬ]`)
// должны доехать до заказчика здесь, а не всплыть в финальной сводке, когда переписывать
// блоки уже дорого. Все три источника секции опциональны - нет данных, нет секции.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve, basename } from "node:path";
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } from "docx";

const dir = process.argv[2] ? resolve(process.argv[2]) : null;
if (!dir) { console.error("[build-tekst-analysis-docx] usage: <texts_dir>"); process.exit(1); }
// Файла нет - штатная деградация ({}): все входы, кроме inputs, опциональны.
// Файл есть и не разбирается - это поломка (strategy.json оркестратор правит руками на гейте):
// раньше наружу летел голый стек SyntaxError без имени файла, теперь - диагноз и exit 1.
// Собирать документ согласования из уцелевшей половины нельзя: заказчик подпишет неполное.
const readJson = (p) => {
  if (!existsSync(p)) return {};
  try {
    const v = JSON.parse(readFileSync(p, "utf8").replace(/^﻿/, ""));
    return v && typeof v === "object" ? v : {};
  } catch (e) {
    console.error(`[build-tekst-analysis-docx] НЕ РАЗОБРАН ${p}: ${e.message}`);
    process.exit(1);
  }
};

const inputs = readJson(join(dir, "inputs.json"));
const audience = readJson(join(dir, "audience.json"));
const strategy = readJson(join(dir, "strategy.json"));
const pagesData = readJson(join(dir, "pages.json"));
const facts = readJson(join(dir, "facts.json"));   // опционально
const intake = readJson(join(dir, "intake.json")); // опционально

const slug = inputs.slug || (basename(dir).match(/^\d+-(.+)$/) || [, "site"])[1];
const company = inputs.brand_name || inputs.company || inputs.domain || slug;
const NAVY = "1F4E79";
const out = [];

const H1 = (t) => out.push(new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 240, after: 120 }, children: [new TextRun({ text: t, bold: true, color: NAVY, font: "Arial", size: 30 })] }));
const H2 = (t) => out.push(new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 200, after: 80 }, children: [new TextRun({ text: t, bold: true, color: NAVY, font: "Arial", size: 26 })] }));
const H3 = (t) => out.push(new Paragraph({ spacing: { before: 120, after: 40 }, children: [new TextRun({ text: t, bold: true, font: "Arial", size: 23 })] }));
const P = (t, opts = {}) => out.push(new Paragraph({ spacing: { after: 80 }, children: [new TextRun({ text: String(t), font: "Arial", size: 22, ...opts })] }));
const LI = (t) => out.push(new Paragraph({ bullet: { level: 0 }, spacing: { after: 30 }, children: [new TextRun({ text: String(t), font: "Arial", size: 22 })] }));
// пункт списка с серой пометкой справа (метка тезиса, уровень доказательства)
const LI2 = (t, note) => out.push(new Paragraph({
  bullet: { level: 0 }, spacing: { after: 30 },
  children: [
    new TextRun({ text: String(t), font: "Arial", size: 22 }),
    ...(note ? [new TextRun({ text: "  - " + note, italics: true, color: "888888", font: "Arial", size: 19 })] : []),
  ],
}));
const SPACER = () => out.push(new Paragraph({ children: [new TextRun({ text: "" })] }));
const arr = (x) => (Array.isArray(x) ? x : x ? [x] : []);
const uniq = (list) => [...new Set(list.map((s) => String(s).trim()).filter(Boolean))];

// Вариант решения может прийти строкой (канон) или объектом - объект не должен уехать
// в клиентский документ как [object Object].
const variantText = (v) => {
  if (v == null) return "";
  if (typeof v !== "object") return String(v);
  const screen = [v.h1, v.subhead ?? v.sub, v.cta_label ?? v.cta].filter(Boolean);
  if (screen.length) return screen.join(" · ");
  const fallback = [v.text, v.variant, v.value, v.wording, v.label].find((x) => typeof x === "string" && x.trim());
  return fallback || "";
};

// Состав страниц показываем только автономному источнику (--from-brief): структуры нет,
// подпись под списком страниц берём здесь.
const pagesList = arr(pagesData.pages);
const showPages = pagesList.length > 0 && /^brief:/.test(String(pagesData.source || ""));

// ---------- что нужно от заказчика (дыры фактуры) ----------
// Дыра = пустое значение либо явная заглушка. Служебные разделы facts.json (словарь,
// список opsec) в опрос не идут - это не фактура, а разметка для агентов.
const HOLE = /\[ЗАПОЛНИТЬ|требует уточнения/i;
const isHole = (v) => v == null || (typeof v === "string" && (!v.trim() || HOLE.test(v)));
const SKIP_FACT_KEYS = new Set(["lexicon", "opsec_restricted", "notes", "publish", "alt_value", "source", "quote", "where", "why"]);
const FACT_LABELS = {
  "jur.entity": "юридическое лицо - ООО или ИП и полное название",
  "jur.brand_face": "от чьего лица говорим на сайте (имя, роль)",
  "jur.requisites.inn": "ИНН",
  "jur.requisites.ogrn": "ОГРН",
  "jur.requisites.kpp": "КПП",
  "jur.requisites.address": "юридический адрес",
  "jur.requisites.phone": "телефон для сайта",
  "jur.requisites.email": "email для сайта",
  "product_guarantee.what": "точная формулировка того, что вы продаете",
  "product_guarantee.guarantee": "формулировка гарантии - что именно и на какой срок",
  "product_guarantee.deadlines": "сроки работ (от и до)",
  "product_guarantee.prices": "цены или прайс - хотя бы «от» по основным позициям",
};
const KEY_LABELS = {
  inn: "ИНН", ogrn: "ОГРН", ogrnip: "ОГРНИП", kpp: "КПП", okpo: "ОКПО",
  address: "юридический адрес", email: "email для сайта", phone: "телефон для сайта",
  company: "название компании", entity: "юридическое лицо", brand_face: "от чьего лица говорим на сайте",
  prices: "цены или прайс", deadlines: "сроки работ", guarantee: "формулировка гарантии",
  what: "что именно вы продаете", requisites: "реквизиты", site: "адрес сайта",
};
const humanField = (path) => FACT_LABELS[path] || KEY_LABELS[path.split(".").pop()] || path.split(".").pop();

function collectFactHoles(node, path, acc) {
  if (Array.isArray(node)) {
    for (const item of node) {
      if (!item || typeof item !== "object") continue;
      if ("value" in item || "label" in item) {
        // числа компании: publish:"no" - сознательный запрет на публикацию, а не дыра
        if (String(item.publish || "").trim().toLowerCase() === "no") continue;
        if (isHole(item.value)) acc.push(`цифра: ${String(item.label || "").trim() || humanField(path)}`);
        continue;
      }
      collectFactHoles(item, path, acc);
    }
    return;
  }
  if (!node || typeof node !== "object") return;
  for (const [k, v] of Object.entries(node)) {
    if (SKIP_FACT_KEYS.has(k)) continue;
    const p = path ? `${path}.${k}` : k;
    if (v && typeof v === "object") collectFactHoles(v, p, acc);
    else if (isHole(v)) acc.push(humanField(p));
  }
}

const gapText = (g) => (g && typeof g === "object" ? String(g.question || g.gap || g.field || g.topic || "").trim() : String(g || "").trim());
const factHoles = [];
collectFactHoles(facts, "", factHoles);
const needFacts = uniq(factHoles);
const needMaterials = uniq(arr(strategy.materials_missing).map((m) => (m && typeof m === "object" ? String(m.what || m.item || m.label || "") : String(m))));
const needIntake = uniq(arr(intake.gaps).map(gapText));
const showNeeds = needFacts.length + needMaterials.length + needIntake.length > 0;

// Документ согласования без решений и без портретов - это шапка и подпись под пустотой.
// Раньше такой файл собирался с кодом 0 и уезжал заказчику на гейт как готовый.
const hasDecisions = Object.keys(strategy.decisions || {}).length > 0 || !!strategy.positioning || !!strategy.idea;
const hasAudience = arr(audience.personas).length > 0 || Object.keys(audience.summary || {}).length > 0;
if (!hasDecisions && !hasAudience) {
  console.error("[build-tekst-analysis-docx] нечего согласовывать: нет ни strategy.decisions, ни audience.personas - документ не собран");
  console.error(`  проверь ${join(dir, "strategy.json")} и ${join(dir, "audience.json")}`);
  process.exit(1);
}

// ---------- шапка ----------
out.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 60 }, children: [new TextRun({ text: "Анализ ЦА и стратегия текстов", bold: true, color: NAVY, font: "Arial", size: 36 })] }));
out.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 }, children: [new TextRun({ text: company + (inputs.niche ? "  -  " + inputs.niche : ""), italics: true, font: "Arial", size: 24, color: "666666" })] }));
P("Документ на согласование ПЕРЕД написанием текстов. Проверьте: " + (showPages ? "состав страниц, " : "") + "верно ли пойман портрет клиента, боли, позиционирование и оффер. После вашего OK (или правок) пишем тексты страниц." + (showNeeds ? " В конце - список того, что нужно прислать с вашей стороны." : ""), { italics: true, color: "888888" });
SPACER();

// ---------- состав страниц (только автономный источник) ----------
if (showPages) {
  H1("0. Состав страниц - подтвердите");
  P("Список собран из вашей вводной информации. Проверьте: все ли нужные страницы на месте и нет ли лишних. Тексты пишем ровно по этому списку - добавить страницу позже дороже, чем сейчас.", { italics: true, color: "888888" });
  // Нумерация своя, поэтому НЕ через LI (bullet) - иначе в Word выйдет «• 1. ...».
  // Тип страницы первым: заказчик читает документ как список страниц сайта, а не как семантику.
  pagesList.forEach((p, i) => {
    const what = p.marker || p.slug || "";
    const line = `${i + 1}. ${p.type || "Страница"}${what ? " - " + what : ""}`;
    P(line + (p.url ? `   ${p.url}` : ""), { size: 22 });
  });
  P(`Всего страниц: ${pagesList.length}`, { bold: true });
  SPACER();
}

// ---------- стратегия / оффер ----------
H1("1. Решения на ВАШ выбор");
const decisions = strategy.decisions || {};
// Регистр идет ПЕРВЫМ: он задает и состав блоков, и все остальные формулировки.
const decLabels = {
  register: "Тон общения с клиентом (выберите первый экран)",
  positioning: "Позиционирование (одной строкой)",
  idea: "Идея / красная нить (метафора)",
  price_presentation: "Подача цены",
  cta_tone: "Формулировка главной кнопки (CTA)",
};
if (Object.keys(decisions).length) {
  P("Это решения о бренде - они за вами. Отметьте по одному варианту в каждом пункте (или напишите свой). Тексты пишем строго по вашему выбору.", { italics: true, color: "888888" });
  for (const [key, label] of Object.entries(decLabels)) {
    const d = decisions[key]; if (!d || !arr(d.variants).length) continue;
    H3(label);
    // Выбирается ТОН, а не готовые строки: финальный первый экран пишет писатель уже внутри
    // выбранного тона (по формуле оффера и лимитам блока). Без слова «черновые» заказчик
    // подписывал конкретный H1 и заходил на круг правок, не увидев его в Texts.docx.
    if (key === "register") P("Ниже - варианты первого экрана целиком. Тексты в них черновые: их задача - показать разницу тона, а не стать финальными строками сайта. Выберите тон, которым вам самим не стыдно встретить клиента: по нему настроим все страницы, а окончательный текст первого экрана напишем уже внутри выбранного тона.", { italics: true, color: "888888", size: 19 });
    d.variants.forEach((v, i) => {
      const rec = i === d.recommended ? "  (рекомендуем)" : "";
      const text = variantText(v);
      // Вариант регистра - это первый экран «H1 · подзаголовок · кнопка»: разбираем на строки,
      // иначе заказчик читает три длинные строки вместо трех экранов. Нет разделителя - печатаем как есть.
      const screen = key === "register" ? text.split(/\s*·\s*/).map((s) => s.trim()).filter(Boolean) : [];
      const flag = d.region_flag && d.region_flag[i]
        ? [new TextRun({ text: "  [звучит «по-западному» - для региона риск]", italics: true, color: "C00000", font: "Arial", size: 18 })]
        : [];
      if (screen.length > 1) {
        out.push(new Paragraph({ spacing: { after: 20 }, children: [new TextRun({ text: `Вариант ${i + 1}${rec}`, bold: i === d.recommended, font: "Arial", size: 22 }), ...flag] }));
        P("    " + screen[0], { bold: true });                            // заголовок первого экрана
        if (screen[1]) P("    " + screen[1]);                             // подзаголовок
        if (screen[2]) P("    кнопка: «" + screen[2] + "»", { color: "555555" });
        for (const extra of screen.slice(3)) P("    " + extra, { color: "555555" }); // хвост не теряем
      } else {
        const line = key === "register" ? `Вариант ${i + 1}: ${text}${rec}` : `${i + 1}. ${text}${rec}`;
        out.push(new Paragraph({ spacing: { after: 20 }, children: [new TextRun({ text: line, bold: i === d.recommended, font: "Arial", size: 22 }), ...flag] }));
      }
      if (d.rationale && d.rationale[i]) P("    " + d.rationale[i], { italics: true, color: "888888", size: 19 });
    });
  }
}
// backward-compat: старый формат (одиночные поля)
if (strategy.positioning && !decisions.positioning) { H3("Позиционирование"); P(strategy.positioning, { bold: true }); }
if (strategy.idea && !decisions.idea) { H3("Идея / красная нить"); P(strategy.idea, { bold: true }); }

// ---------- канон: формулировки, которые встанут на всех страницах (ADR-037 п.9) ----------
// Источники: strategy (на гейте) и facts.lexicon.canonical (после переноса оркестратором,
// круги правок); дубли по формулировке схлопываем. Плейсхолдеры не печатаем: дыра фактуры
// уходит заказчику секцией «Что нужно от вас», а не строкой, которую он подпишет.
const cs = (x) => (typeof x === "string" ? x.trim() : "");
const ORIGIN_WHY = {
  "проверяемый факт": "точная формулировка - на сайте стоит слово в слово",
  "клиент-требование": "ваша формулировка, сохраняем дословно по вашей просьбе",
};
const canon = [];
const canonSeen = new Set();
for (const raw of [...arr(strategy.canonical_wordings), ...arr((facts.lexicon || {}).canonical)]) {
  const c = raw && typeof raw === "object" ? raw : { wording: raw };
  const wording = cs(c.wording);
  const key = wording.toLowerCase();
  if (isHole(wording) || canonSeen.has(key)) continue;
  canonSeen.add(key);
  const client = cs(c.client_variant);
  canon.push({ wording, client: isHole(client) ? "" : client, thought: cs(c.thought), where: cs(c.where), origin: cs(c.origin).toLowerCase() });
}
if (canon.length) {
  H2("Формулировки, которые встанут на всех страницах");
  P("Эти строки повторяются одинаково на всех страницах - в первом экране, в блоках, в футере, в заголовках для поиска. Синонимы здесь читаются как разные обещания, поэтому формулировка фиксируется один раз. Проверьте их сейчас: правка после написания текстов идет сразу по всем страницам.", { italics: true, color: "888888" });
  for (const c of canon) {
    if (c.client) P("Ваша фраза: " + c.client, { color: "555555" });
    P("Как будет на сайте: " + c.wording, { bold: true });
    const why = [
      ORIGIN_WHY[c.origin] || (c.client ? "формулировка по формуле оффера: мысль ваша, подача наша" : ""),
      c.thought ? "мысль «" + c.thought + "»" : "",
      c.where ? "где встречается: " + c.where : "",
    ].filter(Boolean).join("; ");
    if (why) P("Почему: " + why, { italics: true, color: "888888", size: 19 });
  }
}

H2("Стратегия (техническое - решает команда)");
if (strategy.warmth_stage != null) P(`Стадия прогретости: ${strategy.warmth_stage} - ${strategy.warmth_rationale || ""}`);
// Имя и номер формулы живут в структурном рецепте (ADR-037 п.4); плоские offer_formula_name /
// offer_formula остаются фолбэком для старых задач и для рецепта строкой (ADR-031).
const recipe = strategy.offer_formula_recipe;
const recipeObj = recipe && typeof recipe === "object" && !Array.isArray(recipe) ? recipe : null;
const fno = (x) => (x ? String(x).trim() : "");
const formulaNo = (recipeObj ? fno(recipeObj.formula) : "") || fno(strategy.offer_formula);
const formulaName = (recipeObj ? cs(recipeObj.name) : "") || cs(strategy.offer_formula_name);
if (formulaNo) P(`Формула оффера: №${formulaNo}${formulaName ? " - " + formulaName : ""}`);
if (strategy.design_theme) P(`Палитра: ${strategy.design_theme}`, { color: "888888" });

// Тезис: строка (канон) либо {thesis, label, repacked}. Метка «гордость» без переупаковки -
// это внутренняя разметка стратега (гордость производства, а не выгода клиента): заказчику не показываем.
const PRIDE = /горд/i;
function thesisLine(t) {
  if (t == null) return null;
  if (typeof t !== "object") return { text: String(t), note: "" };
  const label = String(t.label || "").trim();
  const repacked = String(t.repacked || "").trim();
  const pride = PRIDE.test(label);
  if (pride && !repacked) return null;
  const text = repacked || String(t.thesis || t.text || "").trim();
  if (!text) return null;
  return { text, note: pride ? "" : label };
}
// Доказательство: строка либо {proof, level, artifact}. Уровень переводим в человеческий.
const LEVEL_NUM = { 1: "проверяемо третьей стороной", 2: "наблюдаемое", 3: "заявленное" };
const levelWord = (lv) => {
  const s = String(lv == null ? "" : lv).trim();
  if (!s) return "";
  // канон схемы - число 1|2|3; строковые синонимы держим для совместимости и ручных правок
  if (LEVEL_NUM[s]) return LEVEL_NUM[s];
  const low = s.toLowerCase();
  if (/third|сторон|проверя|документ|официальн/.test(low)) return "проверяемо третьей стороной";
  if (/observ|наблюда|видим|видн|показыва/.test(low)) return "наблюдаемое";
  if (/claim|заявл|на словах|обеща/.test(low)) return "заявленное";
  return s;
};
function proofLine(p) {
  if (p == null) return null;
  if (typeof p !== "object") return { text: String(p), note: "" };
  const text = String(p.proof || p.text || "").trim();
  if (!text) return null;
  const note = [levelWord(p.level), String(p.artifact || "").trim() ? "подтверждение: " + String(p.artifact).trim() : ""].filter(Boolean).join("; ");
  return { text, note };
}

const theses = arr(strategy.selling_theses).map(thesisLine).filter(Boolean);
if (theses.length) { H2("Продающие тезисы (факт -> выгода)"); for (const t of theses) LI2(t.text, t.note); }
const proofs = arr(strategy.proof_inventory).map(proofLine).filter(Boolean);
if (proofs.length) { H2("Подтвержденные цифры/доказательства"); for (const t of proofs) LI2(t.text, t.note); }
// materials_missing переехал в секцию «что нужно от вас» - здесь только то, что уже есть.
if (arr(strategy.materials_have).length) {
  H2("Материалы проекта");
  H3("Есть в наличии");
  for (const t of arr(strategy.materials_have)) LI(t);
}
SPACER();

// ---------- аудитория ----------
H1("2. Анализ целевой аудитории");
const personas = arr(audience.personas);
personas.forEach((p, i) => {
  H2(`Портрет ${i + 1}: ${p.name || "Сегмент"}`);
  const facts = [p.age && `возраст ${p.age}`, p.income && `доход ${p.income}`, p.family, p.lifestyle].filter(Boolean).join("; ");
  if (facts) P(facts);
  if (p.values) P("Ценности: " + p.values);
  if (arr(p.page_links).length) P("Страницы сайта: " + arr(p.page_links).join(", "), { color: "888888" });
  if (arr(p.pains).length) { H3("Боли"); for (const pain of arr(p.pains)) LI(typeof pain === "string" ? pain : (pain.problem || JSON.stringify(pain))); }
  if (arr(p.fears).length) { H3("Страхи"); for (const f of arr(p.fears)) LI(f); }
  if (arr(p.objections).length) { H3("Возражения"); for (const o of arr(p.objections)) LI(typeof o === "string" ? o : `${o.says || ""}${o.behind ? " -> " + o.behind : ""}`); }
  if (p.transformation) { const t = p.transformation; H3("Трансформация (результат)"); P([t.changed, t.feels, t.others_say].filter(Boolean).join(" / ")); }
});

const sum = audience.summary || {};
if (Object.keys(sum).length) {
  H2("Компактная сводка");
  const blocks = [["Боли", sum.pains], ["Страхи", sum.fears], ["Возражения", sum.objections], ["Триггеры конверсии", sum.triggers], ["Цитаты клиентов", sum.quotes]];
  for (const [label, items] of blocks) if (arr(items).length) { H3(label); for (const it of arr(items)) LI(it); }
}

// ---------- что нужно от заказчика ----------
if (showNeeds) {
  SPACER();
  H1("3. Что нужно от вас для текстов");
  P("Это то, чего у нас нет и что нельзя придумать за вас. Пришлите одним сообщением или файлами - можно частями, но до начала письма: вписать факт в готовый блок дороже, чем заложить его сразу.", { italics: true, color: "888888" });
  if (needFacts.length) { H3("Данные и цифры"); for (const t of needFacts) LI(t); }
  if (needMaterials.length) { H3("Материалы (фото, кейсы, отзывы, документы)"); for (const t of needMaterials) LI(t); }
  if (needIntake.length) { H3("Вопросы, которые остались открытыми"); for (const t of needIntake) LI(t); }
  P("Чего не дадите - останется в тексте пометкой [ЗАПОЛНИТЬ]: цифры, отзывы и кейсы за вас мы выдумывать не будем.", { italics: true, color: "C00000" });
}

SPACER();
P("- - - конец документа на согласование - - -", { color: "AAAAAA", italics: true });

// ---------- запись ----------
const doc = new Document({ sections: [{ properties: { page: { margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } }, children: out }] });
const outPath = join(dir, `Analysis_${slug}.docx`);
const buffer = await Packer.toBuffer(doc);
writeFileSync(outPath, buffer);
console.log(`[build-tekst-analysis-docx] wrote ${outPath}`);
console.log(`  персонажей: ${personas.length}, тезисов: ${theses.length}` + (showNeeds ? `, запросов заказчику: ${needFacts.length + needMaterials.length + needIntake.length}` : ""));
