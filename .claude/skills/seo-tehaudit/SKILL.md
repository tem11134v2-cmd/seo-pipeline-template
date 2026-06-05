---
name: seo-tehaudit
description: "Полный цикл технического SEO-аудита сайта под Яндекс. Разведка/карточка -> индексация и тех-здоровье -> URL/мета/Schema/JS -> аналитика/поведенческие/ссылки -> отчёт A12 (.md + .docx) с проблемами по приоритетам, чеклистом разработчику и динамическими приложениями + автозагрузка в Drive и цикл правок. Аргументы: <domain> [--resume] [--no-share] [--from-analysis <NNN>]."
---

# seo-tehaudit

Скил-оркестратор технического SEO-аудита. Запускается **в worktree-сессии**. Проходит state machine от разведки сайта до финальных A12.md / A12.docx и (по умолчанию) заливки в Drive с циклом правок клиента. Пост-онбординговая услуга трека Б: нужны доступы клиента к Вебмастеру и Метрике (аудит деградирует мягко, если их нет).

Творческая работа разнесена по 5 субагентам (`audit-recon`, `audit-indexing`, `audit-onpage`, `audit-analytics`, `audit-writer`); рендер A12.md/.docx и проверка - детерминированные скрипты. Подробности - [ADR-014](../../docs/adr/014-audit-task-type.md).

## Аргументы

```
/seo-tehaudit <domain> [--resume] [--no-share] [--from-analysis <NNN>]
```

- `<domain>` - домен клиента (например `example.ru`; кириллический IDN - в кириллице). Обязателен на фрэш-старте (если не передан - скил спросит).
- `--resume` - продолжить с того места, где остановились (по `meta.json` существующей `audits/NNN-slug/`).
- `--no-share` - собрать A12.md + A12.docx локально, **не** заливать в Drive и не запускать цикл правок. Финальное состояние `docx-done`. Для случаев когда нужен только локальный отчёт.
- `--from-analysis <NNN>` - взять базу Keyso из `analyses/NNN/brief.json` (артефакт A2). Если не задан - скил сам поищет свежий `analyses/` или определит базу по региону.

## State machine

```
init -> recon-done -> indexing-done -> collection-done -> report-done
     -> docx-done -> shared -> client-review
          (revising) -> docx-done -> shared -> client-review   (цикл правок)
     -> approved -> completed
```

Состояния:
- `recon-done` - собран `recon.json` (карточка, host_id, counter_id, база Keyso, CMS) - шаг 2.
- `indexing-done` - собран `indexing.json` (robots, sitemap, диагностика, редиректы, доноры) - шаг 3.
- `collection-done` - собраны `onpage.json` + `analytics.json` (параллельный шаг 4).
- `report-done` - собран `audit_data.json`, отрендерен `A12.md`, пройден `verify-audit` - шаг 5.
- `docx-done` - собран `A12_<slug>.docx` - шаг 6. При `--no-share` - финальное состояние.
- `shared` - .docx залит в Drive, ссылка получена - шаг 7.
- `client-review` - скил ждёт фидбек клиента по ссылке.
- `revising` - применяется правка.
- `approved` - клиент одобрил. Только после этого скил рекомендует `/handoff`.
- `completed` - финал (после `/handoff`).

`meta.json` - единственный источник истины. Обновляется через `bash .claude/hooks/update-meta.sh <audit_dir> <state>`.

## Артефакты

```
audits/NNN-<domain-slug>/
├── meta.json            # state machine + drive_file_id + revisions_log
├── recon.json           # шаг 1: карточка, host_id, counter_id, база Keyso, CMS/шаблон/возраст
├── indexing.json        # шаг 2: robots, sitemap (+all_urls), диагностика, редиректы, доноры
├── onpage.json          # шаг 3: выборка 8-12 страниц, мета-теги, Title-заглушка, schema
├── analytics.json       # шаг 4: трафик, источники, отказы, цели, устройства, вердикт ЯБ
├── audit_data.json      # шаг 5: ЕДИНЫЙ структурированный отчёт (источник истины для рендеров)
├── A12.md               # ФИНАЛ - markdown-отчёт (рендер render-audit-md.mjs)
├── A12_<slug>.docx      # ФИНАЛ - клиентский документ (рендер build-audit-docx.mjs)
└── share.json           # ссылка Drive + drive_file_id + shared_at + revisions[]
```

## Алгоритм

