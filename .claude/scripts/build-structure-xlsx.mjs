#!/usr/bin/env node
// build-structure-xlsx.mjs
// Генерирует A6.xlsx со структурой сайта (4 листа) для отправки клиенту.
// Порт TEMPLATE-A6.py (openpyxl) на ExcelJS.
//
// Использование:
//   node .claude/scripts/build-structure-xlsx.mjs <structure_dir>
//
// Вход:
//   <structure_dir>/inputs.json           - slug, domain, регион
//   <structure_dir>/master_list.json      - мастер-список + миграция
//   <structure_dir>/markers.json          - маркеры (для случаев без top10)
//   <structure_dir>/top10.json            - топ-10 на страницу
//   <structure_dir>/cannibalization.json  - рекомендации по расширению
//   <analysis_dir>/competitors.json       - для листа «Конкуренты»
// Выход:
//   <structure_dir>/A6_<slug>.xlsx        - 4 листа: Структура, Рекомендации, Конкуренты, Миграция

import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import ExcelJS from "exceljs";
import { buildPageUrl } from "./_slug.mjs";

const MAX_QUERIES = 9; // Запросов помимо маркера (всего 10 = маркер + 9)

const structureDirArg = process.argv[2];
if (!structureDirArg) {
  console.error("[build-structure-xlsx] usage: node build-structure-xlsx.mjs <structure_dir>");
  process.exit(1);
}
const structureDir = resolve(structureDirArg);

function readJson(path) {
  if (!existsSync(path)) {
    console.error(`[build-structure-xlsx] not found: ${path}`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(path, "utf8").replace(/^﻿/, ""));
}

function readJsonOptional(path) {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8").replace(/^﻿/, ""));
}

const inputs = readJson(join(structureDir, "inputs.json"));
const masterList = readJson(join(structureDir, "master_list.json"));
const top10 = readJson(join(structureDir, "top10.json"));
const cannibalization = readJsonOptional(join(structureDir, "cannibalization.json")) || { recommendations: [] };
// markers.json опционален - может отсутствовать в legacy-папках или smoke-фикстурах
const markers = readJsonOptional(join(structureDir, "markers.json")) || { pages: [] };
const markersByNum = new Map((markers.pages || []).map((p) => [p.n, p]));

// inputs.analysis_dir хранится как путь от project root. Скрипт запускается из project root.
const analysisDir = inputs.analysis_dir ? resolve(inputs.analysis_dir) : null;
const competitors = analysisDir
  ? readJsonOptional(join(analysisDir, "competitors.json")) || { direct: [], leaders_top3: [] }
  : { direct: [], leaders_top3: [] };

const slug = (inputs.slug || "structure").replace(/[<>:"/\\|?*\x00-\x1f]/g, "_");
const outputPath = join(structureDir, `A6_${slug}.xlsx`);

// === Дизайн-токены (одинаковая палитра с build-smeta-xlsx) ===
const COLORS = {
  header_bg: "FF2F5496",
  header_text: "FFFFFFFF",
  border: "FFD9D9D9",
  warning: "FFFF0000",
  prio_high: "FFE2EFDA",
  prio_medium: "FFFFF2CC",
  prio_low: "FFFCE4EC",
  text: "FF000000",
};
const FONT_FAMILY = "Arial";
const FONT_SIZE = 10;

const thinBorder = {
  top: { style: "thin", color: { argb: COLORS.border } },
  left: { style: "thin", color: { argb: COLORS.border } },
  bottom: { style: "thin", color: { argb: COLORS.border } },
  right: { style: "thin", color: { argb: COLORS.border } },
};

function applyHeader(cell) {
  cell.font = { name: FONT_FAMILY, size: FONT_SIZE + 1, bold: true, color: { argb: COLORS.header_text } };
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.header_bg } };
  cell.border = thinBorder;
  cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
}

function applyBody(cell, priority, isWarning) {
  cell.font = { name: FONT_FAMILY, size: FONT_SIZE, color: { argb: isWarning ? COLORS.warning : COLORS.text } };
  if (priority && COLORS[`prio_${priority}`]) {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS[`prio_${priority}`] } };
  }
  cell.border = thinBorder;
  cell.alignment = { vertical: "top", wrapText: true };
}

