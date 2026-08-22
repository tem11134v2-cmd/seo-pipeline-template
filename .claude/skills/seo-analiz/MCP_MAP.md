# MCP-карта для /seo-analiz

> Какие MCP-инструменты использовать на каком шаге. Принцип: экономия контекста. Не вызывай все подряд - бери только нужное для текущего этапа.
>
> **Tier-правило:** инструменты Keyso - **только при tier=seo**. При tier=basic ни один Keyso-инструмент не вызывается ни одним агентом; те же ступени работают через `arsenkin_top` + `seo_fetch_*` (деградация отсутствием метрик, не заменой их на другие).

---

## Основные инструменты

### Keyso (ТОЛЬКО tier=seo)

| Тул | Что дает | На каких шагах | Лимит |
|---|---|---|---|
| `domain_dashboard` | DR, ТОП-10/50, трафик, страниц в базе | 1 (проверка домена клиента, если есть) + 3 (по каждому из 8-15 отфильтрованных конкурентов) | 1 + 8-15 |
| `domain_competitors` | Список конкурентов по пересечению семантики | 3 (Путь A, Путь B опорный, Путь C/D через топ-3 первичных) | 1-3 |
| `keyword_info` | SERP по запросу: ТОП-50 + частотность | 3 (Путь B/C/D - сбор кандидатов по 3-7 запросам) + 6 (SERP-анализ по 3-5 коммерческим запросам) | 3-7 + 3-5 |
| `domain_pages` | Страницы домена с числом запросов в ТОП | 4 (по каждому из 3 лидеров - топ-10 страниц) | 3 |

**Параметры:**

- Во всех вызовах Keyso передавай `base="<brief.keyso_base>"`. База определяется на шаге 1 агентом `brief-structurer` (только при tier=seo; при basic ключа `keyso_base` в brief.json нет вообще).
- `include_history=true` **НЕ нужен** - для предпроектного анализа достаточно текущих метрик.
- В режиме `--add-seo` те же вызовы выполняются при дообогащении (brief-structurer, competitor-finder, serp-verdict).

**Кириллический IDN-домен** (`ремонт-квартир-днр.рф`) передавай **в кириллице**, не в Punycode (`xn--...`). Keyso работает с кириллической формой, Punycode даст «домен не найден».

```
domain_dashboard(domain="site.ru", base="spb")
domain_competitors(domain="site.ru", base="spb")
keyword_info(keyword="запрос", base="spb")
domain_pages(domain="leader.ru", base="spb", sort="it50|desc", per_page=10)
```

### SERP и фетч (оба tier)

| Тул | Что дает | На каких шагах |
|---|---|---|
| `arsenkin_top` | Топ Яндекса по запросу+регион (домены/URL) | 2 (audience-analyst: опц. поиск форумов/отзывов); 3 (при basic - ОСНОВНОЙ путь кандидатов: по `marker_hint` 3-5 направлений из brief.directions; при seo - только если `brief.city_not_in_keyso == true`, локальные игроки); 5 (direction-scanner: 1 вызов на направление по его `marker_hint`) |
| `seo_fetch_page` / `seo_fetch_batch` | Статический фетч + разбор HTML (JS не рендерит), объем по профилю | 1 (при basic - скан сайта клиента: sitemap/меню, до 5 страниц -> `client_pages` без метрик); 2 (audience-analyst: форум-майнинг, **max 2-3 вызова**); 3 (проверка спорных доменов на агрегатор/инфопортал, `profile="content"`; при basic - лайт-типизация всех кандидатов); 4 (скан страниц топ-3 лидеров, `profile="content"`; при basic - также ВЫБОР страниц через меню/sitemap лидера вместо `domain_pages`); 5 (direction-scanner: fallback фетча страниц конкурентов направления + own_page) |
| `mcp__claude-in-chrome__*` (Chrome-плагин) | Rendered-фетч страниц (JS-сайты) | 4 (leader-scanner v2: PRIMARY-фетч страниц лидеров), 5 (direction-scanner: основной фетч 3-5 страниц однотипных конкурентов; fallback - `seo_fetch_batch(urls=[...], profile="content")`) |
| `web_search` | Поиск форумов/отзывов/обсуждений | 2 (audience-analyst: где ЦА обсуждает проблему - дословные формулировки болей/возражений) |

