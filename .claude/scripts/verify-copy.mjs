#!/usr/bin/env node
// verify-copy.mjs
// Pre-flight КОПИ-валидатор: механические пункты чек-листа COPY-AUDIT.md по page.json
// ДО сборки HTML (жаргон+утечка кухни, манипуляции, H1, эмодзи, тире, лимиты слотов).
// Смысл, удар в боль ЦА, регистр и штампы добивает агент copy-auditor (анти-ИИ-детект тут НЕ делаем - ADR-022).
//
// Использование: node verify-copy.mjs <page_dir|page.json>
// Exit: 0 ok | 2 нарушения | 1 фатально (нет page.json).

import { readFileSync, existsSync, statSync } from "node:fs";
import { join, resolve, dirname, basename } from "node:path";

const arg = process.argv[2] ? resolve(process.argv[2]) : null;
if (!arg) { console.error("[verify-copy] usage: <page_dir|page.json>"); process.exit(1); }
const pjPath = existsSync(arg) && statSync(arg).isDirectory() ? join(arg, "page.json") : arg;
if (!existsSync(pjPath)) { console.error(`[verify-copy] нет page.json: ${pjPath}`); process.exit(1); }
const page = JSON.parse(readFileSync(pjPath, "utf8").replace(/^﻿/, ""));

const violations = [], warnings = [];
const V = (m) => violations.push(m);
const W = (m) => warnings.push(m);
const arr = (x) => (Array.isArray(x) ? x : []);
function collect(o, acc = []) {
  if (o == null) return acc;
  if (typeof o === "string") { acc.push(o); return acc; }
  if (Array.isArray(o)) { for (const v of o) collect(v, acc); return acc; }
  if (typeof o === "object") { for (const v of Object.values(o)) collect(v, acc); return acc; }
  return acc;
}
const blocks = arr(page.blocks);
const allText = blocks.map((b) => collect(b.slots).concat(b.h2 ? [b.h2] : []).join("  ")).join("\n");
const low = allText.toLowerCase();
const h1 = (() => { const hero = blocks.find((b) => b.fragment === "hero" || /первый экран|hero/i.test(b.type || "")); return (hero && hero.slots && hero.slots.h1) || page.h1 || ""; })();
const h2s = blocks.map((b) => b.h2 || (b.slots && b.slots.h2) || "").filter(Boolean);
const firstScreenText = (() => { const hero = blocks.find((b) => b.fragment === "hero"); return hero ? collect(hero.slots).join(" ") : ""; })();
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/u;
const ARROWS = /[\u{2190}-\u{21FF}]/u; // типографские стрелки - не эмодзи, отдельная W-проверка

