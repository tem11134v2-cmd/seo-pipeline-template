---
name: seo-analiz
description: Ступенчатый предпроектный анализ для всех клиентов (tier basic/seo). Интейк -> бриф с направлениями -> ЦА -> конкуренты -> скан лидеров -> разведка направлений -> SERP-вердикт (только tier=seo) -> A2.md (+ A3.md при seo) + .docx + автозагрузка в Drive + revising-цикл до approved. Аргументы: [--seo|--no-seo] [--resume] [--answers] [--no-share] [--no-scan] [--no-recon]; дозакупка SEO - <NNN> --add-seo.
---

# seo-analiz

Скил-оркестратор ступенчатого предпроектного анализа. Запускается **в worktree-сессии**. Работает для ВСЕХ клиентов: tier=basic (SEO не куплено - ступени 0-3) и tier=seo (полный - плюс ступень 4). Tier определяет ИНСТРУМЕНТЫ ступеней (Keyso - только при seo), а не их состав (ADR-038).

## Аргументы

```
/seo-analiz [--seo | --no-seo] [--resume] [--answers] [--no-share] [--no-scan] [--no-recon]
/seo-analiz <NNN> --add-seo
```

- `--seo` / `--no-seo` - явный tier (`seo` | `basic`). Без флага на фрэш-старте скил задает вопрос «SEO куплено?» и пишет ответ в `meta.json.tier`.
- `--resume` - продолжить с того места, где остановились (по `meta.json` существующей `analyses/NNN-slug/`).
- `--no-share` - собрать только текстовые артефакты (A2.md + questions.json + A3.md при seo), не делать .docx и не заливать в Drive. Финальное состояние `analysis-verified` вместо `approved` (смысловой гейт шага 7b все равно проходит). Для случаев когда клиента нет, или нужны только текстовые артефакты для следующих услуг.
- `--answers` - режим импорта ответов клиента: прочитать его правки/ответы в Google Doc (по ссылке из `share.json`), заполнить `questions.json` и решить, что перезапустить. Точка входа при state `client-review`/`shared`/`revising`; при нескольких анализах скил спросит `NNN` (явный `/seo-analiz <NNN> --answers` приоритетен).
- `--no-scan` - опция ступени 3: пропустить шаг 4 (скан лидеров). `leader_scan.json` не создается, состояние `leaders-done` проходится транзитом (деградация отсутствием данных).
- `--no-recon` - опция ступени 3: пропустить шаг 5 (разведка направлений). `recon/` не создается, `directions-done` транзитом.
- `<NNN> --add-seo` - дозакупка SEO поверх готового basic-анализа: tier -> seo, прогон дообогащения (см. раздел «Режим --add-seo»). Валиден только при state `approved`/`completed`.

## Ступени и tier

```
Ступень 0  Интейк        шаг 0  (intake-analyst, единый словарь полей)
Ступень 1  Бриф          шаг 1  (brief-structurer: 16 параметров + directions[];
                                 Keyso-поля при seo, client_pages сканом сайта при basic)
Ступень 2  ЦА            шаг 2  (audience-analyst -> audience.json)
Ступень 3  Конкуренты    шаги 3-5 (competitor-finder, leader-scanner v2,
                                 direction-scanner веером; опции --no-scan / --no-recon)
Ступень 4  SEO (опция)   шаг 6  (serp-verdict) + A3.md/stop_list_detailed в сборке;
                                 ТОЛЬКО при tier=seo
```

## State machine

```
init -> intake-done -> brief-done -> audience-done -> competitors-done -> leaders-done
     -> directions-done -> [serp-done]              # serp-done только при tier=seo
     -> report-done -> analysis-verified -> docx-done -> shared
     -> client-review <-> revising -> approved -> completed
--add-seo: (approved|completed) -> tier=seo, state=brief-done -> вперед в режиме
           дообогащения (audience-done и directions-done проходятся транзитом,
           без перезапуска агентов)
```

Состояния:
- `intake-done` - вводная фактура упакована в intake.json + ВВОДНЫЕ.md (шаг 0).
- `brief-done` - brief.json собран: 16 параметров + directions[] (шаг 1).
- `audience-done` - audience.json собран (шаг 2).
- `competitors-done` - candidates.json + competitors.json собраны (шаг 3).
- `leaders-done` - leader_scan.json v2 собран (шаг 4); при `--no-scan` - транзит.
- `directions-done` - recon/<dir_slug>.json по направлениям собраны (шаг 5); при `--no-recon` - транзит.
- `serp-done` - serp.json собран (шаг 6). Существует ТОЛЬКО при tier=seo; при basic состояние не ставится.
- `report-done` - A2.md и questions.json собраны (+ A3.md при seo) (шаг 7).
- `analysis-verified` - смысловой гейт пройден, verify_report.json verdict=pass (шаг 7b). При `--no-share` - финальное состояние.
- `docx-done` - .docx собран (шаг 8.0). По умолчанию обязательное состояние; пропускается только при `--no-share`.
- `shared` - .docx залит в Drive, ссылка получена (шаг 8). При `--no-share` пропускается.
- `client-review` - скил ждет фидбек от пользователя по ссылке.
- `revising` - пользователь дал правку (в т.ч. через `--answers`), скил ее применяет (Edit или перезапуск шага).
- `approved` - пользователь явно сказал «все ОК». Только после этого скил рекомендует `/handoff`.
- `completed` - финальное состояние (после `/handoff`).

`meta.json` - единственный источник истины о текущем состоянии. Обновляется через `bash .claude/hooks/update-meta.sh <analysis_dir> <state>`. Поля tier:

```json
{
  "tier": "seo | basic",       // пишет оркестратор на старте (флаг или вопрос)
  "tier_upgraded_at": "ISO"    // только после --add-seo
}
```

Читатели `state` вне скила: `/share-analysis` (в т.ч. состояния дообогащения --add-seo), `/status`. Читатели `tier`: все ступени, validate v2, `/seo-struktura` (гейт входа требует tier=seo), мост /seo-tekst.

## Артефакты

