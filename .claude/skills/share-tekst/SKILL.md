---
name: share-tekst
description: Повторная или отложенная загрузка Drive-файлов задачи /seo-tekst (v7.1): prototype.html и tone-preview.html заливаются КАК ФАЙЛ (без конвертации, постоянная ссылка), Skeletons_<slug>.docx - с конвертацией в Google Doc. По умолчанию /seo-tekst заливает все сам - скил нужен если заливка была пропущена (Drive недоступен / нет texts_folder_id) или файл пересобран (правки скелетов, /seo-tekst-fix). Аргументы - <NNN> [--skeletons | --tone | --prototype] [--redo] (дефолт --prototype).
---

# share-tekst (v7.1)

Утилита-помощник для `/seo-tekst`: перезаливка Drive-файлов задачи. Запускается **в worktree-сессии**. Texts.docx в v7.1 не существует - клиентский деливерабл текстов = прототип; скил работает с тремя файлами:

| Флаг цели | Локальный файл | Как заливается в Drive | Поле share.json |
|---|---|---|---|
| `--skeletons` | `Skeletons_<slug>.docx` | Google Doc (с конвертацией) | `skeletons` |
| `--tone` | `tone/tone-preview.html` | ФАЙЛ (без конвертации) | `tone_preview` |
| `--prototype` (дефолт) | `prototype.html` | ФАЙЛ (без конвертации) | `prototype` |

## Когда нужен
- `/seo-tekst` шел при недоступном Drive или без `texts_folder_id` в DRIVE.md - файл есть локально, в Drive не залит.
- Файл пересобран и Drive-копия устарела: скелеты после правок заказчика (re-docx), прототип после `/seo-tekst-fix`, тон-превью после tone-revising.

## Аргументы
```
/share-tekst <NNN> [--skeletons | --tone | --prototype] [--redo]
```
- `<NNN>` - папка `texts/NNN-*/`.
- Флаг цели - какой файл заливать; без флага - `--prototype`. Один вызов = одна цель (нужно несколько - несколько вызовов).
- `--redo` - перезалить, даже если ссылка уже есть в поле цели `share.json` (новая ревизия: delete старого файла в Drive + upload нового + перезапись id/link).

## Алгоритм
1. Найти `texts/<NNN>-*/`. Записать `.claude/tmp/current-task.txt`. `slug` - из имени папки (`NNN-<slug>`).
2. Определить цель (таблица выше) и проверить, что локальный файл существует. Нет - стоп с подсказкой: `--skeletons` - `/seo-tekst --resume` (такт 1 / build-skeletons-docx еще не пройдены), `--tone` - тон-гейт еще не собран, `--prototype` - догнать `/seo-tekst --resume` до `prototype-built`.
3. Прочитать `~/.claude/seo-knowledge/DRIVE.md` -> `texts_folder_id`. Нет / `TODO_*` - стоп с подсказкой создать папку «Тексты» (anyone-with-link -> reader) и вписать ID.
4. Развилка по полю цели в `share.json`:
   - поля нет - грузим как новый (шаг 5);
   - поле есть, `--redo` НЕ передан - вывести ссылку и остановиться: «Уже расшарен (<shared_at>). Передай `--redo` для перезаливки.»;
   - `--redo` передан - удалить старый файл в Drive (`mcp__gdrive-piotr__deleteItem` по `drive_file_id` поля цели; упало - предупредить, продолжать), затем шаг 5.
5. Залить.
   - `--skeletons` (конвертация в Google Doc):
```
mcp__gdrive-piotr__uploadFile(localPath:<texts_dir>/Skeletons_<slug>.docx, name:"Skeletons_<slug>", parentFolderId:<texts_folder_id>,
  mimeType:"application/vnd.openxmlformats-officedocument.wordprocessingml.document", convertToGoogleFormat:true)
```
     Упало с конверсией - fallback `convertToGoogleFormat:false` + подсказать активировать Docs API.
   - `--tone` / `--prototype` (файлом):
```
mcp__gdrive-piotr__uploadFile(localPath:<texts_dir>/tone/tone-preview.html | <texts_dir>/prototype.html,
  name:"tone-preview_<slug>.html" | "prototype_<slug>.html", parentFolderId:<texts_folder_id>,
  mimeType:"text/html", convertToGoogleFormat:false)
```
     `convertToGoogleFormat:true` для html ЗАПРЕЩЕН - конвертация убивает роутер и скрипты прототипа; смысл заливки - постоянная ссылка на живой файл в папке клиента.
   Sanity-check: писать `share.json` только при непустых `id`/`link` в ответе uploadFile; пустой ответ = битый аплоад, повторить.
6. Записать в `share.json` **скриптом** (руками метку времени не ставить - разъедется с реальностью, а проверить ее нечем; соседние ключи скрипт не трогает):
```
.claude\scripts\_node.cmd .claude\scripts\share-record.mjs <texts_dir> <skeletons|tone_preview|prototype> --file-id <id> --link <link> --mime <итоговый mime> [--revision manual_redo]
```
   Схема записи: `{drive_file_id, drive_link, mime_type, shared_at, revisions[]}`. При `--redo` передавать `--revision manual_redo` - прежняя ссылка уйдет в `revisions[]`, а не пропадет.
   Поля `share.json.texts` и `share.json.analysis` - поля старых задач (Texts.docx / Analysis.docx существовали до v7.1): не читаем и не пишем. Старые ключи `{file_id, link, uploaded_at}` (задачи до 25.08) читаем, но больше не пишем.
   **`--skeletons --redo`:** перед удалением старого документа снять комментарии заказчика - `mcp__gdrive-piotr__listComments` по прежнему `drive_file_id` -> `<texts_dir>/skeletons_comments.json`. Перезаливка создает новый документ, и комментарии к прежней версии иначе остаются на файле, который никто больше не откроет.
7. `meta.json`: только для `--prototype` и только если `state == "prototype-built"` - `update-meta.sh <texts_dir> shared` (v7.1: `shared` = прототип в Drive). Все остальные состояния и цели - state не трогаем.
8. Вывести ссылку. Подсказать `/handoff` если задача закончена.

## Запреты
- Пиши только в `texts/<NNN>/` (`share.json`). Pre-commit отклонит остальное.
- НЕ конвертируй html (прототип, тон-превью) в Google-формат - только файлом.
- НЕ грузить файлы вне папки `texts_folder_id` из DRIVE.md.
- НЕ вызывать `addPermission` - известный баг пакета на `type: anyone`; разрешения наследуются от папки.
- Длинное/среднее тире (— –) запрещено - дефис (-).
- НЕ используй букву ё - всегда пиши е. Правило для всех клиентских текстов и метатегов (как и запрет тире).
