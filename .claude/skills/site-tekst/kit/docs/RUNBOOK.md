# Порядок прогона проекта

Все команды - из корня папки проекта. Воркфлоу запускаются инструментом Workflow: `scriptPath` - файл из `workflows/`,
`args` - JSON. Между фазами оркестратор читает результаты и отчеты, на гейтах решает человек.

## Обязательные args

В `args` каждого воркфлоу три поля, ниже они сокращены до `<base>`:
```
"root":"<абсолютный путь к папке проекта>","model":"claude-opus-5","model_light":"claude-sonnet-5"
```
- `root` - агенты не полагаются на текущую папку сессии (она сбрасывается после перезапуска).
- `model` - роли с умолчанием `strong` (факты, разбор лидеров, аудит типов, стратеги, писатели, судьи, фиксеры, ТЗ каталога).
- `model_light` - роли с умолчанием `light` (дамп и снимки, импорт анализа, верификация и классификация конкурентов, анализ
  каталогов, раскладки, публикация ТЗ, запуск скриптов kit). Без `model_light` легкие роли берут `model`.
- Без `model` и `model_light` агенты наследуют модель сессии оркестратора.
- Необязательное `models` - `{"<роль>":"<модель>"}`, точечная замена модели роли (ниже, «Модели по ролям»).

`<вывод скрипта>` в `args` значит: поля JSON, который скрипт печатает в stdout, добавляются в `args` как есть.

## Модели по ролям

У каждого воркфлоу своя таблица `ROLES` (роль -> `light` или `strong`) и функция `modelFor`: роль из `args.models` берет
указанную модель, иначе `light` -> `model_light`, `strong` -> `model`. Роль - короткое стабильное имя, не label вызова.
Модель зависит только от `args`: при `resumeFromRunId` с теми же `args` модели те же и кэш работает.

| Роль | Умолчание | Воркфлоу | Исполнитель |
|---|---|---|---|
| `dump` | light | wf-00 | `00-analysis-dumper` |
| `snapshot` | light | wf-00 | `00-site-snapshot` |
| `import` | light | wf-00 | `00-project-import` (режим `project`) |
| `facts-extract` | strong | wf-00 | `00-facts-extractor`, первый проход |
| `facts-check` | strong | wf-00 | `00-facts-checker`, оба круга |
| `facts-fix` | strong | wf-00 | `00-facts-extractor`, второй проход по находкам |
| `structure-fallback` | strong | wf-00 | `01-structure-fallback` |
| `sitemap-enrich` | strong | wf-00 | `01-sitemap-enricher` |
| `verify` | light | wf-02 | `02-competitor-verifier` |
| `inventory` | light | wf-02 | `02-page-classifier` |
| `extract` | strong | wf-02 | `02-block-extractor` - пока strong, решение по эксперименту (строка `extract:` в `ROLES`) |
| `aggregate` | strong | wf-02 | `02-type-aggregator` |
| `catalog-analyst` | light | wf-02 | `02-catalog-analyst` |
| `type-audit` | strong | wf-03 | `03-type-auditor`, оба круга |
| `type-fix` | strong | wf-03 | `03-type-fixer` |
| `strategist-global` | strong | wf-04 | `04-strategist-global` |
| `strategist-type` | strong | wf-04 | `04-strategist-type` |
| `layout` | light | wf-04 | `04-layout-generator`, оба круга |
| `writer` | strong | wf-05 | `05-block-writer` - пока strong (строка `writer:` в `ROLES`) |
| `hero-writer` | strong | wf-05, wf-05b | `05-hero-writer` (single и три писателя турнира) |
| `hero-judge` | strong | wf-05b | оба судьи турнира: `05-hero-selector` mode=score и слепой читатель |
| `hero-select` | strong | wf-05, wf-05b | `05-hero-selector` mode=select |
| `judge` | strong | wf-06, wf-06b | `06-page-judge`, все круги |
| `fixer` | strong | wf-06, wf-06b | `06-fixer`, все вызовы (судья, кросс, слепой читатель) |
| `cross-judge` | strong | wf-06 | `06-cross-judge` |
| `blind` | strong | wf-06 | `06-blind-reader` |
| `catalog-spec` | strong | wf-07 | `07-catalog-spec-writer` |
| `tz-write` | strong | wf-07 | `07-catalog-tz-writer`, оба круга |
| `tz-audit` | strong | wf-07 | `07-catalog-tz-auditor`, оба круга |
| `tz-publish` | light | wf-07 | `07-catalog-publisher` |
| `distill` | strong | wf-T1 | `T1-rules-distiller`, оба прохода |
| `distill-check` | strong | wf-T1 | `T1-rules-checker`, оба круга |
| `retro` | strong | wf-T2 | `T2-retro` |
| `prep-args` | light | wf-02, wf-03, wf-04 | `node scripts/prep-args.mjs` |
| `briefs` | light | wf-04 | `merge-strategy.mjs` + `build-briefs.mjs` |
| `build` | light | wf-06b | `lint-page`, `render-md`, `build-html`, `check-html`, `report` |
| `run` | light | wf-00, wf-06, wf-T1 | прочие node-команды: `import-structure`, `render-md`, `normalize` |

