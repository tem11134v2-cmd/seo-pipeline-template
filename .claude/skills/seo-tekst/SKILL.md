---
name: seo-tekst
description: Конверсионные тексты коммерческих страниц + HTML-прототип на каждую. Проектный анализ ЦА и оффера + контент-разведка топ-10 по направлениям -> согласование с заказчиком (docx -> Google Doc) -> блок-план -> параллельный веер писателей -> копи-аудит + кросс-страничный site-reviewer -> сборка wireframe-прототипов (ч/б) поверх готового kit. На выходе - Texts.docx (Google Doc) + prototype.html на страницу. Источники - структура /seo-struktura, таблица, анализ, или бриф. Аргументы - [--from-structure NNN] [--from-table путь] [--from-analysis NNN] [--mode A|B] [--review|--auto] [--theme палитра] [--scan-leaders|--no-scan] [--recon|--no-recon] [--resume].
---

# seo-tekst

Скил-оркестратор: продающие тексты коммерческих страниц + HTML-прототип. Запускается **в worktree-сессии**. Порт авторской услуги У5+У6-Ф1 (claude.ai) с идеями из proto-v3 - см. [ADR-015](../../../docs/adr/015-tekst-task-type.md).

**Два уровня работы:**
- **Проектный (один раз):** анализ ЦА (`audience-analyst`) + стратегия оффера (`offer-strategist`) + после гейта - блок-план всех страниц (`block-planner`); в финале текстов - кросс-страничный аудит (`site-reviewer`). Результат анализа согласуется с заказчиком (Google Doc) ДО написания текстов.
- **Постраничный (веером, параллельно):** `direction-scanner` разведывает контент топ-10 по каждому направлению -> `page-writer` пишет копию по своему blueprint (каталоги BLOCKS/COPY он НЕ читает - только VOICE.md, контекст писателя тощий, см. ADR-020/021) -> `copy-auditor` чистит -> `prototype-builder` собирает HTML поверх kit (по умолчанию ч/б wireframe). Десяток страниц идут пачками.

**Две клиентские точки в Google Drive:** `Analysis_<slug>.docx` (на согласование) и `Texts_<slug>.docx` (финальные тексты). Прототипы отдаются локальными `.html`-файлами.

FAQ / возражения / плитку тегов / перелинковку / SEO-нормализацию НЕ делает - это отдельный скил **/seo-faq** (фаза 2).

## Аргументы
```
/seo-tekst [--from-structure <NNN>] [--from-table <путь>] [--from-analysis <NNN>]
           [--mode A|B] [--review|--auto] [--theme <палитра>]
           [--scan-leaders|--no-scan] [--recon|--no-recon] [--resume]
```
- Без источника - скил **спросит** (шаг 1b).
- `--from-structure <NNN>` - «да»-страницы из `structures/<NNN>-*/` (самый богатый путь: маркеры + конкуренты + анализ рядом).
- `--from-table <путь>` - готовая таблица URL/Тип/Маркер[/запросы] (csv/tsv).
- `--from-analysis <NNN>` - направления из `analyses/<NNN>-*/brief.json` (черновой список, уточнить вручную).
- `--mode A` (по умолчанию) - новый сайт; `--mode B` - существующий (direction-scanner сканирует свои живые страницы, page-writer берёт из них фактуру).
- `--auto` (по умолчанию) - автономно, единственная обязательная пауза = согласование анализа заказчиком. `--review` - добавляет паузу после текстов (до сборки прототипов).
- `--theme <палитра>` - тема прототипа. **По умолчанию `wireframe` (ч/б): согласование текста без споров о дизайне.** Цветные (`premium|b2b|mass-services|ecommerce|saas|military-dark`) - только если заказчик попросил; `strategy.design_theme` от offer-strategist остаётся в запасе для финального сайта.
- `--scan-leaders` / `--no-scan` - доказательный подбор блоков по лидерам (шаг 2b). По умолчанию ВКЛ, если есть лидеры (источник структура/анализ) - **обязателен для каталогов**; `--no-scan` выключает (быстрее, по статической матрице).
- `--recon` / `--no-recon` - контент-разведка топ-10 по КАЖДОМУ направлению (шаг 2c, `direction-scanner`): что публикуют однотипные конкуренты, must_have/gaps. По умолчанию ВКЛ. В mode B шаг выполняется даже при `--no-recon` (сканируются только свои живые страницы - вход block-planner).
- `--resume` - продолжить по `meta.json`.

