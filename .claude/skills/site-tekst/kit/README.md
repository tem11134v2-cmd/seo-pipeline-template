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

`workflows/` - 11 воркфлоу, `prompts/` - 34 промта, `scripts/` - 39 скриптов (из них модули без CLI: `lib`, `lint-common`,
`render-analysis`, `contacts`, `deps`, `progress`, `render-blocks`, `site-parts`), `schemas/` - 21 схема, тесты - `.claude/tests/site-tekst/`
шаблона, `rules/` - ролевые инструкции и правила линтера, `config/` - профиль проекта и house style, `html/` - оболочка
прототипа-сайта (`html/site/`: `shell.html`, `site.css`, `ui.json` - словарь подписей интерфейса, `icons.svg`) и словарь
классов раскладок `primitives.css`, `examples/` - дымовые данные (`smoke-fixtures/` - магазин, `fixture-services/`,
`fixture-landing/`, `fixture-shop/`) и `lint-niche-markers.example.json` (нишевые основы линтера для overrides проекта).

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
7. Прогон без гейтов: решения по проекту - агент фазы 0, стратегию проверяет рецензия, волна 1 (главная и образец
   каждого типа) идет раньше тиража, вопросы заказчику копятся в отчете. Остановка - ручная пауза или автостоп по
   аномалии (`docs/RUNBOOK.md`, «Остановки»). Любой этап возобновляем: состояние только в файлах.
8. Один прототип - сайт из данных проекта: модуля без данных в файле нет, ниша - только в `overrides/` проекта.

## Фазы

| Фаза | Что происходит | Кто | Выход |
|---|---|---|---|
| T1 (один раз при сборке шаблона) | Дистилляция файла правил в ролевые инструкции + слепая сверка | `wf-T1-distill-rules.js` | `rules/hero.md`, `conversion.md`, `info.md`, `auditor.md`, `offer-formulas.md`, `lint.json` |
| 0 | `source: doc` - дамп Google Doc, паспорт фактов, слепая сверка, снимок контактов, структура. `source: project` - импорт `project.json` анализа скриптом (после гейта анализа; контакты - служебные факты F901-F907), регулярки антиобещаний, снимок сайта только по пустым контактам. Затем составитель решений (`rules/decisions.md` v2) и обогащение карты | `wf-00-facts.js`, `import-project.mjs` | `work/facts.json`, `audience.json`, `sitemap.json`, `rules/decisions.md`, `inputs/analysis.md`; в режиме `project` еще `client-preferences.json`, `directions.json`, `competitors/seed.json`, `import-report.json` |
| 2 | Верификация конкурентов, фетч со статусами, классификация страниц (у лендинга не нужна), браузерный добор по одному конкуренту, замер блоков, пакетный разбор снимков (до 4 снимков домена на вызов), агрегация по типам (мелкие типы пакетом; все лидеры недоступны - типы по анализу, `degraded: no_competitors`), анализ каталогов | `wf-02-competitors.js` + `prep-args.mjs` | `work/competitors/*`, `work/page-types/<type>.json`, `work/catalog/competitor-catalogs.md` |
| 3 | Аудит файлов типов страниц по снимкам (мелкие типы пакетом), исправление, повторный аудит | `wf-03-audit-types.js` | исправленные `page-types/*.json`, `work/audit/types/*.json` |
| 4 | Глобальный стратег, стратеги типов параллельно (формулы, CTA, матрица дифференциации, факты и возражения по блокам), сборка стратегии и брифов скриптами, рецензия стратегии и повторная сборка, HTML-шаблоны по типам параллельно; после ответов заказчика - режим обновления (`update`: записи переносятся, правка только по `facts_diff`; `enrich`: обогатитель карты `mode=facts` со сверкой карты) | `wf-04-strategy-layouts.js` + `merge-strategy.mjs`, `build-briefs.mjs` | `work/strategy.pages/<type>.json`, `work/strategy.json`, `work/pages/<slug>/brief.json` и `brief/<block_id>.json`, `work/briefs-report.json`, `work/audit/strategy-review.json`, `work/layouts/<type>.html` |
| 5 | Волны по карте. Первый экран: турнир для главной, хабов и первой страницы типов `service` и `category` (3 писателя -> 2 судьи -> селектор, вложенный `wf-05b`), иначе писатель + селектор. Затем блоки по очереди, линтер после каждого; блок, не прошедший линтер, страницу не останавливает | `wf-05-write.js` (args: вывод `plan-run.mjs`) | `work/pages/<slug>/blocks/*.json`, `state.json`, `state.writer.json`, `page.md` |
| 6 | Судья страницы (сам запускает `lint-page`) и слепой читатель по выборке параллельно, один фиксер по всем находкам страницы, `fix-diff` (откат сломанного блока, признак правок утверждений), второй круг судьи по порогу оценок, blocker, правкам утверждений и откату, фиксер сужения; кросс-судья по парам `dedup` и гео-близнецам, только когда есть что сравнивать (архивы прежних отчетов), фиксеры кросса в режиме сужения. `wf-06b` - точечная правка и сборка | `wf-06-audit.js`, `fix-diff.mjs` | `work/audit/<slug>/round-N.json`, `lint-page.json`, `cross.json`, `blind.json`, `fix-diff.json`, `work/audit/cross.json` |
| 7 | Каталог: спецификация (фильтры по категориям, подписи чипов), примеры товаров для карточек, ТЗ разработчику, аудит ТЗ со статусами находок, второй круг - спецификация, затем ТЗ, публикация docx в Google Doc | `wf-07-catalog.js` | `work/catalog/catalog-spec.json`, `sample-items.json`, `tz.md`, `tz.docx`, `publish.json` |
| 8 | Сборка прототипа-сайта, проверки дословности и скриптов, отчет | `render-md.mjs`, `build-html.mjs`, `check-html.mjs`, `check-site-js.mjs`, `report.mjs` | `work/output/prototype.html`, `prototype.modules.json`, `prototype.js-check.json`, `report.md` |
| T2 (после проекта) | Ретро: статистика находок аудита скриптом, предложения правок шаблона | `wf-T2-retro.js` + `retro-stats.mjs` | `work/audit/retro-stats.json`, `work/output/retro.md`, `retro.json` |

