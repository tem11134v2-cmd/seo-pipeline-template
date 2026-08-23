---
name: guide
description: Полная инструкция по рабочему процессу SEO-конвейера для ассистента. Карта от /new-project до /handoff-process, по каждой команде - что подаёшь на вход, какие вопросы и опции, что получаешь на выход, и чем команды связаны между собой (какой артефакт читает следующий шаг). Плюс роли MCP-инструментов и частые ступоры. Аргумент: [тема] - показать только один раздел (например /guide strategy, /guide handoff, /guide mcp).
---

# guide - карта рабочего процесса

Этот скил - справочник для ассистента: как устроен SEO-конвейер от создания клиента до сдачи результатов, что делает каждая команда (вход -> вопросы -> опции -> выход), и как команды связаны через артефакты. Не выполняет действий - только объясняет.

## Как пользоваться

- `/guide` - показать всю карту (разделы 1-9 ниже, кратко и по делу).
- `/guide <тема>` - показать только нужный раздел. Распознавай тему по ключу:
  - имя команды без слеша: `seo-shablon`, `seo-analiz`, `seo-struktura`, `seo-metategi`, `seo-tehaudit`, `seo-strategiya`, `custom-question`, `seo-temi`, `seo-statya`, `seo-tekst`, `seo-tekst-fix`, `seo-faq`, `fix-article`, `rewrite-section`, `handoff`, `handoff-process`, `request-shared-edit`, `share-*`, `new-project`, `status`, `sync-from-template`, `sync-all` -> раздел 3 по этой команде.
  - `mcp` / `инструменты` / `tools` -> раздел 5.
  - `worktree` / `main` / `зоны` -> раздел 6.
  - `обновление` / `машинерия` / `sync` / `версия` -> раздел 9.
  - `артефакты` / `связки` / `pipeline` -> раздел 4.
  - `ступор` / `ошибка` / `troubleshooting` -> раздел 7.
  - `правила` -> раздел 8.
- Если тема не распознана - покажи раздел 1 + список доступных тем.

Перед выводом одной строкой сообщи, где сейчас сессия (определи через `git rev-parse --git-dir` vs `--git-common-dir`: равны -> main или родитель; различаются -> worktree), чтобы ассистент сразу понимал, какие команды ему сейчас доступны.

---

## 1. Карта за 30 секунд

Один клиент = один склонированный из шаблона репозиторий в `~/seo-projects/<slug>/`. Внутри клиента **каждая задача идёт в отдельной worktree-сессии**, и единственная команда основной (main) сессии - `/handoff-process`.

```
РОДИТЕЛЬ ~/seo-projects/  (git-репо: версионирует только свой .claude/)
  /new-project [slug] [URL]   -> клонирует шаблон -> ~/seo-projects/<slug>/
  /status                     -> обзор всех проектов (отдано / в работе / zombie / версия машинерии)
  /sync-all                   -> раскатать свежую машинерию шаблона на все проекты (раздел 9)
        |
        v  открой <slug>/ в новой сессии
КЛИЕНТ ~/seo-projects/<slug>/   (НЕЗАВИСИМЫЕ направления, в любом порядке/параллельно)
  ┌─ worktree-сессия (галочка worktree = ON) ─────────────────────────┐
  │  ОДИНОЧКА - стратегия (пресейл/КП, самодостаточна):               │
  │    /seo-strategiya URL  -> SEO_Strategy.docx + Smeta.xlsx (КП)     │
  │                                                                   │
  │  ОДИНОЧКА - техаудит сайта под Яндекс (доступы ВМ+Метрика):       │
  │    /seo-tehaudit <domain> -> A12.md + A12.docx (чеклист devу)     │
  │                                                                   │
  │  ТРЕК «Коммерческое SEO» (страницы сайта, от брифа; /seo-analiz - │
  │  для ВСЕХ клиентов, tier seo/basic):                              │
  │    /seo-analiz        -> A2.md (+ A3.md при seo) - ступени 0-4    │
  │    /seo-struktura NNN -> A6.xlsx -> клиент -> A6.md (нужен tier=seo)│
  │    /seo-metategi      -> A7.xlsx (метатеги H1/Title/Description)  │
  │    /seo-tekst         -> prototype.html (весь сайт одним файлом;  │
  │                          гейт скелетов + тон-гейт; только пишет - │
  │                          анализ приходит из analyses/NNN)         │
  │    /seo-faq           -> faq.html + FAQ.docx (SEO-нормализация)   │
  │                                                                   │
  │  ТРЕК «Информационное SEO» (блог) - независим от коммерческого:   │
  │    /seo-shablon URL -> ЗАКАЗЧИК.md + template.html (профиль)      │
  │    /seo-temi        -> Topics.xlsx (темы блога)                   │
  │    /seo-statya N|N-M -> Article_NNN.docx + output-NNN.html (серия) │
  │                                                                   │
  │  Утилиты: /fix-article, /rewrite-section, /request-shared-edit    │
  │  /handoff  -> commit + merge в main + cleanup   <- ВСЕГДА в конце  │
  └───────────────────────────────────────────────────────────────────┘
  ┌─ main-сессия (галочка worktree = OFF) ──────────────────────────┐
  │  /handoff-process     -> применяет накопленные запросы           │
  │  /sync-from-template  -> обновить машинерию этого проекта (разд.9)│
  └──────────────────────────────────────────────────────────────────┘
```

Главное правило: **рабочие скилы пишут только в свою папку задачи** (`articles/NNN/`, `strategies/NNN/`, `analyses/NNN/`, `structures/NNN/`, `metatags/NNN/`, `audits/NNN/`, `texts/NNN/`, `faq/NNN/`, `topics/NNN/`) + `.claude/tmp/` + `.claude/handoff-requests/`. Общие файлы (`ЗАКАЗЧИК.md`, `template.html`, `topics.xlsx`, весь `.claude/` кроме tmp/handoff-requests) - read-only в worktree, их защищает pre-commit hook.

---

## 2. Четыре независимых направления (НЕ путать в одну цепочку)

`/new-project` всегда идёт первым - создаёт проект клиента из шаблона. Дальше - одно или несколько **НЕЗАВИСИМЫХ** направлений, в любом порядке и параллельно. Это разные услуги под разные цели; не выстраивай их в единый последовательный конвейер.

**Одиночка - стратегия (пресейл/КП).**
`/seo-strategiya <URL>`. Самодостаточна: сама сканирует сайт и спрашивает нишу/регион (работает даже без `ЗАКАЗЧИК.md`), на выходе - коммерческое предложение клиенту: `SEO_Strategy.docx` (без цен) + `Smeta.xlsx` (с тарифами). Ничего до неё не нужно, ничего после не требует. Финальная подсказка `/new-project` зовёт именно её - это by design (пресейл).

**Одиночка - технический аудит (тех-здоровье сайта под Яндекс).**
`/seo-tehaudit <domain>`. Самодостаточен: нужны только домен и доступы клиента к Яндекс Вебмастеру и Метрике (`ЗАКАЗЧИК.md` не требуется; база Keyso опционально из `/seo-analiz`). На выходе - `A12.md` + `A12.docx`: проблемы по приоритетам (🔴🟡🟢), чеклист для разработчика, динамические приложения. Ни от чего не зависит, результат - дев-команде клиента.

