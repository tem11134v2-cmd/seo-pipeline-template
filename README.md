# SEO Pipeline Template

Шаблон проекта SEO-конвейера на Claude Code Desktop. Покрывает: исследование сайта клиента, сбор тем для блога, написание статей с JM-анализом и контролем N-грамм, сборка HTML, Тильда-фиксы, аудит и правки, **формирование SEO-стратегий с тарифами** (стратегия .docx + смета .xlsx), **предпроектный анализ конкурентов** (A2.md + A3.md) и **построение структуры сайта на базе анализа** (A6.xlsx → клиенту → A6.md в проект).

Архитектура — **worktree-first multi-task**: каждая задача в отдельной git worktree, единственная команда в основной папке — `/handoff-process` (применяет накопленные результаты). Подробности — в [docs/adr/](docs/adr/).

## Рабочий процесс: четыре независимых направления

`/new-project` всегда первым (создаёт проект клиента из шаблона). Дальше - одно или несколько **НЕЗАВИСИМЫХ** направлений, в любом порядке или параллельно. Не выстраивай их в единую цепочку - это разные услуги под разные цели.

```
ОДИНОЧКА - стратегия (пресейл/КП, самодостаточна)
  /seo-strategiya URL   -> SEO_Strategy.docx + Smeta.xlsx (КП клиенту)

ОДИНОЧКА - технический аудит (тех-здоровье сайта под Яндекс, самодостаточен; нужны доступы Вебмастер+Метрика)
  /seo-tehaudit <domain> -> A12.md + A12.docx (проблемы по приоритетам + чеклист разработчику)

ТРЕК «Коммерческое SEO» (коммерческие страницы сайта, от брифа; /seo-shablon НЕ нужен)
  1. /seo-analiz        -> A2.md + A3.md (предпроектный анализ конкурентов)
  2. /seo-struktura NNN -> A6.xlsx -> клиент -> A6.md (структура сайта)
       └─ с --metatags в конце автоматически -> A7.xlsx (метатеги)
  3. /seo-metategi      -> A7.xlsx (H1/Title/Description; или хвостом из шага 2)
  4. /seo-tekst         -> Texts.docx (Google Doc) + prototype.html на страницу
       (продающие тексты + HTML-прототип; согласование анализа ЦА с клиентом)
       └─ /seo-tekst-fix NNN "..." - точечная правка прототипа
  5. /seo-faq           -> faq.html (Schema.org FAQPage) на страницу + FAQ.docx
       (SEO-нормализация: FAQ + плитка тегов + перелинковка с недостающими N-граммами)

ТРЕК «Информационное SEO» (блог/статьи) - ПОЛНОСТЬЮ независим от коммерческого
  1. /seo-shablon URL  -> ЗАКАЗЧИК.md + template.html (профиль + шаблон статьи)
  2. /seo-temi         -> topics.xlsx (15-25 тем для блога)
  3. /seo-statya N     -> Article.docx + output.html (на каждую тему)
```

Связи - только ВНУТРИ трека, между треками их НЕТ:
- `/seo-struktura` читает `analyses/NNN/brief.json + competitors.json + serp.json + leader_scan.json` (внутри коммерческого) - обязательная стыковка
- `/seo-temi` и `/seo-statya` читают `ЗАКАЗЧИК.md` от `/seo-shablon` (внутри информационного); `/seo-statya` ещё `topics.xlsx + template.html`
- `/seo-strategiya` ни от чего не зависит (читает `ЗАКАЗЧИК.md` если есть, иначе спрашивает нишу/регион напрямую)
- `/seo-tehaudit` самодостаточен (домен + доступы Вебмастер/Метрика; `ЗАКАЗЧИК.md` не требуется); результат - чеклист для разработчика

Заметки:
- Направления независимы - бери любое, какое заказал клиент, в любом порядке (или несколько параллельно).
- Порядок важен только ВНУТРИ трека (коммерческий: анализ перед структурой; информационный: шаблон перед темами/статьями).
- `/seo-strategiya` можно запускать когда угодно (например, переутвердить тарифы).

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

Самый простой путь - скил `/new-project [slug] [URL]` (запускается из `~/seo-projects/`): он делает всё описанное ниже автоматически и в финале подсказывает следующий шаг. Промт ниже - ручной эквивалент на случай, если скил недоступен. Вставь его целиком в сообщение:

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
    2. В этой новой сессии запусти, в зависимости от стадии:
       - пресейл (нужна стратегия): /seo-strategiya <URL_клиента>
       - согласованная работа:      /seo-shablon <URL_клиента>

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
│  /seo-shablon <URL>      ← один раз на клиента   │
│  /seo-temi               ← один раз за период    │
│  /seo-statya 1          ← на каждую статью      │
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

- ✅ Нужен после `/seo-shablon` (создавал `ЗАКАЗЧИК.md` и `template.html` в handoff-requests).
- ✅ Нужен после `/seo-temi` (создавал `topics-batch.json`).
- ✅ Нужен после `/seo-statya` или `/fix-article`, **если в их ходе был** `/request-shared-edit`.
- ❌ **Не нужен** после `/seo-statya` или `/fix-article`, если они не трогали общие файлы — статья уже в main после `/handoff`.

### Параллельная работа

Несколько worktree одновременно — без проблем (см. [ADR-001](docs/adr/001-worktree-first.md)). Каждая — своя задача, не толкаются. После завершения каждой — `/handoff`. В main `/handoff-process` обработает их все одним проходом, интеллектуально разрешая конфликты при необходимости (см. [ADR-002](docs/adr/002-handoff-split.md)).

Чтобы видеть всю картину сразу - что отдано, что ещё висит в worktree (в т.ч. «готово, но не хендофнуто»), где остались zombie-папки - запусти **`/status`** из `~/seo-projects/` (родительская команда, рядом с `/new-project`). Статус производный из `meta.json` каждой задачи, сортировка по свежести; авто-действий с worktree не делает, только подсвечивает.

---

## Структура проекта

