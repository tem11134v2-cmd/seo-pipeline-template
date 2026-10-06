# MCP-карта для /seo-strategiya

> Какие MCP-инструменты использовать на каком этапе и с какими ТОЧНЫМИ параметрами. Принцип: экономия контекста и вызовов - пакетные инструменты вместо вызовов по одному. Не вызывай все подряд - бери только нужное для текущей задачи.
>
> Сверено со схемами инструментов 06.10.2026 (стратегия v2: прогноз по `forecast_inputs`).

---

## Основные инструменты

### Keyso (основной аналитический)

| Тул | Что дает | Когда | Лимит |
|---|---|---|---|
| `domain_dashboard` | DR, ТОП-1/3/5/10/50, трафик, страниц, история (`include_history`) | Клиент: первичная оценка на обеих базах | 1-2 на клиента |
| `domains_batch` | Пакет доменов одним вызовом: `type="organic"` -> `top10;top50;traffic;pages;ads;ad_kw`; `type="links"` -> `DR;in_links;out_links;ref_domains;ips;traffic` | Метрики ВСЕХ конкурентов (кандидаты, прямые, ориентиры) | 2-3 на стратегию |
| `domain_competitors` | Список конкурентов по пересечению семантики | Поиск конкурентов (если есть домен с видимостью) | 1-2 |
| `domain_pages` | Страницы домена с кол-вом запросов в ТОП | Какие страницы конкурента работают (топ-3 прямых) | 1 на домен |
| `keyword_info` | SERP ТОП-50 по запросу + частоты `ws` (широкая) / `wsk` (точная) | Анализ выдачи по 3-5 запросам; позиция клиента в выдаче | 3-5 |
| `domain_keywords` | Запросы домена с позициями и частотами (`word, ws, wsk, pos, url`) | Оценка трафика клиента по позициям; добор маркеров спроса у лидера | 0-2 |
| `keyword_similar` | Похожие запросы | Расширение семантики (опц.) | по необх. |

**Параметры (двойная база, точка 4):** `keyso_base_primary` (всегда msk) - полнота пула конкурентов и рыночный потолок, страховка от пустых данных. `keyso_base_local` (база города или null) - реальные локальные позиции и локальные игроки. Метрики клиента и поиск пула - на ОБЕИХ базах; метрики конкурентов - пакетом на msk (+ один пакет на локальной для трафика в городе); выдача (`keyword_info`) - на локальной, если задана.

**Кириллический IDN-домен** (например `ремонт-квартир-днр.рф`) передавай в Keyso **в кириллице**, не в Punycode (`xn--80aeklehhe9ape7g.xn--p1ai`). Keyso работает с кириллической формой. Punycode даст «домен не найден». В `domains_batch` домена нет в ответе - один повтор в другой форме, снова нет - `null` (не ноль).

```
domain_dashboard(domain="site.ru", base="msk", include_history=true)    # клиент: msk (потолок) + история
domain_dashboard(domain="site.ru", base="spb")                          # клиент: + локальная (если задана)
domain_competitors(domain="site.ru", base="msk")                        # пул: msk (+ проход на spb для локалов)
domains_batch(domains="a.ru,b.ru,c.ru", base="msk", type="organic")      # конкуренты: top10;top50;traffic;pages
domains_batch(domains="a.ru,b.ru,c.ru", base="msk", type="links")        # конкуренты: DR (traffic отсюда НЕ брать)
domains_batch(domains="a.ru,b.ru,c.ru", base="spb", type="organic")      # конкуренты: трафик в городе (если spb задана)
keyword_info(keyword="запрос", base="spb")                               # выдача + ws/wsk + позиция клиента в ТОП-50
domain_pages(domain="leader.ru", base="msk", sort="it50|desc", per_page=10)  # лидеры: msk
domain_keywords(domain="site.ru", base="spb", filter="pos<=20", sort="wsk|desc",
                fields="word,ws,wsk,pos,url", per_page=100)              # оценка трафика клиента по позициям
domain_keywords(domain="leader.ru", base="spb", filter="pos<=10", sort="wsk|desc",
                fields="word,ws,wsk,pos,url", per_page=100)              # кандидаты в маркеры спроса
```

