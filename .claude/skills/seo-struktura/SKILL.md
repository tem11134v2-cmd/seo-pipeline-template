---
name: seo-struktura
description: Полный цикл построения структуры сайта на базе контракта предпроектного анализа sites/NNN-<slug>/project.json (только tier=seo). Тир-гейт скриптом, SEO-база внутренним шагом (конкуренты с метриками Keyso, SERP-вердикт, стоп-лист), мастер-список страниц через конкурентов, маркерные запросы, JM semantic_pack, топ-10 + каннибализация, генерирует A6.xlsx → клиенту → A6.md. Аргументы - <NNN|slug> [--resume] [--review | --auto] [--import <xlsx>].
---

# seo-struktura

Скил-оркестратор построения структуры сайта (артефакт A6: список целевых посадочных + маркер + топ-10 запросов на каждую + рекомендации по расширению + миграция). Запускается **в worktree-сессии**. Проходит state machine от чтения контракта анализа до финального A6.md.

## Аргументы

```
/seo-struktura <NNN|slug> [--resume] [--review | --auto] [--import <xlsx-path>] [--metatags deep|bulk|none]
```

- `NNN|slug` - обязательный позиционный. Номер или слаг проекта анализа `sites/NNN-<slug>/` (можно и путь к каталогу). Структура строится на его `project.json`. Нет проекта - стоп с подсказкой `/site-analiz`.
- **Режима доделки старых структур на `analyses/` нет:** вход только `sites/NNN-<slug>/project.json`; `--resume` продолжает лишь структуры, начатые на нем (в `meta.json` есть `project_path`).
- `--resume` - продолжить с того места, где остановились (по `meta.json` папки `structures/NNN-<slug>/`).
- `--review` - режим с паузами после ключевых шагов (seo-base, master-list, semantic-expander). По умолчанию `--auto` (без пауз). Полезно если расходуем JM-лимиты.
- `--auto` - самодостаточный режим (по умолчанию).
- `--import <path>` - короткий путь к шагу 9: пользователь вернулся с заполненным клиентом xlsx, нужно собрать A6.md. Эквивалент `/seo-struktura <NNN> --resume` при `state == "awaiting-client"` или `"shared"`, плюс явное указание пути к файлу. Может быть абсолютным или относительным.
- `--metatags deep|bulk|none` - **хвост метатегов** после утверждения структуры (шаг 11). По умолчанию `deep` (в `--auto` запускается автоматически, в `--review` - спросит). `bulk` - быстрый прогон по PLAYBOOK без анализа выдачи. `none` - не генерировать метатеги. Метатеги пишутся в отдельную папку `metatags/<NNN>-<slug>/` тем же движком, что и скил `/seo-metategi`.

**Базовый режим - `--auto`.**

## Вход: project.json анализа

Скил **обязательно** опирается на контракт анализа v8 `sites/NNN-<slug>/project.json` (его собирает `/site-analiz`, схема - `.claude/skills/site-analiz/project.schema.json`). Структура читает контракт, но никогда в него не пишет: схема закрыта, контракт стоит за гейтом заказчика. Расхождения (например, список конкурентов) печатаются в A6.md.

| Поле project.json | Кто читает | Зачем |
|---|---|---|
| `slug`, `tier` | `validate-project-input.mjs` | имя папки, сверка тарифа (источник тарифа - `queue.json.tier`) |
| `business.region`, `business.site`, `business.type` | `validate-project-input.mjs` -> `inputs.json` | `keyso_base`, `region_yandex`, `domain`, 2 или 3 уровня меню |
| `business.what`, `business.assortment[]`, `business.directions[]` | seo-base, master-list-builder, marker-finder, cannibalization-resolver, structure-writer | запросы выдачи, своя ниша, добор страниц, маркер главной, «Ниша» в шапке A6 |
| `business.client_pages[]` | master-list-builder | старт спаривания |
| `constraints.not_selling[]` | seo-base, master-list-builder, cannibalization-resolver | чего клиент не продает |
| `competitors.list[]` | seo-base | семя конкурентов (метрики и добор - внутри seo-base) |
| `business.name` | structure-writer, хвост метатегов | заголовок A6, бренд |
| `offer.reasons[]`, `constraints.forbidden[]` | хвост метатегов (шаг 11b) | УТП и запреты Description |

**SEO-слой - внутренний шаг структуры (1d, агент `seo-base`),** в контракте анализа его нет намеренно: база Keyso и регион считает скрипт шага 1a, конкуренты с метриками, SERP-вердикт и стоп-лист пишутся в папку структуры (`competitors.json`, `serp.json`, `stop_list.md`) и дальше читаются только оттуда.

