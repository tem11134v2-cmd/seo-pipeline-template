---
name: custom-question
description: Разбирает нестандартный вопрос/проблему/нестыковку заказчика на основе файлов проекта. Обязательный гейт трактовки (варианты + уточнения через AskUserQuestion, с опцией «передать заказчику»), затем решение в удобном формате - готовый текст ответа, рекомендация проджекту или документ, без SEO-жаргона. Успешные решения фиксируются в QA-ЖУРНАЛ.md. Аргументы - [вопрос | путь к файлу] [--resume] [--format auto|answer|recommendation|doc].
---

# custom-question

Скил-оркестратор разбора нестандартных вопросов заказчика. Запускается **в worktree-сессии**. Собирает контекст по файлам проекта, обязательно проверяет вопрос на варианты трактовки и уточняет недостающее (один раунд `AskUserQuestion`), пишет решение в нужном формате и фиксирует результат в память проекта.

Раньше нестандартные вопросы (нестыковки, претензии, «а почему у нас так», кусок переписки с вопросом) разбирал владелец агентства лично. Этот скил снимает разбор с владельца, опираясь на всю фактуру проекта.

Клиентские части ответа - **без сложных SEO-терминов**: заказчик должен понять с первого прочтения.

## Аргументы

```
/custom-question [<вопрос текстом> | <путь к файлу>] [--resume] [--format auto|answer|recommendation|doc]
```

- Позиционный: либо текст вопроса, либо путь к файлу с фактурой (переписка, транскрибация). Если не передан и нет `--resume` - скил спросит в чате.
- `--resume` - продолжить незавершенную задачу (по `meta.json` самой свежей `questions/NNN-*/`). Также точка входа после того, как заказчик ответил на `client_questions.md`.
- `--format` - желаемый формат выхода. `auto` (по умолчанию) - solution-writer сам выберет по типу вопроса. `answer` - готовый текст ответа заказчику. `recommendation` - рекомендация действий проджекту. `doc` - документ (в этом этапе - Markdown).

## State machine

```
init -> context-done -> clarified -> drafted -> verified -> delivered -> completed
                    \-> awaiting-client --(--resume)--> clarified -> ...
```

| State | Достигается когда | Следующий шаг |
|---|---|---|
| `init` | папка создана, `question_raw.txt`/`meta.sources` записаны | шаг 2 (context-gatherer) |
| `context-done` | `context.json` собран (факты + gaps + conflicts + трактовки) | шаг 3 (гейт трактовки) |
| `awaiting-client` | на гейте выбрано «передать»; `client_questions.md` сгенерен; стоп | ждать ответы -> `--resume` -> шаг 3.5 |
| `clarified` | трактовка выбрана, `interpretation.json` записан (гейт напрямую ИЛИ через resume) | шаг 4 (solution-writer) |
| `drafted` | `solution.md` (+ `answer_client.md` если нужно) собран | шаг 5 (solution-verifier) |
| `verified` | `verify_report.json` verdict=pass | шаг 6 (выдача) |
| `delivered` | решение показано ассистенту/в чат | шаг 7 (QA-журнал) |
| `completed` | QA-запрос сгенерен (+ опц. kb_upsert по явной просьбе); финальный коммит | конец, дальше `/handoff` |

`meta.json` - единственный источник истины о состоянии. Обновляется через `bash .claude/hooks/update-meta.sh questions/NNN-<slug> <state> [k=v ...]`.

**Гейт трактовки - РОВНО ОДИН раунд `AskUserQuestion`.** Повторного гейта на resume нет: после `awaiting-client` ответы заказчика вливаются в контекст и скил идет сразу к solution-writer.

## Артефакты

```
questions/NNN-<slug>/
  meta.json            # state machine (единственный источник истины)
  question_raw.txt     # исходный вопрос: текст ИЛИ плейсхолдер-указатель на файл
  context.json         # context-gatherer: факты с источниками + gaps + conflicts + 2-4 трактовки
  interpretation.json  # итог гейта: выбранная трактовка + ответы на уточнения + флаг escalated
  client_questions.md  # (только при escalate) вопросы заказчику человеческим языком
  client_answers.txt   # (только при --resume после escalate) ответы заказчика/проджекта
  solution.md          # solution-writer: решение + обязательный блок «Что я не проверял»
  answer_client.md     # (только format=answer) готовый текст ответа заказчику, без жаргона/тире/е-с-точками
  verify_report.json   # solution-verifier: вердикт + issues
  journal_entry.md     # готовая запись для QA-ЖУРНАЛ.md (тело shared-edit запроса)
```

