---
name: new-topics
description: Собирает 15-25 тем для блога в worktree. Полный цикл - топик-генератор -> xlsx -> автозагрузка в Google Sheet. Результат в topics/NNN-slug/. Аргументы - [--resume].
---

# new-topics

Полный цикл сбора батча тем для блога клиента: собирает 15-25 тем через `topic-generator`, строит `Topics_<slug>.xlsx`, загружает в Google Drive как Google Sheet и выдаёт ссылку для согласования с клиентом. Работает в worktree-сессии.

После согласования с клиентом темы попадают в общий `topics.xlsx` через `/handoff` -> `/handoff-process`.

## Аргументы

```
/new-topics [--resume] [--queries "запрос1, запрос2"]
```

- `--resume` - продолжить незавершённый батч (находит самый свежий по `meta.json`), либо подхватить ручные правки в `Topics_<slug>.xlsx` (читает обратно в `topics-batch.json`).
- `--queries "..."` - затравочные запросы для топик-генератора (опционально, передаются в промт).

## State-machine

```
collecting -> confirmed -> xlsx-done -> shared -> completed
```

- `collecting` - идёт сбор (топик-генератор работает или ждёт правок)
- `confirmed` - пользователь подтвердил батч (можно собирать xlsx)
- `xlsx-done` - `Topics_<slug>.xlsx` собран в task-папке
- `shared` - залит в Drive, `share.json` записан
- `completed` - выставляется после `/handoff` (опционально, для трекинга)

## Алгоритм

### 0. Проверки

**Worktree:**
```
GIT_DIR=$(git rev-parse --git-dir)
COMMON_DIR=$(git rev-parse --git-common-dir)
```
Если в main - отказать: «/new-topics работает только в worktree. Открой сессию с галочкой worktree.»

**ЗАКАЗЧИК.md:**
Если нет в корне - отказать: «ЗАКАЗЧИК.md не найден. Сначала /setup-project в worktree + /handoff-process в main.»

### 1. Parse args + найти/создать task-папку

**Без `--resume`:**
- `NNN = max(существующие topics/NNN-*/) + 1`, форматировать как 3-значное (`001`, `002`, ...).
- `slug` - из домена клиента (берём `domain` из ЗАКАЗЧИК.md без TLD: `example.com` -> `example`, `ремонт.рф` -> `remont`). Если домена нет - `slug = "batch"`.
- Создать `topics/NNN-<slug>/`.
- Записать `meta.json`:
  ```json
  {
    "state": "collecting",
    "slug": "<slug>",
    "nnn": "NNN",
    "domain": "<из ЗАКАЗЧИК.md>",
    "region": "<из ЗАКАЗЧИК.md>",
    "niche": "<из ЗАКАЗЧИК.md>",
    "started": "<ISO UTC>",
    "updated": "<ISO UTC>",
    "completed_steps": ["collecting"]
  }
  ```
- Записать `.claude/tmp/current-task.txt = topics/NNN-<slug>` (pre-commit hook разрешит коммиты в эту папку).

**С `--resume`:**
- Найти самую свежую папку `topics/<max NNN>-*/`. Прочитать `meta.json`.
- Развилка по `state`:
  - `collecting` - возобновляем с шага 4 (топик-генератор) или 5 (правки), смотря есть ли `topics-batch.json` в папке.
  - `confirmed` - сразу к шагу 6 (сборка xlsx).
  - `xlsx-done` - сразу к шагу 7 (заливка в Drive). Если `Topics_<slug>.xlsx` свежее `topics-batch.json` (по mtime) - сначала шаг 5.5 (обратное чтение xlsx).
  - `shared` - проверить флаг свежести: если `Topics_<slug>.xlsx` свежее `share.json` - значит правили локально, перезаливаем (шаг 5.5 -> 6 -> 7). Иначе - сообщить «батч уже расшарен, передай `--redo` через /share-topics».
  - `completed` - сообщить «батч уже завершён».

### 2. Прочитать ЗАКАЗЧИК.md

Извлечь: нишу, регион, домен, перелинковку, существующий блог. Записать значения в `meta.json` (если не были записаны).

### 3. Собрать `existing_main_queries` для дедупа

Цель - не предлагать темы, которые уже есть в общем темнике или в работе.

**Источник 1 - корневой `topics.xlsx`:**
```
.claude\scripts\_node.cmd .claude\scripts\read-topics-xlsx.mjs .
```
Парсит stdout как JSON. Если `exists: true` - забрать все `main_query` (без пустых).

**Источник 2 - `articles/_index.json`:**
Если есть - прочитать через Read, извлечь `main_query` (если есть в индексе) или `topic` (fallback).

Объединить, нормализовать (lowercase, схлопнуть пробелы), убрать дубли. Если получилось >0 - добавить в промт топик-генератора как `existing_main_queries`.

### 4. Делегировать `topic-generator`

Маркер:
```
.claude/tmp/expected-topic-generator-<run_id>.txt:
  <abs path>/topics/NNN-<slug>/topics-batch.json
```

Промт:
```
project_root: <abs>
output_path: topics/NNN-<slug>/topics-batch.json
ниша: <из ЗАКАЗЧИК.md>
регион: <из ЗАКАЗЧИК.md>
домен: <из ЗАКАЗЧИК.md>
затравочные запросы: <если --queries передан>
existing_main_queries: [<нормализованный список из шага 3>]

Собери 15-25 тем по Этапам A + B. Запиши результат в output_path. В чат выведи полную таблицу всех тем (формат из инструкции агента).
```

После выполнения - topic-generator уже вывел в чат полную таблицу.

### 5. Пауза на подтверждение + цикл правок