**Тир-гейт:** структура строится только при купленном SEO (`queue.json.tier == seo`). Проверяет скрипт на шаге 1a до создания папки и до первого MCP-вызова; флага обхода нет. Без SEO состав страниц пишет планировщик анализа.

**Номер:** `NNN` структуры зеркалит номер проекта `sites/NNN-<slug>/`; папка - `structures/<NNN>-<slug>/`.

## State machine

```
init -> seo-base-done -> master-list-done -> markers-done -> semantic-done ->
  top10-done -> xlsx-built -> [shared (если Drive есть)] ->
  awaiting-client -> client-imported -> structure-verified -> completed
                                                                └─[хвост, шаг 11]→ метатеги в metatags/<NNN>/
```

В `--review` режиме добавляются паузы после `seo-base-done` (показать конкурентов и вердикт), `master-list-done` (показать мастер-список, ждать OK) и `semantic-done` (показать сводку JM, ждать OK).

Структура завершается на `completed`. Если `--metatags` != `none`, при `completed` ставится `meta.metatags_pending = <deep|bulk>`, и шаг 11 запускает движок метатегов как **отдельную задачу** в `metatags/<NNN>-<slug>/` (со своей `meta.json`). Так сделано из-за порядка коммитов: структура коммитится первой под своей task-dir, потом `current-task.txt` переключается на метатеги (см. шаг 11 и [ADR-012](../../../docs/adr/012-metatags-task-type.md)).

`meta.json` - единственный источник истины о состоянии. Обновляется через `bash .claude/hooks/update-meta.sh <structure_dir> <state>`.

## Артефакты

```
structures/NNN-<slug>/
├── meta.json                  # state machine + drive_file_id + ссылка на контракт анализа (project_path)
├── inputs.json                # вывод validate-project-input.mjs: project_path + slug + domain + keyso_base + region_yandex + tier_lagging + project_gate
├── competitors.json           # seo-base: 6-10 конкурентов с метриками Keyso + leaders_top3 + list_check (сверка со списком анализа)
├── serp.json                  # seo-base: выдача по маркерам направлений + verdict.type + stop_list с причинами
├── stop_list.md               # seo-base: стоп-лист доменов (формат прежнего A3.md, домен на строку)
├── master_list.json           # мастер-список страниц после спаривания + группировка (use_sections/sections/section/category) + competitor_url_depth + url_nesting_recommendation
├── markers.json               # маркер + источник + частотность на каждую страницу
├── semantic_pack.json         # топ-30 JM на каждый маркер
├── top10.json                 # отфильтрованные топ-10 на каждую страницу (с копией section + category на странице)
├── cannibalization.json       # список конфликтов + разрешения + рекомендации по расширению
├── decisions.json             # журнал авто-решений алгоритма (роль/синоним/блог/свёртка) + confidence
├── A6_<slug>.xlsx             # ФИНАЛ-1 (для клиента): 4 листа (лист «Структура» с колонками «Раздел» + «Категория»)
├── client_filled.xlsx         # после шага --import (правленая клиентом версия)
├── structure_data.json        # машиночитаемый разбор client_filled.xlsx
├── A6.md                      # ФИНАЛ-2 (в проект для У5+): целевые + отложенные + рекомендации + Архитектура меню (шапка) + Блок перелинковки в шапке + миграция
└── share.json                 # ссылка Drive + drive_file_id + shared_at
```

**Поля иерархии в `master_list.json`** (продюсер - `master-list-builder`; консьюмеры - `build-structure-xlsx`, `import-structure`, `select-top10`, `structure-writer`):

- `use_sections` (bool): группировка включена. ВСЕГДА true когда целевых страниц >= 5 и есть хотя бы 1 осмысленная ось группировки; false только для совсем плоского мелкого набора (< 5 страниц или нет осей).
- `sections` (array, top-level): определения разделов/хабов (верхний уровень меню шапки), формат `[{ "id", "name", "axis", "note" }]`.
- per-page `section` (string): раздел (хаб) страницы; заполняется ВСЕГДА когда use_sections=true. (Существующее поле - читают xlsx и import.)
- per-page `category` (string, опц.): третий уровень для ТОВАРНЫХ сайтов (подкатегория внутри раздела). Для услуг обычно "".
- `competitor_url_depth` (object, top-level): анализ вложенности URL конкурентов из domain_pages - `{ "median_segments", "dominant_pattern": "flat"|"one_level"|"two_level"|"deep", "examples": [...], "note" }`.
- `url_nesting_recommendation` (object, top-level): `{ "mode": "flat"|"nested", "rationale", "migration_needed" }`. mode="nested" (с 301-миграцией) только когда конкуренты явно вкладывают (dominant_pattern two_level/deep) и сайт новый/малый/низкий риск; иначе "flat" (группировка только в шапке + перелинковка, URL не трогаем).

