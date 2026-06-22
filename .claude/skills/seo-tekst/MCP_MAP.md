# MCP-карта /seo-tekst

Какие MCP-инструменты на каком шаге. Все подключены глобально (Claude Code Desktop).

| Шаг / агент | Инструмент | Зачем | Обязательность |
|---|---|---|---|
| 2b `leader-block-scanner` | `mcp__Claude_in_Chrome__*` (navigate/read_page/snapshot/screenshot) | скан rendered-композиции блоков 3-6 лидеров по типам страниц + фишки (особенно каталоги/SPA) | желательно (Chrome) |
| 2b `leader-block-scanner` | `seo_fetch_page` (profile="content") | fallback, если Chrome не подключён (текст+заголовки для композиции блоков/фишек; статический фетч, JS не рендерит) | fallback |
| 2c `direction-scanner` | `arsenkin_top` (queries, region, depth=10, is_snippet) | топ-10 по маркеру направления (+ регион) | желательно |
| 2c `direction-scanner` | `mcp__Claude_in_Chrome__*` / `seo_fetch_batch` (urls, profile="content") | фетч 3-5 страниц однотипных конкурентов (rendered / статический fallback); в mode B + своя живая страница (own_page) | желательно |
| 3 `audience-analyst` | `web_search`, `seo_fetch_page` (profile="content") | (опц.) форум-майнинг дословных формулировок болей/возражений, если нет analysis_dir | опционально |
| 4 `offer-strategist` | `jm_wordstat` (mode=frequency); альт. `wk_check_frequency`, `arsenkin_wordstat` (mode=frequency) | сигнал стадии прогретости (поиск по продукту vs по проблеме) | желательно |
| 4 `offer-strategist` | `seo_fetch_page` (profile="content") | факты о компании с сайта клиента -> 30 тезисов | опционально |
| 4 `offer-strategist` | `wk_check_frequency` | частотность маркеров оффера (массово) | опционально |
| 6a `block-planner` | - (без MCP) | блок-план всех страниц из BLOCKS.md + leader_blocks.json + recon/*.json (только Read/Write) | - |
| 6b `page-writer` (mode B) | `seo_fetch_page` (profile="content") | удачные формулировки/фактура живой страницы (структура и объёмы - по blueprint) | только mode B |
| 6d `site-reviewer` | - (без MCP) | кросс-страничный аудит всех page.json (только Read/Write/Edit) | - |
| 5/7 Drive | `mcp__gdrive-piotr__uploadFile` | docx -> Google Doc (Analysis + Texts) на согласование/выдачу | желательно (скип если нет texts_folder_id) |

**Нет тяжёлых обязательных MCP.** Конкурентов/SERP/семантику не пере-собираем - ингестируем из `analyses/NNN` + `structures/NNN` (источник через `--from-structure`/`--from-analysis`). `prototype-builder` и `prototype-fixer` MCP не используют (только Read/Write/Edit/Bash - запуск скриптов сборки).

## Замечания по MCP
- **Keyso (если page-writer/offer-strategist лезут за страницами конкурентов):** IDN-домены в кириллице, не Punycode; `base` обязателен (`msk` по умолчанию).
- **Регион частотности** - код Яндекса (Москва 213, СПб 2, ...), не Keyso-base. Без него - общероссийская частотность. (Дерево регионов Wordstat живым инструментом не отдаётся; берём код из зашитого списка / дефолт 213.)
- **JM в /seo-tekst - только лёгкий `jm_wordstat`** (сигнал стадии прогретости у offer-strategist); тяжёлый `jm_text_analyze` тут не зовём (он в /seo-faq - нормализация N-грамм), отдельно баланс под него проверять не нужно. Если частотность через JM недоступна - fallback на `wk_check_frequency` / `arsenkin_wordstat` (mode=frequency).
