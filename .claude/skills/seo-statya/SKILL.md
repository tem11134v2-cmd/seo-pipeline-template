---
name: seo-statya
description: Полный цикл написания статьи. Аргументы: N (номер темы), --resume, --review, --auto.
---

# seo-statya

Главный скил конвейера. Проходит state machine от JM-анализа до сборки HTML.

## Аргументы

```
/seo-statya <N | N-M | N,M,K> [--resume] [--review | --auto] [--with-handoff]
                   [--genre="<жанр>"] [--platform=site|external|social]
                   [--rebuild-docx] [--finalize-batch]
```

- `N` — номер темы в `topics.xlsx` (обязательно). Принимает три формы:
  - **одна тема**: `/seo-statya 5` — обычный одиночный прогон;
  - **диапазон**: `/seo-statya 11-20` — серия тем 11..20 подряд в одной worktree (см. «Серийный режим»);
  - **список**: `/seo-statya 11,12,15` — перечисленные темы.
- `--finalize-batch` — пересобрать только серийный финал (папка-экспорт + сводная таблица метатегов) по уже готовым статьям диапазона, минуя написание. Полезно если Drive был недоступен или после ручных правок. Работает только с диапазоном/списком (или `all`).
- `--resume` — продолжить с того места, где остановилось (по `meta.json`).
- `--review` — режим с ручной проверкой после финализации. Скил останавливается на `awaiting-review`, ждёт `/continue` или `/edit "..."`. Полезно для ответственных текстов.
- `--auto` — самодостаточный режим (по умолчанию). Никаких пауз, скил доводит до `completed` без участия пользователя. Эквивалентно отсутствию обоих флагов — `--auto` явно указывает поведение.
- `--with-handoff` — после `completed` автоматически вызвать `/handoff` (закрыть worktree, смержить в main). Только в комбинации с `--auto`. Опасный флаг — выбирай осознанно, потому что handoff удаляет ветку и закрывает сессию для дальнейших правок. В `--review` игнорируется.
- `--genre="<жанр>"` — явный выбор жанра (должен быть из колонки «Жанры» темы в topics.xlsx). По умолчанию — первый доступный (см. правила повтора ниже). Если значение не из xlsx — стоп с сообщением «Жанр <X> отсутствует в колонке Жанры темы N. Доступные: <список>.»
- `--platform=site|external|social` — целевая площадка (влияет на жанр и автора). По умолчанию `site` — основной блог клиента.
- `--rebuild-docx` - recovery-режим: пересобрать только `.docx` уже готовой статьи и перезалить в Drive, минуя весь state machine. Позиционный аргумент = id готовой статьи (номер темы `TTT` или полный basename папки `005-slug-dko`). Несовместим с остальными флагами. Алгоритм и детали - REFERENCE.md#rebuild-docx (шаг 0c перенесен туда).

**Базовый режим — `--auto`.** Запуск `/seo-statya 1` без флагов идёт без пауз до конца. Чтобы получить пошаговый контроль — `/seo-statya 1 --review`.

## Серийный режим (диапазон/список тем)

Если `N` - диапазон (`11-20`) или список (`11,12,15`), скил пишет несколько статей подряд в одной worktree-сессии и в конце автоматически собирает результат - без отдельных просьб «сделай папку» и «сделай файл метатегов». Это штатный режим. Очередь тем ведется в `.claude/tmp/batch-queue.json` через движок `.claude/scripts/batch-queue.mjs` (субкоманды `init` / `next` / `set` / `status`): файл session-scoped и gitignored, переживает авто-компакт контекста и дает идемпотентный resume. Оркестратор ветвится по exit-коду и counters движка, не вычитывая всю очередь в контекст.

**Как идет (на очереди batch-queue.json):**

