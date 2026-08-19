#!/usr/bin/env node
// run.mjs - тест КИТА прототипов на узких экранах (рендер-проверка).
// Запуск: .claude\scripts\_node.cmd .claude\tests\kit-mobile\run.mjs
//
// Зачем отдельным набором, а не шагом клиентского конвейера:
//   кит фиксированный и обкатанный - одни и те же фрагменты и один и тот же CSS на каждой
//   странице. Значит горизонтальный скролл, мелкие зоны нажатия и мелкий кегль - свойства
//   КИТА, а не текста конкретной клиентской страницы. Проверять их на каждом клиентском
//   прогоне бессмысленно (результат один и тот же) и дорого: playwright стал бы
//   обязательной зависимостью сборки прототипа. Поэтому проверка живёт здесь и гоняется
//   разработчиком шаблона - после правок фрагментов, prototype.css или тем.
//
// Что делает набор:
//   1. Собирает эталонную страницу кита (manifest.json из 6 типовых фрагментов:
//      hero, cards, steps, pricing, accordion, form) через build-prototype.mjs.
//   2. Гоняет по ней verify-prototype-mobile.mjs на 320/360/390/430 px.
//   3. Канарейка: заведомо сломанная страница обязана ловиться (иначе проверка - пустышка).
//   4. Контракт кодов возврата verify-prototype-mobile.mjs (нет файла -> 1, а не 2).
//
// playwright НЕ обязателен: если его нет, verify-prototype-mobile.mjs выходит с кодом 2,
// и рендер-тесты помечаются SKIP - набор остаётся зелёным и честно печатает, сколько
// проверок пропущено. Ставится так:  npm i -D playwright && npx playwright install chromium
//
// Exit 0 - все тесты прошли (или пропущены). Exit 1 - есть провал.

import { execFileSync } from "node:child_process";
import { writeFileSync, readFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "../../..");
const SANDBOX = join(PROJECT_ROOT, ".claude/tmp/kit-mobile-test");
const BUILD_PROTO = join(PROJECT_ROOT, ".claude/scripts/build-prototype.mjs");
const VERIFY_PROTO = join(PROJECT_ROOT, ".claude/scripts/verify-prototype.mjs");
const VERIFY_MOBILE = join(PROJECT_ROOT, ".claude/scripts/verify-prototype-mobile.mjs");

// === Мини-фреймворк (по образцу tests/batch-queue/run.mjs) ===
let passed = 0;
let failed = 0;
let skipped = 0;
const failures = [];