В `keyword_info` и `domain_keywords`: `ws` - широкая частота базы Keyso, `wsk` - точная («!»). Это частоты базы Keyso (ее региона), а не Wordstat региона клиента: для точек роста и спроса ниши - пакетный `jm_wordstat` (ниже).

### Частотность и сезонность (Wordstat)

| Тул | Что дает | Когда |
|---|---|---|
| `jm_wordstat` (mode="frequency") | Частотность СПИСКА фраз одним вызовом; `freq_types` по умолчанию `["exact"]` - точная `"!слово1 !слово2"`; около 0,02 за фразу | ОДИН пакетный вызов `growth-strategist`: маркеры спроса + запросы доказательств (до ~70 фраз) |
| `wk_check_frequency` | Частотность до 1000 фраз (строка, фразы через перевод строки) | Запасной путь к `jm_wordstat` |
| `arsenkin_wordstat` (mode="frequency") | Частотность списка, до 4 регионов | Второй запасной путь |
| `arsenkin_wordstat` (mode="dynamics") | Динамика по месяцам (сезонность) | Проверка сезонности (опц., 1 вызов) |
| `jm_semantic_pack` / `jm_suggest` / `arsenkin_wordstat` (mode="parsing") | Расширение семантики: маркер -> похожие запросы с частотой | Когда нужен массив похожих запросов (редко) |

```
jm_wordstat(mode="frequency", keywords=["химчистка дивана", "химчистка ковров", ...], region=2, freq_types=["exact"])
                                                    # ОДИН вызов на все фразы; регион - inputs.region_id (null -> 0, вся Россия)
wk_check_frequency(keywords="химчистка дивана\nхимчистка ковров", geo=2, operator="exact")      # запасной
arsenkin_wordstat(mode="frequency", queries=["химчистка дивана", ...], regions=[2], ws=["exact"]) # запасной 2
arsenkin_wordstat(mode="dynamics", queries=["химчистка дивана"], region=2, group="month",
                  startdate="<сегодня минус 24 мес, YYYY-MM-01>", enddate="<конец прошлого месяца>")  # сезонность
```

**Звать Wordstat по одной фразе запрещено** - у всех трех инструментов параметр-список (`keywords` / `queries`). Параметров `phrase` и `keyword` у них нет: неверное имя параметра молча дает пустой вызов.

Регион Wordstat: дерево регионов живым инструментом не отдается, берем код из зашитого списка (Москва 213, СПб 2, ...) - он уже в `inputs.region_id`. Геозависимость запроса при необходимости проверяет `arsenkin_commerce`.

### Выдача и страницы

| Тул | Что дает | Когда |
|---|---|---|
| `arsenkin_top` | Домены/URL топа по запросам + регион (`queries=[...]`, `se=[{"type": 2, "region": <код>}]`, `depth` 10/20/30, `is_snippet`); регион задается ТОЛЬКО внутри `se` - параметра region на верхнем уровне нет, переданный там код молча игнорируется и выдача приходит московская десктопная; альтернативы keyso `check_top` / `history_serp` | (1) Карты: брендовый запрос «<компания> <город>» - есть ли карточка `yandex.ru/maps/org` в ТОП-10 (сканер); (2) город не в базе Keyso - локальные игроки по топонимному запросу (конкуренты) |
| `seo_fetch_page` / `seo_fetch_batch` (profile="content") | Статический HTTP-фетч + разбор контента (JS не рендерится); не-HTML тело (robots, sitemap) - в `body_raw` | Скан сайта клиента (с контактами), sitemap клиента и топ-3 конкурентов, ключевые страницы конкурентов |

```
arsenkin_top(queries=["<компания> <город>"], se=[{"type": 2, "region": 2}], depth=10, is_snippet=true)   # Карты по бренду
seo_fetch_page(url="https://site.ru/", profile="content")                                              # один URL
seo_fetch_batch(urls=["https://site.ru/uslugi/", "https://site.ru/kontakty/"], profile="content")       # веер
seo_fetch_batch(urls=["https://a.ru/sitemap.xml", "https://b.ru/sitemap.xml", "https://c.ru/sitemap.xml"])  # карты сайтов топ-3
```