```
arsenkin_top(queries=["<запрос> <город>"], region=213, depth=10, is_snippet=true)
seo_fetch_page(url="https://leader.ru/services/teambuilding", profile="content")
seo_fetch_batch(urls=["...", "..."], profile="content")
```

### Встроенные Claude

| Тул | На каких шагах |
|---|---|
| `web_fetch` | 3/4/5 (вторичный деградированный fallback к `seo_fetch_page`: теряет мету/структуру/HTTP-статус) |

---

## НЕ использовать в /seo-analiz

| MCP | Почему |
|---|---|
| **Keyso при tier=basic** | Весь смысл tier=basic - анализ без SEO-метрик. Деградация отсутствием ключей, не подменой источника |
| **JustMagic** (jm_*) | Для текстов/статей, не для предпроектного анализа |
| **Webmaster** (wm_*) | Доступы клиента не запрашиваются на предпроектном этапе |
| **Метрика** (ym_*) | То же |
| **SpeedyIndex** (speedyindex_*) | Не нужно проверять индексацию для предпроектного анализа |
| **Arsenkin кроме arsenkin_top** | Дублирует Keyso для этой задачи. `arsenkin_top` - штатный инструмент шагов 2/3/5 (см. таблицу выше); при необходимости `arsenkin_commerce` для проверки геозависимости запроса |
| **Wordstat / частотности** (jm_wordstat, wk_*, arsenkin_wordstat) | Проверок поискового спроса в ступенях 0-3 НЕТ (вето владельца, ADR-031/038); при tier=basic - никаких частотностей вообще. (Частотность в ответе `keyword_info` при tier=seo - побочное поле сбора SERP, не проверка спроса) |
| **Telegram** (tg_*) | Не относится |
| **Sheets** | Все артефакты - markdown и docx, не электронные таблицы |

(Drive исключен из этого списка: `/seo-analiz` заливает A2 в Drive на шаге 8 и читает ответы клиента на шаге 9.0 - см. раздел «Drive и импорт ответов» ниже.)

---

## Drive и импорт ответов (gdrive-piotr)

| Тул | Что дает | На каких шагах |
|---|---|---|
| `uploadFile` / `deleteItem` | заливка `A2_<slug>.docx` в Drive (+ delete при revising и --add-seo re-upload) | 8 (оркестратор, не агент) |
| `readGoogleDoc(format="markdown")` | чтение Google Doc клиента с его ответами | 9.0 режим `--answers` (оркестратор) |

Doc_id клиента - в `<analysis_dir>/share.json.drive_file_id`. Все вызовы Drive делает оркестратор, не субагенты. Fallback `readGoogleDoc` (не Google Doc / Docs API не активна) - ручная вставка ответов текстом (см. SKILL 9.0d).

---

## Типовой порядок вызовов

