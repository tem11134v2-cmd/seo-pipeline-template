# MCP-карта для /seo-structure

> Какие MCP-инструменты использовать на каком шаге. Принцип: экономия контекста + одна голова на этап. Не вызывай всё подряд - бери только нужное для текущего этапа.

---

## Основные инструменты

### Keyso

| Тул | Что даёт | Шаг | Лимит |
|---|---|---|---|
| `domain_pages` | Страницы домена с числом запросов в ТОП | 1 (по каждому из 6-10 конкурентов + клиент если есть) | 6-11 |
| `domain_keywords` | Запросы страницы конкурента | 2 (по каждой странице мастер-списка - до 5 фолбэков на лидера + остальных конкурентов) | 15-40 |
| `keyword_info` | SERP по запросу + частотность | 2 (фолбэк 2) + редко на главной | 3-10 |
| `keyword_similar` | Похожие запросы | 2 (фолбэк 3) | 2-5 |

**Параметры:**

- Во всех вызовах Keyso передавай `base="<inputs.keyso_base>"`.
- **IDN-домен в кириллице, не в Punycode.** Для `ремонт-квартир-днр.рф` нужен именно `ремонт-квартир-днр.рф`, а не `xn--...`. Punycode даёт «домен не найден».

```
domain_pages(domain="leader.ru", base="spb", sort="it50|desc", per_page=50)
domain_keywords(domain="leader.ru", url="https://leader.ru/services/repair", base="spb")
keyword_info(keyword="ремонт квартир", base="spb")
keyword_similar(keyword="ремонт квартир", base="spb")
```

### JustMagic (JM)

| Тул | Что даёт | Шаг | Лимит |
|---|---|---|---|
| `jm_account` | Баланс + расчёт стоимости | 4 (один раз перед запуском) | 2 |
| `jm_semantic_pack` | Топ-30 запросов на маркер пакетом | 4 (один вызов на все маркеры) | 1 |
| `jm_wordstat` | Резервная частотность пакетно | 2 + 4 (если Keyso/JM не дали данных) | до 3 |

**Параметры:**

- `region` в JM - это **код Яндекса** (`213` = Москва, `2` = СПб), **не** Keyso-base. Берётся из `inputs.region_yandex`.
- `jm_semantic_pack(markers=[...], region=<region_yandex>, top_n=30, dry_run=false)`.
- Перед `jm_semantic_pack` обязательно проверить баланс через `jm_account(mode="info")` и оценить стоимость через `jm_account(mode="cost", task="mark_onl", cost_data="...")`. См. также `check-jm-balance.sh` hook.

### Wordkeeper (WK)

| Тул | Что даёт | Шаг |
|---|---|---|
| `wk_check_frequency` | Резервная частотность массово до 1000 фраз | 2 + 4 (как массовый резерв вместо jm_wordstat) |

### Wordstat

| Тул | Что даёт | Шаг |
|---|---|---|
| `mcp_wordstat_get_regions_tree` | Код региона Яндекса | 1 (только если `brief.region` не в стандартном списке кодов) |

Стандартный список (зашит в скиле):
```
Москва: 213, СПб: 2, Екатеринбург: 54, Краснодар: 35, Новосибирск: 65,
Казань: 43, Н.Новгород: 47, Челябинск: 56, Самара: 51,
Ростов: 39, Воронеж: 193, Уфа: 172, Пермь: 50, Омск: 66,
Волгоград: 38, Красноярск: 62, Минск: 157, Тюмень: 55, Тула: 15, Томск: 67
```

### Арсенкин

| Тул | Что даёт | Шаг |
|---|---|---|
| `arsenkin_top` | ТОП-10 SERP по запросу | 2 (опц. при сомнениях в маркере - проверка типа сайтов в выдаче) |

Использовать **только** при спорных маркерах (назначены через фолбэк 3-4, непонятный интент). Не для каждой страницы.

### Fetch

| Тул | Что даёт | Шаг |
|---|---|---|
| `mcp_fetch_page` / `web_fetch` | Парсинг страницы | 1 (типизация спорных URL - 5-10 страниц) |

### Drive (gdrive-piotr)

| Тул | Что даёт | Шаг |
|---|---|---|
| `mcp__gdrive-piotr__uploadFile` | Загрузка xlsx в Drive + конверсия в Google Sheet | 7 (после xlsx-built) |
| `mcp__gdrive-piotr__deleteItem` | Удаление старого файла при перезаливке | 7 (в /share-structure --redo) |

