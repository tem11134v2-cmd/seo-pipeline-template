---
name: seo-analiz
description: Полный цикл предпроектного анализа конкурентов для SEO. Бриф клиента → структурирование → поиск конкурентов → SERP-вердикт → скан смыслов топ-3 → A2.md (раздел 0 «Вопросы к вам» + 5 разделов) + A3.md (стоп-лист) + опц. .docx. Аргументы: [путь к файлу с брифом ИЛИ ничего] [--resume] [--answers].
---

# seo-analiz

Скил-оркестратор предпроектного анализа конкурентов. Запускается **в worktree-сессии**. Проходит state machine от парсинга брифа до финальных A2.md/A3.md и опционально .docx для клиента.

## Аргументы

```
/seo-analiz [--resume] [--no-share] [--answers]
```

- Без аргументов — скил запросит вводную фактуру у пользователя в чате (можно вставить текст или указать пути к файлам).
- `--resume` — продолжить с того места, где остановились (по `meta.json` существующей `analyses/NNN-slug/`).
- `--no-share` - собрать только текстовые артефакты (A2.md + A3.md + questions.json), не делать .docx и не заливать в Drive. Финальное состояние `analysis-verified` вместо `approved` (смысловой гейт шага 6b все равно проходит). Для случаев когда клиента нет, или нужны только текстовые артефакты для следующих услуг.
- `--answers` - режим импорта ответов клиента: прочитать его правки/ответы в Google Doc (по ссылке из `share.json`), заполнить `questions.json` и решить, что перезапустить. Точка входа при state `client-review`/`shared`/`revising`; при нескольких анализах скил спросит `NNN` (явный `/seo-analiz <NNN> --answers` приоритетен).

## State machine

```
init → intake-done → brief-done → competitors-done → serp-done → leaders-done
     → report-done → analysis-verified → docx-done → shared → client-review
          ↻ revising → report-done → analysis-verified → docx-done → shared → client-review (цикл по итерациям правок)
     → approved → completed
```

Состояния:
- `intake-done` - вводная фактура упакована в intake.json + ВВОДНЫЕ.md (шаг 1.5).
- `report-done` — A2.md, A3.md и questions.json собраны (шаг 6).
- `analysis-verified` - смысловой гейт пройден, verify_report.json verdict=pass (шаг 6b). При `--no-share` - финальное состояние.
- `docx-done` — .docx собран (шаг 7). По умолчанию обязательное состояние; пропускается только при `--no-share`.
- `shared` — .docx залит в Drive, ссылка получена (шаг 8). При `--no-share` пропускается.
- `client-review` — скил ждёт фидбек от пользователя по ссылке.
- `revising` — пользователь дал правку (в т.ч. через `--answers`), скил её применяет (Edit или перезапуск шага).
- `approved` — пользователь явно сказал «всё ОК». Только после этого скил рекомендует `/handoff`.
- `completed` — финальное состояние (после `/handoff`).

`meta.json` — единственный источник истины о текущем состоянии. Обновляется через `bash .claude/hooks/update-meta.sh <analysis_dir> <state>`.

## Артефакты

