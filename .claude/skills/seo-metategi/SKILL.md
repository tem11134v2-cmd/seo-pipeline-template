---
name: seo-metategi
description: Генерация метатегов (H1, Title, Description) под Яндекс для страниц сайта. Один движок, две глубины - deep (анализ выдачи + Акварель, по странице последовательно) и bulk (по PLAYBOOK + батч-данные, дёшево, параллельно). Три источника страниц - сканирование сайта / таблица / готовая структура. Результат - A7_<slug>.xlsx (3 листа). Аргументы - [--from-structure <NNN>] [--site <домен>] [--table <путь>] [--depth deep|bulk] [--resume].
---

# seo-metategi

Скил-оркестратор генерации метатегов (артефакт A7: H1 + Title + Description на каждую целевую страницу + аналитика). Запускается **в worktree-сессии**. Порт авторской услуги У4 (claude.ai) - см. [ADR-012](../../../docs/adr/012-metatags-task-type.md).

**Один движок, две глубины:**
- `deep` (по умолчанию) - качество «топ»: по каждой странице анализ выдачи Яндекса (`arsenkin_top`/`arsenkin_parse`) + Title через Акварель (`jm_text_check`). Писатели идут **строго последовательно** (1 вызов = 1 страница, concurrency 1). **Почему не параллельно:** arsenkin и JM-аккаунт - общие серверы; веер из 6-8 писателей даёт залп ~50 одновременных вызовов на arsenkin (таймауты -> деградация в «по PLAYBOOK») и cross-talk на одном JM-аккаунте (Акварель чужой страницы). Самый медленный кусок - Акварель (`jm_text_check`) - сериализуется на сервере и параллелью не ускоряется, поэтому последовательный веер почти не теряет в скорости, но снимает обе проблемы. Та же модель, что в `/seo-faq` (см. ADR-012 + урок faq 2026-06-24).
- `bulk` - дёшево «стд»: генерация по PLAYBOOK + батч-данные, без выдачи и Акварели. **Без MCP -> можно параллелить** (быстрая дорожка для больших объёмов).

**Глубину не нужно указывать флагом** - см. шаг 0c (определяется по фразам в запросе).

## Аргументы

```
/seo-metategi [--from-structure <NNN>] [--site <домен>] [--table <путь>] [--depth deep|bulk] [--resume]
```

- Без аргументов - скил **спросит источник** (шаг 1b).
- `--from-structure <NNN>` - взять «да»-страницы из утверждённой структуры `structures/<NNN>-*/`.
- `--site <домен>` - просканировать живой сайт (режим аудита), оценить какие метатеги править.
- `--table <путь>` - готовая таблица URL/Тип/Маркер[/запросы] (csv/tsv).
- `--depth deep|bulk` - явная глубина (перекрывает авто-определение).
- `--resume` - продолжить с состояния по `meta.json`.

## State machine

```
init -> pages-ready -> researched -> shortlisted -> written -> verified
     -> xlsx-built -> [shared] -> completed
```

(В режиме `--site` перед `pages-ready` есть под-состояние `audit-ready` - см. шаг 2.)

`meta.json` - единственный источник истины. Обновляется через `bash .claude/hooks/update-meta.sh <metatags_dir> <state>`.

## Артефакты

```
metatags/NNN-<slug>/
├── meta.json            # state machine + depth + источник + drive_file_id
├── inputs.json          # slug, domain, region_yandex, region_name, source + УТП-блок (utp_*, assortment, forbidden_phrasings, brand_name)
├── audit.json           # (только --site) текущие метатеги + приоритет «что править»
├── pages.json           # канонический список целевых страниц (от read-metatags-input.mjs)
├── research.json        # варианты + частотность + Comm/Geo + подсказки (metatag-researcher)
├── shortlist.json       # chosen_form + shortlist + reserve на страницу (select-variations.mjs)
├── pages/<n>.json       # метатеги по странице (metatag-writer)
├── A7_<slug>.xlsx       # ФИНАЛ - 3 листа: Метатеги, Аналитика, Сводка
└── share.json           # ссылка Drive
```

## Алгоритм

### 0a. Проверка: мы в worktree?

```bash
GIT_DIR=$(git rev-parse --git-dir)
COMMON_DIR=$(git rev-parse --git-common-dir)
```
Если `GIT_DIR == COMMON_DIR` - мы в main. Предупредить (не блокировать):
> ⚠️ Метатеги в main-сессии. Pre-commit здесь не блокирует. Для многозадачности переоткрой с галочкой worktree.

