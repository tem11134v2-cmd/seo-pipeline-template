# Контракты данных v7 (приложение к программе 2026-08-22)

Ревизия 2: после адверсариальной сверки этапа 0 (4 верификатора, 38 находок учтено).

Назначение: единый список всех НОВЫХ и ИЗМЕНЕННЫХ артефактов программы v7 с полями,
писателем и читателями. Правило программы: поле без читателя не заводится; читатель
без писателя - дефект спецификации. Сверка на этапе D идет по этому файлу.

Незатронутые контракты: intake.json (схема), blueprints (draft/final), page.json,
facts.json/lexicon (схема), verify_report.json, share.json (схема; поле analysis
становится legacy старых задач - писателя больше нет). competitors.json, A3.md,
recommendations.json ЗАТРОНУТЫ (см. 1.4а, 1.8).

## 0. Ключевые решения ревизии 2 (ответы на находки сверки)

1. **Tier определяет ИНСТРУМЕНТЫ ступеней, а не их состав.** Ступени 0-3 идут всегда;
   при tier=seo ступень 1 заполняет Keyso-поля brief.json (как сейчас), ступень 3 ищет
   конкурентов Keyso-путем с метриками (как сейчас). При tier=basic те же ступени
   работают без Keyso (см. 1.2, 1.4а). Ступень 4 = ТОЛЬКО serp-verdict + A3.md +
   stop_list_detailed.json. Формулировка «Keyso-специфика уезжает в ступень 4» из
   первой ревизии ОТМЕНЕНА.
2. **Словарь типов страниц - русский** (совместимость с ADR-037 и verify-copy.mjs):
   Главная | Услуга | Категория | Товар | Инфо. Английские enum первой ревизии отменены.
3. **decisions.register получает НОВУЮ форму** (см. 3.2); все читатели правятся в
   этапе B явным списком, включая скрипты verify-copy.mjs и build-handoff.mjs.
   Утверждение «их код не меняется» отменено. Врезка в ADR-034 - этап B.
4. **own_page-факты текут через intake.json**: кандидаты facts_seen подтверждаются
   клиентским циклом A2 и дописываются оркестратором анализа в intake.json
   (source: own_page:<url>), откуда мост доносит их до texts/facts.json (см. 1.5).
5. **audience_wordings сохраняют текущую форму** {phrase, means, from} и печатаются
   в A2-разделе ЦА - revising-цикл A2 и есть точка подтверждения (закрывает ADR-033).
6. **Флаги /seo-tekst v7**: --review/--auto остаются; --mode A|B УДАЛЕН (own_page -
   данными, не флагом); --scan-leaders/--no-scan и --recon/--no-recon переезжают
   опциями ступени 3 /seo-analiz; --theme удален; --from-brief удален.

## 1. /seo-analiz (ступени)

### 1.1. meta.json - дополнения

```json
{
  "tier": "seo | basic",            // пишет оркестратор на старте (флаг или вопрос)
  "state": "см. state machine 4.1",
  "tier_upgraded_at": "ISO"          // только после --add-seo
}
```

Читатели state вне скила: /share-analysis (обрабатывает и состояния дообогащения
--add-seo - в список правок этапа A), /status.

### 1.2. brief.json v2

16 параметров как сейчас (включая ca_data - остается дословной строкой брифа,
печатается в A2 как сырье; настоящая ЦА - audience.json). Дополнение:

```json
{
  "directions": [                    // канон направлений для ступеней 2-3 и текстов
    {
      "dir_slug": "montazh-otopleniya",   // слаг-ключ, стабильный, латиница
      "name": "Монтаж отопления",
      "source": "assortment | client_pages",
      "marker_hint": "монтаж отопления под ключ",  // запрос для SERP-разведки направления
      "url": "https://... | null"    // живая страница клиента этого направления
                                     // (спаривание с client_pages; null если нет)
    }
  ]
}
```

- Пишет: brief-structurer (ступень 1). Читают: audience-analyst, direction-scanner,
  pages-planner v2, read-tekst-input.mjs v2 (спаривание), analysis-writer (A2),
  offer-strategist (через analysis_dir).
- **Keyso-поля** (keyso_base, path, domain_dashboard_snapshot, метрики client_pages):
  при tier=seo заполняет brief-structurer НА СТУПЕНИ 1 (как сейчас); при tier=basic
  ключи ОТСУТСТВУЮТ (деградация отсутствием, не null).