### meta.json (схема)

```json
{
  "state": "init",
  "slug": "<slug>",
  "nnn": "NNN",
  "format_arg": "auto",
  "chosen_format": null,
  "interpretation": null,
  "escalated": false,
  "sources": ["question_raw.txt"],
  "verify_attempts": 0,
  "journal_requested": false,
  "started": "<ISO UTC>",
  "updated": "<ISO UTC>",
  "completed_steps": []
}
```

- `format_arg` - что просил пользователь (`auto|answer|recommendation|doc`).
- `chosen_format` - что реально выбрал solution-writer (для `auto` резолвится на шаге решения; для явного формата равен `format_arg`).
- `interpretation` - краткая метка выбранной трактовки (из context.json) после гейта.
- `escalated` - был ли раунд с «передать заказчику».

## Алгоритм

### 0. Проверки

**Worktree (жесткий отказ, как /seo-temi):**
```bash
GIT_DIR=$(git rev-parse --git-dir)
COMMON_DIR=$(git rev-parse --git-common-dir)
```
Если `GIT_DIR == COMMON_DIR` (мы в main) - **отказать и остановиться**:
> «/custom-question работает только в worktree. QA-запись в общий QA-ЖУРНАЛ.md идет через shared-edit, а pre-commit тут не изолирует задачу. Открой сессию с галочкой worktree и запусти снова.»

Не продолжать в main - единообразие worktree-модели важнее удобства быстрого вопроса.

**ЗАКАЗЧИК.md НЕ требуется.** Вопрос может прийти на раннем проекте. Если файла нет - context-gatherer это учтет.

### 1. Setup

**Без `--resume`:**
1. Получить фактуру:
   - Если позиционный аргумент передан ТЕКСТОМ - это вопрос.
   - Если передан ПУТЬ к файлу - **не читать его в свой контекст.** Запомнить путь.
   - Если ничего не передано - спросить: «Дай вопрос заказчика - вставь текст или укажи путь к файлу (переписка/транскрибация). Если это большой файл - именно путь, не вставляй содержимое.»
2. `NNN = max(существующие questions/NNN-*/) + 1` (3-значное, ведущий ноль; если папки `questions/` нет - `001`).
3. `slug` - латинский kebab из вопроса через транслит `_slug.mjs`. Взять первые 3-5 значимых слов вопроса и прогнать через `slugifyBase` (транслит + `[^a-z0-9]+`->дефис + обрезка). Инлайн-хелпер:
   ```bash
   node -e "import('./.claude/scripts/_slug.mjs').then(m=>console.log(m.slugifyBase(process.argv[1])))" "<первые 3-5 слов вопроса>"
   ```
   Fallback при пустом результате - `vopros`.
4. Создать `questions/NNN-<slug>/`.
5. Записать фактуру:
   - Текст -> `questions/NNN-<slug>/question_raw.txt` (одним `Write`).
   - Путь -> `question_raw.txt` = одна строка-плейсхолдер «Источник вопроса: <путь> (см. meta.sources)».
6. Записать `.claude/tmp/current-task.txt = questions/NNN-<slug>` (**критично - без этого pre-commit откажет в коммите**).
7. Создать `meta.json` (схема выше; `format_arg` = значение `--format` или `auto`; `sources` = `["question_raw.txt"]` + путь приложенного файла если был).
8. `state = "init"`. Перейти к шагу 2 (context-gatherer).

