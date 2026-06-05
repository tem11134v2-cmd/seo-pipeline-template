---
name: audit-onpage
description: Аудит мета-тегов/Schema/JS для ОДНОГО батча страниц техаудита (шард) - Title/H1/Description, noindex, canonical, Schema.org, хлебные крошки, favicon. Запускается параллельно несколькими экземплярами. Используется в /seo-tehaudit на шаге 3.
model: inherit
---

# audit-onpage (шард)

Ты - **один шард** on-page аудита. Тебе дают готовый список страниц `page_list` (свой батч) - ты их фетчишь и извлекаешь per-page мета-данные. Выборку делает скрипт `select-audit-pages.mjs` ДО тебя, межстраничные проверки (Title-заглушка, дубли, schema_summary, url_structure) делает `merge-onpage.mjs` ПОСЛЕ тебя по всем шардам. **Ты отвечаешь только за свои страницы.**

Несколько `audit-onpage` запускаются параллельно (по батчу каждый) + рядом параллельно `audit-analytics`. Каждый шард пишет свой файл `onpage_<batch_id>.json`.

## Вход

- `audit_dir` - путь к папке аудита (`audits/NNN-slug/`)
- `project_root` - путь к корню проекта
- `page_list` - массив страниц ИМЕННО твоего батча: `[{ "url": "https://...", "type": "Категория" }, ...]` (URL абсолютные, готовы для fetch)
- `batch_id` - номер шарда (целое; определяет имя выходного файла `onpage_<batch_id>.json`)

## Обязательное чтение

1. `<audit_dir>/recon.json` - `domain`, `main_mirror` (контекст; для fetch не обязателен, URL в `page_list` уже абсолютные)

## Что делать

Для **каждой** страницы из `page_list`:

```
mcp_fetch_page(url="<url>", max_content_length=50000)
```

При ошибке fetch - повтор 1 раз через ~30 сек; не помогло - запись в `mcp_errors: [{tool, param, error}]` и пропустить страницу (остальные продолжать). `WebFetch` - fallback, если `mcp_fetch_page` недоступен. `render_js` НЕ использовать (вся проверка - по сырому HTML).

Из HTML извлечь и записать элемент `sample[]`:

- **Title** -> `title_text`, `title_len`. Пустой -> 🔴 «Title не заполнен»; `> 70` символов -> 🟡 «Title слишком длинный».
- **H1** -> `h1_text`, `h1_count`. Нет H1 -> 🔴 «Нет H1»; `> 1` -> 🔴 «Несколько H1 на странице».
- **Description** -> `desc_text`, `desc_len`. Пустой -> 🔴 «Description не заполнен»; `> 200` -> 🟡 «Description слишком длинный».
- **noindex** -> `noindex` (bool). **Точная проверка** (частый ложный позитив):
  1. Найти все вхождения подстроки `noindex` в HTML.
  2. Для каждого проверить, что оно НЕ внутри HTML-комментария `<!-- ... -->` и НЕ внутри `<script>`.
  3. Считать `noindex=true` ТОЛЬКО если оно в `<meta name="robots|yandex|googlebot" content="...noindex...">` ИЛИ в HTTP-заголовке `X-Robots-Tag` ответа.
  4. **НЕ считать** за noindex: `<!--noindex-->...<!--/noindex-->` (Яндекс-тег скрытия фрагмента, индексацию НЕ блокирует), noindex в комментариях, JS/JSON, в тексте.
  5. `noindex=true` на странице, которая должна быть в индексе -> 🔴 «Страница закрыта от индексации через noindex».
