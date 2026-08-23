#!/usr/bin/env node
// verify-prototype-mobile.mjs
// РЕНДЕР-проверка собранного прототипа на узких экранах (playwright + chromium).
//
// Отличие от verify-prototype.mjs: тот читает КОД (грепом по prototype.html и manifest.json),
// этот открывает страницу в браузере и МЕРИТ то, что получилось. Греп не видит
// горизонтального скролла, обрезанного поля ввода и ползунка высотой 2px - по коду всё это
// проходит проверку с идеальным результатом.
//
// ПРАВИЛО ПРИЧИНЫ (главное в этом файле):
//   Горизонтальный скролл чинится ПОИСКОМ ВИНОВНОГО элемента, а не `overflow-x: hidden`
//   на body. Заглушить симптом легко: полоса прокрутки пропадёт, но блок останется шире
//   экрана и уедет клиенту ОБРЕЗАННЫМ - справа отрежется цена, кнопка или половина
//   таблицы, и об этом никто не узнает до сдачи. Поэтому проверка печатает не только факт
//   переполнения, но и элементы, чей правый край вышел за вьюпорт: чинить надо именно их
//   (max-width:100%, min-width:0 во flex/grid-ячейке, word-break для длинных строк,
//   перенос сетки в одну колонку). Тот же принцип для остальных проверок: мелкий кегль
//   лечится кеглем, а мелкая кнопка - размером кнопки, а не отключением проверки.
//
// Кит фиксированный: фрагменты и CSS одинаковы на каждой странице, поэтому горизонтальный
// скролл, мелкие зоны нажатия и мелкий кегль - свойства КИТА, а не текста конкретной
// клиентской страницы. Отсюда и место запуска: это тест кита (.claude/tests/kit-mobile/),
// который гоняет разработчик шаблона. В клиентский прогон /seo-tekst он не встроен, и
// playwright не является зависимостью клиентской сборки.
//
// Использование:
//   node verify-prototype-mobile.mjs <texts_dir|путь_к_html> [--widths 320,360,390,430]
//   (texts_dir - папка задачи с собранным prototype.html; v7 - один файл на весь сайт)
//
// Exit:
//   0 - пройдено
//   1 - есть провалы (или нет входного файла)
//   2 - playwright недоступен. Это НЕ провал проверки, а отсутствие инструмента:
//       ставится `npm i -D playwright` + `npx playwright install chromium`.

import { existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// ---------- пороги ----------
const MIN_FONT_PX = 12; // кегль обычного текста
const MIN_TAP_PX = 42; // зона нажатия кнопки/селекта/нестрочной ссылки
const MIN_INPUT_FONT_PX = 16; // меньше - iOS зумит страницу при фокусе в поле
const MIN_RANGE_H_PX = 44; // высота ползунка input[type=range]
const MIN_CHECKBOX_PX = 20; // сторона чекбокса
const VIEWPORT_H = 844;
const DEFAULT_WIDTHS = [320, 360, 390, 430];

// ---------- аргументы ----------
const argv = process.argv.slice(2);
let target = null;
let widths = DEFAULT_WIDTHS;

for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--widths") {
    widths = parseWidths(argv[++i]);
  } else if (a.startsWith("--widths=")) {
    widths = parseWidths(a.slice("--widths=".length));
  } else if (!target) {
    target = a;
  }
}

function parseWidths(raw) {
  const list = String(raw || "")
    .split(/[,\s]+/)
    .map((x) => parseInt(x, 10))
    .filter((n) => Number.isFinite(n) && n >= 200 && n <= 2000);
  if (!list.length) {
    console.error(`[verify-prototype-mobile] не разобрал --widths "${raw}" (ожидается 320,360,390,430)`);
    process.exit(1);
  }
  return [...new Set(list)].sort((a, b) => a - b);
}

if (!target) {
  console.error("[verify-prototype-mobile] usage: node verify-prototype-mobile.mjs <page_dir|путь_к_html> [--widths 320,360,390,430]");
  process.exit(1);
}

const targetPath = resolve(target);
let htmlPath = targetPath;
if (existsSync(targetPath) && statSync(targetPath).isDirectory()) htmlPath = join(targetPath, "prototype.html");
if (!existsSync(htmlPath)) {
  console.error(`[verify-prototype-mobile] нет файла: ${htmlPath}`);
  process.exit(1);
}

// ---------- playwright: инструмент, а не проверка ----------
let chromium = null;
try {
  ({ chromium } = await import("playwright"));
} catch {
  console.log("[verify-prototype-mobile] playwright недоступен - рендер-проверка ПРОПУЩЕНА (это не провал).");
  console.log("  установка:  npm i -D playwright");
  console.log("  затем:      npx playwright install chromium");
  process.exit(2);
}

