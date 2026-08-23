---
name: seo-tekst
description: Конверсионные тексты коммерческих страниц + единый HTML-прототип сайта (v7.1 - скил только пишет, анализ ЦА/конкурентов/разведка приходят готовыми из analyses/NNN). Мост данных -> состав страниц с гейтом (только без структуры) -> оффер-слой (strategy + 3 кандидата тона) -> скелеты по типам -> ГЕЙТ СКЕЛЕТОВ (Skeletons.docx в Google Doc, клиентское согласование состава блоков) -> ТОН-ГЕЙТ (3 варианта живой главной одним html) -> веер писателей -> копи-аудит + site-review + верификатор -> прототип одним файлом (wireframe, hash-роутер, стартовая страница-список) - клиентский деливерабл текстов; Texts.docx нет, prototype.html и tone-preview.html отдаются файлом + заливаются в Drive как файл (постоянная ссылка). Аргументы - [--from-structure NNN | --from-analysis NNN | --from-table путь] [--review|--auto] [--resume].
---

# seo-tekst v7

Скил-оркестратор: продающие тексты коммерческих страниц + один HTML-прототип на весь сайт. Запускается **в worktree-сессии**. Архитектура - [ADR-038](../../../docs/adr/038-tiered-analysis-and-writing-split.md) (разделение «анализ / письмо»), прототип - [ADR-039](../../../docs/adr/039-single-file-prototype.md), продающий пол - [ADR-037](../../../docs/adr/037-selling-floor.md), контракты данных - [upgrade-program-2026-08-22-tekst-v7-contracts.md](../../../docs/upgrade-program-2026-08-22-tekst-v7-contracts.md).

**Концепция v7 (манифест):**
1. **Скил только пишет.** ЦА, конкуренты, разведка направлений сделаны в `/seo-analiz` и приходят готовыми артефактами из `analyses/NNN/` - здесь их никто не пересобирает.
2. **Каждый шаг отвечает на один вопрос:** какие страницы -> как продаем -> из каких блоков -> каким тоном -> тексты -> контроль -> прототип. Отдельного документа с текстами нет (v7.1): деливерабл текстов - прототип, тексты в нем дословные; машиночитаемое для верстки - page.json + HANDOFF.md.
3. **Каждое правило называет исполнителя и мотив.** Правило без ответа «кто исполняет и зачем» в этот файл не вносится (урок v6).
4. **Деградация - только отсутствием данных** (ADR-031): нет `audience.json` - пишем без сегментов; нет recon направления - без разведки; `--from-table` без анализа - без всего аналитического слоя. Ни один пишущий агент не ветвится по источнику или tier.
5. **Клиентских точек четыре:** гейт состава страниц (только без структуры), запрос фактуры/материалов, ГЕЙТ СКЕЛЕТОВ (состав блоков по типам - Skeletons.docx в Google Doc, v7.1), ТОН-ГЕЙТ (выбор манеры на живой главной). Отдельного документа согласования анализа в текстах НЕТ - согласование прошло циклом A2 в `/seo-analiz`.

FAQ / плитку тегов / перелинковку / SEO-нормализацию НЕ делает - это `/seo-faq`.

## Аргументы

```
/seo-tekst [--from-structure <NNN> | --from-analysis <NNN> | --from-table <путь>]
           [--review|--auto] [--resume]
```

- `--from-structure <NNN>` - SEO-путь: «да»-страницы из `structures/<NNN>-*/`. Анализ находится через `structures/<NNN>-*/inputs.json` -> `analysis_dir`.
- `--from-analysis <NNN>` - путь без SEO: анализ есть (`analyses/<NNN>-*/`), структуры нет - состав страниц соберет `pages-planner v2` и подтвердит гейт (шаг 2).
- `--from-table <путь>` - аварийный ручной: готовая таблица URL/Тип/Маркер[/запросы] (csv/tsv). Анализа при этом обычно нет - это **штатная деградация**, а не ошибка: без audience/recon/leader_blocks, факты только из `ЗАКАЗЧИК.md`.
- `--auto` (по умолчанию) - без паузы перед доставкой прототипа. `--review` - пауза ПОСЛЕ сборки прототипа (шаг 7d), ПЕРЕД Drive-заливкой и отправкой заказчику (шаг 7e). Клиентские гейты (состав/фактура/скелеты/тон) обязательны в обоих режимах.
- `--resume` - продолжить по `meta.json`.

**Удалено в v7** (не принимать и не эмулировать): `--from-brief` (его путь теперь: `/seo-analiz --no-seo` -> `/seo-tekst --from-analysis`), `--mode A|B` (own_page определяется данными `directions[].url` еще в анализе), `--theme` (прототип всегда wireframe, ADR-039), `--scan-leaders/--no-scan/--recon/--no-recon` (опции ступени 3 `/seo-analiz`).

**Старт - найти анализ:**
- structure: `structures/<NNN>-*/` по glob; из его `inputs.json` взять `analysis_dir`. Не найдена структура - стоп с подсказкой `/seo-struktura`.
- analysis: `analyses/<NNN>-*/` по glob. Не найден - стоп с подсказкой `/seo-analiz`.
- Анализ найден, но `meta.json.state` не `approved`/`completed` - спросить одним вопросом: «Анализ NNN не согласован заказчиком. Тексты по несогласованному анализу могут уйти в корзину после его правок. Продолжить? [y/N]». Мотив: согласование смысловых решений живет в цикле A2, своего гейта анализа у текстов больше нет.
- table: анализ не ищем. Если в проекте есть `analyses/` - подсказать один раз, что `--from-analysis` даст ЦА и разведку, и продолжить по таблице, если пользователь настаивает.

## Артефакты задачи

