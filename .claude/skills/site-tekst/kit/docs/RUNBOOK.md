# Порядок прогона проекта

Все команды - из корня папки проекта. Воркфлоу запускаются инструментом Workflow: `scriptPath` - файл из `workflows/`,
`args` - JSON. Прогон идет без остановок: между фазами оркестратор читает короткие итоги и проверяет условия автостопа,
человек вмешивается только на ручной паузе (`--stop map|strategy|pilot`) или на автостопе. Как это ведет скил (переходы,
паузы, автостопы, ответы заказчика) - `.claude/skills/site-tekst/SKILL.md` шаблона SEO; здесь - фазы, args и скрипты kit.

## Обязательные args

В `args` каждого воркфлоу три поля, ниже они сокращены до `<base>`:
```
"root":"<абсолютный путь к папке проекта>","model":"<модель strong>","model_light":"<модель light>"
```
Значения печатает `init-project` (строка `args:`) или `task.mjs args` скила; `<base>` берется оттуда как есть.
- `root` - агенты не полагаются на текущую папку сессии (она сбрасывается после перезапуска).
- `model` - роли с умолчанием `strong` (факты, составитель решений, разбор лидеров, аудит типов, стратеги и рецензия
  стратегии, писатели, судьи, фиксеры, ТЗ каталога).
- `model_light` - роли с умолчанием `light` (дамп и снимки, импорт анализа, верификация и классификация конкурентов, анализ
  каталогов, раскладки, примеры товаров, публикация ТЗ, запуск скриптов kit). Без `model_light` легкие роли берут `model`.
- Без `model` и `model_light` агенты наследуют модель сессии оркестратора.
- Необязательное `models` - `{"<роль>":"<модель>"}`, точечная замена модели роли (ниже, «Модели по ролям»).

`<вывод скрипта>` в `args` значит: поля JSON, который скрипт печатает в stdout, добавляются в `args` как есть.

## Модели по ролям

У каждого воркфлоу своя таблица `ROLES` (роль -> `light` или `strong`) и функция `modelFor`: роль из `args.models` берет
указанную модель, иначе `light` -> `model_light`, `strong` -> `model`. Роль - короткое стабильное имя, не label вызова.
Модель зависит только от `args`: при `resumeFromRunId` с теми же `args` модели те же и кэш работает.

| Роль | Умолчание | Воркфлоу | Исполнитель | label вызова |
|---|---|---|---|---|
| `dump` | light | wf-00 | `00-analysis-dumper` | `dump` |
| `snapshot` | light | wf-00 | `00-site-snapshot` | `site-snapshot` |
| `import` | light | wf-00 | `00-project-import` (режим `project`) | `project-import` |
| `facts-extract` | strong | wf-00 | `00-facts-extractor`, первый проход | `facts-extract` |
| `facts-check` | strong | wf-00 | `00-facts-checker`, оба круга | `facts-check-1`, `facts-check-2` |
| `facts-fix` | strong | wf-00 | `00-facts-extractor`, второй проход по находкам | `facts-fix` |
| `structure-fallback` | strong | wf-00 | `01-structure-fallback` | `structure-fallback` |
| `decisions` | strong | wf-00 | `01-decisions-drafter` (оба режима) | `decisions` |
| `sitemap-enrich` | strong | wf-00, wf-04 | `01-sitemap-enricher` (wf-04 - `mode=facts`, режим обновления) | `sitemap-enrich` |
| `verify` | light | wf-02 | `02-competitor-verifier` | `verify` |
| `inventory` | light | wf-02 | `02-page-classifier`: статика параллельно, браузерный добор по одному | `inventory:<домен>`, `inventory:browser:<домен>` |
| `extract` | strong | wf-02 | `02-block-extractor` - пока strong, решение по эксперименту (строка `extract:` в `ROLES`) | `extract:<домен>:<часть>` |
| `aggregate` | strong | wf-02 | `02-type-aggregator` | `aggregate:<типы>` |
| `catalog-analyst` | light | wf-02 | `02-catalog-analyst` | `catalog-analyst` |
| `type-audit` | strong | wf-03 | `03-type-auditor`, оба круга | `audit:<типы>:1`, `audit:<типы>:2` |
| `type-fix` | strong | wf-03 | `03-type-fixer` | `fix:<типы>` |
| `strategist-global` | strong | wf-04 | `04-strategist-global` | `strategist-global` |
| `strategist-type` | strong | wf-04 | `04-strategist-type` | `strategist:<типы>` |
| `strategy-review` | strong | wf-04 | `04-strategist-global` mode=review | `strategy-review` |
| `layout` | light | wf-04 | `04-layout-generator`, оба круга | `layout:<типы>`, `layout:<типы>:2` |
| `writer` | strong | wf-05 | `05-block-writer` - пока strong (строка `writer:` в `ROLES`) | `block:<slug>:<block_id>` |
| `hero-writer` | strong | wf-05, wf-05b | `05-hero-writer` (single и три писателя турнира) | `hero:<slug>`, `hero-writer:<slug>:<конструкция>` |
| `hero-judge` | strong | wf-05b | оба судьи турнира: `05-hero-selector` mode=score и слепой читатель | `judge:checklist:<slug>`, `judge:blind:<slug>` |
| `hero-select` | strong | wf-05, wf-05b | `05-hero-selector` mode=select | `select:<slug>` |
| `judge` | strong | wf-06, wf-06b | `06-page-judge`, все круги | `judge:<slug>:<круг>` (wf-06), `judge:<круг>` (wf-06b) |
| `fixer` | strong | wf-06, wf-06b | `06-fixer`: общий фиксер страницы (`mode=full`), фиксеры после круга 2 и кросса (`mode=narrow`) | `fix:<slug>`, `fix:<slug>:2`, `fix:<slug>:cross` (wf-06), `fix:1`, `fix:2` (wf-06b) |
| `cross-judge` | strong | wf-06 | `06-cross-judge` | `cross-judge` |
| `blind` | strong | wf-06 | `06-blind-reader` | `blind:<slug>` |
| `catalog-spec` | strong | wf-07 | `07-catalog-spec-writer` | `catalog-spec` |
| `sample-items` | light | wf-07 | `07-sample-items` | `sample-items` |
| `tz-write` | strong | wf-07 | `07-catalog-tz-writer`, оба круга | `tz-write`, `tz-write-2` |
| `tz-audit` | strong | wf-07 | `07-catalog-tz-auditor`, оба круга | `tz-audit-1`, `tz-audit-2` |
| `tz-publish` | light | wf-07 | `07-catalog-publisher` | `tz-publish` |
| `distill` | strong | wf-T1 | `T1-rules-distiller`, оба прохода | `distill`, `distill-fix` |
| `distill-check` | strong | wf-T1 | `T1-rules-checker`, оба круга | `check-1`, `check-2` |
| `retro` | strong | wf-T2 | `T2-retro` | `retro` |
| `prep-args` | light | wf-02, wf-03, wf-04 | `node scripts/prep-args.mjs` (в wf-02 и `--check-degraded`) | `prep-args` |
| `briefs` | light | wf-04 | `merge-strategy.mjs` + `build-briefs.mjs`, до рецензии и после нее | `merge+build-briefs`, `merge+build-briefs:review` |
| `build` | light | wf-06b | `render-md`, `lint-page`, `build-html`, `check-html`, `check-site-js`, `report` | `build` |
| `run` | light | wf-00, wf-04, wf-06, wf-06b, wf-07, wf-T1 | прочие node-команды: wf-00 - `import-structure`, `import-project --company-facts`; wf-04 - чтение `facts_diff`, `import-structure --check-enrich before\|after`; wf-06, wf-06b - `fix-diff` (снимок и сравнение), `dedup` + `cross-digest --empty-report`, `split-cross --merge`, `render-md`, `lint-page`; wf-07 - `validate catalog-spec`, `md-to-docx --check`; wf-T1 - `normalize` | `import-structure`, `company-facts`, `update-check`, `enrich-check:before`, `enrich-check:after`, `snap:<slug>[:2\|:cross]`, `diff:<slug>[:1\|:2\|:cross]`, `cross-pre`, `render-md`, `check:spec`, `check:tz`, `check:tz-2`, `normalize` |