```
analyses/NNN-<domain-slug>/
├── meta.json                  # state machine + drive_file_id + revisions_log
├── brief_raw.txt              # исходный бриф (как пришёл от пользователя; при файлах-источниках — плейсхолдер)
├── intake.json                # вводная фактура: факты с провенансом + gaps + conflicts (шаг 1.5)
├── ВВОДНЫЕ.md                 # человекочитаемый конспект фактуры (шаг 1.5)
├── brief.json                 # 16 параметров + slug + client_pages + keyso_base + путь А/Б/В/Г
├── candidates.json            # 15+ доменов-кандидатов до фильтрации (intermediate)
├── competitors.json           # 6-10 финальных + топ-3 лидера + причины исключений
├── serp.json                  # SERP-анализ + вердикт + промежуточный стоп-лист + смежные
├── leader_scan.json           # блоки/посылы/фишки по топ-3 + сводка с сопоставлением
├── A2.md                      # ФИНАЛ — markdown-отчёт (раздел 0 «Вопросы к вам» + Executive Summary + 5 разделов)
├── A3.md                      # ФИНАЛ — стоп-лист (по строке = домен)
├── questions.json             # ФИНАЛ — канон раздела 0 «Вопросы к вам» (единый источник для docx и --answers)
├── verify_report.json         # вердикт смыслового гейта analysis-verifier (шаг 6b)
├── stop_list_detailed.json    # параллельный machine+human вариант стоп-листа с причинами
├── recommendations.json       # структурированные рекомендации для /seo-strategiya, /seo-statya
├── client_doc.md              # транзиент: выгруженный текст Google Doc клиента (--answers)
├── answers.json               # транзиент: извлеченные ответы клиента (--answers)
├── rerun_plan.json            # транзиент: что перезапускать по ответам клиента (--answers)
├── A2_<slug>.docx             # ASCII-safe имя; собирается всегда кроме --no-share
└── share.json                 # ссылка Drive + drive_file_id + mime_type + shared_at + revisions[]
```

## Алгоритм

### 0a. Проверка: мы в worktree?

```bash
GIT_DIR=$(git rev-parse --git-dir)
COMMON_DIR=$(git rev-parse --git-common-dir)
```

Если `GIT_DIR == COMMON_DIR` — мы в main. Предупредить:
> «⚠️ Ты собираешь предпроектный анализ в main-сессии. Pre-commit hook здесь не блокирует. Для многозадачности рекомендую закрыть и переоткрыть с галочкой worktree.»

Не блокировать — пользователь может сознательно так захотеть.

### 0b. Parse args

```
resume = true если --resume
```

### 1. Setup

#### 1a. Если `--resume`

- Найти существующую `analyses/<NNN>-*/`. Если несколько кандидатов — спросить пользователя.
- Прочитать `meta.json`. `state = meta.state`.
- Спросить: «Найдено в состоянии `<state>`, обновлено `<updated>`. Продолжить? [Y/n]»
- Если Y — перейти к ветке от следующего шага после `state`:
  - `init` → шаг 1.5 (интейк)
  - `intake-done` → шаг 2 (брифование)
  - `brief-done` → шаг 3 (конкуренты)
  - `competitors-done` → шаг 4 (SERP-вердикт)
  - `serp-done` → шаг 5 (скан смыслов)
  - `leaders-done` → шаг 6 (сборка A2 + A3 + questions.json)
  - `report-done` → шаг 6b (смысловой гейт analysis-verifier)
  - `analysis-verified` → шаг 7 (.docx); при `--no-share` - шаг 10 (финал)
  - `docx-done` → шаг 8 (Drive)
  - `shared` → шаг 8e (вывести ссылку, перейти в `client-review`)
  - `client-review` → шаг 9 (показать ссылку из `share.json`, ждать фидбек); при `--answers` - шаг 9.0
  - `revising` → шаг 9d (продолжить применять последнюю правку); при `--answers` - шаг 9.0c
  - `approved` → шаг 10 (финал)
  - `completed` → стоп: «Анализ уже завершён. Используй `/share-analysis <NNN> --redo` для перезаливки.»
- Если N - стоп, дать пользователю выбрать другую папку или начать заново.

#### 1b. Если фрэш-старт

1. **Получить фактуру.** Спросить пользователя:
   > «Передай вводную фактуру - бриф, транскрибацию созвона, любые файлы. Если это ФАЙЛЫ - дай пути (не вставляй содержимое в чат). Если текст - вставь, я сохраню в файл. Минимум: ниша + регион.»
2. **Разложить фактуру по путям (НЕ читать ее в главный контекст):**
   - Если пользователь дал ПУТИ к файлам - НЕ открывать их `Read`'ом в свой контекст. Собрать список путей. `brief_raw.txt` в этом случае - либо один из этих файлов (если это и есть бриф), либо пустой плейсхолдер.
   - Если пользователь вставил ТЕКСТ - сохранить как есть в `<analysis_dir>/brief_raw.txt` (одним `Write`) и дальше оперировать ТОЛЬКО путем `brief_raw.txt`.
   - Собрать `intake_sources = [{path, label, type}]` по всем источникам (`brief_raw.txt` + приложенные файлы/транскрибации). Финализируется после создания папки (шаг 5), когда известен `<analysis_dir>`.
