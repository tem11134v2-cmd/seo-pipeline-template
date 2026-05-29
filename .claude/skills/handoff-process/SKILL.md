---
name: handoff-process
description: В main-сессии анализирует и применяет накопленные handoff-requests из .claude/handoff-requests/ (созданные через /setup-project, /new-topics, /request-shared-edit в worktree-задачах). Единственный скил, работающий в main.
---

# handoff-process

Разбирает накопленные handoff-запросы в `.claude/handoff-requests/` и применяет их к общим файлам проекта. Запускается **в main-сессии** (без worktree).

## Аргументы

```
/handoff-process [--dry-run] [--only=<тип>]
```

- `--dry-run` — показать что будет применено, не применять.
- `--only=<тип>` — обработать только указанный тип (`setup-project`, `new-topics`, `shared-edit`).

## Алгоритм

### 0. Проверка: мы в main?

```bash
GIT_DIR=$(git rev-parse --git-dir)
COMMON_DIR=$(git rev-parse --git-common-dir)
```

Если разные — отказать:
> «/handoff-process работает только в main. Открой основную папку проекта в новой сессии (без галочки worktree).»

### 1. Подчистить зомби-worktree

```bash
git worktree prune
```

(Если предыдущий `/handoff` не смог удалить worktree из-за file lock на Windows — здесь добиваем.)

### 2. Собрать список pending запросов

Pending = всё в `.claude/handoff-requests/` (кроме `processed/`) **плюс** новые батчи тем из `topics/NNN-*/` со state `shared`/`completed`, темы которых ещё не применены в корневой `topics.xlsx`:

| Источник | Тип |
|---|---|
| `.claude/handoff-requests/setup-meta.json` + `files/ЗАКАЗЧИК.md` + `files/template.html` | setup-project |
| `topics/NNN-*/meta.json` (state >= `shared`, без флага `applied_to_root_xlsx: true`) | new-topics |
| `.claude/handoff-requests/topics-meta.json` + `topics-batch.json` (legacy путь) | new-topics-legacy |
| `.claude/handoff-requests/<timestamp>-<task>.md` (произвольные .md) | shared-edit (от /request-shared-edit) |

Если pending пусто:
> «Нет ожидающих handoff-запросов. Все применённые лежат в `.claude/handoff-requests/processed/`.»

### 3. Показать план

```
═══ HANDOFF REQUESTS ═══

[setup-project]  <timestamp>
  Создать: ЗАКАЗЧИК.md, template.html
  Post-actions: git config core.hooksPath .claude/git-hooks

[new-topics]  topics/001-example/  N=25 тем
  Источник: topics/001-example/topics-batch.json
  Цель: topics.xlsx (merge с дедупом по main_query)
  После применения: meta.json получит applied_to_root_xlsx: true

[shared-edit]  <timestamp> Article 003
  Файл: ЗАКАЗЧИК.md
  Запрос: «добавить URL /services/audit в секцию Перелинковка»

═════════════════════════
```

Спросить пользователя:
> «Применять все? [Y/n/by-one]» (если без `--all`)

### 4. Обработка по типам

#### 4.1 setup-project

1. Прочитать `.claude/handoff-requests/setup-meta.json`.
2. Для каждого `files[]`:
   - Прочитать source.
   - Если target существует И operation=create — спросить пользователя «target уже есть, перезаписать?». При new — продолжить.
   - `cp <source> <target>` (через Read + Write).
3. Выполнить `post_actions` (например `git config core.hooksPath .claude/git-hooks`).
4. Запомнить файлы для финального коммита.

#### 4.2 new-topics (основной путь - из topics/NNN/)

Источник теперь per-task: каждый батч живёт в `topics/NNN-<slug>/`. Дедуп с корневым `topics.xlsx` уже сделан в worktree до сборки батча, поэтому здесь просто применяем.