Пример: экстрактор на легкой модели, писатели блоков и судьи турнира - на явно заданных:
```
"models":{"extract":"sonnet","writer":"opus","hero-judge":"opus"}
```
Через `task.mjs args` - `--extra '{"models":{"extract":"sonnet"}}'`. Одно `models` можно передавать всем воркфлоу: роли,
которых в воркфлоу нет, не действуют; `models` из `wf-05` уходит и во вложенный `wf-05b`. Новая роль или смена умолчания -
строка в `ROLES` воркфлоу, строка в таблице выше и в `LIGHT`/`STRONG`/`LABELS` теста
`.claude/tests/site-tekst/workflow-models.mjs` (он сверяет все три).

## Окружение

- **wf-05 - только верхним уровнем.** Он сам зовет вложенный `wf-05b` (турнир первого экрана), а вложенность глубже
  одного уровня движок не допускает. Из другого воркфлоу - только с `args` от `task.mjs args write --hero single`.
- **Аудиты не параллельно:** кросс-судья пишет общий `work/audit/cross.json`.
- **Браузер у агентов один.** Только своя вкладка: `tabs_create`, ее tabId во всех вызовах, `tabs_close` в конце; агенты,
  которые ходят в браузер, идут последовательно (в wf-02 браузерный добор - отдельный проход по одному конкуренту, аналитик
  каталогов - после него). Порядок снятия страницы: `scripts/fetch-page.mjs` (сам повторяет запрос и уходит в curl), браузер -
  последним и только дословно: код `node scripts/fetch-page.mjs --dom-snippet` в `javascript_tool`, вывод - в
  `<raw>.browser.md` без правок, снимок - `fetch-page.mjs --text-from`. Пересказ (нет отметки обхода) - `verbatim: false`:
  в замер и цитаты не идет. Статический снимок не меньше браузерного остается.
- **grep:** кириллица и тире - только литералом `grep -F`; проверки стиля (буква е-с-точками, тире) - через node: grep в
  Git Bash путает кириллицу.
- **`node -e` - только для чтения** полей JSON. Правки кода и данных - файлом или инструментом Edit: в `node -e` через bash
  теряются обратные слеши регулярок.
- Временные файлы - в скретчпаде сессии (в Windows нет `/tmp`).
- **Google Docs API не нужен** (на аккаунте выключен). ТЗ каталога публикуется файлом: `scripts/md-to-docx.mjs` ->
  `uploadFile` с конвертацией в Google Doc; `createGoogleDoc` не использовать. `uploadFile` режет имя по последней точке - в
  имени точек нет. Дамп анализа режима `doc` - экспортом через Drive (`downloadFile`, `exportMimeType: text/markdown`),
  `readGoogleDoc` - последний путь.
- **Долгие команды** (`check-site-js` на большом сайте, сборка фазы 8) - Bash с `timeout 600000`: по умолчанию команда
  обрывается через 2 минуты.
- npm-пакеты (`jsdom`, `docx`, `marked`) скрипты ищут через `scripts/deps.mjs` в `node_modules` клиентского проекта
  (`npm install` в его корне). Нет `jsdom` - `check-site-js` дает SKIP (код 0), это видно в отчете и в итоге сдачи.
- `serve.mjs` отдает файлы с `Cache-Control: no-store`: после пересборки превью не показывает старую версию. Порт занят -
  код 2 с подсказкой `--port` (порт задачи скил считает от хеша ее пути).
- **Правки проекта** (`overrides/<путь kit>`, кладет `task.mjs place`): `.json` - только измененные ключи, слияние с файлом
  kit по RFC 7396 (объекты рекурсивно, массив и значение правки заменяют значение kit целиком, `null` удаляет ключ); `.md` с
  первой строкой `<!-- overrides:append -->` - файл kit и дописка; прочее - полная замена (база сверки - `meta.json`
  `overrides_base`, `place` печатает команду `git diff` при обновлении kit). Живые блоки проекта -
  `overrides/html/site/registry.json` и `overrides/html/site/behaviors/<name>.js` (фаза 8).

## Сборка шаблона (один раз)

```
Workflow wf-T1-distill-rules.js args={<base шаблона>,"rulesFile":"<путь к файлу правил>"}
```
Повторная слепая проверка без переделки дистилляции: `"skipDistill":true`. Проверить `rules/distill-notes.md`.
Чистота шаблона: `node scripts/init-project.mjs test <пустая папка> --check <проектные слова>` (папку удалить).
Тесты: `node .claude/tests/site-tekst/run.mjs` из корня шаблона SEO (линтер, скрипты, воркфлоу, холостой прогон в папке
задачи), код выхода 0.

## Проект

### Подготовка
- Режим `doc` (анализ в Google Doc): `node scripts/init-project.mjs <slug> <путь>` из шаблона. В проекте заполнить
  `config/project.json` (компания, сайт, профиль ниши, `sources.analysis_doc_id`, `structure_mode`, `key_phrases`,
  стоп-лист агрегаторов), положить `inputs/structure_data.json` (если `import`) и `inputs/client-preferences.md` (если есть).