**С `--resume`:**
- Найти самую свежую `questions/<max NNN>-*/`, прочитать `meta.json`.
- Спросить: «Найдено в состоянии `<state>`, обновлено `<updated>`. Продолжить? [Y/n]».
- Ветвление по state:
  - `init` -> шаг 2 (context-gatherer)
  - `context-done` -> шаг 3 (гейт)
  - `awaiting-client` -> шаг 3.5 (влить ответы заказчика)
  - `clarified` -> шаг 4 (solution-writer)
  - `drafted` -> шаг 5 (solution-verifier)
  - `verified` -> шаг 6 (выдача)
  - `delivered` -> шаг 7 (QA-журнал)
  - `completed` -> стоп: «Вопрос уже разобран. Артефакты в questions/NNN-<slug>/.»

Идемпотентность: каждый шаг проверяет, нет ли уже своего выходного файла; при `--resume` - пропускает готовое.

### 2. context-gatherer (state == "init")

Маркер:
```
.claude/tmp/expected-context-gatherer-<run_id>.txt:
  <abs>/questions/NNN-<slug>/context.json
```

Делегировать `context-gatherer`:
```
project_root: <abs>
task_dir: questions/NNN-<slug>
question_path: questions/NNN-<slug>/question_raw.txt
extra_sources: [<пути из meta.sources кроме question_raw.txt, если есть>]
format_arg: <meta.format_arg>

Прочитай вопрос по question_path (+ extra_sources - если это приложенный файл фактуры, читай сам,
не жди его в промте). Собери релевантный контекст по файлам проекта (ЗАКАЗЧИК.md, последний анализ,
стратегии/структуры/аудиты/тексты - что есть, прошлый QA-ЖУРНАЛ.md). Дай 2-4 варианта трактовки
вопроса, релевантные факты с источниками, чего не хватает (gaps с человеческой формулировкой),
обнаруженные противоречия. Запиши context.json. В чат - максимум 8 строк.
```

После возврата:
- `check-file.sh` (SubagentStop) проверит `context.json`. Если пуст/нет - ре-делегировать с явным указанием (parent-fallback запрещен - оркестратор сам файл не пишет).
- `bash .claude/hooks/update-meta.sh questions/NNN-<slug> context-done`
- Сводку агента (<=8 строк) - в чат. Сами факты не выводить (они в файле). Перейти к шагу 3.

### 3. ГЕЙТ ТРАКТОВКИ - ровно один раунд AskUserQuestion (state == "context-done")

Прочитать `context.json` точечно: массив `interpretations` (2-4) + `gaps` (поля `question`, `options`, `client_phrasing`). Весь файл не тянуть - взять эти два массива.

Собрать ОДИН вызов `AskUserQuestion`, до 4 вопросов:

1. **Вопрос 1 (всегда) - трактовка.** «Как правильно понимать вопрос заказчика?»
   - options: по одному на каждую трактовку из `interpretations` (label - краткая метка, description - расшифровка).
   - + опция «Не знаю - передать проджекту/заказчику».
   - (UI Claude Code Desktop также дает свой вариант / Other - это ок.)
2. **Вопросы 2-4 - недостающие вводные** из `gaps` (по одному gap = один вопрос, в пределах лимита 4).
   - options - из `gap.options`.
   - + у КАЖДОГО вопроса опция «Не знаю - передать проджекту/заказчику».

Разбор ответов:
- **Если хоть один ответ = «передать проджекту/заказчику»** -> escalate:
  - Сгенерить `client_questions.md` - готовые вопросы заказчику ЧЕЛОВЕЧЕСКИМ языком (без жаргона), из `gap.client_phrasing` по эскалированным пунктам (+ если эскалирована сама трактовка - переформулировать «правильно ли мы понимаем, что...» по вариантам трактовок). Уже отвеченные пункты записать в `interpretation.json` (чтобы не спрашивать повторно).
  - Записать `interpretation.json`: `{ "chosen": <или null если трактовку эскалировали>, "gate_answers": {...}, "escalated_items": [...] }`.
  - `bash .claude/hooks/update-meta.sh questions/NNN-<slug> awaiting-client escalated=true`
  - Вывести пользователю блок «Вопросы заказчику готовы» + путь `client_questions.md` + инструкцию: «Проджект уносит их клиенту. Когда ответы будут - `/custom-question --resume` и вставь ответы (или путь к файлу).»
  - **Стоп. Не идти дальше.**
