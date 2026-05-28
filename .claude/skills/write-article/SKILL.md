---
name: write-article
description: Полный цикл написания статьи. Аргументы: N (номер темы), --resume.
---

# write-article

Главный скил конвейера. Проходит state machine от JM-анализа до сборки HTML.

## Аргументы

```
/write-article <N> [--resume]
```

- `N` — номер темы в `topics.xlsx` (обязательно).
- `--resume` — продолжить с того места, где остановилось (по `meta.json`).

Одна тема = один вариант = одна статья. Жанр берётся первым из колонки «Жанры» в `topics.xlsx` (остальные — справочно, не используются автоматически).

## State machine

```
init → jm-done → tz-done → writing → sections-done → finalized → awaiting-review
→ audited → enhanced → awaiting-photos → assembled → [tilda-split] → completed
```

`meta.json` — единственный источник истины о текущем состоянии. Обновляется через `.claude/hooks/update-meta.sh <article_dir> <state>`.

## Обработка временных API-ошибок

Любой вызов субагента или MCP-тула может вернуть ошибку `529 Overloaded` / `503 Service Unavailable` / `rate_limit_error` / `tcp reset` от Anthropic API. **Это не баг и не повод останавливать прогон** — поведение скила:

1. Поймал ошибку → не выводить пользователю «упало, перезапустите`/write-article --resume`».
2. `ScheduleWakeup` на 90 секунд (можно 60-180 в зависимости от подозреваемой нагрузки) с тем же `/write-article N --resume`, чтобы продолжить с текущего состояния.
3. После пробуждения — повторить упавший вызов. Если ошибка та же — `ScheduleWakeup` ещё раз, но уже на 180 секунд. Максимум 3 попытки подряд.
4. Если три попытки подряд провалились — только тогда сказать пользователю и попросить вмешательства.

Так пользователь не видит флапающих ошибок Anthropic и не должен сам жонглировать `--resume`.

## Алгоритм

### 0a. Проверка: мы в worktree?

```bash
GIT_DIR=$(git rev-parse --git-dir)
COMMON_DIR=$(git rev-parse --git-common-dir)
```

Если `GIT_DIR == COMMON_DIR` — мы в main. Предупредить, но не блокировать (вдруг пользователь сознательно хочет писать в main):
> «⚠️ Ты пишешь статью в main-сессии. Pre-commit hook здесь не блокирует ничего. Для многозадачности рекомендую закрыть и переоткрыть сессию с галочкой worktree.»

Если разные — мы в worktree, всё ок, продолжаем.

### 0b. Parse args

```
N = <обязательно>
resume = true если --resume
```

### 1. Setup

- Прочитать `topics.xlsx` (лист 1, строка N): `topic`, `main_query`, `ws_freq`, `intent`, `genres`, `priority`, `linking_url`.
- `slug = slugify(topic)`, `dir = articles/<NNN>-<slug>/` где NNN — двузначное-/трёхзначное число с ведущим нулём.

Если `--resume`:
- Найти существующую `articles/<NNN>-*/` по N (или по slug).
- Прочитать `meta.json`. `state = meta.state`.
- Спросить пользователя: «Найдено в состоянии `<state>`, last_completed=`<...>`. Продолжить? [Y/n]»
- Если Y — перейти к ветке алгоритма от следующего шага после `state`.

Иначе:
- **Проверка на повторный запуск той же темы:** если в `articles/` уже есть папка `<NNN>-<slug>` (тот же slug), значит статья по этой теме уже написана. Спросить пользователя:
  > «По теме №N уже есть статья `articles/<NNN>-<slug>/`. Хочешь написать вторую (например, другого жанра для внешней площадки)? Если да — какой жанр взять? Доступные из topics.xlsx: <список из колонки «Жанры»>.»
  
  Если пользователь согласен — продолжить с NNN+1 (новая папка `articles/<NNN+1>-<slug>/`), жанр взять из ответа пользователя. Если отказался — стоп.