Совместимость - новые колонки/поля парсятся с -1 guard (как существующий COL_SECTION); `top10.json` копирует `section` и `category` в каждую страницу.

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
target = <обязательно: номер NNN, слаг или путь sites/NNN-<slug>>
resume = true если --resume
mode = "review" если --review, иначе "auto"
import_path = <значение --import> или null
metatags_depth = значение --metatags (deep|bulk|none); если флага нет -> "deep"
```

При `--resume` режим берётся из существующего `meta.mode`. Если пользователь в сообщении просил «быстро / по-быстрому / дёшево / пакетно» и `--metatags` не задан явно - `metatags_depth = "bulk"`.

### 1. Setup

#### 1a. Вход и тир-гейт (скрипт, до папки и до первого MCP)

```
.claude\scripts\_node.cmd .claude\scripts\validate-project-input.mjs <target>
```

Скрипт находит `sites/NNN-<slug>/` (по номеру, слагу или пути), проверяет тир-гейт по `queue.json.tier`, прогоняет `project.json` через схему анализа, проверяет непустые `business.region`, `business.type` и `business.assortment` или `business.directions`, вычисляет `keyso_base` (20 баз Keyso, вне таблицы - `msk` с `note_keyso`), `region_yandex` (зашитый список городов; федеральный или неизвестный регион - `213` с `note_region`, коды 225/0 не ставятся никогда, тип - число) и `domain` из `business.site` (хост, IDN в кириллице; соцсеть или площадка - `null`). В stdout - JSON для `inputs.json`, в stderr - отчет.

- **Exit 0** - вход годен. Из отчета **запомнить** и показать в стартовой сводке строки `!`:
  - «tier в контракте отстал» (`tier_lagging: true`) - SEO докуплено после сборки контракта; идем по ответу оператора, пометка уйдет в A6.md;
  - «контракт анализа не согласован» (`project_gate: false`) - предупреждение, не блок: у структуры свой гейт заказчика (A6.xlsx), но состав направлений еще может поменяться; пометка уйдет в A6.md;
  - `site_kind=landing`, `business.site` на площадке - сверить с пользователем в `--review`, в `--auto` продолжить.
- **Exit 2** - вход не годится, стоп с текстом скрипта. Сюда же относится тир-гейт: SEO не куплено (`queue.json.tier=basic`) или тарифа в `queue.json` нет - структура не строится, подсказка скрипта: `queue.mjs init <slug> --tier seo` после докупки. Флага обхода нет; без SEO состав страниц пишет планировщик анализа. Сломанный контракт чинится в `/site-analiz`, не руками в структуре.
- **Exit 1** - ошибка запуска (битый JSON, нет схемы) - показать stderr, стоп.

Из JSON запомнить `structure_dir` (`structures/<NNN>-<slug>/`), `nnn`, `slug`, `project_path`.

#### 1b. Если `--resume` ИЛИ `--import`

- Папка - `structure_dir` из 1a. Нет папки - стоп: «Структуры `<structure_dir>` нет, запусти без `--resume`».
- Прочитать `meta.json`. **Нет `project_path` в meta** (структура начата на `analyses/NNN` до v8) - стоп: «Структура `<structure_dir>` начата на старом входе analyses/, доделка не поддерживается. Перенесите или переименуйте старую папку и запустите `/seo-struktura <NNN>` без `--resume`».
- `state = meta.state`. `inputs.json` не переписывать (это снимок, на котором собраны прошлые шаги). Если в выводе 1a `keyso_base`, `region_yandex` или `domain` разошлись с `inputs.json` - контракт поменялся после старта: сказать пользователю и спросить, продолжать ли на старом снимке (в `--auto` - продолжить и отметить в сводке).
- Если `--import` передан и state `awaiting-client` / `shared` - сразу к шагу 9 (импорт).
- Если `--resume` - спросить «Найдено в state `<state>`, обновлено `<updated>`. Продолжить? [Y/n]» (в `--auto` - без вопроса, продолжать).
- **Если state `completed` И `meta.metatags_pending` ∈ {deep, bulk}** - структура готова, но хвост метатегов не доведён. Перейти к шагу 11 (он сам проверит, есть ли уже `metatags/<NNN>-*/`, и доделает через движок; если метатеги уже `completed` - сообщить «всё готово»).
- **Маршрутизация:** state `init` -> шаг 1d (SEO-база); state `client-imported` -> шаг 9г (гейты еще не пройдены); state `structure-verified` -> шаг 10 (оба гейта уже пройдены).
- Перейти к ветке от следующего шага после `state`.

#### 1c. Если фрэш-старт

1. Если `structure_dir` уже есть - спросить пользователя (продолжить через `--resume` или переименовать старую папку); молча не перезаписывать.
2. Записать `.claude/tmp/current-task.txt = <structure_dir>` **(критично - без этого pre-commit hook откажет в коммите)**.
3. Записать `inputs.json` тем же скриптом (папка создается сама):

```
.claude\scripts\_node.cmd .claude\scripts\validate-project-input.mjs <target> --out <structure_dir>/inputs.json
```

Форма (руками не правится и не дописывается):

```json
{
  "project_path": "sites/<NNN>-<slug>/project.json",
  "site_dir": "sites/<NNN>-<slug>/",
  "nnn": "<NNN>",
  "slug": "<slug>",
  "structure_dir": "structures/<NNN>-<slug>/",
  "domain": "<domain>|null",
  "keyso_base": "spb",
  "city_not_in_keyso": false,
  "note_keyso": "",
  "region_yandex": 2,
  "region_name": "<business.region>",
  "note_region": "",
  "business_type": "services",
  "site_kind": "multipage",
  "tier": "seo",
  "tier_lagging": false,
  "project_gate": true,
  "competitors_source": "structures/<NNN>-<slug>/competitors.json",
  "serp_source": "structures/<NNN>-<slug>/serp.json",
  "stop_list_source": "structures/<NNN>-<slug>/stop_list.md"
}
```

> `analysis_dir` в `inputs.json` больше нет: его место занял `project_path`. Потребители (`/seo-metategi --from-structure`, хвост шага 11) берут контракт по нему.

4. Создать `meta.json`:

```json
{
  "slug": "<slug>",
  "site_nnn": "<NNN>",
  "project_path": "sites/<NNN>-<slug>/project.json",
  "state": "init",
  "mode": "<auto|review>",
  "completed_steps": [],
  "started": "<ISO UTC>",
  "updated": "<ISO UTC>"
}
```

5. `state = "init"`. Переход к шагу 1d.

#### 1d. SEO-база (если state == "init")

Маркер: `.claude/tmp/expected-seo-base-<run_id>.txt = <structure_dir>/competitors.json`

Делегировать `seo-base`:
```
structure_dir: <structure_dir>
project_root: <project root>

