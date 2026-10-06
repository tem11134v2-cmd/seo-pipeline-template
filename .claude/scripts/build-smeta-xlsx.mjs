#!/usr/bin/env node
// build-smeta-xlsx.mjs - смета /seo-strategiya (.xlsx). Порт исходного smeta_template.py на ExcelJS.
//
// Два пути:
// - v2 (06.10.2026): в папке есть forecast.json (build-forecast.mjs). Листы:
//     «Сравнение тарифов» (первым) / «Старт» / «Рост» / «Максимум» / «Разработка сайта» / «Окупаемость».
//   Каталог услуг - _services.mjs (названия, описания, сроки, результаты, цена разработки), прогноз -
//   _forecast-model.mjs: скрипт пересчитывает модель по forecast_inputs + tariffs.json, чтобы взять помесячные
//   трафик, множитель конверсии (прототип КФ/КНДР) и обращения из Карт. Деньги на листе «Окупаемость» считают
//   ФОРМУЛЫ от ячеек параметров (чек, конверсия, закрытие, маржа, текущий трафик): правишь параметр -
//   пересчитывается лист и «Сравнение тарифов». При исходных параметрах формулы дают те же ROMI, что forecast.json.
// - легаси: forecast.json нет - листы тарифов + 4-я вкладка «Декомпозиция и окупаемость» в старых форматах
//   данных (forecast_scenarios / decomposition+forecast) через _forecast-money.mjs. Числа не меняются.
//
// Зависимости: exceljs (уже в package.json).
//
// Использование:
//   node .claude/scripts/build-smeta-xlsx.mjs <strategy_dir>
//
// Вход:
//   <strategy_dir>/tariffs.json              - тарифы (tariff-architect): состав, цены, hint, promos, site_dev
//   <strategy_dir>/inputs.json               - домен, slug, дата
//   <strategy_dir>/forecast.json             - прогноз v2 (build-forecast.mjs); нет файла - легаси-путь
//   <strategy_dir>/seo-strategiya_data.json  - forecast_inputs (v2) / forecast_scenarios, decomposition (легаси)
// Выход:
//   <strategy_dir>/Smeta_<slug>.xlsx

import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import ExcelJS from "exceljs";
import { TARIFF_SCALE, TARIFF_KEYS, computeScenarioTariff } from "./_forecast-money.mjs";
import {
  SERVICES, LEGACY_SERVICES, CATALOG_V1, serviceMeta, canonicalId,
  DEV, devPrice, DEV_BASE_ITEMS, DEV_OPTIONS, timelineFor,
} from "./_services.mjs";
import {
  HORIZON, CAL, computeTariff, trafficSeries, tariffServiceIds, costSeries, resolveEconomics,
} from "./_forecast-model.mjs";

const strategyDirArg = process.argv[2];
if (!strategyDirArg) {
  console.error("[build-smeta-xlsx] usage: node build-smeta-xlsx.mjs <strategy_dir>");
  process.exit(1);
}
const strategyDir = resolve(strategyDirArg);

const tariffsPath = join(strategyDir, "tariffs.json");
const inputsPath = join(strategyDir, "inputs.json");
const forecastPath = join(strategyDir, "forecast.json");
const dataPath = join(strategyDir, "seo-strategiya_data.json");

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

// Нормализация клиентского текста (правило проекта, как clean() в build-strategy-docx.mjs): длинное/среднее тире
// -> дефис, буква е-с-точками -> е. v2: через нее проходит весь tariffs.json (hint, promos[].reason, price_note,
// site_dev.reason/promo_note - свободный текст агента) и строки forecast.json. Легаси-путь не трогаем (старые
// сметы пересобираются как были).
const cleanText = (s) => String(s ?? "").replace(/[—–]/g, "-").replace(/ё/g, "е").replace(/Ё/g, "Е");
function deepClean(v) {
  if (typeof v === "string") return cleanText(v);
  if (Array.isArray(v)) return v.map(deepClean);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deepClean(x)]));
  return v;
}

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
  // v2: рекомендованный тариф, акции, ячейки ввода
  reco_header: "FF548235",
  reco_bg: "FFE2F0D9",
  promo_bg: "FFFCE4D6",
  promo_text: "FFC55A11",
  input_bg: "FFFFF2CC",
  input_border: "FFBF9000",
};
const FONT_FAMILY = "Arial";
const FONT_SIZE = 10;
const FONT_SIZE_TITLE = 14;
const FONT_SIZE_SECTION = 12;

const FMT = {
  money: '#,##0 "₽"',
  money_month: '#,##0 "₽/мес"',
  money_signed: '#,##0 "₽";[Red]-#,##0 "₽"',
  int: "#,##0",
  dec1: "#,##0.0",
  mult: "0.00",
  pct: "0%",
  pct1: "0.0%",
  months: '0 "мес"',
};

const COLUMNS = ["№", "Услуга", "Описание", "Срок", "Стоимость", "Результат"];
const COL_WIDTHS = [5, 35, 45, 12, 15, 40];

const TARIFF_NAMES = {
  start: "Старт",
  growth: "Рост",
  max: "Максимум",
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

function fill(argb) {
  return { type: "pattern", pattern: "solid", fgColor: { argb } };
}

// Число в рублевом формате для текста ячейки: «3 000 ₽» (обычные пробелы, без неразрывных).
function fmtNum(n) {
  return Math.round(Number(n) || 0).toLocaleString("ru-RU").replace(/[  ]/g, " ");
}
function fmtRub(n) {
  return `${fmtNum(n)} ₽`;
}

// Грубая оценка высоты строки с переносом: символов в строке ~ ширина колонок.
function rowHeightFor(text, widthChars, lineHeight = 13, minHeight = 15) {
  const lines = String(text || "")
    .split("\n")
    .reduce((a, p) => a + Math.max(1, Math.ceil(p.length / Math.max(10, widthChars))), 0);
  return Math.max(minHeight, lines * lineHeight + 4);
}

// Буква колонки по номеру (1 -> A, 15 -> O). Листы сметы уже 26 колонок.
function colL(n) {
  return String.fromCharCode(64 + n);
}

// Заголовок листа (крупный) + подзаголовок «домен - SEO-продвижение | дата». Возврат: следующая строка.
function writeSheetTitle(ws, title, span) {
  ws.mergeCells(1, 1, 1, span);
  const t = ws.getCell(1, 1);
  t.value = title;
  t.font = { name: FONT_FAMILY, size: FONT_SIZE_TITLE, bold: true, color: { argb: COLORS.header_bg } };
  t.alignment = { horizontal: "left", vertical: "middle" };
  ws.getRow(1).height = 22;
  ws.mergeCells(2, 1, 2, span);
  const s = ws.getCell(2, 1);
  s.value = `${domain} - SEO-продвижение | ${date}`;
  s.font = { name: FONT_FAMILY, size: FONT_SIZE, color: { argb: COLORS.muted } };
  s.alignment = { horizontal: "left", vertical: "middle" };
  return 3;
}

function writeSection(ws, row, text, span) {
  ws.mergeCells(row, 1, row, span);
  const c = ws.getCell(row, 1);
  c.value = text;
  c.font = { name: FONT_FAMILY, size: FONT_SIZE_SECTION, bold: true, color: { argb: COLORS.header_bg } };
  c.alignment = { horizontal: "left", vertical: "middle" };
}

// Строка-пояснение на всю ширину (курсив, серый), с переносом.
function writeNote(ws, row, text, span, widthChars, opts = {}) {
  ws.mergeCells(row, 1, row, span);
  const c = ws.getCell(row, 1);
  c.value = text;
  c.font = { name: FONT_FAMILY, size: FONT_SIZE, italic: !opts.bold, bold: !!opts.bold, color: { argb: opts.color || COLORS.muted } };
  c.alignment = { wrapText: true, vertical: "top", horizontal: "left" };
  if (opts.fill) c.fill = fill(opts.fill);
  ws.getRow(row).height = rowHeightFor(text, widthChars);
}

// ═══ Каталог: как услуга выглядит в смете ═══
// Актуальные ID - из _services.mjs, выведенные (NG/KF/BR/YB) - легаси-названиями того времени,
// неизвестные (ручные строки вроде «Разработка сайта под SEO») - как записаны в tariffs.json.
// legacy (старая задача без forecast.json) - тексты сметы того времени (CATALOG_V1), как отдавали клиенту.
function serviceView(service, kind, legacy = false) {
  const rawId = String(service.id || service.service_code || "");
  if (legacy) {
    const sid = canonicalId(service.id);
    const v1 = CATALOG_V1[sid] || [];
    let description = service.description || v1[2] || "";
    if (service.price_note) description = description ? `${description}
- ${service.price_note}` : `- ${service.price_note}`;
    return {
      id: sid, known: !!v1.length, name: v1[0] || sid, short: v1[0] || sid, description,
      deadline: kind === "monthly" ? "-" : (service.deadline || v1[1] || "1 нед."),
      result: service.result || v1[3] || "", price: service.price ?? 0, regular: 0,
    };
  }
  const meta = serviceMeta(rawId);
  const known = !!(SERVICES[meta.id] || LEGACY_SERVICES[meta.id]);
  const price = service.price ?? 0;
  let name = known ? meta.name : (service.name || rawId);
  // «(акция - в подарок)» в названии - только когда услуга реально за 0 (старые сметы продавали ART за 3 000).
  if (known && typeof price === "number" && price > 0) name = name.replace(/\s*\(акция[^)]*\)\s*$/i, "");
  let description = service.description || meta.description || "";
  if (service.price_note) {
    description = description ? `${description}\n- ${service.price_note}` : `- ${service.price_note}`;
  }
  const deadline = kind === "monthly" ? "-" : (service.deadline || meta.deadline || "1 нед.");
  const result = service.result || meta.result || "";
  const regular = Number(service.regular_price) > 0
    ? Number(service.regular_price)
    : (service.promo && Number(meta.regular_price) > 0 ? Number(meta.regular_price) : 0);
  const short = (known && meta.short) || name;
  return { id: meta.id, known, name, short, description, deadline, result, price, regular };
}

