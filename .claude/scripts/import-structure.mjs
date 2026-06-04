#!/usr/bin/env node
// import-structure.mjs
// Парсит client_filled.xlsx (возвращённый клиентом A6.xlsx с заполненной колонкой «Целевая?»)
// в structure_data.json для дальнейшей сборки A6.md агентом structure-writer.
//
// Используется в /seo-struktura на шаге 9б.
//
// Использование:
//   node .claude/scripts/import-structure.mjs <structure_dir>
//
// Вход:
//   <structure_dir>/client_filled.xlsx
// Выход:
//   <structure_dir>/structure_data.json
//
// Exit:
//   0  - всё ок, структура распарсена и в файле есть и «да», и «нет»/«обсудить»
//   3  - есть строки «обсудить» - скил спросит пользователя как их трактовать
//   4  - колонка «Целевая?» полностью пуста - скил спросит «считать все целевыми?»
//   1  - критическая ошибка (нет файла, не открывается, нет листа «Структура»)

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import ExcelJS from "exceljs";

const structureDirArg = process.argv[2];
if (!structureDirArg) {
  console.error("[import-structure] usage: node import-structure.mjs <structure_dir>");
  process.exit(1);
}
const structureDir = resolve(structureDirArg);
const xlsxPath = join(structureDir, "client_filled.xlsx");

if (!existsSync(xlsxPath)) {
  console.error(`[import-structure] not found: ${xlsxPath}. Сначала скопируй файл клиента сюда.`);
  process.exit(1);
}

const wb = new ExcelJS.Workbook();
try {
  await wb.xlsx.readFile(xlsxPath);
} catch (err) {
  console.error(`[import-structure] не удалось прочитать xlsx: ${err.message}`);
  process.exit(1);
}

// === Лист «Структура» ===
const ws = wb.getWorksheet("Структура");
if (!ws) {
  console.error("[import-structure] нет листа «Структура» в файле клиента. Возможно, файл повреждён или это не A6.xlsx.");
  process.exit(1);
}

// Достаём заголовки. С версии v2 build-structure-xlsx.mjs строка 1 - instruction для клиента,
// заголовки таблицы в строке 2. Поддерживаем оба формата: ищем первую строку с непустой ячейкой "№".
let headerRowNum = 0;
for (let r = 1; r <= 5; r++) {
  const row = ws.getRow(r);
  const firstCell = String(row.getCell(1).value || "").trim();
  if (firstCell === "№") {
    headerRowNum = r;
    break;
  }
}
if (headerRowNum === 0) {
  console.error("[import-structure] не найдена строка заголовков (ожидалась ячейка «№» в первых 5 строках).");
  process.exit(1);
}
const headerRow = ws.getRow(headerRowNum);
const headers = [];
headerRow.eachCell((cell, colNumber) => {
  headers[colNumber] = String(cell.value || "").trim();
});
const firstDataRow = headerRowNum + 1;

// Индексы колонок (1-based). Принимает ОДНО имя или массив алиасов:
// новые клиентские заголовки + старые (обратная совместимость с уже разосланными файлами).
function findCol(names) {
  const list = Array.isArray(names) ? names : [names];
  for (let i = 1; i < headers.length; i++) {
    if (list.includes(headers[i])) return i;
  }
  return -1;
}

const COL_N = findCol("№");
const COL_URL = findCol(["Адрес страницы", "URL (ЧПУ)"]);
const COL_TYPE = findCol("Тип");
const COL_NAME = findCol("Название");
const COL_SECTION = findCol("Раздел"); // -1 если структура не секционирована - guard ниже
const COL_TARGET = findCol(["Нужна?", "Целевая?"]);
const COL_MARKER = findCol(["Главный запрос", "Маркер"]);
const COL_WS = findCol(["Спрос в месяц", "WS"]);
const COL_COMPETITORS = findCol(["Есть у конкурентов", "У конкурентов"]);
const COL_PRIORITY = findCol("Приоритет");
const COL_STATUS = findCol("Статус");
const COL_ROLE = findCol("Роль"); // может быть -1 в старых файлах (до Фазы 4) - guard ниже
const COL_NOTES = findCol("Примечания");

if (COL_TARGET < 0) {
  console.error("[import-structure] не найдена колонка «Нужна?»/«Целевая?» - возможно клиент изменил структуру или это не A6.xlsx.");
  process.exit(1);
}

// Все колонки с запросами и частотами (2..10 = до 9 дополнительных запросов помимо маркера).
// Новые заголовки «Спрос N» + старые «ЧN».
const queryCols = [];
for (let i = 2; i <= 10; i++) {
  const qCol = findCol(`Запрос ${i}`);
  const fCol = findCol([`Спрос ${i}`, `Ч${i}`]);
  if (qCol > 0 && fCol > 0) queryCols.push({ qCol, fCol, num: i });
}

// === Парсинг строк ===