// ---------- аудит внутри страницы ----------
// Функция сериализуется и исполняется в контексте страницы: никаких замыканий на модуль,
// все пороги приходят аргументом.
function auditPage(cfg) {
  const EPS = 0.5; // допуск на субпиксели, чтобы 41.6px не считались провалом 42px
  const findings = [];
  const seen = new Set();

  function describe(el) {
    if (!el || el.nodeType !== 1) return "?";
    let s = el.tagName.toLowerCase();
    if (el.id) s += "#" + el.id;
    else if (el.classList && el.classList.length) s += "." + Array.from(el.classList).slice(0, 2).join(".");
    const type = el.getAttribute && el.getAttribute("type");
    if (type) s += "[type=" + type + "]";
    const txt = (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 40);
    return txt ? s + ' "' + txt + '"' : s;
  }

  function add(kind, el, msg) {
    const where = describe(el);
    const key = kind + "|" + where + "|" + msg;
    if (seen.has(key)) return; // дедупликация: одинаковые находки не множим
    seen.add(key);
    findings.push({ kind, where, msg });
  }

  // Обход только отрисованного дерева: display:none / visibility:hidden отсекаются вместе
  // с подветкой (иначе юр-страницы, бургер-меню и попапы дают горы ложных находок).
  // tagName у SVG-элементов приходит строчным ("svg", "path") - приводим к верхнему
  // регистру, иначе иконки кита обходятся наравне с текстовыми узлами.
  const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "BR", "SVG"]);
  const nodes = [];
  (function walk(el) {
    if (!el || el.nodeType !== 1) return;
    if (SKIP_TAGS.has(String(el.tagName || "").toUpperCase())) return;
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") return;
    nodes.push({ el, cs, rect: el.getBoundingClientRect() });
    for (const child of el.children) walk(child);
  })(document.body);

  // --- 1. горизонтальный скролл ---
  // Меряем от clientWidth документа: это ширина, реально доступная контенту (в headless
  // вертикальная полоса прокрутки может съесть несколько px у window.innerWidth и дать
  // ложный провал). Виновников ищем по правому краю - без них останется только соблазн
  // прибить симптом overflow-x:hidden.
  const vw = document.documentElement.clientWidth;
  const docW = document.documentElement.scrollWidth;
  const overflow = docW - vw;
  const culprits = [];
  if (overflow > 1) {
    const over = nodes.filter((n) => n.rect.width > 0 && n.rect.right > vw + 1);
    for (const n of over) {
      // оставляем самых глубоких: родитель шире экрана только потому, что внутри него
      // лежит настоящий виновник
      const hasInnerOffender = over.some((m) => m !== n && n.el.contains(m.el));
      if (hasInnerOffender) continue;
      culprits.push({
        where: describe(n.el),
        right: Math.round(n.rect.right),
        width: Math.round(n.rect.width),
      });
    }
    culprits.sort((a, b) => b.right - a.right);
  }

  // --- 2. кегль ---
  // Только листья с собственным текстом: иначе кегль ловится на контейнерах, которые
  // сами ничего не рисуют, и отчёт превращается в шум.
  for (const { el, cs } of nodes) {
    if (el.children.length > 0) continue;
    const ownText = Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim() !== "");
    if (!ownText) continue;
    const tag = el.tagName;
    if (tag === "OPTION") continue; // рисуется системным виджетом, CSS на него не влияет
    const fs = parseFloat(cs.fontSize);
    if (Number.isFinite(fs) && fs < cfg.minFont - 0.01) {
      add("font", el, `кегль ${fs.toFixed(1)}px < ${cfg.minFont}px`);
    }
  }

  // --- 3. зоны нажатия ---
  // Ссылка внутри абзаца имеет высоту строки - это норма, её никто не тыкает вслепую.
  // Поэтому строчные (display:inline) и перенесённые на несколько строк ссылки пропускаем.
  function isTappable(el, cs) {
    const tag = el.tagName;
    if (tag === "BUTTON" || tag === "SELECT") return true;
    if (tag === "INPUT") {
      const t = (el.getAttribute("type") || "").toLowerCase();
      return t === "submit" || t === "button" || t === "reset";
    }
    if (tag === "A") {
      if (!el.hasAttribute("href")) return false;
      if (cs.display === "inline") return false;
      if (el.getClientRects().length > 1) return false;
      return true;
    }
    return false;
  }
  for (const { el, cs, rect } of nodes) {
    if (!isTappable(el, cs)) continue;
    if (rect.width === 0 && rect.height === 0) continue; // нет бокса - нечего мерить
    const w = rect.width;
    const h = rect.height;
    if (Math.min(w, h) < cfg.minTap - EPS) {
      add("tap", el, `зона нажатия ${Math.round(w)}x${Math.round(h)}px < ${cfg.minTap}px по стороне`);
    }
  }

  // --- 4. поля ввода ---
  const TEXTUAL = new Set(["", "text", "tel", "email", "number", "search", "url", "password", "date", "time", "datetime-local", "month", "week"]);
  for (const { el, cs, rect } of nodes) {
    const tag = el.tagName;
    if (tag === "TEXTAREA") {
      const fs = parseFloat(cs.fontSize);
      if (Number.isFinite(fs) && fs < cfg.minInputFont - 0.01) {
        add("field", el, `кегль поля ${fs.toFixed(1)}px < ${cfg.minInputFont}px (iOS зумит форму при фокусе)`);
      }
      continue;
    }
    if (tag !== "INPUT") continue;
    const type = (el.getAttribute("type") || "text").toLowerCase();
    if (type === "range") {
      // кегль у ползунка не проверяем: он наследуется и ни на что не влияет
      if (rect.height < cfg.minRangeH - EPS) {
        add("field", el, `ползунок высотой ${Math.round(rect.height)}px < ${cfg.minRangeH}px (пальцем не попасть)`);
      }
      continue;
    }
    if (type === "checkbox" || type === "radio") {
      // то же: кегль чекбокса роли не играет, важна сторона бокса
      if (rect.width < cfg.minCheckbox - EPS || rect.height < cfg.minCheckbox - EPS) {
        add("field", el, `чекбокс ${Math.round(rect.width)}x${Math.round(rect.height)}px < ${cfg.minCheckbox}x${cfg.minCheckbox}px`);
      }
      continue;
    }
    if (!TEXTUAL.has(type)) continue;
    const fs = parseFloat(cs.fontSize);
    if (Number.isFinite(fs) && fs < cfg.minInputFont - 0.01) {
      add("field", el, `кегль поля ${fs.toFixed(1)}px < ${cfg.minInputFont}px (iOS зумит форму при фокусе)`);
    }
  }

  return { vw, docW, overflow, culprits: culprits.slice(0, 5), findings };
}