## State machine
```
init -> pages-ready -> audience-done -> strategy-done -> analysis-shared
     -> [approved] -> blueprints-ready -> texts-written -> copy-audited
     -> site-reviewed -> texts-shared -> prototypes-built -> completed
```
`analysis-shared -> approved` - **клиентский гейт** (revising-цикл, как /seo-analiz). `meta.json` - источник истины, обновляется `bash .claude/hooks/update-meta.sh <texts_dir> <state>`.
**Legacy (задачи, начатые до ADR-021):** state `approved` + blueprints на все страницы -> считать `blueprints-ready`; state `texts-written` без `site_audit.json` -> прогнать 6c (идемпотентно) и дальше по цепочке.

## Артефакты
```
texts/NNN-<slug>/
├── meta.json              # state + drive (analysis/texts) + revisions
├── inputs.json            # slug/domain/регион/ниша/УТП/запрещёнки + реквизиты (company,inn,ogrn,address,email,phone)
├── facts.json             # ЕДИНЫЙ ИСТОЧНИК ИСТИНЫ: реквизиты/гарантия/числа (все цифры сайта - ТОЛЬКО отсюда)
├── pages.json             # целевые страницы (read-tekst-input)
├── leader_blocks.json     # (опц.) матрица покрытия блоков лидерами по типу + фишки (leader-block-scanner)
├── recon/<slug>.json      # (опц.) контент-разведка топ-10 направления: must_have/gaps/офферы; в mode B + own_page (direction-scanner)
├── audience.json          # анализ ЦА (audience-analyst)
├── strategy.json          # стратегия оффера (offer-strategist)
├── blueprints/<slug>.json # блок-план каждой страницы (block-planner): блоки + цели + боли + слоты + char-лимиты
├── site_audit.json        # кросс-страничный аудит: самоповторы/уникальность H1/консистентность фактов + вердикт (site-reviewer)
├── Analysis_<slug>.docx   # КЛИЕНТУ на согласование (-> Google Doc)
├── pages/<page-slug>/
│   ├── page.json          # тексты блоков (page-writer)
│   ├── manifest.json      # копия + рендер-решения (prototype-builder)
│   └── prototype.html     # ФИНАЛ - self-contained прототип (build-prototype.mjs)
├── Texts_<slug>.docx      # КЛИЕНТУ финальные тексты (-> Google Doc)
└── share.json             # ссылки Drive (analysis + texts)
```

## Алгоритм

### 0a. Проверка worktree
```bash
GIT_DIR=$(git rev-parse --git-dir); COMMON=$(git rev-parse --git-common-dir)
```
`GIT_DIR == COMMON` -> main. Предупредить (не блокировать): «Тексты в main; для многозадачности переоткрой с галочкой worktree».

### 0b. Parse args
`from_structure / from_table / from_analysis / mode (A) / review|auto (auto) / theme / resume`.

### 1. Setup

**1a. `--resume`** - найти `texts/<NNN>-*/`, прочитать `meta.json`, спросить «продолжить с state `<state>`? [Y/n]», перейти к ветке после state. Особые случаи:
- `pages-ready`: если скан лидеров не отключён и `leader_blocks.json` отсутствует - сначала шаг 2b; если разведка не отключена и папки `recon/` нет - шаг 2c; затем шаг 3.
- `approved`: проверить `blueprints/` - есть blueprint на КАЖДУЮ страницу pages.json -> считать `blueprints-ready`, к 6b (готовые blueprints НЕ перегенерировать - под них могли быть написаны page.json); blueprints неполные -> 6a с `pages_subset` = только недостающие slug.
- `texts-written`: прогнать 6c заново (copy-auditor идемпотентен), state по завершении - `copy-audited`.

