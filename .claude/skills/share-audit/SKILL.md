---
name: share-audit
description: Повторная или отложенная загрузка A12_<slug>.docx из audits/NNN/ на Google Drive (с автоконверсией в Google Doc). По умолчанию `/seo-tehaudit` сам делает это в шаге 7 - этот скил нужен если шаг был пропущен (Drive недоступен / нет audits_folder_id) или после ручных правок локального .docx. Аргументы: <NNN> [--redo].
---

# share-audit

Утилита-помощник для скила `/seo-tehaudit`. **Основной поток `/seo-tehaudit` загружает результат в Drive сам** (шаг 7). Этот скил пригодится в трёх сценариях:

1. **Drive был недоступен** при первом прогоне `/seo-tehaudit` (или не задан `audits_folder_id`) - аудит остался в `state: docx-done` без `share.json`. Запускаешь `/share-audit <NNN>` после восстановления MCP / добавления ID.
2. **Поправил локальный .docx** вручную - перезалить: `/share-audit <NNN> --redo`.
3. **Запускали с `--no-share`** - догрузить ссылку задним числом: `/share-audit <NNN>`.

## Аргументы

```
/share-audit <NNN> [--redo]
```

- `NNN` - номер аудита (например `001`). Обязательный позиционный.
- `--redo` - пересоздать ссылку: удалить старый файл в Drive (по `drive_file_id` из существующего `share.json`), загрузить заново. После правок локального .docx.

## Предусловия

- MCP `gdrive-piotr` подключён, OAuth пройден.
- В `<audit_dir>` существует **готовый** артефакт `A12_<slug>.docx`.
- `~/.claude/seo-knowledge/DRIVE.md` содержит `audits_folder_id`.

## Алгоритм

### 0. Parse args

```
NNN  = <обязательно>
redo = true если --redo
```

### 1. Найти папку аудита и проверить готовность

`audit_dir = audits/<NNN>-*/` - найти существующую по NNN. Не найдено - стоп.

Прочитать `<audit_dir>/meta.json`:
- Убедиться, что `state >= docx-done` (есть .docx). Если нет - стоп с подсказкой `/seo-tehaudit <NNN> --resume`.
- Получить `slug`, `domain`.

Локальный путь: `docx_path = <audit_dir>/A12_<slug>.docx`. Если нет - стоп с подсказкой пересобрать: `.claude\scripts\_node.cmd .claude\scripts\build-audit-docx.mjs <audit_dir>`.

Записать `.claude/tmp/current-task.txt` = `<audit_dir>` (для возможного коммита share.json).

### 2. Развилка по share.json

- **Случай A:** `share.json` нет, `--redo` НЕ передан. Грузим как новый. → шаг 3.
- **Случай B:** `share.json` есть, `--redo` НЕ передан. Вывести ссылку, стоп: «Аудит уже расшарен (<shared_at>). Передай `--redo` для перезаливки.»
- **Случай C:** `--redo` передан. Прочитать `share.json`, взять `drive_file_id`, удалить через `mcp__gdrive-piotr__deleteItem`. Если упало - предупредить, продолжать. → шаг 3.

### 3. Прочитать DRIVE.md

`~/.claude/seo-knowledge/DRIVE.md` → `audits_folder_id`. Если нет ключа - стоп:
> «Не найден `audits_folder_id` в DRIVE.md. Создай папку `/SEO/Audits/` в Drive (права `anyone-with-link -> reader`), добавь её ID в DRIVE.md как `audits_folder_id`, повтори.»

### 4. Загрузить

```
mcp__gdrive-piotr__uploadFile(
  localPath: <абсолютный docx_path>,
  name: A12_<slug>,
  parentFolderId: <audits_folder_id>,
  mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  convertToGoogleFormat: true
)
```

Если упало - fallback `convertToGoogleFormat: false` + сообщение «активируй Google Docs API, потом `/share-audit <NNN> --redo`».

**Sanity-check:** записывать `share.json` только если ответ `uploadFile` содержит непустой `id`/`link` (у Google Doc `Size: 1 bytes` - норма). Пустой ответ = битый аплоад, повтори.

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

Если `--redo` - добавить запись в `revisions[]`:
```json
{ "type": "manual_redo", "applied_at": "<ISO>", "new_drive_file_id": "<new_id>", "new_drive_link": "<new_link>" }
```

### 6. Обновить meta.json

Учесть идемпотентность для финальных состояний (не регрессировать state):
- `state == "docx-done"` → `shared` (через `update-meta.sh <audit_dir> shared drive_file_id=<id> drive_link=<link>`)
- `state == "shared"` → не трогать state, обновить `drive_file_id`/`drive_link` через Edit
- `state == "client-review" | "revising" | "approved" | "completed"` → не трогать state, обновить только `drive_file_id` и `drive_link` через Edit

### 7. Вывод

```
═══ ТЕХАУДИТ РАСШАРЕН ═══

Клиент: <domain или slug>

📄 A12 (Google Doc для клиента):
   <view_link>

Локальный оригинал:
   <docx_path>
═════════════════════════
```

## Запреты

- НЕ грузить файлы вне папки `audits_folder_id` из DRIVE.md.
- НЕ оставлять `convertToGoogleFormat: false` без fallback-сообщения «активируй Docs API».
- НЕ вызывать `addPermission` - известный баг пакета на `type: anyone`, разрешения наследуются от папки.
- Длинное тире (—) и среднее (–) не использовать. Только дефис (-).
- НЕ используй букву ё - всегда пиши е. Правило для всех клиентских текстов и метатегов (как и запрет тире).