3. **(домен + slug).** Из первого источника быстро (одной попыткой, без MCP) выделить **домен** (если есть) и **нишу + регион** для построения slug. Если источник - файл, для ЭТОГО можно прочитать только его шапку/первые строки, не весь массив. Например, `niche="ремонт квартир", region="спб"` → `slug = "remont-kvartir-spb"`. Если домен есть и узнаваем - `slug = slugify(domain)` (Latin kebab-case, IDN → транслит).
4. Найти следующий свободный номер `NNN` в `analyses/` (начиная с 001, с ведущим нулём).
5. Создать папку `analyses/<NNN>-<slug>/`. Если пользователь вставил ТЕКСТ - записать `analyses/<NNN>-<slug>/brief_raw.txt` (исходный бриф целиком); если дал ПУТИ - создать `brief_raw.txt` пустым плейсхолдером (или скопировать в него бриф-файл), остальные пути оставить в `intake_sources`.
6. Записать `.claude/tmp/current-task.txt` с путём `analyses/<NNN>-<slug>/` (**критично — без этого pre-commit hook откажет в коммите**).
7. Создать `meta.json`:
   ```json
   {
     "slug": "<slug>",
     "state": "init",
     "completed_steps": [],
     "started": "<ISO UTC>",
     "updated": "<ISO UTC>"
   }
   ```
8. `state = "init"`. Переход к шагу 1.5 (интейк).

### 1.5. Интейк - упаковка вводной фактуры (если state == "init")

Маркер: `.claude/tmp/expected-intake-analyst-<run_id>.txt = <analysis_dir>/intake.json`

Делегировать `intake-analyst`:
```
analysis_dir: <analysis_dir>
intake_sources: <список путей + ярлыков: brief_raw.txt и приложенные файлы/транскрибации>
project_root: <project root>
Прочитай всю фактуру по путям + ЗАКАЗЧИК.md (если есть). Собери intake.json (факты с source + цитатой, gaps, conflicts) + ВВОДНЫЕ.md. Провенанс обязателен для решающих фактов (УТП, запреты, гео, ассортимент, бюджеты).
```

После завершения:
- Проверить, что `intake.json` и `ВВОДНЫЕ.md` созданы и непусты (иначе ре-делегировать с явным указанием).
- `bash .claude/hooks/update-meta.sh <analysis_dir> intake-done`
- Сводка от агента - в чат (сами факты не выводить, они в файлах). Переход к шагу 2 (брифование поверх intake.json).

### 2. Брифование (если state == "intake-done")

(служебный маркер контракта агента создаётся автоматически — не выводить в чат)

Делегировать `brief-structurer`:
```
analysis_dir: <analysis_dir>
intake_path: <analysis_dir>/intake.json
brief_raw_path: <analysis_dir>/brief_raw.txt
project_root: <project root>
Прочитай intake.json, смаппь факты в 16 параметров, унаследуй gaps. Если есть домен - проверь его через domain_dashboard и заполни domain_dashboard_snapshot. Определи keyso_base и путь А/Б/В/Г. Сохрани <analysis_dir>/brief.json. (Если intake.json отсутствует - fallback на brief_raw.txt.)
```

После завершения:
- `bash .claude/hooks/update-meta.sh <analysis_dir> brief-done`
- Сводка от агента - в чат. Если `brief.gaps` непуст и есть критичные дыры (нет ниши или нет региона) - спросить пользователя: «В брифе не хватает критичных полей: `<список>`. Продолжаем на неполных данных или дополнишь?»
- Иначе — сразу переход к шагу 3.

### 3. Конкуренты (если state == "brief-done")

(служебный маркер контракта агента создаётся автоматически — не выводить в чат)