Страницы `yandex.ru/maps` статическим фетчем не открываем (капча) и капчу не обходим.

### Арсенкин (точечно)

| Тул | Что дает | Когда |
|---|---|---|
| `arsenkin_domains` | `mode="whois"` - дата регистрации домена; `mode="iks"` - ИКС Яндекса | Один вызов в начале на клиента |
| `arsenkin_indexation` | Альтернатива SpeedyIndex для индексации | Опц. |

```
arsenkin_domains(mode="whois", queries=["site.ru"])
```

Остальные Арсенкин-тулы (парсинг выдачи, кластеризация, позиции) для стратегии **избыточны**.

### SpeedyIndex

| Тул | Что дает | Когда |
|---|---|---|
| `speedyindex_check` | Проверка индексации URL: `engine="yandex"` (обязателен), `urls` - возвращает `task_id` | 5-10 ключевых страниц клиента |
| `speedyindex_tasks` | Отчет по задаче: `engine="yandex"`, `task_type="checker"`, `task_ids=[task_id]`, `report=true` | Итог «X из Y в индексе» после `speedyindex_check` |
| `speedyindex_balance` | Остаток | Перед массовой проверкой |

### Встроенные Claude

| Тул | Когда |
|---|---|
| `web_fetch` | Вторичный деградированный fallback к `seo_fetch_page` (теряет мету/структуру/HTTP-статус): детальный просмотр страницы конкурента, если seo-fetch недоступен. robots.txt / sitemap.xml лучше брать через `seo_fetch_page(url)` (не-HTML тело придет в `body_raw`) |
| `web_search` | Поиск ниши/клиента, если MCP не покрывает |

---

## Опциональные (только при доступе)

> В шаге 1 скил спрашивает: «Есть доступ к Вебмастеру/Метрике?». Если да - подключаем.

### Вебмастер

| Тул | Что дает | Когда |
|---|---|---|
| `wm_hosts` | Список сайтов Вебмастера -> `host_id` | Первым: `host_id` обязателен для `wm_summary` / `wm_diagnostics` |
| `wm_summary` | ИКС, страницы в поиске, исключенные, проблемы (`host_id` обязателен) | Сводка состояния - дополняет domain_dashboard |
| `wm_diagnostics` | Проблемы по серьезности (FATAL/CRITICAL/...), `host_id` обязателен; `NOT_IN_SPRAV` - только пометка про Карты (часто ошибается) | Критические техпроблемы |
| `wm_search_queries` | ТОП запросов по показам/кликам (до 3000) | Реальные данные вместо оценки Keyso (опц.) |
| `wm_sqi_history` | Динамика ИКС за год | Тренд: растет/деградирует (опц.) |

### Метрика

| Тул | Что дает | Когда |
|---|---|---|
| `ym_dashboard` | Реальный трафик | Точные цифры вместо оценки Keyso |
| `ym_counters` | Счетчики Метрики -> `counter_id` | Первым: `counter_id` обязателен для `ym_traffic` |
| `ym_traffic` | Источники (поиск/прямые/реклама); `counter_id` обязателен, режим по умолчанию `overview` - все визиты | `mode="search_engines"` за прошлый полный месяц (`date_from`, `date_to`) - визиты ИЗ ПОИСКА (это `metrics.traffic_month` и `t0` прогноза); `mode="sources"` - детект ботов (прямые 80%+ отказов) |
| `ym_content` | Какие страницы реально дают трафик | Опц. - рабочие vs мертвые страницы |

**Важно:** если прямые заходы 80%+ отказов - ботовый трафик, флаг `bot_traffic_warning: true`.

---

## НЕ использовать

