---
name: guide
description: Полная инструкция по рабочему процессу SEO-конвейера для ассистента. Карта от /new-project до /handoff-process, по каждой команде - что подаёшь на вход, какие вопросы и опции, что получаешь на выход, и чем команды связаны между собой (какой артефакт читает следующий шаг). Плюс роли MCP-инструментов и частые ступоры. Аргумент: [тема] - показать только один раздел (например /guide strategy, /guide handoff, /guide mcp).
---

# guide - карта рабочего процесса

Этот скил - справочник для ассистента: как устроен SEO-конвейер от создания клиента до сдачи результатов, что делает каждая команда (вход -> вопросы -> опции -> выход), и как команды связаны через артефакты. Не выполняет действий - только объясняет.

## Как пользоваться

- `/guide` - показать всю карту (разделы 1-8 ниже, кратко и по делу).
- `/guide <тема>` - показать только нужный раздел. Распознавай тему по ключу:
  - имя команды без слеша: `setup-project`, `seo-analysis`, `seo-structure`, `strategy`, `new-topics`, `write-article`, `fix-article`, `rewrite-section`, `handoff`, `handoff-process`, `request-shared-edit`, `share-*`, `new-project` -> раздел 3 по этой команде.
  - `mcp` / `инструменты` / `tools` -> раздел 5.
  - `worktree` / `main` / `зоны` -> раздел 6.
  - `артефакты` / `связки` / `pipeline` -> раздел 4.
  - `ступор` / `ошибка` / `troubleshooting` -> раздел 7.
  - `правила` -> раздел 8.
- Если тема не распознана - покажи раздел 1 + список доступных тем.

Перед выводом одной строкой сообщи, где сейчас сессия (определи через `git rev-parse --git-dir` vs `--git-common-dir`: равны -> main или родитель; различаются -> worktree), чтобы ассистент сразу понимал, какие команды ему сейчас доступны.

---

## 1. Карта за 30 секунд

Один клиент = один склонированный из шаблона репозиторий в `~/seo-projects/<slug>/`. Внутри клиента **каждая задача идёт в отдельной worktree-сессии**, и единственная команда основной (main) сессии - `/handoff-process`.

```
РОДИТЕЛЬ ~/seo-projects/  (НЕ git-репо)
  /new-project [slug] [URL]   -> клонирует шаблон -> ~/seo-projects/<slug>/
        |
        v  открой <slug>/ в новой сессии
КЛИЕНТ ~/seo-projects/<slug>/
  ┌─ worktree-сессия (галочка worktree = ON) ─────────────────────┐
  │  ТРЕК А - пресейл (нужна стратегия продвижения):              │
  │    /strategy URL      -> Strategy.docx + Smeta.xlsx (КП)      │
  │                                                               │
  │  ТРЕК Б - согласованная работа:                              │
  │    /setup-project URL -> ЗАКАЗЧИК.md + template.html (профиль)│
  │    /seo-analysis      -> A2.md + A3.md (анализ конкурентов)   │
  │    /seo-structure NNN -> A6.xlsx -> клиент -> A6.md (структура)│
  │    /new-topics        -> Topics.xlsx (темы блога)            │
  │    /write-article N   -> Article.docx + output.html (статьи) │
  │    [планируется: технический аудит и др. услуги]             │
  │                                                               │
  │  Утилиты: /fix-article, /rewrite-section, /request-shared-edit│
  │  /handoff             -> commit + merge в main + cleanup      │  <- ВСЕГДА в конце
  └────────────────────────────────────────────────────────────────┘
  ┌─ main-сессия (галочка worktree = OFF) ──────────────────┐
  │  /handoff-process     -> применяет накопленные запросы   │
  └──────────────────────────────────────────────────────────┘
```

Главное правило: **рабочие скилы пишут только в свою папку задачи** (`articles/NNN/`, `strategies/NNN/`, `analyses/NNN/`, `structures/NNN/`, `topics/NNN/`) + `.claude/tmp/` + `.claude/handoff-requests/`. Общие файлы (`ЗАКАЗЧИК.md`, `template.html`, `topics.xlsx`, весь `.claude/` кроме tmp/handoff-requests) - read-only в worktree, их защищает pre-commit hook.

---

## 2. Два трека: пресейл и согласованная работа

`/new-project` всегда идёт первым - создаёт проект клиента из шаблона. Дальше - один из двух треков по стадии сделки:

