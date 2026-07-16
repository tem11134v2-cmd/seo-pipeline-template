#!/usr/bin/env node
// run.mjs - smoke-тесты для .claude/scripts/verify-strategy.mjs (/seo-strategiya).
// Запуск: .claude\scripts\_node.cmd .claude\tests\seo-strategiya\run.mjs
//
// Проверяет механический гейт стратегии (шаг 6.5а):
//   - чистый контент -> exit 0
//   - цены в прозе тарифов (валюта / круглая тысяча) -> exit 2
//   - секция 6 (декомпозиция с легитимными ₽) НЕ ловится ценовым сканом -> exit 0
//   - стоп-паттерны воды -> exit 2
//   - тире/буква Е-с-точками -> exit 2
//   - нет раздела 4 -> exit 2
//   - битый/отсутствующий JSON -> exit 1
//   - тонкая проза -> exit 0 с предупреждением по объему
//
// Фикстуры синтезируются inline в песочнице .claude/tmp/seo-strategiya-test.
// Exit 0 - все тесты прошли. Exit 1 - есть провал.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { computeScenarioTariff, resolveActiveMonths, interpCheckpoints } from "../../scripts/_forecast-money.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "../../..");
const SANDBOX = join(PROJECT_ROOT, ".claude/tmp/seo-strategiya-test");

// === Мини-фреймворк (по образцу tests/metatags/run.mjs) ===
let passed = 0;
let failed = 0;
const failures = [];

