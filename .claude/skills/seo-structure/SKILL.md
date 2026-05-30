---
name: seo-structure
description: Полный цикл построения структуры сайта на базе существующего предпроектного анализа. Читает analyses/NNN/, собирает мастер-список страниц через конкурентов, маркерные запросы, JM semantic_pack, топ-10 + каннибализация, генерирует A6.xlsx → клиенту → A6.md. Аргументы - <NNN> [--resume] [--review | --auto] [--import <xlsx>].
---

# seo-structure

Скил-оркестратор построения структуры сайта (артефакт A6: список целевых посадочных + маркер + топ-10 запросов на каждую + рекомендации по расширению + миграция). Запускается **в worktree-сессии**. Проходит state machine от чтения существующего анализа до финального A6.md.

## Аргументы

```
/seo-structure <NNN> [--resume] [--review | --auto] [--import <xlsx-path>]
```

- `NNN` - обязательный позиционный. Номер существующей папки `analyses/NNN-*/` от которой строим структуру. Если папки нет - стоп с подсказкой `/seo-analysis`.
- `--resume` - продолжить с того места, где остановились (по `meta.json` папки `structures/NNN-*/`).
- `--review` - режим с паузами после ключевых шагов (master-list, semantic-expander). По умолчанию `--auto` (без пауз). Полезно если расходуем JM-лимиты.
- `--auto` - самодостаточный режим (по умолчанию).
- `--import <path>` - короткий путь к шагу 6: пользователь вернулся с заполненным клиентом xlsx, нужно собрать A6.md. Эквивалент `/seo-structure <NNN> --resume` при `state == "awaiting-client"` или `"shared"`, плюс явное указание пути к файлу. Может быть абсолютным или относительным.

**Базовый режим - `--auto`.**

## Стыковка с `/seo-analysis`

Скил **обязательно** опирается на существующий анализ. Из `analyses/NNN/` читает:

- `brief.json` - `slug`, `keyso_base`, `domain`, `client_pages[]`, `assortment[]`, `client_target_queries[]`, `region` для определения кода Яндекса.
- `competitors.json` - `direct[]` (6-10 конкурентов с метриками), `leaders_top3[]`, `path`.
- `serp.json` - `stop_list[]` (домены-агрегаторы), `verdict.type`, `summary.dominant_intent`.
- `leader_scan.json` - `leaders[].pages[]` (для контекста рекомендаций по расширению), `summary.unique_features[]`.
- `A3.md` - проверка, что доменный стоп-лист консистентен с serp.json.

`brief.json.keyso_base` используется во всех вызовах Keyso. `competitors.json.direct[].domain` - источник конкурентов для сбора страниц. `serp.json.stop_list` - источник доменов для исключения при сборе маркеров.

Если нужного файла нет (например, анализ был с `--no-share` и без полного прогона) - скил выдаёт ошибку с подсказкой `/seo-analysis --resume <NNN>`.

## State machine

```
init -> master-list-done -> markers-done -> semantic-done ->
  top10-done -> xlsx-built -> [shared (если Drive есть)] ->
  awaiting-client -> client-imported -> completed
```

В `--review` режиме добавляются паузы после `master-list-done` (показать мастер-список, ждать OK) и `semantic-done` (показать сводку JM, ждать OK).

`meta.json` - единственный источник истины о состоянии. Обновляется через `bash .claude/hooks/update-meta.sh <structure_dir> <state>`.

## Артефакты

```
structures/NNN-<domain-slug>/
├── meta.json                  # state machine + drive_file_id + источник анализа
├── inputs.json                # snapshot: analysis_dir + slug + region + keyso_base + ссылки на JSON
├── master_list.json           # мастер-список страниц после спаривания
├── markers.json               # маркер + источник + частотность на каждую страницу
├── semantic_pack.json         # топ-30 JM на каждый маркер
├── top10.json                 # отфильтрованные топ-10 на каждую страницу
├── cannibalization.json       # список конфликтов + разрешения + рекомендации по расширению
├── decisions.json             # журнал авто-решений алгоритма (роль/синоним/блог/свёртка) + confidence
├── A6_<slug>.xlsx             # ФИНАЛ-1 (для клиента): 4 листа
├── client_filled.xlsx         # после шага --import (правленая клиентом версия)
├── structure_data.json        # машиночитаемый разбор client_filled.xlsx
├── A6.md                      # ФИНАЛ-2 (в проект для У5+): целевые + отложенные + рекомендации + миграция
└── share.json                 # ссылка Drive + drive_file_id + shared_at
```