```
texts/<NNN>-<slug>/
├── meta.json                      # state + format:"v7" + tone_gate + selling_floor_waivers + accepted_violations + drive-ревизии
├── inputs.json                    # мост: analysis_dir/structure_dir|null, tier, slug, domain, region; оркестратор: legal-блок из intake
├── pages.json                     # мост: страницы v2 - n/slug/url/type(Главная|Услуга|Категория|Товар|Инфо)/marker/queries/dir_slug|null
├── pages_draft.json               # (только без структуры) pages-planner v2: черновой состав + вопросы на гейт
├── leader_blocks.json             # мост: выжимка leader_scan v2 (blocks_by_type + features_to_steal); анализ без v2-полей - файла нет
├── facts.json                     # мост: семена из analyses/intake.json (вкл. own_page-факты) + ЗАКАЗЧИК.md; оркестратор дописывает по гейтам + lexicon
├── strategy.json                  # offer-strategist slim: decisions (register {tone_id,axes,source}) + tone_candidates[3] + формула/тезисы/канон/материалы
├── type_skeletons.json            # block-planner такт 1: скелет блоков на ТИП страницы + client_why (каталог: required листинг/галерея)
├── Skeletons_<slug>.docx          # build-skeletons-docx.mjs: гейт скелетов - «Блок / Зачем / Что внутри» по типам (-> Google Doc)
├── blueprints/<slug>.draft.json   # block-planner такт 2: состав/порядок/функции Р-Д-К-В/режимы/page_offer/sell
├── blueprints/<slug>.json         # slot-mapper: те же блоки + slots/limits/rules; писатели читают ТОЛЬКО финальный
├── tone/                          # тон-гейт (архив выбора; в prototype.html не входит)
│   ├── pages/<main>--t1|t2|t3/    # page.json + manifest.json + render.html - 3 варианта главной
│   ├── site_manifest.json         # оркестратор: 3 варианта как «страницы» превью
│   └── tone-preview.html          # assemble-prototype.mjs: один файл с 3 полными главными (-> Drive КАК ФАЙЛ)
├── pages/<page-slug>/
│   ├── page.json                  # page-writer (главная - копия выбранного тон-варианта); fill_notes - дыры фактуры, notes_internal - служебное
│   ├── manifest.json              # prototype-builder: копия + рендер-решения (источник истины страницы)
│   └── render.html                # build-prototype.mjs: блоки страницы БЕЗ shell
├── site_audit.json                # site-reviewer: самоповторы/H1/консистентность/touched/canonical_candidates/selling_floor_systemic
├── verify_report.json             # tekst-verifier, проход А (focus=structure): вердикт + находки с owner (НЕ чинит)
├── verify_report_factcheck.json   # tekst-verifier, проход Б (focus=factcheck): тот же формат, свой фокус
├── site_manifest.json             # оркестратор: pages[] + start:"__index" + main_slug - вход ассемблера и verify-prototype v2
├── prototype.html                 # assemble-prototype.mjs: ВЕСЬ САЙТ одним self-contained файлом - клиентский ДЕЛИВЕРАБЛ текстов (-> Drive КАК ФАЙЛ)
├── HANDOFF.md                     # build-handoff.mjs: контракт передачи дизайнеру/разработчику (+ pages/*/page.json - машиночитаемое для верстки)
└── share.json                     # ссылки Drive: {skeletons, tone_preview, prototype}; поля analysis/texts - legacy старых задач, не писать
```

Большие артефакты анализа (`audience.json`, `recon/`, `intake.json`, `brief.json`) НЕ копируются - агенты читают их по `inputs.json.analysis_dir` (read-only). Мотив: одна истина в `analyses/`, копия устаревает молча.

## State machine

```
init -> bridge-done -> [pages-drafted -> pages-approved -> pages-built]   # только без структуры
     -> strategy-done -> skeletons-done                                    # такт 1
     -> skeletons-shared [<-> skeletons-revising] -> skeletons-approved    # гейт скелетов (v7.1)
     -> blueprint-main-done                                                # такт 2 главной
     -> tone-written -> tone-shared [<-> tone-revising] -> tone-chosen
     -> blueprints-ready                                                   # такт 2 остальных
     -> texts-written -> copy-audited -> site-reviewed -> verified
     -> prototype-built -> shared -> completed                             # shared = прототип в Drive
```

Источник истины - `meta.json`, обновляется `bash .claude/hooks/update-meta.sh <texts_dir> <state>`. При init оркестратор пишет `"format": "v7"` - маркер нового конвейера.

**Resume-таблица** (`--resume`: найти `texts/<NNN>-*/`, прочитать `meta.json`, спросить «продолжить с state <state>? [Y/n]»):

| state | куда |
|---|---|
| `init` | шаг 1 (мост) |
| `bridge-done` | pages.json непустой -> шаг 3; пустой (источник pages_draft) -> шаг 2 |
| `pages-drafted` | гейт состава заново (закрытые ответы показать как текущий вариант, не переспрашивать) |
| `pages-approved` | повторный вызов моста (шаг 2, финал) |
| `pages-built` | шаг 3 |
| `strategy-done` | шаг 4a (перед ним - факт-гейт, если ответы заказчика не внесены) |
| `skeletons-done` | шаг 4b (гейт скелетов: docx + Drive-заливка) |
| `skeletons-shared` / `skeletons-revising` | показать Skeletons-документ заново, ждать ответа (правки - цикл 4b п.3) |
| `skeletons-approved` | шаг 4c (такт 2 главной) |
| `blueprint-main-done` | шаг 5 (тон-гейт с начала: писатели x3) |
| `tone-written` | шаг 5 с пункта verify/аудит/сборка превью |
| `tone-shared` / `tone-revising` | показать превью заново, ждать выбора (`meta.json.tone_gate` - что уже показано) |
| `tone-chosen` | шаг 6a (такт 2 остальных) |
| `blueprints-ready` | шаг 6b; финальный blueprint есть на каждую страницу - готовые НЕ перегенерировать |
| `texts-written` | шаг 6c (copy-auditor идемпотентен) |
| `copy-audited` | шаг 6d |
| `site-reviewed` | шаг 6e (оба прохода вычитки); ОБА отчета уже с `verdict:"pass"` - к шагу 7 |
| `verified` | шаг 7 (прототип) |
| `prototype-built` | шаг 7e (доставка: Drive + отправка заказчику) |
| `shared` | шаг 8 (финал) |

**Легаси-стоп.** В `meta.json` нет `"format": "v7"` или state вне словаря выше (`pages-ready`, `audience-done`, `analysis-shared`, `approved`, `prototypes-built`, `texts-shared`...) - задача начата скилом до v7. **Стоп**, ничего не конвертировать: «Задача старого формата. Довершай ее старым скилом (клон проекта до синка v7) либо начни новую задачу v7. Заметка миграции - docs/upgrade-program-2026-08-22-tekst-v7-restructure.md». Мотив: легаси-веток в v7 нет по решению владельца, полу-конвертация теряет данные молча.

## Шаги

### 0. Setup

**0a. Worktree-проверка:** `git rev-parse --git-dir` == `git rev-parse --git-common-dir` -> это main; предупредить (не блокировать): «для многозадачности переоткрой с галочкой worktree».

**0b.** Прочитать `ЗАКАЗЧИК.md`, если существует (короткий контекст клиента; отсутствие - норма).

**0c. NNN, slug, папка.**
- `--from-structure`: **NNN текстов зеркалит NNN структуры**; slug - из `structure_dir/inputs.json`.
- `--from-analysis`: slug - из `analyses/<NNN>-*/` (имя папки/brief); NNN - следующий свободный в `texts/`.
- `--from-table`: slug - из `ЗАКАЗЧИК.md` или домена таблицы; NNN - следующий свободный.
- Создать `texts/<NNN>-<slug>/`, записать **`.claude/tmp/current-task.txt` = `texts/<NNN>-<slug>/`** (без этого pre-commit откажет).
- `meta.json`: `{state:"init", format:"v7", source, review|auto, started, updated}`.

### 1. Мост данных (state == init)

```
.claude\scripts\_node.cmd .claude\scripts\read-tekst-input.mjs <texts_dir> --from-structure <structure_dir> | --from-analysis <analysis_dir> | --from-table <путь>
```

