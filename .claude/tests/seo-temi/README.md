# Smoke-тесты `/seo-temi`

Регрессионные тесты для флага `--main-only` в `read-topics-xlsx.mjs` (контекст-диета
из Этапа 5 - см. `docs/ORCHESTRATION.md`): `/seo-temi` шаг 3 использует компактный дамп
для дедупа вместо полного JSON темника, но `handoff-process` и `/seo-statya` по-прежнему
используют полный режим и `--by-number` - тесты закрепляют, что оба контракта не сломаны.

## Что проверяют (4 кейса + 1 гард)

| # | Тест | Что валидируется |
|---|---|---|
| 1 | `--main-only` на xlsx с темами | exists:true, count:2, main_queries - непустые запросы (пустой отфильтрован) |
| 1a | `--main-only` - нет утечки полей | в ответе нет `topics[]`/`intent`/`genres`/`topics_count` - подтверждение, что это НЕ полный дамп |
| 2 | `--main-only` без `topics.xlsx` | `{exists:false,count:0,main_queries:[]}`, exit 0 |
| 3 | Полный режим (без флага) не сломан | `topics[]` присутствует, все 3 темы (включая с пустым main_query), `topics_count=3`, нет поля `main_queries` - регресс-гард для `handoff-process/SKILL.md` |
| 4 | `--by-number N` + `--main-only` вместе | приоритет у `--by-number` - ответ содержит `found`/`topic`, а не `main_queries` |

## Как запустить

Из корня проекта:
```
.claude\scripts\_node.cmd .claude\tests\seo-temi\run.mjs
```
Exit 0 = все ок. Exit 1 = хоть один тест упал (вывод покажет где).

Фикстура - синтетический `topics.xlsx` (3 темы, у третьей пустой `Основной запрос`),
собирается прямо в `run.mjs` через `exceljs` в песочнице `.claude/tmp/seo-temi-test`
(гитигнорится, как и `.claude/tmp/metatags-test`).

## Когда запускать

- После любых правок в `read-topics-xlsx.mjs`.
- После правок шагов 3/5 `.claude/skills/seo-temi/SKILL.md` (существующие_queries.json,
  дифф-вывод в цикле правок), если они трогают контракт скрипта.
- Перед PR / push.
- При обновлении `exceljs`.

## Что НЕ покрыто (требует живых MCP / модели, тестируется вручную)

- Агент `topic-generator` (зовет wordstat/JM MCP) и `topics-verifier` (opus/sonnet-суждение
  о релевантности нише, полноте полей, дублях по `existing_queries.json`) - живая проверка
  батча тем в контексте, не механический скрипт.
- Реальная заливка в Drive (`/share-topics`).
- Шаг 3 SKILL.md целиком (сборка `existing_queries.json` из двух источников + нормализация) -
  это оркестрация внутри скила, не отдельный скрипт; здесь протестирован только источник 1
  (`read-topics-xlsx.mjs --main-only`).