1. Найти все `topics/NNN-*/meta.json` со state `shared` или `completed` И без флага `applied_to_root_xlsx: true`. Это pending-батчи.
2. Для каждого:
   - Прочитать `<topics_dir>/topics-batch.json`.
   - Если корневой `topics.xlsx` НЕ существует:
     - Скопировать `topics-batch.json` в корень как `topics.json` (временно).
     - Запустить `.claude\scripts\_node.cmd .claude\scripts\to-excel.mjs .`.
     - Удалить временный `topics.json`.
   - Если корневой `topics.xlsx` существует:
     - Прочитать существующие `main_query` через `.claude\scripts\_node.cmd .claude\scripts\read-topics-xlsx.mjs .`.
     - Отфильтровать батч от дублей (по нормализованному `main_query`, lowercase + trim).
     - Если новых тем 0 - сообщить «батч NNN: все темы уже в корневом темнике, пропускаю».
     - Если новых тем >0 - слить (старые из xlsx + новые из батча), записать объединённый JSON во временный `topics.json` в корне, запустить `to-excel.mjs`, удалить временный JSON.
     - Сводка в чат: «батч NNN: добавлено K тем (L дублей пропущено)».
3. Через Edit отметить в `<topics_dir>/meta.json` флаг `applied_to_root_xlsx: true` и обновить `updated` timestamp. Это идемпотентность - повторный `/handoff-process` не применит батч второй раз.
4. Запомнить файлы для коммита: корневой `topics.xlsx` + изменённые `meta.json`.

#### 4.2-legacy new-topics-legacy (старый путь - из handoff-requests/)

Если есть `.claude/handoff-requests/topics-batch.json` и `topics-meta.json` (от батчей, собранных до версии этого скила):

1. Прочитать как раньше.
2. Применить по той же логике, что 4.2 (дедуп через `read-topics-xlsx.mjs`, merge, перегенерация xlsx).
3. Через `git mv` перенести `topics-batch.json` и `topics-meta.json` в `processed/<timestamp>-...`.

#### 4.3 shared-edit (одиночные .md)

1. Прочитать содержимое запроса.
2. Применить через Edit/Write согласно тексту (Claude интеллектуально разбирается, какой файл и что менять).
3. Если запрос неоднозначен — спросить пользователя одной строкой.
4. Если **несколько запросов противоречат друг другу** (например, два просят разное к одной и той же строке `ЗАКАЗЧИК.md`):
   - Прочитать оба запроса полностью.
   - Предложить пользователю объединение (например «оба хотят добавить URL — добавлю обе записи»).
   - Если объединение невозможно — спросить, какой принять.
5. Запомнить файлы для коммита.

### 5. Перенос обработанных в `processed/`

Через `git mv` - **только для запросов из `.claude/handoff-requests/`** (setup-project, shared-edit, legacy new-topics):
```
git mv .claude/handoff-requests/setup-meta.json .claude/handoff-requests/processed/<timestamp>-setup-meta.json
git mv .claude/handoff-requests/files .claude/handoff-requests/processed/<timestamp>-files
... и т.д.
```

(`processed/` существует или создаётся через `mkdir`.)

**Батчи `topics/NNN-*/` НЕ переносятся** - они остаются в своей папке как историческая копия. Идемпотентность обеспечивается флагом `applied_to_root_xlsx: true` в их `meta.json` (см. шаг 4.2).

### 6. Финальный коммит

```
git add -A
git commit -m "Handoff-process: applied N items (setup-project, new-topics×K, shared-edit×M)"
```

В main pre-commit hook пропускает любые пути — нет ограничений.

### 7. Сообщить пользователю

```
═══ HANDOFF-PROCESS DONE ═══
Применено: N запросов
Изменены файлы:
  - ЗАКАЗЧИК.md (создан / обновлён)
  - template.html (создан)
  - topics.xlsx (добавлено K тем)
Перенесены в processed/: N файлов
Коммит: <hash>
═══════════════════════════
```

## Запреты

- Не запускай в worktree-сессии.
- Не удаляй файлы из `.claude/handoff-requests/` мимо `processed/` (потеря истории).
- Если конфликт между запросами — НЕ применяй один игнорируя другой без согласия пользователя.
- Не используй длинное тире (—) и среднее (–). Только дефис (-).
