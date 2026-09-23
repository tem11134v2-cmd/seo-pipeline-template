# Шаблон пайплайна текстов для сайта

Папка-шаблон не содержит данных проекта. Под проект она копируется целиком
(`node scripts/init-project.mjs <slug> <путь> [--project <project.json>]`), в копии заполняются `config/project.json`
и папка `inputs/` (или импорт из контракта анализа в фазе 0), после чего фазы запускаются по порядку.

В шаблоне SEO-конвейера эта папка - kit скила `/site-tekst` (`.claude/skills/site-tekst/kit/`). Там копию под задачу
кладет `.claude/skills/site-tekst/task.mjs` в `texts/NNN-<slug>/` при каждом старте и возобновлении (копия - кеш, в git не
идет), а данные задачи (`config/project.json`, `inputs/`, `work/`, `rules/decisions.md`, `overrides/`) коммитятся. Порядок
оркестрации - `.claude/skills/site-tekst/SKILL.md`; `init-project.mjs` остается для автономной копии вне шаблона.

Главная цель пайплайна - конверсионные тексты уровня сайтов-лидеров ниши.
SEO-слой в текстах не делается: за него отвечает отдельный второй прогон по опубликованному сайту.

## Состав

`workflows/` - 11 воркфлоу, `prompts/` - 32 промта, `scripts/` - 31 скрипт (из них модули без CLI: `lib`, `lint-common`,
`render-analysis`), `schemas/` - 20 схем, тесты линтера и скриптов - `.claude/tests/site-tekst/` шаблона, `rules/` - ролевые инструкции и правила линтера,
`config/` - профиль проекта и house style, `html/` - примитивы прототипа, `examples/smoke-fixtures/` - дымовые данные.

## Принципы

1. Один агент - одна задача. Писатель пишет один блок одной страницы и получает только срез брифа на свой блок,
   свою ролевую инструкцию и компактное состояние страницы. Он не читает анализ, исходный файл правил и чужие страницы.
2. Факт = значение + статус + источник. Никаких «правил публикации» и оговорок внутри
   паспорта фактов. Цифра в тексте только со ссылкой на id факта. Чего нет в паспорте,
   того нет в тексте: блок пишется продающим без этой цифры.
3. JSON - источник истины между агентами, md и HTML - представления для людей.
4. Все, что проверяется регуляркой или счетчиком, проверяет скрипт до LLM-аудита.
5. Аудитор ищет и не правит. Фиксер правит точечно и усиливает, а не режет.
6. Набор блоков страницы приходит из шаблона ее типа. Писатель блок не выбирает.
7. Пилот на одной странице до тиража. Любой этап возобновляем: состояние только в файлах.

## Фазы и гейты

| Фаза | Что происходит | Кто | Выход |
|---|---|---|---|
| T1 (один раз при сборке шаблона) | Дистилляция файла правил в ролевые инструкции + слепая сверка | `wf-T1-distill-rules.js` | `rules/hero.md`, `conversion.md`, `info.md`, `auditor.md`, `offer-formulas.md`, `lint.json` |
| 0 | `source: doc` - дамп Google Doc, паспорт фактов, слепая сверка, снимок контактов, структура. `source: project` - импорт `project.json` анализа скриптом (после гейта анализа), регулярки антиобещаний, снимок только без реквизитов. Затем обогащение карты | `wf-00-facts.js`, `import-project.mjs` | `work/facts.json`, `audience.json`, `sitemap.json`, `inputs/analysis.md`; в режиме `project` еще `client-preferences.json`, `directions.json`, `competitors/seed.json`, `import-report.json` |
| Гейт 1 | Человек утверждает `sitemap.json` и `rules/decisions.md` | оркестратор | - |
| 2 | Верификация конкурентов, фетч со статусами, классификация страниц, замер блоков, пакетный разбор снимков (до 4 снимков домена на вызов), агрегация по типам (мелкие типы пакетом), анализ каталогов | `wf-02-competitors.js` + `prep-args.mjs` | `work/competitors/*`, `work/page-types/<type>.json`, `work/catalog/competitor-catalogs.md` |
| 3 | Аудит файлов типов страниц по снимкам (мелкие типы пакетом), исправление, повторный аудит | `wf-03-audit-types.js` | исправленные `page-types/*.json`, `work/audit/types/*.json` |
| 4 | Глобальный стратег, стратеги типов параллельно (формулы, CTA, матрица дифференциации, факты и возражения по блокам), сборка стратегии и брифов скриптами, HTML-шаблоны по типам параллельно | `wf-04-strategy-layouts.js` + `merge-strategy.mjs`, `build-briefs.mjs` | `work/strategy.pages/<type>.json`, `work/strategy.json`, `work/pages/<slug>/brief.json` и `brief/<block_id>.json`, `work/layouts/<type>.html` |
| 5 | Первый экран: турнир для `home`, `hub`, `service` (3 писателя -> 2 судьи -> селектор, вложенный `wf-05b`), иначе писатель + селектор. Затем блоки по очереди, линтер после каждого | `wf-05-write.js` (args: вывод `plan-run.mjs`) | `work/pages/<slug>/blocks/*.json`, `state.json`, `state.writer.json`, `page.md` |
| Гейт 2 | После пилота (главная + одна категория) человек правит правила, лимиты, шаблоны | оркестратор | - |
| 6 | Судья страницы (сам запускает `lint-page`), один проход фиксера, второй круг судьи по порогу оценок; кросс-судья по парам `dedup` и гео-близнецам; слепой читатель по выборке. `wf-06b` - ручной инструмент | `wf-06-audit.js` | `work/audit/<slug>/round-N.json`, `lint-page.json`, `cross.json`, `blind.json`, `work/audit/cross.json` |
| 7 | Каталог: спецификация, ТЗ разработчику, аудит ТЗ, публикация в Google Doc | `wf-07-catalog.js` | `work/catalog/catalog-spec.json`, `tz.md`, ссылка на Google Doc |
| 8 | Сборка прототипа и отчета скриптами | `build-html.mjs`, `check-html.mjs`, `report.mjs` | `work/output/prototype.html`, `report.md` |
| T2 (после проекта) | Ретро: статистика находок аудита скриптом, предложения правок шаблона | `wf-T2-retro.js` + `retro-stats.mjs` | `work/audit/retro-stats.json`, `work/output/retro.md`, `retro.json` |

