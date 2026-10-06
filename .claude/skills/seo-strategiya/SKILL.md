---
name: seo-strategiya
description: Полный цикл SEO-стратегии для клиента. Скан сайта → метрики → конкуренты → точки роста → три тарифа → прогноз и экономика по каждому тарифу → стратегия .docx (4 раздела тезисами, без цен и тарифов) и смета .xlsx (тарифы, разработка сайта, окупаемость). Аргументы: <URL> [--resume].
---

# seo-strategiya

Скил-оркестратор формирования стратегии и сметы. Запускается **в worktree-сессии**. Проходит state machine от скана сайта до сборки docx/xlsx и загрузки в Drive.

Версия v2 (программа `docs/upgrade-program-2026-10-06-strategy-v2.md`, [ADR-046](../../../docs/adr/046-strategy-v2.md)):
- новая линейка услуг (`TARIFFS.md`: 17 услуг + разработка сайта `DEV` отдельным блоком; `PA -> SY -> KP -> FQ`, Яндекс Карты `YM`, акции «ПФ 1=2» и «Тестовая статья в подарок»);
- прогноз трафика и денег считает скрипт `build-forecast.mjs` по составу КАЖДОГО тарифа (модель `_forecast-model.mjs`, калибровка по кейсам агентства), агенты кривых и денег не рисуют;
- экономический гейт после тарифов: ROMI Роста за 12 мес > 0 и Рост не хуже Старта по чистому результату - иначе один круг пересборки тарифов;
- стратегия .docx - 4 раздела тезисами, без цен, без тарифов и без денег в прозе (деньги рисует сборщик из `forecast.json`); тарифы, разработка сайта и окупаемость - только в смете .xlsx.

v2.1 (боевой прогон на 5 клиентах, 06.10): мягкий потолок прогноза по спросу и конкурентам; план, график и потери docx - по тарифу плана `forecast.plan_tariff` (рекомендованный сметой или Рост); новый сайт - месяц запуска `forecast.launch_month` (страницы и ежемесячные работы с него); цикл сделки (`sales_lag_months`) и повторные покупки (`ltv_factor`) в экономике; потери `lost_now` - разрыв с конкурентами (`basis`) по базовой конверсии; после смысловой проверки - круг правок «только minor»; docx - только после verdict pass.

## Аргументы

```
/seo-strategiya <URL> [--resume] [--niche="..."] [--region="..."]
```

- `URL` - обязательный позиционный. Домен клиента в формате `https://site.ru/` или `site.ru`. Если у клиента нет сайта - передать `none`, скил спросит дополнительные данные.
- `--resume` - продолжить с того места, где остановилось (по `meta.json`).
- `--niche="..."` - ниша/описание бизнеса (ГИПОТЕЗА). Если передан - не переспрашивать; пишется как `niche_hypothesis`, сверяется со сканом на гейте 2.5. Через него `new-project` стартует стратегию «теплой».
- `--region="..."` - регион продвижения. Если передан - не переспрашивать.

## State machine

```
init → scan-done → competitors-done → growth-done → tariffs-done →
  forecast-done → content-done → strategy-verified → docx-done → xlsx-done → shared → completed
```

`meta.json` - единственный источник истины. Обновляется через `.claude/hooks/update-meta.sh <strategy_dir> <state> [ключ=значение ...]`.

| state | Что готово | Следующий шаг |
|---|---|---|
| `init` | `inputs.json`, `meta.json` | 2. Скан |
| `scan-done` | `scan.json`, `metrics.json` | 2.5 (если `inputs.niche` еще `null`) и 3 |
| `competitors-done` | `competitors.json`, `serp.json` | 4. Точки роста |
| `growth-done` | `growth-points.json`, `seo-strategiya_data.json` (с `forecast_inputs`) | 5. Тарифы |
| `tariffs-done` | `tariffs.json` (с `promos`, `site_dev`) | 5.5. Прогноз и экономика |
| `forecast-done` | `forecast.json` | 6. Контент |
| `content-done` | `seo-strategiya_content.json` (`format: "v2"`) | 6.5. Проверка |
| `strategy-verified` | `verify_report.json` (verdict pass) + verify-strategy exit 0 (после круга «только minor», если он был) | 7. docx |
| `docx-done` | `SEO_Strategy_<slug>.docx` | 8. xlsx |
| `xlsx-done` | `Smeta_<slug>.xlsx` | 9. Drive |
| `shared` | `share.json` | 10. Финал |

Финальные состояния (`xlsx-done`, `shared`, `completed`) и имена файлов `SEO_Strategy_<slug>.docx` / `Smeta_<slug>.xlsx` не менять - их читают `/share-strategy` и `/status`.

Поток данных:
```
inputs.json -> strategy-scanner -> scan.json, metrics.json
            -> competitor-analyst -> competitors.json (+ трафик конкурентов), serp.json
            -> growth-strategist -> seo-strategiya_data.json (+ forecast_inputs)           [growth-done]
            -> tariff-architect -> tariffs.json (+ promos, site_dev)                        [tariffs-done]
            -> build-forecast.mjs -> forecast.json (exit 3 -> tariff-architect, 1 круг)     [forecast-done]
            -> strategy-writer -> seo-strategiya_content.json (format v2)                   [content-done]
            -> verify-strategy.mjs + strategy-verifier                                      [strategy-verified]
            -> build-strategy-docx.mjs -> SEO_Strategy_<slug>.docx                          [docx-done]
            -> build-smeta-xlsx.mjs -> Smeta_<slug>.xlsx                                    [xlsx-done]
            -> Drive                                                                        [shared -> completed]
```

## Алгоритм

### 0a. Проверка: мы в worktree?

```bash
GIT_DIR=$(git rev-parse --git-dir)
COMMON_DIR=$(git rev-parse --git-common-dir)
```

Если `GIT_DIR == COMMON_DIR` - мы в main. Предупредить:
> «⚠️ Ты собираешь стратегию в main-сессии. Pre-commit hook здесь не блокирует. Для многозадачности рекомендую закрыть и переоткрыть с галочкой worktree.»

Не блокировать - пользователь может сознательно так захотеть.

### 0b. Parse args

```
URL = <обязательно>
resume = true если --resume
domain = normalize(URL)  // убрать https://, www., trailing slash, нижний регистр
slug = slugify(domain)   // vasya.ru → vasya-ru; none → no-site-<timestamp>
```

### 1. Setup

> **Это предпродажный скил.** НЕ ищи и НЕ требуй `ЗАКАЗЧИК.md` (на свежем клоне его еще нет - он появляется только после `/seo-shablon`). Контекст собираешь сам: вопросы ниже + скан (шаг 2).
> **Факт раньше утверждения:** ниша/регион из аргумента или домена - это ГИПОТЕЗА, не факт. Истину устанавливает `strategy-scanner` → `scan.json`. Финальное `inputs.niche` проставляется только после сверки со сканом (гейт 2.5).