**Трек «Коммерческое SEO» - коммерческие страницы сайта.**
`/seo-analiz` -> `/seo-struktura` -> `/seo-metategi` (метатеги) -> `/seo-tekst` (конверсионные тексты + прототип) -> `/seo-faq` (SEO-нормализация готовых страниц). Работает от брифа клиента, **НЕ требует** `/seo-shablon`. Связи ВНУТРИ трека: `/seo-struktura` читает выход `/seo-analiz` (brief/competitors/serp/leader_scan) и требует tier=seo; `/seo-tekst` умеет вход от структуры (`--from-structure`), от анализа (`--from-analysis`) или от таблицы (`--from-table`), при этом анализ ЦА/конкурентов/направлений сам НЕ делает - читает готовые артефакты `analyses/NNN/` (ADR-038); `/seo-faq` берет готовые тексты (`--from-tekst`) или живые URL.

**Путь для клиента БЕЗ SEO** (сайты партнера-разработчика, лендинги): `/seo-analiz --no-seo` (tier=basic - ступени 0-3 без Keyso/SERP и без частотностей) -> `/seo-tekst --from-analysis <NNN>`. Прежний автономный вход `--from-brief` удален (ADR-038): интейк, ЦА и разведка направлений теперь живут только в `/seo-analiz`. `ЗАКАЗЧИК.md` не нужен; докупили SEO позже - `/seo-analiz <NNN> --add-seo`.

**Трек «Информационное SEO» - блог/статьи. ПОЛНОСТЬЮ независим от коммерческого.**
`/seo-shablon` -> `/seo-temi` -> `/seo-statya`. `/seo-shablon` даёт `ЗАКАЗЧИК.md` (профиль) + `template.html` (шаблон статьи); их читают `/seo-temi` и `/seo-statya`. Трек самодостаточен и с коммерческим **не пересекается**.

Заметки:
- Направления не зависят друг от друга - бери любое, какое заказал клиент, в любом порядке (или несколько параллельно).
- Порядок важен только ВНУТРИ трека: коммерческий - анализ перед структурой; информационный - шаблон перед темами/статьями.
- `/seo-strategiya` можно запускать когда угодно (например, переутвердить тарифы) - он ни от чего не зависит.

---

## 3. Справочник команд (вход -> вопросы -> опции -> выход -> дальше)

Формат каждой карточки: **Зона** (откуда запускать) | **Вход** | **Вопросы/паузы** | **Опции** | **Выход** | **Дальше читает**.

### /new-project [slug] [URL]
- **Зона:** родитель `~/seo-projects/` (не клиент, не worktree).
- **Вход:** опционально slug и URL. 0 арг -> спросит оба; 1 арг -> это URL, предложит slug; 2 арг -> без вопросов.
- **Вопросы:** подтверждение сгенерированного slug; если slug кириллический/с точками - просьба переввести.
- **Опции:** нет.
- **Выход:** склонированный проект `~/seo-projects/<slug>/` (git clone шаблона, `npm install`, `git config core.hooksPath`, запись `.claude/.machinery-version` - базовая версия машинерии). Печатает инструкцию открыть папку в новой worktree-сессии.
- **Дальше:** открыть `<slug>/` в новой сессии -> `/seo-shablon <URL>` (онбординг) или `/seo-strategiya <URL>` (пресейл).

### /status [--json]
- **Зона:** родитель `~/seo-projects/` (как `/new-project`, не клиент, не worktree).
- **Вход:** ничего; `--json` - сырые данные для обработки.
- **Что делает:** обзор всех клиентских проектов по свежести. 4 слоя - отдано в main (услуги со state), в работе в живых worktree (вкл. «готово, но не хендофнуто»), zombie-папки, и версия машинерии (отстал ли проект от шаблона; в шапке счётчик «машинерия отстала: N»). Статус ПРОИЗВОДНЫЙ из `meta.json` каждой задачи + `.claude/.machinery-version`, отдельного трекаемого файла нет.
- **Опции:** `--json`.
- **Дальше:** подсвечивает застрявшее - открыть нужный worktree и `/handoff`; отставшую машинерию - `/sync-all` (раздел 9). Живой worktree с несмерженными коммитами НЕ удалять (только подсветка, без авто-действий).

### /sync-all [--apply] [--only a,b] [--no-delete]
- **Зона:** родитель `~/seo-projects/` (не клиент, не worktree).
- **Вход:** ничего; флаги ниже.
- **Что делает:** раскатывает свежую машинерию шаблона на ВСЕ проекты разом (зовёт движок `/sync-from-template` по каждому). Без `--apply` - dry-run: матрица «кто отстал и на сколько».
- **Опции:** `--apply` (применить; грязные деревья и worktree пропускает), `--only a,b` (только эти проекты), `--no-delete` (не удалять у клиентов файлы, которых нет в шаблоне).
- **Дальше:** подробности и предусловия - раздел 9.

### /seo-shablon <URL>
- **Зона:** worktree клиента.
- **Вход:** URL сайта клиента.
- **Вопросы:** один раунд `AskUserQuestion` после профиля (дистрибуция, URL подкатегорий, автор) + жёсткий профиль-OK; затем мягкий template-OK со скриншот-самопроверкой шаблона (принять сразу или поправить позже).
- **Опции:** нет (одношаговый, без --resume).
- **Выход:** `.claude/handoff-requests/files/ЗАКАЗЧИК.md` + `template.html` + `setup-meta.json` (НЕ в корень - их вынесет handoff-process).
- **Дальше:** `/handoff` -> в main `/handoff-process` (положит файлы в корень). Артефакты читают `/seo-temi` и `/seo-statya` (информационный трек).
- **Агенты:** `client-profiler`, `template-designer`.

