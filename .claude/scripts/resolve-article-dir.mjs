#!/usr/bin/env node
// resolve-article-dir.mjs <root> <id>
// Детерминированно резолвит папку задачи по id вместо «взять первую подходящую».
//
// Зачем (ADR-013): после перехода «номер папки = номер темы» NNN больше НЕ уникален -
// у одной темы может быть несколько статей (разные жанры/площадки), все с префиксом <TTT>-.
// Скилы fix-article / rewrite-section / share-article / seo-statya --rebuild-docx
// должны не молча брать первую, а явно разрулить неоднозначность.
//
// id может быть:
//   - полный basename:  005-ukladka-plitki-dko   (точное совпадение, всегда 1)
//   - номер темы:       5  или  005              (может дать несколько кандидатов)
//
// Выход (stdout JSON):
//   { requested, found, ambiguous, dir, candidates: [{dir,name,nnn,topic_id,topic,genre,platform_target,state}] }
//   - found=false              -> папки нет;
//   - found=true, ambiguous=false, dir=<...> -> ровно одна, использовать dir;
//   - found=true, ambiguous=true,  dir=null  -> несколько, показать candidates и уточнить у пользователя.

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const [rootArg, idArg] = process.argv.slice(2);
if (!rootArg || !idArg) {
  console.error("[resolve-article-dir] usage: node resolve-article-dir.mjs <root> <id>");
  process.exit(1);
}
const root = resolve(rootArg);
const id = String(idArg).trim();

function readMeta(dir) {
  const p = join(dir, "meta.json");
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, "utf8").replace(/^﻿/, ""));
  } catch {
    return {};
  }
}

const out = { requested: id, found: false, ambiguous: false, dir: null, candidates: [] };

if (existsSync(root)) {
  const dirs = readdirSync(root).filter((n) => {
    if (n.startsWith("_") || n.startsWith(".")) return false;
    try {
      return statSync(join(root, n)).isDirectory();
    } catch {
      return false;
    }
  });

  // 1) Точное совпадение по полному basename папки.
  let matches = dirs.filter((n) => n === id);

  // 2) Иначе - по числовому номеру темы (с учётом ведущих нулей) или префиксу "<id>-".
  if (matches.length === 0) {
    const isNum = /^\d+$/.test(id);
    const num = isNum ? String(parseInt(id, 10)) : null;
    matches = dirs.filter((n) => {
      const m = n.match(/^(\d{2,4})-/);
      const nnnNum = m ? String(parseInt(m[1], 10)) : null;
      if (num != null && nnnNum === num) return true; // 5 / 005 == папка 005-*
      if (n.startsWith(id + "-")) return true; // префиксное совпадение
      return false;
    });
  }

  out.candidates = matches.map((n) => {
    const meta = readMeta(join(root, n));
    return {
      dir: join(root, n),
      name: n,
      nnn: (n.match(/^(\d{2,4})-/) || [])[1] || null,
      topic_id: meta.topic_id ?? null,
      topic: meta.topic || "",
      genre: meta.genre || "",
      platform_target: meta.platform_target || "",
      state: meta.state || "",
    };
  });

  if (out.candidates.length === 1) {
    out.found = true;
    out.dir = out.candidates[0].dir;
  } else if (out.candidates.length > 1) {
    out.found = true;
    out.ambiguous = true;
  }
}

console.log(JSON.stringify(out));
