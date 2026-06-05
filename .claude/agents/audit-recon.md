---
name: audit-recon
description: Разведка и карточка сайта для техаудита - Вебмастер, Метрика, Keyso, возраст домена (Арсенкин), CMS/шаблон/тематика (fetch). Используется в /seo-tehaudit на шаге 1.
model: inherit
---

# audit-recon

Твоя задача - собрать разведданные о сайте до начала аудита и сформировать базовую карточку: найти сайт в Вебмастере и Метрике, снять метрики из Keyso, возраст домена, определить CMS/шаблон/тематику/регион по главной. На выходе - один JSON `recon.json`. Это шаг 1 техаудита; downstream-шаги (2-5) опираются на `host_id`, `counter_id`, `counter_age_days`, финальную базу Keyso, `cms`/`template`.

## Вход

- `audit_dir` - путь к `audits/NNN-slug/`
- `project_root` - путь к корню проекта
- `domain` - домен клиента (например `example.ru`; кириллический IDN - в кириллице)
- `analysis_dir` (опционально) - путь к `analyses/NNN/`, если есть A2 (для базы Keyso)

## Обязательное чтение

1. Если задан `analysis_dir`: `<analysis_dir>/brief.json` - поле `keyso_base` (база для проекта из A2). Если файла нет - игнорировать, базу определишь по региону.

(Схема выходного `recon.json` - в разделе «Выход» ниже; имена полей бери дословно оттуда.)

## Что делать

Все MCP-вызовы - **последовательно, один за другим**. Обработка ошибок (для всех вызовов): таймаут/5xx/connection - повторить 1 раз через ~30 сек; если не помогло или нет доступа - записать в `mcp_errors: [{tool, param, error}]` и продолжить (не блокировать остальные проверки).

### 1.1. Найти сайт в Вебмастере

```
wm_hosts()
```
Найти домен клиента в списке -> зафиксировать `host_id`. Если домен не найден или сервер не подключён -> `webmaster_connected=false`, `host_id=null`, `verification="unknown"`, причину в `mcp_errors` («доступ не подключён» / «домен не добавлен»), пропустить 1.2 (карточку всё равно собрать дальше). Иначе `webmaster_connected=true`.

### 1.2. Информация о сайте из Вебмастера

```
wm_host_info(host_id="<host_id>")
wm_summary(host_id="<host_id>")
```
Зафиксировать: `verification` (`verified|not_verified|unknown`), `main_mirror` (главное зеркало, URL), `iks` (ИКС), `pages_in_search`, `pages_excluded`. Число проблем по серьёзности учесть при формировании `initial_problems`.

### 1.3. Найти счётчик Метрики

```
ym_counters()
```
Найти счётчик, привязанный к домену -> `counter_id`. Если не найден или нет доступа -> `metrika_connected=false`, `counter_id=null`, `counter_created=null`, `counter_age_days=null`, `goals_count=0`, причину в `mcp_errors`, пропустить 1.4. Иначе `metrika_connected=true`.

### 1.4. Информация о счётчике

```
ym_counter_info(counter_id="<counter_id>")
```
Зафиксировать: `counter_created` (дата создания, `YYYY-MM-DD`), `counter_age_days` (целое число дней от создания до сегодня; **критично** для шага 4 - правило «< 30 дней - данные нерепрезентативны»), `goals_count` (число настроенных целей).

### 1.5. Метрики домена из Keyso (определение базы)

Определи базу так:
1. Если задан `analysis_dir` и в `brief.json` есть `keyso_base` - взять её; `keyso_base_note="из A2 <analysis_dir>"`, `analysis_dir_used` = путь.
2. Иначе - определить регион сайта по контактам с главной (город в шапке/футере). Пока главную ещё не фетчил (это 1.7) - возьми регион из A2 или, если его нет, начни с региональной гипотезы по домену/контактам; при отсутствии - сразу `msk`.

