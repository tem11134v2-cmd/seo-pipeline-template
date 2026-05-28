# /seo-analysis — Roadmap рефакторинга

> ✅ **ПРИМЕНЕНО 2026-05-28** в main-сессии. Все три волны закоммичены. Перенесено в `processed/` как audit trail.
>
> **Статус по волнам:**
> - Волна 1 — `seo-analysis: волна 1 — client_pages + slug + ASCII docx + Не проверено`
> - Волна 2 — `seo-analysis: волна 2 — Drive + state machine + revising-цикл + share-analysis + Executive Summary`
> - Волна 3 — `seo-analysis: волна 3 — финализация (CLAUDE.md /share-analysis, перенос ROADMAP)`
>
> **Что осталось вручную:**
> - В `~/.claude/seo-knowledge/DRIVE.md` появилась строка `analyses_folder_id: <TODO>` — создай папку `/SEO/Analyses/` в Drive (anyone-with-link → reader) и пропиши её ID.
> - 3.3 (шум маркеров) и 3.4 (hover-видимость правок) — отложены до первого боевого прогона. Хук `check-file.sh` чист, видимые упоминания маркеров в SKILL.md убраны.
>
> ---
>
> ⚠️ **Это НЕ автоматический handoff-request.** Файл переезжает в main через `/handoff`, но `/handoff-process` его не применит — это план для ручной реализации в отдельной main-сессии.
>
> **Цель:** закрыть систематические косяки скила `/seo-analysis`, выявленные при первом боевом запуске (проект `remont-kvartir-dnr`). После применения — следующий клиент пойдёт по улучшенному алгоритму.

## Контекст

Скил `/seo-analysis` (бриф → конкуренты → SERP → скан смыслов → A2/A3) первый раз прогнан на живом проекте. Главный системный косяк — алгоритм не знал про существующие страницы клиента (например /tseny с трафиком 3407/мес), и `leader-scanner` сравнивал лидеров с абстрактным «клиент = лендинг». Из-за этого скил рекомендовал «добавить прайс», который у клиента уже был и работал лучше главной.

Параллельно — баг с кириллицей в имени .docx, ручной вопрос «генерировать docx?» (всегда «да»), отсутствие cycle «отчёт → правки → одобрение», и несколько UX-моментов.

## Применение