```
analyses/NNN-<domain-slug>/
├── meta.json                  # state machine + tier (+ tier_upgraded_at) + drive_file_id
├── brief_raw.txt              # исходный бриф (как пришел от пользователя; при файлах-источниках - плейсхолдер)
├── intake.json                # вводная фактура: факты с провенансом + gaps + conflicts (шаг 0);
│                              #   + own_page-факты после подтверждения клиентом (source: "own_page:<url>", шаг 9f)
├── ВВОДНЫЕ.md                 # человекочитаемый конспект фактуры (шаг 0)
├── brief.json                 # 16 параметров + slug + directions[] + client_pages;
│                              #   при tier=seo + keyso_base + путь А/Б/В/Г + метрики (при basic Keyso-ключи ОТСУТСТВУЮТ)
├── audience.json              # ЦА: summary + сегменты (dir_slugs) + audience_wordings {phrase, means, from} (шаг 2)
├── candidates.json            # домены-кандидаты до фильтрации (intermediate)
├── competitors.json           # 6-10 финальных + топ-3 лидера + причины исключений; при basic - без Keyso-метрик и path
├── leader_scan.json           # v2: блоки/посылы/фишки по топ-3 + blocks_by_type + features_to_steal (шаг 4; нет при --no-scan)
├── recon/<dir_slug>.json      # разведка направления: must_have/gaps/offers_seen; own_page (blocks + facts_seen)
│                              #   при directions[].url (шаг 5; нет при --no-recon)
├── serp.json                  # SERP-анализ + вердикт + промежуточный стоп-лист + смежные; ТОЛЬКО tier=seo (шаг 6)
├── A2.md                      # ФИНАЛ - markdown-отчет (раздел 0 «Вопросы к вам» + Executive Summary + разделы, вкл. «Целевая аудитория»)
├── A3.md                      # ФИНАЛ - стоп-лист (по строке = домен); ТОЛЬКО tier=seo
├── questions.json             # ФИНАЛ - канон раздела 0 (единый источник для docx и --answers); rerun_hint v2
├── verify_report.json         # вердикт смыслового гейта analysis-verifier (шаг 7b)
├── stop_list_detailed.json    # machine+human стоп-лист с причинами; ТОЛЬКО tier=seo
├── recommendations.json       # всегда; при basic - усечен (только for_pages, без SERP-выводов for_strategy)
├── client_doc.md              # транзиент: выгруженный текст Google Doc клиента (--answers)
├── answers.json               # транзиент: извлеченные ответы клиента (--answers)
├── rerun_plan.json            # транзиент: что перезапускать по ответам клиента (--answers)
├── A2_<slug>.docx             # ASCII-safe имя; собирается всегда кроме --no-share
└── share.json                 # ссылка Drive + drive_file_id + mime_type + shared_at + revisions[]
```

## Алгоритм

### 0a. Проверка: мы в worktree?

```bash
GIT_DIR=$(git rev-parse --git-dir)
COMMON_DIR=$(git rev-parse --git-common-dir)
```

Если `GIT_DIR == COMMON_DIR` - мы в main. Предупредить:
> «Ты собираешь предпроектный анализ в main-сессии. Pre-commit hook здесь не блокирует. Для многозадачности рекомендую закрыть и переоткрыть с галочкой worktree.»

Не блокировать - пользователь может сознательно так захотеть.

### 0b. Parse args

```
tier_flag = "seo" при --seo | "basic" при --no-seo | null без флага
resume    = true при --resume
no_share  = true при --no-share
answers   = true при --answers
no_scan   = true при --no-scan     (пропуск шага 4)
no_recon  = true при --no-recon    (пропуск шага 5)
add_seo   = true при --add-seo     (+ обязательный NNN)
```

`--no-scan` / `--no-recon` действуют на текущий запуск (в meta.json не пишутся); пропущенный шаг оставляет свой артефакт отсутствующим - деградация отсутствием данных.

### 0c. Setup

#### Если `--resume`

- Найти существующую `analyses/<NNN>-*/`. Если несколько кандидатов - спросить пользователя.
- Прочитать `meta.json`. `state = meta.state`, `tier = meta.tier`.
- Если в `meta.json` НЕТ поля `tier` - задача создана скилом до v7 (другой порядок состояний). Стоп: «Эта задача старого формата - довершай ее прежней версией скила (до синка v7). Новый анализ - новой задачей.»
- Спросить: «Найдено в состоянии `<state>` (tier: `<tier>`), обновлено `<updated>`. Продолжить? [Y/n]»
- Если Y - перейти к ветке от следующего шага после `state`:
  - `init` -> шаг 0 (интейк)
  - `intake-done` -> шаг 1 (бриф)
  - Прогон дообогащения (есть `tier_upgraded_at`, а прогон --add-seo не дошел до `approved`) -
    состояния brief-done..leaders-done идут НЕ в штатные шаги, а в раздел «Режим --add-seo»:
    `brief-done` -> пункт 1 (enrich идемпотентен), `audience-done` -> пункт 2,
    `competitors-done` -> пункт 3, `leaders-done` -> пункт 4. Дальше - обычная ветка.
  - `brief-done` -> шаг 2 (ЦА)
  - `audience-done` -> шаг 3 (конкуренты)
  - `competitors-done` -> шаг 4 (скан лидеров); при `--no-scan` - транзит
  - `leaders-done` -> шаг 5 (разведка направлений); при `--no-recon` - транзит
  - `directions-done` -> шаг 6 (SERP-вердикт) при tier=seo; при tier=basic - шаг 7 (сборка)
  - `serp-done` -> шаг 7 (сборка A2 + questions.json + A3)
  - `report-done` -> шаг 7b (гейты validate v2 + analysis-verifier)
  - `analysis-verified` -> шаг 8 (.docx); при `--no-share` - шаг 10 (финал)
  - `docx-done` -> шаг 8a (Drive)
  - `shared` -> шаг 8e (вывести ссылку, перейти в `client-review`)
  - `client-review` -> шаг 9 (показать ссылку из `share.json`, ждать фидбек); при `--answers` - шаг 9.0
  - `revising` -> шаг 9d (продолжить применять последнюю правку); при `--answers` - шаг 9.0c
  - `approved` -> шаг 10 (финал)
  - `completed` -> стоп: «Анализ уже завершен. Используй `/share-analysis <NNN> --redo` для перезаливки или `/seo-analiz <NNN> --add-seo` для дозакупки SEO.»
- Если N - стоп, дать пользователю выбрать другую папку или начать заново.

#### Если `<NNN> --add-seo`

- Найти `analyses/<NNN>-*/`, прочитать `meta.json`.
- Если `tier == "seo"` - стоп: «Анализ уже tier=seo, дообогащать нечего.»
- Если `state` не `approved` и не `completed` - стоп: «--add-seo применим только к завершенному basic-анализу (approved/completed). Сначала доведи анализ до approved через --resume.»
- Записать `.claude/tmp/current-task.txt` с путем `analyses/<NNN>-<slug>/`.
- Обновить `meta.json`: `tier = "seo"`, `tier_upgraded_at = <ISO UTC>`; `bash .claude/hooks/update-meta.sh <analysis_dir> brief-done`.
- Перейти к разделу «Режим --add-seo».