```
~/seo-projects/<client>/                     ← клиентский проект (после git clone)
│
├── .claude/
│   ├── CLAUDE.md                            ← политика, читается каждой сессией
│   ├── settings.json                        ← Claude Code hooks config
│   │
│   ├── agents/                              ← 58 субагентов (см. ниже)
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
│   │   ├── article-fixer-batch.md
│   │   ├── strategy-scanner.md              ← /seo-strategiya
│   │   ├── competitor-analyst.md            ← /seo-strategiya
│   │   ├── growth-strategist.md             ← /seo-strategiya
│   │   ├── tariff-architect.md              ← /seo-strategiya
│   │   ├── strategy-writer.md               ← /seo-strategiya
│   │   ├── brief-structurer.md              ← /seo-analiz
│   │   ├── competitor-finder.md             ← /seo-analiz
│   │   ├── serp-verdict.md                  ← /seo-analiz
│   │   ├── leader-scanner.md                ← /seo-analiz
│   │   ├── analysis-writer.md               ← /seo-analiz
│   │   ├── master-list-builder.md           ← /seo-struktura
│   │   ├── marker-finder.md                 ← /seo-struktura
│   │   ├── semantic-expander.md             ← /seo-struktura
│   │   ├── cannibalization-resolver.md      ← /seo-struktura
│   │   ├── structure-writer.md              ← /seo-struktura
│   │   ├── site-scanner.md                  ← /seo-metategi
│   │   ├── metatag-researcher.md            ← /seo-metategi
│   │   ├── metatag-writer.md                ← /seo-metategi
│   │   ├── audit-recon.md                   ← /seo-tehaudit
│   │   ├── audit-indexing.md                ← /seo-tehaudit
│   │   ├── audit-onpage.md                  ← /seo-tehaudit
│   │   ├── audit-analytics.md               ← /seo-tehaudit
│   │   ├── audit-writer.md                  ← /seo-tehaudit
│   │   ├── audience-analyst.md              ← /seo-tekst
│   │   ├── offer-strategist.md              ← /seo-tekst
│   │   ├── leader-block-scanner.md          ← /seo-tekst
│   │   ├── direction-scanner.md             ← /seo-tekst
│   │   ├── block-planner.md                 ← /seo-tekst
│   │   ├── page-writer.md                   ← /seo-tekst
│   │   ├── copy-auditor.md                  ← /seo-tekst
│   │   ├── site-reviewer.md                 ← /seo-tekst
│   │   ├── prototype-builder.md             ← /seo-tekst
│   │   ├── prototype-fixer.md               ← /seo-tekst-fix
│   │   └── faq-builder.md                   ← /seo-faq
│   │
│   ├── skills/                              ← 28 скилов
│   │   ├── guide/SKILL.md                   (любая зона, справочник процесса)
│   │   ├── seo-shablon/SKILL.md           (worktree, исследование сайта)
│   │   ├── seo-temi/SKILL.md              (worktree, сбор тем)
│   │   ├── share-topics/SKILL.md            (worktree, загрузка Topics.xlsx в Drive)
│   │   ├── seo-statya/SKILL.md           (worktree, цикл статьи)
│   │   ├── fix-article/SKILL.md             (worktree, точечная правка)
│   │   ├── rewrite-section/SKILL.md         (worktree, переписать один H2)
│   │   ├── share-article/SKILL.md           (worktree, загрузка Article.docx в Drive)
│   │   ├── seo-strategiya/                        (worktree, стратегия + тарифы)
│   │   │   ├── SKILL.md
│   │   │   ├── MCP_MAP.md
│   │   │   └── strategy_data_schema.json
│   │   ├── share-strategy/SKILL.md          (worktree, загрузка .docx + .xlsx в Drive)
│   │   ├── seo-analiz/                    (worktree, предпроектный анализ)
│   │   │   ├── SKILL.md
│   │   │   └── MCP_MAP.md
│   │   ├── share-analysis/SKILL.md          (worktree, загрузка A2.docx в Drive)
│   │   ├── seo-struktura/                   (worktree, структура сайта по анализу)
│   │   │   ├── SKILL.md
│   │   │   └── MCP_MAP.md
│   │   ├── share-structure/SKILL.md         (worktree, загрузка A6.xlsx в Drive)
│   │   ├── seo-metategi/                    (worktree, метатеги H1/Title/Description)
│   │   │   ├── SKILL.md
│   │   │   ├── MCP_MAP.md
│   │   │   └── PLAYBOOK.md
│   │   ├── share-metatags/SKILL.md          (worktree, загрузка A7.xlsx в Drive)
│   │   ├── seo-tehaudit/                     (worktree, технический аудит сайта)
│   │   │   ├── SKILL.md
│   │   │   └── MCP_MAP.md
│   │   ├── share-audit/SKILL.md             (worktree, загрузка A12.docx в Drive)
│   │   ├── seo-tekst/                       (worktree, конверсионные тексты + HTML-прототипы)
│   │   │   ├── SKILL.md
│   │   │   ├── MCP_MAP.md
│   │   │   └── assets/                      (BLOCKS.md, COPY.md, VOICE.md, COPY-AUDIT.md, KIT-SPEC.md, LEGAL.md,
│   │   │                                     fragments-manifest.json, PROTOTYPE-MASTER.html, prototype.css, prototype.js,
│   │   │                                     arrow.svg, fragments/, legal/, themes/ - 7 тем, вкл. theme-wireframe)
│   │   ├── seo-tekst-fix/SKILL.md           (worktree, точечная правка прототипа)
│   │   ├── share-tekst/SKILL.md             (worktree, загрузка Analysis/Texts.docx в Drive)
│   │   ├── seo-faq/                         (worktree, SEO-нормализация: FAQ + теги + перелинковка)
│   │   │   ├── SKILL.md
│   │   │   └── MCP_MAP.md
│   │   ├── share-faq/SKILL.md               (worktree, загрузка FAQ.docx в Drive)
│   │   ├── request-shared-edit/SKILL.md     (worktree, запрос на общий файл)
│   │   ├── handoff/SKILL.md                 (worktree, финализация)
│   │   ├── handoff-process/SKILL.md         (main, применение запросов)
│   │   └── sync-from-template/SKILL.md      (main, обновление машинерии из шаблона)
│   │
│   ├── hooks/                               ← Claude Code hooks
│   │   ├── check-file.sh                    (SubagentStop, проверка вывода)
│   │   ├── check-section.sh                 (SubagentStop section-writer)
│   │   ├── check-jm-balance.sh              (PreToolUse jm_text_analyze)
│   │   ├── mark-finalized.sh                (SubagentStop article-finalizer)
│   │   └── update-meta.sh                   (helper)
│   │
│   ├── git-hooks/                           ← git hooks (НЕ Claude Code)
│   │   └── pre-commit                       (whitelist путей в worktree)
│   │
│   ├── scripts/                             ← обёртки + 55 .mjs
│   │   ├── _node.cmd / _node.sh             (обёртки, ищут node)
│   │   ├── _client.mjs                      (общий helper)
│   │   ├── finalize-setup.mjs               (git init + первый коммит)
│   │   ├── to-excel.mjs                     (legacy: topics.json → корневой topics.xlsx)
│   │   ├── topics-to-excel.mjs              (батч → Topics_<slug>.xlsx, актуальный)
│   │   ├── from-excel-topics.mjs            (xlsx → topics-batch.json, правки клиента)
│   │   ├── read-topics-xlsx.mjs             (чтение topics.xlsx для дедупа)
│   │   ├── update-index.mjs                 (articles/_index.json)
│   │   ├── assemble-html.mjs                (article.md + ... → output.html)
│   │   ├── metrics-report.mjs              (метрики читаемости → report.md)
│   │   ├── verify-progress.mjs              (сверка progress.json с секциями)
│   │   ├── verify-markers.mjs               (проверка сохранности меток)
│   │   ├── build-article-docx.mjs           (article + фото → Article_<slug>.docx)
│   │   ├── tilda-split.mjs                  (output.html → head + t123)
│   │   ├── build-strategy-docx.mjs          (strategy_content.json → SEO_Strategy.docx)
│   │   ├── build-smeta-xlsx.mjs             (tariffs.json → Smeta.xlsx)
│   │   ├── build-analysis-docx.mjs          (A2.md → A2_<slug>.docx)
│   │   ├── select-top10.mjs                 (semantic_pack.json → top10 + cannibalization)
│   │   ├── build-structure-xlsx.mjs         (master_list+top10 → A6_<slug>.xlsx)
│   │   ├── import-structure.mjs             (client_filled.xlsx → structure_data.json)
│   │   ├── render-audit-md.mjs              (audit_data.json → A12.md)
│   │   ├── build-audit-docx.mjs             (audit_data.json → A12_<slug>.docx)
│   │   ├── verify-audit.mjs                 (проверка audit_data.json)
│   │   ├── select-audit-pages.mjs           (indexing.json → page_plan.json: выборка+шарды)
│   │   ├── merge-onpage.mjs                 (onpage_*.json шарды → onpage.json)
│   │   └── ...                              (всего 55 .mjs - полный список в таблице «Node-скрипты» ниже)
│   │
│   ├── handoff-requests/                    ← запросы worktree → main
│   │   ├── .gitkeep
│   │   ├── files/                           (готовые файлы для корня)
│   │   ├── *.md                             (текстовые запросы на правку)
│   │   ├── topics-batch.json                (батч тем от /seo-temi)
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
│   ├── 006-github-distribution.md
│   ├── 007-strategy-task-type.md
│   ├── 008-drive-sharing-anchor-folders.md
│   ├── 009-seo-analysis-task-type.md
│   ├── 010-structures-task-type.md
│   ├── 011-template-self-guard.md
│   ├── 012-metatags-task-type.md
│   ├── 013-numbering-by-topic-derived-index.md
│   ├── 014-audit-task-type.md
│   ├── 015-tekst-task-type.md
│   ├── 016-faq-task-type.md
│   ├── 017-leader-block-scan-and-catalog.md
│   ├── 018-v4-copy-quality-layer.md
│   ├── 019-machinery-sync.md
│   └── 020-writer-context-diet-and-voice.md
│
├── ЗАКАЗЧИК.md                              ← создаётся через /seo-shablon + /handoff-process
├── template.html                            ← аналогично
├── topics.xlsx                              ← создаётся через /seo-temi + /handoff-process
├── articles/_index.json                     ← индекс статей (topic_id, жанр, state)
├── articles/NNN-slug/                       ← рабочие папки статей
│   ├── meta.json                            (state machine)
│   ├── jm/                                  (JM-анализ данные)
│   ├── sections/                            (по разделам)
│   ├── article.md                           (финальный markdown)
│   ├── report.md + audit.md                 (отчёт + аудит)
│   ├── photos/                              (фото + urls.json от Cloudinary)
│   ├── output.html                          (собранный HTML)
│   ├── Article_<slug>.docx                  (финал для клиента)
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
│   ├── SEO_Strategy_<domain>.docx           (финал для клиента, без цен)
│   ├── Smeta_<domain>.xlsx                  (финал внутренний, с ценами)
│   └── share.json                           (ссылки Drive: Doc + Sheet)
│
├── analyses/NNN-domain-slug/                ← рабочие папки предпроектных анализов
│   ├── meta.json                            (state machine)
│   ├── brief_raw.txt                        (исходный бриф клиента)
│   ├── brief.json                           (16 параметров + путь Keyso)
│   ├── candidates.json                      (15+ доменов до фильтрации)
│   ├── competitors.json                     (6-10 + топ-3 лидера)
│   ├── serp.json                            (SERP-анализ + вердикт + стоп-лист)
│   ├── leader_scan.json                     (блоки/посылы/фишки топ-3)
│   ├── A2.md                                (финал - markdown-отчёт)
│   ├── A3.md                                (финал - стоп-лист)
│   ├── recommendations.json                 (рекомендации для /seo-strategiya, /seo-statya)
│   ├── stop_list_detailed.json              (стоп-лист с причинами)
│   ├── A2_<domain>.docx                     (для клиента, кроме --no-share)
│   └── share.json                           (ссылка Drive + ревизии)
│
├── structures/NNN-domain-slug/              ← рабочие папки структур сайта
│   ├── meta.json                            (state machine)
│   ├── inputs.json                          (analysis_dir + slug + регион)
│   ├── master_list.json                     (страницы из конкурентов + спаривание)
│   ├── markers.json                         (маркер + источник + частотность на страницу)
│   ├── semantic_pack.json                   (топ-30 JM на каждый маркер)
│   ├── top10.json                           (отфильтрованные топ-10)
│   ├── cannibalization.json                 (конфликты + разрешения + рекомендации)
│   ├── A6_<slug>.xlsx                       (для клиента — 4 листа)
│   ├── client_filled.xlsx                   (правленая клиентом версия)
│   ├── structure_data.json                  (распарсенная клиентская версия)
│   ├── A6.md                                (финал - для У5/У6/У7/У8)
│   └── share.json                           (ссылка Drive)
│
├── metatags/NNN-domain-slug/                ← рабочие папки метатегов (A7)
│   ├── meta.json                            (state machine + depth + источник)
│   ├── inputs.json                          (slug + регион + УТП-блок + запрещёнки)
│   ├── audit.json                           (только --site: текущие метатеги + приоритет)
│   ├── pages.json                           (целевые страницы от read-metatags-input)
│   ├── research.json                        (варианты + частотность + Comm/Geo + подсказки)
│   ├── shortlist.json                       (chosen_form + shortlist + резерв на страницу)
│   ├── pages/N.json                         (H1/Title/Description + аналитика на страницу)
│   ├── A7_<slug>.xlsx                       (финал - 3 листа: Метатеги/Аналитика/Сводка)
│   └── share.json                           (ссылка Drive)
│
├── audits/NNN-domain-slug/                  ← рабочие папки технических аудитов (A12)
│   ├── meta.json                            (state machine + drive_file_id + revisions)
│   ├── recon.json                           (шаг 1: карточка, host_id, counter_id, база Keyso, CMS)
│   ├── indexing.json                        (шаг 2: robots, sitemap+all_urls, диагностика, редиректы, доноры)
│   ├── onpage.json                          (шаг 3: выборка 8-12 страниц, Title-заглушка, schema)
│   ├── analytics.json                       (шаг 4: трафик, отказы, цели, устройства, вердикт ЯБ)
│   ├── audit_data.json                      (шаг 5: единый структурированный отчёт - источник истины)
│   ├── A12.md                               (финал - markdown-отчёт)
│   ├── A12_<slug>.docx                      (финал - клиентский документ, дизайн TIMUR SEO)
│   └── share.json                           (ссылка Drive)
│
├── texts/NNN-domain-slug/                   ← рабочие папки текстов + прототипов (/seo-tekst)
│   ├── meta.json                            (state machine + drive: analysis/texts)
│   ├── inputs.json                          (slug/домен/регион/ниша/УТП + реквизиты для legal)
│   ├── facts.json                           (единый источник цифр: реквизиты/гарантии/числа - все цифры сайта только отсюда, v4)
│   ├── pages.json                           (целевые страницы)
│   ├── leader_blocks.json                   (опц.: матрица блоков лидеров по типу страниц - leader-block-scanner)
│   ├── recon/<slug>.json                    (контент-разведка топ-10 направления - direction-scanner)
│   ├── audience.json                        (анализ ЦА - audience-analyst)
│   ├── strategy.json                        (стратегия оффера - offer-strategist)
│   ├── blueprints/<page-slug>.json          (блок-план страницы: блоки+цели+слоты+лимиты - block-planner, ADR-020)
│   ├── site_audit.json                      (кросс-страничный аудит - site-reviewer)
│   ├── Analysis_<slug>.docx                 (клиенту на согласование -> Google Doc)
│   ├── pages/<page-slug>/                   (по странице)
│   │   ├── page.json                        (тексты блоков - page-writer)
│   │   ├── manifest.json                    (копия + рендер - prototype-builder)
│   │   └── prototype.html                   (ФИНАЛ - self-contained прототип)
│   ├── Texts_<slug>.docx                    (клиенту финальные тексты -> Google Doc)
│   └── share.json                           (ссылки Drive: analysis + texts)
│
├── faq/NNN-domain-slug/                     ← рабочие папки SEO-блоков (/seo-faq)
│   ├── meta.json + inputs.json + pages.json (текст страниц + целевые запросы)
│   ├── pages/<page-slug>/
│   │   ├── faq_blocks.json                  (FAQ+теги+перелинковка + normalized_keywords - faq-builder)
│   │   ├── faq.html                         (ФИНАЛ - вставляемый сниппет + Schema.org FAQPage)
│   │   └── faq.md
│   ├── FAQ_<slug>.docx                      (клиенту -> Google Doc)
│   └── share.json
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
├── TARIFFS.md                               (каталог услуг для /seo-strategiya)
├── RULES.md                                 (правила связок тарифов для /seo-strategiya)
└── DRIVE.md                                 (ID Drive-папок для всех /share-*)
```