Пример: экстрактор на легкой модели, писатели блоков и судьи турнира - на явно заданных:
```
"models":{"extract":"sonnet","writer":"opus","hero-judge":"opus"}
```
Через `task.mjs args` - `--extra '{"models":{"extract":"sonnet"}}'`. Одно `models` можно передавать всем воркфлоу: роли,
которых в воркфлоу нет, не действуют; `models` из `wf-05` уходит и во вложенный `wf-05b`. Смена умолчания роли - правка
ее строки в `ROLES` воркфлоу и в таблице выше (тест `.claude/tests/site-tekst/workflow-models.mjs` сверяет обе).

## Сборка шаблона (один раз)

```
Workflow wf-T1-distill-rules.js args={<base шаблона>,"rulesFile":"<путь к файлу правил>"}
```
Повторная слепая проверка без переделки дистилляции: `"skipDistill":true`. Проверить `rules/distill-notes.md`.
Чистота шаблона: `node scripts/init-project.mjs test <пустая папка> --check <проектные слова>` (папку удалить).
Тесты: `node .claude/tests/site-tekst/run.mjs` из корня шаблона SEO (линтер, скрипты, холостой прогон в папке задачи), код выхода 0.

## Проект

### Подготовка
- Режим `doc` (анализ в Google Doc): `node scripts/init-project.mjs <slug> <путь>` из шаблона. В проекте заполнить
  `config/project.json` (компания, сайт, профиль ниши, `sources.analysis_doc_id`, `structure_mode`, `key_phrases`,
  стоп-лист агрегаторов), положить `inputs/structure_data.json` (если `import`) и `inputs/client-preferences.md` (если есть).
- Режим `project` (контракт site-analiz): `node scripts/init-project.mjs <slug> <путь> --project <sites/NNN-<slug>/project.json>
  [--structure <structure_data.json>]`. Скрипт ставит `sources.mode: project`, `project_json`, `structure_input`;
  компанию, сайт, профиль ниши и `key_phrases` заполнит импорт в фазе 0.
- `init-project` последней строкой печатает `args: {...}` - `<base>` для воркфлоу (`root`, `model`, `model_light`, в режиме `project` еще `source`).
- Пилот и волны в конфиге не задаются: пилот - `--slugs` у `plan-run.mjs`, волна - поле `wave` страницы в `work/sitemap.json`.
- Старый проект после `sync-from-template.mjs`: `config/` не синхронизируется; без `sources.mode` режим `doc` (поле необязательно
  в `schemas/project-config.schema.json`); прежние поля `run` и лимиты кругов больше не читаются.

### Фаза 0. Факты, аудитория, карта
`source` в `args` должен совпадать с `sources.mode` конфига: воркфлоу конфиг не читает, по умолчанию `doc`.

Режим `doc`:
```
Workflow wf-00-facts.js args={<base>,"source":"doc","structureMode":"import"}
```
Дамп Google Doc в `inputs/analysis.md`, извлечение фактов и аудитории, слепая сверка (второй круг при blocker/major), снимок
контактов с сайта, `import-structure.mjs`, обогащение карты. Без готовой структуры - `"structureMode":"fallback"`.
Перезапуск без дампа или снимка: `"skipDump":true`, `"skipSnapshot":true`.

Режим `project`. Условие: гейт анализа согласован - в `queue.json` рядом с `project.json` стоит `gate.approved: true`.
Иначе импорт выходит с кодом 2 и воркфлоу останавливается. Пилот до гейта - только явно, `"allowUngated":true`
(факты не подтверждены, у всех `publish: no`, страницы уйдут в короткий набор).
```
Workflow wf-00-facts.js args={<base>,"source":"project","structureMode":"import"}
```
Пути берутся из `config/project.json` -> `sources`; переопределить можно в `args`: `project`, `factsSrc`, `queue`, `structure`.
Один легкий агент: `node scripts/import-project.mjs` (факты, аудитория, `work/client-preferences.json`, `work/directions.json`,
`work/competitors/seed.json`, поля конфига, `inputs/analysis.md` из контракта, копия структуры), регулярки антиобещаний
(`work/anti-promises.patterns.json` -> `import-project.mjs --apply-patterns`), `import-structure.mjs`. Затем снимок сайта -
только если в контракте нет реквизитов, и обогащение карты.
Проверить: `work/import-report.json` (`warnings`, `empty`, `anti.pending` - антиобещания без регулярки линтер не ловит),
`work/facts.json` -> `gaps`, `work/sitemap.json`. Правки анализа вносятся в `project.json`, затем импорт повторяется;
`inputs/analysis.md` руками не правится.