#### Если фрэш-старт

1. **Tier.** Если `tier_flag == null` - спросить пользователя: «SEO куплено? [Y - tier=seo / N - tier=basic (анализ без SERP-вердикта и стоп-листа)]». Зафиксировать `tier`.
2. **Получить фактуру.** Спросить пользователя:
   > «Передай вводную фактуру - бриф, транскрибацию созвона, любые файлы. Если это ФАЙЛЫ - дай пути (не вставляй содержимое в чат). Если текст - вставь, я сохраню в файл. Минимум: ниша + регион.»
3. **Разложить фактуру по путям (НЕ читать ее в главный контекст):**
   - Если пользователь дал ПУТИ к файлам - НЕ открывать их `Read`'ом в свой контекст. Собрать список путей. `brief_raw.txt` в этом случае - либо один из этих файлов (если это и есть бриф), либо пустой плейсхолдер.
   - Если пользователь вставил ТЕКСТ - сохранить как есть в `<analysis_dir>/brief_raw.txt` (одним `Write`) и дальше оперировать ТОЛЬКО путем `brief_raw.txt`.
   - Собрать `intake_sources = [{path, label, type}]` по всем источникам (`brief_raw.txt` + приложенные файлы/транскрибации). Финализируется после создания папки (п. 6), когда известен `<analysis_dir>`.
4. **(домен + slug).** Из первого источника быстро (одной попыткой, без MCP) выделить **домен** (если есть) и **нишу + регион** для построения slug. Если источник - файл, для ЭТОГО можно прочитать только его шапку/первые строки, не весь массив. Например, `niche="ремонт квартир", region="спб"` -> `slug = "remont-kvartir-spb"`. Если домен есть и узнаваем - `slug = slugify(domain)` (Latin kebab-case, IDN -> транслит).
5. Найти следующий свободный номер `NNN` в `analyses/` (начиная с 001, с ведущим нулем).
6. Создать папку `analyses/<NNN>-<slug>/`. Если пользователь вставил ТЕКСТ - записать `analyses/<NNN>-<slug>/brief_raw.txt` (исходный бриф целиком); если дал ПУТИ - создать `brief_raw.txt` пустым плейсхолдером (или скопировать в него бриф-файл), остальные пути оставить в `intake_sources`.
7. Записать `.claude/tmp/current-task.txt` с путем `analyses/<NNN>-<slug>/` (**критично - без этого pre-commit hook откажет в коммите**).
8. Создать `meta.json`:
   ```json
   {
     "slug": "<slug>",
     "tier": "<seo | basic>",
     "state": "init",
     "completed_steps": [],
     "started": "<ISO UTC>",
     "updated": "<ISO UTC>"
   }
   ```
9. `state = "init"`. Переход к шагу 0 (интейк).

### Шаг 0. Интейк - упаковка вводной фактуры (если state == "init")

Маркер: `.claude/tmp/expected-intake-analyst-<run_id>.txt = <analysis_dir>/intake.json`

Делегировать `intake-analyst` (БЕЗ параметра `profile` - словарь полей единый):
```
task_dir: <analysis_dir>
intake_sources: <список путей + ярлыков: brief_raw.txt и приложенные файлы/транскрибации>
project_root: <project root>
Прочитай всю фактуру по путям + ЗАКАЗЧИК.md (если есть). Собери intake.json (факты с source + цитатой, gaps, conflicts) + ВВОДНЫЕ.md. Провенанс обязателен для решающих фактов (УТП, запреты, гео, ассортимент, бюджеты).
```

После завершения:
- Проверить, что `intake.json` и `ВВОДНЫЕ.md` созданы и непусты (иначе ре-делегировать с явным указанием).
- `bash .claude/hooks/update-meta.sh <analysis_dir> intake-done`
- Сводка от агента - в чат (сами факты не выводить, они в файлах). Переход к шагу 1.

### Шаг 1. Бриф (если state == "intake-done")

(служебный маркер контракта агента создается автоматически - не выводить в чат)

Делегировать `brief-structurer`:
```
analysis_dir: <analysis_dir>
tier: <meta.tier>
intake_path: <analysis_dir>/intake.json
brief_raw_path: <analysis_dir>/brief_raw.txt
project_root: <project root>
Прочитай intake.json, смаппь факты в 16 параметров, унаследуй gaps. Собери directions[] - канон направлений ассортимента (dir_slug, name, source, marker_hint, url живой страницы клиента или null). При tier=seo: если есть домен - проверь его через domain_dashboard и заполни domain_dashboard_snapshot; определи keyso_base и путь А/Б/В/Г; метрики client_pages. При tier=basic: Keyso не вызывать, Keyso-ключи в brief.json НЕ создавать (деградация отсутствием, не null); client_pages собери сканом сайта клиента (sitemap/меню через seo_fetch_page, до 5 страниц, h1/blocks/page_type) без метрик. Сохрани <analysis_dir>/brief.json. (Если intake.json отсутствует - fallback на brief_raw.txt.)
```

После завершения:
- Проверить `brief.directions`: непусто, dir_slug уникальны. Иначе - ре-делегировать с явным указанием (лимит 2), затем стоп с показом проблемы.
- `bash .claude/hooks/update-meta.sh <analysis_dir> brief-done`
- Сводка от агента - в чат. Если `brief.gaps` непуст и есть критичные дыры (нет ниши или нет региона) - спросить пользователя: «В брифе не хватает критичных полей: `<список>`. Продолжаем на неполных данных или дополнишь?»
- Иначе - сразу переход к шагу 2.

### Шаг 2. Анализ ЦА (если state == "brief-done")

Маркер: `.claude/tmp/expected-audience-analyst-<run_id>.txt = <analysis_dir>/audience.json`

Делегировать `audience-analyst`:
```
analysis_dir: <analysis_dir>
project_root: <project root>
Прочитай brief.json (directions[], ca_data - сырая строка брифа), intake.json (факты о клиентах/УТП) и MCP_MAP.md. Собери audience.json: summary (<= 2000 знаков), segments[] (портрет, боли/страхи/возражения словами клиента, transformation, привязка dir_slugs к направлениям - не к страницам), audience_wordings[] {phrase, means, from}. Форум-майнинг дословных формулировок - max 2-3 fetch-вызова. Сохрани <analysis_dir>/audience.json.
```

