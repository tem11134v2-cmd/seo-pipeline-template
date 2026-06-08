#!/usr/bin/env node
// verify-copy.mjs
// Pre-flight КОПИ-валидатор (v4): механические пункты 13-пунктового чек-листа по page.json
// ДО сборки HTML. Семантические пункты (за счёт / H2-выгода / OPSEC) добивает агент copy-auditor.
//
// Использование: node verify-copy.mjs <page_dir|page.json>
// Exit: 0 ok | 2 нарушения | 1 фатально (нет page.json).

import { readFileSync, existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

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
const h1 = (() => { const hero = blocks.find((b) => b.fragment === "hero" || /первый экран|hero/i.test(b.type || "")); return (hero && hero.slots && (hero.slots.h1 || hero.slots.h1)) || page.h1 || ""; })();
const h2s = blocks.map((b) => b.h2 || (b.slots && b.slots.h2) || "").filter(Boolean);
const firstScreenText = (() => { const hero = blocks.find((b) => b.fragment === "hero"); return hero ? collect(hero.slots).join(" ") : ""; })();
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/u;

// 1. самозащита
if (/защищены от|не как у (?:других|них)|без того,? чтобы|больше не придётся|забудьте о том/i.test(allText)) V("п.1 самозащита («защищены от / не как у / без того») - заменить на утверждение/цифру");
// 2. жаргон маркетолога в клиентском тексте
const jarg = (low.match(/\b(customer dev|jtbd|cjm|оффер|конверси\w*|воронк\w*|сегмент\w*|персонаж|аватар|утп|usp|лид-?маг\w*)\b/gi) || []);
if (jarg.length) V(`п.2 жаргон маркетолога в тексте: ${[...new Set(jarg)].join(", ")}`);
// 3. аббревиатуры в H1 (латиница/кириллица заглавными 2-5, кроме бренда)
const brand = (page.page && page.page.title || "").toUpperCase();
const abbrH1 = (h1.match(/\b[A-ZА-Я]{2,5}\b/g) || []).filter((a) => !brand.includes(a) && !/^(ГОСТ|ТУ|РФ|СПБ)$/.test(a));
if (abbrH1.length) W(`п.3 возможные аббревиатуры в H1: ${abbrH1.join(", ")} (в Hero/H1 - 0; проверь)`);
// 4. дворовая лексика + тройные отрицания
if (/\bреально\b|по-честному|нарвал|кинул(?:и)?|без условий/i.test(allText)) W("п.4 дворовая лексика («реально/по-честному/нарвались»)");
if (/(?:\bне\b[^.!?]{0,30}){3,}/i.test(allText)) W("п.4 тройное отрицание подряд (максимум одно «не»)");
// 5. манипуляции
if (/только сегодня|осталось \d+ мест|успей(?:те)?|сгорит|перечёркнут/i.test(allText)) V("п.5 манипуляция (ложная срочность/дефицит/перечёркнутая цена)");
// 6. сленг-плейсхолдеры
if (/ща докрутим|допил(?:им|ить)|потом доделаем/i.test(low)) V("п.6 сленг в плейсхолдере («Ща Докрутим/допилим») - только [ЗАПОЛНИТЬ]/«требует уточнения»");
// 9. лимиты H1
if (h1 && h1.length > 60) V(`п.9 H1 > 60 символов (${h1.length}): «${h1.slice(0, 50)}...»`);
if (h1 && (h1.match(/,/g) || []).length >= 2) W("п.9 H1 содержит перечисление (>=2 запятых) - убрать в подзаголовок");
// 12. эмодзи в H1 / первом экране
if (EMOJI.test(h1) || EMOJI.test(firstScreenText)) V("п.12 эмодзи в H1/первом экране - убрать");
if (h2s.some((h) => EMOJI.test(h))) W("п.12 эмодзи в H2 - максимум один источник на странице");
// бюджет блоков
if (blocks.length > 14) W(`блоков ${blocks.length} (бюджет <= 12 содержательных + служебные)`);

// отчёт
console.log(`[verify-copy] ${pjPath}  (блоков ${blocks.length}, H1 ${h1.length} симв)`);
if (warnings.length) { console.log("  предупреждения (семантику добьёт copy-auditor):"); for (const w of warnings) console.log("   ~ " + w); }
if (violations.length) { console.log("  НАРУШЕНИЯ (правим текст, HTML не собираем):"); for (const v of violations) console.log("   ! " + v); process.exit(2); }
console.log("  OK - механические пункты чисто.");
process.exit(0);
