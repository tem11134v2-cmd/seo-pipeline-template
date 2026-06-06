---
name: seo-faq
description: SEO-нормализация готовых страниц (фаза У6-Ф2). Берёт текст страницы + целевые запросы, JM-анализом находит недобранные ключи/N-граммы и добавляет SEO-блок - FAQ (Schema.org FAQPage) + возражения + плитка тегов + перелинковка, естественно вшивающие недостающее. Работает по текстам /seo-tekst, готовой таблице, или живым URL. Веер по страницам. Аргументы - [--from-tekst NNN] [--from-table путь] [--url URL] [--review|--auto] [--resume].
---

# seo-faq

Скил-оркестратор SEO-нормализации текстовой релевантности. Запускается **в worktree-сессии**. Порт авторской фазы У6-Ф2 (claude.ai) с JM-анализом - см. [ADR-016](../../../docs/adr/016-faq-task-type.md).

**Что делает:** добавляет к готовой странице **отдельный SEO-блок** (вставляемый в конец): FAQ с микроразметкой Schema.org FAQPage + опц. возражения/мифы + плитка тегов + перелинковка. Содержимое не «вода», а **недостающие по семантике ключи/N-граммы**, вшитые естественным языком - так нормализуется текстовая оптимизация страницы под Яндекс без переспама.

**Дополняет /seo-tekst:** там пишут конверсию (Ф1, для людей), тут - SEO-слой (Ф2, для поиска). Но `/seo-faq` самостоятелен: работает и на чужих живых страницах, не только на свежесгенерённых.

## Аргументы
```
/seo-faq [--from-tekst <NNN>] [--from-table <путь>] [--url <URL>] [--review|--auto] [--resume]
```
- Без источника - **спросит**.
- `--from-tekst <NNN>` - страницы из `texts/<NNN>-*/` (текст из page.json + запросы из pages.json). NNN faq зеркалит NNN текстов.
- `--from-table <путь>` - таблица URL/Маркер/Запросы[/Текст] (csv/tsv).
- `--url <URL>` - одна живая страница (faq-builder сам спарсит текст; дай маркер/запросы).
- `--auto` (по умолчанию) - автономно. `--review` - пауза перед загрузкой в Drive.

## State machine
```
init -> pages-ready -> built -> verified -> shared -> completed
```
`meta.json` - источник истины (`bash .claude/hooks/update-meta.sh <faq_dir> <state>`).

## Артефакты
```
faq/NNN-<slug>/
├── meta.json
├── inputs.json            # slug/регион/бренд/стоп-домены/источник
├── pages.json             # страницы: text + queries + marker + url
├── pages/<page-slug>/
│   ├── faq_blocks.json    # FAQ+возражения+теги+перелинковка + normalized_keywords (faq-builder)
│   ├── faq.html           # ФИНАЛ - вставляемый сниппет (аккордеон + Schema.org + теги)
│   └── faq.md             # читабельно
├── FAQ_<slug>.docx        # КЛИЕНТУ (-> Google Doc)
└── share.json
```

## Алгоритм

### 0a. worktree-проверка / 0b. parse args
Как в /seo-tekst (предупредить если main). `from_tekst / from_table / url / review|auto / resume`.

### 1. Setup
- `--resume`: найти `faq/<NNN>-*/`, прочитать `meta.json`, спросить продолжить.
- Источник (фрэш): если не задан - спросить (1: из текстов NNN; 2: таблицей; 3: живой URL).
- slug/NNN/регион/бренд/стоп-домены -> `inputs.json`. Из `--from-tekst`: взять slug/регион/бренд из `texts/NNN/inputs.json`, **NNN зеркалит**. Иначе из `ЗАКАЗЧИК.md` (`_client.mjs --field`) или спросить. NNN - следующий свободный в `faq/`.
- Создать `faq/<NNN>-<slug>/`. **`.claude/tmp/current-task.txt = faq/<NNN>-<slug>/`** (критично).

### 2. JM-баланс (гейт)
`jm_account` - если баланс < 5, **стоп** с сообщением «пополни JM, затем /seo-faq --resume» (faq-builder без анализа бесполезен). Иначе дальше.

### 3. Страницы (state == init)
```
.claude\scripts\_node.cmd .claude\scripts\read-faq-input.mjs <faq_dir> --from-tekst <texts_dir> | --from-table <путь> | --url <URL> [--marker "..."] [--queries "a|b"]
```
Exit 2 - нет страниц (стоп). Предупреждения «без текста/без запросов» - показать. `update-meta.sh <faq_dir> pages-ready`.

### 4. Сборка SEO-блоков - веер (state == pages-ready)
Делегировать `faq-builder` **на каждую страницу, пачками 6-8** (параллельные writer'ы **без** expected-маркеров - полноту проверит шаг 5). Промт: `faq_dir`, `project_root`, `page_slug`, (опц.) `structure_dir`/`analysis_dir` для перелинковки.
После всех: проверить наличие `pages/<slug>/faq_blocks.json`; отсутствующие - пере-делегировать (до 2). `update-meta.sh <faq_dir> built`.

### 5. Рендер + проверка (state == built)
По каждой странице:
```
.claude\scripts\_node.cmd .claude\scripts\build-faq.mjs <faq_dir>/pages/<slug>/
.claude\scripts\_node.cmd .claude\scripts\verify-faq.mjs <faq_dir>/pages/<slug>/
```
Exit 2 verify - показать нарушения, пере-делегировать страницу faq-builder с инструкцией исправить (до 2). `update-meta.sh <faq_dir> verified`.

### 6. Документ клиенту + Drive (state == verified)
```
.claude\scripts\_node.cmd .claude\scripts\build-faq-docx.mjs <faq_dir>
```
Загрузить `FAQ_<slug>.docx` в Drive (Google Doc), ключ **`texts_folder_id`** (FAQ - часть текстовой выдачи, та же папка «Тексты»); нет ключа / `TODO_*` - скип с подсказкой. Ссылка в `share.json`. `--review`: спросить перед загрузкой. `update-meta.sh <faq_dir> shared`.

### 7. Финал (state == shared)
`update-meta.sh <faq_dir> completed`. Коммит:
```bash
git add -A && git commit -m "FAQ <NNN> for <slug>: SEO-блоки на <N> страниц"
```
Вывести:
```
═══ SEO-БЛОКИ ГОТОВЫ ═══
Клиент: <domain|slug>   Страниц: <N>   FAQ-вопросов: <total>
📄 FAQ (Google Doc): <ссылка>
🧩 Вставляемые сниппеты (в конец каждой страницы, с Schema.org FAQPage):
   faq/<NNN>-<slug>/pages/<slug>/faq.html  (xN)
🔑 Нормализовано ключей/N-грамм: <total>
Дальше: /handoff - перенести в main.
═══════════════════════════
```

## Параллельная работа / API-ошибки
Веер faq-builder пачками 6-8. `529/503/rate_limit` - `ScheduleWakeup` 90 сек, `/seo-faq --resume <NNN>`, до 3 попыток.

## Запреты
- НЕ пиши в корень/общие файлы - только в `faq/<NNN>/`, `.claude/tmp/`.
- НЕ редактируй kit (`seo-tekst/assets/`) - read-only (читаем блоки 33-39 + COPY).
- НЕ переспамь ключами (Акварель/тошнота в норме) - faq-builder контролирует.
- НЕ выдумывай цифры/URL - `[ЗАПОЛНИТЬ: ...]` / только реальные смежные страницы.
- Длинное/среднее тире (— –) запрещено - только дефис (-).
- НЕ запускай другие скилы из этой сессии.