После завершения:
- Проверить `audience.json`: summary непуст, segments >= 1. Иначе - ре-делегировать (лимит 2).
- `bash .claude/hooks/update-meta.sh <analysis_dir> audience-done`
- Сводка от агента - в чат. Переход к шагу 3.

Подтверждение формулировок ЦА клиентом = revising-цикл A2 (audience_wordings печатаются в разделе «Целевая аудитория», строка `from: persona/model` не становится публичной формулировкой без подтверждения - правило переезжает в тексты через lexicon).

### Шаг 3. Конкуренты (если state == "audience-done")

(служебный маркер контракта агента создается автоматически - не выводить в чат)

Делегировать `competitor-finder`:
```
analysis_dir: <analysis_dir>
tier: <meta.tier>
project_root: <project root>
Прочитай brief.json и MCP_MAP.md. При tier=seo: найди конкурентов по пути <brief.path>, отфильтруй агрегаторы и нерелевантные, собери Keyso-метрики по оставшимся, отбери 6-10 + топ-3 лидера - как обычно. При tier=basic: кандидаты = client_competitors из брифа + SERP arsenkin_top по marker_hint 3-5 направлений из brief.directions; Keyso не вызывать, поля path/keyso-метрик НЕ создавать; типизацию спорных доменов делай лайт-фетчем. Сохрани candidates.json (промежуточный) и competitors.json (финальный, вкл. leaders_top3).
```

После завершения:
- `bash .claude/hooks/update-meta.sh <analysis_dir> competitors-done`
- Сводка от агента - в чат. Если `competitors.direct.length < 6` - предупредить пользователя: «Найдено только `<N>` прямых конкурентов. Проверим - может быть ниша очень узкая или путь нужно поменять. Продолжаем?»
- Иначе - переход к шагу 4.

### Шаг 4. Скан лидеров (если state == "competitors-done")

**Если `--no-scan`:** шаг пропустить - `bash .claude/hooks/update-meta.sh <analysis_dir> leaders-done`, одна строка в чат («Скан лидеров пропущен по --no-scan, leader_scan.json не создается»), переход к шагу 5.

(служебный маркер контракта агента создается автоматически - не выводить в чат)

Делегировать `leader-scanner` (v2 - поглотил leader-block-scanner: один скан, два выхода):
```
analysis_dir: <analysis_dir>
tier: <meta.tier>
project_root: <project root>
Прочитай brief.json, competitors.json, MCP_MAP.md. По каждому из leaders_top3 выбери 3-4 страницы (при tier=seo - через domain_pages; при tier=basic - через меню/sitemap лидера seo_fetch'ем, без метрик), fetch'ни их, извлеки блоки/посылы/фишки. Сделай сводку с сопоставлением УТП клиента. Дополнительно собери blocks_by_type (матрица «блок x тип страницы», русские типы: Главная | Услуга | Категория | Товар | Инфо, имена блоков - словарь BLOCKS.md) и features_to_steal. Сохрани leader_scan.json. Это НЕ полный аудит - только скан смыслов.
```

После завершения:
- `bash .claude/hooks/update-meta.sh <analysis_dir> leaders-done`
- Сводка от агента - в чат. Переход к шагу 5.

### Шаг 5. Разведка направлений (если state == "leaders-done")

**Если `--no-recon`:** шаг пропустить - `bash .claude/hooks/update-meta.sh <analysis_dir> directions-done`, одна строка в чат, переход к шагу 6 (seo) / шагу 7 (basic).

Веер `direction-scanner` по КАЖДОМУ направлению из `brief.directions`, **пачками по 4-6 параллельно**. Expected-маркеры на веере НЕ ставятся (ломает hook; проверка - по файлам после пачки). Промт каждому:
```
analysis_dir: <analysis_dir>
dir_slug: <dir_slug>
region: <код региона Яндекса ЧИСЛОМ - оркестратор определяет его ОДИН раз по brief.region
  (справочник кодов - .claude/skills/seo-metategi/PLAYBOOK.md р.8); не 225/0/null - иначе SERP
  тихо выродится в федеральную выдачу>
project_root: <project root>
Прочитай brief.json (свое направление в directions[] по dir_slug: marker_hint, url) и MCP_MAP.md. SERP по marker_hint -> фильтр однотипных сайтов -> фетч 3-5 страниц конкурентов направления. Собери тонкий recon: published_info / offers_seen / must_have / gaps. Если у направления есть url - дополнительно сними own_page: blocks своей живой страницы + facts_seen (КАНДИДАТЫ фактов с value/where - не подтвержденные факты). Сохрани <analysis_dir>/recon/<dir_slug>.json.
```

После каждой пачки: проверить, что `recon/<dir_slug>.json` создан и непуст по каждому направлению пачки; недостающие - ре-делегировать точечно (лимит 2 на направление, дальше пометить направление как «без recon» и продолжать - деградация отсутствием).

После всех пачек:
- `bash .claude/hooks/update-meta.sh <analysis_dir> directions-done`
- Сводка в чат (<= 8 строк: сколько направлений разведано, сколько с own_page, пути). Переход: tier=seo - шаг 6; tier=basic - шаг 7.

### Шаг 6. SERP-вердикт (если state == "directions-done", ТОЛЬКО tier=seo)

При tier=basic этот шаг не существует: со state `directions-done` сразу шаг 7 (состояние `serp-done` не ставится).

(служебный маркер контракта агента создается автоматически - не выводить в чат)

Делегировать `serp-verdict`:
```
analysis_dir: <analysis_dir>
project_root: <project root>
Прочитай brief.json, competitors.json, candidates.json, MCP_MAP.md. Проанализируй SERP по 3-5 коммерческим запросам, сформулируй вердикт совместимости, собери промежуточный стоп-лист и смежные направления. Сохрани serp.json.
```

После завершения:
- `bash .claude/hooks/update-meta.sh <analysis_dir> serp-done`
- Сводка от агента - в чат, включая вердикт.
- Сравнение вердикта - с нормализацией е/е-с-точками (ADR-023): литерал `ИДЁМ` из serp.json
  равен `ИДЕМ`.
- **Если вердикт `КОРРЕКТИРУЕМ ТИП САЙТА`, `МЕНЯЕМ СТРАТЕГИЮ` или `ИДЕМ С ОГОВОРКАМИ`** - пауза с детальной сводкой:
  > «**Вердикт:** `<тип>`
  >
  > **Что это значит:** <1-2 предложения, из serp.verdict.reasoning>
  >
  > **Главные рекомендации:**
  > 1. <serp.verdict.recommendations[0]>
  > 2. <serp.verdict.recommendations[1]>
  > 3. <serp.verdict.recommendations[2]>
  >
  > Это стратегическое решение. Рекомендуется обсудить с клиентом ДО продолжения. Продолжаем сборку отчета сейчас или приостановим? [Y - продолжить / N - приостановить и обсудить]»
  - Если N - оставить state `serp-done`, выйти. Пользователь может потом запустить `--resume`.