function step(name, fn) {
  try {
    const result = fn();
    if (result === true || result === undefined) {
      console.log(`  [test] ${name} ... PASS`);
      passed++;
    } else if (typeof result === "string" && result.startsWith("SKIP")) {
      console.log(`  [test] ${name} ... SKIP (${result.slice(4).replace(/^:\s*/, "")})`);
      skipped++;
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

function run(args) {
  try {
    const stdout = execFileSync(process.execPath, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { code: 0, stdout, stderr: "" };
  } catch (err) {
    return { code: err.status ?? 1, stdout: String(err.stdout || ""), stderr: String(err.stderr || "") };
  }
}

// verify-prototype-mobile.mjs: exit 2 = playwright недоступен. Это не провал вёрстки,
// а отсутствие инструмента - переводим в SKIP, а не в FAIL.
const NO_PW = "SKIP: playwright не установлен (npm i -D playwright && npx playwright install chromium)";
const skipIfNoPw = (r) => (r.code === 2 ? NO_PW : null);

// === Фикстура: эталонная страница кита ===
rmSync(SANDBOX, { recursive: true, force: true });
mkdirSync(SANDBOX, { recursive: true });

const dirKit = join(SANDBOX, "kit-page");
mkdirSync(dirKit, { recursive: true });

// 6 типовых фрагментов: первый экран, сетка карточек, этапы, тарифы (вложенный REPEAT),
// аккордеон и форма захвата с select/textarea/мессенджерами - то есть весь набор
// интерактивных элементов кита (кнопки, ссылки-плитки, поля, чекбокс согласия).
const MANIFEST = {
  meta: {
    slug: "kit-mobile",
    title: "Монтаж вентиляции в Казани",
    description: "Проектируем и монтируем вентиляцию под ключ за 14 дней.",
    project: "ВентПро",
    marker: "монтаж вентиляции",
  },
  theme: "wireframe",
  legal: {
    company: "ООО ВентПро",
    inn: "1655000000",
    ogrn: "1021600000000",
    address: "Казань, ул. Проектная, 1",
    email: "info@example.ru",
    phone: "+7 (843) 000-00-00",
  },
  blocks: [
    {
      n: 1,
      type: "Первый экран (Hero)",
      fragment: "hero",
      slots: {
        h1: "Монтаж вентиляции в Казани",
        subhead: "Проектируем, монтируем и сдаем систему под пусконаладку за 14 дней",
        cta_label: "Рассчитать стоимость",
        bonus: "Смету присылаем в день обращения",
        plates: [
          { title: "14 дней", text: "срок монтажа типового объекта" },
          { title: "3 года", text: "гарантия по договору" },
          { title: "120 объектов", text: "сдано с 2015 года" },
        ],
      },
      opts: { arrow: true },
    },
    {
      n: 2,
      type: "Преимущества",
      fragment: "cards",
      h2: "Что вы получаете по договору",
      slots: {
        subhead: "Работаем своим монтажным штатом, без подряда на стороне",
        items: [
          { title: "Смета за один день", text: "Считаем по объекту, а по прайсу только типовые узлы." },
          { title: "Свой монтажный штат", text: "Бригады в штате, график не зависит от загрузки подрядчика." },
          { title: "Пусконаладка", text: "Сдаем систему с замерами и протоколом расходов воздуха." },
        ],
      },
      opts: { cols: 3 },
    },
    {
      n: 3,
      type: "Этапы",
      fragment: "steps",
      h2: "Как проходит работа",
      slots: {
        items: [
          { title: "Замер", text: "Выезжаем на объект и снимаем размеры помещений." },
          { title: "Проект", text: "Готовим схему воздуховодов и подбираем оборудование." },
          { title: "Монтаж", text: "Ставим оборудование и прокладываем трассы." },
          { title: "Сдача", text: "Проводим замеры и передаем протокол заказчику." },
        ],
      },
    },
    {
      n: 4,
      type: "Цены",
      fragment: "pricing",
      h2: "Стоимость работ",
      slots: {
        subhead: "Три формата в зависимости от площади объекта",
        note: "Цена фиксируется в договоре после замера.",
        tariffs: [
          {
            featured: false,
            name: "Квартира",
            tagline: "до 100 кв. м",
            price: "от 180 тыс. руб.",
            price_note: "цена требует утверждения",
            features: ["Проект и подбор оборудования", "Монтаж приточной установки", "Пусконаладка"],
            cta: "Обсудить объект",
          },
          {
            featured: true,
            badge: "Чаще всего берут",
            name: "Офис",
            tagline: "до 500 кв. м",
            price: "от 640 тыс. руб.",
            price_note: "цена требует утверждения",
            features: ["Проект с расчетом воздухообмена", "Монтаж приточно-вытяжной системы", "Автоматика и щит", "Протокол замеров"],
            cta: "Обсудить объект",
          },
          {
            featured: false,
            name: "Производство",
            tagline: "от 500 кв. м",
            price: "от 1,2 млн руб.",
            price_note: "цена требует утверждения",
            features: ["Проект по нормам", "Монтаж и обвязка", "Сдача с протоколом"],
            cta: "Обсудить объект",
          },
        ],
      },
    },
    {
      n: 5,
      type: "Частые вопросы",
      fragment: "accordion",
      h2: "Вопросы перед стартом",
      slots: {
        items: [
          { q: "За какой срок делаете проект?", a: "От трех рабочих дней после замера, зависит от площади." },
          { q: "Кто отвечает за оборудование?", a: "Гарантию на технику дает производитель, на монтаж три года даем мы." },
          { q: "Работаете с юрлицами?", a: "Да, работаем по договору с закрывающими документами." },
        ],
      },
    },
    {
      n: 6,
      type: "Форма захвата",
      fragment: "form",
      h2: "Оставьте заявку на расчет",
      slots: {
        subhead: "Перезваниваем в течение рабочего дня",
        form_title: "Расчет стоимости",
        cta_label: "Отправить заявку",
        form_note: "Заявка ни к чему не обязывает.",
        select_label: "Тип объекта",
        textarea_label: "Задача",
        textarea_placeholder: "Площадь, сроки, что уже сделано",
        tg_url: "https://t.me/example",
        wa_url: "https://wa.me/70000000000",
        bullets: [
          { text: "Смета в день обращения" },
          { text: "Выезд замерщика бесплатный" },
        ],
        select_options: [{ label: "Квартира" }, { label: "Офис" }, { label: "Производство" }],
      },
      opts: { select: true, textarea: true, messengers: true },
    },
  ],
};
writeFileSync(join(dirKit, "manifest.json"), JSON.stringify(MANIFEST, null, 2), "utf8");

// Канарейка: страница с заведомыми дефектами. Нужна, чтобы отличить «кит чистый» от
// «проверка ничего не умеет ловить».
const dirCanary = join(SANDBOX, "canary");
mkdirSync(dirCanary, { recursive: true });
const CANARY_HTML = `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>canary</title>
  <style>
    body { margin: 0; font-family: sans-serif; font-size: 16px; }
    .wide { width: 900px; height: 40px; background: #eee; }
    .tiny { font-size: 9px; }
    .smallbtn { width: 20px; height: 20px; padding: 0; }
    .field { font-size: 12px; }
    .hidden-wide { display: none; width: 3000px; font-size: 4px; }
  </style>
</head>
<body>
  <div class="wide">широкий блок вылезает за экран</div>
  <p class="tiny">мелкий текст на девять пикселей</p>
  <button class="smallbtn">x</button>
  <input class="field" type="text" value="">
  <input type="checkbox">
  <input type="range">
  <div class="hidden-wide">скрытый блок не должен попадать в находки</div>
</body>
</html>
`;
const canaryPath = join(dirCanary, "prototype.html");
writeFileSync(canaryPath, CANARY_HTML, "utf8");

// ──────────────────────────────────────────────────────────────────────────
console.log("=== эталонная страница кита ===");
// ──────────────────────────────────────────────────────────────────────────

step("build-prototype: страница из 6 типовых фрагментов собирается", () => {
  const r = run([BUILD_PROTO, dirKit]);
  if (r.code !== 0) return `exit ${r.code}: ${r.stderr}`;
  if (!existsSync(join(dirKit, "prototype.html"))) return "prototype.html не создан";
  const html = readFileSync(join(dirKit, "prototype.html"), "utf8");
  for (const marker of ["pt-hero", "pt-card", "pt-step", "pt-tariff", "pt-faq", "leadForm"]) {
    if (!html.includes(marker)) return `в собранной странице нет ${marker}`;
  }
  return true;
});

step("verify-prototype (проверка кода): эталонная страница чистая", () => {
  const r = run([VERIFY_PROTO, dirKit]);
  if (r.code !== 0) return `exit ${r.code}: ${r.stdout}`;
  return true;
});

// ──────────────────────────────────────────────────────────────────────────
console.log("");
console.log("=== контракт кодов возврата verify-prototype-mobile ===");
// ──────────────────────────────────────────────────────────────────────────

step("без аргументов -> exit 1 и подсказка с --widths", () => {
  const r = run([VERIFY_MOBILE]);
  if (r.code !== 1) return `exit ${r.code}, ожидался 1`;
  if (!/--widths/.test(r.stdout + r.stderr)) return "в подсказке нет --widths";
  return true;
});

step("нет файла -> exit 1, а не 2 (отсутствие входа это не отсутствие инструмента)", () => {
  const r = run([VERIFY_MOBILE, join(SANDBOX, "no-such-dir")]);
  if (r.code !== 1) return `exit ${r.code}, ожидался 1`;
  return true;
});

// ──────────────────────────────────────────────────────────────────────────
console.log("");
console.log("=== рендер (playwright; без него - SKIP) ===");
// ──────────────────────────────────────────────────────────────────────────

let canaryRun = null;
const canary = () => (canaryRun ||= run([VERIFY_MOBILE, canaryPath, "--widths", "360"]));

let kitRun = null;
const kit = () => (kitRun ||= run([VERIFY_MOBILE, dirKit, "--widths", "320,360,390,430"]));

step("канарейка: сломанная страница ловится (скролл + кегль + зона нажатия + поле)", () => {
  const r = canary();
  const s = skipIfNoPw(r);
  if (s) return s;
  if (r.code !== 1) return `exit ${r.code}, ожидался 1: проверка не увидела заведомых дефектов`;
  for (const [what, re] of [
    ["горизонтальный скролл", /ГОРИЗОНТАЛЬНЫЙ СКРОЛЛ/],
    ["виновник скролла", /виновник: div\.wide/],
    ["мелкий кегль", /КЕГЛЬ/],
    ["зона нажатия", /ЗОНА НАЖАТИЯ/],
    ["поле ввода", /ПОЛЕ ВВОДА/],
  ]) {
    if (!re.test(r.stdout)) return `не поймано: ${what}`;
  }
  return true;
});

step("канарейка: скрытый (display:none) блок в находки не попадает", () => {
  const r = canary();
  const s = skipIfNoPw(r);
  if (s) return s;
  if (/hidden-wide/.test(r.stdout)) return "невидимый элемент дал находку";
  return true;
});

step("кит: нет горизонтального скролла на 320/360/390/430", () => {
  const r = kit();
  const s = skipIfNoPw(r);
  if (s) return s;
  const lines = r.stdout.split("\n").filter((l) => /ГОРИЗОНТАЛЬНЫЙ СКРОЛЛ|виновник:/.test(l));
  if (lines.length) return lines.join(" | ").trim();
  return true;
});

step("кит: кегль не меньше 12px", () => {
  const r = kit();
  const s = skipIfNoPw(r);
  if (s) return s;
  const lines = r.stdout.split("\n").filter((l) => /КЕГЛЬ:/.test(l));
  if (lines.length) return `${lines.length} находок: ${lines.slice(0, 3).map((l) => l.trim()).join(" | ")}`;
  return true;
});

step("кит: зоны нажатия не меньше 42px по стороне", () => {
  const r = kit();
  const s = skipIfNoPw(r);
  if (s) return s;
  const lines = r.stdout.split("\n").filter((l) => /ЗОНА НАЖАТИЯ:/.test(l));
  if (lines.length) return `${lines.length} находок: ${lines.slice(0, 3).map((l) => l.trim()).join(" | ")}`;
  return true;
});

step("кит: поля ввода (кегль 16px, чекбокс 20x20, ползунок 44px)", () => {
  const r = kit();
  const s = skipIfNoPw(r);
  if (s) return s;
  const lines = r.stdout.split("\n").filter((l) => /ПОЛЕ ВВОДА:/.test(l));
  if (lines.length) return `${lines.length} находок: ${lines.slice(0, 3).map((l) => l.trim()).join(" | ")}`;
  return true;
});

// === Итог ===
rmSync(SANDBOX, { recursive: true, force: true });
console.log("");
if (skipped > 0) {
  console.log("  playwright не найден - рендер-проверки пропущены. Это ожидаемое состояние");
  console.log("  на машине без браузеров: набор зелёный, но кит рендером НЕ проверен.");
  console.log("  Включить:  npm i -D playwright && npx playwright install chromium");
  console.log("");
}
console.log(`=== ${passed}/${passed + failed} tests passed, ${skipped} skipped ===`);
if (failed > 0) {
  for (const f of failures) console.error(`  FAIL: ${f}`);
  process.exit(1);
}
process.exit(0);