### /seo-analiz [--seo|--no-seo] [--resume] [--answers] [--no-share] [--no-scan] [--no-recon] | <NNN> --add-seo
- **Зона:** worktree клиента.
- **Вход:** вводная фактура - текст в чат или пути к файлам (бриф, транскрибация; минимум ниша + регион). Без аргумента сам спросит. **Для ВСЕХ клиентов**: tier=seo (полный) или tier=basic (SEO не куплено - без Keyso и SERP, без частотностей); без флага скил спросит «SEO куплено?».
- **Ступени (ADR-038):** 0 интейк -> 1 бриф + directions[] (направления ассортимента, с url живой страницы) -> 2 анализ ЦА (`audience.json`) -> 3 конкуренты + скан лидеров (leader-scanner v2: посылы + блок-матрица) + разведка направлений (`recon/<dir_slug>.json`, вкл. own_page) -> 4 SERP-вердикт + стоп-лист (ТОЛЬКО tier=seo). Tier определяет инструменты ступеней, а не их состав.
- **Вопросы/паузы:** при критичных дырах в брифе; если конкурентов < 6; **пауза по вердикту SERP** (только tier=seo), если он не "ИДЕМ" - предлагает обсудить с клиентом; затем **цикл client-review**: ждет "одобряю" либо правки, классифицирует правку (rerun_hint: intake/brief/audience/competitors/leaders/directions/serp/writer/edit) и пересобирает - до approved. Подтвержденные клиентом own_page-факты дописываются в `intake.json` (source: own_page) - оттуда их заберет мост `/seo-tekst`.
- **Ключевые шаги:** интейк (шаг 0, агент `intake-analyst` -> `intake.json` с провенансом + `ВВОДНЫЕ.md`); `validate-analysis-inputs.mjs` tier-aware; смысловой гейт `analysis-verifier` (state `analysis-verified`) ПОСЛЕ сборки A2 и ДО docx.
- **Опции:** `--seo`/`--no-seo` (явный tier), `--resume`, `--no-share` (без .docx и Drive; финал `analysis-verified`), `--answers` (влить ответы клиента из Google Doc: `answer-extractor` -> `apply-answers.mjs` -> revising), `--no-scan`/`--no-recon` (пропустить скан лидеров / разведку направлений), `<NNN> --add-seo` (дозакупка: tier -> seo, дообогащение Keyso-полями + ступень 4 поверх готовых 0-3).
- **Выход:** `analyses/NNN-slug/`: `A2.md` (раздел 0 «Вопросы к вам» + Executive Summary + раздел «Целевая аудитория» + разделы по ступеням), `audience.json`, `recon/<dir_slug>.json`, `questions.json`, `intake.json` + `ВВОДНЫЕ.md`, `recommendations.json` (при basic усечен), `verify_report.json`, `A2_<slug>.docx`, ссылка Google Doc; при tier=seo дополнительно `A3.md` + `stop_list_detailed.json` + `serp.json`.
- **Дальше читает:** `/seo-struktura` (требует tier=seo) берет `brief.json` + `competitors.json` + `serp.json` + `leader_scan.json`; `/seo-tekst` мостом забирает `audience.json`, `leader_scan.json` v2, `recon/`, `intake.json` (семена facts). `recommendations.json` - вход для `/seo-tekst`/`/seo-faq`.
- **Агенты:** `intake-analyst`, `brief-structurer`, `audience-analyst`, `competitor-finder`, `leader-scanner` (v2), `direction-scanner`, `serp-verdict` (только seo), `analysis-writer`, `analysis-verifier`, `answer-extractor` (в `--answers`).

### /seo-struktura <NNN> [--resume] [--review | --auto] [--import <xlsx>] [--metatags deep|bulk|none]
- **Зона:** worktree клиента. **Требует** существующий `analyses/NNN-*/` с tier=seo (нет анализа - стоп с подсказкой `/seo-analiz`; анализ basic - стоп с подсказкой `/seo-analiz NNN --add-seo`).
- **Вход:** NNN - номер папки анализа.
- **Вопросы/паузы:** в `--review` паузы после мастер-списка и после JM-расширения (беречь лимиты). **Главная пауза - awaiting-client:** A6.xlsx уходит клиенту, тот заполняет колонку "Целевая?" (да/нет/обсудить) и возвращает файл. По строкам "обсудить" или пустой колонке скил переспросит.
- **Ключевые шаги:** URL страниц строит модуль `_slug.mjs` из маркерного запроса (`structure-writer` копирует их, не генерит); `import-structure.mjs` валидирует «Адрес страницы» (exit 3); двойной финальный гейт - механический `verify-structure.mjs` (шаг 9г) + смысловой агент `structure-verifier` (шаг 9д, state `structure-verified`) перед финалом.
- **Опции:** `--resume`; `--review` (паузы) / `--auto` (по умолчанию, без пауз); `--import <xlsx>` - короткий путь: вернулся заполненный клиентом файл, собрать A6.md; `--metatags deep|bulk|none` - хвост метатегов после утверждения структуры (шаг 11, отдельная задача в `metatags/NNN-*/`; по умолчанию deep).
- **Выход:** `structures/NNN-slug/`: `A6_<slug>.xlsx` (4 листа: Структура/Рекомендации/Конкуренты/Миграция, для клиента), `A6.md` (финал для следующих услуг), `structure_data.json`, `cannibalization.json`, `verify_report.json`, ссылка Google Sheet.
- **Дальше читает:** `A6.md` - вход для ТЗ верстальщика (У5) и далее.
- **Агенты:** `master-list-builder`, `marker-finder`, `semantic-expander`, `cannibalization-resolver`, `structure-writer`, `structure-verifier`.

### /seo-metategi [--from-structure <NNN>] [--site <домен>] [--table <путь>] [--depth deep|bulk] [--resume]
- **Зона:** worktree клиента.
- **Вход:** источник страниц - один из трёх: `--from-structure <NNN>` («да»-страницы из `structures/NNN-*/`), `--site <домен>` (скан живого сайта - режим аудита: оценить, какие метатеги править), `--table <путь>` (таблица URL/Тип/Маркер[/запросы], csv/tsv). Без аргументов спросит источник.
- **Опции:** `--depth deep|bulk` - явная глубина (перекрывает авто-определение по фразам запроса). `deep` (по умолчанию) - по каждой странице анализ выдачи Яндекса + Title через Акварель, писатели **последовательно** (concurrency 1: arsenkin/JM общие, параллель давала таймауты и cross-talk); `bulk` - дёшево, по PLAYBOOK + батч-данные, без выдачи и Акварели, можно параллелить. `--resume`.
- **Выход:** `metatags/NNN-slug/`: `A7_<slug>.xlsx` (3 листа: Метатеги/Аналитика/Сводка) + автозагрузка в Drive (Google Sheet), `pages.json`, `research.json`, `shortlist.json`, `pages/N.json`.
- **Ключевые шаги:** финальный гейт (шаг 7.5) ПОСЛЕ сборки xlsx и ДО Drive - механический прогон `verify-metatags.mjs --accept-degraded` + смысловой спот-чек 3-5 страниц силами оркестратора (нового state не вводит).
- **Агенты:** `site-scanner` (только `--site`), `metatag-researcher`, `metatag-writer`.