См. [ADR-004](docs/adr/004-global-mcp-and-knowledge.md) — почему именно глобально.

---

## Компоненты

Три сквозных паттерна, общих для большинства рабочих скилов:
- **Финальный верификатор.** Перед сборкой итогового документа почти каждый пайплайн ставит независимого `opus`-агента `<domain>-verifier` (например `article-verifier`, `structure-verifier`, `strategy-verifier`, `audit-verifier`, `analysis-verifier`, `topics-verifier`): он ничего не чинит, только пишет `verify_report.json` и переводит задачу в состояние `*-verified`. Решение — [ADR-025](docs/adr/025-final-verifiers.md); методология для новых скилов — раздел «Финальный верификатор» в [docs/SKILL-ADAPTATION-GUIDE.md](docs/SKILL-ADAPTATION-GUIDE.md).
- **Ядро + REFERENCE.md.** У самых длинных скилов (`seo-statya`) `SKILL.md` разрезан на компактное ядро (шаги оркестрации) и `REFERENCE.md` (справочные секции по якорям — форматы, чек-листы, edge-кейсы), чтобы не грузить контекст оркестратора тем, что нужно редко.
- **Серийный режим на очереди.** `/seo-statya` умеет писать пачку тем за одну worktree-сессию через `.claude/scripts/batch-queue.mjs` и `.claude/tmp/batch-queue.json` — детерминированная очередь `init/next/set/status`, переживающая авто-компакт контекста.

