---
name: setup-project
description: Исследует сайт клиента и готовит ЗАКАЗЧИК.md + template.html. Запускается в worktree после клонирования template-репо. Файлы выносятся в main через /handoff + /handoff-process.
---

# setup-project

Первичное исследование проекта клиента: сбор данных с сайта, генерация профиля и шаблона вёрстки. **Запускается в worktree-сессии** уже клонированного template-репо.

## Аргументы

```
/setup-project <URL_сайта_клиента>
```

## Алгоритм

### 0. Проверка: мы в worktree?

```bash
GIT_DIR=$(git rev-parse --git-dir)
COMMON_DIR=$(git rev-parse --git-common-dir)
```

Если `GIT_DIR == COMMON_DIR` (мы в main) — сообщить и отказать:
> «/setup-project работает только в worktree-сессии. Открой текущую папку в новой сессии с галочкой worktree.»

### 1. Записать current-task.txt

Без него pre-commit hook откажет в коммите. Текущая «задача» — настройка проекта:
```
.claude/tmp/current-task.txt = .claude/handoff-requests/setup
```

(Сама папка `setup` под handoff-requests — это область, куда складываем результаты. Зона разрешена pre-commit хуком.)

### 2. Делегировать `client-profiler`

Маркер ожидаемого файла:
```
.claude/tmp/expected-client-profiler-<run_id>.txt:
  .claude/handoff-requests/files/ЗАКАЗЧИК.md
```

Промт агенту (переопределить путь — пишем в handoff-requests, не в корень):
```
URL: <URL>
project_root: <current project root>
output_path: .claude/handoff-requests/files/ЗАКАЗЧИК.md
Заполни ЗАКАЗЧИК.md по шаблону. Сохрани в указанный output_path (не в корень — корень обновится позже через /handoff-process в main).
```

После завершения:

**a) Краткая сводка (не дамп файла).** Вывести в чат ТОЛЬКО: одну строку про основное (домен / ниша / регион) + список полей `_не заполнено_` / «под вопросом» из возврата субагента. Полный профиль НЕ цитировать (он в файле) — показать целиком лишь по явному запросу. Экономит контекст длинной setup-сессии.

**b) Один раунд вопросов через `AskUserQuestion`** (не цикл «прочитал -> правки -> новый профиль»). Собрать открытые вопросы из возврата субагента в ОДИН вызов `AskUserQuestion` (лимит — до 4 вопросов). Типовой набор:
- **Дистрибуция** (multiSelect): VC, Хабр, Дзен, Telegram + Other. (Раньше это спрашивал субагент — теперь спрашивает оркестратор, т.к. субагент не дожидается интерактивного ответа.)
- **URL подкатегорий**: если sitemap дал URL — вопрос-подтверждение «URL подтянуты из sitemap, верно? [да / поправлю]». Если sitemap не дал — попросить ссылки.
- **Автор** (имя/должность): свободный текст — задать одним вопросом с опорой на «Other»-ввод.
- Любые прочие `_не заполнено_` — добить в этот же раунд (в пределах лимита 4).

Если открытых вопросов нет — раунд пропустить.

**c) Применить ответы** к `.claude/handoff-requests/files/ЗАКАЗЧИК.md` через Edit (без повторного прогона субагента).

**d)** Спросить одной строкой: «Профиль готов. Продолжаем к шаблону вёрстки? [да / ещё правки]». Профиль-OK — жёсткий чекпоинт (на профиле стоит шаблон, пропускать нельзя). Ждать ОК или правок.

### 3. Делегировать `template-designer`

Маркер:
```
.claude/tmp/expected-template-designer-<run_id>.txt:
  .claude/handoff-requests/files/template.html
```

Промт:
```
project_root: <current project root>
client_profile_path: .claude/handoff-requests/files/ЗАКАЗЧИК.md
output_path: .claude/handoff-requests/files/template.html
Прочитай профиль по client_profile_path, сгенерируй template.html на базе ~/.claude/seo-knowledge/TEMPLATE-MASTER.html. Сохрани в output_path.
```

