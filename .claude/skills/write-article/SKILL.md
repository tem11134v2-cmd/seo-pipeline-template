---
name: write-article
description: Полный цикл написания статьи. Аргументы:N (номер темы), --only-A | --only-B (по умолчанию: только A), --resume.
---

# write-article

Главный скил конвейера. Проходит state machine от JM-анализа до сборки HTML.

## Аргументы

```
/write-article <N> [--only-A | --only-B | --both] [--resume]
```

- `N` — номер темы в `topics.xlsx` (обязательно).
- `--only-A` (default) / `--only-B` / `--both` — какие варианты структуры писать.
- `--resume` — продолжить с того места, где остановилось (по `meta.json`).

## State machine

```
init → jm-done → tz-done → writing-A → sections-done-A
→ [writing-B → sections-done-B] → finalized → awaiting-review
→ audited → enhanced → awaiting-photos → assembled → [tilda-split] → completed
```

`meta.json` — единственный источник истины о текущем состоянии. Обновляется через `.claude/hooks/update-meta.sh <article_dir> <state>`.

## Алгоритм

### 0. Parse args

```
N = <обязательно>
variant_set = "AB" если --both, "B" если --only-B, иначе "A" (default)
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
  "genre_A": "<из topics.xlsx, первый>",
  "genre_B": "<второй, если есть>",
  "variants": ["A"] | ["B"] | ["A","B"],
  "state": "init",
  "section_index": 0,
  "completed_steps": [],
  "started": "<ISO UTC>",
  "updated": "<ISO UTC>"
}
```
- Записать `.claude/tmp/current-article.txt` с путём к `dir/` (используется хуками).
- `state = "init"`.

### 2. JM-анализ (если state == "init")

Маркер: `.claude/tmp/expected-jm-analyst-<run_id>.txt = <dir>/jm/analyze.json`

Делегировать `jm-analyst`:
```
main_query: <...>
region_code: <код города из ЗАКАЗЧИК.md, не 225 и не области>
article_dir: <dir>
project_root: <...>
Пройди пайплайн A→E из PHASE-2 шаг 2-1. Сохрани jm/cluster.json, jm/lsi.json, jm/analyze.json, jm/stop-domains.json.
```

После завершения:
- `update-meta.sh <dir> jm-done`
- ПАУЗА: вывести сводку JM (субагент уже вывел в чат), спросить «ОК или повторить?». Если retry — повторно делегировать.

### 3. ТЗ (если state == "jm-done")

Для каждого `v` в `variants`:

Маркер: `.claude/tmp/expected-tz-builder-<run_id>.txt = <dir>/tz-<v>.md`

Делегировать `tz-builder`:
```
variant: <v>
article_dir: <dir>
genre: <genre_A или genre_B из meta.json>
topic: <...>
main_query: <...>
ws_freq: <...>
intent: <...>
project_root: <...>
```

После всех вариантов:
- `update-meta.sh <dir> tz-done`
- ПАУЗА: вывести план структур (субагенты уже вывели), спросить «ОК?». При корректировках — повторно делегировать `tz-builder` с пометкой что менять.

### 4. Секции (для каждого варианта по очереди)

Для каждого `v` в `variants`:

1. Прочитать `<dir>/tz-<v>.md`, выписать список H2-заголовков (по порядку появления `## ` в Разделе 5).
2. Если `<dir>/sections/progress.json` не существует — создать со структурой:
```json
{
  "variant": "<v>",
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
3. `update-meta.sh <dir> writing-<v>`
4. Для `i = 1..total_sections`:
   - Если `--resume` и `<dir>/sections/<NN>-*.md` существует — пропустить.
   - Записать маркер: `.claude/tmp/expected-section-writer-<run_id>.txt = <dir>/sections/<NN>-*.md` (паттерн).
   - Записать `.claude/tmp/current-article.txt = <dir>` (хук check-section.sh смотрит сюда).
   - Обновить `progress.json.current_section = i`.
   - Делегировать `section-writer`:
     ```
     variant: <v>
     section_index: <i>
     article_dir: <dir>
     tz_path: <dir>/tz-<v>.md
     genre: <genre>
     project_root: <...>
     ```
   - Хук `check-section.sh` сработает после возврата — если exit 2 → разобрать ошибку, при необходимости повторить раздел с пометкой.
   - `update-meta.sh <dir> writing-<v> section_index=<i>`
5. После всех разделов: `update-meta.sh <dir> sections-done-<v>`

### 5. Финализация

Для каждого `v` в `variants`:

Маркер: `.claude/tmp/expected-article-finalizer-<run_id>.txt = <dir>/article.md`

Делегировать `article-finalizer`:
```
variant: <v>
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

### 7. Аудит (state → audited)

Маркер: `.claude/tmp/expected-text-auditor-<run_id>.txt = <dir>/audit.md`

Делегировать `text-auditor`:
```
article_dir: <dir>
project_root: <...>
```

После: `update-meta.sh <dir> audited`. Вывести `audit.md` (резюме), ждать решения. Обычно — «продолжай».

### 8. Улучшения (state → enhanced)

Маркер: `.claude/tmp/expected-enhancer-<run_id>.txt = <dir>/enhancements.html`

Делегировать `enhancer`:
```
article_dir: <dir>
project_root: <...>
```

Создаёт три файла: `enhancements.html`, `faq.html`, `schema.json`.

`update-meta.sh <dir> enhanced`

### 9. Фото (state → awaiting-photos)

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

### 10. Сборка HTML (state → assembled)

```
node .claude/scripts/assemble-html.mjs <dir>
```

`update-meta.sh <dir> assembled`

### 11. Тильда (опц.)

Если в `ЗАКАЗЧИК.md` Платформа == «Тильда» (искать в секции «Основное» поле «Платформа»):

```
node .claude/scripts/tilda-split.mjs <dir>
```

`update-meta.sh <dir> tilda-split`

### 12. Финал

`update-meta.sh <dir> completed`

Вывести:
```
Готово. Статья: <dir>/output.html
Тильда (если применимо): <dir>/tilda/head.html + <dir>/tilda/t123.html
Отчёт: <dir>/report.md
Аудит: <dir>/audit.md
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