Порядок запуска и точные `args` - `docs/RUNBOOK.md`.

## Контракты (схемы в `schemas/`)

- `facts.json` - паспорт фактов, антиобещания, терминология, контакты компании (`company`, служебные факты F901-F907,
  `company.absent` - поля, которые заказчик убрал в d10; факты оператора F801-F899 из правок заказчика).
- `audience.json` - сегменты ЦА с возражениями (id вида `O1`) и словарем слов клиента.
- `sitemap.json` - карта страниц: slug, url (путь), parent, тип из закрытого списка, предмет, сегмент (`all` + `segments`),
  покрытие фактами, набор блоков (full/short), статус; `ui_role` (search, cart, account, legal), `nav_label`, `listing`,
  `template`, `key_phrase` (маркер структуры с регионом). Волн в карте нет: их считает `scripts/progress.mjs`.
- `rules/decisions.md` - решения проекта, формат v2 (маркер в первой строке): §1 конфликты фактов и «Где можно» (`все`,
  `нигде`, slug и type, «все, кроме ...»), §6 периметр и наборы блоков, §8 «Спорное: решения агента». Заполняет составитель
  фазы 0.
- `page-types/<type>.json` - блоки рынка и блоки отстройки для типа страницы: элементы, объемы по замерам, паттерн раскладки, дословные примеры конкурентов, клише.
- `strategy.pages/<type>.json` - решения стратега типа по страницам (`block_overrides`, `exclude_blocks`, CTA-объект,
  споры - `disputes`); `strategy.json` - глобальные решения и сборка страниц (`merge-strategy.mjs`).
- `pages/<slug>/brief.json` - бриф страницы: сегмент, возражения, факты, CTA, `key_phrase`, список блоков с ролями, вопросами читателя и лимитами. Его читают линтер, судья и фиксер.
- `pages/<slug>/brief/<block_id>.json` - срез брифа на блок, единственный бриф писателя (`brief-slice`).
- `pages/<slug>/blocks/<block_id>.json` - выход писателя: элементы блока с текстами и ссылками на факты, `attempts` и
  `brief_sha` (счетчик запусков по срезу брифа), `needs_fact` (чего не хватило).
- `briefs-report.json` - итог сборки брифов по страницам (выпавшие блоки, снятые факты, `structure_changed`), вопросы,
  предупреждения.
- `pages/<slug>/state.json` - состояние страницы для судьи и фиксера, `state.writer.json` - компактное для следующего писателя.
- `audit/**.json` - находки аудиторов и линтера в едином формате `findings`; `audit/<slug>/fix-diff.json` - журнал проходов
  фиксеров (откаты, правки утверждений, проверен ли проход судьей).
