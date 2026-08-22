# Smoke-тесты `/seo-analiz` (Этап 3 + этап A программы v7)

Регрессионные тесты машинерии Этапа 3 (интейк-канал, раздел «0. Вопросы к вам», импорт
ответов клиента, финальная проверка) и этапа A программы v7 (словарь rerun_hint v2,
новый STAGE_ORDER, tier-aware валидация - контракты 1.4а/1.6/1.7):

- `_questions.mjs` - единый чистый модуль-хелпер схемы/логики `questions.json`; словарь
  `rerun_hint` v2 (`intake|brief|audience|competitors|leaders|directions|serp|writer|edit`)
  и `STAGE_ORDER` в порядке downstream-цепочки контрактов 1.6
- `apply-answers.mjs` - детерминированное ядро режима `/seo-analiz --answers` (слияние ответов + `rerun_plan.json`),
  включая расхождение по вопросу с новым `rerun_hint` (`audience`)
- `build-analysis-docx.mjs` - рендер раздела «0. Вопросы к вам» в A2.docx
- `validate-analysis-inputs.mjs` - легаси-путь (без `meta.json.tier`: канон-гейт
  `brief`/`competitors`/`serp` как раньше, новые файлы Этапа 3 не ломают) + tier-aware гейт v2:
  basic без `serp.json` и Keyso-полей проходит; v2-формат требует непустых `brief.directions[]`
  с уникальными `dir_slug` и `audience.json`; старый анализ без поля `tier` - по старым правилам

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
| 8 | `ALLOWED_RERUN_HINTS: точный словарь v2` | set-эквивалентность контракту 1.6 (9 значений, без лишних) |
| 9 | `STAGE_ORDER: канон-ступени v2 в порядке downstream-цепочки` | относительный порядок `intake -> brief -> audience -> competitors -> leaders -> directions -> serp -> writer -> edit` |
| 10 | `validateQuestionsSchema: новые rerun_hint v2 валидны` | `intake`/`audience`/`directions` принимаются схемой |
| 11 | `validateQuestionsSchema: N=2 (вне 3-7) -> только мягкий warn` | количество вопросов вне 3-7 не блокирует (различается через `isBlockingProblem`) |
| 12 | `isBlockingProblem: отличает warn-строку от блокирующей проблемы` | контракт различения warn/блок |
| 13-14 | `optionMatchesRecommended` | буква варианта совпадает/не совпадает с `recommended` |
| 15-17 | `isAgreeAnswer` | «согласен с рекомендованным» / «как рекомендуете» -> true; обычный вариант ответа -> false |
| 18-21 | `classifyAnswer` | answer==recommended и isAgreeAnswer -> `as_recommended`/`none`; расхождение -> `diverged`/`rerun_hint`; пусто/null -> `unanswered`/`none` |
| 22-27 | `deepestStage` | порядок глубины по STAGE_ORDER v2, вкл. новые ступени (`intake` глубже всех, `directions` глубже `serp`, `audience` глубже `leaders`) |
| 28 | `questionsToRows` (юнит) | N строк, `recommended`/`options` перенесены без потерь |
| 29 | `apply-answers.mjs: базовый прогон -> exit 0` | `rerun_plan.json` создан |
| 30 | `apply-answers.mjs: questions.json.answers заполнены + метаданные` | `answer` на каждый вопрос, `answers_source`, `answers_imported_at`, `free_comments` перенесены |
| 31 | `apply-answers.mjs: rerun_plan.json` | согласие -> bucket `none`; расхождение -> bucket = `rerun_hint`; `deepest_stage`; `free_comments_count` |
| 32 | `apply-answers.mjs: все согласны + free_comment -> deepest_stage == edit` | правило «нет buckets, но есть комментарии -> edit» |
| 33 | `apply-answers.mjs: расхождение по q4 (rerun_hint=audience)` | новый словарь v2 проходит схему и попадает в buckets/`deepest_stage` |
| 34 | `apply-answers.mjs: битый questions.json -> exit 2` | схема нарушена (нет `recommended`) блокирует |
| 35 | `apply-answers.mjs: нет answers.json -> exit 1` | ошибка запуска (не схема) |
| 36 | `questionsToRows` на фикстуре `analysis_dir` | то же что #28, но на реалистичной фикстуре A2 |
| 37 | `build-analysis-docx.mjs: смоук с questions.json` | exit 0, `A2_romashka.docx` создан и не пуст |
| 38 | `build-analysis-docx.mjs: без questions.json -> graceful` | не падает без `questions.json`, docx собирается из markdown |
| 39 | `validate-analysis-inputs.mjs: полный канон + новые файлы -> exit 0` | новые артефакты Этапа 3 не ломают гейт (легаси-путь, meta.json нет) |
| 40 | `validate-analysis-inputs.mjs: легаси (без intake/questions/ВВОДНЫЕ) -> exit 0` | регрессия-страж: старые анализы без Этапа 3 продолжают проходить |
| 41 | `validate-analysis-inputs.mjs: сломан канон -> exit 2` | блокирующий контракт `brief`/`competitors`/`serp` не тронут |
| 42 | `validate-analysis-inputs.mjs: meta.json без поля tier -> exit 0` | старый анализ валидируется по старым правилам (directions/audience не требуются) |
| 43 | `validate-analysis-inputs.mjs: tier=basic -> exit 0` | basic без `serp.json`, `keyso_base` и Keyso-метрик direct[] проходит; directions+audience на месте (контракт 1.4а) |
| 44 | `validate-analysis-inputs.mjs: tier=seo v2 полный -> exit 0` | базлайн: канон + directions + audience при seo проходит |
| 45 | `validate-analysis-inputs.mjs: tier=seo v2 без audience.json -> exit 2` | v2-формат требует `audience.json` (summary + >= 1 сегмент, контракт 1.7) |
| 46 | `validate-analysis-inputs.mjs: tier=seo v2 пустые directions -> exit 2` | v2-формат требует непустой `brief.directions[]` |
| 47 | `validate-analysis-inputs.mjs: дубль dir_slug -> exit 2` | слаги направлений должны быть уникальны (контракт 1.7) |

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
  [test] validate-analysis-inputs.mjs: дубль dir_slug в brief.directions -> exit 2 ... PASS

