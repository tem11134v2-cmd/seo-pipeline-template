#!/usr/bin/env node
// run.mjs - тесты /seo-strategiya: механический гейт verify-strategy.mjs, модель прогноза, сборщики сметы и docx.
// Запуск: .claude\scripts\_node.cmd .claude\tests\seo-strategiya\run.mjs
//
// Разделы:
//   1. Легаси verify-strategy.mjs (content без format "v2", шаг 6.5а старого формата):
//      чистый -> 0; цены в прозе тарифов (валюта / круглая тысяча) -> 2; секция 6 с ₽ не ловится -> 0;
//      стоп-паттерны -> 2; тире/буква Е-с-точками -> 2; нет раздела 4 -> 2; битый/нет JSON -> 1; тонкая проза -> 0.
//   2. Легаси прогноз денег (_forecast-money.mjs, эталоны этапа 8) + сценарный/легаси лист сметы
//      + блок СЦЕНАРНАЯ СОГЛАСОВАННОСТЬ. Старые стратегии пересобираются старыми путями (Р11) - числа не меняются.
//   3. v2 (программа 06.10.2026, docs/upgrade-program-2026-10-06-strategy-v2.md §8):
//      модель _forecast-model.mjs (монотонность тарифов, Старт ~ Рост на 3-м мес, Рост > Старт на 12-м,
//      прирост от m0, акция ПФ 1=2, конверсия от прототипа, экономический гейт); каталог _services.mjs
//      (ступени цены подстраниц с полом, лендинг, порядок PA -> SY -> KP -> FQ); build-forecast.mjs (exit 0/2/3,
//      экономика клиента, проценты -> доли); смета v2 (листы, формулы «Окупаемость» = forecast.json и модели,
//      «Разработка сайта»); docx v2 (маркеры, без «тариф», легаси v1); verify-strategy v2 (деньги и тарифы
//      в прозе, нет маркера, рассинхрон прогноза).
//
// Фикстуры синтезируются inline в песочнице .claude/tmp/seo-strategiya-test/run-<pid>: у каждого прогона
// своя папка, параллельные прогоны не стирают друг другу файлы. Зеленый прогон убирает свою папку,
// красный оставляет для разбора (папки старше 2 ч убирает следующий прогон).
// Exit 0 - все тесты прошли. Exit 1 - есть провал.

import { spawnSync, execFileSync } from "node:child_process";
import {
  readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, readdirSync, statSync, cpSync,
} from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { computeScenarioTariff, resolveActiveMonths, interpCheckpoints } from "../../scripts/_forecast-money.mjs";
import {
  computeAll, computeTariff, economicsChecks, costSeries, trafficSeries, CAL, HORIZON, MODEL_VERSION,
} from "../../scripts/_forecast-model.mjs";
import {
  devPrice, devSubpagesPrice, timelineFor, serviceMeta, canonicalId, DEV_OPTIONS,
} from "../../scripts/_services.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "../../..");
const SCRIPTS = join(PROJECT_ROOT, ".claude/scripts");
const SANDBOX_ROOT = join(PROJECT_ROOT, ".claude/tmp/seo-strategiya-test");
const SANDBOX = join(SANDBOX_ROOT, `run-${process.pid}`);

// === Мини-фреймворк (по образцу tests/metatags/run.mjs; шаги могут быть async) ===
let passed = 0;
let failed = 0;
const failures = [];

async function step(name, fn) {
  try {
    const result = await fn();
    if (result === true || result === undefined) {
      console.log(`  [test] ${name} ... PASS`);
      passed++;
    } else {
      console.log(`  [test] ${name} ... FAIL (${result})`);
      failed++;
      failures.push(`${name}: ${result}`);
    }
  } catch (err) {
    console.log(`  [test] ${name} ... FAIL (${err.message})`);
    failed++;
    failures.push(`${name}: ${err.message}`);
  }
}

// Запуск скрипта из .claude/scripts тем же node; stdout+stderr вместе (предупреждения сметы идут в stderr).
function runScript(script, ...args) {
  const r = spawnSync(process.execPath, [join(SCRIPTS, script), ...args], { encoding: "utf8" });
  return { code: r.status ?? 1, stdout: (r.stdout || "") + (r.stderr || "") };
}

function runVerify(dir) {
  return runScript("verify-strategy.mjs", dir);
}

function writeJson(p, obj) {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(obj, null, 2));
}

function readJsonFile(p) {
  return JSON.parse(readFileSync(p, "utf8"));
}

// === Песочница ===
console.log("=== /seo-strategiya: verify-strategy, модель прогноза, смета, docx ===");
console.log(`Sandbox: ${SANDBOX}`);
if (existsSync(SANDBOX_ROOT)) {
  // старые раскладки (до run-<pid>) и брошенные папки упавших прогонов старше 2 ч; свежие чужие не трогаем
  for (const name of readdirSync(SANDBOX_ROOT)) {
    const p = join(SANDBOX_ROOT, name);
    try {
      if (!name.startsWith("run-") || Date.now() - statSync(p).mtimeMs > 2 * 3600 * 1000) {
        rmSync(p, { recursive: true, force: true });
      }
    } catch {
      /* папку держит другой процесс - пропускаем */
    }
  }
}
if (existsSync(SANDBOX)) rmSync(SANDBOX, { recursive: true, force: true });
mkdirSync(SANDBOX, { recursive: true });

console.log("\n=== 1. Легаси verify-strategy.mjs (content без format v2) ===");

// ──────────────────────────────────────────────────────────────────────────
// Фикстура: полный чистый документ (6 разделов, 3 тарифа, без цен/стоп-слов/
// тире/буквы Е-с-точками). Раздел 6 содержит легитимные ₽ (декомпозиция выручки).
// ──────────────────────────────────────────────────────────────────────────

function cleanContent() {
  return {
    title_page: {
      title: "SEO-СТРАТЕГИЯ ПРОДВИЖЕНИЯ",
      domain: "example.ru",
      niche_oneliner: "Продажа окон в Москве и области",
      region: "Москва",
      date: "Июль 2026",
      author: "TIMUR SEO",
    },
    sections: [
      {
        id: "1",
        title: "Анализ текущей ситуации",
        blocks: [
          { type: "subheading", text: "1.1 Общие показатели сайта" },
          {
            type: "paragraph",
            text: "Сайт example.ru работает в нише продажи окон в Москве и области уже несколько лет. Домен зарегистрирован давно, накоплена определенная история, но рост посещаемости в последние месяцы заметно замедлился.",
          },
          { type: "table", columns: ["Показатель", "Значение"], rows: [["Домен", "example.ru"], ["ИКС", "40"]] },
          { type: "subheading", text: "1.3 Ключевые проблемы" },
          {
            type: "problem_block",
            title: "Низкая индексация каталога",
            why: "В индексе поисковой системы находится всего около трети страниц каталога, остальные не участвуют в поиске.",
            impact: "Часть ассортимента фактически невидима для покупателей, которые ищут товар через поиск.",
          },
        ],
      },
      {
        id: "2",
        title: "Анализ конкурентов",
        blocks: [
          {
            type: "paragraph",
            text: "Мы отобрали несколько доменов сопоставимого масштаба для сравнения по ключевым метрикам видимости и охвата ассортимента.",
          },
          { type: "table", columns: ["Домен", "ИКС"], rows: [["a.ru", "50"]] },
        ],
      },
      {
        id: "3",
        title: "Точки роста",
        blocks: [
          {
            type: "growth_point",
            name: "Расширение каталога",
            problem: "Каталог не покрывает заметную долю частотных запросов ниши, покупатели уходят к конкурентам.",
            consequences: "Теряется трафик и заявки по товарам, которых формально нет на сайте отдельными страницами.",
            solution: "Добавить недостающие категории и карточки товаров под конкретные частотные запросы покупателей.",
            evidence_table: { columns: ["Запрос", "WS"], rows: [["окна пвх купить", "4000"]] },
            competitor_facts: ["Конкурент a.ru закрывает эти запросы отдельными посадочными страницами."],
            summary: "Закрытие пробела даст дополнительный трафик по среднечастотным запросам покупателей.",
          },
          { type: "quick_wins", items: ["Обновить title на нескольких карточках товаров.", "Добавить перелинковку между категориями."] },
        ],
      },
      {
        id: "4",
        title: "Рекомендуемые направления работы",
        blocks: [
          {
            type: "tariff",
            name: "Старт",
            recommended: false,
            preamble: "Базовый вариант для быстрого старта продвижения на текущей платформе без глубокой переработки сайта.",
            services: [
              {
                name: "Базовая SEO-оптимизация",
                description: "Настройка технических параметров и метатегов ключевых страниц каталога и услуг.",
              },
            ],
            expected_result: "Рост видимости по базовым запросам в первые месяцы работы.",
            hint: "Подходит, если бюджет ограничен и нужен быстрый первый эффект от работ.",
          },
          {
            type: "tariff",
            name: "Рост",
            recommended: true,
            preamble: "Оптимальный баланс охвата запросов и скорости роста трафика для большинства проектов ниши.",
            services: [
              {
                name: "Расширение семантического ядра",
                description: "Добавление новых категорий и посадочных страниц под реальный спрос покупателей.",
              },
            ],
            expected_result: "Выход в топ-10 по приоритетным запросам в среднесрочной перспективе.",
            hint: "Рекомендуем для большинства проектов в этой нише как базовый рабочий вариант.",
          },
          {
            type: "tariff",
            name: "Максимум",
            recommended: false,
            preamble: "Максимальный охват направлений работы для лидерства по большинству запросов ниши.",
            services: [
              {
                name: "Полное покрытие семантики",
                description: "Проработка всех кластеров запросов и регулярный анализ активности конкурентов.",
              },
            ],
            expected_result: "Лидерство по большинству целевых запросов в долгосрочной перспективе.",
            hint: "Для проектов с высокой конкуренцией в нише и достаточным бюджетом на работы.",
          },
        ],
      },
      {
        id: "5",
        title: "Условия и ограничения",
        blocks: [
          { type: "paragraph", text: "5.1 Платформа: собственная CMS без специфичных ограничений для внедрения рекомендаций." },
          { type: "paragraph", text: "5.2 Прогноз основан на оперативном внедрении рекомендаций командой клиента и подрядчика." },
          { type: "paragraph", text: "5.3 SEO - конкурентный канал, прогноз может меняться при росте активности конкурентов в нише." },
        ],
      },
      {
        id: "6",
        title: "Прогноз результатов",
        blocks: [
          { type: "paragraph", text: "Прогноз рассчитан на тариф Рост как рекомендованный вариант работы по проекту." },
          {
            type: "table",
            columns: ["Показатель", "Сейчас", "3 мес", "6 мес", "12 мес"],
            rows: [["ТОП-10", "5", "12", "20", "30"]],
          },
          {
            type: "paragraph",
            text: "Перевели прогноз трафика в деньги через средний чек, чтобы показать оценку потенциала выручки проекта.",
          },
          {
            type: "table",
            columns: ["Показатель", "Сейчас", "Через 6 мес", "Через 12 мес"],
            rows: [["Выручка (₽)", "175 000", "1 050 000", "1 800 000"]],
          },
          {
            type: "paragraph",
            text: "Допущения: конверсия в заявку около двух процентов, заявка в продажу около трети обращений, средний чек 25 000 ₽ (оценочный). Оценка, не гарантия.",
          },
          { type: "conditions", items: ["Своевременное согласование метатегов и текстов.", "Доступ к CMS для внедрения технических правок."] },
        ],
      },
    ],
  };
}

// Глубокая копия через JSON (фикстуры содержат только простые значения)
function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function writeContent(name, doc) {
  const dir = join(SANDBOX, name);
  writeJson(join(dir, "seo-strategiya_content.json"), doc);
  return dir;
}

function findTariff(doc, name) {
  const s4 = doc.sections.find((s) => s.id === "4");
  return s4.blocks.find((b) => b.type === "tariff" && b.name === name);
}

// ──────────────────────────────────────────────────────────────────────────
// 1. Чистый контент -> exit 0
// ──────────────────────────────────────────────────────────────────────────

await step("чистый контент -> exit 0", () => {
  const dir = writeContent("clean", cleanContent());
  const r = runVerify(dir);
  if (r.code !== 0) return `exit ${r.code}: ${r.stdout}`;
  return true;
});

// ──────────────────────────────────────────────────────────────────────────
// 2. Цена в прозе тарифа (валюта) -> exit 2
// ──────────────────────────────────────────────────────────────────────────

await step("цена с валютой в hint тарифа -> exit 2, ЦЕНЫ + фрагмент", () => {
  const doc = clone(cleanContent());
  const rost = findTariff(doc, "Рост");
  rost.hint = "Стоимость услуг за 120 000 руб в месяц по этому варианту.";
  const dir = writeContent("price-currency", doc);
  const r = runVerify(dir);
  if (r.code !== 2) return `exit ${r.code} (expect 2): ${r.stdout}`;
  if (!/ЦЕНЫ В ПРОЗЕ ТАРИФОВ/.test(r.stdout)) return "заголовок ЦЕНЫ не найден";
  if (!/120 000/.test(r.stdout)) return "фрагмент с ценой не найден";
  return true;
});

// ──────────────────────────────────────────────────────────────────────────
// 3. Круглая тысяча без валюты в секции 4 -> exit 2
// ──────────────────────────────────────────────────────────────────────────

await step("круглая тысяча без валюты в services[].description -> exit 2", () => {
  const doc = clone(cleanContent());
  const start = findTariff(doc, "Старт");
  start.services[0].description = "Работа ведется от 25 000 в зависимости от объема каталога и услуг.";
  const dir = writeContent("price-round", doc);
  const r = runVerify(dir);
  if (r.code !== 2) return `exit ${r.code} (expect 2): ${r.stdout}`;
  if (!/ЦЕНЫ В ПРОЗЕ ТАРИФОВ/.test(r.stdout)) return "заголовок ЦЕНЫ не найден";
  return true;
});

// ──────────────────────────────────────────────────────────────────────────
// 4. Число ₽ в секции 6 (декомпозиция) НЕ ловится -> exit 0
// ──────────────────────────────────────────────────────────────────────────

await step("легитимные ₽ и суммы в секции 6 не ловятся ценовым сканом -> exit 0", () => {
  const dir = join(SANDBOX, "clean"); // уже содержит ₽/25 000 ₽ в секции 6 (см. cleanContent)
  const r = runVerify(dir);
  if (r.code !== 0) return `exit ${r.code}: ${r.stdout}`;
  if (/ЦЕНЫ В ПРОЗЕ ТАРИФОВ/.test(r.stdout)) return "ценовой скан сработал на секции 6 (не должен)";
  return true;
});

// ──────────────────────────────────────────────────────────────────────────
// 5. Стоп-паттерн -> exit 2
// ──────────────────────────────────────────────────────────────────────────

await step("стоп-паттерн «комплексный подход» в paragraph.text -> exit 2", () => {
  const doc = clone(cleanContent());
  const s2 = doc.sections.find((s) => s.id === "2");
  const para = s2.blocks.find((b) => b.type === "paragraph");
  para.text = "Мы применяем комплексный подход при отборе конкурентов для сравнения по метрикам.";
  const dir = writeContent("stop-pattern", doc);
  const r = runVerify(dir);
  if (r.code !== 2) return `exit ${r.code} (expect 2): ${r.stdout}`;
  if (!/СТОП-ПАТТЕРН/.test(r.stdout)) return "заголовок СТОП-ПАТТЕРН не найден";
  return true;
});

// ──────────────────────────────────────────────────────────────────────────
// 6. Тире/буква Е-с-точками -> exit 2
// ──────────────────────────────────────────────────────────────────────────

