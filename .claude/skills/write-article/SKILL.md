---
name: write-article
description: Полный цикл написания статьи. Аргументы: N (номер темы), --resume, --review, --auto.
---

# write-article

Главный скил конвейера. Проходит state machine от JM-анализа до сборки HTML.

## Аргументы

```
/write-article <N> [--resume] [--review | --auto] [--with-handoff]
                   [--genre="<жанр>"] [--platform=site|external|social]
                   [--rebuild-docx]
```

- `N` — номер темы в `topics.xlsx` (обязательно).
- `--resume` — продолжить с того места, где остановилось (по `meta.json`).
- `--review` — режим с ручной проверкой после финализации. Скил останавливается на `awaiting-review`, ждёт `/continue` или `/edit "..."`. Полезно для ответственных текстов.
- `--auto` — самодостаточный режим (по умолчанию). Никаких пауз, скил доводит до `completed` без участия пользователя. Эквивалентно отсутствию обоих флагов — `--auto` явно указывает поведение.
- `--with-handoff` — после `completed` автоматически вызвать `/handoff` (закрыть worktree, смержить в main). Только в комбинации с `--auto`. Опасный флаг — выбирай осознанно, потому что handoff удаляет ветку и закрывает сессию для дальнейших правок. В `--review` игнорируется.
- `--genre="<жанр>"` — явный выбор жанра (должен быть из колонки «Жанры» темы в topics.xlsx). По умолчанию — первый доступный (см. правила повтора ниже). Если значение не из xlsx — стоп с сообщением «Жанр <X> отсутствует в колонке Жанры темы N. Доступные: <список>.»
- `--platform=site|external|social` — целевая площадка (влияет на жанр и автора). По умолчанию `site` — основной блог клиента.
- `--rebuild-docx` — **recovery-режим (улучшение #3)**. Позиционный аргумент трактуется как номер уже готовой статьи `NNN` (а не темы). Пересобирает только `.docx` и перезаливает в Drive, минуя весь state machine. Полезно после фикса `build-article-docx.mjs` или правки текста: `/write-article 003 --rebuild-docx`. Несовместим с остальными флагами (см. шаг 0c).

**Базовый режим — `--auto`.** Запуск `/write-article 1` без флагов идёт без пауз до конца. Чтобы получить пошаговый контроль — `/write-article 1 --review`.

По одной теме можно написать несколько статей в разных жанрах для разных площадок (см. раздел «Вторая статья на ту же тему» и шаг 1a). Скил сам разруливает коллизию по `topic_id` через `articles/_index.json`.

## State machine

```
init → jm-done → tz-done → writing → sections-done → finalized →
  [awaiting-review (только в --review)] →
  audited → audit-applied → enhanced → photos-generated → photos-published →
  assembled → [tilda-split] → docx-built → [shared (если gdrive доступен)] → completed
```

`meta.json` — единственный источник истины о текущем состоянии. Обновляется через `.claude/hooks/update-meta.sh <article_dir> <state>`.

Поле `meta.mode` принимает значения `"auto"` или `"review"` — задаётся при `Setup`.

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

Если `GIT_DIR == COMMON_DIR` — мы в main. Предупредить, но не блокировать:
> «⚠️ Ты пишешь статью в main-сессии. Pre-commit hook здесь не блокирует ничего. Для многозадачности рекомендую закрыть и переоткрыть сессию с галочкой worktree.»

### 0b. Parse args

```
N = <обязательно>
resume = true если --resume
mode = "review" если --review, иначе "auto"
```

При `--resume` режим берётся из существующего `meta.mode` (флаг не должен переключать режим на половине прогона).

### 0c. Режим --rebuild-docx (recovery, улучшение #3)

Если передан `--rebuild-docx` — это не полный прогон, а быстрая пересборка docx уже готовой статьи. Позиционный аргумент = `NNN` статьи (не номер темы). State machine не запускается.

1. Найти `articles/<NNN>-*/`. Если нет — стоп «Статья NNN не найдена».
2. Прочитать `meta.json`. Если `state` < `assembled` — стоп «Статья ещё не дошла до сборки, запусти обычный `/write-article N --resume`».
3. Пересобрать docx:
   ```
   .claude\scripts\_node.cmd .claude\scripts\build-article-docx.mjs <dir>
   ```
   Обработать exit-код как в шаге 12 (exit 3 = docx неполный → ретрай, лимит 2; см. баг #6). Не продолжать с неполным docx.
4. Если в `meta.share.drive_id` есть значение — удалить старый файл в Drive: `mcp__gdrive-piotr__deleteItem(itemId=<drive_id>)` (если упало — предупредить, продолжать).
5. Перезалить новый docx как в шаге 13 (явный `mimeType`, sanity-check). Обновить `meta.share` целиком, включая свежий `build_script_commit` (= `git log -1 --format=%h -- .claude/scripts/build-article-docx.mjs`).
6. Вывести: «🔄 docx статьи NNN пересобран и обновлён в Drive: <docx_url>». СТОП.

Recovery-сценарий «нашли баг скрипта - надо перегенерить N статей»: прогнать цикл `/write-article <NNN> --rebuild-docx` по каждой статье с устаревшим `build_script_commit`.

### 1. Setup

- Выбрать тему №N **по колонке `№`** (не по физической строке - строки бывают отфильтрованы/переставлены/со сдвигом шапки). Детерминированно, через парсер:
  ```
  .claude\scripts\_node.cmd .claude\scripts\read-topics-xlsx.mjs . --by-number N
  ```
  Вернёт `{ exists, found, requested, topic, available_numbers }`. Из `topic` берём: `n` (= `topic_id`), `topic`, `main_query`, `ws_freq`, `intent`, `genres`, `priority`, `linking_url`.
  - `exists == false` → стоп: «`topics.xlsx` не найден в корне. Сначала `/new-topics` (или положи темник).»
  - `found == false` → стоп: «В `topics.xlsx` нет темы №N. Доступные номера: `<available_numbers>`.» НЕ угадывать и НЕ брать соседнюю строку.
- `topic_id = topic.n` (= N). Это **сквозная ось идентичности**: аргумент N = номер темы = номер папки (шаг 1b) = `meta.topic_id`.
- `genres_in_xlsx = topic.genres` (жанры из колонки «Жанры (2-3)»).
- `slug = slugify(topic.topic)`.

#### 1a. Чтение индекса и логика коллизий

Прочитать `articles/_index.json` (если есть). Найти записи с `topic_id == N`. Это `existing_articles`.

`genres_done = existing_articles.map(a => a.genre)`
`genres_available = genres_in_xlsx - genres_done`

**Если `--resume`:**
- Найти все `existing_articles` с `state != "completed"`. Если их несколько — взять самую недавнюю по `updated` (или по NNN, как fallback). Прочитать её `meta.json`, продолжить с её состояния. В `--auto` — без вопросов. В `--review` — короткое «Найдено NNN в state `<state>`, продолжать? [Y/n]».
- Если всех таких нет (все completed) — сказать пользователю: «Все статьи по теме N завершены. Запусти `/write-article N` без --resume, чтобы написать новую (в другом жанре).» Стоп.

**Если `--resume` НЕ передан:**

Развилка по `existing_articles`:

- **0 записей** — обычный сценарий. Жанр:
  - Если флаг `--genre="..."` передан и значение есть в `genres_in_xlsx` → использовать его.
  - Иначе → `genres_in_xlsx[0]` (первый).
  - `platform_target` — из `--platform` или `"site"`.
  - Идём к 1b.

- **≥1 запись, есть `genres_available`** — частичный повтор. Возможные сценарии:
  - **`--genre="X"` передан и `X` в `genres_available`** → используем `X`, без вопросов. NNN = max(existing.nnn) + 1.
  - **`--genre="X"` передан, но `X` уже в `genres_done`** → сообщить «По теме N в жанре `X` уже есть статья NNN. Доступные: `genres_available`. Что делать?» и ждать (даже в --auto, потому что коллизия скоупа — пользователь явно дал противоречащий флаг, нужно его решение).
  - **флаг не передан** в `--auto` → взять `genres_available[0]` автоматически. Для `platform_target` — взять первый не использованный из приоритета `["site", "external", "social"]` (т.е. `["site", "external", "social"] \ existing.map(e => e.platform_target)`). Если все три уже использованы — использовать `external` как самый частый случай. В чате уведомить одной строкой: «По теме N уже есть статья(и) в жанре(ах) `<genres_done>`. Беру жанр `<genres_available[0]>`, platform=`<выбранная>`.»
  - **флаг не передан** в `--review` → спросить:
    > «По теме №N уже сделана статья в жанре(ах) <X>. Доступные из topics.xlsx: <Y>. Какой жанр для новой?»

- **`genres_available` пуст (все жанры уже использованы)** — спросить (в обоих режимах):
  > «По теме №N все жанры из topics.xlsx уже использованы (<X>). Варианты: 1) переписать существующую (укажи NNN), 2) следующая тема (N+1), 3) отмена. Что делать?»