### 28 скилов (14 рабочих, 9 share-утилит, 4 управляющих, 1 справочный)

| Скил | Зона | Назначение |
|---|---|---|
| `/guide [тема]` | любая | Справочник рабочего процесса: вход/вопросы/опции/выход по каждой команде, связки артефактов, роли MCP, ступоры. Ничего не выполняет |
| `/seo-shablon <URL>` | worktree | Исследование сайта, генерация `ЗАКАЗЧИК.md` и `template.html` в handoff-requests |
| `/seo-temi` | worktree | Сбор 15-25 тем для блога, батч в `topics/NNN/` + автозагрузка в Google Sheet |
| `/share-topics NNN [--redo]` | worktree | Утилита: перезалить Topics.xlsx в Drive после правок, или догрузить если Drive был недоступен |
| `/seo-statya N [--resume]` | worktree | Полный цикл статьи (JM → ТЗ → разделы → финал → аудит → улучшения → HTML) |
| `/fix-article NNN "..."` | worktree | Точечная правка готовой статьи |
| `/rewrite-section NNN idx "..."` | worktree | Переписать один H2-раздел статьи заново |
| `/share-article NNN [--redo]` | worktree | Утилита: перезалить Article.docx в Drive после правок, или догрузить если Drive был недоступен |
| `/seo-strategiya <URL> [--resume]` | worktree | Полный цикл SEO-стратегии: скан → конкуренты → точки роста → 3 тарифа → стратегия .docx + смета .xlsx → **автозагрузка в Google Drive с конверсией в Google Doc/Sheet** |
| `/share-strategy NNN [--redo]` | worktree | Утилита: перезалить в Drive после правок локальных файлов, либо догрузить если Drive был недоступен при первом прогоне `/seo-strategiya` |
| `/seo-analiz [--resume]` | worktree | Предпроектный анализ конкурентов: бриф → структурирование → конкуренты → SERP-вердикт → скан смыслов топ-3 → A2.md + A3.md + опц. .docx |
| `/share-analysis NNN [--redo]` | worktree | Утилита: перезалить A2.docx в Drive после правок, или догрузить если Drive был недоступен |
| `/seo-struktura NNN [--resume] [--review\|--auto] [--import <xlsx>]` | worktree | Построение структуры сайта на базе анализа: мастер-список → маркеры → JM semantic_pack → топ-10 + каннибализация → A6.xlsx → клиент → A6.md |
| `/share-structure NNN [--redo]` | worktree | Утилита: перезалить A6.xlsx в Drive после правок, или догрузить если Drive был недоступен |
| `/seo-metategi [--from-structure NNN] [--site <домен>] [--table <путь>] [--depth deep\|bulk] [--resume]` | worktree | Генерация метатегов (H1, Title, Description) под Яндекс: один движок, две глубины - deep (анализ выдачи + Акварель, по странице последовательно) и bulk (по PLAYBOOK + батч-данные, дёшево, параллельно). Три источника страниц: структура / сканирование сайта / таблица. Выход: A7_<slug>.xlsx (3 листа) |
| `/share-metatags NNN [--redo]` | worktree | Утилита: перезалить A7.xlsx в Drive после правок, или догрузить если Drive был недоступен |
| `/seo-tehaudit <domain> [--resume] [--no-share]` | worktree | Технический SEO-аудит сайта под Яндекс: разведка/карточка → индексация → URL/мета/Schema/JS → аналитика/ссылки → A12.md + A12.docx (проблемы по приоритетам, чеклист разработчику, динамические приложения) → автозагрузка в Drive + цикл правок |
| `/share-audit NNN [--redo]` | worktree | Утилита: перезалить A12.docx в Drive после правок, или догрузить если Drive был недоступен |
| `/seo-tekst [--from-structure NNN\|--from-table\|--from-analysis] [--mode A\|B] [--review\|--auto] [--theme]` | worktree | Конверсионные тексты коммерческих страниц + HTML-прототип. Анализ ЦА/оффера → согласование с клиентом (Analysis.docx → Google Doc) → веер писателей → сборка прототипов поверх kit. Выход: Texts.docx (Google Doc) + prototype.html на страницу |
| `/seo-tekst-fix NNN [slug] "..."` | worktree | Точечная правка прототипа (разбор голосовых; manifest → пересборка → дифф) |
| `/share-tekst NNN [--redo]` | worktree | Утилита: перезалить Analysis/Texts.docx в Drive после правок, или догрузить если Drive был недоступен |
| `/seo-faq [--from-tekst NNN\|--from-table\|--url] [--review\|--auto]` | worktree | SEO-нормализация: JM-анализ пробелов текста → FAQ (Schema.org FAQPage) + плитка тегов + перелинковка с недостающими N-граммами. Выход: faq.html (вставляемый сниппет) на страницу + FAQ.docx (Google Doc) |
| `/share-faq NNN [--redo]` | worktree | Утилита: перезалить FAQ.docx в Drive после правок, или догрузить если Drive был недоступен |
| `/custom-question [<вопрос>\|<файл>] [--resume] [--format auto\|answer\|recommendation\|doc]` | worktree | Разбор нестандартного вопроса заказчика: контекст по файлам проекта → обязательный гейт трактовки (AskUserQuestion, опция «передать заказчику») → решение (ответ/рекомендация/документ) без SEO-жаргона → запись в общий QA-ЖУРНАЛ.md |
| `/request-shared-edit "..."` | worktree | Отложенный запрос на правку общего файла |
| `/handoff` | worktree | Финализация: commit → merge в main → cleanup |
| `/handoff-process` | main | Применение накопленных запросов к общим файлам |
| `/sync-from-template [путь] [--apply]` | main | Обновление машинерии (`.claude/{scripts,agents,skills,hooks,git-hooks,migrations,tests}` + package.json) из локального шаблона; без `--apply` - dry-run |