### 0a. Проверка: мы в worktree?

```bash
GIT_DIR=$(git rev-parse --git-dir)
COMMON_DIR=$(git rev-parse --git-common-dir)
```

Если `GIT_DIR == COMMON_DIR` - мы в main. Предупредить:
> «⚠️ Ты собираешь техаудит в main-сессии. Pre-commit hook здесь не блокирует. Для многозадачности рекомендую закрыть и переоткрыть с галочкой worktree.»

Не блокировать.

### 0b. Parse args

```
resume   = true если --resume
no_share = true если --no-share
from_analysis = <NNN> если --from-analysis <NNN>
domain   = первый позиционный аргумент (не флаг)
```

### 1. Setup

#### 1a. Если `--resume`

- Найти существующую `audits/<NNN>-*/`. Если несколько - спросить пользователя.
- Прочитать `meta.json`. `state = meta.state`. Записать `.claude/tmp/current-task.txt` = путь папки.
- Спросить: «Найдено в состоянии `<state>`, обновлено `<updated>`. Продолжить? [Y/n]»
- Если Y - перейти к шагу по карте (идемпотентность: каждый шаг пропускает работу, если его JSON уже есть):
  - `recon-done` -> шаг 3; `indexing-done` -> шаг 4; `collection-done` -> шаг 5; `report-done` -> шаг 6; `docx-done` -> шаг 7 (если не `--no-share`); `shared` -> шаг 7e; `client-review` -> шаг 8; `revising` -> шаг 8d; `approved` -> шаг 9; `completed` -> стоп: «Аудит завершён. Используй `/share-audit <NNN> --redo` для перезаливки.»
  - **resume для шага 4 (параллельного):** если `state==indexing-done` или `collection-done`, но какого-то из `onpage.json`/`analytics.json` нет - до-запустить недостающий коллектор.

#### 1b. Если фрэш-старт

1. **Домен.** Если не передан в аргументе - спросить: «Какой домен проверяем? (например example.ru; для аудита нужны доступы к Вебмастеру и Метрике этого сайта).»
2. `slug = slugify(domain)` (Latin kebab-case, IDN -> транслит; точки в дефис: `example.ru` -> `example-ru`).
3. Найти следующий свободный `NNN` в `audits/` (с 001, ведущий ноль).
4. Создать папку `audits/<NNN>-<slug>/`.
5. **Записать `.claude/tmp/current-task.txt` = `audits/<NNN>-<slug>/`** (критично - без этого pre-commit hook откажет в коммите).
6. Определить `analysis_dir`:
   - Если `--from-analysis <NNN>` задан -> `analyses/<NNN>-*/` (если существует).
   - Иначе - поискать свежую `analyses/*/` с тем же доменом; если есть - использовать; иначе `analysis_dir = null` (база Keyso определится по региону в `audit-recon`).
7. Создать `meta.json`:
   ```json
   {
     "slug": "<slug>",
     "domain": "<domain>",
     "state": "init",
     "no_share": <true|false>,
     "completed_steps": [],
     "started": "<ISO UTC>",
     "updated": "<ISO UTC>"
   }
   ```
8. `state = "init"`. Переход к шагу 2.

### 2. Разведка (если state == "init")

Записать маркер ожидаемого файла (для `check-file.sh`):
```bash
echo "audits/<NNN>-<slug>/recon.json" > .claude/tmp/expected-audit-recon-<NNN>.txt
```

Делегировать `audit-recon`:
```
audit_dir: <audit_dir>
project_root: <project root>
domain: <domain>
analysis_dir: <analysis_dir или опустить>
Прочитай (если задан) brief.json для базы Keyso. Найди сайт в Вебмастере и Метрике, сними метрики Keyso, возраст домена (arsenkin - строго последовательно), определи CMS/шаблон/тематику/регион по главной. Собери recon.json и базовую карточку.
```

После завершения:
- `bash .claude/hooks/update-meta.sh <audit_dir> recon-done`
- Сводку от агента (карточку) - в чат. Это естественная точка показа клиенту. Авто-переход к шагу 3 (пользователь может прервать).

### 3. Индексация (если state == "recon-done")

```bash
echo "audits/<NNN>-<slug>/indexing.json" > .claude/tmp/expected-audit-indexing-<NNN>.txt
```