Прочитай inputs.json структуры и контракт анализа по inputs.project_path (только чтение). Собери конкурентов: competitors.list анализа + выдача keyword_info по маркерам направлений, добор domain_competitors только если после фильтра меньше 6 доменов; отфильтруй агрегаторы, маркетплейсы, инфопорталы и чужие ниши; метрики domain_dashboard по каждому; типы, 6-10 финальных и топ-3 лидера. Сведи выдачу в вердикт (словарь: ИДЕМ / КОРРЕКТИРУЕМ ТИП САЙТА / МЕНЯЕМ СТРАТЕГИЮ - инфоконтент / ИДЕМ С ОГОВОРКАМИ) и стоп-лист. Запиши competitors.json, serp.json и stop_list.md в structure_dir. Бюджет - не больше 25 MCP-вызовов (MCP_MAP.md, раздел seo-base). project.json не меняй.
```

После завершения:
- Проверить, что есть все три файла и `competitors.json.direct[]` непуст. Пустой `direct[]` - стоп: страниц собрать не с кого, показать сводку seo-base пользователю.
- `bash .claude/hooks/update-meta.sh <structure_dir> seo-base-done`
- Сводка в чат: конкурентов (сколько из списка анализа вошло, добор был или нет), топ-3 лидера, вердикт, доменов в стоп-листе. Меньше 6 конкурентов - отметить.
- **Вердикт не `ИДЕМ`** - показать его строкой сводки seo-base. В `--review` - пауза: «Вердикт по выдаче `<тип>`: <что это меняет>. Строим структуру с этим учетом? [Y/n]». В `--auto` - продолжить, вердикт дойдет до A6.md и до проверки `structure-verifier`.
- Переход к шагу 2.

### 2. Мастер-список страниц (если state == "seo-base-done")

Маркер: `.claude/tmp/expected-master-list-builder-<run_id>.txt = <structure_dir>/master_list.json`

Делегировать `master-list-builder`:
```
structure_dir: <structure_dir>
project_root: <project root>

Прочитай inputs.json + competitors.json из structure_dir (конкуренты - выход seo-base) и контракт анализа по inputs.project_path (только чтение). Собери страницы конкурентов через domain_pages, типизируй (seo_fetch_page для спорных), нормализуй (объединение синонимов), дополни из business.directions и business.assortment контракта; constraints.not_selling - не кандидаты. Если inputs.domain не null и есть данные - сделай спаривание с business.client_pages + domain_pages клиента. Сохрани master_list.json.