await step("длинное тире в прозе -> exit 2", () => {
  const doc = clone(cleanContent());
  const s1 = doc.sections.find((s) => s.id === "1");
  const para = s1.blocks.find((b) => b.type === "paragraph");
  para.text += " Рост — ключевая цель проекта на этот год.";
  const dir = writeContent("dash", doc);
  const r = runVerify(dir);
  if (r.code !== 2) return `exit ${r.code} (expect 2): ${r.stdout}`;
  if (!/ТИРЕ\/Е-С-ТОЧКАМИ/.test(r.stdout)) return "заголовок ТИРЕ не найден";
  return true;
});

await step("буква Е-с-точками в служебном поле title_page.author -> exit 2", () => {
  const doc = clone(cleanContent());
  doc.title_page.author = "Тимур Ёлкин";
  const dir = writeContent("yo", doc);
  const r = runVerify(dir);
  if (r.code !== 2) return `exit ${r.code} (expect 2): ${r.stdout}`;
  if (!/ТИРЕ\/Е-С-ТОЧКАМИ/.test(r.stdout)) return "заголовок ТИРЕ/Е-С-ТОЧКАМИ не найден";
  return true;
});

// ──────────────────────────────────────────────────────────────────────────
// 7. Нет секции 4 -> exit 2 «СТРУКТУРА»
// ──────────────────────────────────────────────────────────────────────────

await step("нет раздела id=4 -> exit 2, СТРУКТУРА", () => {
  const doc = clone(cleanContent());
  doc.sections = doc.sections.filter((s) => s.id !== "4");
  const dir = writeContent("no-section4", doc);
  const r = runVerify(dir);
  if (r.code !== 2) return `exit ${r.code} (expect 2): ${r.stdout}`;
  if (!/СТРУКТУРА/.test(r.stdout)) return "заголовок СТРУКТУРА не найден";
  return true;
});

// ──────────────────────────────────────────────────────────────────────────
// 8. Битый/отсутствующий JSON -> exit 1
// ──────────────────────────────────────────────────────────────────────────

await step("отсутствующий content.json -> exit 1", () => {
  const dir = join(SANDBOX, "missing");
  mkdirSync(dir, { recursive: true });
  const r = runVerify(dir);
  if (r.code !== 1) return `exit ${r.code} (expect 1): ${r.stdout}`;
  return true;
});

await step("битый JSON -> exit 1", () => {
  const dir = join(SANDBOX, "broken");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "seo-strategiya_content.json"), "{ not valid json ][");
  const r = runVerify(dir);
  if (r.code !== 1) return `exit ${r.code} (expect 1): ${r.stdout}`;
  return true;
});

// ──────────────────────────────────────────────────────────────────────────
// 9. Объем-warning не блокирует
// ──────────────────────────────────────────────────────────────────────────

await step("тонкая проза (< 3500 симв.) но чистая -> exit 0, ОБЪЕМ в выводе", () => {
  const doc = {
    title_page: { title: "SEO-СТРАТЕГИЯ ПРОДВИЖЕНИЯ", domain: "thin.ru", niche_oneliner: "Ниша", region: "Регион", date: "Июль 2026", author: "TIMUR SEO" },
    sections: [
      {
        id: "4",
        title: "Рекомендуемые направления работы",
        blocks: [
          {
            type: "tariff",
            name: "Рост",
            recommended: true,
            preamble: "Короткое описание варианта работы без лишних деталей.",
            services: [{ name: "Базовая SEO-оптимизация", description: "Настройка технических параметров сайта." }],
            expected_result: "Рост видимости в первые месяцы.",
            hint: "Подходит для старта работ по проекту.",
          },
        ],
      },
    ],
  };
  const dir = writeContent("thin", doc);
  const r = runVerify(dir);
  if (r.code !== 0) return `exit ${r.code} (expect 0): ${r.stdout}`;
  if (!/ОБЪЕМ/.test(r.stdout)) return "заголовок ОБЪЕМ не найден";
  if (!/подозрительно тонкая/.test(r.stdout)) return "предупреждение о тонкой прозе не найдено";
  return true;
});

// ──────────────────────────────────────────────────────────────────────────
// ЭТАП 8 (Пакет B): _forecast-money.mjs + верификация сценарной согласованности
// ──────────────────────────────────────────────────────────────────────────
//
// Эталонная фикстура (числа посчитаны вручную и сверены прямым запуском модуля -
// см. .claude/tmp/stage-8-spec.md §7.1): тариф "growth" onetime=68000, monthly=50000
// (как в примере .claude/agents/tariff-architect.md), assumptions - two_step,
// cr=0.02, close=0.3, avg_check=25000, margin=0.35. Два сценария: "Вход 3-6 мес"
// (active_months=4 для growth) и "Год работы" (active_months=12).

console.log("\n=== 2. Легаси: юнит-тесты _forecast-money.mjs (этап 8) ===");

const REF_ASSUMPTIONS = { model: "two_step", conversion_rate: 0.02, close_rate: 0.3, avg_check: 25000, margin: 0.35 };
const REF_ONETIME = 68000;
const REF_MONTHLY = 50000;
const REF_ENTRY_CP = { m0: 1200, m3: 3000, m6: 4600, m9: 5200, m12: 5400 };
const REF_ENTRY_ACTIVE_MONTHS = 4;
const REF_YEAR_CP = { m0: 1200, m3: 3500, m6: 7000, m9: 9600, m12: 12000 };
const REF_YEAR_ACTIVE_MONTHS = 12;

function refEntry() {
  return computeScenarioTariff({
    assumptions: REF_ASSUMPTIONS,
    checkpoints: REF_ENTRY_CP,
    activeMonths: REF_ENTRY_ACTIVE_MONTHS,
    tariffKey: "growth",
    onetime: REF_ONETIME,
    monthly: REF_MONTHLY,
  });
}

function refYear() {
  return computeScenarioTariff({
    assumptions: REF_ASSUMPTIONS,
    checkpoints: REF_YEAR_CP,
    activeMonths: REF_YEAR_ACTIVE_MONTHS,
    tariffKey: "growth",
    onetime: REF_ONETIME,
    monthly: REF_MONTHLY,
  });
}

await step("resolveActiveMonths: объект {start,growth,max} -> число по ключу тарифа", () => {
  if (resolveActiveMonths({ start: 3, growth: 4, max: 6 }, "growth") !== 4) return "growth !== 4";
  if (resolveActiveMonths({ start: 3, growth: 4, max: 6 }, "start") !== 3) return "start !== 3";
  if (resolveActiveMonths({ start: 3, growth: 4, max: 6 }, "max") !== 6) return "max !== 6";
  return true;
});

await step("resolveActiveMonths: число применяется одинаково к любому тарифу", () => {
  if (resolveActiveMonths(5, "start") !== 5) return `start=${resolveActiveMonths(5, "start")}`;
  if (resolveActiveMonths(5, "growth") !== 5) return `growth=${resolveActiveMonths(5, "growth")}`;
  if (resolveActiveMonths(5, "max") !== 5) return `max=${resolveActiveMonths(5, "max")}`;
  return true;
});

await step("resolveActiveMonths: кламп 0 -> 1, 20 -> 12", () => {
  if (resolveActiveMonths(0, "growth") !== 1) return `0 -> ${resolveActiveMonths(0, "growth")}`;
  if (resolveActiveMonths(20, "growth") !== 12) return `20 -> ${resolveActiveMonths(20, "growth")}`;
  return true;
});

await step("interpCheckpoints: точное значение в контрольной точке (m6)", () => {
  const v = interpCheckpoints({ m0: 1200, m6: 7000 }, 6);
  if (v !== 7000) return `got ${v} (expect 7000)`;
  return true;
});

await step("interpCheckpoints: линейная середина между точками (m3 между m0=1200 и m6=7000)", () => {
  const v = interpCheckpoints({ m0: 1200, m6: 7000 }, 3);
  if (v !== 4100) return `got ${v} (expect 4100)`;
  return true;
});

await step('computeScenarioTariff: сценарий "Вход 3-6 мес" (growth, active_months=4) - эталон вручную', () => {
  const res = refEntry();
  if (res.costMonths !== 4) return `costMonths=${res.costMonths} (expect 4)`;
  if (res.yearCost !== 268000) return `yearCost=${res.yearCost} (expect 268000)`;
  if (res.traffic12 !== 5400) return `traffic12=${res.traffic12} (expect 5400)`;
  if (res.yearGross !== 7560000) return `yearGross=${res.yearGross} (expect 7560000)`;
  if (res.yearProfit !== 2646000) return `yearProfit=${res.yearProfit} (expect 2646000)`;
  if (res.yearNet !== 2378000) return `yearNet=${res.yearNet} (expect 2378000)`;
  if (res.romi !== 887) return `romi=${res.romi} (expect 887)`;
  if (res.payback !== 2) return `payback=${res.payback} (expect 2)`;
  return true;
});

await step('computeScenarioTariff: сценарий "Год работы" (growth, active_months=12) - эталон вручную', () => {
  const res = refYear();
  if (res.costMonths !== 12) return `costMonths=${res.costMonths} (expect 12)`;
  if (res.yearCost !== 668000) return `yearCost=${res.yearCost} (expect 668000)`;
  if (res.traffic12 !== 12000) return `traffic12=${res.traffic12} (expect 12000)`;
  if (res.leads12 !== 240) return `leads12=${res.leads12} (expect 240)`;
  if (res.sales12 !== 72) return `sales12=${res.sales12} (expect 72)`;
  if (res.revMonth12 !== 1800000) return `revMonth12=${res.revMonth12} (expect 1800000)`;
  if (res.yearGross !== 12825000) return `yearGross=${res.yearGross} (expect 12825000)`;
  if (res.yearProfit !== 4488750) return `yearProfit=${res.yearProfit} (expect 4488750)`;
  if (res.yearNet !== 3820750) return `yearNet=${res.yearNet} (expect 3820750)`;
  if (res.romi !== 572) return `romi=${res.romi} (expect 572)`;
  if (res.payback !== 2) return `payback=${res.payback} (expect 2)`;
  return true;
});

await step('Санити: "Год работы" >= "Вход" на m12 (revenue, yearGross)', () => {
  const entry = refEntry();
  const year = refYear();
  if (year.revMonth12 < entry.revMonth12) return `revMonth12 год ${year.revMonth12} < вход ${entry.revMonth12}`;
  if (year.yearGross < entry.yearGross) return `yearGross год ${year.yearGross} < вход ${entry.yearGross}`;
  return true;
});

await step('Регресс-ловушка: yearCost "Входа" != onetime+monthly*12 (боевой фикс на месте)', () => {
  const entry = refEntry();
  const oldStyleCost = REF_ONETIME + REF_MONTHLY * 12; // старая формула (до этапа 8): monthly*12 всегда
  if (entry.yearCost === oldStyleCost) {
    return `yearCost=${entry.yearCost} совпал со старой формулой monthly*12=${oldStyleCost} - регрессия рассинхрона`;
  }
  if (entry.yearCost !== 268000) return `yearCost=${entry.yearCost} (expect 268000)`;
  return true;
});

// ──────────────────────────────────────────────────────────────────────────
// Интеграция: build-smeta-xlsx.mjs - сценарный лист / legacy-лист (этап 8)
// ──────────────────────────────────────────────────────────────────────────

console.log("\n=== 2. Легаси: build-smeta-xlsx.mjs (сценарный/legacy рендер, этап 8) ===");

function refTariffsJson() {
  return {
    start: { onetime: [], monthly: [], total_onetime: 10000, total_monthly: 25000, deadline_total: "3 дня" },
    growth: {
      onetime: [],
      monthly: [],
      total_onetime: REF_ONETIME,
      total_monthly: REF_MONTHLY,
      deadline_total: "2-3 недели",
    },
    max: { onetime: [], monthly: [], total_onetime: 140000, total_monthly: 125000, deadline_total: "3-4 недели" },
  };
}

function refForecastScenarios(mutate) {
  const fsData = {
    assumptions: { ...REF_ASSUMPTIONS, avg_check_source: "estimated", basis: "SEO-трафик, масштабируется по тарифам" },
    scenarios: [
      {
        id: "entry_3_6",
        label: "Вход 3-6 мес",
        recommended: false,
        active_months: { start: 3, growth: REF_ENTRY_ACTIVE_MONTHS, max: 6 },
        traffic_checkpoints: { ...REF_ENTRY_CP },
        methodology_note: "Тестовая методичка входа.",
      },
      {
        id: "year",
        label: "Год работы",
        recommended: true,
        active_months: { start: 12, growth: REF_YEAR_ACTIVE_MONTHS, max: 12 },
        traffic_checkpoints: { ...REF_YEAR_CP },
        methodology_note: "Тестовая методичка года.",
      },
    ],
  };
  return mutate ? mutate(fsData) : fsData;
}

function writeSmetaFixture(name, { forecastScenarios, legacy } = {}) {
  const dir = join(SANDBOX, name);
  writeJson(join(dir, "inputs.json"), { domain: "example.ru", slug: "example-ru", date: "Июль 2026" });
  writeJson(join(dir, "tariffs.json"), refTariffsJson());
  const data = {};
  if (forecastScenarios) data.forecast_scenarios = forecastScenarios;
  if (legacy) {
    data.decomposition = {
      model: "two_step",
      avg_check: 25000,
      avg_check_source: "estimated",
      conversion_rate: 0.02,
      close_rate: 0.3,
      margin: 0.35,
      basis: "SEO-трафик тарифа Рост",
      rows: [{ period: "12 мес", traffic: 12000, leads: 240, sales: 72, revenue: 1800000 }],
    };
    data.forecast = [
      { period: "сейчас", top10: 12, top50: 89, dr: 5, traffic_month: 1200, pages_index: 38 },
      { period: "12 мес", top10: 90, top50: 500, dr: 18, traffic_month: 12000, pages_index: 95 },
    ];
  }
  writeJson(join(dir, "seo-strategiya_data.json"), data);
  return dir;
}

function runBuildSmeta(dir) {
  return runScript("build-smeta-xlsx.mjs", dir);
}

// exceljs - async API; легаси-проверка читает через синхронный спавн отдельного node-скрипта
// (тот же прием, что tests/metatags/run.mjs).
function checkScenarioXlsx(path) {
  const code = `
import ExcelJS from "exceljs";
const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(${JSON.stringify(path)});
const ws = wb.getWorksheet("Декомпозиция и окупаемость");
if (!ws) { process.stdout.write(JSON.stringify({ sheetFound: false })); process.exit(0); }
const rows = [];
for (let r = 1; r <= ws.rowCount; r++) rows.push([ws.getCell(r,1).value, ws.getCell(r,2).value, ws.getCell(r,3).value]);
let headerCount = 0;
const tariffBlocks = [];
for (let i = 0; i < rows.length; i++) {
  const a = rows[i][0], b = rows[i][1], c = rows[i][2];
  if (b === "Вход 3-6 мес" && c === "Год работы") headerCount++;
  if (typeof a === "string" && a.includes("ТАРИФ «")) tariffBlocks.push({ idx: i, text: a });
}
function findLabelRow(startIdx, endIdx, re) {
  for (let i = startIdx; i < endIdx; i++) {
    const label = rows[i][0];
    if (typeof label === "string" && re.test(label)) return rows[i];
  }
  return null;
}
const growthIdx = tariffBlocks.findIndex((t) => /РОСТ/.test(t.text));
const growthStart = growthIdx >= 0 ? tariffBlocks[growthIdx].idx : -1;
const growthEnd = growthIdx >= 0 && growthIdx + 1 < tariffBlocks.length ? tariffBlocks[growthIdx + 1].idx : rows.length;
const romiRow = growthStart >= 0 ? findLabelRow(growthStart, growthEnd, /ROMI/) : null;
const paybackRow = growthStart >= 0 ? findLabelRow(growthStart, growthEnd, /окупаемости/) : null;
const summaryFound = rows.some((r) => typeof r[0] === "string" && r[0].includes("Рекомендуем годовой формат"));
const noticeFound = rows.some((r) => typeof r[0] === "string" && r[0].includes("Старый формат"));
process.stdout.write(JSON.stringify({
  sheetFound: true, headerCount, tariffBlockCount: tariffBlocks.length,
  romiEntry: romiRow ? romiRow[1] : null, romiYear: romiRow ? romiRow[2] : null,
  paybackEntry: paybackRow ? paybackRow[1] : null, paybackYear: paybackRow ? paybackRow[2] : null,
  summaryFound, noticeFound,
}));
`;
  const tmp = join(SANDBOX, "_smetacheck.mjs");
  writeFileSync(tmp, code);
  const out = execFileSync(process.execPath, [tmp], { encoding: "utf8" });
  return JSON.parse(out);
}