- **client_pages при tier=basic**: brief-structurer собирает их сканом сайта клиента
  (sitemap/меню через seo_fetch_page, до 5 страниц, h1/blocks/page_type) БЕЗ метрик.
  Механизм - в инструкции агента (этап A).
- Внешний потребитель: /seo-tehaudit --from-analysis читает keyso_base - при
  basic-анализе ключа нет, скил падает на штатный fallback «база по региону»
  (строка в его инструкции - этап A, правка одной ветки).

### 1.3. audience.json - НОВЫЙ артефакт анализа (ступень 2)

Путь: analyses/NNN/audience.json. Пишет: audience-analyst.

```json
{
  "summary": "компактная сводка ЦА (<= 2000 знаков) - главный вход писателя",
  "segments": [
    {
      "id": "s1", "name": "…", "portrait": "…",
      "pains": ["сцена боли словами клиента"], "fears": ["…"], "objections": ["…"],
      "transformation": "жизнь после продукта",
      "dir_slugs": ["montazh-otopleniya"]   // привязка к НАПРАВЛЕНИЯМ (не к страницам)
    }
  ],
  "audience_wordings": [                     // форма СОХРАНЯЕТСЯ из текущего контракта
    { "phrase": "слова клиентов", "means": "что имеют в виду", "from": "forum:<домен> | persona:<имя>" }
  ]
}
```

- Читают: offer-strategist, block-planner (summary), page-writer (summary + сегменты
  с пересечением dir_slugs), copy-auditor (summary), prototype-fixer, analysis-writer
  (раздел «Целевая аудитория» A2, ВКЛЮЧАЯ печать audience_wordings - точка
  подтверждения циклом A2), analysis-verifier (сверка раздела ЦА), /seo-struktura
  (опционально, справочно), оркестратор tekst (wordings -> lexicon.translate).
- Спаривание phrase с терминами заказчика (internal -> public) остается зоной
  ОРКЕСТРАТОРА tekst при сборке lexicon (термины - из intake.json). Правило «строка
  from: persona/model не становится публичной формулировкой без подтверждения»
  переносится в инструкции без изменений; подтверждение = цикл A2.

### 1.4. leader_scan.json v2 - слияние скана смыслов и блок-матрицы (ступень 3)

Пишет: leader-scanner v2 (поглощает leader-block-scanner). Дополнение к текущей схеме:

```json
{
  "leaders": [ "...как сейчас: pages[] c blocks/messages/features..." ],
  "summary": { "...как сейчас..." },
  "blocks_by_type": {                        // бывший leader_blocks.json
    "Категория": [ { "block": "Листинг товаров", "coverage": 0.8, "typical_order": 2, "notes": "…" } ]
  },
  "features_to_steal": [ { "feature": "…", "seen_at": "domain", "page_type": "Категория" } ]
}
```

- Ключи blocks_by_type - русские типы страниц (решение 0.2); имена блоков - словарь
  BLOCKS.md / block_to_fragment (маппинг с внутренним словарем посылов - в инструкции).
- Читают: analysis-writer, read-tekst-input.mjs v2 (выжимка -> texts/leader_blocks.json),
  block-planner и offer-strategist (через выжимку/analysis_dir).
- Выбор страниц лидеров: tier=seo - domain_pages Keyso (как сейчас); tier=basic -
  меню/sitemap лидера через seo_fetch (без метрик).

### 1.4а. competitors.json / candidates.json при tier=basic - ЗАТРОНУТЫ

- Путь кандидатов при basic: client_competitors из брифа + SERP arsenkin_top по
  marker_hint 3-5 направлений. Поля path/keyso-метрики (pages_keyso/top10/top50/dr/
  traffic_month) при basic ОТСУТСТВУЮТ; типизация - по фетчу (лайт); candidates.json
  при basic СОЗДАЕТСЯ (via client_competitors|arsenkin_top, без path). Служебное поле
  `basis: "judgement"` рядом с leaders_top3 - маркер «топ-3 без метрик», единственный
  потребитель - режим enrich того же агента (удаляет при доборе метрик).
- validate-analysis-inputs v2: при basic метрики-ключи и path опциональны,
  serp.json не требуется; при seo - полный набор как сейчас.

### 1.5. recon/<dir_slug>.json - разведка направления (ступень 3)

