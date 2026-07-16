#!/usr/bin/env node
// verify-structure.mjs
// Механический финальный гейт /seo-struktura (шаг 9г) - идет ПЕРЕД дорогим смысловым чеком
// structure-verifier (opus, шаг 9д): ловит структурные/URL/дубль-дефекты дешево и детерминированно,
// чтобы не жечь opus-токены на заведомо битом A6.md.
//
// Использование:
//   node .claude/scripts/verify-structure.mjs <structure_dir>
//
// Вход:
//   <structure_dir>/structure_data.json - главный источник (pages[], stats)
//   <structure_dir>/A6.md               - финальный артефакт structure-writer
//   <structure_dir>/master_list.json    - sections[] / use_sections (для проверки разделов шапки)
//   <structure_dir>/markers.json        - опционален, фолбэк-источник маркера, если он пуст
//                                          в structure_data.json (клиент не должен его редактировать,
//                                          но на всякий случай)
//
// Проверки:
//   1. URL-правила (validateUrl из _slug.mjs) по всем страницам structure_data.json с непустым url.
//      Новый/генерируемый адрес (статус "новая"/"301-редирект" и все прочие, кроме "существующая")
//      с нарушением -> блок. Существующий адрес клиента (статус "существующая", источник
//      client_current_url) с нарушением (обычно кириллица/IDN) -> warn, не блок - это реальный сайт
//      клиента, не наша генерация.
//   2. Полнота A6.md против structure_data.json: число строк в таблице «Целевые страницы» ==
//      число target_status=="yes"; каждое имя целевой страницы встречается в тексте A6.md (блок при
//      расхождении/пропаже). Каждый раздел master_list.sections[] (если use_sections) встречается под
//      «Архитектура меню (шапка)» (warn при пропаже - смысловой чек добьет structure-verifier).
//   3. Дубли маркеров: один и тот же маркер (нормализованный) на >=2 целевых страницах -> блок
//      (инвариант «один маркер = одна страница», зеркалит правило marker-finder).
//
// Exit-коды (ВНИМАНИЕ: отступление от конвенции остальных verify-*.mjs, где 1 = ошибка запуска -
// здесь это ОСОЗНАННО, по контракту гейта задачи "0/1 warn/2 блок"; ошибка запуска перенесена на 3):
//   0 - все чисто (либо только не-блокирующие warn)
//   1 - есть предупреждения (warn) - не блокируют, скил отмечает их в финальной сводке
//   2 - есть блокирующие нарушения - скил пере-делегирует structure-writer (лимит 2 повтора)
//   3 - ошибка запуска (нет structure_data.json / A6.md / master_list.json / битый JSON) - стоп
//
// Потолок вывода - ~30 строк нарушений суммарно, дальше "... и еще N" (ORCHESTRATION.md п. г).

import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { validateUrl } from "./_slug.mjs";

const MAX_PRINT = 30;

const dirArg = process.argv[2];
if (!dirArg) {
  console.error("[verify-structure] usage: node verify-structure.mjs <structure_dir>");
  process.exit(3);
}
const structureDir = resolve(dirArg);

function readJson(path, { required = true } = {}) {
  if (!existsSync(path)) {
    if (required) {
      console.error(`[verify-structure] не найден: ${path}`);
      process.exit(3);
    }
    return null;
  }
  try {
    return JSON.parse(readFileSync(path, "utf8").replace(/^﻿/, ""));
  } catch (err) {
    if (required) {
      console.error(`[verify-structure] битый JSON ${path}: ${err.message}`);
      process.exit(3);
    }
    return null;
  }
}

function readText(path, { required = true } = {}) {
  if (!existsSync(path)) {
    if (required) {
      console.error(`[verify-structure] не найден: ${path}`);
      process.exit(3);
    }
    return null;
  }
  return readFileSync(path, "utf8").replace(/^﻿/, "");
}

const structureData = readJson(join(structureDir, "structure_data.json"));
const a6md = readText(join(structureDir, "A6.md"));
const masterList = readJson(join(structureDir, "master_list.json"));
const markers = readJson(join(structureDir, "markers.json"), { required: false });
const markerByNum = new Map((markers?.pages || []).map((p) => [p.n, p]));

const pages = Array.isArray(structureData.pages) ? structureData.pages : [];
if (pages.length === 0) {
  console.error("[verify-structure] structure_data.json: пустой или отсутствующий список pages[].");
  process.exit(3);
}

// === Вспомогательное: вырезать текст секции между "## Заголовок" и следующим "## " ===
function extractSection(text, heading) {
  const lines = text.split("\n");
  const startIdx = lines.findIndex((l) => l.trim().startsWith(heading));
  if (startIdx === -1) return null;
  const rest = lines.slice(startIdx + 1);
  const endIdx = rest.findIndex((l) => /^##\s/.test(l.trim()));
  return (endIdx === -1 ? rest : rest.slice(0, endIdx)).join("\n");
}

// Число строк с данными в markdown-таблице секции: все "|"-строки минус заголовок и разделитель.
function countTableDataRows(sectionText) {
  if (!sectionText) return 0;
  const pipeLines = sectionText
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("|"));
  let sawHeader = false;
  let dataRows = 0;
  for (const l of pipeLines) {
    const isSeparator = /^\|?[\s:|-]+\|?$/.test(l) && l.includes("-");
    if (isSeparator) continue;
    if (!sawHeader) {
      sawHeader = true; // первая непустая-нетабличная-разделитель строка - заголовок таблицы
      continue;
    }
    dataRows++;
  }
  return dataRows;
}