### /seo-tekst [--from-structure NNN | --from-analysis NNN | --from-table <путь>] [--review | --auto] [--resume]
- **Зона:** worktree клиента.
- **Концепция v7 (ADR-038): скил ТОЛЬКО ПИШЕТ.** ЦА, конкуренты и разведка направлений сделаны в `/seo-analiz` и приходят готовыми артефактами из `analyses/NNN/` - здесь их никто не пересобирает. Деградация только отсутствием данных: нет `audience.json` - пишем без сегментов, нет recon направления - без разведки.
- **Вход:** источник страниц: `--from-structure <NNN>` («да»-страницы из `structures/NNN-*/`, анализ находится через ее `inputs.json`), `--from-analysis <NNN>` (путь без SEO: анализ есть, структуры нет - состав соберет `pages-planner` v2 и подтвердит гейт), `--from-table <путь>` (аварийный ручной: URL/Тип/Маркер[/запросы], csv/tsv; без анализа - штатная деградация). Без источника спросит. **Удалены в v7:** `--from-brief` (его путь: `/seo-analiz --no-seo` -> `/seo-tekst --from-analysis`), `--mode A|B` (own_page определяется данными `directions[].url` в анализе), `--theme` (прототип всегда wireframe), `--scan-leaders`/`--no-scan`/`--recon`/`--no-recon` (опции ступени 3 `/seo-analiz`).
- **Клиентские точки четыре:** гейт состава страниц (только без структуры, в чате), запрос фактуры/материалов (факт-гейт до планировщика), **ГЕЙТ СКЕЛЕТОВ (v7.1, обязательный)** - скелеты типов оформляются в `Skeletons_<slug>.docx` (Google Doc, клиентским языком: таблица «Блок / Зачем / Что внутри» по каждому типу страниц) и согласуются с заказчиком ДО тон-гейта и письма; цикл правок как у анализа (skeletons-shared <-> skeletons-revising -> skeletons-approved), `--auto` его НЕ пропускает; согласованный состав - канон для такта 2, **ТОН-ГЕЙТ** - главная пишется в 3 вариантах тона (по осям 3 tone_candidates от `offer-strategist`) и уходит заказчику одним html-файлом (`tone/tone-preview.html`) с запиской: канон формулировок + materials_missing. Выбор -> `decisions.register` {tone_id, axes, source}. Отдельного Analysis.docx и гейта стратегии НЕТ - согласование смысловых решений прошло циклом A2 в `/seo-analiz`. `--review` добавляет паузу после сборки прототипа - перед Drive-заливкой и отправкой заказчику; `--auto` (по умолчанию) - без нее.
- **Поток:** мост данных (`read-tekst-input.mjs` v2: pages.json с русскими типами и dir_slug, leader_blocks.json, facts.json - семена из intake) -> [быстрая структура + гейт состава] -> оффер-слой (strategy.json + 3 кандидата тона) -> скелеты по типам -> ГЕЙТ СКЕЛЕТОВ (`Skeletons_<slug>.docx` в Google Doc, цикл правок) -> blueprint главной -> ТОН-ГЕЙТ -> такт 2 остальных страниц -> веер писателей -> копи-аудит -> кросс-страничный `site-reviewer` (выбранная главная - эталон тона) -> независимая вычитка `tekst-verifier` -> прототип одним файлом (деливерабл; в Drive - файлом) + `HANDOFF.md`. Texts.docx в v7.1 НЕ существует: тексты заказчик читает в прототипе дословно, машиночитаемое для верстки - page.json + HANDOFF.md. Продающий пол F1-F4 (ADR-037) действует в любом тоне.
- **Выход:** `texts/NNN-slug/`: **`prototype.html`** (ДЕЛИВЕРАБЛ текстов - ВЕСЬ сайт одним self-contained файлом: стартовая страница-список, hash-роутер, ч/б wireframe; отдается заказчику файлом И заливается в Drive КАК ФАЙЛ - uploadFile без конвертации, постоянная ссылка) + **`HANDOFF.md`** (контракт передачи дизайнеру/разработчику - прикладывать вместе с прототипом) + `Skeletons_<slug>.docx` (Google Doc - гейт скелетов); промежуточные `pages/<slug>/{page.json,manifest.json,render.html}`, `blueprints/`, `type_skeletons.json`, `strategy.json`, `tone/tone-preview.html` (архив выбора тона; тоже в Drive файлом), `site_manifest.json`, `verify_report.json`, `share.json` (поля skeletons / tone_preview / prototype).
- **Дальше:** точечные правки - `/seo-tekst-fix`; SEO-слой поверх готовых текстов - `/seo-faq --from-tekst NNN` (предлагать ТОЛЬКО при tier=seo - basic-проект SEO не покупал).
- **Агенты:** `pages-planner` (v2, только без структуры), `offer-strategist`, `block-planner` (двухтактный), `slot-mapper`, `page-writer`, `copy-auditor`, `site-reviewer`, `tekst-verifier`, `prototype-builder`. Скрипты: `read-tekst-input.mjs`, `verify-copy.mjs`, `build-skeletons-docx.mjs` (Skeletons_<slug>.docx для гейта скелетов), `build-prototype.mjs` (render.html), `assemble-prototype.mjs` (один prototype.html), `verify-prototype.mjs` (v2, по texts_dir), `build-handoff.mjs`.

### /seo-tekst-fix <NNN> [<page-slug>] "<правка>"
- **Зона:** worktree клиента.
- **Вход:** NNN задачи `texts/NNN-*/` + описание правки (может быть сумбурной расшифровкой голосового - фиксер разберёт: «что понял/что неясно/что не трогаю», при неясности спросит ДО правки). `<page-slug>` можно опустить, если страница в задаче одна.
- **Что делает (v2, ADR-039):** агент `prototype-fixer` разбирает правку по трем исходам (исправляем / объясняем и держим / ищем настоящую причину), ставит каждой метку цены (минута / час / пересборка - дорогие выполняются последними), правит `manifest.json` (+ `page.json`, если правка текстовая), пересобирает `render.html` страницы (`build-prototype.mjs`), затем **общий `prototype.html`** ассемблером (`assemble-prototype.mjs` - дешевая детерминированная пересборка) + `verify-prototype.mjs` v2; после пересборки перезаливает Drive-файл прототипа (v7.1: ссылка `share.json.prototype` постоянная); возвращает дифф по секции страницы (не весь файл).
- **Шлюз:** правка затронула текст -> обязателен прогон `verify-copy.mjs` по странице на КАЖДОЙ итерации: иначе тексты правок накапливают ровно те ошибки, ради которых шлюз и делался. Крупная смысловая правка (красная нить, оффер сквозь страницу) - возврат к `page.json`, а не латание собранного HTML.
- **Выход:** обновленные `texts/NNN/pages/<slug>/{manifest.json, page.json, render.html}` + пересобранный `texts/NNN/prototype.html` (expected-маркер именно на него) + перезалитый Drive-файл прототипа; после правок пересобрать `HANDOFF.md` (`build-handoff.mjs`) - порядок блоков мог измениться.

### /seo-faq [--from-tekst <NNN>] [--from-table <путь>] [--url <URL>] [--review | --auto] [--resume]
- **Зона:** worktree клиента. **Гейт JM-баланса:** < 5 - стоп с подсказкой пополнить и `--resume`.
- **Вход:** `--from-tekst <NNN>` (страницы из `texts/NNN-*/`: текст из page.json + запросы из pages.json; NNN faq зеркалит NNN текстов), `--from-table <путь>` (URL/Маркер/Запросы[/Текст]), `--url <URL>` (одна живая страница - текст спарсит сам). Без источника спросит.
- **Опции:** `--auto` (по умолчанию, автономно); `--review` - пауза перед загрузкой в Drive; `--resume`.
- **Что делает:** JM-анализом находит недобранные ключи/N-граммы и добавляет к готовой странице отдельный SEO-блок: FAQ (Schema.org FAQPage) + возражения + плитка тегов + перелинковка - недостающая семантика вшита естественным языком, без переспама.
- **Выход:** `faq/NNN-slug/`: `pages/<page-slug>/faq.html` (вставляемый сниппет) + `faq.md`, `FAQ_<slug>.docx` (-> Google Doc), `share.json`.
- **Агент:** `faq-builder` (по страницам, по умолчанию последовательно - concurrency 1, анти-cross-talk JM).

