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

Pending = всё в `.claude/handoff-requests/` (кроме `processed/`):

| Файл/папка | Тип |
|---|---|
| `setup-meta.json` + `files/ЗАКАЗЧИК.md` + `files/template.html` | setup-project |
| `topics-meta.json` + `topics-batch.json` | new-topics |
| `<timestamp>-<task>.md` (произвольные .md) | shared-edit (от /request-shared-edit) |

Если pending пусто:
> «Нет ожидающих handoff-запросов. Все применённые лежат в `.claude/handoff-requests/processed/`.»

### 3. Показать план

```
═══ HANDOFF REQUESTS ═══

[setup-project]  <timestamp>
  Создать: ЗАКАЗЧИК.md, template.html
  Post-actions: git config core.hooksPath .claude/git-hooks

[new-topics]  <timestamp>  N=25 тем, M=3 конкурента
  Цель: topics.xlsx
  Операция: append-or-create (через to-excel.mjs)

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

#### 4.2 new-topics

1. Прочитать `.claude/handoff-requests/topics-meta.json` и `topics-batch.json`.
2. Если `topics.xlsx` не существует:
   - Скопировать `topics-batch.json` в корень как `topics.json` (временно).
   - Запустить `.claude\scripts\_node.cmd .claude\scripts\to-excel.mjs .` (рабочая папка = корень проекта).
   - Удалить временный `topics.json`.
3. Если `topics.xlsx` уже существует:
   - **Интеллектуальный merge:** прочитать существующий xlsx (через node или показать пользователю), сравнить main_query с batch, отфильтровать дубли.
   - Спросить пользователя «Найдено K новых тем (L дублей пропущено). Добавить?».
   - При согласии — слить, перегенерировать xlsx.
4. Запомнить файлы для коммита.

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

Через `git mv`:
```
git mv .claude/handoff-requests/setup-meta.json .claude/handoff-requests/processed/<timestamp>-setup-meta.json
git mv .claude/handoff-requests/files .claude/handoff-requests/processed/<timestamp>-files
... и т.д.
```

(`processed/` существует или создаётся через `mkdir`.)

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