Спросить пользователя:
> «Подтверди батч (`ок`) или предложи правки. Примеры: `убери темы 7, 12, 18`, `добавь тему про X`, `перепиши тему 5 под жанр Личный опыт`.»

**При `ок`:**
- `bash .claude/hooks/update-meta.sh topics/NNN-<slug>/ confirmed`
- Переход к шагу 6.

**При правках - применить через Edit `topics-batch.json` по паттерну:**

| Тип правки | Действие |
|---|---|
| «убери темы N1, N2, ...» | Прочитать batch.json, удалить объекты с указанными `n` (или порядковыми номерами таблицы), Edit с новым массивом `topics`. Не перенумеровывать `n` руками - скрипт `topics-to-excel.mjs` при сборке xlsx сортирует и нумерует заново. |
| «добавь тему про X» (1-2 темы) | Добавить объект в массив `topics` с полями `topic`, `main_query`, `ws_freq` (грубая оценка либо проверь Wordstat одним вызовом), `intent`, `genres`, `priority`, `seasonality`, `linking_url`, `note: "Добавлено по запросу пользователя"`. |
| «перепиши тему N под жанр X» / «измени приоритет на ...» | Edit конкретного поля в объекте `topics[i]`. |
| Массовые правки (5+ точечных, «пересобери раздел про Y», «убери всё что про A») | Повторное делегирование `topic-generator` с текущим `topics-batch.json` + инструкцией «эти не предлагай, добавь по таким направлениям». Маркер новый. |

После применения правок:
- Снова вывести таблицу в чат (формат тот же, что у topic-generator):
  ```
  | №  | Приоритет | WS  | Тема | Жанр-основной |
  ```
- Снова спросить «Подтверди или дай ещё правки».
- Цикл до `ок`.

### 5.5 (только при `--resume` после правок в xlsx)

Если на шаге 1 (resume) определили, что `Topics_<slug>.xlsx` свежее `topics-batch.json`:

```
.claude\scripts\_node.cmd .claude\scripts\from-excel-topics.mjs topics/NNN-<slug>
```

Скрипт перезапишет `topics-batch.json` из xlsx. Показать пользователю «Подхватил правки из xlsx: N тем (было M). Подтверди или дай ещё правки».

Дальше как обычно - шаг 5 или 6.

### 6. Сборка xlsx

```
.claude\scripts\_node.cmd .claude\scripts\topics-to-excel.mjs topics/NNN-<slug>
```

Скрипт пишет `topics/NNN-<slug>/Topics_<slug>.xlsx`.

После успеха:
```
bash .claude/hooks/update-meta.sh topics/NNN-<slug>/ xlsx-done
```

### 7. Заливка в Drive

**Прочитать DRIVE.md:**
`~/.claude/seo-knowledge/DRIVE.md` -> `topics_folder_id`. Если файла или ключа нет - стоп с подсказкой ADR-008.

**Если MCP `gdrive-piotr` недоступен** (тулы `mcp__gdrive-piotr__*` не появились):
```
bash .claude/hooks/update-meta.sh topics/NNN-<slug>/ shared skip_reason="Drive MCP недоступен"
```
Перейти к шагу 8, в финальной сводке указать «Drive не использован - запусти `/share-topics <NNN>` после восстановления MCP».

**Иначе - загрузить:**
```
mcp__gdrive-piotr__uploadFile(
  localPath: <abs>/topics/NNN-<slug>/Topics_<slug>.xlsx,
  name: Topics_<slug>,
  parentFolderId: <topics_folder_id>,
  mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  convertToGoogleFormat: true
)
```

Сохранить `id`, `link` (или `webViewLink`).

Если упало с ошибкой «не активирован Sheets API» - fallback `convertToGoogleFormat: false`, в сводке предупредить.

**Записать `share.json`:**
```json
{
  "drive_file_id": "<id>",
  "drive_link": "<link>",
  "mime_type": "application/vnd.google-apps.spreadsheet",
  "shared_at": "<ISO UTC>",
  "revisions": []
}
```

**Обновить meta:**
```
bash .claude/hooks/update-meta.sh topics/NNN-<slug>/ shared
```

### 8. Финал

```
═══ БАТЧ ТЕМ ГОТОВ ═══
Папка: topics/NNN-<slug>/
Тем: N (K дублей с темником клиента / уже в работе - отсеяно)
Конкурентов изучено: M

📊 Google Sheet (для согласования с клиентом):
   <drive_link>

Локально:
   topics/NNN-<slug>/Topics_<slug>.xlsx
   topics/NNN-<slug>/topics-batch.json

Дальше:
  - Если клиент дал правки текстом:
      /new-topics --resume  (применишь правки руками через Edit batch.json, пересоберём)
  - Если клиент правил в Sheets и ты скачал xlsx обратно:
      положи в topics/NNN-<slug>/Topics_<slug>.xlsx и /new-topics --resume
  - Перезалить в Drive после правок:
      /share-topics NNN --redo
  - Согласовано:
      /handoff  -> в main: /handoff-process (добавит темы в общий topics.xlsx)
═════════════════════
```

## Запреты

- Не правь корневой `topics.xlsx` напрямую - pre-commit hook откажет (общий файл). Это работа `/handoff-process` в main.
- Не используй `.claude/handoff-requests/topics-batch.json` как output - старый путь, теперь батч живёт в `topics/NNN-<slug>/`.
- Не запускай `to-excel.mjs` (старый скрипт для корневого xlsx). Используй `topics-to-excel.mjs` для task-папки.
- Не вызывай `mcp__gdrive-piotr__addPermission` - права наследуются от папки (ADR-008).
- Не используй длинное тире (—) и среднее (–). Только дефис (-).
- Все промежуточные результаты - в файлы task-папки, не в чат (кроме финальной таблицы и сводки).