- `catalog/catalog-spec.json` - спецификация каталога для ТЗ и для каталога прототипа (у фильтра необязательные
  `categories`, `values_by_category`, `labels`, `field: "price"`); `catalog/sample-items.json` - примеры товаров для
  карточек (с пометкой «пример»).
- `output/prototype.html` - прототип-сайт одним файлом; `prototype.index.json` (эталон дословности), `prototype.modules.json`
  (модули и почему), `prototype.js-check.json` (проверка скриптов).
- `layouts/<type>.html` - HTML-шаблон блоков типа страницы (без текста, только раскладка и слоты).
- Режим `project`: `client-preferences.json`, `directions.json`, `competitors/seed.json`, `import-report.json` (`facts_diff`,
  `analysis_fingerprint`), `anti-promises.patterns.json`.
- `overrides/` задачи - правки проекта поверх kit: `.json` - слияние по ключам, `.md` с `<!-- overrides:append -->` -
  дописка, прочее - замена; `html/site/registry.json` и `html/site/behaviors/` - живые блоки проекта.
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
| `sync-from-template.mjs <шаблон>` | только автономная копия вне шаблона SEO: обновить логику из шаблона, не трогая `work/`, `inputs/`, `config/`, `rules/decisions.md`. В папку задачи `/site-tekst` не кладется, там отказывает (код 2): kit обновляют `/sync-from-template` и `task.mjs place` |
| `serve.mjs [--dir --port]` | локальный просмотр прототипа в браузере; порт занят - код 2 |
| `validate.mjs <schema> <file>` | проверка JSON по схеме |
| `normalize.mjs <file...>` | буква е с точками -> е, длинные тире -> «-», в текстах и инструкциях |
| `import-project.mjs [--project --facts-src --queue --structure --allow-ungated]` | фаза 0 режима `project`: импорт контракта анализа во входы текстов, только после гейта анализа; связь возражений с фактами - `objection[].facts` контракта (эвристика - только у старого контракта без поля); служебная пометка вместо факта - правило `SERVICE_NOTE` анализа (`serviceNoteRule` в `lib.mjs`); решения гейта d1-d10 (d9 - состав страниц, d10 - контакты и реквизиты) - в `work/import-report.json` и `inputs/analysis.md`; контакты - `company` и служебные факты F901-F907; `--apply-patterns <file>` - проверка и перенос регулярок антиобещаний; `--facts-only [--force]` - правка анализа посреди прогона (только факты, код 3 - `facts.json` правили руками, `facts_diff`, `other_changed` по отпечатку анализа `analysis_fingerprint`); `--company-facts` - контактные факты из `company` после снимка сайта; поля, убранные заказчиком в d10, - `company.absent`, каналы старого сайта - вопросом в `gaps`; факт оператора F8xx, перенесенный в анализ (`moved_from`), снимается |
| `render-analysis.mjs` | модуль `import-project`: `inputs/analysis.md` из контракта с фиксированными заголовками (их грепают промты фаз 2, 3, 7) |
| `import-structure.mjs [--src ...] [--check-enrich before\|after]` | импорт готовой структуры в `sitemap.json`: адреса - пути, дубли в `sitemap.skipped.json`, `ui_role: legal`, `template`, `listing`, маркер - `key_phrase`; волн нет. `--check-enrich` - сверка карты вокруг обогатителя `mode=facts` (wf-04): 0 - ок, 3 - лишняя правка, карта возвращена из копии, 2 - нет карты или копии |
| `fetch-page.mjs <url> <out.json> [--text-from <file.md>]`, `--dom-snippet` | снимок страницы: html, текст по секциям заголовков, ссылки, `footer_text`, `final_url`; статус ok (`flat` - мало заголовков) / js_only (текста меньше 1500 знаков, пустая SPA) / antibot (401/403/429/498/503, страница проверки) / closed (HTTP >= 400) / error (сеть, таймаут) / browser; повтор через 4 с (`FETCH_PAGE_RETRY_MS`), запасной путь curl (`via: curl`), кодировка из Content-Type или meta; `--dom-snippet` - код обхода DOM для браузера, `--text-from` - снимок из браузерного текста (`verbatim` по отметке обхода) |
| `measure-blocks.mjs [--if-stale]` | замер символов по секциям всех снимков -> `measurements.csv` |
| `prep-args.mjs [--types a,b] [--snapshots ...]`, `--check-degraded` | `args` фаз 2-4: `types`, `type_pages` (по нему мелкие типы идут пакетом), `info_other` (названия инфо-страниц карты), снимки для `skipInventory`; `--check-degraded` - подтверждение разбора без конкурентов (все кандидаты ответили, но недоступны) |
| `merge-strategy.mjs [--check <file...>] [--matrix] [--split]` | сборка `strategy.json` из `strategy.pages/<type>.json`; `--check` - проверка файла типа (факты, блоки, сегменты, возражения, отрицания, действия CTA; предупреждение - главная кнопка страницы с выдачей без `action`); `--matrix` - таблица для рецензии и близнецы (`work/audit/strategy-matrix.md`); `--split` - перевод старого проекта |
| `build-briefs.mjs [slug...] [--force]` | сборка брифов страниц и срезов для писателей, `work/briefs-report.json`; смена состава блоков на написанной странице - только с `--force` (перенумерация блоков с их lint-файлами); страховки фактов («нигде», «не публикуем», конфликт без строки §1, числа формулировки §1), `key_phrase`, заметки для рецензии строками « ~ » |
| `writer-inputs.mjs [slug...]` | срезы брифа на блок; модуль `build-briefs`, `page-state`, `plan-run`, CLI - ручная пересборка |
| `lint.mjs <block.json> [--fix] [--page]` | линтер блока: house style, стоп-слова, цифры без фактов, CTA, длины, антиобещания, жаргон, формы `ai.*` и `style.*`, бюджеты страницы по блокам выше; маска имен (предмет, `key_phrase`, компания, предметы ссылок); повтор фраз - в обе стороны, с `--page` (из `lint-page`) - только с блоками выше |
| `lint-page.mjs <slug> [--fix]` | линтер страницы: все блоки, бюджеты страницы (`ai.contrast`, `ai.neg-pitch`, `word.overuse`, плейсхолдеры) в порядке блоков; `page_sha` - свежесть аудита |
| `lint-common.mjs` | модуль: общие проверки `lint` и `lint-page`, правила - `rules/lint.json` |
| `page-state.mjs <slug> [<block_id>]` | `state.json` и `state.writer.json` (для следующего блока: только прошедшие блоки выше), обновление устаревших срезов брифа |
| `render-md.mjs [slug...]` | md страницы из блоков |
| `renumber-blocks.mjs <slug>` | перенумерация файлов блоков под текущий бриф, выпавшие блоки -> `_old/` |
| `plan-run.mjs [--wave --slugs --types --phase write\|audit --hero --tournament-types --sample-per-type]` | незавершенные страницы и блоки для `args` фаз 5-6 (волны по карте, exhausted-блоки не отдаются), режим первого экрана; в фазе `audit` - дописанные страницы, свежесть аудита и `sample` для слепого читателя (первые по карте N страниц каждого типа, по умолчанию 1) |
| `progress.mjs` | модуль: статусы блоков и страниц (pass, exhausted, дописано, готово), волны по карте; один для `plan-run`, `report`, `task.mjs status` |
| `dedup.mjs` | повторы между страницами и внутри страницы, пары-кандидаты и гео-близнецы для кросс-судьи |
| `cross-digest.mjs [--max-pairs 60] [--empty-report]` | выжимка для кросс-судьи по парам `dedup` -> `work/audit/cross-digest.json`; строка `CROSS_DIGEST`; к суду нечего с `--empty-report` - пустой отчет кросса |
| `fix-diff.mjs <slug> --snap`, `fix-diff.mjs <slug> [--findings ...] [--mode full\|narrow] [--snap-id <id>]` | фаза 6: снимок блоков до фиксера и сравнение после: откат блока, не прошедшего линтер после правки (находка снова open), признак правок утверждений, журнал `work/audit/<slug>/fix-diff.json` |
| `split-cross.mjs [--merge]` | находки кросс-судьи по страницам в `work/audit/<slug>/cross.json` (прежние - в `cross-archive-<stamp>.json`); `--merge` - статусы обратно в общий файл |
| `blind-prep.mjs <slug>` | вход слепого читателя: портрет сегмента, первые экраны конкурентов, `work/audit/<slug>/blind-view.md` |
| `validate-layout.mjs <type...>` | проверка HTML-шаблона типа страницы |
| `build-html.mjs` | сборка прототипа-сайта одним файлом (+ `prototype.index.json`, `prototype.modules.json`); служебный слой - клавиша D или `?debug` |
| `render-blocks.mjs` | модуль: движок блоков (раскладка типа -> раскладка по умолчанию -> секция по элементам), скелеты ненаписанных блоков |
| `site-parts.mjs` | модуль: оболочка и модули из данных (меню, шапка, подвал, каталог с панелью фильтров по категориям, поиск, корзина, кабинет), реестр поведений `REGISTRY` и реестр проекта (`html/site/registry.json`, `behaviors/`) |
| `check-html.mjs` | проверка прототипа: дословность блоков, h1, серые цвета, ресурсы, мертвые кнопки, пункт меню у каждой рабочей страницы (`html.menu`), фокус кнопок (`html.a11y-focus`), неживые чипы фильтров (`html.chip-dead`); код 0 / 1 (major, minor) / 2 (blocker) |
| `check-site-js.mjs` | скрипты прототипа в jsdom: маршруты, клики, окна -> `prototype.js-check.json` (`proto_sha`, `file_sha` проверенной сборки); нет jsdom - SKIP |
| `report.mjs` | итоговый отчет: сводка, «Что спросить у заказчика», факты оператора строками листа ответов анализа, спорное, повторы, правки без проверки судьей, проверки прототипа, каталог (открытые находки ТЗ) |
| `contacts.mjs` | модуль: формат телефонов, ссылки tel: и мессенджеров, `company.channels` |
| `md-to-docx.mjs <in.md> <out.docx>`, `--check <tz.md>` | docx для загрузки в Drive с конвертацией (публикация ТЗ каталога); `--check` - разделы ТЗ и служебные ссылки без пакетов |
| `deps.mjs` | модуль: поиск npm-пакетов (`jsdom`, `docx`, `marked`) в `node_modules` проекта |
| `retro-stats.mjs` | статистика находок аудита для ретро -> `work/audit/retro-stats.json` |
| `lib.mjs` | модуль: общие функции скриптов |

