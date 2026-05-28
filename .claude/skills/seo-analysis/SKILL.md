---
name: seo-analysis
description: Полный цикл предпроектного анализа конкурентов для SEO. Бриф клиента → структурирование → поиск конкурентов → SERP-вердикт → скан смыслов топ-3 → A2.md (5 разделов) + A3.md (стоп-лист) + опц. .docx. Аргументы: [путь к файлу с брифом ИЛИ ничего] [--resume].
---

# seo-analysis

Скил-оркестратор предпроектного анализа конкурентов. Запускается **в worktree-сессии**. Проходит state machine от парсинга брифа до финальных A2.md/A3.md и опционально .docx для клиента.

## Аргументы

```
/seo-analysis [--resume]
```

- Без аргументов — скил запросит бриф у пользователя в чате (можно вставить текст или указать путь к файлу).
- `--resume` — продолжить с того места, где остановились (по `meta.json` существующей `analyses/NNN-slug/`).

## State machine

```
init → brief-done → competitors-done → serp-done → leaders-done → report-done → [docx-done] → completed
```

`docx-done` — опциональное состояние. Если после `report-done` пользователь не запрашивает .docx, скил сразу переходит в `completed`.

`meta.json` — единственный источник истины о текущем состоянии. Обновляется через `bash .claude/hooks/update-meta.sh <analysis_dir> <state>`.

## Артефакты

```
analyses/NNN-<domain-slug>/
├── meta.json              # state machine
├── brief_raw.txt          # исходный бриф (как пришёл от пользователя)
├── brief.json             # 16 параметров + keyso_base + region_id + путь А/Б/В/Г
├── candidates.json        # 15+ доменов-кандидатов до фильтрации (intermediate)
├── competitors.json       # 6-10 финальных + топ-3 лидера + причины исключений
├── serp.json              # SERP-анализ + вердикт + промежуточный стоп-лист + смежные
├── leader_scan.json       # блоки/посылы/фишки по топ-3 + сводка с сопоставлением
├── A2.md                  # ФИНАЛ — markdown-отчёт (5 разделов)
├── A3.md                  # ФИНАЛ — стоп-лист (по строке = домен)
└── A2_<slug>.docx         # опц. финал для клиента (шаг 7)
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
- Если Y — перейти к ветке от следующего шага после `state`.
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

Маркер: `.claude/tmp/expected-brief-structurer-<run_id>.txt = <analysis_dir>/brief.json`

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

Маркер: `.claude/tmp/expected-competitor-finder-<run_id>.txt = <analysis_dir>/competitors.json`

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

Маркер: `.claude/tmp/expected-serp-verdict-<run_id>.txt = <analysis_dir>/serp.json`

Делегировать `serp-verdict`:
```
analysis_dir: <analysis_dir>
project_root: <project root>
Прочитай brief.json, competitors.json, candidates.json, MCP_MAP.md. Проанализируй SERP по 3-5 коммерческим запросам, сформулируй вердикт совместимости, собери промежуточный стоп-лист и смежные направления. Сохрани serp.json.
```

После завершения:
- `bash .claude/hooks/update-meta.sh <analysis_dir> serp-done`
- Сводка от агента — в чат, включая вердикт.
- **Если вердикт `КОРРЕКТИРУЕМ ТИП САЙТА` или `МЕНЯЕМ СТРАТЕГИЮ`** — пауза:
  > «Вердикт `<тип>` означает значительные изменения в сайте/стратегии. Рекомендуется обсудить с клиентом до продолжения работ. Продолжаем скан смыслов сейчас или приостановим? [Y — продолжить / N — приостановить]»
  - Если N — оставить state `serp-done`, выйти. Пользователь может потом запустить `--resume`.
- Иначе — сразу переход к шагу 5.

### 5. Скан смыслов (если state == "serp-done")

Маркер: `.claude/tmp/expected-leader-scanner-<run_id>.txt = <analysis_dir>/leader_scan.json`

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

Маркер: `.claude/tmp/expected-analysis-writer-<run_id>.txt = <analysis_dir>/A2.md`

(Скил проверяет A2 через маркер. A3 проверяется отдельно — после возврата агента: если A3.md не создан или пуст, повторно делегировать с явным указанием.)

Делегировать `analysis-writer`:
```
analysis_dir: <analysis_dir>
project_root: <project root>
Прочитай brief.json, competitors.json, serp.json, leader_scan.json, candidates.json. Собери A2.md (5 разделов в фиксированной структуре) и A3.md (дедуплицированный, отсортированный стоп-лист доменов).
```

После завершения:
- `bash .claude/hooks/update-meta.sh <analysis_dir> report-done`
- Вывести пользователю краткую сводку + пути к A2.md и A3.md.
- Спросить:
  > «Отчёт готов. Сгенерировать .docx для клиента? [Y/n]»
  - Y → шаг 7
  - n → пропустить шаг 7, перейти к финалу с state `report-done`

### 7. Опц. сборка .docx (если state == "report-done" и пользователь сказал Y)

```
.claude\scripts\_node.cmd .claude\scripts\build-analysis-docx.mjs <analysis_dir>
```

Скрипт читает `A2.md` + `brief.json` + `serp.json`, генерирует `<analysis_dir>/A2_<slug>.docx`.

После:
- `bash .claude/hooks/update-meta.sh <analysis_dir> docx-done`
- Переход к финалу.

### 8. Финал (state == "report-done" без .docx ИЛИ "docx-done")

`bash .claude/hooks/update-meta.sh <analysis_dir> completed`

Финальный коммит в worktree-ветку:
```
git add -A
git commit -m "Analysis <NNN> for <domain или niche-region>: completed"
```

Вывести:

```
═══ ПРЕДПРОЕКТНЫЙ АНАЛИЗ ГОТОВ ═══

Клиент: <domain или niche / region>

📄 A2 (предпроектный анализ, 5 разделов):
   <analysis_dir>/A2.md

📄 A3 (стоп-лист доменов):
   <analysis_dir>/A3.md

<если есть .docx:>
📄 A2 для клиента (.docx):
   <analysis_dir>/A2_<slug>.docx

Данные анализа:
   <analysis_dir>/brief.json
   <analysis_dir>/competitors.json
   <analysis_dir>/serp.json
   <analysis_dir>/leader_scan.json

Артефакты A2.md и A3.md готовы к передаче в следующие услуги:
  - У3 (структура страниц)
  - У5 (ТЗ на тексты)

⚠️ НЕ ЗАБУДЬ /handoff перед закрытием сессии — иначе файлы останутся
   в worktree и не попадут в основную папку проекта.
═════════════════════════════════
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
