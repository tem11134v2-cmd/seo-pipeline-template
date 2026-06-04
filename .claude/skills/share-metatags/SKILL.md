---
name: share-metatags
description: Повторная или отложенная загрузка A7_<slug>.xlsx из metatags/NNN/ на Google Drive (с автоконверсией в Google Sheet). По умолчанию `/seo-metategi` делает это сам в шаге 8 - этот скил нужен если шаг был пропущен (Drive недоступен / нет metatags_folder_id) или после ручных правок локального .xlsx. Аргументы - <NNN> [--redo].
---

# share-metatags

Утилита-помощник для скила `/seo-metategi`. **Основной поток грузит A7 в Drive сам** (шаг 8). Этот скил - для трёх случаев:

1. **Drive был недоступен / не настроен** при первом прогоне (нет `metatags_folder_id` в DRIVE.md) - метатеги остались в `state: xlsx-built` без `share.json`. Запускаешь `/share-metatags <NNN>` после настройки.
2. **Поправил локальный .xlsx** вручную - перезалить: `/share-metatags <NNN> --redo`.
3. **Legacy** - догрузить ссылку задним числом.

## Аргументы

```
/share-metatags <NNN> [--redo]
```
- `NNN` - номер (обязательный позиционный).
- `--redo` - удалить старый файл в Drive (по `drive_file_id` из `share.json`) и залить заново.

## Предусловия

- MCP `gdrive-piotr` подключён, OAuth пройден.
- В `<metatags_dir>` есть `A7_<slug>.xlsx`.
- `~/.claude/seo-knowledge/DRIVE.md` содержит `metatags_folder_id`.

## Алгоритм

### 0. Parse args
```
NNN = <обязательно>
redo = true если --redo
```

### 1. Найти папку и проверить готовность

`metatags_dir = metatags/<NNN>-*/` (glob). Если не найдено - стоп.

Прочитать:
- `meta.json` - `state >= xlsx-built`. Если нет - стоп с подсказкой `/seo-metategi --resume <NNN>`.
- `inputs.json` - `slug`, `domain`.

`xlsx_path = <metatags_dir>/A7_<slug>.xlsx`. Если нет - стоп.

### 2. Развилка по share.json

- **Нет `share.json`, нет `--redo`** -> грузим как новый (шаг 3).
- **Есть `share.json`, нет `--redo`** -> вывести ссылку, стоп: «Уже расшарено (<shared_at>). Передай `--redo` для перезаливки.»
- **`--redo`** -> прочитать `share.json`, `drive_file_id`, удалить `mcp__gdrive-piotr__deleteItem`. Упало - предупредить, продолжить. -> шаг 3.

### 3. Прочитать DRIVE.md

`~/.claude/seo-knowledge/DRIVE.md` -> `metatags_folder_id`. Если ключа нет ИЛИ значение начинается с `TODO_` - стоп:
> В DRIVE.md нет `metatags_folder_id`. Создай в Google Drive папку «Метатеги» с правами `anyone with link -> reader`, впиши её ID в DRIVE.md, затем запусти `/share-metatags <NNN>` снова.

### 4. Загрузить

```
mcp__gdrive-piotr__uploadFile(
  localPath: <абс xlsx_path>,
  name: A7_<slug>,
  parentFolderId: <metatags_folder_id>,
  mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  convertToGoogleFormat: true
)
```
Упало с конверсией -> fallback `convertToGoogleFormat: false`:
> ⚠️ Залит как .xlsx (Google Sheets API не активна). Активируй в Google Cloud Console, потом `/share-metatags <NNN> --redo`.

### 5. Записать share.json

```json
{ "drive_file_id": "<id>", "drive_link": "<link>", "mime_type": "application/vnd.google-apps.spreadsheet", "shared_at": "<ISO>", "revisions": [] }
```
Если `--redo` - добавить в `revisions[]`: `{ "type": "manual_redo", "applied_at": "<ISO>", "new_drive_file_id": "<id>", "new_drive_link": "<link>" }`.

### 6. Обновить meta.json

- `state == "xlsx-built"` -> `shared`
- `state == "shared"` -> не трогать
- `state == "completed"` -> не трогать state, обновить `drive_file_id`/`drive_link` через Edit

### 7. Вывод

```
═══ МЕТАТЕГИ РАСШАРЕНЫ ═══

Клиент: <domain или slug>

📊 A7 (Google Sheet):
   <drive_link>

Локальный оригинал:
   <xlsx_path>
═══════════════════════════
```

## Запреты

- НЕ грузить файлы вне `metatags_folder_id` из DRIVE.md.
- НЕ оставлять `convertToGoogleFormat: false` без fallback-сообщения «активируй Sheets API».
- НЕ вызывать `addPermission` - известный баг пакета на `type: anyone`, разрешения наследуются от папки.
- Длинное тире (—) и среднее (–) не использовать. Только дефис (-).
```