Скрипт (детерминированный, без агента) создает:
- `inputs.json` - `analysis_dir`, `structure_dir|null`, `tier` (`seo|basic` из meta анализа; при table - нет), slug, domain, `region_name`/`region_yandex` (код структуры; при --from-analysis код null - см. ниже), плюс КОПИИ из brief.json для читателей inputs: `brand_name`, `forbidden_wordings`, `not_in_assortment` (канон - brief; при --from-table пусто - деградация);
- `pages.json` v2 - русские типы (нормализация: Подуслуга->Услуга, Главная-каталог->Главная, Карточка товара->Товар, О компании/Контакты/Прочее->Инфо, Статья - исключается; нераспознанный тип -> Инфо + предупреждение в сводке) + спаривание `dir_slug` с `brief.directions` (пересечение токенов >= 50%; неспаренное -> `null` - без recon и сегментной ЦА). **При `--from-analysis` первый вызов отдает ПУСТОЙ pages.json** и ставит источник `pages_draft` - состав соберет шаг 2;
- `leader_blocks.json` - выжимка `blocks_by_type` + `features_to_steal` из `leader_scan.json` v2 (старый анализ без v2-полей - файла нет, это деградация данными);
- `facts.json` - семена из `analyses/intake.json` (включая подтвержденные own_page-факты, `source: "own_page:<url>"`) + `ЗАКАЗЧИК.md`; лексиконный слой (`client_wordings`, `internal_terms`, `client_metaphors`, `client_life_before_after`) мост берет из `analyses/intake_lexicon.json`, а при его отсутствии - из `intake.json` (легаси) и называет источник в своей сводке.

Exit 2 - нет целевых страниц (структура/таблица пустые) - стоп с подсказкой источника.

**После скрипта - оркестратор, вручную:**
- **legal-блок `inputs.json`** (`company, inn, ogrn, address, domain, email, phone, date` + `schedule`) - из `analyses/intake.json` (факты `requisites`, `contacts_geo`), фолбэк `ЗАКАЗЧИК.md`, чего нет - плейсхолдеры `[... - требует уточнения]`. Мотив «оркестратор, не скрипт»: intake хранит факты с провенансом и конфликтами - выбор действующего юрлица и актуального телефона требует суждения.
- **Реквизиты - в ДВА места одним ходом:** `facts.json.jur` (источник истины) И legal-блок `inputs.json` (оттуда их берет прототип: футер, cookie, юр-страницы, tel:-ссылка). Записано только в facts - в прототипе останется заглушка телефона и пустой ИНН. Расхождение двух мест недопустимо: правишь реквизит - правишь оба файла в один заход.
- **`inputs.json.region_yandex`** - если мост оставил null (путь --from-analysis: brief несет имя региона, не код) - дописать код Яндекса ЧИСЛОМ по `region_name` (справочник - `.claude/skills/seo-metategi/PLAYBOOK.md` р.8); без кода jm_wordstat стратега тихо выродится в федеральную частотность.

`update-meta.sh <texts_dir> bridge-done`. `pages.json` непустой -> шаг 3; пустой -> шаг 2.

### 2. Быстрая структура + ГЕЙТ состава (только без структуры; state == bridge-done)

Структуры сайта нет - состав страниц собирается из анализа и **подтверждается заказчиком до всех затрат** на тексты. `--from-structure` и `--from-table` этот шаг пропускают: их состав уже задан человеком.

**2a. Черновик.** Маркер: `.claude/tmp/expected-pages-planner-<run_id>.txt = <texts_dir>/pages_draft.json`. Делегировать `pages-planner`:
```
texts_dir: <texts_dir>
project_root: <корень проекта>
Прочитай inputs.json (analysis_dir) и из анализа: brief.json (directions[] - канон направлений, assortment, client_pages), audience.json (сегменты и их dir_slugs), recon/*.json (что публикуют конкуренты направлений), leader_blocks.json задачи (если есть). Собери pages_draft.json v2: состав страниц (Главная обязательна; type из словаря Главная|Услуга|Категория|Товар|Инфо; у каждой страницы dir_slug из brief.directions - новое направление НЕ выдумывай, оформи вопросом на гейт), confidence по странице, questions (спорные страницы/дробление), missing_facts. Состав сугубо конверсионный, без SEO-соображений. Сводка <= 8 строк.
```
После возврата планировщика: `update-meta.sh <texts_dir> pages-drafted` (обрыв на гейте
возобновится с гейта, черновик и примененные ответы не перетираются).

**2b. ГЕЙТ (обязательный).** Оркестратор:
1. Таблица состава в чат: `№ | Название (маркер) | Тип | dir_slug | откуда`. Страницы `confidence:"low"` пометить.
2. `questions` из `pages_draft.json` -> **AskUserQuestion** (до 4 за раз, поля почти дословно). Вопросов нет - один вопрос «состав ок или правим?».
3. Ответы применить к `pages_draft.json` (снятые - `include:"нет"`, добавленные дописать; страница нового направления - только после явного «да» заказчика) и ЗАФИКСИРОВАТЬ: у каждого отвеченного вопроса `questions[].answer = "<ответ>"` (машинный признак для resume - отвеченное не переспрашивается). `update-meta.sh <texts_dir> pages-approved`.

**2c. Финал состава - повторный вызов моста:**
```
.claude\scripts\_node.cmd .claude\scripts\read-tekst-input.mjs <texts_dir> --from-draft <texts_dir>/pages_draft.json
```
Скрипт пишет финальный `pages.json` v2 (слаги по `_slug.mjs`; `dir_slug` берет готовым от планировщика). `update-meta.sh <texts_dir> pages-built`. К шагу 3.

### 3. Оффер-слой (state == bridge-done | pages-built)

Маркер: `.claude/tmp/expected-offer-strategist-<run_id>.txt = <texts_dir>/strategy.json`. Делегировать `offer-strategist`:
```
texts_dir: <texts_dir>
project_root: <корень проекта>
Прочитай inputs.json (analysis_dir, tier, domain), pages.json, facts.json, leader_blocks.json (если есть); из analysis_dir: audience.json (ЦА готова - не пересобирай), intake.json (client_metaphors / client_wordings / internal_terms - кандидаты в идею и словарь), recon/*.json (offers_seen - от чего отстраиваемся), brief.json (УТП, запреты). MCP - по MCP_MAP.md (сигнал прогретости + сайт клиента). Собери strategy.json v2:
- decisions: positioning/idea/price_presentation/cta_tone (chosen = recommended, source:"default"); register = {tone_id:null, axes:null, source:"pending"} - его заполнит тон-гейт;
- tone_candidates: РОВНО 3 кандидата тона {tone_id, name, recommended (один true), axes {a,b,c}, note - что смягчено/усилено под этого заказчика и почему}; палитра тонов - в твоей инструкции;
- offer_formula_recipe, selling_theses (с метками выгода/гигиена/гордость), proof_inventory (уровни 1-3), canonical_wordings, honest_limits, refusal_criteria, materials_have/materials_missing.
design_theme и черновики первых экранов НЕ пиши - их в v7 нет. Числа - только из facts.json. Сводка <= 8 строк.
```

**Факт-гейт (оркестратор, ДО планировщика).** Прочитать точечно `strategy.materials_missing` и дыры `facts.json`. **Критичные** (реквизиты юрлица; цены, если `price_presentation` обещает цифру; материалы под доказательства, без которых страницы не соберутся) - спросить в чате сейчас, одним сообщением, с честной припиской: «чего не дадите - останется пометкой [ЗАПОЛНИТЬ], выдумывать не буду». Туда же вопрос объема (ADR-035): «по каждому наполняемому разделу (кейсы, товары, отзывы, сертификаты) - сколько единиц К ЗАПУСКУ: 3, 10, 50? Раздел без объема поставим честной заглушкой». **Некритичное конвейер не держит** - поедет запиской тон-гейта (шаг 5).
Ответы: числа/реквизиты/гарантия -> `facts.json` (реквизиты - в оба места, шаг 1); материалы и объемы -> `strategy.materials_have` (из `materials_missing` удалить). Жесткий порядок - **ДО шага 4**: facts-gate и materials-gate планировщика читают эти файлы, внесенное позже не спасет блок от режима «шаблон».
**Ревизия facts.json** (обязательна: ошибку здесь ниже не поймает никто - писателю запрещены числа со стороны): юрлица по буквам против источника; формулировки заказчика дословно; `publish`/запреты не перепутаны; у каждой цифры видно, к чему она привязана. Сомнение - не факт: `[ЗАПОЛНИТЬ]` и вопрос заказчику.