Дополнительно (всегда):
- Проанализируй вложенность URL конкурентов из УЖЕ полученных domain_pages (счёт сегментов пути, без доп. MCP-вызовов) и запиши top-level объект `competitor_url_depth`: { "median_segments": <число>, "dominant_pattern": "flat"|"one_level"|"two_level"|"deep", "examples": ["competitor.ru/razdel/usluga", ...], "note": "<сколько из N конкурентов вкладывают по шаблону /razdel/usluga>" }.
- Сгруппируй страницы в хабы/разделы/категории ВСЕГДА (для шапки сайта и блока перелинковки), даже если в нише принято делать плоские URL. Группировка отдельно от решения о вложенности самих URL.
  - `use_sections` (bool): включай ВСЕГДА, когда целевых страниц >= 5 и есть хотя бы 1 осмысленная ось группировки. `false` только для совсем плоского мелкого набора (< 5 страниц или нет осей). Прежний гейт ">= 12 страниц" не применяй.
  - top-level `sections` (array): [{ "id": "uslugi", "name": "Услуги ремонта", "axis": "тип услуги", "note": "..." }] - определения разделов/хабов (верхний уровень меню шапки). Формат сохрани.
  - per-page `section` (string): name/id раздела (хаба) страницы. Заполняй ВСЕГДА когда use_sections=true. Существующее поле - НЕ переименовывай (его читают xlsx и import).
  - per-page `category` (string, опц.): третий уровень для ТОВАРНЫХ сайтов (подкатегория внутри раздела). Для услуг обычно "" (пусто).
  - Уровни по типу сайта (авто по inputs.business_type): Услуги - 2 уровня раздел(hub) -> страница (category пусто); Товары - 3 уровня каталог/раздел(hub) -> категория -> товар (используется category).
- Запиши top-level объект `url_nesting_recommendation`: { "mode": "flat"|"nested", "rationale": "...", "migration_needed": <bool> }. Политика: группировка в шапке ВСЕГДА; mode="nested" (с рекомендацией 301-миграции, migration_needed=true) ТОЛЬКО когда конкуренты явно вкладывают (competitor_url_depth.dominant_pattern two_level/deep) И сайт новый/малый/низкий риск; иначе mode="flat" (URL не трогаем, группируем только в шапке + перелинковка).
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
project_root: <project root>

Прочитай master_list.json (с полем id) + inputs.json (keyso_base, region_yandex, project_path) + business.directions[].marker из контракта анализа (семя маркера главной) + competitors.json структуры (для лидеров и доменов). Для каждой страницы (кроме информационных) определи маркер через каскад: domain_keywords(лидер) -> domain_keywords(остальные конкуренты) -> keyword_info -> keyword_similar -> ручное. Если Keyso не дает данных - резерв jm_wordstat (пакетно) или wk_check_frequency (массово). Проверь коммерциализацию (arsenkin_commerce). info_dominant без синонима 1:1 - НЕ сваливай на клиента: переназначь role=umbrella, инфо-запрос в блог, коммерцию на страницу-дом, запиши все в decisions.json (идемпотентно по id). Протяни id из master_list. Сохрани markers.json + decisions.json.
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

Скрипт читает `semantic_pack.json` + `markers.json` + `master_list.json` + `stop_list.md` папки структуры (бренды-конкуренты для фильтра; пишет seo-base), фильтрует и отбирает топ-10 на каждую страницу, детектит дубли между страницами.

Записывает:
- `top10.json` - топ-10 на страницу (отфильтрованный)
- `cannibalization.json` - список конфликтов + альтернативы из топ-30

Exit 0 - готово. Exit 1 - что-то критичное (например, ни одна страница не получила маркер).

#### 5b. Агент разруливания

Маркер: `.claude/tmp/expected-cannibalization-resolver-<run_id>.txt = <structure_dir>/cannibalization.json`

