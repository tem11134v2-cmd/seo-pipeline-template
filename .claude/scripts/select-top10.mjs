#!/usr/bin/env node
// select-top10.mjs
// Детерминированная фильтрация JM semantic_pack → топ-10 на страницу + детекция каннибализации.
//
// Используется в /seo-structure на шаге 4а (перед агентом cannibalization-resolver).
//
// Использование:
//   node .claude/scripts/select-top10.mjs <structure_dir>
//
// Вход:
//   <structure_dir>/semantic_pack.json   - топ-30 от JM по каждой странице
//   <structure_dir>/markers.json         - маркеры (для проверки соответствия)
//   <structure_dir>/master_list.json     - типы и названия страниц
//   <structure_dir>/inputs.json          - analysis_dir для чтения A3.md
// Выход:
//   <structure_dir>/top10.json           - топ-10 на каждую страницу
//   <structure_dir>/cannibalization.json - конфликты + альтернативы
//
// Exit:
//   0  - всё ок
//   1  - критическая ошибка (нет файла, ни одной страницы не получило маркер, и т.п.)

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const N_TOP = 10;          // сколько запросов держим на странице
const MIN_FREQ_KEEP = 0;   // запросы с частотой ниже выбрасываем (можно поднять, но 0 - safe default)

const structureDirArg = process.argv[2];
if (!structureDirArg) {
  console.error("[select-top10] usage: node select-top10.mjs <structure_dir>");
  process.exit(1);
}
const structureDir = resolve(structureDirArg);

function readJson(path) {
  if (!existsSync(path)) {
    console.error(`[select-top10] not found: ${path}`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(path, "utf8").replace(/^﻿/, ""));
}

const semanticPack = readJson(join(structureDir, "semantic_pack.json"));
const markers = readJson(join(structureDir, "markers.json"));
const masterList = readJson(join(structureDir, "master_list.json"));
const inputs = readJson(join(structureDir, "inputs.json"));

// === A3.md - доменный стоп-лист (как блок-фильтр для брендов в запросах) ===
// Мы не блокируем все запросы по доменам - это не имеет смысла на уровне запросов,
// но из A3 можно вытащить «бренды конкурентов» (если домен типа «vasya-master.ru» -
// слово «vasya master» в запросе вряд ли нам подходит). Пока берём базовый эвристический список -
// слова из доменов A3 без TLD.

let competitorBrands = [];
// inputs.analysis_dir хранится как путь от project root (например "analyses/NNN-slug/").
// Скрипт запускается из project root (через .claude\scripts\_node.cmd), поэтому resolve от cwd.
const analysisDir = inputs.analysis_dir ? resolve(inputs.analysis_dir) : null;
if (analysisDir && existsSync(join(analysisDir, "A3.md"))) {
  const a3 = readFileSync(join(analysisDir, "A3.md"), "utf8");
  competitorBrands = a3
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && !l.startsWith(">"))
    .map((domain) => {
      // example.com -> "example"; example-shop.ru -> ["example", "shop"]
      const noTld = domain.trim().replace(/\.[a-zЀ-ӿ]+$/i, "");
      return noTld
        .split(/[-_.]/)
        .map((w) => w.trim().toLowerCase())
        .filter((w) => w.length >= 4 && !/^\d+$/.test(w));
    })
    .flat()
    .filter((w, i, a) => a.indexOf(w) === i);
}

// === Фильтры запросов ===

function isCompetitorBrandQuery(query) {
  if (!competitorBrands.length) return false;
  const q = query.toLowerCase();
  return competitorBrands.some((brand) => q.includes(brand));
}

function isOrthoMistake(query) {
  // Эвристика - повтор подряд 4+ букв, или цифро-буквенный шум, или 1-символьные слова в середине
  if (/(.)\1{3,}/.test(query)) return true;
  if (/[a-zа-я]\d[a-zа-я]/i.test(query) && !/iphone|ipad|samsung\s?galaxy/i.test(query)) return true;
  return false;
}