**Лексикон, половина 1** (`translate` + `locked` по основаниям а/б) - собрать сейчас, см. раздел «Словарь проекта». `update-meta.sh <texts_dir> strategy-done`.

### 4. Скелеты блоков (state == strategy-done -> blueprint-main-done)

**4a. Такт 1 - скелет на ТИП страницы (state == strategy-done).** Маркер: `.claude/tmp/expected-block-planner-<run_id>.txt = <texts_dir>/type_skeletons.json`. Делегировать `block-planner`:
```
texts_dir: <texts_dir>
project_root: <корень проекта>
tact: 1
Прочитай pages.json (какие типы присутствуют), leader_blocks.json (coverage/typical_order - доводы, не пропуск: блок без функции не ставится даже при покрытии 100%), BLOCKS.md, strategy.json (формула, тезисы). Собери type_skeletons.json: скелет на каждый присутствующий тип - blocks[] {block, function Р|Д|К|В, required, opts, status гигиена|отстройка, evidence, notes, client_why - зачем блок ОДНОЙ строкой клиентским языком, без жаргона Р/Д/К/В и кухни (пойдет заказчику в Skeletons.docx)} + order_hint. Каталог обязателен: у типа Категория - «Листинг товаров» с opts.filter=true (required), у типа Товар - product-gallery (required); это проверит verify-prototype v2. Сводка <= 8 строк.
```
**Сводка скелетов - в чат**: по типу одной строкой - блоки по порядку, required и отстройка помечены (владелец видит каркас до клиентского гейта). `update-meta.sh <texts_dir> skeletons-done`.

**4b. ГЕЙТ СКЕЛЕТОВ - клиентский (state == skeletons-done).** Состав блоков согласуется с заказчиком ДО тон-гейта и веера писателей (v7.1, контракт 3.3а). `--auto` гейт НЕ пропускает.
1. Документ:
```
.claude\scripts\_node.cmd .claude\scripts\build-skeletons-docx.mjs <texts_dir>
```
Скрипт из `type_skeletons.json` + `pages.json` собирает `Skeletons_<slug>.docx`: по каждому ТИПУ страницы таблица «Блок / Зачем / Что внутри» (`client_why` + `notes` клиентским языком) + список страниц этого типа.
2. Drive (блок «Drive» ниже): загрузить С конверсией в Google Doc (как A2); конверсия упала - fallback: повторить с `convertToGoogleFormat:false`. Нет `texts_folder_id` - НЕ блокировать: отдать локальный docx, в сводке подсказать `/share-tekst <NNN>`. Ссылка -> `share.json.skeletons`. `update-meta.sh <texts_dir> skeletons-shared`. **Пауза** - ждать ответа заказчика.
3. **Правки** -> `update-meta.sh <texts_dir> skeletons-revising`; `block-planner` такт 1 ТОЧЕЧНО: в промте перечислить только изменившиеся типы и правки заказчика дословно, скелеты остальных типов не трогать. Затем re-docx (п.1) + re-upload новой ревизией (`share.json.skeletons.revisions[]`) -> обратно `skeletons-shared`. Цикл до согласования.
4. **«Согласовано»** -> `update-meta.sh <texts_dir> skeletons-approved`. Согласованный на гейте состав - КАНОН для такта 2: смена состава дальше - только фидбеком тон-гейта или `/seo-tekst-fix`.

**4c. Такт 2 - только ГЛАВНАЯ (state == skeletons-approved)** (к тон-гейту). `main_slug` = страница `type:"Главная"` из `pages.json`; нет такой - первая по `n`. Два последовательных одиночных вызова с маркерами:
- `block-planner` (`tact: 2`, `pages_subset: ["<main_slug>"]`): читает type_skeletons (свой тип - основа), strategy.json (решения; register пока pending - состав главной по ДЕЛОВОМУ дефолту оси А, tone_candidates планировщик не читает; манеру кандидатов дадут писатели на тон-гейте), facts.json (facts-gate: под блок нет фактов - режим по ADR-035), audience.json summary (по analysis_dir), recon своей страницы по dir_slug (`own_page.blocks` - keep-правила, must_have/gaps; `facts_seen` НЕ читает). Пишет `blueprints/<main_slug>.draft.json`: состав/порядок, функции + `function_why` (ADR-032), режимы рабочий/шаблон/заглушка (ADR-035), `page_offer` (механическая развертка `offer_formula_recipe` - не сочиняет, а переносит) и `sell` (<= 160 знаков) у каждого содержательного блока (ADR-037).
- `slot-mapper` (`pages_subset: ["<main_slug>"]`): черновик + fragments-manifest + BLOCKS.md -> финальный `blueprints/<main_slug>.json` (те же блоки + slots/limits/rules; **состав не меняет** - решения только у планировщика).

Проверка полноты: в черновике непустой `page_offer` и `sell` у содержательных блоков; финал совпадает по составу с черновиком. Недостающее - ре-делегировать (до 2). `update-meta.sh <texts_dir> blueprint-main-done`.

### 5. ТОН-ГЕЙТ (state == blueprint-main-done)

Заказчик выбирает манеру разговора на ПОЛНОЙ живой главной, а не по ярлыкам (ADR-034: точка выбора - здесь; ADR-038). Порядок жесткий - контракт 3.4.

**5a. Писатели x3** (параллельно одним сообщением, БЕЗ маркеров). На каждый `tone_candidates[N]` делегировать `page-writer`:
```
texts_dir: <texts_dir>
project_root: <корень проекта>
page_slug: <main_slug>
blueprint: blueprints/<main_slug>.json
out_dir: tone/pages/<main_slug>--<tone_id>/
register: {tone_id: "<tone_id>", axes: {a: "...", b: "...", c: "..."}}   # оси ЭТОГО кандидата
note: "<note кандидата дословно - оттенок: что усилено/смягчено и почему>"
Пиши главную по blueprint в этой манере. Все остальное - твой штатный контракт: числа только из facts.json, page.json в out_dir, fill_notes - только дыры фактуры, notes_internal - служебное.
```

**5b. Механический пол по каждому варианту:**
```
.claude\scripts\_node.cmd .claude\scripts\verify-copy.mjs <texts_dir>/tone/pages/<main_slug>--tN/ --root <texts_dir>
```
Корень задачи - параметром (blueprint ищется как `main.json`, waiver - по `page:"<main_slug>"`, не по имени варианта). Exit 2 - пере-делегировать писателя этого варианта со списком нарушений (до 2).

**5c. Копи-аудитор лайт** по каждому варианту (веер x3, без маркеров): `texts_dir`, `page_dir: tone/pages/<main_slug>--tN/`, `lite: true` + весь вывод verify-copy (и предупреждения). Чинит П.0 (смысл/грамотность/самопротиворечия) и механику на месте. **Пол F1-F4 не судит** - на тон-гейте пол уже проверен машинно (5b), суждение по полу - зона верификатора в общей цепочке (ADR-037). `meta.json.tone_gate = {status:"written"}`; `update-meta.sh <texts_dir> tone-written`.