### /seo-tehaudit <domain> [--resume] [--no-share] [--from-analysis <NNN>]
- **Зона:** worktree клиента. Пост-онбординговая услуга: нужны доступы клиента к Яндекс Вебмастеру и Метрике (без них часть проверок пропускается, в отчёте появляется раздел "Не удалось проверить").
- **Вход:** домен (`example.ru`; кириллический IDN - в кириллице). Без аргумента спросит.
- **Вопросы/паузы:** карточка сайта показывается после разведки (точка показа клиенту); затем **цикл client-review** - ждёт "одобряю" либо правку, классифицирует её (edit/recon/indexing/onpage/analytics/writer) и пересобирает - до approved.
- **Опции:** `--resume`; `--no-share` (только локальные `A12.md` + `A12.docx`, без Drive и цикла правок); `--from-analysis <NNN>` (взять базу Keyso из `analyses/NNN/`; у basic-анализа Keyso-ключа нет - штатный fallback «база по региону»); `--pages <N>` (сколько страниц охватить on-page аудитом, дефолт 24, потолок 80).
- **Выход:** `audits/NNN-slug/`: `A12.md` (отчёт - карточка + проблемы 🔴🟡🟢 + чеклист разработчику + динамические приложения), `A12_<slug>.docx` (клиентский документ, дизайн TIMUR SEO), `audit_data.json` (структурированный источник истины для рендеров), ссылка Google Doc в Drive.
- **Ключевые шаги:** пороги мета-тегов зашиты в TH-константы `merge-onpage.mjs` (Title 80 / Description 200 - скрипт сам считает вердикты); `audit-onpage` даёт сырьё + `extra_findings`; смысловой факт-чек `audit-verifier` (шаг 5b, state `audit-verified`) ПОСЛЕ рендера A12.md и ДО docx.
- **Параллелизм:** on-page аудит идёт ШАРДАМИ - выборку делит скрипт, K параллельных `audit-onpage` фетчат свои батчи (масштабируется `--pages`), рядом параллельно `audit-analytics`; merge сливает. Арсенкин (возраст домена) - только в recon, строго последовательно (ломается при параллельных вызовах).
- **Агенты:** `audit-recon`, `audit-indexing`, `audit-onpage` (шард), `audit-analytics`, `audit-writer`, `audit-verifier`. Скрипты: `select-audit-pages`, `merge-onpage`, `render-audit-md`, `verify-audit`, `build-audit-docx`.

### /seo-strategiya <URL | none> [--resume]
- **Зона:** worktree клиента. Читает `ЗАКАЗЧИК.md` если есть, иначе спрашивает напрямую (годится для пресейла).
- **Вход:** URL клиента (`site.ru` или `https://site.ru/`); `none` если сайта нет.
- **Вопросы:** регион продвижения, ниша/описание бизнеса, есть ли доступ к Вебмастеру/Метрике, бюджет (опц.), средний чек / конверсия / маржинальность (опц., для денежной декомпозиции прогноза), заметки. Если `none` - дополнительно главный запрос/маркер ниши и известные конкуренты.
- **Опции:** `--resume`.
- **Выход:** `strategies/NNN-slug/`: `SEO_Strategy_<domain>.docx` (стратегия **без цен**, для клиента; в прогнозе - денежная воронка трафик->лиды->продажи->выручка через средний чек, без цен и окупаемости) + `Smeta_<domain>.xlsx` (смета **с ценами**, внутренняя, 3 тарифа Старт/Рост/Максимум + 4-я вкладка декомпозиции с окупаемостью и ROI к каждому тарифу), оба залиты в Drive (Google Doc + Google Sheet). Плюс `strategy_data.json`, `tariffs.json`, `share.json`.
- **Ключевые шаги:** двойной гейт перед docx (шаг 6.5) - механический `verify-strategy.mjs` (6.5а: цены только в смете/xlsx, в прозе стратегии запрещены; стоп-лист воды; тире и буква е-с-точками) + смысловой `strategy-verifier` (6.5б, state `strategy-verified`).
- **Методология (read-only):** тарифы из `~/.claude/seo-knowledge/TARIFFS.md`, правила связок из `RULES.md`.
- **Агенты:** `strategy-scanner`, `competitor-analyst`, `growth-strategist`, `tariff-architect`, `strategy-writer`, `strategy-verifier`.

### /custom-question [<вопрос> | <файл>] [--resume] [--format auto|answer|recommendation|doc]
- **Зона:** worktree клиента.
- **Вход:** вопрос заказчика - текст в чат или путь к файлу (переписка/транскрибация). Без аргумента спросит.
- **Вопросы/паузы:** обязательный гейт трактовки - один раунд AskUserQuestion (первый вопрос всегда «какая трактовка верна», дальше недостающие вводные; у каждого опция «передать проджекту/заказчику»). При «передать» - генерит client_questions.md человеческим языком, ждет ответы, продолжение через --resume.
- **Опции:** `--resume` (продолжить/влить ответы заказчика), `--format` (auto - агент сам решит; answer/recommendation/doc).
- **Выход:** `questions/NNN-slug/`: `solution.md` (+ `answer_client.md` для формата answer - готовый текст ответа без жаргона). Запись уходит в общий `QA-ЖУРНАЛ.md`.
- **Дальше:** `/handoff` -> в main `/handoff-process` (применит запись в QA-ЖУРНАЛ.md).
- **Агенты:** `context-gatherer`, `solution-writer`, `solution-verifier`.

### /seo-temi [--resume] [--queries "..."]
- **Зона:** worktree клиента. **Требует** `ЗАКАЗЧИК.md` в корне.
- **Вход:** ничего обязательного; опционально затравочные запросы.
- **Вопросы/паузы:** показывает таблицу из 15-25 тем и ждёт "ок" либо правки ("убери темы 7,12", "добавь про X", "перепиши тему 5 под жанр Личный опыт") - в цикле правок выводит только дифф изменённых строк. Цикл до подтверждения.
- **Ключевые шаги:** дедуп-список `existing_queries.json` (корневой `topics.xlsx` через `read-topics-xlsx --main-only` + `articles/_index.json`); проверка батча агентом `topics-verifier` (шаг 4.5, sonnet, `verify_report.json`) ДО показа пользователю.
- **Опции:** `--resume` (продолжить батч или подхватить ручные правки в xlsx), `--queries "запрос1, запрос2"`.
- **Выход:** `topics/NNN-slug/Topics_<slug>.xlsx` + `topics-batch.json` + `existing_queries.json` + `verify_report.json`, ссылка Google Sheet для согласования.
- **Дальше:** `/handoff` -> в main `/handoff-process` сольёт темы в общий `topics.xlsx` (дедуп по main_query). `/seo-statya N` берёт строку N из общего `topics.xlsx`.
- **Агенты:** `topic-generator`, `topics-verifier`. Дедуп против `topics.xlsx` + `articles/_index.json`.