## Алгоритм

### 0a. Проверка - мы в worktree

```bash
GIT_DIR=$(git rev-parse --git-dir)
COMMON_DIR=$(git rev-parse --git-common-dir)
```

Если `GIT_DIR == COMMON_DIR` - мы в main. Предупредить, не блокировать:
> ⚠️ Ты собираешь структуру в main-сессии. Pre-commit hook здесь не блокирует. Для многозадачности - закрой и переоткрой с галочкой worktree.

### 0b. Parse args

```
NNN = <обязательно, 3 цифры>
resume = true если --resume
mode = "review" если --review, иначе "auto"
import_path = <значение --import> или null
```

При `--resume` режим берётся из существующего `meta.mode`.

### 1. Setup

#### 1a. Найти существующий анализ

`analysis_dir = analyses/<NNN>-*/` - найти по NNN (glob). Если не найдено - стоп:
> Нет папки `analyses/<NNN>-*/`. Запусти `/seo-analysis` чтобы собрать предпроектный анализ (или укажи существующий номер).

**Валидация входа (схема, не «файл существует»).** Прогнать:

```
.claude\scripts\_node.cmd .claude\scripts\validate-analysis-inputs.mjs <analysis_dir>
```

- Exit 0 - канон-схема цела, продолжаем. Если в выводе строка `⚠ ВНИМАНИЕ: анализ реконструирован` - **запомнить** этот факт: surface его в стартовой сводке и передать в A6.md («структура построена на реконструированных данных»).
- Exit 2 - не хватает файлов/полей (скрипт печатает построчно чего нет, включая дрейф схемы вроде `target_queries_client` вместо `client_target_queries`). Стоп:
  > Анализ `<analysis_dir>` не в канон-схеме (см. список выше). Варианты: (1) `/seo-analysis --resume <NNN>`; (2) если только legacy A2.md - дособрать канон-JSON вручную по образцу `structures/001-*/`.
- Exit 1 - ошибка запуска (нет директории / битый JSON) - показать stderr, стоп.

`leader_scan.json` опциональный (используется только для рекомендаций) - его отсутствие не блокирует (скрипт лишь предупреждает).

Извлечь:
- `slug = brief.slug`
- `domain = brief.domain` (может быть null)
- `keyso_base = brief.keyso_base`
- `region_yandex` - код Яндекса по `brief.region`. **Guard от country-кода:** источник `suggest` в `jm_semantic_pack` отклоняет country-level коды (`225` Россия, `0`, `null`) с ошибкой `ya_lr_err`. Поэтому:
  - Если регион - конкретный город из стандартного списка (Москва=213, СПб=2, Екб=54, Краснодар=35, Минск=157, и т.д.) - бери его код.
  - Если регион федеральный / «Россия» / «Россия + <страна>» / не определяется до города - **НЕ ставить 225/0**, ставить дефолт-город `213` (Москва) и записать `note_region` в inputs.json: «Регион федеральный (`<region>`); 225/0 ломают источник Sug в JM, взят 213 для оценки рынка».
  - Если город не в стандартном списке - один раз `mcp_wordstat_get_regions_tree` и найти код города; если и там только страна - дефолт 213 + `note_region`.
  - **Тип:** `region_yandex` записывать в inputs.json **числом** (`213`), не строкой (`"213"`) - JM-tool ждёт integer.

#### 1b. Если `--resume` ИЛИ `--import`

- Найти существующую `structures/<NNN>-*/`. Если несколько кандидатов - спросить пользователя.
- Прочитать `meta.json`. `state = meta.state`.
- Если `--import` передан и state `awaiting-client` / `shared` - сразу к шагу 6 (импорт).
- Если `--resume` - спросить «Найдено в state `<state>`, обновлено `<updated>`. Продолжить? [Y/n]» (в `--auto` - без вопроса, продолжать).
- Перейти к ветке от следующего шага после `state`.