await step("build-smeta-xlsx: сценарный лист - 3 тарифа x 2 сценария, ROMI/окупаемость совпадают с пересчетом", () => {
  const dir = writeSmetaFixture("smeta-scenario", { forecastScenarios: refForecastScenarios() });
  const r = runBuildSmeta(dir);
  if (r.code !== 0) return `exit ${r.code}: ${r.stdout}`;
  if (!/scenario sheet/.test(r.stdout)) return `лог не содержит "scenario sheet": ${r.stdout}`;
  const xlsxPath = join(dir, "Smeta_example-ru.xlsx");
  if (!existsSync(xlsxPath)) return `xlsx не создан: ${xlsxPath}`;
  const info = checkScenarioXlsx(xlsxPath);
  if (!info.sheetFound) return `лист "Декомпозиция и окупаемость" не найден`;
  if (info.headerCount !== 3) return `заголовков "Вход 3-6 мес"/"Год работы" - ${info.headerCount} (expect 3, по числу тарифов)`;
  if (info.tariffBlockCount !== 3) return `блоков ТАРИФ «...» - ${info.tariffBlockCount} (expect 3)`;
  const expectedRomiYear = refYear().romi;
  if (info.romiYear !== `${expectedRomiYear}%`) return `romiYear=${info.romiYear} (expect ${expectedRomiYear}%)`;
  const expectedPaybackYear = refYear().payback;
  const expectedPaybackYearStr = expectedPaybackYear ? `${expectedPaybackYear} мес` : "> 12 мес";
  if (info.paybackYear !== expectedPaybackYearStr) return `paybackYear=${info.paybackYear} (expect ${expectedPaybackYearStr})`;
  if (!info.summaryFound) return `строка "Рекомендуем годовой формат" не найдена`;
  return true;
});

await step('build-smeta-xlsx: legacy-формат (decomposition+forecast, без forecast_scenarios) -> старый лист с пометкой "Старый формат"', () => {
  const dir = writeSmetaFixture("smeta-legacy", { legacy: true });
  const r = runBuildSmeta(dir);
  if (r.code !== 0) return `exit ${r.code}: ${r.stdout}`;
  if (!/legacy sheet/.test(r.stdout)) return `лог не содержит "legacy sheet": ${r.stdout}`;
  const xlsxPath = join(dir, "Smeta_example-ru.xlsx");
  const info = checkScenarioXlsx(xlsxPath);
  if (!info.sheetFound) return `лист не найден`;
  if (!info.noticeFound) return `пометка "Старый формат" не найдена на листе`;
  return true;
});

// ──────────────────────────────────────────────────────────────────────────
// Интеграция: verify-strategy.mjs - блок СЦЕНАРНАЯ СОГЛАСОВАННОСТЬ (этап 8)
// ──────────────────────────────────────────────────────────────────────────

console.log("\n=== 2. Легаси: verify-strategy.mjs - СЦЕНАРНАЯ СОГЛАСОВАННОСТЬ (этап 8) ===");

function writeVerifyScenarioFixture(name, { forecastScenarios, legacy } = {}) {
  const dir = writeContent(name, cleanContent());
  writeJson(join(dir, "tariffs.json"), refTariffsJson());
  const data = {};
  if (forecastScenarios) data.forecast_scenarios = forecastScenarios;
  if (legacy) {
    data.decomposition = {
      model: "two_step",
      avg_check: 25000,
      conversion_rate: 0.02,
      close_rate: 0.3,
      margin: 0.35,
      rows: [],
    };
    data.forecast = [{ period: "сейчас", top10: 12, top50: 89, dr: 5, traffic_month: 1200, pages_index: 38 }];
  }
  writeJson(join(dir, "seo-strategiya_data.json"), data);
  return dir;
}

await step("verify-strategy: чистый forecast_scenarios (2 сценария, cost/ROMI сходятся) -> exit 0, СЦЕНАРНАЯ СОГЛАСОВАННОСТЬ: OK", () => {
  const dir = writeVerifyScenarioFixture("verify-scenario-clean", { forecastScenarios: refForecastScenarios() });
  const r = runVerify(dir);
  if (r.code !== 0) return `exit ${r.code}: ${r.stdout}`;
  if (!/СЦЕНАРНАЯ СОГЛАСОВАННОСТЬ/.test(r.stdout)) return "заголовок СЦЕНАРНАЯ СОГЛАСОВАННОСТЬ не найден";
  if (!/СЦЕНАРНАЯ СОГЛАСОВАННОСТЬ: OK/.test(r.stdout)) return `ожидался "СЦЕНАРНАЯ СОГЛАСОВАННОСТЬ: OK": ${r.stdout}`;
  return true;
});

await step('verify-strategy: рассинхрон - recommended-сценарий "Год" с active_months=4 (вместо 12) -> exit 2', () => {
  const mutated = refForecastScenarios((fsData) => {
    const year = fsData.scenarios.find((s) => s.id === "year");
    year.active_months = { start: 4, growth: 4, max: 4 }; // затраты как за 4 мес при заявленном полном годе
    return fsData;
  });
  const dir = writeVerifyScenarioFixture("verify-scenario-mismatch", { forecastScenarios: mutated });
  const r = runVerify(dir);
  if (r.code !== 2) return `exit ${r.code} (expect 2): ${r.stdout}`;
  if (!/СЦЕНАРНАЯ СОГЛАСОВАННОСТЬ/.test(r.stdout)) return "заголовок не найден";
  if (!/active_months=12/.test(r.stdout)) return `нарушение про active_months=12 не найдено: ${r.stdout}`;
  return true;
});

await step("verify-strategy: немонотонная кривая (checkpoints года убывают) -> exit 2", () => {
  const mutated = refForecastScenarios((fsData) => {
    const year = fsData.scenarios.find((s) => s.id === "year");
    year.traffic_checkpoints = { m0: 1200, m3: 3500, m6: 7000, m9: 6000, m12: 12000 }; // m9 < m6 - убывание
    return fsData;
  });
  const dir = writeVerifyScenarioFixture("verify-scenario-nonmono", { forecastScenarios: mutated });
  const r = runVerify(dir);
  if (r.code !== 2) return `exit ${r.code} (expect 2): ${r.stdout}`;
  if (!/СЦЕНАРНАЯ СОГЛАСОВАННОСТЬ/.test(r.stdout)) return "заголовок не найден";
  if (!/checkpoints убывают/.test(r.stdout)) return `нарушение про checkpoints не найдено: ${r.stdout}`;
  return true;
});

await step('verify-strategy: санити-нарушение - revenue "Года" ниже "Входа" на m12 -> exit 2', () => {
  const mutated = refForecastScenarios((fsData) => {
    const entry = fsData.scenarios.find((s) => s.id === "entry_3_6");
    const year = fsData.scenarios.find((s) => s.id === "year");
    // Меняем местами кривые - у "года" внезапно ниже трафик на m12, чем у "входа".
    const tmp = entry.traffic_checkpoints;
    entry.traffic_checkpoints = year.traffic_checkpoints;
    year.traffic_checkpoints = tmp;
    return fsData;
  });
  const dir = writeVerifyScenarioFixture("verify-scenario-revenue-sanity", { forecastScenarios: mutated });
  const r = runVerify(dir);
  if (r.code !== 2) return `exit ${r.code} (expect 2): ${r.stdout}`;
  if (!/revenue года/.test(r.stdout)) return `нарушение про revenue года не найдено: ${r.stdout}`;
  return true;
});

await step('verify-strategy: legacy-данные (decomposition+forecast, без forecast_scenarios) -> exit 0, "нет (legacy)"', () => {
  const dir = writeVerifyScenarioFixture("verify-scenario-legacy", { legacy: true });
  const r = runVerify(dir);
  if (r.code !== 0) return `exit ${r.code}: ${r.stdout}`;
  if (!/нет forecast_scenarios \(legacy\)/.test(r.stdout)) return `сообщение "нет forecast_scenarios (legacy)" не найдено: ${r.stdout}`;
  return true;
});

// ══════════════════════════════════════════════════════════════════════════
// 3. v2 (программа 06.10.2026)
// ══════════════════════════════════════════════════════════════════════════
//
// Опорная фикстура: сайт услуг с нормальной базой (ремонт квартир, 400 визитов из поиска, 12 коммерческих
// страниц, структура даст еще 12), локальный бизнес с подтвержденной карточкой. Тарифы вложены по RULES.md:
// Рост = Старт + PA/SY/KP + Карты (MT заменен на SY - метатеги входят в структуру), Максимум = Рост +
// FQ/IT/статьи/ссылки (PF -> PFP, ART -> AR). Акция ПФ 1=2 - во всех тарифах с ПФ.

const V2_FI = {
  business_type: "services",
  competition: "medium",
  t0: 400,
  t0_source: "keyso",
  pages: { existing_commercial: 12, planned_new: 12, catalog_cards: 0 },
  demand: { commercial_month: 20000, info_month: 6000, basis: "сумма точных частот 40 маркеров коммерческих кластеров по региону 54 (тестовая фикстура)" },
  local: true,
  maps_card: "verified",
  tech_critical: false,
  has_positions: true,
  site_age_months: 36,
  implementation_lag_shift: 0,
  competitors_traffic: { median: 1800, leader: 6000, basis: "Keyso domains_batch (тестовая фикстура)" },
  economics: {
    avg_check: 40000, avg_check_source: "estimated", conversion_rate: 0.05, close_rate: 0.3, margin: 0.4,
    model: "two_step", basis: "тестовая фикстура",
  },
};

function v2Fi(patch = {}) {
  return { ...clone(V2_FI), ...patch };
}

function v2Tariffs() {
  const pf2 = { type: "pf_2for1", reason: "разработка сайта у нас - второй месяц внешнего продвижения в подарок" };
  return {
    diagnostics: { has_positions: true, site_profile: "established", local_with_address: true, maps_card: "verified" },
    start: {
      onetime: [{ id: "FA", price: 25000 }, { id: "MT", price: 10000 }, { id: "ART", price: 0, regular_price: 3000, promo: true }],
      monthly: [{ id: "PF", price: 25000 }, { id: "RP", price: 0 }],
      promos: [pf2],
      total_onetime: 35000,
      total_monthly: 25000,
      hint: "Быстрый старт на существующих страницах: технический аудит, метатеги и внешнее продвижение в Яндексе.",
    },
    growth: {
      onetime: [
        { id: "FA", price: 25000 }, { id: "PA", price: 5000 }, { id: "SY", price: 25000 }, { id: "KP", price: 25000 },
        { id: "ART", price: 0, regular_price: 3000, promo: true },
      ],
      monthly: [{ id: "PF", price: 25000 }, { id: "YM", price: 25000 }, { id: "RP", price: 0 }],
      promos: [pf2],
      total_onetime: 80000,
      total_monthly: 50000,
      deadline_total: "4-5 недель",
      hint: "Новые страницы под спрос с текстами по образцу лидеров и активность в Картах: к 6-12 мес трафик и обращения заметно выше Старта.",
    },
    max: {
      onetime: [
        { id: "FA", price: 25000 }, { id: "PA", price: 5000 }, { id: "SY", price: 25000 }, { id: "KP", price: 25000 },
        { id: "FQ", price: 25000 }, { id: "IT", price: 10000 },
      ],
      monthly: [
        { id: "PFP", price: 45000 }, { id: "YM", price: 25000 }, { id: "AR", price: 35000 }, { id: "LA", price: 45000 },
        { id: "RP", price: 0 },
      ],
      promos: [pf2],
      total_onetime: 115000,
      total_monthly: 150000,
      hint: "Все из Роста плюс FAQ с n-граммами, статьи и ссылки - максимальный охват за год.",
    },
    site_dev: {
      recommended: true, format: "multipage", pages: 30, home_blocks: 10,
      reason: "сайт на конструкторе, страниц услуг мало", promo_note: "при заказе разработки у нас - акция ПФ 1=2",
    },
    economics_round: 0,
  };
}

const V2_INPUTS = {
  url_raw: "https://remont-x.ru/", domain: "remont-x.ru", slug: "remont-x-ru", date: "Октябрь 2026",
  region: "Екатеринбург", avg_check: null, conversion_rate: null, close_rate: null, margin: null, we_develop: true,
};

