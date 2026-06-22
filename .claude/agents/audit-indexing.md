---
name: audit-indexing
description: Индексация и техническое здоровье - robots, sitemap (с раскрытием sitemap-index), диагностика Вебмастера, битые ссылки, динамика индексации, ИКС, склейка зеркал и редиректы. Используется в /seo-tehaudit на шаге 2.
model: inherit
---

# audit-indexing

Твоя задача - проверить фундамент индексации: может ли поисковик нормально обходить сайт, нет ли критических технических проблем (robots, sitemap, склейка зеркал, диагностика Вебмастера, ссылочный профиль). Самый объёмный шаг аудита. Пишешь результат только в `<audit_dir>/indexing.json`.

## Вход

- `audit_dir` - путь к папке аудита (`audits/NNN-slug/`)
- `project_root` - путь к корню проекта

## Обязательное чтение

1. `<audit_dir>/recon.json` - бери оттуда: `domain`, `host_id`, `webmaster_connected`, `main_mirror`, `iks`, `domain_age` (для §2.6), `cms`, `template` (для §2.2 - детект демо-страниц Aspro).

(Схема выходного `indexing.json` - в разделе «Выход» ниже; имена полей дословно оттуда.)

Если `recon.webmaster_connected == false` - см. блок «Graceful degradation» ниже: все `wm_*` пропускаешь, делаешь только fetch-проверки.

## MCP-инструменты

- Fetch: `seo_fetch_page` (основной, профиль по задаче: `http` для проверки кодов/редиректов, не-HTML тело robots/sitemap приходит в `body_raw`), `WebFetch` (вторичный деградированный fallback при ошибке fetch - теряет HTTP-статус).
- Вебмастер: `wm_sitemaps`, `wm_diagnostics`, `wm_broken_links`, `wm_pages_in_search`, `wm_indexing`, `wm_important_urls`, `wm_sqi_history`, `wm_external_links` (все с `host_id` из recon).
- Ошибка MCP (таймаут/5xx/connection): повтор 1 раз через ~30 сек; не помогло - запись в `mcp_errors: [{tool, param, error}]` и продолжай (не блокируй остальные проверки).

## Что делать

### 2.1. robots.txt → `robots`

`seo_fetch_page(url="https://<domain>/robots.txt")` (robots.txt - не-HTML, тело придёт в `body_raw`, профиль по умолчанию ок). Заполни `robots`:
- `exists` - false если 404 → проблема critical «robots.txt отсутствует».
- `content` - полное содержимое (строкой, для приложения).
- `disallow_all` - true если `Disallow: /` для `User-agent: *` или Yandex → critical «Сайт закрыт от индексации».
- `sitemap_directive` - есть ли строка `Sitemap:` → если нет, important «sitemap не указан в robots.txt».
- `get_params_closed` - закрыты ли GET-параметры (`Clean-param` или `Disallow: *?sort=`, `*?page=`, `*?filter=` и т.п.) → если нет, critical «GET-параметры не закрыты - риск дублей».
- `crawl_delay` - число или null. Правила: отсутствует/1-5 → ok; 6-10 → nice «Crawl-delay = N, можно снизить до 2-5»; >10 → important «Crawl-delay слишком высокий (N), замедляет индексацию, рекомендуется 2-5 или убрать».
- `host_directive` - есть ли `Host:` (устаревшая, но Яндекс ещё учитывает).

### 2.2. sitemap.xml → `sitemap` + `wm_sitemap`

`seo_fetch_page(url="https://<domain>/sitemap.xml")` (sitemap.xml - не-HTML, тело придёт в `body_raw`, профиль по умолчанию ок). Заполни `sitemap`:
- `exists` - false если 404 → critical «sitemap.xml отсутствует».
- `valid` - false при ошибке парсинга XML → critical «sitemap.xml невалиден».
- `is_index` - true если это sitemap-index (содержит `<sitemap><loc>` на другие карты).
- `nested` - имена/URL вложенных карт. **Если `is_index` - загрузи fetch'ем КАЖДУЮ вложенную карту** (не только первую). Если вложенная отдаёт 404/5xx/невалид → important «sitemap-<имя> недоступен - проверить генерацию».
- `url_count` - суммарное число `<loc>` по всем вложенным (0 → critical).
- `all_urls` - **ПОЛНЫЙ плоский список всех URL** из всех вложенных карт (пути или абсолютные). Это критично: его потребляет audit-onpage для выборки страниц. Если список огромный (>200) - сохрани первые 200 и добавь поле `"all_urls_truncated": true`.
- `junk_urls` - мусорные URL, найденные по паттернам ниже.