- **Если все ответы получены (без «передать»)**:
  - Записать `interpretation.json`: `{ "chosen": "<метка трактовки>", "gate_answers": {...}, "escalated_items": [] }`.
  - `bash .claude/hooks/update-meta.sh questions/NNN-<slug> clarified interpretation="<метка>"`
  - Перейти к шагу 4.

### 3.5 Влить ответы заказчика (resume из awaiting-client)

- Спросить/принять ответы: текст в чат или путь к файлу. Текст записать в `questions/NNN-<slug>/client_answers.txt`; путь зафиксировать в `meta.sources` (файл в главный контекст не читать).
- Обновить `interpretation.json`: заполнить эскалированные пункты из ответов, проставить итоговую `chosen`-трактовку (если ее эскалировали - взять из ответа заказчика).
- **Повторного AskUserQuestion-гейта НЕ делать** (правило «ровно один раунд»).
- `bash .claude/hooks/update-meta.sh questions/NNN-<slug> clarified`
- Перейти к шагу 4.

### 4. solution-writer (state == "clarified")

Маркер:
```
.claude/tmp/expected-solution-writer-<run_id>.txt:
  <abs>/questions/NNN-<slug>/solution.md
```

Делегировать `solution-writer`:
```
project_root: <abs>
task_dir: questions/NNN-<slug>
question_path: questions/NNN-<slug>/question_raw.txt
context_path: questions/NNN-<slug>/context.json
interpretation_path: questions/NNN-<slug>/interpretation.json
client_answers_path: questions/NNN-<slug>/client_answers.txt   # если есть
extra_sources: [<пути приложенной фактуры>]
format_arg: <meta.format_arg>

Прочитай вопрос, context.json, interpretation.json (+ client_answers если есть). Реши формат
(если format_arg=auto - по типу вопроса: короткий вопрос-недопонимание -> answer;
вопрос-задача -> recommendation; сложное/официальное -> doc; иначе явный format_arg).
Напиши решение в solution.md. Клиентские части - без SEO-жаргона. Обязательный блок
«Что я не проверял» (границы уверенности). Если формат answer - дополнительно answer_client.md:
готовый текст ответа заказчику, БЕЗ тире и без буквы е-с-точками. В чат - максимум 8 строк
(что за формат, путь к файлам).
```

После возврата:
- `check-file.sh` проверит `solution.md`. Если формат `answer` - дополнительно проверить, что `answer_client.md` создан и непуст (иначе ре-делегация).
- Прочитать точечно `chosen_format` из фронтматтера `solution.md` ИЛИ из короткой сводки агента; записать в meta: `bash .claude/hooks/update-meta.sh questions/NNN-<slug> drafted chosen_format=<...>`.
- Перейти к шагу 5.

### 5. solution-verifier (state == "drafted")

Маркер:
```
.claude/tmp/expected-solution-verifier-<run_id>.txt:
  <abs>/questions/NNN-<slug>/verify_report.json
```

Делегировать `solution-verifier`:
```
project_root: <abs>
task_dir: questions/NNN-<slug>

Прочитай solution.md (+ answer_client.md если есть), context.json, interpretation.json, вопрос
и файлы проекта, на которые ссылается решение. Проверь: факты/цифры/обещания опираются на файлы
проекта (нет выдуманного); клиентские части без жаргона; вопрос отвечен во всех гранях выбранной
трактовки; блок «Что я не проверял» присутствует и честен; в клиентских текстах нет тире и
е-с-точками. Ничего не чини. Запиши verify_report.json.
```

После - прочитать `verify_report.json` точечно (`verdict` + `counters`):
- `verdict == pass` -> `bash .claude/hooks/update-meta.sh questions/NNN-<slug> verified` -> шаг 6.
- `verdict == needs-fix|fail` -> ре-делегировать `solution-writer` с issues из отчета. **Лимит 2 повтора** (`meta.verify_attempts`, инкрементировать перед каждой ре-делегацией). После 2 без pass - показать issues пользователю и спросить «Отдать как есть или доработаешь вручную?».

### 6. Выдача (state == "verified")

Прочитать `chosen_format` из meta.