### /seo-statya <N | N-M | N,M,K> [--resume] [--review | --auto] [--with-handoff] [--genre="..."] [--platform=site|external|social] [--rebuild-docx] [--finalize-batch]
- **Зона:** worktree клиента. Читает строку(и) N из `topics.xlsx` + `ЗАКАЗЧИК.md` + `template.html`.
- **Вход:** N - номер темы; **диапазон `11-20` или список `11,12,15`** - серийный режим (несколько статей подряд в одной worktree).
- **Вопросы/паузы:** в `--auto` (по умолчанию) пауз нет вообще. В `--review` - стоп после финализации (ждёт `/continue` или `/edit "..."`), плюс подтверждения на ключевых шагах. Единственный вопрос даже в `--auto` - коллизия: по теме уже есть статья и переданный `--genre` противоречит доступным. В серии проблемная тема не валит батч - помечается «требует внимания», идём дальше.
- **Ключевые шаги:** серия (`N-M`/`N,M,K`) ведётся движком `batch-queue.mjs` на очереди `.claude/tmp/batch-queue.json` (изоляция сбоев: проблемная тема помечается `failed`, батч не валится); `current-article.txt` - активный указатель статьи для хуков. Ядро скила в `SKILL.md`, детали вынесены в `REFERENCE.md` (8 якорей).
- **Опции:** `--resume` (по meta.json; в серии - дописать недоделанные темы), `--review` / `--auto`, `--with-handoff` (после готовности сам зовёт `/handoff` - в серии мержит весь батч), `--genre="..."`, `--platform=...`, `--rebuild-docx <id>` (recovery: пересобрать только .docx готовой статьи и перезалить, минуя state machine), `--finalize-batch` (пересобрать только серийный финал по готовым статьям).
- **Выход:** `articles/NNN-slug/`: `Article_NNN_<slug>.docx` (с картинками), `output-NNN.html`, `metatags.json`, `verify_report.json`, опц. `tilda/`, `report.md`, `audit.md`, фото в Cloudinary, ссылка Google Doc. **В серии** дополнительно - авто-папка на Рабочем столе `Stati_<proj>_<spec>_<date>\` (пронумерованные HTML + `Метатеги_<spec>.xlsx` + zip) и Google Sheet метатегов в Drive. По одной теме можно делать несколько статей в разных жанрах/площадках (коллизия по `topic_id` через `articles/_index.json`).
- **Агенты:** `jm-analyst` -> `tz-builder` -> `section-writer` (по разделам) -> `article-finalizer` -> `text-auditor` -> `article-fixer-batch` -> `enhancer` -> `photo-promter` -> `photo-producer` (шаг 9b: генерит+публикует фото прямыми MCP) -> `article-verifier` (шаг 10c: финальная вычитка собранного HTML, state `verified`).

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

### /share-analysis | /share-structure | /share-metatags | /share-audit | /share-tekst | /share-faq | /share-strategy | /share-topics | /share-article  <NNN> [--redo]
- **Зона:** worktree клиента.
- **Назначение:** утилиты повторной/отложенной загрузки финального файла на Google Drive (с конверсией в Google Doc/Sheet). По умолчанию основной скил делает это сам; share-* нужен если Drive был недоступен при первом прогоне или после ручных правок локального файла. `--redo` - перезалить.
- **Особенность `/share-tekst` (v7.1):** сигнатура `<NNN> [--skeletons|--tone|--prototype] [--redo]` - перезаливает `Skeletons_<slug>.docx` (с конвертацией в Google Doc), `tone/tone-preview.html` или `prototype.html` (дефолт - prototype). Html-файлы заливаются в Drive КАК ФАЙЛ (uploadFile БЕЗ convertToGoogleFormat - постоянная ссылка в папке клиента), учет в `share.json.{skeletons, tone_preview, prototype}`. Texts.docx и Analysis.docx в v7.1 не существуют (поле `share.json.analysis` - legacy старых задач).

### /handoff [--message "..."] [--resume]
- **Зона:** worktree клиента. **Всегда в конце задачи.**
- **Что делает:** финальный коммит -> merge ветки worktree в main (--no-ff) -> удаление ветки и worktree.
- **Вопросы/паузы:** предупреждает, если задача - незавершённый `/seo-analiz` (state не approved/completed). При merge-конфликте останавливается и просит разрешить вручную в main, затем `/handoff --resume` для cleanup.
- **Опции:** `--message` (своё сообщение коммита), `--resume` (после ручного разрешения конфликта).
- **Выход:** все файлы задачи (и содержимое `handoff-requests/`) теперь в main.
- **Дальше:** если задача создавала запросы в `handoff-requests/` (seo-shablon, seo-temi, request-shared-edit) -> открыть main-сессию -> `/handoff-process`. Чистая per-task работа (статья без правок общих файлов) - уже в main, ничего больше не нужно.

### /handoff-process [--dry-run] [--only=<тип>]
- **Зона:** main-сессия (без worktree). **Единственная команда main.**
- **Что делает:** собирает накопленные запросы (`seo-shablon`, `seo-temi` из `topics/NNN/`, `shared-edit` .md) -> показывает план -> применяет к общим файлам в корне -> переносит обработанное в `processed/` -> коммит. Дедуп тем по `main_query`, идемпотентность батчей через флаг `applied_to_root_xlsx`.
- **Вопросы:** "применять все? [Y/n/by-one]"; при перезаписи существующего target; при конфликтующих запросах к одному файлу.
- **Опции:** `--dry-run` (показать, не применять), `--only=<тип>`.
- **Выход:** обновлённые `ЗАКАЗЧИК.md` / `template.html` / `topics.xlsx` в корне проекта.

### /sync-from-template [<путь к шаблону>] [--apply]
- **Зона:** main-сессия клиента (без worktree). Меняет общие файлы машинерии.
- **Вход:** опц. путь к шаблону (дефолт `~/seo-projects/template-project`).
- **Что делает:** обновляет машинерию ОДНОГО (текущего) проекта из шаблона. Без `--apply` - dry-run (отчёт +/~/-). Тонкая обёртка над движком; подробности - раздел 9.
- **Опции:** `--apply` (применить + само-коммит с откатом).
- **Дальше:** прогнать `.claude\tests\*\run.mjs`; для всех проектов разом - `/sync-all` в родителе.

---

## 4. Связки артефактов (кто чьё читает)

Конвейер держится на файлах, не на чате. Каждый шаг оставляет JSON/MD, следующий их читает:

```
ОДИНОЧКА - стратегия (самодостаточна, сканирует сайт сама, ни от чего не зависит):
/seo-strategiya --> SEO_Strategy.docx (без цен) + Smeta.xlsx (тарифы)

ТРЕК «Коммерческое SEO» (самостоятельная цепочка, от брифа; /seo-shablon НЕ нужен):
/seo-analiz --> intake.json, brief.json (+ directions[]), audience.json, competitors.json,
        |       leader_scan.json (v2: посылы + blocks_by_type), recon/<dir_slug>.json,
        |       A2.md, questions.json, recommendations.json; при tier=seo + serp.json, A3.md
        |
        +--> /seo-struktura ОБЯЗАТЕЛЬНО читает brief+competitors+serp+leader_scan (нужен tier=seo)
        v
/seo-struktura --> A6.xlsx (клиенту) --> client_filled.xlsx --> structure_data.json --> A6.md
        |
        +--> A6.md -> ТЗ верстальщика; structure_data.json -> /seo-metategi и /seo-tekst (--from-structure)
        v
