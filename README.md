# SEO Pipeline Template

Шаблон проекта для SEO-конвейера на Claude Code: исследование сайта, сбор тем, написание статей с JM-анализом, сборка HTML, Тильда-фиксы.

Работает по модели «worktree-first»: одна задача = одна worktree-сессия + единая main-команда `/handoff-process` для синхронизации общих файлов.

## Установка нового проекта клиента

Скопируй промт ниже в новую сессию Claude Code Desktop (можно открыть её в любой папке, например в `~/seo-projects/`):

```
Подключаюсь к новому клиенту. Сделай следующее:

1. Если папки ~/seo-projects/ нет — создай её.
2. Спроси у меня slug папки клиента (например vasya_ru). Дождись ответа.
3. Склонируй https://github.com/tem11134v2-cmd/seo-pipeline-template.git в ~/seo-projects/<slug>/
   через: git clone <URL> ~/seo-projects/<slug>
4. В новой папке выполни:
   - npm install (через .claude\scripts\_node.cmd если node не в PATH:
     `.claude\scripts\_node.cmd` не нужен для npm install, используй npm install напрямую)
   - git config core.hooksPath .claude/git-hooks
5. Сообщи мне: «Готово. Открой ~/seo-projects/<slug>/ в новой сессии Claude Code Desktop
   с галочкой worktree и запусти /setup-project <URL_клиента>».
```

(Замени `tem11134v2-cmd` на свой GitHub username.)

## Дальнейшая работа

После клонирования и установки зависимостей — открой новую сессию Claude Code Desktop в `~/seo-projects/<slug>/` **с галочкой worktree** и запускай:

| Скил | Что делает |
|---|---|
| `/setup-project <URL>` | Исследует сайт, готовит `ЗАКАЗЧИК.md` и `template.html` |
| `/new-topics` | Собирает темы для блога |
| `/write-article N` | Пишет статью №N из `topics.xlsx` |
| `/fix-article NNN "..."` | Точечная правка готовой статьи |
| `/request-shared-edit "..."` | Запросить правку общего файла из worktree |
| `/handoff` | Закончить задачу (commit + merge в main + cleanup) |

После `/handoff` (если задача правила общие файлы) — открой **новую main-сессию** (без галочки worktree) в той же папке проекта и запусти:

```
/handoff-process
```

Эта команда применит накопленные handoff-запросы (создание `ЗАКАЗЧИК.md`, добавление тем в xlsx, и т.д.) и сделает финальный коммит.

## Структура проекта клиента

```
~/seo-projects/<slug>/
├── .claude/
│   ├── CLAUDE.md            ← политика работы, читается каждой сессией
│   ├── agents/              ← 11 субагентов (client-profiler, jm-analyst, section-writer, ...)
│   ├── skills/              ← 7 скилов
│   ├── hooks/               ← SubagentStop / PreToolUse хуки
│   ├── git-hooks/           ← pre-commit (whitelist путей в worktree)
│   ├── scripts/             ← Node-скрипты (assemble-html.mjs, to-excel.mjs, ...)
│   ├── handoff-requests/    ← запросы worktree-задач для main
│   └── tmp/                 ← служебные файлы текущей сессии
├── ЗАКАЗЧИК.md              ← создаётся через /setup-project + /handoff-process
├── template.html            ← создаётся через /setup-project + /handoff-process
├── topics.xlsx              ← создаётся через /new-topics + /handoff-process
├── articles/NNN-slug/       ← рабочие папки статей
├── package.json             ← exceljs, marked, jsdom
└── README.md
```

## Требования

- Claude Code Desktop с глобально подключёнными MCP-серверами (JM, Wordstat, Keys.so, Arsenkin, Webmaster, Yandex, Fetch, Sheets)
- Node.js (LTS) — `scoop install nodejs-lts` или https://nodejs.org/
- Git (включая поддержку `git worktree`)
- Глобальная папка `~/.claude/seo-knowledge/` с файлами STYLE.md, GENRES.md, ENHANCEMENTS.md, SVG-ICONS.md, TEMPLATE-MASTER.html, CLIENT-TEMPLATE.md (общая методология, не дублируется по проектам)

## Зачем «worktree-first»

- **Параллель без конфликтов:** несколько задач (статья 1, статья 2, аудит) идут параллельно — каждая в своей worktree, не мешая друг другу.
- **Защита общих файлов:** pre-commit hook не даёт worktree-сессии случайно сломать `ЗАКАЗЧИК.md` или `topics.xlsx`. Любая правка общих файлов идёт через handoff-process в main — с интеллектуальным merge противоречивых запросов.
- **Откат целиком:** не понравилась статья — `git worktree remove --force` уберёт её без следов в основной папке.
