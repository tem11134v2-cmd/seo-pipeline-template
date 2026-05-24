---
name: process-handoffs
description: В main-сессии обрабатывает запросы на изменение общих файлов, созданные через /request-shared-edit в worktree-сессиях.
---

# process-handoffs

Обрабатывает накопившиеся handoff-запросы. Запускается **в main-сессии** (без worktree).

## Аргументы

```
/process-handoffs [--all] [--include-worktree=<branch>]
```

- Без аргументов: показывает список pending запросов, спрашивает какой обработать.
- `--all`: обработать все pending запросы по очереди.
- `--include-worktree=<branch>`: дополнительно прочитать запросы из ещё-не-смерженной ветки worktree (полезно когда нужно применить срочную правку, не дожидаясь /handoff).

## Алгоритм

### 0. Проверка: мы в main?

```bash
GIT_DIR=$(git rev-parse --git-dir)
COMMON_DIR=$(git rev-parse --git-common-dir)
```

Если разные — мы в worktree. Сообщить:
> «Эта команда работает только в main. Открой основную папку проекта в новой сессии (без галочки worktree).»

### 1. Собрать список pending запросов

Pending = файлы `.claude/handoff-requests/*.md`, которых нет в `.claude/handoff-requests/processed/`.

Если `--include-worktree=<branch>` передан:
- Получить список файлов в `.claude/handoff-requests/` из этой ветки:
  ```
  git show <branch>:.claude/handoff-requests/ 2>/dev/null | grep .md
  ```
- Прочитать содержимое каждого:
  ```
  git show <branch>:.claude/handoff-requests/<file>
  ```
- Добавить в список pending с пометкой `[from worktree:<branch>]`.

### 2. Если pending пусто

Сообщить:
> «Нет ожидающих handoff-запросов.»
И выйти.

### 3. Показать список

```
═══ HANDOFF REQUESTS ═══
1. 2026-05-24T14:30Z — Article 003: добавить URL в перелинковку (/services/audit)
   Файл: ЗАКАЗЧИК.md
2. 2026-05-24T15:10Z — Article 004: поправить опечатку в template.html
   Файл: template.html
[from worktree:wt-005] — Article 005: добавить тему в topics.xlsx
   Файл: topics.xlsx
═════════════════════════
```

### 4. Обработка

Если `--all`: пройти по списку, для каждого:
1. Прочитать содержимое запроса
2. Применить правку через Edit/Write (Claude сам разбирается, что менять)
3. Если правка неоднозначная — спросить пользователя одной строкой
4. Переместить файл в `.claude/handoff-requests/processed/<timestamp>-<task>.md` (через `git mv`)
5. Не коммитить отдельно — копим для пакетного коммита

Если без `--all`: спросить пользователя «какой обработать? (число, all, skip)».

После обработки всех выбранных:
- `git add -A && git commit -m "Process handoff requests: N items"` (если было >0 правок)
- Это main, pre-commit hook пропустит автоматически.

### 5. Сообщить

```
═══ DONE ═══
Обработано: N запросов
Файлы изменены:
  - ЗАКАЗЧИК.md (добавлена строка перелинковки)
  - template.html (опечатка)
Коммит: <hash> «Process handoff requests: N items»
════════════
```

## Конфликты при применении

Если два разных запроса противоречат друг другу (например, один просит добавить `/services/seo`, другой — заменить эту же ссылку на `/services/optimization`):
- Применить **в порядке timestamp** (старый первым).
- Если итоговый результат странный — сообщить пользователю и предложить откатить через `git revert`.

## Запреты

- Не обрабатывай в worktree-сессии (правила main-only нарушать нельзя).
- Не удаляй файлы из `.claude/handoff-requests/` мимо `processed/` — это потеря истории.
- Не применяй правки без понимания (если в запросе непонятное описание — спросить пользователя).
- Не используй длинное тире (—) и среднее (–). Только дефис (-).
