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
// Имя файла: используем slug если есть (Latin, безопасно для email/FS), иначе domain без forbidden-chars (Windows).
const safeName = (inputs.slug || domain).replace(/[<>:"/\\|?*\x00-\x1f]/g, "_");
const outputPath = join(strategyDir, `Smeta_${safeName}.xlsx`);

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
  // Разовые - структура и контент
  SY: "Сбор СЯ и проектирование структуры страниц сайта",
  NG: "Сбор n-грамм и написание SEO-контента для страниц сайта",
  // Разовые - тех. работа
  BS: "Базовое SEO для Tilda (прописывание метатегов + ВМ/Метрика/IndexNow)",
  FA: "Полный технический SEO-аудит сайта",
  KF: "Исследование КФ и КНДР конкурентов-лидеров ниши",
  // Разовые - метатеги
  MF: "Составление метатегов по ВЧ-запросам (быстрое)",
  MD: "Индивидуальное составление метатегов (с разрешением омонимии)",
  // Разовые - контент
  IT: "Полный сбор СЯ под информационный трафик с картой тем",
  ART: "Тестовая SEO-статья (без сбора тем)",
  // Разовые - бренд/локал
  BR: "SERM-укрепление бренда через размещение на площадках",
  YB: "Регистрация компании на Яндекс.Картах",
  // Спец
  ST: "Сателлит - платформа для размещения статей",
  // Ежемесячные
  PF: "Внешнее продвижение через ПФ (Базовый)",
  PFP: "Внешнее продвижение через ПФ (Продвинутый)",
  LB: "Закупка и размещение внешних ссылок - Базовый",
  LA: "Закупка и размещение внешних ссылок - Продвинутый",
  AR: "Написание SEO-статей с полным циклом публикации (10 шт/мес)",
  RP: "SEO-отчётность и стратегическое сопровождение",
};

const SERVICE_DEADLINES = {
  SY: "5 дней", NG: "5 дней",
  BS: "3 дня", FA: "5 дней", KF: "5 дней",
  MF: "2 сут.", MD: "3 сут.",
  IT: "3 дня", ART: "3 дня",
  BR: "1 нед.", YB: "8 дней",
  ST: "2 нед.",
  PF: "-", PFP: "-", LB: "-", LA: "-", AR: "-", RP: "-",
};

const SERVICE_DESCRIPTIONS = {
  SY: "Парсинг запросов, кластеризация, ТЗ списка страниц с метатегами и URL",
  NG: "Анализ ТОП-10, сбор n-грамм, ТЗ из 2-5 текстовых блоков на страницы",
  BS: "Прописывание метатегов в Tilda + настройка Вебмастера, Метрики, GSC, IndexNow (только Tilda)",
  FA: "Полный аудит 100+ пунктов с чек-листом и приоритетами (для не-Tilda)",
  KF: "Сравнение топ-5 лидеров по 50+ блокам и элементам, ТЗ для редизайна",
  MF: "Готовые Title/Description/H1 по ВЧ-запросам для всех страниц",
  MD: "Индивидуальные метатеги с разрешением омонимии (для сложных ниш)",
  IT: "Выгрузка запросов конкурентов, расширение, карта тем для статей",
  ART: "Одна статья 1500-3000 слов по теме клиента (без сбора тем)",
  BR: "Чек-лист площадок (карты, каталоги, отзовики, соцсети) + опция 2к/площадка",
  YB: "Регистрация в Яндекс.Картах + синяя галочка + модерация",
  ST: "Тематический сайт на вайбкоде + закупка ссылок первого месяца",
  PF: "Буст скорости роста в Яндексе в 2-3 раза (средняя конкуренция)",
  PFP: "Усиленный ПФ для высокой конкуренции (увеличенный объём запросов)",
  LB: "20+ ссылок Web 2.0, 1-2 PBN, 1-2 статьи GoGetLinks",
  LA: "50+ ссылок, 2-3 PBN, 2-3 статьи на СМИ/порталах",
  AR: "10 статей/мес: n-граммы, структура, текст, метатеги, публикация",
  RP: "Еженедельный + ежемесячный отчёт с корректировкой стратегии",
};

const SERVICE_RESULTS = {
  SY: "ТЗ: список страниц с H1, Title, Description, URL",
  NG: "ТЗ: 2-5 блоков текста для каждой страницы",
  BS: "Прописанные в Tilda метатеги, настроенные Вебмастер/Метрика/GSC, IndexNow-сабмит",
  FA: "Аудит 100+ пунктов с комментариями и приоритетами",
  KF: "ТЗ: 50+ блоков и элементов с рекомендацией важности",
  MF: "ТЗ-таблица с готовыми метатегами для всех страниц",
  MD: "ТЗ-таблица с индивидуальными метатегами для сложных ниш",
  IT: "Структурированный список тем для статей",
  ART: "Готовая SEO-статья 1500-3000 слов с метатегами",
  BR: "Чек-лист площадок с URL, приоритетами и рекомендациями",
  YB: "Активная карточка в Картах + буст позиций в Яндексе",
  ST: "Тематический сайт с DR, готовый для размещения статей",
  PF: "Ускорение роста позиций в Яндексе в 2-3 раза",
  PFP: "Агрессивный буст в Яндексе для конкурентных ниш",
  LB: "Формирование разнообразного ссылочного профиля",
  LA: "Агрессивный рост ссылочного авторитета (Google + Яндекс)",
  AR: "Готовые к публикации статьи (10/мес) с метатегами и ТЗ",
  RP: "Полная прозрачность продвижения",
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

    // Описание + опц. price_note через перенос строки (помогает обосновать переменную цену для BS/MF/MD/PF/PFP)
    let description = service.description || SERVICE_DESCRIPTIONS[sid] || "";
    if (service.price_note) {
      description = description ? `${description}\n— ${service.price_note}` : `— ${service.price_note}`;
    }

    const values = [
      i + 1,
      SERVICE_NAMES[sid] || sid,
      description,
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

    // Описание + опц. price_note (для PF/PFP — обоснование выбора базового/продвинутого по конкурентности)
    let description = service.description || SERVICE_DESCRIPTIONS[sid] || "";
    if (service.price_note) {
      description = description ? `${description}\n— ${service.price_note}` : `— ${service.price_note}`;
    }

    const values = [
      i + 1,
      SERVICE_NAMES[sid] || sid,
      description,
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

// Defensive: tariff-architect (LLM) иногда генерит ключ 'rost' (транслит лейбла «Рост»)
// вместо канонического 'growth'. Принимаем оба, чтобы не пропустить вкладку silently.
const KEY_ALIASES = { rost: "growth" };
const KNOWN_TARIFFS = new Set(["start", "growth", "max"]);

for (const rawKey of Object.keys(tariffs)) {
  const canonicalKey = KEY_ALIASES[rawKey] || rawKey;
  if (!KNOWN_TARIFFS.has(canonicalKey)) continue; // skip special, checks и т.п.
  if (rawKey !== canonicalKey) {
    console.warn(`[build-smeta-xlsx] legacy tariff key '${rawKey}' detected, normalising to '${canonicalKey}'`);
  }
  writeTariffSheet(workbook, canonicalKey, tariffs[rawKey]);
}

// Финальная проверка — все ли три тарифа собрались.
const sheetTitles = workbook.worksheets.map(ws => ws.name);
const expected = ["Старт", "Рост", "Максимум"];
const missing = expected.filter(name => !sheetTitles.includes(name));
if (missing.length > 0) {
  console.warn(`[build-smeta-xlsx] WARNING: missing sheets: ${missing.join(", ")}. tariffs.json keys: ${Object.keys(tariffs).join(", ")}`);
}

await workbook.xlsx.writeFile(outputPath);
console.log(`[build-smeta-xlsx] wrote ${outputPath} (sheets: ${sheetTitles.join(", ")})`);