function normalizeTarget(value) {
  if (value === null || value === undefined) return "";
  const s = String(value).toLowerCase().trim();
  if (!s) return "";
  if (["да", "yes", "y", "1", "true", "+"].includes(s)) return "yes";
  if (["нет", "no", "n", "0", "false", "-"].includes(s)) return "no";
  if (["обсудить", "discuss", "?"].includes(s)) return "discuss";
  // Не пустая, но непонятная отметка - трактуем как «обсудить» с сохранением оригинала
  return "discuss";
}

const pages = [];
let stats = { yes: 0, no: 0, discuss: 0, empty: 0, total: 0 };

for (let r = firstDataRow; r <= ws.rowCount; r++) {
  const row = ws.getRow(r);
  if (row.cellCount === 0) continue;

  const n = row.getCell(COL_N).value;
  const name = row.getCell(COL_NAME).value;

  // Пропускаем пустые/служебные строки
  if (!n && !name) continue;

  const rawTarget = row.getCell(COL_TARGET).value;
  const target = normalizeTarget(rawTarget);

  // Соберём запросы
  const queries = [];
  for (const { qCol, fCol, num } of queryCols) {
    const q = row.getCell(qCol).value;
    const f = row.getCell(fCol).value;
    if (q && String(q).trim() && String(q).trim() !== "-") {
      queries.push({
        n: num,
        query: String(q).trim(),
        freq_exact: typeof f === "number" ? f : (parseInt(String(f), 10) || null),
      });
    }
  }

  const page = {
    n: typeof n === "number" ? n : parseInt(String(n), 10) || null,
    url: row.getCell(COL_URL).value ? String(row.getCell(COL_URL).value).trim() : "",
    type: row.getCell(COL_TYPE).value ? String(row.getCell(COL_TYPE).value).trim() : "",
    name: name ? String(name).trim() : "",
    section: COL_SECTION > 0 && row.getCell(COL_SECTION).value ? String(row.getCell(COL_SECTION).value).trim() : "",
    target_status: target || "empty",
    target_raw: rawTarget,
    marker: row.getCell(COL_MARKER).value ? String(row.getCell(COL_MARKER).value).trim() : "",
    ws_exact: typeof row.getCell(COL_WS).value === "number"
      ? row.getCell(COL_WS).value
      : (parseInt(String(row.getCell(COL_WS).value), 10) || null),
    queries,
    competitors: row.getCell(COL_COMPETITORS).value ? String(row.getCell(COL_COMPETITORS).value).trim() : "",
    priority: row.getCell(COL_PRIORITY).value ? String(row.getCell(COL_PRIORITY).value).trim() : "",
    status: row.getCell(COL_STATUS).value ? String(row.getCell(COL_STATUS).value).trim() : "",
    role: COL_ROLE > 0 && row.getCell(COL_ROLE).value ? String(row.getCell(COL_ROLE).value).trim() : "",
    client_notes: row.getCell(COL_NOTES).value ? String(row.getCell(COL_NOTES).value).trim() : "",
  };

  pages.push(page);
  stats.total++;
  if (target === "yes") stats.yes++;
  else if (target === "no") stats.no++;
  else if (target === "discuss") stats.discuss++;
  else stats.empty++;
}

if (stats.total === 0) {
  console.error("[import-structure] лист «Структура» пуст (нет строк после заголовка).");
  process.exit(1);
}

// === Доп. лист «Рекомендации» (опц., клиент мог что-то поменять) ===
const recommendations = [];
const wsRec = wb.getWorksheet("Рекомендации");
if (wsRec) {
  for (let r = 2; r <= wsRec.rowCount; r++) {
    const row = wsRec.getRow(r);
    if (row.cellCount === 0) continue;
    const q = row.getCell(1).value;
    if (!q || String(q).startsWith("Расширение не требуется")) continue;
    recommendations.push({
      query: String(q).trim(),
      freq_exact: typeof row.getCell(2).value === "number" ? row.getCell(2).value : (parseInt(String(row.getCell(2).value), 10) || null),
      current_attachment: row.getCell(3).value ? String(row.getCell(3).value).trim() : "",
      recommendation: row.getCell(4).value ? String(row.getCell(4).value).trim() : "",
      competitors_with_separate_page: row.getCell(5).value || "",
      rationale: row.getCell(6).value ? String(row.getCell(6).value).trim() : "",
    });
  }
}

// === Сохранение ===
const out = {
  imported_at: new Date().toISOString(),
  source_file: "client_filled.xlsx",
  stats,
  pages,
  recommendations,
};

writeFileSync(join(structureDir, "structure_data.json"), JSON.stringify(out, null, 2));

// === Развилка по статусам ===

console.log(`[import-structure] OK: распарсено ${stats.total} страниц`);
console.log(`   target=yes: ${stats.yes}`);
console.log(`   target=no: ${stats.no}`);
console.log(`   target=discuss: ${stats.discuss}`);
console.log(`   target=empty: ${stats.empty}`);

if (stats.empty === stats.total) {
  // Колонка «Целевая?» вообще не заполнена.
  console.log("[import-structure] WARNING: колонка «Целевая?» полностью пуста.");
  process.exit(4);
}

if (stats.discuss > 0) {
  console.log(`[import-structure] NOTE: ${stats.discuss} страниц требуют решения (обсудить).`);
  process.exit(3);
}

process.exit(0);
