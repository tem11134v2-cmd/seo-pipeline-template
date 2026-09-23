---
name: site-tekst
description: Конверсионные тексты сайта по алгоритму v9 (kit в kit/ - воркфлоу, промты, скрипты, правила). Импорт анализа sites/NNN после его гейта (и структуры structures/MMM или планировщика анализа), разбор лидеров, типы страниц, стратегия и раскладки, пилот, волны, аудит, прототип одним файлом. Папка задачи texts/NNN-<slug>/ (format v9); копию kit в нее кладет скрипт при старте и --resume, в git она не идет. Аргументы - --site <NNN> [--structure <MMM>] | --doc <id> --slug <slug>, [--pilot a,b], [--wave N], [--fix <slug> "<правка>"], [--resume [NNN]].
---

# site-tekst (v9)

Скил-оркестратор: тексты коммерческих страниц сайта уровня лидеров ниши и прототип одним html. Запускается
**в worktree-сессии**. Весь алгоритм - `kit/` (бывший test-text-template): 11 воркфлоу, 32 промта, 31 скрипт, схемы,
правила. Скил только ведет задачу: папка, копия kit, args воркфлоу, гейты, resume, сдача.

```
/site-analiz -> sites/NNN-<slug>/project.json (гейт заказчика)
   '-- SEO куплено: /seo-struktura -> structures/MMM-<slug>/structure_data.json (гейт заказчика)
/site-tekst --site NNN [--structure MMM] -> texts/KKK-<slug>/
/seo-faq --from-tekst KKK   /seo-metategi --from-structure MMM
```

Порядок фаз, смысл каждого воркфлоу и что проверять после него - `kit/docs/RUNBOOK.md`. Этот файл говорит, КАК
скил их запускает. Уроки прогонов - `kit/docs/LESSONS.md` (читать при разборе сбоя, не каждый раз).

## Аргументы

```
/site-tekst --site <NNN> [--structure <MMM>] [--allow-ungated] [--pilot <slug,...>]
/site-tekst --doc <google doc id> --slug <slug> [--structure <MMM>] [--pilot <slug,...>]
/site-tekst [<KKK>] --resume | --wave <N> | --fix <slug> "<правка>"
```
- `--site <NNN>` - основной вход: `sites/NNN-*/project.json` (факты, ЦА, пожелания d1-d5, профиль ниши, затравка
  конкурентов). Импорт скриптом в фазе 0 и только после гейта анализа (`queue.json` -> `gate.approved`).
- `--structure <MMM>` - структура SEO `structures/MMM-*/structure_data.json`. Без флага берется структура анализа
  без SEO `sites/NNN-*/structure_data.json`, если есть; нет ни той, ни другой - фаза 0 строит карту резервным агентом
  (`structureMode: fallback`), это надо сказать человеку до старта.
- `--doc <id>` - запасной вход: анализ в Google Doc (режим `doc` kit: дамп, извлечение фактов, слепая сверка).
  Нужен `--slug`. Поля конфига (компания, сайт, профиль ниши, `key_phrases`, стоп-лист агрегаторов) оркестратор
  заполняет в `config/project.json` задачи до фазы 0 - из `ЗАКАЗЧИК.md` или вопросом человеку.
- `--allow-ungated` - пилот до гейта анализа. Только явным флагом: у фактов `publish: no`, страницы уйдут в короткий
  набор. Пишется в `meta.json` (`allow_ungated`), `args facts` передает его сам.
- `--pilot <slug,...>` - страницы пилота. Без флага - предложение из `task.mjs status` (главная + одна категория),
  человек подтверждает на гейте 2.
- `--wave <N>` - прогнать одну волну (запись + аудит + сборка) и остановиться. До гейта волны 1 - только `1`.
- `--fix <slug> "<правка>"` - точечная правка готовой страницы по находке человека (шаг 9).
- `--resume [KKK]` - продолжить по `meta.json.state`. Без номера - `task.mjs find` (незавершенные v9).

## Папка задачи

```
texts/KKK-<slug>/                         данные задачи - в git
├── meta.json                             state, format "v9", site, structure, source, pilot, wave, allow_ungated
├── config/project.json                   профиль проекта; sources.* пересчитывает task.mjs place от ссылок meta
├── rules/decisions.md                    решения проекта (гейт 1, стратег фазы 4 дописывает)
├── overrides/<путь kit>                  проектные правки файлов kit (rules/lint.json и т.п.), ложатся поверх копии
├── inputs/                               structure_data.json, analysis.md (рендер импорта), пожелания
└── work/                                 facts, audience, sitemap, конкуренты, типы, стратегия, страницы, аудит, output/
    копия kit - НЕ в git (.gitignore):    CLAUDE.md, workflows/, prompts/, scripts/, schemas/, html/,
                                          rules/* кроме decisions.md, config/house_style.md, .kit.json (манифест)
```