#### 1b. Создание директории и meta.json

- NNN = max(существующих nnn в `_index.json`) + 1, или 1 если индекс пуст. Двузначное/трёхзначное с ведущим нулём.
- `dir = articles/<NNN>-<slug>/` (slug может повторяться, NNN всегда уникален).
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
- Записать `.claude/tmp/current-task.txt` с путём к `dir/`.
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
   - Записать `.claude/tmp/current-task.txt = <dir>`.
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
   - **Fail-fast:** если section-writer вернул сообщение с «⚠ check-section вернул один и тот же exit 2 дважды подряд» — **не делегируй заново для этой секции в `--auto`-режиме**. Останови прогон, выведи пользователю stderr хука и попроси вмешательства (исправить хук или содержимое вручную). В `--review` — то же. Это страховка от бесконечного цикла и сжигания токенов на сломанном хуке.
   - `update-meta.sh <dir> writing section_index=<i>`
5. После всех разделов: `update-meta.sh <dir> sections-done`

### 5. Финализация (если state == "sections-done")

**Перед делегированием — sanity-check прогресса:**
```
.claude\scripts\_node.cmd .claude\scripts\verify-progress.mjs <dir>
```
Скрипт сверяет `sections/progress.json` с фактическим содержимым `sections/*.md`: число H2, объёмы по секциям, реальные вхождения топ-N-грамм. Exit 0 — расхождений нет (или ≤10%); exit 1 — warning (10-30%), писать в `meta.warnings` и идти дальше; exit 2 — блокирующее расхождение (>30%). При exit 2 в `--auto` — остановиться и попросить пользователя проверить (обычно это значит, что секции были записаны вручную в обход section-writer'а, и счётчики устарели).

Маркер: `.claude/tmp/expected-article-finalizer-<run_id>.txt = <dir>/article.md`

Делегировать `article-finalizer`:
```
article_dir: <dir>
project_root: <...>
```

**После завершения — обязательная проверка артефактов:**

1. **Файлы существуют (баг #2):** `<dir>/article.md` и `<dir>/report.md` должны быть записаны. Если какого-то нет — это регрессия (article-finalizer проигнорировал `report.md` под влиянием системного reminder’а про «documentation .md»).
   - **Ретрай (макс 1):** повторно делегировать с пометкой «report.md и article.md — рабочие артефакты конвейера, обязаны быть записаны как файлы через Write по абсолютным путям. Перезапиши недостающий».
   - **Parent-fallback (НОВОЕ-B):** если после ретрая файла всё ещё нет, но агент вернул его содержимое в чат — **скил сам записывает файл через `Write`** по пути `<dir>/report.md` (родительский контекст под reminder не подпадает). Не зацикливаться на агенте: 1 ретрай + fallback, дальше вперёд. Если содержимого нет даже в чате — стоп с просьбой к пользователю.

2. **Метки сохранены (баг #3):** запустить
   ```
   .claude\scripts\_node.cmd .claude\scripts\verify-markers.mjs <dir>
   ```
   Если exit 2 — финализатор потерял или перефразировал метку (verify-markers сверяет и число, и **тело** меток побайтово). Повторно делегировать `article-finalizer` с пометкой «verify-markers: <stderr> — перепиши `article.md`, сохранив все метки 1-в-1 (включая текст внутри скобок), и сверь тела сам перед записью».
   - **Лимит ретраев = 2 (НОВОЕ-B):** если после 2 повторов `verify-markers` всё ещё exit 2 — **стоп**, не зацикливаться (упрямый финализатор иначе сожжёт токены, как было замечено: у section-writer fail-fast есть, у финализатора не было). Вывести пользователю последний stderr и попросить ручной правки `article.md`. Не идти дальше с битыми метками.
   - При exit 0 — продолжать.

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

### 9b. Авто-генерация фото (если state == "photos-generated")

После того как `photos/prompts.md` готов — скил сам генерирует изображения и публикует их в Cloudinary. **Никаких пауз и команд пользователю**.

**Перед первым вызовом** скилов `image-generation` и `image-publishing` — посмотри их актуальную схему через `ToolSearch` (или прочитай их `SKILL.md`), чтобы названия параметров совпадали. Имена параметров ниже (`prompt`, `aspect_ratio`, `output_path`, `source_path`, `folder`, `public_id`, `tags`, `alt_text`) — ожидаемые на момент написания этого скила, но если скилы обновятся — подстрой.

#### 9b-0. Если инструмента нет в выдаче ToolSearch (MCP publish/CDN оффлайн)

`cloudinary-publish` (`publish_image`) и `openrouter-image` (`generate_image`) — локальные Python-серверы с тяжёлым cold-start (импорт `cloudinary`/`pydantic` и т.п.). Под параллельной нагрузкой (много worktree-сессий стартует разом → конкуренция за диск/CPU) они иногда не успевают подняться к началу прогона. Если `ToolSearch «cloudinary»` / `«generate_image»` ничего не вернул — НЕ останавливай прогон сразу, действуй по порядку:

1. **Сначала подожди — в ~87% случаев сервер не упал, а медленно стартует** (по логам проекта: из ~290 сессий ровно 0 переподключений после падения, но большинство медленных коннектов дозревают за 20-30с). `ScheduleWakeup` на 60-90с с тем же `/write-article N --resume`, после пробуждения повтори `ToolSearch`. Лимит 2 пробуждения. Обычно на 2-й проверке тул уже на месте — сервер «дозрел».
2. **Переподключения ПОСЛЕ падения не бывает.** Если сервер реально упал по таймауту (в логе подключения `%LOCALAPPDATA%\claude-cli-nodejs\Cache\...\mcp-logs-cloudinary-publish\*.jsonl` строка `Connection failed` / `timed out`) — в этой сессии он уже не оживёт, сколько ни жди. Тогда: в `--review` — стоп, попроси пользователя перезапустить сессию; в `--auto` — перейди в аварийный режим (п.3), не вешай прогон бесконечными пробуждениями.
3. **Аварийный режим (чтобы статья не встала из-за CDN):**
   - Упал только **publish** (картинки сгенерированы локально, но не публикуются): впиши в `urls.json` для каждого PNG `data:`-URL (base64) вместо CDN-ссылки + поле `"todo": "CDN-публикация отложена (MCP publish оффлайн)"`. docx и HTML получат картинки локально. Минус: нет CDN-URL для живого сайта и `og:image`.
   - Упала **генерация** (`openrouter-image`): пометь все фото в `urls.json` как `{"photo": N, "todo": "генерация отложена (MCP оффлайн)", "prompt": "..."}` и иди дальше — статья соберётся без изображений, фото добиваются позже.
   - В обоих случаях зафиксируй пропуск: `update-meta.sh <dir> photos-published skip_reason="MCP CDN/generate оффлайн — фото отложены"`. После восстановления MCP до-опубликовать перезапуском шага 9b (новая сессия) или вручную.
4. **Профилактика (разовая, на стороне пользователя):** базовый фикс уже применён глобально — `MCP_TIMEOUT=120000` (User env Windows) переводит большинство «падений» в «медленный успех». Если оффлайн повторяется часто — не стартуй пачку worktree залпом (разнеси старт по времени, чтобы убрать пик одновременных cold-start) и проверь, что Claude Code Desktop перезапускали после установки переменной (иначе она не подхватится).

Используются два готовых скила из системы:
- `/image-generation` — генерация через OpenRouter (Nano Banana 2 по умолчанию). Сам управляет retry и форматами.
- `/image-publishing` — публикация в Cloudinary, возвращает delivery URL и asset_id. Принимает локальный путь, может работать после `/image-generation`.

Алгоритм:

1. Распарсить `<dir>/photos/prompts.md` — извлечь для каждого фото:
   - `n` — номер (1..N)
   - `prompt` — строка после «**Промт:** »
   - `alt` — строка после «**Alt:** »
   - `place` — строка «Место» (для тегов/контекста)

2. Для каждого `(n, prompt)`:
   - Вызвать `Skill image-generation` c args вида:
     ```
     prompt: "<prompt>"
     aspect_ratio: "16:9"
     model: nano-banana-2  (или nano-banana, скил сам решит дефолт)
     output_path: <dir>/photos/<NN>-<slug>.png   (NN — двузначный)
     ```
     Скил вернёт путь к локальному файлу. Если упал — попытаться ещё раз; после второй неудачи пометить TODO и продолжить с остальными.

3. После генерации **всех** изображений — последовательная (или параллельная по 2-3, в зависимости от лимитов Cloudinary) публикация:
   - `Skill image-publishing` с args:
     ```
     source_path: <dir>/photos/<NN>-<slug>.png
     folder: articles/<YYYY>/<MM>/<topic-slug>
     public_id: <NN>-<slug>
     tags: [<topic-slug>, <slug>, ai-generated]
     alt_text: "<alt>"
     variant: hero  (для обычных фото)
     ```
     Скил вернёт `secure_url` (delivery URL) и `asset_id` Cloudinary. Для hero-фото из позиции 1 также запросить вариант `social` (1200×630) — пригодится для og:image в волне 5.

4. Собрать `<dir>/photos/urls.json`:
   ```json
   [
     {"photo": 1, "url": "https://res.cloudinary.com/.../01-hero.jpg", "asset_id": "...", "alt": "..."},
     {"photo": 2, "url": "...", "asset_id": "...", "alt": "..."},
     {"photo": 3, "todo": "генерация не удалась", "prompt": "..."}
   ]
   ```

5. **Кросс-чек с urls.json (баг #5):**
   ```
   .claude\scripts\_node.cmd .claude\scripts\verify-photos.mjs <dir>
   ```
   Теперь сверяется и число записей в `urls.json` с метками `[ФОТО:]` в `article.md`. Если exit 2 — рассинхрон (лишний/недостающий слот фото): пересобрать `urls.json` под актуальные метки, не публиковать «лишнее» фото. Записи с `todo` (неудачная генерация) допустимы и не блокируют.

6. `update-meta.sh <dir> photos-published`

В `--review` после публикации показать список URL и спросить «продолжать? [Y/n]» — на случай, если пользователь хочет вручную заменить какие-то.

**Стоимость на статью.** Nano Banana 2 ≈ $0.07 за изображение × 4-7 фото = $0.28-0.49. Cloudinary в free-tier бесплатно до 25k transformations / 25GB bandwidth — реальный расход на одну статью пренебрежимо мал.

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

### 11. Тильда (если state == "assembled" И Платформа == Тильда)

Прочитать `ЗАКАЗЧИК.md`, секция «Платформа и хостинг», поле «Платформа». Если значение содержит «Тильда» (case-insensitive):

```
.claude\scripts\_node.cmd .claude\scripts\tilda-split.mjs <dir>
```

`update-meta.sh <dir> tilda-split`

Если платформа другая — шаг пропустить **с логированием**:
```
update-meta.sh <dir> assembled skip_reason="Tilda-split: платформа <X>, не Тильда"
```
(state не меняем, просто фиксируем skip в `meta.skips`).

### 12. Сборка .docx (если state == "assembled" или "tilda-split")

Финальный deliverable — Word-документ с метатегами в шапке, текстом статьи, картинками из Cloudinary (inline) и FAQ. Загружается на Google Drive (см. шаг 13) и попадает к команде клиента.

```
.claude\scripts\_node.cmd .claude\scripts\build-article-docx.mjs <dir>
```

Создаст `<dir>/Article_<slug>.docx`. Скрипт сам качает картинки с Cloudinary по URL из `<dir>/photos/urls.json` (с ретраями скачивания 0/2/5с).

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
   - `localPath: <dir>/Article_<slug>.docx`
   - `convertToGoogleFormat: true`, `parentFolderId: <articles_folder_id>`, `name: Article_<slug>`
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

Если `--auto` и `--with-handoff` — после `completed` сразу вызвать `Skill handoff` (без аргументов). Иначе — просто вывод и стоп.

Вывести:
```
═══ СТАТЬЯ ГОТОВА ═══

Тема: <topic>
Жанр: <genre>

Deliverables:
  📄 Google Doc:  <meta.share.docx_url>  (если есть)
  📄 Локальный docx:  <dir>/Article_<slug>.docx
  🌐 HTML:  <dir>/output.html
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

**Финальный коммит** в worktree-ветку делает скил `/handoff` (не сам `/write-article`). Хук pre-commit пропустит коммит только если все изменённые файлы принадлежат текущей задаче.

В `--auto`-режиме рекомендуется сразу после `completed` вызвать `/handoff` — но `/write-article` НЕ вызывает его автоматически (handoff делает merge в main и удаляет ветку, это решение пользователя).

## Вторая статья на ту же тему

Типичный сценарий: одна тема — две статьи разных жанров:
- Статья на сайт клиента (жанр из `topics.xlsx` колонка «Жанры», первый)
- Статья на внешнюю площадку (Дзен, сателлит) — другой жанр (второй из той же колонки)

Шаг 1a выше автоматизирует это. Просто запусти `/write-article N` второй раз — скил увидит коллизию по `topic_id` в `articles/_index.json`, возьмёт следующий доступный жанр и проставит `platform_target=external`. В `--auto` режиме всё произойдёт без вопросов; в `--review` — с подтверждением.

Явное управление:
```
/write-article 1                              # первая статья: первый жанр, platform=site
/write-article 1                              # вторая: следующий жанр из xlsx, platform=external (по умолчанию)
/write-article 1 --genre="Личный опыт"        # явный выбор жанра
/write-article 1 --platform=social            # для соцсетей (короче, другой тон)
```

**JM-кеш экономит лимиты:** `jm_text_analyze` кешируется на 4 часа по тем же параметрам, поэтому второй прогон в тот же день не тратит ≥5 лимитов на JM-анализ повторно. Тонкая ручная оптимизация — см. волну 6 (JM-кеш между прогонами).

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
- Не делай git push, не публикуй output.html куда-либо — это решение пользователя.
- Не задавай вопросов пользователю в `--auto`-режиме без крайней необходимости (коллизия темы — единственное исключение).