**5d. Сборка превью.** `prototype-builder` x3 (веер, без маркеров): `texts_dir`, `page_dir: tone/pages/<main_slug>--tN/` - пишет `manifest.json` (включая doc-уровень: legal из inputs.json, титул/мета) и гонит `build-prototype.mjs <page_dir>` -> `render.html`. Затем оркестратор пишет `tone/site_manifest.json`:
```json
{ "pages": [ { "slug": "<main_slug>--t1", "title": "Вариант 1 - <name>", "type": "Главная", "order": 1 } ],
  "start": "__index", "main_slug": "<main_slug>--<tone_id рекомендованного кандидата>" }
```
и собирает превью:
```
.claude\scripts\_node.cmd .claude\scripts\assemble-prototype.mjs <texts_dir>/tone <texts_dir>/tone/tone-preview.html
```

**5e. Заказчику - превью + записка.** Записка (текст сохранить в `meta.json.tone_gate.note` - его же читает build-handoff):
- 3 варианта главной в одном файле `tone/tone-preview.html` (стартовая страница - список), выбрать номер или прислать правки;
- **канон формулировок** построчно из `strategy.canonical_wordings`: `client_variant` (ваша фраза) / `wording` (как будет на сайте) / короткое почему (ADR-037 п.9) + строка «эти формулировки повторятся слово в слово на каждой странице - поправьте сейчас, потом правка идет по всему сайту разом»;
- **materials_missing**: «этих материалов и цифр у нас нет - чего не дадите, останется пометкой [ЗАПОЛНИТЬ]»;
- если среди кандидатов есть ось А = `отбирающий` - отдельной строкой, ДО выбора: «Вариант N разговаривает не со всеми: заявок станет МЕНЬШЕ, качество выше. Это осознанный размен - подтвердите его явно». Молча отбирающий вариант не ставить.

Превью - заказчику ФАЙЛОМ (`tone/tone-preview.html`) И в Drive КАК ФАЙЛ (блок «Drive»: `convertToGoogleFormat:false`, постоянная ссылка) -> `share.json.tone_preview`; Drive недоступен / нет `texts_folder_id` - не блокировать: локальный файл + подсказка `/share-tekst <NNN>`.

`meta.json.tone_gate = {status:"shared", note:"...", chosen_tone_id:null, feedback:null}`; `update-meta.sh <texts_dir> tone-shared`. **Пауза** (клиентский гейт, `--auto` его не пропускает).

**5f. Ответ заказчика:**
- **Выбор варианта** -> `tone-chosen`:
  1. Скопировать `tone/pages/<main_slug>--tN/page.json` -> `pages/<main_slug>/page.json`; фидбек-правки к нему применяет `copy-auditor` (не оркестратор руками).
  2. `strategy.json.decisions.register = { "tone_id": "<tN>", "axes": {a,b,c копией из выбранного кандидата}, "source": "tone-gate" }`. Старой формы (индексы, axes-массивы, axes_from) в v7 НЕТ - не писать.
  3. Если ось А выбранного кандидата отличается от оси, под которую строился blueprint главной (машинный адрес сравнения: `blueprints/<main_slug>.json` -> `register.a` - эхо такта 2; по умолчанию там деловой дефолт) - повторить такт 2 главной (block-planner + slot-mapper), затем `page-writer` **дописывает новые блоки в выбранной манере** (готовые тексты не перетирать).
  4. Перенести подтвержденный канон в `facts.json.lexicon.canonical` (раздел «Словарь проекта»); правки записки применить к `strategy.canonical_wordings` до переноса.
  5. `meta.json.tone_gate.status = "chosen"` + `chosen_tone_id` + `feedback`; `update-meta.sh <texts_dir> tone-chosen`.
- **Правки без выбора** -> `meta.json.tone_gate.status = "revising"` + `update-meta.sh <texts_dir> tone-revising`; применить к затронутому варианту (`copy-auditor`), пересобрать его `render.html` (`build-prototype.mjs`) + `assemble-prototype.mjs` заново, перезалить `tone-preview.html` новой ревизией (`share.json.tone_preview.revisions[]`), показать снова (`tone-shared` обратно). Цикл до выбора.
- **«на ваше усмотрение»** -> взять кандидата `recommended:true`, `register.source = "recommended"`, дальше как выбор.

Финальная главная дальше проходит штатную цепочку 6c-6e вместе со всеми страницами - лайт-аудит тон-гейта полный контроль не заменяет.

### 6. Веер остальных страниц

**6a. Такт 2 остальных (state == tone-chosen).** `block-planner` (`tact: 2`) по всем страницам кроме главной: <= 12 страниц - один вызов с маркером `.claude/tmp/expected-block-planner-<run_id>.txt = <texts_dir>/blueprints/`; больше - пачками по 8-10, группируя по типу (anti-duplication внутри типа), маркеры НЕ ставить. Вход тот же, что в 4b, плюс `strategy.decisions.register` уже заполнен - **ось А определяет состав** (CTA-места, форма, цена, «кому не подойдем»), ось Б - допустимость метафоры. Регистр расширяет разрешенное, но не сужает запрещенное: стоп-листы, тест ФАС и «числа только из facts.json» действуют в любом тоне.
Затем `slot-mapper` теми же пачками (`pages_subset`). Проверки полноты - как в 4b, на каждую страницу. Ре-делегация до 2. `update-meta.sh <texts_dir> blueprints-ready`.

**6b. Писатели (state == blueprints-ready).** `page-writer` веером **пачками по 6-8** (без маркеров) на каждую страницу, кроме главной (ее page.json уже есть):
```
texts_dir: <texts_dir>
project_root: <корень проекта>
page_slug: <slug>
Blueprint: blueprints/<slug>.json. Регистр - strategy.decisions.register (оси выбраны заказчиком на тон-гейте). Эталон манеры - pages/<main_slug>/page.json: равняйся по тону, фразы не копируй. Числа только из facts.json; свой recon по dir_slug из analysis_dir (чужое - форма, не цифры; facts_seen не читай). Если в recon страницы есть own_page.url - можешь снять живую страницу seo_fetch_page (фактура и удачные формулировки заказчика). fill_notes - только дыры фактуры [ЗАПОЛНИТЬ]; notes_internal - служебное.
```
После: `pages/<slug>/page.json` на каждую; недостающие - ре-делегировать (до 2). `update-meta.sh <texts_dir> texts-written`.

**6c. Копи-аудит + механический шлюз (state == texts-written).** По КАЖДОЙ странице (включая главную):
```
.claude\scripts\_node.cmd .claude\scripts\verify-copy.mjs <texts_dir>/pages/<slug>/ --root <texts_dir>
```
Передать `copy-auditor` (веер 6-8, без маркеров) **весь вывод - и нарушения, и предупреждения** (`!`/`~` по коду возврата не видны, а решение по ним принимает редактор). Аудитор чинит на месте по приоритету: смысл и грамотность -> удар в боль ЦА -> чистота (утечка кухни, жаргон, штампы, манипуляции, повторы, лимиты). Анти-ИИ не делает (ADR-022).