// === Эвристика приоритета ===

function calcPriority(page, master) {
  const cov = master?.coverage_pct ?? 0;
  const freq = page.ws_exact || 0;
  if (cov >= 50 || freq >= 500) return "high";
  if (cov >= 25 || freq >= 100) return "medium";
  return "low";
}

const PRIO_RU = { high: "высокий", medium: "средний", low: "низкий" };

// === ЧПУ-генератор ===
// Транслит + построение URL посадки вынесены в общий модуль _slug.mjs (buildPageUrl) -
// единая карта транслита и единые правила (скобки/стоп-слова/лимиты/уникальность) с select-top10.mjs.

// === Создание книги ===

const workbook = new ExcelJS.Workbook();
workbook.creator = "seo-pipeline /seo-struktura";
workbook.created = new Date();

// === Лист 1: СТРУКТУРА ===

const ws1 = workbook.addWorksheet("Структура");

// Клиентские заголовки - понятный русский, без SEO-жаргона.
// «Раздел» (точка 5) добавляется только для крупной секционированной структуры (master_list.use_sections).
const useSections = !!masterList.use_sections;
// «Категория» (третий уровень для товарных сайтов) - показываем только когда хотя бы у одной
// страницы есть непустой category (иначе для услуг таблица бы пухла лишней пустой колонкой).
// Источник - master.category (как «Раздел» берётся из master.section).
const useCategory = (masterList.pages || []).some(
  (p) => typeof p.category === "string" && p.category.trim() !== ""
);
const fixedLeft = [
  "№",
  "Адрес страницы",
  "Тип",
  "Название",
  ...(useSections ? ["Раздел"] : []),
  ...(useCategory ? ["Категория"] : []),
  "Нужна?",
  "Главный запрос",
  "Спрос в месяц",
];
const queryHeaders = [];
// MAX_QUERIES=9 дополнительных запросов (2..10), всего 10 запросов с маркером.
for (let i = 2; i <= MAX_QUERIES + 1; i++) {
  queryHeaders.push(`Запрос ${i}`, `Спрос ${i}`);
}
const fixedRight = ["Есть у конкурентов", "Приоритет", "Статус", "Роль", "Примечания"];
const headers1 = [...fixedLeft, ...queryHeaders, ...fixedRight];
const totalCols1 = headers1.length;
// Позиции вычисляем динамически - устойчиво к наличию/отсутствию колонки «Раздел».
const COL_TARGET = headers1.indexOf("Нужна?") + 1; // 1-based индекс колонки «Нужна?»

// Instruction-row для клиента (строка 1, mergeCells по всей ширине).
ws1.mergeCells(1, 1, 1, totalCols1);
const instrCell = ws1.getCell(1, 1);
instrCell.value =
  "Как заполнить: в колонке «Нужна?» напротив каждой страницы поставьте да / нет / обсудить. " +
  "«да» - такая страница нужна, делаем. «нет» - страница не нужна. «обсудить» - есть вопросы, обсудим отдельно " +
  "(этим помечены новые для вас направления - подтвердите, занимаетесь ли вы ими). " +
  "Колонки «Главный запрос» и «Спрос в месяц» - справочные (что и как часто люди ищут в поиске), их заполнять не нужно. " +
  "Адрес страницы при желании можно поправить. Готовый файл пришлите обратно.";
if (useSections || useCategory) {
  const grp = useSections && useCategory ? "«Раздел» и «Категория»" : useSections ? "«Раздел»" : "«Категория»";
  instrCell.value +=
    ` ${grp} - группировка страниц для шапки сайта (навигация) и блока перелинковки в шапке;` +
    " справочно, при желании поправьте.";
}
instrCell.font = { name: FONT_FAMILY, size: FONT_SIZE, italic: true, color: { argb: "FF1F4E79" } };
instrCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF9E6" } };
instrCell.alignment = { horizontal: "left", vertical: "middle", wrapText: true };
instrCell.border = thinBorder;
ws1.getRow(1).height = 50;