/seo-tekst (только пишет; мост read-tekst-input.mjs забирает из analyses/: audience, leader_blocks,
        |   recon, семена facts) --> pages.json -> strategy.json (3 кандидата тона) ->
        |   type_skeletons.json -> [ГЕЙТ СКЕЛЕТОВ: Skeletons_<slug>.docx в Google Doc, цикл правок] ->
        |   [ТОН-ГЕЙТ: tone/tone-preview.html] -> blueprints/ ->
        |   pages/<slug>/page.json + render.html -> prototype.html (один файл, деливерабл;
        |   файл заказчику + Drive-копия файлом) + HANDOFF.md  (Texts.docx в v7.1 нет)
        +--> /seo-faq --from-tekst NNN --> faq.html (SEO-блок поверх готовых страниц) + FAQ.docx
             (предлагать только при tier=seo)

ПУТЬ БЕЗ SEO (ADR-038) - тот же трек, короче:
бриф/ТЗ --> /seo-analiz --no-seo (tier=basic: ступени 0-3, без Keyso/SERP/частотностей)
        --> /seo-tekst --from-analysis NNN --> pages_draft.json --> [гейт состава] --> pages.json
        --> (дальше ровно тот же конвейер; /seo-faq в конце НЕ предлагать - проект не покупал SEO)

ТРЕК «Информационное SEO» (самостоятельная цепочка, независим от коммерческого):
/seo-shablon --> ЗАКАЗЧИК.md (профиль) + template.html (шаблон статьи)
        |
        +--> читают /seo-temi и /seo-statya
/seo-temi --> Topics.xlsx --(/handoff-process, дедуп)--> корневой topics.xlsx
        |
        +--> /seo-statya N читает строку N
