// _questions.mjs - единый источник схемы/логики questions.json ("0. Вопросы к вам").
// Чистый модуль-хелпер (по образцу _slug.mjs): без сайд-эффектов, без чтения файлов.
// Импортируют: build-analysis-docx.mjs (рендер раздела 0), apply-answers.mjs (слияние
// ответов + план перезапуска) и тесты .claude/tests/seo-analiz/.
//
// Схема questions.json (канон, продюсер - analysis-writer):
// {
//   "questions": [
//     { "id": "q1", "question": "...", "options": ["а) ...", "б) ...", "в) свой вариант: ___"],
//       "recommended": "а", "recommended_note": "...", "answer": null,
//       "source_gap": "intake.conflict:гео", "rerun_hint": "brief" }
//   ],
//   "free_comments": [],
//   "answers_source": null,
//   "answers_imported_at": null
// }

// --- 1. Допустимые значения rerun_hint (совпадает с шагами конвейера /seo-analiz) ---
export const ALLOWED_RERUN_HINTS = ["brief", "competitors", "serp", "leaders", "writer", "edit"];

// --- 2. Порядок "глубины" шага конвейера (для deepestStage) ---
export const STAGE_ORDER = ["brief", "competitors", "serp", "leaders", "writer", "edit", "none"];

const isNonEmptyStr = (v) => typeof v === "string" && v.trim().length > 0;

// --- 3. Валидация схемы questions.json ---
// Возвращает string[] проблем (пусто = ок). Обязательные поля вопроса блокируют (exit 2 у
// apply-answers.mjs). Мягкая проверка количества вопросов (рекомендовано 3-7) НЕ блокирует -
// она возвращается той же строкой, но с префиксом "warn: ", чтобы вызывающий код мог отличить
// предупреждение от блокирующей проблемы (см. isBlockingProblem) и не потерять его из вывода.
export function validateQuestionsSchema(obj) {
  const problems = [];
  if (!obj || typeof obj !== "object") {
    problems.push("questions.json: корневой объект отсутствует или не объект");
    return problems;
  }
  const questions = obj.questions;
  if (!Array.isArray(questions)) {
    problems.push("questions.json: нет «questions» (должен быть массив)");
    return problems;
  }
  questions.forEach((q, i) => {
    const idLabel = q && isNonEmptyStr(q.id) ? ` (id=${q.id})` : "";
    const where = `questions[${i}]${idLabel}`;
    if (!q || typeof q !== "object") {
      problems.push(`${where}: не объект`);
      return;
    }
    if (!isNonEmptyStr(q.id)) problems.push(`${where}: нет/пустое «id»`);
    if (!isNonEmptyStr(q.question)) problems.push(`${where}: нет/пустое «question»`);
    if (!Array.isArray(q.options) || q.options.length < 2) {
      problems.push(`${where}: «options» должен быть массивом из >=2 вариантов`);
    }
    if (!isNonEmptyStr(q.recommended)) problems.push(`${where}: нет/пустое «recommended»`);
    if (!("answer" in q)) problems.push(`${where}: нет ключа «answer» (значение может быть null, но ключ обязателен)`);
    if (!isNonEmptyStr(q.source_gap)) problems.push(`${where}: нет/пустое «source_gap»`);
    if (!ALLOWED_RERUN_HINTS.includes(q.rerun_hint)) {
      problems.push(`${where}: «rerun_hint» не из допустимого множества (${ALLOWED_RERUN_HINTS.join("|")})`);
    }
  });
  if (questions.length < 3 || questions.length > 7) {
    problems.push(`warn: вопросов ${questions.length} (рекомендовано 3-7) - не блокирует`);
  }
  return problems;
}

// Блокирует ли конкретная строка проблемы (не является мягким warn-предупреждением).
export function isBlockingProblem(problem) {
  return !String(problem).startsWith("warn:");
}

// --- 4. Строки для рендера (docx + тесты) ---
export function questionsToRows(questions) {
  return (Array.isArray(questions) ? questions : []).map((q, i) => ({
    n: i + 1,
    question: q?.question ?? "",
    options: Array.isArray(q?.options) ? q.options : [],
    recommended: q?.recommended ?? null,
    note: q?.recommended_note || "",
  }));
}

// --- 5. Разбор буквы варианта ("а) Москва и область" -> "а"; "б" -> "б") ---
// Примечание: \b в JS-regex завязан на \w, а \w matчит только ASCII - для кириллицы
// граница слова через \b не работает. Поэтому используем явный negative lookahead на
// следующую кириллическую букву (иначе "а" внутри слова типа "апельсин" ложно сматчится).
export function optionLetter(opt) {
  const s = String(opt ?? "").trim().toLowerCase();
  const m = s.match(/^([абв])(?![а-яё])/);
  return m ? m[1] : null;
}

export function optionMatchesRecommended(opt, recommended) {
  const letter = optionLetter(opt);
  const rec = String(recommended ?? "").trim().toLowerCase();
  return Boolean(letter) && Boolean(rec) && letter === rec;
}

// --- 6. Согласие с рекомендацией текстом (без выбора буквы) ---
export const AGREE_PHRASES = [
  "согласен с рекомендованным",
  "согласна с рекомендованным",
  "согласны с рекомендованным",
  "как вы рекомендуете",
  "как рекомендуете",
  "как вы советуете",
  "как советуете",
  "ок",
  "окей",
  "да",
];

// Примечание: \w в JS-regex - ASCII-only, кириллицу не matчит. Для окончаний слов
// используем явный класс [а-яё]* вместо \w*.
export function isAgreeAnswer(text) {
  const t = String(text ?? "").trim().toLowerCase().replace(/[.!]+$/g, "");
  if (!t) return false;
  if (AGREE_PHRASES.includes(t)) return true;
  if (/соглас[а-яё]*\s+с\s+рекомендован[а-яё]*/.test(t)) return true;
  if (/как\s+(вы\s+)?(рекоменд[а-яё]*|совету[а-яё]*)/.test(t)) return true;
  return false;
}

// --- 7. Классификация ответа клиента на один вопрос ---
// rawAnswer - буква ("б"), полный вариант ("б) Вся Россия"), свободный текст или согласие.
// Возврат: { decision: "as_recommended"|"diverged"|"unanswered", answer, rerun: "none"|<rerun_hint> }
export function classifyAnswer(question, rawAnswer) {
  const text = rawAnswer == null ? "" : String(rawAnswer).trim();
  if (!text) {
    return { decision: "unanswered", answer: null, rerun: "none" };
  }
  const recommended = question?.recommended;
  const letter = optionLetter(text);
  const matchesLetter = Boolean(letter) && Boolean(recommended) && letter === String(recommended).trim().toLowerCase();
  if (isAgreeAnswer(text) || matchesLetter) {
    return { decision: "as_recommended", answer: letter || text, rerun: "none" };
  }
  return { decision: "diverged", answer: letter || text, rerun: question?.rerun_hint || "writer" };
}

// --- 8. Самый "глубокий" шаг конвейера среди набора bucket-ов (для rerun_plan.json) ---
export function deepestStage(buckets) {
  const set = new Set((Array.isArray(buckets) ? buckets : []).filter(Boolean));
  for (const stage of STAGE_ORDER) {
    if (set.has(stage)) return stage;
  }
  return "none";
}
