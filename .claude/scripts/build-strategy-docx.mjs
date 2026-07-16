#!/usr/bin/env node
// build-strategy-docx.mjs
// Генерирует SEO-стратегию (.docx) на основе seo-strategiya_content.json + tariffs.json + inputs.json.
// Используется в /seo-strategiya после strategy-writer.
//
// Зависимости: docx (npm install docx) — добавлен в package.json.
//
// Использование:
//   node .claude/scripts/build-strategy-docx.mjs <strategy_dir>
//
// Вход:
//   <strategy_dir>/seo-strategiya_content.json — структурированный контент от strategy-writer
//   <strategy_dir>/inputs.json           — домен, дата
// Выход:
//   <strategy_dir>/SEO_Strategy_<domain>.docx

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, HeadingLevel, BorderStyle,
  WidthType, ShadingType, PageBreak, LevelFormat, TableLayoutType,
} from "docx";
import { TARIFF_SCALE, interpCheckpoints, computeScenarioTariff } from "./_forecast-money.mjs";

const strategyDirArg = process.argv[2];
if (!strategyDirArg) {
  console.error("[build-strategy-docx] usage: node build-strategy-docx.mjs <strategy_dir>");
  process.exit(1);
}
const strategyDir = resolve(strategyDirArg);

const contentPath = join(strategyDir, "seo-strategiya_content.json");
const inputsPath = join(strategyDir, "inputs.json");

if (!existsSync(contentPath)) {
  console.error(`[build-strategy-docx] not found: ${contentPath}`);
  process.exit(1);
}
if (!existsSync(inputsPath)) {
  console.error(`[build-strategy-docx] not found: ${inputsPath}`);
  process.exit(1);
}

const content = JSON.parse(readFileSync(contentPath, "utf8").replace(/^﻿/, ""));
const inputs = JSON.parse(readFileSync(inputsPath, "utf8").replace(/^﻿/, ""));

// tariffs.json/seo-strategiya_data.json - опциональны (нужны только для блока decomposition_table,
// этап 8). Их отсутствие не должно ронять сборку - старые content.json с готовой таблицей (case
// "table") работают вообще без них.
const tariffsPath = join(strategyDir, "tariffs.json");
const dataPath = join(strategyDir, "seo-strategiya_data.json");
const tariffs = existsSync(tariffsPath) ? JSON.parse(readFileSync(tariffsPath, "utf8").replace(/^﻿/, "")) : {};
const stratData = existsSync(dataPath) ? JSON.parse(readFileSync(dataPath, "utf8").replace(/^﻿/, "")) : {};