- Если вердикт `ИДЕМ` - сразу переход к шагу 7 без паузы.

### Шаг 7. Сборка A2 + questions (+ A3 при seo) (если state == "directions-done" при basic | "serp-done" при seo)

(служебный маркер контракта агента создается автоматически - не выводить в чат)

(Скил проверяет A2 через маркер. questions.json - и A3.md при tier=seo - проверяются отдельно после возврата агента: если не создан или пуст, повторно делегировать с явным указанием.)

Делегировать `analysis-writer` (tier-aware):
```
analysis_dir: <analysis_dir>
tier: <meta.tier>
project_root: <project root>
Прочитай brief.json, audience.json, competitors.json, candidates.json (нужен для A3 - при tier=basic можно не читать), leader_scan.json (если есть; при --no-scan файла нет - раздел 3 пропусти), recon/*.json (сводно, если есть; при --no-recon раздел разведки пропусти), intake.json (gaps + conflicts -> вопросы раздела 0); при tier=seo - обязательно serp.json. Собери:
- questions.json: 3-7 вопросов раздела «0. Вопросы к вам», каждый с rerun_hint из словаря v2 (intake|brief|audience|competitors|leaders|directions|serp|writer|edit); если в recon/*.json есть own_page.facts_seen - отдельный вопрос «сверка фактов с вашей живой страницы» с перечислением кандидатов;
- A2.md: раздел 0 перед Executive Summary + разделы в фиксированной структуре, включая раздел «Целевая аудитория» (по audience.json, С ПЕЧАТЬЮ audience_wordings - их подтверждение = клиентский цикл A2); SERP-раздел ТОЛЬКО при tier=seo; Executive Summary при tier=basic - без строки «Вердикт» (вместо нее вывод по конкурентам);
- при tier=seo: A3.md (дедуплицированный, отсортированный стоп-лист доменов) + stop_list_detailed.json; при tier=basic они НЕ создаются;
- recommendations.json: всегда; при tier=basic - только for_pages из leader_scan/audience/directions-источников, for_strategy SERP-выводы - только при seo.
```

После возврата `analysis-writer` и проверки questions.json (+ A3.md при seo):
- `bash .claude/hooks/update-meta.sh <analysis_dir> report-done`
- Вывести пользователю краткую сводку + пути к A2.md, `questions.json`, `recommendations.json` (+ A3.md, `stop_list_detailed.json` при seo).
- Дальше - шаг 7b (гейты), НЕ сразу docx (и не сразу финал даже при `--no-share`).

### Шаг 7b. Гейты: validate v2 + смысловой гейт (если state == "report-done")

**Гейт 1 - машинные источники** (то, что дальше читают `/seo-struktura` и мост `/seo-tekst`):
```
.claude\scripts\_node.cmd .claude\scripts\validate-analysis-inputs.mjs <analysis_dir>
```
Скрипт tier-aware: при basic Keyso-ключи/path в brief/competitors и serp.json опциональны; при seo - полный набор. Всегда проверяет directions[] (непусто, слаги уникальны) и audience.json (summary + >= 1 сегмент).
- exit 0 - канон-схема цела -> гейт 2.
- exit 2 - дрейф схемы в JSON-источниках (печатает построчно). Ловим ДО отдачи. Пере-делегировать соответствующего продюсера (`brief-structurer` / `audience-analyst` / `competitor-finder` / `serp-verdict`), затем повторить. Лимит 2 повтора, иначе стоп с показом нарушений.
- exit 1 - ошибка запуска, показать stderr, стоп.

**Гейт 2 - смысловой (analysis-verifier).** Маркер: `.claude/tmp/expected-analysis-verifier-<run_id>.txt = <analysis_dir>/verify_report.json`

Делегировать `analysis-verifier` (tier-aware):
```
analysis_dir: <analysis_dir>
tier: <meta.tier>
project_root: <project root>
Прочитай A2.md + brief.json + intake.json + audience.json + competitors.json + leader_scan.json (если есть) + questions.json; при tier=seo - также serp.json + A3.md. Сверь цифры/факты, полноту разделов (структура tier-aware: SERP-раздел условен), раздел «Целевая аудитория» против audience.json, согласованность раздела 0 с questions.json; непротиворечивость вердикта с serp.json - только при seo. Клиентский язык и стиль. Ничего не чини. Запиши verify_report.json.
```

После - прочитать `verify_report.json` (точечно `verdict` + `counters`, не весь файл):
- `verdict == pass` -> `bash .claude/hooks/update-meta.sh <analysis_dir> analysis-verified`
  - Если `--no-share`: это финал текстовых артефактов -> шаг 10 (финал) на state `analysis-verified`. Не делать docx и не грузить в Drive.
  - Иначе -> шаг 8 (docx + Drive).
- `verdict == needs-fix` / `fail` -> пере-делегировать `analysis-writer` с issues из отчета (макс 2 повтора), затем повторить гейт 1 и гейт 2. После 2 повторов без pass - стоп с показом issues пользователю.

### Шаг 8. docx + Drive (если state == "analysis-verified", обязательно кроме --no-share)

#### 8.0. Сборка .docx

```
.claude\scripts\_node.cmd .claude\scripts\build-analysis-docx.mjs <analysis_dir>
```

Скрипт читает `A2.md` + `brief.json` + `questions.json` (раздел 0) + `serp.json` (если есть; при basic отсутствует - скрипт толерантен), генерирует `<analysis_dir>/A2_<slug>.docx` (ASCII-safe имя).

После: `bash .claude/hooks/update-meta.sh <analysis_dir> docx-done`. Переход к 8a.

#### 8a. Прочитать DRIVE.md

`~/.claude/seo-knowledge/DRIVE.md` -> извлечь `analyses_folder_id`.

Если файла или поля нет - стоп:
> «Не найден `analyses_folder_id` в DRIVE.md. Создай папку `/SEO/Analyses/` в Drive с правами `anyone-with-link -> reader`, добавь ее ID в DRIVE.md. Затем продолжи через `/seo-analiz --resume`.»

#### 8b. Если в meta.json есть `drive_file_id` (revising-цикл или --add-seo)