// Content v2 (4 раздела тезисами, маркеры сборщика, без денег и тарифов в прозе). Числа в прозе - из фикстуры.
function v2Content() {
  return {
    format: "v2",
    title_page: {
      title: "SEO-стратегия", domain: "remont-x.ru", niche_oneliner: "Ремонт квартир под ключ в Екатеринбурге",
      region: "Екатеринбург", date: "Октябрь 2026", author: "TIMUR SEO",
    },
    summary: {
      headline: "Сайт виден в поиске только частично: 12 страниц услуг против 60 у лидера, спрос в регионе большой.",
      points: [
        "Спрос на ремонт квартир в Екатеринбурге около 20 000 запросов в месяц, а сайт получает около 400 визитов.",
        "Лидеры берут спрос отдельными страницами под каждую услугу и сильными коммерческими блоками.",
        "План на год: структура под спрос, тексты и прототип по лидерам, ускорение в Яндексе и Картах.",
      ],
    },
    sections: [
      {
        key: "situation",
        title: "Где вы сейчас",
        blocks: [
          { type: "paragraph", text: "Сайт remont-x.ru работает третий год, поиск приводит около 400 визитов в месяц. В индексе 12 коммерческих страниц, и большую часть запросов ниши сайт закрывает одной общей страницей услуг." },
          { type: "kpi_row", items: [
            { value: "400", label: "визитов в месяц из поиска", tone: "neutral" },
            { value: "12", label: "страниц услуг в индексе", tone: "bad" },
            { value: "20 000", label: "запросов в месяц в регионе", tone: "accent" },
          ] },
          { type: "issues", title: "Что мешает расти", items: [
            { title: "Нет страниц под спрос", text: "Под ремонт ванной, санузла, новостройки и вторички нет отдельных страниц, поэтому поиск не показывает сайт по этим запросам.", severity: "high" },
            { title: "Ошибки индексации", text: "Часть страниц закрыта от робота, дубли отдают одинаковые заголовки, карта сайта устарела больше чем на год.", severity: "medium" },
            { title: "Слабые коммерческие блоки", text: "На страницах нет калькулятора, примеров работ с фото до и после, гарантий по договору и понятных сроков.", severity: "low" },
          ] },
          { type: "money_lost" },
          { type: "callout", tone: "warning", title: "Почему это важно сейчас", text: "Лидеры ниши уже забирают основную часть спроса. Чем позже появятся страницы под запросы, тем дольше их придется догонять по поведенческим сигналам." },
        ],
      },
      {
        key: "competitors",
        title: "Кто в топе и почему",
        blocks: [
          { type: "paragraph", text: "В топе по главным запросам стабильно держатся пять компаний. У медианного конкурента около 1 800 визитов в месяц, у лидера около 6 000. Разрыв объясняется не возрастом домена, а составом и качеством страниц." },
          { type: "bars", title: "Трафик из поиска в месяц", unit: "визитов", items: [
            { label: "Лидер ниши", value: 6000 }, { label: "Медиана топа", value: 1800 }, { label: "Ваш сайт", value: 400, highlight: true },
          ] },
          { type: "compare", columns: ["Элемент", "remlider.ru", "kvartira-pro.ru", "Вы"], rows: [
            { label: "Отдельная страница под каждую услугу", values: [true, true, false] },
            { label: "Калькулятор стоимости ремонта", values: [true, "частично", false] },
            { label: "Фото работ до и после", values: [true, true, "частично"] },
          ] },
          { type: "bullets", title: "Что общего у лидеров", style: "check", items: [
            "От 40 до 60 страниц услуг, каждая под свою группу запросов.",
            "Подробные ответы на частые вопросы прямо на странице услуги.",
            "Активная карточка в Яндекс Картах с сотнями отзывов.",
          ] },
          { type: "table", columns: ["Сайт", "Страниц услуг", "Визитов в месяц"], rows: [
            ["remlider.ru", "60", "6 000"], ["kvartira-pro.ru", "42", "2 100"], ["remont-x.ru", "12", "400"],
          ] },
        ],
      },
      {
        key: "plan",
        title: "Что нужно, чтобы обогнать конкурентов",
        blocks: [
          { type: "paragraph", text: "Работы идут от фундамента к ускорению: сначала согласуем смыслы и структуру, затем тексты и прототип, параллельно с первого месяца ускоряем рост в Яндексе и Картах." },
          { type: "plan_item", title: "Страницы под реальный спрос", problem: "Сайт закрывает десятки разных запросов одной страницей и не попадает в выдачу по большинству из них.", solution: "Предпроектный анализ и структура сайта под спрос: 12 новых страниц услуг с запросами, меню и перелинковкой.", effect: "Новые страницы начинают приносить визиты с 3-4 месяца, к 12 месяцу это заметная часть прироста.", services: ["PA", "SY"] },
          { type: "plan_item", title: "Прототип и тексты по лидерам", problem: "На страницах нет элементов, которые есть у всех лидеров: калькулятора, гарантий, примеров работ.", solution: "Анализ лидеров и прототип с текстами: все коммерческие блоки пяти сильнейших конкурентов на ваших страницах.", effect: "Больше обращений с того же трафика и лучшие позиции по коммерческим запросам.", services: ["KP"] },
          { type: "plan_item", title: "Техническая чистка", problem: "Ошибки индексации прячут часть страниц от поиска.", solution: "Технический аудит и чек-лист разработчику с инструкциями.", effect: "Все страницы участвуют в поиске, новые попадают в индекс быстрее.", services: ["FA"] },
          { type: "plan_item", title: "Ускорение в Яндексе и Картах", problem: "Без поведенческих сигналов новые страницы растут медленно.", solution: "Внешнее продвижение в Яндексе по ключевым запросам и активность карточки в Картах.", effect: "Рост позиций в 2-3 раза быстрее и прямые звонки из Карт.", services: ["PF", "YM"] },
          { type: "plan_timeline" },
          { type: "quick_wins", items: ["Открыть для робота закрытые страницы услуг.", "Добавить телефон и мессенджеры в шапку каждой страницы."] },
        ],
      },
      {
        key: "forecast",
        title: "Прогноз",
        blocks: [
          { type: "paragraph", text: "Прогноз построен по кейсам агентства с поправкой на отбор лучших результатов. Мы считаем только прирост к текущему трафику: то, что сайт получает сейчас, остается у вас и без работ." },
          { type: "forecast_chart" },
          { type: "forecast_table" },
          { type: "forecast_drivers" },
          { type: "conditions", items: [
            "Новые страницы внедряются в течение месяца после передачи структуры.",
            "Сайт остается доступным и быстрым, правки по аудиту внесены.",
          ] },
        ],
      },
    ],
    next_step: "Согласуем состав работ на созвоне и начнем с предпроектного анализа.",
  };
}

// Папка стратегии v2: data/tariffs/inputs (+ content), затем build-forecast. Возврат {dir, code, stdout}.
function writeV2Dir(name, { fi = V2_FI, data, tariffs = v2Tariffs(), inputs = V2_INPUTS, content = v2Content(), forecast = true } = {}) {
  const dir = join(SANDBOX, name);
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  writeJson(join(dir, "seo-strategiya_data.json"), data !== undefined ? data : { $version: "4.0", forecast_inputs: fi });
  writeJson(join(dir, "tariffs.json"), tariffs);
  writeJson(join(dir, "inputs.json"), inputs);
  if (content) writeJson(join(dir, "seo-strategiya_content.json"), content);
  if (!forecast) return { dir, code: null, stdout: "" };
  const r = runScript("build-forecast.mjs", dir);
  return { dir, ...r };
}

// Копия собранной папки (forecast.json и пр.) под отдельный кейс; content можно подменить.
function copyV2Dir(srcDir, name, content) {
  const dir = join(SANDBOX, name);
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  cpSync(srcDir, dir, { recursive: true });
  for (const f of readdirSync(dir)) if (/\.(docx|xlsx)$/i.test(f)) rmSync(join(dir, f), { force: true });
  if (content) writeJson(join(dir, "seo-strategiya_content.json"), content);
  return dir;
}

const MONTH_TOL = 0.5; // визитов: допуск на округление при сравнении кривых

// ──────────────────────────────────────────────────────────────────────────
// 3.1. Модель _forecast-model.mjs
// ──────────────────────────────────────────────────────────────────────────

console.log("\n=== 3.1. v2: модель прогноза _forecast-model.mjs ===");

await step("модель: монотонность при включении тарифов - трафик Старт <= Рост <= Максимум в каждом из 24 мес, обращения за год тоже", () => {
  const res = computeAll(V2_FI, v2Tariffs());
  if (!res.start || !res.growth || !res.max) return "computeAll вернул не все тарифы";
  for (let m = 1; m <= HORIZON; m++) {
    const s = res.start.months[m - 1].traffic, g = res.growth.months[m - 1].traffic, x = res.max.months[m - 1].traffic;
    if (g + MONTH_TOL < s) return `мес ${m}: Рост ${g.toFixed(1)} < Старт ${s.toFixed(1)}`;
    if (x + MONTH_TOL < g) return `мес ${m}: Максимум ${x.toFixed(1)} < Рост ${g.toFixed(1)}`;
  }
  if (res.growth.year1.leads < res.start.year1.leads) return `обращения за год: Рост ${res.growth.year1.leads} < Старт ${res.start.year1.leads}`;
  if (res.max.year1.leads < res.growth.year1.leads) return `обращения за год: Максимум ${res.max.year1.leads} < Рост ${res.growth.year1.leads}`;
  return true;
});

await step("модель: замена MT -> SY (метатеги входят в структуру) не роняет Рост ниже Старта в первые месяцы", () => {
  // Рост без Карт: раньше SY не давал эффекта метатегов, и на 2-м мес Рост проседал ниже Старта.
  const t = v2Tariffs();
  t.growth.monthly = t.growth.monthly.filter((s) => s.id !== "YM");
  t.growth.total_monthly = 25000;
  const res = computeAll(v2Fi({ local: false }), { start: t.start, growth: t.growth });
  for (let m = 1; m <= 6; m++) {
    const s = res.start.months[m - 1].traffic, g = res.growth.months[m - 1].traffic;
    if (g + MONTH_TOL < s) return `мес ${m}: Рост ${g.toFixed(1)} < Старт ${s.toFixed(1)}`;
  }
  return true;
});

await step("модель: Старт и Рост близки на 3-м мес при ПФ в обоих (Старт/Рост >= 0,75), Рост заметно выше на 12-м (>= 1,3 при planned_new > 0)", () => {
  if (!(V2_FI.pages.planned_new > 0)) return "фикстура: planned_new должен быть > 0";
  const res = computeAll(V2_FI, v2Tariffs());
  const s = res.start.checkpoints, g = res.growth.checkpoints;
  if (!res.start.ids.includes("PF") || !res.growth.ids.includes("PF")) return "фикстура: ПФ должен быть в обоих тарифах";
  const r3 = s.m3 / g.m3;
  const r12 = g.m12 / s.m12;
  if (r3 < 0.75) return `m3: Старт ${Math.round(s.m3)} / Рост ${Math.round(g.m3)} = ${r3.toFixed(2)} (< 0,75)`;
  if (r12 < 1.3) return `m12: Рост ${Math.round(g.m12)} / Старт ${Math.round(s.m12)} = ${r12.toFixed(2)} (< 1,3)`;
  return true;
});

await step("модель: прирост от m0 - t0 = 10 000, тариф без работ: 0 обращений в мес 1-3 (база t0 x CR не засчитывается), дальше только с прироста", () => {
  const fi = v2Fi({ t0: 10000, local: false, pages: { existing_commercial: 12, planned_new: 0, catalog_cards: 0 } });
  const r = computeTariff(fi, { onetime: [], monthly: [{ id: "RP", price: 0 }], total_onetime: 0, total_monthly: 10000 });
  const cr = r.economics.conversion_rate;
  for (let m = 1; m <= 3; m++) {
    const x = r.months[m - 1];
    if (Math.abs(x.traffic - 10000) > 1e-6) return `мес ${m}: трафик ${x.traffic} (ожидался t0 = 10000 до лага без ПФ)`;
    if (x.leads !== 0) return `мес ${m}: обращений ${x.leads} (ожидалось 0, а не t0 x CR = ${10000 * cr})`;
  }
  for (const x of r.months) {
    const expect = Math.max(0, (x.traffic_commercial - 10000) * cr);
    if (Math.abs(x.leads - expect) > 1e-6) return `мес ${x.m}: обращений ${x.leads.toFixed(2)}, с прироста ${expect.toFixed(2)}`;
  }
  const baseYear = 10000 * cr * 12;
  if (r.year1.leads > baseYear * 0.1) return `за год ${r.year1.leads} обращений - похоже на засчитанную базу (${baseYear})`;
  return true;
});

await step("модель: costSeries - разовые в 1-й мес, акция ПФ 1=2 снижает 2-й мес на цену ПФ (PF и PFP)", () => {
  const t = { onetime: [{ id: "FA", price: 25000 }], monthly: [{ id: "PF", price: 25000 }, { id: "RP", price: 0 }], total_onetime: 25000, total_monthly: 25000 };
  const plain = costSeries(t);
  const promo = costSeries({ ...t, promos: [{ type: "pf_2for1", reason: "тест" }] });
  if (plain.length !== HORIZON + 1) return `длина ряда ${plain.length} (ожидалось ${HORIZON + 1}: мес 0..${HORIZON})`;
  if (plain[0] !== 0 || plain[1] !== 50000 || plain[2] !== 25000 || plain[HORIZON] !== 25000) return `без акции: ${plain.slice(0, 4).join(", ")} ... ${plain[HORIZON]}`;
  if (promo[1] !== 50000 || promo[2] !== 0 || promo[3] !== 25000) return `с акцией: мес 1-3 = ${promo.slice(1, 4).join(", ")} (ожидалось 50000, 0, 25000)`;
  const sum12 = (a) => a.slice(1, 13).reduce((x, y) => x + y, 0);
  if (sum12(plain) - sum12(promo) !== 25000) return `за 12 мес акция дала ${sum12(plain) - sum12(promo)} (ожидалось 25000)`;
  const pfp = costSeries({ onetime: [], monthly: [{ id: "PFP", price: 45000 }, { id: "YM", price: 25000 }], total_onetime: 0, total_monthly: 70000, promos: [{ type: "pf_2for1" }] });
  if (pfp[2] !== 25000) return `PFP: 2-й мес ${pfp[2]} (ожидалось 70000 - 45000 = 25000)`;
  // и это доходит до денег модели: затраты года Роста = разовые + 12 x абонентка - ПФ
  const g = v2Tariffs().growth;
  const y1 = computeTariff(V2_FI, g).year1.cost;
  if (y1 !== 80000 + 50000 * 12 - 25000) return `затраты Роста за 12 мес ${y1} (ожидалось ${80000 + 50000 * 12 - 25000})`;
  return true;
});

await step("модель: прототип KP поднимает множитель конверсии только после лага внедрения", () => {
  const lag = CAL.kp_conv_ramp.lag;
  const noKP = trafficSeries(V2_FI, new Set(["PF"]));
  const withKP = trafficSeries(V2_FI, new Set(["PF", "KP"]));
  if (noKP.some((p) => p.conv_mult !== 1)) return "без KP множитель конверсии != 1";
  for (let m = 0; m <= Math.floor(lag); m++) {
    if (withKP[m].conv_mult !== 1) return `мес ${m} (до лага ${lag}): множитель ${withKP[m].conv_mult}`;
  }
  if (!(withKP[6].conv_mult > 1)) return `мес 6: множитель ${withKP[6].conv_mult} (ожидалось > 1)`;
  if (!(withKP[12].conv_mult > 1.2 && withKP[12].conv_mult <= CAL.kp_conv_mult + 1e-9)) {
    return `мес 12: множитель ${withKP[12].conv_mult} (ожидалось 1,2..${CAL.kp_conv_mult})`;
  }
  const shifted = trafficSeries(v2Fi({ implementation_lag_shift: 1 }), new Set(["PF", "KP"]));
  if (shifted[Math.floor(lag) + 1].conv_mult !== 1) return `сдвиг внедрения на 1 мес не отодвинул эффект: мес ${Math.floor(lag) + 1} = ${shifted[Math.floor(lag) + 1].conv_mult}`;
  // обращения: при KP к 12 мес больше, чем без него, на том же составе
  const a = computeTariff(V2_FI, { onetime: [{ id: "KP", price: 25000 }], monthly: [{ id: "PF", price: 25000 }] });
  const b = computeTariff(V2_FI, { onetime: [], monthly: [{ id: "PF", price: 25000 }] });
  if (!(a.months[11].leads > b.months[11].leads)) return `обращений к 12 мес с KP ${a.months[11].leads} <= без KP ${b.months[11].leads}`;
  return true;
});

await step("модель: экономический гейт - ROMI Роста <= 0 и Рост хуже Старта дают жесткие нарушения, чистая фикстура - нет", () => {
  const clean = economicsChecks(computeAll(V2_FI, v2Tariffs()));
  if (clean.hard.length) return `чистая фикстура: ${clean.hard.join("; ")}`;
  // маленький чек: Рост не окупается за год
  const cheap = economicsChecks(computeAll(v2Fi({ economics: { ...V2_FI.economics, avg_check: 1500 } }), v2Tariffs()));
  if (!cheap.hard.some((h) => /ROMI Роста за 12 мес .*<= 0/.test(h))) return `чек 1500: нет нарушения ROMI <= 0 (${cheap.hard.join("; ") || "hard пуст"})`;
  // Рост = состав Старта + дорогая абонентка без эффекта
  const t = v2Tariffs();
  t.growth = { ...clone(t.start), monthly: [{ id: "PF", price: 25000 }, { id: "RP", price: 300000 }], total_monthly: 325000 };
  const worse = economicsChecks(computeAll(V2_FI, t));
  if (!worse.hard.some((h) => /чистый результат Роста .* меньше Старта/.test(h))) return `Рост дороже без пользы: нет нарушения (${worse.hard.join("; ") || "hard пуст"})`;
  // Рост без ПФ при ПФ в Старте: трафик Роста к 12 мес ниже
  const t2 = v2Tariffs();
  t2.growth.monthly = t2.growth.monthly.filter((s) => s.id !== "PF");
  t2.growth.total_monthly = 25000;
  const nopf = economicsChecks(computeAll(v2Fi({ pages: { existing_commercial: 12, planned_new: 0, catalog_cards: 0 } }), t2));
  if (!nopf.hard.some((h) => /трафик Роста к 12 мес/.test(h))) return `Рост без ПФ: нет нарушения по трафику (${nopf.hard.join("; ") || "hard пуст"})`;
  return true;
});

// ──────────────────────────────────────────────────────────────────────────
// 3.2. Каталог _services.mjs
// ──────────────────────────────────────────────────────────────────────────

