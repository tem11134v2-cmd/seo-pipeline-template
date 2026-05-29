// _client.mjs
// Общий парсер ЗАКАЗЧИК.md для всех скриптов конвейера.
// Импортируется из других .mjs через `import { parseClient } from "./_client.mjs"`.
//
// Назначение: единое место, где знают, как извлечь стандартные поля профиля
// клиента из markdown-таблиц или bullet'ов. Раньше каждый скрипт парсил
// ЗАКАЗЧИК.md по-своему и несогласованно. После 3.11 из roadmap — переходят
// сюда (assemble-html.mjs, build-article-docx.mjs, и др.).
//
// Поддерживаемые форматы ЗАКАЗЧИК.md:
//   - markdown-таблицы вида: | Поле | Значение |
//   - bullet-формат:  - **Поле:** значение
//
// Все функции принимают строку с содержимым ЗАКАЗЧИК.md (или путь к файлу — см. ниже).

import { readFileSync, existsSync } from "node:fs";

// Получить значение поля из таблицы или bullet'а.
// Возвращает "" если не найдено или значение помечено «_не заполнено_».
export function pickField(md, label) {
  // 1) Табличный формат: `| <label> | <value> |`
  const tableRe = new RegExp("\\|\\s*" + escapeReg(label) + "\\s*\\|\\s*([^|\\n]+?)\\s*\\|", "i");
  const tm = md.match(tableRe);
  if (tm) {
    const v = tm[1].trim();
    if (v && !/_не заполнено_/i.test(v)) return v;
  }
  // 2) Bullet-формат: `- **<label>:** <value>` или `- <label>: <value>`
  const bulletRe = new RegExp(
    "(?:^|\\n)[\\-\\*]\\s*\\*\\*?" + escapeReg(label) + "\\*\\*?\\s*:?\\s*([^\\n]+)",
    "i"
  );
  const bm = md.match(bulletRe);
  if (bm) return bm[1].trim();
  return "";
}

// Распарсить ЗАКАЗЧИК.md в объект со стандартными полями.
// Аргумент: либо абсолютный путь к файлу, либо строка-контент.
export function parseClient(input) {
  let md;
  if (typeof input === "string" && existsSync(input)) {
    md = readFileSync(input, "utf8").replace(/^﻿/, "");
  } else {
    md = String(input || "");
  }

  return {
    raw: md,
    // Основное
    domain: pickField(md, "Домен") || "",
    blog_url: pickField(md, "URL блога") || "/blog/",
    region_code: pickField(md, "Код региона JM") || pickField(md, "Регион") || "213",
    platform: pickField(md, "Платформа") || "",
    // Бренд
    brand_name: pickField(md, "Название компании") || "",
    brand_tone: pickField(md, "Тон бренда") || "",
    brand_mention_style: pickField(md, "Как упоминать в статьях") || "",
    stop_words: parseStopWords(md),
    // Автор
    author: pickField(md, "Имя автора") || pickField(md, "Имя") || pickField(md, "Автор") || "Редакция",
    author_role: pickField(md, "Должность автора") || pickField(md, "Должность") || "",
    author_bio: pickField(md, "Био автора") || pickField(md, "Био") || "",
    // Связи
    link_pool: parseLinkPool(md),
    competitors: parseCompetitors(md),
  };
}

