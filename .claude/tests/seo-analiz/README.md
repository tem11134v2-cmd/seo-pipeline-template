# Smoke-тесты `/seo-analiz` (Этап 3)

Регрессионные тесты новой машинерии Этапа 3 (интейк-канал, раздел «0. Вопросы к вам», импорт
ответов клиента, финальная проверка):

- `_questions.mjs` — единый чистый модуль-хелпер схемы/логики `questions.json` (Пакет 3)
- `apply-answers.mjs` — детерминированное ядро режима `/seo-analiz --answers` (слияние ответов + `rerun_plan.json`, Пакет 3)
- `build-analysis-docx.mjs` — рендер раздела «0. Вопросы к вам» в A2.docx (Пакет 3)
- `validate-analysis-inputs.mjs` — регрессия: новые файлы Этапа 3 (`intake.json`, `questions.json`, `ВВОДНЫЕ.md`) не ломают канон-гейт `brief`/`competitors`/`serp`, легаси-анализ без них тоже проходит

Агентская проза (`intake-analyst.md`, `analysis-writer.md`, `analysis-verifier.md`,
`answer-extractor.md`, `brief-structurer.md`) тестами не покрывается — она не детерминирована
и проверяется вручную/ревью (см. раздел 9 спеки Этапа 3, чек-лист ревьюера).

## Устойчивость к параллельной разработке

`_questions.mjs` и `apply-answers.mjs` — НОВЫЕ файлы Пакета 3. Если на момент прогона они ещё
не созданы (параллельный исполнитель не закончил), соответствующие блоки тестов помечаются
**SKIP** (с сообщением-причиной), а не FAIL — общий прогон при этом остаётся зелёным.
`build-analysis-docx.mjs` и `validate-analysis-inputs.mjs` — существующие файлы (Пакет 3 их
только правит), их тесты выполняются всегда.

## Что они проверяют

| # | Тест | Что валидируется |
|---|---|---|
| 1-7 | `validateQuestionsSchema: без ... -> непустой список` | блокирующие проблемы схемы (нет `options`/`recommended`/`answer`/`source_gap`, `options`<2, недопустимый `rerun_hint`) |
| 8 | `validateQuestionsSchema: N=2 (вне 3-7) -> только мягкий warn` | количество вопросов вне 3-7 не блокирует (различается через `isBlockingProblem`) |
| 9 | `isBlockingProblem: отличает warn-строку от блокирующей проблемы` | контракт различения warn/блок |
| 10-11 | `optionMatchesRecommended` | буква варианта совпадает/не совпадает с `recommended` |
| 12-14 | `isAgreeAnswer` | «согласен с рекомендованным» / «как рекомендуете» -> true; обычный вариант ответа -> false |
| 15-18 | `classifyAnswer` | answer==recommended и isAgreeAnswer -> `as_recommended`/`none`; расхождение -> `diverged`/`rerun_hint`; пусто/null -> `unanswered`/`none` |
| 19-21 | `deepestStage` | порядок глубины шагов конвейера (`brief > ... > writer > edit > none`) |
| 22 | `questionsToRows` (юнит) | N строк, `recommended`/`options` перенесены без потерь |
| 23 | `apply-answers.mjs: базовый прогон -> exit 0` | `rerun_plan.json` создан |
| 24 | `apply-answers.mjs: questions.json.answers заполнены + метаданные` | `answer` на каждый вопрос, `answers_source`, `answers_imported_at`, `free_comments` перенесены |
| 25 | `apply-answers.mjs: rerun_plan.json` | согласие -> bucket `none`; расхождение -> bucket = `rerun_hint`; `deepest_stage`; `free_comments_count` |
| 26 | `apply-answers.mjs: все согласны + free_comment -> deepest_stage == edit` | правило «нет buckets, но есть комментарии -> edit» |
| 27 | `apply-answers.mjs: битый questions.json -> exit 2` | схема нарушена (нет `recommended`) блокирует |
| 28 | `apply-answers.mjs: нет answers.json -> exit 1` | ошибка запуска (не схема) |
| 29 | `questionsToRows` на фикстуре `analysis_dir` | то же что #22, но на реалистичной фикстуре A2 |
| 30 | `build-analysis-docx.mjs: смоук с questions.json` | exit 0, `A2_romashka.docx` создан и не пуст |
| 31 | `build-analysis-docx.mjs: без questions.json -> graceful` | не падает без `questions.json`, docx собирается из markdown |
| 32 | `validate-analysis-inputs.mjs: полный канон + новые файлы -> exit 0` | новые артефакты Этапа 3 не ломают гейт |
| 33 | `validate-analysis-inputs.mjs: легаси (без intake/questions/ВВОДНЫЕ) -> exit 0` | регрессия-страж: старые анализы без Этапа 3 продолжают проходить |
| 34 | `validate-analysis-inputs.mjs: сломан канон -> exit 2` | блокирующий контракт `brief`/`competitors`/`serp` не тронут правками Этапа 3 |