**Трек А - пресейл (нужна стратегия продвижения).**
`/new-project` -> `/strategy <URL>`. `/strategy` сам сканирует сайт и спрашивает нишу/регион (работает даже без `ЗАКАЗЧИК.md`), на выходе - коммерческое предложение клиенту: `SEO_Strategy.docx` (без цен) + `Smeta.xlsx` (с тарифами). Поэтому финальная подсказка `/new-project` зовёт именно `/strategy` - это by design.

**Трек Б - согласованная работа (клиент принял предложение).** Основной конвейер по порядку:
1. `/setup-project <URL>` - профиль `ЗАКАЗЧИК.md` + `template.html`. Фундамент: его читают `/new-topics` и `/write-article`.
2. `/seo-analysis` - предпроектный анализ конкурентов (`A2.md` + `A3.md`).
3. `/seo-structure <NNN>` - структура сайта на базе анализа (`A6.xlsx` -> клиент -> `A6.md`).
4. `/new-topics` + `/write-article N` - темы и статьи для блога.
5. Планируется: технический аудит и другие услуги (добавляются как новые скилы - см. README "Как добавить новый скил").

Заметки:
- Шаги 2-3 (анализ + структура) можно пропустить, если занимаешься только контентом.
- `/strategy` не привязан жёстко к пресейлу - его можно запускать и внутри трека Б (например, переутвердить тарифы).
- `/setup-project` нужен до контента (статей/тем), потому что они читают `ЗАКАЗЧИК.md`; для `/seo-analysis` и `/seo-structure` он не обязателен (анализ работает от брифа).

---

## 3. Справочник команд (вход -> вопросы -> опции -> выход -> дальше)

Формат каждой карточки: **Зона** (откуда запускать) | **Вход** | **Вопросы/паузы** | **Опции** | **Выход** | **Дальше читает**.

### /new-project [slug] [URL]
- **Зона:** родитель `~/seo-projects/` (не клиент, не worktree).
- **Вход:** опционально slug и URL. 0 арг -> спросит оба; 1 арг -> это URL, предложит slug; 2 арг -> без вопросов.
- **Вопросы:** подтверждение сгенерированного slug; если slug кириллический/с точками - просьба переввести.
- **Опции:** нет.
- **Выход:** склонированный проект `~/seo-projects/<slug>/` (git clone шаблона, `npm install`, `git config core.hooksPath`). Печатает инструкцию открыть папку в новой worktree-сессии.
- **Дальше:** открыть `<slug>/` в новой сессии -> `/setup-project <URL>` (онбординг) или `/strategy <URL>` (пресейл).

### /setup-project <URL>
- **Зона:** worktree клиента.
- **Вход:** URL сайта клиента.
- **Вопросы:** один раунд `AskUserQuestion` после профиля (дистрибуция, URL подкатегорий, автор) + жёсткий профиль-OK; затем мягкий template-OK со скриншот-самопроверкой шаблона (принять сразу или поправить позже).
- **Опции:** нет (одношаговый, без --resume).
- **Выход:** `.claude/handoff-requests/files/ЗАКАЗЧИК.md` + `template.html` + `setup-meta.json` (НЕ в корень - их вынесет handoff-process).
- **Дальше:** `/handoff` -> в main `/handoff-process` (положит файлы в корень). Артефакты читают: `/strategy`, `/new-topics`, `/write-article`.
- **Агенты:** `client-profiler`, `template-designer`.

### /seo-analysis [--resume] [--no-share]
- **Зона:** worktree клиента.
- **Вход:** бриф клиента - текст в чат или путь к файлу (минимум ниша + регион). Без аргумента сам спросит бриф.
- **Вопросы/паузы:** при критичных дырах в брифе; если конкурентов < 6; **пауза по вердикту SERP**, если он не "ИДЁМ" (КОРРЕКТИРУЕМ/МЕНЯЕМ/С ОГОВОРКАМИ) - предлагает обсудить с клиентом; затем **цикл client-review**: ждёт "одобряю" либо правки, классифицирует правку (edit/brief/competitors/serp/leaders/writer) и пересобирает - повторяется до approved.
- **Опции:** `--resume` (продолжить по meta.json), `--no-share` (только A2.md+A3.md, без .docx и Drive).
- **Выход:** `analyses/NNN-slug/`: `A2.md` (отчёт, 5 разделов), `A3.md` (стоп-лист доменов), `recommendations.json`, `stop_list_detailed.json`, `A2_<slug>.docx`, ссылка Google Doc в Drive.
- **Дальше читает:** `/seo-structure` берёт `brief.json` + `competitors.json` + `serp.json` + `leader_scan.json`. Промежуточные `recommendations.json` пригодятся `/strategy` и `/write-article`.
- **Агенты:** `brief-structurer`, `competitor-finder`, `serp-verdict`, `leader-scanner`, `analysis-writer`.