### 0b. Parse args

```
from_structure = <NNN> | null
site = <домен> | null
table = <путь> | null
depth_flag = deep|bulk|null
resume = true/false
```

### 0c. Определить глубину (если `--depth` не задан)

Посмотри на сообщение пользователя, которым он вызвал скил (и недавний контекст). Если есть намерение «по-быстрому/дёшево»: слова **«быстро», «по-быстрому», «дёшево», «пакетно», «bulk», «массово», «без анализа выдачи», «только по правилам»** - поставь `depth = "bulk"` и сообщи одной строкой:
> Понял, быстрый прогон (bulk): генерация по PLAYBOOK + батч-данные, без поштучного разбора выдачи и Акварели.

Иначе `depth = "deep"`. `--depth` всегда перекрывает.

### 1. Setup

#### 1a. Если `--resume`

- Найти `metatags/<NNN>-*/` (по NNN из аргумента, или последнюю активную). Если несколько - спросить.
- Прочитать `meta.json`, `state = meta.state`, `depth = meta.depth`.
- Спросить «Найдено в state `<state>` (глубина `<depth>`), обновлено `<updated>`. Продолжить? [Y/n]».
- Перейти к ветке после `state`.

#### 1b. Если фрэш-старт - определить источник

Если ни один из `--from-structure / --site / --table` не задан - **спросить пользователя**:

```
Откуда берём страницы для метатегов?

  1. Просканировать сайт - дай домен. Я соберу карту страниц (sitemap),
     их текущие H1/Title/Description и оценю, какие метатеги стоит править
     в первую очередь. (режим аудита)

  2. Таблицей - пришли список: URL / Тип / Маркер [/ доп. запросы] (csv, tsv
     или просто построчно). Маркеры уже у тебя есть.

  3. Из готовой структуры - назови номер NNN папки structures/NNN-*/.
     Возьму страницы, которые клиент отметил «да».
```

По ответу выставить `source`.

#### 1c. Определить slug, NNN, регион, УТП -> создать папку

**Источник = структура** (`--from-structure NNN` или выбор 3):
- `structure_dir = structures/<NNN>-*/` (glob). Если нет - стоп с подсказкой `/seo-struktura`.
- Прочитать `structure_dir/inputs.json` -> `slug`, `domain`, `region_yandex`, `region_name`, `analysis_dir`.
- Прочитать `analysis_dir/brief.json` -> УТП-блок: `utp_technical[]`, `utp_service[]`, `utp_social[]`, `assortment[]`, `forbidden_phrasings[]` (или `запрещённые формулировки`), `brand_name`.
- **NNN метатегов зеркалит NNN структуры.** `metatags_dir = metatags/<NNN>-<slug>/`.

**Источник = таблица / сайт** (нет структуры):
- Если есть корневой `ЗАКАЗЧИК.md` - прочитать через `.claude\scripts\_node.cmd .claude\scripts\_client.mjs --field "<поле>" ЗАКАЗЧИК.md`: `brand_name` (Название компании), регион (Код региона JM / Регион), стоп-слова (`--stop-words`). Иначе спросить у пользователя нишу/регион и (опц.) УТП и запрещённые формулировки.
- `region_yandex` - код Яндекса (число). Стандартный список в PLAYBOOK р.8; федеральный/неизвестный -> `213` + пометка.
- `slug` - из домена (если `--site`) или из ниши (Latin kebab-case).
- `NNN` - следующий свободный номер в `metatags/`.

Создать `metatags/<NNN>-<slug>/`. **Записать `.claude/tmp/current-task.txt = metatags/<NNN>-<slug>/`** (критично - без этого pre-commit откажет).

Записать `inputs.json`:
```json
{
  "slug": "<slug>",
  "domain": "<domain|null>",
  "region_yandex": 213,
  "region_name": "<регион>",
  "source": "<structure:NNN | table:<path> | site:<домен>>",
  "depth": "<deep|bulk>",
  "utp_technical": [], "utp_service": [], "utp_social": [],
  "assortment": [],
  "forbidden_phrasings": [],
  "brand_name": "<бренд>"
}
```

Создать `meta.json`:
```json
{ "slug": "<slug>", "state": "init", "depth": "<deep|bulk>", "source": "<...>", "completed_steps": [], "started": "<ISO>", "updated": "<ISO>" }
```

### 2. Сбор/выбор страниц (state == "init")

**Источник = сайт (режим аудита):**