```
--- intake-analyst (шаг 0) ---
   (без MCP - только Read/Write по путям к вводной фактуре)

--- brief-structurer (шаг 1) ---
seo:   1.  domain_dashboard(клиент)               # только если домен есть
basic: 1.  seo_fetch_page(сайт клиента, × до 6)   # главная + sitemap.xml + до 4 страниц -> client_pages без метрик

--- audience-analyst (шаг 2) ---
2.  web_search(× 1-2)                             # где ЦА обсуждает проблему
3.  arsenkin_top(× 0-1)                           # опц.: форумы/отзывы в выдаче
4.  seo_fetch_page(profile="content", × max 2-3)  # форум-майнинг дословных формулировок

--- competitor-finder (шаг 3) ---
seo:   5.  domain_competitors(клиент) ИЛИ keyword_info(× 3-7)   # путь A/B/C/D
       6.  arsenkin_top(× 2-3)                     # если регион не в Keyso
       7.  seo_fetch_page(profile="content", × до 5)  # проверка спорных доменов
       8.  domain_dashboard(× 8-15)                # метрики финальных кандидатов
basic: 5.  arsenkin_top(× 3-5)                     # SERP по marker_hint направлений
       6.  seo_fetch_page(profile="content", × до 8)  # лайт-типизация кандидатов

--- leader-scanner v2 (шаг 4; пропускается при --no-scan) ---
seo:   9.  domain_pages(× 3 лидера)                # выбор страниц для скана
basic: 9.  seo_fetch_page(меню/sitemap, × 3)       # выбор страниц без Keyso
10. seo_fetch_page(profile="content", × 9-12)      # скан смыслов + блок-матрица

--- direction-scanner (шаг 5, веер по направлениям; пропускается при --no-recon) ---
~7 вызовов НА НАПРАВЛЕНИЕ:
11. arsenkin_top(× 1)                              # топ-10 по marker_hint + регион
12. Chrome-плагин / seo_fetch_batch(× 3-5 страниц) # фетч однотипных конкурентов
13. seo_fetch_page(own_page, × 0-1)                # если directions[].url != null

--- serp-verdict (шаг 6, ТОЛЬКО tier=seo) ---
14. keyword_info(× 3-5 коммерческих запросов)      # SERP-анализ
15. seo_fetch_page(profile="outline", × до 3)      # тип страницы top-1/2/3 в спорных случаях

--- analysis-writer (шаг 7) ---
   (без MCP - только Read/Write/Edit)

--- analysis-verifier (шаг 7b) ---
   (без MCP - только Read/Write)

--- build-analysis-docx.mjs (шаг 8.0) ---
   (без MCP - Node-скрипт)

--- Drive upload (шаг 8, оркестратор) ---
    uploadFile / deleteItem                        # заливка A2_<slug>.docx

--- answer-extractor (шаг 9.0, режим --answers) ---
   (без MCP - Read/Write по путям; Google Doc читает оркестратор через readGoogleDoc)
```

**Бюджет:** базово ~25-40 MCP-вызовов на анализ + веер направлений ~7 x N (обычно 3-8 направлений). При tier=basic Keyso-вызовов нет вообще - базовая часть заметно дешевле. Если уперся в лимит - не дробить запросы дальше, идти к следующему этапу.

---

## Когда нет домена клиента

Если `brief.domain == null`:

**tier=seo:**
- Пропустить `domain_dashboard` клиента на шаге 1 (брифование).
- `brief-structurer` ставит `path = "C"` (если есть `client_target_queries`) или `path = "D"` (если только ниша + регион).
- `competitor-finder` идет путем C или D: 5-7 маркерных запросов -> `keyword_info` -> топ-3 первичных -> `domain_competitors` каждого.
- `serp-verdict` все равно работает: коммерческие запросы есть.
- `leader-scanner` все равно работает: топ-3 определены `competitor-finder`.

**tier=basic:** домен не критичен по построению - кандидаты собираются из `client_competitors` брифа + SERP по `marker_hint` направлений; `client_pages` при отсутствии домена просто не собираются (деградация отсутствием). Поле `path` при basic не заполняется вообще.

---

## Что делать при ошибках MCP

| Ошибка | Действие |
|---|---|
| Keyso вернул пустые данные на домен клиента (tier=seo) | `path = "B"`, метку «нет данных Keyso» в `brief.domain_dashboard_snapshot.note`, продолжать |
| Keyso вернул пустые данные на домене конкурента (tier=seo) | Пометить `"keyso_data": "missing"` в его записи, оставить в списке (тип и тематика важнее) |
| `seo_fetch_page` 403/404/timeout | Попробовать вторичный fallback `web_fetch` (теряет мету/структуру/HTTP-статус). Если оба не работают - `"fetch_failed": true`, пропустить страницу, продолжать |
| Chrome-плагин недоступен (шаг 5) | Штатный fallback: `seo_fetch_batch(urls=[...], profile="content")` - статический фетч без рендера JS |
| `arsenkin_top` не работает | При tier=seo альтернатива: Keyso `check_top` / `history_serp`. При tier=basic альтернативы нет - пометить `"serp_source": "none"` в recon/candidates, собрать что можно из брифа и фетча, продолжать |
| Превышен бюджет MCP | Прекратить добор кандидатов/страниц, перейти к следующему этапу с тем что есть |