### /seo-structure <NNN> [--resume] [--review | --auto] [--import <xlsx>]
- **Зона:** worktree клиента. **Требует** существующий `analyses/NNN-*/` (иначе стоп с подсказкой `/seo-analysis`).
- **Вход:** NNN - номер папки анализа.
- **Вопросы/паузы:** в `--review` паузы после мастер-списка и после JM-расширения (беречь лимиты). **Главная пауза - awaiting-client:** A6.xlsx уходит клиенту, тот заполняет колонку "Целевая?" (да/нет/обсудить) и возвращает файл. По строкам "обсудить" или пустой колонке скил переспросит.
- **Опции:** `--resume`; `--review` (паузы) / `--auto` (по умолчанию, без пауз); `--import <xlsx>` - короткий путь: вернулся заполненный клиентом файл, собрать A6.md.
- **Выход:** `structures/NNN-slug/`: `A6_<slug>.xlsx` (4 листа: Структура/Рекомендации/Конкуренты/Миграция, для клиента), `A6.md` (финал для следующих услуг), `structure_data.json`, `cannibalization.json`, ссылка Google Sheet.
- **Дальше читает:** `A6.md` - вход для ТЗ верстальщика (У5) и далее.
- **Агенты:** `master-list-builder`, `marker-finder`, `semantic-expander`, `cannibalization-resolver`, `structure-writer`.

### /strategy <URL | none> [--resume]
- **Зона:** worktree клиента. Читает `ЗАКАЗЧИК.md` если есть, иначе спрашивает напрямую (годится для пресейла).
- **Вход:** URL клиента (`site.ru` или `https://site.ru/`); `none` если сайта нет.
- **Вопросы:** регион продвижения, ниша/описание бизнеса, есть ли доступ к Вебмастеру/Метрике, бюджет (опц.), заметки. Если `none` - дополнительно главный запрос/маркер ниши и известные конкуренты.
- **Опции:** `--resume`.
- **Выход:** `strategies/NNN-slug/`: `SEO_Strategy_<domain>.docx` (стратегия **без цен**, для клиента) + `Smeta_<domain>.xlsx` (смета **с ценами**, внутренняя, 3 тарифа Старт/Рост/Максимум), оба залиты в Drive (Google Doc + Google Sheet). Плюс `strategy_data.json`, `tariffs.json`, `share.json`.
- **Методология (read-only):** тарифы из `~/.claude/seo-knowledge/TARIFFS.md`, правила связок из `RULES.md`.
- **Агенты:** `strategy-scanner`, `competitor-analyst`, `growth-strategist`, `tariff-architect`, `strategy-writer`.

### /new-topics [--resume] [--queries "..."]
- **Зона:** worktree клиента. **Требует** `ЗАКАЗЧИК.md` в корне.
- **Вход:** ничего обязательного; опционально затравочные запросы.
- **Вопросы/паузы:** показывает таблицу из 15-25 тем и ждёт "ок" либо правки ("убери темы 7,12", "добавь про X", "перепиши тему 5 под жанр Личный опыт") - цикл до подтверждения.
- **Опции:** `--resume` (продолжить батч или подхватить ручные правки в xlsx), `--queries "запрос1, запрос2"`.
- **Выход:** `topics/NNN-slug/Topics_<slug>.xlsx` + `topics-batch.json`, ссылка Google Sheet для согласования.
- **Дальше:** `/handoff` -> в main `/handoff-process` сольёт темы в общий `topics.xlsx` (дедуп по main_query). `/write-article N` берёт строку N из общего `topics.xlsx`.
- **Агент:** `topic-generator`. Дедуп против `topics.xlsx` + `articles/_index.json`.