console.log("\n=== 3.2. v2: каталог услуг _services.mjs ===");

await step("devSubpagesPrice: ступени с полом (10 -> 50 000, 11 -> 50 000, 20/21 -> 80 000, 51 -> 150 000), без провалов цены", () => {
  const cases = [[0, 0], [1, 5000], [10, 50000], [11, 50000], [20, 80000], [21, 80000], [30, 90000], [50, 150000], [51, 150000], [100, 250000]];
  for (const [n, want] of cases) {
    const got = devSubpagesPrice(n);
    if (got !== want) return `${n} стр -> ${got} (ожидалось ${want})`;
  }
  let prev = 0;
  for (let n = 1; n <= 100; n++) {
    const p = devSubpagesPrice(n);
    if (p < prev) return `провал цены: ${n - 1} стр = ${prev}, ${n} стр = ${p}`;
    prev = p;
  }
  return true;
});

await step("devPrice: лендинг 80 000 (10 блоков + прототип), многостраничник 30 стр = главная + прототип + подстраницы", () => {
  const l = devPrice({ format: "landing" });
  if (l.total !== 80000) return `лендинг ${l.total} (ожидалось 80000)`;
  if (l.parts.length !== 2) return `лендинг: строк базы ${l.parts.length} (ожидалось 2, без подстраниц)`;
  const m = devPrice({ format: "multipage", pages: 30, home_blocks: 10 });
  if (m.total !== 60000 + 25000 + 90000) return `многостраничник ${m.total} (ожидалось 175000)`;
  if (m.prototype_price !== 25000) return `цена прототипа ${m.prototype_price} (ожидалось 25000)`;
  if (m.parts.reduce((a, p) => a + p.price, 0) !== m.total) return "сумма строк parts != total";
  if (!DEV_OPTIONS.some((o) => o.price == null)) return "в DEV_OPTIONS нет опций «по расчету»";
  return true;
});

await step("devPrice: больше 100 подстраниц - цена и подпись по 100, сверх - «по расчету» (не «150 шт.» за цену 100)", () => {
  const big = devPrice({ format: "multipage", pages: 150, home_blocks: 10 });
  const cap = devPrice({ format: "multipage", pages: 100, home_blocks: 10 });
  if (big.total !== cap.total) return `150 стр. ${big.total} != 100 стр. ${cap.total}`;
  if (big.pages !== 100 || big.pages_requested !== 150 || !big.pages_over_max) return `pages ${big.pages}, requested ${big.pages_requested}, over ${big.pages_over_max}`;
  const label = big.parts[2].label;
  if (!/Подстраницы: 100 шт\./.test(label) || !/по расчету/.test(label)) return `подпись «${label}»`;
  if (cap.pages_over_max || /по расчету/.test(cap.parts[2].label)) return "100 стр. помечены как сверх лимита";
  return true;
});

await step("timelineFor: разовые цепочкой PA -> SY -> KP -> FQ, техника и ежемесячные отдельно, RP не в плане", () => {
  const items = timelineFor(["FQ", "PF", "KP", "RP", "SY", "FA", "PA", "MF"]);
  const chain = items.filter((i) => ["PA", "SY", "KP", "FQ"].includes(i.id));
  if (chain.map((i) => i.id).join(",") !== "PA,SY,KP,FQ") return `порядок цепочки ${chain.map((i) => i.id).join(",")}`;
  for (let i = 1; i < chain.length; i++) {
    if (chain[i].start_week !== chain[i - 1].start_week + chain[i - 1].weeks) return `${chain[i].id} стартует на нед. ${chain[i].start_week}, а не после ${chain[i - 1].id}`;
  }
  if (items.some((i) => i.id === "RP")) return "RP попал в план работ";
  if (!items.some((i) => i.id === "MT")) return "алиас MF -> MT не сработал";
  const pf = items.find((i) => i.id === "PF");
  if (!pf || !pf.monthly) return "PF не отмечен как ежемесячная полоса";
  const short = timelineFor(["PA", "KP"]);
  const kp = short.find((i) => i.id === "KP");
  if (!kp || kp.start_week !== 1) return `без SY прототип стартует на нед. ${kp && kp.start_week} (ожидалось сразу после PA, 1)`;
  return true;
});

await step("serviceMeta/canonicalId: выведенные ID из легаси-словаря, MF/MD -> MT, ART со старой ценой", () => {
  if (canonicalId("MF") !== "MT" || canonicalId("MD") !== "MT") return "алиасы MF/MD -> MT";
  const ng = serviceMeta("NG");
  if (!ng.legacy || !/n-грамм/.test(ng.name)) return `NG: ${JSON.stringify(ng)}`;
  const kp = serviceMeta("KP");
  if (kp.legacy || kp.price !== 25000) return `KP: ${JSON.stringify(kp)}`;
  const art = serviceMeta("ART");
  if (art.price !== 0 || art.regular_price !== 3000) return `ART: price ${art.price}, regular ${art.regular_price}`;
  return true;
});

// ──────────────────────────────────────────────────────────────────────────
// 3.3. build-forecast.mjs
// ──────────────────────────────────────────────────────────────────────────

console.log("\n=== 3.3. v2: build-forecast.mjs ===");

const V2_BASE = writeV2Dir("v2-base");

await step("build-forecast: чистая папка -> exit 0, forecast.json (модель v2, 3 тарифа, ряд m0..m12, потери, гейт без нарушений)", () => {
  if (V2_BASE.code !== 0) return `exit ${V2_BASE.code}: ${V2_BASE.stdout}`;
  const p = join(V2_BASE.dir, "forecast.json");
  if (!existsSync(p)) return "forecast.json не создан";
  const fc = readJsonFile(p);
  if (fc.model_version !== MODEL_VERSION) return `model_version ${fc.model_version}`;
  if (fc.horizon_months !== HORIZON || fc.recommended !== "growth") return `horizon ${fc.horizon_months}, recommended ${fc.recommended}`;
  for (const k of ["start", "growth", "max"]) {
    const t = fc.tariffs && fc.tariffs[k];
    if (!t) return `нет tariffs.${k}`;
    if (!Array.isArray(t.months) || t.months.length !== HORIZON) return `${k}: months ${t.months && t.months.length}`;
    for (const key of ["m0", "m3", "m6", "m12", "m24"]) if (!Number.isFinite(t.checkpoints[key])) return `${k}: нет checkpoints.${key}`;
  }
  if (!Array.isArray(fc.plan_series) || fc.plan_series.length !== 13) return `plan_series: ${fc.plan_series && fc.plan_series.length} точек (ожидалось 13)`;
  if (!(fc.lost_now && fc.lost_now.revenue_month > 0)) return "lost_now.revenue_month <= 0";
  if (fc.checks.hard.length) return `checks.hard: ${fc.checks.hard.join("; ")}`;
  // числа - те же, что прямой пересчет модели
  const res = computeAll(V2_FI, v2Tariffs());
  for (const k of ["start", "growth", "max"]) {
    if (fc.tariffs[k].year1.romi !== res[k].year1.romi) return `${k}: ROMI ${fc.tariffs[k].year1.romi} != модель ${res[k].year1.romi}`;
  }
  return true;
});

await step("build-forecast: нет forecast_inputs -> exit 2 (НЕПОЛНЫЙ forecast_inputs), forecast.json не пишется", () => {
  const r = writeV2Dir("bf-no-inputs", { data: { $version: "4.0" }, content: null });
  if (r.code !== 2) return `exit ${r.code} (expect 2): ${r.stdout}`;
  if (!/НЕПОЛНЫЙ forecast_inputs/.test(r.stdout)) return `нет заголовка НЕПОЛНЫЙ forecast_inputs: ${r.stdout}`;
  if (existsSync(join(r.dir, "forecast.json"))) return "forecast.json записан при неполных входах";
  const r2 = writeV2Dir("bf-no-demand", { fi: v2Fi({ demand: { info_month: 100 } }), content: null });
  if (r2.code !== 2 || !/demand\.commercial_month/.test(r2.stdout)) return `без demand.commercial_month: exit ${r2.code}: ${r2.stdout}`;
  return true;
});

await step("build-forecast: Рост дороже Старта без пользы -> exit 3 (ЭКОНОМИЧЕСКИЙ ГЕЙТ), смета не рекомендует Рост", () => {
  const t = v2Tariffs();
  // Рост = Старт + ссылки и статьи (по правилам допустимо: ART -> AR, IT при AR), но за 12 мес не окупается
  t.growth = {
    ...clone(t.start),
    onetime: [{ id: "FA", price: 25000 }, { id: "MT", price: 10000 }, { id: "IT", price: 10000 }],
    monthly: [{ id: "PF", price: 25000 }, { id: "LB", price: 25000 }, { id: "AR", price: 35000 }, { id: "RP", price: 0 }],
    total_onetime: 45000, total_monthly: 85000,
  };
  const r = writeV2Dir("bf-gate", { tariffs: t, content: null });
  if (r.code !== 3) return `exit ${r.code} (expect 3): ${r.stdout}`;
  if (!/ЭКОНОМИЧЕСКИЙ ГЕЙТ/.test(r.stdout)) return `нет заголовка ЭКОНОМИЧЕСКИЙ ГЕЙТ: ${r.stdout}`;
  if (!/чистый результат Роста/.test(r.stdout)) return `нет нарушения про чистый результат Роста: ${r.stdout}`;
  const fc = readJsonFile(join(r.dir, "forecast.json"));
  if (fc.recommended !== "growth") return `recommended ${fc.recommended} (план docx - по Росту)`;
  if (fc.recommended_offer === "growth") return "recommended_offer = growth при проваленном гейте (смета рекомендовала бы убыточный Рост)";
  const best = ["start", "growth", "max"].sort((a, b) => fc.tariffs[b].year1.net - fc.tariffs[a].year1.net)[0];
  const expect = fc.tariffs[best].year1.net > 0 ? best : null;
  if (fc.recommended_offer !== expect) return `recommended_offer ${fc.recommended_offer}, ожидалось ${expect}`;
  if (V2_BASE.code === 0 && readJsonFile(join(V2_BASE.dir, "forecast.json")).recommended_offer !== "growth") return "чистая папка: recommended_offer не growth";
  return true;
});

await step("build-forecast: ПРАВИЛА ТАРИФОВ - выведенный ID, ID строчными, DEV в тарифе, цена/итог не по каталогу, связки -> exit 3 до расчета", () => {
  const cases = [
    ["retired", (t) => { t.growth.onetime.push({ id: "NG", price: 25000 }); t.growth.total_onetime += 25000; }, /выведенный ID «NG»/],
    ["lower", (t) => { t.growth.onetime.find((s) => s.id === "KP").id = "kp"; }, /ID «kp» - пиши «KP»/],
    ["dev", (t) => { t.max.onetime.push({ id: "DEV", price: 200000 }); t.max.total_onetime += 200000; }, /DEV в тарифе/],
    ["price", (t) => { t.growth.onetime.find((s) => s.id === "KP").price = 15000; t.growth.total_onetime -= 10000; }, /KP 15000 - по каталогу 25000/],
    ["total", (t) => { t.growth.total_monthly = 40000; }, /total_monthly 40000 != сумма цен строк 50000/],
    ["rp", (t) => { t.growth.monthly.find((s) => s.id === "RP").price = 10000; t.growth.total_monthly += 10000; }, /RP 10000 - при ежемесячных/],
    ["nopa", (t) => { for (const k of ["growth", "max"]) { t[k].onetime = t[k].onetime.filter((s) => s.id !== "PA"); t[k].total_onetime -= 5000; } }, /SY без PA/],
    ["incl", (t) => { t.growth.onetime = t.growth.onetime.filter((s) => s.id !== "FA"); t.growth.total_onetime -= 25000; }, /Рост не включает Старт: нет FA/],
    ["promo", (t) => { t.growth.promos = []; }, /акция «ПФ 1=2» есть в Старт, Максимум, но нет в Рост/],
  ];
  for (const [name, patch, re] of cases) {
    const t = v2Tariffs();
    patch(t);
    const r = writeV2Dir(`bf-rules-${name}`, { tariffs: t, content: null });
    if (r.code !== 3) return `${name}: exit ${r.code} (expect 3): ${r.stdout}`;
    if (!/ПРАВИЛА ТАРИФОВ/.test(r.stdout) || !re.test(r.stdout)) return `${name}: нет нарушения ${re}: ${r.stdout}`;
    if (existsSync(join(r.dir, "forecast.json"))) return `${name}: forecast.json записан при нарушении правил`;
  }
  return true;
});

await step("build-forecast: null / \"\" в числовых входах -> exit 2 (growth-strategist), не 0", () => {
  const cases = [
    ["t0", v2Fi({ t0: null }), /t0 не число/],
    ["existing", v2Fi({ pages: { ...V2_FI.pages, existing_commercial: null } }), /pages\.existing_commercial не число/],
    ["planned", v2Fi({ pages: { ...V2_FI.pages, planned_new: "" } }), /pages\.planned_new не число/],
    ["demand", v2Fi({ demand: { ...V2_FI.demand, commercial_month: null } }), /demand\.commercial_month/],
    ["conv0", v2Fi({ economics: { ...V2_FI.economics, conversion_rate: 0 } }), /economics\.conversion_rate = 0 вне диапазона/],
  ];
  for (const [name, fi, re] of cases) {
    const r = writeV2Dir(`bf-null-${name}`, { fi, content: null });
    if (r.code !== 2) return `${name}: exit ${r.code} (expect 2): ${r.stdout}`;
    if (!re.test(r.stdout)) return `${name}: нет ${re}: ${r.stdout}`;
  }
  return true;
});

await step("build-forecast: conversion_rate 1 из inputs.json = 1% (не 100%), close_rate 1 = 100%; методика ru-RU", () => {
  const r = writeV2Dir("bf-conv1", { inputs: { ...V2_INPUTS, conversion_rate: 1, close_rate: 1 }, content: null });
  if (r.code !== 0 && r.code !== 3) return `exit ${r.code}: ${r.stdout}`;
  const fc = readJsonFile(join(r.dir, "forecast.json"));
  const e = fc.inputs.economics;
  if (e.conversion_rate !== 0.01) return `conversion_rate ${e.conversion_rate} (ожидалось 0.01)`;
  if (e.close_rate !== 1) return `close_rate ${e.close_rate} (ожидалось 1)`;
  if (/\d\.\d/.test(fc.assumptions_note)) return `число с точкой в методике: ${fc.assumptions_note}`;
  const r2 = writeV2Dir("bf-conv15", { inputs: { ...V2_INPUTS, conversion_rate: 1.5 }, content: null });
  const fc2 = readJsonFile(join(r2.dir, "forecast.json"));
  if (fc2.inputs.economics.conversion_rate !== 0.015) return `1.5 -> ${fc2.inputs.economics.conversion_rate} (ожидалось 0.015)`;
  if (!/1,5%/.test(fc2.assumptions_note)) return `в методике нет «1,5%»: ${fc2.assumptions_note}`;
  return true;
});

await step("build-forecast: one_step (магазин) - методика «визит -> заказ» без шага «обращение -> продажа»", () => {
  const fi = v2Fi({
    business_type: "ecommerce", local: false,
    economics: { avg_check: 5000, avg_check_source: "estimated", conversion_rate: 0.015, close_rate: 1, margin: 0.25, model: "one_step", basis: "фикстура" },
  });
  const t = v2Tariffs();
  for (const k of ["growth", "max"]) {
    t[k].monthly = t[k].monthly.filter((s) => s.id !== "YM");
    t[k].total_monthly -= 25000;
  }
  const r = writeV2Dir("bf-ecom", { fi, tariffs: t, content: null });
  if (r.code !== 0 && r.code !== 3) return `exit ${r.code}: ${r.stdout}`;
  const note = readJsonFile(join(r.dir, "forecast.json")).assumptions_note;
  if (!/визит -> заказ 1,5%/.test(note)) return `нет «визит -> заказ 1,5%»: ${note}`;
  if (/обращение -> продажа|9,1%/.test(note)) return `шаг воронки услуг в методике магазина: ${note}`;
  return true;
});

