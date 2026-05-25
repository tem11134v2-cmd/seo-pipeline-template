#!/usr/bin/env node
// build-smeta-xlsx.mjs
// Генерирует смету (.xlsx) с тремя вкладками (Старт / Рост / Максимум) на основе tariffs.json.
// Порт исходного smeta_template.py с openpyxl на ExcelJS.
//
// Зависимости: exceljs (npm install exceljs) — уже в package.json.
//
// Использование:
//   node .claude/scripts/build-smeta-xlsx.mjs <strategy_dir>
//
// Вход:
//   <strategy_dir>/tariffs.json — три тарифа от tariff-architect
//   <strategy_dir>/inputs.json  — домен и дата
// Выход:
//   <strategy_dir>/Smeta_<domain>.xlsx

import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import ExcelJS from "exceljs";

const strategyDirArg = process.argv[2];
if (!strategyDirArg) {
  console.error("[build-smeta-xlsx] usage: node build-smeta-xlsx.mjs <strategy_dir>");
  process.exit(1);
}
const strategyDir = resolve(strategyDirArg);

const tariffsPath = join(strategyDir, "tariffs.json");
const inputsPath = join(strategyDir, "inputs.json");

if (!existsSync(tariffsPath)) {
  console.error(`[build-smeta-xlsx] not found: ${tariffsPath}`);
  process.exit(1);
}
if (!existsSync(inputsPath)) {
  console.error(`[build-smeta-xlsx] not found: ${inputsPath}`);
  process.exit(1);
}

const tariffs = JSON.parse(readFileSync(tariffsPath, "utf8").replace(/^﻿/, ""));
const inputs = JSON.parse(readFileSync(inputsPath, "utf8").replace(/^﻿/, ""));

const domain = inputs.domain || "site";
const date = inputs.date || new Date().toLocaleDateString("ru-RU", { year: "numeric", month: "long" });
const outputPath = join(strategyDir, `Smeta_${domain.replace(/[^a-z0-9.-]/gi, "_")}.xlsx`);

// ═══ Дизайн-токены ═══
const COLORS = {
  header_bg: "FF1F4E79",
  header_text: "FFFFFFFF",
  total_bg: "FFD5E8F0",
  row_alt: "FFF2F2F2",
  row_white: "FFFFFFFF",
  text: "FF000000",
  muted: "FF666666",
  border: "FFCCCCCC",
};
const FONT_FAMILY = "Arial";
const FONT_SIZE = 10;
const FONT_SIZE_TITLE = 14;
const FONT_SIZE_SECTION = 12;

const COLUMNS = ["№", "Услуга", "Описание", "Срок", "Стоимость", "Результат"];
const COL_WIDTHS = [5, 35, 45, 12, 15, 40];

const TARIFF_NAMES = {
  start: "Старт",
  growth: "Рост",
  max: "Максимум",
};

const SERVICE_NAMES = {
  SY: "Сбор СЯ и проектирование структуры страниц сайта",
  NG: "Сбор n-грамм и написание SEO-контента для страниц сайта",
  BS: "Базовая SEO-оптимизация",
  FA: "Полный технический SEO-аудит сайта",
  KF: "Исследование КФ и КНДР конкурентов-лидеров ниши",
  UX: "Аудит юзабилити интернет-магазина",
  PF: "Внешнее продвижение сайта через ПФ в Яндексе",
  RP: "SEO-отчётность и стратегическое сопровождение",
  LB: "Закупка и размещение внешних ссылок - Базовый",
  LA: "Закупка и размещение внешних ссылок - Продвинутый",
  IT: "Полный сбор СЯ под информационный трафик с картой тем",
  AR: "Написание SEO-статей с полным циклом публикации (10 шт/мес)",
  SR: "SERM - аудит и стратегия управления репутацией",
  BR: "Базовое укрепление бренда через размещение на площадках",
  YB: "Настройка и ведение профиля в Яндекс.Бизнес",
  SC: "Внедрение структурированных данных Schema.org",
  PL: "Внутренняя перелинковка сайта - ТЗ с матрицей ссылок",
  ST: "Создание и раскачка тематического сателлита",
  MG: "Миграция сайта / смена CMS без потери позиций",
};

const SERVICE_DEADLINES = {
  SY: "1 нед.", NG: "1 нед.", BS: "1 нед.", FA: "1 нед.",
  KF: "2 нед.", UX: "1 нед.", IT: "1 нед.", SR: "1 нед.",
  BR: "1 нед.", SC: "1 нед.", PL: "1 нед.", ST: "2 нед.",
  MG: "1 нед.",
  PF: "-", RP: "-", LB: "-", LA: "-", AR: "-", YB: "-",
};