Спроси пользователя одним сообщением (что уже передано аргументами - не переспрашивать):
- Регион продвижения (например «Санкт-Петербург») - или из `--region`
- Ниша / описание бизнеса (1-2 предложения) - или из `--niche`; пишется как `niche_hypothesis`
- Есть ли доступ к Вебмастеру и Метрике на аккаунт tem11134? (Y/n)
- **Есть ли у бизнеса физический адрес/офис для клиентов (для Яндекс Карт)?** (да / нет / не знаю) → `address_confirmable: true | false | null`. Без адреса организацию в Картах не подтвердить: услугу «Яндекс Карты: активность» (`YM`) не предлагаем, обращения из Карт в прогноз не идут. «Не знаю» - адрес определит скан по сайту.
- **Будем ли мы разрабатывать сайт (новый сайт или редизайн у нас)?** (да / нет / пока не решено) → `we_develop: true | false | null`. «Да» - вкладка сметы «Разработка сайта» с пометкой «рекомендуем», акция «ПФ 1=2», без техаудита старого сайта. «Нет» / «не решено» - разработку рекомендует или нет `tariff-architect` по состоянию сайта, вкладка в смете есть всегда.
- Бюджет клиента, если озвучен (опц.)
- Средний чек / стоимость заказа (₽), если известен - для перевода прогноза трафика в деньги (опц., иначе оценим по нише и пометим «оценочно»)
- Ориентировочная конверсия сайта визит -> обращение, если знаете (опц., иначе типовая по типу бизнеса: услуги 5%, кейсы агентства дают 7-13%)
- Маржинальность бизнеса (%), если готовы озвучить - ROMI и окупаемость в смете считаются от валовой прибыли (опц., иначе оценим по нише)
- Заметки и пожелания (опц.)

Проценты можно записывать как `5` или `0.05` - `build-forecast.mjs` сам переведет в доли. Конверсия и маржа: любое число от 1 и выше - проценты (`1` = 1% = `0.01`, `5` = 5%); закрытие сделки: `1` = 100%, проценты - больше 1 (`30` = 30%). Конверсия 1% - это `0.01` или `1`, не `100`. Значения клиента перекрывают оценки агента (это делает скрипт, не агенты).

**Если `URL == none` (домена нет - нужен запуск с нуля)** - дополнительно спроси:
- Главный целевой запрос или маркер ниши (1-2 шт., например «ремонт квартир спб»)
- Известные конкуренты, на которых хочется равняться (1-3 домена, опц.)

Эти данные нужны competitor-analyst для пути Г (генерация маркеров «<услуга> <город>») и growth-strategist для спроса. Запиши их в `inputs.json` как поля `seed_queries: [...]` и `seed_competitors: [...]`. Вопрос про разработку сайта задай и здесь: сайта нет, но решение «делаем у нас» - за клиентом.

Определи `region_id` (Wordstat) и базы Keys.so (двойная база, точка 4):

```
region_id (Wordstat): Москва: 213 | СПб: 2 | Екатеринбург: 54 | Новосибирск: 65
  Казань: 43 | Н.Новгород: 47 | Челябинск: 56 | Самара: 51
  Ростов: 39 | Краснодар: 35 | Воронеж: 193 | Уфа: 172
  Пермь: 50 | Омск: 66 | Волгоград: 38 | Красноярск: 62
  (не в списке) → ближайший крупный или null

keyso_base_primary = "msk" ВСЕГДА - флагманская база: полнота пула конкурентов
  и рыночный потолок, страховка от пустых данных на тонкой региональной базе.
keyso_base_local = база города: spb | ekb | nsk | kzn | nnv | che | sam | rnd | krr |
  vrn | vlg | ufa | prm | kry | oms | sar | tmn | tom | mns
  → null если город == Москва (msk) ИЛИ города нет среди баз Keys.so.
  Локальная база = реальные локальные позиции клиента и локальные игроки.
```

Подготовь папку:
```
strategy_dir = strategies/<NNN>-<slug>/
```
Где NNN - следующий свободный трехзначный номер с ведущими нулями (отсчет от существующих папок в `strategies/`, если папки нет - 001).

Если `--resume`:
- Найти существующую `strategies/NNN-<slug>/` (по slug или по NNN если указан).
- Прочитать `meta.json`. `state = meta.state`.
- Спросить: «Найдено в состоянии `<state>`, last_completed=`<...>`. Продолжить? [Y/n]»
- Если Y - перейти к шагу из таблицы state machine (следующий после `state`).
- Заметки по гейтам: зашли на `tariffs-done` - сначала шаг 5.5 (прогноз), без `forecast.json` писатель не стартует. Зашли на `content-done` - сперва шаг 6.5 (6.5а + 6.5б) до `strategy-verified`, и только потом шаг 7; если в `meta.json` `minor_round == "done"` (круг «только minor» уже прошел после pass) - только 6.5а, без повторного 6.5б. Зашли на `strategy-verified` - сверить `verify_report.json` (verdict pass, предусловие шага 7) и сразу шаг 7.
- **Задача, начатая до v2** (в `inputs.json` нет поля `we_develop`): в ней старый каталог услуг, нет `forecast_inputs`, контент без `format: "v2"`.
  - state `strategy-verified` и дальше - доделать старым путем: `build-strategy-docx.mjs` и `build-smeta-xlsx.mjs` сами узнают старый формат (без `format: "v2"` / без `forecast.json`) и собирают его без изменения чисел (ADR-046, Р11).
  - state раньше `strategy-verified` - продолжать нельзя (агенты v2 не чинят старые артефакты). Предложить пересборку по v2: задать два новых вопроса (адрес, разработка), дописать `address_confirmable` и `we_develop` в `inputs.json`, `bash .claude/hooks/update-meta.sh <strategy_dir> init` и пройти с шага 2 (в старом `scan.json` нет полей v2: коммерческие страницы, адрес, карточка в Картах).

Иначе:
- Создать `<strategy_dir>/`.
- Записать `<strategy_dir>/inputs.json`:
```json
{
  "domain": "site.ru",
  "slug": "site-ru",
  "url_raw": "https://site.ru/",
  "niche_hypothesis": "...",
  "niche": null,
  "region": "Санкт-Петербург",
  "region_id": 2,
  "keyso_base_primary": "msk",
  "keyso_base_local": "spb",
  "access_webmaster": true,
  "access_metrika": true,
  "address_confirmable": null,
  "we_develop": null,
  "budget": null,
  "avg_check": null,
  "avg_check_source": null,
  "conversion_rate": null,
  "close_rate": null,
  "margin": null,
  "notes": "",
  "date": "Октябрь 2026"
}
```