=== 47/47 tests passed (0 skipped) ===
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
├── answers_dir/            # apply-answers.mjs: 4 вопроса (разные rerun_hint) + 2 ответа
│   ├── questions.json      #   q1/q2 rerun_hint=brief, q3=writer, q4=audience (словарь v2);
│   │                       #   q1 recommended=а, q2 recommended=б, q3/q4 остаются без ответа
│   └── answers.json        # q1=«согласен с рекомендованным» (as_recommended), q2=«а» (diverged,
│                           #   т.к. recommended=«б», rerun_hint=brief) + 1 free_comment
├── analysis_dir/           # build-analysis-docx.mjs: реалистичная фикстура A2
│   ├── A2.md               #   титул -> «0. Вопросы к вам» -> Executive Summary -> разделы 1-5
│   ├── questions.json      #   2 вопроса, синхронные с текстом раздела 0 в A2.md
│   ├── brief.json          #   slug=romashka (имя выходного A2_romashka.docx)
│   └── serp.json           #   verdict.type=ИДЁМ (для цвета вердикта)
├── validate_dir/           # validate-analysis-inputs.mjs: полный канон + новые файлы Этапа 3
│   ├── brief.json           # 16-параметровый канон (business_type=services, domain задан, client_pages=[]);
│   │                        #   meta.json НЕТ - легаси-путь; v2-варианты (meta.tier=seo + directions +
│   │                        #   audience.json из validate_dir_basic) тесты собирают поверх копии в sandbox
│   ├── competitors.json     # 2 конкурента (leader.ru, second.ru) с полным набором метрик
│   ├── serp.json            # verdict.type=ИДЁМ, stop_list=[avito.ru]
│   ├── leader_scan.json     # опционален для validate-analysis-inputs, включен для полноты
│   ├── intake.json          # новые файлы Этапа 3 - проверяем, что валидатор их просто
│   ├── questions.json       # игнорирует (в тесте «легаси» их удаляют, exit остается 0)
│   └── ВВОДНЫЕ.md
└── validate_dir_basic/     # tier-aware v2: basic-анализ (контракты 1.4а/1.7)
    ├── meta.json            # tier=basic (включает v2-требования валидатора)
    ├── brief.json           # БЕЗ keyso_base; directions[] из 2 направлений (уникальные dir_slug)
    ├── competitors.json     # direct[] только с domain - без Keyso-метрик и path
    └── audience.json        # summary + 1 сегмент (dir_slugs -> directions) + audience_wordings;
                             # serp.json отсутствует НАМЕРЕННО (при basic не требуется)
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