Делегировать `competitor-finder`:
```
analysis_dir: <analysis_dir>
project_root: <project root>
Прочитай brief.json и MCP_MAP.md. Найди конкурентов по пути <brief.path>, отфильтруй агрегаторы и нерелевантные, собери метрики по оставшимся, отбери 6-10 + топ-3 лидера. Сохрани candidates.json (промежуточный) и competitors.json (финальный).
```

После завершения:
- `bash .claude/hooks/update-meta.sh <analysis_dir> competitors-done`
- Сводка от агента - в чат. Если `competitors.direct.length < 6` - предупредить пользователя: «Найдено только `<N>` прямых конкурентов. Проверим - может быть нишa очень узкая или путь нужно поменять. Продолжаем?»
- Иначе — переход к шагу 4.

### 4. SERP-вердикт (если state == "competitors-done")

(служебный маркер контракта агента создаётся автоматически — не выводить в чат)

Делегировать `serp-verdict`:
```
analysis_dir: <analysis_dir>
project_root: <project root>
Прочитай brief.json, competitors.json, candidates.json, MCP_MAP.md. Проанализируй SERP по 3-5 коммерческим запросам, сформулируй вердикт совместимости, собери промежуточный стоп-лист и смежные направления. Сохрани serp.json.
```

После завершения:
- `bash .claude/hooks/update-meta.sh <analysis_dir> serp-done`
- Сводка от агента - в чат, включая вердикт.
- **Если вердикт `КОРРЕКТИРУЕМ ТИП САЙТА`, `МЕНЯЕМ СТРАТЕГИЮ` или `ИДЁМ С ОГОВОРКАМИ`** — пауза с детальной сводкой:
  > «**Вердикт:** `<тип>`
  >
  > **Что это значит:** <1-2 предложения, из serp.verdict.reasoning>
  >
  > **Главные рекомендации:**
  > 1. <serp.verdict.recommendations[0]>
  > 2. <serp.verdict.recommendations[1]>
  > 3. <serp.verdict.recommendations[2]>
  >
  > Это стратегическое решение. Рекомендуется обсудить с клиентом ДО продолжения. Продолжаем скан смыслов сейчас или приостановим? [Y - продолжить / N - приостановить и обсудить]»
  - Если N — оставить state `serp-done`, выйти. Пользователь может потом запустить `--resume`.
- Если вердикт `ИДЁМ` — сразу переход к шагу 5 без паузы.

### 5. Скан смыслов (если state == "serp-done")

(служебный маркер контракта агента создаётся автоматически — не выводить в чат)

Делегировать `leader-scanner`:
```
analysis_dir: <analysis_dir>
project_root: <project root>
Прочитай brief.json, competitors.json, MCP_MAP.md. По каждому из leaders_top3 — domain_pages, выбери 3-4 страницы, fetch'ни их, извлеки блоки/посылы/фишки. Сделай сводку с сопоставлением УТП клиента. Сохрани leader_scan.json. Это НЕ полный аудит — только скан смыслов.
```

После завершения:
- `bash .claude/hooks/update-meta.sh <analysis_dir> leaders-done`
- Сводка от агента - в чат. Переход к шагу 6.

### 6. Сборка A2 + A3 (если state == "leaders-done")

(служебный маркер контракта агента создаётся автоматически — не выводить в чат)

(Скил проверяет A2 через маркер. A3.md и questions.json проверяются отдельно - после возврата агента: если A3.md или questions.json не создан или пуст, повторно делегировать с явным указанием.)

Делегировать `analysis-writer`:
```
analysis_dir: <analysis_dir>
project_root: <project root>
Прочитай brief.json, competitors.json, serp.json, leader_scan.json, candidates.json, intake.json (gaps + conflicts -> вопросы раздела 0). Собери questions.json (3-7 вопросов раздела «0. Вопросы к вам»), A2.md (раздел 0 перед Executive Summary + 5 разделов в фиксированной структуре) и A3.md (дедуплицированный, отсортированный стоп-лист доменов).
```

