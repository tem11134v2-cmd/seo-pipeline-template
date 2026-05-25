# ADR-007: Новый тип задачи `strategies/` + порт Python-шаблонов на Node

**Статус:** Принято

**Дата:** 2026-05-25

## Контекст

При портировании claude.ai-скила `seo-strategy` в Claude Code появилось три развилки:

1. **Где живут артефакты стратегии?** Существующая структура подразумевает `articles/NNN/` как per-task папку для статей. Стратегия — другой тип задачи: один комплект документов (стратегия .docx + смета .xlsx) на запуск, без множественных статей внутри. Нужна новая папка-тип или вписать в существующую.

2. **Где живут TARIFFS.md и RULES.md?** В исходном скиле они лежат в `references/`. Это **методология автора TIMUR SEO** (каталог его услуг и правила их связок) — одинаковая для всех клиентов. В архитектуре проекта общая методология идёт в `~/.claude/seo-knowledge/` (ADR-004). Альтернативно — рядом со скилом в `.claude/skills/strategy/references/`.

3. **Чем генерировать docx и xlsx?** Исходный `strategy_template.py` и `smeta_template.py` — на Python с openpyxl и описанием через `docx-js`. Проект уже стоит на Node.js (`exceljs`, `marked`, `jsdom`) — питон в стек не входит. Вариантов два: тянуть Python как новую зависимость или портировать на Node.

## Решение

### 1. Новый тип задачи — `strategies/NNN-<domain-slug>/`

Каждый запуск `/strategy <URL>` создаёт папку `strategies/NNN-<domain-slug>/` рядом с `articles/`. Внутри — `meta.json` (state machine), все промежуточные JSON (scan/metrics/competitors/serp/growth-points/strategy_data/tariffs/strategy_content) и финальные артефакты (`.docx` + `.xlsx`).

**Архитектура pre-commit hook менять не нужно** — он не зашит на `articles/`, читает путь задачи из `.claude/tmp/current-task.txt` и принимает любую папку (см. ADR-003). Скил `/strategy` пишет туда `strategies/NNN-slug/` первой строкой, дальше всё работает.

### 2. TARIFFS.md и RULES.md — в `~/.claude/seo-knowledge/`

Это методология автора, общая для всех клиентов (как STYLE.md, GENRES.md). Размещение в глобальной папке по ADR-004 — единый источник истины, обновил один раз → действует для всех клиентов.

`MCP_MAP.md` (карта MCP-инструментов для именно этой задачи) и `strategy_data_schema.json` (контракт данных) — **task-specific**, остаются в `.claude/skills/strategy/`.

### 3. Скрипты `build-strategy-docx.mjs` и `build-smeta-xlsx.mjs` — Node

Порт исходных Python-шаблонов:
- `build-smeta-xlsx.mjs` — на `exceljs` (уже в `package.json`).
- `build-strategy-docx.mjs` — на npm-пакет `docx` (`^9.0.0`, добавлен в `package.json`).

Дизайн-токены (цвета, шрифты, отступы) перенесены 1:1 — тёмно-синий `#1F4E79`, светло-голубой `#D5E8F0`, Arial 10pt, A4 поля 2 см.

## Альтернативы

### A. Стратегия как тип контента в `articles/`

Залить стратегию в `articles/NNN-strategy-<domain>/`. Отвергнуто:
- Семантически путает (стратегия не статья).
- В одной папке клиента может быть много статей и одна стратегия — структура должна это отражать.
- Если потом появится `audits/`, `commerce/`, `landings/` — однообразная конвенция «один тип = одна папка» проще.

### B. TARIFFS.md в `.claude/skills/strategy/`

Аргумент: связка с конкретным скилом, не загромождаем глобальную папку. Отвергнуто:
- ADR-004 устанавливает: общая авторская методология → глобально.
- Если в будущем появятся другие скилы, использующие тарифы (например `/commerce-offer` — коммерческое предложение по другим тарифам), методология должна быть единой.
- Цены и правила связок меняются у автора целиком, а не «под этот скил».

### C. Python для генерации docx/xlsx

Использовать исходные `strategy_template.py` и `smeta_template.py` через `python3 .claude/scripts/...py`. Отвергнуто:
- Тянет Python как новую обязательную зависимость, плюс openpyxl, плюс docx-js (Python пакет). Это +200MB в окружении, +шаг установки в README.
- Cross-platform pain: на Windows Python в PATH такая же история как с node (ADR-005).
- Уже есть `exceljs` для xlsx. Дублировать через openpyxl смысла нет.
- `docx` npm-пакет покрывает все нужные операции (Document, Table, TableCell, Footer, PageBreak, ShadingType, BorderStyle). Проверено smoke-тестом — выдаёт валидный .docx (11KB на минимальных данных).

### D. Один большой агент вместо пяти

`strategy-builder` делает скан + конкурентов + точки роста + тарифы + контент за один вызов. Отвергнуто:
- Раздувание контекста (агент читает свежие 5-7 JSON-файлов одновременно).
- Теряется свежесть креативной работы — точки роста после конкурентов требуют отдельной фокусировки.
- Это нарушает принцип SKILL-ADAPTATION-GUIDE: «когда нужен другой фокус — разделяй».

## Последствия

**Хорошо:**

- `/strategy` встроена в существующую механику без изменений pre-commit hook, `/handoff`, settings.json. Доказательство, что worktree-first архитектура реально многозадачна (как и заявлялось в ADR-001).
- TARIFFS/RULES в глобальной папке — обновляются один раз на всех клиентов.
- Node-стек однородный, без Python-зависимости. Smoke-тест прошёл.
- Образец для будущих похожих скилов (`/audit-tech`, `/commerce-offer`): берёшь паттерн «новая папка-тип + n агентов + 1-2 скрипта», работает.

**Плохо:**

- TARIFFS.md и RULES.md живут в `~/.claude/seo-knowledge/` — не в репо. Если автор сменит машину, нужно вручную перенести их вместе с STYLE/GENRES (документировано в README → Требования).
- `build-strategy-docx.mjs` ~300 строк — относительно большой скрипт. Меньше тесткейсов чем у строго детерминированных `assemble-html.mjs`, потому что docx-структура сложнее.
- Пакет `docx` ~5MB в `node_modules/`. Это плюсом к уже стоящему `exceljs`+`jsdom`+`marked`. Не критично, но если стек надо ужать — это первый кандидат на проверку альтернатив.

## Ссылки

- [ADR-001](001-worktree-first.md) — мультизадачная архитектура.
- [ADR-003](003-pre-commit-whitelist.md) — pre-commit универсален к task-dir.
- [ADR-004](004-global-mcp-and-knowledge.md) — общая методология глобально.
- `.claude/skills/strategy/SKILL.md` — оркестратор.
- `.claude/skills/strategy/MCP_MAP.md` — задачная карта MCP.
- `.claude/scripts/build-strategy-docx.mjs` + `build-smeta-xlsx.mjs` — Node-порты.
- `~/.claude/seo-knowledge/TARIFFS.md` + `RULES.md` — методология автора.
- Исходный claude.ai-скил `seo-strategy` (zip) — референс при адаптации, не входит в репо.