Затем verify-copy еще раз - как гейт:
- exit 2 «в page.json нет блоков из blueprint» - не работа редактора: пере-делегировать `page-writer` страницы (до 2), затем аудит + скрипт;
- exit 2 прочее - `copy-auditor` страницы со списком (до 2);
- exit 1 (нет page.json) - `page-writer` как в 6b.

**Пол F1-F4 ветвится по владельцу** (ADR-037): в словах (кнопка из стоп-листа, Hero без обещания) - `copy-auditor`; нет CTA вовсе (F3) или нет блока Д (F4) - возврат к такту 2 (`block-planner` + `slot-mapper` + `page-writer` по этим slug), текстом это не лечится. Причина - решение заказчика или дыра материалов -> не круг правок, а строка `meta.json.selling_floor_waivers` `{page, rule (одно из F1-F4), why, source}` с одним из трех законных оснований: `decisions.<key>.chosen` / `strategy.materials_missing[<пункт>]` / `ложное срабатывание: <правило> не применимо к <тип/рецепт>` (третье - обязательно в финальную сводку). Waiver без непустого `source` скрипт игнорирует.
**Аварийный выход:** третья неудача по странице - не дочинивать до зеленого (валидатор может ошибаться): `meta.json.accepted_violations += {page, rule, why}`, строка в финальной сводке, идти дальше. Для находок пола - только waiver с основанием, не accepted_violations.
Все страницы прошли -> `update-meta.sh <texts_dir> copy-audited`.

**6d. Кросс-страничный аудит (state == copy-audited).** Маркер: `.claude/tmp/expected-site-reviewer-<run_id>.txt = <texts_dir>/site_audit.json`. Делегировать `site-reviewer` (один вызов):
```
texts_dir: <texts_dir>
Все pages/*/page.json + VOICE.md + strategy.decisions (вкл. register) + facts.json (lexicon - канон и locked повторяй ДОСЛОВНО, не перефразируй: дословный повтор факта - признак цельного сайта, ADR-033) + inputs.json (forbidden_wordings). Blueprint НЕ читаешь - правка не длиннее исходной строки. Эталон тона - pages/<main_slug>/page.json (выбран заказчиком): выравнивай манеру остальных под нее. Ищи: межстраничные самоповторы пояснительной прозы (переписывай по делу страницы), уникальность H1/Title, консистентность decisions и цифр (по facts.json), утечку кухни. site_audit.json: touched[] / unfixed[] / canonical_candidates[] / selling_floor_systemic[]. Сводка <= 8 строк.
```
После - строго в этом порядке (механический гейт последним, иначе тире/лимиты уедут в прототип):
1. по `touched[]` - `copy-auditor` каждой затронутой страницы (site-reviewer - последний, кто трогал текст);
2. `verify-copy.mjs` по затронутым (exit 2 -> аудитор, до 1, скрипт снова);
3. `canonical_candidates[]` -> `facts.json.lexicon.canonical` (`origin:"формула"`) **до 6e** - у ревьюера нет прав писать в facts.json, без переноса канон не увидят ни верификатор, ни HANDOFF; плейсхолдеры не переносить;
4. `selling_floor_systemic[]` непустой (провал пола, одинаковый на всех страницах) - строкой в сводку и решение о возврате к `block-planner` (6a) или `offer-strategist` (шаг 3) ДО верификатора.
`update-meta.sh <texts_dir> site-reviewed`.

**6e. Финальная вычитка - ДВА прохода (state == site-reviewed).** Слой суждения (ADR-025): ничего не чинит. Один проход находит не все; второй с ДРУГОЙ постановкой задачи удваивает улов важных находок - при том что все они лежат в одних и тех же файлах с самого начала. Поэтому `tekst-verifier` зовется ДВАЖДЫ, **параллельно одним сообщением и БЕЗ expected-маркеров** (два одновременных стопа дают ложный отказ single-marker хука, ADR-012; полноту проверяет оркестратор по файлам):

- **проход А** - `texts_dir`, `project_root`, `focus: structure`, `out_file: verify_report.json`. Сверяет: полноту страниц/блоков/метатегов, функции и баланс блоков (ADR-032), словарь lexicon (ADR-033), выдержанность decisions включая register новой формы (ADR-034), чистоту клиентского текста, продающий пол F1-F4 (ADR-037; валидный waiver понижает до minor), счет блоков живых страниц.
- **проход Б** - `texts_dir`, `project_root`, `focus: factcheck`, `out_file: verify_report_factcheck.json`. Сверяет: каждое число и реквизит против `facts.json`, межстраничные противоречия чисел и обещаний, тексты против самих себя. В промт этого прохода добавить дословно: «`site-reviewer` уже прошел и мог что-то починить - проверяй по текущему состоянию файлов, а не по его отчету».

Фокус и имя файла - обязательные параметры обоих вызовов: без них агент останавливается. Проход не записал свой отчет - ре-делегировать ЭТОТ проход (до 2), не записывать за него и не подменять его вторым отчетом.

**Объединение.** Оба отчета на месте - находки складываются в ОДИН список, счетчики суммируются, решение принимается по **ХУДШЕМУ вердикту** двух проходов (`fail` > `needs-fix` > `pass`). Проход А с `pass` не отменяет `needs-fix` прохода Б.

Ветвление ТОЛЬКО по машинным полям объединенных отчетов (`verdict`, `counters`, `owner`, `needs_human`, `fix_hint`):
- `fail` (структурный дефект) - чинить по owner, перезапустить ОБА прохода; два круга без выхода - стоп, отчет человеку;
- `needs-fix` - раздать находки по `owner` (**лимит 2 круга**, затем перезапуск ОБОИХ проходов): `copy-auditor` (локальная чистота) / `page-writer` (блок переписать целиком, затем аудит + verify-copy) / `block-planner` (структурное: возврат на такт 2 + slot-mapper + писатель; но сначала `fix_hint` - «материалов нет» перепланированием не лечится: это waiver `F4` c `source: strategy.materials_missing[...]`, а не круг) / `оркестратор` (facts.json, lexicon, decisions - чинишь сам, агентов не звать);
- находки пола: F2-словами и кнопка F3 - аудитор; F1/F3-нет-CTA/F4 - планировщик; F2 без цифры и адресата в facts - `needs_human`, вопрос заказчику, не круг правок;
- пережившее 2 круга и `needs_human` - в `accepted_violations` (пол - в `selling_floor_waivers` с основанием), сводка, дальше;
- `pass` у ОБОИХ проходов - `update-meta.sh <texts_dir> verified`; `minor` не блокируют - списком в сводку.

**Гейт проходится заново после любого изменения артефакта.** Тексты страниц изменились любым способом - сборка, сжатие, точечная правка, применение ответов клиента - значит финальный гейт вычитки проходится заново, полностью (оба прохода). Частичная перепроверка «только правленого куска» не допускается: находки прошлого прохода не переносятся, отчеты перезаписываются.

### 7. Прототип - один файл (state == verified)

Отдельного документа с текстами больше нет (v7.1): после `verified` - сразу прототип, он и есть клиентский деливерабл текстов.

**7a. `site_manifest.json`** пишет оркестратор из `pages.json`:
```json
{ "pages": [ { "slug": "<slug>", "title": "<название для списка>", "type": "<тип>", "order": <n> } ],
  "start": "__index", "main_slug": "<main_slug>" }
```
Документ-уровень (legal, титул, мета) ассемблер возьмет из `manifest.json` страницы `main_slug` - его пишет prototype-builder, как и раньше.