Поля v2:
- `address_confirmable` - ответ оператора про адрес для Карт. `true` / `false` - факт от клиента, авторитетнее сайта (сканер переносит его в `scan.address_confirmable`); `null` - адрес определяет скан по сайту.
- `we_develop` - разработку сайта заказывают у нас. Читает `tariff-architect`: `site_dev.recommended`, акция «ПФ 1=2», без `FA`. `null` = `false`.
- `avg_check` (+ `avg_check_source: "client"`, если чек назвал клиент) - руб, число; `conversion_rate` (визит -> обращение) и `margin` - доля или проценты (`0.05` или `5`; число от 1 и выше - проценты, `1` = 1%); `close_rate` (обращение -> продажа) - доля или проценты (`0.3` или `30`; `1` = 100%) - экономика от клиента; `null` - оценку по нише дает `growth-strategist` в `forecast_inputs.economics`. Значение клиента вне разумного диапазона (конверсия выше 30%) скрипт не блокирует, но печатает предупреждение - подтвердить у клиента.

`slug` - Latin-only kebab-case (для IDN-доменов вроде `сайт.рф` нужен явный slug, иначе генерация имен файлов даст некрасивый результат). Скрипты `build-strategy-docx.mjs` и `build-smeta-xlsx.mjs` используют `slug` для имени файла, иначе fallback на `domain`.
- Записать `<strategy_dir>/meta.json`:
```json
{
  "domain": "site.ru",
  "slug": "site-ru",
  "state": "init",
  "completed_steps": [],
  "started": "<ISO UTC>",
  "updated": "<ISO UTC>"
}
```
- Записать `.claude/tmp/current-task.txt` с путем `<strategy_dir>` (критично - без этого pre-commit откажет в коммите).
- `state = "init"`.

### 2. Скан + метрики (если state == "init")

Маркер: `.claude/tmp/expected-strategy-scanner-<run_id>.txt = <strategy_dir>/metrics.json`

Делегировать `strategy-scanner`:
```
strategy_dir: <strategy_dir>
inputs_path: <strategy_dir>/inputs.json
project_root: <project root>
Прочитай inputs.json, MCP_MAP.md. Сделай скан сайта (если есть домен): коммерческие страницы, адрес для Карт,
карточка в Яндекс Картах; собери метрики клиента (трафик и его источник, есть ли позиции, возраст сайта), доп. техчек.
Если в inputs.json address_confirmable задан (true/false) - это ответ оператора, он авторитетнее сайта: запиши это
значение в scan.address_confirmable (адрес с сайта, если найден, - в address). Сохрани scan.json и metrics.json.
```

После завершения:
- `bash .claude/hooks/update-meta.sh <strategy_dir> scan-done`
- Вывести сводку (агент уже вывел). Сразу переходить к шагу 2.5 и 3.

### 2.5. Гейт сверки ниши (сразу после скана, state остается scan-done)

Прочитать `scan.json`. Установить `inputs.niche` (поле было `null`):
- Если `scan.niche_conflict == true` → `inputs.niche = scan.niche_from_site` (скан авторитетнее догадки). В чат ОДНУ строку: «скан уточнил нишу: было „<niche_hypothesis>“ → стало „<niche_from_site>“».
- Иначе → `inputs.niche = niche_hypothesis` (гипотеза подтвердилась).

Записать обновленный `inputs.json`. Дальше `competitor-analyst` и `growth-strategist` читают `inputs.niche` как ФАКТ. Это ловит кривую нишу рано (сразу после скана), а не «в середине», когда докладывают дочерние агенты.

### 3. Конкуренты + вердикт (если state == "scan-done")

Маркер: `.claude/tmp/expected-competitor-analyst-<run_id>.txt = <strategy_dir>/competitors.json`

Делегировать `competitor-analyst`:
```
strategy_dir: <strategy_dir>
project_root: <project root>
Прочитай inputs.json, scan.json, metrics.json, MCP_MAP.md. Найди прямые конкуренты (5-8) и ориентиры (2-3) с метриками
пакетом (domains_batch: ТОП-10/50, трафик, страницы, DR), проанализируй выдачу, сформулируй вердикт.
Сохрани competitors.json и serp.json.
```

После завершения:
- `bash .claude/hooks/update-meta.sh <strategy_dir> competitors-done`
- Сводка - есть. Переход к шагу 4.

### 4. Точки роста + входы прогноза (если state == "competitors-done")

Маркер: `.claude/tmp/expected-growth-strategist-<run_id>.txt = <strategy_dir>/seo-strategiya_data.json`

Делегировать `growth-strategist`:
```
strategy_dir: <strategy_dir>
project_root: <project root>
Прочитай все JSON из <strategy_dir>, TARIFFS.md, strategy_data_schema.json (v4.0). Сформулируй 3-6 точек роста,
сними спрос ниши одним пакетным jm_wordstat (точная частота по региону клиента), Quick Wins (2-3). Собери
forecast_inputs - входы прогноза (тип бизнеса, конкуренция, трафик сейчас t0 и его источник, коммерческие страницы
сейчас и в плане, спрос, local и карточка в Картах, позиции, возраст сайта, трафик конкурентов, экономика: клиентские
значения из inputs.json как есть, остальное - оценка по нише с basis). Кривые трафика и деньги НЕ считай -
это build-forecast.mjs после тарифов; forecast_scenarios, decomposition и forecast[] не пиши.
Собери seo-strategiya_data.json по схеме v4.0 (поле tariffs пусто).
```

После завершения:
- `bash .claude/hooks/update-meta.sh <strategy_dir> growth-done`
- Сводка анализа выведена в чат (с строкой `forecast_inputs`). Переход сразу к подбору тарифов.

### 5. Тарифы (если state == "growth-done")

Маркер: `.claude/tmp/expected-tariff-architect-<run_id>.txt = <strategy_dir>/tariffs.json`

Делегировать `tariff-architect`:
```
strategy_dir: <strategy_dir>
project_root: <project root>
Прочитай seo-strategiya_data.json (с forecast_inputs), inputs.json (budget, we_develop, экономика клиента),
TARIFFS.md, RULES.md. Собери три тарифа Старт / Рост / Максимум по правилам и развилкам (тариф выше включает тариф
ниже; PA обязателен при SY или KP), акции в promos («ПФ 1=2» только по условию, «Тестовая статья в подарок»), блок
site_dev (рекомендуем ли разработку, формат и объем - без цены, цену считает скрипт). Прогноз трафика, деньги и ROMI
не считай - это build-forecast.mjs. economics_round: 0. Сохрани tariffs.json.
```

После завершения:
- `bash .claude/hooks/update-meta.sh <strategy_dir> tariffs-done`
- Сводка тарифов выведена. Переход к прогнозу.

### 5.5. Прогноз и экономика (если state == "tariffs-done")

Без агента и без MCP - детерминированный скрипт:
```
.claude\scripts\_node.cmd .claude\scripts\build-forecast.mjs <strategy_dir>
```

