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
    stop_words: parseStopWords(pickField(md, "Стоп-слова") || pickField(md, "Стоп-слова (запрещённые)")),
    // Автор
    author: pickField(md, "Имя автора") || pickField(md, "Имя") || pickField(md, "Автор") || "Редакция",
    author_role: pickField(md, "Должность автора") || pickField(md, "Должность") || "",
    author_bio: pickField(md, "Био автора") || pickField(md, "Био") || "",
    // Связи
    link_pool: parseLinkPool(md),
    competitors: parseCompetitors(md),
  };
}

// Стоп-слова: split по запятой, trim, нижний регистр для сравнения.
function parseStopWords(raw) {
  if (!raw || /_не заполнено_/i.test(raw)) return [];
  return raw
    .split(/[,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
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
