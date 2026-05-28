---
name: share-article
description: Загружает Article_<slug>.docx из articles/NNN/ на Google Drive (с автоконверсией в Google Doc) и записывает delivery-ссылку в meta.json. По умолчанию /write-article делает это сам в шаге 13 — этот скил нужен если шаг пропустили (Drive был недоступен) или после ручных правок локального docx. Аргументы: <NNN> [--redo].
---

# share-article

Утилита-помощник для скила `/write-article`. Основной поток `/write-article` загружает docx статьи в Drive сам (на этапе finalize). Этот скил пригодится в трёх сценариях:

1. **Drive был недоступен** при первом прогоне `/write-article` — docx остался локально, `meta.share` не заполнен. Запускаешь `/share-article <NNN>` после восстановления MCP.
2. **Поправил локальный .docx** руками или через `/fix-article` — нужно перезалить новую версию: `/share-article <NNN> --redo`.
3. **Legacy-статьи**, собранные до интеграции Drive в `/write-article` — догрузить ссылку задним числом: `/share-article <NNN>`.

## Аргументы

```
/share-article <NNN> [--redo]
```

- `NNN` — номер статьи (например `001`). Обязательный позиционный.
- `--redo` — пересоздать ссылку: удалить старый файл в Drive (по `drive_id` из `meta.share`), загрузить заново.

## Предусловия

- MCP `gdrive-piotr` подключён, OAuth пройден.
- В `articles/<NNN>-*/` есть собранный `Article_<slug>.docx` (создаётся через `build-article-docx.mjs` — шаг сборки в `/write-article`).
- `~/.claude/seo-knowledge/DRIVE.md` содержит якорь `Статьи` с Drive folder ID. Если якоря нет — стоп с инструкцией: «Добавь в DRIVE.md строку таблицы `| **Статьи** | Конвертированные Google Doc статей клиентов | <folder_id> |`. Папку создай в Drive вручную, расшарь anyone-with-link → reader, скопируй её ID.»

## Алгоритм

### 0. Parse args

```
NNN = <обязательно>
redo = true если --redo
```

Проверка worktree: рекомендуется (не пишет в общие файлы), но не блокировать выполнение в main.

### 1. Найти папку статьи и проверить готовность

`article_dir = articles/<NNN>-*/` — найти существующую по NNN. Если не найдено — стоп: «Статья с номером <NNN> не найдена.»

Прочитать:
- `<article_dir>/meta.json` — `slug`, `topic`, `state`. Если `state < assembled` — стоп: «Статья ещё не собрана. Запусти `/write-article <N> --resume`.»
- `docx_path = <article_dir>/Article_<slug>.docx` — обязателен. Если нет — стоп: «Файл `Article_<slug>.docx` не найден. Запусти `node .claude/scripts/build-article-docx.mjs <article_dir>` (или `/write-article <N> --resume`).»

### 2. Развилка по meta.share

Случай **A:** в `meta.json` нет поля `share` (или `share.docx_url` пуст), `--redo` НЕ передан.
- Сценарий «отложенная или legacy-загрузка». Просто грузим.
- Переход к шагу 3.

Случай **B:** `meta.share.docx_url` есть, `--redo` НЕ передан.
- Вывести существующую ссылку.
- Сообщить: «Статья уже расшарена (`meta.share.shared_at`). Передай `--redo`, чтобы перезалить.»
- Стоп.

Случай **C:** `--redo` передан.
- Прочитать `meta.share.drive_id`. Если есть — удалить через `mcp__gdrive-piotr__deleteItem(itemId=<drive_id>)`. Если удаление упало (файл уже стёрт руками) — предупредить, но продолжать.
- Переход к шагу 3.

### 3. Прочитать DRIVE.md

`~/.claude/seo-knowledge/DRIVE.md` — найти строку таблицы с типом «Статьи». Распарсить колонку «Drive ID».

Если якоря нет — стоп с инструкцией (см. «Предусловия»).

### 4. Загрузить с конверсией

```
mcp__gdrive-piotr__uploadFile(
  localPath: <абсолютный docx_path>,
  name: Article_<slug>,
  parentFolderId: <articles_folder_id из DRIVE.md>,
  convertToGoogleFormat: true
)
```

Сохранить `id` и `link` из ответа.

### 5. Записать meta.share

Обновить `<article_dir>/meta.json`:
```json
{
  ...,
  "share": {
    "docx_url": "<link из uploadFile>",
    "drive_id": "<id из uploadFile>",
    "mime_type": "application/vnd.google-apps.document",
    "shared_at": "<ISO UTC>",
    "redo_count": 0
  }
}
```

При `--redo` — увеличить `redo_count` (если поля нет — 1).

Если `state` был `< completed` — установить через `bash .claude/hooks/update-meta.sh <article_dir> completed`. Если уже `completed` — НЕ вызывать update-meta (state не должен регрессировать).

### 6. Вывод

```
═══ СТАТЬЯ РАСШАРЕНА ═══

Статья: <topic>
Локальный .docx: <docx_path>

📄 Google Doc:
   <link>

Расшарена anyone-with-link → reader (наследуется от папки).
═══════════════════════════
```

Если в worktree-сессии — напомнить про `/handoff`.

## Запреты

- НЕ грузить файлы в Drive вне якоря «Статьи» (только `parentFolderId` из DRIVE.md).
- НЕ оставлять `convertToGoogleFormat: false` — без конверсии команда не сможет редактировать в браузере.
- НЕ вызывать `addPermission` — известный баг пакета на `type: anyone`.
- НЕ менять файл в Drive после загрузки. Правки — в локальный docx, потом `/share-article <NNN> --redo`.
- Длинное тире (—) и среднее (–) не использовать. Только дефис (-).

## Параллельная работа

Несколько `/share-article` для разных статей — без проблем, каждая в своей `articles/NNN/`, общих файлов не правят.