#### 1c. Если фрэш-старт

1. Создать папку `structures/<NNN>-<slug>/`.
2. Записать `.claude/tmp/current-task.txt = structures/<NNN>-<slug>/` **(критично - без этого pre-commit hook откажет в коммите)**.
3. Записать `<structure_dir>/inputs.json`:

```json
{
  "analysis_dir": "analyses/<NNN>-<slug>/",
  "slug": "<slug>",
  "domain": "<domain>|null",
  "keyso_base": "<keyso_base>",
  "region_yandex": 213,
  "region_name": "<region>",
  "note_region": "<пусто, либо причина guard-замены на 213 для федерального региона>",
  "analysis_reconstructed": false,
  "competitors_source": "analyses/<NNN>-<slug>/competitors.json",
  "stop_list_source": "analyses/<NNN>-<slug>/A3.md"
}
```

> `region_yandex` - **число** (не строка). `analysis_reconstructed` - `true` если валидатор сообщил о `_import_meta` (см. 1a); потребляется `structure-writer` для пометки в A6.md.

4. Создать `meta.json`:

```json
{
  "slug": "<slug>",
  "analysis_nnn": "<NNN>",
  "state": "init",
  "mode": "<auto|review>",
  "completed_steps": [],
  "started": "<ISO UTC>",
  "updated": "<ISO UTC>"
}
```

5. `state = "init"`. Переход к шагу 2.

### 2. Мастер-список страниц (если state == "init")

Маркер: `.claude/tmp/expected-master-list-builder-<run_id>.txt = <structure_dir>/master_list.json`

Делегировать `master-list-builder`:
```
structure_dir: <structure_dir>
analysis_dir: <analysis_dir>
project_root: <project root>

Прочитай brief.json + competitors.json из analysis_dir. Собери страницы конкурентов через domain_pages, типизируй (с web_fetch для спорных), нормализуй (объединение синонимов), дополни из brief.assortment. Если brief.domain не null и есть данные - сделай спаривание с client_pages + domain_pages клиента. Сохрани master_list.json.
```

После завершения:
- `bash .claude/hooks/update-meta.sh <structure_dir> master-list-done`
- Сводка в чат: количество страниц, распределение по типам, было ли спаривание.
- **В `--review`** - пауза с сообщением:
  > Мастер-список готов: `<N>` страниц. Проверь перед расходом JM-лимитов. ОК продолжить? [Y/n - есть правки]
  Если правки - применить через Edit или повторно делегировать с пометкой.
- **В `--auto`** - переход к шагу 3 без паузы.

### 3. Маркерные запросы (если state == "master-list-done")

Маркер: `.claude/tmp/expected-marker-finder-<run_id>.txt = <structure_dir>/markers.json`

Делегировать `marker-finder`:
```
structure_dir: <structure_dir>
analysis_dir: <analysis_dir>
project_root: <project root>

Прочитай master_list.json (с полем id) + brief.json (для keyso_base) + competitors.json (для лидеров и доменов). Для каждой страницы (кроме информационных) определи маркер через каскад: domain_keywords(лидер) -> domain_keywords(остальные конкуренты) -> keyword_info -> keyword_similar -> ручное. Если Keyso не даёт данных - резерв jm_wordstat (пакетно) или wk_check_frequency (массово). Проверь коммерциализацию (arsenkin_commerce). info_dominant без синонима 1:1 - НЕ сваливай на клиента: переназначь role=umbrella, инфо-запрос в блог, коммерцию на страницу-дом, запиши всё в decisions.json (идемпотентно по id). Протяни id из master_list. Сохрани markers.json + decisions.json.
```

После завершения:
- `bash .claude/hooks/update-meta.sh <structure_dir> markers-done`
- Сводка: сколько маркеров найдено через основной путь / фолбэки / ручное.
- Переход к шагу 4.

### 4. Расширение семантики через JM (если state == "markers-done")

Маркер: `.claude/tmp/expected-semantic-expander-<run_id>.txt = <structure_dir>/semantic_pack.json`