const SERVICE_DESCRIPTIONS = {
  SY: "Поиск направлений, парсинг запросов, кластеризация, метатеги",
  NG: "Анализ ТОП-10, сбор n-грамм, написание текстовых блоков",
  BS: "Проверка настроек, метатеги, Вебмастер, Метрика, IndexNow",
  FA: "Полный аудит 100+ пунктов с чек-листом и приоритетами",
  KF: "Сравнение 5 лидеров по 50+ блокам и элементам",
  UX: "Аудит 100 пунктов: шапка, каталог, карточка, корзина",
  PF: "Буст скорости роста в Яндексе в 2-3 раза",
  RP: "Еженедельный + ежемесячный отчёт с корректировкой стратегии",
  LB: "20+ ссылок Web 2.0, 1-2 PBN, 1-2 статьи GoGetLinks",
  LA: "50+ ссылок, 2-3 PBN, 2-3 статьи на СМИ/порталах",
  IT: "Выгрузка запросов, расширение, кластеризация, карта тем",
  AR: "10 статей/мес: n-граммы, структура, текст, метатеги, публикация",
  SR: "Анализ выдачи по бренду, план по площадкам и статьям",
  BR: "Подбор площадок: карты, каталоги, отзовики, соцсети",
  YB: "Карточка, платное продвижение, работа с отзывами",
  SC: "JSON-LD разметка для каждой страницы + инструкция",
  PL: "Матрица перелинковки + постраничные таблицы",
  ST: "Сателлит на WordPress: 5-10 статей + ПФ + ссылки",
  MG: "Карта редиректов, контроль контента, мониторинг",
};

const SERVICE_RESULTS = {
  SY: "ТЗ: список страниц с H1, Title, Description, URL",
  NG: "ТЗ: 2-5 блоков текста для каждой страницы",
  BS: "Корректные метатеги, настроенные Вебмастер + Метрика",
  FA: "Аудит 100+ пунктов с комментариями",
  KF: "ТЗ: 50+ блоков с рекомендациями",
  UX: "Аудит 100 пунктов с оценками",
  PF: "Ускорение роста позиций в Яндексе",
  RP: "Полная прозрачность продвижения",
  LB: "Формирование ссылочного профиля",
  LA: "Агрессивный рост ссылочного авторитета",
  IT: "Список тем с привязкой к запросам",
  AR: "Готовые к публикации статьи",
  SR: "Карта ситуации + стратегия",
  BR: "Чек-лист площадок с приоритетами",
  YB: "Карточка + буст позиций в Картах",
  SC: "JSON-LD код + инструкция + чек-лист",
  PL: "Матрица перелинковки",
  ST: "Тематическая площадка в ТОП",
  MG: "Переезд с сохранением позиций",
};

// ═══ Хелперы стилей ═══
const thinBorder = {
  top: { style: "thin", color: { argb: COLORS.border } },
  left: { style: "thin", color: { argb: COLORS.border } },
  bottom: { style: "thin", color: { argb: COLORS.border } },
  right: { style: "thin", color: { argb: COLORS.border } },
};

function applyHeader(cell) {
  cell.font = { name: FONT_FAMILY, size: FONT_SIZE, bold: true, color: { argb: COLORS.header_text } };
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.header_bg } };
  cell.border = thinBorder;
  cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
}

function applyTotal(cell, withFormat) {
  cell.font = { name: FONT_FAMILY, size: FONT_SIZE, bold: true, color: { argb: COLORS.text } };
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.total_bg } };
  cell.border = thinBorder;
  cell.alignment = { horizontal: cell.alignment?.horizontal || "left", vertical: "middle", wrapText: true };
  if (withFormat) cell.numFmt = withFormat;
}

function applyBody(cell, isAlt, alignCenter) {
  cell.font = { name: FONT_FAMILY, size: FONT_SIZE, color: { argb: COLORS.text } };
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: isAlt ? COLORS.row_alt : COLORS.row_white } };
  cell.border = thinBorder;
  cell.alignment = { horizontal: alignCenter ? "center" : "left", vertical: "middle", wrapText: true };
}