- Режим `project` (контракт site-analiz): `node scripts/init-project.mjs <slug> <путь> --project <sites/NNN-<slug>/project.json>
  [--structure <structure_data.json>]`. Скрипт ставит `sources.mode: project`, `project_json`, `structure_input`;
  компанию, сайт, профиль ниши и `key_phrases` заполнит импорт в фазе 0.
- `init-project` последней строкой печатает `args: {...}` - `<base>` для воркфлоу (`root`, `model`, `model_light`, в режиме `project` еще `source`).
- Необязательный блок `config/project.json` -> `site` (оболочка прототипа): `nav` (меню шапки вместо построенного по
  карте: slug или `{label, page|anchor}`; у лендинга - только якоря), `off` (модули, которые не выводить), `tagline`
  (строка под логотипом).
- Пилот и волны в конфиге не задаются. Волны считает `scripts/progress.mjs` по карте: волна 1 - главная и первая по карте
  рабочая страница каждого типа, у которого рабочих страниц 2+; волна 2 - остальные рабочие страницы. Состав волн от
  прогресса не зависит. Пилот - `--slugs` у `plan-run.mjs`.
- Обновление kit в задаче шаблона SEO: kit шаблона -> `/sync-from-template` (или `/sync-all`) клиента -> `task.mjs place`
  задачи. `scripts/sync-from-template.mjs` kit - только для автономной копии вне шаблона: в папку задачи он не кладется, а
  запущенный в ней отказывает (код 2), иначе обошел бы манифест и overrides. Старый проект после обновления: `config/` не
  трогается; без `sources.mode` режим `doc` (поле необязательно в `schemas/project-config.schema.json`); прежние поля `run`
  и лимиты кругов, поле `wave` карты больше не читаются.

### Фаза 0. Факты, аудитория, карта, решения
`source` в `args` должен совпадать с `sources.mode` конфига: воркфлоу конфиг не читает, по умолчанию `doc`.

Режим `doc`:
```
Workflow wf-00-facts.js args={<base>,"source":"doc","structureMode":"import"}
```
Дамп Google Doc в `inputs/analysis.md`, извлечение фактов и аудитории, слепая сверка (второй круг при blocker/major), снимок
контактов с сайта || `import-structure.mjs`, составитель решений, обогащение карты. Без готовой структуры -
`"structureMode":"fallback"`. Перезапуск без дампа или снимка: `"skipDump":true`, `"skipSnapshot":true`.

Режим `project`. Условие: гейт анализа согласован - в `queue.json` рядом с `project.json` стоит `gate.approved: true`.
Иначе импорт выходит с кодом 2 и воркфлоу останавливается. Пилот до гейта - только явно, `"allowUngated":true`
(факты не подтверждены, у всех `publish: no`, страницы уйдут в короткий набор).
```
Workflow wf-00-facts.js args={<base>,"source":"project","structureMode":"import"}
```
Пути берутся из `config/project.json` -> `sources`; переопределить можно в `args`: `project`, `factsSrc`, `queue`, `structure`.
Порядок: легкий агент импорта (`node scripts/import-project.mjs`: факты, аудитория, `work/client-preferences.json`,
`work/directions.json`, `work/competitors/seed.json`, поля конфига, `inputs/analysis.md`, копия структуры, регулярки
антиобещаний через `--apply-patterns`, `import-structure.mjs`) -> снимок сайта, только если в `import-report.json` непустой
`company_missing` (телефон, адрес, часы), и после него run-агент `import-project.mjs --company-facts` (label `company-facts`)
-> составитель решений -> обогатитель карты.

Что делает фаза 0 сверх фактов:
- **Контакты и реквизиты** - служебные факты с фиксированными id: `F901`-`F903` телефоны (основной первым), `F904` почта,
  `F905` часы, `F906` адрес, `F907` юрлицо (название, ИНН, ОГРН); `facts.company` (телефоны `+7 (XXX) XXX-XX-XX`, каналы
  `channels` - объекты `{label, value, href}`). Сверено заказчиком (`company.status: confirmed`) - только после гейта
  анализа и при решении d10 без правки: запись журнала анализа по d10 с `kind: waiver` - сверено, `gap` - правка или
  неразобранный ответ. Иначе в `gaps` строка «контакты и реквизиты не сверены заказчиком». Поля, которые заказчик убрал
  ответом на d10 (`business.legal.absent_fields` анализа), - `company.absent` в именах kit (`hours`, `legal_name`; телефон -
  `company.no_phone: true`): их нет в `company` и F9xx, снимок ради них не зовется и их не заполняет, контактный факт
  анализа о таком поле получает `publish: no` и строку gaps «... заказчик снял в d10 ...». Снимок сайта заполняет только
  пустые поля; `node scripts/import-project.mjs --company-facts` (снимок и воркфлоу после него; работает и в режиме `doc`, и
  до гейта) дописывает F9xx в пустые слоты. Каналы `company.channels` - только из фактов: канал со старого сайта без факта -
  строка gaps «канал со старого сайта: <подпись> <ссылка> - публиковать?» (вопрос заказчику; подтверждение - контактный
  факт анализа или F8xx с названием канала в `label`).
- **Факты оператора** `F801`-`F899` импорт сохраняет; факт, перенесенный в анализ (у факта анализа `moved_from: "F8NN"`),
  снимает с предупреждением, чтобы он не стоял дважды.
- **Карта** (`import-structure.mjs`): адреса приводятся к пути (без схемы, хоста и слеша на конце), дубли - в
  `work/sitemap.skipped.json`; юридические страницы - `ui_role: legal` и `status: skip`; страницы-шаблоны (`{slug}`,
  `[...]`) - `template: true`, тип из колонки структуры; `listing: true` у category, если бизнес не `services`; маркер
  структуры (фраза с регионом) - первым в `source_queries` и в `key_phrase` (ее берет бриф и H1). Волн в карте нет.
- **Решения** (`01-decisions-drafter`): `rules/decisions.md` формата v2 (первая строка `<!-- decisions:v2 -->`): §1
  конфликты фактов (`| Факт | Конфликт | Разрешенная формулировка | Где можно |`) и строка открытых пробелов, §3 тексты
  CTA по типам (результатом для клиента, из d3; у страниц с выдачей главная кнопка - переход к выдаче, d3 - второе
  действие), §6 решения анализа о периметре, §7 пожелания, §8 «Спорное: решения агента». «Где можно»: `все` (или `везде`),
  `нигде` (факт снят со всех страниц - так пишется «не публикуем»), slug и type карты через запятую («только a, b» - то
  же), «все, кроме a, b». Неразобранная колонка не применяется: `task.mjs status` пишет «Где можно» не разобрано: <id>.
  Старый заполненный файл без маркера агент не трогает (`legacy: true`); с маркером - дописывает пустое, заполненные
  строки не переписывает. Исключение - параметр `fix_where=<id,...>`: переписать только колонку «Где можно» строк этих
  фактов (повтор после «не разобрано», шаг 3 SKILL.md скила).
