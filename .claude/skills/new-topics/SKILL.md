---
name: new-topics
description: Собирает 15-25 тем для блога в worktree. Результат — батч в .claude/handoff-requests/topics-batch.json. Применяется в topics.xlsx через /handoff + /handoff-process.
---

# new-topics

Собирает темы для блога в worktree-сессии. **Не** правит `topics.xlsx` напрямую — пишет батч в handoff-requests, который main-сессия добавит в xlsx.

## Аргументы

```
/new-topics [--queries "запрос1, запрос2"]
```

## Алгоритм

### 0. Проверка: мы в worktree?

```bash
GIT_DIR=$(git rev-parse --git-dir)
COMMON_DIR=$(git rev-parse --git-common-dir)
```

Если в main — отказать:
> «/new-topics работает только в worktree. Открой текущую папку в новой сессии с галочкой worktree.»

Также проверить: существует ли `ЗАКАЗЧИК.md` в корне? Если нет — отказать:
> «ЗАКАЗЧИК.md не найден. Сначала запусти /setup-project <URL> в отдельной worktree-сессии и применит через /handoff-process.»

### 1. Записать current-task.txt

```
.claude/tmp/current-task.txt = .claude/handoff-requests/topics
```

### 2. Прочитать `ЗАКАЗЧИК.md`

Извлечь: нишу, регион, перелинковку, существующий блог (если домен указан).

### 3. Делегировать `topic-generator`

Маркер:
```
.claude/tmp/expected-topic-generator-<run_id>.txt:
  .claude/handoff-requests/topics-batch.json
```

Промт:
```
project_root: <...>
output_path: .claude/handoff-requests/topics-batch.json
ниша: <из ЗАКАЗЧИК.md>
регион: <из ЗАКАЗЧИК.md>
домен: <из ЗАКАЗЧИК.md>
затравочные запросы: <если переданы>
Собери 15-25 тем по PHASE-1 (4 подшага сбора + формирование списка). Запиши результат в output_path в формате topics.json (структура: { topics: [...], competitors: [...] }).
```

### 4. Пауза после мини-отчёта

Субагент уже вывел мини-отчёт. Спросить пользователя:
> «Мини-отчёт сбора. Подтверди (`ок`) или предложи корректировку (`добавь темы про X`, `убери тему N`).»

При корректировках — повторно делегировать или применить через Edit `.claude/handoff-requests/topics-batch.json`.

### 5. Создать метаданные

`.claude/handoff-requests/topics-meta.json`:
```json
{
  "type": "new-topics",
  "created": "<ISO UTC>",
  "source": ".claude/handoff-requests/topics-batch.json",
  "target": "topics.xlsx",
  "operation": "append-or-create",
  "topics_count": <число тем>,
  "competitors_count": <число конкурентов>,
  "notes": "Батч сгенерирован из worktree-задачи new-topics. При apply: если topics.xlsx не существует — создать через to-excel.mjs; если существует — добавить новые темы (с дедупликацией по main_query)."
}
```

### 6. Финал

```
═══ TOPICS BATCH READY ═══
Тем собрано: N
Конкурентов: M
Файл: .claude/handoff-requests/topics-batch.json

Дальше:
  /handoff  — финализирует worktree
  В main: /handoff-process — добавит темы в topics.xlsx
═══════════════════════════
```

## Запреты

- Не правь `topics.xlsx` напрямую — pre-commit hook откажет (это общий файл).
- Не запускай `to-excel.mjs` отсюда — его запустит `/handoff-process` в main.
- Не используй длинное тире (—) и среднее (–). Только дефис (-).