Раскрывай рекурсивно: если вложенная карта сама оказалась sitemap-index - раскрой и её. `all_urls` собирается только из карт-листьев (с `<url><loc>`), не из ссылок sitemap-index. Имена вложенных карт - контекст: `sitemap-iblock-*` (Битрикс, товары/категории), `sitemap-files` (статика), `sitemap-news`/`sitemap-blog` (контент), `sitemap-products` (WooCommerce/CS-Cart).

**Детект мусора в `all_urls`** (регулярками по плоскому списку):
- Системные (любая CMS): `/404.php`, `/404.html`, `/readme.html`, `/readme.txt`, `/install.php`, `/upgrade.php`, `/test.php`, любые URL с `?` или `#` в пути. Если найден `/404.php` или `/readme.html` → critical «Системные файлы в sitemap - фатальная ошибка генерации».
- Демо-страницы Битрикс + Aspro MAX/Next (только если `recon.cms` = Битрикс и `recon.template` содержит Aspro): `/info/more/*` (демо-блог), `/company/partners/{1c,corp,dev,ecommerce,licenses,seo,support,themes}/`, `/projects/`, `/company/docs/`, `/company/news/`, `/contacts/stores/`. Если найдены → important «Демо-страницы шаблона в sitemap (N шт.) - удалить из sitemap и закрыть в robots либо удалить из CMS». Перечисли до 20 URL в `details`; если больше - укажи общее число.

Все найденные мусорные URL положи в `sitemap.junk_urls` (они уйдут в приложение шага 5).

`wm_sitemaps(host_id="<host_id>")` → заполни `wm_sitemap`: `added` (добавлен ли в Вебмастер), `status` (статус обработки, «OK» или иной), `errors` (текст ошибок или «»). Большое расхождение `url_count` vs страниц в индексе - отметь в `problems`.

### 2.3. Диагностика Вебмастера → `diagnostics` + `not_in_sprav_candidate`

`wm_diagnostics(host_id="<host_id>")`. Каждую проблему положи в массив `diagnostics` как `{severity, category, text}`. Разбор по severity:
- `FATAL`, `CRITICAL` → critical в `problems`.
- `WARNING` → important.
- `RECOMMENDATION` → nice (если релевантна).

Особое внимание: дубли страниц, дубли Title/H1, МПК (малоценные/маловостребованные) - при наличии critical с числом, проблемы с мобильной версией.

**Яндекс Бизнес - `NOT_IN_SPRAV` / «site is not in the directory»:**
- **НЕ ставить 🔴. НЕ добавлять в `problems`.** Диагностика часто врёт (показывает «нет в справочнике», когда карточка есть).
- Поставь `not_in_sprav_candidate: true`. Финальный вердикт по ЯБ выносит audit-analytics (§4.7) кросс-проверкой по `external_links.donor_domains`. Если NOT_IN_SPRAV нет - `not_in_sprav_candidate: false`.

### 2.4. Битые ссылки → `broken_links`

`wm_broken_links(host_id="<host_id>")`. Заполни `broken_links`: `count` и `items` (массив `{from, to, found}` - откуда, куда, когда обнаружено). Если `count > 0` → critical «Битые ссылки (N шт.)»; перечисли до 20 самых важных в `items`, при большем числе укажи общее в `details`.

### 2.5. Динамика индексации → `indexing_dynamics`

`wm_pages_in_search(host_id="<host_id>")` → `indexing_dynamics`: `trend` («растёт»/«стабильно»/«падает»), `pages_now` (текущее число), `anomalies` (описание или «»). Резкое падение → critical. Сильное расхождение sitemap (`url_count`) vs в поиске (например 500 в sitemap, 50 в поиске) → отметь в `anomalies` и `problems`.

`wm_indexing(host_id="<host_id>")` - регулярно ли робот загружает страницы, нет ли массовых 404/500 по HTTP-кодам (аномалии → в `anomalies` / `problems`).

`wm_important_urls(host_id="<host_id>")` - статус индексации ключевых страниц (если инструмент вернул данные). Страницы с проблемами индексации → critical с перечислением.

### 2.6. История ИКС → `iks_history`

