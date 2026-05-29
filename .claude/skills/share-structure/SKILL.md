---
name: share-structure
description: Повторная или отложенная загрузка A6_<slug>.xlsx из structures/NNN/ на Google Drive (с автоконверсией в Google Sheet). По умолчанию `/seo-structure` сам делает это в шаге 7 - этот скил нужен если шаг был пропущен (Drive недоступен) или после ручных правок локального .xlsx. Аргументы - <NNN> [--redo].
---

# share-structure

Утилита-помощник для скила `/seo-structure`. **Основной поток `/seo-structure` загружает результат в Drive сам** (шаг 7). Этот скил пригодится в трёх сценариях:

1. **Drive был недоступен** при первом прогоне `/seo-structure` - структура осталась в `state: xlsx-built` без `share.json`. Запускаешь `/share-structure <NNN>` после восстановления MCP.
2. **Поправил локальный .xlsx** вручную - нужно перезалить новую версию: `/share-structure <NNN> --redo`.
3. **Legacy-структуры** (собраны до версии этого скила) - догрузить ссылки задним числом: `/share-structure <NNN>`.

## Аргументы

```
/share-structure <NNN> [--redo]
```

- `NNN` - номер структуры (например `001`). Обязательный позиционный.
- `--redo` - пересоздать ссылку: удалить старый файл в Drive (по `drive_file_id` из существующего `share.json`), загрузить заново. Использовать после правок локального .xlsx.

## Предусловия

- MCP `gdrive-piotr` подключён, OAuth пройден.
- В `<structure_dir>` существует готовый артефакт: `A6_<slug>.xlsx`.
- `~/.claude/seo-knowledge/DRIVE.md` содержит `structures_folder_id`.

## Алгоритм

### 0. Parse args

```
NNN = <обязательно>
redo = true если --redo
```

### 1. Найти папку структуры и проверить готовность

`structure_dir = structures/<NNN>-*/` - найти существующую по NNN. Если не найдено - стоп.

Прочитать:
- `<structure_dir>/meta.json` - убедиться, что `state >= xlsx-built`. Если нет - стоп с подсказкой `/seo-structure --resume`.
- `<structure_dir>/inputs.json` - получить `slug`, `domain`.

Локальный путь: `xlsx_path = <structure_dir>/A6_<slug>.xlsx`. Если нет - стоп.

### 2. Развилка по share.json

**Случай A:** `share.json` не существует, `--redo` НЕ передан. Грузим как новый. -> шаг 3.

**Случай B:** `share.json` существует, `--redo` НЕ передан. Вывести ссылку, остановиться: «Структура уже расшарена (<shared_at>). Передай `--redo` для перезаливки.»

**Случай C:** `--redo` передан. Прочитать `share.json`, получить `drive_file_id`. Удалить через `mcp__gdrive-piotr__deleteItem`. Если упало - предупредить, продолжать. -> шаг 3.

### 3. Прочитать DRIVE.md

`~/.claude/seo-knowledge/DRIVE.md` -> `structures_folder_id`. Если ключа нет ИЛИ значение начинается с `TODO_` - стоп с инструкцией:
> В DRIVE.md ключ `structures_folder_id` ещё не настроен. Создай в Google Drive папку «Структуры» с правами `anyone with link -> reader`, скопируй её ID и подставь в DRIVE.md. Затем запусти `/share-structure <NNN>` ещё раз.

### 4. Загрузить

```
mcp__gdrive-piotr__uploadFile(
  localPath: <абсолютный xlsx_path>,
  name: A6_<slug>,
  parentFolderId: <structures_folder_id>,
  convertToGoogleFormat: true
)
```

Если упало с конверсией (Google Sheets API не активна) - fallback `convertToGoogleFormat: false`:
> ⚠️ Залит как .xlsx (Google Sheets API не активна). Активируй в Google Cloud Console, потом `/share-structure <NNN> --redo`.

### 5. Записать share.json

```json
{
  "drive_file_id": "<id>",
  "drive_link": "<link>",
  "mime_type": "application/vnd.google-apps.spreadsheet",
  "shared_at": "<ISO>",
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

### 6. Обновить meta.json

Аналогично `/share-analysis`:

- `state == "xlsx-built"` -> `shared`
- `state == "shared"` -> не трогать
- `state == "awaiting-client"` / `client-imported` / `completed` -> не трогать state, обновить только `drive_file_id` и `drive_link` через Edit

### 7. Вывод

```
═══ СТРУКТУРА РАСШАРЕНА ═══

Клиент: <domain или slug>

📊 A6 (Google Sheet для заполнения клиентом):
   <drive_link>

Клиент заполняет колонку «Целевая?» и возвращает файл.
Когда вернётся - /seo-structure <NNN> --import <путь>

Локальный оригинал:
   <xlsx_path>
═══════════════════════════
```

## Запреты

- НЕ грузить файлы вне папки `structures_folder_id` из DRIVE.md.
- НЕ оставлять `convertToGoogleFormat: false` без fallback-сообщения «активируй Sheets API».
- НЕ вызывать `addPermission` - известный баг пакета на `type: anyone`, разрешения наследуются от папки.
- Длинное тире (—) и среднее (–) не использовать. Только дефис (-).