const domain = inputs.domain || "site";
const date = inputs.date || new Date().toLocaleDateString("ru-RU", { year: "numeric", month: "long" });
// Имя файла: используем slug если есть (Latin, безопасно для email/FS), иначе domain без forbidden-chars (Windows).
const safeName = (inputs.slug || domain).replace(/[<>:"/\\|?*\x00-\x1f]/g, "_");
const outputPath = join(strategyDir, `SEO_Strategy_${safeName}.docx`);

// ═══ Дизайн-токены ═══
const C = {
  header_bg: "1F4E79",
  header_text: "FFFFFF",
  total_bg: "D5E8F0",
  row_alt: "F2F2F2",
  row_white: "FFFFFF",
  accent: "1F4E79",
  text: "000000",
  muted: "666666",
  verdict_green: "2E7D32",
};
const F = {
  family: "Arial",
  size_title: 28,    // 14pt (half-points)
  size_subtitle: 24, // 12pt
  size_body: 20,     // 10pt
  size_table: 18,    // 9pt
  size_footer: 16,   // 8pt
};

// ═══ Хелперы ═══
const border = { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" };
const borders = { top: border, bottom: border, left: border, right: border };
const cellMargins = { top: 80, bottom: 80, left: 120, right: 120 };

function run(text, opts = {}) {
  return new TextRun({
    text: String(text ?? ""),
    font: F.family,
    size: opts.size ?? F.size_body,
    bold: opts.bold || false,
    italics: opts.italics || false,
    color: opts.color || C.text,
  });
}

function paragraph(text, opts = {}) {
  return new Paragraph({
    spacing: opts.spacing || { before: 80, after: 80 },
    alignment: opts.alignment || AlignmentType.LEFT,
    children: Array.isArray(text) ? text : [run(text, opts)],
  });
}

function heading(text, level) {
  // level 1 = section title, level 2 = subheading, level 3 = block title
  const sizeMap = { 1: F.size_title, 2: F.size_subtitle, 3: F.size_body + 2 };
  return new Paragraph({
    spacing: { before: 240, after: 120 },
    children: [run(text, { size: sizeMap[level] || F.size_subtitle, bold: true, color: C.accent })],
  });
}

function headerCell(text, widthDxa) {
  return new TableCell({
    borders,
    width: { size: widthDxa, type: WidthType.DXA },
    shading: { fill: C.header_bg, type: ShadingType.CLEAR },
    margins: cellMargins,
    children: [new Paragraph({
      children: [new TextRun({
        text: String(text), font: F.family, size: F.size_table, bold: true, color: C.header_text,
      })],
    })],
  });
}

function dataCell(text, widthDxa, isAlt) {
  return new TableCell({
    borders,
    width: { size: widthDxa, type: WidthType.DXA },
    shading: { fill: isAlt ? C.row_alt : C.row_white, type: ShadingType.CLEAR },
    margins: cellMargins,
    children: [new Paragraph({
      children: [new TextRun({
        text: String(text ?? ""), font: F.family, size: F.size_table,
      })],
    })],
  });
}

function tableBlock(columns, rows) {
  const contentWidth = 9638; // A4 -2cm margins each
  const colCount = columns.length || 1;
  const colWidth = Math.floor(contentWidth / colCount);
  const columnWidths = new Array(colCount).fill(colWidth);

  const headerRow = new TableRow({
    tableHeader: true,
    children: columns.map((c) => headerCell(c, colWidth)),
  });
  const dataRows = rows.map((r, i) =>
    new TableRow({
      children: r.map((cell) => dataCell(cell, colWidth, i % 2 === 1)),
    })
  );
  return new Table({
    columnWidths,
    layout: TableLayoutType.FIXED,
    rows: [headerRow, ...dataRows],
    width: { size: contentWidth, type: WidthType.DXA },
  });
}

function bulletList(items) {
  return items.map((it) =>
    new Paragraph({
      bullet: { level: 0 },
      spacing: { before: 40, after: 40 },
      children: [run(it)],
    })
  );
}

function fmtNum(n) {
  return Number(n || 0).toLocaleString("ru-RU");
}

// ═══ Декомпозиция в деньги (этап 8) ═══
// Числа больше не пишет strategy-writer - он кладет блок-маркер {"type":"decomposition_table"}.
// Здесь считаем таблицу «потенциал выручки» из forecast_scenarios (рекомендованный сценарий,
// тариф Рост) через общий модуль _forecast-money.mjs. ROMI/окупаемость сюда НЕ попадают -
// они только в смете (сноска "см. смету").
const TARIFF_KEY_ALIASES = { rost: "growth" };

function getTariffData(tariffsObj, key) {
  for (const rawKey of Object.keys(tariffsObj || {})) {
    const canonical = TARIFF_KEY_ALIASES[rawKey] || rawKey;
    if (canonical === key) return tariffsObj[rawKey];
  }
  return null;
}

function computeDecompositionRows(forecastScenarios, growthTariffData) {
  if (!forecastScenarios || !Array.isArray(forecastScenarios.scenarios) || !forecastScenarios.scenarios.length) return null;
  if (!growthTariffData) return null;

  const scenario = forecastScenarios.scenarios.find((s) => s && s.recommended) || forecastScenarios.scenarios[0];
  if (!scenario) return null;
  const assumptions = forecastScenarios.assumptions || {};
  const cr = Number(assumptions.conversion_rate) || 0.02;
  const close = Number(assumptions.close_rate) || (assumptions.model === "one_step" ? 1 : 0.3);
  const avg = Number(assumptions.avg_check) || 0;
  const scale = TARIFF_SCALE.growth ?? 1;
  const onetime = Number(growthTariffData.total_onetime) || 0;
  const monthly = Number(growthTariffData.total_monthly) || 0;

  const res = computeScenarioTariff({
    assumptions, checkpoints: scenario.traffic_checkpoints, activeMonths: scenario.active_months,
    tariffKey: "growth", onetime, monthly,
  });

  // Снимок трафик->лиды->продажи->выручка на конкретный месяц (та же методика, что модуль
  // использует для traffic12/leads12/sales12/revMonth12 - округление на выходе каждого шага).
  function snapshot(traffic) {
    const leads = Math.round(traffic * cr);
    const sales = Math.round(leads * close);
    return { t: Math.round(traffic), leads, sales, revenue: Math.round(sales * avg) };
  }

  const traffic0 = interpCheckpoints(scenario.traffic_checkpoints, 0) * scale;
  const traffic6 = res.series[5] ? res.series[5].traffic : interpCheckpoints(scenario.traffic_checkpoints, 6) * scale;

  return {
    scenarioLabel: scenario.label || "",
    avgCheckSource: assumptions.avg_check_source,
    crPct: Math.round(cr * 1000) / 10,
    closePct: Math.round(close * 100),
    avg,
    now: snapshot(traffic0),
    at6: snapshot(traffic6),
    at12: { t: res.traffic12, leads: res.leads12, sales: res.sales12, revenue: res.revMonth12 },
  };
}

const decompRows = computeDecompositionRows(stratData.forecast_scenarios, getTariffData(tariffs, "growth"));

// ═══ Рендер блока ═══
function renderBlock(block) {
  const out = [];
  switch (block.type) {
    case "subheading":
      out.push(heading(block.text, 2));
      break;

    case "paragraph":
      out.push(paragraph(block.text));
      break;

    case "table":
      out.push(tableBlock(block.columns || [], block.rows || []));
      out.push(paragraph("")); // отступ
      break;

    case "decomposition_table":
      // Плейсхолдер от strategy-writer - числа считает сборщик из forecast_scenarios
      // (см. computeDecompositionRows выше). Писатель числа выручки НЕ пишет (этап 8).
      if (decompRows) {
        out.push(paragraph(
          `Перевели прогноз трафика в бизнес-результат через средний чек (сценарий "${decompRows.scenarioLabel}", тариф Рост).`
        ));
        out.push(tableBlock(
          ["Показатель", "Сейчас", "Через 6 мес", "Через 12 мес"],
          [
            ["Трафик (переходов/мес)", fmtNum(decompRows.now.t), fmtNum(decompRows.at6.t), fmtNum(decompRows.at12.t)],
            ["Обращения/лиды", fmtNum(decompRows.now.leads), fmtNum(decompRows.at6.leads), fmtNum(decompRows.at12.leads)],
            ["Продажи", fmtNum(decompRows.now.sales), fmtNum(decompRows.at6.sales), fmtNum(decompRows.at12.sales)],
            ["Выручка (руб)", fmtNum(decompRows.now.revenue), fmtNum(decompRows.at6.revenue), fmtNum(decompRows.at12.revenue)],
          ]
        ));
        out.push(paragraph(
          `Допущения: конверсия в заявку ${decompRows.crPct}%, заявка в продажу ${decompRows.closePct}%, средний чек ${fmtNum(decompRows.avg)} руб${decompRows.avgCheckSource === "estimated" ? " (оценочный)" : ""}. Оценка, не гарантия.`
        ));
        out.push(paragraph("Расчет окупаемости - см. смету, вкладка Декомпозиция.", { italics: true, color: C.muted }));
        out.push(paragraph(""));
      } else {
        console.warn("[build-strategy-docx] decomposition_table: нет forecast_scenarios или tariffs.json (тариф Рост) - блок пропущен");
      }
      break;

    case "problem_block":
      out.push(heading(block.title || "Проблема", 3));
      if (block.why) out.push(paragraph([run("Почему важно: ", { bold: true }), run(block.why)]));
      if (block.impact) out.push(paragraph([run("Влияние: ", { bold: true }), run(block.impact)]));
      break;

    case "growth_point":
      out.push(heading(block.name, 3));
      if (block.problem)
        out.push(paragraph([run("Проблема: ", { bold: true }), run(block.problem)]));
      if (block.consequences)
        out.push(paragraph([run("Последствия: ", { bold: true }), run(block.consequences)]));
      if (block.solution)
        out.push(paragraph([run("Решение: ", { bold: true }), run(block.solution)]));
      if (block.evidence_table) {
        out.push(paragraph([run("Доказательства:", { bold: true })]));
        out.push(tableBlock(block.evidence_table.columns || [], block.evidence_table.rows || []));
      }
      if (Array.isArray(block.competitor_facts) && block.competitor_facts.length) {
        out.push(...bulletList(block.competitor_facts));
      }
      if (block.summary)
        out.push(paragraph([run("Итог: ", { bold: true }), run(block.summary)]));
      out.push(paragraph(""));
      break;

    case "quick_wins":
      out.push(heading("Quick Wins", 3));
      out.push(...bulletList(block.items || []));
      break;

    case "tariff": {
      const titleParts = [run(`Вариант «${block.name}»`, { bold: true, size: F.size_subtitle, color: C.accent })];
      if (block.recommended) {
        titleParts.push(run("  ← рекомендованный", { italics: true, color: C.verdict_green }));
      }
      out.push(new Paragraph({
        spacing: { before: 200, after: 80 },
        children: titleParts,
      }));

      if (block.preamble) out.push(paragraph(block.preamble));
      if (Array.isArray(block.services) && block.services.length) {
        out.push(paragraph([run("Что входит:", { bold: true })]));
        block.services.forEach((s) => {
          const line = s.description ? `${s.name} - ${s.description}` : s.name;
          out.push(new Paragraph({
            bullet: { level: 0 },
            spacing: { before: 40, after: 40 },
            children: [run(line)],
          }));
        });
      }
      if (block.expected_result) {
        out.push(paragraph([run("Ожидаемый результат: ", { bold: true }), run(block.expected_result)]));
      }
      if (block.hint) {
        out.push(new Paragraph({
          spacing: { before: 80, after: 160 },
          children: [run(block.hint, { italics: true, color: C.muted })],
        }));
      }
      break;
    }

    case "special":
      if (Array.isArray(block.items) && block.items.length) {
        out.push(heading("Дополнительно", 3));
        block.items.forEach((it) => {
          out.push(paragraph([run(it.name, { bold: true }), run(" - "), run(it.description)]));
        });
      }
      break;

    case "conditions":
      if (Array.isArray(block.items) && block.items.length) {
        out.push(paragraph([run("Ключевые условия достижения прогноза:", { bold: true })]));
        out.push(...bulletList(block.items));
      }
      break;

    default:
      // Неизвестный тип — пытаемся вывести как параграф если есть text
      if (block.text) out.push(paragraph(block.text));
  }
  return out;
}

// ═══ Сборка документа ═══
const docChildren = [];

// Титульная страница
const tp = content.title_page || {};
docChildren.push(new Paragraph({
  spacing: { before: 2400, after: 240 },
  alignment: AlignmentType.CENTER,
  children: [run(tp.title || "SEO-СТРАТЕГИЯ ПРОДВИЖЕНИЯ", { size: F.size_title + 8, bold: true, color: C.accent })],
}));
docChildren.push(new Paragraph({
  alignment: AlignmentType.CENTER,
  spacing: { before: 120, after: 120 },
  children: [run(tp.domain || domain, { size: F.size_title + 4, bold: true })],
}));
if (tp.niche_oneliner) {
  docChildren.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 80, after: 240 },
    children: [run(tp.niche_oneliner, { italics: true })],
  }));
}
docChildren.push(new Paragraph({
  alignment: AlignmentType.CENTER,
  spacing: { before: 800, after: 80 },
  children: [run(`Регион: ${tp.region || ""}`)],
}));
docChildren.push(new Paragraph({
  alignment: AlignmentType.CENTER,
  spacing: { before: 80, after: 80 },
  children: [run(`Дата: ${tp.date || date}`)],
}));
docChildren.push(new Paragraph({
  alignment: AlignmentType.CENTER,
  spacing: { before: 800, after: 80 },
  children: [run(`Подготовлено: ${tp.author || "TIMUR SEO"}`, { bold: true, color: C.muted })],
}));
docChildren.push(new Paragraph({ children: [new PageBreak()] }));