Путь: analyses/NNN/recon/<dir_slug>.json. Пишет: direction-scanner (веер по
brief.directions). Схема тонкого recon сохраняется + дополнения:

```json
{
  "dir_slug": "…", "marker_used": "…", "serp_source": "arsenkin | none",
  "own_page": {                       // только если directions[].url != null
    "url": "…", "blocks": ["...как сейчас..."],
    "facts_seen": [ { "value": "…", "where": "…" } ]   // КАНДИДАТЫ, не факты
  }
}
```

- own_page снимается на ступени 3 при наличии directions[].url (бывший --mode B;
  флаг удален - поведение данными).
- Читают: analysis-writer (сводно; facts_seen - в A2-вопрос «сверка фактов с вашей
  живой страницы»), block-planner (own_page.blocks - keep-правила; must_have/gaps),
  page-writer (свой recon по dir_slug; ЧУЖОЕ - форма, не цифры; facts_seen НЕ читает),
  offer-strategist (offers_seen), pages-planner v2.
- **Путь own_page-фактов в facts.json**: подтвержденные клиентом на цикле A2
  facts_seen оркестратор АНАЛИЗА дописывает в intake.json полной записью канона
  (field по смыслу кандидата: numbers|prices|guarantee, дефолт numbers; value и
  quote = facts_seen.value дословно; source: "own_page:<url>"; decision_impact:
  true - провенанс ADR-028 сохранен, потребители отбирают по field как обычно) ->
  мост (2.4) доносит их до texts/facts.json штатно. page-writer facts_seen
  не видит никогда - числа только из facts.json (инвариант ADR-033/037).

### 1.6. questions.json / rerun_hint v2

Словарь: `intake | brief | audience | competitors | leaders | directions | serp |
writer | edit`. Downstream-цепочки (полная таблица; при tier=basic serp-звено
ИСКЛЮЧАЕТСЯ из любой цепочки):

```
intake      -> brief -> audience -> competitors -> leaders -> directions -> [serp] -> writer
brief       -> audience -> competitors -> leaders -> directions -> [serp] -> writer
audience    -> writer (оффер-слой текстов ЦА перечитает сам)
competitors -> leaders -> [serp] -> writer
leaders     -> writer
directions  -> writer
serp        -> writer            (только tier=seo)
writer/edit -> как сейчас
```

Синхронно правятся: analysis-writer, apply-answers.mjs + _questions.mjs
(ALLOWED_RERUN_HINTS/STAGE_ORDER), таблица эвристик и ветка 9.0c SKILL.md
/seo-analiz, тесты .claude/tests/seo-analiz (фикстуры questions.json).

### 1.7. Скрипты и гейты анализа

- validate-analysis-inputs.mjs v2: tier-aware (см. 1.4а); проверяет directions[]
  (непусто, слаги уникальны) и audience.json (summary + >= 1 сегмент).
- build-analysis-docx.mjs: serp.json у него УЖЕ опционален; правки - новый раздел ЦА
  и условный SERP-раздел на уровне analysis-writer (генерация A2), не docx-скрипта.
- analysis-verifier: tier-aware структура разделов A2 (SERP-раздел условен),
  audience.json добавляется в источники сверки (раздел ЦА), сверка вердикта с
  serp.json - только при seo. Входит в перечень этапа A.
- /seo-struktura: гейт входа требует tier=seo (иначе стоп: «сначала /seo-analiz
  NNN --add-seo»).

### 1.8. Артефакты ступени 4 и продукты writer при tier=basic

- A3.md и stop_list_detailed.json при basic НЕ создаются (SEO-артефакты ступени 4).
- recommendations.json создается всегда: при basic - только из leader_scan/audience/
  directions-источников (for_pages); for_strategy SERP-выводы - только при seo.
- Executive Summary A2 при basic - без строки «Вердикт» (вместо нее вывод по
  конкурентам); serp.json/candidates.json в чтении analysis-writer - «обязательное
  при tier=seo».

### 1.9. --add-seo (дозакупка ступени 4)

tier -> seo; state возвращается на brief-done и идет вперед в режиме ДООБОГАЩЕНИЯ:

1. brief-structurer: дозаполняет Keyso-поля brief.json + метрики client_pages.
2. competitor-finder: добирает Keyso-метрики direct[], пересматривает leaders_top3;
   если состав лидеров изменился - предупреждение в чат с опцией перезапуска
   leader-scanner v2 (ступень 2 ЦА и directions НЕ перезапускаются).