**1b. Источник (фрэш-старт)** - если ни один `--from-*` не задан, спросить:
```
Откуда берём страницы для текстов?
  1. Из структуры (NNN) - возьму «да»-страницы из structures/NNN-*/ (маркеры + анализ рядом).
  2. Таблицей - URL / Тип / Маркер [/ запросы] (csv/tsv/построчно).
  3. Из анализа (NNN) - черновые направления из брифа (уточним вручную).
```

**1c. slug, NNN, регион, УТП, реквизиты -> папка.**
- Источник структура: `structure_dir/inputs.json` -> slug, domain, region; `analysis_dir/brief.json` -> УТП-блок. **NNN texts зеркалит NNN структуры.**
- **Реальные поля `brief.json`** (от brief-structurer, маппинг в inputs.json): `company_name`->brand_name, `niche`, `region`, `business_type`, `keyso_base`, `utp_technical/service/social`, `assortment`, `forbidden_wordings`, `not_in_assortment`, `ca_data` (строка - данные ЦА), `client_target_queries`. (Не `brand_name`/`forbidden_phrasings` - таких полей нет.)
- Источник таблица/анализ: из корневого `ЗАКАЗЧИК.md` (`.claude\scripts\_node.cmd .claude\scripts\_client.mjs --field "<поле>" ЗАКАЗЧИК.md`) взять бренд, регион, реквизиты (Название/ИНН/ОГРН/Юр.адрес/Телефон/Email), УТП, стоп-слова. Чего нет - спросить (реквизиты можно отложить плейсхолдерами `[... - требует уточнения]`). NNN - следующий свободный в `texts/`.
- Создать `texts/<NNN>-<slug>/`. **Записать `.claude/tmp/current-task.txt = texts/<NNN>-<slug>/`** (без этого pre-commit откажет).
- Записать `inputs.json` (slug, domain, region_yandex, region_name, niche, business_type, keyso_base, source, mode, **brand_name** (из brief.company_name), utp_technical/service/social, assortment, **forbidden_wordings**, **not_in_assortment**, **ca_data**, client_target_queries + legal-блок `company, inn, ogrn, address, email, phone` из ЗАКАЗЧИК.md или плейсхолдеры) и `meta.json` (state init, review/auto, source, started/updated).
- Записать **`facts.json`** - единый источник истины (v4). Из брифа/inputs:
  ```json
  { "jur": {"entity":"<ООО/ИП + назв>", "brand_face":"<имя/роль в продающей части>", "requisites":{"inn":"","ogrn":"","address":""}},
    "product_guarantee": {"what":"<точная формулировка>", "guarantee":"<финальная согласованная>", "deadlines":"", "prices":"<из прайса или [ЗАПОЛНИТЬ]>"},
    "numbers": [ {"label":"лет на рынке","value":"","publish":"as-is|alt|no"} ],
    "opsec_restricted": ["личность","геолокация","поставщики","места/даты"] }
  ```
  Чего нет - `[ЗАПОЛНИТЬ]`/«требует уточнения», не сочинять. **Все цифры на сайте тянутся ТОЛЬКО отсюда; изменение факта - правка здесь, не по месту. Никакой арифметики на лету** (NPS->%, годовой÷12). offer-strategist/page-writer/faq-builder берут числа из facts.json.

### 2. Страницы (state == init)
```
.claude\scripts\_node.cmd .claude\scripts\read-tekst-input.mjs <texts_dir> --from-structure <structure_dir> | --from-table <путь> | --from-analysis <analysis_dir>
```
Exit 2 - нет целевых (стоп с подсказкой). `update-meta.sh <texts_dir> pages-ready`. Сводка по типам.