Это значит - повторная заливка после правок. Удалить старый файл по `drive_file_id` (тогда новый получит новый ID, но это норм для revising-цикла; ссылка может поменяться). Альтернатива: использовать `mcp__gdrive-piotr__uploadFile` с тем же `name` - если папка с `anyone-with-link` правами, Drive обновит файл по имени. **Идти по простому пути: delete + upload.**

```
mcp__gdrive-piotr__deleteItem(itemId="<old_drive_file_id>")
```

(Если deleteItem упал - файл уже удален руками. Предупредить, продолжить.)

#### 8c. Загрузка

```
mcp__gdrive-piotr__uploadFile(
  localPath: <абсолютный путь к A2_<slug>.docx>,
  name: A2_<slug>,
  parentFolderId: <analyses_folder_id>,
  mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  convertToGoogleFormat: true
)
```

Если `convertToGoogleFormat: true` упал (Google Docs API не активна) - fallback: повторить с `convertToGoogleFormat: false`. В сводку добавить:
> Залит как .docx (Google Docs API не активна). Активируй в Google Cloud Console, потом `/share-analysis <NNN> --redo`.

Сохранить `id`, `link` из ответа.

#### 8d. Записать `share.json` и обновить meta.json

`<analysis_dir>/share.json`:

```json
{
  "drive_file_id": "<id>",
  "drive_link": "<link>",
  "mime_type": "application/vnd.google-apps.document" | "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "shared_at": "<ISO timestamp UTC>",
  "revisions": []
}
```

В `meta.json` добавить через `Edit` (или через `update-meta.sh ... drive_file_id=<id>`):

```json
"drive_file_id": "<id>",
"drive_link": "<link>"
```

`bash .claude/hooks/update-meta.sh <analysis_dir> shared`

#### 8e. Переход в состояние `client-review`

`bash .claude/hooks/update-meta.sh <analysis_dir> client-review`

Вывести пользователю (строка «Сводка вердикта» - только при tier=seo; при basic вместо нее «Ключевой вывод по конкурентам» - 1 строка из Executive Summary):

```
═══ A2 ГОТОВ И ЗАЛИТ В DRIVE ═══

Ссылка для клиента (Google Doc):
   <drive_link>

Локальные артефакты:
   <analysis_dir>/A2.md
   <analysis_dir>/audience.json
   <analysis_dir>/recommendations.json
   <analysis_dir>/A2_<slug>.docx
   [при tier=seo:] <analysis_dir>/A3.md

Сводка вердикта (tier=seo): <serp.verdict.type>
[при basic:] Ключевой вывод по конкурентам: <1 строка>

Главные действия (топ-3 из recommendations.json):
   1. <item> (priority: <p>)
   2. ...
   3. ...

Клиенту: «Ознакомьтесь с документом. Главное - ответьте на вопросы в самом начале
   (раздел 0 «Вопросы к вам»). Можно коротко: "согласен с рекомендованным" по каждому
   или свой вариант. Ответы можно писать прямо в Google Doc.»

Жду фидбек:
  - "одобряю" / "OK" / "approved" -> скил перейдет в approved и подскажет /handoff
  - "есть правки: <описание>" -> скил классифицирует и применит
  - клиент ответил в Google Doc -> запусти /seo-analiz --answers (я прочитаю его ответы)
```

**Не выходить из сессии. Ждать пользовательский ввод. После любого фидбека - шаг 9 или 10.**

### Шаг 9. Обработка фидбека (state == "client-review")

#### 9.0. Режим `--answers` (клиент ответил в Google Doc)

Точка входа: `/seo-analiz --answers`. Найти анализ в state `client-review`/`shared`/`revising`; если несколько - спросить `NNN` (явный `/seo-analiz <NNN> --answers` всегда приоритетен). Прочитать `<analysis_dir>/share.json` -> `drive_file_id` (doc_id) + `mime_type`.

**a) Выгрузить Google Doc клиента.** Если `mime_type == "application/vnd.google-apps.document"`:
```
text = mcp__gdrive-piotr__readGoogleDoc(documentId=<doc_id>, format="markdown")
```
СРАЗУ записать `text` в `<analysis_dir>/client_doc.md` (`Write`) и дальше работать ПУТЕМ, не цитируя содержимое в чат (диета контекста). Если `readGoogleDoc` упал / `mime` = .docx (Docs API не активна при заливке) - перейти к fallback (9.0d).

**b) Делегировать `answer-extractor`** (маркер -> `answers.json`):

Маркер: `.claude/tmp/expected-answer-extractor-<run_id>.txt = <analysis_dir>/answers.json`
```
analysis_dir: <analysis_dir>
client_doc_path: <analysis_dir>/client_doc.md
questions_path: <analysis_dir>/questions.json
project_root: <project root>
```

**c) Слить ответы детерминированно:**
```
.claude\scripts\_node.cmd .claude\scripts\apply-answers.mjs <analysis_dir> --source google-doc
```
- exit 2 -> схема questions/answers битая: показать построчно и стоп (или пере-делегировать extractor 1 раз).
- exit 1 -> ошибка запуска (нет папки/файлов/битый JSON), показать stderr, стоп.
- exit 0 -> прочитать `rerun_plan.json` (точечно `deepest_stage` + `buckets`).

Перейти в state `revising`: `bash .claude/hooks/update-meta.sh <analysis_dir> revising`.

**Дозапись own_page-фактов:** если среди ответов есть подтверждения по вопросу «сверка фактов с вашей живой страницы» - выполнить шаг 9f ДО перезапусков.

Дальше - как 9d, но список перезапусков берется из `rerun_plan` (НЕ из чат-эвристик 9c). По `deepest_stage` - полная downstream-таблица (словарь v2; при tier=basic serp-звено ИСКЛЮЧАЕТСЯ из любой цепочки; звенья шагов, пропущенных флагами при основном прогоне - leader-scanner при `--no-scan`, direction-scanner при `--no-recon` - тоже пропускаются, если пользователь явно не просит их выполнить):

```
intake      -> intake-analyst -> brief-structurer -> audience-analyst -> competitor-finder
               -> leader-scanner -> direction-scanner -> [serp-verdict] -> analysis-writer
brief       -> brief-structurer -> audience-analyst -> competitor-finder -> leader-scanner
               -> direction-scanner -> [serp-verdict] -> analysis-writer
audience    -> audience-analyst -> analysis-writer   (оффер-слой текстов ЦА перечитает сам)
competitors -> competitor-finder -> leader-scanner -> [serp-verdict] -> analysis-writer
leaders     -> leader-scanner -> analysis-writer
directions  -> direction-scanner (точечно по затронутым направлениям) -> analysis-writer
serp        -> serp-verdict -> analysis-writer       (только tier=seo)
writer      -> analysis-writer
edit        -> точечные Edit A2.md по free_comments (без перезапусков)
none        -> перезапусков нет; ответы «согласен с рекомендованным» уже отражены в A2;
               при наличии free_comments применить их как edit
```