Скрипт читает `seo-strategiya_data.json` (`forecast_inputs`) + `tariffs.json` + `inputs.json` (экономика клиента перекрывает оценку агента) и пишет `forecast.json`: кривая трафика (мягкий потолок `traffic_cap`, с какого месяца уперлась - `capped_from_month`), обращения, выручка (с циклом сделки `economics.sales_lag_months` и повторными покупками `economics.ltv_factor`), затраты (с акциями; у нового сайта ежемесячные - с месяца запуска `launch_month`), ROMI 12 и 24 мес и окупаемость по КАЖДОМУ тарифу из его состава; `recommended_offer` (тариф, который выделит смета) и `plan_tariff` (тариф плана docx: по нему план работ, график, таблица прогноза и драйверы), `launch_month`; потери клиента сейчас (`lost_now`: `basis` competitors - разрыв с конкурентами из топа, plan - с уровнем плана к 12 мес, по базовой конверсии), ряд для графика docx (`plan_series`), проверки экономики (`checks.hard` / `checks.soft`, в т.ч. «уперся в потолок к 3-4 мес» и «трафик трех тарифов одинаковый»). В stdout - сводка по тарифам (трафик m3/m6/m12, обращения, ROMI, окупаемость).

Ветвление по exit:
- **Exit 0** - готово. Предупреждения «ЭКОНОМИКА (предупреждения)» (ROMI Роста < 100%, Рост ниже Старта по ROMI и т.п.) - не блок, запомнить для финальной сводки. `bash .claude/hooks/update-meta.sh <strategy_dir> forecast-done`, переход к шагу 6.
- **Exit 3** - нарушения тарифов, блок в stdout:
  - «ПРАВИЛА ТАРИФОВ» - скрипт проверил правила Шага 10 `tariff-architect` до расчета (выведенный или неизвестный ID, ID строчными, `DEV` в тарифе, цена не по каталогу, `total_*` не равен сумме строк, связки и пары, включение, акция «ПФ 1=2»). `forecast.json` НЕ записан;
  - «ЭКОНОМИЧЕСКИЙ ГЕЙТ» - жесткие нарушения экономики (ROMI Роста за 12 мес <= 0, чистый результат Роста меньше Старта, трафик тарифа выше ниже тарифа ниже). `forecast.json` при этом записан (`recommended_offer` в нем - тариф, который смета выделит вместо Роста, или `null`; `plan_tariff` - тариф, по которому писатель и docx строят план: `recommended_offer`, а при `null` - Рост).
  - Если в `tariffs.json` `economics_round` = 0 (или поля нет) - один круг пересборки. Маркер `expected-tariff-architect-<run_id>.txt = <strategy_dir>/tariffs.json`, делегировать `tariff-architect`:
    ```
    strategy_dir: <strategy_dir>
    project_root: <project root>
    Круг экономического гейта (economics_round: 1). build-forecast.mjs вернул нарушения:
    <блок «ПРАВИЛА ТАРИФОВ» или «ЭКОНОМИЧЕСКИЙ ГЕЙТ» из stdout дословно>
    Прогноз по текущим тарифам (если записан): <strategy_dir>/forecast.json (year1, checkpoints, drivers_m12, checks).
    Пересобери тарифы по разделу «Круг экономического гейта» своего промта и RULES.md (раздел 10).
    diagnostics и site_dev не меняй. Перепиши tariffs.json целиком с economics_round: 1.
    ```
    Затем снова `build-forecast.mjs`: exit 0 - как выше; снова exit 3 - следующий пункт.
  - Если круг уже был (`economics_round` = 1) и снова «ПРАВИЛА ТАРИФОВ» - **стоп** с показом блока: прогноза нет, тарифы нарушают правила после пересборки (дефект `tariff-architect`, сообщить владельцу).
  - Если круг уже был (`economics_round` = 1) и не пройден «ЭКОНОМИЧЕСКИЙ ГЕЙТ» - **не блокировать**. Записать предупреждение и идти дальше:
    `bash .claude/hooks/update-meta.sh <strategy_dir> forecast-done economics_warning="<нарушения одной строкой, без двойных кавычек>"`
    В чат: «Экономический гейт не пройден и после пересборки тарифов: <нарушения>. Стратегию собираю, рекомендация - в финальной сводке.» Переход к шагу 6.
- **Exit 2** - неполный или битый `forecast_inputs` (дефект `growth-strategist`): в stdout список проблем. Один круг: маркер `expected-growth-strategist-<run_id>.txt = <strategy_dir>/seo-strategiya_data.json`, делегировать `growth-strategist`:
  ```
  strategy_dir: <strategy_dir>
  project_root: <project root>
  build-forecast.mjs не принял forecast_inputs:
  <список проблем из stdout дословно>
  Допиши или исправь forecast_inputs в seo-strategiya_data.json по контракту v4.0 (точки роста и остальные поля
  не трогай). Экономику, которой нет у клиента, оцени по нише с basis. Верни только файл, в чат - 2 строки.
  ```
  После фикса ВСЕГДА пере-делегировать `tariff-architect` промтом шага 5 (маркер `expected-tariff-architect-<run_id>.txt`): тарифы собраны по неполным входам - на `t0`, `pages`, `business_type`, `demand`, экономике (`lead_value`, порог Карт) и самом наличии `forecast_inputs` стоит его диагностика и прикидка экономики. Затем снова `build-forecast.mjs` с тем же ветвлением. Снова exit 2 - стоп с показом проблем: без входов прогноза нечего строить (частый случай - нет среднего чека: спросить у клиента, записать `avg_check` в `inputs.json`, `--resume`).
- **Exit 1** - ошибка запуска (нет `seo-strategiya_data.json` / `tariffs.json`, нет тарифа Рост, битый JSON) - показать stderr, стоп.

### 6. Контент стратегии (если state == "forecast-done")

Маркер: `.claude/tmp/expected-strategy-writer-<run_id>.txt = <strategy_dir>/seo-strategiya_content.json`

Делегировать `strategy-writer`:
```
strategy_dir: <strategy_dir>
project_root: <project root>
Прочитай inputs.json, seo-strategiya_data.json, forecast.json, tariffs.json (только состав тарифа плана
forecast.plan_tariff = <plan_tariff> и site_dev.recommended), scan/metrics/competitors/serp.json, TARIFFS.md,
_services.mjs (short, client_line). Напиши seo-strategiya_content.json формата v2: title_page, summary (headline +
3 points), 4 раздела тезисными блоками - situation «Где вы сейчас», competitors «Кто в топе и почему», plan «Что нужно,
чтобы обогнать конкурентов», forecast «Прогноз» - и next_step. План и числа прогноза - по тарифу плана <plan_tariff>
(tariffs[plan_tariff]), не по Росту по умолчанию. Ни цен, ни денежных сумм, ни тарифов (слова «тариф» и названий
пакетов) в тексте: деньги, потери, план по месяцам, график и таблицу прогноза рисует сборщик по маркерам - money_lost
(situation), plan_timeline + не меньше 2 plan_item (plan), forecast_chart + forecast_table (+ forecast_drivers)
(forecast). Подача метрик по своему промту: спрос - по главным запросам (точная частота), сравнения трафика - в одной
базе, потери - по lost_now.basis, «с нуля» - только по Метрике, quick_wins без платных работ плана, без жаргона.
[если launch_month > 1: Новый сайт выходит в поиск к <launch_month>-му мес - сказать это в plan и в forecast.]
Числа - только из файлов анализа и forecast.json. Объем 4-6 страниц A4.
```
`<plan_tariff>` и `<launch_month>` - из `forecast.json` (точечно, два поля).