function normalizeForDuplicate(query) {
  // Нормализация для детекции дублей в разной форме слова
  return query
    .toLowerCase()
    .replace(/[ёе]/g, "е")
    .replace(/[^a-zа-я0-9\s]/gi, " ")
    .split(/\s+/)
    .filter(Boolean)
    // Грубое «лемматизирование» - убираем русские окончания
    .map((w) => w.replace(/(ого|его|ому|ему|ыми|ими|ами|ями|ах|ях|ой|ей|ою|ею|ия|ие|ии|ый|ий|ая|ое|ые|ое|ый|им|ым|ом|ем|ой|у|ы|и|а|е|я|ю|у|ь)$/, ""))
    .sort()
    .join(" ");
}

// === Фильтрация и отбор топ-10 ===

const masterByNum = new Map(masterList.pages.map((p) => [p.n, p]));
const markerByNum = new Map(markers.pages.map((p) => [p.n, p]));
const semanticByNum = new Map((semanticPack.pages || []).map((p) => [p.n, p]));

const pagesOutput = [];

// Итерируем по master_list.pages - это полный список (включая info и унаследованные).
// semantic_pack может содержать только страницы с маркером (коммерческие).
for (const master of masterList.pages) {
  const sp = semanticByNum.get(master.n);
  const mk = markerByNum.get(master.n);

  if (!mk) {
    // Нет записи в markers.json - пропускаем (возможно legacy данные).
    continue;
  }

  if (!mk.marker) {
    // Информационная или унаследованная - пустой топ-10, но страница в выходе есть.
    pagesOutput.push({
      n: master.n,
      name: master.name,
      type: master.type,
      marker: null,
      ws_exact: null,
      queries: [],
      leftover: [],
      queries_count: 0,
      notes: "no marker (info or inherited page)",
    });
    continue;
  }

  if (!sp) {
    // Маркер есть, но JM не дал результата - страница попадёт с только маркером.
    pagesOutput.push({
      n: master.n,
      name: master.name,
      type: master.type,
      marker: mk.marker,
      ws_exact: mk.ws_exact,
      queries: [{
        query: mk.marker,
        freq_exact: mk.ws_exact,
        freq_base: null,
        source: "marker_from_markers_json",
        frequency_source: mk.frequency_source,
        is_marker: true,
      }],
      leftover: [],
      queries_count: 1,
      notes: "JM returned no results for this marker",
    });
    continue;
  }

  // Фильтрация
  const seenNormalized = new Set();
  const filtered = (sp.queries || [])
    .filter((q) => q && q.query)
    .filter((q) => (q.freq_exact || 0) > MIN_FREQ_KEEP)
    .filter((q) => !isCompetitorBrandQuery(q.query))
    .filter((q) => !isOrthoMistake(q.query))
    .filter((q) => {
      // Дубль в другой форме слова - первый по частотности выигрывает.
      const norm = normalizeForDuplicate(q.query);
      if (seenNormalized.has(norm)) return false;
      seenNormalized.add(norm);
      return true;
    });

  // Маркер всегда #1
  // Если маркера нет в filtered - вставляем синтетически (с известной ws_exact)
  let top = [];
  const markerInList = filtered.find((q) =>
    normalizeForDuplicate(q.query) === normalizeForDuplicate(mk.marker)
  );
  if (markerInList) {
    top.push({
      query: markerInList.query,
      freq_exact: markerInList.freq_exact,
      freq_base: markerInList.freq_base,
      source: markerInList.source,
      frequency_source: markerInList.frequency_source,
      is_marker: true,
    });
    // убрать его из filtered
    const idx = filtered.indexOf(markerInList);
    filtered.splice(idx, 1);
  } else {
    top.push({
      query: mk.marker,
      freq_exact: mk.ws_exact,
      freq_base: null,
      source: "marker_from_markers_json",
      frequency_source: mk.frequency_source,
      is_marker: true,
    });
  }

  // Сортируем оставшиеся по freq_exact убыванием
  filtered.sort((a, b) => (b.freq_exact || 0) - (a.freq_exact || 0));

  // Добавляем до N_TOP
  const limit = Math.max(0, N_TOP - top.length);
  for (const q of filtered.slice(0, limit)) {
    top.push({
      query: q.query,
      freq_exact: q.freq_exact,
      freq_base: q.freq_base,
      source: q.source,
      frequency_source: q.frequency_source,
      is_marker: false,
    });
  }

  pagesOutput.push({
    n: master.n,
    name: master.name,
    type: master.type,
    marker: mk.marker,
    ws_exact: mk.ws_exact,
    queries: top,
    // Сохраняем «остатки» из топ-30 (всё что осталось после фильтрации и НЕ попало в топ-10)
    // - они нужны как альтернативы при разрешении каннибализации
    leftover: filtered.slice(limit).map((q) => ({
      query: q.query,
      freq_exact: q.freq_exact,
    })),
    queries_count: top.length,
    notes: top.length < N_TOP ? "incomplete top-10 (fewer queries available)" : "",
  });
}