Делегировать `audit-indexing`:
```
audit_dir: <audit_dir>
project_root: <project root>
Прочитай recon.json. Проверь robots, sitemap (раскрой sitemap-index во все вложенные, собери all_urls), диагностику Вебмастера, битые ссылки, динамику индексации, ИКС, 7 проверок склейки/редиректов, собери доноров. NOT_IN_SPRAV - только кандидат, не 🔴. Собери indexing.json.
```

После:
- `bash .claude/hooks/update-meta.sh <audit_dir> indexing-done`
- Сводка в чат. Переход к шагу 4.

### 4. URL/мета + Аналитика - ПАРАЛЛЕЛЬНО (если state == "indexing-done")

`audit-onpage` и `audit-analytics` независимы (оба читают только `recon.json` + `indexing.json`, друг от друга не зависят). **Запустить их одним сообщением - двумя параллельными делегациями** (экономит время). Ни один из них не использует Арсенкин, так что параллель безопасна.

Записать оба маркера:
```bash
echo "audits/<NNN>-<slug>/onpage.json"    > .claude/tmp/expected-audit-onpage-<NNN>.txt
echo "audits/<NNN>-<slug>/analytics.json" > .claude/tmp/expected-audit-analytics-<NNN>.txt
```

Делегировать **обоих** (в одном сообщении - два вызова субагентов):

`audit-onpage`:
```
audit_dir: <audit_dir>
project_root: <project root>
Прочитай recon.json (keyso_base, domain) и indexing.json (sitemap.all_urls). Сформируй выборку 8-12 страниц, проверь URL-структуру, Title/H1/Description, Title-заглушку, noindex (точно), canonical, Schema.org, favicon, JS-рендеринг. Собери onpage.json.
```

`audit-analytics`:
```
audit_dir: <audit_dir>
project_root: <project root>
Прочитай recon.json (counter_id, counter_age_days, metrika_connected) и indexing.json (not_in_sprav_candidate, external_links). Собери трафик, источники, отказы, цели, устройства; ссылочный профиль; вынеси финальный вердикт Яндекс Бизнеса кросс-проверкой по yandex.ru/maps. Собери analytics.json.
```

После завершения ОБОИХ:
- `bash .claude/hooks/update-meta.sh <audit_dir> collection-done`
- Краткие сводки от обоих - в чат. Переход к шагу 5.

> Если параллельный запуск по какой-то причине неудобен - можно последовательно (onpage, затем analytics). Результат тот же; параллель только быстрее.

### 5. Сборка отчёта (если state == "collection-done")

```bash
echo "audits/<NNN>-<slug>/audit_data.json" > .claude/tmp/expected-audit-writer-<NNN>.txt
```

Делегировать `audit-writer`:
```
audit_dir: <audit_dir>
project_root: <project root>
Прочитай recon/indexing/onpage/analytics.json. Агрегируй и дедуплицируй проблемы, расставь приоритеты, собери карточку (22 строки), автоподсчёт counts, чеклист разработчику, динамические приложения. Пройди самопроверку (counts==длины, ссылки приложений, плейсхолдеры). Собери audit_data.json. A12.md/.docx НЕ пиши - их собирают скрипты.
```

После возврата агента - прогнать рендер + проверку:

```bash
.claude\scripts\_node.cmd .claude\scripts\render-audit-md.mjs audits\<NNN>-<slug>
.claude\scripts\_node.cmd .claude\scripts\verify-audit.mjs    audits\<NNN>-<slug>
```

- `render-audit-md.mjs` -> `A12.md`.
- `verify-audit.mjs` -> если **exit 2** (есть ошибки): показать список ошибок пользователю и повторно делегировать `audit-writer` с инструкцией «исправь: <ошибки verify>». Повторять до exit 0 (макс 2 попытки; если не сходится - показать ошибки и спросить пользователя). WARN (exit 0 с предупреждениями) - показать, но продолжить.

После прохождения verify:
- `bash .claude/hooks/update-meta.sh <audit_dir> report-done`
- Краткая сводка + пути к `A12.md`, `audit_data.json`. Автопереход к шагу 6.

### 6. Сборка .docx (если state == "report-done")

```bash
.claude\scripts\_node.cmd .claude\scripts\build-audit-docx.mjs audits\<NNN>-<slug>
```

Скрипт читает `audit_data.json`, пишет `audits/<NNN>-<slug>/A12_<slug>.docx`.

