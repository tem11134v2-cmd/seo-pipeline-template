---
name: site-tekst
description: Конверсионные тексты сайта по алгоритму v9 (kit в kit/ - воркфлоу, промты, скрипты, правила). Импорт анализа sites/NNN после его гейта (и структуры structures/MMM или планировщика анализа), решения по проекту агентом, разбор лидеров, типы страниц, стратегия с рецензией, волны, аудит, каталог, прототип-сайт одним файлом и отчет с вопросами заказчику. Прогон без остановок - пауза только по --stop или автостоп по аномалии. Папка задачи texts/NNN-<slug>/ (format v9); копию kit в нее кладет скрипт при старте и --resume, в git она не идет. Аргументы - --site <NNN> [--structure <MMM>] | --doc <id> --slug <slug>, [--stop map|strategy|pilot], [--pilot a,b], [--allow-ungated], [--wave N], [--fix <slug> "<правка>"], [--resume [NNN]].
---

# site-tekst (v9)

Скил-оркестратор: тексты коммерческих страниц сайта уровня лидеров ниши и прототип-сайт одним html. Запускается
**в worktree-сессии**. Весь алгоритм - `kit/` (бывший test-text-template): 11 воркфлоу, 34 промта, 39 скриптов, схемы,
правила. Скил только ведет задачу: папка, копия kit, args воркфлоу, автопереходы и автостопы, resume, сдача.