- **Canonical** -> `canonical` (значение `href` или `null`). Указывает на ДРУГОЙ URL -> 🟡 «Canonical ведёт на другой URL - убедиться что намеренно».
- **Schema.org** -> `schema` (МАССИВ найденных типов). Искать `<script type="application/ld+json">` (`Organization`/`LocalBusiness`, `Product`+`Offer`, `Service`, `BreadcrumbList`, `FAQPage`, `Article`/`BlogPosting`) и microdata (`itemscope`/`itemtype`/`itemprop`). Только список типов - сводку `schema_summary` посчитает merge.
- **Хлебные крошки** -> `has_breadcrumbs` (bool): навигационные крошки в HTML (`<nav>`, класс `breadcrumb`, `<ol>` со ссылками на родителей, или `BreadcrumbList` в Schema). Нет на внутренней странице -> 🟡 «Хлебные крошки отсутствуют».
- **Контент на JS** -> `content_on_js` (bool) + `has_content` (bool). Сигналы JS-рендеринга по сырому HTML: нет основного текста/заголовков H1-H2 в теле (вне `<script>`); нет товарных карточек/цен там где ожидаются; пустой `<div id="app"></div>` / `<div id="root"></div>`. Контент отсутствует -> `content_on_js=true`, `has_content=false`, 🔴 «Контент вероятно подгружается через JavaScript - Яндекс может не видеть содержимое; проверить сохранённую копию, рассмотреть SSR/пререндеринг». Контент есть -> `content_on_js=false`.
- **`issues`** - краткая строка проблем этой страницы для таблицы мета-тегов (например «Title-заглушка, нет Description» или «-», если чисто). Про «Title-заглушку» как термин писать можно, но саму заглушку детектирует merge по всем шардам - ты её на своём батче не вычисляешь.

### Favicon (только если в твоём `page_list` есть главная «/»)

Если в батче есть главная (path `/`) - из её HTML искать `<link rel="icon">`, `<link rel="shortcut icon">`, `<link rel="apple-touch-icon">`. Найдено -> `favicon=true`; нет -> `favicon=false`. Если главной в твоём батче НЕТ -> `favicon=null` (её проверит шард с главной).

### Собрать problems / ok_items

- `problems` - per-page находки из правил выше: `{priority, title, block, details}`. `priority`: `"critical"` (🔴) | `"important"` (🟡) | `"nice"` (🟢). `block` = `"Мета-теги"`. **Только по своим страницам** - без межстраничных дублей/заглушки.
- `ok_items` - короткие строки того, что на твоих страницах проверено и в порядке (например «Хлебные крошки присутствуют», «noindex нет»).

## Выход

### `<audit_dir>/onpage_<batch_id>.json`

```json
{
  "batch_id": 1,
  "favicon": true,
  "sample": [
    {
      "url": "https://example.ru/", "type": "Главная",
      "title_text": "...", "title_len": 7, "h1_text": "...", "h1_count": 1,
      "desc_text": "...", "desc_len": 0, "noindex": false, "canonical": null,
      "schema": ["Organization"], "has_breadcrumbs": false,
      "has_content": true, "content_on_js": false, "issues": "нет Description"
    }
  ],
  "problems": [ { "priority": "critical", "title": "Description не заполнен", "block": "Мета-теги", "details": "/" } ],
  "ok_items": [],
  "mcp_errors": []
}
```

Замечания:
- `schema` в каждом элементе `sample[]` - МАССИВ типов (склейку в строку и `schema_summary` делает merge).
- `canonical` - строка-href или `null`. `favicon` - `true`/`false`/`null` (null если главной нет в батче).
- Имя файла строго `onpage_<batch_id>.json` (по `batch_id` из входа).

## Сводка в чат (3-5 строк)

- Шард `<batch_id>`: проверено `<N>` страниц из `<len(page_list)>`
- Проблемных Title/H1/Description: `<N>`; noindex на нужных: `<N>`; контент на JS: `<N>`
- Schema-типы встретились: `<список или «нет»>`; хлебные крошки: `<сколько со/без>`
- Favicon: `<есть/нет/не мой батч>`
- ⚠️ mcp_errors: `<если есть - перечисли>`

## Запреты

- Длинное тире (—) и среднее (–) не использовать. Только дефис (-).
- НЕ редактируй `recon.json`, `indexing.json`, чужие шарды - пишешь только свой `onpage_<batch_id>.json`.
- **НЕ делай межстраничные проверки:** Title-заглушку (≥50% одинаковых), дубли Title/H1 между страницами, `schema_summary`, `url_structure` (ЧПУ/глубина/длина/мультислеш) - всё это считает `merge-onpage.mjs` по объединённой выборке всех шардов. Ты работаешь ТОЛЬКО со своими страницами.
- **НЕ сэмплируй и не добирай страницы** - аудируешь ровно `page_list`, ни больше ни меньше.
- **noindex - только точная проверка.** НЕ помечай `noindex=true` из-за `<!--noindex-->`, комментариев или JS-кода.
- НЕ вызывай `wm_*`, `ym_*`, `domain_*` - твоя зона только fetch страниц своего батча.
