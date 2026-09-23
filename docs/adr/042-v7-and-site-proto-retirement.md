# ADR-042: Вывод из эксплуатации v7-анализа, v7-текстов и слоя письма v8

**Статус:** Принято

**Дата:** 2026-09-23

## Контекст

После ADR-041 у конвейера один вход (`/site-analiz`) и один текстовый скил (`/site-tekst`).
Старые скилы делают ту же работу по другим контрактам: `/seo-analiz` пишет `analyses/`, которых
структура больше не читает, `/seo-tekst` и `/site proto` - два других слоя письма. Держать их
рядом значит держать два источника правды, двойную машинерию тестов и агентов, которые читают
папки, не создаваемые новыми задачами.

Основание - карта удаления гейта 0 (`test-text-template/docs/gate0-2026-09-23/gate0-deletion-map.md`,
вне репозитория): кто что читает, какие тесты краснеют, порядок шагов без красных промежуточных
коммитов.

## Решение

### 1. Что выведено

| Что | Скилы | Агенты | Скрипты | Тесты |
|---|---|---|---|---|
| Слой письма и режим магазина v8 | `site-proto` | `catalog-architect`, `leader-mapper`, `site-author`, `site-editor`, `site-judge`, `site-strengthener` | 13 в `scripts/site/`: `assemble`, `build-catalog-tz`, `build-tasks`, `catalog`, `lift`, `map-blocks`, `pages`, `plan`, `recon`, `render-products`, `verify-build`, `verify-catalog`, `verify-page` | `proto`, `catalog` |
| Тексты v7 | `seo-tekst` (с kit v7), `seo-tekst-fix`, `share-tekst` | `offer-strategist`, `page-writer`, `block-planner`, `slot-mapper`, `copy-auditor`, `site-reviewer`, `tekst-verifier`, `prototype-builder`, `prototype-fixer` | `read-tekst-input`, `build-skeletons-docx`, `build-prototype`, `assemble-prototype`, `verify-prototype`, `verify-prototype-mobile`, `verify-copy`, `build-handoff` (и npm-скрипт в `package.json`), `share-record` | `seo-tekst`, `kit-mobile`, шаги `style` |
| Анализ v7 | `seo-analiz`, `share-analysis` | `intake-analyst`, `brief-structurer`, `audience-analyst`, `competitor-finder`, `leader-scanner`, `direction-scanner`, `serp-verdict`, `analysis-writer`, `analysis-verifier`, `answer-extractor` | `_questions`, `apply-answers` (v7; `scripts/site/apply-answers.mjs` остается), `build-analysis-docx`, `validate-analysis-inputs` (заменен `validate-project-input.mjs`) | `seo-analiz` |

Плюс `docs/v8/contracts-proto.md` и `contracts-catalog.md` - форматы удаленных скриптов.
Документы-история (`docs/v8/README.md`, программы и отчеты в `docs/`) не удаляются.

### 2. Куда переехало то, что нужно живым

| Что | Было | Стало | Кто читает |
|---|---|---|---|
| Словарь блоков анализа `pages.yml` | `skills/site-proto/` | `skills/site-analiz/` | скрипты анализа, `site-intake`, `site-market` |
| `VOICE.md`, `BLOCKS-METRICS.md` | kit `skills/seo-tekst/assets/` | `skills/seo-faq/assets/` | `faq-builder` (блок 33 FAQ, стоп-лист кнопок, чистота, честность с фактами) |
| Планировщик страниц `pages-planner` | агент `/seo-tekst` | агент `/site-analiz`, шаг 3b | вход `project.json`, выход `sites/NNN/structure_data.json` |
| SEO-замер (`competitor-finder` путь seo, `serp-verdict`) | `/seo-analiz` | агент `seo-base`, шаг 1d `/seo-struktura` | структура |
| Таблица 20 баз Keyso | `brief-structurer.md` | `validate-project-input.mjs` | структура, техаудит |
| Регресс валидатора входа структуры | `tests/seo-analiz`, блоки 4-5 | `tests/seo-structure` | - |
| Регион и база Keyso техаудита | `analyses/NNN/brief.json` | `sites/NNN/project.json` (старые `analyses/` - как раньше) | `/seo-tehaudit --from-analysis`, `audit-recon` |

Общие ассеты кладутся только внутрь `skills/<живой скил>/`: `sync-from-template.mjs` синкает
лишь `.claude/{scripts, agents, skills, hooks, git-hooks, migrations, tests}`, новая папка вроде
`.claude/shared/` к клиентам не уехала бы.

