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

// === Итог ===
console.log("");
console.log(`=== ${passed}/${passed + failed} tests passed ===`);
if (failed > 0) {
  for (const f of failures) console.error(`  FAIL: ${f}`);
  process.exit(1);
}
process.exit(0);
