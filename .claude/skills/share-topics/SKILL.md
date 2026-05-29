---
name: share-topics
description: Повторная или отложенная загрузка Topics_<slug>.xlsx из topics/NNN/ на Google Drive (с автоконверсией в Google Sheet). По умолчанию /new-topics сам делает это в шаге 7 - этот скил нужен если шаг был пропущен (Drive недоступен) или после ручных правок локального xlsx. Аргументы - <NNN> [--redo].
---

# share-topics

Утилита-помощник для скила `/new-topics`. **Основной поток `/new-topics` загружает результат в Drive сам** (шаг 7). Этот скил пригодится в трёх сценариях:

1. **Drive был недоступен** при первом прогоне `/new-topics` - батч остался в `state: xlsx-done` без `share.json`. Запускаешь `/share-topics <NNN>` после восстановления MCP.
2. **Поправил локальный xlsx** вручную (или применил правки через `/new-topics --resume` после `from-excel-topics.mjs`) - нужно перезалить новую версию: `/share-topics <NNN> --redo`.
3. **Legacy-батчи** (собраны до версии этого скила) - догрузить ссылку задним числом: `/share-topics <NNN>`.

## Аргументы

```
/share-topics <NNN> [--redo]
```

- `NNN` - номер батча (например `001`). Обязательный позиционный.
- `--redo` - пересоздать ссылку: удалить старый файл в Drive (по `drive_file_id` из существующего `share.json`), загрузить заново. Использовать после правок локального xlsx.

## Предусловия

- MCP `gdrive-piotr` подключён, OAuth пройден. Если тулы `mcp__gdrive-piotr__*` недоступны - см. README -> Troubleshooting.
- В `<topics_dir>` существует **готовый** артефакт: `Topics_<slug>.xlsx`.
- `~/.claude/seo-knowledge/DRIVE.md` содержит `topics_folder_id`.

## Алгоритм

### 0. Parse args

```
NNN = <обязательно>
redo = true если --redo
```

Проверка worktree: рекомендуется (расшаривание не пишет в общие файлы), но не блокировать выполнение в main.

### 1. Найти папку батча и проверить готовность

`topics_dir = topics/<NNN>-*/` - найти существующую по NNN. Если не найдено - стоп: «Батч с номером <NNN> не найден.»

Прочитать:
- `<topics_dir>/meta.json` - убедиться, что `state >= xlsx-done`. Если нет - стоп с подсказкой запустить `/new-topics --resume`.
- `slug` берётся из `meta.json` (поле `slug`).

Локальный путь: `xlsx_path = <topics_dir>/Topics_<slug>.xlsx`. Если файла нет - стоп.

### 2. Развилка по share.json

**Случай A:** `share.json` не существует, `--redo` НЕ передан. Грузим как новый. -> шаг 3.

**Случай B:** `share.json` существует, `--redo` НЕ передан. Вывести ссылку, остановиться: «Батч уже расшарен (<shared_at>). Передай `--redo` для перезаливки.»

**Случай C:** `--redo` передан. Прочитать `share.json`, получить `drive_file_id`. Удалить через `mcp__gdrive-piotr__deleteItem`. Если упало (файл уже удалён руками) - предупредить, продолжать. -> шаг 3.

### 3. Прочитать DRIVE.md

`~/.claude/seo-knowledge/DRIVE.md` -> `topics_folder_id`. Если файла или ключа нет - стоп: «Не найдена конфигурация Drive в `~/.claude/seo-knowledge/DRIVE.md`. Добавь topics_folder_id по образцу из ADR-008.»

### 4. Загрузить с конверсией

```
mcp__gdrive-piotr__uploadFile(
  localPath: <абсолютный xlsx_path>,
  name: Topics_<slug>,
  parentFolderId: <topics_folder_id>,
  convertToGoogleFormat: true
)
```

Сохранить `id`, `link` из ответа.

Если упало с ошибкой «Sheets API не активирован» - fallback `convertToGoogleFormat: false`, в финальной сводке предупредить.

### 5. Записать share.json и обновить meta

`<topics_dir>/share.json`:
```json
{
  "drive_file_id": "<id>",
  "drive_link": "<link>",
  "mime_type": "application/vnd.google-apps.spreadsheet",
  "shared_at": "<ISO UTC>",
  "revisions": []
}
```

Если `--redo` - добавить запись в `revisions[]`:
```json
{
  "type": "manual_redo",
  "applied_at": "<ISO>",
  "new_drive_file_id": "<new_id>",
  "new_drive_link": "<new_link>"
}
```

**Обновление meta** (по аналогии с `/share-strategy`, идемпотентность):

- `state == "xlsx-done"` (Drive не был залит при первом прогоне): `bash .claude/hooks/update-meta.sh <topics_dir> shared`
- `state == "shared"` (типичный `--redo`): **НЕ вызывать update-meta** - state не регрессирует. Вручную через Edit обновить `updated` timestamp.
- `state == "completed"` (после /handoff): **НЕ вызывать update-meta** - аналогично.

### 6. Вывод

```
═══ БАТЧ ТЕМ РАСШАРЕН ═══

Папка: topics/NNN-<slug>/

📊 Темы (Google Sheet):
   <drive_link>

Локальный оригинал:
   topics/NNN-<slug>/Topics_<slug>.xlsx

Дальше:
  - После согласования с клиентом: /handoff -> в main: /handoff-process
  - Ещё правки: правь batch.json или подложи xlsx, /share-topics <NNN> --redo
═══════════════════════════
```

Если в worktree-сессии - напомнить про `/handoff` для финализации.

## Запреты

- НЕ грузить файлы в Drive вне `topics_folder_id` из DRIVE.md.
- НЕ оставлять `convertToGoogleFormat: false` без предупреждения - команда не сможет редактировать в браузере.
- НЕ вызывать `addPermission` - известный баг пакета на `type: anyone`, права наследуются от папки.
- НЕ менять файлы в Drive после загрузки через MCP. Если нужны правки - правь локальный xlsx (через `/new-topics --resume`) или `topics-batch.json`, затем `/share-topics <NNN> --redo`.
- Длинное тире (—) и среднее (–) не использовать. Только дефис (-).

## Параллельная работа

Несколько `/share-topics` для разных батчей - без проблем, каждый в своей папке `topics/NNN-<slug>/`, общих файлов не правят.