function step(name, fn) {
  try {
    const result = fn();
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

function runVerify(dir) {
  const scriptPath = join(PROJECT_ROOT, ".claude/scripts/verify-strategy.mjs");
  try {
    const stdout = execFileSync("node", [scriptPath, dir], { encoding: "utf8" });
    return { code: 0, stdout };
  } catch (err) {
    return { code: err.status ?? 1, stdout: (err.stdout || "") + (err.stderr || "") };
  }
}

function writeJson(p, obj) {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(obj, null, 2));
}

// === Песочница ===
console.log("=== /seo-strategiya verify-strategy.mjs smoke ===");
console.log(`Sandbox: ${SANDBOX}`);
if (existsSync(SANDBOX)) rmSync(SANDBOX, { recursive: true, force: true });
mkdirSync(SANDBOX, { recursive: true });

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

step("чистый контент -> exit 0", () => {
  const dir = writeContent("clean", cleanContent());
  const r = runVerify(dir);
  if (r.code !== 0) return `exit ${r.code}: ${r.stdout}`;
  return true;
});

// ──────────────────────────────────────────────────────────────────────────
// 2. Цена в прозе тарифа (валюта) -> exit 2
// ──────────────────────────────────────────────────────────────────────────

step("цена с валютой в hint тарифа -> exit 2, ЦЕНЫ + фрагмент", () => {
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

step("круглая тысяча без валюты в services[].description -> exit 2", () => {
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

step("легитимные ₽ и суммы в секции 6 не ловятся ценовым сканом -> exit 0", () => {
  const dir = join(SANDBOX, "clean"); // уже содержит ₽/25 000 ₽ в секции 6 (см. cleanContent)
  const r = runVerify(dir);
  if (r.code !== 0) return `exit ${r.code}: ${r.stdout}`;
  if (/ЦЕНЫ В ПРОЗЕ ТАРИФОВ/.test(r.stdout)) return "ценовой скан сработал на секции 6 (не должен)";
  return true;
});

// ──────────────────────────────────────────────────────────────────────────
// 5. Стоп-паттерн -> exit 2
// ──────────────────────────────────────────────────────────────────────────

step("стоп-паттерн «комплексный подход» в paragraph.text -> exit 2", () => {
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

step("длинное тире в прозе -> exit 2", () => {
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

step("буква Е-с-точками в служебном поле title_page.author -> exit 2", () => {
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

step("нет раздела id=4 -> exit 2, СТРУКТУРА", () => {
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

step("отсутствующий content.json -> exit 1", () => {
  const dir = join(SANDBOX, "missing");
  mkdirSync(dir, { recursive: true });
  const r = runVerify(dir);
  if (r.code !== 1) return `exit ${r.code} (expect 1): ${r.stdout}`;
  return true;
});

step("битый JSON -> exit 1", () => {
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

step("тонкая проза (< 3500 симв.) но чистая -> exit 0, ОБЪЕМ в выводе", () => {
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

console.log("\n=== Юнит-тесты _forecast-money.mjs (этап 8) ===");

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

step("resolveActiveMonths: объект {start,growth,max} -> число по ключу тарифа", () => {
  if (resolveActiveMonths({ start: 3, growth: 4, max: 6 }, "growth") !== 4) return "growth !== 4";
  if (resolveActiveMonths({ start: 3, growth: 4, max: 6 }, "start") !== 3) return "start !== 3";
  if (resolveActiveMonths({ start: 3, growth: 4, max: 6 }, "max") !== 6) return "max !== 6";
  return true;
});

step("resolveActiveMonths: число применяется одинаково к любому тарифу", () => {
  if (resolveActiveMonths(5, "start") !== 5) return `start=${resolveActiveMonths(5, "start")}`;
  if (resolveActiveMonths(5, "growth") !== 5) return `growth=${resolveActiveMonths(5, "growth")}`;
  if (resolveActiveMonths(5, "max") !== 5) return `max=${resolveActiveMonths(5, "max")}`;
  return true;
});

step("resolveActiveMonths: кламп 0 -> 1, 20 -> 12", () => {
  if (resolveActiveMonths(0, "growth") !== 1) return `0 -> ${resolveActiveMonths(0, "growth")}`;
  if (resolveActiveMonths(20, "growth") !== 12) return `20 -> ${resolveActiveMonths(20, "growth")}`;
  return true;
});

step("interpCheckpoints: точное значение в контрольной точке (m6)", () => {
  const v = interpCheckpoints({ m0: 1200, m6: 7000 }, 6);
  if (v !== 7000) return `got ${v} (expect 7000)`;
  return true;
});

step("interpCheckpoints: линейная середина между точками (m3 между m0=1200 и m6=7000)", () => {
  const v = interpCheckpoints({ m0: 1200, m6: 7000 }, 3);
  if (v !== 4100) return `got ${v} (expect 4100)`;
  return true;
});

step('computeScenarioTariff: сценарий "Вход 3-6 мес" (growth, active_months=4) - эталон вручную', () => {
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

step('computeScenarioTariff: сценарий "Год работы" (growth, active_months=12) - эталон вручную', () => {
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

step('Санити: "Год работы" >= "Вход" на m12 (revenue, yearGross)', () => {
  const entry = refEntry();
  const year = refYear();
  if (year.revMonth12 < entry.revMonth12) return `revMonth12 год ${year.revMonth12} < вход ${entry.revMonth12}`;
  if (year.yearGross < entry.yearGross) return `yearGross год ${year.yearGross} < вход ${entry.yearGross}`;
  return true;
});

step('Регресс-ловушка: yearCost "Входа" != onetime+monthly*12 (боевой фикс на месте)', () => {
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

console.log("\n=== Интеграция: build-smeta-xlsx.mjs (сценарный/legacy рендер, этап 8) ===");

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
  const scriptPath = join(PROJECT_ROOT, ".claude/scripts/build-smeta-xlsx.mjs");
  try {
    const stdout = execFileSync("node", [scriptPath, dir], { encoding: "utf8" });
    return { code: 0, stdout };
  } catch (err) {
    return { code: err.status ?? 1, stdout: (err.stdout || "") + (err.stderr || "") };
  }
}

// exceljs - async API; читаем через синхронный спавн отдельного node-скрипта
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
  const out = execFileSync("node", [tmp], { encoding: "utf8" });
  return JSON.parse(out);
}

step("build-smeta-xlsx: сценарный лист - 3 тарифа x 2 сценария, ROMI/окупаемость совпадают с пересчетом", () => {
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

step('build-smeta-xlsx: legacy-формат (decomposition+forecast, без forecast_scenarios) -> старый лист с пометкой "Старый формат"', () => {
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

console.log("\n=== Интеграция: verify-strategy.mjs - СЦЕНАРНАЯ СОГЛАСОВАННОСТЬ (этап 8) ===");

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

step("verify-strategy: чистый forecast_scenarios (2 сценария, cost/ROMI сходятся) -> exit 0, СЦЕНАРНАЯ СОГЛАСОВАННОСТЬ: OK", () => {
  const dir = writeVerifyScenarioFixture("verify-scenario-clean", { forecastScenarios: refForecastScenarios() });
  const r = runVerify(dir);
  if (r.code !== 0) return `exit ${r.code}: ${r.stdout}`;
  if (!/СЦЕНАРНАЯ СОГЛАСОВАННОСТЬ/.test(r.stdout)) return "заголовок СЦЕНАРНАЯ СОГЛАСОВАННОСТЬ не найден";
  if (!/СЦЕНАРНАЯ СОГЛАСОВАННОСТЬ: OK/.test(r.stdout)) return `ожидался "СЦЕНАРНАЯ СОГЛАСОВАННОСТЬ: OK": ${r.stdout}`;
  return true;
});

step('verify-strategy: рассинхрон - recommended-сценарий "Год" с active_months=4 (вместо 12) -> exit 2', () => {
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

step("verify-strategy: немонотонная кривая (checkpoints года убывают) -> exit 2", () => {
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

step('verify-strategy: санити-нарушение - revenue "Года" ниже "Входа" на m12 -> exit 2', () => {
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

step('verify-strategy: legacy-данные (decomposition+forecast, без forecast_scenarios) -> exit 0, "нет (legacy)"', () => {
  const dir = writeVerifyScenarioFixture("verify-scenario-legacy", { legacy: true });
  const r = runVerify(dir);
  if (r.code !== 0) return `exit ${r.code}: ${r.stdout}`;
  if (!/нет forecast_scenarios \(legacy\)/.test(r.stdout)) return `сообщение "нет forecast_scenarios (legacy)" не найдено: ${r.stdout}`;
  return true;
});

// === Итог ===
console.log("");
console.log(`=== ${passed}/${passed + failed} tests passed ===`);
if (failed > 0) {
  for (const f of failures) console.error(`  FAIL: ${f}`);
  process.exit(1);
}
process.exit(0);