После завершения:
- `bash .claude/hooks/update-meta.sh <strategy_dir> content-done`

### 6.5. Проверка стратегии (если state == "content-done")

Двухслойный гейт ПЕРЕД сборкой docx (по образцу /seo-struktura шаги 9г+9д): дешевый детерминированный скрипт ловит механику, дорогой opus-верификатор ловит смысл. Общий бюджет повторов писателя на оба под-гейта = **максимум 2 суммарно** (не по 2 на каждый). После pass - один круг «только minor» (6.5в) по мелким замечаниям с готовым `fix_hint`, без повторного смыслового гейта. Ре-делегация прозы - только `strategy-writer` (parent-fallback запрещен). Docx собирается только после verdict pass.

#### 6.5а. Механический гейт

```
.claude\scripts\_node.cmd .claude\scripts\verify-strategy.mjs <strategy_dir>
```

Для контента `format: "v2"` ловит (блоки отчета):
- `СТРУКТУРА` - 4 раздела по ключам `situation` / `competitors` / `plan` / `forecast`, обязательные маркеры (`money_lost`, `plan_timeline` + 2 `plan_item`, `forecast_chart`, `forecast_table`), известные типы блоков, ID услуг в `plan_item.services` есть в каталоге;
- `ДЕНЬГИ В ПРОЗЕ` - любые суммы и валюта в строках писателя (деньги только в маркерах сборщика);
- `ТАРИФЫ В ПРОЗЕ` - слово «тариф», «Старт» / «Рост» / «Максимум» как названия пакетов, ID услуг вне `plan_item.services`;
- `СТОП-ПАТТЕРНЫ ВОДЫ`, `ТИРЕ/Е-С-ТОЧКАМИ`;
- `ОБЪЕМ (warning)` (4-6 стр, не блок), `СОСТАВ ПЛАНА (warning)` (услуги плана не из состава тарифа плана `forecast.plan_tariff`, не блок - смысл проверит 6.5б), `ЖАРГОН (warning)` (строки с пометкой `(strategy-writer)` - «вайбкод», «n-граммы» в прозе - уходят в круг «только minor» шага 6.5в; строки `(tariff-architect, ...)` - тексты сметы, в финальную сводку), `ЭКОНОМИКА (warning)` (в финальную сводку);
- `ПРОГНОЗ` - `forecast.json` сходится с независимым пересчетом модели по `forecast_inputs` + `inputs.json` + `tariffs.json` (ROMI и затраты 12 мес по каждому тарифу, потери в месяц).

Ветвление:
- **Exit 0** - к смысловому гейту 6.5б. Предупреждения (объем, состав плана) отметить в финальной сводке, не блок.
- **Exit 2** - блок. Кому чинить - по блоку «КОМУ ЧИНИТЬ» в конце stdout (без чтения данных, в духе ORCHESTRATION.md):
  - `ПРОГНОЗ` -> чинит **оркестратор, не писатель**: `forecast.json` устарел (тарифы или входы менялись после шага 5.5). Перезапустить `build-forecast.mjs <strategy_dir>` - ТОЛЬКО скрипт и ветвление по его exit, без `update-meta.sh` (статус остается `content-done`, шаг 6 заново не идет): exit 0 - сразу снова 6.5а; exit 3 - круг `tariff-architect` по шагу 5.5, только если `economics_round` еще 0, затем снова `build-forecast.mjs` и 6.5а (при `economics_round` = 1: «ЭКОНОМИЧЕСКИЙ ГЕЙТ» - предупреждение в сводку и 6.5а, «ПРАВИЛА ТАРИФОВ» - стоп); exit 2 / 1 - стоп с показом вывода. Перезапуск прогноза не тратит бюджет повторов писателя; разрешен один раз - если после него `ПРОГНОЗ` снова красный, стоп с показом вывода (расхождение модели и проверки - дефект скриптов). Числа прозы после нового прогноза могли устареть - их ловит 6.5б.
  - `СТРУКТУРА` / `ДЕНЬГИ В ПРОЗЕ` / `ТАРИФЫ В ПРОЗЕ` / `СТОП-ПАТТЕРНЫ ВОДЫ` / `ТИРЕ/Е-С-ТОЧКАМИ` -> `strategy-writer` с текстом нарушений (бюджет повторов 6.5а+6.5б = максимум 2).
  - Есть и `ПРОГНОЗ`, и блоки писателя - сначала перезапуск прогноза, потом писатель (он пишет по свежему `forecast.json`).
  - После фикса - снова `verify-strategy.mjs`.
- **Exit 1** - ошибка запуска (нет `seo-strategiya_content.json` / битый JSON) - показать stderr, стоп.

Контент без `format: "v2"` (старая задача, см. шаг 1) проверяется легаси-путем: блоки «ЦЕНЫ В ПРОЗЕ ТАРИФОВ» и т.д.; блок «СЦЕНАРНАЯ СОГЛАСОВАННОСТЬ» - дефект `forecast_scenarios`. Писатель v2 такой контент не чинит: показать нарушения пользователю и предложить пересборку по v2 (шаг 1, «Задача, начатая до v2»).

#### 6.5б. Смысловой гейт (агент)

Маркер: `.claude/tmp/expected-strategy-verifier-<run_id>.txt = <strategy_dir>/verify_report.json`

Делегировать `strategy-verifier`:
```
strategy_dir: <strategy_dir>
project_root: <project root>

Прочитай seo-strategiya_content.json (format v2) + seo-strategiya_data.json + forecast.json + tariffs.json + inputs.json
(+ scan/metrics/competitors/serp.json если есть, TARIFFS.md, _services.mjs). Тариф плана: forecast.plan_tariff =
<plan_tariff>. Проверь: числа в прозе (трафик, позиции, страницы, частоты, обращения) бьются с источниками и
forecast.json tariffs[plan_tariff]; работы в разделе plan есть в каталоге и совпадают с составом тарифа плана -
человеческими словами, без ID и цен; нет тарифов, цен и денежных сумм в прозе писателя (деньги - только в маркерах
сборщика); подача метрик (спрос - по главным запросам, точная частота, не рядом с большим трафиком без пояснения;
сравнения трафика - в одной базе, без чужого города базы); потери по lost_now.basis, «с нуля» и «0 сейчас» - только по
Метрике или с «по открытым данным», «у нас нет доступа», а не «у вас нет Метрики»; quick_wins не дублируют платные
работы плана; жаргон, единый счет конкурентов, повторы мысли; [если launch_month > 1: запуск сайта к <launch_month>-му
мес назван в plan и forecast]; вердикт не противоречит данным; объем 4-6 стр; вода сверх стоп-листа; стиль. Minor - с
готовым fix_hint; дефекты прогноза и данных - с owner forecast / data. Ничего не чини. Запиши verify_report.json.
```