// Акция «ПФ 1=2» тарифа: сумма скидки во 2-й мес (как в costSeries модели), 0 - акции нет.
function pfPromo(tariffData) {
  const p = ((tariffData && tariffData.promos) || []).find((x) => x && x.type === "pf_2for1");
  if (!p) return null;
  const pf = ((tariffData.monthly) || []).find((s) => s && (s.id === "PF" || s.id === "PFP"));
  const a = typeof p.amount === "number" ? p.amount : parseFloat(p.amount);
  const pfPrice = pf ? parseFloat(pf.price) : NaN;
  const amount = Number.isFinite(a) ? a : (Number.isFinite(pfPrice) ? pfPrice : 0);
  // Нечего дарить (в тарифе нет PF/PFP) - акции нет: иначе клиент увидит «-0 ₽ во 2-й мес». build-forecast.mjs
  // такой тариф не пропускает (ПРАВИЛА ТАРИФОВ), здесь - страховка с предупреждением.
  if (!(amount > 0)) {
    promoWarned.add(`[build-smeta-xlsx] ВНИМАНИЕ: акция «ПФ 1=2» в тарифе без PF/PFP (скидка 0) - строка акции не выведена`);
    return null;
  }
  return { amount, reason: p.reason || "" };
}
const promoWarned = new Set();

function sumNumericPrices(list) {
  return (list || []).reduce((a, s) => a + (typeof (s && s.price) === "number" ? s.price : 0), 0);
}

function plural(n, one, few, many) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

// Срок разовых работ: deadline_total тарифа или по цепочке PA -> SY -> KP -> FQ (timelineFor).
function onetimeDeadline(tariffData) {
  if (tariffData.deadline_total) return tariffData.deadline_total;
  const ids = (tariffData.onetime || []).map((s) => s && s.id).filter(Boolean);
  if (!ids.length) return "разовых работ нет";
  const weeks = timelineFor(ids)
    .filter((t) => !t.monthly)
    .reduce((a, t) => Math.max(a, t.start_week + t.weeks), 0);
  if (!weeks) return "1-3 недели";
  return `около ${weeks} ${plural(weeks, "недели", "недель", "недель")} с учетом ответов заказчика`;
}