После:
- `bash .claude/hooks/update-meta.sh <audit_dir> docx-done`
- Если `--no-share`: перейти к **финалу --no-share** (ниже). Иначе - шаг 7 (Drive).

#### Финал --no-share

`bash .claude/hooks/update-meta.sh <audit_dir> docx-done skip_reason="--no-share: Drive и цикл правок пропущены"`

Вывести:
```
═══ ТЕХАУДИТ A12 СОБРАН (локально) ═══
📌 Локальные артефакты:
   <audit_dir>/A12.md
   <audit_dir>/A12_<slug>.docx
   <audit_dir>/audit_data.json
🔎 Итог: 🔴 <N> / 🟡 <N> / 🟢 <N> проблем
✅ Готово к /handoff (перенесёт в main).
   Залить в Drive позже: /share-audit <NNN>
```
Стоп (без цикла правок).

### 7. Upload в Drive (если state == "docx-done", не для --no-share)

#### 7a. Прочитать DRIVE.md

`~/.claude/seo-knowledge/DRIVE.md` -> извлечь `audits_folder_id`.

Если файла или ключа нет - **не падать**, а вывести и остановиться в `docx-done`:
> «Не найден `audits_folder_id` в DRIVE.md. A12.md и A12.docx собраны локально в `<audit_dir>`. Чтобы залить в Drive: создай папку `/SEO/Audits/` в Drive (права `anyone-with-link -> reader`), добавь её ID в `~/.claude/seo-knowledge/DRIVE.md` как `audits_folder_id`, затем `/seo-tehaudit <NNN> --resume` или `/share-audit <NNN>`. Либо заверши через `/handoff` без Drive.»

#### 7b. Если в meta.json есть `drive_file_id` (revising-цикл)

Это повторная заливка после правок. Удалить старый файл:
```
mcp__gdrive-piotr__deleteItem(itemId="<old_drive_file_id>")
```
(Если упал - файл уже удалён руками; предупредить, продолжить.)

#### 7c. Загрузка

```
mcp__gdrive-piotr__uploadFile(
  localPath: <абсолютный путь к A12_<slug>.docx>,
  name: A12_<slug>,
  parentFolderId: <audits_folder_id>,
  mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  convertToGoogleFormat: true
)
```

Если `convertToGoogleFormat: true` упал (Google Docs API не активна) - fallback с `convertToGoogleFormat: false` + в сводку:
> ⚠️ Залит как .docx (Google Docs API не активна). Активируй в Google Cloud Console, потом `/share-audit <NNN> --redo`.

Сохранить `id`, `link`.

#### 7d. Записать `share.json` и meta.json

`<audit_dir>/share.json`:
```json
{
  "drive_file_id": "<id>",
  "drive_link": "<link>",
  "mime_type": "application/vnd.google-apps.document",
  "shared_at": "<ISO UTC>",
  "revisions": []
}
```
В `meta.json` добавить `drive_file_id`, `drive_link` (через `update-meta.sh ... drive_file_id=<id> drive_link=<link>`).
`bash .claude/hooks/update-meta.sh <audit_dir> shared drive_file_id=<id> drive_link=<link>`

#### 7e. Переход в `client-review`

`bash .claude/hooks/update-meta.sh <audit_dir> client-review`

Вывести:
```
═══ ТЕХАУДИТ A12 ГОТОВ И ЗАЛИТ В DRIVE ═══

📄 Ссылка для клиента (Google Doc):
   <drive_link>

📌 Локальные артефакты:
   <audit_dir>/A12.md
   <audit_dir>/A12_<slug>.docx
   <audit_dir>/audit_data.json

🔎 Итог: 🔴 <N> критичных / 🟡 <N> важных / 🟢 <N> желательных
📋 Топ-3 критичных: 1) ... 2) ... 3) ...

Жду фидбек:
  - "одобряю" / "OK" / "approved" -> approved, подскажу /handoff
  - "есть правки: <описание>" -> классифицирую и применю
```

**Не выходить из сессии. Ждать ввод.**

### 8. Обработка фидбека (state == "client-review")

#### 8a. Одобрение

Триггеры (case-insensitive): «одобряю», «ок», «approved», «всё хорошо», «принято», «accept».
- `bash .claude/hooks/update-meta.sh <audit_dir> approved`
- Переход к шагу 9.

#### 8b. Правка -> `revising`

`bash .claude/hooks/update-meta.sh <audit_dir> revising`

#### 8c. Классификация правки