### /write-article <N> [--resume] [--review | --auto] [--with-handoff] [--genre="..."] [--platform=site|external|social]
- **Зона:** worktree клиента. Читает строку N из `topics.xlsx` + `ЗАКАЗЧИК.md` + `template.html`.
- **Вход:** N - номер темы в topics.xlsx.
- **Вопросы/паузы:** в `--auto` (по умолчанию) пауз нет вообще. В `--review` - стоп после финализации (ждёт `/continue` или `/edit "..."`), плюс подтверждения на ключевых шагах. Единственный вопрос даже в `--auto` - коллизия: по теме уже есть статья и переданный `--genre` противоречит доступным.
- **Опции:** `--resume` (по meta.json), `--review` / `--auto`, `--with-handoff` (после готовности сам зовёт `/handoff` - осторожно, удаляет ветку), `--genre="..."` (из колонки Жанры темы), `--platform=site|external|social`.
- **Выход:** `articles/NNN-slug/`: `Article_<slug>.docx` (с картинками), `output.html`, опц. `tilda/` (если платформа Тильда), `report.md`, `audit.md`, фото в Cloudinary (`photos/urls.json`), ссылка Google Doc. По одной теме можно делать несколько статей в разных жанрах/площадках (разрешает коллизию по `topic_id` через `articles/_index.json`).
- **Агенты:** `jm-analyst` -> `tz-builder` -> `section-writer` (по разделам) -> `article-finalizer` -> `text-auditor` -> `article-fixer-batch` -> `enhancer` -> `photo-promter`, далее скилы `image-generation` + `image-publishing` для фото.

### /fix-article <NNN> "<правка>"
- **Зона:** worktree клиента.
- **Вход:** NNN готовой статьи + текст правки.
- **Выход:** обновлённые файлы в `articles/NNN/`. Точечная правка через агент `article-fixer`.

### /rewrite-section <NNN> <section_index> "<описание>"
- **Зона:** worktree клиента.
- **Вход:** NNN, индекс H2-раздела, новая постановка.
- **Что делает:** удаляет `sections/NN-*.md`, откатывает progress.json, перезапускает `section-writer` и пересборку.

### /request-shared-edit "<описание>"
- **Зона:** worktree клиента.
- **Вход:** описание нужной правки общего файла (`ЗАКАЗЧИК.md`, `template.html`, `topics.xlsx`).
- **Выход:** файл-запрос в `.claude/handoff-requests/`. Применяется в main через `/handoff-process`. Нужен, потому что общие файлы в worktree read-only.

### /share-analysis | /share-structure | /share-strategy | /share-topics | /share-article  <NNN> [--redo]
- **Зона:** worktree клиента.
- **Назначение:** утилиты повторной/отложенной загрузки финального файла на Google Drive (с конверсией в Google Doc/Sheet). По умолчанию основной скил делает это сам; share-* нужен если Drive был недоступен при первом прогоне или после ручных правок локального файла. `--redo` - перезалить.

### /handoff [--message "..."] [--resume]
- **Зона:** worktree клиента. **Всегда в конце задачи.**
- **Что делает:** финальный коммит -> merge ветки worktree в main (--no-ff) -> удаление ветки и worktree.
- **Вопросы/паузы:** предупреждает, если задача - незавершённый `/seo-analysis` (state не approved/completed). При merge-конфликте останавливается и просит разрешить вручную в main, затем `/handoff --resume` для cleanup.
- **Опции:** `--message` (своё сообщение коммита), `--resume` (после ручного разрешения конфликта).
- **Выход:** все файлы задачи (и содержимое `handoff-requests/`) теперь в main.
- **Дальше:** если задача создавала запросы в `handoff-requests/` (setup-project, new-topics, request-shared-edit) -> открыть main-сессию -> `/handoff-process`. Чистая per-task работа (статья без правок общих файлов) - уже в main, ничего больше не нужно.

### /handoff-process [--dry-run] [--only=<тип>]
- **Зона:** main-сессия (без worktree). **Единственная команда main.**
- **Что делает:** собирает накопленные запросы (`setup-project`, `new-topics` из `topics/NNN/`, `shared-edit` .md) -> показывает план -> применяет к общим файлам в корне -> переносит обработанное в `processed/` -> коммит. Дедуп тем по `main_query`, идемпотентность батчей через флаг `applied_to_root_xlsx`.
- **Вопросы:** "применять все? [Y/n/by-one]"; при перезаписи существующего target; при конфликтующих запросах к одному файлу.
- **Опции:** `--dry-run` (показать, не применять), `--only=<тип>`.
- **Выход:** обновлённые `ЗАКАЗЧИК.md` / `template.html` / `topics.xlsx` в корне проекта.

---

## 4. Связки артефактов (кто чьё читает)

Конвейер держится на файлах, не на чате. Каждый шаг оставляет JSON/MD, следующий их читает:

```
/setup-project --> ЗАКАЗЧИК.md, template.html
        |              |
        |              +--> /new-topics (ниша/регион/домен), /write-article (профиль+шаблон), /strategy (если есть)
        v
/seo-analysis --> brief.json, competitors.json, serp.json, leader_scan.json, A2.md, A3.md, recommendations.json
        |
        +--> /seo-structure ОБЯЗАТЕЛЬНО читает brief+competitors+serp+leader_scan
        +--> recommendations.json -> подсказки для /strategy и /write-article
        v
/seo-structure --> A6.xlsx (клиенту) --> client_filled.xlsx --> structure_data.json --> A6.md
        |
        +--> A6.md -> ТЗ верстальщика (У5) и дальше
/new-topics --> Topics.xlsx --(/handoff-process, дедуп)--> корневой topics.xlsx
        |
        +--> /write-article N читает строку N
/write-article --> articles/NNN/: jm/*.json -> tz.md -> sections/*.md -> article.md -> output.html -> Article.docx
```

Ключевые "точки стыковки":
- `ЗАКАЗЧИК.md` - центральный профиль, читается почти всеми. Создаётся только через `/setup-project` + `/handoff-process`.
- `analyses/NNN/` - обязательный вход для `/seo-structure` (без него структуру не построить).
- корневой `topics.xlsx` - единый темник; пополняется только через `/handoff-process`, в worktree он read-only.
- `meta.json` в каждой папке задачи - state machine, единственный источник истины о прогрессе (двигается через `update-meta.sh`). На него опираются `--resume` и `/handoff`.

---

## 5. MCP-инструменты: что за что отвечает

Все MCP-серверы подключены **глобально** в Claude Code Desktop (не в проекте). Агенты вызывают их по именам инструментов. Практический разрез "вход -> выход":

**Ядро конвейера (используется скилами напрямую):**

| Сервер | Инструменты (примеры) | Вход -> Выход | Где задействован |
|---|---|---|---|
| JM (Just-Magic) | `jm_account`, `jm_text_generate`, `jm_text_analyze`, `jm_semantic_pack`, `jm_wordstat`, `jm_clustering`, `jm_suggest` | запрос/текст -> ТЗ, N-граммы, LSI, кластеры, топ-30 запросов на маркер, баланс | write-article (анализ текста), seo-structure (semantic_pack). **Перед `jm_text_analyze` баланс должен быть >= 5** |
| Wordstat | `mcp_wordstat_get_keyword_stats`, `..._get_regions_tree`, `..._get_dynamics` | запрос + регион -> частотность, сезонность, дерево регионов | проверка частотности тем/маркеров |
| Yandex | `mcp_yandex_search`, `mcp_yandex_get_position` | запрос + регион -> живая выдача / позиция домена | SERP-анализ, проверка позиций |
| Keys.so | `domain_pages`, `domain_competitors`, `domain_keywords`, `keyword_info`, `keyword_similar`, `domain_dashboard`, `visibility_rating` | домен/ключ + база региона -> страницы, конкуренты, ключи с метриками | главный источник конкурентов для seo-analysis и маркеров для seo-structure |
| Arsenkin | `arsenkin_parse`, `arsenkin_top`, `arsenkin_positions`, `arsenkin_clustering`, `arsenkin_commerce` | запросы/URL -> парс топа, кластеры, коммерциализация | вспомогательный анализ выдачи |
| WK | `wk_check_frequency`, `wk_balance` | список запросов -> массовая частотность | резерв, когда Keyso/JM не дают частоты |
| Webmaster | `wm_summary`, `wm_indexing`, `wm_query_analytics`, `wm_site_audit`, `wm_important_urls`, `wm_sitemaps` | хост -> индексация, запросы, диагностика, sitemap | данные своих верифицированных сайтов (scan в strategy) |
| Fetch | `mcp_fetch_page` | URL -> текст/HTML страницы | leader-scanner, типизация страниц |
| Google Drive | `mcp__gdrive-piotr__uploadFile` (`convertToGoogleFormat: true`), `deleteItem` | локальный .docx/.xlsx -> Google Doc/Sheet + ссылка | финальная заливка в strategy/analysis/structure/topics/article и все `/share-*` |
| Cloudinary + OpenRouter | скилы `image-generation`, `image-publishing` | промт -> PNG -> delivery URL CDN | фото в `/write-article` (шаг 9b) |

**Прочие подключённые MCP (доступны глобально, в основном конвейере напрямую не зашиты - используются точечно или вручную):** Yandex Metrika (`ym_*` - трафик/цели/аудит), Google Sheets API (`sheets_*` - прямое чтение/запись таблиц), Telegram (`tg_*` - чаты/сообщения), SEM/Topvisor/Monstro (`sem_*` - мониторинг позиций, отчёты, телеграм-сводки), AI-tracker (`ai_tracker_*` - упоминания в AI-выдаче), SpeedyIndex (`speedyindex_*` - ускорение индексации), Cloudinary asset-mgmt (управление загруженными ассетами). У большинства есть `healthcheck` для проверки доступности.