// ═══ Запись вкладки тарифа ═══
// opts.v2 - строка «Почему этот вариант», пометка рекомендованного, порядок оплаты с акцией ПФ 1=2 и итогом
// за 12 мес. Без v2 - раскладка как в легаси (числа и порядок строк старых смет не меняются).
function writeTariffSheet(workbook, tariffKey, tariffData, opts = {}) {
  const v2 = !!opts.v2;
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
  titleCell.value = `СМЕТА - ТАРИФ «${name.toUpperCase()}»${v2 && opts.recommended ? " (РЕКОМЕНДУЕМ)" : ""}`;
  titleCell.font = { name: FONT_FAMILY, size: FONT_SIZE_TITLE, bold: true, color: { argb: v2 && opts.recommended ? COLORS.reco_header : COLORS.header_bg } };
  titleCell.alignment = { horizontal: "left", vertical: "middle" };
  ws.getRow(row).height = 22;
  row++;

  ws.mergeCells(row, 1, row, 6);
  const subCell = ws.getCell(row, 1);
  subCell.value = `${domain} - SEO-продвижение | ${date}`;
  subCell.font = { name: FONT_FAMILY, size: FONT_SIZE, color: { argb: COLORS.muted } };
  subCell.alignment = { horizontal: "left", vertical: "middle" };

  // v2: «Почему этот вариант» из hint (под шапкой)
  if (v2 && tariffData.hint) {
    row++;
    ws.mergeCells(row, 1, row, 6);
    const h = ws.getCell(row, 1);
    h.value = {
      richText: [
        { font: { name: FONT_FAMILY, size: FONT_SIZE, bold: true, color: { argb: COLORS.header_bg } }, text: "Почему этот вариант: " },
        { font: { name: FONT_FAMILY, size: FONT_SIZE, color: { argb: COLORS.text } }, text: String(tariffData.hint) },
      ],
    };
    h.alignment = { wrapText: true, vertical: "top", horizontal: "left" };
    if (opts.recommended) h.fill = fill(COLORS.reco_bg);
    ws.getRow(row).height = rowHeightFor(`Почему этот вариант: ${tariffData.hint}`, 140);
  }
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

  const writeServiceRow = (service, i, kind) => {
    const sv = serviceView(service, kind, !v2);
    const isAlt = i % 2 === 1;
    const values = [i + 1, sv.name, sv.description, sv.deadline, sv.price, sv.result];
    const isPromoPrice = typeof sv.price === "number" && sv.price === 0 && sv.regular > 0;
    values.forEach((v, j) => {
      const c = ws.getCell(row, j + 1);
      c.value = v;
      applyBody(c, isAlt, !(j === 1 || j === 2 || j === 5));
      if (j === 4) {
        // колонка Стоимость
        if (typeof v === "number" && v === 0) {
          // акция: обычная цена текстом, в SUM идет 0 (текст суммой не учитывается)
          c.value = isPromoPrice ? `${fmtRub(sv.regular)} -> 0 ₽ (акция)` : "бесплатно";
          c.numFmt = "@";
          if (isPromoPrice) {
            c.font = { name: FONT_FAMILY, size: FONT_SIZE, bold: true, color: { argb: COLORS.promo_text } };
            c.fill = fill(COLORS.promo_bg);
          }
        } else if (typeof v === "number") {
          c.numFmt = kind === "monthly" ? '#,##0 "₽/мес"' : '#,##0 "₽"';
        }
      }
    });
    row++;
  };

  const onetimeStartRow = row;
  const onetimeServices = tariffData.onetime || [];
  onetimeServices.forEach((service, i) => writeServiceRow(service, i, "onetime"));
  const onetimeEndRow = row - 1;

  // Итого разовые
  ws.mergeCells(row, 1, row, 4);
  const onetimeLabel = ws.getCell(row, 1);
  onetimeLabel.value = "ИТОГО разовые работы";
  applyTotal(onetimeLabel);

  const onetimeSum = sumNumericPrices(onetimeServices);
  const onetimeTotalCell = ws.getCell(row, 5);
  if (onetimeServices.length > 0) {
    onetimeTotalCell.value = v2
      ? { formula: `SUM(E${onetimeStartRow}:E${onetimeEndRow})`, result: onetimeSum }
      : { formula: `SUM(E${onetimeStartRow}:E${onetimeEndRow})` };
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
  monthlyServices.forEach((service, i) => writeServiceRow(service, i, "monthly"));
  const monthlyEndRow = row - 1;

  // Акция «ПФ 1=2» - отдельной строкой в блоке ежемесячных, вне диапазона SUM (стоимость текстом).
  const promo = pfPromo(tariffData);
  if (promo) {
    const vals = [
      "",
      "Акция: второй месяц внешнего продвижения в подарок",
      promo.reason ? `Акция «ПФ 1=2»: ${promo.reason}` : "Акция «ПФ 1=2»: оплачиваете первый месяц внешнего продвижения, второй - бесплатно",
      "2-й мес",
      `-${fmtRub(promo.amount)} во 2-й мес`,
      "Затраты второго месяца меньше на стоимость внешнего продвижения",
    ];
    vals.forEach((v, j) => {
      const c = ws.getCell(row, j + 1);
      c.value = v;
      applyBody(c, false, !(j === 1 || j === 2 || j === 5));
      c.fill = fill(COLORS.promo_bg);
      c.font = { name: FONT_FAMILY, size: FONT_SIZE, bold: j === 1 || j === 4, color: { argb: j === 4 ? COLORS.promo_text : COLORS.text } };
      if (j === 4) c.numFmt = "@";
    });
    ws.getRow(row).height = rowHeightFor(vals[2], 45);
    row++;
  }

  // Итого ежемесячно
  ws.mergeCells(row, 1, row, 4);
  const monthlyLabel = ws.getCell(row, 1);
  monthlyLabel.value = "ИТОГО ежемесячно";
  applyTotal(monthlyLabel);

  const monthlySum = sumNumericPrices(monthlyServices);
  const monthlyTotalCell = ws.getCell(row, 5);
  if (monthlyServices.length > 0) {
    monthlyTotalCell.value = v2
      ? { formula: `SUM(E${monthlyStartRow}:E${monthlyEndRow})`, result: monthlySum }
      : { formula: `SUM(E${monthlyStartRow}:E${monthlyEndRow})` };
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

  const writeOrderLine = (line) => {
    ws.mergeCells(row, 1, row, 4);
    const labelCell = ws.getCell(row, 1);
    labelCell.value = line.label;
    labelCell.font = { name: FONT_FAMILY, size: FONT_SIZE, bold: !!line.bold, color: { argb: line.promo ? COLORS.promo_text : COLORS.text } };
    labelCell.alignment = { horizontal: "left", vertical: "middle" };

    const valCell = ws.getCell(row, 5);
    if (line.formula) {
      valCell.value = line.result !== undefined ? { formula: line.formula, result: line.result } : { formula: line.formula };
    } else {
      valCell.value = line.value;
    }
    valCell.font = { name: FONT_FAMILY, size: FONT_SIZE, bold: true, color: { argb: line.promo ? COLORS.promo_text : COLORS.text } };
    if (line.fmt) valCell.numFmt = line.fmt;
    if (line.highlight) {
      labelCell.fill = fill(COLORS.total_bg);
      valCell.fill = fill(COLORS.total_bg);
    }
    row++;
  };

  if (!v2) {
    // Легаси-раскладка (как в отданных сметах).
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
    orderLines.forEach((line) => writeOrderLine({ ...line, bold: false }));

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
  } else {
    // v2: ежемесячные идут с первого месяца (как в модели затрат costSeries), акция ПФ 1=2 - минус во 2-й мес.
    const E1 = `E${onetimeTotalRow}`, EM = `E${monthlyTotalRow}`;
    const promoAmt = promo ? promo.amount : 0;
    writeOrderLine({ label: "Этап 1 (старт): разовые работы", formula: E1, result: onetimeSum, fmt: FMT.money });
    writeOrderLine({ label: "Срок выполнения разовых работ", value: onetimeDeadline(tariffData) });
    writeOrderLine({ label: "Этап 2 (ежемесячно): после старта", formula: EM, result: monthlySum, fmt: FMT.money_month });
    if (promo) {
      writeOrderLine({
        label: "Акция «ПФ 1=2»: второй месяц ежемесячных работ",
        formula: `MAX(0,${EM}-${promoAmt})`, result: Math.max(0, monthlySum - promoAmt), fmt: FMT.money, promo: true,
      });
    }
    row++;
    writeOrderLine({ label: "Итого за 1-й месяц (разовые + ежемесячные)", formula: `${E1}+${EM}`, result: onetimeSum + monthlySum, fmt: FMT.money, bold: true });
    writeOrderLine({ label: "Далее ежемесячно", formula: EM, result: monthlySum, fmt: FMT.money_month, bold: true });
    writeOrderLine({
      label: promo ? "Итого за 12 месяцев (с учетом акции)" : "Итого за 12 месяцев",
      formula: promo ? `${E1}+12*${EM}-${promoAmt}` : `${E1}+12*${EM}`,
      result: onetimeSum + 12 * monthlySum - promoAmt,
      fmt: FMT.money, bold: true, highlight: true,
    });
  }

  // Зафиксируй первую строку (название тарифа)
  ws.views = [{ state: "frozen", ySplit: 1 }];

  return { ws, name, onetimeTotalRow, monthlyTotalRow, onetimeSum, monthlySum };
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

// ═══════════════════════════════════════════════════════════════════════════
// v2 (forecast.json): модель, «Окупаемость», «Разработка сайта», «Сравнение тарифов»
// ═══════════════════════════════════════════════════════════════════════════

// Пересчет модели по текущим тарифам: forecast_inputs (data.json) + экономика, уже разрешенная
// build-forecast.mjs (клиентские значения поверх оценок) - forecast.json.inputs.economics.
function buildModel(fc, data, tariffsByKey) {
  const fiSrc = data && data.forecast_inputs && typeof data.forecast_inputs === "object" ? data.forecast_inputs : null;
  const fi = JSON.parse(JSON.stringify(fiSrc || fc.inputs || {}));
  if (fc.inputs && fc.inputs.economics) fi.economics = { ...fc.inputs.economics };
  if (fc.inputs && Number.isFinite(Number(fc.inputs.t0))) fi.t0 = Number(fc.inputs.t0);
  const models = {};
  for (const k of TARIFF_KEYS) {
    const t = tariffsByKey[k];
    if (!t) continue;
    const ts = trafficSeries(fi, tariffServiceIds(t), HORIZON);
    models[k] = { ts, cost: costSeries(t, HORIZON), res: computeTariff(fi, t, HORIZON) };
  }
  return { fi, econ: resolveEconomics(fi), models, fiSource: fiSrc ? "forecast_inputs" : "forecast.json inputs" };
}

// forecast.json против пересчета: расхождение = прогноз собран по другим тарифам/входам.
function staleCheck(fc, models) {
  const msgs = [];
  for (const k of TARIFF_KEYS) {
    const f = fc.tariffs && fc.tariffs[k];
    const md = models[k];
    if (!f && !md) continue;
    if (!f) { msgs.push(`${TARIFF_NAMES[k]}: тариф есть в tariffs.json, но нет в forecast.json`); continue; }
    if (!md) { msgs.push(`${TARIFF_NAMES[k]}: тариф есть в forecast.json, но нет в tariffs.json`); continue; }
    const r = md.res;
    if (f.year1 && (f.year1.romi !== r.year1.romi || f.year1.cost !== r.year1.cost)) {
      msgs.push(`${TARIFF_NAMES[k]}: ROMI 12 мес ${f.year1.romi}% / затраты ${f.year1.cost} в forecast.json, пересчет ${r.year1.romi}% / ${r.year1.cost}`);
    }
    const bad = (f.months || []).find((x, i) => r.months[i] && Math.round(r.months[i].traffic_commercial) !== x.traffic_commercial);
    if (bad) msgs.push(`${TARIFF_NAMES[k]}: трафик мес ${bad.m} в forecast.json ${bad.traffic_commercial}, пересчет ${Math.round(r.months[bad.m - 1].traffic_commercial)}`);
  }
  return msgs;
}

// Помесячные входы таблицы тарифа (значения модели): мес 1..12 + агрегаты 2-го года (мес 13-24).
// Множитель конверсии 2-го года - средневзвешенный по коммерческому трафику: тогда формула
// (ком x множ - 12 x m0) x конв по агрегатам дает ровно сумму обращений мес 13-24.
function blockInputs(md) {
  const months = [];
  for (let m = 1; m <= 12; m++) {
    const t = md.ts[m];
    months.push({ m, kom: t.commercial, info: t.info, mult: t.conv_mult, maps: t.maps_leads, cost: md.cost[m] });
  }
  let kom = 0, komMult = 0, info = 0, maps = 0, cost = 0;
  for (let m = 13; m <= HORIZON; m++) {
    const t = md.ts[m];
    kom += t.commercial; komMult += t.commercial * t.conv_mult; info += t.info; maps += t.maps_leads; cost += md.cost[m];
  }
  const y2 = { kom, info, mult: kom > 0 ? komMult / kom : 1, maps, cost, months: HORIZON - 12 };
  return { months, y2 };
}

// Те же формулы, что пишутся в ячейки, - на JS: кэш значений (result) для просмотрщиков без пересчета
// и самопроверка против forecast.json.
function evalBlock(bi, p) {
  const leadsOf = (kom, mult, info, maps, m0) => Math.max(0, (kom * mult - m0) * p.conv + info * p.conv * p.k + maps);
  const rows = [];
  let cum = 0;
  const y1 = { kom: 0, info: 0, gain: 0, maps: 0, leads: 0, sales: 0, revenue: 0, profit: 0, cost: 0, komMult: 0 };
  let payback = null;
  for (const x of bi.months) {
    const gain = x.kom + x.info - p.m0;
    const leads = leadsOf(x.kom, x.mult, x.info, x.maps, p.m0);
    const sales = leads * p.close;
    const revenue = sales * p.check;
    const profit = revenue * p.margin;
    cum += profit - x.cost;
    if (payback === null && cum >= 0) payback = x.m;
    const r = { ...x, gain, leads, sales, revenue, profit, cum };
    rows.push(r);
    for (const k of ["kom", "info", "gain", "maps", "leads", "sales", "revenue", "profit", "cost"]) y1[k] += r[k];
    y1.komMult += x.kom * x.mult;
  }
  y1.mult = y1.kom > 0 ? y1.komMult / y1.kom : 1;
  y1.cum = y1.profit - y1.cost;
  const b = bi.y2;
  const y2 = { kom: b.kom, info: b.info, mult: b.mult, maps: b.maps, cost: b.cost };
  y2.gain = b.kom + b.info - b.months * p.m0;
  y2.leads = leadsOf(b.kom, b.mult, b.info, b.maps, b.months * p.m0);
  y2.sales = y2.leads * p.close;
  y2.revenue = y2.sales * p.check;
  y2.profit = y2.revenue * p.margin;
  y2.cum = y1.cum + y2.profit - y2.cost;
  const romi12 = y1.cost > 0 ? (y1.profit - y1.cost) / y1.cost : 0;
  const romi24 = y1.cost + y2.cost > 0 ? (y1.profit + y2.profit - y1.cost - y2.cost) / (y1.cost + y2.cost) : 0;
  const paybackText = payback !== null ? payback : (y2.cum >= 0 ? "на 2-м году" : "> 24 мес");
  return { rows, y1, y2, romi12, romi24, payback: paybackText };
}

const SOURCE_LABEL = {
  client: "клиент",
  site: "с сайта клиента",
  estimated: "оценка по нише",
  missing: "не задан - уточните у клиента",
};
const T0_SOURCE_LABEL = {
  metrika: "Яндекс Метрика",
  keyso: "оценка по Keyso",
  estimated: "оценка",
};

// ─── Лист «Окупаемость» ───
// Колонки: A - показатель, B..M - мес 1..12, N - итого год 1, O - год 2 (мес 13-24, агрегаты).
function writePaybackSheet(ws, ctx) {
  const { econ, fc, models, recommended } = ctx;
  const LAST = 15;
  const NCOL = 14, OCOL = 15;
  ws.getColumn(1).width = 44;
  for (let c = 2; c <= 13; c++) ws.getColumn(c).width = 12;
  ws.getColumn(NCOL).width = 15;
  ws.getColumn(OCOL).width = 17;

  let row = writeSheetTitle(ws, "ОКУПАЕМОСТЬ ПО ТАРИФАМ", LAST);
  writeNote(ws, row, "Желтые ячейки - параметры экономики: поменяйте их, и пересчитается весь лист и вкладка «Сравнение тарифов». Трафик, обращения из Карт и затраты по месяцам - из прогноза по составу каждого тарифа; обращения, продажи, выручка и прибыль считаются формулами.", LAST, 200);
  row += 2;

  // ── Параметры ──
  writeSection(ws, row, "Параметры экономики", LAST);
  row++;
  const fromClient = new Set((fc.inputs && fc.inputs.economics_from_client) || []);
  const typeNote = `оценка по типу бизнеса (${econ.business_type})`;
  const params = [
    { key: "check", label: "Средний чек, ₽", value: econ.avg_check, fmt: FMT.money,
      source: SOURCE_LABEL[econ.avg_check_source] || econ.avg_check_source || "оценка" },
    { key: "conv", label: econ.model === "one_step" ? "Конверсия визит -> заказ" : "Конверсия визит -> обращение", value: econ.conversion_rate, fmt: FMT.pct1,
      source: fromClient.has("conversion_rate") ? "клиент" : econ.model === "one_step" ? typeNote : `${typeNote}; в кейсах агентства медиана 9,1% по целям Метрики - берем с запасом` },
    { key: "close", label: econ.model === "one_step" ? "Заказ -> оплата" : "Обращение -> продажа", value: econ.close_rate, fmt: FMT.pct,
      source: fromClient.has("close_rate") ? "клиент" : typeNote },
    { key: "margin", label: "Маржинальность (валовая прибыль с выручки)", value: econ.margin, fmt: FMT.pct,
      source: fromClient.has("margin") ? "клиент" : typeNote },
    { key: "m0", label: "Текущий трафик из поиска (m0), визитов в мес", value: Number(fc.inputs && fc.inputs.t0) || 0, fmt: FMT.int,
      source: `${T0_SOURCE_LABEL[fc.inputs && fc.inputs.t0_source] || "оценка"}; деньги считаются только с прироста над этим уровнем (трафик по месяцам - из прогноза, от правки не меняется)` },
    { key: "k", label: "Множитель конверсии трафика статей", value: CAL.info_conv_factor, fmt: FMT.mult,
      source: "методика: читатели статей обращаются реже, чем посетители страниц услуг" },
  ];
  const P = {}, PV = {};
  for (const p of params) {
    const lc = ws.getCell(row, 1);
    lc.value = p.label;
    applyBody(lc, false, false);
    lc.font = { name: FONT_FAMILY, size: FONT_SIZE, bold: true, color: { argb: COLORS.text } };
    const vc = ws.getCell(row, 2);
    vc.value = p.value;
    vc.numFmt = p.fmt;
    vc.font = { name: FONT_FAMILY, size: FONT_SIZE, bold: true, color: { argb: COLORS.text } };
    vc.fill = fill(COLORS.input_bg);
    vc.border = {
      top: { style: "thin", color: { argb: COLORS.input_border } },
      left: { style: "thin", color: { argb: COLORS.input_border } },
      bottom: { style: "thin", color: { argb: COLORS.input_border } },
      right: { style: "thin", color: { argb: COLORS.input_border } },
    };
    vc.alignment = { horizontal: "center", vertical: "middle" };
    ws.mergeCells(row, 3, row, LAST);
    const sc = ws.getCell(row, 3);
    sc.value = `Источник: ${p.source}`;
    sc.font = { name: FONT_FAMILY, size: FONT_SIZE, italic: true, color: { argb: COLORS.muted } };
    sc.alignment = { horizontal: "left", vertical: "middle" };
    P[p.key] = `$B$${row}`;
    PV[p.key] = p.value;
    row++;
  }
  row++;

  // ── Таблицы по тарифам ──
  const refs = {};
  const evals = {};
  const B = (c) => colL(c);
  for (const k of TARIFF_KEYS) {
    const md = models[k];
    if (!md) continue;
    const isReco = k === recommended;
    const bi = blockInputs(md);
    const ev = evalBlock(bi, PV);
    evals[k] = ev;

    // Заголовок блока
    ws.mergeCells(row, 1, row, LAST);
    const tc = ws.getCell(row, 1);
    tc.value = `ТАРИФ «${TARIFF_NAMES[k].toUpperCase()}»${isReco ? " (РЕКОМЕНДУЕМ)" : ""}`;
    tc.font = { name: FONT_FAMILY, size: FONT_SIZE_SECTION, bold: true, color: { argb: isReco ? COLORS.reco_header : COLORS.header_bg } };
    if (isReco) tc.fill = fill(COLORS.reco_bg);
    row++;

    const headers = ["Показатель"];
    for (let m = 1; m <= 12; m++) headers.push(`Мес ${m}`);
    headers.push("Итого год 1", "Год 2 (мес 13-24)");
    headers.forEach((h, i) => {
      const c = ws.getCell(row, i + 1);
      c.value = h;
      applyHeader(c);
      if (isReco) c.fill = fill(COLORS.reco_header);
    });
    row++;

    // Номера строк блока
    const R = {};
    const order = ["kom", "info", "gain", "mult", "maps", "leads", "sales", "revenue", "profit", "cost", "cum", "help"];
    order.forEach((key, i) => { R[key] = row + i; });
    const LABELS = {
      kom: "Трафик на страницы услуг (коммерческий), визитов",
      info: "Трафик на статьи, визитов",
      gain: "Прирост трафика к сегодняшнему, визитов",
      mult: "Множитель конверсии (прототип КФ/КНДР)",
      maps: "Обращения из Яндекс Карт",
      // Деньги - только с прироста: обращения, продажи и выручка здесь - СВЕРХ текущего уровня (m0), не итог.
      leads: "Дополнительные обращения (сверх текущих)",
      sales: "Дополнительные продажи",
      revenue: "Дополнительная выручка, ₽",
      profit: "Валовая прибыль с прироста, ₽",
      cost: "Затраты на продвижение (с акциями), ₽",
      cum: "Результат нарастающим итогом, ₽",
      help: "служебная: месяц, когда итог >= 0",
    };
    const ROW_FMT = {
      kom: FMT.int, info: FMT.int, gain: FMT.int, mult: FMT.mult, maps: FMT.dec1, leads: FMT.dec1, sales: FMT.dec1,
      revenue: FMT.money, profit: FMT.money, cost: FMT.money, cum: FMT.money_signed, help: "0",
    };
    const BOLD = new Set(["leads", "profit", "cum"]);

    order.forEach((key, i) => {
      const r = R[key];
      const isAlt = i % 2 === 1;
      const lc = ws.getCell(r, 1);
      lc.value = LABELS[key];
      applyBody(lc, isAlt, false);
      if (BOLD.has(key)) lc.font = { name: FONT_FAMILY, size: FONT_SIZE, bold: true, color: { argb: COLORS.text } };

      for (let m = 1; m <= 12; m++) {
        const col = m + 1, L = B(col), prevL = B(col - 1);
        const x = ev.rows[m - 1];
        let v;
        switch (key) {
          case "kom": v = x.kom; break;
          case "info": v = x.info; break;
          case "gain": v = { formula: `${L}${R.kom}+${L}${R.info}-${P.m0}`, result: x.gain }; break;
          case "mult": v = x.mult; break;
          case "maps": v = x.maps; break;
          case "leads": v = { formula: `MAX(0,(${L}${R.kom}*${L}${R.mult}-${P.m0})*${P.conv}+${L}${R.info}*${P.conv}*${P.k}+${L}${R.maps})`, result: x.leads }; break;
          case "sales": v = { formula: `${L}${R.leads}*${P.close}`, result: x.sales }; break;
          case "revenue": v = { formula: `${L}${R.sales}*${P.check}`, result: x.revenue }; break;
          case "profit": v = { formula: `${L}${R.revenue}*${P.margin}`, result: x.profit }; break;
          case "cost": v = x.cost; break;
          case "cum": v = { formula: m === 1 ? `${L}${R.profit}-${L}${R.cost}` : `${prevL}${R.cum}+${L}${R.profit}-${L}${R.cost}`, result: x.cum }; break;
          case "help": v = { formula: `IF(${L}${R.cum}>=0,${m},"")`, result: x.cum >= 0 ? m : "" }; break;
        }
        const c = ws.getCell(r, col);
        c.value = v;
        applyBody(c, isAlt, true);
        c.numFmt = ROW_FMT[key];
        if (BOLD.has(key)) c.font = { name: FONT_FAMILY, size: FONT_SIZE, bold: true, color: { argb: COLORS.text } };
      }

      // Итого год 1 (N) и год 2 (O)
      const rng = (rr) => `B${rr}:M${rr}`;
      let nv, ov;
      const y1 = ev.y1, y2 = ev.y2;
      switch (key) {
        case "kom": case "info": case "gain": case "maps": case "leads": case "sales": case "revenue": case "profit": case "cost":
          nv = { formula: `SUM(${rng(r)})`, result: y1[key] };
          break;
        case "mult":
          nv = { formula: `IF(SUM(${rng(R.kom)})>0,SUMPRODUCT(${rng(R.kom)},${rng(R.mult)})/SUM(${rng(R.kom)}),1)`, result: y1.mult };
          break;
        case "cum": nv = { formula: `N${R.profit}-N${R.cost}`, result: y1.cum }; break;
        default: nv = "";
      }
      switch (key) {
        case "kom": ov = y2.kom; break;
        case "info": ov = y2.info; break;
        case "gain": ov = { formula: `O${R.kom}+O${R.info}-${HORIZON - 12}*${P.m0}`, result: y2.gain }; break;
        case "mult": ov = y2.mult; break;
        case "maps": ov = y2.maps; break;
        case "leads": ov = { formula: `MAX(0,(O${R.kom}*O${R.mult}-${HORIZON - 12}*${P.m0})*${P.conv}+O${R.info}*${P.conv}*${P.k}+O${R.maps})`, result: y2.leads }; break;
        case "sales": ov = { formula: `O${R.leads}*${P.close}`, result: y2.sales }; break;
        case "revenue": ov = { formula: `O${R.sales}*${P.check}`, result: y2.revenue }; break;
        case "profit": ov = { formula: `O${R.revenue}*${P.margin}`, result: y2.profit }; break;
        case "cost": ov = y2.cost; break;
        case "cum": ov = { formula: `N${R.cum}+O${R.profit}-O${R.cost}`, result: y2.cum }; break;
        default: ov = "";
      }
      [[NCOL, nv], [OCOL, ov]].forEach(([col, v]) => {
        const c = ws.getCell(r, col);
        c.value = v;
        applyTotal(c, ROW_FMT[key]);
        c.alignment = { horizontal: "center", vertical: "middle" };
      });
    });
    ws.getRow(R.help).hidden = true;
    row = R.help + 1;

    // Итоги под таблицей
    const summary = [
      { key: "romi12", label: "ROMI за 12 мес", formula: `IF(N${R.cost}>0,(N${R.profit}-N${R.cost})/N${R.cost},0)`, result: ev.romi12, fmt: FMT.pct,
        note: "(валовая прибыль за год - затраты за год) / затраты за год" },
      { key: "payback", label: "Окупаемость, мес", formula: `IF(COUNT(B${R.help}:M${R.help})>0,MIN(B${R.help}:M${R.help}),IF(O${R.cum}>=0,"на 2-м году","> 24 мес"))`, result: ev.payback, fmt: FMT.months,
        note: "первый месяц, когда результат нарастающим итогом стал не меньше нуля" },
      { key: "romi24", label: "ROMI за 24 мес", formula: `IF(N${R.cost}+O${R.cost}>0,(N${R.profit}+O${R.profit}-N${R.cost}-O${R.cost})/(N${R.cost}+O${R.cost}),0)`, result: ev.romi24, fmt: FMT.pct,
        note: "второй год: работы продолжаются, сделанное за первый год держится" },
    ];
    const sref = {};
    for (const s of summary) {
      const lc = ws.getCell(row, 1);
      lc.value = s.label;
      applyTotal(lc);
      if (isReco) lc.fill = fill(COLORS.reco_bg);
      const vc = ws.getCell(row, 2);
      vc.value = { formula: s.formula, result: s.result };
      applyTotal(vc, s.fmt);
      vc.alignment = { horizontal: "center", vertical: "middle" };
      if (isReco) vc.fill = fill(COLORS.reco_bg);
      ws.mergeCells(row, 3, row, LAST);
      const nc = ws.getCell(row, 3);
      nc.value = s.note;
      nc.font = { name: FONT_FAMILY, size: FONT_SIZE, italic: true, color: { argb: COLORS.muted } };
      nc.alignment = { horizontal: "left", vertical: "middle" };
      sref[s.key] = row;
      row++;
    }
    refs[k] = { ...R, ...sref };
    row++;
  }

  // ── Методика ──
  writeSection(ws, row, "Методика", LAST);
  row++;
  if (fc.assumptions_note) {
    writeNote(ws, row, fc.assumptions_note, LAST, 200);
    row++;
  }
  const cal = fc.calibration_ref || {};
  writeNote(ws, row,
    `Прогноз трафика - модель по составу тарифа: внешнее продвижение и техника ускоряют существующие страницы, структура и тексты дают новые страницы под спрос, прототип КФ/КНДР поднимает конверсию, Карты дают прямые обращения, статьи - накопительный трафик. Калибровка: ${cal.source || "кейсы агентства cases.timur-seo.ru"}. Обращения из Карт не зависят от конверсии сайта.`,
    LAST, 200);
  row++;

  ws.views = [{ state: "frozen", xSplit: 1 }];
  return { refs, evals, params: PV };
}

// ─── Лист «Разработка сайта» ───
function writeDevSheet(ws, ctx) {
  const { siteDev, kpTariffs } = ctx;
  const LAST = 4;
  [6, 64, 20, 52].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  let row = writeSheetTitle(ws, "РАЗРАБОТКА САЙТА ПОД КЛЮЧ", LAST);

  // Пометка «Рекомендуем» / «По запросу»
  const mark = siteDev.recommended
    ? `РЕКОМЕНДУЕМ${siteDev.reason ? `: ${siteDev.reason}` : ""}`
    : `ПО ЗАПРОСУ (справочно)${siteDev.reason ? `: ${siteDev.reason}` : ": если решите обновить или пересобрать сайт"}`;
  writeNote(ws, row, mark, LAST, 130, {
    bold: true,
    color: siteDev.recommended ? COLORS.reco_header : COLORS.muted,
    fill: siteDev.recommended ? COLORS.reco_bg : COLORS.row_alt,
  });
  row++;

  const dp = devPrice(siteDev);
  const fmtLabel = dp.format === "landing"
    ? `Лендинг (одностраничный сайт): главная из ${dp.home_blocks} блоков`
    : `Многостраничный сайт: главная из ${dp.home_blocks} блоков + ${dp.pages} ${plural(dp.pages, "подстраница", "подстраницы", "подстраниц")}` +
      (dp.pages_over_max ? ` (по плану ${dp.pages_requested}: страницы сверх ${DEV.pages_max} - по расчету, в итог не входят)` : "");
  writeNote(ws, row, `Формат: ${fmtLabel}. Срок: ${DEV.deadline[dp.format]}.`, LAST, 130, { bold: true, color: COLORS.text });
  row += 2;

  // ── База ──
  writeSection(ws, row, "Стоимость базы", LAST);
  row++;
  ["№", "Состав", "Стоимость", "Как считается"].forEach((h, i) => { const c = ws.getCell(row, i + 1); c.value = h; applyHeader(c); });
  row++;
  const tiersNote = DEV.page_tiers
    .map((t, i) => `${i === 0 ? 1 : DEV.page_tiers[i - 1].upTo + 1}-${t.upTo} стр. по ${fmtRub(t.rate)}`)
    .join(", ");
  const partNotes = [
    `${fmtRub(DEV.block_price)} за блок главной`,
    "живой прототип с текстами - видите сайт до дизайна",
    `ступени: ${tiersNote} (ставка на весь объем, не дешевле верхней границы предыдущей ступени)`,
  ];
  const baseStart = row;
  let protoRow = null;
  dp.parts.forEach((p, i) => {
    const isAlt = i % 2 === 1;
    const vals = [i + 1, p.label, p.price, partNotes[i] || ""];
    vals.forEach((v, j) => {
      const c = ws.getCell(row, j + 1);
      c.value = v;
      applyBody(c, isAlt, j === 0 || j === 2);
      if (j === 2) c.numFmt = FMT.money;
    });
    if (/Прототип/i.test(p.label)) protoRow = row;
    row++;
  });
  const baseEnd = row - 1;
  ws.mergeCells(row, 1, row, 2);
  const tl = ws.getCell(row, 1);
  tl.value = "ИТОГО разработка (база)";
  applyTotal(tl);
  const tv = ws.getCell(row, 3);
  tv.value = { formula: `SUM(C${baseStart}:C${baseEnd})`, result: dp.total };
  applyTotal(tv, FMT.money);
  tv.alignment = { horizontal: "center", vertical: "middle" };
  applyTotal(ws.getCell(row, 4));
  ws.getCell(row, 4).value = DEV.deadline[dp.format];
  const totalRow = row;
  row++;

  // Зачет прототипа, если KP уже в тарифе
  if (kpTariffs.length && protoRow) {
    const names = kpTariffs.map((k) => `«${TARIFF_NAMES[k]}»`).join(" или ");
    const zl = `Если вместе с тарифом ${names}: прототип с текстами уже в тарифе - разработка дешевле на ${fmtRub(dp.prototype_price)}`;
    ws.mergeCells(row, 1, row, 2);
    const zc = ws.getCell(row, 1);
    zc.value = zl;
    applyBody(zc, false, false);
    zc.fill = fill(COLORS.reco_bg);
    const zv = ws.getCell(row, 3);
    zv.value = { formula: `-C${protoRow}`, result: -dp.prototype_price };
    applyBody(zv, false, true);
    zv.fill = fill(COLORS.reco_bg);
    zv.numFmt = FMT.money_signed;
    applyBody(ws.getCell(row, 4), false, false);
    ws.getCell(row, 4).fill = fill(COLORS.reco_bg);
    ws.getCell(row, 4).value = "этап прототипа не дублируется";
    ws.getRow(row).height = rowHeightFor(zl, 70);
    const zRow = row;
    row++;
    ws.mergeCells(row, 1, row, 2);
    const il = ws.getCell(row, 1);
    il.value = `ИТОГО разработка вместе с тарифом ${names}`;
    applyTotal(il);
    il.fill = fill(COLORS.reco_bg);
    const iv = ws.getCell(row, 3);
    iv.value = { formula: `C${totalRow}+C${zRow}`, result: dp.total - dp.prototype_price };
    applyTotal(iv, FMT.money);
    iv.fill = fill(COLORS.reco_bg);
    iv.alignment = { horizontal: "center", vertical: "middle" };
    applyTotal(ws.getCell(row, 4));
    ws.getCell(row, 4).fill = fill(COLORS.reco_bg);
    row++;
  }

  // Акция ПФ 1=2 при разработке
  const promoText = siteDev.promo_note
    ? `Акция «ПФ 1=2»: ${siteDev.promo_note}`
    : "При заказе разработки - акция «ПФ 1=2»: второй месяц внешнего продвижения в подарок";
  writeNote(ws, row, promoText, LAST, 130, { bold: true, color: COLORS.promo_text, fill: COLORS.promo_bg });
  row += 2;

  // ── Что входит ──
  writeSection(ws, row, "Что входит в базу", LAST);
  row++;
  DEV_BASE_ITEMS.forEach((item, i) => {
    const nc = ws.getCell(row, 1);
    nc.value = i + 1;
    applyBody(nc, i % 2 === 1, true);
    ws.mergeCells(row, 2, row, LAST);
    const ic = ws.getCell(row, 2);
    ic.value = item;
    applyBody(ic, i % 2 === 1, false);
    ws.getRow(row).height = rowHeightFor(item, 130);
    row++;
  });
  row++;

  // ── Опции ──
  writeSection(ws, row, "Опции (по желанию, в итог не входят)", LAST);
  row++;
  ["№", "Опция", "Стоимость", "Примечание"].forEach((h, i) => { const c = ws.getCell(row, i + 1); c.value = h; applyHeader(c); });
  row++;
  DEV_OPTIONS.forEach((o, i) => {
    const isAlt = i % 2 === 1;
    const priceVal = o.price == null ? "по расчету" : o.price;
    // «по расчету» уже в колонке цены - в примечании не повторяем
    const note = o.price == null ? String(o.note || "").replace(/^по расчету[,;]?\s*/i, "") : (o.note || "");
    const vals = [i + 1, o.name, priceVal, note];
    vals.forEach((v, j) => {
      const c = ws.getCell(row, j + 1);
      c.value = v;
      applyBody(c, isAlt, j === 0 || j === 2);
      if (j === 2 && typeof v === "number") c.numFmt = o.unit === "год" ? '#,##0 "₽/год"' : FMT.money;
    });
    ws.getRow(row).height = rowHeightFor(o.name, 64);
    row++;
  });
  row++;

  writeNote(ws, row,
    `Цена базы - по формуле калькулятора: ${fmtRub(DEV.block_price)} за блок главной + прототип с текстами (лендинг ${fmtRub(DEV.prototype.landing)}, многостраничник ${fmtRub(DEV.prototype.multipage)}) + подстраницы ступенями. Сайт сразу проектируется под список запросов: структура и тексты готовы до дизайна.`,
    LAST, 130);

  ws.views = [{ state: "frozen", ySplit: 1 }];
  return { total: dp.total };
}

// ─── Лист «Сравнение тарифов» (первый) ───
function writeComparisonSheet(ws, ctx) {
  const { fc, tariffsByKey, sheetRefs, payback, models, recommended } = ctx;
  const LAST = 4;
  [40, 30, 30, 30].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  let row = writeSheetTitle(ws, "СРАВНЕНИЕ ТАРИФОВ", LAST);
  const t0 = Number(fc.inputs && fc.inputs.t0) || 0;
  const recoText = recommended
    ? `Рекомендуем тариф «${TARIFF_NAMES[recommended]}».`
    : "Рекомендацию по тарифу дадим после уточнения среднего чека и маржинальности: при текущих параметрах экономики вложения окупаются дольше 12 месяцев.";
  writeNote(ws, row, `Сейчас из поиска: ~${fmtNum(t0)} визитов в месяц. ${recoText} Подробно по каждому тарифу - на вкладках тарифов, расчет по месяцам - на вкладке «Окупаемость».`, LAST, 120, { color: COLORS.text });
  row += 2;

  // Шапка
  const head = ["Показатель", ...TARIFF_KEYS.map((k) => (k === recommended ? `${TARIFF_NAMES[k]}\n(рекомендуем)` : TARIFF_NAMES[k]))];
  head.forEach((h, i) => {
    const c = ws.getCell(row, i + 1);
    c.value = h;
    applyHeader(c);
    if (i > 0 && TARIFF_KEYS[i - 1] === recommended) c.fill = fill(COLORS.reco_header);
  });
  ws.getRow(row).height = 30;
  row++;

  const PB = "'Окупаемость'";
  const composition = (k) => {
    const t = tariffsByKey[k];
    const lines = [];
    for (const [kind, title] of [["onetime", "Разово"], ["monthly", "Ежемесячно"]]) {
      const list = (t[kind] || []).map((s) => {
        const sv = serviceView(s, kind);
        if (typeof sv.price === "number" && sv.price === 0) return `${sv.short} (${sv.regular > 0 ? "в подарок" : "бесплатно"})`;
        return sv.short;
      });
      if (list.length) lines.push(`${title}: ${list.join(", ")}`);
    }
    return lines.join("\n") || "-";
  };
  const promosText = (k) => {
    const t = tariffsByKey[k];
    const out = [];
    const p = pfPromo(t);
    if (p) out.push(`ПФ 1=2: второй месяц внешнего продвижения в подарок (-${fmtRub(p.amount)})`);
    for (const kind of ["onetime", "monthly"]) {
      for (const s of t[kind] || []) {
        const sv = serviceView(s, kind);
        if (typeof sv.price === "number" && sv.price === 0 && sv.regular > 0) out.push(`${sv.short} в подарок (обычно ${fmtRub(sv.regular)})`);
      }
    }
    return out.join("\n") || "-";
  };
  // Трафик - из того же пересчета модели, что и лист «Окупаемость» (при свежем forecast.json числа совпадают).
  const cp = (k, key) => (models[k] ? Math.round(models[k].res.checkpoints[key]) : "-");

  const defs = [
    { label: "Разово", fmt: FMT.money, get: (k) => ({ formula: `'${TARIFF_NAMES[k]}'!E${sheetRefs[k].onetimeTotalRow}`, result: sheetRefs[k].onetimeSum }) },
    { label: "Ежемесячно", fmt: FMT.money_month, get: (k) => ({ formula: `'${TARIFF_NAMES[k]}'!E${sheetRefs[k].monthlyTotalRow}`, result: sheetRefs[k].monthlySum }) },
    { label: "Что входит", text: true, get: composition },
    { label: "Акции", text: true, get: promosText },
    { label: "Трафик через 3 мес, визитов в мес", fmt: FMT.int, get: (k) => cp(k, "m3") },
    { label: "Трафик через 6 мес, визитов в мес", fmt: FMT.int, get: (k) => cp(k, "m6") },
    { label: "Трафик через 12 мес, визитов в мес", fmt: FMT.int, get: (k) => cp(k, "m12") },
    { label: "Дополнительных обращений в месяц к 12-му мес (сверх текущих)", fmt: FMT.dec1, get: (k) => ({ formula: `${PB}!M${payback.refs[k].leads}`, result: payback.evals[k].rows[11].leads }) },
    { label: "Вложения за 12 мес", fmt: FMT.money, get: (k) => ({ formula: `${PB}!N${payback.refs[k].cost}`, result: payback.evals[k].y1.cost }) },
    { label: "Чистый результат за 12 мес", fmt: FMT.money_signed, bold: true, get: (k) => ({ formula: `${PB}!N${payback.refs[k].cum}`, result: payback.evals[k].y1.cum }) },
    { label: "ROMI за 12 мес", fmt: FMT.pct, bold: true, get: (k) => ({ formula: `${PB}!B${payback.refs[k].romi12}`, result: payback.evals[k].romi12 }) },
    { label: "Окупаемость, мес", fmt: FMT.months, get: (k) => ({ formula: `${PB}!B${payback.refs[k].payback}`, result: payback.evals[k].payback }) },
    { label: "ROMI за 24 мес", fmt: FMT.pct, get: (k) => ({ formula: `${PB}!B${payback.refs[k].romi24}`, result: payback.evals[k].romi24 }) },
  ];

  defs.forEach((d, i) => {
    const isAlt = i % 2 === 1;
    const lc = ws.getCell(row, 1);
    lc.value = d.label;
    applyBody(lc, isAlt, false);
    lc.font = { name: FONT_FAMILY, size: FONT_SIZE, bold: true, color: { argb: COLORS.text } };
    let maxH = 15;
    TARIFF_KEYS.forEach((k, j) => {
      const c = ws.getCell(row, j + 2);
      // Модель и лист тарифа есть у каждого тарифа из tariffs.json; нет тарифа - прочерк.
      const v = tariffsByKey[k] && sheetRefs[k] && payback.refs[k] ? d.get(k) : "-";
      c.value = v;
      applyBody(c, isAlt, !d.text);
      if (d.text) {
        c.alignment = { horizontal: "left", vertical: "top", wrapText: true };
        maxH = Math.max(maxH, rowHeightFor(String(v), 30));
      } else if (d.fmt) {
        c.numFmt = d.fmt;
      }
      const isReco = k === recommended;
      if (isReco) c.fill = fill(COLORS.reco_bg);
      if (d.bold || isReco) c.font = { name: FONT_FAMILY, size: FONT_SIZE, bold: true, color: { argb: COLORS.text } };
    });
    if (d.text) {
      ws.getRow(row).height = maxH;
      lc.alignment = { horizontal: "left", vertical: "top", wrapText: true };
    }
    row++;
  });
  row++;

  // Спец-предложения вне тарифов (tariffs.special, сейчас только ST - сателлит, RULES раздел 3): блок «Дополнительно».
  const special = (Array.isArray(ctx.special) ? ctx.special : []).filter((x) => x && typeof x === "object" && x.id);
  if (special.length) {
    writeSection(ws, row, "Дополнительно (вне тарифов, по желанию)", LAST);
    row++;
    for (const sp of special) {
      const sv = serviceView(sp, "onetime");
      const catalogPrice = SERVICES[sv.id] ? SERVICES[sv.id].price : null;
      const price = typeof sp.price === "number" && sp.price > 0 ? sp.price : catalogPrice;
      const text = [
        `${sv.name}${price ? ` - ${fmtRub(price)}` : ""}`,
        sv.description,
        sp.reason ? String(sp.reason) : "",
      ].filter(Boolean).join(". ");
      writeNote(ws, row, text, LAST, 120, { color: COLORS.text });
      row++;
    }
    row++;
  }

  if (fc.assumptions_note) {
    writeNote(ws, row, `Методика: ${fc.assumptions_note}`, LAST, 120);
    row++;
  }
  writeNote(ws, row, "Чек, конверсию и маржу можно поменять в желтых ячейках на вкладке «Окупаемость» - сравнение пересчитается. ROMI = (валовая прибыль - вложения) / вложения.", LAST, 120);

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

// forecast.json есть - путь v2; нет - легаси.
let forecast = null;
if (existsSync(forecastPath)) {
  try {
    forecast = JSON.parse(readFileSync(forecastPath, "utf8").replace(/^﻿/, ""));
  } catch (e) {
    console.error(`[build-smeta-xlsx] битый forecast.json: ${e.message} - перезапусти build-forecast.mjs`);
    process.exit(1);
  }
  if (!forecast || typeof forecast.tariffs !== "object" || !forecast.tariffs) {
    console.error("[build-smeta-xlsx] forecast.json без tariffs - перезапусти build-forecast.mjs");
    process.exit(1);
  }
}

if (forecast) {
  // ─── v2 ───
  const T = deepClean(tariffs); // свободный текст агента - без тире и буквы е-с-точками
  forecast = deepClean(forecast);
  const normTariffs = {};
  for (const rawKey of Object.keys(T)) {
    const ck = KEY_ALIASES[rawKey] || rawKey;
    if (!KNOWN_TARIFFS.has(ck)) continue;
    if (rawKey !== ck) console.warn(`[build-smeta-xlsx] legacy tariff key '${rawKey}' detected, normalising to '${ck}'`);
    normTariffs[ck] = T[rawKey];
  }
  let data = null;
  if (existsSync(dataPath)) {
    try {
      data = JSON.parse(readFileSync(dataPath, "utf8").replace(/^﻿/, ""));
    } catch (e) {
      console.warn(`[build-smeta-xlsx] seo-strategiya_data.json не прочитан (${e.message}) - входы модели из forecast.json`);
    }
  }
  // Рекомендация сметы: forecast.recommended_offer (build-forecast: Рост, а при проваленном экономическом гейте -
  // тариф с лучшим чистым результатом за 12 мес или null - тогда ни один тариф не выделяется). Старый forecast.json
  // без поля - recommended (Рост).
  const recommended = "recommended_offer" in forecast
    ? (KNOWN_TARIFFS.has(forecast.recommended_offer) ? forecast.recommended_offer : null)
    : (KNOWN_TARIFFS.has(forecast.recommended) ? forecast.recommended : "growth");

  const model = buildModel(forecast, data, normTariffs);
  const stale = staleCheck(forecast, model.models);
  if (stale.length) {
    console.warn("[build-smeta-xlsx] ВНИМАНИЕ: forecast.json не совпадает с пересчетом по tariffs.json - перезапусти build-forecast.mjs. Смета собрана по пересчету:");
    for (const s of stale) console.warn(`  - ${s}`);
  }
  for (const k of TARIFF_KEYS) {
    const t = normTariffs[k];
    if (!t) continue;
    for (const [kind, totalKey] of [["onetime", "total_onetime"], ["monthly", "total_monthly"]]) {
      if (t[totalKey] != null && Number(t[totalKey]) !== sumNumericPrices(t[kind])) {
        console.warn(`[build-smeta-xlsx] ${TARIFF_NAMES[k]}: ${totalKey}=${t[totalKey]} не равен сумме цен строк (${sumNumericPrices(t[kind])}) - в листе тарифа итог по строкам, в окупаемости - ${totalKey}`);
      }
    }
  }

  // Порядок листов: «Сравнение тарифов» создаем первым, заполняем последним (ему нужны ссылки на остальные).
  const wsCompare = workbook.addWorksheet("Сравнение тарифов");
  const sheetRefs = {};
  for (const k of TARIFF_KEYS) {
    if (!normTariffs[k]) continue;
    sheetRefs[k] = writeTariffSheet(workbook, k, normTariffs[k], { v2: true, recommended: k === recommended });
  }
  const missing = TARIFF_KEYS.filter((k) => !normTariffs[k]).map((k) => TARIFF_NAMES[k]);
  if (missing.length) {
    console.warn(`[build-smeta-xlsx] WARNING: missing sheets: ${missing.join(", ")}. tariffs.json keys: ${Object.keys(T).join(", ")}`);
  }

  // Разработка сайта: site_dev из tariffs.json или справочный многостраничник.
  const sd = T.site_dev && typeof T.site_dev === "object" ? T.site_dev : null;
  const plannedNew = Number(forecast.inputs && forecast.inputs.pages && forecast.inputs.pages.planned_new) || 0;
  const siteDev = {
    recommended: sd ? !!sd.recommended : false,
    format: sd && sd.format === "landing" ? "landing" : "multipage",
    pages: sd && Number.isFinite(Number(sd.pages)) && sd.pages !== null && sd.pages !== "" ? Number(sd.pages) : (plannedNew || 10),
    home_blocks: sd ? sd.home_blocks : undefined,
    reason: (sd && sd.reason) || "",
    promo_note: (sd && sd.promo_note) || "",
  };
  const kpTariffs = TARIFF_KEYS.filter((k) => normTariffs[k] && tariffServiceIds(normTariffs[k]).has("KP"));
  // Зачет прототипа - по первому тарифу с KP начиная с рекомендованного (Рост ⊆ Максимум).
  const kpForDev = kpTariffs.includes(recommended) ? [recommended] : kpTariffs.slice(0, 1);
  const wsDev = workbook.addWorksheet("Разработка сайта");
  writeDevSheet(wsDev, { siteDev, kpTariffs: kpForDev });

  const wsPayback = workbook.addWorksheet("Окупаемость");
  const payback = writePaybackSheet(wsPayback, { econ: model.econ, fc: forecast, models: model.models, recommended });

  writeComparisonSheet(wsCompare, { fc: forecast, tariffsByKey: normTariffs, sheetRefs, payback, models: model.models, recommended, special: T.special });
  for (const w of promoWarned) console.warn(w);

  // Самопроверка: формулы (их JS-двойник) при исходных параметрах дают ROMI forecast.json (±1 п.п.).
  for (const k of Object.keys(payback.evals)) {
    const f = forecast.tariffs[k];
    if (!f || !f.year1) continue;
    const ev = payback.evals[k];
    const d12 = Math.abs(ev.romi12 * 100 - f.year1.romi);
    const d24 = Math.abs(ev.romi24 * 100 - f.year2.romi);
    if (d12 > 1 || d24 > 1) {
      console.warn(`[build-smeta-xlsx] ВНИМАНИЕ: ROMI листа «Окупаемость» (${TARIFF_NAMES[k]}: ${Math.round(ev.romi12 * 100)}% / ${Math.round(ev.romi24 * 100)}%) расходится с forecast.json (${f.year1.romi}% / ${f.year2.romi}%)`);
    }
  }

  // Excel пересчитывает формулы при открытии (Google Таблицы пересчитывают всегда).
  workbook.calcProperties = { ...(workbook.calcProperties || {}), fullCalcOnLoad: true };
  console.log(`[build-smeta-xlsx] v2: forecast.json (модель ${forecast.model_version || "?"}), входы модели - ${model.fiSource}, разработка - ${sd ? "site_dev из tariffs.json" : "справочно (site_dev нет)"}`);
} else {
  // ─── Легаси ───
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
}

await workbook.xlsx.writeFile(outputPath);
const finalSheetTitles = workbook.worksheets.map(ws => ws.name);
console.log(`[build-smeta-xlsx] wrote ${outputPath} (sheets: ${finalSheetTitles.join(", ")})`);
