#!/usr/bin/env node
// run.mjs - регрессионный тест build-article-docx.mjs.
//
// Использование:
//   .claude\scripts\_node.cmd .claude\tests\build-article-docx\run.mjs
//
// Что проверяет (главная цель - не дать вернуться багу #1: схлопывание таблиц
// в Google Docs из-за отсутствия фиксированного layout):
//   1. Скрипт собирает docx из фикстуры, exit 0.
//   2. В word/document.xml у КАЖДОЙ таблицы есть <w:tblLayout w:type="fixed"/>.
//   3. Мета-таблица имеет gridCol 1800 и 7838 (узкая label + широкая value).
//   4. Контентная таблица (3 колонки) имеет gridCol = floor(9638/3) = 3212.
//   5. Число <w:tbl> совпадает с ожидаемым (мета + контентная = 2).
//   6. НОВОЕ-A: нумерация фото сквозная (Фото 1, Фото 2), инлайн-метка [ФОТО:]
//      не утекает в текст как литерал (нет "ФОТО" в document.xml).
//
// Exit 0 - всё ок. Exit 1 - хоть один тест упал.

import { existsSync, readFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..", "..", "..");
const sandboxDir = join(projectRoot, ".claude", "tmp", "build-article-docx-test");
const articleDir = join(sandboxDir, "articles", "999-test");
const nodeCmd = join(projectRoot, ".claude", "scripts", "_node.cmd");

let failed = 0;
const results = [];

async function step(name, fn) {
  process.stdout.write(`  [test] ${name} ... `);
  try {
    const r = await fn();
    if (r === true || r === undefined) {
      console.log("PASS");
      results.push({ name, ok: true });
    } else {
      console.log("FAIL");
      console.log("    " + r);
      results.push({ name, ok: false, err: r });
      failed++;
    }
  } catch (e) {
    console.log("ERROR");
    console.log("    " + (e.stack || e.message));
    results.push({ name, ok: false, err: e.message });
    failed++;
  }
}

function runScript(script, ...args) {
  const r = spawnSync(nodeCmd, [join(projectRoot, ".claude", "scripts", script), ...args], {
    cwd: projectRoot,
    encoding: "utf8",
    shell: true,
  });
  return { code: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
}

// === Reset sandbox + фикстура ===
if (existsSync(sandboxDir)) rmSync(sandboxDir, { recursive: true, force: true });
mkdirSync(articleDir, { recursive: true });

const articleMd = `# Тестовый заголовок статьи

Это вводный абзац без заголовка, обычный текст для проверки рендера.

## Первый раздел

Текст первого раздела. Дальше идёт таблица с тремя колонками.

| Колонка А | Колонка Б | Колонка В |
|-----------|-----------|-----------|
| ячейка 1  | ячейка 2  | ячейка 3  |
| ячейка 4  | ячейка 5  | ячейка 6  |

[ФОТО: первое фото в первом разделе]

## Второй раздел

Текст до фото [ФОТО: инлайн фото внутри абзаца] и текст после в том же абзаце.

Заключительный абзац статьи.
`;

const reportMd = `# Отчёт по тестовой статье

## Метатеги
- **Title:** Тестовый Title для проверки
- **Description:** Тестовое описание для проверки метатегов в таблице шапки.
- **Анонс:** Тестовый анонс для превью.
`;

writeFileSync(join(articleDir, "article.md"), articleMd, "utf8");
writeFileSync(join(articleDir, "report.md"), reportMd, "utf8");
writeFileSync(join(articleDir, "meta.json"), JSON.stringify({ slug: "test-article", topic: "Тестовая тема" }, null, 2), "utf8");

console.log("=== build-article-docx regression test ===");
console.log("Sandbox: " + sandboxDir);
console.log("");

let documentXml = "";
// Block F: имя docx теперь Article_<NNN>_<slug>.docx (NNN из basename папки 999-test).
const docxPath = join(articleDir, "Article_999_test-article.docx");

// === Тест 1: сборка ===
await step("build-article-docx.mjs runs, exit 0, docx создан", () => {
  const r = runScript("build-article-docx.mjs", articleDir);
  if (r.code !== 0) return `exit ${r.code}, stderr=${r.stderr.trim()}`;
  if (!existsSync(docxPath)) return "Article_999_test-article.docx не создан (Block F naming)";
  return true;
});

// === Распаковка document.xml ===
await step("распаковка word/document.xml из docx", async () => {
  const zip = await JSZip.loadAsync(readFileSync(docxPath));
  const f = zip.file("word/document.xml");
  if (!f) return "нет word/document.xml внутри docx";
  documentXml = await f.async("string");
  if (!documentXml || documentXml.length < 100) return "document.xml пустой/слишком короткий";
  return true;
});

// === Тест 2 (БАГ #1): каждая таблица имеет fixed layout ===
await step("каждая <w:tbl> имеет <w:tblLayout w:type=\"fixed\"/>", () => {
  const tables = (documentXml.match(/<w:tbl>/g) || []).length;
  const fixed = (documentXml.match(/w:tblLayout w:type="fixed"/g) || []).length;
  if (tables === 0) return "в документе нет таблиц (<w:tbl>)";
  if (fixed !== tables) return `таблиц ${tables}, а fixed-layout ${fixed} (должно совпадать) - вернулся баг #1`;
  return true;
});

await step("число таблиц == 2 (мета + контентная)", () => {
  const tables = (documentXml.match(/<w:tbl>/g) || []).length;
  if (tables !== 2) return `ожидал 2 таблицы, получил ${tables}`;
  return true;
});

// === Тест 3: gridCol мета-таблицы ===
await step("мета-таблица: gridCol 1800 + 7838", () => {
  if (!documentXml.includes('<w:gridCol w:w="1800"')) return "нет gridCol 1800 (узкая label-колонка)";
  if (!documentXml.includes('<w:gridCol w:w="7838"')) return "нет gridCol 7838 (широкая value-колонка)";
  return true;
});

// === Тест 4: gridCol контентной таблицы (3 колонки) ===
await step("контентная таблица: gridCol 3212 (floor(9638/3))", () => {
  const cols = (documentXml.match(/<w:gridCol w:w="3212"/g) || []).length;
  if (cols < 3) return `ожидал >=3 gridCol по 3212, получил ${cols}`;
  return true;
});

// === Тест 5 (НОВОЕ-A): сквозная нумерация фото + инлайн-метка не утекла ===
await step("фото пронумерованы сквозно (Фото 1, Фото 2)", () => {
  // urls.json нет -> обе метки рендерятся как плейсхолдеры "[Фото N: ... - не загрузилось]"
  if (!documentXml.includes("Фото 1")) return "нет плейсхолдера «Фото 1»";
  if (!documentXml.includes("Фото 2")) return "нет плейсхолдера «Фото 2» (сломалась сквозная нумерация)";
  return true;
});

await step("инлайн-метка [ФОТО:] не утекла в текст как литерал", () => {
  // После фикса НОВОЕ-A инлайн-метка превращается в фото-плейсхолдер,
  // а не выводится как сырой текст "[ФОТО: ...]". Плейсхолдер пишется как "Фото" (не "ФОТО").
  if (documentXml.includes("ФОТО")) return "в document.xml осталась сырая метка ФОТО (инлайн не обработан)";
  return true;
});

// === Финал ===
console.log("");
const passed = results.filter((r) => r.ok).length;
console.log(`=== ${passed}/${results.length} tests passed ===`);

if (failed > 0) {
  console.log("");
  console.log("Failed:");
  for (const r of results.filter((r) => !r.ok)) console.log(`  - ${r.name}: ${r.err}`);
  process.exit(1);
}

rmSync(sandboxDir, { recursive: true, force: true });
process.exit(0);