### 58 субагентов (вызываются скилами)

Каждый агент объявляет модель явно - ярус `sonnet` (механика: сбор данных, применение правок, парсинг/генерация по шаблону) или `opus` (клиентская проза, вердикты, аудит), а не `inherit`. Полная таблица ярусов и обоснований - в [docs/MODEL-POLICY.md](docs/MODEL-POLICY.md) ([ADR-024](docs/adr/024-subagent-model-policy.md)).

| Агент | Делает |
|---|---|
| `client-profiler` | Собирает данные с сайта клиента → ЗАКАЗЧИК.md |
| `template-designer` | Генерирует template.html на базе TEMPLATE-MASTER + ЗАКАЗЧИК.md |
| `topic-generator` | Собирает 15-25 тем через Wordstat / Keys.so / Yandex |
| `topics-verifier` | Лёгкая проверка батча тем перед показом пользователю: дубли/пересечения с existing_queries.json, неполные поля, нерелевантность нише → verify_report.json, ничего не чинит (для /seo-temi, шаг 4.5) |
| `jm-analyst` | text_generate + text_analyze, сохраняет в jm/*.json |
| `tz-builder` | Собирает ТЗ статьи (вариант A или B) на основе JM-данных и конкурентов |
| `section-writer` | Пишет один H2-раздел статьи (используется `opus`) |
| `article-finalizer` | Заключение + метатеги + сборка article.md и report.md |
| `text-auditor` | Вычитка: AI-маркеры, орфография, законность РФ, повествование |
| `enhancer` | HTML-элементы по меткам + FAQ + Schema.org JSON-LD |
| `photo-promter` | Промты для фото по меткам `[ФОТО: ...]` |
| `photo-producer` | Генерирует и публикует фото статьи: читает prompts.md, вызывает MCP генерации (Nano Banana 2) + Cloudinary напрямую → photos/urls.json (для /seo-statya, шаг 9b) |
| `article-verifier` | Финальная независимая вычитка собранной статьи: article.md + output.html + report.md против ТЗ, свип е-с-точками/тире, сверка меток фото → verify_report.json, ничего не чинит (для /seo-statya, шаг 10c) |
| `article-fixer` | Точечная правка статьи (по запросу из `/fix-article`) |
| `article-fixer-batch` | Массовое применение правок аудита одним проходом (для `/seo-statya`) |
| `strategy-scanner` | Скан сайта + первичные метрики клиента (для /seo-strategiya) |
| `competitor-analyst` | Конкуренты, типизация, выдача, вердикт (для /seo-strategiya) |
| `growth-strategist` | Точки роста + сборка strategy_data.json (для /seo-strategiya) |
| `tariff-architect` | Подбор трёх тарифов из TARIFFS.md по правилам RULES.md |
| `strategy-writer` | Проза для 6 разделов стратегии в strategy_content.json |
| `strategy-verifier` | Финальная независимая вычитка strategy_content.json: нет цен в прозе тарифов, цифры против data/scan/metrics/competitors/serp, согласованность тарифов → verify_report.json, ничего не чинит (для /seo-strategiya, шаги 6.5а/6.5б) |
| `intake-analyst` | Читает всю вводную фактуру (бриф, транскрибации, файлы, ЗАКАЗЧИК.md) → intake.json (факты с провенансом) + ВВОДНЫЕ.md (для /seo-analiz, шаг 1.5, до брифования) |
| `brief-structurer` | Парсинг свободного брифа в 16 параметров + путь Keyso (для /seo-analiz) |
| `competitor-finder` | Поиск + фильтрация + типизация + отбор 6-10 конкурентов + топ-3 лидера (для /seo-analiz) |
| `serp-verdict` | SERP-анализ по запросам + вердикт совместимости + стоп-лист + смежные (для /seo-analiz) |
| `leader-scanner` | Скан смыслов Э2-лайт: блоки/посылы/фишки 9-12 страниц топ-3 лидеров (для /seo-analiz) |
| `analysis-writer` | Сборка A2.md (5 разделов, вкл. «0. Вопросы к вам») + A3.md (стоп-лист) из всех JSON-данных (для /seo-analiz) |
| `answer-extractor` | Извлекает ответы клиента на questions.json из его правок в Google Doc + свободные комментарии → answers.json (для /seo-analiz, режим `--answers`) |
| `analysis-verifier` | Финальная независимая вычитка A2.md: цифры против brief/intake/competitors/serp/leader_scan, полнота разделов, согласованность раздела 0 → verify_report.json, ничего не чинит (для /seo-analiz, шаг 6b) |
| `master-list-builder` | Мастер-список страниц (типизация + нормализация + спаривание) на базе анализа (для /seo-struktura) |
| `marker-finder` | Маркерные запросы на каждую страницу через каскад Keyso + фолбэки (для /seo-struktura) |
| `semantic-expander` | JM semantic_pack: топ-30 запросов на маркер + проверка баланса (для /seo-struktura) |
| `cannibalization-resolver` | Разрешение конфликтов каннибализации + рекомендации по расширению (для /seo-struktura) |
| `structure-writer` | Финальный A6.md по фиксированному шаблону (для /seo-struktura) |
| `structure-verifier` | Финальная независимая вычитка A6.md: цифры против источников, состав/порядок разделов, непротиворечивость вердикту анализа → verify_report.json, ничего не чинит (для /seo-struktura, шаг 9д) |
| `site-scanner` | Скан живого сайта (sitemap + текущие H1/Title/Description + приоритет) → audit.json (для /seo-metategi, режим аудита) |
| `metatag-researcher` | Варианты маркера по осям + батч частотности/коммерциализации/подсказок на весь проект → research.json (для /seo-metategi) |
| `metatag-writer` | Финальные H1/Title/Description на страницу: deep (выдача + Акварель, параллельно) / bulk (по PLAYBOOK) → pages/N.json (для /seo-metategi) |
| `audit-recon` | Разведка техаудита: Вебмастер/Метрика/Keyso/возраст/CMS → recon.json (для /seo-tehaudit, шаг 1) |
| `audit-indexing` | Индексация и тех-здоровье: robots/sitemap/диагностика/редиректы/доноры → indexing.json (для /seo-tehaudit, шаг 2) |
| `audit-onpage` | URL/мета/Schema/JS для ОДНОГО батча страниц (шард, запускается параллельно) → onpage_<k>.json (для /seo-tehaudit, шаг 3) |
| `audit-analytics` | Аналитика/поведенческие/ссылки + финальный вердикт Яндекс Бизнеса → analytics.json (для /seo-tehaudit, шаг 4) |
| `audit-writer` | Сборка audit_data.json (карточка + проблемы + чеклист + динамические приложения) из 4 JSON (для /seo-tehaudit, шаг 5) |
| `audit-verifier` | Финальная независимая вычитка audit_data.json против 4 JSON-источников: нет выдуманных проблем, ничего значимого не потеряно, бьются цифры карточки → verify_report.json, ничего не чинит (для /seo-tehaudit, шаг 5b) |
| `audience-analyst` | Глубокий анализ ЦА (порт У5-Б): портреты/боли-сцены/страхи/возражения + компактная сводка → audience.json (для /seo-tekst, проектный) |
| `offer-strategist` | Стратегия оффера: позиционирование + прогретость + идея + формула + 30 тезисов + палитра + materials-gate → strategy.json (для /seo-tekst, проектный) |
| `block-planner` | Блок-план всех страниц одним проходом: BLOCKS.md + leader_blocks → blueprints/<slug>.json (блоки + цели + боли + слоты + char-лимиты); снимает каталоги с писателей (для /seo-tekst, проектный) |
| `page-writer` | Конверсионный текст одной страницы по готовому blueprint: голос + ЦА-под-страницу + копия по VOICE.md (диета контекста, ADR-020) → page.json (для /seo-tekst, веер) |
| `prototype-builder` | Сборка HTML-прототипа одной страницы поверх kit: page.json → manifest → build-prototype.mjs + verify + fix (для /seo-tekst, веер) |
| `prototype-fixer` | Точечная правка прототипа (разбор голосовых PHASE-7 + паттерн article-fixer) (для /seo-tekst-fix) |
| `faq-builder` | SEO-блок одной страницы: JM-анализ пробелов → FAQ (Schema.org) + возражения + плитка тегов + перелинковка с недостающими N-граммами (для /seo-faq, веер) |
| `leader-block-scanner` | Скан композиции блоков 3-6 лидеров по типам страниц (Chrome → rendered, fetch → fallback) → матрица покрытия + фишки. Доказательный подбор блоков, особенно каталоги (для /seo-tekst, проектный) |
| `copy-auditor` | Pre-flight редактор продающего текста: чек-лист COPY-AUDIT.md (смысл+грамотность первым, удар в боль ЦА, чистота/штампы/утечка кухни Сургай-кастдев) → чинит page.json свежим проходом перед HTML; анти-ИИ-детект не делает (ADR-022) (для /seo-tekst, веер) |
| `direction-scanner` | Контент-разведка одного направления: SERP топ-10 по маркеру -> фильтр однотипных -> фетч 3-5 страниц (Chrome/fetch) -> recon/<slug>.json: что публикует топ, must_have, gaps (для /seo-tekst, веер) |
| `site-reviewer` | Финальный кросс-страничный аудит текстов сайта: межстраничные самоповторы, уникальность H1/Title, консистентность decisions и фактов -> чинит + site_audit.json (для /seo-tekst, один на проект) |
| `context-gatherer` | Собирает релевантный контекст по файлам проекта под нестандартный вопрос заказчика + 2-4 трактовки вопроса → context.json (для /custom-question) |
| `solution-writer` | Пишет решение по вопросу заказчика в выбранном формате (answer/recommendation/doc), клиентские части без SEO-жаргона → solution.md (+ answer_client.md) (для /custom-question) |
| `solution-verifier` | Независимая вычитка решения: факт-чек по файлам проекта, простота языка, полнота ответа, честность блока «Что я не проверял» → verify_report.json (для /custom-question) |

### 55 Node-скриптов

| Скрипт | Делает |
|---|---|
| `_client.mjs` | Общий helper, импортируется другими скриптами |
| `finalize-setup.mjs` | git init + `.env.example` + первый коммит (для setup в `/handoff-process`) |
| `to-excel.mjs` | legacy: topics.json → корневой topics.xlsx (темы теперь собирает topics-to-excel.mjs) |
| `topics-to-excel.mjs` | батч тем → `Topics_<slug>.xlsx` в topics/NNN/ (актуальный для `/seo-temi`) |
| `from-excel-topics.mjs` | обратное чтение: `Topics_<slug>.xlsx` → topics-batch.json (правки клиента) |
| `read-topics-xlsx.mjs` | чтение корневого topics.xlsx для дедупа тем |
| `update-index.mjs` | поддержка `articles/_index.json` |
| `rebuild-index.mjs` | пересборка производного кеша `_index.json` из per-folder meta.json (ADR-013, кеш не коммитится) |
| `resolve-article-dir.mjs` | детерминированный резолв папки задачи по id темы (после ADR-013 номер NNN не уникален) |
| `batch-queue.mjs` | движок очереди серийного режима `/seo-statya` (диапазон/список тем в одной worktree-сессии): `init/next/set/status` над `.claude/tmp/batch-queue.json` |
| `assemble-html.mjs` | article.md + enhancements + faq + schema + photos + template → output.html |
| `metrics-report.mjs` | метрики читаемости (слова, H2/H3, Flesch-RU) → раздел в report.md |
| `verify-progress.mjs` | сверка sections/progress.json с фактическими секциями (exit 0/1/2) |
| `verify-markers.mjs` | проверка, что финализатор сохранил все метки в article.md |
| `verify-photo-budget.mjs` | число запланированных фото в tz.md попадает в жанровую вилку, независимо от числа таблиц |
| `verify-photos.mjs` | кросс-чек фото: метки [ФОТО] в article.md = блоки prompts.md = записи photos/urls.json |
| `verify-article-metatags.mjs` | механическая проверка H1/Title/Description ОДНОЙ статьи после article-finalizer; exit 2 → скил пере-делегирует финализатору (для `/seo-statya`) |
| `build-article-docx.mjs` | article + фото из Cloudinary → `Article_<slug>.docx` |
| `export-articles.mjs` | серийный финал `/seo-statya` (Block C): собирает папку-экспорт батча статей (по файлу на статью) + manifest.json |
| `build-articles-xlsx.mjs` | серийный финал `/seo-statya` (Block C): manifest.json → сводная xlsx метатегов батча статей с подсветкой превышений |
| `tilda-split.mjs` | output.html → tilda/head.html + tilda/t123.html (с !important фиксами) |
| `preview-server.mjs` | минимальный статический HTTP-сервер для скриншот-самопроверки шаблона (Chrome MCP не открывает file://) |
| `build-strategy-docx.mjs` | strategy_content.json + tariffs.json + inputs.json → SEO_Strategy_<domain>.docx |
| `build-smeta-xlsx.mjs` | tariffs.json + inputs.json → Smeta_<domain>.xlsx (3 вкладки + формулы SUM) |
| `verify-strategy.mjs` | механическая финальная проверка стратегии перед docx: цены в прозе тарифов, стоп-паттерны воды, тире/буква Ё, объём (для /seo-strategiya, шаг 6.5а) |
| `build-analysis-docx.mjs` | A2.md → A2_<domain>.docx (Arial, цветной вердикт, таблицы) |
| `_questions.mjs` | единый источник схемы/логики questions.json («0. Вопросы к вам»); импортируют build-analysis-docx.mjs и apply-answers.mjs (для /seo-analiz) |
| `apply-answers.mjs` | ядро режима `/seo-analiz --answers`: сливает answers.json в questions.json, решает какие шаги перезапускать → rerun_plan.json |
| `_slug.mjs` | единый источник транслита + построения slug/URL + валидации URL для /seo-struktura; импортируют build-structure-xlsx, select-top10, import-structure, verify-structure |
| `select-top10.mjs` | semantic_pack.json → top10.json + cannibalization.json (детекция конфликтов) |
| `build-structure-xlsx.mjs` | master_list + top10 + cannibalization + competitors → A6_<slug>.xlsx (4 листа) |
| `import-structure.mjs` | client_filled.xlsx → structure_data.json (exit-коды 0/3/4 для развилок) |
| `verify-structure.mjs` | механический финальный гейт A6.md перед смысловым structure-verifier: URL/структура/дубли, дёшево и детерминированно (для /seo-struktura, шаг 9г) |
| `validate-analysis-inputs.mjs` | жёсткая валидация входа /seo-struktura: наличие файлов анализа + канонические поля брифа (ловит дрейф схемы) |
| `read-metatags-input.mjs` | вход метатегов: структура / таблица / аудит → pages.json (exit 0/2/1) |
| `select-variations.mjs` | research.json → shortlist.json (отсев Comm, сорт по exact, форма+резерв на страницу) |
| `build-metatags-xlsx.mjs` | inputs + pages + pages/N.json → A7_<slug>.xlsx (3 листа, подсветка длины) |
| `verify-metatags.mjs` | проверка пачки: длины/тире/вхождение маркера/запрещёнки + missing (exit 0/2) |
| `render-audit-md.mjs` | audit_data.json → A12.md (markdown-отчёт техаудита) |
| `build-audit-docx.mjs` | audit_data.json → A12_<slug>.docx (порт docx_template.py, дизайн TIMUR SEO) |
| `verify-audit.mjs` | проверка audit_data.json: счётчики=длины, ссылки на приложения, плейсхолдеры (exit 0/2) |
| `select-audit-pages.mjs` | indexing.json → page_plan.json (типизация + url_structure + шардинг страниц для on-page аудита, `--pages N`) |
| `merge-onpage.mjs` | onpage_*.json (шарды) → onpage.json (Title-заглушка, дубли, schema_summary по всей выборке) |
| `read-tekst-input.mjs` | структура/таблица/анализ → pages.json (целевые страницы для /seo-tekst) |
| `build-prototype.mjs` | manifest.json + kit (shell+css+js+фрагменты+тема+legal) → prototype.html (рекурсивный mini-template) |
| `verify-prototype.mjs` | POST-FLIGHT прототипа: 1 форма в финале, header/footer/tel/cookie, без фреймворков/тире, стоп-формулы (exit 0/2) |
| `build-tekst-analysis-docx.mjs` | audience.json + strategy.json → Analysis_<slug>.docx (клиенту на согласование) |
| `build-tekst-docx.mjs` | pages/*/page.json → Texts_<slug>.docx (финальные тексты клиенту) |
| `read-faq-input.mjs` | tekst/таблица/url → pages.json (текст страницы + целевые запросы для JM) |
| `_faq-util.mjs` | общие утилиты /seo-faq: единая нормализация URL + декод сущностей + резолв self-url; импортируют build-faq.mjs, build-faq-docx.mjs, verify-faq.mjs |
| `build-faq.mjs` | faq_blocks.json → faq.html (аккордеон + Schema.org FAQPage + плитка тегов + перелинковка) + faq.md |
| `verify-faq.mjs` | проверка SEO-блока: Schema валидна, объёмы FAQ, стоп-формулы, тире, normalized_keywords (exit 0/2) |
| `build-faq-docx.mjs` | faq_blocks → FAQ_<slug>.docx (клиенту) |
| `verify-copy.mjs` | pre-flight копи-валидатор (v4): механические пункты чек-листа COPY-AUDIT.md по page.json до HTML (самозащита/жаргон/манипуляции/сленг/H1, exit 0/2) |
| `sync-from-template.mjs` | движок синка машинерии шаблона на клиентский проект: dry-run отчёт +/~/-, версия, миграции, само-коммит (для /sync-from-template и /sync-all) |