// Стоп-слова поддерживают два формата:
//   1) Секция «## Стоп-слова и запреты» (или «## Стоп-слова бренда») с буллет-
//      списком — одно слово на строку: `- люкс`. Строгий формат, рекомендуемый
//      для client-profiler. Поддерживает значения с пробелами («длинное тире»).
//   2) Inline: `| Стоп-слова | люкс, премиум |` или `- **Стоп-слова:** люкс, ...`.
//      Запасной вариант для рукописных ЗАКАЗЧИК.md.
//
// Игнорируется: «_не заполнено_», скобки с пояснениями (всё после первой `(`),
// пустые строки, маркер `- ...` (шаблонная заглушка).
export function parseStopWords(input) {
  const md = typeof input === "string" ? input : "";
  if (!md) return [];

  const words = [];
  const seen = new Set();
  const push = (w) => {
    if (!w) return;
    // Срезаем пояснения в скобках: «люкс (бренд позиционируется...)» → «люкс»
    let clean = w.replace(/\s*\([^)]*\)\s*/g, " ").trim();
    // Срезаем обрамляющие кавычки (прямые "…", типографские «…», ‘…’, “…”)
    clean = clean.replace(/^[«»"'‘’“”„‟]+|[«»"'‘’“”„‟]+$/g, "").trim();
    if (!clean) return;
    if (/^_?не заполнено_?$/i.test(clean)) return;
    if (clean === "..." || clean === "—" || clean === "-") return;
    // Эвристика: стоп-слово — это короткое слово/фраза, не предложение.
    // Отсекаем буллеты с пояснениями («слово1, слово2 — комментарий», «X: что-то»).
    // Длина >40 символов, или 4+ слов, или пунктуация (: ; . — внутри) — не стоп-слово.
    if (clean.length > 40) return;
    if (clean.split(/\s+/).length > 3) return;
    if (/[;:—–]/.test(clean)) return;
    if (/\.[^.]/.test(clean)) return; // точка не в самом конце
    const key = clean.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    words.push(clean);
  };

  // 1. Секционный формат: ищем «## Стоп-слова ...» и читаем буллеты до
  // следующего `## ` (или конца файла).
  const sectionRe = /(?:^|\n)##\s+Стоп-слова[^\n]*\n([\s\S]*?)(?=\n##\s|\n#\s|$)/i;
  const sectionMatch = md.match(sectionRe);
  if (sectionMatch) {
    const lines = sectionMatch[1].split(/\r?\n/);
    for (const line of lines) {
      const m = line.match(/^\s*[-*+]\s+(.+?)\s*$/);
      if (m) push(m[1]);
    }
  }

  // 2. Inline-формат: пробуем pickField (таблица или `- **Стоп-слова:** ...`)
  const inlineRaw =
    pickField(md, "Стоп-слова") ||
    pickField(md, "Стоп-слова (запрещённые)") ||
    pickField(md, "Стоп-слова бренда");
  if (inlineRaw) {
    for (const piece of inlineRaw.split(/[,;]+/)) push(piece);
  }

  return words;
}

// Перелинковка: секция «## Перелинковка» с таблицей `| URL | Анкор | ...`
export function parseLinkPool(md) {
  const sectionRe = /##\s*Перелинковка[^]*?(?=\n##|\n#|$)/i;
  const section = md.match(sectionRe);
  if (!section) return [];
  const rows = section[0].split(/\r?\n/);
  const pool = [];
  for (const row of rows) {
    const cells = row.split("|").map((s) => s.trim()).filter(Boolean);
    if (cells.length < 2) continue;
    // Первая колонка — URL (/path или http://...)
    if (/^(\/|https?:\/\/)[\w\-\/.:?=&%#]+$/.test(cells[0])) {
      pool.push({
        url: cells[0],
        anchor: cells[1] || "",
        notes: cells[2] || "",
      });
    }
  }
  return pool;
}

// Конкуренты: секция «## Конкуренты» — таблица доменов.
export function parseCompetitors(md) {
  const sectionRe = /##\s*Конкуренты[^]*?(?=\n##|\n#|$)/i;
  const section = md.match(sectionRe);
  if (!section) return [];
  const rows = section[0].split(/\r?\n/);
  const comps = [];
  for (const row of rows) {
    const cells = row.split("|").map((s) => s.trim()).filter(Boolean);
    if (cells.length < 1) continue;
    if (/^[a-z0-9][\w.-]*\.[a-z]{2,}$/i.test(cells[0])) {
      comps.push({ domain: cells[0], note: cells[1] || "" });
    }
  }
  return comps;
}

// Краткая выдержка фактов о бренде для финализатора.
export function getBrandFacts(client) {
  const parts = [];
  if (client.brand_name) parts.push(`Бренд: ${client.brand_name}`);
  if (client.brand_tone) parts.push(`Тон: ${client.brand_tone}`);
  if (client.brand_mention_style) parts.push(`Как упоминать: ${client.brand_mention_style}`);
  if (client.author) parts.push(`Автор: ${client.author}${client.author_role ? " (" + client.author_role + ")" : ""}`);
  return parts.join("\n");
}

function escapeReg(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ──────────────────────────────────────────────────────────────────────────
// CLI: `node _client.mjs <command> <path>` — для вызова из bash-хуков.
//
// Команды:
//   --stop-words <path-to-ЗАКАЗЧИК.md>
//        Печатает стоп-слова, по одному на строку. Exit 0 даже если список пуст.
//   --field <label> <path>
//        Печатает значение поля. Пусто, если не найдено.
// ──────────────────────────────────────────────────────────────────────────

const isMain = (() => {
  try {
    const url = new URL(import.meta.url);
    const argv1 = process.argv[1] ? new URL("file://" + process.argv[1].replace(/\\/g, "/")).pathname : "";
    return url.pathname.endsWith(argv1.replace(/^.*[/]/, "/"));
  } catch {
    return false;
  }
})();

if (isMain || process.argv[1]?.endsWith("_client.mjs")) {
  const [, , cmd, ...rest] = process.argv;
  if (cmd === "--stop-words") {
    const path = rest[0];
    if (!path) {
      console.error("usage: _client.mjs --stop-words <path-to-ЗАКАЗЧИК.md>");
      process.exit(1);
    }
    if (!existsSync(path)) process.exit(0);
    const md = readFileSync(path, "utf8").replace(/^﻿/, "");
    for (const w of parseStopWords(md)) console.log(w);
  } else if (cmd === "--field") {
    const [label, path] = rest;
    if (!label || !path) {
      console.error("usage: _client.mjs --field <label> <path>");
      process.exit(1);
    }
    if (!existsSync(path)) process.exit(0);
    const md = readFileSync(path, "utf8").replace(/^﻿/, "");
    const v = pickField(md, label);
    if (v) console.log(v);
  } else if (cmd) {
    console.error(`unknown command: ${cmd}`);
    process.exit(1);
  }
}
