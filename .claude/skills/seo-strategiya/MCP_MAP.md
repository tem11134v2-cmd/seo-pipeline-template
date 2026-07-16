# MCP-карта для /seo-strategiya

> Какие MCP-инструменты использовать на каком этапе. Принцип: экономия контекста. Не вызывай всё подряд — бери только нужное для текущей задачи.

---

## Основные инструменты

### Keyso (основной аналитический)

| Тул | Что даёт | Когда | Лимит |
|---|---|---|---|
| `domain_dashboard` | DR, ТОП-10/50, трафик, страниц в базе | Первичная оценка клиента и каждого конкурента | 1 на домен |
| `domain_competitors` | Список конкурентов по пересечению семантики | Поиск конкурентов (если есть домен с видимостью) | 1 |
| `domain_pages` | Страницы домена с кол-вом запросов в ТОП | Какие страницы конкурента работают (топ-3 прямых) | 1 на домен |
| `keyword_info` | SERP по запросу: ТОП-50 + частотность WS/WSK | Анализ выдачи по 3-5 запросам, проверка ТОП | 3-5 |
| `domain_keywords` | Ключевые слова домена с позициями | Глубокий разбор конкурента (опц.) | по необх. |
| `keyword_similar` | Похожие запросы | Расширение семантики (опц.) | по необх. |

**Параметры (двойная база, точка 4):** `keyso_base_primary` (всегда msk) - полнота пула конкурентов и рыночный потолок, страховка от пустых данных. `keyso_base_local` (база города или null) - реальные локальные позиции и локальные игроки. Метрики клиента и поиск пула - на ОБЕИХ базах; детализация по каждому конкуренту - на msk (бюджет); выдача (`keyword_info`) - на локальной, если задана.

**Кириллический IDN-домен** (например `ремонт-квартир-днр.рф`) передавай в Keyso **в кириллице**, не в Punycode (`xn--80aeklehhe9ape7g.xn--p1ai`). Keyso работает с кириллической формой. Punycode даст «домен не найден».

```
domain_dashboard(domain="site.ru", base="msk", include_history=true)    # клиент: msk (потолок)
domain_dashboard(domain="site.ru", base="spb", include_history=true)    # клиент: + локальная (если задана)
domain_dashboard(domain="competitor.ru", base="msk")                    # конкурент: только msk (бюджет)
domain_competitors(domain="site.ru", base="msk")                        # пул: msk (+ проход на spb для локалов)
keyword_info(keyword="запрос", base="spb")                              # выдача: локальная если задана, иначе msk
domain_pages(domain="leader.ru", base="msk", sort="it50|desc", per_page=10)  # лидеры: msk
```

### Частотность и сезонность (Wordstat-данные)

| Тул | Что даёт | Когда |
|---|---|---|
| `jm_wordstat` (mode=frequency) | Частотность запроса (primary); альтернативы `wk_check_frequency`, `arsenkin_wordstat` (mode=frequency) | Таблицы точек роста (5-10 вызовов) |
| `jm_semantic_pack` / `jm_suggest` / `arsenkin_wordstat` (mode=parsing) | Расширение семантики: маркер → топ-N похожих запросов с частотностью (вместо «популярных подзапросов») | Когда нужен массив похожих запросов |
| `arsenkin_wordstat` (mode=dynamics, group=month) | Динамика во времени (сезонность) | Проверка сезонности (опц., 1 вызов) |
| `arsenkin_top` | Домены/URL топа по запросу+регион (queries[], region, depth=10/20/30, is_snippet); альтернативы keyso `check_top` / `history_serp` | Если город не в базе Keyso (топонимный запрос) |
| `seo_fetch_page` / `seo_fetch_batch` (profile="content") | Статический HTTP-фетч + разбор основного текста/контента страницы (JS не рендерится) | Скан сайта клиента + ключевые страницы конкурентов |

```
jm_wordstat(keyword="запрос", region=2, mode="frequency")            # частотность, СПб
arsenkin_wordstat(keyword="запрос", mode="dynamics", group="month",
                  startdate="<сегодня минус 24 мес>", enddate="<сегодня>")  # сезонность
seo_fetch_page(url="https://site.ru/", profile="content")            # один URL
seo_fetch_batch(urls=["https://site.ru/", "https://site.ru/uslugi/"], profile="content")  # веер
```

Регион Wordstat: дерево регионов живым инструментом не отдаётся, берём код из зашитого списка (Москва 213, СПб 2, ...) или дефолт 213. Геозависимость запроса при необходимости проверяет `arsenkin_commerce`.

### Арсенкин (точечно)

| Тул | Что даёт | Когда |
|---|---|---|
| `arsenkin_domains` | WHOIS: возраст домена, регистратор; или ИКС Яндекса | Один вызов в начале на клиента |
| `arsenkin_indexation` | Альтернатива SpeedyIndex для индексации | Опц. |

