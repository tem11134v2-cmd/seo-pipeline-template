---
name: share-strategy
description: Повторная или отложенная загрузка docx-стратегии и xlsx-сметы из strategies/NNN/ на Google Drive (с автоконверсией в Google Doc/Sheet). По умолчанию `/strategy` сам делает это в шаге 9 — этот скил нужен только если шаг был пропущен или после правок локальных файлов. Аргументы:<NNN> [--redo].
---

# share-strategy

Утилита-помощник для скила `/strategy`. **Основной поток `/strategy` загружает результаты в Drive сам** (шаг 9). Этот скил пригодится в трёх сценариях:

1. **Drive был недоступен** при первом прогоне `/strategy` — стратегия осталась в `state: xlsx-done` без `share.json`. Запускаешь `/share-strategy <NNN>` после восстановления MCP.
2. **Поправил локальный .docx или .xlsx** вручную или через будущий `/fix-strategy` — нужно перезалить новую версию в Drive: `/share-strategy <NNN> --redo`.
3. **Legacy-стратегии** (собраны до версии этого скила, когда Drive ещё не был интегрирован в `/strategy`) — догрузить ссылки задним числом: `/share-strategy <NNN>`.

## Аргументы

```
/share-strategy <NNN> [--redo]
```

- `NNN` - номер стратегии (например `001`). Обязательный позиционный.
- `--redo` - пересоздать ссылки: удалить старые файлы в Drive (по `drive_id` из существующего `share.json`), загрузить заново. Использовать после правок локальных файлов.

## Предусловия

- MCP `gdrive-piotr` подключён, OAuth пройден. Если тулы `mcp__gdrive-piotr__*` недоступны — см. README → Troubleshooting.
- В `<strategy_dir>` существуют **готовые** артефакты: `SEO_Strategy_<slug>.docx` и `Smeta_<slug>.xlsx`.
- `~/.claude/seo-knowledge/DRIVE.md` содержит актуальные ID папок Drive.

## Алгоритм

### 0. Parse args

```
NNN = <обязательно>
redo = true если --redo
```

Проверка worktree: рекомендуется (расшаривание не пишет в общие файлы), но не блокировать выполнение в main.

### 1. Найти папку стратегии и проверить готовность

`strategy_dir = strategies/<NNN>-*/` - найти существующую по NNN. Если не найдено - стоп: «Стратегия с номером <NNN> не найдена.»

Прочитать:
- `<strategy_dir>/meta.json` - убедиться, что `state >= xlsx-done` (стратегия и смета собраны). Если нет - стоп с подсказкой запустить `/strategy <URL> --resume`.
- `<strategy_dir>/inputs.json` - получить `slug`, `domain`.

Локальные пути:
- `docx_path = <strategy_dir>/SEO_Strategy_<slug>.docx`
- `xlsx_path = <strategy_dir>/Smeta_<slug>.xlsx`

Если хотя бы одного нет - стоп с указанием отсутствующего пути.

### 2. Развилка по share.json

Случай **A:** `share.json` не существует, `--redo` НЕ передан.
- Это сценарий «отложенная или legacy-загрузка». Просто грузим, как делает шаг 9 в `/strategy`.
- Переход к шагу 3.

Случай **B:** `share.json` существует, `--redo` НЕ передан.
- Прочитать `share.json`, вывести существующие ссылки.
- Сообщить: «Стратегия уже расшарена (<shared_at>). Передай `--redo`, чтобы перезалить.»
- Стоп.

Случай **C:** `--redo` передан.
- Прочитать `share.json` (если существует), получить `strategy.drive_id` и `smeta.drive_id`.
- Удалить старые через `mcp__gdrive-piotr__deleteItem` для каждого. Если deleteItem упал (файл уже удалён руками) — предупредить, но продолжать.
- Локальный `share.json` оставить — перезапишется на шаге 5.
- Переход к шагу 3.

### 3. Прочитать DRIVE.md

`~/.claude/seo-knowledge/DRIVE.md` — извлечь `strategies_folder_id` и `smety_folder_id`.

Если файл не существует — стоп: «Не найдена конфигурация Drive в `~/.claude/seo-knowledge/DRIVE.md`. Создай по образцу из ADR-008.»

### 4. Загрузить с конверсией

**Стратегия (.docx → Google Doc):**

```
mcp__gdrive-piotr__uploadFile(
  localPath: <абсолютный docx_path>,
  name: SEO_Strategy_<slug>,
  parentFolderId: <strategies_folder_id>,
  convertToGoogleFormat: true
)
```

Сохранить `id`, `link` из ответа.

**Смета (.xlsx → Google Sheet):**

```
mcp__gdrive-piotr__uploadFile(
  localPath: <абсолютный xlsx_path>,
  name: Smeta_<slug>,
  parentFolderId: <smety_folder_id>,
  convertToGoogleFormat: true
)
```

Сохранить `id`, `link`.

### 5. Записать share.json и обновить meta

`<strategy_dir>/share.json` — формат как в `/strategy` шаг 9d (включая `mime_type: application/vnd.google-apps.document` / `application/vnd.google-apps.spreadsheet`). Если `--redo` — увеличить `redo_count` (или установить в 1, если поля не было).

`bash .claude/hooks/update-meta.sh <strategy_dir> shared` — обновить state. Если state уже был `completed`, оставить `completed`, просто добавить `shared` в `completed_steps` (update-meta это делает корректно через `unique`).

### 6. Вывод

```
═══ СТРАТЕГИЯ РАСШАРЕНА ═══

Клиент: <domain>

📄 Стратегия (Google Doc):
   <view_link>

📊 Смета (Google Sheet):
   <view_link>

Оба расшарены anyone-with-link → reader (наследуется от папок).
Локальные оригиналы:
   <docx_path>
   <xlsx_path>
═══════════════════════════
```

Если в worktree-сессии — напомнить про `/handoff`.

## Запреты

- НЕ грузить файлы в Drive вне якорей-папок (только `parentFolderId` из DRIVE.md).
- НЕ оставлять `convertToGoogleFormat: false` — это противоречит решению об автоконверсии (ADR-008 обновлён). Команда не сможет редактировать в браузере.
- НЕ вызывать `addPermission` — известный баг пакета на `type: anyone`.
- НЕ менять файлы в Drive после загрузки через MCP. Если нужны правки — править локальный файл (через `/strategy --resume` или вручную), затем `/share-strategy <NNN> --redo`.
- Длинное тире (—) и среднее (–) не использовать. Только дефис (-).

## Параллельная работа

Несколько `/share-strategy` для разных стратегий — без проблем, каждая в своей папке `strategies/NNN/`, общих файлов не правят.