**7b. Веер `prototype-builder`** пачками по 6-8 (без маркеров), на каждую страницу: `texts_dir`, `project_root`, `page_slug`. Каждый пишет `manifest.json` (рендер-решения, режимы блоков ADR-035; у главной - и doc-уровень по legal-блоку `inputs.json`), гонит `build-prototype.mjs <page_dir>` -> `render.html`. Тема всегда wireframe; попапов, transitions и цветных тем в v7 нет (ADR-039). После веера: `render.html` + `manifest.json` на каждую страницу; недостающие - ре-делегировать (до 2).
**Сборщик тронул `page.json`** (заглушка, срезанный слот - видно по сводке) - это штатно: `page.json` остается источником истины для верстки (HANDOFF), прототип пересоберется из манифестов на 7c. Отметить строкой в сводке.

**7c. Сборка и проверка:**
```
.claude\scripts\_node.cmd .claude\scripts\assemble-prototype.mjs <texts_dir>
.claude\scripts\_node.cmd .claude\scripts\verify-prototype.mjs <texts_dir>
```
Ассемблер собирает `<texts_dir>/prototype.html`: стартовая секция-список, секции страниц с неймспейсом `<slug>__id` (формы - `<slug>__leadForm`), hash-роутер `#p/<slug>`, финальные normYo/bindHanging по всему документу. verify-prototype v2 проверяет per-page (по манифестам против секций, required-блоки каталожных типов, ровно 1 форма на секцию) и глобально (контракт-плашка, полнота навигации, дубли id, типографика). Exit 2: находка страницы - `prototype-builder` этой страницы + пересборка ассемблером; находка site_manifest/доков - оркестратор сам; до 2 кругов, затем аварийный выход как в 6c.

**7d. Передача:**
```
.claude\scripts\_node.cmd .claude\scripts\build-handoff.mjs <texts_dir>
```
`HANDOFF.md`: что сохранить дословно, что переопределяется дизайном, чего намеренно нет, [ЗАПОЛНИТЬ] и правила заполнения. Пересобирается при КАЖДОЙ новой версии прототипа (в т.ч. после `/seo-tekst-fix`). `update-meta.sh <texts_dir> prototype-built`.

**7e. Доставка (state == prototype-built).** **`--review`: пауза ЗДЕСЬ** - «прототип собран - заливаю в Drive и отправляю заказчику? [Y/n/правки]» (`--auto` - без паузы; клиентские гейты уже пройдены). Затем:
- `prototype.html` - заказчику ФАЙЛОМ И в Drive КАК ФАЙЛ (блок «Drive»: `convertToGoogleFormat:false`, постоянная ссылка) -> `share.json.prototype` `{file_id, link, uploaded_at, revisions[]}`; Drive недоступен / нет `texts_folder_id` - не блокировать: локальный файл + подсказка `/share-tekst <NNN>`;
- для верстки - `HANDOFF.md` + `pages/*/page.json` (машиночитаемый деливерабл; Google Doc с текстами в v7.1 НЕ собирается - тексты дословно живут в прототипе).

`update-meta.sh <texts_dir> shared`.

### 8. Финал (state == shared)

`update-meta.sh <texts_dir> completed`. Финальный коммит:
```bash
git add -A
git commit -m "Tekst <NNN> for <slug>: <N> страниц (тон <chosen_tone_id>, прототип одним файлом)"
```
Вывести:
```
═══ ТЕКСТЫ + ПРОТОТИП ГОТОВЫ ═══
Клиент: <domain|slug>   Страниц: <N>   Тон: <chosen_tone_id> «<name>» (выбор заказчика | recommended)
🧪 Кросс-аудит: <site_audit verdict>   🔍 Вычитка (2 прохода): <худший вердикт> | замечаний: <N> (структура <a> + факт-чек <b>)
🖥 Прототип (деливерабл, один файл, все страницы): texts/<NNN>-<slug>/prototype.html | Drive: <share.json.prototype.link>
📋 Скелеты (согласованы на гейте): <share.json.skeletons.link>
🎭 Тон-превью (архив выбора): texts/<NNN>-<slug>/tone/tone-preview.html | Drive: <share.json.tone_preview.link>
📎 Передача дизайнеру/разработчику: texts/<NNN>-<slug>/HANDOFF.md + pages/*/page.json (прикладывать вместе с прототипом)
📌 [ЗАПОЛНИТЬ]-пометки: <count> (реальные цифры/отзывы/фото - см. незакрытое из materials_missing)
⚖️ Снятые правила пола: <rule> на <page> - <why> (основание: <source>)   (строка на каждый waiver; нет - не выводить)
⚠️ Принятые расхождения: <page>: <rule> - <why>                          (по accepted_violations; нет - не выводить)
Дальше: /seo-tekst-fix <NNN> "..." - правки | /handoff - перенести в main
   (при tier=seo добавить в эту строку: | /seo-faq <NNN> - SEO-блоки поверх готовых страниц)
═══════════════════════════
```
`/seo-faq` предлагать ТОЛЬКО при `inputs.json.tier == "seo"`: при basic проект SEO не покупал (предложить, только если заказчик сам спросит про поисковый трафик).

## Словарь проекта (facts.json.lexicon) - работа оркестратора

Три списка; агенты словарь только читают (файл у них и так в обязательном чтении). Ключа нет - все работает без него (ADR-031). Ни один агент половины словаря не спаривает - это ручная работа оркестратора:

- **`translate`** (собрать на шаге 3, до скелетов): пройти по `analyses/audience.json.audience_wordings[]` (`{phrase, means, from}`) и для каждой строки найти, каким словом ТО ЖЕ явление называет заказчик - термины брать из лексиконного слоя интейка `analyses/<NNN>/intake_lexicon.json` (факты `internal_terms` / `client_wordings` / `client_metaphors`). **Если `intake_lexicon.json` есть - лексиконные факты берутся из него. Если файла нет - лексиконные факты ищутся в `intake.json.facts[]` по тем же именам полей (легаси-режим однослойного интейка). Отсутствие обоих - не авария, лексикон просто пуст.** В сводку шага - одной строкой, откуда взят лексикон (`intake_lexicon.json` | `intake.json (легаси)`). Совпало - `{internal, public: <phrase>, why}`. Пары нет - строка не входит; подбирать «похожее» самому нельзя. Таблица задает лексему, не якорь замены - грамматику подгоняет писатель.
  **Фильтр по провенансу (обязательный, ADR-040/ADR-033).** В `public` идет только строка, чей `from` - живая речь (`forum:<домен>`) либо формулировка, подтвержденная заказчиком (фактура интейка, ответы цикла A2, правки записки). Строка с `from: persona:*` или без `from` - реконструкция агента, а не чьи-то слова: в `public` она НЕ идет, даже если кажется точнее. Публикация в A2 подтверждением НЕ является: A2 печатает и реконструкции, там провенанс виден колонкой источника, а в `lexicon.translate` колонки нет - слово уедет на живую страницу голым. Спорная строка - вопрос заказчику, а не догадка оркестратора.