/seo-statya --> articles/NNN/: jm/*.json -> tz.md -> sections/*.md -> article.md + metatags.json -> output-NNN.html -> Article_NNN.docx  (серия N-M: + папка на Рабочем столе + Метатеги.xlsx)
```

Ключевые "точки стыковки":
- `ЗАКАЗЧИК.md` - профиль клиента информационного трека; создаётся `/seo-shablon` (+ `/handoff-process`), читают `/seo-temi` и `/seo-statya`. Коммерческому треку и стратегии не обязателен.
- `analyses/NNN/` - обязательный вход для `/seo-struktura` (нужен tier=seo) и для `/seo-tekst` (мост читает audience/leader_scan/recon/intake; большие артефакты не копируются - агенты читают их по `inputs.json.analysis_dir`). Канон-схему JSON-источников проверяет `validate-analysis-inputs.mjs` (tier-aware) - на ОБОИХ концах стыка: в конце сборки `/seo-analiz` и на старте `/seo-struktura`.
- корневой `topics.xlsx` - единый темник; пополняется только через `/handoff-process`, в worktree он read-only.
- `meta.json` в каждой папке задачи - state machine, единственный источник истины о прогрессе (двигается через `update-meta.sh`). На него опираются `--resume` и `/handoff`.

---

## 5. MCP-инструменты: что за что отвечает

Все MCP-серверы подключены **глобально** в Claude Code Desktop (не в проекте). Агенты вызывают их по именам инструментов. Практический разрез "вход -> выход":

**Ядро конвейера (используется скилами напрямую):**

| Сервер | Инструменты (примеры) | Вход -> Выход | Где задействован |
|---|---|---|---|
| JM (Just-Magic) | `jm_account`, `jm_text_generate`, `jm_text_analyze`, `jm_semantic_pack`, `jm_wordstat`, `jm_clustering`, `jm_suggest` | запрос/текст -> ТЗ, N-граммы, LSI, кластеры, топ-30 запросов на маркер, баланс | seo-statya (анализ текста), seo-struktura (semantic_pack). **Перед `jm_text_analyze` баланс должен быть >= 5** |
| Wordstat (частотность/сезонность) | `jm_wordstat` (mode=frequency, primary), `arsenkin_wordstat` (mode=frequency/parsing/dynamics), `wk_check_frequency` | запрос + регион -> частотность; расширение семантики (`jm_semantic_pack`/`jm_suggest`/`arsenkin_wordstat` mode=parsing); сезонность (`arsenkin_wordstat` mode=dynamics, group=month) | проверка частотности тем/маркеров. Дерево регионов живым инструментом не отдаётся - код берём из зашитого списка (Москва 213, СПб 2, ...), дефолт 213; геозависимость запроса проверяет `arsenkin_commerce` |
| Yandex-выдача | `arsenkin_top` (домены/URL топа: queries[], region, depth, is_snippet), `arsenkin_positions` (позиция домена) | запрос + регион -> живая выдача / позиция домена | SERP-анализ, проверка позиций. Альтернативы: keyso `check_top`/`history_serp`; форум-майнинг -> встроенный `web_search` |
| Keys.so | `domain_pages`, `domain_competitors`, `domain_keywords`, `keyword_info`, `keyword_similar`, `domain_dashboard`, `visibility_rating` | домен/ключ + база региона -> страницы, конкуренты, ключи с метриками | главный источник конкурентов для seo-analiz и маркеров для seo-struktura |
| Arsenkin | `arsenkin_parse`, `arsenkin_top`, `arsenkin_positions`, `arsenkin_clustering`, `arsenkin_commerce` | запросы/URL -> парс топа, кластеры, коммерциализация | вспомогательный анализ выдачи |
| WK | `wk_check_frequency`, `wk_balance` | список запросов -> массовая частотность | резерв, когда Keyso/JM не дают частоты |
| Webmaster | `wm_summary`, `wm_indexing`, `wm_query_analytics`, `wm_site_audit`, `wm_important_urls`, `wm_sitemaps` | хост -> индексация, запросы, диагностика, sitemap | данные своих верифицированных сайтов (scan в strategy) |
| Fetch (seo-fetch) | `seo_fetch_page` (один URL), `seo_fetch_batch` (веер по списку URL) | URL -> разобранный HTML под профиль: `http` (статусы/редиректы/soft-404; для самих редиректов `follow_redirects=false`), `meta` (title/description/canonical/robots/og), `outline` (h1-h6/типизация, дефолт), `content` (основной текст/факты/посылы), `audit` (полный on-page без сырого HTML), `raw` (сырой HTML/CSS - бренд-цвета, шрифты, сигнатуры CMS). robots.txt/sitemap.xml -> `seo_fetch_page(url)` без профиля (тело в body_raw). JS не рендерит | leader-scanner, типизация страниц. Деградированный fallback - `web_fetch`/WebFetch (теряет мету/структуру/HTTP-статус) |
| Google Drive | `mcp__gdrive-piotr__uploadFile` (`convertToGoogleFormat: true`), `deleteItem` | локальный .docx/.xlsx -> Google Doc/Sheet + ссылка | финальная заливка в strategy/analysis/structure/topics/article и все `/share-*` |
| Cloudinary + OpenRouter | `mcp__openrouter-image__generate_image` (nano-banana-2), `mcp__cloudinary-publish__publish_image`; скилы `image-generation`/`image-publishing` для ручного веера | промт -> PNG -> delivery URL CDN | фото в `/seo-statya` (шаг 9b - агент `photo-producer` зовёт MCP напрямую) |

**Прочие подключённые MCP (доступны глобально, в основном конвейере напрямую не зашиты - используются точечно или вручную):** Yandex Metrika (`ym_*` - трафик/цели/аудит), Google Sheets API (`sheets_*` - прямое чтение/запись таблиц), Telegram (`tg_*` - чаты/сообщения), SEM/Topvisor/Monstro (`sem_*` - мониторинг позиций, отчёты, телеграм-сводки), AI-tracker (`ai_tracker_*` - упоминания в AI-выдаче), SpeedyIndex (`speedyindex_*` - ускорение индексации), Cloudinary asset-mgmt (управление загруженными ассетами). У большинства есть `healthcheck` для проверки доступности.

Если инструмент нужного MCP не появился в сессии - сервер не подключён или отвалился; проверь `healthcheck` соответствующего сервера и не блокируй основную задачу (для Drive предусмотрены fallback и `/share-*`).

---

## 6. Зоны: worktree vs main, и почему так

| | worktree-сессия | main-сессия | родитель ~/seo-projects/ |
|---|---|---|---|
| Галочка worktree | ON | OFF | n/a |
| Команды | все рабочие скилы + `/handoff` | `/handoff-process`, `/sync-from-template` | `/new-project`, `/status`, `/sync-all` |
| Можно писать | своя папка задачи + `.claude/tmp/` + `.claude/handoff-requests/` | всё (pre-commit не ограничивает) | git-репо (только свой `.claude/`), без клиентских задач |
| Общие файлы | read-only (защита pre-commit) | редактируемы (через handoff-process) | - |

Почему worktree-first: можно параллельно вести несколько задач (несколько статей, статья + стратегия и т.п.) в одном клиенте без конфликтов. Каждая задача = своя ветка + своя папка + свой `meta.json`. Подробности - ADR-001/002/003 в `docs/adr/` любого клиента.

Цикл handoff:
1. В worktree довёл задачу до конца -> `/handoff` (commit + merge + cleanup).
2. Если задача меняла общие файлы (seo-shablon, seo-temi, request-shared-edit) -> открой main -> `/handoff-process`.
3. Чистая per-task работа (статья без правок общих файлов) - после `/handoff` уже в main, шаг 2 не нужен.

---

## 7. Частые ступоры

- **`pre-commit: В worktree запрещено менять файлы вне текущей задачи`** - пытаешься закоммитить общий файл из worktree. Нужна правка -> `/request-shared-edit "..."`. Не нужна -> `git checkout -- <файл>`. Часто причина - не записан `.claude/tmp/current-task.txt` (скил пишет туда путь своей папки первым делом).
- **`node is not recognized`** - `scoop install nodejs-lts` (обёртка `.claude\scripts\_node.cmd` подхватит node без перезапуска), либо поставить с nodejs.org и перезапустить десктоп.
- **Скил говорит "работает только в worktree" / "только в main"** - открой сессию в правильном режиме (галочка worktree при создании). Это системное правило, не обходить.
- **Merge-конфликт при `/handoff`** - разреши вручную в main-папке (git status/diff/add/commit), вернись в worktree -> `/handoff --resume`.
- **`Worktree remove failed: Permission denied` (Windows)** - file-lock индексатора. Не критично: метаданные убраны, зомби-папку подчистит `git worktree prune` при следующем `/handoff-process`.
- **Drive недоступен / OAuth протух** - финальный скил не блокируется, оставляет локальные .docx/.xlsx; догрузишь через `/share-<тип> <NNN>` после восстановления.
- **`529 Overloaded` / `503` / `rate_limit` от API** в длинных скилах (seo-statya, seo-struktura) - это норма: скил сам делает `ScheduleWakeup` на ~90с и продолжает с `--resume`, до 3 попыток. Не перезапускай вручную.
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
- НЕ используй букву ё - всегда пиши е. Правило для всех клиентских текстов и метатегов (как и запрет тире).
- Не запускай несколько разнотипных рабочих скилов из одной сессии - каждая задача в своём worktree.
- Субагенты объявляют модель явно (`sonnet` - механика, `opus` - суждение и клиентская проза); `model: inherit` запрещён - см. `docs/MODEL-POLICY.md` (ADR-024).
- Оркестрация держит диету контекста: сводки агентов <=8 строк, промежуточное - в файлы, parent-fallback запрещён (агент сам пишет файл, иначе ре-делегация), большие данные передаются путями - см. `docs/ORCHESTRATION.md`.

---

## 9. Обновление машинерии (как раскатать правки шаблона на проекты)

«Машинерия» - единый, идентичный у всех клиентов код: `.claude/{scripts,agents,skills,hooks,git-hooks,migrations,tests}` + `package.json` + `.gitignore` + `.claude/settings.json`. В worktree она read-only и никогда не кастомится под клиента. Клиентское (`ЗАКАЗЧИК.md`, `template.html`, `topics.xlsx`, рабочие папки, `settings.local.json`) синк НЕ трогает. Починил баг/добавил фичу в шаблоне - этот механизм доставляет правку в уже созданные клоны.

**Два входа (один движок под капотом):**
- `/sync-from-template [--apply]` - ОДИН проект, из его main-сессии. Без `--apply` - dry-run (отчёт +новых / ~изменятся / -удалятся). С `--apply` - зеркалит файлы, пишет `.claude/.machinery-version`, прогоняет невыполненные миграции, сам коммитит (в отчёте - хэш и команда отката `git reset --hard <prev>`).
- `/sync-all [--apply] [--only a,b] [--no-delete]` - ВСЕ проекты разом, из родителя `~/seo-projects/`. Dry-run даёт матрицу «кто отстал»; `--apply` применяет, пропуская грязные деревья и worktree-таргеты (их видно в «Пропущенные»).

**Версия и видимость отставания:**
- `.claude/.machinery-version` (коммитится) - на каком commit шаблона собран проект. Пишется при `/new-project` (клон) и каждом синке.
- `/status` показывает, кто отстал (+ счётчик «машинерия отстала: N»). HEAD клиента для этого бесполезен - у каждого своя история задач.

**Миграции данных** (`.claude/migrations/NNN-*.mjs` + журнал `.claude/.migrations-applied.json`): для случаев, что копированием файла не решить (напр. вывести ставший кешем `_index.json` из git-индекса). Идемпотентные, движок прогоняет невыполненные после копирования, до коммита. В dry-run только показываются.

**Предусловие:** машинерия шаблона должна быть закоммичена (иначе метка версии неточна) и желательно запушена в origin (иначе новые клоны через `/new-project` получат старьё). Движок предупредит, если шаблон сам отстал от origin.

**Безопасность:** dry-run всегда первым; `--apply` коммитит локально (в origin клиентов НЕ пушит - у них origin = сам шаблон); каждый синк ревертабелен; грязные деревья и worktree не трогаются; `CLAUDE.md` не синкается авто (движок только покажет, что отличается - решаешь вручную).

**Типовой цикл:** правка в `template-project` -> коммит + push -> `/sync-all` (dry-run, смотришь матрицу) -> `/sync-all --apply`. Если правка требует починки данных - добавь миграцию в `template-project/.claude/migrations/`.