Копия kit - кеш, как `_index.json`: `task.mjs place` кладет ее при каждом старте и `--resume`, поэтому исправления
kit в шаблоне доходят и до задач, начатых раньше. `texts/KKK/CLAUDE.md` - правила агентов kit, оркестратору они
не адресованы.

Правка файла копии на месте (например `rules/lint.json` на гейте пилота) освежение затерло бы - поэтому `place`
сверяет хеши с `.kit.json` и при расхождении выходит с кодом 3 и списком. Что делать - спросить человека одним
вопросом: правка проекта -> перенести файл в `overrides/<тот же путь>` (коммитится, ложится поверх kit всегда);
правка алгоритма -> в `.claude/skills/site-tekst/kit/` шаблона (main-копия шаблона, не этот проект);
выбросить -> `place --force`.

## Скрипт задачи

`task.mjs` (без LLM, запуск из корня проекта, `.claude\scripts\_node.cmd .claude\skills\site-tekst\task.mjs ...`):

| Команда | Что делает |
|---|---|
| `plan --site N [--structure M] \| --doc <id> --slug s` | номер KKK (max+1 по всем `texts/*`, и v7, и v9), slug, ссылки, `gate_approved`; ничего не пишет |
| `init --task texts/KKK-s <флаги plan> [--allow-ungated]` | папка, `meta.json`, `config/project.json`, `rules/decisions.md`, копия kit |
| `place <KKK>` | освежить копию kit (+ overrides), пересчитать `sources` конфига; код 3 - правки на месте |
| `args <KKK> <вид> [флаги]` | одна строка JSON для `args` воркфлоу; код 4 - делать нечего |
| `status <KKK>` | сводка до 15 строк: state, факты, карта, волны (брифы/написано/аудит), каталог, пилот, прототип |
| `preview <KKK>` | конфиг `site-tekst-KKK` в `.claude/launch.json` (serve.mjs kit, не в git) |
| `find [KKK]` | папка задачи и state; без номера - все незавершенные v9 |

Виды `args`: `facts` (wf-00), `types` (wf-02/03/04, вывод `prep-args` + `catalog`), `write` (wf-05,
`--wave N` / `--slugs a,b`, `--concurrency`), `audit` (wf-06, только страницы без `round-N.json`, `--all` - все),
`fix` (wf-06b, `--slug`, `--findings`, `--judge`), `hero` (wf-05b, `--slug`, `--block`), `catalog` (wf-07). `--extra '<json>'` добавляет поля
(`{"skipDump":true}`, `{"skipCross":true}` и т.п. из RUNBOOK). В каждом `args`: `root` - абсолютный путь папки задачи
в этой worktree, `model` - `opus` (роли `strong`), `model_light` - `sonnet` (роли `light`). При необходимости оркестратор
добавляет `models` - точечную замену модели роли: `--extra '{"models":{"extract":"sonnet"}}'` (роли и умолчания -
`kit/docs/RUNBOOK.md`, «Модели по ролям»).

## Запуск воркфлоу

```
Workflow  scriptPath = <root>/workflows/<wf-...>.js   args = <строка JSON из task.mjs args, как есть, объектом>
```
- `scriptPath` - из копии kit в папке задачи (вложенный `wf-05b` берется оттуда же, от `root`).
- Результат воркфлоу - короткий объект; из него в чат 1-3 строки. Большие файлы `work/` оркестратор не читает:
  для решений - `task.mjs status`, коды выхода скриптов, точечные поля (`node -e` по одному полю).
- Упал или прерван - повтор с `resumeFromRunId` и теми же `args` (готовые агенты из кэша). runId записать в meta:
  `bash .claude/hooks/update-meta.sh <task> <тот же state> last_run=<runId>`.
- Expected-маркеры не ставить: агенты воркфлоу - веера, свои выходы они проверяют скриптами kit. Перед запуском в
  `.claude/tmp/` не должно быть чужих `expected-*.txt` (узкий фолбэк `check-file.sh` примерит единственный маркер
  к агентам воркфлоу).