После возврата `analysis-writer` и проверки A3.md + questions.json (непусты):
- Финальный гейт машинных источников (то, что дальше читает `/seo-struktura`):
  ```
  .claude\scripts\_node.cmd .claude\scripts\validate-analysis-inputs.mjs <analysis_dir>
  ```
  - exit 0 - канон-схема brief/competitors/serp цела -> продолжаем.
  - exit 2 - дрейф схемы в JSON-источниках (печатает построчно). Ловим ДО отдачи. Пере-делегировать соответствующего продюсера (`brief-structurer` / `competitor-finder` / `serp-verdict`), затем повторить. Лимит 2 повтора, иначе стоп с показом нарушений.
  - exit 1 - ошибка запуска, показать stderr, стоп.
- `bash .claude/hooks/update-meta.sh <analysis_dir> report-done`
- Вывести пользователю краткую сводку + пути к A2.md, A3.md, `questions.json`, `recommendations.json`, `stop_list_detailed.json`.
- Дальше - шаг 6b (смысловой гейт analysis-verifier), НЕ сразу docx (и не сразу финал даже при `--no-share`).

### 6b. Смысловой гейт анализа (если state == "report-done")

Маркер: `.claude/tmp/expected-analysis-verifier-<run_id>.txt = <analysis_dir>/verify_report.json`

Делегировать `analysis-verifier`:
```
analysis_dir: <analysis_dir>
project_root: <project root>
Прочитай A2.md + brief.json + intake.json + competitors.json + serp.json + leader_scan.json + questions.json + A3.md. Сверь цифры/факты, полноту разделов (0-5), согласованность раздела 0 с questions.json, непротиворечивость вердикта serp.json, клиентский язык и стиль. Ничего не чини. Запиши verify_report.json.
```

После - прочитать `verify_report.json` (точечно `verdict` + `counters`, не весь файл):
- `verdict == pass` → `bash .claude/hooks/update-meta.sh <analysis_dir> analysis-verified`
  - Если `--no-share`: это финал текстовых артефактов → шаг 10 (финал) на state `analysis-verified`. Не делать docx и не грузить в Drive.
  - Иначе → шаг 7 (docx).
- `verdict == needs-fix` / `fail` → пере-делегировать `analysis-writer` с issues из отчета (макс 2 повтора), затем повторить validate-analysis-inputs (шаг 6) и analysis-verifier (6b). После 2 повторов без pass - стоп с показом issues пользователю.

### 7. Сборка .docx (если state == "analysis-verified", обязательно кроме --no-share)

```
.claude\scripts\_node.cmd .claude\scripts\build-analysis-docx.mjs <analysis_dir>
```

Скрипт читает `A2.md` + `brief.json` + `serp.json` + `questions.json` (раздел 0), генерирует `<analysis_dir>/A2_<slug>.docx` (ASCII-safe имя - после фикса в волне 1).

После:
- `bash .claude/hooks/update-meta.sh <analysis_dir> docx-done`
- Переход к шагу 8 (Drive).

### 8. Upload в Drive (если state == "docx-done", обязательно кроме --no-share)

#### 8a. Прочитать DRIVE.md

`~/.claude/seo-knowledge/DRIVE.md` → извлечь `analyses_folder_id`.

Если файла или поля нет — стоп:
> «Не найден `analyses_folder_id` в DRIVE.md. Создай папку `/SEO/Analyses/` в Drive с правами `anyone-with-link → reader`, добавь её ID в DRIVE.md. Затем продолжи через `/seo-analiz --resume`.»

#### 8b. Если в meta.json есть `drive_file_id` (revising-цикл)

Это значит — повторная заливка после правок. Удалить старый файл по `drive_file_id` (тогда новый получит новый ID, но это норм для revising-цикла; ссылка может поменяться). Альтернатива: использовать `mcp__gdrive-piotr__uploadFile` с тем же `name` — если папка с `anyone-with-link` правами, Drive обновит файл по имени. **Идти по простому пути: delete + upload.**

```
mcp__gdrive-piotr__deleteItem(itemId="<old_drive_file_id>")
```