Порядок запуска и точные `args` - `docs/RUNBOOK.md`.

## Контракты (схемы в `schemas/`)

- `facts.json` - паспорт фактов, антиобещания, терминология, контакты компании.
- `audience.json` - сегменты ЦА с возражениями (id вида `O1`) и словарем слов клиента.
- `sitemap.json` - карта страниц: slug, url, тип из закрытого списка, предмет, сегмент, покрытие фактами, набор блоков (full/short), статус, волна.
- `page-types/<type>.json` - блоки рынка и блоки отстройки для типа страницы: элементы, объемы по замерам, паттерн раскладки, дословные примеры конкурентов, клише.
- `strategy.pages/<type>.json` - решения стратега типа по страницам; `strategy.json` - глобальные решения и сборка страниц (`merge-strategy.mjs`).
- `pages/<slug>/brief.json` - бриф страницы: сегмент, возражения, факты, CTA, список блоков с ролями, вопросами читателя и лимитами. Его читают линтер, судья и фиксер.
- `pages/<slug>/brief/<block_id>.json` - срез брифа на блок, единственный бриф писателя (`brief-slice`).
- `pages/<slug>/blocks/<block_id>.json` - выход писателя: элементы блока с текстами и ссылками на факты.
- `pages/<slug>/state.json` - состояние страницы для судьи и фиксера, `state.writer.json` - компактное для следующего писателя.
- `audit/**.json` - находки аудиторов и линтера в едином формате `findings`.
- `catalog/catalog-spec.json` - спецификация каталога для ТЗ и для заглушки в прототипе.
- `layouts/<type>.html` - HTML-шаблон блоков типа страницы (без текста, только раскладка и слоты).
- Режим `project`: `client-preferences.json`, `directions.json`, `competitors/seed.json`, `import-report.json`, `anti-promises.patterns.json`.
- `output/retro.json` - предложения ретро по шаблону.

## Типы страниц (закрытый список)

`home`, `hub` (раздел-обзор с навигацией), `category` (листинг каталога или раздел с подборкой),
`service`, `product` (шаблон карточки), `info_about`, `info_contacts`, `info_team`,
`info_reviews`, `info_cases`, `info_faq`, `info_other`.
Статьи и блог в пайплайн не входят.

## Роли блоков

`hero` - первый экран, `conversion` - продающие блоки, `info` - справочные блоки
(контакты, реквизиты, карта, юридическая оговорка). Роль задается в файле типа страницы
и определяет, какую инструкцию из `rules/` читает писатель.

## Скрипты (`scripts/`, Node 18+)

