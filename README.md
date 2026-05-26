# SEO Pipeline Template

Шаблон проекта SEO-конвейера на Claude Code Desktop. Покрывает: исследование сайта клиента, сбор тем для блога, написание статей с JM-анализом и контролем N-грамм, сборка HTML, Тильда-фиксы, аудит и правки, а также **формирование SEO-стратегий с тарифами** (стратегия .docx + смета .xlsx).

Архитектура — **worktree-first multi-task**: каждая задача в отдельной git worktree, единственная команда в основной папке — `/handoff-process` (применяет накопленные результаты). Подробности — в [docs/adr/](docs/adr/).

---

## Содержание

1. [Установка нового клиента](#установка-нового-клиента)
2. [Ежедневный workflow](#ежедневный-workflow)
3. [Структура проекта](#структура-проекта)
4. [Компоненты](#компоненты)
5. [Расширение системы](#расширение-системы)
6. [Архитектурные решения (ADR)](#архитектурные-решения-adr)
7. [Troubleshooting](#troubleshooting)
8. [Требования](#требования)

---

## Установка нового клиента

Открой Claude Code Desktop в любой папке и вставь промт ниже целиком в сообщение:

````
Подключаю нового SEO-клиента. Действуй по шагам, никаких импровизаций.

ШАГ 1 — Получи параметры от пользователя
Спроси у меня:
  1. Slug папки клиента (например vasya_ru, без точек, кириллицы и пробелов).
     Подскажи default по URL если я уже его сообщил.
  2. URL сайта клиента (если ещё не дал).
После моего ответа — продолжай.

ШАГ 2 — Проверь среду
- Папка ~/seo-projects/ существует? Если нет, создай (mkdir -p).
- Папка ~/seo-projects/<slug>/ уже существует? Если да — стоп, сообщи мне
  и спроси: пропустить установку или использовать другой slug.
- Команда `git --version` работает? Если нет — стоп, попроси установить git.
- Команда `node --version` работает? Если нет — выполни
  `scoop install nodejs-lts` (если есть scoop) или попроси установить Node.js
  с https://nodejs.org/ и перезапустить сессию.

ШАГ 3 — Клонируй шаблон
git clone https://github.com/tem11134v2-cmd/seo-pipeline-template.git ~/seo-projects/<slug>/

Проверь: папка ~/seo-projects/<slug>/.claude/ существует? Если нет —
клонирование не прошло, разберись (нет интернета? неверный URL?
права на запись?). Не продолжай.

ШАГ 4 — Настрой проект
В новой папке выполни (через cd ~/seo-projects/<slug>/ или git -C):
- npm install
  Если node не найден — используй .claude\scripts\_node.cmd (он
  находит node через scoop fallback). Для npm обёртки нет, нужен
  настоящий node в PATH; если его нет — установи и перезапусти сессию.
- git config core.hooksPath .claude/git-hooks
  (включает pre-commit hook для всех будущих worktree этого репо)

ШАГ 5 — Сообщи готовность
Выведи мне ровно такое сообщение:

  ═══ ПРОЕКТ <slug> ГОТОВ ═══
  Папка: ~/seo-projects/<slug>/
  GitHub remote: origin
  Hooks: настроены

  Дальше:
    1. Открой ~/seo-projects/<slug>/ в новой сессии Claude Code Desktop
       с ВКЛЮЧЁННОЙ галочкой worktree.
    2. В этой новой сессии запусти:
       /setup-project <URL_клиента>

  Эту установочную сессию можно закрыть.
  ═════════════════════════════
````

> Промт спроектирован как один автономный набор инструкций. Если что-то пойдёт не так, Claude сам остановится и сообщит, не оставив проект в полу-собранном состоянии.

---

## Ежедневный workflow

### Один цикл задачи

```
┌─ worktree-сессия (галочка worktree) ──────────────┐
│                                                    │
│  /setup-project <URL>      ← один раз на клиента   │
│  /new-topics               ← один раз за период    │
│  /write-article 1          ← на каждую статью      │
│  /fix-article 001 "..."    ← по необходимости      │
│  /request-shared-edit "..."← если нужна правка     │
│                              общего файла          │
│                                                    │
│  /handoff                  ← всегда в конце        │
│      ↓ commit + merge + cleanup                    │
└────────────────────────────────────────────────────┘

┌─ main-сессия (БЕЗ галочки worktree) ──────────────┐
│  /handoff-process          ← если что-то писалось  │
│      ↓ apply requests + commit                     │
│                              в .claude/handoff-    │
│                              requests/             │
└────────────────────────────────────────────────────┘
```

### Когда нужен `/handoff-process`

- ✅ Нужен после `/setup-project` (создавал `ЗАКАЗЧИК.md` и `template.html` в handoff-requests).
- ✅ Нужен после `/new-topics` (создавал `topics-batch.json`).
- ✅ Нужен после `/write-article` или `/fix-article`, **если в их ходе был** `/request-shared-edit`.
- ❌ **Не нужен** после `/write-article` или `/fix-article`, если они не трогали общие файлы — статья уже в main после `/handoff`.

### Параллельная работа

Несколько worktree одновременно — без проблем (см. [ADR-001](docs/adr/001-worktree-first.md)). Каждая — своя задача, не толкаются. После завершения каждой — `/handoff`. В main `/handoff-process` обработает их все одним проходом, интеллектуально разрешая конфликты при необходимости (см. [ADR-002](docs/adr/002-handoff-split.md)).

---

## Структура проекта

```
~/seo-projects/<client>/                     ← клиентский проект (после git clone)
│
├── .claude/
│   ├── CLAUDE.md                            ← политика, читается каждой сессией
│   ├── settings.json                        ← Claude Code hooks config
│   │
│   ├── agents/                              ← 16 субагентов (см. ниже)
│   │   ├── client-profiler.md
│   │   ├── template-designer.md
│   │   ├── topic-generator.md
│   │   ├── jm-analyst.md
│   │   ├── tz-builder.md
│   │   ├── section-writer.md
│   │   ├── article-finalizer.md
│   │   ├── text-auditor.md
│   │   ├── enhancer.md
│   │   ├── photo-promter.md
│   │   ├── article-fixer.md
│   │   ├── strategy-scanner.md              ← /strategy
│   │   ├── competitor-analyst.md            ← /strategy
│   │   ├── growth-strategist.md             ← /strategy
│   │   ├── tariff-architect.md              ← /strategy
│   │   └── strategy-writer.md               ← /strategy
│   │
│   ├── skills/                              ← 9 скилов
│   │   ├── setup-project/SKILL.md           (worktree, исследование сайта)
│   │   ├── new-topics/SKILL.md              (worktree, сбор тем)
│   │   ├── write-article/SKILL.md           (worktree, цикл статьи)
│   │   ├── fix-article/SKILL.md             (worktree, правка)
│   │   ├── strategy/                        (worktree, стратегия + тарифы)
│   │   │   ├── SKILL.md
│   │   │   ├── MCP_MAP.md
│   │   │   └── strategy_data_schema.json
│   │   ├── share-strategy/SKILL.md          (worktree, загрузка .docx + .xlsx в Drive)
│   │   ├── request-shared-edit/SKILL.md     (worktree, запрос на общий файл)
│   │   ├── handoff/SKILL.md                 (worktree, финализация)
│   │   └── handoff-process/SKILL.md         (main, применение запросов)
│   │
│   ├── hooks/                               ← Claude Code hooks
│   │   ├── check-file.sh                    (SubagentStop, проверка вывода)
│   │   ├── check-section.sh                 (SubagentStop section-writer)
│   │   ├── check-jm-balance.sh              (PreToolUse jm_text_analyze)
│   │   ├── pause-for-review.sh              (SubagentStop article-finalizer)
│   │   └── update-meta.sh                   (helper)
│   │
│   ├── git-hooks/                           ← git hooks (НЕ Claude Code)
│   │   └── pre-commit                       (whitelist путей в worktree)
│   │
│   ├── scripts/                             ← Node-скрипты
│   │   ├── _node.cmd                        (обёртка, ищет node)
│   │   ├── _node.sh                         (POSIX обёртка)
│   │   ├── finalize-setup.mjs               (git init + первый коммит)
│   │   ├── to-excel.mjs                     (topics.json → topics.xlsx)
│   │   ├── assemble-html.mjs                (article.md + ... → output.html)
│   │   ├── tilda-split.mjs                  (output.html → head + t123)
│   │   ├── build-strategy-docx.mjs          (strategy_content.json → SEO_Strategy.docx)
│   │   └── build-smeta-xlsx.mjs             (tariffs.json → Smeta.xlsx)
│   │
│   ├── handoff-requests/                    ← запросы worktree → main
│   │   ├── .gitkeep
│   │   ├── files/                           (готовые файлы для корня)
│   │   ├── *.md                             (текстовые запросы на правку)
│   │   ├── topics-batch.json                (батч тем от /new-topics)
│   │   └── processed/                       (архив применённых)
│   │
│   └── tmp/                                 ← служебные файлы сессии (gitignore)
│       └── current-task.txt                 (путь текущей задачи, читается хуками)
│
├── docs/adr/                                ← architecture decision records
│   ├── README.md
│   ├── 001-worktree-first.md
│   ├── 002-handoff-split.md
│   ├── 003-pre-commit-whitelist.md
│   ├── 004-global-mcp-and-knowledge.md
│   ├── 005-node-wrapper.md
│   └── 006-github-distribution.md
│
├── ЗАКАЗЧИК.md                              ← создаётся через /setup-project + /handoff-process
├── template.html                            ← аналогично
├── topics.xlsx                              ← создаётся через /new-topics + /handoff-process
├── articles/NNN-slug/                       ← рабочие папки статей
│   ├── meta.json                            (state machine)
│   ├── jm/                                  (JM-анализ данные)
│   ├── sections/                            (поразделам)
│   ├── article.md                           (финальный markdown)
│   ├── output.html                          (собранный HTML)
│   └── tilda/                               (для Тильды, опц.)
│
├── strategies/NNN-domain-slug/              ← рабочие папки стратегий
│   ├── meta.json                            (state machine)
│   ├── inputs.json                          (домен, ниша, регион, доступы)
│   ├── scan.json + metrics.json             (от strategy-scanner)
│   ├── competitors.json + serp.json         (от competitor-analyst)
│   ├── growth-points.json + strategy_data.json (от growth-strategist)
│   ├── tariffs.json                         (от tariff-architect)
│   ├── strategy_content.json                (от strategy-writer)
│   ├── SEO_Strategy_<domain>.docx           (финал для клиента)
│   └── Smeta_<domain>.xlsx                  (финал внутренний)
│
├── package.json                             ← exceljs, marked, jsdom
├── .gitignore
├── .mcp.json.example                        ← документация формата (не активный конфиг)
└── README.md                                ← этот файл
```

### Глобальные ресурсы (вне проекта клиента)

```
~/.claude/seo-knowledge/                     ← общая методология SEO
├── STYLE.md                                 (правила живого текста, AI-маркеры)
├── GENRES.md                                (8 жанровых модулей)
├── ENHANCEMENTS.md                          (HTML-элементы: таблицы, цитаты...)
├── SVG-ICONS.md                             (набор инлайн SVG, без CDN)
├── TEMPLATE-MASTER.html                     (эталонный шаблон вёрстки)
├── CLIENT-TEMPLATE.md                       (образец ЗАКАЗЧИК.md)
├── TARIFFS.md                               (каталог услуг для /strategy)
├── RULES.md                                 (правила связок тарифов для /strategy)
└── DRIVE.md                                 (ID Drive-папок для /share-strategy)
```

См. [ADR-004](docs/adr/004-global-mcp-and-knowledge.md) — почему именно глобально.

---

## Компоненты

### 9 скилов (6 для работы, 3 для управления)

| Скил | Зона | Назначение |
|---|---|---|
| `/setup-project <URL>` | worktree | Исследование сайта, генерация `ЗАКАЗЧИК.md` и `template.html` в handoff-requests |
| `/new-topics` | worktree | Сбор 15-25 тем для блога, батч в handoff-requests |
| `/write-article N [--only-A\|--only-B] [--resume]` | worktree | Полный цикл статьи (JM → ТЗ → разделы → финал → аудит → улучшения → HTML) |
| `/fix-article NNN "..."` | worktree | Точечная правка готовой статьи |
| `/strategy <URL> [--resume]` | worktree | Полный цикл SEO-стратегии: скан → конкуренты → точки роста → 3 тарифа → стратегия .docx + смета .xlsx |
| `/share-strategy NNN [--redo]` | worktree | Загружает готовые .docx и .xlsx из `strategies/NNN/` на Google Drive в расшаренные папки-якоря, возвращает публичные ссылки |
| `/request-shared-edit "..."` | worktree | Отложенный запрос на правку общего файла |
| `/handoff` | worktree | Финализация: commit → merge в main → cleanup |
| `/handoff-process` | main | Применение накопленных запросов к общим файлам |

### 16 субагентов (вызываются скилами)

| Агент | Делает |
|---|---|
| `client-profiler` | Собирает данные с сайта клиента → ЗАКАЗЧИК.md |
| `template-designer` | Генерирует template.html на базе TEMPLATE-MASTER + ЗАКАЗЧИК.md |
| `topic-generator` | Собирает 15-25 тем через Wordstat / Keys.so / Yandex |
| `jm-analyst` | text_generate + text_analyze, сохраняет в jm/*.json |
| `tz-builder` | Собирает ТЗ статьи (вариант A или B) на основе JM-данных и конкурентов |
| `section-writer` | Пишет один H2-раздел статьи (используется `opus`) |
| `article-finalizer` | Заключение + метатеги + сборка article.md и report.md |
| `text-auditor` | Вычитка: AI-маркеры, орфография, законность РФ, повествование |
| `enhancer` | HTML-элементы по меткам + FAQ + Schema.org JSON-LD |
| `photo-promter` | Промты для фото по меткам `[ФОТО: ...]` |
| `article-fixer` | Точечная правка статьи (по запросу из `/fix-article`) |
| `strategy-scanner` | Скан сайта + первичные метрики клиента (для /strategy) |
| `competitor-analyst` | Конкуренты, типизация, выдача, вердикт (для /strategy) |
| `growth-strategist` | Точки роста + сборка strategy_data.json (для /strategy) |
| `tariff-architect` | Подбор трёх тарифов из TARIFFS.md по правилам RULES.md |
| `strategy-writer` | Проза для 6 разделов стратегии в strategy_content.json |

### 6 Node-скриптов

| Скрипт | Делает |
|---|---|
| `finalize-setup.mjs` | git init + `.env.example` + первый коммит (используется в `/handoff-process` для setup) |
| `to-excel.mjs` | topics.json → topics.xlsx (2 листа) |
| `assemble-html.mjs` | article.md + enhancements + faq + schema + photos + template → output.html |
| `tilda-split.mjs` | output.html → tilda/head.html + tilda/t123.html (с !important фиксами) |
| `build-strategy-docx.mjs` | strategy_content.json + tariffs.json + inputs.json → SEO_Strategy_<domain>.docx |
| `build-smeta-xlsx.mjs` | tariffs.json + inputs.json → Smeta_<domain>.xlsx (3 вкладки + формулы SUM) |

### 5 Claude Code хуков

| Хук | Когда срабатывает | Делает |
|---|---|---|
| `check-file.sh` | SubagentStop * | Проверяет создан ли ожидаемый выходной файл |
| `check-section.sh` | SubagentStop section-writer | Один H2, нет длинных тире, объём в допуске |
| `check-jm-balance.sh` | PreToolUse jm_text_analyze | Отказ если баланс JM < 5 |
| `pause-for-review.sh` | SubagentStop article-finalizer | Останавливает скил для review пользователем |
| `update-meta.sh` | helper | Обновляет meta.json статьи |

### 1 git-хук

| Хук | Когда | Делает |
|---|---|---|
| `pre-commit` | git commit | Проверяет белый список путей в worktree (см. [ADR-003](docs/adr/003-pre-commit-whitelist.md)) |

---

## Расширение системы

> **Если ты адаптируешь старый claude.ai-скил** (с фазами и `Шаг X-Y`) — сначала прочитай [docs/SKILL-ADAPTATION-GUIDE.md](docs/SKILL-ADAPTATION-GUIDE.md). Там методология декомпозиции: когда шаг → субагент, когда → скрипт, когда → hook, когда объединять.

### Как добавить новый скил

Сценарий: хочешь добавить, например, `/audit-tech` — технический аудит сайта.

1. **Реши, в какой зоне работает:** worktree (типично, как и все рабочие скилы) или main (только если правит общие файлы напрямую).
2. **Создай папку** `.claude/skills/audit-tech/SKILL.md`. Frontmatter:
   ```yaml
   ---
   name: audit-tech
   description: Технический аудит сайта клиента
   ---
   ```
3. **Опиши алгоритм** в теле SKILL.md. Если используешь новых субагентов — создай их в `.claude/agents/`.
4. **Если скил создаёт результаты для общих файлов** — пиши их в `.claude/handoff-requests/`, не в корень. Иначе pre-commit hook откажет.
5. **Если скил начинает per-task задачу** — первой строкой запиши `.claude/tmp/current-task.txt` с путём к папке задачи (например `audits/NNN-slug/`).
6. **Если скил вызывает Node-скрипт** — используй `.claude\scripts\_node.cmd <script>.mjs`.
7. **Обнови `README.md` → таблицу скилов.**
8. **Если решение архитектурно новое** — добавь ADR в `docs/adr/`.

### Как добавить новый тип задачи (не статья)

Сценарий: помимо `articles/NNN/` хочешь `audits/NNN/` (тех-аудиты).

1. **В pre-commit hook нет изменений** — он не зашит на `articles/`, а читает путь задачи из `.claude/tmp/current-task.txt`. Можешь класть task-dir куда хочешь, главное чтобы скил его правильно записал в current-task.txt.
2. **Создай скил** который пишет `.claude/tmp/current-task.txt = audits/NNN-slug/` и работает в этой папке.
3. **`/handoff` универсален** — он работает с любой папкой задачи.

### Как добавить новый MCP-сервер

1. **Подключи в Claude Code Desktop глобально** (через настройки приложения).
2. **Если агент должен использовать его** — упомяни инструменты в теле промта агента (frontmatter с `mcpServers:` не нужен, см. [ADR-004](docs/adr/004-global-mcp-and-knowledge.md)).
3. **Документация формата** — обнови `.mcp.json.example` если есть такая необходимость (для других пользователей).

### Как обновить существующих клиентов

Из активной клиентской папки:
```
git fetch origin
git diff main..origin/main -- .claude/   # посмотреть что меняется
git checkout origin/main -- .claude/     # вытянуть только .claude/, не трогая клиентские файлы
git add .claude/
git commit -m "Update template from upstream"
```

⚠️ Тщательно проверять diff — обновление может конфликтовать с локальными правками в `.claude/`.

В планах — скил `/update-template` для безопасной автоматизации этого процесса (см. [ADR-006](docs/adr/006-github-distribution.md) → Последствия).

---

## Архитектурные решения (ADR)

Каждое крупное решение задокументировано в `docs/adr/`. Читай прежде чем менять архитектуру:

| # | Решение |
|---|---|
| [001](docs/adr/001-worktree-first.md) | Все задачи в отдельных worktree-сессиях |
| [002](docs/adr/002-handoff-split.md) | `/handoff` делает merge, `/handoff-process` — apply |
| [003](docs/adr/003-pre-commit-whitelist.md) | Pre-commit hook с белым списком путей |
| [004](docs/adr/004-global-mcp-and-knowledge.md) | MCP и `seo-knowledge` — глобально |
| [005](docs/adr/005-node-wrapper.md) | Обёртка `_node.cmd` для устойчивости PATH |
| [006](docs/adr/006-github-distribution.md) | Шаблон через публичный GitHub |
| [007](docs/adr/007-strategy-task-type.md) | Новый тип задачи `strategies/` + порт Python-шаблонов на Node |
| [008](docs/adr/008-drive-sharing-anchor-folders.md) | Расшаривание стратегий через Drive + якорь-папки (обход бага addPermission) |

---

## Troubleshooting

### `pre-commit: В worktree запрещено менять файлы вне текущей задачи`

Ты находишься в worktree и пытаешься закоммитить общий файл (ЗАКАЗЧИК.md, template.html, topics.xlsx). Это нормально — система защищает общие файлы от случайных правок. Что делать:
- Если правка нужна: `/request-shared-edit "<описание>"` → файл-запрос попадёт в main через `/handoff` → применится через `/handoff-process`.
- Если правка не нужна: `git checkout -- <файл>`.

### `node is not recognized`

Не установлен Node.js или PATH унаследован старым процессом. Решение:
- `scoop install nodejs-lts`. После этого `.claude\scripts\_node.cmd` найдёт node автоматически, перезапуск десктопа **не нужен**.
- Альтернатива: установить с https://nodejs.org/ и перезапустить Claude Code Desktop.

### `Worktree remove failed: Permission denied` (Windows)

Файл-лок от индексатора или антивируса. Не страшно — git-метаданные о worktree всё равно убраны, папка останется на диске пустым «зомби». При следующем `/handoff-process` команда `git worktree prune` подчистит. Или удали папку вручную позже.

### `/handoff` не находит base branch (master vs main)

Скил `/handoff` определяет базовую ветку через `git -C <main_worktree> rev-parse --abbrev-ref HEAD`. Если main worktree оказалась на feature-ветке — будет аномалия. Решение: вернуть main worktree на основную ветку (`git checkout main` или `master`) перед `/handoff`.

### Скил говорит «работает только в worktree» (или наоборот «только в main»)

Открой сессию в правильном режиме (галочка «worktree» при создании сессии в Claude Code Desktop, или без неё для main). Не пытайся обойти — правило системное (см. [ADR-001](docs/adr/001-worktree-first.md)).

### Merge конфликт при `/handoff`

Скил остановится и сообщит файлы с конфликтом. Открой основную папку проекта в новой сессии (без worktree), разреши руками (`git status`, `git diff`, `git add`, `git commit`). Затем вернись в worktree-сессию и запусти `/handoff --resume` — он доделает cleanup.

---

## Требования

- **Claude Code Desktop** с глобально подключёнными MCP-серверами:
  - JM (jm_account, jm_text_generate, jm_text_analyze, jm_suggest, jm_wordstat, jm_task)
  - Wordstat (mcp_wordstat_*)
  - Yandex (mcp_yandex_search, mcp_yandex_get_position)
  - Keys.so (domain_dashboard, domain_pages, domain_competitors, ...)
  - Arsenkin (arsenkin_parse, arsenkin_positions, ...)
  - WK (wk_check_frequency, ...)
  - Webmaster (wm_*)
  - Fetch (mcp_fetch_page)
  - Sheets (опционально, если нужно с Google Sheets)
- **Node.js LTS** (24+): `scoop install nodejs-lts` или https://nodejs.org/. Зависимости: `exceljs`, `marked`, `jsdom`, `docx` — ставятся через `npm install`.
- **Git** с поддержкой `git worktree` (включён по умолчанию в современных версиях).
- **Глобальная папка** `~/.claude/seo-knowledge/` с авторской методологией. Содержимое — у автора, на новой машине нужно перенести вручную.
- **Windows / Linux / macOS:** разрабатывалось и тестировалось на Windows. Скрипты кросс-платформенные (`_node.cmd` для Win, `_node.sh` для POSIX), но в реальной работе только Windows проверен.

---

## Зачем «worktree-first»

Коротко: чтобы можно было параллельно вести несколько задач (статьи, аудиты, коммерческие тексты) в одном проекте клиента без конфликтов и потери данных.

Подробно — в [ADR-001](docs/adr/001-worktree-first.md).

---

## Ссылки

- Репо: https://github.com/tem11134v2-cmd/seo-pipeline-template
- Архитектурные решения: [docs/adr/](docs/adr/)
- Политика поведения внутри проекта (читается каждой сессией Claude): [.claude/CLAUDE.md](.claude/CLAUDE.md)
