#!/usr/bin/env node
// select-variations.mjs
// Детерминированный отбор форм маркера для /seo-metategi (Фаза 2).
// Читает research.json (варианты + частотность + Comm/Geo от metatag-researcher),
// отсекает низко-коммерческие формы, сортирует по точной частотности, выбирает
// финальную форму и шортлист на каждую страницу.
//
// Используется в /seo-metategi после metatag-researcher, перед metatag-writer.
//
// Использование:
//   node .claude/scripts/select-variations.mjs <metatags_dir>
//
// Вход:
//   <metatags_dir>/research.json   - от metatag-researcher
// Выход:
//   <metatags_dir>/shortlist.json  - chosen_form + shortlist + reserve на страницу
//
// Exit:
//   0 - ок
//   1 - критическая ошибка (нет файла, битый JSON, нет ни одной страницы)

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

// === Пороги Comm по типу страницы (из PLAYBOOK раздел 5: граница «низкий») ===
// Форма с Comm НИЖЕ порога считается информационной и отсекается (если есть чем заменить).
const COMM_DROP_BELOW = {
  home: 0.15,        // главная часто mixed-intent - порог ниже
  category: 0.40,
  subcategory: 0.40,
  service: 0.40,
  subservice: 0.40,
  product: 0.40,
  article: 0.0,      // инфо/статьи не отсекаем по коммерциализации
  info: 0.0,
  other: 0.40,
};

const SHORTLIST_SIZE = 5;  // сколько форм держим в шортлисте
const RESERVE_SIZE = 2;    // резервные формы (borderline) на случай провала в выдаче

const NON_COMMERCIAL_TYPES = new Set(["info", "article"]);

const dirArg = process.argv[2];
if (!dirArg) {
  console.error("[select-variations] usage: node select-variations.mjs <metatags_dir>");
  process.exit(1);
}
const metatagsDir = resolve(dirArg);

function readJson(path) {
  if (!existsSync(path)) {
    console.error(`[select-variations] не найден: ${path}`);
    process.exit(1);
  }
  try {
    return JSON.parse(readFileSync(path, "utf8").replace(/^﻿/, ""));
  } catch (err) {
    console.error(`[select-variations] битый JSON ${path}: ${err.message}`);
    process.exit(1);
  }
}

const research = readJson(join(metatagsDir, "research.json"));
const pages = research.pages || [];
if (pages.length === 0) {
  console.error("[select-variations] в research.json нет страниц.");
  process.exit(1);
}

const num = (v) => (typeof v === "number" && !Number.isNaN(v) ? v : 0);

// Сортировка форм: точная убыв. -> фразовая -> базовая (как в select-top10).
function sortForms(a, b) {
  return (
    num(b.freq_exact) - num(a.freq_exact) ||
    num(b.freq_phrase) - num(a.freq_phrase) ||
    num(b.freq_base) - num(a.freq_base)
  );
}

let droppedFormsTotal = 0;
let pagesAllLow = 0;
let pagesInfo = 0;
const outPages = [];

for (const page of pages) {
  const type = page.type || "other";
  const marker = page.marker || page.name || "";

  // Информационные / без вариантов - проносим как есть, без коммерч-отбора.
  const variants = Array.isArray(page.variants) ? page.variants.slice() : [];
  if (NON_COMMERCIAL_TYPES.has(type) || variants.length === 0) {
    if (NON_COMMERCIAL_TYPES.has(type)) pagesInfo++;
    outPages.push({
      n: page.n,
      url: page.url || "",
      type,
      name: page.name || "",
      marker,
      chosen_form: marker,
      chosen: variants.length
        ? pickChosenRecord(variants.sort(sortForms)[0])
        : { form: marker, freq_base: null, freq_phrase: null, freq_exact: null, comm: null, geo: null },
      shortlist: variants.sort(sortForms).slice(0, SHORTLIST_SIZE).map(pickChosenRecord),
      reserve: [],
      suggests: page.suggests || [],
      toponym_signal: false,
      all_low_commerce: false,
      is_non_commercial: NON_COMMERCIAL_TYPES.has(type),
      notes: page.notes || "",
    });
    continue;
  }

  const threshold = COMM_DROP_BELOW[type] ?? 0.40;

  // Разделяем: проходные (comm null = не дропаем, comm >= threshold) и низкие.
  const kept = [];
  const low = [];
  for (const v of variants) {
    const comm = v.comm;
    if (comm === null || comm === undefined) {
      kept.push(v); // не проверено -> не отсекаем (страховка от ложного дропа)
    } else if (comm >= threshold) {
      kept.push(v);
    } else {
      low.push(v);
    }
  }
  droppedFormsTotal += low.length;

  let pool = kept;
  let allLow = false;
  if (pool.length === 0) {
    // Все формы низко-коммерческие - страницу не теряем: берём лучшую по exact + флаг.
    allLow = true;
    pagesAllLow++;
    pool = variants;
  }

  pool.sort(sortForms);
  const chosenRec = pool[0];
  const shortlist = pool.slice(0, SHORTLIST_SIZE).map(pickChosenRecord);
  // Резерв - borderline-формы (отсортированные low), на случай провала выдачи в deep.
  low.sort(sortForms);
  const reserve = low.slice(0, RESERVE_SIZE).map(pickChosenRecord);

  // Сигнал топонима: большинство форм шортлиста гео-зависимы.
  const geoFlags = shortlist.map((f) => f.geo).filter((g) => g === 0 || g === 1);
  const toponymSignal =
    geoFlags.length > 0 && geoFlags.filter((g) => g === 1).length > geoFlags.length / 2;

  outPages.push({
    n: page.n,
    url: page.url || "",
    type,
    name: page.name || "",
    marker,
    chosen_form: chosenRec.form,
    chosen: pickChosenRecord(chosenRec),
    shortlist,
    reserve,
    suggests: page.suggests || [],
    toponym_signal: toponymSignal,
    all_low_commerce: allLow,
    is_non_commercial: false,
    notes: page.notes || "",
  });
}

function pickChosenRecord(v) {
  return {
    form: v.form,
    freq_base: v.freq_base ?? null,
    freq_phrase: v.freq_phrase ?? null,
    freq_exact: v.freq_exact ?? null,
    comm: v.comm ?? null,
    geo: v.geo ?? null,
    is_original_marker: !!v.is_original_marker,
  };
}

const out = {
  generated_at: new Date().toISOString(),
  depth: research.depth || "deep",
  region_yandex: research.region_yandex ?? null,
  total_pages: outPages.length,
  pages: outPages,
  summary: {
    pages: outPages.length,
    pages_non_commercial: pagesInfo,
    pages_all_low_commerce: pagesAllLow,
    dropped_forms_total: droppedFormsTotal,
  },
};

writeFileSync(join(metatagsDir, "shortlist.json"), JSON.stringify(out, null, 2));

console.log(`[select-variations] OK: ${outPages.length} страниц -> shortlist.json`);
console.log(`   глубина: ${out.depth}`);
console.log(`   форм отсеяно (Comm ниже порога): ${droppedFormsTotal}`);
console.log(`   страниц «все формы низко-коммерч.» (взята лучшая + флаг): ${pagesAllLow}`);
console.log(`   страниц информационных (без коммерч-отбора): ${pagesInfo}`);
const toponymPages = outPages.filter((p) => p.toponym_signal).length;
console.log(`   страниц с сигналом топонима: ${toponymPages}`);
process.exit(0);