- 529/503/rate_limit на воркфлоу - пауза 90 сек и `resumeFromRunId`, до 3 попыток.

## State machine

```
init -> facts-done -> [гейт 1] map-approved -> competitors-done -> types-audited -> strategy-done
     -> [гейт 2] strategy-approved -> pilot-done -> [гейт 3] pilot-approved -> wave-1-done
     -> [гейт 4] wave-1-approved -> waves-done -> catalog-done -> built -> completed
```
Источник истины - `meta.json`, переходы только `bash .claude/hooks/update-meta.sh <task> <state> [k=v]`.

| state | действие | как |
|---|---|---|
| `init` | фаза 0: факты, аудитория, карта | `args facts` -> `wf-00-facts.js` -> `facts-done` |
| `facts-done` | гейт 1: карта и решения | шаг 3 |
| `map-approved` | фаза 2: конкуренты, разбор лидеров | `args types` -> `wf-02-competitors.js` -> `competitors-done` |
| `competitors-done` | фаза 3: аудит типов | `args types` -> `wf-03-audit-types.js` -> `types-audited` |
| `types-audited` | фаза 4: стратегия, брифы, раскладки | `args types` -> `wf-04-strategy-layouts.js` -> `strategy-done` |
| `strategy-done` | гейт 2: стратегия и раскладки | шаг 5 |
| `strategy-approved` | пилот | шаг 6 -> `pilot-done` |
| `pilot-done` | гейт 3: пилот | шаг 6 |
| `pilot-approved` | волна 1 | шаг 7 -> `wave-1-done` |
| `wave-1-done` | гейт 4: волна 1 | шаг 7 |
| `wave-1-approved` | волны 2..N | шаг 7 -> `waves-done` |
| `waves-done` | фаза 7: каталог | `args catalog` -> `wf-07-catalog.js` -> `catalog-done` |
| `catalog-done` | фаза 8: сборка | шаг 8 -> `built` |
| `built` | сдача | шаг 8 -> `completed` |

**Resume:** `task.mjs find [KKK]` -> `meta.json` -> `format` не `v9` - стоп: «задача v7: конвейер v7 выведен, режима
доделки нет - новая задача /site-tekst (FAQ по старой задаче - /seo-faq --from-tekst)». Иначе `current-task.txt`, `place` (код 3 - вопрос из «Папка задачи»),
`status`, вопрос «продолжить с <state>? [Y/n]», дальше по таблице. Гейтовые state (`facts-done`, `strategy-done`,
`pilot-done`, `wave-1-done`) - показать гейт заново, закрытое не переспрашивать. `args` с кодом 4 - шаг сделан, дальше.

## Шаги

### 0. Старт

1. Worktree: `git rev-parse --git-dir` == `git rev-parse --git-common-dir` -> это main: предупредить, не блокировать.
2. `task.mjs plan <флаги>` -> `task_dir`, `structure`, `gate_approved`. Код 2 - нет входа: стоп с подсказкой
   (`/site-analiz`, `/seo-struktura`). `gate_approved: false` без `--allow-ungated` - стоп: «анализ NNN не согласован
   (queue.mjs gate); пилот до гейта - только --allow-ungated». `structure` пуст - предупредить про резервную карту.
3. **Первым делом** `.claude/tmp/current-task.txt` = `<task_dir>/` (без этого pre-commit откажет).
4. `task.mjs init --task <task_dir> <флаги>` -> `bash .claude/hooks/update-meta.sh <task_dir> init`
   (+ `pilot=<slugs>`, если задан `--pilot`).
5. Режим `doc`: заполнить поля `config/project.json` (см. «Аргументы»). Режим `project` - ничего, это делает импорт.

### 1. Фаза 0 (state `init`)

`args facts` -> `wf-00-facts.js`. Импорт с кодом 2 - гейт анализа не согласован или нет входа (стоп, вопрос человеку),
код 1 - схема или регулярки антиобещаний (`work/import-report.json`, разобрать и повторить). -> `facts-done`.

### 2. Правки анализа

Факты, ЦА, пожелания правятся в анализе (`/site-analiz`, своя задача), не в `work/` этой задачи; `inputs/analysis.md` -
рендер импорта, руками не правится. После правки анализа - фаза 0 заново (`update-meta.sh <task> init`).

### 3. Гейт 1: карта и решения (state `facts-done`)