await step("build-forecast: lost_now - обращения и продажи с десятыми из 12-го месяца (не округленный m12)", () => {
  const fc = readJsonFile(join(V2_BASE.dir, "forecast.json"));
  const m = fc.tariffs.growth.months[11];
  if (fc.lost_now.leads_month !== m.leads) return `lost_now.leads_month ${fc.lost_now.leads_month} != months[11].leads ${m.leads}`;
  if (fc.lost_now.sales_month !== m.sales) return `lost_now.sales_month ${fc.lost_now.sales_month} != months[11].sales ${m.sales}`;
  if (fc.lost_now.leads_maps_month !== m.leads_maps) return `lost_now.leads_maps_month ${fc.lost_now.leads_maps_month} != months[11].leads_maps ${m.leads_maps}`;
  return true;
});

const BF_CLIENT = writeV2Dir("bf-client", { inputs: { ...V2_INPUTS, avg_check: 90000, margin: 45, close_rate: "25" }, content: null });

await step("build-forecast: проценты из inputs.json -> доли (margin 45 -> 0,45, close_rate \"25\" -> 0,25)", () => {
  if (BF_CLIENT.code !== 0) return `exit ${BF_CLIENT.code}: ${BF_CLIENT.stdout}`;
  const e = readJsonFile(join(BF_CLIENT.dir, "forecast.json")).inputs.economics;
  if (e.margin !== 0.45) return `margin ${e.margin} (ожидалось 0.45)`;
  if (e.close_rate !== 0.25) return `close_rate ${e.close_rate} (ожидалось 0.25)`;
  if (e.conversion_rate !== V2_FI.economics.conversion_rate) return `conversion_rate ${e.conversion_rate} - клиент не задавал, должна остаться оценка агента`;
  return true;
});

await step("build-forecast: клиентский средний чек перекрывает оценку агента (avg_check_source client, деньги по нему)", () => {
  const fc = readJsonFile(join(BF_CLIENT.dir, "forecast.json"));
  const e = fc.inputs.economics;
  if (e.avg_check !== 90000 || e.avg_check_source !== "client") return `avg_check ${e.avg_check}, источник ${e.avg_check_source}`;
  const from = fc.inputs.economics_from_client || [];
  for (const k of ["avg_check", "margin", "close_rate"]) if (!from.includes(k)) return `economics_from_client без ${k}: ${from.join(", ")}`;
  if (/\(оценка\)/.test(fc.assumptions_note)) return `assumptions_note помечает клиентский чек как оценку: ${fc.assumptions_note}`;
  const res = computeAll(v2Fi({ economics: { ...V2_FI.economics, avg_check: 90000, margin: 0.45, close_rate: 0.25 } }), v2Tariffs());
  if (fc.tariffs.growth.year1.romi !== res.growth.year1.romi) return `ROMI Роста ${fc.tariffs.growth.year1.romi} != модель с клиентской экономикой ${res.growth.year1.romi}`;
  return true;
});

// ──────────────────────────────────────────────────────────────────────────
// 3.4. Смета v2 (build-smeta-xlsx.mjs при forecast.json)
// ──────────────────────────────────────────────────────────────────────────

console.log("\n=== 3.4. v2: смета build-smeta-xlsx.mjs ===");

