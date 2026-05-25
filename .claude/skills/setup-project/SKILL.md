---
name: setup-project
description: Исследует сайт клиента и готовит ЗАКАЗЧИК.md + template.html. Запускается в worktree после клонирования template-репо. Файлы выносятся в main через /handoff + /handoff-process.
---

# setup-project

Первичное исследование проекта клиента: сбор данных с сайта, генерация профиля и шаблона вёрстки. **Запускается в worktree-сессии** уже клонированного template-репо.

## Аргументы

```
/setup-project <URL_сайта_клиента>
```

## Алгоритм

### 0. Проверка: мы в worktree?

```bash
GIT_DIR=$(git rev-parse --git-dir)
COMMON_DIR=$(git rev-parse --git-common-dir)
```

Если `GIT_DIR == COMMON_DIR` (мы в main) — сообщить и отказать:
> «/setup-project работает только в worktree-сессии. Открой текущую папку в новой сессии с галочкой worktree.»

### 1. Записать current-task.txt

Без него pre-commit hook откажет в коммите. Текущая «задача» — настройка проекта:
```
.claude/tmp/current-task.txt = .claude/handoff-requests/setup
```

(Сама папка `setup` под handoff-requests — это область, куда складываем результаты. Зона разрешена pre-commit хуком.)

### 2. Делегировать `client-profiler`

Маркер ожидаемого файла:
```
.claude/tmp/expected-client-profiler-<run_id>.txt:
  .claude/handoff-requests/files/ЗАКАЗЧИК.md
```

Промт агенту (переопределить путь — пишем в handoff-requests, не в корень):
```
URL: <URL>
project_root: <current project root>
output_path: .claude/handoff-requests/files/ЗАКАЗЧИК.md
Заполни ЗАКАЗЧИК.md по шаблону. Сохрани в указанный output_path (не в корень — корень обновится позже через /handoff-process в main).
```

После завершения — прочитать `.claude/handoff-requests/files/ЗАКАЗЧИК.md` и вывести в чат краткую сводку. Спросить:
> «Профиль собран. Что-то поправить или продолжаем к шаблону вёрстки?»

Ждать ОК или правок. Если правки — повторно делегировать или применить через Edit.

### 3. Делегировать `template-designer`

Маркер:
```
.claude/tmp/expected-template-designer-<run_id>.txt:
  .claude/handoff-requests/files/template.html
```

Промт:
```
project_root: <current project root>
client_profile_path: .claude/handoff-requests/files/ЗАКАЗЧИК.md
output_path: .claude/handoff-requests/files/template.html
Прочитай профиль по client_profile_path, сгенерируй template.html на базе ~/.claude/seo-knowledge/TEMPLATE-MASTER.html. Сохрани в output_path.
```

### 4. Открыть `template.html` в браузере

```
PowerShell: Start-Process ".claude\handoff-requests\files\template.html"
Bash: xdg-open .claude/handoff-requests/files/template.html || open .claude/handoff-requests/files/template.html
```

Сообщить:
> «Шаблон открыт в браузере. Проверь дизайн, скажи ОК или попроси правки.»

Ждать ответа. Если правки — применить через Edit или повторно делегировать template-designer.

### 5. Создать метаданные для handoff-process

Записать `.claude/handoff-requests/setup-meta.json`:
```json
{
  "type": "setup-project",
  "created": "<ISO UTC>",
  "files": [
    {
      "source": ".claude/handoff-requests/files/ЗАКАЗЧИК.md",
      "target": "ЗАКАЗЧИК.md",
      "operation": "create"
    },
    {
      "source": ".claude/handoff-requests/files/template.html",
      "target": "template.html",
      "operation": "create"
    }
  ],
  "post_actions": [
    "git config core.hooksPath .claude/git-hooks"
  ],
  "notes": "Первичная инициализация проекта <URL>. После применения main-проект готов к /new-topics и /write-article."
}
```

### 6. Финал

Сообщить пользователю:
```
═══ SETUP READY ═══
Профиль и шаблон собраны в .claude/handoff-requests/.

Дальше:
  /handoff  — финализирует worktree, мержит в main
  Затем открой main-сессию (без worktree) → /handoff-process
              — применит файлы в корень проекта
═══════════════════
```

## Запреты

- Не пиши `ЗАКАЗЧИК.md` или `template.html` в корень проекта напрямую — только в `.claude/handoff-requests/files/`. Иначе pre-commit hook откажет в коммите.
- Не запускай `/new-topics`, `/write-article` из этой же сессии — это отдельные worktree-задачи.
- Не используй длинное тире (—) и среднее (–). Только дефис (-).

## Состояние

Скил одношаговый, без resume. Если что-то сломалось посередине — откати handoff-requests/setup-meta.json и handoff-requests/files/ и запусти заново.