---

## НЕ использовать в /seo-structure

| MCP | Почему |
|---|---|
| `jm_text_generate` / `jm_text_analyze` | Для написания статей, не для структуры |
| `domain_dashboard` (Keyso) | Используется в `/seo-analysis`. Здесь данные уже в competitors.json |
| `domain_competitors` (Keyso) | Конкуренты уже отобраны в analysis-step |
| Webmaster (wm_*) | Доступы клиента не нужны для построения структуры |
| Метрика (ym_*) | То же |
| SpeedyIndex (speedyindex_*) | Не нужно проверять индексацию |
| Sheets MCP | Артефакт A6.xlsx - локальный + Drive, не через Sheets API |
| Telegram (tg_*) | Не относится |

---

## Типовой порядок вызовов (всего ~30-60 на одну структуру)

```
--- master-list-builder (шаг 1) ---
1.  domain_pages(× 6-10 конкурентов)             # сбор страниц
2.  domain_pages(клиент)                          # если есть домен
3.  mcp_fetch_page(× до 10)                       # типизация спорных URL
4.  mcp_wordstat_get_regions_tree                 # только если region не в списке

--- marker-finder (шаг 2) ---
5.  domain_keywords(× 1-3 на каждую страницу)    # каскад через лидера + конкурентов
6.  keyword_info(× 5-10)                          # фолбэк 2
7.  keyword_similar(× 2-5)                        # фолбэк 3
8.  jm_wordstat(пакетно)                          # резерв частотности
    ИЛИ wk_check_frequency(массово)
9.  arsenkin_top(× 0-3)                           # опц. при сомнениях

--- semantic-expander (шаг 3) ---
10. jm_account(mode="info")                       # баланс
11. jm_account(mode="cost", task="mark_onl", ...) # оценка
12. jm_semantic_pack(пакетно, top_n=30)           # один вызов на все маркеры
13. jm_wordstat / wk_check_frequency              # резерв для JM-запросов без частотности

--- select-top10.mjs (шаг 4а) ---
   (без MCP - детерминированный скрипт)

--- cannibalization-resolver (шаг 4б) ---
   (без MCP - только Read/Write)

--- build-structure-xlsx.mjs (шаг 5) ---
   (без MCP - Node-скрипт)

--- Drive upload (шаг 6) ---
14. mcp__gdrive-piotr__uploadFile                 # один файл

--- import-structure.mjs (шаг 9) ---
   (без MCP - Node-скрипт)

--- structure-writer (шаг 10) ---
   (без MCP - только Read/Write)
```

**Бюджет:** ~30-60 MCP-вызовов на структуру. JM `semantic_pack` - один большой вызов (это норма для JM).

---

## Что делать при ошибках MCP

| Ошибка | Действие |
|---|---|
| Keyso вернул пустые данные на странице конкурента | Перейти к следующему конкуренту в каскаде |
| `keyword_info` показал 0 частотность | `keyword_similar` -> синоним. Если и там нет - `wk_check_frequency` |
| JM баланс < стоимости `semantic_pack` | Стоп, спросить пользователя - разбить маркеры на приоритетные / остальные? |
| `jm_semantic_pack` вернул 0 результатов по маркеру | Проверить опечатку, попробовать синоним через `keyword_similar`, иначе пометить страницу «семантика не найдена» |
| `mcp_fetch_page` 403/404/timeout | Попробовать `web_fetch`. Если оба не работают - оставить страницу с типом «не определён» и пометкой `fetch_failed: true` |
| Drive `convertToGoogleFormat: true` упал | Fallback на `false`, в сводке - подсказка активировать Sheets API |
| Превышен бюджет (>60 вызовов) | Прекратить добор фолбэков, перейти к следующему этапу с тем что есть |

---

## Кеш и идемпотентность

- `master_list.json`, `markers.json`, `semantic_pack.json`, `top10.json`, `cannibalization.json` - каждый шаг при `--resume` проверяет наличие своего выходного файла и пропускает, если он есть.
- JM `semantic_pack` стоит ~3-15 руб. за вызов. **Никогда не пересчитывать без явной необходимости** - результат в `semantic_pack.json`.
- Drive `share.json` хранит `drive_file_id` для перезаливки через `/share-structure --redo`.