// Шапка таблицы - строка 2.
ws1.addRow(headers1);
headers1.forEach((_, i) => applyHeader(ws1.getCell(2, i + 1)));
ws1.getRow(2).height = 30;

const masterByNum = new Map(masterList.pages.map((p) => [p.n, p]));

let row1 = 3;
// Запомним строки с info_dominant warning - для красного шрифта на «Примечаниях».
const rowsWithCommerceWarning = [];
// Общий на весь проход счетчик коллизий URL - buildPageUrl разводит совпавшие slug-и (раздел 7.3 _slug.mjs).
const usedUrls = new Map();

for (const page of top10.pages) {
  const master = masterByNum.get(page.n);
  const markerData = markersByNum.get(page.n);
  const priority = calcPriority(page, master);
  const url = buildPageUrl(master || page, { marker: markerData?.marker, usedUrls });
  const queries = page.queries || [];
  // queries[0] всегда маркер, потом 9 дополнительных
  const marker = queries[0]?.query || page.marker || "-";
  // 5.2: показываем базовую частотность Wordstat (привычное "WS"-число; exact для B2B микроскопичен
  // и создаёт ложное впечатление мёртвого рынка). Fallback на exact/ws_exact если base нет.
  const ws_freq = queries[0]?.freq_base ?? queries[0]?.freq_exact ?? page.ws_exact ?? "-";
  const extras = queries.slice(1, 1 + MAX_QUERIES);

  const rowData = [
    page.n,
    url,
    typeRu(page.type),
    page.name,
    ...(useSections ? [master?.section || ""] : []),
    ...(useCategory ? [master?.category || ""] : []),
    // business_flag (новое/смежное направление) -> по умолчанию «обсудить» (клиент решает явно);
    // обычные страницы -> «да» (клиент снимает ненужные). 5.x: раньше business_flag не доезжал до xlsx.
    master?.business_flag ? "обсудить" : "да",
    marker,
    ws_freq,
  ];

  for (let i = 0; i < MAX_QUERIES; i++) {
    const q = extras[i];
    rowData.push(q?.query ?? "-", q?.freq_base ?? q?.freq_exact ?? "-"); // 5.2: base-preferred
  }

  // «Примечания» для КЛИЕНТА - только человеческий русский, без SEO-жаргона, процентов,
  // имён инструментов и служебных полей. Вся внутренняя кухня (роли, проценты, журнал) - в A6.md.
  // page.notes НЕ выводим: там служебный английский ("no marker (info or inherited page)" и т.п.).
  const notesParts = [];
  // Бизнес-вопрос (новое/смежное направление) - самое важное для клиента, ставим первым.
  if (master?.business_flag) {
    notesParts.push(`Новое для вас направление - подтвердите, занимаетесь ли вы этим${master.business_question ? ` (${master.business_question})` : ""}`);
  }
  // Коммерческие пометки - переводим в понятную клиенту суть, без процентов/терминов.
  if (markerData?.commerce_note === "info_dominant") {
    notesParts.push("Информационный интент: по этому запросу чаще ищут справочную информацию, чем товар/услугу - страница будет общим разделом-обзором");
  } else if (markerData?.commerce_note === "replaced_marker") {
    notesParts.push("Главный запрос подобран под коммерческий интент (как реально ищут покупатели)");
  }
  // borderline / not_verified клиенту НЕ показываем - это внутренние пометки для SEO-команды (в A6.md).
  if (master?.demand === "low") {
    notesParts.push("Нишевое направление, спрос небольшой, но страница нужна для полноты каталога");
  }
  const notesCell = notesParts.join(". ");

  // Роль страницы - простановка алгоритма (markers.role), клиент её не заполняет.
  const role = markerData?.role || (page.type === "info" ? "info" : "target");

  rowData.push(
    master?.coverage ?? "-",
    PRIO_RU[priority],
    page.type === "info" ? "info" : statusRu(master?.migration_decision),
    roleRu(role),
    notesCell
  );

  ws1.addRow(rowData);
  const r = ws1.getRow(row1);
  r.eachCell((cell) => applyBody(cell, priority));
  r.alignment = { vertical: "top", wrapText: true };

  // info_dominant/not_verified: НЕ красная подсветка-warning (сигнал isCommerce недостоверен для B2B,
  // и в Фазе 2 такие страницы уже авто-обработаны: роль -> umbrella, см. колонку «Роль» + decisions.json).
  // Оставляем как тихую служебную заметку обычным шрифтом - просто считаем для лога.
  if (markerData?.commerce_note === "info_dominant" || markerData?.commerce_note === "not_verified") {
    rowsWithCommerceWarning.push(row1);
  }
  row1++;
}

