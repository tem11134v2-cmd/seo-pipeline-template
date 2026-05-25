# ADR-005: Обёртка `_node.cmd` для устойчивости к проблемам PATH

**Статус:** Принято

**Дата:** 2026-05-24

## Контекст

4 скрипта системы (`to-excel.mjs`, `assemble-html.mjs`, `tilda-split.mjs`, `finalize-setup.mjs`) написаны на Node.js. Скилы вызывают их через Bash/PowerShell:

```
node .claude/scripts/to-excel.mjs <args>
```

Проблема: при установке Node через scoop путь добавляется в **persistent user PATH** через реестр Windows. Уже запущенные процессы Claude Code Desktop наследуют **старый PATH** без node — скрипт падает с «node is not recognized».

Решений два:
- Перезапустить Claude Code Desktop (PATH обновится из реестра).
- Найти node программно по стандартным путям и вызвать его напрямую.

## Решение

**Тонкая обёртка `.claude/scripts/_node.cmd`** (для cmd/PowerShell) и `_node.sh` (для Git Bash).

Логика:
1. `where node` — если в PATH, использовать его.
2. Иначе проверить 4 стандартных места установки:
   - `%USERPROFILE%\scoop\apps\nodejs-lts\current\node.exe`
   - `%USERPROFILE%\scoop\apps\nodejs\current\node.exe`
   - `%ProgramFiles%\nodejs\node.exe`
   - `%LOCALAPPDATA%\Programs\nodejs\node.exe`
3. Найденному node передать все аргументы.
4. Если ни один путь не сработал — exit 127 с подсказкой «scoop install nodejs-lts».

Все скилы переписаны на вызов `.claude\scripts\_node.cmd <script>.mjs ...` вместо `node <script>.mjs ...`.

## Альтернативы

### A. Требовать перезапуск Claude Code Desktop

Документировать «после `scoop install nodejs-lts` перезапусти десктоп». Отвергнуто: лишний шаг, легко забыть, на свежей машине пользователя — это первое впечатление, которое портит ощущение от системы.

### B. Переписать всё на PowerShell

Убрать Node.js как зависимость. Отвергнуто:
- `assemble-html.mjs` использует `marked` (markdown → HTML) и `jsdom` (DOM-парсинг для оглавления, плитки тегов). В PowerShell нет аналогов без внешних модулей.
- Самописный markdown-конвертер — хрупкий, ломается на нестандартном вводе от агентов.

### C. Embedded portable Node в репо

Положить portable Node ZIP в template-project, распаковывать при первой установке. Отвергнуто: размер репо вырастет на 80+ МБ, кросс-платформенность ломается (Mac/Linux не запустят Windows-бинарник).

### D. Захардкоженный путь к node в скилах

`& "C:\path\to\node.exe" .claude/scripts/X.mjs`. Отвергнуто: ломается при любом изменении пути установки, привязка к конкретной машине.

## Последствия

**Хорошо:**
- Установил node — всё работает, перезапускать ничего не надо.
- Кросс-платформенность сохранена (есть и `.cmd`, и `.sh`).
- Если node удалили — внятное сообщение об ошибке с подсказкой.

**Плохо:**
- Лишний уровень индирекции: `.claude\scripts\_node.cmd .claude\scripts\X.mjs` вместо чистого `node X.mjs`. Видно в логах.
- Список fallback-путей **жёстко зашит**, новые места установки (например, nvm-windows) требуют правки `_node.cmd`.
- Cmd-скрипты не поддерживают кириллицу в комментариях (исходник на английском) — пришлось учитывать при отладке.

## Ссылки

- `.claude/scripts/_node.cmd`
- `.claude/scripts/_node.sh`
- Скилы, использующие обёртку: `setup-project`, `new-topics`, `write-article`, `fix-article`, `handoff-process`
