---
name: seo-tekst
description: Конверсионные тексты коммерческих страниц + HTML-прототип на каждую. Проектный анализ ЦА и оффера (один раз) -> согласование с заказчиком (docx -> Google Doc) -> параллельный веер писателей -> сборка прототипов поверх готового kit. На выходе - Texts.docx (Google Doc) + prototype.html на страницу. Источники - структура /seo-struktura, таблица, анализ, или бриф. Аргументы - [--from-structure NNN] [--from-table путь] [--from-analysis NNN] [--mode A|B] [--review|--auto] [--theme ниша] [--resume].
---

# seo-tekst

Скил-оркестратор: продающие тексты коммерческих страниц + HTML-прототип. Запускается **в worktree-сессии**. Порт авторской услуги У5+У6-Ф1 (claude.ai) с идеями из proto-v3 - см. [ADR-015](../../../docs/adr/015-tekst-task-type.md).

**Два уровня работы:**
- **Проектный (один раз):** анализ ЦА (`audience-analyst`) + стратегия оффера (`offer-strategist`). Результат согласуется с заказчиком (Google Doc) ДО написания текстов.
- **Постраничный (веером, параллельно):** `page-writer` пишет копию -> `prototype-builder` собирает HTML поверх kit. Десяток страниц идут пачками.

**Две клиентские точки в Google Drive:** `Analysis_<slug>.docx` (на согласование) и `Texts_<slug>.docx` (финальные тексты). Прототипы отдаются локальными `.html`-файлами.

FAQ / возражения / плитку тегов / перелинковку / SEO-нормализацию НЕ делает - это отдельный скил **/seo-faq** (фаза 2).

## Аргументы
```
/seo-tekst [--from-structure <NNN>] [--from-table <путь>] [--from-analysis <NNN>]
           [--mode A|B] [--review|--auto] [--theme <ниша>] [--resume]
```
- Без источника - скил **спросит** (шаг 1b).
- `--from-structure <NNN>` - «да»-страницы из `structures/<NNN>-*/` (самый богатый путь: маркеры + конкуренты + анализ рядом).
- `--from-table <путь>` - готовая таблица URL/Тип/Маркер[/запросы] (csv/tsv).
- `--from-analysis <NNN>` - направления из `analyses/<NNN>-*/brief.json` (черновой список, уточнить вручную).
- `--mode A` (по умолчанию) - новый сайт; `--mode B` - существующий (page-writer фетчит живую страницу).
- `--auto` (по умолчанию) - автономно, единственная обязательная пауза = согласование анализа заказчиком. `--review` - добавляет паузу после текстов (до сборки прототипов).
- `--theme <ниша>` - палитра (`premium|b2b|mass-services|ecommerce|saas|military-dark`); иначе подбирает offer-strategist.
- `--resume` - продолжить по `meta.json`.

## State machine
```
init -> pages-ready -> audience-done -> strategy-done -> analysis-shared
     -> [approved] -> texts-written -> texts-shared -> prototypes-built -> completed
```
`analysis-shared -> approved` - **клиентский гейт** (revising-цикл, как /seo-analiz). `meta.json` - источник истины, обновляется `bash .claude/hooks/update-meta.sh <texts_dir> <state>`.

## Артефакты
```
texts/NNN-<slug>/
├── meta.json              # state + drive (analysis/texts) + revisions
├── inputs.json            # slug/domain/регион/ниша/УТП/запрещёнки + реквизиты (company,inn,ogrn,address,email,phone)
├── pages.json             # целевые страницы (read-tekst-input)
├── audience.json          # анализ ЦА (audience-analyst)
├── strategy.json          # стратегия оффера (offer-strategist)
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

**1a. `--resume`** - найти `texts/<NNN>-*/`, прочитать `meta.json`, спросить «продолжить с state `<state>`? [Y/n]», перейти к ветке после state.

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
- Источник таблица/анализ: из корневого `ЗАКАЗЧИК.md` (`.claude\scripts\_node.cmd .claude\scripts\_client.mjs --field "<поле>" ЗАКАЗЧИК.md`) взять бренд, регион, реквизиты (Название/ИНН/ОГРН/Юр.адрес/Телефон/Email), УТП, стоп-слова. Чего нет - спросить (реквизиты можно отложить плейсхолдерами `[... - Ща Докрутим]`). NNN - следующий свободный в `texts/`.
- Создать `texts/<NNN>-<slug>/`. **Записать `.claude/tmp/current-task.txt = texts/<NNN>-<slug>/`** (без этого pre-commit откажет).
- Записать `inputs.json` (slug, domain, region_yandex, region_name, niche, business_type, keyso_base, source, mode, **brand_name** (из brief.company_name), utp_technical/service/social, assortment, **forbidden_wordings**, **not_in_assortment**, **ca_data**, client_target_queries + legal-блок `company, inn, ogrn, address, email, phone` из ЗАКАЗЧИК.md или плейсхолдеры) и `meta.json` (state init, review/auto, source, started/updated).

### 2. Страницы (state == init)
```
.claude\scripts\_node.cmd .claude\scripts\read-tekst-input.mjs <texts_dir> --from-structure <structure_dir> | --from-table <путь> | --from-analysis <analysis_dir>
```
Exit 2 - нет целевых (стоп с подсказкой). `update-meta.sh <texts_dir> pages-ready`. Сводка по типам.

### 3. Анализ ЦА (state == pages-ready)
Маркер: `.claude/tmp/expected-audience-analyst-<run_id>.txt = <texts_dir>/audience.json`. Делегировать `audience-analyst` (передать `texts_dir`, `project_root`, `analysis_dir` если есть). После: `update-meta.sh <texts_dir> audience-done`.

### 4. Стратегия оффера (state == audience-done)
Маркер -> `<texts_dir>/strategy.json`. Делегировать `offer-strategist` (передать `texts_dir`, `project_root`, `analysis_dir`/`domain` если есть). После: `update-meta.sh <texts_dir> strategy-done`.

### 5. Документ согласования + КЛИЕНТСКИЙ ГЕЙТ (state == strategy-done)
```
.claude\scripts\_node.cmd .claude\scripts\build-tekst-analysis-docx.mjs <texts_dir>
```
Загрузить в Drive (Google Doc) - см. блок «Drive» ниже, ключ `texts_folder_id`, имя `Analysis_<slug>`. Записать ссылку в `share.json.analysis`. `update-meta.sh <texts_dir> analysis-shared`.

**ПАУЗА (обязательная).** Вывести заказчику:
```
📄 Анализ ЦА и стратегия на согласование:
   <ссылка Google Doc>  (+ локально Analysis_<slug>.docx)
