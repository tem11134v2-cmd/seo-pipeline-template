# Проект SEO-конвейера

Ты — SEO-агент клиентского проекта. Конкретный клиент описан в `ЗАКАЗЧИК.md` в корне - **читай его перед задачей, если файл существует**. Предпродажные задачи (`/strategy`, `/seo-analysis`) запускаются ДО онбординга и `ЗАКАЗЧИК.md` НЕ требуют (на свежем клоне его ещё нет, он появляется только после `/setup-project`) - контекст они собирают сами (скан сайта + вопросы). Работаешь с конвейером статей (и других задач — стратегий, аудитов, коммерческих текстов в будущем).

## Стек

- `ЗАКАЗЧИК.md` — профиль клиента (читать перед задачей, если существует; предпродажным `/strategy` и `/seo-analysis` не требуется)
- `template.html` — шаблон вёрстки финальной статьи
- `topics.xlsx` — список тем
- `articles/NNN/` — рабочая папка одной статьи
- `strategies/NNN/` — рабочая папка SEO-стратегии (если запускался /strategy)
- `analyses/NNN/` — рабочая папка предпроектного анализа (если запускался /seo-analysis)
- `structures/NNN/` — рабочая папка структуры сайта (если запускался /seo-structure)
- `topics/NNN/` — рабочая папка батча тем (если запускался /new-topics)
- `~/.claude/seo-knowledge/` — общая методология (стиль, жанры, HTML-элементы, SVG, TARIFFS, RULES)

## Модель работы: всё в worktree, единственная main-команда — /handoff-process

**Правило:** каждая задача (`/setup-project`, `/new-topics`, `/write-article`, `/fix-article`, `/strategy`, `/seo-analysis`, `/seo-structure`, `/share-topics`) запускается в **отдельной worktree-сессии**. При создании сессии в Claude Code Desktop ставь галочку «worktree».

**Единственная команда в main:** `/handoff-process` — применяет накопленные handoff-запросы к общим файлам проекта.

## Точки входа

### Команды worktree (с галочкой worktree)

| Команда | Что делает | Где результат |
|---|---|---|
| `/setup-project <URL>` | Исследует сайт клиента, готовит `ЗАКАЗЧИК.md` и `template.html` | `.claude/handoff-requests/files/` (для /handoff-process) |
| `/new-topics [--resume]` | Полный цикл: собирает 15-25 тем → xlsx → автозагрузка в Drive (Google Sheet). Полная таблица в чат + ссылка | `topics/NNN-slug/` (per-task) |
| `/share-topics <NNN> [--redo]` | Утилита-помощник для `/new-topics`: перезалить после правок или догрузить если Drive был недоступен | `topics/NNN/share.json` (per-task) |
| `/write-article <N> [--resume]` | Полный цикл по теме №N | `articles/NNN/` (per-task, попадёт в main через /handoff) |
| `/fix-article <NNN> "<правка>"` | Точечная правка готовой статьи | `articles/NNN/...` (per-task) |
| `/strategy <URL> [--resume]` | Полный цикл стратегии: скан → конкуренты → точки роста → 3 тарифа → docx + xlsx → автозагрузка в Drive (Google Doc + Google Sheet) | `strategies/NNN-slug/` (per-task) |
| `/share-strategy <NNN> [--redo]` | Утилита-помощник для `/strategy`: перезалить после правок или догрузить если Drive был недоступен | `strategies/NNN/share.json` (per-task) |
| `/seo-analysis [--resume] [--no-share]` | Предпроектный анализ конкурентов: бриф → структурирование → конкуренты → SERP-вердикт → скан смыслов → A2.md + A3.md + recommendations.json + .docx + автозагрузка в Drive + revising-цикл до approved | `analyses/NNN-slug/` (per-task) |
| `/share-analysis <NNN> [--redo]` | Утилита-помощник для `/seo-analysis`: перезалить .docx в Drive после правок или догрузить если Drive был недоступен | `analyses/NNN/share.json` (per-task) |
| `/seo-structure <NNN> [--resume] [--review \| --auto] [--import <xlsx>]` | Структура сайта на базе предпроектного анализа: мастер-список из конкурентов → маркерные запросы → JM semantic_pack → топ-10 + каннибализация → A6.xlsx → клиент → A6.md | `structures/NNN-slug/` (per-task) |
| `/share-structure <NNN> [--redo]` | Утилита-помощник для `/seo-structure`: перезалить A6.xlsx в Drive после правок или догрузить если Drive был недоступен | `structures/NNN/share.json` (per-task) |
| `/request-shared-edit "<описание>"` | Запросить правку общего файла | `.claude/handoff-requests/<file>.md` |
| **`/handoff`** | Финал worktree: commit → merge в main → cleanup | Файлы попадают в main |

### Команды main (без worktree)

| Команда | Что делает |
|---|---|
| **`/handoff-process`** | Применяет накопленные handoff-запросы к общим файлам, переносит в `processed/` |
| `/sync-from-template [<путь>] [--apply]` | Обновляет машинерию (`.claude/{scripts,agents,skills,hooks,git-hooks}`) из локального шаблона. Клиентские файлы не трогает. Без `--apply` - dry-run. |

### Справочная (в любой зоне)

| Команда | Что делает |
|---|---|
| `/guide [тема]` | Полная карта рабочего процесса: вход/вопросы/опции/выход по каждой команде, связки артефактов, роли MCP, ступоры. `/guide <тема>` - один раздел. Ничего не выполняет, только объясняет. |

## Жёсткое правило: worktree трогает только свою задачу

Внутри worktree-сессии разрешено менять файлы **только**:
- Внутри своей папки задачи (`articles/NNN/`, `strategies/NNN/`, `analyses/NNN/`, `structures/NNN/`, `topics/NNN/`, и т.д. — путь объявляется через `.claude/tmp/current-task.txt`)
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

Для чисто per-task задач (`/write-article`, `/fix-article`, `/strategy` без `/request-shared-edit`) шаг 4 не нужен — файлы уже в main после `/handoff`.

## Жёсткие правила (общие)

- Пиши **только** в свою папку задачи + `.claude/tmp/` + `.claude/handoff-requests/`
- Не трогай `.claude/agents/`, `.claude/hooks/`, `.claude/scripts/`, `.claude/git-hooks/`, `~/.claude/seo-knowledge/`
- Перед запуском `jm_text_analyze` убедись, что баланс ≥ 5 (`jm_account`)
- **Факт раньше утверждения:** не пиши вывод-факт (ниша, регион, тип бизнеса, база Keyso, метрика) в общий артефакт раньше, чем его установил профильный агент (скан/анализ). Догадка из домена или названия - это ГИПОТЕЗА, не факт; источник истины для нижестоящих агентов - артефакт скана, а не догадка оркестратора.
- Длинные тире (—) и средние (–) запрещены, использовать дефис (-)
- Все промежуточные результаты — в файлы, не в чат
- Перед закрытием worktree-сессии: **`/handoff`**

## Node.js скрипты

Сборка HTML, xlsx, docx и др. — на Node.js (скрипты в `.claude/scripts/`). Все скилы вызывают их через обёртку `.claude\scripts\_node.cmd <script>.mjs ...`, которая находит node даже когда он не в PATH.

Если обёртка пишет «node.exe not found» — поставь Node: `scoop install nodejs-lts`. Зависимости (exceljs, marked, jsdom, docx) ставятся через `npm install` один раз.

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