Остальные Арсенкин-тулы (парсинг выдачи, кластеризация, позиции) для стратегии **избыточны**.

### SpeedyIndex

| Тул | Что даёт | Когда |
|---|---|---|
| `speedyindex_check` | Проверка индексации URL | 5-10 ключевых страниц клиента |
| `speedyindex_balance` | Остаток | Перед массовой проверкой |

### Встроенные Claude

| Тул | Когда |
|---|---|
| `web_fetch` | Вторичный деградированный fallback к `seo_fetch_page` (теряет мету/структуру/HTTP-статус): детальный просмотр страницы конкурента, если seo-fetch недоступен. robots.txt / sitemap.xml лучше брать через `seo_fetch_page(url)` (не-HTML тело придёт в `body_raw`) |
| `web_search` | Поиск ниши/клиента, если MCP не покрывает |

---

## Опциональные (только при доступе)

> В шаге 1 скил спрашивает: «Есть доступ к Вебмастеру/Метрике?». Если да — подключаем.

### Вебмастер

| Тул | Что даёт | Когда |
|---|---|---|
| `wm_summary` | ИКС, страницы в поиске, исключённые, проблемы | Сводка состояния — дополняет domain_dashboard |
| `wm_diagnostics` | Проблемы по серьёзности (FATAL/CRITICAL/...) | Критические техпроблемы |
| `wm_search_queries` | ТОП запросов по показам/кликам (до 3000) | Реальные данные вместо оценки Keyso (опц.) |
| `wm_sqi_history` | Динамика ИКС за год | Тренд: растёт/деградирует (опц.) |

### Метрика

| Тул | Что даёт | Когда |
|---|---|---|
| `ym_dashboard` | Реальный трафик | Точные цифры вместо оценки Keyso |
| `ym_traffic` | Источники (поиск/прямые/реклама) | Доля поиска + детект ботов (прямые 80%+ отказов) |
| `ym_content` | Какие страницы реально дают трафик | Опц. — рабочие vs мёртвые страницы |

**Важно:** если прямые заходы 80%+ отказов — ботовый трафик, флаг `bot_traffic_warning: true`.

---

## НЕ использовать

| Что | Почему |
|---|---|
| **JustMagic** (jm_text_analyze и пр.) | Слишком профильный — для текста/статей |
| **Arsenkin парсинг/кластеризация** | Дублирует Keyso для стратегии |
| **Telegram** | Не относится |
| **Sheets** | xlsx генерируется локально (`build-smeta-xlsx.mjs`) |

---

## Типовой порядок вызовов (всего ~30-45 на стратегию)

```
--- strategy-scanner ---
0a. seo_fetch_page(главная, profile="content")        → title, desc, регион, CMS, тип, контент
0b. seo_fetch_batch(2-3 внутренних, profile="content") → структура, контент, SEO-элементы
0c. seo_fetch_page(robots.txt)               → блокировки, sitemap (не-HTML тело в body_raw)
0d. seo_fetch_page(sitemap.xml)              → кол-во URL (не-HTML тело в body_raw)
1.  domain_dashboard(клиент, include_history=true)
2.  [если доступ] wm_summary, wm_diagnostics
3.  [если доступ] ym_dashboard, ym_traffic
4.  arsenkin_domains(whois)
5.  speedyindex_check(5-10 URL)

--- competitor-analyst ---
6.  domain_competitors(клиент)
7.  domain_dashboard(конкурент × 5-8)
8.  keyword_info(× 3-5 запросов)
9.  domain_pages(топ-3 прямых)
10. seo_fetch_batch(× 2-3 страницы каждого из топ-3, profile="content")

--- growth-strategist ---
11. jm_wordstat(× 5-10 запросов с region, mode="frequency")   # альт: wk_check_frequency / arsenkin_wordstat (mode=frequency)
12. [опц.] arsenkin_wordstat(основной запрос, mode="dynamics", group="month")

--- шаг 6.5 (проверка стратегии) + шаги 7-8 (сборка docx/xlsx) - БЕЗ MCP ---
    verify-strategy.mjs (детерминированный скрипт) + strategy-verifier (opus, tools Read/Write) +
    build-strategy-docx.mjs / build-smeta-xlsx.mjs - ни один MCP-инструмент не зовется.
```

**Бюджет:** ~30-45 вызовов на стратегию. Опциональные (Вебмастер, Метрика) +5-8.

---

## Когда нет домена клиента

Если `inputs.domain == "none"`:
- Пропустить весь strategy-scanner кроме поиска по нише.
- competitor-analyst идёт путём Г: 5-7 маркеров «<услуга> <город>» → keyword_info → конкуренты → typing.
- growth-strategist работает только на данных конкурентов (без сравнения позиций клиента — позиций нет).