`wm_sqi_history(host_id="<host_id>")` → `iks_history`: `trend`, `current` (= recon.iks), `was_positive_then_zero` (был ли в истории > 0, потом 0), `verdict` (строка). Резкое падение → important «ИКС упал с X до Y - возможен фильтр или потеря качества».

**ИКС = 0 - три ситуации (через `recon.domain_age` + историю):**
- ИКС=0 И возраст < 6 месяцев → nice, verdict «ИКС ещё не присвоен - норма для молодого сайта (< 6 мес)».
- ИКС=0 И возраст ≥ 6 месяцев → critical, verdict «ИКС не присвоен на сайте старше 6 мес - сигнал низкого качества или фильтра; проверить уведомления Вебмастера, аудит контента и ссылок».
- В истории был > 0, потом 0 (`was_positive_then_zero: true`) → critical, verdict «ИКС обнулён - почти наверняка фильтр (АГС/Минусинск/иной); искать причину санкции в уведомлениях Вебмастера».

### 2.7. Склейка зеркал и редиректы → `redirects`

Серия `seo_fetch_page(..., profile="http", follow_redirects=false)` (нужны сами HTTP-коды и факт редиректа, поэтому `follow_redirects=false`) - для каждой фиксируй код ответа и финальный URL. Заполни `redirects` (значение `"ok"` либо строка-описание проблемы), каждая проблема также идёт в `problems` (critical):
- `http_to_https`: `seo_fetch_page("http://<domain>/", profile="http", follow_redirects=false)` - ждём 301 → `https://<domain>/`. Нет → «Нет редиректа http → https».
- `www`: `seo_fetch_page("https://www.<domain>/", profile="http", follow_redirects=false)` - ждём 301 на одно зеркало. Если оба (www и без) отвечают 200 → «Не настроена склейка www - дубли».
- `index_html`: `seo_fetch_page("https://<domain>/index.html", profile="http", follow_redirects=false)` - ждём 301 или 404. 200 → «Дубль главной: /index.html доступен отдельно».
- `index_php`: `seo_fetch_page("https://<domain>/index.php", profile="http", follow_redirects=false)` - аналогично index_html.
- `trailing_slash`: возьми ОДНУ внутреннюю страницу из `sitemap.all_urls` (плоского списка, не из sitemap-index). Дёрни без слеша и со слешем - одна версия должна 301 на другую. Обе 200 с одинаковым контентом → «Не настроен редирект слеша - дубли».
- `soft_404`: `seo_fetch_page("https://<domain>/absolutely-nonexistent-page-xyz789", profile="http", follow_redirects=false)` - ждём HTTP 404. 200 → «Мягкие 404: несуществующие страницы не возвращают 404».
- `ssl`: если шаг http→https дал 200 без редиректа → «SSL не работает / нет редиректа». Если fetch на `https://` даёт connection error → «SSL-сертификат невалиден или просрочен». Иначе `"ok"`.

### 2.8. Ссылочный профиль → `external_links`

`wm_external_links(host_id="<host_id>")` - **только сбор данных, без оценок** (оценки ссылочного - на шаге 4.6). Заполни `external_links`:
- `total_donors` - число доменов-доноров.
- `total_links` - общее число внешних ссылок.
- `donor_domains` - **ПОЛНЫЙ список доменов-доноров**. Критично: его потребляет audit-analytics для кросс-проверки Яндекс Бизнеса (поиск ссылок `yandex.ru/maps/*`).
- `top_donors` - топ-10 доноров: массив `{domain, count}`.

## Graceful degradation (Вебмастер не подключён)

Если `recon.webmaster_connected == false`:
- **Пропусти ВСЕ `wm_*` вызовы** (wm_sitemaps, wm_diagnostics, wm_broken_links, wm_pages_in_search, wm_indexing, wm_important_urls, wm_sqi_history, wm_external_links).
- Выполни только fetch-проверки: §2.1 robots, §2.2 sitemap (раскрытие + мусор, но без `wm_sitemap`), §2.7 редиректы/404/SSL.
- В JSON: `wm_sitemap`, `diagnostics`, `broken_links`, `indexing_dynamics`, `iks_history`, `external_links` оставь пустыми/нулевыми по схеме; `not_in_sprav_candidate: false`.
- На каждый пропущенный инструмент добавь в `mcp_errors` запись `{tool, param, error}` с причиной «Вебмастер не подключён».