Делегировать `cannibalization-resolver`:
```
structure_dir: <structure_dir>
project_root: <project root>

Прочитай top10.json + cannibalization.json (с конфликтами и альтернативами) + master_list.json + decisions.json (если есть) + из контракта анализа по inputs.project_path: business.assortment и constraints.not_selling (что клиент точно не делает). Разреши каждый конфликт по правилам "ближе по смыслу к маркеру". Сформулируй рекомендации по расширению. Раздели: SEO-механику (расщепление/свертка низкочастоток/добавление под запрос конкурента) - в decisions.json (kind add_page/split_page/merge_lowfreq, confidence low) + recommendations[]; бизнес-реальность (производит ли клиент?) - флагом business_flag клиенту. master_list НЕ переписывай (журнал = решение в данных). Обнови top10.json + cannibalization.json + допиши decisions.json (идемпотентно по id).
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

Скрипт читает `inputs.json` + `master_list.json` + `top10.json` + `cannibalization.json` + `competitors.json` папки структуры (выход seo-base) и собирает `A6_<slug>.xlsx` с 4 листами: «Структура», «Рекомендации», «Конкуренты», «Миграция».

Лист «Структура» содержит колонку «Раздел» (из `page.section`, когда `use_sections`) и колонку «Категория» (из `page.category`, показывается когда хотя бы у одной страницы есть непустой `category`). Обе редактируемы клиентом. (Парс новых колонок с -1 guard, как существующий COL_SECTION.)

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
  /seo-struktura <NNN> --import <путь-к-возврщённому-xlsx>
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
project_root: <project root>

Прочитай structure_data.json + cannibalization.json + master_list.json (вкл. sections/section/category + competitor_url_depth + url_nesting_recommendation) + inputs.json + контракт анализа по inputs.project_path (business.name, business.region, корневые направления) + competitors.json, serp.json, stop_list.md структуры + decisions.json (если есть) + semantic_pack.json (для degraded). Собери A6.md по фиксированному шаблону - шапка проекта + Замечания прогона (контракт не согласован / tier отстал / регион и база Keyso / конкуренты расходятся с анализом / деградация / спаривание) + Целевые + Рекомендации + Наши SEO-решения (журнал, low-confidence отдельным чек-листом) + Архитектура меню (шапка) + Блок перелинковки в шапке + Конкуренты + Миграция + Отложенные (с причинами).

Новые разделы (ВСЕГДА):
- «Архитектура меню (шапка)» - дерево раздел -> (категория) -> страницы из sections/section/category. Если реальной группировки нет (use_sections=false) - плоский список.
- «Блок перелинковки в шапке» - какие сгруппированные страницы кросс-линкуются в шапке (по разделам/категориям).
Если `url_nesting_recommendation.mode == "nested"` - добавь в раздел «Миграция» рекомендацию вложенных URL (по dominant_pattern из competitor_url_depth) + 301-редиректы. При mode="flat" - явно отметь, что URL остаются плоскими, группировка только в шапке.
URL уже готовы в structure_data.json - копируй как есть, не генерируй.
```

После завершения:
- `bash .claude/hooks/update-meta.sh <structure_dir> client-imported`
- Переход к шагу 9г.

#### 9г. Механический гейт структуры

```
.claude\scripts\_node.cmd .claude\scripts\verify-structure.mjs <structure_dir>
```

Механический финальный гейт: URL-правила по всем страницам, полнота A6.md против structure_data.json, дубли маркеров между целевыми страницами. Использует те же правила валидации URL, что и импорт (`_slug.mjs`).

- **Exit 0/1** - идем к смысловому чеку (9д). Exit 1 - warn'ы (напр. существующий кириллический адрес клиента) отметить в финальной сводке, не блок.
- **Exit 2** - блок. Пере-делегировать `structure-writer` с текстом нарушений (макс 2 повтора суммарно на оба гейта 9г+9д), затем повторить verify-structure.mjs. Если после 2 повторов все еще exit 2 - стоп с показом нарушений пользователю (структуру дальше не финализируем).
- **Exit 3** - ошибка запуска (нет structure_data.json / A6.md / битый JSON) - показать stderr, стоп.

#### 9д. Смысловой гейт структуры (агент)

Маркер: `.claude/tmp/expected-structure-verifier-<run_id>.txt = <structure_dir>/verify_report.json`

Делегировать `structure-verifier`:
```
structure_dir: <structure_dir>
project_root: <project root>

Прочитай A6.md + structure_data.json + cannibalization.json + master_list.json + decisions.json (опц.) + semantic_pack.json (опц.) + serp.json, competitors.json и inputs.json структуры. Сверь цифры с источниками, состав/порядок разделов по шаблону, непротиворечивость рекомендаций вердикту по выдаче (serp.verdict.type), чистоту клиентского языка и стиль. Ничего не чини. Запиши verify_report.json.
```

После завершения - прочитать `verify_report.json` (точечно `verdict` + `counters`, не весь файл):
- `verdict == pass` - оба гейта пройдены, перейти к обновлению state ниже, затем к шагу 10.
- `verdict == needs-fix` / `fail` - пере-делегировать `structure-writer` с issues из отчета (макс 2 повтора суммарно на оба гейта 9г+9д), затем повторить 9г (verify-structure.mjs) и 9д. После 2 повторов без pass - стоп с показом issues пользователю.

Когда ОБА гейта прошли (verify-structure exit 0/1 И structure-verifier verdict pass):
- `bash .claude/hooks/update-meta.sh <structure_dir> structure-verified`
- Переход к шагу 10.

### 10. Финал структуры (state == "structure-verified")

> Если зашли сюда при `state == "client-imported"` (resume до гейтов) - сперва прогнать шаги 9г и 9д, дойти до `structure-verified`, и только потом финал. Логика финала ниже не меняется.