(Если deleteItem упал — файл уже удалён руками. Предупредить, продолжить.)

#### 8c. Загрузка

```
mcp__gdrive-piotr__uploadFile(
  localPath: <абсолютный путь к A2_<slug>.docx>,
  name: A2_<slug>,
  parentFolderId: <analyses_folder_id>,
  mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  convertToGoogleFormat: true
)
```

Если `convertToGoogleFormat: true` упал (Google Docs API не активна) — fallback: повторить с `convertToGoogleFormat: false`. В сводку добавить:
> ⚠️ Залит как .docx (Google Docs API не активна). Активируй в Google Cloud Console, потом `/share-analysis <NNN> --redo`.

Сохранить `id`, `link` из ответа.

#### 8d. Записать `share.json` и обновить meta.json

`<analysis_dir>/share.json`:

```json
{
  "drive_file_id": "<id>",
  "drive_link": "<link>",
  "mime_type": "application/vnd.google-apps.document" | "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "shared_at": "<ISO timestamp UTC>",
  "revisions": []
}
```

В `meta.json` добавить через жёлтый `Edit` (или через `update-meta.sh ... drive_file_id=<id>`):

```json
"drive_file_id": "<id>",
"drive_link": "<link>"
```

`bash .claude/hooks/update-meta.sh <analysis_dir> shared`

#### 8e. Переход в состояние `client-review`

`bash .claude/hooks/update-meta.sh <analysis_dir> client-review`

Вывести пользователю:

```
═══ A2 ГОТОВ И ЗАЛИТ В DRIVE ═══

📄 Ссылка для клиента (Google Doc):
   <drive_link>

📌 Локальные артефакты:
   <analysis_dir>/A2.md
   <analysis_dir>/A3.md
   <analysis_dir>/recommendations.json
   <analysis_dir>/A2_<slug>.docx

🔎 Сводка вердикта:
   <serp.verdict.type>

📋 Главные действия (топ-3 из recommendations.json):
   1. <item> (priority: <p>)
   2. ...
   3. ...

✍️ Клиенту: «Ознакомьтесь с документом. Главное - ответьте на вопросы в самом начале
   (раздел 0 «Вопросы к вам»). Можно коротко: "согласен с рекомендованным" по каждому
   или свой вариант. Ответы можно писать прямо в Google Doc.»

Жду фидбек:
  - "одобряю" / "OK" / "approved" → скил перейдёт в approved и подскажет /handoff
  - "есть правки: <описание>" → скил классифицирует и применит
  - клиент ответил в Google Doc → запусти /seo-analiz --answers (я прочитаю его ответы)
```

**Не выходить из сессии. Ждать пользовательский ввод. После любого фидбека — шаг 9 или 10.**

### 9. Обработка фидбека (state == "client-review")

#### 9.0. Режим `--answers` (клиент ответил в Google Doc)

Точка входа: `/seo-analiz --answers`. Найти анализ в state `client-review`/`shared`/`revising`; если несколько - спросить `NNN` (явный `/seo-analiz <NNN> --answers` всегда приоритетен). Прочитать `<analysis_dir>/share.json` → `drive_file_id` (doc_id) + `mime_type`.

**a) Выгрузить Google Doc клиента.** Если `mime_type == "application/vnd.google-apps.document"`:
```
text = mcp__gdrive-piotr__readGoogleDoc(documentId=<doc_id>, format="markdown")
```
СРАЗУ записать `text` в `<analysis_dir>/client_doc.md` (`Write`) и дальше работать ПУТЕМ, не цитируя содержимое в чат (диета контекста). Если `readGoogleDoc` упал / `mime` = .docx (Docs API не активна при заливке) - перейти к fallback (9.0d).

**b) Делегировать `answer-extractor`** (маркер → `answers.json`):

Маркер: `.claude/tmp/expected-answer-extractor-<run_id>.txt = <analysis_dir>/answers.json`
```
analysis_dir: <analysis_dir>
client_doc_path: <analysis_dir>/client_doc.md
questions_path: <analysis_dir>/questions.json
project_root: <project root>
```

