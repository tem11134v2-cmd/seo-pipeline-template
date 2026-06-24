---
name: share-faq
description: Повторная или отложенная загрузка FAQ_<slug>.docx (FAQ из 2 разделов - Текстовый FAQ + Schema.org) из faq/NNN/ на Google Drive (с конверсией в Google Doc). По умолчанию /seo-faq делает это сам (шаг 6) - этот скил нужен если шаг был пропущен (Drive недоступен / нет texts_folder_id) или после ручных правок локального .docx. Аргументы - <NNN> [--redo].
---

# share-faq

Утилита-помощник для `/seo-faq`: заливает `FAQ_<slug>.docx` (единый документ из 2 разделов - Текстовый FAQ + Schema.org) в Google Drive. Запускается **в worktree-сессии**.

## Аргументы
```
/share-faq <NNN> [--redo]
```

## Алгоритм
1. Найти `faq/<NNN>-*/`. Записать `.claude/tmp/current-task.txt`.
2. `~/.claude/seo-knowledge/DRIVE.md` -> `faq_folder_id` (отдельная папка «FAQ»); если не задан / `TODO_*` - **фолбэк на `texts_folder_id`** (папка «Тексты»). Нет ни того, ни другого - стоп с подсказкой создать папку и вписать ID.
3. Загрузить `FAQ_<slug>.docx`:
```
mcp__gdrive-piotr__uploadFile(localPath:<docx>, name:FAQ_<slug>, parentFolderId:<faq_folder_id | texts_folder_id>,
  mimeType:"application/vnd.openxmlformats-officedocument.wordprocessingml.document", convertToGoogleFormat:true)
```
Конверсия упала - fallback `convertToGoogleFormat:false` + подсказать активировать Docs API.
4. Записать/обновить `share.json` (при `--redo` - в `revisions`).
5. Вывести ссылку. Подсказать `/handoff`.

## Запреты
- Пиши только в `faq/<NNN>/` (`share.json`).
- Длинное/среднее тире (— –) запрещено - дефис (-).