Прогон идет от импорта анализа до готового прототипа **без остановок**: решения по карте заполняет агент фазы 0,
стратегию проверяет рецензия, тексты пишутся волнами подряд, вопросы копятся в отчете. Остановка - только ручная
пауза `--stop` или автостоп по аномалии. Заказчик видит только финальный прототип.

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
/site-tekst --site <NNN> [--structure <MMM> | --structure-file <путь>] [--stop map|strategy|pilot] [--pilot <slug,...>] [--allow-ungated]
/site-tekst --doc <google doc id> --slug <slug> [--structure <MMM>] [--stop ...] [--pilot <slug,...>]
/site-tekst [<KKK>] --resume | --wave <N> | --fix <slug> "<правка>"
```
- `--site <NNN>` - основной вход: `sites/NNN-*/project.json` (факты, ЦА, пожелания d1-d5, контакты d10, профиль ниши,
  затравка конкурентов). Импорт скриптом в фазе 0 и только после гейта анализа (`task.mjs plan` -> `gate_approved`).
- `--structure <MMM>` - структура SEO `structures/MMM-*/structure_data.json` (`--structure-file` - явный файл состава).
  Без флага: tier basic - состав анализа `sites/NNN-*/structure_data.json`, нет его - карту строит резервный агент
  (`structureMode: fallback`); tier seo - `structures/<тот же номер>-*`, если ее `meta.project_path` ведет на этот анализ,
  иначе `plan` - код 2 с подсказками (`/seo-struktura NNN`, `--import`, `--structure` или `--structure-file`).
- `--doc <id>` - запасной вход: анализ в Google Doc (режим `doc` kit: дамп, извлечение фактов, слепая сверка).
  Нужен `--slug`. Поля конфига (компания, сайт, профиль ниши, `key_phrases`, стоп-лист агрегаторов) оркестратор
  заполняет в `config/project.json` задачи до фазы 0 - из `ЗАКАЗЧИК.md` или вопросом человеку.
- `--stop <map|strategy|pilot>` - одноразовая ручная пауза (`meta.stop`): `map` - после фазы 0 (карта и
  `rules/decisions.md`), `strategy` - после фазы 4 (стратегия, раскладки, брифы), `pilot` - после пилота (запись, аудит и
  сборка пилотных страниц). Без флага прогон не останавливается.
- `--pilot <slug,...>` = `--stop pilot` с этим пилотом (`meta.pilot`). `--stop pilot` без `--pilot` - главная и первая по
  карте категория (нет категорий - услуга, нет услуг - хаб): строка «пилот (предложение)» в `status`.
- `--allow-ungated` - пилот до гейта анализа, только явным флагом: у фактов `publish: no`, страницы уйдут в короткий
  набор. Пишется в `meta.json` (`allow_ungated`), `args facts` передает его сам. Без `--stop` означает `--stop pilot`;
  с `--stop map|strategy` пауза пилота ставится перед волнами (шаг 7): волны до гейта не пишутся.
- `--wave <N>` - одна волна (запись + аудит + сборка) и стоп, state прежний.
- `--fix <slug> "<правка>"` - точечная правка готовой страницы по находке человека (шаг 9).
- `--resume [KKK]` - продолжить по `meta.json.state`. Без номера - `task.mjs find` (незавершенные v9). Ответы заказчика
  по готовой задаче - `/site-tekst <KKK> --resume` с ответами: шаг 2.

## Папка задачи

```
texts/KKK-<slug>/                         данные задачи - в git
├── meta.json                             state, format "v9", site, structure, source, stop, autostop, pilot, wave, allow_ungated,
│                                         overrides_base (база сверки overrides), strategy_update, answers_rerun (шаг 2)
├── config/project.json                   профиль проекта; sources.* пересчитывает task.mjs place от ссылок meta
├── rules/decisions.md                    решения проекта (формат v2: заполняет составитель фазы 0, стратеги - §8)
├── overrides/<путь kit>                  проектные правки файлов kit (rules/lint.json, html/site/ui.json и т.п.), поверх копии
├── inputs/                               structure_data.json, analysis.md (рендер импорта), пожелания
└── work/                                 facts, audience, sitemap, конкуренты, типы, стратегия, страницы, аудит, output/
    копия kit - НЕ в git (.gitignore):    CLAUDE.md, workflows/, prompts/, scripts/, schemas/, html/,
                                          rules/* кроме decisions.md, config/house_style.md, .kit.json (манифест)
```

Копия kit - кеш: `task.mjs place` кладет ее при каждом старте и `--resume` (исправления kit доходят до старых задач);
`texts/KKK/CLAUDE.md` - правила агентов kit, не оркестратора. Override: `.json` - только измененные ключи (слияние с kit),
`.md` с первой строкой `<!-- overrides:append -->` - дописка к kit, прочее - полная замена. Правку файла копии на месте
`place` находит по `.kit.json` (`.json` - по данным): код 3 и список - вопрос человеку одним сообщением (в meta не пишется,
`place` проверит снова): правка проекта -> `overrides/<тот же путь>`; правка алгоритма -> kit шаблона (main-копия, не этот
проект); выбросить -> `place --force`. Человеку показать строки `place`: «kit обновил их с прошлой сверки ... git diff
<база> <kit>» (полная замена закрывает исправление kit: поправить override или, сверив, `place <KKK> --reconciled
<путь>`), «база сверки записана ... по текущему kit» (сверить один раз), «похоже на дописку без пометки», «правки без
пары в kit».

## Скрипт задачи

`task.mjs` (без LLM, запуск из корня проекта, `.claude\scripts\_node.cmd .claude\skills\site-tekst\task.mjs ...`):

| Команда | Что делает |
|---|---|
| `plan --site N [--structure M \| --structure-file <путь>] \| --doc <id> --slug s` | номер KKK (max+1 по всем `texts/*`, и v7, и v9), slug, ссылки, `tier`, `gate_approved` (`gate_step` - почему нет, `gate_note` - строка человеку); ничего не пишет |
| `init --task texts/KKK-s <флаги plan> [--allow-ungated] [--stop x] [--pilot a,b]` | папка, `meta.json` (с `stop`, `pilot`), `config/project.json`, `rules/decisions.md`, копия kit |
| `place <KKK> [--force] [--reconciled <путь,...>]` | освежить копию kit (+ overrides), пересчитать `sources` конфига, overrides по видам; код 3 - правки на месте |
| `args <KKK> <вид> [флаги]` | одна строка JSON для `args` воркфлоу; код 4 - делать нечего; код 2 - slug `--slugs` или пилота не из карты |
| `status <KKK>` | сводка для автостопов: state, остановка, факты, `decisions.md`, карта, волны, блоки, каталог, пилот, прототип |
| `stop <KKK> [--set map\|strategy\|pilot [--pilot a,b] \| --autostop '<причина>' \| --clear [all]]` | пауза и автостоп в `meta.json`: `--set` - ручная пауза, `--autostop` - автостоп с причиной, `--clear` - снять автостоп, а если его нет - паузу (`all` - обе); без флагов - текущие |
| `preview <KKK>` | конфиг `site-tekst-<KKK-slug>` в `.claude/launch.json` (serve.mjs kit, порт от хеша пути задачи, не в git) |
| `find [KKK]` | папка задачи и state; без номера - все незавершенные v9 |

Виды `args`: `facts` (wf-00), `types` (wf-02/03/04, вывод `prep-args` + `catalog`), `write` (wf-05: без выборки - пилот
при паузе `pilot`, иначе недописанные страницы волны 1, затем волны 2; `--wave N` / `--slugs a,b` / `--hero single`,
`--concurrency`; код 4 - писать нечего, в том числе остались только exhausted-блоки), `audit` (wf-06: дописанные страницы
без свежего аудита - `page.md` изменился после него, `round` - следующий круг; `--wave N`, `--slugs a,b`, `--all` - все),
`fix` (wf-06b, `--slug`, `--findings`, `--judge`), `hero` (wf-05b, `--slug`, `--block`), `catalog` (wf-07). `--extra '<json>'`
добавляет или заменяет поля (`{"skipGlobal":true}`, `{"skipReview":true}`, `{"types":["<type>"]}` и т.п., RUNBOOK). В каждом
`args`: `root` - абсолютный путь папки задачи в этой worktree, `model` - `opus` (роли `strong`), `model_light` - `sonnet`
(роли `light`); точечная замена модели роли - `--extra '{"models":{"extract":"sonnet"}}'` (RUNBOOK, «Модели по ролям»).

## Запуск воркфлоу

```
Workflow  scriptPath = <root>/workflows/<wf-...>.js   args = <строка JSON из task.mjs args, как есть, объектом>
```
- `scriptPath` - из копии kit в папке задачи (вложенный `wf-05b` берется оттуда же, от `root`). `wf-05` - только отсюда,
  верхним уровнем: из другого воркфлоу турнир первого экрана упрется в лимит вложенности.
- Результат воркфлоу - короткий объект; из него в чат 1-3 строки. Большие файлы `work/` оркестратор не читает:
  для решений - `task.mjs status`, коды выхода скриптов, точечные поля (`node -e` по одному полю).
- runId каждого запуска - в meta: `bash .claude/hooks/update-meta.sh <task> <тот же state> last_run=<runId>`. Сбои двух видов:
  - **сбой среды** (529, 503, rate_limit, overloaded, таймаут, прерванная сессия) - повтор с `resumeFromRunId` и теми же
    `args` (готовые агенты из кэша); пауза перед повтором растет: 90 сек, затем 5 мин; третий сбой подряд - автостоп.
    `place` перед повтором обновил kit (скопировано больше 0) - новый запуск без `resumeFromRunId`: кэш прежнего kit (у
    фазы 6 - прежний порядок) не годится. wf-02 «нет доступных конкурентов: ...» (сеть, MCP, браузер не ответили) - тоже
    сбой среды с теми же паузами и автостопом на третьем подряд, но всегда новый запуск без `resumeFromRunId`: пустой
    ответ верификатора лежит в кэше, и повтор из кэша вернул бы ту же ошибку;
  - **отказ агента** (ошибка воркфлоу «... не удался», «... не отработал», «... не импортирована», у wf-07 - «... не
    собрана», «... не написано», «... не проходит схему», «... пустой») - `resumeFromRunId` вернул бы тот же отказ из кэша:
    новый запуск без него (фаза 0: дамп уже снят - `--extra '{"skipDump":true}'`, снимок сайта уже снят - еще
    `"skipSnapshot":true`); второй отказ подряд - автостоп. Код 2 импорта - автостоп сразу. wf-04 «args.update: в
    work/import-report.json нет facts_diff ...» - не повтор: в папке задачи `node scripts/import-project.mjs --facts-only`
    (шаг 2, п. 3), затем новый запуск wf-04 без `resumeFromRunId`.
- Expected-маркеры не ставить: агенты воркфлоу - веера, свои выходы они проверяют скриптами kit. Перед запуском в
  `.claude/tmp/` не должно быть чужих `expected-*.txt` (узкий фолбэк `check-file.sh` примерит единственный маркер
  к агентам воркфлоу).

## Поток

```
init -> facts-done -> map-approved -> competitors-done -> types-audited -> strategy-done -> strategy-approved
     -> waves-done -> catalog-done -> built -> completed
пауза pilot: strategy-approved -> pilot-done -> pilot-approved -> wave-1-done -> wave-1-approved -> waves-done
```
Источник истины - `meta.json`, переходы только `bash .claude/hooks/update-meta.sh <task> <state> [k=v]`; пауза и
автостоп - только `task.mjs stop` (не update-meta.sh).

| state | действие | как |
|---|---|---|
| `init` | фаза 0: факты, аудитория, карта, решения | шаг 1 -> `facts-done` |
| `facts-done` | проверка фазы 0; пауза `map` | шаг 3 -> `map-approved` (`meta.answers_rerun` - `types-audited`) |
| `map-approved` | фаза 2: конкуренты, разбор лидеров | `args types` -> `wf-02-competitors.js` -> `competitors-done` |
| `competitors-done` | фаза 3: аудит типов | `args types` -> `wf-03-audit-types.js` -> `types-audited` |
| `types-audited` | фаза 4: стратегия, рецензия, брифы, раскладки | `args types` (`meta.strategy_update` - режим обновления, шаг 2) -> `wf-04-strategy-layouts.js` -> `strategy-done` |
| `strategy-done` | проверка фазы 4; пауза `strategy` | шаг 5 -> `strategy-approved` |
| `strategy-approved` | пилот (пауза `pilot`) или волны | шаг 6 -> `pilot-done`; шаг 7 -> `waves-done` |
| `pilot-done` | пауза `pilot` | шаг 6 -> `pilot-approved` |
| `pilot-approved`, `wave-1-done`, `wave-1-approved` | волны | шаг 7 -> `waves-done` |
| `waves-done` | фаза 7: каталог | шаг 8 -> `catalog-done` |
| `catalog-done` | фаза 8: сборка и отчет | шаг 8 -> `built` |
| `built` | сдача | шаг 8 -> `completed` |

**Автопереход:** после каждой фазы - одна строка итога, проверка автостопа этой точки (таблица ниже) по `task.mjs status`
и возврату воркфлоу, затем следующий state без вопроса человеку. На точке паузы (`meta.stop`: `map` в `facts-done`,
`strategy` в `strategy-done`, `pilot` в `pilot-done`) - показать то, что сказано в шаге, и ждать; «да» -> проверки шага,
`task.mjs stop <KKK> --clear` и сразу переход state.

**Автостопы** - единственные автоматические остановки (этот список - единственный; RUNBOOK и ADR-044 ссылаются сюда):

| Где | Условие | Откуда видно | После снятия |
|---|---|---|---|
| фаза 0, импорт | код 2: ошибка wf-00 с «гейт анализа не согласован», «нет ...», «ожидался project.json v2» или «структура не импортирована»; код 1 («не прошел схем...») второй раз подряд | текст ошибки wf-00 | фаза 0 новым запуском |
| после фазы 0 | страницы карты без сегмента; `decisions.md` без маркера v2, копия шаблона или «Где можно» не разобрано после повтора составителя (шаг 3) | `status`: «без сегмента N», «decisions.md: ...» | `map-approved` |
| после фазы 0 | у анализа 3+ фактов (F8xx и F9xx не в счет), ни один не `publish: yes`; при импорте до гейта строки нет - ноль ожидаем | `status`: «фактов анализа с publish yes 0 из N» | `map-approved` |
| после фазы 4 | непустой `briefs_problems`; брифов 0 или меньше половины рабочих страниц | возврат wf-04 (на `--resume` - код `build-briefs.mjs`); `status`: «брифов B из N» | `strategy-approved` |
| запись (wf-05) | два запуска подряд без прогресса или 4 запуска на одну выборку без кода 4; тот же блок с `no_answer` в `failed` два запуска подряд | строка «блоки» `status` до и после запуска; `failed` wf-05 | запись выборки закончена, дальше аудит |
| после волны 1 | у образца типа exhausted не меньше 2 блоков и больше 30% (системная проблема типа) | `status`: «волна 1, exhausted больше 30%» | `wave=1` (шаг 7) |
| после всех волн | недописано больше 30% блоков | `status`: «блоки: ... недописано N (X%)» | `waves-done` |
| сборка (шаг 8, `--fix`) | после одной пересборки: `build-html` не 0, `check-html` blocked (код 2) или `check-site-js` fail | вывод сборки этого запуска | `built`, итог проверок как есть |
| волны до гейта | `gate.ungated_import: true`, гейт анализа не согласован, паузы нет (шаг 6, «После гейта анализа») | `work/import-report.json`, `task.mjs plan` | «После гейта анализа» заново |
| ответы заказчика (шаг 2) | `--facts-only` - код 1: выход не прошел схему, ничего не записано | вывод скрипта | `--facts-only` заново |
| любой воркфлоу | третий сбой среды подряд (и wf-02 «нет доступных конкурентов»); второй отказ агента подряд («Запуск воркфлоу») | ошибка воркфлоу | новый запуск |

Автостоп: `task.mjs stop <KKK> --autostop '<где, что, файл>'`, причина - в чат, дальше не идти. Снимает его оркестратор, но
только по явному решению человека в чате («продолжай»): `task.mjs stop <KKK> --clear` и сразу, до любой другой работы,
действие колонки «После снятия» - так на `--resume` та же проверка не сработает снова. Без такого решения автостоп не
снимается. Не автостоп, а вопрос человеку (в meta не пишется, скрипт проверит снова): код 3 `place` («Папка задачи»),
коды 3 и 2 `--facts-only` (шаг 2, п. 3).

**Resume:** `task.mjs find [KKK]` -> `meta.json` -> `format` не `v9` - стоп: «задача v7: конвейер v7 выведен, режима
доделки нет - новая задача /site-tekst (FAQ по старой задаче - /seo-faq --from-tekst)». Иначе `current-task.txt`, `place`
(код 3 - вопрос), `status`, затем без вопроса «продолжить?»:
- `meta.autostop` - показать причину и ждать решения человека (снятие - выше);
- `meta.stop` и state на точке паузы - показать паузу (шаг 3, 5 или 6) и ждать;
- иначе - по таблице, с проверками точек (на `strategy-done` проблемы брифов - кодом `build-briefs.mjs`, шаг 5). Старые
  гейтовые state без `meta.stop`: `facts-done`, `strategy-done` - проверка и автопереход; `pilot-done`, `pilot-approved`,
  `wave-1-done`, `wave-1-approved` - волны (шаг 7), готовое не переписывается;
- `built` или `completed` со строкой `status` «собран старым kit - пересобрать фазу 8» - сначала сборка (шаг 8), затем
  сдача; `completed` без нее - делать нечего, кроме ответов заказчика (шаг 2) и `--fix`.
`args` с кодом 4 - шаг сделан, дальше.

## Шаги

### 0. Старт

1. Worktree: `git rev-parse --git-dir` == `git rev-parse --git-common-dir` -> это main: предупредить, не блокировать.
2. `task.mjs plan <флаги>` -> `task_dir`, `tier`, `structure`, `gate_approved`, `gate_step`, `gate_note`. Код 2 - нет входа
   (в том числе tier seo без своей структуры): стоп с подсказкой из вывода (`/site-analiz`, `/seo-struktura`).
   `gate_approved: false` без `--allow-ungated` - стоп: «анализ NNN не согласован: шаг <gate_step> (queue.mjs gate); пилот
   до гейта - только --allow-ungated». `gate_note` - одна строка человеку, дальше без ожидания. `structure` пуст (tier
   basic без состава, `--doc`) - одна строка «карту построит резервный агент; проверить ее до стратегии - флаг --stop map»
   и дальше без ожидания.
3. **Первым делом** `.claude/tmp/current-task.txt` = `<task_dir>/` (без этого pre-commit откажет).
4. `task.mjs init --task <task_dir> <флаги>` (`--stop`, `--pilot`, `--allow-ungated` - как в аргументах) ->
   `bash .claude/hooks/update-meta.sh <task_dir> init`.
5. Режим `doc`: заполнить поля `config/project.json` (см. «Аргументы»). Режим `project` - ничего, это делает импорт.

### 1. Фаза 0 (state `init`)

`args facts` -> `wf-00-facts.js`: импорт (или дамп и извлечение), снимок сайта по пустым контактам, карта, составитель
решений (`rules/decisions.md` v2), обогатитель карты. Сбой или отказ - «Запуск воркфлоу»; код 2 импорта - автостоп.
-> `facts-done`.

### 2. Ответы заказчика и правки анализа

Факты, ЦА, пожелания правятся в анализе (`/site-analiz`, своя задача), не в `work/` этой задачи; `inputs/analysis.md` -
рендер импорта, руками не правится. Рецепт - он же возврат ответов на «Что спросить у заказчика» после сдачи. Фазы 0-3
не повторяются (кроме ветки ниже): фаза 4 идет в режиме обновления, остальное делает таблица, в том числе на `--resume`.
1. Ответы - в задаче анализа (`/site-analiz`, шаг 5): новый круг - новый файл `sites/NNN/answers-<N>.txt` рядом с
   прежними (новый факт - строка `+: <что> = <значение> [<< <фраза>]`, факты оператора - строки раздела отчета «Факты
   оператора: перенести в анализ»). Фразу после `<<` анализ ищет только во входе `sites/NNN/input/`: письмо или
   расшифровку заказчика с ней положить туда, иначе хвост `<< ...` убрать (строка уйдет в «не разобрано», гейт откажет);
   так же со строками F8NN. Затем, как в `/site-analiz`: `node .claude/scripts/site/apply-answers.mjs <каталог> --apply`
   -> `verify-data.mjs <каталог>` -> `queue.mjs gate <каталог> --by "<кто согласовал>"` (круг сбросил прежний гейт; имя -
   от человека, гейт ставится только по его согласию) -> `/handoff`.
2. В worktree текстов `git merge main` (конфликтов с `texts/` нет; без него импорт прочитает старый анализ), `place`.
3. В папке задачи `node scripts/import-project.mjs --facts-only` (задача до гейта - еще `--allow-ungated`). Код 3 -
   `facts.json` правили руками: показать дифф; правка заказчика - в анализ или факт F8xx (шаг 9), выбросить - `--force`.
   Код 2 - гейт анализа не согласован (круг ответов его сбросил, а заново не поставили) или нет входа: вопрос человеку,
   гейт - в задаче анализа (п. 1), затем пп. 2-3 заново. Код 1 - автостоп с выводом скрипта (таблица «Автостопы»).
   Строку «изменения анализа» (новые, стали публикуемыми) запомнить для п. 5. `facts_diff` и `other_changed` пусты (в
   строке «изменения анализа» одни «-», в строке `company` нет «ВНИМАНИЕ: изменились») - дальше нечего. F8xx,
   перенесенные в анализ (`moved_from`), импорт снимает сам.
4. `other_changed` пуст - фаза 4 в режиме обновления: `update-meta.sh <task> types-audited strategy_update=1`; wf-04 в этом
   state с `meta.strategy_update` - `args types --extra '{"update":true,"skipLayouts":true}'`, плюс `"enrich":true`, если в
   `work/import-report.json` -> `facts_diff` непусты `added`, `removed`, `published` или `unpublished` (стратеги переносят
   прежние записи и правят только по диффу, обогатитель пересчитывает покрытие фактами и `block_set`); после wf-04 -
   `update-meta.sh <task> strategy-done strategy_update=` (пустое значение - режим выключен). Непуст («нужен повтор фазы
   0»: ЦА, пожелания, направления, конкуренты, антиобещания) - фаза 0 без паузы (шаги 1, 3): `competitors-seed` нет в
   `other_changed` - `update-meta.sh <task> init answers_rerun=1` (после фазы 0 шаг 3 ведет в `types-audited`: фазы 2-3
   не повторяются, фаза 4 полная; ключ в meta - чтобы ветка пережила `--resume`), иначе `update-meta.sh <task> init` и
   полный путь.
5. После фазы 4 (шаг 5, когда блоки уже написаны), в Bash, в папке задачи:
   - `node scripts/build-briefs.mjs`; `structure_changed` в `work/briefs-report.json` - `build-briefs.mjs --force <slug...>`;
   - `node scripts/lint-page.mjs <slug>` по каждой странице с написанными блоками (блок со снятым фактом перестает
     проходить линтер);
   - блоки, ждавшие ответа: в прежнем `work/output/report.md` («Что спросить у заказчика») у вопроса указаны страница и
     блок; ответ дал новый факт (п. 3 или `work/import-report.json` -> `facts_diff.added`, `published`) - блок в `_old`
     («Перенос блоков», шаг 6): pass-блок сам не перепишется, и его `needs_fact` снова попал бы в отчет. Одна-две
     страницы - вместо этого `--fix` с находкой human по блоку (шаг 9).
6. Волны (шаг 7) переписывают только блоки без файла, не pass (в том числе не прошедшие перелинт и exhausted со
   сменившимся срезом) и перенесенные; pass-блоки не трогаются. Аудит - страницы, где `page.md` изменился. Каталог
   не повторяется (шаг 8). В итог сдачи - «переписано по ответам: <n> блоков».
Точечно, одна-две страницы, - `--fix` с фактом F8xx (шаг 9).

### 3. После фазы 0 (state `facts-done`)

`status`: без сегмента или «фактов анализа с publish yes 0 из N» - автостоп. `decisions.md` без маркера v2 или копия
шаблона - сначала один агент-составитель: «Папка проекта: <root>. Сначала прочитай <root>/CLAUDE.md, затем
<root>/prompts/01-decisions-drafter.md и выполни роль. Режим анализа: <meta.source>.» Затем снова `status`: v2 заполнен
или агент вернул `legacy: true` (старый файл, заполненный человеком, - его решения) - дальше, иначе автостоп. «Где можно»
не разобрано: <id> (колонка этих строк §1 не применяется - факт открыт всем страницам) - тот же составитель с добавкой
«Параметры: fix_where=<id,...>» (по промту он переписывает только колонку «Где можно» этих строк - исключение из правила
о заполненных строках); снова `status`, «Где можно» не разобрано осталось - автостоп. Без автостопа и паузы ->
`map-approved`; при `meta.answers_rerun` (шаг 2, п. 4) здесь и после паузы вместо него `update-meta.sh <task>
types-audited answers_rerun=` (пустое значение снимает ветку).
Пауза `map`: показать `status` (факты и пробелы, карта по типам, антиобещания без регулярки - их линтер не ловит) и §8
`rules/decisions.md` (спорные решения агента). Человек правит `rules/decisions.md` (набор блоков страницы `short`, `skip` -
решением в §6, не правкой `block_set`) и карту `work/sitemap.json` (типы, родители, `ui_role`, `nav_label`). После смены
типа, родителя или состава страниц - повторно только обогатитель: один агент, как составитель выше, с
`prompts/01-sitemap-enricher.md` (заполненные поля он не меняет). «Да» -> `task.mjs stop <KKK> --clear` -> `map-approved`.

### 4. Фазы 2-4 (states `map-approved` .. `types-audited`)

Три воркфлоу подряд, каждый с `args types` (пересчитывать перед каждым). После каждого - одна строка итога и переход.
Перезапуск части: `--extra` с флагами RUNBOOK (`skipInventory`, `skipGlobal`, `skipTypes`, `skipReview`, `skipLayouts`).
wf-02 с `degraded: no_competitors` (все лидеры ответили, но недоступны) - штатный исход, не автостоп: типы собраны по
анализу, отчет спросит заказчика о 2-3 сайтах-ориентирах.

### 5. После фазы 4 (state `strategy-done`)

Автостоп: `briefs_problems` из возврата wf-04 не пуст (проблемы - дословно в причину; на `--resume` возврата нет -
`node scripts/build-briefs.mjs` в папке задачи, код 1 - проблемы, пересборка идемпотентна) или `status` «брифов B из N» с
B меньше половины N. Починка после решения человека: `node scripts/merge-strategy.mjs --check work/strategy.pages/<type>.json`
в папке задачи; файл одного типа - повтор только его стратега: `args types --extra '{"skipGlobal":true,"types":["<type>"]}'`
-> wf-04 (без `types` стратеги всех типов перепишут свои файлы, правки паузы и факты F8xx в них пропадут). Блоки уже
написаны (`status` «блоки: прошли линтер P», P больше 0 - повтор фазы 4 по шагу 2) - шаг 2, п. 5. Иначе без паузы ->
`strategy-approved`.
Пауза `strategy`: показать сводку предупреждений (`briefs_final.warnings`), `work/audit/strategy-review.json`, §8
`rules/decisions.md`, пути `work/strategy.json` и `work/layouts/<type>.html`, `status`. Человек правит стратегию,
раскладки, `rules/decisions.md`; после правок - `node scripts/merge-strategy.mjs` и
`node scripts/build-briefs.mjs --force <slug...>` в папке задачи. «Да» -> `task.mjs stop <KKK> --clear` -> `strategy-approved`.

### 6. Пилот (пауза `pilot`: states `strategy-approved`, `pilot-done`)

Цикл записи (шаг 7) без выборки - пилот, concurrency 1; `args audit` -> `wf-06-audit.js`; сборка шага 8. -> `pilot-done`.
Пауза: превью (шаг 8, «Превью») + итог судей из результата wf-06. Человек правит правила (`overrides/rules/*.md`,
`overrides/rules/lint.json`), `work/page-types/*.json`, `work/layouts/*.html`, лимиты; после правок типов или стратегии -
`build-briefs.mjs --force <slug...>`. Второй пилот - `task.mjs stop <KKK> --set pilot --pilot <slug>`,
`update-meta.sh <task> strategy-approved` и шаг 6 заново. Первый экран переписать на готовой странице -
`args hero --slug <slug>` -> `wf-05b-hero-tournament.js` (топ-3 с оценками - в итоге, выбор за человеком).
«Да» -> `work/import-report.json` -> `gate.ungated_import: true` - сначала «После гейта анализа»; иначе
`task.mjs stop <KKK> --clear` -> `pilot-approved` -> шаг 7.

**После гейта анализа** (импорт до гейта, `--allow-ungated`): `git merge main` (гейт ставится в задаче анализа),
`task.mjs plan --site <meta.site>` с тем же составом, что при старте (`meta.structure`: папка - `--structure <она>`, файл
`.json` - `--structure-file <он>`, пусто - без флага; иначе tier seo ищет структуру по номеру анализа) -> `gate_approved`. `false` - дальше пилота нельзя: «анализ NNN не согласован», ждать на
паузе (паузы нет - автостоп с этой причиной). `true`:
1. `place`, `node scripts/import-project.mjs --facts-only` без `--allow-ungated` (импорт становится подтвержденным,
   `gate.ungated_import: false`; код 3 - как в шаге 2, п. 3).
2. Блоки всех пилотных страниц - в `_old` (написаны на неподтвержденных фактах).
3. `update-meta.sh <task> types-audited allow_ungated=` (пустое значение выключает `allowUngated` в `args facts`;
   непустой `other_changed` - `init`, ветка шага 2, п. 4). Пауза `pilot` остается (нет - `task.mjs stop <KKK> --set
   pilot`): пилот пишется заново, следующая пауза - уже с `gate.ungated_import: false`.

**Перенос блоков** в `_old` (в Bash, в папке задачи): файлы `work/pages/<slug>/blocks/<block_id>*.json` (с вариантами
первого экрана) и их отчеты `work/audit/<slug>/lint-<block_id>.json` (вся страница - `blocks/*.json` и `lint-B*.json`) -
`mkdir -p work/pages/<slug>/_old` и `mv` туда. Блок становится pending (нет файла) и пишется заново; прежний lint-файл
новый блок не подхватит.

### 7. Волны (state `strategy-approved` без паузы; `pilot-approved` .. `wave-1-approved`)

Перед волнами (и перед `--wave N`): `gate.ungated_import: true` в `work/import-report.json` - волны до гейта не пишутся:
state `strategy-approved` - `task.mjs stop <KKK> --set pilot` и шаг 6; другой state - шаг 6, «После гейта анализа».
```
Цикл записи --wave 1
args audit --wave 1 -> wf-06-audit.js           путь паузы pilot: -> wave-1-done
   проверка волны 1 (уже пройдена, если state wave-1-approved или meta.wave >= 1): status «волна 1, exhausted больше
   30%» - автостоп (тип, блок, правило из work/audit/<slug>/lint-<блок>.json); иначе update-meta.sh <task> <state> wave=1
   (путь паузы pilot: state wave-1-approved)
Цикл записи --wave 2
args audit          -> wf-06-audit.js   (все дописанные без свежего аудита; код 4 - нечего)
   проверка: status «блоки: ... недописано N (X%)» больше 30% - автостоп; иначе update-meta.sh <task> waves-done wave=2
```
**Цикл записи:** `args write <выборка>` -> `wf-05-write.js`, снова `args write` той же выборки, и так до кода 4. Перед
первым запуском и после каждого - строка «блоки» `status` (прошли линтер, exhausted). Запуск, после которого ни одно из
двух чисел не выросло, - без прогресса (писатель не записал блок или `attempts` и `brief_sha`, и блок никогда не станет
exhausted). Два запуска подряд без прогресса или 4 запуска wf-05 на одну выборку без кода 4 - автостоп с блоками из
`failed` последнего запуска; тот же блок с `no_answer` в `failed` два запуска подряд - автостоп. Готовые страницы
`plan-run` не отдает - они не переписываются; сбой воркфлоу - «Запуск воркфлоу» (повтор с `resumeFromRunId` - тот же
запуск цикла), state не меняется.
`--wave N` вне очереди: цикл записи `--wave N`, `args audit --wave N` -> wf-06, сборка шага 8 и стоп, state прежний.

### 8. Каталог, сборка, сдача (states `waves-done` .. `built`)

- Фаза 7: `status` «каталог (фаза 7): да» и в `meta.completed_steps` нет `catalog-done` -> `args catalog` ->
  `wf-07-catalog.js` (спецификация, ТЗ и примеры товаров для карточек; сбой примеров фазу не валит - поле `samples`;
  `open` - открытые blocker/major аудита ТЗ; ТЗ - docx в Google Doc, ссылка в `work/catalog/publish.json`, без
  `texts_folder_id` - `status: skipped` и путь docx). «нет» ->
  `update-meta.sh <task> catalog-done skip_reason="каталога нет"`; каталог уже был - `catalog-done` без повтора.
- **Сборка** (фаза 8; ее же зовут шаги 6, 7) - в Bash с `timeout 600000` (проверка скриптов большого сайта идет дольше 2
  минут), в папке задачи:
  1. `node scripts/render-md.mjs; node scripts/build-html.mjs` - код не 0 (строка `build-html: ...`): прототипа этого
     запуска нет, один повтор, снова не 0 - автостоп.
  2. `node scripts/check-html.mjs; node scripts/check-site-js.mjs; node scripts/report.mjs`.
  Итог - вывод этого запуска, а не `status`: строка `check-html: <вердикт> ... код N` (0 - pass, 1 - fix: major, например
  ненаписанные блоки, - штатно, это в отчете; 2 - blocked) и строка `check-site-js` (pass, fail, SKIP). «прототип старше данных» в выводе
  `check-html`, blocked или fail - одна пересборка (пп. 1-2), не помогло - автостоп (`work/audit/html-check.json`,
  `work/output/prototype.js-check.json`). Фаза 8 -> `built`.
- **Превью:** `task.mjs preview <KKK>` -> `{name, url}` -> Browser `preview_start` с этим `name` (serve.mjs kit
  отдает `work/output/prototype.html`). Скриншот первого экрана главной - в чат.
- `check-site-js` SKIP (нет `jsdom`) - сказать оператору до `completed`: скрипты прототипа не проверены, `npm install`
  в корне проекта и пересборка.
- Финал: `update-meta.sh <task> completed`, коммит в Bash `git add -A && git commit -m "Tekst <KKK> for <slug>: <N> страниц"`
  (копия kit и `.claude/launch.json` в `.gitignore`, в коммит не попадают). Итог (N, R, блоки, скелеты, вопросы, K,
  каталог - из последней строки `report.mjs`; skip - из строки `status` «карта: ... (skip K)»). K больше 0 - до сдачи
  прочитать раздел отчета «Правки без проверки судьей» и назвать оператору спорные правки одной строкой:
```
=== ТЕКСТЫ ГОТОВЫ (site-tekst v9) ===
Задача: texts/<KKK>-<slug>   Страниц: <N> (готово <R>)   Пропущено по карте: <skip>
Прототип: texts/<KKK>-<slug>/work/output/prototype.html   Служебный слой: клавиша D или ?debug
Проверки: check-html <pass | fix | blocked - автостоп снят человеком>, check-site-js <pass | fail - автостоп снят человеком | SKIP - нет jsdom, скрипты не проверены>
Блоки: <P>/<T> прошли линтер, скелетов <m> (exhausted <e>); правок без проверки судьей <K>
Отчет: work/output/report.md - «Что спросить у заказчика»: <n> вопросов (ответы - шаг 2)
Каталог: <ссылка на ТЗ | docx без публикации | нет> (ТЗ: открыто blocker/major <x>/<y>, вопросов раздела 8 <q>)
Дальше: /site-tekst <KKK> --fix <slug> "..." - правки | /handoff - перенести в main
   (tier seo из plan, <MMM> - номер из meta.structure: | /seo-faq --from-tekst <KKK> | /seo-metategi --from-structure <MMM>)
===
```

### 9. Точечная правка `--fix <slug> "<правка>"`

1. `task.mjs find [KKK]`, `current-task.txt`, `place` (overrides, которые kit обновил, - человеку). Страница должна быть
   написана (`status`, `page.md` есть).
2. Разобрать правку (голосовые - «что понял / что неясно / что не трогаю»); неясное критично - спросить до правки.
   Прочитать `work/pages/<slug>/page.md` (одна страница, это можно) и найти блоки.
3. Записать `work/audit/<slug>/human-<YYYYMMDD-HHMM>.json` по `schemas/findings.schema.json`: `scope` slug,
   `producer: "human"`, `verdict: "fix"`, `summary`; на каждый пункт находка `id` (обязателен: `H1`, `H2`...),
   `severity: "major"`, `rule: "human.fix"`, `category` (weak, fact, logic, style, structure), `block_id`, `quote` из
   page.md, `problem` - правка дословно, `proposal` - формулировка человека, если дана, `status: "open"`. Проверка:
   `node scripts/validate.mjs findings work/audit/<slug>/human-...json` в папке задачи.
4. Новая цифра или факт в правке - сначала факт оператора в `work/facts.json`: id `F801`-`F899` (следующий свободный),
   `publish: "yes"`, `label`, `value`, `wording`, `kind`, `source_quote` (слова заказчика), `source: "оператор: <дата>
   <основание>"`; проверка `node scripts/validate.mjs facts work/facts.json`. Id факта - в `facts` записи страницы в
   `work/strategy.pages/<type>.json` (и в `block_overrides.<id блока>.facts`, если у блока явный список), затем
   `node scripts/merge-strategy.mjs` и `node scripts/build-briefs.mjs <slug>` (структура изменилась - `--force <slug>`):
   без факта в брифе фиксер цифру не поставит (отказ «нет факта»). Факт вернул странице выпавший блок
   (`args write --slugs <slug>` не с кодом 4) - сначала цикл записи `--slugs <slug>` (шаг 7). Отчет выведет F8xx строками
   листа ответов анализа («перенести в анализ», шаг 2, п. 1).
5. `args fix --slug <slug> --findings work/audit/<slug>/human-...json` -> `wf-06b-fix-repeats.js` (снимок блоков, фиксер
   по правке и линтеру страницы, `fix-diff` - откат блока, который правка сломала, сборка: прототип, `check-html`,
   `check-site-js`, отчет). `--judge` - если правка большая: полный круг судьи после фиксера (за ним фиксер только
   сужает). Итог сборки - `build` результата (хвост вывода): строка `build-html:` (сборка упала), `check-html` blocked или
   `check-site-js` fail - сборка шага 8 (там одна пересборка, затем автостоп). Откат - находка снова `open` с причиной.
6. Показать дифф: `git diff -- <task>/work/pages/<slug>/page.md` (только эта страница) и статусы находок
   (`rejected` - с причиной). Превью. Коммит `Tekst <KKK> fix <slug>: <кратко>`.
7. Правка меняет состав блоков (добавить, убрать, переставить) - это не точечная правка: стратегия типа
   (`work/strategy.pages/<type>.json`: `exclude_blocks`, `block_overrides`) -> `merge-strategy.mjs` ->
   `build-briefs.mjs --force <slug>` -> цикл записи `--slugs <slug>` -> `args audit --slugs <slug> --all` -> wf-06
   -> сборка (шаг 8).

## Запреты

- НЕ пиши вне `texts/<KKK>-<slug>/` и `.claude/tmp/` (pre-commit worktree откажет): `sites/`, `structures/`, kit
  шаблона и `.claude/` правятся в своих задачах или в main-копии шаблона.
- НЕ правь копию kit в папке задачи на месте: проектное - в `overrides/`, алгоритм - в kit шаблона.
- НЕ импортируй анализ до его гейта без явного `--allow-ungated`; волны до гейта не пиши (шаг 7).
- НЕ спрашивай человека и НЕ жди его между стартом и сдачей: остановки - только пауза `--stop`, автостоп из таблицы и
  вопросы по коду 3 (`place`, `--facts-only`) и коду 2 `--facts-only`; переходы между фазами - без подтверждения.
- НЕ снимай автостоп без явного решения человека в чате; сняв, сразу выполни «После снятия».
- НЕ ставь и НЕ снимай паузу и автостоп через update-meta.sh - только `task.mjs stop`.
- НЕ запускай `wf-05` из другого воркфлоу: только верхним уровнем.
- НЕ читай большие JSON `work/` целиком и НЕ передавай их содержимое агентам: пути, `status`, коды выхода.
- НЕ выдумывай факты, цифры, реквизиты: только `work/facts.json`; пробел факта - вопрос заказчику в отчете, факт из
  правки заказчика - только F8xx с источником.
- НЕ ослабляй линтер ради прохода блока: причина чаще в брифе или стратегии (RUNBOOK, «Если что-то упало»).
- Длинное и среднее тире запрещены - только дефис; буква е-с-точками запрещена - всегда е.
- НЕ запускай другие скилы из этой сессии; перед закрытием worktree - `/handoff`.