3. serp-verdict (ступень 4 целиком: serp.json, стоп-лист).
4. analysis-writer (A2 + A3 + stop_list_detailed + recommendations полные) ->
   analysis-verifier -> docx -> re-upload (share.json.revisions[]).

## 2. Мост анализ -> тексты (/seo-tekst шаг 1)

Скрипт read-tekst-input.mjs v2. Создает в texts/NNN/:

### 2.1. inputs.json v2 (ревизия после сверки B)

Пути и параметры пишет СКРИПТ: analysis_dir, structure_dir|null, tier, slug, domain,
region_name, region_yandex (код числом; при --from-analysis скрипт оставляет null -
дописывает оркестратор по PLAYBOOK р.8), плюс КОПИИ из brief.json для читателей
inputs (канон - brief): brand_name (= company_name), forbidden_wordings[],
not_in_assortment[] (при --from-table пусто - деградация). Реквизиты/legal-блок
собирает ОРКЕСТРАТОР из intake.json (requisites/contacts_geo) с фолбэком ЗАКАЗЧИК.md.

### 2.2. pages.json v2

```json
{ "pages": [ { "n": 1, "slug": "…", "url": "…",
               "type": "Главная | Услуга | Категория | Товар | Инфо",
               "marker": "…", "queries": [], "dir_slug": "… | null" } ] }
```

- Таблица нормализации типов источника (в скрипте): Подуслуга->Услуга,
  Главная-каталог->Главная, Карточка товара->Товар, О компании/Контакты/Прочее->Инфо,
  Статья->исключается. Нераспознанный тип -> Инфо + предупреждение в сводке.
- Спаривание dir_slug: нормализация токенов (нижний регистр, е=е, дефисы, стоп-слова)
  и пересечение токенов marker/name страницы с directions[].marker_hint/name >= 50%;
  неспаренное -> null (без recon и сегментной ЦА); оркестратор может доспарить
  вручную правкой pages.json (это данные задачи).
- **Путь без структуры**: первый вызов моста (bridge-done) отдает пустой pages.json
  и ставит источник pages_draft; после гейта состава (pages-approved) оркестратор
  вызывает мост ПОВТОРНО с источником pages_draft.json - тот пишет финальный
  pages.json v2 (слаги по _slug.mjs; dir_slug берет готовым от pages-planner v2).
  Ветка конвертации pages_draft в скрипте СОХРАНЯЕТСЯ (удаляется только флаг
  --from-brief и шаги интейка).

### 2.3. leader_blocks.json - выжимка

blocks_by_type + features_to_steal из leader_scan v2 (механическая выборка скриптом).
Читают: block-planner, offer-strategist. При старом анализе без v2-полей - файла нет.

### 2.4. facts.json - семена

Из intake.json (analyses/) + ЗАКАЗЧИК.md; включая подтвержденные own_page-факты
(см. 1.5). intake-analyst в текстах больше не вызывается. Мост lexicon НЕ сеет
(ревизия после сверки B): client_wordings остаются кандидатами в intake, в
lexicon.locked их переносит только оркестратор на гейтах по правилу трех оснований. Прямой доступ агентов
текстов к analyses/intake.json (read-only по inputs.json.analysis_dir) разрешен:
offer-strategist читает оттуда client_metaphors / client_wordings / internal_terms
(кандидаты в идею и словарь), оркестратор tekst - термины для спаривания lexicon.

## 3. /seo-tekst v7 - новые артефакты

### 3.1. pages_draft.json v2 (быстрая структура, только без структуры)

Пишет pages-planner v2. Как сейчас + у каждой страницы dir_slug (из brief.directions;
новое направление = сначала вопрос на гейте) и type из русского словаря 2.2.

### 3.2. strategy.json v2 (offer-strategist slim)

Текущая схема МИНУС register-варианты (3 черновых первых экрана) и МИНУС design_theme,
плюс:

```json
{
  "decisions": {
    "positioning|idea|price_presentation|cta_tone": {
      "chosen": "как recommended по умолчанию",
      "source": "default | tone-gate-feedback"
    },
    "register": {                    // НОВАЯ ФОРМА (ревизия 2); заполняет тон-гейт
      "tone_id": null, "axes": null, "source": "pending"
    }
  },
  "tone_candidates": [               // ровно 3; один помечен recommended
    { "tone_id": "t1", "name": "Продающий", "recommended": true,
      "axes": { "a": "…", "b": "…", "c": "…" },
      "note": "оттенок под заказчика: что смягчено/усилено и почему" }
  ],
  "...остальное как сейчас: offer_formula_recipe, selling_theses, proof_inventory,
     canonical_wordings, honest_limits, refusal_criteria, materials_have/missing..."
}
```

- После выбора заказчика оркестратор пишет: register = { tone_id, axes: {a,b,c}
  (копия из выбранного кандидата), source: "tone-gate" }. Без ответа - recommended
  (source: "recommended").
- **Читатели register правятся в этапе B все** (агенты пере-авторятся набело:
  block-planner, page-writer, copy-auditor, site-reviewer, tekst-verifier,
  prototype-fixer) **плюс два скрипта явно: verify-copy.mjs (слой регистра) и
  build-handoff.mjs (registerLine)**. Старый разбор (chosen-индекс -> axes[индекс])
  умирает вместе со старой формой. Врезка в ADR-034 - этап B.
- Палитра тонов (список имен + правила оттенков) - в инструкции offer-strategist.

### 3.3. type_skeletons.json (block-planner, такт 1)

```json
{
  "types_present": ["Главная", "Услуга", "Категория"],
  "skeletons": {
    "Категория": {
      "blocks": [ { "block": "Листинг товаров", "function": "Р|Д|К|В", "required": true,
                    "opts": { "filter": true }, "status": "гигиена | отстройка",
                    "evidence": "coverage 0.8 (leader_blocks)", "notes": "…" } ],
      "order_hint": ["…"]
    }
  }
}
```

Ключи - русские типы. Каталог: Категория обязана «Листинг товаров» (filter=true),
Товар обязан product-gallery. Читают: block-planner (такт 2), сводка оркестратора,
verify-prototype v2 (required-блоки каталожных типов).

### 3.4. Тон-гейт

Порядок (закрывает дыру «у blueprint главной нет писателя»):

1. skeletons-done = такт 1 (type_skeletons) + такт 2 ТОЛЬКО для главной:
   block-planner пишет blueprints/main.draft.json, slot-mapper - blueprints/main.json
   (ШТАТНЫЕ пути; папки tone/blueprints НЕТ - варианты читают blueprints/main.json).
2. tone-written: page-writer x3 (по осям каждого tone_candidate) ->
   tone/pages/main--t1|t2|t3/page.json; verify-copy.mjs v2 по каждому варианту
   (машинный пол F1-F3; корень задачи - параметром скрипта, blueprint - main.json,
   waiver ищется по page="main"); copy-auditor лайт-прогоном (П.0 смысл/грамотность;
   пол не судит - зона механики и verify по ADR-037).
3. tone-shared: prototype-builder x3 (render) -> оркестратор пишет
   tone/site_manifest.json -> assemble-prototype.mjs -> tone/tone-preview.html;
   заказчику превью + записка (канон формулировок + materials_missing) - текст
   записки хранится в meta.json.tone_gate.note.
4. tone-revising (цикл правок варианта при фидбеке без выбора) - аналог revising.
5. tone-chosen: выбранный вариант копируется в pages/main/page.json, фидбек
   применяет copy-auditor, register заполняется (3.2); если выбранная ось А меняет
   состав блоков - block-planner повторяет такт 2 для главной и page-writer
   дописывает новые блоки в выбранной манере. Финальная главная проходит штатную
   цепочку 6b-6e вместе с остальными страницами.

```
meta.json.tone_gate = { "status": "written | shared | revising | chosen",
                        "chosen_tone_id": "t2", "note": "текст записки",
                        "feedback": "правки заказчика одной строкой" }
```

Такт 2 для ОСТАЛЬНЫХ страниц (blueprints-ready) идет ПОСЛЕ tone-chosen -
с выбранными осями регистра.

### 3.5. site_manifest.json (прототип, корень texts/NNN/)

```json
{ "pages": [ { "slug": "…", "title": "Название для списка", "type": "…", "order": 1 } ],
  "start": "__index", "main_slug": "main" }
```

Пишет оркестратор (из pages.json; main_slug - слаг главной, при ее отсутствии - первая
по order). Читают: assemble-prototype.mjs, verify-prototype v2. Документ-уровневые данные
(legal с phone-placeholder логикой, титул/мета документа, тема wireframe) ассемблер берет
из manifest.json страницы main_slug - писатель этих полей прежний (prototype-builder).