- Создать `dir/`, `dir/sections/`, `dir/jm/`, `dir/photos/`.
- Записать `dir/meta.json`:
```json
{
  "topic": "...",
  "query": "...",
  "slug": "...",
  "genre": "<из ответа пользователя ИЛИ первый из topics.xlsx>",
  "state": "init",
  "section_index": 0,
  "completed_steps": [],
  "started": "<ISO UTC>",
  "updated": "<ISO UTC>"
}
```
- Записать `.claude/tmp/current-task.txt` с путём к `dir/` (используется хуками `check-section.sh`, `pause-for-review.sh`, и **критично — pre-commit hook'ом**, который без этого файла откажет в коммите).
- `state = "init"`.

### 2. JM-анализ (если state == "init")

Маркер: `.claude/tmp/expected-jm-analyst-<run_id>.txt = <dir>/jm/analyze.json`

Делегировать `jm-analyst`:
```
main_query: <...>
region_code: <значение поля «Код региона JM» из ЗАКАЗЧИК.md, секция «Основное»; типично 213 для Москвы, 2 для СПб>
article_dir: <dir>
project_root: <...>
Пройди свой пайплайн (шаги A→E внутри agent-промта). Сохрани jm/cluster.json, jm/lsi.json, jm/analyze.json, jm/stop-domains.json.
```

После завершения:
- `update-meta.sh <dir> jm-done`
- ПАУЗА: вывести сводку JM (субагент уже вывел в чат), спросить «ОК или повторить?». Если retry — повторно делегировать.

### 3. ТЗ (если state == "jm-done")

Маркер: `.claude/tmp/expected-tz-builder-<run_id>.txt = <dir>/tz.md`

Делегировать `tz-builder`:
```
article_dir: <dir>
genre: <genre из meta.json>
topic: <...>
main_query: <...>
ws_freq: <...>
intent: <...>
project_root: <...>
```

После завершения:
- `update-meta.sh <dir> tz-done`
- ПАУЗА: вывести план структуры (агент уже вывел), спросить «ОК?». При корректировках — повторно делегировать `tz-builder` с пометкой что менять.

### 4. Секции (если state == "tz-done")

1. Прочитать `<dir>/tz.md`, выписать список H2-заголовков (по порядку появления `## ` в Разделе 5).
2. Создать `<dir>/sections/progress.json` с **минимальной** структурой (если ещё не существует):
```json
{
  "total_sections": <count>,
  "completed_sections": [],
  "current_section": 0
}
```
`total_sections` — посчитать по количеству `## ` в Разделе 5 ТЗ.

**Контракт с section-writer:** агент при **первом** вызове (когда `completed_sections` пуст) дочитывает `progress.json`, парсит `tz.md` и **дополняет** структуру полями `ngrams`, `single_words`, `lsi_obligatory`, `lsi_optional`, `elements`, `section_volumes_target`, `links_inserted`, `pains_closed`, `brand_mentions`, `section_volumes`, `carry_over`. На последующих вызовах — только мерж счётчиков. Скил инициализацией контента N-грамм/LSI **не занимается**.

3. `update-meta.sh <dir> writing`
4. Для `i = 1..total_sections`:
   - Если `--resume` и в `<dir>/sections/` уже есть файл `<NN>-*.md` (где NN — двузначный i) — пропустить.
   - Записать `.claude/tmp/current-task.txt = <dir>` (хук check-section.sh смотрит сюда — это его единственная проверка, маркер expected-file не нужен).
   - Обновить `progress.json.current_section = i`.
   - Делегировать `section-writer`:
     ```
     section_index: <i>
     article_dir: <dir>
     tz_path: <dir>/tz.md
     genre: <genre>
     project_root: <...>
     ```
   - Хук `check-section.sh` сработает после возврата — если exit 2 → разобрать ошибку, при необходимости повторить раздел с пометкой.
   - `update-meta.sh <dir> writing section_index=<i>`
5. После всех разделов: `update-meta.sh <dir> sections-done`

### 5. Финализация (если state == "sections-done")

Маркер: `.claude/tmp/expected-article-finalizer-<run_id>.txt = <dir>/article.md`

Делегировать `article-finalizer`:
```
article_dir: <dir>
project_root: <...>
```

**После завершения — обязательная проверка меток.** Запустить:
```
.claude\scripts\_node.cmd .claude\scripts\verify-markers.mjs <dir>
```
Если exit 2 — финализатор потерял метки `[ФОТО:]`, `[ТАБЛИЦА:]`, `[ДИАГРАММА]`, `[ЦИТАТА]`, `[ИКОНКИ:]`, `[ТАБЫ:]` при склейке. Это блокирующий баг: повторно делегировать `article-finalizer` с явной пометкой «verify-markers ругается на <stderr>, перепиши `article.md`, сохранив все метки 1-в-1, и сверь сам перед записью». Не идти дальше, пока `verify-markers` не вернёт exit 0.

После завершения хук `pause-for-review.sh` автоматически:
- Обновит `meta.json` → `awaiting-review`
- Выведет сообщение пользователю

`update-meta.sh <dir> finalized` (если хук этого не сделал)

**СТОП до пользователя.** Ждать `/continue` или `/edit "..."`.

### 6. (Опц.) Цикл правок текста

Пока пользователь даёт `/edit "<описание>"`:
- Делегировать `article-fixer` с описанием, целевой файл = `<dir>/article.md`.
- Вывести дифф.
- Ждать следующую команду.

Когда пользователь говорит `/continue` — переход к аудиту.

### 7. Аудит (если state == "awaiting-review", после `/continue`)

Маркер: `.claude/tmp/expected-text-auditor-<run_id>.txt = <dir>/audit.md`

Делегировать `text-auditor`:
```
article_dir: <dir>
project_root: <...>
```

После: `update-meta.sh <dir> audited`. Вывести `audit.md` (резюме), ждать решения. Обычно — «продолжай».

### 8. Улучшения (если state == "audited")

Маркер: `.claude/tmp/expected-enhancer-<run_id>.txt = <dir>/enhancements.html`

Делегировать `enhancer`:
```
article_dir: <dir>
project_root: <...>
```

Создаёт три файла: `enhancements.html`, `faq.html`, `schema.json`.

`update-meta.sh <dir> enhanced`

### 9. Фото (если state == "enhanced")

Маркер: `.claude/tmp/expected-photo-promter-<run_id>.txt = <dir>/photos/prompts.md`

Делегировать `photo-promter`:
```
article_dir: <dir>
project_root: <...>
```

`update-meta.sh <dir> awaiting-photos`

Вывести пользователю:
```
Сгенерируй фото по промтам из <dir>/photos/prompts.md.
Затем заполни <dir>/photos/urls.json в формате:
[{"photo": 1, "url": "..."}, {"photo": 2, "url": "..."}]
Когда готово — скажи /continue.
```

**СТОП.** Ждать `/continue`.

### 10. Сборка HTML (если state == "awaiting-photos", после `/continue`)

```
.claude\scripts\_node.cmd .claude\scripts\assemble-html.mjs <dir>
```

`update-meta.sh <dir> assembled`

### 11. Тильда (если state == "assembled" И Платформа == Тильда)

Прочитать `ЗАКАЗЧИК.md`, секция **«Платформа и хостинг»**, поле «Платформа». Если значение содержит «Тильда» (case-insensitive):

```
.claude\scripts\_node.cmd .claude\scripts\tilda-split.mjs <dir>
```

`update-meta.sh <dir> tilda-split`

Если платформа другая — шаг пропустить.

### 12. Финал (если state == "assembled" или state == "tilda-split")

`update-meta.sh <dir> completed`

Сделать финальный коммит в worktree-ветку, чтобы все файлы статьи были в истории:
```
git add -A
git commit -m "Article <NNN>: completed"
```

Вывести:
```
Готово. Статья: <dir>/output.html
Тильда (если применимо): <dir>/tilda/head.html + <dir>/tilda/t123.html
Отчёт: <dir>/report.md
Аудит: <dir>/audit.md

⚠️ НЕ ЗАБУДЬ /handoff перед закрытием сессии — иначе файлы останутся в worktree и не попадут в основную папку проекта.
```

## Вторая статья на ту же тему

Типичный сценарий: одна и та же тема (например, «теплоизоляция кровли») — две статьи разных жанров:
- Статья на сайт клиента (жанр из `topics.xlsx` колонка «Жанры», первый)
- Статья на внешнюю площадку (Дзен, сателлит) — другой жанр (второй из той же колонки)

Технически это два независимых прогона `/write-article` на тот же `N`:

```
/write-article 1     # создаст articles/001-<slug>/, жанр 1 из topics.xlsx
/write-article 1     # создаст articles/002-<slug>/, второй прогон
```

Между прогонами — обычный `/handoff` для каждого (или сделать оба в одном worktree последовательно).

**JM-кеш экономит лимиты:** `jm_text_analyze` кешируется на 4 часа по тем же параметрам, поэтому второй прогон в тот же день не тратит ≥5 лимитов на JM-анализ повторно. По `jm_text_generate` (15 лимитов) кеш не задокументирован — этот вызов может повториться.

**Жанр на второй прогон:** скил спросит «уже есть статья по теме N — какой жанр взять?». Возьми второй из колонки «Жанры» в `topics.xlsx` (там обычно указано 2-3 контрастных жанра, см. `topic-generator`).

Если статьи две — будут две независимые папки (`articles/001-<slug>/` и `articles/002-<slug>/`). Связи «эти две — одна тема» в meta нет; если нужно — фиксируй сам в notes.

## Параллельная работа

Несколько статей одновременно — каждая в своём worktree:
```
claude --worktree art-005
```

Состояние одной статьи (`meta.json` в её папке) не пересекается с другой.

## Запреты

- Не пропускай состояния — каждое `update-meta.sh` обязательно.
- Не запускай `section-writer` для уже написанной секции (если `--resume`).
- Не редактируй `sections/*.md` после `finalized` — только через `article-fixer` по `article.md`.
- Не используй длинное тире (—) и среднее (–). Только дефис (-).
- Не делай git push, не публикуй output.html куда-либо — это решение пользователя.