### Гейт 1
Заполнить `rules/decisions.md` (конфликты, CTA, оговорка, страницы вне периметра), утвердить карту. При правках карты -
повторно только обогатитель (агент по `prompts/01-sitemap-enricher.md`).

### Фазы 2-4. Конкуренты, типы страниц, стратегия
Параметры для всех трех фаз печатает `node scripts/prep-args.mjs` -> `{"types":[...],"type_pages":{"<type>":N}}`.
```
Workflow wf-02-competitors.js args={<base>,<вывод prep-args>,"catalog":true|false}
Workflow wf-03-audit-types.js args={<base>,<вывод prep-args>}
Workflow wf-04-strategy-layouts.js args={<base>,<вывод prep-args>}
```
- Мелкие типы: `small_type_max` (2), `small_batch` (4), `solo_types` (`["home"]`) - типы, у которых в карте не больше
  `small_type_max` страниц (кроме `solo_types`), идут пакетом по `small_batch` на одного агрегатора, аудитора, стратега и генератора
  раскладок; файл по-прежнему один на тип. Без `type_pages` воркфлоу запускает `prep-args` легким агентом сам.
- Фаза 2: `extract_batch` (4) - снимков одного домена на вызов экстрактора. Повторный разбор без верификации и классификации:
  `node scripts/prep-args.mjs --types a,b --snapshots [--snapshot-types a] [--domains d1,d2]` -> `args` плюс `"skipInventory":true`;
  для A/B в отдельную папку - `extract_out`, `aggregate_out`, `extract_types`, `extract_domains`, `skipAggregate`.
  Проверить `work/page-types/*.json`.
- Фаза 3: аудитор -> фиксер -> повторный аудит только типов с blocker/major. Открытое - `work/audit/types/<type>-round-2.json`.
- Фаза 4: глобальный стратег, затем стратеги типов параллельно (каждый пишет `work/strategy.pages/<type>.json`), затем легкий агент
  `merge-strategy.mjs` + `build-briefs.mjs` (брифы и срезы `brief/<block_id>.json`); раскладки идут параллельно со стратегией.
  `"skipGlobal":true`, `"skipTypes":true` - не перезапускать уже отработавших стратегов.
  Старый проект (`strategy.json` собран одним стратегом): один раз до фазы 4 `node scripts/merge-strategy.mjs --split`.
  Проверить матрицу дифференциации в `work/strategy.json`, `work/layouts/`, вывод `build-briefs` (проблемы).

### Фаза 5. Пилот
```
node scripts/plan-run.mjs --slugs <главная> [--hero single|tournament] [--tournament-types home,hub,service]
Workflow wf-05-write.js args={<base>,<вывод plan-run>,"concurrency":1}
```
- `hero_mode` страницы ставит `plan-run`: `tournament` по умолчанию для `home`, `hub`, `service` (вложенный `wf-05b`: 3 писателя
  разных конструкций -> судья по чек-листу и слепой читатель -> селектор), иначе `single` (писатель трех вариантов + селектор).
  `--hero` задает режим всем страницам, `--tournament-types` меняет список типов.
- Блоки пишутся по очереди, писатель читает срез брифа и `state.writer.json`, линтер после каждого блока; `page.md` собирает
  писатель последнего блока. Страница останавливается на первом блоке, не прошедшем линтер.
- Затем `wf-06-audit.js` по пилоту (фаза 6), `node scripts/build-html.mjs`, открыть прототип.

`wf-05b` отдельно - только для перезапуска первого экрана на готовой странице:
```
Workflow wf-05b-hero-tournament.js args={<base>,"slug":"<slug>"}
```
`block_id` по умолчанию `B01-hero`. Результат заменяет блок первого экрана и пересобирает `page.md`; топ-3 с оценками - в выводе
воркфлоу, для решения человека.

### Гейт 2 и тираж
Правки `rules/*.md`, `rules/lint.json`, лимитов, `work/page-types/*.json`, `work/layouts/*.html`. Если правились типы или
стратегия - `node scripts/build-briefs.mjs --force <slug...>`. Второй пилот - одна категория.
Тираж: `node scripts/plan-run.mjs --wave 1` -> `wf-05-write.js` (`concurrency` по умолчанию 4), затем `--wave 2`.
`plan-run` отдает только незавершенное.