- **Обогащение карты**: `ui_role` search, cart, account (функциональные страницы: не в меню, не в /seo-faq), `nav_label`
  (до 24 знаков), `segment: "all"` + `segments` у главной и хабов с 2+ сегментами, `block_set`.

Проверить: `work/import-report.json` (`warnings`, `empty`, `anti.pending` - антиобещания без регулярки линтер не ловит,
`company_missing`), `work/facts.json` -> `gaps`, `work/sitemap.json`, первую строку `rules/decisions.md`. Составитель или
обогатитель без ответа - ошибка воркфлоу. `inputs/analysis.md` руками не правится.

### Правка анализа посреди прогона
Анализ правится своей задачей `/site-analiz`; в задаче текстов - только режим фактов:
```
node scripts/import-project.mjs --facts-only [--force]
```
- Пересобирает из анализа `facts[]` и строки `gaps` про факты; `company` и `F901`-`F907` - по полям анализа и снимка
  (`import-report.json` -> `company_origin`), антиобещания с регулярками, терминология и прочие выходы не трогаются.
- Сверка с дайджестом прошлого импорта (`import-report.json` -> `facts_digest`): `facts.json` правили руками - дифф по id и
  код 3, без `--force` ничего не записано. Факты оператора `F801`-`F899` (`source: "оператор: <дата> <основание>"`) и
  `F901`-`F907` ручной правкой не считаются и сохраняются.
- В отчете: `facts_diff` (`added`, `removed`, `changed`, `published`, `unpublished`; факт оператора, перенесенный в анализ, -
  в `removed`, его новый id - в `added`) и `other_changed` (изменились ЦА, пожелания, направления, конкуренты, антиобещания
  - `--facts-only` их не переносит, нужен повтор фазы 0). `other_changed` сравнивает анализ с отпечатком прошлого импорта
  (`import-report.json` -> `analysis_fingerprint`), а не с рабочими файлами: правки стратегов в `client-preferences.json`
  изменением не считаются. Отчет без отпечатка (задача старого kit) - по рабочим файлам, пожелания парами «текст, статус».
- Дальше - фаза 4 в режиме обновления (ниже, «Фазы 2-4»); весь рецепт (брифы и перелинт, блоки, ждавшие ответа, волны,
  сборка) - шаг 2 SKILL.md скила.

### Пауза `map`
При `--stop map` человек правит `rules/decisions.md` (§1-§7) и карту. Набор блоков страницы (`short`, `skip`) - решением в
§6 `rules/decisions.md`, а не правкой `block_set`: его пересчитывает обогатитель. После смены типа, родителя или состава
страниц - повторно только обогатитель (агент по `prompts/01-sitemap-enricher.md`): у заполненных страниц он поля не меняет,
заполняет пустые и новые, §6 применяет; `nav_label` и `ui_role` человек правит после него. Без паузы решения заполняет
составитель, спорное - в §8.

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
  `prep-args` печатает и `info_other` (названия инфо-страниц карты: доставка, оплата, гарантия) - классификатор ищет у
  лидеров страницы того же назначения. Инвентаризации нет, если кроме главной искать нечего (лендинг): главные снял
  верификатор. Статусы снимка (`fetch-page.mjs`): `antibot` - HTTP 401/403/429/498/503 или страница проверки (видимый текст,
  заголовок окна; виджеты форм и скрипты CDN не в счет), `js_only` - текста меньше 1500 знаков или пустая оболочка SPA, `ok`
  (`flat: true` - текст есть, заголовков мало), `closed` - HTTP >= 400, `error` - сеть, таймаут; `antibot`, `js_only` и
  `error` - браузерный добор. Сбой каталог-аналитика не валит фазу (`domains_failed`). Проверить `work/page-types/*.json`.
- Без конкурентов: верификатор никого не оставил, все кандидаты ответили, но недоступны по статусу, и это подтвердил
  `prep-args.mjs --check-degraded` - типы собираются по анализу и форме фикстуры (`sources: []`, `notes` «без конкурентов»,
  `degraded: "no_competitors"` в `competitors.json`), отчет спрашивает заказчика о 2-3 сайтах-ориентирах; это не сбой. Не
  ответил ни один запрос (сеть, MCP, браузер) - ошибка «нет доступных конкурентов: ...», сбой среды: новый запуск wf-02 без
  `resumeFromRunId` (пустой ответ верификатора лежит в кэше, повтор из кэша вернет ту же ошибку). Возврат:
  `degraded`, `browser_pass`, `extract_failed`.
- Фаза 3: аудитор -> фиксер -> повторный аудит только типов с blocker/major. Открытое - `work/audit/types/<type>-round-2.json`.
  Новый для kit вид блока лидеров - `pattern: custom` с `custom_name`. У лендинга обязательны «что входит», «сколько стоит
  или от чего зависит», «как работаем», финальная форма (нет - major аудитора типов).
- Фаза 4: глобальный стратег, затем стратеги типов параллельно (каждый пишет `work/strategy.pages/<type>.json`, споры -
  полем `disputes`), затем легкий агент `merge-strategy.mjs` + `build-briefs.mjs` (label `merge+build-briefs`), затем
  рецензия стратегии (`04-strategist-global` mode=review: читает `node scripts/merge-strategy.mjs --matrix` и факты,
  правит записи `work/strategy.pages/<type>.json`, находки - `work/audit/strategy-review.json`, неразрешимое - §8
  `rules/decisions.md`), затем повтор сборки (label `merge+build-briefs:review`). Раскладки идут параллельно со стратегией.
  `"skipGlobal":true`, `"skipTypes":true`, `"skipReview":true` - не перезапускать уже отработавших стратегов и рецензию;
  `"skipLayouts":true` - не перегенерировать раскладки (типы страниц не менялись). Строки « ~ » сборки (первый экран без
  фактов, подпись CTA без действия) - поле `review_notes`: идут в рецензию, в автостоп не идут.
  Возврат: `briefs` и `briefs_final` (`{ok, exit_code, problems, review_notes, warnings, merge}` до и после рецензии),
  `review` (`skipped` - пропущена), `briefs_problems` (проблемы последней сборки: непустой - автостоп), `layouts`
  (`skipped` при `skipLayouts`).
  Старый проект (`strategy.json` собран одним стратегом): один раз до фазы 4 `node scripts/merge-strategy.mjs --split`.