### Фаза разведки: 2b + 2c + 3 запускать ПАРАЛЛЕЛЬНО (одним сообщением)
Шаги 2b (лидеры), 2c (разведка направлений) и 3 (анализ ЦА) независимы по данным - делегируй их одним сообщением (несколько вызовов Agent сразу). В параллельном запуске **expected-маркеры НЕ ставить никому** (hook не различает одновременные стопы разных агентов - ADR-012); полноту проверяет оркестратор по файлам: `leader_blocks.json`, `recon/*.json`, `audience.json`. Недостающее - пере-делегировать точечно (до 2). После всех: `update-meta.sh <texts_dir> audience-done`, к шагу 4 (стратег читает audience.json). Последовательный путь (2b -> 2c -> 3, с маркерами на одиночных) остаётся валидным - например при --resume с частичными результатами.

### 2b. Скан блоков лидеров (опц., доказательная основа подбора)
По умолчанию ВКЛ, если есть лидеры (источник структура/анализ); **особенно нужно для каталогов** (набор блоков на Категория/Карточка сильно меняется от ниши к нише - статическая матрица их не ловит). `--no-scan` выключает (быстрее), `--scan-leaders` форсирует.

Маркер: `.claude/tmp/expected-leader-block-scanner-<run_id>.txt = <texts_dir>/leader_blocks.json`. Делегировать `leader-block-scanner` (`texts_dir`, `project_root`, `structure_dir`/`analysis_dir`, `niche`). Агент смотрит 3-6 лидеров по типам страниц (**Chrome-плагин -> rendered-композиция + фишки; `seo_fetch_page(url, profile="content")` -> fallback**), строит матрицу покрытия «блок × тип» + `features_to_steal`. Потом `block-planner` (шаг 6a) берёт блоки с покрытием `>= 50%` как обязательные, статическая матрица BLOCKS - пол.

Chrome не подключён/упал -> fetch-фолбэк (медленнее, SPA-каталоги видит хуже). Совсем нет данных -> не блокируем, `block-planner` падает на матрицу BLOCKS. State не меняем (остаётся `pages-ready`, наличие `leader_blocks.json` - сигнал).

### 2c. Контент-разведка направлений (по умолчанию ВКЛ; `--no-recon` выключает)
Что публикует топ-10 по КАЖДОМУ направлению - чтобы страницы не выглядели пусто на фоне выдачи и было от чего отстроиться. Делегировать `direction-scanner` **на каждую страницу из pages.json, пачками по 4-6** (веер - expected-маркеры НЕ ставить). Промт: `texts_dir`, `project_root`, `page_slug`, `mode`, (mode B) `page_url`. Каждый: SERP по маркеру -> фильтр однотипных сайтов -> фетч 3-5 страниц (Chrome -> rendered, `seo_fetch_page(url, profile="content")` -> fallback; веер по списку URL -> `seo_fetch_batch(urls=[...], profile="content")`) -> тонкий `recon/<slug>.json` (published_info / offers_seen / must_have / gaps; **в mode B + `own_page`** - блоки и объёмы СВОЕЙ живой страницы для block-planner).
**Mode B: шаг обязателен** даже при `--no-recon` (тогда сканируются только свои живые страницы, без SERP). После: страницы без recon-файла НЕ блокируют (block-planner обойдётся leader_blocks/матрицей). State не меняем (`pages-ready`, наличие `recon/` - сигнал).

### 3. Анализ ЦА (state == pages-ready)
Маркер: `.claude/tmp/expected-audience-analyst-<run_id>.txt = <texts_dir>/audience.json`. Делегировать `audience-analyst` (передать `texts_dir`, `project_root`, `analysis_dir` если есть). После: `update-meta.sh <texts_dir> audience-done`.

### 4. Стратегия оффера (state == audience-done)
Маркер -> `<texts_dir>/strategy.json`. Делегировать `offer-strategist` (передать `texts_dir`, `project_root`, `analysis_dir`/`domain` если есть). После: `update-meta.sh <texts_dir> strategy-done`.