| Что | Почему |
|---|---|
| **JustMagic текстовые** (`jm_text_analyze`, `jm_page_optimize`, `jm_text_generate` и пр.) | Слишком профильные - для текста/статей. `jm_wordstat` - нужен (частотность пакетом) |
| **`domain_dashboard` по каждому конкуренту** | 5-8 вызовов вместо одного `domains_batch` |
| **Arsenkin парсинг/кластеризация** | Дублирует Keyso для стратегии |
| **Telegram** | Не относится |
| **Sheets** | xlsx генерируется локально (`build-smeta-xlsx.mjs`) |

---

## Типовой порядок вызовов (всего ~25-40 на стратегию)

```
--- strategy-scanner ---
0a. seo_fetch_page(главная, profile="content")                → title, desc, регион, CMS, тип, контент, ссылки на Карты
0b. seo_fetch_batch(услуги + контакты + о компании, profile="content") → структура, адрес, виджеты Карт
0c. seo_fetch_page(robots.txt)                                 → блокировки, sitemap
0d. seo_fetch_page(sitemap.xml)                                → кол-во URL, коммерческие страницы, карточки
1.  arsenkin_top(«<компания> <город>», se=[{type:2, region}])   → карточка в Картах (если на сайте ссылки нет)
2.  domain_dashboard(клиент, msk, include_history=true) [+ локальная база]
3.  [если доступ] wm_hosts -> host_id; wm_summary(host_id), wm_diagnostics(host_id)
4.  [если доступ] ym_counters -> counter_id; ym_dashboard, ym_traffic(counter_id, mode="search_engines" и "sources", прошлый полный месяц)
5.  arsenkin_domains(whois)
6.  speedyindex_check(engine="yandex", 5-10 URL) -> speedyindex_tasks(engine="yandex", task_type="checker", task_ids=[id], report=true)

--- competitor-analyst ---
7.  domain_competitors(клиент) [+ проход на локальной базе]
8.  domains_batch(все кандидаты, msk, organic) + domains_batch(..., msk, links) [+ domains_batch(прямые+ориентиры, локальная, organic)]
9.  keyword_info(× 3-5 запросов)                  → выдача, ws/wsk, позиция клиента
10. domain_pages(топ-3 прямых)
11. seo_fetch_batch(2-3 страницы каждого из топ-3, profile="content") + seo_fetch_batch(sitemap.xml топ-3)

--- growth-strategist ---
12. [опц.] domain_keywords(клиент, pos<=20)       → оценка t0 по позициям (если трафика нет в Метрике и Keyso)
13. [опц.] domain_keywords(лидер, pos<=10)        → кандидаты в маркеры спроса
14. jm_wordstat(mode="frequency", keywords=[маркеры + запросы доказательств], region, freq_types=["exact"])   # ОДИН вызов
15. [опц.] arsenkin_wordstat(mode="dynamics", queries=[основной маркер], region, group="month")

--- шаги 5-8 (тарифы, прогноз, текст, проверки, сборка docx/xlsx) - БЕЗ MCP ---
    tariff-architect (Read/Write), build-forecast.mjs, strategy-writer, verify-strategy.mjs +
    strategy-verifier (Read/Write), build-strategy-docx.mjs / build-smeta-xlsx.mjs - ни один MCP-инструмент не зовется.
```

**Бюджет:** ~25-40 вызовов на стратегию (сканер 10-14, конкуренты 12-18, точки роста 1-4). Опциональные (Вебмастер, Метрика) +4. Wordstat - 1 пакетный вызов (+1 повтор по пустым фразам) вместо 5-10 одиночных; метрики конкурентов - 2-3 пакета вместо 5-8 `domain_dashboard`.

---

## Когда нет домена клиента

Если `inputs.domain == "none"`:
- Пропустить весь strategy-scanner кроме поиска по нише (`scan.json` минимум: `commercial_pages: 0`, `maps.has_card: null`; `metrics`: `has_positions: false`, `site_age_months: 0`, `traffic_month: 0`).
- competitor-analyst идет путем Г: 5-7 маркеров «<услуга> <город>» -> keyword_info -> конкуренты -> `domains_batch` -> типизация.
- growth-strategist работает только на данных конкурентов (без позиций клиента): `t0 = 0`, `existing_commercial = 0`, `planned_new` = весь план страниц (медиана коммерческих страниц топ-3 под направления).