// Мини-вычислитель формул ExcelJS (SUM, MAX, MIN, COUNT, IF, SUMPRODUCT, ссылки и диапазоны между листами):
// пересчитывает формулы прямо из xlsx, с подменой ячеек параметров. Нужен, потому что exceljs формулы не считает.
function formulaEvaluator(wb) {
  const overrides = new Map();
  let cache = new Map();
  const colNum = (s) => { let n = 0; for (const ch of s) n = n * 26 + (ch.charCodeAt(0) - 64); return n; };
  const colStr = (n) => { let s = ""; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
  function value(sheet, addr) {
    const key = `${sheet}!${addr}`;
    if (overrides.has(key)) return overrides.get(key);
    const ws = wb.getWorksheet(sheet);
    if (!ws) throw new Error(`нет листа ${sheet}`);
    const v = ws.getCell(addr).value;
    if (v && typeof v === "object" && "formula" in v) {
      if (cache.has(key)) return cache.get(key);
      const r = evalFormula(v.formula, sheet);
      cache.set(key, r);
      return r;
    }
    if (v && typeof v === "object" && v.richText) return v.richText.map((t) => t.text).join("");
    return v ?? null;
  }
  function tokenize(f) {
    const out = [];
    let i = 0;
    while (i < f.length) {
      const c = f[i];
      const rest = f.slice(i);
      let m;
      if (c === " ") { i++; continue; }
      if (c === '"') { const j = f.indexOf('"', i + 1); out.push({ t: "str", v: f.slice(i + 1, j) }); i = j + 1; continue; }
      if (c === "'") {
        const j = f.indexOf("'", i + 1);
        const sh = f.slice(i + 1, j);
        i = j + 1;
        if (f[i] !== "!") throw new Error(`ожидался ! после листа: ${f}`);
        i++;
        m = /^\$?([A-Z]+)\$?(\d+)/.exec(f.slice(i));
        out.push({ t: "ref", sheet: sh, col: m[1], row: +m[2] });
        i += m[0].length;
        continue;
      }
      if ((m = /^\d+(\.\d+)?(e[+-]?\d+)?/i.exec(rest))) { out.push({ t: "num", v: parseFloat(m[0]) }); i += m[0].length; continue; }
      if ((m = /^\$?([A-Z]+)\$?(\d+)/.exec(rest)) && !/^[A-Z]+\(/.test(rest)) { out.push({ t: "ref", col: m[1], row: +m[2] }); i += m[0].length; continue; }
      if ((m = /^[A-Z]+(?=\()/.exec(rest))) { out.push({ t: "fn", v: m[0] }); i += m[0].length; continue; }
      if ((m = /^(>=|<=|<>|[-+*/(),:<>=])/.exec(rest))) { out.push({ t: "op", v: m[0] }); i += m[0].length; continue; }
      throw new Error(`не разобрать формулу: ${rest}`);
    }
    return out;
  }
  function evalFormula(f, sheet) {
    const toks = tokenize(f);
    let p = 0;
    const peek = () => toks[p];
    const next = () => toks[p++];
    const isOp = (v) => peek() && peek().t === "op" && (Array.isArray(v) ? v.includes(peek().v) : peek().v === v);
    const numv = (x) => (typeof x === "number" ? x : x === null || x === "" ? 0 : typeof x === "boolean" ? +x : NaN);
    function cmp() {
      let a = add();
      while (isOp([">=", "<=", "<>", ">", "<", "="])) {
        const op = next().v;
        const x = numv(a), y = numv(add());
        a = op === ">=" ? x >= y : op === "<=" ? x <= y : op === ">" ? x > y : op === "<" ? x < y : op === "=" ? x === y : x !== y;
      }
      return a;
    }
    function add() {
      let a = mul();
      while (isOp(["+", "-"])) { const op = next().v; const b = mul(); a = op === "+" ? numv(a) + numv(b) : numv(a) - numv(b); }
      return a;
    }
    function mul() {
      let a = unary();
      while (isOp(["*", "/"])) { const op = next().v; const b = unary(); a = op === "*" ? numv(a) * numv(b) : numv(a) / numv(b); }
      return a;
    }
    function unary() {
      if (isOp("-")) { next(); return -numv(unary()); }
      return primary();
    }
    function refOrRange(t) {
      const sh = t.sheet || sheet;
      if (isOp(":")) {
        next();
        const t2 = next();
        const arr = [];
        for (let r = t.row; r <= t2.row; r++) for (let c = colNum(t.col); c <= colNum(t2.col); c++) arr.push(value(sh, `${colStr(c)}${r}`));
        return { range: arr };
      }
      return value(sh, `${t.col}${t.row}`);
    }
    // аргументы функции вычисляются лениво (IF не трогает невыбранную ветку)
    function skipExpr() {
      let depth = 0;
      while (p < toks.length) {
        const t = toks[p];
        if (t.t === "op" && t.v === "(") depth++;
        if (t.t === "op" && t.v === ")") { if (depth === 0) return; depth--; }
        if (t.t === "op" && t.v === "," && depth === 0) return;
        p++;
      }
    }
    function args() {
      const out = [];
      next(); // (
      if (isOp(")")) { next(); return out; }
      for (;;) {
        out.push({ start: p });
        skipExpr();
        if (isOp(",")) { next(); continue; }
        next(); // )
        break;
      }
      return out;
    }
    function evalAt(a) { const save = p; p = a.start; const v = cmp(); p = save; return v; }
    const flat = (v) => (v && v.range ? v.range : [v]);
    function primary() {
      const t = next();
      if (!t) throw new Error(`обрыв формулы: ${f}`);
      if (t.t === "num" || t.t === "str") return t.v;
      if (t.t === "ref") return refOrRange(t);
      if (t.t === "op" && t.v === "(") { const v = cmp(); next(); return v; }
      if (t.t === "fn") {
        const as = args();
        const nums = () => as.flatMap((a) => flat(evalAt(a))).filter((x) => typeof x === "number");
        switch (t.v) {
          case "SUM": return nums().reduce((x, y) => x + y, 0);
          case "MAX": { const n = nums(); return n.length ? Math.max(...n) : 0; }
          case "MIN": { const n = nums(); return n.length ? Math.min(...n) : 0; }
          case "COUNT": return nums().length;
          case "IF": return evalAt(as[0]) ? evalAt(as[1]) : as[2] ? evalAt(as[2]) : false;
          case "SUMPRODUCT": { const a = flat(evalAt(as[0])), b = flat(evalAt(as[1])); return a.reduce((s, x, i) => s + numv(x) * numv(b[i]), 0); }
          default: throw new Error(`функция ${t.v} не поддержана вычислителем`);
        }
      }
      throw new Error(`токен ${JSON.stringify(t)} в ${f}`);
    }
    const v = cmp();
    return v && v.range ? v.range[0] : v;
  }
  return {
    value,
    colStr,
    set(sheet, addr, v) { overrides.set(`${sheet}!${addr}`, v); cache = new Map(); },
    reset() { overrides.clear(); cache = new Map(); },
  };
}

function cellText(c) {
  const v = c.value;
  if (typeof v === "string") return v;
  if (v && typeof v === "object" && v.richText) return v.richText.map((t) => t.text).join("");
  return "";
}
function findCell(ws, re) {
  let hit = null;
  ws.eachRow((row) => row.eachCell((c) => { if (!hit && re.test(cellText(c))) hit = c; }));
  return hit;
}

const SMETA_SHEETS = ["Сравнение тарифов", "Старт", "Рост", "Максимум", "Разработка сайта", "Окупаемость"];
const TKEYS = ["start", "growth", "max"];
const TNAME = { start: "Старт", growth: "Рост", max: "Максимум" };
const PB = "Окупаемость";

// Смета собирается по копии опорной папки; книга и разметка «Окупаемость» читаются один раз.
const SMETA = { dir: null, build: null, wb: null, ev: null, blocks: null, params: null, fc: null };
SMETA.dir = copyV2Dir(V2_BASE.dir, "smeta-v2");
SMETA.build = runBuildSmeta(SMETA.dir);
SMETA.fc = existsSync(join(SMETA.dir, "forecast.json")) ? readJsonFile(join(SMETA.dir, "forecast.json")) : null;
const SMETA_XLSX = join(SMETA.dir, `Smeta_${V2_INPUTS.slug}.xlsx`);
if (SMETA.build.code === 0 && existsSync(SMETA_XLSX)) {
  SMETA.wb = new ExcelJS.Workbook();
  await SMETA.wb.xlsx.readFile(SMETA_XLSX);
  SMETA.ev = formulaEvaluator(SMETA.wb);
  const ws = SMETA.wb.getWorksheet(PB);
  if (ws) {
    const NAME_UP = { start: "СТАРТ", growth: "РОСТ", max: "МАКСИМУМ" };
    const blocks = {};
    const params = {};
    let cur = null;
    for (let r = 1; r <= ws.rowCount; r++) {
      const a = ws.getCell(r, 1).value;
      if (typeof a !== "string") continue;
      for (const k of TKEYS) if (a.startsWith(`ТАРИФ «${NAME_UP[k]}»`)) { cur = k; blocks[k] = {}; }
      if (!params.check && a.startsWith("Средний чек")) params.check = r;
      if (!params.conv && a.startsWith("Конверсия визит")) params.conv = r;
      if (!params.close && a.startsWith("Обращение -> продажа")) params.close = r;
      if (!params.margin && a.startsWith("Маржинальность")) params.margin = r;
      if (cur) {
        if (a === "ROMI за 12 мес") blocks[cur].romi12 = r;
        if (a === "Окупаемость, мес") blocks[cur].payback = r;
        if (a === "ROMI за 24 мес") blocks[cur].romi24 = r;
      }
    }
    SMETA.blocks = blocks;
    SMETA.params = params;
  }
}
function needSmeta() {
  if (SMETA.build.code !== 0) return `смета не собралась: exit ${SMETA.build.code}: ${SMETA.build.stdout}`;
  if (!SMETA.wb) return `нет ${SMETA_XLSX}`;
  return null;
}
const expPayback = (pm) => (pm == null ? "> 24 мес" : pm <= 12 ? pm : "на 2-м году");

await step("смета v2: exit 0, 6 листов по порядку (Сравнение тарифов первым), без предупреждений об устаревшем прогнозе", () => {
  const bad = needSmeta();
  if (bad) return bad;
  const names = SMETA.wb.worksheets.map((w) => w.name);
  if (JSON.stringify(names) !== JSON.stringify(SMETA_SHEETS)) return `листы: ${names.join(", ")}`;
  if (!/v2: forecast\.json/.test(SMETA.build.stdout)) return `лог без пометки v2: ${SMETA.build.stdout}`;
  if (/ВНИМАНИЕ/.test(SMETA.build.stdout)) return `предупреждение при сборке: ${SMETA.build.stdout}`;
  return true;
});

await step("смета v2: «Окупаемость» на формулах, кэш результатов во всей книге совпадает с пересчетом формул", () => {
  const bad = needSmeta();
  if (bad) return bad;
  let formulas = 0;
  SMETA.wb.getWorksheet(PB).eachRow((row) => row.eachCell((c) => { if (c.value && c.value.formula) formulas++; }));
  if (formulas < 300) return `формул на листе «Окупаемость»: ${formulas} (ожидалось >= 300: 3 тарифа x 12 мес x строки)`;
  if (!SMETA.blocks || TKEYS.some((k) => !SMETA.blocks[k] || !SMETA.blocks[k].romi12 || !SMETA.blocks[k].romi24 || !SMETA.blocks[k].payback)) {
    return `не найдены блоки тарифов / строки ROMI: ${JSON.stringify(SMETA.blocks)}`;
  }
  for (const k of ["check", "conv", "close", "margin"]) if (!SMETA.params[k]) return `не найдена ячейка параметра ${k}`;
  let checked = 0;
  const diffs = [];
  for (const ws of SMETA.wb.worksheets) {
    ws.eachRow((row) => row.eachCell((c) => {
      if (!(c.value && c.value.formula && c.value.result !== undefined)) return;
      checked++;
      const v = SMETA.ev.value(ws.name, c.address);
      const r = c.value.result;
      const same = typeof r === "number" ? Math.abs(v - r) <= 1e-6 * Math.max(1, Math.abs(r)) : v === r;
      if (!same && diffs.length < 3) diffs.push(`${ws.name}!${c.address} ${c.value.formula}: ${v} != ${r}`);
    }));
  }
  if (diffs.length) return `кэш != формула: ${diffs.join(" | ")}`;
  if (checked < formulas) return `проверено ${checked} формул с кэшем из ${formulas}`;
  return true;
});

await step("смета v2: ROMI 12/24 мес и окупаемость из формул при исходных параметрах = forecast.json (±1 п.п.)", () => {
  const bad = needSmeta();
  if (bad) return bad;
  SMETA.ev.reset();
  for (const k of TKEYS) {
    const b = SMETA.blocks[k];
    const f = SMETA.fc.tariffs[k];
    const r12 = SMETA.ev.value(PB, `B${b.romi12}`) * 100;
    const r24 = SMETA.ev.value(PB, `B${b.romi24}`) * 100;
    if (!(Math.abs(r12 - f.year1.romi) <= 1)) return `${k}: ROMI 12 мес формулой ${r12.toFixed(2)}% != forecast.json ${f.year1.romi}%`;
    if (!(Math.abs(r24 - f.year2.romi) <= 1)) return `${k}: ROMI 24 мес формулой ${r24.toFixed(2)}% != forecast.json ${f.year2.romi}%`;
    const pb = SMETA.ev.value(PB, `B${b.payback}`);
    if (pb !== expPayback(f.payback_month)) return `${k}: окупаемость ${pb} != forecast.json ${f.payback_month}`;
  }
  return true;
});

await step("смета v2: правка параметров (чек x2, конверсия 8%, закрытие 25%, маржа 50%) - формулы = модель с теми же параметрами", () => {
  const bad = needSmeta();
  if (bad) return bad;
  const econ = { ...V2_FI.economics, avg_check: V2_FI.economics.avg_check * 2, conversion_rate: 0.08, close_rate: 0.25, margin: 0.5 };
  SMETA.ev.reset();
  SMETA.ev.set(PB, `B${SMETA.params.check}`, econ.avg_check);
  SMETA.ev.set(PB, `B${SMETA.params.conv}`, econ.conversion_rate);
  SMETA.ev.set(PB, `B${SMETA.params.close}`, econ.close_rate);
  SMETA.ev.set(PB, `B${SMETA.params.margin}`, econ.margin);
  try {
    const tariffs = v2Tariffs();
    for (const k of TKEYS) {
      const res = computeTariff(v2Fi({ economics: econ }), tariffs[k]);
      const b = SMETA.blocks[k];
      const r12 = SMETA.ev.value(PB, `B${b.romi12}`) * 100;
      const r24 = SMETA.ev.value(PB, `B${b.romi24}`) * 100;
      if (!(Math.abs(r12 - res.year1.romi) <= 1)) return `${k}: ROMI 12 мес формулой ${r12.toFixed(2)}% != модель ${res.year1.romi}%`;
      if (!(Math.abs(r24 - res.year2.romi) <= 1)) return `${k}: ROMI 24 мес формулой ${r24.toFixed(2)}% != модель ${res.year2.romi}%`;
      const pb = SMETA.ev.value(PB, `B${b.payback}`);
      if (pb !== expPayback(res.payback_month)) return `${k}: окупаемость ${pb} != модель ${res.payback_month}`;
    }
  } finally {
    SMETA.ev.reset();
  }
  return true;
});

await step("смета v2: «Сравнение тарифов» - ROMI, вложения и чистый результат формулами из «Окупаемость» = forecast.json, трафик 12 мес = модель", () => {
  const bad = needSmeta();
  if (bad) return bad;
  const ws = SMETA.wb.getWorksheet("Сравнение тарифов");
  const rowOf = (label) => { for (let r = 1; r <= ws.rowCount; r++) if (ws.getCell(r, 1).value === label) return r; return null; };
  const rows = { romi: rowOf("ROMI за 12 мес"), cost: rowOf("Вложения за 12 мес"), net: rowOf("Чистый результат за 12 мес"), tr12: rowOf("Трафик через 12 мес, визитов в мес") };
  for (const [k, r] of Object.entries(rows)) if (!r) return `нет строки ${k}`;
  SMETA.ev.reset();
  for (let j = 0; j < TKEYS.length; j++) {
    const k = TKEYS[j];
    const col = SMETA.ev.colStr(j + 2);
    const f = SMETA.fc.tariffs[k];
    const cell = ws.getCell(`${col}${rows.romi}`).value;
    if (!(cell && cell.formula && cell.formula.includes(PB))) return `${k}: ROMI не формула-ссылка на «Окупаемость» (${JSON.stringify(cell)})`;
    const romi = SMETA.ev.value("Сравнение тарифов", `${col}${rows.romi}`) * 100;
    if (!(Math.abs(romi - f.year1.romi) <= 1)) return `${k}: ROMI ${romi.toFixed(2)}% != ${f.year1.romi}%`;
    const cost = SMETA.ev.value("Сравнение тарифов", `${col}${rows.cost}`);
    if (!(Math.abs(cost - f.year1.cost) <= 1)) return `${k}: вложения ${cost} != ${f.year1.cost}`;
    const net = SMETA.ev.value("Сравнение тарифов", `${col}${rows.net}`);
    if (!(Math.abs(net - f.year1.net) <= 2)) return `${k}: чистый результат ${net} != ${f.year1.net}`;
    const tr = SMETA.ev.value("Сравнение тарифов", `${col}${rows.tr12}`);
    if (tr !== f.checkpoints.m12) return `${k}: трафик 12 мес ${tr} != ${f.checkpoints.m12}`;
  }
  return true;
});

await step("смета v2: «Разработка сайта» - итог базы = devPrice, зачет прототипа при KP, опции «по расчету» вне итога, акция ПФ 1=2", () => {
  const bad = needSmeta();
  if (bad) return bad;
  const ws = SMETA.wb.getWorksheet("Разработка сайта");
  const dp = devPrice(v2Tariffs().site_dev);
  const total = findCell(ws, /^ИТОГО разработка \(база\)$/);
  if (!total) return "нет строки «ИТОГО разработка (база)»";
  const tv = SMETA.ev.value("Разработка сайта", `C${total.row}`);
  if (tv !== dp.total) return `итог базы ${tv} != devPrice ${dp.total}`;
  const z = findCell(ws, /^ИТОГО разработка вместе с тарифом/);
  if (!z) return "нет итога с зачетом прототипа (KP есть в Росте)";
  const zv = SMETA.ev.value("Разработка сайта", `C${z.row}`);
  if (zv !== dp.total - dp.prototype_price) return `итог с зачетом ${zv} != ${dp.total - dp.prototype_price}`;
  if (!findCell(ws, /^РЕКОМЕНДУЕМ/)) return "нет пометки «РЕКОМЕНДУЕМ» (site_dev.recommended = true)";
  if (!findCell(ws, /^по расчету$/)) return "нет опций «по расчету»";
  if (!findCell(ws, /ПФ 1=2/)) return "нет строки акции ПФ 1=2";
  return true;
});

await step("смета v2: листы тарифов - «Почему этот вариант», ART «3 000 ₽ -> 0 ₽ (акция)», акция ПФ строкой, итог 12 мес = затраты модели", () => {
  const bad = needSmeta();
  if (bad) return bad;
  const tariffs = v2Tariffs();
  for (const k of TKEYS) {
    const ws = SMETA.wb.getWorksheet(TNAME[k]);
    if (!findCell(ws, /^Почему этот вариант:/)) return `${TNAME[k]}: нет строки «Почему этот вариант»`;
    const hasArt = tariffs[k].onetime.some((s) => s.id === "ART" && s.price === 0);
    if (!!findCell(ws, /^3[\s ]000[\s ]₽ -> 0[\s ]₽ \(акция\)$/) !== hasArt) return `${TNAME[k]}: акционная цена ART (ожидалось ${hasArt})`;
    if (!findCell(ws, /^Акция: второй месяц внешнего продвижения в подарок$/)) return `${TNAME[k]}: нет строки акции ПФ 1=2`;
    const y12 = findCell(ws, /^Итого за 12 месяцев/);
    if (!y12) return `${TNAME[k]}: нет итога за 12 месяцев`;
    const v = SMETA.ev.value(TNAME[k], `E${y12.row}`);
    if (v !== SMETA.fc.tariffs[k].year1.cost) return `${TNAME[k]}: итог 12 мес ${v} != затраты модели ${SMETA.fc.tariffs[k].year1.cost}`;
  }
  if (!/РЕКОМЕНДУЕМ/.test(cellText(SMETA.wb.getWorksheet("Рост").getCell(1, 1)))) return "лист «Рост» не помечен рекомендуемым";
  const badChars = [];
  for (const ws of SMETA.wb.worksheets) ws.eachRow((row) => row.eachCell((c) => { if (/[ёЁ—–]/.test(cellText(c))) badChars.push(`${ws.name}!${c.address}`); }));
  if (badChars.length) return `буква Е-с-точками или длинное тире в ячейках: ${badChars.slice(0, 5).join(", ")}`;
  return true;
});

// ──────────────────────────────────────────────────────────────────────────
// 3.5. docx v2 (build-strategy-docx.mjs)
// ──────────────────────────────────────────────────────────────────────────

console.log("\n=== 3.5. v2: docx build-strategy-docx.mjs ===");

async function docxText(path) {
  const zip = await JSZip.loadAsync(readFileSync(path));
  const parts = Object.keys(zip.files).filter((n) => /^word\/(document|header\d*|footer\d*)\.xml$/.test(n));
  let xml = "";
  for (const n of parts) xml += await zip.file(n).async("string");
  const text = xml
    .replace(/<w:tab\/>/g, " ")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
  return { parts, text };
}

// Проза с буквой Е-с-точками и длинным тире: сборщик обязан их нормализовать (гейт verify их ловит раньше).
const DOCX_CONTENT = v2Content();
DOCX_CONTENT.sections[1].blocks[3].items.push("Ёмкость спроса в регионе — около 20 000 запросов в месяц.");
const DOCX_DIR = copyV2Dir(V2_BASE.dir, "docx-v2", DOCX_CONTENT);
const DOCX_BUILD = runScript("build-strategy-docx.mjs", DOCX_DIR);
const DOCX_PATH = join(DOCX_DIR, `SEO_Strategy_${V2_INPUTS.slug}.docx`);
const V2_MARKERS = ["money_lost", "plan_timeline", "forecast_chart", "forecast_table", "forecast_drivers"];

await step("docx v2: собирается из content v2 + forecast.json -> exit 0, файл > 10 КБ, все 5 маркеров, без предупреждений", () => {
  if (DOCX_BUILD.code !== 0) return `exit ${DOCX_BUILD.code}: ${DOCX_BUILD.stdout}`;
  if (!existsSync(DOCX_PATH)) return `нет ${DOCX_PATH}`;
  const size = statSync(DOCX_PATH).size;
  if (size <= 10 * 1024) return `файл ${size} байт (ожидалось > 10 КБ)`;
  const m = /v2: разделов (\d+), маркеры: ([^\r\n]*)/.exec(DOCX_BUILD.stdout);
  if (!m) return `нет строки «v2: разделов N, маркеры: ...»: ${DOCX_BUILD.stdout}`;
  if (m[1] !== "4") return `разделов ${m[1]} (ожидалось 4)`;
  const done = m[2].split(",").map((s) => s.trim());
  const missing = V2_MARKERS.filter((x) => !done.includes(x));
  if (missing.length) return `не заполнены маркеры: ${missing.join(", ")}`;
  if (/ВНИМАНИЕ/.test(DOCX_BUILD.stdout)) return `предупреждения сборщика: ${DOCX_BUILD.stdout}`;
  return true;
});

const DOCX_TEXT = DOCX_BUILD.code === 0 && existsSync(DOCX_PATH) ? await docxText(DOCX_PATH) : null;

await step("docx v2: в document.xml тексты маркеров («Деньги, которые вы теряете», план по месяцам, график, таблица, драйверы) и сумма потерь", () => {
  if (!DOCX_TEXT) return "docx не собран";
  const low = DOCX_TEXT.text.toLowerCase();
  const need = [
    "деньги, которые вы теряете",
    "главное за одну минуту",
    "план работ по месяцам",
    "переходы из поиска по месяцам",
    "сейчас и через 3, 6 и 12 месяцев",
    "за счет чего растем к 12 месяцу",
    "следующий шаг",
  ];
  const miss = need.filter((s) => !low.includes(s));
  if (miss.length) return `нет текстов: ${miss.join(" | ")}`;
  // потери в месяц из forecast.json (lost_now.revenue_month) - заголовком блока в формате сборщика:
  // «около 1,7 млн ₽ в месяц» / «около 450 тыс ₽ в месяц»
  const lost = readJsonFile(join(DOCX_DIR, "forecast.json")).lost_now.revenue_month;
  const dec1 = (x) => String(Math.round(x * 10) / 10).replace(".", ",");
  const rubShort = (x) =>
    x >= 999500 ? `${x / 1e6 >= 10 ? Math.round(x / 1e6) : dec1(x / 1e6)} млн ₽` : x >= 1000 ? `${Math.round(x / 1000)} тыс ₽` : `${Math.round(x)} ₽`;
  const want = `около ${rubShort(lost)} в месяц`;
  const flat = DOCX_TEXT.text.replace(/[\s  ]+/g, " ");
  if (!flat.includes(want)) return `нет суммы потерь «${want}» (lost_now.revenue_month = ${lost})`;
  return true;
});

await step("docx v2: нет слова «тариф», буквы Е-с-точками и длинных тире (Е-с-точками и тире из прозы нормализованы)", () => {
  if (!DOCX_TEXT) return "docx не собран";
  const low = DOCX_TEXT.text.toLowerCase();
  const i = low.indexOf("тариф");
  if (i >= 0) return `слово «тариф»: "...${DOCX_TEXT.text.slice(Math.max(0, i - 40), i + 30)}..."`;
  if (/[ёЁ]/.test(DOCX_TEXT.text)) return "в документе осталась буква Е-с-точками";
  if (/[—–]/.test(DOCX_TEXT.text)) return "в документе осталось длинное/среднее тире";
  if (!low.includes("емкость спроса в регионе - около")) return "строка с Е-с-точками и тире не попала в документ (нечего проверять)";
  return true;
});

await step("docx v2 без forecast.json -> exit 1 (сначала build-forecast)", () => {
  const dir = copyV2Dir(V2_BASE.dir, "docx-v2-no-forecast");
  rmSync(join(dir, "forecast.json"), { force: true });
  const r = runScript("build-strategy-docx.mjs", dir);
  if (r.code !== 1) return `exit ${r.code} (expect 1): ${r.stdout}`;
  if (!/forecast\.json/.test(r.stdout)) return `сообщение без forecast.json: ${r.stdout}`;
  return true;
});

await step("docx легаси v1 (content без format, 6 разделов с тарифами) собирается -> exit 0", async () => {
  const dir = writeContent("docx-legacy", cleanContent());
  writeJson(join(dir, "inputs.json"), { domain: "example.ru", slug: "example-ru", date: "Июль 2026" });
  const r = runScript("build-strategy-docx.mjs", dir);
  if (r.code !== 0) return `exit ${r.code}: ${r.stdout}`;
  if (!/легаси/.test(r.stdout)) return `лог без пометки «легаси»: ${r.stdout}`;
  const p = join(dir, "SEO_Strategy_example-ru.docx");
  if (!existsSync(p)) return `нет ${p}`;
  const { text } = await docxText(p);
  if (!text.includes("Рекомендуемые направления работы")) return "в легаси-docx нет раздела 4 (тарифы)";
  return true;
});

// ──────────────────────────────────────────────────────────────────────────
// 3.6. verify-strategy.mjs v2
// ──────────────────────────────────────────────────────────────────────────

console.log("\n=== 3.6. v2: verify-strategy.mjs (format v2) ===");

function verifyV2Case(name, mutate) {
  const content = v2Content();
  if (mutate) mutate(content);
  return copyV2Dir(V2_BASE.dir, name, content);
}

await step("verify v2: чистый content + свежий forecast.json -> exit 0, ПРОГНОЗ: OK", () => {
  const r = runVerify(verifyV2Case("verify-v2-clean"));
  if (r.code !== 0) return `exit ${r.code}: ${r.stdout}`;
  if (!/формат v2/.test(r.stdout)) return `скрипт не ушел в ветку v2: ${r.stdout}`;
  if (!/ПРОГНОЗ: OK/.test(r.stdout)) return `нет «ПРОГНОЗ: OK»: ${r.stdout}`;
  for (const h of ["СТРУКТУРА (", "ДЕНЬГИ В ПРОЗЕ", "ТАРИФЫ В ПРОЗЕ", "СТОП-ПАТТЕРНЫ", "ТИРЕ/"]) {
    if (r.stdout.includes(h)) return `ложное нарушение «${h}»: ${r.stdout}`;
  }
  if (/подозрительно тонкая|проза раздута/.test(r.stdout)) return `объем фикстуры вне 2500-14000: ${r.stdout}`;
  return true;
});

await step("verify v2: «25 000 ₽» в paragraph -> exit 2, ДЕНЬГИ В ПРОЗЕ с фрагментом, чинит strategy-writer", () => {
  const r = runVerify(verifyV2Case("verify-v2-money", (c) => {
    c.sections[0].blocks[0].text += " Средняя стоимость заказа 25 000 ₽.";
  }));
  if (r.code !== 2) return `exit ${r.code} (expect 2): ${r.stdout}`;
  if (!/ДЕНЬГИ В ПРОЗЕ/.test(r.stdout)) return `нет заголовка ДЕНЬГИ В ПРОЗЕ: ${r.stdout}`;
  if (!/25 000 ₽/.test(r.stdout)) return "фрагмент с суммой не найден";
  if (!/strategy-writer: .*ДЕНЬГИ В ПРОЗЕ/.test(r.stdout)) return "маршрут к strategy-writer не напечатан";
  return true;
});

await step("verify v2: «тариф «Рост»» в прозе -> exit 2, ТАРИФЫ В ПРОЗЕ", () => {
  const r = runVerify(verifyV2Case("verify-v2-tariff", (c) => {
    c.sections[2].blocks[0].text += " Все это входит в тариф «Рост».";
  }));
  if (r.code !== 2) return `exit ${r.code} (expect 2): ${r.stdout}`;
  if (!/ТАРИФЫ В ПРОЗЕ/.test(r.stdout)) return `нет заголовка ТАРИФЫ В ПРОЗЕ: ${r.stdout}`;
  if (!/слово «тариф»/.test(r.stdout)) return "не названо слово «тариф»";
  if (!/«Рост»/.test(r.stdout)) return "не названо имя пакета «Рост» в кавычках";
  return true;
});

await step("verify v2: нет маркера money_lost в situation -> exit 2, СТРУКТУРА", () => {
  const r = runVerify(verifyV2Case("verify-v2-no-money-lost", (c) => {
    c.sections[0].blocks = c.sections[0].blocks.filter((b) => b.type !== "money_lost");
  }));
  if (r.code !== 2) return `exit ${r.code} (expect 2): ${r.stdout}`;
  if (!/СТРУКТУРА \(/.test(r.stdout)) return `нет заголовка СТРУКТУРА: ${r.stdout}`;
  if (!/money_lost/.test(r.stdout)) return "нарушение не называет money_lost";
  return true;
});

await step("verify v2: рассинхрон forecast.json с tariffs.json (цена поменялась после прогноза) -> exit 2, ПРОГНОЗ, чинит оркестратор", () => {
  const dir = verifyV2Case("verify-v2-desync");
  const t = v2Tariffs();
  t.growth.monthly.find((s) => s.id === "YM").price = 35000;
  t.growth.total_monthly = 60000;
  writeJson(join(dir, "tariffs.json"), t);
  const r = runVerify(dir);
  if (r.code !== 2) return `exit ${r.code} (expect 2): ${r.stdout}`;
  if (!/ПРОГНОЗ \(/.test(r.stdout)) return `нет заголовка ПРОГНОЗ: ${r.stdout}`;
  if (!/перезапусти build-forecast/.test(r.stdout)) return "нет подсказки перезапустить build-forecast";
  if (!/оркестратор: ПРОГНОЗ/.test(r.stdout)) return "маршрут к оркестратору не напечатан";
  if (/- strategy-writer:/.test(r.stdout)) return "прогноз ошибочно отправлен писателю";
  return true;
});

await step("verify v2: нет forecast.json -> exit 2, ПРОГНОЗ (шаг 5.5 не выполнен)", () => {
  const dir = verifyV2Case("verify-v2-no-forecast");
  rmSync(join(dir, "forecast.json"), { force: true });
  const r = runVerify(dir);
  if (r.code !== 2) return `exit ${r.code} (expect 2): ${r.stdout}`;
  if (!/нет forecast\.json \(шаг 5\.5 не выполнен\)/.test(r.stdout)) return `нет нарушения про forecast.json: ${r.stdout}`;
  return true;
});

await step("verify v2: сумма, разнесенная по полям (kpi value + label, заголовок таблицы + ячейка) -> exit 2, ДЕНЬГИ В ПРОЗЕ", () => {
  const r = runVerify(verifyV2Case("verify-v2-kpi-money", (c) => {
    c.sections[0].blocks[1].items.push({ value: "~1,3 млн", label: "выручки в месяц уходят конкурентам", tone: "bad" });
  }));
  if (r.code !== 2) return `kpi: exit ${r.code} (expect 2): ${r.stdout}`;
  if (!/ДЕНЬГИ В ПРОЗЕ/.test(r.stdout) || !/разнесена по полям/.test(r.stdout)) return `kpi: нет нарушения: ${r.stdout}`;
  const r2 = runVerify(verifyV2Case("verify-v2-table-money", (c) => {
    c.sections[1].blocks.push({ type: "table", columns: ["Конкурент", "Средний чек"], rows: [["a-remont.ru", "45 000"], ["b-remont.ru", "52 000"]] });
  }));
  if (r2.code !== 2 || !/разнесена по полям/.test(r2.stdout)) return `table: exit ${r2.code}: ${r2.stdout}`;
  // не деньги: «визитов» в заголовке и kpi трафика
  const r3 = runVerify(verifyV2Case("verify-v2-table-visits", (c) => {
    c.sections[1].blocks.push({ type: "table", columns: ["Конкурент", "Визитов в месяц"], rows: [["a-remont.ru", "6 000"], ["b-remont.ru", "1 800"]] });
  }));
  if (r3.code !== 0) return `таблица трафика ложно поймана: exit ${r3.code}: ${r3.stdout}`;
  return true;
});

await step("verify v2: table с объектами в rows -> exit 2, СТРУКТУРА (в docx было бы «[object Object]»)", () => {
  const r = runVerify(verifyV2Case("verify-v2-tblobj", (c) => {
    c.sections[1].blocks.push({ type: "table", columns: ["Конкурент", "Страниц"], rows: [{ name: "a-remont.ru", pages: 60 }] });
  }));
  if (r.code !== 2) return `exit ${r.code} (expect 2): ${r.stdout}`;
  if (!/СТРУКТУРА \(/.test(r.stdout) || !/rows\[0\] не массив/.test(r.stdout)) return `нет нарушения структуры: ${r.stdout}`;
  return true;
});

await step("verify v2: «Вариант Рост» / «Пакет Максимум» с прописной в начале фразы -> exit 2, ТАРИФЫ В ПРОЗЕ", () => {
  const r = runVerify(verifyV2Case("verify-v2-pkg-cap", (c) => {
    c.sections[2].blocks[0].text += " Вариант Рост закрывает обе проблемы.";
  }));
  if (r.code !== 2 || !/ТАРИФЫ В ПРОЗЕ/.test(r.stdout) || !/Вариант Рост/.test(r.stdout)) return `exit ${r.code}: ${r.stdout}`;
  return true;
});

await step("verify v2: DEV в plan_item при site_dev.recommended = false -> предупреждение СОСТАВ ПЛАНА", () => {
  const dir = verifyV2Case("verify-v2-dev-norec", (c) => {
    const pi = c.sections[2].blocks.find((b) => b.type === "plan_item");
    pi.services = [...pi.services, "DEV"];
  });
  const t = v2Tariffs();
  t.site_dev.recommended = false;
  writeJson(join(dir, "tariffs.json"), t);
  const r = runVerify(dir);
  if (r.code !== 0) return `exit ${r.code} (expect 0 - предупреждение): ${r.stdout}`;
  if (!/site_dev\.recommended не true/.test(r.stdout)) return `нет предупреждения про DEV: ${r.stdout}`;
  return true;
});

await step("docx: format «V2» (регистр, пробелы) собирается v2-рендером, как его принимает verify", () => {
  const c = v2Content();
  c.format = " V2 ";
  const dir = copyV2Dir(V2_BASE.dir, "docx-v2-case", c);
  const r = runScript("build-strategy-docx.mjs", dir);
  if (r.code !== 0) return `exit ${r.code}: ${r.stdout}`;
  if (!/bytes, v2\)/.test(r.stdout)) return `ушел в легаси-рендер: ${r.stdout}`;
  return true;
});

await step("docx v2: money_lost - обращения из Карт отдельно («N с сайта и M из Яндекс Карт»), фактическая конверсия в допущениях", () => {
  if (!DOCX_TEXT) return "docx не собран";
  const fc = readJsonFile(join(V2_BASE.dir, "forecast.json"));
  if (!(fc.lost_now.leads_maps_month > 0)) return `в фикстуре нет обращений из Карт: ${fc.lost_now.leads_maps_month}`;
  const t = DOCX_TEXT.text.replace(/ /g, " ");
  if (!/с сайта и [\d,]+ из Яндекс Карт/.test(t)) return "нет разбивки «с сайта и ... из Яндекс Карт» в воронке";
  if (!/из карточки напрямую/.test(t)) return "нет пояснения про обращения из Карт";
  return true;
});

console.log("\n=== 3.7. v2: смета - правки ревью (текст агента, special, рекомендация при проваленном гейте) ===");

async function buildSmetaCase(name, patchTariffs, patchForecast) {
  const dir = copyV2Dir(V2_BASE.dir, name);
  if (patchTariffs) {
    const t = readJsonFile(join(dir, "tariffs.json"));
    patchTariffs(t);
    writeJson(join(dir, "tariffs.json"), t);
  }
  if (patchForecast) {
    const f = readJsonFile(join(dir, "forecast.json"));
    patchForecast(f);
    writeJson(join(dir, "forecast.json"), f);
  }
  const r = runBuildSmeta(dir);
  const path = join(dir, `Smeta_${V2_INPUTS.slug}.xlsx`);
  let wb = null;
  if (r.code === 0 && existsSync(path)) { wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(path); }
  return { r, wb };
}
const allCells = (wb) => {
  const out = [];
  for (const ws of wb.worksheets) ws.eachRow((row) => row.eachCell((c) => out.push({ sheet: ws.name, addr: c.address, text: cellText(c) })));
  return out;
};

await step("смета v2: е-с-точками и тире из hint, promos.reason, site_dev.reason нормализованы; special (сателлит) - блок «Дополнительно»", async () => {
  const { r, wb } = await buildSmetaCase("smeta-v2-clean", (t) => {
    t.growth.hint = "Ещё больше страниц — и всё под спрос.";
    t.growth.promos[0].reason = "сайт ещё молодой — второй месяц в подарок";
    t.site_dev.reason = "лендинг — а нужны страницы услуг, всё по структуре";
    t.special = [{ id: "ST", reason: "если бюджет позволит после первых результатов" }];
  });
  if (!wb) return `смета не собралась: exit ${r.code}: ${r.stdout}`;
  const bad = allCells(wb).filter((c) => /[ёЁ—–]/.test(c.text));
  if (bad.length) return `е-с-точками/тире: ${bad.slice(0, 4).map((c) => `${c.sheet}!${c.addr}`).join(", ")}`;
  const cmp = wb.getWorksheet("Сравнение тарифов");
  if (!findCell(cmp, /^Дополнительно/)) return "нет блока «Дополнительно» на «Сравнение тарифов»";
  if (!findCell(cmp, /^Сателлит.*50[\s ]000.*если бюджет позволит/)) return "сателлит не выведен строкой с ценой и причиной";
  return true;
});

await step("смета v2: recommended_offer = null (гейт не пройден, все в минусе) - ни один тариф не «рекомендуем», строка про уточнение экономики", async () => {
  const { r, wb } = await buildSmetaCase("smeta-v2-noreco", null, (f) => { f.recommended_offer = null; });
  if (!wb) return `смета не собралась: exit ${r.code}: ${r.stdout}`;
  const reco = allCells(wb).filter((c) => /РЕКОМЕНДУЕМ|\(рекомендуем\)/.test(c.text) && c.sheet !== "Разработка сайта");
  if (reco.length) return `осталась пометка рекомендации: ${reco.slice(0, 3).map((c) => `${c.sheet}!${c.addr}`).join(", ")}`;
  if (!findCell(wb.getWorksheet("Сравнение тарифов"), /Рекомендацию по тарифу дадим после уточнения/)) return "нет строки про уточнение экономики";
  const { wb: wb2 } = await buildSmetaCase("smeta-v2-reco-start", null, (f) => { f.recommended_offer = "start"; });
  if (!/РЕКОМЕНДУЕМ/.test(cellText(wb2.getWorksheet("Старт").getCell(1, 1)))) return "recommended_offer start: лист «Старт» не помечен";
  if (/РЕКОМЕНДУЕМ/.test(cellText(wb2.getWorksheet("Рост").getCell(1, 1)))) return "recommended_offer start: Рост все еще помечен";
  return true;
});

await step("смета v2: «Окупаемость» и «Сравнение» подписывают обращения как дополнительные (сверх текущих), не «всего»", async () => {
  const bad = needSmeta();
  if (bad) return bad;
  const cells = allCells(SMETA.wb);
  if (cells.some((c) => /^Обращения всего$/.test(c.text))) return "осталась подпись «Обращения всего»";
  if (!cells.some((c) => c.sheet === PB && /^Дополнительные обращения/.test(c.text))) return "нет «Дополнительные обращения» на «Окупаемость»";
  if (!cells.some((c) => c.sheet === "Сравнение тарифов" && /^Дополнительных обращений в месяц/.test(c.text))) return "нет подписи в «Сравнение тарифов»";
  return true;
});

await step("смета легаси: названия услуг - тексты сметы того времени (CATALOG_V1), не новый каталог", async () => {
  const dir = writeSmetaFixture("smeta-legacy-names", { legacy: true });
  const t = readJsonFile(join(dir, "tariffs.json"));
  t.start.onetime = [...(t.start.onetime || []), { id: "FA", price: 25000 }];
  writeJson(join(dir, "tariffs.json"), t);
  const r = runBuildSmeta(dir);
  if (r.code !== 0) return `exit ${r.code}: ${r.stdout}`;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(join(dir, "Smeta_example-ru.xlsx"));
  const ws = wb.getWorksheet("Старт");
  if (!findCell(ws, /^Полный технический SEO-аудит сайта$/)) return "FA не старым названием «Полный технический SEO-аудит сайта»";
  if (findCell(ws, /под Яндекс$/)) return "в легаси-смете название из нового каталога";
  return true;
});

// === Итог ===
console.log("");
console.log(`=== ${passed}/${passed + failed} tests passed ===`);
if (failed > 0) {
  for (const f of failures) console.error(`  FAIL: ${f}`);
  console.error(`  Песочница оставлена для разбора: ${SANDBOX}`);
  process.exit(1);
}
// Зеленый прогон убирает свою песочницу; пустую корневую папку - тоже.
rmSync(SANDBOX, { recursive: true, force: true });
try {
  if (!readdirSync(SANDBOX_ROOT).length) rmSync(SANDBOX_ROOT, { recursive: true, force: true });
} catch {
  /* нет корня - нечего убирать */
}
process.exit(0);