### 4. Показать `template.html` со скриншотом-самопроверкой

**a) Скриншот (best-effort, с мягкой деградацией).** Если подключён браузерный MCP `Claude_in_Chrome`:
1. `navigate` на `file://<абсолютный путь к корню>/.claude/handoff-requests/files/template.html`.
2. `preview_screenshot` (или screenshot активного таба).
3. Показать скриншот в чате + **свой вердикт самопроверки**: подгрузился ли заявленный в `--nx-font` шрифт (или упал в Arial-fallback), не поехала ли вёрстка (наезды, пустые блоки, сломанная таблица/FAQ), читаемы ли цвета на фоне.

Если браузерного MCP нет — **деградировать молча** на открытие в системном браузере:
```
PowerShell: Start-Process ".claude\handoff-requests\files\template.html"
Bash: xdg-open .claude/handoff-requests/files/template.html || open .claude/handoff-requests/files/template.html
```
Скрин — бонус для самопроверки, не блокер.

**b) Мягкий template-OK (неблокирующий).** В отличие от профиля, чекпоинт шаблона — мягкий: мелкие правки вёрстки не ломают фундамент. Сообщить:
> «Шаблон собран. По моей самопроверке: <вердикт>. Можно принять сейчас или посмотреть позже и поправить через `/request-shared-edit`. Продолжаю? [ок / правки]»

Если правки названы сейчас — применить через Edit или повторно делегировать `template-designer`. Если пользователь молчит/говорит «ок»/«потом» — считать принятым и идти дальше (не зацикливаться на ожидании).

> Примечание: отдельного скила `fix-template` нет — правки готового шаблона позже идут через `/request-shared-edit` (в worktree) или прямой правкой в main.

### 5. Создать метаданные для handoff-process

Записать `.claude/handoff-requests/setup-meta.json`:
```json
{
  "type": "setup-project",
  "created": "<ISO UTC>",
  "files": [
    {
      "source": ".claude/handoff-requests/files/ЗАКАЗЧИК.md",
      "target": "ЗАКАЗЧИК.md",
      "operation": "create"
    },
    {
      "source": ".claude/handoff-requests/files/template.html",
      "target": "template.html",
      "operation": "create"
    }
  ],
  "post_actions": [
    "git config core.hooksPath .claude/git-hooks"
  ],
  "notes": "Первичная инициализация проекта <URL>. После применения main-проект готов к /new-topics и /write-article."
}
```

**Самовалидация контракта (обязательно перед финалом).** Перечитать только что записанный `setup-meta.json` и проверить:
1. Есть ключи `type` и непустой `files[]`, у каждого элемента — `source`, `target`, `operation`.
2. Каждый `source`-файл существует и непуст (это ловит частичный провал: если `template-designer` упал — `template.html` нет, и мы узнаем об этом ЗДЕСЬ, а не в `cp` несуществующего внутри `/handoff-process`).

Если проверка не прошла — **не финализировать**: сообщить, что именно не так, и предложить перегенерировать упавший артефакт (повторно делегировать соответствующего субагента). Только после успешной валидации идти к шагу 6.

### 6. Финал

Сообщить пользователю:
```
═══ SETUP READY ═══
Профиль и шаблон собраны в .claude/handoff-requests/.

Дальше:
  /handoff  — финализирует worktree, мержит в main
  Затем открой main-сессию (без worktree) → /handoff-process
              — применит файлы в корень проекта
              (можно сперва /handoff-process --dry-run — покажет план без применения)
═══════════════════
```

## Запреты

- Не пиши `ЗАКАЗЧИК.md` или `template.html` в корень проекта напрямую — только в `.claude/handoff-requests/files/`. Иначе pre-commit hook откажет в коммите.
- Не запускай `/new-topics`, `/write-article` из этой же сессии — это отдельные worktree-задачи.
- Не используй длинное тире (—) и среднее (–). Только дефис (-).

## Состояние

Скил одношаговый, без resume. Если что-то сломалось посередине — откати handoff-requests/setup-meta.json и handoff-requests/files/ и запусти заново.