- **Режим обновления** (после `--facts-only`, ответы заказчика): `"update":true` - run-агент читает `facts_diff` из
  `work/import-report.json` (нет - ошибка «сначала --facts-only новым kit»); стратеги типов идут с `mode=update` и диффом:
  переносят прежние записи `work/strategy.pages/<type>.json` как есть, снятые факты (`removed`, `unpublished`) убирают, новые
  (`added`, `published`) добавляют страницам по предмету, у `changed` записи остаются. Глобальный стратег - только при новых
  фактах (дописывает углы подачи), стратеги типов - только при непустом диффе. Рецензия получает `mode=review; update;
  facts_diff; changed_pages` и правит только эти страницы и страницы из проблем и замечаний сборки; изменений нет и сборка
  чистая - рецензия пропущена. `"enrich":true` (вместе с `update`; ставит оркестратор, если в `facts_diff` непусты `added`,
  `removed`, `published` или `unpublished`) - первым шагом, до стратегов, обогатитель карты `mode=facts` пересчитывает
  `facts_available`, `fact_coverage`, `block_set` и решения `short` §6 (стратег типа читает `block_set`).
  Карта сверяется `node scripts/import-structure.mjs --check-enrich before|after`: код 0 - изменились только эти поля; 3 -
  изменилось лишнее, скрипт вернул карту из копии; 2 - нет карты или копии (сверки не было). Итог - `enrich`
  (`{ok, rolled_back, notes}`) и `update.facts_diff` в возврате. Обычно с `"skipLayouts":true`.

### Стратегия и брифы: скрипты
- `merge-strategy.mjs --check <file...>` - проблемы (код 1): факты `facts`, `hero_facts`, `block_overrides.*.facts` и id из
  `task` есть в `facts.json`, публикуются и не закрыты для страницы колонкой «Где можно» §1; `hero_facts` входят в `facts`;
  ключи `block_overrides` и `exclude_blocks` - блоки типа (`hero` не исключается); `segment` есть в audience или `all`;
  `objection_ids` есть в audience; в `task` нет id после отрицания; `action` CTA по контракту (`lead`, `page:<slug>`,
  `anchor:<id блока типа>`, `messenger`, `call`; якорь финального призыва - `cta-final`, у старых данных и `cta`). `cta`
  страницы необязателен: без него - глобальный из `cta_by_type`, `action` и `short` наследуются парами при совпадении
  подписи. При сборке те же находки - предупреждения; еще предупреждение по данным - у страницы с выдачей (`listing: true`
  или блок `pattern: listing` у типа) главная кнопка без `action` (иначе она ведет к заявке, а не к выдаче).
- `merge-strategy.mjs --matrix` - таблица стратегии для рецензии (slug, type, parent, segment, hook, unique_argument,
  hero_facts с wording), близнецы, частота фактов; все - в `work/audit/strategy-matrix.md`, в консоль при карте до 40 страниц.
- `build-briefs.mjs [slug...] [--force]` - порядок блоков: `recommended_order`/`short_set` -> минус `exclude_blocks` ->
  выпадение блоков без фактов (блок цифр - без числового факта). Явный пустой `facts: []` стратега у блока из
  `limits.drop_blocks_without_facts` или у блока цифр - исключение, как `exclude_blocks`, без вопроса заказчику. Факты
  страницы - только `publish: yes` и разрешенные «Где можно» §1 (разбирается только при маркере v2); страховки: «не
  публикуем» без разрешенной формулировки при «все» снимает факт, факт с конфликтом против антиобещания или запрета в gaps
  без строки §1 в брифы не идет (`facts_dropped`, причина `conflict`), формулировка §1 с числами, которых нет в фактах ее
  строки, в бриф не кладется (предупреждение «поправь строку §1 или факт»). У фактов в брифе `rule` (разрешенная
  формулировка §1), `note` (условие), `owner_block`; `unknowns` - открытые вопросы; `key_phrase` страницы идет в срез
  первого экрана. Нижняя граница числа пунктов (карточки, шаги, вопросы, строки таблиц, списки, плашки, цифры)
  прижимается к опорам - пунктам фактов - предупреждением, без вопроса заказчику. Оговорка `disclaimer_text` - только в
  блоке `disclaimer_block` стратега, служебная записка в брифы не идет. Заметки для рецензии (первый экран без фактов и
  т.п.) - строками « ~ ».
- Пересборка брифа (правка анализа, стратегии, факта): бриф всегда собирается в памяти. Список блоков прежний - файл
  пишется, страницы с написанными блоками и измененным брифом печатаются строкой «перелинтовать» ->
  `node scripts/lint-page.mjs <slug>` по каждой (блок с фактом, которого больше нет, перестает проходить линтер и уходит
  писателю). Список изменился: блоков еще нет - бриф пишется; блоки есть - бриф не трогается, предупреждение «структура
  изменилась, нужен --force» и `structure_changed`; `--force <slug>` - запись и перенумерация файлов блоков
  (`renumber-blocks.mjs` переносит и их lint-файлы и находки, выпавшие блоки - в `work/pages/<slug>/_old/`).
- `work/briefs-report.json` сливается по страницам: `pages.<slug>` (`excluded`, `dropped`, `objections_unassigned`,
  `facts_dropped`, `structure_changed`, `problems`), `questions`, `warnings`. Проблемы печатаются целиком (код 1), предупреждения -
  сводкой по видам (среди них `task`: id факта после отрицания в задании блока).

### Фаза 5. Запись
```
node scripts/plan-run.mjs [--wave 1|2 | --slugs a,b] [--hero single|tournament] [--tournament-types home,hub,service]
Workflow wf-05-write.js args={<base>,<вывод plan-run>,"concurrency":4}
```
- `plan-run --phase write` отдает страницы с блоками `pending`: нет файла; lint не pass и блок не exhausted. Блок
  `exhausted` - lint не pass, `attempts` не меньше 2 и `brief_sha` равен текущему срезу (оба поля в файле блока пишет
  писатель): не отдается, в прототипе скелет, в отчете «не прошел линтер». Сменился срез (новые факты, правка стратегии) -
  попытки считаются заново. Блок с lint pass не отдается при любом срезе: переписать его (например, блок с `needs_fact`,
  на который пришел факт) - перенести файл блока и `work/audit/<slug>/lint-<block_id>.json` в `work/pages/<slug>/_old/`.
  Писатель, не записавший `attempts` и `brief_sha`, не доводит блок до exhausted: число запусков ограничивает оркестратор.
- `hero_mode` страницы: `tournament` - главная, хабы и первая по карте страница типов `service` и `category` (вложенный
  `wf-05b`: 3 писателя разных конструкций -> судья по чек-листу и слепой читатель -> селектор), остальные - `single`
  (писатель трех вариантов + селектор). `--hero` задает режим всем страницам, `--tournament-types` - турнир всем страницам
  перечисленных типов.