«Согласен с рекомендованным» - валидный ответ, перезапуска не требует. Затем 9e (report-done -> шаг 7b -> re-build docx + re-upload) -> `client-review`.

**d) Fallback (Drive недоступен / не Google Doc):** попросить ассистента вставить ответы текстом в чат. Тогда:
- либо вставленный текст записать в `client_doc.md` и пойти по 9.0b-c (детерминированный путь),
- либо (совсем ручной режим) - существующая классификация 9c по чат-эвристикам.

#### 9a. Если пользователь одобрил

Триггеры одобрения (case-insensitive): «одобряю», «ок», «approved», «все хорошо», «принято», «accept».

- `bash .claude/hooks/update-meta.sh <analysis_dir> approved`
- Переход к шагу 10 (финал).

#### 9b. Если пользователь дал правку

Перейти в state `revising`:

`bash .claude/hooks/update-meta.sh <analysis_dir> revising`

#### 9c. Классификация правки (Гибрид - модель C)

На основе текста правки скил предлагает свою классификацию и просит OK:

```
Получил правку: "<цитата правки 1 строкой>"

Похоже это [<тип>]:
  - тип "edit"        - точечная правка текста A2.md (формулировка, опечатка, добавить пункт)
  - тип "intake"      - вводная фактура неверна/неполна (не тот файл, не те исходные факты)
  - тип "brief"       - добавить контекст про клиента (страницу, УТП, ассортимент, направление)
  - тип "audience"    - поправить ЦА (сегменты, боли, формулировки)
  - тип "competitors" - поправить список конкурентов
  - тип "leaders"     - пересканировать лидеров с уточнением
  - тип "directions"  - пересобрать разведку направления (маркер, своя страница)
  - тип "serp"        - пересчитать SERP / поправить вердикт (только tier=seo)
  - тип "writer"      - пересобрать A2 без перезапуска нижних шагов

Согласен? [Y / n=другой тип / details=покажи парс правки]
```

**Эвристики автоклассификации:**

| Признак в тексте правки | Тип |
|---|---|
| Содержит конкретную цитату из A2.md, или «переформулируй / убери / добавь пункт» | `edit` |
| «Во вводных ошибка», «мы присылали другой файл/бриф», «исходные данные не те» | `intake` |
| «Вы пропустили», «не учли», «у клиента есть X» + упоминание URL/страницы/услуги | `brief` |
| «ЦА не та», «сегмент не тот», «наши клиенты - другие», «боли/возражения не те» | `audience` |
| «Не тот конкурент», «забыли A.ru», «B.ru не оттуда» | `competitors` |
| «У X есть фишка Y», «у Z блок W», «лидер делает по-другому» | `leaders` |
| «По направлению X не то», «не тот маркер направления», «наша страница направления другая» | `directions` |
| «Не тот запрос», «вердикт неправильный», «не считайте Y коммерческим» (tier=seo) | `serp` |
| Не подходит ни под одно - | `writer` |

Если пользователь сказал `n` - спросить тип явно (тот же список без рекомендации).

**Если правка пришла через `--answers`** (есть свежий `rerun_plan.json`) - классификация УЖЕ сделана детерминированно (по `questions.json.answers` + `rerun_hint`). Использовать `rerun_plan` (см. 9.0c), эвристики таблицы 9c НЕ применять. Ручной чат-ввод - как раньше по таблице.

#### 9d. Применение правки по типу

**`edit`:** скил делает `Edit` в `A2.md` напрямую. Без перезапуска. Без апдейтов JSON.

**Остальные типы:** пересобрать соответствующий артефакт (делегировать продюсера с дополнительной инструкцией «правка: <описание>; явно учти X»), затем downstream по таблице из 9.0c (та же таблица - единственный канон цепочек; при basic serp-звено исключается). Длинные цепочки (`intake`/`brief`) могут занять 10-20 минут - предупредить.

Если правка в чате подтверждает own_page-факты (клиент отвечает на вопрос «сверка фактов с вашей живой страницы») - выполнить шаг 9f до перезапусков.

#### 9e. Re-build .docx и re-upload

- Перед пересборкой docx провести правку через гейты: `bash .claude/hooks/update-meta.sh <analysis_dir> report-done`, затем шаг 7b (validate v2 + analysis-verifier). Только при `verdict=pass` (state `analysis-verified`) продолжать; при needs-fix/fail - ре-делегация `analysis-writer` (лимит 2), как в 7b.
- Перезапустить `build-analysis-docx.mjs` (шаг 8.0).
- Шаг 8b (delete старого Drive-файла) + 8c (upload нового) + **обязательно 8d** (перезаписать
  `share.json.drive_file_id`/`drive_link` и `meta.json.drive_file_id` НОВЫМИ значениями - иначе
  следующий `--answers` и следующий delete получат id уже удаленного файла).
- Обновить `share.json.revisions[]`:

```json
{
  "type": "<edit|intake|brief|audience|competitors|leaders|directions|serp|writer|add-seo>",
  "note": "<текст правки 1 строкой>",
  "applied_at": "<ISO>",
  "new_drive_file_id": "<id>",
  "new_drive_link": "<link>"
}
```

- Вернуться в `client-review` (шаг 8e). Цикл может повторяться.

#### 9f. Дозапись own_page-фактов в intake.json

Когда клиент ПОДТВЕРДИЛ факты из вопроса «сверка фактов с вашей живой страницы» (через `--answers` или в чате) - оркестратор дописывает их в `<analysis_dir>/intake.json` (это данные задачи - Edit разрешен):

- в `facts[]` добавить по каждому подтвержденному кандидату полную запись канона intake:
  `{ "field": <по смыслу кандидата: numbers | prices | guarantee (дефолт numbers)>,
  "value": <facts_seen.value>, "quote": <facts_seen.value дословно>,
  "source": "own_page:<url>", "decision_impact": true }` (`<url>` - страница направления,
  откуда снят факт; провенанс ADR-028 сохраняется, потребители отбирают по `field` как обычно).
- Неподтвержденные кандидаты НЕ дописывать. Исправленные клиентом значения идут обычным путем правки (тип `brief`/`edit`), не через own_page-источник.