- **`canonical`** (перенести на `tone-chosen`, после показа записки): `strategy.canonical_wordings` -> `lexicon.canonical` `{thought, wording, where, origin, client_variant}`. Переносится ПОДТВЕРЖДЕННАЯ заказчиком редакция - правки записки сначала применяются к `strategy.canonical_wordings`. `origin`: `формула` (дефолт) / `проверяемый факт` / `клиент-требование`; `client_variant` ложится РЯДОМ, не вместо. Строки с `[ЗАПОЛНИТЬ` / «требует уточнения» НЕ переносить - плейсхолдер в роли канона размножится по всему сайту.
- **`locked`** (по ходу гейтов): только по трем основаниям ADR-033/037, и `source` обязан называть основание - (а) юридическая/реквизитная формулировка; (б) слоган, самоназвание, торговая марка; (в) заказчик явно потребовал сохранить дословно (на факт-гейте, в записке тон-гейта, в правках). Реплика из транскрипта - никогда автоматически. Одну мысль не заводить и в locked, и в canonical.
  **locked не пробивает машинные инварианты:** лимит H1, «числа только из facts.json», типографика действуют и на locked-строку. Не влезает - вопрос заказчику, а не `accepted_violations`.

## Drive (три загрузки задачи)

Прочитать `~/.claude/seo-knowledge/DRIVE.md` -> `texts_folder_id`. Ключа нет / `TODO_*` - НЕ блокировать: пропустить загрузку, оставить локальные файлы, в сводке подсказать «создай папку в Drive, впиши ID в DRIVE.md, затем /share-tekst <NNN>». Все загрузки - `mcp__gdrive-piotr__uploadFile` с `parentFolderId:<texts_folder_id>`:

| Файл | Шаг | Параметры | share.json |
|---|---|---|---|
| `Skeletons_<slug>.docx` | 4b | `name:"Skeletons_<slug>"`, mimeType docx, `convertToGoogleFormat:true` (Google Doc, как A2); ошибка конверсии - повторить с `false` | `skeletons` |
| `tone/tone-preview.html` | 5e | `convertToGoogleFormat:false`, `mimeType:"text/html"` - КАК ФАЙЛ, без конвертации | `tone_preview` |
| `prototype.html` | 7e | `convertToGoogleFormat:false`, `mimeType:"text/html"` - КАК ФАЙЛ, постоянная ссылка | `prototype` |

Каждая запись share.json - `{file_id, link, uploaded_at, revisions[]}`; повторные заливки - новой ревизией туда же. html-файлы в Google-формат НЕ конвертируются НИКОГДА (конвертация убьет прототип) - и дополнительно отдаются заказчику локальным файлом. Поля `share.json.analysis` и `share.json.texts` - legacy старых задач: в v7.1 их никто не пишет (Analysis.docx и Texts.docx больше нет).

## Правила оркестрации (диета и сводки - docs/ORCHESTRATION.md)

- **Сводка агента <= 8 строк**; полные тексты/JSON в чат запрещены - фактура передается путями. Parent-fallback запрещен: агент не записал файл - ре-делегация, не запись за него.
- **Оркестратор не читает большие JSON целиком** - гейты через exit-коды скриптов и точечные выборки полей.
- **Expected-маркеры - только одиночным вызовам** (pages-planner, offer-strategist, block-planner такт 1, block-planner/slot-mapper одним вызовом, site-reviewer): `.claude/tmp/expected-<агент>-<run_id>.txt = <путь результата>`. Веера (писатели x3 тон-гейта, page-writer, copy-auditor, prototype-builder, пачки block-planner/slot-mapper, **два параллельных прохода tekst-verifier**) - БЕЗ маркеров: single-marker hook на одновременных стопах дает ложные отказы (ADR-012); полноту проверяет оркестратор по файлам.
- **Размеры пачек:** page-writer / copy-auditor / prototype-builder - по 6-8; block-planner / slot-mapper при > 12 страниц - по 8-10, группируя по типу. Cap против overload.
- **Лимит ре-делегаций - 2** на агента по одной находке (ADR-025); дальше - accepted_violations / waiver / отчет человеку, не бесконечный цикл.
- **Диета писателя - в знаках** (ADR-020): VOICE.md <= 20500, VOICE.md + page-writer.md <= 33000; тест `.claude/tests/seo-tekst` провалит нарушение. Исполнитель - автор правок этих файлов; мотив - перегруженный писатель теряет главное.
- **Параллельная работа:** несколько прогонов - каждый в своем worktree. Внутри прогона такт 1 -> такт 2 -> писатели строго последовательны по данным; параллельны только вееры одного шага.

## Временные API-ошибки

Субагент вернул 529/503/rate_limit - поймать, `ScheduleWakeup` 90 сек с `/seo-tekst --resume <NNN>`, максимум 3 попытки. В веере не падать на части пачки - пере-делегировать недостающих.

## Если pre-commit отказал

| Ситуация | Действие |
|---|---|
| В списке запрещенных - общий файл (`ЗАКАЗЧИК.md`, `template.html`, `.claude/*`) | правка не нужна - `git checkout -- <файл>`; нужна - `/request-shared-edit "..."` и коммит без этого файла |
| В списке - чужая папка задачи (`texts/MMM-*/`) | не твоя задача: откатить; проверить `.claude/tmp/current-task.txt` - он должен указывать на `texts/<NNN>-<slug>/` |
| `current-task.txt` пуст или не тот | записать `texts/<NNN>-<slug>/` и повторить коммит |
| Обход `--no-verify` | не рекомендуется - только по явному решению владельца |

## Запреты

- НЕ пиши вне `texts/<NNN>/` + `.claude/tmp/` (pre-commit отклонит). Kit (`.claude/skills/seo-tekst/assets/`) - read-only.
- **НЕ пересобирай анализ**: ЦА, конкуренты, разведка - готовые артефакты `analyses/`. Не хватает - это вопрос к `/seo-analiz` (--resume / --add-seo), а не повод добывать данные здесь.
- **НЕ ветви пишущих агентов по источнику или tier** (ADR-031/038): нехватка данных выражается ТОЛЬКО отсутствием файла, никогда флагом режима в промте.
- **НЕ пропускай клиентские гейты**: состав страниц (без структуры), запрос критичной фактуры, гейт скелетов, тон-гейт. `--auto` их не отменяет.
- **НЕ выбирай тон за заказчика** - без ответа берется только `recommended` с честным `source:"recommended"`; отбирающий тон - только с проговоренной ценой.
- **НЕ отключай продающий пол молча** (F1-F4, ADR-037): единственный обход - `selling_floor_waivers` с непустым `source` из трех оснований; снятые правила - в финальную сводку.
- **НЕ легализуй нарушение locked** через `accepted_violations` - вопрос возвращается заказчику.
- НЕ выдумывай цифры/отзывы/реквизиты - `[ЗАПОЛНИТЬ: ...]`; вся арифметика запрещена, числа только из `facts.json`.
- НЕ выводи `notes_internal` заказчику и не перекладывай в `fill_notes` - это служебный канал агентов.
- НЕ добывай поисковые данные (частотности сверх сигнала прогретости, кластеризацию, позиции) - см. MCP_MAP.md.
- НЕ ставь expected-маркеры на веера; НЕ применяй анти-ИИ к коммерческим текстам (ADR-022).
- Длинное/среднее тире запрещено - только дефис (-); буква е-с-точками запрещена - всегда е (клиентские тексты, метатеги, этот файл).
- НЕ запускай другие скилы из этой сессии; перед закрытием worktree - `/handoff`.
