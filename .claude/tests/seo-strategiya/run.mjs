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
//   3. v2 (программа 06.10.2026, docs/upgrade-program-2026-10-06-strategy-v2.md §8) + модель v2.1 (боевой прогон
//      на 5 клиентах, второй круг):
//      модель _forecast-model.mjs (монотонность тарифов, Старт ~ Рост на 3-м мес, Рост > Старт на 12-м,
//      прирост от m0, акция ПФ 1=2, конверсия от прототипа, экономический гейт; v2.1 - мягкий потолок softCap /
//      trafficCap и срез пропорционально, месяц запуска нового сайта и затраты с него, цикл сделки, повторные
//      покупки, recommendOffer / plan_tariff, потери lostNowCalc, мягкие проверки потолка и одинаковых тарифов);
//      каталог _services.mjs (ступени цены подстраниц с полом, лендинг, порядок PA -> SY -> KP -> FQ);
//      build-forecast.mjs (exit 0/2/3, экономика клиента, проценты -> доли, поля v2.1, новый сайт, потери);
//      смета v2 (листы, формулы «Окупаемость» = forecast.json и модели, LTV и цикл сделки формулами, m0,
//      безубыточность, ROMI с разработкой, кэш формул и fullCalcOnLoad, кухня архитектора не в смете,
//      «Разработка сайта»); docx v2 (маркеры, без «тариф», легаси v1, план по plan_tariff, строка разработки,
//      без абсолютной выручки «без работ», склонения); verify-strategy v2 (деньги и тарифы в прозе, нет маркера,
//      рассинхрон прогноза, ЭКОНОМИКА, СОСТАВ ПЛАНА по тарифу плана).
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
  ECON_DEFAULTS, softCap, trafficCap, launchMonth, resolveEconomics, recommendOffer, lostNowCalc, applyClientEconomics,
  START_HARD_PREFIX,
} from "../../scripts/_forecast-model.mjs";
import {
  devPrice, devSubpagesPrice, timelineFor, serviceMeta, canonicalId, DEV_OPTIONS, TIMELINE, DEV_TIMELINE,
} from "../../scripts/_services.mjs";
import { nicheCard } from "../../scripts/_niche.mjs";

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

// ── Фикстура v2.1 «новый сайт» (боевой прогон 06.10, натяжные потолки в Сочи) ──
// Сайта и трафика нет, точный спрос главных фраз мал (178 - старый жесткий потолок 20% давал плоские 36 визитов
// с 3-го мес), у прямых конкурентов 129 / 207 переходов. Старт для нового сайта уже PA + SY + KP + PF (RULES
// раздел 5), Рост = Старт + FQ + LB, Максимум - PFP + LA. Разработку рекомендуем, делает разработчик клиента ->
// сайт в поиске к 3-му мес. Экономика: Рост за 12 мес в минусе и хуже Старта -> гейт не пройден (exit 3),
// смета рекомендует Старт, план docx - по Старту.
const V2_NEW_FI = {
  business_type: "services",
  competition: "medium",
  t0: 0,
  t0_source: "keyso",
  pages: { existing_commercial: 0, planned_new: 40, catalog_cards: 0 },
  demand: { commercial_month: 178, info_month: 0, basis: "сумма точных частот 38 маркеров по Сочи (тестовая фикстура)" },
  local: false,
  maps_card: "none",
  tech_critical: false,
  has_positions: false,
  site_age_months: 0,
  implementation_lag_shift: 0,
  competitors_traffic: { median: 129, leader: 207, basis: "Keyso, топ-3 прямых (тестовая фикстура)" },
  economics: {
    avg_check: 30000, avg_check_source: "site", conversion_rate: 0.05, close_rate: 0.3, margin: 0.4,
    model: "two_step", basis: "тестовая фикстура",
  },
};

function v2NewTariffs() {
  const pf2 = { type: "pf_2for1", reason: "сайта пока нет - второй месяц внешнего продвижения после запуска в подарок" };
  const startOnce = [{ id: "PA", price: 5000 }, { id: "SY", price: 25000 }, { id: "KP", price: 25000 }];
  return {
    diagnostics: { has_positions: false, site_profile: "new", local_with_address: false, maps_card: "none" },
    start: {
      onetime: clone(startOnce),
      monthly: [{ id: "PF", price: 25000 }, { id: "RP", price: 0 }],
      promos: [pf2],
      total_onetime: 55000,
      total_monthly: 25000,
      hint: "Новый сайт под спрос: анализ, структура и прототип с текстами, после запуска - внешнее продвижение.",
    },
    growth: {
      onetime: [...clone(startOnce), { id: "FQ", price: 25000 }],
      monthly: [{ id: "PF", price: 25000 }, { id: "LB", price: 25000 }, { id: "RP", price: 0 }],
      promos: [pf2],
      total_onetime: 80000,
      total_monthly: 50000,
      hint: "Все из Старта плюс ключевые слова на страницах и ссылки с других сайтов.",
    },
    max: {
      onetime: [...clone(startOnce), { id: "FQ", price: 25000 }],
      monthly: [{ id: "PFP", price: 45000 }, { id: "LA", price: 45000 }, { id: "RP", price: 0 }],
      promos: [pf2],
      total_onetime: 80000,
      total_monthly: 90000,
      hint: "Профиль «Активный»: усиленное продвижение и больше ссылок.",
    },
    site_dev: {
      recommended: true, format: "multipage", pages: 40, home_blocks: 10,
      reason: "сайта нет - прогноз держится на новом сайте", promo_note: "при заказе разработки у нас - акция ПФ 1=2",
    },
    economics_round: 0,
  };
}

const V2_NEW_INPUTS = {
  url_raw: "", domain: "none", slug: "no-site-potolki", date: "Октябрь 2026", region: "Сочи", niche: "Натяжные потолки",
  avg_check: null, conversion_rate: null, close_rate: null, margin: null, we_develop: false,
};

// Content нового сайта: работы плана - из Старта (тариф плана при проваленном гейте).
function v2NewContent() {
  const c = v2Content();
  const items = c.sections[2].blocks.filter((b) => b.type === "plan_item");
  items[0].services = ["PA", "SY"];
  items[1].services = ["KP"];
  items[2].services = ["SY"];
  items[3].services = ["PF"];
  return c;
}

// ── Фикстура «упор в потолок»: точный спрос (100) ниже текущего трафика (1 000), у всех трех тарифов структура на
// 200 страниц - кривые упираются в мягкий потолок t0 x 2,5 к 3-му мес и почти совпадают (топдом, burols).
const CAP_FI = {
  business_type: "services", competition: "medium", t0: 1000,
  pages: { existing_commercial: 12, planned_new: 200, catalog_cards: 0 },
  demand: { commercial_month: 100 }, local: false, economics: { avg_check: 40000 },
};
function capTariffs() {
  const once = [{ id: "PA", price: 5000 }, { id: "SY", price: 25000 }, { id: "KP", price: 25000 }];
  return {
    start: { onetime: clone(once), monthly: [{ id: "PF", price: 25000 }, { id: "RP", price: 0 }], total_onetime: 55000, total_monthly: 25000 },
    growth: {
      onetime: [...clone(once), { id: "FQ", price: 25000 }],
      monthly: [{ id: "PF", price: 25000 }, { id: "LB", price: 25000 }, { id: "RP", price: 0 }], total_onetime: 80000, total_monthly: 50000,
    },
    max: {
      onetime: [...clone(once), { id: "FQ", price: 25000 }],
      monthly: [{ id: "PFP", price: 45000 }, { id: "LA", price: 45000 }, { id: "RP", price: 0 }], total_onetime: 80000, total_monthly: 90000,
    },
  };
}

// ── Текст docx / xlsx как его видит читатель: пробелы тысяч обычные, числа и деньги в формате сборщиков ──
const flatText = (s) => String(s || "").replace(/[\s  ]+/g, " ");
const fmtIntS = (n) => Math.round(Number(n) || 0).toLocaleString("ru-RU").replace(/[  ]/g, " ");
const dec1S = (x) => String(Math.round(x * 10) / 10).replace(".", ",");
// обращения / продажи: до 10 - с одним знаком (5,2), дальше целые (fmtCount сборщика docx)
const fmtCountS = (x) => (Math.abs(x) < 10 ? dec1S(x) : fmtIntS(x));
// деньги docx: «1,2 млн ₽», «450 тыс ₽», «900 ₽» (fmtRub сборщика)
const rubShortS = (x) =>
  x >= 999500 ? `${x / 1e6 >= 10 ? fmtIntS(x / 1e6) : dec1S(x / 1e6)} млн ₽` : x >= 1000 ? `${fmtIntS(x / 1000)} тыс ₽` : `${fmtIntS(x)} ₽`;
// родительный после «до»: «до 571 перехода», «до 266 переходов»
const trafficGenS = (n) => { const x = Math.round(n); return x % 10 === 1 && x % 100 !== 11 ? "перехода" : "переходов"; };

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

await step("модель: Старт и Рост близки на 3-м мес при ПФ в обоих (Рост без Карт; Старт/Рост >= 0,75), Рост заметно выше на 12-м (>= 1,3 при planned_new > 0)", () => {
  if (!(V2_FI.pages.planned_new > 0)) return "фикстура: planned_new должен быть > 0";
  // v2.2: Карты усиливают ПФ в 1,5 раза - Рост с Картами уходит вперед уже к 3-му мес (это отдельный тест ниже);
  // «почти вровень на 3-м мес» - про структуру и тексты, поэтому здесь Рост без Карт.
  const t = v2Tariffs();
  t.growth.monthly = t.growth.monthly.filter((x) => x.id !== "YM");
  t.growth.total_monthly = t.growth.monthly.reduce((acc, x) => acc + (x.price || 0), 0);
  const res = computeAll(V2_FI, t);
  const s = res.start.checkpoints, g = res.growth.checkpoints;
  if (!res.start.ids.includes("PF") || !res.growth.ids.includes("PF")) return "фикстура: ПФ должен быть в обоих тарифах";
  const r3 = s.m3 / g.m3;
  const r12 = g.m12 / s.m12;
  if (r3 < 0.75) return `m3: Старт ${Math.round(s.m3)} / Рост ${Math.round(g.m3)} = ${r3.toFixed(2)} (< 0,75)`;
  if (r12 < 1.3) return `m12: Рост ${Math.round(g.m12)} / Старт ${Math.round(s.m12)} = ${r12.toFixed(2)} (< 1,3)`;
  return true;
});

await step("модель v2.2: Карты усиливают ПФ - Рост с Картами выше Роста без Карт на 3-м и 12-м мес; разгон новых страниц с ПФ к 6-му мес >= 80% уровня, без ПФ к 12-му мес только около 90%", () => {
  const fi = v2Fi({ local: true, maps_card: "verified" });
  const t = v2Tariffs();
  const noYm = JSON.parse(JSON.stringify(t.growth));
  noYm.monthly = noYm.monthly.filter((x) => x.id !== "YM");
  const withYm = computeTariff(fi, { ...t.growth, monthly: [...noYm.monthly, { id: "YM", price: 25000 }] });
  const without = computeTariff(fi, noYm);
  if (!(withYm.checkpoints.m3 > without.checkpoints.m3 * 1.1)) return `m3: с Картами ${Math.round(withYm.checkpoints.m3)}, без ${Math.round(without.checkpoints.m3)}`;
  if (!(withYm.checkpoints.m12 > without.checkpoints.m12)) return "m12: Карты не добавили трафика";
  // ПФ ускоряет выход в топ: новые страницы с ПФ (без Карт) к 6-му мес >= 80% уровня, без ПФ к 6-му мес < 60%
  const fiNew = v2Fi({ t0: 0, local: false, pages: { existing_commercial: 0, planned_new: 40, catalog_cards: 0 }, site_launch_month: 1, site_age_months: 36 });
  const pf = trafficSeries(fiNew, new Set(["PA", "SY", "KP", "PF", "RP"]));
  const nopf = trafficSeries(fiNew, new Set(["PA", "SY", "KP"]));
  const lvlPf = pf[24].commercial, lvlNo = nopf[24].commercial;
  if (pf[6].commercial < 0.8 * lvlPf) return `с ПФ к 6-му мес ${Math.round(pf[6].commercial)} из ${Math.round(lvlPf)} (< 80%)`;
  if (nopf[6].commercial > 0.6 * lvlNo) return `без ПФ к 6-му мес уже ${Math.round(nopf[6].commercial)} из ${Math.round(lvlNo)} (> 60%)`;
  if (nopf[12].commercial < 0.8 * lvlNo || nopf[12].commercial > 0.97 * lvlNo) return `без ПФ к 12-му мес ${Math.round(nopf[12].commercial)} из ${Math.round(lvlNo)} (ожидалось ~90%)`;
  return true;
});

await step("модель v2.2: новый сайт на новом домене - ПФ без Карт в 1-й мес после запуска дает меньше 100 переходов (но не 0 к 2-му), ПФ с Картами - больше 100", () => {
  const fiNew = v2Fi({ t0: 0, local: true, maps_card: "none", pages: { existing_commercial: 0, planned_new: 40, catalog_cards: 0 }, we_develop: true, site_age_months: 0 });
  const L = launchMonth(fiNew);
  const noYm = trafficSeries(fiNew, new Set(["PA", "SY", "KP", "PF", "RP"]));
  const ym = trafficSeries(fiNew, new Set(["PA", "SY", "KP", "PF", "YM", "RP"]));
  if (!(noYm[L + 1].commercial < 100)) return `без Карт мес ${L + 1}: ${Math.round(noYm[L + 1].commercial)} (>= 100)`;
  if (!(noYm[L + 2].commercial > 0)) return `без Карт мес ${L + 2}: 0`;
  if (!(ym[L + 1].commercial >= 100)) return `с Картами мес ${L + 1}: ${Math.round(ym[L + 1].commercial)} (< 100)`;
  return true;
});

// ── v2.3 (приемка владельца 06.10: «на полном комплекте те же 200 переходов через год») ──

await step("модель v2.3: новый сайт ~40 страниц, Рост с ПФ и Картами - 100+ в 1-й мес после запуска, 250+ ко 2-му, 500+ к 12-му; ПФ поднимает уровень новых страниц, а не только скорость", () => {
  const fiNew = v2Fi({ t0: 0, local: true, maps_card: "none", pages: { existing_commercial: 0, planned_new: 40, catalog_cards: 0 }, demand: { commercial_month: 3000, info_month: 0 }, site_age_months: 0 });
  const L = launchMonth(fiNew);
  const full = trafficSeries(fiNew, new Set(["PA", "SY", "KP", "FQ", "PF", "YM", "RP"]));
  if (!(full[L + 1].commercial >= 100)) return `мес ${L + 1} (1-й после запуска): ${Math.round(full[L + 1].commercial)} (< 100)`;
  if (!(full[L + 2].commercial >= 250)) return `мес ${L + 2}: ${Math.round(full[L + 2].commercial)} (< 250)`;
  if (!(full[12].commercial >= 500)) return `мес 12: ${Math.round(full[12].commercial)} (< 500 - «те же 200 через год»)`;
  // ПФ поднимает уровень: зрелость с ПФ выше, чем без него (раньше ПФ на новых страницах менял только скорость)
  const pf = trafficSeries(fiNew, new Set(["PA", "SY", "KP", "FQ", "PF", "RP"]));
  const nopf = trafficSeries(fiNew, new Set(["PA", "SY", "KP", "FQ"]));
  if (!(pf[24].commercial > nopf[24].commercial * 1.15)) return `зрелость: с ПФ ${Math.round(pf[24].commercial)}, без ПФ ${Math.round(nopf[24].commercial)} (ПФ не поднял уровень)`;
  if (!(full[24].commercial > pf[24].commercial)) return "Карты не усилили ПФ на зрелости";
  return true;
});

await step("модель v2.3: новый сайт - Старт (структура + ПФ) < Рост (+ тексты и n-граммы) < Максимум (+ ПФ Продвинутый) к 12-му мес; PFP сильнее PF на существующих и новых страницах", () => {
  const fiNew = v2Fi({ t0: 0, local: false, pages: { existing_commercial: 0, planned_new: 35, catalog_cards: 0 }, demand: { commercial_month: 5000, info_month: 0 }, site_age_months: 0 });
  const s = trafficSeries(fiNew, new Set(["PA", "SY", "PF", "RP"]))[12].commercial;
  const g = trafficSeries(fiNew, new Set(["PA", "SY", "KP", "FQ", "PF", "RP"]))[12].commercial;
  const x = trafficSeries(fiNew, new Set(["PA", "SY", "KP", "FQ", "PFP", "RP"]))[12].commercial;
  if (!(g > s * 1.3)) return `Рост ${Math.round(g)} / Старт ${Math.round(s)} < 1,3 - тексты не дают разницы`;
  if (!(x > g * 1.03)) return `Максимум с PFP ${Math.round(x)} / Рост ${Math.round(g)} < 1,03 - PFP не добавил`;
  const ex = v2Fi({ local: false });
  const pf = trafficSeries(ex, new Set(["PF", "RP"]))[6].commercial, pfp = trafficSeries(ex, new Set(["PFP", "RP"]))[6].commercial;
  if (!(pfp > pf * 1.05)) return `существующие страницы к 6-му мес: PFP ${Math.round(pfp)}, PF ${Math.round(pf)}`;
  return true;
});

