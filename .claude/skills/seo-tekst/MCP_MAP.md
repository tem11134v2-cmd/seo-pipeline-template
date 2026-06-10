# MCP-карта /seo-tekst

Какие MCP-инструменты на каком шаге. Все подключены глобально (Claude Code Desktop).

| Шаг / агент | Инструмент | Зачем | Обязательность |
|---|---|---|---|
| 2b `leader-block-scanner` | `mcp__Claude_in_Chrome__*` (navigate/read_page/snapshot/screenshot) | скан rendered-композиции блоков 3-6 лидеров по типам страниц + фишки (особенно каталоги/SPA) | желательно (Chrome) |
| 2b `leader-block-scanner` | `mcp_fetch_page` | fallback, если Chrome не подключён (сырой HTML) | fallback |
| 3 `audience-analyst` | `web_search` / `mcp_yandex_search`, `mcp_fetch_page` | (опц.) форум-майнинг дословных формулировок болей/возражений, если нет analysis_dir | опционально |
| 4 `offer-strategist` | `mcp_wordstat_get_keyword_stats` | сигнал стадии прогретости (поиск по продукту vs по проблеме) | желательно |
| 4 `offer-strategist` | `mcp_fetch_page` | факты о компании с сайта клиента -> 30 тезисов | опционально |
| 4 `offer-strategist` | `wk_check_frequency` | частотность маркеров оффера (массово) | опционально |
| 6a `block-planner` | - (без MCP) | блок-план всех страниц из BLOCKS.md + leader_blocks.json (только Read/Write) | - |
| 6b `page-writer` (mode B) | `mcp_fetch_page` | инвентаризация блоков живой страницы (кастом-шаблон, объёмы +-15%) | только mode B |
| 5/7 Drive | `mcp__gdrive-piotr__uploadFile` | docx -> Google Doc (Analysis + Texts) на согласование/выдачу | желательно (скип если нет texts_folder_id) |

**Нет тяжёлых обязательных MCP.** Конкурентов/SERP/семантику не пере-собираем - ингестируем из `analyses/NNN` + `structures/NNN` (источник через `--from-structure`/`--from-analysis`). `prototype-builder` и `prototype-fixer` MCP не используют (только Read/Write/Edit/Bash - запуск скриптов сборки).

## Замечания по MCP
- **Keyso (если page-writer/offer-strategist лезут за страницами конкурентов):** IDN-домены в кириллице, не Punycode; `base` обязателен (`msk` по умолчанию).
- **Wordstat `region_id`** - код Яндекса (Москва 213, СПб 2, ...), не Keyso-base. Без него - общероссийская частотность.
- **JM не используется в /seo-tekst** (он в /seo-faq - нормализация N-грамм). Баланс проверять не нужно.