| Скрипт | Назначение |
|---|---|
| `init-project.mjs <slug> <путь> [--check ...] [--project <project.json> [--structure <file>]]` | копия шаблона под проект, проверка отсутствия чужих данных; `--project` - режим `sources.mode: project`; последней строкой печатает `args` воркфлоу (`root`, `model`, `model_light`, с `--project` еще `source`) |
| `sync-from-template.mjs <шаблон>` | обновить в проекте логику из шаблона, не трогая `work/`, `inputs/`, `config/`, `rules/decisions.md` |
| `serve.mjs [--dir --port]` | локальный просмотр прототипа в браузере |
| `validate.mjs <schema> <file>` | проверка JSON по схеме |
| `normalize.mjs <file...>` | буква е с точками -> е, длинные тире -> «-», в текстах и инструкциях |
| `import-project.mjs [--project --facts-src --queue --structure --allow-ungated]` | фаза 0 режима `project`: импорт контракта анализа во входы текстов, только после гейта анализа; `--apply-patterns <file>` - проверка и перенос регулярок антиобещаний |
| `render-analysis.mjs` | модуль `import-project`: `inputs/analysis.md` из контракта с фиксированными заголовками (их грепают промты фаз 2, 3, 7) |
| `import-structure.mjs` | импорт готовой структуры в `sitemap.json` |
| `fetch-page.mjs <url> <out.json>` | снимок страницы: html, текст по секциям заголовков, статус ok / antibot / js_only / closed |
| `measure-blocks.mjs [--if-stale]` | замер символов по секциям всех снимков -> `measurements.csv` |
| `prep-args.mjs [--types a,b] [--snapshots ...]` | `args` фаз 2-4: `types`, `type_pages` (по нему мелкие типы идут пакетом), снимки для `skipInventory` |
| `merge-strategy.mjs [--check <file...>] [--split]` | сборка `strategy.json` из `strategy.pages/<type>.json`; `--check` - проверка файла типа; `--split` - перевод старого проекта |
| `build-briefs.mjs [slug...] [--force]` | сборка брифов страниц и срезов для писателей |
| `writer-inputs.mjs [slug...]` | срезы брифа на блок; модуль `build-briefs`, `page-state`, `plan-run`, CLI - ручная пересборка |
| `lint.mjs <block.json> [--fix]` | линтер блока: house style, стоп-слова, цифры без фактов, CTA, длины, антиобещания, жаргон, формы `ai.*` и `style.*`, бюджеты страницы по блокам выше |
| `lint-page.mjs <slug> [--fix]` | линтер страницы: все блоки, бюджеты страницы (`ai.contrast`, `ai.neg-pitch`, `word.overuse`, плейсхолдеры) в порядке блоков |
| `lint-common.mjs` | модуль: общие проверки `lint` и `lint-page`, правила - `rules/lint.json` |
| `page-state.mjs <slug>` | `state.json` и `state.writer.json` после блока, обновление устаревших срезов брифа |
| `render-md.mjs [slug...]` | md страницы из блоков |
| `renumber-blocks.mjs <slug>` | перенумерация файлов блоков под текущий бриф, выпавшие блоки -> `_old/` |
| `plan-run.mjs [--wave --slugs --types --phase write\|audit --hero --tournament-types --sample-per-type]` | незавершенные страницы и блоки для `args` фаз 5-6, режим первого экрана по типу страницы; в фазе `audit` - `sample` для слепого читателя (первые по карте N страниц каждого типа, по умолчанию 1) |
| `dedup.mjs` | повторы между страницами и внутри страницы, пары-кандидаты и гео-близнецы для кросс-судьи |
| `cross-digest.mjs [--max-pairs 60]` | выжимка для кросс-судьи по парам `dedup` -> `work/audit/cross-digest.json` |
| `split-cross.mjs [--merge]` | находки кросс-судьи по страницам в `work/audit/<slug>/cross.json`; `--merge` - статусы обратно в общий файл |
| `blind-prep.mjs <slug>` | вход слепого читателя: портрет сегмента, первые экраны конкурентов, `work/audit/<slug>/blind-view.md` |
| `validate-layout.mjs <type...>` | проверка HTML-шаблона типа страницы |
| `build-html.mjs` | сборка одного файла прототипа |
| `check-html.mjs` | сверка прототипа с блоками побайтно |
| `report.mjs` | итоговый отчет |
| `retro-stats.mjs` | статистика находок аудита для ретро -> `work/audit/retro-stats.json` |
| `lib.mjs` | модуль: общие функции скриптов |

## Промты (`prompts/`)

Один файл на роль. Каждый промт начинается с блока «Что читать» и «Что не читать»,
заканчивается «Формат результата». Промты не содержат данных проекта: все проектное
подставляется путями к файлам `work/`.

## Тесты

`node .claude/tests/site-tekst/lint-cases.mjs` из корня шаблона SEO, код выхода 0 - все прошли (147 проверок): табличные случаи `lint-common`,
бюджеты страницы через `lint.mjs` и `lint-page.mjs` на синтетической странице, регрессия на `examples/smoke-fixtures`.
`node .claude/tests/site-tekst/scripts-cases.mjs` из корня шаблона SEO, код выхода 0 - все прошли (211 проверок): остальные скрипты как CLI во временных папках
на `examples/smoke-fixtures` и синтетических данных - `init-project`, `build-briefs` + `writer-inputs` (срезы по схеме, факты из текста задания),
`blind-prep`, `page-state`, `plan-run` (`hero_mode`, `sample`), `merge-strategy` (`--split` и сборка обратно, `--check`), `prep-args`,
`dedup` + `cross-digest` (гео-близнецы, утечки гео-фактов), `split-cross` (статусы фиксера, `--merge`), `retro-stats` (пустая и битая папка,
копии `split_from`), `import-project` + `render-analysis` (синтетический `project.json`, гейт, `--allow-ungated`, `--apply-patterns`, `--structure`),
схема конфига без `sources.mode`. Синтетический `project.json` сверяется со схемой анализа site-analiz, если она есть на машине.
Цепочка скриптов вручную на тех же фикстурах - `examples/smoke-fixtures/README.md`.
