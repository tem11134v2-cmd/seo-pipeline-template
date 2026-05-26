---
name: share-strategy
description: Загружает финальные docx-стратегию и xlsx-смету из strategies/NNN/ на Google Drive в расшаренные папки-якоря. Возвращает ссылки для передачи клиенту. Аргументы:<NNN> [--redo].
---

# share-strategy

Скил поверх MCP `gdrive-piotr`. Берёт уже собранную стратегию (`SEO_Strategy_*.docx` + `Smeta_*.xlsx` из `strategies/NNN-slug/`), загружает в Drive в два якоря-папки (см. `~/.claude/seo-knowledge/DRIVE.md`), записывает результат в `<strategy_dir>/share.json` и обновляет `meta.json`.

## Аргументы

```
/share-strategy <NNN> [--redo]
```

- `NNN` - номер стратегии (например `001`). Обязательный позиционный.
- `--redo` - пересоздать ссылки: удалить старые файлы из Drive по id из `share.json`, загрузить заново. Использовать после правок локальных .docx/.xlsx.

## Предусловия

- MCP `gdrive-piotr` подключён глобально, OAuth пройден (см. ADR-008). Если тулы вида `mcp__gdrive-piotr__uploadFile` не появляются - см. README → Troubleshooting.
- В `<strategy_dir>` существуют **готовые** артефакты: `SEO_Strategy_<slug>.docx` и `Smeta_<slug>.xlsx`. Их создаёт скил `/strategy` (этапы `docx-done` и `xlsx-done`).
- `~/.claude/seo-knowledge/DRIVE.md` содержит актуальные ID папок Drive.

## Алгоритм

### 0. Parse args + sanity

```
NNN = <обязательно, форматировать как N или NN или NNN с ведущим нулём>
redo = true если --redo
```

Проверка worktree:
```bash
GIT_DIR=$(git rev-parse --git-dir)
COMMON_DIR=$(git rev-parse --git-common-dir)
```
Если в main - предупредить, но не блокировать (расшаривание не пишет в общие файлы проекта).

### 1. Найти папку стратегии

`strategy_dir = strategies/<NNN>-*/` - найти существующую по NNN. Если не найдено - стоп: «Стратегия с номером <NNN> не найдена. Запускал ли /strategy для этого клиента?»

Прочитать:
- `<strategy_dir>/meta.json` - убедиться, что `state >= xlsx-done` (стратегия и смета уже собраны). Если нет - стоп: «Стратегия ещё не дособрана локально (state = <X>). Допиши через `/strategy <URL> --resume`, потом расшаривай.»
- `<strategy_dir>/inputs.json` - получить `slug`, `domain`.

### 2. Найти артефакты

Локальные файлы:
- `docx_path = <strategy_dir>/SEO_Strategy_<slug>.docx`
- `xlsx_path = <strategy_dir>/Smeta_<slug>.xlsx`

Если хотя бы один не существует - стоп с понятным сообщением (какого именно файла нет, где он должен быть).

### 3. Проверить, не расшаривали ли уже

Если `<strategy_dir>/share.json` существует **и** `--redo` НЕ передан:
- Прочитать share.json, вывести существующие ссылки.
- Сообщить: «Стратегия уже расшарена ранее (<shared_at>). Передай `--redo`, чтобы пересоздать.»
- Стоп.

Если `--redo`:
- Прочитать `share.json`, получить старые `drive_id` обоих файлов.
- Удалить их через `mcp__gdrive-piotr__deleteItem` (для каждого: `itemId: <drive_id>`).
- Если deleteItem упал (файл уже удалён вручную / нет прав) - предупредить, но продолжать.
- Удалить локально `share.json` (перед записью нового).

### 4. Прочитать DRIVE.md

`~/.claude/seo-knowledge/DRIVE.md` - извлечь два ID:
- `strategies_folder_id` - папка для .docx
- `smety_folder_id` - папка для .xlsx

Если файл не существует или ID не парсятся - стоп: «Не найдена конфигурация Drive в ~/.claude/seo-knowledge/DRIVE.md. Создай файл по образцу из ADR-008.»

### 5. Загрузить стратегию (.docx)

