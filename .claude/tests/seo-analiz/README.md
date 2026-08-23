# Smoke-тесты `/seo-analiz` (Этап 3 + этап A программы v7)

Регрессионные тесты машинерии Этапа 3 (интейк-канал, раздел «Вопросы к вам», импорт
ответов клиента, финальная проверка) и этапа A программы v7 (словарь rerun_hint v2,
новый STAGE_ORDER, tier-aware валидация - контракты 1.4а/1.6/1.7):

- `_questions.mjs` - единый чистый модуль-хелпер схемы/логики `questions.json`; словарь
  `rerun_hint` v2 (`intake|brief|audience|competitors|leaders|directions|serp|writer|edit`)
  и `STAGE_ORDER` в порядке downstream-цепочки контрактов 1.6
- `apply-answers.mjs` - детерминированное ядро режима `/seo-analiz --answers` (слияние ответов + `rerun_plan.json`),
  включая расхождение по вопросу с новым `rerun_hint` (`audience`)
- `build-analysis-docx.mjs` - рендер раздела «Вопросы к вам» в A2.docx, в обеих формах
  заголовка: «## Вопросы к вам» (текущая) и «## 0. Вопросы к вам» (легаси-A2 у клиентов)
- `validate-analysis-inputs.mjs` - легаси-путь (без `meta.json.tier`: канон-гейт
  `brief`/`competitors`/`serp` как раньше, новые файлы Этапа 3 не ломают) + tier-aware гейт v2:
  basic без `serp.json` и Keyso-полей проходит; v2-формат требует непустых `brief.directions[]`
  с уникальными `dir_slug` и `audience.json`; старый анализ без поля `tier` - по старым правилам

Плюс контракты волны 3 (дефекты revising-цикла - того, что срабатывает уже ПОСЛЕ отдачи
документа клиенту):

- **Пробелы закрываются по идентификатору, а не регуляркой** (`_questions.mjs` +
  `apply-answers.mjs`): элемент `gaps[]` стал объектом `{ id, text }`, у вопроса появилось
  необязательное `closes_gaps: [id]`, снятие идет сверкой id без разбора текста. Легаси-форма
  (`gaps` - массив строк) обязана продолжать работать: строка нормализуется в
  `{ id: null, text }` и механически НЕ закрывается никогда. Регресс, ради которого это
  затевалось: чистка пробелов регулярками по их тексту дала ПЯТЬ ошибочных снятий из восьми
  («возврат Тильды» сняло словом «возврат», «DOR не расшифрован» - словом «DOR»); поймали
  только потому, что печатали каждое снятие с причиной.