1. `batch-queue.mjs init "<spec>" [--mode auto|review]` - создать/освежить очередь (идемпотентно: при повторе состояния `done`/`failed` сохраняются, новые темы добавляются как `pending`). Режим по умолчанию `--auto`; `--review` для серии допустим, но даст паузы на каждой статье.
2. Цикл:
   a. `batch-queue.mjs next` - взять первую незавершенную тему (приоритет у `in-progress` - прерванной, иначе первая `pending`). exit 3 (`{"done":true}`) -> выйти из цикла к шагу 15 (серийный финал).
   b. `batch-queue.mjs set <N> in-progress` (после шага 1b дополнить `--dir <article_dir>`).
   c. Выполнить обычный одиночный алгоритм (шаги 1-14) для темы N до `completed`.
   d. Успех: `batch-queue.mjs set <N> done --dir <dir> --genre <g>`. Проблема (verify не сошелся за лимит, коллизия жанра в `--auto`, fail-fast секции): `batch-queue.mjs set <N> failed --reason "<кратко>"` и **перейти к следующей** (не валить весь батч - изоляция сбоев). Временные 529/503 - НЕ `failed`: это ScheduleWakeup + `--resume` (REFERENCE.md#api-errors), тема остается `in-progress`.
   e. Папку статьи дописать в `current-task.txt` (append-if-missing, Block D) и записать `current-article.txt` (однострочный активный указатель для хуков, см. шаг 1b).
3. Шаг 15 (серийный финал) - REFERENCE.md#serial-final.

**Resume и авто-компакт.** `batch-queue.json` - источник истины серии, `meta.json` - источник истины статьи. После авто-компакта контекста НЕ восстанавливать состояние из чата: перечитать `.claude/tmp/batch-queue.json` (какая тема `in-progress`/`pending`) + `<article_dir>/meta.json` текущей темы (на каком state статья) и продолжить с этого места. `--resume` для серии = ровно идемпотентный `batch-queue.mjs init` + цикл `next`; из чата ничего не поднимаем.

Подробности (изоляция сбоев, `--finalize-batch`, семантика `--resume`, несколько статей одной темы, коллизия двух серий) - REFERENCE.md#serial-mode-details.

Одиночный запуск (`/seo-statya 5`) серийный финал НЕ запускает - у него обычное финальное сообщение шага 14.

## State machine

```
init → jm-done → tz-done → writing → sections-done → finalized →
  [awaiting-review (только в --review)] →
  audited → audit-applied → enhanced → photos-generated → photos-published →
  assembled → verified → [tilda-split] → docx-built → [shared (если gdrive доступен)] → completed
```

`meta.json` — единственный источник истины о текущем состоянии. Обновляется через `.claude/hooks/update-meta.sh <article_dir> <state>`.

Поле `meta.mode` принимает значения `"auto"` или `"review"` — задаётся при `Setup`.

## Обработка временных API-ошибок

Ошибки `529 Overloaded` / `503 Service Unavailable` / `rate_limit_error` / `tcp reset` от Anthropic API - не баг и не повод останавливать прогон. Не показывать их пользователю: сделать `ScheduleWakeup` (60-180с, старт с 90с) с тем же `/seo-statya N --resume` и повторить упавший вызов; максимум 3 попытки подряд, только после этого просить вмешательства. В серии временная 529/503 НЕ помечает тему `failed` (тема остается `in-progress`). Полная схема (тайминги, эскалация) - REFERENCE.md#api-errors.

## Алгоритм

Все гейты-проверки конвейера (exit-код -> действие -> лимит -> при исчерпании) сведены в единую таблицу REFERENCE.md#retries; ниже они описаны по месту в соответствующих шагах.

### 0a. Проверка: мы в worktree?

```bash
GIT_DIR=$(git rev-parse --git-dir)
COMMON_DIR=$(git rev-parse --git-common-dir)
```

Если `GIT_DIR == COMMON_DIR` — мы в main. Предупредить, но не блокировать:
> «⚠️ Ты пишешь статью в main-сессии. Pre-commit hook здесь не блокирует ничего. Для многозадачности рекомендую закрыть и переоткрыть сессию с галочкой worktree.»

### 0b. Parse args

```
N = <обязательно>
resume = true если --resume
mode = "review" если --review, иначе "auto"
```

При `--resume` режим берётся из существующего `meta.mode` (флаг не должен переключать режим на половине прогона).

**Детект серии.** Зафиксировать `spec = <исходный аргумент N>` (он же передаётся в скрипты шага 15).

- Если `N` содержит `-` (диапазон) или `,` (список) - это **серийный режим**: зафиксировать `spec` и идти по разделу «Серийный режим». Парсинг spec в отсортированный список тем делает движок `batch-queue.mjs init` (та же логика, что раньше жила здесь), а не оркестратор - это часть диеты контекста.
- Если `N == "all"` (имеет смысл только с `--finalize-batch`) - **серийный финал по всем готовым статьям**: `spec = "all"`, сразу к шагу 15; список тем (`completed`-папки `articles/*`) считает `batch-queue.mjs`, не оркестратор.
- Если передан `--finalize-batch` с диапазоном/списком - сразу к шагу 15 по `spec` (цикл написания пропускается).
- Если `N` - одно число (без `--finalize-batch`) - всё как раньше (одиночный прогон, без шага 15).

### 0c. Режим --rebuild-docx (recovery)

Если передан `--rebuild-docx` - это не полный прогон, а быстрая пересборка docx уже готовой статьи (state machine не запускается). Позиционный аргумент = id готовой статьи (не номер темы). Полный алгоритм (детерминированный резолв папки через `resolve-article-dir.mjs`, пересборка docx с exit-3-ретраем, удаление старого файла в Drive, перезаливка, обновление `meta.share` со свежим `build_script_commit`, recovery-цикл по нескольким статьям) - целиком в REFERENCE.md#rebuild-docx. Выполнить по нему и остановиться.

### 1. Setup

- Выбрать тему №N **по колонке `№`** (не по физической строке - строки бывают отфильтрованы/переставлены/со сдвигом шапки). Детерминированно, через парсер:
  ```
  .claude\scripts\_node.cmd .claude\scripts\read-topics-xlsx.mjs . --by-number N
  ```
  Вернёт `{ exists, found, requested, topic, available_numbers }`. Из `topic` берём: `n` (= `topic_id`), `topic`, `main_query`, `ws_freq`, `intent`, `genres`, `priority`, `linking_url`.
  - `exists == false` → стоп: «`topics.xlsx` не найден в корне. Сначала `/seo-temi` (или положи темник).»
  - `found == false` → стоп: «В `topics.xlsx` нет темы №N. Доступные номера: `<available_numbers>`.» НЕ угадывать и НЕ брать соседнюю строку.
- `topic_id = topic.n` (= N). Это **сквозная ось идентичности**: аргумент N = номер темы = номер папки (шаг 1b) = `meta.topic_id`.
- `genres_in_xlsx = topic.genres` (жанры из колонки «Жанры (2-3)»).
- `slug = slugify(topic.topic)`.

#### 1a. Чтение индекса и логика коллизий

Пересобрать производный индекс и прочитать его (он gitignored - в свежей worktree может отсутствовать):
```
.claude\scripts\_node.cmd .claude\scripts\rebuild-index.mjs articles
```
Затем прочитать `articles/_index.json`, найти записи с `topic_id == N`. Это `existing_articles`. У каждой уникальный `key` (= имя папки); `nnn`/`topic_id` могут повторяться - это норма для нескольких статей одной темы.

`genres_done = existing_articles.map(a => a.genre)`
`genres_available = genres_in_xlsx - genres_done`

**Если `--resume`:**
- Найти все `existing_articles` с `state != "completed"`. Если их несколько — взять самую недавнюю по `updated` (или по NNN, как fallback). Прочитать её `meta.json`, продолжить с её состояния. В `--auto` — без вопросов. В `--review` — короткое «Найдено NNN в state `<state>`, продолжать? [Y/n]».
- Если всех таких нет (все completed) — сказать пользователю: «Все статьи по теме N завершены. Запусти `/seo-statya N` без --resume, чтобы написать новую (в другом жанре).» Стоп.

**Если `--resume` НЕ передан:**

Развилка по `existing_articles`:

- **0 записей** — обычный сценарий. Жанр:
  - Если флаг `--genre="..."` передан и значение есть в `genres_in_xlsx` → использовать его.
  - Иначе → `genres_in_xlsx[0]` (первый).
  - `platform_target` — из `--platform` или `"site"`.
  - Идём к 1b.

- **>=1 запись, есть `genres_available`** - частичный повтор. Кратко: валидный `--genre="X"` из `genres_available` - берем без вопросов; `--genre="X"`, который уже в `genres_done` - стоп с вопросом (даже в `--auto`, это коллизия скоупа); без флага в `--auto` - берем `genres_available[0]` + первую свободную площадку из приоритета `["site","external","social"]`, уведомляем одной строкой; без флага в `--review` - спрашиваем жанр. Точные под-случаи, приоритет площадок и формулировки - REFERENCE.md#collision-genre.

- **`genres_available` пуст (все жанры уже использованы)** - спросить в обоих режимах (переписать существующую по NNN / следующая тема N+1 / отмена). Формулировка вопроса - REFERENCE.md#collision-genre.

#### 1b. Создание директории и meta.json

- **Номер папки = номер темы** (точка 2): `TTT = zero-pad(topic_id, 3)` (тема 5 → `005`). НЕ `max+1` - число детерминировано, гонки счётчика при параллельных worktree нет.
- **Суффикс = 3 случайные строчные латинские буквы** (`a-z`), напр. `dko`. Развязывает коллизию имени, когда у одной темы несколько статей (разные жанры/площадки) или две worktree пишут одну тему параллельно.
- `dir = articles/<TTT>-<slug>-<rand3>/`. Перед созданием проверить, что папки `articles/<TTT>-<slug>-<rand3>` нет; если есть - перегенерировать суффикс. NNN (= `TTT`) больше НЕ уникален; уникален полный basename папки.
- Создать `dir/`, `dir/sections/`, `dir/jm/`, `dir/photos/`.
- Записать `dir/meta.json`:
```json
{
  "topic": "...",
  "topic_id": <N — номер темы из колонки № (НЕ индекс физической строки)>,
  "query": "...",
  "slug": "...",
  "genre": "<выбранный жанр>",
  "platform_target": "<site|external|social>",
  "mode": "<auto|review>",
  "state": "init",
  "section_index": 0,
  "completed_steps": [],
  "started": "<ISO UTC>",
  "updated": "<ISO UTC>"
}
```
- **Дописать** путь к `dir/` в `.claude/tmp/current-task.txt` отдельной строкой, **если его там ещё нет** (append-if-missing, НЕ перезапись). В одиночном режиме это первая и единственная строка; в серийном - набор папок всех статей батча накапливается, и pre-commit (Block D) разрешит коммит их всех разом. Существующие строки других задач серии не трогать.
- **Перезаписать** `.claude/tmp/current-article.txt` одной строкой = путь к `dir/` (активный указатель статьи для SubagentStop-хуков `check-section.sh` и `mark-finalized.sh`). В отличие от `current-task.txt` (multi-line реестр владения для pre-commit), это ровно одна строка - текущая активная статья. В серии перезаписывается на каждой новой теме; в одиночном режиме пишется один раз. Хуки читают его, а при отсутствии файла падают на `head -n 1 current-task.txt` (обратная совместимость одиночного режима).
- Хук `update-meta.sh` сам обновит `articles/_index.json` через `update-index.mjs` (best-effort).
- `state = "init"`.

### 2. JM-анализ (если state == "init")

**Перед делегированием — проверить кеш индекса.** Если в `articles/_index.json` уже есть completed-статья с тем же `topic_id` (это бывает при второй статье на ту же тему — например, другой жанр для внешней площадки):

1. Найти существующий `<source_dir>/jm/*.json` (cluster.json, lsi.json, analyze.json, stop-domains.json).
2. Скопировать все 4 файла в текущий `<dir>/jm/`.
3. `update-meta.sh <dir> jm-done`
4. Пропустить делегирование `jm-analyst` — экономия ~20 JM-лимитов на статью.

В `--review` спросить пользователя «Использовать существующий jm/ из <source_dir>? [Y/n]». В `--auto` — копируем автоматически.

Если кеша нет (или пользователь отказался) — обычный путь:

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
- **В `--auto`** — сразу к шагу 3, никаких подтверждений.
- **В `--review`** — вывести сводку JM, спросить «ОК или повторить?». Если retry — повторно делегировать.

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

**Проверка фото-бюджета (точка 6):** после возврата tz-builder запустить
```
.claude\scripts\_node.cmd .claude\scripts\verify-photo-budget.mjs <dir>
```
exit 2 → ТЗ занизило число фото (вероятно срезало «из-за таблиц»). Повторно делегировать `tz-builder` с пометкой: «число фото зависит ТОЛЬКО от жанра+объёма (таблица «Расстановка [ФОТО]»); таблицы - ДРУГОЙ бюджет, фото не уменьшают; добери метки [ФОТО:] до нижней границы вилки». Лимит 2 повтора; дальше - предупреждение в чат и продолжить (не блокировать намертво, фото добираются позже).

После завершения:
- `update-meta.sh <dir> tz-done`
- **В `--auto`** — сразу к шагу 4.
- **В `--review`** — вывести план структуры, спросить «ОК?». При корректировках — повторно делегировать `tz-builder` с пометкой что менять.

### 4. Секции (если state == "tz-done")

1. Прочитать `<dir>/tz.md`, выписать список H2-заголовков (по порядку появления `## ` в Разделе 5). **Не включай введение** — его пишет `article-finalizer` отдельным шагом перед H1 (как лид без `## `). Если в Разделе 5 случайно появилось «## H2: Введение» (баг tz-builder) — пропусти этот заголовок и сделай предупреждение в чат: «tz.md содержит введение как H2 — пропускаю, оно будет написано финализатором».
2. Создать `<dir>/sections/progress.json` с минимальной структурой (если ещё не существует):
```json
{
  "total_sections": <count>,
  "completed_sections": [],
  "current_section": 0
}
```

**Контракт с section-writer:** агент при первом вызове (когда `completed_sections` пуст) дочитывает `progress.json`, парсит `tz.md` и дополняет структуру полями `ngrams`, `single_words`, `lsi_obligatory`, `lsi_optional`, `elements`, `section_volumes_target`, `links_inserted`, `pains_closed`, `brand_mentions`, `section_volumes`, `carry_over`. На последующих вызовах — только мерж счётчиков.

3. `update-meta.sh <dir> writing`
4. Для `i = 1..total_sections`:
   - Если `--resume` и в `<dir>/sections/` уже есть файл `<NN>-*.md` — пропустить.
   - **Анти-дубликат (баг #4):** если НЕ пропускаем по `--resume`, перед делегированием удалить все существующие `<dir>/sections/<NN>-*.md` (NN = `i` с ведущим нулём, например `04-*.md`). Это детерминированно держит инвариант «1 секция = 1 файл»: при повторном запуске (ретрай по exit 2 или правка) section-writer может выбрать другой slug из переформулированного H2 и оставить второй файл с тем же номером. Удаление glob-ом гарантирует, что номер занимает ровно один файл.
   - Убедиться, что `<dir>` есть в `.claude/tmp/current-task.txt` (append-if-missing; НЕ перезаписывать файл целиком - в серии там папки других статей). И **перезаписать** `.claude/tmp/current-article.txt` одной строкой = `<dir>` - чтобы `check-section.sh` валидировал секцию именно этой статьи, а не первой в батче.
   - Обновить `progress.json.current_section = i`.
   - Делегировать `section-writer`:
     ```
     section_index: <i>
     article_dir: <dir>
     tz_path: <dir>/tz.md
     genre: <genre>
     mode: <auto|review из meta.mode>
     project_root: <...>
     ```
   - Хук `check-section.sh` сработает после возврата — если exit 2 → разобрать ошибку, при необходимости повторить раздел с пометкой. **Перед повтором так же удалить `<dir>/sections/<NN>-*.md`** (см. анти-дубликат выше) — иначе предыдущая попытка останется вторым файлом.
   - **Fail-fast:** если section-writer вернул сообщение с «⚠ check-section вернул один и тот же exit 2 дважды подряд» — **не делегируй заново для этой секции в `--auto`-режиме**. Останови прогон, выведи пользователю stderr хука и попроси вмешательства (исправить хук или содержимое вручную). В `--review` — то же. Это страховка от бесконечного цикла и сжигания токенов на сломанном хуке. **В серийном режиме** не останавливай весь батч - пометь тему `failed` в очереди (`batch-queue.mjs set <N> failed --reason "<кратко>"`) и переходи к следующей (см. «Серийный режим», цикл п.2d).
   - `update-meta.sh <dir> writing section_index=<i>`
5. После всех разделов: `update-meta.sh <dir> sections-done`

### 5. Финализация (если state == "sections-done")

**Перед делегированием — sanity-check прогресса:**
```
.claude\scripts\_node.cmd .claude\scripts\verify-progress.mjs <dir>
```
Скрипт сверяет `sections/progress.json` с фактическим содержимым `sections/*.md`: число H2, объёмы по секциям, реальные вхождения топ-N-грамм. Exit 0 — расхождений нет (или ≤10%); exit 1 — warning (10-30%), писать в `meta.warnings` и идти дальше; exit 2 — блокирующее расхождение (>30%). При exit 2 в `--auto` — остановиться и попросить пользователя проверить (обычно это значит, что секции были записаны вручную в обход section-writer'а, и счётчики устарели).

Перед делегированием **перезаписать** `.claude/tmp/current-article.txt` одной строкой = `<dir>` (чтобы SubagentStop-хук `mark-finalized.sh` проставил `finalized` именно этой статье, а не первой в батче).

Маркер: `.claude/tmp/expected-article-finalizer-<run_id>.txt = <dir>/article.md`

Делегировать `article-finalizer`:
```
article_dir: <dir>
project_root: <...>
```

**После завершения — обязательная проверка артефактов:**

1. **Файлы существуют (баг #2):** `<dir>/article.md`, `<dir>/report.md` и `<dir>/metatags.json` (Block A) должны быть записаны. Если какого-то нет:
   - **Ре-делегация (лимит 2):** повторно делегировать `article-finalizer` с пометкой «report.md, article.md и metatags.json - рабочие артефакты конвейера, обязаны быть записаны через Write по абсолютным путям; содержимое в чат НЕ возвращать».
   - Хук `check-file.sh` (expected-маркер) ловит «файл не создан» и без явной проверки. **Parent-fallback ЗАПРЕЩЕН** (docs/ORCHESTRATION.md п.б): оркестратор НЕ записывает файл за агента - иначе весь объем артефакта проходит через его контекст. Единственная правильная реакция на «агент не записал файл» - ре-делегация.
   - После 2 ре-делегаций без файла - **стоп** с просьбой к пользователю проверить `article-finalizer` вручную. Дальше с битым состоянием не идти.

2. **Метки сохранены (баг #3):** `verify-markers.mjs <dir>` (сверяет и число, и **тело** меток побайтово). exit 2 - финализатор потерял/перефразировал метку: ре-делегировать `article-finalizer` с требованием сохранить все метки 1-в-1 (включая текст внутри скобок) и сверить тела перед записью. Лимит ретраев 2; при исчерпании - **стоп** с последним stderr и просьбой ручной правки `article.md` (не идти дальше с битыми метками). exit 0 - продолжать. Детали ретрая - REFERENCE.md#retries.

3. **Метатеги валидны (Block A):** `verify-article-metatags.mjs <dir>` (Title <=60, Description <=160, H1 != Title, уникальность Title/Description/Анонс, нет длинных тире, H1 совпадает с `# ` в `article.md`). exit 2 - ре-делегировать `article-finalizer` (перепиши `metatags.json` и раздел «## Метатеги» в `report.md`, соблюдая лимиты и уникальность), лимит 2; при исчерпании - предупреждение в чат и продолжить (метатеги поправимы позже через сводную таблицу серии). exit 1 - `metatags.json` не записан: вернуться к проверке #1. exit 0 - продолжать. Детали - REFERENCE.md#retries.

Затем хук `mark-finalized.sh` устанавливает `meta.state = finalized` (не делает паузу — управление паузой целиком на скиле).

- **В `--auto`** — сразу к шагу 7 (без шага 6 и без паузы).
- **В `--review`** — `update-meta.sh <dir> awaiting-review`. Вывести сообщение:
  > Файл: `<dir>/article.md`. Метатеги + отчёт: `<dir>/report.md`.
  > /continue — переход к аудиту, /edit "описание" — точечная правка через article-fixer.

  СТОП. Ждать `/continue` или `/edit "..."`.

### 6. (Только в --review) Цикл правок текста

Пока пользователь даёт `/edit "<описание>"`:
- Делегировать `article-fixer` (одна правка) с описанием, целевой файл = `<dir>/article.md`.
- Вывести дифф. Ждать следующую команду.

Когда `/continue` — переход к аудиту.

### 7. Аудит (если state == "finalized" или "awaiting-review")

Маркер: `.claude/tmp/expected-text-auditor-<run_id>.txt = <dir>/audit.md`

Делегировать `text-auditor`:
```
article_dir: <dir>
project_root: <...>
```

`update-meta.sh <dir> audited`

### 7b. Авто-применение правок (если state == "audited")

Делегировать `article-fixer-batch`:
```
article_dir: <dir>
severity_filter: "critical+important"
project_root: <...>
```

Агент применяет правки одним проходом, пишет `applied.json` и `diff.md`.

После:
- `update-meta.sh <dir> audit-applied`
- **В `--auto`** — сразу шаг 8.
- **В `--review`** — вывести резюме из applied.json, спросить «применить ещё косметику? [N/y]». Если y — повторно делегировать с `severity_filter: "all"`.

### 8. Улучшения (если state == "audit-applied")

Маркер: `.claude/tmp/expected-enhancer-<run_id>.txt = <dir>/enhancements.html`

Делегировать `enhancer`:
```
article_dir: <dir>
project_root: <...>
```

Создаёт три файла: `enhancements.html`, `faq.html`, `schema.json`.

`update-meta.sh <dir> enhanced`

### 9. Промты фото (если state == "enhanced")

Маркер: `.claude/tmp/expected-photo-promter-<run_id>.txt = <dir>/photos/prompts.md`

Делегировать `photo-promter`:
```
article_dir: <dir>
project_root: <...>
```

**Кросс-чек (баг #5):** после photo-promter запустить
```
.claude\scripts\_node.cmd .claude\scripts\verify-photos.mjs <dir>
```
Скрипт сверяет число меток `[ФОТО:]` в `article.md` с числом блоков «## Фото N» в `photos/prompts.md` (источник истины — `article.md`; `urls.json` на этом шаге ещё нет, он проверится на 9b). Если exit 2 → photo-promter рассинхронился: повторно делегировать с пометкой «verify-photos: <stderr> — перечитай `article.md` и сформируй ровно столько блоков «## Фото N», сколько меток `[ФОТО:]»`. Лимит 2 повтора, дальше стоп с диагностикой.

`update-meta.sh <dir> photos-generated` (используется как промежуточное состояние перед публикацией).

### 9b. Авто-генерация и публикация фото (если state == "photos-generated")

После готового `photos/prompts.md` фото генерирует и публикует агент `photo-producer` - оркестратор сам этого НЕ делает (экономия 8-14 вызовов на статью). Агент читает `photos/prompts.md`, на каждое фото вызывает MCP генерации (`mcp__openrouter-image__generate_image`, модель nano-banana-2) и публикации (`mcp__cloudinary-publish__publish_image`), пишет `photos/urls.json` и возвращает <=3 строки счетчиков.

1. **Проверка доступности MCP.** Через `ToolSearch` убедиться, что доступны `mcp__openrouter-image__generate_image` и `mcp__cloudinary-publish__publish_image`.
   - Тулов нет в выдаче -> НЕ падать сразу. Ветка ожидания/аварийного режима (cold-start, wait/`ScheduleWakeup` 60-90с x2, `data:`-fallback, профилактика) - целиком в REFERENCE.md#photo-offline. Прочитать этот раздел и действовать по нему. `ScheduleWakeup` делает ОРКЕСТРАТОР (агент этого не умеет).
2. **Делегировать `photo-producer`:**
   ```
   article_dir: <dir>
   project_root: <...>
   ```
   Маркер: `.claude/tmp/expected-photo-producer-<run_id>.txt = <dir>/photos/urls.json`
   Агент генерирует и публикует каждое фото по порядку, делает per-photo ретраи (до 2), пишет `photos/urls.json` (по записи на фото, включая слоты с `todo`). Возврат - только счетчики (G/K сгенерировано, P/K опубликовано, T отложено) + путь к файлу; содержимое `urls.json`, промты и base64 в чат НЕ возвращаются.
3. **Кросс-чек:** `.claude\scripts\_node.cmd .claude\scripts\verify-photos.mjs <dir>` (только exit-код). Сверяет число записей в `urls.json` с метками `[ФОТО:]` в `article.md`. exit 2 - рассинхрон числа фото: см. REFERENCE.md#retries (записи с `todo` допустимы и не блокируют).
4. Если `photo-producer` вернул T>0 (отложенные фото) и MCP жив - можно один раз ре-делегировать по остатку. Если MCP оффлайн - зафиксировать skip в `meta` (REFERENCE.md#photo-offline) и идти дальше, статья не встает.
5. `update-meta.sh <dir> photos-published`

В `--review` после публикации показать 1 строку счетчиков `photo-producer` и спросить «продолжать? [Y/n]».

### 10. Сборка HTML (если state == "photos-published")

```
.claude\scripts\_node.cmd .claude\scripts\assemble-html.mjs <dir>
```

`update-meta.sh <dir> assembled`

#### 10b. Метрики читаемости (если state == "assembled")

После сборки HTML — посчитать метрики и дописать раздел «Метрики» в `report.md`:
```
.claude\scripts\_node.cmd .claude\scripts\metrics-report.mjs <dir>
```

Скрипт считает: слов в body/FAQ/итого, число H2/H3, число и уникальность ссылок, вхождения корня главного запроса, фото-coverage, упрощённый Flesch-RU читаемости. Если метрики выглядят странными (например, тотал ниже целевого, Flesch < 30 «очень сложный») — в `--review` режиме показать пользователю; в `--auto` — оставить как есть, метрики попадут в `report.md` для последующего ревью.

### 10c. Финальная верификация статьи (если state == "assembled")

Независимая вычитка ФИНАЛЬНЫХ артефактов агентом `article-verifier` - ПОСЛЕ сборки HTML (шаг 10) и метрик (10b), но ДО сборки docx (шаг 12) и заливки в Drive (шаг 13). Так docx собирается один раз по уже проверенному контенту. Агент читает `article.md` + `output-NNN.html` + `report.md` (включая FAQ и enhancements, которые до этого никто не вычитывал), сверяет с `tz.md`, свипает букву е-с-точками и тире по финальному HTML, сверяет метки фото. Он НИЧЕГО не чинит - только пишет `verify_report.json`.

Маркер: `.claude/tmp/expected-article-verifier-<run_id>.txt = <dir>/verify_report.json`

1. Делегировать `article-verifier`:
   ```
   article_dir: <dir>
   project_root: <...>
   ```
2. Прочитать из возврата только вердикт (агент возвращает <=5 строк: verdict + счетчики critical/important/minor + путь). issues[] в контекст оркестратора НЕ читать - они в файле, их читает fixer.
3. Ветвление по вердикту:
   - `pass` (нет critical/important) -> `update-meta.sh <dir> verified`, к шагу 11.
   - `needs-fix` (есть critical/important, структура цела) -> цикл фиксов (лимит 2 цикла):
     a. Делегировать `article-fixer-batch` с `source: verify_report.json`, `severity_filter: "critical+important"`. Он читает файл сам и роутит каждую правку по полю `issue.where` (article.md / faq.html / enhancements.html / report.md), правит именно этот файл. Только ТЕКСТОВЫЕ правки (формулировки, е/тире, опечатки, фактические мелочи). Если issue помечен как структурный (блок надо перегенерировать, а не поправить текст) - это НЕ к fixer: ре-делегировать `enhancer` по затронутому блоку.
     b. Пересобрать при правках: `.claude\scripts\_node.cmd .claude\scripts\assemble-html.mjs <dir>` (если менялись article.md / faq.html / enhancements.html - чтобы правки попали в output-NNN.html). docx на этом шаге НЕ трогаем (он еще не собран - в этом и смысл позиции верификатора до docx).
     c. Повторно делегировать `article-verifier` (перечитывает исправленные артефакты и перезаписывает `verify_report.json` целиком). Если снова `needs-fix` - это второй и последний цикл. После 2 циклов: в `--auto` записать остаток в `meta.warnings` и идти дальше (minor/остаточное не блокирует); в `--review` показать вердикт и спросить. Детали лимитов - REFERENCE.md#retries.
   - `fail` (структурный дефект: пропал H2, битый/пустой HTML, нет article.md) -> **стоп** с диагностикой. В серии - `batch-queue.mjs set <N> failed --reason "verifier: fail"` и к следующей теме.
4. `update-meta.sh <dir> verified`

### 11. Тильда (если state == "verified" И Платформа == Тильда)

Если в `ЗАКАЗЧИК.md` (секция «Платформа и хостинг», поле «Платформа») платформа - Тильда, разбить собранный HTML на head/body для переноса (`tilda-split.mjs <dir>`, state -> `tilda-split`). Если платформа другая - шаг пропустить с логированием (state остается `verified`). Механика ветки, точные команды и формат skip - REFERENCE.md#tilda.

### 12. Сборка .docx (если state == "verified" или "tilda-split")

Финальный deliverable — Word-документ с метатегами в шапке, текстом статьи, картинками из Cloudinary (inline) и FAQ. Загружается на Google Drive (см. шаг 13) и попадает к команде клиента.

```
.claude\scripts\_node.cmd .claude\scripts\build-article-docx.mjs <dir>
```

Создаст `<dir>/Article_<NNN>_<slug>.docx` (Block F: номер темы в имени - чтобы файл сам себя называл в общей папке Drive «Статьи»). Точное имя скрипт печатает строкой `[build-article-docx] wrote <путь>` - бери путь оттуда. Скрипт сам качает картинки с Cloudinary по URL из `<dir>/photos/urls.json` (с ретраями скачивания 0/2/5с).

**Проверка полноты (баг #6):** скрипт печатает `Photos embedded: X/Y` и при `X < Y` завершается с **exit 3** (docx собран, но неполный - часть фото не скачалась даже после ретраев). Поймать сигнал по exit-коду:
- `0` → всё встроено, идти дальше.
- `3` → НЕ заливать docx в Drive (шаг 13). Перезапустить `build-article-docx.mjs` ещё раз (транзиентный сбой Cloudinary обычно проходит). Если после повтора снова `3` — стоп, показать пользователю строку `Photos embedded: X/Y` и stderr, попросить проверить URL в `photos/urls.json`. Лимит 2 повтора.
- `1` → ошибка ввода (нет обязательного файла) — разобрать stderr.

`update-meta.sh <dir> docx-built`

### 13. Загрузка docx на Google Drive (если state == "docx-built")

Внутренний шаг, повторяет логику скила `/share-article` (можно вызвать его напрямую через `Skill share-article <NNN>` или выполнить шаги вручную — результат одинаковый).

1. Прочитать `~/.claude/seo-knowledge/DRIVE.md`, найти Drive folder ID типа «Статьи». Если якоря нет — пропустить шаг с логированием:
   ```
   update-meta.sh <dir> docx-built skip_reason="Drive upload: в DRIVE.md нет якоря «Статьи»"
   ```
   Оставить локальный docx, в финальном выводе попросить пользователя добавить якорь в DRIVE.md.
2. `mcp__gdrive-piotr__uploadFile` с параметрами:
   - `localPath: <dir>/Article_<NNN>_<slug>.docx` (точный путь - из вывода `build-article-docx.mjs`)
   - `convertToGoogleFormat: true`, `parentFolderId: <articles_folder_id>`, `name: Article_<NNN>_<slug>`
   - **`mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"` (баг #7)** — задавать явно, не полагаться на авто-детект по расширению (без него MCP иногда возвращает «Cannot convert MIME type application/octet-stream to a Google Workspace format»).
3. **Sanity-check (баг #7):** проверить, что ответ uploadFile содержит непустой `id`/ссылку (`Size: 1 bytes` у Google Doc — норма после конвертации, не ошибка). Best-effort `getDocumentInfo`/`readGoogleDoc` (maxLength=100): «Docs API not enabled» — это ОК (фича выключена), а пустой документ — признак битого аплоада → 1 ретрай. **`meta.share` записывать только при подтверждённом upload.**
4. `meta.share = { docx_url, drive_id, mime_type: "application/vnd.google-apps.document", build_script_commit: "<вывод git log -1 --format=%h -- .claude/scripts/build-article-docx.mjs>", shared_at: "<ISO UTC>" }` — поле `build_script_commit` (улучшение #6) помогает понять, какие статьи собраны до фикса скрипта и подлежат `--rebuild-docx`.
5. `update-meta.sh <dir> shared`

Если MCP gdrive-piotr недоступен — поймать ошибку, залогировать:
```
update-meta.sh <dir> docx-built skip_reason="Drive upload: MCP gdrive-piotr недоступен (<текст ошибки>)"
```
и оставить статью в `docx-built`. После восстановления MCP — `/share-article <NNN>` догрузит.

### 14. Финал (если state == "shared" или state == "docx-built")

`update-meta.sh <dir> completed`

**В серийном режиме** (батч): НЕ печатать большой баннер ниже и НЕ делать handoff здесь. Вывести одну строку - `✓ Тема <NNN> «<topic>» (<genre>) готова → output-<NNN>.html` - и вернуться в цикл серии к следующей теме. Большой вывод, папка-экспорт и (опц.) handoff - на шаге 15 после всех тем.

**В одиночном режиме:**

Если `--auto` и `--with-handoff` — после `completed` сразу вызвать `Skill handoff` (без аргументов). Иначе — просто вывод и стоп.

Вывести:
```
═══ СТАТЬЯ ГОТОВА ═══

Тема: <topic>
Жанр: <genre>

Deliverables:
  📄 Google Doc:  <meta.share.docx_url>  (если есть)
  📄 Локальный docx:  <dir>/Article_<NNN>_<slug>.docx
  🌐 HTML:  <dir>/output-<NNN>.html
  🟦 Tilda (если применимо):  <dir>/tilda/head.html + <dir>/tilda/t123.html

Артефакты:
  📊 Отчёт:  <dir>/report.md
  🔍 Аудит:  <dir>/audit.md + <dir>/applied.json
  🎨 Фото:  <dir>/photos/  (URLs в urls.json)

[Если meta.skips не пустое — добавить блок:]
Пропущенные шаги:
  ⏭ <skip.step>: <skip.reason>
  ⏭ ...

⚠️ НЕ ЗАБУДЬ /handoff перед закрытием сессии — иначе файлы останутся в worktree и не попадут в основную папку проекта.
═════════════════════
```

**Финальный коммит** в worktree-ветку делает скил `/handoff` (не сам `/seo-statya`). Хук pre-commit пропустит коммит только если все изменённые файлы принадлежат текущей задаче.

В `--auto`-режиме рекомендуется сразу после `completed` вызвать `/handoff` — но `/seo-statya` НЕ вызывает его автоматически (handoff делает merge в main и удаляет ветку, это решение пользователя).

### 15. Серийный финал (только в батч-режиме, после всех тем)

Запускается автоматически, когда `batch-queue.mjs next` вернул `{"done":true}` (exit 3) - все темы очереди пройдены - или сразу при `--finalize-batch`. Собирает один самодостаточный набор - без пауз: имя клиента из main-worktree, папка-экспорт на Рабочем столе с копиями `output-NNN.html`, сводная таблица метатегов `.xlsx`, zip с UTF-8 именами, заливка таблицы в Drive как Google Sheet, единое финальное сообщение и опц. `/handoff` при `--with-handoff`. Проблемные темы для блока «Требуют внимания» берутся из `batch-queue.mjs status` (темы `failed` + их `reason`, без вычитывания всей очереди в контекст). Полный алгоритм со всеми командами, переменными шага и шаблоном финального сообщения - REFERENCE.md#serial-final.

## Вторая статья на ту же тему

Одна тема - несколько статей разных жанров/площадок. Разруливается автоматически шагом 1a (коллизия по `topic_id` в `articles/_index.json`: скил берет следующий свободный жанр и `platform_target=external`). Сценарий, примеры явного управления жанром/площадкой и заметка про JM-кеш - REFERENCE.md#collision-genre.

## Параллельная работа

Несколько статей одновременно — каждая в своём worktree:
```
claude --worktree art-005
```

Состояние одной статьи (`meta.json` в её папке) не пересекается с другой.

## Запреты

- Не пропускай состояния — каждое `update-meta.sh` обязательно.
- Не запускай `section-writer` для уже написанной секции (если `--resume`).
- Не редактируй `sections/*.md` после `finalized` — только через `article-fixer` (одна правка из `--review`) или `article-fixer-batch` (массово после аудита) по `article.md`.
- Не используй длинное тире (—) и среднее (–). Только дефис (-).
- НЕ используй букву ё - всегда пиши е. Правило для всех клиентских текстов и метатегов (как и запрет тире).
- Не делай git push, не публикуй собранный HTML (output-NNN.html) куда-либо — это решение пользователя. (Папка-экспорт серии на Рабочем столе - это локальный deliverable, не публикация.)
- Не задавай вопросов пользователю в `--auto`-режиме без крайней необходимости (коллизия темы — единственное исключение).
