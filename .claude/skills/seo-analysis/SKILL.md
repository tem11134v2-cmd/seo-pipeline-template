---
name: seo-analysis
description: Полный цикл предпроектного анализа конкурентов для SEO. Бриф клиента → структурирование → поиск конкурентов → SERP-вердикт → скан смыслов топ-3 → A2.md (5 разделов) + A3.md (стоп-лист) + опц. .docx. Аргументы: [путь к файлу с брифом ИЛИ ничего] [--resume].
---

# seo-analysis

Скил-оркестратор предпроектного анализа конкурентов. Запускается **в worktree-сессии**. Проходит state machine от парсинга брифа до финальных A2.md/A3.md и опционально .docx для клиента.

## Аргументы

```
/seo-analysis [--resume] [--no-share]
```

- Без аргументов — скил запросит бриф у пользователя в чате (можно вставить текст или указать путь к файлу).
- `--resume` — продолжить с того места, где остановились (по `meta.json` существующей `analyses/NNN-slug/`).
- `--no-share` — собрать только A2.md + A3.md, не делать .docx и не заливать в Drive. Финальное состояние `report-done` вместо `approved`. Для случаев когда клиента нет, или нужны только текстовые артефакты для следующих услуг.

## State machine

```
init → brief-done → competitors-done → serp-done → leaders-done → report-done
     → docx-done → shared → client-review
          ↻ revising → docx-done → shared → client-review (цикл по итерациям правок)
     → approved → completed
```

Состояния:
- `report-done` — A2.md и A3.md собраны (шаг 6).
- `docx-done` — .docx собран (шаг 7). По умолчанию обязательное состояние; пропускается только при `--no-share`.
- `shared` — .docx залит в Drive, ссылка получена (шаг 8). При `--no-share` пропускается.
- `client-review` — скил ждёт фидбек от пользователя по ссылке.
- `revising` — пользователь дал правку, скил её применяет (Edit или перезапуск шага).
- `approved` — пользователь явно сказал «всё ОК». Только после этого скил рекомендует `/handoff`.
- `completed` — финальное состояние (после `/handoff`).

`meta.json` — единственный источник истины о текущем состоянии. Обновляется через `bash .claude/hooks/update-meta.sh <analysis_dir> <state>`.

## Артефакты