### 3.6. Прототип: файлы

```
pages/<slug>/render.html   - веер prototype-builder (блоки без shell)
pages/<slug>/manifest.json - как сейчас (источник истины страницы)
prototype.html             - assemble-prototype.mjs (весь сайт одним файлом)
```

Финальные normYoFinal и bindHanging выполняет АССЕМБЛЕР по итоговому документу
(включая стартовую страницу и плашку); канарейка verify v2 указывает на ассемблер.
Expected-маркер хука и /seo-tekst-fix v2 - на texts/NNN/prototype.html.

## 4. State machines v2

### 4.1. /seo-analiz

```
init -> intake-done -> brief-done -> audience-done -> competitors-done -> leaders-done
     -> directions-done -> [serp-done]           # serp только при tier=seo
     -> report-done -> analysis-verified -> docx-done -> shared
     -> client-review <-> revising -> approved -> completed
--add-seo: (approved|completed) -> tier=seo, state=brief-done -> вперед в режиме
           дообогащения (см. 1.9; audience-done и directions-done проходятся
           транзитом без перезапуска агентов)
```

### 4.2. /seo-tekst v7

```
init -> bridge-done -> [pages-drafted -> pages-approved -> pages-built]  # без структуры
     -> strategy-done -> skeletons-done                # такт 1 + такт 2 главной
     -> tone-written -> tone-shared [<-> tone-revising] -> tone-chosen
     -> blueprints-ready                               # такт 2 остальных страниц
     -> texts-written -> copy-audited -> site-reviewed -> verified
     -> texts-shared -> prototype-built -> completed
```

pages-built = повторный вызов моста по pages_draft (см. 2.2). Легаси-веток нет:
задачи старого скила довершаются старым скилом до синка (заметка миграции).

## 5. Таблица «кто пишет - кто читает» (новые/измененные поля)