- Блоки пишутся по очереди, писатель читает срез брифа и `state.writer.json`, линтер после каждого блока (до 2 кругов);
  `page.md` собирает писатель последнего блока. Блок, не прошедший линтер, страницу не останавливает: писатели идут к
  следующим блокам. `"stopOnBlock":true` - прежнее поведение (страница встает на первом таком блоке).
- Возврат: `pages`, `stopped`, `failed` (`{slug, block_id, reason, no_answer?}`). `no_answer` - агент или турнир не
  ответил: попытка не засчитана (для автостопа оркестратора).
- Пилот: `plan-run --slugs <страницы>`, `concurrency` 1. Тираж: `--wave 1`, затем `--wave 2`; `plan-run` отдает только
  незавершенное.

`wf-05b` отдельно - только для перезапуска первого экрана на готовой странице:
```
Workflow wf-05b-hero-tournament.js args={<base>,"slug":"<slug>"}
```
`block_id` по умолчанию `B01-hero`. Селектор проверяет победителя линтером во временном файле и заменяет блок только при
успехе (прежний - в `work/pages/<slug>/_old/`), затем пересобирает `page.md`; топ-3 с оценками - в выводе воркфлоу, для
решения человека.

Линтер (`lint.mjs`, `lint-page.mjs`, правила `rules/lint.json`): `fact.hedge-lost` (major) - у числа из факта (и в плашках,
цифрах, строках прайса) потеряна оговорка («стандартно», «от», «до», «около», «в среднем», «почти», «не менее»); цифры и
маркеры из `rule` факта берутся только из разрешенных фрагментов в «елочках»; текст `rule` не считается повтором. Маска
имен: предмет страницы, `key_phrase`, компания, предметы страниц из ссылок и непереводимые термины не дают «Мы»-начала,
стоп-слов и цифр без факта (стоп-слово внутри имени - лексика страницы, вне имени - находка; у стоп-слов правая граница
слова). Повтор фраз: отдельный запуск (писатель, селектор, фиксер) - с прошедшими блоками в обе стороны, перепроверка
страницы (`lint.mjs --page` из `lint-page.mjs`) - только с блоками выше, одна находка на пару, у нижнего блока; не
прошедшие блоки в сравнении и в состоянии писателя (`page-state.mjs <slug> [<block_id>]`) не участвуют. Нишевые основы
`claim_markers` прошлых проектов - в `examples/lint-niche-markers.example.json`: проекту с такой нишей -
`overrides/rules/lint.json` задачи только с ключом `claim_markers` (массив правки заменяет массив kit целиком: ядро kit плюс
нужные основы). `lint-page.mjs` пишет `page_sha` (sha1 `page.md`): по нему аудит считается свежим.

### Фаза 6. Аудит
```
node scripts/plan-run.mjs --phase audit [--wave N | --slugs a,b] [--sample-per-type 1]
Workflow wf-06-audit.js args={<base>,<вывод plan-run>}
```
- `plan-run --phase audit` отдает дописанные страницы (каждый блок pass или exhausted) с `audit_fresh` (есть круг судьи и
  `page_sha` в `lint-page.json` равен sha1 текущего `page.md`) и `audit_last_round`; в `sample` - выборку слепого читателя:
  первые по карте страницы каждого типа среди них, по `--sample-per-type` (по умолчанию 1). `task.mjs args audit` берет
  страницы без свежего аудита и ставит `pages[].round` - номер следующего круга (прежние `round-N.json` остаются).
- Порядок страницы (решение Р4): судья круга `round` (сам запускает `render-md` и `lint-page`) и слепой читатель (страница
  из `sample`, `"skipBlind":true` - без него; сам запускает `blind-prep.mjs`) - параллельно, оба только читают. Есть
  blocker/major у судьи или слепого либо `lint-page` не `pass` - снимок блоков (`fix-diff.mjs <slug> --snap`) и **один
  фиксер** (`mode=full`) по всем находкам страницы: `round-N.json`, `lint-page.json`, `blind.json`. После него
  `fix-diff.mjs` (скрипт, а не самоотчет фиксера): блок, который после правки не прошел линтер, возвращается из снимка, его
  находка снова `open` с причиной; признак правок утверждений - новое или измененное предложение, новое число, закрыта
  находка слепого или категории `fact`. У слепого major - только «не понял» и противоречия первого экрана, вопрос без ответа -
  `needs_fact`; правка по нему только переставляет и уточняет, сужение страницы «для всех» до одного сегмента фиксер
  отклоняет. Повтор фиксер лечит удалением или ссылкой, «другой угол» - только факт брифа, которого еще нет на странице.
- Круг 2 судьи (`scope=fixed`, `prev` - прошлый круг, `diff` - `fix-diff.json`), если после фиксера: остался blocker; оценка
  круга 1 ниже `args.thresholds`, по умолчанию `{"hero_questions":4,"flow":4,"objections_closed":0.9,"blocks_on_question":0.9}`
  (`clonability` круг не назначает); фиксер менял утверждения или сравнивать было не с чем; был откат (`restored`);
  `lint-page` не `pass`. После круга 2 - фиксер `mode=narrow` (только удалить, вернуть условие, подставить формулировку
  факта; minor - в отчет без правки) и снова `fix-diff`. Третьего судьи нет: правки режима сужения и правки без второго
  круга - раздел отчета «Правки без проверки судьей».
- Кросс (раз на прогон, `"skipCross":true` - пропустить): run-агент `dedup.mjs && cross-digest.mjs --empty-report` (label
  `cross-pre`). К суду нечего (0 пар, 0 написанных гео-страниц, 0 утечек) - кросс-судья не зовется, пустой отчет пишет
  скрипт. Иначе кросс-судья с `current` (страницы этого аудита) судит пары-кандидаты (пары «родитель-ребенок» - всегда,
  обязательные формулировки фактов - не повтор) и утечки гео-фактов, пишет `work/audit/cross.json` и раскладывает его
  `split-cross.mjs` по `work/audit/<slug>/cross.json` (прежние копии - в архив `cross-archive-<stamp>.json`). Фиксеры кросса -
  `mode=narrow`, со снимком и `fix-diff`, только страницы этого аудита (`"crossFixAll":true` - все); находки на прочих
  страницах - в возврате `cross_outside` и в отчете. Находки `needs_fact: true` фиксер не получает: это вопросы заказчику.
- В конце один агент: `split-cross --merge` (если кросс-судья был), `render-md` и `lint-page` затронутых страниц (свежий
  `page_sha`).