После завершения - прочитать `verify_report.json` (точечно `verdict` + `counters`, не весь файл; нет `counters.minor_fixable` - посчитать minor с непустым `fix_hint` без `owner` или с `owner: "writer"`):
- `verdict == pass` - оба гейта пройдены. Есть minor писателя с `fix_hint` (`counters.minor_fixable > 0`) или строки `ЖАРГОН (warning)` с пометкой `(strategy-writer)` из последнего 6.5а - шаг 6.5в (круг «только minor»). Иначе - обновление state ниже и шаг 7.
- `verdict == needs-fix` / `fail` - пере-делегировать `strategy-writer` с issues писателя из отчета (без `owner` `forecast` / `data`; общий бюджет повторов 6.5а+6.5б = максимум 2), затем повторить 6.5а (verify-strategy.mjs) и 6.5б. После 2 повторов без pass - стоп с показом issues пользователю (docx не собираем).
- Issues с `owner` `forecast` / `data` (`counters.not_prose`) писателю не идут и verdict не меняют - запомнить для финальной сводки («Замечания проверки к прогнозу и данным»).

**Ре-делегация strategy-writer при фиксах** - тот же промт, что шаг 6, плюс строкой:
```
Учти замечания (verify-strategy.mjs / verify_report.json): <краткий список kind+where+fix_hint>. Исправь ровно это,
остальное не трогай. Верни только seo-strategiya_content.json, содержимое в чат не выводи.
```

#### 6.5в. Круг «только minor» (после pass, один раз на задачу)

Смысловой гейт пройден, но в отчете остались мелкие правки с готовым `fix_hint` (повторы, жаргон, подписи, отсчеты). Docx с ними не собираем - один круг правок писателя без повторного смыслового гейта:
1. Сохранить копию прошедшего текста: `<strategy_dir>/seo-strategiya_content.verified.json` (копия `seo-strategiya_content.json` как есть).
2. Маркер `expected-strategy-writer-<run_id>.txt = <strategy_dir>/seo-strategiya_content.json`, делегировать `strategy-writer` - промт шага 6 плюс:
   ```
   Режим: только minor (verdict pass, смысловой проверки после этого круга не будет). Примени fix_hint точечно:
   <список minor писателя: kind + where + fragment + fix_hint; строки ЖАРГОН (warning) с пометкой (strategy-writer)>
   Новых чисел не добавляй (кроме названных в fix_hint), структуру и другие блоки не трогай. Что нельзя применить
   без нарушения правил - пропусти и назови в сводке. Верни только seo-strategiya_content.json.
   ```
3. `bash .claude/hooks/update-meta.sh <strategy_dir> content-done minor_round=done` (на `--resume` повторный 6.5б не нужен).
4. Только 6.5а (`verify-strategy.mjs`), без 6.5б:
   - exit 0 - удалить копию `.verified.json`, обновление state ниже, шаг 7;
   - exit 2 с блоками писателя - один фикс `strategy-writer` по нарушениям (промт ре-делегации выше) и снова 6.5а; снова exit 2 - переместить копию `.verified.json` на место `seo-strategiya_content.json` (она прошла оба гейта), снова 6.5а для подтверждения, непримененные minor - в финальную сводку;
   - exit 2 с `ПРОГНОЗ` - как в 6.5а (перезапуск прогноза), затем полный 6.5 заново: новые числа прогноза проверяет 6.5б;
   - exit 1 - стоп с показом stderr.

Круг не тратит бюджет повторов 6.5а+6.5б и бывает один раз: после него minor из нового отчета (если 6.5б все же перезапускался) идут в финальную сводку, а не в новый круг.

Когда ОБА гейта прошли (verify-strategy exit 0 И strategy-verifier verdict pass) и круг «только minor» сделан или не нужен:
- `bash .claude/hooks/update-meta.sh <strategy_dir> strategy-verified`
- Переход к шагу 7.

### 7. Сборка docx (если state == "strategy-verified")

**Предусловие - pass.** Перед сборкой прочитать `verify_report.json` точечно (`verdict`): `pass` - собирать. Отчета нет или verdict не `pass` (ручной `--resume`, текст менялся после проверки) - docx НЕ собирать: `update-meta.sh <strategy_dir> content-done` и шаг 6.5. Собрать docx «как есть» при needs-fix / fail нельзя ни по таймауту, ни «чтобы показать» - только если пользователь сам явно велел, и тогда с пометкой в финальной сводке «docx собран без прохождения проверки».

```
.claude\scripts\_node.cmd .claude\scripts\build-strategy-docx.mjs <strategy_dir>
```

Скрипт читает `seo-strategiya_content.json` + `forecast.json` + `tariffs.json` + `inputs.json`, генерирует `<strategy_dir>/SEO_Strategy_<slug>.docx`:
- обложка-баннер (домен, ниша, регион, дата) и «Главное за одну минуту»: 3 KPI-плитки из `forecast.json` (рост трафика за 12 мес по тарифу плана, сколько обращений в месяц клиент недополучает - уходит к конкурентам при `lost_now.basis` competitors, против уровня года при plan, сколько выручки в месяц недополучает) + «Коротко» из `summary` писателя;
- 4 раздела тезисными блоками (каждый с новой страницы); маркеры заполняет сборщик по тарифу плана `forecast.plan_tariff`: `money_lost` (деньги, которые клиент теряет: воронка переходы -> обращения -> продажи -> выручка по `lost_now` + допущения), `plan_timeline` (план работ по месяцам 1-12 по составу тарифа плана: разовые `PA -> SY -> KP -> FQ`, новый сайт - строка «Разработка и запуск сайта», ежемесячные полосой с месяца запуска `launch_month`), `forecast_chart` (трафик по месяцам, у нового сайта - с подписью о запуске), `forecast_table` (сейчас / 3 / 6 / 12 мес с планом и без работ, прирост обращений и выручки с циклом сделки), `forecast_drivers` (за счет чего рост);
- ни цен, ни тарифов, ни слова «тариф». Дизайн-система - `docs/design-strategy-docx.md` (Arial, таблицы с заливкой, без плавающих фигур - переживает конверсию в Google Docs).

Предупреждения скрипта (stdout) - в финальную сводку. Exit 1 «content v2 требует forecast.json» - вернуться к шагу 5.5 (`update-meta.sh <strategy_dir> tariffs-done`); прочие exit 1 - показать stderr, стоп. Контент без `format: "v2"` (старая задача) собирается старым рендером 6 разделов.

`bash .claude/hooks/update-meta.sh <strategy_dir> docx-done`

### 8. Сборка xlsx (если state == "docx-done")

```
.claude\scripts\_node.cmd .claude\scripts\build-smeta-xlsx.mjs <strategy_dir>
```