Если инструмент нужного MCP не появился в сессии - сервер не подключён или отвалился; проверь `healthcheck` соответствующего сервера и не блокируй основную задачу (для Drive предусмотрены fallback и `/share-*`).

---

## 6. Зоны: worktree vs main, и почему так

| | worktree-сессия | main-сессия | родитель ~/seo-projects/ |
|---|---|---|---|
| Галочка worktree | ON | OFF | n/a |
| Команды | все рабочие скилы + `/handoff` | только `/handoff-process` | только `/new-project` |
| Можно писать | своя папка задачи + `.claude/tmp/` + `.claude/handoff-requests/` | всё (pre-commit не ограничивает) | не git-репо, без задач |
| Общие файлы | read-only (защита pre-commit) | редактируемы (через handoff-process) | - |

Почему worktree-first: можно параллельно вести несколько задач (несколько статей, статья + стратегия и т.п.) в одном клиенте без конфликтов. Каждая задача = своя ветка + своя папка + свой `meta.json`. Подробности - ADR-001/002/003 в `docs/adr/` любого клиента.

Цикл handoff:
1. В worktree довёл задачу до конца -> `/handoff` (commit + merge + cleanup).
2. Если задача меняла общие файлы (setup-project, new-topics, request-shared-edit) -> открой main -> `/handoff-process`.
3. Чистая per-task работа (статья без правок общих файлов) - после `/handoff` уже в main, шаг 2 не нужен.

---

## 7. Частые ступоры

- **`pre-commit: В worktree запрещено менять файлы вне текущей задачи`** - пытаешься закоммитить общий файл из worktree. Нужна правка -> `/request-shared-edit "..."`. Не нужна -> `git checkout -- <файл>`. Часто причина - не записан `.claude/tmp/current-task.txt` (скил пишет туда путь своей папки первым делом).
- **`node is not recognized`** - `scoop install nodejs-lts` (обёртка `.claude\scripts\_node.cmd` подхватит node без перезапуска), либо поставить с nodejs.org и перезапустить десктоп.
- **Скил говорит "работает только в worktree" / "только в main"** - открой сессию в правильном режиме (галочка worktree при создании). Это системное правило, не обходить.
- **Merge-конфликт при `/handoff`** - разреши вручную в main-папке (git status/diff/add/commit), вернись в worktree -> `/handoff --resume`.
- **`Worktree remove failed: Permission denied` (Windows)** - file-lock индексатора. Не критично: метаданные убраны, зомби-папку подчистит `git worktree prune` при следующем `/handoff-process`.
- **Drive недоступен / OAuth протух** - финальный скил не блокируется, оставляет локальные .docx/.xlsx; догрузишь через `/share-<тип> <NNN>` после восстановления.
- **`529 Overloaded` / `503` / `rate_limit` от API** в длинных скилах (write-article, seo-structure) - это норма: скил сам делает `ScheduleWakeup` на ~90с и продолжает с `--resume`, до 3 попыток. Не перезапускай вручную.
- **JM-баланс < 5** - `jm_text_analyze` откажет (PreToolUse hook). Пополни баланс (`jm_account` для проверки).

---

## 8. Жёсткие правила (общие для всех скилов)

- Пиши только в свою папку задачи + `.claude/tmp/` + `.claude/handoff-requests/`. Перед началом per-task задачи скил пишет путь в `.claude/tmp/current-task.txt`.
- Не трогай `.claude/agents/`, `hooks/`, `scripts/`, `git-hooks/` и `~/.claude/seo-knowledge/` (методология, тарифы, шаблоны - read-only).
- `~/seo-projects/` - git-репо, но версионирует только свой `.claude/`; клиентов и `template-project` не `git add` (они вложенные репо, в `.gitignore` под `/*`).
- Все промежуточные результаты - в файлы, не в чат.
- Перед закрытием worktree-сессии - `/handoff`, иначе работа останется в ветке и не попадёт в main.
- Не делай `git push` и не публикуй артефакты сам - это решение пользователя.
- Длинные тире (—) и средние (–) запрещены везде - только дефис (-).
- Не запускай несколько разнотипных рабочих скилов из одной сессии - каждая задача в своём worktree.
