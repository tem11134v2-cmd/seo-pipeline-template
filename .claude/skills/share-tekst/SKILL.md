---
name: share-tekst
description: Повторная или отложенная загрузка Texts_<slug>.docx из texts/NNN/ на Google Drive (с конверсией в Google Doc). По умолчанию /seo-tekst делает это сам (шаг texts-shared) - этот скил нужен если шаг был пропущен (Drive недоступен / нет texts_folder_id) или после ручных правок локального .docx. Аргументы - <NNN> [--redo].
---

# share-tekst

Утилита-помощник для `/seo-tekst`: заливает клиентский docx с текстами (`Texts_<slug>.docx`) в Google Drive. Запускается **в worktree-сессии**.

## Когда нужен
- `/seo-tekst` шел при недоступном Drive или без `texts_folder_id` в DRIVE.md -> локальный docx есть, в Drive не залит.
- Заказчик прислал правки, ты обновил локальный docx (или пере-сгенерил) и хочешь обновить Google Doc.

## Аргументы
```
/share-tekst <NNN> [--redo]
```
- `<NNN>` - папка `texts/NNN-*/`.
- `--redo` - перезалить, даже если ссылка уже есть в `share.json` (новая ревизия).

## Алгоритм
1. Найти `texts/<NNN>-*/`. Записать `.claude/tmp/current-task.txt`.
2. Прочитать `~/.claude/seo-knowledge/DRIVE.md` -> `texts_folder_id`. Нет / `TODO_*` - стоп с подсказкой создать папку «Тексты» (anyone-with-link -> reader) и вписать ID.
3. Залить `Texts_<slug>.docx`:
```
mcp__gdrive-piotr__uploadFile(localPath:<docx>, name:<имя без .docx>, parentFolderId:<texts_folder_id>,
  mimeType:"application/vnd.openxmlformats-officedocument.wordprocessingml.document", convertToGoogleFormat:true)
```
   Если упало с конверсией - fallback `convertToGoogleFormat:false` + подсказать активировать Docs API.
4. Записать/обновить `share.json` (`texts`: drive_file_id, drive_link, shared_at; при `--redo` - добавить в `revisions`). `meta.json` не трогаем (state остается). Поле `analysis` в share.json - legacy старых задач (до v7, когда существовал Analysis.docx): не читаем и не пишем.
5. Вывести ссылку. Подсказать `/handoff` если задача закончена.

## Запреты
- Пиши только в `texts/<NNN>/` (`share.json`). Pre-commit отклонит остальное.
- Не конвертируй прототип (.html) в Google-формат - отдается файлом.
- Длинное/среднее тире (— –) запрещено - дефис (-).
- НЕ используй букву ё - всегда пиши е. Правило для всех клиентских текстов и метатегов (как и запрет тире).