Предложить тип и попросить OK:
```
Получил правку: "<цитата 1 строкой>"

Похоже это [<тип>]:
  - "edit"      - точечная правка текста отчёта (формулировка, добавить/убрать пункт, опечатка)
  - "recon"     - переснять разведку (не та CMS/регион/база Keyso, домен)
  - "indexing"  - перепроверить индексацию (robots/sitemap/диагностику/редиректы)
  - "onpage"    - перепроверить мета-теги/выборку страниц
  - "analytics" - перепроверить аналитику/ссылки/Яндекс Бизнес
  - "writer"    - пересобрать отчёт без перезапуска сбора (приоритеты, чеклист, приложения)

Согласен? [Y / n=другой тип]
```

Эвристики: цитата из A12 / «переформулируй/убери/добавь пункт» -> `edit`; «не та CMS/регион/база» -> `recon`; «robots/sitemap/редирект не так» -> `indexing`; «не те страницы/Title/H1» -> `onpage`; «трафик/цели/ЯБ неверно» -> `analytics`; «приоритет не тот/нет приложения/чеклист» -> `writer`.

#### 8d. Применение по типу

- **`edit`:** `Edit` в `audit_data.json` напрямую (это источник истины; A12.md/.docx - производные). Без перезапуска агентов.
- **`recon`:** перезапустить `audit-recon` (с пометкой правки), затем downstream: `audit-indexing`, шаг 4 (onpage∥analytics), `audit-writer`.
- **`indexing`:** `audit-indexing` (с пометкой), затем шаг 4, `audit-writer`.
- **`onpage`:** `audit-onpage` (с пометкой), затем `audit-writer`.
- **`analytics`:** `audit-analytics` (с пометкой), затем `audit-writer`.
- **`writer`:** только `audit-writer` с инструкцией «учти правку: <описание>».

#### 8e. Re-render + re-docx + re-upload

```bash
.claude\scripts\_node.cmd .claude\scripts\render-audit-md.mjs audits\<NNN>-<slug>
.claude\scripts\_node.cmd .claude\scripts\verify-audit.mjs    audits\<NNN>-<slug>
.claude\scripts\_node.cmd .claude\scripts\build-audit-docx.mjs audits\<NNN>-<slug>
```
Затем шаг 7b (delete старого) + 7c (upload нового). Дописать `share.json.revisions[]`:
```json
{ "type": "<edit|recon|...>", "note": "<правка 1 строкой>", "applied_at": "<ISO>", "new_drive_file_id": "<id>", "new_drive_link": "<link>" }
```
Вернуться в `client-review` (шаг 7e). Цикл может повторяться.

### 9. Финал (state == "approved")

`bash .claude/hooks/update-meta.sh <audit_dir> completed`

Финальный коммит:
```
git add -A
git commit -m "Audit <NNN> for <slug>: completed (<N> revisions)"
```
(Если pre-commit отклонит из-за общих файлов - закоммитить только `audits/<NNN>-<slug>/` и `.claude/tmp/`.)

Вывести:
```
═══ ТЕХАУДИТ A12 ОДОБРЕН ═══
Клиент: <domain>
Итераций правок: <N>

📄 A12 в Drive (Google Doc, для клиента):
   <drive_link>

📌 Локальные артефакты:
   <audit_dir>/A12.md            - отчёт
   <audit_dir>/audit_data.json   - структурированные данные
   <audit_dir>/A12_<slug>.docx   - клиентский документ

✅ Готово к /handoff (перенесёт в main).
```

## Параллельная работа

Несколько аудитов одновременно - каждый в своём worktree. Состояния не пересекаются.

## Запреты

- НЕ пиши результаты в корень проекта - только в `<audit_dir>/`. Иначе pre-commit отклонит.
- НЕ пропускай состояния - каждое `update-meta.sh` обязательно.
- НЕ редактируй общие файлы (`ЗАКАЗЧИК.md`, `template.html`) - read-only из worktree.
- НЕ используй длинное тире (—) и среднее (–). Только дефис (-).
- НЕ делай `git push` и не публикуй артефакты вне Drive-шага - это решение пользователя.
- НЕ запускай `arsenkin_domains` в параллель - только `audit-recon` зовёт его последовательно (он ломается при параллельных вызовах).
- НЕ запускай `/seo-statya`, `/seo-analiz`, `/seo-strategiya` из этой же сессии - отдельные worktree-задачи.