### Фаза 6. Аудит
```
node scripts/plan-run.mjs --phase audit [--wave N | --slugs a,b] [--sample-per-type 1]
Workflow wf-06-audit.js args={<base>,<вывод plan-run>}
```
- `plan-run --phase audit` отдает в `pages` только дописанные страницы, в `sample` - выборку слепого читателя: первые по карте
  страницы каждого типа среди них, по `--sample-per-type` (по умолчанию 1) на тип.
- Страница: судья круга 1 сам запускает `render-md` и `lint-page`. Если у судьи есть blocker/major или `lint-page` не `pass` -
  один проход фиксера сразу по `round-1.json` и `lint-page.json` (фиксер сам перезапускает линтеры). Круг 2 судьи
  (`scope=fixed`) - только если после фиксера остались blocker или оценки круга 1 ниже `args.thresholds`, по умолчанию
  `{"hero_questions":4,"clonability":4,"flow":4,"objections_closed":0.9,"blocks_on_question":0.9}`.
- Кросс (раз на прогон, `"skipCross":true` - пропустить): кросс-судья сам запускает `dedup.mjs` и `cross-digest.mjs`, судит только
  пары-кандидаты (общие шинглы, одинаковые H1 и подзаголовки первого экрана, гео-близнецы) и утечки гео-фактов, пишет
  `work/audit/cross.json` и раскладывает его `split-cross.mjs` по `work/audit/<slug>/cross.json`. Фиксеры страниц из `pages`
  с blocker/major идут параллельно, каждый по своему файлу; в конце `split-cross.mjs --merge` собирает статусы в общий файл.
  Находки `needs_fact: true` фиксер не получает: это пробелы фактов, вопрос к заказчику.
- Слепой читатель по страницам `sample` (`"skipBlind":true` - пропустить) сам запускает `blind-prep.mjs`; при blocker/major - фиксер.
- В конце `render-md.mjs`. Отчеты: `work/audit/<slug>/round-N.json`, `lint-page.json`, `cross.json`, `blind.json`,
  `work/audit/cross.json`, `dedup.json`, `cross-digest.json`.

`wf-06b` - ручной инструмент, в обычный поток не входит: повторы остались после `wf-06` или страницу правили руками.
```
Workflow wf-06b-fix-repeats.js args={<base>,"slug":"<slug>"}
```
Фиксер по `lint-page.json` (плюс `findings` - список путей к другим отчетам), полный круг судьи `round` (по умолчанию 3,
`"skipJudge":true` - без него), фиксер по судье, сборка (`lint-page`, `render-md`, `build-html`, `check-html`, `report`).

### Фаза 7. Каталог (если есть)
```
Workflow wf-07-catalog.js args={<base>,"publish":true}
```

### Фаза 8. Сборка
`node scripts/render-md.mjs`, `node scripts/build-html.mjs`, `node scripts/check-html.mjs`, `node scripts/report.mjs`.
Результат: `work/output/prototype.html`, `work/output/report.md`, ссылка на ТЗ в `work/catalog/publish.json`.

### Ретро (после проекта)
```
Workflow wf-T2-retro.js args={<base>,"template":"<путь к шаблону>"}
```
Агент сам запускает `node scripts/retro-stats.mjs` (`work/audit/retro-stats.json`; `"skipStats":true` - уже посчитано) и пишет
`work/output/retro.md` и `retro.json`. Принятые предложения вносятся сначала в шаблон, затем в проекты -
`node scripts/sync-from-template.mjs <шаблон>`.

## Если что-то упало
- Воркфлоу: перезапуск с `resumeFromRunId` и теми же `args` - завершенные агенты берутся из кэша. Смена `model`, `model_light`
  или `models` в `args` меняет модель части агентов: с первого такого агента прогон идет заново.
- Фазы 5-6: заново `plan-run` и запуск - готовые блоки не переписываются.
- Фаза 0, `project`: код 2 у импорта - гейт не согласован или нет входного файла; код 1 - выход не прошел схему или регулярки
  антиобещаний не прошли проверку (`work/import-report.json`).
- Фаза 4: `merge-strategy` с кодом 1 - проблемы в файлах типов, проверка `node scripts/merge-strategy.mjs --check work/strategy.pages/<type>.json`.
- Линтер блокирует блок дважды: `work/audit/<slug>/lint-<block>.json`; чаще всего цифра без факта или CTA не по брифу.
  Решение - править бриф или стратегию (и `build-briefs.mjs --force <slug>`), а не ослаблять линтер.
