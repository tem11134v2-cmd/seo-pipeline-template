#!/usr/bin/env node
// run.mjs - регрессионный smoke-тест новой машинерии /seo-analiz (Этап 3: интейк, раздел «0.
// Вопросы к вам», импорт ответов, финальная проверка).
//
// Использование:
//   .claude\scripts\_node.cmd .claude\tests\seo-analiz\run.mjs
//
// Что делает:
//   1. _questions.mjs (Пакет 3, чистый модуль) - юниты без фикстур (динамический импорт).
//   2. apply-answers.mjs (Пакет 3) - интеграция на fixtures/answers_dir/ (детерминированное
//      ядро режима --answers: слияние ответов + rerun_plan.json).
//   3. build-analysis-docx.mjs - рендер раздела 0 на fixtures/analysis_dir/ (смоук + graceful
//      без questions.json).
//   4. validate-analysis-inputs.mjs - регрессия на fixtures/validate_dir/: новые файлы
//      (intake.json/questions.json/ВВОДНЫЕ.md) не ломают канон-гейт brief/competitors/serp;
//      легаси-фикстура (без них) тоже проходит exit 0 (warn-only, не блок).
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
}

// ═══════════════════════════════════════════════════════════════════════════
// Блок 3: build-analysis-docx.mjs - рендер раздела 0
// ═══════════════════════════════════════════════════════════════════════════
console.log("");
console.log("=== build-analysis-docx.mjs (раздел 0) ===");

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

await step("build-analysis-docx.mjs: без questions.json -> не падает (graceful), docx из markdown", () => {
  freshDir(analysisDir, "analysis_dir");
  rmSync(join(analysisDir, "questions.json"));
  const r = runScript("build-analysis-docx.mjs", analysisDir);
  if (r.code !== 0) return `exit ${r.code} (ожидал graceful exit 0 без questions.json), stderr=${r.stderr.trim()}`;
  if (!existsSync(join(analysisDir, "A2_romashka.docx"))) return "A2_romashka.docx не создан без questions.json";
  return true;
});

// ═══════════════════════════════════════════════════════════════════════════
// Блок 4: validate-analysis-inputs.mjs - новый состав папки не ломает гейт
// ═══════════════════════════════════════════════════════════════════════════
console.log("");
console.log("=== validate-analysis-inputs.mjs (новые файлы Этапа 3) ===");

const validateDir = join(sandboxRoot, "validate_dir");

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