Делегировать `semantic-expander`:
```
structure_dir: <structure_dir>
analysis_dir: <analysis_dir>
project_root: <project root>

Прочитай markers.json + inputs.json (для region_yandex). Проверь баланс JM через jm_account. Оцени стоимость. Прогони region-guard (country-код 225/0 -> 213). Запусти jm_semantic_pack ПАКЕТАМИ по 12-15 маркеров (не один монолит на 40+ - словишь MCP-таймаут; не по одному - расточительно), top_n=30, with_topics=false. При таймауте пакета - ретрай, потом деградация источников с явным degraded:true. Для запросов без частотности - резерв (jm_wordstat или wk_check_frequency). Сохрани semantic_pack.json.
```

После завершения:
- `bash .claude/hooks/update-meta.sh <structure_dir> semantic-done`
- Сводка: маркеров отправлено / пакетов / успешных / без результатов / общее количество запросов.
- **Гейт деградации (не пропускать молча).** Прочитать `semantic_pack.json`. Если `degraded == true` ИЛИ у ВСЕХ страниц `freq_exact` пуст (полный провал частотности) - это **точка решения**, не успех:
  - Записать событие: `bash .claude/hooks/update-meta.sh <structure_dir> semantic-done degraded="<degraded_reason из semantic_pack.json>"`.
  - В `--review` - пауза: «JM деградировал (`<причина>`). Источники урезаны/частотность неполна. Принять как есть или ретрай полного набора? [принять/ретрай]».
  - В `--auto` - продолжить, но degraded-флаг ОБЯЗАН дойти до A6.md (structure-writer пометит «структура частично на деградированных JM-данных»). Не выдавать за чистый успех.
- **В `--review`** (если не деградация) - пауза:
  > JM-расширение завершено. Перед фильтрацией - проверь сводку. ОК? [Y/n]
- **В `--auto`** - переход к шагу 5.

### 5. Топ-10 + каннибализация (если state == "semantic-done")

#### 5a. Скрипт-фильтрация

```
.claude\scripts\_node.cmd .claude\scripts\select-top10.mjs <structure_dir>
```

Скрипт читает `semantic_pack.json` + `markers.json` + `analyses/NNN/A3.md` (бренды-конкуренты для фильтра), фильтрует и отбирает топ-10 на каждую страницу, детектит дубли между страницами.

Записывает:
- `top10.json` - топ-10 на страницу (отфильтрованный)
- `cannibalization.json` - список конфликтов + альтернативы из топ-30

Exit 0 - готово. Exit 1 - что-то критичное (например, ни одна страница не получила маркер).

#### 5b. Агент разруливания

Маркер: `.claude/tmp/expected-cannibalization-resolver-<run_id>.txt = <structure_dir>/cannibalization.json`

Делегировать `cannibalization-resolver`:
```
structure_dir: <structure_dir>
analysis_dir: <analysis_dir>
project_root: <project root>

Прочитай top10.json + cannibalization.json (с конфликтами и альтернативами) + master_list.json + leader_scan.json (если есть) + decisions.json (если есть). Разреши каждый конфликт по правилам "ближе по смыслу к маркеру". Сформулируй рекомендации по расширению. Раздели: SEO-механику (расщепление/свёртка низкочастоток/добавление под запрос конкурента) - в decisions.json (kind add_page/split_page/merge_lowfreq, confidence low) + recommendations[]; бизнес-реальность (производит ли клиент?) - флагом business_flag клиенту. master_list НЕ переписывай (журнал = решение в данных). Обнови top10.json + cannibalization.json + допиши decisions.json (идемпотентно по id).
```

После завершения:
- `bash .claude/hooks/update-meta.sh <structure_dir> top10-done`
- Сводка: разрешённых конфликтов / рекомендаций по расширению / страниц без полного топ-10 / решений в журнал.
- **Аудит low-confidence (`--review`).** Прочитать `decisions.json`. Если есть решения с `confidence == "low"` (структурные - роль/расщепление/свёртка) - в `--review` пауза: «Алгоритм принял `<N>` структурных решений (`<список kind:page_id>`). Они применены (как требует автономный режим), но помечены low-confidence. Принять / поправить? [принять/правки]». В `--auto` - продолжить, они уйдут в A6.md отдельным списком «проверить при желании».
- Переход к шагу 6.