// ---------- прогон ----------
const fileUrl = pathToFileURL(htmlPath).href;
const cfg = {
  minFont: MIN_FONT_PX,
  minTap: MIN_TAP_PX,
  minInputFont: MIN_INPUT_FONT_PX,
  minRangeH: MIN_RANGE_H_PX,
  minCheckbox: MIN_CHECKBOX_PX,
};

let browser = null;
try {
  browser = await chromium.launch();
} catch (err) {
  // браузер не скачан - это тоже отсутствие инструмента, а не провал вёрстки
  console.log("[verify-prototype-mobile] chromium не запустился - рендер-проверка ПРОПУЩЕНА (это не провал).");
  console.log(`  причина: ${String(err && err.message ? err.message : err).split("\n")[0]}`);
  console.log("  установка:  npm i -D playwright");
  console.log("  затем:      npx playwright install chromium");
  process.exit(2);
}

const lines = [];
let failCount = 0;

try {
  for (const width of widths) {
    const context = await browser.newContext({
      viewport: { width, height: VIEWPORT_H },
      deviceScaleFactor: 1,
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();
    await page.goto(fileUrl, { waitUntil: "load" });
    await page.waitForTimeout(250); // дать отрисоваться: шрифты, инлайновый JS, раскладка
    const res = await page.evaluate(auditPage, cfg);
    await context.close();

    if (res.overflow > 1) {
      failCount++;
      lines.push(`  [${width}px] ГОРИЗОНТАЛЬНЫЙ СКРОЛЛ: документ ${res.docW}px при вьюпорте ${res.vw}px (+${res.overflow}px)`);
      if (res.culprits.length) {
        for (const c of res.culprits) {
          lines.push(`           виновник: ${c.where} - правый край ${c.right}px, ширина ${c.width}px`);
        }
      } else {
        lines.push("           виновника по правому краю не нашлось - смотри отрицательные отступы и position:absolute");
      }
    }
    const label = { font: "КЕГЛЬ", tap: "ЗОНА НАЖАТИЯ", field: "ПОЛЕ ВВОДА" };
    for (const f of res.findings) {
      failCount++;
      lines.push(`  [${width}px] ${label[f.kind] || f.kind}: ${f.where} - ${f.msg}`);
    }
  }
} finally {
  await browser.close();
}

// ---------- отчёт ----------
console.log(`[verify-prototype-mobile] ${htmlPath}`);
console.log(`  ширины: ${widths.join(", ")} px`);
for (const l of lines) console.log(l);

if (failCount > 0) {
  console.log("");
  console.log(`  ПРОВАЛОВ: ${failCount} (ширин проверено: ${widths.length})`);
  console.log("  Горизонтальный скролл чинить у виновного элемента, а не overflow-x:hidden на body:");
  console.log("  скрытая полоса не уменьшает блок, она прячет обрезанный край от нас, но не от заказчика.");
  process.exit(1);
}
console.log("  OK - на узких экранах нарушений нет.");
process.exit(0);