**c) Слить ответы детерминированно:**
```
.claude\scripts\_node.cmd .claude\scripts\apply-answers.mjs <analysis_dir> --source google-doc
```
- exit 2 → схема questions/answers битая: показать построчно и стоп (или пере-делегировать extractor 1 раз).
- exit 1 → ошибка запуска (нет папки/файлов/битый JSON), показать stderr, стоп.
- exit 0 → прочитать `rerun_plan.json` (точечно `deepest_stage` + `buckets`).

Перейти в state `revising`: `bash .claude/hooks/update-meta.sh <analysis_dir> revising`.

Дальше - как 9d, но список типов перезапуска берется из `rerun_plan` (НЕ из чат-эвристик 9c). По `deepest_stage`:
- `brief` → `brief-structurer` + downstream (`competitor-finder`, `serp-verdict`, `leader-scanner`, `analysis-writer`)
- `competitors` / `serp` / `leaders` → соответствующий шаг + downstream
- `writer` → только `analysis-writer`
- `edit` → точечные `Edit` A2.md по `free_comments` (без перезапусков)
- `none` → перезапусков нет; ответы «согласен с рекомендованным» уже отражены в A2; при наличии `free_comments` применить их как `edit`

«Согласен с рекомендованным» - валидный ответ, перезапуска не требует. Затем 9e (report-done → шаг 6b → re-build docx + re-upload) → `client-review`.

**d) Fallback (Drive недоступен / не Google Doc):** попросить ассистента вставить ответы текстом в чат. Тогда:
- либо вставленный текст записать в `client_doc.md` и пойти по 9.0b-c (детерминированный путь),
- либо (совсем ручной режим) - существующая классификация 9c по чат-эвристикам.

#### 9a. Если пользователь одобрил

Триггеры одобрения (case-insensitive): «одобряю», «ок», «approved», «всё хорошо», «принято», «accept».

- `bash .claude/hooks/update-meta.sh <analysis_dir> approved`
- Переход к шагу 10 (финал).

#### 9b. Если пользователь дал правку

Перейти в state `revising`:

`bash .claude/hooks/update-meta.sh <analysis_dir> revising`

#### 9c. Классификация правки (Гибрид — модель C)

На основе текста правки скил предлагает свою классификацию и просит OK:

```
Получил правку: "<цитата правки 1 строкой>"

Похоже это [<тип>]:
  - тип "edit"      — точечная правка текста A2.md (формулировка, опечатка, добавить пункт)
  - тип "brief"     — добавить контекст про клиента (страницу, УТП, ассортимент)
  - тип "competitors" — поправить список конкурентов
  - тип "serp"      — пересчитать SERP / поправить вердикт
  - тип "leaders"   — пересканировать лидеров с уточнением
  - тип "writer"    — пересобрать A2 без перезапуска нижних шагов

Согласен? [Y / n=другой тип / details=покажи парс правки]
```

**Эвристики автоклассификации:**

