---
name: rewrite-section
description: Перепишет один раздел (H2) уже написанной статьи с новой постановкой задачи. Удаляет sections/NN-*.md, откатывает progress.json, запускает section-writer и пересборку. Аргументы:<NNN> <section_index> "<описание>".
---

# rewrite-section

Точечная пересборка одного раздела статьи. Не та же история, что `/fix-article` (точечная правка). Здесь — **полная перегенерация** раздела с новой постановкой: можно сменить угол подачи, переписать в другом стиле внутри жанра, углубить или укоротить.

## Аргументы

```
/rewrite-section <NNN> <N> "<описание>"
```

- `NNN` — номер темы (префикс папки) или полный id папки (`005-slug-dko`), если под темой несколько статей.
- `N` — 1-based индекс H2-раздела (по порядку из ТЗ).
- `"<описание>"` — что именно нужно изменить. Скил передаст это `section-writer` как дополнительное указание.

## Когда использовать

- Раздел получился слишком «технический», нужен мягче.
- Раздел не закрывает нужную боль из ТЗ.
- Раздел дублирует другой по смыслу.
- Раздел вышел слишком длинным/коротким, не помогла адаптивная коррекция в первый прогон.

Если нужна **точечная правка** (заменить абзац, поправить фразу) — используй `/fix-article` или (в `--review` цикле write-article) `/edit "..."`.

Если **вся статья** не пошла — проще запустить `/write-article N --review` заново.

## Алгоритм

### 0. Parse args + worktree

Если не в worktree — предупредить, не блокировать.

### 1. Найти статью и раздел

Резолвить папку детерминированно (NNN после точки 2 не уникален):
```
.claude\scripts\_node.cmd .claude\scripts\resolve-article-dir.mjs articles <NNN>
```
`found == false` → стоп «Статья не найдена»; `ambiguous == true` → показать `candidates`, уточнить полный id; иначе `article_dir = <ответ>.dir`.
Прочитать `<article_dir>/meta.json`. Если `state < sections-done` — стоп: «Статья ещё пишется. Запусти `/write-article N --resume`.»

Прочитать `<article_dir>/tz.md`, выписать все H2 в порядке появления в Разделе 5. Найти раздел N (1-based). Если N выходит за пределы — стоп.

Прочитать `<article_dir>/sections/progress.json`. Найти соответствующий `<NN>-*.md` файл в `sections/`.

### 2. Откат состояния

1. Удалить `<article_dir>/sections/<NN>-*.md`.
2. Откатить `<article_dir>/sections/progress.json`:
   - Убрать N из `completed_sections`.
   - Откатить накопленные счётчики раздела:
     - `ngrams[*].used` уменьшить на `ngrams[*].by_section[N]` (если есть), убрать ключ N из `by_section`.
     - Аналогично `single_words`, `elements`.
     - Из `links_inserted` убрать записи с `section == N`.
     - Из `pains_closed[*]` убрать индекс N.
     - Из `brand_mentions` убрать записи с `section == N`.
     - `section_volumes[N]` — удалить ключ.
   - `current_section = N`.
3. Удалить (или пометить устаревшими) файлы, которые зависят от текста:
   - `<article_dir>/article.md` — переименовать в `article.before-rewrite-<NN>.md` (резерв).
   - `<article_dir>/audit.md`, `<article_dir>/applied.json`, `<article_dir>/diff.md` — если есть, переименовать с суффиксом `.stale`.
   - `<article_dir>/enhancements.html`, `faq.html`, `schema.json` — устарели, переименовать.
   - `<article_dir>/output.html`, `Article_<slug>.docx` — устарели.
4. `update-meta.sh <article_dir> writing`.

### 3. Перезапуск section-writer

Записать `.claude/tmp/current-task.txt = <article_dir>`.

Делегировать `section-writer` с расширенным промтом:
```
section_index: <N>
article_dir: <article_dir>
tz_path: <article_dir>/tz.md
genre: <meta.genre>
project_root: <...>

Особое указание от пользователя: "<описание из аргумента>"
```

Хук `check-section.sh` проверит файл. Если exit 2 — разобрать ошибку, повторить.

### 4. Восстановление пайплайна

После успешной записи раздела — пройти оставшиеся шаги основного скила:
1. `update-meta.sh <article_dir> sections-done`
2. Делегировать `article-finalizer` (создаст новый `article.md`).
3. Запустить `verify-markers.mjs`.
4. `update-meta.sh <article_dir> finalized`.
5. Делегировать `text-auditor` + `article-fixer-batch` (если включён auto-режим — `--auto` режим по умолчанию для `/rewrite-section`).
6. Делегировать `enhancer` → новые enhancements/faq/schema.
7. `photo-promter` + авто-фото (если фото менялись из-за нового текста — иначе пропускаем шаг 9-9b если в новом разделе нет новых меток `[ФОТО:]` относительно старого).
8. `assemble-html.mjs` + `metrics-report.mjs` + `build-article-docx.mjs` (если уже был docx) + автозагрузка в Drive (`--redo`).

### 5. Вывод

```
═══ РАЗДЕЛ N ПЕРЕПИСАН ═══

Статья: <topic>
Раздел: <H2 название>
Старая версия в резерве: article.before-rewrite-<NN>.md

Обновлены: article.md, output.html, Article_<slug>.docx
Заменена в Drive: <docx_url>
═════════════════════════
```

## Запреты

- Не трогать другие разделы — только `<NN>-*.md`.
- Не сбрасывать ВСЕ счётчики `progress.json` — только связанные с разделом N.
- Не удалять оригинальный `article.md` — переименовать в `article.before-rewrite-<NN>.md`.
- Длинное тире (—) и среднее (–) не использовать. Только дефис (-).

## Параллельная работа

`/rewrite-section` пересобирает один раздел и затрагивает множество артефактов одной статьи. Делать несколько параллельно по одной статье — не стоит (гонка за progress.json). По разным статьям — без проблем.
