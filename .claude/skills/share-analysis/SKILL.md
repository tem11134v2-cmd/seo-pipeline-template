---
name: share-analysis
description: Повторная или отложенная загрузка A2_<slug>.docx из analyses/NNN/ на Google Drive (с автоконверсией в Google Doc). По умолчанию `/seo-analysis` сам делает это в шаге 8 — этот скил нужен если шаг был пропущен (Drive недоступен) или после ручных правок локального .docx. Аргументы: <NNN> [--redo].
---

# share-analysis

Утилита-помощник для скила `/seo-analysis`. **Основной поток `/seo-analysis` загружает результат в Drive сам** (шаг 8). Этот скил пригодится в трёх сценариях:

1. **Drive был недоступен** при первом прогоне `/seo-analysis` — анализ остался в `state: docx-done` без `share.json`. Запускаешь `/share-analysis <NNN>` после восстановления MCP.
2. **Поправил локальный .docx** вручную — нужно перезалить новую версию: `/share-analysis <NNN> --redo`.
3. **Legacy-анализы** (собраны до версии этого скила) — догрузить ссылки задним числом: `/share-analysis <NNN>`.

## Аргументы

```
/share-analysis <NNN> [--redo]
```

- `NNN` - номер анализа (например `001`). Обязательный позиционный.
- `--redo` - пересоздать ссылку: удалить старый файл в Drive (по `drive_file_id` из существующего `share.json`), загрузить заново. Использовать после правок локального .docx.

## Предусловия

- MCP `gdrive-piotr` подключён, OAuth пройден.
- В `<analysis_dir>` существует **готовый** артефакт: `A2_<slug>.docx`.
- `~/.claude/seo-knowledge/DRIVE.md` содержит `analyses_folder_id`.

## Алгоритм

### 0. Parse args

```
NNN = <обязательно>
redo = true если --redo
```

### 1. Найти папку анализа и проверить готовность

`analysis_dir = analyses/<NNN>-*/` - найти существующую по NNN. Если не найдено - стоп.

Прочитать:
- `<analysis_dir>/meta.json` - убедиться, что `state >= docx-done`. Если нет - стоп с подсказкой `/seo-analysis --resume`.
- `<analysis_dir>/brief.json` - получить `slug`, `domain`.

Локальный путь: `docx_path = <analysis_dir>/A2_<slug>.docx`. Если нет - стоп.

### 2. Развилка по share.json

**Случай A:** `share.json` не существует, `--redo` НЕ передан. Грузим как новый. → шаг 3.

**Случай B:** `share.json` существует, `--redo` НЕ передан. Вывести ссылку, остановиться: «Анализ уже расшарен (<shared_at>). Передай `--redo` для перезаливки.»

**Случай C:** `--redo` передан. Прочитать `share.json`, получить `drive_file_id`. Удалить через `mcp__gdrive-piotr__deleteItem`. Если упало — предупредить, продолжать. → шаг 3.

### 3. Прочитать DRIVE.md

`~/.claude/seo-knowledge/DRIVE.md` → `analyses_folder_id`. Если нет — стоп.

### 4. Загрузить

```
mcp__gdrive-piotr__uploadFile(
  localPath: <абсолютный docx_path>,
  name: A2_<slug>,
  parentFolderId: <analyses_folder_id>,
  convertToGoogleFormat: true
)
```

Если упало — fallback `convertToGoogleFormat: false`.

### 5. Записать share.json

```json
{
  "drive_file_id": "<id>",
  "drive_link": "<link>",
  "mime_type": "application/vnd.google-apps.document",
  "shared_at": "<ISO>",
  "revisions": []
}
```

Если `--redo` — добавить запись в `revisions[]`:
```json
{
  "type": "manual_redo",
  "applied_at": "<ISO>",
  "new_drive_file_id": "<new_id>",
  "new_drive_link": "<new_link>"
}
```

### 6. Обновить meta.json

Аналогично `/share-strategy` — учесть идемпотентность для state `completed` (не вызывать update-meta если state==completed, иначе регрессирует). В остальных случаях:

- `state == "docx-done"` → `shared`
- `state == "shared"` → не трогать
- `state == "client-review"` / `revising` / `approved` / `completed` → не трогать state, обновить только `drive_file_id` и `drive_link` через Edit

### 7. Вывод

```
═══ АНАЛИЗ РАСШАРЕН ═══

Клиент: <domain или slug>

📄 A2 (Google Doc для клиента):
   <view_link>

Локальный оригинал:
   <docx_path>
═══════════════════════
```

## Запреты

- НЕ грузить файлы вне папки `analyses_folder_id` из DRIVE.md.
- НЕ оставлять `convertToGoogleFormat: false` без fallback-сообщения «активируй Docs API».
- НЕ вызывать `addPermission` — известный баг пакета на `type: anyone`, разрешения наследуются от папки.
- Длинное тире (—) и среднее (–) не использовать. Только дефис (-).