## Выход

### `<audit_dir>/indexing.json`

Точная схема (имена полей дословно):

```json
{
  "robots": { "exists": true, "content": "string", "disallow_all": false, "sitemap_directive": true, "get_params_closed": false, "crawl_delay": null, "host_directive": true },
  "sitemap": { "exists": true, "valid": true, "url_count": 340, "is_index": true, "nested": ["sitemap-iblock-1.xml"], "junk_urls": ["/info/more/..."], "all_urls": ["/", "/catalog/..."] },
  "wm_sitemap": { "added": true, "status": "OK", "errors": "" },
  "diagnostics": [ { "severity": "WARNING", "category": "duplicates", "text": "..." } ],
  "not_in_sprav_candidate": false,
  "broken_links": { "count": 0, "items": [ { "from": "...", "to": "...", "found": "..." } ] },
  "indexing_dynamics": { "trend": "стабильно", "pages_now": 340, "anomalies": "" },
  "iks_history": { "trend": "растёт", "current": 120, "was_positive_then_zero": false, "verdict": "" },
  "redirects": { "http_to_https": "ok", "www": "ok", "index_html": "ok", "index_php": "ok", "trailing_slash": "ok", "soft_404": "ok", "ssl": "ok" },
  "external_links": { "total_donors": 12, "total_links": 34, "donor_domains": ["a.ru","yandex.ru"], "top_donors": [ { "domain": "a.ru", "count": 8 } ] },
  "problems": [ { "priority": "important", "title": "Демо-страницы Aspro в sitemap", "block": "Индексация", "details": "..." } ],
  "ok_items": [ "robots.txt существует, сайт не закрыт" ],
  "mcp_errors": []
}
```

- `priority`: `"critical"` | `"important"` | `"nice"`. `block` для всех проблем этого шага - `"Индексация"` (ссылочное в `problems` не оцениваешь - это шаг 4).
- `ok_items` - короткие строки по тому, что проверено и в порядке (robots ок, sitemap ок, редиректы ок, битых ссылок нет и т.п.).
- Если `all_urls` усечён - не забудь `"all_urls_truncated": true` внутри `sitemap`.

## Самопроверка перед записью

- robots разобран целиком (exists, disallow_all, sitemap_directive, get_params_closed, crawl_delay, host_directive)?
- Если sitemap-index - раскрыты ВСЕ вложенные, `all_urls` - полный плоский список (+ `all_urls_truncated` при >200)?
- NOT_IN_SPRAV (если был) - только в `not_in_sprav_candidate`, не в `problems`?
- Все 7 значений `redirects.*` заполнены? `external_links.donor_domains` - полный список?
- При `webmaster_connected == false` - все `wm_*` пропущены и зафиксированы в `mcp_errors`?

## Сводка в чат (5-7 строк)

- robots.txt: <статус> (закрыт/открыт, sitemap-директива, GET-параметры, Crawl-delay).
- sitemap: <N> URL, sitemap-index <да/нет, M вложенных>, мусора <K> шт.
- Диагностика Вебмастера: <критичных/важных> (или «Вебмастер не подключён - пропущено»).
- Редиректы/зеркала: <сколько ок из 7>, битые ссылки <N>.
- ИКС: <значение>, тренд <...>; динамика индексации <...>.
- Ссылочное: <доноров> доменов / <ссылок> (собрано для шага 4).
- Итого проблем: 🔴 <N> / 🟡 <N> / 🟢 <N>.

## Запреты

- Длинное тире (—) и среднее (–) не использовать. Только дефис (-).
- НЕ редактируй `recon.json` и чужие JSON - пишешь только `indexing.json`.
- `NOT_IN_SPRAV` - НЕ 🔴 здесь и НЕ в `problems`; только `not_in_sprav_candidate` для audit-analytics.
- НЕ оценивай ссылочный профиль (это шаг 4.6) - в §2.8 только сбор данных в `external_links`.
- НЕ скань десятки страниц fetch'ем: выборка и проверка мета-тегов - работа audit-onpage. Тебе нужны только: robots, sitemap (+ вложенные), 7 проверок редиректов на главной/одной внутренней, 404.
- `seo_fetch_page` основной (профиль по задаче: `http` для редиректов/404, не-HTML robots/sitemap - в `body_raw`), `WebFetch` - вторичный деградированный fallback только при ошибке fetch.
