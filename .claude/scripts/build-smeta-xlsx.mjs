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
import { TARIFF_SCALE, TARIFF_KEYS, computeScenarioTariff } from "./_forecast-money.mjs";

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
  // Разовые - анализ, структура и контент
  PA: "Предпроектный анализ конкурентов",
  SY: "Сбор СЯ и проектирование структуры страниц сайта",
  NG: "Сбор n-грамм и написание SEO-контента для страниц сайта",
  // Разовые - тех. работа
  BS: "Базовое SEO для Tilda (прописывание метатегов + ВМ/Метрика/IndexNow)",
  FA: "Полный технический SEO-аудит сайта",
  KF: "Исследование КФ и КНДР конкурентов-лидеров ниши",
  // Разовые - метатеги (отдельной услугой, если нет SY)
  MT: "Составление метатегов под ВЧ-запросы (Title/Description/H1)",
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
  PA: "3-5 дней", SY: "5 дней", NG: "5 дней",
  BS: "3 дня", FA: "5 дней", KF: "5 дней",
  MT: "2-3 сут.",
  IT: "3 дня", ART: "3 дня",
  BR: "1 нед.", YB: "8 дней",
  ST: "2 нед.",
  PF: "-", PFP: "-", LB: "-", LA: "-", AR: "-", RP: "-",
};