```
analyses/NNN-<domain-slug>/
├── meta.json                  # state machine + drive_file_id + revisions_log
├── brief_raw.txt              # исходный бриф (как пришёл от пользователя)
├── brief.json                 # 16 параметров + slug + client_pages + keyso_base + путь А/Б/В/Г
├── candidates.json            # 15+ доменов-кандидатов до фильтрации (intermediate)
├── competitors.json           # 6-10 финальных + топ-3 лидера + причины исключений
├── serp.json                  # SERP-анализ + вердикт + промежуточный стоп-лист + смежные
├── leader_scan.json           # блоки/посылы/фишки по топ-3 + сводка с сопоставлением
├── A2.md                      # ФИНАЛ — markdown-отчёт (Executive Summary + 5 разделов)
├── A3.md                      # ФИНАЛ — стоп-лист (по строке = домен)
├── stop_list_detailed.json    # параллельный machine+human вариант стоп-листа с причинами
├── recommendations.json       # структурированные рекомендации для /strategy, /write-article
├── A2_<slug>.docx             # ASCII-safe имя; собирается всегда кроме --no-share
└── share.json                 # ссылка Drive + drive_file_id + shared_at + revisions[]
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
  - `report-done` → шаг 7 (.docx)
  - `docx-done` → шаг 8 (Drive)
  - `shared` → шаг 8e (вывести ссылку, перейти в `client-review`)
  - `client-review` → шаг 9 (показать ссылку из `share.json`, ждать фидбек)
  - `revising` → шаг 9d (продолжить применять последнюю правку из `share.json.revisions[]`)
  - `approved` → шаг 10 (финал)
  - `completed` → стоп: «Анализ уже завершён. Используй `/share-analysis <NNN> --redo` для перезаливки.»
- Если N — стоп, дать пользователю выбрать другую папку или начать заново.

#### 1b. Если фрэш-старт

1. **Получить бриф.** Спросить пользователя:
   > «Передай бриф клиента — текст в чат (опросник / свободный текст / расшифровка) или путь к файлу. Минимум: ниша + регион.»
2. Если пользователь дал путь — прочитать файл. Если текст — сохранить как есть.
3. Из текста брифа быстро (одной попыткой, без MCP) выделить **домен** (если есть) и **ниху + регион** для построения slug. Например, `niche="ремонт квартир", region="спб"` → `slug = "remont-kvartir-spb"`. Если домен есть и узнаваем — `slug = slugify(domain)` (Latin kebab-case, IDN → транслит).
4. Найти следующий свободный номер `NNN` в `analyses/` (начиная с 001, с ведущим нулём).
5. Создать папку `analyses/<NNN>-<slug>/`. Записать `analyses/<NNN>-<slug>/brief_raw.txt` (исходный бриф целиком).
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
8. `state = "init"`. Переход к шагу 2.

### 2. Брифование (если state == "init")

(служебный маркер контракта агента создаётся автоматически — не выводить в чат)

Делегировать `brief-structurer`:
```
analysis_dir: <analysis_dir>
brief_raw_path: <analysis_dir>/brief_raw.txt
project_root: <project root>
Прочитай brief_raw.txt, извлеки 16 параметров. Если есть домен — проверь его через domain_dashboard и заполни domain_dashboard_snapshot. Определи keyso_base и путь А/Б/В/Г. Сохрани <analysis_dir>/brief.json.
```

После завершения:
- `bash .claude/hooks/update-meta.sh <analysis_dir> brief-done`
- Сводка от агента — в чат. Если `brief.gaps` непуст и есть критичные дыры (нет ниши или нет региона) — спросить пользователя: «В брифе не хватает критичных полей: `<список>`. Продолжаем на неполных данных или дополнишь?»
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
- Сводка от агента — в чат. Если `competitors.direct.length < 6` — предупредить пользователя: «Найдено только `<N>` прямых конкурентов. Проверим — может быть нишa очень узкая или путь нужно поменять. Продолжаем?»
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
- Сводка от агента — в чат, включая вердикт.
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
- Сводка от агента — в чат. Переход к шагу 6.

### 6. Сборка A2 + A3 (если state == "leaders-done")

(служебный маркер контракта агента создаётся автоматически — не выводить в чат)

(Скил проверяет A2 через маркер. A3 проверяется отдельно — после возврата агента: если A3.md не создан или пуст, повторно делегировать с явным указанием.)

Делегировать `analysis-writer`:
```
analysis_dir: <analysis_dir>
project_root: <project root>
Прочитай brief.json, competitors.json, serp.json, leader_scan.json, candidates.json. Собери A2.md (5 разделов в фиксированной структуре) и A3.md (дедуплицированный, отсортированный стоп-лист доменов).
```

После завершения:
- `bash .claude/hooks/update-meta.sh <analysis_dir> report-done`
- Вывести пользователю краткую сводку + пути к A2.md, A3.md, `recommendations.json`, `stop_list_detailed.json`.
- Если запущено с `--no-share`: переход к финалу (шаг 9) с state `report-done`. Не делать docx и не грузить в Drive.
- Иначе: автоматический переход к шагу 7 (без вопроса).

### 7. Сборка .docx (если state == "report-done", обязательно кроме --no-share)

```
.claude\scripts\_node.cmd .claude\scripts\build-analysis-docx.mjs <analysis_dir>
```

Скрипт читает `A2.md` + `brief.json` + `serp.json`, генерирует `<analysis_dir>/A2_<slug>.docx` (ASCII-safe имя — после фикса в волне 1).

После:
- `bash .claude/hooks/update-meta.sh <analysis_dir> docx-done`
- Переход к шагу 8 (Drive).

### 8. Upload в Drive (если state == "docx-done", обязательно кроме --no-share)

#### 8a. Прочитать DRIVE.md

`~/.claude/seo-knowledge/DRIVE.md` → извлечь `analyses_folder_id`.

Если файла или поля нет — стоп:
> «Не найден `analyses_folder_id` в DRIVE.md. Создай папку `/SEO/Analyses/` в Drive с правами `anyone-with-link → reader`, добавь её ID в DRIVE.md. Затем продолжи через `/seo-analysis --resume`.»

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

Жду фидбек:
  - "одобряю" / "OK" / "approved" → скил перейдёт в approved и подскажет /handoff
  - "есть правки: <описание>" → скил классифицирует и применит
```

**Не выходить из сессии. Ждать пользовательский ввод. После любого фидбека — шаг 9 или 10.**

### 9. Обработка фидбека (state == "client-review")

#### 9a. Если пользователь одобрил

Триггеры одобрения (case-insensitive): «одобряю», «ок», «approved», «всё хорошо», «принято», «accept».

- `bash .claude/hooks/update-meta.sh <analysis_dir> approved`
- Переход к шагу 11 (финал).

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

#### 9d. Применение правки по типу

**`edit`:** скил делает `Edit` в `A2.md` напрямую. Без перезапуска. Без апдейтов JSON.

**`brief`/`competitors`/`serp`/`leaders`:** пересобрать соответствующий JSON, потом downstream:

- `brief` — делегировать `brief-structurer` с дополнительной инструкцией «правка: <описание>; явно учти X». Затем перезапустить `competitor-finder`, `serp-verdict`, `leader-scanner`, `analysis-writer` последовательно. Может занять 10-20 минут.
- `competitors` — `competitor-finder` с пометкой, затем `serp-verdict`, `leader-scanner`, `analysis-writer`.
- `serp` — `serp-verdict`, затем `analysis-writer`.
- `leaders` — `leader-scanner`, затем `analysis-writer`.

**`writer`:** только перезапустить `analysis-writer` с инструкцией «при сборке учти: <правка>».

#### 9e. Re-build .docx и re-upload

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
- НЕ делай `git push` и не публикуй артефакты — это решение пользователя.
- НЕ запускай `/write-article`, `/strategy`, `/new-topics` из этой же сессии — отдельные worktree-задачи.