// Секции
const sections = Array.isArray(content.sections) ? content.sections : [];
sections.forEach((section, idx) => {
  // Заголовок раздела
  docChildren.push(new Paragraph({
    spacing: { before: 200, after: 200 },
    children: [run(`${section.id || idx + 1}. ${section.title || ""}`, { size: F.size_title + 4, bold: true, color: C.accent })],
  }));

  (section.blocks || []).forEach((block) => {
    const rendered = renderBlock(block);
    rendered.forEach((el) => docChildren.push(el));
  });

  // PageBreak между разделами (кроме последнего)
  if (idx < sections.length - 1) {
    docChildren.push(new Paragraph({ children: [new PageBreak()] }));
  }
});

// Подвал
const footerPara = new Paragraph({
  alignment: AlignmentType.CENTER,
  children: [new TextRun({
    text: `TIMUR SEO | ${date}`,
    font: F.family, size: F.size_footer, color: C.muted,
  })],
});

const doc = new Document({
  creator: "TIMUR SEO",
  title: `SEO-стратегия ${domain}`,
  styles: {
    default: {
      document: {
        run: { font: F.family, size: F.size_body, color: C.text },
      },
    },
  },
  sections: [{
    properties: {
      page: {
        size: { width: 11906, height: 16838 },
        margin: { top: 1134, right: 1134, bottom: 1134, left: 1134 },
      },
    },
    headers: {},
    footers: {
      default: new Footer({ children: [footerPara] }),
    },
    children: docChildren,
  }],
});

const buf = await Packer.toBuffer(doc);
writeFileSync(outputPath, buf);
console.log(`[build-strategy-docx] wrote ${outputPath} (${buf.length} bytes)`);
