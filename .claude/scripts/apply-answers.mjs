#!/usr/bin/env node
// apply-answers.mjs
// Детерминированное ядро режима /seo-analiz --answers: сливает answers.json в questions.json
// и решает, какие шаги конвейера перезапускать (rerun_plan.json). Ответ-экстракцию (чтение
// Google Doc клиента -> answers.json) делает агент answer-extractor - этот скрипт только
// применяет уже извлеченные ответы, без обращения к MCP/Drive.
//
// Использование:
//   node .claude/scripts/apply-answers.mjs <analysis_dir> [--source google-doc|chat]
//
// Вход:
//   <analysis_dir>/questions.json  - канон вопросов (продюсер analysis-writer)
//   <analysis_dir>/answers.json    - извлеченные ответы клиента (продюсер answer-extractor)
// Выход:
//   <analysis_dir>/questions.json  - перезаписан: question.answer + free_comments +
//                                    answers_source + answers_imported_at
//   <analysis_dir>/rerun_plan.json - что перезапускать
//
// Exit:
//   0 - ок
//   2 - схема questions.json/answers.json нарушена (печатает построчно)
//   1 - ошибка запуска (нет папки/файлов/битый JSON/неверный --source)

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { validateQuestionsSchema, isBlockingProblem, classifyAnswer, deepestStage } from "./_questions.mjs";

const args = process.argv.slice(2);
const dirArg = args[0];
if (!dirArg) {
  console.error("[apply-answers] usage: node apply-answers.mjs <analysis_dir> [--source google-doc|chat]");
  process.exit(1);
}

let source = null;
const sourceIdx = args.indexOf("--source");
if (sourceIdx !== -1) {
  source = args[sourceIdx + 1];
  if (!["google-doc", "chat"].includes(source)) {
    console.error(`[apply-answers] --source должен быть «google-doc» или «chat», получено: ${source}`);
    process.exit(1);
  }
}

const analysisDir = resolve(dirArg);
if (!existsSync(analysisDir)) {
  console.error(`[apply-answers] директории нет: ${analysisDir}`);
  process.exit(1);
}

const questionsPath = join(analysisDir, "questions.json");
const answersPath = join(analysisDir, "answers.json");

function loadJsonOrExit1(path, label) {
  if (!existsSync(path)) {
    console.error(`[apply-answers] нет файла: ${path}`);
    process.exit(1);
  }
  try {
    return JSON.parse(readFileSync(path, "utf8").replace(/^﻿/, ""));
  } catch (err) {
    console.error(`[apply-answers] битый JSON в ${label}: ${err.message}`);
    process.exit(1);
  }
}

const questionsData = loadJsonOrExit1(questionsPath, "questions.json");
const answersData = loadJsonOrExit1(answersPath, "answers.json");

// 1. Схема questions.json - блокирующие проблемы -> exit 2. Мягкие warn-строки печатаем, но не блокируем.
const questionProblems = validateQuestionsSchema(questionsData);
const blockingQuestionProblems = questionProblems.filter(isBlockingProblem);
const warnQuestionProblems = questionProblems.filter((p) => !isBlockingProblem(p));

// Минимальная схема answers.json - тоже часть контракта "questions/answers нарушена" (exit 2).
const answerProblems = [];
if (!Array.isArray(answersData.answers)) {
  answerProblems.push("answers.json: нет «answers» (должен быть массив)");
} else {
  answersData.answers.forEach((a, i) => {
    if (!a || typeof a.id !== "string" || !a.id.trim()) {
      answerProblems.push(`answers.json: answers[${i}] без непустого «id»`);
    }
  });
}
if ("free_comments" in answersData && !Array.isArray(answersData.free_comments)) {
  answerProblems.push("answers.json: «free_comments» должен быть массивом");
}

const allProblems = [...blockingQuestionProblems, ...answerProblems];
if (allProblems.length > 0) {
  console.error(`[apply-answers] НЕ ПРОЙДЕНО (схема нарушена): ${analysisDir}`);
  for (const p of allProblems) console.error(`  - ${p}`);
  process.exit(2);
}
for (const w of warnQuestionProblems) {
  console.log(`[apply-answers]   i ${w}`);
}

// 2. Слить ответы в questions.json + классифицировать каждый вопрос.
const answersById = new Map();
for (const a of answersData.answers || []) {
  answersById.set(a.id, a.answer);
}

const perQuestion = [];
const buckets = new Set();

for (const q of questionsData.questions) {
  const rawAnswer = answersById.has(q.id) ? answersById.get(q.id) : null;
  const { decision, answer, rerun } = classifyAnswer(q, rawAnswer);
  q.answer = answer;
  perQuestion.push({ id: q.id, decision, answer, rerun });
  if (rerun && rerun !== "none") buckets.add(rerun);
}

// 3. Метаданные импорта + свободные комментарии.
questionsData.answers_source = source || questionsData.answers_source || null;
questionsData.answers_imported_at = new Date().toISOString();
questionsData.free_comments = Array.isArray(answersData.free_comments) ? answersData.free_comments : [];

writeFileSync(questionsPath, JSON.stringify(questionsData, null, 2), "utf8");

// 4. rerun_plan.json
const bucketsArr = [...buckets];
const freeCommentsCount = questionsData.free_comments.length;
let deepestStageValue;
if (bucketsArr.length > 0) {
  deepestStageValue = deepestStage(bucketsArr);
} else if (freeCommentsCount > 0) {
  deepestStageValue = "edit";
} else {
  deepestStageValue = "none";
}

const rerunPlan = {
  per_question: perQuestion,
  buckets: bucketsArr,
  deepest_stage: deepestStageValue,
  free_comments_count: freeCommentsCount,
  note: "Свободные комментарии -> ручная правка (edit/writer) после перезапуска.",
};

const rerunPlanPath = join(analysisDir, "rerun_plan.json");
writeFileSync(rerunPlanPath, JSON.stringify(rerunPlan, null, 2), "utf8");

// 5. Сводка (<=8 строк).
const divergedCount = perQuestion.filter((p) => p.decision === "diverged").length;
const asRecommendedCount = perQuestion.filter((p) => p.decision === "as_recommended").length;
const unansweredCount = perQuestion.filter((p) => p.decision === "unanswered").length;
console.log(`[apply-answers] OK: ${analysisDir}`);
console.log(`  Ответов обработано: ${perQuestion.length} (согласен: ${asRecommendedCount}, расходится: ${divergedCount}, без ответа: ${unansweredCount})`);
console.log(`  Свободных комментариев: ${freeCommentsCount}`);
console.log(`  Перезапуск: buckets=[${bucketsArr.join(", ")}] -> deepest_stage=${deepestStageValue}`);
console.log(`  Записал: ${questionsPath}`);
console.log(`  Записал: ${rerunPlanPath}`);
process.exit(0);