```
mcp__gdrive-piotr__uploadFile(
  localPath: <абсолютный путь к SEO_Strategy_<slug>.docx>,
  name: SEO_Strategy_<slug>.docx,
  parentFolderId: <strategies_folder_id>,
  convertToGoogleFormat: false
)
```

**Важно:** `convertToGoogleFormat: false` - оставляем как .docx, без конверсии в Google Doc. Так клиент скачивает оригинальный Office-формат.

Из ответа сохранить: `id`, `link` (viewLink), `name`.

### 6. Загрузить смету (.xlsx)

```
mcp__gdrive-piotr__uploadFile(
  localPath: <абсолютный путь к Smeta_<slug>.xlsx>,
  name: Smeta_<slug>.xlsx,
  parentFolderId: <smety_folder_id>,
  convertToGoogleFormat: false
)
```

Тоже без конверсии (формулы SUM сохраняются точно).

Из ответа сохранить: `id`, `link`, `name`.

### 7. Проверить наследование прав (опционально, для уверенности)

Для каждого только что загруженного файла - `mcp__gdrive-piotr__listPermissions`. В ответе должно быть `anyoneWithLink: anyone => reader [inherited]`. Если нет (например, папка случайно потеряла anyone-with-link) - предупредить пользователя с инструкцией поправить.

### 8. Записать `<strategy_dir>/share.json`

```json
{
  "shared_at": "<ISO UTC>",
  "shared_by": "tem11134v2@gmail.com",
  "redo_count": <0 или +1 если --redo>,
  "strategy": {
    "filename": "SEO_Strategy_<slug>.docx",
    "drive_id": "<id>",
    "view_link": "https://drive.google.com/file/d/<id>/view",
    "parent_folder_id": "<strategies_folder_id>"
  },
  "smeta": {
    "filename": "Smeta_<slug>.xlsx",
    "drive_id": "<id>",
    "view_link": "https://drive.google.com/file/d/<id>/view",
    "parent_folder_id": "<smety_folder_id>"
  }
}
```

### 9. Обновить meta.json

```bash
bash .claude/hooks/update-meta.sh <strategy_dir> shared
```

(Состояние `shared` добавится в `completed_steps`; `state` обновится.)

### 10. Вывод пользователю

```
═══ СТРАТЕГИЯ РАСШАРЕНА ═══

Клиент:   <domain>
Дата:     <ISO UTC>

📄 Стратегия (для клиента):
   <view_link стратегии>

📊 Смета (внутренняя, с ценами):
   <view_link сметы>

Оба файла доступны по ссылке любому без логина (anyone with link → reader).
Локально сохранено в <strategy_dir>/share.json.

⚠️  Файлы в Drive **наследуют** права папок-якорей. Если случайно отозвать
   расшаривание у папки - файлы тоже потеряют публичность.
═══════════════════════════
```

Не забыть про worktree:
```
ℹ️  Эта сессия в worktree. Не забудь /handoff, чтобы share.json
   попал в основной репозиторий проекта.
```

## Запреты

- **НЕ грузить файлы в Drive вне якорей-папок.** Только `parentFolderId` из DRIVE.md. Иначе расшаренность не унаследуется.
- **НЕ конвертировать в Google Doc / Sheets** (`convertToGoogleFormat: false`). Это сохраняет точный Office-формат для клиента и формулы для бухгалтерии.
- **НЕ вызывать `addPermission`** - известно, что у пакета gdrive-piotr@2.2.0 баг с `type: anyone` (см. ADR-008). Расшаривание идёт через наследование от папки.
- **НЕ менять файлы в Drive после загрузки** через MCP. Если нужны правки - меняй локальный .docx/.xlsx через `/strategy --resume` (или `/fix-strategy` в будущем), потом `/share-strategy <NNN> --redo`.
- **Длинное тире (—) и среднее (–) не использовать.** Только дефис (-).

## Resume

Resume не нужен - скил атомарный (создаются два файла подряд, share.json пишется только если оба upload'а успешны). Если падение посередине - запустить с `--redo`, удалит остатки и зальёт заново.

## Параллельная работа

Если параллельно с одной стратегией крутится `/strategy --resume` (пользователь дописывает), запуск `/share-strategy` для неё откажет на проверке `state >= xlsx-done`. Норма.

Несколько `/share-strategy` для разных стратегий одновременно - без проблем, каждая в своей папке `strategies/NNN/`, никаких общих файлов не правят.