// Ширины (позиции от fixedLeft - устойчиво к колонкам «Раздел»/«Категория»).
// Собираем тем же порядком, что и fixedLeft: №, Адрес, Тип, Название, [Раздел], [Категория], Нужна?, Главный запрос, Спрос.
const leftWidths = [
  5,  // №
  32, // Адрес страницы
  14, // Тип
  28, // Название
  ...(useSections ? [18] : []), // Раздел
  ...(useCategory ? [18] : []), // Категория
  12, // Нужна?
  28, // Главный запрос
  10, // Спрос в месяц
];
leftWidths.forEach((w, i) => (ws1.getColumn(i + 1).width = w));
const qStart = fixedLeft.length + 1; // первая колонка «Запрос 2»
for (let k = 0; k < queryHeaders.length; k++) {
  ws1.getColumn(qStart + k).width = k % 2 === 0 ? 22 : 10;
}
const rStart = fixedLeft.length + queryHeaders.length; // смещение к fixedRight
ws1.getColumn(rStart + 1).width = 14; // «Есть у конкурентов»
ws1.getColumn(rStart + 2).width = 12; // «Приоритет»
ws1.getColumn(rStart + 3).width = 16; // «Статус»
ws1.getColumn(rStart + 4).width = 14; // «Роль»
ws1.getColumn(rStart + 5).width = 50; // «Примечания» шире — здесь служебная заметка

ws1.views = [{ state: "frozen", xSplit: COL_TARGET, ySplit: 2 }];
ws1.autoFilter = { from: { row: 2, column: 1 }, to: { row: row1 - 1, column: totalCols1 } };

// Data validation на колонку «Нужна?» (COL_TARGET) для всех data rows.
const firstDataRow = 3;
const lastDataRow = row1 - 1;
if (lastDataRow >= firstDataRow) {
  for (let r = firstDataRow; r <= lastDataRow; r++) {
    ws1.getCell(r, COL_TARGET).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: ['"да,нет,обсудить"'],
      showErrorMessage: true,
      errorStyle: "warning",
      errorTitle: "Допустимые значения",
      error: "Используйте: да, нет или обсудить",
      showInputMessage: true,
      promptTitle: "Целевая страница?",
      prompt: "Выбери: да / нет / обсудить",
    };
  }
}

// === Лист 2: РЕКОМЕНДАЦИИ ===

const ws2 = workbook.addWorksheet("Рекомендации");
const headers2 = [
  "Запрос",
  "Частотность",
  "Текущая привязка",
  "Рекомендация",
  "У скольких конкурентов отд. страница",
  "Обоснование",
];
ws2.addRow(headers2);
headers2.forEach((_, i) => applyHeader(ws2.getCell(1, i + 1)));

