#!/usr/bin/env node
// verify-photo-budget.mjs <dir>
// Детерминированная защита (точка 6): число запланированных фото в tz.md должно
// попадать в жанровую вилку, НЕЗАВИСИМО от числа таблиц. Ловит занижение фото,
// когда планировщик ТЗ срезал их «потому что много таблиц». Фото и таблицы - РАЗНЫЕ
// бюджеты (иллюстрация vs данные); таблицы не уменьшают число фото.
//
// Читает <dir>/meta.json (genre) и <dir>/tz.md (метки [ФОТО:]).
// exit 0 - норма (фото >= нижней границы жанра); exit 2 - занижено; exit 1 - нет входных данных.

import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const dir = resolve(process.argv[2] || ".");
const tzPath = join(dir, "tz.md");
const metaPath = join(dir, "meta.json");

if (!existsSync(tzPath)) {
  console.error(`[verify-photo-budget] нет ${tzPath} - нечего проверять`);
  process.exit(1);
}

const meta = existsSync(metaPath)
  ? JSON.parse(readFileSync(metaPath, "utf8").replace(/^﻿/, ""))
  : {};
const genreRaw = String(meta.genre || "");
const genre = genreRaw.toLowerCase();
const tz = readFileSync(tzPath, "utf8");

// Сколько фото запланировано: метки [ФОТО ...] в tz.md.
const photoCount = (tz.match(/\[ФОТО/gi) || []).length;

// Жанр -> нижняя граница вилки (из tz-builder, раздел «Расстановка [ФОТО]»).
// Порядок проверок важен: обзор/подборка раньше услуг (у «обзор услуг» приоритет обзора).
function bandMin(g) {
  if (/обзор|подборк|топ-?\d|\bтипов\b|\d+\s*тип/.test(g)) return 5; // Обзор/Подборка/«N типов»
  if (/гайд|туториал|инструкц/.test(g)) return 4; // Гайд/Туториал
  if (/личн|кейс|опыт|истор/.test(g)) return 3; // Личный опыт/Кейс
  if (/карточк|лендинг|услуг|продукт/.test(g)) return 2; // Карточка услуги/Лендинг
  if (/сравнен|чек-?лист/.test(g)) return 2; // Сравнение/Чек-лист
  return 2; // неизвестный жанр - мягкий минимум (hero + 1)
}
const min = bandMin(genre);

if (photoCount < min) {
  console.error(
    `[verify-photo-budget] EXIT 2: запланировано фото ${photoCount} < минимума жанра «${genreRaw || "?"}» (${min}). ` +
      `Число фото зависит ТОЛЬКО от жанра+объёма; таблицы/диаграммы - ДРУГОЙ бюджет и фото не уменьшают. ` +
      `Добери метки [ФОТО:] минимум до ${min}.`,
  );
  process.exit(2);
}

console.log(
  `[verify-photo-budget] OK: фото ${photoCount} >= минимума ${min} (жанр «${genreRaw || "?"}»)`,
);
process.exit(0);