Открыть main-сессию **БЕЗ галочки worktree** (правки общих файлов под pre-commit hook'ом). Открыть этот файл рядом с целевым кодом и идти волна за волной. После каждой волны:

```
git add -A
git commit -m "seo-analysis: волна N — <короткое описание>"
```

(Pre-commit в main не блокирует — он защищает только worktree.)

## Состояние

- [x] **Волна 1** — критичные системные фиксы (П1, П4, П6 для brief.slug, П8)
- [x] **Волна 2** — Drive + state machine + revising-цикл (П2, П3, П10, П7) + Executive Summary + stop_list_detailed.json (перенесены из волны 3)
- [x] **Волна 3** — финализация (CLAUDE.md updated, ROADMAP перенесён). Пункты 3.3/3.4 отложены до прогона.

## Зависимости и порядок

```
brief.json теперь содержит slug + client_pages
   ↓ (Волна 1, файлы 1.1, 1.2)
leader-scanner читает client_pages
   ↓ (Волна 1, файл 1.3)
analysis-writer выводит client_pages в A2.md + recommendations.json
   ↓ (Волна 1, файл 1.5 + Волна 2, файл 2.7)
build-analysis-docx.mjs читает slug из brief.json (фикс кириллицы)
   ↓ (Волна 1, файл 1.6)
SKILL.md state machine + Drive
   ↓ (Волна 2, файлы 2.1-2.6)
share-analysis SKILL.md (новый)
   ↓ (Волна 2, файл 2.8)
handoff warning
   ↓ (Волна 2, файл 2.9)
```

Внутри волны можно идти в любом порядке (правки независимы).

---

# ВОЛНА 1 — Критичные системные фиксы

Закрывает главный косяк (П1) + быстрые победы (П4, П8). После этой волны можно прогнать на следующем проекте и проверить, что /tseny-сценарий больше не повторится.

## 1.1. `brief.json` — добавить поля `slug` и `client_pages`

Канонический профиль клиента теперь хранит:
- `slug` (Latin kebab-case, нужен для `build-analysis-docx.mjs` и для логирования)
- `client_pages[]` (топ-5 страниц клиента из Keyso со скан-данными)

Меняем спецификацию выхода в `brief-structurer.md`. См. файл 1.2.

## 1.2. `.claude/agents/brief-structurer.md` — собирать client_pages

**Цель:** добавить сбор страниц клиента в шаг 1, чтобы у downstream-агентов был контекст «что у клиента уже есть».

### 1.2.1. Добавить шаг 3.5 «Собрать `client_pages`»

**Найти (между текущими шагами 3 и 4):**

```markdown
**Если домена нет:**
- `client_target_queries` непуст → `path = "C"`.
- Пуст → `path = "D"`.

### 4. Записать результат
```

**Заменить на:**

```markdown
**Если домена нет:**
- `client_target_queries` непуст → `path = "C"`.
- Пуст → `path = "D"`.

### 3.5. Собрать `client_pages` (только если `brief.domain` есть)

**Цель:** дать downstream-агентам (`leader-scanner`, `analysis-writer`) контекст того, что у клиента уже есть на сайте. Без этого алгоритм слеп — рекомендует добавить прайс/калькулятор/портфолио, не зная, что они уже есть и собирают трафик.

Если `brief.domain == null` — пропустить этот шаг, `brief.client_pages = []`.

Если `brief.domain` есть:

1. `domain_pages(domain="<brief.domain>", base="<brief.keyso_base>", sort="it50|desc", per_page=10)` — получить топ-10 страниц по числу запросов в ТОП-50.
2. Из ответа отобрать **до 5 страниц**:
   - **Главная** (URL заканчивается на `/` или равен корню) — всегда.
   - **До 4 страниц** с максимальным `top50_count` — это самые прокачанные посадочные.
3. По каждой выбранной странице: `mcp_fetch_page(url="<URL>")`. Если ошибка — `web_fetch(url="<URL>")`. Если оба не работают — пометить `"fetch_failed": true`, не блокировать.
4. Из контента извлечь:
   - `h1` (первый `<h1>` или title если нет).
   - `blocks` — массив смысловых секций по той же схеме, что использует `leader-scanner` (`hero`, `advantages`, `catalog_list`, `about`, `process`, `pricing`, `portfolio`, `reviews`, `faq`, `contacts`, `cta_inline`, `other:<имя>`).
   - `page_type` по эвристике: `home` (главная), `service` (одна услуга), `category` (каталог/листинг), `product` (карточка товара), `article` (статья), `pricing` (страница цен), `about`, `contacts`, `other`.

5. Сохранить в `brief.client_pages`:

```json
[
  {
    "url": "https://ремонт-квартир-днр.рф/tseny",
    "page_type": "pricing",
    "top10_count": 121,
    "top50_count": 287,
    "traffic_month": 3407,
    "h1": "Цены на ремонт квартир",
    "blocks": ["hero", "pricing", "advantages", "cta_inline", "contacts"],
    "fetch_failed": false
  }
]
```

**Бюджет:** 1 `domain_pages` + до 5 `mcp_fetch_page`. Если страница не открывается за 1 попытку — `fetch_failed: true`.

### 4. Записать результат
```

### 1.2.2. Добавить `slug` в `brief.json`

В описании выхода (раздел «### 4. Записать результат» → JSON-пример), **найти:**

```json
  "keyso_base": "spb",
  "city_not_in_keyso": false,
```

**Заменить на:**

```json
  "slug": "remont-kvartir-dnr",
  "keyso_base": "spb",
  "city_not_in_keyso": false,
```

**Также добавить в шаге 4** перед JSON-примером (после строки «`<analysis_dir>/brief.json`:»):

```markdown
**Поле `slug`** — Latin kebab-case идентификатор проекта, тот же, что в имени папки `analyses/NNN-<slug>/`. Берётся из пути `analysis_dir` (basename без `NNN-`). Нужен для `build-analysis-docx.mjs` (чтобы имя .docx было ASCII-safe).
```

### 1.2.3. Добавить `client_pages` в JSON-пример выхода

В том же JSON-примере **найти:**

```json
  "domain_dashboard_snapshot": {
    "dr": 5,
    "top10": 8,
    "top50": 65,
    "traffic_month": 800,
    "pages_keyso": 45
  },
  "gaps": [
```

**Заменить на:**

```json
  "domain_dashboard_snapshot": {
    "dr": 5,
    "top10": 8,
    "top50": 65,
    "traffic_month": 800,
    "pages_keyso": 45
  },
  "client_pages": [
    {
      "url": "https://site.ru/",
      "page_type": "home",
      "top10_count": 8,
      "top50_count": 65,
      "traffic_month": 800,
      "h1": "Ремонт квартир под ключ",
      "blocks": ["hero", "advantages", "process", "portfolio", "contacts"],
      "fetch_failed": false
    }
  ],
  "gaps": [
```

### 1.2.4. Обновить блок «Запреты» — поднять бюджет MCP

**Найти:**

```markdown
- Бюджет: максимум 1 вызов `domain_dashboard` (только если домен есть).
```

**Заменить на:**

```markdown
- Бюджет: 1 `domain_dashboard` + 1 `domain_pages` + до 5 `mcp_fetch_page` (только если домен есть). Итого до 7 MCP-вызовов на этап.
```

### 1.2.5. Обновить сводку в чат — добавить блок «Не проверено»

**Найти:**

```markdown
## Сводка в чат (после работы)

3-5 строк:

- Клиент: `<niche>`, `<region>`, домен: `<domain или «нет»>`
- Тип бизнеса: `<services/shop/both>`, ассортимент: `<сколько позиций>`
- База Keyso: `<keyso_base>` (`<город>`), путь: `<A/B/C/D>`
- УТП: тех `<N>`, серв `<N>`, соц `<N>`
- Пробелы: `<сколько в gaps>` параметров требуют уточнения
```

**Заменить на:**

```markdown
## Сводка в чат (после работы)

5-7 строк:

- Клиент: `<niche>`, `<region>`, домен: `<domain или «нет»>`
- Тип бизнеса: `<services/shop/both>`, ассортимент: `<сколько позиций>`
- База Keyso: `<keyso_base>` (`<город>`), путь: `<A/B/C/D>`
- УТП: тех `<N>`, серв `<N>`, соц `<N>`
- Страницы клиента: `<N>` (главная + `<N-1>` посадочных) - топ-1 по трафику: `<URL>` (`<traffic_month>`/мес)
- Пробелы: `<сколько в gaps>` параметров требуют уточнения
- ⚠️ Не проверено: блог клиента, наличие в Яндекс.Картах (если `yandex_maps == "unknown"`), поведенческие, регионы кроме `<region>`
```

### 1.2.6. Обновить заголовок (упоминание 16 параметров)

**Найти в шапке:**

```markdown
Твоя задача — извлечь из свободного брифа клиента (опросник / свободный текст / расшифровка разговора) 16 структурированных параметров, определить базу Keyso для проекта и путь поиска конкурентов. На выходе — один JSON.
```

**Заменить на:**

```markdown
Твоя задача — извлечь из свободного брифа клиента (опросник / свободный текст / расшифровка разговора) 16 структурированных параметров, собрать снимок страниц клиента из Keyso, определить базу Keyso для проекта и путь поиска конкурентов. На выходе — один JSON.
```

## 1.3. `.claude/agents/leader-scanner.md` — читать client_pages

**Цель:** сравнивать лидеров с реальной структурой клиента, а не с абстрактным лендингом.

### 1.3.1. Добавить `client_pages` в обязательное чтение

**Найти:**

```markdown
## Обязательное чтение

1. `<analysis_dir>/brief.json` — `niche`, `business_type`, `utp_technical`, `utp_service`, `utp_social`, `assortment`
2. `<analysis_dir>/competitors.json` — `leaders_top3` (список из 3 доменов) + типы и метрики
3. `<project_root>/.claude/skills/seo-analysis/MCP_MAP.md` — карта MCP
```

**Заменить на:**

```markdown
## Обязательное чтение

1. `<analysis_dir>/brief.json` — `niche`, `business_type`, `utp_technical`, `utp_service`, `utp_social`, `assortment`, **`client_pages`** (если есть)
2. `<analysis_dir>/competitors.json` — `leaders_top3` (список из 3 доменов) + типы и метрики
3. `<project_root>/.claude/skills/seo-analysis/MCP_MAP.md` — карта MCP
```

### 1.3.2. Переписать блок 3.3 «Чего нет у клиента» — сравнение страница-к-странице

**Найти:**

```markdown
#### 3.3. Чего нет у клиента, но есть у конкурентов

Какие посылы/блоки/фишки есть у лидеров, но **отсутствуют в УТП клиента**.

```json
{
  "client_missing": [
    {"item": "Калькулятор стоимости на главной", "found_in": ["a.ru", "b.ru"], "recommendation": "Добавить — конверсия выше"},
    {"item": "Раздел кейсы с фото до/после", "found_in": ["b.ru", "c.ru"], "recommendation": "Внедрить — социальное доказательство"}
  ]
}
```
```

**Заменить на:**

```markdown
#### 3.3. Чего нет у клиента, но есть у конкурентов

**Важно: сравнение страница-к-странице, а не «у клиента вообще нет».**

Логика:

1. Из `brief.client_pages` собери все блоки, типы страниц и H1, которые УЖЕ есть у клиента.
2. Из своих 9-12 проанализированных страниц лидеров собери все блоки и фишки.
3. **«Не хватает»** = блок/фишка встречается у 2+ лидеров И отсутствует на ВСЕХ страницах клиента в `client_pages`.
4. Если `brief.client_pages` пуст (нет домена / fetch упал) — пометить `"comparison_basis": "utp_only"` и сравнивать с `brief.utp_*` как раньше (fallback-режим).

Конкретные пометки:

- Если у клиента ЕСТЬ страница типа `pricing` с трафиком > 0 → НЕ писать «нет страницы цен», даже если у конкурентов она центральная.
- Если у клиента ЕСТЬ блок `portfolio` хотя бы на одной странице → НЕ писать «нет портфолио», только «портфолио меньше представлено» если применимо.
- Если у клиента ЕСТЬ страница с блоком `pricing`, но конкуренты делают это лучше (квиз/калькулятор) → формулировка «есть, но без интерактивных инструментов».

```json
{
  "comparison_basis": "client_pages",
  "client_missing": [
    {
      "item": "Калькулятор стоимости в блоке pricing",
      "found_in": ["a.ru", "b.ru"],
      "client_status": "блок есть на /tseny, но без калькулятора",
      "recommendation": "Добавить калькулятор в существующий блок"
    },
    {
      "item": "Раздел кейсы с фото до/после",
      "found_in": ["b.ru", "c.ru"],
      "client_status": "отсутствует на всех 5 страницах",
      "recommendation": "Создать отдельную страницу /cases с фото"
    }
  ]
}
```
```

### 1.3.3. Обновить сводку в чат — учесть client_pages и добавить «Не проверено»

**Найти:**

```markdown
## Сводка в чат (5-7 строк)

- Проанализировано страниц: `<N>` (по `<X>` на каждого из 3 лидеров)
- Общие блоки у 2+ из 3 лидеров: `<список>`
- УТП клиента, которые уже у конкурентов: `<N>`
- Чего нет у клиента: `<N>` пунктов (главные: `<1-2 примера>`)
- Уникальные фишки лидеров: `<список>` (если есть)
```

**Заменить на:**

```markdown
## Сводка в чат (6-8 строк)

- Проанализировано страниц лидеров: `<N>` (по `<X>` на каждого из 3 лидеров)
- Базис сравнения: `<client_pages | utp_only>` (если `utp_only` — `brief.client_pages` пуст)
- Общие блоки у 2+ из 3 лидеров: `<список>`
- УТП клиента, которые уже у конкурентов: `<N>`
- Чего реально нет у клиента (с учётом `client_pages`): `<N>` пунктов (главные: `<1-2 примера>`)
- Уникальные фишки лидеров: `<список>` (если есть)
- ⚠️ Не проверено: мобильная версия лидеров, скорость загрузки, эффективность CTA (только структура и посылы)
```

## 1.4. `.claude/agents/competitor-finder.md` — добавить «Не проверено» в сводку

**Найти:**

```markdown
## Сводка в чат (5-7 строк)

- Путь: A/B/C/D
- Найдено кандидатов: `<raw_count>`, после фильтрации: `<after_filter_count>`
- Исключено: агрегаторов `<N>`, маркетплейсов `<N>`, инфопорталов `<N>`, прочих `<N>`
- Финальные `<6-10>` конкурентов: домен1 (DR X, тип Y), домен2 (DR X, тип Y), ...
- Топ-3 лидера: `<домен1>`, `<домен2>`, `<домен3>`
- Тип сайта клиента: `<client_type>`
```

**Заменить на:**

```markdown
## Сводка в чат (6-8 строк)

- Путь: A/B/C/D
- Найдено кандидатов: `<raw_count>`, после фильтрации: `<after_filter_count>`
- Исключено: агрегаторов `<N>`, маркетплейсов `<N>`, инфопорталов `<N>`, прочих `<N>`
- Финальные `<6-10>` конкурентов: домен1 (DR X, тип Y), домен2 (DR X, тип Y), ...
- Топ-3 лидера: `<домен1>`, `<домен2>`, `<домен3>`
- Тип сайта клиента: `<client_type>`
- ⚠️ Не проверено: ссылочный профиль конкурентов, упоминания в СМИ, активность в соцсетях (только Keyso-метрики и тип сайта)
```

## 1.5. `.claude/agents/serp-verdict.md` — добавить «Не проверено» в сводку

**Найти:**

```markdown
## Сводка в чат (4-6 строк)

- Запросы проанализированы: `<N>` (список через запятую)
- Тип SERP: преобладает `<тип>`, агрегаторов в ТОП-3 `<N>` из `<всего>`, интент `<тип>`
- **Вердикт**: `<ТИП ВЕРДИКТА>` + 1 предложение обоснования
- Стоп-лист (промежуточный): `<N>` доменов
- Смежные направления: `<N>` найдено (или «значимых пробелов не обнаружено»)

Если вердикт `КОРРЕКТИРУЕМ` или `МЕНЯЕМ` — в конце добавь:
> ⚠️ Вердикт `<тип>` — рекомендую обсудить с клиентом до продолжения работ (но скил не блокирует автоматически).
```

**Заменить на:**

```markdown
## Сводка в чат (5-7 строк)

- Запросы проанализированы: `<N>` (список через запятую)
- Тип SERP: преобладает `<тип>`, агрегаторов в ТОП-3 `<N>` из `<всего>`, интент `<тип>`
- **Вердикт**: `<ТИП ВЕРДИКТА>` + 1 предложение обоснования
- Стоп-лист (промежуточный): `<N>` доменов
- Смежные направления: `<N>` найдено (или «значимых пробелов не обнаружено»)
- ⚠️ Не проверено: ТОП-11-50 (только ТОП-10), сезонные колебания SERP, локальные коммерческие факторы (Карты, ЯБМ)

Если вердикт `КОРРЕКТИРУЕМ`, `МЕНЯЕМ` или `ИДЁМ С ОГОВОРКАМИ` — в конце добавь:
> ⚠️ Вердикт `<тип>` — рекомендую обсудить с клиентом до продолжения работ.
> Главное в формулировке для пользователя: что именно нужно решить ДО продолжения (одно предложение).
```

## 1.6. `.claude/scripts/build-analysis-docx.mjs` — фикс кириллицы в имени файла

**Цель:** имя файла должно быть ASCII-safe, без кириллицы. Источник — `brief.slug` (после правок 1.2), fallback — basename папки `analyses/NNN-<slug>/`.

**Найти:**

```javascript
const domain = brief.domain || "site";
const companyName = brief.company_name || domain;
// safe name for file system (Windows: <>:"/\|?*)
const slug = (brief.domain || domain).replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").replace(/\./g, "-");
const outputPath = join(analysisDir, `A2_${slug}.docx`);
```

**Заменить на:**

```javascript
const domain = brief.domain || "site";
const companyName = brief.company_name || domain;

// Slug для имени файла: ASCII-safe Latin kebab-case.
// 1) Приоритет — brief.slug (его кладёт brief-structurer с шага 1).
// 2) Fallback — basename папки analyses/NNN-<slug>/ (отрезаем "NNN-").
// 3) Последний fallback — "site" (если ничего нет).
function resolveSlug() {
  if (brief.slug && /^[a-z0-9-]+$/.test(brief.slug)) return brief.slug;
  const base = analysisDir.split(/[\\/]/).filter(Boolean).pop() || "";
  const m = base.match(/^\d+-(.+)$/);
  if (m && m[1]) return m[1];
  return "site";
}
const slug = resolveSlug();
const outputPath = join(analysisDir, `A2_${slug}.docx`);
```

## 1.7. `.claude/agents/analysis-writer.md` — добавить раздел 1.8 «Существующие страницы» в A2

**Цель:** в финальном A2.md отдельная подсекция «что уже есть на сайте клиента».

### 1.7.1. Добавить чтение client_pages

**Найти (в «Обязательное чтение»):**

```markdown
1. `<analysis_dir>/brief.json`
2. `<analysis_dir>/competitors.json`
```

**Заменить на:**

```markdown
1. `<analysis_dir>/brief.json` (включая поля `slug`, `client_pages`)
2. `<analysis_dir>/competitors.json`
```

### 1.7.2. Добавить подраздел 1.8 в шаблон A2

**Найти:**

```markdown
### 1.7. Требует уточнения

<brief.gaps списком; если пусто — «нет открытых вопросов»>

---

## 2. Конкуренты
```

**Заменить на:**

```markdown
### 1.7. Требует уточнения

<brief.gaps списком; если пусто — «нет открытых вопросов»>

### 1.8. Существующие страницы клиента

<если brief.client_pages пуст — «Домен клиента не указан, страницы не анализировались.»>

<если непуст — таблица>:

| URL | Тип | H1 | Запросы в ТОП-10 | Запросы в ТОП-50 | Трафик/мес | Ключевые блоки |
|---|---|---|---|---|---|---|
| `<url>` | `<page_type>` | `<h1>` | `<top10_count>` | `<top50_count>` | `<traffic_month>` | `<blocks через запятую>` |

**Примечание для последующих услуг (У3, У5):** перечисленные страницы УЖЕ работают и собирают трафик. Рекомендации по их доработке см. в разделе 3 «Скан смыслов топ-3» → «Чего нет у клиента» (там учтены существующие страницы).

---

## 2. Конкуренты
```

### 1.7.3. Подправить блок 3.4 в шаблоне A2 — отразить базис сравнения

**Найти:**

```markdown
**Чего нет у клиента:**
<leader_scan.summary.client_missing - построчно «<item> (найдено у <found_in>) - <recommendation>»>
```

**Заменить на:**

```markdown
**Чего нет у клиента** (базис сравнения: `<leader_scan.summary.comparison_basis>`):
<leader_scan.summary.client_missing - построчно «<item> (найдено у <found_in>) - <client_status>; <recommendation>»>
```

---

# ВОЛНА 2 — Drive + state machine + revising

Замыкает цикл «отчёт готов → клиент посмотрел → правки → одобрение → handoff». Главное изменение: документ автоматически уезжает в Drive по той же ссылке после каждой правки. Пользователь не делает `/handoff` пока state ≠ `approved`.

## 2.0. Предварительное: добавить `analyses_folder_id` в `~/.claude/seo-knowledge/DRIVE.md`

**Это не правка кода, а ручное действие.** Один раз — открыть DRIVE.md, добавить строку с ID папки `/SEO/Analyses/` (создать в Drive если её нет, выставить permission `anyone-with-link → reader` на саму папку — файлы наследуют).

Образец того, что должно быть в DRIVE.md:

```markdown
# DRIVE folder IDs

- strategies_folder_id: 1AbCdEf...
- smety_folder_id: 1GhIjKl...
- analyses_folder_id: 1MnOpQr...   ← добавить
```

## 2.1. `.claude/skills/seo-analysis/SKILL.md` — Drive по дефолту + state machine

Главные изменения:
- Шаг 6 переименован в шаг 7, становится **обязательным** (флаг `--no-share` для отказа).
- После шага 7 — шаг 8: upload в Drive + share (по образцу `/strategy` шаг 9).
- После шага 8 — состояние `client-review`. Скил ждёт фидбек.
- Если правки — состояние `revising`. После правок — re-upload по тому же `drive_id` (ссылка не меняется).
- Если одобрено — состояние `approved`. Только после этого скил подсказывает `/handoff`.

### 2.1.1. Обновить шапку state machine

**Найти:**

```markdown
## State machine

```
init → brief-done → competitors-done → serp-done → leaders-done → report-done → [docx-done] → completed
```

`docx-done` — опциональное состояние. Если после `report-done` пользователь не запрашивает .docx, скил сразу переходит в `completed`.
```

**Заменить на:**

```markdown
## State machine

```
init → brief-done → competitors-done → serp-done → leaders-done → report-done
     → docx-done → shared → client-review
          ↻ revising → docx-done → shared → client-review (цикл по итерациям правок)
     → approved → completed
```

Состояния:
- `report-done` — A2.md и A3.md собраны (шаг 6).
- `docx-done` — .docx собран (шаг 7). По умолчанию обязательное состояние; пропускается только при `--no-share`.
- `shared` — .docx залит в Drive, ссылка получена (шаг 8). При `--no-share` пропускается.
- `client-review` — скил ждёт фидбек от пользователя по ссылке.
- `revising` — пользователь дал правку, скил её применяет (Edit или перезапуск шага).
- `approved` — пользователь явно сказал «всё ОК». Только после этого скил рекомендует `/handoff`.
- `completed` — финальное состояние (после `/handoff`).
```

### 2.1.2. Добавить аргументы

**Найти:**

```markdown
## Аргументы

```
/seo-analysis [--resume]
```

- Без аргументов — скил запросит бриф у пользователя в чате (можно вставить текст или указать путь к файлу).
- `--resume` — продолжить с того места, где остановились (по `meta.json` существующей `analyses/NNN-slug/`).
```

**Заменить на:**

```markdown
## Аргументы

```
/seo-analysis [--resume] [--no-share]
```

- Без аргументов — скил запросит бриф у пользователя в чате (можно вставить текст или указать путь к файлу).
- `--resume` — продолжить с того места, где остановились (по `meta.json` существующей `analyses/NNN-slug/`).
- `--no-share` — собрать только A2.md + A3.md, не делать .docx и не заливать в Drive. Финальное состояние `report-done` вместо `approved`. Для случаев когда клиента нет, или нужны только текстовые артефакты для следующих услуг.
```

### 2.1.3. Обновить раздел «Артефакты»

**Найти:**

```markdown
## Артефакты

```
analyses/NNN-<domain-slug>/
├── meta.json              # state machine
├── brief_raw.txt          # исходный бриф (как пришёл от пользователя)
├── brief.json             # 16 параметров + keyso_base + region_id + путь А/Б/В/Г
├── candidates.json        # 15+ доменов-кандидатов до фильтрации (intermediate)
├── competitors.json       # 6-10 финальных + топ-3 лидера + причины исключений
├── serp.json              # SERP-анализ + вердикт + промежуточный стоп-лист + смежные
├── leader_scan.json       # блоки/посылы/фишки по топ-3 + сводка с сопоставлением
├── A2.md                  # ФИНАЛ — markdown-отчёт (5 разделов)
├── A3.md                  # ФИНАЛ — стоп-лист (по строке = домен)
└── A2_<slug>.docx         # опц. финал для клиента (шаг 7)
```
```

**Заменить на:**

```markdown
## Артефакты

```
analyses/NNN-<domain-slug>/
├── meta.json                  # state machine + drive_file_id + revisions_log
├── brief_raw.txt              # исходный бриф (как пришёл от пользователя)
├── brief.json                 # 16 параметров + slug + client_pages + keyso_base + путь А/Б/В/Г
├── candidates.json            # 15+ доменов-кандидатов до фильтрации (intermediate)
├── competitors.json           # 6-10 финальных + топ-3 лидера + причины исключений
├── serp.json                  # SERP-анализ + вердикт + промежуточный стоп-лист + смежные
├── leader_scan.json           # блоки/посылы/фишки по топ-3 + сводка с сопоставлением
├── A2.md                      # ФИНАЛ — markdown-отчёт (Executive Summary + 5 разделов)
├── A3.md                      # ФИНАЛ — стоп-лист (по строке = домен)
├── stop_list_detailed.json    # параллельный machine+human вариант стоп-листа с причинами
├── recommendations.json       # структурированные рекомендации для /strategy, /write-article
├── A2_<slug>.docx             # ASCII-safe имя; собирается всегда кроме --no-share
└── share.json                 # ссылка Drive + drive_file_id + shared_at + revisions[]
```
```

### 2.1.4. Изменить шаг 6 (сборка A2/A3) — убрать вопрос про .docx

**Найти:**

```markdown
После завершения:
- `bash .claude/hooks/update-meta.sh <analysis_dir> report-done`
- Вывести пользователю краткую сводку + пути к A2.md и A3.md.
- Спросить:
  > «Отчёт готов. Сгенерировать .docx для клиента? [Y/n]»
  - Y → шаг 7
  - n → пропустить шаг 7, перейти к финалу с state `report-done`
```

**Заменить на:**

```markdown
После завершения:
- `bash .claude/hooks/update-meta.sh <analysis_dir> report-done`
- Вывести пользователю краткую сводку + пути к A2.md, A3.md, `recommendations.json`, `stop_list_detailed.json`.
- Если запущено с `--no-share`: переход к финалу (шаг 9) с state `report-done`. Не делать docx и не грузить в Drive.
- Иначе: автоматический переход к шагу 7 (без вопроса).
```

### 2.1.5. Изменить шаг 7 (Docx) — теперь обязательный по умолчанию

**Найти:**

```markdown
### 7. Опц. сборка .docx (если state == "report-done" и пользователь сказал Y)

```
.claude\scripts\_node.cmd .claude\scripts\build-analysis-docx.mjs <analysis_dir>
```

Скрипт читает `A2.md` + `brief.json` + `serp.json`, генерирует `<analysis_dir>/A2_<slug>.docx`.

После:
- `bash .claude/hooks/update-meta.sh <analysis_dir> docx-done`
- Переход к финалу.
```

**Заменить на:**

```markdown
### 7. Сборка .docx (если state == "report-done", обязательно кроме --no-share)

```
.claude\scripts\_node.cmd .claude\scripts\build-analysis-docx.mjs <analysis_dir>
```

Скрипт читает `A2.md` + `brief.json` + `serp.json`, генерирует `<analysis_dir>/A2_<slug>.docx` (ASCII-safe имя — после фикса в волне 1).

После:
- `bash .claude/hooks/update-meta.sh <analysis_dir> docx-done`
- Переход к шагу 8 (Drive).

### 8. Upload в Drive (если state == "docx-done", обязательно кроме --no-share)

#### 8a. Прочитать DRIVE.md

`~/.claude/seo-knowledge/DRIVE.md` → извлечь `analyses_folder_id`.

Если файла или поля нет — стоп:
> «Не найден `analyses_folder_id` в DRIVE.md. Создай папку `/SEO/Analyses/` в Drive с правами `anyone-with-link → reader`, добавь её ID в DRIVE.md. Затем продолжи через `/seo-analysis --resume`.»

#### 8b. Если в meta.json есть `drive_file_id` (revising-цикл)

Это значит — повторная заливка после правок. Удалить старый файл по `drive_file_id` (тогда новый получит новый ID, но это норм для revising-цикла; ссылка может поменяться). Альтернатива: использовать `mcp__gdrive-piotr__uploadFile` с тем же `name` — если папка с `anyone-with-link` правами, Drive обновит файл по имени. **Идти по простому пути: delete + upload.**

```
mcp__gdrive-piotr__deleteItem(itemId="<old_drive_file_id>")
```

(Если deleteItem упал — файл уже удалён руками. Предупредить, продолжить.)

#### 8c. Загрузка

```
mcp__gdrive-piotr__uploadFile(
  localPath: <абсолютный путь к A2_<slug>.docx>,
  name: A2_<slug>,
  parentFolderId: <analyses_folder_id>,
  convertToGoogleFormat: true
)
```

Если `convertToGoogleFormat: true` упал (Google Docs API не активна) — fallback: повторить с `convertToGoogleFormat: false`. В сводку добавить:
> ⚠️ Залит как .docx (Google Docs API не активна). Активируй в Google Cloud Console, потом `/share-analysis <NNN> --redo`.

Сохранить `id`, `link` из ответа.

#### 8d. Записать `share.json` и обновить meta.json

`<analysis_dir>/share.json`:

```json
{
  "drive_file_id": "<id>",
  "drive_link": "<link>",
  "mime_type": "application/vnd.google-apps.document" | "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "shared_at": "<ISO timestamp UTC>",
  "revisions": []
}
```

В `meta.json` добавить через жёлтый `Edit` (или через `update-meta.sh ... drive_file_id=<id>`):

```json
"drive_file_id": "<id>",
"drive_link": "<link>"
```

`bash .claude/hooks/update-meta.sh <analysis_dir> shared`

#### 8e. Переход в состояние `client-review`

`bash .claude/hooks/update-meta.sh <analysis_dir> client-review`

Вывести пользователю:

```
═══ A2 ГОТОВ И ЗАЛИТ В DRIVE ═══

📄 Ссылка для клиента (Google Doc):
   <drive_link>

📌 Локальные артефакты:
   <analysis_dir>/A2.md
   <analysis_dir>/A3.md
   <analysis_dir>/recommendations.json
   <analysis_dir>/A2_<slug>.docx

🔎 Сводка вердикта:
   <serp.verdict.type>

📋 Главные действия (топ-3 из recommendations.json):
   1. <item> (priority: <p>)
   2. ...
   3. ...

Жду фидбек:
  - "одобряю" / "OK" / "approved" → скил перейдёт в approved и подскажет /handoff
  - "есть правки: <описание>" → скил классифицирует и применит
```

**Не выходить из сессии. Ждать пользовательский ввод. После любого фидбека — шаг 9 или 10.**

### 9. Обработка фидбека (state == "client-review")

#### 9a. Если пользователь одобрил

Триггеры одобрения (case-insensitive): «одобряю», «ок», «approved», «всё хорошо», «принято», «accept».

- `bash .claude/hooks/update-meta.sh <analysis_dir> approved`
- Переход к шагу 11 (финал).

#### 9b. Если пользователь дал правку

Перейти в state `revising`:

`bash .claude/hooks/update-meta.sh <analysis_dir> revising`

#### 9c. Классификация правки (Гибрид — модель C)

На основе текста правки скил предлагает свою классификацию и просит OK:

```
Получил правку: "<цитата правки 1 строкой>"

Похоже это [<тип>]:
  - тип "edit"      — точечная правка текста A2.md (формулировка, опечатка, добавить пункт)
  - тип "brief"     — добавить контекст про клиента (страницу, УТП, ассортимент)
  - тип "competitors" — поправить список конкурентов
  - тип "serp"      — пересчитать SERP / поправить вердикт
  - тип "leaders"   — пересканировать лидеров с уточнением
  - тип "writer"    — пересобрать A2 без перезапуска нижних шагов

Согласен? [Y / n=другой тип / details=покажи парс правки]
```

**Эвристики автоклассификации:**

| Признак в тексте правки | Тип |
|---|---|
| Содержит конкретную цитату из A2.md, или «переформулируй / убери / добавь пункт» | `edit` |
| «Вы пропустили», «не учли», «у клиента есть X» + упоминание URL/страницы | `brief` |
| «Не тот конкурент», «забыли A.ru», «B.ru не оттуда» | `competitors` |
| «Не тот запрос», «вердикт неправильный», «не считайте Y коммерческим» | `serp` |
| «У X есть фишка Y», «у Z блок W», «лидер делает по-другому» | `leaders` |
| Не подходит ни под одно — | `writer` |

Если пользователь сказал `n` — спросить тип явно (тот же список без рекомендации).

#### 9d. Применение правки по типу

**`edit`:** скил делает `Edit` в `A2.md` напрямую. Без перезапуска. Без апдейтов JSON.

**`brief`/`competitors`/`serp`/`leaders`:** пересобрать соответствующий JSON, потом downstream:

- `brief` — делегировать `brief-structurer` с дополнительной инструкцией «правка: <описание>; явно учти X». Затем перезапустить `competitor-finder`, `serp-verdict`, `leader-scanner`, `analysis-writer` последовательно. Может занять 10-20 минут.
- `competitors` — `competitor-finder` с пометкой, затем `serp-verdict`, `leader-scanner`, `analysis-writer`.
- `serp` — `serp-verdict`, затем `analysis-writer`.
- `leaders` — `leader-scanner`, затем `analysis-writer`.

**`writer`:** только перезапустить `analysis-writer` с инструкцией «при сборке учти: <правка>».

#### 9e. Re-build .docx и re-upload

- Перезапустить `build-analysis-docx.mjs`.
- Шаг 8b (delete старого Drive-файла) + 8c (upload нового).
- Обновить `share.json.revisions[]`:

```json
{
  "type": "<edit|brief|...>",
  "note": "<текст правки 1 строкой>",
  "applied_at": "<ISO>",
  "new_drive_file_id": "<id>",
  "new_drive_link": "<link>"
}
```

- Вернуться в `client-review` (шаг 8e). Цикл может повторяться.

### 10. Финал

`bash .claude/hooks/update-meta.sh <analysis_dir> completed`

Финальный коммит:
```
git add -A
git commit -m "Analysis <NNN> for <slug или domain>: completed (<N> revisions)"
```

Вывести:

```
═══ ПРЕДПРОЕКТНЫЙ АНАЛИЗ ОДОБРЕН ═══

Клиент: <domain или niche / region>
Итераций правок: <N>

📄 A2 в Drive (Google Doc, для клиента):
   <drive_link>

📌 Локальные артефакты для следующих услуг:
   <analysis_dir>/A2.md                     - У3, У5
   <analysis_dir>/A3.md                     - стоп-лист
   <analysis_dir>/recommendations.json      - структурированные рекомендации
   <analysis_dir>/stop_list_detailed.json   - стоп-лист с причинами

✅ Готово к /handoff (перенесёт в main).
═════════════════════════════════════════
```
```

### 2.1.6. Удалить старый раздел «8. Финал» (заменён на 10)

**Найти и удалить:**

```markdown
### 8. Финал (state == "report-done" без .docx ИЛИ "docx-done")

`bash .claude/hooks/update-meta.sh <analysis_dir> completed`

Финальный коммит в worktree-ветку:
```
git add -A
git commit -m "Analysis <NNN> for <domain или niche-region>: completed"
```

Вывести:

```
═══ ПРЕДПРОЕКТНЫЙ АНАЛИЗ ГОТОВ ═══

(... весь старый блок «Финал» ...)

⚠️ НЕ ЗАБУДЬ /handoff перед закрытием сессии — иначе файлы останутся
   в worktree и не попадут в основную папку проекта.
═════════════════════════════════
```
```

### 2.1.7. Обновить пункт «Шаг 4 SERP-вердикт» — пауза на «ИДЁМ С ОГОВОРКАМИ»

**Найти:**

```markdown
- **Если вердикт `КОРРЕКТИРУЕМ ТИП САЙТА` или `МЕНЯЕМ СТРАТЕГИЮ`** — пауза:
  > «Вердикт `<тип>` означает значительные изменения в сайте/стратегии. Рекомендуется обсудить с клиентом до продолжения работ. Продолжаем скан смыслов сейчас или приостановим? [Y — продолжить / N — приостановить]»
  - Если N — оставить state `serp-done`, выйти. Пользователь может потом запустить `--resume`.
- Иначе — сразу переход к шагу 5.
```

**Заменить на:**

```markdown
- **Если вердикт `КОРРЕКТИРУЕМ ТИП САЙТА`, `МЕНЯЕМ СТРАТЕГИЮ` или `ИДЁМ С ОГОВОРКАМИ`** — пауза с детальной сводкой:
  > «**Вердикт:** `<тип>`
  >
  > **Что это значит:** <1-2 предложения, из serp.verdict.reasoning>
  >
  > **Главные рекомендации:**
  > 1. <serp.verdict.recommendations[0]>
  > 2. <serp.verdict.recommendations[1]>
  > 3. <serp.verdict.recommendations[2]>
  >
  > Это стратегическое решение. Рекомендуется обсудить с клиентом ДО продолжения. Продолжаем скан смыслов сейчас или приостановим? [Y - продолжить / N - приостановить и обсудить]»
  - Если N — оставить state `serp-done`, выйти. Пользователь может потом запустить `--resume`.
- Если вердикт `ИДЁМ` — сразу переход к шагу 5 без паузы.
```

### 2.1.8. Убрать упоминания маркеров `expected-*-<run_id>.txt` из видимой документации

Если они мелькают в логах — это значит, что они логируются. Сами файлы оставить (контракт), но убрать сообщения о них из чата.

**В блоке «Маркер: ...» в начале каждого шага 2-6 — убрать строку про маркер из документации.** Это служебная деталь, она не должна быть в SKILL.md. (Механизм продолжает работать через hooks/check-file.sh — он сам читает маркер из tmp.)

Альтернатива (если механизм всё ещё нужен пользователю видеть): пометить «(служебный, не выводить в чат)» рядом.

**Найти каждое из 5 вхождений** (по строке для шагов 2, 3, 4, 5, 6):

```markdown
Маркер: `.claude/tmp/expected-<agent>-<run_id>.txt = ...`
```

**Заменить на:**

```markdown
(служебный маркер контракта агента создаётся автоматически — не выводить в чат)
```

## 2.2. `.claude/skills/seo-analysis/SKILL.md` — обновить алгоритм при `--resume` для новых состояний

**Найти в шаге 1a «Если --resume»:**

```markdown
- Спросить: «Найдено в состоянии `<state>`, обновлено `<updated>`. Продолжить? [Y/n]»
- Если Y — перейти к ветке от следующего шага после `state`.
- Если N — стоп, дать пользователю выбрать другую папку или начать заново.
```

**Заменить на:**

```markdown
- Спросить: «Найдено в состоянии `<state>`, обновлено `<updated>`. Продолжить? [Y/n]»
- Если Y — перейти к ветке от следующего шага после `state`:
  - `report-done` → шаг 7 (.docx)
  - `docx-done` → шаг 8 (Drive)
  - `shared` → шаг 8e (вывести ссылку, перейти в `client-review`)
  - `client-review` → шаг 9 (показать ссылку из `share.json`, ждать фидбек)
  - `revising` → шаг 9d (продолжить применять последнюю правку из `share.json.revisions[]`)
  - `approved` → шаг 10 (финал)
  - `completed` → стоп: «Анализ уже завершён. Используй `/share-analysis <NNN> --redo` для перезаливки.»
- Если N — стоп, дать пользователю выбрать другую папку или начать заново.
```

## 2.3. `.claude/agents/analysis-writer.md` — `recommendations.json` и `stop_list_detailed.json`

### 2.3.1. Добавить в «Что делать» сборку recommendations.json

**Найти (после блока про A2.md, перед «### Правила оформления»):**

```markdown
### Затем — собери `A2.md` (5 разделов)

(... весь существующий блок шаблона A2 ...)
```

**После этого блока вставить (перед «### Правила оформления»):**

```markdown
### Затем — собери `recommendations.json`

Структурированный машиночитаемый список рекомендаций для downstream-скилов (`/strategy`, `/write-article`, будущий У3, У5).

**Источник данных:**
- `serp.verdict.recommendations[]` — стратегические рекомендации
- `leader_scan.summary.client_missing[]` — точечные «чего нет у клиента»
- `serp.adjacent_directions[]` — смежные направления
- `leader_scan.summary.unique_features[]` — уникальные фишки лидеров (для будущего изучения)

**Формат:**

```json
{
  "for_strategy": [
    {
      "item": "Добавить каталожную структуру с категориями услуг",
      "priority": "high",
      "source": "serp_verdict",
      "effort": "high",
      "note": "Вердикт КОРРЕКТИРУЕМ ТИП — преобладают каталоги в SERP"
    }
  ],
  "for_pages": [
    {
      "item": "Калькулятор стоимости в блоке pricing на /tseny",
      "priority": "high",
      "source": "leaders[a.ru, b.ru]",
      "effort": "medium",
      "client_status": "блок есть, но без калькулятора"
    }
  ],
  "for_articles": [
    {
      "item": "Цикл статей по подвидам ремонта (косметический, капитальный, дизайнерский)",
      "priority": "medium",
      "source": "adjacent_directions",
      "effort": "high"
    }
  ]
}
```

**Эвристики priority:**
- `high` — встречается у 3/3 лидеров; или связано с центральным вердиктом
- `medium` — встречается у 2/3 лидеров; или вторичная рекомендация
- `low` — уникальная фишка одного лидера; или «рассмотреть на будущее»

**Эвристики effort:**
- `low` — изменение текста / добавить блок на готовую страницу
- `medium` — добавить страницу / интерактивный элемент
- `high` — структурная переделка сайта / новое направление бизнеса

Сохранить в `<analysis_dir>/recommendations.json`.

### Затем — собери `stop_list_detailed.json`

Параллельный с A3.md формат — для людей и для будущего парсинга причин.

```json
{
  "stop_list": [
    {
      "domain": "avito.ru",
      "reason": "агрегатор",
      "source": "competitor-finder.candidates.excluded"
    },
    {
      "domain": "cubedpr.ru",
      "reason": "Питер, не ДНР",
      "source": "serp-verdict.stop_list"
    }
  ]
}
```

Источники:
- `candidates.json.excluded[]` — все исключённые при фильтрации с их причинами
- `serp.stop_list[]` — добавленные на этапе SERP-анализа

Дедуплицировать по `domain`. Сохранить в `<analysis_dir>/stop_list_detailed.json`.
```

### 2.3.2. Обновить «Сводка в чат»

**Найти:**

```markdown
## Сводка в чат (3-5 строк)

- A2.md: 5 разделов, `<кол-во строк>` строк, `<кол-во таблиц>` таблиц
- A3.md: `<N>` доменов в стоп-листе
- Вердикт по выдаче: **<verdict.type>**
- Главные дыры у клиента: `<2-3 пункта из client_missing>`
- Смежные направления для роста: `<N>` направлений (или «без пробелов»)
```

**Заменить на:**

```markdown
## Сводка в чат (4-6 строк)

- A2.md: Executive Summary + 5 разделов, `<кол-во строк>` строк, `<кол-во таблиц>` таблиц
- A3.md: `<N>` доменов в стоп-листе (детально с причинами — в `stop_list_detailed.json`)
- `recommendations.json`: `<N1>` для /strategy, `<N2>` для /pages, `<N3>` для /articles
- Вердикт по выдаче: **<verdict.type>**
- Главные дыры у клиента (с учётом client_pages): `<2-3 пункта из client_missing>`
- Смежные направления для роста: `<N>` направлений (или «без пробелов»)
```

### 2.3.3. Обновить блок «Выход»

**Найти:**

```markdown
## Выход

### `<analysis_dir>/A2.md`

5 разделов по структуре выше. ~150-300 строк markdown в зависимости от объёма данных.

### `<analysis_dir>/A3.md`

Только домены, отсортированы, дедуплицированы. Один на строку. Заголовок `# A3 - Стоп-лист доменов`.
```

**Заменить на:**

```markdown
## Выход

### `<analysis_dir>/A2.md`

Executive Summary + 5 разделов по структуре выше. ~200-350 строк markdown в зависимости от объёма данных.

### `<analysis_dir>/A3.md`

Только домены, отсортированы, дедуплицированы. Один на строку. Заголовок `# A3 - Стоп-лист доменов`. **Этот файл — machine-readable**, причины не пишутся.

### `<analysis_dir>/recommendations.json`

Структурированные рекомендации для /strategy, /pages, /articles. Каждая запись: `item`, `priority`, `source`, `effort`, optionally `note` или `client_status`.

### `<analysis_dir>/stop_list_detailed.json`

Параллельный A3 формат с причинами и источниками. Для людей и для будущего использования в /strategy.
```

### 2.3.4. Обновить блок «Запреты» — учесть новые файлы

**Найти:**

```markdown
- НЕ записывай причины исключений в A3.md — только домены.
```

**Заменить на:**

```markdown
- НЕ записывай причины исключений в A3.md — только домены. Причины — в `stop_list_detailed.json`.
- НЕ выдумывай записи в `recommendations.json` — каждая должна иметь `source` (откуда взялась).
```

## 2.4. `.claude/agents/analysis-writer.md` — Executive Summary в начало A2.md

**Цель:** клиент видит сводку на первой странице .docx без пролистывания 25 КБ текста.

### 2.4.1. Добавить блок Executive Summary в шаблон A2

**Найти (самое начало шаблона):**

```markdown
```markdown
# Предпроектный анализ - <название проекта или domain>

**Дата:** <ISO дата сегодня в формате YYYY-MM-DD>
**Аналитик:** TIMUR SEO

---

## 1. Данные клиента
```

**Заменить на:**

```markdown
```markdown
# Предпроектный анализ - <название проекта или domain>

**Дата:** <ISO дата сегодня в формате YYYY-MM-DD>
**Аналитик:** TIMUR SEO

---

## Executive Summary

**Вердикт:** <serp.verdict.type>

**Главные выводы:**
1. <вывод 1 — 1 строка>
2. <вывод 2 — 1 строка>
3. <вывод 3 — 1 строка>

**Приоритетные действия:**
1. <действие 1 - из recommendations.json[priority=high][0]>
2. <действие 2 - из recommendations.json[priority=high][1]>
3. <действие 3 - из recommendations.json[priority=high][2]>

**Стоп-лист:** `<N>` доменов исключено из работы (см. A3.md).

**Существующие активы клиента:** <если client_pages непуст: «N посадочных уже собирают трафик, главная по трафику — <URL> (<traffic_month>/мес)»; если пуст: «сайт не указан / страницы не анализировались»>

---

## 1. Данные клиента
```

### 2.4.2. Описать правила формирования выводов

После шаблона A2 (перед «### Правила оформления») добавить:

```markdown
### Правила формирования Executive Summary

**Главные выводы** (3 шт., 1 строка каждый) — формулируем по следующим источникам:
1. Состояние сайта клиента + SERP-совместимость (из `serp.verdict.type` + `client_pages`).
2. Главный гэп между клиентом и лидерами (из `leader_scan.summary.client_missing[0]`).
3. Один из стратегических акцентов (из `serp.adjacent_directions` или из второго `client_missing`).

**Приоритетные действия** — выбираем из `recommendations.json` записи с `priority == "high"`, сортируем по `effort` (low → medium → high), берём топ-3.

Если `client_pages` пуст — пункт «Существующие активы клиента» заменяем на «Сайт клиента не анализировался (домен не указан в брифе) — рекомендации формулируются на гипотезах».
```

## 2.5. `.claude/scripts/build-analysis-docx.mjs` — первая страница = Executive Summary

**Цель:** в .docx Executive Summary рендерится на отдельной первой странице (PageBreak после него).

В файле `build-analysis-docx.mjs` найти функцию `renderBlocks`. После цикла обработки `heading` уровня 2 добавить логику: если text заголовка == «Executive Summary», запомнить флаг; на следующем `hr` после него — вставить `PageBreak` (а не пустую строку).

**Найти:**

```javascript
case "hr": {
  // Используем как мягкий разделитель — добавляем пустую строку
  out.push(plainParagraph(""));
  lastWasHr = true;
  break;
}
```

**Заменить на:**

```javascript
case "hr": {
  if (afterExecutiveSummary) {
    // После Executive Summary — разрыв страницы (клиент видит summary отдельно).
    out.push(new Paragraph({ children: [new PageBreak()] }));
    afterExecutiveSummary = false;
  } else {
    // В остальных случаях — мягкий разделитель.
    out.push(plainParagraph(""));
  }
  lastWasHr = true;
  break;
}
```

**И в начало функции `renderBlocks` (там где `let firstH1Seen = false;`) добавить:**

```javascript
let afterExecutiveSummary = false;
```

**В блоке обработки `heading` уровня 2 (после строки `out.push(heading(b.text, b.level));`) добавить проверку:**

```javascript
if (b.level === 2 && /executive summary/i.test(b.text)) {
  afterExecutiveSummary = true;
}
```

## 2.6. `.claude/skills/handoff/SKILL.md` — warning при state != approved

**Цель:** защита от случайного `/handoff` до одобрения клиентом.

### 2.6.1. Добавить шаг 1.5 «Проверка state анализа»

**Найти (между шагом 1 «Узнать параметры» и шагом 2 «Финальный коммит (auto)»):**

```markdown
Сообщить пользователю:
> «Handoff: `<CURRENT_BRANCH>` → `<BASE_BRANCH>` в `<MAIN_WT>`».

### 2. Финальный коммит (auto)
```

**Заменить на:**

```markdown
Сообщить пользователю:
> «Handoff: `<CURRENT_BRANCH>` → `<BASE_BRANCH>` в `<MAIN_WT>`».

### 1.5. Проверка незавершённых анализов

Если в задаче есть `analyses/NNN-*/meta.json` со state `report-done`, `docx-done`, `shared`, `client-review` или `revising` — это значит анализ не дошёл до одобрения клиентом.

Прочитать `.claude/tmp/current-task.txt`. Если содержит путь `analyses/NNN-*/`, прочитать meta.json. Если state ∈ {report-done, docx-done, shared, client-review, revising}:

> ⚠️ Анализ `analyses/<NNN>-<slug>/` в состоянии `<state>` — не одобрено клиентом.
>
> Точно делаешь /handoff? Варианты:
>   [Y] — да, сдать как есть (клиент потом одобрит / у меня нет связи с ним)
>   [n] — нет, сначала довести до approved (вернуться в скил)
>   [skip] — да, и пропустить эту проверку для остальных задач в worktree

Если N — стоп. Если Y или skip — продолжить как обычно.

Если state == `approved` или `completed` — без warning, продолжать.

### 2. Финальный коммит (auto)
```

## 2.7. Новый файл: `.claude/skills/share-analysis/SKILL.md`

Создать по образцу `share-strategy/SKILL.md`.

```markdown
---
name: share-analysis
description: Повторная или отложенная загрузка A2_<slug>.docx из analyses/NNN/ на Google Drive (с автоконверсией в Google Doc). По умолчанию `/seo-analysis` сам делает это в шаге 8 — этот скил нужен если шаг был пропущен (Drive недоступен) или после ручных правок локального .docx. Аргументы: <NNN> [--redo].
---

# share-analysis

Утилита-помощник для скила `/seo-analysis`. **Основной поток `/seo-analysis` загружает результат в Drive сам** (шаг 8). Этот скил пригодится в трёх сценариях:

1. **Drive был недоступен** при первом прогоне `/seo-analysis` — анализ остался в `state: docx-done` без `share.json`. Запускаешь `/share-analysis <NNN>` после восстановления MCP.
2. **Поправил локальный .docx** вручную — нужно перезалить новую версию: `/share-analysis <NNN> --redo`.
3. **Legacy-анализы** (собраны до версии этого скила) — догрузить ссылки задним числом: `/share-analysis <NNN>`.

## Аргументы

```
/share-analysis <NNN> [--redo]
```

- `NNN` - номер анализа (например `001`). Обязательный позиционный.
- `--redo` - пересоздать ссылку: удалить старый файл в Drive (по `drive_file_id` из существующего `share.json`), загрузить заново. Использовать после правок локального .docx.

## Предусловия

- MCP `gdrive-piotr` подключён, OAuth пройден.
- В `<analysis_dir>` существует **готовый** артефакт: `A2_<slug>.docx`.
- `~/.claude/seo-knowledge/DRIVE.md` содержит `analyses_folder_id`.

## Алгоритм

### 0. Parse args

```
NNN = <обязательно>
redo = true если --redo
```

### 1. Найти папку анализа и проверить готовность

`analysis_dir = analyses/<NNN>-*/` - найти существующую по NNN. Если не найдено - стоп.

Прочитать:
- `<analysis_dir>/meta.json` - убедиться, что `state >= docx-done`. Если нет - стоп с подсказкой `/seo-analysis --resume`.
- `<analysis_dir>/brief.json` - получить `slug`, `domain`.

Локальный путь: `docx_path = <analysis_dir>/A2_<slug>.docx`. Если нет - стоп.

### 2. Развилка по share.json

**Случай A:** `share.json` не существует, `--redo` НЕ передан. Грузим как новый. → шаг 3.

**Случай B:** `share.json` существует, `--redo` НЕ передан. Вывести ссылку, остановиться: «Анализ уже расшарен (<shared_at>). Передай `--redo` для перезаливки.»

**Случай C:** `--redo` передан. Прочитать `share.json`, получить `drive_file_id`. Удалить через `mcp__gdrive-piotr__deleteItem`. Если упало — предупредить, продолжать. → шаг 3.

### 3. Прочитать DRIVE.md

`~/.claude/seo-knowledge/DRIVE.md` → `analyses_folder_id`. Если нет — стоп.

### 4. Загрузить

```
mcp__gdrive-piotr__uploadFile(
  localPath: <абсолютный docx_path>,
  name: A2_<slug>,
  parentFolderId: <analyses_folder_id>,
  convertToGoogleFormat: true
)
```

Если упало — fallback `convertToGoogleFormat: false`.

### 5. Записать share.json

```json
{
  "drive_file_id": "<id>",
  "drive_link": "<link>",
  "mime_type": "application/vnd.google-apps.document",
  "shared_at": "<ISO>",
  "revisions": []
}
```

Если `--redo` — добавить запись в `revisions[]`:
```json
{
  "type": "manual_redo",
  "applied_at": "<ISO>",
  "new_drive_file_id": "<new_id>",
  "new_drive_link": "<new_link>"
}
```

### 6. Обновить meta.json

Аналогично `/share-strategy` — учесть идемпотентность для state `completed` (не вызывать update-meta если state==completed, иначе регрессирует). В остальных случаях:

- `state == "docx-done"` → `shared`
- `state == "shared"` → не трогать
- `state == "client-review"` / `revising` / `approved` / `completed` → не трогать state, обновить только `drive_file_id` и `drive_link` через Edit

### 7. Вывод

```
═══ АНАЛИЗ РАСШАРЕН ═══

Клиент: <domain или slug>

📄 A2 (Google Doc для клиента):
   <view_link>

Локальный оригинал:
   <docx_path>
═══════════════════════
```

## Запреты

- НЕ грузить файлы вне папки `analyses_folder_id` из DRIVE.md.
- НЕ оставлять `convertToGoogleFormat: false` без fallback-сообщения «активируй Docs API».
- НЕ вызывать `addPermission` — известный баг пакета на `type: anyone`, разрешения наследуются от папки.
- Длинное тире (—) и среднее (–) не использовать. Только дефис (-).
```

---

# ВОЛНА 3 — UX-улучшения

Завершающие штрихи. Не блокирующие — можно отложить.

## 3.1. (уже в волне 1) Executive Summary

**Note:** В Roadmap я перенёс Executive Summary в волну 2 (файл 2.4), потому что он логически часть Drive-цикла (клиент видит сводку на первой странице .docx). Если делаешь волну 3 отдельно от 2 — пункты 2.4 и 2.5 можно перенести сюда.

## 3.2. (уже в волне 2) stop_list_detailed.json

**Note:** Аналогично — `stop_list_detailed.json` в файле 2.3. Если волны разделяются — перенести сюда.

## 3.3. Проверить шум маркеров expected-*

Это проверка по результатам прогона:
1. Запустить `/seo-analysis` на тестовом проекте после волн 1 и 2.
2. Посмотреть, видны ли в чате упоминания `.claude/tmp/expected-*-<run_id>.txt`.
3. Если видны — найти место, где они появляются (вероятно, в hook'е `.claude/hooks/check-file.sh` или аналогичном), убрать логирование.
4. Если не видны — закрыть пункт, ничего не делать.

## 3.4. (опц.) Hover-видимость свежей правки в client-review

Когда пользователь видит сводку «вот A2, давай фидбек» — было бы здорово показать, что именно меняется при revising. Не блокирующее: реализовать после первого реального прогона цикла client-review → revising.

---

# Финальная проверка

После всех волн:

- [ ] Прогнать `/seo-analysis` на следующем реальном проекте (любой клиент с реальным сайтом).
- [ ] Проверить, что `brief.client_pages` непуст и содержит главные посадочные.
- [ ] Проверить, что `.docx` называется `A2_<slug>.docx` (ASCII-only).
- [ ] Проверить, что Drive-ссылка получена и работает без логина.
- [ ] Прогнать цикл: сказать «есть правка: <что-то>» → проверить, что классификация сработала → одобрить → проверить state `approved` → сделать `/handoff` (без warning).
- [ ] Прогнать с `--no-share` → проверить, что после `report-done` сразу финал.

После успешной проверки — удалить этот файл из `.claude/handoff-requests/processed/` (или оставить как audit trail).
