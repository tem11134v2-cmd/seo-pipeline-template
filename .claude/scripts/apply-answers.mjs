#!/usr/bin/env node
// apply-answers.mjs
// Детерминированное ядро режима /seo-analiz --answers: сливает answers.json в questions.json
// и решает, какие шаги конвейера перезапускать (rerun_plan.json). Ответ-экстракцию (чтение
// Google Doc клиента -> answers.json) делает агент answer-extractor - этот скрипт только
// применяет уже извлеченные ответы, без обращения к MCP/Drive.
//
// Перезапуск считается по СМЫСЛУ выбранного варианта: у варианта ответа может быть свой
// rerun_hint (он побеждает хинт вопроса), поэтому ответ "как рекомендовано" тоже может
// потребовать перезапуска - см. classifyAnswer в _questions.mjs.
//
// Использование:
//   node .claude/scripts/apply-answers.mjs <analysis_dir> [--source google-doc|chat]
//
// Пробелы (gaps) закрываются МЕХАНИЧЕСКИ по полю questions[].closes_gaps - сверкой
// идентификаторов, без всякого разбора текста пробела. Причина: любая регулярка поверх прозы
// ошибается (в бою из восьми снятых пробелов пять снялись ошибочно - «возврат Тильды» сняло
// словом «возврат», «DOR не расшифрован» - словом «DOR»). Пробел в строковой форме
// нормализуется в { id: null, text } и механически не закрывается никогда.
//
// Вход:
//   <analysis_dir>/questions.json  - канон вопросов (продюсер analysis-writer)
//   <analysis_dir>/answers.json    - извлеченные ответы клиента (продюсер answer-extractor)
//   <analysis_dir>/intake.json     - опционален: gaps[] чистятся по closes_gaps
//   <analysis_dir>/brief.json      - опционален: gaps[] чистятся по closes_gaps
// Выход:
//   <analysis_dir>/questions.json  - перезаписан: question.answer + free_comments +
//                                    answers_source + answers_imported_at
//   <analysis_dir>/rerun_plan.json - что перезапускать
//   <analysis_dir>/intake.json, brief.json - перезаписываются ТОЛЬКО если из gaps[] что-то
//                                    снялось (остальные поля и форма записи не трогаются)
//
// Exit:
//   0 - ок
//   2 - схема questions.json/answers.json нарушена (печатает построчно)
//   1 - ошибка запуска (нет папки/файлов/битый JSON/неверный --source)

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  validateQuestionsSchema,
  isBlockingProblem,
  classifyAnswer,
  deepestStage,
  normalizeGap,
  questionClosesGaps,
} from "./_questions.mjs";

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

// 2а. Механическое закрытие пробелов (gaps) по closes_gaps ОТВЕЧЕННЫХ вопросов.
// Никакого разбора текста пробела: сверяются только идентификаторы. Пробел, которого нет ни
// в одном closes_gaps отвеченного вопроса, остается нетронутым. Пробел в строковой форме
// (legacy) имеет id: null и механически не закрывается никогда.
const answeredById = new Map(perQuestion.map((p) => [p.id, p.decision]));
const closedBy = new Map(); // gap id -> id вопроса, ответ на который его закрыл
for (const q of questionsData.questions) {
  if (answeredById.get(q.id) === "unanswered") continue;
  for (const gapId of questionClosesGaps(q)) {
    if (!closedBy.has(gapId)) closedBy.set(gapId, q.id);
  }
}

const gapClosures = [];
const knownGapIds = new Set();

function closeGapsInFile(name) {
  const path = join(analysisDir, name);
  if (!existsSync(path)) return;
  let data;
  try {
    data = JSON.parse(readFileSync(path, "utf8").replace(/^﻿/, ""));
  } catch (err) {
    console.log(`[apply-answers]   i ${name}: битый JSON - пробелы не трогаю (${err.message})`);
    return;
  }
  if (!data || typeof data !== "object" || !Array.isArray(data.gaps)) return;
  const kept = [];
  for (const raw of data.gaps) {
    const { id, text } = normalizeGap(raw);
    if (id) knownGapIds.add(id);
    if (id && closedBy.has(id)) {
      gapClosures.push(`${name}: ${id} - закрыт ответом на ${closedBy.get(id)} («${text}»)`);
      continue;
    }
    kept.push(raw); // форма элемента сохраняется как в исходнике (строка остается строкой)
  }
  if (kept.length !== data.gaps.length) {
    data.gaps = kept;
    writeFileSync(path, JSON.stringify(data, null, 2), "utf8");
  }
}

closeGapsInFile("intake.json");
closeGapsInFile("brief.json");

// id из closes_gaps, которых нет ни в intake.json, ни в brief.json - опечатка писателя:
// пробел останется висеть, значит про это надо сказать вслух.
const unknownGapIds = [...closedBy.keys()].filter((id) => !knownGapIds.has(id));

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

// 5. Сводка (компактная; исключение - построчная печать снятых пробелов, она обязательна).
const divergedCount = perQuestion.filter((p) => p.decision === "diverged").length;
const asRecommendedCount = perQuestion.filter((p) => p.decision === "as_recommended").length;
const unansweredCount = perQuestion.filter((p) => p.decision === "unanswered").length;
console.log(`[apply-answers] OK: ${analysisDir}`);
console.log(`  Ответов обработано: ${perQuestion.length} (согласен: ${asRecommendedCount}, расходится: ${divergedCount}, без ответа: ${unansweredCount})`);
console.log(`  Свободных комментариев: ${freeCommentsCount}`);
console.log(`  Перезапуск: buckets=[${bucketsArr.join(", ")}] -> deepest_stage=${deepestStageValue}`);
// Согласие с рекомендацией больше не означает автоматически "перезапуска нет": у варианта
// может стоять свой rerun_hint. Называем такие вопросы явно - иначе перезапуск выглядит
// беспричинным.
const agreedWithRerun = perQuestion.filter((p) => p.decision === "as_recommended" && p.rerun && p.rerun !== "none");
if (agreedWithRerun.length) {
  console.log(`  Перезапуск при согласии (хинт варианта): ${agreedWithRerun.map((p) => `${p.id}->${p.rerun}`).join(", ")}`);
}
// Снятие пробелов печатается ПОСТРОЧНО: какой id, каким вопросом закрыт. Без этой печати
// ошибочное снятие не видно - именно так его и поймали в бою.
console.log(`  Закрыто пробелов: ${gapClosures.length} (механически, по closes_gaps)`);
for (const line of gapClosures) console.log(`    - ${line}`);
if (unknownGapIds.length) {
  console.log(`  ⚠ closes_gaps ссылается на неизвестные id (пробелы остались висеть): ${unknownGapIds.join(", ")}`);
}
console.log(`  Записал: ${questionsPath}`);
console.log(`  Записал: ${rerunPlanPath}`);
process.exit(0);