### 5. Документ согласования + КЛИЕНТСКИЙ ГЕЙТ (state == strategy-done)
```
.claude\scripts\_node.cmd .claude\scripts\build-tekst-analysis-docx.mjs <texts_dir>
```
Загрузить в Drive (Google Doc) - см. блок «Drive» ниже, ключ `texts_folder_id`, имя `Analysis_<slug>`. Записать ссылку в `share.json.analysis`. `update-meta.sh <texts_dir> analysis-shared`.

**ПАУЗА (обязательная) - анализ + ВЫБОР смысловых решений.** Вывести заказчику:
```
📄 Анализ ЦА + СМЫСЛОВЫЕ РЕШЕНИЯ НА ВЫБОР:
   <ссылка Google Doc>  (+ локально Analysis_<slug>.docx)
Отправь заказчику. В разделе «Решения на ВАШ выбор» - 4 пункта (идея/метафора, позиционирование, подача цены, формулировка CTA): по каждому нужен выбор варианта (номер) или свой текст. Это решения о бренде - не выбираем за заказчика.
Жду: выбор по 4 решениям + «согласовано», либо правки.
```
Завершить ход. На ответе пользователя:
- **выбор + «согласовано»** -> записать выбор в `strategy.json`: для каждого `decisions.<key>.chosen` = индекс варианта (0-based) или строка-свой-текст; что заказчик не уточнил - оставить `null` (page-writer возьмёт `recommended`). Затем `update-meta.sh <texts_dir> approved`, к шагу 6.
- **«на ваше усмотрение»** -> оставить все `chosen:null` (берётся `recommended`), `approved`.
- **правки** -> применить (точечно в audience.json/strategy.json или пере-делегировать нужного агента), пересобрать docx, пере-загрузить (новая ревизия в `share.json`), снова пауза. Цикл до approved.

### 6a. Блок-план всех страниц (state == approved)
**Guard (resume-идемпотентность):** если `blueprints/<page-slug>.json` уже есть для КАЖДОЙ страницы pages.json - шаг пропустить (`update-meta.sh <texts_dir> blueprints-ready`, к 6b): готовые blueprints не перегенерировать, под них могли быть написаны page.json.