Показать `task.mjs status` (факты и пробелы, карта по типам и волнам, антиобещания без регулярки - их линтер не ловит).
Человек: заполняет `rules/decisions.md` (конфликты, CTA, оговорка, страницы вне периметра) и утверждает карту
`work/sitemap.json` (типы, `block_set`, волны). Правка карты - повторно только обогатитель: один агент с промтом
«Папка проекта: <root>. Сначала прочитай <root>/CLAUDE.md, затем <root>/prompts/01-sitemap-enricher.md и выполни роль».
«Да» -> `map-approved`.

### 4. Фазы 2-4 (states `map-approved` .. `types-audited`)

Три воркфлоу подряд, каждый с `args types` (пересчитывать перед каждым). После каждого - одна строка итога и переход.
Перезапуск части: `--extra` с флагами RUNBOOK (`skipInventory`, `skipGlobal`, `skipTypes`).
`merge-strategy` с кодом 1 после фазы 4 - `node scripts/merge-strategy.mjs --check work/strategy.pages/<type>.json`
в папке задачи, файл типа чинится повтором стратега этого типа (`--extra {"skipGlobal":true}`).

### 5. Гейт 2: стратегия и раскладки (state `strategy-done`)

Показать: проблемы вывода `build-briefs` (из итога воркфлоу), пути `work/strategy.json` (матрица дифференциации,
формулы, CTA) и `work/layouts/<type>.html`, `status` (брифы по волнам), предложение пилота. Человек правит стратегию,
раскладки, `rules/decisions.md`, выбирает пилот. После правок типов или стратегии -
`node scripts/build-briefs.mjs --force <slug...>` в папке задачи. «Да» -> `update-meta.sh <task> strategy-approved pilot=<slugs>`.

### 6. Пилот и гейт 3 (states `strategy-approved`, `pilot-done`)

```
args write --slugs <pilot>        -> wf-05-write.js   (concurrency 1, первый экран home/hub/service - турнир)
args audit --slugs <pilot>        -> wf-06-audit.js
cd <task> && node scripts/render-md.mjs && node scripts/build-html.mjs && node scripts/check-html.mjs
```
-> `pilot-done`. Гейт 3: превью (шаг 8, пункт «Превью») + итог судей из результата wf-06. Человек правит правила
(`overrides/rules/*.md`, `overrides/rules/lint.json`), `work/page-types/*.json`, `work/layouts/*.html`, лимиты; после
правок типов или стратегии - `build-briefs.mjs --force <slug...>`. Второй пилот (одна категория) -
`update-meta.sh <task> strategy-approved pilot=<slug>` и шаг 6 заново. Первый экран переписать на готовой странице -
`args hero --slug <slug>` -> `wf-05b-hero-tournament.js` (топ-3 с оценками - в итоге, выбор за человеком).
«Да» -> `pilot-approved`.

### 7. Волны и гейт 4 (states `pilot-approved` .. `wave-1-approved`)

Волна N: `args write --wave N` -> `wf-05-write.js`; `args audit --wave N` -> `wf-06-audit.js`; сборка как в шаге 6;
`update-meta.sh <task> <state> wave=N`. Готовые страницы (пилот) `plan-run` не отдает - они не переписываются.
- `pilot-approved`: волна 1 -> `wave-1-done`. Гейт 4: превью, итоги аудита, те же правки, что на гейте 3. «Да» ->
  `wave-1-approved`.
- `wave-1-approved`: волны 2..N по `status` по порядку, затем `args write` и `args audit` без `--wave` (страницы без
  волны и недописанные; код 4 - нечего) -> `waves-done`. Без гейтов между волнами; сбой волны - `resumeFromRunId`, state не меняется.
- `--wave N` вне очереди: одна волна и стоп, state прежний (кроме `pilot-approved` + `--wave 1` -> `wave-1-done`).

### 8. Каталог, сборка, сдача (states `waves-done` .. `built`)

- Фаза 7: `status` -> «каталог (фаза 7): да» -> `args catalog` -> `wf-07-catalog.js` (ТЗ публикуется в Google Doc,
  ссылка в `work/catalog/publish.json`). «нет» -> `update-meta.sh <task> catalog-done skip_reason="каталога нет"`.
- Фаза 8 (в папке задачи): `node scripts/render-md.mjs && node scripts/build-html.mjs && node scripts/check-html.mjs;
  node scripts/report.mjs`. `check-html` с кодом 1 - ненаписанные или расходящиеся блоки: показать человеку, не
  скрывать. -> `built`.