Зафиксировать `completed` + флаг хвоста метатегов одной записью (чтобы хвост был возобновляем):
```bash
bash .claude/hooks/update-meta.sh <structure_dir> completed metatags_pending=<metatags_depth>
```
(`metatags_depth` = `deep`/`bulk`/`none` из шага 0b. Даже `none` пишем - шаг 11 увидит и пропустит хвост.)

Финальный коммит **структуры** (current-task всё ещё = `structures/<NNN>`):
```bash
git add -A
git commit -m "Structure <NNN> for <slug>: A6 ready (<N> target pages, <M> deferred)"
```

Вывести «СТРУКТУРА A6 ГОТОВА»:
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
═══════════════════════════
```

- Если `metatags_depth == none` - метатеги не делаем. Добавить «✅ Готово к /handoff» и закончить. (Метатеги можно сделать позже: `/seo-metategi --from-structure <NNN>`.)
- Иначе - перейти к шагу 11.

### 11. Хвост: метатеги (если `meta.metatags_pending` ∈ {deep, bulk})

Структура одобрена и **уже закоммичена**. Теперь автоматически генерируем метатеги для «да»-страниц - тем же движком (агенты `metatag-researcher`/`metatag-writer` + скрипты), что и `/seo-metategi`. Результат ВСЕГДА в `metatags/<NNN>-<slug>/` (НЕ в `structures/`), NNN зеркалит структуру.

#### 11a. Подтверждение / анонс

- `--review`: спросить:
  > Структура одобрена. Сгенерировать метатеги (глубина `<depth>`) для `<N>` целевых страниц? Ориентир: deep ~9-11 MCP/стр (анализ выдачи + Акварель), bulk ~5 вызовов на весь пакет (по PLAYBOOK). [Y/n]

  N -> стоп: «Метатеги пропущены. Позже: `/seo-metategi --from-structure <NNN>`.» (структура уже сдана, можно `/handoff`).
- `--auto`: одной строкой анонс: «Генерирую метатеги (`<depth>`) для `<N>` целевых страниц...».

#### 11b. Переключить задачу на метатеги

- Папка `metatags/<NNN>-<slug>/` (тот же NNN и slug, что у структуры). Если уже есть (resume) - читать её `meta.json`, продолжить с её состояния.
- **Записать `.claude/tmp/current-task.txt = metatags/<NNN>-<slug>/`** (критично: дальше пишем сюда; структуру уже закоммитили, pre-commit разрешит метатеги).
- Собрать `metatags/<NNN>-<slug>/inputs.json`:
  - из `structures/<NNN>-<slug>/inputs.json`: `slug`, `domain`, `region_yandex`, `region_name`.
  - из контракта анализа по `inputs.project_path` (`sites/<NNN>-<slug>/project.json`) - ключи метатегов прежние, источник новый:
    - `utp_technical[]`, `utp_service[]`, `utp_social[]` - `claim` из `offer.reasons[]` с непустым `proof` (причина без доказательства на страницу не пишется), раскладка по `kind`: `число` / `документ` / `процесс` -> technical, `гарантия` -> service, `кейс` / `отзыв` -> social;
    - `assortment[]` - `business.assortment[]`;
    - `forbidden_phrasings[]` - `constraints.forbidden[]`;
    - `brand_name` - `business.name`.
  - `source = "structure:<NNN>"`, `depth = <metatags_pending>`.
- Создать `metatags/<NNN>-<slug>/meta.json`: `{ "slug": "<slug>", "state": "init", "depth": "<depth>", "source": "structure:<NNN>", "started": "<ISO>", "updated": "<ISO>" }`.

#### 11c. Запустить движок метатегов

Выполнить шаги 2-8 скила `/seo-metategi` (подробности - `.claude/skills/seo-metategi/SKILL.md`), источник = структура:

1. `.claude\scripts\_node.cmd .claude\scripts\read-metatags-input.mjs metatags/<NNN>-<slug>/ --from-structure structures/<NNN>-<slug>/` -> `pages.json`. Exit 2 (все «нет») -> стоп с пометкой (метатегам нечего делать). `update-meta.sh metatags/<NNN>-<slug>/ pages-ready`.
2. Делегировать `metatag-researcher` (маркер expected -> `research.json`) -> `researched`.
3. `.claude\scripts\_node.cmd .claude\scripts\select-variations.mjs metatags/<NNN>-<slug>/` -> `shortlist.json` -> `shortlisted`.
4. Делегировать `metatag-writer`: `deep` - **СТРОГО ПОСЛЕДОВАТЕЛЬНО, по одной странице** (concurrency 1, без expected-маркеров - см. /seo-metategi шаг 5: arsenkin/JM общие, параллельный веер давал таймауты и cross-talk; в промт включи «Надёжная работа с MCP»: backoff arsenkin, анти-cross-talk JM, при отказе MCP - флаг `mcp_degraded`); `bulk` - чанками по 15-25 (без MCP, можно параллелить). -> `pages/<n>.json` -> `written`.
5. `.claude\scripts\_node.cmd .claude\scripts\verify-metatags.mjs metatags/<NNN>-<slug>/`. Exit 2 -> пере-делегировать недостающие/нарушенные (макс 2 повтора) и деградировавшие (`mcp_degraded` - 1 спокойный повтор по одной), потом снова verify с `--accept-degraded`. -> `verified`. (Деталь шага 6 - в /seo-metategi.)
6. `.claude\scripts\_node.cmd .claude\scripts\build-metatags-xlsx.mjs metatags/<NNN>-<slug>/` -> `A7_<slug>.xlsx` -> `xlsx-built`.
7. Drive: прочитать `metatags_folder_id` из `~/.claude/seo-knowledge/DRIVE.md`. Нет/`TODO_` -> `update-meta.sh ... xlsx-built skip_reason="..."`, оставить локальный xlsx. Есть -> `uploadFile` (как в /seo-metategi шаг 8), `share.json` -> `shared`.
8. `update-meta.sh metatags/<NNN>-<slug>/ completed`.

#### 11d. Коммит метатегов

```bash
git add -A
git commit -m "Metatags <NNN> for <slug>: A7 ready (<N> pages, depth <depth>)"
```
(current-task = `metatags/<NNN>`, pre-commit пропустит.)

#### 11e. Финальный вывод (структура + метатеги)

```
═══ СТРУКТУРА + МЕТАТЕГИ ГОТОВЫ ═══

