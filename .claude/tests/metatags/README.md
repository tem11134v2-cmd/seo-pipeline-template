# Smoke-тесты `/seo-metategi`

Регрессионные тесты для четырёх скриптов скила:
- `read-metatags-input.mjs` - вход из структуры / таблицы / аудита (+ edge: все «нет» -> exit 2)
- `select-variations.mjs` - отсев Comm + сорт + all-low фолбэк + info passthrough + топоним
- `build-metatags-xlsx.mjs` - сборка A7.xlsx (3 листа, подсветка длины, заглушка для missing)
- `verify-metatags.mjs` - проверка пачки (нарушения/missing -> exit 2, чисто -> exit 0)

## Что проверяют (16 тестов)

| # | Тест | Что валидируется |
|---|---|---|
| 1 | read-input --from-structure | exit 0, 2 страницы (пропуск «нет»), queries из top10 |
| 2 | read-input --from-table | exit 0, 2 страницы, маркер с is_marker |
| 3 | read-input --from-audit | exit 0, только `selected` страницы, reason -> client_notes |
| 4 | read-input empty (все «нет») | exit 2 |
| 5 | select-variations runs | exit 0, shortlist.json создан |
| 6 | select-variations low-Comm drop | форма Comm<порог отсеяна, не утекла в shortlist |
| 7 | select-variations all-low fallback | страница без проходных форм - взята лучшая + флаг |
| 8 | select-variations info passthrough | info-страница помечена non_commercial, без топонима |
| 9 | build-metatags-xlsx runs | A7_test.xlsx создан |
| 10 | A7 структура | 3 листа (Метатеги/Аналитика/Сводка), подсветка Title>60 (FFF8CBAD) |
| 11 | verify violations + missing | exit 2, ловит missing page + Title>60 |
| 12 | verify clean | exit 0 на корректной странице |
| 13 | verify forbidden phrasing | exit 2, ловит запрещённую формулировку из inputs |
| 14 | build-xlsx на чистой полной пачке | A7_final.xlsx создан (пред-условие финального verify) |
| 15 | финальный verify после xlsx (--accept-degraded) | exit 0 на готовом артефакте (контракт шага 7.5а) |
| 16 | --accept-degraded + свежая деградация | mcp_degraded не блокирует, exit 0 |

## Как запустить

Из корня проекта:
```
.claude\scripts\_node.cmd .claude\tests\metatags\run.mjs
```
Exit 0 = всё ок. Exit 1 = хоть один тест упал (вывод покажет где).

Фикстуры генерируются прямо в `run.mjs` (в песочнице `.claude/tmp/metatags-test`), внешних файлов нет - в отличие от tests/seo-structure (там fixtures/ на диске), здесь они синтезируются inline, т.к. компактны.

## Когда запускать

- После правок в `read-metatags-input.mjs`, `select-variations.mjs`, `build-metatags-xlsx.mjs`, `verify-metatags.mjs`.
- Перед PR / push.
- При обновлении `exceljs`.

## Что НЕ покрыто (требует живых MCP, тестируется вручную)

- Агенты `site-scanner`, `metatag-researcher`, `metatag-writer` (зовут MCP: fetch, wk_check_frequency, arsenkin_*, jm_*).
- Реальная заливка в Drive (`/share-metatags`).
- Авто-хвост из `/seo-struktura --metatags` (end-to-end с реальной структурой).