Скрипт читает `tariffs.json` + `forecast.json` + `seo-strategiya_data.json` (`forecast_inputs`) + `inputs.json`, генерирует `<strategy_dir>/Smeta_<slug>.xlsx` - 6 листов:
1. **«Сравнение тарифов»** (первым): Старт / Рост / Максимум колонками - разово, ежемесячно, состав коротко, акции, трафик к 3/6/12 мес, дополнительных обращений в месяц к 12 мес, вложения за 12 мес, чистый результат 12 мес, ROMI 12 мес, окупаемость, ROMI 24 мес; при ROMI 12 мес <= 0 - строка «Окупится за 12 мес, если» (чек и конверсия безубыточности); рекомендованный выделен (`forecast.recommended_offer`: Рост; при проваленном экономическом гейте - тариф с лучшим чистым результатом за 12 мес, если он в плюсе, иначе ни один - вместо рекомендации строка «дадим после уточнения чека и маржи»); блок «Дополнительно» - спец-предложения `tariffs.special` (сателлит).
2. **«Старт»**, 3. **«Рост»**, 4. **«Максимум»**: услуги с ценами и формулами SUM, строка «почему этот вариант» (`hint`), акции строками (тестовая статья - «3 000 ₽ -> 0 ₽ (акция)»), порядок оплаты с учетом «ПФ 1=2».
5. **«Разработка сайта»**: формат и база по формуле калькулятора (`devPrice` из `_services.mjs`), что входит, опции строками без суммы (цена или «по расчету»), зачет стоимости прототипа при `KP` в Росте, акция «ПФ 1=2» при разработке у нас, пометка «рекомендуем» / «по запросу» (`site_dev.recommended`).
6. **«Окупаемость»**: параметры (средний чек, конверсия, закрытие, маржа - ячейки ввода с подписью источника: правишь - пересчитываются лист и «Сравнение тарифов»), по каждому тарифу 12 месяцев + «Итого год» + «2-й год» (трафик из модели, прирост к сегодняшнему, обращения, продажи, выручка, валовая прибыль, затраты с акциями, результат нарастающим итогом - формулами; у нового сайта ежемесячные затраты - с месяца запуска), под таблицей ROMI 12 мес, окупаемость, ROMI 24 мес, при ROMI <= 0 - условие безубыточности («Тариф окупается за 12 мес при среднем чеке от ... или конверсии от ...»); методика - строкой `assumptions_note` (с повторными покупками, циклом сделки и месяцем запуска).

Предупреждения stdout:
- «forecast.json не совпадает с пересчетом по tariffs.json» - после 6.5а так быть не должно (там та же сверка). Если все же - перезапустить только `build-forecast.mjs`, без `update-meta.sh` (статус не откатывать): exit 0 - шаги 7 и 8 заново (KPI docx тоже из `forecast.json`); любой другой exit - стоп с показом вывода (тарифы или входы менялись после проверки стратегии - дефект, сообщить владельцу).
- «ROMI листа «Окупаемость» расходится с forecast.json» - не блок, отметить в финальной сводке (дефект формул сметы, сообщить владельцу).

Легаси: нет `forecast.json` (старая задача) - старые листы: 3 тарифа + «Декомпозиция и окупаемость» по `forecast_scenarios` / `decomposition` без изменения чисел (`_forecast-money.mjs`).

`bash .claude/hooks/update-meta.sh <strategy_dir> xlsx-done`

### 9. Загрузка в Google Drive (если state == "xlsx-done")

Финальные .docx и .xlsx грузим в Drive с **автоконверсией в Google Workspace** - команда сразу редактирует/комментирует в браузере. Локальные файлы остаются как резерв-оригинал.

**Предусловие:** MCP `gdrive-piotr` подключен глобально, OAuth пройден один раз. См. ADR-008.

#### 9a. Прочитать конфиг папок

`~/.claude/seo-knowledge/DRIVE.md` - извлечь ID двух якорь-папок:
- `strategies_folder_id` - папка для стратегий (расшарена «anyone with link → reader»)
- `smety_folder_id` - папка для смет (то же самое)

Если файл DRIVE.md не существует или ID не находятся - пропустить весь шаг 9, перейти к шагу 10 с пометкой в meta `share_skipped: "drive_config_missing"`. Пользователю в финальном выводе сообщить, что Drive-загрузка пропущена.

#### 9b. Загрузить стратегию (.docx → Google Doc)

```
mcp__gdrive-piotr__uploadFile(
  localPath: <абсолютный путь к SEO_Strategy_<slug>.docx>,
  name: SEO_Strategy_<slug>,
  parentFolderId: <strategies_folder_id>,
  mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  convertToGoogleFormat: true
)
```

**`convertToGoogleFormat: true`** - Google Drive автоматически превратит .docx в нативный Google Doc. Команда открывает в браузере, может комментировать, редактировать совместно, делиться через стандартные Google-механизмы.

Из ответа сохранить: `id`, `link` (viewLink).

#### 9c. Загрузить смету (.xlsx → Google Sheet)

```
mcp__gdrive-piotr__uploadFile(
  localPath: <абсолютный путь к Smeta_<slug>.xlsx>,
  name: Smeta_<slug>,
  parentFolderId: <smety_folder_id>,
  mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  convertToGoogleFormat: true
)
```

Формулы (`=SUM(...)`, формулы листа «Окупаемость» и ссылки «Сравнения тарифов» на другие листы) корректно конвертируются в Google Sheets. Форматирование Arial и темно-синие заголовки сохранятся.

#### 9d. Записать share.json

`<strategy_dir>/share.json`:
```json
{
  "shared_at": "<ISO UTC>",
  "shared_by": "tem11134v2@gmail.com",
  "converted": true,
  "strategy": {
    "filename": "SEO_Strategy_<slug>",
    "drive_id": "<id>",
    "view_link": "<viewLink>",
    "parent_folder_id": "<strategies_folder_id>",
    "mime_type": "application/vnd.google-apps.document"
  },
  "smeta": {
    "filename": "Smeta_<slug>",
    "drive_id": "<id>",
    "view_link": "<viewLink>",
    "parent_folder_id": "<smety_folder_id>",
    "mime_type": "application/vnd.google-apps.spreadsheet"
  }
}
```

#### 9e. Обновить meta

`bash .claude/hooks/update-meta.sh <strategy_dir> shared`

#### Что делать при ошибке Drive-загрузки

Если MCP не отвечает, OAuth протух, или вернулась ошибка - **не блокировать `/seo-strategiya`**. Локальные файлы и так готовы. Действия:
1. Записать в `meta.json` поле `share_error: "<краткое описание>"` (через update-meta или вручную через Edit).
2. НЕ переходить в `shared` - оставить state `xlsx-done`.
3. В шаге 10 сообщить пользователю: «Локально готово. Расшаривание в Drive не удалось (причина). Запусти `/share-strategy <NNN>` отдельно после исправления.»

Это дает устойчивость: даже если Drive временно недоступен, стратегия не теряется.

### 10. Финал (если state == "shared" или state == "xlsx-done")

`bash .claude/hooks/update-meta.sh <strategy_dir> completed`

Финальный коммит в worktree-ветку:
```
git add -A
git commit -m "Strategy <NNN> for <domain>: completed"
```