// 1. самозащита
if (/не как у (?:других|них)|без того,? чтобы|больше не придётся|забудьте о том/i.test(allText)) V("п.1 самозащита (паттерны: «не как у других/них», «без того, чтобы», «больше не придётся», «забудьте о том») - заменить на утверждение/цифру");
if (/защищены от/i.test(allText)) W("п.1 «защищены от» - ок как замена отрицания (VOICE.md), но проверь, что это не спор с конкурентом");
// 2. жаргон маркетолога + утечка внутренней кухни (Сургай/кастдев) в клиентском тексте
const jarg = (low.match(/(?<![а-яёa-z0-9_])(сургай|кастдев|customer dev|jtbd|cjm|оффер|конверси[а-яё]*|воронк[а-яё]*|сегмент[а-яё]*|персонаж|аватар|утп|usp|лид-?маг[а-яё]*)(?![а-яёa-z0-9_])/gi) || []);
if (jarg.length) V(`п.2 жаргон маркетолога / утечка кухни в тексте: ${[...new Set(jarg)].join(", ")} (Сургай/кастдев - наша методика, не для клиента)`);
// 3. аббревиатуры в H1 (латиница/кириллица заглавными 2-5, кроме бренда из inputs.json)
const inputsPath = join(dirname(pjPath), "..", "..", "inputs.json");
let brand = "";
try { if (existsSync(inputsPath)) brand = String(JSON.parse(readFileSync(inputsPath, "utf8").replace(/^﻿/, "")).brand_name || "").toUpperCase(); } catch {}
const abbrH1 = (h1.match(/(?<![А-ЯЁA-Z0-9])[А-ЯЁA-Z]{2,5}(?![А-ЯЁA-Z0-9])/g) || []).filter((a) => !brand.includes(a) && !/^(ГОСТ|ТУ|РФ|СПБ)$/.test(a));
if (abbrH1.length) W(`п.3 возможные аббревиатуры в H1: ${abbrH1.join(", ")} (в Hero/H1 - 0; проверь)`);
// 4. дворовая лексика + тройные отрицания
if (/(?<![а-яёa-z0-9_])реально(?![а-яёa-z0-9_])|по-честному|нарвал|кинул(?:и)?|без условий/i.test(allText)) W("п.4 дворовая лексика («реально/по-честному/нарвались»)");
if (/(?:(?<![а-яёa-z0-9_])не(?![а-яёa-z0-9_])[^.!?]{0,30}){3,}/i.test(allText)) W("п.4 тройное отрицание подряд (максимум одно «не»)");
// 5. манипуляции
if (/только сегодня|осталось \d+ мест|успей(?:те)?|сгорит|перечёркнут/i.test(allText)) V("п.5 манипуляция (ложная срочность/дефицит/перечёркнутая цена)");
// 6. сленг-плейсхолдеры
if (/ща докрутим|допил(?:им|ить)|потом доделаем/i.test(low)) V("п.6 сленг в плейсхолдере («Ща Докрутим/допилим») - только [ЗАПОЛНИТЬ]/«требует уточнения»");
// 9. лимиты H1
if (h1 && h1.length > 60) V(`п.9 H1 > 60 символов (${h1.length}): «${h1.slice(0, 50)}...»`);
if (h1 && (h1.match(/,/g) || []).length >= 2) W("п.9 H1 содержит перечисление (>=2 запятых) - убрать в подзаголовок");
// мета Description: пишет page-writer (prototype-builder не сочиняет), лимит 160
const metaDesc = String((page.page && page.page.description) || "");
if (metaDesc.length > 160) V(`мета Description > 160 символов (${metaDesc.length})`);
if (!metaDesc.trim()) W("мета Description отсутствует/пуст (page.page.description)");
// 12. эмодзи в H1 / первом экране
if (EMOJI.test(h1) || EMOJI.test(firstScreenText)) V("п.12 эмодзи на первом экране (Hero) - убрать");
if (h2s.some((h) => EMOJI.test(h))) W("п.12 эмодзи в H2 - максимум один источник на странице");
if (ARROWS.test(h1) || ARROWS.test(firstScreenText)) W("типографская стрелка в Hero - в hero стрелка только SVG (BLOCKS.md), текстовые ←/→ заменить");
// типографика (П.13): длинное/среднее тире -> дефис, жёсткое правило проекта
const dashCount = (allText.match(/—|–/g) || []).length + (allText.includes(h1) ? 0 : (h1.match(/—|–/g) || []).length);
if (dashCount) V(`типографика: длинное/среднее тире (— –) ${dashCount} шт - заменить на дефис (-)`);
// буква ё - запрещена во всех клиентских текстах (как и тире)
const yoCount = (allText.match(/[ёЁ]/g) || []).length + (allText.includes(h1) ? 0 : (h1.match(/[ёЁ]/g) || []).length);
if (yoCount) V(`типографика: буква ё ${yoCount} шт - заменить на е`);
// слабые филлер-обороты и канцелярит (W - чистит copy-auditor); lookaround вместо \b (в JS \b ASCII-only)
if (/(?<![а-яё])(важно отметить|стоит отметить|следует подчеркнуть|таким образом|подводя итог|на сегодняшний день|в современном мире|не секрет, что)(?![а-яё])/i.test(low)) W("филлер/канцелярит - убрать, начать с сути");
// бюджет блоков
if (blocks.length > 14) W(`блоков ${blocks.length} (бюджет <= 12 содержательных + служебные)`);

// сверка длин scalar-слотов с limits из blueprint (только простые "N-M"; несущее ограничение вёрстки).
// V лишь при превышении верхней границы более чем на 15% (ломает вёрстку); недобор/превышение до 15% - W.
const pageSlug = String((page.page && page.page.slug) || basename(dirname(pjPath)));
const bpPath = join(dirname(pjPath), "..", "..", "blueprints", `${pageSlug}.json`);
if (!existsSync(bpPath)) {
  W(`blueprint не найден (blueprints/${pageSlug}.json) - длины слотов не сверены`);
} else {
  try {
    const bp = JSON.parse(readFileSync(bpPath, "utf8").replace(/^﻿/, ""));
    const bpBlocks = arr(bp.blocks);
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      const bb = (b.n != null ? bpBlocks.find((x) => x.n === b.n) : bpBlocks[i]) || null;
      if (!bb || !bb.limits || !b.slots) continue;
      for (const [slot, lim] of Object.entries(bb.limits)) {
        const m = /^\s*(\d+)\s*-\s*(\d+)\s*$/.exec(String(lim));
        if (!m) continue; // свободный формат («ровно 3: title 10-30 + ...») - не парсим, пропускаем
        const val = b.slots[slot];
        if (typeof val !== "string" || !val.trim()) continue;
        const len = val.length, lo = Number(m[1]), hi = Number(m[2]);
        if (len > Math.round(hi * 1.15)) V(`блок ${b.n != null ? b.n : i + 1}: слот «${slot}» ${len} симв - выше лимита ${lo}-${hi} более чем на 15% (ломает вёрстку)`);
        else if (len > hi) W(`блок ${b.n != null ? b.n : i + 1}: слот «${slot}» ${len} симв - выше лимита ${lo}-${hi} (в пределах 15%)`);
        else if (len < lo) W(`блок ${b.n != null ? b.n : i + 1}: слот «${slot}» ${len} симв - ниже лимита ${lo}-${hi}`);
      }
    }
  } catch { W("blueprint не разобран - длины слотов не сверены"); }
}

// отчёт
console.log(`[verify-copy] ${pjPath}  (блоков ${blocks.length}, H1 ${h1.length} симв)`);
if (warnings.length) { console.log("  предупреждения (семантику добьёт copy-auditor):"); for (const w of warnings) console.log("   ~ " + w); }
if (violations.length) { console.log("  НАРУШЕНИЯ (правим текст, HTML не собираем):"); for (const v of violations) console.log("   ! " + v); process.exit(2); }
console.log("  OK - механические пункты чисто.");
process.exit(0);
