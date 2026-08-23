// _questions.mjs - единый источник схемы/логики questions.json ("Вопросы к вам").
// Чистый модуль-хелпер (по образцу _slug.mjs): без сайд-эффектов, без чтения файлов.
// Импортируют: build-analysis-docx.mjs (рендер раздела «Вопросы к вам»), apply-answers.mjs
// (слияние ответов + план перезапуска + закрытие пробелов) и тесты .claude/tests/seo-analiz/.
//
// Схема questions.json (канон, продюсер - analysis-writer):
// {
//   "questions": [
//     { "id": "q1", "question": "...", "options": ["а) ...", "б) ...", "в) свой вариант: ___"],
//       "recommended": "а", "recommended_note": "...", "answer": null,
//       "source_gap": "intake.conflict:гео", "rerun_hint": "brief",
//       "closes_gaps": ["gap-geo"] }
//   ],
//   "free_comments": [],
//   "answers_source": null,
//   "answers_imported_at": null
// }
//
// Вариант ответа: строка ("а) Москва и область") ИЛИ объект с текстом и своим хинтом
// перезапуска: { "text": "б) Вся Россия", "rerun_hint": "competitors" }. Поле rerun_hint
// у варианта НЕОБЯЗАТЕЛЬНО и берет значения из того же ALLOWED_RERUN_HINTS.
// Разрешение конфликта: хинт варианта ПОБЕЖДАЕТ хинт вопроса; хинт вопроса остается
// фолбэком для вариантов без своего хинта (обратная совместимость - вопросы со
// строковыми вариантами работают ровно как раньше).
//
// closes_gaps: массив id пробелов (`gaps[].id` из intake.json/brief.json), которые закрывает
// ответ на этот вопрос. Поле НЕОБЯЗАТЕЛЬНО, пустой массив допустим (вопрос ничего не
// закрывает). Единственный автор questions.json - analysis-writer, значит заполняет он.
// По этому полю apply-answers.mjs снимает пробелы МЕХАНИЧЕСКИ, без разбора их текста:
// решение по свободному тексту любой регуляркой ошибается (см. gaps ниже).

// --- 1. Допустимые значения rerun_hint (совпадает со ступенями конвейера /seo-analiz v2) ---
// Старый словарь (brief|competitors|serp|leaders|writer|edit) - подмножество нового:
// старые questions.json остаются валидными без миграции.
export const ALLOWED_RERUN_HINTS = ["intake", "brief", "audience", "competitors", "leaders", "directions", "serp", "writer", "edit"];