### 6. Сборка A6.xlsx (если state == "top10-done")

```
.claude\scripts\_node.cmd .claude\scripts\build-structure-xlsx.mjs <structure_dir>
```

Скрипт читает `inputs.json` + `master_list.json` + `top10.json` + `cannibalization.json` + `analyses/NNN/competitors.json` и собирает `A6_<slug>.xlsx` с 4 листами: «Структура», «Рекомендации», «Конкуренты», «Миграция».

`bash .claude/hooks/update-meta.sh <structure_dir> xlsx-built`

Переход к шагу 7 (Drive).

### 7. Upload в Drive (если state == "xlsx-built")

#### 7a. Прочитать DRIVE.md

`~/.claude/seo-knowledge/DRIVE.md` -> извлечь `structures_folder_id`.

**Если файла нет, поля нет, или значение равно `TODO_СОЗДАЙ_ПАПКУ_В_DRIVE`** - не блокировать, а скипнуть с предупреждением:
```
bash .claude/hooks/update-meta.sh <structure_dir> xlsx-built skip_reason="Drive upload: в DRIVE.md нет валидного structures_folder_id (либо TODO). Создай папку «Структуры» в Drive с правами anyone-with-link -> reader, подставь ID в DRIVE.md, затем /share-structure <NNN>."
```
Перейти к шагу 8 (`awaiting-client`), оставить локальный xlsx для ручной отправки клиенту.

#### 7b. Загрузка

```
mcp__gdrive-piotr__uploadFile(
  localPath: <абс путь к A6_<slug>.xlsx>,
  name: A6_<slug>,
  parentFolderId: <structures_folder_id>,
  mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  convertToGoogleFormat: true
)
```

Если упало с конверсией - fallback `convertToGoogleFormat: false`, добавить в сводку:
> ⚠️ Залит как .xlsx (Google Sheets API не активна). Активируй в Google Cloud Console, потом `/share-structure <NNN> --redo`.

Сохранить `id`, `link`.

#### 7c. Записать share.json

```json
{
  "drive_file_id": "<id>",
  "drive_link": "<link>",
  "mime_type": "application/vnd.google-apps.spreadsheet" | "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "shared_at": "<ISO UTC>",
  "revisions": []
}
```

`bash .claude/hooks/update-meta.sh <structure_dir> shared`

### 8. Ждать клиента (state == "shared" или "xlsx-built" со skip)

`bash .claude/hooks/update-meta.sh <structure_dir> awaiting-client`

Вывести пользователю:

```
═══ A6.XLSX ГОТОВ ═══

📊 Google Sheet для клиента (если шаг 7 успешен):
   <drive_link>

📌 Локальный xlsx (резерв):
   <structure_dir>/A6_<slug>.xlsx

Клиент заполняет колонку «Целевая?» (да / нет / обсудить) и возвращает файл.

Когда вернётся:
  /seo-structure <NNN> --import <путь-к-возврщённому-xlsx>
═════════════════════════
```

**Не выходить из сессии. Стоп для пользователя.**

### 9. Импорт от клиента (state == "awaiting-client" + --import <path>)

#### 9a. Положить файл в task-dir

Прочитать `--import <path>` (может быть абсолютным или относительным). Скопировать в `<structure_dir>/client_filled.xlsx`. Если файла нет - стоп с сообщением.

#### 9b. Распарсить xlsx -> JSON

```
.claude\scripts\_node.cmd .claude\scripts\import-structure.mjs <structure_dir>
```

Скрипт читает `client_filled.xlsx`, парсит лист «Структура», разделяет строки по колонке «Целевая?» (да / нет / обсудить), сохраняет `structure_data.json`.

Если есть строки «обсудить» - выводит их и **возвращает exit 3**. Скил спрашивает пользователя:
> Клиент пометил «обсудить» по `<N>` страницам: `<список>`. Включить или отложить?

После решения - переписать `structure_data.json` через Edit (поле `target_status: "yes"|"deferred"` для каждой такой страницы).