### 5 Claude Code хуков

| Хук | Когда срабатывает | Делает |
|---|---|---|
| `check-file.sh` | SubagentStop * | Проверяет создан ли ожидаемый выходной файл |
| `check-section.sh` | SubagentStop section-writer | Один H2, нет длинных тире, объём в допуске |
| `check-jm-balance.sh` | PreToolUse jm_text_analyze | Отказ если баланс JM < 5 |
| `mark-finalized.sh` | SubagentStop article-finalizer | Ставит meta.state=finalized (паузой для review управляет сам скил в режиме --review) |
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
| [009](docs/adr/009-seo-analysis-task-type.md) | Новый тип задачи `analyses/` для предпроектного анализа (повторное применение паттерна ADR-007) |
| [010](docs/adr/010-structures-task-type.md) | Новый тип задачи `structures/` для построения структуры сайта на базе анализа (третье повторение паттерна; гибрид «скрипт + агент» на шаге каннибализации) |
| [011](docs/adr/011-template-self-guard.md) | Самозащита каталога-шаблона от клиентских команд и артефактов (маркер `.is-template-root` + UserPromptSubmit-guard + pre-commit backstop) |
| [012](docs/adr/012-metatags-task-type.md) | Новый тип задачи `metatags/` для генерации метатегов (один движок, две глубины deep/bulk; verify скриптом не hook'ом из-за параллельного веера; авто-хвост из `/seo-struktura`) |
| [013](docs/adr/013-numbering-by-topic-derived-index.md) | Реестры `_index.json` не коммитятся - производные кеши, пересобираются из per-folder meta.json (ноль merge-конфликтов при параллели) |
| [014](docs/adr/014-audit-task-type.md) | Новый тип задачи `audits/` для техаудита (4-е повторение паттерна; `audit_data.json` как источник истины, двойной рендер md+docx + verify, порт `docx_template.py` на Node) |
| [015](docs/adr/015-tekst-task-type.md) | Новый тип задачи `texts/` для конверсионных текстов + HTML-прототип (/seo-tekst); манифест-JSON + детерминированный сборщик вместо LLM-печати HTML (осознанное отступление от гайда); клиентский гейт согласования + двухуровневый веер |
| [016](docs/adr/016-faq-task-type.md) | Новый тип задачи `faq/` для SEO-нормализации (/seo-faq); JM-анализ пробелов → FAQ (Schema.org FAQPage) + плитка тегов + перелинковка; читает kit из seo-tekst/assets |
| [017](docs/adr/017-leader-block-scan-and-catalog.md) | Доказательный подбор блоков через скан лидеров (Chrome → rendered, fetch → fallback, статическая матрица → пол) + поддержка каталожных сайтов (типы Категория/Карточка + 5 фрагментов) |
| [018](docs/adr/018-v4-copy-quality-layer.md) | Слой качества копирайта v4 (постмортемы): смысловое = выбор заказчика (offer-варианты + гейт), FACTS единый источник, стоп-листы + verify-copy + copy-auditor проход |
| [019](docs/adr/019-machinery-sync.md) | Синхронизация машинерии в существующие клоны: детерминированный движок sync-from-template.mjs + скилы /sync-from-template (один проект) и /sync-all (все разом), версионная метка `.claude/.machinery-version`, идемпотентные миграции данных |
| [020](docs/adr/020-writer-context-diet-and-voice.md) | Диета контекста писателя + анти-ИИ слой: block-planner выносит выбор блоков из page-writer (blueprint на страницу), COPY.md распилен по читателям (VOICE.md писателю, COPY-AUDIT.md контролёру), чек-лист 14 пунктов (п.14 - маркеры ИИ-текста) |
| [021](docs/adr/021-direction-recon-site-review-wireframe.md) | Контент-разведка направлений (direction-scanner) + кросс-страничный аудит (site-reviewer) + wireframe-прототипы (v5.1) |
| [022](docs/adr/022-commercial-copy-not-anti-ai.md) | Коммерческий текст под боль ЦА, не под анти-ИИ-детект: анти-ИИ-слой убран, приоритет смысл+грамотность+боль, заслон утечки кухни (Сургай/кастдев) |
| [023](docs/adr/023-yo-letter-ban.md) | Запрет буквы ё во всех клиентских текстах и метатегах (единый стандарт, рядом с запретом тире; enforcement в 3 слоя) |
| [024](docs/adr/024-subagent-model-policy.md) | Ярусы моделей субагентов (sonnet - механика, opus - проза/суждение/аудит) вместо `inherit` - политика в [docs/MODEL-POLICY.md](docs/MODEL-POLICY.md) |

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
  - JM (jm_account, jm_text_generate, jm_text_analyze, jm_semantic_pack, jm_suggest, jm_wordstat, jm_task)
  - Wordstat (mcp_wordstat_*)
  - Yandex (mcp_yandex_search, mcp_yandex_get_position)
  - Keys.so (domain_dashboard, domain_pages, domain_competitors, ...)
  - Arsenkin (arsenkin_parse, arsenkin_positions, ...)
  - WK (wk_check_frequency, ...)
  - Webmaster (wm_*)
  - Fetch (mcp_fetch_page)
  - Google Drive (gdrive-piotr: uploadFile с конверсией в Google Doc/Sheet) - ядро для всех `/share-*` и финальных заливок
  - Cloudinary + OpenRouter (скилы image-generation / image-publishing) - фото в `/seo-statya`
  - Sheets (опционально, прямое чтение/запись Google Sheets)
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