// --- 2. Порядок "глубины" ступени конвейера (для deepestStage; intake глубже всех) ---
// Соответствует downstream-цепочке контрактов v7 (1.6): intake -> brief -> audience ->
// competitors -> leaders -> directions -> [serp] -> writer -> edit.
export const STAGE_ORDER = ["intake", "brief", "audience", "competitors", "leaders", "directions", "serp", "writer", "edit", "none"];

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
    } else {
      // Вариант-объект: текст обязателен, свой rerun_hint - опционален, но если задан,
      // проверяется по тому же множеству, что и хинт вопроса.
      q.options.forEach((opt, j) => {
        if (!opt || typeof opt !== "object" || Array.isArray(opt)) return; // строковый вариант - как раньше
        if (!isNonEmptyStr(optionText(opt))) {
          problems.push(`${where}: options[${j}] - объект без текста варианта (ожидается «text»)`);
        }
        if ("rerun_hint" in opt && !ALLOWED_RERUN_HINTS.includes(opt.rerun_hint)) {
          problems.push(`${where}: options[${j}].«rerun_hint» не из допустимого множества (${ALLOWED_RERUN_HINTS.join("|")})`);
        }
      });
    }
    if (!isNonEmptyStr(q.recommended)) problems.push(`${where}: нет/пустое «recommended»`);
    if (!("answer" in q)) problems.push(`${where}: нет ключа «answer» (значение может быть null, но ключ обязателен)`);
    if (!isNonEmptyStr(q.source_gap)) problems.push(`${where}: нет/пустое «source_gap»`);
    if (!ALLOWED_RERUN_HINTS.includes(q.rerun_hint)) {
      problems.push(`${where}: «rerun_hint» не из допустимого множества (${ALLOWED_RERUN_HINTS.join("|")})`);
    }
    // closes_gaps - необязательное поле; отсутствие и пустой массив равно допустимы.
    // Проверяем только форму: массив непустых строк-id.
    if ("closes_gaps" in q) {
      if (!Array.isArray(q.closes_gaps)) {
        problems.push(`${where}: «closes_gaps» должен быть массивом id пробелов (пустой массив допустим)`);
      } else {
        q.closes_gaps.forEach((g, j) => {
          if (!isNonEmptyStr(g)) problems.push(`${where}: closes_gaps[${j}] - не непустая строка-id пробела`);
        });
      }
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
// options нормализуются в строки: вариант-объект отдается наружу своим текстом, чтобы
// рендеры (build-analysis-docx) не знали про две формы варианта.
export function questionsToRows(questions) {
  return (Array.isArray(questions) ? questions : []).map((q, i) => ({
    n: i + 1,
    question: q?.question ?? "",
    options: (Array.isArray(q?.options) ? q.options : []).map(optionText),
    recommended: q?.recommended ?? null,
    note: q?.recommended_note || "",
  }));
}

// --- 5. Вариант ответа: две формы (строка | объект с текстом и своим rerun_hint) ---

// Текст варианта: строка - как есть; объект - «text» (терпимо к label/option/value).
export function optionText(opt) {
  if (opt && typeof opt === "object" && !Array.isArray(opt)) {
    return String(opt.text ?? opt.label ?? opt.option ?? opt.value ?? "");
  }
  return String(opt ?? "");
}

// Свой rerun_hint варианта (null у строкового варианта и у объекта без хинта).
export function optionRerunHint(opt) {
  if (opt && typeof opt === "object" && !Array.isArray(opt) && isNonEmptyStr(opt.rerun_hint)) {
    return opt.rerun_hint.trim();
  }
  return null;
}

// Вариант вопроса по букве ("б" -> тот самый вариант); null если не нашли.
export function findOptionByLetter(question, letter) {
  const want = String(letter ?? "").trim().toLowerCase();
  if (!want) return null;
  const opts = Array.isArray(question?.options) ? question.options : [];
  for (const opt of opts) if (optionLetter(opt) === want) return opt;
  return null;
}

// --- 5а. Разбор буквы варианта ("а) Москва и область" -> "а"; "б" -> "б") ---
// Примечание: \b в JS-regex завязан на \w, а \w matчит только ASCII - для кириллицы
// граница слова через \b не работает. Поэтому используем явный negative lookahead на
// следующую кириллическую букву (иначе "а" внутри слова типа "апельсин" ложно сматчится).
export function optionLetter(opt) {
  const s = optionText(opt).trim().toLowerCase();
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
//
// Перезапуск определяется СМЫСЛОМ выбранного варианта, а не только фактом согласия:
// у выбранного варианта может быть свой rerun_hint - он ПОБЕЖДАЕТ хинт вопроса и работает
// в обе стороны. Поэтому ответ "как рекомендовано" тоже может дать перезапуск (вариант,
// который добавляет сущность - новый раздел, направление, регион), а хинт вопроса остается
// фолбэком для вариантов без своего хинта.
export function classifyAnswer(question, rawAnswer) {
  const text = rawAnswer == null ? "" : String(rawAnswer).trim();
  if (!text) {
    return { decision: "unanswered", answer: null, rerun: "none" };
  }
  const recommended = question?.recommended;
  const letter = optionLetter(text);
  const recLetter = String(recommended ?? "").trim().toLowerCase();
  const matchesLetter = Boolean(letter) && Boolean(recLetter) && letter === recLetter;
  const agree = isAgreeAnswer(text);
  // Выбранный вариант: по букве ответа; при согласии словами - рекомендованный вариант.
  const chosen = findOptionByLetter(question, letter || (agree ? recLetter : null));
  const chosenHint = optionRerunHint(chosen);
  if (agree || matchesLetter) {
    return { decision: "as_recommended", answer: letter || text, rerun: chosenHint || "none" };
  }
  return { decision: "diverged", answer: letter || text, rerun: chosenHint || question?.rerun_hint || "writer" };
}

// --- 8. Самый "глубокий" шаг конвейера среди набора bucket-ов (для rerun_plan.json) ---
export function deepestStage(buckets) {
  const set = new Set((Array.isArray(buckets) ? buckets : []).filter(Boolean));
  for (const stage of STAGE_ORDER) {
    if (set.has(stage)) return stage;
  }
  return "none";
}

// --- 9. Пробелы (gaps) intake.json/brief.json: две формы записи ---
// Канон: { "id": "gap-inn", "text": "requisites: ИНН - ни один источник не называет" }.
// id - короткий стабильный слаг (одна и та же дыра при повторном прогоне получает тот же id).
// Обратная совместимость ОБЯЗАТЕЛЬНА: у клиентов лежат проекты, где gaps - массив СТРОК.
// Строка нормализуется в { id: null, text: <строка> }. Пробел с id: null механически не
// закрывается никогда (закрыть его может только человек) - это честнее, чем угадывать
// регуляркой по тексту пробела.
export function normalizeGap(gap) {
  if (gap && typeof gap === "object" && !Array.isArray(gap)) {
    return {
      id: isNonEmptyStr(gap.id) ? gap.id.trim() : null,
      text: String(gap.text ?? gap.gap ?? gap.description ?? ""),
    };
  }
  return { id: null, text: String(gap ?? "") };
}

export function normalizeGaps(gaps) {
  return (Array.isArray(gaps) ? gaps : []).map(normalizeGap);
}

// id пробелов, которые закрывает ответ на вопрос (пусто, если поля нет).
export function questionClosesGaps(question) {
  const raw = Array.isArray(question?.closes_gaps) ? question.closes_gaps : [];
  return raw.filter(isNonEmptyStr).map((s) => s.trim());
}