Маркер: `.claude/tmp/expected-site-scanner-<run_id>.txt = <metatags_dir>/audit.json`

Делегировать `site-scanner`:
```
metatags_dir: <metatags_dir>
project_root: <project root>
domain: <домен>
region_yandex: <region_yandex>
Прочитай sitemap, собери страницы и их текущие H1/Title/Description, определи тип, оцени какие метатеги стоит править (приоритет). Сохрани audit.json.
```
После: `update-meta.sh <metatags_dir> audit-ready`. Показать пользователю сводку аудита (страниц найдено, с проблемными метатегами, топ-приоритеты) и спросить:
> Сгенерировать новые метатеги для: [все проблемные / назови номера / все]?
Отметить выбранные (`selected: true`) в `audit.json` (через Edit). Затем:
```
.claude\scripts\_node.cmd .claude\scripts\read-metatags-input.mjs <metatags_dir> --from-audit
```

**Источник = таблица:**
```
.claude\scripts\_node.cmd .claude\scripts\read-metatags-input.mjs <metatags_dir> --from-table <путь>
```

**Источник = структура:**
```
.claude\scripts\_node.cmd .claude\scripts\read-metatags-input.mjs <metatags_dir> --from-structure <structure_dir>
```

Exit 2 (ни одной целевой страницы) - стоп с сообщением (структура: все «нет»? аудит: ничего не выбрано?). Exit 1 - показать ошибку.

`update-meta.sh <metatags_dir> pages-ready`. Сводка: сколько страниц, по типам. Переход к шагу 3.

### 3. Исследование (state == "pages-ready")

Маркер: `.claude/tmp/expected-metatag-researcher-<run_id>.txt = <metatags_dir>/research.json`

Делегировать `metatag-researcher`:
```
metatags_dir: <metatags_dir>
project_root: <project root>
depth: <depth>
Прочитай pages.json + inputs.json. Построй варианты маркера по осям для коммерческих страниц, региона-guard, пакетно собери частотность (wk_check_frequency x3), коммерциализацию/гео (arsenkin_commerce), подсказки (jm_suggest). Сохрани research.json.
```
После: `update-meta.sh <metatags_dir> researched`. Сводка от агента. Переход к шагу 4.

### 4. Отбор форм (state == "researched")

```
.claude\scripts\_node.cmd .claude\scripts\select-variations.mjs <metatags_dir>
```
Читает `research.json`, пишет `shortlist.json` (chosen_form + shortlist + reserve + сигнал топонима на страницу). Exit 1 - стоп.

`update-meta.sh <metatags_dir> shortlisted`. Сводка: страниц, форм отсеяно, all-low, топоним. Переход к шагу 5.

### 5. Генерация метатегов (state == "shortlisted")

Прочитать `shortlist.json` -> список страниц (по `n`).

**Глубина `deep` - СТРОГО ПОСЛЕДОВАТЕЛЬНО, по одной странице (concurrency 1):**

Делегируй `metatag-writer` **по ОДНОЙ странице за раз**: следующий writer стартует ТОЛЬКО после завершения предыдущего (один вызов Agent в сообщении, не пачкой). **Почему не параллельно** (см. также блок «Конкурентность / надёжность MCP» ниже): arsenkin и JM-аккаунт - общие серверы; параллельный веер бьёт по arsenkin залпом (~8 вызовов × число писателей -> таймауты -> тихая деградация в «по PLAYBOOK») и плодит JM cross-talk (Акварель возвращает балл ЧУЖОЙ страницы - «тихо неправильный» Title). Акварель сериализуется на сервере и параллелью всё равно не ускоряется, поэтому последовательность почти не стоит времени. Подтверждено живым тестом faq 2026-06-24 (6 параллельных -> 3+ агента получили чужую Акварель/анализ).

Писатели **НЕ пишут expected-маркеры** (полноту проверит `verify-metatags.mjs` - см. ADR-012 п.3, иначе single-marker hook даёт ложные отказы).

Промт каждому:
```
metatags_dir: <metatags_dir>
project_root: <project root>
depth: deep
page_n: <N>
Прочитай PLAYBOOK.md, shortlist.json (свою страницу N), inputs.json. Проанализируй выдачу по топ-формам, выбери финальную форму, собери H1, Title через Акварель, Description. Само-проверка Акварелью. Соблюдай раздел «Надёжная работа с MCP» (backoff на arsenkin, анти-cross-talk JM, при отказе MCP - флаг mcp_degraded, не молчи). Сохрани pages/<N>.json.
```