## Промты (`prompts/`)

Один файл на роль. Каждый промт начинается с блока «Что читать» и «Что не читать»,
заканчивается «Формат результата». Промты не содержат данных проекта: все проектное
подставляется путями к файлам `work/`.

## Тесты

Набор `.claude/tests/site-tekst/run.mjs` шаблона SEO: раздел 1 запускает `lint-cases.mjs`, `scripts-cases.mjs`,
`workflow-models.mjs` (роли и label вызовов против таблицы RUNBOOK) и все `cases-<тема>.mjs` (брифы, промты, импорт,
лидеры и типы, аудит фазы 6, прототип и фикстуры, каталог, поток и строки автостопов SKILL.md, стыки пакетов); разделы
2-7 - папка задачи, холостой прогон, `.gitignore`, FAQ, worktree, синк.
Отдельные файлы:

`node .claude/tests/site-tekst/lint-cases.mjs` из корня шаблона SEO, код выхода 0 - все прошли (155 проверок): табличные случаи `lint-common`,
бюджеты страницы через `lint.mjs` и `lint-page.mjs` на синтетической странице, регрессия на `examples/smoke-fixtures`.
`node .claude/tests/site-tekst/scripts-cases.mjs` из корня шаблона SEO, код выхода 0 - все прошли (223 проверки): остальные скрипты как CLI во временных папках
на `examples/smoke-fixtures` и синтетических данных - `init-project`, `build-briefs` + `writer-inputs` (срезы по схеме, факты из текста задания),
`blind-prep`, `page-state`, `plan-run` (`hero_mode`, `sample`), `merge-strategy` (`--split` и сборка обратно, `--check`), `prep-args`,
`dedup` + `cross-digest` (гео-близнецы, утечки гео-фактов), `split-cross` (статусы фиксера, `--merge`), `retro-stats` (пустая и битая папка,
копии `split_from`), `import-project` + `render-analysis` (синтетический `project.json`, гейт, `--allow-ungated`, `--apply-patterns`, `--structure`,
`objection[].facts`, решение d9, правило `SERVICE_NOTE` из `_contract.mjs` анализа и его копия в kit),
схема конфига без `sources.mode`. Синтетический `project.json` сверяется со схемой анализа site-analiz, если она есть на машине.
Цепочка скриптов вручную на тех же фикстурах - `examples/smoke-fixtures/README.md`.