if (!cannibalization.recommendations || cannibalization.recommendations.length === 0) {
  ws2.mergeCells(2, 1, 2, headers2.length);
  ws2.getCell(2, 1).value = "Расширение не требуется - текущая структура покрывает основную семантику.";
  ws2.getCell(2, 1).font = { name: FONT_FAMILY, size: FONT_SIZE, italic: true };
} else {
  let r2 = 2;
  for (const rec of cannibalization.recommendations) {
    ws2.addRow([
      rec.query,
      rec.freq_exact,
      rec.current_attachment,
      rec.recommendation,
      rec.competitors_with_separate_page,
      rec.rationale,
    ]);
    ws2.getRow(r2).eachCell((c) => applyBody(c));
    r2++;
  }
}
ws2.getColumn(1).width = 30;
ws2.getColumn(2).width = 14;
ws2.getColumn(3).width = 30;
ws2.getColumn(4).width = 32;
ws2.getColumn(5).width = 18;
ws2.getColumn(6).width = 40;
ws2.views = [{ state: "frozen", ySplit: 1 }];

// === Лист 3: КОНКУРЕНТЫ ===

const ws3 = workbook.addWorksheet("Конкуренты");
const headers3 = ["Домен", "Тип", "DR", "ТОП-10", "ТОП-50", "Стр. в базе", "Трафик/мес", "Использован для", "Примечания"];
ws3.addRow(headers3);
headers3.forEach((_, i) => applyHeader(ws3.getCell(1, i + 1)));

const leaders = new Set(competitors.leaders_top3 || []);
const directList = competitors.direct || [];
let r3 = 2;
for (const c of directList) {
  const isLeader = leaders.has(c.domain);
  ws3.addRow([
    c.domain,
    c.type || "-",
    c.dr ?? "-",
    c.top10 ?? "-",
    c.top50 ?? "-",
    c.pages_keyso ?? c.pages_in_base ?? "-",
    c.traffic_month ?? "-",
    "мастер-список + маркеры",
    isLeader ? "⭐ лидер" : (c.note || c.notes || ""),
  ]);
  ws3.getRow(r3).eachCell((cell) => applyBody(cell));
  r3++;
}

ws3.getColumn(1).width = 24;
ws3.getColumn(2).width = 14;
ws3.getColumn(3).width = 6;
ws3.getColumn(4).width = 8;
ws3.getColumn(5).width = 8;
ws3.getColumn(6).width = 12;
ws3.getColumn(7).width = 12;
ws3.getColumn(8).width = 24;
ws3.getColumn(9).width = 24;
ws3.views = [{ state: "frozen", ySplit: 1 }];

// === Лист 4: МИГРАЦИЯ ===

const ws4 = workbook.addWorksheet("Миграция");
const headers4 = ["Текущий URL", "ТОП-10", "ТОП-50", "Спарена с (№ из структуры)", "Решение", "Новый URL", "Примечания"];
ws4.addRow(headers4);
headers4.forEach((_, i) => applyHeader(ws4.getCell(1, i + 1)));

if (!masterList.pairing_performed) {
  ws4.mergeCells(2, 1, 2, headers4.length);
  ws4.getCell(2, 1).value = "Миграция не требуется - нет текущего сайта с видимостью.";
  ws4.getCell(2, 1).font = { name: FONT_FAMILY, size: FONT_SIZE, italic: true };
} else {
  let r4 = 2;
  for (const page of masterList.pages) {
    if (!page.client_current_url) continue;
    ws4.addRow([
      page.client_current_url,
      page.client_top10_count ?? "-",
      page.client_top50_count ?? "-",
      page.n,
      decisionRu(page.migration_decision),
      page.migration_target_url ?? "-",
      page.notes || "",
    ]);
    const r = ws4.getRow(r4);
    r.eachCell((cell) => applyBody(cell));
    // Подсветка решения
    const dec = (page.migration_decision || "").toLowerCase();
    if (dec.includes("delete") || dec.includes("удал")) {
      ws4.getCell(r4, 5).font = { name: FONT_FAMILY, size: FONT_SIZE, color: { argb: "FFFF0000" }, bold: true };
    } else if (dec.includes("redirect") || dec === "301") {
      ws4.getCell(r4, 5).font = { name: FONT_FAMILY, size: FONT_SIZE, color: { argb: "FFFF8C00" }, bold: true };
    } else if (dec.includes("discuss") || dec.includes("обсуд")) {
      ws4.getCell(r4, 5).font = { name: FONT_FAMILY, size: FONT_SIZE, color: { argb: "FF9C27B0" }, bold: true };
    }
    r4++;
  }
}
ws4.getColumn(1).width = 30;
ws4.getColumn(2).width = 8;
ws4.getColumn(3).width = 8;
ws4.getColumn(4).width = 20;
ws4.getColumn(5).width = 18;
ws4.getColumn(6).width = 30;
ws4.getColumn(7).width = 28;
ws4.views = [{ state: "frozen", ySplit: 1 }];