await step("модель v2.3: гейт - Старт в минусе при окупаемом Росте дает блок «Старт:», рекомендация остается Рост; Рост тоже в минусе - блок про Рост, Старт - предупреждение", () => {
  const mk = (s1, g1) => ({ start: { year1: { romi: s1, net: s1, sales: 50 }, year2: { net: 0, romi: 10 }, checkpoints: { m12: 100 }, ids: ["PF"] }, growth: { year1: { romi: g1, net: g1 * 10, sales: 50 }, year2: { net: 0, romi: 10 }, checkpoints: { m12: 200 }, ids: ["PF", "SY"] } });
  const a = economicsChecks(mk(-20, 120));
  if (!a.hard.some((h) => h.startsWith(START_HARD_PREFIX))) return `Старт -20%, Рост +120%: нет блока Старта (${a.hard.join("; ") || "hard пуст"})`;
  const off = recommendOffer(mk(-20, 120), a);
  if (off.recommended_offer !== "growth") return `рекомендация ${off.recommended_offer} (ожидался Рост)`;
  const b = economicsChecks(mk(-30, -10));
  if (b.hard.some((h) => h.startsWith(START_HARD_PREFIX))) return "Рост в минусе: блок Старта не должен дублировать блок Роста";
  if (!b.soft.some((h) => /ROMI Старта за 12 мес/.test(h))) return "Рост в минусе: нет предупреждения про Старт";
  return true;
});

await step("модель v2.4: экспертная оценка forecast_m12 - трафик 12-го мес = оценка, форма кривой от модели (новый сайт: до запуска 0), без оценки - формула; build-forecast блокирует Рост ниже Старта и оценку ниже t0", () => {
  const t = v2Tariffs();
  t.start.forecast_m12 = { traffic: 900, basis: "тест" };
  t.growth.forecast_m12 = { traffic: 2000, basis: "тест" };
  t.max.forecast_m12 = { traffic: 2600, basis: "тест" };
  const res = computeAll(V2_FI, t);
  for (const [k, v] of [["start", 900], ["growth", 2000], ["max", 2600]]) {
    if (Math.abs(res[k].checkpoints.m12 - v) > 0.5) return `${k}: m12 ${res[k].checkpoints.m12.toFixed(1)} != оценка ${v}`;
    if (res[k].target_m12 !== v) return `${k}: target_m12 ${res[k].target_m12}`;
  }
  const g = res.growth.months.map((x) => x.traffic);
  for (let m = 1; m < 12; m++) if (g[m] + 1e-9 < g[m - 1]) return `Рост: кривая не монотонна на мес ${m + 1}`;
  const plain = computeTariff(V2_FI, v2Tariffs().growth);
  if (plain.target_m12 !== null) return "без оценки target_m12 не null";
  const nt = v2NewTariffs();
  nt.growth.forecast_m12 = { traffic: 400, basis: "тест" };
  const ng = computeTariff(V2_NEW_FI, nt.growth);
  if (ng.months.slice(0, 2).some((x) => x.traffic !== 0) || Math.abs(ng.checkpoints.m12 - 400) > 0.5) return `новый сайт: мес 1-2 ${ng.months.slice(0, 2).map((x) => x.traffic).join(",")}, m12 ${ng.checkpoints.m12}`;
  const bad = v2Tariffs();
  bad.start.forecast_m12 = { traffic: 2000, basis: "тест" };
  bad.growth.forecast_m12 = { traffic: 1500, basis: "тест" };
  bad.max.forecast_m12 = { traffic: 100, basis: "" };
  const r = writeV2Dir("bf-target-bad", { tariffs: bad, content: null });
  if (r.code !== 3 || !/ПРАВИЛА ТАРИФОВ/.test(r.stdout) || !/Рост 1500 ниже Старта 2000/.test(r.stdout) || !/ниже текущего трафика/.test(r.stdout) || !/basis пуст/.test(r.stdout)) return `build-forecast: exit ${r.code}: ${r.stdout.slice(0, 400)}`;
  return true;
});

