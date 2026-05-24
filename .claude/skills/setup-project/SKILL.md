---
name: setup-project
description: Создаёт новый проект клиента. Принимает URL. Делегирует client-profiler и template-designer, потом склеивает финал.
---

# setup-project

Одноразовая настройка проекта клиента.

## Аргументы

`/setup-project <URL>` — URL сайта клиента (обязательно).

## Алгоритм

### 1. Парсинг URL и предложение slug

Из URL вычленить домен (без `www.`, без `https://`). Предложить пользователю slug папки (по умолчанию = домен с заменой `.` на `_`). Спросить:

> «Создаю проект для `<домен>`. Папка: `~/seo-projects/<slug>/`. Подтверди или предложи другой slug.»

Дождаться ответа.

### 2. Копирование шаблона

```
PowerShell (Windows):
  Copy-Item -Recurse "$env:USERPROFILE\seo-projects\template-project" "$env:USERPROFILE\seo-projects\<slug>"

Bash:
  cp -r ~/seo-projects/template-project ~/seo-projects/<slug>
```

После копирования — переключить рабочую директорию на новую папку (через `cd` или префикс пути ко всем дальнейшим командам).

### 3. `git init`

В новой папке:
```
git init -q
```

(Полный коммит сделает `finalize-setup.mjs` на шаге 8.)

### 4. Делегирование `client-profiler`

Перед вызовом — записать маркер ожидаемого файла:

```
.claude/tmp/expected-client-profiler-<run_id>.txt:
  ЗАКАЗЧИК.md
```

Делегировать субагента `client-profiler` с промтом:
```
URL: <URL>
project_root: <абсолютный путь к ~/seo-projects/<slug>/>
Заполни ЗАКАЗЧИК.md по шаблону.
```

После завершения — прочитать `ЗАКАЗЧИК.md` и вывести в чат краткую сводку. Спросить:
> «Профиль собран. Что-то поправить или продолжаем?»

Ждать ОК или правок. Если правки — применить через `Edit` или повторно делегировать.

### 5. Делегирование `template-designer`

Маркер:
```
.claude/tmp/expected-template-designer-<run_id>.txt:
  template.html
```

Делегировать с промтом:
```
project_root: <путь>
Прочитай ЗАКАЗЧИК.md, сгенерируй template.html на базе ~/.claude/seo-knowledge/TEMPLATE-MASTER.html.
```

### 6. Открыть `template.html` в браузере

```
PowerShell: Start-Process "<путь к template.html>"
Bash: xdg-open template.html || open template.html
Windows cross: start template.html
```

Сообщить пользователю:
> «Шаблон открыт в браузере. Проверь дизайн, скажи ОК или попроси правки.»

Ждать.

### 7. Если есть правки шаблона

- Применить через `Edit` или повторно делегировать `template-designer`.
- Снова открыть в браузере, дождаться подтверждения.

### 8. Финализация

```
node .claude/scripts/finalize-setup.mjs
```

Это создаёт `.env.example` и делает первый git-коммит.

### 9. Готово

Сообщить пользователю:
> «Проект `<slug>` готов. Дальше: `/new-topics` для сбора тем.»

## Запреты

- Не редактируй `template-project/` — это шаблон.
- Не используй длинное тире (—) и среднее (–). Только дефис (-).
- Не делай git push — это решение пользователя.
- Не пиши `topics.xlsx` и не запускай агентов фазы 2-4.

## Состояние

Скил не использует state machine — он одношаговый, без resume. Если что-то сломалось посередине — удалить созданную папку и запустить заново.