| Признак в тексте правки | Тип |
|---|---|
| Содержит конкретную цитату из A2.md, или «переформулируй / убери / добавь пункт» | `edit` |
| «Вы пропустили», «не учли», «у клиента есть X» + упоминание URL/страницы | `brief` |
| «Не тот конкурент», «забыли A.ru», «B.ru не оттуда» | `competitors` |
| «Не тот запрос», «вердикт неправильный», «не считайте Y коммерческим` | `serp` |
| «У X есть фишка Y», «у Z блок W», «лидер делает по-другому» | `leaders` |
| Не подходит ни под одно — | `writer` |

Если пользователь сказал `n` — спросить тип явно (тот же список без рекомендации).

**Если правка пришла через `--answers`** (есть свежий `rerun_plan.json`) - классификация УЖЕ сделана детерминированно (по `questions.json.answers` + `rerun_hint`). Использовать `rerun_plan` (см. 9.0c), эвристики таблицы 9c НЕ применять. Ручной чат-ввод - как раньше по таблице.

#### 9d. Применение правки по типу

**`edit`:** скил делает `Edit` в `A2.md` напрямую. Без перезапуска. Без апдейтов JSON.

**`brief`/`competitors`/`serp`/`leaders`:** пересобрать соответствующий JSON, потом downstream:

- `brief` — делегировать `brief-structurer` с дополнительной инструкцией «правка: <описание>; явно учти X». Затем перезапустить `competitor-finder`, `serp-verdict`, `leader-scanner`, `analysis-writer` последовательно. Может занять 10-20 минут.
- `competitors` — `competitor-finder` с пометкой, затем `serp-verdict`, `leader-scanner`, `analysis-writer`.
- `serp` — `serp-verdict`, затем `analysis-writer`.
- `leaders` — `leader-scanner`, затем `analysis-writer`.

**`writer`:** только перезапустить `analysis-writer` с инструкцией «при сборке учти: <правка>».

#### 9e. Re-build .docx и re-upload

- Перед пересборкой docx провести правку через гейт: `bash .claude/hooks/update-meta.sh <analysis_dir> report-done`, затем шаг 6 (validate-analysis-inputs) + шаг 6b (analysis-verifier). Только при `verdict=pass` (state `analysis-verified`) продолжать; при needs-fix/fail - ре-делегация `analysis-writer` (лимит 2), как в 6b.
- Перезапустить `build-analysis-docx.mjs`.
- Шаг 8b (delete старого Drive-файла) + 8c (upload нового).
- Обновить `share.json.revisions[]`:

```json
{
  "type": "<edit|brief|...>",
  "note": "<текст правки 1 строкой>",
  "applied_at": "<ISO>",
  "new_drive_file_id": "<id>",
  "new_drive_link": "<link>"
}
```

- Вернуться в `client-review` (шаг 8e). Цикл может повторяться.

### 10. Финал

`bash .claude/hooks/update-meta.sh <analysis_dir> completed`

Финальный коммит:
```
git add -A
git commit -m "Analysis <NNN> for <slug или domain>: completed (<N> revisions)"
```

Вывести:

```
═══ ПРЕДПРОЕКТНЫЙ АНАЛИЗ ОДОБРЕН ═══

Клиент: <domain или niche / region>
Итераций правок: <N>

📄 A2 в Drive (Google Doc, для клиента):
   <drive_link>

📌 Локальные артефакты для следующих услуг:
   <analysis_dir>/A2.md                     - У3, У5
   <analysis_dir>/A3.md                     - стоп-лист
   <analysis_dir>/recommendations.json      - структурированные рекомендации
   <analysis_dir>/stop_list_detailed.json   - стоп-лист с причинами

✅ Готово к /handoff (перенесёт в main).

➡️ Следующий шаг конвейера (У3 - структура сайта):
   В новой worktree-сессии запусти:
     /seo-struktura <NNN>
   Скил прочитает analyses/<NNN>-<slug>/ (brief.json, competitors.json, serp.json,
   leader_scan.json), соберёт мастер-список страниц, маркеры через каскад
   Keyso → JM, проверит каннибализацию, сгенерирует A6.xlsx → клиенту → A6.md.
═════════════════════════════════════════
```

## Параллельная работа

Несколько анализов одновременно — каждый в своём worktree:
```
claude --worktree analysis-002
```

Состояния не пересекаются.

## Запреты

- НЕ пиши результаты в корень проекта — только в `<analysis_dir>/`. Иначе pre-commit отклонит.
- НЕ пропускай состояния — каждое `update-meta.sh` обязательно.
- НЕ редактируй общие файлы (`ЗАКАЗЧИК.md`, `template.html`, `topics.xlsx`) — read-only из worktree.
- НЕ используй длинное тире (—) и среднее (–). Только дефис (-).
- НЕ используй букву ё - всегда пиши е. Правило для всех клиентских текстов и метатегов (как и запрет тире).
- НЕ делай `git push` и не публикуй артефакты — это решение пользователя.
- НЕ запускай `/seo-statya`, `/seo-strategiya`, `/seo-temi` из этой же сессии — отдельные worktree-задачи.