Делегировать `block-planner`: `texts_dir`, `project_root`, `mode`. Он читает BLOCKS.md + leader_blocks.json + recon/*.json + fragments-manifest + pages.json + strategy + audience.summary и пишет `blueprints/<page-slug>.json` на каждую страницу (блоки + цели + боли + слоты + char-лимиты; в mode B учитывает `own_page` из recon). **Писатели каталоги не читают - только свой blueprint** (диета контекста, ADR-020).
- **<= 12 страниц:** один вызов; маркер `.claude/tmp/expected-block-planner-<run_id>.txt = <texts_dir>/blueprints/` (хук проверяет непустоту папки).
- **> 12 страниц:** несколько вызовов пачками по 8-10, ГРУППИРУЯ ПО ТИПУ страницы (anti-duplication внутри типа сохраняется); каждому - `pages_subset` = список slug. Маркер при нескольких вызовах НЕ ставить (single-marker hook на веере даёт ложные отказы).

После: проверить, что blueprint есть для каждой страницы из pages.json; недостающие - пере-делегировать `block-planner` с `pages_subset` = недостающие slug (до 2); затем удалить остаточные `.claude/tmp/expected-block-planner-*.txt` и `update-meta.sh <texts_dir> blueprints-ready`.

### 6b. Тексты - веер писателей (state == blueprints-ready)
Прочитать `pages.json`. Делегировать `page-writer` **на каждую страницу, пачками по 6-8** (несколько вызовов Agent в одном сообщении). Параллельные писатели **НЕ пишут expected-маркеры** (полноту проверит шаг 8 + наличие page.json; single-marker hook на веере даёт ложные отказы - см. ADR-015/ADR-012).
Промт каждому: `texts_dir`, `project_root`, `page_slug`, `mode`, (mode B) `page_url`.
После всех: проверить, что у каждой страницы есть `pages/<slug>/page.json`; отсутствующие - пере-делегировать (до 2 раз). `update-meta.sh <texts_dir> texts-written`.

### 6c. Редактор продающего текста - шлюз перед HTML (state == texts-written)
Отдельный проход качества свежими глазами. Делегировать `copy-auditor` **на каждую страницу веером** (6-8): читает page.json + COPY-AUDIT.md + facts.json + blueprint, **чинит** нарушения на месте по приоритету - **смысл и грамотность первым** (преувеличения/кривые связки/самопротиворечия), затем удар в боль ЦА, затем чистота (утечка кухни Сургай/кастдев, жаргон, штампы, манипуляции, повторы, лимиты). Анти-ИИ-детект НЕ делает (ADR-022). Затем по каждой странице:
```
.claude\scripts\_node.cmd .claude\scripts\verify-copy.mjs texts/NNN/pages/<slug>/
```
Exit 2 (механические нарушения остались) - пере-делегировать `copy-auditor` этой страницы со списком (до 2). Exit 1 (нет page.json - copy-auditor тут не поможет) - пере-делегировать `page-writer` этой страницы как в 6b (до 2), затем повторить для неё copy-auditor + verify-copy. Аналог post-валидатора HTML, но для копирайта: не прошёл - правим ТЕКСТ, прототип не собираем. Пока идёт цикл правок state остаётся `texts-written`; когда verify-copy.mjs прошёл по всем страницам - `update-meta.sh <texts_dir> copy-audited`.

### 6d. Кросс-страничный аудит сайта (state == copy-audited)
То, что не видно на одной странице: сайт из 10 страниц, написанных под копирку одними фразами, читается лениво и подрывает доверие. Маркер: `.claude/tmp/expected-site-reviewer-<run_id>.txt = <texts_dir>/site_audit.json`. Делегировать `site-reviewer` (один вызов на проект): `texts_dir`. Он читает ВСЕ pages/*/page.json + VOICE.md + decisions и: межстраничные самоповторы формулировок -> перефразирует; H1/Title - уникальность; consistency decisions; конфликты цифр между страницами -> по facts.json; выборочно ловит проскочивший перегиб смысла/сленг/утечку кухни. После его правок - повторно `verify-copy.mjs` по затронутым страницам (он мог менять текст; exit 2 -> пере-делегировать copy-auditor этой страницы, до 1 раза). `update-meta.sh <texts_dir> site-reviewed`.

### 7. Тексты клиенту (state == site-reviewed)
```
.claude\scripts\_node.cmd .claude\scripts\build-tekst-docx.mjs <texts_dir>
```
Загрузить `Texts_<slug>.docx` в Drive (Google Doc), ссылка в `share.json.texts`. `update-meta.sh <texts_dir> texts-shared`.
**`--review`:** вывести ссылку и спросить «тексты ок -> собираю прототипы? [Y/n/правки]». **`--auto`:** идти дальше (ссылка в финальной сводке).

### 8. Прототипы - веер сборщиков (state == texts-shared)
Делегировать `prototype-builder` **на каждую страницу, пачками по 6-8**. Промт: `texts_dir`, `project_root`, `page_slug`, `theme` (**по умолчанию `wireframe`** - ч/б согласование текста; цветную из strategy.design_theme передавать только если задан `--theme` или заказчик попросил). Каждый сам гоняет `build-prototype.mjs` + `verify-prototype.mjs` и чинит.
После всех: для контроля прогнать `verify-prototype.mjs` по каждой `pages/<slug>/` (или довериться сводкам сборщиков); отсутствующие prototype.html - пере-делегировать (до 2). `update-meta.sh <texts_dir> prototypes-built`.