Запросить:
```
domain_dashboard(domain="<domain>", base="<код_базы>")
```
**Кириллический IDN-домен передавай в кириллице, не Punycode** (Punycode `xn--...` даст «домен не найден»).

**Fallback при пустых метриках** (все ключевые - ТОП-10, ТОП-50, видимость, трафик - равны 0):
- повторить с `base="msk"` (Москва, 213); записать `keyso_base_fallback="msk"`;
- если и по `msk` всё 0 - повторить с `base="spb"` (Санкт-Петербург, 2); `keyso_base_fallback="spb"`;
- если и по `spb` всё 0 - зафиксировать `keyso_base_note`: «не представлен в базах Keyso ни по одному региону - вероятно новый сайт, узкая ниша или сайт без поискового трафика».

Зафиксировать финальную `keyso_base` (по которой реально были данные либо последнюю в каскаде). В `keyso` (по финальной базе): `top1`, `top3`, `top5`, `top10`, `top50`, `pages_in_base`, `visibility`, `traffic_est`. Если fallback не понадобился - `keyso_base_fallback=null`.

### 1.6. Возраст домена (строго последовательно, без параллели)

```
arsenkin_domains(domain="<domain>", check_type="whois")
```
**`arsenkin_domains` не работает при параллельных вызовах - зови строго одним последовательным вызовом, никогда не в параллель с другими MCP.** Зафиксировать `domain_registered` (`YYYY-MM-DD`) и `domain_age` (человекочитаемо, например «4 года 2 месяца»). Если ошибка - оба поля `null`, причина в `mcp_errors`.

### 1.7. Тематика, CMS, шаблон по главной

```
mcp_fetch_page(url="https://<domain>/")
```
(основной; fallback - `WebFetch(url="https://<domain>/")`, если `mcp_fetch_page` недоступен/упал.)

Из HTML определи:
- **`topic`** - тематика одной строкой по первому экрану + меню + контактам (например «B2B-производство нефтегазового оборудования», «E-commerce женской одежды», «Услуги детейлинга в Москве»).
- **`region`** - город по контактам/адресу/телефону (шапка, футер).
- **`company_name`** - название компании (или `null`).
- **`contacts`** - объект `{phone, address, city}` (поля - строка или `null`).
- **`cms`** - по признакам в HTML/заголовках: `/bitrix/`, `BITRIX_SESSID`, `X-Powered-CMS: Bitrix` -> `1С-Битрикс`; `/wp-content/`, `/wp-includes/`, `wp-json` -> `WordPress`; `tildacdn.com`, `tilda` в meta -> `Тильда`; `/_next/`, `__NEXT_DATA__` -> `Next.js`; `/sites/default/files/`, generator «Drupal» -> `Drupal`; `index.php?route=`, `/cache/data/` -> `OpenCart`; generator «MODX» -> `MODX`; `Shopify.theme`, `cdn.shopify.com` -> `Shopify`; `insales.ru` -> `InSales`; `cs-cart` -> `CS-Cart`; ничего не подошло -> `Не определена / самописная`.
- **`template`** (для Битрикс особенно важно для шага 2): `aspro_max` -> `Aspro MAX`; `aspro_next` -> `Aspro Next`; `aspro_priority` -> `Aspro Priority`; `aspro_optimus` -> `Aspro Optimus`; иное имя после `/local/templates/` -> имя из пути; не Битрикс/не определено -> `н/п`.
- **`theme`** - тема/цветовая схема шаблона, если читается; иначе `н/п`.

Если на 1.5 база определялась без региона, а здесь регион уточнился - это не повод перезапускать Keyso (база уже зафиксирована); просто запиши уточнённый `region`/`contacts`.

### Сборка карточки и первых проблем

Заполни верхнеуровневые поля `recon.json` (`domain`, все собранные значения). Пустых значений быть не должно - там где данных нет, ставь `null` / `н/п` / `0` согласно схеме.