- Возврат: `judged` (у страницы `diff`, `diff2`, `why2` - причины круга 2, `closed`), `cross`, `crossFixes` (с `diff`),
  `cross_outside`, `blind`. Отчеты: `work/audit/<slug>/round-N.json`, `lint-page.json`, `cross.json`, `blind.json`,
  `fix-diff.json` (журнал проходов фиксеров), `pre-fix/` (снимок, не в git), `work/audit/cross.json`, `dedup.json`,
  `cross-digest.json`.
- Kit обновился посреди фазы 6 (новый порядок фазы, новые роли) - новый запуск wf-06 без `resumeFromRunId`: кэш прежнего
  запуска относится к старому порядку фазы.

`wf-06b` - точечная правка (`--fix`) или повторы после `wf-06`:
```
Workflow wf-06b-fix-repeats.js args={<base>,"slug":"<slug>","findings":["work/audit/<slug>/human-...json"]}
```
Снимок блоков, фиксер (`mode=full`) по `lint-page.json` и `findings`, `fix-diff` (откат сломанного блока), полный круг
судьи `round` (по умолчанию 3, `"skipJudge":true` - без него; `task.mjs args fix` без `--judge` ставит его сам), фиксер по
судье `mode=narrow` с `fix-diff`, сборка одним агентом (Bash, timeout 600000): `render-md <slug>; lint-page <slug>;
[split-cross --merge;] build-html && { check-html; check-site-js; report; }` - после сбоя `build-html` проверки не идут
(итог - хвост вывода в `build` результата: строка `build-html:` - сборка упала).

`fix-diff.mjs <slug> --snap | [--findings f1,f2] [--mode full|narrow] [--snap-id <id>]` (зовут wf-06 и wf-06b): снимок -
`lint-page` и копия блоков в `work/audit/<slug>/pre-fix/`, строка `FIX_SNAP`; сравнение - откат блоков, не прошедших линтер
после правки (и измененных блоков выше нетронутого, который перестал проходить; их находки `fixed` снова `open`, у
`human.fix` - «текст заказчика не прошел линтер», решение человека), признак `claims_changed`, запись прохода в
`fix-diff.json`, строка `FIX_DIFF`.

### Фаза 7. Каталог (если есть)
```
Workflow wf-07-catalog.js args={<base>,"publish":true}
```
Фаза нужна магазину всегда (у магазина-лендинга - одна карточка-пример), сайту «услуги и товары» - при страницах
`category` или `product`, сайту услуг - нет (строка «каталог (фаза 7)» в `task.mjs status`).
Спецификация каталога (`catalog-spec.json`: фильтры с `values_source`, у `range` - `min`, `max`, `step`; необязательные
`categories` - slug листингов, где фильтр выводится (пусто - все; автор заполняет при 3+ листингах),
`values_by_category`, `labels` - подписи чипов писателя для этого фильтра, `field: "price"` у ценового), проверка схемы
(`check:spec`), затем параллельно ТЗ разработчику (запись, `md-to-docx.mjs --check` - `check:tz`, аудит) и примеры товаров
для карточек прототипа (`07-sample-items` -> `work/catalog/sample-items.json`, у каждого товара `source: site | illustrative`;
фото в `work/catalog/samples/`, каждое до 200 КБ, все до 2 МБ). Нет спецификации, она не проходит схему или ТЗ пустое -
ошибка wf-07. Второй круг (открытые blocker/major аудитора): писатель сначала правит спецификацию (фильтры только
добавляет, не переименовывает), затем ТЗ; примеры товаров он ждет (они читают спецификацию); аудитор проставляет статусы
прежним находкам `CT-NN` (`work/audit/catalog-tz.json`, K12). Поле `open` возврата - открытые blocker/major по статусам.
Сбой примеров фазу не валит (поле `samples` возврата). Публикация ТЗ: `md-to-docx.mjs` -> `uploadFile` в папку
`texts_folder_id` (`~/.claude/seo-knowledge/DRIVE.md`), сверка чтением файла, если инструмент нашелся; повтор - старому
документу пометка «(устарело)», ссылка в `publish.json` -> `revisions`. Нет `texts_folder_id` - `publish.json` со
`status: skipped` и путем docx.

### Фаза 8. Сборка
```
node scripts/render-md.mjs; node scripts/build-html.mjs
node scripts/check-html.mjs; node scripts/check-site-js.mjs; node scripts/report.mjs
```
Команды в Bash с `timeout 600000`. Вторая строка - только после кода 0 первой: `build-html` с кодом 1 (строка
`build-html: ...`) нового прототипа не дает, а `check-site-js` и отчет прочли бы прежний файл. Во второй строке `;`: код 1
`check-html` штатный, итог каждой проверки - в отчете. Строка `check-html` «прототип старше данных» - пересобрать.
- `build-html.mjs` - один файл `work/output/prototype.html` в виде сайта (шапка, меню, страницы, подвал, окна; строго ч/б),
  `prototype.index.json` (эталон дословности), `prototype.modules.json` (`{модуль: {on, why, source}}`, в том числе
  `cta_secondary`). Блоки писателя - дословно, в порядке брифа; блок без lint pass - скелет. Модули (каталог, поиск,
  корзина, кабинет, карта, мессенджеры) - только из данных проекта, `config.site.off` выключает модуль. Служебный слой (id
  блоков, вопросы читателя, опорные факты, утверждения без опоры, список страниц) скрыт: клавиша D или `?debug`.
- Кнопки CTA: действие - `action` / `secondary_action` стратега; без них - к блоку-форме или окну заявки. Карточка товара
  без `card_cta` не берет главный CTA страницы с `action` `anchor:` или `page:`. Вторая кнопка без `secondary_action` ищет
  действие по подписи (имя канала из `company.channels`, основа маршрута из `ui.json`) только при старом формате CTA - в
  стратегии и брифах нет ни одного `action`/`secondary_action` (решение Р6, `cta_secondary.legacy_cta` в
  `prototype.modules.json`).
- Любой блок отрисовывается без правки кода: раскладка типа -> раскладка по умолчанию для pattern -> секция по элементам
  (`custom` и неизвестный pattern; у секции `data-custom-name`). **Реестр поведений:** новый живой блок kit (калькулятор,
  квиз и т.п.) - одна запись `REGISTRY['type:<id блока типа>']` (или по pattern) `{ behavior, script?, requires? }` в
  `scripts/site-parts.mjs` + стили в `html/site/site.css`. Живой блок одного проекта - без форка:
  `overrides/html/site/registry.json` (`{ "<pattern | custom_name | type:<id>>": { "behavior": "<имя>" } }`) и
  `overrides/html/site/behaviors/<имя>.js` (выражение `function (root, S) {...}`, рядом необязательный `<имя>.css`); нет
  файлов - поведение kit, ошибка в них - предупреждение сборки и запись пропущена.