await step("модель v2.2: техаудит дает буст только при серьезных ошибках (tech_critical), ссылки - не раньше 4-го мес", () => {
  const fi = v2Fi({ local: false });
  const ids = new Set(["FA", "PF", "RP"]);
  const plain = trafficSeries({ ...fi, tech_critical: false }, ids)[6].commercial;
  const crit = trafficSeries({ ...fi, tech_critical: true }, ids)[6].commercial;
  const none = trafficSeries({ ...fi, tech_critical: false }, new Set(["PF", "RP"]))[6].commercial;
  if (!(crit > plain * 1.05)) return `FA при серьезных ошибках не дал буста: ${Math.round(crit)} против ${Math.round(plain)}`;
  if (!(plain < none * 1.03)) return `FA без серьезных ошибок дал заметный буст: ${Math.round(plain)} против ${Math.round(none)}`;
  const lb = trafficSeries(fi, new Set(["PF", "LB", "RP"])), base = trafficSeries(fi, new Set(["PF", "RP"]));
  for (let m = 1; m <= 4; m++) if (Math.abs(lb[m].commercial - base[m].commercial) > 1e-6) return `ссылки дали эффект уже на ${m}-м мес`;
  if (!(lb[8].commercial > base[8].commercial)) return "ссылки не дали эффекта и к 8-му мес";
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

// ── v2.1: потолок, запуск нового сайта, цикл сделки, повторные покупки, рекомендация, потери ──

await step("модель v2.1: softCap - до колена (0,6 x потолка) без изменений, дальше монотонно и ниже потолка; trafficCap = max(спрос x хвосты x доля, лидер x1,5, медиана x1,5, t0 x2,5), без данных - без потолка", () => {
  const cap = 1000;
  const knee = CAL.soft_cap_knee * cap;
  for (const x of [0, 100, knee]) if (softCap(x, cap) !== x) return `softCap(${x}) = ${softCap(x, cap)} (до колена значение не меняется)`;
  if (Math.abs(softCap(knee + 1e-3, cap) - (knee + 1e-3)) > 1e-6) return "излом в колене: наклон не 1";
  let prev = softCap(knee, cap);
  for (let x = knee + 5; x <= 5 * cap; x += 5) {
    const y = softCap(x, cap);
    if (!(y > prev)) return `не монотонно: softCap(${x}) = ${y} <= ${prev}`;
    if (!(y < cap) || y > x) return `softCap(${x}) = ${y} (ожидалось < ${cap} и <= x)`;
    prev = y;
  }
  if (softCap(5000, Infinity) !== 5000 || softCap(5000, 0) !== 5000) return "без потолка (Infinity / 0) значение меняется";
  const cases = [
    ["спрос x 2,5 x 0,8 (medium)", V2_FI, 20000 * CAL.demand_tail_mult * CAL.demand_share_cap.medium],
    ["спрос x 2,5 x 0,6 (high)", v2Fi({ competition: "high" }), 20000 * CAL.demand_tail_mult * CAL.demand_share_cap.high],
    ["лидер прямых x1,5 (точный спрос мал)", { ...V2_NEW_FI, demand: { commercial_month: 100 } }, 207 * CAL.cap_competitors.leader_share],
    ["медиана x1,5", { t0: 0, demand: { commercial_month: 10 }, competitors_traffic: { median: 400, leader: 300 } }, 400 * CAL.cap_competitors.median_mult],
    ["t0 x2,5 (спрос ниже трафика)", CAP_FI, 1000 * CAL.cap_t0_mult],
    ["нет ни спроса, ни конкурентов", { t0: 500, demand: { commercial_month: 0 } }, Infinity],
  ];
  for (const [name, fi, want] of cases) {
    const got = trafficCap(fi);
    if (!(got === want || Math.abs(got - want) < 1e-9)) return `${name}: trafficCap ${got} (ожидалось ${want})`;
  }
  return true;
});

await step("модель v2.1: мягкий потолок - новый сайт с малым точным спросом (178) растет до 12-го мес (не плоско с m3-m4), потолок - большее из спроса с хвостами и лидера прямых конкурентов, новые страницы не обнулены срезом", () => {
  const r = computeTariff(V2_NEW_FI, v2NewTariffs().growth);
  const cap = trafficCap(V2_NEW_FI);
  const wantCap = Math.round(Math.max(178 * CAL.demand_tail_mult * CAL.demand_share_cap.medium, 207 * CAL.cap_competitors.leader_share));
  if (r.cap !== wantCap) return `cap ${r.cap} (ожидалось ${wantCap}: спрос 178 x 2,5 x 0,8 или лидер 207 x 1,5)`;
  if (!r.capped_from_month) return "кривая не дошла до колена потолка - фикстура не проверяет срез";
  const tr = r.months.map((x) => x.traffic);
  for (let m = r.launch_month + 1; m < 12; m++) {
    if (!(tr[m] > tr[m - 1] + 0.1)) return `мес ${m + 1}: ${tr[m].toFixed(1)} не выше мес ${m}: ${tr[m - 1].toFixed(1)} - плато (жесткий потолок)`;
  }
  const c = r.checkpoints;
  // v2.3: уровень новых страниц выше (ПФ поднимает уровень) - к 6-му мес кривая уже у колена потолка, дальше растет медленнее
  if (!(c.m12 > c.m6 * 1.05)) return `m12 ${c.m12.toFixed(1)} / m6 ${c.m6.toFixed(1)} < 1,05 - кривая плоская после разгона`;
  if (!(c.m12 < cap)) return `m12 ${c.m12.toFixed(1)} не ниже потолка ${cap}`;
  const demandLevel = V2_NEW_FI.demand.commercial_month * CAL.demand_share_cap.medium;
  if (!(c.m12 > demandLevel * 1.5)) return `m12 ${c.m12.toFixed(1)} у уровня точного спроса ${demandLevel} - потолок взят по спросу, а не по конкурентам`;
  if (!(r.drivers_m12.new_pages > 0)) return `drivers_m12.new_pages ${r.drivers_m12.new_pages} - срез потолка обнулил новые страницы`;
  return true;
});

await step("модель v2.1: срез потолка делится между существующими и новыми страницами пропорционально (доля новых та же, что без потолка)", () => {
  const fi = { business_type: "services", competition: "medium", t0: 400, pages: { existing_commercial: 12, planned_new: 40 }, demand: { commercial_month: 500 }, local: false, economics: { avg_check: 40000 } };
  const ids = new Set(["PA", "SY", "KP", "PF", "RP"]);
  const capped = trafficSeries(fi, ids);
  const free = trafficSeries({ ...fi, demand: { commercial_month: 1e6 } }, ids);
  for (const m of [6, 12]) {
    const a = capped[m], b = free[m];
    if (!a.capped || b.capped) return `мес ${m}: capped ${a.capped} / без потолка ${b.capped} - фикстура`;
    if (!(a.commercial < b.commercial - 1)) return `мес ${m}: срез не сработал (${a.commercial} vs ${b.commercial})`;
    const ra = a.new_part / a.exist_part, rb = b.new_part / b.exist_part;
    if (Math.abs(ra - rb) > 1e-9 * Math.max(1, rb)) return `мес ${m}: новые / существующие ${ra.toFixed(4)} при потолке vs ${rb.toFixed(4)} без него`;
  }
  return true;
});

await step("модель v2.1: новый сайт - launchMonth (разработка у нас 2, у клиента 3, явный site_launch_month, сайт есть - 1); ежемесячные затраты с месяца запуска, акция ПФ 1=2 в месяц запуска + 1; трафик до запуска 0", () => {
  if (launchMonth(V2_NEW_FI) !== CAL.launch_month.client) return `разработка у клиента: ${launchMonth(V2_NEW_FI)} (ожидалось ${CAL.launch_month.client})`;
  if (launchMonth({ ...V2_NEW_FI, we_develop: true }) !== CAL.launch_month.we_develop) return `разработка у нас: ${launchMonth({ ...V2_NEW_FI, we_develop: true })}`;
  if (launchMonth({ ...V2_NEW_FI, site_launch_month: 5 }) !== 5) return "явный site_launch_month не взят";
  if (launchMonth(V2_FI) !== 1) return `сайт с трафиком: ${launchMonth(V2_FI)} (ожидалось 1)`;
  if (launchMonth(v2Fi({ t0: 10, pages: { existing_commercial: 5, planned_new: 10, catalog_cards: 0 } })) !== 1) return "5 страниц услуг - сайт есть, запуск не с 1-го мес";
  const g = v2NewTariffs().growth; // разовые 80 000, ежемесячные 50 000, ПФ 25 000, акция ПФ 1=2
  const cs = costSeries(g, HORIZON, 3);
  const want = [0, 80000, 0, 50000, 25000, 50000];
  if (want.some((v, i) => cs[i] !== v)) return `costSeries(.., 3): мес 0-5 = ${cs.slice(0, 6).join(", ")} (ожидалось ${want.join(", ")})`;
  const r = computeTariff(V2_NEW_FI, g);
  if (r.launch_month !== 3) return `launch_month ${r.launch_month}`;
  const costs = r.months.slice(0, 5).map((x) => x.cost);
  if (costs.join() !== "80000,0,50000,25000,50000") return `затраты модели мес 1-5: ${costs.join(", ")}`;
  if (r.year1.cost !== 80000 + 50000 * 10 - 25000) return `затраты 12 мес ${r.year1.cost} (ожидалось ${80000 + 50000 * 10 - 25000}: ежемесячные 10 мес)`;
  for (let m = 1; m <= 3; m++) if (r.months[m - 1].traffic !== 0 || r.months[m - 1].leads !== 0) return `мес ${m}: трафик ${r.months[m - 1].traffic}, обращений ${r.months[m - 1].leads} до запуска`;
  if (!(r.months[3].traffic > 0)) return "мес 4: сайт запущен, а трафика нет";
  const w = computeTariff({ ...V2_NEW_FI, we_develop: true }, g);
  if (w.months[1].cost !== 50000 || w.months[2].cost !== 25000) return `разработка у нас: мес 2-3 = ${w.months[1].cost}, ${w.months[2].cost} (ожидалось 50000, 25000)`;
  return true;
});

await step("модель v2.1: цикл сделки - high_ticket: продажи 1-3 мес = 0, продажи мес m = обращения мес m-3 x закрытие; умолчания high_ticket 1% / 4%; b2b - 2 мес, услуги - 0", () => {
  const d = ECON_DEFAULTS.high_ticket;
  if (d.conversion_rate !== 0.01 || d.close_rate !== 0.04) return `умолчания high_ticket ${d.conversion_rate} / ${d.close_rate} (ожидалось 0,01 / 0,04)`;
  const fi = v2Fi({ business_type: "high_ticket", local: false, economics: { avg_check: 12000000, model: "two_step" } });
  const e = resolveEconomics(fi);
  if (e.sales_lag_months !== 3 || e.conversion_rate !== 0.01 || e.close_rate !== 0.04) return `high_ticket: лаг ${e.sales_lag_months}, ${e.conversion_rate} / ${e.close_rate}`;
  if (resolveEconomics({ business_type: "b2b" }).sales_lag_months !== 2) return "b2b: лаг не 2";
  if (resolveEconomics({ business_type: "services" }).sales_lag_months !== 0) return "услуги: лаг не 0";
  const r = computeTariff(fi, v2Tariffs().growth);
  for (let m = 1; m <= 3; m++) if (r.months[m - 1].sales !== 0 || r.months[m - 1].revenue !== 0) return `мес ${m}: продаж ${r.months[m - 1].sales} (цикл сделки 3 мес)`;
  if (!(r.months[0].leads > 0)) return "фикстура: нет обращений в 1-й мес";
  for (let m = 4; m <= HORIZON; m++) {
    const want = r.months[m - 4].leads * e.close_rate;
    if (Math.abs(r.months[m - 1].sales - want) > 1e-9) return `мес ${m}: продаж ${r.months[m - 1].sales}, ожидалось обращения мес ${m - 3} x закрытие = ${want}`;
  }
  if (r.payback_month !== null && r.payback_month <= 3) return `окупаемость ${r.payback_month} мес - раньше первой продажи`;
  return true;
});

await step("модель v2.1: повторные покупки - выручка = продажи x чек x ltv_factor (medical 1,8, ecommerce 1,3, услуги 1; ltv_factor агента с источником; меньше 1 -> 1)", () => {
  const g = v2Tariffs().growth;
  const cases = [
    ["medical", v2Fi({ business_type: "medical", economics: { avg_check: 6500 } }), 1.8, "default"],
    ["ecommerce", v2Fi({ business_type: "ecommerce", local: false, economics: { avg_check: 5000 } }), 1.3, "default"],
    ["services", V2_FI, 1, "default"],
    ["агент", v2Fi({ business_type: "medical", economics: { avg_check: 6500, ltv_factor: 2.5, ltv_source: "курс 5 процедур" } }), 2.5, "курс 5 процедур"],
    ["меньше 1", v2Fi({ economics: { ...V2_FI.economics, ltv_factor: 0.5 } }), 1, "estimated"],
  ];
  for (const [name, fi, ltv, src] of cases) {
    const r = computeTariff(fi, g);
    if (r.economics.ltv_factor !== ltv) return `${name}: ltv_factor ${r.economics.ltv_factor} (ожидалось ${ltv})`;
    if (r.economics.ltv_source !== src) return `${name}: ltv_source ${r.economics.ltv_source} (ожидалось ${src})`;
    const x = r.months[11];
    const want = x.sales * r.economics.avg_check * ltv;
    if (Math.abs(x.revenue - want) > 1e-6 * Math.max(1, want)) return `${name}: выручка мес 12 ${x.revenue}, ожидалось продажи x чек x ${ltv} = ${want}`;
  }
  const one = computeTariff(v2Fi({ business_type: "medical", economics: { avg_check: 6500, ltv_factor: 1 } }), g);
  const rep = computeTariff(v2Fi({ business_type: "medical", economics: { avg_check: 6500 } }), g);
  if (!(rep.year1.profit > one.year1.profit * 1.7)) return `прибыль с повторными ${rep.year1.profit} не в ~1,8 раза выше разовой ${one.year1.profit}`;
  return true;
});

await step("модель v2.1: recommendOffer - гейт пройден: Рост (план по Росту); не пройден: тариф с лучшим чистым результатом в плюсе (план по нему); все в минусе - null, план по Росту", () => {
  const ok = recommendOffer(computeAll(V2_FI, v2Tariffs()));
  if (ok.recommended_offer !== "growth" || ok.plan_tariff !== "growth") return `чистая фикстура: ${JSON.stringify(ok)}`;
  const res = computeAll(V2_NEW_FI, v2NewTariffs());
  const chk = economicsChecks(res);
  if (!chk.hard.length) return "новый сайт: гейт пройден - фикстура должна его валить";
  const best = ["start", "growth", "max"].sort((a, b) => res[b].year1.net - res[a].year1.net)[0];
  const o = recommendOffer(res, chk);
  if (best !== "start" || o.recommended_offer !== "start" || o.plan_tariff !== "start") return `новый сайт: лучший ${best}, ${JSON.stringify(o)} (ожидалось start/start)`;
  const poor = computeAll({ ...V2_NEW_FI, economics: { ...V2_NEW_FI.economics, avg_check: 3000 } }, v2NewTariffs());
  const p = recommendOffer(poor);
  if (p.recommended_offer !== null || p.plan_tariff !== "growth") return `все в минусе: ${JSON.stringify(p)} (ожидалось null / growth)`;
  return true;
});

await step("модель v2.1: lostNowCalc - ориентир max(медиана, половина лидера), не выше плана к 12 мес; базовая конверсия без прототипа и Карт; выручка x ltv; нет конкурентов или ориентир <= t0 - basis plan", () => {
  const plan = computeTariff(V2_FI, v2Tariffs().growth);
  const e = plan.economics;
  const plan12 = plan.months[11].traffic_commercial;
  const ref = Math.max(V2_FI.competitors_traffic.median, V2_FI.competitors_traffic.leader * CAL.lost_ref_leader_share);
  const a = lostNowCalc(V2_FI, plan);
  if (a.basis !== "competitors") return `basis ${a.basis}`;
  if (Math.abs(a.target_traffic - Math.min(ref, plan12)) > 1e-9) return `ориентир ${a.target_traffic}, ожидалось min(${ref}, план ${plan12.toFixed(1)})`;
  if (Math.abs(a.traffic_month - (a.target_traffic - V2_FI.t0)) > 1e-9) return "переходы != ориентир - t0";
  if (Math.abs(a.leads_month - a.traffic_month * e.conversion_rate) > 1e-9) return `обращения ${a.leads_month} != переходы x базовая конверсия ${a.traffic_month * e.conversion_rate}`;
  if (Math.abs(a.leads_month - plan.months[11].leads) < 1) return "обращения = прирост плана к 12 мес (старая семантика с прототипом и Картами)";
  if (Math.abs(a.revenue_month - a.leads_month * e.close_rate * e.avg_check * e.ltv_factor) > 1e-6) return "выручка != обращения x закрытие x чек x ltv";
  // ориентир ниже плана - берется ориентир
  const low = v2Fi({ competitors_traffic: { median: 900, leader: 1000 } });
  const b = lostNowCalc(low, computeTariff(low, v2Tariffs().growth));
  if (b.basis !== "competitors" || Math.abs(b.target_traffic - 900) > 1e-9) return `медиана 900: ${b.basis} / ${b.target_traffic} (ожидалось competitors / 900)`;
  // нет конкурентов - разрыв с уровнем плана
  const noComp = v2Fi({ competitors_traffic: undefined });
  const pc = computeTariff(noComp, v2Tariffs().growth);
  const c = lostNowCalc(noComp, pc);
  if (c.basis !== "plan" || Math.abs(c.target_traffic - pc.months[11].traffic_commercial) > 1e-9) return `нет конкурентов: ${c.basis} / ${c.target_traffic}`;
  // ориентир не выше текущего трафика - тоже по плану
  const big = v2Fi({ t0: 5000 });
  const d = lostNowCalc(big, computeTariff(big, v2Tariffs().growth));
  if (d.basis !== "plan") return `t0 5000 выше ориентира ${ref}: basis ${d.basis} (ожидалось plan)`;
  // повторные покупки
  const med = v2Fi({ economics: { ...V2_FI.economics, ltv_factor: 1.8 } });
  const m = lostNowCalc(med, computeTariff(med, v2Tariffs().growth));
  if (Math.abs(m.revenue_month - m.sales_month * V2_FI.economics.avg_check * 1.8) > 1e-6) return "выручка потерь без повторных покупок (ltv 1,8)";
  return true;
});

await step("модель v2.1: мягкие проверки - упор в потолок к 3-4 мес и почти одинаковый трафик трех тарифов в soft (не hard); чистая фикстура - без них", () => {
  const chk = economicsChecks(computeAll(CAP_FI, capTariffs()));
  if (!chk.soft.some((s) => /уперся в потолок .* к [1-4]-му мес/.test(s))) return `нет предупреждения про потолок: ${chk.soft.join("; ")}`;
  if (!chk.soft.some((s) => /почти одинаковый/.test(s))) return `нет предупреждения про одинаковые тарифы: ${chk.soft.join("; ")}`;
  if (chk.hard.some((h) => /потолок|одинаков/.test(h))) return `форма прогноза попала в жесткий гейт: ${chk.hard.join("; ")}`;
  const clean = economicsChecks(computeAll(V2_FI, v2Tariffs()));
  if (clean.soft.some((s) => /потолок|одинаков/.test(s))) return `чистая фикстура: ${clean.soft.join("; ")}`;
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
// новый сайт: экономический гейт не пройден по замыслу фикстуры (exit 3), forecast.json записан
const V2_NEW = writeV2Dir("v2-new", { fi: V2_NEW_FI, tariffs: v2NewTariffs(), inputs: V2_NEW_INPUTS, content: v2NewContent() });

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
  if (fc.recommended !== fc.plan_tariff) return `recommended ${fc.recommended} != plan_tariff ${fc.plan_tariff} (с 06.10 recommended = тариф плана)`;
  if (fc.recommended_offer === "growth") return "recommended_offer = growth при проваленном гейте (смета рекомендовала бы убыточный Рост)";
  const best = ["start", "growth", "max"].sort((a, b) => fc.tariffs[b].year1.net - fc.tariffs[a].year1.net)[0];
  const expect = fc.tariffs[best].year1.net > 0 ? best : null;
  if (fc.recommended_offer !== expect) return `recommended_offer ${fc.recommended_offer}, ожидалось ${expect}`;
  if (fc.plan_tariff !== (expect || "growth")) return `plan_tariff ${fc.plan_tariff}, ожидалось ${expect || "growth"} (= recommended_offer || growth)`;
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

await step("build-forecast: lost_now v2.1 - разрыв с ориентиром конкурентов (не выше плана к 12 мес) по базовой конверсии, а не прирост плана с прототипом и Картами; нет конкурентов - basis plan", () => {
  const fc = readJsonFile(join(V2_BASE.dir, "forecast.json"));
  const ln = fc.lost_now;
  const plan = computeTariff(V2_FI, v2Tariffs()[fc.plan_tariff]);
  const e = fc.inputs.economics;
  const ref = Math.max(V2_FI.competitors_traffic.median, V2_FI.competitors_traffic.leader * CAL.lost_ref_leader_share);
  const target = Math.min(ref, plan.months[11].traffic_commercial);
  const gap = target - V2_FI.t0;
  const r1 = (x) => Math.round(x * 10) / 10;
  const want = {
    basis: "competitors", target_traffic: Math.round(target), traffic_month: Math.round(gap),
    leads_month: r1(gap * e.conversion_rate), sales_month: r1(gap * e.conversion_rate * e.close_rate),
    revenue_month: Math.round(gap * e.conversion_rate * e.close_rate * e.avg_check * e.ltv_factor),
    revenue_year: Math.round(gap * e.conversion_rate * e.close_rate * e.avg_check * e.ltv_factor * 12),
    competitors_traffic_median: 1800, competitors_traffic_leader: 6000,
  };
  for (const [k, v] of Object.entries(want)) if (ln[k] !== v) return `lost_now.${k} ${ln[k]} (ожидалось ${v})`;
  if (!/конкурентов/.test(ln.basis_note || "")) return `basis_note: ${ln.basis_note}`;
  const m12 = fc.tariffs[fc.plan_tariff].months[11];
  if (Math.abs(ln.leads_month - m12.leads) < 1) return `lost_now.leads_month ${ln.leads_month} = прирост плана к 12 мес ${m12.leads} (старая семантика)`;
  if ("leads_maps_month" in ln) return "в lost_now осталось leads_maps_month - потери без Карт";
  // нет данных о конкурентах - разрыв с уровнем плана к 12 мес
  const r = writeV2Dir("bf-lost-plan", { fi: v2Fi({ competitors_traffic: undefined }), content: null });
  if (r.code !== 0) return `без конкурентов: exit ${r.code}: ${r.stdout}`;
  const f2 = readJsonFile(join(r.dir, "forecast.json"));
  if (f2.lost_now.basis !== "plan") return `без конкурентов: basis ${f2.lost_now.basis}`;
  if (f2.lost_now.target_traffic !== f2.tariffs[f2.plan_tariff].months[11].traffic_commercial) return `без конкурентов: ориентир ${f2.lost_now.target_traffic} != план к 12 мес ${f2.tariffs[f2.plan_tariff].months[11].traffic_commercial}`;
  return true;
});

await step("build-forecast: поля v2.1 - plan_tariff = recommended_offer || growth, launch_month, traffic_cap; у тарифов launch_month / cap / capped_from_month; экономика с ltv_factor и sales_lag_months", () => {
  const fc = readJsonFile(join(V2_BASE.dir, "forecast.json"));
  if (fc.plan_tariff !== "growth" || fc.recommended_offer !== "growth") return `plan_tariff ${fc.plan_tariff}, recommended_offer ${fc.recommended_offer}`;
  if (fc.launch_month !== 1) return `launch_month ${fc.launch_month} (сайт есть - 1)`;
  if (fc.traffic_cap !== Math.round(trafficCap(V2_FI))) return `traffic_cap ${fc.traffic_cap} != ${Math.round(trafficCap(V2_FI))}`;
  for (const k of ["start", "growth", "max"]) {
    const t = fc.tariffs[k];
    if (t.launch_month !== 1 || t.cap !== fc.traffic_cap || !("capped_from_month" in t)) return `${k}: launch ${t.launch_month}, cap ${t.cap}, capped_from_month ${"capped_from_month" in t ? t.capped_from_month : "нет поля"}`;
  }
  const e = fc.inputs.economics;
  if (e.ltv_factor !== 1 || e.ltv_source !== "default" || e.sales_lag_months !== 0) return `экономика: ltv ${e.ltv_factor} (${e.ltv_source}), лаг ${e.sales_lag_months}`;
  if (fc.baseline.revenue_month !== Math.round(V2_FI.t0 * e.conversion_rate * e.close_rate * e.avg_check * e.ltv_factor)) return `baseline.revenue_month ${fc.baseline.revenue_month}`;
  // новый сайт: гейт не пройден - смета и план по Старту
  if (V2_NEW.code !== 3) return `новый сайт: exit ${V2_NEW.code} (по замыслу фикстуры гейт не пройден - 3): ${V2_NEW.stdout}`;
  const nf = readJsonFile(join(V2_NEW.dir, "forecast.json"));
  if (nf.recommended_offer !== "start" || nf.plan_tariff !== "start") return `новый сайт: recommended_offer ${nf.recommended_offer}, plan_tariff ${nf.plan_tariff}`;
  const ps = nf.plan_series.slice(1).map((p) => p.traffic).join();
  if (ps !== nf.tariffs.start.months.slice(0, 12).map((x) => x.traffic).join()) return "plan_series не по тарифу плана (Старт)";
  if (nf.traffic_cap !== nf.tariffs.start.cap) return `traffic_cap ${nf.traffic_cap} != cap тарифа плана ${nf.tariffs.start.cap}`;
  // все тарифы в минусе - рекомендации нет, план по Росту
  const r = writeV2Dir("bf-offer-null", { fi: { ...V2_NEW_FI, economics: { ...V2_NEW_FI.economics, avg_check: 3000 } }, tariffs: v2NewTariffs(), inputs: V2_NEW_INPUTS, content: null });
  if (r.code !== 3) return `чек 3 000: exit ${r.code}: ${r.stdout}`;
  const pf = readJsonFile(join(r.dir, "forecast.json"));
  if (pf.recommended_offer !== null || pf.plan_tariff !== "growth") return `чек 3 000: recommended_offer ${pf.recommended_offer}, plan_tariff ${pf.plan_tariff} (ожидалось null / growth)`;
  return true;
});

await step("build-forecast: новый сайт (трафика и страниц нет) - launch_month 3 (2 при разработке у нас), ежемесячные затраты с запуска, акция ПФ в 4-м мес, трафик плана до запуска 0, методика про запуск", () => {
  const fc = readJsonFile(join(V2_NEW.dir, "forecast.json"));
  if (fc.launch_month !== 3) return `launch_month ${fc.launch_month} (разработчик клиента - 3)`;
  for (const k of ["start", "growth", "max"]) if (fc.tariffs[k].launch_month !== 3) return `${k}: launch_month ${fc.tariffs[k].launch_month}`;
  const costs = fc.tariffs.growth.months.slice(0, 5).map((x) => x.cost).join();
  if (costs !== "80000,0,50000,25000,50000") return `затраты Роста мес 1-5: ${costs} (разовые в 1-м, ежемесячные с 3-го, ПФ бесплатно в 4-м)`;
  if (fc.tariffs.growth.year1.cost !== 80000 + 50000 * 10 - 25000) return `затраты Роста за 12 мес ${fc.tariffs.growth.year1.cost}`;
  if (fc.plan_series.slice(1, 4).some((p) => p.traffic !== 0)) return `трафик плана мес 1-3: ${fc.plan_series.slice(1, 4).map((p) => p.traffic).join(", ")} (до запуска 0)`;
  if (!/Новый сайт выходит в поиск к 3-му мес/.test(fc.assumptions_note)) return `методика без запуска: ${fc.assumptions_note}`;
  if (fc.lost_now.basis !== "competitors" || fc.lost_now.target_traffic !== 129) return `потери: ${fc.lost_now.basis}, ориентир ${fc.lost_now.target_traffic} (ожидалось медиана 129)`;
  const r = writeV2Dir("bf-new-wedev", { fi: V2_NEW_FI, tariffs: v2NewTariffs(), inputs: { ...V2_NEW_INPUTS, we_develop: true }, content: null });
  if (r.code !== 0 && r.code !== 3) return `разработка у нас: exit ${r.code}: ${r.stdout}`;
  const w = readJsonFile(join(r.dir, "forecast.json"));
  if (w.launch_month !== 2) return `разработка у нас: launch_month ${w.launch_month} (ожидалось 2)`;
  const wc = w.tariffs.growth.months.slice(0, 3).map((x) => x.cost).join();
  if (wc !== "80000,50000,25000") return `разработка у нас: затраты мес 1-3 ${wc}`;
  return true;
});

await step("build-forecast: цикл сделки (high_ticket: продажи 1-3 мес = 0, окупаемость не раньше первой продажи) и повторные покупки (medical x1,8) - в экономике и методике", () => {
  const t = v2Tariffs();
  for (const k of ["growth", "max"]) {
    t[k].monthly = t[k].monthly.filter((s) => s.id !== "YM");
    t[k].total_monthly -= 25000;
  }
  const fiHT = v2Fi({ business_type: "high_ticket", local: false, economics: { avg_check: 12000000, avg_check_source: "estimated", model: "two_step", basis: "фикстура" } });
  const r = writeV2Dir("bf-ht", { fi: fiHT, tariffs: t, content: null });
  if (r.code !== 0 && r.code !== 3) return `high_ticket: exit ${r.code}: ${r.stdout}`;
  const fc = readJsonFile(join(r.dir, "forecast.json"));
  const e = fc.inputs.economics;
  if (e.sales_lag_months !== 3 || e.conversion_rate !== 0.01 || e.close_rate !== 0.04) return `high_ticket: лаг ${e.sales_lag_months}, ${e.conversion_rate} / ${e.close_rate}`;
  for (const k of ["start", "growth", "max"]) {
    const m = fc.tariffs[k].months;
    if (m.slice(0, 3).some((x) => x.sales !== 0)) return `${k}: продажи мес 1-3 ${m.slice(0, 3).map((x) => x.sales).join(", ")}`;
    const pb = fc.tariffs[k].payback_month;
    if (pb !== null && pb <= 3) return `${k}: окупаемость ${pb} мес - до первой продажи`;
  }
  if (!/цикл сделки/.test(fc.assumptions_note)) return `методика без цикла сделки: ${fc.assumptions_note}`;
  const fiMed = v2Fi({ business_type: "medical", economics: { avg_check: 6500, avg_check_source: "site", model: "two_step", basis: "фикстура" } });
  const r2 = writeV2Dir("bf-med", { fi: fiMed, content: null });
  if (r2.code !== 0 && r2.code !== 3) return `medical: exit ${r2.code}: ${r2.stdout}`;
  const f2 = readJsonFile(join(r2.dir, "forecast.json"));
  if (f2.inputs.economics.ltv_factor !== 1.8 || f2.inputs.economics.ltv_source !== "default") return `medical: ltv ${f2.inputs.economics.ltv_factor} (${f2.inputs.economics.ltv_source})`;
  if (!/Повторные покупки одного клиента за год: x1,8/.test(f2.assumptions_note)) return `методика без повторных покупок: ${f2.assumptions_note}`;
  const res = computeTariff(applyClientEconomics(fiMed, V2_INPUTS).fi, v2Tariffs().growth);
  if (f2.tariffs.growth.year1.romi !== res.year1.romi) return `medical: ROMI Роста ${f2.tariffs.growth.year1.romi} != модель ${res.year1.romi}`;
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
// 3.3а. v2.2: карточка ниши _niche.mjs (nicheCard) и forecast.json -> niche
// ──────────────────────────────────────────────────────────────────────────

console.log("\n=== 3.3а. v2.2: карточка ниши _niche.mjs (объем и конкурентность) ===");

// Пять прямых конкурентов в разном порядке, у одного трафик под псевдонимом traffic (pages - все страницы сайта, не
// коммерческие: с 06.10 не подменяют commercial_pages), у одного
// нет данных, пустой домен отбрасывается. Топ-3 по трафику: leader.ru 6 000, second.ru 2 500, mid.ru 1 800.
function nicheComp() {
  return {
    keyso_base: "spb",
    direct: [
      { domain: "small.ru", traffic_month: 300, top10: 80, commercial_pages: 20, dr: 15 },
      { domain: "leader.ru", traffic_month: 6000, top10: 900, commercial_pages: 160, dr: 30 },
      { domain: "nodata.ru" },
      { domain: "mid.ru", traffic_month: 1800, top10: 400, commercial_pages: 60, dr: 22 },
      { domain: "second.ru", traffic: 2500, top10: 500, commercial_pages: 90, pages: 400, dr: 26 },
      { domain: "" },
    ],
    leader_pages_summary: {
      client_missing: ["цены", { element: "отзывы с фото" }, { name: "калькулятор" }, { text: "гарантия" }, "портфолио"],
      blog_usage: "у двух из трех лидеров блог со статьями",
    },
  };
}
const NICHE_FI = {
  t0: 400, pages: { existing_commercial: 30 }, demand: { commercial_month: 20000, basis: "точные частоты (фикстура)" },
  local: true, maps_card: "unverified", competition: "high", competitors_traffic: { basis: "Keyso spb (фикстура)" },
};
const NICHE_PLAN = new Set(["PA", "SY", "KP", "PF", "YM"]);
const NICHE_MAX = new Set(["PA", "SY", "KP", "FQ", "PFP", "YM", "AR", "LA"]);
function nicheRun(patch = {}) {
  return nicheCard({
    fi: clone(NICHE_FI), competitors: nicheComp(), metrics: { top10: 40, dr: 14 },
    planIds: NICHE_PLAN, maxIds: NICHE_MAX, planM12: 1000, cap: 9000, ...patch,
  });
}
const factorOf = (card, key) => card.competition.factors.find((f) => f.key === key);

await step("nicheCard: топ-3 прямых по трафику (traffic_month и traffic), медиана топ-3, лидер, доли к 12 мес от медианы и лидера, потолок, спрос", () => {
  const v = nicheRun().volume;
  const doms = v.top3.map((c) => c.domain).join(",");
  if (doms !== "leader.ru,second.ru,mid.ru") return `топ-3: ${doms} (ожидалось leader.ru,second.ru,mid.ru)`;
  if (v.top3[1].traffic !== 2500 || v.top3[1].commercial_pages !== 90) return `псевдонимы traffic/pages не прочитаны: ${JSON.stringify(v.top3[1])}`;
  if (v.median_top3_traffic !== 2500) return `медиана топ-3 ${v.median_top3_traffic} (ожидалось 2500)`;
  if (!v.leader || v.leader.domain !== "leader.ru" || v.leader.traffic !== 6000) return `лидер ${JSON.stringify(v.leader)}`;
  if (v.client_now !== 400 || v.reachable_12 !== 1000 || v.ceiling !== 9000) return `client_now ${v.client_now}, reachable_12 ${v.reachable_12}, ceiling ${v.ceiling}`;
  if (v.share_of_median_12 !== 40) return `share_of_median_12 ${v.share_of_median_12} (1000 / 2500 = 40%)`;
  if (v.share_of_leader_12 !== 17) return `share_of_leader_12 ${v.share_of_leader_12} (1000 / 6000 = 17%)`;
  if (v.demand_exact !== 20000 || !v.demand_basis) return `спрос ${v.demand_exact}, basis ${v.demand_basis}`;
  if (v.traffic_basis !== "Keyso spb (фикстура)") return `traffic_basis ${v.traffic_basis}`;
  // без трафика у всех - топ-3 по запросам в ТОП-10, медиана и лидер - из forecast_inputs.competitors_traffic
  const noTraffic = nicheCard({
    fi: { competitors_traffic: { median: 700, leader: 2000 } },
    competitors: { direct: [{ domain: "a.ru", top10: 10 }, { domain: "b.ru", top10: 90 }, { domain: "c.ru", top10: 50 }, { domain: "d.ru", top10: 5 }] },
    planM12: 350,
  }).volume;
  if (noTraffic.top3.map((c) => c.domain).join(",") !== "b.ru,c.ru,a.ru") return `без трафика топ-3 не по ТОП-10: ${noTraffic.top3.map((c) => c.domain)}`;
  if (noTraffic.median_top3_traffic !== 700 || !noTraffic.leader || noTraffic.leader.traffic !== 2000 || noTraffic.leader.domain !== null) {
    return `запасной путь competitors_traffic: медиана ${noTraffic.median_top3_traffic}, лидер ${JSON.stringify(noTraffic.leader)}`;
  }
  if (noTraffic.share_of_median_12 !== 50) return `share_of_median_12 по запасной медиане ${noTraffic.share_of_median_12} (350 / 700 = 50%)`;
  return true;
});

await step("nicheCard: уровни разрыва с медианой топ-3 - big < 50%, some < 80%, none от 80%, unknown без данных клиента; работы под разрыв", () => {
  const comp = () => ({ direct: ["a.ru", "b.ru", "c.ru"].map((d) => ({ domain: d, traffic_month: 1000, commercial_pages: 100, top10: 200 })) });
  const gapAt = (pages) => factorOf(nicheCard({ fi: { pages: { existing_commercial: pages } }, competitors: comp() }), "pages");
  const cases = [[49, "big"], [50, "some"], [79, "some"], [80, "none"], [150, "none"]];
  for (const [pages, want] of cases) {
    const f = gapAt(pages);
    if (!f || f.gap !== want) return `страниц ${pages} против 100: gap ${f && f.gap} (ожидалось ${want})`;
  }
  const unknown = gapAt(null);
  if (!unknown || unknown.gap !== "unknown" || unknown.top3_median !== 100 || unknown.client !== null) return `без страниц клиента: ${JSON.stringify(unknown)}`;
  const card = nicheRun();
  const pages = factorOf(card, "pages");
  if (pages.top3_median !== 90 || pages.client !== 30 || pages.gap !== "big") return `pages: ${JSON.stringify(pages)} (медиана 160/90/60 = 90, у клиента 30 -> big)`;
  if (pages.services.join(",") !== "SY,KP") return `pages: работы ${pages.services} (ожидалось SY,KP)`;
  // тексты - KP, а без KP в плане при FQ - FQ
  const fqPages = factorOf(nicheRun({ planIds: new Set(["SY", "FQ", "PF"]) }), "pages");
  if (fqPages.services.join(",") !== "SY,FQ") return `pages без KP в плане: ${fqPages.services} (ожидалось SY,FQ)`;
  const vis = factorOf(card, "visibility");
  if (vis.top3_median !== 500 || vis.client !== 40 || vis.gap !== "big" || vis.services.join(",") !== "PF,YM") return `visibility: ${JSON.stringify(vis)}`;
  const visPfp = factorOf(nicheRun({ planIds: new Set(["SY", "KP", "PFP"]) }), "visibility");
  if (visPfp.services[0] !== "PFP") return `visibility при PFP в плане: ${visPfp.services}`;
  const traffic = factorOf(card, "traffic");
  if (traffic.top3_median !== 2500 || traffic.client !== 400 || traffic.gap !== "big" || traffic.services.length) return `traffic (справочно, без работ): ${JSON.stringify(traffic)}`;
  if (card.competition.level !== "high") return `level ${card.competition.level} (из forecast_inputs.competition)`;
  if (!/ссылочный вес лидеров около 26/.test(card.competition.basis) || !/90 страниц под спрос/.test(card.competition.basis) || !/500 запросов в ТОП-10/.test(card.competition.basis)) {
    return `basis: ${card.competition.basis}`;
  }
  if (nicheCard({ fi: { competition: "extreme" } }).competition.level !== "medium") return "неизвестный уровень конкуренции не сведен к medium";
  return true;
});

await step("nicheCard: ссылки - разрыв DR от 8 пунктов big, 4-7 some, меньше 4 none без работ; LA при LA в Максимуме или плане, иначе LB; доноры - при данных у обеих сторон", () => {
  const linksAt = (clientDr, sets = {}) => factorOf(nicheRun({ metrics: { top10: 40, dr: clientDr }, ...sets }), "links");
  const noLa = { planIds: new Set(["SY", "KP", "PF"]), maxIds: new Set(["SY", "KP", "PFP", "LB"]) };
  const big = linksAt(18, noLa); // 26 - 18 = 8
  if (big.gap !== "big" || big.services.join(",") !== "LB" || !/3-4 мес/.test(big.note || "")) return `DR 26 против 18: ${JSON.stringify(big)}`;
  const some = linksAt(19, noLa); // 7
  if (some.gap !== "some" || some.services.join(",") !== "LB") return `DR 26 против 19: ${JSON.stringify(some)}`;
  const edge = linksAt(22, noLa); // 4
  if (edge.gap !== "some") return `DR 26 против 22: gap ${edge.gap} (ожидалось some)`;
  const none = linksAt(23, noLa); // 3
  if (none.gap !== "none" || none.services.length || !/сопоставим/.test(none.note || "")) return `DR 26 против 23: ${JSON.stringify(none)}`;
  if (linksAt(14).services.join(",") !== "LA") return `LA в Максимуме - работа LA: ${linksAt(14).services}`;
  const unknown = factorOf(nicheRun({ metrics: { top10: 40 } }), "links");
  if (!unknown || unknown.gap !== "unknown") return `DR клиента нет: ${JSON.stringify(unknown)}`;
  if (factorOf(nicheRun(), "ref_domains")) return "доноры без данных у конкурентов - строки быть не должно";
  const comp = nicheComp();
  comp.direct.forEach((c, i) => { c.ref_domains = [400, 100, 50, 250, 300, 0][i]; });
  const ref = factorOf(nicheRun({ competitors: comp, metrics: { top10: 40, dr: 14, ref_domains: 40 } }), "ref_domains");
  if (!ref || ref.top3_median !== 250 || ref.client !== 40 || ref.gap !== "big" || ref.services.length) return `доноры топ-3 100/300/250 против 40: ${JSON.stringify(ref)}`;
  return true;
});

await step("nicheCard: элементы лидеров по leader_pages_summary.client_missing (5+ big, 2-4 some, 0-1 none; KP при разрыве; примеры до 4 строкой); блог лидеров -> статьи", () => {
  const com = factorOf(nicheRun(), "commercial");
  if (!com || com.client !== 5 || com.gap !== "big" || com.services.join(",") !== "KP") return `5 элементов: ${JSON.stringify(com)}`;
  // примеры не выводятся (06.10): в client_missing - рабочие заметки аналитика (H1, Schema, URL), клиенту их не показываем
  if ((com.examples || []).length) return `примеры должны быть пустыми: ${JSON.stringify(com.examples)}`;
  const withMissing = (list) => {
    const comp = nicheComp();
    comp.leader_pages_summary.client_missing = list;
    return factorOf(nicheRun({ competitors: comp }), "commercial");
  };
  const some = withMissing(["цены", "отзывы"]);
  if (some.gap !== "some" || some.services.join(",") !== "KP") return `2 элемента: ${JSON.stringify(some)}`;
  const one = withMissing(["цены"]);
  if (one.gap !== "none" || one.services.length) return `1 элемент: ${JSON.stringify(one)}`;
  const comp = nicheComp();
  delete comp.leader_pages_summary;
  const card = nicheRun({ competitors: comp });
  if (factorOf(card, "commercial")) return "без leader_pages_summary строки элементов быть не должно";
  if (factorOf(card, "blog")) return "без упоминания блога строки статей быть не должно";
  const blog = factorOf(nicheRun(), "blog");
  if (!blog || blog.gap !== "some" || blog.services.join(",") !== "AR") return `блог лидеров: ${JSON.stringify(blog)}`;
  const comp2 = nicheComp();
  delete comp2.leader_pages_summary;
  comp2.direct[1].growth_model = "растет статьями";
  if (!factorOf(nicheRun({ competitors: comp2 }), "blog")) return "статьи в growth_model конкурента не распознаны";
  return true;
});

await step("nicheCard: Карты только у локального бизнеса - карточки нет / не подтверждена / не проверена -> big, подтверждена -> some, работа YM", () => {
  const mapsAt = (maps_card, local = true) => factorOf(nicheRun({ fi: { ...clone(NICHE_FI), local, maps_card } }), "maps");
  const cases = [["none", "big", /карточки нет/], ["unverified", "big", /проверить/], ["unknown", "big", /проверить/], ["verified", "some", /нужна активность/]];
  for (const [card, gap, note] of cases) {
    const f = mapsAt(card);
    if (!f || f.gap !== gap || f.services.join(",") !== "YM" || !note.test(f.note || "")) return `maps_card ${card}: ${JSON.stringify(f)}`;
  }
  if (factorOf(nicheRun({ fi: { ...clone(NICHE_FI), local: true, maps_card: undefined } }), "maps").gap !== "big") return "maps_card не задан - не big";
  if (mapsAt("verified", false)) return "нелокальный бизнес - строки Карт быть не должно";
  if (factorOf(nicheRun({ fi: { ...clone(NICHE_FI), local: false } }), "visibility").services.includes("YM")) return "нелокальный бизнес - YM в работах видимости";
  return true;
});

await step("nicheCard: to_parity - работы из разрывов big/some (не none), одна работа собирает свои факторы, in_plan / in_max по составам", () => {
  const card = nicheRun();
  const ids = card.to_parity.map((p) => p.id).join(",");
  if (ids !== "SY,KP,PF,YM,LA,AR") return `to_parity: ${ids} (ожидалось SY,KP,PF,YM,LA,AR)`;
  const by = Object.fromEntries(card.to_parity.map((p) => [p.id, p]));
  if (by.KP.factors.join(",") !== "pages,commercial") return `KP закрывает ${by.KP.factors} (ожидалось pages,commercial)`;
  if (by.YM.factors.join(",") !== "visibility,maps") return `YM закрывает ${by.YM.factors} (ожидалось visibility,maps)`;
  const flags = { SY: [true, true], KP: [true, true], PF: [true, false], YM: [true, true], LA: [false, true], AR: [false, true] };
  for (const [id, [plan, max]] of Object.entries(flags)) {
    if (by[id].in_plan !== plan || by[id].in_max !== max) return `${id}: in_plan ${by[id].in_plan}, in_max ${by[id].in_max} (ожидалось ${plan}/${max})`;
  }
  // разрывы none работ не требуют: DR вровень -> нет ссылок; элементы 1 -> KP только из-за страниц
  const comp = nicheComp();
  comp.leader_pages_summary.client_missing = ["цены"];
  const even = nicheRun({ competitors: comp, metrics: { top10: 40, dr: 25 } });
  if (even.to_parity.some((p) => p.id === "LA" || p.id === "LB")) return `ссылки в to_parity при DR вровень: ${even.to_parity.map((p) => p.id)}`;
  const kp = even.to_parity.find((p) => p.id === "KP");
  if (!kp || kp.factors.join(",") !== "pages") return `KP при одном недостающем элементе: ${JSON.stringify(kp)}`;
  return true;
});

await step("nicheCard: пустые и битые входы - без падения (нет аргументов, пустые объекты, null в списках, нет planM12 / cap)", () => {
  const variants = [
    () => nicheCard(),
    () => nicheCard({}),
    () => nicheCard({ fi: {}, competitors: {}, metrics: {} }),
    () => nicheCard({ fi: { demand: null, pages: null, competitors_traffic: null }, competitors: { direct: "нет", leader_pages_summary: { client_missing: "нет" } } }),
    () => nicheCard({ competitors: { direct: [null, { domain: "a.ru" }, { traffic_month: 5 }], leader_pages_summary: { client_missing: [null, {}, "цены"] } } }),
  ];
  for (const [i, fn] of variants.entries()) {
    let card;
    try { card = fn(); } catch (e) { return `вариант ${i + 1}: упал (${e.message})`; }
    if (!card || !card.volume || !card.competition || !Array.isArray(card.competition.factors) || !Array.isArray(card.to_parity)) {
      return `вариант ${i + 1}: неполная форма ${JSON.stringify(card)}`;
    }
    const v = card.volume;
    if (v.reachable_12 !== null || v.share_of_median_12 !== null || v.share_of_leader_12 !== null || v.ceiling !== null) return `вариант ${i + 1}: доли без planM12 / cap - ${JSON.stringify(v)}`;
    if (card.competition.level !== "medium") return `вариант ${i + 1}: level ${card.competition.level}`;
    // в варианте 5 есть недостающие элементы лидеров - там KP законно; в остальных разрывов нет
    if (i < 4 && card.to_parity.length) return `вариант ${i + 1}: работы без разрывов ${JSON.stringify(card.to_parity)}`;
  }
  const empty = nicheCard();
  if (empty.volume.top3.length || empty.volume.leader !== null || empty.volume.median_top3_traffic !== null || empty.volume.client_now !== 0) return `пустая карточка: ${JSON.stringify(empty.volume)}`;
  if (empty.competition.basis !== null) return `basis без данных: ${empty.competition.basis}`;
  const nulls = nicheCard({ competitors: { direct: [null, { domain: "a.ru" }], leader_pages_summary: { client_missing: [null, {}, "цены"] } } });
  const com = factorOf(nulls, "commercial");
  if (!com || com.client !== 3 || (com.examples || []).length) return `битые элементы client_missing: ${JSON.stringify(com)}`;
  return true;
});

await step("build-forecast: пишет niche в forecast.json - без competitors.json по forecast_inputs (медиана, лидер, достижимое к 12 мес = план), модель не меняется", () => {
  const fc = readJsonFile(join(V2_BASE.dir, "forecast.json"));
  const n = fc.niche;
  if (!n || !n.volume || !n.competition || !Array.isArray(n.to_parity)) return `нет niche: ${JSON.stringify(n)}`;
  const v = n.volume;
  const plan = fc.tariffs[fc.plan_tariff];
  if (v.client_now !== V2_FI.t0) return `client_now ${v.client_now} (t0 ${V2_FI.t0})`;
  if (Math.abs(v.reachable_12 - plan.checkpoints.m12) > 1) return `reachable_12 ${v.reachable_12} != трафик плана к 12 мес ${plan.checkpoints.m12}`;
  if (v.median_top3_traffic !== 1800 || !v.leader || v.leader.traffic !== 6000) return `медиана ${v.median_top3_traffic}, лидер ${JSON.stringify(v.leader)} (из competitors_traffic)`;
  if (Math.abs(v.share_of_median_12 - Math.min(100, Math.round((plan.checkpoints.m12 / 1800) * 100))) > 1) return `share_of_median_12 ${v.share_of_median_12} (не выше 100)`;
  if (v.ceiling !== Math.round(fc.traffic_cap)) return `ceiling ${v.ceiling} != traffic_cap ${fc.traffic_cap}`;
  if (v.demand_exact !== V2_FI.demand.commercial_month) return `demand_exact ${v.demand_exact}`;
  const maps = n.competition.factors.find((f) => f.key === "maps");
  if (!maps || maps.gap !== "some") return `Карты (local, карточка подтверждена): ${JSON.stringify(maps)}`;
  return true;
});

const BF_NICHE = (() => {
  const dir = copyV2Dir(V2_BASE.dir, "bf-niche");
  writeJson(join(dir, "competitors.json"), nicheComp());
  writeJson(join(dir, "metrics.json"), { top10: 40, dr: 14, traffic_month: 380 });
  return { dir, ...runScript("build-forecast.mjs", dir) };
})();

await step("build-forecast: niche читает competitors.json и metrics.json (топ-3, разрывы, работы плана Роста и Максимума), прогноз тот же", () => {
  if (BF_NICHE.code !== 0) return `exit ${BF_NICHE.code}: ${BF_NICHE.stdout}`;
  const fc = readJsonFile(join(BF_NICHE.dir, "forecast.json"));
  const base = readJsonFile(join(V2_BASE.dir, "forecast.json"));
  const n = fc.niche;
  if (!n) return "нет niche";
  if (n.volume.top3.map((c) => c.domain).join(",") !== "leader.ru,second.ru,mid.ru") return `топ-3: ${n.volume.top3.map((c) => c.domain)}`;
  // объем - из сведенного growth-strategist forecast_inputs.competitors_traffic (одна база с t0), домен лидера - из
  // competitors.json, если его трафик совпадает со сведенным лидером
  if (n.volume.median_top3_traffic !== 1800 || n.volume.leader.domain !== "leader.ru") return `медиана ${n.volume.median_top3_traffic}, лидер ${n.volume.leader.domain}`;
  const pages = n.competition.factors.find((f) => f.key === "pages");
  if (!pages || pages.client !== V2_FI.pages.existing_commercial || pages.gap !== "big") return `страницы (клиент из forecast_inputs.pages): ${JSON.stringify(pages)}`;
  const by = Object.fromEntries(n.to_parity.map((p) => [p.id, p]));
  // тариф плана - Рост (PA, SY, KP, PF, YM), Максимум - с PFP, LA, AR
  if (!by.SY || !by.SY.in_plan || !by.SY.in_max) return `SY: ${JSON.stringify(by.SY)}`;
  if (!by.PF || !by.PF.in_plan || by.PF.in_max) return `PF (в Росте, в Максимуме PFP): ${JSON.stringify(by.PF)}`;
  if (!by.LA || by.LA.in_plan || !by.LA.in_max) return `LA (только в Максимуме): ${JSON.stringify(by.LA)}`;
  if (!by.AR || by.AR.in_plan || !by.AR.in_max) return `AR (только в Максимуме): ${JSON.stringify(by.AR)}`;
  for (const k of ["start", "growth", "max"]) {
    if (fc.tariffs[k].year1.romi !== base.tariffs[k].year1.romi || fc.tariffs[k].checkpoints.m12 !== base.tariffs[k].checkpoints.m12) return `${k}: карточка ниши изменила прогноз`;
  }
  return true;
});

// ──────────────────────────────────────────────────────────────────────────
// 3.4. Смета v2 (build-smeta-xlsx.mjs при forecast.json)
// ──────────────────────────────────────────────────────────────────────────

console.log("\n=== 3.4. v2: смета build-smeta-xlsx.mjs ===");

// Мини-вычислитель формул ExcelJS (SUM, MAX, MIN, COUNT, IF, AND, ROUND, ROUNDUP, FIXED, INDEX, SUMPRODUCT, склейка
// строк &, ссылки и диапазоны между листами): пересчитывает формулы прямо из xlsx, с подменой ячеек параметров.
// Нужен, потому что exceljs формулы не считает. FIXED - как Excel в русской локали (пробел тысяч, запятая).
function fixedRu(x, d) {
  const a = Math.round(Math.abs(x) * 10 ** d) / 10 ** d;
  const [i, f] = a.toFixed(Math.max(0, d)).split(".");
  return (x < 0 && a > 0 ? "-" : "") + i.replace(/\B(?=(\d{3})+(?!\d))/g, " ") + (d > 0 ? `,${f}` : "");
}
const roundUpX = (x, d) => (Math.sign(x) * Math.ceil(Math.abs(x) * 10 ** d - 1e-9)) / 10 ** d;
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
      if ((m = /^(>=|<=|<>|[-+*/(),:<>=&])/.exec(rest))) { out.push({ t: "op", v: m[0] }); i += m[0].length; continue; }
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
      let a = cat();
      while (isOp([">=", "<=", "<>", ">", "<", "="])) {
        const op = next().v;
        const x = numv(a), y = numv(cat());
        a = op === ">=" ? x >= y : op === "<=" ? x <= y : op === ">" ? x > y : op === "<" ? x < y : op === "=" ? x === y : x !== y;
      }
      return a;
    }
    // склейка строк (ниже сравнения, выше сложения - как в Excel)
    function cat() {
      let a = add();
      while (isOp("&")) { next(); const b = add(); a = String(a ?? "") + String(b ?? ""); }
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
          case "AND": return as.every((a) => !!evalAt(a));
          case "ROUND": { const k = 10 ** numv(evalAt(as[1])); return Math.round(numv(evalAt(as[0])) * k) / k; }
          case "ROUNDUP": return roundUpX(numv(evalAt(as[0])), numv(evalAt(as[1])));
          case "FIXED": return fixedRu(numv(evalAt(as[0])), numv(evalAt(as[1])));
          case "INDEX": {
            // INDEX(ряд, 1, n) / INDEX(ряд, n): горизонтальный ряд, строка 1
            const arr = flat(evalAt(as[0]));
            if (as.length === 3 && numv(evalAt(as[1])) !== 1) throw new Error(`INDEX: строка не 1 в ${f}`);
            const n = Math.trunc(numv(evalAt(as[as.length - 1])));
            if (n < 1 || n > arr.length) throw new Error(`INDEX вне диапазона (${n}) в ${f}`);
            return arr[n - 1];
          }
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

// Разметка листа «Окупаемость»: строки параметров (желтые ячейки) и строки блока каждого тарифа.
const PARAM_LABELS = [
  ["check", /^Средний чек/], ["ltv", /^Повторные покупки/], ["conv", /^Конверсия визит/],
  ["close", /^(Обращение -> продажа|Заказ -> оплата)/], ["lag", /^Цикл сделки/], ["margin", /^Маржинальность/],
  ["m0", /^Текущий трафик/],
];
const BLOCK_LABELS = [
  ["tot", /^Трафик из поиска всего/], ["leads", /^Дополнительные (обращения|заказы)/], ["sales", /^Дополнительные (продажи|оплаченные)/],
  ["revenue", /^Дополнительная выручка/], ["profit", /^Валовая прибыль/], ["cost", /^Затраты на продвижение/],
  ["cum", /^Результат нарастающим итогом/], ["be", /^Тех\. строка: чек и конверсия/], ["romi12", /^ROMI за 12 мес$/],
  ["payback", /^Окупаемость, мес$/], ["romi24", /^ROMI за 24 мес$/], ["romiDev", /^ROMI за 12 мес с учетом разработки сайта$/],
];
function paybackLayout(wb) {
  const ws = wb.getWorksheet(PB);
  if (!ws) return { blocks: null, params: null };
  const NAME_UP = { start: "СТАРТ", growth: "РОСТ", max: "МАКСИМУМ" };
  const blocks = {};
  const params = {};
  let cur = null;
  for (let r = 1; r <= ws.rowCount; r++) {
    const a = ws.getCell(r, 1).value;
    // строка условия окупаемости под таблицей тарифа - формула, а не текст
    if (cur && a && typeof a === "object" && typeof a.formula === "string" && /Тариф окупается/.test(a.formula)) { blocks[cur].breakeven = r; continue; }
    if (typeof a !== "string") continue;
    for (const k of TKEYS) if (a.startsWith(`ТАРИФ «${NAME_UP[k]}»`)) { cur = k; blocks[k] = {}; }
    if (!cur) { for (const [key, re] of PARAM_LABELS) if (!params[key] && re.test(a)) params[key] = r; continue; }
    for (const [key, re] of BLOCK_LABELS) if (!blocks[cur][key] && re.test(a)) blocks[cur][key] = r;
  }
  return { blocks, params };
}
async function loadSmeta(dir, slug) {
  const out = { dir, build: runBuildSmeta(dir), wb: null, ev: null, blocks: null, params: null, fc: null, xlsx: join(dir, `Smeta_${slug}.xlsx`) };
  out.fc = existsSync(join(dir, "forecast.json")) ? readJsonFile(join(dir, "forecast.json")) : null;
  if (out.build.code === 0 && existsSync(out.xlsx)) {
    out.wb = new ExcelJS.Workbook();
    await out.wb.xlsx.readFile(out.xlsx);
    out.ev = formulaEvaluator(out.wb);
    Object.assign(out, paybackLayout(out.wb));
  }
  return out;
}
const smetaProblem = (s) => (s.build.code !== 0 ? `смета не собралась: exit ${s.build.code}: ${s.build.stdout}` : !s.wb ? `нет ${s.xlsx}` : null);

// Смета собирается по копии опорной папки; книга и разметка «Окупаемость» читаются один раз.
const SMETA = await loadSmeta(copyV2Dir(V2_BASE.dir, "smeta-v2"), V2_INPUTS.slug);
const SMETA_XLSX = SMETA.xlsx;
function needSmeta() {
  return smetaProblem(SMETA);
}
// Окупаемость на листе - точный месяц до 24-го или «> 24 мес» (как payback_month модели)
const expPayback = (pm) => (pm == null ? `> ${HORIZON} мес` : pm);
// Модель при временно измененном цикле сделки (CAL.sales_lag_months по типу бизнеса) - для сверки с формулами сметы.
function withSalesLag(type, lag, fn) {
  const had = Object.prototype.hasOwnProperty.call(CAL.sales_lag_months, type);
  const saved = CAL.sales_lag_months[type];
  if (lag != null) CAL.sales_lag_months[type] = lag;
  try {
    return fn();
  } finally {
    if (had) CAL.sales_lag_months[type] = saved;
    else delete CAL.sales_lag_months[type];
  }
}

await step("смета v2: exit 0, 6 листов по порядку (Сравнение тарифов первым), без предупреждений об устаревшем прогнозе", () => {
  const bad = needSmeta();
  if (bad) return bad;
  const names = SMETA.wb.worksheets.map((w) => w.name);
  if (JSON.stringify(names) !== JSON.stringify(SMETA_SHEETS)) return `листы: ${names.join(", ")}`;
  if (!/v2: forecast\.json/.test(SMETA.build.stdout)) return `лог без пометки v2: ${SMETA.build.stdout}`;
  if (/ВНИМАНИЕ/.test(SMETA.build.stdout)) return `предупреждение при сборке: ${SMETA.build.stdout}`;
  return true;
});

// Кэш формул: у каждой формулы в XML записан результат (<v>), он совпадает с пересчетом; fullCalcOnLoad - Excel
// пересчитает при открытии. ExcelJS при чтении теряет кэш 0 (<v>0</v> -> result undefined) - его наличие видно по XML.
async function smetaCacheProblem(s) {
  let checked = 0;
  const diffs = [];
  for (const ws of s.wb.worksheets) {
    ws.eachRow((row) => row.eachCell((c) => {
      if (!(c.value && typeof c.value === "object" && typeof c.value.formula === "string")) return;
      if (c.isMerged && c.master && c.master.address !== c.address) return; // ячейки объединения отдают формулу главной
      checked++;
      const v = s.ev.value(ws.name, c.address);
      const r = c.value.result === undefined ? 0 : c.value.result;
      const same = typeof r === "number" ? Math.abs(Number(v === "" ? 0 : v) - r) <= 1e-6 * Math.max(1, Math.abs(r)) : v === r;
      if (!same && diffs.length < 3) diffs.push(`${ws.name}!${c.address} ${c.value.formula.slice(0, 120)}: ${v} != ${r}`);
    }));
  }
  if (diffs.length) return `кэш != формула: ${diffs.join(" | ")}`;
  const zip = await JSZip.loadAsync(readFileSync(s.xlsx));
  const wbXml = await zip.file("xl/workbook.xml").async("string");
  if (!/<calcPr[^>]*fullCalcOnLoad="1"/.test(wbXml)) return "в workbook.xml нет calcPr fullCalcOnLoad=\"1\" (Excel не пересчитает формулы при открытии)";
  let noCache = 0, inXml = 0;
  for (const name of Object.keys(zip.files).filter((x) => /^xl\/worksheets\/sheet\d+\.xml$/.test(x))) {
    const xml = await zip.file(name).async("string");
    const all = (xml.match(/<f>/g) || []).length;
    inXml += all;
    noCache += all - (xml.match(/<\/f><v>/g) || []).length;
  }
  if (noCache) return `${noCache} формул без кэша <v> - в просмотрщиках без пересчета ячейки пустые`;
  if (inXml !== checked) return `формул в XML ${inXml}, прочитано ${checked}`;
  return null;
}

await step("смета v2: «Окупаемость» на формулах; кэш каждой формулы во всей книге = пересчет, у всех формул в XML есть кэш <v>, fullCalcOnLoad", async () => {
  const bad = needSmeta();
  if (bad) return bad;
  let formulas = 0;
  SMETA.wb.getWorksheet(PB).eachRow((row) => row.eachCell((c) => { if (c.value && c.value.formula) formulas++; }));
  if (formulas < 3 * 24 * 7) return `формул на листе «Окупаемость»: ${formulas} (ожидалось >= ${3 * 24 * 7}: 3 тарифа x 24 мес x строки)`;
  if (!SMETA.blocks || TKEYS.some((k) => !SMETA.blocks[k] || !SMETA.blocks[k].romi12 || !SMETA.blocks[k].romi24 || !SMETA.blocks[k].payback || !SMETA.blocks[k].breakeven)) {
    return `не найдены блоки тарифов / строки ROMI и условия окупаемости: ${JSON.stringify(SMETA.blocks)}`;
  }
  for (const [k] of PARAM_LABELS) if (!SMETA.params[k]) return `не найдена ячейка параметра ${k}`;
  SMETA.ev.reset();
  return (await smetaCacheProblem(SMETA)) || true;
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

await step("смета v2: правка параметров (чек x2, конверсия 8%, закрытие 25%, маржа 50%; повторные покупки 1,6 и цикл сделки 2 мес) - формулы = модель с теми же параметрами, «Сравнение» пересчитывается", () => {
  const bad = needSmeta();
  if (bad) return bad;
  const cmp = SMETA.wb.getWorksheet("Сравнение тарифов");
  let cmpRomi = null;
  for (let r = 1; r <= cmp.rowCount; r++) if (cmp.getCell(r, 1).value === "ROMI за 12 мес") cmpRomi = r;
  const scenarios = [
    { name: "чек x2, конверсия 8%, закрытие 25%, маржа 50%", e: { avg_check: V2_FI.economics.avg_check * 2, conversion_rate: 0.08, close_rate: 0.25, margin: 0.5 }, lag: null },
    { name: "повторные покупки 1,6, цикл сделки 2 мес", e: { ltv_factor: 1.6 }, lag: 2 },
  ];
  const CELL = { avg_check: "check", conversion_rate: "conv", close_rate: "close", margin: "margin", ltv_factor: "ltv" };
  const tariffs = v2Tariffs();
  try {
    for (const sc of scenarios) {
      const econ = { ...V2_FI.economics, ...sc.e };
      SMETA.ev.reset();
      for (const [ek, pk] of Object.entries(CELL)) if (ek in sc.e) SMETA.ev.set(PB, `B${SMETA.params[pk]}`, econ[ek]);
      if (sc.lag != null) SMETA.ev.set(PB, `B${SMETA.params.lag}`, sc.lag);
      for (const k of TKEYS) {
        const res = withSalesLag(V2_FI.business_type, sc.lag, () => computeTariff(v2Fi({ economics: econ }), tariffs[k]));
        const b = SMETA.blocks[k];
        const r12 = SMETA.ev.value(PB, `B${b.romi12}`) * 100;
        const r24 = SMETA.ev.value(PB, `B${b.romi24}`) * 100;
        if (!(Math.abs(r12 - res.year1.romi) <= 1)) return `${sc.name}, ${k}: ROMI 12 мес формулой ${r12.toFixed(2)}% != модель ${res.year1.romi}%`;
        if (!(Math.abs(r24 - res.year2.romi) <= 1)) return `${sc.name}, ${k}: ROMI 24 мес формулой ${r24.toFixed(2)}% != модель ${res.year2.romi}%`;
        const pb = SMETA.ev.value(PB, `B${b.payback}`);
        if (pb !== expPayback(res.payback_month)) return `${sc.name}, ${k}: окупаемость ${pb} != модель ${res.payback_month}`;
        if (sc.lag) {
          for (let m = 1; m <= sc.lag; m++) if (SMETA.ev.value(PB, `${SMETA.ev.colStr(m + 1)}${b.sales}`) !== 0) return `${sc.name}, ${k}: продажи мес ${m} не 0 при цикле ${sc.lag}`;
        }
        const c = SMETA.ev.value("Сравнение тарифов", `${SMETA.ev.colStr(TKEYS.indexOf(k) + 2)}${cmpRomi}`) * 100;
        if (Math.abs(c - r12) > 1e-9) return `${sc.name}, ${k}: «Сравнение тарифов» не пересчиталось (${c.toFixed(2)}% vs ${r12.toFixed(2)}%)`;
      }
    }
  } finally {
    SMETA.ev.reset();
  }
  return true;
});

await step("смета v2: «Окупаемость» - повторные покупки, цикл сделки и m0 желтыми ячейками; продажи = INDEX(обращения, мес - цикл), выручка x повторные покупки; мес 13-24 свернуты, тех. строки скрыты; правка m0 сдвигает только уровень трафика", () => {
  const bad = needSmeta();
  if (bad) return bad;
  const ws = SMETA.wb.getWorksheet(PB);
  const P = SMETA.params;
  for (const [k] of PARAM_LABELS) {
    const argb = ws.getCell(P[k], 2).fill && ws.getCell(P[k], 2).fill.fgColor && ws.getCell(P[k], 2).fill.fgColor.argb;
    if (argb !== "FFFFF2CC") return `параметр ${k} (строка ${P[k]}) не желтая ячейка ввода (${argb})`;
  }
  if (ws.getCell(P.ltv, 2).value !== 1 || ws.getCell(P.lag, 2).value !== 0 || ws.getCell(P.m0, 2).value !== V2_FI.t0) return "значения параметров не из forecast.json (ltv 1, цикл 0, m0 = t0)";
  const b = SMETA.blocks.growth;
  const sales = ws.getCell(b.sales, 6).value; // мес 5
  if (!(sales && sales.formula && /INDEX\(/.test(sales.formula) && sales.formula.includes(`$B$${P.lag}`))) return `продажи - не сдвиг INDEX по циклу сделки: ${JSON.stringify(sales)}`;
  const rev = ws.getCell(b.revenue, 6).value;
  if (!(rev && rev.formula && rev.formula.includes(`$B$${P.ltv}`) && rev.formula.includes(`$B$${P.check}`))) return `выручка без повторных покупок: ${JSON.stringify(rev)}`;
  const tot = ws.getCell(b.tot, 6).value;
  if (!(tot && tot.formula && tot.formula.includes(`$B$${P.m0}`))) return `трафик месяца - не формула от m0: ${JSON.stringify(tot)}`;
  if (!(ws.getColumn(14).hidden && ws.getColumn(25).hidden) || ws.getColumn(13).hidden || ws.getColumn(26).hidden) return "мес 13-24 не свернуты или свернуты итоги года";
  for (const k of TKEYS) if (!ws.getRow(SMETA.blocks[k].be).hidden) return `${k}: тех. строка безубыточности не скрыта`;
  // m0: +1000 сдвигает трафик ровно на 1000, обращения не падают; 0 - обращения не уходят в минус
  SMETA.ev.reset();
  const base = Object.fromEntries(TKEYS.map((k) => [k, { tot: SMETA.ev.value(PB, `M${SMETA.blocks[k].tot}`), leads: SMETA.ev.value(PB, `M${SMETA.blocks[k].leads}`) }]));
  try {
    for (const m0 of [V2_FI.t0 + 1000, 0]) {
      SMETA.ev.set(PB, `B${P.m0}`, m0);
      for (const k of TKEYS) {
        const t12 = SMETA.ev.value(PB, `M${SMETA.blocks[k].tot}`), l12 = SMETA.ev.value(PB, `M${SMETA.blocks[k].leads}`);
        if (Math.abs(t12 - base[k].tot - (m0 - V2_FI.t0)) > 1e-6) return `${k}: m0 ${m0} - трафик 12 мес ${t12} (ожидался сдвиг на ${m0 - V2_FI.t0} от ${base[k].tot})`;
        if (!(l12 >= 0) || (m0 > V2_FI.t0 && l12 < base[k].leads - 1e-9)) return `${k}: m0 ${m0} - обращения 12 мес ${l12} (было ${base[k].leads})`;
      }
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
    if (Math.round(tr) !== f.checkpoints.m12) return `${k}: трафик 12 мес ${tr} != ${f.checkpoints.m12}`;
    const trCell = ws.getCell(`${col}${rows.tr12}`).value;
    if (!(trCell && trCell.formula && trCell.formula.includes(PB))) return `${k}: трафик 12 мес - не ссылка на «Окупаемость» (правка m0 не дойдет)`;
  }
  // сайт есть и все тарифы в плюсе: строк «с учетом разработки» и «Окупится за 12 мес, если» нет
  if (rowOf("ROMI за 12 мес с учетом разработки сайта") || TKEYS.some((k) => SMETA.blocks[k].romiDev)) return "строка ROMI с разработкой у сайта, который уже есть (запуск с 1-го мес)";
  if (rowOf("Окупится за 12 мес, если")) return "строка «Окупится за 12 мес, если», а все тарифы окупаются";
  for (const k of TKEYS) if (SMETA.ev.value(PB, `A${SMETA.blocks[k].breakeven}`) !== "") return `${k}: строка условия окупаемости не пустая при ROMI > 0`;
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
  // зачет прототипа - с любым тарифом, где есть KP (здесь Рост и Максимум), а не с первым из них
  if (!findCell(ws, /^Вместе с любым тарифом, где есть прототип с текстами \(тарифы «Рост», «Максимум»\)/)) return "зачет прототипа не подписан «с любым тарифом, где есть прототип» (Рост, Максимум)";
  // каталог у сайта услуг - проектов и услуг, не товаров
  if (!findCell(ws, /^Каталог проектов \/ услуг/) || findCell(ws, /^Каталог товаров/)) return "опция каталога для сайта услуг подписана как каталог товаров";
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

await step("v2.3: мощность бизнеса - economics.scale.capacity_month ограничивает продажи модели и формулы сметы (желтая ячейка), ROMI сметы = прогноз", async () => {
  const e0 = resolveEconomics(V2_FI);
  const base = V2_FI.t0 * e0.conversion_rate * e0.close_rate;
  const cap = Math.ceil(base) + 2;
  const fi = v2Fi({ economics: { ...V2_FI.economics, scale: { sales_month: null, capacity_month: cap, basis: "тест: мастер-одиночка" } } });
  const free = computeTariff(V2_FI, v2Tariffs().growth), capped = computeTariff(fi, v2Tariffs().growth);
  if (capped.economics.capacity_sales_month !== cap) return `economics.capacity_sales_month ${capped.economics.capacity_sales_month} (ожидалось ${cap})`;
  if (capped.months.some((x) => x.sales > cap - base + 1e-9)) return `продажи выше мощности: ${Math.max(...capped.months.map((x) => x.sales)).toFixed(2)} > ${(cap - base).toFixed(2)}`;
  if (!(capped.year1.sales < free.year1.sales)) return `мощность не ограничила продажи: ${capped.year1.sales} vs ${free.year1.sales}`;
  const r = writeV2Dir("cap-smeta", { fi, content: null });
  if (r.code !== 0 && r.code !== 3) return `build-forecast exit ${r.code}: ${r.stdout}`;
  const fc = readJsonFile(join(r.dir, "forecast.json"));
  if (!/Мощность бизнеса - не больше/.test(fc.assumptions_note)) return `методика без мощности: ${fc.assumptions_note}`;
  const S = await loadSmeta(r.dir, V2_INPUTS.slug);
  const bad = smetaProblem(S);
  if (bad) return bad;
  if (!findCell(S.wb.getWorksheet(PB), /^Мощность бизнеса, продаж в мес$/)) return "на «Окупаемости» нет желтой ячейки мощности";
  for (const k of TKEYS) {
    const romi = S.ev.value(PB, `B${S.blocks[k].romi12}`) * 100;
    if (Math.abs(romi - fc.tariffs[k].year1.romi) > 1) return `${k}: ROMI сметы ${romi.toFixed(1)}% != прогноз ${fc.tariffs[k].year1.romi}%`;
  }
  return true;
});

// ── Смета нового сайта (v2.1): запуск к 3-му мес, гейт не пройден (рекомендуем Старт), Рост и Максимум за 12 мес
// в минусе, разработку рекомендуем ──
const SMETA_NEW = await loadSmeta(copyV2Dir(V2_NEW.dir, "smeta-v2-new"), V2_NEW_INPUTS.slug);
const allCellsOf = (wb) => {
  const out = [];
  for (const ws of wb.worksheets) ws.eachRow((row) => row.eachCell((c) => out.push({ sheet: ws.name, addr: c.address, text: cellText(c) })));
  return out;
};

await step("смета v2 (новый сайт): ежемесячные с 3-го мес и акция ПФ в 4-м на листах тарифов и в «Окупаемости», итог 12 мес = затраты модели; шапка «Натяжные потолки, Сочи», а не «none»; рекомендуем Старт; кэш формул", async () => {
  const bad = smetaProblem(SMETA_NEW);
  if (bad) return bad;
  if (/ВНИМАНИЕ/.test(SMETA_NEW.build.stdout)) return `предупреждение при сборке: ${SMETA_NEW.build.stdout}`;
  if (!/запуск сайта - 3-й мес/.test(SMETA_NEW.build.stdout)) return `лог без месяца запуска: ${SMETA_NEW.build.stdout}`;
  const fc = SMETA_NEW.fc;
  for (const k of TKEYS) {
    const ws = SMETA_NEW.wb.getWorksheet(TNAME[k]);
    if (!findCell(ws, /^Этап 2 \(ежемесячно\): с 3-го месяца, когда новый сайт выходит в поиск$/)) return `${TNAME[k]}: нет «Этап 2 (ежемесячно): с 3-го месяца»`;
    if (!findCell(ws, /^4-й мес$/)) return `${TNAME[k]}: акция ПФ 1=2 не в 4-м мес (месяц запуска + 1)`;
    const y12 = findCell(ws, /^Итого за 12 месяцев/);
    if (!y12) return `${TNAME[k]}: нет итога за 12 месяцев`;
    const v = SMETA_NEW.ev.value(TNAME[k], `E${y12.row}`);
    if (v !== fc.tariffs[k].year1.cost) return `${TNAME[k]}: итог 12 мес ${v} != затраты модели ${fc.tariffs[k].year1.cost}`;
    const pbCosts = [2, 3, 4, 5].map((col) => SMETA_NEW.wb.getWorksheet(PB).getCell(SMETA_NEW.blocks[k].cost, col).value);
    const modelCosts = fc.tariffs[k].months.slice(0, 4).map((x) => x.cost);
    if (pbCosts.join() !== modelCosts.join()) return `${k}: затраты «Окупаемости» мес 1-4 ${pbCosts.join(", ")} != модель ${modelCosts.join(", ")}`;
  }
  if (fc.tariffs.growth.months.slice(0, 4).map((x) => x.cost).join() !== "80000,0,50000,25000") return "фикстура: затраты Роста мес 1-4";
  for (const ws of SMETA_NEW.wb.worksheets) {
    const sub = cellText(ws.getCell(2, 1));
    if (!sub.startsWith("Натяжные потолки, Сочи - SEO-продвижение")) return `${ws.name}: шапка «${sub}» (сайта нет - ниша и город)`;
  }
  if (allCellsOf(SMETA_NEW.wb).some((c) => /\bnone\b/i.test(c.text))) return "в смете осталось «none»";
  if (!/РЕКОМЕНДУЕМ/.test(cellText(SMETA_NEW.wb.getWorksheet("Старт").getCell(1, 1))) || /РЕКОМЕНДУЕМ/.test(cellText(SMETA_NEW.wb.getWorksheet("Рост").getCell(1, 1)))) return "рекомендован не Старт (recommended_offer = start)";
  return (await smetaCacheProblem(SMETA_NEW)) || true;
});

await step("смета v2 (новый сайт): ROMI 12 мес <= 0 - строка «Тариф окупается за 12 мес при среднем чеке от X ₽ (сейчас Y ₽)», чек и конверсия из нее дают ROMI 0; «Окупится за 12 мес, если» на «Сравнении»; подпись без «дольше 12 месяцев»", () => {
  const bad = smetaProblem(SMETA_NEW);
  if (bad) return bad;
  const S = SMETA_NEW;
  const P = S.params;
  let losers = 0;
  S.ev.reset();
  try {
    for (const k of TKEYS) {
      const b = S.blocks[k];
      if (!b.breakeven || !b.be) return `${k}: нет строки условия окупаемости / тех. строки безубыточности`;
      const romi = S.ev.value(PB, `B${b.romi12}`);
      const line = S.ev.value(PB, `A${b.breakeven}`);
      if (romi > 0) {
        if (line !== "") return `${k}: ROMI ${(romi * 100).toFixed(1)}% > 0, а строка условия «${line}»`;
        continue;
      }
      losers++;
      if (!/^Тариф окупается за 12 мес при среднем чеке от \d[\d ]* ₽ \(сейчас 30 000 ₽\)/.test(line)) return `${k}: строка условия «${line}»`;
      const beCheck = S.ev.value(PB, `B${b.be}`), beConv = S.ev.value(PB, `C${b.be}`);
      if (!(beCheck > 30000)) return `${k}: чек безубыточности ${beCheck} не выше текущего`;
      S.ev.set(PB, `B${P.check}`, beCheck);
      if (Math.abs(S.ev.value(PB, `B${b.romi12}`)) > 1e-9) return `${k}: при чеке ${beCheck} ROMI 12 мес ${S.ev.value(PB, `B${b.romi12}`)} (ожидалось 0)`;
      S.ev.reset();
      if (beConv > 0 && beConv <= 0.5) {
        if (!/или конверсии от \d+,\d% \(сейчас 5,0%\)/.test(line)) return `${k}: в строке условия нет конверсии безубыточности: «${line}»`;
        S.ev.set(PB, `B${P.conv}`, beConv);
        if (Math.abs(S.ev.value(PB, `B${b.romi12}`)) > 1e-9) return `${k}: при конверсии ${beConv} ROMI 12 мес ${S.ev.value(PB, `B${b.romi12}`)} (ожидалось 0)`;
        S.ev.reset();
      }
      // параметры поменяли так, что тариф окупается, - строка пустеет (формула живая)
      S.ev.set(PB, `B${P.check}`, beCheck * 2);
      if (S.ev.value(PB, `A${b.breakeven}`) !== "") return `${k}: при чеке x2 от безубыточного строка условия не пустая`;
      S.ev.reset();
    }
  } finally {
    S.ev.reset();
  }
  // v2.3: у Максимума (PFP + LA сверх Роста при потолке спроса) ROMI <= 0; Рост в плюсе, но хуже Старта по чистому
  // результату - гейт не пройден, рекомендован Старт
  if (losers < 1) return `фикстура: тарифов с ROMI <= 0 - ${losers} (ожидался хотя бы Максимум)`;
  const cmp = S.wb.getWorksheet("Сравнение тарифов");
  const row = findCell(cmp, /^Окупится за 12 мес, если$/);
  if (!row) return "нет строки «Окупится за 12 мес, если» на «Сравнении тарифов»";
  const colOf = { start: "B", growth: "C", max: "D" };
  for (const k of TKEYS) {
    const txt = S.ev.value("Сравнение тарифов", `${colOf[k]}${row.row}`);
    const romi = S.ev.value(PB, `B${S.blocks[k].romi12}`);
    if (romi > 0 ? txt !== "окупается при текущих допущениях" : !/^чек от \d[\d ]* ₽/.test(txt)) return `«Окупится за 12 мес, если», ${k} (ROMI ${(romi * 100).toFixed(0)}%): «${txt}»`;
  }
  const a3 = cellText(cmp.getCell(3, 1));
  if (/дольше 12 месяцев/.test(a3) || !/Рекомендуем тариф «Старт»/.test(a3)) return `подпись «Сравнения»: ${a3.slice(0, 200)}`;
  return true;
});

await step("смета v2 (новый сайт): «ROMI за 12 мес с учетом разработки сайта» на «Окупаемости» и «Сравнении» = (прибыль - затраты - разработка с зачетом прототипа) / (затраты + разработка)", () => {
  const bad = smetaProblem(SMETA_NEW);
  if (bad) return bad;
  const S = SMETA_NEW;
  const t = v2NewTariffs();
  const dp = devPrice(t.site_dev);
  S.ev.reset();
  for (const k of TKEYS) {
    const b = S.blocks[k];
    if (!b.romiDev) return `${k}: нет строки «ROMI за 12 мес с учетом разработки сайта»`;
    const hasKP = t[k].onetime.some((s) => s.id === "KP");
    const dev = dp.total - (hasKP ? dp.prototype_price : 0);
    const profit = S.ev.value(PB, `Z${b.profit}`), cost = S.ev.value(PB, `Z${b.cost}`);
    const want = (profit - cost - dev) / (cost + dev);
    const got = S.ev.value(PB, `B${b.romiDev}`);
    if (Math.abs(got - want) > 1e-9) return `${k}: ROMI с разработкой ${got} (ожидалось ${want}, разработка ${dev})`;
    if (!(got < S.ev.value(PB, `B${b.romi12}`))) return `${k}: ROMI с разработкой не ниже ROMI без нее`;
    const f = S.wb.getWorksheet(PB).getCell(b.romiDev, 2).value;
    if (!(f && f.formula && f.formula.includes("'Разработка сайта'!"))) return `${k}: стоимость разработки не ссылкой на лист «Разработка сайта»: ${JSON.stringify(f)}`;
  }
  const cmp = S.wb.getWorksheet("Сравнение тарифов");
  const row = findCell(cmp, /^ROMI за 12 мес с учетом разработки сайта$/);
  if (!row) return "нет строки ROMI с разработкой на «Сравнении тарифов»";
  for (let j = 0; j < TKEYS.length; j++) {
    const col = S.ev.colStr(j + 2);
    if (Math.abs(S.ev.value("Сравнение тарифов", `${col}${row.row}`) - S.ev.value(PB, `B${S.blocks[TKEYS[j]].romiDev}`)) > 1e-12) return `${TKEYS[j]}: «Сравнение» не ссылается на ROMI с разработкой`;
  }
  return true;
});

await step("смета v2: кухня архитектора не в смете - price_note (кроме объема «до N страниц» в начале), «Профиль «...»» в «Почему этот вариант», «(для не-Tilda)»; BS без пометки - объем по цене", async () => {
  // базовая смета: у техаудита нет служебной пометки «(для не-Tilda)»
  const bad = needSmeta();
  if (bad) return bad;
  const leakBase = allCellsOf(SMETA.wb).find((c) => /не-?\s?Tilda/i.test(c.text));
  if (leakBase) return `${leakBase.sheet}!${leakBase.addr}: «${leakBase.text.slice(0, 80)}»`;
  // тарифы с пометками архитектора; FA -> BS (сайт на Tilda), прогноз пересобран
  const t = v2Tariffs();
  for (const k of TKEYS) {
    const i = t[k].onetime.findIndex((s) => s.id === "FA");
    t[k].onetime[i] = { id: "BS", price: 5000 };
    t[k].total_onetime -= 20000;
  }
  t.start.monthly.find((s) => s.id === "PF").price_note = "продвинутый пока не нужен - медианный DR прямых конкурентов 18, YMYL нет";
  t.max.onetime.find((s) => s.id === "FQ").price_note = "до 30 коммерческих страниц; DR конкурентов до 32, профиль B";
  t.max.hint = `Профиль «Активный»: ${t.max.hint}`;
  const r = writeV2Dir("smeta-v2-kitchen", { tariffs: t, content: null });
  if (r.code !== 0) return `build-forecast: exit ${r.code}: ${r.stdout}`;
  const s = await loadSmeta(r.dir, V2_INPUTS.slug);
  const sb = smetaProblem(s);
  if (sb) return sb;
  const cells = allCellsOf(s.wb);
  const leak = cells.find((c) => /DR\s*\d|DR конкурент|медианный DR|YMYL|пока не нужен|[Пп]рофиль\s*«|профиль [AB]\b|не-?\s?Tilda/.test(c.text));
  if (leak) return `кухня архитектора в смете: ${leak.sheet}!${leak.addr} «${leak.text.slice(0, 100)}»`;
  const max = s.wb.getWorksheet("Максимум");
  if (!findCell(max, /^Почему этот вариант: Все из Роста/)) return "«Почему этот вариант» Максимума не очищен от профиля";
  const fq = findCell(max, /Объем: до 30 коммерческих страниц$/);
  if (!fq) return "у FQ нет объема «до 30 коммерческих страниц» из начала price_note";
  if (!findCell(s.wb.getWorksheet("Старт"), /Объем: до 10 страниц$/)) return "у BS 5 000 без пометки нет объема «до 10 страниц» по цене";
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

await step("docx v2: money_lost по lost_now v2.1 - разрыв с конкурентами по базовой конверсии (переходы x конверсия = обращения), без Карт и прототипа в воронке", () => {
  if (!DOCX_TEXT) return "docx не собран";
  const fc = readJsonFile(join(DOCX_DIR, "forecast.json"));
  const ln = fc.lost_now, e = fc.inputs.economics;
  if (ln.basis !== "competitors") return `фикстура: lost_now.basis ${ln.basis}`;
  const t = flatText(DOCX_TEXT.text);
  const i = t.indexOf("Деньги, которые вы теряете"), j = t.indexOf("Почему это важно сейчас");
  if (i < 0 || j < i) return "не найден блок «Деньги, которые вы теряете»";
  const block = t.slice(i, j);
  if (!block.includes("Конкуренты из топа")) return `подпись блока не про конкурентов: ${block.slice(0, 200)}`;
  if (!block.includes(`${fmtIntS(ln.traffic_month)} переход`)) return `нет шага «${fmtIntS(ln.traffic_month)} переход...» (lost_now.traffic_month)`;
  if (!block.includes(`${fmtCountS(ln.leads_month)} обращени`)) return `нет шага «${fmtCountS(ln.leads_month)} обращ...» (lost_now.leads_month)`;
  if (Math.abs(ln.leads_month - ln.traffic_month * e.conversion_rate) > 0.5 * e.conversion_rate + 0.051) return `воронка не сходится: ${ln.traffic_month} x ${e.conversion_rate} != ${ln.leads_month}`;
  if (/Карт/.test(block)) return "в блоке потерь обращения из Карт - потери считаются по базовой конверсии, без Карт";
  if (!/без улучшений сайта/.test(block)) return "нет пометки «конверсия - как сейчас, без улучшений сайта»";
  if (/текущих посетителей/.test(t)) return "шаблонная фраза про «текущих посетителей»";
  return true;
});

// Сборка docx в копии собранной папки с правками forecast.json / tariffs.json. Возврат {dir, r, text (плоский)}.
async function buildDocxCase(name, srcDir, { patchForecast, patchTariffs, content } = {}) {
  const dir = copyV2Dir(srcDir, name, content);
  if (patchForecast) {
    const f = readJsonFile(join(dir, "forecast.json"));
    patchForecast(f);
    writeJson(join(dir, "forecast.json"), f);
  }
  if (patchTariffs) {
    const t = readJsonFile(join(dir, "tariffs.json"));
    patchTariffs(t);
    writeJson(join(dir, "tariffs.json"), t);
  }
  const r = runScript("build-strategy-docx.mjs", dir);
  const p = join(dir, `SEO_Strategy_${readJsonFile(join(dir, "inputs.json")).slug}.docx`);
  const text = r.code === 0 && existsSync(p) ? flatText((await docxText(p)).text) : null;
  return { dir, r, text };
}
// раздел «План работ по месяцам» (до пояснения под ним)
const planPart = (t) => { const i = t.indexOf("План работ по месяцам"); const j = t.indexOf("Разовые работы идут по очереди", i); return i < 0 ? "" : t.slice(i, j < 0 ? undefined : j); };
const tablePart = (t) => { const i = t.indexOf("Сейчас и через 3, 6 и 12 месяцев"); const j = t.indexOf("За счет чего растем", i); return i < 0 ? "" : t.slice(i, j < 0 ? undefined : j); };

const DOCX_NEW = await buildDocxCase("docx-v2-new", V2_NEW.dir);

await step("docx v2 (новый сайт, гейт не пройден): план, график, таблица и KPI - по plan_tariff (Старт), строка «Разработка и запуск сайта», «Сайт выходит в поиск к 3-му месяцу»", () => {
  if (!DOCX_NEW.text) return `docx не собран: exit ${DOCX_NEW.r.code}: ${DOCX_NEW.r.stdout}`;
  if (/ВНИМАНИЕ/.test(DOCX_NEW.r.stdout)) return `предупреждения сборщика: ${DOCX_NEW.r.stdout}`;
  const fc = readJsonFile(join(DOCX_NEW.dir, "forecast.json"));
  if (fc.plan_tariff !== "start") return `фикстура: plan_tariff ${fc.plan_tariff}`;
  const t = DOCX_NEW.text;
  const plan = planPart(t);
  for (const s of [TIMELINE.PA.label, TIMELINE.SY.label, TIMELINE.KP.label, DEV_TIMELINE.label, TIMELINE.PF.label]) if (!plan.includes(s)) return `в плане работ нет «${s}»`;
  for (const id of ["FQ", "LB"]) if (plan.includes(TIMELINE[id].label)) return `в плане работа Роста «${TIMELINE[id].label}», а тариф плана - Старт`;
  if (!t.includes("выводим в поиск к 3-му месяцу")) return "под планом нет «выводим в поиск к 3-му месяцу»";
  if (!t.includes("Сайт выходит в поиск к 3-му месяцу")) return "под графиком нет «Сайт выходит в поиск к 3-му месяцу»";
  const s = fc.tariffs.start, g = fc.tariffs.growth;
  const kpi = `до ${fmtIntS(s.checkpoints.m12)} ${trafficGenS(s.checkpoints.m12)} из поиска в месяц к 12-му месяцу`;
  if (!t.includes(kpi)) return `нет KPI «${kpi}» (по Старту)`;
  if (t.includes(`до ${fmtIntS(g.checkpoints.m12)} `)) return `KPI по Росту (до ${g.checkpoints.m12})`;
  const row = `С планом 0 ${fmtIntS(s.months[2].traffic)} ${fmtIntS(s.months[5].traffic)} ${fmtIntS(s.months[11].traffic)} Без работ 0 0 0 0`;
  if (!tablePart(t).includes(row)) return `в таблице прогноза нет «${row}» (трафик Старта)`;
  return true;
});

await step("docx v2: строка «Разработка и запуск сайта» в плане - при рекомендованной разработке (сайт есть - после прототипа), без нее и при запуске с 1-го мес - нет", async () => {
  if (!DOCX_TEXT) return "docx не собран";
  const base = flatText(DOCX_TEXT.text);
  if (!planPart(base).includes(DEV_TIMELINE.label)) return "site_dev.recommended = true, а строки разработки в плане нет";
  if (!base.includes("Новый сайт собираем по согласованному прототипу")) return "нет пояснения про сборку нового сайта по прототипу";
  const { r, text } = await buildDocxCase("docx-v2-nodev", V2_BASE.dir, { patchTariffs: (t) => { t.site_dev.recommended = false; } });
  if (!text) return `без разработки: exit ${r.code}: ${r.stdout}`;
  if (planPart(text).includes(DEV_TIMELINE.label)) return "разработку не рекомендуем, сайт есть, а строка разработки в плане";
  return true;
});

await step("docx v2: таблица прогноза без абсолютной выручки «без работ» - переходы с планом / без работ, дальше только прирост обращений и выручки", () => {
  if (!DOCX_TEXT) return "docx не собран";
  const fc = readJsonFile(join(DOCX_DIR, "forecast.json"));
  const tbl = tablePart(flatText(DOCX_TEXT.text));
  for (const s of ["Переходы из поиска в месяц", "С планом", "Без работ", "Дополнительные обращения в месяц", "Дополнительная выручка в месяц"]) if (!tbl.includes(s)) return `в таблице нет «${s}»`;
  if (/(^| )Выручка в месяц/.test(tbl)) return "строка абсолютной выручки в таблице прогноза";
  const baseRub = rubShortS(fc.baseline.revenue_month);
  if (tbl.includes(baseRub)) return `абсолютная выручка без работ «${baseRub}» в таблице`;
  const m = fc.tariffs[fc.plan_tariff].months;
  for (const k of [3, 6, 12]) if (!tbl.includes(`+${rubShortS(m[k - 1].revenue)}`)) return `нет прироста выручки «+${rubShortS(m[k - 1].revenue)}» через ${k} мес`;
  return true;
});

await step("docx v2: склонения по числу, которое видит читатель - «~21 обращение ... недополучаете», «~5,2 обращения ... недополучаете», «420 переходов», «104 перехода», «6,3 продажи», «1 продажа»", async () => {
  const cases = [
    { name: "a", ln: { traffic_month: 420, target_traffic: 820, leads_month: 21, sales_month: 6.3, revenue_month: 252000 },
      want: ["~21 обращение в месяц вы недополучаете", "420 переходов в месяц", "21 обращение в месяц", "6,3 продажи в месяц", "~21 обращение и ~252 тыс ₽ выручки в месяц"] },
    { name: "b", ln: { traffic_month: 104, target_traffic: 504, leads_month: 5.2, sales_month: 1, revenue_month: 40000 },
      want: ["~5,2 обращения в месяц вы недополучаете", "104 перехода в месяц", "5,2 обращения в месяц", "1 продажа в месяц", "~5,2 обращения и ~40 тыс ₽ выручки в месяц"] },
  ];
  for (const c of cases) {
    const { r, text } = await buildDocxCase(`docx-v2-plural-${c.name}`, V2_BASE.dir, { patchForecast: (f) => Object.assign(f.lost_now, c.ln) });
    if (!text) return `${c.name}: docx не собран: exit ${r.code}: ${r.stdout}`;
    if (/ВНИМАНИЕ/.test(r.stdout)) return `${c.name}: предупреждения сборщика: ${r.stdout}`;
    const miss = c.want.filter((s) => !text.includes(s));
    if (miss.length) return `${c.name}: нет «${miss.join("» | «")}»`;
  }
  return true;
});

await step("docx v2: старый forecast.json (без plan_tariff и lost_now.basis) - план и KPI по recommended_offer, предупреждение «пересобери build-forecast»", async () => {
  const { r, text, dir } = await buildDocxCase("docx-v2-oldfc", V2_BASE.dir, {
    patchForecast: (f) => { delete f.plan_tariff; f.recommended_offer = "start"; delete f.lost_now.basis; },
  });
  if (!text) return `exit ${r.code}: ${r.stdout}`;
  if (!/пересобери build-forecast/.test(r.stdout)) return `нет предупреждения про старую семантику потерь: ${r.stdout}`;
  if (planPart(text).includes(TIMELINE.YM.label)) return "план по Росту (Карты), а recommended_offer = start";
  if (!planPart(flatText(DOCX_TEXT ? DOCX_TEXT.text : "")).includes(TIMELINE.YM.label)) return "фикстура: в плане Роста нет Карт";
  const s = readJsonFile(join(dir, "forecast.json")).tariffs.start.checkpoints;
  const ratio = s.m12 / s.m0;
  const kpi = ratio >= 2 ? `×${dec1S(ratio)}` : `+${Math.round((ratio - 1) * 100)}%`;
  if (!text.includes(`${kpi} рост переходов из поиска за 12 месяцев`)) return `нет KPI роста по Старту «${kpi}»`;
  return true;
});

// ──────────────────────────────────────────────────────────────────────────
// 3.6. verify-strategy.mjs v2
// ──────────────────────────────────────────────────────────────────────────

console.log("\n=== 3.6. v2: verify-strategy.mjs (format v2) ===");

// Контракт писателя v2.2: маркер карточки ниши в competitors сразу после лида. v2Content() (фикстура docx) его не
// содержит - это заодно content v2, написанный до карточки ниши: он обязан проходить гейт (warning, не блок).
function withNicheCard(c) {
  const comp = c.sections.find((s) => s.key === "competitors");
  const lead = comp.blocks.findIndex((b) => b.type === "paragraph");
  comp.blocks.splice(lead + 1, 0, { type: "niche_card" });
  return c;
}

function verifyV2Case(name, mutate) {
  const content = withNicheCard(v2Content());
  if (mutate) mutate(content);
  return copyV2Dir(V2_BASE.dir, name, content);
}

await step("verify v2: чистый content + свежий forecast.json -> exit 0, ПРОГНОЗ: OK", () => {
  const r = runVerify(verifyV2Case("verify-v2-clean"));
  if (r.code !== 0) return `exit ${r.code}: ${r.stdout}`;
  if (!/формат v2/.test(r.stdout)) return `скрипт не ушел в ветку v2: ${r.stdout}`;
  if (!/ПРОГНОЗ: OK/.test(r.stdout)) return `нет «ПРОГНОЗ: OK»: ${r.stdout}`;
  for (const h of ["СТРУКТУРА (", "ДЕНЬГИ В ПРОЗЕ", "ТАРИФЫ В ПРОЗЕ", "СТОП-ПАТТЕРНЫ", "ТИРЕ/", "СОСТАВ ПЛАНА", "ЭКОНОМИКА", "ЖАРГОН"]) {
    if (r.stdout.includes(h)) return `ложное нарушение / предупреждение «${h}»: ${r.stdout}`;
  }
  if (!/тариф плана «Рост»/.test(r.stdout)) return `ПРОГНОЗ: OK не по тарифу плана «Рост»: ${r.stdout}`;
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

await step("verify v2: content без маркера niche_card (написан до карточки ниши) -> exit 0, СТРУКТУРА (warning) для strategy-writer, не блок", () => {
  const r = runVerify(copyV2Dir(V2_BASE.dir, "verify-v2-no-niche", v2Content()));
  if (r.code !== 0) return `exit ${r.code} (expect 0 - старый content v2 проходит): ${r.stdout}`;
  if (!/СТРУКТУРА \(warning\) \(1\)/.test(r.stdout)) return `нет СТРУКТУРА (warning): ${r.stdout}`;
  if (!/\[competitors\] нет маркера \{"type": "niche_card"\}/.test(r.stdout) || !/\(strategy-writer\)/.test(r.stdout)) return `предупреждение не называет niche_card / писателя: ${r.stdout}`;
  if (/КОМУ ЧИНИТЬ|НЕ ПРОЙДЕНО/.test(r.stdout)) return `предупреждение ушло в блок: ${r.stdout}`;
  if (!/OK: нарушений нет \(см\. предупреждения: структура \(карточка ниши\)\)/.test(r.stdout)) return `итог без пометки про карточку ниши: ${r.stdout}`;
  return true;
});

await step("verify v2: маркер niche_card не на месте (после compare, второй раз, в разделе plan) -> СТРУКТУРА (warning) по каждому случаю, exit 0", () => {
  const late = runVerify(verifyV2Case("verify-v2-niche-late", (c) => {
    const comp = c.sections[1].blocks;
    comp.splice(comp.findIndex((b) => b.type === "niche_card"), 1);
    comp.splice(comp.findIndex((b) => b.type === "compare") + 1, 0, { type: "niche_card" });
  }));
  if (late.code !== 0) return `после compare: exit ${late.code}: ${late.stdout}`;
  if (!/niche_card стоит после блока «bars»/.test(late.stdout)) return `не названо, что маркер не сразу после лида: ${late.stdout}`;
  const twice = runVerify(verifyV2Case("verify-v2-niche-twice", (c) => {
    c.sections[1].blocks.push({ type: "niche_card" });
    c.sections[2].blocks.splice(1, 0, { type: "niche_card" });
  }));
  if (twice.code !== 0) return `дубли: exit ${twice.code}: ${twice.stdout}`;
  if (!/\[competitors\] маркер niche_card 2 раза/.test(twice.stdout)) return `не пойман второй маркер в competitors: ${twice.stdout}`;
  if (!/\[plan\] маркер niche_card вне раздела competitors/.test(twice.stdout)) return `не пойман маркер в plan: ${twice.stdout}`;
  if (/нет маркера \{"type": "niche_card"\}/.test(twice.stdout)) return `ложное «нет маркера» при маркере в competitors: ${twice.stdout}`;
  const moved = runVerify(verifyV2Case("verify-v2-niche-moved", (c) => {
    c.sections[1].blocks = c.sections[1].blocks.filter((b) => b.type !== "niche_card");
    c.sections[0].blocks.splice(1, 0, { type: "niche_card" });
  }));
  if (!/\[situation\] маркер niche_card вне раздела competitors/.test(moved.stdout)) return `не пойман маркер в situation: ${moved.stdout}`;
  if (/нет маркера \{"type": "niche_card"\}/.test(moved.stdout)) return `двойное предупреждение (вне раздела + нет маркера): ${moved.stdout}`;
  return true;
});

await step("verify v2: маркер niche_card есть, а forecast.json без niche (собран до карточки) -> СТРУКТУРА (warning) «перезапусти build-forecast» для оркестратора, ПРОГНОЗ: OK, exit 0", () => {
  const dir = verifyV2Case("verify-v2-niche-old-forecast");
  const fc = readJsonFile(join(dir, "forecast.json"));
  delete fc.niche;
  writeJson(join(dir, "forecast.json"), fc);
  const r = runVerify(dir);
  if (r.code !== 0) return `exit ${r.code} (expect 0 - предупреждение): ${r.stdout}`;
  if (!/ПРОГНОЗ: OK/.test(r.stdout)) return `карточка ниши повлияла на сверку прогноза: ${r.stdout}`;
  if (!/СТРУКТУРА \(warning\)/.test(r.stdout) || !/в forecast\.json нет niche/.test(r.stdout) || !/перезапусти build-forecast\.mjs/.test(r.stdout) || !/оркестратор, не писатель/.test(r.stdout)) {
    return `нет предупреждения про пересборку прогноза: ${r.stdout}`;
  }
  // forecast.json нет совсем - только блок ПРОГНОЗ, без второго предупреждения про niche
  const dir2 = verifyV2Case("verify-v2-niche-no-forecast");
  rmSync(join(dir2, "forecast.json"), { force: true });
  const r2 = runVerify(dir2);
  if (r2.code !== 2 || !/нет forecast\.json/.test(r2.stdout)) return `без forecast.json: exit ${r2.code}: ${r2.stdout}`;
  if (/нет niche/.test(r2.stdout)) return `лишнее предупреждение про niche при отсутствии forecast.json: ${r2.stdout}`;
  return true;
});

function verifyNewCase(name, mutate) {
  const content = withNicheCard(v2NewContent());
  if (mutate) mutate(content);
  return copyV2Dir(V2_NEW.dir, name, content);
}

await step("verify v2 (новый сайт, гейт не пройден): exit 0, ПРОГНОЗ: OK по тарифу плана «Старт»; ЭКОНОМИКА (warning) - гейт и рекомендация сметы; ЖАРГОН - «Профиль «Активный»» в max.hint", () => {
  const r = runVerify(verifyNewCase("verify-v2-new"));
  if (r.code !== 0) return `exit ${r.code} (гейт - предупреждение, не блок): ${r.stdout}`;
  if (!/ПРОГНОЗ: OK/.test(r.stdout) || !/тариф плана «Старт»/.test(r.stdout)) return `нет «ПРОГНОЗ: OK ... тариф плана «Старт»»: ${r.stdout}`;
  if (!/ЭКОНОМИКА \(warning\)/.test(r.stdout) || !/экономический гейт не пройден/.test(r.stdout)) return `нет предупреждения ЭКОНОМИКА про гейт: ${r.stdout}`;
  if (!/смета рекомендует: start/.test(r.stdout)) return `ЭКОНОМИКА не называет рекомендацию сметы: ${r.stdout}`;
  if (/СОСТАВ ПЛАНА/.test(r.stdout)) return `ложное СОСТАВ ПЛАНА: работы плана из Старта: ${r.stdout}`;
  if (!/ЖАРГОН \(warning\)/.test(r.stdout) || !/max\.hint/.test(r.stdout) || !/Профиль «Активный»/.test(r.stdout)) return `нет ЖАРГОН про профиль Максимума в max.hint: ${r.stdout}`;
  return true;
});

await step("verify v2: СОСТАВ ПЛАНА - по тарифу плана (forecast.plan_tariff): при плане «Старт» работы Роста (FQ, LB) -> предупреждение, exit 0; Карты (YM) при плане «Рост» - без предупреждения", () => {
  const r = runVerify(verifyNewCase("verify-v2-new-plan", (c) => {
    const pi = c.sections[2].blocks.filter((b) => b.type === "plan_item");
    pi[0].services = ["PA", "SY", "FQ"];
    pi[3].services = ["PF", "LB"];
  }));
  if (r.code !== 0) return `exit ${r.code} (expect 0 - предупреждение): ${r.stdout}`;
  if (!/СОСТАВ ПЛАНА \(warning\)/.test(r.stdout)) return `нет СОСТАВ ПЛАНА: ${r.stdout}`;
  for (const id of ["FQ", "LB"]) if (!new RegExp(`${id} нет в составе тарифа плана «Старт»`).test(r.stdout)) return `нет предупреждения про ${id} вне Старта: ${r.stdout}`;
  if (/(PA|SY|PF) нет в составе/.test(r.stdout)) return `ложное предупреждение по работам Старта: ${r.stdout}`;
  // база: тариф плана - Рост, YM в его составе (чистый прогон - без СОСТАВ ПЛАНА, см. первый тест раздела)
  const base = readJsonFile(join(V2_BASE.dir, "forecast.json"));
  if (base.plan_tariff !== "growth" || !base.tariffs.growth.ids.includes("YM") || base.tariffs.start.ids.includes("YM")) return "фикстура: YM должен быть только в тарифе плана базы (Рост)";
  return true;
});

await step("verify v2: упор в потолок / одинаковые тарифы в checks.soft -> ЭКОНОМИКА (warning) «прогноз упирается в потолок / тарифы не различаются» (growth-strategist), exit 0", () => {
  const shape = economicsChecks(computeAll(CAP_FI, capTariffs())).soft.filter((s) => /потолок|одинаков/.test(s));
  if (shape.length < 2) return `фикстура: мягких проверок формы ${shape.length}`;
  const dir = verifyV2Case("verify-v2-cap-soft");
  const f = readJsonFile(join(dir, "forecast.json"));
  f.checks.soft.push(...shape);
  writeJson(join(dir, "forecast.json"), f);
  const r = runVerify(dir);
  if (r.code !== 0) return `exit ${r.code} (expect 0 - предупреждение): ${r.stdout}`;
  if (!/ЭКОНОМИКА \(warning\)/.test(r.stdout) || !/прогноз упирается в потолок \/ тарифы не различаются/.test(r.stdout)) return `нет предупреждения про форму прогноза: ${r.stdout}`;
  if (!/growth-strategist/.test(r.stdout)) return "предупреждение не адресовано growth-strategist";
  if (/экономический гейт не пройден/.test(r.stdout)) return "ложное «гейт не пройден» при пустом checks.hard";
  return true;
});

await step("verify v2: подмена в forecast.json - lost_now.leads_month (прирост плана вместо разрыва), plan_tariff, launch_month -> exit 2, ПРОГНОЗ, чинит оркестратор", () => {
  const cases = [
    ["lost", (f) => { f.lost_now.leads_month = f.tariffs.growth.months[11].leads; }, /lost_now\.leads_month/],
    ["plan", (f) => { f.plan_tariff = "max"; }, /plan_tariff в forecast\.json max != пересчет growth/],
    ["launch", (f) => { f.launch_month = 3; }, /launch_month в forecast\.json 3 != пересчет 1/],
  ];
  for (const [name, patch, re] of cases) {
    const dir = verifyV2Case(`verify-v2-tamper-${name}`);
    const f = readJsonFile(join(dir, "forecast.json"));
    patch(f);
    writeJson(join(dir, "forecast.json"), f);
    const r = runVerify(dir);
    if (r.code !== 2) return `${name}: exit ${r.code} (expect 2): ${r.stdout}`;
    if (!/ПРОГНОЗ \(/.test(r.stdout) || !re.test(r.stdout)) return `${name}: нет нарушения ${re}: ${r.stdout}`;
    if (!/оркестратор: ПРОГНОЗ/.test(r.stdout)) return `${name}: маршрут к оркестратору не напечатан`;
  }
  return true;
});

await step("verify v2: ltv_factor в forecast_inputs изменен после build-forecast -> exit 2, «входы изменились после build-forecast (ltv_factor 1 -> 1.8)»", () => {
  const dir = verifyV2Case("verify-v2-ltv-drift");
  const d = readJsonFile(join(dir, "seo-strategiya_data.json"));
  d.forecast_inputs.economics.ltv_factor = 1.8;
  writeJson(join(dir, "seo-strategiya_data.json"), d);
  const r = runVerify(dir);
  if (r.code !== 2) return `exit ${r.code} (expect 2): ${r.stdout}`;
  if (!/входы изменились после build-forecast/.test(r.stdout) || !/ltv_factor 1 -> 1\.8/.test(r.stdout)) return `нет нарушения про ltv_factor: ${r.stdout}`;
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
