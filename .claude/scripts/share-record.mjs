#!/usr/bin/env node
// share-record.mjs
// Запись результата Drive-заливки в share.json задачи - ОДНОЙ схемой и с машинной меткой времени.
//
// Зачем скрипт, а не «оркестратор впишет руками» (боевой прогон 24.08):
//   1. Метку времени заполняли вручную, и она разъезжалась с реальностью - проверить нечем.
//   2. Схема поля разъехалась между документами: SKILL.md описывал {file_id, link, uploaded_at},
//      а /share-tekst писал {drive_file_id, drive_link, shared_at}. Читатели видели то одно,
//      то другое поле и молча считали файл незалитым.
//   Канон один: drive_file_id / drive_link / mime_type / shared_at / revisions[].
//   Старые поля (file_id, link, uploaded_at) читаются как легаси, но больше не пишутся.
//
// Использование:
//   node share-record.mjs <task_dir> <key> --file-id <id> --link <url> [--mime <mime>]
//                         [--revision <тип>] [--note <текст>]
//     <task_dir>   - корень задачи (texts/NNN-slug/, analyses/NNN-slug/ и т.п.)
//     <key>        - поле share.json: prototype | tone_preview | skeletons | analysis | ...
//     --revision   - пометка, что это ПЕРЕзаливка: прежняя запись уходит в revisions[]
//                    с этим типом (manual_redo | skeletons_gate | tekst_fix | tone_revising).
//
// Соседние ключи share.json не трогаются никогда: у задачи несколько независимых файлов.
//
// Exit: 0 ok | 1 ошибка аргументов или записи.

import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const TAG = "[share-record]";
const argv = process.argv.slice(2);

function flag(name) {
  const i = argv.indexOf(name);
  return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : null;
}
function die(msg) {
  console.error(`${TAG} ${msg}`);
  process.exit(1);
}

const taskDirArg = argv[0] && !argv[0].startsWith("--") ? argv[0] : null;
const key = argv[1] && !argv[1].startsWith("--") ? argv[1] : null;
if (!taskDirArg || !key) {
  console.error(`${TAG} usage: node share-record.mjs <task_dir> <key> --file-id <id> --link <url> [--mime <mime>] [--revision <тип>] [--note <текст>]`);
  process.exit(1);
}
const taskDir = resolve(taskDirArg);
if (!existsSync(taskDir) || !statSync(taskDir).isDirectory()) die(`папка задачи не найдена: ${taskDir}`);

const fileId = flag("--file-id");
const link = flag("--link");
const mime = flag("--mime");
const revision = flag("--revision");
const note = flag("--note");

// Пустой ответ аплоада - битая заливка: записать ее в share.json значит соврать, что файл
// у заказчика есть. Проверка здесь, а не глазами оркестратора, ровно поэтому.
if (!fileId || !link) die("нужны непустые --file-id и --link (пустой ответ uploadFile = битая заливка, повтори загрузку)");

const sharePath = join(taskDir, "share.json");
let share = {};
if (existsSync(sharePath)) {
  try {
    share = JSON.parse(readFileSync(sharePath, "utf8").replace(/^﻿/, ""));
  } catch (e) {
    die(`share.json не разобран (${e.message}) - почини файл, чтобы не потерять ссылки соседних файлов`);
  }
}
if (!share || typeof share !== "object" || Array.isArray(share)) share = {};

const now = new Date().toISOString();
const prev = share[key] && typeof share[key] === "object" ? share[key] : null;
const revisions = prev && Array.isArray(prev.revisions) ? prev.revisions.slice() : [];

if (prev && revision) {
  // Прежняя ссылка не выбрасывается: по ней заказчик мог смотреть предыдущую версию,
  // и след «что показывали до этого» - часть истории задачи.
  revisions.push({
    type: revision,
    applied_at: now,
    prev_drive_file_id: prev.drive_file_id || prev.file_id || null,
    prev_drive_link: prev.drive_link || prev.link || null,
    note: note || null,
  });
}

share[key] = {
  drive_file_id: fileId,
  drive_link: link,
  mime_type: mime || (prev && prev.mime_type) || null,
  shared_at: now,
  revisions,
};

writeFileSync(sharePath, JSON.stringify(share, null, 2) + "\n", "utf8");
console.log(`${TAG} share.json: ${key} -> ${link}`);
console.log(`  shared_at: ${now}${revision ? ` (ревизия «${revision}», всего ${revisions.length})` : ""}`);
const others = Object.keys(share).filter((k) => k !== key);
if (others.length) console.log(`  соседние ключи не тронуты: ${others.join(", ")}`);