| Артефакт / поле | Пишет | Читают |
|---|---|---|
| meta.json.tier (analiz) | оркестратор analiz | все ступени, validate v2, /seo-struktura (гейт), мост, /share-analysis, /status |
| brief.json.directions[] (вкл. url) | brief-structurer | audience-analyst, direction-scanner, pages-planner v2, мост, analysis-writer, offer-strategist |
| brief.json Keyso-поля (tier=seo) | brief-structurer (ступень 1) | competitor-finder, leader-scanner v2, serp-verdict, /seo-struktura, /seo-tehaudit |
| analyses/audience.json | audience-analyst | offer-strategist, block-planner (summary), page-writer (summary+сегменты по dir_slug), copy-auditor (summary), prototype-fixer, pages-planner v2 (сегменты для состава), analysis-writer (A2 ЦА + wordings), analysis-verifier, /seo-struktura (опц.), оркестратор tekst (wordings->lexicon) |
| leader_scan.blocks_by_type + features_to_steal | leader-scanner v2 | analysis-writer, мост (выжимка) -> block-planner, offer-strategist |
| analyses/recon/<dir_slug>.json | direction-scanner | analysis-writer, block-planner, page-writer (по dir_slug, без facts_seen), offer-strategist (offers_seen), pages-planner v2 |
| recon.own_page (blocks, facts_seen) | direction-scanner (ступень 3) | block-planner (blocks); facts_seen -> цикл A2 -> оркестратор analiz дописывает intake.json |
| intake.json += own_page-факты | оркестратор analiz (после цикла A2) | мост -> texts/facts.json |
| analyses/intake.json (read-only из tekst) | intake-analyst (ступень 0) | мост (семена facts), offer-strategist (client_metaphors/wordings/internal_terms), оркестратор tekst (спаривание lexicon) |
| questions.rerun_hint v2 + downstream | analysis-writer | apply-answers.mjs/_questions.mjs, оркестратор analiz (9.0c), тесты seo-analiz |
| A3.md / stop_list_detailed (только seo) | analysis-writer (ступень 4 пройдена) | /seo-struktura, sem-конвейеры как сейчас |
| recommendations.json (усечен при basic) | analysis-writer | /seo-struktura, /seo-tekst, /seo-strategiya (декларативно) |
| texts/inputs.json.{analysis_dir,structure_dir,tier} | мост (скрипт); legal - оркестратор из intake | все агенты tekst, prototype-builder (legal) |
| texts/pages.json.{type-словарь,dir_slug} | мост (повторный вызов при pages_draft) | page-writer, block-planner, verify-copy.mjs (COMMERCIAL/F1 по русским типам), вся verify-цепочка |
| texts/leader_blocks.json (выжимка) | мост (скрипт) | block-planner, offer-strategist, pages-planner v2 (типы страниц лидеров; + leader_scan.summary по analysis_dir) |
| texts/facts.json (семена из intake) | мост + оркестратор tekst (гейты) | пишущая цепочка (ADR-033/037 без изменений) |
| strategy.tone_candidates[3] | offer-strategist | оркестратор (тон-гейт), page-writer (оси варианта), записка заказчику |
| strategy.decisions.register (новая форма) | оркестратор tekst (после гейта) | block-planner, page-writer, copy-auditor, site-reviewer, tekst-verifier, prototype-fixer, verify-copy.mjs, build-handoff.mjs - ВСЕ правятся в B |
| type_skeletons.json | block-planner (такт 1) | block-planner (такт 2), сводка в чат, tekst-verifier (check 6); каталожная пара продублирована КОДОМ verify-prototype v2 (файл он не читает) |
| blueprints/main.json (до тон-гейта) | block-planner такт 2 главной + slot-mapper | page-writer x3 (тон-варианты), verify-copy v2, штатная цепочка |
| meta.json.tone_gate (status/note/feedback/chosen_tone_id) | оркестратор tekst | resume, веер (старт после chosen), сводка, build-handoff (записка) |
| tone/pages/main--tN/* | page-writer, copy-auditor, prototype-builder | заказчик (превью), оркестратор; в Texts.docx НЕ входят |
| tone/site_manifest.json | оркестратор tekst | assemble-prototype.mjs (тон-превью) |
| site_manifest.json | оркестратор tekst | assemble-prototype.mjs, verify-prototype v2 |
| pages/<slug>/render.html | prototype-builder | assemble-prototype.mjs |
| texts/prototype.html | assemble-prototype.mjs | заказчик, verify-prototype v2, хук (expected-маркер), /seo-tekst-fix v2 |

## 6. Что удаляется (и кто перестает существовать)

| Удаляется | Причина / замена / хвосты |
|---|---|
| texts шаги 1.5-4 (intake, 2a-брифовая ветка, 2b, 2c, ЦА, гейт стратегии) | ступени /seo-analiz (ADR-038) |
| агент leader-block-scanner | поглощен leader-scanner v2 |
| texts/audience.json, texts/intake.json, texts/ВВОДНЫЕ.md, texts/recon/ | живут в analyses/ |
| --from-brief + профиль tekst у intake-analyst | /seo-analiz --no-seo; единый словарь intake (ветка конвертации pages_draft в мосте СОХРАНЯЕТСЯ) |
| флаг --mode A|B | own_page - данными (directions[].url), не флагом |
| флаги --scan-leaders/--no-scan, --recon/--no-recon (tekst) | переезжают опциями ступени 3 /seo-analiz |
| Analysis_<slug>.docx + гейт стратегии | согласование = цикл A2; канон + materials - записка тон-гейта (врезка в ADR-037 §9 - этап B) |
| скрипт build-tekst-analysis-docx.mjs + его тест-секции | удаляется; share.json.analysis - legacy-поле старых задач |
| /share-tekst --analysis (флаг и ветка) | правка скила в этапе B; остается только Texts.docx (флаг не нужен - аргументы NNN [--redo]) |
| register-варианты стратега (3 черновых первых экрана) + старая форма decisions.register (массивы axes/variants, chosen-индекс) | tone_candidates + новая форма (3.2); правятся все читатели вкл. verify-copy.mjs, build-handoff.mjs |
| strategy.design_theme + --theme + 6 цветных тем | wireframe-only (ADR-039); offer-strategist перестает писать design_theme |
| pages/<slug>/prototype.html (пер-страничные) | texts/prototype.html + render.html; build-handoff.mjs правится (состав файлов, registerLine, литерал состояния) |
| попапы, transitions, manifest.popups, strategy.popups | ADR-039 |
| легаси-ветки --resume старого /seo-tekst | новый state machine; старые задачи - старым скилом |
| значение "adjacent" в directions[].source | смежные направления остаются в A2 разделе 5, в directions не входят |