// === Проверка: ни одна страница не получила маркер? ===

const pagesWithMarker = pagesOutput.filter((p) => p.marker && p.queries.length > 0);
if (pagesWithMarker.length === 0) {
  console.error("[select-top10] critical: no pages got any queries after filtering. Check semantic_pack and markers.");
  process.exit(1);
}

// === Детекция каннибализации ===

const queryToPages = new Map(); // normalized -> [{n, name, query, freq_exact, position_in_page}]

for (const page of pagesOutput) {
  page.queries.forEach((q, idx) => {
    if (q.is_marker) return; // маркер - сам по себе уникален (мы это валидировали в marker-finder)
    const norm = normalizeForDuplicate(q.query);
    if (!queryToPages.has(norm)) queryToPages.set(norm, []);
    queryToPages.get(norm).push({
      n: page.n,
      name: page.name,
      query: q.query,
      freq_exact: q.freq_exact,
      position_in_page: idx + 1,
      page_marker: page.marker,
      page_marker_freq: page.ws_exact,
    });
  });
}

const conflicts = [];
for (const [norm, list] of queryToPages.entries()) {
  if (list.length < 2) continue;

  // Альтернативы для каждой задействованной страницы - из leftover[]
  const alternativesForEach = {};
  for (const entry of list) {
    const page = pagesOutput.find((p) => p.n === entry.n);
    alternativesForEach[entry.n] = (page.leftover || []).slice(0, 3).map((l) => ({
      query: l.query,
      freq_exact: l.freq_exact,
    }));
  }

  conflicts.push({
    query: list[0].query, // берём оригинальную форму первой
    normalized: norm,
    freq_exact: list[0].freq_exact,
    pages: list.map((e) => ({
      n: e.n,
      name: e.name,
      marker: e.page_marker,
      marker_freq: e.page_marker_freq,
      position_in_page: e.position_in_page,
    })),
    alternatives_for_each: alternativesForEach,
  });
}

// === Сохранение ===

const top10Json = {
  generated_at: new Date().toISOString(),
  total_pages: pagesOutput.length,
  pages_with_full_top10: pagesOutput.filter((p) => p.queries.length === N_TOP).length,
  pages_with_incomplete_top10: pagesOutput.filter((p) => p.marker && p.queries.length < N_TOP).length,
  pages_without_marker: pagesOutput.filter((p) => !p.marker).length,
  pages: pagesOutput,
};

const cannibalizationJson = {
  generated_at: new Date().toISOString(),
  conflicts_total: conflicts.length,
  conflicts_resolved: 0, // заполнит cannibalization-resolver
  conflicts,
  resolutions: [],       // заполнит cannibalization-resolver
  recommendations: [],   // заполнит cannibalization-resolver
  summary: {
    method: "auto_detection_only",
    note: "Awaiting cannibalization-resolver agent for resolution + recommendations",
  },
};

writeFileSync(join(structureDir, "top10.json"), JSON.stringify(top10Json, null, 2));
writeFileSync(join(structureDir, "cannibalization.json"), JSON.stringify(cannibalizationJson, null, 2));

console.log(`[select-top10] OK: ${top10Json.total_pages} pages, ${top10Json.pages_with_full_top10} with full top-10, ${conflicts.length} conflicts detected`);
process.exit(0);
