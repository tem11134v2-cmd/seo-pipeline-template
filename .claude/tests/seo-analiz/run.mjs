#!/usr/bin/env node
// run.mjs - регрессионный smoke-тест новой машинерии /seo-analiz (Этап 3: интейк, раздел
// «Вопросы к вам», импорт ответов, финальная проверка) + этап A программы v7 (словарь
// rerun_hint v2, новый STAGE_ORDER, tier-aware validate-analysis-inputs - контракты 1.4а/1.6/1.7).
//
// Использование:
//   .claude\scripts\_node.cmd .claude\tests\seo-analiz\run.mjs
//
// Что делает:
//   1. _questions.mjs (Пакет 3, чистый модуль) - юниты без фикстур (динамический импорт).
//   2. apply-answers.mjs (Пакет 3) - интеграция на fixtures/answers_dir/ (детерминированное
//      ядро режима --answers: слияние ответов + rerun_plan.json).
//   3. build-analysis-docx.mjs - рендер раздела «Вопросы к вам» на fixtures/analysis_dir/
//      (смоук + graceful без questions.json + обе формы заголовка раздела: без номера и
//      легаси «0. Вопросы к вам»).
//   4. validate-analysis-inputs.mjs - регрессия на fixtures/validate_dir/ (легаси-путь без
//      meta.json.tier: канон-гейт brief/competitors/serp как раньше, новые файлы Этапа 3 не
//      ломают, легаси-фикстура без них тоже проходит) + tier-aware гейт v2 (контракты
//      1.4а/1.7): basic (fixtures/validate_dir_basic/) без serp.json и Keyso-полей проходит;
//      v2-формат (tier в meta.json) требует непустых brief.directions[] с уникальными
//      dir_slug и audience.json; старый анализ без поля tier валидируется по старым правилам.
//
// Волна 3 (дефекты revising-цикла - того, что срабатывает ПОСЛЕ отдачи документа клиенту):
//   N3. Пробелы (gaps) закрываются по ИДЕНТИФИКАТОРУ, а не регуляркой по тексту. Элемент
//       gaps[] стал объектом { id, text }; строка обязана продолжать работать и нормализуется
//       в { id: null, text } - такой пробел механически не закрывается никогда. У вопроса
//       появилось необязательное closes_gaps: [id]. apply-answers.mjs снимает пробелы сверкой
//       id, без разбора текста. Регрессия, ради которой это затевалось: чистка регулярками
//       дала ПЯТЬ ошибочных снятий из восьми («возврат Тильды» сняло словом «возврат»,
//       «DOR не расшифрован» - словом «DOR»).
//   N2. Запрет на самоназвание - грепабельный список brief.forbidden_self_names[], а не
//       суждение агента: в бою слово «школа» проскочило в служебной прозе («комиссия за счет
//       школы») мимо обоих проходов верификатора, при том что запрет назвать клиента школой
//       стоял в разделе запрещенных формулировок ТОГО ЖЕ отчета. Проверка детерминированная,
//       в validate-analysis-inputs.mjs, по A2.md и recommendations.json.
//
// Устойчивость к параллельной разработке (раздел 8 спеки Этапа 3, Пакеты 2-3 пишутся
// параллельно с этим набором): если .claude/scripts/_questions.mjs или apply-answers.mjs ещё
// не существуют на момент прогона - соответствующие блоки помечаются SKIP (не FAIL), с
// сообщением в вывод. build-analysis-docx.mjs и validate-analysis-inputs.mjs существуют уже
// сейчас (Пакет 3 только правит их) - их тесты выполняются всегда.
//
// Exit 0 - все выполненные тесты (не SKIP) прошли. Exit 1 - хоть один тест упал.

import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, cpSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { inflateRawSync } from "node:zlib";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..", "..", "..");
const fixturesDir = join(__dirname, "fixtures");
const SCRIPTS = join(projectRoot, ".claude", "scripts");
const nodeCmd = join(SCRIPTS, "_node.cmd");
const sandboxRoot = join(projectRoot, ".claude", "tmp", "seo-analiz-test");

const questionsModulePath = join(SCRIPTS, "_questions.mjs");
const applyAnswersPath = join(SCRIPTS, "apply-answers.mjs");
const questionsModuleExists = existsSync(questionsModulePath);
const applyAnswersExists = existsSync(applyAnswersPath);

let failed = 0;
let skipped = 0;
const results = [];

const SKIP = (reason) => ({ __skip: true, reason });

async function step(name, fn) {
  process.stdout.write(`  [test] ${name} ... `);
  try {
    const r = await fn();
    if (r && typeof r === "object" && r.__skip) {
      console.log("SKIP");
      console.log("    " + r.reason);
      results.push({ name, ok: true, skipped: true });
      skipped++;
      return;
    }
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
  const r = spawnSync(nodeCmd, [join(SCRIPTS, script), ...args], {
    cwd: projectRoot,
    encoding: "utf8",
    shell: true,
  });
  return { code: r.status, stdout: r.stdout || "", stderr: r.stderr || "" };
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8").replace(/^﻿/, ""));
}
function writeJson(path, obj) {
  writeFileSync(path, JSON.stringify(obj, null, 2));
}

function freshDir(dir, fixtureSubdir) {
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  cpSync(join(fixturesDir, fixtureSubdir), dir, { recursive: true });
  return dir;
}

// docx - это zip; читаем его средствами node (zlib), без внешних процессов и временных копий.
// Достаем ровно одну запись из центрального каталога; ZIP64 тут не нужен - документы мелкие.
// (тот же прием, что в .claude/tests/seo-tekst/run.mjs)
function zipEntry(buf, name) {
  let eocd = -1;
  const floor = Math.max(0, buf.length - 22 - 65535);
  for (let i = buf.length - 22; i >= floor; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("не найден конец zip-каталога - файл поврежден или это не docx");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("битая запись центрального каталога zip");
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28);
    const elen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const lho = buf.readUInt32LE(p + 42);
    if (buf.toString("utf8", p + 46, p + 46 + nlen) === name) {
      if (buf.readUInt32LE(lho) !== 0x04034b50) throw new Error("битый локальный заголовок zip");
      const start = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
      const data = buf.subarray(start, start + csize);
      if (method === 0) return data;
      if (method === 8) return inflateRawSync(data);
      throw new Error(`неизвестный метод сжатия zip: ${method}`);
    }
    p += 46 + nlen + elen + clen;
  }
  throw new Error(`в docx нет записи ${name}`);
}

// Плоский текст docx: все <w:t> подряд. Хватает, чтобы отличить цветной рендер вопросов
// из questions.json от markdown-дубликата того же раздела.
function docxText(docxPath) {
  const xml = zipEntry(readFileSync(docxPath), "word/document.xml").toString("utf8");
  return (xml.match(/<w:t[^>]*>[^<]*<\/w:t>/g) || []).map((t) => t.replace(/<[^>]+>/g, "")).join("\n");
}

// === Reset sandbox root ===
if (existsSync(sandboxRoot)) rmSync(sandboxRoot, { recursive: true, force: true });
mkdirSync(sandboxRoot, { recursive: true });

console.log("=== /seo-analiz (Этап 3) scripts smoke ===");
console.log("Sandbox: " + sandboxRoot);
console.log("");

// ═══════════════════════════════════════════════════════════════════════════
// Блок 1: _questions.mjs - юниты (без фикстур, динамический импорт)
// ═══════════════════════════════════════════════════════════════════════════
console.log("=== _questions.mjs (Пакет 3) ===");

let Q = null;
if (questionsModuleExists) {
  Q = await import(pathToFileURL(questionsModulePath).href);
} else {
  await step("_questions.mjs юниты", () =>
    SKIP("файл .claude/scripts/_questions.mjs ещё не создан (Пакет 3 в процессе) - пропускаю юниты этого блока")
  );
}

