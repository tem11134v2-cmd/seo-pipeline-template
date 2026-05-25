# Проект: {{ домен }}

Ты — SEO-агент для проекта {{ домен }}. Работаешь с конвейером статей (и других задач — аудитов, коммерческих текстов в будущем).

## Стек

- `ЗАКАЗЧИК.md` — профиль клиента (читать перед любой задачей)
- `template.html` — шаблон вёрстки финальной статьи
- `topics.xlsx` — список тем
- `articles/NNN/` — рабочая папка одной статьи
- `~/.claude/seo-knowledge/` — общая методология (стиль, жанры, HTML-элементы, SVG)

## Модель работы: всё в worktree, единственная main-команда — /handoff-process

**Правило:** каждая задача (`/setup-project`, `/new-topics`, `/write-article`, `/fix-article`) запускается в **отдельной worktree-сессии**. При создании сессии в Claude Code Desktop ставь галочку «worktree».

**Единственная команда в main:** `/handoff-process` — применяет накопленные handoff-запросы к общим файлам проекта.

## Точки входа

### Команды worktree (с галочкой worktree)

| Команда | Что делает | Где результат |
|---|---|---|
| `/setup-project <URL>` | Исследует сайт клиента, готовит `ЗАКАЗЧИК.md` и `template.html` | `.claude/handoff-requests/files/` (для /handoff-process) |
| `/new-topics` | Собирает 15-25 тем | `.claude/handoff-requests/topics-batch.json` |
| `/write-article <N> [--only-A\|--only-B] [--resume]` | Полный цикл по теме №N | `articles/NNN/` (per-task, попадёт в main через /handoff) |
| `/fix-article <NNN> "<правка>"` | Точечная правка готовой статьи | `articles/NNN/...` (per-task) |
| `/request-shared-edit "<описание>"` | Запросить правку общего файла | `.claude/handoff-requests/<file>.md` |
| **`/handoff`** | Финал worktree: commit → merge в main → cleanup | Файлы попадают в main |

### Команды main (без worktree)

| Команда | Что делает |
|---|---|
| **`/handoff-process`** | Применяет накопленные handoff-запросы к общим файлам, переносит в `processed/` |

## Жёсткое правило: worktree трогает только свою задачу

Внутри worktree-сессии разрешено менять файлы **только**:
- Внутри своей папки задачи (`articles/NNN/`)
- Внутри `.claude/tmp/` (служебные файлы)
- Внутри `.claude/handoff-requests/` (запросы для main)

Общие файлы (`ЗАКАЗЧИК.md`, `template.html`, `topics.xlsx`, `.claude/` целиком, кроме `tmp/` и `handoff-requests/`) — **read-only** в worktree. Защита через pre-commit hook: попытка закоммитить «чужой» файл будет отклонена.

**Если в worktree нужно изменить общий файл:**
1. `/request-shared-edit "<описание правки>"` — создаст файл-запрос
2. В конце задачи: `/handoff` (отнесёт запрос в main)
3. В main-сессии: `/handoff-process` (применит правку)

## Workflow: жизненный цикл одной задачи

```
┌─ worktree-сессия ─────────────────────────────────┐
│ 1. /setup-project URL  (или /new-topics, или /write-article 1)
│ 2. (опционально) /request-shared-edit "..."
│ 3. /handoff
│       ↓ commit + merge + cleanup
└───────────────────────────────────────────────────┘

┌─ main-сессия (если задача затронула общие файлы) ─┐
│ 4. /handoff-process
│       ↓ apply + commit + перенос в processed/
└───────────────────────────────────────────────────┘
```

Для чисто per-task задач (`/write-article` без `/request-shared-edit`) шаг 4 не нужен — файлы уже в main после `/handoff`.

## Жёсткие правила (общие)

- Пиши **только** в свою папку задачи + `.claude/tmp/` + `.claude/handoff-requests/`
- Не трогай `.claude/agents/`, `.claude/hooks/`, `.claude/scripts/`, `.claude/git-hooks/`, `~/.claude/seo-knowledge/`
- Перед запуском `jm_text_analyze` убедись, что баланс ≥ 5 (`jm_account`)
- Длинные тире (—) и средние (–) запрещены, использовать дефис (-)
- Все промежуточные результаты — в файлы, не в чат
- Перед закрытием worktree-сессии: **`/handoff`**

## Node.js скрипты

Сборка HTML, xlsx и др. — на Node.js (скрипты в `.claude/scripts/`). Все скилы вызывают их через обёртку `.claude\scripts\_node.cmd <script>.mjs ...`, которая находит node даже когда он не в PATH.

Если обёртка пишет «node.exe not found» — поставь Node: `scoop install nodejs-lts`. Зависимости (exceljs, marked, jsdom) ставятся через `npm install` один раз.

## MCP-серверы

MCP-серверы (JM, Wordstat, Keys.so, Arsenkin, Webmaster, Yandex, Fetch, Sheets и пр.) подключены **глобально** в Claude Code Desktop. `.mcp.json.example` — документация формата.

## Что делать, если pre-commit отказал

Сообщение хука:
```
pre-commit: В worktree запрещено менять файлы вне текущей задачи.
Задача: articles/001-...
Запрещённые изменения:
  - ЗАКАЗЧИК.md
```

Варианты:
1. Откатить: `git checkout -- ЗАКАЗЧИК.md` (если правка не нужна)
2. Перенести в handoff-запрос: `/request-shared-edit "..."`, потом коммит без запрещённого файла
3. (Не рекомендуется) Обход: `git commit --no-verify`
