# MCP-карта для /seo-tehaudit

> Какие MCP-инструменты на каком шаге. Принцип: экономия контекста и доступов. Аудит идёт по доступам клиента (Вебмастер + Метрика) - если их нет, соответствующие проверки пропускаются (graceful degradation), отчёт всё равно собирается.

---

## Инструменты по шагам

### Шаг 1 - audit-recon (разведка)

| Тул | Что даёт | Лимит |
|---|---|---|
| `wm_hosts`, `wm_host_info`, `wm_summary` | host_id, верификация, зеркало, ИКС, страницы в поиске | 3 |
| `ym_counters`, `ym_counter_info` | counter_id, дата создания (возраст счётчика), число целей | 2 |
| `domain_dashboard` | метрики Keyso (ТОП-10/50, видимость, трафик); каскад msk->spb при пустых | 1-3 |
| `arsenkin_domains` (check_type="whois") | возраст домена | 1 |
| `mcp_fetch_page` (главная) | CMS / шаблон / тематика / регион / контакты | 1 |

### Шаг 2 - audit-indexing (индексация)

| Тул | Что даёт | Лимит |
|---|---|---|
| `mcp_fetch_page` | robots.txt, sitemap.xml + все вложенные карты, 6-7 проверок редиректов/склейки/404 | 8-20 |
| `wm_sitemaps` | sitemap в Вебмастере (статус, расхождения) | 1 |
| `wm_diagnostics` | FATAL/CRITICAL/WARNING + кандидат NOT_IN_SPRAV | 1 |
| `wm_broken_links` | битые ссылки | 1 |
| `wm_pages_in_search`, `wm_indexing`, `wm_important_urls` | динамика индексации, аномалии | 3 |
| `wm_sqi_history` | история ИКС (три ситуации ИКС=0) | 1 |
| `wm_external_links` | доноры (для §4.6 и кросс-проверки ЯБ §4.7) | 1 |

### Шаг 3 - audit-onpage × K шардов (URL/мета/Schema)

Выборку и `url_structure` считает скрипт `select-audit-pages.mjs` (без MCP) из `indexing.sitemap.all_urls`; затем K параллельных `audit-onpage`, каждый фетчит свой батч (~8 страниц); слияние - `merge-onpage.mjs` (без MCP). `domain_pages` тут НЕ нужен (приоритет по Keyso не используется - выборка структурная по типам).

| Тул | Что даёт | Лимит |
|---|---|---|
| `mcp_fetch_page` | HTML страниц своего батча (Title/H1/Desc/noindex/canonical/Schema/favicon/JS) | ~8 на шард, всего ~`<--pages>` (по умолчанию 24) |

### Шаг 4 - audit-analytics (аналитика + ссылки) - ПАРАЛЛЕЛЬНО с шагом 3

| Тул | Что даёт | Лимит |
|---|---|---|
| `ym_dashboard`, `ym_traffic`, `ym_content`, `ym_goals`, `ym_site_audit` | трафик, источники, отказы, цели, устройства | 5 |
| `domain_backlinks` | ссылочный профиль из Keyso, `base="<recon.keyso_base>"` | 1 |

> `wm_external_links` на шаге 4 **повторно НЕ вызывать** - данные уже в `indexing.external_links`.

### Шаги 5-6 - audit-writer + рендеры

Без MCP. `audit-writer` (Read/Write/Edit), `render-audit-md.mjs` / `build-audit-docx.mjs` / `verify-audit.mjs` (Node).

### Шаг 7 - Drive

| Тул | Что даёт |
|---|---|
| `mcp__gdrive-piotr__uploadFile` | заливка A12.docx с конверсией в Google Doc |
| `mcp__gdrive-piotr__deleteItem` | удаление старой версии в revising-цикле |

---

## ⚠️ Арсенкин - строго последовательно

`arsenkin_domains` **не работает при параллельных вызовах**. Его зовёт **только** `audit-recon` - одним последовательным вызовом (возраст домена). `audit-recon` выполняется первым и в одиночку, до параллельной пары onpage∥analytics. Параллельная пара Арсенкин не трогает. **Никогда не параллелить Арсенкин.**

## Параллелизм

- Шаги 1->2 строго последовательны (host_id, база Keyso, список URL и доноры - вход для следующих).
- Шаг 3 (`audit-onpage` × K шардов) и шаг 4 (`audit-analytics`) **независимы** - все читают только `recon.json` + `indexing.json` (+ свой `page_list`). Запускать **в один параллельный заход** (K делегаций onpage + 1 analytics в одном сообщении; лимит ~10 одновременных). Никто не использует Арсенкин.

## Параметры Keyso

- Во всех вызовах Keyso (`domain_dashboard`, `domain_pages`, `domain_backlinks`) - `base="<recon.keyso_base>"`.
- **Кириллический IDN-домен** (`ремонт-квартир-днр.рф`) - в кириллице, не Punycode (`xn--...` даст «домен не найден»).

## Параметры Метрики / Вебмастера

- Метрика: все вызовы с `counter_id` из `recon.json`. Если `metrika_connected==false` - пропустить ym_* (graceful degradation).
- Вебмастер: все вызовы с `host_id` из `recon.json`. Если `webmaster_connected==false` - пропустить wm_*, делать только fetch-проверки.

---

## Что НЕ использовать в /seo-tehaudit

| MCP | Почему |
|---|---|
| **JustMagic** (jm_*) | Для текстов/статей, не для техаудита |
| **Wordstat** (mcp_wordstat_*) | Частотность не нужна для техаудита |
| **SpeedyIndex** | Индексацию проверяем через Вебмастер, не через отправку на переобход |
| **Sheets** | Артефакты - markdown и docx |
| **domain_competitors / keyword_info** (Keyso) | Это конкурентный анализ (/seo-analiz), не техаудит |

---

## Бюджет и ошибки

**Бюджет:** ~45-75 MCP-вызовов на аудит при дефолте (recon ~8, indexing ~15-25, onpage ~`<--pages>` фетчей = 24 по умолчанию, analytics ~6). On-page масштабируется флагом `--pages` и распараллелен по шардам. Если упёрся в лимит - уменьши `--pages` или иди к следующему шагу с тем что есть.

| Ошибка | Действие |
|---|---|
| Таймаут / 5xx / connection | Повтор 1 раз через ~30 сек |
| Повтор не помог | Запись в `mcp_errors: [{tool, param, error}]` агента, продолжить (раздел «Не удалось проверить» в A12) |
| Вебмастер не подключён | `webmaster_connected=false`, пропустить wm_*, только fetch-проверки |
| Метрика не подключена | `metrika_connected=false`, пропустить ym_*, §4.6/4.7 всё равно выполнить |
| `mcp_fetch_page` 403/404/timeout | Попробовать `WebFetch`; оба не работают - `fetch_failed`, пропустить страницу |
| Keyso пустой на домене клиента | Каскад базы msk->spb; если всё 0 - пометка «не в базах», выборка onpage из sitemap |
| Превышен бюджет MCP | Прекратить добор, перейти к следующему шагу |