function makeValidQuestion(overrides = {}) {
  return {
    id: "q1",
    question: "В каком регионе продвигаемся в первую очередь?",
    options: ["а) Москва и область", "б) Вся Россия", "в) свой вариант: ___"],
    recommended: "а",
    recommended_note: "По данным сайта основной спрос из Москвы.",
    answer: null,
    source_gap: "intake.conflict:гео",
    rerun_hint: "brief",
    ...overrides,
  };
}
function makeValidQuestionsObj(questions) {
  return { questions, free_comments: [], answers_source: null, answers_imported_at: null };
}

if (Q) {
  await step("validateQuestionsSchema: валидный questions.json (3 вопроса) -> []", () => {
    const obj = makeValidQuestionsObj([
      makeValidQuestion({ id: "q1" }),
      makeValidQuestion({ id: "q2", rerun_hint: "writer" }),
      makeValidQuestion({ id: "q3", rerun_hint: "serp" }),
    ]);
    const problems = Q.validateQuestionsSchema(obj);
    if (!Array.isArray(problems)) return `ожидал массив, получил ${typeof problems}`;
    if (problems.length) return `ожидал [], получил: ${JSON.stringify(problems)}`;
    return true;
  });

  await step("validateQuestionsSchema: без options -> непустой список", () => {
    const q = makeValidQuestion();
    delete q.options;
    const problems = Q.validateQuestionsSchema(makeValidQuestionsObj([q, makeValidQuestion({ id: "q2" }), makeValidQuestion({ id: "q3" })]));
    if (!problems.length) return "ожидал непустой список проблем при отсутствии options";
    return true;
  });

  await step("validateQuestionsSchema: options из 1 варианта (<2) -> непустой список", () => {
    const q = makeValidQuestion({ options: ["а) единственный вариант"] });
    const problems = Q.validateQuestionsSchema(makeValidQuestionsObj([q, makeValidQuestion({ id: "q2" }), makeValidQuestion({ id: "q3" })]));
    if (!problems.length) return "ожидал непустой список проблем при options.length < 2";
    return true;
  });

  await step("validateQuestionsSchema: без recommended -> непустой список", () => {
    const q = makeValidQuestion();
    delete q.recommended;
    const problems = Q.validateQuestionsSchema(makeValidQuestionsObj([q, makeValidQuestion({ id: "q2" }), makeValidQuestion({ id: "q3" })]));
    if (!problems.length) return "ожидал непустой список проблем при отсутствии recommended";
    return true;
  });

  await step("validateQuestionsSchema: без ключа answer -> непустой список", () => {
    const q = makeValidQuestion();
    delete q.answer;
    const problems = Q.validateQuestionsSchema(makeValidQuestionsObj([q, makeValidQuestion({ id: "q2" }), makeValidQuestion({ id: "q3" })]));
    if (!problems.length) return "ожидал непустой список проблем при отсутствии ключа answer";
    return true;
  });

  await step("validateQuestionsSchema: без source_gap -> непустой список", () => {
    const q = makeValidQuestion({ source_gap: "" });
    const problems = Q.validateQuestionsSchema(makeValidQuestionsObj([q, makeValidQuestion({ id: "q2" }), makeValidQuestion({ id: "q3" })]));
    if (!problems.length) return "ожидал непустой список проблем при пустом source_gap";
    return true;
  });

  await step("validateQuestionsSchema: rerun_hint вне допустимого множества -> непустой список", () => {
    const q = makeValidQuestion({ rerun_hint: "something-else" });
    const problems = Q.validateQuestionsSchema(makeValidQuestionsObj([q, makeValidQuestion({ id: "q2" }), makeValidQuestion({ id: "q3" })]));
    if (!problems.length) return "ожидал непустой список проблем при недопустимом rerun_hint";
    return true;
  });

  await step("ALLOWED_RERUN_HINTS: точный словарь v2 (контракт 1.6, set-эквивалентность)", () => {
    const canon = ["intake", "brief", "audience", "competitors", "leaders", "directions", "serp", "writer", "edit"];
    const got = Q.ALLOWED_RERUN_HINTS;
    if (!Array.isArray(got)) return `ALLOWED_RERUN_HINTS не массив: ${typeof got}`;
    const missing = canon.filter((v) => !got.includes(v));
    const extra = got.filter((v) => !canon.includes(v));
    if (missing.length || extra.length) {
      return `расхождение со словарем v2: missing=${JSON.stringify(missing)}, extra=${JSON.stringify(extra)}`;
    }
    return true;
  });

  await step("STAGE_ORDER: канон-ступени v2 в порядке downstream-цепочки intake -> ... -> edit", () => {
    const chain = ["intake", "brief", "audience", "competitors", "leaders", "directions", "serp", "writer", "edit"];
    const order = Q.STAGE_ORDER;
    if (!Array.isArray(order)) return `STAGE_ORDER не массив: ${typeof order}`;
    const missing = chain.filter((s) => !order.includes(s));
    if (missing.length) return `в STAGE_ORDER нет ступеней: ${missing.join(", ")}`;
    for (let i = 1; i < chain.length; i++) {
      const prev = order.indexOf(chain[i - 1]);
      const cur = order.indexOf(chain[i]);
      if (cur <= prev) return `порядок нарушен: «${chain[i - 1]}» (index ${prev}) должен быть глубже «${chain[i]}» (index ${cur})`;
    }
    return true;
  });

  await step("validateQuestionsSchema: новые rerun_hint v2 (intake/audience/directions) валидны", () => {
    const obj = makeValidQuestionsObj([
      makeValidQuestion({ id: "q1", rerun_hint: "intake" }),
      makeValidQuestion({ id: "q2", rerun_hint: "audience" }),
      makeValidQuestion({ id: "q3", rerun_hint: "directions" }),
    ]);
    const problems = Q.validateQuestionsSchema(obj);
    if (problems.length) return `ожидал [], получил: ${JSON.stringify(problems)}`;
    return true;
  });

  await step("validateQuestionsSchema: N=2 (вне 3-7), иначе валидно -> только мягкий warn, не блокирующая проблема", () => {
    const obj = makeValidQuestionsObj([makeValidQuestion({ id: "q1" }), makeValidQuestion({ id: "q2" })]);
    const problems = Q.validateQuestionsSchema(obj);
    const isBlocking = typeof Q.isBlockingProblem === "function" ? Q.isBlockingProblem : (p) => !String(p).startsWith("warn:");
    const blocking = problems.filter(isBlocking);
    if (blocking.length) return `N=2 вне диапазона 3-7 не должен блокировать (это warn, не проблема): ${JSON.stringify(blocking)}`;
    return true;
  });

  await step("isBlockingProblem: отличает warn-строку от блокирующей проблемы", () => {
    if (typeof Q.isBlockingProblem !== "function") return SKIP("isBlockingProblem не экспортирован - опционален по контракту");
    if (Q.isBlockingProblem("warn: вопросов 2 (рекомендовано 3-7) - не блокирует") !== false) return "warn-строка не должна быть блокирующей";
    if (Q.isBlockingProblem("questions[0]: нет/пустое «id»") !== true) return "обычная проблема должна быть блокирующей";
    return true;
  });

  await step('optionMatchesRecommended("а) Москва и область", "а") -> true', () => {
    if (Q.optionMatchesRecommended("а) Москва и область", "а") !== true) return "ожидал true";
    return true;
  });

  await step('optionMatchesRecommended("б) Вся Россия", "а") -> false', () => {
    if (Q.optionMatchesRecommended("б) Вся Россия", "а") !== false) return "ожидал false";
    return true;
  });

  await step('isAgreeAnswer("согласен с рекомендованным") -> true', () => {
    if (Q.isAgreeAnswer("согласен с рекомендованным") !== true) return "ожидал true";
    return true;
  });

  await step('isAgreeAnswer("как рекомендуете") -> true', () => {
    if (Q.isAgreeAnswer("как рекомендуете") !== true) return "ожидал true";
    return true;
  });

  await step('isAgreeAnswer("б) вся Россия") -> false', () => {
    if (Q.isAgreeAnswer("б) вся Россия") !== false) return "ожидал false";
    return true;
  });

  await step("classifyAnswer: answer == recommended -> as_recommended / rerun none", () => {
    const q = makeValidQuestion({ recommended: "а", rerun_hint: "brief" });
    const r = Q.classifyAnswer(q, "а");
    if (r.decision !== "as_recommended") return `decision=${r.decision}, ожидал as_recommended`;
    if (r.rerun !== "none") return `rerun=${r.rerun}, ожидал none`;
    return true;
  });

  await step("classifyAnswer: isAgreeAnswer -> as_recommended / rerun none", () => {
    const q = makeValidQuestion({ recommended: "а", rerun_hint: "brief" });
    const r = Q.classifyAnswer(q, "согласен с рекомендованным");
    if (r.decision !== "as_recommended") return `decision=${r.decision}, ожидал as_recommended`;
    if (r.rerun !== "none") return `rerun=${r.rerun}, ожидал none`;
    return true;
  });

  await step("classifyAnswer: расхождение с recommended -> diverged / rerun = rerun_hint", () => {
    const q = makeValidQuestion({ recommended: "а", rerun_hint: "brief" });
    const r = Q.classifyAnswer(q, "б");
    if (r.decision !== "diverged") return `decision=${r.decision}, ожидал diverged`;
    if (r.rerun !== "brief") return `rerun=${r.rerun}, ожидал brief (question.rerun_hint)`;
    return true;
  });

  await step("classifyAnswer: пустой/null ответ -> unanswered / rerun none", () => {
    const q = makeValidQuestion();
    const r1 = Q.classifyAnswer(q, null);
    const r2 = Q.classifyAnswer(q, "");
    if (r1.decision !== "unanswered" || r1.rerun !== "none") return `null: decision=${r1.decision}, rerun=${r1.rerun}`;
    if (r2.decision !== "unanswered" || r2.rerun !== "none") return `"": decision=${r2.decision}, rerun=${r2.rerun}`;
    return true;
  });

  await step('deepestStage(["writer", "brief"]) -> "brief"', () => {
    const r = Q.deepestStage(["writer", "brief"]);
    if (r !== "brief") return `получил "${r}"`;
    return true;
  });

  await step('deepestStage(["writer", "edit"]) -> "writer"', () => {
    const r = Q.deepestStage(["writer", "edit"]);
    if (r !== "writer") return `получил "${r}"`;
    return true;
  });

  await step('deepestStage([]) -> "none"', () => {
    const r = Q.deepestStage([]);
    if (r !== "none") return `получил "${r}"`;
    return true;
  });

  await step('deepestStage(["audience", "intake"]) -> "intake" (новая ступень v2 глубже всех)', () => {
    const r = Q.deepestStage(["audience", "intake"]);
    if (r !== "intake") return `получил "${r}"`;
    return true;
  });

  await step('deepestStage(["serp", "directions"]) -> "directions" (directions глубже serp)', () => {
    const r = Q.deepestStage(["serp", "directions"]);
    if (r !== "directions") return `получил "${r}"`;
    return true;
  });

  await step('deepestStage(["leaders", "audience"]) -> "audience" (audience глубже leaders)', () => {
    const r = Q.deepestStage(["leaders", "audience"]);
    if (r !== "audience") return `получил "${r}"`;
    return true;
  });

  await step("questionsToRows: N строк, recommended и options на месте", () => {
    const questions = [
      makeValidQuestion({ id: "q1", recommended: "а" }),
      makeValidQuestion({ id: "q2", recommended: "б" }),
    ];
    const rows = Q.questionsToRows(questions);
    if (!Array.isArray(rows) || rows.length !== 2) return `ожидал 2 строки, получил ${rows && rows.length}`;
    if (rows[0].recommended !== "а") return `rows[0].recommended="${rows[0].recommended}", ожидал "а"`;
    if (rows[1].recommended !== "б") return `rows[1].recommended="${rows[1].recommended}", ожидал "б"`;
    if (!Array.isArray(rows[0].options) || rows[0].options.length !== 3) return `rows[0].options не сохранены (${JSON.stringify(rows[0].options)})`;
    return true;
  });

  // --- Волна 3, N3: форма пробела и closes_gaps (юниты чистого модуля) ---

  await step("normalizeGap: канон-объект { id, text } -> тот же id и текст (id триммится)", () => {
    const g = Q.normalizeGap({ id: "  gap-inn  ", text: "requisites: ИНН - ни один источник не называет" });
    if (g.id !== "gap-inn") return `id="${g.id}", ожидал "gap-inn"`;
    if (!g.text.startsWith("requisites: ИНН")) return `text="${g.text}"`;
    return true;
  });

  await step("normalizeGap: легаси-СТРОКА -> { id: null, text } (обратная совместимость обязательна)", () => {
    const g = Q.normalizeGap("не выяснено, как описывать формат обучения без лицензии");
    if (g.id !== null) return `id="${g.id}", ожидал null (у строкового пробела id нет)`;
    if (g.text !== "не выяснено, как описывать формат обучения без лицензии") return `text="${g.text}"`;
    return true;
  });

  await step("normalizeGap: объект без id (легаси-объект) -> id null, текст сохранен", () => {
    const g = Q.normalizeGap({ text: "гарантии не обсуждались" });
    if (g.id !== null) return `id="${g.id}", ожидал null`;
    if (g.text !== "гарантии не обсуждались") return `text="${g.text}"`;
    return true;
  });

  await step("normalizeGaps: смешанный массив (строки + объекты) нормализуется поштучно; не-массив -> []", () => {
    const gaps = Q.normalizeGaps(["легаси-строка", { id: "gap-guarantee", text: "гарантии" }]);
    if (gaps.length !== 2) return `ожидал 2 элемента, получил ${gaps.length}`;
    if (gaps[0].id !== null || gaps[0].text !== "легаси-строка") return `элемент 0: ${JSON.stringify(gaps[0])}`;
    if (gaps[1].id !== "gap-guarantee") return `элемент 1: ${JSON.stringify(gaps[1])}`;
    if (Q.normalizeGaps(undefined).length !== 0) return "не-массив должен давать []";
    return true;
  });

  await step("questionClosesGaps: нет поля -> []; мусорные элементы отброшены, id триммится", () => {
    const none = Q.questionClosesGaps(makeValidQuestion());
    if (!Array.isArray(none) || none.length !== 0) return `без поля ожидал [], получил ${JSON.stringify(none)}`;
    const got = Q.questionClosesGaps(makeValidQuestion({ closes_gaps: ["  gap-geo  ", "", null, "gap-inn"] }));
    if (JSON.stringify(got) !== JSON.stringify(["gap-geo", "gap-inn"])) return `получил ${JSON.stringify(got)}`;
    return true;
  });

  await step("validateQuestionsSchema: closes_gaps ОТСУТСТВУЕТ -> [] (легаси-questions.json валиден)", () => {
    const obj = makeValidQuestionsObj([
      makeValidQuestion({ id: "q1" }),
      makeValidQuestion({ id: "q2" }),
      makeValidQuestion({ id: "q3" }),
    ]);
    const problems = Q.validateQuestionsSchema(obj);
    if (problems.length) return `ожидал [], получил: ${JSON.stringify(problems)}`;
    return true;
  });

  await step("validateQuestionsSchema: closes_gaps: [] -> [] (вопрос, который ничего не закрывает - норма)", () => {
    const obj = makeValidQuestionsObj([
      makeValidQuestion({ id: "q1", closes_gaps: [] }),
      makeValidQuestion({ id: "q2", closes_gaps: ["gap-geo"] }),
      makeValidQuestion({ id: "q3", closes_gaps: ["gap-inn", "gap-ogrn"] }),
    ]);
    const problems = Q.validateQuestionsSchema(obj);
    if (problems.length) return `ожидал [], получил: ${JSON.stringify(problems)}`;
    return true;
  });

  await step("validateQuestionsSchema: closes_gaps - строка вместо массива -> блокирующая проблема", () => {
    const obj = makeValidQuestionsObj([
      makeValidQuestion({ id: "q1", closes_gaps: "gap-geo" }),
      makeValidQuestion({ id: "q2" }),
      makeValidQuestion({ id: "q3" }),
    ]);
    const blocking = Q.validateQuestionsSchema(obj).filter(Q.isBlockingProblem);
    if (!blocking.length) return "ожидал блокирующую проблему на closes_gaps не-массиве";
    if (!blocking.some((p) => p.includes("closes_gaps"))) return `проблема не про closes_gaps: ${JSON.stringify(blocking)}`;
    return true;
  });

  await step("validateQuestionsSchema: closes_gaps с пустым элементом -> блокирующая проблема с индексом", () => {
    const obj = makeValidQuestionsObj([
      makeValidQuestion({ id: "q1", closes_gaps: ["gap-geo", "  "] }),
      makeValidQuestion({ id: "q2" }),
      makeValidQuestion({ id: "q3" }),
    ]);
    const blocking = Q.validateQuestionsSchema(obj).filter(Q.isBlockingProblem);
    if (!blocking.some((p) => p.includes("closes_gaps[1]"))) {
      return `ожидал проблему про closes_gaps[1], получил: ${JSON.stringify(blocking)}`;
    }
    return true;
  });

  // Осознанная граница контракта: _questions.mjs - ЧИСТЫЙ модуль, он не читает ни intake.json,
  // ни brief.json, значит множества живых id пробелов не видит и сверить с ним closes_gaps не
  // может. Ссылку на несуществующий пробел ловит apply-answers.mjs - он читает оба файла и
  // печатает предупреждение (тест «неизвестный id -> предупреждение» ниже в блоке 2). Здесь
  // фиксируем ровно это разделение: форма поля валидна, значит схема молчит.
  await step("validateQuestionsSchema: closes_gaps с НЕСУЩЕСТВУЮЩИМ id -> не блокирует (ловит apply-answers, не схема)", () => {
    const obj = makeValidQuestionsObj([
      makeValidQuestion({ id: "q1", closes_gaps: ["gap-этого-пробела-нет"] }),
      makeValidQuestion({ id: "q2" }),
      makeValidQuestion({ id: "q3" }),
    ]);
    const blocking = Q.validateQuestionsSchema(obj).filter(Q.isBlockingProblem);
    if (blocking.length) return `чистый модуль не видит пробелов и блокировать не должен: ${JSON.stringify(blocking)}`;
    return true;
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Блок 2: apply-answers.mjs - интеграция (детерминированное ядро --answers)
// ═══════════════════════════════════════════════════════════════════════════
console.log("");
console.log("=== apply-answers.mjs (Пакет 3) ===");

if (!applyAnswersExists) {
  await step("apply-answers.mjs интеграция", () =>
    SKIP("файл .claude/scripts/apply-answers.mjs ещё не создан (Пакет 3 в процессе) - пропускаю весь блок")
  );
} else {
  const answersDir = join(sandboxRoot, "answers_dir");

  await step("apply-answers.mjs: базовый прогон -> exit 0", () => {
    freshDir(answersDir, "answers_dir");
    const r = runScript("apply-answers.mjs", answersDir, "--source", "google-doc");
    if (r.code !== 0) return `exit ${r.code}, stdout=${r.stdout.trim()}, stderr=${r.stderr.trim()}`;
    if (!existsSync(join(answersDir, "rerun_plan.json"))) return "rerun_plan.json не создан";
    return true;
  });

  await step("apply-answers.mjs: questions.json.answers заполнены + answers_source/answers_imported_at проставлены", () => {
    const qj = readJson(join(answersDir, "questions.json"));
    const q1 = qj.questions.find((q) => q.id === "q1");
    const q2 = qj.questions.find((q) => q.id === "q2");
    if (!q1 || q1.answer == null) return `q1.answer не заполнен: ${JSON.stringify(q1)}`;
    if (!q2 || q2.answer == null) return `q2.answer не заполнен: ${JSON.stringify(q2)}`;
    if (qj.answers_source !== "google-doc") return `answers_source="${qj.answers_source}", ожидал "google-doc"`;
    if (!qj.answers_imported_at) return "answers_imported_at не проставлен";
    if (!Array.isArray(qj.free_comments) || qj.free_comments.length !== 1) return `free_comments не перенесены: ${JSON.stringify(qj.free_comments)}`;
    return true;
  });

  await step("apply-answers.mjs: rerun_plan.json - согласие q1 -> none, расхождение q2 -> brief", () => {
    const plan = readJson(join(answersDir, "rerun_plan.json"));
    const pq1 = plan.per_question.find((p) => p.id === "q1");
    const pq2 = plan.per_question.find((p) => p.id === "q2");
    const pq3 = plan.per_question.find((p) => p.id === "q3");
    if (!pq1 || pq1.decision !== "as_recommended" || pq1.rerun !== "none") return `q1: ${JSON.stringify(pq1)}`;
    if (!pq2 || pq2.decision !== "diverged" || pq2.rerun !== "brief") return `q2: ${JSON.stringify(pq2)}`;
    if (!pq3 || pq3.decision !== "unanswered" || pq3.rerun !== "none") return `q3 (не отвечен в фикстуре): ${JSON.stringify(pq3)}`;
    if (!plan.buckets.includes("brief")) return `buckets не содержит "brief": ${JSON.stringify(plan.buckets)}`;
    if (plan.deepest_stage !== "brief") return `deepest_stage="${plan.deepest_stage}", ожидал "brief"`;
    if (plan.free_comments_count !== 1) return `free_comments_count=${plan.free_comments_count}, ожидал 1`;
    return true;
  });

  await step("apply-answers.mjs: все согласны + свободный комментарий -> deepest_stage == edit", () => {
    freshDir(answersDir, "answers_dir");
    // Отвечаем на все вопросы согласием (as_recommended/unanswered), но оставляем free_comment.
    const answers = readJson(join(answersDir, "answers.json"));
    answers.answers = [
      { id: "q1", answer: "согласен с рекомендованным", verbatim: "ок" },
      { id: "q2", answer: "б", verbatim: "хорошо, оставим осторожно" }, // "б" == recommended для q2
    ];
    writeJson(join(answersDir, "answers.json"), answers);
    const r = runScript("apply-answers.mjs", answersDir, "--source", "chat");
    if (r.code !== 0) return `exit ${r.code}, stdout=${r.stdout.trim()}, stderr=${r.stderr.trim()}`;
    const plan = readJson(join(answersDir, "rerun_plan.json"));
    if (plan.deepest_stage !== "edit") return `deepest_stage="${plan.deepest_stage}", ожидал "edit" (все as_recommended/unanswered + free_comment)`;
    return true;
  });

  await step("apply-answers.mjs: расхождение по q4 (rerun_hint=audience, словарь v2) -> bucket audience, deepest_stage == audience", () => {
    freshDir(answersDir, "answers_dir");
    const answers = readJson(join(answersDir, "answers.json"));
    answers.answers = [
      { id: "q1", answer: "согласен с рекомендованным", verbatim: "ок" },
      { id: "q4", answer: "б", verbatim: "нет, у нас в основном b2b" }, // recommended для q4 - "а"
    ];
    answers.free_comments = [];
    writeJson(join(answersDir, "answers.json"), answers);
    const r = runScript("apply-answers.mjs", answersDir, "--source", "chat");
    if (r.code !== 0) return `exit ${r.code} (новый rerun_hint «audience» не должен блокировать схему), stdout=${r.stdout.trim()}, stderr=${r.stderr.trim()}`;
    const plan = readJson(join(answersDir, "rerun_plan.json"));
    const pq4 = plan.per_question.find((p) => p.id === "q4");
    if (!pq4 || pq4.decision !== "diverged" || pq4.rerun !== "audience") return `q4: ${JSON.stringify(pq4)}`;
    if (!plan.buckets.includes("audience")) return `buckets не содержит "audience": ${JSON.stringify(plan.buckets)}`;
    if (plan.deepest_stage !== "audience") return `deepest_stage="${plan.deepest_stage}", ожидал "audience"`;
    return true;
  });

  await step("apply-answers.mjs: битый questions.json (нет recommended) -> exit 2", () => {
    freshDir(answersDir, "answers_dir");
    const qj = readJson(join(answersDir, "questions.json"));
    delete qj.questions[0].recommended;
    writeJson(join(answersDir, "questions.json"), qj);
    const r = runScript("apply-answers.mjs", answersDir, "--source", "google-doc");
    if (r.code !== 2) return `expected exit 2, got ${r.code}, stdout=${r.stdout.trim()}, stderr=${r.stderr.trim()}`;
    return true;
  });

  await step("apply-answers.mjs: нет answers.json -> exit 1 (ошибка запуска)", () => {
    freshDir(answersDir, "answers_dir");
    rmSync(join(answersDir, "answers.json"));
    const r = runScript("apply-answers.mjs", answersDir, "--source", "google-doc");
    if (r.code !== 1) return `expected exit 1, got ${r.code}, stdout=${r.stdout.trim()}, stderr=${r.stderr.trim()}`;
    return true;
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Волна 3, N3: механическое снятие пробелов по closes_gaps.
  //
  // Тот самый регресс, ради которого все затевалось: чистка пробелов регулярками по их
  // ТЕКСТУ дала пять ошибочных снятий из восьми. Единственный допустимый механизм -
  // сверка идентификаторов. Ниже проверяется и обратная сторона: у легаси-пробела
  // (строка без id) идентификатора нет, значит механически он не снимается НИКОГДА.
  //
  // Фикстура answers_dir/ intake.json и brief.json не содержит (оба файла для скрипта
  // опциональны) - раскладываем их прямо в песочнице, чтобы не менять поведение уже
  // существующих тестов блока.
  // В фикстуре отвечены только q1 (согласие) и q2 (расхождение); q3 и q4 остаются без
  // ответа - на них и проверяется, что неотвеченный вопрос ничего не закрывает.
  // ─────────────────────────────────────────────────────────────────────────

  const GAP_GEO = { id: "gap-geo", text: "гео: два источника называют разные регионы" };
  const GAP_ASSORT = { id: "gap-assortment", text: "assortment: смежные направления не подтверждены" };
  const GAP_UTP = { id: "gap-utp", text: "utp_technical: срок доставки не подтвержден" };
  const GAP_INN = { id: "gap-inn", text: "requisites: ИНН - ни один источник не называет" };

  // Раскладывает пробелы по файлам и проставляет closes_gaps вопросам фикстуры.
  function gapsScenario({ intakeGaps, briefGaps, closes }) {
    freshDir(answersDir, "answers_dir");
    const qj = readJson(join(answersDir, "questions.json"));
    for (const q of qj.questions) {
      if (closes[q.id]) q.closes_gaps = closes[q.id];
    }
    writeJson(join(answersDir, "questions.json"), qj);
    if (intakeGaps) writeJson(join(answersDir, "intake.json"), { facts: [], gaps: intakeGaps, conflicts: [] });
    if (briefGaps) writeJson(join(answersDir, "brief.json"), { slug: "romashka", gaps: briefGaps });
    return runScript("apply-answers.mjs", answersDir, "--source", "google-doc");
  }

  await step("apply-answers.mjs: пробел из closes_gaps ОТВЕЧЕННОГО вопроса снимается (intake.json и brief.json)", () => {
    const r = gapsScenario({
      intakeGaps: [GAP_GEO, GAP_UTP],
      briefGaps: [GAP_ASSORT, GAP_INN],
      closes: { q1: ["gap-geo"], q2: ["gap-assortment"], q3: ["gap-utp"], q4: [] },
    });
    if (r.code !== 0) return `exit ${r.code}, stdout=${r.stdout.trim()}, stderr=${r.stderr.trim()}`;
    const intakeIds = readJson(join(answersDir, "intake.json")).gaps.map((g) => g.id);
    const briefIds = readJson(join(answersDir, "brief.json")).gaps.map((g) => g.id);
    if (intakeIds.includes("gap-geo")) return `gap-geo не снят (q1 отвечен, закрывает его): intake.gaps=${JSON.stringify(intakeIds)}`;
    if (briefIds.includes("gap-assortment")) return `gap-assortment не снят (q2 отвечен, закрывает его): brief.gaps=${JSON.stringify(briefIds)}`;
    return true;
  });

  await step("apply-answers.mjs: пробел вне closes_gaps и пробел НЕОТВЕЧЕННОГО вопроса остаются нетронутыми", () => {
    // Тот же прогон: gap-utp закрывает q3, а q3 в фикстуре без ответа; gap-inn не назван
    // ни в одном closes_gaps. Оба обязаны остаться - иначе повторяется боевая ошибка,
    // где закрытыми объявляли пробелы, которых ответы не касались.
    const intake = readJson(join(answersDir, "intake.json"));
    const brief = readJson(join(answersDir, "brief.json"));
    const intakeIds = intake.gaps.map((g) => g.id);
    const briefIds = brief.gaps.map((g) => g.id);
    if (!intakeIds.includes("gap-utp")) return `gap-utp снят, хотя закрывающий его q3 остался без ответа: ${JSON.stringify(intakeIds)}`;
    if (!briefIds.includes("gap-inn")) return `gap-inn снят, хотя его нет ни в одном closes_gaps: ${JSON.stringify(briefIds)}`;
    if (intake.gaps.length !== 1 || brief.gaps.length !== 1) {
      return `лишние снятия: intake.gaps=${JSON.stringify(intakeIds)}, brief.gaps=${JSON.stringify(briefIds)}`;
    }
    // Форма элемента не должна портиться: остался объект с текстом.
    if (typeof intake.gaps[0] !== "object" || intake.gaps[0].text !== GAP_UTP.text) {
      return `форма оставшегося пробела испорчена: ${JSON.stringify(intake.gaps[0])}`;
    }
    return true;
  });

  await step("apply-answers.mjs: снятие печатается ПОСТРОЧНО (какой id, каким вопросом закрыт)", () => {
    const r = gapsScenario({
      intakeGaps: [GAP_GEO, GAP_UTP],
      briefGaps: [GAP_ASSORT, GAP_INN],
      closes: { q1: ["gap-geo"], q2: ["gap-assortment"], q3: ["gap-utp"], q4: [] },
    });
    if (r.code !== 0) return `exit ${r.code}, stderr=${r.stderr.trim()}`;
    const out = r.stdout;
    if (!/Закрыто пробелов:\s*2/.test(out)) return `нет счетчика «Закрыто пробелов: 2»:\n${out}`;
    if (!out.includes("intake.json: gap-geo") || !out.includes("q1")) return `нет строки про снятие gap-geo ответом на q1:\n${out}`;
    if (!out.includes("brief.json: gap-assortment") || !out.includes("q2")) return `нет строки про снятие gap-assortment ответом на q2:\n${out}`;
    if (out.includes("gap-utp") || out.includes("gap-inn")) return `в отчет попали пробелы, которые не снимались:\n${out}`;
    return true;
  });

  await step("apply-answers.mjs: ЛЕГАСИ-форма gaps (массив строк) -> exit 0, ни один пробел механически не снят", () => {
    const legacy = [
      "requisites: ИНН - ни один источник не называет",
      "гео: два источника называют разные регионы",
      "гарантии не обсуждались",
    ];
    const r = gapsScenario({
      intakeGaps: legacy,
      briefGaps: null,
      closes: { q1: ["gap-geo"], q2: ["gap-assortment"] },
    });
    if (r.code !== 0) return `exit ${r.code} (легаси-форма gaps не должна ломать импорт ответов), stderr=${r.stderr.trim()}`;
    const gaps = readJson(join(answersDir, "intake.json")).gaps;
    if (gaps.length !== 3) return `строковые пробелы сняты (id: null не закрывается никогда): ${JSON.stringify(gaps)}`;
    if (gaps.some((g) => typeof g !== "string")) return `форма легаси-элементов испорчена: ${JSON.stringify(gaps)}`;
    if (!/Закрыто пробелов:\s*0/.test(r.stdout)) return `ожидал «Закрыто пробелов: 0», получил:\n${r.stdout}`;
    return true;
  });

  await step("apply-answers.mjs: смешанные gaps - объект с id снимается, легаси-строка рядом остается строкой", () => {
    const r = gapsScenario({
      intakeGaps: ["не выяснено, как описывать формат обучения без лицензии", GAP_GEO, GAP_INN],
      briefGaps: null,
      closes: { q1: ["gap-geo"] },
    });
    if (r.code !== 0) return `exit ${r.code}, stderr=${r.stderr.trim()}`;
    const gaps = readJson(join(answersDir, "intake.json")).gaps;
    if (gaps.length !== 2) return `ожидал 2 оставшихся пробела, получил ${JSON.stringify(gaps)}`;
    if (typeof gaps[0] !== "string") return `легаси-строка перестала быть строкой: ${JSON.stringify(gaps[0])}`;
    if (gaps[1].id !== "gap-inn") return `остался не тот объект: ${JSON.stringify(gaps[1])}`;
    return true;
  });

  await step("apply-answers.mjs: closes_gaps ссылается на НЕСУЩЕСТВУЮЩИЙ id -> предупреждение, exit 0", () => {
    const r = gapsScenario({
      intakeGaps: [GAP_INN],
      briefGaps: null,
      closes: { q1: ["gap-опечатка-писателя"] },
    });
    if (r.code !== 0) return `exit ${r.code} (опечатка в closes_gaps не блокирует импорт), stderr=${r.stderr.trim()}`;
    if (!r.stdout.includes("gap-опечатка-писателя")) return `неизвестный id не назван в выводе:\n${r.stdout}`;
    if (!/неизвестн/i.test(r.stdout)) return `нет предупреждения про неизвестные id:\n${r.stdout}`;
    const gaps = readJson(join(answersDir, "intake.json")).gaps;
    if (gaps.length !== 1) return `пробел снялся по несуществующему id: ${JSON.stringify(gaps)}`;
    return true;
  });

  await step("apply-answers.mjs: битый intake.json -> импорт ответов не падает, пробелы не трогаются", () => {
    freshDir(answersDir, "answers_dir");
    const qj = readJson(join(answersDir, "questions.json"));
    qj.questions[0].closes_gaps = ["gap-geo"];
    writeJson(join(answersDir, "questions.json"), qj);
    const brokenJson = '{ "gaps": [ {"id": "gap-geo", "text": "битый';
    writeFileSync(join(answersDir, "intake.json"), brokenJson, "utf8");
    const r = runScript("apply-answers.mjs", answersDir, "--source", "google-doc");
    if (r.code !== 0) return `exit ${r.code} (опциональный файл с битым JSON не должен валить импорт), stderr=${r.stderr.trim()}`;
    if (!existsSync(join(answersDir, "rerun_plan.json"))) return "rerun_plan.json не создан";
    if (readFileSync(join(answersDir, "intake.json"), "utf8") !== brokenJson) return "битый intake.json был перезаписан";
    return true;
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Блок 3: build-analysis-docx.mjs - рендер раздела «Вопросы к вам»
// ═══════════════════════════════════════════════════════════════════════════
console.log("");
console.log("=== build-analysis-docx.mjs (раздел «Вопросы к вам») ===");

const analysisDir = join(sandboxRoot, "analysis_dir");

if (Q) {
  await step("questionsToRows на фикстуре analysis_dir/questions.json -> 2 строки, recommended/options на месте", () => {
    const qj = readJson(join(fixturesDir, "analysis_dir", "questions.json"));
    const rows = Q.questionsToRows(qj.questions);
    if (rows.length !== 2) return `ожидал 2 строки, получил ${rows.length}`;
    if (rows[0].recommended !== "а") return `rows[0].recommended="${rows[0].recommended}"`;
    if (rows[1].recommended !== "б") return `rows[1].recommended="${rows[1].recommended}"`;
    if (rows[0].options.length !== 3 || rows[1].options.length !== 3) return "options не сохранены полностью";
    return true;
  });
} else {
  await step("questionsToRows юнит (build-analysis-docx)", () =>
    SKIP("_questions.mjs ещё не создан (Пакет 3 в процессе) - пропускаю")
  );
}

await step("build-analysis-docx.mjs: смоук с questions.json -> exit 0, A2_romashka.docx создан и непуст", () => {
  freshDir(analysisDir, "analysis_dir");
  const r = runScript("build-analysis-docx.mjs", analysisDir);
  if (r.code !== 0) return `exit ${r.code}, stderr=${r.stderr.trim()}`;
  const outPath = join(analysisDir, "A2_romashka.docx");
  if (!existsSync(outPath)) return `${outPath} не создан`;
  const size = readFileSync(outPath).length;
  if (size < 1000) return `docx подозрительно мал (${size} байт) - похоже на пустой/битый файл`;
  return true;
});

// Заголовок раздела вопросов существует в ДВУХ формах: «## Вопросы к вам» (текущая, номера со
// всех разделов A2 сняты) и «## 0. Вопросы к вам» (легаси-A2, сданные клиентам до снятия
// номеров). Обе обязаны давать цветной рендер из questions.json и глушить markdown-дубликат:
// на снятии номера регулярка сборщика чуть не потеряла легаси-документы.
// Маркеры отличия: строка-интро есть ТОЛЬКО в рендере из questions.json, вводная фраза
// MD_QUESTIONS_PROSE - ТОЛЬКО в markdown A2.md.
const QUESTIONS_RENDER_MARK = "Ниже - главные вопросы по проекту";
const MD_QUESTIONS_PROSE = "Чтобы точнее собрать структуру и тексты";

await step("build-analysis-docx.mjs: без questions.json -> не падает (graceful), docx из markdown", () => {
  freshDir(analysisDir, "analysis_dir");
  rmSync(join(analysisDir, "questions.json"));
  const r = runScript("build-analysis-docx.mjs", analysisDir);
  if (r.code !== 0) return `exit ${r.code} (ожидал graceful exit 0 без questions.json), stderr=${r.stderr.trim()}`;
  if (!existsSync(join(analysisDir, "A2_romashka.docx"))) return "A2_romashka.docx не создан без questions.json";
  // Глушилка markdown-дубликата включается ТОЛЬКО когда есть чем заменить: без questions.json
  // проза раздела обязана остаться в документе, иначе клиент получит пустой раздел вопросов.
  const text = docxText(join(analysisDir, "A2_romashka.docx"));
  if (!text.includes(MD_QUESTIONS_PROSE)) return "без questions.json markdown-проза раздела вопросов пропала из docx";
  if (text.includes(QUESTIONS_RENDER_MARK)) return "без questions.json откуда-то взялся рендер вопросов";
  return true;
});

function questionsHeadingCase(heading) {
  freshDir(analysisDir, "analysis_dir");
  const a2Path = join(analysisDir, "A2.md");
  const a2 = readFileSync(a2Path, "utf8");
  const patched = a2.replace(/^## Вопросы к вам\s*$/m, heading);
  if (heading !== "## Вопросы к вам" && patched === a2) {
    return "в фикстуре A2.md нет строки «## Вопросы к вам» - тест потерял точку подмены заголовка";
  }
  writeFileSync(a2Path, patched);
  const r = runScript("build-analysis-docx.mjs", analysisDir);
  if (r.code !== 0) return `exit ${r.code}, stderr=${r.stderr.trim()}`;
  const text = docxText(join(analysisDir, "A2_romashka.docx"));
  if (!text.includes(QUESTIONS_RENDER_MARK)) {
    return `заголовок «${heading}» не опознан сборщиком: в docx нет рендера из questions.json`;
  }
  if (text.includes(MD_QUESTIONS_PROSE)) {
    return `markdown-дубликат раздела не заглушен при заголовке «${heading}»`;
  }
  if (!text.includes("Executive Summary") || !text.includes("Смежные направления")) {
    return `глушилка съела документ дальше раздела вопросов (заголовок «${heading}»)`;
  }
  return true;
}

await step("build-analysis-docx.mjs: «## Вопросы к вам» (без номера) -> рендер из questions.json, markdown-дубликат заглушен", () =>
  questionsHeadingCase("## Вопросы к вам")
);

await step("build-analysis-docx.mjs: легаси «## 0. Вопросы к вам» -> тот же рендер, markdown-дубликат заглушен", () =>
  questionsHeadingCase("## 0. Вопросы к вам")
);

// ═══════════════════════════════════════════════════════════════════════════
// Блок 4: validate-analysis-inputs.mjs - новый состав папки не ломает гейт
// ═══════════════════════════════════════════════════════════════════════════
console.log("");
console.log("=== validate-analysis-inputs.mjs (новые файлы Этапа 3 + tier-aware v2) ===");

const validateDir = join(sandboxRoot, "validate_dir");
const validateBasicDir = join(sandboxRoot, "validate_dir_basic");

// Готовит seo-анализ в формате v2: полный старый канон (validate_dir) + meta.tier=seo +
// brief.directions[] + audience.json (directions и audience берем из basic-фикстуры,
// чтобы dir_slug сегментов и направлений оставались согласованными).
function makeSeoV2Dir() {
  freshDir(validateDir, "validate_dir");
  writeJson(join(validateDir, "meta.json"), { tier: "seo", state: "report-done" });
  cpSync(join(fixturesDir, "validate_dir_basic", "audience.json"), join(validateDir, "audience.json"));
  const brief = readJson(join(validateDir, "brief.json"));
  brief.directions = readJson(join(fixturesDir, "validate_dir_basic", "brief.json")).directions;
  writeJson(join(validateDir, "brief.json"), brief);
  return validateDir;
}

await step("validate-analysis-inputs.mjs: полный канон + intake.json/questions.json/ВВОДНЫЕ.md -> exit 0", () => {
  freshDir(validateDir, "validate_dir");
  const r = runScript("validate-analysis-inputs.mjs", validateDir);
  if (r.code !== 0) return `exit ${r.code}, stdout=${r.stdout.trim()}, stderr=${r.stderr.trim()}`;
  return true;
});

await step("validate-analysis-inputs.mjs: легаси-фикстура (без intake/questions/ВВОДНЫЕ) -> exit 0 (не блок)", () => {
  freshDir(validateDir, "validate_dir");
  rmSync(join(validateDir, "intake.json"));
  rmSync(join(validateDir, "questions.json"));
  rmSync(join(validateDir, "ВВОДНЫЕ.md"));
  const r = runScript("validate-analysis-inputs.mjs", validateDir);
  if (r.code !== 0) return `exit ${r.code} (легаси-анализ без новых файлов Этапа 3 не должен блокироваться), stdout=${r.stdout.trim()}, stderr=${r.stderr.trim()}`;
  return true;
});

await step("validate-analysis-inputs.mjs: сломан канон (competitors.direct пуст) -> exit 2 (контракт не сломан правками Этапа 3)", () => {
  freshDir(validateDir, "validate_dir");
  const comp = readJson(join(validateDir, "competitors.json"));
  comp.direct = [];
  writeJson(join(validateDir, "competitors.json"), comp);
  const r = runScript("validate-analysis-inputs.mjs", validateDir);
  if (r.code !== 2) return `expected exit 2, got ${r.code}, stdout=${r.stdout.trim()}`;
  return true;
});

// --- tier-aware v2 (этап A программы v7, контракты 1.4а/1.7) ---

await step("validate-analysis-inputs.mjs: СТАРЫЙ анализ (meta.json без поля tier) -> старые правила, без требования directions/audience -> exit 0", () => {
  freshDir(validateDir, "validate_dir");
  writeJson(join(validateDir, "meta.json"), { state: "approved" }); // meta есть, tier - нет
  const r = runScript("validate-analysis-inputs.mjs", validateDir);
  if (r.code !== 0) return `exit ${r.code} (старый анализ без tier не должен требовать directions/audience), stdout=${r.stdout.trim()}, stderr=${r.stderr.trim()}`;
  return true;
});

await step("validate-analysis-inputs.mjs: tier=basic БЕЗ serp.json и Keyso-полей, с directions+audience -> exit 0", () => {
  freshDir(validateBasicDir, "validate_dir_basic");
  // Фикстура: meta.tier=basic; brief без keyso_base; competitors.direct без метрик-ключей;
  // serp.json отсутствует; directions[] и audience.json на месте.
  const r = runScript("validate-analysis-inputs.mjs", validateBasicDir);
  if (r.code !== 0) return `exit ${r.code} (basic-анализ без serp/Keyso должен проходить), stdout=${r.stdout.trim()}, stderr=${r.stderr.trim()}`;
  return true;
});

await step("validate-analysis-inputs.mjs: tier=seo v2 полный (канон + directions + audience) -> exit 0 (базлайн для негативных кейсов)", () => {
  makeSeoV2Dir();
  const r = runScript("validate-analysis-inputs.mjs", validateDir);
  if (r.code !== 0) return `exit ${r.code}, stdout=${r.stdout.trim()}, stderr=${r.stderr.trim()}`;
  return true;
});

await step("validate-analysis-inputs.mjs: tier=seo v2 без audience.json -> exit 2", () => {
  makeSeoV2Dir();
  rmSync(join(validateDir, "audience.json"));
  const r = runScript("validate-analysis-inputs.mjs", validateDir);
  if (r.code !== 2) return `expected exit 2 (v2-формат требует audience.json), got ${r.code}, stdout=${r.stdout.trim()}`;
  return true;
});

await step("validate-analysis-inputs.mjs: tier=seo v2 с пустыми brief.directions -> exit 2", () => {
  makeSeoV2Dir();
  const brief = readJson(join(validateDir, "brief.json"));
  brief.directions = [];
  writeJson(join(validateDir, "brief.json"), brief);
  const r = runScript("validate-analysis-inputs.mjs", validateDir);
  if (r.code !== 2) return `expected exit 2 (v2-формат требует непустой directions[]), got ${r.code}, stdout=${r.stdout.trim()}`;
  return true;
});

await step("validate-analysis-inputs.mjs: дубль dir_slug в brief.directions -> exit 2", () => {
  freshDir(validateBasicDir, "validate_dir_basic");
  const brief = readJson(join(validateBasicDir, "brief.json"));
  brief.directions[1].dir_slug = brief.directions[0].dir_slug;
  writeJson(join(validateBasicDir, "brief.json"), brief);
  const r = runScript("validate-analysis-inputs.mjs", validateBasicDir);
  if (r.code !== 2) return `expected exit 2 (dir_slug должны быть уникальны), got ${r.code}, stdout=${r.stdout.trim()}`;
  return true;
});

// ═══════════════════════════════════════════════════════════════════════════
// Блок 5: волна 3, N2 - запрет на самоназвание (brief.forbidden_self_names)
//
// Боевой кейс: заказчица просила называть проект «архитектурной софт-мастерской», а не
// «школой»; запрет был записан в разделе запрещенных формулировок отчета - и в том же
// отчете, в служебной прозе, стояло «комиссия за счет школы». Оба прохода верификатора
// поймали это уже ПОСЛЕ отдачи документа: суждение агента ищет нарушения позиционирования,
// а подсобные обороты звучат нейтрально. Значит проверка обязана быть детерминированной.
//
// Фикстура validate_dir/ ни A2.md, ни recommendations.json не несет (оба опциональны) -
// раскладываем их в песочнице под конкретный случай.
// ═══════════════════════════════════════════════════════════════════════════
console.log("");
console.log("=== validate-analysis-inputs.mjs (запрет на самоназвание, волна 3) ===");

// names: значение brief.forbidden_self_names (undefined - ключа нет вовсе).
// files: { "A2.md": "...", "recommendations.json": "..." } - что положить в папку.
function selfNameCase({ names, files }) {
  freshDir(validateDir, "validate_dir");
  const brief = readJson(join(validateDir, "brief.json"));
  if (names !== undefined) brief.forbidden_self_names = names;
  writeJson(join(validateDir, "brief.json"), brief);
  for (const [name, content] of Object.entries(files || {})) {
    writeFileSync(join(validateDir, name), content, "utf8");
  }
  return runScript("validate-analysis-inputs.mjs", validateDir);
}

const A2_CLEAN_HEAD = "# A2 - предпроектный анализ\n\n## Executive Summary\n\nПроект - архитектурная софт-мастерская.\n";

await step("самоназвание: запрещенное слово в СЛУЖЕБНОЙ прозе A2.md -> exit 2 с файлом, строкой и оборотом", () => {
  const r = selfNameCase({
    names: ["школа"],
    files: { "A2.md": A2_CLEAN_HEAD + "\n## Монетизация\n\nКомиссия удерживается за счет школы, а не с ученика.\n" },
  });
  if (r.code !== 2) return `expected exit 2, got ${r.code}, stdout=${r.stdout.trim()}, stderr=${r.stderr.trim()}`;
  const out = r.stderr + r.stdout;
  // Номер строки жесткий: без него сообщение бесполезно на отчете в сотни строк.
  if (!out.includes("A2.md:9:")) return `не назван файл со строкой (ожидал «A2.md:9:»):\n${out}`;
  if (!out.includes("самоназвание")) return `в сообщении нет слова «самоназвание»:\n${out}`;
  if (!out.includes("школы")) return `не назван найденный оборот «школы»:\n${out}`;
  return true;
});

await step("самоназвание: словоформа в recommendations.json (машиночитаемый выход) -> exit 2", () => {
  // recommendations.json читают /seo-struktura и /seo-tekst и исполняют буквально - слово
  // уедет на живую страницу, поэтому файл проверяется наравне с прозой отчета.
  const r = selfNameCase({
    names: ["школа"],
    files: {
      "A2.md": A2_CLEAN_HEAD,
      "recommendations.json": '{\n  "for_pages": [\n    { "note": "Работаем со школами по договору" }\n  ]\n}\n',
    },
  });
  if (r.code !== 2) return `expected exit 2 (словоформа «школами» обязана ловиться), got ${r.code}, stdout=${r.stdout.trim()}`;
  const out = r.stderr + r.stdout;
  if (!out.includes("recommendations.json:")) return `не назван файл recommendations.json:\n${out}`;
  if (!out.includes("школами")) return `не названа найденная словоформа «школами»:\n${out}`;
  return true;
});

await step("самоназвание: ПУСТОЙ forbidden_self_names -> exit 0 (запретов нет - проверять нечего)", () => {
  const r = selfNameCase({
    names: [],
    files: { "A2.md": A2_CLEAN_HEAD + "\nКомиссия удерживается за счет школы.\n" },
  });
  if (r.code !== 0) return `exit ${r.code} (пустой массив запретов не должен ничего ловить), stdout=${r.stdout.trim()}, stderr=${r.stderr.trim()}`;
  if (r.stdout.includes("самоназвание")) return `при пустом списке лишняя info-строка:\n${r.stdout}`;
  return true;
});

await step("самоназвание: ключа forbidden_self_names НЕТ (легаси-brief) -> exit 0", () => {
  const r = selfNameCase({
    names: undefined,
    files: { "A2.md": A2_CLEAN_HEAD + "\nКомиссия удерживается за счет школы.\n" },
  });
  if (r.code !== 0) return `exit ${r.code} (легаси-brief без нового поля не должен блокироваться), stdout=${r.stdout.trim()}, stderr=${r.stderr.trim()}`;
  return true;
});

await step("самоназвание: ложных срабатываний внутри других слов нет (школьник/дошкольное/курсант) -> exit 0", () => {
  // Контрпримеры выбраны так, чтобы завалить ровно ту реализацию, от которой отказались:
  // «школьник» и «дошкольное» содержат основу «школ» целиком (наивный поиск подстроки или
  // основы без правой/левой границы сработал бы на обоих), «курсант» - то же для «курсы»
  // (основа «курс»). Все три - обычные слова ниши, они обязаны проходить.
  const r = selfNameCase({
    names: ["школа", "курсы"],
    files: {
      "A2.md": A2_CLEAN_HEAD + "\nК нам приходит школьник после уроков, дошкольное отделение рядом.\n",
      "recommendations.json": '{\n  "for_pages": [\n    { "note": "Курсант получает сертификат" }\n  ]\n}\n',
    },
  });
  if (r.code !== 0) return `ложное срабатывание: exit ${r.code}, stdout=${r.stdout.trim()}, stderr=${r.stderr.trim()}`;
  if (!r.stdout.includes("самоназвание: 2 запрет")) return `нет info-строки о проверенных запретах:\n${r.stdout}`;
  if (!r.stdout.includes("A2.md") || !r.stdout.includes("recommendations.json")) {
    return `info-строка не называет оба проверенных файла:\n${r.stdout}`;
  }
  return true;
});

await step("самоназвание: строка-ДЕКЛАРАЦИЯ запрета нарушением не считается -> exit 0", () => {
  // Писатель обязан перечислить запрет в разделе запрещенных формулировок отчета. Если бы
  // такая строка считалась нарушением, гейт падал бы на каждом корректном отчете.
  const r = selfNameCase({
    names: ["школа"],
    files: {
      "A2.md": A2_CLEAN_HEAD +
        "\n## Запрещенные формулировки\n\n- Не называть проект школой или университетом.\n\n## Смежные направления\n\nВсе чисто.\n",
    },
  });
  if (r.code !== 0) return `exit ${r.code} (декларация запрета не нарушение), stdout=${r.stdout.trim()}, stderr=${r.stderr.trim()}`;
  return true;
});

await step("самоназвание: forbidden_self_names не массив -> exit 2 (проверка формы поля)", () => {
  const r = selfNameCase({ names: "школа", files: { "A2.md": A2_CLEAN_HEAD } });
  if (r.code !== 2) return `expected exit 2, got ${r.code}, stdout=${r.stdout.trim()}`;
  if (!(r.stderr + r.stdout).includes("forbidden_self_names")) return `сообщение не про forbidden_self_names:\n${r.stderr}`;
  return true;
});

// ═══════════════════════════════════════════════════════════════════════════
// Финал
// ═══════════════════════════════════════════════════════════════════════════
console.log("");
const passed = results.filter((r) => r.ok && !r.skipped).length;
const total = results.length;
console.log(`=== ${passed}/${total} tests passed (${skipped} skipped) ===`);

if (failed > 0) {
  console.log("");
  console.log("Failed:");
  for (const r of results.filter((r) => !r.ok)) {
    console.log(`  - ${r.name}: ${r.err}`);
  }
  process.exit(1);
}

// Чистим sandbox если всё ок
rmSync(sandboxRoot, { recursive: true, force: true });
process.exit(0);