Отсюда мост `/seo-tekst` (read-tekst-input.mjs v2) донесет их до `texts/facts.json` штатно. Агенты facts_seen напрямую не читают никогда - числа только из facts.json (инвариант ADR-033/037).

### Шаг 10. Финал

`bash .claude/hooks/update-meta.sh <analysis_dir> completed`

Финальный коммит:
```
git add -A
git commit -m "Analysis <NNN> for <slug или domain>: completed (<N> revisions)"
```

Вывести сводку по tier.

**При tier=seo:**

```
═══ ПРЕДПРОЕКТНЫЙ АНАЛИЗ ОДОБРЕН (tier: seo) ═══

Клиент: <domain или niche / region>
Итераций правок: <N>

A2 в Drive (Google Doc, для клиента):
   <drive_link>

Локальные артефакты для следующих услуг:
   <analysis_dir>/A2.md                     - У3, У5
   <analysis_dir>/A3.md                     - стоп-лист
   <analysis_dir>/audience.json             - ЦА (тексты, опц. структура)
   <analysis_dir>/recommendations.json      - структурированные рекомендации
   <analysis_dir>/stop_list_detailed.json   - стоп-лист с причинами

Готово к /handoff (перенесет в main).

Следующий шаг конвейера (У3 - структура сайта):
   В новой worktree-сессии запусти:
     /seo-struktura <NNN>
   Скил прочитает analyses/<NNN>-<slug>/ (brief.json, competitors.json, serp.json,
   leader_scan.json), соберет мастер-список страниц, маркеры через каскад
   Keyso -> JM, проверит каннибализацию, сгенерирует A6.xlsx -> клиенту -> A6.md.
═════════════════════════════════════════
```

**При tier=basic:**

```
═══ ПРЕДПРОЕКТНЫЙ АНАЛИЗ ОДОБРЕН (tier: basic, без SEO) ═══

Клиент: <domain или niche / region>
Итераций правок: <N>

A2 в Drive (Google Doc, для клиента):
   <drive_link>

Локальные артефакты для следующих услуг:
   <analysis_dir>/A2.md                     - отчет
   <analysis_dir>/audience.json             - ЦА (вход текстов)
   <analysis_dir>/recommendations.json      - усечен (без SERP-выводов for_strategy)
   (A3.md и stop_list_detailed.json при basic не создаются - это артефакты ступени 4)

Готово к /handoff (перенесет в main).

Следующий шаг: конверсионные тексты без SEO -
   /seo-tekst --from-analysis <NNN> (в новой worktree-сессии).

Если клиент докупит SEO:
   /seo-analiz <NNN> --add-seo - дособерет SERP-вердикт и стоп-лист
   поверх готовых ступеней (ЦА и разведка направлений не перезапускаются).
═════════════════════════════════════════
```

## Режим --add-seo (дообогащение)

Вход - из 0c (`<NNN> --add-seo`): `tier = "seo"`, `tier_upgraded_at` записан, state = `brief-done`. Дальше вперед в режиме ДООБОГАЩЕНИЯ - агенты ступеней 1 и 3 добирают Keyso-данные, ступень 2 (ЦА) и разведка направлений НЕ перезапускаются:

1. **brief-structurer (дообогащение).** Делегировать с параметром `mode: enrich` и инструкцией: «Режим дообогащения --add-seo: brief.json уже собран (tier был basic). НЕ пересобирай 16 параметров и directions[]. Дозаполни только Keyso-поля: keyso_base, путь А/Б/В/Г, domain_dashboard_snapshot, метрики client_pages». State остается `brief-done` до завершения; после - `bash .claude/hooks/update-meta.sh <analysis_dir> audience-done` (ЦА транзитом, audience.json уже есть).
2. **competitor-finder (дообогащение).** Делегировать с параметром `mode: enrich` и инструкцией: «Режим дообогащения: competitors.json уже собран без Keyso. Добери Keyso-метрики по direct[], пересмотри leaders_top3 по метрикам. Состав direct менять только при явных ошибках». После - `update-meta.sh ... competitors-done`.
3. **Пересмотр лидеров.** Сравнить новый `leaders_top3` со старым (по которому собирался leader_scan.json). Если состав ИЗМЕНИЛСЯ - предупреждение в чат:
   > «После добора метрик состав топ-3 лидеров изменился: <старый> -> <новый>. leader_scan.json собран по старому составу. Перезапустить leader-scanner v2 по новому? [Y/n]»
   - Y - шаг 4 (leader-scanner v2), затем `leaders-done`.
   - n (или состав не менялся) - `update-meta.sh ... leaders-done` транзитом.
4. `update-meta.sh ... directions-done` - транзитом (recon/ не перезапускается).
5. **serp-verdict** - шаг 6 целиком (serp.json, вердикт, промежуточный стоп-лист). -> `serp-done`.
6. **Сборка и выдача** - шаг 7 (analysis-writer: A2 полный с SERP-разделом и вердиктом + A3.md + stop_list_detailed.json + recommendations полные) -> шаг 7b (гейты) -> шаг 8 (docx + re-upload: в Drive уже есть старый файл - идти через 8b delete + 8c upload + 8d перезапись drive_file_id/drive_link, дописать `share.json.revisions[]` запись `{"type": "add-seo", ...}`) -> `client-review` -> шаги 9-10 как обычно.

При обрыве прогона --resume распознает режим по `tier_upgraded_at` (см. 0c) и продолжает по этой же схеме с текущего state.

## Параллельная работа

Несколько анализов одновременно - каждый в своем worktree:
```
claude --worktree analysis-002
```

Состояния не пересекаются.

## Запреты

- НЕ пиши результаты в корень проекта - только в `<analysis_dir>/`. Иначе pre-commit отклонит.
- НЕ пропускай состояния - каждое `update-meta.sh` обязательно (транзитные состояния тоже фиксируются).
- НЕ ставь expected-маркеры на веер direction-scanner (шаг 5) - ломает hook. Одиночные вызовы (intake-analyst, audience-analyst, analysis-verifier, answer-extractor) - маркер ставится.
- НЕ вызывай Keyso-инструменты при tier=basic - ни в одном агенте (см. MCP_MAP.md).
- НЕ редактируй общие файлы (`ЗАКАЗЧИК.md`, `template.html`, `topics.xlsx`) - read-only из worktree.
- НЕ используй длинные и средние тире - только дефис (-).
- НЕ используй букву е-с-точками - всегда пиши е. Правило для всех клиентских текстов и метатегов (как и запрет тире).
- НЕ делай `git push` и не публикуй артефакты - это решение пользователя.