// === Сохранение ===

await workbook.xlsx.writeFile(outputPath);

console.log(`[build-structure-xlsx] OK: ${outputPath}`);
console.log(`   Pages on Structure sheet: ${top10.pages.length}`);
console.log(`   Recommendations: ${cannibalization.recommendations?.length || 0}`);
console.log(`   Competitors: ${directList.length}`);
console.log(`   Migration: ${masterList.pairing_performed ? "yes" : "n/a"}`);
if (rowsWithCommerceWarning.length > 0) {
  console.log(`   i Pages with info-dominant note (role auto-set umbrella, neutral note): ${rowsWithCommerceWarning.length} (rows: ${rowsWithCommerceWarning.join(", ")})`);
}

// === Смысловой sanity-assert (не fatal) ===
// Заменяет «verify читаемости xlsx» (round-trip всегда читаем - это театр).
// Ловит реальную дыру: коммерческая страница ушла клиенту без живого маркера/запросов
// (например из-за молчаливой деградации JM). Только предупреждение - файл уже собран.
const COMMERCIAL_TYPES = new Set(["home", "category", "service", "product"]);
const sanityIssues = [];
for (const page of top10.pages) {
  if (!COMMERCIAL_TYPES.has(page.type)) continue;
  const md = markersByNum.get(page.n);
  // info_dominant / not_verified - это осознанные пометки marker-finder, не дыра.
  if (md?.commerce_note === "info_dominant") continue;
  const queries = page.queries || [];
  const hasMarker = (queries[0]?.query && queries[0].query !== "-") || (page.marker && page.marker !== "-");
  if (!hasMarker || queries.length === 0) {
    sanityIssues.push(`n${page.n} «${page.name}» (${page.type}) - без живого маркера/запросов`);
  }
}
if (sanityIssues.length > 0) {
  console.log(`   ⚠ SANITY: ${sanityIssues.length} коммерческих страниц ушли бы клиенту пустыми - проверь semantic_pack (деградация JM?):`);
  for (const s of sanityIssues) console.log(`       - ${s}`);
}

// === Локали ===
function typeRu(type) {
  return {
    home: "Главная",
    category: "Категория",
    service: "Услуга",
    product: "Товар",
    article: "Статья",
    info: "Инфо",
    other: "Прочее",
  }[type] || "Прочее"; // неизвестный тип -> «Прочее», не утекаем сырое англ. значение
}

function roleRu(role) {
  // Клиентопонятные формулировки, без англо-фоллбэка (неизвестное -> «Продвигаемая» по умолчанию).
  return {
    target: "Продвигаемая",
    umbrella: "Раздел-обзор",
    navigational: "Навигация",
    info: "Информация",
    article: "Блог",
  }[role] || "Продвигаемая";
}

function statusRu(migration) {
  if (!migration) return "новая";
  return {
    existing: "существующая",
    redirect_301: "301-редирект",
    delete_410: "к удалению",
    discuss: "обсудить",
    new: "новая",
  }[migration] || "новая"; // неизвестное -> «новая», не утекаем сырое значение
}

function decisionRu(d) {
  return {
    existing: "оставить",
    redirect_301: "301 на новый URL",
    delete_410: "удалить (410)",
    discuss: "обсудить с клиентом",
    new: "новая страница",
  }[d] || d || "-";
}