- **format == answer:** вывести в чат ГОТОВЫЙ ТЕКСТ ОТВЕТА заказчику целиком (из `answer_client.md`). Это КЛИЕНТСКИЙ текст - на выходе не должно быть тире и буквы е-с-точками (энфорс промптом solution-writer + чек solution-verifier; если verifier поймал - сюда не дойдет). Плюс 1-2 строки «откуда взято» для ассистента.
- **format == recommendation | doc:** вывести КРАТКОЕ резюме (3-6 строк: суть решения + главные действия) + путь к `solution.md`. Полный текст в чат не лить.

`bash .claude/hooks/update-meta.sh questions/NNN-<slug> delivered` -> шаг 7.

### 7. QA-журнал - фиксация в память (state == "delivered")

**a) Сгенерить запись** `questions/NNN-<slug>/journal_entry.md` (готовое тело для общего файла):

```markdown
## <дата YYYY-MM-DD> - NNN - <вопрос одной строкой>
- Трактовка: <выбранная трактовка>
- Формат ответа: <answer|recommendation|doc>
- Решение: <2-3 строки сути>
- Передавалось заказчику: <да/нет>
- Артефакты: questions/NNN-<slug>/solution.md<, answer_client.md если есть>
```

Ключ записи - дата + NNN (самодостаточен для дедупа при обработке в main).

**b) Сгенерить shared-edit запрос** через механизм `/request-shared-edit`:
- Создать `.claude/handoff-requests/<timestamp>-question-NNN.md` (по формату request-shared-edit).
- В «Запрос»: «Добавить запись в QA-ЖУРНАЛ.md (создать файл в корне, если его нет)».
- В «Контекст»: вставить целиком содержимое `journal_entry.md`; указать - если `QA-ЖУРНАЛ.md` отсутствует, создать с шапкой `# QA-журнал проекта` и добавить запись; если существует - добавить запись ВВЕРХ (после шапки, новые записи сверху). Это ключ create-if-absent + append-сверху.
- «Затрагиваемые файлы»: `QA-ЖУРНАЛ.md`.
- Закоммитить запрос:
  ```bash
  git add .claude/handoff-requests/<file> questions/NNN-<slug>
  git commit -m "Question NNN (<slug>): solved, QA journal request"
  ```
- `bash .claude/hooks/update-meta.sh questions/NNN-<slug> completed journal_requested=true`

**c) kb_upsert - ТОЛЬКО по явной просьбе пользователя.** По умолчанию в общую MCP-базу знаний агентства НЕ пишем (память = `QA-ЖУРНАЛ.md` проекта). Если пользователь в этом прогоне явно попросил записать разбор в базу знаний - best-effort `kb_upsert` краткой карточки решенного вопроса; при недоступности MCP или ошибке - молча пропустить, на state не влияет.

### 8. Финал

```
=== ВОПРОС РАЗОБРАН ===
Папка: questions/NNN-<slug>/
Формат: <answer|recommendation|doc>
Трактовка: <метка>
Передавалось заказчику: <да/нет>

Артефакты:
  questions/NNN-<slug>/solution.md
  [questions/NNN-<slug>/answer_client.md - готовый текст ответа]

Память:
  QA-запись уйдет в QA-ЖУРНАЛ.md через /handoff -> /handoff-process
  [kb_upsert: записано по запросу / не запрашивалось]

Дальше:
  /handoff  -> в main /handoff-process (применит запись в QA-ЖУРНАЛ.md)
========================
```

## Запреты

- НЕ запускай в main - жесткий отказ (шаг 0). Только worktree.
- НЕ читай большой файл фактуры (переписку/транскрибацию) в главный контекст оркестратора - передавай путь агенту.
- НЕ выводи промежуточные факты/JSON в чат - только пути + короткие сводки (ORCHESTRATION.md).
- НЕ делай второй раунд AskUserQuestion - гейт ровно один.
- НЕ правь `QA-ЖУРНАЛ.md` напрямую из worktree - только через shared-edit запрос.
- НЕ пиши в общую MCP-базу знаний по умолчанию - kb_upsert только по явной просьбе пользователя.
- НЕ используй длинное тире (—) и среднее (–). Только дефис (-).
- НЕ используй букву ё - всегда пиши е. Правило для всех клиентских текстов.
- Все промежуточные результаты - в файлы task-папки, не в чат.