### 3. Режима доделки старых задач нет

Синк машинерии - точное зеркало (ADR-019): следующий `/sync-from-template` удалит у клиента
выведенные скилы, агентов и скрипты. Поэтому **проекты с незавершенными задачами v7 не
синкаются, пока задачи не закрыты или не отменены.** На 2026-09-23:

| Проект | Тексты v7 | Анализ v7 |
|---|---|---|
| `timur_seo_ru` | `texts/002` | `analyses/002` |
| `bigsnake_ru` | `texts/001` | `analyses/001` |
| `holz_house_spb_ru` | `texts/001` | - |
| `save_v2` | `texts/001` | - |
| `avtokon_ru` | `texts/001` | - |
| `magazin_kvartir` | - | `analyses/001` |

Закрыть задачу - довести ее старым скилом в клоне (там машинерия v7 до синка) либо отменить
решением владельца; после этого проект синкается как все. `sync-all --no-delete` не выход: он
оставит и мусор. Готовые папки `analyses/` и `texts/` после синка остаются данными клиента:
`/seo-faq --from-tekst` и `/seo-tehaudit --from-analysis` их понимают, `/seo-struktura` - нет
(ее вход только `sites/`), новая работа по такому клиенту начинается с `/site-analiz`.

### 4. ADR не удаляются

Файлы ADR остаются (на них ссылаются документы, набор `machinery` проверяет висячие ссылки).
Меняется статус: «Заменено (см. ADR-041/042)» - у решений, чья машинерия удалена целиком;
«Частично заменено» - где живая часть осталась (Р/Д/К/В в `pages.yml`, словарь проекта в
`faq-builder`, стоп-лист кнопок F3 в `VOICE.md`); врезка без смены статуса - где меняется
только вход или список агентов. Таблица - `docs/adr/README.md`.

## Альтернативы

- **Оставить v7 рядом в режиме доделки.** Отвергнуто: два источника правды, двойная машинерия
  тестов; агенты v7 читали бы `analyses/`, которых новые задачи не создают, а подсказки старых
  скилов вели бы в команды, которых нет.
- **Синк с `--no-delete`.** Отвергнуто: у клиента остался бы мусор без тестов и без владельца.
- **Держать kit `seo-tekst` целиком ради FAQ.** Отвергнуто: живой читатель один - `faq-builder`,
  и ему нужны два файла из сорока.
- **Удалить ADR выведенных решений.** Отвергнуто: ADR - это «почему так», история решений
  нужна и после вывода машинерии; висячие ссылки валят набор `machinery`.

## Последствия

**Счетчики шаблона** (до - гейт 0 на `77a78d2`, после - ветка `algo-v9` после вывода):

| | До | После |
|---|---|---|
| Скилы | 30 | 25 (минус 6, плюс `site-tekst`) |
| Агенты | 69 | 45 (минус 25, плюс `seo-base`, `pages-planner` остался за анализом) |
| Скрипты `.claude/scripts` (.mjs) | 60 | 48 |
| Скрипты `.claude/scripts/site` | 19 | 6 |
| Наборы тестов | 17 | 13 (минус 5, плюс `site-tekst`) |
| ADR | 40 | 43 |

**Клиенты:** синк - только по отдельному «да» владельца и с исключениями из раздела 3.
`docs/` и `CLAUDE.md` клиентам не синкаются: в клиентском клоне `docs/MODEL-POLICY.md`
останется старым, и набор `machinery` там покраснеет, а `CLAUDE.md` клиента будет называть
выведенные команды до ручной правки - известное свойство синка, чинится отдельно.

**Вне шаблона:** родительская машинерия `~/seo-projects/.claude` (подсказка `/seo-tekst
--from-brief` в `new-project`, описание v7 в родительском `guide`, счет папок `analyses` в
`project-status.mjs`) синком не трогается и правится отдельной задачей.

## Ссылки

- [ADR-041](041-v9-site-analiz-single-entry-and-site-tekst.md) - новый конвейер и v8 задним числом.
- [ADR-019](019-machinery-sync.md) - синк как точное зеркало.
- [ADR-038](038-tiered-analysis-and-writing-split.md) - предыдущее разделение «анализ / письмо»
  (его прецедент: старые задачи довершались старым скилом до синка).
- Коммиты ветки `algo-v9`: шаг 1 - site-proto, шаг 2 - seo-tekst, шаг 3 - seo-analiz.