Для блока «Экономика» прочитать точечно из `forecast.json`: `plan_tariff`, `recommended_offer`, `launch_month`, `tariffs.{start,growth,max}.year1.romi`, `tariffs[plan_tariff].year2.romi` и `.payback_month` (`null` = больше 24 мес), `checks.soft`, `inputs.economics` (`avg_check` и `avg_check_source`, `conversion_rate`, `close_rate`, `margin`, `model`, `ltv_factor` и `ltv_source`, `sales_lag_months`), `inputs.economics_from_client`; из `meta.json` - `economics_warning` (если был); из `verify_report.json` - issues с `owner` `forecast` / `data` (если есть); предупреждения шагов 6.5а, 6.5в, 7 и 8, если печатались. Названия: `start` - Старт, `growth` - Рост, `max` - Максимум.

Если шаг 9 прошел успешно (`state` был `shared` перед `completed`), вывести:
```
═══ СТРАТЕГИЯ ГОТОВА ═══

Клиент: <domain>

📄 Стратегия (Google Doc, для команды и клиента; 4 раздела, без цен и тарифов):
   <view_link>

📊 Смета (Google Sheet, с ценами: сравнение тарифов, Старт/Рост/Максимум,
   разработка сайта, окупаемость):
   <view_link>

Оба файла доступны по ссылке любому без логина (anyone with link → reader),
команда может редактировать и комментировать прямо в браузере.

Экономика (ROMI от валовой прибыли, деньги - только с прироста к текущему трафику):
   ROMI 12 мес: Старт <a>% | Рост <b>% | Максимум <c>%
   План в стратегии: по тарифу <Старт | Рост | Максимум> (plan_tariff); смета рекомендует
      <тариф | ни один - «дадим после уточнения чека и маржи»>
   <Тариф плана>: окупаемость <N> мес (или «больше 24 мес»), ROMI 24 мес <d>%
   [Если plan_tariff != growth: план работ, график и прогноз в docx - по <тарифу плана>, а не по Росту
    (экономический гейт не пройден; Рост и Максимум остаются в смете для сравнения)]
   [Если launch_month > 1: Новый сайт: в поиске к <N>-му мес - новые страницы работают и ежемесячные
    работы оплачиваются с этого месяца; в docx это сказано в плане и прогнозе]
   Допущения: средний чек <X> руб (<от клиента | по ценам сайта | оценка>), конверсия <C>%
      [, закрытие <Z>%], маржа <M>%
   Повторные покупки: x<L> за год (<от клиента | оценка агента | по умолчанию для ниши>)
      [при ltv_factor = 1: «не учитываются»]
   [Если sales_lag_months > 0: Цикл сделки: <N> мес - продажа идет через <N> мес после обращения,
    выручка и окупаемость сдвинуты на этот срок]
   [Предупреждения: checks.soft построчно; потолок к 3-4 мес или одинаковый трафик тарифов -
    «проверить спрос (формы с городом и областью, общие запросы) и трафик конкурентов в forecast_inputs»]
   [Замечания проверки к прогнозу и данным: issues verify_report с owner forecast / data - where + what одной строкой]
   [Если круг «только minor» откатился на проверенную копию: непримененные minor - where + fix_hint]
   [Если economics_warning: Экономический гейт не пройден и после пересборки тарифов: <нарушения>.
    Что сделать до отправки клиенту:
    1. Подтвердить у клиента средний чек, маржу и конверсию сайта (сейчас: чек - <от клиента |
       по ценам сайта | оценка>, маржа - <от клиента | оценка>, конверсия - <от клиента | оценка>;
       [повторные покупки x<L> и цикл сделки <N> мес - тоже]): это главные рычаги окупаемости.
    2. Сверить с клиентом точку безубыточности из сметы: лист «Сравнение тарифов», строка «Окупится
       за 12 мес, если» (чек и конверсия, при которых тариф выходит в ноль за год), и та же строка
       под таблицей тарифа на листе «Окупаемость». Реальные чек и конверсия не ниже точки - вписать
       их и пересчитать; ниже - предлагать разовые работы (PA + SY + KP) или Старт, а не ежемесячный
       тариф.
    3. Пересчет: подтвержденные значения - в inputs.json (avg_check + avg_check_source "client",
       margin, conversion_rate, close_rate), update-meta.sh <strategy_dir> tariffs-done,
       /seo-strategiya --resume.]

Стратегия - без цен и тарифов. Тарифы, разработка сайта и окупаемость - в смете.

Локальные оригиналы (резерв):
   <strategy_dir>/SEO_Strategy_<slug>.docx
   <strategy_dir>/Smeta_<slug>.xlsx

Данные анализа: <strategy_dir>/seo-strategiya_data.json
Тарифы:         <strategy_dir>/tariffs.json
Прогноз:        <strategy_dir>/forecast.json
Ссылки:         <strategy_dir>/share.json

⚠️ НЕ ЗАБУДЬ /handoff перед закрытием сессии - иначе файлы останутся
   в worktree и не попадут в основную папку проекта.
═══════════════════════
```

Если шаг 9 был пропущен (`state` остался `xlsx-done`) - вывести fallback:
```
Готово локально. Drive-расшаривание не выполнено.
Причина: <из meta.share_error / share_skipped>

Локальные файлы:
   <strategy_dir>/SEO_Strategy_<slug>.docx
   <strategy_dir>/Smeta_<slug>.xlsx

Экономика: <тот же блок, что выше>

Стратегия - без цен и тарифов. Тарифы, разработка сайта и окупаемость - в смете.

Когда исправишь Drive (см. README troubleshooting), запусти:
   /share-strategy <NNN>

⚠️ /handoff также не забыть.
```

## Параллельная работа

Несколько стратегий одновременно - каждая в своем worktree:
```
claude --worktree strat-002
```

Состояния не пересекаются.

## Запреты

- НЕ пиши результаты в корень проекта (никакого `SEO_Strategy_*.docx` в корне) - только в `<strategy_dir>/`. Иначе pre-commit отклонит.
- НЕ пропускай состояния - каждое `update-meta.sh` обязательно (включая `forecast-done`).
- НЕ считай прогноз, деньги, ROMI и окупаемость сам и НЕ правь `forecast.json` руками - только `build-forecast.mjs`. Поменялись тарифы или экономика - перезапусти скрипт.
- НЕ пропускай в стратегию (.docx) цены, тарифы и денежные суммы из прозы - деньги рисует сборщик из `forecast.json`, тарифы и цены живут только в смете.
- НЕ собирай docx без verdict pass в `verify_report.json` (шаг 7, предусловие) и до круга «только minor» (6.5в), если он нужен.
- НЕ редактируй методологию (TARIFFS.md, RULES.md) - это `~/.claude/seo-knowledge/`, read-only.
- НЕ используй длинное тире (—) и среднее (–). Только дефис (-).
- НЕ используй букву ё - всегда пиши е. Правило для всех клиентских текстов и метатегов (как и запрет тире).
- НЕ делай `git push` и не публикуй артефакты - это решение пользователя.
- НЕ запускай `/seo-statya`, `/seo-temi` из этой же сессии - это отдельные worktree-задачи.