// ═══ Запись вкладки ═══
function writeTariffSheet(workbook, tariffKey, tariffData) {
  const name = TARIFF_NAMES[tariffKey];
  const ws = workbook.addWorksheet(name);

  // Колонки (ширина)
  COL_WIDTHS.forEach((w, i) => {
    ws.getColumn(i + 1).width = w;
  });

  let row = 1;

  // Шапка - название тарифа
  ws.mergeCells(row, 1, row, 6);
  const titleCell = ws.getCell(row, 1);
  titleCell.value = `СМЕТА - ТАРИФ «${name.toUpperCase()}»`;
  titleCell.font = { name: FONT_FAMILY, size: FONT_SIZE_TITLE, bold: true, color: { argb: COLORS.header_bg } };
  titleCell.alignment = { horizontal: "left", vertical: "middle" };
  ws.getRow(row).height = 22;
  row++;

  ws.mergeCells(row, 1, row, 6);
  const subCell = ws.getCell(row, 1);
  subCell.value = `${domain} - SEO-продвижение | ${date}`;
  subCell.font = { name: FONT_FAMILY, size: FONT_SIZE, color: { argb: COLORS.muted } };
  subCell.alignment = { horizontal: "left", vertical: "middle" };
  row += 2;

  // === Разовые работы ===
  ws.mergeCells(row, 1, row, 6);
  const onetimeTitle = ws.getCell(row, 1);
  onetimeTitle.value = "Разовые работы";
  onetimeTitle.font = { name: FONT_FAMILY, size: FONT_SIZE_SECTION, bold: true, color: { argb: COLORS.header_bg } };
  row++;

  // Заголовок таблицы
  COLUMNS.forEach((col, i) => {
    const c = ws.getCell(row, i + 1);
    c.value = col;
    applyHeader(c);
  });
  row++;

  const onetimeStartRow = row;
  const onetimeServices = tariffData.onetime || [];
  onetimeServices.forEach((service, i) => {
    const sid = service.id;
    const isAlt = i % 2 === 1;

    const values = [
      i + 1,
      SERVICE_NAMES[sid] || sid,
      service.description || SERVICE_DESCRIPTIONS[sid] || "",
      service.deadline || SERVICE_DEADLINES[sid] || "1 нед.",
      service.price ?? 0,
      service.result || SERVICE_RESULTS[sid] || "",
    ];
    values.forEach((v, j) => {
      const c = ws.getCell(row, j + 1);
      c.value = v;
      applyBody(c, isAlt, !(j === 1 || j === 2 || j === 5));
      if (j === 4) {
        // колонка Стоимость
        if (typeof v === "number" && v === 0) {
          c.value = "бесплатно";
          c.numFmt = "@";
        } else if (typeof v === "number") {
          c.numFmt = '#,##0 "₽"';
        }
      }
    });
    row++;
  });
  const onetimeEndRow = row - 1;

  // Итого разовые
  ws.mergeCells(row, 1, row, 4);
  const onetimeLabel = ws.getCell(row, 1);
  onetimeLabel.value = "ИТОГО разовые работы";
  applyTotal(onetimeLabel);

  const onetimeTotalCell = ws.getCell(row, 5);
  if (onetimeServices.length > 0) {
    onetimeTotalCell.value = { formula: `SUM(E${onetimeStartRow}:E${onetimeEndRow})` };
  } else {
    onetimeTotalCell.value = 0;
  }
  applyTotal(onetimeTotalCell, '#,##0 "₽"');

  const onetimeResultCell = ws.getCell(row, 6);
  onetimeResultCell.value = "";
  applyTotal(onetimeResultCell);

  const onetimeTotalRow = row;
  row += 2;

  // === Ежемесячные работы ===
  ws.mergeCells(row, 1, row, 6);
  const monthlyTitle = ws.getCell(row, 1);
  monthlyTitle.value = "Ежемесячные работы";
  monthlyTitle.font = { name: FONT_FAMILY, size: FONT_SIZE_SECTION, bold: true, color: { argb: COLORS.header_bg } };
  row++;

  COLUMNS.forEach((col, i) => {
    const c = ws.getCell(row, i + 1);
    c.value = col;
    applyHeader(c);
  });
  row++;

  const monthlyStartRow = row;
  const monthlyServices = tariffData.monthly || [];
  monthlyServices.forEach((service, i) => {
    const sid = service.id;
    const isAlt = i % 2 === 1;

    const values = [
      i + 1,
      SERVICE_NAMES[sid] || sid,
      service.description || SERVICE_DESCRIPTIONS[sid] || "",
      "-",
      service.price ?? 0,
      service.result || SERVICE_RESULTS[sid] || "",
    ];
    values.forEach((v, j) => {
      const c = ws.getCell(row, j + 1);
      c.value = v;
      applyBody(c, isAlt, !(j === 1 || j === 2 || j === 5));
      if (j === 4) {
        if (typeof v === "number" && v === 0) {
          c.value = "бесплатно";
          c.numFmt = "@";
        } else if (typeof v === "number") {
          c.numFmt = '#,##0 "₽/мес"';
        }
      }
    });
    row++;
  });
  const monthlyEndRow = row - 1;

  // Итого ежемесячно
  ws.mergeCells(row, 1, row, 4);
  const monthlyLabel = ws.getCell(row, 1);
  monthlyLabel.value = "ИТОГО ежемесячно";
  applyTotal(monthlyLabel);

  const monthlyTotalCell = ws.getCell(row, 5);
  if (monthlyServices.length > 0) {
    monthlyTotalCell.value = { formula: `SUM(E${monthlyStartRow}:E${monthlyEndRow})` };
  } else {
    monthlyTotalCell.value = 0;
  }
  applyTotal(monthlyTotalCell, '#,##0 "₽/мес"');

  const monthlyResultCell = ws.getCell(row, 6);
  monthlyResultCell.value = "";
  applyTotal(monthlyResultCell);

  const monthlyTotalRow = row;
  row += 2;

  // === Порядок оплаты ===
  ws.mergeCells(row, 1, row, 6);
  const orderTitle = ws.getCell(row, 1);
  orderTitle.value = "ПОРЯДОК ОПЛАТЫ";
  orderTitle.font = { name: FONT_FAMILY, size: FONT_SIZE_SECTION, bold: true, color: { argb: COLORS.header_bg } };
  row++;

  const orderLines = [
    {
      label: "Этап 1 (старт): Оплата разовых работ",
      formula: `E${onetimeTotalRow}`,
      fmt: '#,##0 "₽"',
    },
    {
      label: "Срок выполнения",
      value: tariffData.deadline_total || "1-3 недели",
      fmt: null,
    },
    {
      label: "Этап 2 (ежемесячно): После завершения разовых",
      formula: `E${monthlyTotalRow}`,
      fmt: '#,##0 "₽/мес"',
    },
  ];
  orderLines.forEach((line) => {
    ws.mergeCells(row, 1, row, 4);
    const labelCell = ws.getCell(row, 1);
    labelCell.value = line.label;
    labelCell.font = { name: FONT_FAMILY, size: FONT_SIZE, color: { argb: COLORS.text } };
    labelCell.alignment = { horizontal: "left", vertical: "middle" };

    const valCell = ws.getCell(row, 5);
    if (line.formula) {
      valCell.value = { formula: line.formula };
    } else {
      valCell.value = line.value;
    }
    valCell.font = { name: FONT_FAMILY, size: FONT_SIZE, bold: true, color: { argb: COLORS.text } };
    if (line.fmt) valCell.numFmt = line.fmt;
    row++;
  });

  row++;

  ws.mergeCells(row, 1, row, 4);
  ws.getCell(row, 1).value = "Итого за первый период (разовые)";
  ws.getCell(row, 1).font = { name: FONT_FAMILY, size: FONT_SIZE, bold: true, color: { argb: COLORS.text } };
  const firstPeriodCell = ws.getCell(row, 5);
  firstPeriodCell.value = { formula: `E${onetimeTotalRow}` };
  firstPeriodCell.font = { name: FONT_FAMILY, size: FONT_SIZE, bold: true, color: { argb: COLORS.text } };
  firstPeriodCell.numFmt = '#,##0 "₽"';
  row++;

  ws.mergeCells(row, 1, row, 4);
  ws.getCell(row, 1).value = "Далее ежемесячно";
  ws.getCell(row, 1).font = { name: FONT_FAMILY, size: FONT_SIZE, bold: true, color: { argb: COLORS.text } };
  const monthlyOngoingCell = ws.getCell(row, 5);
  monthlyOngoingCell.value = { formula: `E${monthlyTotalRow}` };
  monthlyOngoingCell.font = { name: FONT_FAMILY, size: FONT_SIZE, bold: true, color: { argb: COLORS.text } };
  monthlyOngoingCell.numFmt = '#,##0 "₽/мес"';

  // Зафиксируй первую строку (название тарифа)
  ws.views = [{ state: "frozen", ySplit: 1 }];
}

// ═══ MAIN ═══
const workbook = new ExcelJS.Workbook();
workbook.creator = "TIMUR SEO";
workbook.created = new Date();

for (const tariffKey of ["start", "growth", "max"]) {
  if (tariffs[tariffKey]) {
    writeTariffSheet(workbook, tariffKey, tariffs[tariffKey]);
  }
}

await workbook.xlsx.writeFile(outputPath);
console.log(`[build-smeta-xlsx] wrote ${outputPath}`);