Клиент: <domain или slug>
Структура: <N> целевых страниц (A6)
Метатеги: <M> страниц, глубина <depth> (A7)
Title > 60 / Description > 160: <x> / <y> (подсвечены в A7)

📊 Google Sheets для клиента:
   A6 (структура): <drive_link A6 если есть>
   A7 (метатеги):  <drive_link A7 если есть>

📌 Локальные артефакты:
   structures/<NNN>-<slug>/A6.md            ← структура
   metatags/<NNN>-<slug>/A7_<slug>.xlsx     ← метатеги (H1/Title/Description)

✅ Готово к /handoff (перенесёт обе задачи в main).
═══════════════════════════════════
```

## Параллельная работа

Несколько структур одновременно - каждая в своём worktree. Состояния не пересекаются.

## Обработка временных API-ошибок

Любой вызов субагента может вернуть `529 Overloaded` / `503` / `rate_limit_error`. Поведение - как в `/seo-statya`: ловить, `ScheduleWakeup` на 90 секунд с тем же `/seo-struktura <NNN> --resume`. Максимум 3 попытки. (В хвосте метатегов, шаг 11, при overload части deep-веера - не падать: `verify-metatags.mjs` потом покажет недостающие страницы, пере-делегируем.)

## Запреты

- НЕ запускай без контракта анализа `sites/NNN-<slug>/project.json` и без `tier=seo` в его `queue.json` - шаг 1a (скрипт) блокирует, флага обхода нет.
- НЕ пиши в корень проекта - только в `<structure_dir>/` (а на шаге 11, после коммита структуры и переключения `current-task.txt`, - в `metatags/<NNN>-<slug>/`). Pre-commit отклонит остальное.
- НЕ пиши метатеги в `structures/NNN/` - даже как хвост, A7 ВСЕГДА в `metatags/NNN/` (ADR-012).
- НЕ пропускай состояния - каждое `update-meta.sh` обязательно.
- НЕ редактируй общие файлы (`ЗАКАЗЧИК.md`, `template.html`, `topics.xlsx`) - read-only из worktree.
- НЕ редактируй `project.json` и ничего в `sites/NNN/` - контракт анализа read-only для этого скила; расхождения (например, список конкурентов) печатаются в A6.md.
- НЕ запускай `metatag-writer` в deep-хвосте пачкой/параллельно - только по одной (анти-overload arsenkin + анти-cross-talk JM, см. /seo-metategi). Параллель допустима лишь в bulk (он без MCP). Expected-маркеры на них не ставь - полноту/деградацию проверяет `verify-metatags.mjs`.
- НЕ используй длинное тире (—) и среднее (–). Только дефис (-).
- НЕ используй букву ё - всегда пиши е. Правило для всех клиентских текстов и метатегов (как и запрет тире).
- НЕ запускай `/seo-statya`, `/seo-strategiya`, `/site-analiz`, `/seo-temi` из этой же сессии - отдельные worktree-задачи.