- Лендинг (одна рабочая страница): меню нет, якоря - из `config.site.nav`, при пустом - из блоков главной (подпись - `h2`
  блока до 24 знаков или имя из `ui.json` `anchor_names`, не больше 6; на телефоне - строкой под шапкой), кнопки ведут к
  форме. Каталог с панелью фильтров - только на страницах `listing: true` бизнеса не `services`: панель - фильтры категории
  страницы и ее родителей (`categories`), значения и диапазон цены - по карточкам страницы; чип писателя живой, если
  совпадает со значением, именем или подписью (`labels`) фильтра. Элемент `filters` в других блоках - простой список.
- Меню: страница с детьми - отдельный пункт, не в группе типа; главная с адресом вида `/ru` не родитель; панель меню с
  прокруткой, при 24+ ссылках - больше колонок.
- Подписи интерфейса - `html/site/ui.json`; проектная правка - `overrides/html/site/ui.json` только с измененными ключами
  (слияние). Оболочка - `html/site/` (`shell.html`, `site.css`, `icons.svg`), словарь классов раскладок - `html/primitives.css`.
- `check-html.mjs` -> `work/audit/html-check.json`: код 0 - pass, 1 - major/minor (например, `html.block-missing` у
  ненаписанного блока, `html.menu` - рабочая страница без пункта меню, `html.a11y-focus` - кнопка без фокуса с клавиатуры,
  minor `html.chip-dead` - чип без фильтра каталога, со значениями не из фильтра или с описанием после двоеточия),
  2 - blocker. `check-site-js.mjs` (jsdom) ->
  `work/output/prototype.js-check.json` (`{verdict: pass|fail|skip, routes_checked, clicks, errors, skip_reason?, proto_sha,
  file_sha, checked_at}` - по `proto_sha` и `file_sha` видно, какую сборку проверили), код 1 при ошибках.
- `report.mjs` -> `work/output/report.md`: сводка, «Что спросить у заказчика», «Не подтверждено или снято» (с «Факты
  оператора: перенести в анализ» - строками листа ответов анализа `F8NN: <что> = <значение> << <фраза>`), «Спорное: решения
  агента», «Предупреждения сборки брифов», «Повторы между страницами», «Major, закрытые фиксером без правки», «Правки без
  проверки судьей», «Проверки прототипа», «Интерфейс прототипа», «Каталог» (открытые находки аудита ТЗ по статусам и
  число вопросов раздела 8 ТЗ), «По страницам». Строка «Прототип» сводки - «устарело, пересобрать», если данные изменились
  после сборки или `check-site-js` проверял другую сборку. Последняя строка вывода - итог: страниц, готово, блоков P/T,
  скелетов, exhausted, вопросов заказчику, правок без проверки судьей K (с проходами без сравнения), проверки прототипа.
Результат: `work/output/prototype.html`, `work/output/report.md`, ссылка на ТЗ в `work/catalog/publish.json`.

### Ретро (после проекта)
```
Workflow wf-T2-retro.js args={<base>,"template":"<путь к шаблону>"}
```
Агент сам запускает `node scripts/retro-stats.mjs` (`work/audit/retro-stats.json`; `"skipStats":true` - уже посчитано) и пишет
`work/output/retro.md` и `retro.json`. Принятые предложения вносятся сначала в kit шаблона, затем в проекты -
`/sync-from-template` (или `/sync-all`) и `task.mjs place` задачи (подготовка, «Обновление kit»).

## Остановки
Ручная пауза и автостоп хранятся в `meta.json` задачи (`stop`, `autostop`) и ставятся командой скила `task.mjs stop`.
Условия автостопов, откуда их видно и что делать после снятия - одна таблица «Автостопы» в SKILL.md скила; здесь она не
повторяется. Данные для проверок дают скрипты и воркфлоу kit: `scripts/progress.mjs` (волны, дописанные и exhausted блоки;
в скиле - `task.mjs status`), возврат wf-04 (`briefs_problems`), wf-05 (`failed[].no_answer`), коды `build-html`,
`check-html`, `check-site-js` и ошибки воркфлоу (ниже).

## Если что-то упало
- Воркфлоу, сбой среды (529, 503, rate_limit, таймаут, прерванная сессия): перезапуск с `resumeFromRunId` и теми же `args` -
  завершенные агенты берутся из кэша. Смена `model`, `model_light` или `models` в `args` меняет модель части агентов: с
  первого такого агента прогон идет заново.
- Воркфлоу, отказ агента (ошибка «... не удался», «... не отработал»: агент вернул `ok: false`): с `resumeFromRunId`
  отказ вернется из кэша - новый запуск без него (фаза 0 без повторного дампа и снимка: `skipDump`, `skipSnapshot`). Так же
  wf-07 без спецификации или ТЗ («не проходит схему», «ТЗ пустое»); wf-04 `update` без `facts_diff` - сначала
  `node scripts/import-project.mjs --facts-only`, затем новый запуск.
- Фаза 2, «нет доступных конкурентов: ...» - сбой среды (сеть, MCP, браузер): новый запуск wf-02 без `resumeFromRunId`
  (ответ верификатора в кэше, повтор из кэша вернет ту же ошибку); деградация без конкурентов - штатный исход, не
  ошибка.
- Фазы 5-6: заново `plan-run` и запуск - готовые блоки не переписываются, свежий аудит не повторяется. Kit обновлен
  посреди фазы 6 - без `resumeFromRunId` (фаза 6, выше).
- Фаза 0, `project`: код 2 у импорта - гейт не согласован или нет входного файла; код 1 - выход не прошел схему или регулярки
  антиобещаний не прошли проверку (`work/import-report.json`); код 3 у `--facts-only` - `facts.json` правили руками.
- Фаза 4: `merge-strategy` с кодом 1 - проблемы в файлах типов, проверка `node scripts/merge-strategy.mjs --check work/strategy.pages/<type>.json`.
- Блок exhausted: `work/audit/<slug>/lint-<block>.json`; чаще всего цифра без факта или CTA не по брифу. Решение - править
  бриф или стратегию (`build-briefs.mjs --force <slug>` при смене состава блоков), а не ослаблять линтер: новый срез
  снова отдает блок писателю.
- Прототип: `build-html` код 1 - строка `build-html: ...` (причина), прототипа этого запуска нет; `check-html` код 2 -
  `work/audit/html-check.json` (blocker); `check-site-js` fail - `work/output/prototype.js-check.json` (`errors`: маршрут,
  вид, деталь); SKIP - нет `jsdom` в проекте.