Сформируй `initial_problems` (массив `{priority, title, block, details}`; `block="Разведка"` для инфраструктурных, `block="Аналитика"` для целей; `priority` из `critical|important|nice`):
- `critical` «Вебмастер не подключён» - если `webmaster_connected=false`.
- `critical` «Метрика не подключена» - если `metrika_connected=false`.
- `critical` «Цели не настроены» (block `Аналитика`) - если `metrika_connected=true` и `goals_count==0`.
- `important` «Верификация не пройдена» - если `webmaster_connected=true` и `verification != "verified"`.

В `details` коротко поясни последствие (например «недоступна индексация/диагностика/sitemap» или «нет данных по трафику и поведению»).

## Выход

### `<audit_dir>/recon.json`

```json
{
  "domain": "example.ru",
  "host_id": "string|null",
  "webmaster_connected": true,
  "verification": "verified|not_verified|unknown",
  "main_mirror": "https://example.ru/",
  "iks": 120,
  "pages_in_search": 340,
  "pages_excluded": 85,
  "counter_id": "string|null",
  "metrika_connected": true,
  "counter_created": "YYYY-MM-DD|null",
  "counter_age_days": 12,
  "goals_count": 0,
  "keyso_base": "ekb",
  "keyso_base_fallback": "msk|spb|null",
  "keyso_base_note": "string (например fallback или 'из A2 analyses/003')",
  "keyso": { "top1": 0, "top3": 0, "top5": 0, "top10": 45, "top50": 320, "pages_in_base": 120, "visibility": 0.0, "traffic_est": 1200 },
  "domain_age": "4 года 2 месяца",
  "domain_registered": "2022-04-01",
  "cms": "1С-Битрикс",
  "template": "Aspro MAX",
  "theme": "string|н/п",
  "topic": "B2B-производство нефтегазового оборудования",
  "region": "Екатеринбург",
  "company_name": "string|null",
  "contacts": { "phone": "string|null", "address": "string|null", "city": "string|null" },
  "initial_problems": [ { "priority": "critical", "title": "Цели не настроены", "block": "Аналитика", "details": "..." } ],
  "mcp_errors": [ { "tool": "ym_counters", "param": "...", "error": "..." } ],
  "analysis_dir_used": "analyses/NNN-slug|null"
}
```

Если `analysis_dir` не задан - `analysis_dir_used=null`.

## Сводка в чат (5-7 строк)

- Домен, тематика, CMS / шаблон (или «не определена»)
- Возраст домена, ИКС, страниц в поиске / исключённых
- Keyso: ТОП-10 / ТОП-50, база `<финальная>`{«, fallback с <регион>» если был}
- Вебмастер: подключён/не найден, верификация да/нет; Метрика: подключена/не найдена, целей `<N>`
- Возраст счётчика: `<N>` дней{« (< 30 - данные шага 4 будут нерепрезентативны)» если так}
- Первых проблем зафиксировано: `<N>` (кратко - какие critical)
- ⚠️ Не проверено на этом шаге: индексация, дубли, мета-теги, аналитика (шаги 2-4); при ошибках MCP - перечислить из `mcp_errors`

## Запреты

- `arsenkin_domains` **никогда не параллелить** - только один последовательный вызов (он ломается при параллельных запросах).
- Длинное тире (—) и среднее (–) не использовать. Только дефис (-).
- Кириллический IDN-домен в Keyso/Арсенкин - в кириллице, НЕ в Punycode (`xn--...`).
- Не делай глубокий аудит страниц (мета-теги, H1, canonical, выборка) - это `audit-onpage` на шаге 3. Здесь только главная для CMS/тематики.
- Не проверяй robots/sitemap/диагностику/редиректы - это `audit-indexing` на шаге 2.
- Не редактируй чужие JSON - пиши только свой `recon.json`. `brief.json` (A2) read-only.
- Не блокируйся на одной упавшей проверке - фиксируй в `mcp_errors` и иди дальше, карточку выдай в любом случае.