Если колонка «Целевая?» полностью пустая - скрипт возвращает exit 4. Скил спрашивает:
> Клиент не заполнил «Целевая?» ни по одной странице. Считать все целевыми? [Y/n - открыть xlsx и попросить заполнить]

Если N - стоп, выйти с сообщением «Дозаполни xlsx и запусти заново».

**Проверка «нетронутого файла» (exit 0, но все «да»).** Колонка предзаполнена «да» по умолчанию. Если после парсинга `stats.yes == stats.total` (ни одной «нет»/«обсудить») - возможно клиент вернул файл, не глядя. НЕ трактуй молча как «всё целевое»:
> Клиент вернул файл со всеми «да» (это значение по умолчанию). Он реально просмотрел структуру и подтверждает все `<N>` страниц - или файл нетронут? [подтверждено / переспросить клиента]

В `--auto` - продолжить, но отметить в сводке «все целевые приняты по умолчанию (клиент не вносил правок)».

#### 9c. Собрать A6.md

Маркер: `.claude/tmp/expected-structure-writer-<run_id>.txt = <structure_dir>/A6.md`

Делегировать `structure-writer`:
```
structure_dir: <structure_dir>
analysis_dir: <analysis_dir>
project_root: <project root>

Прочитай structure_data.json + cannibalization.json + master_list.json + inputs.json + decisions.json (если есть) + semantic_pack.json (для degraded) + analyses/NNN/A3.md. Собери A6.md по фиксированному шаблону - шапка проекта + Замечания прогона (реконструкция/регион/деградация/спаривание) + Целевые + Рекомендации + Наши SEO-решения (журнал, low-confidence отдельным чек-листом) + Конкуренты + Миграция + Отложенные (с причинами).
```

После завершения:
- `bash .claude/hooks/update-meta.sh <structure_dir> client-imported`
- Переход к шагу 10.

### 10. Финал (state == "client-imported")

`bash .claude/hooks/update-meta.sh <structure_dir> completed`

Финальный коммит:
```bash
git add -A
git commit -m "Structure <NNN> for <slug>: A6 ready (<N> target pages, <M> deferred)"
```

Вывести:
```
═══ СТРУКТУРА A6 ГОТОВА ═══

Клиент: <domain или slug>
Страниц целевых: <N>
Страниц отложенных: <M>
Конфликтов разрешено: <K>
Рекомендаций по расширению: <R>

📊 Google Sheet для клиента (заполненный):
   <drive_link если есть>

📌 Локальные артефакты:
   <structure_dir>/A6.md                  ← основной артефакт для У5 (ТЗ верстальщика)
   <structure_dir>/A6_<slug>.xlsx         ← исходный
   <structure_dir>/client_filled.xlsx     ← правленый клиентом
   <structure_dir>/structure_data.json    ← машиночитаемый
   <structure_dir>/cannibalization.json   ← разрешения каннибализации

✅ Готово к /handoff (перенесёт в main).
═══════════════════════════
```

## Параллельная работа

Несколько структур одновременно - каждая в своём worktree. Состояния не пересекаются.

## Обработка временных API-ошибок

Любой вызов субагента может вернуть `529 Overloaded` / `503` / `rate_limit_error`. Поведение - как в `/write-article`: ловить, `ScheduleWakeup` на 90 секунд с тем же `/seo-structure <NNN> --resume`. Максимум 3 попытки.

## Запреты

- НЕ запускай без существующего `analyses/NNN-*/` - всегда нужен предпроектный анализ.
- НЕ пиши в корень проекта - только в `<structure_dir>/`. Pre-commit отклонит.
- НЕ пропускай состояния - каждое `update-meta.sh` обязательно.
- НЕ редактируй общие файлы (`ЗАКАЗЧИК.md`, `template.html`, `topics.xlsx`) - read-only из worktree.
- НЕ редактируй файлы в `analyses/NNN/` - они read-only для этого скила (только чтение).
- НЕ используй длинное тире (—) и среднее (–). Только дефис (-).
- НЕ запускай `/write-article`, `/strategy`, `/seo-analysis`, `/new-topics` из этой же сессии - отдельные worktree-задачи.