- **Превью:** `task.mjs preview <KKK>` -> `{name, url}` -> Browser `preview_start` с этим `name` (serve.mjs kit
  отдает `work/output/prototype.html`). Скриншот первого экрана главной - в чат.
- Финал: `update-meta.sh <task> completed`, коммит `git add -A && git commit -m "Tekst <KKK> for <slug>: <N> страниц"`
  (копия kit и `.claude/launch.json` в `.gitignore`, в коммит не попадают). Итог:
```
=== ТЕКСТЫ ГОТОВЫ (site-tekst v9) ===
Задача: texts/<KKK>-<slug>   Страниц: <N> (волн <W>)   Пропущено по карте: <skip>
Прототип: texts/<KKK>-<slug>/work/output/prototype.html   Отчет: work/output/report.md
Аудит: страниц с открытыми blocker/major <n>; пробелы фактов - вопросы заказчику: <n>
Каталог: <ссылка на ТЗ | нет>
Дальше: /site-tekst <KKK> --fix <slug> "..." - правки | /handoff - перенести в main
   (tier seo в queue.json анализа: | /seo-faq --from-tekst <KKK> | /seo-metategi --from-structure <MMM>)
===
```

### 9. Точечная правка `--fix <slug> "<правка>"`

1. `task.mjs find [KKK]`, `current-task.txt`, `place`. Страница должна быть написана (`status`, `page.md` есть).
2. Разобрать правку (голосовые - «что понял / что неясно / что не трогаю»); неясное критично - спросить до правки.
   Прочитать `work/pages/<slug>/page.md` (одна страница, это можно) и найти блоки.
3. Записать `work/audit/<slug>/human-<YYYYMMDD-HHMM>.json` по `schemas/findings.schema.json`: `scope` slug,
   `producer: "human"`, `verdict: "fix"`, `summary`; на каждый пункт находка `severity: "major"`, `rule: "human.fix"`,
   `category` (weak, fact, logic, style, structure), `block_id`, `quote` из page.md, `problem` - правка дословно,
   `proposal` - формулировка человека, если дана, `status: "open"`. Проверка:
   `node scripts/validate.mjs findings work/audit/<slug>/human-...json` в папке задачи.
4. Новая цифра или факт в правке - сначала факт в `work/facts.json` (`publish: "yes"`, источник - правка заказчика
   с датой) и `node scripts/build-briefs.mjs --force <slug>`: без факта фиксер цифру не поставит (отказ «нет факта»).
5. `args fix --slug <slug> --findings work/audit/<slug>/human-...json` -> `wf-06b-fix-repeats.js` (фиксер по правке
   и линтеру страницы, сборка прототипа). `--judge` - если правка большая: полный круг судьи после фиксера.
6. Показать дифф: `git diff -- <task>/work/pages/<slug>/page.md` (только эта страница) и статусы находок
   (`rejected` - с причиной). Превью. Коммит `Tekst <KKK> fix <slug>: <кратко>`.
7. Правка меняет состав блоков (добавить, убрать, переставить) - это не точечная правка: стратегия типа
   (`work/strategy.pages/<type>.json`) -> `merge-strategy.mjs` -> `build-briefs.mjs --force <slug>` ->
   `args write --slugs <slug>` -> wf-05 -> `args audit --slugs <slug> --all` -> wf-06.

## Запреты

- НЕ пиши вне `texts/<KKK>-<slug>/` и `.claude/tmp/` (pre-commit worktree откажет): `sites/`, `structures/`, kit
  шаблона и `.claude/` правятся в своих задачах или в main-копии шаблона.
- НЕ правь копию kit в папке задачи на месте: проектное - в `overrides/`, алгоритм - в kit шаблона.
- НЕ импортируй анализ до его гейта без явного `--allow-ungated`; НЕ пропускай гейты 1-4 (`--auto` у скила нет).
- НЕ читай большие JSON `work/` целиком и НЕ передавай их содержимое агентам: пути, `status`, коды выхода.
- НЕ выдумывай факты, цифры, реквизиты: только `work/facts.json`; пробел факта - вопрос заказчику.
- НЕ ослабляй линтер ради прохода блока: причина чаще в брифе или стратегии (RUNBOOK, «Если что-то упало»).
- Длинное и среднее тире запрещены - только дефис; буква е-с-точками запрещена - всегда е.
- НЕ запускай другие скилы из этой сессии; перед закрытием worktree - `/handoff`.