- **Запрет на самоназвание - грепабельный список, а не суждение**
  (`validate-analysis-inputs.mjs`): ни одно слово из `brief.forbidden_self_names[]` не
  встречается в `A2.md` и `recommendations.json`, с учетом словоформ и без ложных
  срабатываний внутри других слов. В бою слово «школа» проскочило в служебной прозе
  («комиссия за счет школы») мимо ОБОИХ проходов верификатора - при том что запрет называть
  клиента школой стоял в разделе запрещенных формулировок того же отчета.

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
| 29-31 | `normalizeGap` (канон-объект / легаси-строка / объект без id) | форма пробела: `{ id, text }` проходит как есть (id триммится), СТРОКА нормализуется в `{ id: null, text }`, объект без `id` тоже дает `id: null` |
| 32 | `normalizeGaps: смешанный массив` | строки и объекты в одном `gaps[]` нормализуются поштучно; не-массив -> `[]` |
| 33 | `questionClosesGaps` | нет поля -> `[]`; пустые/не-строковые элементы отброшены, id триммится |
| 34-35 | `validateQuestionsSchema: closes_gaps отсутствует / []` | поле НЕОБЯЗАТЕЛЬНО: легаси-`questions.json` валиден, вопрос, который ничего не закрывает, - норма |
| 36-37 | `validateQuestionsSchema: closes_gaps - строка / с пустым элементом` | блокирующая проблема на форме поля (не массив; элемент - не непустая строка-id, с индексом) |
| 38 | `validateQuestionsSchema: closes_gaps с несуществующим id -> не блокирует` | осознанная граница: чистый модуль не читает `intake.json`/`brief.json` и множества живых id не видит; опечатку ловит `apply-answers.mjs` (#51) |
| 39 | `apply-answers.mjs: базовый прогон -> exit 0` | `rerun_plan.json` создан |
| 40 | `apply-answers.mjs: questions.json.answers заполнены + метаданные` | `answer` на каждый вопрос, `answers_source`, `answers_imported_at`, `free_comments` перенесены |
| 41 | `apply-answers.mjs: rerun_plan.json` | согласие -> bucket `none`; расхождение -> bucket = `rerun_hint`; `deepest_stage`; `free_comments_count` |
| 42 | `apply-answers.mjs: все согласны + free_comment -> deepest_stage == edit` | правило «нет buckets, но есть комментарии -> edit» |
| 43 | `apply-answers.mjs: расхождение по q4 (rerun_hint=audience)` | новый словарь v2 проходит схему и попадает в buckets/`deepest_stage` |
| 44 | `apply-answers.mjs: битый questions.json -> exit 2` | схема нарушена (нет `recommended`) блокирует |
| 45 | `apply-answers.mjs: нет answers.json -> exit 1` | ошибка запуска (не схема) |
| 46 | `apply-answers.mjs: пробел из closes_gaps отвеченного вопроса снимается` | механическое закрытие по `id` работает и в `intake.json`, и в `brief.json` |
| 47 | `apply-answers.mjs: пробел вне closes_gaps и пробел неотвеченного вопроса остаются` | обратная сторона того же: снимается ТОЛЬКО названный id и только у отвеченного вопроса; форма оставшегося элемента цела |
| 48 | `apply-answers.mjs: снятие печатается построчно` | счетчик «Закрыто пробелов: N» + строка на каждое снятие (какой id, каким вопросом) - без этой печати ошибочное снятие невидимо |
| 49 | `apply-answers.mjs: ЛЕГАСИ-форма gaps (массив строк)` | импорт ответов не падает, строковые пробелы (`id: null`) не снимаются НИКОГДА, форма элементов цела |
| 50 | `apply-answers.mjs: смешанные gaps` | объект с названным id снят, легаси-строка рядом осталась строкой |
| 51 | `apply-answers.mjs: closes_gaps ссылается на несуществующий id` | опечатка писателя не блокирует импорт, но названа вслух (пробел остался бы висеть молча) |
| 52 | `apply-answers.mjs: битый intake.json` | опциональный файл с битым JSON не валит импорт ответов и не перезаписывается |
| 53 | `questionsToRows` на фикстуре `analysis_dir` | то же что #28, но на реалистичной фикстуре A2 |
| 54 | `build-analysis-docx.mjs: смоук с questions.json` | exit 0, `A2_romashka.docx` создан и не пуст |
| 55 | `build-analysis-docx.mjs: без questions.json -> graceful` | не падает без `questions.json`, docx собирается из markdown, проза раздела вопросов остается в документе |
| 56 | `build-analysis-docx.mjs: «## Вопросы к вам» (без номера)` | текущая форма заголовка опознана: в docx рендер из `questions.json`, markdown-дубликат заглушен, документ ниже раздела цел |
| 57 | `build-analysis-docx.mjs: легаси «## 0. Вопросы к вам»` | то же самое для A2, сданных клиентам до снятия номеров разделов (регулярка принимает обе формы) |
| 58 | `validate-analysis-inputs.mjs: полный канон + новые файлы -> exit 0` | новые артефакты Этапа 3 не ломают гейт (легаси-путь, meta.json нет) |
| 59 | `validate-analysis-inputs.mjs: легаси (без intake/questions/ВВОДНЫЕ) -> exit 0` | регрессия-страж: старые анализы без Этапа 3 продолжают проходить |
| 60 | `validate-analysis-inputs.mjs: сломан канон -> exit 2` | блокирующий контракт `brief`/`competitors`/`serp` не тронут |
| 61 | `validate-analysis-inputs.mjs: meta.json без поля tier -> exit 0` | старый анализ валидируется по старым правилам (directions/audience не требуются) |
| 62 | `validate-analysis-inputs.mjs: tier=basic -> exit 0` | basic без `serp.json`, `keyso_base` и Keyso-метрик direct[] проходит; directions+audience на месте (контракт 1.4а) |
| 63 | `validate-analysis-inputs.mjs: tier=seo v2 полный -> exit 0` | базлайн: канон + directions + audience при seo проходит |
| 64 | `validate-analysis-inputs.mjs: tier=seo v2 без audience.json -> exit 2` | v2-формат требует `audience.json` (summary + >= 1 сегмент, контракт 1.7) |
| 65 | `validate-analysis-inputs.mjs: tier=seo v2 пустые directions -> exit 2` | v2-формат требует непустой `brief.directions[]` |
| 66 | `validate-analysis-inputs.mjs: дубль dir_slug -> exit 2` | слаги направлений должны быть уникальны (контракт 1.7) |
| 67 | `самоназвание: запрещенное слово в служебной прозе A2.md -> exit 2` | боевой кейс «комиссия за счет школы»: файл, НОМЕР СТРОКИ и сам оборот названы в сообщении |
| 68 | `самоназвание: словоформа в recommendations.json -> exit 2` | машиночитаемый выход проверяется наравне с прозой («школами» при запрете «школа»); его читают `/seo-struktura` и `/seo-tekst` и исполняют буквально |
| 69-70 | `самоназвание: пустой массив / нет ключа -> exit 0` | запретов нет - проверять нечего; легаси-`brief.json` без нового поля не блокируется |
| 71 | `самоназвание: ложных срабатываний внутри других слов нет -> exit 0` | «школьник», «дошкольное» (основа «школ» целиком внутри слова) и «курсант» (основа «курс») обязаны проходить; заодно проверяется info-строка о числе запретов и списке файлов |
| 72 | `самоназвание: строка-декларация запрета -> exit 0` | писатель обязан перечислить запрет в разделе запрещенных формулировок - иначе гейт падал бы на каждом корректном отчете |
| 73 | `самоназвание: forbidden_self_names не массив -> exit 2` | форма поля (массив строк); отсутствие и пустой массив - норма |

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
  [test] самоназвание: forbidden_self_names не массив -> exit 2 (проверка формы поля) ... PASS

=== 73/73 tests passed (0 skipped) ===
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
│   ├── A2.md               #   титул -> «Вопросы к вам» -> Executive Summary -> разделы без номеров
│   │                       #   (Данные клиента, Конкуренты, Скан смыслов топ-3, Анализ выдачи,
│   │                       #   Смежные направления); легаси-форму «0. Вопросы к вам» тест
│   │                       #   подставляет сам поверх копии в sandbox
│   ├── questions.json      #   2 вопроса, синхронные с текстом раздела вопросов в A2.md
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

Файлов волны 3 в фикстурах НЕТ намеренно - все они опциональны для своих скриптов, и тесты
раскладывают их в песочнице под конкретный случай:

- `intake.json`/`brief.json` c `gaps[]` и `closes_gaps` у вопросов - тесты #46-52
  (`gapsScenario` в блоке 2). Если положить их в `fixtures/answers_dir/`, изменится вывод и
  поведение уже существующих тестов #39-45, которые про пробелы ничего не знают.
- `A2.md`/`recommendations.json` для запрета самоназвания - тесты #67-73 (`selfNameCase` в
  блоке 5), поверх копии `validate_dir/` с подставленным `brief.forbidden_self_names`.

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