### 9. Финал (state == prototypes-built)
`update-meta.sh <texts_dir> completed`. Финальный коммит:
```bash
git add -A
git commit -m "Tekst <NNN> for <slug>: <N> страниц (прототипы + тексты)"
```
Вывести:
```
═══ ТЕКСТЫ + ПРОТОТИПЫ ГОТОВЫ ═══
Клиент: <domain|slug>   Страниц: <N>   Палитра: <theme> (wireframe = ч/б для согласования)
🧪 Кросс-аудит сайта: <site_audit.json verdict>
📄 Тексты (Google Doc): <ссылка texts>
📄 Анализ ЦА (Google Doc): <ссылка analysis>
🖥 Прототипы (локальные .html, прикрепить заказчику):
   texts/<NNN>-<slug>/pages/<slug>/prototype.html   (xN)
📌 [ЗАПОЛНИТЬ]-пометки в текстах: <count> (реальные цифры/отзывы/фото)
Дальше: /seo-faq <NNN> - добавить SEO-блоки (FAQ + нормализация) | /seo-tekst-fix <NNN> "..." - правки | цветная палитра по запросу: пересборка с --theme | /handoff - перенести в main.
═══════════════════════════
```

## Drive (загрузка docx -> Google Doc)
Прочитать `~/.claude/seo-knowledge/DRIVE.md` -> `texts_folder_id`. **Если ключа нет / значение `TODO_*`** - не блокировать: пропустить загрузку, оставить локальный docx, в сводке подсказать «создай папку «Тексты» в Drive (anyone-with-link -> reader), впиши ID в DRIVE.md, затем /share-tekst <NNN>». Иначе:
```
mcp__gdrive-piotr__uploadFile(localPath:<docx>, name:<Analysis|Texts>_<slug>, parentFolderId:<texts_folder_id>,
  mimeType:"application/vnd.openxmlformats-officedocument.wordprocessingml.document", convertToGoogleFormat:true)
```
Прототипы (.html) в Drive НЕ конвертируются в Google-формат - отдаём локальными файлами (опционально можно залить `convertToGoogleFormat:false` для общей ссылки).

## Параллельная работа
Несколько прогонов - каждый в своём worktree, состояния не пересекаются. Внутри прогона:
- **Фаза разведки (2b+2c+3)** - параллельно одним сообщением, без маркеров (см. выше).
- Вееры идут пачками: direction-scanner 4-6, page-writer / copy-auditor / prototype-builder 6-8 (cap против overload).
- Expected-маркер только у одиночного агента, запущенного БЕЗ параллельных соседей (offer-strategist, block-planner одним вызовом, site-reviewer); любые одновременные запуски - без маркеров, полноту проверяет оркестратор по файлам.

## Временные API-ошибки
Субагент вернул `529/503/rate_limit` - поймать, `ScheduleWakeup` 90 сек с `/seo-tekst --resume <NNN>`, максимум 3 попытки. В веере - не падать на части пачки, пере-делегировать недостающие.

## Запреты
- НЕ пиши в корень/общие файлы - только в `texts/<NNN>/`, `.claude/tmp/`. Pre-commit отклонит.
- НЕ редактируй kit (`.claude/skills/seo-tekst/assets/`) во время задачи - read-only.
- НЕ пиши FAQ/SEO-блоки/плитку тегов/перелинковку - это /seo-faq.
- НЕ пропускай клиентский гейт (шаг 5) - заказчик должен согласовать анализ.
- НЕ ставь expected-маркеры на веера (direction-scanner / писатели / аудиторы / сборщики / block-planner при >12 стр.) - ломает hook. Одиночные вызовы (audience-analyst, offer-strategist, block-planner одним вызовом, site-reviewer) - маркер ставится.
- НЕ выдумывай цифры/отзывы/реквизиты - плейсхолдеры `[ЗАПОЛНИТЬ: ...]` / `[... - требует уточнения]`.
- Длинное/среднее тире (— –) запрещено - только дефис (-).
- НЕ запускай другие скилы (/seo-struktura, /seo-statya, ...) из этой сессии.