Отправь заказчику. Жду: «согласовано» -> пишем тексты, или правки -> внесу и обновлю документ.
```
Завершить ход. На ответе пользователя:
- **«согласовано»** -> `update-meta.sh <texts_dir> approved`, к шагу 6.
- **правки** -> применить (точечно в audience.json/strategy.json или пере-делегировать нужного агента), пересобрать docx, пере-загрузить (новая ревизия в `share.json`), снова пауза. Цикл до approved.

### 6. Тексты - веер писателей (state == approved)
Прочитать `pages.json`. Делегировать `page-writer` **на каждую страницу, пачками по 6-8** (несколько вызовов Agent в одном сообщении). Параллельные писатели **НЕ пишут expected-маркеры** (полноту проверит шаг 8 + наличие page.json; single-marker hook на веере даёт ложные отказы - см. ADR-015/ADR-012).
Промт каждому: `texts_dir`, `project_root`, `page_slug`, `mode`, (mode B) `page_url`.
После всех: проверить, что у каждой страницы есть `pages/<slug>/page.json`; отсутствующие - пере-делегировать (до 2 раз). `update-meta.sh <texts_dir> texts-written`.

### 7. Тексты клиенту (state == texts-written)
```
.claude\scripts\_node.cmd .claude\scripts\build-tekst-docx.mjs <texts_dir>
```
Загрузить `Texts_<slug>.docx` в Drive (Google Doc), ссылка в `share.json.texts`. `update-meta.sh <texts_dir> texts-shared`.
**`--review`:** вывести ссылку и спросить «тексты ок -> собираю прототипы? [Y/n/правки]». **`--auto`:** идти дальше (ссылка в финальной сводке).

### 8. Прототипы - веер сборщиков (state == texts-shared)
Делегировать `prototype-builder` **на каждую страницу, пачками по 6-8**. Промт: `texts_dir`, `project_root`, `page_slug`, `theme` (из strategy). Каждый сам гоняет `build-prototype.mjs` + `verify-prototype.mjs` и чинит.
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
Клиент: <domain|slug>   Страниц: <N>   Палитра: <theme>
📄 Тексты (Google Doc): <ссылка texts>
📄 Анализ ЦА (Google Doc): <ссылка analysis>
🖥 Прототипы (локальные .html, прикрепить заказчику):
   texts/<NNN>-<slug>/pages/<slug>/prototype.html   (xN)
📌 [ЗАПОЛНИТЬ]-пометки в текстах: <count> (реальные цифры/отзывы/фото)
Дальше: /seo-faq <NNN> - добавить SEO-блоки (FAQ + нормализация) | /handoff - перенести в main.
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
Несколько прогонов - каждый в своём worktree, состояния не пересекаются. Внутри прогона веер page-writer / prototype-builder идёт пачками 6-8 (cap против overload).

## Временные API-ошибки
Субагент вернул `529/503/rate_limit` - поймать, `ScheduleWakeup` 90 сек с `/seo-tekst --resume <NNN>`, максимум 3 попытки. В веере - не падать на части пачки, пере-делегировать недостающие.

## Запреты
- НЕ пиши в корень/общие файлы - только в `texts/<NNN>/`, `.claude/tmp/`. Pre-commit отклонит.
- НЕ редактируй kit (`.claude/skills/seo-tekst/assets/`) во время задачи - read-only.
- НЕ пиши FAQ/SEO-блоки/плитку тегов/перелинковку - это /seo-faq.
- НЕ пропускай клиентский гейт (шаг 5) - заказчик должен согласовать анализ.
- НЕ ставь expected-маркеры на параллельных писателей/сборщиков (ломает hook на веере).
- НЕ выдумывай цифры/отзывы/реквизиты - плейсхолдеры `[ЗАПОЛНИТЬ: ...]` / `[... - Ща Докрутим]`.
- Длинное/среднее тире (— –) запрещено - только дефис (-).
- НЕ запускай другие скилы (/seo-struktura, /seo-statya, ...) из этой сессии.