const SERVICE_DESCRIPTIONS = {
  PA: "Бриф, конкуренты, SERP-вердикт, скан смыслов лидеров, отчёт A2",
  SY: "Парсинг запросов, кластеризация, ТЗ списка страниц с готовыми метатегами и URL",
  NG: "Анализ ТОП-10, сбор n-грамм, ТЗ из 2-5 текстовых блоков на страницы",
  BS: "Прописывание метатегов в Tilda + настройка Вебмастера, Метрики, GSC, IndexNow (только Tilda)",
  FA: "Полный аудит 100+ пунктов с чек-листом и приоритетами (для не-Tilda)",
  KF: "Сравнение топ-5 лидеров по 50+ блокам и элементам, ТЗ для редизайна",
  MT: "Готовые Title/Description/H1 по ВЧ-запросам для всех страниц (если нет структуры SY)",
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
  PA: "Отчёт A2: вердикт, конкуренты, точки роста, сравнение с лидерами, стоп-лист",
  SY: "ТЗ: список страниц с H1, Title, Description, URL",
  NG: "ТЗ: 2-5 блоков текста для каждой страницы",
  BS: "Прописанные в Tilda метатеги, настроенные Вебмастер/Метрика/GSC, IndexNow-сабмит",
  FA: "Аудит 100+ пунктов с комментариями и приоритетами",
  KF: "ТЗ: 50+ блоков и элементов с рекомендацией важности",
  MT: "ТЗ-таблица с готовыми метатегами для всех страниц",
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

// Алиасы устаревших ID услуг -> актуальные (старые tariffs.json после слияния MF/MD -> MT)
const SERVICE_ID_ALIASES = { MF: "MT", MD: "MT" };

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
    const sid = SERVICE_ID_ALIASES[service.id] || service.id;
    const isAlt = i % 2 === 1;

    // Описание + опц. price_note через перенос строки (помогает обосновать переменную цену для BS/PF/PFP)
    let description = service.description || SERVICE_DESCRIPTIONS[sid] || "";
    if (service.price_note) {
      description = description ? `${description}\n- ${service.price_note}` : `- ${service.price_note}`;
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
    const sid = SERVICE_ID_ALIASES[service.id] || service.id;
    const isAlt = i % 2 === 1;

    // Описание + опц. price_note (для PF/PFP — обоснование выбора базового/продвинутого по конкурентности)
    let description = service.description || SERVICE_DESCRIPTIONS[sid] || "";
    if (service.price_note) {
      description = description ? `${description}\n- ${service.price_note}` : `- ${service.price_note}`;
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

// ═══ 4-я вкладка: Декомпозиция и окупаемость ═══
// Читает seo-strategiya_data.json. Два формата данных:
// - НОВЫЙ (`forecast_scenarios`) - два самосогласованных сценария («Вход 3-6 мес» / «Год
//   работы»), денежная математика полностью в общем модуле `_forecast-money.mjs`
//   (см. writeScenarioSheet).
// - СТАРЫЙ (`decomposition` + `forecast`, без `forecast_scenarios`) - легаси-рендер
//   одной моделью затрат на 12 мес, БЕЗ изменения чисел, но с пометкой «Старый формат»
//   (writeLegacyDecompositionSheet) - отданные клиентам сметы не должны молча меняться.

function periodToMonth(label) {
  if (/сейчас/i.test(label)) return 0;
  const m = String(label).match(/\d+/);
  return m ? parseInt(m[0], 10) : 0;
}

// Линейная интерполяция трафика на месяц m по точкам forecast {month, traffic} (legacy-путь).
function interpTraffic(points, m) {
  if (!points.length) return 0;
  if (m <= points[0].month) return points[0].traffic;
  if (m >= points[points.length - 1].month) return points[points.length - 1].traffic;
  for (let i = 1; i < points.length; i++) {
    if (m <= points[i].month) {
      const a = points[i - 1], b = points[i];
      const t = b.month === a.month ? 0 : (m - a.month) / (b.month - a.month);
      return a.traffic + (b.traffic - a.traffic) * t;
    }
  }
  return points[points.length - 1].traffic;
}

// Старая модель расчета (одна кривая, затраты за все 12 мес) - оставлена бит-в-бит для legacy-пути,
// чтобы уже отданные клиентам сметы при пересборке давали те же числа.
function legacyComputeCase(tariffData, points, dec, scale) {
  const cr = dec.conversion_rate ?? 0.02;
  const close = dec.close_rate ?? (dec.model === "one_step" ? 1 : 0.3);
  const avg = dec.avg_check ?? 0;
  const margin = dec.margin ?? 0.35;
  const onetime = tariffData.total_onetime ?? 0;
  const monthly = tariffData.total_monthly ?? 0;

  // Окупаемость считается от ПРИБЫЛИ (выручка x маржа), а не от валовой выручки.
  let cumRev = 0, payback = null;
  for (let m = 1; m <= 12; m++) {
    const traffic = interpTraffic(points, m) * scale;
    cumRev += traffic * cr * close * avg;       // валовая выручка нарастающим итогом
    const cumProfit = cumRev * margin;          // вклад в прибыль (до затрат на SEO)
    const cumCost = onetime + monthly * m;
    if (payback === null && cumProfit >= cumCost) payback = m;
  }
  const t12 = interpTraffic(points, 12) * scale;
  const leads12 = t12 * cr;
  const sales12 = leads12 * close;
  const yearCost = onetime + monthly * 12;
  const yearProfit = cumRev * margin;           // прибыль с маржой за 12 мес
  const yearNet = yearProfit - yearCost;        // чистый результат после затрат на SEO
  const roi = yearCost > 0 ? (yearNet / yearCost) * 100 : 0;
  return {
    traffic12: Math.round(t12),
    leads12: Math.round(leads12),
    sales12: Math.round(sales12),
    revMonth12: Math.round(sales12 * avg),
    yearCost,
    yearGross: Math.round(cumRev),
    yearProfit: Math.round(yearProfit),
    yearNet: Math.round(yearNet),
    payback,
    roi: Math.round(roi),
  };
}

// Диспетчер: новый сценарный формат / старый легаси-формат / ничего.
function writeDecompositionSheet(workbook, tariffsByKey, data) {
  if (data.forecast_scenarios && Array.isArray(data.forecast_scenarios.scenarios)
      && data.forecast_scenarios.scenarios.length) {
    return writeScenarioSheet(workbook, tariffsByKey, data.forecast_scenarios);
  }
  if (data.decomposition && Array.isArray(data.forecast) && data.forecast.length) {
    return writeLegacyDecompositionSheet(workbook, tariffsByKey, data);
  }
  return false;
}

// ═══ Legacy-рендер (старый формат данных, без forecast_scenarios) ═══
function writeLegacyDecompositionSheet(workbook, tariffsByKey, data) {
  const dec = data.decomposition;
  const forecast = Array.isArray(data.forecast) ? data.forecast : [];
  const points = forecast
    .map(f => ({ month: periodToMonth(f.period), traffic: Number(f.traffic_month) || 0 }))
    .sort((a, b) => a.month - b.month);

  const ws = workbook.addWorksheet("Декомпозиция и окупаемость");
  [4, 38, 18, 18, 18].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  let row = 1;

  ws.mergeCells(row, 1, row, 5);
  const t = ws.getCell(row, 1);
  t.value = "ДЕКОМПОЗИЦИЯ И ОКУПАЕМОСТЬ";
  t.font = { name: FONT_FAMILY, size: FONT_SIZE_TITLE, bold: true, color: { argb: COLORS.header_bg } };
  ws.getRow(row).height = 22; row++;

  ws.mergeCells(row, 1, row, 5);
  const sub = ws.getCell(row, 1);
  sub.value = `${domain} - SEO-продвижение | ${date}`;
  sub.font = { name: FONT_FAMILY, size: FONT_SIZE, color: { argb: COLORS.muted } };
  row += 2;

  ws.mergeCells(row, 1, row, 5);
  const notice = ws.getCell(row, 1);
  notice.value = "Старый формат: расчет по одной модели затрат (12 мес). Актуальная методика - два сценария (\"Вход 3-6 мес\" и \"Год работы\"), доступна при пересборке стратегии.";
  notice.font = { name: FONT_FAMILY, size: FONT_SIZE, bold: true, italic: true, color: { argb: COLORS.header_bg } };
  notice.alignment = { wrapText: true, vertical: "top" };
  ws.getRow(row).height = 30;
  row += 2;

  const crp = Math.round((dec.conversion_rate ?? 0.02) * 1000) / 10;
  const closep = Math.round((dec.close_rate ?? (dec.model === "one_step" ? 1 : 0.3)) * 100);
  const avg = dec.avg_check ?? 0;
  const marginPct = Math.round((dec.margin ?? 0.35) * 100);
  ws.mergeCells(row, 1, row, 5);
  const a = ws.getCell(row, 1);
  a.value = `Допущения: конверсия в заявку ${crp}%, заявка в продажу ${closep}%, средний чек ${avg.toLocaleString("ru-RU")} руб${dec.avg_check_source === "estimated" ? " (оценочный)" : ""}, маржинальность ${marginPct}%. Окупаемость и ROI считаются от прибыли (выручка x маржа). Трафик масштабирован по тарифам (Старт x0.6 / Рост x1.0 / Максимум x1.3). Оценка, не гарантия.`;
  a.font = { name: FONT_FAMILY, size: FONT_SIZE, italic: true, color: { argb: COLORS.muted } };
  a.alignment = { wrapText: true, vertical: "top" };
  ws.getRow(row).height = 50;
  row += 2;

  const headers = ["", "Показатель", "Старт", "Рост", "Максимум"];
  headers.forEach((h, i) => { const c = ws.getCell(row, i + 1); c.value = h; applyHeader(c); });
  row++;

  const cases = {
    start: tariffsByKey.start ? legacyComputeCase(tariffsByKey.start, points, dec, TARIFF_SCALE.start) : null,
    growth: tariffsByKey.growth ? legacyComputeCase(tariffsByKey.growth, points, dec, TARIFF_SCALE.growth) : null,
    max: tariffsByKey.max ? legacyComputeCase(tariffsByKey.max, points, dec, TARIFF_SCALE.max) : null,
  };

  const money = '#,##0 "₽"';
  const defs = [
    ["Трафик через 12 мес, переходов/мес", c => c.traffic12, "num"],
    ["Обращения/лиды через 12 мес, /мес", c => c.leads12, "num"],
    ["Продажи через 12 мес, /мес", c => c.sales12, "num"],
    ["Выручка через 12 мес, руб/мес", c => c.revMonth12, money],
    ["Выручка за 12 мес (накопл.), руб", c => c.yearGross, money],
    [`Прибыль с маржой ${marginPct}% за 12 мес, руб`, c => c.yearProfit, money],
    ["Затраты на SEO за 12 мес, руб", c => c.yearCost, money],
    ["Чистый результат за 12 мес, руб", c => c.yearNet, money],
    ["Окупаемость (по прибыли)", c => (c.payback ? `${c.payback} мес` : "> 12 мес"), "str"],
    ["ROI за 12 мес (по прибыли), %", c => `${c.roi}%`, "str"],
  ];

  defs.forEach((d, i) => {
    const [label, getter, fmt] = d;
    const isAlt = i % 2 === 1;
    ws.mergeCells(row, 1, row, 2);
    const lc = ws.getCell(row, 1);
    lc.value = label; applyBody(lc, isAlt, false);
    ["start", "growth", "max"].forEach((k, j) => {
      const c = ws.getCell(row, j + 3);
      const cs = cases[k];
      const v = cs ? getter(cs) : "-";
      c.value = v;
      applyBody(c, isAlt, true);
      if (typeof v === "number") c.numFmt = fmt === "num" ? "#,##0" : (fmt === money ? money : "General");
    });
    row++;
  });

  ws.views = [{ state: "frozen", ySplit: 1 }];
  return true;
}

// ═══ Новый сценарный рендер (forecast_scenarios) ═══
// Для каждого тарифа (Старт/Рост/Максимум) - блок «Вход 3-6 мес» vs «Год работы» бок о бок,
// с точкой окупаемости и строкой-выводом по рекомендованному тарифу (Рост).
function writeScenarioSheet(workbook, tariffsByKey, fs) {
  const scenarios = fs.scenarios;
  const assumptions = fs.assumptions || {};
  const money = '#,##0 "₽"';

  const ws = workbook.addWorksheet("Декомпозиция и окупаемость");
  [42, 22, 22].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  let row = 1;

  ws.mergeCells(row, 1, row, 3);
  const t = ws.getCell(row, 1);
  t.value = "ДЕКОМПОЗИЦИЯ И ОКУПАЕМОСТЬ";
  t.font = { name: FONT_FAMILY, size: FONT_SIZE_TITLE, bold: true, color: { argb: COLORS.header_bg } };
  ws.getRow(row).height = 22; row++;

  ws.mergeCells(row, 1, row, 3);
  const sub = ws.getCell(row, 1);
  sub.value = `${domain} - SEO-продвижение | ${date}`;
  sub.font = { name: FONT_FAMILY, size: FONT_SIZE, color: { argb: COLORS.muted } };
  row += 2;

  // Легенда допущений (единая на оба сценария).
  const crp = Math.round((assumptions.conversion_rate ?? 0.02) * 1000) / 10;
  const closep = Math.round((assumptions.close_rate ?? (assumptions.model === "one_step" ? 1 : 0.3)) * 100);
  const avg = assumptions.avg_check ?? 0;
  const marginPct = Math.round((assumptions.margin ?? 0.35) * 100);
  ws.mergeCells(row, 1, row, 3);
  const legend = ws.getCell(row, 1);
  legend.value = `Допущения (едины на оба сценария): конверсия в заявку ${crp}%, заявка в продажу ${closep}%, средний чек ${avg.toLocaleString("ru-RU")} руб${assumptions.avg_check_source === "estimated" ? " (оценочный)" : ""}, маржинальность ${marginPct}%. ROMI считается по марже, не по выручке. Окупаемость - по накопленному кэшфлоу от прибыли. Трафик масштабирован по тарифам (Старт x0.6 / Рост x1.0 / Максимум x1.3). Оценка, не гарантия.`;
  legend.font = { name: FONT_FAMILY, size: FONT_SIZE, italic: true, color: { argb: COLORS.muted } };
  legend.alignment = { wrapText: true, vertical: "top" };
  ws.getRow(row).height = 50;
  row += 1;

  // Методики обоих сценариев.
  scenarios.forEach((sc) => {
    ws.mergeCells(row, 1, row, 3);
    const m = ws.getCell(row, 1);
    m.value = `${sc.label}${sc.recommended ? " (рекомендуем)" : ""}: ${sc.methodology_note || ""}`;
    m.font = { name: FONT_FAMILY, size: FONT_SIZE, italic: true, color: { argb: COLORS.muted } };
    m.alignment = { wrapText: true, vertical: "top" };
    ws.getRow(row).height = 34;
    row++;
  });
  row++;

  const entryScenario = scenarios.find((s) => !s.recommended) || scenarios[0];
  const yearScenario = scenarios.find((s) => s.recommended) || scenarios[scenarios.length - 1];

  const rowDefs = [
    ["Активные месяцы услуг", (r) => `${r.costMonths} мес`, "str"],
    ["Трафик к 12 мес, переходов/мес", (r) => r.traffic12, "num"],
    ["Обращения/лиды к 12 мес, /мес", (r) => r.leads12, "num"],
    ["Продажи к 12 мес, /мес", (r) => r.sales12, "num"],
    ["Выручка к 12 мес, руб/мес", (r) => r.revMonth12, money],
    ["Выручка накопл. за 12 мес, руб", (r) => r.yearGross, money],
    [`Прибыль с маржой ${marginPct}% за 12 мес, руб`, (r) => r.yearProfit, money],
    ["Затраты на SEO (разовые + N мес), руб", (r) => r.yearCost, money],
    ["Чистый результат за 12 мес, руб", (r) => r.yearNet, money],
    ["Точка окупаемости", (r) => (r.payback ? `${r.payback} мес` : "> 12 мес"), "str"],
    ["ROMI за 12 мес (по марже), %", (r) => `${r.romi}%`, "str"],
  ];

  let recoResults = null;

  for (const tariffKey of TARIFF_KEYS) {
    const tariffData = tariffsByKey[tariffKey];
    if (!tariffData) continue;
    const onetime = tariffData.total_onetime ?? 0;
    const monthly = tariffData.total_monthly ?? 0;

    const resByScenario = {};
    for (const sc of scenarios) {
      resByScenario[sc.id] = computeScenarioTariff({
        assumptions,
        checkpoints: sc.traffic_checkpoints,
        activeMonths: sc.active_months,
        tariffKey,
        onetime,
        monthly,
      });
    }

    // Заголовок блока тарифа.
    ws.mergeCells(row, 1, row, 3);
    const title = ws.getCell(row, 1);
    const isReco = tariffKey === "growth";
    title.value = `ТАРИФ «${TARIFF_NAMES[tariffKey].toUpperCase()}»${isReco ? " (рекомендованный)" : ""}`;
    title.font = { name: FONT_FAMILY, size: FONT_SIZE_SECTION, bold: true, color: { argb: COLORS.header_bg } };
    row++;

    // Заголовок таблицы блока: Показатель | <label сценария 1> | <label сценария 2>.
    const headers = ["Показатель", entryScenario.label, yearScenario.label];
    headers.forEach((h, i) => { const c = ws.getCell(row, i + 1); c.value = h; applyHeader(c); });
    row++;

    rowDefs.forEach((d, i) => {
      const [label, getter, fmt] = d;
      const isAlt = i % 2 === 1;
      const lc = ws.getCell(row, 1);
      lc.value = label; applyBody(lc, isAlt, false);
      [entryScenario, yearScenario].forEach((sc, j) => {
        const c = ws.getCell(row, j + 2);
        const r = resByScenario[sc.id];
        const v = getter(r);
        c.value = v;
        applyBody(c, isAlt, true);
        if (typeof v === "number") c.numFmt = fmt === "num" ? "#,##0" : (fmt === money ? money : "General");
      });
      row++;
    });
    row++;

    if (isReco) recoResults = { entry: resByScenario[entryScenario.id], year: resByScenario[yearScenario.id] };
  }

  // Строка-вывод по рекомендованному тарифу (Рост) - цифрами, без давления.
  if (recoResults) {
    const { entry, year } = recoResults;
    const paybackYear = year.payback ? `${year.payback} мес` : "позже 12 мес";
    const paybackEntry = entry.payback ? `${entry.payback} мес` : "позже 12 мес";
    ws.mergeCells(row, 1, row, 3);
    const summary = ws.getCell(row, 1);
    summary.value = `Рекомендуем годовой формат (тариф «Рост»): к 12 мес выручка ~${year.yearGross.toLocaleString("ru-RU")} руб против ~${entry.yearGross.toLocaleString("ru-RU")} руб, ROMI ${year.romi}% против ${entry.romi}%, окупаемость на ${paybackYear} против ${paybackEntry}.`;
    summary.font = { name: FONT_FAMILY, size: FONT_SIZE, bold: true, color: { argb: COLORS.text } };
    summary.alignment = { wrapText: true, vertical: "top" };
    summary.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.total_bg } };
    ws.getRow(row).height = 40;
    row += 2;
  }

  ws.views = [{ state: "frozen", ySplit: 1 }];
  return true;
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

// 4-я вкладка: декомпозиция и окупаемость (форматы data.json - см. writeDecompositionSheet)
const dataPath = join(strategyDir, "seo-strategiya_data.json");
if (existsSync(dataPath)) {
  try {
    const data = JSON.parse(readFileSync(dataPath, "utf8").replace(/^﻿/, ""));
    const normTariffs = {};
    for (const rawKey of Object.keys(tariffs)) {
      const ck = KEY_ALIASES[rawKey] || rawKey;
      if (KNOWN_TARIFFS.has(ck)) normTariffs[ck] = tariffs[rawKey];
    }
    const hasScenarios = !!(data.forecast_scenarios && Array.isArray(data.forecast_scenarios.scenarios) && data.forecast_scenarios.scenarios.length);
    const hasLegacy = !!(data.decomposition && Array.isArray(data.forecast) && data.forecast.length);
    const ok = writeDecompositionSheet(workbook, normTariffs, data);
    if (ok && hasScenarios) {
      console.log("[build-smeta-xlsx] added sheet: Декомпозиция и окупаемость (scenario sheet)");
    } else if (ok && hasLegacy) {
      console.log("[build-smeta-xlsx] added sheet: Декомпозиция и окупаемость (legacy sheet)");
    } else {
      console.log("[build-smeta-xlsx] decomposition skipped (no forecast_scenarios/decomposition+forecast in seo-strategiya_data.json)");
    }
  } catch (e) {
    console.warn(`[build-smeta-xlsx] decomposition skipped: ${e.message}`);
  }
} else {
  console.warn("[build-smeta-xlsx] seo-strategiya_data.json not found - decomposition sheet skipped");
}

await workbook.xlsx.writeFile(outputPath);
const finalSheetTitles = workbook.worksheets.map(ws => ws.name);
console.log(`[build-smeta-xlsx] wrote ${outputPath} (sheets: ${finalSheetTitles.join(", ")})`);
