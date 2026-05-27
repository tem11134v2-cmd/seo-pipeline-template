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
- Создать `dir/`, `dir/sections/`, `dir/jm/`, `dir/photos/`.
- Записать `dir/meta.json`:
```json
{
  "topic": "...",
  "query": "...",
  "slug": "...",
  "genre": "<из topics.xlsx, первый>",
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
Пройди пайплайн A→E из PHASE-2 шаг 2-1. Сохрани jm/cluster.json, jm/lsi.json, jm/analyze.json, jm/stop-domains.json.
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
2. Создать `<dir>/sections/progress.json` со структурой (если ещё не существует):
```json
{
  "total_sections": <count>,
  "completed_sections": [],
  "current_section": 0,
  "section_volumes_target": {"1": <target>, ...},
  "ngrams": {...из ТЗ...},
  "single_words": {...},
  "lsi_obligatory": {"used": [], "total": 15},
  "lsi_optional": {"used": []},
  "elements": {"ТАБЛИЦА": {"target": N, "placed": 0, "by_section": {}}, ...},
  "links_inserted": [],
  "pains_closed": {},
  "brand_mentions": [],
  "section_volumes": {},
  "carry_over": {"ngrams_undershoot": []}
}
```
Ответственность за создание `progress.json` — на скиле (один раз перед циклом). Section-writer только мерж-обновляет.

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