## Как запустить

Из корня проекта:

```
.claude\scripts\_node.cmd .claude\tests\seo-analiz\run.mjs
```

Ожидаемый вывод (~2-5 секунд):

```
=== /seo-analiz (Этап 3) scripts smoke ===
Sandbox: <project>/.claude/tmp/seo-analiz-test

  [test] validateQuestionsSchema: валидный questions.json (3 вопроса) -> [] ... PASS
  ...
  [test] validate-analysis-inputs.mjs: сломан канон (competitors.direct пуст) -> exit 2 ... PASS

=== 34/34 tests passed (0 skipped) ===
```

Exit 0 = все выполненные тесты (не SKIP) прошли. Exit 1 = хоть один тест упал (вывод покажет где).
Если видите `SKIP` — значит `_questions.mjs`/`apply-answers.mjs` ещё не созданы; перепрогоните
после того, как Пакет 3 будет закончен.

## Когда запускать

- После любых правок в `_questions.mjs`, `apply-answers.mjs`, `build-analysis-docx.mjs`,
  `validate-analysis-inputs.mjs`.
- Перед финальным ревью Этапа 3 (объединение Пакетов 1-5) — прогон должен быть `0 SKIP`.
- Перед PR / push.

## Где лежат fixtures

```
.claude/tests/seo-analiz/fixtures/
├── answers_dir/            # apply-answers.mjs: 3 вопроса (разные rerun_hint) + 2 ответа
│   ├── questions.json      #   (q1 recommended=а, q2 recommended=б, q3 остаётся без ответа)
│   └── answers.json        # q1=«согласен с рекомендованным» (as_recommended), q2=«а» (diverged,
│                           #   т.к. recommended=«б», rerun_hint=brief) + 1 free_comment
├── analysis_dir/           # build-analysis-docx.mjs: реалистичная фикстура A2
│   ├── A2.md               #   титул -> «0. Вопросы к вам» -> Executive Summary -> разделы 1-5
│   ├── questions.json      #   2 вопроса, синхронные с текстом раздела 0 в A2.md
│   ├── brief.json          #   slug=romashka (имя выходного A2_romashka.docx)
│   └── serp.json           #   verdict.type=ИДЁМ (для цвета вердикта)
└── validate_dir/           # validate-analysis-inputs.mjs: полный канон + новые файлы Этапа 3
    ├── brief.json           # 16-параметровый канон (business_type=services, domain задан, client_pages=[])
    ├── competitors.json     # 2 конкурента (leader.ru, second.ru) с полным набором метрик
    ├── serp.json            # verdict.type=ИДЁМ, stop_list=[avito.ru]
    ├── leader_scan.json     # опционален для validate-analysis-inputs, включён для полноты
    ├── intake.json          # новые файлы Этапа 3 - проверяем, что валидатор их просто
    ├── questions.json       # игнорирует (в тесте «легаси» их удаляют, exit остаётся 0)
    └── ВВОДНЫЕ.md
```

## Как добавить новый тест

Открой `run.mjs`, найди блок `=== ... ===`, добавь:

```js
await step("моя проверка", () => {
  // вернуть true/undefined - PASS, строку с ошибкой - FAIL, SKIP("причина") - SKIP
  if (что-то не так) return "что именно";
  return true;
});
```

Юниты `_questions.mjs` — через `Q.<имя_функции>` (модуль импортирован один раз в начале файла,
`Q` равен `null`, если файл ещё не создан — оборачивай новые юнит-тесты в `if (Q) { ... }`, как
в блоке 1).