function normMarker(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ")
    .trim();
}

const targetPages = pages.filter((p) => p.target_status === "yes");
const idlePages = pages.filter((p) => p.target_status === "no");

// === 1. URL-правила ===
// "существующая" (статус, проставленный build-structure-xlsx из migration_decision=="existing") -
// единственный сигнал в structure_data.json о том, что url взят verbatim с реального сайта клиента
// (см. buildPageUrl в _slug.mjs: client_current_url/migration_target_url возвращаются как есть).
// Все прочее (новая/301-редирект/к удалению/обсудить/info/неизвестно) по умолчанию считаем
// нашей генерацией/ответственностью - консервативно блокируем при нарушении.
const EXISTING_STATUSES = new Set(["существующая"]);

const urlBlocks = [];
const urlWarns = [];

for (const page of pages) {
  const url = String(page.url || "").trim();
  if (!url) continue; // пустой url - не наш случай, structure-writer поставит "уточнить у клиента"
  const reasons = validateUrl(url, { maxLen: 70 });
  if (!reasons.length) continue;
  const label = `n${page.n} «${page.name}»: ${url} - ${reasons.join("; ")}`;
  if (EXISTING_STATUSES.has(page.status)) {
    urlWarns.push(label);
  } else {
    urlBlocks.push(label);
  }
}

// === 2. Полнота A6.md против structure_data.json ===
const completenessBlocks = [];
const completenessWarns = [];

const targetSectionText = extractSection(a6md, "## Целевые страницы");
const targetDataRows = countTableDataRows(targetSectionText);
if (targetDataRows !== targetPages.length) {
  completenessBlocks.push(
    `строк в таблице «Целевые страницы» A6.md = ${targetDataRows}, ожидалось (target_status=yes в structure_data.json) = ${targetPages.length}`
  );
}

for (const p of targetPages) {
  const name = String(p.name || "").trim();
  if (name && !a6md.includes(name)) {
    completenessBlocks.push(`целевая n${p.n} «${name}» не найдена в тексте A6.md`);
  }
}

if (masterList && masterList.use_sections && Array.isArray(masterList.sections)) {
  const menuSectionText = extractSection(a6md, "## Архитектура меню (шапка)") || "";
  for (const sec of masterList.sections) {
    const name = String(sec.name || "").trim();
    if (name && !menuSectionText.includes(name)) {
      completenessWarns.push(`раздел «${name}» (master_list.sections) не найден в «Архитектура меню (шапка)»`);
    }
  }
}

// === 3. Дубли маркеров между целевыми страницами ===
const markerBlocks = [];
const byMarker = new Map();
for (const p of targetPages) {
  const rawMarker = p.marker && String(p.marker).trim() && p.marker !== "-" ? p.marker : markerByNum.get(p.n)?.marker;
  const marker = normMarker(rawMarker);
  if (!marker) continue;
  if (!byMarker.has(marker)) byMarker.set(marker, []);
  byMarker.get(marker).push(p);
}
for (const [marker, plist] of byMarker) {
  if (plist.length > 1) {
    markerBlocks.push(
      `маркер «${marker}» одновременно на ${plist.length} страницах: ${plist.map((p) => `n${p.n} «${p.name}»`).join(", ")}`
    );
  }
}

// === Счетчики ===
console.log(`[verify-structure] структура: ${structureDir}`);
console.log(
  `  целевых: ${targetPages.length}, отложенных: ${idlePages.length}, рекомендаций: ${(structureData.recommendations || []).length}, разделов: ${masterList?.sections?.length ?? 0}`
);
console.log(`  URL-нарушений: блок ${urlBlocks.length}, warn ${urlWarns.length}`);
console.log(`  дублей маркеров: ${markerBlocks.length}`);

// === Печать нарушений - потолок ~30 строк суммарно, дальше "и еще N" ===
const allIssues = [
  ...urlBlocks.map((s) => `[URL/блок] ${s}`),
  ...completenessBlocks.map((s) => `[полнота/блок] ${s}`),
  ...markerBlocks.map((s) => `[маркеры/блок] ${s}`),
  ...urlWarns.map((s) => `[URL/warn] ${s}`),
  ...completenessWarns.map((s) => `[полнота/warn] ${s}`),
];

if (allIssues.length) {
  console.log(`\nНАРУШЕНИЯ И ПРЕДУПРЕЖДЕНИЯ (${allIssues.length}):`);
  for (const line of allIssues.slice(0, MAX_PRINT)) console.log(`  - ${line}`);
  if (allIssues.length > MAX_PRINT) console.log(`  ... и еще ${allIssues.length - MAX_PRINT}`);
}

const totalBlocks = urlBlocks.length + completenessBlocks.length + markerBlocks.length;
const totalWarns = urlWarns.length + completenessWarns.length;

if (totalBlocks > 0) {
  console.log(
    `\n[verify-structure] БЛОК: блокирующих нарушений ${totalBlocks} (URL ${urlBlocks.length}, полнота ${completenessBlocks.length}, дубли маркеров ${markerBlocks.length}). Пере-делегировать structure-writer.`
  );
  process.exit(2);
}

if (totalWarns > 0) {
  console.log(
    `\n[verify-structure] WARN: предупреждений ${totalWarns} (URL ${urlWarns.length}, разделы ${completenessWarns.length}) - не блокируют, отметить в финальной сводке.`
  );
  process.exit(1);
}

console.log("\n[verify-structure] OK: нарушений нет.");
process.exit(0);