> Для большого числа страниц с приоритетом скорости - предложи пользователю `bulk` (он без MCP, параллелится). `deep` - дорожка качества, она последовательная by design.

**Глубина `bulk` - чанками (без MCP):**

Делегируй `metatag-writer` пачками по ~15-25 страниц:
```
metatags_dir: <metatags_dir>
project_root: <project root>
depth: bulk
page_ns: [<список n этой пачки>]
Прочитай PLAYBOOK.md, shortlist.json, inputs.json. Сгенерируй H1/Title/Description по PLAYBOOK + данные research/suggests. Без MCP. Сохрани pages/<n>.json на каждую.
```

После всех писателей: `update-meta.sh <metatags_dir> written`. Переход к шагу 6.

### 6. Верификация (state == "written")

```
.claude\scripts\_node.cmd .claude\scripts\verify-metatags.mjs <metatags_dir>
```

- **Exit 0** - всё на месте, критичных нарушений и деградации нет. `update-meta.sh <metatags_dir> verified`. Переход к шагу 7.
- **Exit 2** - есть отсутствующие страницы, нарушения и/или деградация (скрипт печатает построчно под раздельными заголовками):
  - **Отсутствующие** (`нет pages/<n>.json`) - пере-делегировать `metatag-writer` по этим `n` (как в шаге 5, по одной). Максимум **2 повтора** на страницу; если после этого всё ещё нет - оставить заглушку, пометить в финальной сводке.
  - **Нарушения** (длина/тире/вхождение/запрещёнки) - пере-делегировать соответствующие страницы с явной инструкцией исправить конкретное нарушение (передать строки из вывода). Максимум 2 повтора.
  - **ДЕГРАДАЦИЯ** (`mcp_degraded` - выдача arsenkin не поднялась под нагрузкой, deep) - это transient-сбой, а не брак контента. Пере-делегировать эти страницы **ОДИН раз, строго по одной, на спокойном сервере** (deep). Это и есть «спокойный второй проход»: вне залпа MCP почти всегда отвечает. **В промт повтора добавь `calm_retry: true`** - тогда, если выдача снова не придёт, writer поставит терминальный `mcp_degraded_final` (а не `mcp_degraded`). Счётчик деградации отдельный от missing/violations - **максимум 1 повтор**.
  - После исправлений - снова `verify-metatags.mjs` с флагом **`--accept-degraded`** (свежая деградация после спокойного прохода уходит в предупреждение). `--accept-degraded` гасит ТОЛЬКО деградацию - missing/violations по-прежнему дают exit 2 и требуют своих повторов. **Двойная страховка от зацикливания:** даже если флаг забыть, `mcp_degraded_final` после повтора verify уже не блокирует (см. verify-metatags). Когда exit 0 (или исчерпаны повторы) - `verified`. Оставшуюся деградацию пометить в финальной сводке: «N стр. собраны по PLAYBOOK без выдачи/Акварели».
- **Exit 1** - критическая ошибка (нет pages.json) - показать, стоп.

### 7. Сборка A7.xlsx (state == "verified")

```
.claude\scripts\_node.cmd .claude\scripts\build-metatags-xlsx.mjs <metatags_dir>
```
Читает `inputs.json` + `pages.json` + `pages/<n>.json`, пишет `A7_<slug>.xlsx` (3 листа). `update-meta.sh <metatags_dir> xlsx-built`. Переход к шагу 8.

### 8. Upload в Drive (state == "xlsx-built")

#### 8a. Прочитать DRIVE.md

`~/.claude/seo-knowledge/DRIVE.md` -> `metatags_folder_id`. **Если ключа нет или значение начинается с `TODO_`** - не блокировать, скипнуть:
```
bash .claude/hooks/update-meta.sh <metatags_dir> xlsx-built skip_reason="Drive: нет metatags_folder_id в DRIVE.md. Создай папку «Метатеги» в Drive (anyone-with-link -> reader), впиши ID в DRIVE.md, затем /share-metatags <NNN>."
```
Перейти к шагу 9 (локальный xlsx остаётся для ручной отправки).

#### 8b. Загрузка

```
mcp__gdrive-piotr__uploadFile(
  localPath: <абс путь к A7_<slug>.xlsx>,
  name: A7_<slug>,
  parentFolderId: <metatags_folder_id>,
  mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  convertToGoogleFormat: true
)
```
Если упало с конверсией - fallback `convertToGoogleFormat: false` + в сводке «активируй Sheets API, потом /share-metatags <NNN> --redo».

Записать `share.json`:
```json
{ "drive_file_id": "<id>", "drive_link": "<link>", "mime_type": "application/vnd.google-apps.spreadsheet", "shared_at": "<ISO>", "revisions": [] }
```
`update-meta.sh <metatags_dir> shared`.

### 9. Финал (state == "shared" или "xlsx-built" со skip)

`update-meta.sh <metatags_dir> completed`

Финальный коммит:
```bash
git add -A
git commit -m "Metatags <NNN> for <slug>: A7 ready (<N> pages, depth <depth>)"
```
(Pre-commit пропустит - всё внутри `metatags/<NNN>/`, `current-task.txt` объявлен.)

Вывести:
```
═══ МЕТАТЕГИ A7 ГОТОВЫ ═══

Клиент: <domain или slug>
Страниц: <N> (глубина <deep|bulk>)
Title > 60 / Description > 160: <X> / <Y> (подсвечены в xlsx)

📊 Google Sheet (если шаг 8 успешен):
   <drive_link>

📌 Локальные артефакты:
   <metatags_dir>/A7_<slug>.xlsx     ← H1/Title/Description для разработчика (лист «Метатеги»)
   <metatags_dir>/pages/             ← по странице (с аналитикой)

✅ Готово к /handoff (перенесёт в main).
═══════════════════════════
```

## Параллельная работа

Несколько прогонов метатегов - каждый в своём worktree. Состояния не пересекаются.

## Конкурентность / надёжность MCP

**deep = строго последовательно (concurrency 1).** Корень прежних сбоев: arsenkin и JM-аккаунт - общие серверы. Параллельный веер (а) бьёт по arsenkin залпом (~8 вызовов на писателя × N) - таймауты и тихая деградация в «по PLAYBOOK без выдачи»; (б) даёт JM cross-talk - Акварель возвращает балл ЧУЖОЙ страницы (тихо неправильный Title, не ловится длиной/тире). Поскольку Акварель сериализуется на сервере (минуты) и параллелью не ускоряется, последовательность почти ничего не стоит по времени. Большой объём + приоритет скорости -> `bulk` (без MCP, параллелится).

Надёжность реализована **внутри `metatag-writer`** (см. агента, раздел «Надёжная работа с MCP»): backoff-ретрай arsenkin (3×: 10/20/40с) до деградации; анти-cross-talk JM (timeout != провал, своя задача по tid/маркеру, не «последняя завершённая»); при так и не поднявшемся MCP - флаг `mcp_degraded` (не молчать). Деградировавшие страницы ловит `verify-metatags.mjs` и скил даёт им 1 спокойный повтор (шаг 6).

## Обработка временных API-ошибок

Любой субагент может вернуть `529 Overloaded` / `503` / `rate_limit_error`. Ловить, `ScheduleWakeup` на 90 секунд с тем же `/seo-metategi --resume <NNN>`. Максимум 3 попытки. (Это про overload самой модели/обёртки на уровне оркестрации. Per-call таймауты arsenkin/JM под нагрузкой писатель гасит сам - backoff + анти-cross-talk - и не падает: verify-metatags потом покажет недостающие/деградировавшие, пере-делегируем по одной.)

## Запреты

- НЕ пиши в корень проекта - только в `<metatags_dir>/`. Pre-commit отклонит.
- НЕ пиши результаты в `structures/NNN/` даже когда источник - структура. Метатеги ВСЕГДА в `metatags/NNN/` (ADR-012).
- НЕ пропускай состояния - каждое `update-meta.sh` обязательно.
- НЕ редактируй общие файлы (`ЗАКАЗЧИК.md`, `template.html`) и `structures/NNN/`, `analyses/NNN/` - read-only.
- НЕ ставь expected-маркеры на writer'ов в deep - полноту/деградацию проверяет `verify-metatags.mjs` (single-marker hook давал бы ложные отказы).
- НЕ запускай deep-писателей пачкой/параллельно - только по одной (анти-overload arsenkin + анти-cross-talk JM). Параллель допустима лишь в bulk (он без MCP).
- НЕ используй длинное тире (—) и среднее (–). Только дефис (-).
- НЕ используй букву ё - всегда пиши е. Правило для всех клиентских текстов и метатегов (как и запрет тире).
- НЕ запускай `/seo-struktura`, `/seo-statya`, `/seo-strategiya`, `/seo-analiz` из этой сессии - отдельные worktree-задачи.
